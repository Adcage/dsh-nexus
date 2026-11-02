// @vitest-environment jsdom
/**
 * The tool-display switch, driven through the real client seam: the shipped
 * `apply` mounts into a real rd.2 SlotRegistry, the live console store is read
 * through the settings seat it exposes, and every assertion reads the cells the
 * registry actually holds.
 *
 * The three modes are a preference over one saved settings field, so this spec
 * covers the whole path: the field normalises on read, the registration follows
 * the live draft without a reload, the cell yields at `auto`, disappears at
 * `native`, and the console control only writes the draft until Save is pressed.
 *
 * @module dsh-nexus/test/client/tool-display
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNexusApi } from '../../src/client/api.ts'
import { apply } from '../../src/client/index.tsx'
import { createConsoleStore, type ConsoleStore } from '../../src/client/store.ts'
import { DEFAULT_SETTINGS } from '../../src/runtime/defaults.ts'
import type { RuntimeSettings } from '../../src/protocol.ts'
import en from '../../src/locale/en.json' with { type: 'json' }
import { clientFixture, deferred } from './fixture.ts'
import { button, input, mountConsole } from './render.ts'

const require = createRequire(import.meta.url)
/** Wire names this plugin owns; every other name must keep its own view. */
const NEXUS_KEYS = ['shell', 'web', 'agent'] as const
const SLOT = 'tool.call.toolview'

/** Native SlotRegistry, materialized from the shipped renderer bundle. */
function nativeRegistry(ctx: Context): SlotRegistry {
  let captured: LoaderEntry | undefined
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: { load: (entry: LoaderEntry) => { captured = entry } } })
  try {
    const path = require.resolve('@deepseek-ai/dsh-client-ui-renderer/client')
    new Function(readFileSync(path, 'utf8'))()
    const exports = captured!.factory(require)
    const Registry = exports.SlotRegistry as new (ctx: Context) => SlotRegistry
    return new Registry(ctx)
  } finally {
    if (previous) Object.defineProperty(window, '__ModuleLoader__', previous)
    else Reflect.deleteProperty(window, '__ModuleLoader__')
  }
}

/** A third-party view that claims one wire name at the default priority. */
function ThirdPartyView() {
  return null
}

interface MountOptions {
  /** Wire names a third-party view claims at the default priority before the plugin mounts. */
  readonly foreignKeys?: readonly string[]
  /** Reject the stored-settings read with a server error instead of answering. */
  readonly failSettings?: boolean
  /** Reject the prompt-library read, which shares the store's `error` notice with the settings read. */
  readonly failLibrary?: boolean
  /** Hold the stored-settings read until {@link Mounted.releaseSettings} runs. */
  readonly holdSettings?: boolean
  /** Declare the Tool owner's slot before the plugin mounts, as a real host does. */
  readonly preDeclare?: boolean
  /**
   * Throw from `ctx.slots.inject` this many times before delegating to the
   * registry; `Number.POSITIVE_INFINITY` refuses every attempt.
   */
  readonly injectFailures?: number
}

interface Mounted {
  readonly ctx: Context
  readonly slots: SlotRegistry
  /** Declare the Tool owner's slots, as the shipped tool package does. */
  declare(): () => void
  /** Open a held stored-settings read; a no-op when the read was not held. */
  releaseSettings(): void
  /** The live console store, read through the settings seat. */
  store(): ConsoleStore
  /** Locale registration the plugin performed at mount. */
  readonly localeRegister: () => () => void
  /** Count of `tool.call.toolview` registrations the plugin performed so far. */
  toolRegistrations(): number
  /** Count of `ctx.slots.inject` attempts the plugin made for `tool.call.toolview`. */
  toolInjectAttempts(): number
  /** Unload this plugin's client half and nothing else. */
  unload(): Promise<void>
  /** Unload the plugin and dispose the context; safe to call more than once. */
  readonly close: () => Promise<void>
}

interface LoaderEntry {
  readonly id: string
  readonly factory: (require: NodeRequire) => Record<string, unknown>
}

const mounted: Mounted[] = []
const settingsPuts: string[] = []
afterEach(async () => {
  for (const view of mounted.splice(0)) await view.close()
  vi.restoreAllMocks()
  settingsPuts.length = 0
})

/** Stored settings carrying one display mode; the field stays required after the change. */
function settingsWith(mode: string | undefined): RuntimeSettings {
  const value: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  if (mode === undefined) delete value.toolDisplay
  else value.toolDisplay = mode
  return value as unknown as RuntimeSettings
}

