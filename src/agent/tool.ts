/**
 * The unified `agent` tool: internal delegation, inspection and control
 * (AG-01…AG-11).
 *
 * Ten actions with one closed field set each. Every action validates its input
 * and re-checks the caller before any effect. `start` resolves an installed
 * in-process provider, admits the child (canonical directory, access, depth
 * cap, write lease, durable policy) and only then publishes the native
 * activation with the exact caller as its parent. `interrupt` reports an
 * acknowledged request, never a stopped child; `stop` awaits the targeted
 * native release of the selected child and leaves siblings and the parent's
 * other trees alone. `continue` reuses the same durable child through the
 * native continuation service instead of cloning a new one.
 *
 * Result delivery stays native: children are started with `delivery: "parent"`,
 * so the runtime's own settlement notice reaches the model once. This tool adds
 * no second reporter.
 *
 * @module dsh-nexus/agent/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  type InferValue,
  type ToolDefinition,
  type ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { RuntimeSettings } from '../protocol.ts'
import {
  AGENT_BATCH_MAX_TASKS,
  AGENT_READ_DEFAULT_EVENTS,
  AGENT_READ_MAX_EVENTS,
  WAIT_DEFAULT_MS,
  WAIT_MAX_MS,
} from '../runtime/defaults.ts'
import { NexusError } from '../runtime/errors.ts'
import { requireOwner, type CallOwner } from '../runtime/owner.ts'
import type { NexusStore } from '../storage/store.ts'
import type { WriteCoordinator } from './coordination.ts'
import {
  assertBatchSize,
  createChildRuntime,
  resolveChildProvider,
  type AgentAction,
  type BatchMode,
  type ChildContext,
  type ChildRuntime,
  type ChildStartInput,
  type ChildSummary,
  type StartedChild,
} from './internal.ts'
import type { ChildAccess } from './policy.ts'

/** Actions in schema order. */
const AGENT_ACTIONS: readonly AgentAction[] = [
  'start',
  'list',
  'status',
  'read',
  'wait',
  'message',
  'interrupt',
  'stop',
  'continue',
  'batch',
]

/**
 * Fields each action accepts. The parameter schema is an open object root, so
 * this table is what keeps an action's input closed before any side effect.
 */
const ACTION_FIELDS: Readonly<Record<AgentAction, readonly string[]>> = Object.freeze({
  start: ['action', 'task', 'label', 'context', 'role', 'model', 'cwd', 'access'],
  list: ['action'],
  status: ['action', 'childId'],
  read: ['action', 'childId', 'offset', 'limit'],
  wait: ['action', 'childId', 'timeoutMs'],
  message: ['action', 'childId', 'text'],
  interrupt: ['action', 'childId'],
  stop: ['action', 'childId'],
  continue: ['action', 'childId', 'text'],
  batch: ['action', 'mode', 'tasks'],
})

/** The start fields a batch task may carry. */
const TASK_FIELDS: readonly string[] = Object.freeze(['task', 'label', 'context', 'role', 'model', 'cwd', 'access'])

/** One validated start input. */
interface StartArgs extends ChildStartInput {
  readonly action: 'start'
}

/** Control actions: the ones addressed by a child id. */
type ControlAction = 'status' | 'read' | 'wait' | 'message' | 'interrupt' | 'stop' | 'continue'

/** One validated control input. */
interface ControlArgs {
  readonly action: ControlAction
  readonly childId?: string
  readonly text?: string
  readonly offset?: number
  readonly limit?: number
  readonly timeoutMs?: number
}

/** One validated batch input. */
interface BatchArgs {
  readonly action: 'batch'
  readonly mode: BatchMode
  readonly tasks: readonly ChildStartInput[]
}

/** Any validated action input. */
type AgentInput = StartArgs | { readonly action: 'list' } | ControlArgs | BatchArgs

