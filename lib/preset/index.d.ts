import { t as Config$1 } from "../config-C2yeChUF.js";
import { Context } from "@deepseek-ai/cordis";
/** Loader row id of this sub-entry; distinct from the package name on purpose. */
declare const name = "dsh-nexus-runtime";
/**
 * Services this row reads at activation or on the cold path.
 *
 * Declaring them keeps the row pending until the composition can actually serve
 * a call, instead of activating and failing on the first request. Optional
 * services read per call (`attachments`, `llm`, `sessionQuery`) are deliberately
 * absent: a text-only deployment is complete without them, and each call
 * reports the missing capability itself.
 *
 * `terminals` is deliberately NOT here: the deployed profile has no host-level
 * terminal service (the native presets each own one inside their generation
 * scope), and this row provides its own — a row that both required and provided
 * the same service would wait on itself forever.
 */
declare const inject: readonly string[];
/** The row's own configuration schema; mirrors the deployment config. */
declare const Config: import("@deepseek-ai/schemastery").default<Config$1>;
/**
 * Register the Nexus contributions of one preset generation.
 *
 * Called by the Loader when this row activates; everything it creates is owned
 * by `ctx`, and the cleanup facts a generation can actually prove are attached
 * to the runtime so its teardown reports them.
 * @param ctx - the generation scope.
 * @param config - the row configuration (deployment executables); behaviour
 *   still reads the runtime's committed snapshot.
 */
declare function apply(ctx: Context, config: Config$1): void;
export { Config, apply, inject, name };
//# sourceMappingURL=index.d.ts.map