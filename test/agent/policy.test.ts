/**
 * Child admission and durable child policy (AG-02, AG-07).
 *
 * These cases drive the real native path: the production AgentLoop creates the
 * child, the shipped in-process provider publishes it, and the effective
 * sandbox mode is read back from the real shared policy service — the same fold
 * the enforcing filesystem, bash and terminal families resolve. A read-only
 * child is refused by the enforcing backend itself, not by Nexus prose, and a
 * write child's tree is bounded by the delegating session's granted workspace.
 *
 * @module dsh-nexus/test/agent/policy
 */

import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { NexusStore } from '../../src/storage/store.ts'
import type { RuntimeSettings } from '../../src/protocol.ts'
import {
  admitChildPolicy,
  registerChildPolicy,
  type ChildAccess,
  type ChildAccessCeiling,
} from '../../src/agent/policy.ts'
import { canonicalDirectory, createWriteCoordinator, directoryKey, type WriteCoordinator } from '../../src/agent/coordination.ts'
import { createFsTools } from '../../src/fs/read.ts'
import { createShellTool } from '../../src/shell/tool.ts'
import type { ShellExecutionConfig } from '../../src/shell/engines.ts'
import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import {
  mountNexusStoreFixture,
  mountRecordingSandbox,
  mountSubprocessDouble,
  type NexusStoreFixture,
} from '../support/fixtures.ts'
import { mountSubagentHarness, waitFor, type SubagentHarness } from '../support/agent-harness.ts'

/** Bash pairing over the running Node executable; no shell is actually spawned. */
const BASH_CONFIG: ShellExecutionConfig = {
  deployment: {},
  terminal: { engine: 'bash', bashPath: process.execPath },
}

/** Everything one case owns, disposed after it. */
interface OpenCase {
  readonly harness: SubagentHarness
  readonly store: NexusStoreFixture
  readonly openStore: NexusStore
  readonly coordinator: WriteCoordinator
  readonly disposePolicy: () => void
  readonly parent: Agent
  /** Settings the enforcement hooks read, so a case can change them mid-run. */
  readonly settings: () => RuntimeSettings
}

/** The stored defaults with one child-access ceiling applied. */
function settingsWith(childAccess: ChildAccessCeiling): RuntimeSettings {
  return { ...DEFAULT_SETTINGS, agents: { ...DEFAULT_SETTINGS.agents, childAccess } }
}

/** Cases still open; disposed in reverse order after each test. */
const open: Partial<OpenCase>[] = []

afterEach(async () => {
  for (const entry of open.splice(0)) {
    entry.disposePolicy?.()
    await entry.openStore?.dispose()
    await entry.store?.dispose()
    await entry.harness?.dispose()
  }
})

/**
 * Mount the native composition, the durable store and the child-policy hook.
 * @param options - deployment sandbox mode and whether scripted answers are held.
 * @returns the open case.
 */
async function openCase(
  options: {
    mode?: SandboxMode
    hold?: boolean
    childAccess?: ChildAccessCeiling
    settings?: () => RuntimeSettings
  } = {},
): Promise<OpenCase> {
  const harness = await mountSubagentHarness({ mode: options.mode ?? 'workspace-write', hold: options.hold ?? false })
  const store = await mountNexusStoreFixture()
  const openStore = await store.open()
  const coordinator = createWriteCoordinator(harness.ctx)
  const settings = options.settings ?? ((): RuntimeSettings => settingsWith(options.childAccess ?? 'inherit'))
  const disposePolicy = registerChildPolicy(harness.ctx, openStore, coordinator, settings)
  const parent = await harness.createParent('policy-parent')
  for (const tool of createFsTools(harness.ctx, settings)) harness.ctx.tools.register(tool)
  const entry: OpenCase = { harness, store, openStore, coordinator, disposePolicy, parent, settings }
  open.push(entry)
  return entry
}

/** One admitted child and the native activation behind it. */
interface StartedChild {
  readonly childId: SessionId
  readonly child: Agent
  readonly cwd: string
}

/**
 * Admit and natively start one child through the policy seam.
 * @param testCase - open case.
 * @param childId - reserved id.
 * @param access - declared child access.
 * @param cwd - requested directory (absolute or relative to the parent).
 * @param extra - extra admission fields (depth cap).
 * @returns the live child.
 */
