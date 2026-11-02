/**
 * Integration: where the Nexus terminal capability comes from.
 *
 * The deployed `web` profile has **no host-level `terminals` service**: the
 * native presets mount `@deepseek-ai/dsh-terminal` inside a group that isolates
 * `terminals` (`persistent-shell` in the composed profile). A Nexus generation
 * therefore cannot inherit one — it must own its terminal registry and its
 * native backends inside its own generation scope, exactly like `standard`
 * does in its group.
 *
 * These cases run on the shipped host composition without a host-level terminal
 * service (`preset-harness` reproduces that shape) and prove:
 *
 * - the Nexus generation still activates all six tools and its persona;
 * - its terminal instance is not the `standard`-shaped sibling instance, and no
 *   host-level `terminals` appears for unrelated consumers;
 * - a persistent terminal opened through the Nexus `shell` tool really uses the
 *   generation-scoped backends, and closing/unloading leaves nothing behind.
 *
 * @module dsh-nexus/test/integration/terminal-scope
 */

import { describe, expect, it } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { BASE_PROMPT } from '../../src/prompts/base.ts'
import { NEXUS_PRESET_ID } from '../../src/preset/definition.ts'
import { mountPresetHarness } from '../support/preset-harness.ts'

/** The tools a Nexus session must advertise. */
const NEXUS_TOOLS = ['read', 'write', 'edit', 'shell', 'web', 'agent'] as const

/** One JSON-shaped `shell` result as these cases read it. */
interface ShellValue {
  terminal?: { resourceId: string; status?: string }
  text?: string
  closed?: boolean
  terminals?: unknown[]
}

/**
 * Assert one successful registry result and return its value.
 * @param result - registry result.
 * @returns the canonical value.
 */
function valueOf<T>(result: ToolExecutionResult): T {
  if (result.isError) throw new Error(`expected success, got ${JSON.stringify(result.error)}`)
  return result.value as unknown as T
}

