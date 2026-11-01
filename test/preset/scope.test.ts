/**
 * The Nexus scope: which session gets the persona, which Agent is a Nexus actor,
 * and what a delegated child inherits.
 *
 * These cases run on the real preset generation the registry mounted: the
 * prompt contribution, the exact-Agent membership and the delegation tool are
 * the ones the built package registers, and every request is assembled by the
 * production AgentLoop.
 *
 * @module dsh-nexus/test/preset/scope
 */

import { describe, expect, it } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { NEXUS_PRESET_ID } from '../../src/preset/definition.ts'
import { waitFor } from '../support/agent-harness.ts'
import { mountPresetHarness } from '../support/preset-harness.ts'

/** The Nexus base persona text the accepted spec fixes. */
const NEXUS_PERSONA = '你是一名运行在 DeepSeek Harness（DSH）Agent 框架内的专业编程助手'

describe('nexus preset scope', () => {
  it('keeps the persona, the instruction surface and the skill catalog per session', async () => {
    const harness = await mountPresetHarness({})
    try {
      await harness.startNexus()
      const nexusAgent = await harness.createAgent('scope-nexus', NEXUS_PRESET_ID)
      const standardAgent = await harness.createAgent('scope-standard', 'standard')
      await harness.runTurn(nexusAgent, 'nexus')
      await harness.runTurn(standardAgent, 'standard')

      const nexusPrompt = harness.promptTextOf(nexusAgent)
      const standardPrompt = harness.promptTextOf(standardAgent)
      // The Nexus persona is the REAL system prompt of a Nexus session only.
      expect(nexusPrompt).toContain(NEXUS_PERSONA)
      expect(standardPrompt).not.toContain(NEXUS_PERSONA)
      // The native instruction surface and skill catalog reach BOTH: they are
      // retained, not replaced.
      for (const text of ['FIXTURE INSTRUCTION LINE', 'nexus-fixture-skill']) {
        expect(nexusPrompt).toContain(text)
        expect(standardPrompt).toContain(text)
      }
      // Nothing in the Nexus contribution sets `complete`, so the deployment
      // persona sentence stays in front of it.
      expect(nexusPrompt).toContain('You are an AI agent powered by DeepSeek Harness.')
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('marks exactly the nexus agents and releases the membership on their lifetime', async () => {
    const harness = await mountPresetHarness({})
    try {
      const runtime = await harness.startNexus()
      const nexusAgent = await harness.createAgent('member-nexus', NEXUS_PRESET_ID)
      const standardAgent = await harness.createAgent('member-standard', 'standard')
      expect(runtime.isNexusAgent(nexusAgent)).toBe(true)
      expect(runtime.isNexusAgent(standardAgent)).toBe(false)

      await harness.disposeAgent(nexusAgent)
      expect(runtime.isNexusAgent(nexusAgent)).toBe(false)
      expect(harness.ctx.agents.get(nexusAgent.id)).toBeUndefined()
      // The unrelated session is untouched by the retirement.
      expect(harness.ctx.agents.get(standardAgent.id)).toBe(standardAgent)
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('lets a spawned and a forked child inherit the nexus composition and policy', async () => {
    const harness = await mountPresetHarness({})
    try {
      await harness.startNexus()
      const parent = await harness.createAgent('delegate-parent', NEXUS_PRESET_ID)
      await harness.runTurn(parent, 'parent turn')
      // The parent's exact effective snapshot is what a child must inherit; a
      // library default or an empty persona would not contain this text.
      const parentSnapshot = harness.runtime.prompts.peek(parent)
      expect(parentSnapshot.text).toContain(NEXUS_PERSONA)
      const inherited = harness.runtime.prompts.peek(parent)
      expect(inherited.text).toBe(parentSnapshot.text)

      for (const context of ['spawn', 'fork'] as const) {
        const result = await harness.call(
          'agent',
          { action: 'start', task: `${context} child task`, context, access: 'read' },
          parent,
        )
        expect(result.isError).toBe(false)
        const value = result.value as { childId?: string }
        expect(typeof value.childId).toBe('string')
        const childId = value.childId as string

        // The child runs its own turn asynchronously; wait for its assembled
        // request instead of assuming `start` waited for it.
        await waitFor(
          () => harness.requests.some((request) => request.options.sessionId === childId),
          `the ${context} child to assemble its first request`,
          20_000,
        )
        const childRequests = harness.requests.filter((request) => request.options.sessionId === childId)
        expect(childRequests.length).toBeGreaterThan(0)
        const childText = childRequests
          .flatMap((request) => request.options.messages)
          .flatMap((message) => message.content)
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('\n')
        // The child's own assembled request carries the parent's EXACT effective
        // Nexus snapshot text, not a library default the parent is not running.
        expect(childText).toContain(parentSnapshot.text)

        // A child runs inside the parent's generation, so the Nexus tool surface
        // is what it sees.
        const childTools = (childRequests[0]?.options.tools ?? []).map((tool) => tool.name)
        expect(childTools).toContain('read')
        expect(childTools).toContain('agent')
      }

      // The parent's snapshot was not replaced by the children's inheritance.
      expect(harness.runtime.prompts.peek(parent).text).toBe(parentSnapshot.text)
    } finally {
      await harness.dispose()
    }
  }, 90_000)

  it('enforces the child write scope on the child creation edge', async () => {
    const harness = await mountPresetHarness({})
    try {
      const runtime = await harness.startNexus()
      const parent = await harness.createAgent('writer-parent', NEXUS_PRESET_ID)
      await harness.runTurn(parent, 'parent')
      const result = await harness.call(
        'agent',
        { action: 'start', task: 'write child task', context: 'spawn', access: 'write' },
        parent,
      )
      expect(result.isError, JSON.stringify(result)).toBe(false)
      const childId = (result.value as { childId: string }).childId
      // The delegation policy hook the preset registers admitted the write scope
      // for that exact child on its creation edge, against the runtime's one
      // coordinator (a second coordinator or a missing hook would leave it
      // unheld).
      expect(runtime.coordinator.scopeOf(childId as never)).toMatchObject({ state: 'held' })

      // And the declared READ ceiling is really applied to a read child: the
      // deployment mode is workspace-write, so an unchanged child would prove the
      // hook never ran.
      const readResult = await harness.call(
        'agent',
        { action: 'start', task: 'read child task', context: 'spawn', access: 'read' },
        parent,
      )
      expect(readResult.isError, JSON.stringify(readResult)).toBe(false)
      const readChildId = (readResult.value as { childId: string }).childId
      const readChild = harness.ctx.agents.get(readChildId as never)
      expect(readChild).toBeDefined()
      expect(harness.ctx.sandboxPolicy.resolve({ session: readChild?.session as never }).mode).toBe('read-only')
    } finally {
      await harness.dispose()
    }
  }, 90_000)

  it('surfaces a prompt-snapshot persistence failure instead of masking it', async () => {
    const harness = await mountPresetHarness({})
    try {
      const runtime = await harness.startNexus()
      harness.fixture.failNextPut('prompts')
      let failure: unknown
      try {
        await harness.createAgent('persona-write-failure', NEXUS_PRESET_ID)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(String((failure as Error).message)).toMatch(/refused the write/)
      // The creation rolled back: no Agent, no half-registered member, and the
      // failure is NOT replaced by a default persona or a synthetic message.
      expect(harness.ctx.agents.get('persona-write-failure' as never)).toBeUndefined()

      // A later creation of the same id works, so the rollback left no residue.
      const retried = await harness.createAgent('persona-write-failure', NEXUS_PRESET_ID)
      expect(runtime.isNexusAgent(retried)).toBe(true)
      await harness.runTurn(retried, 'after retry')
      expect(harness.promptTextOf(retried)).toContain(NEXUS_PERSONA)
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('preserves a native refusal code across the compiled package boundary', async () => {
    // A real shipped `WebError` (a `HarnessError` subclass) thrown by the provider
    // boundary. The built package must classify it with the HOST class, or the
    // native code is replaced by a generic fallback.
    const refusal = new WebError('the configured web provider refused this query', 'WEB_PROVIDER_UNAVAILABLE')
    const harness = await mountPresetHarness({ webSearchError: refusal })
    try {
      await harness.startNexus()
      const agent = await harness.createAgent('native-refusal', NEXUS_PRESET_ID)
      const result = await harness.call('web', { action: 'search', queries: ['nexus'] }, agent)
      expect(result.isError).toBe(false)
      const items = (result.value as { items: { ok: boolean; error?: { code: string; message: string } }[] }).items
      expect(items[0]?.ok).toBe(false)
      expect(items[0]?.error?.code).toBe('WEB_PROVIDER_UNAVAILABLE')
      expect(items[0]?.error?.message).toContain('refused this query')
    } finally {
      await harness.dispose()
    }
  }, 60_000)

  it('refuses a nexus tool once the runtime stops admitting nexus work', async () => {
    const harness = await mountPresetHarness({})
    try {
      const runtime = await harness.startNexus()
      const agent = await harness.createAgent('closing-nexus', NEXUS_PRESET_ID)
      const first = await harness.call('read', { path: 'AGENTS.md' }, agent)
      expect(first.isError).toBe(false)

      // The runtime's teardown starts by refusing admissions; the exact marked
      // Agent stops being a Nexus actor before the store closes, so a call that
      // arrives during the drain is refused instead of starting new work.
      const closing = runtime.dispose()
      const during = await harness.call('read', { path: 'AGENTS.md' }, agent)
      expect(during.isError).toBe(true)
      expect(String(during.error?.message)).toMatch(/not running the Nexus preset/)
      // Compiled-boundary identity: this package's `NexusError` must be the HOST
      // `HarnessError` subclass, or the native ToolRuntime drops the code and the
      // model/user sees an unclassified failure. This suite runs the BUILT row.
      expect(during.error?.info).toMatchObject({ code: 'NO_AGENT' })
      await closing
    } finally {
      await harness.dispose()
    }
  }, 60_000)
})
