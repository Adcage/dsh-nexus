import { useMemo, useState, useSyncExternalStore } from 'react'
import type en from '../locale/en.json'
import { EMPTY_CONSOLE_SNAPSHOT, protectConsoleSource, type ConsoleSnapshot, type ConsoleStore } from './store.ts'
import { PromptsPage } from './pages/prompts.tsx'
import { ToolsPage } from './pages/tools.tsx'
import { TerminalPage } from './pages/terminal.tsx'
import { AgentsPage } from './pages/agents.tsx'
import { IntegrationsPage } from './pages/integrations.tsx'

export type ConsoleText = (key: keyof typeof en) => string
export interface NexusConsoleProps { readonly store: ConsoleStore; readonly t: ConsoleText; readonly surface?: 'main' | 'settings' }
export interface ConsolePageProps extends NexusConsoleProps { readonly state: ConsoleSnapshot }
const pages = { prompts: PromptsPage, tools: ToolsPage, terminal: TerminalPage, agents: AgentsPage, integrations: IntegrationsPage }

export function NexusConsole({ store, t, surface = 'main' }: NexusConsoleProps) {
  const source = useMemo(() => protectConsoleSource(store), [store])
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot, () => EMPTY_CONSOLE_SNAPSHOT)
  const [page, setPage] = useState<keyof typeof pages>('prompts')
  const Page = pages[page]
  return <section className="dsh-nexus-console" data-dsh-nexus-surface={surface} aria-label={t('panel')}>
    <header><div className="dsh-nexus-heading"><h1>{t('panel')}</h1>
      <button type="button" disabled={state.busy.refresh || state.busy.library || state.busy.settings} onClick={() => void store.refresh()}>{t('refresh')}</button>
    </div><p>{t('consoleHelp')}</p></header>
    <nav aria-label={t('panel')}>{(Object.keys(pages) as (keyof typeof pages)[]).map((key) =>
      <button key={key} type="button" aria-pressed={page === key} onClick={() => setPage(key)}>{t(key)}</button>)}</nav>
    {state.busy.refresh && <p role="status">{t('loading')}</p>}
    {state.notice !== 'idle' && <p className={state.notice === 'error' || state.notice === 'conflict' ? 'dsh-nexus-error' : ''} role="status">{t(state.notice)}</p>}
    {state.capabilities === undefined ? <p>{t('unavailable')}</p> : <Page store={store} state={state} t={t} />}
  </section>
}

export function SettingsActions({ store, state, t }: ConsolePageProps) {
  return <section className="dsh-nexus-actions"><p>{t('settingsHelp')}</p>
    <p>{t(state.settingsDirty ? 'settingsDirty' : 'settingsClean')}</p>
    <button type="button" disabled={state.settingsDraft === undefined || state.busy.settings} onClick={() => void store.saveSettings()}>{t('saveSettings')}</button>
    <button type="button" disabled={state.busy.settings} onClick={() => void store.reloadSettings()}>{t('reloadSettings')}</button>
  </section>
}
export function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label>{label}<input type="number" min={min} max={max} step={1} value={value} onChange={(e) => {
    // Publish only a value the host will accept; the draft keeps its last valid number otherwise.
    const next = e.currentTarget.valueAsNumber
    if (Number.isInteger(next) && next >= min && next <= max) onChange(next)
  }} /></label>
}
