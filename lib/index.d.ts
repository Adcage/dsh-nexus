import { t as Config } from "./config-C2yeChUF.js";
import { Context } from "@deepseek-ai/cordis";
/** Loader row id; mirrors the package name and `cordis.patch.yml`. */
declare const name = "dsh-nexus";
/**
 * Services this row needs before it may activate.
 *
 * `storageDomain` comes from the runtime opener's own cold path; `agentPresets`
 * is the registry the preset definition is declared into. A row that activated
 * without them would throw mid-composition and leave the deployment without a
 * runtime, so both are declared rather than discovered.
 */
declare const inject: string[];
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
declare function apply(ctx: Context, config: Config): Promise<void>;
export { Config, apply, inject, name };
//# sourceMappingURL=index.d.ts.map