import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import { BASE_PROMPT } from '../../src/prompts/base.ts'
import type { ConsoleSession, ConsoleStored, PromptLibrary, RuntimeSettings } from '../../src/protocol.ts'

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
export function clientFixture() {
  const library: ConsoleStored<PromptLibrary> = { value: { modules: [{ id: 'one', name: 'One', body: ' \n{{HOME}} ${HOME}\n ' }], defaultSelection: ['one'] }, hash: 'opaque-library' }
  const settings: ConsoleStored<RuntimeSettings> = { value: DEFAULT_SETTINGS, hash: 'opaque-settings' }
  const unknown = { service: 'present', backends: { state: 'unknown', names: null }, readiness: 'unverified' }
  let libraryWrites = 0, settingsWrites = 0
  const f = {
    library, settings, basePrompt: BASE_PROMPT, sessions: [{ id: 'A', title: 'Alpha' }, { id: 'B', title: 'Beta' }] as ConsoleSession[],
    requests: [] as { path: string; method: string; init: RequestInit }[],
    reply: undefined as undefined | ((path: string, method: string, init: RequestInit) => Response | Promise<Response> | undefined),
    fetch: async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const path = String(input), method = init.method ?? 'GET'
      f.requests.push({ path, method, init })
      const overridden = f.reply?.(path, method, init)
      if (overridden !== undefined) return overridden
      if (path.endsWith('/capabilities')) return Response.json({ csrfToken: 'memory-only-token', verification: 'unverified', registered: { consoleApi: true, nexusRuntime: true }, backendRegistrations: { scope: 'effective-http-context', terminal: unknown, web: unknown, internalAgent: unknown }, diagnostics: ['Registration only'], settingsLocation: { namespace: 'dsh-nexus', domain: 'dsh_nexus' }, basePrompt: BASE_PROMPT })
      if (path.endsWith('/library')) {
        if (method === 'PUT') {
          const body = JSON.parse(String(init.body))
          if (body.expectedHash !== f.library.hash) return Response.json({ error: { code: 'CONFIG_CONFLICT', message: 'changed' } }, { status: 409 })
          f.library = { value: body.value, hash: `library-${++libraryWrites}` }
        }
        return Response.json(f.library)
      }
      if (path.endsWith('/settings')) {
        if (method === 'PUT') {
          const body = JSON.parse(String(init.body))
          if (body.expectedHash !== f.settings.hash) return Response.json({ error: { code: 'CONFIG_CONFLICT', message: 'changed' } }, { status: 409 })
          f.settings = { value: body.value, hash: `settings-${++settingsWrites}` }
        }
        return Response.json(f.settings)
      }
      if (path.endsWith('/sessions')) return Response.json(f.sessions)
      if (path.endsWith('/prompts/preview')) {
        const { library: draft, selection } = JSON.parse(String(init.body)) as { library: PromptLibrary; selection: string[] }
        const modules = selection.map((id) => draft.modules.find((m) => m.id === id)!)
        return Response.json({ selection, modules, text: [BASE_PROMPT, ...modules.map((m) => m.body)].join('\n\n') })
      }
      const id = decodeURIComponent(path.split('/~')[1]!.split('/')[0]!)
      const selection: string[] = method === 'POST' ? JSON.parse(String(init.body)).selection : []
      const modules = selection.map((key) => f.library.value.modules.find((m) => m.id === key)!)
      return Response.json({ sessionId: id, selection, modules, text: [BASE_PROMPT, ...modules.map((m) => m.body)].join('\n\n') })
    },
  }
  return f
}
