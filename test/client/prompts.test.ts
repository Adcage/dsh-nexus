// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { NexusConsole } from '../../src/client/console.tsx'
import { createConsoleStore } from '../../src/client/store.ts'
import { createNexusApi } from '../../src/client/api.ts'
import en from '../../src/locale/en.json' with { type: 'json' }
import { clientFixture } from './fixture.ts'
import { mountConsole, button, input } from './render.ts'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
describe('Prompts component event wiring', () => {
  it('edits, selects, orders and previews literal draft text without persisting; save and apply stay separate', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const view = await mountConsole(store); cleanups.push(view.dispose)
    expect(view.node.textContent).toContain(en.prompts)
    expect(view.node.querySelector('[data-base]')?.textContent).toBe(f.basePrompt)
    expect(button(view.node, en.apply).disabled).toBe(true)
    await input(view.node, en.target, 'id:B')
    await button(view.node, en.addModule).clickAsync()
    const names = view.node.querySelectorAll<HTMLInputElement>('input[data-module-name]')
    expect(names).toHaveLength(2)
    await view.change(names[1]!, 'User <script>name</script>')
    const bodies = view.node.querySelectorAll<HTMLTextAreaElement>('textarea[data-module-body]')
    await view.change(bodies[1]!, ' \n{{literal}} ${literal}\n ')
    await view.click(view.node.querySelectorAll<HTMLInputElement>('input[data-module-select]')[1]!)
    await button(view.node, en.moveUp).clickAsync()
    await button(view.node, en.preview).clickAsync()
    expect(view.node.querySelector('[data-preview]')?.textContent).toBe(`${f.basePrompt}\n\n \n{{literal}} \${literal}\n \n\n${f.library.value.modules[0]!.body}`)
    expect(f.requests.filter((r) => r.method === 'PUT' || r.path.includes('/session-keys/') && r.method === 'POST')).toHaveLength(0)
    expect(button(view.node, en.apply).disabled).toBe(true)
    await button(view.node, en.useDefault).clickAsync()
    await button(view.node, en.saveLibrary).clickAsync()
    expect(store.getSnapshot().libraryDirty).toBe(false)
    expect(store.getSnapshot().applied?.selection).toEqual([])
    await button(view.node, en.apply).clickAsync()
    expect(store.getSnapshot().applied?.sessionId).toBe('B')
    expect(store.getSnapshot().applied?.modules[0]?.body).toBe(' \n{{literal}} ${literal}\n ')
    expect(view.node.querySelector('script')).toBeNull()
    expect(view.node.textContent).not.toMatch(/配置版本号|版本差异|有更新可用/)
    await view.change(view.node.querySelectorAll<HTMLTextAreaElement>('textarea[data-module-body]')[1]!, 'UNSAVED')
    expect(button(view.node, en.apply).disabled).toBe(true)
    expect(view.node.querySelector('[data-applied]')?.textContent).not.toContain('UNSAVED')
    await button(view.node, en.deleteModule).clickAsync()
    expect(store.getSnapshot().libraryDraft?.modules).toHaveLength(1)
  })

  it('contains a throwing or unstable foreign snapshot and subscription without rendering loops', async () => {
    const store = createConsoleStore(createNexusApi(clientFixture().fetch))
    await store.refresh()
    const stable = store.getSnapshot()
    const foreign = { ...store, getSnapshot: () => JSON.parse(JSON.stringify(stable)), subscribe: () => { throw new Error('foreign source') } }
    const node = document.createElement('div')
    const root = createRoot(node)
    await act(async () => root.render(createElement(NexusConsole, { store: foreign, t: (key) => en[key] })))
    expect(node.textContent).toContain(en.prompts)
    foreign.getSnapshot = () => { throw new Error('foreign snapshot') }
    await act(async () => root.render(createElement(NexusConsole, { store: foreign, t: (key) => en[key] })))
    expect(node.textContent).toContain(en.prompts)
    await act(async () => root.unmount())
  })
})
