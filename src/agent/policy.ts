/**
 * Child admission, durable child policy and its revalidation (AG-02, AG-07).
 *
 * Delegation never widens authority. Every child is admitted with an explicit
 * access level, a canonical workspace directory and the absolute depth cap of
 * its subtree; the record is persisted BEFORE the native runtime publishes the
 * child, so a cold resume can re-verify the same authorization instead of
 * trusting an id. The effective sandbox mode of the child is then narrowed
 * through the native `sandbox/mode` write path — the one fold every enforcing
 * family (filesystem, bash, terminals) resolves — and re-asserted before each
 * step, because a resident child can be woken again without a new creation
 * edge.
 *
 * A `read` child runs `read-only`. A `write` child runs `workspace-write`,
 * which the native policy service fences by its session's workspace root — for
 * a delegated child that root is the delegating session's workspace, not the
 * subdirectory the child was asked to use. The lease therefore covers that
 * whole granted root, so one workspace has at most one writer child no matter
 * which subdirectories two children name. The requested directory stays the
 * child's working directory and must live inside the granted root. A parent
 * that is itself read-only cannot delegate write access at all.
 *
 * Product limitation, stated because it is a real capability boundary of the
 * installed SDK: there is no public way to give a child a narrower
 * `workspace-write` root than its session workspace (`SandboxPolicyService`
 * resolves the root from the immutable session header; `setSandboxMode` carries
 * only a mode). Parallel writers isolated by subdirectory or worktree under ONE
 * delegating session are therefore unsupported; a worktree-isolated writer works
 * only when that session's own workspace already is that worktree. Removing this
 * needs a public per-child root API, not a Nexus workaround.
 *
 * Missing enforcement fails closed: without the shared policy service a child
 * whose policy record says "read" cannot be proven read-only, so admission and
 * the creation hook both refuse.
 *
 * A rejected native start does NOT authorize deleting the record. The native
 * runtime swallows a failed rollback (`materializeTracked` calls
 * `rollbackUnpublished(...).catch(() => void 0)`; `startExternal` only warns),
 * and the agent factory runs `detachAgent()`/`detachSession()` in a `finally`
 * BEFORE it throws the collected teardown failures — so an empty Agent/Session
 * registry is negative evidence that can occur while a published child is still
 * alive. Public API therefore offers no positive "nothing was created" receipt
 * for a start that was attempted, and the reservation (policy record plus write
 * lease) stays held and pinned: absence of an Agent, a replaced Agent for the
 * same session id, and a later disposal of that child id are all negative
 * evidence, so none of them releases it. The consequence is stated rather than
 * hidden: a reservation whose rollback silently failed and whose child is
 * already gone has no public path to release it, `stop` on that id is an
 * accepted no-op that does NOT clear the lease, and it is never force-unlocked.
 *
 * @module dsh-nexus/agent/policy
 */

import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { ChildPolicy } from '../protocol.ts'
import type { CallOwner } from '../runtime/owner.ts'
import { NexusError } from '../runtime/errors.ts'
import type { NexusStore } from '../storage/store.ts'
import { canonicalDirectory, scopeContains, type WriteCoordinator, type WriteLease } from './coordination.ts'

/** Filesystem access granted to one child. */
export type ChildAccess = 'read' | 'write'

/** The parent directory service Nexus resolves a relative child directory against. */
interface WorkingDirectoryPort {
  ensure(agent: Agent, signal?: AbortSignal): Promise<string>
}

/** What one admitted child asks for. */
export interface ChildAdmissionRequest {
  /** Reserved durable child id. */
  readonly childId: SessionIdType
  /** Requested directory: absolute, or relative to the parent's current directory. */
  readonly cwd: string
  /** Filesystem access the child is granted. */
  readonly access: ChildAccess
  /** Absolute delegation-depth cap of the child's subtree. */
  readonly maxDepth: number
}

/** One admitted child: its durable authorization plus the release path. */
export interface ChildAdmission {
  /** The record persisted before the native child was published. */
  readonly policy: ChildPolicy
  /** The lease a write child holds for its actual granted workspace root. */
  readonly lease: WriteLease | undefined
  /**
   * Release a reservation whose native start was NEVER attempted.
   *
   * This is the admission-only path (`admitChildPolicy` succeeded but the caller
   * decided not to start the child) and it is genuinely safe cleanup: no native
   * work exists, so nothing can be alive. Never call it after a rejected
   * `startActivation`: absence of a live Agent or Session is not a cleanup
   * receipt (see the module note), so that path keeps the record and the scope.
   */
  releaseUnstarted(): Promise<void>
}

