/** Transport facts only: no exposed non-loopback listener is opened. */
import { describe, expect, it } from 'vitest'
import { guardConsoleTransport, type ConsoleTransport } from '../../src/http/guards.ts'
const local: ConsoleTransport = { remoteAddress: '127.0.0.1', localPort: 3080, protocol: 'http:', host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', fetchSite: 'same-origin' }
describe('guardConsoleTransport', () => {
  it.each(['127.0.0.1', '127.2.3.4', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1'])('accepts genuine loopback peer %s', (remoteAddress) => {
    expect(() => guardConsoleTransport({ ...local, remoteAddress })).not.toThrow()
  })
  it.each(['192.168.1.2', '203.0.113.1', '::ffff:192.168.1.2', '::127.0.0.1', undefined])('rejects a nonlocal actual peer %s regardless of local Host', (remoteAddress) => {
    expect(() => guardConsoleTransport({ ...local, remoteAddress })).toThrow(expect.objectContaining({ status: 403 }))
  })
  it.each(['localhost.evil:3080', 'evil.localhost:3080', '127.0.0.1:3081', '127.0.0.1', 'localhost:3080@evil', '127.1:3080', '127.0.0.1:3080,evil', undefined])('rejects an unrecognized or mismatched authority %s', (host) => {
    expect(() => guardConsoleTransport({ ...local, host })).toThrow(expect.objectContaining({ status: 403 }))
  })
  it.each(['null', 'http://localhost:3080', 'http://127.0.0.1:3081', 'https://127.0.0.1:3080', 'http://127.0.0.1:3080/', 'http://user@127.0.0.1:3080', 'http://127.0.0.1:3080 http://evil', 'http://evil'])('rejects malformed, multiple, opaque or foreign Origin %s', (origin) => {
    expect(() => guardConsoleTransport({ ...local, origin })).toThrow(expect.objectContaining({ status: 403 }))
  })
  it('does not let missing Origin bypass peer/Host or contradictory fetch metadata', () => {
    expect(() => guardConsoleTransport({ ...local, origin: undefined })).not.toThrow()
    expect(() => guardConsoleTransport({ ...local, origin: undefined, fetchSite: 'cross-site' })).toThrow()
    expect(() => guardConsoleTransport({ ...local, origin: undefined, remoteAddress: '10.1.2.3' })).toThrow()
    expect(() => guardConsoleTransport({ ...local, host: '[::1]:3080', origin: 'http://[::1]:3080' })).not.toThrow()
    expect(() => guardConsoleTransport({ ...local, host: 'localhost:3080', origin: 'http://localhost:3080' })).not.toThrow()
  })
})
