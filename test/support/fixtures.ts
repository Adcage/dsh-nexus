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
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId as SessionIdValue } from '@deepseek-ai/dsh-session'
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
import { NEXUS_DOMAIN_NAME } from '../../src/storage/domain.ts'
import { openNexusStore, type NexusStore } from '../../src/storage/store.ts'
import {
  AttachmentError,
  AttachmentId,
  AttachmentStore,
  type ImageAttachmentLimits,
  type ImageAttachmentRef,
  type ImageMediaType,
  type SaveImageAttachment,
  type StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
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
import {
  SandboxProvider,
  type ConfinedArgv,
  type RunnerFailureRule,
  type SandboxEnforcement,
  type SandboxExecutionPolicy,
  type SandboxPolicy,
} from '@deepseek-ai/dsh-sandbox'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type ModelModality,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
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

/** The real host filesystem backend plus the seams a test needs to observe it. */
export interface LocalFileSystemDoubleOptions {
  /** Absolute directory that owns every file the backend writes. */
  readonly root: string
  /** Base directory for relative paths; defaults to `root`. */
  readonly cwd?: string
}

/**
 * The shipped host backend with call counters and two controllable seams.
 *
 * Byte fidelity, version guards, atomic publication and parent-directory
 * behaviour all come from `@deepseek-ai/dsh-fs-local`; the overrides only count
 * publications, let a test run work immediately before one, and let a test
 * refuse the next one. That keeps the filesystem claims about BOM, CRLF and
 * untouched bytes an observation of the real backend instead of a convention
 * of a text-only double.
 */
export class CountingLocalFileSystem extends LocalFileSystem {
  /** Every `writeText` attempt, in call order (accepted or refused). */
  readonly writes: string[] = []
  /** Every `editText` attempt, in call order (accepted or refused). */
  readonly edits: string[] = []
  /** Run immediately before one write reaches the backend; used to race a create. */
  beforeWrite?: (target: FsTarget, content: string) => Promise<void> | void
  /** Refuse the next write with a native I/O failure before publication. */
  failNextWrite = false

  /**
   * @param ctx - context the service registers into as `ctx.fs`.
   * @param config - backend configuration; `cwd` is the relative-path base.
   */
  constructor(ctx: Context, config: { cwd: string }) {
    // A direct construction bypasses Cordis' Config defaulting, so the shipped
    // overwrite-diff basis has to be supplied explicitly here.
    super(ctx, { ...config, diffBasisMaxBytes: 10 * 1024 * 1024 })
  }

  /**
   * @param target - resolved target.
   * @param content - complete new content.
   * @param expected - guarded create or versioned replace.
   * @param signal - cancellation.
   * @returns the shipped backend's outcome.
   */
  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    this.writes.push(target.displayPath)
    await this.beforeWrite?.(target, content)
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new FsError(`simulated atomic publication failure for ${target.displayPath}`, 'FS_IO_ERROR')
    }
    return super.writeText(target, content, expected, signal)
  }

  /**
   * @param target - resolved target.
   * @param edit - literal edit request.
   * @param expected - version guard.
   * @param signal - cancellation.
   * @returns the shipped backend's outcome.
   */
  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    this.edits.push(target.displayPath)
    return super.editText(target, edit, expected, signal)
  }
}

/**
 * Mount the shipped host backend over a project-local root.
 * @param ctx - context to mount into.
 * @param options - root and relative-path base.
 * @returns the mounted counting backend.
 */
export async function mountLocalFileSystem(
  ctx: Context,
  options: LocalFileSystemDoubleOptions,
): Promise<CountingLocalFileSystem> {
  let mounted: CountingLocalFileSystem | undefined
  await ctx.plugin((pluginCtx) => {
    mounted = new CountingLocalFileSystem(pluginCtx, { cwd: options.cwd ?? options.root })
  })
  if (mounted === undefined) throw new Error('the local filesystem backend did not mount')
  return mounted
}

/**
 * The shipped sandbox-enforcing backend with the same counters as
 * {@link CountingLocalFileSystem}.
 *
 * Containment, the read-only denial and the workspace-root check all come from
 * `@deepseek-ai/dsh-fs-sandbox`; the override only records attempts and keeps
 * the two controllable seams used by the non-sandbox cases.
 */
export class CountingSandboxedFileSystem extends SandboxedFileSystem {
  /** Every `writeText` attempt, in call order (including denied ones). */
  readonly writes: string[] = []
  /** Every `editText` attempt, in call order (including denied ones). */
  readonly edits: string[] = []
  /** Run immediately before one write reaches the enforcing backend. */
  beforeWrite?: (target: FsTarget, content: string) => Promise<void> | void
  /** Refuse the next write with a native I/O failure before publication. */
  failNextWrite = false

  /**
   * @param ctx - context the service registers into as `ctx.fs`.
   * @param config - backend configuration; `cwd` is the relative-path base.
   */
  constructor(ctx: Context, config: { cwd: string }) {
    super(ctx, { ...config, diffBasisMaxBytes: 10 * 1024 * 1024 })
  }

