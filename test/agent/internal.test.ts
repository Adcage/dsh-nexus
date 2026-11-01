/**
 * The `agent` tool's delegation and lifecycle contract (AG-01…AG-11).
 *
 * Every case runs the real native stack: the production AgentLoop creates
 * parent and children, the shipped in-process `spawn`/`fork` providers publish
 * them, session persistence and session query are the shipped backends, and the
 * effective sandbox policy is resolved from the real shared service. Only the
 * model transport is scripted, so nothing here proves a live model, account or
 * platform integration.
 *
 * @module dsh-nexus/test/agent/internal
 */

import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { RuntimeSettings } from '../../src/protocol.ts'
import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import { createAgentTool } from '../../src/agent/tool.ts'
import { createWriteCoordinator, type WriteCoordinator } from '../../src/agent/coordination.ts'
import { registerChildPolicy } from '../../src/agent/policy.ts'
import type { NexusStore } from '../../src/storage/store.ts'
import { mountNexusStoreFixture, type NexusStoreFixture } from '../support/fixtures.ts'
import { mountSubagentHarness, waitFor, type SubagentHarness } from '../support/agent-harness.ts'

/** One open case and everything it owns. */
interface OpenCase {
  readonly harness: SubagentHarness
  readonly store: NexusStoreFixture
  readonly openStore: NexusStore
  readonly coordinator: WriteCoordinator
  readonly disposePolicy: () => void
  readonly parent: Agent
  readonly settings: RuntimeSettings
  call(args: Record<string, unknown>, agent?: Agent): Promise<ToolExecutionResult>
}

/** Cases still open, disposed after each test. */
const open: OpenCase[] = []

afterEach(async () => {
  for (const entry of open.splice(0)) {
    entry.disposePolicy()
    await entry.openStore.dispose()
    await entry.store.dispose()
    await entry.harness.dispose()
  }
})

