/**
 * The contract fidelity of the doubles in `fixtures.ts`.
 *
 * A double that quietly disagrees with the shipped service does not just weaken
 * a test, it inverts the verdict: a correct tool is reported as broken, or a
 * broken one passes. These cases pin the two places that are easy to get wrong —
 * absolute paths versus `opts.cwd`, and the error code a guarded write reports
 * when the target is gone — to the wording of the shipped `FileSystem` contract
 * (`@deepseek-ai/dsh-fs`): "relative paths resolve against `opts.cwd`", and
 * "`replaceIfVersion` rejects absence or mismatch with `FS_STALE_VERSION`".
 *
 * @module dsh-nexus/test/support/fixtures
 */

import { Context } from '@deepseek-ai/cordis'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import { afterEach, describe, expect, it } from 'vitest'
import { FsDouble } from './fixtures.ts'

/** Contexts created by a case, disposed after it. */
const contexts: Context[] = []

/**
 * Mount a fresh filesystem double.
 * @param files - seed files keyed by path.
 * @returns the mounted double.
 */
async function createFs(files: Readonly<Record<string, string>> = {}): Promise<FsDouble> {
  const ctx = new Context()
  contexts.push(ctx)
  let mounted: FsDouble | undefined
  await ctx.plugin((pluginCtx) => {
    mounted = new FsDouble(pluginCtx, { files })
  })
  if (mounted === undefined) throw new Error('the filesystem double did not mount')
  return mounted
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('FsDouble.resolve', () => {
  it('resolves an ordinary relative path against the cwd', async () => {
    const fs = await createFs()
    const target = await fs.resolve('notes/todo.txt', { cwd: '/workspace' })
    expect(target.displayPath).toBe('/workspace/notes/todo.txt')
  })

  it('resolves a relative path against a cwd that already contains a drive letter', async () => {
    const fs = await createFs()
    const target = await fs.resolve('notes/todo.txt', { cwd: 'E:\\work dir' })
    expect(target.displayPath).toBe('E:/work dir/notes/todo.txt')
  })

  it('leaves a POSIX absolute path untouched by the cwd', async () => {
    const fs = await createFs()
    const target = await fs.resolve('/etc/hosts', { cwd: '/workspace' })
    expect(target.displayPath).toBe('/etc/hosts')
  })

  it('leaves a Windows drive path untouched by the cwd', async () => {
    const fs = await createFs()
    const target = await fs.resolve('E:\\项目\\有 空格.txt', { cwd: '/workspace' })
    expect(target.displayPath).toBe('E:/项目/有 空格.txt')
  })

  it('leaves a forward-slash Windows drive path untouched by the cwd', async () => {
    const fs = await createFs()
    const target = await fs.resolve('C:/temp/file.txt', { cwd: '/workspace' })
    expect(target.displayPath).toBe('C:/temp/file.txt')
  })
})

describe('FsDouble guarded writes', () => {
  it('rejects a guarded create when the target already exists', async () => {
    const fs = await createFs({ '/workspace/a.txt': 'first' })
    const target = await fs.resolve('/workspace/a.txt')
    await expect(fs.writeText(target, 'second', { kind: 'createIfAbsent' })).rejects.toMatchObject({
      code: 'FS_NOT_OBSERVED',
    })
    expect(fs.read('/workspace/a.txt')).toBe('first')
  })

  it('rejects a versioned replace of an absent target as a stale version', async () => {
    const fs = await createFs()
    const target = await fs.resolve('/workspace/missing.txt')
    await expect(
      fs.writeText(target, 'content', { kind: 'replaceIfVersion', version: FsVersion('v0') }),
    ).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(fs.has('/workspace/missing.txt')).toBe(false)
  })

  it('rejects a versioned replace after the file changed', async () => {
    const fs = await createFs({ '/workspace/a.txt': 'first' })
    const target = await fs.resolve('/workspace/a.txt')
    const observed = await fs.writeText(target, 'second')
    await fs.writeText(target, 'third')
    await expect(
      fs.writeText(target, 'fourth', { kind: 'replaceIfVersion', version: observed.version }),
    ).rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(fs.read('/workspace/a.txt')).toBe('third')
  })
})
