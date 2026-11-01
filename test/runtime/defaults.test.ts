/**
 * The documented defaults and limits, pinned.
 *
 * These numbers decide what a user sees before changing anything and what every
 * tool refuses to exceed, so a silent edit to one of them changes behaviour
 * across tasks. The spec also proves the stored defaults and the durable zod
 * schemas cannot drift: the same default record must pass the schema the store
 * validates against when it reopens.
 *
 * @module dsh-nexus/test/runtime/defaults
 */

import { describe, expect, it } from 'vitest'
import {
  AGENT_BATCH_MAX_TASKS,
  AGENT_DEFAULT_CONCURRENCY,
  AGENT_DEFAULT_DEPTH,
  AGENT_MAX_CONCURRENCY,
  AGENT_MAX_DEPTH,
  AGENT_MAX_PROCESSES,
  AGENT_MAX_TERMINALS,
  AGENT_MIN_CONCURRENCY,
  AGENT_MIN_DEPTH,
  AGENT_READ_DEFAULT_EVENTS,
  AGENT_READ_MAX_EVENTS,
  COMMAND_CLEANUP_GRACE_MS,
  COMMAND_DEFAULT_TIMEOUT_MS,
  COMMAND_MAX_TIMEOUT_MS,
  COMMAND_MIN_TIMEOUT_MS,
  DEFAULT_LIBRARY,
  DEFAULT_SETTINGS,
  FILE_EDIT_MAX_INPUT_BYTES,
  FILE_OUTPUT_DEFAULT_BYTES,
  FILE_OUTPUT_MAX_BYTES,
  FILE_READ_DEFAULT_LINES,
  FILE_READ_MAX_LINES,
  FILE_READ_MIN_LINES,
  PROCESS_OUTPUT_MEMORY_BYTES,
  PROCESS_OUTPUT_SPILL_BYTES,
  PROCESS_READ_MAX_BYTES,
  PROMPT_LIBRARY_MAX_BYTES,
  PROMPT_MAX_MODULES,
  PROMPT_MODULE_MAX_BYTES,
  WAIT_DEFAULT_MS,
  WAIT_MAX_MS,
  WEB_DEFAULT_CHARS_PER_PAGE,
  WEB_DEFAULT_RESULTS,
  WEB_DOCUMENT_MAX_BYTES,
  WEB_DOCUMENT_RETENTION_MS,
  WEB_MAX_CHARS_PER_PAGE,
  WEB_MAX_QUERIES,
  WEB_MAX_RESULTS,
  WEB_MAX_URLS,
  WEB_SESSION_MAX_BYTES,
  WEB_SESSION_MAX_DOCUMENTS,
} from '../../src/runtime/defaults.ts'
import { Config } from '../../src/config.ts'
import { promptLibrarySchema, runtimeSettingsSchema } from '../../src/storage/domain.ts'

/** One documented limit: the exported value and the number the plan fixes. */
const DOCUMENTED_LIMITS: [name: string, actual: number, expected: number][] = [
  ['FILE_READ_DEFAULT_LINES', FILE_READ_DEFAULT_LINES, 200],
  ['FILE_READ_MIN_LINES', FILE_READ_MIN_LINES, 1],
  ['FILE_READ_MAX_LINES', FILE_READ_MAX_LINES, 2_000],
  ['FILE_OUTPUT_DEFAULT_BYTES', FILE_OUTPUT_DEFAULT_BYTES, 32 * 1024],
  ['FILE_OUTPUT_MAX_BYTES', FILE_OUTPUT_MAX_BYTES, 32 * 1024],
  ['FILE_EDIT_MAX_INPUT_BYTES', FILE_EDIT_MAX_INPUT_BYTES, 16 * 1024 * 1024],
  ['COMMAND_DEFAULT_TIMEOUT_MS', COMMAND_DEFAULT_TIMEOUT_MS, 120_000],
  ['COMMAND_MIN_TIMEOUT_MS', COMMAND_MIN_TIMEOUT_MS, 1],
  ['COMMAND_MAX_TIMEOUT_MS', COMMAND_MAX_TIMEOUT_MS, 600_000],
  ['COMMAND_CLEANUP_GRACE_MS', COMMAND_CLEANUP_GRACE_MS, 3_000],
  ['PROCESS_OUTPUT_MEMORY_BYTES', PROCESS_OUTPUT_MEMORY_BYTES, 32 * 1024],
  ['PROCESS_OUTPUT_SPILL_BYTES', PROCESS_OUTPUT_SPILL_BYTES, 32 * 1024 * 1024],
  ['PROCESS_READ_MAX_BYTES', PROCESS_READ_MAX_BYTES, 16 * 1024],
  ['AGENT_MAX_PROCESSES', AGENT_MAX_PROCESSES, 8],
  ['AGENT_MAX_TERMINALS', AGENT_MAX_TERMINALS, 4],
  ['WAIT_DEFAULT_MS', WAIT_DEFAULT_MS, 1_000],
  ['WAIT_MAX_MS', WAIT_MAX_MS, 30_000],
  ['WEB_MAX_QUERIES', WEB_MAX_QUERIES, 3],
  ['WEB_MAX_URLS', WEB_MAX_URLS, 6],
  ['WEB_DEFAULT_RESULTS', WEB_DEFAULT_RESULTS, 5],
  ['WEB_MAX_RESULTS', WEB_MAX_RESULTS, 10],
  ['WEB_DEFAULT_CHARS_PER_PAGE', WEB_DEFAULT_CHARS_PER_PAGE, 12_000],
  ['WEB_MAX_CHARS_PER_PAGE', WEB_MAX_CHARS_PER_PAGE, 24_000],
  ['WEB_DOCUMENT_MAX_BYTES', WEB_DOCUMENT_MAX_BYTES, 8 * 1024 * 1024],
  ['WEB_SESSION_MAX_DOCUMENTS', WEB_SESSION_MAX_DOCUMENTS, 32],
  ['WEB_SESSION_MAX_BYTES', WEB_SESSION_MAX_BYTES, 32 * 1024 * 1024],
  ['WEB_DOCUMENT_RETENTION_MS', WEB_DOCUMENT_RETENTION_MS, 7 * 24 * 60 * 60 * 1000],
  ['AGENT_DEFAULT_CONCURRENCY', AGENT_DEFAULT_CONCURRENCY, 4],
  ['AGENT_MIN_CONCURRENCY', AGENT_MIN_CONCURRENCY, 1],
  ['AGENT_MAX_CONCURRENCY', AGENT_MAX_CONCURRENCY, 16],
  ['AGENT_DEFAULT_DEPTH', AGENT_DEFAULT_DEPTH, 2],
  ['AGENT_MIN_DEPTH', AGENT_MIN_DEPTH, 0],
  ['AGENT_MAX_DEPTH', AGENT_MAX_DEPTH, 8],
  ['AGENT_BATCH_MAX_TASKS', AGENT_BATCH_MAX_TASKS, 8],
  ['AGENT_READ_DEFAULT_EVENTS', AGENT_READ_DEFAULT_EVENTS, 20],
  ['AGENT_READ_MAX_EVENTS', AGENT_READ_MAX_EVENTS, 100],
  ['PROMPT_MAX_MODULES', PROMPT_MAX_MODULES, 32],
  ['PROMPT_MODULE_MAX_BYTES', PROMPT_MODULE_MAX_BYTES, 32 * 1024],
  ['PROMPT_LIBRARY_MAX_BYTES', PROMPT_LIBRARY_MAX_BYTES, 128 * 1024],
]

