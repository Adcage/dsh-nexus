/**
 * Integration: prompt snapshots across delegation and across generations.
 *
 * The seed module is deliberately distinctive text that appears in no base
 * prompt, no project instruction file and no persona. A spawn or fork child that
 * merely recomposed the default base prompt would therefore fail the assertion —
 * the case cannot pass by default recomposition.
 *
 * It also reopens the saved snapshot from the durable medium after the runtime
 * was unloaded and reopened, which is the "reopening prompt state" cold path.
 *
 * @module dsh-nexus/test/integration/prompts
 */

import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { NEXUS_PRESET_ID } from '../../src/preset/definition.ts'
import { mountPresetHarness, PRESET_ROUTE, type PresetHarness } from '../support/preset-harness.ts'

/** Module id of the seeded snapshot. */
const MODULE_ID = 'integration-distinctive'

/** Unique body: it exists only in the saved module. */
const DISTINCTIVE_BODY =
  'DISTINCTIVE INTEGRATION MODULE: every delegated child inherits this exact saved text, which no default prompt contains.'

/** All text one captured request carried. */
function requestText(request: GenerateOptions): string {
  return request.messages
    .flatMap((message) => message.content)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

/** Latest captured request for one session. */
function latestRequest(harness: PresetHarness, sessionId: string): GenerateOptions {
  const own = harness.requests.filter((request) => request.options.sessionId === sessionId)
  const last = own.at(-1)
  if (last === undefined) throw new Error(`session "${sessionId}" made no model request`)
  return last.options
}

/**
 * Wait until one session produced a captured request.
 * @param harness - mounted harness.
 * @param sessionId - session to wait for.
 * @param label - what is being waited for, used in the failure message.
 */
async function waitForRequest(harness: PresetHarness, sessionId: string, label: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (!harness.requests.some((request) => request.options.sessionId === sessionId)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/**
 * Seed the library with the distinctive module and apply it to the parent.
 * @param harness - mounted harness with the runtime open.
 * @param parent - the Nexus parent Agent.
 * @returns after the durable save and the durable apply settled.
 */
async function applyDistinctiveModule(harness: PresetHarness, parent: Agent): Promise<void> {
  const library = await harness.runtime.store.readLibrary()
  const saved = await harness.runtime.store.saveLibrary(
    { modules: [{ id: MODULE_ID, name: 'Distinctive', body: DISTINCTIVE_BODY }], defaultSelection: [] },
    library.hash,
  )
  await harness.runtime.prompts.apply(parent, [MODULE_ID], saved.hash)
}

describe('prompt inheritance', () => {
  it('gives spawn and fork children the exact non-default snapshot the parent runs', async () => {
    const harness = await mountPresetHarness({})
    try {
      await harness.startNexus()
      const parent = await harness.createAgent('inherit-parent', NEXUS_PRESET_ID)
      await harness.runTurn(parent, 'initialize')
      await applyDistinctiveModule(harness, parent)
      await harness.runTurn(parent, 'carry the module')

      // The parent really runs the distinctive text.
      expect(requestText(latestRequest(harness, parent.id))).toContain(DISTINCTIVE_BODY)

      const children: string[] = []
      for (const context of ['spawn', 'fork'] as const) {
        const started = await harness.call(
          'agent',
          { action: 'start', task: `${context} child task`, context },
          parent,
        )
        expect(started.isError, JSON.stringify(started)).toBe(false)
        const childId = (started.value as { childId: string }).childId
        children.push(childId)
        await waitForRequest(harness, childId, `the ${context} child request`)

        // The child's assembled request carries the parent's exact saved text.
        expect(requestText(latestRequest(harness, childId)), `${context} child`).toContain(DISTINCTIVE_BODY)
        // ...and the child's durable snapshot says which module it inherited.
        expect((await harness.runtime.store.getPrompt(childId))?.selection).toEqual([MODULE_ID])

        const stopped = await harness.call('agent', { action: 'stop', childId }, parent)
        expect(stopped.isError, JSON.stringify(stopped)).toBe(false)
      }

      // Control: a fresh Nexus session with no seeded selection runs the default
      // base prompt only, so the assertion above cannot be satisfied by it.
      const fresh = await harness.createAgent('inherit-control', NEXUS_PRESET_ID)
      await harness.runTurn(fresh, 'control')
      expect(requestText(latestRequest(harness, fresh.id))).not.toContain(DISTINCTIVE_BODY)
      expect(children).toHaveLength(2)
    } finally {
      await harness.dispose()
    }
  }, 180_000)
})

describe('prompt reopen', () => {
  it('restores the saved snapshot for the same session after the runtime reopens', async () => {
    const harness = await mountPresetHarness({})
    try {
      await harness.startNexus()
      const first = await harness.createAgent('reopen-session', NEXUS_PRESET_ID)
      await harness.runTurn(first, 'initialize')
      await applyDistinctiveModule(harness, first)
      await harness.runTurn(first, 'persist')

      // Unload the generation and the runtime, then reopen over the same medium.
      await harness.disposeAgent(first)
      await harness.stopNexus()
      await harness.startNexus()

      // A later residency of the SAME durable session: the persisted session is
      // resumed, and the prompt snapshot is restored from the Nexus store.
      const handle = await harness.ctx.agents.resume({
        resumeSessionId: SessionId('reopen-session'),
        agentOptions: { ...PRESET_ROUTE },
        setup: async (agentCtx) => {
          await harness.ctx.agentPresets.mount(agentCtx, NEXUS_PRESET_ID)
        },
      })
      const reopened = handle.agent
      try {
        await harness.runTurn(reopened, 'resume')
        expect(requestText(latestRequest(harness, 'reopen-session'))).toContain(DISTINCTIVE_BODY)
        expect(harness.runtime.prompts.peek(reopened).selection).toEqual([MODULE_ID])
      } finally {
        await handle.dispose()
      }

      // The durable record is the source: read it back with a fresh store handle.
      await harness.stopNexus()
      const store = await harness.fixture.open()
      try {
        const saved = await store.getPrompt('reopen-session')
        expect(saved?.selection).toEqual([MODULE_ID])
        expect(saved?.text).toContain(DISTINCTIVE_BODY)
      } finally {
        await store.dispose()
      }
    } finally {
      await harness.dispose()
    }
  }, 180_000)
})
