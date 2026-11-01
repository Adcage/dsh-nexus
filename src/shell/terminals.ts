/**
 * Native persistent-terminal ownership for the Nexus shell surface.
 *
 * The native terminal registry (`ctx.terminals`) owns PTY identity, publication,
 * per-owner cleanup and the interactive send/read/signal mechanics. This module
 * adds exactly two things on top of it:
 *
 * - {@link registerTerminalBackends} mounts the shipped `BashTerminalBackend`
 *   once per dialect (`bash`, `pwsh`) under Nexus-owned backend types.
 *   Registration is lazy: no executable is resolved until the first open of that
 *   dialect, so a composition can mount both dialects on a machine that has only
 *   one of them. The selected engine is resolved again for every open, so a
 *   changed setting affects later terminals and never redirects a live one. An
 *   engine that cannot be resolved fails that open with `SHELL_UNAVAILABLE`; it
 *   never falls back to the other dialect.
 * - {@link createTerminalController} is the host-only adapter the shell tool maps
 *   its validated arguments onto. It mints Nexus resource ids
 *   (`nexus-term-<controller-epoch>-<n>`, never the native PTY id), enforces the
 *   per-Agent terminal cap and fences every operation with the caller's exact
 *   live Agent instance. The epoch makes a reopened controller mint fresh ids, so
 *   an id remembered from an earlier controller generation cannot address a new
 *   terminal merely because the ordinal counter restarted.
 *
 * Resource families stay separate: a background-process `resourceId` is a native
 * job id, a terminal `resourceId` is a Nexus-minted terminal id, and neither a
 * native PTY id nor a matching session id authorises any operation. The shell
 * tool must route a resource id only to the controller that minted it.
 *
 * The terminal's own `cd`, exported variables and shell functions live inside the
 * PTY and persist natively; sending that text never changes the DSH session's
 * working directory.
 *
 * @module dsh-nexus/shell/terminals
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  TerminalBackendCleanupError,
  TerminalError,
  type TerminalBackend,
  type TerminalBackendSession,
  type TerminalBackendSpawnSpec,
  type TerminalReadResult,
  type TerminalSendOperation,
  type TerminalSessionId,
  type TerminalSessionService,
  type TerminalSessionSnapshot,
  type TerminalSessionStatus,
  type TerminalSpawnResult,
  type TerminalWaitReason,
} from '@deepseek-ai/dsh-terminal'
import { BashTerminalBackend, Config as TerminalBackendSchema } from '@deepseek-ai/dsh-terminal-bash'
import type { ShellEngine } from '../protocol.ts'
import { WAIT_DEFAULT_MS, WAIT_MAX_MS, AGENT_MAX_TERMINALS } from '../runtime/defaults.ts'
import { NexusError } from '../runtime/errors.ts'
import type { CallOwner } from '../runtime/owner.ts'
import type { ManagedCleanupState, ManagedRangeUnresolved } from '../agent/coordination.ts'
import { managedCleanupStateOf } from '../agent/coordination.ts'
import { resolveEngine, resolveShellCwd, type ShellExecutionConfig } from './engines.ts'
import { assertPowerShell7 } from './process.ts'

/** Prefix of every Nexus-minted terminal resource id. */
export const TERMINAL_RESOURCE_PREFIX = 'nexus-term-'

/** Native backend type that runs the `bash` dialect. */
export const TERMINAL_BACKEND_BASH = 'nexus-bash'

/** Native backend type that runs the `pwsh` dialect. */
export const TERMINAL_BACKEND_PWSH = 'nexus-pwsh'

/** Dialects this module registers, in registration order. */
const DIALECTS: readonly ShellEngine[] = ['bash', 'pwsh']

/**
 * Interactive argv defaults each dialect documents. The backend's own
 * `resolveConfig` turns an empty array into these; this module builds the
 * resolved shape directly, so it must spell them out and keep them in step.
 */
const INTERACTIVE_SHELL_ARGS: Record<ShellEngine, readonly string[]> = {
  bash: ['--noprofile', '--norc', '-i'],
  pwsh: ['-NoLogo', '-NoProfile'],
}

/**
 * The resolved configuration type of the native backend constructor. Derived
 * from the public constructor so a change upstream is a compile error here
 * instead of a silently wrong shape.
 */
export type NativeTerminalConfig = ConstructorParameters<typeof BashTerminalBackend>[1]

/**
 * Schemastery defaults of the shipped backend (rows, cols, scrollback, read and
 * readiness bounds). Taking them from the public schema keeps one source of
 * truth for the numbers; this module overrides only the dialect fields.
 */
const NATIVE_DEFAULTS = TerminalBackendSchema({}) as unknown as NativeTerminalConfig

/** Lines one terminal read returns when the call names no limit. */
const TERMINAL_READ_DEFAULT_LINES = 200

/** Largest line count one terminal read accepts; native byte bounds still apply. */
const TERMINAL_READ_MAX_LINES = 1_000

/** How often a wait without an active send re-reads the native session status. */
const TERMINAL_STATUS_POLL_MS = 50

/** Cursor envelope prefix, versioned so an incompatible cursor is rejected. */
const TERMINAL_CURSOR_PREFIX = 'nxterm1.'

/** Why one continuation page could not be mapped onto the cursor's window. */
export type TerminalLossReason = 'shifted' | 'evicted'

