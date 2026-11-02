/**
 * The real host composition a Nexus preset activation needs.
 *
 * Mounted from the shipped implementations: the Cordis Loader, the native preset
 * registry, the production AgentLoop and Agent registry, the real session store
 * with JSONL persistence and the SQLite query backend, the enforcing filesystem
 * with the shared sandbox policy, the real working-directory, shell-env,
 * job-registry, terminal, skill, question, command, token-meter and
 * in-process subagent services, the real storage domain, the real native
 * `agent-instructions`/skill/question/todo rows through the definition, and
 * this package's own built host row.
 *
 * Scripted members — every one of them an EXTERNAL boundary, never an internal
 * seam:
 *
 * - the model transport (no request leaves the process, no account is involved);
 * - the native web search/fetch providers;
 * - the process-spawn boundary (`mountSubprocessDouble`, a
 *   `SubprocessRuntime` implementation: no real child process);
 * - the confinement runner (`mountRecordingSandbox`, a `SandboxProvider`
 *   implementation: the executor's real policy resolution and full-argv
 *   confinement path run, only the host-side runner is replaced).
 *
 * Consequence stated rather than implied: this harness proves NO actual OS
 * sandbox, NO Windows ConPTY and NO real Git Bash/pwsh7 execution. Those stay
 * Task 4/5/14 evidence. The abstract `SandboxProvider`/`SubprocessRuntime`
 * service definitions are deliberately NOT mounted as if they were loadable
 * implementations.
 *
 * Two environment variables are pinned for the duration of a case —
 * `DSH_HOME` and `DSH_AGENTS_HOME` — so skill and instruction discovery read
 * project-local fixtures instead of the machine's home directory. They are
 * restored when the harness is disposed.
 *
 * @module dsh-nexus/test/support/preset-harness
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import GroupPlugin from '@deepseek-ai/cordis-plugin-group'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import AgentPresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import type { Config as SystemPromptConfig } from '@deepseek-ai/dsh-system-prompt'
import { defineTool, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { apply as applyShellEnv } from '@deepseek-ai/dsh-shell-env'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import TerminalService, { type TerminalSessionService } from '@deepseek-ai/dsh-terminal'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import Commands from '@deepseek-ai/dsh-commands'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { apply as applySessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ForkProvider from '@deepseek-ai/dsh-subagent-fork-in-process'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
  type AgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  mountAttachmentDouble,
  mountModelRoute,
  mountNexusStoreFixture,
  mountRecordingSandbox,
  mountSandboxedFileSystem,
  mountSubprocessDouble,
  mountWebDouble,
  type AttachmentDouble,
  type CountingSandboxedFileSystem,
  type NexusStoreFixture,
  type RecordingSandboxProvider,
  type ScriptedProcessScript,
  type SubprocessDouble,
  type WebDouble,
} from './fixtures.ts'
import type { SubprocessSpawnSpec, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { Config as NexusConfigSchema } from '../../src/config.ts'
import type { Config as NexusConfig } from '../../src/config.ts'
import type { NexusRuntime } from '../../src/runtime/service.ts'

/** Project root: the Loader's resolution base and the built package location. */
const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

/** Cache directory every case's state stays in; nothing leaves the checkout. */
const CACHE_DIR = join(packageRoot, 'node_modules/.cache/dsh-nexus-test')

/** Provider and model the scripted transport serves. */
export const PRESET_ROUTE = { provider: 'nexus-preset-test', model: 'nexus-preset-model' } as const

/** One assembled request the scripted transport answered. */
export interface PresetRequest {
  /** Request whose answer this was. */
  readonly options: GenerateOptions
}