/** Ordering of the three sandbox modes from narrowest to widest. */
const MODE_RANK: Readonly<Record<SandboxMode, number>> = Object.freeze({
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2,
})

/**
 * The widest mode one access level may run under.
 * @param access - granted child access.
 * @returns the ceiling mode.
 */
function ceilingMode(access: ChildAccess): SandboxMode {
  return access === 'write' ? 'workspace-write' : 'read-only'
}

/**
 * Resolve the shared policy service or fail closed.
 * @param ctx - context that should provide it.
 * @param subject - what the caller was about to do, for the message.
 * @returns the mounted service.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when it is not mounted.
 */
function requirePolicy(ctx: Context, subject: string): SandboxPolicyService {
  const policy: SandboxPolicyService | undefined = ctx.get('sandboxPolicy')
  if (policy === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot enforce ${subject}: the shared sandbox-policy service is not mounted in this scope, so a narrowed child permission cannot be proven`,
    )
  }
  return policy
}

/**
 * Narrow one agent's session to the ceiling its durable policy allows.
 *
 * Only widening is corrected: a session that is already narrower keeps its
 * stricter mode, so revalidation can never grant access by accident.
 * @param ctx - context providing the policy service.
 * @param policy - the child's durable authorization.
 * @param agent - the exact child Agent being validated.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when the policy service is missing.
 */
function narrowToPolicy(ctx: Context, policy: ChildPolicy, agent: Agent): void {
  const service = requirePolicy(ctx, `child "${policy.childId}"`)
  const current = service.overrideOf(agent.session) ?? service.defaultMode
  const ceiling = ceilingMode(policy.access)
  if (MODE_RANK[current] > MODE_RANK[ceiling]) setSandboxMode(agent.session, ceiling)
}

/**
 * Read the durable policy that governs one agent, if this agent is a Nexus child.
 * @param store - durable store holding child policies.
 * @param agent - agent being created, resumed or stepping.
 * @returns its policy, or undefined for an agent Nexus never admitted.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when the record names another parent.
 */
async function policyOf(store: NexusStore, agent: Agent): Promise<ChildPolicy | undefined> {
  if (agent.session.header.origin !== 'subagent') return undefined
  const policy = await store.getChildPolicy(agent.id)
  if (policy === undefined) return undefined
  if (policy.childId !== agent.id) {
    throw new NexusError('UNSUPPORTED_CAPABILITY', `child policy "${policy.childId}" does not belong to child "${agent.id}"`)
  }
  const parentSession = agent.session.header.parentSession
  if (parentSession !== undefined && parentSession !== policy.parentSessionId) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `child "${agent.id}" was admitted under parent "${policy.parentSessionId}" but was resumed under "${parentSession}"`,
    )
  }
  return policy
}

/**
 * Resolve the workspace root one session's writes are actually fenced by.
 * @param service - shared sandbox policy service.
 * @param session - session whose root is required.
 * @returns the canonical granted workspace root.
 * @throws NexusError `INVALID_ARGUMENT` when the root does not resolve.
 */
async function grantedWorkspaceRoot(service: SandboxPolicyService, session: Session): Promise<string> {
  const resolved = service.resolve({ session })
  return canonicalDirectory(resolved.workspaceRoot)
}

/**
 * Admit one child: validate and canonicalize its directory, reserve its write
 * scope and persist its policy.
 *
 * The reserved scope is the workspace root the child can actually write, not
 * the requested directory; see the module note on the resulting product
 * limitation. Nothing is published here; the caller starts the native
 * activation with {@link ChildAdmission.policy}'s canonical directory.
 * @param ctx - context providing the policy and directory services.
 * @param store - durable store that keeps the child policy.
 * @param coordinator - shared write coordinator.
 * @param owner - exact caller authorizing the child.
 * @param request - reserved id, directory, access and depth cap.
 * @returns the admission.
 * @throws NexusError `INVALID_ARGUMENT` for a refused directory, access or depth.
 * @throws NexusError `WRITE_SCOPE_BUSY` when the granted workspace already has a writer.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when enforcement is unavailable.
 */
export async function admitChildPolicy(
  ctx: Context,
  store: NexusStore,
  coordinator: WriteCoordinator,
  owner: CallOwner,
  request: ChildAdmissionRequest,
): Promise<ChildAdmission> {
  const service = requirePolicy(ctx, `child "${request.childId}"`)
  if (!Number.isSafeInteger(request.maxDepth) || request.maxDepth < 0) {
    throw new NexusError('INVALID_ARGUMENT', `maxDepth must be a non-negative integer, received ${request.maxDepth}`)
  }
  if (request.cwd.trim() === '') {
    throw new NexusError('INVALID_ARGUMENT', 'a child needs a workspace directory')
  }
  const existing = await store.getChildPolicy(request.childId)
  if (existing !== undefined) {
    throw new NexusError(
      'INVALID_ARGUMENT',
      `child id "${request.childId}" is already in use by a delegation from session "${existing.parentSessionId}"`,
    )
  }

  const parent = service.resolve({ session: owner.agent.session })
  const directory = ctx.get('workingDirectory') as WorkingDirectoryPort | undefined
  const parentDirectory =
    directory === undefined ? undefined : await directory.ensure(owner.agent, owner.signal)
  const requested = isAbsolute(request.cwd)
    ? request.cwd
    : resolvePath(parentDirectory ?? parent.workspaceRoot, request.cwd)
  const cwd = await canonicalDirectory(requested)

  // The native fence for a delegated child is this whole workspace root: the
  // child session inherits the delegating session's header cwd, and the policy
  // service derives `workspace-write` from exactly that root. A writer whose
  // working directory left it could not write where it works, and its exclusive
  // scope is the root itself; a read child may still be pointed anywhere.
  const grantedRoot = request.access === 'write' ? await canonicalDirectory(parent.workspaceRoot) : undefined
  if (request.access === 'write' && grantedRoot !== undefined) {
    if (MODE_RANK[parent.mode] < MODE_RANK['workspace-write']) {
      throw new NexusError(
        'INVALID_ARGUMENT',
        `cannot start a writing child: this session runs read-only, and delegation never widens its own access`,
      )
    }
    if (!scopeContains(grantedRoot, cwd)) {
      throw new NexusError(
        'INVALID_ARGUMENT',
        `cannot start a writing child in "${cwd}": it is outside the workspace root its writes would be limited to (${grantedRoot})`,
      )
    }
  }

  const lease =
    grantedRoot === undefined ? undefined : await coordinator.acquire(owner.agent, request.childId, grantedRoot)
  const policy: ChildPolicy = Object.freeze({
    childId: request.childId,
    parentSessionId: owner.sessionId,
    cwd,
    access: request.access,
    maxDepth: request.maxDepth,
  })
  try {
    await store.putChildPolicy(policy)
  } catch (error) {
    lease?.release()
    throw error
  }

  return {
    policy,
    lease,
    async releaseUnstarted() {
      await store.deleteChildPolicy(policy.childId)
      lease?.release()
    },
  }
}

/**
 * Register the child-policy enforcement hooks.
 *
 * `agent/created` runs (serially, awaited by the loop) before the child's first
 * request, after the native delegation policy seed, so the narrower mode wins.
 * `agent/pre-step` covers every later step of a resident child, which is woken
 * without a second creation edge. A write child must own its ACTUAL granted
 * workspace root again on resume — re-derived from the native policy for the
 * resumed session, never from the smaller requested directory — because a
 * resume must not restore a narrower lease than the fence it runs under.
 * @param ctx - registration scope.
 * @param store - durable store holding child policies.
 * @param coordinator - shared write coordinator.
 * @returns an idempotent disposer that removes both hooks.
 */
export function registerChildPolicy(ctx: Context, store: NexusStore, coordinator: WriteCoordinator): () => void {
  const onCreated = ctx.on('agent/created', async ({ agent }) => {
    const policy = await policyOf(store, agent)
    if (policy === undefined) return
    narrowToPolicy(ctx, policy, agent)
    if (policy.access !== 'write') return
    const service = requirePolicy(ctx, `child "${policy.childId}"`)
    const root = await grantedWorkspaceRoot(service, agent.session)
    if (!scopeContains(root, policy.cwd)) {
      throw new NexusError(
        'UNSUPPORTED_CAPABILITY',
        `child "${agent.id}" was admitted in "${policy.cwd}", which is outside the workspace its session can now write (${root}); refusing to resume an unenforceable write scope`,
      )
    }
    const parent = ctx.get('agents')?.get(SessionId(policy.parentSessionId))
    await coordinator.acquire(parent ?? agent, agent.id, root)
  })
  const onStep = ctx.on('agent/pre-step', async ({ agent }, next) => {
    const policy = await policyOf(store, agent)
    if (policy !== undefined) narrowToPolicy(ctx, policy, agent)
    return next()
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    onCreated()
    onStep()
  }
}
