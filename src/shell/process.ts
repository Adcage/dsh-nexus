/**
 * One ordinary shell command as a managed process range.
 *
 * The executor resolves a validated engine, verifies PowerShell 7 when that
 * engine is selected, resolves the calling session's standing sandbox policy at
 * this operation boundary, and spawns the complete argv through the native
 * `ctx.subprocess` seam. It never retries unconfined after a failure and never
 * switches engines.
 *
 * Lifecycle truth is the provider's, not the parent command's: `handle.done`
 * only reports the top-level process, so settlement terminates the owned range
 * and asks `waitForExit` to prove it empty. A range that cannot be confirmed
 * stays `stopping` with `cleanupConfirmed: false`.
 *
 * @module dsh-nexus/shell/process
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  SandboxUnavailableError,
  classifyRunnerFailure,
  isRunnerSpawnFailure,
  matchesSignature,
  type ConfinedArgv,
  type RunnerFailureRule,
  type SandboxEnforcement,
  type SandboxExecutionPolicy,
  type SandboxMode,
  type SandboxPolicy,
} from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import {
  SubprocessExecutableNotFoundError,
  scrubbedParentEnv,
  type SubprocessRuntime,
  type SubprocessHandle,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { OutputPage, ProcessStatus, ProcessStopCause, ProcessView, ShellEngine } from '../protocol.ts'
import { NexusError } from '../runtime/errors.ts'
import {
  COMMAND_CLEANUP_GRACE_MS,
  COMMAND_DEFAULT_TIMEOUT_MS,
  COMMAND_MAX_TIMEOUT_MS,
  COMMAND_MIN_TIMEOUT_MS,
  PROCESS_OUTPUT_MEMORY_BYTES,
  PROCESS_OUTPUT_SPILL_BYTES,
} from '../runtime/defaults.ts'
import { resolveEngine, type ShellEngineSpec, type ShellExecutionConfig } from './engines.ts'
import { ManagedOutput } from './output.ts'
import type { CallOwner } from '../runtime/owner.ts'

/** One command start request; cwd is already resolved by the caller. */
export interface RunInput {
  /** Command text passed as one argv element to the selected shell's `-c`/`-Command`. */
  readonly command: string
  /** Absolute working directory for this start; never the session's mutable cwd. */
  readonly cwd: string
  /** Engine to start; defaults to the stored terminal engine (`bash` initially). */
  readonly engine?: ShellEngine
  /** Command timeout in milliseconds; defaults to 120 000 and is bounded 1..600 000. */
  readonly timeoutMs?: number
  /** Extra child environment entries; `DSH_*` and `BASH_FUNC_*` entries here are ignored. */
  readonly env?: Readonly<Record<string, string>>
}

/** Confinement facts retained on the host side for the tool layer to render. */
export interface ManagedSandboxFacts {
  /** Policy mode this execution ran under. */
  readonly mode: SandboxMode
  /** How completely the selected backend enforces the policy; absent for full access. */
  readonly enforcement?: SandboxEnforcement
  /** A non-zero exit whose stderr matched the active backend's denial dialect. */
  readonly denied: boolean
  /** Fatal runner diagnostic: the command never ran under confinement. */
  readonly runnerFailed?: string
}

/**
 * A live ordinary process. Host-only: never placed in `src/protocol.ts` or sent
 * to the console. Task 5 consumes this type for jobs and stop/status control.
 */
export interface ManagedProcess {
  /** Host-assigned opaque id used by cursors and the tool layer. */
  readonly resourceId: string
  /** The provider handle; the native `done` is the parent outcome only, not range proof. */
  readonly handle: SubprocessHandle
  /** Confinement facts as currently known, or undefined for an unconfined start. */
  readonly sandbox: ManagedSandboxFacts | undefined
  /** Truthful reason cleanup could not be confirmed, when one exists. */
  readonly cleanupError: string | undefined
  /** Current lifecycle view; updates while cleanup is outstanding. */
  view(): ProcessView
  /**
   * Read the next bounded output page.
   * @param cursor - cursor returned by the previous read.
   * @param limit - byte cap; clamped to the 16 KiB page maximum.
   */
  read(cursor?: string, limit?: number): Promise<OutputPage>
  /**
   * Request termination of the owned range. Idempotent; the first cause wins.
   * @param cause - user stop, timeout, caller cancellation or disposal.
   * @returns the settled view (possibly `stopping` when cleanup is unconfirmed).
   */
  stop(cause: ProcessStopCause): Promise<ProcessView>
  /** Settles after the parent outcome and one bounded cleanup attempt. */
  readonly done: Promise<ProcessView>
}

