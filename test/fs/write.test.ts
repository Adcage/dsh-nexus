/**
 * The `write` tool: read-before-overwrite, guarded creation and one atomic
 * publication through the mounted filesystem backend.
 *
 * The backend is the shipped host implementation on a project-local root, so
 * create-if-absent, version staleness and parent-directory behaviour are the
 * real backend's, not a double's. `CountingLocalFileSystem` only counts
 * publications and can race one create.
 *
 * @module dsh-nexus/test/fs/write
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createFsTools } from '../../src/fs/read.ts'
import { DEFAULT_SETTINGS, FILE_EDIT_MAX_INPUT_BYTES } from '../../src/runtime/defaults.ts'
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
 * Seed files and mount the Nexus file tools over a fresh real root.
 * @param files - paths relative to the root and their initial text.
 * @returns the harness, its root and the path helper.
 */
async function openWriter(files: Readonly<Record<string, string>> = {}): Promise<{
  harness: ToolHarness
  root: string
  pathOf: (path: string) => string
}> {
  await mkdir(CACHE_DIR, { recursive: true })
  const root = await mkdtemp(join(CACHE_DIR, 'fs-write-'))
  for (const [path, text] of Object.entries(files)) {
    const absolute = join(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, Buffer.from(text, 'utf8'))
  }
  const harness = await createToolHarness({ cwd: root, localFs: { root } })
  open.push({ harness, root })
  for (const tool of createFsTools(harness.ctx, () => DEFAULT_SETTINGS)) harness.ctx.tools.register(tool)
  return { harness, root, pathOf: (path) => join(root, path) }
}

describe('write guarded creation', () => {
  it('creates a new file after the missing path was read', async () => {
    const { harness, root, pathOf } = await openWriter()
    const read = await harness.call('read', { path: 'created.txt' })
    expect(read.isError).toBe(true)
    expect(read.error?.info?.code).toBe('FS_NOT_FOUND')

    const result = await harness.call('write', { path: 'created.txt', content: 'hello\n' })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ operation: 'create', path: expect.stringContaining('created.txt') })
    expect(await readFile(pathOf('created.txt'), 'utf8')).toBe('hello\n')
    expect(harness.localFs?.writes).toHaveLength(1)
    expect(root.length).toBeGreaterThan(0)
  })

  it('rejects overwriting an existing file that was never read', async () => {
    const { harness, pathOf } = await openWriter({ 'existing.txt': 'original\n' })
    const result = await harness.call('write', { path: 'existing.txt', content: 'replaced\n' })

    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'NexusError', code: 'NOT_OBSERVED' })
    expect(await readFile(pathOf('existing.txt'), 'utf8')).toBe('original\n')
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('replaces an existing file after reading it', async () => {
    const { harness, pathOf } = await openWriter({ 'existing.txt': 'original\n' })
    const read = await harness.call('read', { path: 'existing.txt' })
    expect(read.isError).toBe(false)

    const result = await harness.call('write', { path: 'existing.txt', content: 'replaced\n' })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ operation: 'update' })
    expect(await readFile(pathOf('existing.txt'), 'utf8')).toBe('replaced\n')
    expect(harness.localFs?.writes).toHaveLength(1)
  })

  it('loses a creation race without clobbering the other creator', async () => {
    const { harness, pathOf } = await openWriter()
    const racer = join(pathOf('raced.txt'))
    harness.localFs!.beforeWrite = async () => {
      harness.localFs!.beforeWrite = undefined
      await writeFile(racer, Buffer.from('racer content', 'utf8'))
    }

    const result = await harness.call('write', { path: 'raced.txt', content: 'mine' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_NOT_OBSERVED')
    expect(await readFile(racer, 'utf8')).toBe('racer content')
    // The attempt reached the backend, which refused it atomically.
    expect(harness.localFs?.writes).toHaveLength(1)
  })

  it('creates missing parent directories like the shipped backend', async () => {
    const { harness, pathOf } = await openWriter()
    const result = await harness.call('write', { path: 'nested/deep/file.txt', content: 'nested\n' })
    expect(result.isError).toBe(false)
    expect(await readFile(pathOf('nested/deep/file.txt'), 'utf8')).toBe('nested\n')
  })

  it('accepts content exactly at the mutation input byte limit', async () => {
    const { harness, pathOf } = await openWriter()
    const content = 'x'.repeat(FILE_EDIT_MAX_INPUT_BYTES)
    const result = await harness.call('write', { path: 'limit.txt', content })
    expect(result.isError).toBe(false)
    expect((await stat(pathOf('limit.txt'))).size).toBe(FILE_EDIT_MAX_INPUT_BYTES)
    expect(harness.localFs?.writes).toHaveLength(1)
  })

  it('rejects content over the mutation input byte limit before writing', async () => {
    const { harness, pathOf } = await openWriter()
    const result = await harness.call('write', {
      path: 'too-big.txt',
      content: 'x'.repeat(FILE_EDIT_MAX_INPUT_BYTES + 1),
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'NexusError', code: 'INVALID_ARGUMENT' })
    expect(harness.localFs?.writes).toHaveLength(0)
    await expect(stat(pathOf('too-big.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes UTF-8 to a Windows-style path with CJK characters and spaces', async () => {
    const { harness, root, pathOf } = await openWriter()
    const relative = '项目 目录/新 文件.txt'
    const result = await harness.call('write', { path: relative, content: '内容\n' })
    expect(result.isError).toBe(false)
    expect(await readFile(pathOf(relative), 'utf8')).toBe('内容\n')

    const absolute = join(root, '项目 目录', '另一个 文件.txt')
    const absoluteResult = await harness.call('write', { path: absolute, content: '绝对路径\n' })
    expect(absoluteResult.isError).toBe(false)
    expect(await readFile(absolute, 'utf8')).toBe('绝对路径\n')
  })
})
