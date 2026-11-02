/** Exported native routes over real loopback sockets and the one source runtime.
 * The model transport and durable-medium fault gates are external test boundaries. */
import { request, type ClientRequest } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { registerRoutes } from '../../src/http/routes.ts'
import { registerPromptSections } from '../../src/prompts/register.ts'
import { openNexusRuntime, type NexusRuntime } from '../../src/runtime/service.ts'
import { LIBRARY_TABLE } from '../../src/storage/domain.ts'
import { mountNexusStoreFixture } from '../support/fixtures.ts'
import { mountSubagentHarness, waitFor } from '../support/agent-harness.ts'
import { consoleRequest } from './transport.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function open() {
  const h = await mountSubagentHarness({ hold: true })
  cleanups.push(() => h.dispose())
  const fixture = await mountNexusStoreFixture({ ctx: h.ctx })
  cleanups.push(() => fixture.dispose())
  await h.ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  let runtime!: NexusRuntime
  let remove!: () => void
  await h.ctx.plugin({
    name: 'http-runtime-owner', inject: ['storageDomain', 'agents', 'systemPrompt'],
    async apply(ctx: Context) {
      runtime = await openNexusRuntime(ctx, {})
      ctx.effect(() => registerPromptSections(ctx, runtime.prompts), 'test native persona registration')
    },
  })
  const mount = async () => h.ctx.plugin({
    name: 'http-native-routes', inject: ['webServer', 'agents', 'nexusRuntime'],
    apply(ctx: Context) { remove = registerRoutes(ctx, runtime) },
  })
  const routeFiber = await mount()
  cleanups.push(async () => { h.releaseAll(); await runtime.dispose() })
  const base = `${h.ctx.webServer.getOrigin()}/api/dsh-nexus`
  const get = (path: string) => consoleRequest(`${base}/${path}`)
  const caps = await get('capabilities')
  expect(caps.status).toBe(200)
  const token = (await caps.json() as { csrfToken: string }).csrfToken
  const write = (path: string, value: unknown, csrf = token) => consoleRequest(`${base}/${path}`,
    path === 'library' || path === 'settings' ? 'PUT' : 'POST', Buffer.from(JSON.stringify(value)),
    { 'Content-Type': 'application/json', 'X-Nexus-CSRF': csrf })
  return { h, fixture, runtime, base, get, write, token, routeFiber, mount,
    remove: () => remove() }
}

function partial(base: string, path: string, token: string): { req: ClientRequest; response: Promise<number>; entered: Promise<void> } {
  const req = request(`${base}/${path}`, { method: 'PUT', agent: false, headers: { 'Content-Type': 'application/json', 'X-Nexus-CSRF': token, Expect: '100-continue' } })
  const entered = new Promise<void>((resolve) => req.once('continue', resolve))
  req.setTimeout(4000, () => req.destroy(new Error('partial request test timeout')))
  const response = new Promise<number>((resolve, reject) => {
    req.on('response', (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)) })
    req.on('error', reject)
  })
  req.write('{"value":')
  return { req, response, entered }
}

it('retire/remount is idempotent, rejects the old token and reuses the same singleton', async () => {
  const c = await open()
  const saved = await c.runtime.store.readLibrary()
  c.remove(); c.remove()
  expect((await c.get('capabilities')).status).toBe(404)
  await c.routeFiber.dispose()
  const next = await c.mount()
  try {
    const caps = await c.get('capabilities')
    const token = (await caps.json() as { csrfToken: string }).csrfToken
    expect(token).not.toBe(c.token)
    expect(c.h.ctx.nexusRuntime).toBe(c.runtime)
    expect((await c.write('library', { value: saved.value, expectedHash: saved.hash })).status).toBe(403)
    expect((await c.write('library', { value: saved.value, expectedHash: saved.hash }, token)).status).toBe(200)
  } finally { await next.dispose() }
  expect((await c.get('capabilities')).status).toBe(404)
})

it('runtime close cancels an already-entered slow body without waiting or writing into a drained store', async () => {
  const c = await open()
  const writes = c.fixture.listWrites().length
  const pending = partial(c.base, 'library', c.token)
  try {
    await pending.entered
    const timeout = setTimeout(() => pending.req.destroy(new Error('runtime close hung')), 1000)
    try { expect((await c.runtime.dispose()).released).toBe(true) }
    finally { clearTimeout(timeout) }
    expect(await pending.response).toBe(503)
    expect(c.fixture.listWrites()).toHaveLength(writes)
    expect((await c.get('capabilities')).status).toBe(404)
    await expect(c.runtime.saveLibrary({ modules: [], defaultSelection: [] }, 'old')).rejects.toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
  } finally { pending.req.destroy() }
})

it('synchronously refuses a body completed while runtime shutdown is still draining a later attachment', async () => {
  const c = await open()
  const before = await c.runtime.store.readLibrary()
  const writes = c.fixture.listWrites().length
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  c.runtime.attach('held-resource-before-http', () => held)
  const pending = partial(c.base, 'library', c.token)
  let closing: ReturnType<NexusRuntime['dispose']> | undefined
  try {
    await pending.entered
    closing = c.runtime.dispose()
    pending.req.end(`{\"modules\":[],\"defaultSelection\":[]},\"expectedHash\":\"${before.hash}\"}`)
    expect(await pending.response).toBe(503)
    expect(await c.runtime.store.readLibrary()).toEqual(before)
    expect(c.fixture.listWrites()).toHaveLength(writes)
  } finally { pending.req.destroy(); release(); await closing }
})

