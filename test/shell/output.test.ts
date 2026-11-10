/**
 * Bounded, resumable output pages over the native collect-mode readers.
 *
 * @module dsh-nexus/test/shell/output
 */

import { describe, expect, it } from 'vitest'
import { NexusError } from '../../src/runtime/errors.ts'
import { ManagedOutput, takeUtf8Tail } from '../../src/shell/output.ts'
import { createScriptedLiveOutputReader, createScriptedOutputReader, createScriptedRawOutputReader } from '../support/fixtures.ts'

/** Read every page through a fresh cursor until the stream is empty. */
function readAll(output: ManagedOutput): { text: string; pages: number; lossy: boolean } {
  let cursor: string | undefined
  let text = ''
  let pages = 0
  let lossy = false
  for (; pages < 32; pages += 1) {
    const page = output.read(cursor)
    cursor = page.cursor
    lossy = lossy || page.lossy
    text += page.text
    if (page.text.length === 0) break
  }
  return { text, pages: pages + 1, lossy }
}

describe('takeUtf8Tail', () => {
  it('returns the whole text when it fits the byte budget', () => {
    expect(takeUtf8Tail('Tests: 12 passed', 512)).toBe('Tests: 12 passed')
  })

  it('keeps the newest bytes and never splits a code point', () => {
    const text = `${'a'.repeat(100)}结尾🙂`
    const tail = takeUtf8Tail(text, 12)
    // 结尾🙂 is 10 bytes, so a 12-byte budget still fits two ASCII bytes ahead of it.
    expect(tail).toBe('aa结尾🙂')
    expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(12)
    expect(text.endsWith(tail)).toBe(true)
  })

  it('returns one whole code point when the budget is smaller than it', () => {
    expect(takeUtf8Tail('ab🙂', 2)).toBe('🙂')
    expect(takeUtf8Tail('abc', 0)).toBe('')
  })
})

