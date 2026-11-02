/**
 * A concrete third-party plugin for the integration suite.
 *
 * It is a real Cordis plugin, not a service-shaped double: it registers a
 * model-facing tool, contributes a system-prompt section, and ships preset rows
 * that give the native `standard` preset its own isolated compaction mechanism.
 * Everything it contributes is mounted by the shipped Loader, the shipped
 * `agentPresets` registry and the shipped tool pipeline, so the integration
 * cases observe exactly what a third-party bundle would add.
 *
 * The compaction rows deliberately reuse the SHIPPED compaction components
 * (`dsh-compaction-basic`, `dsh-command-compact`,
 * `dsh-compaction-tool-result-pruner`) with a distinctive pruner budget. That is
 * how a third-party bundle binds a mechanism to one preset id without shipping a
 * second implementation: the rows belong to the `standard` composition, live in
 * their own isolate realm, and are therefore invisible to a Nexus generation.
 *
 * Nothing here edits an installation file, mounts a second mechanism into the
 * Nexus generation, or registers anything globally for the compaction services.
 *
 * @module dsh-nexus/test/integration/third-party-fixture
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Model-facing tool name the third-party plugin contributes. */
export const THIRD_PARTY_TOOL = 'fixture_third_party_tool'

/** Marker the third-party tool returns, so a call is attributable to this plugin. */
export const THIRD_PARTY_TOOL_MARKER = 'FIXTURE-THIRD-PARTY-TOOL'

/** System-prompt section name the third-party plugin contributes. */
export const THIRD_PARTY_SECTION_NAME = 'third-party:fixture-section'

/** Exact literal text the third-party section contributes to every request. */
export const THIRD_PARTY_SECTION_TEXT =
  'THIRD-PARTY SECTION: the installed fixture contributes this literal line; marker FIXTURE-THIRD-PARTY-SECTION.'

/** Service name the fixture's own preset-scoped plugin provides as a presence marker. */
export const THIRD_PARTY_MARKER_SERVICE = 'nexusThirdPartyCompactionMarker'

/** Loader builtin name resolved by the fixture's compaction group. */
export const THIRD_PARTY_MARKER_BUILTIN = 'nexus-third-party-compaction-marker'

/** Preset row id of the isolated compaction group the fixture binds to `standard`. */
export const THIRD_PARTY_COMPACTION_GROUP = 'third-party-compaction'

/** Distinctive pruner budget, so the two mechanisms are distinguishable by fact. */
export const THIRD_PARTY_PRUNER_BUDGETS = Object.freeze({
  thresholdChars: 4_096,
  headChars: 2_048,
  tailChars: 512,
})

/** One recorded invocation of the third-party tool. */
export interface ThirdPartyToolInvocation {
  /** The `text` argument the native registry validated and delivered. */
  readonly text: string
}

/** What the integration cases get from one mounted fixture. */
export interface ThirdPartyFixture {
  /** Every invocation the shipped tool pipeline delivered, in order. */
  readonly toolInvocations: ThirdPartyToolInvocation[]
  /** Host-realm plugin: the extra tool and the extra system-prompt section. */
  readonly hostPlugin: {
    readonly name: string
    readonly inject: readonly string[]
    apply(ctx: Context): void
  }
  /** In-process plugins a `cordis:` preset row name resolves to. */
  readonly loaderBuiltins: Readonly<Record<string, unknown>>
  /** Rows appended to the native `standard` preset composition. */
  readonly standardPlugins: PresetDefinition['plugins']
}

/**
 * Build the fixture and the state its cases assert on.
 * @returns the plugin pieces plus the recorded invocations.
 */
export function createThirdPartyFixture(): ThirdPartyFixture {
  const toolInvocations: ThirdPartyToolInvocation[] = []

  const hostPlugin = {
    name: 'dsh-nexus-third-party-fixture',
    inject: ['tools', 'systemPrompt'] as readonly string[],
    apply(ctx: Context): void {
      ctx.tools.register(
        defineTool({
          name: THIRD_PARTY_TOOL,
          description: 'Third-party fixture tool; returns its argument beside a plugin marker.',
          parameters: {
            text: { type: 'string', required: true, description: 'Text the plugin echoes back.' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                marker: { type: 'string', required: true },
                echoed: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: `${value.marker}: ${value.echoed}` }],
            presentationMeta: (_args, value) => ({ marker: value.marker }),
          },
          async execute(args) {
            toolInvocations.push({ text: args.text })
            return { marker: THIRD_PARTY_TOOL_MARKER, echoed: args.text }
          },
        }),
      )
      ctx.systemPrompt.section({
        name: THIRD_PARTY_SECTION_NAME,
        order: 1_000,
        interpolate: false,
        text: THIRD_PARTY_SECTION_TEXT,
      })
    },
  }

  // The fixture's own code, running inside the `standard` generation scope. It is
  // the proof that the third-party plugin — not just a module-name list — was
  // mounted there, and that its contribution is unreachable from Nexus.
  const markerPlugin = {
    name: THIRD_PARTY_MARKER_BUILTIN,
    apply(ctx: Context): void {
      ctx.provide(THIRD_PARTY_MARKER_SERVICE, Object.freeze({ owner: 'third-party-fixture', boundTo: 'standard' }))
    },
  }

  const standardPlugins: PresetDefinition['plugins'] = [
    {
      id: THIRD_PARTY_COMPACTION_GROUP,
      name: 'cordis:group',
      group: true,
      isolate: { compaction: true, toolResultPruner: true, [THIRD_PARTY_MARKER_SERVICE]: true },
      config: [
        { id: 'third-party-compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
        { id: 'third-party-command-compact', name: '@deepseek-ai/dsh-command-compact' },
        {
          id: 'third-party-tool-result-pruner',
          name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
          config: { ...THIRD_PARTY_PRUNER_BUDGETS },
        },
        { id: 'third-party-compaction-marker', name: `cordis:${THIRD_PARTY_MARKER_BUILTIN}` },
      ],
    },
  ]

  return {
    toolInvocations,
    hostPlugin,
    loaderBuiltins: { [THIRD_PARTY_MARKER_BUILTIN]: markerPlugin },
    standardPlugins,
  }
}
