/**
 * The observation policy binding shared by the Nexus file tools.
 *
 * The gate is the same prior-observation record the shipped policy plugin
 * keeps, expressed with Nexus error codes. These cases pin the two boundaries
 * that matter: a caller with no agent is refused before anything happens, and
 * a decider that was registered before the Nexus gate keeps its own native
 * error identity instead of being replaced by Nexus wording.
 *
 * @module dsh-nexus/test/fs/policy
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { FsError } from '@deepseek-ai/dsh-fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
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
 * Mount the Nexus file tools over a fresh real root.
 * @param files - paths relative to the root and their initial text.
 * @returns the harness and its root.
 */
async function openPolicyHarness(
  files: Readonly<Record<string, string>> = {},
  install?: (harness: ToolHarness) => void,
): Promise<{
  harness: ToolHarness
  root: string
}> {
  await mkdir(CACHE_DIR, { recursive: true })
  const root = await mkdtemp(join(CACHE_DIR, 'fs-policy-'))
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, path), Buffer.from(text, 'utf8'))
  const harness = await createToolHarness({ cwd: root, localFs: { root } })
  open.push({ harness, root })
  install?.(harness)
  for (const tool of createFsTools(harness.ctx, () => DEFAULT_SETTINGS)) harness.ctx.tools.register(tool)
  return { harness, root }
}

describe('Nexus observation gate', () => {
  it('refuses an agentless run before touching a file', async () => {
    const { harness, root } = await openPolicyHarness({ 'a.txt': 'alpha\n' })

    const result = await harness.ctx.tools.execute({
      callId: ToolCallId('agentless-write'),
      name: 'write',
      arguments: { path: 'a.txt', content: 'overwritten' },
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'NexusError', code: 'NO_AGENT' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('alpha\n')
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('keeps an earlier native decider error unchanged', async () => {
    const { harness, root } = await openPolicyHarness({ 'a.txt': 'alpha\n' }, (mounted) => {
      mounted.ctx.on('fs/edit-intent', () => {
        throw new FsError('the deployment policy says read it first', 'FS_NOT_OBSERVED')
      })
    })
    await harness.call('read', { path: 'a.txt' })

    const result = await harness.call('edit', {
      path: 'a.txt',
      edits: [{ oldText: 'alpha', newText: 'A' }],
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'FsError', code: 'FS_NOT_OBSERVED' })
    expect(result.error?.message).toContain('the deployment policy says read it first')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('alpha\n')
    expect(harness.localFs?.writes).toHaveLength(0)
  })

  it('leaves a native stale-version rejection to the backend for a write', async () => {
    const { harness, root } = await openPolicyHarness({ 'a.txt': 'alpha\n' })
    await harness.call('read', { path: 'a.txt' })
    await writeFile(join(root, 'a.txt'), Buffer.from('changed elsewhere\n', 'utf8'))

    const result = await harness.call('write', { path: 'a.txt', content: 'mine\n' })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'FsError', code: 'FS_STALE_VERSION' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('changed elsewhere\n')
    expect(harness.localFs?.writes).toHaveLength(1)
  })
})
