/**
 * Native background-process ownership for the Nexus shell surface.
 *
 * One shell command is one managed process range. The controller registers it
 * with the native background-job registry (`ctx.jobs`), lets that registry own
 * identity, lifecycle state, the completion event and the model notice, and
 * keeps only the private producer handles it needs for control and output:
 *
 * - Every read and control is fenced by the **exact live Agent instance** and
 *   the native job's session ownership. A restarted session that happens to
 *   reuse the same session id has a different Agent object and therefore no
 *   entry: ids are predictable, so authorization cannot rest on secrecy.
 * - A published background run detaches from the tool call that started it.
 *   Only an explicit stop, the command timeout, owner disposal or controller
 *   disposal ends it. A cancellation before publication leaves no resource.
 * - `handle.done` is the parent command's outcome, not managed-range proof.
 *   When the provider cannot confirm an empty range the entry stays `stopping`
 *   with `cleanupConfirmed: false`; a native job may settle `failed` with that
 *   diagnostic but never as a successful completion.
 * - Every wait is bounded. A provider whose parent outcome never settles is
 *   reported as `stopping` after the cleanup budget, and the handle keeps its
 *   cleanup authority for a later `stop`/`close` retry.
 *
 * Output reads reuse {@link ManagedProcess.read} for the live in-memory view.
 * When the 32 KiB retained ring has already dropped the head, the controller
 * recovers the complete log from the stream's **current trusted spill path**,
 * which it obtains from the owned native reader on every read. No path crosses
 * the cursor, the arguments or a DTO, and a withdrawn spill is reported as a
 * loss rather than reconstructed. Invalid UTF-8 is decoded lossily and marked,
 * never advertised as byte-exact.
 *
 * @module dsh-nexus/shell/jobs
 */