async function mountClient(stored: RuntimeSettings, options: MountOptions = {}): Promise<Mounted> {
  const fixture = clientFixture()
  fixture.settings = { value: stored, hash: 'stored-settings' }
  const fetch = fixture.fetch
  const settingsGate = deferred<void>()
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input), method = init.method ?? 'GET'
    if (path.endsWith('/settings') && method === 'PUT') settingsPuts.push(String(init.body))
    if (path.endsWith('/settings') && method === 'GET') {
      if (options.holdSettings === true) await settingsGate.promise
      if (options.failSettings === true) return Response.json({ error: { code: 'SETTINGS_UNAVAILABLE', message: 'unavailable' } }, { status: 500 })
    }
    if (path.endsWith('/library') && method === 'GET' && options.failLibrary === true) {
      return Response.json({ error: { code: 'LIBRARY_UNAVAILABLE', message: 'unavailable' } }, { status: 500 })
    }
    return fetch(input, init)
  }) as typeof globalThis.fetch
  const ctx = new Context()
  const slots = nativeRegistry(ctx)
  const originalRegister = slots.register.bind(slots)
  let toolRegistrations = 0
  Object.defineProperty(slots, 'register', {
    configurable: true,
    value: (options: Parameters<typeof originalRegister>[0], component: Parameters<typeof originalRegister>[1]) => {
      if ((options as { name?: string }).name === SLOT) toolRegistrations += 1
      return originalRegister(options, component)
    },
  })
  const originalInject = slots.inject.bind(slots)
  let injectRemaining = options.injectFailures ?? 0
  let toolInjectAttempts = 0
  Object.defineProperty(slots, 'inject', {
    configurable: true,
    value: (name: Parameters<typeof originalInject>[0], factory: Parameters<typeof originalInject>[1]) => {
      if (name === SLOT) {
        toolInjectAttempts += 1
        if (injectRemaining > 0) { injectRemaining -= 1; throw new Error('slot not ready') }
      }
      return originalInject(name, factory)
    },
  })
  const declare = () => slots.register(
    { name: 'root', children: {
      main: { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      [SLOT]: { kind: 'keyed', scope: 'session' },
    } },
    (_props: PropsRenderSlots<'main' | 'sidebar.panellist' | 'settings.section' | typeof SLOT>) => null,
  )
  // A coexistence case the feature exists for: the other plugin got there first.
  if (options.preDeclare === true || (options.foreignKeys?.length ?? 0) > 0) {
    declare()
    for (const key of options.foreignKeys ?? []) slots.register({ name: SLOT, key, priority: 0 }, ThirdPartyView)
  }
  const localeListeners: (() => void)[] = []
  const localeRegister = vi.fn(() => () => {})
  ctx.provide('locale', {
    register: localeRegister,
    bind: () => (key: keyof typeof en) => en[key],
    subscribe: (listener: () => void) => { localeListeners.push(listener); return () => { localeListeners.splice(localeListeners.indexOf(listener), 1) } },
  })
  const fork = ctx.plugin({ name: 'dsh-nexus-client', inject: ['slots', 'locale'], apply })
  await Promise.resolve()
  let closed = false
  const view: Mounted = {
    ctx,
    slots,
    declare,
    releaseSettings: () => settingsGate.resolve(),
    store: () => (slots.entries('settings.section')[0]!.inject!() as unknown as { store: ConsoleStore }).store,
    localeRegister,
    toolRegistrations: () => toolRegistrations,
    toolInjectAttempts: () => toolInjectAttempts,
    unload: async () => { if (!closed) { closed = true; await fork.dispose() } },
    close: async () => { if (!closed) { closed = true; await fork.dispose() } await ctx.fiber.dispose() },
  }
  mounted.push(view)
  return view
}

/** Wait until the asynchronous settings read has reached the live draft. */
async function settingsLoaded(store: ConsoleStore): Promise<void> {
  await vi.waitFor(() => { expect(store.getSnapshot().settingsDraft).toBeDefined() }, { timeout: 2_000 })
}

/** Wait until the mount's first refresh has finished, so no publish is still queued. */
async function refreshSettled(store: ConsoleStore): Promise<void> {
  await vi.waitFor(() => { expect(store.getSnapshot().busy.refresh).toBe(false) }, { timeout: 2_000 })
}

/** Priority the registry holds for each Nexus wire name, or undefined when absent. */
function priorities(slots: SlotRegistry): Record<string, number | undefined> {
  const rows = slots.entries(SLOT)
  return Object.fromEntries(NEXUS_KEYS.map((key) => {
    const row = rows.find((entry) => (entry.options as { key?: string }).key === key)
    return [key, (row?.options as { priority?: number } | undefined)?.priority]
  }))
}

