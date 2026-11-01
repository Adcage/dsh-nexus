/**
 * Controlled doubles for the capability seams Nexus tools call, plus the
 * explicit caller identity every tool run needs.
 *
 * The doubles implement the real DSH service contracts (`FileSystem`,
 * `WebRuntime` providers, `SubprocessRuntime`), so a tool body that reaches
 * `ctx.fs`, `ctx.web` or `ctx.subprocess` goes through the same types the
 * harness process exposes. They exist so a test can observe what a tool asked
 * for and decide what comes back — never so a tool can be tested without
 * touching the service it actually depends on.
 *
 * Everything here is deterministic: no network, no real child process, and no
 * filesystem outside the in-memory tree. Failure policies are the real error
 * codes (`FS_*`), not invented ones, so a caller's error handling is exercised.
 *
 * @module dsh-nexus/test/support/fixtures
 */

import { PassThrough, Readable, type Duplex, type Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId as SessionIdValue } from '@deepseek-ai/dsh-session'
import {
  FileSystem,
  FsError,
  FsTargetKey,
  FsVersion,
  type FsDirEntry,
  type FsEditOutcome,
  type FsEditRequest,
  type FsInfo,
  type FsPathInfo,
  type FsTarget,
  type FsWriteIntent,
  type FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import WebRuntime, {
  type WebFetchProvider,
  type WebFetchRequest,
  type WebFetchResult,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
} from '@deepseek-ai/dsh-web'
import {
  SubprocessRuntime,
  type SubprocessCollectedOutputs,
  type SubprocessHandle,
  type SubprocessOutcome,
  type SubprocessOutputReader,
  type SubprocessSpawnSpec,
  type SubprocessTerminalEnvironment,
  type SubprocessTerminalForeground,
  type SubprocessTerminalHandle,
  type SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

/** Agent identity, session identity and cancellation of one tool caller. */
export interface HarnessOwner {
  /** The exact live Agent instance a tool run is attributed to. */
  readonly agent: Agent
  /** Session id shared by the Agent and the durable log. */
  readonly sessionId: SessionIdValue
  /** Caller-owned cancellation for every run of this owner. */
  readonly signal: AbortSignal
}

/**
 * Build the explicit owner of a tool run from the Agent that runs it.
 * @param agent - the live Agent created for the harness.
 * @param signal - cancellation for every run; defaults to a fresh never-aborted signal.
 * @returns the owner handed to every `ctx.tools.execute` call.
 */
export function createOwner(agent: Agent, signal?: AbortSignal): HarnessOwner {
  return { agent, sessionId: agent.id, signal: signal ?? new AbortController().signal }
}

/** Initial content of the in-memory tree. */
export interface FsDoubleOptions {
  /** Files to create, keyed by path. Parent directories exist implicitly. */
  readonly files?: Readonly<Record<string, string>>
}

/**
 * In-memory `ctx.fs` provider.
 *
 * It implements every abstract operation of the real contract: stable targets,
 * directory listings derived from file paths, guarded create (`createIfAbsent`),
 * guarded replace (`replaceIfVersion`), and literal editing with the same
 * ambiguity rules a backend enforces. Content is stored as UTF-8 text, which is
 * deliberate: the byte, BOM and line-ending policy under test belongs to the
 * Nexus tool layer, and a double that normalized anything would hide it.
 */
export class FsDouble extends FileSystem {
  private readonly texts = new Map<string, string>()
  private readonly versions = new Map<string, FsVersion>()
  private sequence = 0

  /**
   * @param ctx - context the service registers into as `ctx.fs`.
   * @param options - files to seed.
   */
  constructor(ctx: Context, options: FsDoubleOptions = {}) {
    super(ctx)
    for (const [path, text] of Object.entries(options.files ?? {})) {
      const key = normalizePath(path)
      this.texts.set(key, text)
      this.versions.set(key, this.nextVersion())
    }
  }

  /** Current text of one path, for assertions after a tool run. */
  read(path: string): string | undefined {
    return this.texts.get(normalizePath(path))
  }

  /** Whether one path currently holds a file. */
  has(path: string): boolean {
    return this.texts.has(normalizePath(path))
  }

  /**
   * Resolve a path to a stable target in this double's flat namespace.
   * @param path - absolute or cwd-relative path.
   * @param opts - optional cwd override and cancellation.
   * @returns the target identity and its display path.
   */
  async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    this.throwIfAborted(opts?.signal)
    // The shipped contract resolves *relative* paths against `opts.cwd`; an
    // already-rooted path must keep its own root.
    const key = normalizePath(!isAbsolutePath(path) && opts?.cwd !== undefined ? `${opts.cwd}/${path}` : path)
    return { targetKey: FsTargetKey(key), displayPath: key }
  }

  /**
   * @param target - resolved target.
   * @returns the path a subprocess would open.
   */
  processPath(target: FsTarget): string {
    return target.displayPath
  }

  /**
   * @param target - resolved target.
   * @returns a `file:` URI for the target.
   */
  fileUrl(target: FsTarget): string {
    return `file://${encodeURI(target.displayPath)}`
  }

  /**
   * @param parent - candidate ancestor.
   * @param child - candidate descendant.
   * @returns whether `child` is `parent` or below it.
   */
  contains(parent: FsTarget, child: FsTarget): boolean {
    return child.targetKey === parent.targetKey || child.targetKey.startsWith(`${parent.targetKey}/`)
  }

  /**
   * @param target - resolved target.
   * @param signal - cancellation.
   * @returns metadata, or undefined when nothing exists at the target.
   */
  async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    this.throwIfAborted(signal)
    const text = this.texts.get(target.targetKey)
    if (text !== undefined) {
      return { version: this.versionOf(target.targetKey), type: 'file', size: Buffer.byteLength(text) }
    }
    if (this.isDirectory(target.targetKey)) {
      return { version: this.directoryVersion(target.targetKey), type: 'directory' }
    }
    return undefined
  }

  /**
   * @param path - path to inspect.
   * @param opts - optional cwd override.
   * @param signal - cancellation.
   * @returns path metadata, or undefined when nothing exists at the path.
   */
  async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    this.throwIfAborted(signal)
    const target = await this.resolve(path, { cwd: opts?.cwd })
    const info = await this.stat(target, signal)
    return info === undefined ? undefined : { version: info.version, type: info.type, size: info.size }
  }

  /**
   * @param target - resolved file target.
   * @param signal - cancellation.
   * @returns the decoded file content.
   */
  async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    this.throwIfAborted(signal)
    return this.textAt(target)
  }

  /**
   * @param target - resolved file target.
   * @param signal - cancellation.
   * @returns the content as decoded chunks.
   */
  async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    this.throwIfAborted(signal)
    const text = this.textAt(target)
    return (async function* chunks() {
      const size = Math.max(1, Math.ceil(text.length / 3))
      for (let index = 0; index < text.length; index += size) yield text.slice(index, index + size)
    })()
  }

  /**
   * @param target - resolved file target.
   * @param signal - cancellation.
   * @param maxBytes - inclusive cap on the whole content.
   * @returns the raw content.
   */
  async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    this.throwIfAborted(signal)
    const bytes = Buffer.from(this.textAt(target), 'utf8')
    if (bytes.byteLength > maxBytes) {
      throw new FsError(`file exceeds ${maxBytes} bytes`, 'FS_TOO_LARGE')
    }
    return bytes
  }

  /**
   * @param target - resolved file target.
   * @param range - byte offset and maximum length.
   * @param signal - cancellation.
   * @returns the requested byte window.
   */
  async readByteRange(
    target: FsTarget,
    range: { offset: number; length: number },
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    this.throwIfAborted(signal)
    const bytes = Buffer.from(this.textAt(target), 'utf8')
    return bytes.subarray(range.offset, range.offset + range.length)
  }

  /**
   * @param target - resolved directory target.
   * @param signal - cancellation.
   * @returns direct children in name order.
   */
  async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    this.throwIfAborted(signal)
    if (!this.isDirectory(target.targetKey)) {
      const failure = this.texts.has(target.targetKey) ? 'FS_NOT_DIRECTORY' : 'FS_NOT_FOUND'
      throw new FsError(`not a directory: ${target.displayPath}`, failure)
    }
    const prefix = `${target.targetKey.replace(/\/$/, '')}/`
    const names = new Map<string, 'file' | 'directory'>()
    for (const key of this.texts.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) names.set(rest, 'file')
      else if (!names.has(rest.slice(0, slash))) names.set(rest.slice(0, slash), 'directory')
    }
    return [...names.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, type]) => {
        const key = `${prefix}${name}`
        const text = this.texts.get(key)
        const entry: FsDirEntry = {
          name,
          type,
          target: { targetKey: FsTargetKey(key), displayPath: key },
        }
        return text === undefined ? entry : { ...entry, version: this.versionOf(key), size: Buffer.byteLength(text) }
      })
  }

  /**
   * @param target - resolved file target.
   * @param content - complete new content.
   * @param expected - guarded create or versioned replace; omitted writes unconditionally.
   * @param signal - cancellation before publication.
   * @returns the write outcome, including the produced version.
   */
  async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    this.throwIfAborted(signal)
    const key = target.targetKey
    const before = this.texts.get(key) ?? null
    if (expected?.kind === 'createIfAbsent' && before !== null) {
      throw new FsError(`file already exists: ${target.displayPath}`, 'FS_NOT_OBSERVED')
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (before === null) {
        // The shipped contract treats absence under a versioned replace as a
        // stale version, not as an unobserved target.
        throw new FsError(`cannot replace a target that does not exist: ${target.displayPath}`, 'FS_STALE_VERSION')
      }
      if (this.versionOf(key) !== expected.version) {
        throw new FsError(`file changed since it was observed: ${target.displayPath}`, 'FS_STALE_VERSION')
      }
    }
    this.texts.set(key, content)
    this.versions.set(key, this.nextVersion())
    return {
      operation: before === null ? 'create' : 'update',
      version: this.versionOf(key),
      before,
      after: content,
    }
  }

  /**
   * @param target - resolved file target.
   * @param edit - literal replacement request.
   * @param expected - version guard; omitted edits without a freshness precondition.
   * @param signal - cancellation before publication.
   * @returns the edit outcome, including the produced version.
   */
  async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    this.throwIfAborted(signal)
    const key = target.targetKey
    const before = this.textAt(target)
    if (expected !== undefined && this.versionOf(key) !== expected.version) {
      throw new FsError(`file changed since it was observed: ${target.displayPath}`, 'FS_STALE_VERSION')
    }
    const matches = countOccurrences(before, edit.oldString)
    if (matches === 0) {
      throw new FsError(`no match for the requested text in ${target.displayPath}`, 'FS_EDIT_NOT_FOUND')
    }
    if (matches > 1 && !edit.replaceAll) {
      throw new FsError(`the requested text occurs ${matches} times in ${target.displayPath}`, 'FS_AMBIGUOUS_EDIT')
    }
    const after = edit.replaceAll
      ? before.split(edit.oldString).join(edit.newString)
      : before.replace(edit.oldString, () => edit.newString)
    this.texts.set(key, after)
    this.versions.set(key, this.nextVersion())
    return { version: this.versionOf(key), before, after }
  }

  private textAt(target: FsTarget): string {
    const text = this.texts.get(target.targetKey)
    if (text === undefined) {
      const failure = this.isDirectory(target.targetKey) ? 'FS_NOT_REGULAR_FILE' : 'FS_NOT_FOUND'
      throw new FsError(`no file at ${target.displayPath}`, failure)
    }
    return text
  }

  private isDirectory(key: string): boolean {
    const prefix = `${key.replace(/\/$/, '')}/`
    for (const candidate of this.texts.keys()) if (candidate.startsWith(prefix)) return true
    return false
  }

  private directoryVersion(key: string): FsVersion {
    const prefix = `${key.replace(/\/$/, '')}/`
    let children = 0
    for (const candidate of this.texts.keys()) if (candidate.startsWith(prefix)) children += 1
    return FsVersion(`dir-${key}-${children}`)
  }

  private versionOf(key: string): FsVersion {
    const version = this.versions.get(key)
    if (version === undefined) throw new FsError(`no file at ${key}`, 'FS_NOT_FOUND')
    return version
  }

  private nextVersion(): FsVersion {
    this.sequence += 1
    return FsVersion(`v${this.sequence}`)
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted === true) throw new FsError('filesystem operation aborted', 'FS_ABORTED')
  }
}

