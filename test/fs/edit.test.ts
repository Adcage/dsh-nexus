/**
 * The `edit` tool: one planning pass over one original, one atomic publication.
 *
 * The bytes come from the shipped host backend on a project-local root, so BOM,
 * CRLF and mixed line endings are observed rather than simulated. Every refusal
 * case also asserts the original bytes and that no publication reached the
 * backend. Encoding cases observe the target through a separate probe tool: a
 * prior observation is exactly what another tool would produce, and the edit
 * tool's own internal reread must never grant it.
 *
 * @module dsh-nexus/test/fs/edit
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { planEdits } from '../../src/fs/edit.ts'
import { createFsTools } from '../../src/fs/read.ts'
import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import { createToolHarness, type ToolHarness } from '../support/harness.ts'

/** Project-local cache directory; no test state leaves the checkout. */
const CACHE_DIR = fileURLToPath(new URL('../../node_modules/.cache/dsh-nexus-test/', import.meta.url))

/** Harnesses and roots a case owns, disposed after it. */
const open: { harness: ToolHarness; root: string }[] = []

afterEach(async () => {
  for (const entry of open.splice(0)) {
    await entry.harness.dispose()
    await rm(entry.root, { recursive: true, force: true })
  }
})

/**
 * Seed exact bytes and mount the Nexus file tools plus an external-observer probe.
 * @param files - paths relative to the root and their exact bytes.
 * @returns the harness, its root and a helper that reads one file's bytes back.
 */
async function openEditor(files: Readonly<Record<string, Uint8Array | string>>): Promise<{
  harness: ToolHarness
  root: string
  bytesOf: (path: string) => Promise<Uint8Array>
  pathOf: (path: string) => string
}> {
  await mkdir(CACHE_DIR, { recursive: true })
  const root = await mkdtemp(join(CACHE_DIR, 'fs-edit-'))
  for (const [path, data] of Object.entries(files)) {
    const absolute = join(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
  }
  const harness = await createToolHarness({ cwd: root, localFs: { root } })
  open.push({ harness, root })
  for (const tool of createFsTools(harness.ctx, () => DEFAULT_SETTINGS)) harness.ctx.tools.register(tool)
  harness.ctx.tools.register(
    defineTool({
      name: 'probe_observe',
      description: 'Records an authoritative filesystem observation for another tool.',
      parameters: { path: { type: 'string', required: true } },
      output: {
        schema: { type: 'json' },
        render: () => [{ type: 'text', text: 'observed' }],
      },
      async execute(args, exec) {
        const target = await harness.ctx.fs.resolve(args.path, { cwd: root })
        const info = await harness.ctx.fs.stat(target, exec.signal)
        harness.ctx.emit(
          'fs/observed',
          target,
          info === undefined ? { kind: 'absent' } : { kind: 'present', version: info.version },
          exec,
        )
        return {}
      },
    }),
  )
  return {
    harness,
    root,
    bytesOf: async (path) => new Uint8Array(await readFile(join(root, path))),
    pathOf: (path) => join(root, path),
  }
}

/** A UTF-8 BOM. */
const BOM = Uint8Array.from([0xef, 0xbb, 0xbf])

/**
 * @param parts - byte arrays to concatenate.
 * @returns one byte array.
 */
function concat(...parts: readonly Uint8Array[]): Uint8Array {
  return Uint8Array.from(Buffer.concat(parts.map((part) => Buffer.from(part))))
}

/**
 * Assert exact file bytes without depending on Buffer's extra enumerable fields.
 * @param actual - bytes read back from the file.
 * @param expected - expected bytes.
 */
function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(Buffer.from(actual).toString('hex')).toBe(Buffer.from(expected).toString('hex'))
}

