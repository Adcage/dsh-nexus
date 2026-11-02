/** Native WebServer, built host row, real Nexus singleton/storage and native Agents.
 * Only the existing harness's external IO providers are scripted. */
import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { mountPresetHarness, type PresetHarness } from '../support/preset-harness.ts'
import { LIBRARY_TABLE, SETTINGS_TABLE, PROMPTS_TABLE } from '../../src/storage/domain.ts'
import { BASE_PROMPT } from '../../src/prompts/base.ts'
import { consoleRequest } from './transport.ts'
import { createNexusApi } from '../../src/client/api.ts'
import { createConsoleStore } from '../../src/client/store.ts'

const prefix = '/api/dsh-nexus'
const opened: PresetHarness[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.dispose() })

async function open() {
  const h = await mountPresetHarness()
  opened.push(h)
  await h.ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const runtime = await h.startNexus()
  const origin = h.ctx.webServer.getOrigin()
  async function send(path: string, method = 'GET', value?: unknown, headers: Record<string, string> = {}) {
    return raw(origin, path, method, value === undefined ? undefined : Buffer.from(JSON.stringify(value)), {
      ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...headers,
    })
  }
  async function token() {
    const res = await send('capabilities')
    expect(res.status).toBe(200)
    const value = await res.json() as { csrfToken: string }
    expect(value.csrfToken).toMatch(/^[a-f0-9]{64}$/)
    return { 'X-Nexus-CSRF': value.csrfToken }
  }
  return { h, runtime, origin, send, token }
}
/** node:http preserves hostile Host/duplicate headers that fetch may suppress. */
function raw(origin: string, path: string, method: string, body?: Buffer | Buffer[], headers: Record<string, string | string[]> = {}): Promise<Response> {
  return consoleRequest(`${origin}${prefix}/${path}`, method, body, headers)
}
const library = { modules: [{ id: 'one', name: 'One', body: ' \n字面 {{HOME}} ${HOME}\n ' }], defaultSelection: ['one'] }

