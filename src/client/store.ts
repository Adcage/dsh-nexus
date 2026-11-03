/** One lifecycle-owned console state. Draft revisions and target epochs are independent. */
import { z } from 'zod'
import type { ConsoleSession, ConsoleStored, PromptLibrary, PromptPreview, PromptSnapshot, RuntimeSettings } from '../protocol.ts'
import { consoleData, NexusApiError, type NexusApi, type PublicCapabilities } from './api.ts'

export type ConsoleNotice = 'idle' | 'saved' | 'previewed' | 'applied' | 'error' | 'conflict'
export interface ConsoleSnapshot {
  readonly capabilities?: PublicCapabilities
  readonly childModels?: { readonly provider: string; readonly models: readonly string[] }
  readonly sessions: readonly ConsoleSession[]
  readonly librarySaved?: ConsoleStored<PromptLibrary>
  readonly libraryDraft?: PromptLibrary
  readonly settingsSaved?: ConsoleStored<RuntimeSettings>
  readonly settingsDraft?: RuntimeSettings
  /**
   * Whether the stored-settings read has answered — successfully or not.
   *
   * `notice` is store-wide and is published by every failing request, so it
   * cannot tell a caller whether the *settings* read is still in flight. Only
   * this flag may gate a decision that depends on the stored settings.
   */
  readonly settingsSettled: boolean
  readonly libraryDirty: boolean
  readonly settingsDirty: boolean
  readonly selection: readonly string[]
  readonly targetId?: string
  readonly applied?: PromptSnapshot
  readonly preview?: PromptPreview
  readonly canApply: boolean
  readonly notice: ConsoleNotice
  readonly busy: Readonly<{ refresh: boolean; library: boolean; settings: boolean; preview: boolean; apply: boolean }>
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const EMPTY_CONSOLE_SNAPSHOT: ConsoleSnapshot = freeze({ sessions: [], libraryDirty: false, settingsDirty: false, settingsSettled: false, selection: [], canApply: false, notice: 'idle', busy: { refresh: false, library: false, settings: false, preview: false, apply: false } })

export function createConsoleStore(api: NexusApi) {
  let state = EMPTY_CONSOLE_SNAPSHOT
  let disposed = false
  let libraryRevision = 0, settingsRevision = 0, selectionRevision = 0
  let childModelsRequest = 0
  let libraryRequest = 0, settingsRequest = 0, refreshRequest = 0, previewRequest = 0, targetEpoch = 0
  const listeners = new Set<() => void>()
  function publish(patch: Partial<ConsoleSnapshot>) {
    if (disposed) return
    const next = { ...state, ...patch }
    next.libraryDirty = !same(next.libraryDraft, next.librarySaved?.value)
    next.settingsDirty = !same(next.settingsDraft, next.settingsSaved?.value)
    next.canApply = next.targetId !== undefined && next.sessions.some((s) => s.id === next.targetId) && next.librarySaved !== undefined && !next.busy.apply &&
      next.selection.every((id) => {
        const saved = next.librarySaved?.value.modules.find((m) => m.id === id)
        return saved !== undefined && same(saved, next.libraryDraft?.modules.find((m) => m.id === id))
      })
    state = freeze(next)
    for (const listener of listeners) { try { listener() } catch { /* A foreign observer cannot break the state owner. */ } }
  }
  const busy = (key: keyof ConsoleSnapshot['busy'], value: boolean) => publish({ busy: { ...state.busy, [key]: value } })
  const failed = (error: unknown, patch: Partial<ConsoleSnapshot> = {}) => publish({ ...patch, notice: error instanceof NexusApiError && error.status === 409 ? 'conflict' : 'error' })
  function acceptLibrary(value: unknown, revision: number, discard: boolean) {
    const saved = consoleData.library.parse(value)
    const replace = libraryRevision === revision && (discard || !state.libraryDirty)
    if (!replace) { publish({ librarySaved: saved }); return }
    const selection = selectionRevision === 0 ? [...saved.value.defaultSelection] : state.selection.filter((id) => saved.value.modules.some((m) => m.id === id))
    const changed = !same(state.libraryDraft, saved.value) || !same(state.selection, selection)
    if (changed) previewRequest++
    publish({ librarySaved: saved, libraryDraft: saved.value, selection,
      ...(changed ? { preview: undefined, busy: { ...state.busy, preview: false } } : {}),
      ...(discard ? { notice: 'idle' } : {}),
    })
  }
  function acceptSettings(value: unknown, revision: number, discard: boolean) {
    const saved = consoleData.settings.parse(value)
    const replace = settingsRevision === revision && (discard || !state.settingsDirty)
    publish({ settingsSaved: saved, settingsSettled: true, ...(replace ? { settingsDraft: saved.value, ...(discard ? { notice: 'idle' as const } : {}) } : {}) })
  }
  async function readLibrary(discard: boolean) {
    if (disposed || state.busy.library) return
    const request = ++libraryRequest, revision = libraryRevision
    try { const value = await api.library(); if (request === libraryRequest) acceptLibrary(value, revision, discard) } catch (e) { if (request === libraryRequest) failed(e) }
  }
  async function readSettings(discard: boolean) {
    if (disposed || state.busy.settings) return
    const request = ++settingsRequest, revision = settingsRevision
    try { const value = await api.settings(); if (request === settingsRequest) acceptSettings(value, revision, discard) } catch (e) { if (request === settingsRequest) failed(e, { settingsSettled: true }) }
  }
  const store = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async refresh() {
      if (disposed || state.busy.library || state.busy.settings) return
      const request = ++refreshRequest
      busy('refresh', true)
      try {
        try {
          const [caps, sessions] = await Promise.all([api.capabilities(), api.sessions()])
          if (disposed || request !== refreshRequest) return
          const facts = consoleData.capabilities.parse(caps), roster = consoleData.sessions.parse(sessions)
          publish({ capabilities: facts, sessions: roster })
          if (state.targetId !== undefined && !roster.some((s) => s.id === state.targetId)) await store.selectTarget(undefined)
        } catch (e) { if (request === refreshRequest) failed(e) }
        // Both reads run even when the roster stage above failed: they publish
        // the stored mode and, through `settingsSettled`, decide whether anyone
        // may fall back to a default. A partly unavailable console API must not
        // leave that question open for the next publish to answer wrongly.
        await Promise.all([readLibrary(false), readSettings(false)])
      } finally { if (request === refreshRequest) busy('refresh', false) }
    },
    async suggestChildModels(provider: string) {
      const route = provider.trim(), request = ++childModelsRequest
      if (disposed) return
      publish({ childModels: { provider: route, models: [] } })
      if (route === '') return
      try {
        const { models } = await api.childModels(route)
        if (request === childModelsRequest) publish({ childModels: { provider: route, models } })
      } catch { /* Suggestions are optional; never block draft edits or saving. */ }
    },
    reloadLibrary: () => readLibrary(true),
    reloadSettings: () => readSettings(true),
    editLibrary(value: PromptLibrary) {
      if (disposed) return
      try {
        const draft = consoleData.library.parse({ value, hash: 'draft' }).value
        libraryRevision++; previewRequest++
        publish({ libraryDraft: draft, preview: undefined, notice: 'idle', selection: state.selection.filter((id) => draft.modules.some((m) => m.id === id)), busy: { ...state.busy, preview: false } })
      } catch (e) { failed(e) }
    },
    editSettings(value: RuntimeSettings) {
      if (disposed) return
      try { const draft = consoleData.settings.parse({ value, hash: 'draft' }).value; settingsRevision++; publish({ settingsDraft: draft, notice: 'idle' }) } catch (e) { failed(e) }
    },
    setSelection(selection: readonly string[]) {
      if (disposed || new Set(selection).size !== selection.length || !selection.every((id) => state.libraryDraft?.modules.some((m) => m.id === id))) return
      selectionRevision++; previewRequest++
      publish({ selection: [...selection], preview: undefined, notice: 'idle', busy: { ...state.busy, preview: false } })
    },
    useSelectionAsDefault() {
      if (state.libraryDraft !== undefined) store.editLibrary({ ...state.libraryDraft, defaultSelection: [...state.selection] })
    },
    async saveLibrary() {
      if (disposed || state.busy.library || state.libraryDraft === undefined || state.librarySaved === undefined) return
      const draft = state.libraryDraft, hash = state.librarySaved.hash, revision = libraryRevision, request = ++libraryRequest
      busy('library', true)
      try {
        const saved = consoleData.library.parse(await api.saveLibrary(draft, hash))
        if (!same(saved.value, draft)) throw new Error('Invalid save response')
        if (request !== libraryRequest || disposed) return
        publish({ librarySaved: saved, ...(revision === libraryRevision ? { libraryDraft: saved.value } : {}), notice: 'saved' })
      } catch (e) { if (request === libraryRequest) failed(e) }
      finally { if (request === libraryRequest) busy('library', false) }
    },
    async saveSettings() {
      if (disposed || state.busy.settings || state.settingsDraft === undefined || state.settingsSaved === undefined) return
      const draft = state.settingsDraft, hash = state.settingsSaved.hash, revision = settingsRevision, request = ++settingsRequest
      busy('settings', true)
      try {
        const saved = consoleData.settings.parse(await api.saveSettings(draft, hash))
        if (!same(saved.value, draft)) throw new Error('Invalid save response')
        if (request !== settingsRequest || disposed) return
        publish({ settingsSaved: saved, ...(revision === settingsRevision ? { settingsDraft: saved.value } : {}), notice: 'saved' })
      } catch (e) { if (request === settingsRequest) failed(e) }
      finally { if (request === settingsRequest) busy('settings', false) }
    },
    async preview() {
      if (disposed || state.libraryDraft === undefined) return
      const request = ++previewRequest, draft = state.libraryDraft, selection = [...state.selection]
      busy('preview', true)
      try {
        const value = consoleData.preview.parse(await api.preview(draft, selection))
        if (request === previewRequest) publish({ preview: value, notice: 'previewed' })
      } catch (e) { if (request === previewRequest) failed(e) }
      finally { if (request === previewRequest) busy('preview', false) }
    },
    async selectTarget(id: string | undefined) {
      if (disposed) return
      const epoch = ++targetEpoch
      const target = state.sessions.some((s) => s.id === id) ? id : undefined
      publish({ targetId: target, applied: undefined, notice: 'idle', busy: { ...state.busy, apply: false } })
      if (target === undefined) return
      try {
        const value = consoleData.prompt.parse(await api.prompt(target))
        if (value.sessionId !== target) throw new Error('Invalid target response')
        if (epoch === targetEpoch) publish({ applied: value })
      } catch (e) { if (epoch === targetEpoch) failed(e) }
    },
    async applySelection() {
      if (disposed || !state.canApply || state.targetId === undefined || state.librarySaved === undefined) return
      // Applying supersedes a still-pending read of this same target as well.
      const epoch = ++targetEpoch, id = state.targetId, selection = [...state.selection], hash = state.librarySaved.hash
      busy('apply', true)
      try {
        const value = consoleData.prompt.parse(await api.apply(id, selection, hash))
        if (value.sessionId !== id) throw new Error('Invalid target response')
        if (epoch === targetEpoch) publish({ applied: value, notice: 'applied' })
      } catch (e) { if (epoch === targetEpoch) failed(e) }
      finally { if (epoch === targetEpoch) busy('apply', false) }
    },
    dispose() { disposed = true; targetEpoch++; previewRequest++; listeners.clear() },
  }
  return store
}
export type ConsoleStore = ReturnType<typeof createConsoleStore>

