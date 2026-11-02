import { NumberField, SettingsActions, type ConsolePageProps } from '../console.tsx'
import { AGENT_MIN_CONCURRENCY, AGENT_MAX_CONCURRENCY, AGENT_MIN_DEPTH, AGENT_MAX_DEPTH } from '../../runtime/defaults.ts'

export function AgentsPage(props: ConsolePageProps) {
  const { store, state, t } = props, draft = state.settingsDraft
  if (draft === undefined) return <p>{t('unavailable')}</p>
  function role(key: 'name' | 'instructions' | 'model', value: string) {
    if (draft === undefined) return
    const next = { ...draft.agents.role }
    if (value === '') delete next[key]
    else next[key] = value
    const agents = { ...draft.agents }
    if (Object.keys(next).length === 0) delete agents.role
    else agents.role = next
    store.editSettings({ ...draft, agents })
  }
  return <article><h2>{t('agents')}</h2><p>{t('agentHelp')}</p><div className="dsh-nexus-fields">
    <NumberField label={t('concurrency')} value={draft.agents.concurrency} min={AGENT_MIN_CONCURRENCY} max={AGENT_MAX_CONCURRENCY} onChange={(concurrency) => store.editSettings({ ...draft, agents: { ...draft.agents, concurrency } })} />
    <NumberField label={t('maxDepth')} value={draft.agents.maxDepth} min={AGENT_MIN_DEPTH} max={AGENT_MAX_DEPTH} onChange={(maxDepth) => store.editSettings({ ...draft, agents: { ...draft.agents, maxDepth } })} />
    <label>{t('roleName')}<input value={draft.agents.role?.name ?? ''} onChange={(e) => role('name', e.currentTarget.value)} /></label>
    <label>{t('roleInstructions')}<textarea value={draft.agents.role?.instructions ?? ''} onChange={(e) => role('instructions', e.currentTarget.value)} /></label>
    <label>{t('roleModel')}<input value={draft.agents.role?.model ?? ''} onChange={(e) => role('model', e.currentTarget.value)} /></label>
  </div><SettingsActions {...props} /></article>
}