/** What the harness needs before it may compose anything. */
export interface PresetHarnessOptions {
  /**
   * Tool names a third-party plugin contributes in the GLOBAL layer.
   *
   * A real Cordis plugin registers them, so a Nexus session that could no
   * longer see them would prove a global allowlist exists. Default: none.
   */
  readonly thirdPartyTools?: readonly string[]
  /**
   * Tool names a THIRD-PARTY plugin registers under names that also describe a
   * first-party capability (`bash`, `subagent`, `job_list` …).
   *
   * This exists to prove the opposite of ownership: the public registry has no
   * provenance, so a name never proves who registered it, and none of these may
   * be filtered from a Nexus session. A real Cordis plugin registers them in the
   * global layer. Default: none.
   */
  readonly collisionToolNames?: readonly string[]
  /**
   * Mount the shipped native compaction pair in the HOST realm before the Nexus
   * row starts, so `detectNativeComposition` sees an inheritable mechanism.
   *
   * `'pair'` mounts the real `BasicCompactionEngine` and `ToolResultPruner`;
   * `'partial'` mounts only the engine, i.e. the half-present case (no pruner)
   * the preset must refuse. Default: none (the host realm carries no mechanism).
   */
  readonly hostCompaction?: 'pair' | 'partial'
  /**
   * Make the scripted web search provider throw this error.
   *
   * A case passes a real native `WebError` (a `HarnessError` subclass) so the
   * compiled package's failure classification is exercised with a host-created
   * error instance. Default: an empty source list.
   */
  readonly webSearchError?: Error
  /** System-prompt configuration for the mounted registry. */
  readonly systemPrompt?: SystemPromptConfig
  /**
   * Script the process-spawn boundary for a case that must own a range the
   * provider cannot clean (a hanging or never-confirmed process). Default: the
   * fixture's clean, immediately finished process.
   */
  readonly subprocessScript?: (spec: SubprocessSpawnSpec) => ScriptedProcessScript
  /**
   * Script the terminal-spawn boundary, so a case can keep a persistent terminal
   * session open instead of the fixture's immediately finished default.
   */
  readonly terminalScript?: (spec: SubprocessTerminalSpawnSpec) => ScriptedProcessScript
  /**
   * Script one model answer, so a case can drive a real multi-step turn (for
   * example an assistant tool call followed by a second request carrying the
   * tool result). Default: a text-only answer.
   */
  readonly answer?: (request: GenerateOptions, index: number) => string | AsyncIterable<StreamChunk>
  /**
   * Extra rows appended to the native `standard` preset composition. This is how
   * a case installs a third-party contribution bound to the native preset id.
   */
  readonly standardPlugins?: PresetDefinition['plugins']
  /**
   * In-process plugins a `cordis:<name>` row name resolves to, so a test-only
   * row can be composed without shipping a module for it.
   */
  readonly loaderBuiltins?: Readonly<Record<string, unknown>>
}

