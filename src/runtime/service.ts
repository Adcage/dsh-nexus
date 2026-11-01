/**
 * The Nexus runtime: the one host-owned instance of Nexus state.
 *
 * Everything Nexus keeps alive between requests is created here once and shared
 * by every consumer: the durable store, the committed settings record, the write
 * coordinator and the prompt sessions. The Nexus preset (and the console API)
 * must obtain this instance instead of constructing their own, which is why it is
 * published as the Cordis service `nexusRuntime`.
 *
 * Composition contract for the rows and tasks that consume it:
 *
 * - The root `dsh-nexus` row declares {@link NEXUS_RUNTIME_INJECT}, calls
 *   {@link openNexusRuntime} from its own activation and therefore OWNS the
 *   runtime: the service, the store and the teardown effect all belong to that
 *   fiber. Preset rows declare `inject: ['nexusRuntime']` and read
 *   `ctx.nexusRuntime`; calling the opener from a preset context joins the live
 *   instance, and calling it first would tie the runtime to the preset's lifetime.
 * - A preset generation must not construct a store, coordinator, prompt-session
 *   owner, web repository or shell controller of its own. It registers what it
 *   composes with {@link NexusRuntime.attach} and marks the exact Agents it
 *   composed with {@link NexusRuntime.markNexusAgent}.
 * - The activation that opens the runtime must not await preset diagnostics: the
 *   preset registry audits rows only after the host tree settles, so waiting on
 *   that audit inside the host row would wait on itself. Diagnostics are a
 *   later, deferred step.
 *
 * @module dsh-nexus/runtime/service
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '../config.ts'
import {
  combineManagedCleanup,
  createStoreWriteScopeJournal,
  createWriteCoordinator,
  type ManagedCleanupState,
  type ManagedResourceFacts,
  type WriteCoordinator,
} from '../agent/coordination.ts'
import { createPromptSessions, type PromptSessions } from '../prompts/sessions.ts'
import type { RuntimeSettings } from '../protocol.ts'
import { NexusError } from './errors.ts'
import type { ShellExecutionConfig } from '../shell/engines.ts'
import { openNexusStore, type NexusStore, type Stored } from '../storage/store.ts'
import type { WriteScopeEntry } from '../agent/coordination.ts'
import { createWebResultRepository, type WebResultRepository } from '../web/results.ts'

/** Stable Cordis service name hosting the one Nexus runtime of a deployment. */
export const NEXUS_RUNTIME_SERVICE = 'nexusRuntime'

/**
 * Services the host row must declare before it opens the runtime.
 *
 * These are the cold-path dependencies of the opener itself; a row that omits
 * them would activate, throw and leave the composition without a runtime. The
 * opener still checks them at open time, so the failure is explicit either way.
 */
export const NEXUS_RUNTIME_INJECT: readonly string[] = Object.freeze(['storageDomain'])

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The one Nexus runtime, provided by the host row. */
    nexusRuntime: NexusRuntime
  }
}

/** One exact Agent marked as a Nexus actor, with an explicit unmark path. */
export interface NexusAgentMembership {
  /** Stop treating this exact Agent as a Nexus actor; idempotent. */
  release(): void
}

/**
 * What one Nexus-owned resource reports when the runtime drains it.
 *
 * A disposer that cannot confirm its own cleanup must say so: the runtime keeps
 * that authority unresolved instead of treating the call as success.
 */
export interface NexusCleanupReport {
  /** False when the resource could not confirm its own cleanup. */
  readonly released: boolean
  /** Short identifiers of whatever the resource could not confirm. */
  readonly unconfirmed: readonly string[]
  /**
   * Exact Agents whose managed ranges the disposal could not prove empty.
   *
   * A retiring generation hands these to the runtime, so a later disposal edge
   * for one of those Agents cannot treat the tree as clean.
   */
  readonly unresolvedAgents?: readonly Agent[]
}

/** Disposer registered with {@link NexusRuntime.attach}. */
export type NexusResourceDisposer = () => void | NexusCleanupReport | Promise<void | NexusCleanupReport>