/** One batch item result; `index` keeps the input order. */
interface BatchItem {
  readonly index: number
  readonly ok: boolean
  readonly childId?: string
  readonly label?: string
  readonly mode?: string
  readonly context?: ChildContext
  readonly access?: ChildAccess
  readonly cwd?: string
  readonly code?: string
  readonly message?: string
}

/** Canonical tool value; only the fields of the executed action appear. */
interface AgentValue {
  readonly action: AgentAction
  readonly childId?: string
  readonly label?: string
  readonly mode?: string
  readonly context?: ChildContext
  readonly access?: ChildAccess
  readonly cwd?: string
  readonly children?: readonly ChildSummary[]
  readonly events?: readonly {
    readonly index: number
    readonly seq: number
    readonly type: string
    readonly text: string
  }[]
  readonly offset?: number
  readonly nextOffset?: number
  readonly atEnd?: boolean
  readonly totalEvents?: number
  readonly textTruncated?: boolean
  readonly live?: boolean
  readonly activity?: string
  readonly lastTurn?: { readonly turn: number; readonly reason: string; readonly seq: number }
  readonly timedOut?: boolean
  readonly messageId?: string
  readonly accepted?: boolean
  readonly released?: boolean
  readonly batchMode?: BatchMode
  readonly items?: readonly BatchItem[]
}

/** One nested property node. */
type PropertyNode = ValueSchemaSpec & { required?: true }

/** Close one object node while preserving its literal shape for inference. */
function objectNode<const P extends Record<string, PropertyNode>>(properties: P) {
  return { type: 'object' as const, additionalProperties: false as const, properties }
}

/** Mark one nested property as required. */
function required<const S extends ValueSchemaSpec>(spec: S): S & { required: true } {
  return { ...spec, required: true }
}

/** One durable turn end. */
const TURN_SCHEMA = objectNode({
  turn: required({ type: 'integer' }),
  reason: required({ type: 'string' }),
  seq: required({ type: 'integer' }),
})

/** One child row. */
const CHILD_SCHEMA = objectNode({
  childId: required({ type: 'string' }),
  mode: required({ type: 'string' }),
  label: { type: 'string' },
  access: { type: 'string', enum: ['read', 'write'] },
  cwd: { type: 'string' },
  live: required({ type: 'boolean' }),
  activity: required({ type: 'string', enum: ['running', 'idle', 'absent'] }),
  lastTurn: TURN_SCHEMA,
})

/** One event row. */
const EVENT_SCHEMA = objectNode({
  index: required({ type: 'integer' }),
  seq: required({ type: 'integer' }),
  type: required({ type: 'string' }),
  text: required({ type: 'string' }),
})

/** One batch item row. */
const ITEM_SCHEMA = objectNode({
  index: required({ type: 'integer' }),
  ok: required({ type: 'boolean' }),
  childId: { type: 'string' },
  label: { type: 'string' },
  mode: { type: 'string' },
  context: { type: 'string', enum: ['spawn', 'fork'] },
  access: { type: 'string', enum: ['read', 'write'] },
  cwd: { type: 'string' },
  code: { type: 'string' },
  message: { type: 'string' },
})

/** The output schema: one closed object; action builders add no other fields. */
const AGENT_OUTPUT_SCHEMA = objectNode({
  action: required({ type: 'string', enum: [...AGENT_ACTIONS] }),
  childId: { type: 'string' },
  label: { type: 'string' },
  mode: { type: 'string' },
  context: { type: 'string', enum: ['spawn', 'fork'] },
  access: { type: 'string', enum: ['read', 'write'] },
  cwd: { type: 'string' },
  children: { type: 'array', items: CHILD_SCHEMA },
  events: { type: 'array', items: EVENT_SCHEMA },
  offset: { type: 'integer' },
  nextOffset: { type: 'integer' },
  atEnd: { type: 'boolean' },
  totalEvents: { type: 'integer' },
  textTruncated: { type: 'boolean' },
  live: { type: 'boolean' },
  activity: { type: 'string', enum: ['running', 'idle', 'absent'] },
  lastTurn: TURN_SCHEMA,
  timedOut: { type: 'boolean' },
  messageId: { type: 'string' },
  accepted: { type: 'boolean' },
  released: { type: 'boolean' },
  batchMode: { type: 'string', enum: ['parallel', 'sequence'] },
  items: { type: 'array', items: ITEM_SCHEMA },
})