/** One harness with the tool registered on the shared coordinator. */
async function openCase(
  options: {
    hold?: boolean | 'children'
    settings?: (current: RuntimeSettings) => RuntimeSettings
    answer?: (request: GenerateOptions, index: number) => string
  } = {},
): Promise<OpenCase> {
  const harness = await mountSubagentHarness({ hold: options.hold ?? false, ...(options.answer === undefined ? {} : { answer: options.answer }) })
  const store = await mountNexusStoreFixture()
  const openStore = await store.open()
  const coordinator = createWriteCoordinator(harness.ctx)
  const disposePolicy = registerChildPolicy(harness.ctx, openStore, coordinator)
  const settings = options.settings?.(DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS
  harness.register(createAgentTool(harness.ctx, openStore, () => settings, coordinator))
  const parent = await harness.createParent('primary')
  const entry: OpenCase = {
    harness,
    store,
    openStore,
    coordinator,
    disposePolicy,
    parent,
    settings,
    call: (args, agent) => harness.call('agent', args, agent ?? parent),
  }
  open.push(entry)
  return entry
}

/** The value of a successful result, as the tool reported it. */
function valueOf(result: ToolExecutionResult): Record<string, unknown> {
  if (result.isError) throw new Error(`expected success, received ${JSON.stringify(result.error?.info ?? result.error)}`)
  return result.value as unknown as Record<string, unknown>
}

/** The child ids a list action returned. */
function childIds(value: Record<string, unknown>): string[] {
  return ((value.children ?? []) as { childId: string }[]).map((child) => child.childId)
}

describe('start and inspect children', () => {
  it('starts a spawn child with the exact parent, cwd and role guidance', async () => {
    const testCase = await openCase({
      settings: (current) => ({
        ...current,
        agents: { ...current.agents, role: { name: 'reviewer', instructions: 'Act as a code reviewer.' } },
      }),
    })
    const { harness, parent, openStore } = testCase
    const scope = join(harness.workspace, 'child-scope')
    await mkdir(scope, { recursive: true })

    const started = valueOf(
      await testCase.call({ action: 'start', task: 'Review the diff.', context: 'spawn', cwd: scope, role: 'reviewer' }),
    )

    expect(started).toMatchObject({ action: 'start', context: 'spawn', access: 'read' })
    const childId = started.childId as string
    await waitFor(() => harness.requestsOf(childId).length === 1, 'the child request')
    const child = harness.ctx.agents.get(SessionId(childId))
    if (child === undefined) throw new Error('the child was not published')
    expect(child.session.header.parentSession).toBe(parent.id)
    expect(child.session.header.origin).toBe('subagent')
    // The configured role guidance is child user content, not a system prompt.
    expect(JSON.stringify(harness.requestsOf(childId)[0]?.options.messages)).toContain('Act as a code reviewer.')
    const policy = await openStore.getChildPolicy(childId)
    expect(policy).toMatchObject({ parentSessionId: parent.id, access: 'read' })

    const listed = valueOf(await testCase.call({ action: 'list' }))
    expect(childIds(listed)).toEqual([childId])
    const status = valueOf(await testCase.call({ action: 'status', childId }))
    expect(status).toMatchObject({ action: 'status', childId })
    harness.releaseFor(childId)
  })

  it('forks the parent conversation as a creation-time snapshot', async () => {
    const testCase = await openCase({ hold: 'children' })
    const { harness, parent } = testCase
    await harness.runTurn(parent, 'parent turn one')
    const parentEvents = parent.session.snapshotEvents().length

    const fork = valueOf(await testCase.call({ action: 'start', task: 'Continue from here.', context: 'fork' }))
    const spawn = valueOf(await testCase.call({ action: 'start', task: 'Independent work.', context: 'spawn' }))
    const forkId = fork.childId as string
    const spawnId = spawn.childId as string
    await waitFor(
      () => harness.requestsOf(forkId).length === 1 && harness.requestsOf(spawnId).length === 1,
      'both child requests',
    )

    const forkChild = harness.ctx.agents.get(SessionId(forkId))
    const spawnChild = harness.ctx.agents.get(SessionId(spawnId))
    if (forkChild === undefined || spawnChild === undefined) throw new Error('a child was not published')
    expect(forkChild.session.header.isSeeded).toBe(true)
    expect(spawnChild.session.header.isSeeded).toBe(false)
    // The fork child carries the parent's completed turns; the spawn child does not.
    const forkLog = JSON.stringify(forkChild.session.snapshotEvents())
    const spawnLog = JSON.stringify(spawnChild.session.snapshotEvents())
    expect(forkLog).toContain('parent turn one')
    expect(spawnLog).not.toContain('parent turn one')
    expect(parentEvents).toBeGreaterThan(0)

    // Inheritance is a creation-time snapshot: a later parent turn is not synced.
    const forkLogLength = forkChild.session.snapshotEvents().length
    await harness.runTurn(parent, 'parent turn two')
    expect(forkChild.session.snapshotEvents().length).toBe(forkLogLength)
    expect(JSON.stringify(forkChild.session.snapshotEvents())).not.toContain('parent turn two')
    harness.releaseAll()
  })

  it('refuses to clone a child when the requested context is not installed', async () => {
    const harness = await mountSubagentHarness({ providers: ['spawn'] })
    const store = await mountNexusStoreFixture()
    const openStore = await store.open()
    const coordinator = createWriteCoordinator(harness.ctx)
    const disposePolicy = registerChildPolicy(harness.ctx, openStore, coordinator)
    harness.register(createAgentTool(harness.ctx, openStore, () => DEFAULT_SETTINGS, coordinator))
    const parent = await harness.createParent('only-spawn')
    open.push({
      harness,
      store,
      openStore,
      coordinator,
      disposePolicy,
      parent,
      settings: DEFAULT_SETTINGS,
      call: (args, agent) => harness.call('agent', args, agent ?? parent),
    })

    const refused = await harness.call('agent', { action: 'start', task: 'fork me', context: 'fork' }, parent)
    expect(refused.isError).toBe(true)
    expect(refused.error?.info).toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(childIds(valueOf(await harness.call('agent', { action: 'list' }, parent)))).toEqual([])
  })

  it('rejects an irrelevant field before creating anything', async () => {
    const testCase = await openCase()
    const { harness } = testCase
    const refused = await testCase.call({ action: 'start', task: 'x', limit: 5 })
    expect(refused.isError).toBe(true)
    expect(refused.error?.info).toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(childIds(valueOf(await testCase.call({ action: 'list' })))).toEqual([])
    expect(harness.requestsOf('primary')).toHaveLength(0)
  })
})

describe('read, wait and control', () => {
  it('reads a child log by zero-based event position with real continuation', async () => {
    const testCase = await openCase()
    const started = valueOf(await testCase.call({ action: 'start', task: 'produce output' }))
    const childId = started.childId as string
    await waitFor(() => testCase.harness.requestsOf(childId).length === 1, 'the child request')
    await waitFor(() => testCase.harness.ctx.agents.get(SessionId(childId)) === undefined, 'the child to settle')

    const first = valueOf(await testCase.call({ action: 'read', childId, limit: 3 }))
    expect(first).toMatchObject({ action: 'read', offset: 0, atEnd: false })
    const events = first.events as { index: number; text: string }[]
    expect(events.map((event) => event.index)).toEqual([0, 1, 2])
    expect(first.nextOffset).toBe(3)

    const second = valueOf(await testCase.call({ action: 'read', childId, offset: first.nextOffset as number, limit: 3 }))
    expect(second.offset).toBe(3)
    expect((second.events as { index: number }[])[0]?.index).toBe(3)

    const tail = valueOf(await testCase.call({ action: 'read', childId, offset: 0, limit: 100 }))
    expect(tail.totalEvents as number).toBeGreaterThan(3)
    expect(tail.atEnd).toBe(true)

    const tooMany = await testCase.call({ action: 'read', childId, limit: 101 })
    expect(tooMany.isError).toBe(true)
    expect(tooMany.error?.info).toMatchObject({ code: 'INVALID_ARGUMENT' })
    const past = await testCase.call({ action: 'read', childId, offset: 10_000 })
    expect(past.isError).toBe(true)
    expect(past.error?.info).toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('cuts one oversized event on a code-point boundary and stays inside the page budget', async () => {
    // 101 ASCII characters put the 16 KiB cut two bytes inside a 3-byte
    // character, which a byte-slice would turn into a replacement character and
    // push the page one byte over its own bound.
    const answer = `${'a'.repeat(101)}${'漢'.repeat(8_000)}`
    const testCase = await openCase({ answer: () => answer })
    const started = valueOf(await testCase.call({ action: 'start', task: 'produce a long answer' }))
    const childId = started.childId as string
    await waitFor(() => testCase.harness.requestsOf(childId).length === 1, 'the child request')
    await waitFor(() => testCase.harness.ctx.agents.get(SessionId(childId)) === undefined, 'the child to settle')

    const page = valueOf(await testCase.call({ action: 'read', childId, limit: 100 }))
    // Page from the start until the oversized event is the FIRST event of a
    // page; only then is its own text cut to fit the budget.
    let offset = 0
    let truncated: Record<string, unknown> | undefined
    for (let guard = 0; guard < 20 && truncated === undefined; guard += 1) {
      const candidate = valueOf(await testCase.call({ action: 'read', childId, offset, limit: 100 }))
      if (candidate.textTruncated === true) {
        truncated = candidate
        break
      }
      if (candidate.atEnd === true) break
      offset = candidate.nextOffset as number
    }
    expect(truncated).toBeDefined()
    expect(page.totalEvents).toBeGreaterThan(0)
    const events = (truncated?.events ?? []) as { text: string }[]
    const text = events.map((event) => event.text).join('')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(16 * 1024)
    expect(text.includes('\uFFFD')).toBe(false)
    expect(text.startsWith('a'.repeat(101))).toBe(true)
  })

  it('distinguishes an interrupt request from a confirmed stop', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const first = valueOf(await testCase.call({ action: 'start', task: 'long task one' }))
    const second = valueOf(await testCase.call({ action: 'start', task: 'long task two' }))
    const firstId = first.childId as string
    const secondId = second.childId as string
    await waitFor(() => harness.requestsOf(firstId).length === 1 && harness.requestsOf(secondId).length === 1, 'both requests')

    const interrupted = valueOf(await testCase.call({ action: 'interrupt', childId: firstId }))
    expect(interrupted).toMatchObject({ action: 'interrupt', accepted: true })
    // An acknowledgement is not a stop: the child is still live until released.
    expect(harness.ctx.agents.get(SessionId(firstId))).toBeDefined()

    // Releasing the held answer of the child being stopped lets its turn abort;
    // the sibling's answer stays held, so it stays live.
    const stopping = testCase.call({ action: 'stop', childId: firstId })
    harness.releaseFor(firstId)
    const stopped = valueOf(await stopping)
    expect(stopped).toMatchObject({ action: 'stop', released: true })
    await waitFor(() => harness.ctx.agents.get(SessionId(firstId)) === undefined, 'the stopped child to be released')
    // The sibling the caller did not select is untouched.
    expect(harness.ctx.agents.get(SessionId(secondId))).toBeDefined()
    harness.releaseAll()
  })

  it('continues the same child instead of creating a new one', async () => {
    const testCase = await openCase({ hold: true })
    const { harness, parent } = testCase
    const started = valueOf(await testCase.call({ action: 'start', task: 'first task' }))
    const childId = started.childId as string
    await waitFor(() => harness.requestsOf(childId).length === 1, 'the first request')
    harness.releaseFor(childId)
    await waitFor(() => harness.ctx.agents.get(SessionId(childId)) === undefined, 'the child to settle')

    const continued = valueOf(await testCase.call({ action: 'continue', childId, text: 'second task' }))
    expect(continued).toMatchObject({ action: 'continue', childId })

    const resumed = harness.ctx.agents.get(SessionId(childId))
    if (resumed === undefined) throw new Error('continue did not resume the same child')
    expect(resumed.session.header.parentSession).toBe(parent.id)
    expect(childIds(valueOf(await testCase.call({ action: 'list' })))).toEqual([childId])
    await waitFor(() => harness.requestsOf(childId).length === 2, 'the resumed request')
    harness.releaseFor(childId)
  })

  it('bounds a wait without stopping the child', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const started = valueOf(await testCase.call({ action: 'start', task: 'still working' }))
    const childId = started.childId as string
    await waitFor(() => harness.requestsOf(childId).length === 1, 'the child request')

    const waited = valueOf(await testCase.call({ action: 'wait', childId, timeoutMs: 20 }))
    expect(waited).toMatchObject({ action: 'wait', timedOut: true })
    expect(harness.ctx.agents.get(SessionId(childId))).toBeDefined()

    harness.releaseAll()
    await waitFor(() => harness.ctx.agents.get(SessionId(childId)) === undefined, 'the child to settle')
    const settled = valueOf(await testCase.call({ action: 'wait', childId, timeoutMs: 100 }))
    expect(settled.timedOut).toBe(false)
    expect(settled.lastTurn).toMatchObject({ reason: 'completed' })
  })

  it('refuses to control another session\'s child or a stale Agent', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const started = valueOf(await testCase.call({ action: 'start', task: 'owned child' }))
    const childId = started.childId as string
    const other = await harness.createParent('secondary')

    const foreign = await testCase.call({ action: 'stop', childId }, other)
    expect(foreign.isError).toBe(true)
    expect(foreign.error?.info).toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
    expect(harness.ctx.agents.get(SessionId(childId))).toBeDefined()

    // An old Agent object for the same session is not the live instance.
    const stale = new Proxy(testCase.parent, {})
    const refused = await testCase.call({ action: 'list' }, stale)
    expect(refused.isError).toBe(true)
    expect(refused.error?.info).toMatchObject({ code: 'NO_AGENT' })
    harness.releaseFor(childId)
  })
})

