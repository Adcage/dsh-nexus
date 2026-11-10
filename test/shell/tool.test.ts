/**
 * The unified `shell` tool: model-facing contract and integration of the two
 * resource families.
 *
 * Every case drives the real DSH tool pipeline (`ctx.tools.execute` with
 * argument validation and output validation), the real native job registry
 * (`dsh-jobs-local`), the real native terminal registry
 * (`TerminalSessionService`), a real Agent and the real shell-env registry.
 * Only the two *providers* are scripted: the subprocess provider (so no real
 * child process is started) and the terminal backend (so no real PTY is
 * started). Real Windows ConPTY / Git Bash / pwsh behaviour stays a Task 14
 * concern and is never claimed here.
 *
 * @module dsh-nexus/test/shell/tool
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import {
  createUserMessage,
  ToolCallId,
  type ContentBlock,
  type GenerateOptions,
  type StreamChunk,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import {
  TerminalError,
  TerminalSessionService,
  type TerminalBackend,
  type TerminalBackendSession,
  type TerminalBackendSpawnSpec,
  type TerminalReadRequest,
  type TerminalReadResult,
  type TerminalSendOperation,
  type TerminalSendRead,
  type TerminalSendRequest,
  type TerminalSendResult,
  type TerminalSessionStatus,
  type TerminalSignal,
  type TerminalSignalResult,
} from '@deepseek-ai/dsh-terminal'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { NexusError } from '../../src/runtime/errors.ts'
import { AGENT_MAX_TERMINALS } from '../../src/runtime/defaults.ts'
import type { ShellEngine } from '../../src/protocol.ts'
import type { ShellExecutionConfig } from '../../src/shell/engines.ts'
import { createTerminalController, registerTerminalBackends } from '../../src/shell/terminals.ts'
import { createShellTool } from '../../src/shell/tool.ts'
import {
  createScriptedOutputReader,
  mountRecordingSandbox,
  type ModelRouteOptions,
  type ScriptedProcessScript,
  type SubprocessDoubleOptions,
} from '../support/fixtures.ts'
import { createToolHarness, type ToolHarness } from '../support/harness.ts'

/** Absolute working directory for every case; never a relative host path. */
const CWD = process.cwd()

/** Explicit bash: the scripted provider never executes the program. */
const BASH_CONFIG: ShellExecutionConfig = {
  deployment: {},
  terminal: { engine: 'bash', bashPath: process.execPath },
}

/** Explicit pwsh pair; the scripted provider answers the version probe. */
const PWSH_CONFIG: ShellExecutionConfig = {
  deployment: {},
  terminal: { engine: 'pwsh', pwshPath: process.execPath },
}

/** Harnesses owned by this file, disposed once after all cases. */
const open: ToolHarness[] = []

/** Scratch root for real spill files; removed after the suite. */
let spillRoot: string | undefined