import { open, type FileHandle } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobEvent, JobId, JobOutcome, JobRegistry, JobSourceRead, JobStatus } from '@deepseek-ai/dsh-jobs'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { boundContextSummary, createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type { OutputPage, ProcessStopCause, ProcessView, ShellEngine } from '../protocol.ts'
import { NexusError } from '../runtime/errors.ts'
import {
  AGENT_MAX_PROCESSES,
  COMMAND_CLEANUP_GRACE_MS,
  COMMAND_DEFAULT_TIMEOUT_MS,
  COMMAND_MAX_TIMEOUT_MS,
  COMMAND_MIN_TIMEOUT_MS,
  PROCESS_OUTPUT_SPILL_BYTES,
  PROCESS_READ_MAX_BYTES,
  WAIT_DEFAULT_MS,
  WAIT_MAX_MS,
} from '../runtime/defaults.ts'
import type { CallOwner } from '../runtime/owner.ts'
import type { ShellExecutionConfig } from './engines.ts'
import {
  decodeOutputCursor,
  findWindowStart,
  memoryWindowIsByteExact,
  outputPageLimit,
  readMemoryWindow,
  type OutputCursorState,
} from './output.ts'
import { startProcess, type ManagedProcess, type ManagedSandboxFacts, type RunInput } from './process.ts'

declare module '@deepseek-ai/dsh-jobs/view' {
  interface JobKindMap {
    /** A Nexus shell command; the engine travels in the label, not the kind. */
    'nexus-shell': 'nexus-shell'
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** One Nexus background-shell completion notice. */
    'dsh-nexus': { kind: 'dsh-nexus' } & ContextFormed
  }
}

/** Native job kind for every Nexus shell command. */
const JOB_KIND = 'nexus-shell'

/** Prefix of every process resource id (the native job id this controller passes down). */
export const PROCESS_RESOURCE_PREFIX = 'nexus-shell-'

/** Native controller name; duplicate names remain independent by contract. */
const CONTROLLER_NAME = 'dsh-nexus-shell'

/** Recovery cursor envelope; versioned so an incompatible cursor is rejected. */
const RECOVERY_CURSOR_PREFIX = 'nxprocread1.'

/** One bounded stop attempt: the provider's cleanup grace plus scheduling room. */
const STOP_BOUND_MS = COMMAND_CLEANUP_GRACE_MS + 500

/** Extra time the native wait gets beyond the settlement guard it must observe. */
const NATIVE_WAIT_MARGIN_MS = 1_000

/**
 * Consecutive completion wakes one owner may receive before notices degrade to
 * queued injection. A queued notice is NOT delivered yet: an idle owner keeps it
 * pending until a later user/steering turn wakes the driver (the explicit
 * tradeoff against an unbounded self-waking chain). Any user-authored input
 * resets the count, so a normal background workflow still reaches an idle owner
 * without polling.
 */
const COMPLETION_WAKE_BUDGET = 4

/** One command request the shell tool maps its validated arguments into. */
export interface ProcessRunRequest {
  /** Command text passed as one argv element to the selected shell. */
  readonly command: string
  /** Absolute fixed working directory for this start. */
  readonly cwd: string
  /** Engine to start; defaults to the stored terminal engine. */
  readonly engine?: ShellEngine
  /**
   * Explicit command timeout. `null` disables the automatic timeout, which is
   * only meaningful for a background run whose owner lifecycle owns the stop;
   * a foreground run falls back to the command default instead.
   */
  readonly timeoutMs?: number | null
  /** Publish the run as a background job; defaults to a foreground call. */
  readonly background?: boolean
}

/** Where one stream's returned bytes came from. */
export type OutputSourceName = 'memory' | 'spill' | 'none'

/** Why requested stream bytes are unavailable. */
export type OutputLossReason = 'retention' | 'spill-revoked' | 'spill-cap' | 'invalid-utf8'

/**
 * Per-stream truth about one read. Neither a stream name nor a byte count is a
 * path or a handle, so the record is safe to render.
 */
export interface OutputSourceTruth {
  /** Stream this record describes. */
  readonly stream: 'stdout' | 'stderr'
  /** Source that supplied this page's bytes for the stream. */
  readonly source: OutputSourceName
  /** Source bytes consumed for the stream on this page; absent when it was not read. */
  readonly bytes?: number
  /** Requested bytes for this stream are permanently unavailable. */
  readonly lost: boolean
  /** Why bytes are unavailable, when the controller can name it. */
  readonly reason?: OutputLossReason
}

/** Result of one bounded output read. */
export interface ProcessReadResult {
  /** Current lifecycle view; never inferred from output. */
  readonly view: ProcessView
  /**
   * The bounded page and its continuation cursor. An empty page means no new
   * output right now (or a held trailing code point), never that the process
   * completed; read {@link view} for lifecycle truth.
   */
  readonly page: OutputPage
  /** One record for stdout and one for stderr; at least one spill is not proof both are whole. */
  readonly recovery: readonly OutputSourceTruth[]
}

/** Result of one bounded wait. A timeout only ends the wait, never the resource. */
export interface ProcessWaitResult {
  /** Current lifecycle view. */
  readonly view: ProcessView
  /** True when the wait bound elapsed before the resource settled. */
  readonly timedOut: boolean
}

/** Native job projection the shell surface may render; ownership and paths stay out. */
export interface ProcessJobStatus {
  /** Registry-issued job id. */
  readonly id: string
  /** Native lifecycle state. */
  readonly status: JobStatus
  /** Live progress line or terminal reason, when the native record carries one. */
  readonly detail?: string
}

/** Result of one status query. */
export interface ProcessStatusResult {
  /** Current lifecycle view. */
  readonly view: ProcessView
  /** Whether the run was published as a background job. */
  readonly background: boolean
  /** Native job record while it exists; absent after a collected foreground call or owner teardown. */
  readonly job: ProcessJobStatus | undefined
  /** Current confinement facts; `denied`/`runnerFailed` can settle after publication. */
  readonly sandbox?: ManagedSandboxFacts
  /** Truthful cleanup diagnostic while the managed range is not confirmed empty. */
  readonly cleanupError?: string
}

/** One owned resource in a list. */
export interface ProcessListEntry {
  /** Current lifecycle view. */
  readonly view: ProcessView
  /** Whether the run was published as a background job. */
  readonly background: boolean
}

/** One resource the controller could not forget. */
export interface ProcessDisposeFailure {
  /** Resource that stayed managed. */
  readonly resourceId: string
  /** View proving why it stayed. */
  readonly view: ProcessView
  /** Whether cleanup was unconfirmed or the stop itself failed. */
  readonly reason: 'cleanup-unconfirmed' | 'stop-failed'
}

/** Outcome of forget/close. */
export interface ProcessCloseResult {
  /** Current lifecycle view. */
  readonly view: ProcessView
  /** True only after the provider confirmed the managed range empty. */
  readonly closed: boolean
  /** Why the resource stayed managed, when it was not forgotten. */
  readonly reason?: 'cleanup-unconfirmed'
}

/** Outcome of controller disposal. */
export interface ProcessDisposeResult {
  /** Resources whose cleanup was confirmed and that are no longer managed. */
  readonly cleared: readonly string[]
  /** Resources retained because cleanup could not be confirmed. */
  readonly failures: readonly ProcessDisposeFailure[]
}

/**
 * Host-only background-process controller.
 *
 * The shell tool (a later seam) maps validated model arguments onto these
 * methods; no method accepts a path, a handle or a model-supplied environment.
 * Every method requires the caller's exact live Agent and only sees resources
 * that same Agent published.
 */
export interface ProcessController {
  /**
   * Start one command and publish it to the native job registry.
   * @param owner - exact caller identity and the current tool-call cancellation.
   * @param execution - the original tool execution supplying trusted shell facts.
   * @param request - validated command, absolute cwd, engine, timeout and mode.
   * @returns the current view, a first bounded output page and the native job id for background runs.
   * @throws NexusError for missing authority/service, invalid input, cancellation or a failed start.
   */
  run(owner: CallOwner, execution: ToolExecution, request: ProcessRunRequest): Promise<ProcessRunResult>
  /**
   * Read one bounded page, recovering a dropped head from the trusted spill.
   * @param owner - exact caller identity.
   * @param resourceId - resource returned by {@link run}.
   * @param cursor - continuation cursor returned by the previous read.
   * @param limit - requested UTF-8 byte cap; clamped to 16 KiB.
   * @returns the page, the current view and per-stream recovery truth.
   */
  read(owner: CallOwner, resourceId: string, cursor?: string, limit?: number): Promise<ProcessReadResult>
  /**
   * Describe one owned resource without changing it.
   * @param owner - exact caller identity.
   * @param resourceId - resource returned by {@link run}.
   * @returns the current view and the native job projection while it exists.
   */
  status(owner: CallOwner, resourceId: string): ProcessStatusResult
  /**
   * Wait for settlement or the given bound. A timeout never stops the resource.
   * @param owner - exact caller identity.
   * @param resourceId - resource returned by {@link run}.
   * @param timeoutMs - wait bound; defaults to 1 000 ms and is capped at 30 000 ms.
   * @returns the current view and whether the bound elapsed.
   */
  wait(owner: CallOwner, resourceId: string, timeoutMs?: number): Promise<ProcessWaitResult>
  /**
   * Request termination of one owned resource; idempotent and bounded.
   * @param owner - exact caller identity.
   * @param resourceId - resource returned by {@link run}.
   * @returns the settled view, which may still be `stopping` when cleanup is unconfirmed.
   */
  stop(owner: CallOwner, resourceId: string): Promise<ProcessView>
  /**
   * Stop if needed and forget the resource only after confirmed cleanup.
   * @param owner - exact caller identity.
   * @param resourceId - resource returned by {@link run}.
   * @returns whether it was forgotten, or the truthful reason it stayed managed.
   */
  close(owner: CallOwner, resourceId: string): Promise<ProcessCloseResult>
  /**
   * List this Agent's published resources, including settled ones kept for reads.
   * @param owner - exact caller identity.
   * @returns the owned resources in start order.
   */
  list(owner: CallOwner): readonly ProcessListEntry[]
  /**
   * Stop and forget every owned resource; cleanup failures are reported, never hidden.
   * @returns the resources cleared and the ones retained with their proof.
   */
  dispose(): Promise<ProcessDisposeResult>
}

/** Result of one run. */
export interface ProcessRunResult {
  /** Current lifecycle view at publication (or at foreground settlement). */
  readonly view: ProcessView
  /** First bounded output page; continue with its cursor. */
  readonly page: OutputPage
  /** Whether the run was published as a background job. */
  readonly background: boolean
  /** Native job id, present for background runs while the record is live. */
  readonly jobId?: JobId
  /** Per-stream truth for the first page; the same facts a later `read` reports. */
  readonly recovery: readonly OutputSourceTruth[]
  /** Confinement facts of this run, when a policy was resolved. */
  readonly sandbox?: ManagedSandboxFacts
  /** Truthful cleanup diagnostic while the managed range is not confirmed empty. */
  readonly cleanupError?: string
}

/** One Agent's reservations and live entries. */
interface AgentState {
  readonly reservations: Set<Reservation>
  readonly processes: Map<string, OwnedProcess>
}

/** One active-process slot; released exactly once. */
interface Reservation {
  release(): void
}

/** One reader probe at an offset. */
interface StreamProbe {
  readonly text: string
  readonly nextOffset: number
  readonly lossy: boolean
  /** The decoded window has no source-byte boundary proof (invalid UTF-8). */
  readonly invalidUtf8: boolean
  readonly spillPath?: string
}

/** One stream's contribution to a recovery page. */
interface StreamSlice {
  readonly text: string
  readonly bytes: number
  readonly nextOffset: number
  readonly full: boolean
  readonly source: 'memory' | 'spill'
  readonly lost: boolean
  readonly reason?: OutputLossReason
}

/** Cursor state for a recovery page; offsets are whole-stream byte positions. */
interface RecoveryCursorState extends OutputCursorState {
  /** A spill file was already used for stdout; a later lack is a revocation. */
  readonly stdoutFromSpill: boolean
  /** A spill file was already used for stderr; a later lack is a revocation. */
  readonly stderrFromSpill: boolean
}

/** Build the host-only controller and attach its native controller/reporter effects. */
export function createProcessController(
  ctx: Context,
  config: () => ShellExecutionConfig,
): ProcessController {
  const controller = new Controller(ctx, config)
  ctx.effect(
    () => async () => {
      const result = await controller.dispose()
      for (const failure of result.failures) {
        ctx
          .logger('dsh-nexus-shell')
          .warn(
            `shell process ${failure.resourceId} was not cleaned up on unload (${failure.reason}); the managed range may survive until the host reaps it`,
          )
      }
    },
    'dsh-nexus shell process controller',
  )
  return controller
}

/** The controller implementation; see {@link ProcessController}. */
class Controller implements ProcessController {
  private readonly states = new Map<Agent, AgentState>()
  private readonly entries = new Map<string, OwnedProcess>()
  private readonly jobsById = new Map<JobId, OwnedProcess>()
  /** Consecutive completion wakes spent by one owner; reset by user-authored input. */
  private readonly wakeSpent = new WeakMap<Agent, number>()
  private attached: PromiseLike<unknown> | undefined
  private detachController: (() => unknown) | undefined
  private detachReporter: (() => unknown) | undefined
  private disposed = false

  /**
   * @param ctx - host context providing the native job registry.
   * @param config - current deployment and terminal settings.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: () => ShellExecutionConfig,
  ) {
    this.attachNative()
  }

  /**
   * Attach the native controller and completion reporter once, when the job
   * service is reachable. A composition may mount `ctx.jobs` after this
   * controller is constructed, so a later start attempts the attachment again.
   */
  private attachNative(): void {
    if (this.attached !== undefined || this.ctx.get('jobs') === undefined) return
    this.attached = this.ctx.inject(['jobs'], (jobCtx) => {
      const jobs = jobCtx.get('jobs')
      if (jobs === undefined) return
      this.detachController = jobCtx.effect(
        () => jobs.attachController(CONTROLLER_NAME),
        'dsh-nexus shell job controller',
      )
      this.detachReporter = jobCtx.effect(
        () => jobs.events.subscribe({ owners: 'all' }, (event) => this.report(event)),
        'dsh-nexus shell job reporter',
      )
      jobCtx.on('agent/inbox/claimed', ({ agent, message }) => {
        if (message.source.kind === 'user') this.wakeSpent.delete(agent)
      })
    })
  }

  async run(owner: CallOwner, execution: ToolExecution, request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.assertUsable()
    const state = this.stateFor(owner)
    validateRunRequest(request)
    const background = request.background === true
    const timeoutMs =
      request.timeoutMs === undefined || request.timeoutMs === null
        ? background
          ? null
          : COMMAND_DEFAULT_TIMEOUT_MS
        : request.timeoutMs
    const reservation = reserve(state)
    const startController = new AbortController()
    const cancelBeforePublish = (): void => {
      startController.abort()
    }
    owner.signal.addEventListener('abort', cancelBeforePublish, { once: true })
    let createdEntry: OwnedProcess | undefined
    let foregroundAbort: (() => void) | undefined

    try {
      if (owner.signal.aborted) throw cancelledBeforePublication()
      const jobs = this.requireJobs()
      this.attachNative()
      await this.attached
      if (owner.signal.aborted) throw cancelledBeforePublication()

      const runOwner: CallOwner = { agent: owner.agent, sessionId: owner.sessionId, signal: startController.signal }
      let resolveSetup: () => void = () => undefined
      const setupSettled = new Promise<void>((resolveSetupPromise) => {
        resolveSetup = resolveSetupPromise
      })
      let cancelCause: ProcessStopCause | undefined
      let runTask: Promise<OwnedProcess> | undefined

      let jobId: JobId
      try {
        jobId = jobs.start({
          kind: JOB_KIND,
          label: jobLabel(request.command),
          owner: owner.sessionId,
          toolCall: { callId: execution.callId, rootCallId: execution.rootCallId },
          output: [
            { channel: 'stdout', read: (from) => readJobSource(createdEntry, 'stdout', from) },
            { channel: 'stderr', read: (from) => readJobSource(createdEntry, 'stderr', from) },
          ],
          run: (handle) => {
            runTask = this.startOwned({
              owner,
              runOwner,
              execution,
              request,
              timeoutMs,
              background,
              jobId: handle.id,
              reservation,
              startController,
              label: jobLabel(request.command),
              onCreated: (entry) => {
                createdEntry = entry
              },
            })
            return {
              cancel: (reason) => {
                const cause: ProcessStopCause = reason !== undefined && /dispos/u.test(reason) ? 'dispose' : 'user'
                cancelCause ??= cause
                // Before publication the tool-call/start signal owns cleanup;
                // after it, only the managed stop path may terminate the range.
                if (createdEntry === undefined || !createdEntry.published) {
                  startController.abort()
                  if (createdEntry !== undefined) void createdEntry.stopBound(cause)
                } else {
                  void createdEntry.stopBound(cause)
                }
              },
              done: runTask.then(
                (entry) => {
                  resolveSetup()
                  return entry.completion
                },
                (error: unknown) => {
                  resolveSetup()
                  return failedStartOutcome(error)
                },
              ),
            }
          },
        })
      } catch (error) {
        throw nativeStartRefusal(error)
      }

      let entry: OwnedProcess
      try {
        if (runTask === undefined) throw new Error('the native job starter did not start the process')
        entry = await runTask
      } catch (error) {
        await bounded(setupSettled, STOP_BOUND_MS)
        await this.removeNativeRecord(jobId, owner.sessionId)
        if (startController.signal.aborted) throw cancelledBeforePublication(error)
        throw error
      }

      // Publication is complete: the tool call that started this run no longer
      // owns it. A foreground call keeps a cancellation listener that stops the
      // resource through the managed path, never through the spawn signal.
      owner.signal.removeEventListener('abort', cancelBeforePublish)
      if (cancelCause !== undefined) void entry.stopBound(cancelCause)

      if (!background) {
        foregroundAbort = (): void => {
          void entry.stopBound('cancel')
        }
        owner.signal.addEventListener('abort', foregroundAbort, { once: true })
        await this.awaitForeground(entry, owner, timeoutMs)
        // A confirmed foreground range is collected and removed from the native
        // listing. An unconfirmed one stays visible as a failed record: it is
        // still a live managed range the caller must be able to stop.
        if (entry.process.view().cleanupConfirmed) await this.removeNativeRecord(jobId, owner.sessionId)
      } else if (timeoutMs !== null) {
        entry.armGuard(timeoutMs + STOP_BOUND_MS)
      }

      const first = await this.readForEntry(entry, undefined)
      const sandbox = entry.process.sandbox
      const cleanupError = entry.process.cleanupError
      return {
        view: first.view,
        page: first.page,
        recovery: first.recovery,
        background,
        ...(background ? { jobId } : {}),
        ...(sandbox === undefined ? {} : { sandbox }),
        ...(cleanupError === undefined ? {} : { cleanupError }),
      }
    } catch (error) {
      // Any failure before an entry exists must not hold an active-process slot.
      if (createdEntry === undefined) reservation.release()
      throw error
    } finally {
      owner.signal.removeEventListener('abort', cancelBeforePublish)
      if (foregroundAbort !== undefined) owner.signal.removeEventListener('abort', foregroundAbort)
      this.dropEmptyState(owner.agent)
    }
  }

  async read(owner: CallOwner, resourceId: string, cursor?: string, limit?: number): Promise<ProcessReadResult> {
    return this.readForEntry(this.requireEntry(owner, resourceId), cursor, limit)
  }

  /** Shared read implementation once the owned entry is resolved. */
  private async readForEntry(entry: OwnedProcess, cursor?: string, limit?: number): Promise<ProcessReadResult> {
    const pageSize = outputPageLimit(limit)
    if (cursor === undefined) {
      const state: RecoveryCursorState = {
        stdoutOffset: 0,
        stderrOffset: 0,
        lost: false,
        stderrStarted: false,
        stdoutFromSpill: false,
        stderrFromSpill: false,
      }
      const stdoutProbe = probeStream(entry.reader('stdout'), 0, entry.outputComplete)
      const stderrProbe = probeStream(entry.reader('stderr'), 0, entry.outputComplete)
      if (needsRecovery(stdoutProbe) || needsRecovery(stderrProbe)) {
        return this.recover(entry, state, pageSize)
      }
      const page = await entry.process.read(undefined, pageSize)
      return { view: entry.process.view(), page, recovery: liveTruth(stdoutProbe, stderrProbe) }
    }
    if (cursor.startsWith(RECOVERY_CURSOR_PREFIX)) {
      const state = decodeRecoveryCursor(cursor, entry.resourceId)
      return this.recover(entry, state, pageSize)
    }
    const state = decodeOutputCursor(cursor, entry.resourceId)
    const stdoutProbe = probeStream(entry.reader('stdout'), state.stdoutOffset, entry.outputComplete)
    const stderrProbe = probeStream(entry.reader('stderr'), state.stderrOffset, entry.outputComplete)
    if (needsRecovery(stdoutProbe) || needsRecovery(stderrProbe)) {
      return this.recover(
        entry,
        { ...state, stdoutFromSpill: false, stderrFromSpill: false },
        pageSize,
      )
    }
    const page = await entry.process.read(cursor, pageSize)
    return { view: entry.process.view(), page, recovery: liveTruth(stdoutProbe, stderrProbe) }
  }

  status(owner: CallOwner, resourceId: string): ProcessStatusResult {
    const entry = this.requireEntry(owner, resourceId)
    const sandbox = entry.process.sandbox
    const cleanupError = entry.process.cleanupError
    return {
      view: entry.process.view(),
      background: entry.background,
      job: this.jobStatus(entry),
      ...(sandbox === undefined ? {} : { sandbox }),
      ...(cleanupError === undefined ? {} : { cleanupError }),
    }
  }

  async wait(owner: CallOwner, resourceId: string, timeoutMs?: number): Promise<ProcessWaitResult> {
    const entry = this.requireEntry(owner, resourceId)
    const bound = resolveWaitTimeout(timeoutMs)
    if (entry.completed) return { view: entry.process.view(), timedOut: false }
    const jobs = this.ctx.get('jobs')
    if (jobs !== undefined) {
      try {
        const job = await jobs.wait(entry.jobId, bound, owner.sessionId, owner.signal)
        const timedOut = job.status === 'running' || job.status === 'stopping'
        return { view: entry.process.view(), timedOut }
      } catch (error) {
        if (entry.completed) return { view: entry.process.view(), timedOut: false }
        if (owner.signal.aborted) return { view: entry.process.view(), timedOut: true }
        throw error
      }
    }
    const settled = await bounded(entry.settled, bound)
    return { view: entry.process.view(), timedOut: settled === undefined && !entry.completed }
  }

  async stop(owner: CallOwner, resourceId: string): Promise<ProcessView> {
    const entry = this.requireEntry(owner, resourceId)
    if (entry.completed && entry.process.view().cleanupConfirmed) return entry.process.view()
    return entry.stopBound('user')
  }

  async close(owner: CallOwner, resourceId: string): Promise<ProcessCloseResult> {
    const entry = this.requireEntry(owner, resourceId)
    if (!entry.process.view().cleanupConfirmed) {
      const view = await entry.stopBound('user')
      if (!view.cleanupConfirmed) return { view, closed: false, reason: 'cleanup-unconfirmed' }
    }
    await entry.settleIfPending()
    const view = entry.process.view()
    await this.forget(entry)
    return { view, closed: true }
  }

  list(owner: CallOwner): readonly ProcessListEntry[] {
    const state = this.stateFor(owner)
    return [...state.processes.values()]
      .filter((entry) => entry.published && !entry.forgotten)
      .map((entry) => ({ view: entry.process.view(), background: entry.background }))
  }

  async dispose(): Promise<ProcessDisposeResult> {
    if (this.disposed) return { cleared: [], failures: [] }
    this.disposed = true
    const entries = [...this.entries.values()]
    const cleared: string[] = []
    const failures: ProcessDisposeFailure[] = []
    await Promise.all(
      entries.map(async (entry) => {
        const view = await entry.stopBound('dispose')
        if (view.cleanupConfirmed) {
          cleared.push(entry.resourceId)
          await this.forget(entry)
        } else {
          failures.push({
            resourceId: entry.resourceId,
            view,
            reason: view.status === 'stopping' ? 'cleanup-unconfirmed' : 'stop-failed',
          })
        }
      }),
    )
    this.detachNative()
    this.entries.clear()
    this.jobsById.clear()
    this.states.clear()
    return { cleared, failures }
  }

  /** Start one process after the native job registration committed. */
  private async startOwned(options: {
    readonly owner: CallOwner
    readonly runOwner: CallOwner
    readonly execution: ToolExecution
    readonly request: ProcessRunRequest
    readonly timeoutMs: number | null
    readonly background: boolean
    readonly jobId: JobId
    readonly reservation: Reservation
    readonly startController: AbortController
    readonly label: string
    readonly onCreated: (entry: OwnedProcess) => void
  }): Promise<OwnedProcess> {
    const input: RunInput = {
      command: options.request.command,
      cwd: options.request.cwd,
      resourceId: options.jobId,
      ...(options.request.engine === undefined ? {} : { engine: options.request.engine }),
      ...(options.timeoutMs === null ? { timeoutMs: null } : { timeoutMs: options.timeoutMs }),
    }
    const process = await startProcess(this.ctx, options.runOwner, input, this.config(), options.execution)
    // The spawn signal is only for startup. Once a handle exists, aborting it
    // would kill a background run through the provider, so it stays untouched.
    const entry = new OwnedProcess(
      process,
      options.owner.agent,
      options.owner.sessionId,
      options.jobId,
      options.background,
      options.label,
      options.reservation,
    )
    options.onCreated(entry)
    if (this.disposed) {
      await entry.stopBound('dispose')
      throw new NexusError('RESOURCE_NOT_AVAILABLE', 'the shell process controller is disposed')
    }
    this.register(options.owner.agent, entry)
    if (options.startController.signal.aborted) {
      // Cancellation raced the spawn: keep cleanup authority but never publish.
      await entry.stopBound('cancel')
      throw cancelledBeforePublication()
    }
    entry.published = true
    return entry
  }

  /** Wait for one foreground run and produce its diagnostic without hanging. */
  private async awaitForeground(entry: OwnedProcess, owner: CallOwner, timeoutMs: number | null): Promise<void> {
    const guardMs = (timeoutMs ?? COMMAND_DEFAULT_TIMEOUT_MS) + STOP_BOUND_MS
    entry.armGuard(guardMs)
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) {
      await bounded(entry.settled, guardMs)
      return
    }
    try {
      await jobs.wait(entry.jobId, guardMs + NATIVE_WAIT_MARGIN_MS, owner.sessionId, owner.signal)
    } catch (error) {
      if (owner.signal.aborted) {
        await entry.stopBound('cancel')
        throw cancelledRun(error)
      }
      throw error
    }
    if (owner.signal.aborted) {
      await entry.stopBound('cancel')
      throw cancelledRun()
    }
    if (!entry.completed) {
      // The producer never settled within its cleanup budget; leave the
      // truthful stopping diagnostic and keep the handle for a retry.
      await entry.stopBound('timeout')
    }
  }

  /** Build one recovery page from the trusted spill files. */
  private async recover(
    entry: OwnedProcess,
    state: RecoveryCursorState,
    pageSize: number,
  ): Promise<ProcessReadResult> {
    let remaining = pageSize
    let text = ''
    let lost = state.lost
    let stderrStarted = state.stderrStarted
    let stdoutOffset = state.stdoutOffset
    let stderrOffset = state.stderrOffset
    let stdoutFromSpill = state.stdoutFromSpill
    let stderrFromSpill = state.stderrFromSpill
    let stdoutTruth: OutputSourceTruth = { stream: 'stdout', source: 'none', lost: false }
    let stderrTruth: OutputSourceTruth = { stream: 'stderr', source: 'none', lost: false }

    const stdoutReader = entry.reader('stdout')
    const stderrReader = entry.reader('stderr')
    const outputComplete = entry.outputComplete
    const stdoutProbe = probeStream(stdoutReader, stdoutOffset, outputComplete)
    const stderrProbe = probeStream(stderrReader, stderrOffset, outputComplete)
    // The current fact only: a provider may revoke a spill on cap/write/seal.
    const spillAvailable = stdoutProbe.spillPath !== undefined || stderrProbe.spillPath !== undefined

    if (remaining > 0) {
      const stdout = await readStream(stdoutReader, stdoutProbe, stdoutOffset, remaining, outputComplete, stdoutFromSpill)
      stdoutTruth = truthOf('stdout', stdout)
      text += stdout.text
      remaining -= stdout.bytes
      stdoutOffset = stdout.nextOffset
      lost = lost || stdout.lost
      stdoutFromSpill = stdoutFromSpill || stdout.source === 'spill'
      if (stdout.full && remaining > 0) {
        const marker = stderrStarted ? '' : '[stderr]\n'
        const markerBytes = Buffer.byteLength(marker, 'utf8')
        if (remaining > markerBytes) {
          const stderr = await readStream(
            stderrReader,
            stderrProbe,
            stderrOffset,
            remaining - markerBytes,
            outputComplete,
            stderrFromSpill,
          )
          if (stderr.text.length > 0) {
            text += marker + stderr.text
            remaining -= markerBytes + stderr.bytes
            stderrOffset = stderr.nextOffset
            stderrStarted = true
          } else {
            stderrOffset = stderr.nextOffset
          }
          if (stderr.text.length > 0 || stderr.lost) {
            stderrTruth = truthOf('stderr', stderr)
            lost = lost || stderr.lost
            stderrFromSpill = stderrFromSpill || stderr.source === 'spill'
          }
        }
      }
    }

    return {
      view: entry.process.view(),
      recovery: [stdoutTruth, stderrTruth],
      page: {
        text,
        cursor: encodeRecoveryCursor(entry.resourceId, {
          stdoutOffset,
          stderrOffset,
          lost,
          stderrStarted,
          stdoutFromSpill,
          stderrFromSpill,
        }),
        lossy: lost,
        spillAvailable,
      },
    }
  }

  /** Register a published entry in its Agent bucket and the native id index. */
  private register(agent: Agent, entry: OwnedProcess): void {
    const state = this.states.get(agent)
    if (state === undefined) throw new NexusError('RESOURCE_NOT_AVAILABLE', 'the owning Agent state disappeared')
    state.processes.set(entry.resourceId, entry)
    this.entries.set(entry.resourceId, entry)
    this.jobsById.set(entry.jobId, entry)
  }

  /** Drop one entry from every index; the native record is removed separately. */
  private async forget(entry: OwnedProcess): Promise<void> {
    await this.removeNativeRecord(entry.jobId, entry.sessionId)
    entry.forgotten = true
    this.jobsById.delete(entry.jobId)
    this.entries.delete(entry.resourceId)
    const state = this.states.get(entry.agent)
    state?.processes.delete(entry.resourceId)
    entry.releaseReservation()
    this.dropEmptyState(entry.agent)
  }

  /** Best-effort removal of a settled native record we collected ourselves. */
  private async removeNativeRecord(jobId: JobId, sessionId: SessionId): Promise<void> {
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) return
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const view = jobs.get(jobId, sessionId)
        if (view.status === 'running' || view.status === 'stopping') {
          await new Promise((resolveTick) => setTimeout(resolveTick, 0))
          continue
        }
        jobs.remove(jobId, sessionId)
        return
      } catch {
        // Unknown/foreign means the owner's native cleanup already dropped it;
        // this record is not a resource the controller must retain.
        return
      }
    }
  }

  /** Project the native job record without leaking ownership or output paths. */
  private jobStatus(entry: OwnedProcess): ProcessJobStatus | undefined {
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) return undefined
    try {
      const job = jobs.get(entry.jobId, entry.sessionId)
      const detail = job.progress ?? job.detail
      return { id: job.id, status: job.status, ...(detail === undefined ? {} : { detail }) }
    } catch {
      return undefined
    }
  }

  /** Resolve and authorise one owned resource. */
  private requireEntry(owner: CallOwner, resourceId: string): OwnedProcess {
    const state = this.stateFor(owner)
    const entry = state.processes.get(resourceId)
    if (entry === undefined) {
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        `no shell resource "${resourceId}" belongs to this Agent; ids from another session or a restarted session are refused`,
      )
    }
    return entry
  }

  /** Authorise the exact live Agent and return its bucket. */
  private stateFor(owner: CallOwner): AgentState {
    this.assertUsable()
    const agents = this.ctx.get('agents')
    if (agents === undefined) {
      throw new NexusError('UNSUPPORTED_CAPABILITY', 'shell ownership requires the native ctx.agents service')
    }
    if (agents.get(owner.sessionId) !== owner.agent) {
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        'the calling Agent is not the live Agent of this session; a restarted session must start its own work',
      )
    }
    let state = this.states.get(owner.agent)
    if (state === undefined) {
      state = { reservations: new Set(), processes: new Map() }
      this.states.set(owner.agent, state)
    }
    return state
  }

  /** Require the native job registry for a start. */
  private requireJobs(): JobRegistry {
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) {
      throw new NexusError(
        'UNSUPPORTED_CAPABILITY',
        'shell execution requires the native ctx.jobs service; compose @deepseek-ai/dsh-jobs-local',
      )
    }
    return jobs
  }

  /** Forget one Agent bucket when nothing is reserved or managed. */
  private dropEmptyState(agent: Agent): void {
    const state = this.states.get(agent)
    if (state !== undefined && state.reservations.size === 0 && state.processes.size === 0) {
      this.states.delete(agent)
    }
  }

  /**
   * Offer one unclaimed background completion to its exact live owner: wake an
   * idle owner within the budget, otherwise queue it for the next step/turn.
   */
  private report(event: JobEvent): void {
    if (this.disposed || event.type !== 'settled') return
    if (event.awaited || event.cause === 'teardown') return
    const entry = this.jobsById.get(event.job.id)
    if (entry === undefined || !entry.background || !entry.published || entry.forgotten) return
    if (event.job.owner === undefined || event.job.owner !== entry.sessionId) return
    const agents = this.ctx.get('agents')
    if (agents === undefined || agents.get(entry.sessionId) !== entry.agent) return
    const view = entry.process.view()
    const status = view.cleanupConfirmed
      ? `${event.job.status}${event.job.detail === undefined ? '' : `: ${event.job.detail}`}`
      : `${event.job.status}: cleanup not confirmed; the resource stays controllable`
    const notice = `background shell job ${entry.resourceId} finished [${status}]. Read its output with the shell tool action read (resourceId: ${entry.resourceId}); stop or close it before forgetting it.`
    const message = createUserMessage({
      content: [{ type: 'text', text: notice }],
      source: {
        kind: 'dsh-nexus',
        form: 'notice',
        summary: boundContextSummary(`background shell finished: ${jobLabel(entry.label)}`),
      },
    })
    try {
      if (entry.agent.status === 'idle') {
        const spent = this.wakeSpent.get(entry.agent) ?? 0
        if (spent < COMPLETION_WAKE_BUDGET) {
          this.wakeSpent.set(entry.agent, spent + 1)
          entry.agent.followup(message)
        } else {
          entry.agent.inject(message)
        }
      } else {
        // A busy driver claims injected context at its next step boundary.
        entry.agent.inject(message)
      }
    } catch (error) {
      this.ctx.logger('dsh-nexus-shell').warn(`could not deliver a shell completion notice: ${describe(error)}`)
    }
  }

  /** Detach the native controller and reporter exactly once. */
  private detachNative(): void {
    const detachReporter = this.detachReporter
    const detachController = this.detachController
    this.detachReporter = undefined
    this.detachController = undefined
    try {
      detachReporter?.()
    } catch (error) {
      this.ctx.logger('dsh-nexus-shell').warn(`could not detach the shell job reporter: ${describe(error)}`)
    }
    try {
      detachController?.()
    } catch (error) {
      this.ctx.logger('dsh-nexus-shell').warn(`could not detach the shell job controller: ${describe(error)}`)
    }
  }

  /** Reject use after disposable teardown. */
  private assertUsable(): void {
    if (this.disposed) {
      throw new NexusError('RESOURCE_NOT_AVAILABLE', 'the shell process controller is disposed')
    }
  }
}

