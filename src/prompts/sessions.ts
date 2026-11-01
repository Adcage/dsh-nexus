/**
 * Per-session prompt snapshots over the durable Nexus store.
 *
 * A session's effective persona is a {@link PromptSnapshot}: the exact bodies it
 * was assembled from plus the text built from them. Keeping the bodies is what
 * makes the runtime independent of the library — editing, emptying or deleting a
 * module never rewrites a session that already runs with it, and a restored
 * session replays its OWN saved text instead of reassembling stored ids against
 * whatever the library holds today (PR-13, PR-16, PR-17).
 *
 * The rules this module implements:
 *
 * - `initialize` restores the session's saved snapshot first; only a session
 *   that has none is composed from the library default selection. A new
 *   delegated child instead copies its parent's ACTUAL effective snapshot
 *   (exact live parent Agent), so a child never starts from a library default
 *   the parent is not running.
 * - `apply` is the explicit "use this from the next request" action. It checks
 *   the caller's library hash, captures one complete library read, persists the
 *   snapshot, and only then swaps one in-memory reference. A persistence failure
 *   or a stale hash therefore leaves the effective text untouched, and an
 *   in-flight request keeps the text it was assembled with.
 * - `peek` is a synchronous read of that one immutable reference, so a request
 *   being assembled can never observe a half-updated state.
 *
 * State is owned by this instance. Effective snapshots are keyed by the EXACT
 * Agent object, because a session id alone is not identity: a restarted session
 * materializes a second Agent with the same id, and an operation started for the
 * old one must never publish into the new one's reference. Durable work, on the
 * other hand, is serialized per SESSION ID: the registry allows one live Agent
 * per session, so one queue per session is what makes a restart observe the
 * previous residency's write order instead of racing it.
 *
 * Two limits are stated rather than hidden. A write that was already in flight
 * when its Agent was disposed can still take effect durably while its
 * publication is refused; the next residency's restore is queued behind exactly
 * that write, so it observes the persisted record instead of diverging. And two
 * independently created instances over one store are not serialized against each
 * other — production composition must hold ONE instance across the generations
 * that can overlap (Task 9).
 *
 * Module count and byte limits are NOT validated here: Task 10 owns the single
 * library validator behind the console save/apply/preview path, so this seam
 * validates references only and never duplicates the 32-module/32 KiB/128 KiB
 * bounds.
 *
 * @module dsh-nexus/prompts/sessions
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PromptModule, PromptSnapshot } from '../protocol.ts'
import { NexusError } from '../runtime/errors.ts'
import type { NexusStore } from '../storage/store.ts'
import { composePromptText, selectedPromptModules } from './assemble.ts'

/** The per-session prompt state one Nexus plugin instance owns. */
export interface PromptSessions {
  /**
   * Give one agent its prompt snapshot and keep it as that agent's effective text.
   *
   * Idempotent: a second call (including a concurrent one) returns the snapshot
   * already effective for that exact Agent without reading the library again.
   * @param agent - the exact live Agent.
   * @returns the snapshot now effective for that agent.
   * @throws NexusError `NO_AGENT` when the Agent was disposed while restoring.
   */
  initialize(agent: Agent): Promise<PromptSnapshot>
  /**
   * Apply one selection to an agent from the next request on.
   *
   * The selection is resolved against ONE complete library read, persisted, and
   * then published as a new immutable reference; the request already in flight
   * is neither changed nor interrupted.
   * @param agent - the exact live Agent.
   * @param selection - module ids in assembly order.
   * @param expectedLibraryHash - hash the caller last read; a library that changed since then refuses the apply.
   * @returns the snapshot now effective for that agent.
   * @throws NexusError `NO_AGENT` when the Agent has no initialized snapshot or was disposed meanwhile.
   * @throws NexusError `CONFIG_CONFLICT` when the library changed since `expectedLibraryHash`.
   * @throws NexusError `INVALID_ARGUMENT` for a repeated, unknown or ambiguous module id.
   */
  apply(agent: Agent, selection: readonly string[], expectedLibraryHash: string): Promise<PromptSnapshot>
  /**
   * Read the snapshot currently effective for one agent.
   * @param agent - the exact live Agent.
   * @returns its immutable snapshot.
   * @throws NexusError `NO_AGENT` when this Agent has no effective snapshot.
   */
  peek(agent: Agent): PromptSnapshot
}

/** One exact Agent's effective snapshot plus its operation queue. */
interface AgentEntry {
  /** The exact Agent this entry belongs to; identity is the only key. */
  readonly agent: Agent
  /** Durable session identity the snapshot is persisted under and serialized by. */
  readonly sessionId: string
  /** Effective snapshot; set exactly once per publication. */
  snapshot: PromptSnapshot | undefined
}