/** One mounted host composition plus the built Nexus row on top of it. */
export interface PresetHarness {
  /** Context carrying every mounted service and the `nexusRuntime` service. */
  readonly ctx: Context
  /** Case-owned project-local root. */
  readonly root: string
  /** Session workspace inside {@link root}. */
  readonly workspace: string
  /** Production AgentLoop driver. */
  readonly loop: AgentLoopTestHarness
  /** Filesystem backend mounted as `ctx.fs`. */
  readonly fs: CountingSandboxedFileSystem
  /** Scripted web providers. */
  readonly web: WebDouble
  /** Attachment store double. */
  readonly attachments: AttachmentDouble
  /** The scripted confinement runner, with its recorded `confine` calls. */
  readonly sandbox: RecordingSandboxProvider
  /** The scripted process-spawn boundary, with its recorded spawn requests. */
  readonly subprocess: SubprocessDouble
  /**
   * The terminal registry instance the native `standard` preset owns.
   *
   * The deployed `web` profile has NO host-level `terminals` service: `standard`
   * mounts `@deepseek-ai/dsh-terminal` inside a group that isolates `terminals`.
   * This harness reproduces that shape instead of mounting a host-level service,
   * so a preset entry that needs one can never borrow the harness's instance.
   */
  readonly standardTerminals: TerminalSessionService
  /** Durable Nexus store mounted as `storageDomain`. */
  readonly fixture: NexusStoreFixture
  /** Every model request the scripted transport answered, in order. */
  readonly requests: PresetRequest[]
  /**
   * Mount the built host row: opens the runtime and registers the definition.
   * @param config - real deployment configuration for the row; defaults to `{}`.
   * @returns the runtime the row published.
   */
  startNexus(config?: NexusConfig): Promise<NexusRuntime>
  /**
   * Unload the host row as the Loader would on a plugin disable.
   * @returns after the row's fiber is disposed.
   */
  stopNexus(): Promise<void>
  /** The runtime the host row opened, once {@link PresetHarness.startNexus} ran. */
  readonly runtime: NexusRuntime
  /**
   * The rows one preset definition currently has mounted, in Loader order.
   * @param presetId - preset identity; the `nexus` definition by default.
   * @returns the module names and enablement the registry reports.
   */
  presetRows(presetId?: string): Promise<readonly { moduleName: string; enabled: boolean }[]>
  /**
   * The tool names one Agent's assembled request advertised.
   * @param agent - agent whose last request is read.
   * @returns the tool names in request order.
   */
  toolNamesOf(agent: Agent): string[]
  /**
   * All text one Agent's last assembled request carried, system message first.
   * @param agent - agent whose request is read.
   * @returns the concatenated text blocks.
   */
  promptTextOf(agent: Agent): string
  /**
   * Create one Agent bound to a preset through the real registry.
   * @param id - session id.
   * @param presetId - preset to mount, or undefined for a preset-free Agent.
   * @returns the live Agent.
   */
  createAgent(id: string, presetId?: string): Promise<Agent>
  /**
   * Dispose one Agent created by {@link PresetHarness.createAgent}.
   * @param agent - the exact Agent to retire.
   */
  disposeAgent(agent: Agent): Promise<void>
  /**
   * Run one complete turn for an Agent and wait for its durable `turn/end`.
   * @param agent - agent to wake.
   * @param text - user text.
   */
  runTurn(agent: Agent, text: string): Promise<void>
  /**
   * Run one registered tool through the real registry pipeline.
   * @param name - registered tool name.
   * @param args - model-shaped arguments.
   * @param agent - caller.
   * @returns the normalized execution result.
   */
  call(name: string, args: Record<string, unknown>, agent: Agent): Promise<ToolExecutionResult>
  /** Unload everything, restore the environment and delete the case root. */
  dispose(): Promise<void>
}

/**
 * The export shape the built host entry must present: the public Cordis plugin
 * fields plus this package's own deployment config schema.
 *
 * The Loader row is a module, so the test verifies each field it depends on at
 * runtime and then uses the package's real `Config` type. Nothing is erased to
 * `never`: a wrong export shape fails here with a message instead of a cast.
 */
interface NexusHostRowPlugin {
  readonly name: string
  readonly inject: string[]
  readonly Config: typeof NexusConfigSchema
  readonly apply: (ctx: Context, config: NexusConfig) => Promise<void>
}

/**
 * Verify one imported module is the host row this package promises.
 * @param module - the imported module namespace or its default export.
 * @param entry - path shown in a failure, for the operator.
 * @returns the row, typed by the public plugin contract.
 * @throws when a required export is missing or has the wrong type.
 */
function asNexusHostRow(module: Record<string, unknown>, entry: string): NexusHostRowPlugin {
  const candidate = (module.default ?? module) as Record<string, unknown>
  const { name, inject, Config, apply } = candidate
  if (typeof name !== 'string' || name === '') {
    throw new Error(`${entry} exports no row name; the Loader row must be named like the package`)
  }
  if (!Array.isArray(inject) || inject.some((service) => typeof service !== 'string')) {
    throw new Error(`${entry} exports no string[] inject list; the row's cold-path services must be declared`)
  }
  if (Config === undefined) throw new Error(`${entry} exports no Config schema; the row's config would not be validated`)
  if (typeof apply !== 'function') throw new Error(`${entry} exports no apply function; the row would mount nothing`)
  return {
    name,
    inject: inject as string[],
    Config: Config as typeof NexusConfigSchema,
    apply: apply as NexusHostRowPlugin['apply'],
  }
}

/**
 * Build the plugin object the Loader mounts from the built host entry.
 * @returns the row this package installs.
 */
async function loadBuiltHostRow(): Promise<NexusHostRowPlugin> {
  const entry = join(packageRoot, 'lib/index.js')
  if (!existsSync(entry)) throw new Error(`missing ${entry}; run pnpm build before the preset tests`)
  const module = (await import(pathToFileURL(entry).href)) as Record<string, unknown>
  return asNexusHostRow(module, entry)
}

