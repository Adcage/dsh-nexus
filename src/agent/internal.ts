/**
 * Internal child delegation over the native subagent service (AG-03, AG-04,
 * AG-05, AG-10).
 *
 * Only the shipped in-process providers are used, resolved by the public
 * `ctx.subagents` registry: `spawn` for an independent child and `fork` for a
 * child seeded with the parent's completed turns. Their names and capabilities
 * are verified against the installed providers; an external backend is never
 * selected as a fallback, and a missing provider fails with an explicit
 * capability error instead of a silent route change.
 *
 * Every action re-checks that the caller is the exact live Agent of the
 * delegating session and that the named child was admitted by that same
 * session, so a stale Agent instance or another session's child id cannot be
 * controlled. The child id is reserved and its policy persisted before the
 * native activation, so a failure cleans up exactly its own reservation.
 *
 * Lifecycle truth comes from native facts: `interrupt` only acknowledges the
 * cancellation request, `stop` awaits the targeted native drain and reports the
 * confirmed release, and `read`/`status` are built from the child's durable log
 * (`turn/end` reasons) rather than from an inferred idle state.
 *
 * @module dsh-nexus/agent/internal
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import { delegationDepthOf, SubagentError, type SubagentActivation } from '@deepseek-ai/dsh-subagent'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import {
  AGENT_BATCH_MAX_TASKS,
  AGENT_DEFAULT_DEPTH,
  AGENT_MAX_CONCURRENCY,
  AGENT_MAX_DEPTH,
  AGENT_MIN_CONCURRENCY,
  AGENT_MIN_DEPTH,
  AGENT_READ_DEFAULT_EVENTS,
  AGENT_READ_MAX_BYTES,
  AGENT_READ_MAX_EVENTS,
  WAIT_DEFAULT_MS,
  WAIT_MAX_MS,
} from '../runtime/defaults.ts'
import { NexusError } from '../runtime/errors.ts'
import type { CallOwner } from '../runtime/owner.ts'
import type { ChildPolicy, RuntimeSettings } from '../protocol.ts'
import type { NexusStore } from '../storage/store.ts'
import { admitChildPolicy, type ChildAccess } from './policy.ts'
import type { WriteCoordinator } from './coordination.ts'
import { takeUtf8Prefix } from '../shell/output.ts'

/** How a child is created. */
export type ChildContext = 'spawn' | 'fork'

/** Every action the tool accepts, in contract order. */
export type AgentAction =
  | 'start'
  | 'list'
  | 'status'
  | 'read'
  | 'wait'
  | 'message'
  | 'interrupt'
  | 'stop'
  | 'continue'
  | 'batch'

/** Batch execution mode. */
export type BatchMode = 'parallel' | 'sequence'

/** One child start request, as the model supplied it. */
export interface ChildStartInput {
  /** The task, delivered as the child's user content. */
  readonly task: string
  /** Display label; defaults to the role name or the child id. */
  readonly label?: string
  /** Independent or inherited conversation context. */
  readonly context?: ChildContext
  /** Role name used for display and configured guidance, never a capability ceiling. */
  readonly role?: string
  /** Model id for the child; the provider route stays the parent's. */
  readonly model?: string
  /** Directory: absolute, or relative to the caller's current directory. */
  readonly cwd?: string
  /** Filesystem access; defaults to read. */
  readonly access?: ChildAccess
}

/** One started child as the tool reports it. */
export interface StartedChild {
  readonly childId: string
  readonly label: string
  readonly context: ChildContext
  readonly access: ChildAccess
  readonly cwd: string
  /**
   * Settles when this exact activation's run ends. It never identifies a later
   * resume of the same child, and it is not proof that the child is released.
   * The native service detaches a local child's accepted lifetime from the
   * caller's start signal, so this promise is NOT signal-aware either.
   */
  readonly settled: Promise<void>
}

/** One durable terminal turn of a child. */
export interface ChildTurn {
  /** Zero-based turn number from the log. */
  readonly turn: number
  /** Why it ended, straight from the durable `turn/end` event. */
  readonly reason: string
  /** Log sequence of that event. */
  readonly seq: number
}

