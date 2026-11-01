/**
 * The Nexus persona as the model actually receives it (PR-06…PR-11, PR-14, PR-16).
 *
 * Every case drives the real native path: the production AgentLoop builds the
 * request, the shipped `SystemPrompt` registry assembles the sections, and the
 * scripted transport only stands in for the provider — so nothing here proves a
 * live model, account or network. The assertions read the captured
 * `GenerateOptions.messages` the provider would see, never a hand-built role
 * array: the persona must arrive as the system-role prompt node, module text
 * must not appear as conversation history, and a native workspace-instruction
 * context stays an independent contribution.
 *
 * @module dsh-nexus/test/prompts/request
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import * as Instructions from '@deepseek-ai/dsh-agent-instructions'
import type { PromptLibrary, PromptModule } from '../../src/protocol.ts'
import { BASE_PROMPT } from '../../src/prompts/base.ts'
import { composePromptText } from '../../src/prompts/assemble.ts'
import { registerPromptSections } from '../../src/prompts/register.ts'
import { createPromptSessions, type PromptSessions } from '../../src/prompts/sessions.ts'
import type { NexusStore } from '../../src/storage/store.ts'
import { mountNexusStoreFixture, type NexusStoreFixture } from '../support/fixtures.ts'
import { mountSubagentHarness, waitFor, type ScriptedRequest, type SubagentHarness } from '../support/agent-harness.ts'

/** Deployment persona the mounted registry starts with, so a shadow is observable. */
const DEPLOYMENT_PERSONA_PREFIX = 'DEPLOYMENT PERSONA PREFIX'
/** Deployment persona suffix, which no case may remove. */
const DEPLOYMENT_PERSONA_SUFFIX = 'DEPLOYMENT PERSONA SUFFIX'
/** Third-party section a Nexus agent must keep contributing. */
const THIRD_PARTY_SECTION = 'THIRD-PARTY GUIDANCE'

/** One open case and everything it owns. */
interface OpenCase {
  readonly harness: SubagentHarness
  readonly fixture: NexusStoreFixture
  readonly store: NexusStore
  readonly sessions: PromptSessions
  /** Create one Nexus Agent: its scope registers the persona sections. */
  createNexusAgent(id: string): Promise<AgentHandle>
  /** Create one Nexus child owned by `parent`. */
  createNexusChild(parent: Agent, id: string): Promise<AgentHandle>
  /** Create one unrelated Agent that never joins the Nexus registration. */
  createUnrelatedAgent(id: string): Promise<AgentHandle>
  /** Replace the library record, presenting the current hash. */
  saveLibrary(value: PromptLibrary): Promise<void>
  /** Disposer of the last created Nexus Agent's section registration. */
  sectionDisposer(): () => void
  /** Point the native home resolution at empty project-local directories. */
  isolateHomes(): Promise<void>
  /** Undo any process-environment isolation this case applied. */
  restoreEnvironment(): void
}

/** Cases still open, disposed after each test. */
const open: { readonly openCase: OpenCase; readonly agents: AgentHandle[] }[] = []

afterEach(async () => {
  for (const entry of open.splice(0)) {
    for (const handle of entry.agents.splice(0)) await handle.dispose().catch(() => undefined)
    entry.openCase.restoreEnvironment()
    await entry.openCase.store.dispose().catch(() => undefined)
    await entry.openCase.fixture.dispose().catch(() => undefined)
    await entry.openCase.harness.dispose().catch(() => undefined)
  }
})

/**
 * Mount the native composition, the durable store, the persona sections and one
 * independent third-party prompt contribution.
 * @param options - library saved before the case starts and whether answers are held.
 * @returns the open case.
 */
