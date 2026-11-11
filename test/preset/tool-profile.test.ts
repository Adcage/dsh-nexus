/**
 * The stored tool set: which Nexus tools one session may use.
 *
 * These cases drive the real preset generation and the real tool registry, so
 * what they assert is the model-facing tool list of an assembled request, not a
 * private predicate. The settings record is saved through the runtime, which is
 * the same path the console uses.
 *
 * @module dsh-nexus/test/preset/tool-profile
 */

import { describe, expect, it } from 'vitest'
import { mountPresetHarness, type PresetHarness } from '../support/preset-harness.ts'
import { NEXUS_PRESET_ID } from '../../src/preset/definition.ts'
import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import { runtimeSettingsSchema } from '../../src/storage/domain.ts'
import { NEXUS_TOOL_KEYS, type RuntimeSettings, type ToolSettings } from '../../src/protocol.ts'

/** The six tools a Nexus session starts with. */
const ALL_TOOLS = [...NEXUS_TOOL_KEYS]

/** One tool set with the named tools turned off. */
function without(...disabled: readonly (keyof ToolSettings)[]): ToolSettings {
  return Object.fromEntries(
    NEXUS_TOOL_KEYS.map((key) => [key, !disabled.includes(key)]),
  ) as unknown as ToolSettings
}

/** Save one complete settings record through the runtime, as the console does. */
async function saveTools(harness: PresetHarness, tools: ToolSettings): Promise<void> {
  const current = harness.runtime.getSettings()
  const next: RuntimeSettings = { ...current.value, tools }
  await harness.runtime.saveSettings(next, current.hash)
}

/** Wait until some session other than `own` produced a model request. */
async function waitForChildRequest(harness: PresetHarness, own: string): Promise<string> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const other = harness.requests.find((request) => request.options.sessionId !== own)
    if (other?.options.sessionId !== undefined) return other.options.sessionId
    if (Date.now() > deadline) throw new Error('the child session made no model request in time')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** The tool names one assembled request carried. */
function namesOf(harness: PresetHarness, sessionId: string): string[] {
  const request = harness.requests.filter((entry) => entry.options.sessionId === sessionId).at(-1)
  if (request === undefined) throw new Error(`session "${sessionId}" made no model request`)
  return (request.options.tools ?? []).map((tool) => tool.name)
}

describe('stored tool set', () => {
  it('serves every Nexus tool before anything is restricted', async () => {
    const harness = await mountPresetHarness()
    try {
      await harness.startNexus()
      const agent = await harness.createAgent('nexus-tools-default', NEXUS_PRESET_ID)
      await harness.runTurn(agent, 'list your tools')

      expect(namesOf(harness, agent.id).sort()).toEqual(expect.arrayContaining([...ALL_TOOLS].sort()))
    } finally {
      await harness.dispose()
    }
  })

  it('removes a disabled tool from the next assembled request and restores it', async () => {
    const harness = await mountPresetHarness()
    try {
      await harness.startNexus()
      const agent = await harness.createAgent('nexus-tools-toggle', NEXUS_PRESET_ID)
      await harness.runTurn(agent, 'before')

      await saveTools(harness, without('web'))
      await harness.runTurn(agent, 'after disabling')
      const restricted = namesOf(harness, agent.id)
      expect(restricted).not.toContain('web')
      expect(restricted).toEqual(expect.arrayContaining(['read', 'shell', 'agent']))

      await saveTools(harness, without())
      await harness.runTurn(agent, 'after restoring')
      expect(namesOf(harness, agent.id)).toContain('web')
    } finally {
      await harness.dispose()
    }
  })

  it('refuses a direct call to a tool the settings disabled', async () => {
    const harness = await mountPresetHarness()
    try {
      await harness.startNexus()
      const agent = await harness.createAgent('nexus-tools-direct', NEXUS_PRESET_ID)
      await harness.runTurn(agent, 'before')

      await saveTools(harness, without('web'))
      const refused = await harness.call('web', { action: 'search', queries: ['nexus'] }, agent)
      expect(refused.isError).toBe(true)
      // The registry owns the visibility verdict: a restricted tool is no longer
      // in this Agent's end-tool set, so dispatch refuses it as an unknown tool.
      // The Nexus guard answers TOOL_DISABLED for the same name if it ever stays
      // visible (a stale definition, a failed restriction), which is why both are
      // acceptable here and neither executes the call.
      expect(['UNKNOWN_TOOL', 'TOOL_DISABLED']).toContain(refused.error?.info?.code)

      // A tool that is still enabled is not blocked by the same guard; whatever
      // the tool itself answers, it never receives the disabled verdict.
      const allowed = await harness.call('read', { path: 'package.json' }, agent)
      expect(allowed.error?.info?.code).not.toBe('TOOL_DISABLED')
    } finally {
      await harness.dispose()
    }
  })

  it('applies the same tool set to a child a session delegates to', async () => {
    const harness = await mountPresetHarness()
    try {
      await harness.startNexus()
      const agent = await harness.createAgent('nexus-tools-parent', NEXUS_PRESET_ID)
      await harness.runTurn(agent, 'before')

      await saveTools(harness, without('web'))
      const started = await harness.call('agent', { action: 'start', task: 'inspect the repository', access: 'read' }, agent)
      if (started.isError) throw new Error(`the child did not start: ${JSON.stringify(started.error)}`)
      const childId = (started.value as { childId: string }).childId

      const requestSession = await waitForChildRequest(harness, agent.id)
      expect(requestSession).toBe(childId)
      // The child joins the parent's preset revision, so the same restriction is
      // applied to its own request.
      expect(namesOf(harness, childId)).not.toContain('web')
    } finally {
      await harness.dispose()
    }
  })

  it('opens a settings record written before the field existed with every tool enabled', () => {
    const legacy = {
      files: { defaultLines: 200, maxOutputBytes: 32_768 },
      terminal: { engine: 'bash' },
      agents: { concurrency: 4, maxDepth: 2, childAccess: 'inherit' },
      web: { maxResults: 5, maxCharsPerPage: 12_000 },
      toolDisplay: 'nexus',
    }
    const parsed = runtimeSettingsSchema.parse(legacy)
    expect(parsed.tools).toEqual(DEFAULT_SETTINGS.tools)
    expect(Object.values(parsed.tools).every((enabled) => enabled)).toBe(true)
  })
})
