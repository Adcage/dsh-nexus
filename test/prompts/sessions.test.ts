/**
 * Durable per-session prompt snapshots: what a session is actually running with.
 *
 * The cases drive the real Nexus store over the shipped JSON medium (including
 * its refusal seam) and real production Agents from the native AgentLoop. They
 * prove the properties the request path relies on: a snapshot keeps the actual
 * bodies it was assembled from, a library edit or a changed default never
 * rewrites an existing session, `apply` persists a complete capture BEFORE it
 * publishes one immutable reference, and a replaced Agent for the same session
 * id can never inherit an older Agent's in-memory state.
 *
 * @module dsh-nexus/test/prompts/sessions
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PromptLibrary, PromptModule, PromptSnapshot } from '../../src/protocol.ts'
import { composePromptText } from '../../src/prompts/assemble.ts'
import { createPromptSessions, type PromptSessions } from '../../src/prompts/sessions.ts'
import { PROMPTS_TABLE } from '../../src/storage/domain.ts'
import type { NexusStore, Stored } from '../../src/storage/store.ts'
import { mountNexusStoreFixture, type NexusStoreFixture } from '../support/fixtures.ts'
import { mountSubagentHarness, type SubagentHarness } from '../support/agent-harness.ts'

/** One open case and everything it owns. */
interface OpenCase {
  readonly harness: SubagentHarness
  readonly fixture: NexusStoreFixture
  readonly store: NexusStore
  readonly sessions: PromptSessions
  /** Create one production Agent on the scripted route. */
  createAgent(id: string): Promise<AgentHandle>
  /** Create one production child Agent owned by `parent`. */
  createChild(parent: Agent, id: string): Promise<AgentHandle>
  /** Replace the library record with `value`, presenting the current hash. */
  saveLibrary(value: PromptLibrary): Promise<Stored<PromptLibrary>>
  /** Dispose the Agent handle so its session id can be reused. */
  disposeAgent(handle: AgentHandle): Promise<void>
}

/** Cases still open, disposed after each test. */
const open: { readonly openCase: OpenCase; readonly agents: AgentHandle[] }[] = []

afterEach(async () => {
  for (const entry of open.splice(0)) {
    for (const handle of entry.agents.splice(0)) await handle.dispose().catch(() => undefined)
    await entry.openCase.store.dispose().catch(() => undefined)
    await entry.openCase.fixture.dispose().catch(() => undefined)
    await entry.openCase.harness.dispose().catch(() => undefined)
  }
})

/**
 * Mount the native composition, the durable store and one prompt-session state.
 * @param library - library saved before the case starts.
 * @returns the open case.
 */
async function openPromptCase(library: PromptLibrary = { modules: [], defaultSelection: [] }): Promise<OpenCase> {
  const harness = await mountSubagentHarness()
  const fixture = await mountNexusStoreFixture()
  const store = await fixture.open()
  const sessions = createPromptSessions(harness.ctx, store)
  const agents: AgentHandle[] = []
  const current = await store.readLibrary()
  await store.saveLibrary(library, current.hash)
  const openCase: OpenCase = {
    harness,
    fixture,
    store,
    sessions,
    async createAgent(id) {
      const handle = await harness.ctx.agents.create({
        sessionId: SessionId(id),
        agentOptions: { provider: 'nexus-test', model: 'nexus-test-model' },
        meta: { cwd: harness.workspace },
      })
      agents.push(handle)
      return handle
    },
    async createChild(parent, id) {
      const handle = await harness.ctx.agents.create({
        sessionId: SessionId(id),
        parentAgent: parent,
        agentOptions: { provider: 'nexus-test', model: 'nexus-test-model' },
        meta: { cwd: harness.workspace, parentSession: parent.session.id, origin: 'subagent', delegationDepth: 1 },
      })
      agents.push(handle)
      return handle
    },
    saveLibrary(value) {
      return store.readLibrary().then((stored) => store.saveLibrary(value, stored.hash))
    },
    async disposeAgent(handle) {
      await handle.dispose()
    },
  }
  open.push({ openCase, agents })
  return openCase
}

/** One prompt module. */
function moduleOf(id: string, body: string): PromptModule {
  return { id, name: `${id} name`, body }
}

/**
 * Read the Nexus error code a call refuses with.
 * @param run - call expected to throw.
 * @returns the code, or `undefined` when the call returned normally.
 */
function failureCode(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return (error as { code?: unknown }).code
  }
  return undefined
}

/**
 * Wrap one real store with a gate in front of its prompt writes, so a case can
 * hold a durable write open and observe ordering. Every other member is the
 * real store's own method; the gate only decides WHEN one write proceeds.
 * @param target - the real store.
 * @returns the wrapped store plus the gate controls.
 */
