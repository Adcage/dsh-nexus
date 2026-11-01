/**
 * Every tunable number and the stored defaults, in one place.
 *
 * The plan fixes these values and bounds, so tools import them instead of
 * carrying literals and the console can show the same limits it enforces. The
 * user-editable subset lives in {@link DEFAULT_SETTINGS}; the rest are hard
 * limits that no setting may exceed.
 *
 * @module dsh-nexus/runtime/defaults
 */

import type { PromptLibrary, RuntimeSettings } from '../protocol.ts'

// Files: default read size, its bounds, and the write/edit input ceiling.
/** Lines a `read` returns when it names no limit. */
export const FILE_READ_DEFAULT_LINES = 200
/** Smallest accepted read line count. */
export const FILE_READ_MIN_LINES = 1
/** Largest accepted read line count. */
export const FILE_READ_MAX_LINES = 2_000
/** Byte cap of one read result when the settings name no other value. */
export const FILE_OUTPUT_DEFAULT_BYTES = 32 * 1024
/** Smallest accepted read output cap. */
export const FILE_OUTPUT_MIN_BYTES = 1
/** Largest accepted read output cap. */
export const FILE_OUTPUT_MAX_BYTES = 32 * 1024
/** Largest accepted total size of an edit call's input. */
export const FILE_EDIT_MAX_INPUT_BYTES = 16 * 1024 * 1024

// Shell processes and output retention.
/** Timeout of an ordinary command when the call names none. */
export const COMMAND_DEFAULT_TIMEOUT_MS = 120_000
/** Smallest accepted command timeout. */
export const COMMAND_MIN_TIMEOUT_MS = 1
/** Largest accepted command timeout. */
export const COMMAND_MAX_TIMEOUT_MS = 600_000
/** Grace period between a stop request and forced termination. */
export const COMMAND_CLEANUP_GRACE_MS = 3_000
/** In-memory cap of each of stdout and stderr. */
export const PROCESS_OUTPUT_MEMORY_BYTES = 32 * 1024
/** Spill file cap of each of stdout and stderr. */
export const PROCESS_OUTPUT_SPILL_BYTES = 32 * 1024 * 1024
/** Largest text one output read returns. */
export const PROCESS_READ_MAX_BYTES = 16 * 1024
/** Live processes one owner may hold at once. */
export const AGENT_MAX_PROCESSES = 8
/** Persistent terminals one owner may hold at once. */
export const AGENT_MAX_TERMINALS = 4
/** `wait` duration when the call names none. */
export const WAIT_DEFAULT_MS = 1_000
/** Largest accepted `wait` duration; reaching it never kills the resource. */
export const WAIT_MAX_MS = 30_000

// Web calls and saved documents.
/** Queries one search call may carry. */
export const WEB_MAX_QUERIES = 3
/** URLs one fetch call may carry. */
export const WEB_MAX_URLS = 6
/** Sources kept per call when the settings name no other value. */
export const WEB_DEFAULT_RESULTS = 5
/** Largest accepted source count. */
export const WEB_MAX_RESULTS = 10
/** Characters per saved page when the settings name no other value. */
export const WEB_DEFAULT_CHARS_PER_PAGE = 12_000
/** Largest accepted characters per saved page. */
export const WEB_MAX_CHARS_PER_PAGE = 24_000
/** Largest accepted stored size of one web document. */
export const WEB_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024
/** Saved documents one session may hold. */
export const WEB_SESSION_MAX_DOCUMENTS = 32
/** Stored bytes one session's web documents may occupy. */
export const WEB_SESSION_MAX_BYTES = 32 * 1024 * 1024
/** Retention of one saved web document. */
export const WEB_DOCUMENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

// Internal children.
/** Concurrent children one parent starts when the settings name no other value. */
export const AGENT_DEFAULT_CONCURRENCY = 4
/** Smallest accepted child concurrency. */
export const AGENT_MIN_CONCURRENCY = 1
/** Largest accepted child concurrency. */
export const AGENT_MAX_CONCURRENCY = 16
/** Effective descendant depth when the settings name no other value. */
export const AGENT_DEFAULT_DEPTH = 2
/** Smallest accepted depth cap; a parent may forbid descendants entirely. */
export const AGENT_MIN_DEPTH = 0
/** Largest accepted depth cap. */
export const AGENT_MAX_DEPTH = 8
/** Tasks one batch start may carry. */
export const AGENT_BATCH_MAX_TASKS = 8
/** Child events returned by `agent read` when the call names no limit. */
export const AGENT_READ_DEFAULT_EVENTS = 20
/** Largest accepted child event count. */
export const AGENT_READ_MAX_EVENTS = 100

// Prompt library.
/** Modules one library may hold. */
export const PROMPT_MAX_MODULES = 32
/** Bytes one module body may hold. */
export const PROMPT_MODULE_MAX_BYTES = 32 * 1024
/** Bytes all module bodies together may hold. */
export const PROMPT_LIBRARY_MAX_BYTES = 128 * 1024

/** Settings served and stored before the user changes anything. */
export const DEFAULT_SETTINGS: RuntimeSettings = Object.freeze({
  files: Object.freeze({
    defaultLines: FILE_READ_DEFAULT_LINES,
    maxOutputBytes: FILE_OUTPUT_DEFAULT_BYTES,
  }),
  terminal: Object.freeze({ engine: 'bash' as const }),
  agents: Object.freeze({
    concurrency: AGENT_DEFAULT_CONCURRENCY,
    maxDepth: AGENT_DEFAULT_DEPTH,
  }),
  web: Object.freeze({
    maxResults: WEB_DEFAULT_RESULTS,
    maxCharsPerPage: WEB_DEFAULT_CHARS_PER_PAGE,
  }),
})

/** Prompt library served and stored before the user adds a module: nothing selected. */
export const DEFAULT_LIBRARY: PromptLibrary = Object.freeze({
  modules: Object.freeze([]),
  defaultSelection: Object.freeze([]),
})
