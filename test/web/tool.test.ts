/**
 * The `web` tool: native search/fetch batches plus durable read/find.
 *
 * Every case drives the real DSH tool pipeline (`ctx.tools.execute` with its
 * argument and output validation) and the real `WebRuntime`; only the search and
 * fetch providers are scripted, so no request leaves the process. Saved results
 * live in the real storage stack over the shipped JSON backend, which is what
 * lets a case reopen the store and read the same text instead of trusting an
 * in-memory fake repository.
 *
 * @module dsh-nexus/test/web/tool
 */

import { Buffer } from 'node:buffer'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { WebError, type WebFetchRequest, type WebFetchResult, type WebSearchRequest } from '@deepseek-ai/dsh-web'
import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import type { RuntimeSettings, WebSettings } from '../../src/protocol.ts'
import type { NexusStore } from '../../src/storage/store.ts'
import { createDshWebBackend } from '../../src/web/backend.ts'
import type { WebItemResult } from '../../src/web/results.ts'
import { createWebTool } from '../../src/web/tool.ts'
import {
  mountNexusStoreFixture,
  type NexusStoreFixture,
  type WebDoubleOptions,
} from '../support/fixtures.ts'
import { createToolHarness, type ToolHarness } from '../support/harness.ts'

/** Every case fixture, disposed once after the suite. */
const openCases: WebCase[] = []
const openStorages: NexusStoreFixture[] = []

afterAll(async () => {
  for (const testCase of openCases.splice(0)) await testCase.dispose()
  for (const storage of openStorages.splice(0)) await storage.dispose()
})

/** One registered web tool over a real harness and real storage. */
interface WebCase {
  readonly harness: ToolHarness
  readonly store: NexusStore
  readonly settings: { value: RuntimeSettings }
  /**
   * Run one call through the real registry pipeline.
   * @param args - model-shaped arguments.
   * @returns the normalized registry result.
   */
  call(args: Record<string, unknown>): Promise<ToolExecutionResult>
  /**
   * Run the tool body directly with one execution context.
   * @param args - validated-shaped arguments.
   * @param exec - the execution context to hand the body.
   * @returns the canonical value, without registry cancellation replacement.
   */
  runBody(args: Record<string, unknown>, exec: ToolRunContext): Promise<unknown>
  /** Unload the harness and whatever storage this case owns. */
  dispose(): Promise<void>
}

/** Monotonic call ids across the suite. */
let callSequence = 0

/**
 * Register one web tool on a fresh harness.
 * @param options - owner identity, scripted providers, shared store and settings.
 * @returns the ready case.
 */
async function createWebCase(
  options: {
    readonly sessionId?: string
    readonly signal?: AbortSignal
    readonly web?: WebDoubleOptions
    readonly store?: NexusStore
    readonly settings?: RuntimeSettings
  } = {},
): Promise<WebCase> {
  const harnessOptions =
    options.sessionId === undefined && options.signal === undefined
      ? {}
      : {
          owner: {
            ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          },
        }
  const harness = await createToolHarness({
    ...harnessOptions,
    ...(options.web === undefined ? {} : { web: options.web }),
  })
  let ownedStorage: NexusStoreFixture | undefined
  let store = options.store
  if (store === undefined) {
    ownedStorage = await mountNexusStoreFixture()
    openStorages.push(ownedStorage)
    store = await ownedStorage.open()
  }
  const settings = { value: options.settings ?? DEFAULT_SETTINGS }
  const tool = createWebTool(harness.ctx, store, () => settings.value)
  harness.ctx.tools.register(tool)
  const testCase: WebCase = {
    harness,
    store,
    settings,
    async call(args) {
      callSequence += 1
      return harness.ctx.tools.execute({
        callId: ToolCallId(`web-tool-${callSequence}`),
        name: 'web',
        arguments: args,
        agent: harness.owner.agent,
        signal: harness.owner.signal,
      })
    },
    runBody: (args, exec) => tool.execute(args, exec),
    async dispose() {
      await harness.dispose()
    },
  }
  openCases.push(testCase)
  return testCase
}