/** UTF-8 pinning for PowerShell; the collector decodes output bytes as UTF-8. */
const PWSH_ENCODING_PREAMBLE =
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); '

/** Time budget of the PowerShell version probe; separate from command timeouts. */
const PWSH_VERSION_PROBE_TIMEOUT_MS = 10_000

/** The probe program: PowerShell prints its own major version. */
const PWSH_VERSION_PROBE_COMMAND = '$PSVersionTable.PSVersion.Major'

/**
 * Start one managed ordinary process.
 * @param ctx - context providing `subprocess`, `sandboxPolicy`, `sandbox` and `shellEnv`.
 * @param owner - exact caller authority and cancellation.
 * @param input - command, absolute cwd and optional engine/timeout/env.
 * @param config - deployment and stored terminal settings.
 * @param execution - the original tool execution; required for trusted `DSH_*` facts.
 * @returns the managed process after the provider published a handle.
 * @throws NexusError `SHELL_UNAVAILABLE` for an unusable engine/startup, `INVALID_ARGUMENT` for bad input.
 */
export async function startProcess(
  ctx: Context,
  owner: CallOwner,
  input: RunInput,
  config: ShellExecutionConfig,
  execution: ToolExecution,
): Promise<ManagedProcess> {
  if (execution.agent !== owner.agent) {
    throw new NexusError(
      'INVALID_ARGUMENT',
      'startProcess needs the original tool execution of the calling owner; another session context cannot supply trusted shell facts',
    )
  }
  if (input.command.trim().length === 0) {
    throw new NexusError('INVALID_ARGUMENT', 'the shell command must not be empty')
  }
  if (!isAbsolute(input.cwd)) {
    throw new NexusError('INVALID_ARGUMENT', `the shell working directory "${input.cwd}" is not absolute`)
  }
  const timeoutMs = resolveTimeout(input.timeoutMs)
  owner.signal.throwIfAborted()

  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new NexusError('SHELL_UNAVAILABLE', 'the shell execution substrate requires the native ctx.subprocess service')
  }
  // Resolve the calling session's policy before any child exists, so a
  // half-mounted confinement composition fails closed without a probe process.
  const policy = resolveCallPolicy(ctx, owner)
  const sandbox = ctx.get('sandbox')
  const engine = input.engine ?? config.terminal.engine ?? 'bash'
  const spec = await resolveEngine(engine, config)
  owner.signal.throwIfAborted()
  const executable = await resolveExecutable(subprocess, spec.executable, owner.signal)
  if (spec.engine === 'pwsh') await assertPowerShell7(subprocess, spec, executable, input.cwd, owner.signal)
  owner.signal.throwIfAborted()

  const rawArgv = engineArgv(spec, executable, input.command)
  let confined: ConfinedExecution | undefined
  let confinedMode: 'read-only' | 'workspace-write' | undefined
  let argv: readonly string[] = rawArgv
  let sandboxFacts: ManagedSandboxFacts | undefined
  if (policy !== undefined) {
    if (policy.mode === 'danger-full-access') {
      sandboxFacts = { mode: policy.mode, denied: false }
    } else {
      if (sandbox === undefined) {
        throw new NexusError(
          'UNSUPPORTED_CAPABILITY',
          `cannot run a ${policy.mode} shell command: ctx.sandboxPolicy is mounted but no ctx.sandbox provider enforces it`,
        )
      }
      const confinedPolicy: SandboxPolicy = { ...policy, mode: policy.mode }
      const wrapped = await sandbox.confine(rawArgv, confinedPolicy, owner.signal)
      confined = { ...wrapped }
      confinedMode = confinedPolicy.mode
      argv = wrapped.argv
      sandboxFacts = { mode: policy.mode, enforcement: wrapped.enforcement, denied: false }
    }
  }

  const spawnSpec: SubprocessSpawnSpec = {
    argv,
    cwd: input.cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: PROCESS_OUTPUT_MEMORY_BYTES, spill: { maxBytes: PROCESS_OUTPUT_SPILL_BYTES } },
      stderr: { maxBytes: PROCESS_OUTPUT_MEMORY_BYTES, spill: { maxBytes: PROCESS_OUTPUT_SPILL_BYTES } },
    },
    graceMs: COMMAND_CLEANUP_GRACE_MS,
    signal: owner.signal,
    env: buildChildEnvironment(ctx, execution, spec.engine, input.env),
  }

  let handle: SubprocessHandle
  try {
    handle = subprocess.spawn(spawnSpec)
  } catch (error) {
    if (confined !== undefined) {
      if (isRunnerSpawnFailure(error, confined.argv[0], input.cwd)) {
        throw new SandboxUnavailableError(confinedMode ?? 'workspace-write', describe(error))
      }
    }
    throw new NexusError('SHELL_UNAVAILABLE', `could not start ${spec.engine} in "${input.cwd}"`, { cause: error })
  }
  return manageProcess(handle, sandboxFacts, confined, owner, timeoutMs)
}