/** Scripted answers for the two web capabilities. */
export interface WebDoubleOptions {
  /** Answer for `ctx.web.search`; defaults to no sources. */
  readonly search?: (request: WebSearchRequest) => WebSearchResult | Promise<WebSearchResult>
  /** Answer for `ctx.web.fetch`; defaults to an empty text body with status 200. */
  readonly fetch?: (request: WebFetchRequest) => WebFetchResult | Promise<WebFetchResult>
}

/** The mounted web service plus the requests it received. */
export interface WebDouble {
  /** The real `WebRuntime` the tool reads through `ctx.web`. */
  readonly runtime: WebRuntime
  /** Every search request, in call order. */
  readonly searches: WebSearchRequest[]
  /** Every fetch request, in call order. */
  readonly fetches: WebFetchRequest[]
}

/** Provider id both scripted providers register under. */
const WEB_DOUBLE_PROVIDER_ID = 'nexus-test-double'

/**
 * Mount the real `WebRuntime` with scripted providers.
 *
 * The service under test is the shipped one — provider selection, cancellation
 * and result capping all run — while the network is replaced by the caller's
 * answers.
 * @param ctx - context to mount into.
 * @param options - scripted answers and request recording.
 * @returns the service and its request log.
 */
export async function mountWebDouble(ctx: Context, options: WebDoubleOptions = {}): Promise<WebDouble> {
  await ctx.plugin(WebRuntime)
  const runtime = ctx.web
  const searches: WebSearchRequest[] = []
  const fetches: WebFetchRequest[] = []
  const searchProvider: WebSearchProvider = {
    id: WEB_DOUBLE_PROVIDER_ID,
    available: () => true,
    async search(request) {
      searches.push(request)
      return options.search === undefined ? { sources: [], truncated: false } : options.search(request)
    },
  }
  const fetchProvider: WebFetchProvider = {
    id: WEB_DOUBLE_PROVIDER_ID,
    available: () => true,
    async fetch(request) {
      fetches.push(request)
      return options.fetch === undefined
        ? { url: request.url, statusCode: 200, body: { kind: 'text', content: '' }, truncated: false }
        : options.fetch(request)
    },
  }
  ctx.effect(() => runtime.registerSearchProvider(searchProvider), 'test support: search provider')
  ctx.effect(() => runtime.registerFetchProvider(fetchProvider), 'test support: fetch provider')
  return { runtime, searches, fetches }
}

