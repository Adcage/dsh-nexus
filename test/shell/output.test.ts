/**
 * Bounded, resumable output pages over the native collect-mode readers.
 *
 * @module dsh-nexus/test/shell/output
 */

import { describe, expect, it } from 'vitest'
import { NexusError } from '../../src/runtime/errors.ts'
import { ManagedOutput } from '../../src/shell/output.ts'
import { createScriptedOutputReader } from '../support/fixtures.ts'

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