  /**
   * @param target - resolved target.
   * @param content - complete new content.
   * @param expected - guarded create or versioned replace.
   * @param signal - cancellation.
   * @param sandboxPolicy - per-call policy the enforcing backend fences by.
   * @returns the enforcing backend's outcome.
   */
  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    this.writes.push(target.displayPath)
    await this.beforeWrite?.(target, content)
    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new FsError(`simulated atomic publication failure for ${target.displayPath}`, 'FS_IO_ERROR')
    }
    return super.writeText(target, content, expected, signal, sandboxPolicy)
  }

  /**
   * @param target - resolved target.
   * @param edit - literal edit request.
   * @param expected - version guard.
   * @param signal - cancellation.
   * @param sandboxPolicy - per-call policy the enforcing backend fences by.
   * @returns the enforcing backend's outcome.
   */
  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    this.edits.push(target.displayPath)
    return super.editText(target, edit, expected, signal, sandboxPolicy)
  }
}

/**
 * Mount the shipped sandbox-enforcing backend over a project-local root.
 * @param ctx - context to mount into; must already provide `sandboxPolicy`.
 * @param options - root and relative-path base.
 * @returns the mounted counting backend.
 */
export async function mountSandboxedFileSystem(
  ctx: Context,
  options: LocalFileSystemDoubleOptions,
): Promise<CountingSandboxedFileSystem> {
  // Load it as a plugin so its inherited `inject: ['sandboxPolicy']` is honored;
  // a direct construction cannot read an injected service.
  await ctx.plugin(CountingSandboxedFileSystem, { cwd: options.cwd ?? options.root })
  return ctx.fs as CountingSandboxedFileSystem
}

/** Deployment image limits a test may narrow. */
export interface AttachmentDoubleOptions {
  /** Override any of the shipped limit values. */
  readonly imageLimits?: Partial<ImageAttachmentLimits>
}

/** The mounted attachment store plus what it was asked to persist. */
export interface AttachmentDouble {
  /** The `AttachmentStore` a tool reads through `ctx.attachments`. */
  readonly store: AttachmentStore
  /** Every accepted image save, in call order (bytes copied on entry). */
  readonly saves: SaveImageAttachment[]
}

/** Limits used when a test does not narrow one. */
const DEFAULT_IMAGE_LIMITS: ImageAttachmentLimits = Object.freeze({
  maxImageBytes: 8 * 1024 * 1024,
  maxImagesPerMessage: 8,
  maxMessageImageBytes: 32 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  maxImageDimension: 8192,
  mediaTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const),
})

/**
 * Mount an `AttachmentStore` that validates and records images without touching
 * a disk. Durable storage is an external capability; the tool contract under
 * test is that it submits the file's real bytes and turns the returned
 * reference into an image block.
 * @param ctx - context to mount into.
 * @param options - narrowed deployment limits.
 * @returns the mounted store and its save log.
 */
export async function mountAttachmentDouble(
  ctx: Context,
  options: AttachmentDoubleOptions = {},
): Promise<AttachmentDouble> {
  let mounted: TestAttachmentStore | undefined
  await ctx.plugin((pluginCtx) => {
    mounted = new TestAttachmentStore(pluginCtx, { ...DEFAULT_IMAGE_LIMITS, ...options.imageLimits })
  })
  if (mounted === undefined) throw new Error('the attachment store did not mount')
  return { store: mounted, saves: mounted.saves }
}

/** In-memory attachment store; see {@link mountAttachmentDouble}. */
class TestAttachmentStore extends AttachmentStore {
  readonly saves: SaveImageAttachment[] = []
  readonly imageLimits: ImageAttachmentLimits

  /**
   * @param ctx - context the service registers into as `ctx.attachments`.
   * @param imageLimits - resolved deployment limits.
   */
  constructor(ctx: Context, imageLimits: ImageAttachmentLimits) {
    super(ctx)
    this.imageLimits = Object.freeze({ ...imageLimits })
  }

  /**
   * @param input - encoded bytes, declared media type and optional name.
   * @returns after the input passes every deployment check without persisting it.
   */
  override async validateImage(input: SaveImageAttachment): Promise<void> {
    this.validate(input)
  }