async function openRequestCase(
  options: { library?: PromptLibrary; hold?: boolean } = {},
): Promise<OpenCase> {
  const harness = await mountSubagentHarness({
    hold: options.hold ?? false,
    systemPrompt: { personaPrefix: DEPLOYMENT_PERSONA_PREFIX, personaSuffix: DEPLOYMENT_PERSONA_SUFFIX },
  })
  harness.ctx.systemPrompt.section({ name: 'test:third-party', order: 3_000, text: `${THIRD_PARTY_SECTION} {{secret}}` })
  harness.ctx.systemPrompt.variable('secret', () => 'INTERPOLATED-VALUE')
  const fixture = await mountNexusStoreFixture()
  const store = await fixture.open()
  const sessions = createPromptSessions(harness.ctx, store)
  const current = await store.readLibrary()
  await store.saveLibrary(options.library ?? { modules: [], defaultSelection: [] }, current.hash)
  const agents: AgentHandle[] = []
  const disposers: (() => void)[] = []
  const restores: (() => void)[] = []
  const openCase: OpenCase = {
    harness,
    fixture,
    store,
    sessions,
    async createNexusAgent(id) {
      const handle = await harness.ctx.agents.create({
        sessionId: SessionId(id),
        agentOptions: { provider: 'nexus-test', model: 'nexus-test-model' },
        meta: { cwd: harness.workspace },
        setup: (agentCtx) => {
          disposers.push(registerPromptSections(agentCtx, sessions))
        },
      })
      agents.push(handle)
      return handle
    },
    async createNexusChild(parent, id) {
      const handle = await harness.ctx.agents.create({
        sessionId: SessionId(id),
        parentAgent: parent,
        agentOptions: { provider: 'nexus-test', model: 'nexus-test-model' },
        meta: { cwd: harness.workspace, parentSession: parent.session.id, origin: 'subagent', delegationDepth: 1 },
        setup: (agentCtx) => {
          disposers.push(registerPromptSections(agentCtx, sessions))
        },
      })
      agents.push(handle)
      return handle
    },
    async createUnrelatedAgent(id) {
      const handle = await harness.ctx.agents.create({
        sessionId: SessionId(id),
        agentOptions: { provider: 'nexus-test', model: 'nexus-test-model' },
        meta: { cwd: harness.workspace },
      })
      agents.push(handle)
      return handle
    },
    async saveLibrary(value) {
      const stored = await store.readLibrary()
      await store.saveLibrary(value, stored.hash)
    },
    sectionDisposer() {
      const last = disposers.at(-1)
      if (last === undefined) throw new Error('no Nexus section registration exists in this case')
      return last
    },
    async isolateHomes() {
      restores.push(await isolateHarnessHomes(harness.root))
    },
    restoreEnvironment() {
      for (const restore of restores.splice(0)) restore()
    },
  }
  open.push({ openCase, agents })
  return openCase
}

/**
 * Point the native home resolution at empty project-local directories, so the
 * workspace-instruction case never reads the machine's own `~/.dsh` or
 * `~/.agents` files.
 * @param root - project-local case root.
 * @returns a restore function for the previous environment.
 */
async function isolateHarnessHomes(root: string): Promise<() => void> {
  const dshHome = join(root, 'isolated-home', '.dsh')
  const agentsHome = join(root, 'isolated-home', '.agents')
  await mkdir(dshHome, { recursive: true })
  await mkdir(agentsHome, { recursive: true })
  const beforeDshHome = process.env['DSH_HOME']
  const beforeAgentsHome = process.env['DSH_AGENTS_HOME']
  process.env['DSH_HOME'] = dshHome
  process.env['DSH_AGENTS_HOME'] = agentsHome
  return () => {
    if (beforeDshHome === undefined) delete process.env['DSH_HOME']
    else process.env['DSH_HOME'] = beforeDshHome
    if (beforeAgentsHome === undefined) delete process.env['DSH_AGENTS_HOME']
    else process.env['DSH_AGENTS_HOME'] = beforeAgentsHome
  }
}

/** One prompt module. */
function moduleOf(id: string, body: string): PromptModule {
  return { id, name: `${id} name`, body }
}

/**
 * Join the text blocks of one message.
 * @param message - model-facing message.
 * @returns its text content.
 */
function textOf(message: GenerateOptions['messages'][number]): string {
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
}

/**
 * Read the effective system prompt of one captured request.
 *
 * The loop sends the prompt as derived history, not as `GenerateOptions.system`.
 * This scripted route declares no `systemPromptUpdate`, so the loop keeps exactly
 * one normalized system node and refreshes it in place; a route that declared
 * `'in-history'` would instead append a changed prompt after the cached history,
 * and an empty rendering clears nodes through logged empty replacements. The last
 * NON-EMPTY system node is therefore the prompt the provider would read in every
 * one of those shapes.
 * @param options - captured request.
 * @returns the system prompt text the provider would read.
 */
function systemText(options: GenerateOptions): string {
  const nodes = options.messages.filter((message) => message.role === 'system')
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    const text = node === undefined ? '' : textOf(node)
    if (text !== '') return text
  }
  return ''
}

