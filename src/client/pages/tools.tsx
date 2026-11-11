import { NumberField, SettingsActions, type ConsolePageProps } from '../console.tsx'
import {
  NEXUS_TOOL_KEYS,
  TOOL_DISPLAY_MODES,
  TOOL_PROFILES,
  TOOL_PROFILE_SETS,
  type NexusToolKey,
  type ToolDisplayMode,
  type ToolProfile,
  type ToolSettings,
} from '../../protocol.ts'
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
/** Dictionary label of each offered tool profile. */
const PROFILE_LABEL = {
  minimal: 'toolProfileMinimal',
  coding: 'toolProfileCoding',
  research: 'toolProfileResearch',
} as const satisfies Record<ToolProfile, string>
/** Dictionary label of each restrictable tool. */
const TOOL_LABEL = {
  read: 'toolRead',
  write: 'toolWrite',
  edit: 'toolEdit',
  shell: 'toolShell',
  web: 'toolWeb',
  agent: 'toolAgent',
} as const satisfies Record<NexusToolKey, string>

/** Whether two stored tool sets are identical. */
function sameTools(left: ToolSettings, right: ToolSettings): boolean {
  return NEXUS_TOOL_KEYS.every((key) => left[key] === right[key])
}

/**
 * The profile a stored tool set currently equals, if any.
 * @param tools - the stored switches.
 * @returns the matching profile name, or `undefined` for a hand-tuned set.
 */
function profileOf(tools: ToolSettings): ToolProfile | undefined {
  return TOOL_PROFILES.find((name) => sameTools(tools, TOOL_PROFILE_SETS[name]))
}

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
    <label>{t('toolProfile')}<select value={profileOf(draft.tools) ?? 'custom'} onChange={(event) => {
      // A profile is a bulk fill, never a stored field: the switches below stay
      // the single source of truth, so a hand-tuned set needs no extra state.
      const profile = TOOL_PROFILES.find((candidate) => candidate === event.currentTarget.value)
      if (profile !== undefined) store.editSettings({ ...draft, tools: { ...TOOL_PROFILE_SETS[profile] } })
    }}>
      {TOOL_PROFILES.map((profile) => <option key={profile} value={profile}>{t(PROFILE_LABEL[profile])}</option>)}
      <option value="custom">{t('toolProfileCustom')}</option>
    </select></label>
    <fieldset className="dsh-nexus-tools"><legend>{t('toolsIncluded')}</legend>
      {NEXUS_TOOL_KEYS.map((key) => <label key={key}><input type="checkbox" checked={draft.tools[key]} onChange={(event) => {
        store.editSettings({ ...draft, tools: { ...draft.tools, [key]: event.currentTarget.checked } })
      }} />{t(TOOL_LABEL[key])}</label>)}
    </fieldset>
    <NumberField label={t('defaultLines')} value={draft.files.defaultLines} min={FILE_READ_MIN_LINES} max={FILE_READ_MAX_LINES} onChange={(defaultLines) => store.editSettings({ ...draft, files: { ...draft.files, defaultLines } })} />
    <NumberField label={t('maxOutputBytes')} value={draft.files.maxOutputBytes} min={FILE_OUTPUT_MIN_BYTES} max={FILE_OUTPUT_MAX_BYTES} onChange={(maxOutputBytes) => store.editSettings({ ...draft, files: { ...draft.files, maxOutputBytes } })} />
    <NumberField label={t('maxResults')} value={draft.web.maxResults} min={1} max={WEB_MAX_RESULTS} onChange={(maxResults) => store.editSettings({ ...draft, web: { ...draft.web, maxResults } })} />
    <NumberField label={t('maxCharsPerPage')} value={draft.web.maxCharsPerPage} min={1} max={WEB_MAX_CHARS_PER_PAGE} onChange={(maxCharsPerPage) => store.editSettings({ ...draft, web: { ...draft.web, maxCharsPerPage } })} />
  </div><p>{t('toolDisplayHelp')}</p><p>{t(MODE_HELP[draft.toolDisplay])}</p><p>{t('toolProfileHelp')}</p><p>{t('toolsHelp')}</p><p>{t('pageBudgetHelp')}</p><SettingsActions {...props} /></article>
}