/** What a runtime teardown actually proved. */
export interface NexusRuntimeStatus {
  /** False while any owned resource, prompt write or write scope is unresolved. */
  readonly released: boolean
  /** Labels of attached resources that reported unconfirmed cleanup. */
  readonly unconfirmedResources: readonly string[]
  /** Write scopes still retained after the drain; never force-unlocked. */
  readonly retainedScopes: readonly WriteScopeEntry[]
  /** Durable or cleanup failures observed while draining, in occurrence order. */
  readonly failures: readonly string[]
}

/** The host-owned Nexus runtime. */
export interface NexusRuntime {
  /** The one durable Nexus store. */
  readonly store: NexusStore
  /** The one write coordinator shared by every Nexus child consumer. */
  readonly coordinator: WriteCoordinator
  /** The one prompt-session owner shared by every Nexus preset generation. */
  readonly prompts: PromptSessions
  /**
   * The one saved-web-result repository over {@link NexusRuntime.store}.
   *
   * Its publication chain is per durable owner, so it belongs to the runtime and
   * not to a generation: two overlapping generations sharing this instance
   * cannot both observe one free retention slot.
   */
  readonly webResults: WebResultRepository
  /**
   * The committed settings record and the hash a later save must present.
   * @returns the immutable committed record; the hash is only a lost-update guard.
   */
  getSettings(): Stored<RuntimeSettings>
  /**
   * Replace the settings after the durable write succeeds.
   *
   * The committed reference changes only once the store accepted the record, so
   * a refused or failed save leaves every reader on the previous settings.
   * @param value - the complete new settings record.
   * @param expectedHash - hash the caller last read.
   * @returns the stored settings and their new hash.
   */
  saveSettings(value: RuntimeSettings, expectedHash: string): Promise<Stored<RuntimeSettings>>
  /**
   * The execution configuration a shell start resolves against.
   *
   * A snapshot: it never probes or starts a shell, and a saved terminal change
   * only affects later starts, never an already running handle.
   * @returns deployment defaults plus the current stored terminal settings.
   */
  getShellConfig(): ShellExecutionConfig
  /**
   * Mark one exact Agent as a Nexus actor.
   *
   * Host-only: the preset marks the Agents it composed, so a session id alone is
   * never Nexus membership and an unrelated host Agent is never included.
   * @param agent - the exact live Agent.
   * @returns the unmark path.
   */
  markNexusAgent(agent: Agent): NexusAgentMembership
  /**
   * Whether one exact Agent is a marked Nexus actor.
   *
   * False while the runtime is shutting down, so a tool call that arrives during
   * teardown is refused instead of starting new Nexus work.
   * @param agent - the Agent to test; a matching session id is not enough.
   * @returns true only for that exact marked instance while admissions are open.
   */
  isNexusAgent(agent: Agent): boolean
  /**
   * Register one Nexus-owned resource with its real disposer.
   *
   * The runtime drains attached resources (most recent first) before it closes
   * the store, so a controller, reporter, backend registration or repository
   * created by a preset generation is torn down in a defined order. Each call is
   * its own entry: two overlapping generations share the label, not the entry,
   * so detaching one never erases the other's unresolved facts.
   * @param label - short label used in the teardown report.
   * @param dispose - the resource's own cleanup path.
   * @returns a function that detaches the registration without running it.
   */
  attach(label: string, dispose: NexusResourceDisposer): () => void
  /**
   * Track the managed-resource facts of one generation's shell controllers.
   *
   * Host-only: the runtime asks these facts when a bound child is disposed, so a
   * pending or unconfirmed range keeps the child's write authority reserved. A
   * detach stops the live queries; the generation publishes its final unresolved
   * facts through {@link NexusRuntime.reportCleanup} before detaching.
   * @param facts - the generation's exact-Agent facts.
   * @returns a detach for exactly this registration.
   */
  trackManagedResources(facts: ManagedResourceFacts): () => void
  /**
   * Publish the completed cleanup outcome of one Nexus-owned resource.
   *
   * A generation that owns a resource's disposal calls this after joining the
   * real report and before it detaches, so the unresolved facts stay with the
   * root runtime after the generation is gone.
   * @param label - short label used in the teardown report.
   * @param report - the disposal's own report.
   */
  reportCleanup(label: string, report: NexusCleanupReport): void
  /**
   * Stop admissions, drain owned resources and pending writes, then close the store.
   *
   * Idempotent: repeated calls share one teardown. Nothing outside the resources
   * attached here is stopped, cancelled or disposed.
   * @returns what the teardown proved and what stayed unresolved.
   */
  dispose(): Promise<NexusRuntimeStatus>
}