/** What a scripted process or terminal does. */
export interface ScriptedProcessScript {
  /** Text captured on stdout. */
  readonly stdout?: string
  /** Text captured on stderr. */
  readonly stderr?: string
  /** Exit code; `null` means it died from a signal. Defaults to 0. */
  readonly exitCode?: number | null
  /** Terminating signal reported by `done`. */
  readonly signal?: NodeJS.Signals | null
  /** Keep the process alive until `terminate()` is called. */
  readonly staysOpen?: boolean
}

/** How the subprocess double answers a spawn request. */
export interface SubprocessDoubleOptions {
  /** Script for one spawn; defaults to a clean, immediately finished process. */
  readonly script?: (spec: SubprocessSpawnSpec) => ScriptedProcessScript
  /** Script for one terminal spawn; defaults to a clean, immediately finished session. */
  readonly terminalScript?: (spec: SubprocessTerminalSpawnSpec) => ScriptedProcessScript
}

/** The mounted subprocess service plus what it was asked to start. */
export interface SubprocessDouble {
  /** The `SubprocessRuntime` a tool reads through `ctx.subprocess`. */
  readonly runtime: SubprocessRuntime
  /** Every ordinary spawn request, in call order. */
  readonly spawns: SubprocessSpawnSpec[]
  /** Every terminal spawn request, in call order. */
  readonly terminalSpawns: SubprocessTerminalSpawnSpec[]
}

