/**
 * What the Nexus preset may inherit from the host composition.
 *
 * A preset does not inherit the `standard` preset's modules: its rows are its
 * whole composition, and the only things a Nexus Agent also sees are the
 * services the HOST mounts in the realm the preset generation hangs under. That
 * makes "is there already an effective compaction mechanism?" a question about
 * that realm, not about a package name and not about "the service exists
 * somewhere".
 *
 * The detection below therefore reads three real facts:
 *
 * 1. the services resolved from the host context the root row runs in — that is
 *    the realm a Nexus generation inherits from;
 * 2. the contract shape of each resolved service, so a placeholder or a
 *    differently-typed service is not mistaken for the mechanism;
 * 3. the retained preset generations' live modules, so a mechanism that exists
 *    only inside another preset's isolated scope is reported as NOT inheritable
 *    instead of silently assumed.
 *
 * One compaction engine without the tool-result pruner (or the other way round)
 * is an ambiguous host composition: neither "inherit it" nor "mount the whole
 * group" is provably right, so {@link createNexusPreset} refuses instead of
 * fabricating inheritance.
 *
 * @module dsh-nexus/preset/native
 */

import type { Context } from '@deepseek-ai/cordis'

/** Whether the host realm already supplies one effective compaction mechanism. */
export type CompactionInheritance = 'host' | 'absent' | 'ambiguous'

/** Inheritable native composition facts of the host the Nexus row mounted into. */
export interface NativeComposition {
  /**
   * The compaction decision for a Nexus generation.
   *
   * - `host`: the host realm carries both the engine and the pruner, so the
   *   Nexus preset must NOT mount a second mechanism.
   * - `absent`: the host realm carries neither, so the Nexus preset mounts its
   *   own isolated group.
   * - `ambiguous`: exactly one of the two is present, or a present one does not
   *   satisfy its contract; the preset is refused.
   */
  readonly compaction: CompactionInheritance
  /**
   * The concrete facts behind {@link NativeComposition.compaction}, in
   * occurrence order. Used for the failure message and for the report; never
   * parsed to make a decision.
   */
  readonly evidence: readonly string[]
}

/** Modules that make up one compaction mechanism in a live preset generation. */
const COMPACTION_MODULES: readonly string[] = Object.freeze([
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-command-compact',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
])

/**
 * Whether one resolved value satisfies the compaction engine contract.
 * @param engine - service resolved as `compaction`.
 * @returns true only for an object exposing the three documented operations.
 */
function isCompactionEngine(engine: unknown): boolean {
  if (engine === null || typeof engine !== 'object') return false
  const contract = engine as Record<string, unknown>
  return (
    typeof contract.compactIfNeeded === 'function' &&
    typeof contract.compactNow === 'function' &&
    typeof contract.compactRegion === 'function'
  )
}

/**
 * Whether one resolved value satisfies the tool-result pruner contract.
 * @param pruner - service resolved as `toolResultPruner`.
 * @returns true only for an object that can measure, prune and rewrite a session.
 */
function isToolResultPruner(pruner: unknown): boolean {
  if (pruner === null || typeof pruner !== 'object') return false
  const contract = pruner as Record<string, unknown>
  return typeof contract.pruneContent === 'function' && typeof contract.pruneSession === 'function'
}

/**
 * Read which retained preset generations compose a compaction mechanism inside
 * their own scope.
 *
 * This is contribution evidence at the target scope, not a module-name guess:
 * the registry reports the modules of each live generation, and a generation's
 * isolated rows are exactly what a different preset's Agents see. They are
 * reported because they are NOT available to a Nexus Agent.
 * @param ctx - host context.
 * @returns one line per generation that composes a compaction module.
 */
function scopedCompactionFacts(ctx: Context): readonly string[] {
  const presets = ctx.get('agentPresets')
  if (presets === undefined) return []
  const facts: string[] = []
  for (const composition of presets.inspectCompositions()) {
    const modules = composition.modules.map((module) => module.moduleName).filter((name) => COMPACTION_MODULES.includes(name))
    if (modules.length === 0) continue
    facts.push(
      `preset "${composition.id}" composes ${modules.join(', ')} inside its own generation scope, which a Nexus generation does not inherit`,
    )
  }
  return facts
}

/**
 * Detect the composition a Nexus preset may rely on.
 *
 * Call from the host context that opens the runtime, after the native services
 * it reads are mounted. The read is synchronous and side-effect free: it
 * resolves two services, checks their contract shape and asks the preset
 * registry for its live generations.
 * @param ctx - host context of the `dsh-nexus` row.
 * @returns the decision plus the facts behind it.
 */
export function detectNativeComposition(ctx: Context): NativeComposition {
  const engine = ctx.get('compaction')
  const pruner = ctx.get('toolResultPruner')
  const engineOk = isCompactionEngine(engine)
  const prunerOk = isToolResultPruner(pruner)
  const scoped = scopedCompactionFacts(ctx)
  const evidence: string[] = []

  if (engine !== undefined) {
    evidence.push(
      engineOk
        ? 'the host realm resolves a `compaction` engine that implements compactIfNeeded/compactNow/compactRegion'
        : 'the host realm resolves a `compaction` service that does not implement the compaction engine contract',
    )
  } else {
    evidence.push('the host realm resolves no `compaction` service')
  }
  if (pruner !== undefined) {
    evidence.push(
      prunerOk
        ? 'the host realm resolves a `toolResultPruner` that can measure, prune and rewrite tool results'
        : 'the host realm resolves a `toolResultPruner` that does not implement the pruner contract',
    )
  } else {
    evidence.push('the host realm resolves no `toolResultPruner` service')
  }
  evidence.push(...scoped)

  if (engineOk && prunerOk) {
    evidence.push('a Nexus generation inherits this one mechanism, so the preset mounts none of its own')
    return Object.freeze({ compaction: 'host', evidence: Object.freeze(evidence) })
  }
  if (engine === undefined && pruner === undefined) {
    evidence.push('no compaction mechanism is inherited, so the preset mounts one isolated group')
    return Object.freeze({ compaction: 'absent', evidence: Object.freeze(evidence) })
  }
  evidence.push('the inherited compaction capability is only partly present, so the preset refuses to guess')
  return Object.freeze({ compaction: 'ambiguous', evidence: Object.freeze(evidence) })
}
