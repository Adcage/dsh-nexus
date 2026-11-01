/**
 * Bounded, resumable reads over one managed process's collected output.
 *
 * The subprocess seam exposes non-consuming, byte-offset readers per stream.
 * A shell caller reads one cursor, so this module combines the two readers
 * into one page while keeping their native offsets separate and exact: a page
 * stop never advances a stream past bytes it did not return. That is what lets
 * a 16 KiB page be trimmed out of a larger native aggregate without gaps.
 *
 * Cursors are opaque host state bound to one resource id. They contain only
 * stream offsets (never a path), so a forged or foreign cursor is rejected
 * instead of being able to read an arbitrary file.
 *
 * @module dsh-nexus/shell/output
 */

import type { SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import type { OutputPage } from '../protocol.ts'
import { PROCESS_READ_MAX_BYTES } from '../runtime/defaults.ts'
import { NexusError } from '../runtime/errors.ts'

/** The collected readers a managed process owns; either may be absent defensively. */
export interface ProcessOutputStreams {
  /** Collected stdout reader, when the spawn requested collect mode. */
  readonly stdout?: SubprocessOutputReader | undefined
  /** Collected stderr reader, when the spawn requested collect mode. */
  readonly stderr?: SubprocessOutputReader | undefined
}

/** Opaque cursor payload; never exposed as an API shape. */
interface CursorState {
  readonly stdoutOffset: number
  readonly stderrOffset: number
  /** At least one requested byte has already fallen out of the retained tail. */
  readonly lost: boolean
  /** The `[stderr]` section marker was already emitted on an earlier page. */
  readonly stderrStarted: boolean
}

/** Cursor envelope prefix, versioned so an incompatible cursor is rejected. */
const CURSOR_PREFIX = 'nxshell1.'

/** Stand-in used when one stream was not collected. */
const EMPTY_READER: SubprocessOutputReader = {
  readFrom: (fromByte) => ({ text: '', nextOffset: fromByte, lossy: false }),
}

/**
 * One process's output window. Sticky state belongs to the process, not to a
 * caller-provided cursor, so availability facts cannot be reset by replaying
 * an older cursor.
 */
export class ManagedOutput {
  private spillAvailable = false

  /**
   * @param resourceId - process id every cursor must belong to.
   * @param streams - the collected stdout/stderr readers.
   */
  constructor(
    private readonly resourceId: string,
    private readonly streams: ProcessOutputStreams,
  ) {}

  /**
   * Read the next bounded page.
   * @param cursor - cursor returned by the previous read; omit for the first read.
   * @param limit - requested UTF-8 byte cap; clamped to the 16 KiB page maximum.
   * @returns the page and its continuation cursor.
   * @throws NexusError `INVALID_ARGUMENT` for a malformed or foreign cursor/limit.
   */
  read(cursor?: string, limit?: number): OutputPage {
    const state: { stdoutOffset: number; stderrOffset: number; lost: boolean; stderrStarted: boolean } =
      cursor === undefined
        ? { stdoutOffset: 0, stderrOffset: 0, lost: false, stderrStarted: false }
        : decodeCursor(cursor, this.resourceId)
    let remaining = pageLimit(limit)
    let lost = state.lost
    let text = ''

    const stdout = readAligned(this.streams.stdout ?? EMPTY_READER, state.stdoutOffset)
    const stdoutPage = takeUtf8Prefix(stdout.text, remaining)
    const stdoutBytes = Buffer.byteLength(stdoutPage, 'utf8')
    state.stdoutOffset = stdout.start + stdoutBytes
    remaining -= stdoutBytes
    text += stdoutPage
    lost = lost || stdout.lossy
    if (stdout.spillPath !== undefined) this.spillAvailable = true

    if (remaining > 0) {
      const stderr = readAligned(this.streams.stderr ?? EMPTY_READER, state.stderrOffset)
      if (stderr.text.length > 0) {
        const marker = '[stderr]\n'
        const markerBytes = Buffer.byteLength(marker, 'utf8')
        const prefix = state.stderrStarted ? '' : marker
        const prefixBytes = state.stderrStarted ? 0 : markerBytes
        if (remaining > prefixBytes) {
          const stderrPage = takeUtf8Prefix(stderr.text, remaining - prefixBytes)
          const stderrBytes = Buffer.byteLength(stderrPage, 'utf8')
          state.stderrOffset = stderr.start + stderrBytes
          text += prefix + stderrPage
          state.stderrStarted = true
          lost = lost || stderr.lossy
        }
        // With no room for the marker, the stderr text stays unread for the
        // next page; its native offset is not advanced.
      }
      if (stderr.spillPath !== undefined) this.spillAvailable = true
    }

    return {
      text,
      cursor: encodeCursor(this.resourceId, { ...state, lost }),
      lossy: lost,
      spillAvailable: this.spillAvailable,
    }
  }
}

/** Read one stream from an exact offset, resolving a lossy window to its real start. */
function readAligned(
  reader: SubprocessOutputReader,
  fromByte: number,
): { text: string; start: number; lossy: boolean; spillPath?: string } {
  const first = reader.readFrom(fromByte)
  if (!first.lossy) {
    return {
      text: first.text,
      start: fromByte,
      lossy: false,
      ...(first.spillPath === undefined ? {} : { spillPath: first.spillPath }),
    }
  }
  const start = findWindowStart(reader, fromByte, first.nextOffset)
  const aligned = reader.readFrom(start)
  const spillPath = first.spillPath ?? aligned.spillPath
  return {
    text: aligned.text,
    start,
    lossy: true,
    ...(spillPath === undefined ? {} : { spillPath }),
  }
}

/**
 * Find the first byte offset whose read is no longer lossy.
 *
 * The reader reports only the retained tail's END offset, so the window start
 * is located by monotonic probing instead of re-measuring decoded text (which
 * would be wrong for a window that begins mid-code-point).
 */
function findWindowStart(reader: SubprocessOutputReader, fromByte: number, end: number): number {
  let low = fromByte
  let high = end
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (reader.readFrom(middle).lossy) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Longest prefix whose UTF-8 encoding fits the byte budget, never splitting a
 * code point. A single code point larger than a tiny caller limit is returned
 * whole so the cursor always makes progress.
 */
function takeUtf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  let used = 0
  let end = 0
  for (const char of text) {
    const bytes = Buffer.byteLength(char, 'utf8')
    if (used + bytes > maxBytes) break
    used += bytes
    end += char.length
  }
  if (end === 0 && text.length > 0) end = text.codePointAt(0)! > 0xffff ? 2 : 1
  return text.slice(0, end)
}

/** Validate and clamp one requested page size. */
function pageLimit(limit: number | undefined): number {
  if (limit === undefined) return PROCESS_READ_MAX_BYTES
  if (!Number.isFinite(limit) || limit < 1) {
    throw new NexusError('INVALID_ARGUMENT', 'the output read limit must be a positive finite number of bytes')
  }
  return Math.min(Math.floor(limit), PROCESS_READ_MAX_BYTES)
}

/** Encode one cursor for the process that produced it. */
function encodeCursor(resourceId: string, state: CursorState): string {
  const payload = JSON.stringify({
    v: 1,
    id: resourceId,
    o: state.stdoutOffset,
    e: state.stderrOffset,
    l: state.lost,
    m: state.stderrStarted,
  })
  return `${CURSOR_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}`
}

/** Decode and validate a cursor, rejecting foreign/malformed values. */
function decodeCursor(cursor: string, resourceId: string): CursorState {
  const invalid = (): NexusError =>
    new NexusError(
      'INVALID_ARGUMENT',
      'the output cursor does not belong to this process; start a new read without a cursor',
    )
  if (!cursor.startsWith(CURSOR_PREFIX)) throw invalid()
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'))
  } catch {
    throw invalid()
  }
  if (parsed === null || typeof parsed !== 'object') throw invalid()
  const record = parsed as Record<string, unknown>
  const lost = record.l
  const stderrStarted = record.m
  if (
    record.v !== 1 ||
    record.id !== resourceId ||
    typeof lost !== 'boolean' ||
    typeof stderrStarted !== 'boolean'
  ) {
    throw invalid()
  }
  const stdoutOffset = record.o
  const stderrOffset = record.e
  if (!isOffset(stdoutOffset) || !isOffset(stderrOffset)) throw invalid()
  return { stdoutOffset, stderrOffset, lost, stderrStarted }
}

/** Whether a decoded cursor offset is a usable non-negative byte position. */
function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