/**
 * Mount a scripted `SubprocessRuntime`.
 *
 * No real child is started: the double records the fully specified request and
 * returns a handle whose strings, exit facts and termination are the script's.
 * That keeps a tool-layer test off the machine's process table while the tool
 * still receives the shipped handle contract.
 * @param ctx - context to mount into.
 * @param options - scripts for spawned and terminal processes.
 * @returns the service and its spawn logs.
 */
export async function mountSubprocessDouble(
  ctx: Context,
  options: SubprocessDoubleOptions = {},
): Promise<SubprocessDouble> {
  const double = new ScriptedSubprocessRuntime(ctx, options)
  return { runtime: double, spawns: double.spawns, terminalSpawns: double.terminalSpawns }
}

/** Scripted subprocess provider; see {@link mountSubprocessDouble}. */
class ScriptedSubprocessRuntime extends SubprocessRuntime {
  readonly spawns: SubprocessSpawnSpec[] = []
  readonly terminalSpawns: SubprocessTerminalSpawnSpec[] = []
  private terminalSequence = 0

  /**
   * @param ctx - context the service registers into as `ctx.subprocess`.
   * @param options - scripts for spawned and terminal processes.
   */
  constructor(ctx: Context, private readonly options: SubprocessDoubleOptions) {
    super(ctx)
  }

