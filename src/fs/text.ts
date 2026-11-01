/**
 * Byte-safe text helpers for the Nexus file tools.
 *
 * The read window is a pure projection of decoded chunks: it counts every line
 * of the file, returns at most `limit` lines inside a byte budget, and reports
 * the exact offset a continuation call needs. Edit planning starts from raw
 * bytes, so the encoding checks here decide whether a file may be modified at
 * all: UTF-8 (with or without a BOM) is supported, every other encoding or a
 * binary NUL is refused rather than converted.
 *
 * @module dsh-nexus/fs/text
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import { NexusError } from '../runtime/errors.ts'

/** One literal replacement the model asks for. */
export interface TextEdit {
  /** Literal text to find; must be non-empty and unique in the original. */
  readonly oldText: string
  /** Literal replacement; an empty string deletes the match. */
  readonly newText: string
}

/** One line returned by a bounded read. */
export interface TextReadLine {
  /** 1-based line number in the file. */
  readonly number: number
  /** Line text without its trailing newline, possibly truncated by the line cap. */
  readonly text: string
}

/** One bounded, line-numbered read window. */
export interface TextReadWindow {
  /** 1-based first line the call requested. */
  readonly offset: number
  /** Lines returned, in file order. */
  readonly lines: readonly TextReadLine[]
  /** Exact line count of the whole file. */
  readonly totalLines: number
  /** Offset a continuation call needs, or null when the window reached the end. */
  readonly nextOffset: number | null
  /** Whether more content exists after this window or the byte cap stopped the scan. */
  readonly truncated: boolean
}

/** Resolved caps of one read call. */
export interface ReadWindowRequest {
  /** 1-based first line to return. */
  readonly offset: number
  /** Maximum number of lines to return. */
  readonly limit: number
  /** Maximum characters kept from one long line. */
  readonly maxLineLength: number
  /** Maximum output bytes kept for the selected lines. */
  readonly maxBytes: number
}

/** Maximum characters of one line before it is visibly truncated (presentation cap). */
export const READ_MAX_LINE_LENGTH = 2_000

/** Largest number of literal edits one call may carry (shared contracts §4.2). */
export const EDIT_MAX_ITEMS = 64

/** A decoded editable file: its text and whether the bytes carried a UTF-8 BOM. */
export interface EditableText {
  /** Decoded text without the BOM character. */
  readonly text: string
  /** Whether the original bytes began with a UTF-8 BOM. */
  readonly bom: boolean
}

/** A line-ending style an edit restores into a replaced region. */
export type LineEndingStyle = 'crlf' | 'lf'

/**
 * Decode a file the edit tool may modify.
 *
 * A BOM is separated from the text so the final write can put the exact same
 * bytes back. A UTF-16/UTF-32 byte-order mark, invalid UTF-8 or a NUL byte all
 * mean the file is not a UTF-8 text file: the call is refused rather than
 * silently converted or partially layered onto bytes the tool cannot round-trip.
 * @param bytes - complete raw file bytes.
 * @returns the decoded text and BOM fact.
 * @throws NexusError `UNSUPPORTED_ENCODING` when the bytes are not editable UTF-8 text.
 */
export function decodeEditableText(bytes: Uint8Array): EditableText {
  if (bytes.byteLength >= 2) {
    const first = bytes[0] ?? 0
    const second = bytes[1] ?? 0
    if ((first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff)) {
      throw new NexusError(
        'UNSUPPORTED_ENCODING',
        'this file uses a UTF-16/UTF-32 byte-order mark; Nexus edits only UTF-8 text and will not convert it',
      )
    }
  }
  const bom = bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = bom ? bytes.subarray(3) : bytes
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw new NexusError(
      'UNSUPPORTED_ENCODING',
      'this file is not valid UTF-8; Nexus edits only UTF-8 text and will not convert it',
    )
  }
  if (text.includes('\0')) {
    throw new NexusError(
      'UNSUPPORTED_ENCODING',
      'this file contains NUL bytes and looks binary; Nexus edits only UTF-8 text files',
    )
  }
  return { text, bom }
}

/**
 * Collapse CRLF to LF, the canonical form every match is planned on.
 * Lone carriage returns are left untouched.
 * @param text - text in any line-ending style.
 * @returns the LF-normalized text.
 */
export function normalizeLineEndings(text: string): string {
  return text.replaceAll('\r\n', '\n')
}

/**
 * Detect the dominant line-ending style of a text sample.
 * @param text - text to sample (the first 4 KiB is enough, as the shipped backend does).
 * @returns `'crlf'` when CRLF pairs outnumber lone LFs, otherwise `'lf'`.
 */
export function detectLineEndingStyle(text: string): LineEndingStyle {
  const sample = text.slice(0, 4_096)
  const crlf = sample.split('\r\n').length - 1
  const lf = sample.split('\n').length - 1
  return crlf > lf - crlf ? 'crlf' : 'lf'
}

/**
 * Put LF-normalized replacement text back into a chosen line-ending style.
 * @param text - replacement text in any style.
 * @param style - style the replaced region used.
 * @returns the replacement text in that style.
 */