/**
 * Detach, render and freeze one snapshot.
 *
 * The bodies, the selection and the record are copied out of whatever produced
 * them (a library record or a stored snapshot the domain also hands to other
 * readers) and frozen, so no caller and no later library edit can mutate text
 * that a request already holds. The text is passed in rather than recomposed so
 * a restored snapshot keeps the exact text it was persisted with.
 * @param sessionId - durable session owning the snapshot.
 * @param selection - module ids in assembly order.
 * @param modules - the actual bodies, in selection order.
 * @param text - the prompt text those bodies compose.
 * @returns the frozen snapshot.
 */
function freezeSnapshot(
  sessionId: string,
  selection: readonly string[],
  modules: readonly PromptModule[],
  text: string,
): PromptSnapshot {
  const bodies = modules.map((module) => Object.freeze({ id: module.id, name: module.name, body: module.body }))
  return Object.freeze({
    sessionId,
    selection: Object.freeze([...selection]),
    modules: Object.freeze(bodies),
    text,
  })
}

/** One instance of the prompt-session state. */
class PromptSessionsHandle implements PromptSessions {
  private readonly ctx: Context
  private readonly store: NexusStore
  /** Effective state per exact Agent; a session id alone never addresses an entry. */
  private readonly entries = new WeakMap<Agent, AgentEntry>()
  /** Tail of the serialized durable work for one session id, across residencies. */
  private readonly queues = new Map<string, Promise<unknown>>()

  /**
   * @param ctx - scope that owns the lifecycle listener and resolves the live parent Agent.
   * @param store - durable Nexus store holding the per-session snapshots.
   */
  constructor(ctx: Context, store: NexusStore) {
    this.ctx = ctx
    this.store = store
    // A disposed Agent's entry is dropped by exact identity: another Agent that
    // happens to share the session id keeps its own reference.
    ctx.on('agent/disposed', ({ agent }) => {
      this.entries.delete(agent)
    })
  }

  async initialize(agent: Agent): Promise<PromptSnapshot> {
    const entry = this.entryFor(agent)
    return this.serialize(entry.sessionId, () => this.resolveInitial(entry))
  }

  async apply(agent: Agent, selection: readonly string[], expectedLibraryHash: string): Promise<PromptSnapshot> {
    const entry = this.entries.get(agent)
    if (entry === undefined) {
      throw new NexusError(
        'NO_AGENT',
        `the Nexus prompt for session "${agent.id}" was never initialized; apply needs the exact Agent whose persona registration ran, not a session id`,
      )
    }
    return this.serialize(entry.sessionId, () => this.applySelection(entry, selection, expectedLibraryHash))
  }

  peek(agent: Agent): PromptSnapshot {
    const entry = this.entries.get(agent)
    if (entry?.snapshot === undefined) {
      throw new NexusError(
        'NO_AGENT',
        `this Agent has no effective Nexus prompt snapshot; only an Agent whose persona registration initialized it can be read, and a session id, a disposed Agent or a foreign Agent is not one`,
      )
    }
    return entry.snapshot
  }

  /**
   * Read or create the entry for one Agent.
   * @param agent - the exact Agent.
   * @returns its entry, created empty on first use.
   */
  private entryFor(agent: Agent): AgentEntry {
    const existing = this.entries.get(agent)
    if (existing !== undefined) return existing
    const entry: AgentEntry = { agent, sessionId: agent.id, snapshot: undefined }
    this.entries.set(agent, entry)
    return entry
  }

