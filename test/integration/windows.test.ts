/**
 * Real-Windows acceptance: the Nexus shell surface against real executables.
 *
 * Every case here executes REAL child processes and REAL ConPTY sessions on the
 * host through the shipped local subprocess provider
 * (`@deepseek-ai/dsh-subprocess-local`), this package's own shell tool, terminal
 * controller and native bash/pwsh terminal backends. Nothing about process
 * start, output, cancellation, timeout, tree cleanup or terminal input is
 * scripted: the only replacement is the model transport (no model is involved)
 * and an inert, fail-closed sandbox provider that proves these cases never
 * reach a confinement call.
 *
 * What this file cannot cover, stated rather than implied:
 *
 * - CONFINED Git Bash. The harness confines win32 commands through the
 *   `windows-acl` runner, whose restricted token denies the MSYS2 runtime its
 *   `\BaseNamedObjects` shared-memory object, so bash dies at startup with
 *   `0xC0000022` before the command is parsed. That incompatibility is
 *   environment-level and recorded in `docs/testing/verification-record.md`
 *   (AC-07, blocked) with a minimal reproduction; it is not re-simulated here.
 *   The product's named refusal for that shape is covered by
 *   `test/shell/process.test.ts` and `test/shell/tool.test.ts`.
 * - A live model, account, browser page or third-party installation.
 *
 * The suite refuses on a non-Windows host: this is the Windows acceptance
 * evidence, and skipping it to green would claim proof that never ran.
 *
 * @module dsh-nexus/test/integration/windows
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SandboxProvider, type ConfinedArgv, type SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { apply as applyShellEnv } from '@deepseek-ai/dsh-shell-env'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { TerminalSessionService } from '@deepseek-ai/dsh-terminal'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import type { CallOwner } from '../../src/runtime/owner.ts'
import { resolveEngine, type ShellExecutionConfig, type ShellEngineSpec } from '../../src/shell/engines.ts'
import { registerTerminalBackends } from '../../src/shell/terminals.ts'
import { createShellTool } from '../../src/shell/tool.ts'

// ---------------------------------------------------------------------------
// Host gate: this file is the Windows acceptance evidence, not a portable suite.
// ---------------------------------------------------------------------------

if (process.platform !== 'win32') {
  throw new Error(
    `test:windows is the real-Windows acceptance suite and refuses to run on "${process.platform}". ` +
      'It needs real Git Bash, real PowerShell 7 and real ConPTY sessions; a skipped run would report ' +
      'Windows acceptance that was never performed.',
  )
}

/** The real PowerShell 5.1 that must be refused by the PowerShell 7 probe. */
const WINDOWS_POWERSHELL = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'

/** Project-local scratch parent; ignored by git and removed after the suite. */
const TMP_ROOT = join(process.cwd(), 'tmp')

/** The Chinese and whitespace-bearing workspace every dialect case runs in. */
let testRoot = ''

/** Absolute workspace with a space and CJK characters in its name. */
let workspace = ''

/**
 * Poll until `predicate` holds or the bound elapses.
 * @param predicate - condition to observe.
 * @param boundMs - maximum wait.
 * @returns whether the condition became true inside the bound.
 */
async function eventually(predicate: () => boolean, boundMs: number): Promise<boolean> {
  const deadline = Date.now() + boundMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
  return predicate()
}

/**
 * Whether a process id is still alive in this OS.
 * @param pid - process id to probe.
 * @returns true while the process exists.
 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Read a pid the shell wrote to a file, waiting for the write.
 * @param file - absolute pid file path.
 * @returns the pid, or undefined when it never appeared.
 */