/** Settings with one narrowed web section. */
function settingsWith(web: Partial<WebSettings>): RuntimeSettings {
  return { ...DEFAULT_SETTINGS, web: { ...DEFAULT_SETTINGS.web, ...web } }
}

/** One search/fetch/read/find canonical value as the tool emits it. */
interface WebValue {
  readonly action: 'search' | 'fetch' | 'read' | 'find'
  readonly items?: readonly WebItemResult[]
  readonly resultId?: string
  readonly kind?: 'search' | 'fetch'
  readonly source?: string
  readonly url?: string
  readonly query?: string
  readonly resolvedUrl?: string
  readonly basis?: string
  readonly text?: string
  readonly offset?: number
  readonly endOffset?: number
  readonly nextOffset?: number
  readonly totalLength?: number
  readonly atEnd?: boolean
  readonly upstreamTruncated?: boolean
  readonly savedTruncated?: boolean
  readonly summaryOnly?: boolean
  readonly hasSummary?: boolean
  readonly conversionSkipped?: boolean
  readonly matches?: readonly { offset: number; endOffset: number; snippet: string; snippetOffset: number }[]
  readonly matchesTruncated?: boolean
  readonly scannedTo?: number
  readonly caseSensitive?: boolean
}

/** Assert one registry success and return its canonical value. */
function valueOf(result: ToolExecutionResult): WebValue {
  if (result.isError) throw new Error(`expected success, got ${JSON.stringify(result.error)}`)
  return result.value as unknown as WebValue
}

/** The batch items of one successful search/fetch call. */
function itemsOf(result: ToolExecutionResult): readonly WebItemResult[] {
  const items = valueOf(result).items
  if (items === undefined) throw new Error('the batch value has no items')
  return items
}

/** Model-facing text of one result. */
function resultText(result: ToolExecutionResult): string {
  return result.content.map((block: ContentBlock) => (block.type === 'text' ? block.text : '')).join('\n')
}

/** One text fetch answer. */
function textFetch(url: string, content: string, truncated = false): WebFetchResult {
  return { url, statusCode: 200, body: { kind: 'text', content }, truncated }
}

/** The search request the provider actually received. */
function searchesOf(testCase: WebCase): readonly WebSearchRequest[] {
  return testCase.harness.web.searches
}

/** The fetch request the provider actually received. */
function fetchesOf(testCase: WebCase): readonly WebFetchRequest[] {
  return testCase.harness.web.fetches
}

