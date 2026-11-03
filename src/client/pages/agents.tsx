import { useId } from 'react'
import { NumberField, SettingsActions, type ConsolePageProps } from '../console.tsx'
import {
  AGENT_MIN_CONCURRENCY,
  AGENT_MAX_CONCURRENCY,
  AGENT_MIN_DEPTH,
  AGENT_MAX_DEPTH,
} from '../../runtime/defaults.ts'
import { CHILD_ACCESS_SETTINGS, type ChildAccessSetting } from '../../protocol.ts'
import type en from '../../locale/en.json'

/** Label key of each ceiling option. */
const ACCESS_LABEL: Readonly<Record<ChildAccessSetting, keyof typeof en>> = {
  inherit: 'childAccessInherit',
  'workspace-write': 'childAccessWorkspaceWrite',
  'read-only': 'childAccessReadOnly',
}

/** One explanation line per ceiling option, in the same order as the options. */
const ACCESS_HELP: Readonly<Record<ChildAccessSetting, keyof typeof en>> = {
  inherit: 'childAccessInheritHelp',
  'workspace-write': 'childAccessWorkspaceWriteHelp',
  'read-only': 'childAccessReadOnlyHelp',
}

export function AgentsPage(props: ConsolePageProps) {
  const { store, state, t } = props, draft = state.settingsDraft
  const providerList = useId(), modelList = useId()
  if (draft === undefined) return <p>{t('unavailable')}</p>
  function role(key: 'name' | 'instructions' | 'model' | 'provider', value: string) {
    if (draft === undefined) return
    const next = { ...draft.agents.role }
    if (value === '') delete next[key]
    else next[key] = value
    const agents = { ...draft.agents }
    if (Object.keys(next).length === 0) delete agents.role
    else agents.role = next
    store.editSettings({ ...draft, agents })
  }
  function childAccess(value: string) {
    if (draft === undefined) return
    const mode = CHILD_ACCESS_SETTINGS.find((candidate) => candidate === value)
    if (mode !== undefined) store.editSettings({ ...draft, agents: { ...draft.agents, childAccess: mode } })
  }
  return <article><h2>{t('agents')}</h2><p>{t('agentHelp')}</p><div className="dsh-nexus-fields">
    <NumberField label={t('concurrency')} value={draft.agents.concurrency} min={AGENT_MIN_CONCURRENCY} max={AGENT_MAX_CONCURRENCY} onChange={(concurrency) => store.editSettings({ ...draft, agents: { ...draft.agents, concurrency } })} />
    <NumberField label={t('maxDepth')} value={draft.agents.maxDepth} min={AGENT_MIN_DEPTH} max={AGENT_MAX_DEPTH} onChange={(maxDepth) => store.editSettings({ ...draft, agents: { ...draft.agents, maxDepth } })} />
    <label>{t('childAccess')}<select value={draft.agents.childAccess} onChange={(e) => childAccess(e.currentTarget.value)}>
      {CHILD_ACCESS_SETTINGS.map((mode) => <option key={mode} value={mode}>{t(ACCESS_LABEL[mode])}</option>)}
    </select></label>
    <label>{t('roleName')}<input value={draft.agents.role?.name ?? ''} onChange={(e) => role('name', e.currentTarget.value)} /></label>
    <label>{t('roleInstructions')}<textarea value={draft.agents.role?.instructions ?? ''} onChange={(e) => role('instructions', e.currentTarget.value)} /></label>
    <label>{t('roleProvider')}<input list={providerList} value={draft.agents.role?.provider ?? ''} onChange={(e) => role('provider', e.currentTarget.value)} onBlur={(e) => void store.suggestChildModels(e.currentTarget.value)} /></label>
    <datalist id={providerList}>{state.capabilities?.providers.map((provider) => <option key={provider} value={provider} />)}</datalist>
    <label>{t('roleModel')}<input list={modelList} value={draft.agents.role?.model ?? ''} onChange={(e) => role('model', e.currentTarget.value)} onFocus={() => void store.suggestChildModels(draft.agents.role?.provider ?? '')} /></label>
    <datalist id={modelList}>{state.childModels !== undefined && state.childModels.provider === draft.agents.role?.provider?.trim() && state.childModels.models.map((model) => <option key={model} value={model}>{state.childModels?.provider} / {model}</option>)}</datalist>
  </div>
  <ul className="dsh-nexus-access-lines">
    {CHILD_ACCESS_SETTINGS.map((mode) => <li key={mode}>{t(ACCESS_HELP[mode])}</li>)}
  </ul>
  <p className="dsh-nexus-error">{t('childAccessWarning')}</p>
  <p>{t('roleProviderHelp')}</p>
  <SettingsActions {...props} /></article>
}