/**
 * Open (or join) the one Nexus runtime of this deployment.
 *
 * Must be called from an active plugin context (a Loader row whose `inject`
 * declares the storage services). Repeated calls — including from a later preset
 * generation — return the same instance instead of opening a second store; a
 * live runtime is never replaced by a fresh one.
 * @param ctx - host plugin context providing `storageDomain`.
 * @param config - deployment configuration for the row.
 * @returns the runtime.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when the native storage service is
 *   not mounted; there is no in-memory fallback.
 */
export async function openNexusRuntime(ctx: Context, config: Config): Promise<NexusRuntime> {
  const existing = ctx.get(NEXUS_RUNTIME_SERVICE)
  if (existing !== undefined) return existing
  if (ctx.get('storageDomain') === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      'the Nexus runtime needs the native storageDomain service; it never keeps Nexus state in a private fallback',
    )
  }
  const root = ctx.root
  const pending = runtimeOpens.get(root)
  if (pending !== undefined) return pending
  const opening = createRuntime(ctx, config, () => {
    if (runtimeOpens.get(root) === opening) runtimeOpens.delete(root)
  })
  runtimeOpens.set(root, opening)
  try {
    return await opening
  } catch (error) {
    if (runtimeOpens.get(root) === opening) runtimeOpens.delete(root)
    throw error
  }
}

/**
 * In-flight and live runtime per root context, so two rows cannot open two stores.
 *
 * This is an identity guard, not Nexus state: durable records live in the store
 * and the write-authority table lives in the coordinator.
 */
const runtimeOpens = new WeakMap<Context, Promise<NexusRuntime>>()

/** What {@link createRuntime} hands the handle. */
interface RuntimeParts {
  readonly deployment: Config
  readonly store: NexusStore
  readonly coordinator: WriteCoordinator
  readonly prompts: PromptSessions
  readonly webResults: WebResultRepository
  readonly initial: Stored<RuntimeSettings>
  readonly detachService: () => void
  readonly onClosed: () => void
}

/**
 * Freeze one JSON value, so a published snapshot cannot be edited by a reader.
 * @param value - JSON data owned by the runtime.
 * @returns the same value, frozen at every level.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member)
  return value
}

/**
 * Freeze one stored record together with its hash.
 * @param record - the record and hash the store returned.
 * @returns the immutable snapshot.
 */
function frozenRecord(record: Stored<RuntimeSettings>): Stored<RuntimeSettings> {
  return Object.freeze({ value: deepFreeze(record.value), hash: record.hash })
}

/**
 * Read one failure as a short line for the teardown report.
 * @param error - whatever a disposer or the medium rejected with.
 * @returns its message.
 */
function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One open runtime; constructed only by {@link createRuntime}. */
class NexusRuntimeHandle implements NexusRuntime {
  readonly store: NexusStore
  readonly coordinator: WriteCoordinator
  readonly prompts: PromptSessions
  readonly webResults: WebResultRepository
  private readonly deployment: Config
  private readonly detachService: () => void
  private readonly onClosed: () => void
  private committed: Stored<RuntimeSettings>
  /** Exact Agents this host composed as Nexus actors. */
  private readonly members = new Set<Agent>()
  /** Managed-resource fact providers of the live generations. */
  private readonly resourceFacts: { readonly facts: ManagedResourceFacts }[] = []
  /** Unconfirmed report details a retired generation handed to this runtime. */
  private readonly retainedResources: string[] = []
  /** Exact Agents whose ranges a retired generation could not prove empty. */
  private readonly retainedAgents = new Set<Agent>()
  /** Reports already folded into the teardown status (identity dedupe). */
  private readonly recordedReports = new Set<NexusCleanupReport>()
  /** Nexus-owned resources, drained most recent first. */
  private readonly resources: { readonly label: string; readonly dispose: NexusResourceDisposer }[] = []
  private closing = false
  private disposed = false
  private disposal: Promise<NexusRuntimeStatus> | undefined

