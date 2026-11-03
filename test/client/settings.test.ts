// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createConsoleStore } from '../../src/client/store.ts'
import { createNexusApi } from '../../src/client/api.ts'
import en from '../../src/locale/en.json' with { type: 'json' }
import { clientFixture } from './fixture.ts'
import { mountConsole, button, input } from './render.ts'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
describe('five-page shared settings draft', () => {
  it.each(['main', 'settings'] as const)('%s wires only actual supported fields and saves one full draft across all pages', async (surface) => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const view = await mountConsole(store, surface); cleanups.push(view.dispose)
    await button(view.node, en.tools).clickAsync()
    await input(view.node, en.defaultLines, '500')
    await input(view.node, en.maxOutputBytes, '16000')
    await input(view.node, en.maxResults, '7')
    await input(view.node, en.maxCharsPerPage, '15000')
    expect(view.node.textContent).toContain(en.pageBudgetHelp)
    await button(view.node, en.terminal).clickAsync()
    await input(view.node, en.engine, 'pwsh')
    await input(view.node, en.bashPath, 'C:/Program Files/Git/bin/bash.exe')
    await input(view.node, en.pwshPath, 'C:/Program Files/PowerShell/7/pwsh.exe')
    expect(view.node.textContent).toContain(en.timeoutHelp)
    expect(view.node.textContent).toContain(en.unverified)
    await button(view.node, en.agents).clickAsync()
    await input(view.node, en.concurrency, '6')
    await input(view.node, en.maxDepth, '3')
    await input(view.node, en.childAccess, 'workspace-write')
    expect(view.node.textContent).toContain(en.childAccessWarning)
    await input(view.node, en.roleName, 'Reviewer')
    await input(view.node, en.roleInstructions, 'Review literal text')
    await input(view.node, en.roleModel, '')
    await input(view.node, en.roleProvider, 'codex-subscription')
    await button(view.node, en.saveSettings).clickAsync()
    expect(f.settings.value).toEqual({ files: { defaultLines: 500, maxOutputBytes: 16000 }, web: { maxResults: 7, maxCharsPerPage: 15000 }, terminal: { engine: 'pwsh', bashPath: 'C:/Program Files/Git/bin/bash.exe', pwshPath: 'C:/Program Files/PowerShell/7/pwsh.exe' }, agents: { concurrency: 6, maxDepth: 3, childAccess: 'workspace-write', role: { name: 'Reviewer', instructions: 'Review literal text', provider: 'codex-subscription' } }, toolDisplay: 'nexus' })
    await button(view.node, en.integrations).clickAsync()
    expect(view.node.textContent).toContain(en.unknown)
    expect(view.node.textContent).toContain(en.registrationHelp)
    expect(view.node.textContent).toContain(en.nativeSettingsHelp)
    expect(view.node.querySelectorAll('a')).toHaveLength(0)
    expect(view.node.querySelectorAll('input')).toHaveLength(0)
  })
  it('publishes only an integer inside the field bounds and never raises a notice for invalid typing', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const view = await mountConsole(store); cleanups.push(view.dispose)
    await button(view.node, en.tools).clickAsync()
    const initialLines = store.getSnapshot().settingsDraft?.files.defaultLines
    expect(initialLines).toBe(200)
    const writes = f.requests.filter((request) => request.method === 'PUT').length
    await input(view.node, en.defaultLines, '1.5')
    expect(store.getSnapshot().settingsDraft?.files.defaultLines).toBe(initialLines)
    expect(store.getSnapshot().notice).toBe('idle')
    await input(view.node, en.defaultLines, '99999')
    expect(store.getSnapshot().settingsDraft?.files.defaultLines).toBe(initialLines)
    expect(store.getSnapshot().notice).toBe('idle')
    expect(view.node.textContent).not.toContain(en.error)
    expect(f.requests.filter((request) => request.method === 'PUT')).toHaveLength(writes)
    await input(view.node, en.defaultLines, '500')
    expect(store.getSnapshot().settingsDraft?.files.defaultLines).toBe(500)
  })
  it.each([409, 500])('preserves edits after HTTP %i; only explicit reload discards them', async (status) => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const view = await mountConsole(store); cleanups.push(view.dispose)
    await button(view.node, en.tools).clickAsync()
    await input(view.node, en.defaultLines, '321')
    f.reply = (path, method) => path.endsWith('/settings') && method === 'PUT' ? Response.json({ error: { code: status === 409 ? 'CONFIG_CONFLICT' : 'INTERNAL_ERROR', message: 'refused' } }, { status }) : undefined
    await button(view.node, en.saveSettings).clickAsync()
    expect(view.node.textContent).toContain(status === 409 ? en.conflict : en.error)
    expect(store.getSnapshot().settingsDraft?.files.defaultLines).toBe(321)
    await button(view.node, en.reloadSettings).clickAsync()
    expect(store.getSnapshot().settingsDraft?.files.defaultLines).toBe(200)
  })
  it('offers catalog suggestions without constraining typed provider or model values', async () => {
    const f = clientFixture()
    f.reply = (path) => path.includes('?provider=') ? Response.json({ models: ['gpt-catalog'] }) : undefined
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    expect(f.requests.some((request) => request.path.includes('?provider='))).toBe(false)
    const view = await mountConsole(store); cleanups.push(view.dispose)
    await button(view.node, en.agents).clickAsync()
    await input(view.node, en.roleProvider, 'typed-route')
    await act(async () => { await store.suggestChildModels('typed-route') })
    expect(store.getSnapshot().childModels).toEqual({ provider: 'typed-route', models: ['gpt-catalog'] })
    // Flush the external-store update before checking the DOM.
    await input(view.node, en.roleModel, 'unlisted-model')
    expect([...view.node.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toContain('gpt-catalog')
    await button(view.node, en.saveSettings).clickAsync()
    expect(f.settings.value.agents.role).toEqual({ provider: 'typed-route', model: 'unlisted-model' })
  })

  it('keeps the child ceiling and the provider route in the shared draft until saved', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const view = await mountConsole(store); cleanups.push(view.dispose)
    await button(view.node, en.agents).clickAsync()
    expect(store.getSnapshot().settingsDraft?.agents.childAccess).toBe('inherit')
    const writes = f.requests.filter((request) => request.method === 'PUT').length
    await input(view.node, en.childAccess, 'read-only')
    await input(view.node, en.roleProvider, 'codex-subscription')
    expect(store.getSnapshot().settingsDraft?.agents.childAccess).toBe('read-only')
    expect(store.getSnapshot().settingsDraft?.agents.role?.provider).toBe('codex-subscription')
    // Draft-only: editing publishes no write and leaves the saved record alone.
    expect(f.requests.filter((request) => request.method === 'PUT')).toHaveLength(writes)
    expect(f.settings.value.agents.childAccess).toBe('inherit')
    expect(f.settings.value.agents.role).toBeUndefined()
    await button(view.node, en.saveSettings).clickAsync()
    expect(f.settings.value.agents.childAccess).toBe('read-only')
    expect(f.settings.value.agents.role?.provider).toBe('codex-subscription')
  })
})
