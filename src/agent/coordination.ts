/**
 * Exclusive write scopes for internal children (AG-08).
 *
 * A scope is the directory tree a child can ACTUALLY write: the native
 * `workspace-write` root its session resolves, not the subdirectory it happens
 * to use as a working directory. Two children of one delegating session share
 * that root, so they can mutate each other's files no matter how different
 * their requested directories look; a second writer over an overlapping root is
 * refused with `WRITE_SCOPE_BUSY` before it is admitted.
 *
 * Scopes are compared after canonicalization, so a spelling difference, a case
 * difference on Windows or a junction alias cannot smuggle a second writer into
 * one tree. Overlap means identical roots or one root inside the other. Two
 * disjoint granted roots — which only two differently authorized sessions can
 * own — do not overlap and run side by side; different subdirectories of one
 * session's workspace are NOT isolated scopes.
 *
 * The lease covers only the agent workspace root. The platform's shared scratch
 * areas (`tmpdir` and the sandbox backend's temp directory) are not leased and
 * are not private per-child isolation; a child that writes there is outside
 * this coordination.
 *
 * The coordinator is an ordinary object owned by the top-level runtime and
 * passed to every consumer; it is never a module global, so two sessions and
 * two preset generations of the same deployment share one lease table while an
 * unloaded plugin cannot leave a live writer in it.
 *
 * A lease has two lifetimes. An ordinary (`held`) lease belongs to a child the
 * runtime published, and it ends on the native `agent/disposed` edge for that
 * child or on an explicit {@link WriteLease.release}. A lease whose child start
 * rejected with unconfirmed cleanup is marked `unconfirmed` by its owner and has
 * NO automatic end: absence of an Agent or a Session, a replaced Agent for the
 * same session id, and a later residency's disposal are all negative evidence,
 * so none of them may unlock a scope a possibly live writer still uses. Only an
 * explicit release ends such a lease. A result, an error, an interrupt
 * acknowledgement or an inferred idle state are never release proof either.
 *
 * The runtime composes this coordinator with a durable journal, so a reservation
 * is evidence on the medium before a writer is admitted. Teardown does not clear
 * the table: an unresolved reservation survives as a record the next coordinator
 * loads and treats as unresolved authority (Task 9). A scope table that was
 * cleared, a restarted process and an absent Agent registry are not cleanup
 * proof.
 *
 * @module dsh-nexus/agent/coordination
 */

import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { WriteScopeRecord } from '../protocol.ts'
import { NexusError } from '../runtime/errors.ts'
import type { NexusStore } from '../storage/store.ts'

/** One exclusive write scope held by one admitted writer child. */
export interface WriteLease {
  /** Child the scope was granted to. */
  readonly childId: SessionId
  /** Canonical directory root the lease covers. */
  readonly cwd: string
  /** Give the scope back; idempotent and safe to call more than once. */
  release(): void
}

/**
 * Why one scope is still reserved: `held` for a child the runtime published,
 * `unconfirmed` when a rejected start left its cleanup unproven.
 */
export type WriteScopeState = 'held' | 'unconfirmed'

/** One child's reserved scope as the host may report it, without releasing it. */
export interface WriteScope {
  /** Canonical root the child still holds. */
  readonly root: string
  /** Why it is still held. */
  readonly state: WriteScopeState
}

/**
 * What the host can prove about one exact Agent's managed resource ranges.
 *
 * `clean` means every range that Agent ever started is confirmed gone; `pending`
 * means a start is still in flight; `unconfirmed` means a range (or a failed
 * start) is not proven cleaned. Only `clean` may release durable write authority.
 */
export type ManagedCleanupState = 'clean' | 'pending' | 'unconfirmed'

/** Host-only exact-Agent managed-resource facts. */
export interface ManagedResourceFacts {
  /**
   * The cleanup fact for one exact Agent.
   * @param agent - the Agent whose managed ranges are queried.
   * @returns what the host can prove about those ranges.
   */
  cleanupOf(agent: Agent): ManagedCleanupState
}

/** One managed range a host controller cannot prove cleaned. */
export interface ManagedRangeUnresolved {
  /** Exact Agent that owns the range. */
  readonly agent: Agent
  /** A start still in flight (`pending`), or a range/failed start without proof. */
  readonly state: 'pending' | 'unconfirmed'
  /** Short identifier for the report, e.g. the resource id and the reason. */
  readonly detail: string
}

