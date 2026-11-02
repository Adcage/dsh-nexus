import { NumberField, SettingsActions, type ConsolePageProps } from '../console.tsx'
import { FILE_READ_MIN_LINES, FILE_READ_MAX_LINES, FILE_OUTPUT_MIN_BYTES, FILE_OUTPUT_MAX_BYTES, WEB_MAX_RESULTS, WEB_MAX_CHARS_PER_PAGE } from '../../runtime/defaults.ts'

export function ToolsPage(props: ConsolePageProps) {
  const { store, state, t } = props, draft = state.settingsDraft
  if (draft === undefined) return <p>{t('unavailable')}</p>
  return <article><h2>{t('tools')}</h2><div className="dsh-nexus-fields">
    <NumberField label={t('defaultLines')} value={draft.files.defaultLines} min={FILE_READ_MIN_LINES} max={FILE_READ_MAX_LINES} onChange={(defaultLines) => store.editSettings({ ...draft, files: { ...draft.files, defaultLines } })} />
    <NumberField label={t('maxOutputBytes')} value={draft.files.maxOutputBytes} min={FILE_OUTPUT_MIN_BYTES} max={FILE_OUTPUT_MAX_BYTES} onChange={(maxOutputBytes) => store.editSettings({ ...draft, files: { ...draft.files, maxOutputBytes } })} />
    <NumberField label={t('maxResults')} value={draft.web.maxResults} min={1} max={WEB_MAX_RESULTS} onChange={(maxResults) => store.editSettings({ ...draft, web: { ...draft.web, maxResults } })} />
    <NumberField label={t('maxCharsPerPage')} value={draft.web.maxCharsPerPage} min={1} max={WEB_MAX_CHARS_PER_PAGE} onChange={(maxCharsPerPage) => store.editSettings({ ...draft, web: { ...draft.web, maxCharsPerPage } })} />
  </div><p>{t('pageBudgetHelp')}</p><SettingsActions {...props} /></article>
}
