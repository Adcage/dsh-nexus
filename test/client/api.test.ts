import { describe, expect, it } from 'vitest'
import { createNexusApi } from '../../src/client/api.ts'
import { clientFixture } from './fixture.ts'

describe('same-origin Nexus API', () => {
  it('keeps authorization in memory and sends protected conditional writes without retry', async () => {
    const f = clientFixture()
    const api = createNexusApi(f.fetch)
    await api.saveLibrary(f.library.value, f.library.hash)
    expect(f.requests.map((r) => r.path)).toEqual(['/api/dsh-nexus/capabilities', '/api/dsh-nexus/library'])
    const write = f.requests[1]!
    expect(write.init).toMatchObject({ credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store' })
    expect(new Headers(write.init.headers).get('X-Nexus-CSRF')).toBe('memory-only-token')
    expect(JSON.parse(String(write.init.body))).toEqual({ value: f.library.value, expectedHash: 'opaque-library' })
    const caps = await api.capabilities()
    expect(caps).not.toHaveProperty('csrfToken')
    f.reply = () => { throw new TypeError('network interruption after commit') }
    const count = f.requests.length
    await expect(api.saveLibrary(f.library.value, f.library.hash)).rejects.toThrow()
    expect(f.requests).toHaveLength(count + 1)
  })
  it.each(['.', '..', '~.', '%2e', 'a/b', '字 空格'])('addresses exact %s identity through the normalization-safe keyed route', async (id) => {
    const f = clientFixture()
    const result = await createNexusApi(f.fetch).prompt(id)
    expect(result.sessionId).toBe(id)
    expect(new URL(f.requests[0]!.path, 'http://localhost').pathname).toBe(`/api/dsh-nexus/session-keys/~${encodeURIComponent(id)}/prompt`)
  })
  it('rejects malformed JSON, DTOs and redirects rather than treating them as accepted state', async () => {
    const f = clientFixture()
    const api = createNexusApi(f.fetch)
    for (const response of [new Response('bad'), Response.json({ value: null, hash: 'x' }), Response.json({ value: { modules: [] }, hash: 'x' })]) {
      f.reply = () => response
      await expect(api.library()).rejects.toThrow()
    }
    const redirected = Response.json(f.library)
    Object.defineProperty(redirected, 'redirected', { value: true })
    f.reply = () => redirected
    await expect(api.library()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    f.reply = () => Response.json({ error: { code: 'CONFIG_CONFLICT', message: 'do not leak token' } }, { status: 409 })
    await expect(api.library()).rejects.toMatchObject({ status: 409, code: 'CONFIG_CONFLICT' })
  })
})