function gatePromptWrites(target: NexusStore): {
  readonly store: NexusStore
  holdNextPut(): void
  waitUntilHeld(): Promise<void>
  release(): void
} {
  let armed = false
  let announceHeld: (() => void) | undefined
  let openGate: (() => void) | undefined
  const store = new Proxy(target, {
    get(object, property, receiver) {
      if (property === 'putPrompt') {
        return async (value: PromptSnapshot): Promise<void> => {
          if (armed) {
            armed = false
            await new Promise<void>((resolve) => {
              openGate = resolve
              announceHeld?.()
              announceHeld = undefined
            })
          }
          await target.putPrompt(value)
        }
      }
      const member = Reflect.get(object, property, receiver) as unknown
      return typeof member === 'function' ? member.bind(object) : member
    },
  })
  return {
    store,
    holdNextPut() {
      armed = true
    },
    waitUntilHeld() {
      return new Promise<void>((resolve) => {
        announceHeld = resolve
      })
    },
    release() {
      openGate?.()
      openGate = undefined
    },
  }
}

describe('initialize', () => {
  it('assembles the default selection for a new session and persists the captured bodies', async () => {
    const first = moduleOf('first', 'FIRST BODY')
    const second = moduleOf('second', 'SECOND BODY')
    const openCase = await openPromptCase({ modules: [first, second], defaultSelection: ['second'] })
    const { agent } = await openCase.createAgent('session-a')

    const snapshot = await openCase.sessions.initialize(agent)

    expect(snapshot.sessionId).toBe('session-a')
    expect(snapshot.selection).toEqual(['second'])
    expect(snapshot.modules).toEqual([second])
    expect(snapshot.text).toBe(composePromptText([second]))
    expect(await openCase.store.getPrompt('session-a')).toEqual(snapshot)
    expect(openCase.fixture.listWrites()).toContain(`prompts/session-a`)
    expect(openCase.sessions.peek(agent)).toBe(snapshot)
  })

  it('is idempotent for concurrent callers of one live Agent', async () => {
    const openCase = await openPromptCase({ modules: [moduleOf('m1', 'M1 BODY')], defaultSelection: ['m1'] })
    const { agent } = await openCase.createAgent('session-a')

    const [first, second] = await Promise.all([
      openCase.sessions.initialize(agent),
      openCase.sessions.initialize(agent),
    ])

    expect(first).toBe(second)
    expect(openCase.sessions.peek(agent)).toBe(first)
  })

  it('keeps an existing snapshot when the library is edited, emptied or given another default', async () => {
    const original = moduleOf('m1', 'ORIGINAL BODY')
    const openCase = await openPromptCase({ modules: [original], defaultSelection: ['m1'] })
    const { agent } = await openCase.createAgent('session-a')
    const before = await openCase.sessions.initialize(agent)

    await openCase.saveLibrary({
      modules: [moduleOf('m1', 'EDITED BODY'), moduleOf('m2', 'ADDED BODY')],
      defaultSelection: ['m2'],
    })

    const after = openCase.sessions.peek(agent)
    expect(after).toBe(before)
    expect(after.text).toBe(composePromptText([original]))
    expect(after.modules[0]?.body).toBe('ORIGINAL BODY')
    expect(Object.isFrozen(after)).toBe(true)
    expect(Object.isFrozen(after.modules)).toBe(true)
    expect(Object.isFrozen(after.modules[0])).toBe(true)

    const { agent: fresh } = await openCase.createAgent('session-b')
    expect((await openCase.sessions.initialize(fresh)).text).toBe(composePromptText([moduleOf('m2', 'ADDED BODY')]))

    await openCase.saveLibrary({ modules: [], defaultSelection: [] })
    expect(openCase.sessions.peek(agent).text).toBe(composePromptText([original]))
  })

  it('restores its own persisted snapshot after a cold reopen instead of reassembling against the current library', async () => {
    const original = moduleOf('m1', 'ORIGINAL BODY')
    const openCase = await openPromptCase({ modules: [original], defaultSelection: ['m1'] })
    const first = await openCase.createAgent('session-a')
    const before = await openCase.sessions.initialize(first.agent)

    await openCase.saveLibrary({ modules: [moduleOf('m1', 'REPLACED BODY')], defaultSelection: ['m1'] })
    await first.dispose()
    await openCase.store.dispose()
    const reopenedStore = await openCase.fixture.open()
    const reopened = createPromptSessions(openCase.harness.ctx, reopenedStore)

    const { agent: resumed } = await openCase.createAgent('session-a')
    const restored = await reopened.initialize(resumed)

    expect(restored.text).toBe(before.text)
    expect(restored.text).toContain('ORIGINAL BODY')
    expect(restored.text).not.toContain('REPLACED BODY')
    await reopenedStore.dispose()
  })

  it('refuses an agent that never initialized, without initializing it', async () => {
    const openCase = await openPromptCase({ modules: [moduleOf('m1', 'M1 BODY')], defaultSelection: ['m1'] })
    const { agent } = await openCase.createAgent('session-unrelated')

    expect(failureCode(() => openCase.sessions.peek(agent))).toBe('NO_AGENT')
    expect(await openCase.store.getPrompt('session-unrelated')).toBeUndefined()
  })
})

