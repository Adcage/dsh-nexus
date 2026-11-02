/// <reference path="./assets.d.ts" />
/** Additive browser face; all SDK imports below are declarations, not runtime modules. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import en from '../locale/en.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import css from './styles.css?raw'
import { createNexusApi } from './api.ts'
import { createConsoleStore } from './store.ts'
import { NexusConsole } from './console.tsx'
import { registerNexusToolViews } from './tool-views.tsx'

export const NS = 'dshNexus'
export const inject = ['slots', 'locale']
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { dshNexus: keyof typeof en }
}
const noop = () => {}
function safeRegistration(register: () => () => void): () => void {
  try { return register() } catch {
    console.warn('[dsh-nexus] a native console seat is unavailable')
    return noop
  }
}
function ConsoleIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
}

export function apply(ctx: Context): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-nexus: dictionaries')
    const store = createConsoleStore(createNexusApi())
    ctx.effect(() => () => store.dispose(), 'dsh-nexus: console state')
    ctx.effect(() => {
      if (typeof document === 'undefined') return noop
      const style = document.createElement('style')
      style.dataset.dshNexus = ''
      style.textContent = css
      document.head.append(style)
      return () => style.remove()
    }, 'dsh-nexus: console styles')
    const t = ctx.locale.bind(NS)
    // These factories close over owned values only: no foreign snapshots or
    // native session objects are read during the renderer's inject phase.
    const consoleFace = () => ({ store })
    ctx.effect(() => ctx.slots.inject('main', () => safeRegistration(() =>
      ctx.slots.register({ name: 'main', key: NS, locale: NS, inject: consoleFace }, NexusConsole),
    )), 'dsh-nexus: main console')
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => safeRegistration(() =>
      ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 50, label: () => t('panel') }, ConsoleIcon),
    )), 'dsh-nexus: sidebar entry')
    ctx.effect(() => ctx.slots.inject('settings.section', () => safeRegistration(() => {
      let remove = noop
      const register = () => {
        remove()
        remove = safeRegistration(() => ctx.slots.register({ name: 'settings.section', id: NS, order: 50, label: t('panel'), locale: NS, inject: consoleFace }, NexusConsole))
      }
      register()
      let unsubscribe = noop
      try { unsubscribe = ctx.locale.subscribe(register) } catch { /* Initial native label remains usable. */ }
      return () => { try { unsubscribe() } catch { /* Foreign observer cleanup cannot block unload. */ } remove() }
    })), 'dsh-nexus: settings console')
    ctx.effect(() => {
      // The Tool owner declares `tool.call.toolview`. When that package is not
      // composed every call keeps its generic card, so a missing declaration
      // must not disturb the console seats registered above.
      try {
        return ctx.slots.inject('tool.call.toolview', () => registerNexusToolViews(ctx))
      } catch {
        console.warn('[dsh-nexus] the native tool card slot is unavailable')
        return noop
      }
    }, 'dsh-nexus: tool result views')
    void store.refresh()
  } catch {
    // Do not print foreign errors, native objects, tokens or request bodies.
    console.warn('[dsh-nexus] the console could not mount')
  }
}
