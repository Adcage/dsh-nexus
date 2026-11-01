/**
 * The unified `read` tool: bounded text windows and real image blocks.
 *
 * Everything runs over the shipped host filesystem backend on a project-local
 * temporary root, so text pagination, byte caps, BOM handling and image bytes
 * are the backend's real behaviour rather than a text-only double's convention.
 * Image reads go through the real `llm` registry (route capability) and a
 * controlled `AttachmentStore` (durable storage), because those are the two
 * external capabilities the tool contract depends on.
 *
 * @module dsh-nexus/test/fs/read
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createFsTools } from '../../src/fs/read.ts'
import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import type { RuntimeSettings } from '../../src/protocol.ts'
import { createToolHarness, type ToolHarness } from '../support/harness.ts'

/** Project-local cache directory; no test state leaves the checkout. */
const CACHE_DIR = fileURLToPath(new URL('../../node_modules/.cache/dsh-nexus-test/', import.meta.url))

/** One 1x1 PNG used by the image cases. */
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

/** Harnesses and roots a case owns, disposed after it. */
const open: { harness: ToolHarness; root: string }[] = []

afterEach(async () => {
  for (const entry of open.splice(0)) {
    await entry.harness.dispose()
    await rm(entry.root, { recursive: true, force: true })
  }
})

/**
 * Seed files under a fresh root and mount the Nexus read tools over it.
 * @param files - paths (relative to the root) and their exact bytes.
 * @param options - model route, attachments and read settings.
 * @returns the harness, its root and the read tool result helper.
 */
async function openReader(
  files: Readonly<Record<string, Uint8Array | string>>,
  options: {
    readonly model?: { readonly provider: string; readonly model: string; readonly inputModalities?: readonly ('text' | 'image')[] }
    readonly attachments?: { readonly imageLimits?: Record<string, unknown> } | false
    readonly settings?: RuntimeSettings
  } = {},
): Promise<{ harness: ToolHarness; root: string }> {
  await mkdir(CACHE_DIR, { recursive: true })
  const root = await mkdtemp(join(CACHE_DIR, 'fs-read-'))
  for (const [path, data] of Object.entries(files)) {
    const absolute = join(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
  }
  const harness = await createToolHarness({
    cwd: root,
    localFs: { root },
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.attachments === false || options.attachments === undefined
      ? {}
      : { attachments: options.attachments }),
  })
  open.push({ harness, root })
  const tools = createFsTools(harness.ctx, () => options.settings ?? DEFAULT_SETTINGS)
  for (const tool of tools) harness.ctx.tools.register(tool)
  return { harness, root }
}

describe('read text windows', () => {
  it('pages a long file and reports an accurate next offset', async () => {
    const { harness } = await openReader({ 'notes.txt': 'l1\nl2\nl3\nl4\nl5\nl6\n' })

    const first = await harness.call('read', { path: 'notes.txt', limit: 2 })
    expect(first.isError).toBe(false)
    expect(first.value).toMatchObject({
      kind: 'text',
      offset: 1,
      lines: [
        { number: 1, text: 'l1' },
        { number: 2, text: 'l2' },
      ],
      totalLines: 6,
      nextOffset: 3,
      truncated: true,
    })
    expect(first.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('(Showing lines 1-2 of 6. Use offset=3 to continue.)'),
      },
    ])

    const middle = await harness.call('read', { path: 'notes.txt', offset: 3, limit: 2 })
    expect(middle.value).toMatchObject({
      offset: 3,
      lines: [
        { number: 3, text: 'l3' },
        { number: 4, text: 'l4' },
      ],
      nextOffset: 5,
      truncated: true,
    })

    const last = await harness.call('read', { path: 'notes.txt', offset: 5, limit: 2 })
    expect(last.value).toMatchObject({
      offset: 5,
      lines: [
        { number: 5, text: 'l5' },
        { number: 6, text: 'l6' },
      ],
      nextOffset: null,
      truncated: false,
    })
    expect(last.content).toEqual([
      { type: 'text', text: expect.stringContaining('(End of file - total 6 lines)') },
    ])
  })

  it('defaults to the settings line count', async () => {
    const { harness } = await openReader(
      { 'many.txt': 'a\nb\nc\nd\n' },
      { settings: { ...DEFAULT_SETTINGS, files: { defaultLines: 2, maxOutputBytes: 1024 } } },
    )

    const defaulted = await harness.call('read', { path: 'many.txt' })
    expect(defaulted.value).toMatchObject({
      limit: 2,
      lines: [
        { number: 1, text: 'a' },
        { number: 2, text: 'b' },
      ],
      totalLines: 4,
      truncated: true,
      nextOffset: 3,
    })
  })

  it('stops at the output byte cap and reports the continuation offset', async () => {
    const { harness } = await openReader(
      { 'wide.txt': `${'a'.repeat(10)}\n${'b'.repeat(10)}\n${'c'.repeat(10)}\n` },
      { settings: { ...DEFAULT_SETTINGS, files: { defaultLines: 5, maxOutputBytes: 21 } } },
    )

    const capped = await harness.call('read', { path: 'wide.txt' })
    expect(capped.value).toMatchObject({
      limit: 5,
      lines: [
        { number: 1, text: 'a'.repeat(10) },
        { number: 2, text: 'b'.repeat(10) },
      ],
      totalLines: 3,
      truncated: true,
      nextOffset: 3,
    })
  })

  it('truncates one huge line visibly without buffering the whole file', async () => {
    const { harness } = await openReader({ 'huge-line.txt': `${'x'.repeat(5_000)}\nshort\n` })
    const result = await harness.call('read', { path: 'huge-line.txt', limit: 1 })

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({
      lines: [{ number: 1, text: expect.stringContaining('(line truncated to 2000 chars)') }],
      totalLines: 2,
      nextOffset: 2,
    })
    const line = (result.value as { lines: { text: string }[] }).lines[0]
    expect(line?.text.startsWith('x'.repeat(2_000))).toBe(true)
  })

  it('rejects an offset past the end of the file as not found', async () => {
    const { harness } = await openReader({ 'short.txt': 'only\n' })
    const result = await harness.call('read', { path: 'short.txt', offset: 2 })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_NOT_FOUND')
  })

  it('reports a missing path as not found and records the absence', async () => {
    const { harness } = await openReader({})
    const result = await harness.call('read', { path: 'missing.txt' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_NOT_FOUND')
  })

  it('reads Windows absolute and relative paths containing CJK characters and spaces', async () => {
    const { harness, root } = await openReader({ '中文 目录/说明 文件.txt': '你好\n世界\n' })

    const relative = await harness.call('read', { path: '中文 目录/说明 文件.txt' })
    expect(relative.isError).toBe(false)
    expect(relative.value).toMatchObject({ kind: 'text', totalLines: 2 })
    expect((relative.value as { path: string }).path).toContain('说明 文件.txt')

    const absolute = await harness.call('read', {
      path: join(root, '中文 目录', '说明 文件.txt'),
    })
    expect(absolute.isError).toBe(false)
    expect(absolute.value).toMatchObject({ kind: 'text', totalLines: 2 })
  })
})

