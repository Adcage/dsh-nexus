/**
 * What the model actually reads: static HTML→markdown conversion, zero-based
 * UTF-16 paging, and literal location over one saved text.
 *
 * The conversion is deliberately static. Turndown parses the decoded HTML into
 * its own DOM and walks it; nothing here evaluates a script, loads a
 * subresource, or resolves a URL, and non-visible elements are removed before
 * they can contribute their text. Deeply nested markup is refused instead of
 * being walked, because the parse cost grows superlinearly and a tool call must
 * stay bounded.
 *
 * Paging and location never lowercase or re-encode the source. A page snaps to
 * code-point boundaries and reports the boundaries it actually returned, so a
 * caller can concatenate pages without a gap or a repeated character; a
 * case-insensitive search matches against the source text itself, so every
 * reported offset is a real position in the saved basis.
 *
 * @module dsh-nexus/web/extract
 */

import { Buffer } from 'node:buffer'
import { gfm } from '@joplin/turndown-plugin-gfm'
import TurndownService from 'turndown'

/** Most matches one `find` reports before saying more remain. */
export const FIND_MAX_MATCHES = 50

/** Characters of context kept on each side of one reported match. */
export const FIND_SNIPPET_RADIUS = 60

/**
 * Nesting depth above which conversion is refused.
 *
 * Walking a deeply nested tree synchronously blocks the loop for seconds
 * (unclosed tags make the parse superlinear). Real pages nest a few dozen
 * levels, so this ceiling only rejects hostile or broken markup.
 */
const MAX_CONVERSION_DEPTH = 512

/** Elements that never take a closing tag, so they do not grow the stack. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/** Elements whose contents HTML parses as text until the matching end tag. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript'])

/** The shared converter; stateless across calls and safe to reuse. */
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

turndown.use(gfm)

turndown.addRule('removeNonVisibleContent', {
  filter(node) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED'].includes(node.nodeName)) return true
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden')?.toLowerCase() === 'true') return true
    if (node.nodeName === 'INPUT' && node.getAttribute('type')?.toLowerCase() === 'hidden') return true
    return (node.getAttribute('style')?.split(';') ?? []).some((declaration: string) => {
      const separator = declaration.indexOf(':')
      if (separator === -1) return false
      const property = declaration.slice(0, separator).trim().toLowerCase()
      const value = declaration
        .slice(separator + 1)
        .trim()
        .toLowerCase()
        .replace(/\s*!important\s*$/u, '')
      return (
        (property === 'display' && value === 'none') ||
        (property === 'visibility' && (value === 'hidden' || value === 'collapse'))
      )
    })
  },
  replacement() {
    return ''
  },
})

/** Result of a static HTML conversion. */
export interface HtmlConversion {
  /** Marks this outcome as a completed conversion. */
  readonly skipped: false
  /** The converted markdown text. */
  readonly text: string
}

/** Conversion refused before parsing an unsafe body. */
export interface HtmlConversionSkipped {
  /** Marks this outcome as a refusal. */
  readonly skipped: true
  /** Why the conversion was not attempted. */
  readonly reason: 'too-deep'
}

/** Either a converted text or an explicit refusal. */
export type HtmlConversionOutcome = HtmlConversion | HtmlConversionSkipped

/** Whether a character can follow a raw-text end-tag name. */
function isTagBoundary(char: string | undefined): boolean {
  return char === undefined || char === '>' || char === '/' || /\s/u.test(char)
}

/** Find a raw-text end tag without interpreting markup-like body text. */
function findRawTextEnd(lowerHtml: string, name: string, from: number): number {
  const prefix = `</${name}`
  let candidate = lowerHtml.indexOf(prefix, from)
  while (candidate !== -1 && !isTagBoundary(lowerHtml[candidate + prefix.length])) {
    candidate = lowerHtml.indexOf(prefix, candidate + prefix.length)
  }
  return candidate
}