/** Native-backed view of one owned terminal. */
export interface TerminalView {
  /** Nexus-minted resource id; never the native PTY id. */
  readonly resourceId: string
  /** Resource family, kept separate from background-process resources. */
  readonly kind: 'terminal'
  /** Dialect of the shell this terminal runs. */
  readonly engine: ShellEngine
  /** Owner-local display name, when the open request carried one. */
  readonly name?: string
  /** Top-level terminal process id, when the backend reports one. */
  readonly pid?: number
  /**
   * Last observed top-level status; `exited` is not cleanup proof, and a closed
   * terminal keeps its final observation.
   */
  readonly sessionStatus: TerminalSessionStatus
  /** A close was requested and native cleanup is still unconfirmed. */
  readonly cleanupUnconfirmed: boolean
}

/** One validated open request. */
export interface TerminalOpenRequest {
  /** Dialect to start; defaults to the stored terminal engine. */
  readonly engine?: ShellEngine
  /** Absolute initial working directory; omitted means the owner's session directory. */
  readonly cwd?: string
  /** Owner-local display name. */
  readonly name?: string
}

/** Result of one successful open. */
export interface TerminalOpenResult {
  /** The published terminal. */
  readonly terminal: TerminalView
  /** Bounded initial output the backend captured before publication. */
  readonly motd: string
}

/** Text one caller wants written to a terminal. */
export interface TerminalSendRequest {
  /** Raw text written verbatim; never trimmed, quoted or line-split. */
  readonly text: string
  /** Append the backend's Enter sequence; defaults to `true`. */
  readonly submit?: boolean
}

/** Result of one settled send. */
export interface TerminalSendResult {
  /** The terminal after settlement. */
  readonly terminal: TerminalView
  /** Bounded rendered terminal delta remaining at settlement. */
  readonly text: string
  /** Why control returned; not proof that an arbitrary child command exited. */
  readonly waitReason: TerminalWaitReason
  /** Top-level session status observed at settlement. */
  readonly sessionStatus: TerminalSessionStatus
  /** Output was dropped from the operation or the retained scrollback. */
  readonly truncated: boolean
  /** The call was cancelled; the native send interrupted the foreground command. */
  readonly cancelled: boolean
}

/**
 * One bounded scrollback page of the native retained window.
 *
 * An empty page means nothing is retained at that position yet, never that the
 * terminal or a command finished; read {@link sessionStatus} or
 * {@link TerminalStatusResult} for lifecycle truth.
 */
export interface TerminalPage {
  /** Chronological text of the returned retained lines. */
  readonly text: string
  /** Retained line count when the page was read. */
  readonly totalLines: number
  /** Inclusive newest-relative offset where this page starts (its newest line). */
  readonly lineBegin: number
  /** Exclusive newest-relative offset after the page; also the older-page continuation offset. */
  readonly lineEnd: number
  /** Retained output was dropped, or the page hit a native byte bound. */
  readonly truncated: boolean
  /** Retained lines older than this page still exist. */
  readonly hasOlder: boolean
  /** This page is not provably the exact continuation the cursor described. */
  readonly lossy: boolean
  /** Why the continuation is not exact, when the controller can name it. */
  readonly lossReason?: TerminalLossReason
  /** Opaque continuation cursor for the next older page; absent when nothing older is retained. */
  readonly cursor?: string
}

/** Result of one status query. */
export interface TerminalStatusResult {
  /** The terminal's current view. */
  readonly terminal: TerminalView
  /** A send started through this controller is still running. */
  readonly busy: boolean
}

/** Result of one bounded wait. A timeout only ends the wait. */
export interface TerminalWaitResult {
  /** The terminal's current view. */
  readonly terminal: TerminalView
  /** The wait bound (or the caller's cancellation) ended the wait before the interaction settled. */
  readonly timedOut: boolean
  /** Native wait reason: `stdin_read`, `inferred_idle`, `timeout` or `session_exit`. */
  readonly waitReason: TerminalWaitReason
  /** Top-level session status; `exited` alone is not cleanup proof. */
  readonly sessionStatus: TerminalSessionStatus
}

/** Result of one interrupt request. */
export interface TerminalStopResult {
  /** The terminal's current view; it stays open unless a close follows. */
  readonly terminal: TerminalView
  /** The backend delivered the interrupt to the verified foreground group. */
  readonly interrupted: boolean
  /** Foreground process group that received the signal. */
  readonly targetPgid?: number
  /** Why the interrupt was not delivered, when it was not. */
  readonly detail?: string
}

/** Result of one close request. */
export interface TerminalCloseResult {
  /** The terminal's last observed view; `closed` is the authority on cleanup. */
  readonly terminal: TerminalView
  /** True only after native cleanup was confirmed. */
  readonly closed: boolean
  /** Why the terminal stayed owned, when it did. */
  readonly reason?: 'cleanup-unconfirmed'
  /** Native failure detail for a retained terminal. */
  readonly detail?: string
}

/** One terminal the controller could not close during disposal. */
export interface TerminalDisposeFailure {
  /** Terminal that stayed owned. */
  readonly resourceId: string
  /** Its view proving why it stayed. */
  readonly terminal: TerminalView
  /** Native cleanup was not confirmed. */
  readonly reason: 'cleanup-unconfirmed'
  /** Native failure detail. */
  readonly detail?: string
}

/** Outcome of controller disposal. */
export interface TerminalDisposeResult {
  /** Terminals whose cleanup was confirmed and that are no longer owned. */
  readonly cleared: readonly string[]
  /** Terminals that stayed owned because cleanup was not confirmed. */
  readonly failures: readonly TerminalDisposeFailure[]
}

