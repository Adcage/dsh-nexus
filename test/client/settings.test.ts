// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createConsoleStore } from '../../src/client/store.ts'
import { createNexusApi } from '../../src/client/api.ts'
import en from '../../src/locale/en.json' with { type: 'json' }
import { clientFixture } from './fixture.ts'
import { mountConsole, button, input } from './render.ts'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
describe('five-page shared settings draft', () => {
  it('wires only actual supported fields and saves one full draft across all pages', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const view = await mountConsole(store); cleanups.push(view.dispose)
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
    await input(view.node, en.roleName, 'Reviewer')
    await input(view.node, en.roleInstructions, 'Review literal text')
    await input(view.node, en.roleModel, '')
    await button(view.node, en.saveSettings).clickAsync()
    expect(f.settings.value).toEqual({ files: { defaultLines: 500, maxOutputBytes: 16000 }, web: { maxResults: 7, maxCharsPerPage: 15000 }, terminal: { engine: 'pwsh', bashPath: 'C:/Program Files/Git/bin/bash.exe', pwshPath: 'C:/Program Files/PowerShell/7/pwsh.exe' }, agents: { concurrency: 6, maxDepth: 3, role: { name: 'Reviewer', instructions: 'Review literal text' } } })
    await button(view.node, en.integrations).clickAsync()
    expect(view.node.textContent).toContain(en.unknown)
    expect(view.node.textContent).toContain(en.registrationHelp)
    expect(view.node.textContent).toContain(en.nativeSettingsHelp)
    expect(view.node.querySelectorAll('a')).toHaveLength(0)
    expect(view.node.querySelectorAll('input')).toHaveLength(0)
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
})