/** The canonical value type of {@link AGENT_OUTPUT_SCHEMA}. */
type CanonicalAgentValue = InferValue<typeof AGENT_OUTPUT_SCHEMA>

/**
 * Register the `agent` tool in this scope.
 *
 * `ctx.subagents`, `ctx.agents`, `ctx.sessions`, `ctx.tools` and `ctx.sandboxPolicy`
 * must be mounted in this scope, the caller supplies the opened store, and the
 * shared coordinator is created once by the top-level runtime — this factory
 * never creates a coordinator of its own.
 * @param ctx - registration scope providing the native services.
 * @param store - durable store that keeps child policies.
 * @param settings - current runtime settings, read once per call.
 * @param coordinator - the deployment's single write coordinator.
 * @returns the registry-ready tool definition.
 */
export function createAgentTool(
  ctx: Context,
  store: NexusStore,
  settings: () => RuntimeSettings,
  coordinator: WriteCoordinator,
): ToolDefinition {
  const runtime = createChildRuntime(ctx, { store, coordinator, settings })

  return defineTool({
    name: 'agent',
    description:
      'Delegate work to internal child agents and control them. Actions: start (run one child), list (this session\'s direct children), status (one child), read (a bounded page of a child\'s events by zero-based event position), wait (bounded wait), message (steer or continue a live child), interrupt (ask a child to stop; acknowledgement only), stop (stop one child and await the native release), continue (reuse the same child conversation), batch (up to ' +
      `${AGENT_BATCH_MAX_TASKS} starts, parallel or sequence). ` +
      'Children run through the native in-process subagent service: context "spawn" gives an independent child, "fork" seeds it with this conversation\'s completed turns. A child never receives wider filesystem access than this session: read children are read-only, and a write child is bounded by this session\'s granted workspace and holds an exclusive scope over that whole workspace root (not over its subdirectory), so this session can have one writer child at a time. Stopping and finishing are different: a stop is only confirmed by the native release this tool waits for.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: [...AGENT_ACTIONS],
        description: 'The agent operation; only the fields listed for that action are accepted.',
      },
      task: { type: 'string', description: 'start only: the complete task for the child.' },
      label: { type: 'string', description: 'start only: short display label for the child.' },
      context: {
        type: 'string',
        enum: ['spawn', 'fork'],
        description:
          'start only: "spawn" (default) starts with an independent context; "fork" inherits this conversation\'s completed turns as a snapshot, not a live link.',
      },
      role: {
        type: 'string',
        description:
          'start only: role name used for display and for the configured role guidance placed in the child\'s task content; a role is never a capability ceiling.',
      },
      model: { type: 'string', description: 'start only: model id for the child; the provider route stays this session\'s route.' },
      cwd: {
        type: 'string',
        description:
          'start only: the child\'s working directory, absolute or relative to this session. It must stay inside this session\'s granted workspace; a write child\'s exclusive scope is that whole workspace root, so two writers of one session cannot run in parallel even in different subdirectories.',
      },
      access: {
        type: 'string',
        enum: ['read', 'write'],
        description: 'start only: filesystem access; defaults to "read".',
      },
      childId: { type: 'string', description: 'status/read/wait/message/interrupt/stop/continue: the child id an earlier start returned.' },
      text: { type: 'string', description: 'message/continue only: the text to deliver to the child.' },
      offset: {
        type: 'integer',
        description: `read only: zero-based position of the first event; defaults to 0.`,
      },
      limit: {
        type: 'integer',
        description: `read only: 1..${AGENT_READ_MAX_EVENTS} events per page; defaults to ${AGENT_READ_DEFAULT_EVENTS}, and the page text is bounded.`,
      },
      timeoutMs: {
        type: 'integer',
        description: `wait only: bounded wait in milliseconds, 0..${WAIT_MAX_MS}; defaults to ${WAIT_DEFAULT_MS}. A timeout never stops the child.`,
      },
      mode: {
        type: 'string',
        enum: ['parallel', 'sequence'],
        description:
          'batch only: "parallel" (default) starts every accepted task at once within the concurrency limit; "sequence" waits for each child\'s own completion and confirmed release before starting the next, and never stops a running child on a timer. A cancelled sequence admits nothing further and leaves an already accepted child running and owned by this session.',
      },
      tasks: {
        type: 'array',
        items: objectNode({
          task: required({ type: 'string' }),
          label: { type: 'string' },
          context: { type: 'string', enum: ['spawn', 'fork'] },
          role: { type: 'string' },
          model: { type: 'string' },
          cwd: { type: 'string' },
          access: { type: 'string', enum: ['read', 'write'] },
        }),
        description: `batch only: 1..${AGENT_BATCH_MAX_TASKS} start inputs; results keep the input order.`,
      },
    },
    output: {
      schema: AGENT_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderAgentValue(value as unknown as AgentValue) }],
      presentationMeta: (_args, value) => presentationOf(value as unknown as AgentValue),
    },
    isConcurrencySafe: (args) =>
      args.action === 'list' || args.action === 'status' || args.action === 'read' || args.action === 'wait',
    async execute(args, exec) {
      const input = parseAgentInput(args, ctx)
      const owner = requireOwner(exec)
      const value = await runAction(runtime, owner, input)
      return value as unknown as CanonicalAgentValue
    },
  })
}

