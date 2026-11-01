/**
 * The tool-pipeline harness every Nexus tool test drives.
 *
 * A harness owns one fresh cordis context with the SDK's standard test
 * prerequisites mounted — the shipped `llm`, `sessions`, `systemPrompt`,
 * `tools`, `agents` and `agentLoop` services — one real Agent created by the
 * production loop, and the three capability doubles from `fixtures.ts`
 * registered as `ctx.fs`, `ctx.web` and `ctx.subprocess`.
 *
 * A real Agent matters: `Agent` is not an identity-only interface, and tool code
 * legitimately reads `exec.agent.session`, `status` and the agent-scoped
 * context. A hand-built stub would let a tool pass here and fail in the harness.
 * The Agent is created through the SDK's own test harness, so no model adapter
 * is involved and no request is ever sent.
 *
 * A test registers the tools it means to exercise on {@link ToolHarness.ctx} and
 * calls them through {@link ToolHarness.call}, which goes through
 * `ctx.tools.execute` — the real registry, argument validation and
 * pre/execute/post pipeline — not a shortcut around it.
 *
 * `dispose()` unloads the context and then asserts nothing survived, so a tool
 * or service that leaked a registration fails the suite instead of accumulating
 * quietly across cases.
 *
 * @module dsh-nexus/test/support/harness
 */

import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
  provideWorkingDirectoryFixture,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  createOwner,
  FsDouble,
  mountSubprocessDouble,
  mountWebDouble,
  type FsDoubleOptions,
  type HarnessOwner,
  type SubprocessDouble,
  type SubprocessDoubleOptions,
  type WebDouble,
  type WebDoubleOptions,
} from './fixtures.ts'

/** Caller identity and workspace the created Agent is given. */
export interface HarnessOwnerOptions {
  /** Session and Agent id; defaults to `harness-session`. */
  readonly sessionId?: string
  /** Cancellation used by every run; defaults to a fresh never-aborted signal. */
  readonly signal?: AbortSignal
}

/** What to mount in a fresh harness context. */
export interface ToolHarnessOptions {
  /** Explicit owner identity; the Agent is created under this session id. */
  readonly owner?: HarnessOwnerOptions
  /** Session working directory; defaults to `/workspace`, a path in the fs double. */
  readonly cwd?: string
  /** Seed files for the in-memory filesystem double. */
  readonly fs?: FsDoubleOptions
  /** Scripted answers for the web double. */
  readonly web?: WebDoubleOptions
  /** Scripts for the subprocess double. */
  readonly subprocess?: SubprocessDoubleOptions
}

/** One mounted harness and its explicit owner. */
export interface ToolHarness {
  /** Context a test registers tools on and reads services from. */
  readonly ctx: Context
  /** Explicit owner, carrying the real Agent every run is attributed to. */
  readonly owner: HarnessOwner
  /** In-memory filesystem double registered as `ctx.fs`. */
  readonly fs: FsDouble
  /** Scripted web service registered as `ctx.web`. */
  readonly web: WebDouble
  /** Scripted subprocess service registered as `ctx.subprocess`. */
  readonly subprocess: SubprocessDouble
  /**
   * Run one registered tool through the real registry pipeline.
   * @param name - registered tool name.
   * @param args - model-shaped arguments; the registry validates them.
   * @returns the normalized execution result (success value or structured failure).
   */
  call(name: string, args?: Record<string, unknown>): Promise<ToolExecutionResult>
  /**
   * Unload everything the harness mounted and assert no registration survived.
   * @returns after the context is empty.
   */
  dispose(): Promise<void>
}

/** Services the harness expects while mounted and expects gone afterwards. */
const HARNESS_SERVICES = [
  'llm',
  'sessions',
  'systemPrompt',
  'tools',
  'agents',
  'agentLoop',
  'workingDirectory',
  'fs',
  'web',
  'subprocess',
] as const

/**
 * Build a harness on a fresh context.
 * @param options - owner identity, workspace and double scripts.
 * @returns the mounted harness, ready for tool registration.
 */
export async function createToolHarness(options: ToolHarnessOptions = {}): Promise<ToolHarness> {
  const ctx = new Context()
  const cwd = options.cwd ?? '/workspace'
  await mountAgentLoopTestDependencies(ctx)
  provideWorkingDirectoryFixture(ctx, cwd)
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(SessionId(options.owner?.sessionId ?? 'harness-session'), {}, { cwd })
  const owner = createOwner(agent, options.owner?.signal)

  let mountedFs: FsDouble | undefined
  await ctx.plugin((pluginCtx) => {
    mountedFs = new FsDouble(pluginCtx, options.fs)
  })
  const web = await mountWebDouble(ctx, options.web)
  const subprocess = await mountSubprocessDouble(ctx, options.subprocess)
  if (mountedFs === undefined) throw new Error('the filesystem double did not mount')
  const fs = mountedFs
  let callCount = 0
  let disposed = false

  return {
    ctx,
    owner,
    fs,
    web,
    subprocess,
    async call(name, args = {}) {
      callCount += 1
      return ctx.tools.execute({
        callId: ToolCallId(`harness-call-${callCount}`),
        name,
        arguments: args,
        agent: owner.agent,
        signal: owner.signal,
      })
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await ctx.fiber.dispose()
      assertNoLeftovers(ctx)
    },
  }
}

/**
 * Fail when any tool or mounted service survived teardown.
 * @param ctx - the harness context after disposal.
 */
function assertNoLeftovers(ctx: Context): void {
  const tools = ctx.get('tools')
  if (tools !== undefined) {
    const remaining = tools.schemas()
    if (remaining.length > 0) {
      throw new Error(
        `harness leaks ${remaining.length} tool registration(s): ${remaining.map((schema) => schema.name).join(', ')}`,
      )
    }
  }
  for (const service of HARNESS_SERVICES) {
    if (ctx.get(service) !== undefined) throw new Error(`harness leaks the ${service} service`)
  }
}
