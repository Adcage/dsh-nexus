/**
 * The one seam between the `web` tool and the native web capability.
 *
 * This wrapper does exactly one thing: run a search or a fetch through the
 * `ctx.web` service of the *current* context and hand back whatever the native
 * provider returned. It never selects or pins a provider, never retries, never
 * falls back to another account or provider, and never re-fetches a URL the tool
 * already obtained. Provider selection, cancellation and native refusal codes
 * stay owned by `@deepseek-ai/dsh-web`; an error is passed through unchanged so
 * its code reaches the caller instead of being relabelled here.
 *
 * @module dsh-nexus/web/backend
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  WebFetchRequest,
  WebFetchResult,
  WebRuntime,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'
import { NexusError } from '../runtime/errors.ts'

/** The two native web capabilities the tool uses, and nothing else. */
export interface WebBackend {
  /**
   * Run one search through the current native provider.
   * @param request - the query and the source bound.
   * @param signal - caller cancellation, forwarded to the provider.
   * @returns the provider's search outcome.
   */
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
  /**
   * Retrieve one URL through the current native provider.
   * @param request - the URL to retrieve.
   * @param signal - caller cancellation, forwarded to the provider.
   * @returns the provider's fetch outcome.
   */
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
}

/**
 * Resolve the native web service of this context.
 *
 * The service is read per call rather than captured, so a scope that mounts it
 * after this factory (or unloads it) is handled honestly instead of using a
 * stale reference.
 * @param ctx - the scope the tool runs in.
 * @returns the native web service.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when the scope has no `ctx.web`.
 */
function requireWeb(ctx: Context): WebRuntime {
  const web = ctx.get('web')
  if (web === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      'the web tool needs the native ctx.web service; this scope does not provide one',
    )
  }
  return web
}

/**
 * Wrap the current native search/fetch capability.
 * @param ctx - a context that provides `ctx.web`.
 * @returns the backend the tool calls.
 */
export function createDshWebBackend(ctx: Context): WebBackend {
  return {
    search: async (request, signal) => requireWeb(ctx).search(request, signal),
    fetch: async (request, signal) => requireWeb(ctx).fetch(request, signal),
  }
}
