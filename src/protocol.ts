/**
 * Browser-safe data shared by the host half, the console and the store.
 *
 * Everything here is plain JSON: no `Context`, `Agent`, process or terminal
 * handle, and no environment snapshot may cross into these types, because the
 * console posts the same records over HTTP and the store persists them. Host
 * identity (`Agent`) and lifecycle handles stay in their owning modules.
 *
 * Record shapes that the store persists are validated against these types by
 * `storage/domain.ts`; the console only reads them.
 *
 * @module dsh-nexus/protocol
 */

/** One editable system-prompt module: the durable unit of the prompt library. */
export interface PromptModule {
  /** Stable identifier referenced by `PromptLibrary.defaultSelection` and a snapshot's `selection`. */
  readonly id: string
  /** Console label; never concatenated into the prompt text. */
  readonly name: string
  /** The literal body appended to the system prompt when selected. */
  readonly body: string
}

/**
 * The whole prompt library. `modules` carries the bodies; `defaultSelection`
 * is the ordered selection a new session starts from, so array order is the
 * order the prompt is assembled in.
 */
export interface PromptLibrary {
  readonly modules: readonly PromptModule[]
  readonly defaultSelection: readonly string[]
}

/**
 * The complete prompt text one session was assembled with. `modules` keeps the
 * actual bodies, not references into a library that may change later, so a
 * request in flight and a reopened session both see the same text.
 *
 * `text` is that session's Nexus persona contribution — the base prompt plus the
 * selected bodies — which the preset contributes as the scoped system-prompt
 * persona section. It is NOT the whole system request: the harness identity,
 * first-party tool guidance, runtime context, the persona suffix and any
 * third-party sections are added by native assembly around it.
 */
export interface PromptSnapshot {
  /** Durable session this snapshot belongs to. */
  readonly sessionId: string
  /** Module ids in assembly order. */
  readonly selection: readonly string[]
  /** The module bodies as they were selected. */
  readonly modules: readonly PromptModule[]
  /** The Nexus persona text (base prompt plus selected bodies) this session runs with. */
  readonly text: string
}

/** HTTP console namespace; these named routes have their own security boundary. */
export const NEXUS_API_PREFIX = '/api/dsh-nexus'

/** A distinct keyed route prevents WHATWG dot-segment normalization. The literal
 * `~` prefix is framing, never part of the ID; the remainder is decoded ONCE.
 * Legacy /sessions/:id/prompt paths retain their original interpretation. */
export function consolePromptPath(sessionId: string): string {
  return `${NEXUS_API_PREFIX}/session-keys/~${encodeURIComponent(sessionId)}/prompt`
}

/** Opaque lost-update token, not a user-visible version. */
export interface ConsoleStored<T> { readonly value: T; readonly hash: string }
/** Strict complete PUT payload for library/settings. */
export interface ConsoleSave<T> { readonly value: T; readonly expectedHash: string }
/** Draft-only preview: never includes a fabricated session identity. */
export interface PromptPreviewRequest { readonly library: PromptLibrary; readonly selection: readonly string[] }
export interface PromptPreview { readonly selection: readonly string[]; readonly modules: readonly PromptModule[]; readonly text: string }
/** Explicit apply always resolves bodies from the saved library. */
export interface PromptApplyRequest { readonly selection: readonly string[]; readonly expectedLibraryHash: string }
/** GET sessions: exact live Nexus actors only. */
export interface ConsoleSession { readonly id: string; readonly title: string }
/** Every HTTP failure uses this shape; infrastructure details stay on the host. */
export interface ConsoleError { readonly error: { readonly code: string; readonly message: string } }
/** Public registration metadata only; unknown names are null, not an empty registry. */
export interface ConsoleBackendRegistration {
  readonly service: 'present' | 'absent' | 'unknown'
  readonly backends:
    | { readonly state: 'registered' | 'absent'; readonly names: readonly string[] }
    | { readonly state: 'unknown'; readonly names: null }
  readonly readiness: 'unverified'
}

