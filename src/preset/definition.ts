/**
 * The fixed composition of the Nexus preset.
 *
 * A preset declares its own module list; it inherits nothing from `standard`.
 * What Nexus needs from the native product is therefore named here explicitly:
 *
 * - `dsh-nexus/preset` — this package's own sub-entry, which registers the Nexus
 *   tools, the persona contribution and the Agent membership inside the
 *   generation scope. It carries no state: the host row owns the runtime.
 * - `agent-instructions` — the project instruction surface (`AGENTS.md`), so a
 *   Nexus session still receives the repository's own guidance.
 * - `skill-filesystem` + `tool-skill` — the native skill discovery and the
 *   `skill` tool (no Nexus equivalent exists, so the native one is mounted).
 * - `tool-ask-user` — the native structured question tool.
 * - `tool-todo` — the native todo tracker.
 * - a compaction group, only when the host realm does not already supply one.
 *
 * Deliberately absent: `tool-fs`, `tool-fs-search`, `tool-bash`, `tool-pwsh`,
 * `tool-jobs`, `tool-web` and the `tool-subagent*` family. Nexus replaces those
 * capabilities with its own tools, and the preset does not mount two
 * implementations of one capability.
 *
 * The compaction group is isolated (`compaction`/`toolResultPruner` realms) for
 * the same reason the native presets isolate it: a Nexus generation must own the
 * one mechanism its Agents use, and an isolated realm means the group cannot
 * reach into — or be reached by — the host's own mechanism.
 *
 * @module dsh-nexus/preset/definition
 */

import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Config } from '../config.ts'
import { NexusError } from '../runtime/errors.ts'
import type { NativeComposition } from './native.ts'

/** Stable preset id a session records and the console selects. */
export const NEXUS_PRESET_ID = 'nexus'

/** Display name of the preset in the native selection roster. */
export const NEXUS_PRESET_NAME = 'Nexus'

/** Loader entry id of this package's preset sub-entry. */
export const NEXUS_PRESET_ROW_ID = 'dsh-nexus-runtime'

/** Module specifier of the preset contribution sub-entry. */
export const NEXUS_PRESET_ENTRY = 'dsh-nexus/preset'

/** Roster position: after the native `standard` preset (order 1). */
export const NEXUS_PRESET_ORDER = 2

/** Byte budget for the project instruction file, matching the native preset. */
export const NEXUS_INSTRUCTIONS_MAX_BYTES = 65_536

/** The native tool-result pruning budgets of the isolated Nexus mechanism. */
export const NEXUS_PRUNER_LIMITS = Object.freeze({
  thresholdChars: 8_192,
  headChars: 4_096,
  tailChars: 1_024,
})

/** One declared child row of the definition. */
type PresetRow = PresetDefinition['plugins'][number]

/**
 * The rows every Nexus generation mounts.
 *
 * Kept as a function so each call produces a fresh, mutable array: the registry
 * stores the definition and the console serializes it, and sharing one frozen
 * array between callers would make a later edit of one visible in another.
 * @param deployment - validated row configuration of the `dsh-nexus` host row.
 * @returns the rows in declaration order.
 */
function baseRows(deployment: Config): PresetRow[] {
  return [
    {
      id: NEXUS_PRESET_ROW_ID,
      name: NEXUS_PRESET_ENTRY,
      // The row repeats the deployment config so the composition itself shows
      // which executables the installation asked for. Behaviour still reads the
      // runtime's committed snapshot, which is the one authority.
      config: {
        ...(deployment.bashPath === undefined ? {} : { bashPath: deployment.bashPath }),
        ...(deployment.pwshPath === undefined ? {} : { pwshPath: deployment.pwshPath }),
      },
    },
    {
      id: 'agent-instructions',
      name: '@deepseek-ai/dsh-agent-instructions',
      config: { maxBytes: NEXUS_INSTRUCTIONS_MAX_BYTES },
    },
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    {
      id: 'tool-todo',
      name: '@deepseek-ai/dsh-tool-todo',
      config: { allowParallelInProgress: true },
    },
  ]
}

/**
 * The isolated compaction group a Nexus generation mounts when it inherits none.
 * @returns one group row holding the backend, the human command and the pruner.
 */
function compactionRow(): PresetRow {
  return {
    id: 'compaction',
    name: 'cordis:group',
    group: true,
    isolate: { compaction: true, toolResultPruner: true },
    config: [
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      {
        id: 'tool-result-pruner',
        name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
        config: { ...NEXUS_PRUNER_LIMITS },
      },
    ],
  }
}

/**
 * Build the Nexus preset definition.
 *
 * @param config - validated deployment configuration of the `dsh-nexus` row.
 * @param native - what the host realm already supplies.
 * @returns the definition the host row registers under {@link NEXUS_PRESET_ID}.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when the inherited compaction
 *   capability is ambiguous; mounting a second mechanism or assuming the
 *   partial one is complete would both be guesses.
 */
export function createNexusPreset(config: Config, native: NativeComposition): PresetDefinition {
  if (native.compaction === 'ambiguous') {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot compose the Nexus preset: the inherited compaction capability is ambiguous. ${native.evidence.join('; ')}`,
    )
  }
  const rows = baseRows(config)
  if (native.compaction === 'absent') rows.push(compactionRow())
  return {
    id: NEXUS_PRESET_ID,
    name: NEXUS_PRESET_NAME,
    description:
      native.compaction === 'host'
        ? 'Nexus: files, shell, web, internal agents, native skills/questions/todos and the host compaction mechanism.'
        : 'Nexus: files, shell, web, internal agents, native skills/questions/todos and an isolated compaction mechanism.',
    order: NEXUS_PRESET_ORDER,
    plugins: rows,
  }
}