  /**
   * @param parts - the shared members this runtime owns and its release hooks.
   */
  constructor(parts: RuntimeParts) {
    this.store = parts.store
    this.coordinator = parts.coordinator
    this.prompts = parts.prompts
    this.webResults = parts.webResults
    this.deployment = parts.deployment
    this.committed = parts.initial
    this.detachService = parts.detachService
    this.onClosed = parts.onClosed
  }

  getSettings(): Stored<RuntimeSettings> {
    this.assertOpen('read the Nexus settings')
    return this.committed
  }

  async saveSettings(value: RuntimeSettings, expectedHash: string): Promise<Stored<RuntimeSettings>> {
    this.assertOpen('save the Nexus settings')
    this.assertAdmitting('save the Nexus settings')
    const saved = frozenRecord(await this.store.saveSettings(value, expectedHash))
    this.committed = saved
    return saved
  }

  getShellConfig(): ShellExecutionConfig {
    this.assertOpen('read the Nexus shell configuration')
    return Object.freeze({ deployment: this.deployment, terminal: this.committed.value.terminal })
  }

  markNexusAgent(agent: Agent): NexusAgentMembership {
    this.assertAdmitting('mark a Nexus Agent')
    this.members.add(agent)
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.members.delete(agent)
      },
    }
  }

  isNexusAgent(agent: Agent): boolean {
    return !this.closing && this.members.has(agent)
  }

  attach(label: string, dispose: NexusResourceDisposer): () => void {
    this.assertAdmitting(`attach "${label}"`)
    const entry = { label, dispose }
    this.resources.push(entry)
    return () => {
      const index = this.resources.indexOf(entry)
      if (index >= 0) this.resources.splice(index, 1)
    }
  }

  trackManagedResources(facts: ManagedResourceFacts): () => void {
    this.assertAdmitting('track managed resources')
    const entry = { facts }
    this.resourceFacts.push(entry)
    return () => {
      const index = this.resourceFacts.indexOf(entry)
      if (index >= 0) this.resourceFacts.splice(index, 1)
    }
  }

  reportCleanup(label: string, report: NexusCleanupReport): void {
    this.recordReport(label, report)
  }

  /**
   * The cleanup fact for one exact Agent, as this runtime can prove it now.
   * @param agent - the Agent a bound child's write authority belongs to.
   * @returns a retained or tracked `unconfirmed` over `pending` over `clean`.
   */
  managedCleanupOf(agent: Agent): ManagedCleanupState {
    if (this.retainedAgents.has(agent)) return 'unconfirmed'
    let state: ManagedCleanupState = 'clean'
    for (const entry of this.resourceFacts) state = combineManagedCleanup(state, entry.facts.cleanupOf(agent))
    return state
  }

  /**
   * Record one completed resource report exactly once.
   *
   * The same report object may arrive twice (an attached disposer the runtime
   * drained and the generation that published it), so identity is the dedupe
   * key; unresolved facts it names stay owned by this runtime afterwards.
   * @param label - resource label for the teardown status.
   * @param report - the report to record.
   */
  private recordReport(label: string, report: NexusCleanupReport): void {
    if (this.recordedReports.has(report)) return
    this.recordedReports.add(report)
    if (report.released === false) {
      const detail = report.unconfirmed.map((item) => `${label}: ${item}`)
      this.retainedResources.push(...(detail.length > 0 ? detail : [label]))
    }
    for (const agent of report.unresolvedAgents ?? []) this.retainedAgents.add(agent)
  }

  dispose(): Promise<NexusRuntimeStatus> {
    this.disposal ??= this.runDisposal()
    return this.disposal
  }

  /**
   * Stop admissions, drain owned resources and pending writes, then close the store.
   *
   * The order is the contract: admissions close synchronously first, accepted work
   * is joined, and only then does the store close. A resource that reports
   * unconfirmed cleanup or a write scope that stayed reserved keeps `released`
   * false, and no failure is converted into success.
   * @returns what the teardown proved.
   */
  private async runDisposal(): Promise<NexusRuntimeStatus> {
    this.closing = true
    // Synchronously refuse every new admission before anything is joined, so no
    // accepted work can be refused later by the closing store.
    this.coordinator.closeAdmissions()
    this.prompts.closeAdmissions()
    this.webResults.closeAdmissions()
    const failures: string[] = []
    const unconfirmedResources: string[] = []
    for (const entry of this.resources.splice(0).reverse()) {
      try {
        const report = await entry.dispose()
        if (report !== undefined) this.recordReport(entry.label, report)
      } catch (error) {
        unconfirmedResources.push(entry.label)
        failures.push(`${entry.label}: ${describeFailure(error)}`)
      }
    }
    unconfirmedResources.push(...this.retainedResources)
    try {
      await this.prompts.drain()
    } catch (error) {
      failures.push(`prompt writes: ${describeFailure(error)}`)
    }
    try {
      await this.coordinator.dispose()
    } catch (error) {
      failures.push(`write authority: ${describeFailure(error)}`)
    }
    try {
      await this.webResults.drain()
    } catch (error) {
      failures.push(`saved web results: ${describeFailure(error)}`)
    }
    const retainedScopes = this.coordinator.retainedScopes()
    this.members.clear()
    this.prompts.dispose()
    try {
      await this.store.dispose()
    } catch (error) {
      failures.push(`store: ${describeFailure(error)}`)
    }
    this.disposed = true
    this.detachService()
    this.onClosed()
    return Object.freeze({
      released:
        unconfirmedResources.length === 0 &&
        retainedScopes.length === 0 &&
        this.retainedAgents.size === 0 &&
        failures.length === 0,
      unconfirmedResources: Object.freeze(unconfirmedResources),
      retainedScopes,
      failures: Object.freeze(failures),
    })
  }

  /**
   * Refuse a read on a runtime that already closed its store.
   * @param action - what the caller tried, for the message.
   */
  private assertOpen(action: string): void {
    if (this.disposed) {
      throw new NexusError('RESOURCE_NOT_AVAILABLE', `cannot ${action}: this Nexus runtime is already disposed`)
    }
  }

  /**
   * Refuse a new admission while the runtime is shutting down.
   * @param action - what the caller tried, for the message.
   */
  private assertAdmitting(action: string): void {
    if (this.closing) {
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        `cannot ${action}: this Nexus runtime is shutting down and admits no new Nexus work`,
      )
    }
  }
}