/** Every Nexus wire name is occupied exactly once. */
function expectSingleCells(slots: SlotRegistry): void {
  const keys = slots.entries(SLOT).map((entry) => (entry.options as { key?: string }).key)
  expect(keys).toEqual([...NEXUS_KEYS])
}

describe('tool display mode registration', () => {
  it('registers one cell per Nexus wire name at priority 0 in the default mode', async () => {
    const client = await mountClient(settingsWith(undefined))
    client.declare()
    const store = client.store()
    await settingsLoaded(store)
    expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('nexus')
    expectSingleCells(client.slots)
    expect(priorities(client.slots)).toEqual({ shell: 0, web: 0, agent: 0 })
  })

  it('registers at priority 10 in auto mode so a third-party entry at 0 wins the same cell', async () => {
    const client = await mountClient(settingsWith('auto'))
    client.declare()
    const store = client.store()
    await settingsLoaded(store)
    expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('auto')
    expect(priorities(client.slots)).toEqual({ shell: 10, web: 10, agent: 10 })
    client.slots.register({ name: SLOT, key: 'shell', priority: 0 }, ThirdPartyView)
    const winners = client.slots.entriesOfSlot(SLOT)
    const shell = winners.find((entry) => (entry.options as { key?: string }).key === 'shell')
    const web = winners.find((entry) => (entry.options as { key?: string }).key === 'web')
    expect(shell?.component).toBe(ThirdPartyView)
    expect(web?.component).not.toBe(ThirdPartyView)
    expect((web?.options as { priority?: number }).priority).toBe(10)
  })

  it('registers no Nexus cell in native mode while the console seats and locale stay intact', async () => {
    const client = await mountClient(settingsWith('native'))
    client.declare()
    const store = client.store()
    await settingsLoaded(store)
    expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('native')
    expect(client.slots.entries(SLOT)).toEqual([])
    expect(client.slots.entries('main').map((entry) => (entry.options as { key?: string }).key)).toEqual(['dshNexus'])
    expect(client.slots.entries('settings.section')).toHaveLength(1)
    expect(client.slots.entries('sidebar.panellist')).toHaveLength(1)
    expect(client.localeRegister).toHaveBeenCalled()
  })

  it('switches at runtime by disposing and re-registering once, and is idempotent for an unchanged value', async () => {
    const client = await mountClient(settingsWith('nexus'))
    client.declare()
    const store = client.store()
    await settingsLoaded(store)
    const toolRegistrations = () => client.toolRegistrations()
    const baseline = toolRegistrations()
    const draft = () => store.getSnapshot().settingsDraft!
    expect(priorities(client.slots)).toEqual({ shell: 0, web: 0, agent: 0 })

    store.editSettings({ ...draft(), toolDisplay: 'auto' })
    expect(priorities(client.slots)).toEqual({ shell: 10, web: 10, agent: 10 })
    expectSingleCells(client.slots)
    expect(toolRegistrations()).toBe(baseline + 3)

    // Re-publishing an unchanged value must not touch the cells: the store
    // creates a fresh draft object even when only another field is edited.
    const stable = client.slots.entries(SLOT)
    store.editSettings({ ...draft(), files: { ...draft().files, defaultLines: 321 } })
    expect(client.slots.entries(SLOT)).toEqual(stable)
    expect(toolRegistrations()).toBe(baseline + 3)

    store.editSettings({ ...draft(), toolDisplay: 'native' })
    expect(client.slots.entries(SLOT)).toEqual([])
    expect(toolRegistrations()).toBe(baseline + 3)

    store.editSettings({ ...draft(), toolDisplay: 'native' })
    expect(client.slots.entries(SLOT)).toEqual([])
    expect(toolRegistrations()).toBe(baseline + 3)

    store.editSettings({ ...draft(), toolDisplay: 'nexus' })
    expect(priorities(client.slots)).toEqual({ shell: 0, web: 0, agent: 0 })
    expectSingleCells(client.slots)
    expect(toolRegistrations()).toBe(baseline + 6)
  })

  it('loads legacy settings without the field as nexus and never registers an unknown stored string', async () => {
    const legacy = await mountClient(settingsWith(undefined))
    legacy.declare()
    const legacyStore = legacy.store()
    await settingsLoaded(legacyStore)
    expect(legacyStore.getSnapshot().settingsDraft?.toolDisplay).toBe('nexus')
    expect(priorities(legacy.slots)).toEqual({ shell: 0, web: 0, agent: 0 })
    await legacy.close()

    const invalid = await mountClient(settingsWith('bogus'))
    invalid.declare()
    const invalidStore = invalid.store()
    await settingsLoaded(invalidStore)
    expect(invalidStore.getSnapshot().settingsDraft?.toolDisplay).toBe('nexus')
    expect(priorities(invalid.slots)).toEqual({ shell: 0, web: 0, agent: 0 })
  })
})