/**
 * Host-only persistent-terminal controller.
 *
 * The shell tool maps validated model arguments onto these methods; no method
 * accepts a native PTY id, a handle or a model-supplied environment. Every method
 * requires the caller's exact live Agent and only sees terminals that same Agent
 * opened through this controller.
 */
export interface TerminalController {
  /**
   * Open one terminal and publish it in the native registry.
   * @param owner - exact caller identity; its signal cancels unpublished setup.
   * @param request - validated dialect, absolute cwd and display name.
   * @returns the published terminal and its initial bounded output.
   * @throws NexusError for missing authority/service, invalid input, cancellation or a failed start.
   */
  open(owner: CallOwner, request?: TerminalOpenRequest): Promise<TerminalOpenResult>
  /**
   * Write raw text to one owned terminal and await the native interaction result.
   * @param owner - exact caller identity; its signal interrupts the foreground command.
   * @param resourceId - terminal id minted by {@link open}.
   * @param request - raw text and whether to append Enter (default `true`).
   * @returns the bounded settlement viewport and the native wait reason.
   * @throws TerminalError `SEND_ACTIVE` when the terminal already has a running send.
   */
  send(owner: CallOwner, resourceId: string, request: TerminalSendRequest): Promise<TerminalSendResult>
  /**
   * Read one bounded page of retained scrollback without consuming it.
   * @param owner - exact caller identity.
   * @param resourceId - terminal id minted by {@link open}.
   * @param cursor - opaque continuation cursor from the previous page; omitted reads the newest page.
   * @param limit - requested line count; clamped to 1 000 lines and native byte bounds.
   * @returns the page, its real native range and the next older-page cursor.
   */
  read(owner: CallOwner, resourceId: string, cursor?: string, limit?: number): TerminalPage
  /**
   * Describe one owned terminal without changing it.
   * @param owner - exact caller identity.
   * @param resourceId - terminal id minted by {@link open}.
   * @returns the current view and whether a send is running.
   */
  status(owner: CallOwner, resourceId: string): TerminalStatusResult
  /**
   * Wait for the running send or the top-level session, without cancelling either.
   * @param owner - exact caller identity; its signal ends the wait without an interrupt.
   * @param resourceId - terminal id minted by {@link open}.
   * @param timeoutMs - wait bound; defaults to 1 000 ms and is capped at 30 000 ms.
   * @returns the native wait reason and whether the bound elapsed first.
   */
  wait(owner: CallOwner, resourceId: string, timeoutMs?: number): Promise<TerminalWaitResult>
  /**
   * Interrupt the verified foreground process group; the terminal stays open.
   * @param owner - exact caller identity.
   * @param resourceId - terminal id minted by {@link open}.
   * @returns whether the interrupt was delivered and to which group.
   */
  stop(owner: CallOwner, resourceId: string): Promise<TerminalStopResult>
  /**
   * Close the whole terminal and forget it only after confirmed cleanup.
   * @param owner - exact caller identity.
   * @param resourceId - terminal id minted by {@link open}.
   * @returns whether it was closed, or the truthful reason it stayed owned.
   */
  close(owner: CallOwner, resourceId: string): Promise<TerminalCloseResult>
  /**
   * List this Agent's owned terminals in open order.
   * @param owner - exact caller identity.
   * @returns the owned terminal views.
   */
  list(owner: CallOwner): readonly TerminalView[]
  /**
   * Close every terminal this controller opened; failures stay visible.
   * @returns the terminals cleared and the ones retained with their proof.
   */
  dispose(): Promise<TerminalDisposeResult>
  /**
   * The managed-range cleanup fact for one exact Agent.
   * @param agent - the Agent whose terminals are queried.
   * @returns `clean` only when every terminal is confirmed closed.
   */
  cleanupOf(agent: Agent): ManagedCleanupState
  /**
   * Every terminal range this controller cannot prove closed.
   * @returns one entry per pending open or unconfirmed terminal, with its Agent.
   */
  unresolved(): readonly ManagedRangeUnresolved[]
}

/**
 * Resolve the native backend type for one dialect.
 * @param engine - shell dialect.
 * @returns the registered backend type.
 */
export function terminalBackendType(engine: ShellEngine): string {
  return engine === 'pwsh' ? TERMINAL_BACKEND_PWSH : TERMINAL_BACKEND_BASH
}

/**
 * Build the complete resolved configuration the native backend constructor takes.
 *
 * The numeric bounds come from the backend's own public schema; only the dialect
 * fields and the type are set here, so this package never invents a second set of
 * terminal defaults.
 * @param engine - shell dialect.
 * @param executable - absolute interactive shell path.
 * @returns the resolved native configuration.
 */
export function resolveNativeTerminalConfig(engine: ShellEngine, executable: string): NativeTerminalConfig {
  return {
    ...NATIVE_DEFAULTS,
    backendType: terminalBackendType(engine),
    shellDialect: engine,
    shellPath: executable,
    shellArgs: [...INTERACTIVE_SHELL_ARGS[engine]],
  }
}

/**
 * Construct the real native shell backend for one dialect.
 * @param ctx - host context providing the subprocess, sandbox and directory seams.
 * @param engine - shell dialect.
 * @param executable - absolute interactive shell path.
 * @returns the native backend instance.
 */
export function createNativeTerminalBackend(
  ctx: Context,
  engine: ShellEngine,
  executable: string,
): TerminalBackend {
  return new BashTerminalBackend(ctx, resolveNativeTerminalConfig(engine, executable))
}