afterAll(async () => {
  for (const harness of open.splice(0)) await harness.dispose()
  if (spillRoot !== undefined) rmSync(spillRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Scripted terminal backend: the native backend contract without a PTY.
// ---------------------------------------------------------------------------

/** One interactive send the scripted backend still holds. */
class ScriptedSend implements TerminalSendOperation {
  readonly done: Promise<TerminalSendResult>
  private settled = false
  private resolveDone!: (result: TerminalSendResult) => void

  /**
   * @param onSettled - clears the session's active marker.
   * @param onCancel - records that the backend interrupted the foreground command.
   * @param cancelResult - native facts a cancelled send settles with.
   */
  constructor(
    private readonly onSettled: () => void,
    private readonly onCancel: () => void,
    private readonly cancelResult: TerminalSendResult,
  ) {
    this.done = new Promise<TerminalSendResult>((resolveDone) => {
      this.resolveDone = resolveDone
    })
  }

  /** @returns no incremental output; this scripted terminal buffers in scrollback. */
  readOutput(): TerminalSendRead {
    return { delta: '', truncated: false }
  }

  /**
   * Interrupt the foreground command, as a real PTY interrupt would.
   * @returns false once the operation already settled.
   */
  cancel(): boolean {
    if (this.settled) return false
    this.onCancel()
    this.settle(this.cancelResult)
    return true
  }

  /**
   * Settle the send with native facts.
   * @param result - what the backend reports.
   */
  settle(result: TerminalSendResult): void {
    if (this.settled) return
    this.settled = true
    this.onSettled()
    this.resolveDone(result)
  }

  /** Whether the operation already settled. */
  get isSettled(): boolean {
    return this.settled
  }
}

/** One scripted PTY session with mutable native facts the test drives. */
class ScriptedSession implements TerminalBackendSession {
  motd = 'nexus scripted shell'
  statusValue: TerminalSessionStatus = { kind: 'running' }
  /** Retained scrollback, oldest line first. */
  readonly lines: string[] = []
  /** The native retention latch: some retained output was dropped at some point. */
  dropped = false
  /** Sends the backend received, in call order. */
  readonly sends: { readonly text: string; readonly submit: boolean }[] = []
  /** Signals the backend delivered, in call order. */
  readonly signals: TerminalSignal[] = []
  /** Close reasons, in call order. */
  readonly closes: string[] = []
  /** Foreground interrupts delivered through a cancelled send. */
  interrupts = 0
  /** Fail this many close attempts before succeeding. */
  closeFailures = 0
  /** Foreground process group this scripted session reports. */
  pgid = 4242
  /** Keep sends active until the test settles them. */
  manualSends = false
  /** The currently active send, when one is running. */
  active: ScriptedSend | undefined

  /** @param pid - process id reported by this scripted session. */
  constructor(readonly pid: number) {}

  /**
   * Append one retained line, honouring a scripted retention bound.
   * @param text - one line of output.
   * @param keep - retained line count; older lines are dropped and latch `dropped`.
   */
  append(text: string, keep?: number): void {
    this.lines.push(text)
    if (keep === undefined || this.lines.length <= keep) return
    this.lines.splice(0, this.lines.length - keep)
    this.dropped = true
  }

  /** Native facts of one default settle. */
  private settled(viewport = ''): TerminalSendResult {
    return { viewport, waitReason: 'stdin_read', sessionStatus: this.statusValue, truncated: false }
  }

  startSend(request: TerminalSendRequest): TerminalSendOperation {
    if (this.statusValue.kind === 'exited') throw new Error('scripted PTY session has exited')
    if (this.active !== undefined) {
      throw new TerminalError('scripted PTY session already has an active send', 'SEND_ACTIVE')
    }
    if (request.signal?.aborted === true) throw new Error('scripted PTY send aborted before write')
    this.sends.push({ text: request.text, submit: request.submit })
    const operation = new ScriptedSend(
      () => {
        if (this.active === operation) this.active = undefined
      },
      () => {
        this.interrupts += 1
      },
      { ...this.settled(), waitReason: 'stdin_read' },
    )
    this.active = operation
    request.signal?.addEventListener('abort', () => operation.cancel(), { once: true })
    if (!this.manualSends) operation.settle(this.settled())
    return operation
  }

  /**
   * Settle the active send with explicit native facts.
   * @param facts - overrides for the default settle.
   */
  settleActive(facts: Partial<TerminalSendResult> = {}): void {
    if (this.active === undefined) throw new Error('no scripted send is active')
    this.active.settle({ ...this.settled(), ...facts })
  }

  read(request: TerminalReadRequest): TerminalReadResult {
    const totalLines = this.lines.length
    const offset = request.offset ?? 0
    const count = request.count ?? 500
    if (offset >= totalLines) {
      return { text: '', totalLines, lineBegin: offset, lineEnd: offset, truncated: this.dropped }
    }
    const end = totalLines - offset
    const start = Math.max(0, end - count)
    const text = this.lines.slice(start, end).join('\n')
    const returnedLines = text.length === 0 ? 0 : text.split('\n').length
    return {
      text,
      totalLines,
      lineBegin: offset,
      lineEnd: offset + returnedLines,
      truncated: this.dropped,
    }
  }

  async signal(signal: TerminalSignal): Promise<TerminalSignalResult> {
    this.signals.push(signal)
    return { delivered: true, targetPgid: this.pgid }
  }

  status(): TerminalSessionStatus {
    return this.statusValue
  }

  async close(reason: string): Promise<void> {
    this.closes.push(reason)
    if (this.closeFailures > 0) {
      this.closeFailures -= 1
      throw new Error('scripted PTY cleanup did not confirm quiescence')
    }
    this.statusValue = { kind: 'exited', exitCode: null, signal: 'SIGHUP' }
  }
}

/** Scripted provider for one dialect; records every spawn request. */
class ScriptedBackend implements TerminalBackend {
  readonly spawns: TerminalBackendSpawnSpec[] = []
  readonly sessions: ScriptedSession[] = []
  /** Publish this session instead of a fresh one, so the test holds the object. */
  prepare: ((spec: TerminalBackendSpawnSpec) => ScriptedSession) | undefined

  /** @param type - registered backend type. */
  constructor(readonly type: string) {}

  async spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession> {
    this.spawns.push(spec)
    spec.signal?.throwIfAborted()
    const session = this.prepare?.(spec) ?? new ScriptedSession(this.sessions.length + 1)
    this.sessions.push(session)
    return session
  }
}

// ---------------------------------------------------------------------------
// Harness plumbing
// ---------------------------------------------------------------------------

/** What one case needs from a mounted tool harness. */
interface ShellFixture {
  readonly harness: ToolHarness
  readonly backends: Map<ShellEngine, ScriptedBackend>
  /** Current configuration; a case may replace `value` to simulate a settings change. */
  readonly config: { value: ShellExecutionConfig }
  /** Run one registry call with a caller-owned signal. */
  call(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolExecutionResult>
}

/** Options for one mounted shell tool. */
interface ShellOptions {
  readonly script?: (spec: { readonly argv: readonly string[] }) => ScriptedProcessScript
  readonly subprocess?: SubprocessDoubleOptions
  readonly config?: ShellExecutionConfig
  readonly signal?: AbortSignal
  readonly sessionId?: string
  /** Mount `sandboxPolicy` plus a recording confinement provider. */
  readonly sandbox?: boolean
  /** Scripted terminal backends to register; defaults to bash only. */
  readonly backends?: readonly ShellEngine[]
  /** Register this exact model route for the Agent. */
  readonly model?: ModelRouteOptions
}

/** Monotonic tool-call identity across the suite. */
let callSequence = 0

/** Mount the real pipeline plus both native registries and one shell tool. */
async function openShell(options: ShellOptions = {}): Promise<ShellFixture> {
  const harness = await createToolHarness({
    cwd: CWD,
    ...(options.script === undefined && options.subprocess === undefined
      ? {}
      : { subprocess: { ...options.subprocess, ...(options.script === undefined ? {} : { script: options.script }) } }),
    ...(options.signal === undefined && options.sessionId === undefined && options.model === undefined
      ? {}
      : {
          owner: {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
          },
          ...(options.model === undefined ? {} : { model: options.model }),
        }),
    ...(options.sandbox === true ? { sandbox: { mode: 'workspace-write', workspaceRoot: CWD } } : {}),
  })
  open.push(harness)
  await harness.ctx.plugin(LocalJobRegistry)
  await harness.ctx.plugin(TerminalSessionService)
  await harness.ctx.plugin(ShellEnvRegistry)
  if (options.sandbox === true) await mountRecordingSandbox(harness.ctx)

  const backends = new Map<ShellEngine, ScriptedBackend>()
  for (const engine of options.backends ?? (['bash'] as readonly ShellEngine[])) {
    const backend = new ScriptedBackend(engine === 'pwsh' ? 'nexus-pwsh' : 'nexus-bash')
    harness.ctx.terminals.registerBackend(backend)
    backends.set(engine, backend)
  }
  const config = { value: options.config ?? BASH_CONFIG }
  harness.ctx.tools.register(createShellTool(harness.ctx, () => config.value))
  return {
    harness,
    backends,
    config,
    async call(args, signal = harness.owner.signal) {
      callSequence += 1
      return harness.ctx.tools.execute({
        callId: ToolCallId(`shell-tool-${callSequence}`),
        name: 'shell',
        arguments: args,
        agent: harness.owner.agent,
        signal,
      })
    },
  }
}

/** One registered model stream; used to hold a real Agent turn open. */
function stallingStream(gate: Promise<void>): (options: GenerateOptions) => AsyncIterable<StreamChunk> {
  return async function* stream(): AsyncGenerator<StreamChunk> {
    await gate
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Assert one Nexus failure code on a registry result. */
function expectCode(result: ToolExecutionResult, code: string): void {
  expect(result.isError, JSON.stringify(result)).toBe(true)
  expect(result.error?.info, JSON.stringify(result.error)).toMatchObject({ code })
}

/** Assert a successful registry result and return its canonical value. */
function valueOf(result: ToolExecutionResult): ShellValue {
  if (result.isError) throw new Error(`expected success, got ${JSON.stringify(result.error)}`)
  return result.value as unknown as ShellValue
}

/** Text blocks of one tool result. */
function resultText(result: ToolExecutionResult): string {
  return result.content
    .map((block: ContentBlock) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

/** Text blocks of one inbox message. */
function noticeText(message: UserMessage): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/** Wait until a synchronous condition holds, or fail a bounded test. */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('the expected condition did not become true in time')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
  }
}

/** An absolute path that certainly does not exist on this machine. */
function missingExecutable(name: string): string {
  const path = join(CWD, 'tmp', 'shell-tool-missing', name)
  expect(existsSync(path)).toBe(false)
  return path
}

/** One project-local owned spill file containing the given bytes. */
function writeSpill(name: string, text: string): string {
  if (spillRoot === undefined) {
    const root = join(CWD, 'tmp')
    mkdirSync(root, { recursive: true })
    spillRoot = mkdtempSync(join(root, 'shell-tool-spill-'))
  }
  const path = join(spillRoot, name)
  writeFileSync(path, Buffer.from(text, 'utf8'))
  return path
}

/** Canonical value fields this suite asserts. */
interface ProcessViewJson {
  resourceId: string
  kind: 'process'
  status: 'starting' | 'running' | 'stopping' | 'exited' | 'failed' | 'timed_out' | 'cancelled'
  exitCode: number | null
  signal: string | null
  stopRequested: 'user' | 'timeout' | 'cancel' | 'dispose' | null
  cleanupConfirmed: boolean
}

interface PageJson {
  text: string
  cursor: string
  lossy: boolean
  spillAvailable: boolean
}

interface RecoveryJson {
  stream: 'stdout' | 'stderr'
  source: 'memory' | 'spill' | 'none'
  bytes?: number
  lost: boolean
  reason?: string
}

interface SandboxJson {
  mode: string
  enforcement?: string
  denied: boolean
  runnerFailed?: string
}

interface JobJson {
  id: string
  status: string
  detail?: string
}

interface SessionStatusJson {
  kind: 'running' | 'exited'
  exitCode?: number | null
  signal?: string | null
}

interface TerminalViewJson {
  resourceId: string
  kind: 'terminal'
  engine: ShellEngine
  name?: string
  pid?: number
  sessionStatus: SessionStatusJson
  cleanupUnconfirmed: boolean
}

interface ShellValue {
  mode: string
  family?: 'process' | 'terminal'
  process?: ProcessViewJson
  page?: PageJson
  recovery?: readonly RecoveryJson[]
  background?: boolean
  sandbox?: SandboxJson
  job?: JobJson
  terminal?: TerminalViewJson
  motd?: string
  text?: string
  waitReason?: string
  sessionStatus?: SessionStatusJson
  truncated?: boolean
  cancelled?: boolean
  totalLines?: number
  lineBegin?: number
  lineEnd?: number
  hasOlder?: boolean
  lossy?: boolean
  lossReason?: string
  cursor?: string
  previousCursor?: string
  busy?: boolean
  timedOut?: boolean
  interrupted?: boolean
  targetPgid?: number
  closed?: boolean
  reason?: string
  detail?: string
  processes?: readonly { readonly process: ProcessViewJson; readonly background: boolean }[]
  terminals?: readonly TerminalViewJson[]
}

// ---------------------------------------------------------------------------
// Contract validation
// ---------------------------------------------------------------------------

describe('shell tool contract', () => {
  it('puts shell dialect guidance before the action list in the model-facing description', async () => {
    const shell = await openShell()
    const schema = shell.harness.ctx.tools.schemas().find((tool) => tool.name === 'shell')
    const introduction = schema?.description.split('Actions:')[0]

    expect(introduction).toMatch(/Bash syntax even on Windows/i)
    expect(introduction).toMatch(/pwsh uses PowerShell syntax/i)
    expect(introduction).toMatch(/CMD syntax is not supported/i)
    expect(introduction).toContain('cd /d')
    expect(introduction).toContain('dir /b')
  })

  it('documents engine syntax and the configurable default without inferring CMD from Windows', async () => {
    const shell = await openShell({ config: PWSH_CONFIG })
    const schema = shell.harness.ctx.tools.schemas().find((tool) => tool.name === 'shell')

    expect(schema?.parameters).toMatchObject({
      properties: {
        engine: {
          enum: ['bash', 'pwsh'],
          description: expect.stringMatching(
            /bash selects Bash syntax; pwsh selects PowerShell syntax.*stored terminal setting.*initially bash.*not.*CMD/i,
          ),
        },
      },
    })
  })

  it('recommends cwd instead of embedded cd commands for Windows paths and paths containing spaces', async () => {
    const shell = await openShell()
    const schema = shell.harness.ctx.tools.schemas().find((tool) => tool.name === 'shell')

    expect(schema?.description).toMatch(/Prefer cwd.*instead of embedding cd/i)
    expect(schema?.parameters).toMatchObject({
      properties: {
        cwd: {
          type: 'string',
          description: expect.stringMatching(/Prefer this field over cd in command.*Windows paths.*spaces/i),
        },
      },
    })
  })

  it('describes the command shorthand before the action list and shows a complete run example', async () => {
    const shell = await openShell()
    const schema = shell.harness.ctx.tools.schemas().find((tool) => tool.name === 'shell')
    const introduction = schema?.description.split('Actions:')[0]

    expect(introduction).toContain('{"command":"ls -la"}')
    expect(introduction).toMatch(/the mode is then "run"/i)
    expect(introduction).toMatch(/name the mode only when/i)
  })

  it('declares no required parameter so a command-only call passes argument validation', async () => {
    const shell = await openShell()
    const schema = shell.harness.ctx.tools.schemas().find((tool) => tool.name === 'shell')
    const parameters = schema?.parameters as { required?: string[]; properties: Record<string, unknown> }

    expect(parameters.required).toBeUndefined()
    expect(parameters.properties['mode']).toMatchObject({ type: 'string' })
    expect(parameters.properties['mode']).not.toHaveProperty('required')
  })

  it('runs a command whose call omits the mode', async () => {
    const shell = await openShell({ script: () => ({ exitCode: 0, stdout: 'hi\n' }) })
    const result = await shell.call({ command: 'echo hi' })
    expect(valueOf(result).mode).toBe('run')
  })

  it('names the contradiction when a command is supplied beside another mode', async () => {
    const shell = await openShell()
    const result = await shell.call({ mode: 'read', command: 'echo hi', resourceId: 'nexus-proc-1' })
    expectCode(result, 'INVALID_ARGUMENT')
    expect(resultText(result)).toContain('"command" only applies to the shell mode "run"')
  })

  it('asks for a mode when only a resourceId is supplied', async () => {
    const shell = await openShell()
    const result = await shell.call({ resourceId: 'nexus-proc-1' })
    expectCode(result, 'INVALID_ARGUMENT')
    expect(resultText(result)).toContain('give "mode" to say what to do with "resourceId"')
  })

  it('explains both call shapes when nothing is supplied', async () => {
    const shell = await openShell()
    const result = await shell.call({})
    expectCode(result, 'INVALID_ARGUMENT')
    expect(resultText(result)).toContain('{"command":"ls -la"}')
  })

  it('explains that open creates a terminal without running a command and is then driven by send and close', async () => {
    const shell = await openShell()
    const description = shell.harness.ctx.tools.schemas().find((tool) => tool.name === 'shell')?.description

    expect(description).toMatch(/open \(create a persistent interactive terminal; it runs no command/i)
    expect(description).toMatch(/send\/read/i)
    expect(description).toMatch(/released with close/i)
    expect(description).toMatch(/at most 4 per session/i)
  })

  it('distinguishes a terminal stop from a process stop and explains the terminal display name', async () => {
    const shell = await openShell()
    const schema = shell.harness.ctx.tools.schemas().find((tool) => tool.name === 'shell')

    expect(schema?.description).toMatch(/the terminal stays open/i)
    expect(schema?.parameters).toMatchObject({
      properties: {
        name: { description: expect.stringMatching(/list and status/i) },
      },
    })
  })

  it('rejects unknown, irrelevant and malformed fields before any resource exists', async () => {
    const shell = await openShell()
    const invalid: Record<string, unknown>[] = [
      { mode: 'run', command: 'echo hi', resourceId: 'nexus-term-1' },
      { mode: 'run', command: 'echo hi', env: { SECRET: 'model-supplied' } },
      { mode: 'run' },
      { mode: 'run', command: '   ' },
      { mode: 'run', command: 'echo hi', timeoutMs: 0 },
      { mode: 'run', command: 'echo hi', timeoutMs: 600_001 },
      { mode: 'open', text: 'not allowed' },
      { mode: 'send', resourceId: 'nexus-term-1' },
      { mode: 'read', resourceId: 'nexus-term-1', text: 'not allowed' },
      { mode: 'wait', resourceId: 'nexus-term-1', command: 'echo hi' },
      { mode: 'read', resourceId: 'nexus-term-1', limit: 0 },
      { mode: 'list', command: 'echo hi' },
    ]
    for (const args of invalid) {
      const result = await shell.call(args)
      expectCode(result, 'INVALID_ARGUMENT')
    }

    // The schema rejects null/type tricks with the native INVALID_ARGS code;
    // the tool does not get to translate a rejected argument shape.
    const nullTricks: Record<string, unknown>[] = [
      { mode: 'run', command: 'echo hi', timeoutMs: null },
      { mode: 'send', resourceId: 'nexus-term-1', text: 'hi', submit: null },
      { mode: 'wait', resourceId: 'nexus-term-1', timeoutMs: null },
      { mode: 'open', cwd: 42 },
      { mode: 'run', command: 'echo hi', engine: 'cmd' },
      { mode: 'wait', resourceId: 'nexus-term-1', timeoutMs: 1.5 },
      { mode: 'explode' },
    ]
    for (const args of nullTricks) {
      const result = await shell.call(args)
      expect(result.isError).toBe(true)
      expect(result.error?.info?.code).toBe('INVALID_ARGS')
    }

    expect(shell.harness.subprocess.spawns).toHaveLength(0)
    expect(shell.backends.get('bash')?.spawns).toHaveLength(0)
  })

  it('routes each handle only to the family that minted it', async () => {
    const shell = await openShell({ script: () => ({ staysOpen: true }), backends: ['bash', 'pwsh'] })
    const started = valueOf(await shell.call({ mode: 'run', command: 'sleep 60', background: true }))
    const processId = started.process!.resourceId
    expect(processId).toMatch(/^nexus-shell-/)

    const opened = valueOf(await shell.call({ mode: 'open' }))
    const terminalId = opened.terminal!.resourceId
    expect(terminalId).toMatch(/^nexus-term-/)

    expect(valueOf(await shell.call({ mode: 'status', resourceId: processId }))).toMatchObject({
      mode: 'status',
      family: 'process',
    })
    expect(valueOf(await shell.call({ mode: 'status', resourceId: terminalId }))).toMatchObject({
      mode: 'status',
      family: 'terminal',
    })

    // A native PTY id, an unknown job id and an unrelated string are never
    // handed to either controller.
    for (const resourceId of ['pty-1', 'nexus-shell-0000000000000000', 'not-a-resource']) {
      expectCode(await shell.call({ mode: 'status', resourceId }), 'RESOURCE_NOT_AVAILABLE')
      expectCode(await shell.call({ mode: 'stop', resourceId }), 'RESOURCE_NOT_AVAILABLE')
      expectCode(await shell.call({ mode: 'close', resourceId }), 'RESOURCE_NOT_AVAILABLE')
    }

    // A live Agent from another session is not authorized for either family.
    const foreign = await shell.harness.ctx.agents.create({ sessionId: SessionId('shell-tool-foreign') })
    for (const resourceId of [processId, terminalId]) {
      const denied = await shell.harness.ctx.tools.execute({
        callId: ToolCallId(`shell-tool-foreign-${resourceId}`),
        name: 'shell',
        arguments: { mode: 'status', resourceId },
        agent: foreign.agent,
        signal: new AbortController().signal,
      })
      expectCode(denied, 'RESOURCE_NOT_AVAILABLE')
    }
    await foreign.dispose()

    // A restarted session that happens to reuse the session id has a different
    // live Agent, so it owns nothing even for an id it once saw.
    const staleSession = 'shell-tool-stale-session'
    const primary = await openShell({ sessionId: staleSession, script: () => ({ staysOpen: true }) })
    const stale = await openShell({ sessionId: staleSession, backends: [] })
    const owned = valueOf(await primary.call({ mode: 'run', command: 'owned', background: true }))
    const staleCall = await stale.harness.ctx.tools.execute({
      callId: ToolCallId('shell-tool-stale-call'),
      name: 'shell',
      arguments: { mode: 'status', resourceId: owned.process!.resourceId },
      agent: stale.harness.owner.agent,
      signal: stale.harness.owner.signal,
    })
    expectCode(staleCall, 'RESOURCE_NOT_AVAILABLE')
    await primary.call({ mode: 'close', resourceId: owned.process!.resourceId })

    await shell.call({ mode: 'close', resourceId: processId })
    await shell.call({ mode: 'close', resourceId: terminalId })
  })
})

// ---------------------------------------------------------------------------
// Ordinary and background processes
// ---------------------------------------------------------------------------

describe('shell run', () => {
  it('starts a fresh process per call with the configured or explicit engine and an optional cwd', async () => {
    const shell = await openShell({
      script: (spec) =>
        spec.argv.at(-1) === '$PSVersionTable.PSVersion.Major' ? { stdout: '7\n' } : { stdout: 'ok\n' },
    })
    const relative = 'sub dir'
    const first = valueOf(await shell.call({ mode: 'run', command: 'pwd', cwd: relative }))
    expect(first.process).toMatchObject({ status: 'exited', exitCode: 0, cleanupConfirmed: true })
    expect(shell.harness.subprocess.spawns[0]?.cwd).toBe(resolve(CWD, relative))
    expect(shell.harness.subprocess.spawns[0]?.argv).toEqual([
      process.execPath,
      '--noprofile',
      '--norc',
      '-c',
      'pwd',
    ])
    // Resolving a relative cwd never changes the DSH session directory.
    expect(shell.harness.owner.agent.session.header.cwd).toBe(CWD)

    const second = valueOf(await shell.call({ mode: 'run', command: 'pwd' }))
    expect(second.process?.resourceId).not.toBe(first.process?.resourceId)
    expect(shell.harness.subprocess.spawns[1]?.cwd).toBe(CWD)

    // The stored settings decide the engine of a call that names none.
    shell.config.value = PWSH_CONFIG
    const third = valueOf(await shell.call({ mode: 'run', command: 'Write-Output 1' }))
    expect(third.process?.resourceId).toMatch(/^nexus-shell-/)
    expect(shell.harness.subprocess.spawns[2]?.argv.at(-1)).toBe('$PSVersionTable.PSVersion.Major')
    expect(shell.harness.subprocess.spawns[3]?.argv.slice(0, 6)).toEqual([
      process.execPath,
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      expect.stringContaining("[Console]::OutputEncoding"),
    ])

    // An explicit engine overrides the setting and never silently falls back.
    const fourth = valueOf(await shell.call({ mode: 'run', command: 'echo bash', engine: 'bash' }))
    expect(fourth.process).toMatchObject({ status: 'exited', cleanupConfirmed: true })
    expect(shell.harness.subprocess.spawns[4]?.argv[1]).toBe('--noprofile')
  })

  it('honours caller cancellation before publication and for a foreground run after it', async () => {
    const early = new AbortController()
    const pre = await openShell({ script: () => ({ staysOpen: true }), signal: early.signal })
    early.abort()
    const cancelled = await pre.call({ mode: 'run', command: 'never starts', background: true })
    expect(cancelled.isError).toBe(true)
    expect(pre.harness.subprocess.spawns).toHaveLength(0)

    const live = new AbortController()
    const shell = await openShell({ script: () => ({ staysOpen: true }), signal: live.signal })
    const foreground = shell.call({ mode: 'run', command: 'foreground work' })
    await until(() => shell.harness.subprocess.spawns.length === 1)
    live.abort()
    const settled = await foreground
    expect(settled.isError).toBe(true)
    // Cancellation is the pipeline's native fact; the managed range was still
    // stopped through the ownership path.
    expect(['ABORTED', 'RESOURCE_NOT_AVAILABLE']).toContain(settled.error?.info?.code)
    const observer = new AbortController()
    const list = valueOf(await shell.call({ mode: 'list' }, observer.signal))
    expect(list.processes).toHaveLength(1)
    expect(list.processes?.[0]?.process).toMatchObject({ stopRequested: 'cancel', cleanupConfirmed: true })
  })

  it('detaches a published background run from the tool-call signal', async () => {
    const live = new AbortController()
    const shell = await openShell({ script: () => ({ staysOpen: true }), signal: live.signal })
    const started = valueOf(await shell.call({ mode: 'run', command: 'background work', background: true }))
    const resourceId = started.process!.resourceId
    live.abort()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    const observer = new AbortController()
    expect(valueOf(await shell.call({ mode: 'status', resourceId }, observer.signal)).process).toMatchObject({
      status: 'running',
      stopRequested: null,
    })
    const stopped = valueOf(await shell.call({ mode: 'stop', resourceId }, observer.signal))
    expect(stopped.process).toMatchObject({ stopRequested: 'user', cleanupConfirmed: true })
  })

  it('reports a non-zero exit explicitly instead of treating it as a tool failure', async () => {
    const shell = await openShell({ script: () => ({ stdout: 'partial', exitCode: 3 }) })
    const result = await shell.call({ mode: 'run', command: 'exit 3' })
    expect(result.isError).toBe(false)
    const value = valueOf(result)
    expect(value.process).toMatchObject({ status: 'exited', exitCode: 3, cleanupConfirmed: true })
    expect(resultText(result)).toContain('exit')
    expect(resultText(result)).toContain('3')
  })

  it('refuses an unavailable engine before a process is created', async () => {
    const shell = await openShell({ config: { deployment: { pwshPath: missingExecutable('nope.exe') }, terminal: { engine: 'pwsh' } } })
    expectCode(await shell.call({ mode: 'run', command: 'echo hi' }), 'SHELL_UNAVAILABLE')
    expect(shell.harness.subprocess.spawns).toHaveLength(0)
  })

  it('publishes a background run, keeps a wait timeout harmless, and separates stop from close', async () => {
    const shell = await openShell({ script: () => ({ staysOpen: true }) })
    const startedResult = await shell.call({ mode: 'run', command: 'long work', background: true })
    const started = valueOf(startedResult)
    expect(started.background).toBe(true)
    expect(started.process?.status).toBe('running')
    const resourceId = started.process!.resourceId
    // A timeout is a `wait` fact only: a non-wait action must not publish it.
    expect(startedResult.meta).toMatchObject({ mode: 'run' })
    expect(startedResult.meta).not.toHaveProperty('timedOut')

    const status = valueOf(await shell.call({ mode: 'status', resourceId }))
    expect(status).toMatchObject({ mode: 'status', family: 'process', background: true })
    expect(status.job?.id).toBe(resourceId)
    expect(status.job?.status).toBe('running')

    const timedResult = await shell.call({ mode: 'wait', resourceId, timeoutMs: 50 })
    const timed = valueOf(timedResult)
    expect(timed.timedOut).toBe(true)
    expect(timed.process?.status).toBe('running')
    // The durable presentation fact records the timeout, so a replayed card keeps
    // the timeout stage instead of a settled one.
    expect(timedResult.meta).toMatchObject({ mode: 'wait', timedOut: true })
    expect(resultText(await shell.call({ mode: 'wait', resourceId, timeoutMs: 50 }))).toContain(
      'not completion',
    )

    const stopped = valueOf(await shell.call({ mode: 'stop', resourceId }))
    expect(stopped.process).toMatchObject({ stopRequested: 'user', cleanupConfirmed: true })
    // stop keeps control; only close forgets the resource.
    expect(valueOf(await shell.call({ mode: 'status', resourceId })).process?.resourceId).toBe(resourceId)

    const closed = valueOf(await shell.call({ mode: 'close', resourceId }))
    expect(closed).toMatchObject({ closed: true })
    expectCode(await shell.call({ mode: 'status', resourceId }), 'RESOURCE_NOT_AVAILABLE')
  })

  it('keeps unconfirmed cleanup controllable and retryable', async () => {
    let unconfirmed = true
    const shell = await openShell({ script: () => ({ staysOpen: true, cleanupUnconfirmed: () => unconfirmed }) })
    const started = valueOf(await shell.call({ mode: 'run', command: 'stubborn', background: true }))
    const resourceId = started.process!.resourceId

    const stopped = valueOf(await shell.call({ mode: 'stop', resourceId }))
    expect(stopped.process).toMatchObject({ status: 'stopping', cleanupConfirmed: false })
    expect(resultText(await shell.call({ mode: 'stop', resourceId }))).toContain('not confirmed')

    const refused = valueOf(await shell.call({ mode: 'close', resourceId }))
    expect(refused).toMatchObject({ closed: false, reason: 'cleanup-unconfirmed' })
    // The retained handle is still listed and controllable after the refusal.
    expect(valueOf(await shell.call({ mode: 'list' })).processes).toHaveLength(1)

    unconfirmed = false
    const retried = valueOf(await shell.call({ mode: 'close', resourceId }))
    expect(retried).toMatchObject({ closed: true })
  })
})

// ---------------------------------------------------------------------------
// Output reads
// ---------------------------------------------------------------------------

describe('shell read for processes', () => {
  it('returns bounded byte pages with an opaque cursor and no spill path', async () => {
    const original = `${'abcdefghij'.repeat(8)}-END`
    const spillPath = writeSpill('complete.log', original)
    const reader = createScriptedOutputReader(original, { memoryBytes: 16, spillPath })
    const shell = await openShell({ script: () => ({ readers: { stdout: reader } }) })

    const started = valueOf(await shell.call({ mode: 'run', command: 'long output' }))
    const resourceId = started.process!.resourceId
    expect(started.page?.lossy).toBe(false)
    expect(started.page?.cursor.startsWith('nxprocread1.')).toBe(true)
    expect(started.recovery).toContainEqual(expect.objectContaining({ stream: 'stdout', source: 'spill' }))
    expect(JSON.stringify(started)).not.toContain(spillPath)

    let cursor = started.page!.cursor
    let text = started.page!.text
    for (let page = 0; page < 16; page += 1) {
      const read = valueOf(await shell.call({ mode: 'read', resourceId, cursor, limit: 24 }))
      expect(read).toMatchObject({ mode: 'read', family: 'process' })
      expect(Buffer.byteLength(read.page!.text, 'utf8')).toBeLessThanOrEqual(24)
      expect(JSON.stringify(read)).not.toContain(spillPath)
      text += read.page!.text
      if (read.page!.text.length === 0) break
      cursor = read.page!.cursor
    }
    expect(text).toBe(original)
    expect(resultText(await shell.call({ mode: 'read', resourceId }))).toContain('byte')
  })

  it('says where the previous page ended when a read restarts at the beginning', async () => {
    const shell = await openShell({ script: () => ({ stdout: 'alpha\nbeta\ngamma\n' }) })
    const started = valueOf(await shell.call({ mode: 'run', command: 'produce lines' }))
    const resourceId = started.process!.resourceId
    const previous = started.page!.cursor
    expect(started.page?.text.length).toBeGreaterThan(0)

    const restarted = await shell.call({ mode: 'read', resourceId, limit: 5 })
    const value = valueOf(restarted)
    expect(value.previousCursor).toBe(previous)
    const text = resultText(restarted)
    expect(text).toContain(previous)
    expect(text).toMatch(/restarted at the beginning/i)

    // A continuation names the cursor, so the notice is not repeated.
    const continued = valueOf(await shell.call({ mode: 'read', resourceId, cursor: previous }))
    expect(continued.previousCursor).toBeUndefined()
  })

  it('does not claim a restart when the resource never returned a page', async () => {
    const shell = await openShell({ script: () => ({ staysOpen: true }) })
    const started = valueOf(await shell.call({ mode: 'run', command: 'idle job', background: true }))

    const first = valueOf(await shell.call({ mode: 'read', resourceId: started.process!.resourceId }))
    expect(first.previousCursor).toBeUndefined()
  })

  it('reports a dropped head as loss instead of inventing bytes', async () => {    const original = `${'z'.repeat(200)}-TAIL`
    const reader = createScriptedOutputReader(original, { memoryBytes: 16 })
    const shell = await openShell({ script: () => ({ readers: { stdout: reader } }) })
    const started = valueOf(await shell.call({ mode: 'run', command: 'lossy' }))
    expect(started.page?.lossy).toBe(true)
    expect(started.recovery).toContainEqual(
      expect.objectContaining({ stream: 'stdout', lost: true, reason: 'retention' }),
    )
    const text = resultText(await shell.call({ mode: 'read', resourceId: started.process!.resourceId }))
    expect(text).toContain('loss')
  })

  it('rejects cross-family, cross-resource and malformed cursors', async () => {
    const shell = await openShell({ script: () => ({ stdout: 'cursor source' }), backends: ['bash'] })
    const first = valueOf(await shell.call({ mode: 'run', command: 'one' }))
    const second = valueOf(await shell.call({ mode: 'run', command: 'two' }))
    const opened = valueOf(await shell.call({ mode: 'open' }))
    const cursor = first.page!.cursor

    expectCode(
      await shell.call({ mode: 'read', resourceId: second.process!.resourceId, cursor }),
      'INVALID_ARGUMENT',
    )
    expectCode(
      await shell.call({ mode: 'read', resourceId: first.process!.resourceId, cursor: 'garbage' }),
      'INVALID_ARGUMENT',
    )
    // A terminal cursor is never decoded by the process family.
    const terminalCursor = valueOf(await shell.call({ mode: 'read', resourceId: opened.terminal!.resourceId, limit: 1 }))
    expectCode(
      await shell.call({
        mode: 'read',
        resourceId: first.process!.resourceId,
        cursor: terminalCursor.cursor ?? 'nxterm1.missing',
      }),
      'INVALID_ARGUMENT',
    )
    await shell.call({ mode: 'close', resourceId: opened.terminal!.resourceId })
  })
})

// ---------------------------------------------------------------------------
// Persistent terminals
// ---------------------------------------------------------------------------

describe('shell terminals', () => {
  it('opens the configured engine, forwards a display name and a resolved cwd', async () => {
    const shell = await openShell({ config: PWSH_CONFIG, backends: ['bash', 'pwsh'] })
    const opened = valueOf(await shell.call({ mode: 'open', cwd: 'inner dir', name: 'worker' }))
    expect(opened).toMatchObject({ mode: 'open', motd: 'nexus scripted shell' })
    expect(opened.terminal).toMatchObject({ kind: 'terminal', engine: 'pwsh', name: 'worker' })
    expect(shell.backends.get('pwsh')?.spawns[0]).toMatchObject({ cwd: resolve(CWD, 'inner dir'), name: 'worker' })
    expect(shell.backends.get('bash')?.spawns).toHaveLength(0)
    await shell.call({ mode: 'close', resourceId: opened.terminal!.resourceId })
  })

  it('sends raw text with submit defaulting to true and never changes the session directory', async () => {
    const shell = await openShell()
    const opened = valueOf(await shell.call({ mode: 'open' }))
    const resourceId = opened.terminal!.resourceId
    const session = shell.backends.get('bash')!.sessions[0]!

    const sent = valueOf(await shell.call({ mode: 'send', resourceId, text: "cd '目录 with space'" }))
    expect(sent).toMatchObject({
      mode: 'send',
      family: 'terminal',
      waitReason: 'stdin_read',
      cancelled: false,
      text: '',
    })
    expect(session.sends).toEqual([{ text: "cd '目录 with space'", submit: true }])
    expect(shell.harness.owner.agent.session.header.cwd).toBe(CWD)

    const typed = valueOf(await shell.call({ mode: 'send', resourceId, text: 'partial', submit: false }))
    expect(typed.cancelled).toBe(false)
    expect(session.sends[1]).toEqual({ text: 'partial', submit: false })

    // A second concurrent send is refused by the native registry, not wrapped.
    session.manualSends = true
    const firstSend = shell.call({ mode: 'send', resourceId, text: 'long command' })
    await until(() => session.active !== undefined)
    const busy = await shell.call({ mode: 'send', resourceId, text: 'second' })
    expect(busy.isError).toBe(true)
    // The native TerminalError's code stays in its message; the registry does
    // not invent a Nexus code for a native refusal.
    expect(String(busy.error?.message)).toContain('already has an active send')
    session.settleActive()
    expect(valueOf(await firstSend).cancelled).toBe(false)

    await shell.call({ mode: 'close', resourceId })
  })

  it('reports a delivered interrupt and a cancellation as facts, not as success or exit', async () => {
    const shell = await openShell()
    const opened = valueOf(await shell.call({ mode: 'open' }))
    const resourceId = opened.terminal!.resourceId
    const session = shell.backends.get('bash')!.sessions[0]!

    const stopped = valueOf(await shell.call({ mode: 'stop', resourceId }))
    expect(stopped).toMatchObject({ interrupted: true, targetPgid: 4242 })
    expect(session.signals).toEqual(['SIGINT'])
    // stop is not close: the terminal is still controllable.
    expect(valueOf(await shell.call({ mode: 'status', resourceId })).terminal?.resourceId).toBe(resourceId)

    session.manualSends = true
    const controller = new AbortController()
    const pending = shell.call({ mode: 'send', resourceId, text: 'sleep 60' }, controller.signal)
    await until(() => session.active !== undefined)
    controller.abort()
    // The registry preserves caller cancellation as the native ABORTED failure;
    // the native foreground interrupt still ran and the terminal stayed open.
    const cancelled = await pending
    expect(cancelled.isError).toBe(true)
    expect(cancelled.error?.info?.code).toBe('ABORTED')
    expect(session.interrupts).toBe(1)
    expect(session.sends.at(-1)).toEqual({ text: 'sleep 60', submit: true })
    expect(valueOf(await shell.call({ mode: 'status', resourceId })).terminal?.resourceId).toBe(resourceId)
    await shell.call({ mode: 'close', resourceId })
  })

  it('reads newest-relative line pages without claiming an inferred idle is an exit', async () => {
    const shell = await openShell()
    const opened = valueOf(await shell.call({ mode: 'open' }))
    const resourceId = opened.terminal!.resourceId
    const session = shell.backends.get('bash')!.sessions[0]!
    for (const line of ['one', 'two', 'three', 'four']) session.append(line)

    const newest = valueOf(await shell.call({ mode: 'read', resourceId, limit: 2 }))
    expect(newest).toMatchObject({ mode: 'read', family: 'terminal', totalLines: 4, hasOlder: true })
    expect(newest.text).toBe('three\nfour')
    expect(newest.cursor).toMatch(/^nxterm1\./)

    const older = valueOf(await shell.call({ mode: 'read', resourceId, cursor: newest.cursor!, limit: 2 }))
    expect(older.text).toBe('one\ntwo')
    expect(older.hasOlder).toBe(false)
    expect(older.cursor).toBeUndefined()
    // The terminal family's continuation unit is a line, not a byte.
    expect(resultText(await shell.call({ mode: 'read', resourceId }))).toContain('line')

    session.manualSends = true
    const send = shell.call({ mode: 'send', resourceId, text: 'slow' })
    await until(() => session.active !== undefined)
    session.settleActive({ waitReason: 'inferred_idle', sessionStatus: { kind: 'running' } })
    const sendResult = await send
    const settled = valueOf(sendResult)
    expect(settled).toMatchObject({ waitReason: 'inferred_idle', cancelled: false })
    expect(resultText(sendResult)).toContain('inferred idle')
    await shell.call({ mode: 'close', resourceId })
  })

  it('reports a wait timeout and a session exit without inventing command success', async () => {
    const shell = await openShell()
    const opened = valueOf(await shell.call({ mode: 'open' }))
    const resourceId = opened.terminal!.resourceId
    const session = shell.backends.get('bash')!.sessions[0]!

    const timedResult = await shell.call({ mode: 'wait', resourceId, timeoutMs: 50 })
    const timed = valueOf(timedResult)
    expect(timed).toMatchObject({ timedOut: true, waitReason: 'timeout' })
    expect(timedResult.meta).toMatchObject({ mode: 'wait', timedOut: true })
    expect(resultText(await shell.call({ mode: 'wait', resourceId, timeoutMs: 50 }))).toContain('not an exit')

    session.statusValue = { kind: 'exited', exitCode: 0, signal: null }
    const exitedResult = await shell.call({ mode: 'wait', resourceId, timeoutMs: 50 })
    const exited = valueOf(exitedResult)
    expect(exited).toMatchObject({ timedOut: false, waitReason: 'session_exit' })
    // A settled wait keeps a durable `false`, so the stage is not a timeout.
    expect(exitedResult.meta).toMatchObject({ mode: 'wait', timedOut: false })
    expect(exited.sessionStatus).toMatchObject({ kind: 'exited', exitCode: 0 })
    await shell.call({ mode: 'close', resourceId })
  })

  it('keeps unconfirmed terminal cleanup owned and retryable', async () => {
    const shell = await openShell()
    const opened = valueOf(await shell.call({ mode: 'open' }))
    const resourceId = opened.terminal!.resourceId
    const session = shell.backends.get('bash')!.sessions[0]!
    session.closeFailures = 1

    const refusedResult = await shell.call({ mode: 'close', resourceId })
    const refused = valueOf(refusedResult)
    expect(refused).toMatchObject({ closed: false, reason: 'cleanup-unconfirmed' })
    expect(refused.terminal?.cleanupUnconfirmed).toBe(true)
    expect(resultText(refusedResult)).toContain('retained')

    const retried = valueOf(await shell.call({ mode: 'close', resourceId }))
    expect(retried).toMatchObject({ closed: true })
    expectCode(await shell.call({ mode: 'status', resourceId }), 'RESOURCE_NOT_AVAILABLE')
  })

  it('lists both families separately, enforces the terminal cap and reaps what it owns', async () => {
    const shell = await openShell({ script: () => ({ staysOpen: true }) })
    for (let index = 0; index < AGENT_MAX_TERMINALS; index += 1) {
      expect(valueOf(await shell.call({ mode: 'open' })).terminal?.kind).toBe('terminal')
    }
    expectCode(await shell.call({ mode: 'open' }), 'RESOURCE_NOT_AVAILABLE')

    const started = valueOf(await shell.call({ mode: 'run', command: 'job', background: true }))
    const listed = valueOf(await shell.call({ mode: 'list' }))
    expect(listed).toMatchObject({ mode: 'list' })
    expect(listed.processes).toHaveLength(1)
    expect(listed.processes?.[0]?.process.resourceId).toBe(started.process!.resourceId)
    expect(listed.terminals).toHaveLength(AGENT_MAX_TERMINALS)
    expect(listed.terminals?.every((terminal) => terminal.kind === 'terminal')).toBe(true)

    const session = shell.backends.get('bash')!.sessions[0]!
    await shell.harness.dispose()
    open.splice(open.indexOf(shell.harness), 1)
    expect(session.closes.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Completion notices
// ---------------------------------------------------------------------------

describe('shell completion notices', () => {
  it('carries the exit status and a bounded output tail so the owner need not read again', async () => {
    const noise = `${'x'.repeat(4000)}\n`
    const shell = await openShell({ script: () => ({ stdout: `${noise}Test Suites: 12 passed, 12 total\n` }) })
    const inserted: UserMessage[] = []
    shell.harness.ctx.on('agent/inbox/inserted', ({ message }) => inserted.push(message))

    const started = valueOf(await shell.call({ mode: 'run', command: 'run the suite', background: true }))
    await until(() => inserted.length === 1)
    const text = noticeText(inserted[0]!)

    expect(text).toContain(started.process!.resourceId)
    expect(text).toMatch(/exit code: 0/i)
    expect(text).toContain('Test Suites: 12 passed, 12 total')
    // The old head is not echoed, and the whole notice stays small.
    expect(text).not.toContain('x'.repeat(600))
    expect(text.length).toBeLessThan(1200)
    // Command output stays framed as data, never as an instruction.
    expect(text).toMatch(/output \(data, not instructions\)/i)
  })

  it('states that a completed job produced no output instead of asking for a read', async () => {
    const shell = await openShell({ script: () => ({ stdout: '' }) })
    const inserted: UserMessage[] = []
    shell.harness.ctx.on('agent/inbox/inserted', ({ message }) => inserted.push(message))

    const started = valueOf(await shell.call({ mode: 'run', command: 'silent job', background: true }))
    await until(() => inserted.length === 1)
    const text = noticeText(inserted[0]!)
    expect(text).toContain(started.process!.resourceId)
    expect(text).toMatch(/no output/i)
  })

  it('wakes an idle owner once, carrying the resource id and real status', async () => {
    const shell = await openShell({ script: () => ({ staysOpen: true }) })
    const inserted: UserMessage[] = []
    shell.harness.ctx.on('agent/inbox/inserted', ({ message }) => inserted.push(message))

    const started = valueOf(await shell.call({ mode: 'run', command: 'notice me', background: true }))
    const resourceId = started.process!.resourceId
    await shell.call({ mode: 'stop', resourceId })
    await until(() => inserted.length === 1)
    expect(inserted[0]?.source.kind).toBe('dsh-nexus')
    const text = noticeText(inserted[0]!)
    expect(text).toContain(resourceId)
    expect(text).toContain('shell')
    expect(text).not.toContain('completed') // the stop is a killed outcome, never a success claim

    // A second settlement of the same resource cannot produce a second notice.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    expect(inserted).toHaveLength(1)
  })

  it('queues the notice for a busy owner and never reports a collected completion', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const shell = await openShell({
      script: () => ({ staysOpen: true }),
      model: { provider: 'nexus-test', model: 'nexus-test', stream: stallingStream(gate) },
    })
    const agent = shell.harness.owner.agent
    try {
      agent.followup(
        createUserMessage({ content: [{ type: 'text', text: 'hold the turn' }], source: { kind: 'user' } }),
      )
      await until(() => agent.status === 'running')

      const busy = valueOf(await shell.call({ mode: 'run', command: 'busy owner job', background: true }))
      await shell.call({ mode: 'stop', resourceId: busy.process!.resourceId })
      await until(() => agent.inbox.nextStep.some((message) => message.source.kind === 'dsh-nexus'))
      expect(agent.inbox.nextStep.filter((message) => message.source.kind === 'dsh-nexus')).toHaveLength(1)
    } finally {
      release()
      await agent.whenIdle()
    }

    // A caller that waits for the settlement collects it; no extra notice.
    const awaited = valueOf(await shell.call({ mode: 'run', command: 'awaited job', background: true }))
    const waiting = shell.call({ mode: 'wait', resourceId: awaited.process!.resourceId, timeoutMs: 5_000 })
    await until(() =>
      shell.harness.ctx.jobs.list(shell.harness.owner.sessionId).some((job) => job.id === awaited.process!.resourceId),
    )
    await shell.call({ mode: 'stop', resourceId: awaited.process!.resourceId })
    const waited = valueOf(await waiting)
    expect(waited.timedOut).toBe(false)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(agent.inbox.nextStep).toHaveLength(0)
  })

  it('does not notify a settlement during owner disposal', async () => {
    const shell = await openShell({ script: () => ({ staysOpen: true }) })
    const inserted: UserMessage[] = []
    shell.harness.ctx.on('agent/inbox/inserted', ({ message }) => inserted.push(message))
    const started = valueOf(await shell.call({ mode: 'run', command: 'teardown', background: true }))
    expect(started.process?.status).toBe('running')
    await shell.harness.dispose()
    open.splice(open.indexOf(shell.harness), 1)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    expect(inserted).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Policies and service requirements
// ---------------------------------------------------------------------------

describe('shell policy facts and composition', () => {
  it('renders the confinement mode, enforcement and denial fact of a run', async () => {
    const shell = await openShell({ sandbox: true, script: () => ({ stderr: 'permission denied', exitCode: 1 }) })
    const value = valueOf(await shell.call({ mode: 'run', command: 'touch /outside' }))
    expect(value.sandbox).toMatchObject({ mode: 'workspace-write', enforcement: 'partial', denied: true })
    expect(resultText(await shell.call({ mode: 'run', command: 'touch /outside' }))).toContain('denied')
    expect(value.process).toMatchObject({ status: 'exited', exitCode: 1 })
  })

  it.runIf(process.platform === 'win32')(
    'refuses a confined Git Bash start with a named capability error instead of an opaque exit code',
    async () => {
      const shell = await openShell({
        sandbox: true,
        script: () => ({
          stderr:
            '0 [main] bash (4548) C:\\Program Files\\Git\\bin\\bash.exe: *** fatal error - ' +
            'NtCreateDirectoryObject(\\BaseNamedObjects\\msys-2.0S5-df7f0c9bbf0ef292): 0xC0000022\n',
          exitCode: 3221225794,
        }),
      })
      const result = await shell.call({ mode: 'run', command: 'echo hi' })
      expectCode(result, 'UNSUPPORTED_CAPABILITY')
      const message = result.error?.message ?? ''
      expect(message).toContain('3221225794')
      expect(message).toContain('pwsh')
    },
  )

  it('fails clearly when a required native service is absent', async () => {
    const harness = await createToolHarness({ cwd: CWD })
    open.push(harness)
    harness.ctx.tools.register(createShellTool(harness.ctx, () => BASH_CONFIG))
    callSequence += 1
    const run = await harness.ctx.tools.execute({
      callId: ToolCallId(`shell-tool-${callSequence}`),
      name: 'shell',
      arguments: { mode: 'run', command: 'echo hi', background: true },
      agent: harness.owner.agent,
      signal: harness.owner.signal,
    })
    expectCode(run, 'UNSUPPORTED_CAPABILITY')

    const terminal = await harness.ctx.tools.execute({
      callId: ToolCallId(`shell-tool-${callSequence}-open`),
      name: 'shell',
      arguments: { mode: 'open' },
      agent: harness.owner.agent,
      signal: harness.owner.signal,
    })
    expectCode(terminal, 'UNSUPPORTED_CAPABILITY')
  })

  it('never accepts a model-supplied environment on the way to the native spawn', async () => {
    const shell = await openShell()
    const rejected = await shell.call({
      mode: 'run',
      command: 'echo hi',
      env: { DSH_TRUSTED_SOMETHING: '1', BASH_FUNC_x: '2' },
    })
    expectCode(rejected, 'INVALID_ARGUMENT')
    expect(shell.harness.subprocess.spawns).toHaveLength(0)
  })

  it('rejects a pwsh that is not version 7 before the persistent backend spawns', async () => {
    const shell = await openShell({
      config: { deployment: { bashPath: process.execPath, pwshPath: process.execPath }, terminal: { engine: 'pwsh' } },
      backends: [],
      subprocess: { script: () => ({ stdout: '5\n', exitCode: 0 }) },
    })
    // The native backend declares the shared confinement policy on its own cold
    // path, so the registration waits for that service exactly as the shipped
    // `dsh-terminal-bash` row does.
    await shell.harness.ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: CWD })
    const dispose = registerTerminalBackends(shell.harness.ctx, () => shell.config.value)
    try {
      await until(() => shell.harness.ctx.terminals.listBackends().includes('nexus-pwsh'))
      expectCode(await shell.call({ mode: 'open', engine: 'pwsh' }), 'SHELL_UNAVAILABLE')
      // The version probe ran before any persistent terminal was requested.
      expect(shell.harness.subprocess.terminalSpawns).toHaveLength(0)
      expect(shell.harness.subprocess.spawns[0]?.argv.at(-1)).toBe('$PSVersionTable.PSVersion.Major')
    } finally {
      dispose()
    }
  })
})

// Named regressions requested by the Task 5 brief.
describe('named integration regressions', () => {
  it('does_not_reuse_a_terminal_resource_id_after_controller_recreation', async () => {
    const shell = await openShell()
    const first = valueOf(await shell.call({ mode: 'open' }))
    const firstId = first.terminal!.resourceId
    await shell.call({ mode: 'close', resourceId: firstId })

    // A second controller in the same context mints a distinct identity, so an
    // old id cannot address a new terminal.
    const other = createTerminalController(shell.harness.ctx, () => shell.config.value)
    const reopened = await other.open(shell.harness.owner)
    expect(reopened.terminal.resourceId).not.toBe(firstId)
    expect(() => other.read(shell.harness.owner, firstId)).toThrow(NexusError)
    await other.dispose()
  })
})