/**
 * Fold one Agent's unresolved ranges into its cleanup fact.
 * @param unresolved - every range the controller cannot prove cleaned.
 * @param agent - the Agent to answer for.
 * @returns `unconfirmed` over `pending` over `clean`.
 */
export function managedCleanupStateOf(
  unresolved: readonly ManagedRangeUnresolved[],
  agent: Agent,
): ManagedCleanupState {
  let state: ManagedCleanupState = 'clean'
  for (const entry of unresolved) {
    if (entry.agent !== agent) continue
    if (entry.state === 'unconfirmed') return 'unconfirmed'
    state = 'pending'
  }
  return state
}

/**
 * Combine two facts about one Agent, keeping the least proven one.
 * @param left - one controller's fact.
 * @param right - another controller's fact.
 * @returns `unconfirmed` over `pending` over `clean`.
 */
export function combineManagedCleanup(left: ManagedCleanupState, right: ManagedCleanupState): ManagedCleanupState {
  return CLEANUP_RANK[left] >= CLEANUP_RANK[right] ? left : right
}

/** Ordering that makes "least proven" a comparison. */
const CLEANUP_RANK: Readonly<Record<ManagedCleanupState, number>> = Object.freeze({
  clean: 0,
  pending: 1,
  unconfirmed: 2,
})

/** One reservation as the teardown report lists it, including its child. */
export interface WriteScopeEntry extends WriteScope {
  /** Child the reservation belongs to. */
  readonly childId: SessionId
}

/**
 * Durable evidence of write-scope reservations.
 *
 * A reservation is written before the child is admitted, so a process that stops
 * without a positive release leaves a record behind. The record is evidence that
 * a tree MAY still have a writer; it is never evidence that the tree is clean.
 */
export interface WriteScopeJournal {
  /**
   * Every reservation the medium still holds.
   * @returns one record per child whose reservation survived.
   */
  list(): Promise<readonly WriteScopeRecord[]>
  /**
   * Persist one reservation before the child is admitted.
   * @param record - child id and canonical root to keep.
   */
  put(record: WriteScopeRecord): Promise<void>
  /**
   * Delete one child's reservation after a positive release.
   * @param childId - child whose scope was released.
   */
  delete(childId: string): Promise<void>
}

/** The single lease table shared by every Nexus child consumer in a deployment. */
export interface WriteCoordinator {
  /**
   * Reserve an exclusive write scope for one child.
   * @param owner - exact Agent authorizing the child's write access.
   * @param childId - durable child session id the scope is granted to.
   * @param cwd - the granularity of the scope: pass the workspace root the child
   *   can actually write, not its working directory.
   * @returns the held lease.
   * @throws NexusError `WRITE_SCOPE_BUSY` when another writer overlaps this tree.
   * @throws NexusError `INVALID_ARGUMENT` when the directory cannot be canonicalized.
   */
  acquire(owner: Agent, childId: SessionId, cwd: string): Promise<WriteLease>
  /**
   * Mark one child's held scope as cleanup-unconfirmed.
   *
   * After this, nothing releases the scope except an explicit release or the
   * coordinator's own teardown: absence of an Agent or Session, a replaced
   * owner, and a later disposal of that child id are all negative evidence.
   * @param childId - child whose reservation is retained.
   */
  pin(childId: SessionId): void
  /**
   * Report the scope one child still holds, without releasing it.
   * @param childId - child to look up.
   * @returns its scope and state, or undefined when it holds none.
   */
  scopeOf(childId: SessionId): WriteScope | undefined
  /** Refuse new reservations now; accepted work still drains. */
  closeAdmissions(): void
  /**
   * Load the durable reservations this coordinator did not create.
   *
   * Every survivor is treated as cleanup-unconfirmed: a restart is not a cleanup
   * fact, so its tree stays refused until a positive release, not a retry.
   * @throws when the journal cannot be read.
   */
  restore(): Promise<void>
  /**
   * Every scope still reserved, including unresolved survivors of a restart.
   * @returns the reservations in table order.
   */
  retainedScopes(): readonly WriteScopeEntry[]
  /**
   * Wait for every durable reservation write this coordinator queued.
   * @throws the first durable failure observed; teardown keeps going on its own path.
   */
  drain(): Promise<void>
  /**
   * Stop admitting writers, remove the native disposal listener and drain.
   *
   * Does NOT release anything: a reservation that was never positively released
   * stays reserved and stays durable, so the next runtime refuses its tree.
   * @throws the first durable failure observed.
   */
  dispose(): Promise<void>
}

