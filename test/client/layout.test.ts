// @vitest-environment jsdom
/** Presentation contract only; actual pixel/scroll assertions run in Chrome, not jsdom. */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { NexusConsole } from '../../src/client/console.tsx'
import { createConsoleStore } from '../../src/client/store.ts'
import { createNexusApi } from '../../src/client/api.ts'
import en from '../../src/locale/en.json' with { type: 'json' }
import { clientFixture } from './fixture.ts'
import { click } from './render.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
describe('NexusConsole surface layout contract', () => {
  it.each([undefined, 'main', 'settings'] as const)('identifies %s without changing five-page button navigation or refresh', async (surface) => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const node = document.createElement('div')
    const root = createRoot(node)
    try {
      await act(async () => root.render(createElement(NexusConsole, { store, t: (key) => en[key], ...surface === undefined ? {} : { surface } })))
      expect(node.querySelector('.dsh-nexus-console')?.getAttribute('data-dsh-nexus-surface')).toBe(surface ?? 'main')
      const titleRow = node.querySelector('.dsh-nexus-heading')!
      expect(titleRow.querySelector('h1')?.textContent).toBe(en.panel)
      const refresh = titleRow.querySelector('button')!
      expect(refresh.type).toBe('button')
      expect(refresh.textContent).toBe(en.refresh)
      expect(node.querySelector('header > p')?.textContent).toBe(en.consoleHelp)
      const nav = node.querySelector('nav')!
      expect(nav.getAttribute('aria-label')).toBe(en.panel)
      expect(nav.querySelector('[role="tab"]')).toBeNull()
      const buttons = [...nav.querySelectorAll('button')]
      expect(buttons.map((b) => b.textContent)).toEqual(['prompts', 'tools', 'terminal', 'agents', 'integrations'].map((key) => en[key as keyof typeof en]))
      for (const b of buttons) {
        expect(b.type).toBe('button')
        await click(b)
        expect(b.getAttribute('aria-pressed')).toBe('true')
        expect(buttons.filter((other) => other.getAttribute('aria-pressed') === 'true')).toEqual([b])
        expect(node.querySelector('article h2')?.textContent).toBe(b.textContent)
      }
      const requestsBefore = f.requests.length
      await click(refresh)
      expect(f.requests.length).toBeGreaterThan(requestsBefore)
    } finally {
      await act(async () => root.unmount())
      store.dispose()
    }
  })
})