/** One managed process the controller owns. */
class OwnedProcess {
  readonly resourceId: string
  readonly completion: Promise<JobOutcome>
  readonly settled: Promise<void>
  published = false
  forgotten = false
  outputComplete = false
  completed = false
  private resolveCompletion!: (outcome: JobOutcome) => void
  private resolveSettled!: () => void
  private reservation: Reservation | undefined
  private guard: NodeJS.Timeout | undefined

  /**
   * @param process - the managed process returned by {@link startProcess}.
   * @param agent - exact owning Agent instance.
   * @param sessionId - native job owner session id.
   * @param jobId - registry-issued background-job id.
   * @param background - whether this run was published as a background job.
   * @param label - one-line command label for the completion notice.
   * @param reservation - the active-process slot this entry owns.
   */
  constructor(
    readonly process: ManagedProcess,
    readonly agent: Agent,
    readonly sessionId: SessionId,
    readonly jobId: JobId,
    readonly background: boolean,
    readonly label: string,
    reservation: Reservation,
  ) {
    this.resourceId = process.resourceId
    this.reservation = reservation
    this.completion = new Promise<JobOutcome>((resolveCompletion) => {
      this.resolveCompletion = resolveCompletion
    })
    this.settled = new Promise<void>((resolveSettled) => {
      this.resolveSettled = resolveSettled
    })
    void process.handle.done.then(
      () => {
        this.outputComplete = true
      },
      () => {
        this.outputComplete = true
      },
    )
    void process.done.then(
      (view) => {
        this.settle(outcomeOf(view))
      },
      (error: unknown) => {
        this.settle({ status: 'failed', detail: `the managed process failed: ${describe(error)}` })
      },
    )
  }

