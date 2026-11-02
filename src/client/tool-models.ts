/**
 * Presentation facts for the Nexus `shell`, `web` and `agent` tool cards.
 *
 * Every field here comes from the payload the Runtime already recorded with the
 * call: the stored argument text, the recorded result `content` blocks and the
 * persisted result `meta` that each owning tool builds in its
 * `presentationMeta`. Nothing in this module opens a file, asks a session, a
 * child or a process for its current state, or upgrades an older record with
 * newer facts, so replaying a saved transcript shows what the call recorded and
 * nothing else.
 *
 * The payload crosses a plugin boundary, so every reader is total: a missing
 * field, a getter that throws, a foreign shape, an oversized string or an
 * unexpected type degrades to an absent fact or bounded text. No reader throws,
 * and no fact is filled in from an assumption. In particular this module has no
 * "success" state at all: the strongest claim a settled card can make is that a
 * result was recorded, because a recorded exit code, a background launch, a
 * stop acknowledgement and a timeout are different facts and none of them is
 * completion.
 *
 * @module dsh-nexus/client/tool-models
 */

import type en from '../locale/en.json'

/** Wire Tool names this plugin renders; every other name keeps its own view. */
export const NEXUS_TOOL_NAMES = ['shell', 'web', 'agent'] as const
/** One wire Tool name this plugin owns a card for. */
export type NexusToolName = (typeof NEXUS_TOOL_NAMES)[number]

/**
 * What a card can present. `pending` and `running` are the unfinished stages;
 * `recorded` says a result was recorded, never that it succeeded; the other
 * four name the recorded fact that stops a result from reading as completion.
 */
export type NexusToolStage = 'pending' | 'running' | 'recorded' | 'failed' | 'stopRequested' | 'timedOut' | 'empty'

/** Locale keys of the recorded facts a card can show. */
export type NexusToolFactLabel =
  | 'toolFactAction'
  | 'toolFactKind'
  | 'toolFactStatus'
  | 'toolFactResource'
  | 'toolFactResult'
  | 'toolFactSources'
  | 'toolFactSaved'
  | 'toolFactChild'
  | 'toolFactLabel'
  | 'toolFactActivity'
  | 'toolFactLive'
  | 'toolFactChildren'
  | 'toolFactEvents'

/** One recorded scalar of the result `meta`, already bounded for display. */
export interface NexusToolFact {
  /** Which fact this is; the card renders it as the row label. */
  readonly label: NexusToolFactLabel
  /** The recorded value as text. Wire tokens (`exited`, `stopping`, `search`) stay verbatim. */
  readonly value: string
}

/** The recorded failure identity of a failed call. */
export interface NexusToolFailure {
  /** Recorded error name, or an empty string when the record carried none. */
  readonly name: string
  /** Recorded error code, or an empty string when the record carried none. */
  readonly code: string
  /** Recorded reason text, bounded; absent when the record carried none. */
  readonly reason?: string
}

/** Everything one card renders, derived from the recorded payload alone. */
export interface NexusToolCardModel {
  /** The owned wire Tool name, or undefined for a name this plugin does not own. */
  readonly tool: NexusToolName | undefined
  /** The stage fact to present. */
  readonly stage: NexusToolStage
  /** Recorded argument summary (command, query, task), bounded; absent when unreadable. */
  readonly summary: string | undefined
  /** Recorded result facts, in the order the owning tool's `meta` names them. */
  readonly facts: readonly NexusToolFact[]
  /** Recorded failure identity; present exactly when the result recorded an error. */
  readonly failure: NexusToolFailure | undefined
  /** Recorded non-text content blocks (for example a durable image) the card does not render. */
  readonly otherBlocks: number
  /** Recorded result text, joined in order and bounded. */
  readonly output: string
  /** Whether `output` is a prefix of longer recorded text. */
  readonly outputTruncated: boolean
}

/** Characters of recorded result text a card shows before marking the preview cut. */
const OUTPUT_LIMIT = 4_000
/** Characters of one recorded scalar (fact value, argument summary) a card shows. */
const VALUE_LIMIT = 240
/** Characters of one recorded reason a card shows. */
const REASON_LIMIT = 400
/** Argument text larger than this is not parsed: an unusable summary, not a parse risk. */
const ARGUMENT_LIMIT = 262_144

/** Read one field of a foreign value without letting a hostile getter escape. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

/** Narrow to a plain non-array object, which is the only result shape either record uses. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return Array.isArray(value) ? undefined : value as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** A non-blank recorded string, verbatim. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** A recorded non-negative integer, which is the only count a tool writes. */
function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

/**
 * Bound text to a prefix without splitting a surrogate pair, so a cut emoji or
 * CJK character cannot become a replacement character.
 */
