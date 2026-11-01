/**
 * Persistent-terminal ownership and native backend registration.
 *
 * Every case mounts the shipped in-process terminal registry
 * (`TerminalSessionService`) so PTY identity, owner cleanup and the
 * spawn/send/read/signal rules are the native service's own. Only the *backend*
 * is scripted, because a unit test must not start a real shell: the scripted
 * backend implements the documented backend contract (newest-relative read
 * ranges, one exclusive send, signals, idempotent close) and records what the
 * controller asked for.
 *
 * What the scripted backend cannot prove — that a real git-bash/pwsh PTY behaves
 * this way on Windows — stays a Task 14 concern and is never claimed here.
 *
 * @module dsh-nexus/test/shell/terminals
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
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
import { BashTerminalBackend, type TerminalLocalConfig } from '@deepseek-ai/dsh-terminal-bash'
import { AGENT_MAX_TERMINALS } from '../../src/runtime/defaults.ts'
import { NexusError } from '../../src/runtime/errors.ts'
import type { CallOwner } from '../../src/runtime/owner.ts'
import type { ShellEngine } from '../../src/protocol.ts'
import type { ShellExecutionConfig } from '../../src/shell/engines.ts'
import {
  TERMINAL_BACKEND_BASH,
  TERMINAL_BACKEND_PWSH,
  createNativeTerminalBackend,
  createTerminalController,
  registerTerminalBackends,
  resolveNativeTerminalConfig,
  terminalBackendType,
  type TerminalController,
} from '../../src/shell/terminals.ts'
import { createToolHarness, type ToolHarness } from '../support/harness.ts'

/** Absolute working directory for every case; never a session-relative path. */
const CWD = process.cwd()

/** Harnesses owned by this file, disposed once their cases finish. */
const mounted: ToolHarness[] = []

afterAll(async () => {
  for (const harness of mounted.splice(0)) await harness.dispose()
})

// ---------------------------------------------------------------------------
// Scripted backend: the native backend contract without a real shell.
// ---------------------------------------------------------------------------

/** One interactive send the scripted backend still holds. */
class ScriptedSend implements TerminalSendOperation {
  readonly done: Promise<TerminalSendResult>
  /** The scripted backend interrupted the foreground command because cancel() ran. */
  interrupted = false
  private settled = false
  private resolveDone!: (result: TerminalSendResult) => void