/** Dispatch one validated action. */
async function runAction(runtime: ChildRuntime, owner: CallOwner, input: AgentInput): Promise<AgentValue> {
  switch (input.action) {
    case 'start': {
      const started = await runtime.start(owner, input)
      return { action: 'start', ...startedView(started) }
    }
    case 'list':
      return { action: 'list', children: await runtime.list(owner) }
    case 'status':
      return { action: 'status', ...(await runtime.status(owner, SessionId(requireChildId(input.childId)))) }
    case 'read': {
      const page = await runtime.read(owner, SessionId(requireChildId(input.childId)), input.offset, input.limit)
      return { action: 'read', ...page }
    }
    case 'wait': {
      const result = await runtime.wait(owner, SessionId(requireChildId(input.childId)), input.timeoutMs)
      return { action: 'wait', ...result }
    }
    case 'message': {
      const childId = requireChildId(input.childId)
      const { messageId } = await runtime.message(owner, SessionId(childId), input.text ?? '')
      return { action: 'message', childId, messageId }
    }
    case 'continue': {
      const childId = requireChildId(input.childId)
      const { messageId } = await runtime.message(owner, SessionId(childId), input.text ?? '')
      return { action: 'continue', childId, messageId }
    }
    case 'interrupt': {
      const childId = requireChildId(input.childId)
      const { accepted } = await runtime.interrupt(owner, SessionId(childId))
      return { action: 'interrupt', childId, accepted }
    }
    case 'stop': {
      const childId = requireChildId(input.childId)
      const { released } = await runtime.stop(owner, SessionId(childId))
      return { action: 'stop', childId, released }
    }
    case 'batch':
      return runBatch(runtime, owner, input.mode, input.tasks, owner.signal)
  }
}

/** Require the child id a validated control action carries. */
function requireChildId(childId: string | undefined): string {
  if (childId === undefined) throw new NexusError('INVALID_ARGUMENT', 'this action needs a childId')
  return childId
}

/** Project one started child into the value shape. */
function startedView(started: StartedChild): Omit<AgentValue, 'action'> {
  return {
    childId: started.childId,
    label: started.label,
    context: started.context,
    access: started.access,
    cwd: started.cwd,
  }
}

