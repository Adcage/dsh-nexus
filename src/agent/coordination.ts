/**
 * Exclusive write scopes for internal children (AG-08).
 *
 * A write child is admitted only when no other admitted writer covers the same
 * directory or one of its ancestors/descendants: two writers racing over one
 * tree is exactly the uncoordinated mutation the requirement forbids. Scopes
 * are compared after canonicalization, so a spelling difference, a case
 * difference on Windows or a junction alias cannot smuggle a second writer into
 * the same tree. Two genuinely isolated directories (sibling subdirectories,
 * separate worktrees) do not overlap and run side by side.
 *
 * The coordinator is an ordinary object owned by the top-level runtime and
 * passed to every consumer; it is never a module global, so two sessions and
 * two preset generations of the same deployment share one lease table while an
 * unloaded plugin cannot leave a live writer in it.
 *
 * A lease outlives a child's turn on purpose: a resumable child that finished a
 * turn still owns its scope until the native runtime proves it released the
 * child (`agent/disposed`) or the caller completed a targeted drain. A result,
 * an error, an interrupt acknowledgement or an inferred idle state are NOT
 * release proof.
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

/** The single lease table shared by every Nexus child consumer in a deployment. */
export interface WriteCoordinator {
  /**
   * Reserve an exclusive write scope for one child.
   * @param owner - exact Agent authorizing the child's write access.
   * @param childId - durable child session id the scope is granted to.
   * @param cwd - directory the child will treat as its workspace root.
   * @returns the held lease.
   * @throws NexusError `WRITE_SCOPE_BUSY` when another writer overlaps this tree.
   * @throws NexusError `INVALID_ARGUMENT` when the directory cannot be canonicalized.
   */
  acquire(owner: Agent, childId: SessionId, cwd: string): Promise<WriteLease>
}

/** One row of the lease table. */
interface LeaseRecord {
  readonly owner: Agent
  readonly childId: SessionId
  /** Canonical root as the filesystem reports it, for display. */
  readonly root: string
  /** Comparison key: case-folded on Windows, otherwise the canonical root. */
  readonly key: string
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
 * `ctx` supplies the live Agent registry: a lease whose owner Agent and child
 * are both provably gone no longer holds authority, so a later writer is not
 * blocked forever by a torn-down session. The coordinator also releases a lease
 * when the native runtime disposes that exact child — the confirmed-release
 * edge, never an inferred idle state.
 * @param ctx - context providing the Agent registry.
 * @returns the coordinator to pass to every child consumer.
 */
export function createWriteCoordinator(ctx: Context): WriteCoordinator {
  const leases = new Map<string, LeaseRecord>()

  /** Whether a record's writer and authorizing Agent are both gone. */
  const abandoned = (record: LeaseRecord): boolean => {
    const agents = ctx.get('agents')
    if (agents === undefined) return false
    if (agents.get(record.owner.id) === record.owner) return false
    return agents.get(record.childId) === undefined
  }

  /** Release one record; the caller has already proven the writer is gone. */
  const drop = (record: LeaseRecord): void => {
    record.released = true
    if (leases.get(record.key) === record) leases.delete(record.key)
  }

  const disposeListener = ctx.on('agent/disposed', ({ agent }) => {
    for (const record of [...leases.values()]) {
      if (record.childId === agent.id) drop(record)
    }
  })
  ctx.effect(() => () => {
    disposeListener()
    leases.clear()
  }, 'nexus write coordinator')

  return {
    async acquire(owner, childId, cwd) {
      const root = await canonicalDirectory(cwd)
      const key = directoryKey(root)
      for (const record of [...leases.values()]) {
        // One child holds one scope: the same tree keeps the existing lease, and
        // a new tree replaces it once that tree is free.
        if (record.childId === childId) {
          if (record.key === key) return leaseOf(record)
          drop(record)
        }
      }
      for (const record of [...leases.values()]) {
        if (abandoned(record)) {
          drop(record)
          continue
        }
        if (scopesOverlap(record.root, root)) {
          throw new NexusError(
            'WRITE_SCOPE_BUSY',
            `another child (${record.childId}) already holds the write scope "${record.root}", which overlaps "${root}"; use an isolated directory or wait for that writer to finish`,
          )
        }
      }
      const record: LeaseRecord = { owner, childId, root, key, released: false }
      leases.set(key, record)
      return leaseOf(record)
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