  /**
   * @param onSettled - clears the session's active marker.
   * @param cancelResult - native facts a cancelled send settles with.
   * @param onCancel - records that the backend interrupted the foreground command.
   */
  constructor(
    private readonly onSettled: () => void,
    private readonly cancelResult: TerminalSendResult,
    private readonly onCancel: () => void,
  ) {
    this.done = new Promise<TerminalSendResult>((resolve) => {
      this.resolveDone = resolve
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
    this.interrupted = true
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
class ScriptedNativeSession implements TerminalBackendSession {
  motd = ''
  readonly pid: number
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
  /** Foreground interrupts the backend delivered through a cancelled send. */
  interrupts = 0
  /** Fail this many close attempts before succeeding. */
  closeFailures = 0
  /** Reject `signal()` with this message instead of delivering the interrupt. */
  signalFailure: string | undefined
  /** Foreground process group the backend reports. */
  pgid = 4242
  /** Keep sends active until the test settles them. */
  manualSends = false
  /** The currently active send, when one is running. */
  active: ScriptedSend | undefined
  /** Status samples before the top-level process reports exited. */
  pollsBeforeExit: number | undefined
  private polls = 0

  /** @param pid - the process id this scripted session reports. */
  constructor(pid: number) {
    this.pid = pid
  }

  /**
   * Append retained output, honouring the scripted retention bound.
   * @param text - one line of terminal output.
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
      { ...this.settled(), waitReason: 'stdin_read' },
      () => {
        this.interrupts += 1
      },
    )
    this.active = operation
    // The native backend turns a cancelled wait into a foreground interrupt.
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
    if (this.signalFailure !== undefined) throw new Error(this.signalFailure)
    this.signals.push(signal)
    return { delivered: true, targetPgid: this.pgid }
  }

  status(): TerminalSessionStatus {
    if (this.pollsBeforeExit !== undefined) {
      this.polls += 1
      if (this.polls >= this.pollsBeforeExit) {
        this.statusValue = { kind: 'exited', exitCode: 0, signal: null }
      }
    }
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
class ScriptedTerminalBackend implements TerminalBackend {
  readonly spawns: TerminalBackendSpawnSpec[] = []
  readonly sessions: ScriptedNativeSession[] = []
  /** Held before publication of the next spawn so a case can keep one open pending. */
  gate: Promise<void> | undefined
  /** Publish this session instead of a fresh one, so the test holds the object. */
  prepare: ((spec: TerminalBackendSpawnSpec) => ScriptedNativeSession) | undefined
  /** Reject the next spawn with this value after recording the request. */
  failNextSpawn: unknown

  /** @param type - registered backend type. */
  constructor(readonly type: string) {}

  async spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession> {
    this.spawns.push(spec)
    const gate = this.gate
    this.gate = undefined
    if (gate !== undefined) await Promise.race([gate, aborted(spec.signal)])
    spec.signal?.throwIfAborted()
    if (this.failNextSpawn !== undefined) {
      const failure = this.failNextSpawn
      this.failNextSpawn = undefined
      throw failure
    }
    const session = this.prepare?.(spec) ?? new ScriptedNativeSession(this.sessions.length + 1)
    this.sessions.push(session)
    return session
  }
}

/** Resolve when the signal aborts; never resolves without a signal. */
function aborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal === undefined) return
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

/** What one case needs from a mounted terminal harness. */
interface TerminalHarness {
  readonly harness: ToolHarness
  readonly controller: TerminalController
  readonly terminals: TerminalSessionService
  readonly backends: Map<ShellEngine, ScriptedTerminalBackend>
  /** Current configuration; a case may replace `value` to simulate a settings change. */
  readonly config: { value: ShellExecutionConfig }
}

/** Mount a real harness, the real native terminal registry and the scripted backends. */
async function openTerminalHarness(
  options: {
    readonly signal?: AbortSignal
    readonly sessionId?: string
    /** Scripted backends to register; defaults to both dialects, none means none. */
    readonly engines?: readonly ShellEngine[]
    readonly config?: ShellExecutionConfig
  } = {},
): Promise<TerminalHarness> {
  const harness = await createToolHarness({
    cwd: CWD,
    ...(options.signal === undefined && options.sessionId === undefined
      ? {}
      : {
          owner: {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
          },
        }),
  })
  mounted.push(harness)
  await harness.ctx.plugin(TerminalSessionService)
  const terminals = harness.ctx.terminals
  const backends = new Map<ShellEngine, ScriptedTerminalBackend>()
  for (const engine of options.engines ?? (['bash', 'pwsh'] as readonly ShellEngine[])) {
    const backend = new ScriptedTerminalBackend(terminalBackendType(engine))
    terminals.registerBackend(backend)
    backends.set(engine, backend)
  }
  const config = {
    value: options.config ?? ({ deployment: {}, terminal: { engine: 'bash' } } satisfies ShellExecutionConfig),
  }
  const controller = createTerminalController(harness.ctx, () => config.value)
  return { harness, controller, terminals, backends, config }
}

/** One owner identity for a synthetic tool-call signal against a real Agent. */
function callOwner(shell: TerminalHarness, signal: AbortSignal): CallOwner {
  return { agent: shell.harness.owner.agent, sessionId: shell.harness.owner.sessionId, signal }
}

/** Capture a rejection without failing the test at the await site. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

/** Assert one rejection is a Nexus failure with the expected stable code. */
function expectNexusCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(NexusError)
  expect((error as NexusError).code).toBe(code)
}

/** Let queued injection callbacks and microtasks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve()
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 0))
}

/** An absolute path that certainly does not exist on this machine. */
function missingExecutable(name: string): string {
  const path = join(CWD, 'tmp', 'terminals-missing', name)
  expect(existsSync(path)).toBe(false)
  return path
}

describe('native terminal backends', () => {
  it('resolves the public native configuration for each dialect', () => {
    const bash = resolveNativeTerminalConfig('bash', 'C:/Git/bin/bash.exe')
    expect(bash).toMatchObject({
      backendType: TERMINAL_BACKEND_BASH,
      shellDialect: 'bash',
      shellPath: 'C:/Git/bin/bash.exe',
      shellArgs: ['--noprofile', '--norc', '-i'],
    })
    // The numeric defaults are the shipped config's, not a copy in this package.
    expect(bash.rows).toBe(40)
    expect(bash.cols).toBe(160)
    expect(bash.scrollbackLines).toBe(10_000)
    expect(bash.maxReadBytes).toBeLessThanOrEqual(bash.scrollbackMaxBytes)
    expect(bash.handoffGraceMs).toBeGreaterThanOrEqual(bash.pollIntervalMs)

    const pwsh = resolveNativeTerminalConfig('pwsh', 'C:/pwsh/pwsh.exe')
    expect(pwsh).toMatchObject({
      backendType: TERMINAL_BACKEND_PWSH,
      shellDialect: 'pwsh',
      shellPath: 'C:/pwsh/pwsh.exe',
      shellArgs: ['-NoLogo', '-NoProfile'],
    })
    const typed: TerminalLocalConfig = pwsh
    expect(typed.shellDialect).toBe('pwsh')
  })

  it('constructs the real native BashTerminalBackend under the Nexus backend type', async () => {
    const shell = await openTerminalHarness({ engines: [] })
    const backend = createNativeTerminalBackend(shell.harness.ctx, 'pwsh', 'C:/pwsh/pwsh.exe')
    expect(backend).toBeInstanceOf(BashTerminalBackend)
    expect(backend.type).toBe(TERMINAL_BACKEND_PWSH)
    expect(createNativeTerminalBackend(shell.harness.ctx, 'bash', 'C:/Git/bin/bash.exe').type).toBe(
      TERMINAL_BACKEND_BASH,
    )
  })

  it('mounts both dialects without either program and checks only the chosen engine at first open', async () => {
    const bashPath = missingExecutable('bash-does-not-exist.exe')
    const pwshPath = missingExecutable('pwsh-does-not-exist.exe')
    const shell = await openTerminalHarness({ engines: [] })
    shell.config.value = { deployment: { bashPath, pwshPath }, terminal: { engine: 'bash' } }

    // Registration itself resolves no executable: both dialects mount.
    const dispose = registerTerminalBackends(shell.harness.ctx, () => shell.config.value)
    await settle()
    expect(shell.terminals.listBackends()).toEqual(expect.arrayContaining([TERMINAL_BACKEND_BASH, TERMINAL_BACKEND_PWSH]))
    expect(shell.terminals.listBackends()).toHaveLength(2)

    const bashError = await rejection(shell.controller.open(shell.harness.owner, { engine: 'bash' }))
    expectNexusCode(bashError, 'SHELL_UNAVAILABLE')
    expect((bashError as Error).message).toContain(bashPath)
    expect((bashError as Error).message).not.toContain(pwshPath)
    expect(shell.controller.list(shell.harness.owner)).toHaveLength(0)

    const pwshError = await rejection(shell.controller.open(shell.harness.owner, { engine: 'pwsh' }))
    expectNexusCode(pwshError, 'SHELL_UNAVAILABLE')
    expect((pwshError as Error).message).toContain(pwshPath)
    expect((pwshError as Error).message).not.toContain(bashPath)

    dispose()
  })

  it('resolves the engine again on every open so a changed setting is applied', async () => {
    const first = missingExecutable('first-choice.exe')
    const second = missingExecutable('second-choice.exe')
    const shell = await openTerminalHarness({ engines: [] })
    shell.config.value = { deployment: { pwshPath: first }, terminal: { engine: 'pwsh' } }
    const dispose = registerTerminalBackends(shell.harness.ctx, () => shell.config.value)
    await settle()

    const before = await rejection(shell.controller.open(shell.harness.owner, {}))
    expect((before as Error).message).toContain(first)

    shell.config.value = { deployment: { pwshPath: second }, terminal: { engine: 'pwsh' } }
    const after = await rejection(shell.controller.open(shell.harness.owner, {}))
    expect((after as Error).message).toContain(second)
    expect((after as Error).message).not.toContain(first)

    dispose()
  })

  it('does not leak a duplicate registration and leaves the first contribution effective', async () => {
    const shell = await openTerminalHarness({ engines: [] })
    const first = registerTerminalBackends(shell.harness.ctx, () => shell.config.value)
    const second = registerTerminalBackends(shell.harness.ctx, () => shell.config.value)
    await settle()
    // The native registry rejects the second registration of the same type; the
    // first contribution stays in place and no half-registered dialect appears.
    expect(shell.terminals.listBackends()).toEqual([TERMINAL_BACKEND_BASH, TERMINAL_BACKEND_PWSH])

    second()
    await settle()
    expect(shell.terminals.listBackends()).toEqual([TERMINAL_BACKEND_BASH, TERMINAL_BACKEND_PWSH])

    first()
    await settle()
    expect(shell.terminals.listBackends()).toHaveLength(0)
  })

  it('removes exactly its own backend contribution on unload and can register again', async () => {
    const shell = await openTerminalHarness({ engines: [] })
    const foreign = new ScriptedTerminalBackend('third-party-shell')
    shell.terminals.registerBackend(foreign)

    const dispose = registerTerminalBackends(shell.harness.ctx, () => shell.config.value)
    await settle()
    expect(shell.terminals.listBackends()).toHaveLength(3)

    dispose()
    dispose()
    await settle()
    expect(shell.terminals.listBackends()).toEqual(['third-party-shell'])

    const again = registerTerminalBackends(shell.harness.ctx, () => shell.config.value)
    await settle()
    expect(shell.terminals.listBackends()).toEqual(
      expect.arrayContaining([TERMINAL_BACKEND_BASH, TERMINAL_BACKEND_PWSH, 'third-party-shell']),
    )
    expect(shell.terminals.listBackends()).toHaveLength(3)
    again()
    await settle()
    expect(shell.terminals.listBackends()).toEqual(['third-party-shell'])
  })
})

describe('terminal controller ownership', () => {
  it('refuses a stale Agent that shares the live session id', async () => {
    const primary = await openTerminalHarness({ sessionId: 'terminals-authority' })
    const stale = await openTerminalHarness({ sessionId: 'terminals-authority', engines: [] })
    const staleOwner = callOwner(stale, new AbortController().signal)

    const openError = await rejection(primary.controller.open(staleOwner))
    expectNexusCode(openError, 'RESOURCE_NOT_AVAILABLE')
    expect(primary.backends.get('bash')?.spawns).toHaveLength(0)

    const opened = await primary.controller.open(primary.harness.owner)
    const resourceId = opened.terminal.resourceId

    expectNexusCode(await rejection(primary.controller.send(staleOwner, resourceId, { text: 'hi' })), 'RESOURCE_NOT_AVAILABLE')
    expect(() => primary.controller.read(staleOwner, resourceId)).toThrow(NexusError)
    expect(() => primary.controller.status(staleOwner, resourceId)).toThrow(NexusError)
    expectNexusCode(await rejection(primary.controller.stop(staleOwner, resourceId)), 'RESOURCE_NOT_AVAILABLE')
    expectNexusCode(await rejection(primary.controller.close(staleOwner, resourceId)), 'RESOURCE_NOT_AVAILABLE')
    expect(() => primary.controller.list(staleOwner)).toThrow(NexusError)

    // The stale caller's refusal left the real owner in control.
    expect(primary.controller.status(primary.harness.owner, resourceId).terminal.sessionStatus).toEqual({
      kind: 'running',
    })
    await primary.controller.close(primary.harness.owner, resourceId)
  })

  it('refuses another live Agent of the same context', async () => {
    const shell = await openTerminalHarness()
    const opened = await shell.controller.open(shell.harness.owner)
    const foreign = await shell.harness.ctx.agents.create({ sessionId: SessionId('terminals-other-agent') })
    const foreignOwner: CallOwner = {
      agent: foreign.agent,
      sessionId: SessionId('terminals-other-agent'),
      signal: new AbortController().signal,
    }
    expectNexusCode(await rejection(shell.controller.send(foreignOwner, opened.terminal.resourceId, { text: 'x' })), 'RESOURCE_NOT_AVAILABLE')
    expect(() => shell.controller.read(foreignOwner, opened.terminal.resourceId)).toThrow(NexusError)
    await shell.controller.close(shell.harness.owner, opened.terminal.resourceId)
    await foreign.dispose()
  })

  it('never authorises by a native session id, another resource kind or a foreign handle', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const opened = await shell.controller.open(owner)
    const direct = await shell.terminals.spawn(owner.agent, { type: terminalBackendType('bash') })

    expect(opened.terminal.resourceId).not.toBe(direct.sessionId)
    expect(opened.terminal.kind).toBe('terminal')
    expect(() => shell.controller.read(owner, direct.sessionId)).toThrow(NexusError)
    expect(() => shell.controller.read(owner, 'nexus-shell-1')).toThrow(NexusError)
    expect(() => shell.controller.read(owner, '1')).toThrow(NexusError)
    expect(shell.controller.list(owner)).toHaveLength(1)

    // Teardown clears only this controller's terminal.
    await shell.controller.dispose()
    expect(shell.terminals.list(owner.agent)).toHaveLength(1)
    expect(shell.terminals.list(owner.agent)[0]?.sessionId).toBe(direct.sessionId)
    await shell.terminals.kill(owner.agent, direct.sessionId, 'test cleanup')
  })

  it('caps one owner at four active terminals including pending opens and releases failed starts', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const backend = shell.backends.get('bash')
    expect(backend).toBeDefined()

    // Keep the first open pending: a pending open counts against the cap.
    let releaseGate: () => void = () => undefined
    backend!.gate = new Promise<void>((resolveGate) => {
      releaseGate = resolveGate
    })
    const pending = shell.controller.open(owner)
    for (let index = 0; index < 3; index += 1) await shell.controller.open(owner)

    const capError = await rejection(shell.controller.open(owner))
    expectNexusCode(capError, 'RESOURCE_NOT_AVAILABLE')
    expect((capError as Error).message).toContain(String(AGENT_MAX_TERMINALS))

    releaseGate()
    await pending
    backend!.gate = undefined
    const opened = shell.controller.list(owner)
    expect(opened).toHaveLength(AGENT_MAX_TERMINALS)
    for (const terminal of opened) await shell.controller.close(owner, terminal.resourceId)

    // A refused start must not leak its slot: nine attempts all reach the backend.
    backend!.failNextSpawn = undefined
    const before = backend!.spawns.length
    for (let attempt = 0; attempt < AGENT_MAX_TERMINALS * 2 + 1; attempt += 1) {
      backend!.failNextSpawn = new Error(`scripted start failure ${attempt}`)
      const failure = await rejection(shell.controller.open(owner))
      expect(failure).toBeInstanceOf(Error)
      expectNexusCode(failure, 'SHELL_UNAVAILABLE')
    }
    expect(backend!.spawns.length).toBe(before + AGENT_MAX_TERMINALS * 2 + 1)
    expect(shell.controller.list(owner)).toHaveLength(0)
  })

  it('releases the reservation when an open is cancelled before publication', async () => {
    const controller = new AbortController()
    const shell = await openTerminalHarness({ signal: controller.signal })
    const backend = shell.backends.get('bash')
    backend!.gate = new Promise<void>(() => undefined)

    const opening = shell.controller.open(shell.harness.owner)
    controller.abort()
    const failure = await rejection(opening)
    expectNexusCode(failure, 'RESOURCE_NOT_AVAILABLE')
    expect(shell.controller.list(shell.harness.owner)).toHaveLength(0)
    expect(shell.terminals.list(shell.harness.owner.agent)).toHaveLength(0)

    // The slot is free again for a caller that is not cancelled.
    backend!.gate = undefined
    const fresh = new AbortController()
    const reopened = await shell.controller.open({ ...shell.harness.owner, signal: fresh.signal })
    expect(reopened.terminal.resourceId).toMatch(/^nexus-term-/)
  })
})