/**
 * Start a batch, keeping the input order.
 *
 * `parallel` starts every item within the configured concurrency limit; an item
 * over the limit reports its own failure.
 *
 * `sequence` runs one item at a time and waits for that exact activation's own
 * settlement — never for a fixed wait slice and never for an idle boundary it
 * could stop at, because a child that has queued work is idle between turns
 * without having finished. That settlement promise is NOT tied to the caller's
 * start signal (the native service detaches a local child's accepted lifetime
 * after inbox acceptance), so the wait races it against the caller's abort: when
 * the caller cancels, this batch ends promptly, admits nothing further and
 * reports the remaining inputs as cancelled — it does NOT stop or release the
 * already accepted child, which stays a real native child that its parent can
 * list, read, message or stop. After settlement the selected child is drained; a
 * failed drain is reported on that item and NO following item starts, because a
 * possibly live writer must not be joined by another one.
 * @param runtime - child runtime.
 * @param owner - exact caller.
 * @param mode - parallel or sequence.
 * @param tasks - validated start inputs.
 * @param signal - caller cancellation.
 * @returns the batch value with one ordered item per input.
 */
async function runBatch(
  runtime: ChildRuntime,
  owner: CallOwner,
  mode: BatchMode,
  tasks: readonly ChildStartInput[],
  signal: AbortSignal,
): Promise<AgentValue> {
  assertBatchSize(tasks.length)
  const items: (BatchItem | undefined)[] = new Array<BatchItem | undefined>(tasks.length)

  const startOne = async (task: ChildStartInput, index: number): Promise<void> => {
    if (signal.aborted) {
      items[index] = cancelledItem(index)
      return
    }
    try {
      const started = await runtime.start(owner, task)
      items[index] = { index, ok: true, ...startedView(started) }
      void started.settled
    } catch (error) {
      items[index] = failureItem(error, index)
    }
  }

  if (mode === 'parallel') {
    await Promise.all(tasks.map((task, index) => startOne(task, index)))
    return { action: 'batch', batchMode: mode, items: items.map((item) => item as BatchItem) }
  }

  // One abort signal for the whole sequence; removed in the `finally` so a
  // finished batch leaves no listener behind on the caller's signal.
  const aborted = Promise.withResolvers<void>()
  const onAbort = (): void => {
    aborted.resolve()
  }
  if (signal.aborted) aborted.resolve()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    for (const [index, task] of tasks.entries()) {
      if (signal.aborted) {
        items[index] = cancelledItem(index)
        continue
      }
      let started
      try {
        started = await runtime.start(owner, task)
      } catch (error) {
        items[index] = failureItem(error, index)
        continue
      }
      items[index] = { index, ok: true, ...startedView(started) }
      // Wait for THIS run's own settlement or for the caller's abort.
      await Promise.race([started.settled, aborted.promise])
      if (signal.aborted) {
        // The accepted child is NOT stopped here: its settlement is detached
        // from the start signal, so its release is simply not observed by this
        // cancelled call. It stays owned, discoverable and leased.
        items[index] = {
          ...(items[index] as BatchItem),
          message:
            'accepted; the caller cancelled before this child was released, so its release was not observed here and it remains this session\'s child',
        }
        markCancelled(items, tasks.length, index + 1)
        break
      }
      // Confirm the native release of exactly this child before the next task.
      try {
        await runtime.stop(owner, SessionId(started.childId))
      } catch (error) {
        items[index] = { ...(items[index] as BatchItem), ...failureItem(error, index) }
        markNotStarted(items, tasks.length, index + 1, `batch item ${index} could not be released`)
        break
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  return { action: 'batch', batchMode: mode, items: items.map((item) => item as BatchItem) }
}

/** One input the caller cancelled before it started. */
function cancelledItem(index: number): BatchItem {
  return { index, ok: false, code: 'ABORTED', message: 'the caller cancelled before this task started' }
}

/**
 * Report every still-unstarted item after the caller cancelled mid-sequence.
 * @param items - item rows being built.
 * @param total - number of inputs.
 * @param from - first index that never started.
 */
function markCancelled(items: (BatchItem | undefined)[], total: number, from: number): void {
  for (let index = from; index < total; index += 1) {
    if (items[index] !== undefined) continue
    items[index] = cancelledItem(index)
  }
}

/**
 * Report every still-unstarted item after a sequence stopped early.
 * @param items - item rows being built.
 * @param total - number of inputs.
 * @param from - first index that never started.
 * @param reason - why the sequence stopped, in model-facing wording.
 */
function markNotStarted(items: (BatchItem | undefined)[], total: number, from: number, reason: string): void {
  for (let index = from; index < total; index += 1) {
    if (items[index] !== undefined) continue
    items[index] = {
      index,
      ok: false,
      code: 'RESOURCE_NOT_AVAILABLE',
      message: `not started because ${reason}; the selected child is still held, so retry after it is released`,
    }
  }
}

/** Project one failure into its item row. */
function failureItem(error: unknown, index: number): BatchItem {
  const info = (error as { code?: unknown }).code
  const message = error instanceof Error ? error.message : String(error)
  return {
    index,
    ok: false,
    ...(typeof info === 'string' ? { code: info } : {}),
    message,
  }
}

/**
 * Validate one action input, rejecting fields the action does not accept.
 * @param args - model-shaped arguments.
 * @param ctx - context used to check provider availability before a start.
 * @returns the validated input.
 * @throws NexusError `INVALID_ARGUMENT` for unknown or irrelevant fields and bad values.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when the requested child context has no installed provider.
 */
export function parseAgentInput(
  args: Readonly<Record<string, unknown>>,
  ctx: Context | undefined,
): AgentInput {
  const action = args.action
  if (typeof action !== 'string' || !AGENT_ACTIONS.includes(action as AgentAction)) {
    throw new NexusError(
      'INVALID_ARGUMENT',
      `action must be one of ${AGENT_ACTIONS.join(', ')}; received ${JSON.stringify(action)}`,
    )
  }
  const typed = action as AgentAction
  for (const key of Object.keys(args)) {
    if (!ACTION_FIELDS[typed].includes(key)) {
      throw new NexusError('INVALID_ARGUMENT', `action "${typed}" does not accept the field "${key}"`)
    }
  }
  switch (typed) {
    case 'start':
      return { action: 'start', ...parseStart(args, ctx) }
    case 'batch': {
      const mode = args.mode ?? 'parallel'
      if (mode !== 'parallel' && mode !== 'sequence') {
        throw new NexusError('INVALID_ARGUMENT', `mode must be "parallel" or "sequence"; received ${JSON.stringify(mode)}`)
      }
      if (!Array.isArray(args.tasks) || args.tasks.length === 0) {
        throw new NexusError('INVALID_ARGUMENT', 'batch needs a non-empty tasks array')
      }
      assertBatchSize(args.tasks.length)
      const tasks = args.tasks.map((task, index) => {
        if (task === null || typeof task !== 'object' || Array.isArray(task)) {
          throw new NexusError('INVALID_ARGUMENT', `tasks[${index}] must be an object`)
        }
        const record = task as Record<string, unknown>
        for (const key of Object.keys(record)) {
          if (!TASK_FIELDS.includes(key)) {
            throw new NexusError('INVALID_ARGUMENT', `tasks[${index}] does not accept the field "${key}"`)
          }
        }
        return parseStart(record, ctx)
      })
      return { action: 'batch', mode, tasks }
    }
    case 'list':
      return { action: 'list' }
    default:
      return parseControl(typed as ControlAction, args)
  }
}

/** Validate the shared start fields. */
function parseStart(args: Readonly<Record<string, unknown>>, ctx: Context | undefined): ChildStartInput {
  const task = args.task
  if (typeof task !== 'string' || task.trim() === '') {
    throw new NexusError('INVALID_ARGUMENT', 'task must be a non-empty string')
  }
  const context = args.context ?? 'spawn'
  if (context !== 'spawn' && context !== 'fork') {
    throw new NexusError('INVALID_ARGUMENT', `context must be "spawn" or "fork"; received ${JSON.stringify(context)}`)
  }
  const access = args.access ?? 'read'
  if (access !== 'read' && access !== 'write') {
    throw new NexusError('INVALID_ARGUMENT', `access must be "read" or "write"; received ${JSON.stringify(access)}`)
  }
  for (const field of ['label', 'role', 'model', 'cwd'] as const) {
    const value = args[field]
    if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
      throw new NexusError('INVALID_ARGUMENT', `${field} must be a non-empty string when supplied`)
    }
  }
  if (ctx !== undefined) resolveChildProvider(ctx, context)
  return {
    task,
    context,
    access,
    ...(args.label === undefined ? {} : { label: args.label as string }),
    ...(args.role === undefined ? {} : { role: args.role as string }),
    ...(args.model === undefined ? {} : { model: args.model as string }),
    ...(args.cwd === undefined ? {} : { cwd: args.cwd as string }),
  }
}

/** Validate one control action's fields. */
function parseControl(action: ControlAction, args: Readonly<Record<string, unknown>>): ControlArgs {
  const childId = args.childId
  if (typeof childId !== 'string' || childId.trim() === '') {
    throw new NexusError('INVALID_ARGUMENT', `action "${action}" needs the childId returned by a start action`)
  }
  if (action === 'message' || action === 'continue') {
    if (typeof args.text !== 'string' || args.text.trim() === '') {
      throw new NexusError('INVALID_ARGUMENT', `action "${action}" needs non-empty text`)
    }
  }
  if (action === 'read') {
    if (args.offset !== undefined && (!Number.isInteger(args.offset) || (args.offset as number) < 0)) {
      throw new NexusError('INVALID_ARGUMENT', 'offset must be a non-negative integer')
    }
    if (
      args.limit !== undefined &&
      (!Number.isInteger(args.limit) || (args.limit as number) < 1 || (args.limit as number) > AGENT_READ_MAX_EVENTS)
    ) {
      throw new NexusError('INVALID_ARGUMENT', `limit must be 1..${AGENT_READ_MAX_EVENTS}`)
    }
  }
  if (action === 'wait' && args.timeoutMs !== undefined) {
    const value = args.timeoutMs
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > WAIT_MAX_MS) {
      throw new NexusError('INVALID_ARGUMENT', `timeoutMs must be 0..${WAIT_MAX_MS}`)
    }
  }
  return {
    action,
    childId,
    ...(typeof args.text === 'string' ? { text: args.text } : {}),
    ...(typeof args.offset === 'number' ? { offset: args.offset } : {}),
    ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
    ...(typeof args.timeoutMs === 'number' ? { timeoutMs: args.timeoutMs } : {}),
  }
}