/** A minimal execution context for a direct body call. */
function bodyExecution(agent: Agent, signal: AbortSignal): ToolRunContext {
  callSequence += 1
  const callId = ToolCallId(`web-body-${callSequence}`)
  return {
    callId,
    rootCallId: callId,
    token: Object.freeze({}) as unknown as ToolRunContext['token'],
    name: 'web',
    arguments: {},
    agent,
    signal,
    deferContext() {},
    concludeTurn() {},
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('search batches', () => {
  it('preserves partial results in input order without a hidden refetch or fallback', async () => {
    const testCase = await createWebCase({
      web: {
        search: async (request) => {
          if (request.query === 'quota') throw new WebError('the search quota is exhausted', 'WEB_QUOTA_EXCEEDED')
          return {
            sources: [{ url: `https://example.test/${request.query}`, title: `Result ${request.query}`, snippet: 'snippet' }],
            truncated: false,
          }
        },
      },
    })

    const result = await testCase.call({ action: 'search', queries: ['alpha', 'quota', 'omega'] })

    const items = itemsOf(result)
    expect(items.map((item) => item.ok)).toEqual([true, false, true])
    expect(items.map((item) => item.query)).toEqual(['alpha', 'quota', 'omega'])
    expect(items[0]?.resultId).toMatch(/^web-/)
    expect(items[1]?.error).toEqual({ code: 'WEB_QUOTA_EXCEEDED', message: 'the search quota is exhausted' })
    expect(items[2]?.resultId).toMatch(/^web-/)
    expect(searchesOf(testCase).map((request) => request.query)).toEqual(['alpha', 'quota', 'omega'])
    expect(fetchesOf(testCase)).toHaveLength(0)
  })

  it('saves a readable source listing and keeps an upstream summary distinct', async () => {
    const testCase = await createWebCase({
      web: {
        search: async () => ({
          content: 'provider answer',
          sources: [
            { url: 'https://example.test/a', title: 'Example title', snippet: 'snippet text' },
            { url: 'https://example.test/b', snippet: 'second snippet' },
          ],
          truncated: true,
        }),
      },
    })

    const [item] = itemsOf(await testCase.call({ action: 'search', queries: ['alpha'] }))
    expect(item).toMatchObject({ ok: true, query: 'alpha', upstreamTruncated: true, summaryOnly: false })
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')

    const read = valueOf(await testCase.call({ action: 'read', resultId }))
    expect(read).toMatchObject({
      action: 'read',
      resultId,
      basis: 'search-results',
      summaryOnly: false,
      hasSummary: true,
      upstreamTruncated: true,
      savedTruncated: false,
    })
    expect(read.text).toContain('Example title')
    expect(read.text).toContain('https://example.test/a')
    expect(read.text).toContain('snippet text')
    expect(read.text).toContain('https://example.test/b')
    expect(read.text).not.toContain('provider answer')
  })

  it('labels a summary-only answer as summary-only instead of full text', async () => {
    const testCase = await createWebCase({
      web: { search: async () => ({ content: 'aggregated answer', sources: [], truncated: false }) },
    })

    const [item] = itemsOf(await testCase.call({ action: 'search', queries: ['only'] }))
    expect(item).toMatchObject({ ok: true, summaryOnly: true })
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')

    const result = await testCase.call({ action: 'read', resultId })
    const read = valueOf(result)
    expect(read).toMatchObject({ basis: 'summary', summaryOnly: true, text: 'aggregated answer', atEnd: true })
    expect(resultText(result)).toMatch(/summary only/i)
    expect(resultText(result)).not.toMatch(/complete (page|document|body)|full text/i)
  })

  it('caps the sources per query with the stored setting and the hard limit', async () => {
    const testCase = await createWebCase({
      settings: settingsWith({ maxResults: 5 }),
      web: { search: async () => ({ sources: [], truncated: false }) },
    })

    await testCase.call({ action: 'search', queries: ['a', 'b'] })
    expect(searchesOf(testCase).map((request) => request.maxResults)).toEqual([5, 5])

    await testCase.call({ action: 'search', queries: ['a'], maxResults: 10 })
    expect(searchesOf(testCase)[2]?.maxResults).toBe(10)

    const tooMany = await testCase.call({ action: 'search', queries: ['a'], maxResults: 11 })
    expect(tooMany.isError).toBe(true)
    expect(tooMany.error?.info?.code).toBe('INVALID_ARGUMENT')
    expect(searchesOf(testCase)).toHaveLength(3)
  })

  it('runs at most the fixed batch concurrency', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const testCase = await createWebCase({
      web: {
        search: async (request) => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 25))
          inFlight -= 1
          return { sources: [{ url: `https://example.test/${request.query}` }], truncated: false }
        },
      },
    })

    await testCase.call({ action: 'search', queries: ['a', 'b', 'c'] })

    expect(maxInFlight).toBe(2)
    expect(searchesOf(testCase)).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Fetch and stored representation
// ---------------------------------------------------------------------------

describe('fetch batches', () => {
  it('reports one failure without dropping the other successes and never retries', async () => {
    const testCase = await createWebCase({
      web: {
        fetch: async (request) => {
          if (request.url.endsWith('/bad')) throw new Error('provider exploded')
          return textFetch(request.url, `body for ${request.url}`)
        },
      },
    })

    const result = await testCase.call({
      action: 'fetch',
      urls: ['https://example.test/one', 'https://example.test/bad', 'https://example.test/two'],
    })

    const items = itemsOf(result)
    expect(items.map((item) => item.ok)).toEqual([true, false, true])
    expect(items[1]?.error).toEqual({ code: 'WEB_REQUEST_FAILED', message: 'provider exploded' })
    expect(items[0]?.resultId).toMatch(/^web-/)
    expect(items[2]?.resultId).toMatch(/^web-/)
    expect(fetchesOf(testCase).map((request) => request.url)).toEqual([
      'https://example.test/one',
      'https://example.test/bad',
      'https://example.test/two',
    ])
  })

  it('keeps a native provider refusal code unchanged', async () => {
    const testCase = await createWebCase({
      web: {
        fetch: async () => {
          throw new WebError('the fetch quota is exhausted', 'WEB_QUOTA_EXCEEDED')
        },
      },
    })

    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/x'] }))

    expect(item).toMatchObject({ ok: false, error: { code: 'WEB_QUOTA_EXCEEDED' } })
  })

  it('converts HTML statically and reads the conversion as the saved basis', async () => {
    const html = '<html><body><script>evil()</script><h1>Heading</h1><p>Body text</p></body></html>'
    const testCase = await createWebCase({
      web: { fetch: async (request) => ({ url: request.url, statusCode: 200, body: { kind: 'html', content: html }, truncated: false }) },
    })

    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/page'] }))
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')
    const stored = await testCase.store.getWeb(testCase.harness.owner.sessionId, resultId)
    expect(stored?.content).toBe(html)
    expect(stored?.convertedText).toContain('Heading')
    expect(stored?.convertedText).not.toContain('evil()')

    const read = valueOf(await testCase.call({ action: 'read', resultId }))
    expect(read).toMatchObject({ basis: 'converted-text', conversionSkipped: false })
    expect(read.text).toContain('Heading')
    expect(read.text).not.toContain('<h1>')
    expect(read.text).not.toContain('evil()')
  })

  it('records upstream truncation separately from the saved copy', async () => {
    const testCase = await createWebCase({
      web: { fetch: async (request) => textFetch(request.url, 'partial body', true) },
    })

    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/page'] }))
    expect(item).toMatchObject({ ok: true, upstreamTruncated: true, savedTruncated: false })
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')

    const result = await testCase.call({ action: 'read', resultId })
    expect(valueOf(result)).toMatchObject({ upstreamTruncated: true, savedTruncated: false })
    expect(resultText(result)).toMatch(/upstream/i)
  })

  it('marks a stored copy cut by the document cap and keeps the raw basis boundary', async () => {
    const body = 'a'.repeat(8 * 1024 * 1024 + 64)
    const testCase = await createWebCase({
      web: { fetch: async (request) => textFetch(request.url, body) },
    })

    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/huge'] }))
    expect(item).toMatchObject({ ok: true, upstreamTruncated: false, savedTruncated: true })
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')

    const stored = await testCase.store.getWeb(testCase.harness.owner.sessionId, resultId)
    expect(stored).toBeDefined()
    if (stored === undefined) throw new Error('missing stored document')
    expect(stored.content.length).toBeLessThan(body.length)
    expect(body.startsWith(stored.content)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(stored), 'utf8')).toBeLessThanOrEqual(8 * 1024 * 1024)

    const result = await testCase.call({ action: 'read', resultId })
    expect(valueOf(result)).toMatchObject({ savedTruncated: true, atEnd: false, offset: 0, endOffset: 12_000 })
    expect(resultText(result)).toMatch(/saved copy was truncated|truncated when saved/i)
  })
})

// ---------------------------------------------------------------------------
// read / find
// ---------------------------------------------------------------------------

describe('read and find', () => {
  it('pages the saved text by zero-based UTF-16 offset without a gap or a split surrogate', async () => {
    const body = `${'a'.repeat(11_999)}😀${'b'.repeat(5_000)}`
    const testCase = await createWebCase({ web: { fetch: async (request) => textFetch(request.url, body) } })
    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/long'] }))
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')

    const firstResult = await testCase.call({ action: 'read', resultId })
    const first = valueOf(firstResult)
    expect(first).toMatchObject({ offset: 0, endOffset: 12_001, nextOffset: 12_001, totalLength: body.length, atEnd: false })
    expect(first.text).toBe(body.slice(0, 12_001))
    expect(resultText(firstResult)).toMatch(/not the whole|continue/i)

    const second = valueOf(await testCase.call({ action: 'read', resultId, offset: first.nextOffset }))
    expect(second.offset).toBe(12_001)
    expect(String(first.text) + String(second.text)).toBe(body)
    expect(second.atEnd).toBe(true)
  })

  it('uses the stored page budget for a read that names no limit', async () => {
    const testCase = await createWebCase({
      settings: settingsWith({ maxCharsPerPage: 50 }),
      web: { fetch: async (request) => textFetch(request.url, 'x'.repeat(200)) },
    })
    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/page'] }))
    const read = valueOf(await testCase.call({ action: 'read', resultId: item?.resultId }))

    expect(read.text).toHaveLength(50)
    expect(read).toMatchObject({ offset: 0, endOffset: 50, nextOffset: 50, atEnd: false })
  })

  it('rejects a read range outside the saved text or above the page ceiling', async () => {
    const testCase = await createWebCase({ web: { fetch: async (request) => textFetch(request.url, 'abc') } })
    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/page'] }))
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')

    expect((await testCase.call({ action: 'read', resultId, offset: 4 })).error?.info?.code).toBe('INVALID_ARGUMENT')
    expect((await testCase.call({ action: 'read', resultId, offset: -1 })).error?.info?.code).toBe('INVALID_ARGUMENT')
    expect((await testCase.call({ action: 'read', resultId, limit: 24_001 })).error?.info?.code).toBe('INVALID_ARGUMENT')

    const atEnd = valueOf(await testCase.call({ action: 'read', resultId, offset: 3 }))
    expect(atEnd).toMatchObject({ text: '', offset: 3, atEnd: true })
  })

  it('finds literal matches at real source positions and supports case sensitivity', async () => {
    const body = 'İstanbul ABC abc'
    const testCase = await createWebCase({ web: { fetch: async (request) => textFetch(request.url, body) } })
    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/page'] }))
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')

    const insensitive = valueOf(await testCase.call({ action: 'find', resultId, text: 'abc' }))
    expect(insensitive).toMatchObject({ action: 'find', caseSensitive: false, matchesTruncated: false })
    expect(insensitive.matches?.map((match) => match.offset)).toEqual([9, 13])
    expect(insensitive.matches?.map((match) => body.slice(match.offset, match.endOffset))).toEqual(['ABC', 'abc'])
    expect(insensitive.matches?.every((match) => match.endOffset - match.offset === 3)).toBe(true)

    const sensitive = valueOf(await testCase.call({ action: 'find', resultId, text: 'abc', caseSensitive: true }))
    expect(sensitive.matches?.map((match) => match.offset)).toEqual([13])

    const around = valueOf(await testCase.call({ action: 'read', resultId, offset: 9, limit: 3 }))
    expect(around.text).toBe('ABC')
  })

  it('bounds reported matches and states that more remain', async () => {
    const testCase = await createWebCase({ web: { fetch: async (request) => textFetch(request.url, 'x'.repeat(500)) } })
    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/page'] }))
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')

    const found = valueOf(await testCase.call({ action: 'find', resultId, text: 'x' }))

    expect(found.matches).toHaveLength(50)
    expect(found.matchesTruncated).toBe(true)
    expect(found.scannedTo).toBe(50)
  })

  it('never calls the provider during read or find', async () => {
    const testCase = await createWebCase({ web: { fetch: async (request) => textFetch(request.url, 'needle body') } })
    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/page'] }))
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')
    const networkBeforeRead = fetchesOf(testCase).length + searchesOf(testCase).length

    await testCase.call({ action: 'read', resultId })
    await testCase.call({ action: 'find', resultId, text: 'needle' })

    expect(fetchesOf(testCase).length + searchesOf(testCase).length).toBe(networkBeforeRead)
  })

  it('reports an absent, evicted or foreign result id as unavailable without a network call', async () => {
    const testCase = await createWebCase({ web: { fetch: async (request) => textFetch(request.url, 'body') } })
    const [item] = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/page'] }))
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')
    const networkBefore = fetchesOf(testCase).length

    expect((await testCase.call({ action: 'read', resultId })).isError).toBe(false)
    const missing = await testCase.call({ action: 'read', resultId: 'web-never-saved' })
    expect(missing.isError).toBe(true)
    expect(missing.error?.info?.code).toBe('RESOURCE_NOT_AVAILABLE')
    const missingFind = await testCase.call({ action: 'find', resultId: 'web-never-saved', text: 'x' })
    expect(missingFind.error?.info?.code).toBe('RESOURCE_NOT_AVAILABLE')

    const other = await createWebCase({ sessionId: 'web-other', store: testCase.store })
    const foreignRead = await other.call({ action: 'read', resultId })
    expect(foreignRead.error?.info?.code).toBe('RESOURCE_NOT_AVAILABLE')
    const foreignFind = await other.call({ action: 'find', resultId, text: 'body' })
    expect(foreignFind.error?.info?.code).toBe('RESOURCE_NOT_AVAILABLE')
    expect(fetchesOf(testCase)).toHaveLength(networkBefore)
  })
})

// ---------------------------------------------------------------------------
// Ownership, failures and cancellation
// ---------------------------------------------------------------------------

describe('ownership', () => {
  it('rejects a stale same-id Agent instance before any network call', async () => {
    const testCase = await createWebCase({ web: { search: async () => ({ sources: [], truncated: false }) } })
    const stale = Object.create(testCase.harness.owner.agent) as Agent
    expect(stale.id).toBe(testCase.harness.owner.sessionId)

    const result = await testCase.harness.ctx.tools.execute({
      callId: ToolCallId('web-stale'),
      name: 'web',
      arguments: { action: 'search', queries: ['alpha'] },
      agent: stale,
      signal: testCase.harness.owner.signal,
    })

    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('NO_AGENT')
    expect(searchesOf(testCase)).toHaveLength(0)
  })

  it('keeps documents readable by the live Agent of the same session after a reopen', async () => {
    const storage = await mountNexusStoreFixture()
    openStorages.push(storage)
    const store = await storage.open()
    const first = await createWebCase({ sessionId: 'web-durable', store, web: { fetch: async (request) => textFetch(request.url, 'cold body') } })
    const [item] = itemsOf(await first.call({ action: 'fetch', urls: ['https://example.test/page'] }))
    const resultId = item?.resultId
    if (resultId === undefined) throw new Error('missing resultId')

    await store.dispose()
    const reopened = await createWebCase({ sessionId: 'web-durable', store: await storage.open() })
    const read = valueOf(await reopened.call({ action: 'read', resultId }))

    expect(read.text).toBe('cold body')
    expect(read.basis).toBe('content')
  })
})

describe('backend and provider failures', () => {
  it('reports a missing native web service as an unsupported capability', async () => {
    const backend = createDshWebBackend(new Context())

    await expect(backend.search({ query: 'x' })).rejects.toMatchObject({
      name: 'NexusError',
      code: 'UNSUPPORTED_CAPABILITY',
    })
    await expect(backend.fetch({ url: 'https://example.test/' })).rejects.toMatchObject({
      name: 'NexusError',
      code: 'UNSUPPORTED_CAPABILITY',
    })
  })

  it('reports a missing provider per item instead of inventing a result', async () => {
    const testCase = await createWebCase({ web: { registerProviders: false } })

    const searchItems = itemsOf(await testCase.call({ action: 'search', queries: ['alpha'] }))
    expect(searchItems).toHaveLength(1)
    expect(searchItems[0]).toMatchObject({ ok: false, query: 'alpha', error: { code: 'WEB_PROVIDER_UNAVAILABLE' } })

    const fetchItems = itemsOf(await testCase.call({ action: 'fetch', urls: ['https://example.test/'] }))
    expect(fetchItems[0]).toMatchObject({ ok: false, error: { code: 'WEB_PROVIDER_UNAVAILABLE' } })
  })

  it('rejects closed per-action input before any network or storage side effect', async () => {
    const testCase = await createWebCase({ web: { search: async () => ({ sources: [], truncated: false }) } })
    const invalid: Record<string, unknown>[] = [
      { action: 'search', urls: ['https://example.test/'] },
      { action: 'search', queries: [] },
      { action: 'search', queries: ['a', 'b', 'c', 'd'] },
      { action: 'search', queries: ['   '] },
      { action: 'search', queries: ['a'], maxResults: 0 },
      { action: 'fetch', queries: ['a'] },
      { action: 'fetch', urls: [] },
      { action: 'fetch', urls: ['https://example.test/1', 'https://example.test/2', 'https://example.test/3', 'https://example.test/4', 'https://example.test/5', 'https://example.test/6', 'https://example.test/7'] },
      { action: 'read', resultId: 'web-1', text: 'unexpected' },
      { action: 'read', resultId: '' },
      { action: 'find', resultId: 'web-1', offset: 3 },
      { action: 'find', resultId: 'web-1', text: '' },
    ]

    for (const args of invalid) {
      const result = await testCase.call(args)
      expect(result.isError, JSON.stringify(args)).toBe(true)
      expect(result.error?.info?.code, JSON.stringify(args)).toBe('INVALID_ARGUMENT')
    }
    const unknownAction = await testCase.call({ action: 'list' })
    expect(unknownAction.isError).toBe(true)
    expect(unknownAction.error?.info?.code).toBe('INVALID_ARGS')
    expect(searchesOf(testCase)).toHaveLength(0)
    expect(fetchesOf(testCase)).toHaveLength(0)
  })
})

describe('cancellation', () => {
  it('keeps every input in the batch when the caller cancels and never claims the call was free', async () => {
    const controller = new AbortController()
    const testCase = await createWebCase({
      signal: controller.signal,
      web: {
        fetch: async (request, signal) => {
          if (request.url.endsWith('/one')) {
            await new Promise((resolve) => setTimeout(resolve, 40))
            return textFetch(request.url, 'first body')
          }
          if (request.url.endsWith('/two')) {
            await new Promise<never>((_resolve, reject) => {
              const abort = (): void => reject(new WebError('the caller aborted the fetch', 'WEB_CANCELLED'))
              if (signal?.aborted === true) abort()
              else signal?.addEventListener('abort', abort, { once: true })
            })
          }
          throw new Error('the third fetch must never start')
        },
      },
    })

    const bodyPromise = testCase.runBody(
      { action: 'fetch', urls: ['https://example.test/one', 'https://example.test/two', 'https://example.test/three'] },
      bodyExecution(testCase.harness.owner.agent, controller.signal),
    )
    await new Promise((resolve) => setTimeout(resolve, 15))
    controller.abort()
    const items = (await bodyPromise) as WebValue
    const batch = items.items
    if (batch === undefined) throw new Error('missing items')

    expect(batch).toHaveLength(3)
    expect(batch.map((item) => item.ok)).toEqual([true, false, false])
    expect(batch[0]?.resultId).toMatch(/^web-/)
    expect(batch[1]?.error?.code).toBe('WEB_CANCELLED')
    expect(batch[2]?.error?.code).toBe('ABORTED')
    expect(batch[2]?.error?.message).toMatch(/not started/i)
    expect(batch[2]?.error?.message).toMatch(/may already have consumed/i)
    expect(fetchesOf(testCase)).toHaveLength(2)
  })

  it('lets the registry report native cancellation without a false success claim', async () => {
    const controller = new AbortController()
    const testCase = await createWebCase({
      signal: controller.signal,
      web: {
        fetch: async (request, signal) => {
          if (request.url.endsWith('/slow')) {
            await new Promise<never>((_resolve, reject) => {
              const abort = (): void => reject(new WebError('the caller aborted the fetch', 'WEB_CANCELLED'))
              if (signal?.aborted === true) abort()
              else signal?.addEventListener('abort', abort, { once: true })
            })
          }
          return textFetch(request.url, 'body')
        },
      },
    })

    const pending = testCase.call({ action: 'fetch', urls: ['https://example.test/slow'] })
    await new Promise((resolve) => setTimeout(resolve, 15))
    controller.abort()
    const result = await pending

    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('ABORTED')
    expect(result.value).toBeUndefined()
  })
})