function clip(value: string, limit: number): string {
  if (value.length <= limit) return value
  const prefix = value.slice(0, limit)
  const last = prefix.charCodeAt(prefix.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? prefix.slice(0, -1) : prefix
}

/** Resolve a dispatched wire name to a card this plugin owns. */
export function asNexusToolName(value: unknown): NexusToolName | undefined {
  return NEXUS_TOOL_NAMES.find((name) => name === value)
}

/** Whether `value` owns `key`, without letting a hostile proxy trap escape. */
function hasOwn(value: unknown, key: string): boolean {
  if (typeof value !== 'object' || value === null) return false
  try {
    return Object.prototype.hasOwnProperty.call(value, key)
  } catch {
    return true
  }
}

/** Whether `value` declares `key` at all, without letting a hostile trap escape. */
function hasKey(value: unknown, key: string): boolean {
  if (typeof value !== 'object' || value === null) return false
  try {
    return key in value
  } catch {
    return true
  }
}

/**
 * The stage to read, from the owner's phase when it supplies one.
 *
 * The 0.2.1 owner passes `phase`; the profile's 0.1.0 owner passes the frozen
 * call block alone. In that block a settled result is the only variant that
 * declares a `kind` (the 0.2.1 owner derives its phase the same way), while a
 * running call is the one that carries its own `callId` and `name` and no result
 * `content`. A block matching neither keeps the conservative settled default, so
 * an unrecognised payload never presents the unfinished-stage copy. No live
 * state is consulted: the block is the recorded call or result itself.
 */
function stageOf(phase: unknown, block: unknown): 'preparing' | 'start' | 'result' {
  if (phase === 'preparing' || phase === 'start' || phase === 'result') return phase
  // An unrecognised phase is a payload this card cannot classify: stay settled.
  if (phase !== undefined) return 'result'
  if (hasKey(block, 'kind')) return 'result'
  const callId = field(block, 'callId')
  const name = field(block, 'name')
  const running = typeof callId === 'string' && callId.trim() !== ''
    && typeof name === 'string' && name.trim() !== ''
    && !hasOwn(block, 'content')
  return running ? 'start' : 'result'
}

/** Recorded result text, joined in order, bounded, with the non-text blocks counted. */
function recordedOutput(content: unknown): { text: string; truncated: boolean; otherBlocks: number } {
  const parts: string[] = []
  let length = 0
  let truncated = false
  let otherBlocks = 0
  let blocks: readonly unknown[]
  try {
    blocks = Array.isArray(content) ? content as readonly unknown[] : []
  } catch {
    blocks = []
  }
  try {
    for (const block of blocks) {
      if (field(block, 'type') !== 'text') {
        otherBlocks += 1
        continue
      }
      const text = textOf(field(block, 'text'))
      if (text === undefined) {
        otherBlocks += 1
        continue
      }
      const room = OUTPUT_LIMIT - length
      if (room <= 0) {
        truncated = true
        break
      }
      const piece = clip(text, room)
      if (piece.length < text.length) truncated = true
      parts.push(piece)
      length += piece.length
    }
  } catch {
    // A hostile block or an oversized array is not a reason to fail the card.
  }
  return { text: parts.join('\n'), truncated, otherBlocks }
}

/** The recorded argument fields that name what one call was about, in priority order. */
const SUMMARY_FIELDS: Readonly<Record<NexusToolName, readonly string[]>> = {
  shell: ['command', 'resourceId', 'name', 'cwd'],
  web: ['queries', 'urls', 'url', 'resultId', 'text'],
  agent: ['task', 'childId', 'label'],
}

/** The recorded action values that only request a stop, and are not an exit. */
const STOP_ACTIONS: Readonly<Record<NexusToolName, readonly string[]>> = {
  shell: ['stop', 'close'],
  web: [],
  agent: ['stop', 'interrupt'],
}

/** Recorded facts each owning tool's `presentationMeta` can supply. */
const FACT_FIELDS: Readonly<Record<NexusToolName, readonly (readonly [NexusToolFactLabel, string])[]>> = {
  shell: [['toolFactAction', 'action'], ['toolFactKind', 'family'], ['toolFactStatus', 'status'], ['toolFactResource', 'resourceId']],
  web: [['toolFactAction', 'action'], ['toolFactKind', 'kind'], ['toolFactResult', 'resultId'], ['toolFactSources', 'itemCount'], ['toolFactSaved', 'savedCount']],
  agent: [
    ['toolFactAction', 'action'],
    ['toolFactChild', 'childId'],
    ['toolFactLabel', 'label'],
    ['toolFactActivity', 'activity'],
    ['toolFactLive', 'live'],
    ['toolFactChildren', 'childCount'],
    ['toolFactEvents', 'eventCount'],
  ],
}

/** Recorded argument text for the stage, as plain JSON text or nothing. */
function recordedArguments(phase: string, block: unknown): Record<string, unknown> | undefined {
  const raw = phase === 'start' ? field(block, 'argsRaw') : phase === 'result' ? field(field(block, 'call'), 'argsRaw') : undefined
  if (typeof raw !== 'string' || raw === '' || raw.length > ARGUMENT_LIMIT) return undefined
  try {
    return recordOf(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/** One bounded argument summary naming what the call was about. */
function recordedSummary(tool: NexusToolName, phase: string, block: unknown): string | undefined {
  const args = recordedArguments(phase, block)
  if (args === undefined) return undefined
  for (const key of SUMMARY_FIELDS[tool]) {
    const value = field(args, key)
    const candidate = Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').join(', ')
      : textOf(value)
    if (candidate !== undefined && candidate !== '') return clip(candidate, VALUE_LIMIT)
  }
  return undefined
}

/** The recorded failure identity, present exactly when the result recorded an error. */
function recordedFailure(block: unknown): NexusToolFailure | undefined {
  if (field(block, 'isError') !== true) return undefined
  const error = recordOf(field(block, 'error'))
  const name = textOf(field(error, 'name'))
  const code = textOf(field(error, 'code'))
  const reason = textOf(field(error, 'reason'))
  return {
    name: name === undefined ? '' : clip(name, VALUE_LIMIT),
    code: code === undefined ? '' : clip(code, VALUE_LIMIT),
    ...(reason === undefined ? {} : { reason: clip(reason, REASON_LIMIT) }),
  }
}

/** Recorded scalar facts, bounded, in the owning tool's declared order. */
function recordedFacts(tool: NexusToolName, meta: unknown, stage: NexusToolStage): readonly NexusToolFact[] {
  const facts: NexusToolFact[] = []
  for (const [label, key] of FACT_FIELDS[tool]) {
    // A stop acknowledgement reports the request, not the status it interrupted.
    if (stage === 'stopRequested' && label === 'toolFactStatus') continue
    const value = field(meta, key)
    const text = typeof value === 'string'
      ? textOf(value)
      : typeof value === 'boolean' || countOf(value) !== undefined ? String(value) : undefined
    if (text === undefined) continue
    facts.push({ label, value: clip(text, VALUE_LIMIT) })
  }
  return facts
}

/**
 * The stage fact of one call, from its recorded stage and result payload.
 * @param stopActions - the recorded actions that only request a stop for this tool.
 */
function recordedStage(phase: string, block: unknown, output: string, stopActions: readonly string[]): NexusToolStage {
  if (phase === 'preparing') return 'pending'
  if (phase !== 'result') return 'running'
  if (field(block, 'isError') === true) return 'failed'
  const action = textOf(field(field(block, 'meta'), 'action'))
  if (action !== undefined && stopActions.includes(action)) return 'stopRequested'
  if (field(field(block, 'meta'), 'timedOut') === true) return 'timedOut'
  return output === '' ? 'empty' : 'recorded'
}

/**
 * Derive one card from the payload the dispatch recorded with the call.
 * @param input - the dispatched wire name, the owner's stage when it supplies
 *   one (`undefined` in the 0.1.0 owner build) and the recorded block.
 * @returns the card model; every field is derived from `input` alone.
 */
export function readNexusToolCard(input: {
  readonly tool: unknown
  readonly phase: unknown
  readonly block: unknown
}): NexusToolCardModel {
  const tool = asNexusToolName(input.tool)
  const phase = stageOf(input.phase, input.block)
  const output = phase === 'result'
    ? recordedOutput(field(input.block, 'content'))
    : { text: '', truncated: false, otherBlocks: 0 }
  const stage = recordedStage(phase, input.block, output.text, tool === undefined ? [] : STOP_ACTIONS[tool])
  return {
    tool,
    stage,
    summary: tool === undefined ? undefined : recordedSummary(tool, phase, input.block),
    facts: tool === undefined ? [] : recordedFacts(tool, field(input.block, 'meta'), stage),
    failure: phase === 'result' ? recordedFailure(input.block) : undefined,
    otherBlocks: output.otherBlocks,
    output: output.text,
    outputTruncated: output.truncated,
  }
}

/** Locale key of one card title. */
export const NEXUS_TOOL_TITLE: Readonly<Record<NexusToolName, keyof typeof en>> = {
  shell: 'toolTitleShell',
  web: 'toolTitleWeb',
  agent: 'toolTitleAgent',
}

/** Locale key of one stage label. */
export const NEXUS_TOOL_STAGE: Readonly<Record<NexusToolStage, keyof typeof en>> = {
  pending: 'toolStagePending',
  running: 'toolStageRunning',
  recorded: 'toolStageRecorded',
  failed: 'toolStageFailed',
  stopRequested: 'toolStageStopRequested',
  timedOut: 'toolStageTimedOut',
  empty: 'toolStageEmpty',
}