describe('apply', () => {
  it('publishes one complete immutable capture only after the durable write succeeded', async () => {
    const first = moduleOf('first', 'FIRST BODY')
    const second = moduleOf('second', 'SECOND BODY')
    const openCase = await openPromptCase({ modules: [first, second], defaultSelection: ['first'] })
    const { agent } = await openCase.createAgent('session-a')
    const gate = gatePromptWrites(openCase.store)
    const gated = createPromptSessions(openCase.harness.ctx, gate.store)
    const before = await gated.initialize(agent)

    gate.holdNextPut()
    const pending = gated.apply(agent, ['second', 'first'], (await openCase.store.readLibrary()).hash)
    await gate.waitUntilHeld()
    expect(gated.peek(agent)).toBe(before)
    gate.release()

    const applied = await pending
    expect(gated.peek(agent)).toBe(applied)
    expect(applied).not.toBe(before)
    expect(applied.selection).toEqual(['second', 'first'])
    expect(applied.text).toBe(composePromptText([second, first]))
    expect(await openCase.store.getPrompt('session-a')).toEqual(applied)
    expect(before.text).toBe(composePromptText([first]))
    expect(Object.isFrozen(applied)).toBe(true)

    const stored = await openCase.store.readLibrary()
    expect(Object.isFrozen(stored.value)).toBe(false)
    expect(stored.value.modules[0]).toEqual(first)
  })

  it('refuses a stale library hash and keeps the current snapshot', async () => {
    const first = moduleOf('m1', 'M1 BODY')
    const openCase = await openPromptCase({ modules: [first], defaultSelection: ['m1'] })
    const { agent } = await openCase.createAgent('session-a')
    const before = await openCase.sessions.initialize(agent)
    const stale = await openCase.store.readLibrary()
    await openCase.saveLibrary({ modules: [first, moduleOf('m2', 'M2 BODY')], defaultSelection: ['m1'] })

    await expect(openCase.sessions.apply(agent, ['m2'], stale.hash)).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' })

    expect(openCase.sessions.peek(agent)).toBe(before)
    expect((await openCase.store.getPrompt('session-a'))?.text).toBe(before.text)
  })

  it('keeps the current snapshot when the durable write fails', async () => {
    const first = moduleOf('m1', 'M1 BODY')
    const second = moduleOf('m2', 'M2 BODY')
    const openCase = await openPromptCase({ modules: [first, second], defaultSelection: ['m1'] })
    const { agent } = await openCase.createAgent('session-a')
    const before = await openCase.sessions.initialize(agent)
    openCase.fixture.failNextPut(PROMPTS_TABLE)

    await expect(
      openCase.sessions.apply(agent, ['m2'], (await openCase.store.readLibrary()).hash),
    ).rejects.toThrow()

    expect(openCase.sessions.peek(agent)).toBe(before)
    expect((await openCase.store.getPrompt('session-a'))?.text).toBe(before.text)
  })

  it('queues an apply behind an initialize still in flight', async () => {
    const first = moduleOf('first', 'FIRST BODY')
    const second = moduleOf('second', 'SECOND BODY')
    const openCase = await openPromptCase({ modules: [first, second], defaultSelection: ['first'] })
    const { agent } = await openCase.createAgent('session-a')
    const library = await openCase.store.readLibrary()

    const [initial, applied] = await Promise.all([
      openCase.sessions.initialize(agent),
      openCase.sessions.apply(agent, ['second'], library.hash),
    ])

    expect(initial.selection).toEqual(['first'])
    expect(applied.selection).toEqual(['second'])
    expect(openCase.sessions.peek(agent)).toBe(applied)
    expect((await openCase.store.getPrompt('session-a'))?.selection).toEqual(['second'])
  })

  it('refuses an uninitialized agent instead of inventing its snapshot', async () => {
    const openCase = await openPromptCase({ modules: [moduleOf('m1', 'M1 BODY')], defaultSelection: ['m1'] })
    const { agent } = await openCase.createAgent('session-unrelated')

    await expect(
      openCase.sessions.apply(agent, ['m1'], (await openCase.store.readLibrary()).hash),
    ).rejects.toMatchObject({ code: 'NO_AGENT' })
    expect(await openCase.store.getPrompt('session-unrelated')).toBeUndefined()
  })
})