/**
 * Register the native bash/pwsh backends under the Nexus backend types.
 *
 * Registration is lazy in two ways: it waits for the terminal service to be
 * mounted, and it resolves no executable until a terminal of that dialect is
 * opened. The returned disposer removes exactly this contribution and is
 * idempotent; the native registry rejects a second registration of the same type.
 * @param ctx - registration scope.
 * @param config - current deployment and terminal settings, read on every open.
 * @returns disposer removing exactly this registration.
 */
export function registerTerminalBackends(ctx: Context, config: () => ShellExecutionConfig): () => void {
  const fiber = ctx.inject(['terminals'], (terminalCtx) => {
    const terminals = terminalCtx.get('terminals')
    if (terminals === undefined) return
    for (const engine of DIALECTS) {
      terminals.registerBackend(new LazyDialectBackend(terminalCtx, engine, config))
    }
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    void fiber.dispose()
  }
}

/**
 * One dialect backend that resolves its executable on every open.
 *
 * A fresh native backend is built per spawn, so a changed setting is picked up
 * by the next open and no live terminal is redirected.
 */
class LazyDialectBackend implements TerminalBackend {
  readonly type: string

  /**
   * @param ctx - host context the native backend runs in.
   * @param engine - dialect this backend serves.
   * @param config - current deployment and terminal settings.
   */
  constructor(
    private readonly ctx: Context,
    private readonly engine: ShellEngine,
    private readonly config: () => ShellExecutionConfig,
  ) {
    this.type = terminalBackendType(engine)
  }

  async spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession> {
    const resolved = await resolveEngine(this.engine, this.config())
    if (this.engine === 'pwsh') {
      // The native backend trusts its configured executable; PowerShell 7 is a
      // Nexus requirement, so an incompatible explicit path is rejected before
      // any persistent PTY exists.
      const subprocess = this.ctx.get('subprocess')
      if (subprocess === undefined) {
        throw new NexusError(
          'SHELL_UNAVAILABLE',
          'verifying PowerShell 7 requires the native ctx.subprocess service',
        )
      }
      const signal = spec.signal ?? new AbortController().signal
      const cwd = await resolveShellCwd(this.ctx, spec.owner, spec.cwd, signal)
      await assertPowerShell7(subprocess, resolved, resolved.executable, cwd, signal)
    }
    return createNativeTerminalBackend(this.ctx, this.engine, resolved.executable).spawn(spec)
  }
}

/** How one terminal controller is constructed. */
export interface TerminalControllerOptions {
  /**
   * Register the unload effect that disposes the controller, default true.
   *
   * A composition that must read the cleanup report itself passes `false` and
   * disposes through its own ordered seam, so one owner reports the truth once.
   */
  readonly disposeOnUnload?: boolean
}

/**
 * Build the host-only terminal controller.
 * @param ctx - host context providing the native terminal registry.
 * @param config - current deployment and terminal settings.
 * @param options - whether this controller owns its own unload disposal.
 * @returns the controller the shell tool calls.
 */
export function createTerminalController(
  ctx: Context,
  config: () => ShellExecutionConfig,
  options: TerminalControllerOptions = {},
): TerminalController {
  const controller = new Controller(ctx, config)
  if (options.disposeOnUnload !== false) registerTerminalDisposal(ctx, controller)
  return controller
}

/**
 * Attach the unload effect that disposes one terminal controller.
 * @param ctx - context owning the effect.
 * @param controller - the controller to dispose on unload.
 */
export function registerTerminalDisposal(ctx: Context, controller: TerminalController): void {
  ctx.effect(() => async () => {
    await controller.dispose()
  }, 'dsh-nexus shell terminal controller')
}

/** One Agent's pending opens and live terminals. */
interface AgentState {
  readonly terminals: Map<string, OwnedTerminal>
  /** Opens that have not published yet; they count against the cap. */
  pending: number
}

/** One terminal this controller opened. */
class OwnedTerminal {
  /** A close was attempted and native cleanup is unconfirmed. */
  cleanupUnconfirmed = false
  /** The send started through this controller that is still running. */
  active: TerminalSendOperation | undefined
  /** Last native snapshot observed for this terminal. */
  snapshot: TerminalSessionSnapshot

  /**
   * @param resourceId - Nexus-minted id the caller uses.
   * @param agent - exact owning Agent instance.
   * @param engine - dialect this terminal runs.
   * @param sessionId - native PTY identity; never handed to a caller.
   * @param snapshot - the publication snapshot.
   */
  constructor(
    readonly resourceId: string,
    readonly agent: Agent,
    readonly engine: ShellEngine,
    readonly sessionId: TerminalSessionId,
    snapshot: TerminalSessionSnapshot,
  ) {
    this.snapshot = snapshot
  }
}

/** Cursor state for one scrollback continuation. */
interface TerminalCursorState {
  /** Newest-relative offset where the next older page starts. */
  readonly offset: number
  /** Retained line count when the cursor was issued. */
  readonly totalLines: number
  /** The native retention latch observed when the cursor was issued. */
  readonly truncated: boolean
}

/** The controller implementation; see {@link TerminalController}. */
class Controller implements TerminalController {
  private readonly states = new Map<Agent, AgentState>()
  private readonly entries = new Map<string, OwnedTerminal>()
  /** Opens that failed after the backend may have created a PTY, by exact owner. */
  private readonly unconfirmedOpens = new Map<Agent, string[]>()
  /** Facts this controller must keep answering after its own disposal. */
  private retainedUnresolved: readonly ManagedRangeUnresolved[] = []
  /** Per-controller identity so a restarted ordinal counter cannot reuse an id. */
  private readonly epoch = randomUUID().replaceAll('-', '').slice(0, 12)
  private sequence = 0
  private disposed = false

  /**
   * @param ctx - host context providing the native terminal registry.
   * @param config - current deployment and terminal settings.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: () => ShellExecutionConfig,
  ) {}

  async open(owner: CallOwner, request: TerminalOpenRequest = {}): Promise<TerminalOpenResult> {
    const state = this.stateFor(owner)
    try {
      const engine = this.engineFor(request)
      if (request.cwd !== undefined && !isAbsolute(request.cwd)) {
        throw new NexusError(
          'INVALID_ARGUMENT',
          `the terminal working directory "${request.cwd}" is not absolute`,
        )
      }
      if (request.name !== undefined && request.name.length === 0) {
        throw new NexusError('INVALID_ARGUMENT', 'a terminal name must not be empty')
      }
      const terminals = this.requireTerminals()
      const type = terminalBackendType(engine)
      if (!terminals.listBackends().includes(type)) {
        throw new NexusError(
          'UNSUPPORTED_CAPABILITY',
          `no terminal backend is registered for "${type}"; compose @deepseek-ai/dsh-terminal-bash through registerTerminalBackends`,
        )
      }
      this.reserve(state)
      try {
        const before = terminals.list(owner.agent).map((candidate) => candidate.sessionId as string)
        let snapshot: TerminalSpawnResult
        try {
          snapshot = await terminals.spawn(
            owner.agent,
            {
              type,
              ...(request.name === undefined ? {} : { name: request.name }),
              ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
            },
            owner.signal,
          )
        } catch (error) {
          // A rejected spawn can still have created a PTY in the native
          // registry. A session that appeared is an unproven range, not a clean
          // failure; the fact keeps the owner from being treated as empty.
          const appeared = terminals
            .list(owner.agent)
            .map((candidate) => candidate.sessionId as string)
            .filter((sessionId) => !before.includes(sessionId))
          for (const sessionId of appeared) {
            this.recordUnconfirmedOpen(owner.agent, `${sessionId}: failed open left a native terminal session`)
          }
          throw openFailure(error, owner.signal)
        }
        this.sequence += 1
        const entry = new OwnedTerminal(
          `${TERMINAL_RESOURCE_PREFIX}${this.epoch}-${this.sequence}`,
          owner.agent,
          engine,
          snapshot.sessionId,
          snapshot,
        )
        if (this.disposed) {
          // The controller was disposed while this open was publishing.
          await terminals.kill(owner.agent, entry.sessionId, 'dsh-nexus controller disposed during open')
          throw new NexusError('RESOURCE_NOT_AVAILABLE', 'the shell terminal controller is disposed')
        }
        state.terminals.set(entry.resourceId, entry)
        this.entries.set(entry.resourceId, entry)
        return { terminal: this.view(entry), motd: snapshot.motd }
      } finally {
        state.pending -= 1
      }
    } finally {
      this.dropEmptyState(owner.agent)
    }
  }

  async send(owner: CallOwner, resourceId: string, request: TerminalSendRequest): Promise<TerminalSendResult> {
    const entry = this.requireEntry(owner, resourceId)
    const terminals = this.requireTerminals()
    if (typeof request.text !== 'string') {
      throw new NexusError('INVALID_ARGUMENT', 'terminal input must be text')
    }
    if (owner.signal.aborted) throw cancelledSend()
    let operation: TerminalSendOperation
    try {
      operation = terminals.startSend(owner.agent, entry.sessionId, {
        text: request.text,
        submit: request.submit !== false,
        signal: owner.signal,
      })
    } catch (error) {
      if (owner.signal.aborted) throw cancelledSend(error)
      throw error
    }
    entry.active = operation
    try {
      const result = await operation.done
      return {
        terminal: this.view(entry),
        text: result.viewport,
        waitReason: result.waitReason,
        sessionStatus: result.sessionStatus,
        truncated: result.truncated,
        cancelled: owner.signal.aborted,
      }
    } finally {
      if (entry.active === operation) entry.active = undefined
    }
  }

  read(owner: CallOwner, resourceId: string, cursor?: string, limit?: number): TerminalPage {
    const entry = this.requireEntry(owner, resourceId)
    const terminals = this.requireTerminals()
    const count = terminalPageLines(limit)
    if (cursor === undefined) {
      return pageOf(resourceId, terminals.read(owner.agent, entry.sessionId, { offset: 0, count }))
    }
    const state = decodeTerminalCursor(cursor, resourceId)
    const probed = terminals.read(owner.agent, entry.sessionId, { offset: state.offset, count })
    const drift = probed.totalLines - state.totalLines
    if (drift < 0) return evictedPage(probed)
    // A sticky retention latch with an unchanged count is the cap-reached
    // shape: an append and a head drop cancel out, so the same newest-relative
    // offset now points at different content. Exactness is unprovable.
    if (drift === 0) return pageOf(resourceId, probed, state.truncated || probed.truncated ? 'shifted' : undefined)
    // Appends shift every newest-relative offset; the same boundary is now
    // `drift` lines further back. Evictions cannot be separated from appends, so
    // a retention drop makes the page non-exact and says so.
    const shifted = state.offset + drift
    if (shifted >= probed.totalLines) return evictedPage(probed, shifted)
    const realigned = terminals.read(owner.agent, entry.sessionId, { offset: shifted, count })
    return pageOf(resourceId, realigned, state.truncated || realigned.truncated ? 'shifted' : undefined)
  }

  status(owner: CallOwner, resourceId: string): TerminalStatusResult {
    const entry = this.requireEntry(owner, resourceId)
    return { terminal: this.view(entry, this.sampleStatus(entry)), busy: entry.active !== undefined }
  }

  async wait(owner: CallOwner, resourceId: string, timeoutMs?: number): Promise<TerminalWaitResult> {
    const entry = this.requireEntry(owner, resourceId)
    const bound = resolveWaitTimeout(timeoutMs)
    const operation = entry.active
    if (operation !== undefined) {
      const settled = await bounded(operation.done, bound, owner.signal)
      if (settled !== undefined) {
        return {
          terminal: this.view(entry),
          timedOut: false,
          waitReason: settled.waitReason,
          sessionStatus: settled.sessionStatus,
        }
      }
      const status = this.sampleStatus(entry)
      return { terminal: this.view(entry, status), timedOut: true, waitReason: 'timeout', sessionStatus: status }
    }
    const deadline = Date.now() + bound
    for (;;) {
      const status = this.sampleStatus(entry)
      if (status.kind === 'exited') {
        return {
          terminal: this.view(entry, status),
          timedOut: false,
          waitReason: 'session_exit',
          sessionStatus: status,
        }
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0 || owner.signal.aborted) {
        return { terminal: this.view(entry, status), timedOut: true, waitReason: 'timeout', sessionStatus: status }
      }
      await delay(Math.min(TERMINAL_STATUS_POLL_MS, remaining))
    }
  }

  async stop(owner: CallOwner, resourceId: string): Promise<TerminalStopResult> {
    const entry = this.requireEntry(owner, resourceId)
    const terminals = this.requireTerminals()
    const operation = entry.active
    if (operation !== undefined && operation.cancel()) {
      return { terminal: this.view(entry), interrupted: true }
    }
    try {
      const delivered = await terminals.signal(owner.agent, entry.sessionId, 'SIGINT')
      return {
        terminal: this.view(entry, this.sampleStatus(entry)),
        interrupted: delivered.delivered,
        targetPgid: delivered.targetPgid,
      }
    } catch (error) {
      return { terminal: this.view(entry), interrupted: false, detail: describe(error) }
    }
  }

  async close(owner: CallOwner, resourceId: string): Promise<TerminalCloseResult> {
    const entry = this.requireEntry(owner, resourceId)
    const terminals = this.requireTerminals()
    try {
      await terminals.kill(owner.agent, entry.sessionId, 'dsh-nexus close')
    } catch (error) {
      entry.cleanupUnconfirmed = true
      return {
        terminal: this.view(entry),
        closed: false,
        reason: 'cleanup-unconfirmed',
        detail: describe(error),
      }
    }
    entry.cleanupUnconfirmed = false
    this.forget(entry)
    return { terminal: this.view(entry), closed: true }
  }

  list(owner: CallOwner): readonly TerminalView[] {
    const state = this.stateFor(owner)
    const snapshots = new Map(
      this.requireTerminals()
        .list(owner.agent)
        .map((snapshot) => [snapshot.sessionId, snapshot]),
    )
    return [...state.terminals.values()].map((entry) => {
      const snapshot = snapshots.get(entry.sessionId)
      if (snapshot !== undefined) entry.snapshot = snapshot
      return this.view(entry)
    })
  }

  async dispose(): Promise<TerminalDisposeResult> {
    if (this.disposed) return { cleared: [], failures: [] }
    this.disposed = true
    const entries = [...this.entries.values()]
    const cleared: string[] = []
    const failures: TerminalDisposeFailure[] = []
    const terminals = this.ctx.get('terminals')
    await Promise.all(
      entries.map(async (entry) => {
        if (terminals === undefined) {
          entry.cleanupUnconfirmed = true
          failures.push({
            resourceId: entry.resourceId,
            terminal: this.view(entry),
            reason: 'cleanup-unconfirmed',
            detail: 'the native terminal registry disappeared before cleanup',
          })
          return
        }
        try {
          await terminals.kill(entry.agent, entry.sessionId, 'dsh-nexus controller dispose')
          cleared.push(entry.resourceId)
          this.forget(entry)
        } catch (error) {
          entry.cleanupUnconfirmed = true
          failures.push({
            resourceId: entry.resourceId,
            terminal: this.view(entry),
            reason: 'cleanup-unconfirmed',
            detail: describe(error),
          })
        }
      }),
    )
    this.entries.clear()
    // A terminal that survived this disposal must keep answering for its owner:
    // clearing the table is not cleanup proof.
    this.retainedUnresolved = this.unresolved().map((entry) => ({
      agent: entry.agent,
      state: 'unconfirmed',
      detail: entry.detail,
    }))
    this.unconfirmedOpens.clear()
    this.states.clear()
    return { cleared, failures }
  }

  /** Resolve the dialect one open request selects, without substituting another. */
  private engineFor(request: TerminalOpenRequest): ShellEngine {
    const engine = request.engine ?? this.config().terminal.engine
    if (engine !== 'bash' && engine !== 'pwsh') {
      throw new NexusError('INVALID_ARGUMENT', 'the terminal engine must be "bash" or "pwsh"')
    }
    return engine
  }

  /** Take one active-terminal slot; a pending open counts. */
  private reserve(state: AgentState): void {
    if (state.terminals.size + state.pending >= AGENT_MAX_TERMINALS) {
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        `this Agent already holds ${AGENT_MAX_TERMINALS} active terminals; close one before opening another`,
      )
    }
    state.pending += 1
  }

  /** Resolve and authorise one owned terminal. */
  private requireEntry(owner: CallOwner, resourceId: string): OwnedTerminal {
    const state = this.stateFor(owner)
    const entry = state.terminals.get(resourceId)
    if (entry === undefined) {
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        `no persistent terminal "${resourceId}" belongs to this Agent; native PTY ids, ids from another session and restarted sessions are refused`,
      )
    }
    return entry
  }

  /** Authorise the exact live Agent and return its bucket. */
  private stateFor(owner: CallOwner): AgentState {
    this.assertUsable()
    const agents = this.ctx.get('agents')
    if (agents === undefined) {
      throw new NexusError('UNSUPPORTED_CAPABILITY', 'terminal ownership requires the native ctx.agents service')
    }
    if (agents.get(owner.sessionId) !== owner.agent) {
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        'the calling Agent is not the live Agent of this session; a restarted session must open its own terminals',
      )
    }
    let state = this.states.get(owner.agent)
    if (state === undefined) {
      state = { terminals: new Map(), pending: 0 }
      this.states.set(owner.agent, state)
    }
    return state
  }

  /** Require the native terminal registry. */
  private requireTerminals(): TerminalSessionService {
    const terminals = this.ctx.get('terminals')
    if (terminals === undefined) {
      throw new NexusError(
        'UNSUPPORTED_CAPABILITY',
        'persistent terminals require the native ctx.terminals service; compose @deepseek-ai/dsh-terminal',
      )
    }
    return terminals
  }

  /** Read one fresh native snapshot for an owned terminal. */
  private sampleStatus(entry: OwnedTerminal): TerminalSessionStatus {
    const snapshot = this.requireTerminals()
      .list(entry.agent)
      .find((candidate) => candidate.sessionId === entry.sessionId)
    if (snapshot === undefined) {
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        `persistent terminal "${entry.resourceId}" is no longer registered; open a new terminal`,
      )
    }
    entry.snapshot = snapshot
    return snapshot.status
  }

  /** Build the caller-facing view from the last observed snapshot. */
  private view(entry: OwnedTerminal, status?: TerminalSessionStatus): TerminalView {
    const snapshot = entry.snapshot
    return {
      resourceId: entry.resourceId,
      kind: 'terminal',
      engine: entry.engine,
      ...(snapshot.name === undefined ? {} : { name: snapshot.name }),
      ...(snapshot.pid === undefined ? {} : { pid: snapshot.pid }),
      sessionStatus: status ?? snapshot.status,
      cleanupUnconfirmed: entry.cleanupUnconfirmed,
    }
  }

  /** Drop one terminal from every index; the native session is already gone. */
  private forget(entry: OwnedTerminal): void {
    this.entries.delete(entry.resourceId)
    const state = this.states.get(entry.agent)
    state?.terminals.delete(entry.resourceId)
    entry.active = undefined
    if (state !== undefined) this.dropEmptyState(entry.agent)
  }

  /**
   * The managed-range cleanup fact for one exact Agent.
   * @param agent - the Agent whose terminals are queried.
   * @returns `clean` only when every terminal is confirmed closed.
   */
  cleanupOf(agent: Agent): ManagedCleanupState {
    return managedCleanupStateOf(this.unresolved(), agent)
  }

  /**
   * Every terminal range this controller cannot prove closed.
   *
   * An open PTY is a live managed range. A terminal whose session is gone from
   * the native owner list IS proven closed: the registry deletes a session only
   * after its close resolved. A pending open, or a failed one that may have left
   * a PTY, is not clean.
   * @returns one entry per unresolved terminal, with its exact Agent.
   */
  unresolved(): readonly ManagedRangeUnresolved[] {
    const unresolved: ManagedRangeUnresolved[] = [...this.retainedUnresolved]
    const terminals = this.ctx.get('terminals')
    const listed = (agent: Agent): readonly string[] | undefined => {
      if (terminals === undefined) return undefined
      try {
        return terminals.list(agent).map((snapshot) => snapshot.sessionId as string)
      } catch {
        return undefined
      }
    }
    for (const [agent, state] of this.states) {
      if (state.pending > 0) {
        unresolved.push({ agent, state: 'pending', detail: `${state.pending} terminal open(s) still in flight` })
      }
      const live = state.terminals.size === 0 ? [] : listed(agent)
      for (const entry of state.terminals.values()) {
        if (entry.cleanupUnconfirmed) {
          unresolved.push({ agent, state: 'unconfirmed', detail: `${entry.resourceId}: cleanup-unconfirmed` })
          continue
        }
        if (live === undefined) {
          unresolved.push({ agent, state: 'unconfirmed', detail: `${entry.resourceId}: native registry unavailable` })
          continue
        }
        if (live.includes(entry.sessionId as string)) {
          unresolved.push({ agent, state: 'unconfirmed', detail: `${entry.resourceId}: still open` })
        }
      }
    }
    for (const [agent, details] of this.unconfirmedOpens) {
      for (const detail of details) unresolved.push({ agent, state: 'unconfirmed', detail })
    }
    return unresolved
  }

  /** Record an open that may have left a native PTY without publishing it. */
  private recordUnconfirmedOpen(agent: Agent, detail: string): void {
    const existing = this.unconfirmedOpens.get(agent)
    if (existing === undefined) this.unconfirmedOpens.set(agent, [detail])
    else existing.push(detail)
  }

  /** Forget one Agent bucket when nothing is pending or owned. */
  private dropEmptyState(agent: Agent): void {
    const state = this.states.get(agent)
    if (state !== undefined && state.pending === 0 && state.terminals.size === 0) {
      this.states.delete(agent)
    }
  }

  /** Reject use after disposable teardown. */
  private assertUsable(): void {
    if (this.disposed) {
      throw new NexusError('RESOURCE_NOT_AVAILABLE', 'the shell terminal controller is disposed')
    }
  }
}

