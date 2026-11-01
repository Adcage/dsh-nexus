/**
 * Durable web results: publication, retention and lookup.
 *
 * Two rules drive this module. A result id is only ever handed out *after* the
 * medium accepted the record, so a failed write can never look like a readable
 * document. And a publication first makes room — it purges expired records,
 * then evicts the oldest until the owner's count and byte caps hold — instead of
 * publishing an over-cap record or claiming capacity it does not have.
 *
 * Publications for one durable owner are serialized through a promise chain
 * held by this repository, so two parallel saves of the same batch cannot both
 * observe "one slot free" and exceed the cap. Ownership is the durable session
 * id; the caller's live Agent is verified by the tool at the request and
 * publication boundaries, never here.
 *
 * @module dsh-nexus/web/results
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import type { WebDocument, WebTextBasis } from '../protocol.ts'
import {
  WEB_DOCUMENT_MAX_BYTES,
  WEB_DOCUMENT_RETENTION_MS,
  WEB_SESSION_MAX_BYTES,
  WEB_SESSION_MAX_DOCUMENTS,
} from '../runtime/defaults.ts'
import { NexusError } from '../runtime/errors.ts'
import type { NexusStore } from '../storage/store.ts'
import { truncateToUtf8Bytes, utf8Bytes } from './extract.ts'

export type { WebTextBasis } from '../protocol.ts'

/** One item of a search or fetch batch, in input order. */
export interface WebItemResult {
  /** Search query this item answers; present for a `search` item. */
  readonly query?: string
  /** Requested URL this item answers; present for a `fetch` item. */
  readonly url?: string
  /** Whether a durable document was published for this input. */
  readonly ok: boolean
  /** Durable result id, present only when `ok`. */
  readonly resultId?: string
  /** Which action produced the item. */
  readonly kind?: 'search' | 'fetch'
  /** Final URL after allowed redirects; present for a successful `fetch`. */
  readonly resolvedUrl?: string
  /** Upstream returned less than the full document. */
  readonly upstreamTruncated?: boolean
  /** The saved copy dropped content to respect the size limit. */
  readonly savedTruncated?: boolean
  /** The saved text is the upstream summary, not a fetched body. */
  readonly summaryOnly?: boolean
  /** No readable conversion is stored for this document. */
  readonly conversionSkipped?: boolean
  /** Independent safe failure of this item; never a stack trace or host handle. */
  readonly error?: WebItemFailure
}

/** One item's failure, carrying the native code when there is one. */
export interface WebItemFailure {
  /** Native error code when the failure carried one, else a Nexus fallback. */
  readonly code: string
  /** Human-readable failure message. */
  readonly message: string
}

/** One document a caller asks the repository to publish. */
export interface NewWebDocument {
  /** Durable session that owns the result. */
  readonly owner: string
  /** Which call produced the document. */
  readonly kind: 'search' | 'fetch'
  /** Provider or source label. */
  readonly source: string
  /** Final URL of a fetched document. */
  readonly url?: string
  /** Query of a search document. */
  readonly query?: string
  /** The text upstream delivered (or the rendered search listing). */
  readonly content: string
  /** Upstream-supplied summary, kept apart from `content`. */
  readonly summary?: string
  /** Readable conversion of `content`, when one was produced. */
  readonly convertedText?: string
  /** Which saved text `read` and `find` address. */
  readonly textBasis: WebTextBasis
  /** The HTML conversion was refused by the static safety guard. */
  readonly conversionSkipped?: boolean
  /** Upstream returned less than the full document. */
  readonly upstreamTruncated: boolean
}

/** Limits that govern one owner's stored documents. */
export interface WebRetentionLimits {
  /** Largest stored size of one document. */
  readonly maxDocumentBytes: number
  /** Documents one owner may hold. */
  readonly maxDocuments: number
  /** Stored bytes one owner's documents may occupy. */
  readonly maxBytes: number
  /** Retention of one document. */
  readonly retentionMs: number
}

/** One saved document plus the text its id now addresses. */
export interface SavedWebText {
  /** The stored record, exactly as the medium returned it. */
  readonly document: WebDocument
  /** Which field `text` was taken from. */
  readonly basis: WebTextBasis
  /** The complete saved basis text; callers page it themselves. */
  readonly text: string
}

