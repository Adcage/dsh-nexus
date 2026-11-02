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
import { clientFixture } from './fixture.ts'
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

interface Mounted {
  readonly ctx: Context
  readonly slots: SlotRegistry
  /** Declare the Tool owner's slots, as the shipped tool package does. */
  declare(): () => void
  /** The live console store, read through the settings seat. */
  store(): ConsoleStore
  /** Locale registration the plugin performed at mount. */
  readonly localeRegister: () => () => void
  /** Count of `tool.call.toolview` registrations the plugin performed so far. */
  toolRegistrations(): number
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

async function mountClient(stored: RuntimeSettings): Promise<Mounted> {
  const fixture = clientFixture()
  fixture.settings = { value: stored, hash: 'stored-settings' }
  const fetch = fixture.fetch
  globalThis.fetch = ((input: string | URL | Request, init: RequestInit = {}) => {
    if (String(input).endsWith('/settings') && init.method === 'PUT') settingsPuts.push(String(init.body))
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
    declare: () => slots.register(
      { name: 'root', children: {
        main: { kind: 'keyed', scope: 'root' },
        'sidebar.panellist': { kind: 'list', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
        [SLOT]: { kind: 'keyed', scope: 'session' },
      } },
      (_props: PropsRenderSlots<'main' | 'sidebar.panellist' | 'settings.section' | typeof SLOT>) => null,
    ),
    store: () => (slots.entries('settings.section')[0]!.inject!() as unknown as { store: ConsoleStore }).store,
    localeRegister,
    toolRegistrations: () => toolRegistrations,
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
