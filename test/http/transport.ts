/** Direct loopback HTTP, independent of global proxy-enabled agents/fetch. */
import { request } from 'node:http'
export function consoleRequest(url: string, method = 'GET', body?: Buffer | Buffer[], headers: Record<string, string | string[]> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers as Record<string, string> })))
    })
    req.on('error', reject)
    req.setTimeout(4000, () => req.destroy(new Error('HTTP test timeout')))
    if (Array.isArray(body)) for (const chunk of body) req.write(chunk)
    else if (body !== undefined) req.write(body)
    req.end()
  })
}