/**
 * Join every non-system message, so a case can prove what is conversation and
 * what is not.
 * @param options - captured request.
 * @returns the conversation text.
 */
function conversationText(options: GenerateOptions): string {
  return options.messages
    .filter((message) => message.role !== 'system')
    .map((message) => textOf(message))
    .join('\n')
}

/**
 * Read the first captured request of one session.
 * @param harness - mounted native composition.
 * @param sessionId - session whose request is wanted.
 * @returns the request.
 */
function firstRequest(harness: SubagentHarness, sessionId: string): ScriptedRequest {
  const request = harness.requestsOf(sessionId)[0]
  if (request === undefined) throw new Error(`session "${sessionId}" sent no model request`)
  return request
}

/**
 * Read one session's assistant segments.
 * @param agent - agent whose durable session is inspected.
 * @returns each assistant message with its turn and interruption marker.
 */
function assistantSegments(agent: Agent): { turn: number; text: string; interrupted: boolean }[] {
  return agent.session.snapshotEvents().flatMap((event) =>
    event.type === 'assistant/message'
      ? [{ turn: event.data.turn, text: textOf(event.data.message), interrupted: event.data.interrupted === true }]
      : [],
  )
}

/**
 * Read the Nexus error code a call refuses with.
 * @param run - call expected to throw.
 * @returns the code, or `undefined` when the call returned normally.
 */
function failureCode(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return (error as { code?: unknown }).code
  }
  return undefined
}

