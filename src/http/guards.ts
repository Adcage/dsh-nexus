/** HTTP-only trust boundary. Forwarded headers are never transport evidence. */
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { isLoopbackHost } from '@deepseek-ai/dsh-host-webserver'

export const HTTP_BODY_MAX_BYTES = 256 * 1024
const BODY_TIMEOUT_MS = 10_000

/** Sanitized failures owned by the HTTP boundary, never infrastructure text. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

/** Pure transport facts make non-loopback refusal testable without a LAN listener. */
export interface ConsoleTransport {
  readonly remoteAddress: string | undefined
  readonly localPort: number | undefined
  readonly protocol: 'http:' | 'https:'
  readonly host: string | undefined
  readonly origin: string | undefined
  readonly fetchSite: string | undefined
}

/** Validate an actual peer plus a local authority and, when present, exact origin. */
export function guardConsoleTransport(facts: ConsoleTransport): void {
  const refuse = () => { throw new HttpError(403, 'UNSAFE_CALLER', 'A local same-origin caller is required.') }
  if (facts.remoteAddress === undefined || !isLoopbackHost(facts.remoteAddress)) refuse()
  if (facts.host === undefined || !/^(localhost|127(?:\.\d{1,3}){3}|\[[a-fA-F0-9:.]+\])(?::[0-9]+)?$/.test(facts.host!)) refuse()
  let authority: URL
  try { authority = new URL(`${facts.protocol}//${facts.host}`) } catch { return refuse() }
  const hostname = authority.hostname.replace(/^\[|\]$/g, '')
  if (hostname !== 'localhost' && !isLoopbackHost(hostname)) refuse()
  const port = Number(authority.port || (facts.protocol === 'https:' ? 443 : 80))
  if (facts.localPort === undefined || port !== facts.localPort) refuse()
  if (facts.fetchSite !== undefined && facts.fetchSite !== 'same-origin' && facts.fetchSite !== 'none') refuse()
  if (facts.origin !== undefined) {
    let origin: URL
    try { origin = new URL(facts.origin) } catch { return refuse() }
    // URL parsing must not turn paths, credentials, lists or opaque/null origins
    // into an accepted origin. The Origin field is a serialized origin only.
    if (facts.origin !== origin.origin || origin.origin !== authority.origin) refuse()
  }
}

/** Reject duplicate sensitive headers, including Node's normally coalesced ones. */
export function singleHeader(req: IncomingMessage, name: string): string | undefined {
  let count = 0
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i]?.toLowerCase() === name) count++
  const value = req.headers[name]
  if (count > 1 || Array.isArray(value)) throw new HttpError(403, 'UNSAFE_CALLER', 'Ambiguous request headers are not allowed.')
  return value
}

export function guardConsoleRequest(req: IncomingMessage, protocol: 'http:' | 'https:'): void {
  guardConsoleTransport({ remoteAddress: req.socket.remoteAddress, localPort: req.socket.localPort, protocol,
    host: singleHeader(req, 'host'), origin: singleHeader(req, 'origin'), fetchSite: singleHeader(req, 'sec-fetch-site') })
}

/** All writes require both an instance-bound secret and unambiguous JSON. */
export function guardConsoleWrite(req: IncomingMessage, token: string): void {
  const supplied = Buffer.from(singleHeader(req, 'x-nexus-csrf') ?? '', 'utf8')
  const expected = Buffer.from(token, 'utf8')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new HttpError(403, 'INVALID_CSRF', 'A current Nexus CSRF token is required.')
  }
  const type = singleHeader(req, 'content-type')
  if (type === undefined || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json with UTF-8.')
  }
  if (req.headers['content-encoding'] !== undefined) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content encoding is not supported.')
}

/** Bounded raw-byte reader; cancellation never waits for an unfinished client. */
export function readConsoleJson(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const length = singleHeader(req, 'content-length')
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > HTTP_BODY_MAX_BYTES)) {
    throw new HttpError(413, 'BODY_TOO_LARGE', 'The request body exceeds 256 KiB.')
  }
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    const cleanup = () => {
      clearTimeout(timer)
      req.off('data', onData); req.off('end', onEnd); req.off('aborted', onAbort); req.off('error', onAbort)
      signal.removeEventListener('abort', onClose)
    }
    const fail = (error: HttpError) => { cleanup(); req.pause(); reject(error) }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > HTTP_BODY_MAX_BYTES) { fail(new HttpError(413, 'BODY_TOO_LARGE', 'The request body exceeds 256 KiB.')); return }
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      try {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, size))
        resolve(JSON.parse(text) as unknown)
      } catch { reject(new HttpError(400, 'INVALID_REQUEST', 'A valid UTF-8 JSON body is required.')) }
    }
    const onAbort = () => fail(new HttpError(400, 'INVALID_REQUEST', 'The request body was interrupted.'))
    const onClose = () => fail(new HttpError(503, 'RESOURCE_NOT_AVAILABLE', 'The Nexus API is closing.'))
    const timer = setTimeout(() => fail(new HttpError(408, 'REQUEST_TIMEOUT', 'The request body timed out.')), BODY_TIMEOUT_MS)
    timer.unref()
    req.on('data', onData); req.once('end', onEnd); req.once('aborted', onAbort); req.once('error', onAbort)
    signal.addEventListener('abort', onClose, { once: true })
    if (signal.aborted) onClose()
    else if (req.aborted || req.destroyed) onAbort()
  })
}
