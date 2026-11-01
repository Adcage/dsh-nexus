/**
 * The guarded multi-edit tool and its pure planner.
 *
 * Every edit in one call is matched against the *same* original text, and the
 * whole plan is validated before anything is published: a missing literal, an
 * ambiguous literal, two overlapping ranges or an unsupported encoding refuses
 * the entire call with the original bytes untouched. Replacements are applied
 * from the end of the file so earlier positions keep their original offsets,
 * and the result is written once through the backend's version guard — never as
 * a sequence of partial edits.
 *
 * Untouched bytes stay untouched. Matching runs on an LF-normalized view with a
 * map back to raw positions; a replacement inherits the line-ending style of
 * the region it replaces (or the file's dominant style when that region has no
 * newline). A UTF-8 BOM is carried through byte for byte.
 *
 * @module dsh-nexus/fs/edit
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { FILE_EDIT_MAX_INPUT_BYTES } from '../runtime/defaults.ts'
import { NexusError } from '../runtime/errors.ts'
import { requireOwner } from '../runtime/owner.ts'
import {
  decodeEditableText,
  detectLineEndingStyle,
  EDIT_MAX_ITEMS,
  normalizeLineEndings,
  restoreLineEndings,
  type LineEndingStyle,
  type TextEdit,
} from './text.ts'
import { recordObservation, requestEditGuard, resolveTarget } from './policy.ts'

/** One raw match range in the decoded original (UTF-16 code-unit offsets). */
export interface PlannedEditMatch {
  /** Index of the edit that produced this range. */
  readonly editIndex: number
  /** Inclusive start offset in the decoded original. */
  readonly start: number
  /** Exclusive end offset in the decoded original. */
  readonly end: number
}

/** The complete result of planning every edit against one original. */
export interface PlannedEdit {
  /** Final text, with the original BOM character re-attached when one was present. */
  readonly text: string
  /** Match ranges in the decoded original, ascending by start. */
  readonly matches: readonly PlannedEditMatch[]
}

/** Raw arguments accepted by the edit call. */
interface RawEditArgs {
  readonly path: string
  readonly edits: readonly TextEdit[]
}

/** Validated edit input. */
interface EditInput {
  readonly path: string
  readonly edits: readonly TextEdit[]
}

/** The structured outcome of one successful edit call. */
export interface EditValue {
  /** Canonical path in the filesystem's execution world. */
  readonly path: string
  /** Number of literal replacements applied. */
  readonly applied: number
}

/**
 * Validate the schema-expressible part of an edit call before any side effect.
 * @param args - schema-validated raw arguments.
 * @returns the validated input.
 * @throws NexusError `INVALID_ARGUMENT` for a blank path, an empty/oversized edit list or a blank search text.
 */
function parseEditArgs(args: RawEditArgs): EditInput {
  if (args.path.trim().length === 0) throw new NexusError('INVALID_ARGUMENT', 'path must be a non-empty string')
  if (!Array.isArray(args.edits) || args.edits.length === 0) {
    throw new NexusError('INVALID_ARGUMENT', 'edits must contain between 1 and 64 literal replacements')
  }
  if (args.edits.length > EDIT_MAX_ITEMS) {
    throw new NexusError('INVALID_ARGUMENT', `edits must contain between 1 and ${EDIT_MAX_ITEMS} literal replacements`)
  }
  for (const [index, edit] of args.edits.entries()) {
    if (typeof edit.oldText !== 'string' || edit.oldText.length === 0) {
      throw new NexusError('INVALID_ARGUMENT', `edits[${index}].oldText must be a non-empty string`)
    }
    if (typeof edit.newText !== 'string') {
      throw new NexusError('INVALID_ARGUMENT', `edits[${index}].newText must be a string`)
    }
    if (edit.oldText === edit.newText) {
      throw new NexusError('INVALID_ARGUMENT', `edits[${index}] replaces text with itself`)
    }
  }
  return { path: args.path, edits: args.edits }
}

