/** Guarded Node HTTP console. No model-facing tool, second runtime or private store. */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { NEXUS_API_PREFIX, type ConsoleCapabilities, type ConsoleError, type ConsoleSession, type PromptPreview } from '../protocol.ts'
import { composePromptText, selectedPromptModules } from '../prompts/assemble.ts'
import { BASE_PROMPT } from '../prompts/base.ts'
import { validatePromptLibrary } from '../prompts/validate.ts'
import { NexusError } from '../runtime/errors.ts'
import type { NexusRuntime } from '../runtime/service.ts'
import { NEXUS_DOMAIN_NAME, runtimeSettingsSchema } from '../storage/domain.ts'
import { guardConsoleRequest, guardConsoleWrite, HttpError, readConsoleJson } from './guards.ts'
import { inspectBackendRegistrations } from './capabilities.ts'

const saveShape = z.strictObject({ value: z.unknown(), expectedHash: z.string().min(1) })
const previewShape = z.strictObject({ library: z.unknown(), selection: z.array(z.string()) })
const applyShape = z.strictObject({ selection: z.array(z.string()), expectedLibraryHash: z.string().min(1) })

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new HttpError(400, 'INVALID_REQUEST', 'The request has invalid or unknown fields.')
  rejectUnknownFields(value, result.data)
  return result.data
}

/** Reuse the stored settings schema's rules, but refuse fields it would strip.
 * This keeps recovery reads unchanged and avoids a second settings validator. */
function rejectUnknownFields(input: unknown, parsed: unknown): void {
  // Opaque envelope members are validated by their own schema next. If parsing
  // retained the exact reference, it stripped nothing: do not walk arbitrary depth.
  if (input === parsed) return
  if (input === null || typeof input !== 'object' || parsed === null || typeof parsed !== 'object') return
  const allowed = parsed as Record<string, unknown>
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(allowed, key)) throw new HttpError(400, 'INVALID_REQUEST', 'Unknown request fields are not allowed.')
    rejectUnknownFields(value, allowed[key])
  }
}

/** Native titles are log-only session/title events, not creation metadata. */
function sessionTitle(agent: Agent): string {
  const event = agent.session.snapshotEvents().findLast((entry) => entry.type === 'session/title')
  const data: unknown = event?.data
  return data !== null && typeof data === 'object' && 'title' in data && typeof data.title === 'string' ? data.title : ''
}

function send(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Connection': 'close' })
  res.end(JSON.stringify(value))
}

function httpFailure(error: unknown): HttpError {
  if (error instanceof HttpError) return error
  if (error instanceof NexusError) {
    switch (error.code) {
      case 'CONFIG_CONFLICT': return new HttpError(409, error.code, 'The saved record changed. Read it again before retrying.')
      case 'INVALID_ARGUMENT': return new HttpError(400, error.code, 'The prompt library or selection is invalid.')
      case 'NO_AGENT': return new HttpError(404, error.code, 'The exact live Nexus session is not available.')
      case 'RESOURCE_NOT_AVAILABLE': return new HttpError(503, error.code, 'The Nexus runtime is not available.')
      case 'UNSUPPORTED_CAPABILITY': return new HttpError(503, error.code, 'A required Nexus capability is not available.')
    }
  }
  return new HttpError(500, 'INTERNAL_ERROR', 'The Nexus operation failed.')
}

/** Register within a scope injected with webServer and agents. Every activation
 * owns one unpredictable token. Both scope unload and runtime drain retire it. */