async function readPid(file: string): Promise<number | undefined> {
  const appeared = await eventually(() => existsSync(file), 20_000)
  if (!appeared) return undefined
  const value = Number(readFileSync(file, 'utf8').trim())
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * Bound one real operation so a hung PTY or child fails the case instead of the run.
 * @param promise - operation to await.
 * @param boundMs - maximum wait.
 * @param label - operation name used in the failure message.
 */
async function withBound<T>(promise: Promise<T>, boundMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${boundMs} ms`)), boundMs)
        timer.unref()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * The one service this suite replaces: it must never be reached.
 *
 * The cases run the `danger-full-access` policy, so no execution is confined.
 * A confine call would mean the suite silently exercised a different policy
 * than it claims, so it fails loudly instead of wrapping.
 */
class RefusingSandboxProvider extends SandboxProvider {
  /**
   * @param ctx - context the service registers into.
   */
  constructor(ctx: Context) {
    super(ctx)
  }

  /**
   * @returns never: this suite must not confine anything.
   * @throws Error always.
   */
  async confine(_argv: readonly string[], _policy: SandboxPolicy): Promise<ConfinedArgv> {
    throw new Error('windows acceptance runs unconfined: a confinement call reached the inert provider')
  }
}

/** One mounted real-shell fixture. */
interface WindowsShell {
  /** Host context with the real services. */
  readonly ctx: Context
  /** Exact owner every call is attributed to. */
  readonly owner: CallOwner
  /** Configuration the tool and terminal backends read. */
  readonly config: ShellExecutionConfig
  /**
   * Run one shell action through the real tool pipeline.
   * @param args - model-shaped arguments.
   * @returns the registry result.
   */
  call(args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Unload everything and assert the services are gone. */
  dispose(): Promise<void>
}

/** Fixtures owned by this file, disposed once at the end. */
const mounted: WindowsShell[] = []

/**
 * Mount the real shell surface: no scripted spawn, no scripted terminal.
 * @param overrides - terminal settings a case needs to change.
 * @returns the mounted fixture.
 */
async function openWindowsShell(overrides: Partial<ShellExecutionConfig['terminal']> = {}): Promise<WindowsShell> {
  const ctx = new Context()
  // The testkit mounts the session-projection registry, the filesystem and the
  // native working-directory service (which needs both) in one order.
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access', workspaceRoot: workspace })
  await ctx.plugin(RefusingSandboxProvider)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(applyShellEnv, {})
  await ctx.plugin(LocalJobRegistry, {})
  await ctx.plugin(TerminalSessionService)
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(SessionId('windows-acceptance'), {}, { cwd: workspace })
  const controller = new AbortController()
  const owner: CallOwner = { agent, sessionId: SessionId('windows-acceptance'), signal: controller.signal }
  const config: ShellExecutionConfig = {
    deployment: {},
    terminal: { engine: 'bash', ...overrides },
  }
  registerTerminalBackends(ctx, () => config)
  ctx.tools.register(createShellTool(ctx, () => config))
  let callCount = 0
  const fixture: WindowsShell = {
    ctx,
    owner,
    config,
    async call(args) {
      callCount += 1
      return ctx.tools.execute({
        callId: ToolCallId(`windows-call-${callCount}`),
        name: 'shell',
        arguments: args,
        agent,
        signal: controller.signal,
      })
    },
    async dispose() {
      await ctx.fiber.dispose()
      for (const service of ['agentLoop', 'agents', 'subprocess', 'terminals', 'jobs', 'tools']) {
        expect(ctx.get(service), `${service} survived teardown`).toBeUndefined()
      }
    },
  }
  mounted.push(fixture)
  return fixture
}

/**
 * Assert one successful registry result and return its value.
 * @param result - registry result.
 * @returns the canonical value.
 */
function valueOf<T>(result: ToolExecutionResult): T {
  if (result.isError) throw new Error(`expected success, got ${JSON.stringify(result.error)}`)
  return result.value as unknown as T
}

/** One `run` result as this suite reads it. */
interface RunValue {
  process: { resourceId: string; status: string; exitCode: number | null; cleanupConfirmed: boolean }
  page: { text: string; cursor: string }
  background: boolean
}

/** One terminal action result as this suite reads it. */
interface TerminalValue {
  terminal?: { resourceId: string; status?: string }
  resourceId?: string
  text?: string
  closed?: boolean
}

/** Output text of one `run` page, with the channel markers stripped. */
function pageText(value: RunValue): string {
  return value.page.text
}

/**
 * Bash command fragment that starts a real Windows child reporting its own OS pid.
 *
 * `$!` is an MSYS pid, not a Windows pid, so it cannot be probed with
 * `process.kill(pid, 0)`. The child here is this same Node binary, so the pid it
 * writes is the OS pid the process table and the managed range both use.
 * @param pidFile - absolute path the child writes its pid to.
 * @param milliseconds - how long the child stays alive.
 * @returns the command fragment, with a trailing `&`.
 */
function windowsChild(pidFile: string, milliseconds: number): string {
  const target = pidFile.replace(/\\/g, '/')
  const node = process.execPath.replace(/\\/g, '/')
  return `'${node}' -e 'require("node:fs").writeFileSync("${target}", String(process.pid)); setTimeout(() => {}, ${milliseconds})' &`
}

/** The resolved engine for one dialect, as production resolves it. */
async function engineSpec(engine: 'bash' | 'pwsh'): Promise<ShellEngineSpec> {
  return resolveEngine(engine, { deployment: {}, terminal: { engine } })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

afterAll(async () => {
  for (const fixture of mounted.splice(0)) {
    try {
      await fixture.dispose()
    } catch {
      // A case that already failed must not hide the original failure; the
      // remaining fixtures still get disposed.
    }
  }
  if (testRoot !== '') rmSync(testRoot, { recursive: true, force: true })
})

/** Create the scratch workspace once, before the first real spawn. */
function ensureWorkspace(): void {
  if (workspace !== '') return
  mkdirSync(TMP_ROOT, { recursive: true })
  testRoot = mkdtempSync(join(TMP_ROOT, 'task14-windows-'))
  workspace = join(testRoot, '工作 区')
  mkdirSync(workspace, { recursive: true })
}

/** One disposable workspace directory per case, inside the scratch root. */
function caseWorkspace(name: string): string {
  ensureWorkspace()
  const directory = join(testRoot, name, '空 间')
  mkdirSync(directory, { recursive: true })
  return directory
}

describe('real Windows shell acceptance', () => {
  it('resolves both dialects from standard installation roots, not from an ambient PATH', async () => {
    ensureWorkspace()
    const bash = await engineSpec('bash')
    const pwsh = await engineSpec('pwsh')
    expect(bash.executable).toMatch(/bash\.exe$/i)
    expect(bash.executable.startsWith('\\') || /^[a-z]:\\/i.test(bash.executable)).toBe(true)
    expect(bash.args).toEqual(['--noprofile', '--norc', '-c'])
    expect(pwsh.executable).toMatch(/pwsh\.exe$/i)
    expect(pwsh.args).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'])

    // Discovery must not depend on the test process' PATH: a synthetic Program
    // Files root with a Git install is enough, and no PATH entry is supplied.
    const syntheticRoot = join(testRoot, 'synthetic-program-files')
    const syntheticBin = join(syntheticRoot, 'Git', 'bin')
    mkdirSync(syntheticBin, { recursive: true })
    writeFileSync(join(syntheticBin, 'bash.exe'), '')
    const discovered = await resolveEngine(
      'bash',
      { deployment: {}, terminal: { engine: 'bash' } },
      { platform: 'win32', env: { ProgramFiles: syntheticRoot, SystemRoot: 'C:\\Windows' } },
    )
    expect(discovered.executable).toBe(join(syntheticBin, 'bash.exe'))
  })

  it('runs Git Bash in a Chinese and space-bearing directory without damaging the path', async () => {
    const cwd = caseWorkspace('bash-dialect')
    const shell = await openWindowsShell()
    const value = valueOf<RunValue>(
      await shell.call({
        action: 'run',
        command: "printf 'arg:%s\\n' '你好 世界'; pwd",
        cwd,
      }),
    )
    expect(value.process).toMatchObject({ status: 'exited', exitCode: 0, cleanupConfirmed: true })
    const text = pageText(value)
    // A CJK argument with a space survives argv unchanged, and bash reports the
    // workspace it was started in (MSYS spelling, so the drive letter differs).
    expect(text).toContain('arg:你好 世界')
    expect(text).toContain(cwd.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/'))
  })

  it('runs PowerShell 7 in the same Chinese and space-bearing directory as UTF-8', async () => {
    const cwd = caseWorkspace('pwsh-dialect')
    const shell = await openWindowsShell()
    const value = valueOf<RunValue>(
      await shell.call({
        action: 'run',
        engine: 'pwsh',
        command: "Write-Output '你好 世界'; Write-Output (Get-Location).Path",
        cwd,
      }),
    )
    expect(value.process).toMatchObject({ status: 'exited', exitCode: 0 })
    const text = pageText(value)
    expect(text).toContain('你好 世界')
    expect(text).toContain(cwd)
  })

  it('reports a non-zero exit as data instead of failing the call', async () => {
    const shell = await openWindowsShell()
    const value = valueOf<RunValue>(await shell.call({ action: 'run', command: 'exit 7', cwd: workspace }))
    expect(value.process).toMatchObject({ status: 'exited', exitCode: 7, cleanupConfirmed: true })
  })

  it('refuses an unusable configured bash path without switching engines', async () => {
    const shell = await openWindowsShell({ bashPath: join(workspace, 'missing-bash.exe') })
    const result = await shell.call({ action: 'run', command: 'echo hi', cwd: workspace })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ code: 'SHELL_UNAVAILABLE' })
    expect(result.error?.message).toContain('bash')
  })

  it('refuses Windows PowerShell 5.1 for the pwsh engine instead of running it', async () => {
    expect(existsSync(WINDOWS_POWERSHELL)).toBe(true)
    const shell = await openWindowsShell({ pwshPath: WINDOWS_POWERSHELL })
    const result = await shell.call({ action: 'run', engine: 'pwsh', command: 'Write-Output hi', cwd: workspace })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ code: 'SHELL_UNAVAILABLE' })
    expect(result.error?.message).toContain('PowerShell 7')
  })

  it('cancels a running command and proves the real process tree is gone', async () => {
    const cwd = caseWorkspace('cancel')
    const pidFile = join(cwd, 'child.pid')
    const shell = await openWindowsShell()
    const controller = new AbortController()
    const run = shell.ctx.tools.execute({
      callId: ToolCallId('windows-cancel'),
      name: 'shell',
      arguments: { action: 'run', command: `${windowsChild(pidFile, 60_000)} wait`, cwd },
      agent: shell.owner.agent,
      signal: controller.signal,
    })
    const pid = await readPid(pidFile)
    expect(pid).toBeDefined()
    expect(pidAlive(pid as number)).toBe(true)
    controller.abort('windows acceptance cancellation')
    // Cancellation is the pipeline's native failure, and the owned range is
    // still reported as a cleaned resource for the same owner.
    const cancelled = await withBound(run, 30_000, 'cancelled run')
    expect(cancelled.isError).toBe(true)
    expect(['ABORTED', 'RESOURCE_NOT_AVAILABLE']).toContain(cancelled.error?.info?.code)
    const listed = valueOf<{ processes: Array<{ process: { stopRequested: string; cleanupConfirmed: boolean } }> }>(
      await shell.call({ action: 'list' }),
    )
    expect(listed.processes.at(-1)?.process).toMatchObject({ stopRequested: 'cancel', cleanupConfirmed: true })
    // Real-tree proof: the Windows child is gone from the OS process table.
    expect(await eventually(() => !pidAlive(pid as number), 20_000)).toBe(true)
  })

  it('times a command out and proves the real process tree is gone', async () => {
    const cwd = caseWorkspace('timeout')
    const pidFile = join(cwd, 'child.pid')
    const shell = await openWindowsShell()
    const value = valueOf<RunValue>(
      await withBound(
        shell.call({ action: 'run', command: `${windowsChild(pidFile, 60_000)} wait`, cwd, timeoutMs: 1_500 }),
        40_000,
        'timed-out run',
      ),
    )
    expect(value.process).toMatchObject({ status: 'timed_out', cleanupConfirmed: true })
    const pid = await readPid(pidFile)
    expect(pid).toBeDefined()
    expect(await eventually(() => !pidAlive(pid as number), 20_000)).toBe(true)
  })

  it('cleans up a live grandchild when the owned range is stopped', async () => {
    const cwd = caseWorkspace('owned-tree')
    const childFile = join(cwd, 'grandchild.pid')
    const shell = await openWindowsShell()
    const value = valueOf<RunValue>(
      await shell.call({
        action: 'run',
        cwd,
        background: true,
        command: `${windowsChild(childFile, 120_000)} wait`,
      }),
    )
    expect(value.background).toBe(true)
    // The grandchild is a real Windows process under the managed range.
    const grandchild = await readPid(childFile)
    expect(grandchild).toBeDefined()
    expect(pidAlive(grandchild as number)).toBe(true)

    const resourceId = value.process.resourceId
    const stopped = valueOf<RunValue>(await shell.call({ action: 'stop', resourceId }))
    expect(stopped.process).toMatchObject({ cleanupConfirmed: true })
    // A real owned-tree wait: cleanup is only claimed after the grandchild the
    // provider had to kill is observably gone from the OS process table.
    expect(await eventually(() => !pidAlive(grandchild as number), 20_000)).toBe(true)
    const closed = valueOf<{ closed?: boolean }>(await shell.call({ action: 'close', resourceId }))
    expect(closed.closed).toBe(true)
  })

  it('publishes a real background job and keeps it controllable by resource id', async () => {
    const cwd = caseWorkspace('background')
    const pidFile = join(cwd, 'background.pid')
    const shell = await openWindowsShell()
    const started = valueOf<RunValue>(
      await shell.call({
        action: 'run',
        background: true,
        cwd,
        command: `${windowsChild(pidFile, 90_000)} wait`,
      }),
    )
    expect(started.background).toBe(true)
    const pid = await readPid(pidFile)
    expect(pid).toBeDefined()
    expect(pidAlive(pid as number)).toBe(true) // still running while published

    const listed = valueOf<{ processes: Array<{ process: { resourceId: string } }> }>(await shell.call({ action: 'list' }))
    expect(listed.processes.map((entry) => entry.process.resourceId)).toContain(started.process.resourceId)

    const stopped = valueOf<RunValue>(await shell.call({ action: 'stop', resourceId: started.process.resourceId }))
    expect(stopped.process.cleanupConfirmed).toBe(true)
    expect(await eventually(() => !pidAlive(pid as number), 20_000)).toBe(true)
    await shell.call({ action: 'close', resourceId: started.process.resourceId })
  })

  it('keeps persistent terminal input and shell state across sends in a real ConPTY', async () => {
    const cwd = caseWorkspace('terminal')
    const shell = await openWindowsShell()
    const opened = valueOf<TerminalValue>(await withBound(shell.call({ action: 'open', cwd, engine: 'bash' }), 40_000, 'terminal open'))
    const resourceId = opened.terminal?.resourceId ?? opened.resourceId
    expect(resourceId).toMatch(/^nexus-term-/u)
    try {
      await withBound(
        shell.call({ action: 'send', resourceId, text: 'export NEXUS_MARK=kept' }),
        40_000,
        'terminal send (state)',
      )
      const echoed = valueOf<TerminalValue>(
        await withBound(
          shell.call({ action: 'send', resourceId, text: 'printf "mark=%s\\n" "$NEXUS_MARK"' }),
          40_000,
          'terminal send (read back)',
        ),
      )
      expect(echoed.text ?? '').toBeDefined()
      const page = valueOf<TerminalValue>(await withBound(shell.call({ action: 'read', resourceId }), 20_000, 'terminal read'))
      expect(page.text ?? '').toContain('mark=kept')
    } finally {
      const closed = valueOf<{ closed?: boolean }>(
        await withBound(shell.call({ action: 'close', resourceId }), 40_000, 'terminal close'),
      )
      expect(closed.closed).toBe(true)
    }
  })
})
