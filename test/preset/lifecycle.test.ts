/**
 * The Nexus runtime's real lifecycle: one store, one settings reference, one
 * write coordinator and one prompt-session owner, shared by every preset
 * generation that composes Nexus.
 *
 * Everything here runs on the real Cordis context, the shipped storage hub and
 * JSON medium, the production AgentLoop and the real native Agent lifecycle. The
 * only scripted member is the model transport (no request leaves the process);
 * one case wraps the real domain with a gate in front of one table write so a
 * durable write can be held open deterministically.
 *
 * @module dsh-nexus/test/preset/lifecycle
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { canonicalDirectory } from '../../src/agent/coordination.ts'
import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import { openNexusRuntime, NEXUS_RUNTIME_SERVICE, type NexusRuntime } from '../../src/runtime/service.ts'
import { NEXUS_DOMAIN, PROMPTS_TABLE } from '../../src/storage/domain.ts'
import type { PromptSnapshot } from '../../src/protocol.ts'
import * as presetRow from '../../src/preset/index.ts'
import { NEXUS_PRESET_ID } from '../../src/preset/definition.ts'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import { ShellEnvRegistry } from '@deepseek-ai/dsh-shell-env'
import { TerminalSessionService } from '@deepseek-ai/dsh-terminal'
import type { ShellExecutionConfig } from '../../src/shell/engines.ts'
import { createShellSurface } from '../../src/shell/tool.ts'
import { mountSubagentHarness, waitFor, type SubagentHarness } from '../support/agent-harness.ts'
import { createToolHarness, type ToolHarness } from '../support/harness.ts'
import { mountNexusStoreFixture, type NexusStoreFixture } from '../support/fixtures.ts'
import { mountPresetHarness, PRESET_ROUTE } from '../support/preset-harness.ts'

/** Everything one lifecycle case opened and must close, in reverse order. */
interface OpenCase {
  readonly harness?: SubagentHarness
  readonly fixture?: NexusStoreFixture
  readonly contexts?: Context[]
  readonly close: () => Promise<void>
}

const openCases: OpenCase[] = []

afterEach(async () => {
  for (const entry of openCases.splice(0).reverse()) await entry.close()
})

/**
 * Mount the runtime the way the host row does: an active plugin whose `inject`
 * declares the native storage service.
 * @param ctx - context to mount on; it must already resolve `storageDomain`.
 * @param config - deployment configuration for the row.
 * @returns the opened runtime.
 */
async function mountRuntimeRow(ctx: Context, config: Record<string, unknown> = {}): Promise<NexusRuntime> {
  let opened: NexusRuntime | undefined
  const fiber = ctx.plugin({
    name: 'nexus-runtime-test-row',
    inject: ['storageDomain'],
    async apply(pluginCtx: Context): Promise<void> {
      opened = await openNexusRuntime(pluginCtx, config)
    },
  })
  await fiber
  if (opened === undefined) throw new Error('the Nexus runtime row did not open a runtime')
  return opened
}

/**
 * Open a lifecycle case: the real native stack, the real medium, and the runtime
 * on the same context.
 * @returns the open case members.
 */
async function openCase(): Promise<{
  harness: SubagentHarness
  fixture: NexusStoreFixture
  runtime: NexusRuntime
}> {
  const harness = await mountSubagentHarness()
  const fixture = await mountNexusStoreFixture({ ctx: harness.ctx })
  const runtime = await mountRuntimeRow(harness.ctx)
  openCases.push({
    async close() {
      await runtime.dispose()
      await fixture.dispose()
      await harness.dispose()
    },
  })
  return { harness, fixture, runtime }
}

/** One macrotask turn, so queued promise work and I/O callbacks run once. */
async function settledWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

/**
 * Read the Nexus error code a call refuses with.
 * @param run - call expected to throw.
 * @returns the code, or `undefined` when the call returned normally.
 */
function failureCode(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return (error as { code?: unknown }).code
  }
  return undefined
}

