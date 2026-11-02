/**
 * Integration: a concrete third-party plugin inside the real Nexus composition.
 *
 * Everything runs on the shipped host composition (`preset-harness`): the
 * Cordis Loader, the native `agentPresets` registry, the production AgentLoop,
 * the real session/storage/tool services and this package's built host row. The
 * only scripted members are external boundaries (model transport, web providers,
 * process spawn, confinement runner).
 *
 * What this file proves, in the brief's own terms:
 *
 * - the third-party tool exists in the assembled request AND executes through
 *   the native tool pipeline;
 * - the third-party system-prompt section reaches the captured request;
 * - a compaction mechanism the third-party plugin binds only to the native
 *   `standard` preset id is reported as NOT inheritable, while the Nexus
 *   generation still ends with exactly one effective mechanism of its own.
 *
 * @module dsh-nexus/test/integration/preset
 */

import { describe, expect, it } from 'vitest'
import { NEXUS_PRESET_ID } from '../../src/preset/definition.ts'
import { detectNativeComposition } from '../../src/preset/native.ts'
import { mountPresetHarness, type PresetHarness } from '../support/preset-harness.ts'
import {
  createThirdPartyFixture,
  THIRD_PARTY_MARKER_SERVICE,
  THIRD_PARTY_PRUNER_BUDGETS,
  THIRD_PARTY_SECTION_TEXT,
  THIRD_PARTY_TOOL,
  THIRD_PARTY_TOOL_MARKER,
  type ThirdPartyFixture,
} from './third-party-fixture.ts'

/** The three shipped compaction modules one mechanism is composed from. */
const COMPACTION_MODULES = [
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-command-compact',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
] as const

/** One pruner resolved inside a generation, viewed through its public contract. */
interface ResolvedPruner {
  readonly config: { readonly thresholdChars: number; readonly headChars: number; readonly tailChars: number }
  pruneContent(blocks: readonly { type: 'text'; text: string }[]): readonly { type: string; text?: string }[] | null
}

/** One mounted fixture harness plus its third-party state. */
interface MountedThirdParty {
  readonly harness: PresetHarness
  readonly thirdParty: ThirdPartyFixture
}

/**
 * Mount the host composition, the third-party host plugin and its preset rows.
 * @param hostCompaction - mount the shipped native pair in the host realm.
 * @returns the harness and the fixture's recorded state.
 */
async function mountThirdParty(hostCompaction?: 'pair'): Promise<MountedThirdParty> {
  const thirdParty = createThirdPartyFixture()
  const harness = await mountPresetHarness({
    ...(hostCompaction === undefined ? {} : { hostCompaction }),
    standardPlugins: thirdParty.standardPlugins,
    loaderBuiltins: thirdParty.loaderBuiltins,
  })
  await harness.ctx.plugin(thirdParty.hostPlugin)
  return { harness, thirdParty }
}

/**
 * Read the pruner a generation owns, through its public contract.
 * @param harness - mounted harness.
 * @param agent - agent whose generation is read.
 * @returns the pruner, or undefined when the generation owns none.
 */
function prunerOf(harness: PresetHarness, agent: Parameters<PresetHarness['toolNamesOf']>[0]): ResolvedPruner | undefined {
  return harness.ctx.agentPresets.serviceFor(agent, 'toolResultPruner' as 'llm') as unknown as ResolvedPruner | undefined
}

/**
 * Read the compaction engine a generation owns.
 * @param harness - mounted harness.
 * @param agent - agent whose generation is read.
 * @returns the engine, or undefined when the generation owns none.
 */
function engineOf(harness: PresetHarness, agent: Parameters<PresetHarness['toolNamesOf']>[0]): unknown {
  return harness.ctx.agentPresets.serviceFor(agent, 'compaction' as 'llm')
}

