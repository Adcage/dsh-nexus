/**
 * Managed shell execution: engine argv, environment, policy, lifecycle and
 * truthful cleanup.
 *
 * @module dsh-nexus/test/shell/process
 */

import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { ShellExecutionConfig } from '../../src/shell/engines.ts'
import {
  refuseConfinedBashStartupFailure,
  startProcess,
  type ManagedProcess,
  type RunInput,
} from '../../src/shell/process.ts'
import { NexusError } from '../../src/runtime/errors.ts'
import {
  COMMAND_CLEANUP_GRACE_MS,
  PROCESS_OUTPUT_MEMORY_BYTES,
  PROCESS_OUTPUT_SPILL_BYTES,
} from '../../src/runtime/defaults.ts'
import {
  mountRecordingSandbox,
  type RecordingSandboxProvider,
  type ScriptedProcessScript,
} from '../support/fixtures.ts'
import { createToolHarness, type ToolHarness } from '../support/harness.ts'

/** Working directory for every ordinary start; absolute on the host. */
const CWD = process.cwd()

/** One explicit engine pair: the scripted provider never executes the program. */
const BASH_CONFIG: ShellExecutionConfig = {
  deployment: {},
  terminal: { engine: 'bash', bashPath: process.execPath },
}

/** PowerShell pair; the double answers the version probe without executing it. */
const PWSH_CONFIG: ShellExecutionConfig = {
  deployment: {},
  terminal: { engine: 'pwsh', pwshPath: process.execPath },
}

/** Harnesses owned by this file, disposed once. */
const open: ToolHarness[] = []

afterAll(async () => {
  for (const harness of open.splice(0)) await harness.dispose()
})

/** What a case needs from a mounted shell harness. */
interface ShellHarness {
  readonly harness: ToolHarness
  readonly sandboxProvider: RecordingSandboxProvider | undefined
}

/**
 * Mount a shell harness with the real shell-env registry.
 * @param options - process script, whether to mount the real sandbox-policy service, and owner signal.
 */
async function openShellHarness(options: {
  readonly script?: (spec: SubprocessSpawnSpec) => ScriptedProcessScript
  readonly sandbox?: boolean
  readonly sandboxProvider?: boolean
  readonly signal?: AbortSignal
} = {}): Promise<ShellHarness> {
  const harness = await createToolHarness({
    cwd: CWD,
    ...(options.script === undefined ? {} : { subprocess: { script: options.script } }),
    ...(options.sandbox === true ? { sandbox: { mode: 'workspace-write', workspaceRoot: CWD } } : {}),
    ...(options.signal === undefined ? {} : { owner: { signal: options.signal } }),
  })
  open.push(harness)
  await harness.ctx.plugin(ShellEnvRegistry)
  const sandboxProvider =
    options.sandbox === true && options.sandboxProvider !== false
      ? await mountRecordingSandbox(harness.ctx)
      : undefined
  return { harness, sandboxProvider }
}

/** Start one command through the real captured tool execution. */
async function start(
  harness: ToolHarness,
  input: RunInput,
  config: ShellExecutionConfig = BASH_CONFIG,
): Promise<ManagedProcess> {
  const execution = await harness.captureExecution()
  return startProcess(harness.ctx, harness.owner, input, config, execution)
}

