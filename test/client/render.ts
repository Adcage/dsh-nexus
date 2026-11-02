import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect } from 'vitest'
import { NexusConsole } from '../../src/client/console.tsx'
import type { ConsoleStore } from '../../src/client/store.ts'
import en from '../../src/locale/en.json' with { type: 'json' }

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
export async function click(element: HTMLElement) { await act(async () => element.click()) }
export function button(node: HTMLElement, text: string) {
  const matching = [...node.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === text)
  const found = matching.find((b) => !b.disabled) ?? matching[0]
  expect(found, `button ${text}`).toBeDefined()
  return Object.assign(found!, { clickAsync: () => click(found!) })
}
export async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}
export async function input(node: HTMLElement, label: string, value: string) {
  const found = [...node.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))
  expect(found, `label ${label}`).toBeDefined()
  await change(found!.querySelector('input,textarea,select')!, value)
}
export async function mountConsole(store: ConsoleStore) {
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  await act(async () => root.render(createElement(NexusConsole, { store, t: (key) => en[key] })))
  return { node, click, change, dispose: () => { act(() => root.unmount()); node.remove(); store.dispose() } }
}