describe('terminal open', () => {
  it('starts the stored engine, forwards the owner directory and keeps dialects separate', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner

    const bash = await shell.controller.open(owner)
    expect(bash.terminal.engine).toBe('bash')
    expect(shell.backends.get('bash')?.spawns).toHaveLength(1)
    expect(shell.backends.get('pwsh')?.spawns).toHaveLength(0)
    const bashSpec = shell.backends.get('bash')!.spawns[0]!
    expect(bashSpec.type).toBe(TERMINAL_BACKEND_BASH)
    // No cwd override: the native backend resolves the owner's session directory.
    expect(bashSpec.cwd).toBeUndefined()

    const pwsh = await shell.controller.open(owner, { engine: 'pwsh', cwd: join(CWD, 'tmp'), name: 'second' })
    expect(pwsh.terminal.engine).toBe('pwsh')
    expect(pwsh.terminal.name).toBe('second')
    const pwshSpec = shell.backends.get('pwsh')!.spawns[0]!
    expect(pwshSpec.type).toBe(TERMINAL_BACKEND_PWSH)
    expect(pwshSpec.cwd).toBe(join(CWD, 'tmp'))
    expect(pwshSpec.name).toBe('second')

    // The stored engine is read per open, and existing terminals are untouched.
    shell.config.value = { deployment: {}, terminal: { engine: 'pwsh' } }
    const next = await shell.controller.open(owner)
    expect(next.terminal.engine).toBe('pwsh')
    expect(shell.backends.get('pwsh')?.spawns).toHaveLength(2)
    expect(shell.backends.get('bash')?.spawns).toHaveLength(1)
    expect(shell.controller.list(owner)).toHaveLength(3)
  })

  it('validates the open request before a backend is asked to start', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    expectNexusCode(await rejection(shell.controller.open(owner, { cwd: 'relative/dir' })), 'INVALID_ARGUMENT')
    expectNexusCode(await rejection(shell.controller.open(owner, { name: '' })), 'INVALID_ARGUMENT')
    expectNexusCode(
      await rejection(shell.controller.open(owner, { engine: 'cmd' as ShellEngine })),
      'INVALID_ARGUMENT',
    )
    expect(shell.backends.get('bash')?.spawns).toHaveLength(0)
  })

  it('fails clearly when no backend is registered for the chosen engine', async () => {
    const shell = await openTerminalHarness({ engines: [] })
    const error = await rejection(shell.controller.open(shell.harness.owner, { engine: 'pwsh' }))
    expectNexusCode(error, 'UNSUPPORTED_CAPABILITY')
    expect((error as Error).message).toContain(TERMINAL_BACKEND_PWSH)
  })
})

