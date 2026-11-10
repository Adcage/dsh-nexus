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
export interface OutputCursorState {
  /** Whole-stream stdout byte offset to resume from. */
  readonly stdoutOffset: number
  /** Whole-stream stderr byte offset to resume from. */
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
 * One process's output window. Cursor state is explicit; spill availability is
 * recomputed on every page from what each reader reports NOW, because the
 * provider may revoke its spill file on cap/write/seal failure.
 */
export class ManagedOutput {
  /**
   * @param resourceId - process id every cursor must belong to.
   * @param streams - the collected stdout/stderr readers.
   */
  constructor(
    private readonly resourceId: string,
    private readonly streams: ProcessOutputStreams,
    /** Native output-completion fact; defaults to a fixed, complete buffer. */
    private readonly isOutputComplete: () => boolean = () => true,
  ) {}

  /**
   * Read the next bounded page.
   * @param cursor - cursor returned by the previous read; omit for the first read.
   * @param limit - requested UTF-8 byte cap; clamped to the 16 KiB page maximum.
   * @returns the page and its continuation cursor.
   * @throws NexusError `INVALID_ARGUMENT` for a malformed or foreign cursor/limit.
   */
  read(cursor?: string, limit?: number): OutputPage {
    const outputComplete = this.isOutputComplete()
    const state: { stdoutOffset: number; stderrOffset: number; lost: boolean; stderrStarted: boolean } =
      cursor === undefined
        ? { stdoutOffset: 0, stderrOffset: 0, lost: false, stderrStarted: false }
        : decodeOutputCursor(cursor, this.resourceId)
    let remaining = outputPageLimit(limit)
    let lost = state.lost
    let text = ''

    const stdoutReader = this.streams.stdout ?? EMPTY_READER
    const stdout = readAligned(stdoutReader, state.stdoutOffset)
    const stdoutWindow = readMemoryWindow(
      stdoutReader,
      { text: stdout.text, start: stdout.start, end: stdout.end, lossy: stdout.lossy },
      remaining,
      outputComplete,
    )
    state.stdoutOffset = stdoutWindow.nextOffset
    remaining -= stdoutWindow.bytes
    text += stdoutWindow.text
    lost = lost || stdoutWindow.lost

    // Read stderr even when this page has no room for it: its CURRENT spill
    // fact is part of this page's availability answer.
    const stderrReader = this.streams.stderr ?? EMPTY_READER
    const stderr = readAligned(stderrReader, state.stderrOffset)
    const spillAvailable = stdout.spillPath !== undefined || stderr.spillPath !== undefined
    if (remaining > 0 && stderr.text.length > 0) {
      const marker = '[stderr]\n'
      const markerBytes = Buffer.byteLength(marker, 'utf8')
      const prefix = state.stderrStarted ? '' : marker
      const prefixBytes = state.stderrStarted ? 0 : markerBytes
      if (remaining > prefixBytes) {
        const stderrWindow = readMemoryWindow(
          stderrReader,
          { text: stderr.text, start: stderr.start, end: stderr.end, lossy: stderr.lossy },
          remaining - prefixBytes,
          outputComplete,
        )
        state.stderrOffset = stderrWindow.nextOffset
        lost = lost || stderrWindow.lost
        if (stderrWindow.text.length > 0) {
          text += prefix + stderrWindow.text
          state.stderrStarted = true
        }
      }
      // With no room for the marker, the stderr text stays unread for the
      // next page; its native offset is not advanced.
    }

    return {
      text,
      cursor: encodeCursor(this.resourceId, { ...state, lost }),
      lossy: lost,
      spillAvailable,
    }
  }
}

/** One stream's read, already anchored to a real byte start. */
interface AlignedRead {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly lossy: boolean
  readonly spillPath?: string
}

/** Read one stream from an exact offset, resolving a lossy window to its real start. */
function readAligned(reader: SubprocessOutputReader, fromByte: number): AlignedRead {
  const first = reader.readFrom(fromByte)
  if (!first.lossy) {
    // A non-lossy cursor is a boundary this module returned (or the stream
    // start). Leading-crop alignment applies only to a retained window whose
    // head slid out of memory; running it here would misread a genuinely
    // unfinished live tail as a cropped prefix.
    return {
      text: first.text,
      start: fromByte,
      end: first.nextOffset,
      lossy: false,
      ...(first.spillPath === undefined ? {} : { spillPath: first.spillPath }),
    }
  }
  const start = findWindowStart(reader, fromByte, first.nextOffset)
  const aligned = reader.readFrom(start)
  const spillPath = first.spillPath ?? aligned.spillPath
  return alignCroppedWindow(reader, {
    text: aligned.text,
    start,
    end: aligned.nextOffset,
    lossy: true,
    ...(spillPath === undefined ? {} : { spillPath }),
  })
}

/**
 * Advance past continuation bytes left by a ring window that begins inside a
 * multi-byte character.
 *
 * Re-encoding the decoder's U+FFFD would over-count consumed source bytes and
 * let the cursor overtake bytes it never returned. The real boundary is the
 * largest bounded byte offset at which dropping exactly that many leading
 * replacement characters matches the decode from that offset; smaller offsets
 * still land inside the cropped character. The probe is bounded to the three
 * bytes a UTF-8 code point can leave behind, so a genuine literal U+FFFD plus
 * its valid bytes cannot be mistaken for a crop (their decodes do not match
 * this relation).
 */
function alignCroppedWindow(reader: SubprocessOutputReader, read: AlignedRead): AlignedRead {
  if (read.start >= read.end || !read.text.startsWith('\uFFFD')) return read
  const leading = countLeadingReplacements(read.text)
  const limit = Math.min(3, leading, read.end - read.start)
  let skip = 0
  for (let bytes = 1; bytes <= limit; bytes += 1) {
    const probe = reader.readFrom(read.start + bytes)
    if (dropLeadingReplacements(read.text, bytes) === probe.text) skip = bytes
  }
  if (skip === 0) return read
  return {
    ...read,
    text: dropLeadingReplacements(read.text, skip),
    start: read.start + skip,
    lossy: true,
  }
}

/** Count the replacement characters at the start of one decoded window. */
function countLeadingReplacements(text: string): number {
  let count = 0
  for (const char of text) {
    if (char !== '\uFFFD') break
    count += 1
  }
  return count
}

/** Remove exactly the requested count of leading replacement characters. */
function dropLeadingReplacements(text: string, count: number): string {
  let dropped = 0
  let index = 0
  for (const char of text) {
    if (dropped >= count) break
    if (char !== '\uFFFD') break
    dropped += 1
    index += char.length
  }
  return text.slice(index)
}

/**
 * Find the first byte offset whose read is no longer lossy.
 *
 * The reader reports only the retained tail's END offset, so the window start
 * is located by monotonic probing instead of re-measuring decoded text (which
 * would be wrong for a window that begins mid-code-point).
 */
export function findWindowStart(reader: SubprocessOutputReader, fromByte: number, end: number): number {
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
 * Hold a decoded trailing U+FFFD while the output can still grow.
 *
 * A live reader that ends inside a multi-byte character decodes the unfinished
 * bytes to trailing U+FFFD characters. Their UTF-8 width is not the source-byte
 * count, so returning them would advance the cursor past bytes the next chunk
 * needs. The last three replacement characters (the most a UTF-8 prefix can
 * leave) are held until the next page or until output completion makes the
 * decoded tail final; a longer literal run returns its earlier characters
 * immediately and is preserved in order. Only a page that actually reaches the
 * live stream end is held; a page cut before the tail is untouched.
 * @param page - the page text just taken.
 * @param streamText - the full decoded text available from this stream.
 * @param complete - whether the native output source has ended.
 * @returns the page text safe to return now.
 */
export function holdPendingTail(page: string, streamText: string, complete: boolean): string {
  if (complete || page !== streamText) return page
  let end = page.length
  for (let held = 0; held < 3 && end > 0 && page[end - 1] === '\uFFFD'; held += 1) end -= 1
  return page.slice(0, end)
}

/**
 * Longest prefix whose UTF-8 encoding fits the byte budget, never splitting a
 * code point. A single code point larger than a tiny caller limit is returned
 * whole so the cursor always makes progress.
 */
export function takeUtf8Prefix(text: string, maxBytes: number): string {
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

/**
 * Longest suffix whose UTF-8 encoding fits the byte budget, never splitting a
 * code point. A single trailing code point larger than a tiny budget is
 * returned whole so a completion notice always carries something.
 * @param text - complete decoded text.
 * @param maxBytes - byte budget for the returned suffix.
 * @returns the trailing slice, or the empty string for a non-positive budget.
 */
export function takeUtf8Tail(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  let used = 0
  let start = text.length
  for (const char of [...text].reverse()) {
    const bytes = Buffer.byteLength(char, 'utf8')
    if (used + bytes > maxBytes) break
    used += bytes
    start -= char.length
  }
  if (start === text.length && text.length > 0) {
    const last = [...text].at(-1)!
    return last
  }
  return text.slice(start)
}

/**
 * One bounded in-memory page and the whole-stream source bytes it consumed.
 *
 * `bytes` is always a source-byte count. For a provably byte-exact page it is
 * the decoded width; for an ambiguous invalid-UTF-8 window it is the whole
 * remaining source span, because the bounded preview consumes the rest and says
 * so instead of advancing by a decoded width that is not a source offset.
 */
export interface MemoryWindow {
  /** Page text returned to the caller. */
  readonly text: string
  /** Whole-stream source bytes consumed by this page. */
  readonly bytes: number
  /** Whole-stream offset immediately after `bytes`. */
  readonly nextOffset: number
  /** The page covers the whole decoded window from its start offset. */
  readonly full: boolean
  /** The page is not a provably byte-exact continuation of the source. */
  readonly lost: boolean
  /** Why a decoded-only window could not be mapped to exact source bytes. */
  readonly reason?: 'invalid-utf8'
}

/**
 * Read one bounded page out of one decoded native window.
 *
 * Native readers expose decoded text plus whole-stream byte offsets; they do
 * not expose raw bytes. For valid UTF-8 the decoded width equals the source
 * width, so a code-point-aligned prefix advances the cursor exactly. Invalid
 * bytes decode to U+FFFD and inflate the decoded width, so a decoded-width
 * advance would silently skip source bytes and a `lossy:false` page would be a
 * false exactness claim.
 *
 * The boundary is therefore proven, not assumed: the reader is asked for the
 * text after the proposed cursor offset and it must equal the remaining
 * decoded text. That probe also distinguishes a genuine literal U+FFFD and a
 * live pending tail (their suffix decodes identically) from an invalid byte
 * that has no source boundary at that decoded width. When the boundary cannot
 * be proven, the page stays bounded to `budget` and consumes the rest of the
 * retained window with `lost:true, reason:'invalid-utf8'`: the model sees an
 * explicitly incomplete preview, never a silent skip.
 * @param reader - native reader for this stream; undefined means only a width match can prove exactness.
 * @param window - decoded text and the whole-stream start/end offsets it was read from.
 * @param budget - UTF-8 page budget.
 * @param outputComplete - native output-completion fact for the pending-tail hold.
 * @returns the bounded page and its exact source-byte continuation.
 */
export function readMemoryWindow(
  reader: SubprocessOutputReader | undefined,
  window: { readonly text: string; readonly start: number; readonly end: number; readonly lossy: boolean },
  budget: number,
  outputComplete: boolean,
): MemoryWindow {
  const prefix = takeUtf8Prefix(window.text, budget)
  // A live reader can end in the middle of a UTF-8 character. Its decode is a
  // trailing U+FFFD whose byte width is not the number of source bytes
  // consumed, so hold the decoded tail until more bytes or output completion
  // arrive; the cursor stays exactly before it.
  const text = holdPendingTail(prefix, window.text, outputComplete)
  const span = Math.max(0, window.end - window.start)
  const claimed = Buffer.byteLength(text, 'utf8')
  const reachesEnd = text.length === window.text.length
  if (claimed <= span && boundaryIsSourceExact(reader, window.text, text, window.start + claimed, span)) {
    return {
      text,
      bytes: claimed,
      nextOffset: window.start + claimed,
      full: reachesEnd,
      lost: window.lossy,
    }
  }
  return {
    text,
    bytes: span,
    nextOffset: window.end,
    full: reachesEnd,
    lost: true,
    reason: 'invalid-utf8',
  }
}

/**
 * Whether one decoded page prefix ends on a real source-byte boundary.
 *
 * A valid UTF-8 boundary is proven by the reader returning exactly the
 * remaining decoded text from the proposed offset. A genuine literal U+FFFD
 * and a pending incomplete tail both satisfy that relation; an invalid byte
 * that inflated the decoded width does not.
 * @param reader - native reader for the stream.
 * @param sourceText - full decoded text of the window.
 * @param page - bounded page text taken from its start.
 * @param nextOffset - proposed whole-stream offset after the page.
 * @param span - whole-stream source span of the window.
 * @returns true only when the proposed offset is a proven source boundary.
 */
function boundaryIsSourceExact(
  reader: SubprocessOutputReader | undefined,
  sourceText: string,
  page: string,
  nextOffset: number,
  span: number,
): boolean {
  if (Buffer.byteLength(page, 'utf8') > span) return false
  if (reader === undefined) return Buffer.byteLength(sourceText, 'utf8') === span
  const suffix = reader.readFrom(nextOffset)
  return !suffix.lossy && suffix.text === sourceText.slice(page.length)
}

/**
 * Whether a decoded window can be mapped back to exact source bytes.
 *
 * Used by the process controller's per-stream truth so a lossy invalid-UTF-8
 * preview reports `invalid-utf8` instead of `lost:false`. Pending tails and
 * genuine replacement characters are not misclassified because the same
 * boundary proof is used.
 * @param reader - native reader for the stream.
 * @param text - full decoded text from `start`.
 * @param start - whole-stream offset the text starts at.
 * @param end - reader-reported whole-stream end offset.
 * @param outputComplete - native output-completion fact.
 * @returns true when the whole window is a proven byte-exact decode.
 */
export function memoryWindowIsByteExact(
  reader: SubprocessOutputReader | undefined,
  text: string,
  start: number,
  end: number,
  outputComplete: boolean,
): boolean {
  const page = holdPendingTail(text, text, outputComplete)
  return boundaryIsSourceExact(
    reader,
    text,
    page,
    start + Buffer.byteLength(page, 'utf8'),
    Math.max(0, end - start),
  )
}

/** Validate and clamp one requested page size. */
export function outputPageLimit(limit: number | undefined): number {
  if (limit === undefined) return PROCESS_READ_MAX_BYTES
  if (!Number.isFinite(limit) || limit < 1) {
    throw new NexusError('INVALID_ARGUMENT', 'the output read limit must be a positive finite number of bytes')
  }
  return Math.min(Math.floor(limit), PROCESS_READ_MAX_BYTES)
}

/** Encode one cursor for the process that produced it. */
function encodeCursor(resourceId: string, state: OutputCursorState): string {
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
export function decodeOutputCursor(cursor: string, resourceId: string): OutputCursorState {
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
