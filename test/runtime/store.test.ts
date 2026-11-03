/**
 * The store seam: durable records, conditional saves and their failure modes.
 *
 * Everything here runs against the real DSH storage stack — the storage hub, the
 * shipped JSON backend and the domain data form — on a project-local temporary
 * root. The only instrumented piece is the medium boundary: a delegating
 * `StorageBackend` can make the next record write fail, so the tests can prove
 * what a refused durable write leaves behind instead of trusting a mock that
 * "fails" by itself. A hand-written fake `NexusStore` could never show that the
 * domain keeps memory and medium in step.
 *
 * @module dsh-nexus/test/runtime/store
 */

import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import {
  Storage,
  storageBackendServiceKey,
  type KvFacet,
  type KvUnit,
  type KvUnitDescriptor,
  type StorageBackend,
} from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { DEFAULT_LIBRARY, DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import { NEXUS_DOMAIN } from '../../src/storage/domain.ts'
import { openNexusStore, type NexusStore } from '../../src/storage/store.ts'
import type { ChildPolicy, PromptModule, PromptSnapshot, RuntimeSettings, WebDocument } from '../../src/protocol.ts'
import { createToolHarness } from '../support/harness.ts'

/** A refusal raised at the medium boundary; the store must not rewrite it. */
class StorageWriteFailure extends Error {
  /** Stable marker so the test can assert the same instance came back. */
  readonly code = 'STORAGE_WRITE_FAILED'

  /**
   * @param message - which record the medium refused.
   */
  constructor(message: string) {
    super(message)
    this.name = 'StorageWriteFailure'
  }
}

/** The JSON backend plus one controllable seam and a write log. */
interface ControlledMedium {
  /** The backend registered on the hub in place of the shipped plugin. */
  readonly backend: StorageBackend
  /** Every durable record write that reached the medium, as `table/key`. */
  readonly writes: string[]
  /**
   * Refuse the next record write into `table`, before it reaches the medium.
   * @param table - table whose next write fails.
   */
  failNextPut(table: string): void
}

/**
 * Wrap the real JSON backend with a controllable write refusal.
 * @param root - directory the backend owns; one `<unit>.json` document per unit.
 * @returns the controllable medium.
 */
function createControlledMedium(root: string): ControlledMedium {
  const inner = new JsonStorageBackend(root)
  const innerKv: KvFacet = inner.kv
  const writes: string[] = []
  let failingTable: string | undefined

  const kv: KvFacet = {
    async open(descriptor: KvUnitDescriptor): Promise<KvUnit> {
      const unit = await innerKv.open(descriptor)
      return {
        loadAll: () => unit.loadAll(),
        async putRecord(table, key, value) {
          if (failingTable === table) {
            failingTable = undefined
            throw new StorageWriteFailure(`medium refused the write of '${table}/${key}'`)
          }
          await unit.putRecord(table, key, value)
          writes.push(`${table}/${key}`)
        },
        deleteRecord: (table, key) => unit.deleteRecord(table, key),
        setGlobal: (value) => unit.setGlobal(value),
        close: () => unit.close(),
      }
    },
  }

  return {
    backend: { kv, close: () => inner.close() },
    writes,
    failNextPut(table) {
      failingTable = table
    },
  }
}

/** Project-local cache directory; the medium never touches state outside the checkout. */
const CACHE_DIR = fileURLToPath(new URL('../../node_modules/.cache/dsh-nexus-test/', import.meta.url))

/** One mounted storage stack over a fresh temporary medium root. */
interface StoreHarness {
  readonly ctx: Context
  readonly medium: ControlledMedium
  /**
   * Open the Nexus store; call again after disposing the previous one.
   * @returns the opened store.
   */
  open(): Promise<NexusStore>
  /**
   * Read the raw unit document the medium holds.
   * @returns the document text.
   */
  readMedium(): Promise<string>
  /** Dispose the context and delete the temporary root. */
  dispose(): Promise<void>
}

/**
 * Mount the real hub, the real JSON backend and the real domain form.
 * @returns the harness over a fresh temporary root.
 */
async function createStoreHarness(): Promise<StoreHarness> {
  await mkdir(CACHE_DIR, { recursive: true })
  const root = await mkdtemp(join(CACHE_DIR, 'store-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  const medium = createControlledMedium(root)
  await ctx.plugin({
    name: 'nexus-controlled-json',
    inject: ['storage'],
    apply(pluginCtx: Context) {
      pluginCtx.effect(() => {
        const unregister = pluginCtx.storage.backend.register('json', medium.backend)
        return async () => {
          unregister()
          await medium.backend.close()
        }
      })
      pluginCtx.provide(storageBackendServiceKey('json'), medium.backend)
    },
  })
  await ctx.plugin(StorageDomain, { backend: 'json' })

  return {
    ctx,
    medium,
    open: () => openNexusStore(ctx),
    readMedium: () => readFile(join(root, `${NEXUS_DOMAIN.name}.json`), 'utf8'),
    async dispose() {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** A prompt module every snapshot test starts from. */
const BASE_MODULE: PromptModule = { id: 'base', name: 'Base', body: 'You are Nexus.' }

/** A prompt library with one selected module. */
const LIBRARY: { modules: PromptModule[]; defaultSelection: string[] } = {
  modules: [BASE_MODULE],
  defaultSelection: ['base'],
}

/** A saved web result owned by `sess-1`. */
const WEB_DOCUMENT: WebDocument = {
  owner: 'sess-1',
  resultId: 'web-1',
  kind: 'fetch',
  source: 'http',
  url: 'https://example.test/docs',
  content: 'upstream body',
  convertedText: 'readable body',
  textBasis: 'converted-text',
  upstreamTruncated: false,
  savedTruncated: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2026-11-08T00:00:00.000Z',
}

/** A child policy record. */
const CHILD_POLICY: ChildPolicy = {
  childId: 'child-1',
  parentSessionId: 'sess-1',
  cwd: '/workspace/demo',
  access: 'write',
  maxDepth: 2,
}

describe('openNexusStore', () => {
  it('serves the documented defaults from a fresh medium and keeps the hash stable', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()

      expect(await store.readLibrary()).toEqual({
        value: DEFAULT_LIBRARY,
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
      expect((await store.readSettings()).value).toEqual(DEFAULT_SETTINGS)
      expect(harness.medium.writes).toEqual(['library/current', 'settings/current'])

      const libraryBefore = await store.readLibrary()
      const settingsBefore = await store.readSettings()
      await store.dispose()
      const reopened = await harness.open()

      expect(harness.medium.writes).toEqual(['library/current', 'settings/current'])
      expect(await reopened.readLibrary()).toEqual(libraryBefore)
      expect(await reopened.readSettings()).toEqual(settingsBefore)
    } finally {
      await harness.dispose()
    }
  })

  it('rejects a stale save without changing visible or persisted state', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()
      const previous = await store.readLibrary()

      await expect(store.saveLibrary(LIBRARY, 'stale')).rejects.toMatchObject({
        name: 'NexusError',
        code: 'CONFIG_CONFLICT',
      })

      expect(await store.readLibrary()).toEqual(previous)
      expect(harness.medium.writes).toEqual(['library/current', 'settings/current'])

      await store.dispose()
      expect(await (await harness.open()).readLibrary()).toEqual(previous)
    } finally {
      await harness.dispose()
    }
  })

  it('lets exactly one of two same-hash writers commit', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()
      const { hash } = await store.readLibrary()
      const first: typeof LIBRARY = { modules: [{ id: 'a', name: 'A', body: 'first' }], defaultSelection: ['a'] }
      const second: typeof LIBRARY = { modules: [{ id: 'b', name: 'B', body: 'second' }], defaultSelection: ['b'] }

      const settled = await Promise.allSettled([
        store.saveLibrary(first, hash),
        store.saveLibrary(second, hash),
      ])

      const rejected = settled.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toMatchObject({ name: 'NexusError', code: 'CONFIG_CONFLICT' })
      expect((await store.readLibrary()).value).toEqual(first)
      expect(harness.medium.writes.filter((write) => write === 'library/current')).toHaveLength(2)

      await store.dispose()
      expect((await (await harness.open()).readLibrary()).value).toEqual(first)
    } finally {
      await harness.dispose()
    }
  })

  it('keeps the previous record when the durable write fails', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()
      const previous = await store.readLibrary()
      harness.medium.failNextPut('library')

      await expect(store.saveLibrary(LIBRARY, previous.hash)).rejects.toBeInstanceOf(StorageWriteFailure)

      expect(await store.readLibrary()).toEqual(previous)
      expect(harness.medium.writes).toEqual(['library/current', 'settings/current'])

      await store.dispose()
      expect(await (await harness.open()).readLibrary()).toEqual(previous)
    } finally {
      await harness.dispose()
    }
  })

  it('restores full records and hashes after the domain is closed and reopened', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()
      const settings: RuntimeSettings = {
        ...DEFAULT_SETTINGS,
        files: { defaultLines: 500, maxOutputBytes: 4_096 },
        terminal: { engine: 'pwsh', pwshPath: 'C:/Program Files/PowerShell/7/pwsh.exe' },
        agents: { concurrency: 6, maxDepth: 3, childAccess: 'workspace-write', role: { name: 'Scout', instructions: 'Read first.', model: 'deepseek' } },
        web: { maxResults: 8, maxCharsPerPage: 20_000 },
      }
      const snapshot: PromptSnapshot = {
        sessionId: 'sess-1',
        selection: ['base'],
        modules: [BASE_MODULE],
        text: 'You are Nexus.',
      }
      await store.saveLibrary(LIBRARY, (await store.readLibrary()).hash)
      await store.saveSettings(settings, (await store.readSettings()).hash)
      await store.putPrompt(snapshot)
      await store.putWeb(WEB_DOCUMENT)
      await store.putChildPolicy(CHILD_POLICY)

      const before = {
        library: await store.readLibrary(),
        settings: await store.readSettings(),
        prompt: await store.getPrompt('sess-1'),
        web: await store.getWeb('sess-1', 'web-1'),
        policy: await store.getChildPolicy('child-1'),
      }
      await store.dispose()

      const reopened = await harness.open()
      expect(await reopened.readLibrary()).toEqual(before.library)
      expect(await reopened.readSettings()).toEqual(before.settings)
      expect(await reopened.getPrompt('sess-1')).toEqual(before.prompt)
      expect(await reopened.getWeb('sess-1', 'web-1')).toEqual(before.web)
      expect(await reopened.getChildPolicy('child-1')).toEqual(before.policy)
      expect(before.settings.value).toEqual(settings)
      expect(before.web).toEqual(WEB_DOCUMENT)
    } finally {
      await harness.dispose()
    }
  })

  it('stores the prompt bodies themselves rather than a reference the caller can mutate', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()
      const modules: PromptModule[] = [BASE_MODULE]
      const snapshot: PromptSnapshot = { sessionId: 'sess-a', selection: ['base'], modules, text: 'You are Nexus.' }

      await store.putPrompt(snapshot)
      modules[0] = { id: 'base', name: 'Base', body: 'mutated after the save' }
      modules.push({ id: 'extra', name: 'Extra', body: 'added after the save' })

      const expected: PromptSnapshot = {
        sessionId: 'sess-a',
        selection: ['base'],
        modules: [{ id: 'base', name: 'Base', body: 'You are Nexus.' }],
        text: 'You are Nexus.',
      }
      expect(await store.getPrompt('sess-a')).toEqual(expected)
      expect(await harness.readMedium()).toContain('You are Nexus.')

      await store.dispose()
      expect(await (await harness.open()).getPrompt('sess-a')).toEqual(expected)
    } finally {
      await harness.dispose()
    }
  })

  it('rejects settings outside the documented bounds and keeps the accepted record', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()
      const accepted = await store.readSettings()
      const base = accepted.value

      const invalid: RuntimeSettings[] = [
        { ...base, files: { ...base.files, defaultLines: 0 } },
        { ...base, files: { ...base.files, defaultLines: 2_001 } },
        { ...base, files: { ...base.files, maxOutputBytes: 0 } },
        { ...base, files: { ...base.files, maxOutputBytes: 32_769 } },
        { ...base, terminal: { engine: 'cmd' as unknown as 'bash' } },
        { ...base, terminal: { engine: 'bash', bashPath: '' } },
        { ...base, agents: { ...base.agents, concurrency: 0 } },
        { ...base, agents: { ...base.agents, concurrency: 17 } },
        { ...base, agents: { ...base.agents, maxDepth: -1 } },
        { ...base, agents: { ...base.agents, maxDepth: 9 } },
        { ...base, web: { ...base.web, maxResults: 0 } },
        { ...base, web: { ...base.web, maxResults: 11 } },
        { ...base, web: { ...base.web, maxCharsPerPage: 24_001 } },
      ]

      for (const value of invalid) {
        await expect(store.saveSettings(value, accepted.hash)).rejects.toMatchObject({
          name: 'NexusError',
          code: 'INVALID_ARGUMENT',
        })
      }
      expect(await store.readSettings()).toEqual(accepted)

      const smallest: RuntimeSettings = {
        files: { defaultLines: 1, maxOutputBytes: 1 },
        terminal: { engine: 'bash' },
        agents: { concurrency: 1, maxDepth: 0, childAccess: 'read-only' },
        web: { maxResults: 1, maxCharsPerPage: 1 },
        toolDisplay: 'native',
      }
      const smallestSaved = await store.saveSettings(smallest, accepted.hash)
      const largest: RuntimeSettings = {
        files: { defaultLines: 2_000, maxOutputBytes: 32_768 },
        terminal: { engine: 'pwsh' },
        agents: { concurrency: 16, maxDepth: 8, childAccess: 'inherit' },
        web: { maxResults: 10, maxCharsPerPage: 24_000 },
        toolDisplay: 'auto',
      }
      const largestSaved = await store.saveSettings(largest, smallestSaved.hash)
      expect((await store.readSettings()).value).toEqual(largest)
      expect(largestSaved.hash).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      await harness.dispose()
    }
  })

  it('round-trips web documents and child policies and deletes a child policy', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()

      expect(await store.getPrompt('missing')).toBeUndefined()
      expect(await store.getWeb('sess-1', 'missing')).toBeUndefined()
      expect(await store.getChildPolicy('missing')).toBeUndefined()

      await store.putWeb(WEB_DOCUMENT)
      await store.putWeb({ ...WEB_DOCUMENT, owner: 'sess-2', content: 'second owner body' })

      expect(await store.getWeb('sess-1', 'web-1')).toEqual(WEB_DOCUMENT)
      expect((await store.getWeb('sess-2', 'web-1'))?.content).toBe('second owner body')

      await store.putChildPolicy(CHILD_POLICY)
      expect(await store.getChildPolicy('child-1')).toEqual(CHILD_POLICY)
      await store.deleteChildPolicy('child-1')
      expect(await store.getChildPolicy('child-1')).toBeUndefined()
      await store.deleteChildPolicy('child-1')
    } finally {
      await harness.dispose()
    }
  })

  it('lists one owner\'s web documents oldest first and deletes exactly one', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()
      const later: WebDocument = {
        ...WEB_DOCUMENT,
        resultId: 'web-2',
        createdAt: '2026-11-02T00:00:00.000Z',
        expiresAt: '2026-11-09T00:00:00.000Z',
      }
      await store.putWeb(later)
      await store.putWeb(WEB_DOCUMENT)
      await store.putWeb({ ...WEB_DOCUMENT, owner: 'sess-2', resultId: 'web-1' })

      expect((await store.listWeb('sess-1')).map((document) => document.resultId)).toEqual(['web-1', 'web-2'])
      expect((await store.listWeb('sess-2')).map((document) => document.resultId)).toEqual(['web-1'])
      expect(await store.listWeb('sess-missing')).toEqual([])

      expect(await store.deleteWeb('sess-1', 'web-1')).toBe(true)
      expect(await store.deleteWeb('sess-1', 'web-1')).toBe(false)
      expect(await store.getWeb('sess-1', 'web-1')).toBeUndefined()
      expect(await store.getWeb('sess-2', 'web-1')).toBeDefined()
    } finally {
      await harness.dispose()
    }
  })

  it('persists record data only, never the live Agent or Context a caller holds', async () => {
    const tools = await createToolHarness()
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()
      const record: PromptSnapshot = {
        sessionId: 'sess-handles',
        selection: ['base'],
        modules: [BASE_MODULE],
        text: 'You are Nexus.',
      }
      const contaminated = {
        ...record,
        agent: tools.owner.agent,
        context: tools.ctx,
      } as unknown as PromptSnapshot

      await store.putPrompt(contaminated)

      expect(await store.getPrompt('sess-handles')).toEqual(record)
      const raw = await harness.readMedium()
      expect(raw).not.toContain('"agent"')
      expect(raw).not.toContain('"context"')

      const wrongType = { ...record, text: { handle: true } } as unknown as PromptSnapshot
      await expect(store.putPrompt(wrongType)).rejects.toMatchObject({
        name: 'NexusError',
        code: 'INVALID_ARGUMENT',
      })
      expect(await store.getPrompt('sess-handles')).toEqual(record)

      await store.dispose()
      expect(await (await harness.open()).getPrompt('sess-handles')).toEqual(record)
    } finally {
      await harness.dispose()
      await tools.dispose()
    }
  })

  it('stops serving reads after dispose and frees the name for a later open', async () => {
    const harness = await createStoreHarness()
    try {
      const store = await harness.open()
      await store.dispose()

      await expect(store.readLibrary()).rejects.toMatchObject({ code: 'closed' })
      await store.dispose()

      const reopened = await harness.open()
      expect((await reopened.readLibrary()).value).toEqual(DEFAULT_LIBRARY)
    } finally {
      await harness.dispose()
    }
  })
})
