/**
 * The durable record shapes and the domain declaration they belong to.
 *
 * Record schemas are zod, matching the domain data form: the domain validates
 * every stored record against them when it loads the medium, so a hand-edited or
 * corrupt record fails the open instead of reaching a tool. `src/protocol.ts`
 * owns the TypeScript view of the same shapes; these schemas are its runtime
 * twin.
 *
 * @module dsh-nexus/storage/domain
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type {
  ChildPolicy,
  PromptLibrary,
  PromptSnapshot,
  RuntimeSettings,
  WebDocument,
  WriteScopeRecord,
} from '../protocol.ts'
import {
  AGENT_MAX_CONCURRENCY,
  AGENT_MAX_DEPTH,
  AGENT_MIN_CONCURRENCY,
  AGENT_MIN_DEPTH,
  FILE_OUTPUT_MAX_BYTES,
  FILE_OUTPUT_MIN_BYTES,
  FILE_READ_MAX_LINES,
  FILE_READ_MIN_LINES,
  WEB_MAX_CHARS_PER_PAGE,
  WEB_MAX_RESULTS,
} from '../runtime/defaults.ts'

/** Domain name on the storage hub; also the medium's unit name. */
export const NEXUS_DOMAIN_NAME = 'dsh_nexus'

/** Table holding the single prompt-library record. */
export const LIBRARY_TABLE = 'library'
/** Table holding the single settings record. */
export const SETTINGS_TABLE = 'settings'
/** Table holding one prompt snapshot per session. */
export const PROMPTS_TABLE = 'prompts'
/** Table holding saved web documents, keyed by owner and result id. */
export const WEB_TABLE = 'web_documents'
/** Table holding the durable policy of each internal child. */
export const CHILD_POLICY_TABLE = 'child_policies'
/** Table holding one write-scope reservation per child whose cleanup is unresolved. */
export const WRITE_SCOPE_TABLE = 'write_scopes'

/**
 * Key of a table that holds exactly one record. Keys stay opaque because the
 * domain uses the `single` layout, which keeps the whole unit in one document.
 */
export const SINGLETON_KEY = 'current'

/** One prompt module as stored. */
export const promptModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  body: z.string(),
})

/** The prompt library as stored; array order is assembly order. */
export const promptLibrarySchema: z.ZodType<PromptLibrary> = z.object({
  modules: z.array(promptModuleSchema),
  defaultSelection: z.array(z.string()),
})

/** One session's assembled prompt as stored: the bodies themselves, not references. */
export const promptSnapshotSchema: z.ZodType<PromptSnapshot> = z.object({
  sessionId: z.string(),
  selection: z.array(z.string()),
  modules: z.array(promptModuleSchema),
  text: z.string(),
})

/**
 * The settings record as stored.
 *
 * Every editable number carries the bound from `runtime/defaults.ts`, so a
 * settings record the store accepts is one the tools can act on: a value outside
 * its range is refused at the write boundary and also fails loudly if a
 * hand-edited medium carries it at open.
 */
export const runtimeSettingsSchema: z.ZodType<RuntimeSettings> = z.object({
  files: z.object({
    defaultLines: z.number().int().min(FILE_READ_MIN_LINES).max(FILE_READ_MAX_LINES),
    maxOutputBytes: z.number().int().min(FILE_OUTPUT_MIN_BYTES).max(FILE_OUTPUT_MAX_BYTES),
  }),
  terminal: z.object({
    engine: z.enum(['bash', 'pwsh']),
    bashPath: z.string().min(1).optional(),
    pwshPath: z.string().min(1).optional(),
  }),
  agents: z.object({
    concurrency: z.number().int().min(AGENT_MIN_CONCURRENCY).max(AGENT_MAX_CONCURRENCY),
    maxDepth: z.number().int().min(AGENT_MIN_DEPTH).max(AGENT_MAX_DEPTH),
    role: z
      .object({
        name: z.string().optional(),
        instructions: z.string().optional(),
        model: z.string().optional(),
      })
      .optional(),
  }),
  web: z.object({
    maxResults: z.number().int().positive().max(WEB_MAX_RESULTS),
    maxCharsPerPage: z.number().int().positive().max(WEB_MAX_CHARS_PER_PAGE),
  }),
})

/** A saved web result as stored. */
export const webDocumentSchema: z.ZodType<WebDocument> = z.object({
  owner: z.string(),
  resultId: z.string(),
  kind: z.enum(['search', 'fetch']),
  source: z.string(),
  url: z.string().optional(),
  query: z.string().optional(),
  content: z.string(),
  summary: z.string().optional(),
  convertedText: z.string().optional(),
  textBasis: z.enum(['content', 'converted-text', 'summary', 'search-results']),
  conversionSkipped: z.boolean().optional(),
  upstreamTruncated: z.boolean(),
  savedTruncated: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
})

/** One write-scope reservation as stored. */
export const writeScopeSchema: z.ZodType<WriteScopeRecord> = z.object({
  childId: z.string(),
  root: z.string(),
})

/** One internal child's durable policy as stored. */
export const childPolicySchema: z.ZodType<ChildPolicy> = z.object({
  childId: z.string(),
  parentSessionId: z.string(),
  cwd: z.string(),
  access: z.enum(['read', 'write']),
  maxDepth: z.number(),
})

/**
 * Key of one saved web document.
 *
 * `owner` and `resultId` are arbitrary strings (a session id is not an
 * identifier-safe token), so the key is a JSON pair rather than a joined string:
 * no separator can collide with either part. Opaque keys are why this domain uses
 * the `single` layout.
 * @param owner - session that owns the result.
 * @param resultId - result id within that owner.
 * @returns the record key.
 */
export function webRecordKey(owner: string, resultId: string): string {
  return JSON.stringify([owner, resultId])
}

/**
 * The Nexus domain: two singleton records plus three per-owner tables.
 *
 * The layout is stated rather than inherited so the key shapes above stay legal:
 * `single` keeps every table record in one unit document and leaves keys opaque.
 */
export const NEXUS_DOMAIN = defineDomain({
  name: NEXUS_DOMAIN_NAME,
  version: 1,
  layout: 'single',
  tables: {
    [LIBRARY_TABLE]: domainTable(promptLibrarySchema),
    [SETTINGS_TABLE]: domainTable(runtimeSettingsSchema),
    [PROMPTS_TABLE]: domainTable(promptSnapshotSchema),
    [WEB_TABLE]: domainTable(webDocumentSchema),
    [CHILD_POLICY_TABLE]: domainTable(childPolicySchema),
    [WRITE_SCOPE_TABLE]: domainTable(writeScopeSchema),
  },
})
