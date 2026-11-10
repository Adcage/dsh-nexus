/**
 * The Nexus preset's real composition, driven through the native preset registry.
 *
 * Every row in the definition is mounted by the shipped Loader and the shipped
 * `agentPresets` registry; the Nexus contribution row is the package's own built
 * sub-entry. Nothing is faked inside the composition: the only scripted members
 * are external boundaries (model transport, web providers, process spawn,
 * confinement runner).
 *
 * The cases assert the fixed composition (the six Nexus tools plus the native
 * skill, question and todo surfaces), that a third-party tool is never filtered
 * even when it uses a first-party capability's name, an untouched `standard`
 * preset, the three compaction decisions, a real cold-path call chain and
 * repeated start/unload without registration growth.
 *
 * @module dsh-nexus/test/preset/composition
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { NEXUS_PRESET_ID } from '../../src/preset/definition.ts'
import { mountPresetHarness, type PresetHarness } from '../support/preset-harness.ts'

/** The six tools the Nexus preset owns. */
const NEXUS_CORE = ['read', 'write', 'edit', 'shell', 'web', 'agent'] as const

/** The native surfaces a Nexus session must keep. */
const NATIVE_SURFACES = ['skill', 'ask_user_question', 'todo_write'] as const

/**
 * Names a THIRD-PARTY plugin registers that also describe first-party tools.
 *
 * Names carry no ownership: the public registry has no provenance, so nothing
 * here may be treated as "native" and filtered.
 */
const COLLISION_NAMES = ['bash', 'pwsh', 'subagent', 'subagent_fork', 'job_list'] as const

/**
 * Open a harness whose global layer carries a third-party tool and a third-party
 * plugin that happens to use first-party tool names.
 * @returns the mounted harness.
 */
async function openHarness(): Promise<PresetHarness> {
  return mountPresetHarness({
    thirdPartyTools: ['example_extra_tool'],
    collisionToolNames: [...COLLISION_NAMES],
  })
}