/**
 * A plugin contributing tools in the global registry layer.
 * @param pluginName - Cordis plugin name.
 * @param names - tool names the plugin registers.
 * @returns the plugin to mount.
 */
function globalToolsPlugin(
  pluginName: string,
  names: readonly string[],
): { name: string; inject: string[]; apply(ctx: Context): void } {
  return {
    name: pluginName,
    inject: ['tools'],
    apply(pluginCtx: Context) {
      for (const toolName of names) {
        pluginCtx.tools.register(
          defineTool({
            name: toolName,
            description: `Fixture tool ${toolName}.`,
            parameters: {},
            output: {
              schema: { type: 'object', additionalProperties: true },
              render: () => [{ type: 'text', text: 'third-party' }],
            },
            async execute(): Promise<Record<string, never>> {
              return {}
            },
          }),
        )
      }
    },
  }
}

/**
 * Write one project-local skill fixture the native provider discovers.
 * @param skillsHome - pinned `DSH_AGENTS_HOME`.
 */
async function writeSkillFixture(skillsHome: string): Promise<void> {
  const dir = join(skillsHome, 'skills', 'nexus-fixture-skill')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'SKILL.md'),
    '---\nname: nexus-fixture-skill\ndescription: Fixture skill proving the native skill catalog reaches a Nexus session.\n---\n\nFIXTURE SKILL BODY\n',
    'utf8',
  )
}

/**
 * Register the definition a native preset would contribute, so the standard
 * composition can be compared before and after Nexus is installed.
 * @param extra - additional rows bound to this native preset id.
 * @returns the definition.
 */
export function standardDefinition(extra: PresetDefinition['plugins'] = []): PresetDefinition {
  return {
    id: 'standard',
    name: 'Standard',
    order: 1,
    plugins: [
      { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65_536 } },
      { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
      ...extra,
    ],
  }
}

/**
 * Mount the whole host composition and the built Nexus row.
 * @param options - optional third-party row and prompt configuration.
 * @returns the mounted harness.
 */