  /**
   * Run one complete logical operation after everything already queued for the
   * same durable session.
   *
   * The queue is keyed by session id, not by the live Agent: a restart mints a
   * second Agent for the same session, and the new residency's restore must
   * observe the old residency's durable write instead of racing it. `task` is the
   * WHOLE operation (restore, or capture/check/write/publish), so a write can
   * never land after newer work that was queued behind it. Only the current tail
   * is retained; once it settles it is dropped, so an idle session keeps no queue
   * entry. A rejection is carried forward as "settled" for the next operation
   * while the caller still receives its own error.
   * @param sessionId - durable session whose durable work is serialized.
   * @param task - complete operation to run.
   * @returns the operation's result.
   */
  private serialize<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    const settled = next.catch(() => undefined)
    this.queues.set(sessionId, settled)
    void settled.then(() => {
      if (this.queues.get(sessionId) === settled) this.queues.delete(sessionId)
    })
    return next
  }

  /**
   * Refuse work for an Agent that is no longer the live entry for its session.
   *
   * A queued operation can become stale before it starts, and an Agent can be
   * disposed while its snapshot is being captured; both must fail instead of
   * writing for a residency that no longer exists.
   * @param entry - the entry the queued operation was created for.
   * @throws NexusError `NO_AGENT` when that exact Agent is no longer live here.
   */
  private assertLive(entry: AgentEntry): void {
    if (this.entries.get(entry.agent) !== entry) {
      throw new NexusError(
        'NO_AGENT',
        `the Nexus prompt work for session "${entry.sessionId}" was refused: this Agent was disposed before the operation could run, and a session id alone cannot address another Agent's state`,
      )
    }
  }

  /**
   * Resolve one Agent's first snapshot: its own saved record, else an inherited
   * parent snapshot, else the library default selection.
   * @param entry - the Agent's entry.
   * @returns the effective snapshot.
   */
  private async resolveInitial(entry: AgentEntry): Promise<PromptSnapshot> {
    this.assertLive(entry)
    if (entry.snapshot !== undefined) return entry.snapshot
    const saved = await this.store.getPrompt(entry.sessionId)
    if (saved !== undefined) {
      if (saved.sessionId !== entry.sessionId) {
        throw new NexusError(
          'UNSUPPORTED_CAPABILITY',
          `the saved prompt for session "${entry.sessionId}" names session "${saved.sessionId}"; refusing to restore a record that belongs to another session`,
        )
      }
      return this.publish(entry, freezeSnapshot(entry.sessionId, saved.selection, saved.modules, saved.text))
    }
    const inherited = await this.inheritedSnapshot(entry.agent)
    if (inherited !== undefined) {
      const snapshot = freezeSnapshot(entry.sessionId, inherited.selection, inherited.modules, inherited.text)
      this.assertLive(entry)
      await this.store.putPrompt(snapshot)
      return this.publish(entry, snapshot)
    }
    const library = await this.store.readLibrary()
    const modules = selectedPromptModules(library.value, library.value.defaultSelection)
    const snapshot = freezeSnapshot(
      entry.sessionId,
      library.value.defaultSelection,
      modules,
      composePromptText(modules),
    )
    this.assertLive(entry)
    await this.store.putPrompt(snapshot)
    return this.publish(entry, snapshot)
  }

  /**
   * Read the parent snapshot a new delegated child starts from.
   *
   * The live parent Agent is asked first, so the child copies what the parent is
   * ACTUALLY running. Only when that Agent is gone does the parent's durable
   * record stand in — never the library, whose modules the parent may no longer
   * use.
   * @param agent - the child Agent being initialized.
   * @returns the parent's actual snapshot, or `undefined` when the parent lineage has none.
   */
  private async inheritedSnapshot(agent: Agent): Promise<PromptSnapshot | undefined> {
    const header = agent.session.header
    if (header.origin !== 'subagent') return undefined
    const parentSession = header.parentSession
    if (parentSession === undefined) return undefined
    const parentAgent = this.ctx.get('agents')?.get(parentSession)
    const live = parentAgent === undefined ? undefined : this.entries.get(parentAgent)?.snapshot
    return live ?? (await this.store.getPrompt(parentSession))
  }

  /**
   * Apply one selection: check the hash, capture one library read, persist, publish.
   * @param entry - the Agent's entry.
   * @param selection - module ids in assembly order.
   * @param expectedLibraryHash - hash the caller last read.
   * @returns the newly published snapshot.
   */
  private async applySelection(
    entry: AgentEntry,
    selection: readonly string[],
    expectedLibraryHash: string,
  ): Promise<PromptSnapshot> {
    this.assertLive(entry)
    if (entry.snapshot === undefined) {
      throw new NexusError(
        'NO_AGENT',
        `the Nexus prompt for session "${entry.sessionId}" is not initialized yet; apply cannot replace a snapshot that does not exist`,
      )
    }
    const library = await this.store.readLibrary()
    if (library.hash !== expectedLibraryHash) {
      throw new NexusError(
        'CONFIG_CONFLICT',
        'the prompt library changed since it was read; read it again and reapply the selection you meant',
      )
    }
    const modules = selectedPromptModules(library.value, selection)
    const snapshot = freezeSnapshot(entry.sessionId, selection, modules, composePromptText(modules))
    this.assertLive(entry)
    await this.store.putPrompt(snapshot)
    return this.publish(entry, snapshot)
  }

  /**
   * Swap the effective reference after re-checking Agent identity.
   * @param entry - the entry the operation ran for.
   * @param snapshot - the prepared snapshot.
   * @returns the published snapshot.
   */
  private publish(entry: AgentEntry, snapshot: PromptSnapshot): PromptSnapshot {
    if (this.entries.get(entry.agent) !== entry) {
      throw new NexusError(
        'NO_AGENT',
        `the prepared Nexus prompt for session "${entry.sessionId}" was not published: this Agent was disposed while the snapshot was being prepared, and a session id alone cannot address another Agent's state`,
      )
    }
    entry.snapshot = snapshot
    return snapshot
  }
}

/**
 * Create the prompt-session state.
 *
 * One instance owns the per-Agent effective references and the per-session
 * durable queues for one plugin incarnation; production composition (the Nexus
 * preset) creates it once and registers it per Agent scope (Task 9). Two live
 * instances over one store are not serialized against each other.
 * @param ctx - registration scope; it must reach `agents` to see a live parent.
 * @param store - durable Nexus store.
 * @returns the prompt-session state.
 */
export function createPromptSessions(ctx: Context, store: NexusStore): PromptSessions {
  return new PromptSessionsHandle(ctx, store)
}
