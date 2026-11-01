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
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
  provideWorkingDirectoryFixture,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  createOwner,
  FsDouble,
  mountAttachmentDouble,
  mountLocalFileSystem,
  mountModelRoute,
  mountSandboxedFileSystem,
  mountSubprocessDouble,
  mountWebDouble,
  CountingLocalFileSystem,
  CountingSandboxedFileSystem,
  type AttachmentDouble,
  type AttachmentDoubleOptions,
  type FsDoubleOptions,
  type HarnessOwner,
  type LocalFileSystemDoubleOptions,
  type ModelRouteOptions,
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

/** The shared sandbox policy plus the enforcing filesystem backend. */
export interface SandboxHarnessOptions {
  /** Deployment default mode; defaults to `workspace-write`. */
  readonly mode?: SandboxMode
  /** Absolute fallback workspace root; defaults to the session cwd. */
  readonly workspaceRoot?: string
  /** Backend relative-path base; defaults to the session cwd and may be broader. */
  readonly backendCwd?: string
}

/** What to mount in a fresh harness context. */
export interface ToolHarnessOptions {
  /** Explicit owner identity; the Agent is created under this session id. */
  readonly owner?: HarnessOwnerOptions
  /** Session working directory; defaults to the filesystem root (`/workspace` for the double). */
  readonly cwd?: string
  /** Seed files for the in-memory filesystem double. */
  readonly fs?: FsDoubleOptions
  /**
   * Mount the shipped host backend over this real directory instead of the
   * in-memory double. Byte fidelity and version guards are then the backend's.
   */
  readonly localFs?: LocalFileSystemDoubleOptions
  /**
   * Mount the shipped enforcing backend plus the shared sandbox-policy service.
   * The created Agent's session cwd is the `workspace-write` boundary; the
   * backend base may be broader through `backendCwd`.
   */
  readonly sandbox?: SandboxHarnessOptions
  /** Register this exact model route for the created Agent. */
  readonly model?: ModelRouteOptions
  /** Mount an in-memory attachment store with these limits. */
  readonly attachments?: AttachmentDoubleOptions
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
  /** The mounted filesystem backend registered as `ctx.fs`. */
  readonly fs: FileSystem
  /** The in-memory double, when that backend was selected. */
  readonly doubleFs: FsDouble | undefined
  /** The counting host backend, when `localFs` was selected. */
  readonly localFs: CountingLocalFileSystem | undefined
  /** The counting enforcing backend, when `sandbox` was selected. */
  readonly sandboxFs: CountingSandboxedFileSystem | undefined
  /** The in-memory attachment store, when `attachments` was selected. */
  readonly attachments: AttachmentDouble | undefined
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
  'sandboxPolicy',
  'attachments',
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
  const cwd = options.cwd ?? options.localFs?.cwd ?? options.localFs?.root ?? '/workspace'
  await mountAgentLoopTestDependencies(ctx)
  provideWorkingDirectoryFixture(ctx, cwd)
  const loop = await mountAgentLoopTestHarness(ctx)
  if (options.model !== undefined) mountModelRoute(ctx, options.model)
  const agent = await loop.create(
    SessionId(options.owner?.sessionId ?? 'harness-session'),
    options.model === undefined ? {} : { provider: options.model.provider, model: options.model.model },
    { cwd },
  )
  const owner = createOwner(agent, options.owner?.signal)

  let mountedFs: FsDouble | undefined
  let mountedLocal: CountingLocalFileSystem | undefined
  let mountedSandbox: CountingSandboxedFileSystem | undefined
  if (options.sandbox !== undefined) {
    await ctx.plugin(SandboxPolicyService, {
      mode: options.sandbox.mode ?? 'workspace-write',
      workspaceRoot: options.sandbox.workspaceRoot ?? cwd,
    })
    mountedSandbox = await mountSandboxedFileSystem(ctx, {
      root: options.sandbox.backendCwd ?? cwd,
      cwd: options.sandbox.backendCwd ?? cwd,
    })
  } else if (options.localFs !== undefined) {
    mountedLocal = await mountLocalFileSystem(ctx, { ...options.localFs, cwd })
  } else {
    await ctx.plugin((pluginCtx) => {
      mountedFs = new FsDouble(pluginCtx, options.fs)
    })
  }
  const attachments =
    options.attachments === undefined ? undefined : await mountAttachmentDouble(ctx, options.attachments)
  const web = await mountWebDouble(ctx, options.web)
  const subprocess = await mountSubprocessDouble(ctx, options.subprocess)
  const backend: FileSystem | undefined = mountedSandbox ?? mountedLocal ?? mountedFs
  if (backend === undefined) throw new Error('no filesystem backend mounted')
  const fs: FileSystem = backend
  let callCount = 0
  let disposed = false

  return {
    ctx,
    owner,
    fs,
    doubleFs: mountedFs,
    localFs: mountedLocal,
    sandboxFs: mountedSandbox,
    attachments,
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