/**
 * Conservatively reject HTML whose lexical element stack crosses the depth
 * ceiling.
 *
 * The single pass ignores comments, skips raw-text bodies, respects quoted `>`
 * characters and only counts well-formed tag starts. Mismatched closing tags
 * reduce the counter but never below zero, so malformed markup over-counts
 * nesting rather than hiding it.
 * @param html - the decoded HTML body.
 * @returns whether conversion must be refused.
 */
function exceedsConversionDepth(html: string): boolean {
  const lower = html.toLowerCase()
  let depth = 0
  let index = 0
  while (index < lower.length) {
    const open = lower.indexOf('<', index)
    if (open === -1) return false
    if (lower.startsWith('<!--', open)) {
      const end = lower.indexOf('-->', open + 4)
      if (end === -1) return false
      index = end + 3
      continue
    }
    if (lower[open + 1] === '!' || lower[open + 1] === '?') {
      const end = lower.indexOf('>', open + 2)
      if (end === -1) return false
      index = end + 1
      continue
    }
    if (lower[open + 1] === '/') {
      const end = lower.indexOf('>', open + 2)
      if (end === -1) return false
      if (/[a-z]/u.test(lower[open + 2] ?? '')) depth = Math.max(0, depth - 1)
      index = end + 1
      continue
    }
    if (!/[a-z]/u.test(lower[open + 1] ?? '')) {
      index = open + 1
      continue
    }
    let cursor = open + 1
    const nameStart = cursor
    while (cursor < lower.length && /[a-z0-9:-]/u.test(lower[cursor] ?? '')) cursor += 1
    const name = lower.slice(nameStart, cursor)
    let quote: string | undefined
    while (cursor < lower.length) {
      const char = lower[cursor]
      if (quote !== undefined) {
        if (char === quote) quote = undefined
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
      cursor += 1
    }
    if (cursor >= lower.length) return false
    const selfClosing = lower[cursor - 1] === '/'
    index = cursor + 1
    if (VOID_ELEMENTS.has(name) || selfClosing) continue
    depth += 1
    if (depth > MAX_CONVERSION_DEPTH) return true
    if (RAW_TEXT_ELEMENTS.has(name)) {
      const end = findRawTextEnd(lower, name, index)
      if (end === -1) return false
      index = end
    }
  }
  return false
}

/**
 * Convert an HTML body to readable markdown, or refuse it.
 * @param html - decoded HTML body.
 * @returns the conversion, or the explicit refusal.
 */
export function convertHtmlToText(html: string): HtmlConversionOutcome {
  if (exceedsConversionDepth(html)) return { skipped: true, reason: 'too-deep' }
  return { skipped: false, text: turndown.turndown(html) }
}

/** One bounded page of a saved text. */
export interface TextPage {
  /** The page text exactly as sliced from the saved basis. */
  readonly text: string
  /** Actual zero-based UTF-16 offset the page starts at. */
  readonly offset: number
  /** Actual exclusive UTF-16 end offset. */
  readonly endOffset: number
  /** Offset a following page continues from; equal to `endOffset`. */
  readonly nextOffset: number
  /** The page reaches the end of the saved basis. */
  readonly atEnd: boolean
}

/** Whether a UTF-16 unit is a high surrogate. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** Whether a UTF-16 unit is a low surrogate. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/**
 * Move a start offset back off the trailing half of a surrogate pair.
 * @param text - saved basis text.
 * @param offset - candidate UTF-16 offset.
 * @returns an offset that never begins inside a pair.
 */
function snapStart(text: string, offset: number): number {
  const bounded = Math.max(0, Math.min(offset, text.length))
  if (bounded > 0 && bounded < text.length) {
    if (isLowSurrogate(text.charCodeAt(bounded)) && isHighSurrogate(text.charCodeAt(bounded - 1))) return bounded - 1
  }
  return bounded
}

/**
 * Move an exclusive end offset forward off the leading half of a surrogate pair.
 * @param text - saved basis text.
 * @param offset - candidate exclusive offset.
 * @returns an offset that never ends inside a pair.
 */
function snapEnd(text: string, offset: number): number {
  const bounded = Math.max(0, Math.min(offset, text.length))
  if (bounded > 0 && bounded < text.length) {
    if (isHighSurrogate(text.charCodeAt(bounded - 1)) && isLowSurrogate(text.charCodeAt(bounded))) return bounded + 1
  }
  return bounded
}

/**
 * Slice one page out of a saved basis.
 *
 * `offset` is a zero-based UTF-16 index. The returned page reports the actual
 * boundaries: a requested offset inside a surrogate pair starts at the pair, and
 * a page ending inside a pair includes the whole pair, so concatenating pages
 * reproduces the source exactly.
 * @param text - saved basis text.
 * @param offset - requested zero-based UTF-16 offset.
 * @param limit - maximum UTF-16 units (a completed surrogate pair may add one).
 * @returns the bounded page.
 */
export function pageText(text: string, offset: number, limit: number): TextPage {
  const start = snapStart(text, offset)
  const end = snapEnd(text, Math.min(text.length, start + Math.max(1, limit)))
  return {
    text: text.slice(start, end),
    offset: start,
    endOffset: end,
    nextOffset: end,
    atEnd: end >= text.length,
  }
}

/** One reported literal match. */
export interface TextMatch {
  /** Zero-based UTF-16 offset of the match start in the saved basis. */
  readonly offset: number
  /** Exclusive UTF-16 offset of the match end. */
  readonly endOffset: number
  /** Bounded source text around the match. */
  readonly snippet: string
  /** Zero-based UTF-16 offset the snippet starts at. */
  readonly snippetOffset: number
}

/** Bounded literal search outcome. */
export interface FindOutcome {
  /** Matches found, in source order, capped at the reported bound. */
  readonly matches: readonly TextMatch[]
  /** At least one further match exists that was not reported. */
  readonly truncated: boolean
  /** Offset of the first omitted match, or 0 when the scan was complete. */
  readonly scannedTo: number
}

/** Escape one literal string for use as a regular expression body. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Locate one literal string in the saved basis.
 *
 * The pattern is built from the escaped literal; a case-insensitive scan adds
 * the `i` flag to the pattern rather than lowercasing the source, so match
 * offsets stay real source positions. The scan stops one match past the bound,
 * which proves that more exist without walking a document that may contain
 * millions of hits.
 * @param text - saved basis text.
 * @param search - literal search text.
 * @param caseSensitive - whether case matters.
 * @param maxMatches - reported-match bound.
 * @param snippetRadius - context kept on each side of a match.
 * @returns the bounded matches.
 */
export function findText(
  text: string,
  search: string,
  caseSensitive: boolean,
  maxMatches: number,
  snippetRadius: number,
): FindOutcome {
  const matches: TextMatch[] = []
  if (search.length === 0) return { matches, truncated: false, scannedTo: 0 }
  const pattern = new RegExp(escapeRegExp(search), caseSensitive ? 'g' : 'gi')
  let truncated = false
  let scannedTo = 0
  for (;;) {
    const match = pattern.exec(text)
    if (match === null) break
    if (matches.length >= maxMatches) {
      truncated = true
      scannedTo = match.index
      break
    }
    const start = match.index
    const end = start + match[0].length
    const snippetOffset = snapStart(text, Math.max(0, start - snippetRadius))
    const snippetEnd = snapEnd(text, Math.min(text.length, end + snippetRadius))
    matches.push({ offset: start, endOffset: end, snippet: text.slice(snippetOffset, snippetEnd), snippetOffset })
    if (pattern.lastIndex <= start) pattern.lastIndex = start + 1
  }
  return { matches, truncated, scannedTo }
}

/**
 * Measure one text in UTF-8 bytes.
 * @param text - text to measure.
 * @returns its UTF-8 byte length.
 */
export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Cut one text to a UTF-8 byte budget on a code-point boundary.
 * @param text - text to cut.
 * @param maxBytes - UTF-8 byte budget.
 * @returns the longest prefix that fits without splitting a surrogate pair.
 */
export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (utf8Bytes(text) <= maxBytes) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (utf8Bytes(text.slice(0, mid)) <= maxBytes) low = mid
    else high = mid - 1
  }
  let end = low
  if (end > 0 && end < text.length) {
    if (isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) end -= 1
  }
  return text.slice(0, end)
}