/** The confined facts retained until settlement. */
type ConfinedExecution = ConfinedArgv & {
  /** Fatal runner diagnostics for the selected backend. */
  readonly runnerFailureRules: readonly RunnerFailureRule[]
}

/** The resolved engine argv with the command as its final, separate element. */
function engineArgv(spec: ShellEngineSpec, executable: string, command: string): string[] {
  const commandArg = spec.engine === 'pwsh' ? `${PWSH_ENCODING_PREAMBLE}${command}` : command
  return [executable, ...spec.args, commandArg]
}

/** Validate and default the ordinary-command timeout. */
function resolveTimeout(value: number | undefined): number {
  if (value === undefined) return COMMAND_DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(value) || value < COMMAND_MIN_TIMEOUT_MS || value > COMMAND_MAX_TIMEOUT_MS) {
    throw new NexusError(
      'INVALID_ARGUMENT',
      `the shell timeout must be between ${COMMAND_MIN_TIMEOUT_MS} and ${COMMAND_MAX_TIMEOUT_MS} ms`,
    )
  }
  return Math.floor(value)
}

/** Resolve one executable in the provider's execution world. */
async function resolveExecutable(
  subprocess: SubprocessRuntime,
  executable: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    return await subprocess.resolveExecutable(executable, undefined, signal)
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof SubprocessExecutableNotFoundError) {
      throw new NexusError('SHELL_UNAVAILABLE', `the shell executable "${executable}" was not found in this execution world`, {
        cause: error,
      })
    }
    throw new NexusError('SHELL_UNAVAILABLE', `the shell executable "${executable}" could not be resolved`, {
      cause: error,
    })
  }
}

/** Verify an explicitly selected PowerShell is major version 7 before running commands. */
async function assertPowerShell7(
  subprocess: SubprocessRuntime,
  spec: ShellEngineSpec,
  executable: string,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  const probeSignal = AbortSignal.any([signal, AbortSignal.timeout(PWSH_VERSION_PROBE_TIMEOUT_MS)])
  let handle: SubprocessHandle
  try {
    handle = subprocess.spawn({
      argv: [executable, ...spec.args, PWSH_VERSION_PROBE_COMMAND],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 4096 },
        stderr: { maxBytes: 4096 },
      },
      graceMs: COMMAND_CLEANUP_GRACE_MS,
      signal: probeSignal,
      env: { NO_COLOR: '1' },
    })
  } catch (error) {
    throw new NexusError('SHELL_UNAVAILABLE', `PowerShell 7 at "${executable}" could not be checked`, { cause: error })
  }
  try {
    const outcome = await handle.done
    const version = handle.collected.stdout?.readFrom(0).text ?? ''
    if (outcome.exitCode !== 0) {
      throw new NexusError(
        'SHELL_UNAVAILABLE',
        `PowerShell 7 at "${executable}" did not report a version (exit ${String(outcome.exitCode)})`,
      )
    }
    const match = /(\d+)/.exec(version)
    if (match === null || Number(match[1]) !== 7) {
      throw new NexusError(
        'SHELL_UNAVAILABLE',
        `the selected PowerShell "${executable}" is not PowerShell 7; install PowerShell 7 or set an explicit pwshPath`,
      )
    }
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof NexusError) throw error
    throw new NexusError('SHELL_UNAVAILABLE', `PowerShell 7 at "${executable}" could not be verified`, { cause: error })
  } finally {
    try {
      handle.terminate()
    } catch {
      // A probe that already exited owns nothing further.
    }
    await handle.waitForExit(AbortSignal.timeout(COMMAND_CLEANUP_GRACE_MS)).catch(() => false)
  }
}