  /**
   * @param command - absolute executable path or bare name.
   * @returns the command unchanged: the double performs no PATH lookup.
   */
  async resolveExecutable(command: string): Promise<string> {
    return command
  }

  /**
   * @returns the host platform and no preferred shell.
   */
  async terminalEnvironment(): Promise<SubprocessTerminalEnvironment> {
    return { platform: process.platform === 'win32' ? 'windows' : 'posix' }
  }

  /**
   * @param spec - the fully specified spawn request.
   * @returns a handle driven by the configured script.
   */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    return new ScriptedProcess(spec, this.options.script?.(spec) ?? {})
  }

  /**
   * @param spec - the fully specified terminal spawn request.
   * @returns a handle driven by the configured terminal script.
   */
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    this.terminalSpawns.push(spec)
    this.terminalSequence += 1
    return new ScriptedTerminal(this.terminalSequence, this.options.terminalScript?.(spec) ?? {})
  }
}

/** Offset reader over a fixed string, using byte coordinates like the seam. */
function createCollectReader(text: string): SubprocessOutputReader {
  const bytes = Buffer.from(text, 'utf8')
  return {
    readFrom(fromByte) {
      const offset = Math.max(0, Math.min(fromByte, bytes.length))
      return { text: bytes.subarray(offset).toString('utf8'), nextOffset: bytes.length, lossy: false }
    },
  }
}