/** The publication and lookup surface the tool uses. */
export interface WebResultRepository {
  /**
   * Publish one document after making room under the owner's caps.
   * @param input - the obtained content and its metadata.
   * @returns the stored document, including its durable result id.
   */
  save(input: NewWebDocument): Promise<WebDocument>
  /**
   * Read one saved document.
   * @param owner - durable session that owns the result.
   * @param resultId - result id within that owner.
   * @returns the document and the text its id addresses.
   * @throws NexusError `RESOURCE_NOT_AVAILABLE` when absent, expired or foreign.
   */
  read(owner: string, resultId: string): Promise<SavedWebText>
  /**
   * Refuse new publications; already accepted ones still run and drain.
   */
  closeAdmissions(): void
  /**
   * Wait until every publication accepted before the call settled.
   *
   * The runtime joins this before closing the store, so an accepted save cannot
   * be refused by a closed medium after it was promised.
   */
  drain(): Promise<void>
}

/** Options of one repository. */
export interface WebResultRepositoryOptions {
  /** Clock used for creation and expiry; defaults to the system clock. */
  readonly now?: () => Date
  /** Retention limits; defaults to the production caps. */
  readonly limits?: WebRetentionLimits
}

/** The production retention limits, in one place. */
export const DEFAULT_WEB_RETENTION_LIMITS: WebRetentionLimits = Object.freeze({
  maxDocumentBytes: WEB_DOCUMENT_MAX_BYTES,
  maxDocuments: WEB_SESSION_MAX_DOCUMENTS,
  maxBytes: WEB_SESSION_MAX_BYTES,
  retentionMs: WEB_DOCUMENT_RETENTION_MS,
})

/**
 * Measure one record's actual stored footprint.
 *
 * The whole JSON record is measured, so a duplicate text field (raw content and
 * its conversion, or an upstream summary) and the metadata count exactly as
 * they are stored — the same number retention enforces and the medium holds.
 * @param document - one saved document.
 * @returns its UTF-8 byte length as JSON.
 */
export function savedFootprint(document: WebDocument): number {
  return Buffer.byteLength(JSON.stringify(document), 'utf8')
}

/** Resolve which saved text a document's id addresses. */
function basisOf(document: WebDocument): { basis: WebTextBasis; text: string } {
  switch (document.textBasis) {
    case 'converted-text':
      if (document.convertedText !== undefined) return { basis: 'converted-text', text: document.convertedText }
      return { basis: 'content', text: document.content }
    case 'summary':
      return { basis: 'summary', text: document.summary ?? '' }
    default:
      return { basis: document.textBasis, text: document.content }
  }
}

/** The failure a missing, expired or foreign result id reports. */
function unavailable(resultId: string): NexusError {
  return new NexusError(
    'RESOURCE_NOT_AVAILABLE',
    `the saved web result "${resultId}" is not available for this session: it was never saved, expired, or was evicted by retention; obtain it again with search or fetch`,
  )
}

/** One repository instance; constructed by {@link createWebResultRepository}. */
class WebResultRepositoryHandle implements WebResultRepository {
  private readonly store: NexusStore
  private readonly now: () => Date
  private readonly limits: WebRetentionLimits
  /** Tail of the publication chain of each owner. */
  private readonly publishing = new Map<string, Promise<void>>()
  /** Whether new publications are refused; set before a teardown drains. */
  private admissionsClosed = false

  /**
   * @param store - the durable store.
   * @param options - clock and limits.
   */
  constructor(store: NexusStore, options: WebResultRepositoryOptions = {}) {
    this.store = store
    this.now = options.now ?? (() => new Date())
    this.limits = options.limits ?? DEFAULT_WEB_RETENTION_LIMITS
  }