describe('planEdits', () => {
  it('returns the final text and the raw match ranges from one original', () => {
    const plan = planEdits(Buffer.from('alpha\nbeta\n', 'utf8'), [
      { oldText: 'alpha', newText: 'A' },
      { oldText: 'beta', newText: 'B' },
    ])
    expect(plan.text).toBe('A\nB\n')
    expect(plan.matches).toEqual([
      { editIndex: 0, start: 0, end: 5 },
      { editIndex: 1, start: 6, end: 10 },
    ])
  })

  it('keeps a BOM and restores each replaced region to its own line-ending style', () => {
    const original = concat(BOM, Buffer.from('alpha\r\nbeta\n', 'utf8'))
    const plan = planEdits(original, [
      { oldText: 'alpha', newText: 'A' },
      { oldText: 'beta', newText: 'B1\nB2' },
    ])
    expect(plan.text).toBe('\uFEFFA\r\nB1\nB2\n')
    expectBytes(Buffer.from(plan.text, 'utf8'), concat(BOM, Buffer.from('A\r\nB1\nB2\n', 'utf8')))
  })

  it('rejects an old text that only exists after an earlier replacement', () => {
    expect(() =>
      planEdits(Buffer.from('alpha\n', 'utf8'), [
        { oldText: 'alpha', newText: 'beta' },
        { oldText: 'beta', newText: 'gamma' },
      ]),
    ).toThrowError(expect.objectContaining({ name: 'FsError', code: 'FS_EDIT_NOT_FOUND' }))
  })
})

describe('edit preflight', () => {
  it('rejects the entire multi-edit when a later match is missing', async () => {
    const { harness, bytesOf, pathOf } = await openEditor({ 'a.txt': 'alpha\nbeta\n' })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [
        { oldText: 'alpha', newText: 'A' },
        { oldText: 'missing', newText: 'B' },
      ],
    })

    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'FsError', code: 'FS_EDIT_NOT_FOUND' })
    expect(await readFile(pathOf('a.txt'), 'utf8')).toBe('alpha\nbeta\n')
    expectBytes(await bytesOf('a.txt'), Buffer.from('alpha\nbeta\n', 'utf8'))
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('rejects an ambiguous old text', async () => {
    const { harness, pathOf } = await openEditor({ 'a.txt': 'alpha\nalpha\n' })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [{ oldText: 'alpha', newText: 'A' }],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'NexusError', code: 'AMBIGUOUS_EDIT' })
    expect(await readFile(pathOf('a.txt'), 'utf8')).toBe('alpha\nalpha\n')
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('rejects overlapping match ranges', async () => {
    const { harness, pathOf } = await openEditor({ 'a.txt': 'alpha beta\n' })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [
        { oldText: 'alpha beta', newText: 'x' },
        { oldText: 'beta', newText: 'y' },
      ],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'NexusError', code: 'OVERLAPPING_EDITS' })
    expect(await readFile(pathOf('a.txt'), 'utf8')).toBe('alpha beta\n')
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('rejects a later old text generated by an earlier replacement', async () => {
    const { harness, pathOf } = await openEditor({ 'a.txt': 'alpha\n' })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [
        { oldText: 'alpha', newText: 'beta' },
        { oldText: 'beta', newText: 'gamma' },
      ],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_EDIT_NOT_FOUND')
    expect(await readFile(pathOf('a.txt'), 'utf8')).toBe('alpha\n')
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('rejects more edits than the contract accepts', async () => {
    const { harness, pathOf } = await openEditor({ 'a.txt': 'alpha\n' })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: Array.from({ length: 65 }, () => ({ oldText: 'alpha', newText: 'A' })),
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('INVALID_ARGUMENT')
    expect(await readFile(pathOf('a.txt'), 'utf8')).toBe('alpha\n')
    expect(harness.localFs?.writes).toHaveLength(0)
  })
})

