/**
 * Native background-process ownership and controlled output reads.
 *
 * Every case mounts the shipped in-process job registry (`dsh-jobs-local`) so
 * job identity, settlement, the `awaited` fact and owner teardown are the
 * native service's, not a test double's. Only the subprocess provider is
 * scripted, because a test must not depend on the machine's process table.
 *
 * @module dsh-nexus/test/shell/jobs
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ShellExecutionConfig } from '../../src/shell/engines.ts'
import { createProcessController, type ProcessController } from '../../src/shell/jobs.ts'
import type { CallOwner } from '../../src/runtime/owner.ts'
import { NexusError } from '../../src/runtime/errors.ts'
import { AGENT_MAX_PROCESSES, PROCESS_OUTPUT_SPILL_BYTES, PROCESS_READ_MAX_BYTES } from '../../src/runtime/defaults.ts'
import {
  createScriptedLiveOutputReader,
  createScriptedOutputReader,
  createScriptedRawOutputReader,
  type ScriptedProcessScript,
  type SubprocessDoubleOptions,
} from '../support/fixtures.ts'
import { createToolHarness, type ToolHarness } from '../support/harness.ts'

/** Working directory for every command; absolute and never a session cwd. */
const CWD = process.cwd()

/** Explicit engine pair: the scripted provider never executes the program. */
const BASH_CONFIG: ShellExecutionConfig = {
  deployment: {},
  terminal: { engine: 'bash', bashPath: process.execPath },
}

/** Harnesses owned by this file, disposed once their cases finish. */
const open: ToolHarness[] = []

/** Project-local directory for owned spill files and cleanup checks. */
let spillRoot: string | undefined

afterAll(async () => {
  for (const harness of open.splice(0)) await harness.dispose()
  if (spillRoot !== undefined) rmSync(spillRoot, { recursive: true, force: true })
})

/** What one case needs from a mounted jobs harness. */
interface JobsHarness {
  readonly harness: ToolHarness
  readonly controller: ProcessController
}

/**
 * Mount a real harness plus the real native job registry.
 * @param options - subprocess scripts, owner signal and whether to mount jobs.
 */
async function openJobsHarness(
  options: {
    readonly script?: (spec: { readonly argv: readonly string[] }) => ScriptedProcessScript
    readonly subprocess?: SubprocessDoubleOptions
    readonly signal?: AbortSignal
    readonly sessionId?: string
    readonly jobs?: boolean
  } = {},
): Promise<JobsHarness> {
  const harness = await createToolHarness({
    cwd: CWD,
    ...(options.script === undefined ? {} : { subprocess: { script: options.script } }),
    ...(options.subprocess === undefined ? {} : { subprocess: options.subprocess }),
    ...(options.signal === undefined && options.sessionId === undefined
      ? {}
      : {
          owner: {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
          },
        }),
  })
  open.push(harness)
  if (options.jobs !== false) await harness.ctx.plugin(LocalJobRegistry)
  const controller = createProcessController(harness.ctx, () => BASH_CONFIG)
  return { harness, controller }
}

/** One owner identity for a synthetic tool-call signal against a real Agent. */
function callOwner(shell: JobsHarness, signal: AbortSignal): CallOwner {
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

/** Wait until a synchronous condition holds, or fail a bounded test. */
async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('the expected condition did not become true in time')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
  }
}

/** Capture the settled view of one background run through an explicit stop. */
async function stopAll(shell: JobsHarness, resourceIds: readonly string[]): Promise<void> {
  for (const resourceId of resourceIds) {
    await shell.controller.stop(shell.harness.owner, resourceId)
  }
}

/** Text blocks of one injected notice. */
function noticeText(message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
  return message.content.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('')
}

/** One project-local owned spill file containing the given bytes. */
function writeSpill(name: string, bytes: Uint8Array): string {
  if (spillRoot === undefined) {
    const root = join(CWD, 'tmp')
    mkdirSync(root, { recursive: true })
    spillRoot = mkdtempSync(join(root, 'jobs-spill-'))
  }
  const path = join(spillRoot, name)
  writeFileSync(path, bytes)
  return path
}

/** Read every page through the continuation cursor until the log is exhausted. */
async function readAll(
  shell: JobsHarness,
  resourceId: string,
  limit?: number,
): Promise<{ text: string; pages: number; lossy: boolean }> {
  let cursor: string | undefined
  let text = ''
  let lossy = false
  for (let pages = 0; pages < 512; pages += 1) {
    const result = await shell.controller.read(shell.harness.owner, resourceId, cursor, limit)
    cursor = result.page.cursor
    lossy = lossy || result.page.lossy
    text += result.page.text
    if (result.page.text.length === 0) return { text, pages: pages + 1, lossy }
  }
  throw new Error('the output read did not reach the end of the log')
}

