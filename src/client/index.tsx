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
import { createConsoleStore, type ConsoleStore } from './store.ts'
import type { ToolDisplayMode } from '../protocol.ts'
import { NexusConsole } from './console.tsx'
import { registerNexusToolViews, TOOL_VIEW_PRIORITY, TOOL_VIEW_SLOT } from './tool-views.tsx'

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
/**
 * The display mode the live console asks for right now, or `undefined` while the
 * stored mode is still unknown.
 *
 * Draft first: the console control previews its own presentation immediately,
 * while saving remains the explicit action that makes it the stored default.
 * Saved settings answer on a fresh load before the read completes. Until either
 * exists nothing may be registered: the documented default would claim rank 0
 * in that window and can make a third-party plugin registering the same key at
 * that rank throw, which is the coexistence case this switch exists for.
 *
 * The `nexus` fallback waits for the settings read itself, not for a failed
 * request: `notice` is store-wide, so a failing library read while the settings
 * GET is still in flight would otherwise claim rank 0 in exactly that window.
 * Only a settled settings read with no stored value answers with the default, so
 * a user still gets cards when the settings read is refused.
 */
function requestedToolDisplay(store: ConsoleStore): ToolDisplayMode | undefined {
  const snapshot = store.getSnapshot()
  if (snapshot.settingsDraft !== undefined) return snapshot.settingsDraft.toolDisplay
  if (snapshot.settingsSaved !== undefined) return snapshot.settingsSaved.value.toolDisplay
  return snapshot.settingsSettled ? 'nexus' : undefined
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
    const mainFace = () => ({ store, surface: 'main' as const })
    const settingsFace = () => ({ store, surface: 'settings' as const })
    ctx.effect(() => ctx.slots.inject('main', () => safeRegistration(() =>
      ctx.slots.register({ name: 'main', key: NS, locale: NS, inject: mainFace }, NexusConsole),
    )), 'dsh-nexus: main console')
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => safeRegistration(() =>
      ctx.slots.register({ name: 'sidebar.panellist', id: NS, order: 50, label: () => t('panel') }, ConsoleIcon),
    )), 'dsh-nexus: sidebar entry')
    ctx.effect(() => ctx.slots.inject('settings.section', () => safeRegistration(() => {
      let remove = noop
      const register = () => {
        remove()
        remove = safeRegistration(() => ctx.slots.register({ name: 'settings.section', id: NS, order: 50, label: t('panel'), locale: NS, inject: settingsFace }, NexusConsole))
      }
      register()
      let unsubscribe = noop
      try { unsubscribe = ctx.locale.subscribe(register) } catch { /* Initial native label remains usable. */ }
      return () => { try { unsubscribe() } catch { /* Foreign observer cleanup cannot block unload. */ } remove() }
    })), 'dsh-nexus: settings console')
    ctx.effect(() => {
      // The Tool owner declares `tool.call.toolview`. When that package is not
      // composed every call keeps its generic card, so a missing declaration
      // must not disturb the console seats registered above. The mode is read
      // from the live store on every publish: registration waits until the
      // stored mode is known, a switch disposes the old cells and registers
      // once at the new rank, and an unchanged mode does nothing.
      let dispose = noop
      let active: ToolDisplayMode | undefined
      let requested: ToolDisplayMode | undefined
      let warned: ToolDisplayMode | undefined
      const reconcile = () => {
        const mode = requestedToolDisplay(store)
        // A requested mode that changes is a fresh attempt, so the warning latch
        // below must not silence a later refusal of the same mode forever.
        if (mode !== requested) { requested = mode; warned = undefined }
        if (mode === active) return
        dispose()
        dispose = noop
        if (mode === undefined || mode === 'native') { active = mode; return }
        try {
          dispose = ctx.slots.inject(TOOL_VIEW_SLOT, () => registerNexusToolViews(ctx, TOOL_VIEW_PRIORITY[mode]))
          active = mode
        } catch {
          // Not applied: leave the mode unknown so a later publish retries, and
          // warn once per mode so a permanently absent slot cannot spam the log.
          if (warned === mode) return
          warned = mode
          console.warn('[dsh-nexus] the native tool card slot is unavailable')
        }
      }
      reconcile()
      const unsubscribe = store.subscribe(reconcile)
      return () => { unsubscribe(); dispose() }
    }, 'dsh-nexus: tool result views')
    void store.refresh()
  } catch {
    // Do not print foreign errors, native objects, tokens or request bodies.
    console.warn('[dsh-nexus] the console could not mount')
  }
}