describe('third-party compatibility in the real composition', () => {
  // test: verifies_native_skill_loading_and_actual_third_party_compatibility
  it('executes the third-party tool, delivers its section, and isolates its compaction to standard', async () => {
    const { harness, thirdParty } = await mountThirdParty()
    try {
      await harness.startNexus()
      const standardAgent = await harness.createAgent('third-party-standard', 'standard')
      const nexusAgent = await harness.createAgent('third-party-nexus', NEXUS_PRESET_ID)
      await harness.runTurn(standardAgent, 'standard request')
      await harness.runTurn(nexusAgent, 'nexus request')

      // The tool is advertised in the REAL assembled request, for both presets:
      // a third-party contribution is never filtered by the Nexus composition.
      expect(harness.toolNamesOf(standardAgent)).toContain(THIRD_PARTY_TOOL)
      expect(harness.toolNamesOf(nexusAgent)).toContain(THIRD_PARTY_TOOL)

      // The section is part of the assembled system prompt, not a file on disk.
      expect(harness.promptTextOf(standardAgent)).toContain(THIRD_PARTY_SECTION_TEXT)
      expect(harness.promptTextOf(nexusAgent)).toContain(THIRD_PARTY_SECTION_TEXT)

      // ...and the tool really executes through the shipped registry pipeline.
      const called = await harness.call(THIRD_PARTY_TOOL, { text: 'integration payload' }, nexusAgent)
      expect(called.isError, JSON.stringify(called)).toBe(false)
      expect(called.value).toEqual({ marker: THIRD_PARTY_TOOL_MARKER, echoed: 'integration payload' })
      expect(thirdParty.toolInvocations).toEqual([{ text: 'integration payload' }])

      // The third-party plugin bound a compaction mechanism to the `standard`
      // preset id only. Nexus's own decision function must report that it cannot
      // inherit it, and must still mount exactly one isolated mechanism.
      const native = detectNativeComposition(harness.ctx)
      expect(native.compaction).toBe('absent')
      expect(native.evidence.join('\n')).toContain('the host realm resolves no `compaction` service')
      expect(native.evidence.join('\n')).toContain(
        'preset "standard" composes @deepseek-ai/dsh-compaction-basic, @deepseek-ai/dsh-command-compact, @deepseek-ai/dsh-compaction-tool-result-pruner inside its own generation scope, which a Nexus generation does not inherit',
      )
      // The host realm stays clean: nothing leaked out of the standard scope.
      expect(harness.ctx.get('compaction')).toBeUndefined()
      expect(harness.ctx.get('toolResultPruner')).toBeUndefined()

      // The standard generation resolves the third-party mechanism it composes,
      // with the fixture's distinctive budget and its own marker service.
      const standardPruner = prunerOf(harness, standardAgent)
      expect(standardPruner).toBeDefined()
      expect(standardPruner?.config).toEqual(THIRD_PARTY_PRUNER_BUDGETS)
      expect(harness.ctx.agentPresets.serviceFor(standardAgent, THIRD_PARTY_MARKER_SERVICE as 'llm')).toMatchObject({
        owner: 'third-party-fixture',
        boundTo: 'standard',
      })

      // The Nexus generation owns exactly ONE mechanism, and it is its own
      // isolated native pair — never the third-party one.
      const nexusPruner = prunerOf(harness, nexusAgent)
      expect(nexusPruner).toBeDefined()
      expect(nexusPruner?.config).toEqual({ thresholdChars: 8_192, headChars: 4_096, tailChars: 1_024 })
      expect(engineOf(harness, nexusAgent)).toBeDefined()
      expect(engineOf(harness, nexusAgent)).not.toBe(engineOf(harness, standardAgent))
      // The fixture's own scoped marker is not reachable from a Nexus Agent.
      expect(harness.ctx.agentPresets.serviceFor(nexusAgent, THIRD_PARTY_MARKER_SERVICE as 'llm')).toBeUndefined()
      // The standard agent keeps its own mechanism, not Nexus's.
      expect(prunerOf(harness, standardAgent)).not.toBe(nexusPruner)

      // Both mechanisms really work, each with its own budget: the same
      // over-budget text is cut to a different head window per generation.
      const text = 'A'.repeat(20_000)
      const standardOut = standardPruner?.pruneContent([{ type: 'text', text }]) ?? []
      const nexusOut = nexusPruner?.pruneContent([{ type: 'text', text }]) ?? []
      expect((standardOut as readonly { text?: string }[])[0]?.text?.startsWith('A'.repeat(2_048))).toBe(true)
      expect((nexusOut as readonly { text?: string }[])[0]?.text?.startsWith('A'.repeat(4_096))).toBe(true)

      // Never two Nexus mechanisms: exactly one of each module in its composition.
      const nexusRows = (await harness.presetRows(NEXUS_PRESET_ID)).map((row) => row.moduleName)
      for (const module of COMPACTION_MODULES) {
        expect(nexusRows.filter((name) => name === module), `${module} count`).toHaveLength(1)
      }
      const standardRows = (await harness.presetRows('standard')).map((row) => row.moduleName)
      for (const module of COMPACTION_MODULES) {
        expect(standardRows.filter((name) => name === module), `${module} count`).toHaveLength(1)
      }
    } finally {
      await harness.dispose()
    }
  }, 120_000)

  it('does not stack a mechanism when the host realm already supplies the effective pair', async () => {
    const { harness } = await mountThirdParty('pair')
    try {
      // Compatibility decision for a host that really composes the pair: inherit
      // it, mount nothing, and leave the standard-only mechanism where it is.
      expect(detectNativeComposition(harness.ctx).compaction).toBe('host')
      await harness.startNexus()
      const nexusAgent = await harness.createAgent('inherit-nexus', NEXUS_PRESET_ID)
      const standardAgent = await harness.createAgent('inherit-standard', 'standard')
      await harness.runTurn(nexusAgent, 'nexus')
      await harness.runTurn(standardAgent, 'standard')

      // Nexus composes no compaction row at all in this branch.
      const nexusRows = (await harness.presetRows(NEXUS_PRESET_ID)).map((row) => row.moduleName)
      for (const module of COMPACTION_MODULES) expect(nexusRows, module).not.toContain(module)
      expect(engineOf(harness, nexusAgent)).toBeUndefined()
      expect(prunerOf(harness, nexusAgent)).toBeUndefined()

      // Its effective pair is the single host mechanism the row inherited.
      const effectiveEngine = nexusAgent.ctx.get('compaction') as unknown as { constructor: { name: string } }
      const effectivePruner = nexusAgent.ctx.get('toolResultPruner') as unknown as { constructor: { name: string } }
      expect(effectiveEngine?.constructor.name).toBe('BasicCompactionEngine')
      expect(effectivePruner?.constructor.name).toBe('ToolResultPruner')

      // The third-party mechanism stays bound to `standard` and is NOT the one
      // the Nexus agent runs: two live scopes, one effective mechanism each.
      const standardPruner = prunerOf(harness, standardAgent)
      expect(standardPruner?.config).toEqual(THIRD_PARTY_PRUNER_BUDGETS)
      expect(standardAgent.ctx.get('compaction')).not.toBe(nexusAgent.ctx.get('compaction'))
      // Exactly one mechanism per generation: no third row was added anywhere.
      const standardRows = (await harness.presetRows('standard')).map((row) => row.moduleName)
      for (const module of COMPACTION_MODULES) {
        expect(standardRows.filter((name) => name === module), module).toHaveLength(1)
      }
    } finally {
      await harness.dispose()
    }
  }, 120_000)
})