/** One row of the lease table. */
interface LeaseRecord {
  /** Agent that authorized the reservation; absent for a loaded survivor. */
  readonly owner?: Agent
  readonly childId: SessionId
  /** Canonical root as the filesystem reports it, for display. */
  readonly root: string
  /** Comparison key: case-folded on Windows, otherwise the canonical root. */
  readonly key: string
  /** Why this scope is still reserved; see {@link WriteScopeState}. */
  state: WriteScopeState
  released: boolean
  /** Exact residency bound to this reservation, once one was observed. */
  childAgent?: Agent
  /** Loaded from the journal: unresolved authority that no retry may re-acquire. */
  readonly retained: boolean
}

/**
 * Canonicalize a directory: resolve junctions, symlinks and real case so two
 * spellings of one tree compare equal.
 * @param path - absolute directory the model or a caller supplied.
 * @returns the canonical absolute directory.
 * @throws NexusError `INVALID_ARGUMENT` when the directory does not resolve.
 */
export async function canonicalDirectory(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (error) {
    throw new NexusError(
      'INVALID_ARGUMENT',
      `"${path}" is not an existing directory that can be used as a child workspace`,
      { cause: error },
    )
  }
}

/**
 * Comparison key for one canonical directory. Windows compares paths without
 * case; every other platform treats case as significant.
 * @param path - canonical absolute directory.
 * @returns the key two scopes are compared by.
 */
export function directoryKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * Whether one canonical directory is the other or lives inside it.
 * @param root - canonical directory treated as the containing scope.
 * @param candidate - canonical directory tested against it.
 * @returns true when `candidate` is `root` or below it.
 */
export function scopeContains(root: string, candidate: string): boolean {
  const container = directoryKey(root)
  const inner = directoryKey(candidate)
  if (container === inner) return true
  const prefix = container.endsWith(sep) ? container : `${container}${sep}`
  return inner.startsWith(prefix)
}

/**
 * Whether two canonical scopes cover any common directory: identical, or one is
 * an ancestor of the other.
 * @param left - canonical directory.
 * @param right - canonical directory.
 * @returns true when the two writers would mutate one tree.
 */
export function scopesOverlap(left: string, right: string): boolean {
  return scopeContains(left, right) || scopeContains(right, left)
}

/**
 * Adapt the durable Nexus store to the coordinator's reservation journal.
 * @param store - the runtime's one store.
 * @returns the journal over the store's reservation table.
 */
export function createStoreWriteScopeJournal(store: NexusStore): WriteScopeJournal {
  return {
    list: () => store.listWriteScopes(),
    put: (record) => store.putWriteScope(record),
    delete: (childId) => store.deleteWriteScope(childId),
  }
}

/**
 * Create the deployment's write coordinator.
 *
 * The coordinator releases an ordinary lease when the native runtime disposes the
 * child that holds it — the confirmed-release edge, never an inferred idle
 * state. It never reclaims one because an Agent is absent or replaced: that is
 * the same negative evidence a silently failed rollback leaves behind, so a
 * cleanup-unconfirmed reservation stays reserved.
 *
 * With a journal, every reservation is durable before the child is admitted, so a
 * process that stops without a positive release leaves evidence behind. The next
 * coordinator loads that evidence as unresolved authority and refuses those trees
 * — clearing a scope table is not cleanup proof, and a restart is not one either.
 * @param ctx - context that owns the coordinator's lifetime.
 * @param journal - durable reservation journal; omitted by a coordinator that owns
 *   no cross-restart authority.
 * @param facts - host-managed resource facts; when given, a bound child's disposal
 *   releases authority only for a proven-clean Agent.
 * @returns the coordinator to pass to every child consumer.
 */