describe('runtime defaults', () => {
  it('serves the documented settings before the user changes anything', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      files: { defaultLines: 200, maxOutputBytes: 32_768 },
      terminal: { engine: 'bash' },
      agents: { concurrency: 4, maxDepth: 2 },
      web: { maxResults: 5, maxCharsPerPage: 12_000 },
    })
  })

  it('starts with an empty prompt library and no selection', () => {
    expect(DEFAULT_LIBRARY).toEqual({ modules: [], defaultSelection: [] })
  })

  it.each(DOCUMENTED_LIMITS)('keeps %s at its documented value', (_name, actual, expected) => {
    expect(actual).toBe(expected)
  })

  it('keeps every editable default inside its own bounds', () => {
    expect(FILE_READ_DEFAULT_LINES).toBeGreaterThanOrEqual(FILE_READ_MIN_LINES)
    expect(FILE_READ_DEFAULT_LINES).toBeLessThanOrEqual(FILE_READ_MAX_LINES)
    expect(FILE_OUTPUT_DEFAULT_BYTES).toBeLessThanOrEqual(FILE_OUTPUT_MAX_BYTES)
    expect(AGENT_DEFAULT_CONCURRENCY).toBeGreaterThanOrEqual(AGENT_MIN_CONCURRENCY)
    expect(AGENT_DEFAULT_CONCURRENCY).toBeLessThanOrEqual(AGENT_MAX_CONCURRENCY)
    expect(AGENT_DEFAULT_DEPTH).toBeGreaterThanOrEqual(AGENT_MIN_DEPTH)
    expect(AGENT_DEFAULT_DEPTH).toBeLessThanOrEqual(AGENT_MAX_DEPTH)
    expect(WEB_DEFAULT_RESULTS).toBeLessThanOrEqual(WEB_MAX_RESULTS)
    expect(WEB_DEFAULT_CHARS_PER_PAGE).toBeLessThanOrEqual(WEB_MAX_CHARS_PER_PAGE)
    expect(WAIT_DEFAULT_MS).toBeLessThanOrEqual(WAIT_MAX_MS)
  })

  it('shares one frozen default record instead of a value a caller can edit', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true)
    expect(Object.isFrozen(DEFAULT_SETTINGS.files)).toBe(true)
    expect(Object.isFrozen(DEFAULT_LIBRARY.modules)).toBe(true)
  })

  it('accepts both defaults through the schemas the store validates on reopen', () => {
    expect(runtimeSettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
    expect(promptLibrarySchema.parse(DEFAULT_LIBRARY)).toEqual({ modules: [], defaultSelection: [] })
  })
})

describe('deployment config', () => {
  it('leaves both shell paths unset so the stored settings decide', () => {
    expect(Config({})).toEqual({})
  })

  it('accepts explicit deployment executables the stored settings may override', () => {
    const config = Config({
      bashPath: 'C:/Program Files/Git/bin/bash.exe',
      pwshPath: 'C:/Program Files/PowerShell/7/pwsh.exe',
    })

    expect(config).toEqual({
      bashPath: 'C:/Program Files/Git/bin/bash.exe',
      pwshPath: 'C:/Program Files/PowerShell/7/pwsh.exe',
    })
  })

  it('rejects a shell path that is not a string', () => {
    expect(() => Config({ bashPath: 42 } as unknown as Config)).toThrow()
  })
})
