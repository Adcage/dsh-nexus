import { NumberField, SettingsActions, type ConsolePageProps } from '../console.tsx'
import { TOOL_DISPLAY_MODES, type ToolDisplayMode } from '../../protocol.ts'
import { FILE_READ_MIN_LINES, FILE_READ_MAX_LINES, FILE_OUTPUT_MIN_BYTES, FILE_OUTPUT_MAX_BYTES, WEB_MAX_RESULTS, WEB_MAX_CHARS_PER_PAGE } from '../../runtime/defaults.ts'

/** Dictionary label and one-line explanation of each display mode. */
const MODE_LABEL = {
  nexus: 'toolDisplayNexus',
  auto: 'toolDisplayAuto',
  native: 'toolDisplayNative',
} as const satisfies Record<ToolDisplayMode, string>
const MODE_HELP = {
  nexus: 'toolDisplayNexusHelp',
  auto: 'toolDisplayAutoHelp',
  native: 'toolDisplayNativeHelp',
} as const satisfies Record<ToolDisplayMode, string>

export function ToolsPage(props: ConsolePageProps) {
  const { store, state, t } = props, draft = state.settingsDraft
  if (draft === undefined) return <p>{t('unavailable')}</p>
  return <article><h2>{t('tools')}</h2><div className="dsh-nexus-fields">
    <label>{t('toolDisplay')}<select value={draft.toolDisplay} onChange={(event) => {
      // The shared draft is the only thing this control edits; the section's
      // existing Save action is what persists it.
      const mode = TOOL_DISPLAY_MODES.find((candidate) => candidate === event.currentTarget.value)
      if (mode !== undefined) store.editSettings({ ...draft, toolDisplay: mode })
    }}>{TOOL_DISPLAY_MODES.map((mode) => <option key={mode} value={mode}>{t(MODE_LABEL[mode])}</option>)}</select></label>
    <NumberField label={t('defaultLines')} value={draft.files.defaultLines} min={FILE_READ_MIN_LINES} max={FILE_READ_MAX_LINES} onChange={(defaultLines) => store.editSettings({ ...draft, files: { ...draft.files, defaultLines } })} />
    <NumberField label={t('maxOutputBytes')} value={draft.files.maxOutputBytes} min={FILE_OUTPUT_MIN_BYTES} max={FILE_OUTPUT_MAX_BYTES} onChange={(maxOutputBytes) => store.editSettings({ ...draft, files: { ...draft.files, maxOutputBytes } })} />
    <NumberField label={t('maxResults')} value={draft.web.maxResults} min={1} max={WEB_MAX_RESULTS} onChange={(maxResults) => store.editSettings({ ...draft, web: { ...draft.web, maxResults } })} />
    <NumberField label={t('maxCharsPerPage')} value={draft.web.maxCharsPerPage} min={1} max={WEB_MAX_CHARS_PER_PAGE} onChange={(maxCharsPerPage) => store.editSettings({ ...draft, web: { ...draft.web, maxCharsPerPage } })} />
  </div><p>{t('toolDisplayHelp')}</p><p>{t(MODE_HELP[draft.toolDisplay])}</p><p>{t('pageBudgetHelp')}</p><SettingsActions {...props} /></article>
}
