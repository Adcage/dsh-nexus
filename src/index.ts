/**
 * `dsh-nexus` — host half.
 *
 * The Loader row mounts this module in the harness process; the manifest's
 * `dsh.client` declaration loads the browser half (`./client`) in the web GUI.
 * The row therefore exists from the start, while the host behaviour it will
 * compose — the Nexus preset, scoped tools, prompt contributions, the runtime
 * service and the console routes — is added by the tasks that own each seam.
 *
 * `name` is the row id: it must equal the package name and the `name` in
 * `cordis.patch.yml`. Nothing is registered here yet, so `inject` is empty and
 * unloading the row leaves no trace.
 *
 * @module dsh-nexus
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Config as NexusConfig } from './config.ts'

/** Loader row id; mirrors the package name and `cordis.patch.yml`. */
export const name = 'dsh-nexus'

/** Services required before this plugin may mount; none until a seam needs one. */
export const inject: string[] = []

export { Config } from './config.ts'

/**
 * Host-half entry point. The parameters are the shape every later registration
 * seam receives; this module currently contributes no host behaviour, which is
 * why it installs no effect and holds no service.
 * @param _ctx - host plugin context.
 * @param _config - validated deployment configuration for the row.
 */
export function apply(_ctx: Context, _config: NexusConfig): void {}