const snapshotShape = z.object({
  childModels: z.object({ provider: z.string(), models: z.array(z.string()) }).optional(),
  capabilities: consoleData.capabilities.optional(), sessions: consoleData.sessions,
  librarySaved: consoleData.library.optional(), libraryDraft: consoleData.library.shape.value.optional(),
  settingsSaved: consoleData.settings.optional(), settingsDraft: consoleData.settings.shape.value.optional(),
  libraryDirty: z.boolean(), settingsDirty: z.boolean(), settingsSettled: z.boolean(), selection: z.array(z.string()), targetId: z.string().optional(),
  applied: consoleData.prompt.optional(), preview: consoleData.preview.optional(), canApply: z.boolean(),
  notice: z.enum(['idle', 'saved', 'previewed', 'applied', 'error', 'conflict']),
  busy: z.object({ refresh: z.boolean(), library: z.boolean(), settings: z.boolean(), preview: z.boolean(), apply: z.boolean() }),
})
/** Foreign sources may throw or return a fresh object on every read. Normalize
 * once per changed JSON value so useSyncExternalStore always gets stable identity. */
export function protectConsoleSource(source: Pick<ConsoleStore, 'getSnapshot' | 'subscribe'>) {
  let accepted = EMPTY_CONSOLE_SNAPSHOT, serialized = JSON.stringify(accepted)
  return {
    getSnapshot: (): ConsoleSnapshot => {
      try {
        const value = snapshotShape.parse(source.getSnapshot())
        const next = JSON.stringify(value)
        if (next !== serialized) { accepted = freeze(value); serialized = next }
      } catch { /* Keep the last valid, stable snapshot. */ }
      return accepted
    },
    subscribe(listener: () => void): () => void {
      let off: (() => void) | undefined
      try { const candidate = source.subscribe(listener); if (typeof candidate === 'function') off = candidate } catch { /* Optional foreign subscription unavailable. */ }
      return () => { try { off?.() } catch { /* Unload must remain safe. */ } }
    },
  }
}
