/**
 * Durable web results: publication, retention and cold reopen.
 *
 * Every case runs against the shipped storage stack over the real JSON backend
 * and a real temporary medium, so "saved" means a record the next open reads
 * back — never a test-only map. The instrumented seam is the medium boundary
 * itself, which can refuse one write or delete, so a failed publication or a
 * failed eviction is observed instead of asserted from a mock's promise.
 *
 * @module dsh-nexus/test/web/results
 */

import { Buffer } from 'node:buffer'
import { afterAll, describe, expect, it } from 'vitest'
import { NexusError } from '../../src/runtime/errors.ts'
import type { WebDocument } from '../../src/protocol.ts'
import {
  createWebResultRepository,
  savedFootprint,
  type NewWebDocument,
  type WebRetentionLimits,
  type WebResultRepository,
} from '../../src/web/results.ts'
import { mountNexusStoreFixture, type NexusStoreFixture } from '../support/fixtures.ts'

/** Fixtures owned by this file, disposed once after all cases. */
const open: NexusStoreFixture[] = []

afterAll(async () => {
  for (const fixture of open.splice(0)) await fixture.dispose()
})

/** One closed fixture; the case disposes its store before the fixture. */
async function fixture(): Promise<NexusStoreFixture> {
  const created = await mountNexusStoreFixture()
  open.push(created)
  return created
}

/** A fixed clock the case can advance. */
interface Clock {
  now(): Date
  advance(ms: number): void
}

/**
 * @param start - first ISO instant.
 * @returns the controllable clock.
 */
function createClock(start = '2026-11-01T00:00:00.000Z'): Clock {
  let current = Date.parse(start)
  return {
    now: () => new Date(current),
    advance(ms) {
      current += ms
    },
  }
}

/** The production limits, narrowed by a case where it needs smaller numbers. */
const PRODUCTION_LIMITS: WebRetentionLimits = {
  maxDocumentBytes: 8 * 1024 * 1024,
  maxDocuments: 32,
  maxBytes: 32 * 1024 * 1024,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
}

/** One fetch document input; fields a case cares about can override it. */
function fetchInput(owner: string, overrides: Partial<NewWebDocument> = {}): NewWebDocument {
  return {
    owner,
    kind: 'fetch',
    source: 'http',
    url: 'https://example.test/docs',
    content: 'upstream body',
    convertedText: 'readable body',
    textBasis: 'converted-text',
    upstreamTruncated: false,
    ...overrides,
  }
}

/** Read one saved document through the repository, or fail the case. */
async function readDocument(
  repository: WebResultRepository,
  owner: string,
  resultId: string,
): Promise<WebDocument> {
  return (await repository.read(owner, resultId)).document
}

describe('publication', () => {
  it('persists the actual text and reads it back after a cold reopen', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const clock = createClock()
      const repository = createWebResultRepository(store, { now: clock.now, limits: PRODUCTION_LIMITS })

      const saved = await repository.save(
        fetchInput('sess-1', { summary: 'upstream answer', convertedText: 'saved conversion' }),
      )

      expect(saved.resultId).toMatch(/^web-/)
      expect(saved.createdAt).toBe('2026-11-01T00:00:00.000Z')
      expect(saved.expiresAt).toBe('2026-11-08T00:00:00.000Z')
      expect(medium.listWrites()).toContain(`web_documents/${JSON.stringify(['sess-1', saved.resultId])}`)

      const first = await repository.read('sess-1', saved.resultId)
      expect(first.basis).toBe('converted-text')
      expect(first.text).toBe('saved conversion')

      await store.dispose()
      const reopenedStore = await medium.open()
      const reopened = createWebResultRepository(reopenedStore, { now: clock.now, limits: PRODUCTION_LIMITS })
      const second = await reopened.read('sess-1', saved.resultId)

      expect(second.document).toEqual(saved)
      expect(second.basis).toBe('converted-text')
      expect(second.text).toBe('saved conversion')
    } finally {
      await medium.dispose()
    }
  })

  it('keeps raw content, conversion and summary distinct in the stored record', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const repository = createWebResultRepository(store, { now: createClock().now, limits: PRODUCTION_LIMITS })
      const saved = await repository.save(
        fetchInput('sess-1', {
          content: '<p>raw html</p>',
          convertedText: 'converted text',
          summary: 'search answer',
          textBasis: 'converted-text',
        }),
      )

      expect(saved.content).toBe('<p>raw html</p>')
      expect(saved.convertedText).toBe('converted text')
      expect(saved.summary).toBe('search answer')
      expect(await readDocument(repository, 'sess-1', saved.resultId)).toMatchObject({
        content: '<p>raw html</p>',
        convertedText: 'converted text',
        summary: 'search answer',
      })
    } finally {
      await medium.dispose()
    }
  })

  it('refuses to publish a document the medium rejects and returns no id', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const repository = createWebResultRepository(store, { now: createClock().now, limits: PRODUCTION_LIMITS })
      medium.failNextPut('web_documents')

      await expect(repository.save(fetchInput('sess-1'))).rejects.toThrow(/refused the write of 'web_documents/)

      expect(await store.listWeb('sess-1')).toEqual([])
    } finally {
      await medium.dispose()
    }
  })
})

