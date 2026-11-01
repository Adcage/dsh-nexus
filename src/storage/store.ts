/**
 * The Nexus store: the only writer of Nexus records.
 *
 * @module dsh-nexus/storage/store
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { ZodError, type ZodType } from 'zod'
import type { ChildPolicy, PromptLibrary, PromptSnapshot, RuntimeSettings, WebDocument } from '../protocol.ts'
import { DEFAULT_LIBRARY, DEFAULT_SETTINGS } from '../runtime/defaults.ts'
import { NexusError } from '../runtime/errors.ts'
import {
  CHILD_POLICY_TABLE,
  LIBRARY_TABLE,
  NEXUS_DOMAIN,
  PROMPTS_TABLE,
  SETTINGS_TABLE,
  SINGLETON_KEY,
  WEB_TABLE,
  childPolicySchema,
  promptLibrarySchema,
  promptSnapshotSchema,
  runtimeSettingsSchema,
  webDocumentSchema,
  webRecordKey,
} from './domain.ts'

/** A record plus the hash a later writer must present to replace it. */
export interface Stored<T> {
  /** The record as the medium holds it. */
  readonly value: T
  /** Hash of `value`, used only to detect a lost update between two windows. */
  readonly hash: string
}

/**
 * The durable Nexus state one plugin instance owns.
 *
 * Reads answer from the domain's authoritative in-memory records, which are
 * shared with every consumer of this store: treat them as immutable and save a
 * replacement instead of editing one. `library` and `settings` are single records
 * whose save is conditional on the hash the caller last read; the other tables are
 * written unconditionally because each record already has one owner.
 */
export interface NexusStore {
  /**
   * Read the prompt library.
   * @returns the stored library and its hash.
   */
  readLibrary(): Promise<Stored<PromptLibrary>>
  /**
   * Replace the prompt library if nobody else saved since `expectedHash`.
   * @param value - the complete new library.
   * @param expectedHash - hash the caller last read.
   * @returns the stored library and its new hash.
   */
  saveLibrary(value: PromptLibrary, expectedHash: string): Promise<Stored<PromptLibrary>>
  /**
   * Read the runtime settings.
   * @returns the stored settings and their hash.
   */
  readSettings(): Promise<Stored<RuntimeSettings>>
  /**
   * Replace the runtime settings if nobody else saved since `expectedHash`.
   * @param value - the complete new settings record.
   * @param expectedHash - hash the caller last read.
   * @returns the stored settings and their new hash.
   */
  saveSettings(value: RuntimeSettings, expectedHash: string): Promise<Stored<RuntimeSettings>>
  /**
   * Read one session's assembled prompt.
   * @param sessionId - durable session identity.
   * @returns the snapshot, or `undefined` when the session has none.
   */
  getPrompt(sessionId: string): Promise<PromptSnapshot | undefined>
  /**
   * Store one session's assembled prompt.
   * @param value - the snapshot to keep.
   */
  putPrompt(value: PromptSnapshot): Promise<void>
  /**
   * Read one saved web document.
   * @param owner - session that owns the result.
   * @param resultId - result id within that owner.
   * @returns the document, or `undefined` when it was never saved or was evicted.
   */
  getWeb(owner: string, resultId: string): Promise<WebDocument | undefined>
  /**
   * Store one web document.
   * @param value - the document to keep.
   */
  putWeb(value: WebDocument): Promise<void>
  /**
   * Read one child's durable policy.
   * @param childId - child session id.
   * @returns the policy, or `undefined` when the child never had one.
   */
  getChildPolicy(childId: string): Promise<ChildPolicy | undefined>
  /**
   * Store one child's durable policy.
   * @param value - the policy to keep.
   */
  putChildPolicy(value: ChildPolicy): Promise<void>
  /**
   * Forget one child's policy.
   * @param childId - child session id; deleting an absent policy is not an error.
   */
  deleteChildPolicy(childId: string): Promise<void>
  /** Close the store; idempotent. */
  dispose(): Promise<void>
}

/**
 * Serialize a record canonically so equal data always hashes equally: object
 * keys are sorted and undefined-valued members are skipped, which is exactly what
 * a JSON round trip keeps.
 * @param value - JSON data.
 * @returns its canonical JSON text.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new TypeError('a stored record must be lossless JSON data')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const members = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`)
  return `{${members.join(',')}}`
}

/**
 * Hash one record for lost-update detection.
 * @param value - the record.
 * @returns a hex SHA-256 of its canonical JSON.
 */