  /** The collected reader for one stream, when the provider exposed it. */
  reader(stream: 'stdout' | 'stderr'): SubprocessOutputReader | undefined {
    return this.process.handle.collected[stream]
  }

  /** Request termination and bound the wait for provider confirmation. */
  async stopBound(cause: ProcessStopCause): Promise<ProcessView> {
    const current = this.process.view()
    if (current.cleanupConfirmed && this.completed) {
      // A bounded stop may have settled first while cleanup was still open; once
      // the provider confirms the range empty the slot is no longer active.
      this.releaseReservation()
      return current
    }
    const result = await bounded(this.process.stop(cause), STOP_BOUND_MS)
    const view = result ?? this.process.view()
    if (view.cleanupConfirmed) {
      this.settle(outcomeOf(view))
      this.releaseReservation()
    } else if (!this.completed) {
      // The provider did not settle within the bounded attempt. Fail the
      // native record truthfully and keep the handle for a stop/close retry.
      this.settle({
        status: 'failed',
        detail: `cleanup not confirmed after a ${cause} stop within ${STOP_BOUND_MS} ms; the managed range is retained`,
      })
    }
    return view
  }

  /** Arm the foreground/explicit-timeout settlement safety net. */
  armGuard(delayMs: number): void {
    if (this.completed) return
    this.clearGuard()
    this.guard = setTimeout(() => {
      if (this.completed) return
      void this.process.stop('timeout')
      this.settle({
        status: 'failed',
        detail: `the command did not settle within ${delayMs} ms; cleanup is unconfirmed and the managed range is retained`,
      })
    }, delayMs)
    this.guard.unref()
  }

