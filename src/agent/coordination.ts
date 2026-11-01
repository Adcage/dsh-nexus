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
 * explicit release or the coordinator's own scope teardown (a Task 9 lifetime
 * concern) ends such a lease. A result, an error, an interrupt acknowledgement
 * or an inferred idle state are never release proof either.
 *
 * @module dsh-nexus/agent/coordination
 */

import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { NexusError } from '../runtime/errors.ts'

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
}

/** One row of the lease table. */
interface LeaseRecord {
  readonly owner: Agent
  readonly childId: SessionId
  /** Canonical root as the filesystem reports it, for display. */
  readonly root: string
  /** Comparison key: case-folded on Windows, otherwise the canonical root. */
  readonly key: string
  /** Why this scope is still reserved; see {@link WriteScopeState}. */
  state: WriteScopeState
  released: boolean
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
 * Create the deployment's write coordinator.
 *
 * The coordinator releases an ordinary lease when the native runtime disposes the
 * child that holds it — the confirmed-release edge, never an inferred idle
 * state. It never reclaims one because an Agent is absent or replaced: that is
 * the same negative evidence a silently failed rollback leaves behind, so a
 * cleanup-unconfirmed reservation stays reserved.
 * @param ctx - context that owns the coordinator's lifetime.
 * @returns the coordinator to pass to every child consumer.
 */
export function createWriteCoordinator(ctx: Context): WriteCoordinator {
  const leases = new Map<string, LeaseRecord>()

  /** Release one record after an explicit release or a bound child's disposal. */
  const drop = (record: LeaseRecord): void => {
    record.released = true
    if (leases.get(record.key) === record) leases.delete(record.key)
  }

  const disposeListener = ctx.on('agent/disposed', ({ agent }) => {
    for (const record of [...leases.values()]) {
      // An unconfirmed reservation has no trusted identity: a disposal of the
      // same id may be a later residency, so it is not a cleanup fact.
      if (record.state === 'unconfirmed') continue
      if (record.childId === agent.id) drop(record)
    }
  })
  ctx.effect(() => () => {
    disposeListener()
    leases.clear()
  }, 'nexus write coordinator')

  /** The one record a child holds, if any. */
  const recordOf = (childId: SessionId): LeaseRecord | undefined => {
    for (const record of leases.values()) {
      if (record.childId === childId) return record
    }
    return undefined
  }

  return {
    async acquire(owner, childId, cwd) {
      const root = await canonicalDirectory(cwd)
      const key = directoryKey(root)
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
      for (const record of [...leases.values()]) {
        if (record.childId !== childId) continue
        // One child holds one scope: the same tree keeps the existing lease. A
        // different tree replaces it only for an ordinary lease; an unconfirmed
        // reservation cannot be moved, because moving it would release it.
        if (record.key === key) return leaseOf(record)
        if (record.state === 'unconfirmed') {
          throw new NexusError(
            'WRITE_SCOPE_BUSY',
            `child "${childId}" still holds the write scope "${record.root}" after a start with unconfirmed cleanup, so that scope cannot be moved or replaced; release or restart the deployment scope to recover it`,
          )
        }
        drop(record)
      }
      const record: LeaseRecord = { owner, childId, root, key, state: 'held', released: false }
      leases.set(key, record)
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
  }

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