function hashRecord(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/**
 * Validate one record against the schema the medium is read with, and keep the
 * parsed copy: it holds declared fields only, so no caller-owned handle can ride
 * along and a later caller mutation cannot reach the stored record.
 * @param schema - schema of the table the record belongs to.
 * @param value - the record a caller offered.
 * @param what - record name for the failure message.
 * @returns the detached, validated record.
 * @throws NexusError `INVALID_ARGUMENT` when the record does not match.
 */
function parseRecord<T>(schema: ZodType<T>, value: unknown, what: string): T {
  try {
    return schema.parse(value)
  } catch (error) {
    const issue = error instanceof ZodError ? error.issues[0] : undefined
    const location = issue === undefined || issue.path.length === 0 ? '' : ` at '${issue.path.join('.')}'`
    const reason = issue?.message ?? (error instanceof Error ? error.message : String(error))
    throw new NexusError('INVALID_ARGUMENT', `${what} is not a valid record${location}: ${reason}`, { cause: error })
  }
}

/** One open store over an opened domain; constructed by {@link openNexusStore}. */
class NexusStoreHandle implements NexusStore {
  private readonly domain: Domain<typeof NEXUS_DOMAIN>
  private readonly library: KvTable<string, PromptLibrary>
  private readonly settings: KvTable<string, RuntimeSettings>
  private readonly prompts: KvTable<string, PromptSnapshot>
  private readonly web: KvTable<string, WebDocument>
  private readonly childPolicies: KvTable<string, ChildPolicy>

  /**
   * @param domain - the opened Nexus domain this store owns.
   */
  constructor(domain: Domain<typeof NEXUS_DOMAIN>) {
    this.domain = domain
    this.library = domain.table(LIBRARY_TABLE)
    this.settings = domain.table(SETTINGS_TABLE)
    this.prompts = domain.table(PROMPTS_TABLE)
    this.web = domain.table(WEB_TABLE)
    this.childPolicies = domain.table(CHILD_POLICY_TABLE)
  }

  /** Materialize the two singleton records so a save always has a record to replace. */
  async seed(): Promise<void> {
    if (this.library.get(SINGLETON_KEY) === undefined) await this.library.put(SINGLETON_KEY, DEFAULT_LIBRARY)
    if (this.settings.get(SINGLETON_KEY) === undefined) await this.settings.put(SINGLETON_KEY, DEFAULT_SETTINGS)
  }

  async readLibrary(): Promise<Stored<PromptLibrary>> {
    const value = this.library.get(SINGLETON_KEY)
    if (value === undefined) throw new Error('the prompt library record is missing from the Nexus domain')
    return { value, hash: hashRecord(value) }
  }

  async saveLibrary(value: PromptLibrary, expectedHash: string): Promise<Stored<PromptLibrary>> {
    const next = parseRecord(promptLibrarySchema, value, 'the prompt library')
    const stored = await this.library.update(SINGLETON_KEY, (current) => {
      if (hashRecord(current) !== expectedHash) {
        throw new NexusError(
          'CONFIG_CONFLICT',
          'the prompt library changed since it was read; read it again before saving',
        )
      }
      return next
    })
    return { value: stored, hash: hashRecord(stored) }
  }

  async readSettings(): Promise<Stored<RuntimeSettings>> {
    const value = this.settings.get(SINGLETON_KEY)
    if (value === undefined) throw new Error('the settings record is missing from the Nexus domain')
    return { value, hash: hashRecord(value) }
  }

  async saveSettings(value: RuntimeSettings, expectedHash: string): Promise<Stored<RuntimeSettings>> {
    const next = parseRecord(runtimeSettingsSchema, value, 'the runtime settings')
    const stored = await this.settings.update(SINGLETON_KEY, (current) => {
      if (hashRecord(current) !== expectedHash) {
        throw new NexusError('CONFIG_CONFLICT', 'the runtime settings changed since they were read; read them again before saving')
      }
      return next
    })
    return { value: stored, hash: hashRecord(stored) }
  }

  async getPrompt(sessionId: string): Promise<PromptSnapshot | undefined> {
    return this.prompts.get(sessionId)
  }

  async putPrompt(value: PromptSnapshot): Promise<void> {
    const record = parseRecord(promptSnapshotSchema, value, 'the prompt snapshot')
    await this.prompts.put(record.sessionId, record)
  }

  async getWeb(owner: string, resultId: string): Promise<WebDocument | undefined> {
    return this.web.get(webRecordKey(owner, resultId))
  }

  async putWeb(value: WebDocument): Promise<void> {
    const record = parseRecord(webDocumentSchema, value, 'the web document')
    await this.web.put(webRecordKey(record.owner, record.resultId), record)
  }

  async getChildPolicy(childId: string): Promise<ChildPolicy | undefined> {
    return this.childPolicies.get(childId)
  }

  async putChildPolicy(value: ChildPolicy): Promise<void> {
    const record = parseRecord(childPolicySchema, value, 'the child policy')
    await this.childPolicies.put(record.childId, record)
  }

  async deleteChildPolicy(childId: string): Promise<void> {
    await this.childPolicies.delete(childId)
  }

  async dispose(): Promise<void> {
    await this.domain.close()
  }
}

/**
 * Open the Nexus store on a context that carries the storage domain form.
 *
 * The caller owns the returned store's lifetime; the domain is also closed when
 * the calling plugin unloads, so a crashed path cannot leave the unit open. The
 * two singleton records are materialized here, before the store is handed out, so
 * every later save is a conditional replace instead of a first-write race.
 * @param ctx - context with `storageDomain` active.
 * @returns the opened store.
 */
export async function openNexusStore(ctx: Context): Promise<NexusStore> {
  const domain = await ctx.storageDomain.open(NEXUS_DOMAIN)
  const store = new NexusStoreHandle(domain)
  try {
    await store.seed()
  } catch (error) {
    await domain.close()
    throw error
  }
  ctx.effect(() => () => store.dispose(), 'nexusStore')
  return store
}