describe('terminal send and wait', () => {
  it('forwards raw text once with submit defaulting to true and never moves the session cwd', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const before = owner.agent.session.header.cwd

    const sent = await shell.controller.send(owner, opened.terminal.resourceId, { text: 'cd /tmp && echo 中文 \n' })
    expect(session.sends).toEqual([{ text: 'cd /tmp && echo 中文 \n', submit: true }])
    expect(sent.waitReason).toBe('stdin_read')
    expect(sent.cancelled).toBe(false)

    await shell.controller.send(owner, opened.terminal.resourceId, { text: 'ls', submit: false })
    expect(session.sends[1]).toEqual({ text: 'ls', submit: false })

    // Terminal-internal state is the PTY's; the DSH session directory is not touched.
    expect(owner.agent.session.header.cwd).toBe(before)
  })

  it('rejects a second send while one is active and accepts one after settlement', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    session.manualSends = true
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const resourceId = opened.terminal.resourceId

    const first = shell.controller.send(owner, resourceId, { text: 'sleep 60' })
    await settle()
    expect(shell.controller.status(owner, resourceId).busy).toBe(true)
    const busy = await rejection(shell.controller.send(owner, resourceId, { text: 'echo busy' }))
    expect(busy).toBeInstanceOf(TerminalError)
    expect((busy as TerminalError).code).toBe('SEND_ACTIVE')
    // A refused send creates nothing: one send, one native session.
    expect(session.sends).toHaveLength(1)
    expect(shell.terminals.list(owner.agent)).toHaveLength(1)

    session.settleActive({ waitReason: 'inferred_idle' })
    const settled = await first
    expect(settled.waitReason).toBe('inferred_idle')
    expect(settled.terminal.sessionStatus).toEqual({ kind: 'running' })
    expect(shell.controller.status(owner, resourceId).busy).toBe(false)
    session.manualSends = false
    await shell.controller.send(owner, resourceId, { text: 'echo again' })
    expect(session.sends).toHaveLength(2)
  })

  it('cancels a send through the native foreground interrupt and keeps the terminal open', async () => {
    const controller = new AbortController()
    const shell = await openTerminalHarness({ signal: controller.signal })
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    session.manualSends = true
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open({ ...owner, signal: new AbortController().signal })

    const sending = shell.controller.send(owner, opened.terminal.resourceId, { text: 'sleep 60' })
    await settle()
    controller.abort()
    const result = await sending
    expect(session.interrupts).toBe(1)
    expect(result.cancelled).toBe(true)
    expect(shell.controller.status(owner, opened.terminal.resourceId).terminal.sessionStatus).toEqual({
      kind: 'running',
    })
    expect(shell.controller.list(owner)).toHaveLength(1)
  })

  it('waits on the active send without cancelling it and reports the native wait reason', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    session.manualSends = true
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const resourceId = opened.terminal.resourceId
    const sending = shell.controller.send(owner, resourceId, { text: 'make' })
    await settle()

    const timedOut = await shell.controller.wait(owner, resourceId, 30)
    expect(timedOut.timedOut).toBe(true)
    expect(timedOut.waitReason).toBe('timeout')
    expect(timedOut.sessionStatus).toEqual({ kind: 'running' })
    // The wait did not touch the interaction.
    expect(session.active?.isSettled).toBe(false)
    expect(session.signals).toHaveLength(0)

    session.settleActive({ waitReason: 'stdin_read' })
    const settledSend = await sending
    expect(settledSend.waitReason).toBe('stdin_read')
    // With no send running a wait observes the session; it is still running, so the
    // bound ends the wait. A finished command is never re-reported as a wait reason.
    const settledWait = await shell.controller.wait(owner, resourceId, 40)
    expect(settledWait.timedOut).toBe(true)
    expect(settledWait.waitReason).toBe('timeout')
    expect(settledWait.sessionStatus).toEqual({ kind: 'running' })
  })

  it('reports session exit and a plain wait timeout without inventing command success', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const exiting = new ScriptedNativeSession(1)
    exiting.pollsBeforeExit = 2
    const quiet = new ScriptedNativeSession(2)
    let sequence = 0
    shell.backends.get('bash')!.prepare = () => (sequence++ === 0 ? exiting : quiet)

    const first = await shell.controller.open(owner)
    const exited = await shell.controller.wait(owner, first.terminal.resourceId, 5_000)
    expect(exited.timedOut).toBe(false)
    expect(exited.waitReason).toBe('session_exit')
    expect(exited.sessionStatus).toEqual({ kind: 'exited', exitCode: 0, signal: null })

    const second = await shell.controller.open(owner)
    const timedOut = await shell.controller.wait(owner, second.terminal.resourceId, 40)
    expect(timedOut.timedOut).toBe(true)
    expect(timedOut.waitReason).toBe('timeout')
    expect(timedOut.sessionStatus).toEqual({ kind: 'running' })
    expect(shell.controller.list(owner)).toHaveLength(2)
  })
})

