/** Native optional service registries, source routes and the real singleton.
 * No model, process, PTY or network operation is needed for registration facts. */
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import WebRuntime from '@deepseek-ai/dsh-web'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { expect, it, vi } from 'vitest'
import { registerRoutes } from '../../src/http/routes.ts'
import { openNexusRuntime, type NexusRuntime } from '../../src/runtime/service.ts'
import { registerTerminalBackends } from '../../src/shell/terminals.ts'
import { mountNexusStoreFixture, mountSubprocessDouble } from '../support/fixtures.ts'
import { consoleRequest } from './transport.ts'

it('distinguishes absent services, empty public registries and unknown web backends, reflecting live registrations', async () => {
  const ctx = new Context()
  let runtime: NexusRuntime | undefined
  let fixture: Awaited<ReturnType<typeof mountNexusStoreFixture>> | undefined
  let removeTerminals: (() => void) | undefined
  let removeRoutes: (() => void) | undefined
  let configReads = 0
  let webOperations = 0
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    fixture = await mountNexusStoreFixture({ ctx })
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin({
      name: 'capabilities-source-row', inject: ['storageDomain', 'webServer', 'agents'],
      async apply(scope: Context) {
        runtime = await openNexusRuntime(scope, {})
        removeRoutes = registerRoutes(scope, runtime)
      },
    })
    const endpoint = `${ctx.webServer.getOrigin()}/api/dsh-nexus/capabilities`
    const read = async () => {
      const response = await consoleRequest(endpoint)
      expect(response.status).toBe(200)
      return await response.json() as { backendRegistrations: unknown; csrfToken: string }
    }
    const modelRead = vi.spyOn(ctx.llm, 'listModels').mockResolvedValue([
      { provider: 'catalog-route', id: 'catalog-model', name: 'Private display name', description: 'not public' },
    ])
    const providers = vi.spyOn(ctx.llm, 'listProviders').mockReturnValue([{ id: 'catalog-route', name: 'Private adapter display name' }])
    const absent = await read()
    expect(absent).toHaveProperty('providers', ['catalog-route'])
    expect(modelRead).not.toHaveBeenCalled()
    const catalog = await consoleRequest(`${endpoint}?provider=catalog-route`)
    expect(catalog.status).toBe(200)
    expect(await catalog.json()).toEqual({ models: ['catalog-model'] })
    expect(modelRead).toHaveBeenCalledWith('catalog-route')
    modelRead.mockRejectedValueOnce(new Error('private connection detail'))
    expect(await (await consoleRequest(`${endpoint}?provider=catalog-route`)).json()).toEqual({ models: [] })
    modelRead.mockImplementationOnce(() => new Promise(() => {}))
    const began = Date.now()
    expect(await (await consoleRequest(`${endpoint}?provider=catalog-route`)).json()).toEqual({ models: [] })
    expect(Date.now() - began).toBeLessThan(3000)
    // Queries cannot bypass the existing origin/host guard or request grammar.
    expect((await consoleRequest(`${endpoint}?provider=catalog-route`, 'GET', undefined, { Origin: 'https://evil.invalid' })).status).toBe(403)
    expect((await consoleRequest(`${endpoint}?provider=a&provider=b`)).status).toBe(400)
    providers.mockRestore()
    modelRead.mockRestore()
    expect(absent.backendRegistrations).toEqual({
      scope: 'effective-http-context',
      terminal: { service: 'absent', backends: { state: 'absent', names: [] }, readiness: 'unverified' },
      web: { service: 'absent', backends: { state: 'absent', names: [] }, readiness: 'unverified' },
      internalAgent: { service: 'absent', backends: { state: 'absent', names: [] }, readiness: 'unverified' },
    })

    await ctx.plugin(TerminalSessionService)
    await ctx.plugin(WebRuntime)
    await ctx.plugin(SubagentRuntime)
    const empty = await read()
    expect(empty.backendRegistrations).toEqual({
      scope: 'effective-http-context',
      terminal: { service: 'present', backends: { state: 'absent', names: [] }, readiness: 'unverified' },
      web: { service: 'present', backends: { state: 'unknown', names: null }, readiness: 'unverified' },
      internalAgent: { service: 'present', backends: { state: 'absent', names: [] }, readiness: 'unverified' },
    })

    // Registration now waits for the services the native backend reaches on its
    // own cold path, exactly as the backend's own row declares them.
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: process.cwd() })
    await mountSubprocessDouble(ctx)
    removeTerminals = registerTerminalBackends(ctx, () => {
      configReads++
      throw new Error('registration inspection must not resolve a shell executable')
    })
    const provider = await ctx.plugin(SpawnProvider, { providerName: 'fix1-native-spawn' })
    // External provider configuration is deliberately not serializable. Public
    // web has no enumeration API; inspection must not read it or call available.
    const searchProvider = {
      id: 'fix1-search',
      get configuration() { throw new Error('private provider configuration must not be read') },
      available() { webOperations++; throw new Error('must not probe availability') },
      async search() { webOperations++; throw new Error('must not search') },
    }
    ctx.web.registerSearchProvider(searchProvider)
    ctx.web.registerFetchProvider({
      id: 'fix1-fetch',
      available() { webOperations++; throw new Error('must not probe availability') },
      async fetch() { webOperations++; throw new Error('must not fetch') },
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const registered = await read()
    expect(registered.backendRegistrations).toEqual({
      scope: 'effective-http-context',
      terminal: { service: 'present', backends: { state: 'registered', names: ['nexus-bash', 'nexus-pwsh'] }, readiness: 'unverified' },
      web: { service: 'present', backends: { state: 'unknown', names: null }, readiness: 'unverified' },
      internalAgent: { service: 'present', backends: { state: 'registered', names: ['fix1-native-spawn'] }, readiness: 'unverified' },
    })
    expect(registered.csrfToken).toBe(absent.csrfToken)
    expect(ctx.nexusRuntime).toBe(runtime)
    expect(configReads).toBe(0)
    expect(webOperations).toBe(0)
    expect(ctx.agents.list()).toHaveLength(0)

    removeTerminals()
    await provider.dispose()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect((await read()).backendRegistrations).toEqual(empty.backendRegistrations)

    // Parent services remain mounted, but are absent in this route's effective
    // isolated scope. Looking up ctx.root instead would report the wrong facts.
    removeRoutes?.()
    await ctx.isolate('terminals').isolate('web').isolate('subagents').plugin({
      name: 'isolated-capabilities-row', inject: ['webServer', 'agents', 'nexusRuntime'],
      apply(scope: Context) { registerRoutes(scope, scope.nexusRuntime) },
    })
    expect((await read()).backendRegistrations).toEqual(absent.backendRegistrations)
    expect(configReads).toBe(0)
    expect(webOperations).toBe(0)
  } finally {
    removeRoutes?.()
    removeTerminals?.()
    await runtime?.dispose()
    await ctx.fiber.dispose()
    await fixture?.dispose()
  }
})