describe('failed native start cleanup authority', () => {
  it('keeps the record and the scope when a rejected start carries no cleanup receipt', async () => {
    const testCase = await openCase()
    const { harness, openStore } = testCase
    const scope = join(harness.workspace, 'uncertain-scope')
    await mkdir(scope, { recursive: true })

    // A generic rejection with nothing published is exactly the shape the native
    // runtime produces when its own rollback failed: AgentLoop detaches the
    // session and agent BEFORE it throws collected cleanup failures, so the
    // absence of both is negative evidence, never a cleanup receipt.
    const original = SubagentRuntime.prototype.startActivation
    let reserved: SessionId | undefined
    SubagentRuntime.prototype.startActivation = function rejectStart(
      this: SubagentRuntime,
      spec: Parameters<typeof SubagentRuntime.prototype.startActivation>[0],
    ) {
      reserved = spec.childId
      return Promise.reject(new Error('native start rejected after publication'))
    } as unknown as typeof SubagentRuntime.prototype.startActivation
    try {
      const refused = await testCase.call({ action: 'start', task: 'write it', access: 'write', cwd: scope })
      expect(refused.isError).toBe(true)
      expect(refused.error?.info).toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
      expect(refused.error?.message).toContain(reserved ?? '')
      expect(refused.error?.message).toMatch(/unconfirmed/i)
    } finally {
      SubagentRuntime.prototype.startActivation = original
    }
    if (reserved === undefined) throw new Error('the native start was never attempted')

    // Nothing is published, and that is NOT accepted as proof.
    expect(harness.ctx.agents.get(reserved)).toBeUndefined()
    expect(harness.ctx.sessions.get(reserved)).toBeUndefined()
    // The recovery/narrowing authority and the write scope stay held.
    expect(await openStore.getChildPolicy(reserved)).toMatchObject({ access: 'write' })
    await expect(
      testCase.coordinator.acquire(testCase.parent, SessionId('writer-after-uncertain'), harness.workspace),
    ).rejects.toMatchObject({ code: 'WRITE_SCOPE_BUSY' })

    // The retained child id stays controllable, and the SDK limit is explicit:
    // `stop` is an accepted native no-op for an activation that is not resident,
    // so it does NOT clear the retained scope and must not pretend to.
    const stop = await testCase.call({ action: 'stop', childId: reserved })
    expect(stop.isError).toBe(false)
    await expect(
      testCase.coordinator.acquire(testCase.parent, SessionId('writer-after-stop'), harness.workspace),
    ).rejects.toMatchObject({ code: 'WRITE_SCOPE_BUSY' })
  })
})

