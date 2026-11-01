/**
 * `dsh-nexus/preset` — the Nexus preset contribution row.
 *
 * This module is the child entry of the Nexus preset definition. It runs inside
 * the preset generation's own Cordis scope, once per generation, and owns
 * exactly what a generation contributes:
 *
 * - the six Nexus tools (`read`, `write`, `edit`, `shell`, `web`, `agent`) with
 *   their observation policy, registered in the generation scope so they shadow
 *   the native tools of the same name for Nexus sessions only;
 * - the persona system-prompt section of the Nexus persona, per Agent;
 * - the exact-Agent membership the runtime needs, and the narrow tool filter
 *   that hides the first-party tools Nexus replaces;
 * - the generation's cleanup facts, reported to the runtime instead of being
 *   logged as a hope.
 *
 * It owns no state: the store, settings, coordinator, prompt-session owner and
 * saved-result repository belong to the host row's {@link NexusRuntime}, which
 * this row only injects. A second generation therefore joins the same state
 * instead of opening a second store, and unloading a generation never disposes
 * the runtime.
 *
 * Native terminal backends are registered by the host row, not here: the
 * terminal service lives in the host realm, so one registration per composed
 * realm is the correct count and a second generation must not repeat it.
 *
 * @module dsh-nexus/preset
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { Config as NexusConfigSchema } from '../config.ts'
import type { Config as NexusRowConfig } from '../config.ts'
import { registerChildPolicy } from '../agent/policy.ts'
import { createAgentTool } from '../agent/tool.ts'
import { createFsTools } from '../fs/read.ts'
import { registerPromptSections } from '../prompts/register.ts'
import { NexusError } from '../runtime/errors.ts'
import type { NexusAgentMembership, NexusCleanupReport, NexusRuntime } from '../runtime/service.ts'
import { createShellSurface, type ShellToolSurface } from '../shell/tool.ts'
import { createWebTool } from '../web/tool.ts'

/** Loader row id of this sub-entry; distinct from the package name on purpose. */
export const name = 'dsh-nexus-runtime'

/**
 * Services this row reads at activation or on the cold path.
 *
 * Declaring them keeps the row pending until the composition can actually serve
 * a call, instead of activating and failing on the first request. Optional
 * services read per call (`attachments`, `llm`, `sessionQuery`) are deliberately
 * absent: a text-only deployment is complete without them, and each call
 * reports the missing capability itself.
 */
export const inject: readonly string[] = Object.freeze([
  'nexusRuntime',
  'tools',
  'agents',
  'systemPrompt',
  'fs',
  'sessions',
  'workingDirectory',
  'sandboxPolicy',
  'sandbox',
  'shellEnv',
  'subprocess',
  'jobs',
  'terminals',
  'web',
  'subagents',
])

/** The row's own configuration schema; mirrors the deployment config. */
export const Config = NexusConfigSchema

/**
 * First-party tool names Nexus replaces with its own capability.
 *
 * These are the exact names the native first-party plugins register for
 * capabilities this preset provides itself (`bash`/`pwsh` for the shell,
 * `subagent*` for internal delegation, `job_*` for background processes). The
 * list is a name table, not an allowlist: a name on it is filtered only when the
 * global registry actually exposes it, and nothing else is ever named.
 */
const REPLACED_NATIVE_TOOLS: readonly string[] = Object.freeze([
  'bash',
  'pwsh',
  'bash_persistent',
  'pwsh_persistent',
  'subagent',
  'subagent_fork',
  'interrupt_agent',
  'send_message',
  'job_list',
  'job_output',
  'job_kill',
])

/**
 * Hide the first-party tools this preset replaces from one Nexus Agent.
 *
 * The registry has no provenance field, so ownership is verified the only way
 * the public surface allows: a name is filtered only when it is BOTH on the
 * fixed first-party replacement table AND currently visible in the global
 * layer. Nexus' own scoped registrations are never named, so its own tools
 * cannot be filtered by this call, and no unknown name is banned. A third-party
 * plugin that registers one of these exact names is indistinguishable at this
 * API and would be filtered too — recorded as a known limitation, not hidden.
 * @param agent - the exact Agent whose scope is restricted.
 * @param ctx - generation scope providing the tool registry.
 */
function hideReplacedNativeTools(ctx: Context, agent: Agent): void {
  const visible = new Set(ctx.tools.schemas().map((schema) => schema.name))
  const deny = REPLACED_NATIVE_TOOLS.filter((tool) => visible.has(tool))
  if (deny.length === 0) return
  agent.ctx.tools.restrict({ deny })
}

/**
 * Refuse a Nexus tool call that no exact live Nexus Agent owns.
 *
 * Membership is the runtime's exact-Agent set and liveness is the native
 * registry's own entry identity, so a session id that happens to match — a
 * restarted session, an Agent of another preset — authorizes nothing.
 * @param ctx - generation scope providing the Agent registry.
 * @param runtime - the host runtime holding membership.
 * @param tool - definition being guarded, used for the message.
 * @param exec - the registry's run context.
 */