/** Capture a rejection without failing the test at the await site. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe('startProcess', () => {
  it('keeps ordinary calls independent and does not forward the parent environment', async () => {
    const previousBashEnv = process.env.BASH_ENV
    const previousFunction = process.env['BASH_FUNC_probe%%']
    const previousSecret = process.env.NEXUS_PARENT_SECRET
    process.env.BASH_ENV = 'C:/tmp/evil-init.sh'
    process.env['BASH_FUNC_probe%%'] = '() { echo injected; }'
    process.env.NEXUS_PARENT_SECRET = 'must-not-leak'
    const shell = await openShellHarness()
    try {
      const sessionCwd = shell.harness.owner.agent.session.header.cwd
      const first = await start(shell.harness, { command: 'echo one', cwd: join(CWD, 'work-one') })
      const second = await start(shell.harness, {
        command: 'echo two',
        cwd: join(CWD, 'work-two'),
        env: {
          DSH_SESSION_ID: 'forged-session',
          EXPLICIT_ALLOWED: 'yes',
          'BASH_FUNC_caller%%': '() { echo caller; }',
        },
      })
      await Promise.all([first.done, second.done])

      expect(shell.harness.subprocess.spawns).toHaveLength(2)
      expect(shell.harness.subprocess.spawns[0]?.cwd).toBe(join(CWD, 'work-one'))
      expect(shell.harness.subprocess.spawns[1]?.cwd).toBe(join(CWD, 'work-two'))
      expect(shell.harness.subprocess.spawns[0]?.argv).toEqual([
        process.execPath,
        '--noprofile',
        '--norc',
        '-c',
        'echo one',
      ])
      expect(shell.harness.subprocess.spawns[1]?.argv.at(-1)).toBe('echo two')

      const environment = shell.harness.subprocess.spawns[1]?.env ?? {}
      expect(environment.BASH_ENV).toBeUndefined()
      expect(environment.ENV).toBeUndefined()
      expect(environment.NEXUS_PARENT_SECRET).toBeUndefined()
      expect(environment['BASH_FUNC_probe%%']).toBeUndefined()
      expect(environment['BASH_FUNC_caller%%']).toBeUndefined()
      expect(environment.EXPLICIT_ALLOWED).toBe('yes')
      expect(environment.DSH_SESSION_ID).toBe(SessionId('harness-session'))
      expect(shell.harness.owner.agent.session.header.cwd).toBe(sessionCwd)
    } finally {
      if (previousBashEnv === undefined) delete process.env.BASH_ENV
      else process.env.BASH_ENV = previousBashEnv
      if (previousFunction === undefined) delete process.env['BASH_FUNC_probe%%']
      else process.env['BASH_FUNC_probe%%'] = previousFunction
      if (previousSecret === undefined) delete process.env.NEXUS_PARENT_SECRET
      else process.env.NEXUS_PARENT_SECRET = previousSecret
    }
  })

  it('starts only bash and does not switch to pwsh after a startup failure', async () => {
    const shell = await openShellHarness({
      script: () => {
        throw new Error('bash refused to start')
      },
    })
    const error = await rejection(start(shell.harness, { command: 'echo x', cwd: CWD }))
    expect(error).toBeInstanceOf(NexusError)
    expect(error).toMatchObject({ code: 'SHELL_UNAVAILABLE' })
    expect(shell.harness.subprocess.spawns).toHaveLength(1)
    expect(shell.harness.subprocess.spawns[0]?.argv[0]).toBe(process.execPath)
    expect(shell.harness.subprocess.spawns[0]?.argv).not.toContain('-NoProfile')
  })

  it('passes Unicode and space-bearing arguments as separate argv elements', async () => {
    const command = "printf '%s\\n' '你好 世界' 'a b'"
    const cwd = join(CWD, '目录 with space')
    const shell = await openShellHarness()
    const managed = await start(shell.harness, { command, cwd })
    await managed.done
    const spawn = shell.harness.subprocess.spawns[0]
    expect(spawn?.argv).toEqual([process.execPath, '--noprofile', '--norc', '-c', command])
    expect(spawn?.cwd).toBe(cwd)
  })

  it('verifies PowerShell 7 before running the command', async () => {
    const shell = await openShellHarness({
      script: (spec) =>
        spec.argv.at(-1) === '$PSVersionTable.PSVersion.Major' ? { stdout: '7\n', exitCode: 0 } : { stdout: 'ok' },
    })
    const managed = await start(shell.harness, { command: "Write-Output '你好 世界'", cwd: CWD, engine: 'pwsh' }, PWSH_CONFIG)
    const view = await managed.done
    expect(view.status).toBe('exited')
    expect(shell.harness.subprocess.spawns).toHaveLength(2)
    expect(shell.harness.subprocess.spawns[0]?.argv).toEqual([
      process.execPath,
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$PSVersionTable.PSVersion.Major',
    ])
    expect(shell.harness.subprocess.spawns[1]?.argv).toEqual([
      process.execPath,
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); Write-Output '你好 世界'",
    ])
  })

  it('rejects Windows PowerShell 5.1 without running the command', async () => {
    const shell = await openShellHarness({ script: () => ({ stdout: '5\n', exitCode: 0 }) })
    const error = await rejection(start(shell.harness, { command: 'Get-Location', cwd: CWD, engine: 'pwsh' }, PWSH_CONFIG))
    expect(error).toBeInstanceOf(NexusError)
    expect(error).toMatchObject({ code: 'SHELL_UNAVAILABLE' })
    expect(shell.harness.subprocess.spawns).toHaveLength(1)
    expect(shell.harness.subprocess.spawns[0]?.argv.at(-1)).toBe('$PSVersionTable.PSVersion.Major')
  })

  it('uses the contract output, spill and cleanup budgets', async () => {
    const shell = await openShellHarness()
    const managed = await start(shell.harness, { command: 'echo budgets', cwd: CWD })
    await managed.done
    const spawn = shell.harness.subprocess.spawns[0]
    expect(spawn?.stdio.stdout).toMatchObject({
      maxBytes: PROCESS_OUTPUT_MEMORY_BYTES,
      spill: { maxBytes: PROCESS_OUTPUT_SPILL_BYTES },
    })
    expect(spawn?.stdio.stderr).toMatchObject({
      maxBytes: PROCESS_OUTPUT_MEMORY_BYTES,
      spill: { maxBytes: PROCESS_OUTPUT_SPILL_BYTES },
    })
    expect(spawn?.graceMs).toBe(COMMAND_CLEANUP_GRACE_MS)
  })

  it('rejects out-of-range timeouts before starting anything', async () => {
    const shell = await openShellHarness()
    for (const timeoutMs of [0, 600_001, Number.POSITIVE_INFINITY]) {
      const error = await rejection(start(shell.harness, { command: 'echo x', cwd: CWD, timeoutMs }))
      expect(error).toBeInstanceOf(NexusError)
      expect(error).toMatchObject({ code: 'INVALID_ARGUMENT' })
    }
    expect(shell.harness.subprocess.spawns).toHaveLength(0)
  })

  it('reports a signal exit truthfully', async () => {
    const shell = await openShellHarness({ script: () => ({ exitCode: null, signal: 'SIGKILL' }) })
    const managed = await start(shell.harness, { command: 'kill-me', cwd: CWD })
    expect(await managed.done).toMatchObject({
      status: 'exited',
      exitCode: null,
      signal: 'SIGKILL',
      cleanupConfirmed: true,
    })
  })

  it('reports a nonzero exit without inventing a failure or a stop', async () => {
    const shell = await openShellHarness({ script: () => ({ exitCode: 3, stderr: 'boom' }) })
    const managed = await start(shell.harness, { command: 'exit 3', cwd: CWD })
    const view = await managed.done
    expect(view).toMatchObject({
      status: 'exited',
      exitCode: 3,
      signal: null,
      stopRequested: null,
      cleanupConfirmed: true,
    })
    expect(managed.view()).toEqual(view)
  })

  it('resolves the calling session policy on every start and confines the complete argv', async () => {
    const shell = await openShellHarness({ sandbox: true })
    const provider = shell.sandboxProvider
    if (provider === undefined) throw new Error('sandbox provider did not mount')
    const session = shell.harness.owner.agent.session
    setSandboxMode(session, 'read-only')
    const first = await start(shell.harness, { command: 'echo confined', cwd: CWD })
    await first.done
    setSandboxMode(session, 'workspace-write')
    const second = await start(shell.harness, { command: 'echo wider', cwd: CWD })
    await second.done

    expect(provider.calls.map((call) => call.policy.mode)).toEqual(['read-only', 'workspace-write'])
    const expectedArgv = [process.execPath, '--noprofile', '--norc', '-c', 'echo confined']
    expect(provider.calls[0]?.argv).toEqual(expectedArgv)
    expect(provider.calls[0]?.policy.workspaceRoot).toBe(session.header.cwd)
    expect(first.sandbox).toMatchObject({ mode: 'read-only', enforcement: 'partial', denied: false })
    expect(shell.harness.subprocess.spawns[0]?.argv).toEqual(['nexus-sandbox', '--', ...expectedArgv])
    expect(second.sandbox).toMatchObject({ mode: 'workspace-write', enforcement: 'partial' })
  })

  it('distinguishes a native denial from a runner failure', async () => {
    const shell = await openShellHarness({
      sandbox: true,
      script: (spec) => {
        const command = spec.argv.at(-1) ?? ''
        if (command === 'denied') return { exitCode: 1, stderr: 'permission denied: outside workspace' }
        if (command === 'runner') return { exitCode: 1, stderr: 'sandbox runner failed: no usable runner' }
        return { exitCode: 0 }
      },
    })
    setSandboxMode(shell.harness.owner.agent.session, 'read-only')
    const denied = await start(shell.harness, { command: 'denied', cwd: CWD })
    const deniedView = await denied.done
    const runner = await start(shell.harness, { command: 'runner', cwd: CWD })
    const runnerView = await runner.done

    expect(deniedView.status).toBe('exited')
    expect(denied.sandbox).toMatchObject({ mode: 'read-only', denied: true, enforcement: 'partial' })
    expect(denied.sandbox?.runnerFailed).toBeUndefined()
    expect(runnerView.status).toBe('failed')
    expect(runner.sandbox?.denied).toBe(false)
    expect(runner.sandbox?.runnerFailed).toContain('sandbox runner failed')
  })

  it('does not confine a danger-full-access policy and reports it', async () => {
    const shell = await openShellHarness({ sandbox: true })
    const provider = shell.sandboxProvider
    if (provider === undefined) throw new Error('sandbox provider did not mount')
    setSandboxMode(shell.harness.owner.agent.session, 'danger-full-access')
    const managed = await start(shell.harness, { command: 'echo full', cwd: CWD })
    await managed.done
    expect(provider.calls).toEqual([])
    expect(managed.sandbox).toEqual({ mode: 'danger-full-access', denied: false })
    expect(shell.harness.subprocess.spawns[0]?.argv).toEqual([
      process.execPath,
      '--noprofile',
      '--norc',
      '-c',
      'echo full',
    ])
  })

  it('propagates a runner-unavailable confinement failure without spawning', async () => {
    const shell = await openShellHarness({ sandbox: true, sandboxProvider: false })
    await mountRecordingSandbox(shell.harness.ctx, {
      failWith: new SandboxUnavailableError('read-only', 'no usable runner'),
    })
    const error = await rejection(start(shell.harness, { command: 'echo x', cwd: CWD }))
    expect(error).toBeInstanceOf(SandboxUnavailableError)
    expect(error).toMatchObject({ code: 'SANDBOX_UNAVAILABLE' })
    expect(shell.harness.subprocess.spawns).toHaveLength(0)
  })

  it('treats a stop after a confirmed exit as a no-op', async () => {
    const shell = await openShellHarness()
    const managed = await start(shell.harness, { command: 'echo done', cwd: CWD })
    const view = await managed.done
    expect(await managed.stop('user')).toEqual(view)
    expect(managed.view().stopRequested).toBeNull()
  })

  it('keeps the first stop cause and treats a later stop as the same request', async () => {
    const shell = await openShellHarness({ script: () => ({ staysOpen: true }) })
    const managed = await start(shell.harness, { command: 'sleep', cwd: CWD })
    const first = managed.stop('user')
    const second = managed.stop('dispose')
    expect(await second).toEqual(await first)
    expect(await managed.done).toMatchObject({ status: 'exited', stopRequested: 'user', cleanupConfirmed: true })
  })

  it('rejects an execution captured from another owner', async () => {
    const first = await openShellHarness()
    const second = await openShellHarness()
    const foreign = await second.harness.captureExecution()
    const error = await rejection(
      startProcess(first.harness.ctx, first.harness.owner, { command: 'echo x', cwd: CWD }, BASH_CONFIG, foreign),
    )
    expect(error).toBeInstanceOf(NexusError)
    expect(error).toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('fails closed when confinement policy and provider are not both mounted', async () => {
    const policyOnly = await openShellHarness({ sandbox: true, sandboxProvider: false })
    const missingProvider = await rejection(start(policyOnly.harness, { command: 'echo x', cwd: CWD }))
    expect(missingProvider).toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })

    const providerOnly = await openShellHarness()
    await mountRecordingSandbox(providerOnly.harness.ctx)
    const missingPolicy = await rejection(start(providerOnly.harness, { command: 'echo x', cwd: CWD }))
    expect(missingPolicy).toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
  })

  it('turns an asynchronous provider rejection into a failed managed outcome', async () => {
    const shell = await openShellHarness({ script: () => ({ doneError: new Error('provider crashed') }) })
    const managed = await start(shell.harness, { command: 'echo x', cwd: CWD })
    const view = await managed.done
    expect(view.status).toBe('failed')
    expect(managed.cleanupError).toContain('provider crashed')
  })

  it('cancels and waits for the owned range to be cleaned', async () => {
    const controller = new AbortController()
    const shell = await openShellHarness({ signal: controller.signal, script: () => ({ staysOpen: true }) })
    const managed = await start(shell.harness, { command: 'sleep forever', cwd: CWD })
    expect(managed.view()).toMatchObject({ status: 'running', cleanupConfirmed: false })
    controller.abort('test cancellation')
    const view = await managed.done
    expect(view).toMatchObject({ status: 'cancelled', stopRequested: 'cancel', cleanupConfirmed: true })
  })

  it('times out and cleans the owned range instead of reporting success on silence', async () => {
    const shell = await openShellHarness({ script: () => ({ staysOpen: true }) })
    const managed = await start(shell.harness, { command: 'sleep forever', cwd: CWD, timeoutMs: 10 })
    const view = await managed.done
    expect(view).toMatchObject({ status: 'timed_out', stopRequested: 'timeout', cleanupConfirmed: true })
  })

  it('keeps a parent-exited process with a live survivor managed until cleanup is confirmed', async () => {
    const shell = await openShellHarness({ script: () => ({ exitCode: 0, survivingRange: true }) })
    const managed = await start(shell.harness, { command: 'start-grandchild', cwd: CWD })
    const view = await managed.done
    expect(view).toMatchObject({ status: 'exited', exitCode: 0, cleanupConfirmed: true })
  })

  it('reports stopping and cleanupConfirmed:false when the owned range cannot be proven empty', async () => {
    const shell = await openShellHarness({ script: () => ({ exitCode: 0, cleanupUnconfirmed: true }) })
    const managed = await start(shell.harness, { command: 'leak', cwd: CWD })
    const view = await managed.done
    expect(view).toMatchObject({ status: 'stopping', cleanupConfirmed: false })
    expect(managed.cleanupError).toBeDefined()
    const afterStop = await managed.stop('dispose')
    expect(afterStop).toMatchObject({ status: 'stopping', cleanupConfirmed: false, stopRequested: 'dispose' })
  })
})

// ---------------------------------------------------------------------------
// Confined Git Bash startup refusal (Windows permission chain)
// ---------------------------------------------------------------------------

/**
 * The real fatal line Git Bash prints when the windows-acl token denies its
 * shared-memory object. Captured from a confined run on this host.
 */