/**
 * Resolve the calling session's standing policy at this operation boundary.
 * A mounted jail service without its policy (or the reverse) fails closed
 * instead of silently running unconfined.
 */
function resolveCallPolicy(ctx: Context, owner: CallOwner): SandboxExecutionPolicy | undefined {
  const sandbox = ctx.get('sandbox')
  const policyService: SandboxPolicyService | undefined = ctx.get('sandboxPolicy')
  if (sandbox === undefined && policyService === undefined) return undefined
  if (sandbox === undefined || policyService === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      'shell confinement needs both ctx.sandbox and ctx.sandboxPolicy; refusing to run unconfined',
    )
  }
  try {
    return policyService.resolve({ session: owner.agent.session })
  } catch (error) {
    throw new NexusError('UNSUPPORTED_CAPABILITY', 'the calling session sandbox policy could not be resolved', {
      cause: error,
    })
  }
}

/** Build the explicit child environment: scrubbed parent base plus trusted facts only. */
function buildChildEnvironment(
  ctx: Context,
  execution: ToolExecution,
  engine: ShellEngine,
  callerEnv: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(callerEnv ?? {})) {
    if (/^dsh_/i.test(key) || /^bash_func_/i.test(key)) continue
    environment[key] = value
  }
  environment.NO_COLOR = '1'
  environment.PAGER = 'cat'
  environment.GIT_PAGER = 'cat'
  if (engine === 'bash') environment.TERM = 'dumb'
  // Implicit script sources and inherited shell functions are cleared even if
  // the caller supplied them; each ordinary call starts from shell defaults.
  environment.BASH_ENV = undefined
  environment.ENV = undefined
  for (const key of Object.keys(scrubbedParentEnv())) {
    if (/^bash_func_/i.test(key)) environment[key] = undefined
  }
  const shellEnv: ShellEnvRegistry | undefined = ctx.get('shellEnv')
  if (shellEnv !== undefined) Object.assign(environment, shellEnv.collect(execution))
  return environment
}

