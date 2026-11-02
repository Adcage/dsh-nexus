import type { ConsoleBackendRegistration } from '../../protocol.ts'
import type { ConsolePageProps, ConsoleText } from '../console.tsx'

export function RegistrationFacts({ title, fact, t }: { title: string; fact?: ConsoleBackendRegistration; t: ConsoleText }) {
  return <section className="dsh-nexus-fact"><h3>{title}</h3>
    <p>{t(fact?.service ?? 'unknown')}</p>
    <p>{fact?.backends.state === 'registered' ? t('registered') : t(fact?.backends.state ?? 'unknown')}</p>
    {fact?.backends.names !== null && <ul>{fact?.backends.names.map((name) => <li key={name}>{name}</li>)}</ul>}
    <p>{t('unverified')}</p>
  </section>
}
export function IntegrationsPage({ state, t }: ConsolePageProps) {
  const facts = state.capabilities?.backendRegistrations
  return <article><h2>{t('integrations')}</h2><p>{t('registrationHelp')}</p>
    <RegistrationFacts title={t('terminalRegistration')} fact={facts?.terminal} t={t} />
    <RegistrationFacts title={t('webRegistration')} fact={facts?.web} t={t} />
    <RegistrationFacts title={t('agentRegistration')} fact={facts?.internalAgent} t={t} />
    <h3>{t('diagnostics')}</h3><ul>{state.capabilities?.diagnostics.map((message, index) => <li key={index}>{message}</li>)}</ul>
    <p>{t('nativeSettingsHelp')}</p>
  </article>
}