describe('size limits', () => {
  it('counts the whole stored record, including duplicate text fields and metadata', async () => {
    const document: WebDocument = {
      owner: 'sess-1',
      resultId: 'web-1',
      kind: 'fetch',
      source: 'http',
      url: 'https://example.test/docs',
      content: 'raw',
      convertedText: 'converted',
      summary: 'summary',
      textBasis: 'converted-text',
      upstreamTruncated: false,
      savedTruncated: false,
      createdAt: '2026-11-01T00:00:00.000Z',
      expiresAt: '2026-11-08T00:00:00.000Z',
    }

    expect(savedFootprint(document)).toBe(Buffer.byteLength(JSON.stringify(document), 'utf8'))
    expect(savedFootprint(document)).toBeGreaterThan(Buffer.byteLength(JSON.stringify({ ...document, summary: undefined }), 'utf8'))
  })

  it('truncates one oversized document at a safe boundary and marks it saved-truncated', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const limits: WebRetentionLimits = { ...PRODUCTION_LIMITS, maxDocumentBytes: 400 }
      const repository = createWebResultRepository(store, { now: createClock().now, limits })
      const content = 'a'.repeat(2_000)

      const saved = await repository.save(fetchInput('sess-1', { content, convertedText: undefined, textBasis: 'content' }))

      expect(saved.savedTruncated).toBe(true)
      expect(saved.upstreamTruncated).toBe(false)
      expect(saved.content.length).toBeLessThan(content.length)
      expect(content.startsWith(saved.content)).toBe(true)
      expect(savedFootprint(saved)).toBeLessThanOrEqual(400)
      expect((await repository.read('sess-1', saved.resultId)).text).toBe(saved.content)
    } finally {
      await medium.dispose()
    }
  })

  it('never saves half a surrogate pair when the stored copy is cut', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const limits: WebRetentionLimits = { ...PRODUCTION_LIMITS, maxDocumentBytes: 420 }
      const repository = createWebResultRepository(store, { now: createClock().now, limits })
      const content = '😀'.repeat(500)

      const saved = await repository.save(fetchInput('sess-1', { content, convertedText: undefined, textBasis: 'content' }))

      expect(saved.savedTruncated).toBe(true)
      expect(saved.content.length % 2).toBe(0)
      expect(saved.content.length).toBeLessThan(content.length)
      const last = saved.content.charCodeAt(saved.content.length - 1)
      expect(last).toBeGreaterThanOrEqual(0xdc00)
      expect(last).toBeLessThanOrEqual(0xdfff)
      expect(savedFootprint(saved)).toBeLessThanOrEqual(420)
    } finally {
      await medium.dispose()
    }
  })
})