  /** Settle the completion from the final view when the watcher has not run yet. */
  async settleIfPending(): Promise<void> {
    if (!this.completed) {
      const view = this.process.view()
      if (view.cleanupConfirmed) this.settle(outcomeOf(view))
    }
    await Promise.resolve()
  }

  /** First-wins settlement; releases the slot only once cleanup is confirmed. */
  settle(outcome: JobOutcome): void {
    if (this.completed) {
      // The native settlement can win the race against the bounded stop/guard
      // and land `cleanupConfirmed` slightly later. Releasing here (idempotent)
      // keeps the active-process cap truthful without touching the retained
      // output or emitting a second notice.
      if (this.process.view().cleanupConfirmed) this.releaseReservation()
      return
    }
    this.completed = true
    this.clearGuard()
    if (this.process.view().cleanupConfirmed) this.releaseReservation()
    this.resolveCompletion(outcome)
    this.resolveSettled()
  }

  /** Release the active-process slot exactly once. */
  releaseReservation(): void {
    const reservation = this.reservation
    this.reservation = undefined
    reservation?.release()
  }

  /** Clear the settlement safety net. */
  private clearGuard(): void {
    if (this.guard !== undefined) {
      clearTimeout(this.guard)
      this.guard = undefined
    }
  }
}

/** Reserve one active-process slot; pending starts count. */
function reserve(state: AgentState): Reservation {
  if (state.reservations.size >= AGENT_MAX_PROCESSES) {
    throw new NexusError(
      'RESOURCE_NOT_AVAILABLE',
      `this Agent already holds ${AGENT_MAX_PROCESSES} active shell processes; stop and close one before starting another`,
    )
  }
  let released = false
  const token: Reservation = {
    release: () => {
      if (released) return
      released = true
      state.reservations.delete(token)
    },
  }
  state.reservations.add(token)
  return token
}

