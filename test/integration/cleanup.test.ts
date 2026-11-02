/**
 * Integration: cross-generation publication and the whole lifecycle.
 *
 * The saved-web-result repository belongs to the host runtime, so two live Nexus
 * generations publishing for one durable owner must serialize through that ONE
 * instance with the production caps and eviction still enforced. The lifecycle
 * cases then close every resource kind, unload and re-register the host row,
 * reopen saved web state, exercise the same-session older-Agent refusal, and
 * prove the built preset entry waits for its declared runtime service instead of
 * activating against a cache.
 *
 * Everything is project-local: the harness owns its temp root, the spawn and
 * confinement boundaries are scripted external implementations, and no HTTP
 * server, port or real profile is started by this suite.
 *
 * @module dsh-nexus/test/integration/cleanup
 */

import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { NEXUS_PRESET_ID, createNexusPreset } from '../../src/preset/definition.ts'
import * as presetEntry from '../../src/preset/index.ts'
import { WEB_SESSION_MAX_DOCUMENTS } from '../../src/runtime/defaults.ts'
import type { NexusRuntime } from '../../src/runtime/service.ts'
import { mountPresetHarness, PRESET_ROUTE, type PresetHarness } from '../support/preset-harness.ts'

/** Second preset definition id, composing the same accepted Nexus definition. */
const SECOND_GENERATION_ID = 'nexus-secondary'

/** The tool names the Nexus generation contributes. */
const NEXUS_TOOLS = ['read', 'write', 'edit', 'shell', 'web', 'agent'] as const

/** Node process events a leaked listener would show up on. */
const LEAK_EVENTS = ['exit', 'beforeExit', 'SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException'] as const

/** Listener counts for the watched process events. */
function listenerCounts(): Record<string, number> {
  return Object.fromEntries(LEAK_EVENTS.map((event) => [event, process.listenerCount(event)]))
}

/**
 * Throwing helper: assert a successful registry result and return its value.
 * @param result - registry result.
 * @returns the canonical value.
 */
function valueOf<T>(result: ToolExecutionResult): T {
  if (result.isError) throw new Error(`expected success, got ${JSON.stringify(result.error)}`)
  return result.value as unknown as T
}

/** Tool names currently registered in the host realm. */
function hostToolNames(harness: PresetHarness): string[] {
  return harness.ctx.tools
    .schemas()
    .map((schema) => schema.name)
    .sort()
}

/**
 * Register the second Nexus-composing generation.
 * @param harness - mounted harness with the runtime open.
 * @returns its unregister function.
 */
async function registerSecondGeneration(harness: PresetHarness): Promise<() => Promise<void>> {
  return harness.ctx.agentPresets.register({
    ...createNexusPreset({}, { compaction: 'absent', evidence: [] }),
    id: SECOND_GENERATION_ID,
    name: 'Nexus secondary',
    order: 8,
  })
}

/**
 * Publish one fixture page through the web tool.
 * @param harness - mounted harness.
 * @param agent - caller.
 * @param url - URL the scripted provider answers.
 * @returns the durable result id.
 */
async function fetchPage(harness: PresetHarness, agent: Agent, url: string): Promise<string> {
  const fetched = await harness.call('web', { action: 'fetch', urls: [url] }, agent)
  const value = valueOf<{ items: { ok: boolean; resultId?: string }[] }>(fetched)
  const item = value.items[0]
  if (item?.ok !== true || item.resultId === undefined) throw new Error(`fetch of ${url} did not publish a result`)
  return item.resultId
}