/** Registration facts do not claim OS, account, GUI or provider verification. */
export interface ConsoleCapabilities {
  readonly csrfToken: string
  readonly verification: 'unverified'
  readonly registered: { readonly consoleApi: true; readonly nexusRuntime: true }
  readonly backendRegistrations: {
    /** Facts are limited to the route's current effective service scope, never global absence. */
    readonly scope: 'effective-http-context'
    readonly terminal: ConsoleBackendRegistration
    readonly web: ConsoleBackendRegistration
    readonly internalAgent: ConsoleBackendRegistration
  }
  readonly diagnostics: readonly string[]
  readonly settingsLocation: { readonly namespace: 'dsh-nexus'; readonly domain: 'dsh_nexus' }
  readonly basePrompt: string
}

/** Shell dialect Nexus can start; both are supported, `bash` is the default. */
export type ShellEngine = 'bash' | 'pwsh'

/** Lifecycle state of one managed process, as the owner can prove it. */
export type ProcessStatus =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'exited'
  | 'failed'
  | 'timed_out'
  | 'cancelled'

/** Why a managed process was asked to stop; the first request wins. */
export type ProcessStopCause = 'user' | 'timeout' | 'cancel' | 'dispose'

/**
 * One managed process as the host and console may describe it.
 *
 * `cleanupConfirmed` is the provider's proof that the whole managed range is
 * empty. A settled parent command is not that proof, so a process with a
 * surviving descendant stays `stopping` with `cleanupConfirmed: false`.
 */
export interface ProcessView {
  /**
   * Opaque resource id the caller uses for later control. For a managed shell
   * command it is the native background-job id the registry issued.
   */
  readonly resourceId: string
  /** Resource family; process ranges and terminals are never interchangeable. */
  readonly kind: 'process'
  /** Lifecycle state proven by the provider so far. */
  readonly status: ProcessStatus
  /** Native exit code; null while running or after a signal death. */
  readonly exitCode: number | null
  /** Native terminating signal name; null on a normal exit or while running. */
  readonly signal: string | null
  /** First stop cause requested, or null when no stop was requested. */
  readonly stopRequested: ProcessStopCause | null
  /** The provider proved the managed range empty after the parent outcome. */
  readonly cleanupConfirmed: boolean
}

/**
 * One bounded read of a process's combined stdout/stderr.
 *
 * `cursor` is opaque host state (never a file path): passing it back continues
 * exactly after the returned bytes. `lossy` stays true once any requested byte
 * was no longer recoverable from the in-memory tail; `spillAvailable` records
 * that the provider advertised a complete-stream spill file.
 */
export interface OutputPage {
  /** Text returned by this read; at most the page byte cap of UTF-8 bytes. */
  readonly text: string
  /** Opaque continuation cursor, valid only for the process that produced it. */
  readonly cursor: string
  /** Some requested bytes were dropped from memory and are not in `text`. */
  readonly lossy: boolean
  /**
   * At least one stream currently advertises an intact complete-stream spill
   * file. This is not proof that the combined stdout+stderr log is fully
   * recoverable: another stream may have no spill, and the provider can revoke
   * a spill on cap/write/seal failure.
   */
  readonly spillAvailable: boolean
}

/** File-tool limits a user may tune in the console. */
export interface FileSettings {
  /** Lines returned by a `read` that names no `limit`. */
  readonly defaultLines: number
  /** Byte cap of one `read` result. */
  readonly maxOutputBytes: number
}

/**
 * Terminal preferences. A program path saved here outranks the deployment
 * default and only affects terminals started later, never a running one.
 */
export interface TerminalSettings {
  /** Engine started when a call names none. */
  readonly engine: ShellEngine
  /** Explicit bash executable, when it is not the deployment default. */
  readonly bashPath?: string
  /** Explicit PowerShell 7 executable, when it is not the deployment default. */
  readonly pwshPath?: string
}

/** Optional role defaults for internal children; capability is not limited here. */
export interface AgentRoleDefaults {
  /** Name shown for the child. */
  readonly name?: string
  /** Task guidance placed in the child's user content, not its system prompt. */
  readonly instructions?: string
  /** Model the child starts with. */
  readonly model?: string
}