export function registerRoutes(ctx: Context, runtime: NexusRuntime): () => void {
  const token = randomBytes(32).toString('hex')
  const closing = new AbortController()
  let unregister: (() => void) | undefined
  let detachRuntime: (() => void) | undefined
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    closing.abort()
    unregister?.()
    detachRuntime?.()
  }
  const assertAvailable = () => {
    if (disposed) throw new HttpError(503, 'RESOURCE_NOT_AVAILABLE', 'The Nexus API is closing.')
    runtime.assertAvailable()
  }
  const assertActor = (agent: Agent | undefined): Agent => {
    assertAvailable()
    if (agent === undefined || ctx.agents.get(agent.id) !== agent || !runtime.isNexusAgent(agent)) {
      throw new HttpError(404, 'NO_AGENT', 'The exact live Nexus session is not available.')
    }
    return agent
  }
  const route: WebRoute = {
    kind: 'prefix', path: NEXUS_API_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        guardConsoleRequest(req, ctx.webServer.protocol)
        assertAvailable()
        const url = new URL(req.url ?? '/', ctx.webServer.getOrigin())
        if (url.search !== '') throw new HttpError(400, 'INVALID_REQUEST', 'Query parameters are not supported.')
        const path = url.pathname.slice(NEXUS_API_PREFIX.length)
        const targetPath = /^\/sessions\/([^/]+)\/prompt$/.exec(path)
        const methods = path === '/library' || path === '/settings' ? ['GET', 'PUT']
          : path === '/prompts/preview' ? ['POST']
            : targetPath !== null ? ['GET', 'POST']
              : path === '/capabilities' || path === '/sessions' ? ['GET'] : undefined
        if (methods === undefined) throw new HttpError(404, 'NOT_FOUND', 'The Nexus route does not exist.')
        if (!methods.includes(req.method ?? '')) {
          res.setHeader('Allow', methods.join(', '))
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'The request method is not allowed.')
        }
        const writing = req.method === 'PUT' || req.method === 'POST'
        if (writing) guardConsoleWrite(req, token)
        else if (req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')) {
          throw new HttpError(400, 'INVALID_REQUEST', 'GET requests must not carry a body.')
        }
        // Capture BEFORE the first await. A reused id must never retarget this request.
        let actor: Agent | undefined
        if (targetPath !== null) {
          let id: string
          try { id = decodeURIComponent(targetPath[1]!) } catch { throw new HttpError(400, 'INVALID_REQUEST', 'The session id is malformed.') }
          actor = assertActor(ctx.agents.get(SessionId(id)))
        }
        const body = writing ? await readConsoleJson(req, closing.signal) : undefined
        assertAvailable()
        if (req.aborted || res.destroyed) throw new HttpError(400, 'INVALID_REQUEST', 'The caller disconnected.')
        let result: unknown
        if (path === '/library') {
          if (writing) {
            const input = parse(saveShape, body)
            result = await runtime.saveLibrary(validatePromptLibrary(input.value), input.expectedHash)
          } else result = await runtime.store.readLibrary()
        } else if (path === '/settings') {
          if (writing) {
            const input = parse(saveShape, body)
            result = await runtime.saveSettings(parse(runtimeSettingsSchema, input.value), input.expectedHash)
          } else result = runtime.getSettings()
        } else if (path === '/prompts/preview') {
          const input = parse(previewShape, body)
          const library = validatePromptLibrary(input.library)
          const modules = selectedPromptModules(library, input.selection)
          result = { selection: input.selection, modules, text: composePromptText(modules) } satisfies PromptPreview
        } else if (path === '/sessions') {
          result = ctx.agents.list().filter((agent) => ctx.agents.get(agent.id) === agent && runtime.isNexusAgent(agent))
            .map((agent): ConsoleSession => ({ id: agent.id, title: sessionTitle(agent) }))
        } else if (targetPath !== null) {
          const exact = assertActor(actor)
          if (writing) {
            const input = parse(applyShape, body)
            result = await runtime.prompts.apply(exact, input.selection, input.expectedLibraryHash, () => { assertActor(exact) })
          } else result = runtime.prompts.peek(exact)
        } else {
          result = { csrfToken: token, verification: 'unverified', registered: { consoleApi: true, nexusRuntime: true },
            backendRegistrations: inspectBackendRegistrations(ctx),
            diagnostics: ['Registration only; OS backends, providers, accounts and GUI have not been verified.'],
            settingsLocation: { namespace: 'dsh-nexus', domain: NEXUS_DOMAIN_NAME }, basePrompt: BASE_PROMPT } satisfies ConsoleCapabilities
        }
        send(res, 200, result)
      } catch (error) {
        const failure = httpFailure(error)
        send(res, failure.status, { error: { code: failure.code, message: failure.message } } satisfies ConsoleError)
      }
    },
  }
  ctx.effect(() => {
    try {
      detachRuntime = runtime.attach('console-http', dispose)
      unregister = ctx.webServer.register(route)
    } catch (error) { dispose(); throw error }
    return dispose
  }, 'dsh-nexus console HTTP')
  return dispose
}