describe('the Nexus persona in a real request', () => {
  it('arrives as the system layer, literally, while every native and third-party section survives', async () => {
    const literal = moduleOf('literal', 'M1 literal {{secret}} and ${HOME}\n  keep  spacing ')
    const openCase = await openRequestCase({ library: { modules: [literal], defaultSelection: ['literal'] } })
    const { agent } = await openCase.createNexusAgent('session-a')

    await openCase.harness.runTurn(agent, 'hello')
    const request = firstRequest(openCase.harness, 'session-a')
    const system = systemText(request.options)

    expect(system.startsWith('You are an AI agent powered by DeepSeek Harness.')).toBe(true)
    expect(system).toContain(BASE_PROMPT)
    expect(system).toContain('M1 literal {{secret}} and ${HOME}\n  keep  spacing ')
    expect(system).toContain(`${THIRD_PARTY_SECTION} INTERPOLATED-VALUE`)
    expect(system).toContain(DEPLOYMENT_PERSONA_SUFFIX)
    expect(system).not.toContain(DEPLOYMENT_PERSONA_PREFIX)
    expect(request.options.system).toBeUndefined()
    expect(request.options.provider).toBe('nexus-test')
    expect(request.options.model).toBe('nexus-test-model')
    expect(conversationText(request.options)).not.toContain('M1 literal')
    expect(openCase.sessions.peek(agent).text).toBe(composePromptText([literal]))
    expect(system).toContain(openCase.sessions.peek(agent).text)
  })

  it('leaves an unrelated Agent on the deployment persona instead of hijacking every agent', async () => {
    const openCase = await openRequestCase({
      library: { modules: [moduleOf('m1', 'NEXUS BODY')], defaultSelection: ['m1'] },
    })
    const { agent: nexusAgent } = await openCase.createNexusAgent('session-nexus')
    const { agent: plainAgent } = await openCase.createUnrelatedAgent('session-plain')

    await openCase.harness.runTurn(nexusAgent, 'nexus turn')
    await openCase.harness.runTurn(plainAgent, 'plain turn')

    const nexusSystem = systemText(firstRequest(openCase.harness, 'session-nexus').options)
    const plainSystem = systemText(firstRequest(openCase.harness, 'session-plain').options)
    expect(nexusSystem).toContain(BASE_PROMPT)
    expect(nexusSystem).not.toContain(DEPLOYMENT_PERSONA_PREFIX)
    expect(plainSystem).toContain(DEPLOYMENT_PERSONA_PREFIX)
    expect(plainSystem).not.toContain(BASE_PROMPT)
    expect(failureCode(() => openCase.sessions.peek(plainAgent))).toBe('NO_AGENT')
  })

  it('keeps an in-flight request byte for byte and applies the new text from the next request', async () => {
    const first = moduleOf('first', 'FIRST BODY')
    const second = moduleOf('second', 'SECOND BODY')
    const openCase = await openRequestCase({
      library: { modules: [first, second], defaultSelection: ['first'] },
      hold: true,
    })
    const { agent } = await openCase.createNexusAgent('session-a')

    const openingTurn = openCase.harness.runTurn(agent, 'first')
    await waitFor(() => openCase.harness.heldSessions().includes('session-a'), 'the first request to wait for its permit')
    const sent = firstRequest(openCase.harness, 'session-a')
    const sentSystem = systemText(sent.options)
    expect(sentSystem).toContain('FIRST BODY')

    const applied = await openCase.sessions.apply(agent, ['second'], (await openCase.store.readLibrary()).hash)
    openCase.harness.release()
    await openingTurn

    const delivered = firstRequest(openCase.harness, 'session-a')
    expect(systemText(delivered.options)).toBe(sentSystem)
    expect(systemText(delivered.options)).not.toContain('SECOND BODY')
    expect(applied.text).toContain('SECOND BODY')
    const segments = assistantSegments(agent)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.interrupted).toBe(false)
    expect(segments[0]?.text).toBe(delivered.answer)

    const nextTurn = openCase.harness.runTurn(agent, 'second')
    await waitFor(() => openCase.harness.heldSessions().includes('session-a'), 'the next request to wait for its permit')
    openCase.harness.release()
    await nextTurn

    const next = openCase.harness.requestsOf('session-a')[1]
    if (next === undefined) throw new Error('the second turn sent no model request')
    expect(systemText(next.options)).toContain('SECOND BODY')
    expect(systemText(next.options)).not.toContain('FIRST BODY')
    expect(assistantSegments(agent)).toHaveLength(2)
  })

  it('keeps the native workspace instruction context independent from the Nexus persona', async () => {
    const openCase = await openRequestCase({
      library: { modules: [moduleOf('m1', 'NEXUS BODY')], defaultSelection: ['m1'] },
    })
    await openCase.isolateHomes()
    await writeFile(join(openCase.harness.workspace, 'AGENTS.md'), 'PROJECT AGENTS GUIDANCE\n', 'utf8')
    await openCase.harness.ctx.plugin(Instructions, { maxBytes: 65_536 })
    const { agent } = await openCase.createNexusAgent('session-a')

    await openCase.harness.runTurn(agent, 'follow the workspace guidance')
    const request = firstRequest(openCase.harness, 'session-a')
    const system = systemText(request.options)

    expect(conversationText(request.options)).toContain('PROJECT AGENTS GUIDANCE')
    expect(system).not.toContain('PROJECT AGENTS GUIDANCE')
    expect(system).toContain(BASE_PROMPT)
    expect(system).toContain('NEXUS BODY')
  })

  it('gives a Nexus child the parent actual persona even after the module was deleted', async () => {
    const parentModule = moduleOf('parent', 'PARENT PERSONA BODY')
    const openCase = await openRequestCase({
      library: { modules: [parentModule], defaultSelection: ['parent'] },
    })
    const { agent: parent } = await openCase.createNexusAgent('session-parent')
    await openCase.harness.runTurn(parent, 'parent turn')
    await openCase.saveLibrary({ modules: [], defaultSelection: [] })

    const { agent: child } = await openCase.createNexusChild(parent, 'session-child')
    await openCase.harness.runTurn(child, 'child turn')

    const childSystem = systemText(firstRequest(openCase.harness, 'session-child').options)
    expect(childSystem).toContain('PARENT PERSONA BODY')
    expect(childSystem).not.toContain(DEPLOYMENT_PERSONA_PREFIX)
    expect(openCase.sessions.peek(child).text).toBe(openCase.sessions.peek(parent).text)
  })

  it('stops contributing the persona once its registration is disposed', async () => {
    const openCase = await openRequestCase({
      library: { modules: [moduleOf('m1', 'NEXUS BODY')], defaultSelection: ['m1'] },
    })
    const { agent } = await openCase.createNexusAgent('session-a')
    await openCase.harness.runTurn(agent, 'before unload')
    expect(systemText(firstRequest(openCase.harness, 'session-a').options)).toContain(BASE_PROMPT)

    openCase.sectionDisposer()()
    openCase.sectionDisposer()()

    await openCase.harness.runTurn(agent, 'after unload')
    const after = openCase.harness.requestsOf('session-a')[1]
    if (after === undefined) throw new Error('the turn after the disposal sent no model request')
    expect(systemText(after.options)).not.toContain(BASE_PROMPT)
    expect(systemText(after.options)).toContain(DEPLOYMENT_PERSONA_PREFIX)
  })
})
