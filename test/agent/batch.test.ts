/**
 * Batch delegation: bounds, ordering, isolation and cancellation (AG-06).
 *
 * A batch keeps the caller's input order and reports one result per item. Each
 * item is a genuine native child; a failed item never discards the others.
 * `sequence` runs one item to its native settlement and confirmed release
 * before the next starts, so two writers over one tree do not collide, while
 * `parallel` reports the second overlapping writer as that item's own failure.
 *
 * @module dsh-nexus/test/agent/batch
 */

import { getEventListeners } from 'node:events'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { SubagentError, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { DEFAULT_SETTINGS, WAIT_MAX_MS } from '../../src/runtime/defaults.ts'
import { createAgentTool } from '../../src/agent/tool.ts'
import { createWriteCoordinator } from '../../src/agent/coordination.ts'
import { registerChildPolicy } from '../../src/agent/policy.ts'
import { mountNexusStoreFixture, type NexusStoreFixture } from '../support/fixtures.ts'
import { mountSubagentHarness, waitFor, type SubagentHarness } from '../support/agent-harness.ts'

/** One open batch case. */
interface OpenCase {
  readonly harness: SubagentHarness
  readonly store: NexusStoreFixture
  readonly parent: Agent
  /**
   * Original tool bodies, in call order. The registry reports native
   * cancellation on its own, so the body's own completion is observed through
   * a transparent wrapper around the real definition's `execute`.
   */
  readonly bodies: Promise<void>[]
  call(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolExecutionResult>
}

/** Harnesses still open, disposed after each test. */
const open: { harness: SubagentHarness; store: NexusStoreFixture; disposePolicy: () => void; disposeStore: () => Promise<void> }[] =
  []

afterEach(async () => {
  for (const entry of open.splice(0)) {
    entry.disposePolicy()
    await entry.disposeStore()
    await entry.store.dispose()
    await entry.harness.dispose()
  }
})

/** Mount one harness with the tool registered on a shared coordinator. */
async function openCase(options: { hold?: boolean | 'children' } = {}): Promise<OpenCase> {
  const harness = await mountSubagentHarness({ hold: options.hold ?? false })
  const store = await mountNexusStoreFixture()
  const openStore = await store.open()
  const coordinator = createWriteCoordinator(harness.ctx)
  const disposePolicy = registerChildPolicy(harness.ctx, openStore, coordinator)
  const definition = createAgentTool(harness.ctx, openStore, () => DEFAULT_SETTINGS, coordinator)
  const bodies: Promise<void>[] = []
  harness.register({
    ...definition,
    execute(args, exec) {
      const body = definition.execute(args, exec)
      bodies.push(body.then(
        () => undefined,
        () => undefined,
      ))
      return body
    },
  })
  const parent = await harness.createParent('batch-primary')
  let callCount = 0
  open.push({ harness, store, disposePolicy, disposeStore: () => openStore.dispose() })
  return {
    harness,
    store,
    parent,
    bodies,
    call: (args, signal) =>
      harness.ctx.tools.execute({
        callId: ToolCallId(`batch-call-${callCount++}`),
        name: 'agent',
        arguments: args,
        agent: parent,
        signal: signal ?? new AbortController().signal,
      }),
  }
}

/** The value of a successful result. */
function valueOf(result: ToolExecutionResult): Record<string, unknown> {
  if (result.isError) throw new Error(`expected success, received ${JSON.stringify(result.error?.info ?? result.error)}`)
  return result.value as unknown as Record<string, unknown>
}

/** One batch item as the tool reported it. */
interface ItemRow {
  readonly index: number
  readonly ok: boolean
  readonly childId?: string
  readonly code?: string
  readonly message?: string
}

/** The ordered items of a batch value. */
function itemsOf(value: Record<string, unknown>): ItemRow[] {
  return value.items as ItemRow[]
}

describe('batch bounds and ordering', () => {
  it('refuses more than eight tasks before starting any child', async () => {
    const testCase = await openCase()
    const tasks = Array.from({ length: 9 }, (_, index) => ({ task: `task ${index}` }))
    const refused = await testCase.call({ action: 'batch', tasks })
    expect(refused.isError).toBe(true)
    expect(refused.error?.info).toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(testCase.harness.requests).toHaveLength(0)
    expect(valueOf(await testCase.call({ action: 'list' })).children).toEqual([])
  })

  it('rejects a batch task field that start does not accept', async () => {
    const testCase = await openCase()
    const refused = await testCase.call({ action: 'batch', tasks: [{ task: 'ok', childId: 'nope' }] })
    // The native closed item schema refuses the field before any child exists.
    expect(refused.isError).toBe(true)
    expect(refused.value).toBeUndefined()
    expect(valueOf(await testCase.call({ action: 'list' })).children).toEqual([])
    expect(testCase.harness.requests).toHaveLength(0)
  })

  it('reports one ordered result per parallel item, including a failed item', async () => {
    const testCase = await openCase()
    const { harness } = testCase
    const outside = join(harness.root, 'outside-batch')
    await mkdir(outside, { recursive: true })
    const value = valueOf(
      await testCase.call({
        action: 'batch',
        mode: 'parallel',
        tasks: [
          { task: 'first', context: 'spawn' },
          { task: 'second', context: 'fork' },
          { task: 'escapes', access: 'write', cwd: outside },
        ],
      }),
    )

    const items = itemsOf(value)
    expect(items.map((item) => item.index)).toEqual([0, 1, 2])
    expect(items[0]?.ok).toBe(true)
    expect(items[1]?.ok).toBe(true)
    expect(items[2]?.ok).toBe(false)
    expect(items[2]?.code).toBe('INVALID_ARGUMENT')
    // Every accepted item is a real native child, not a placeholder.
    const listed = valueOf(await testCase.call({ action: 'list' }))
    const ids = (listed.children as { childId: string }[]).map((child) => child.childId)
    expect(ids).toContain(items[0]?.childId)
    expect(ids).toContain(items[1]?.childId)
    expect(ids).toHaveLength(2)
    harness.releaseAll()
  })

  it('reports items beyond the concurrency limit as their own failures', async () => {
    const testCase = await openCase({ hold: true })
    const { harness } = testCase
    const tasks = Array.from({ length: 6 }, (_, index) => ({ task: `task ${index}` }))
    const value = valueOf(await testCase.call({ action: 'batch', mode: 'parallel', tasks }))

    const items = itemsOf(value)
    expect(items).toHaveLength(6)
    expect(items.filter((item) => item.ok)).toHaveLength(4)
    const failures = items.filter((item) => !item.ok)
    expect(failures).toHaveLength(2)
    for (const failure of failures) expect(failure.code).toBe('RESOURCE_NOT_AVAILABLE')
    harness.releaseAll()
  })
})

describe('parallel versus sequence write coordination', () => {
  it('refuses the second parallel writer of one tree but runs both in sequence', async () => {
    const testCase = await openCase()
    const { harness } = testCase
    const scope = join(harness.workspace, 'shared-scope')
    await mkdir(scope, { recursive: true })
    const tasks = [
      { task: 'write left', access: 'write', cwd: scope },
      { task: 'write right', access: 'write', cwd: scope },
    ]

    const parallel = itemsOf(valueOf(await testCase.call({ action: 'batch', mode: 'parallel', tasks })))
    expect(parallel[0]?.ok).toBe(true)
    expect(parallel[1]?.ok).toBe(false)
    expect(parallel[1]?.code).toBe('WRITE_SCOPE_BUSY')
    // The accepted writer keeps its scope only until the native release.
    await waitFor(
      () => harness.ctx.agents.get(SessionId(parallel[0]?.childId ?? '')) === undefined,
      'the parallel writer release',
    )

    // The refused item left no child behind, so the sequence batch starts clean.
    const sequence = itemsOf(valueOf(await testCase.call({ action: 'batch', mode: 'sequence', tasks })))
    expect(sequence.map((item) => item.ok)).toEqual([true, true])
    // Each sequence item was released before the next started: one writer at a time.
    expect(sequence[0]?.childId).not.toBe(sequence[1]?.childId)
  })

  it('runs sequence items one at a time and confirms each release', async () => {
    const testCase = await openCase({ hold: 'children' })
    const { harness } = testCase
    const batch = testCase.call({
      action: 'batch',
      mode: 'sequence',
      tasks: [{ task: 'first' }, { task: 'second' }],
    })
    const childRequests = () =>
      harness.requests.filter((request) => request.options.sessionId !== testCase.parent.id)

    // The second item starts only after the first child settled and was
    // released, so the two children never overlap.
    await waitFor(() => childRequests().length === 1, 'the first sequence request')
    const firstSession = childRequests()[0]?.options.sessionId
    harness.releaseFor(firstSession ?? '')
    await waitFor(() => childRequests().length === 2, 'the second sequence request')
    const secondSession = childRequests()[1]?.options.sessionId
    expect(firstSession).not.toBe(secondSession)
    harness.releaseAll()

    const items = itemsOf(valueOf(await batch))
    expect(items.map((item) => item.ok)).toEqual([true, true])
    expect(items[0]?.childId).toBe(firstSession)
    expect(items[1]?.childId).toBe(secondSession)
  })

  it('ends the batch coroutine on caller abort without releasing the accepted child', async () => {
    const testCase = await openCase({ hold: 'children' })
    const { harness, parent } = testCase
    const abort = new AbortController()
    const listenersBefore = getEventListeners(abort.signal, 'abort').length
    const childRequests = () =>
      harness.requests.filter((request) => request.options.sessionId !== parent.id)

    const batch = testCase.call(
      {
        action: 'batch',
        mode: 'sequence',
        tasks: [{ task: 'first' }, { task: 'second' }, { task: 'third' }],
      },
      abort.signal,
    )
    await waitFor(() => childRequests().length === 1, 'the first batch child request')
    const firstId = childRequests()[0]?.options.sessionId ?? ''
    expect(testCase.bodies).toHaveLength(1)

    // The caller cancels while item 0 is still running and its answer is NEVER
    // released: the batch coroutine must finish on its own, not stay parked on
    // an activation whose accepted lifetime is detached from the start signal.
    abort.abort()
    const bodyOutcome = await Promise.race([
      testCase.bodies[0]?.then(() => 'finished'),
      new Promise((resolve) => setTimeout(() => resolve('parked'), 2_000)),
    ])
    expect(bodyOutcome).toBe('finished')

    const result = await batch
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ code: 'ABORTED' })
    // The accepted child is a real, discoverable native child that was never
    // stopped or released by this cancellation.
    expect(harness.heldSessions()).toContain(firstId)
    expect(harness.ctx.agents.get(SessionId(firstId))).toBeDefined()
    const listed = valueOf(await harness.call('agent', { action: 'list' }, parent))
    expect((listed.children as { childId: string }[]).map((child) => child.childId)).toContain(firstId)
    // No later item was admitted.
    expect(childRequests()).toHaveLength(1)
    // Its write scope stays held by that child, not released by the abort.
    const scope = await harness.call('agent', { action: 'status', childId: firstId }, parent)
    expect(scope.isError).toBe(false)
    expect((scope.value as unknown as { access?: string }).access).toBe('read')
    // The abort listener the batch added was removed again.
    expect(getEventListeners(abort.signal, 'abort').length).toBe(listenersBefore)
    harness.releaseAll()
  })

  it('starts no further item after the caller cancels', async () => {
    const testCase = await openCase({ hold: 'children' })
    const { harness } = testCase
    const abort = new AbortController()
    const batch = testCase.call(
      {
        action: 'batch',
        mode: 'sequence',
        tasks: [{ task: 'first' }, { task: 'second' }, { task: 'third' }],
      },
      abort.signal,
    )
    await waitFor(() => harness.requests.length === 1, 'the first batch child request')
    const firstSession = harness.requests[0]?.options.sessionId
    abort.abort()
    harness.releaseAll()

    // The registry reports native cancellation; the tool never claims success.
    const result = await batch
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ code: 'ABORTED' })
    expect(result.value).toBeUndefined()
    // The already-accepted child is a real native child, and no later item started.
    const childSessions = harness.requests
      .map((request) => request.options.sessionId)
      .filter((sessionId) => sessionId !== testCase.parent.id)
    expect(childSessions).toEqual([firstSession])
    const listed = valueOf(await testCase.call({ action: 'list' }))
    expect((listed.children as { childId: string }[]).map((child) => child.childId)).toContain(firstSession)
  })

  it('waits for the item\'s own settlement and schedules no wait slice', async () => {
    const testCase = await openCase({ hold: 'children' })
    const { harness } = testCase
    const childRequests = () =>
      harness.requests.filter((request) => request.options.sessionId !== testCase.parent.id)

    // A sequence item is running while its answer is held. A fixed wait slice
    // would show up as one long timer; the settled-answer path schedules none.
    const spy = vi.spyOn(globalThis, 'setTimeout')
    try {
      const batch = testCase.call({
        action: 'batch',
        mode: 'sequence',
        tasks: [{ task: 'first' }, { task: 'second' }],
      })
      await waitFor(() => childRequests().length === 1, 'the first sequence request')
      const firstId = childRequests()[0]?.options.sessionId ?? ''
      // The item is genuinely still running, and nothing else was started.
      expect(harness.ctx.agents.get(SessionId(firstId))?.status).toBe('running')
      expect(childRequests()).toHaveLength(1)

      harness.releaseFor(firstId)
      await waitFor(() => childRequests().length === 2, 'the second sequence item to start')
      harness.releaseAll()

      const items = itemsOf(valueOf(await batch))
      expect(items.map((item) => item.ok)).toEqual([true, true])
      expect(childRequests()[0]?.options.sessionId).toBe(firstId)
      // No 30 s wait slice: the batch waited for the run itself.
      const longTimers = spy.mock.calls
        .map((call) => call[1])
        .filter((delay): delay is number => typeof delay === 'number' && delay >= 1_000)
      expect(longTimers).not.toContain(WAIT_MAX_MS)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not start the next item when the selected child could not be released', async () => {
    const testCase = await openCase({ hold: 'children' })
    const { harness } = testCase
    const original = SubagentRuntime.prototype.drainChildren
    SubagentRuntime.prototype.drainChildren = function refuseDrain(): Promise<void> {
      return Promise.reject(new SubagentError('simulated teardown failure for the selected child', 'ACTIVATION_TEARDOWN_FAILED'))
    }
    try {
      const batch = testCase.call({
        action: 'batch',
        mode: 'sequence',
        tasks: [{ task: 'first' }, { task: 'second' }],
      })
      const childRequests = () =>
        harness.requests.filter((request) => request.options.sessionId !== testCase.parent.id)
      await waitFor(() => childRequests().length === 1, 'the first sequence request')
      const firstId = childRequests()[0]?.options.sessionId ?? ''
      harness.releaseFor(firstId)
      harness.releaseAll()
      const items = itemsOf(valueOf(await batch))

      // The run finished but the release is unconfirmed: the item says so and no
      // following item may start over a possibly live writer.
      expect(items[0]).toMatchObject({ index: 0, ok: false, code: 'ACTIVATION_TEARDOWN_FAILED', childId: firstId })
      expect(items[1]).toMatchObject({ index: 1, ok: false })
      expect(items[1]?.code).toBe('RESOURCE_NOT_AVAILABLE')
      expect(childRequests()).toHaveLength(1)
    } finally {
      SubagentRuntime.prototype.drainChildren = original
    }
  })
})