async function startChild(
  testCase: OpenCase,
  childId: string,
  access: ChildAccess,
  cwd: string,
  extra: { maxDepth?: number } = {},
): Promise<StartedChild> {
  const { harness, openStore, coordinator, parent } = testCase
  const admission = await admitChildPolicy(
    harness.ctx,
    openStore,
    coordinator,
    { agent: parent, sessionId: parent.id, signal: new AbortController().signal },
    {
      childId: SessionId(childId),
      cwd,
      access,
      maxDepth: extra.maxDepth ?? 2,
      accessCeiling: testCase.settings().agents.childAccess,
    },
  )
  try {
    await harness.ctx.subagents.startActivation({
      provider: 'spawn',
      label: childId,
      childId: SessionId(childId),
      request: { prompt: [{ type: 'text', text: `task for ${childId}` }], parent, cwd: admission.policy.cwd },
      signal: new AbortController().signal,
      delivery: 'parent',
    })
  } catch (error) {
    await admission.releaseUnstarted()
    throw error
  }
  const child = harness.ctx.agents.get(SessionId(childId))
  if (child === undefined) throw new Error(`child ${childId} was not published`)
  return { childId: SessionId(childId), child, cwd: admission.policy.cwd }
}

/** Effective mode the enforcing families resolve for one live child. */
function effectiveMode(testCase: OpenCase, child: Agent): SandboxMode {
  return testCase.harness.ctx.sandboxPolicy.resolve({ session: child.session }).mode
}

/**
 * The file-policy sentence one child's model request carried.
 * @param testCase - open case.
 * @param childId - child session whose request is inspected.
 * @param index - index within that child's own requests.
 * @returns the resolved policy sentence, or undefined when the request carried none.
 */
function requestPolicy(testCase: OpenCase, childId: string, index: number): string | undefined {
  const request = testCase.harness.requestsOf(childId)[index]
  if (request === undefined) return undefined
  // Earlier snapshots remain in model history; only the last one is current.
  return [...JSON.stringify(request.options.messages).matchAll(/Current DSH file policy: [a-z-]+/g)].at(-1)?.[0]
}

/**
 * The error in one rejection's cause chain that carries a given code.
 *
 * The native continuation path wraps a refused creation in its own
 * `NOT_RESUMABLE` error, so a case reads the whole chain instead of assuming
 * the outermost error is the Nexus refusal.
 * @param error - rejection value.
 * @param code - error code the caller expects somewhere in the chain.
 * @returns that error, or undefined when no link carries the code.
 */
function errorWithCode(error: unknown, code: string): (Error & { readonly code: string }) | undefined {
  let current: unknown = error
  for (let depth = 0; current instanceof Error && depth < 8; depth += 1) {
    const candidate = current as Error & { readonly code?: unknown; readonly cause?: unknown }
    if (candidate.code === code) return candidate as Error & { readonly code: string }
    current = candidate.cause
  }
  return undefined
}