describe('read images', () => {
  it('returns a real image block for an image-capable model', async () => {
    const { harness } = await openReader(
      { 'pic.png': PNG_1X1 },
      {
        model: { provider: 'nexus-test', model: 'vision', inputModalities: ['text', 'image'] },
        attachments: {},
      },
    )

    const result = await harness.call('read', { path: 'pic.png' })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({
      kind: 'image',
      image: { attachmentId: 'attachment-1', mediaType: 'image/png', bytes: PNG_1X1.byteLength, width: 1, height: 1 },
    })
    expect(harness.attachments?.saves).toHaveLength(1)
    expect(harness.attachments?.saves[0]?.data).toEqual(PNG_1X1)
    expect(harness.attachments?.saves[0]?.name).toBe('pic.png')

    const block = result.content.find((part) => part.type === 'image')
    expect(block).toMatchObject({
      type: 'image',
      attachment: { attachmentId: 'attachment-1', mediaType: 'image/png', width: 1, height: 1 },
    })
    const text = result.content.find((part) => part.type === 'text')
    expect(text).toMatchObject({ type: 'text' })
    expect(text?.type === 'text' ? text.text : '').toContain('image/png image, 1x1 px')
  })

  it('refuses an image when the model route declares no image input', async () => {
    const { harness } = await openReader(
      { 'pic.png': PNG_1X1 },
      {
        model: { provider: 'nexus-test', model: 'text-only', inputModalities: ['text'] },
        attachments: {},
      },
    )

    const result = await harness.call('read', { path: 'pic.png' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('UNSUPPORTED_CAPABILITY')
    expect(result.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('does not declare image input'),
      },
    ])
    expect(harness.attachments?.saves).toHaveLength(0)
  })

  it('refuses an image when the calling route cannot be resolved', async () => {
    const { harness } = await openReader({ 'pic.png': PNG_1X1 }, { attachments: {} })
    const result = await harness.call('read', { path: 'pic.png' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('UNSUPPORTED_CAPABILITY')
    expect(harness.attachments?.saves).toHaveLength(0)
  })

  it('refuses an image when no attachment service is mounted', async () => {
    const { harness } = await openReader(
      { 'pic.png': PNG_1X1 },
      { model: { provider: 'nexus-test', model: 'vision', inputModalities: ['text', 'image'] } },
    )
    const result = await harness.call('read', { path: 'pic.png' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('UNSUPPORTED_CAPABILITY')
  })

  it('reports an unreadable image format instead of returning a path as success', async () => {
    const { harness } = await openReader(
      { 'broken.png': 'not really a png' },
      {
        model: { provider: 'nexus-test', model: 'vision', inputModalities: ['text', 'image'] },
        attachments: {},
      },
    )

    const result = await harness.call('read', { path: 'broken.png' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('UNSUPPORTED_CAPABILITY')
    expect(harness.attachments?.saves).toHaveLength(0)
  })

  it('refuses an image extension the deployment cannot read', async () => {
    const { harness } = await openReader(
      { 'photo.bmp': 'BM fake bitmap bytes' },
      {
        model: { provider: 'nexus-test', model: 'vision', inputModalities: ['text', 'image'] },
        attachments: {},
      },
    )

    const result = await harness.call('read', { path: 'photo.bmp' })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('UNSUPPORTED_CAPABILITY')
    expect(harness.attachments?.saves).toHaveLength(0)
  })

  it('recognizes an extensionless image by its signature', async () => {
    const { harness } = await openReader(
      { 'screenshot': PNG_1X1 },
      {
        model: { provider: 'nexus-test', model: 'vision', inputModalities: ['text', 'image'] },
        attachments: {},
      },
    )

    const result = await harness.call('read', { path: 'screenshot' })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ kind: 'image', image: { mediaType: 'image/png' } })
  })
})
