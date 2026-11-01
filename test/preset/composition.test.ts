/**
 * The Nexus preset's real composition, driven through the native preset registry.
 *
 * Every row in the definition is mounted by the shipped Loader and the shipped
 * `agentPresets` registry; the Nexus contribution row is the package's own built
 * sub-entry. Nothing is faked inside the composition: the only scripted members
 * are the model transport and the native web providers.
 *
 * The cases assert the fixed composition (the six Nexus tools plus the native
 * skill, question and todo surfaces), the absence of the first-party tools Nexus
 * replaces, the survival of a third-party contribution, an untouched `standard`
 * preset, one effective compaction mechanism, a real cold-path call chain and
 * repeated start/unload without registration growth.
 *
 * @module dsh-nexus/test/preset/composition
 */

import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { NEXUS_PRESET_ID } from '../../src/preset/definition.ts'
import { mountPresetHarness, type PresetHarness } from '../support/preset-harness.ts'

/** The six tools the Nexus preset owns. */
const NEXUS_CORE = ['read', 'write', 'edit', 'shell', 'web', 'agent'] as const

/** The native surfaces a Nexus session must keep. */
const NATIVE_SURFACES = ['skill', 'ask_user_question', 'todo_write'] as const

/** First-party tools Nexus replaces with its own capability. */
const REPLACED = ['bash', 'pwsh', 'subagent', 'subagent_fork', 'job_list'] as const

/**
 * Open a harness with the workspace baseline files a cold-path case needs.
 * @param withReplacements - register native-looking global tools as well.
 * @returns the mounted harness.
 */
async function openHarness(withReplacements = true): Promise<PresetHarness> {
  return mountPresetHarness({
    thirdPartyTools: ['example_extra_tool'],
    ...(withReplacements ? { nativeToolNames: [...REPLACED] } : {}),
  })
}

describe('nexus preset composition', () => {
  it('adds the nexus core without filtering other presets or extra tools', async () => {
    const harness = await openHarness()
    try {
      const standardAgent = await harness.createAgent('standard-session', 'standard')
      await harness.runTurn(standardAgent, 'before')
      const standardBefore = harness.toolNamesOf(standardAgent)
      // The native composition and the third-party contribution are visible
      // before Nexus exists at all.
      expect(standardBefore).toEqual(expect.arrayContaining([...NATIVE_SURFACES, 'example_extra_tool', ...REPLACED]))

      await harness.startNexus()
      await harness.runTurn(standardAgent, 'after')
      expect(harness.toolNamesOf(standardAgent)).toEqual(standardBefore)

      const nexusAgent = await harness.createAgent('nexus-session', NEXUS_PRESET_ID)
      await harness.runTurn(nexusAgent, 'compose')
      const names = harness.toolNamesOf(nexusAgent)

      expect(names).toEqual(expect.arrayContaining([...NEXUS_CORE, ...NATIVE_SURFACES, 'example_extra_tool']))
      // The first-party tools Nexus replaces are hidden from Nexus only; the
      // third-party tool is never filtered, and no unknown name is banned.
      for (const replaced of REPLACED) expect(names).not.toContain(replaced)
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('keeps one effective compaction mechanism inside the nexus scope', async () => {
    const harness = await openHarness(false)
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
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('serves the real cold path for storage, files, shell and prompts', async () => {
    const harness = await openHarness(false)
    try {
      await harness.startNexus()
      const agent = await harness.createAgent('nexus-cold', NEXUS_PRESET_ID)

      const written = await harness.call('write', { path: 'cold.txt', content: 'COLD PATH LINE\n' }, agent)
      expect(written.isError).toBe(false)
      const read = await harness.call('read', { path: 'cold.txt' }, agent)
      expect(read.isError).toBe(false)
      expect(read.value).toMatchObject({ kind: 'text', lines: [{ number: 1, text: 'COLD PATH LINE' }] })

      // The shell tool answers through the real process and terminal controllers.
      // A `list` needs no host executable, so this case stays machine-independent:
      // process/terminal spawning is Task 4/5's evidence, not this composition's.
      const shell = await harness.call('shell', { action: 'list' }, agent)
      expect(shell.isError).toBe(false)
      expect(shell.value).toMatchObject({ action: 'list', processes: [], terminals: [] })

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
    const harness = await openHarness(false)
    try {
      const baseline = harness.ctx.tools.schemas().map((schema) => schema.name).sort()
      expect(baseline).not.toContain('read')

      await harness.startNexus()
      const first = harness.ctx.tools.schemas().map((schema) => schema.name).sort()
      const firstAgent = await harness.createAgent('nexus-repeat-a', NEXUS_PRESET_ID)
      await harness.runTurn(firstAgent, 'first')
      expect(harness.toolNamesOf(firstAgent)).toContain('read')

      await harness.stopNexus()
      expect(harness.ctx.tools.schemas().map((schema) => schema.name).sort()).toEqual(baseline)
      expect(harness.ctx.get('nexusRuntime')).toBeUndefined()

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

  it("publishes saved web results into the store the runtime's repository owns", async () => {
    const harness = await openHarness(false)
    try {
      const runtime = await harness.startNexus()
      const first = await harness.createAgent('repo-first', NEXUS_PRESET_ID)
      const second = await harness.createAgent('repo-second', NEXUS_PRESET_ID)

      const fetched = await harness.call('web', { action: 'fetch', urls: ['https://fixture.test/first'] }, first)
      expect(fetched.isError).toBe(false)
      const resultId = (fetched.value as { items: { resultId: string }[] }).items[0]?.resultId as string

      // The tool published into the durable store the runtime's repository is
      // built over, so reading through `runtime.webResults` finds the record the
      // tool just handed out. Sharing the STORE is what this can observe; the
      // repository INSTANCE is shared by construction (the preset hands
      // `runtime.webResults` to every generation), and a distinguishing test for
      // two publication chains would need the concurrent-publication race Task 13
      // can attempt against a real deployment.
      const saved = await runtime.webResults.read('repo-first', resultId)
      expect(saved.document.resultId).toBe(resultId)
      expect(saved.text).toContain('FIXTURE WEB BODY')

      // A second Nexus session and a second generation both reach the same
      // authoritative repository, which keeps each durable owner separate.
      const otherFetched = await harness.call('web', { action: 'fetch', urls: ['https://fixture.test/second'] }, second)
      expect(otherFetched.isError).toBe(false)
      const otherId = (otherFetched.value as { items: { resultId: string }[] }).items[0]?.resultId as string
      await expect(runtime.webResults.read('repo-first', otherId)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_AVAILABLE',
      })
      expect(harness.ctx.get('nexusRuntime')).toBe(runtime)
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('exposes every nexus tool definition only through the nexus scope', async () => {
    const harness = await openHarness(false)
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