describe('tool display boot order and recovery', () => {
  /** Wire names of the live cells, in registration order. */
  const keys = (slots: SlotRegistry) => slots.entries(SLOT).map((entry) => (entry.options as { key?: string }).key)

  it('waits for a stored auto read, then yields the third-party rank-0 cell instead of claiming it', async () => {
    const client = await mountClient(settingsWith('auto'), { foreignKeys: ['shell'], holdSettings: true })
    // The stored mode is not known yet, so nothing may occupy the default rank.
    expect(keys(client.slots)).toEqual(['shell'])
    client.releaseSettings()
    const store = client.store()
    await settingsLoaded(store)
    expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('auto')
    const ranks = (key: string) => client.slots.entries(SLOT)
      .filter((entry) => (entry.options as { key?: string }).key === key)
      .map((entry) => (entry.options as { priority?: number }).priority)
      .sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(ranks('shell')).toEqual([0, 10])
    expect(ranks('web')).toEqual([10])
    expect(ranks('agent')).toEqual([10])
    const shell = client.slots.entriesOfSlot(SLOT).find((entry) => (entry.options as { key?: string }).key === 'shell')
    expect(shell?.component).toBe(ThirdPartyView)
  })

  it('waits for a stored native read and then registers no cell at all', async () => {
    const client = await mountClient(settingsWith('native'), { foreignKeys: ['web'], holdSettings: true })
    expect(keys(client.slots)).toEqual(['web'])
    client.releaseSettings()
    const store = client.store()
    await settingsLoaded(store)
    expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('native')
    expect(keys(client.slots)).toEqual(['web'])
  })

  it('falls back to nexus rank when the first settings read fails, with the existing error notice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const client = await mountClient(settingsWith('auto'), { failSettings: true, holdSettings: true, preDeclare: true })
      expect(keys(client.slots)).toEqual([])
      client.releaseSettings()
      const store = client.store()
      await vi.waitFor(() => { expect(store.getSnapshot().notice).toBe('error') }, { timeout: 2_000 })
      expect(store.getSnapshot().settingsDraft).toBeUndefined()
      expect(priorities(client.slots)).toEqual({ shell: 0, web: 0, agent: 0 })
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps the default rank free when a failing library read precedes the stored mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // The library read shares the store-wide `error` notice with the settings
      // read, but it says nothing about the stored display mode: only the
      // settings read settling may decide the rank.
      const client = await mountClient(settingsWith('auto'), { foreignKeys: ['shell'], holdSettings: true, failLibrary: true })
      const store = client.store()
      await vi.waitFor(() => { expect(store.getSnapshot().notice).toBe('error') }, { timeout: 2_000 })
      expect(store.getSnapshot().settingsDraft).toBeUndefined()
      expect(keys(client.slots)).toEqual(['shell'])
      client.releaseSettings()
      await settingsLoaded(store)
      await refreshSettled(store)
      expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('auto')
      const ranks = (key: string) => client.slots.entries(SLOT)
        .filter((entry) => (entry.options as { key?: string }).key === key)
        .map((entry) => (entry.options as { priority?: number }).priority)
        .sort((a, b) => (a ?? 0) - (b ?? 0))
      expect(ranks('shell')).toEqual([0, 10])
      expect(ranks('web')).toEqual([10])
      expect(ranks('agent')).toEqual([10])
    } finally {
      warn.mockRestore()
    }
  })

  it('warns once per mode while a refused tool slot keeps retrying', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const client = await mountClient(settingsWith('nexus'), { injectFailures: Number.POSITIVE_INFINITY })
      client.declare()
      const store = client.store()
      await settingsLoaded(store)
      await refreshSettled(store)
      const slotWarnings = () => warn.mock.calls.filter(([message]) => String(message).includes('native tool card slot')).length
      expect(slotWarnings()).toBe(1)
      const attempts = client.toolInjectAttempts()
      const draft = store.getSnapshot().settingsDraft!
      store.editSettings({ ...draft, files: { ...draft.files, defaultLines: 321 } })
      store.editSettings({ ...draft, files: { ...draft.files, defaultLines: 322 } })
      // Every publish still retries the slot; only the warning is latched.
      expect(client.toolInjectAttempts()).toBe(attempts + 2)
      expect(keys(client.slots)).toEqual([])
      expect(slotWarnings()).toBe(1)
      // A new mode is a new attempt, so the latch must not silence it forever.
      store.editSettings({ ...draft, toolDisplay: 'auto' })
      expect(client.toolInjectAttempts()).toBe(attempts + 3)
      expect(slotWarnings()).toBe(2)
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps the other two keys when a rank-0 third party registered before the plugin in nexus mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const client = await mountClient(settingsWith('nexus'), { foreignKeys: ['shell'] })
      const store = client.store()
      await settingsLoaded(store)
      expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('nexus')
      const rows = client.slots.entries(SLOT)
      const cells = (key: string) => rows.filter((entry) => (entry.options as { key?: string }).key === key)
      // The foreign cell keeps the key; the per-key refusal must not cost the other two.
      expect(keys(client.slots)).toEqual(['shell', 'web', 'agent'])
      expect(cells('shell')).toHaveLength(1)
      expect(client.slots.entriesOfSlot(SLOT).find((entry) => (entry.options as { key?: string }).key === 'shell')?.component).toBe(ThirdPartyView)
      expect(cells('web')).toHaveLength(1)
      expect(cells('agent')).toHaveLength(1)
      expect((cells('web')[0]!.options as { priority?: number }).priority).toBe(0)
      expect((cells('agent')[0]!.options as { priority?: number }).priority).toBe(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('removes its three cells when the plugin unloads', async () => {
    const client = await mountClient(settingsWith('nexus'))
    client.declare()
    await settingsLoaded(client.store())
    expectSingleCells(client.slots)
    await client.unload()
    expect(client.slots.entries(SLOT)).toEqual([])
  })

  it('retries a refused inject on the next publish and ends with the cells registered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const client = await mountClient(settingsWith('nexus'), { injectFailures: 1 })
      client.declare()
      const store = client.store()
      await settingsLoaded(store)
      // The refused attempt must not be remembered as applied: the publishes that
      // follow it retry, so the cards end up registered without a reload.
      expect(keys(client.slots)).toEqual(['shell', 'web', 'agent'])
      const draft = store.getSnapshot().settingsDraft!
      store.editSettings({ ...draft, files: { ...draft.files, defaultLines: 321 } })
      expect(priorities(client.slots)).toEqual({ shell: 0, web: 0, agent: 0 })
    } finally {
      warn.mockRestore()
    }
  })
})