/** Install the lifecycle, timeout, output and cleanup state around a live handle. */
function manageProcess(
  handle: SubprocessHandle,
  initialSandbox: ManagedSandboxFacts | undefined,
  confined: ConfinedExecution | undefined,
  owner: CallOwner,
  timeoutMs: number,
): ManagedProcess {
  const resourceId = `proc_${randomUUID()}`
  // Native `done` settles only after the output streams close (or the
  // provider's drain grace), so it is the output-completion fact for the
  // trailing-UTF-8 hold. It is NOT the managed-range cleanup proof used below.
  let outputComplete = false
  void handle.done.then(
    () => {
      outputComplete = true
    },
    () => {
      outputComplete = true
    },
  )
  const output = new ManagedOutput(resourceId, handle.collected, () => outputComplete)
  let status: ProcessStatus = 'running'
  let exitCode: number | null = null
  let signal: string | null = null
  let stopRequested: ProcessStopCause | null = null
  let cleanupConfirmed = false
  let cleanupError: string | undefined
  let sandboxFacts = initialSandbox
  let finalized = false
  let finishPromise: Promise<ProcessView> | undefined
  let timer: NodeJS.Timeout | undefined

  const parentOutcome = handle.done.then(
    (outcome) => ({ outcome }) as const,
    (error: unknown) => ({ error }) as const,
  )

  const view = (): ProcessView => ({
    resourceId,
    kind: 'process',
    status,
    exitCode,
    signal,
    stopRequested,
    cleanupConfirmed,
  })

  async function terminateAndWait(): Promise<boolean> {
    try {
      handle.terminate()
    } catch (error) {
      cleanupError = `the managed process could not be terminated: ${describe(error)}`
      return false
    }
    try {
      const empty = await handle.waitForExit(AbortSignal.timeout(COMMAND_CLEANUP_GRACE_MS))
      if (!empty && cleanupError === undefined) {
        cleanupError = 'the managed process range was still not empty when the cleanup grace expired'
      }
      return empty
    } catch (error) {
      cleanupError = `the managed process range could not be observed: ${describe(error)}`
      return false
    }
  }

  function classifySettlement(): void {
    if (sandboxFacts === undefined) return
    const stderr = readStderrTail(handle)
    if (confined !== undefined) {
      const runnerFailure = classifyRunnerFailure(exitCode, stderr, confined.runnerFailureRules)
      if (runnerFailure !== undefined) {
        sandboxFacts = { ...sandboxFacts, denied: false, runnerFailed: runnerFailure.detail }
        return
      }
      sandboxFacts = { ...sandboxFacts, denied: matchesSignature(exitCode, stderr, confined.denialSignatures) }
    }
  }

  function terminalStatus(): ProcessStatus {
    if (stopRequested === 'timeout') return 'timed_out'
    if (stopRequested === 'cancel') return 'cancelled'
    if (sandboxFacts?.runnerFailed !== undefined) return 'failed'
    return 'exited'
  }

  async function settle(): Promise<ProcessView> {
    const parent = await parentOutcome
    if (timer !== undefined) clearTimeout(timer)
    if ('error' in parent) {
      status = 'failed'
      cleanupError = `the managed process failed before reporting an outcome: ${describe(parent.error)}`
    } else {
      exitCode = parent.outcome.exitCode
      signal = parent.outcome.signal
      classifySettlement()
    }
    const empty = await terminateAndWait()
    cleanupConfirmed = empty
    if (!empty) {
      status = 'stopping'
    } else if (stopRequested !== null) {
      status = terminalStatus()
    } else if ('error' in parent || sandboxFacts?.runnerFailed !== undefined) {
      status = 'failed'
    } else {
      status = 'exited'
    }
    finalized = true
    owner.signal.removeEventListener('abort', onAbort)
    return view()
  }

  function finish(): Promise<ProcessView> {
    finishPromise ??= settle()
    return finishPromise
  }

  async function stop(cause: ProcessStopCause): Promise<ProcessView> {
    if (finalized) {
      if (!cleanupConfirmed) {
        if (stopRequested === null) stopRequested = cause
        const empty = await terminateAndWait()
        cleanupConfirmed = empty
        if (empty) status = terminalStatus()
      }
      return view()
    }
    if (stopRequested === null) stopRequested = cause
    if (status === 'running') status = 'stopping'
    try {
      handle.terminate()
    } catch (error) {
      cleanupError ??= `the managed process could not be terminated: ${describe(error)}`
    }
    return finish()
  }

  function onAbort(): void {
    void stop('cancel')
  }

  timer = setTimeout(() => {
    void stop('timeout')
  }, timeoutMs)
  timer.unref()
  if (owner.signal.aborted) void stop('cancel')
  else owner.signal.addEventListener('abort', onAbort, { once: true })

  return {
    resourceId,
    handle,
    get sandbox() {
      return sandboxFacts
    },
    get cleanupError() {
      return cleanupError
    },
    view,
    async read(cursor, limit) {
      return output.read(cursor, limit)
    },
    stop,
    done: finish(),
  }
}

/** Read the retained stderr tail without consuming any caller cursor. */
function readStderrTail(handle: SubprocessHandle): string {
  try {
    return handle.collected.stderr?.readFrom(0).text ?? ''
  } catch {
    return ''
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