export async function mountPresetHarness(options: PresetHarnessOptions = {}): Promise<PresetHarness> {
  await mkdir(CACHE_DIR, { recursive: true })
  const root = await mkdtemp(join(CACHE_DIR, 'preset-'))
  const workspace = join(root, 'workspace')
  const home = join(root, 'home')
  const agentsHome = join(root, 'agents')
  await mkdir(workspace, { recursive: true })
  await mkdir(home, { recursive: true })
  await mkdir(agentsHome, { recursive: true })
  await writeSkillFixture(agentsHome)
  await writeFile(join(workspace, 'AGENTS.md'), '# Nexus fixture workspace\n\nFIXTURE INSTRUCTION LINE\n', 'utf8')

  const previousHome = process.env.DSH_HOME
  const previousAgentsHome = process.env.DSH_AGENTS_HOME
  process.env.DSH_HOME = home
  process.env.DSH_AGENTS_HOME = agentsHome
  const restoreEnv = (): void => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = previousAgentsHome
  }

  const ctx = new Context()
  try {
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(`${packageRoot}`).href })
    // The host boot registers the `cordis:group` builtin the same way; a preset
    // definition that composes a group needs it.
    ctx.loader.builtins.group = GroupPlugin
    await mountAgentLoopTestDependencies(ctx, options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt })
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
    const fs = await mountSandboxedFileSystem(ctx, { root, cwd: workspace })
    await ctx.plugin(WorkingDirectory, { defaultDirectory: workspace })
    await ctx.plugin(applySessionPersistence, { root: join(root, 'sessions') })
    await ctx.plugin(SqliteSessionQueryEngine, { path: ':memory:', openAt: 'never' })
    const requests: PresetRequest[] = []
    mountModelRoute(ctx, {
      ...PRESET_ROUTE,
      stream: (request) => {
        requests.push({ options: request })
        const answer = options.answer?.(request, requests.length)
        if (answer === undefined) return scriptedAnswer(requests.length)
        return typeof answer === 'string' ? scriptedTextAnswer(answer) : answer
      },
    })
    const loop = await mountAgentLoopTestHarness(ctx)
    // External boundaries: the confinement runner and the process-spawn provider
    // implement the shipped abstract contracts (`SandboxProvider`,
    // `SubprocessRuntime`). The base definitions are not loadable, so mounting
    // them would leave method-less services behind; these implementations keep
    // the executor's real policy resolution and argv path while replacing only
    // the host-side runner/process. Neither claims OS-sandbox or PTY proof.
    const sandbox = await mountRecordingSandbox(ctx)
    const subprocess = await mountSubprocessDouble(ctx, {
      ...(options.subprocessScript === undefined ? {} : { script: options.subprocessScript }),
      ...(options.terminalScript === undefined ? {} : { terminalScript: options.terminalScript }),
    })
    await ctx.plugin(applyShellEnv, {})
    await ctx.plugin(LocalJobRegistry, {})
    // The deployed profile carries `terminals` only inside a preset's isolated
    // group. Mounting a host-level one here would let a preset entry activate
    // against a service the real composition never provides — the fidelity gap
    // that hid a generation-scope defect. The sibling scope below stands in for
    // the `standard` preset's own isolated instance and nothing more.
    const standardScope = ctx.isolate('terminals')
    await standardScope.plugin(TerminalService)
    const standardTerminals = standardScope.get('terminals')
    if (standardTerminals === undefined) throw new Error('the standard-shape terminal scope did not mount')
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFilesystem)
    await ctx.plugin(UserQuestions)
    await ctx.plugin(Commands)
    await ctx.plugin(TokenMeter)
    // The shipped native compaction components, in the HOST realm, mounted before
    // the Nexus row activates: this is the composition `detectNativeComposition`
    // must read, not a service-shaped test object.
    if (options.hostCompaction !== undefined) {
      await ctx.plugin(BasicCompactionEngine, {})
      if (options.hostCompaction === 'pair') await ctx.plugin(ToolResultPruner, {})
    }
    // A deterministic provider answer, so a saved-result write is a real
    // publication through the shipped web runtime rather than an empty body.
    const web = await mountWebDouble(ctx, {
      ...(options.webSearchError === undefined
        ? {}
        : {
            search: (): never => {
              throw options.webSearchError as Error
            },
          }),
      fetch: (request) => ({
        url: request.url,
        statusCode: 200,
        body: { kind: 'text', content: 'FIXTURE WEB BODY' },
        truncated: false,
      }),
    })
    const attachments = await mountAttachmentDouble(ctx)
    await ctx.plugin(SubagentRuntime, { maxDepth: 8, maxActiveSubagents: 8 })
    await ctx.plugin(SpawnProvider)
    await ctx.plugin(ForkProvider)
    const fixture = await mountNexusStoreFixture({ ctx })
    await ctx.plugin(AgentPresetRegistry, { default: 'standard' })
    if (options.collisionToolNames !== undefined && options.collisionToolNames.length > 0) {
      await ctx.plugin(globalToolsPlugin('nexus-collision-tools', options.collisionToolNames))
    }
    if (options.thirdPartyTools !== undefined && options.thirdPartyTools.length > 0) {
      await ctx.plugin(globalToolsPlugin('nexus-third-party-tools', options.thirdPartyTools))
    }
    for (const [name, plugin] of Object.entries(options.loaderBuiltins ?? {})) ctx.loader.builtins[name] = plugin
    await ctx.agentPresets.register(standardDefinition(options.standardPlugins))
    const hostRow = await loadBuiltHostRow()

    let callCount = 0
    let nexusFiber: { dispose(): Promise<unknown> } | undefined
    const handles: { agent: Agent; dispose(): Promise<void> }[] = []
    let disposed = false
    return {
      ctx,
      root,
      workspace,
      loop,
      fs,
      web,
      attachments,
      sandbox,
      subprocess,
      standardTerminals,
      fixture,
      requests,
      get runtime() {
        const runtime = ctx.get('nexusRuntime')
        if (runtime === undefined) throw new Error('the Nexus host row is not mounted')
        return runtime
      },
      async startNexus(config: NexusConfig = {}) {
        if (nexusFiber !== undefined) throw new Error('the Nexus host row is already mounted')
        const fiber = ctx.plugin(hostRow, config)
        await fiber
        nexusFiber = fiber as unknown as { dispose(): Promise<unknown> }
        const runtime = ctx.get('nexusRuntime')
        if (runtime === undefined) throw new Error('the host row did not publish the Nexus runtime')
        return runtime
      },
      async stopNexus() {
        const fiber = nexusFiber
        nexusFiber = undefined
        if (fiber !== undefined) await fiber.dispose()
      },
      async presetRows(presetId = 'nexus') {
        const inventory = await ctx.agentPresets.compositionInventory()
        const record = inventory.find((entry) => entry.id === presetId)
        if (record === undefined) throw new Error(`no preset "${presetId}" is registered`)
        if (record.broken !== undefined) throw new Error(`preset "${presetId}" is not usable: ${record.broken}`)
        return (record.rows as readonly { moduleName: string; enabled: boolean }[]).map((row) => ({
          moduleName: row.moduleName,
          enabled: row.enabled,
        }))
      },
      toolNamesOf(agent) {
        const own = requests.filter((request) => request.options.sessionId === agent.id)
        const last = own.at(-1)
        if (last === undefined) throw new Error(`session "${agent.id}" made no model request`)
        return (last.options.tools ?? []).map((tool) => tool.name)
      },
      promptTextOf(agent) {
        const own = requests.filter((request) => request.options.sessionId === agent.id)
        const last = own.at(-1)
        if (last === undefined) throw new Error(`session "${agent.id}" made no model request`)
        return last.options.messages
          .flatMap((message) => message.content.some((block) => block.type === 'text') ? message.content : [])
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('\n')
      },
      async disposeAgent(agent) {
        const index = handles.findIndex((handle) => handle.agent === agent)
        if (index < 0) throw new Error(`session "${agent.id}" was not created by this harness`)
        const [handle] = handles.splice(index, 1)
        await handle?.dispose()
      },
      async createAgent(id, presetId) {
        const handle = await ctx.agents.create({
          sessionId: SessionId(id),
          meta: { cwd: workspace, ...(presetId === undefined ? {} : { agentPreset: presetId }) },
          agentOptions: { ...PRESET_ROUTE },
          ...(presetId === undefined
            ? {}
            : {
                setup: async (agentCtx: Context) => {
                  await ctx.agentPresets.mount(agentCtx, presetId)
                },
              }),
        })
        handles.push(handle as unknown as { agent: Agent; dispose(): Promise<void> })
        return handle.agent
      },
      async runTurn(agent, text) {
        const closed = (): number => agent.session.snapshotEvents().filter((event) => event.type === 'turn/end').length
        const before = closed()
        agent.followup({
          id: MessageId(`preset-user-${before}-${Date.now()}`),
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        })
        const deadline = Date.now() + 20_000
        while (closed() <= before) {
          if (Date.now() > deadline) throw new Error('the agent turn did not close')
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
      },
      call(name, args, agent) {
        callCount += 1
        return ctx.tools.execute({
          callId: ToolCallId(`preset-call-${callCount}`),
          name,
          arguments: args,
          agent,
          signal: new AbortController().signal,
        })
      },
      async dispose() {
        if (disposed) return
        disposed = true
        for (const handle of handles.splice(0).reverse()) await handle.dispose().catch(() => undefined)
        await nexusFiber?.dispose().catch(() => undefined)
        nexusFiber = undefined
        try {
          await ctx.fiber.dispose()
        } finally {
          // The env variables and the temp root are process/disk state shared by
          // every later case in this fork: restore them even when one plugin's
          // own dispose rejects, and let that original error surface.
          restoreEnv()
          await rm(root, { recursive: true, force: true })
        }
      },
    }
  } catch (error) {
    restoreEnv()
    await ctx.fiber.dispose().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

/**
 * One complete scripted answer, so a turn closes with text only.
 * @param index - request ordinal, used as the answer text.
 * @returns the stream.
 */
async function* scriptedAnswer(index: number): AsyncGenerator<StreamChunk> {
  yield* scriptedTextAnswer(`answer-${index}`)
}

/**
 * One text-only answer over a fixed text.
 * @param text - the answer text.
 * @returns the stream.
 */
async function* scriptedTextAnswer(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