describe('Nexus terminal capability in the deployed profile shape', () => {
  it('activates the generation with all six tools and the persona without any host-level terminals', async () => {
    const harness = await mountPresetHarness({})
    try {
      // The real shape: nothing provides `terminals` for the whole host, and the
      // `standard`-shaped sibling instance has no backend registered.
      expect(harness.ctx.get('terminals')).toBeUndefined()
      expect(harness.standardTerminals.listBackends()).toEqual([])

      await harness.startNexus()
      const agent = await harness.createAgent('terminal-scope-agent', NEXUS_PRESET_ID)
      await harness.runTurn(agent, 'hello')

      expect(harness.toolNamesOf(agent)).toEqual(expect.arrayContaining([...NEXUS_TOOLS]))
      expect(harness.promptTextOf(agent)).toContain(BASE_PROMPT.split('\n')[0] as string)
      // Still no host-wide service: the generation's own registry stays inside
      // its generation, and unrelated consumers see nothing new.
      expect(harness.ctx.get('terminals')).toBeUndefined()
    } finally {
      await harness.dispose()
    }
  }, 120_000)

  it('opens, writes, reads and closes a persistent terminal through the generation-scoped backends', async () => {
    const harness = await mountPresetHarness({
      terminalScript: () => ({ stdout: 'nexus-prompt$ ', staysOpen: true }),
    })
    try {
      await harness.startNexus()
      const agent = await harness.createAgent('terminal-scope-lifecycle', NEXUS_PRESET_ID)
      await harness.runTurn(agent, 'work')

      // The Nexus generation registers its own native backends: the
      // `standard`-shaped sibling registry must stay empty throughout.
      expect(harness.standardTerminals.listBackends()).toEqual([])

      const opened = valueOf<ShellValue>(await harness.call('shell', { action: 'open', engine: 'bash' }, agent))
      const resourceId = opened.terminal?.resourceId
      expect(resourceId).toMatch(/^nexus-term-/u)

      const sent = valueOf<ShellValue>(
        await harness.call('shell', { action: 'send', resourceId, text: 'printf hello' }, agent),
      )
      expect(sent.terminal?.resourceId).toBe(resourceId)
      const page = valueOf<ShellValue>(await harness.call('shell', { action: 'read', resourceId }, agent))
      expect(typeof page.text).toBe('string')

      const closed = valueOf<ShellValue>(await harness.call('shell', { action: 'close', resourceId }, agent))
      expect(closed.closed).toBe(true)
      const listed = valueOf<ShellValue>(await harness.call('shell', { action: 'list' }, agent))
      expect(listed.terminals).toEqual([])
      // Nothing leaked into the sibling instance and no host-wide service appeared.
      expect(harness.standardTerminals.listBackends()).toEqual([])
      expect(harness.ctx.get('terminals')).toBeUndefined()
    } finally {
      await harness.dispose()
    }
  }, 120_000)

  it('leaves no terminal registration behind when the generation unloads and re-registers', async () => {
    const harness = await mountPresetHarness({})
    try {
      await harness.startNexus()
      const first = await harness.createAgent('terminal-scope-unload', NEXUS_PRESET_ID)
      await harness.runTurn(first, 'first')
      expect(harness.toolNamesOf(first)).toEqual(expect.arrayContaining([...NEXUS_TOOLS]))

      await harness.stopNexus()
      // A leaked generation-scoped service would make the next mount fail with a
      // duplicate registration instead of composing a fresh generation.
      await harness.startNexus()
      const second = await harness.createAgent('terminal-scope-unload-2', NEXUS_PRESET_ID)
      await harness.runTurn(second, 'second')
      expect(harness.toolNamesOf(second)).toEqual(expect.arrayContaining([...NEXUS_TOOLS]))
      expect(harness.ctx.get('terminals')).toBeUndefined()
      expect(harness.standardTerminals.listBackends()).toEqual([])
    } finally {
      await harness.dispose()
    }
  }, 120_000)

  it('retires a generation that still owns an open terminal and never revives its resource id', async () => {
    const harness = await mountPresetHarness({
      terminalScript: () => ({ stdout: 'nexus-prompt$ ', staysOpen: true }),
    })
    try {
      await harness.startNexus()
      const first = await harness.createAgent('terminal-scope-retire', NEXUS_PRESET_ID)
      await harness.runTurn(first, 'retire')
      const opened = valueOf<ShellValue>(await harness.call('shell', { action: 'open', engine: 'bash' }, first))
      const retiredId = opened.terminal?.resourceId
      expect(retiredId).toMatch(/^nexus-term-/u)
      const spawnsBefore = harness.subprocess.terminalSpawns.length

      // The generation is retired while the terminal is still OPEN: no explicit
      // close precedes it, so the generation's own disposal must own the cleanup.
      await harness.disposeAgent(first)
      expect(harness.standardTerminals.listBackends()).toEqual([])
      expect(harness.ctx.get('terminals')).toBeUndefined()

      // A fresh generation starts with its own registry: it did not inherit the
      // retired instance (no second terminal source appeared).
      const second = await harness.createAgent('terminal-scope-retire-2', NEXUS_PRESET_ID)
      await harness.runTurn(second, 'next')
      expect(harness.subprocess.terminalSpawns.length).toBe(spawnsBefore)
      expect(harness.standardTerminals.listBackends()).toEqual([])

      // The retired resource id is not reusable by another generation.
      const stale = await harness.call('shell', { action: 'status', resourceId: retiredId }, second)
      expect(stale.isError).toBe(true)
      expect(stale.error?.info).toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
      const listed = valueOf<ShellValue>(await harness.call('shell', { action: 'list' }, second))
      expect(listed.terminals).toEqual([])

      // The same holds across a host-row restart, so a reload cannot resurrect it.
      await harness.stopNexus()
      await harness.startNexus()
      const third = await harness.createAgent('terminal-scope-retire-3', NEXUS_PRESET_ID)
      await harness.runTurn(third, 'after restart')
      const stillStale = await harness.call('shell', { action: 'status', resourceId: retiredId }, third)
      expect(stillStale.isError).toBe(true)
      expect(stillStale.error?.info).toMatchObject({ code: 'RESOURCE_NOT_AVAILABLE' })
      expect(harness.ctx.get('terminals')).toBeUndefined()
      expect(harness.standardTerminals.listBackends()).toEqual([])
    } finally {
      await harness.dispose()
    }
  }, 120_000)
})