describe('cross-generation web publication', () => {
  it('serializes one owner through the shared repository and keeps caps and eviction', async () => {
    const harness = await mountPresetHarness({})
    try {
      const runtime = await harness.startNexus()
      const unregister = await registerSecondGeneration(harness)
      try {
        const first = await harness.createAgent('publish-primary', NEXUS_PRESET_ID)
        const second = await harness.createAgent('publish-secondary', SECOND_GENERATION_ID)
        await harness.runTurn(first, 'primary')
        await harness.runTurn(second, 'secondary')

        // A transparent observer on the ONE repository instance: it forwards and
        // returns the shipped implementation's own result.
        const repository = runtime.webResults
        const realSave = repository.save.bind(repository)
        const observed: string[] = []
        repository.save = async (input) => {
          observed.push(input.owner)
          return realSave(input)
        }
        try {
          // Both live generations publish through the same instance.
          const firstId = await fetchPage(harness, first, 'https://fixture.test/cross-first')
          const secondId = await fetchPage(harness, second, 'https://fixture.test/cross-second')
          expect(observed).toEqual(['publish-primary', 'publish-secondary'])
          expect((await repository.read('publish-primary', firstId)).text).toContain('FIXTURE WEB BODY')
          expect((await repository.read('publish-secondary', secondId)).text).toContain('FIXTURE WEB BODY')

          // Fill the primary owner to exactly the documented document cap.
          let previous = firstId
          for (let index = 0; index < 31; index += 1) {
            previous = await fetchPage(harness, first, `https://fixture.test/primary-${index}`)
          }
          expect((await runtime.store.listWeb('publish-primary')).length).toBe(WEB_SESSION_MAX_DOCUMENTS)

          // Eight concurrent publications for the same owner: without one
          // serialized chain each could observe "a slot is free" and exceed the
          // cap. With it, exactly the cap survives and the oldest are evicted.
          const concurrent = await Promise.all(
            Array.from({ length: 8 }, (_unused, index) =>
              harness.call('web', { action: 'fetch', urls: [`https://fixture.test/concurrent-${index}`] }, first),
            ),
          )
          for (const result of concurrent) expect(result.isError, JSON.stringify(result)).toBe(false)

          const documents = await runtime.store.listWeb('publish-primary')
          expect(documents.length).toBe(WEB_SESSION_MAX_DOCUMENTS)
          // The oldest result is evicted; the retention rule stays enforced.
          await expect(runtime.webResults.read('publish-primary', firstId)).rejects.toMatchObject({
            code: 'RESOURCE_NOT_AVAILABLE',
          })
          expect((await runtime.webResults.read('publish-primary', previous)).text).toContain('FIXTURE WEB BODY')
          // Another durable owner is untouched by the primary owner's eviction.
          expect((await runtime.webResults.read('publish-secondary', secondId)).document.resultId).toBe(secondId)
        } finally {
          repository.save = realSave
        }
      } finally {
        await unregister()
      }
    } finally {
      await harness.dispose()
    }
  }, 180_000)
})

