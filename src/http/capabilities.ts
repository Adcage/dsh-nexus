/** Read-only, effective-scope registration facts; never resolve backend readiness. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-terminal'
import type {} from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-llm'
import type { ConsoleBackendRegistration, ConsoleCapabilities } from '../protocol.ts'

function inspectService<T>(
  resolve: () => T | undefined,
  enumerate?: (service: T) => readonly string[],
): ConsoleBackendRegistration {
  let service: T | undefined
  try { service = resolve() } catch {
    return { service: 'unknown', backends: { state: 'unknown', names: null }, readiness: 'unverified' }
  }
  if (service === undefined) {
    return { service: 'absent', backends: { state: 'absent', names: [] }, readiness: 'unverified' }
  }
  const uninspectable: ConsoleBackendRegistration = {
    service: 'present', backends: { state: 'unknown', names: null }, readiness: 'unverified',
  }
  if (enumerate === undefined) return uninspectable
  try {
    const names = enumerate(service)
    // A foreign implementation must not smuggle objects/configuration through
    // the public names contract, or make a failed inspection look like absence.
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) return uninspectable
    return { service: 'present', backends: { state: names.length === 0 ? 'absent' : 'registered', names: [...names] }, readiness: 'unverified' }
  } catch { return uninspectable }
}

/** Synchronous route ids only; initial console load never interrogates adapters. */
export function inspectModelProviders(ctx: Context): readonly string[] {
  try { return ctx.get('llm')?.listProviders().map((provider) => provider.id) ?? [] } catch { return [] }
}

/** Advisory, lazy model ids owned by one HTTP registration. Same-provider calls
 * join the underlying adapter operation, even after a caller's 1.5s wait ends:
 * the SDK cannot cancel listModels. Only adapter settlement releases the entry.
 * Never forward adapter metadata or errors; completed results are not cached. */
export function createModelInspector(ctx: Context): (provider: string) => Promise<readonly string[]> {
  const inFlight = new Map<string, Promise<readonly string[]>>()
  return async (provider) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const llm = ctx.get('llm')
      if (llm === undefined) return []
      let lookup = inFlight.get(provider)
      if (lookup === undefined) {
        lookup = Promise.resolve().then(() => llm.listModels(provider))
          .then((models) => models.map((model) => model.id))
          .catch(() => [])
          .finally(() => { inFlight.delete(provider) })
        inFlight.set(provider, lookup)
      }
      return await Promise.race([
        lookup,
        new Promise<readonly string[]>((resolve) => { timer = setTimeout(() => resolve([]), 1500) }),
      ])
    } catch { return [] } finally { clearTimeout(timer) }
  }
}

/** Re-read optional public registries on each guarded request. ctx.get does not
 * require the optional service to activate the host or expose private fields. */
export function inspectBackendRegistrations(ctx: Context): ConsoleCapabilities['backendRegistrations'] {
  return {
    scope: 'effective-http-context',
    terminal: inspectService(() => ctx.get('terminals'), (service) => service.listBackends()),
    // WebRuntime exposes search/fetch execution, not public provider enumeration.
    // Calling execution/available() or reading provider/config maps is not inspection.
    web: inspectService(() => ctx.get('web')),
    internalAgent: inspectService(() => ctx.get('subagents'), (service) => service.list()),
  }
}