function assertNexusCaller(ctx: Context, runtime: NexusRuntime, tool: ToolDefinition, exec: ToolRunContext): void {
  const agent = exec.agent
  if (agent === undefined) {
    throw new NexusError('NO_AGENT', `${tool.name} needs a Nexus session; this run has no calling agent`)
  }
  if (ctx.agents.get(agent.id) !== agent) {
    throw new NexusError(
      'NO_AGENT',
      `${tool.name} refused: the calling agent is not the live agent of session "${agent.id}"`,
    )
  }
  if (!runtime.isNexusAgent(agent)) {
    throw new NexusError(
      'NO_AGENT',
      `${tool.name} refused: session "${agent.id}" is not running the Nexus preset`,
    )
  }
}

/**
 * Wrap one tool so it answers only an exact live Nexus Agent.
 *
 * Every other field — schema, renderers, concurrency classification, the
 * original `execute` and the execution context it receives — is passed through
 * unchanged, so the shell tool still sees the registry's original
 * `ToolRunContext` and its cancellation.
 * @param ctx - generation scope providing the Agent registry.
 * @param runtime - the host runtime holding membership.
 * @param tool - the definition to guard.
 * @returns the guarded definition.
 */
function guardNexusTool(ctx: Context, runtime: NexusRuntime, tool: ToolDefinition): ToolDefinition {
  const execute = tool.execute
  return Object.freeze({
    ...tool,
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      assertNexusCaller(ctx, runtime, tool, exec)
      return execute.call(tool, args, exec)
    },
  })
}

/**
 * Register the Nexus contributions of one preset generation.
 *
 * Called by the Loader when this row activates; everything it creates is owned
 * by `ctx`, and the cleanup facts a generation can actually prove are attached
 * to the runtime so its teardown reports them.
 * @param ctx - the generation scope.
 * @param config - the row configuration (deployment executables); behaviour
 *   still reads the runtime's committed snapshot.
 */
export function apply(ctx: Context, config: NexusRowConfig): void {
  const runtime = ctx.nexusRuntime
  const settings = () => runtime.getSettings().value
  const shellConfig = () => runtime.getShellConfig()
  // The row config mirrors the deployment config; the runtime owns the one
  // authoritative copy, so a divergence here can never change behaviour.
  void config

  const shell: ShellToolSurface = createShellSurface(ctx, shellConfig)
  const tools: readonly ToolDefinition[] = [
    ...createFsTools(ctx, settings),
    shell.tool,
    createWebTool(ctx, runtime.store, settings, runtime.webResults),
    createAgentTool(ctx, runtime.store, settings, runtime.coordinator),
  ]
  for (const tool of tools) ctx.tools.register(guardNexusTool(ctx, runtime, tool))

  // Membership precedes the prompt section so a failed creation still reaches
  // the release edge: the serial `agent/created` dispatch rolls back into
  // `agent/disposed`, and the exact instance is the only key used.
  const memberships = new Map<Agent, NexusAgentMembership>()
  const onCreated = ctx.on('agent/created', ({ agent }) => {
    if (memberships.has(agent)) return undefined
    memberships.set(agent, runtime.markNexusAgent(agent))
    hideReplacedNativeTools(ctx, agent)
    return undefined
  })
  const onDisposed = ctx.on('agent/disposed', ({ agent }) => {
    memberships.get(agent)?.release()
    memberships.delete(agent)
  })
  let membershipReleased = false
  const releaseMemberships = (): void => {
    if (membershipReleased) return
    membershipReleased = true
    onCreated()
    onDisposed()
    for (const membership of memberships.values()) membership.release()
    memberships.clear()
  }

  const promptSections = registerPromptSections(ctx, runtime.prompts)
  // Delegation policy: the narrow access mode and the write scope of a Nexus
  // child are enforced on the child's own creation edge, which the loop runs
  // before that child's first request. Registered per generation because the
  // hooks are scope-filtered; the store and the coordinator they use are the
  // runtime's single instances.
  const childPolicy = registerChildPolicy(ctx, runtime.store, runtime.coordinator)

  const detachShell = runtime.attach('shell', (): Promise<NexusCleanupReport> => shell.dispose())
  const detachFacts = runtime.trackManagedResources(shell.facts())
  const detachPrompts = runtime.attach('prompt-sections', () => promptSections())
  const detachMembers = runtime.attach('nexus-agents', () => releaseMemberships())
  const detachPolicy = runtime.attach('child-policy', () => childPolicy())

  // A generation unload withdraws its own registrations. The shell surface's real
  // disposal report is joined and published BEFORE the attachment is detached: a
  // range it could not prove cleaned stays owed to the root runtime instead of
  // disappearing with this generation. If the report cannot be joined, the
  // attachment is deliberately left for the runtime's own drain.
  ctx.effect(() => async () => {
    let report: NexusCleanupReport | undefined
    try {
      report = await shell.dispose()
    } catch {
      report = undefined
    }
    if (report !== undefined) {
      runtime.reportCleanup('shell', report)
      detachShell()
    }
    detachFacts()
    detachPrompts()
    detachMembers()
    detachPolicy()
  }, 'dsh-nexus generation attachments')
}