  /**
   * @param input - encoded bytes, declared media type and optional name.
   * @returns a durable-looking reference for the recorded bytes.
   */
  override async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const dimensions = this.validate(input)
    const save: SaveImageAttachment = {
      data: Uint8Array.from(input.data),
      mediaType: input.mediaType,
      ...(input.name === undefined ? {} : { name: input.name }),
    }
    this.saves.push(save)
    return {
      attachmentId: AttachmentId(`attachment-${this.saves.length}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      ...(input.name === undefined ? {} : { name: input.name }),
    }
  }

  /**
   * @param ref - durable reference to read.
   * @returns never; this double keeps no durable objects.
   */
  override async readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    throw new AttachmentError(`no stored image ${ref.attachmentId}`, 'ATTACHMENT_NOT_FOUND')
  }

  /**
   * Apply the deployment checks once for both validate and save.
   * @param input - encoded bytes and declared media type.
   * @returns the decoded dimensions.
   */
  private validate(input: SaveImageAttachment): { width: number; height: number } {
    if (!this.imageLimits.mediaTypes.includes(input.mediaType)) {
      throw new AttachmentError(`${input.mediaType} is not accepted`, 'UNSUPPORTED_IMAGE_TYPE')
    }
    if (input.data.byteLength > this.imageLimits.maxImageBytes) {
      throw new AttachmentError('image exceeds the deployment byte limit', 'IMAGE_TOO_LARGE')
    }
    const dimensions = imageDimensions(input.data, input.mediaType)
    if (dimensions === undefined) {
      throw new AttachmentError(`bytes do not decode as ${input.mediaType}`, 'INVALID_IMAGE')
    }
    if (
      dimensions.width > this.imageLimits.maxImageDimension ||
      dimensions.height > this.imageLimits.maxImageDimension
    ) {
      throw new AttachmentError('image side exceeds the deployment limit', 'IMAGE_DIMENSION_TOO_LARGE')
    }
    return dimensions
  }
}

/**
 * Validate one image signature and return its intrinsic dimensions.
 *
 * Only the formats the shipped attachment path accepts can be recognized; a
 * declared type whose bytes are something else is refused, matching the real
 * decoder's authority over the extension.
 * @param data - encoded image bytes.
 * @param mediaType - type the caller declared.
 * @returns width and height, or undefined when the bytes are not that format.
 */
function imageDimensions(data: Uint8Array, mediaType: ImageMediaType): { width: number; height: number } | undefined {
  const ascii = (offset: number, value: string): boolean => {
    if (data.byteLength < offset + value.length) return false
    for (let index = 0; index < value.length; index += 1) {
      if (data[offset + index] !== value.charCodeAt(index)) return false
    }
    return true
  }
  switch (mediaType) {
    case 'image/png': {
      if (data.byteLength < 24 || data[0] !== 0x89 || !ascii(1, 'PNG\r\n\u001a\n')) return undefined
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      return { width: view.getUint32(16), height: view.getUint32(20) }
    }
    case 'image/gif': {
      if (data.byteLength < 10 || !(ascii(0, 'GIF87a') || ascii(0, 'GIF89a'))) return undefined
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
    }
    case 'image/jpeg': {
      if (data.byteLength < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) return undefined
      return jpegDimensions(data)
    }
    case 'image/webp': {
      if (data.byteLength < 30 || !ascii(0, 'RIFF') || !ascii(8, 'WEBP') || !ascii(12, 'VP8')) return undefined
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      return ascii(12, 'VP8 ')
        ? { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
        : undefined
    }
  }
}

/** Scan JPEG segments for the first start-of-frame dimensions. */
function jpegDimensions(data: Uint8Array): { width: number; height: number } | undefined {
  let offset = 2
  while (offset + 9 <= data.byteLength) {
    if (data[offset] !== 0xff) return undefined
    const marker = data[offset + 1] ?? 0
    const length = ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: ((data[offset + 5] ?? 0) << 8) | (data[offset + 6] ?? 0),
        width: ((data[offset + 7] ?? 0) << 8) | (data[offset + 8] ?? 0),
      }
    }
    if (length < 2) return undefined
    offset += 2 + length
  }
  return undefined
}

/** The provider/model route a harness Agent requests, plus its declared modalities. */
export interface ModelRouteOptions {
  /** Provider route to register. */
  readonly provider: string
  /** Exact model id the Agent requests. */
  readonly model: string
  /** Declared input modalities; omission means "unknown", never "image". */
  readonly inputModalities?: readonly ModelModality[]
  /**
   * One controlled model stream. Omitted means the adapter refuses to stream:
   * route-metadata tests never reach a request.
   */
  readonly stream?: (options: GenerateOptions) => AsyncIterable<StreamChunk>
}

/**
 * Register one exact model route on the real `ctx.llm` registry.
 *
 * The image gate under test resolves capability through the shipped runtime, so
 * the test registers an adapter rather than stubbing `llm`. Streaming is never
 * reached: the route only serves metadata resolution.
 * @param ctx - context with the mounted `llm` service.
 * @param route - provider, model and declared modalities.
 */
export function mountModelRoute(ctx: Context, route: ModelRouteOptions): void {
  ctx.effect(
    () => ctx.llm.registerAdapter([route.provider], new ScriptedModelAdapter(route)),
    `test support: model route ${route.provider}/${route.model}`,
  )
}

/** Metadata-only adapter; see {@link mountModelRoute}. */
class ScriptedModelAdapter extends LlmAdapter {
  /**
   * @param route - the single exact route this adapter serves.
   */
  constructor(private readonly route: ModelRouteOptions) {
    super()
  }

  /**
   * @param provider - route being resolved.
   * @param model - exact model id.
   * @returns the declared metadata for this route.
   */
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (provider !== this.route.provider || model !== this.route.model) {
      throw new Error(`the scripted adapter does not serve ${provider}/${model}`)
    }
    return {
      provider,
      id: model,
      name: model,
      ...(this.route.inputModalities === undefined
        ? {}
        : { inputModalities: Object.freeze([...this.route.inputModalities]) }),
    }
  }

  /**
   * @param options - the assembled request the Agent loop would send.
   * @returns the case's controlled stream, or a refusal when none was supplied.
   */
  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    if (this.route.stream === undefined) throw new Error('the scripted model adapter never streams')
    yield* this.route.stream(options)
  }
}

/** Scripted answers for the two web capabilities. */
export interface WebDoubleOptions {
  /** Answer for `ctx.web.search`; defaults to no sources. */
  readonly search?: (request: WebSearchRequest, signal?: AbortSignal) => WebSearchResult | Promise<WebSearchResult>
  /** Answer for `ctx.web.fetch`; defaults to an empty text body with status 200. */
  readonly fetch?: (request: WebFetchRequest, signal?: AbortSignal) => WebFetchResult | Promise<WebFetchResult>
  /**
   * Register the scripted providers; defaults to true. `false` mounts the real
   * runtime with no provider at all, so provider-selection failures are the
   * shipped ones (`WEB_PROVIDER_UNAVAILABLE`) instead of a fake.
   */
  readonly registerProviders?: boolean
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
    async search(request, signal) {
      searches.push(request)
      return options.search === undefined ? { sources: [], truncated: false } : options.search(request, signal)
    },
  }
  const fetchProvider: WebFetchProvider = {
    id: WEB_DOUBLE_PROVIDER_ID,
    available: () => true,
    async fetch(request, signal) {
      fetches.push(request)
      return options.fetch === undefined
        ? { url: request.url, statusCode: 200, body: { kind: 'text', content: '' }, truncated: false }
        : options.fetch(request, signal)
    },
  }
  if (options.registerProviders !== false) {
    ctx.effect(() => runtime.registerSearchProvider(searchProvider), 'test support: search provider')
    ctx.effect(() => runtime.registerFetchProvider(fetchProvider), 'test support: fetch provider')
  }
  return { runtime, searches, fetches }
}

/** One recorded `ctx.sandbox.confine` call. */
export interface RecordedConfineCall {
  /** The full argv the executor asked to confine. */
  readonly argv: readonly string[]
  /** The per-call policy the executor resolved. */
  readonly policy: SandboxExecutionPolicy
}

/** How the recording sandbox provider wraps and classifies executions. */
export interface RecordingSandboxOptions {
  /** Enforcement completeness reported for every wrap; defaults to `partial`. */
  readonly enforcement?: SandboxEnforcement
  /** Prefix prepended to the caller argv; defaults to `nexus-sandbox --`. */
  readonly wrapper?: readonly string[]
  /** Denial dialect reported; defaults to `permission denied`. */
  readonly denialSignatures?: readonly string[]
  /** Runner-failure evidence rules; defaults to a `sandbox runner failed` signature. */
  readonly runnerFailureRules?: readonly RunnerFailureRule[]
  /** Fail every confine call with this error instead of wrapping. */
  readonly failWith?: Error
}

/**
 * Controlled `ctx.sandbox` provider that records the exact per-call policy.
 *
 * It implements the shipped `SandboxProvider` contract, so the executor's real
 * policy resolution and full-argv confinement path are exercised; only the
 * host-side runner is replaced.
 */
export class RecordingSandboxProvider extends SandboxProvider {
  /** Every confinement request, in call order. */
  readonly calls: RecordedConfineCall[] = []

  /**
   * @param ctx - context the service registers into as `ctx.sandbox`.
   * @param options - enforcement, wrapper and classification facts.
   */
  constructor(ctx: Context, private readonly options: RecordingSandboxOptions = {}) {
    super(ctx)
  }

  /**
   * @param argv - the full argv the executor is about to spawn.
   * @param policy - the resolved per-call policy.
   * @param _signal - cancellation of confinement preparation.
   * @returns the wrapped argv and the backend's classification facts.
   */
  async confine(argv: readonly string[], policy: SandboxPolicy, _signal?: AbortSignal): Promise<ConfinedArgv> {
    this.calls.push({ argv: [...argv], policy })
    if (this.options.failWith !== undefined) throw this.options.failWith
    return {
      argv: [...(this.options.wrapper ?? ['nexus-sandbox', '--']), ...argv],
      enforcement: this.options.enforcement ?? 'partial',
      denialSignatures: this.options.denialSignatures ?? ['permission denied'],
      runnerFailureRules: this.options.runnerFailureRules ?? [{ fatalSignatures: ['sandbox runner failed'] }],
    }
  }
}

/**
 * Mount a recording sandbox provider on a fresh context.
 * @param ctx - context to mount into (already providing `sandboxPolicy` if the test exercises confinement).
 * @param options - recorded wrap and classification facts.
 * @returns the provider and its call log.
 */
export async function mountRecordingSandbox(
  ctx: Context,
  options: RecordingSandboxOptions = {},
): Promise<RecordingSandboxProvider> {
  let mounted: RecordingSandboxProvider | undefined
  await ctx.plugin((pluginCtx) => {
    mounted = new RecordingSandboxProvider(pluginCtx, options)
  })
  if (mounted === undefined) throw new Error('the recording sandbox provider did not mount')
  return mounted
}

/** A raw-byte output reader with the provider's revocable spill-file behavior. */
export interface ScriptedOutputReader extends SubprocessOutputReader {
  /** Simulate the provider discarding its spill file (cap, write or seal failure). */
  withdrawSpill(): void
}

/**
 * In-memory output reader whose retained window can lose its head, mirroring
 * the real collector's Buffer slice + UTF-8 decode. Offsets are whole-stream
 * UTF-8 byte positions.
 *
 * A spill file exists only after a real overflow, exactly like the provider;
 * `withdrawSpill()` removes the path the way cap/write/seal revocation does.
 * @param text - complete captured stream text.
 * @param options - retained-window size and optional full-stream spill path.
 * @returns a non-consuming reader with the shipped offset contract.
 */
export function createScriptedOutputReader(
  text: string,
  options: { readonly memoryBytes?: number; readonly spillPath?: string } = {},
): ScriptedOutputReader {
  const bytes = Buffer.from(text, 'utf8')
  const memoryBytes = options.memoryBytes ?? bytes.length
  let spillActive = options.spillPath !== undefined && memoryBytes < bytes.length
  return {
    readFrom(fromByte) {
      const windowStart = Math.max(0, bytes.length - memoryBytes)
      const start = Math.max(fromByte, windowStart)
      return {
        text: bytes.subarray(start).toString('utf8'),
        nextOffset: bytes.length,
        lossy: fromByte < windowStart,
        ...(spillActive && options.spillPath !== undefined ? { spillPath: options.spillPath } : {}),
      }
    },
    withdrawSpill() {
      spillActive = false
    },
  }
}

/**
 * Raw-byte output reader for output that is not valid UTF-8.
 *
 * Same retained-window and spill contract as {@link createScriptedOutputReader},
 * but the bytes are decoded non-fatally exactly as the native collector does.
 * `totalBytes` lets an edge case report a whole-stream size larger than the
 * bytes kept here, for streams that crossed a provider cap.
 * @param bytes - raw capture bytes.
 * @param options - retained-window size, spill path and reported total.
 * @returns a non-consuming reader with the shipped offset contract.
 */
export function createScriptedRawOutputReader(
  bytes: Uint8Array,
  options: { readonly memoryBytes?: number; readonly spillPath?: string; readonly totalBytes?: number } = {},
): ScriptedOutputReader {
  const buffer = Buffer.from(bytes)
  const memoryBytes = options.memoryBytes ?? buffer.length
  const total = options.totalBytes ?? buffer.length
  let spillActive = options.spillPath !== undefined && memoryBytes < total
  return {
    readFrom(fromByte) {
      const windowStart = Math.max(0, total - memoryBytes)
      const start = Math.max(fromByte, windowStart)
      return {
        text: buffer.subarray(start).toString('utf8'),
        nextOffset: total,
        lossy: fromByte < windowStart,
        ...(spillActive && options.spillPath !== undefined ? { spillPath: options.spillPath } : {}),
      }
    },
    withdrawSpill() {
      spillActive = false
    },
  }
}

/** A live output reader that can grow and finish between reads. */
export interface ScriptedLiveOutputReader extends ScriptedOutputReader {
  /** Append the next raw bytes exactly as a pipe chunk would arrive. */
  append(data: Uint8Array | string): void
  /** Mark the stream complete: no further bytes will arrive. */
  end(): void
  /** Whether the stream has ended. */
  readonly complete: boolean
}

/**
 * Raw-byte live reader with the native collector's growing-window semantics.
 *
 * `readFrom` concatenates the retained chunks and decodes the requested byte
 * suffix, exactly like `OutputCollector`, so a chunk split inside a UTF-8
 * character is observable as a trailing U+FFFD until the next append. The
 * caller controls the output-completion fact through {@link complete}.
 * @param initial - first raw bytes (string is encoded as UTF-8).
 * @param options - retained-window size and optional spill path.
 * @returns a non-consuming live reader.
 */
export function createScriptedLiveOutputReader(
  initial: Uint8Array | string = '',
  options: { readonly memoryBytes?: number; readonly spillPath?: string } = {},
): ScriptedLiveOutputReader {
  const chunks: Buffer[] = []
  const maxBytes = options.memoryBytes ?? Number.POSITIVE_INFINITY
  let retainedBytes = 0
  let total = 0
  let spillActive = false
  let complete = false
  const push = (data: Uint8Array | string): void => {
    const chunk = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data)
    total += chunk.length
    retainedBytes += chunk.length
    chunks.push(chunk)
    let overflowed = false
    while (retainedBytes > maxBytes) {
      const head = chunks[0]
      if (head === undefined) break
      const excess = retainedBytes - maxBytes
      if (head.length <= excess) {
        chunks.shift()
        retainedBytes -= head.length
      } else {
        chunks[0] = head.subarray(excess)
        retainedBytes -= excess
      }
      overflowed = true
    }
    if (overflowed && options.spillPath !== undefined) spillActive = true
  }
  push(initial)
  return {
    readFrom(fromByte) {
      const buffer = Buffer.concat(chunks)
      const windowStart = total - retainedBytes
      const lossy = fromByte < windowStart
      const start = Math.max(fromByte, windowStart)
      return {
        text: buffer.subarray(start - windowStart).toString('utf8'),
        nextOffset: total,
        lossy,
        ...(spillActive && options.spillPath !== undefined ? { spillPath: options.spillPath } : {}),
      }
    },
    withdrawSpill() {
      spillActive = false
    },
    append(data) {
      if (complete) throw new Error('cannot append to a completed scripted live output')
      push(data)
    },
    end() {
      complete = true
    },
    get complete() {
      return complete
    },
  }
}

/** What a scripted process or terminal does. */
export interface ScriptedProcessScript {
  /** Text captured on stdout. */
  readonly stdout?: string
  /** Text captured on stderr. */
  readonly stderr?: string
  /**
   * The collected readers to expose instead of synthesizing them from the
   * text. Used when a case needs a real spill file or raw non-UTF-8 bytes.
   */
  readonly readers?: {
    readonly stdout?: SubprocessOutputReader
    readonly stderr?: SubprocessOutputReader
  }
  /** Exit code; `null` means it died by signal. Defaults to 0. */
  readonly exitCode?: number | null
  /** Terminating signal reported by `done`. */
  readonly signal?: NodeJS.Signals | null
  /** Keep the process alive until `terminate()` is called. */
  readonly staysOpen?: boolean
  /** Reject `done` instead of reporting an outcome, simulating a provider failure. */
  readonly doneError?: Error
  /**
   * `waitForExit` can never prove the managed range empty. A function makes the
   * fact mutable, so a case can retry cleanup after the first attempt failed.
   */
  readonly cleanupUnconfirmed?: boolean | (() => boolean)
  /**
   * Ignore `terminate()`: the parent outcome never settles and the range never
   * clears, which is the provider-hang shape the consumer must bound.
   */
  readonly ignoreTerminate?: boolean
  /**
   * Delay the provider's termination settlement by this many milliseconds so a
   * bounded stop/guard can settle before native cleanup is confirmed.
   */
  readonly terminateDelayMs?: number
  /**
   * The parent exits normally but the managed range keeps a survivor until
   * `terminate()`; this is the live-grandchild shape.
   */
  readonly survivingRange?: boolean
}

/** How the subprocess double answers a spawn request. */
export interface SubprocessDoubleOptions {
  /** Script for one spawn; defaults to a clean, immediately finished process. */
  readonly script?: (spec: SubprocessSpawnSpec) => ScriptedProcessScript
  /** Script for one terminal spawn; defaults to a clean, immediately finished session. */
  readonly terminalScript?: (spec: SubprocessTerminalSpawnSpec) => ScriptedProcessScript
  /** Awaited by `resolveExecutable`; lets a case keep a start pending deterministically. */
  readonly beforeResolveExecutable?: (command: string) => Promise<void> | void
  /** Refuse every ordinary spawn with this error instead of publishing a handle. */
  readonly failSpawnWith?: Error
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
    await this.options.beforeResolveExecutable?.(command)
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
    if (this.options.failSpawnWith !== undefined) throw this.options.failSpawnWith
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
  /** How many times the provider's only termination verb was invoked. */
  terminateCalls = 0
  private settle!: (outcome: SubprocessOutcome) => void
  private finished = false
  private rangeEmpty: boolean
  private readonly staysOpen: boolean
  private readonly cleanupUnconfirmed: boolean | (() => boolean)
  private readonly ignoreTerminate: boolean
  private readonly terminateDelayMs: number | undefined
  private readonly survivingRange: boolean
  private terminateScheduled = false
  private rangeWaiters: Array<() => void> = []

  /**
   * @param spec - the spawn request whose stdio disposition decides which members exist.
   * @param script - output text and exit facts.
   */
  constructor(spec: SubprocessSpawnSpec, script: ScriptedProcessScript) {
    const stdoutText = script.stdout ?? ''
    const stderrText = script.stderr ?? ''
    this.staysOpen = script.staysOpen === true
    this.cleanupUnconfirmed = script.cleanupUnconfirmed ?? false
    this.ignoreTerminate = script.ignoreTerminate === true
    this.terminateDelayMs = script.terminateDelayMs
    this.survivingRange = script.survivingRange === true
    this.rangeEmpty = !this.survivingRange
    this.stdin = spec.stdio.stdin === 'pipe' ? new PassThrough() : undefined
    this.stdout = spec.stdio.stdout === 'pipe' ? Readable.from([stdoutText]) : undefined
    this.stderr = spec.stdio.stderr === 'pipe' ? Readable.from([stderrText]) : undefined
    this.control = spec.stdio.control === 'pipe' ? new PassThrough() : undefined
    const readers = script.readers
    this.collected = readers !== undefined
      ? {
          ...(readers.stdout === undefined ? {} : { stdout: readers.stdout }),
          ...(readers.stderr === undefined ? {} : { stderr: readers.stderr }),
        }
      : {
          ...(typeof spec.stdio.stdout === 'object' ? { stdout: createCollectReader(stdoutText) } : {}),
          ...(typeof spec.stdio.stderr === 'object' ? { stderr: createCollectReader(stderrText) } : {}),
        }
    if (script.doneError !== undefined) {
      this.finished = true
      const rejected = Promise.reject<SubprocessOutcome>(script.doneError)
      // The consumer always attaches a handler in the same turn; this keeps a
      // test that inspects the double from producing an unhandled rejection.
      rejected.catch(() => undefined)
      this.done = rejected
    } else {
      this.done = new Promise<SubprocessOutcome>((resolve) => {
        this.settle = resolve
      })
      if (!this.staysOpen) {
        this.finished = true
        this.settle({ exitCode: script.exitCode === undefined ? 0 : script.exitCode, signal: script.signal ?? null })
      }
    }
    spec.signal?.addEventListener('abort', () => this.terminate(), { once: true })
  }

  /** End the parent process and, when it owns one, the managed range. */
  terminate(): void {
    this.terminateCalls += 1
    if (this.ignoreTerminate) return
    if (this.survivingRange) {
      this.rangeEmpty = true
      for (const wake of this.rangeWaiters.splice(0)) wake()
    }
    if (this.finished) return
    if (this.terminateDelayMs !== undefined) {
      if (this.terminateScheduled) return
      this.terminateScheduled = true
      const timer = setTimeout(() => {
        this.terminateScheduled = false
        if (this.finished) return
        this.finished = true
        this.settle({ exitCode: null, signal: 'SIGTERM' })
      }, this.terminateDelayMs)
      timer.unref()
      return
    }
    this.finished = true
    this.settle({ exitCode: null, signal: 'SIGTERM' })
  }

  /**
   * @param signal - optional bound on the wait.
   * @returns whether the managed range is empty before the bound aborted.
   */
  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    if (this.cleanupUnconfirmedNow()) return false
    if (signal?.aborted === true) return false
    if (this.survivingRange && !this.rangeEmpty) {
      await waitForSignal(this.rangeWaiters, signal)
      return this.rangeEmpty
    }
    await this.done.then(
      () => undefined,
      () => undefined,
    )
    return true
  }

  /** Resolve the mutable cleanup fact for one attempt. */
  private cleanupUnconfirmedNow(): boolean {
    return typeof this.cleanupUnconfirmed === 'function' ? this.cleanupUnconfirmed() : this.cleanupUnconfirmed
  }
}

/** Wait until a double's range clears or the caller's bound aborts. */
function waitForSignal(waiters: Array<() => void>, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    waiters.push(resolve)
    signal?.addEventListener('abort', () => resolve(), { once: true })
  })
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
      this.settle({ exitCode: script.exitCode === undefined ? 0 : script.exitCode, signal: script.signal ?? null })
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

/**
 * How a store fixture attaches to a case.
 */
export interface NexusStoreFixtureOptions {
  /**
   * Mount on an existing context instead of a fresh one. The caller keeps
   * ownership of that context (a lifecycle case needs the real native stack on
   * the same context); disposal then only removes the medium this fixture made.
   */
  readonly ctx?: Context
  /**
   * Reuse an existing medium root instead of creating a temporary one. A restart
   * case opens a second context over the same medium; the owner deletes it.
   */
  readonly root?: string
}

/** One held medium write and the handles that open it again. */
export interface MediumHold {
  /** Resolves once the next write into the table reached the hold. */
  waitUntilHeld(): Promise<void>
  /** Let the held write proceed to the medium. */
  release(): void
}

/** A real Nexus storage stack over a controllable project-local medium. */
export interface NexusStoreFixture {
  /** Project-local medium root the fixture uses. */
  readonly root: string
  /**
   * Open the Nexus store; call again after disposing the previous store to
   * prove that a cold reopen reads the same durable records.
   * @returns the opened store.
   */
  open(): Promise<NexusStore>
  /** Every durable record write that reached the medium, as `table/key`. */
  listWrites(): readonly string[]
  /**
   * Refuse the next record write into `table` before it reaches the medium.
   * @param table - table whose next write fails.
   */
  failNextPut(table: string): void
  /**
   * Refuse the next record delete from `table` before it reaches the medium.
   * @param table - table whose next delete fails.
   */
  failNextDelete(table: string): void
  /**
   * Hold the next record write into `table` before it reaches the medium.
   * @param table - table whose next write is held.
   * @returns the hold; nothing reaches the medium until it is released.
   */
  holdNextPut(table: string): MediumHold
  /**
   * Read the raw unit document the medium holds.
   * @returns the document text.
   */
  readMedium(): Promise<string>
  /** Dispose the storage context and delete the temporary root. */
  dispose(): Promise<void>
}

/** Project-local cache directory; the medium never touches state outside the checkout. */
const STORE_FIXTURE_CACHE = fileURLToPath(new URL('../../node_modules/.cache/dsh-nexus-test/', import.meta.url))

/**
 * Mount the shipped storage hub, the shipped JSON backend and the Nexus domain
 * form over a project-local medium root.
 *
 * Web acquisition tests need a medium that really persists and really reopens,
 * so this fixture mounts the production stack instead of an in-memory map. The
 * only instrumented piece is the medium boundary, which can refuse or hold the
 * next write or delete of one table so a test can prove what a refused durable
 * change leaves behind.
 *
 * A lifecycle case passes its own context so the runtime, the real native Agent
 * stack and the medium share one scope, and passes the medium root when it needs
 * a second context over the same records (a restart).
 * @param options - context and medium root to reuse; both default to fresh ones.
 * @returns the fixture over the medium root.
 */
export async function mountNexusStoreFixture(options: NexusStoreFixtureOptions = {}): Promise<NexusStoreFixture> {
  await mkdir(STORE_FIXTURE_CACHE, { recursive: true })
  const ownedRoot = options.root === undefined
  const root = options.root ?? (await mkdtemp(join(STORE_FIXTURE_CACHE, 'web-')))
  const ownedCtx = options.ctx === undefined
  const ctx = options.ctx ?? new Context()
  await ctx.plugin(Storage)
  const inner = new JsonStorageBackend(root)
  const innerKv: KvFacet = inner.kv
  const writes: string[] = []
  let failingPut: string | undefined
  let failingDelete: string | undefined
  // The JSON medium rewrites one document through a temp-file rename, and
  // Windows refuses that rename while another handle is mid-replace. Sibling
  // records of one fixture therefore queue behind each other instead of racing.
  let mediumQueue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mediumQueue.then(operation, operation)
    mediumQueue = next.catch(() => undefined)
    return next
  }
  let heldTable: string | undefined
  let announceHeld: (() => void) | undefined
  let openHold: (() => void) | undefined
  const heldWrite = async (table: string): Promise<void> => {
    if (heldTable !== table) return
    heldTable = undefined
    await new Promise<void>((resolve) => {
      openHold = resolve
      announceHeld?.()
      announceHeld = undefined
    })
  }
  const kv: KvFacet = {
    async open(descriptor: KvUnitDescriptor): Promise<KvUnit> {
      const unit = await innerKv.open(descriptor)
      return {
        loadAll: () => unit.loadAll(),
        putRecord(table, key, value) {
          return serialized(async () => {
            if (failingPut === table) {
              failingPut = undefined
              throw new Error(`the medium refused the write of '${table}/${key}'`)
            }
            await heldWrite(table)
            await unit.putRecord(table, key, value)
            writes.push(`${table}/${key}`)
          })
        },
        deleteRecord(table, key) {
          return serialized(async () => {
            if (failingDelete === table) {
              failingDelete = undefined
              throw new Error(`the medium refused the delete of '${table}/${key}'`)
            }
            return unit.deleteRecord(table, key)
          })
        },
        setGlobal: (value) => unit.setGlobal(value),
        close: () => unit.close(),
      }
    },
  }
  const backend: StorageBackend = { kv, close: () => inner.close() }
  await ctx.plugin({
    name: 'nexus-fixture-json',
    inject: ['storage'],
    apply(pluginCtx: Context) {
      pluginCtx.effect(() => {
        const unregister = pluginCtx.storage.backend.register('json', backend)
        return async () => {
          unregister()
          await backend.close()
        }
      })
      pluginCtx.provide(storageBackendServiceKey('json'), backend)
    },
  })
  await ctx.plugin(StorageDomain, { backend: 'json' })

  return {
    root,
    open: () => openNexusStore(ctx),
    listWrites: () => [...writes],
    failNextPut(table) {
      failingPut = table
    },
    failNextDelete(table) {
      failingDelete = table
    },
    holdNextPut(table) {
      heldTable = table
      return {
        waitUntilHeld() {
          return new Promise<void>((resolve) => {
            announceHeld = resolve
          })
        },
        release() {
          openHold?.()
          openHold = undefined
        },
      }
    },
    readMedium: () => readFile(join(root, `${NEXUS_DOMAIN_NAME}.json`), 'utf8'),
    async dispose() {
      openHold?.()
      openHold = undefined
      if (ownedCtx) await ctx.fiber.dispose()
      if (ownedRoot) await rm(root, { recursive: true, force: true })
    },
  }
}