describe('child policy admission', () => {
  it('narrows a read-only child at creation and keeps the record before the child exists', async () => {
    const testCase = await openCase()
    const { harness, openStore, parent } = testCase
    const seen: (string | undefined)[] = []
    harness.ctx.on('agent/created', async ({ agent }) => {
      if (agent.id !== SessionId('read-child')) return
      seen.push((await openStore.getChildPolicy(agent.id))?.access)
    })

    const started = await startChild(testCase, 'read-child', 'read', harness.workspace)

    // The durable authorization existed before the native child was published.
    expect(seen).toEqual(['read'])
    expect(effectiveMode(testCase, started.child)).toBe('read-only')
    const stored = await openStore.getChildPolicy('read-child')
    expect(stored).toMatchObject({
      childId: 'read-child',
      parentSessionId: parent.id,
      access: 'read',
      maxDepth: 2,
    })
    expect(directoryKey(stored?.cwd ?? '')).toBe(directoryKey(started.cwd))
  })

  it('refuses a real edit by a read-only child through the enforcing filesystem', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const target = join(harness.workspace, 'guarded.txt')
    await writeFile(target, 'before\n', 'utf8')
    const started = await startChild(testCase, 'read-child', 'read', harness.workspace)
    await waitFor(() => harness.requestsOf('read-child').length === 1, 'the child model request')

    const read = await harness.ctx.tools.execute({
      callId: ToolCallId('child-read'),
      name: 'read',
      arguments: { path: target },
      agent: started.child,
      signal: new AbortController().signal,
    })
    expect(read.isError).toBe(false)
    const denied = await harness.ctx.tools.execute({
      callId: ToolCallId('child-edit'),
      name: 'edit',
      arguments: { path: target, edits: [{ oldText: 'before', newText: 'after' }] },
      agent: started.child,
      signal: new AbortController().signal,
    })

    expect(denied.isError).toBe(true)
    expect(denied.error?.info).toMatchObject({ name: 'FsError', code: 'FS_SANDBOX_DENIED' })
    expect(await readFile(target, 'utf8')).toBe('before\n')
    // The native fence refused before any mutation reached the backend.
    expect(harness.fs.edits).toHaveLength(0)
    harness.releaseFor('read-child')
  })

  it('lets a write child mutate inside its granted workspace and refuses the tree above it', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const scope = join(harness.workspace, 'writer-scope')
    await mkdir(scope, { recursive: true })
    const started = await startChild(testCase, 'write-child', 'write', scope)
    await waitFor(() => harness.requestsOf('write-child').length === 1, 'the child model request')
    const policy = harness.ctx.sandboxPolicy.resolve({ session: started.child.session })
    // A write child runs `workspace-write`; its boundary is the delegating
    // session's granted workspace and never a wider tree.
    expect(policy).toMatchObject({ mode: 'workspace-write' })
    expect(directoryKey(policy.workspaceRoot)).toBe(directoryKey(harness.workspace))

    const inside = await harness.ctx.fs.resolve(join(scope, 'inside.txt'), {})
    await expect(
      harness.ctx.fs.writeText(inside, 'written\n', { kind: 'createIfAbsent' }, undefined, policy),
    ).resolves.toBeDefined()
    const outside = await harness.ctx.fs.resolve(join(harness.root, 'escaped.txt'), {})
    await expect(
      harness.ctx.fs.writeText(outside, 'escaped\n', { kind: 'createIfAbsent' }, undefined, policy),
    ).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
    harness.releaseFor('write-child')
  })

  it('refuses a write child whose directory escapes the parent workspace', async () => {
    const testCase = await openCase()
    const { harness, openStore, parent } = testCase
    const outside = join(harness.root, 'outside')
    await mkdir(outside, { recursive: true })

    await expect(
      admitChildPolicy(
        harness.ctx,
        openStore,
        testCase.coordinator,
        { agent: parent, sessionId: parent.id, signal: new AbortController().signal },
        { childId: SessionId('escape-child'), cwd: outside, access: 'write', maxDepth: 2, accessCeiling: 'inherit' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    // No child was admitted: nothing was created and nothing was persisted.
    expect(harness.ctx.agents.get(SessionId('escape-child'))).toBeUndefined()
    expect(await openStore.getChildPolicy('escape-child')).toBeUndefined()
  })

  it('refuses a write child whose directory escapes through a junction alias', async () => {
    const testCase = await openCase()
    const { harness, openStore, parent } = testCase
    const outside = join(harness.root, 'outside')
    await mkdir(outside, { recursive: true })
    const alias = join(harness.workspace, 'outside-alias')
    await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir')

    await expect(
      admitChildPolicy(
        harness.ctx,
        openStore,
        testCase.coordinator,
        { agent: parent, sessionId: parent.id, signal: new AbortController().signal },
        { childId: SessionId('alias-child'), cwd: alias, access: 'write', maxDepth: 2, accessCeiling: 'inherit' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(harness.ctx.agents.get(SessionId('alias-child'))).toBeUndefined()
  })

  it('refuses a write child when the parent itself is read-only', async () => {
    const testCase = await openCase({ mode: 'read-only' })
    const { harness, openStore, parent } = testCase
    await expect(
      admitChildPolicy(
        harness.ctx,
        openStore,
        testCase.coordinator,
        { agent: parent, sessionId: parent.id, signal: new AbortController().signal },
        { childId: SessionId('expanding-child'), cwd: harness.workspace, access: 'write', maxDepth: 2, accessCeiling: 'inherit' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(await openStore.getChildPolicy('expanding-child')).toBeUndefined()
  })

  it('fails closed when the sandbox policy service is not mounted', async () => {
    const harness = await mountSubagentHarness({ policy: false })
    const store = await mountNexusStoreFixture()
    const openStore = await store.open()
    open.push({ harness, store, openStore })
    const parent = await harness.createParent('no-policy-parent')
    const coordinator = createWriteCoordinator(harness.ctx)

    // A composition without the shared policy service cannot prove a read-only
    // child, so admission refuses instead of trusting its own record.
    expect(harness.ctx.get('sandboxPolicy')).toBeUndefined()
    await expect(
      admitChildPolicy(
        harness.ctx,
        openStore,
        coordinator,
        { agent: parent, sessionId: parent.id, signal: new AbortController().signal },
        {
          childId: SessionId('no-policy-child'),
          cwd: harness.workspace,
          access: 'read',
          maxDepth: 2,
          accessCeiling: 'inherit',
        },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(await openStore.getChildPolicy('no-policy-child')).toBeUndefined()
  })

  it('gives the reservation back when the native start fails', async () => {
    const testCase = await openCase()
    const { harness, openStore, parent } = testCase
    const scope = join(harness.workspace, 'failed-scope')
    await mkdir(scope, { recursive: true })
    const admission = await admitChildPolicy(
      harness.ctx,
      openStore,
      testCase.coordinator,
      { agent: parent, sessionId: parent.id, signal: new AbortController().signal },
      { childId: SessionId('unstarted-child'), cwd: scope, access: 'write', maxDepth: 2, accessCeiling: 'inherit' },
    )
    expect(await openStore.getChildPolicy('unstarted-child')).toMatchObject({ access: 'write' })
    // Admission-only cleanup is genuinely safe: no native start was attempted.
    await admission.releaseUnstarted()

    expect(await openStore.getChildPolicy('unstarted-child')).toBeUndefined()
    // The tree is free again for the next writer.
    const retry = await testCase.coordinator.acquire(parent, SessionId('retry-child'), scope)
    retry.release()
  })
})

describe('configurable child sandbox ceiling', () => {
  it('gives a write child the parent session mode under inherit', async () => {
    const testCase = await openCase({ mode: 'danger-full-access', childAccess: 'inherit' })
    const { harness, openStore } = testCase

    const started = await startChild(testCase, 'full-writer', 'write', harness.workspace)

    // `inherit` is the parent's current mode, not a fixed ceiling: here the
    // parent itself runs unrestricted.
    expect(effectiveMode(testCase, started.child)).toBe('danger-full-access')
    expect(await openStore.getChildPolicy('full-writer')).toMatchObject({ access: 'write' })
  })

  it('never widens past a read-only parent under inherit', async () => {
    const testCase = await openCase({ mode: 'read-only', childAccess: 'inherit' })
    const { harness } = testCase

    const read = await startChild(testCase, 'read-child', 'read', harness.workspace)
    expect(effectiveMode(testCase, read.child)).toBe('read-only')
    // Inheritance is a ceiling, not a grant: a read-only parent still cannot
    // delegate a writer at all.
    await expect(startChild(testCase, 'write-child', 'write', harness.workspace)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
  })

  it('reproduces the previous workspace-write ceilings under the workspace-write setting', async () => {
    const testCase = await openCase({ mode: 'danger-full-access', childAccess: 'workspace-write' })
    const { harness } = testCase
    const scope = join(harness.workspace, 'ww-scope')
    await mkdir(scope, { recursive: true })

    const writer = await startChild(testCase, 'ww-writer', 'write', scope)
    expect(effectiveMode(testCase, writer.child)).toBe('workspace-write')
    const policy = harness.ctx.sandboxPolicy.resolve({ session: writer.child.session })
    expect(directoryKey(policy.workspaceRoot)).toBe(directoryKey(harness.workspace))
    const reader = await startChild(testCase, 'ww-reader', 'read', harness.workspace)
    expect(effectiveMode(testCase, reader.child)).toBe('read-only')
  })

  it('caps even a write child under the read-only setting and takes no write lease', async () => {
    const testCase = await openCase({ childAccess: 'read-only' })
    const { harness, openStore, coordinator } = testCase
    const scope = join(harness.workspace, 'capped-scope')
    await mkdir(scope, { recursive: true })

    const started = await startChild(testCase, 'capped-writer', 'write', scope)

    expect(effectiveMode(testCase, started.child)).toBe('read-only')
    // The requested access is recorded as what was actually granted, so the
    // durable record and the tool result never claim write authority.
    expect(await openStore.getChildPolicy('capped-writer')).toMatchObject({ access: 'read' })
    expect(coordinator.scopeOf(SessionId('capped-writer'))).toBeUndefined()
  })
})

describe('policy revalidation beyond creation', () => {
  it('never keeps inherited full access after its parent becomes read-only', async () => {
    const testCase = await openCase({ mode: 'danger-full-access', hold: true })
    const { harness, parent } = testCase
    const started = await startChild(testCase, 'parent-tightened', 'write', harness.workspace)
    await waitFor(() => harness.requestsOf('parent-tightened').length === 1, 'the first request')
    expect(effectiveMode(testCase, started.child)).toBe('danger-full-access')
    setSandboxMode(parent.session, 'read-only')
    harness.releaseFor('parent-tightened')
    await started.child.whenIdle()
    await harness.ctx.subagents.sendMessage(parent, started.childId, [{ type: 'text', text: 'next turn' }], {
      signal: new AbortController().signal,
    })
    await waitFor(() => harness.requestsOf('parent-tightened').length >= 2, 'the next request')
    expect(effectiveMode(testCase, started.child)).toBe('read-only')
    expect(requestPolicy(testCase, 'parent-tightened', 1)).toContain('read-only')
    harness.releaseFor('parent-tightened')
  })

  it('re-narrows a resident writer when the ceiling becomes read-only before its next step', async () => {
    const ceiling: { current: ChildAccessCeiling } = { current: 'workspace-write' }
    const testCase = await openCase({ hold: true, settings: () => settingsWith(ceiling.current) })
    const { harness, parent } = testCase
    const scope = join(harness.workspace, 'ceiling-scope')
    await mkdir(scope, { recursive: true })
    const started = await startChild(testCase, 'ceiling-writer', 'write', scope)
    await waitFor(() => harness.requestsOf('ceiling-writer').length === 1, 'the first child request')
    expect(effectiveMode(testCase, started.child)).toBe('workspace-write')

    // The operator tightens the setting after admission. The next turn must run
    // under the new ceiling instead of keeping the wider recorded grant.
    ceiling.current = 'read-only'
    harness.releaseFor('ceiling-writer')
    await started.child.whenIdle()
    await harness.ctx.subagents.sendMessage(parent, started.childId, [{ type: 'text', text: 'next turn' }], {
      signal: new AbortController().signal,
    })
    await waitFor(() => harness.requestsOf('ceiling-writer').length >= 2, 'the second child request')

    expect(effectiveMode(testCase, started.child)).toBe('read-only')
    expect(requestPolicy(testCase, 'ceiling-writer', 1)).toContain('read-only')
    harness.releaseFor('ceiling-writer')
  })

  it('re-narrows a child whose mode was widened before its next step', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const started = await startChild(testCase, 'read-child', 'read', harness.workspace)
    await waitFor(() => harness.requestsOf('read-child').length === 1, 'the first child request')
    expect(requestPolicy(testCase, 'read-child', 0)).toContain('read-only')

    // A resident child can be woken again without a new creation edge: a UI
    // policy control (or any other actor) widening the mode must not survive.
    setSandboxMode(started.child.session, 'danger-full-access')
    await harness.ctx.subagents.sendMessage(testCase.parent, started.childId, [{ type: 'text', text: 'next turn' }], {
      signal: new AbortController().signal,
    })
    harness.releaseFor('read-child')
    await waitFor(() => harness.requestsOf('read-child').length >= 2, 'the second child request')

    // The second request itself carried the narrowed policy, so the widening
    // never reached the model.
    expect(requestPolicy(testCase, 'read-child', 1)).toContain('read-only')
    expect(effectiveMode(testCase, started.child)).toBe('read-only')
    harness.releaseFor('read-child')
  })

  it('keeps a read-only child read-only after a cold resume', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const started = await startChild(testCase, 'read-child', 'read', harness.workspace)
    await waitFor(() => harness.requestsOf('read-child').length === 1, 'the child request')
    harness.releaseFor('read-child')
    await started.child.whenIdle()
    await harness.ctx.subagents.drainChildren(testCase.parent, [started.childId])
    expect(harness.ctx.agents.get(started.childId)).toBeUndefined()

    // The native settlement notice wakes the parent in its own turn. With
    // answers held, that turn waits for a permit as well, so a release has to
    // name its session instead of waking whichever answer queued first.
    await waitFor(() => harness.heldSessions().includes(testCase.parent.id), 'the parent settlement turn')
    expect(harness.heldSessions()).not.toContain('read-child')

    await harness.ctx.subagents.sendMessage(testCase.parent, started.childId, [{ type: 'text', text: 'resume' }], {
      signal: new AbortController().signal,
    })
    const resumed = harness.ctx.agents.get(started.childId)
    if (resumed === undefined) throw new Error('the cold resume did not publish a child')
    expect(resumed).not.toBe(started.child)
    await waitFor(() => harness.requestsOf('read-child').length >= 2, 'the resumed child request')
    expect(effectiveMode(testCase, resumed)).toBe('read-only')
    expect(requestPolicy(testCase, 'read-child', 1)).toContain('read-only')
    // The resumed child's answer is released while the parent's notice turn
    // stays held: the release belongs to that child session alone.
    harness.releaseFor('read-child')
    expect(harness.heldSessions()).toContain(testCase.parent.id)
  })

  it('re-acquires the write scope when a writer is cold-resumed', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const scope = join(harness.workspace, 'writer-scope')
    await mkdir(scope, { recursive: true })
    const started = await startChild(testCase, 'write-child', 'write', scope)
    await waitFor(() => harness.requestsOf('write-child').length === 1, 'the child request')
    harness.releaseFor('write-child')
    await started.child.whenIdle()
    await harness.ctx.subagents.drainChildren(testCase.parent, [started.childId])

    // The retired writer gave its scope back only after the confirmed release.
    const during = await testCase.coordinator.acquire(testCase.parent, SessionId('other-writer'), scope)
    during.release()

    await harness.ctx.subagents.sendMessage(testCase.parent, started.childId, [{ type: 'text', text: 'resume' }], {
      signal: new AbortController().signal,
    })
    const resumed = harness.ctx.agents.get(started.childId)
    if (resumed === undefined) throw new Error('the cold resume did not publish a child')
    await waitFor(() => harness.requestsOf('write-child').length >= 2, 'the resumed child request')

    // The resumed writer owns the tree again, so a new writer is refused while
    // it is resident.
    await expect(
      testCase.coordinator.acquire(testCase.parent, SessionId('third-writer'), scope),
    ).rejects.toMatchObject({ code: 'WRITE_SCOPE_BUSY' })
    expect(effectiveMode(testCase, resumed)).toBe('workspace-write')
    harness.releaseFor('write-child')
  })

  it('refuses a new writing residency while the earlier start cleanup is unconfirmed', async () => {
    const testCase = await openCase({ hold: true })
    const { harness, coordinator } = testCase
    const scope = join(harness.workspace, 'writer-scope')
    await mkdir(scope, { recursive: true })
    const started = await startChild(testCase, 'pinned-writer', 'write', scope)
    await waitFor(() => harness.requestsOf('pinned-writer').length === 1, 'the child request')
    const root = await canonicalDirectory(harness.workspace)
    expect(coordinator.scopeOf(started.childId)).toEqual({ root, state: 'held' })

    // Explicit fault setup, not a reproduction claim: a rejected start whose
    // native rollback failed leaves exactly this state, and the public pin is
    // how the host records it. The first residency is then retired normally.
    coordinator.pin(started.childId)
    harness.releaseFor('pinned-writer')
    await started.child.whenIdle()
    await harness.ctx.subagents.drainChildren(testCase.parent, [started.childId])
    expect(harness.ctx.agents.get(started.childId)).toBeUndefined()
    // Retiring that residency is negative evidence only: the scope stays reserved.
    expect(coordinator.scopeOf(started.childId)).toEqual({ root, state: 'unconfirmed' })

    const failure = await harness.ctx.subagents
      .sendMessage(testCase.parent, started.childId, [{ type: 'text', text: 'resume' }], {
        signal: new AbortController().signal,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    // The new residency is refused before it can issue a second child turn.
    expect(failure).toBeInstanceOf(Error)
    const refusal = errorWithCode(failure, 'WRITE_SCOPE_BUSY')
    expect(refusal?.message).toContain('pinned-writer')
    expect(refusal?.message).toContain(root)
    expect(refusal?.message).toContain('unconfirmed')
    expect(harness.requestsOf('pinned-writer')).toHaveLength(1)
    expect(harness.ctx.agents.get(started.childId)).toBeUndefined()
    // The refused residency's own disposal is not cleanup proof for the old
    // writer, and another writer stays out of the tree.
    expect(coordinator.scopeOf(started.childId)).toEqual({ root, state: 'unconfirmed' })
    await expect(
      coordinator.acquire(testCase.parent, SessionId('overlapping-writer'), harness.workspace),
    ).rejects.toMatchObject({ code: 'WRITE_SCOPE_BUSY' })
  })
})

describe('the leased scope is the workspace a writer can actually write', () => {
  it('refuses a second writer in a sibling subdirectory of one granted workspace', async () => {
    const testCase = await openCase()
    const { harness, openStore } = testCase
    const left = join(harness.workspace, 'left')
    const right = join(harness.workspace, 'right')
    await mkdir(left, { recursive: true })
    await mkdir(right, { recursive: true })

    // The native fence for both children is the whole granted workspace, so a
    // writer in `right` could still mutate `left`: the two scopes overlap in
    // fact even though the requested directories differ.
    const first = await startChild(testCase, 'writer-left', 'write', left)
    expect(first.cwd).toBeTruthy()
    await expect(startChild(testCase, 'writer-right', 'write', right)).rejects.toMatchObject({
      code: 'WRITE_SCOPE_BUSY',
    })
    expect(await openStore.getChildPolicy('writer-right')).toBeUndefined()
    expect(harness.ctx.agents.get(SessionId('writer-right'))).toBeUndefined()
  })

  it('still recommends the actually granted workspace as the child workspace root', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const nested = join(harness.workspace, 'nested')
    await mkdir(nested, { recursive: true })
    const started = await startChild(testCase, 'writer-nested', 'write', nested)
    await waitFor(() => harness.requestsOf('writer-nested').length === 1, 'the child request')

    // The requested directory stays the working directory; the enforced write
    // root is the whole session workspace and is what the lease covers.
    expect(directoryKey(started.cwd)).toBe(directoryKey(await canonicalDirectory(nested)))
    expect(
      directoryKey(harness.ctx.sandboxPolicy.resolve({ session: started.child.session }).workspaceRoot),
    ).toBe(directoryKey(await canonicalDirectory(harness.workspace)))
    const lease = testCase.coordinator.acquire(testCase.parent, SessionId('other-writer'), harness.workspace)
    await expect(lease).rejects.toMatchObject({ code: 'WRITE_SCOPE_BUSY' })
    harness.releaseFor('writer-nested')
  })

  it('admits writers of two different authorized workspace roots side by side', async () => {
    const testCase = await openCase()
    const { harness, openStore } = testCase
    const mine = join(harness.workspace, 'mine')
    await mkdir(mine, { recursive: true })
    const otherRoot = join(harness.root, 'other-workspace')
    await mkdir(otherRoot, { recursive: true })
    const other = await harness.createParent('policy-parent-two', otherRoot)

    const first = await startChild(testCase, 'writer-mine', 'write', mine)
    expect(first.cwd).toBeTruthy()
    // A different authorized session owns a different granted root, so its
    // writer does not overlap mine.
    const secondRoot = harness.ctx.sandboxPolicy.resolve({ session: other.session })
    expect(directoryKey(secondRoot.workspaceRoot)).toBe(directoryKey(await canonicalDirectory(otherRoot)))
    const admission = await admitChildPolicy(
      harness.ctx,
      openStore,
      testCase.coordinator,
      { agent: other, sessionId: other.id, signal: new AbortController().signal },
      { childId: SessionId('writer-other'), cwd: otherRoot, access: 'write', maxDepth: 2, accessCeiling: 'inherit' },
    )
    expect(admission.policy.access).toBe('write')
    await admission.releaseUnstarted()
  })

  it('keeps a read-only child out of the shell path through the real confinement call', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const provider = await mountRecordingSandbox(harness.ctx)
    const subprocess = await mountSubprocessDouble(harness.ctx, { script: () => ({ exitCode: 0, stdout: 'ok' }) })
    // The shell tool owns ordinary runs through the native job registry.
    await harness.ctx.plugin(LocalJobRegistry)
    harness.register(createShellTool(harness.ctx, () => BASH_CONFIG))

    const started = await startChild(testCase, 'read-child', 'read', harness.workspace)
    await waitFor(() => harness.requestsOf('read-child').length === 1, 'the child request')
    const run = await harness.ctx.tools.execute({
      callId: ToolCallId('child-shell'),
      name: 'shell',
      arguments: { mode: 'run', command: 'echo confined', cwd: harness.workspace },
      agent: started.child,
      signal: new AbortController().signal,
    })

    expect(run.isError, `${run.error?.message ?? ''} ${JSON.stringify(run.error?.info ?? {})}`).toBe(false)
    // The child's own narrowed policy reached the native confinement call: no
    // bare unconfined spawn is possible for a read-only child.
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]?.policy.mode).toBe('read-only')
    expect(provider.calls[0]?.policy.sessionId).toBe('read-child')
    expect(provider.calls[0]?.policy.workspaceRoot).toBe(harness.workspace)
    const argv = [process.execPath, '--noprofile', '--norc', '-c', 'echo confined']
    expect(provider.calls[0]?.argv).toEqual(argv)
    expect(subprocess.spawns[0]?.argv).toEqual(['nexus-sandbox', '--', ...argv])
    harness.releaseFor('read-child')
  })
})

describe('failed native start cleanup authority', () => {
  it('releases the lease when persisting the record fails before any start', async () => {
    const testCase = await openCase()
    const { harness, openStore } = testCase
    const scope = join(harness.workspace, 'persist-failure-scope')
    await mkdir(scope, { recursive: true })
    testCase.store.failNextPut('child_policies')

    await expect(
      admitChildPolicy(
        harness.ctx,
        openStore,
        testCase.coordinator,
        { agent: testCase.parent, sessionId: testCase.parent.id, signal: new AbortController().signal },
        { childId: SessionId('persist-failure-child'), cwd: scope, access: 'write', maxDepth: 2, accessCeiling: 'inherit' },
      ),
    ).rejects.toBeDefined()
    // A reservation that never reached the store holds nothing: this is the
    // genuinely safe pre-admission failure path.
    expect(await openStore.getChildPolicy('persist-failure-child')).toBeUndefined()
    const next = await testCase.coordinator.acquire(testCase.parent, SessionId('writer-after-failure'), scope)
    next.release()
  })

  it('keeps the policy when a rejected start has no cleanup receipt', async () => {
    // Covered through the tool in `internal.test.ts` ("keeps the record and the
    // scope when a rejected start carries no cleanup receipt"); this case pins
    // the other half: a live child is never treated as released either.
    const testCase = await openCase({ hold: true })
    const { harness, openStore } = testCase
    const scope = join(harness.workspace, 'cleanup-scope')
    await mkdir(scope, { recursive: true })
    const started = await startChild(testCase, 'cleanup-child', 'write', scope)
    await waitFor(() => harness.requestsOf('cleanup-child').length === 1, 'the child request')

    expect(harness.ctx.agents.get(started.childId)).toBeDefined()
    expect(await openStore.getChildPolicy('cleanup-child')).toMatchObject({ access: 'write' })
    await expect(
      testCase.coordinator.acquire(testCase.parent, SessionId('writer-while-live'), harness.workspace),
    ).rejects.toMatchObject({ code: 'WRITE_SCOPE_BUSY' })
    harness.releaseFor('cleanup-child')
  })
})