/** One direct child in the caller's catalog. */
export interface ChildSummary {
  readonly childId: string
  /** Catalog mode recorded natively at creation. */
  readonly mode: string
  /** Label the catalog carries. */
  readonly label?: string
  /** Filesystem access Nexus admitted, when the child is Nexus-owned. */
  readonly access?: ChildAccess
  /** Canonical directory the child was admitted in. */
  readonly cwd?: string
  /** Whether the native Agent is live right now. */
  readonly live: boolean
  /** Native lifecycle state of the live Agent, or `absent`. */
  readonly activity: 'running' | 'idle' | 'absent'
  /** Last durable turn end, when the log has one. */
  readonly lastTurn?: ChildTurn
}

/** One child's detailed state. */
export interface ChildStatusView extends ChildSummary {
  readonly childId: string
}

/** One bounded page of a child's events. */
export interface ChildReadView {
  readonly childId: string
  /** Zero-based position of the first returned event. */
  readonly offset: number
  /** Zero-based position the next read continues from. */
  readonly nextOffset: number
  /** No event remains after this page. */
  readonly atEnd: boolean
  /** Total events in the child's log. */
  readonly totalEvents: number
  /** The page, in log order. */
  readonly events: readonly {
    /** Zero-based position in the log. */
    readonly index: number
    /** Native event sequence. */
    readonly seq: number
    /** Native event type. */
    readonly type: string
    /** Semantic text the native extractor produced, possibly cut to fit the page. */
    readonly text: string
  }[]
  /** One event's own text was cut to respect the page byte budget. */
  readonly textTruncated: boolean
}

/** One bounded wait. */
export interface ChildWaitView extends ChildStatusView {
  /** The bounded wait elapsed while the child was still active. */
  readonly timedOut: boolean
}

/** The child runtime one tool instance drives. */
export interface ChildRuntime {
  start(owner: CallOwner, input: ChildStartInput): Promise<StartedChild>
  list(owner: CallOwner): Promise<ChildSummary[]>
  status(owner: CallOwner, childId: SessionId): Promise<ChildStatusView>
  read(owner: CallOwner, childId: SessionId, offset?: number, limit?: number): Promise<ChildReadView>
  wait(owner: CallOwner, childId: SessionId, timeoutMs?: number): Promise<ChildWaitView>
  message(owner: CallOwner, childId: SessionId, text: string): Promise<{ readonly messageId: string }>
  interrupt(owner: CallOwner, childId: SessionId): Promise<{ readonly accepted: true }>
  stop(owner: CallOwner, childId: SessionId): Promise<{ readonly released: boolean; readonly scopeRetained?: string }>
}

/** Dependencies one runtime needs. */
export interface ChildRuntimeOptions {
  readonly store: NexusStore
  readonly coordinator: WriteCoordinator
  readonly settings: () => RuntimeSettings
}

/**
 * Clamp one settings number into its documented bounds.
 * @param value - configured value.
 * @param min - smallest accepted value.
 * @param max - largest accepted value.
 * @param fallback - value used when the configured one is not a finite number.
 * @returns the bounded value.
 */
function clampSetting(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * Resolve the installed in-process provider for one child context.
 * @param ctx - context carrying the subagent registry.
 * @param context - independent (`spawn`) or inherited (`fork`) context.
 * @returns the registered provider name to start with.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when the provider is missing or is not the shipped one.
 */
export function resolveChildProvider(ctx: Context, context: ChildContext): string {
  const provider = ctx.subagents.getProvider(context)
  if (provider === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot start a "${context}" child: the in-process "${context}" provider is not registered; mount @deepseek-ai/dsh-subagent-${context}-in-process for this scope (an external backend is never substituted)`,
    )
  }
  const inherits = context === 'fork'
  if (provider.inheritsParentContext !== inherits) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot use provider "${context}": it declares inheritsParentContext=${provider.inheritsParentContext}, but a "${context}" child is ${inherits ? 'seeded with the parent conversation' : 'independent'}`,
    )
  }
  if (provider.prepareContinuable === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot use provider "${context}": it is not continuable, so the child could not be listed, read, messaged or continued`,
    )
  }
  if (!provider.capabilities.depthLimit || !provider.capabilities.agentOptions) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot use provider "${context}": it does not enforce the delegation depth cap and child model options`,
    )
  }
  return provider.name
}