describe('ManagedOutput', () => {
  it('splits CJK and emoji on code-point boundaries without gaps or replacement characters', () => {
    const original = '中文🙂'.repeat(3000)
    const output = new ManagedOutput('proc_unicode', { stdout: createScriptedOutputReader(original) })
    let cursor: string | undefined
    let joined = ''
    let pageCount = 0
    for (; pageCount < 32; pageCount += 1) {
      const page = output.read(cursor)
      expect(Buffer.byteLength(page.text, 'utf8')).toBeLessThanOrEqual(16 * 1024)
      expect(page.text).not.toContain('\uFFFD')
      joined += page.text
      cursor = page.cursor
      if (Buffer.byteLength(joined, 'utf8') >= Buffer.byteLength(original, 'utf8')) {
        pageCount += 1
        break
      }
    }
    expect(joined).toBe(original)
    expect(pageCount).toBeGreaterThan(1)
  })

  it('continues exactly after the returned bytes when a native aggregate is larger than one page', () => {
    const original = `${'a'.repeat(20_000)}尾部`
    const output = new ManagedOutput('proc_continue', { stdout: createScriptedOutputReader(original) })
    const result = readAll(output)
    expect(result.text).toBe(original)
    expect(result.pages).toBeGreaterThan(1)
  })

  it('keeps separate stdout and stderr offsets and marks the stderr section', () => {
    const output = new ManagedOutput('proc_streams', {
      stdout: createScriptedOutputReader('A'.repeat(20_000)),
      stderr: createScriptedOutputReader('错误'),
    })
    const result = readAll(output)
    expect(result.text).toBe(`${'A'.repeat(20_000)}[stderr]\n错误`)
  })

  it('emits the stderr section marker once even when stderr spans pages', () => {
    const stderr = '错'.repeat(12_000)
    const output = new ManagedOutput('proc_stderr_pages', { stderr: createScriptedOutputReader(stderr) })
    const result = readAll(output)
    expect(result.text).toBe(`[stderr]
${stderr}`)
    expect(result.pages).toBeGreaterThan(1)
    expect(result.text.match(/\[stderr\]/g)).toHaveLength(1)
  })

  it('reports loss without inventing a spill file', () => {
    const output = new ManagedOutput('proc_no_spill', {
      stdout: createScriptedOutputReader('y'.repeat(2048), { memoryBytes: 512 }),
    })
    const page = output.read()
    expect(page.lossy).toBe(true)
    expect(page.spillAvailable).toBe(false)
  })

  it('bounds invalid UTF-8 without a spill instead of claiming a byte-exact continuation', () => {
    const output = new ManagedOutput('proc_invalid_nospill', {
      stdout: createScriptedRawOutputReader(Buffer.alloc(20_000, 0xff)),
    })
    const first = output.read()
    expect(Buffer.byteLength(first.text, 'utf8')).toBeLessThanOrEqual(16 * 1024)
    expect(first.lossy).toBe(true)
    const second = output.read(first.cursor)
    // The invalid remainder is disclosed once, never silently resumed.
    expect(second.text).toBe('')
    expect(second.lossy).toBe(true)
  })

  it('keeps valid UTF-8 exact after a genuine replacement character', () => {
    const original = 'A�中文🙂B'.repeat(500)
    const output = new ManagedOutput('proc_invalid_valid_mix', {
      stdout: createScriptedRawOutputReader(Buffer.from(original, 'utf8')),
    })
    const result = readAll(output)
    expect(result.text).toBe(original)
    expect(result.lossy).toBe(false)
  })

  it('reports a lossy retained window and drops spill availability when the provider revokes it', () => {
    const reader = createScriptedOutputReader('x'.repeat(4096), { memoryBytes: 1024, spillPath: 'C:/tmp/nexus.spill' })
    const output = new ManagedOutput('proc_loss', { stdout: reader })
    const first = output.read()
    expect(first.lossy).toBe(true)
    expect(first.spillAvailable).toBe(true)
    expect(first.text).toBe('x'.repeat(1024))
    reader.withdrawSpill()
    const second = output.read(first.cursor)
    expect(second.text).toBe('')
    expect(second.lossy).toBe(true)
    expect(second.spillAvailable).toBe(false)
  })

  it('reports a current stderr spill even on a stdout-only page and follows its withdrawal', () => {
    const stderr = createScriptedOutputReader('e'.repeat(4096), {
      memoryBytes: 1024,
      spillPath: 'C:/tmp/stderr.spill',
    })
    const output = new ManagedOutput('proc_spill_facts', {
      stdout: createScriptedOutputReader('A'.repeat(20_000)),
      stderr,
    })
    const first = output.read()
    expect(Buffer.byteLength(first.text, 'utf8')).toBe(16 * 1024)
    expect(first.text).not.toContain('[stderr]')
    expect(first.spillAvailable).toBe(true)
    stderr.withdrawSpill()
    const second = output.read(first.cursor)
    expect(second.spillAvailable).toBe(false)
  })

  it('does not advertise a spill file the provider never created (no overflow)', () => {
    const reader = createScriptedOutputReader('short', { spillPath: 'C:/tmp/never.spill' })
    expect(reader.readFrom(0).spillPath).toBeUndefined()
  })

  it.each([
    ['2-byte char leaves one continuation byte', 'AéB', 2, 'B'],
    ['2-byte char starts on a boundary', 'AéB', 3, 'éB'],
    ['3-byte char leaves one continuation byte', 'A中B', 2, 'B'],
    ['3-byte char leaves two continuation bytes', 'A中B', 3, 'B'],
    ['3-byte char starts on a boundary', 'A中B', 4, '中B'],
    ['4-byte char leaves one continuation byte', 'A🙂B', 2, 'B'],
    ['4-byte char leaves two continuation bytes', 'A🙂B', 3, 'B'],
    ['4-byte char leaves three continuation bytes', 'A🙂B', 4, 'B'],
    ['4-byte char starts on a boundary', 'A🙂B', 5, '🙂B'],
  ])('aligns a cropped multi-byte window: %s', (_name, text, memoryBytes, expected) => {
    const output = new ManagedOutput(`proc_cropped_${memoryBytes}_${expected.length}`, {
      stdout: createScriptedOutputReader(text, { memoryBytes }),
    })
    const first = output.read()
    expect(first.lossy).toBe(true)
    expect(first.text).toBe(expected)
    expect(first.text).not.toContain('\uFFFD')
    expect(output.read(first.cursor).text).toBe('')
  })

  it('keeps a legitimate literal U+FFFD at or next to the aligned boundary', () => {
    for (const memoryBytes of [5, 6]) {
      const output = new ManagedOutput(`proc_literal_${memoryBytes}`, {
        stdout: createScriptedOutputReader('A中\uFFFDZ', { memoryBytes }),
      })
      const first = output.read()
      expect(first.lossy).toBe(true)
      expect(first.text).toBe('\uFFFDZ')
      expect(output.read(first.cursor).text).toBe('')
    }
    const intact = new ManagedOutput('proc_literal_intact', { stdout: createScriptedOutputReader('A\uFFFDB') })
    expect(intact.read().text).toBe('A\uFFFDB')
    const leading = new ManagedOutput('proc_literal_leading', { stdout: createScriptedOutputReader('\uFFFDAB') })
    expect(leading.read().text).toBe('\uFFFDAB')
  })

  it('continues across bounded pages from a cropped ring window without gaps, drift or stalls', () => {
    const original = `START|${'中🙂é'.repeat(9000)}|END`
    const bytes = Buffer.from(original, 'utf8')
    const memoryBytes = 20 * 1024
    const windowStart = bytes.length - memoryBytes
    let boundary = windowStart
    let offset = 0
    for (const char of original) {
      const next = offset + Buffer.byteLength(char, 'utf8')
      if (offset >= windowStart) {
        boundary = offset
        break
      }
      if (next > windowStart) {
        boundary = next
        break
      }
      offset = next
    }
    const expected = bytes.subarray(boundary).toString('utf8')
    const output = new ManagedOutput('proc_cropped_pages', { stdout: createScriptedOutputReader(original, { memoryBytes }) })
    let cursor: string | undefined
    let joined = ''
    let pages = 0
    let sawEmpty = false
    for (; pages < 8; pages += 1) {
      const page = output.read(cursor)
      expect(Buffer.byteLength(page.text, 'utf8')).toBeLessThanOrEqual(16 * 1024)
      expect(page.lossy).toBe(true)
      cursor = page.cursor
      if (page.text.length === 0) {
        sawEmpty = true
        break
      }
      joined += page.text
    }
    expect(joined).toBe(expected)
    expect(joined.endsWith('|END')).toBe(true)
    expect(sawEmpty).toBe(true)
    expect(pages).toBeGreaterThan(1)
  })

  it.each([
    ['2-byte é', 'é', 1],
    ['3-byte 中 at byte 1', '中', 1],
    ['3-byte 中 at byte 2', '中', 2],
    ['4-byte 🙂 at byte 1', '🙂', 1],
    ['4-byte 🙂 at byte 2', '🙂', 2],
    ['4-byte 🙂 at byte 3', '🙂', 3],
  ])('reassembles a live %s split before the next chunk arrives', (_name, char, splitAt) => {
    const bytes = Buffer.from(char, 'utf8')
    const prefix = 'START|'
    const reader = createScriptedLiveOutputReader(Buffer.concat([Buffer.from(prefix, 'utf8'), bytes.subarray(0, splitAt)]))
    const output = new ManagedOutput(`proc_live_${char.length}_${splitAt}`, { stdout: reader }, () => reader.complete)
    const first = output.read()
    expect(first.lossy).toBe(false)
    expect(first.text).toBe(prefix)
    expect(first.text).not.toContain('\uFFFD')
    reader.append(Buffer.concat([bytes.subarray(splitAt), Buffer.from('|END', 'utf8')]))
    reader.end()
    const rest = drain(output, first.cursor)
    expect(first.text + rest.text).toBe(`${prefix}${char}|END`)
    expect(first.text + rest.text).not.toContain('\uFFFD')
    expect(rest.endedEmpty).toBe(true)
  })

  it('does not treat a pending trailing character as stream completion or emit its replacement early', () => {
    const bytes = Buffer.from('中', 'utf8')
    const reader = createScriptedLiveOutputReader(bytes.subarray(0, 1))
    const output = new ManagedOutput('proc_live_pending', { stdout: reader }, () => reader.complete)
    const first = output.read()
    expect(first.text).toBe('')
    expect(first.lossy).toBe(false)
    reader.append(bytes.subarray(1))
    reader.end()
    expect(output.read(first.cursor).text).toBe('中')
  })

  it('preserves a genuine literal U+FFFD at a live tail until more bytes or EOF', () => {
    const literal = Buffer.from([0xef, 0xbf, 0xbd])
    const reader = createScriptedLiveOutputReader(Buffer.concat([Buffer.from('START|', 'utf8'), literal]))
    const output = new ManagedOutput('proc_live_literal_tail', { stdout: reader }, () => reader.complete)
    const first = output.read()
    expect(first.text).toBe('START|')
    reader.append('|END')
    reader.end()
    const rest = drain(output, first.cursor)
    expect(first.text + rest.text).toBe('START|\uFFFD|END')

    const completeReader = createScriptedLiveOutputReader(Buffer.concat([Buffer.from('START|', 'utf8'), literal]))
    completeReader.end()
    const completeOutput = new ManagedOutput('proc_live_literal_eof', { stdout: completeReader }, () => completeReader.complete)
    expect(completeOutput.read().text).toBe('START|\uFFFD')
  })

  it('bounds a live literal U+FFFD run while preserving every character', () => {
    const literalRun = Buffer.from([0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd])
    const reader = createScriptedLiveOutputReader(Buffer.concat([Buffer.from('START|', 'utf8'), literalRun]))
    const output = new ManagedOutput('proc_live_literal_run', { stdout: reader }, () => reader.complete)
    const first = output.read()
    expect(first.text).toBe('START|�')
    reader.append('|END')
    reader.end()
    const rest = drain(output, first.cursor)
    expect(first.text + rest.text).toBe('START|����|END')
  })

  it('preserves a literal U+FFFD immediately next to a split character', () => {
    const char = Buffer.from('中', 'utf8')
    const literal = Buffer.from([0xef, 0xbf, 0xbd])

    const before = createScriptedLiveOutputReader(
      Buffer.concat([Buffer.from('START|', 'utf8'), literal, char.subarray(0, 1)]),
    )
    const beforeOutput = new ManagedOutput('proc_live_literal_before', { stdout: before }, () => before.complete)
    const first = beforeOutput.read()
    expect(first.text).toBe('START|')
    before.append(Buffer.concat([char.subarray(1), Buffer.from('|END', 'utf8')]))
    before.end()
    expect(beforeOutput.read(first.cursor).text).toBe('\uFFFD中|END')

    const after = createScriptedLiveOutputReader(
      Buffer.concat([Buffer.from('START|', 'utf8'), char.subarray(0, 1)]),
    )
    const afterOutput = new ManagedOutput('proc_live_literal_after', { stdout: after }, () => after.complete)
    const pending = afterOutput.read()
    expect(pending.text).toBe('START|')
    after.append(Buffer.concat([char.subarray(1), literal, Buffer.from('|END', 'utf8')]))
    after.end()
    expect(afterOutput.read(pending.cursor).text).toBe('中\uFFFD|END')
  })

  it('reassembles a live split after multiple bounded pages and reaches EOF', () => {
    const head = `START|${'A'.repeat(20_000)}`
    const char = Buffer.from('中', 'utf8')
    const reader = createScriptedLiveOutputReader(Buffer.concat([Buffer.from(head, 'utf8'), char.subarray(0, 1)]))
    const output = new ManagedOutput('proc_live_pages', { stdout: reader }, () => reader.complete)
    const before = drain(output)
    expect(before.text).toBe(head)
    expect(before.pages).toBeGreaterThan(1)
    expect(before.text).not.toContain('\uFFFD')
    reader.append(Buffer.concat([char.subarray(1), Buffer.from('|END', 'utf8')]))
    reader.end()
    const after = drain(output, before.cursor)
    expect(before.text + after.text).toBe(`${head}中|END`)
    expect(after.endedEmpty).toBe(true)
  })

  it('reassembles a live split on stderr without breaking the stream marker', () => {
    const char = Buffer.from('中', 'utf8')
    const stdout = createScriptedOutputReader('OUT')
    const stderr = createScriptedLiveOutputReader(Buffer.concat([Buffer.from('ERR|', 'utf8'), char.subarray(0, 1)]))
    const output = new ManagedOutput('proc_live_stderr', { stdout, stderr }, () => stderr.complete)
    const first = output.read()
    expect(first.text).toBe('OUT[stderr]\nERR|')
    stderr.append(Buffer.concat([char.subarray(1), Buffer.from('|END', 'utf8')]))
    stderr.end()
    const rest = drain(output, first.cursor)
    expect(first.text + rest.text).toBe('OUT[stderr]\nERR|中|END')
    expect((first.text + rest.text).match(/\[stderr\]/g)).toHaveLength(1)
  })

  it('rejects a foreign, malformed or path-shaped cursor instead of reading anything', () => {
    const first = new ManagedOutput('proc_a', { stdout: createScriptedOutputReader('hello') })
    const page = first.read()
    const other = new ManagedOutput('proc_b', { stdout: createScriptedOutputReader('hello') })
    for (const cursor of [page.cursor, 'nxshell1.%%%', 'not-a-cursor', '../../etc/passwd']) {
      expect(() => other.read(cursor)).toThrow(NexusError)
      expect(() => other.read(cursor)).toThrowError(/does not belong/)
    }
  })

  it('always makes progress with a one-byte limit and clamps an oversized limit', () => {
    const output = new ManagedOutput('proc_limits', { stdout: createScriptedOutputReader('中a'.repeat(20)) })
    const first = output.read(undefined, 1)
    expect(first.text).toBe('中')
    const rest = readAllFrom(output, first.cursor)
    expect(first.text + rest).toBe('中a'.repeat(20))

    const large = new ManagedOutput('proc_large', { stdout: createScriptedOutputReader('z'.repeat(20_000)) })
    expect(Buffer.byteLength(large.read(undefined, 1_000_000).text, 'utf8')).toBeLessThanOrEqual(16 * 1024)
    expect(() => output.read(undefined, 0)).toThrow(NexusError)
    expect(() => output.read(undefined, Number.NaN)).toThrow(NexusError)
  })
})

/** Drain every currently available page, treating empty as no-more-now, not EOF. */
function drain(
  output: ManagedOutput,
  cursor?: string,
): { text: string; cursor: string; pages: number; endedEmpty: boolean } {
  let text = ''
  let next = cursor
  let pages = 0
  for (; pages < 8; pages += 1) {
    const page = output.read(next)
    next = page.cursor
    text += page.text
    if (page.text.length === 0) return { text, cursor: next, pages: pages + 1, endedEmpty: true }
  }
  return { text, cursor: next ?? '', pages, endedEmpty: false }
}

/** Continue reading from a known cursor until empty. */
function readAllFrom(output: ManagedOutput, cursor: string): string {
  let text = ''
  let next = cursor
  for (let index = 0; index < 32; index += 1) {
    const page = output.read(next)
    next = page.cursor
    text += page.text
    if (page.text.length === 0) break
  }
  return text
}