describe('child sessions', () => {
  it('gives a new child its parent actual snapshot, copying bodies the library no longer holds', async () => {
    const parentModule = moduleOf('parent', 'PARENT BODY')
    const openCase = await openPromptCase({ modules: [parentModule], defaultSelection: ['parent'] })
    const { agent: parent } = await openCase.createAgent('session-parent')
    const parentSnapshot = await openCase.sessions.initialize(parent)
    await openCase.saveLibrary({ modules: [], defaultSelection: [] })

    const { agent: child } = await openCase.createChild(parent, 'session-child')
    const childSnapshot = await openCase.sessions.initialize(child)

    expect(childSnapshot.sessionId).toBe('session-child')
    expect(childSnapshot.text).toBe(parentSnapshot.text)
    expect(childSnapshot.modules[0]?.body).toBe('PARENT BODY')
    expect(childSnapshot.modules).not.toBe(parentSnapshot.modules)
    expect(childSnapshot.modules[0]).not.toBe(parentSnapshot.modules[0])
    expect(childSnapshot.selection).not.toBe(parentSnapshot.selection)
    expect(await openCase.store.getPrompt('session-child')).toEqual(childSnapshot)
  })

  it('keeps a cold child on its own saved snapshot after the parent moved on', async () => {
    const parentModule = moduleOf('parent', 'PARENT BODY')
    const addedModule = moduleOf('added', 'ADDED BODY')
    const openCase = await openPromptCase({
      modules: [parentModule, addedModule],
      defaultSelection: ['parent'],
    })
    const { agent: parent } = await openCase.createAgent('session-parent')
    await openCase.sessions.initialize(parent)
    const childHandle = await openCase.createChild(parent, 'session-child')
    const original = await openCase.sessions.initialize(childHandle.agent)

    await openCase.sessions.apply(parent, ['added'], (await openCase.store.readLibrary()).hash)
    expect(openCase.sessions.peek(parent).text).toContain('ADDED BODY')

    await childHandle.dispose()
    const { agent: resumed } = await openCase.createChild(parent, 'session-child')
    const restored = await openCase.sessions.initialize(resumed)

    expect(restored.text).toBe(original.text)
    expect(restored.text).not.toContain('ADDED BODY')
  })
})

describe('agent identity and lifecycle', () => {
  it('refuses a disposed agent and never publishes an old operation into the recreated session', async () => {
    const first = moduleOf('first', 'FIRST BODY')
    const second = moduleOf('second', 'SECOND BODY')
    const openCase = await openPromptCase({ modules: [first, second], defaultSelection: ['first'] })
    const originalHandle = await openCase.createAgent('session-a')
    const original = originalHandle.agent
    const gate = gatePromptWrites(openCase.store)
    const gated = createPromptSessions(openCase.harness.ctx, gate.store)
    await gated.initialize(original)
    const library = await openCase.store.readLibrary()

    gate.holdNextPut()
    const stale = gated.apply(original, ['second'], library.hash)
    await gate.waitUntilHeld()
    await originalHandle.dispose()
    gate.release()

    await expect(stale).rejects.toMatchObject({ code: 'NO_AGENT' })
    expect(failureCode(() => gated.peek(original))).toBe('NO_AGENT')

    const { agent: recreated } = await openCase.createAgent('session-a')
    const restored = await gated.initialize(recreated)
    expect(gated.peek(recreated)).toBe(restored)
    expect(restored.text).toBe(composePromptText([second]))
  })

  it('keeps another agent snapshot when one agent is disposed', async () => {
    const shared = moduleOf('m1', 'M1 BODY')
    const openCase = await openPromptCase({ modules: [shared], defaultSelection: ['m1'] })
    const firstHandle = await openCase.createAgent('session-a')
    const { agent: second } = await openCase.createAgent('session-b')
    await openCase.sessions.initialize(firstHandle.agent)
    const secondSnapshot = await openCase.sessions.initialize(second)

    await openCase.disposeAgent(firstHandle)

    expect(openCase.sessions.peek(second)).toBe(secondSnapshot)
    expect(failureCode(() => openCase.sessions.peek(firstHandle.agent))).toBe('NO_AGENT')
  })
})