/** Render one value for the model. */
function renderAgentValue(value: AgentValue): string {
  switch (value.action) {
    case 'start':
      return `started ${value.context ?? 'spawn'} child ${value.childId} (${value.access ?? 'read'}, ${value.cwd ?? ''}) labeled "${value.label ?? ''}"; the runtime notifies this session when it finishes`
    case 'list': {
      const children = value.children ?? []
      if (children.length === 0) return 'this session has no child agents'
      const rows = children.map(
        (child) =>
          `${child.childId} — ${child.mode}${child.label === undefined ? '' : ` "${child.label}"`}${child.access === undefined ? '' : `, ${child.access}`}, ${child.live ? child.activity : 'not live'}${child.lastTurn === undefined ? '' : `, last turn ${child.lastTurn.turn} ended: ${child.lastTurn.reason}`}`,
      )
      return `${children.length} child agent(s):\n${rows.join('\n')}`
    }
    case 'status':
    case 'wait': {
      const head = `child ${value.childId}: ${value.live === true ? value.activity : 'not live'}${value.lastTurn === undefined ? '' : `, last turn ${value.lastTurn.turn} ended: ${value.lastTurn.reason}`}`
      if (value.action !== 'wait') return head
      return value.timedOut === true
        ? `${head}\nthe bounded wait elapsed; the child is still running and was not stopped`
        : `${head}\nthe wait returned after the child became idle`
    }
    case 'read': {
      const events = value.events ?? []
      if (events.length === 0) return `child ${value.childId}: no events at position ${value.offset} of ${value.totalEvents}`
      const body = events.map((event) => `#${event.index} ${event.type} (seq ${event.seq})\n${event.text}`).join('\n\n')
      const tail = value.atEnd === true ? 'end of the child log' : `continue at ${value.nextOffset}`
      const truncated = value.textTruncated === true ? '\n(one event was cut to fit the page)' : ''
      return `child ${value.childId} events ${value.offset}..${(value.nextOffset ?? 0) - 1} of ${value.totalEvents} (${tail})${truncated}\n\n${body}`
    }
    case 'message':
      return `message delivered to child ${value.childId} (${value.messageId}); this confirms delivery, not the answer`
    case 'continue':
      return `continued child ${value.childId} (${value.messageId}); it reuses the same child conversation`
    case 'interrupt':
      return `interrupt requested for child ${value.childId}; the signal was issued, which is not proof that it stopped`
    case 'stop':
      return `child ${value.childId} released by the native runtime`
    case 'batch': {
      const items = value.items ?? []
      const rows = items.map((item) =>
        item.ok
          ? `${item.index}: started ${item.childId} (${item.context ?? 'spawn'}, ${item.access ?? 'read'})`
          : `${item.index}: failed${item.code === undefined ? '' : ` [${item.code}]`} — ${item.message ?? ''}`,
      )
      return `batch (${value.batchMode ?? 'parallel'}) of ${items.length}:\n${rows.join('\n')}`
    }
  }
}

