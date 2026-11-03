/** Browser-only transport. Relative URLs, memory-only authorization, no mutation retries. */
import { z } from 'zod'
import { NEXUS_API_PREFIX, CHILD_ACCESS_SETTINGS, TOOL_DISPLAY_MODES, consolePromptPath, type ConsoleCapabilities, type PromptLibrary, type RuntimeSettings } from '../protocol.ts'

export type PublicCapabilities = Omit<ConsoleCapabilities, 'csrfToken'>
const strings = z.array(z.string())
const moduleSchema = z.object({ id: z.string(), name: z.string(), body: z.string() })
const library = z.object({ modules: z.array(moduleSchema), defaultSelection: strings }).refine((v) => {
  const ids = new Set(v.modules.map((m) => m.id))
  return ids.size === v.modules.length && new Set(v.defaultSelection).size === v.defaultSelection.length && v.defaultSelection.every((id) => ids.has(id))
})
const settings = z.object({
  files: z.object({ defaultLines: z.number().int(), maxOutputBytes: z.number().int() }),
  terminal: z.object({ engine: z.enum(['bash', 'pwsh']), bashPath: z.string().optional(), pwshPath: z.string().optional() }),
  agents: z.object({ concurrency: z.number().int(), maxDepth: z.number().int(),
    childAccess: z.enum(CHILD_ACCESS_SETTINGS).catch('read-only').default('inherit'),
    role: z.object({ name: z.string().optional(), instructions: z.string().optional(), model: z.string().optional(), provider: z.string().trim().transform((value) => value === '' ? undefined : value).optional() }).optional() }),
  web: z.object({ maxResults: z.number().int(), maxCharsPerPage: z.number().int() }),
  // The shape check normalises exactly like the host schema, so an older host
  // response without the field still loads and never reaches registration as an
  // unknown mode.
  toolDisplay: z.enum(TOOL_DISPLAY_MODES).catch('nexus'),
})
const backend = z.object({ service: z.enum(['present', 'absent', 'unknown']), backends: z.union([
  z.object({ state: z.enum(['registered', 'absent']), names: strings }), z.object({ state: z.literal('unknown'), names: z.null() }),
]), readiness: z.literal('unverified') })
const capabilities = z.object({ verification: z.literal('unverified'), registered: z.object({ consoleApi: z.literal(true), nexusRuntime: z.literal(true) }),
  backendRegistrations: z.object({ scope: z.literal('effective-http-context'), terminal: backend, web: backend, internalAgent: backend }),
  providers: strings.default([]),
  diagnostics: strings, settingsLocation: z.object({ namespace: z.literal('dsh-nexus'), domain: z.literal('dsh_nexus') }), basePrompt: z.string(),
})
const preview = z.object({ selection: strings, modules: z.array(moduleSchema), text: z.string() })
/** Shape checks only; host validation remains the authority on limits and saves. */
export const consoleData = {
  library: z.object({ value: library, hash: z.string().min(1) }),
  settings: z.object({ value: settings, hash: z.string().min(1) }),
  childModels: z.object({ models: strings }),
  capabilities, sessions: z.array(z.object({ id: z.string(), title: z.string() })),
  preview, prompt: preview.extend({ sessionId: z.string() }),
}
export class NexusApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'NexusApiError' }
}

export function createNexusApi(fetcher: typeof fetch = globalThis.fetch) {
  let csrfToken: string | undefined
  let authorizing: Promise<PublicCapabilities> | undefined
  async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    if (method !== 'GET' && csrfToken === undefined) await authorize()
    const response = await fetcher(path, { method, credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: method === 'GET' ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Nexus-CSRF': csrfToken! },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (response.redirected) throw new NexusApiError(502, 'INVALID_RESPONSE')
    let data: unknown
    try { data = await response.json() } catch { throw new NexusApiError(response.status, 'INVALID_RESPONSE') }
    if (!response.ok) {
      const failure = z.object({ error: z.object({ code: z.string() }) }).safeParse(data)
      if (response.status === 403) csrfToken = undefined
      throw new NexusApiError(response.status, failure.success ? failure.data.error.code : 'HTTP_ERROR')
    }
    return data
  }
  function authorize(): Promise<PublicCapabilities> {
    if (authorizing !== undefined) return authorizing
    authorizing = (async () => {
      const value = await request(`${NEXUS_API_PREFIX}/capabilities`)
      const token = z.object({ csrfToken: z.string().min(1) }).parse(value).csrfToken
      const facts = capabilities.parse(value)
      csrfToken = token
      return facts
    })().finally(() => { authorizing = undefined })
    return authorizing
  }
  return {
    capabilities: authorize,
    async childModels(provider: string) { return consoleData.childModels.parse(await request(`${NEXUS_API_PREFIX}/capabilities?provider=${encodeURIComponent(provider)}`)) },
    async library() { return consoleData.library.parse(await request(`${NEXUS_API_PREFIX}/library`)) },
    async settings() { return consoleData.settings.parse(await request(`${NEXUS_API_PREFIX}/settings`)) },
    async sessions() { return consoleData.sessions.parse(await request(`${NEXUS_API_PREFIX}/sessions`)) },
    async saveLibrary(value: PromptLibrary, expectedHash: string) { return consoleData.library.parse(await request(`${NEXUS_API_PREFIX}/library`, 'PUT', { value, expectedHash })) },
    async saveSettings(value: RuntimeSettings, expectedHash: string) { return consoleData.settings.parse(await request(`${NEXUS_API_PREFIX}/settings`, 'PUT', { value, expectedHash })) },
    async preview(library: PromptLibrary, selection: readonly string[]) { return preview.parse(await request(`${NEXUS_API_PREFIX}/prompts/preview`, 'POST', { library, selection })) },
    async prompt(id: string) { return consoleData.prompt.parse(await request(consolePromptPath(id))) },
    async apply(id: string, selection: readonly string[], expectedLibraryHash: string) { return consoleData.prompt.parse(await request(consolePromptPath(id), 'POST', { selection, expectedLibraryHash })) },
  }
}
export type NexusApi = ReturnType<typeof createNexusApi>