describe('terminal read', () => {
  it('returns bounded newest-relative pages with a real range and an opaque continuation cursor', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    for (let line = 0; line < 12; line += 1) session.append(`line ${line}`)
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)

    const first = shell.controller.read(owner, opened.terminal.resourceId, undefined, 4)
    expect(first.text).toBe('line 8\nline 9\nline 10\nline 11')
    expect(first).toMatchObject({ totalLines: 12, lineBegin: 0, lineEnd: 4, hasOlder: true, lossy: false })
    expect(first.cursor).toBeTypeOf('string')

    const second = shell.controller.read(owner, opened.terminal.resourceId, first.cursor, 4)
    expect(second.text).toBe('line 4\nline 5\nline 6\nline 7')
    expect(second).toMatchObject({ lineBegin: 4, lineEnd: 8, hasOlder: true })

    const third = shell.controller.read(owner, opened.terminal.resourceId, second.cursor, 4)
    expect(third.text).toBe('line 0\nline 1\nline 2\nline 3')
    expect(third).toMatchObject({ lineBegin: 8, lineEnd: 12, hasOlder: false })
    expect(third.cursor).toBeUndefined()

    // Reading is not consuming: the same page is available to another observer.
    const again = shell.controller.read(owner, opened.terminal.resourceId, undefined, 4)
    expect(again.text).toBe(first.text)
  })

  it('rejects a cursor from another terminal, another resource kind or a malformed value', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    for (let line = 0; line < 8; line += 1) session.append(`line ${line}`)
    shell.backends.get('bash')!.prepare = () => session
    const first = await shell.controller.open(owner)
    const second = await shell.controller.open(owner)

    const page = shell.controller.read(owner, first.terminal.resourceId, undefined, 2)
    const cursor = page.cursor!
    expect(() => shell.controller.read(owner, second.terminal.resourceId, cursor)).toThrow(NexusError)
    expectNexusCode(
      (() => {
        try {
          shell.controller.read(owner, first.terminal.resourceId, 'nxshell1.eyJ2IjoxfQ')
          return undefined
        } catch (error) {
          return error
        }
      })(),
      'INVALID_ARGUMENT',
    )
    expect(() => shell.controller.read(owner, first.terminal.resourceId, 'not-a-cursor')).toThrow(NexusError)
    expectNexusCode(
      (() => {
        try {
          shell.controller.read(owner, first.terminal.resourceId, undefined, 0)
          return undefined
        } catch (error) {
          return error
        }
      })(),
      'INVALID_ARGUMENT',
    )
  })

  it('flags dropped scrollback instead of presenting the retained window as a complete log', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    for (let line = 0; line < 6; line += 1) session.append(`line ${line}`)
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const resourceId = opened.terminal.resourceId

    const first = shell.controller.read(owner, resourceId, undefined, 2)
    expect(first.truncated).toBe(false)

    // New output shifts newest-relative offsets; the cursor still continues exactly.
    session.append('line 6')
    session.append('line 7')
    const continued = shell.controller.read(owner, resourceId, first.cursor, 2)
    expect(continued.text).toBe('line 2\nline 3')
    expect(continued).toMatchObject({ totalLines: 8, lineBegin: 4, lineEnd: 6, lossy: false })

    // Retention drops the head: the anchored continuation is gone, and that is said.
    session.lines.splice(0, 4)
    session.dropped = true
    const evicted = shell.controller.read(owner, resourceId, continued.cursor, 2)
    expect(evicted.text).toBe('')
    expect(evicted.lossy).toBe(true)
    expect(evicted.lossReason).toBe('evicted')
    expect(evicted.cursor).toBeUndefined()

    // A fresh read still reports the native retention latch.
    const fresh = shell.controller.read(owner, resourceId, undefined, 2)
    expect(fresh.truncated).toBe(true)
    expect(fresh.text).toBe('line 6\nline 7')
  })

  it('marks a continuation lossy when appends and evictions cannot be told apart', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    for (let line = 0; line < 6; line += 1) session.append(`line ${line}`)
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const resourceId = opened.terminal.resourceId
    const first = shell.controller.read(owner, resourceId, undefined, 2)

    // The window grows while the retention latch flips: exactness cannot be proven.
    session.append('line 6', 8)
    session.append('line 7', 8)
    session.append('line 8', 8)
    expect(session.dropped).toBe(true)
    const shifted = shell.controller.read(owner, resourceId, first.cursor, 2)
    expect(shifted.lossy).toBe(true)
    expect(shifted.lossReason).toBe('shifted')
    expect(shifted.text.length).toBeGreaterThan(0)
    expect(shifted.totalLines).toBe(8)
  })

  it('marks a continuation lossy when an append and an eviction keep the retained count', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    for (let line = 0; line < 8; line += 1) session.append(`line ${line}`)
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const resourceId = opened.terminal.resourceId
    const first = shell.controller.read(owner, resourceId, undefined, 2)
    expect(first).toMatchObject({ totalLines: 8, lineBegin: 0, lineEnd: 2 })

    // At the retention bound every append also drops a head line, so the
    // retained count is unchanged while the content shifts.
    session.append('line 8', 8)
    expect(session.dropped).toBe(true)
    const continued = shell.controller.read(owner, resourceId, first.cursor, 2)
    expect(continued.totalLines).toBe(8)
    expect(continued.lossy).toBe(true)
    expect(continued.lossReason).toBe('shifted')
  })

  it('clamps an evicted continuation to the retained line count', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    for (let line = 0; line < 8; line += 1) session.append(`line ${line}`)
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const resourceId = opened.terminal.resourceId
    const first = shell.controller.read(owner, resourceId, undefined, 2)
    const second = shell.controller.read(owner, resourceId, first.cursor, 2)

    session.lines.splice(0, 6)
    session.dropped = true
    const evicted = shell.controller.read(owner, resourceId, second.cursor, 2)
    expect(evicted.lossy).toBe(true)
    expect(evicted.lossReason).toBe('evicted')
    expect(evicted.lineBegin).toBeLessThanOrEqual(evicted.totalLines)
    expect(evicted.lineEnd).toBeLessThanOrEqual(evicted.totalLines)
  })

  it('refuses a read when the terminal is no longer owned', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const opened = await shell.controller.open(owner)
    await shell.controller.close(owner, opened.terminal.resourceId)
    expect(() => shell.controller.read(owner, opened.terminal.resourceId)).toThrow(NexusError)
    expect(() => shell.controller.status(owner, opened.terminal.resourceId)).toThrow(NexusError)
    expect(shell.terminals.list(owner.agent)).toHaveLength(0)
  })
})