describe('process controller ownership', () => {
  it('refuses a stale Agent that shares the live session id', async () => {
    const primary = await openJobsHarness({ sessionId: 'jobs-authority', script: () => ({ staysOpen: true }) })
    const stale = await openJobsHarness({ sessionId: 'jobs-authority', jobs: false })
    const staleOwner = callOwner(stale, new AbortController().signal)
    const execution = await primary.harness.captureExecution()

    const runError = await rejection(
      primary.controller.run(staleOwner, execution, { command: 'echo foreign', cwd: CWD, background: true }),
    )
    expectNexusCode(runError, 'RESOURCE_NOT_AVAILABLE')
    expect(primary.harness.subprocess.spawns).toHaveLength(0)

    const started = await primary.controller.run(primary.harness.owner, execution, {
      command: 'echo owned',
      cwd: CWD,
      background: true,
    })
    const resourceId = started.view.resourceId

    const readError = await rejection(primary.controller.read(staleOwner, resourceId))
    expectNexusCode(readError, 'RESOURCE_NOT_AVAILABLE')
    const stopError = await rejection(primary.controller.stop(staleOwner, resourceId))
    expectNexusCode(stopError, 'RESOURCE_NOT_AVAILABLE')
    expect(() => primary.controller.status(staleOwner, resourceId)).toThrow(NexusError)
    expect(() => primary.controller.list(staleOwner)).toThrow(NexusError)

    // The stale caller's refusal left the real owner in control.
    const status = primary.controller.status(primary.harness.owner, resourceId)
    expect(status.background).toBe(true)
    expect(status.view.status).toBe('running')
    await primary.controller.stop(primary.harness.owner, resourceId)
  })

  it('disposes only Nexus-owned resources and leaves an unrelated native job running', async () => {
    const shell = await openJobsHarness({ script: () => ({ staysOpen: true }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const foreign = await shell.harness.ctx.agents.create({ sessionId: SessionId('jobs-foreign-session') })
    let settleForeign!: (outcome: { status: 'killed'; detail?: string }) => void
    const foreignDone = new Promise<{ status: 'killed'; detail?: string }>((resolveDone) => {
      settleForeign = resolveDone
    })
    const foreignJob = shell.harness.ctx.jobs.start({
      kind: 'bash',
      label: 'unrelated native job',
      owner: foreign.agent.id,
      run: () => ({
        cancel: () => settleForeign({ status: 'killed', detail: 'test cleanup' }),
        done: foreignDone,
      }),
    })
    const started = await shell.controller.run(owner, execution, {
      command: 'nexus owned',
      cwd: CWD,
      background: true,
    })

    const disposal = await shell.controller.dispose()
    expect(disposal.failures).toHaveLength(0)
    expect(disposal.cleared).toContain(started.view.resourceId)
    expect(shell.harness.ctx.jobs.get(foreignJob, foreign.agent.id).status).toBe('running')
    expect(() => shell.harness.ctx.jobs.get(started.jobId!, owner.sessionId)).toThrow()

    settleForeign({ status: 'killed', detail: 'test cleanup' })
    await foreign.dispose()
  })

  it('fails a background run clearly when the native job service is not composed', async () => {
    const shell = await openJobsHarness({ jobs: false })
    const execution = await shell.harness.captureExecution()
    const error = await rejection(
      shell.controller.run(shell.harness.owner, execution, { command: 'echo none', cwd: CWD, background: true }),
    )
    expectNexusCode(error, 'UNSUPPORTED_CAPABILITY')
    expect(shell.harness.subprocess.spawns).toHaveLength(0)
    expect(shell.controller.list(shell.harness.owner)).toHaveLength(0)
  })
})

describe('background jobs', () => {
  it('publishes a native job and reports its settlement exactly once', async () => {
    const shell = await openJobsHarness({ script: () => ({ staysOpen: true }) })
    const owner = shell.harness.owner
    const notices: { readonly source: { readonly kind: string }; readonly content: readonly { readonly type: string; readonly text?: string }[] }[] = []
    shell.harness.ctx.on('agent/inbox/inserted', ({ message }) => notices.push(message))
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'long running work',
      cwd: CWD,
      background: true,
    })

    expect(started.background).toBe(true)
    expect(started.jobId).toBeTypeOf('string')
    expect(started.view.status).toBe('running')
    const jobId = started.jobId!
    const native = shell.harness.ctx.jobs.get(jobId, owner.sessionId)
    expect(native.kind).toBe('nexus-shell')
    expect(native.status).toBe('running')

    const firstStop = await shell.controller.stop(owner, started.view.resourceId)
    expect(firstStop.cleanupConfirmed).toBe(true)
    const secondStop = await shell.controller.stop(owner, started.view.resourceId)
    expect(secondStop.resourceId).toBe(firstStop.resourceId)
    expect(secondStop.cleanupConfirmed).toBe(true)

    await until(() => shell.harness.ctx.jobs.get(jobId, owner.sessionId).status === 'killed')
    // An idle owner is woken with an ordinary follow-up turn, so the notice is
    // claimed from the inbox; the inserted event is where a test observes it.
    await until(() => notices.length === 1)
    const notice = notices[0]!
    expect(notice.source.kind).toBe('dsh-nexus')
    const text = noticeText(notice)
    expect(text).toContain(jobId)
    expect(text).toContain(started.view.resourceId)

    // A second settlement cannot produce a second report.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
    expect(notices).toHaveLength(1)
  })

  it('bounds consecutive completion wakes and queues the next notice', async () => {
    const shell = await openJobsHarness({ script: () => ({ staysOpen: true }) })
    const owner = shell.harness.owner
    const notices: { readonly source: { readonly kind: string } }[] = []
    shell.harness.ctx.on('agent/inbox/inserted', ({ message }) => notices.push(message))
    const execution = await shell.harness.captureExecution()

    for (let index = 0; index < 5; index += 1) {
      const started = await shell.controller.run(owner, execution, {
        command: `wake ${index}`,
        cwd: CWD,
        background: true,
      })
      await shell.controller.stop(owner, started.view.resourceId)
      await until(() => notices.length === index + 1)
      if (index < 4) {
        // A wake opens a turn; the failed turn settles back to idle before the
        // next settlement, so each of the first four is delivered as a wake.
        await until(() => owner.agent.status === 'idle')
        expect(owner.agent.inbox.nextStep).toHaveLength(0)
      }
    }
    // The fifth notice exceeds the fixed consecutive-wake budget and is queued
    // for the next step instead of opening another turn.
    await until(() => owner.agent.inbox.nextStep.filter((message) => message.source.kind === 'dsh-nexus').length === 1)
    expect(notices).toHaveLength(5)

    // A user-authored message resets the budget: the next completion wakes again
    // and is claimed, leaving no queued dsh-nexus notice behind.
    owner.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await until(() => owner.agent.status === 'idle')
    await until(() => owner.agent.inbox.nextStep.every((message) => message.source.kind !== 'dsh-nexus'))
    const sixth = await shell.controller.run(owner, execution, { command: 'wake again', cwd: CWD, background: true })
    await shell.controller.stop(owner, sixth.view.resourceId)
    await until(() => notices.length === 6)
    await until(() => owner.agent.status === 'idle')
    expect(owner.agent.inbox.nextStep.filter((message) => message.source.kind === 'dsh-nexus')).toHaveLength(0)
  })

  it('does not notify a settlement a waiting caller already collected', async () => {
    const shell = await openJobsHarness({ script: () => ({ staysOpen: true }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'awaited work',
      cwd: CWD,
      background: true,
    })

    const waiting = shell.controller.wait(owner, started.view.resourceId, 30_000)
    await shell.controller.stop(owner, started.view.resourceId)
    const waited = await waiting
    expect(waited.timedOut).toBe(false)
    expect(waited.view.cleanupConfirmed).toBe(true)

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
    expect(owner.agent.inbox.nextStep).toHaveLength(0)
  })

  it('detaches a published background run from the tool-call cancellation', async () => {
    const shell = await openJobsHarness({ script: () => ({ staysOpen: true }) })
    const execution = await shell.harness.captureExecution()
    const toolCancel = new AbortController()
    const owner = callOwner(shell, toolCancel.signal)
    const started = await shell.controller.run(owner, execution, {
      command: 'detached work',
      cwd: CWD,
      background: true,
    })

    toolCancel.abort()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))

    expect(started.view.status).toBe('running')
    const spawn = shell.harness.subprocess.spawns[0]!
    expect(spawn.signal?.aborted).toBe(false)
    expect(shell.harness.ctx.jobs.get(started.jobId!, owner.sessionId).status).toBe('running')
    await shell.controller.stop(owner, started.view.resourceId)
  })

  it('stops a foreground run through the managed path when its tool call is cancelled', async () => {
    const toolCancel = new AbortController()
    const shell = await openJobsHarness({ signal: toolCancel.signal, script: () => ({ staysOpen: true }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const pending = shell.controller.run(owner, execution, {
      command: 'foreground work',
      cwd: CWD,
      timeoutMs: 60_000,
    })
    await until(() => shell.harness.subprocess.spawns.length === 1)
    toolCancel.abort()
    const error = await rejection(pending)

    expectNexusCode(error, 'RESOURCE_NOT_AVAILABLE')
    // The cancellation reached the managed stop path, never the spawn signal.
    expect(shell.harness.subprocess.spawns[0]!.signal?.aborted).toBe(false)
    expect(shell.harness.ctx.jobs.list(owner.sessionId).some((job) => job.status === 'running')).toBe(false)
    const disposal = await shell.controller.dispose()
    expect(disposal.failures).toHaveLength(0)
    expect(disposal.cleared).toHaveLength(1)
  })

  it('leaves no process or native job when the tool call is cancelled before publication', async () => {
    const shell = await openJobsHarness({ script: () => ({ staysOpen: true }) })
    const execution = await shell.harness.captureExecution()
    const toolCancel = new AbortController()
    const owner = callOwner(shell, toolCancel.signal)

    const pending = shell.controller.run(owner, execution, {
      command: 'aborted before start',
      cwd: CWD,
      background: true,
    })
    toolCancel.abort()
    const error = await rejection(pending)

    expectNexusCode(error, 'RESOURCE_NOT_AVAILABLE')
    expect(shell.harness.subprocess.spawns).toHaveLength(0)
    expect(shell.controller.list(shell.harness.owner)).toHaveLength(0)
    expect(shell.harness.ctx.jobs.list(shell.harness.owner.sessionId)).toHaveLength(0)
  })

  it('leaves no reservation or native record when the provider refuses to spawn', async () => {
    const shell = await openJobsHarness({ subprocess: { failSpawnWith: new Error('provider refused') } })
    const execution = await shell.harness.captureExecution()
    for (let attempt = 0; attempt < AGENT_MAX_PROCESSES + 1; attempt += 1) {
      const error = await rejection(
        shell.controller.run(shell.harness.owner, execution, {
          command: `refused ${attempt}`,
          cwd: CWD,
          background: true,
        }),
      )
      expectNexusCode(error, 'SHELL_UNAVAILABLE')
    }
    expect(shell.controller.list(shell.harness.owner)).toHaveLength(0)
    expect(shell.harness.ctx.jobs.list(shell.harness.owner.sessionId)).toHaveLength(0)
  })

  it('caps active processes per Agent before a pending start is published', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const shell = await openJobsHarness({
      subprocess: { beforeResolveExecutable: () => gate, script: () => ({ staysOpen: true }) },
    })
    const execution = await shell.harness.captureExecution()
    const pending = Array.from({ length: AGENT_MAX_PROCESSES }, (_, index) =>
      shell.controller.run(shell.harness.owner, execution, {
        command: `pending ${index}`,
        cwd: CWD,
        background: true,
      }),
    )

    const error = await rejection(
      shell.controller.run(shell.harness.owner, execution, { command: 'too many', cwd: CWD, background: true }),
    )
    expectNexusCode(error, 'RESOURCE_NOT_AVAILABLE')
    expect(shell.harness.subprocess.spawns).toHaveLength(0)

    release()
    const started = await Promise.all(pending)
    expect(started.every((result) => result.view.status === 'running')).toBe(true)
    await stopAll(shell, started.map((result) => result.view.resourceId))
  })

  it('does not treat empty output or a stop request as completion', async () => {
    let unconfirmed = true
    const shell = await openJobsHarness({
      script: () => ({ staysOpen: true, cleanupUnconfirmed: () => unconfirmed }),
    })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'cleanup pending',
      cwd: CWD,
      background: true,
    })

    const empty = await shell.controller.read(owner, started.view.resourceId)
    expect(empty.page.text).toBe('')
    expect(empty.view.status).toBe('running')
    expect(empty.view.cleanupConfirmed).toBe(false)

    const stopping = await shell.controller.stop(owner, started.view.resourceId)
    expect(stopping.status).toBe('stopping')
    expect(stopping.cleanupConfirmed).toBe(false)
    await until(() => shell.harness.ctx.jobs.get(started.jobId!, owner.sessionId).status === 'failed')
    expect(shell.harness.ctx.jobs.get(started.jobId!, owner.sessionId).status).not.toBe('completed')

    // Cleanup authority is retained until the provider can confirm the range.
    const refused = await shell.controller.close(owner, started.view.resourceId)
    expect(refused.closed).toBe(false)
    expect(refused.reason).toBe('cleanup-unconfirmed')
    expect(shell.controller.status(owner, started.view.resourceId).view.cleanupConfirmed).toBe(false)

    unconfirmed = false
    const retried = await shell.controller.close(owner, started.view.resourceId)
    expect(retried.closed).toBe(true)
    expect(shell.controller.list(owner)).toHaveLength(0)
    expect(shell.harness.ctx.jobs.list(owner.sessionId)).toHaveLength(0)
  })

  it('returns a truthful bounded diagnostic when the provider never settles its parent outcome', { timeout: 15_000 }, async () => {
    const shell = await openJobsHarness({ script: () => ({ staysOpen: true, ignoreTerminate: true }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const startedAt = Date.now()
    const result = await shell.controller.run(owner, execution, {
      command: 'hanging provider',
      cwd: CWD,
      timeoutMs: 1,
    })

    expect(Date.now() - startedAt).toBeLessThan(10_000)
    expect(result.background).toBe(false)
    expect(result.view.status).toBe('stopping')
    expect(result.view.cleanupConfirmed).toBe(false)
    expect(result.jobId).toBeUndefined()
    const native = shell.harness.ctx.jobs.list(owner.sessionId)
    expect(native).toHaveLength(1)
    expect(native[0]!.status).toBe('failed')

    const closed = await shell.controller.close(owner, result.view.resourceId)
    expect(closed.closed).toBe(false)
    const disposal = await shell.controller.dispose()
    expect(disposal.failures.map((failure) => failure.resourceId)).toContain(result.view.resourceId)
  })
})

describe('foreground runs', () => {
  it('returns the settled output and keeps further reads available', async () => {
    const shell = await openJobsHarness({
      script: (spec) =>
        spec.argv.some((argument) => argument.includes('background')) ? { staysOpen: true } : { stdout: 'done', exitCode: 0 },
    })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const foreground = await shell.controller.run(owner, execution, { command: 'echo done', cwd: CWD })

    expect(foreground.background).toBe(false)
    expect(foreground.jobId).toBeUndefined()
    expect(foreground.view.status).toBe('exited')
    expect(foreground.view.cleanupConfirmed).toBe(true)
    expect(foreground.page.text).toBe('done')
    // The native record was collected by this foreground call and is not listed.
    expect(shell.harness.ctx.jobs.list(owner.sessionId)).toHaveLength(0)

    const listed = shell.controller.list(owner)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.background).toBe(false)
    expect(listed[0]!.view.resourceId).toBe(foreground.view.resourceId)
    expect((await shell.controller.status(owner, foreground.view.resourceId)).job).toBeUndefined()

    const background = await shell.controller.run(owner, execution, {
      command: 'background work',
      cwd: CWD,
      background: true,
    })
    const both = shell.controller.list(owner)
    expect(both.map((entry) => entry.background)).toContain(true)
    expect(both.map((entry) => entry.background)).toContain(false)
    await shell.controller.stop(owner, background.view.resourceId)
  })
})

describe('controlled output recovery', () => {
  it('recovers the complete owned log after the in-memory ring drops its head', async () => {
    const original = `HEAD-中文🙂-${'x'.repeat(2_400)}-TAIL`
    const spillPath = writeSpill('stdout.log', Buffer.from(original, 'utf8'))
    const reader = createScriptedOutputReader(original, { memoryBytes: 1024, spillPath })
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout: reader } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'long output',
      cwd: CWD,
      background: true,
    })

    const first = await shell.controller.read(owner, started.view.resourceId, undefined, 33)
    expect(first.recovery.find((source) => source.stream === 'stdout')?.source).toBe('spill')
    expect(Buffer.byteLength(first.page.text, 'utf8')).toBeLessThanOrEqual(33)
    expect(first.page.lossy).toBe(false)
    expect(JSON.stringify(first)).not.toContain(spillPath)

    const all = await readAll(shell, started.view.resourceId, 33)
    expect(all.text).toBe(original)
    expect(all.pages).toBeGreaterThan(1)
    expect(all.lossy).toBe(false)
  })

  it('returns a whole code point that is larger than the page budget', async () => {
    const original = `🙂${'x'.repeat(2_000)}`
    const spillPath = writeSpill('tiny-budget.log', Buffer.from(original, 'utf8'))
    const reader = createScriptedOutputReader(original, { memoryBytes: 512, spillPath })
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout: reader } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'tiny budget',
      cwd: CWD,
      background: true,
    })

    const page = await shell.controller.read(owner, started.view.resourceId, undefined, 1)
    expect(page.page.text).toBe('🙂')
    expect(page.page.lossy).toBe(false)
    const all = await readAll(shell, started.view.resourceId)
    expect(all.text).toBe(original)
  })

  it('reports a withdrawn spill as a loss instead of inventing bytes', async () => {
    const original = `HEAD-${'y'.repeat(8_000)}`
    const spillPath = writeSpill('revoked.log', Buffer.from(original, 'utf8'))
    const reader = createScriptedOutputReader(original, { memoryBytes: 1024, spillPath })
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout: reader } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'revoked spill',
      cwd: CWD,
      background: true,
    })

    const first = await shell.controller.read(owner, started.view.resourceId, undefined, 1024)
    expect(first.recovery.find((source) => source.stream === 'stdout')?.source).toBe('spill')
    reader.withdrawSpill()
    const second = await shell.controller.read(owner, started.view.resourceId, first.page.cursor)
    const stdout = second.recovery.find((source) => source.stream === 'stdout')
    expect(stdout?.lost).toBe(true)
    expect(stdout?.reason).toBe('spill-revoked')
    expect(second.page.lossy).toBe(true)
    // The surviving tail is returned as a lossy window, never as an exact log.
    expect(second.page.text.length).toBeLessThanOrEqual(1024)
    expect(original.endsWith(second.page.text)).toBe(true)
  })

  it('reports invalid binary bytes as lossy and never advertises a byte-exact log', async () => {
    const head = Buffer.from('A'.repeat(4000), 'utf8')
    const invalid = Buffer.from([0xff, 0xfe, 0xfd])
    const bytes = Buffer.concat([head, invalid])
    const spillPath = writeSpill('binary.log', bytes)
    const reader = createScriptedRawOutputReader(bytes, { memoryBytes: 512, spillPath })
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout: reader } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'binary output',
      cwd: CWD,
      background: true,
    })

    const page = await shell.controller.read(owner, started.view.resourceId)
    const stdout = page.recovery.find((source) => source.stream === 'stdout')
    expect(stdout?.source).toBe('spill')
    expect(stdout?.lost).toBe(true)
    expect(stdout?.reason).toBe('invalid-utf8')
    expect(page.page.lossy).toBe(true)
    expect(page.page.text).toContain('\uFFFD')
  })

  it('bounds the returned text of invalid bytes to the page byte cap', async () => {
    const bytes = Buffer.alloc(4_096, 0xff)
    const spillPath = writeSpill('invalid-cap.log', bytes)
    const reader = createScriptedRawOutputReader(bytes, { memoryBytes: 512, spillPath })
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout: reader } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'invalid bounded',
      cwd: CWD,
      background: true,
    })

    const page = await shell.controller.read(owner, started.view.resourceId, undefined, 100)
    expect(Buffer.byteLength(page.page.text, 'utf8')).toBeLessThanOrEqual(100)
    expect(page.page.text).toContain('�')
    expect(page.page.lossy).toBe(true)
    expect(page.recovery.find((source) => source.stream === 'stdout')?.reason).toBe('invalid-utf8')
  })

  it('continues a live cursor from the trusted spill when the ring drops the head mid-stream', async () => {
    const firstText = 'a'.repeat(512)
    const laterText = 'b'.repeat(4_096)
    const spillPath = writeSpill('live-continuation.log', Buffer.from(firstText, 'utf8'))
    const reader = createScriptedLiveOutputReader(firstText, { memoryBytes: 1_024, spillPath })
    const shell = await openJobsHarness({ script: () => ({ staysOpen: true, readers: { stdout: reader } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'live continuation',
      cwd: CWD,
      background: true,
    })

    const first = await shell.controller.read(owner, started.view.resourceId)
    expect(first.page.text).toBe(firstText)
    expect(first.recovery.find((source) => source.stream === 'stdout')?.source).toBe('memory')

    reader.append(laterText)
    writeFileSync(spillPath, Buffer.from(firstText + laterText, 'utf8'))
    const second = await shell.controller.read(owner, started.view.resourceId, first.page.cursor)
    expect(second.recovery.find((source) => source.stream === 'stdout')?.source).toBe('spill')
    expect(second.page.text).toBe(laterText)
    expect(second.page.lossy).toBe(false)
    await shell.controller.stop(owner, started.view.resourceId)
  })

  it('does not treat one stream spill as proof the other stream is recoverable', async () => {
    const stdoutText = 'S'.repeat(1024)
    const stdoutPath = writeSpill('stdout-only.log', Buffer.from(stdoutText, 'utf8'))
    const stdout = createScriptedOutputReader(stdoutText, { memoryBytes: 512, spillPath: stdoutPath })
    const stderr = createScriptedOutputReader('E'.repeat(100), { memoryBytes: 16 })
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout, stderr } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'mixed retention',
      cwd: CWD,
      background: true,
    })

    const page = await shell.controller.read(owner, started.view.resourceId)
    const stdoutState = page.recovery.find((source) => source.stream === 'stdout')
    const stderrState = page.recovery.find((source) => source.stream === 'stderr')
    expect(stdoutState?.source).toBe('spill')
    expect(stdoutState?.lost).toBe(false)
    expect(stderrState?.source).toBe('memory')
    expect(stderrState?.lost).toBe(true)
    expect(stderrState?.reason).toBe('retention')
    expect(page.page.text).toContain(stdoutText)
    expect(page.page.text).toContain('[stderr]')
    expect(page.page.lossy).toBe(true)
  })

  it('reports a stream beyond the spill cap instead of claiming a full log', async () => {
    const reader = createScriptedRawOutputReader(Buffer.from('capped'), {
      memoryBytes: 2,
      totalBytes: PROCESS_OUTPUT_SPILL_BYTES + 1,
    })
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout: reader } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'over the cap',
      cwd: CWD,
      background: true,
    })

    const page = await shell.controller.read(owner, started.view.resourceId)
    const stdout = page.recovery.find((source) => source.stream === 'stdout')
    expect(stdout?.lost).toBe(true)
    expect(stdout?.reason).toBe('spill-cap')
    expect(page.page.lossy).toBe(true)
  })

  it('ignores a path encoded in a cursor and rejects a foreign cursor', async () => {
    const original = `${'z'.repeat(4096)}-END`
    const spillPath = writeSpill('trusted.log', Buffer.from(original, 'utf8'))
    const fakePath = writeSpill('forged.log', Buffer.from('EVIL-CALLER-PATH', 'utf8'))
    const reader = createScriptedOutputReader(original, { memoryBytes: 512, spillPath })
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout: reader } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'trusted spill',
      cwd: CWD,
      background: true,
    })
    const resourceId = started.view.resourceId
    const forgedCursor = `nxprocread1.${Buffer.from(
      JSON.stringify({ v: 1, id: resourceId, o: 0, e: 0, m: false, l: false, so: false, se: false, path: fakePath }),
      'utf8',
    ).toString('base64url')}`

    const page = await shell.controller.read(owner, resourceId, forgedCursor)
    expect(page.page.text.startsWith(original.slice(0, 10))).toBe(true)
    expect(page.page.text).not.toContain('EVIL-CALLER-PATH')

    const foreign = await rejection(shell.controller.read(owner, resourceId, 'nxshell1.not-a-cursor'))
    expectNexusCode(foreign, 'INVALID_ARGUMENT')
    const other = await rejection(
      shell.controller.read(owner, resourceId, `nxprocread1.${Buffer.from(
        JSON.stringify({ v: 1, id: 'proc_other', o: 0, e: 0, m: false, l: false, so: false, se: false }),
        'utf8',
      ).toString('base64url')}`),
    )
    expectNexusCode(other, 'INVALID_ARGUMENT')
  })
})