describe('retention', () => {
  it('evicts the oldest document before publishing beyond the owner document cap', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const clock = createClock()
      const limits: WebRetentionLimits = { ...PRODUCTION_LIMITS, maxDocuments: 2 }
      const repository = createWebResultRepository(store, { now: clock.now, limits })

      const first = await repository.save(fetchInput('sess-1', { url: 'https://example.test/1' }))
      clock.advance(1)
      const second = await repository.save(fetchInput('sess-1', { url: 'https://example.test/2' }))
      clock.advance(1)
      const third = await repository.save(fetchInput('sess-1', { url: 'https://example.test/3' }))

      expect(await store.listWeb('sess-1')).toHaveLength(2)
      await expect(repository.read('sess-1', first.resultId)).rejects.toMatchObject({
        name: 'NexusError',
        code: 'RESOURCE_NOT_AVAILABLE',
      })
      expect(await readDocument(repository, 'sess-1', second.resultId)).toBeDefined()
      expect(await readDocument(repository, 'sess-1', third.resultId)).toBeDefined()
    } finally {
      await medium.dispose()
    }
  })

  it('evicts the oldest documents until the owner byte cap holds', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const clock = createClock()
      const limits: WebRetentionLimits = {
        ...PRODUCTION_LIMITS,
        maxDocumentBytes: 1_000,
        maxBytes: 1_200,
      }
      const repository = createWebResultRepository(store, { now: clock.now, limits })

      for (let index = 0; index < 4; index += 1) {
        clock.advance(1)
        await repository.save(
          fetchInput('sess-1', { url: `https://example.test/${index}`, content: 'x'.repeat(300), convertedText: undefined, textBasis: 'content' }),
        )
      }

      const stored = await store.listWeb('sess-1')
      expect(stored.length).toBeGreaterThan(0)
      expect(stored.reduce((total, document) => total + savedFootprint(document), 0)).toBeLessThanOrEqual(1_200)
    } finally {
      await medium.dispose()
    }
  })

  it('purges an expired document and reports it unavailable', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const clock = createClock()
      const limits: WebRetentionLimits = { ...PRODUCTION_LIMITS, retentionMs: 1_000 }
      const repository = createWebResultRepository(store, { now: clock.now, limits })

      const expired = await repository.save(fetchInput('sess-1'))
      clock.advance(1_001)

      await expect(repository.read('sess-1', expired.resultId)).rejects.toMatchObject({
        name: 'NexusError',
        code: 'RESOURCE_NOT_AVAILABLE',
      })

      const fresh = await repository.save(fetchInput('sess-1', { url: 'https://example.test/fresh' }))
      expect((await store.listWeb('sess-1')).map((document) => document.resultId)).toEqual([fresh.resultId])
    } finally {
      await medium.dispose()
    }
  })

  it('never lets concurrent saves for one owner exceed the caps', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const clock = createClock()
      const limits: WebRetentionLimits = { ...PRODUCTION_LIMITS, maxDocuments: 3 }
      const repository = createWebResultRepository(store, { now: clock.now, limits })

      const saved = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          repository.save(fetchInput('sess-1', { url: `https://example.test/${index}` })),
        ),
      )

      const stored = await store.listWeb('sess-1')
      expect(stored).toHaveLength(3)
      for (const document of stored) expect(saved).toContainEqual(document)
      expect(stored.reduce((total, document) => total + savedFootprint(document), 0)).toBeLessThanOrEqual(limits.maxBytes)
    } finally {
      await medium.dispose()
    }
  })

  it('fails the publication when the eviction delete is refused instead of exceeding the cap', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const clock = createClock()
      const limits: WebRetentionLimits = { ...PRODUCTION_LIMITS, maxDocuments: 1 }
      const repository = createWebResultRepository(store, { now: clock.now, limits })

      const kept = await repository.save(fetchInput('sess-1', { url: 'https://example.test/kept' }))
      medium.failNextDelete('web_documents')

      await expect(repository.save(fetchInput('sess-1', { url: 'https://example.test/new' }))).rejects.toThrow(
        /refused the delete of 'web_documents/,
      )

      expect((await store.listWeb('sess-1')).map((document) => document.resultId)).toEqual([kept.resultId])
    } finally {
      await medium.dispose()
    }
  })

  it('records that a failed publication may already have evicted older results', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const clock = createClock()
      const limits: WebRetentionLimits = { ...PRODUCTION_LIMITS, maxDocuments: 1 }
      const repository = createWebResultRepository(store, { now: clock.now, limits })

      const evicted = await repository.save(fetchInput('sess-1', { url: 'https://example.test/old' }))
      medium.failNextPut('web_documents')

      await expect(repository.save(fetchInput('sess-1', { url: 'https://example.test/new' }))).rejects.toThrow(
        /refused the write of 'web_documents/,
      )

      // The accepted cache ordering makes room before the write: the older record is
      // gone and the failed save published nothing, so no id can be used later.
      expect(await store.getWeb('sess-1', evicted.resultId)).toBeUndefined()
      expect(await store.listWeb('sess-1')).toEqual([])
    } finally {
      await medium.dispose()
    }
  })
})

describe('availability', () => {
  it('refuses a result id that belongs to another session', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const repository = createWebResultRepository(store, { now: createClock().now, limits: PRODUCTION_LIMITS })
      const saved = await repository.save(fetchInput('sess-1'))

      await expect(repository.read('sess-2', saved.resultId)).rejects.toMatchObject({
        name: 'NexusError',
        code: 'RESOURCE_NOT_AVAILABLE',
      })
      await expect(repository.read('sess-1', 'web-never-saved')).rejects.toMatchObject({
        name: 'NexusError',
        code: 'RESOURCE_NOT_AVAILABLE',
      })
      expect(await readDocument(repository, 'sess-1', saved.resultId)).toBeDefined()
    } finally {
      await medium.dispose()
    }
  })

  it('reports a missing store record as unavailable rather than as an empty document', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const repository = createWebResultRepository(store, { now: createClock().now, limits: PRODUCTION_LIMITS })
      const saved = await repository.save(fetchInput('sess-1'))

      await store.deleteWeb('sess-1', saved.resultId)

      await expect(repository.read('sess-1', saved.resultId)).rejects.toBeInstanceOf(NexusError)
    } finally {
      await medium.dispose()
    }
  })
})

describe('closing admissions', () => {
  it('refuses new publications and joins the one already accepted', async () => {
    const medium = await fixture()
    const store = await medium.open()
    try {
      const repository = createWebResultRepository(store, { now: createClock().now, limits: PRODUCTION_LIMITS })
      const hold = medium.holdNextPut('web_documents')
      const accepted = repository.save(fetchInput('sess-close'))
      await hold.waitUntilHeld()

      repository.closeAdmissions()
      await expect(repository.save(fetchInput('sess-close', { content: 'second body' }))).rejects.toMatchObject({
        code: 'RESOURCE_NOT_AVAILABLE',
      })

      let joined = false
      const draining = repository.drain()
      void draining.then(
        () => {
          joined = true
        },
        () => undefined,
      )
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(joined).toBe(false)

      hold.release()
      await draining
      const saved = await accepted
      expect((await repository.read('sess-close', saved.resultId)).document.content).toBe('upstream body')
    } finally {
      await medium.dispose()
    }
  }, 60_000)
})
