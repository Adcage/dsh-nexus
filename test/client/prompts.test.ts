// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { NexusConsole } from '../../src/client/console.tsx'
import { createConsoleStore } from '../../src/client/store.ts'
import { createNexusApi } from '../../src/client/api.ts'
import en from '../../src/locale/en.json' with { type: 'json' }
import { PROMPT_MAX_MODULES } from '../../src/runtime/defaults.ts'
import { clientFixture } from './fixture.ts'
import { mountConsole, button, input } from './render.ts'

function modules(count: number) {
  return {
    modules: Array.from({ length: count }, (_, index) => ({ id: `module-${index + 1}`, name: `Module ${index + 1}`, body: '' })),
    defaultSelection: [] as string[],
  }
}

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

  it('does not append a 33rd module or offer Add at PROMPT_MAX_MODULES', async () => {
    const f = clientFixture()
    f.library = { value: modules(PROMPT_MAX_MODULES), hash: 'at-cap' }
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const view = await mountConsole(store); cleanups.push(view.dispose)
    await button(view.node, en.addModule).clickAsync()
    expect(store.getSnapshot().libraryDraft?.modules).toHaveLength(PROMPT_MAX_MODULES)
    expect(button(view.node, en.addModule).disabled).toBe(true)
  })

  it('still adds the module that reaches PROMPT_MAX_MODULES', async () => {
    const f = clientFixture()
    f.library = { value: modules(PROMPT_MAX_MODULES - 1), hash: 'near-cap' }
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const view = await mountConsole(store); cleanups.push(view.dispose)
    await button(view.node, en.addModule).clickAsync()
    expect(store.getSnapshot().libraryDraft?.modules).toHaveLength(PROMPT_MAX_MODULES)
    expect(button(view.node, en.addModule).disabled).toBe(true)
  })

  it('generates a unique module id without crypto.randomUUID and shows a short placeholder legend until renamed', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const cryptoObject = globalThis.crypto
    const randomUUID = Object.getOwnPropertyDescriptor(cryptoObject, 'randomUUID')
    Object.defineProperty(cryptoObject, 'randomUUID', { configurable: true, value: undefined })
    try {
      const view = await mountConsole(store); cleanups.push(view.dispose)
      await button(view.node, en.addModule).clickAsync()
      await button(view.node, en.addModule).clickAsync()
      const draft = store.getSnapshot().libraryDraft!
      expect(draft.modules).toHaveLength(3)
      const added = draft.modules.slice(1)
      expect(new Set(draft.modules.map((module) => module.id)).size).toBe(3)
      for (const module of added) expect(module.id.length).toBeGreaterThan(0)
      const legends = [...view.node.querySelectorAll('fieldset legend')].map((legend) => legend.textContent)
      expect(legends).toHaveLength(3)
      expect(legends.slice(1)).toEqual([en.untitledModule, en.untitledModule])
      for (const module of added) expect(legends.join(' ')).not.toContain(module.id)
      await view.change(view.node.querySelectorAll<HTMLInputElement>('input[data-module-name]')[1]!, 'Renamed')
      expect([...view.node.querySelectorAll('fieldset legend')][1]?.textContent).toBe('Renamed')
      await view.click(view.node.querySelectorAll<HTMLInputElement>('input[data-module-select]')[1]!)
      expect(store.getSnapshot().selection).toEqual(['one', added[0]!.id])
    } finally {
      if (randomUUID) Object.defineProperty(cryptoObject, 'randomUUID', randomUUID)
      else Reflect.deleteProperty(cryptoObject, 'randomUUID')
    }
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
