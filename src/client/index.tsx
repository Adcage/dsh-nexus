/**
 * `dsh-nexus` — browser half.
 *
 * The `dsh.client` manifest entry in package.json loads this bundle in the web
 * GUI; the bundle must register itself under the package name, because that id
 * is the boot graph row id. It contributes the plugin's locale dictionaries
 * here, wrapped in the one effect that owns their lifetime, and the console
 * surface arrives with the task that builds it.
 *
 * Two rules shape this file:
 * - every registration goes through `ctx.effect`, whose callback returns the
 *   disposer, so unloading the bundle removes exactly what it installed;
 * - `apply` catches its own failures, because the web shell fails the whole boot
 *   when a plugin's `apply` throws.
 *
 * @module dsh-nexus/client
 */

import en from '../locale/en.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }

/** Console key and locale namespace; the sidebar and main registrations share it. */
export const NS = 'dshNexus'

/** Client services that must exist before this bundle may mount. */
export const inject: string[] = ['locale']

/** Structural face of the client locale service this bundle uses. */
interface LocaleService {
  /**
   * Publish one namespace's dictionaries.
   * @param namespace - locale namespace, equal to {@link NS}.
   * @param dictionaries - copy for the languages the web client ships.
   * @returns the disposer that withdraws the namespace.
   */
  register(
    namespace: string,
    dictionaries: { en: Record<string, string>; zh: Record<string, string> },
  ): () => void
}

/** Structural face of the client root context this bundle uses. */
interface ClientContext {
  /**
   * Run one registration and keep its disposer for unload.
   * @param callback - registration body returning its disposer.
   * @param label - effect label used by the host's diagnostics.
   */
  effect(callback: () => (() => void) | void, label?: string): void
  readonly locale: LocaleService
}

/**
 * Register the browser half.
 * @param ctx - client root context carrying the locale service.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-nexus: dictionaries')
  } catch (error) {
    console.warn('[dsh-nexus] the console could not mount', error)
  }
}