/** One scripted ordinary process. */
class ScriptedProcess implements SubprocessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  readonly control: Duplex | undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>
  private settle!: (outcome: SubprocessOutcome) => void
  private finished = false
  private readonly staysOpen: boolean

  /**
   * @param spec - the spawn request whose stdio disposition decides which members exist.
   * @param script - output text and exit facts.
   */
  constructor(spec: SubprocessSpawnSpec, script: ScriptedProcessScript) {
    const stdoutText = script.stdout ?? ''
    const stderrText = script.stderr ?? ''
    this.staysOpen = script.staysOpen === true
    this.stdin = spec.stdio.stdin === 'pipe' ? new PassThrough() : undefined
    this.stdout = spec.stdio.stdout === 'pipe' ? Readable.from([stdoutText]) : undefined
    this.stderr = spec.stdio.stderr === 'pipe' ? Readable.from([stderrText]) : undefined
    this.control = spec.stdio.control === 'pipe' ? new PassThrough() : undefined
    this.collected = {
      ...(typeof spec.stdio.stdout === 'object' ? { stdout: createCollectReader(stdoutText) } : {}),
      ...(typeof spec.stdio.stderr === 'object' ? { stderr: createCollectReader(stderrText) } : {}),
    }
    this.done = new Promise<SubprocessOutcome>((resolve) => {
      this.settle = resolve
    })
    if (!this.staysOpen) {
      this.finished = true
      this.settle({ exitCode: script.exitCode ?? 0, signal: script.signal ?? null })
    }
    spec.signal?.addEventListener('abort', () => this.terminate(), { once: true })
  }

  /** Finish the scripted process with a signal, as the provider's teardown does. */
  terminate(): void {
    if (this.finished) return
    this.finished = true
    this.settle({ exitCode: null, signal: 'SIGTERM' })
  }

  /**
   * @param signal - optional bound on the wait.
   * @returns whether the scripted process finished before the bound aborted.
   */
  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    if (signal === undefined) {
      await this.done
      return true
    }
    if (signal.aborted) return false
    return Promise.race([
      this.done.then(() => true),
      new Promise<boolean>((resolve) => signal.addEventListener('abort', () => resolve(false), { once: true })),
    ])
  }
}

/** One scripted terminal session. */
class ScriptedTerminal implements SubprocessTerminalHandle {
  readonly output = new PassThrough()
  readonly done: Promise<SubprocessOutcome>
  /** Text written to the terminal, in call order. */
  readonly writes: string[] = []
  private settle!: (outcome: SubprocessOutcome) => void
  private finished = false

  /**
   * @param pid - the process id this scripted session reports.
   * @param script - output text and exit facts.
   */
  constructor(readonly pid: number, script: ScriptedProcessScript) {
    this.done = new Promise<SubprocessOutcome>((resolve) => {
      this.settle = resolve
    })
    this.output.end(script.stdout ?? '')
    if (script.staysOpen !== true) {
      this.finished = true
      this.settle({ exitCode: script.exitCode ?? 0, signal: script.signal ?? null })
    }
  }

  /**
   * @param data - text to deliver.
   */
  async write(data: string): Promise<void> {
    this.writes.push(data)
  }

  /**
   * Record a resize request.
   * @param cols - new column count.
   * @param rows - new row count.
   */
  async resize(cols: number, rows: number): Promise<void> {
    this.writes.push(`resize:${cols}x${rows}`)
  }

  /**
   * @returns no foreground group: the scripted session has no OS process.
   */
  async inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    return undefined
  }

  /**
   * @returns an unknown activity observation with a fixed revision.
   */
  async inspectActivity(): Promise<{ state: 'idle' | 'busy' | 'unknown'; revision: number }> {
    return { state: 'unknown', revision: 0 }
  }

  /**
   * @returns 0: no process group received the signal.
   */
  async signalForeground(): Promise<number> {
    return 0
  }

  /** Finish the scripted session; idempotent. */
  async terminate(): Promise<void> {
    if (this.finished) return
    this.finished = true
    this.output.end()
    this.settle({ exitCode: null, signal: 'SIGTERM' })
  }
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/** Whether a path is already rooted: a POSIX root or a Windows drive path. */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/** Normalize a path for the double's flat namespace. */
function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return slashed.length > 1 ? slashed.replace(/\/$/, '') : slashed
}