  async save(input: NewWebDocument): Promise<WebDocument> {
    if (this.admissionsClosed) {
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        'the Nexus runtime is shutting down and admits no new saved web result',
      )
    }
    return this.serialize(input.owner, () => this.publish(input))
  }

  async read(owner: string, resultId: string): Promise<SavedWebText> {
    const document = await this.store.getWeb(owner, resultId)
    if (document === undefined) throw unavailable(resultId)
    if (!this.isLive(document)) throw unavailable(resultId)
    const { basis, text } = basisOf(document)
    return { document, basis, text }
  }

  closeAdmissions(): void {
    this.admissionsClosed = true
  }

  async drain(): Promise<void> {
    // Admissions are closed before the runtime calls this, so joining one
    // snapshot of the chains reaches every publication that was accepted.
    while (this.publishing.size > 0) {
      await Promise.all([...this.publishing.values()])
    }
  }

  /** Whether a record is still inside its retention window. */
  private isLive(document: WebDocument): boolean {
    const expiresAt = Date.parse(document.expiresAt)
    return Number.isFinite(expiresAt) && expiresAt > this.now().getTime()
  }

  /**
   * Serialize publications for one durable owner.
   *
   * The chain is kept per repository instance; every save of one owner waits for
   * the previous one to settle (successfully or not), so two parallel saves can
   * never both see the same free slot.
   */
  private serialize<T>(owner: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.publishing.get(owner) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    this.publishing.set(owner, settled)
    void settled.then(() => {
      if (this.publishing.get(owner) === settled) this.publishing.delete(owner)
    })
    return run
  }

  /** Make room under the owner's caps, then publish exactly one document. */
  private async publish(input: NewWebDocument): Promise<WebDocument> {
    const now = this.now()
    const record = this.fit({
      owner: input.owner,
      resultId: `web-${randomUUID()}`,
      kind: input.kind,
      source: input.source,
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(input.query === undefined ? {} : { query: input.query }),
      content: input.content,
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.convertedText === undefined ? {} : { convertedText: input.convertedText }),
      textBasis: input.textBasis,
      ...(input.conversionSkipped === true ? { conversionSkipped: true } : {}),
      upstreamTruncated: input.upstreamTruncated,
      savedTruncated: false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.limits.retentionMs).toISOString(),
    })

    const existing = await this.store.listWeb(input.owner)
    const kept: WebDocument[] = []
    for (const document of existing) {
      if (this.isLiveAt(document, now.getTime())) kept.push(document)
      else await this.store.deleteWeb(document.owner, document.resultId)
    }

    let total = kept.reduce((sum, document) => sum + savedFootprint(document), 0)
    let victim = 0
    while (kept.length - victim >= this.limits.maxDocuments || total + savedFootprint(record) > this.limits.maxBytes) {
      const evicted = kept[victim]
      if (evicted === undefined) {
        throw new NexusError(
          'RESOURCE_NOT_AVAILABLE',
          'the saved web result cannot be published: the owner size limits cannot accommodate it',
        )
      }
      await this.store.deleteWeb(evicted.owner, evicted.resultId)
      total -= savedFootprint(evicted)
      victim += 1
    }

    await this.store.putWeb(record)
    return record
  }

  /** Whether a record was still inside its retention window at one instant. */
  private isLiveAt(document: WebDocument, time: number): boolean {
    const expiresAt = Date.parse(document.expiresAt)
    return Number.isFinite(expiresAt) && expiresAt > time
  }

  /**
   * Cut one over-cap document down to the caps at safe boundaries.
   *
   * Only the saved basis is prioritized: the conversion (or the summary) keeps
   * the budget first and the duplicate raw field takes what is left, so the text
   * `read`/`find` address always stays a contiguous prefix of what was obtained.
   * A cut record is marked `savedTruncated`.
   */
  private fit(record: WebDocument): WebDocument {
    const cap = Math.min(this.limits.maxDocumentBytes, this.limits.maxBytes)
    if (savedFootprint(record) <= cap) return record
    const empty: WebDocument = { ...record, content: '', summary: undefined, convertedText: undefined, savedTruncated: true }
    const overhead = savedFootprint(empty)
    let allowed = cap - overhead
    if (allowed <= 0) {
      throw new NexusError(
        'UNSUPPORTED_CAPABILITY',
        `the web document limit (${cap} bytes) is too small to store any document`,
      )
    }
    let candidate = this.cut(record, allowed)
    for (let attempt = 0; attempt < 4 && savedFootprint(candidate) > cap; attempt += 1) {
      allowed -= savedFootprint(candidate) - cap
      if (allowed <= 0) break
      candidate = this.cut(record, allowed)
    }
    if (savedFootprint(candidate) > cap) {
      throw new NexusError('UNSUPPORTED_CAPABILITY', 'the obtained web text cannot be stored under the web document limit')
    }
    return candidate
  }

  /** Build one saved-truncated record whose stored text fits `allowed` bytes. */
  private cut(record: WebDocument, allowed: number): WebDocument {
    const truncated: WebDocument = { ...record, savedTruncated: true }
    switch (record.textBasis) {
      case 'summary':
        return { ...truncated, summary: truncateToUtf8Bytes(record.summary ?? '', allowed) }
      case 'converted-text': {
        const converted = truncateToUtf8Bytes(record.convertedText ?? '', allowed)
        const remaining = allowed - utf8Bytes(converted)
        return {
          ...truncated,
          convertedText: converted,
          content: remaining > 0 ? truncateToUtf8Bytes(record.content, remaining) : '',
        }
      }
      default:
        return { ...truncated, content: truncateToUtf8Bytes(record.content, allowed) }
    }
  }
}

/**
 * Create the durable web-result repository over one store.
 * @param store - the opened Nexus store.
 * @param options - clock and retention limits.
 * @returns the repository.
 */
export function createWebResultRepository(
  store: NexusStore,
  options: WebResultRepositoryOptions = {},
): WebResultRepository {
  return new WebResultRepositoryHandle(store, options)
}
