/**
 * The real native subagent composition Nexus child tests drive.
 *
 * Everything a child actually needs is the shipped implementation: the
 * production AgentLoop, the real `ctx.subagents` service, the shipped in-process
 * `spawn`/`fork` providers, the JSONL session-persistence backend, the SQLite
 * session-query backend over an in-memory database, the real working-directory
 * service and the enforcing filesystem backend with the real shared
 * sandbox-policy service. Only the model transport is scripted — no adapter
 * request leaves the process and no account is involved, so every case here is
 * a NOT-a-live-model proof.
 *
 * State stays project-local: the session store, the workspace and the SQLite
 * database all live under `node_modules/.cache/dsh-nexus-test/<case>/`.
 *
 * @module dsh-nexus/test/support/agent-harness
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ForkProvider from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as PersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
  type AgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  mountLocalFileSystem,
  mountModelRoute,
  mountSandboxedFileSystem,
  type CountingLocalFileSystem,
  type CountingSandboxedFileSystem,
} from './fixtures.ts'

/** Project-local cache directory; no test state leaves the checkout. */
const CACHE_DIR = fileURLToPath(new URL('../../node_modules/.cache/dsh-nexus-test/', import.meta.url))

/** Provider and model the scripted transport serves. */
export const SCRIPTED_ROUTE = { provider: 'nexus-test', model: 'nexus-test-model' } as const

/** One assembled model request the scripted transport answered. */
export interface ScriptedRequest {
  /** Request whose answer this was. */
  readonly options: GenerateOptions
  /** Text this harness answered with. */
  readonly answer: string
}

/** What to mount for one subagent harness. */
export interface SubagentHarnessOptions {
  /** Deployment sandbox mode; defaults to `workspace-write`. */
  readonly mode?: SandboxMode
  /** Register only the named in-process providers; defaults to both. */
  readonly providers?: readonly ('spawn' | 'fork')[]
  /**
   * Mount the shared sandbox-policy service and the enforcing filesystem;
   * defaults to true. A case that proves a missing-enforcement refusal turns
   * it off, which mounts the plain host backend instead.
   */
  readonly policy?: boolean
  /**
   * Hold each scripted answer until {@link SubagentHarness.release}. A case
   * needs this to run tool calls as a child that is still inside its turn, or
   * to keep a resumed child resident while it inspects coordination state.
   * `'children'` holds only requests stamped for a subagent session, so a case
   * can still run complete parent turns.
   */
  readonly hold?: boolean | 'children'
  /**
   * Answer one assembled request. Defaults to `answer-<n>`; a case uses this to
   * make a child produce a specific text or a tool call.
   */
  readonly answer?: (request: GenerateOptions, index: number) => string | AsyncIterable<StreamChunk>
}

/** One mounted native child composition. */
export interface SubagentHarness {
  /** Context carrying every mounted service. */
  readonly ctx: Context
  /** Project-local temp root the case owns. */
  readonly root: string
  /** Session workspace; the parent's cwd and the `workspace-write` boundary. */
  readonly workspace: string
  /** Production AgentLoop test driver. */
  readonly loop: AgentLoopTestHarness
  /** Filesystem backend actually mounted as `ctx.fs`. */
  readonly fs: CountingSandboxedFileSystem | CountingLocalFileSystem
  /** Every model request the scripted transport answered, in order. */
  readonly requests: ScriptedRequest[]
  /**
   * Model requests the loop stamped for one session, in order. A parent that
   * receives a settlement notice also runs a turn, so a case must attribute
   * requests by session instead of by global order.
   * @param sessionId - durable session id the loop stamped on the request.
   * @returns that session's requests.
   */
  requestsOf(sessionId: string): ScriptedRequest[]
  /**
   * Create a production top-level Agent on the scripted route.
   * @param id - session id.
   * @param cwd - session workspace; defaults to the harness workspace.
   * @returns the live Agent.
   */
  createParent(id: string, cwd?: string): Promise<Agent>
  /** Register one tool definition in this scope. */
  register(tool: ToolDefinition): void
  /**
   * Run one registered tool through the real registry pipeline.
   * @param name - registered tool name.
   * @param args - model-shaped arguments; the registry validates them.
   * @param agent - caller; defaults to the first created parent.
   * @returns the normalized execution result.
   */
  call(name: string, args: Record<string, unknown>, agent?: Agent): Promise<ToolExecutionResult>
  /**
   * Run one complete parent turn with a plain user message and wait for its
   * durable `turn/end`.
   * @param agent - agent to wake.
   * @param text - user text.
   * @returns after the turn closed.
   */
  runTurn(agent: Agent, text: string): Promise<void>
  /** Let the next held scripted answer proceed (one permit per call). */
  release(): void
  /** Let every held scripted answer proceed. */
  releaseAll(): void
  /** Number of scripted answers currently waiting for a permit. */
  readonly held: number
  /** Unload the composition and delete the temp root. */
  dispose(): Promise<void>
}