// ---------------------------------------------------------------------------
// Raw-byte memory reads without a spill
// ---------------------------------------------------------------------------

describe('invalid UTF-8 on the memory path', () => {
  it('never claims a byte-exact page for invalid bytes that have no spill', async () => {
    const bytes = Buffer.alloc(20_000, 0xff)
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout: createScriptedRawOutputReader(bytes) } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, { command: 'binary', cwd: CWD })

    expect(started.page.lossy).toBe(true)
    expect(Buffer.byteLength(started.page.text, 'utf8')).toBeLessThanOrEqual(PROCESS_READ_MAX_BYTES)
    expect(started.recovery).toContainEqual(
      expect.objectContaining({ stream: 'stdout', source: 'memory', lost: true, reason: 'invalid-utf8' }),
    )

    // The bounded preview consumes the invalid remainder and says so; a second
    // page must not silently resume with the skipped source bytes.
    const second = await shell.controller.read(owner, started.view.resourceId, started.page.cursor)
    expect(second.page.text).toBe('')
    expect(second.page.lossy).toBe(true)
  })

  it('keeps a genuine replacement character and valid CJK/emoji byte-exact across pages', async () => {
    const original = 'A�中文🙂B'.repeat(2_000)
    const shell = await openJobsHarness({ script: () => ({ readers: { stdout: createScriptedOutputReader(original) } }) })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, { command: 'valid unicode', cwd: CWD })
    expect(started.page.lossy).toBe(false)

    let cursor = started.page.cursor
    let joined = started.page.text
    let lost = false
    for (let page = 0; page < 64; page += 1) {
      const next = await shell.controller.read(owner, started.view.resourceId, cursor, 4_096)
      joined += next.page.text
      lost = lost || next.page.lossy || next.recovery.some((truth) => truth.lost)
      if (next.page.text.length === 0) break
      cursor = next.page.cursor
    }
    expect(joined).toBe(original)
    expect(lost).toBe(false)
  })

  it('does not mark a live incomplete UTF-8 tail as invalid loss', async () => {
    const live = createScriptedLiveOutputReader('ok')
    live.append(Uint8Array.of(0xf0, 0x9f))
    const shell = await openJobsHarness({
      subprocess: { script: () => ({ readers: { stdout: live }, staysOpen: true }) },
    })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, {
      command: 'live tail',
      cwd: CWD,
      background: true,
    })
    const first = await shell.controller.read(owner, started.view.resourceId)
    expect(first.page.text).toBe('ok')
    expect(first.page.lossy).toBe(false)
    expect(first.recovery.every((truth) => truth.lost === false)).toBe(true)

    live.append(Uint8Array.of(0x98, 0x80))
    live.end()
    const second = await shell.controller.read(owner, started.view.resourceId, first.page.cursor)
    expect(second.page.text).toBe('😀')
    expect(second.page.lossy).toBe(false)
    await shell.controller.stop(owner, started.view.resourceId)
  })

  it('reports invalid stderr bytes honestly while still delivering valid stdout', async () => {
    const shell = await openJobsHarness({
      script: () => ({
        readers: {
          stdout: createScriptedRawOutputReader(Buffer.from('OUT\n', 'utf8')),
          stderr: createScriptedRawOutputReader(Buffer.alloc(8_000, 0xff)),
        },
      }),
    })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const started = await shell.controller.run(owner, execution, { command: 'binary stderr', cwd: CWD })

    expect(started.page.text.startsWith('OUT\n')).toBe(true)
    expect(started.page.lossy).toBe(true)
    expect(started.recovery).toContainEqual(
      expect.objectContaining({ stream: 'stdout', lost: false }),
    )
    expect(started.recovery).toContainEqual(
      expect.objectContaining({ stream: 'stderr', source: 'memory', lost: true, reason: 'invalid-utf8' }),
    )
    expect(Buffer.byteLength(started.page.text, 'utf8')).toBeLessThanOrEqual(PROCESS_READ_MAX_BYTES)
    const second = await shell.controller.read(owner, started.view.resourceId, started.page.cursor)
    expect(second.page.lossy).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Slot release and unload diagnostics
// ---------------------------------------------------------------------------

describe('guarded settlement and unload diagnostics', () => {
  it('releases the active slot when a guarded settlement is confirmed afterwards', async () => {
    const shell = await openJobsHarness({
      script: (spec) =>
        spec.argv.at(-1) === 'guarded'
          ? { staysOpen: true, terminateDelayMs: 4_500 }
          : { staysOpen: true },
    })
    const owner = shell.harness.owner
    const execution = await shell.harness.captureExecution()
    const guarded = await shell.controller.run(owner, execution, {
      command: 'guarded',
      cwd: CWD,
      background: true,
      timeoutMs: 1,
    })
    // The guard settles the entry before the provider's own completion lands;
    // the later confirmation must still free the active-process slot.
    await until(
      () => shell.controller.status(owner, guarded.view.resourceId).view.cleanupConfirmed,
      8_000,
    )
    const fillers: string[] = []
    for (let index = 0; index < AGENT_MAX_PROCESSES; index += 1) {
      const filler = await shell.controller.run(owner, execution, {
        command: `filler ${index}`,
        cwd: CWD,
        background: true,
      })
      fillers.push(filler.view.resourceId)
    }
    // All eight fit because the guarded slot was released. Cleanup itself is
    // the harness's job; close/stop behaviour is covered by its own cases.
    expect(fillers).toHaveLength(AGENT_MAX_PROCESSES)
    await stopAll(shell, fillers)
  }, 20_000)

  it('reports unload cleanup failures through the supported logger', async () => {
    const harness = await createToolHarness({
      cwd: CWD,
      subprocess: { script: () => ({ staysOpen: true, cleanupUnconfirmed: true }) },
    })
    open.push(harness)
    await harness.ctx.plugin(LocalJobRegistry)
    const messages: string[] = []
    harness.ctx.logger.exporter({
      levels: { default: 3 },
      export: (message) => {
        messages.push(message.args.map((value) => String(value)).join(' '))
      },
    })
    // A child fiber owns the controller, so disposing it runs the controller's
    // own unload effect while the parent logger is still alive.
    let controller: ProcessController | undefined
    const fiber = harness.ctx.plugin((scope) => {
      controller = createProcessController(scope, () => BASH_CONFIG)
    })
    await fiber
    if (controller === undefined) throw new Error('the controller plugin did not start')
    const started = await controller.run(harness.owner, await harness.captureExecution(), {
      command: 'unload failure',
      cwd: CWD,
      background: true,
    })
    await fiber.dispose()
    expect(controller).toBeDefined()
    expect(messages.some((message) => message.includes(started.view.resourceId))).toBe(true)
    expect(messages.some((message) => message.includes('not cleaned up'))).toBe(true)
    await harness.dispose()
    open.splice(open.indexOf(harness), 1)
  })
})

describe('per-Agent managed range facts', () => {
  it('reports a clean Agent, a pending start and an unconfirmed range truthfully', async () => {
    let openGate: (() => void) | undefined
    let announcePending: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      announcePending = resolve
    })
    const shell = await openJobsHarness({
      subprocess: {
        beforeResolveExecutable: async () => {
          announcePending?.()
          announcePending = undefined
          await new Promise<void>((resolve) => {
            openGate = resolve
          })
        },
        script: () => ({ staysOpen: true, cleanupUnconfirmed: true }),
      },
    })
    const agent = shell.harness.owner.agent
    const execution = await shell.harness.captureExecution()

    // Nothing started yet: a genuine clean case.
    expect(shell.controller.cleanupOf(agent)).toBe('clean')
    expect(shell.controller.unresolved()).toEqual([])

    const starting = shell.controller.run(shell.harness.owner, execution, {
      command: 'pending',
      cwd: CWD,
      background: true,
    })
    await pending
    // A start that has not published yet is pending, never clean.
    expect(shell.controller.cleanupOf(agent)).toBe('pending')

    openGate?.()
    const run = await starting
    const resourceId = run.view.resourceId
    expect(shell.controller.cleanupOf(agent)).toBe('unconfirmed')
    expect(shell.controller.unresolved()).toContainEqual(
      expect.objectContaining({ agent, state: 'unconfirmed', detail: expect.stringContaining(resourceId) }),
    )

    await shell.controller.stop(shell.harness.owner, resourceId)
    // A stop that could not confirm the range keeps the fact unconfirmed.
    expect(shell.controller.cleanupOf(agent)).toBe('unconfirmed')

    const disposed = await shell.controller.dispose()
    expect(disposed.failures.map((failure) => failure.resourceId)).toContain(resourceId)
    // The fact survives the controller's own disposal: the range is still out there.
    expect(shell.controller.cleanupOf(agent)).toBe('unconfirmed')
    expect(shell.controller.unresolved().map((entry) => entry.agent)).toContain(agent)
  }, 60_000)
})