describe('tool display control', () => {
  it('writes the shared draft on change and saves through the existing action, not silently', async () => {
    const fixture = clientFixture()
    const store = createConsoleStore(createNexusApi(fixture.fetch))
    await store.refresh()
    const view = await mountConsole(store)
    try {
      await button(view.node, en.tools).clickAsync()
      expect(view.node.textContent).toContain(en.toolDisplayHelp)
      await input(view.node, en.toolDisplay, 'native')
      expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('native')
      expect(view.node.textContent).toContain(en.toolDisplayNativeHelp)
      expect(fixture.requests.filter((request) => request.method === 'PUT')).toEqual([])
      expect(store.getSnapshot().settingsDirty).toBe(true)
      await button(view.node, en.saveSettings).clickAsync()
      expect(fixture.settings.value.toolDisplay).toBe('native')
      expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('native')
      expect(store.getSnapshot().settingsDirty).toBe(false)
    } finally {
      view.dispose()
    }
  })

  it('keeps the draft and the existing conflict notice when the save is refused', async () => {
    const fixture = clientFixture()
    const store = createConsoleStore(createNexusApi(fixture.fetch))
    await store.refresh()
    const view = await mountConsole(store)
    try {
      await button(view.node, en.tools).clickAsync()
      await input(view.node, en.toolDisplay, 'auto')
      fixture.reply = (path, method) => path.endsWith('/settings') && method === 'PUT'
        ? Response.json({ error: { code: 'CONFIG_CONFLICT', message: 'changed' } }, { status: 409 })
        : undefined
      await button(view.node, en.saveSettings).clickAsync()
      expect(view.node.textContent).toContain(en.conflict)
      expect(store.getSnapshot().settingsDraft?.toolDisplay).toBe('auto')
      expect(store.getSnapshot().busy.settings).toBe(false)
    } finally {
      view.dispose()
    }
  })
})