/**
 * Build a normalized-index to raw-index map for a text that contains CRLF pairs.
 * @param text - decoded original text.
 * @returns the map, where index `normalized.length` points at `text.length`.
 */
function buildRawIndexMap(text: string): Int32Array {
  const map = new Int32Array(normalizeLineEndings(text).length + 1)
  let raw = 0
  let normalized = 0
  while (raw < text.length) {
    map[normalized] = raw
    if (text.charCodeAt(raw) === 13 && text.charCodeAt(raw + 1) === 10) raw += 2
    else raw += 1
    normalized += 1
  }
  map[normalized] = text.length
  return map
}

/**
 * Plan every literal replacement against one original.
 *
 * Matching is performed once, on the LF-normalized original; the ranges are
 * then mapped back to raw positions. Validation is all-or-nothing: a single
 * ambiguous, missing or overlapping edit throws before any text is produced.
 * @param original - complete raw file bytes.
 * @param edits - literal replacements in call order.
 * @returns the final text and the raw match ranges.
 * @throws NexusError `INVALID_ARGUMENT` for an empty or oversized edit list or a blank search text.
 * @throws NexusError `UNSUPPORTED_ENCODING` when the file cannot be edited without conversion.
 * @throws FsError `FS_EDIT_NOT_FOUND` when an edit's literal does not occur in the original.
 * @throws NexusError `AMBIGUOUS_EDIT` when an edit's literal occurs more than once.
 * @throws NexusError `OVERLAPPING_EDITS` when two matched ranges intersect.
 */
export function planEdits(original: Uint8Array, edits: readonly TextEdit[]): PlannedEdit {
  if (edits.length === 0 || edits.length > EDIT_MAX_ITEMS) {
    throw new NexusError('INVALID_ARGUMENT', `edits must contain between 1 and ${EDIT_MAX_ITEMS} literal replacements`)
  }
  for (const [index, edit] of edits.entries()) {
    if (typeof edit.oldText !== 'string' || edit.oldText.length === 0) {
      throw new NexusError('INVALID_ARGUMENT', `edits[${index}].oldText must be a non-empty string`)
    }
    if (typeof edit.newText !== 'string') {
      throw new NexusError('INVALID_ARGUMENT', `edits[${index}].newText must be a string`)
    }
  }

  const decoded = decodeEditableText(original)
  const normalized = normalizeLineEndings(decoded.text)
  const map = normalized.length === decoded.text.length ? undefined : buildRawIndexMap(decoded.text)
  const defaultStyle = detectLineEndingStyle(decoded.text)
  const matches: PlannedEditMatch[] = []

  for (const [editIndex, edit] of edits.entries()) {
    const needle = normalizeLineEndings(edit.oldText)
    if (needle.length === 0) throw new NexusError('INVALID_ARGUMENT', `edits[${editIndex}].oldText must be non-empty`)
    const found: number[] = []
    let from = 0
    let index = normalized.indexOf(needle, from)
    while (index !== -1) {
      found.push(index)
      from = index + needle.length
      index = normalized.indexOf(needle, from)
    }
    if (found.length === 0) {
      throw new FsError(`edits[${editIndex}].oldText was not found in the file`, 'FS_EDIT_NOT_FOUND')
    }
    if (found.length > 1) {
      throw new NexusError(
        'AMBIGUOUS_EDIT',
        `edits[${editIndex}].oldText matched ${found.length} times; provide a longer literal that occurs exactly once`,
      )
    }
    const start = found[0] ?? 0
    matches.push({
      editIndex,
      start: map === undefined ? start : (map[start] ?? start),
      end: map === undefined ? start + needle.length : (map[start + needle.length] ?? start + needle.length),
    })
  }

  const ascending = [...matches].sort((left, right) => left.start - right.start)
  for (let index = 1; index < ascending.length; index += 1) {
    const previous = ascending[index - 1]
    const current = ascending[index]
    if (previous !== undefined && current !== undefined && current.start < previous.end) {
      throw new NexusError(
        'OVERLAPPING_EDITS',
        `edits[${previous.editIndex}] and edits[${current.editIndex}] match overlapping text; split them into non-overlapping literals`,
      )
    }
  }

  let text = decoded.text
  for (const match of [...matches].sort((left, right) => right.start - left.start)) {
    const edit = edits[match.editIndex]
    if (edit === undefined) continue
    const replaced = decoded.text.slice(match.start, match.end)
    const style: LineEndingStyle = replaced.includes('\r\n')
      ? 'crlf'
      : replaced.includes('\n')
        ? 'lf'
        : defaultStyle
    const replacement = restoreLineEndings(edit.newText, style)
    text = `${text.slice(0, match.start)}${replacement}${text.slice(match.end)}`
  }

  return { text: `${decoded.bom ? '\uFEFF' : ''}${text}`, matches: ascending }
}