describe('runtime identity', () => {
  it('fails loud without the native storage domain instead of falling back to private state', async () => {
    const ctx = new Context()
    let failure: unknown
    await ctx.plugin({
      name: 'nexus-runtime-without-storage',
      apply(pluginCtx: Context) {
        void openNexusRuntime(pluginCtx, {}).catch((error: unknown) => {
          failure = error
        })
      },
    })
    await waitFor(() => failure !== undefined, 'the runtime row to refuse a missing storage domain')
    expect(failure).toMatchObject({ name: 'NexusError', code: 'UNSUPPORTED_CAPABILITY' })
    expect(ctx.get(NEXUS_RUNTIME_SERVICE)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('waits for its declared service, then seeds and reads settings before it is ready', async () => {
    const ctx = new Context()
    let opened: Promise<NexusRuntime> | undefined
    let rowError: unknown
    const row = ctx.plugin({
      name: 'nexus-runtime-load-order',
      inject: ['storageDomain'],
      apply(pluginCtx: Context) {
        opened = openNexusRuntime(pluginCtx, {})
        void opened.catch((error: unknown) => {
          rowError = error
        })
      },
    })
    await settledWork()
    // The row is pending on a native service that is not mounted yet: no
    // runtime, no half-open store, and no invented in-memory state.
    expect(opened).toBeUndefined()
    expect(ctx.get(NEXUS_RUNTIME_SERVICE)).toBeUndefined()

    const fixture = await mountNexusStoreFixture({ ctx })
    openCases.push({
      close: async () => {
        await fixture.dispose()
        await ctx.fiber.dispose()
      },
    })
    await row
    if (opened === undefined) throw new Error(`the runtime row did not open (${String(rowError)})`)
    const runtime = await opened

    expect(ctx.get(NEXUS_RUNTIME_SERVICE)).toBe(runtime)
    expect(runtime.getSettings().value).toEqual(DEFAULT_SETTINGS)
    expect(runtime.getShellConfig()).toEqual({ deployment: {}, terminal: DEFAULT_SETTINGS.terminal })
  })

  it('keeps one store, coordinator and prompt owner across two preset generations', async () => {
    const { harness, fixture, runtime } = await openCase()

    const seen: NexusRuntime[] = []
    const generations: { dispose: () => Promise<unknown> }[] = []
    for (const name of ['generation-a', 'generation-b']) {
      const generation = harness.ctx.extend()
      const fiber = generation.plugin({
        name: `${name}-row`,
        inject: [NEXUS_RUNTIME_SERVICE],
        async apply(pluginCtx: Context): Promise<void> {
          // A preset entry calls the same opener; it must join the live runtime.
          seen.push(await openNexusRuntime(pluginCtx, {}))
        },
      })
      await fiber
      generations.push(fiber as unknown as { dispose: () => Promise<unknown> })
    }

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(runtime)
    expect(seen[1]).toBe(runtime)
    expect(seen[1]?.store).toBe(runtime.store)
    expect(seen[1]?.coordinator).toBe(runtime.coordinator)
    expect(seen[1]?.prompts).toBe(runtime.prompts)
    // One store was opened, so the singleton records were seeded exactly once.
    expect(fixture.listWrites().filter((entry) => entry === 'settings/current')).toHaveLength(1)
    expect(fixture.listWrites().filter((entry) => entry === 'library/current')).toHaveLength(1)

    // Unloading one generation leaves the shared runtime serving the other.
    const first = generations[0] as unknown as { dispose: () => Promise<unknown> }
    await first.dispose()
    expect(runtime.getSettings().value).toEqual(DEFAULT_SETTINGS)
    expect(seen[1]?.getShellConfig().terminal).toEqual(DEFAULT_SETTINGS.terminal)
  })
})

describe('settings', () => {
  it('keeps the committed settings and the shell snapshot when a durable save fails', async () => {
    const { fixture, runtime } = await openCase()
    const before = runtime.getSettings()

    fixture.failNextPut('settings')
    await expect(
      runtime.saveSettings({ ...before.value, terminal: { engine: 'pwsh', pwshPath: 'C:\\pwsh.exe' } }, before.hash),
    ).rejects.toThrow(/refused the write/)

    expect(runtime.getSettings()).toBe(before)
    expect(runtime.getShellConfig().terminal).toEqual(before.value.terminal)
    expect((await runtime.store.readSettings()).value).toEqual(before.value)
  })

  it('publishes one immutable settings reference only after the durable save lands', async () => {
    const { runtime } = await openCase()
    const before = runtime.getSettings()
    const next = {
      ...before.value,
      terminal: { engine: 'pwsh' as const, pwshPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
    }

    const saved = await runtime.saveSettings(next, before.hash)

    expect(saved.hash).not.toBe(before.hash)
    expect(runtime.getSettings()).toBe(saved)
    expect(runtime.getSettings().value.terminal.pwshPath).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    // A shell start resolves against the new snapshot; an old snapshot is untouched.
    expect(runtime.getShellConfig().terminal.engine).toBe('pwsh')
    expect(before.value.terminal).toEqual({ engine: 'bash' })
    await expect(runtime.saveSettings({ ...before.value }, before.hash)).rejects.toMatchObject({
      code: 'CONFIG_CONFLICT',
    })
    expect(runtime.getSettings()).toBe(saved)
  })
})

describe('prompt writes', () => {
  it('finishes a held same-session prompt write before the store closes', async () => {
    const harness = await mountSubagentHarness()
    const fixture = await mountNexusStoreFixture({ ctx: harness.ctx })
    // Open the real domain once and put the gate in front of its prompts table,
    // i.e. above the domain's own write chain, so closing the store cannot
    // silently absorb the pending write.
    const realDomain = await harness.ctx.storageDomain.open(NEXUS_DOMAIN)
    let armed = false
    let announceHeld: (() => void) | undefined
    let openGate: (() => void) | undefined
    type PromptTable = { put(key: string, value: PromptSnapshot): Promise<unknown> }
    const gatedDomain = new Proxy(realDomain, {
      get(target, property, receiver) {
        if (property === 'table') {
          return (name: string) => {
            const table = (target.table as unknown as (table: string) => PromptTable & object)(name)
            if (name !== PROMPTS_TABLE) return table
            return new Proxy(table, {
              get(tableTarget, tableProperty, tableReceiver) {
                if (tableProperty === 'put') {
                  return async (key: string, value: PromptSnapshot): Promise<void> => {
                    if (armed) {
                      armed = false
                      await new Promise<void>((resolve) => {
                        openGate = resolve
                        announceHeld?.()
                        announceHeld = undefined
                      })
                    }
                    await tableTarget.put(key, value)
                  }
                }
                const member = Reflect.get(tableTarget, tableProperty, tableReceiver) as unknown
                return typeof member === 'function' ? member.bind(tableTarget) : member
              },
            })
          }
        }
        const member = Reflect.get(target, property, receiver) as unknown
        return typeof member === 'function' ? member.bind(target) : member
      },
    })
    const gatedCtx = harness.ctx.isolate('storageDomain')
    await gatedCtx.plugin({
      name: 'nexus-gated-domain',
      apply(pluginCtx: Context) {
        pluginCtx.provide('storageDomain', {
          open: async () => gatedDomain,
          get: () => undefined,
          closeAll: async () => undefined,
        })
      },
    })
    const runtime = await mountRuntimeRow(gatedCtx)
    const agent = await harness.createParent('lifecycle-prompt')
    openCases.push({
      async close() {
        await runtime.dispose()
        await fixture.dispose()
        await harness.dispose()
      },
    })

    await runtime.store.saveLibrary(
      { modules: [{ id: 'first', name: 'First', body: 'FIRST BODY' }], defaultSelection: [] },
      (await runtime.store.readLibrary()).hash,
    )
    await runtime.prompts.initialize(agent)
    const library = await runtime.store.readLibrary()

    armed = true
    const applying = runtime.prompts.apply(agent, ['first'], library.hash)
    await new Promise<void>((resolve) => {
      announceHeld = resolve
    })

    const closing = runtime.dispose()
    await settledWork()
    // The store is still open: the teardown is waiting for the prompt write, not
    // closing the record underneath it.
    await expect(runtime.store.readSettings()).resolves.toMatchObject({ value: DEFAULT_SETTINGS })
    let closed = false
    void closing.then(() => {
      closed = true
    })
    await settledWork()
    expect(closed).toBe(false)

    openGate?.()
    const status = await closing
    await applying
    expect(status.failures).toEqual([])

    const reopened = await fixture.open()
    const durable = await reopened.getPrompt('lifecycle-prompt')
    expect(durable?.selection).toEqual(['first'])
    expect(durable?.text).toContain('FIRST BODY')
    await reopened.dispose()
  })
})

describe('write authority', () => {
  it('retains an unresolved write scope across a restart and frees released scopes', async () => {
    const { harness, fixture, runtime } = await openCase()
    const parent = await harness.createParent('authority-parent')
    const retainedRoot = join(harness.workspace, 'retained')
    const releasedRoot = join(harness.workspace, 'released')
    await mkdir(retainedRoot, { recursive: true })
    await mkdir(releasedRoot, { recursive: true })

    await runtime.coordinator.acquire(parent, SessionId('retained-child'), retainedRoot)
    runtime.coordinator.pin(SessionId('retained-child'))
    const released = await runtime.coordinator.acquire(parent, SessionId('released-child'), releasedRoot)
    released.release()
    await runtime.coordinator.drain()

    const status = await runtime.dispose()
    expect(status.released).toBe(false)
    expect(status.retainedScopes).toEqual([
      {
        childId: SessionId('retained-child'),
        root: await canonicalDirectory(retainedRoot),
        state: 'unconfirmed',
      },
    ])

    // A restart: a fresh context with no Agent registry at all, over the same medium.
    const restartedCtx = new Context()
    const restartedFixture = await mountNexusStoreFixture({ ctx: restartedCtx, root: fixture.root })
    const restarted = await mountRuntimeRow(restartedCtx)
    openCases.push({
      close: async () => {
        await restarted.dispose()
        await restartedFixture.dispose()
        await restartedCtx.fiber.dispose()
      },
    })

    expect(restarted.coordinator.scopeOf(SessionId('retained-child'))).toEqual({
      root: await canonicalDirectory(retainedRoot),
      state: 'unconfirmed',
    })
    // The same tree stays refused: a restart is not a cleanup receipt.
    await expect(restarted.coordinator.acquire(parent, SessionId('new-writer'), retainedRoot)).rejects.toMatchObject({
      code: 'WRITE_SCOPE_BUSY',
    })
    // And an unresolved child cannot relock the same tree under its own id either.
    await expect(
      restarted.coordinator.acquire(parent, SessionId('retained-child'), retainedRoot),
    ).rejects.toMatchObject({ code: 'WRITE_SCOPE_BUSY' })

    // A positively released scope is reusable after the restart.
    expect(restarted.coordinator.scopeOf(SessionId('released-child'))).toBeUndefined()
    const reusable = await restarted.coordinator.acquire(parent, SessionId('released-child'), releasedRoot)
    reusable.release()
    expect(restarted.coordinator.scopeOf(SessionId('released-child'))).toBeUndefined()
  })

  it('refuses a writer whose reservation could not be made durable first', async () => {
    const { harness, fixture, runtime } = await openCase()
    const parent = await harness.createParent('durable-parent')
    const dir = join(harness.workspace, 'durable')
    await mkdir(dir, { recursive: true })

    fixture.failNextPut('write_scopes')
    await expect(runtime.coordinator.acquire(parent, SessionId('durable-child'), dir)).rejects.toThrow(
      /refused the write/,
    )
    // No lease and no evidence: the writer was never admitted.
    expect(runtime.coordinator.scopeOf(SessionId('durable-child'))).toBeUndefined()
    expect(fixture.listWrites().filter((entry) => entry.startsWith('write_scopes/'))).toEqual([])

    const admitted = await runtime.coordinator.acquire(parent, SessionId('durable-child'), dir)
    expect(admitted.cwd).toBe(await canonicalDirectory(dir))
    expect(fixture.listWrites()).toContain('write_scopes/durable-child')
  })

  it('keeps the reservation when the durable release itself fails', async () => {
    const { harness, fixture, runtime } = await openCase()
    const parent = await harness.createParent('release-parent')
    const dir = join(harness.workspace, 'release')
    await mkdir(dir, { recursive: true })

    const lease = await runtime.coordinator.acquire(parent, SessionId('release-child'), dir)
    fixture.failNextDelete('write_scopes')
    lease.release()

    // The release is explicit, but the durable truth is unknown: it is reported
    // and the record survives, so a restart still refuses the tree.
    await expect(runtime.coordinator.drain()).rejects.toThrow(/refused the delete/)
    await expect(runtime.coordinator.acquire(parent, SessionId('release-writer'), dir)).resolves.toBeDefined()

    const restartedCtx = new Context()
    const restartedFixture = await mountNexusStoreFixture({ ctx: restartedCtx, root: fixture.root })
    const restarted = await mountRuntimeRow(restartedCtx)
    openCases.push({
      close: async () => {
        await restarted.dispose()
        await restartedFixture.dispose()
        await restartedCtx.fiber.dispose()
      },
    })
    expect(restarted.coordinator.scopeOf(SessionId('release-child'))).toMatchObject({ state: 'unconfirmed' })
    await expect(
      restarted.coordinator.acquire(parent, SessionId('release-writer'), dir),
    ).rejects.toMatchObject({ code: 'WRITE_SCOPE_BUSY' })
  })

  it('refuses an older release or disposal that would unlock a newer reservation', async () => {
    const { harness, runtime } = await openCase()
    const dir = join(harness.workspace, 'stale')
    await mkdir(dir, { recursive: true })
    const child = await harness.createParent('stale-child')

    const older = await runtime.coordinator.acquire(child, child.id, dir)
    older.release()
    const newer = await runtime.coordinator.acquire(child, child.id, dir)

    // The old release handle is idempotent and cannot remove the new reservation.
    older.release()
    expect(runtime.coordinator.scopeOf(child.id)).toMatchObject({ state: 'held' })
    await expect(runtime.coordinator.acquire(child, SessionId('third-writer'), dir)).rejects.toMatchObject({
      code: 'WRITE_SCOPE_BUSY',
    })

    // The native registry cannot dispose one live Agent while a newer
    // reservation for the same id exists, so this event is injected: the
    // assertion is only that a disposal of the known earlier residency is
    // refused, not that native disposal happened here.
    harness.ctx.emit('agent/disposed', { agent: child })
    expect(runtime.coordinator.scopeOf(child.id)).toMatchObject({ state: 'held' })

    // The newer reservation is still the live one and releases normally.
    newer.release()
    expect(runtime.coordinator.scopeOf(child.id)).toBeUndefined()
    const next = await runtime.coordinator.acquire(child, SessionId('next-writer'), dir)
    next.release()
  })
})

describe('teardown', () => {
  it('drains only attached Nexus resources and leaves native agents untouched', async () => {
    const { harness, runtime } = await openCase()
    const nexusAgent = await harness.createParent('teardown-nexus')
    const foreignAgent = await harness.createParent('teardown-foreign')
    const membership = runtime.markNexusAgent(nexusAgent)
    expect(runtime.isNexusAgent(nexusAgent)).toBe(true)
    expect(runtime.isNexusAgent(foreignAgent)).toBe(false)
    // A matching session id is not membership: only the exact instance is.
    expect(runtime.isNexusAgent({ id: nexusAgent.id } as Agent)).toBe(false)

    const order: string[] = []
    runtime.attach('controller', () => {
      order.push('controller')
    })
    runtime.attach('reporter', () => {
      order.push('reporter')
    })
    runtime.attach('repository', async () => {
      await runtime.store.readSettings()
      order.push('repository')
    })
    runtime.attach('unconfirmed-worker', () => ({ released: false, unconfirmed: ['proc-1'] }))

    const status = await runtime.dispose()

    expect(order).toEqual(['repository', 'reporter', 'controller'])
    expect(status).toMatchObject({
      released: false,
      unconfirmedResources: ['unconfirmed-worker: proc-1'],
      retainedScopes: [],
      failures: [],
    })
    // Nothing outside the attached resources was stopped: both native Agents live.
    expect(harness.ctx.agents.get(SessionId('teardown-nexus'))).toBe(nexusAgent)
    expect(harness.ctx.agents.get(SessionId('teardown-foreign'))).toBe(foreignAgent)
    // Membership does not survive the runtime, and new admissions are refused.
    expect(runtime.isNexusAgent(nexusAgent)).toBe(false)
    expect(failureCode(() => runtime.markNexusAgent(foreignAgent))).toBe('RESOURCE_NOT_AVAILABLE')
    expect(failureCode(() => runtime.attach('late', () => undefined))).toBe('RESOURCE_NOT_AVAILABLE')
    await expect(runtime.store.readSettings()).rejects.toMatchObject({ code: 'closed' })
    // Teardown is idempotent: the second call reports the same outcome.
    expect(await runtime.dispose()).toBe(status)
    membership.release()
  })

  it('reports a clean drain when every owned resource and scope confirmed cleanup', async () => {
    const { harness, runtime } = await openCase()
    const parent = await harness.createParent('clean-parent')
    const dir = join(harness.workspace, 'clean')
    await mkdir(dir, { recursive: true })
    const lease = await runtime.coordinator.acquire(parent, SessionId('clean-child'), dir)
    lease.release()
    runtime.attach('controller', () => ({ released: true, unconfirmed: [] }))

    const status = await runtime.dispose()

    expect(status).toMatchObject({ released: true, unconfirmedResources: [], retainedScopes: [], failures: [] })
  })
})

describe('shell surface cleanup', () => {
  /**
   * Mount the real tool pipeline with the native job, terminal and shell-env
   * registries and one shell surface whose provider refuses cleanup proof.
   * @returns the mounted harness and the surface.
   */
  async function openSurface(): Promise<{
    harness: ToolHarness
    surface: ReturnType<typeof createShellSurface>
  }> {
    const harness = await createToolHarness({
      cwd: process.cwd(),
      subprocess: { script: () => ({ staysOpen: true, cleanupUnconfirmed: true }) },
    })
    await harness.ctx.plugin(LocalJobRegistry)
    await harness.ctx.plugin(TerminalSessionService)
    await harness.ctx.plugin(ShellEnvRegistry)
    const config: ShellExecutionConfig = {
      deployment: {},
      terminal: { engine: 'bash', bashPath: process.execPath },
    }
    const surface = createShellSurface(harness.ctx, () => config)
    harness.ctx.tools.register(surface.tool)
    openCases.push({ close: async () => { await harness.dispose() } })
    return { harness, surface }
  }

  it('reports a managed range it could not confirm instead of claiming release', async () => {
    const { harness, surface } = await openSurface()
    const run = await harness.call('shell', { action: 'run', command: 'sleep', background: true })
    expect(run.isError, JSON.stringify(run)).toBe(false)
    const resourceId = (run.value as { process: { resourceId: string } }).process.resourceId

    const report = await surface.dispose()
    expect(report.released).toBe(false)
    expect(report.unconfirmed.join('\n')).toContain(resourceId)
    // Memoized: the scope unload that runs next cannot turn the same range into
    // a silent success.
    expect(await surface.dispose()).toBe(report)
  })

  it('makes the runtime drain report the unconfirmed range and the retained write scope', async () => {
    const { harness, surface } = await openSurface()
    const fixture = await mountNexusStoreFixture({ ctx: harness.ctx })
    const runtime = await mountRuntimeRow(harness.ctx)
    openCases.push({
      close: async () => {
        await runtime.dispose()
        await fixture.dispose()
      },
    })

    const parent = harness.owner.agent
    const dir = join(harness.owner.agent.session.header.cwd ?? harness.owner.agent.session.header.cwd ?? process.cwd())
    await mkdir(dir, { recursive: true })
    // A writer child's reservation is durable authority; a shell range that
    // cannot prove cleanup is a second, independent uncertainty.
    await runtime.coordinator.acquire(parent, SessionId('writer-with-hung-shell'), dir)
    const run = await harness.call('shell', { action: 'run', command: 'sleep', background: true })
    expect(run.isError, JSON.stringify(run)).toBe(false)
    const resourceId = (run.value as { process: { resourceId: string } }).process.resourceId
    runtime.attach('shell', () => surface.dispose())

    const status = await runtime.dispose()
    expect(status.released).toBe(false)
    expect(status.unconfirmedResources.join('\n')).toContain(resourceId)
    expect(status.retainedScopes.map((scope) => scope.childId)).toContain(SessionId('writer-with-hung-shell'))
    // The Agent's disposal alone did not release the reservation: it is still
    // the durable authority a restart will refuse.
    expect(runtime.coordinator.retainedScopes().map((scope) => scope.childId)).toContain(
      SessionId('writer-with-hung-shell'),
    )
  })
})

describe('managed resource cleanup facts', () => {
  /**
   * Mount the whole real Nexus composition over the shipped provider boundary.
   * @param script - process script; defaults to a clean finish.
   * @returns the started harness and its runtime.
   */
  async function openNexusComposition(
    script: (spec: { readonly argv: readonly string[] }) => {
      readonly staysOpen?: boolean
      readonly cleanupUnconfirmed?: boolean | (() => boolean)
    } = () => ({}),
  ): Promise<{ harness: Awaited<ReturnType<typeof mountPresetHarness>>; runtime: NexusRuntime }> {
    const harness = await mountPresetHarness({ subprocessScript: script })
    const runtime = await harness.startNexus()
    return { harness, runtime }
  }

  it('keeps the write scope when a stopped child still owns an unconfirmed shell range', async () => {
    const { harness, runtime } = await openNexusComposition(() => ({ staysOpen: true, cleanupUnconfirmed: true }))
    try {
      const parent = await harness.createAgent('hung-range-parent', NEXUS_PRESET_ID)
      await harness.runTurn(parent, 'parent')
      const started = await harness.call(
        'agent',
        { action: 'start', task: 'write child', context: 'spawn', access: 'write' },
        parent,
      )
      expect(started.isError, JSON.stringify(started)).toBe(false)
      const childId = (started.value as { childId: string }).childId
      const child = harness.ctx.agents.get(childId as never)
      expect(child).toBeDefined()
      const root = await canonicalDirectory(harness.workspace)
      expect(runtime.coordinator.scopeOf(childId as never)).toEqual({ root, state: 'held' })

      // The child owns a real managed range through the shipped controllers; the
      // provider can settle the parent but never proves the range empty.
      const run = await harness.call('shell', { action: 'run', command: 'hung-build', background: true }, child!)
      expect(run.isError, JSON.stringify(run)).toBe(false)

      const stopped = await harness.call('agent', { action: 'stop', childId }, parent)
      expect(stopped.isError, JSON.stringify(stopped)).toBe(false)
      // The driver ending is not cleanup: the tree stays refused and `stop` says so.
      expect(stopped.value).toMatchObject({ released: false, scopeRetained: root })
      expect(runtime.coordinator.scopeOf(childId as never)).toEqual({ root, state: 'unconfirmed' })

      // The durable reservation survives, so a restart refuses the tree as well.
      expect(await runtime.store.listWriteScopes()).toContainEqual({ childId, root })
      expect(await harness.fixture.readMedium()).toContain(childId)

      // No second writer may enter the tree while the range is unresolved.
      const rival = await harness.call(
        'agent',
        { action: 'start', task: 'rival writer', context: 'spawn', access: 'write' },
        parent,
      )
      expect(rival.isError).toBe(true)
      expect(String(rival.error?.message)).toMatch(/write scope/)
    } finally {
      await harness.dispose()
    }
  }, 120_000)

  it('releases the write scope when the stopped child owns nothing unresolved', async () => {
    const { harness, runtime } = await openNexusComposition()
    try {
      const parent = await harness.createAgent('clean-child-parent', NEXUS_PRESET_ID)
      await harness.runTurn(parent, 'parent')
      const started = await harness.call(
        'agent',
        { action: 'start', task: 'write child', context: 'spawn', access: 'write' },
        parent,
      )
      expect(started.isError, JSON.stringify(started)).toBe(false)
      const childId = (started.value as { childId: string }).childId
      const root = await canonicalDirectory(harness.workspace)
      expect(runtime.coordinator.scopeOf(childId as never)).toEqual({ root, state: 'held' })

      const stopped = await harness.call('agent', { action: 'stop', childId }, parent)
      expect(stopped.isError, JSON.stringify(stopped)).toBe(false)
      // Genuine clean case: no pending start, no live range, no failed start.
      expect(stopped.value).toMatchObject({ released: true })
      expect(runtime.coordinator.scopeOf(childId as never)).toBeUndefined()
      await runtime.coordinator.drain()
      expect(await runtime.store.listWriteScopes()).toEqual([])
    } finally {
      await harness.dispose()
    }
  }, 120_000)

  it('keeps a retired generation unconfirmed cleanup in the root runtime', async () => {
    const { harness, runtime } = await openNexusComposition(() => ({ staysOpen: true, cleanupUnconfirmed: true }))
    try {
      // Mount the production preset row as an independent generation, then bind
      // an Agent under it, so unloading that generation leaves the runtime alive.
      let generationCtx: Context | undefined
      const generation = harness.ctx.plugin({
        name: 'nexus-generation-only',
        inject: presetRow.inject,
        apply(pluginCtx: Context): void {
          generationCtx = pluginCtx
          presetRow.apply(pluginCtx, {})
        },
      })
      await generation
      if (generationCtx === undefined) throw new Error('the generation row did not activate')
      const handle = await generationCtx.agents.create({
        sessionId: SessionId('generation-only-agent'),
        meta: { cwd: harness.workspace },
        agentOptions: { ...PRESET_ROUTE },
      })
      const agent = handle.agent

      const run = await harness.call('shell', { action: 'run', command: 'hung-build', background: true }, agent)
      expect(run.isError, JSON.stringify(run)).toBe(false)
      const resourceId = (run.value as { process: { resourceId: string } }).process.resourceId

      // Generation-only unload: the runtime must stay alive and own the outcome.
      await generation.dispose()
      expect(runtime.getSettings().value).toEqual(DEFAULT_SETTINGS)

      const status = await runtime.dispose()
      expect(status.unconfirmedResources.join('\n')).toContain(resourceId)
      expect(status.released).toBe(false)
    } finally {
      await harness.dispose()
    }
  }, 120_000)
})

describe('closing admissions', () => {
  it('refuses new settings, prompt and web work once the runtime stops admitting', async () => {
    const { harness, runtime } = await openCase()
    const agent = await harness.createParent('closing-admissions')
    await runtime.prompts.initialize(agent)

    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    runtime.attach('slow-owned-resource', () => held)
    const closing = runtime.dispose()
    try {
      await settledWork()

      const before = runtime.getSettings()
      await expect(
        runtime.saveSettings({ ...before.value, terminal: { engine: 'pwsh' } }, before.hash),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
      await expect(
        runtime.prompts.apply(agent, [], (await runtime.store.readLibrary()).hash),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
      await expect(
        runtime.webResults.save({
          owner: 'closing-admissions',
          kind: 'fetch',
          source: 'https://example.invalid/',
          content: 'BODY',
          textBasis: 'content',
          upstreamTruncated: false,
        }),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
    } finally {
      release()
      await closing
    }
  }, 60_000)
})
