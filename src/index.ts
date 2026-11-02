/**
 * `dsh-nexus` — host half.
 *
 * The Loader row mounts this module in the harness process; the manifest's
 * `dsh.client` declaration loads the browser half (`./client`) in the web GUI.
 * It is the one owner of Nexus host state:
 *
 * - it opens (or joins) the single {@link NexusRuntime} — one durable store, one
 *   committed settings record, one write coordinator, one prompt-session owner
 *   and one saved-result repository — and publishes it as `nexusRuntime`;
 * - it detects which native mechanism the host realm already supplies and
 *   registers the fixed Nexus preset definition under the id `nexus`.
 *
 * Composition order is the contract. The runtime is opened from this row's own
 * activation (so the store and the teardown effect belong to this fiber), the
 * preset is registered afterwards, and no preset diagnostic is awaited here:
 * the registry audits a mounted tree against the settled host Loader, and
 * waiting for that inside the row's own activation would wait on itself.
 *
 * @module dsh-nexus
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config as NexusConfig } from './config.ts'
import { createNexusPreset } from './preset/definition.ts'
import { detectNativeComposition } from './preset/native.ts'
import { NEXUS_RUNTIME_INJECT, openNexusRuntime } from './runtime/service.ts'
import { registerRoutes } from './http/routes.ts'

/** Loader row id; mirrors the package name and `cordis.patch.yml`. */
export const name = 'dsh-nexus'

/**
 * Services this row needs before it may activate.
 *
 * `storageDomain` comes from the runtime opener's own cold path; `agentPresets`
 * is the registry the preset definition is declared into. A row that activated
 * without them would throw mid-composition and leave the deployment without a
 * runtime, so both are declared rather than discovered.
 */
export const inject: string[] = [...NEXUS_RUNTIME_INJECT, 'agentPresets']

export { Config } from './config.ts'

/**
 * Host-half entry point.
 *
 * @param ctx - host plugin context; it owns the shared runtime and the
 *   registered preset definition. It owns no terminal capability: each preset
 *   generation mounts the native terminal service and its backends in its own
 *   isolated scope (see `preset/index.ts`).
 * @param config - validated deployment configuration for the row.
 * @throws NexusError when the native storage service is missing, when the
 *   inherited compaction capability is ambiguous, or when the preset definition
 *   cannot be mounted.
 */
export async function apply(ctx: Context, config: NexusConfig): Promise<void> {
  const runtime = await openNexusRuntime(ctx, config)

  // Optional transport: a headless/CLI host still owns the same runtime/preset.
  // This narrower gate also declares the native registry needed on HTTP cold paths.
  ctx.inject(['webServer', 'agents'], (scope) => { registerRoutes(scope, runtime) })

  const native = detectNativeComposition(ctx)
  const definition = createNexusPreset(config, native)
  const unregister = await ctx.agentPresets.register(definition)
  ctx.effect(() => unregister, 'dsh-nexus preset definition')
}
