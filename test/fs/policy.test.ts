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
import { Context } from '@deepseek-ai/cordis'
import { FsError, type FileSystem } from '@deepseek-ai/dsh-fs'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { resolveMutationPolicy } from '../../src/fs/policy.ts'
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

/**
 * Mount the Nexus tools over a fresh root with the shipped enforcing backend
 * and the shared sandbox-policy service.
 *
 * The session cwd is `root/workspace` (the `workspace-write` boundary); the
 * backend relative-path base is the broader `root`, so omitting the per-call
 * policy would be observably unsafe if it resolved to the deployment fallback.
 * @param files - files to seed inside the session workspace.
 * @returns the harness, the root and the session workspace.
 */
async function openSandboxHarness(files: Readonly<Record<string, string>> = {}): Promise<{
  harness: ToolHarness
  root: string
  workspace: string
}> {
  await mkdir(CACHE_DIR, { recursive: true })
  const root = await mkdtemp(join(CACHE_DIR, 'fs-sandbox-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  for (const [path, text] of Object.entries(files)) {
    await writeFile(join(workspace, path), Buffer.from(text, 'utf8'))
  }
  const harness = await createToolHarness({
    cwd: workspace,
    sandbox: { mode: 'workspace-write', workspaceRoot: root, backendCwd: root },
  })
  open.push({ harness, root })
  for (const tool of createFsTools(harness.ctx, () => DEFAULT_SETTINGS)) harness.ctx.tools.register(tool)
  return { harness, root, workspace }
}

describe('Nexus sandbox policy propagation', () => {
  it('denies a write when the session switches to read-only after observation', async () => {
    const { harness, workspace } = await openSandboxHarness({ 'inside.txt': 'alpha\n' })
    const read = await harness.call('read', { path: 'inside.txt' })
    expect(read.isError).toBe(false)

    setSandboxMode(harness.owner.agent.session, 'read-only')
    const denied = await harness.call('write', { path: 'inside.txt', content: 'changed\n' })

    expect(denied.isError).toBe(true)
    expect(denied.error?.info).toMatchObject({ name: 'FsError', code: 'FS_SANDBOX_DENIED' })
    expect(await readFile(join(workspace, 'inside.txt'), 'utf8')).toBe('alpha\n')
    // The attempt reached the enforcing backend: the native fence produced the denial.
    expect(harness.sandboxFs?.writes).toHaveLength(1)

    // A later permission change is honored per call, not cached at construction.
    setSandboxMode(harness.owner.agent.session, 'workspace-write')
    const allowed = await harness.call('write', { path: 'inside.txt', content: 'changed\n' })
    expect(allowed.isError).toBe(false)
    expect(await readFile(join(workspace, 'inside.txt'), 'utf8')).toBe('changed\n')
  })

  it('denies an edit when the session switches to read-only after observation', async () => {
    const { harness, workspace } = await openSandboxHarness({ 'inside.txt': 'alpha\n' })
    const read = await harness.call('read', { path: 'inside.txt' })
    expect(read.isError).toBe(false)

    setSandboxMode(harness.owner.agent.session, 'read-only')
    const denied = await harness.call('edit', {
      path: 'inside.txt',
      edits: [{ oldText: 'alpha', newText: 'A' }],
    })

    expect(denied.isError).toBe(true)
    expect(denied.error?.info).toMatchObject({ name: 'FsError', code: 'FS_SANDBOX_DENIED' })
    expect(await readFile(join(workspace, 'inside.txt'), 'utf8')).toBe('alpha\n')
    expect(harness.sandboxFs?.writes).toHaveLength(1)
  })

  it('denies mutations outside the current session workspace even when the backend base is broader', async () => {
    const { harness, root, workspace } = await openSandboxHarness()
    const outside = join(root, 'outside.txt')
    await writeFile(outside, Buffer.from('outside\n', 'utf8'))
    const read = await harness.call('read', { path: outside })
    expect(read.isError).toBe(false)

    const writeDenied = await harness.call('write', { path: outside, content: 'overwritten\n' })
    expect(writeDenied.isError).toBe(true)
    expect(writeDenied.error?.info).toMatchObject({ name: 'FsError', code: 'FS_SANDBOX_DENIED' })
    expect(await readFile(outside, 'utf8')).toBe('outside\n')

    const editDenied = await harness.call('edit', {
      path: outside,
      edits: [{ oldText: 'outside', newText: 'inside' }],
    })
    expect(editDenied.isError).toBe(true)
    expect(editDenied.error?.info).toMatchObject({ name: 'FsError', code: 'FS_SANDBOX_DENIED' })
    expect(await readFile(outside, 'utf8')).toBe('outside\n')

    // The same session may still write inside its actual workspace.
    const inside = join(workspace, 'allowed.txt')
    const allowed = await harness.call('write', { path: inside, content: 'allowed\n' })
    expect(allowed.isError).toBe(false)
    expect(await readFile(inside, 'utf8')).toBe('allowed\n')
  })

  it('fails closed when the confining backend has no policy service', async () => {
    // The capability fact says this backend confines, but its required policy
    // service is absent. Both mutations call this helper before writeText, so
    // it is the fail-closed gate they hit first.
    const ctx = new Context()
    try {
      ctx.provide('fs', { sandboxMode: 'workspace-write' } as unknown as FileSystem)
      const exec = { agent: undefined } as unknown as ToolRunContext
      expect(() => resolveMutationPolicy(ctx, exec, '/workspace/a.txt')).toThrowError(
        expect.objectContaining({ name: 'NexusError', code: 'UNSUPPORTED_CAPABILITY' }),
      )
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

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