/** Encode one continuation cursor for the terminal that produced it. */
function encodeTerminalCursor(resourceId: string, result: TerminalReadResult): string {
  const payload = JSON.stringify({
    v: 1,
    id: resourceId,
    o: result.lineEnd,
    t: result.totalLines,
    tr: result.truncated,
  })
  return `${TERMINAL_CURSOR_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}`
}

/** Decode and validate a cursor, rejecting foreign, cross-kind and malformed values. */
function decodeTerminalCursor(cursor: string, resourceId: string): TerminalCursorState {
  const invalid = (): NexusError =>
    new NexusError(
      'INVALID_ARGUMENT',
      'the read cursor does not belong to this terminal; start a new read without a cursor',
    )
  if (!cursor.startsWith(TERMINAL_CURSOR_PREFIX)) throw invalid()
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor.slice(TERMINAL_CURSOR_PREFIX.length), 'base64url').toString('utf8'))
  } catch {
    throw invalid()
  }
  if (parsed === null || typeof parsed !== 'object') throw invalid()
  const record = parsed as Record<string, unknown>
  const truncated = record.tr
  if (record.v !== 1 || record.id !== resourceId || typeof truncated !== 'boolean') throw invalid()
  const offset = record.o
  const totalLines = record.t
  if (!isLineCount(offset) || !isLineCount(totalLines)) throw invalid()
  return { offset, totalLines, truncated }
}