describe('lifecycle and cleanup', () => {
  it('closes a background job, a persistent terminal and a child, then re-registers after unload', async () => {
    const harness = await mountPresetHarness({
      // Background work and the persistent terminal stay alive until explicitly
      // closed; termination then confirms the range, as the shipped provider
      // contract reports.
      subprocessScript: () => ({ staysOpen: true }),
      terminalScript: () => ({ staysOpen: true, stdout: 'nexus-integration-prompt\r\n' }),
    })
    let runtime: NexusRuntime | undefined
    try {
      runtime = await harness.startNexus()
      const baseline = hostToolNames(harness)
      const nexus = await harness.createAgent('lifecycle-agent', NEXUS_PRESET_ID)
      await harness.runTurn(nexus, 'lifecycle')

      const run = valueOf<{ process: { resourceId: string } }>(
        await harness.call('shell', { action: 'run', command: 'long work', background: true }, nexus),
      )
      const opened = valueOf<{ terminal: { resourceId: string } }>(
        await harness.call('shell', { action: 'open', name: 'lifecycle-terminal' }, nexus),
      )
      const started = valueOf<{ childId: string }>(
        await harness.call('agent', { action: 'start', task: 'read child', context: 'spawn' }, nexus),
      )

      // Close every kind of owned resource through its own product action.
      expect(valueOf<{ closed: boolean }>(await harness.call('shell', { action: 'close', resourceId: run.process.resourceId }, nexus)).closed).toBe(true)
      expect(valueOf<{ closed: boolean }>(await harness.call('shell', { action: 'close', resourceId: opened.terminal.resourceId }, nexus)).closed).toBe(true)
      const stopped = await harness.call('agent', { action: 'stop', childId: started.childId }, nexus)
      expect(stopped.isError, JSON.stringify(stopped)).toBe(false)

      const listed = valueOf<{ processes: unknown[]; terminals: unknown[] }>(
        await harness.call('shell', { action: 'list' }, nexus),
      )
      expect(listed.processes).toEqual([])
      expect(listed.terminals).toEqual([])

      // Hot unload: every Nexus registration and the runtime service disappear;
      // re-registration restores exactly the same set, with no growth.
      await harness.stopNexus()
      expect(harness.ctx.get('nexusRuntime')).toBeUndefined()
      expect(hostToolNames(harness)).toEqual(baseline)
      await harness.startNexus()
      // The definition is composed again in its own generation scope (the host
      // realm never carries the Nexus tools), and a new session sees them.
      expect((await harness.presetRows(NEXUS_PRESET_ID)).map((row) => row.moduleName)).toContain(
        'dsh-nexus/preset',
      )
      const again = await harness.createAgent('lifecycle-agent-2', NEXUS_PRESET_ID)
      await harness.runTurn(again, 'again')
      expect(harness.toolNamesOf(again)).toEqual(expect.arrayContaining([...NEXUS_TOOLS]))

      // A clean drain: no owned resource stayed unconfirmed.
      await harness.stopNexus()
      const status = await runtime.dispose()
      expect(status).toMatchObject({ released: true, unconfirmedResources: [], retainedScopes: [], failures: [] })
      expect(hostToolNames(harness)).toEqual(baseline)
    } finally {
      await harness.dispose()
    }
  }, 180_000)

  it('refuses the same-id older Agent and serves several concurrent sessions', async () => {
    const harness = await mountPresetHarness({})
    try {
      await harness.startNexus()
      const older = await harness.createAgent('same-id-session', NEXUS_PRESET_ID)
      await harness.runTurn(older, 'older residency')
      expect((await harness.call('read', { path: 'AGENTS.md' }, older)).isError).toBe(false)

      // A later residency of the same durable session: the persisted session is
      // resumed and a fresh Agent instance takes the exact-id place.
      await harness.disposeAgent(older)
      const handle = await harness.ctx.agents.resume({
        resumeSessionId: SessionId('same-id-session'),
        agentOptions: { ...PRESET_ROUTE },
        setup: async (agentCtx) => {
          await harness.ctx.agentPresets.mount(agentCtx, NEXUS_PRESET_ID)
        },
      })
      const newer = handle.agent
      try {
        await harness.runTurn(newer, 'newer residency')

        const stale = await harness.call('read', { path: 'AGENTS.md' }, older)
        expect(stale.isError).toBe(true)
        expect(stale.error?.info).toMatchObject({ code: 'NO_AGENT' })
        expect(harness.runtime.isNexusAgent(older)).toBe(false)
        expect(harness.runtime.isNexusAgent(newer)).toBe(true)
        expect((await harness.call('read', { path: 'AGENTS.md' }, newer)).isError).toBe(false)
      } finally {
        await handle.dispose()
      }

      // Three concurrent sessions each get their own request and results.
      const sessions = await Promise.all(
        ['concurrent-a', 'concurrent-b', 'concurrent-c'].map((id) => harness.createAgent(id, NEXUS_PRESET_ID)),
      )
      await Promise.all(sessions.map((agent, index) => harness.runTurn(agent, `concurrent ${index}`)))
      for (const agent of sessions) {
        expect(harness.toolNamesOf(agent)).toEqual(expect.arrayContaining([...NEXUS_TOOLS]))
      }
      expect(new Set(sessions.map((agent) => agent.id)).size).toBe(3)
    } finally {
      await harness.dispose()
    }
  }, 180_000)

  it('reopens saved web state and leaves no registrations, listeners or processes behind', async () => {
    const before = listenerCounts()
    const harness = await mountPresetHarness({})
    let disposed = false
    try {
      expect(harness.ctx.get('webServer')).toBeUndefined()
      await harness.startNexus()
      const agent = await harness.createAgent('reopen-web', NEXUS_PRESET_ID)
      const resultId = await fetchPage(harness, agent, 'https://fixture.test/reopen')

      // Unload, then read the saved document back through a fresh store handle
      // over the same durable medium.
      await harness.stopNexus()
      const store = await harness.fixture.open()
      try {
        const document = await store.getWeb('reopen-web', resultId)
        expect(document?.resultId).toBe(resultId)
        expect(document?.content).toContain('FIXTURE WEB BODY')
      } finally {
        await store.dispose()
      }
      expect(harness.ctx.get('nexusRuntime')).toBeUndefined()

      // Dispose the whole composition, then check nothing survived it. The
      // assertions below are the ones that check it — the harness teardown itself
      // asserts nothing — and the process-level facts are checked here too.
      await harness.dispose()
      disposed = true
      expect(harness.ctx.get('tools')).toBeUndefined()
      expect(harness.ctx.get('nexusRuntime')).toBeUndefined()
      expect(listenerCounts()).toEqual(before)
    } finally {
      if (!disposed) await harness.dispose()
    }
  }, 180_000)

  it('activates the built preset entry only after its declared runtime service exists', async () => {
    const harness = await mountPresetHarness({})
    try {
      await harness.startNexus()
      const runtime = harness.runtime

      // An isolated realm has no `nexusRuntime`, so the row's declared inject list
      // keeps it pending: nothing registers against a cached or partial world.
      const cold = harness.ctx.isolate('nexusRuntime')
      let activated = false
      const row = cold.plugin({
        name: presetEntry.name,
        inject: [...presetEntry.inject],
        apply(pluginCtx) {
          presetEntry.apply(pluginCtx, {})
          activated = true
        },
      })
      // A bounded multi-macrotask window (50 ms, far more than one turn): a single
      // `setImmediate` would also pass if activation were merely slow, rather than
      // impossible without the declared service.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(activated).toBe(false)
      expect(cold.tools.schemas()).toEqual([])

      // Supplying the real runtime service lets the same row activate, and it
      // joins the one live runtime instead of opening another.
      cold.provide('nexusRuntime', runtime)
      await row
      expect(activated).toBe(true)
      const names = cold.tools.schemas().map((schema) => schema.name)
      for (const tool of NEXUS_TOOLS) expect(names).toContain(tool)

      // Unloading that generation withdraws its own registrations and leaves the
      // shared runtime serving the host generation.
      await (row as unknown as { dispose(): Promise<void> }).dispose()
      expect(cold.tools.schemas()).toEqual([])
      expect(harness.ctx.get('nexusRuntime')).toBe(runtime)
      expect(runtime.getSettings().value).toBeDefined()
    } finally {
      await harness.dispose()
    }
  }, 180_000)
})