/** Internal-child limits and role defaults. */
export interface AgentSettings {
  /** Concurrent children one parent may run. */
  readonly concurrency: number
  /** Effective depth cap for descendants. */
  readonly maxDepth: number
  /** Role values applied to a child that names none. */
  readonly role?: AgentRoleDefaults
}

/** Web-tool result limits. */
export interface WebSettings {
  /** Sources kept from one search or fetch call. */
  readonly maxResults: number
  /**
   * Characters returned by one `read` page when the call names no limit.
   *
   * This is the model-facing pagination budget, NOT a storage limit: the saved
   * document keeps its whole obtained text (up to the separate per-document
   * byte cap) and a later page continues from the returned offset.
   */
  readonly maxCharsPerPage: number
}

/** The stored settings record: one value for the whole installation. */
export interface RuntimeSettings {
  readonly files: FileSettings
  readonly terminal: TerminalSettings
  readonly agents: AgentSettings
  readonly web: WebSettings
}

/**
 * Which saved text `read` and `find` index.
 *
 * The record may carry raw obtained content, its readable conversion and an
 * upstream summary at the same time. Naming the basis in the record keeps
 * offsets meaningful: a later `read` continues in exactly the text those
 * offsets were measured in, instead of silently switching representation.
 * `search-results` is the rendered search output: the source listing plus, when
 * upstream supplied one, the provider answer under its own non-original
 * heading. `summary` keeps that answer alone; it is provenance, not page text.
 */
export type WebTextBasis = 'content' | 'converted-text' | 'summary' | 'search-results'

/**
 * One saved web result, addressed by `owner` plus `resultId`.
 *
 * The text fields stay distinct on purpose: `content` is what upstream actually
 * delivered, `convertedText` is the readable conversion of it, and `summary` is
 * whatever summary upstream supplied. `textBasis` names which of them (or the
 * rendered search listing) `read`/`find` address. A caller that wants the
 * original must not be handed a conversion. Truncation is recorded per cause so
 * a partial read is never presented as the whole document.
 */
export interface WebDocument {
  /** Session that owns the result; durable ownership, not a live Agent. */
  readonly owner: string
  /** Result id used by `web read/find`; unique within its owner. */
  readonly resultId: string
  /** Which call produced this document. */
  readonly kind: 'search' | 'fetch'
  /** Provider or source label, for diagnostics and the console. */
  readonly source: string
  /** Source URL; absent for a search query document. */
  readonly url?: string
  /** Search query; present only for a `search` document. */
  readonly query?: string
  /** The text upstream actually delivered. */
  readonly content: string
  /** Upstream-supplied summary, kept apart from the content and the conversion. */
  readonly summary?: string
  /** Readable conversion of `content`. */
  readonly convertedText?: string
  /** Which saved text `read` and `find` address. */
  readonly textBasis: WebTextBasis
  /** The HTML conversion was refused by the static safety guard. */
  readonly conversionSkipped?: boolean
  /** Upstream returned less than the full document. */
  readonly upstreamTruncated: boolean
  /** The saved copy dropped content to respect the size limit. */
  readonly savedTruncated: boolean
  /** ISO-8601 time the document was obtained. */
  readonly createdAt: string
  /** ISO-8601 time after which the document may be evicted. */
  readonly expiresAt: string
}

/**
 * The durable authorization of one internal child, kept so a cold session can
 * re-verify it instead of trusting a resource id alone.
 */
export interface ChildPolicy {
  /** Child session id the policy was granted to. */
  readonly childId: string
  /** Session that started the child. */
  readonly parentSessionId: string
  /** Canonical working directory the child was granted. */
  readonly cwd: string
  /** Filesystem access granted to the child. */
  readonly access: 'read' | 'write'
  /** Effective depth cap that applies to this child's own descendants. */
  readonly maxDepth: number
}

/**
 * Durable evidence that one child's write scope was reserved.
 *
 * A reservation is written before the child is admitted, so a process that
 * stops without confirming the child's cleanup leaves proof behind instead of
 * silently freeing a tree a possibly live writer still uses. Only an explicit
 * release deletes the record; the record alone is never a cleanup claim.
 */
export interface WriteScopeRecord {
  /** Child session id the scope was reserved for. */
  readonly childId: string
  /** Canonical root of the reserved tree. */
  readonly root: string
}
