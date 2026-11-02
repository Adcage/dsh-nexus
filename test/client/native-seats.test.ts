// @vitest-environment jsdom
/** Real rc.2 Cordis + native SlotRegistry; SDK browser factories use platform seeds. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it, vi } from 'vitest'
import { apply, NS } from '../../src/client/index.tsx'
import en from '../../src/locale/en.json' with { type: 'json' }
import { createClientHost, type LoaderEntry } from '../support/browser-loader.ts'

const require = createRequire(import.meta.url)
function nativeRegistry(ctx: Context): SlotRegistry {
  let captured: LoaderEntry | undefined
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: { load: (entry: LoaderEntry) => { captured = entry } } })
  try {
    const path = require.resolve('@deepseek-ai/dsh-client-ui-renderer/client')
    new Function(readFileSync(path, 'utf8'))()
    const exports = captured!.factory(require)
    const Registry = exports.SlotRegistry as new (ctx: Context) => SlotRegistry
    return new Registry(ctx)
  } finally {
    if (previous) Object.defineProperty(window, '__ModuleLoader__', previous)
    else Reflect.deleteProperty(window, '__ModuleLoader__')
  }
}

describe('additive native console seats', () => {
  it.each(['source', 'built'])('%s waits for native declarations, adds only owned cells, remounts and cleans registrations and style', async (face) => {
    const ctx = new Context()
    const slots = nativeRegistry(ctx)
    const localeListeners: Array<() => void> = []
    // Locale is a controlled external presentation boundary; slot registration
    // and declaration lifecycle below are actual SDK services, not imitations.
    ctx.provide('locale', {
      register: () => () => {},
      bind: () => (key: keyof typeof en) => en[key],
      subscribe: (listener: () => void) => {
        localeListeners.push(listener)
        return () => {
          const index = localeListeners.indexOf(listener)
          if (index !== -1) localeListeners.splice(index, 1)
        }
      },
    })
    const mount = face === 'source' ? apply : createClientHost().load().exports.apply as typeof apply
    const fork = ctx.plugin({ name: 'dsh-nexus-client', inject: ['slots', 'locale'], apply: mount })
    await Promise.resolve()
    expect(slots.entries('main')).toHaveLength(0)
    const declare = () => slots.register({ name: 'root', children: {
      main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' }, 'settings.section': { kind: 'list', scope: 'root' },
    } }, (_props: PropsRenderSlots<'main' | 'sidebar.panellist' | 'settings.section'>) => null)
    let owner = declare()
    expect(slots.entries('main').map((e) => e.options.key)).toEqual([NS])
    expect(slots.entries('sidebar.panellist').map((e) => e.options.id)).toEqual([NS])
    expect(slots.entries('settings.section').map((e) => e.options.id)).toEqual([NS])
    expect(slots.entries('root')).toHaveLength(1)
    // A locale switch must re-register the settings cell with fresh text exactly once.
    expect(localeListeners).toHaveLength(1)
    const settingsBefore = slots.entries('settings.section')
    for (const listener of [...localeListeners]) listener()
    const settingsAfter = slots.entries('settings.section')
    expect(settingsAfter).toHaveLength(1)
    expect(settingsAfter[0]!.options.id).toBe(NS)
    expect(settingsAfter[0]).not.toBe(settingsBefore[0])
    const main = slots.entries('main')[0]!
    expect(() => main.inject?.()).not.toThrow()
    expect(document.head.querySelectorAll('style[data-dsh-nexus]')).toHaveLength(1)
    owner()
    expect(slots.entries('main')).toHaveLength(0)
    owner = declare()
    expect(slots.entries('main')).toHaveLength(1)
    slots.register({ name: 'main', key: 'third-party' }, () => null)
    slots.register({ name: 'settings.section', id: 'third-party' }, () => null)
    await fork.dispose()
    expect(slots.entries('main').map((e) => e.options.key)).toEqual(['third-party'])
    expect(slots.entries('settings.section').map((e) => e.options.id)).toEqual(['third-party'])
    expect(document.head.querySelectorAll('style[data-dsh-nexus]')).toHaveLength(0)
    expect(localeListeners).toHaveLength(0)
    owner()
    await ctx.fiber.dispose()
  })
  it('contains apply failures rather than failing native boot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = new Context()
    expect(() => apply(ctx)).not.toThrow()
    warn.mockRestore()
    void ctx.fiber.dispose()
  })
})
