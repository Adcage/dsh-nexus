/**
 * Write-scope coordination for internal children (AG-08).
 *
 * These cases drive the real Node filesystem: canonicalization, junction
 * aliases and case differences are the operating system's answers, not a
 * fixture's. Two writers may run side by side in isolated trees, and never in
 * one tree or a tree nested in the other. The lease is held beyond the child's
 * turn and freed only by an explicit release or the native release edge.
 *
 * @module dsh-nexus/test/agent/coordination
 */

import { mkdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { canonicalDirectory, createWriteCoordinator, scopesOverlap } from '../../src/agent/coordination.ts'
import { mountSubagentHarness, type SubagentHarness } from '../support/agent-harness.ts'

/** Project-local cache directory; no test state leaves the checkout. */
const CACHE_DIR = fileURLToPath(new URL('../../node_modules/.cache/dsh-nexus-test/', import.meta.url))

/** Harnesses and roots a case owns, disposed after it. */
const open: { harness: SubagentHarness; extra: string[] }[] = []

afterEach(async () => {
  for (const entry of open.splice(0)) {
    await entry.harness.dispose()
    for (const path of entry.extra) await rm(path, { recursive: true, force: true })
  }
})

/** Mount a harness plus two isolated writer directories inside the workspace. */
async function openScopes(): Promise<{
  harness: SubagentHarness
  parent: Agent
  first: string
  second: string
  nested: string
}> {
  await mkdir(CACHE_DIR, { recursive: true })
  const harness = await mountSubagentHarness()
  const first = join(harness.workspace, 'first')
  const second = join(harness.workspace, 'second')
  const nested = join(first, 'nested')
  await mkdir(nested, { recursive: true })
  await mkdir(second, { recursive: true })
  open.push({ harness, extra: [] })
  const parent = await harness.createParent('scope-parent')
  return { harness, parent, first, second, nested }
}

describe('canonical write scopes', () => {
  it('detects identical and nested scopes but not isolated siblings', () => {
    const base = process.platform === 'win32' ? 'E:\\ws\\one' : '/ws/one'
    const separator = process.platform === 'win32' ? '\\' : '/'
    expect(scopesOverlap(base, base)).toBe(true)
    expect(scopesOverlap(base, `${base}${separator}nested`)).toBe(true)
    expect(scopesOverlap(`${base}${separator}nested`, base)).toBe(true)
    const sibling = process.platform === 'win32' ? 'E:\\ws\\two' : '/ws/two'
    expect(scopesOverlap(base, sibling)).toBe(false)
    // A path that merely starts with the same characters is not inside it.
    expect(scopesOverlap(base, `${base}typo`)).toBe(false)
  })

  it('resolves a junction alias to the same canonical directory', async () => {
    const { harness, first } = await openScopes()
    if (process.platform !== 'win32') {
      // A plain symlink exercises the same realpath contract on other hosts.
      await symlink(first, join(harness.workspace, 'alias'), 'dir')
      expect(await canonicalDirectory(join(harness.workspace, 'alias'))).toBe(await canonicalDirectory(first))
      return
    }
    const alias = join(harness.workspace, 'alias')
    await symlink(first, alias, 'junction')
    expect(await canonicalDirectory(alias)).toBe(await canonicalDirectory(first))
  })

  it('refuses a missing directory before any lease is granted', async () => {
    const { harness, parent } = await openScopes()
    const coordinator = createWriteCoordinator(harness.ctx)
    await expect(coordinator.acquire(parent, SessionId('missing-child'), join(harness.root, 'nope'))).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
  })
})

describe('writer isolation', () => {
  it('lets two writers hold isolated directories at the same time', async () => {
    const { harness, parent, first, second } = await openScopes()
    const coordinator = createWriteCoordinator(harness.ctx)
    const left = await coordinator.acquire(parent, SessionId('writer-left'), first)
    const right = await coordinator.acquire(parent, SessionId('writer-right'), second)
    expect(left.cwd).not.toBe(right.cwd)
    left.release()
    right.release()
  })

  it('refuses a second writer over the same, an ancestor or a descendant directory', async () => {
    const { harness, parent, first, nested } = await openScopes()
    const coordinator = createWriteCoordinator(harness.ctx)
    await coordinator.acquire(parent, SessionId('writer-first'), first)

    await expect(coordinator.acquire(parent, SessionId('writer-same'), first)).rejects.toMatchObject({
      code: 'WRITE_SCOPE_BUSY',
    })
    await expect(coordinator.acquire(parent, SessionId('writer-descendant'), nested)).rejects.toMatchObject({
      code: 'WRITE_SCOPE_BUSY',
    })
    await expect(coordinator.acquire(parent, SessionId('writer-ancestor'), harness.workspace)).rejects.toMatchObject({
      code: 'WRITE_SCOPE_BUSY',
    })
  })

  it('refuses an overlapping writer that arrives as a different spelling of the tree', async () => {
    const { harness, parent, first } = await openScopes()
    const coordinator = createWriteCoordinator(harness.ctx)
    await coordinator.acquire(parent, SessionId('writer-first'), first)

    const spelled = process.platform === 'win32' ? first.toUpperCase() : `${first}/`
    await expect(coordinator.acquire(parent, SessionId('writer-spelled'), spelled)).rejects.toMatchObject({
      code: 'WRITE_SCOPE_BUSY',
    })
  })

  it('refuses an overlapping writer through a junction alias of the held tree', async () => {
    const { harness, parent, first } = await openScopes()
    const alias = join(harness.workspace, 'junction-alias')
    await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const coordinator = createWriteCoordinator(harness.ctx)
    await coordinator.acquire(parent, SessionId('writer-first'), first)

    await expect(coordinator.acquire(parent, SessionId('writer-alias'), alias)).rejects.toMatchObject({
      code: 'WRITE_SCOPE_BUSY',
    })
  })

  it('refuses a writer from another session that overlaps a held tree', async () => {
    const { harness, parent, first } = await openScopes()
    const other = await harness.createParent('scope-parent-two')
    const coordinator = createWriteCoordinator(harness.ctx)
    await coordinator.acquire(parent, SessionId('writer-first'), first)

    await expect(coordinator.acquire(other, SessionId('writer-other-session'), first)).rejects.toMatchObject({
      code: 'WRITE_SCOPE_BUSY',
    })
  })

  it('frees the scope on release and ignores a repeated release', async () => {
    const { harness, parent, first } = await openScopes()
    const coordinator = createWriteCoordinator(harness.ctx)
    const held = await coordinator.acquire(parent, SessionId('writer-first'), first)
    held.release()
    held.release()

    const next = await coordinator.acquire(parent, SessionId('writer-next'), first)
    expect(next.cwd).toBe(held.cwd)
    next.release()
  })

  it('keeps one lease for the same child and replaces it when that child changes tree', async () => {
    const { harness, parent, first, second } = await openScopes()
    const coordinator = createWriteCoordinator(harness.ctx)
    const held = await coordinator.acquire(parent, SessionId('writer-one'), first)
    const again = await coordinator.acquire(parent, SessionId('writer-one'), first)
    expect(again).toBeDefined()
    expect(held.cwd).toBe(again.cwd)

    const moved = await coordinator.acquire(parent, SessionId('writer-one'), second)
    expect(moved.cwd).toBe(await canonicalDirectory(second))
    // The old tree is free for another writer once the child moved away.
    const other = await coordinator.acquire(parent, SessionId('writer-two'), first)
    other.release()
  })

  it('does not keep authority for a writer whose owner and child are both gone', async () => {
    const { harness, parent, first } = await openScopes()
    const coordinator = createWriteCoordinator(harness.ctx)
    const ghostOwner = { id: SessionId('ghost-parent') } as Agent
    await coordinator.acquire(ghostOwner, SessionId('ghost-child'), first)

    // The live parent re-admits a writer over the same tree: a lease whose
    // authorizing Agent and writer are both absent is not authority.
    const reclaimed = await coordinator.acquire(parent, SessionId('writer-live'), first)
    expect(reclaimed.cwd).toBe(await canonicalDirectory(first))
    reclaimed.release()
  })
})
