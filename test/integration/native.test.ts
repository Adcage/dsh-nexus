/**
 * Integration: the native mechanisms a Nexus session must keep.
 *
 * Every case runs the shipped composition — Cordis Loader, native
 * `agentPresets` registry, production AgentLoop, real session/storage services,
 * the native skill provider, `ask_user_question`, `todo_write` and this
 * package's built host row. The model transport is the only scripted external
 * boundary, and it is scripted at the transport seam so the assertions read the
 * REAL request assembly DSH produced (messages, roles, tool results), not a
 * hand-written role array.
 *
 * Covered here:
 *
 * - native skill discovery before use and body loading only after invocation;
 * - a real `ask_user_question` answer round-trip and a real `todo_write`
 *   mutation, with the native user/model call markers preserved;
 * - generation retirement driven by the native `agentPresets` registry, keeping
 *   a write child's durable authority when its generation is retired.
 *
 * @module dsh-nexus/test/integration/native
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, type ContentBlock, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { canonicalDirectory } from '../../src/agent/coordination.ts'
import { createNexusPreset, NEXUS_PRESET_ID } from '../../src/preset/definition.ts'
import { openNexusRuntime, type NexusRuntime } from '../../src/runtime/service.ts'
import { mountNexusStoreFixture, type NexusStoreFixture } from '../support/fixtures.ts'
import { mountPresetHarness, PRESET_ROUTE } from '../support/preset-harness.ts'

/** The fixture skill the native provider discovers under the pinned agents home. */
const SKILL_NAME = 'nexus-fixture-skill'

/** Its description as the fixture wrote it; the catalog must carry the summary. */
const SKILL_DESCRIPTION = 'Fixture skill proving the native skill catalog reaches a Nexus session.'

/** Its body; it must not appear before the skill is loaded. */
const SKILL_BODY = 'FIXTURE SKILL BODY'

/** One scripted tool call the model asks for. */
interface ScriptedCall {
  readonly id: string
  readonly name: string
  readonly args: Record<string, unknown>
}