/** Durable presentation facts for the console renderer. */
function presentationOf(value: AgentValue): { readonly [key: string]: string | number | boolean } {
  const meta: Record<string, string | number | boolean> = { action: value.action }
  if (value.childId !== undefined) meta.childId = value.childId
  if (value.label !== undefined) meta.label = value.label
  if (value.context !== undefined) meta.context = value.context
  if (value.access !== undefined) meta.access = value.access
  if (value.cwd !== undefined) meta.cwd = value.cwd
  if (value.children !== undefined) {
    meta['childCount'] = value.children.length
    meta['liveChildCount'] = value.children.filter((child) => child.live).length
  }
  if (value.events !== undefined) {
    meta['eventCount'] = value.events.length
    if (value.offset !== undefined) meta['offset'] = value.offset
    if (value.nextOffset !== undefined) meta['nextOffset'] = value.nextOffset
    if (value.atEnd !== undefined) meta['atEnd'] = value.atEnd
    if (value.totalEvents !== undefined) meta['totalEvents'] = value.totalEvents
    if (value.textTruncated === true) meta['textTruncated'] = true
  }
  if (value.activity !== undefined) meta['activity'] = value.activity
  if (value.live !== undefined) meta['live'] = value.live
  if (value.lastTurn !== undefined) meta['lastTurnReason'] = value.lastTurn.reason
  if (value.timedOut !== undefined) meta['timedOut'] = value.timedOut
  if (value.messageId !== undefined) meta['messageId'] = value.messageId
  if (value.accepted !== undefined) meta['accepted'] = value.accepted
  if (value.released !== undefined) meta['released'] = value.released
  if (value.batchMode !== undefined) meta['batchMode'] = value.batchMode
  if (value.items !== undefined) {
    meta['itemCount'] = value.items.length
    meta['failureCount'] = value.items.filter((item) => !item.ok).length
  }
  return meta
}