it('aborted bodies cannot save and do not prevent scope teardown', async () => {
  const c = await open()
  const writes = c.fixture.listWrites().length
  const pending = partial(c.base, 'library', c.token)
  const stopped = pending.response.catch(() => 0)
  await pending.entered
  pending.req.destroy()
  await stopped
  await c.routeFiber.dispose()
  expect(c.fixture.listWrites()).toHaveLength(writes)
})

it('does not report a library save before durability and drains an admitted save before closing', async () => {
  const c = await open()
  const old = await c.runtime.store.readLibrary()
  const hold = c.fixture.holdNextPut(LIBRARY_TABLE)
  let finished = false
  const writing = c.write('library', { value: { modules: [{ id: 'a', name: 'A', body: 'COMMITTED' }], defaultSelection: ['a'] }, expectedHash: old.hash }).then((res) => { finished = true; return res })
  try {
    await hold.waitUntilHeld()
    expect(finished).toBe(false)
    expect(await c.runtime.store.readLibrary()).toEqual(old)
    let closed = false
    const closing = c.runtime.dispose().then((status) => { closed = true; return status })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(closed).toBe(false)
    hold.release()
    expect((await writing).status).toBe(200)
    expect((await closing).released).toBe(true)
    expect(await c.fixture.readMedium()).toContain('COMMITTED')
  } finally { hold.release(); await writing }
})

function systemText(options: GenerateOptions): string {
  return (options.messages ?? []).filter((message) => message.role === 'system')
    .flatMap((message) => message.content).filter((part) => part.type === 'text').map((part) => part.text).join('\n')
}

it('HTTP apply leaves request A byte-identical and uninterrupted; B receives the complete updated system snapshot', async () => {
  const c = await open()
  const library = { modules: [{ id: 'old', name: 'Old', body: 'OLD_ONLY_BODY' }, { id: 'new', name: 'New', body: 'NEW_COMPLETE_BODY {{literal}}' }], defaultSelection: ['old'] }
  const saved = await c.runtime.saveLibrary(library, (await c.runtime.store.readLibrary()).hash)
  const actor = await c.h.createParent('request-a-b')
  c.runtime.markNexusAgent(actor)
  const opening = c.h.runTurn(actor, 'request A')
  try {
    await waitFor(() => c.h.heldSessions().includes(actor.id), 'request A at scripted external model transport')
    const first = c.h.requestsOf(actor.id)[0]!.options
    const captured = JSON.stringify(first)
    expect(systemText(first)).toContain('OLD_ONLY_BODY')
    const response = await c.write(`sessions/${actor.id}/prompt`, { selection: ['new'], expectedLibraryHash: saved.hash })
    expect(response.status).toBe(200)
    expect(JSON.stringify(first)).toBe(captured)
    expect(actor.status).toBe('running')
    c.h.release()
    await opening
    const nextTurn = c.h.runTurn(actor, 'request B')
    await waitFor(() => c.h.heldSessions().includes(actor.id), 'request B at scripted external model transport')
    const next = c.h.requestsOf(actor.id)[1]!.options
    expect(systemText(next)).toContain('NEW_COMPLETE_BODY {{literal}}')
    expect(systemText(next)).not.toContain('OLD_ONLY_BODY')
    c.h.release()
    await nextTurn
    const events = actor.session.snapshotEvents()
    expect(events.filter((event) => event.type === 'turn/end')).toHaveLength(2)
    const answers = events.flatMap((event) => event.type === 'assistant/message' ? [{ interrupted: event.data.interrupted === true, message: event.data.message }] : [])
    expect(answers).toHaveLength(2)
    expect(answers.map((answer) => answer.interrupted)).toEqual([false, false])
    expect(JSON.stringify(answers[0]!.message)).toContain('answer-0')
  } finally { c.h.releaseAll(); await opening }
})

it('rechecks exact membership after the saved-library await before a prompt write', async () => {
  const c = await open()
  const actor = await c.h.createParent('membership')
  const member = c.runtime.markNexusAgent(actor)
  const saved = await c.runtime.store.readLibrary()
  const initial = c.runtime.prompts.peek(actor)
  const writes = c.fixture.listWrites().length
  // Delay only the real store's library IO, not a runtime/Agent/service double.
  // The HTTP request has already passed its own target check when this fires.
  let release!: () => void
  let announce!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const entered = new Promise<void>((resolve) => { announce = resolve })
  const read = c.runtime.store.readLibrary.bind(c.runtime.store)
  const heldRead = vi.spyOn(c.runtime.store, 'readLibrary').mockImplementationOnce(async () => { announce(); await gate; return read() })
  const waiting = c.write(`sessions/${actor.id}/prompt`, { selection: [], expectedLibraryHash: saved.hash })
  try {
    await entered
    member.release()
    release()
    expect((await waiting).status).toBe(404)
    expect(c.runtime.prompts.peek(actor)).toBe(initial)
    expect(c.fixture.listWrites()).toHaveLength(writes)
  } finally { release(); heldRead.mockRestore(); await waiting }
})