/**
 * Map a native subagent rejection onto the Nexus vocabulary where the model
 * needs a routable code. Unrecognized native failures keep their own identity.
 * @param error - the rejection.
 * @param action - action name used in the message.
 * @returns the error to throw.
 */
function translateNative(error: unknown, action: string): unknown {
  if (!(error instanceof SubagentError)) return error
  const message = error.message
  switch (error.code) {
    case 'UNAUTHORIZED':
    case 'DUPLICATE_CHILD':
      return new NexusError('RESOURCE_NOT_AVAILABLE', message, { cause: error })
    case 'CONTINUATION_UNAVAILABLE':
    case 'PERSISTENCE_UNAVAILABLE':
    case 'NOT_RESUMABLE':
    case 'UNSUPPORTED_CAPABILITY':
      return new NexusError(
        'UNSUPPORTED_CAPABILITY',
        `${action} is unavailable for this child: ${message}`,
        { cause: error },
      )
    default:
      return error
  }
}

/**
 * Read the durable policy of a child the caller owns.
 * @param store - durable store.
 * @param owner - exact caller.
 * @param childId - durable child id.
 * @returns the child's policy.
 * @throws NexusError `RESOURCE_NOT_AVAILABLE` when this caller never admitted the child.
 */
async function ownedPolicy(store: NexusStore, owner: CallOwner, childId: SessionId): Promise<ChildPolicy> {
  const policy = await store.getChildPolicy(childId)
  if (policy === undefined || policy.parentSessionId !== owner.sessionId) {
    throw new NexusError(
      'RESOURCE_NOT_AVAILABLE',
      `child "${childId}" was not started by this session; only the delegating session may read or control it`,
    )
  }
  return policy
}

/**
 * Read one child's raw events, live when possible and durable otherwise.
 * @param ctx - context carrying the session store and query service.
 * @param childId - child session id.
 * @returns the child's events in log order.
 * @throws NexusError `RESOURCE_NOT_AVAILABLE` when the child's log cannot be read.
 */