/** Whether a decoded value is a usable non-negative line coordinate. */
function isLineCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Project one native page, optionally marking it as a non-exact continuation. */
function pageOf(
  resourceId: string,
  result: TerminalReadResult,
  lossReason?: TerminalLossReason,
): TerminalPage {
  const hasOlder = result.lineEnd < result.totalLines
  return {
    text: result.text,
    totalLines: result.totalLines,
    lineBegin: result.lineBegin,
    lineEnd: result.lineEnd,
    truncated: result.truncated,
    hasOlder,
    lossy: lossReason !== undefined,
    ...(lossReason === undefined ? {} : { lossReason }),
    ...(hasOlder ? { cursor: encodeTerminalCursor(resourceId, result) } : {}),
  }
}

/**
 * A page whose cursor position can no longer be mapped onto the retained window,
 * because retention dropped output; the caller starts a fresh read.
 */
function evictedPage(result: TerminalReadResult, at = result.lineEnd): TerminalPage {
  // A shrunk window can leave the requested offset beyond the retained count;
  // clamp the reported newest-relative coordinate to the real window.
  const coordinate = Math.min(at, result.totalLines)
  return {
    text: '',
    totalLines: result.totalLines,
    lineBegin: coordinate,
    lineEnd: coordinate,
    truncated: result.truncated,
    hasOlder: false,
    lossy: true,
    lossReason: 'evicted',
  }
}