export function createWriteCoordinator(
  ctx: Context,
  journal?: WriteScopeJournal,
  facts?: ManagedResourceFacts,
): WriteCoordinator {
  const leases = new Map<string, LeaseRecord>()
  /** Agents whose creation this coordinator observed, by exact identity. */
  const createdAgents = new WeakSet<Agent>()
  /** Agents already bound to one reservation; a released residency is never re-bound. */
  const claimedAgents = new WeakSet<Agent>()
  /** Durable failures nobody awaited; surfaced by {@link WriteCoordinator.drain}. */
  const failures: unknown[] = []
  let closing = false
  /** Tail of the durable reservation work, in the order the table changed. */
  let journalChain: Promise<unknown> = Promise.resolve()

  /**
   * Queue one durable reservation operation behind the previous one.
   * @param operation - durable step to run.
   * @returns its result; the recorded chain itself never rejects.
   */
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = journalChain.then(operation, operation)
    journalChain = next.catch(() => undefined)
    return next
  }

  /** The one record a child holds, if any. */
  const recordOf = (childId: SessionId): LeaseRecord | undefined => {
    for (const record of leases.values()) {
      if (record.childId === childId) return record
    }
    return undefined
  }

  /**
   * Delete one released reservation durably.
   *
   * The delete is re-checked when it runs: a newer reservation for the same child
   * owns the row by then, so an older release can never delete it.
   * @param record - the record that was released.
   */
  const persistRelease = (record: LeaseRecord): void => {
    if (journal === undefined) return
    void enqueue(async () => {
      const live = recordOf(record.childId)
      if (live !== undefined && live !== record) return
      await journal.delete(record.childId)
    }).catch((error: unknown) => {
      failures.push(error)
    })
  }

  /** Release one record after an explicit release or a bound child's disposal. */
  const drop = (record: LeaseRecord): void => {
    if (record.released) return
    record.released = true
    if (leases.get(record.key) === record) leases.delete(record.key)
    persistRelease(record)
  }

  /**
   * Bind the reservation to the exact Agent that is its residency.
   * @param record - the reservation.
   * @param childId - child the reservation belongs to.
   */
  const bindChild = (record: LeaseRecord, childId: SessionId): void => {
    const live = ctx.get('agents')?.get(childId)
    if (live === undefined || record.childAgent !== undefined) return
    if (!createdAgents.has(live) || claimedAgents.has(live)) return
    record.childAgent = live
    claimedAgents.add(live)
  }

  const createdListener = ctx.on('agent/created', ({ agent }) => {
    createdAgents.add(agent)
    const record = recordOf(agent.id)
    if (record === undefined || record.childAgent !== undefined) return undefined
    if (claimedAgents.has(agent)) return undefined
    record.childAgent = agent
    claimedAgents.add(agent)
    return undefined
  })

  const disposeListener = ctx.on('agent/disposed', ({ agent }) => {
    for (const record of [...leases.values()]) {
      if (record.childId !== agent.id) continue
      // An unresolved reservation has no trusted identity: a disposal of the same
      // id may be a later residency, so it is not a cleanup fact.
      if (record.retained || record.state === 'unconfirmed') continue
      if (record.childAgent !== undefined) {
        // A different, known earlier residency is not this reservation's edge.
        if (record.childAgent !== agent) continue
      } else if (createdAgents.has(agent)) {
        continue
      }
      // The native disposal proves the driver ended, not that every range the
      // child owned is empty. Ask the host's managed-resource facts: only a
      // proven-clean Agent may release durable write authority; pending or
      // unconfirmed ranges pin the scope instead.
      if (facts !== undefined && facts.cleanupOf(agent) !== 'clean') {
        record.state = 'unconfirmed'
        continue
      }
      drop(record)
    }
  })

  const coordinator: WriteCoordinator = {
    async acquire(owner, childId, cwd) {
      if (closing) {
        throw new NexusError(
          'RESOURCE_NOT_AVAILABLE',
          'the Nexus write coordinator is shutting down; no new writer is admitted while its reservations drain',
        )
      }
      const root = await canonicalDirectory(cwd)
      const key = directoryKey(root)
      if (closing) {
        throw new NexusError(
          'RESOURCE_NOT_AVAILABLE',
          'the Nexus write coordinator is shutting down; no new writer is admitted while its reservations drain',
        )
      }
      const current = recordOf(childId)
      if (current?.retained === true) {
        throw new NexusError(
          'WRITE_SCOPE_BUSY',
          `child "${childId}" still holds the write scope "${current.root}" from a process that stopped without confirming its cleanup; that reservation is retained and never force-unlocked by a restart, so no writer may be admitted into it`,
        )
      }
      // Prove the requested tree is free BEFORE touching this child's current
      // lease: a refused move must leave the child holding what it already had.
      for (const record of [...leases.values()]) {
        if (record.childId === childId) continue
        if (scopesOverlap(record.root, root)) {
          throw new NexusError(
            'WRITE_SCOPE_BUSY',
            `another child (${record.childId}) already holds the write scope "${record.root}", which overlaps "${root}"; a workspace can have one writer at a time, so wait for that writer to finish`,
          )
        }
      }
      if (current !== undefined) {
        // One child holds one scope: the same tree keeps the existing lease. A
        // different tree replaces it only for an ordinary lease; an unconfirmed
        // reservation cannot be moved, because moving it would release it.
        if (current.key === key) return leaseOf(current)
        if (current.state === 'unconfirmed') {
          throw new NexusError(
            'WRITE_SCOPE_BUSY',
            `child "${childId}" still holds the write scope "${current.root}" after a start with unconfirmed cleanup, so that scope cannot be moved or replaced; release or restart the deployment scope to recover it`,
          )
        }
        drop(current)
      }
      const record: LeaseRecord = {
        owner,
        childId,
        root,
        key,
        state: 'held',
        released: false,
        retained: false,
      }
      // The check above and this insert are one synchronous step: a concurrent
      // acquire sees the record instead of racing it into the same tree.
      leases.set(key, record)
      if (journal !== undefined) {
        try {
          // Durable evidence BEFORE the child can be admitted with a writer.
          await enqueue(() => journal.put({ childId, root }))
        } catch (error) {
          if (leases.get(key) === record) leases.delete(key)
          record.released = true
          throw error
        }
      }
      bindChild(record, childId)
      return leaseOf(record)
    },
    pin(childId) {
      const record = recordOf(childId)
      if (record === undefined || record.released) return
      record.state = 'unconfirmed'
    },
    scopeOf(childId) {
      const record = recordOf(childId)
      return record === undefined ? undefined : { root: record.root, state: record.state }
    },
    closeAdmissions() {
      closing = true
    },
    async restore() {
      if (journal === undefined) return
      const records = await journal.list()
      for (const record of records) {
        const key = directoryKey(record.root)
        if (leases.has(key)) continue
        if (recordOf(SessionId(record.childId)) !== undefined) continue
        leases.set(key, {
          childId: SessionId(record.childId),
          root: record.root,
          key,
          state: 'unconfirmed',
          released: false,
          retained: true,
        })
      }
    },
    retainedScopes() {
      return [...leases.values()]
        .filter((record) => !record.released)
        .map((record) => ({ childId: record.childId, root: record.root, state: record.state }))
    },
    drain() {
      return drainJournal()
    },
    dispose() {
      return dispose()
    },
  }

  /**
   * Wait until every queued reservation operation settled.
   * @throws the first durable failure nobody awaited.
   */
  async function drainJournal(): Promise<void> {
    for (;;) {
      const tail = journalChain
      await tail
      if (journalChain === tail) break
    }
    if (failures.length > 0) throw failures[0]
  }

  let disposal: Promise<void> | undefined
  /**
   * Stop admissions, remove both lifecycle listeners and wait for the journal.
   *
   * No reservation is released here: an unresolved scope keeps its durable record
   * so the next runtime refuses its tree instead of trusting an empty table.
   * @returns resolution after the journal settled.
   */
  function dispose(): Promise<void> {
    disposal ??= (async () => {
      closing = true
      createdListener()
      disposeListener()
      await drainJournal()
    })()
    return disposal
  }

  ctx.effect(() => () => dispose(), 'nexus write coordinator')

  return coordinator

  /** Project one record into the lease surface a caller holds. */
  function leaseOf(record: LeaseRecord): WriteLease {
    return {
      childId: record.childId,
      cwd: record.root,
      release() {
        if (record.released) return
        drop(record)
      },
    }
  }
}
