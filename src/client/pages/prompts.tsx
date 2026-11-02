import type { ConsolePageProps } from '../console.tsx'
import { PROMPT_MAX_MODULES } from '../../runtime/defaults.ts'

let fallbackModuleIds = 0
/** Session-unique module id; the timestamp-plus-counter fallback survives a non-secure origin without randomUUID. */
function newModuleId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `m${Date.now().toString(36)}-${fallbackModuleIds++}`
}

export function PromptsPage({ store, state, t }: ConsolePageProps) {
  const library = state.libraryDraft
  if (library === undefined) return <p>{t('unavailable')}</p>
  const update = (id: string, patch: { name?: string; body?: string }) => store.editLibrary({ ...library, modules: library.modules.map((m) => m.id === id ? { ...m, ...patch } : m) })
  const atModuleCap = library.modules.length >= PROMPT_MAX_MODULES
  const addModule = () => {
    if (atModuleCap) return
    store.editLibrary({ ...library, modules: [...library.modules, { id: newModuleId(), name: '', body: '' }] })
  }
  function move(index: number, offset: number) {
    const selection = [...state.selection]
    const destination = index + offset
    if (destination < 0 || destination >= selection.length) return
    ;[selection[index], selection[destination]] = [selection[destination]!, selection[index]!]
    store.setSelection(selection)
  }
  return <article><h2>{t('prompts')}</h2>
    <h3>{t('base')}</h3><pre data-base>{state.capabilities?.basePrompt}</pre>
    <h3>{t('modules')}</h3>
    {library.modules.map((module) => <fieldset key={module.id}>
      <legend>{module.name || t('untitledModule')}</legend>
      <label>{t('moduleName')}<input data-module-name value={module.name} onChange={(e) => update(module.id, { name: e.currentTarget.value })} /></label>
      <label>{t('moduleBody')}<textarea data-module-body value={module.body} onChange={(e) => update(module.id, { body: e.currentTarget.value })} /></label>
      <label className="dsh-nexus-check"><input data-module-select type="checkbox" checked={state.selection.includes(module.id)} onChange={(e) => store.setSelection(e.currentTarget.checked ? [...state.selection, module.id] : state.selection.filter((id) => id !== module.id))} />{t('includeModule')}</label>
      <button type="button" onClick={() => store.editLibrary({ modules: library.modules.filter((m) => m.id !== module.id), defaultSelection: library.defaultSelection.filter((id) => id !== module.id) })}>{t('deleteModule')}</button>
    </fieldset>)}
    <button type="button" disabled={atModuleCap} onClick={addModule}>{t('addModule')}</button>
    <h3>{t('selection')}</h3>
    {state.selection.length === 0 ? <p>{t('emptySelection')}</p> : <ol>{state.selection.map((id, index) => <li key={id}>
      <span>{library.modules.find((m) => m.id === id)?.name || t('untitledModule')}</span>
      <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>{t('moveUp')}</button>
      <button type="button" disabled={index === state.selection.length - 1} onClick={() => move(index, 1)}>{t('moveDown')}</button>
    </li>)}</ol>}
    <p>{t('defaultHelp')}</p><button type="button" onClick={() => store.useSelectionAsDefault()}>{t('useDefault')}</button>
    <h3>{t('savedDefault')}</h3><ol>{state.librarySaved?.value.defaultSelection.map((id) => <li key={id}>{state.librarySaved?.value.modules.find((m) => m.id === id)?.name || t('untitledModule')}</li>)}</ol>
    <p>{t(state.libraryDirty ? 'libraryDirty' : 'libraryClean')}</p>
    <div className="dsh-nexus-actions">
      <button type="button" disabled={state.busy.library} onClick={() => void store.saveLibrary()}>{t('saveLibrary')}</button>
      <button type="button" disabled={state.busy.library} onClick={() => void store.reloadLibrary()}>{t('reloadLibrary')}</button>
      <button type="button" disabled={state.busy.preview} onClick={() => void store.preview()}>{t('preview')}</button>
    </div>
    {state.preview !== undefined && <section><h3>{t('previewTitle')}</h3><pre data-preview>{state.preview.text}</pre></section>}
    <label>{t('target')}<select value={state.targetId === undefined ? '' : `id:${state.targetId}`} onChange={(e) => void store.selectTarget(e.currentTarget.value === '' ? undefined : e.currentTarget.value.slice(3))}>
      <option value="">{t('noTarget')}</option>{state.sessions.map((session) => <option key={session.id} value={`id:${session.id}`}>{session.title ? `${session.title} (${session.id})` : session.id}</option>)}
    </select></label>
    <p>{t('applyHelp')}</p><button type="button" disabled={!state.canApply} onClick={() => void store.applySelection()}>{t('apply')}</button>
    <h3>{t('appliedTitle')}</h3>{state.applied === undefined ? <p>{t('noApplied')}</p> : <pre data-applied>{state.applied.text}</pre>}
  </article>
}