const MSYS_STARTUP_STDERR =
  '      0 [main] bash (4548) E:\\Programme\\software\\Git\\usr\\bin\\bash.exe: *** fatal error - NtCreateDirectoryObject(\\BaseNamedObjects\\msys-2.0S5-df7f0c9bbf0ef292): 0xC0000022\n'

/** The Windows status code that fatal line exits with (0xC0000022 as unsigned). */
const MSYS_STARTUP_STATUS = 3221225794

describe('confined Git Bash startup refusal', () => {
  it('refuses a confined Windows bash start that died on the MSYS2 shared-memory object', async () => {
    const shell = await openShellHarness({
      sandbox: true,
      script: () => ({ stderr: MSYS_STARTUP_STDERR, exitCode: MSYS_STARTUP_STATUS }),
    })
    const managed = await start(shell.harness, { command: 'echo hi', cwd: CWD })
    await managed.done

    let refusal: unknown
    try {
      refuseConfinedBashStartupFailure(managed, 'bash', 'win32')
    } catch (error) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(NexusError)
    expect(refusal).toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    const message = (refusal as Error).message
    // Original facts survive in the diagnostic: status, signature and engine hint.
    expect(message).toContain('3221225794')
    expect(message).toContain('0xC0000022')
    expect(message).toContain('NtCreateDirectoryObject')
    expect(message).toContain('pwsh')
  })

  it('does not classify a plain non-zero exit under the same confinement', async () => {
    const shell = await openShellHarness({
      sandbox: true,
      script: () => ({ stderr: 'permission denied', exitCode: 1 }),
    })
    const managed = await start(shell.harness, { command: 'touch /outside', cwd: CWD })
    await managed.done
    expect(() => refuseConfinedBashStartupFailure(managed, 'bash', 'win32')).not.toThrow()
  })

  it('does not classify an unconfined bash failure with the same signature', async () => {
    const shell = await openShellHarness({
      script: () => ({ stderr: MSYS_STARTUP_STDERR, exitCode: MSYS_STARTUP_STATUS }),
    })
    const managed = await start(shell.harness, { command: 'echo hi', cwd: CWD })
    await managed.done
    expect(managed.sandbox).toBeUndefined()
    expect(() => refuseConfinedBashStartupFailure(managed, 'bash', 'win32')).not.toThrow()
  })

  it('does not classify a pwsh start under the same confinement', async () => {
    const shell = await openShellHarness({
      sandbox: true,
      script: (spec) =>
        spec.argv.at(-1) === '$PSVersionTable.PSVersion.Major'
          ? { stdout: '7\n', exitCode: 0 }
          : { stderr: MSYS_STARTUP_STDERR, exitCode: MSYS_STARTUP_STATUS },
    })
    const managed = await start(
      shell.harness,
      { command: 'Write-Output hi', cwd: CWD, engine: 'pwsh' },
      PWSH_CONFIG,
    )
    await managed.done
    expect(() => refuseConfinedBashStartupFailure(managed, 'pwsh', 'win32')).not.toThrow()
  })

  it('does not classify the same facts on a non-Windows host', async () => {
    const shell = await openShellHarness({
      sandbox: true,
      script: () => ({ stderr: MSYS_STARTUP_STDERR, exitCode: MSYS_STARTUP_STATUS }),
    })
    const managed = await start(shell.harness, { command: 'echo hi', cwd: CWD })
    await managed.done
    expect(() => refuseConfinedBashStartupFailure(managed, 'bash', 'linux')).not.toThrow()
  })
})