/** Validate one run request before any resource exists. */
function validateRunRequest(request: ProcessRunRequest): void {
  if (request.command.trim().length === 0) {
    throw new NexusError('INVALID_ARGUMENT', 'the shell command must not be empty')
  }
  if (!isAbsolute(request.cwd)) {
    throw new NexusError('INVALID_ARGUMENT', `the shell working directory "${request.cwd}" is not absolute`)
  }
  if (request.engine !== undefined && request.engine !== 'bash' && request.engine !== 'pwsh') {
    throw new NexusError('INVALID_ARGUMENT', 'the shell engine must be "bash" or "pwsh"')
  }
  if (request.timeoutMs !== undefined && request.timeoutMs !== null) {
    const value = request.timeoutMs
    if (!Number.isFinite(value) || value < COMMAND_MIN_TIMEOUT_MS || value > COMMAND_MAX_TIMEOUT_MS) {
      throw new NexusError(
        'INVALID_ARGUMENT',
        `the shell timeout must be between ${COMMAND_MIN_TIMEOUT_MS} and ${COMMAND_MAX_TIMEOUT_MS} ms`,
      )
    }
  }
}

/** Resolve and clamp one wait bound. */
function resolveWaitTimeout(value: number | undefined): number {
  if (value === undefined) return WAIT_DEFAULT_MS
  if (!Number.isFinite(value) || value < 1) {
    throw new NexusError('INVALID_ARGUMENT', 'the wait timeout must be a positive finite number of milliseconds')
  }
  return Math.min(Math.floor(value), WAIT_MAX_MS)
}

