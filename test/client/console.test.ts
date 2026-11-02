import { describe, expect, it } from 'vitest'
import { createConsoleStore } from '../../src/client/store.ts'
import { createNexusApi } from '../../src/client/api.ts'
import { clientFixture, deferred } from './fixture.ts'

describe('ConsoleStore ownership and asynchronous isolation', () => {
  it('loads immutable defaults without silently selecting the first live session', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    expect(store.getSnapshot().libraryDraft).toEqual(f.library.value)
    expect(store.getSnapshot().targetId).toBeUndefined()
    expect(store.getSnapshot()).toBe(store.getSnapshot())
    expect(Object.isFrozen(store.getSnapshot().libraryDraft?.modules)).toBe(true)
    expect(JSON.stringify(store.getSnapshot())).not.toContain('memory-only-token')
  })

  it('preserves drafts on failed save, conflict, refresh and malformed foreign responses', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    store.editLibrary({ ...f.library.value, modules: [{ id: 'one', name: 'Edited', body: 'draft' }] })
    const draft = store.getSnapshot().libraryDraft
    f.reply = () => new Response(JSON.stringify({ error: { code: 'CONFIG_CONFLICT', message: 'changed' } }), { status: 409 })
    await store.saveLibrary()
    expect(store.getSnapshot().libraryDraft).toEqual(draft)
    expect(store.getSnapshot().notice).toBe('conflict')
    f.reply = () => new Response('{"value":null,"hash":"bad"}')
    await store.refresh()
    expect(store.getSnapshot().libraryDraft).toEqual(draft)
    expect(store.getSnapshot().notice).toBe('error')
    f.reply = undefined
    await store.refresh()
    expect(store.getSnapshot().libraryDraft).toEqual(draft)
    await store.reloadLibrary()
    expect(store.getSnapshot().libraryDraft).toEqual(f.library.value)
  })

  it('refuses a valid-shaped but mismatched save answer without erasing the captured draft', async () => {
    const f = clientFixture(), store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    store.editLibrary({ modules: [{ id: 'draft', name: 'Draft', body: 'retain' }], defaultSelection: [] })
    const draft = store.getSnapshot().libraryDraft, saved = store.getSnapshot().librarySaved
    f.reply = (path, method) => path.endsWith('/library') && method === 'PUT' ? Response.json(f.library) : undefined
    await store.saveLibrary()
    expect(store.getSnapshot().libraryDraft).toEqual(draft)
    expect(store.getSnapshot().librarySaved).toEqual(saved)
    expect(store.getSnapshot().notice).toBe('error')
  })

  it('does not erase edits made while an earlier library or settings save is pending', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    store.editLibrary({ ...f.library.value, defaultSelection: [] })
    const pending = deferred<Response>()
    f.reply = (path, method) => path.endsWith('/library') && method === 'PUT' ? pending.promise : undefined
    const saving = store.saveLibrary()
    store.editLibrary({ modules: [{ id: 'later', name: 'Later', body: 'keep me' }], defaultSelection: [] })
    pending.resolve(Response.json({ value: { ...f.library.value, defaultSelection: [] }, hash: 'saved' }))
    await saving
    expect(store.getSnapshot().libraryDraft?.modules[0]?.body).toBe('keep me')
    expect(store.getSnapshot().librarySaved?.hash).toBe('saved')
    expect(store.getSnapshot().libraryDirty).toBe(true)
    const settingsPending = deferred<Response>()
    store.editSettings({ ...f.settings.value, files: { defaultLines: 50, maxOutputBytes: 1000 } })
    f.reply = (path, method) => path.endsWith('/settings') && method === 'PUT' ? settingsPending.promise : undefined
    const savingSettings = store.saveSettings()
    store.editSettings({ ...store.getSnapshot().settingsDraft!, terminal: { engine: 'pwsh' } })
    settingsPending.resolve(Response.json({ value: { ...f.settings.value, files: { defaultLines: 50, maxOutputBytes: 1000 } }, hash: 'saved-settings' }))
    await savingSettings
    expect(store.getSnapshot().settingsDraft?.terminal.engine).toBe('pwsh')
    expect(store.getSnapshot().settingsDraft?.files.defaultLines).toBe(50)
    expect(store.getSnapshot().settingsDirty).toBe(true)
  })

  it('rejects late reads and applies from an old target independently of draft changes', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const slow = deferred<Response>()
    f.reply = (path) => path.includes('/~A/') ? slow.promise : undefined
    const selecting = store.selectTarget('A')
    await store.selectTarget('B')
    slow.resolve(Response.json({ sessionId: 'A', selection: [], modules: [], text: 'A old' }))
    await selecting
    expect(store.getSnapshot().targetId).toBe('B')
    expect(store.getSnapshot().applied?.sessionId).toBe('B')
    const applySlow = deferred<Response>()
    f.reply = (path, method) => path.includes('/~B/') && method === 'POST' ? applySlow.promise : undefined
    const applying = store.applySelection()
    await store.selectTarget('A')
    applySlow.resolve(Response.json({ sessionId: 'B', selection: ['one'], modules: f.library.value.modules, text: 'B captured' }))
    await applying
    expect(store.getSnapshot().targetId).toBe('A')
    expect(store.getSnapshot().applied?.sessionId).toBe('A')
    expect(store.getSnapshot().notice).not.toBe('applied')
    f.sessions = []
    await store.refresh()
    expect(store.getSnapshot().targetId).toBeUndefined()
    expect(store.getSnapshot().applied).toBeUndefined()
  })

  it('applies an independent selection without saving defaults and keeps captured bodies after later library saves', async () => {
    const f = clientFixture(), store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    await store.selectTarget('B')
    store.setSelection([])
    await store.applySelection()
    expect(store.getSnapshot().applied?.selection).toEqual([])
    expect(f.library.value.defaultSelection).toEqual(['one'])
    expect(f.requests.filter((r) => r.method === 'PUT')).toHaveLength(0)
    store.setSelection(['one'])
    await store.applySelection()
    const captured = store.getSnapshot().applied
    store.editLibrary({ ...f.library.value, modules: [{ ...f.library.value.modules[0]!, body: 'later saved body' }] })
    expect(store.getSnapshot().canApply).toBe(false)
    await store.saveLibrary()
    expect(store.getSnapshot().applied).toEqual(captured)
    expect(store.getSnapshot().applied?.text).not.toContain('later saved body')
  })

  it('keeps two windows independent and refuses a stale full-record save without losing either draft', async () => {
    const f = clientFixture()
    const a = createConsoleStore(createNexusApi(f.fetch)), b = createConsoleStore(createNexusApi(f.fetch))
    await Promise.all([a.refresh(), b.refresh()])
    a.editSettings({ ...a.getSnapshot().settingsDraft!, files: { defaultLines: 111, maxOutputBytes: 1000 } })
    b.editSettings({ ...b.getSnapshot().settingsDraft!, terminal: { engine: 'pwsh' } })
    await a.saveSettings()
    await b.saveSettings()
    expect(b.getSnapshot().notice).toBe('conflict')
    expect(b.getSnapshot().settingsDraft?.terminal.engine).toBe('pwsh')
    expect(f.settings.value.files.defaultLines).toBe(111)
    expect(f.settings.value.terminal.engine).toBe('bash')
    await b.refresh()
    expect(b.getSnapshot().settingsDraft?.terminal.engine).toBe('pwsh')
    expect(b.getSnapshot().settingsSaved?.value.files.defaultLines).toBe(111)
  })

  it('invalidates old previews and removes missing selection references when an explicit reload replaces the draft', async () => {
    const f = clientFixture(), store = createConsoleStore(createNexusApi(f.fetch)), preview = deferred<Response>()
    await store.refresh()
    store.setSelection(['one'])
    f.reply = (path) => path.endsWith('/preview') ? preview.promise : undefined
    const previewing = store.preview()
    f.library = { value: { modules: [], defaultSelection: [] }, hash: 'external' }
    await store.reloadLibrary()
    preview.resolve(Response.json({ selection: ['one'], modules: [{ id: 'one', name: 'Old', body: 'old' }], text: 'old draft' }))
    await previewing
    expect(store.getSnapshot().selection).toEqual([])
    expect(store.getSnapshot().preview).toBeUndefined()
    expect(store.getSnapshot().busy.preview).toBe(false)
    expect(store.getSnapshot().notice).toBe('idle')
  })

  it('does not let an earlier read overwrite a later successful apply to the same target', async () => {
    const f = clientFixture(), read = deferred<Response>()
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    f.reply = (path, method) => path.includes('/~A/') && method === 'GET' ? read.promise : undefined
    const selecting = store.selectTarget('A')
    await store.applySelection()
    expect(store.getSnapshot().applied?.selection).toEqual(['one'])
    read.resolve(Response.json({ sessionId: 'A', selection: [], modules: [], text: 'old captured prompt' }))
    await selecting
    expect(store.getSnapshot().applied?.selection).toEqual(['one'])
  })

  it('isolates throwing subscribers and retires pending updates on disposal', async () => {
    const f = clientFixture()
    const store = createConsoleStore(createNexusApi(f.fetch))
    store.subscribe(() => { throw new Error('foreign subscriber') })
    let notifications = 0
    const off = store.subscribe(() => notifications++)
    await store.refresh()
    expect(notifications).toBeGreaterThan(0)
    off()
    const pending = deferred<Response>(), entered = deferred<void>()
    f.reply = (path) => {
      if (!path.endsWith('/settings')) return undefined
      entered.resolve()
      return pending.promise
    }
    const refreshing = store.refresh()
    await entered.promise
    const before = store.getSnapshot()
    store.dispose()
    pending.resolve(Response.json(f.settings))
    await refreshing
    expect(store.getSnapshot()).toBe(before)
  })
})