export function restoreLineEndings(text: string, style: LineEndingStyle): string {
  const normalized = normalizeLineEndings(text)
  return style === 'crlf' ? normalized.split('\n').join('\r\n') : normalized
}

/**
 * Clip one display line without splitting a UTF-16 surrogate pair.
 *
 * A high surrogate at the cut boundary belongs to a code point whose low half
 * lies beyond the cap; keeping only the high half would emit an invalid lone
 * surrogate into the model-facing text, so the pair is dropped instead.
 * @param text - the line's decoded text.
 * @param max - maximum UTF-16 code units to keep.
 * @returns the prefix, ending on a whole code point when possible.
 */
function clipLine(text: string, max: number): string {
  if (text.length <= max) return text
  let end = max
  const boundary = text.charCodeAt(end - 1)
  if (boundary >= 0xd800 && boundary <= 0xdbff) end -= 1
  return text.slice(0, end)
}

/**
 * Build one bounded, line-numbered window and count the whole file.
 *
 * A file whose first returned line alone exceeds the byte cap still returns that
 * line: refusing every line would make `nextOffset` repeat forever, and the
 * line itself is already bounded by {@link READ_MAX_LINE_LENGTH}. The overflow
 * is reported through `truncated` instead.
 * @param chunks - decoded text chunks in file order.
 * @param request - resolved offset, line and byte caps.
 * @param displayPath - caller-facing path used by the out-of-range error.
 * @returns the numbered window and its continuation offset.
 * @throws FsError `FS_NOT_FOUND` when a non-empty file is asked for an offset past its end.
 */
export async function buildTextWindow(
  chunks: AsyncIterable<string> | Iterable<string>,
  request: ReadWindowRequest,
  displayPath: string,
): Promise<TextReadWindow> {
  const lines: TextReadLine[] = []
  let lineBuffer = ''
  let totalLines = 0
  let outputBytes = 0
  let byteCapped = false

  const consume = (rawLine: string): void => {
    totalLines += 1
    if (byteCapped || totalLines < request.offset || lines.length >= request.limit) return
    const text =
      rawLine.length > request.maxLineLength
        ? `${clipLine(rawLine, request.maxLineLength)}... (line truncated to ${request.maxLineLength} chars; the remaining tail is not reachable by this cursor — use the shell tool to read it in byte chunks)`
        : rawLine
    const bytes = Buffer.byteLength(text, 'utf8') + (lines.length > 0 ? 1 : 0)
    if (lines.length > 0 && outputBytes + bytes > request.maxBytes) {
      byteCapped = true
      return
    }
    outputBytes += bytes
    lines.push({ number: totalLines, text })
  }

  // A newline-free line must not grow the buffer with the file, so the current
  // line keeps at most the visible cap plus one character (the CR of a CRLF).
  const lineCap = request.maxLineLength + 1
  const append = (segment: string): void => {
    if (lineBuffer.length >= lineCap) return
    lineBuffer += segment
    if (lineBuffer.length > lineCap) lineBuffer = lineBuffer.slice(0, lineCap)
  }

  for await (const chunk of chunks) {
    let start = 0
    let newline = chunk.indexOf('\n', start)
    while (newline !== -1) {
      append(chunk.slice(start, newline))
      consume(lineBuffer.endsWith('\r') ? lineBuffer.slice(0, -1) : lineBuffer)
      lineBuffer = ''
      start = newline + 1
      newline = chunk.indexOf('\n', start)
    }
    append(chunk.slice(start))
  }
  if (lineBuffer.length > 0) consume(lineBuffer)

  const lastNumber = lines.at(-1)?.number ?? request.offset - 1
  if (lines.length === 0 && !byteCapped && request.offset > totalLines && !(totalLines === 0 && request.offset === 1)) {
    throw new FsError(`offset ${request.offset} is out of range for "${displayPath}" (${totalLines} lines)`, 'FS_NOT_FOUND')
  }
  const truncated = lastNumber < totalLines || byteCapped
  return {
    offset: request.offset,
    lines,
    totalLines,
    nextOffset: truncated ? (lines.length > 0 ? lastNumber + 1 : request.offset) : null,
    truncated,
  }
}

/**
 * Format a text window as the model-facing envelope beside nothing else.
 * @param displayPath - backend-resolved path shown to the model.
 * @param window - the bounded window.
 * @returns the `<path>` envelope with numbered lines and a continuation footer.
 */
export function formatTextReadOutput(displayPath: string, window: TextReadWindow): string {
  const endLine = window.lines.at(-1)?.number ?? Math.max(0, window.offset - 1)
  const footer =
    window.nextOffset === null
      ? `(End of file - total ${window.totalLines} lines)`
      : `(Showing lines ${window.offset}-${endLine} of ${window.totalLines}. Use offset=${window.nextOffset} to continue.)`
  const body = window.lines.length > 0 ? `${window.lines.map((line) => `${line.number}: ${line.text}`).join('\n')}\n\n${footer}` : footer
  return `<path>${displayPath}</path>\n<type>file</type>\n<content>\n${body}\n</content>`
}