/**
 * Open the store, load durable write authority and build the one runtime handle.
 * @param host - the host row's context; it owns the store and the service.
 * @param config - deployment configuration for the row.
 * @param onClosed - called once the runtime closed, to forget its identity.
 * @returns the runtime, published as `nexusRuntime`.
 */
async function createRuntime(host: Context, config: Config, onClosed: () => void): Promise<NexusRuntime> {
  const store = await openNexusStore(host, { disposeOnUnload: false })
  // The coordinator asks the host's managed-resource facts; the handle answers
  // once it is constructed, and no Agent can be disposed before this function
  // returns.
  let facts: ManagedResourceFacts = { cleanupOf: () => 'unconfirmed' }
  const coordinator = createWriteCoordinator(host, createStoreWriteScopeJournal(store), {
    cleanupOf: (agent) => facts.cleanupOf(agent),
  })
  let detachService: (() => void) | undefined
  let handle: NexusRuntimeHandle
  const prompts = { value: undefined as PromptSessions | undefined }
  try {
    // Every survivor of a previous process is unresolved: a restart is not a
    // cleanup receipt, so its tree stays refused. All fallible reads finish
    // before the listener-owning prompt sessions exist (failed open leaves no
    // listener behind holding a closed store).
    await coordinator.restore()
    const initial = frozenRecord(await store.readSettings())
    prompts.value = createPromptSessions(host, store)
    handle = new NexusRuntimeHandle({
      deployment: deepFreeze({ ...config }),
      store,
      coordinator,
      prompts: prompts.value,
      webResults: createWebResultRepository(store),
      initial,
      detachService: () => {
        detachService?.()
      },
      onClosed,
    })
    facts = { cleanupOf: (agent) => handle.managedCleanupOf(agent) }
  } catch (error) {
    prompts.value?.dispose()
    await coordinator.dispose().catch(() => undefined)
    await store.dispose().catch(() => undefined)
    throw error
  }
  try {
    detachService = host.provide(NEXUS_RUNTIME_SERVICE, handle)
    host.effect(() => () => handle.dispose(), NEXUS_RUNTIME_SERVICE)
  } catch (error) {
    // A row that cannot publish its service must not leave an open store behind.
    await handle.dispose().catch(() => undefined)
    throw error
  }
  return handle
}
