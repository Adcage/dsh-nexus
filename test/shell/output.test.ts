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

  it('reports a lossy retained window and the spill availability once, then keeps the loss truthful', () => {
    const output = new ManagedOutput('proc_loss', {
      stdout: createScriptedOutputReader('x'.repeat(4096), { memoryBytes: 1024, spillPath: 'C:/tmp/nexus.spill' }),
    })
    const first = output.read()
    expect(first.lossy).toBe(true)
    expect(first.spillAvailable).toBe(true)
    expect(first.text).toBe('x'.repeat(1024))
    const second = output.read(first.cursor)
    expect(second.text).toBe('')
    expect(second.lossy).toBe(true)
    expect(second.spillAvailable).toBe(true)
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