/** Public error for a call cancelled before publication. */
function cancelledBeforePublication(cause?: unknown): NexusError {
  return new NexusError(
    'RESOURCE_NOT_AVAILABLE',
    'the shell command was cancelled before it was published; no process or job was created',
    cause === undefined ? undefined : { cause },
  )
}

/** Public error for a foreground call cancelled after publication. */
function cancelledRun(cause?: unknown): NexusError {
  return new NexusError(
    'RESOURCE_NOT_AVAILABLE',
    'the shell command was cancelled; its managed range was stopped through the ownership path',
    cause === undefined ? undefined : { cause },
  )
}

/** Wrap a native registry refusal without hiding its cause. */
function nativeStartRefusal(error: unknown): NexusError {
  if (error instanceof NexusError) return error
  return new NexusError(
    'UNSUPPORTED_CAPABILITY',
    'the native background-job registry refused to start this shell command; compose a job controller for the session',
    { cause: error },
  )
}

/** Outcome of a run whose process never started. */
function failedStartOutcome(error: unknown): JobOutcome {
  return { status: 'failed', detail: `the shell process did not start: ${describe(error)}` }
}

/** Classify the final process view into a native job outcome. */
function outcomeOf(view: ProcessView): JobOutcome {
  if (!view.cleanupConfirmed) {
    return {
      status: 'failed',
      detail: 'managed-range cleanup was not confirmed; the process is retained for stop/close retries',
    }
  }
  if (view.stopRequested === 'timeout') return { status: 'failed', detail: 'timed out' }
  if (view.stopRequested === 'user' || view.stopRequested === 'cancel' || view.stopRequested === 'dispose') {
    return { status: 'killed', detail: `stopped (${view.stopRequested})` }
  }
  if (view.status === 'exited') {
    const detail = view.exitCode === null ? `signal: ${view.signal ?? 'unknown'}` : `exit code: ${view.exitCode}`
    return { status: 'completed', detail }
  }
  if (view.status === 'cancelled') return { status: 'killed', detail: 'cancelled' }
  if (view.status === 'timed_out') return { status: 'failed', detail: 'timed out' }
  return { status: 'failed', detail: `the command ended as ${view.status}` }
}

/** Mirror the native output-source contract for the registry pump. */
function readJobSource(entry: OwnedProcess | undefined, stream: 'stdout' | 'stderr', from: number): JobSourceRead {
  const reader = entry?.reader(stream)
  if (reader === undefined) return { text: '', nextOffset: from, lossy: false }
  return reader.readFrom(from)
}

/** One-line, bounded job label derived from the command text. */
function jobLabel(command: string): string {
  const flattened = command.replace(/\s+/gu, ' ').trim()
  return flattened.length <= 200 ? flattened : `${flattened.slice(0, 199)}…`
}

/** Read one stream at one offset without consuming anything. */
function probeStream(
  reader: SubprocessOutputReader | undefined,
  offset: number,
  outputComplete: boolean,
): StreamProbe {
  if (reader === undefined) return { text: '', nextOffset: offset, lossy: false, invalidUtf8: false }
  const probe = reader.readFrom(offset)
  return {
    text: probe.text,
    nextOffset: probe.nextOffset,
    lossy: probe.lossy,
    invalidUtf8: !probe.lossy && !memoryWindowIsByteExact(reader, probe.text, offset, probe.nextOffset, outputComplete),
    ...(probe.spillPath === undefined ? {} : { spillPath: probe.spillPath }),
  }
}

/** Whether the requested offset needs the trusted spill file. */
function needsRecovery(probe: StreamProbe): boolean {
  return probe.lossy && probe.spillPath !== undefined
}

/** Per-stream truth for a live preview page. */
function liveTruth(stdout: StreamProbe, stderr: StreamProbe): readonly OutputSourceTruth[] {
  return [liveStreamTruth('stdout', stdout), liveStreamTruth('stderr', stderr)]
}

/** Per-stream truth for one memory-only page. */
function liveStreamTruth(stream: 'stdout' | 'stderr', probe: StreamProbe): OutputSourceTruth {
  if (probe.invalidUtf8) {
    return {
      stream,
      source: probe.text.length === 0 ? 'none' : 'memory',
      lost: true,
      reason: 'invalid-utf8',
    }
  }
  if (!probe.lossy) {
    return { stream, source: probe.text.length === 0 ? 'none' : 'memory', lost: false }
  }
  return {
    stream,
    source: 'memory',
    lost: true,
    reason: probe.nextOffset > PROCESS_OUTPUT_SPILL_BYTES ? 'spill-cap' : 'retention',
  }
}

/** Translate one stream slice into its public truth record. */
function truthOf(stream: 'stdout' | 'stderr', slice: StreamSlice): OutputSourceTruth {
  return {
    stream,
    source: slice.source,
    bytes: slice.bytes,
    lost: slice.lost,
    ...(slice.reason === undefined ? {} : { reason: slice.reason }),
  }
}

/** Read one stream, preferring the trusted spill when the ring window lost the head. */
async function readStream(
  reader: SubprocessOutputReader | undefined,
  probe: StreamProbe,
  offset: number,
  budget: number,
  outputComplete: boolean,
  usedSpill: boolean,
): Promise<StreamSlice> {
  if (!probe.lossy) {
    return readMemory(reader, probe, offset, budget, outputComplete)
  }
  if (probe.spillPath !== undefined) {
    const spill = await readSpillChunk(probe.spillPath, offset, budget, outputComplete)
    if (spill !== undefined) return spill
  }
  const reason: OutputLossReason =
    probe.nextOffset > PROCESS_OUTPUT_SPILL_BYTES ? 'spill-cap' : usedSpill ? 'spill-revoked' : 'retention'
  return readMemoryLossy(reader, probe, offset, budget, outputComplete, reason)
}

/** Read a bounded page out of the retained in-memory tail. */
function readMemory(
  reader: SubprocessOutputReader | undefined,
  probe: StreamProbe,
  offset: number,
  budget: number,
  outputComplete: boolean,
): StreamSlice {
  const window = readMemoryWindow(
    reader,
    { text: probe.text, start: offset, end: probe.nextOffset, lossy: false },
    budget,
    outputComplete,
  )
  return {
    text: window.text,
    bytes: window.bytes,
    nextOffset: window.nextOffset,
    full: window.full,
    source: 'memory',
    lost: window.lost,
    ...(window.reason === undefined ? {} : { reason: window.reason }),
  }
}