describe('nexus preset composition', () => {
  it('adds the nexus core without filtering any other contributor', async () => {
    const harness = await openHarness()
    try {
      const standardAgent = await harness.createAgent('standard-session', 'standard')
      await harness.runTurn(standardAgent, 'before')
      const standardBefore = harness.toolNamesOf(standardAgent)
      // The native surfaces and both third-party contributions are visible
      // before Nexus exists at all.
      expect(standardBefore).toEqual(
        expect.arrayContaining([...NATIVE_SURFACES, 'example_extra_tool', ...COLLISION_NAMES]),
      )

      await harness.startNexus()
      await harness.runTurn(standardAgent, 'after')
      expect(harness.toolNamesOf(standardAgent)).toEqual(standardBefore)

      const nexusAgent = await harness.createAgent('nexus-session', NEXUS_PRESET_ID)
      await harness.runTurn(nexusAgent, 'compose')
      const names = harness.toolNamesOf(nexusAgent)

      expect(names).toEqual(expect.arrayContaining([...NEXUS_CORE, ...NATIVE_SURFACES, 'example_extra_tool']))
      // A name never proves who registered a tool: every colliding third-party
      // tool stays visible to a Nexus session, beside the Nexus tool that covers
      // the same capability. Their co-existence is the honest overlap this preset
      // cannot resolve without provenance.
      for (const collision of COLLISION_NAMES) {
        expect(standardBefore).toContain(collision)
        expect(names).toContain(collision)
      }
      expect(names).toContain('shell')
      expect(names).toContain('agent')
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('keeps one effective compaction mechanism inside the nexus scope', async () => {
    const harness = await mountPresetHarness({})
    try {
      await harness.startNexus()
      const agent = await harness.createAgent('nexus-compaction', NEXUS_PRESET_ID)

      // The host realm carries no mechanism, so the preset mounts its own
      // isolated group — and the host stays without one.
      expect(harness.ctx.get('compaction')).toBeUndefined()
      expect(harness.ctx.get('toolResultPruner')).toBeUndefined()

      const engine = harness.ctx.agentPresets.serviceFor(agent, 'compaction' as 'llm')
      const pruner = harness.ctx.agentPresets.serviceFor(agent, 'toolResultPruner' as 'llm') as unknown as {
        readonly config: { thresholdChars: number; headChars: number; tailChars: number }
        pruneContent(blocks: readonly { type: 'text'; text: string }[]): { type: string; text?: string }[] | null
      }
      expect(engine).toBeDefined()
      expect(pruner).toBeDefined()
      expect(pruner?.config).toEqual({ thresholdChars: 8_192, headChars: 4_096, tailChars: 1_024 })

      // A real mechanism invocation, not a module-name snapshot: the pruner this
      // Agent resolves rewrites an over-budget result with its own budgets.
      const text = 'A'.repeat(20_000)
      const pruned = pruner?.pruneContent([{ type: 'text', text }])
      expect(pruned).not.toBeNull()
      const prunedText = pruned?.map((block) => (block.type === 'text' ? block.text : '')).join('') ?? ''
      expect(prunedText.length).toBeLessThan(text.length)
      expect(prunedText.startsWith('A'.repeat(4_096))).toBe(true)
      expect(prunedText.endsWith('A'.repeat(1_024))).toBe(true)
      // Within budget, nothing is rewritten.
      expect(pruner?.pruneContent([{ type: 'text', text: 'short' }])).toBeNull()

      // The isolated group is Nexus-only: a `standard` session resolves no
      // engine at all because the host realm has none, so the group cannot be
      // compacting unrelated sessions.
      const standardAgent = await harness.createAgent('standard-compaction', 'standard')
      expect(harness.ctx.agentPresets.serviceFor(standardAgent, 'compaction' as 'llm')).toBeUndefined()
      expect(standardAgent.ctx.get('compaction')).toBeUndefined()
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('inherits the host compaction pair instead of stacking its own group', async () => {
    const harness = await mountPresetHarness({ hostCompaction: 'pair' })
    try {
      // The shipped native components, mounted in the host realm before the row
      // starts: this is the pair `detectNativeComposition` must report.
      const hostEngine = harness.ctx.get('compaction')
      const hostPruner = harness.ctx.get('toolResultPruner')
      expect(hostEngine).toBeDefined()
      expect(hostPruner).toBeDefined()

      await harness.startNexus()
      const agent = await harness.createAgent('nexus-inherited', NEXUS_PRESET_ID)

      // The definition composes no compaction row at all in this branch.
      const rows = await harness.presetRows(NEXUS_PRESET_ID)
      const modules = rows.map((row) => row.moduleName)
      expect(modules).not.toContain('@deepseek-ai/dsh-compaction-basic')
      expect(modules).not.toContain('@deepseek-ai/dsh-compaction-tool-result-pruner')
      expect(modules).not.toContain('@deepseek-ai/dsh-command-compact')

      // And the Agent's effective pair IS the inherited host pair: the preset
      // provides no compaction service of its own (`serviceFor` reads only the
      // preset's own subtree), while the Agent's scope chain resolves the native
      // engine and pruner the host mounted. Cordis hands out a per-context
      // traceable wrapper, so equality is checked on the resolved configuration
      // and class, not on object identity across contexts.
      expect(harness.ctx.agentPresets.serviceFor(agent, 'compaction' as 'llm')).toBeUndefined()
      expect(harness.ctx.agentPresets.serviceFor(agent, 'toolResultPruner' as 'llm')).toBeUndefined()
      const effectiveEngine = agent.ctx.get('compaction') as unknown as {
        constructor: { name: string }
        config: unknown
        compactIfNeeded?: unknown
      }
      const effectivePruner = agent.ctx.get('toolResultPruner') as unknown as {
        constructor: { name: string }
        config: unknown
        pruneSession?: unknown
      }
      expect(effectiveEngine).toBeDefined()
      expect(effectivePruner).toBeDefined()
      expect(effectiveEngine.constructor.name).toBe('BasicCompactionEngine')
      expect(effectivePruner.constructor.name).toBe('ToolResultPruner')
      expect(effectiveEngine.config).toEqual((hostEngine as unknown as { config: unknown }).config)
      expect(effectivePruner.config).toEqual((hostPruner as unknown as { config: unknown }).config)
      // One mechanism, and it is the one the host mounted: the operations the
      // loop calls exist on the resolved instances.
      expect(typeof effectiveEngine.compactIfNeeded).toBe('function')
      expect(typeof effectivePruner.pruneSession).toBe('function')
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('refuses to compose when only half the inherited compaction pair exists', async () => {
    const harness = await mountPresetHarness({ hostCompaction: 'partial' })
    try {
      expect(harness.ctx.get('compaction')).toBeDefined()
      expect(harness.ctx.get('toolResultPruner')).toBeUndefined()

      let failure: unknown
      try {
        await harness.startNexus()
      } catch (error) {
        failure = error
      }
      // The real public activation path fails closed, and it names the ambiguous
      // capability rather than assuming the partial pair is complete.
      expect(failure).toMatchObject({ name: 'NexusError', code: 'UNSUPPORTED_CAPABILITY' })
      expect(String((failure as Error).message)).toMatch(/ambiguous/i)
      expect(String((failure as Error).message)).toContain('toolResultPruner')
      // Nothing half-composed survives the refusal.
      expect(harness.ctx.get('nexusRuntime')).toBeUndefined()
      const inventory = await harness.ctx.agentPresets.compositionInventory()
      expect(inventory.map((entry) => entry.id)).not.toContain(NEXUS_PRESET_ID)
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('serves the real cold path for storage, files, shell and prompts', async () => {
    const harness = await mountPresetHarness({
      // The scripted spawn boundary answers a fixed stdout so the run's output
      // page is assertable without executing anything.
      subprocessScript: () => ({ stdout: 'FIXTURE STDOUT\n', exitCode: 0 }),
    })
    try {
      // A project-local fixture executable passed through the REAL deployment
      // config. The recorded `SubprocessRuntime` boundary never executes it, so
      // this proves the wiring (argv, cwd, confinement), not OS execution.
      const fixtureExecutable = join(harness.workspace, 'fixture-bash.exe')
      await writeFile(fixtureExecutable, 'fixture executable — never executed\n', 'utf8')
      const runtime = await harness.startNexus({ bashPath: fixtureExecutable })
      expect(runtime.getShellConfig().deployment.bashPath).toBe(fixtureExecutable)
      const agent = await harness.createAgent('nexus-cold', NEXUS_PRESET_ID)

      const written = await harness.call('write', { path: 'cold.txt', content: 'COLD PATH LINE\n' }, agent)
      expect(written.isError).toBe(false)
      const read = await harness.call('read', { path: 'cold.txt' }, agent)
      expect(read.isError).toBe(false)
      expect(read.value).toMatchObject({ kind: 'text', lines: [{ number: 1, text: 'COLD PATH LINE' }] })

      // The shell tool answers through the real process and terminal controllers.
      // A `list` proves the controllers are wired; a `run` below proves the
      // executed-request shape through the recorded spawn and confinement seams.
      const shellList = await harness.call('shell', { mode: 'list' }, agent)
      expect(shellList.isError).toBe(false)
      expect(shellList.value).toMatchObject({ mode: 'list', processes: [], terminals: [] })

      expect(harness.ctx.get('sandboxPolicy')).toBeDefined()
      const spawnsBefore = harness.subprocess.spawns.length
      const confineBefore = harness.sandbox.calls.length
      const run = await harness.call(
        'shell',
        { mode: 'run', command: 'echo cold-run', engine: 'bash' },
        agent,
      )
      expect(run.isError, JSON.stringify(run)).toBe(false)
      const runValue = run.value as { mode: string; process: { status: string }; page: { text: string } }
      expect(runValue.mode).toBe('run')
      expect(runValue.process.status).toBe('exited')
      expect(runValue.page.text).toContain('FIXTURE STDOUT')
      // The provider received the configured executable, the documented bash
      // argument shape and the session directory; the spawned argv is the one the
      // confinement runner returned, not the raw one.
      const rawArgv = [fixtureExecutable, '--noprofile', '--norc', '-c', 'echo cold-run']
      expect(harness.subprocess.spawns).toHaveLength(spawnsBefore + 1)
      const spawn = harness.subprocess.spawns.at(-1)
      expect(spawn?.cwd).toBe(harness.workspace)
      expect(spawn?.argv).toEqual(['nexus-sandbox', '--', ...rawArgv])
      // Exactly one confinement was resolved for this run, against the session's
      // effective policy, and it received the full raw argv.
      expect(harness.sandbox.calls).toHaveLength(confineBefore + 1)
      const confine = harness.sandbox.calls.at(-1)
      expect(confine?.argv).toEqual(rawArgv)
      expect(confine?.policy.mode).toBe('workspace-write')
      expect(confine?.policy.workspaceRoot).toBe(harness.workspace)

      // The web tool publishes through the ONE repository the runtime owns and
      // reads the saved result back from the same store.
      const fetched = await harness.call('web', { action: 'fetch', urls: ['https://fixture.test/page'] }, agent)
      expect(fetched.isError).toBe(false)
      const fetchedValue = fetched.value as { items: { ok: boolean; resultId?: string }[] }
      const resultId = fetchedValue.items[0]?.resultId
      expect(fetchedValue.items[0]?.ok).toBe(true)
      expect(typeof resultId).toBe('string')
      const saved = await harness.call('web', { action: 'read', resultId }, agent)
      expect(saved.isError).toBe(false)
      expect((saved.value as { text: string }).text).toContain('FIXTURE WEB BODY')

      // The Nexus persona reaches the assembled request of this session, and the
      // project instruction file contributes beside it.
      await harness.runTurn(agent, 'cold')
      const promptText = harness.promptTextOf(agent)
      expect(promptText).toContain('你是一名运行在 DeepSeek Harness（DSH）Agent 框架内的专业编程助手')
      expect(promptText).toContain('FIXTURE INSTRUCTION LINE')
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('repeats activation and unload without growing the registries', async () => {
    const harness = await mountPresetHarness({})
    try {
      const baseline = harness.ctx.tools.schemas().map((schema) => schema.name).sort()
      expect(baseline).not.toContain('read')

      await harness.startNexus()
      const first = harness.ctx.tools.schemas().map((schema) => schema.name).sort()
      const firstAgent = await harness.createAgent('nexus-repeat-a', NEXUS_PRESET_ID)
      await harness.runTurn(firstAgent, 'first')
      expect(harness.toolNamesOf(firstAgent)).toContain('read')
      const firstRuntime = harness.runtime

      await harness.stopNexus()
      expect(harness.ctx.tools.schemas().map((schema) => schema.name).sort()).toEqual(baseline)
      expect(harness.ctx.get('nexusRuntime')).toBeUndefined()
      // The host-fiber unload drains the generation's shell surface and the
      // host-registered terminal backends in one ordered teardown: a clean
      // generation reports a clean drain rather than treating the concurrent
      // backend removal as an unconfirmed range.
      const stopped = await firstRuntime.dispose()
      expect(stopped.failures).toEqual([])
      expect(stopped.released).toBe(true)

      // A second generation over the same host composition: the definition is
      // registered again and serves a new session.
      await harness.startNexus()
      expect(harness.ctx.tools.schemas().map((schema) => schema.name).sort()).toEqual(first)
      const secondAgent = await harness.createAgent('nexus-repeat-b', NEXUS_PRESET_ID)
      await harness.runTurn(secondAgent, 'second')
      expect(harness.toolNamesOf(secondAgent)).toContain('read')

      await harness.stopNexus()
      expect(harness.ctx.tools.schemas().map((schema) => schema.name).sort()).toEqual(baseline)
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it("publishes saved web results through the runtime's one repository instance", async () => {
    const harness = await mountPresetHarness({})
    try {
      const runtime = await harness.startNexus()
      const first = await harness.createAgent('repo-first', NEXUS_PRESET_ID)
      const second = await harness.createAgent('repo-second', NEXUS_PRESET_ID)

      // A transparent observer on the REAL repository instance: it forwards every
      // publication to the shipped implementation and returns its result, so a
      // tool that built its own repository over the same store would bypass it.
      const repository = runtime.webResults
      const realSave = repository.save.bind(repository)
      const observed: string[] = []
      repository.save = async (input) => {
        observed.push(input.owner)
        return realSave(input)
      }
      try {
        const fetched = await harness.call('web', { action: 'fetch', urls: ['https://fixture.test/first'] }, first)
        expect(fetched.isError).toBe(false)
        const resultId = (fetched.value as { items: { resultId: string }[] }).items[0]?.resultId as string
        // The genuine publish went through THIS instance, not merely the same store.
        expect(observed).toEqual(['repo-first'])

        const saved = await runtime.webResults.read('repo-first', resultId)
        expect(saved.document.resultId).toBe(resultId)
        expect(saved.text).toContain('FIXTURE WEB BODY')

        // A second Nexus session publishes through the same authoritative
        // instance, which keeps each durable owner separate.
        const otherFetched = await harness.call('web', { action: 'fetch', urls: ['https://fixture.test/second'] }, second)
        expect(otherFetched.isError).toBe(false)
        const otherId = (otherFetched.value as { items: { resultId: string }[] }).items[0]?.resultId as string
        expect(observed).toEqual(['repo-first', 'repo-second'])
        await expect(runtime.webResults.read('repo-first', otherId)).rejects.toMatchObject({
          code: 'RESOURCE_NOT_AVAILABLE',
        })
      } finally {
        repository.save = realSave
      }
      expect(harness.ctx.get('nexusRuntime')).toBe(runtime)
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('exposes every nexus tool definition only through the nexus scope', async () => {
    const harness = await mountPresetHarness({})
    try {
      await harness.startNexus()
      const standardAgent = await harness.createAgent('standard-scope', 'standard')
      const nexusAgent = await harness.createAgent('nexus-scope', NEXUS_PRESET_ID)
      await harness.runTurn(standardAgent, 'standard')
      await harness.runTurn(nexusAgent, 'nexus')

      const standardTools = harness.toolNamesOf(standardAgent)
      const nexusTools = harness.toolNamesOf(nexusAgent)
      for (const tool of NEXUS_CORE) {
        expect(nexusTools).toContain(tool)
        expect(standardTools).not.toContain(tool)
      }
      // The native surfaces exist for both: they are not Nexus replacements.
      for (const tool of NATIVE_SURFACES) {
        expect(nexusTools).toContain(tool)
        expect(standardTools).toContain(tool)
      }

      // A non-Nexus caller cannot reach a Nexus registration through the
      // registry at all, and a Nexus caller cannot be reached by a stale handle.
      const throughStandard = await harness.call('read', { path: 'AGENTS.md' }, standardAgent)
      expect(throughStandard.isError).toBe(true)
      const definitions = harness.ctx.tools.schemas().map((schema) => schema.name as ToolDefinition['name'])
      expect(definitions).not.toContain('read')
    } finally {
      await harness.dispose()
    }
  }, 60_000)
})