/** All text of one request's messages, in order. */
function requestText(request: GenerateOptions): string {
  return request.messages
    .flatMap((message) => message.content)
    .map((block: ContentBlock) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

/**
 * One streaming answer carrying tool calls.
 * @param calls - calls the model requests, in order.
 * @returns the stream.
 */
async function* toolCallsAnswer(calls: readonly ScriptedCall[]): AsyncGenerator<StreamChunk> {
  for (const [index, call] of calls.entries()) {
    const args = JSON.stringify(call.args)
    yield { type: 'block-start', index, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index, id: ToolCallId(call.id), name: call.name, argumentsDelta: args }
    yield { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: args } }
  }
  yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/**
 * One streaming text answer.
 * @param text - answer text.
 * @returns the stream.
 */
async function* textAnswer(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/**
 * Answer the first request with tool calls and every later request with text.
 * @param calls - calls the model asks for on the step that has no tool result yet.
 * @returns the transport script.
 */
function callThenFinish(calls: readonly ScriptedCall[]): (request: GenerateOptions) => AsyncIterable<StreamChunk> {
  return (request) =>
    request.messages.some((message) => message.role === 'tool')
      ? textAnswer('done')
      : toolCallsAnswer(calls)
}

/** All text of one request's tool-role messages. */
function toolResultText(request: GenerateOptions): string {
  return request.messages
    .filter((message) => message.role === 'tool')
    .flatMap((message) => message.content)
    .map((block: ContentBlock) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

describe('native skill mechanism', () => {
  it('discovers the skill in the catalog and loads its body only after invocation', async () => {
    const harness = await mountPresetHarness({
      answer: callThenFinish([{ id: 'skill-call-1', name: 'skill', args: { name: SKILL_NAME } }]),
    })
    try {
      await harness.startNexus()
      const agent = await harness.createAgent('native-skill', NEXUS_PRESET_ID)
      // The catalog is published before the first request; the body is not.
      await harness.runTurn(agent, 'use the fixture skill')

      const session = harness.requests.filter((request) => request.options.sessionId === agent.id)
      expect(session.length, 'the turn made at least the tool step and the follow-up request').toBeGreaterThanOrEqual(2)
      const beforeLoad = requestText(session[0]!.options)
      const afterLoad = requestText(session.at(-1)!.options)

      // The native catalog is a real contribution of the native skill mechanism.
      expect(beforeLoad).toContain(SKILL_NAME)
      expect(beforeLoad).toContain(SKILL_DESCRIPTION)
      const skillBodyBeforeLoad = beforeLoad.includes(SKILL_BODY)
      const skillBodyAfterLoad = afterLoad.includes(SKILL_BODY)
      expect(skillBodyBeforeLoad).toBe(false)
      expect(skillBodyAfterLoad).toBe(true)

      // The body arrived as the native tool result, in its canonical envelope.
      const toolText = toolResultText(session.at(-1)!.options)
      expect(toolText).toContain(`<skill_content name="${SKILL_NAME}">`)
      expect(toolText).toContain(SKILL_BODY)

      // The native call/result markers are preserved on the durable session log.
      const events = agent.session.snapshotEvents()
      const call = events.find((event) => event.type === 'tool/call' && event.data.name === 'skill')
      expect(call).toBeDefined()
      const result = events.find((event) => event.type === 'tool/result')
      expect(result).toBeDefined()
    } finally {
      await harness.dispose()
    }
  }, 120_000)
})

describe('native question and todo mechanisms', () => {
  it('completes ask_user_question and todo_write with the native call markers', async () => {
    const harness = await mountPresetHarness({
      answer: callThenFinish([
        {
          id: 'ask-call-1',
          name: 'ask_user_question',
          args: {
            questions: [
              {
                id: 'proceed',
                question: 'Proceed with the integration check?',
                header: 'Confirm',
                options: [{ label: 'Yes (Recommended)' }, { label: 'No' }],
              },
            ],
          },
        },
        {
          id: 'todo-call-1',
          name: 'todo_write',
          args: {
            todos: [
              { content: 'run the integration check', status: 'in_progress' },
              { content: 'record the evidence', status: 'pending' },
            ],
          },
        },
      ]),
    })
    try {
      // The answerer is a real waterfall listener on the native service, so the
      // blocking `ask` path completes instead of being stubbed at the tool.
      const seen: string[] = []
      harness.ctx.on('user-questions/request', async (request) => {
        seen.push(request.questions[0]?.id ?? '')
        return { answers: request.questions.map((question) => ({ id: question.id, selected: ['Yes (Recommended)'] })) }
      })
      await harness.startNexus()
      const agent = await harness.createAgent('native-ask-todo', NEXUS_PRESET_ID)
      await harness.runTurn(agent, 'ask me and track the work')

      expect(seen).toEqual(['proceed'])

      // Both tools really completed through the shipped pipeline.
      const session = harness.requests.filter((request) => request.options.sessionId === agent.id)
      const latest = session.at(-1)!.options
      expect(toolResultText(latest)).toContain('"selected":["Yes (Recommended)"]')
      expect(toolResultText(latest)).toContain('Updated todo list: 1 pending, 1 in progress, 0 completed.')

      // Native markers: the assistant tool calls are model-produced, the results
      // are tool-role messages linked by the provider-issued call id, and the
      // original user input keeps its user marker.
      const assistant = latest.messages.find((message) => message.role === 'assistant')
      const toolCalls = assistant?.content.filter(
        (block) => block.type === 'tool-call' && (block.name === 'ask_user_question' || block.name === 'todo_write'),
      )
      expect(toolCalls).toHaveLength(2)
      expect(assistant?.source.kind).toBe('model')
      const toolMessages = latest.messages.filter((message) => message.role === 'tool')
      expect(toolMessages.map((message) => message.toolCallId).sort()).toEqual(['ask-call-1', 'todo-call-1'])
      for (const message of toolMessages) expect(message.source?.kind).toBe('tool')
      expect(latest.messages.some((message) => message.role === 'user' && message.source?.kind === 'user')).toBe(true)

      // The durable session log carries the native todo mutation and both calls.
      const events = agent.session.snapshotEvents()
      expect(events.filter((event) => event.type === 'tool/call').map((event) => event.data.name)).toEqual(
        expect.arrayContaining(['ask_user_question', 'todo_write']),
      )
      expect(events.filter((event) => event.type === 'tool/result')).toHaveLength(2)
      expect(harness.ctx.sessionProjections.stateOf(agent.session, 'todos' as never)).toEqual([
        { content: 'run the integration check', status: 'in_progress' },
        { content: 'record the evidence', status: 'pending' },
      ])
    } finally {
      await harness.dispose()
    }
  }, 120_000)
})

describe('generation retirement', () => {
  it('retires a Nexus generation through the native registry and keeps the write authority', async () => {
    const harness = await mountPresetHarness({
      // The provider can settle the process but never proves the range empty.
      subprocessScript: () => ({ staysOpen: true, cleanupUnconfirmed: true }),
    })
    try {
      const runtime = await harness.startNexus()
      // A second definition composed from the accepted Nexus definition: its
      // generation can be retired by the native registry on its own.
      const unregister = await harness.ctx.agentPresets.register({
        ...createNexusPreset({}, { compaction: 'absent', evidence: [] }),
        id: 'nexus-generation-only',
        name: 'Nexus generation only',
        order: 9,
      })

      const parent = await harness.createAgent('retire-parent', 'nexus-generation-only')
      await harness.runTurn(parent, 'parent')

      const started = await harness.call(
        'agent',
        { action: 'start', task: 'writing child', context: 'spawn', access: 'write' },
        parent,
      )
      expect(started.isError, JSON.stringify(started)).toBe(false)
      const childId = (started.value as { childId: string }).childId
      const child = harness.ctx.agents.get(SessionId(childId))
      expect(child).toBeDefined()

      const run = await harness.call('shell', { action: 'run', command: 'retired-build', background: true }, child!)
      expect(run.isError, JSON.stringify(run)).toBe(false)
      const resourceId = (run.value as { process: { resourceId: string } }).process.resourceId
      const root = await canonicalDirectory(harness.workspace)

      // Stopping the child is not a cleanup receipt: the range is unconfirmed.
      const stopped = await harness.call('agent', { action: 'stop', childId }, parent)
      expect(stopped.isError, JSON.stringify(stopped)).toBe(false)
      expect(stopped.value).toMatchObject({ released: false, scopeRetained: root })
      expect(runtime.coordinator.scopeOf(SessionId(childId))).toEqual({ root, state: 'unconfirmed' })

      // Retire the generation the NATIVE way: dispose the bound Agent, then
      // unregister the definition so the registry collects the generation scope.
      await harness.disposeAgent(parent)
      await unregister()

      // The retired generation's cleanup report reached the root runtime...
      const status = await runtime.dispose()
      expect(status.released).toBe(false)
      expect(status.unconfirmedResources.join('\n')).toContain(resourceId)
      // ...and the child's durable write authority is still retained. The
      // runtime store closed with its runtime, so the durable record is read back
      // through a fresh store handle over the same medium.
      expect(status.retainedScopes.map((scope) => scope.childId)).toContain(SessionId(childId))
      const durable = await harness.fixture.open()
      try {
        expect(await durable.listWriteScopes()).toContainEqual({ childId, root })
        expect(await durable.getChildPolicy(childId)).toMatchObject({ childId, parentSessionId: 'retire-parent' })
      } finally {
        await durable.dispose()
      }
      expect(await harness.fixture.readMedium()).toContain(childId)

      // A restart over the same medium: the retired generation is gone, yet the
      // resolution refuses the tree. Absence is not a cleanup receipt.
      //
      // The restart sub-composition is guarded from the moment it is created: a
      // mount or activation failure must not leak the context, the fixture store
      // or the runtime it may already have opened.
      const restartedCtx = new Context()
      let restartedFixture: NexusStoreFixture | undefined
      let restarted: NexusRuntime | undefined
      try {
        restartedFixture = await mountNexusStoreFixture({ ctx: restartedCtx, root: harness.fixture.root })
        const row = restartedCtx.plugin({
          name: 'nexus-restart-row',
          inject: ['storageDomain'],
          async apply(pluginCtx: Context): Promise<void> {
            restarted = await openNexusRuntime(pluginCtx, {})
          },
        })
        await row
        const restartedRuntime = restarted
        if (restartedRuntime === undefined) throw new Error('the restart row did not open the runtime')
        expect(restartedRuntime.coordinator.scopeOf(SessionId(childId))).toEqual({ root, state: 'unconfirmed' })
        const rival = await harness.ctx.agents.create({
          sessionId: SessionId('post-retirement-writer'),
          meta: { cwd: harness.workspace },
          agentOptions: { ...PRESET_ROUTE },
        })
        try {
          await expect(restartedRuntime.coordinator.acquire(rival.agent, SessionId('post-retirement-writer'), root)).rejects.toMatchObject(
            { code: 'WRITE_SCOPE_BUSY' },
          )
        } finally {
          await rival.dispose()
        }
      } finally {
        await restarted?.dispose()
        await restartedFixture?.dispose()
        await restartedCtx.fiber.dispose()
      }
      expect(harness.ctx.agentPresets.inspectCompositions().map((entry) => entry.id)).not.toContain(
        'nexus-generation-only',
      )
      // The host Nexus definition is untouched by the retirement.
      expect(harness.ctx.agentPresets.inspectCompositions().map((entry) => entry.id)).toContain(NEXUS_PRESET_ID)
    } finally {
      await harness.dispose()
    }
  }, 180_000)
})