describe('native console HTTP routes', () => {
  it('rejects unsafe console writes before any durable change', async () => {
    const { h, runtime, send, token, origin } = await open()
    const auth = await token()
    const before = await runtime.store.readLibrary()
    const writes = h.fixture.listWrites().length
    const value = { value: library, expectedHash: before.hash }
    expect((await send('library', 'PUT', value)).status).toBe(403)
    expect((await send('library', 'PUT', value, { ...auth, Origin: 'https://evil.invalid' })).status).toBe(403)
    expect((await send('library', 'PUT', value, { ...auth, Host: 'localhost.evil.invalid' })).status).toBe(403)
    expect((await send('library', 'PUT', value, { ...auth, 'content-type': 'text/plain' })).status).toBe(415)
    expect((await send('library', 'DELETE', undefined, auth)).status).toBe(405)
    expect((await send('library', 'PUT', { ...value, extra: true }, auth)).status).toBe(400)
    expect((await send('library', 'PUT', { value: { ...library, extra: true }, expectedHash: before.hash }, auth)).status).toBe(400)
    const malformed = await raw(origin, 'library', 'PUT', Buffer.from('{'), { ...auth, 'content-type': 'application/json' })
    expect(malformed.status).toBe(400)
    const oversized = await send('library', 'PUT', { value: 'x'.repeat(256 * 1024) }, auth)
    expect(oversized.status).toBe(413)
    expect(await runtime.store.readLibrary()).toEqual(before)
    expect(h.fixture.listWrites()).toHaveLength(writes)
  })

  it('rejects chunked overflow, malformed UTF-8, encodings and duplicate security headers over native sockets', async () => {
    const { h, runtime, origin, token } = await open()
    const auth = await token()
    const before = await runtime.store.readLibrary()
    const writes = h.fixture.listWrites().length
    const headers = { ...auth, 'content-type': 'application/json' }
    expect((await raw(origin, 'library', 'PUT', [Buffer.alloc(128 * 1024, 32), Buffer.alloc(128 * 1024 + 1, 32)], headers)).status).toBe(413)
    expect((await raw(origin, 'library', 'PUT', undefined, { ...headers, 'content-length': String(256 * 1024 + 1) })).status).toBe(413)
    expect((await raw(origin, 'library', 'PUT', Buffer.from([0x7b, 0x22, 0xc0, 0xaf, 0x22, 0x7d]), headers)).status).toBe(400)
    expect((await raw(origin, 'library', 'PUT', Buffer.from('{}'), { ...headers, 'content-encoding': 'gzip' })).status).toBe(415)
    expect((await raw(origin, 'library', 'PUT', Buffer.from('{}'), { ...headers, Origin: [origin, origin] })).status).toBe(403)
    expect((await raw(origin, 'library', 'PUT', Buffer.from('{}'), { ...headers, 'X-Nexus-CSRF': [auth['X-Nexus-CSRF'], auth['X-Nexus-CSRF']] })).status).toBe(403)
    expect((await raw(origin, 'library', 'PUT', Buffer.from('{}'), { ...headers, 'X-Nexus-CSRF': 'é'.repeat(64) })).status).toBe(403)
    const encoded = Buffer.from(JSON.stringify({ library, selection: ['one'] }))
    const exact = Buffer.concat([encoded, Buffer.alloc(256 * 1024 - encoded.length, 32)])
    expect((await raw(origin, 'prompts/preview', 'POST', exact, headers)).status).toBe(200)
    expect((await raw(origin, 'capabilities', 'GET', undefined, { Origin: 'null' })).status).toBe(403)
    expect((await raw(origin, 'capabilities?callback=steal', 'GET')).status).toBe(400)
    expect((await raw(origin, 'capabilities', 'OPTIONS')).status).toBe(405)
    expect((await raw(origin, 'library', 'GET', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    expect((await raw(origin, 'library', 'GET', undefined, { 'X-Forwarded-For': '203.0.113.4' })).status).toBe(200)
    const changed = { ...runtime.getSettings().value, terminal: { engine: 'bash', hidden: true } }
    expect((await raw(origin, 'settings', 'PUT', Buffer.from(JSON.stringify({ value: changed, expectedHash: runtime.getSettings().hash })), headers)).status).toBe(400)
    expect(await runtime.store.readLibrary()).toEqual(before)
    expect(h.fixture.listWrites()).toHaveLength(writes)
  })

  it('rejects deeply nested invalid values as a client error without recursing through opaque envelope fields', async () => {
    const { h, runtime, origin, token } = await open()
    const auth = await token()
    const before = await runtime.store.readLibrary()
    const writes = h.fixture.listWrites().length
    const nested = '['.repeat(12000) + '0' + ']'.repeat(12000)
    const body = Buffer.from(`{\"value\":{\"bogus\":${nested}},\"expectedHash\":\"${before.hash}\"}`)
    expect((await raw(origin, 'library', 'PUT', body, { ...auth, 'content-type': 'application/json' })).status).toBe(400)
    expect(await runtime.store.readLibrary()).toEqual(before)
    expect(h.fixture.listWrites()).toHaveLength(writes)
  })

  it('previews literal drafts without persisting or inventing an applied session', async () => {
    const { h, runtime, send, token } = await open()
    const auth = await token()
    const before = await runtime.store.readLibrary()
    const writes = h.fixture.listWrites().length
    const res = await send('prompts/preview', 'POST', { library, selection: ['one'] }, auth)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ selection: ['one'], modules: library.modules, text: `${BASE_PROMPT}\n\n${library.modules[0]!.body}` })
    expect(await runtime.store.readLibrary()).toEqual(before)
    expect(h.fixture.listWrites()).toHaveLength(writes)
    const caps = await send('capabilities')
    expect(caps.headers.get('cache-control')).toBe('no-store')
    expect(caps.headers.get('x-content-type-options')).toBe('nosniff')
    expect(caps.headers.get('access-control-allow-origin')).toBeNull()
    expect(await caps.json()).toMatchObject({ settingsLocation: { namespace: 'dsh-nexus', domain: 'dsh_nexus' }, verification: 'unverified', basePrompt: BASE_PROMPT })
  })

  it('reports live native backend registrations without claiming readiness or starting backend work', async () => {
    const { h, runtime, send } = await open()
    const writes = h.fixture.listWrites().length
    const response = await send('capabilities')
    expect(response.status).toBe(200)
    const capabilities = await response.json() as { backendRegistrations: unknown }
    expect(capabilities.backendRegistrations).toEqual({
      scope: 'effective-http-context',
      terminal: { service: 'present', backends: { state: 'registered', names: ['nexus-bash', 'nexus-pwsh'] }, readiness: 'unverified' },
      web: { service: 'present', backends: { state: 'unknown', names: null }, readiness: 'unverified' },
      internalAgent: { service: 'present', backends: { state: 'registered', names: ['spawn', 'fork'] }, readiness: 'unverified' },
    })
    expect(h.ctx.nexusRuntime).toBe(runtime)
    expect(h.ctx.agents.list()).toHaveLength(0)
    expect(h.requests).toHaveLength(0)
    expect(h.web.searches).toHaveLength(0)
    expect(h.web.fetches).toHaveLength(0)
    expect(h.subprocess.spawns).toHaveLength(0)
    expect(h.subprocess.terminalSpawns).toHaveLength(0)
    expect(h.fixture.listWrites()).toHaveLength(writes)
  })

  it('commits durably, refuses stale windows and preserves committed state on medium failure', async () => {
    const { h, runtime, send, token } = await open()
    const auth = await token()
    const before = await (await send('library')).json() as { hash: string }
    const saved = await send('library', 'PUT', { value: library, expectedHash: before.hash }, auth)
    expect(saved.status).toBe(200)
    expect((await saved.json() as { value: unknown }).value).toEqual(library)
    expect((await send('library', 'PUT', { value: { modules: [], defaultSelection: [] }, expectedHash: before.hash }, auth)).status).toBe(409)
    const current = await runtime.store.readLibrary()
    h.fixture.failNextPut(LIBRARY_TABLE)
    const refused = await send('library', 'PUT', { value: { modules: [], defaultSelection: [] }, expectedHash: current.hash }, auth)
    expect(refused.status).toBe(500)
    expect(await refused.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'The Nexus operation failed.' } })
    expect(await runtime.store.readLibrary()).toEqual(current)
    const settings = runtime.getSettings()
    const next = { ...settings.value, terminal: { engine: 'pwsh' } }
    h.fixture.failNextPut(SETTINGS_TABLE)
    expect((await send('settings', 'PUT', { value: next, expectedHash: settings.hash }, auth)).status).toBe(500)
    expect(runtime.getSettings()).toBe(settings)
    expect((await send('settings', 'PUT', { value: next, expectedHash: settings.hash }, auth)).status).toBe(200)
    expect(runtime.getSettings().value.terminal.engine).toBe('pwsh')
    expect((await send('settings', 'PUT', { value: settings.value, expectedHash: settings.hash }, auth)).status).toBe(409)
  })

  it('addresses only exact live Nexus actors and applies saved rather than previewed bodies', async () => {
    const { h, runtime, send, token } = await open()
    const auth = await token()
    const actor = await h.createAgent('chosen', 'nexus')
    await h.createAgent('foreign')
    const initial = runtime.prompts.peek(actor)
    const before = await runtime.store.readLibrary()
    await send('library', 'PUT', { value: library, expectedHash: before.hash }, auth)
    const saved = await runtime.store.readLibrary()
    expect(await (await send('sessions')).json()).toEqual([{ id: 'chosen', title: expect.any(String) }])
    expect(await (await send('sessions/chosen/prompt')).json()).toEqual(initial)
    for (const id of ['absent', 'foreign']) {
      expect((await send(`sessions/${id}/prompt`, 'POST', { selection: ['one'], expectedLibraryHash: saved.hash }, auth)).status).toBe(404)
    }
    expect((await send('sessions/chosen/prompt', 'POST', { selection: ['one'], expectedLibraryHash: before.hash }, auth)).status).toBe(409)
    h.fixture.failNextPut(PROMPTS_TABLE)
    expect((await send('sessions/chosen/prompt', 'POST', { selection: ['one'], expectedLibraryHash: saved.hash }, auth)).status).toBe(500)
    expect(runtime.prompts.peek(actor)).toBe(initial)
    await send('prompts/preview', 'POST', { library: { ...library, modules: [{ ...library.modules[0], body: 'UNSAVED' }] }, selection: ['one'] }, auth)
    const applied = await send('sessions/chosen/prompt', 'POST', { selection: ['one'], expectedLibraryHash: saved.hash }, auth)
    expect(applied.status).toBe(200)
    expect(await applied.json()).toEqual(runtime.prompts.peek(actor))
    expect(runtime.prompts.peek(actor).text).not.toContain('UNSAVED')
    expect(runtime.prompts.peek(actor).modules).toEqual(library.modules)
    await h.disposeAgent(actor)
    expect((await send('sessions/chosen/prompt')).status).toBe(404)
  })

  it('addresses dot IDs and special-key collisions without aliasing native actors or hiding the roster', async () => {
    const { h, runtime, send, token } = await open()
    const auth = await token()
    const ids = ['.', '..', '~.', '%2e', 'ordinary', 'a/b', '字 空格']
    const actors = await Promise.all(ids.map((id) => h.createAgent(id, 'nexus')))
    expect((await (await send('sessions')).json() as { id: string }[]).map((s) => s.id).sort()).toEqual([...ids].sort())
    const saved = await runtime.store.readLibrary()
    for (const [i, id] of ids.entries()) {
      const path = `session-keys/~${encodeURIComponent(id)}/prompt`
      const read = await send(path)
      expect(read.status, id).toBe(200)
      expect(await read.json()).toEqual(runtime.prompts.peek(actors[i]!))
      const applied = await send(path, 'POST', { selection: [], expectedLibraryHash: saved.hash }, auth)
      expect(applied.status, id).toBe(200)
      expect((await applied.json() as { sessionId: string }).sessionId).toBe(id)
    }
    expect((await send('sessions/ordinary/prompt')).status).toBe(200)
    expect((await send('sessions/%7E./prompt')).status).toBe(200)
    expect((await send('session-keys/~%252e/prompt')).status).toBe(200)
    expect((await send('session-keys/%7E./prompt')).status).toBe(404)
    expect((await send('session-keys/~%ZZ/prompt')).status).toBe(400)
  })

  it('runs the exported browser API/store against the native guarded host with conditional saves and exact dot targeting', async () => {
    const { h, runtime, origin } = await open()
    const actor = await h.createAgent('.', 'nexus')
    const fetcher: typeof fetch = async (input, init = {}) => consoleRequest(`${origin}${String(input)}`, init.method,
      init.body === undefined ? undefined : Buffer.from(String(init.body)), { ...Object.fromEntries(new Headers(init.headers)), Origin: origin })
    const a = createConsoleStore(createNexusApi(fetcher)), b = createConsoleStore(createNexusApi(fetcher))
    try {
      await Promise.all([a.refresh(), b.refresh()])
      expect(a.getSnapshot().targetId).toBeUndefined()
      a.editLibrary(library)
      a.setSelection(['one'])
      await a.preview()
      expect(a.getSnapshot().preview?.text).toBe(`${BASE_PROMPT}\n\n${library.modules[0]!.body}`)
      expect(runtime.prompts.peek(actor).selection).toEqual([])
      await a.saveLibrary()
      b.editLibrary({ modules: [], defaultSelection: [] })
      await b.saveLibrary()
      expect(b.getSnapshot().notice).toBe('conflict')
      await a.selectTarget('.')
      await a.applySelection()
      expect(a.getSnapshot().notice).toBe('applied')
      expect(a.getSnapshot().applied).toEqual(runtime.prompts.peek(actor))
      expect(a.getSnapshot().applied?.sessionId).toBe('.')
      expect(a.getSnapshot().applied?.modules).toEqual(library.modules)
      expect(JSON.stringify(a.getSnapshot())).not.toContain('csrfToken')
    } finally { a.dispose(); b.dispose() }
  })

  it('uses the same module and UTF-8 limits for save, preview and saved-library apply', async () => {
    const { h, runtime, send, token } = await open()
    const auth = await token()
    const actor = await h.createAgent('limits', 'nexus')
    const initial = runtime.prompts.peek(actor)
    const module = (id: string, body: string) => ({ id, name: id, body })
    const valid = { modules: Array.from({ length: 32 }, (_, i) => module(`m${i}`, i < 4 ? '字'.repeat(10922) + 'ab' : '')), defaultSelection: ['m3', 'm0'] }
    const before = await runtime.store.readLibrary()
    expect((await send('library', 'PUT', { value: valid, expectedHash: before.hash }, auth)).status).toBe(200)
    expect((await send('prompts/preview', 'POST', { library: valid, selection: valid.defaultSelection }, auth)).status).toBe(200)
    const invalid = [
      { ...valid, modules: [...valid.modules, module('extra', '')] },
      { ...valid, modules: [module('m0', '字'.repeat(10923))] },
      { ...valid, modules: [...valid.modules.slice(0, 4), module('extra', 'x')] },
      { modules: [module('same', ''), module('same', '')], defaultSelection: [] },
      { modules: [module('', '')], defaultSelection: [] },
      { ...valid, defaultSelection: ['missing'] },
      { ...valid, defaultSelection: ['m0', 'm0'] },
    ]
    for (const value of invalid) {
      const saved = await runtime.store.readLibrary()
      expect((await send('library', 'PUT', { value, expectedHash: saved.hash }, auth)).status).toBe(400)
      expect((await send('prompts/preview', 'POST', { library: value, selection: [] }, auth)).status).toBe(400)
      // Recovery-friendly storage can still load historical records. Applying
      // such a library must use the exact same validator, not bypass its limits.
      await runtime.store.saveLibrary(value, saved.hash)
      const historical = await runtime.store.readLibrary()
      expect((await send('sessions/limits/prompt', 'POST', { selection: [], expectedLibraryHash: historical.hash }, auth)).status).toBe(400)
      expect(runtime.prompts.peek(actor)).toBe(initial)
      await runtime.store.saveLibrary(valid, historical.hash)
    }
  })

  it('preserves the headless runtime and rotates authorization when native webServer remounts', async () => {
    const h = await mountPresetHarness()
    opened.push(h)
    const runtime = await h.startNexus()
    expect(h.ctx.get('webServer')).toBeUndefined()
    const first = await h.ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    const originalOrigin = h.ctx.webServer.getOrigin()
    const cap = await raw(originalOrigin, 'capabilities', 'GET')
    expect(cap.status).toBe(200)
    const oldToken = (await cap.json() as { csrfToken: string }).csrfToken
    await first.dispose()
    expect(h.ctx.nexusRuntime).toBe(runtime)
    const next = await h.ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    try {
      const nextOrigin = h.ctx.webServer.getOrigin()
      const second = await raw(nextOrigin, 'capabilities', 'GET')
      expect(second.status).toBe(200)
      expect((await second.json() as { csrfToken: string }).csrfToken).not.toBe(oldToken)
      const saved = await runtime.store.readLibrary()
      expect((await raw(nextOrigin, 'library', 'PUT', Buffer.from(JSON.stringify({ value: library, expectedHash: saved.hash })), { 'content-type': 'application/json', 'X-Nexus-CSRF': oldToken })).status).toBe(403)
      expect(await runtime.store.readLibrary()).toEqual(saved)
      const actor = await h.createAgent('still-headless-nexus', 'nexus')
      expect(runtime.isNexusAgent(actor)).toBe(true)
    } finally { await next.dispose() }
  })

  it('does not retarget a request awaiting its body to a same-id replacement', async () => {
    const { h, runtime, origin, token } = await open()
    const auth = await token()
    const actor = await h.createAgent('reused', 'nexus')
    const saved = await runtime.store.readLibrary()
    const pending = request(`${origin}${prefix}/sessions/reused/prompt`, { method: 'POST', agent: false, headers: { ...auth, 'content-type': 'application/json', Expect: '100-continue' } })
    const entered = new Promise<void>((resolve) => pending.once('continue', resolve))
    pending.setTimeout(4000, () => pending.destroy(new Error('test timeout')))
    const response = new Promise<number>((resolve, reject) => { pending.on('response', (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)) }); pending.on('error', reject) })
    try {
      pending.write('{"selection":')
      // Native WebServer sends 100 Continue and synchronously enters the route
      // before the client observes it; capture therefore precedes replacement.
      await entered
      await h.disposeAgent(actor)
      const replacement = await h.createAgent('reused', 'nexus')
      const snapshot = runtime.prompts.peek(replacement)
      pending.end(`[],"expectedLibraryHash":"${saved.hash}"}`)
      expect(await response).toBe(404)
      expect(runtime.prompts.peek(replacement)).toBe(snapshot)
    } finally { pending.destroy() }
  })
})