/** Validate and clamp one requested line count. */
function terminalPageLines(limit: number | undefined): number {
  if (limit === undefined) return TERMINAL_READ_DEFAULT_LINES
  if (!Number.isFinite(limit) || limit < 1) {
    throw new NexusError('INVALID_ARGUMENT', 'the terminal read limit must be a positive finite number of lines')
  }
  return Math.min(Math.floor(limit), TERMINAL_READ_MAX_LINES)
}

/** Resolve and clamp one wait bound. */
function resolveWaitTimeout(value: number | undefined): number {
  if (value === undefined) return WAIT_DEFAULT_MS
  if (!Number.isFinite(value) || value < 1) {
    throw new NexusError('INVALID_ARGUMENT', 'the wait timeout must be a positive finite number of milliseconds')
  }
  return Math.min(Math.floor(value), WAIT_MAX_MS)
}

/** Public error for a send that never reached the terminal. */
function cancelledSend(cause?: unknown): NexusError {
  return new NexusError(
    'RESOURCE_NOT_AVAILABLE',
    'the terminal send was cancelled before it reached the terminal; the terminal is unchanged',
    cause === undefined ? undefined : { cause },
  )
}

/** Classify one failed open without hiding the native cause. */
function openFailure(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted) {
    return new NexusError(
      'RESOURCE_NOT_AVAILABLE',
      'the terminal open was cancelled before publication; no terminal was created',
      { cause: error },
    )
  }
  if (error instanceof TerminalError || error instanceof NexusError) return error
  if (error instanceof TerminalBackendCleanupError) {
    return new NexusError(
      'RESOURCE_NOT_AVAILABLE',
      'the terminal backend could not confirm cleanup of a partly started terminal; the native registry holds no record of it, so check for a leftover shell before opening another',
      { cause: error },
    )
  }
  return new NexusError('SHELL_UNAVAILABLE', `the persistent terminal could not be started: ${describe(error)}`, {
    cause: error,
  })
}

/** Resolve with a timer, or undefined once the bound or the cancellation ends the wait. */
async function bounded<T>(work: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  let onAbort: (() => void) | undefined
  const stop = new Promise<undefined>((resolveStop) => {
    timer = setTimeout(() => resolveStop(undefined), timeoutMs)
    timer.unref()
    onAbort = () => resolveStop(undefined)
    if (signal.aborted) resolveStop(undefined)
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([work, stop])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

/** Resolve after one poll interval. */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms)
    timer.unref()
  })
}

/** Render an unknown failure without letting its own stringification throw. */
function describe(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'unprintable failure'
  }
}