describe('edit observation and change guards', () => {
  it('requires a prior observation before editing', async () => {
    const { harness, pathOf } = await openEditor({ 'a.txt': 'alpha\n' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [{ oldText: 'alpha', newText: 'A' }],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'NexusError', code: 'NOT_OBSERVED' })
    expect(await readFile(pathOf('a.txt'), 'utf8')).toBe('alpha\n')
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('rejects an external change that happened after the observed read', async () => {
    const { harness, pathOf } = await openEditor({ 'a.txt': 'alpha\n' })
    await harness.call('read', { path: 'a.txt' })
    await writeFile(pathOf('a.txt'), Buffer.from('changed elsewhere\n', 'utf8'))

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [{ oldText: 'alpha', newText: 'A' }],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'NexusError', code: 'FILE_CHANGED' })
    expect(await readFile(pathOf('a.txt'), 'utf8')).toBe('changed elsewhere\n')
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('rejects a malformed UTF-8 file without converting it', async () => {
    const invalid = Uint8Array.from([0x61, 0xff, 0x62])
    const { harness, bytesOf } = await openEditor({ 'bad.txt': invalid })
    await harness.call('probe_observe', { path: 'bad.txt' })

    const result = await harness.call('edit', {
      path: 'bad.txt',
      edits: [{ oldText: 'a', newText: 'b' }],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'NexusError', code: 'UNSUPPORTED_ENCODING' })
    expectBytes(await bytesOf('bad.txt'), invalid)
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('rejects a UTF-16 file without converting it', async () => {
    const utf16 = Uint8Array.from(Buffer.from('\uFEFFalpha\n', 'utf16le'))
    const { harness, bytesOf } = await openEditor({ 'wide.txt': utf16 })
    await harness.call('probe_observe', { path: 'wide.txt' })

    const result = await harness.call('edit', {
      path: 'wide.txt',
      edits: [{ oldText: 'alpha', newText: 'A' }],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'NexusError', code: 'UNSUPPORTED_ENCODING' })
    expectBytes(await bytesOf('wide.txt'), utf16)
    expect(harness.localFs?.writes).toHaveLength(0)
  })
})

describe('edit publication', () => {
  it('applies two edits in one publication', async () => {
    const { harness, pathOf } = await openEditor({ 'a.txt': 'alpha\nbeta\n' })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [
        { oldText: 'alpha', newText: 'A' },
        { oldText: 'beta', newText: 'B' },
      ],
    })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ path: expect.stringContaining('a.txt'), applied: 2 })
    expect(await readFile(pathOf('a.txt'), 'utf8')).toBe('A\nB\n')
    expect(harness.localFs?.writes).toHaveLength(1)
  })

  it('preserves a BOM, CRLF and untouched mixed line endings byte for byte', async () => {
    const original = concat(BOM, Buffer.from('alpha\r\nbeta\nkeep\r\n', 'utf8'))
    const { harness, bytesOf, pathOf } = await openEditor({ 'a.txt': original })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [
        { oldText: 'alpha', newText: 'A' },
        { oldText: 'beta', newText: 'B' },
      ],
    })
    expect(result.isError).toBe(false)
    expect(await bytesOf('a.txt')).toEqual(concat(BOM, Buffer.from('A\r\nB\nkeep\r\n', 'utf8')))
    expect(harness.localFs?.writes).toHaveLength(1)
    expect(pathOf('a.txt').length).toBeGreaterThan(0)
  })

  it('restores new lines in a replacement to the matched region style', async () => {
    const { harness, bytesOf } = await openEditor({ 'a.txt': 'one\r\ntwo\r\n' })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [{ oldText: 'two', newText: 'T1\nT2' }],
    })
    expect(result.isError).toBe(false)
    expectBytes(await bytesOf('a.txt'), Buffer.from('one\r\nT1\r\nT2\r\n', 'utf8'))
  })

  it('leaves LF regions alone while editing a CRLF file', async () => {
    const { harness, bytesOf } = await openEditor({ 'a.txt': 'a\r\nb\nc\r\n' })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [{ oldText: 'b', newText: 'B' }],
    })
    expect(result.isError).toBe(false)
    expectBytes(await bytesOf('a.txt'), Buffer.from('a\r\nB\nc\r\n', 'utf8'))
  })

  it('keeps the original bytes when atomic publication fails', async () => {
    const { harness, bytesOf } = await openEditor({ 'a.txt': 'alpha\n' })
    await harness.call('read', { path: 'a.txt' })
    harness.localFs!.failNextWrite = true

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [{ oldText: 'alpha', newText: 'A' }],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'FsError', code: 'FS_IO_ERROR' })
    expectBytes(await bytesOf('a.txt'), Buffer.from('alpha\n', 'utf8'))
    expect(harness.localFs?.writes).toHaveLength(1)
  })
})
