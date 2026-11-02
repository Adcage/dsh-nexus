import { SettingsActions, type ConsolePageProps } from '../console.tsx'
import { RegistrationFacts } from './integrations.tsx'

export function TerminalPage(props: ConsolePageProps) {
  const { store, state, t } = props, draft = state.settingsDraft
  if (draft === undefined) return <p>{t('unavailable')}</p>
  function path(key: 'bashPath' | 'pwshPath', value: string) {
    if (draft === undefined) return
    const terminal = { ...draft.terminal }
    if (value === '') delete terminal[key]
    else terminal[key] = value
    store.editSettings({ ...draft, terminal })
  }
  return <article><h2>{t('terminal')}</h2><div className="dsh-nexus-fields">
    <label>{t('engine')}<select value={draft.terminal.engine} onChange={(e) => store.editSettings({ ...draft, terminal: { ...draft.terminal, engine: e.currentTarget.value === 'pwsh' ? 'pwsh' : 'bash' } })}><option value="bash">{t('bash')}</option><option value="pwsh">{t('pwsh')}</option></select></label>
    <label>{t('bashPath')}<input value={draft.terminal.bashPath ?? ''} onChange={(e) => path('bashPath', e.currentTarget.value)} /></label>
    <label>{t('pwshPath')}<input value={draft.terminal.pwshPath ?? ''} onChange={(e) => path('pwshPath', e.currentTarget.value)} /></label>
  </div><p>{t('terminalHelp')}</p><p>{t('timeoutHelp')}</p>
    <RegistrationFacts title={t('terminalRegistration')} fact={state.capabilities?.backendRegistrations.terminal} t={t} />
    <p>{t('registrationHelp')}</p><SettingsActions {...props} />
  </article>
}