/**
 * Format an edit success as the model-facing sentence.
 * @param displayPath - backend-resolved path.
 * @param applied - number of replacements.
 * @returns the confirmation sentence.
 */
function formatEditOutput(displayPath: string, applied: number): string {
  return `The file ${displayPath} has been updated successfully (${applied} edit${applied === 1 ? '' : 's'}).`
}

/**
 * Register the `edit` tool in this scope.
 * @param ctx - registration scope.
 * @returns the tool definition.
 */
export function createEditTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'edit',
    description:
      'Edit an existing UTF-8 text file with 1-64 literal replacements, all planned against the same original and published atomically.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Path to edit, resolved against the session directory by the filesystem backend.',
      },
      edits: {
        type: 'array',
        required: true,
        description: 'Literal replacements; every oldText must occur exactly once and no two ranges may overlap.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            oldText: { type: 'string', required: true, description: 'Exact literal text to replace.' },
            newText: { type: 'string', required: true, description: 'Replacement text; empty deletes the match.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          applied: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as unknown as EditValue
        return [{ type: 'text', text: formatEditOutput(result.path, result.applied) }]
      },
      presentationMeta: (_args, value) => {
        const result = value as unknown as EditValue
        return { path: result.path, applied: result.applied }
      },
    },
    async execute(args, exec) {
      requireOwner(exec)
      const input = parseEditArgs(args)
      const target = await resolveTarget(ctx, exec, input.path)
      // This is the original observation's version. It is obtained *before*
      // the internal reread below, so the reread can never upgrade the guard
      // to a fresher version of a file someone else changed.
      const guard = await requestEditGuard(ctx, target, exec)
      const before = await ctx.fs.stat(target, exec.signal)
      if (before === undefined) {
        throw new NexusError('FILE_CHANGED', `cannot edit "${target.displayPath}": the file no longer exists`)
      }
      if (before.type !== 'file') {
        throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }
      if (before.version !== guard.version) {
        throw new NexusError(
          'FILE_CHANGED',
          `cannot edit "${target.displayPath}": the file changed since it was read; read it again before editing`,
        )
      }
      const original = await ctx.fs.readBytes(target, exec.signal, FILE_EDIT_MAX_INPUT_BYTES)
      const afterRead = await ctx.fs.stat(target, exec.signal)
      if (afterRead?.version !== guard.version) {
        throw new NexusError(
          'FILE_CHANGED',
          `cannot edit "${target.displayPath}": the file changed while it was being read; read it again before editing`,
        )
      }
      const plan = planEdits(original, input.edits)
      const outcome = await ctx.fs.writeText(
        target,
        plan.text,
        { kind: 'replaceIfVersion', version: guard.version },
        exec.signal,
      )
      recordObservation(ctx, target, { kind: 'present', version: outcome.version }, exec)
      return { path: ctx.fs.processPath(target), applied: input.edits.length } satisfies EditValue
    },
  })
}