describe('terminal stop, close and teardown', () => {
  it('interrupts the verified foreground group and keeps the terminal for later use', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const resourceId = opened.terminal.resourceId

    const stopped = await shell.controller.stop(owner, resourceId)
    expect(stopped.interrupted).toBe(true)
    expect(stopped.targetPgid).toBe(4242)
    expect(session.signals).toEqual(['SIGINT'])
    expect(session.closes).toHaveLength(0)
    expect(shell.controller.list(owner)).toHaveLength(1)

    // A backend that cannot verify a foreground group reports no interrupt.
    session.signalFailure = 'no foreground process group is resolvable'
    const refused = await shell.controller.stop(owner, resourceId)
    expect(refused.interrupted).toBe(false)
    expect(refused.targetPgid).toBeUndefined()
    expect(refused.detail).toContain('foreground')
    expect(shell.controller.list(owner)).toHaveLength(1)
  })

  it('interrupts an active send through the native operation instead of signalling blind', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    session.manualSends = true
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const sending = shell.controller.send(owner, opened.terminal.resourceId, { text: 'sleep 60' })
    await settle()

    const stopped = await shell.controller.stop(owner, opened.terminal.resourceId)
    expect(stopped.interrupted).toBe(true)
    const settled = await sending
    expect(settled.waitReason).toBe('stdin_read')
    expect(session.interrupts).toBe(1)
  })

  it('closes the captured terminal only when cleanup is confirmed, and keeps it retryable otherwise', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const session = new ScriptedNativeSession(1)
    session.closeFailures = 1
    shell.backends.get('bash')!.prepare = () => session
    const opened = await shell.controller.open(owner)
    const resourceId = opened.terminal.resourceId

    const failed = await shell.controller.close(owner, resourceId)
    expect(failed.closed).toBe(false)
    expect(failed.reason).toBe('cleanup-unconfirmed')
    expect(failed.terminal.cleanupUnconfirmed).toBe(true)
    expect(session.closes).toHaveLength(1)
    expect(shell.controller.list(owner)).toHaveLength(1)

    const retried = await shell.controller.close(owner, resourceId)
    expect(retried.closed).toBe(true)
    expect(retried.terminal.cleanupUnconfirmed).toBe(false)
    expect(session.closes).toHaveLength(2)
    expect(shell.controller.list(owner)).toHaveLength(0)
    expect(shell.terminals.list(owner.agent)).toHaveLength(0)
  })

  it('disposes only its own terminals and reports cleanup it could not confirm', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const foreignSession = new ScriptedNativeSession(99)
    shell.backends.get('pwsh')!.prepare = () => foreignSession
    const foreign = await shell.terminals.spawn(owner.agent, { type: terminalBackendType('pwsh') })

    const stuck = new ScriptedNativeSession(1)
    stuck.closeFailures = 5
    shell.backends.get('bash')!.prepare = () => stuck
    const owned = await shell.controller.open(owner)

    const disposal = await shell.controller.dispose()
    expect(disposal.cleared).toHaveLength(0)
    expect(disposal.failures).toHaveLength(1)
    expect(disposal.failures[0]?.resourceId).toBe(owned.terminal.resourceId)
    expect(disposal.failures[0]?.reason).toBe('cleanup-unconfirmed')

    // The unrelated native provider session is untouched; the unconfirmed one is
    // still registered because its cleanup never completed.
    const remaining = shell.terminals.list(owner.agent).map((snapshot) => snapshot.sessionId)
    expect(remaining).toContain(foreign.sessionId)
    expect(remaining).toHaveLength(2)

    expect(() => shell.controller.list(owner)).toThrow(NexusError)
    expectNexusCode(await rejection(shell.controller.open(owner)), 'RESOURCE_NOT_AVAILABLE')

    await shell.terminals.kill(owner.agent, foreign.sessionId, 'test cleanup')
    // Let the retained terminal close cleanly so context teardown stays quiet.
    stuck.closeFailures = 0
  })

  it('clears owned terminals on disposal when cleanup is confirmed', async () => {
    const shell = await openTerminalHarness()
    const owner = shell.harness.owner
    const first = await shell.controller.open(owner)
    const second = await shell.controller.open(owner, { engine: 'pwsh' })
    const disposal = await shell.controller.dispose()
    expect(disposal.failures).toHaveLength(0)
    expect(disposal.cleared).toEqual(
      expect.arrayContaining([first.terminal.resourceId, second.terminal.resourceId]),
    )
    expect(shell.terminals.list(owner.agent)).toHaveLength(0)
  })
})