async function childEvents(ctx: Context, childId: SessionId): Promise<readonly SessionEvent[]> {
  const live = ctx.get('sessions')?.get(childId)
  if (live !== undefined) return live.snapshotEvents()
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot read child "${childId}": it is not live and no session-query service is mounted to read its durable log`,
    )
  }
  try {
    return (await query.readSession(childId)).events
  } catch (error) {
    throw new NexusError('RESOURCE_NOT_AVAILABLE', `cannot read the log of child "${childId}"`, { cause: error })
  }
}

/**
 * Fold the last durable `turn/end` of one child log.
 * @param events - the child's events.
 * @returns the last closed turn, or undefined before the first one closed.
 */
function lastTurnOf(events: readonly SessionEvent[]): ChildTurn | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'turn/end') continue
    const data = event.data as { turn?: number; reason?: { kind?: string } } | undefined
    return {
      turn: data?.turn ?? 0,
      reason: data?.reason?.kind ?? 'unknown',
      seq: Number(event.seq),
    }
  }
  return undefined
}

/**
 * Build the runtime one tool instance uses.
 * @param ctx - context carrying the native services.
 * @param options - durable store, coordinator and settings reader.
 * @returns the child runtime.
 */
export function createChildRuntime(ctx: Context, options: ChildRuntimeOptions): ChildRuntime {
  const { store, coordinator, settings } = options
  let pendingStarts = 0

  /** Reject a caller that is not the exact live Agent of its session. */
  const assertLiveCaller = (owner: CallOwner): void => {
    const live = ctx.get('agents')?.get(owner.sessionId)
    if (live !== owner.agent) {
      throw new NexusError(
        'NO_AGENT',
        `this run is attributed to a stale agent for session "${owner.sessionId}"; only the exact live agent may act on its children`,
      )
    }
  }

  /** Count the caller's live direct children plus its pending reservations. */
  const assertStartCapacity = (owner: CallOwner): void => {
    const limit = clampSetting(
      settings().agents.concurrency,
      AGENT_MIN_CONCURRENCY,
      AGENT_MAX_CONCURRENCY,
      AGENT_MAX_CONCURRENCY,
    )
    const agents = ctx.get('agents')
    let live = 0
    if (agents !== undefined) {
      for (const agent of agents.list()) {
        if (agents.isOwnedBy(agent.id, owner.agent)) live += 1
      }
    }
    const inUse = live + pendingStarts
    if (inUse >= limit) {
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        `this session already has ${inUse} of ${limit} concurrent children (the configured limit); finish or stop one before starting another`,
      )
    }
  }

  /**
   * Resolve the absolute delegation-depth cap for a new child.
   *
   * The configured descendants-per-level value is clamped to its documented
   * bounds and then to the cap this session itself was admitted under, so a
   * settings change, a fork or a cold resume can never expand the subtree's
   * recursion budget.
   * @param owner - exact caller.
   * @returns the absolute cap passed to the native start and stored durably.
   * @throws NexusError `INVALID_ARGUMENT` when the caller may not delegate further.
   */
  const childDepthCap = async (owner: CallOwner): Promise<number> => {
    const depth = delegationDepthOf(owner.agent)
    const configured = clampSetting(
      settings().agents.maxDepth,
      AGENT_MIN_DEPTH,
      AGENT_MAX_DEPTH,
      AGENT_DEFAULT_DEPTH,
    )
    const requested = depth + configured
    const own = await store.getChildPolicy(owner.sessionId)
    const cap = own === undefined ? requested : Math.min(own.maxDepth, requested)
    if (cap <= depth) {
      throw new NexusError(
        'INVALID_ARGUMENT',
        `delegation depth limit reached: this session is at depth ${depth} and no descendant level is permitted (configured descendants per level: ${configured})`,
      )
    }
    return cap
  }

  /** Compose the child's user content: configured role guidance plus the task. */
  const childPrompt = (input: ChildStartInput): ContentBlock[] => {
    const role = settings().agents.role
    const guidance = role?.instructions?.trim()
    const text = guidance === undefined || guidance === '' ? input.task : `${guidance}\n\n${input.task}`
    return [{ type: 'text', text }]
  }

  /**
   * Admit and natively start one child.
   *
   * A rejected start KEEPS the reservation. The public SDK offers no positive
   * cleanup receipt for a start that was attempted: the runtime swallows a
   * failed rollback and the agent factory detaches the session and agent before
   * it throws collected teardown failures, so "no live Agent, no live Session"
   * can be true while a published child is still running. Deleting the durable
   * policy would drop the only narrowing/recovery authority for that id and
   * releasing the lease would let a second writer into a tree a possibly live
   * writer still mutates. The reservation is therefore retained, its scope is
   * PINNED so no absence or owner-replacement heuristic can reclaim it, and the
   * caller is told so explicitly with the child id and the actual scope. There is
   * no public unlock for that pinned scope: an explicit release by its holder or
   * a coordinator scope restart (a Task 9 lifetime concern) is the only end.
   * @param owner - exact caller.
   * @param childId - reserved child id.
   * @param provider - resolved in-process provider name.
   * @param label - display label.
   * @param input - start input.
   * @param maxDepth - absolute subtree depth cap.
   * @param model - child model id, when one was requested.
   * @returns the admitted policy facts and the exact activation.
   */
  const launchChild = async (
    owner: CallOwner,
    childId: SessionId,
    provider: string,
    label: string,
    input: ChildStartInput,
    maxDepth: number,
    model: string | undefined,
  ): Promise<{ readonly access: ChildAccess; readonly cwd: string; readonly activation: SubagentActivation }> => {
    const admitted = await admitChildPolicy(ctx, store, coordinator, owner, {
      childId,
      cwd: input.cwd ?? '.',
      access: input.access ?? 'read',
      maxDepth,
    })
    try {
      const activation = await ctx.subagents.startActivation({
        provider,
        label,
        childId,
        request: {
          prompt: childPrompt(input),
          parent: owner.agent,
          cwd: admitted.policy.cwd,
          maxDepth,
          ...(model === undefined ? {} : { agentOptions: { model } }),
        },
        signal: owner.signal,
        delivery: 'parent',
      })
      return { access: admitted.policy.access, cwd: admitted.policy.cwd, activation }
    } catch (error) {
      // No cleanup receipt: pin the scope so no absence or replacement heuristic
      // can reclaim it, and keep the durable narrowing authority. The error
      // carries the child id and the retained scope so the caller keeps control
      // of that identity.
      coordinator.pin(childId)
      throw new NexusError(
        'RESOURCE_NOT_AVAILABLE',
        `child "${childId}" did not start and its cleanup is unconfirmed, so its policy record and write scope (${admitted.lease?.cwd ?? admitted.policy.cwd}) are retained for that child id; it stays discoverable and stop-able, and a second writer on that workspace root is refused until the native runtime releases it`,
        { cause: error },
      )
    }
  }

  /** Read one child's live and durable state. */
  const describe = async (owner: CallOwner, childId: SessionId): Promise<ChildStatusView> => {
    const policy = await ownedPolicy(store, owner, childId)
    const live = ctx.get('agents')?.get(childId)
    const events = live === undefined ? await childEvents(ctx, childId) : live.session.snapshotEvents()
    const lastTurn = lastTurnOf(events)
    return {
      childId,
      mode: 'continuable',
      access: policy.access,
      cwd: policy.cwd,
      live: live !== undefined,
      activity: live === undefined ? 'absent' : live.status,
      ...(lastTurn === undefined ? {} : { lastTurn }),
    }
  }

  return {
    async start(owner, input) {
      assertLiveCaller(owner)
      const context = input.context ?? 'spawn'
      const provider = resolveChildProvider(ctx, context)
      const maxDepth = await childDepthCap(owner)
      assertStartCapacity(owner)

      const childId = brandSessionId(randomUUID())
      const model = input.model ?? settings().agents.role?.model
      const label = input.label ?? input.role ?? settings().agents.role?.name ?? 'subagent'
      // The reservation counts against the concurrency limit from this point
      // until the native runtime either published the child or failed.
      pendingStarts += 1
      let launched
      try {
        launched = await launchChild(owner, childId, provider, label, input, maxDepth, model)
      } finally {
        pendingStarts -= 1
      }
      return {
        childId,
        label,
        context,
        access: launched.access,
        cwd: launched.cwd,
        settled: launched.activation.result.then(
          () => undefined,
          () => undefined,
        ),
      }
    },

    async list(owner) {
      assertLiveCaller(owner)
      const agents = ctx.get('agents')
      let rows
      try {
        rows = await ctx.subagents.listChildren(owner.sessionId, owner.signal)
      } catch (error) {
        throw translateNative(error, 'listing children')
      }
      const result: ChildSummary[] = []
      for (const row of rows) {
        const policy = await store.getChildPolicy(row.id)
        const live = agents?.get(row.id)
        let lastTurn: ChildTurn | undefined
        if (live !== undefined) lastTurn = lastTurnOf(live.session.snapshotEvents())
        result.push({
          childId: row.id,
          mode: row.mode,
          ...(row.label === undefined ? {} : { label: row.label }),
          ...(policy === undefined || policy.parentSessionId !== owner.sessionId
            ? {}
            : { access: policy.access, cwd: policy.cwd }),
          live: live !== undefined,
          activity: live === undefined ? 'absent' : live.status,
          ...(lastTurn === undefined ? {} : { lastTurn }),
        })
      }
      return result
    },

    async status(owner, childId) {
      assertLiveCaller(owner)
      return describe(owner, childId)
    },

    async read(owner, childId, offset = 0, limit = AGENT_READ_DEFAULT_EVENTS) {
      assertLiveCaller(owner)
      await ownedPolicy(store, owner, childId)
      if (!Number.isInteger(offset) || offset < 0) {
        throw new NexusError('INVALID_ARGUMENT', `offset must be a non-negative integer, received ${offset}`)
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > AGENT_READ_MAX_EVENTS) {
        throw new NexusError(
          'INVALID_ARGUMENT',
          `limit must be 1..${AGENT_READ_MAX_EVENTS} events, received ${limit}`,
        )
      }
      const events = await childEvents(ctx, childId)
      if (offset > events.length) {
        throw new NexusError(
          'INVALID_ARGUMENT',
          `offset ${offset} is past the end of child "${childId}": it has ${events.length} events (positions 0..${Math.max(0, events.length - 1)})`,
        )
      }
      const page: ChildReadView['events'][number][] = []
      let bytes = 0
      let textTruncated = false
      let index = offset
      for (; index < events.length && page.length < limit; index += 1) {
        const event = events[index]
        if (event === undefined) break
        let text = extractSessionEventText(event)
        const size = Buffer.byteLength(text, 'utf8')
        if (bytes + size > AGENT_READ_MAX_BYTES) {
          if (page.length > 0) break
          // The single event is larger than one page: keep a bounded prefix on a
          // code-point boundary and say so instead of returning a silently
          // cropped event whose re-encoding could exceed the page budget.
          text = takeUtf8Prefix(text, AGENT_READ_MAX_BYTES)
          textTruncated = true
          bytes += Buffer.byteLength(text, 'utf8')
          page.push({ index, seq: Number(event.seq), type: event.type, text })
          index += 1
          break
        }
        bytes += size
        page.push({ index, seq: Number(event.seq), type: event.type, text })
      }
      return {
        childId,
        offset,
        nextOffset: index,
        atEnd: index >= events.length,
        totalEvents: events.length,
        events: page,
        textTruncated,
      }
    },

    async wait(owner, childId, timeoutMs = WAIT_DEFAULT_MS) {
      assertLiveCaller(owner)
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > WAIT_MAX_MS) {
        throw new NexusError('INVALID_ARGUMENT', `timeoutMs must be 0..${WAIT_MAX_MS}, received ${timeoutMs}`)
      }
      await ownedPolicy(store, owner, childId)
      const live = ctx.get('agents')?.get(childId)
      let timedOut = false
      if (live !== undefined && live.status === 'running') {
        const timeout = new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            timedOut = true
            resolve()
          }, timeoutMs)
          timer.unref?.()
        })
        await Promise.race([live.whenIdle(), timeout])
      }
      const status = await describe(owner, childId)
      return { ...status, timedOut }
    },

    async message(owner, childId, text) {
      assertLiveCaller(owner)
      await ownedPolicy(store, owner, childId)
      if (text.trim() === '') throw new NexusError('INVALID_ARGUMENT', 'a message needs non-empty text')
      try {
        const messageId: MessageId = await ctx.subagents.sendMessage(
          owner.agent,
          childId,
          [{ type: 'text', text }],
          { signal: owner.signal },
        )
        return { messageId }
      } catch (error) {
        throw translateNative(error, `messaging child "${childId}"`)
      }
    },

    async interrupt(owner, childId) {
      assertLiveCaller(owner)
      await ownedPolicy(store, owner, childId)
      try {
        ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: owner.agent })
      } catch (error) {
        throw translateNative(error, `interrupting child "${childId}"`)
      }
      // A request was issued; this is not proof that the child is quiescent.
      return { accepted: true }
    },

    async stop(owner, childId) {
      assertLiveCaller(owner)
      await ownedPolicy(store, owner, childId)
      try {
        // Targeted drain: this waits until the selected activation released its
        // execution handle and leaves the caller's other children untouched.
        await ctx.subagents.drainChildren(owner.agent, [childId])
      } catch (error) {
        throw translateNative(error, `stopping child "${childId}"`)
      }
      // The native drain is a no-op for an activation that is not resident, so
      // it is not proof that a retained reservation was cleaned up. Report the
      // scope still held by that child instead of claiming a release.
      const scope = coordinator.scopeOf(childId)
      return scope === undefined ? { released: true } : { released: false, scopeRetained: scope.root }
    },
  }
}

/** Guard that the batch size stays inside its contract. */
export function assertBatchSize(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > AGENT_BATCH_MAX_TASKS) {
    throw new NexusError('INVALID_ARGUMENT', `a batch needs 1..${AGENT_BATCH_MAX_TASKS} tasks, received ${count}`)
  }
}