/**
 * Mount the native composition once per case.
 * @param options - sandbox mode, providers and scripted answers.
 * @returns the harness, ready for a parent Agent.
 */
export async function mountSubagentHarness(options: SubagentHarnessOptions = {}): Promise<SubagentHarness> {
  await mkdir(CACHE_DIR, { recursive: true })
  const root = await mkdtemp(join(CACHE_DIR, 'agent-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const policyMounted = options.policy !== false
  if (policyMounted) {
    await ctx.plugin(SandboxPolicyService, { mode: options.mode ?? 'workspace-write', workspaceRoot: workspace })
  }
  const fs = policyMounted
    ? await mountSandboxedFileSystem(ctx, { root, cwd: workspace })
    : await mountLocalFileSystem(ctx, { root, cwd: workspace })
  await ctx.plugin(WorkingDirectory, { defaultDirectory: workspace })
  await ctx.plugin(PersistenceJsonl, { root: join(root, 'sessions') })
  await ctx.plugin(SqliteSessionQueryEngine, { path: ':memory:', openAt: 'never' })
  const requests: ScriptedRequest[] = []
  const permits = createPermits()
  mountModelRoute(ctx, {
    ...SCRIPTED_ROUTE,
    stream: (request) =>
      scriptedStream(options, request, requests, permits, (sessionId) => {
        const session = sessionId === undefined ? undefined : ctx.sessions.get(SessionId(sessionId))
        return session?.header.origin === 'subagent'
      }),
  })
  const loop = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(SubagentRuntime, { maxDepth: 8, maxActiveSubagents: 8 })
  const providers = options.providers ?? ['spawn', 'fork']
  if (providers.includes('spawn')) await ctx.plugin(SpawnProvider)
  if (providers.includes('fork')) await ctx.plugin(ForkProvider)
  let disposed = false
  let callCount = 0
  const parents: Agent[] = []
  const parentOf = (agent?: Agent): Agent => {
    const chosen = agent ?? parents[0]
    if (chosen === undefined) throw new Error('no parent Agent was created in this harness')
    return chosen
  }

  return {
    ctx,
    root,
    workspace,
    loop,
    fs,
    requests,
    requestsOf(sessionId) {
      return requests.filter((request) => request.options.sessionId === sessionId)
    },
    release() {
      permits.release()
    },
    releaseAll() {
      permits.releaseAll()
    },
    get held() {
      return permits.held
    },
    async createParent(id, cwd = workspace) {
      const agent = await loop.create(SessionId(id), { ...SCRIPTED_ROUTE }, { cwd })
      parents.push(agent)
      return agent
    },
    register(tool) {
      ctx.tools.register(tool)
    },
    call(name, args, agent) {
      callCount += 1
      return ctx.tools.execute({
        callId: ToolCallId(`harness-call-${callCount}`),
        name,
        arguments: args,
        agent: parentOf(agent),
        signal: new AbortController().signal,
      })
    },
    async runTurn(agent, text) {
      const closed = () => agent.session.snapshotEvents().filter((event) => event.type === 'turn/end').length
      const before = closed()
      agent.followup({
        id: MessageId(`harness-user-${before}-${Date.now()}`),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
      const deadline = Date.now() + 5_000
      while (closed() <= before) {
        if (Date.now() > deadline) throw new Error('the parent turn did not close')
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      permits.releaseAll()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** Yield the scripted answer for one request and record it. */
async function* scriptedStream(
  options: SubagentHarnessOptions,
  request: GenerateOptions,
  requests: ScriptedRequest[],
  permits: Permits,
  isChildSession: (sessionId: string | undefined) => boolean,
): AsyncGenerator<StreamChunk> {
  const answer = options.answer?.(request, requests.length) ?? `answer-${requests.length}`
  const held = options.hold === true || (options.hold === 'children' && isChildSession(request.sessionId))
  if (typeof answer === 'string') {
    requests.push({ options: request, answer })
    if (held) await permits.acquire()
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: answer }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
    return
  }
  requests.push({ options: request, answer: '' })
  if (held) await permits.acquire()
  yield* answer
}

/** Counting permits that hold one scripted answer each. */
interface Permits {
  acquire(): Promise<void>
  release(): void
  releaseAll(): void
  readonly held: number
}

/** Build a fresh permit set. */
function createPermits(): Permits {
  let available = 0
  const waiting: (() => void)[] = []
  return {
    async acquire() {
      if (available > 0) {
        available -= 1
        return
      }
      await new Promise<void>((resolve) => waiting.push(resolve))
    },
    release() {
      const next = waiting.shift()
      if (next === undefined) available += 1
      else next()
    },
    releaseAll() {
      while (waiting.length > 0) waiting.shift()?.()
      available = 0
    },
    get held() {
      return waiting.length
    },
  }
}

/**
 * Wait until a predicate holds, then return.
 * @param predicate - condition to poll.
 * @param label - what the case was waiting for, used in the timeout message.
 * @param timeoutMs - bounded wait; defaults to 5s.
 * @returns after the predicate first holds.
 * @throws when the bounded wait elapses.
 */
export async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