/** Read the surviving tail after the requested offset slid out of memory. */
function readMemoryLossy(
  reader: SubprocessOutputReader | undefined,
  probe: StreamProbe,
  offset: number,
  budget: number,
  outputComplete: boolean,
  reason: OutputLossReason,
): StreamSlice {
  if (reader === undefined) {
    return { text: '', bytes: 0, nextOffset: probe.nextOffset, full: true, source: 'memory', lost: true, reason }
  }
  const start = findWindowStart(reader, offset, probe.nextOffset)
  const aligned = reader.readFrom(start)
  const window = readMemoryWindow(
    reader,
    { text: aligned.text, start, end: aligned.nextOffset, lossy: true },
    budget,
    outputComplete,
  )
  return {
    text: window.text,
    bytes: window.bytes,
    nextOffset: window.nextOffset,
    full: start >= aligned.nextOffset,
    source: 'memory',
    lost: true,
    reason: window.reason ?? reason,
  }
}

/**
 * Read one bounded chunk from the trusted spill file.
 *
 * Offsets are whole-stream byte positions, so the returned cursor stays
 * comparable with the in-memory reader. A file that no longer covers the
 * requested offset returns `undefined`, which the caller reports as a revoked
 * spill instead of reconstructing bytes.
 */
async function readSpillChunk(
  path: string,
  offset: number,
  budget: number,
  outputComplete: boolean,
): Promise<StreamSlice | undefined> {
  let handle: FileHandle
  try {
    handle = await open(path, 'r')
  } catch {
    return undefined
  }
  try {
    const info = await handle.stat()
    if (offset > info.size) return undefined
    const want = Math.min(budget + 4, PROCESS_READ_MAX_BYTES + 4)
    const buffer = Buffer.allocUnsafe(want)
    const { bytesRead } = await handle.read(buffer, 0, want, offset)
    if (bytesRead === 0) {
      return { text: '', bytes: 0, nextOffset: offset, full: offset >= info.size, source: 'spill', lost: false }
    }
    const slice = buffer.subarray(0, bytesRead)
    const atFileEnd = offset + bytesRead >= info.size
    const final = atFileEnd && outputComplete
    let cut = rawUtf8PrefixLength(slice, budget)
    if (cut === 0) {
      const width = firstSequenceWidth(slice)
      if (width <= slice.length) {
        // One code point larger than the page budget is returned whole so the
        // cursor always makes progress and no code point is ever split.
        cut = width
      } else if (final) {
        // An incomplete sequence at the exact end is real data: consume it
        // lossily rather than stalling the cursor forever.
        cut = Math.min(slice.length, Math.max(budget, 1))
      } else {
        return { text: '', bytes: 0, nextOffset: offset, full: false, source: 'spill', lost: false }
      }
    } else if (final) {
      cut = Math.min(slice.length, Math.max(cut, budget))
    }
    const decoded = fitDecodedCut(slice, cut, budget)
    return {
      text: decoded.text,
      bytes: decoded.cut,
      nextOffset: offset + decoded.cut,
      full: offset + decoded.cut >= info.size,
      source: 'spill',
      lost: decoded.lossy,
      ...(decoded.lossy ? { reason: 'invalid-utf8' as const } : {}),
    }
  } catch {
    return undefined
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * Decode at most `cut` source bytes while keeping the returned TEXT within the
 * page byte budget. Valid UTF-8 already fits by construction; invalid bytes
 * expand to three-byte U+FFFD, so the cut is reduced to a code-point boundary
 * until the decoded text fits, with a single code point always allowed through.
 */
function fitDecodedCut(
  slice: Uint8Array,
  cut: number,
  budget: number,
): { text: string; cut: number; lossy: boolean } {
  let current = cut
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const decoded = decodeUtf8(slice.subarray(0, current))
    const textBytes = Buffer.byteLength(decoded.text, 'utf8')
    if (textBytes <= budget || current <= 1) {
      return { text: decoded.text, cut: current, lossy: decoded.lossy }
    }
    const scaled = Math.max(1, Math.floor((current * budget) / textBytes))
    const next = Math.max(alignDownToBoundary(slice, scaled), firstSequenceWidth(slice))
    if (next === current) {
      // A single code point larger than the page budget is returned whole so
      // the cursor always advances and no code point is ever split.
      return { text: decoded.text, cut: current, lossy: decoded.lossy }
    }
    current = next
  }
  const fallback = decodeUtf8(slice.subarray(0, 1))
  return { text: fallback.text, cut: 1, lossy: fallback.lossy }
}

/** Largest code-point boundary at or below `index`. */
function alignDownToBoundary(bytes: Uint8Array, index: number): number {
  let position = Math.min(index, bytes.length)
  while (position > 0 && ((bytes[position] ?? 0) & 0xc0) === 0x80) position -= 1
  return position
}

/** Decode bytes strictly, falling back to a lossy decode that is reported. */
function decodeUtf8(bytes: Uint8Array): { text: string; lossy: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), lossy: false }
  } catch {
    return { text: new TextDecoder('utf-8').decode(bytes), lossy: true }
  }
}

/**
 * Longest raw-byte prefix no longer than `maxBytes` that ends on a UTF-8 code
 * point boundary. An invalid lead byte counts as one byte, so binary output
 * still advances the cursor; an incomplete final sequence is not consumed.
 */
function rawUtf8PrefixLength(bytes: Uint8Array, maxBytes: number): number {
  let used = 0
  let index = 0
  while (index < bytes.length) {
    const lead = bytes[index]!
    const width = lead < 0x80 ? 1 : (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1
    if (index + width > bytes.length) break
    if (used + width > maxBytes) break
    used += width
    index += width
  }
  return used
}

/** Byte width of the UTF-8 sequence starting at byte 0; an invalid lead is one byte. */
function firstSequenceWidth(bytes: Uint8Array): number {
  const lead = bytes[0] ?? 0
  return lead < 0x80 ? 1 : (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1
}

/** Encode one recovery cursor for the resource that produced it. */
function encodeRecoveryCursor(resourceId: string, state: RecoveryCursorState): string {
  const payload = JSON.stringify({
    v: 1,
    id: resourceId,
    o: state.stdoutOffset,
    e: state.stderrOffset,
    l: state.lost,
    m: state.stderrStarted,
    so: state.stdoutFromSpill,
    se: state.stderrFromSpill,
  })
  return `${RECOVERY_CURSOR_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}`
}

/** Decode and validate a recovery cursor, rejecting foreign/malformed values. */
function decodeRecoveryCursor(cursor: string, resourceId: string): RecoveryCursorState {
  const invalid = (): NexusError =>
    new NexusError(
      'INVALID_ARGUMENT',
      'the output cursor does not belong to this process; start a new read without a cursor',
    )
  if (!cursor.startsWith(RECOVERY_CURSOR_PREFIX)) throw invalid()
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor.slice(RECOVERY_CURSOR_PREFIX.length), 'base64url').toString('utf8'))
  } catch {
    throw invalid()
  }
  if (parsed === null || typeof parsed !== 'object') throw invalid()
  const record = parsed as Record<string, unknown>
  if (
    record.v !== 1 ||
    record.id !== resourceId ||
    !isOffset(record.o) ||
    !isOffset(record.e) ||
    typeof record.l !== 'boolean' ||
    typeof record.m !== 'boolean' ||
    typeof record.so !== 'boolean' ||
    typeof record.se !== 'boolean'
  ) {
    throw invalid()
  }
  return {
    stdoutOffset: record.o,
    stderrOffset: record.e,
    lost: record.l,
    stderrStarted: record.m,
    stdoutFromSpill: record.so,
    stderrFromSpill: record.se,
  }
}

/** Whether a decoded cursor offset is a usable non-negative byte position. */
function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Resolve with the promise's value, or undefined after the bound. */
async function bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(undefined), timeoutMs)
    timer.unref()
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Render an unknown failure without letting its own stringification throw. */
function describe(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'unprintable failure'
  }
}