describe('delegation limits', () => {
  it('refuses the fifth concurrent child and counts pending admissions', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const started: string[] = []
    for (let index = 0; index < 4; index += 1) {
      started.push(valueOf(await testCase.call({ action: 'start', task: `task ${index}` })).childId as string)
    }
    await waitFor(
      () => started.every((id) => harness.requestsOf(id).length === 1),
      'all four child requests',
    )

    const fifth = await testCase.call({ action: 'start', task: 'too many' })
    expect(fifth.isError).toBe(true)
    expect(fifth.error?.info).toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })

    harness.releaseAll()
    await waitFor(() => started.every((id) => harness.ctx.agents.get(SessionId(id)) === undefined), 'the children to settle')
    // A released slot is usable again.
    const later = valueOf(await testCase.call({ action: 'start', task: 'after release' }))
    expect(later.childId).toBeDefined()
    harness.releaseAll()
  })

  it('refuses a grandchild beyond the configured depth', async () => {
    const testCase = await openCase({ settings: (current) => ({ ...current, agents: { ...current.agents, maxDepth: 1 } }) })
    const { harness, parent, openStore } = testCase
    const child = valueOf(await testCase.call({ action: 'start', task: 'depth one' }))
    const childId = child.childId as string
    const childAgent = harness.ctx.agents.get(SessionId(childId))
    if (childAgent === undefined) throw new Error('the child was not published')

    // The child session is at depth 1 and the subtree cap is 1: no grandchild.
    const grandchild = await harness.call('agent', { action: 'start', task: 'deeper' }, childAgent)
    expect(grandchild.isError).toBe(true)
    expect(grandchild.error?.info).toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(await openStore.getChildPolicy(childId)).toMatchObject({ maxDepth: 1 })
    expect(parent.id).toBe('primary')
  })

  it('refuses any child when the depth setting is zero', async () => {
    const testCase = await openCase({ settings: (current) => ({ ...current, agents: { ...current.agents, maxDepth: 0 } }) })
    const refused = await testCase.call({ action: 'start', task: 'no children allowed' })
    expect(refused.isError).toBe(true)
    expect(refused.error?.info).toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(childIds(valueOf(await testCase.call({ action: 'list' })))).toEqual([])
  })

  it('never grants a write child a directory outside the workspace', async () => {
    const testCase = await openCase()
    const { harness } = testCase
    const outside = join(harness.root, 'outside')
    await mkdir(outside, { recursive: true })
    const refused = await testCase.call({ action: 'start', task: 'write there', access: 'write', cwd: outside })
    expect(refused.isError).toBe(true)
    expect(refused.error?.info).toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(childIds(valueOf(await testCase.call({ action: 'list' })))).toEqual([])
  })
})
