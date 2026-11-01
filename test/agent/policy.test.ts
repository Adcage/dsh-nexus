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
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { NexusStore } from '../../src/storage/store.ts'
import { admitChildPolicy, registerChildPolicy, type ChildAccess } from '../../src/agent/policy.ts'
import { createWriteCoordinator, directoryKey, type WriteCoordinator } from '../../src/agent/coordination.ts'
import { createFsTools } from '../../src/fs/read.ts'
import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import { mountNexusStoreFixture, type NexusStoreFixture } from '../support/fixtures.ts'
import { mountSubagentHarness, waitFor, type SubagentHarness } from '../support/agent-harness.ts'

/** Everything one case owns, disposed after it. */
interface OpenCase {
  readonly harness: SubagentHarness
  readonly store: NexusStoreFixture
  readonly openStore: NexusStore
  readonly coordinator: WriteCoordinator
  readonly disposePolicy: () => void
  readonly parent: Agent
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
async function openCase(options: { mode?: SandboxMode; hold?: boolean } = {}): Promise<OpenCase> {
  const harness = await mountSubagentHarness({ mode: options.mode ?? 'workspace-write', hold: options.hold ?? false })
  const store = await mountNexusStoreFixture()
  const openStore = await store.open()
  const coordinator = createWriteCoordinator(harness.ctx)
  const disposePolicy = registerChildPolicy(harness.ctx, openStore, coordinator)
  const parent = await harness.createParent('policy-parent')
  for (const tool of createFsTools(harness.ctx, () => DEFAULT_SETTINGS)) harness.ctx.tools.register(tool)
  const entry: OpenCase = { harness, store, openStore, coordinator, disposePolicy, parent }
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
    { childId: SessionId(childId), cwd, access, maxDepth: extra.maxDepth ?? 2 },
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
    await admission.abandon()
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
  return JSON.stringify(request.options.messages).match(/Current DSH file policy: [a-z-]+/)?.[0]
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
    harness.release()
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
    harness.release()
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
        { childId: SessionId('escape-child'), cwd: outside, access: 'write', maxDepth: 2 },
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
        { childId: SessionId('alias-child'), cwd: alias, access: 'write', maxDepth: 2 },
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
        { childId: SessionId('expanding-child'), cwd: harness.workspace, access: 'write', maxDepth: 2 },
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
        { childId: SessionId('no-policy-child'), cwd: harness.workspace, access: 'read', maxDepth: 2 },
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
      { childId: SessionId('failing-child'), cwd: scope, access: 'write', maxDepth: 2 },
    )
    await expect(
      harness.ctx.subagents.startActivation({
        provider: 'missing-provider',
        label: 'failing',
        childId: SessionId('failing-child'),
        request: { prompt: [{ type: 'text', text: 'never runs' }], parent, cwd: admission.policy.cwd },
        signal: new AbortController().signal,
        delivery: 'parent',
      }),
    ).rejects.toBeDefined()
    await admission.abandon()

    expect(await openStore.getChildPolicy('failing-child')).toBeUndefined()
    // The tree is free again for the next writer.
    const retry = await testCase.coordinator.acquire(parent, SessionId('retry-child'), scope)
    retry.release()
  })
})

describe('policy revalidation beyond creation', () => {
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
    harness.release()
    await waitFor(() => harness.requestsOf('read-child').length >= 2, 'the second child request')

    // The second request itself carried the narrowed policy, so the widening
    // never reached the model.
    expect(requestPolicy(testCase, 'read-child', 1)).toContain('read-only')
    expect(effectiveMode(testCase, started.child)).toBe('read-only')
    harness.release()
  })

  it('keeps a read-only child read-only after a cold resume', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const started = await startChild(testCase, 'read-child', 'read', harness.workspace)
    await waitFor(() => harness.requestsOf('read-child').length === 1, 'the child request')
    harness.release()
    await started.child.whenIdle()
    await harness.ctx.subagents.drainChildren(testCase.parent, [started.childId])
    expect(harness.ctx.agents.get(started.childId)).toBeUndefined()

    await harness.ctx.subagents.sendMessage(testCase.parent, started.childId, [{ type: 'text', text: 'resume' }], {
      signal: new AbortController().signal,
    })
    const resumed = harness.ctx.agents.get(started.childId)
    if (resumed === undefined) throw new Error('the cold resume did not publish a child')
    expect(resumed).not.toBe(started.child)
    await waitFor(() => harness.requestsOf('read-child').length >= 2, 'the resumed child request')
    expect(effectiveMode(testCase, resumed)).toBe('read-only')
    expect(requestPolicy(testCase, 'read-child', 1)).toContain('read-only')
    harness.release()
  })

  it('re-acquires the write scope when a writer is cold-resumed', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const scope = join(harness.workspace, 'writer-scope')
    await mkdir(scope, { recursive: true })
    const started = await startChild(testCase, 'write-child', 'write', scope)
    await waitFor(() => harness.requestsOf('write-child').length === 1, 'the child request')
    harness.release()
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
    harness.release()
  })
})
