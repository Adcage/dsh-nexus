/**
 * The browser side of the harness: a fake `window.__ModuleLoader__` that
 * executes the *built* client bundle, plus the client context the bundle's
 * `apply` receives.
 *
 * Executing the emitted bundle is the point. A source-level test never sees the
 * loader banner, and a banner whose `id` does not equal the package name fails
 * the live page with `loaded without registering "<id>"` and nothing else. The
 * context double reproduces the registration rules the client services enforce —
 * every registration returns its own disposer, an effect body runs once per
 * mount, and a slot cell rejects a second entry at the same priority — so a
 * bundle that leaks or double-registers fails here rather than in the GUI.
 *
 * @module dsh-nexus/test/support/browser-loader
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, URL as NodeURL } from 'node:url'

/** One loader entry, captured from the fake module table. */
export interface LoaderEntry {
  /** Bundle id: the boot graph row id, which must equal the package name. */
  readonly id: string
  /** Deferred module body; it runs when the module system materializes the bundle. */
  readonly factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

/** A materialized client bundle. */
export interface LoadedClientModule {
  /** Captured loader id. */
  readonly id: string
  /** Module exports: `apply`, `inject`, and any ids the bundle publishes. */
  readonly exports: Record<string, unknown>
  /** Actual factory requests, checked against the browser's platform seed table. */
  readonly runtimeRequests?: readonly string[]
}

/** How the fake host is configured. */
export interface ClientHostOptions {
  /** Bundle to execute; defaults to the package's built `lib/client.js`. */
  readonly bundlePath?: string
  /**
   * Slot ids the fake declarations expose. A registration into any other slot
   * throws, mirroring the real `slots.inject` contract.
   */
  readonly declaredSlots?: readonly string[]
  /**
   * A materialized module to mount instead of executing a bundle. The host must
   * stay able to mount a module that leaks a registration: that is how a test
   * proves its unload assertions can fail, rather than being satisfied by the
   * host clearing state itself.
   */
  readonly module?: LoadedClientModule
}

/** One slot registration the client bundle made. */
export interface SlotRegistration {
  /** Slot id. */
  readonly name: string
  /** Cell key within the slot: the entry's `key` for keyed slots, its `id` otherwise. */
  readonly cell: string
  /** Lower renders first within a cell. */
  readonly priority: number
  /** Registration order within a list cell. */
  readonly order: number
}

/** A client plugin context plus the ability to mount and unload it. */
export interface ClientHost {
  /** Ids the fake loader saw, in load order. */
  readonly loadedClientIds: string[]
  /** Dictionaries per locale namespace, while mounted. */
  readonly locales: ReadonlyMap<string, { readonly en: Record<string, string>; readonly zh: Record<string, string> }>
  /** Live slot registrations, while mounted. */
  readonly slotRegistrations: readonly SlotRegistration[]
  /** How many registration disposers have run in total. */
  readonly disposeCount: number
  /** Fire every current locale subscriber once, as the locale service does after a switch. */
  changeLocale(): void
  /**
   * Execute the bundle and materialize its exports.
   * @returns the captured loader id and the module exports.
   */
  load(): LoadedClientModule
  /**
   * Run the materialized bundle's `apply` on a fresh client context.
   * @returns the context the bundle received.
   */
  mount(): FakeClientContext
  /**
   * Let the mounted bundle's first asynchronous read settle.
   *
   * Tool-card registration waits until the stored display mode is known. No host
   * answers here, so that read fails and the documented `nexus` fallback is what
   * registers the cards; this lets those promise chains run before a count.
   */
  settle(): Promise<void>
  /** Run every registration's disposer once, in reverse registration order. */
  unload(): void
}

/** The client context handed to a bundle's `apply`. */
export interface FakeClientContext {
  /**
   * Run one registration body and keep its disposer for `unload`.
   * @param callback - registration body returning its disposer.
   * @param label - effect label, mirrored from the real service.
   */
  effect(callback: () => (() => void) | void, label?: string): void
  /** Locale service face the bundle uses. */
  readonly locale: {
    register(
      namespace: string,
      dictionaries: { en: Record<string, string>; zh: Record<string, string> },
    ): () => void
    bind(namespace: string): (key: string) => string
    subscribe(listener: () => void): () => void
  }
  /** Slot service face the bundle uses. */
  readonly slots: {
    inject(slot: string, callback: () => () => void): () => void
    register(registration: { name: string; id?: string; key?: string; priority?: number; order?: number }, component?: unknown): () => void
  }
}

/**
 * Read the default client bundle path: `<package>/lib/client.js`.
 * @returns the absolute bundle path.
 */
export function defaultBundlePath(): string {
  return fileURLToPath(new NodeURL('../../lib/client.js', import.meta.url))
}

/**
 * Create a fake browser host for the built client bundle.
 * @param options - bundle path, declared slots, or an explicit module to mount.
 * @returns the loader and context double.
 */
export function createClientHost(options: ClientHostOptions = {}): ClientHost {
  const bundlePath = options.bundlePath ?? defaultBundlePath()
  const declaredSlots = new Set(options.declaredSlots ?? ['main', 'sidebar.panellist', 'settings.section', 'tool.call.toolview'])
  const loadedClientIds: string[] = []
  const locales = new Map<string, { en: Record<string, string>; zh: Record<string, string> }>()
  const registrations: SlotRegistration[] = []
  const localeListeners: Array<() => void> = []
  const disposers: Array<() => void> = []
  let disposeCount = 0
  let module: LoadedClientModule | undefined = options.module

  const host: ClientHost = {
    loadedClientIds,
    locales,
    get slotRegistrations() {
      return [...registrations]
    },
    get disposeCount() {
      return disposeCount
    },
    changeLocale() {
      for (const listener of [...localeListeners]) listener()
    },
    load() {
      const loaded = options.module ?? executeBundle(bundlePath)
      module = loaded
      loadedClientIds.push(loaded.id)
      return loaded
    },
    mount() {
      const loaded = module ?? host.load()
      const context = createClientContext({
        declaredSlots,
        locales,
        registrations,
        localeListeners,
        registerDisposer: (dispose) => disposers.push(dispose),
        countDisposal: () => {
          disposeCount += 1
        },
      })
      const apply = loaded.exports.apply
      if (typeof apply !== 'function') throw new Error(`bundle ${loaded.id} exports no apply function`)
      ;(apply as (ctx: FakeClientContext) => void)(context)
      return context
    },
    async settle() {
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    },
    unload() {
      // Only the registrations' own disposers may empty these registries. The
      // host clearing them here would make every "nothing left behind" assertion
      // in a caller's spec pass whether or not the bundle cleaned up.
      for (const dispose of [...disposers].reverse()) dispose()
      disposers.length = 0
    },
  }
  return host
}

/**
 * Execute the built bundle behind a fake module loader.
 * @param bundlePath - absolute path to `lib/client.js`.
 * @returns the captured loader id and materialized exports.
 */
function executeBundle(bundlePath: string): LoadedClientModule {
  let entry: LoaderEntry | undefined
  const globals = globalThis as { window?: unknown }
  const previous = globals.window
  globals.window = {
    __ModuleLoader__: {
      load: (candidate: LoaderEntry) => {
        entry = candidate
      },
    },
  }
  try {
    // Executing the emitted bundle is the point of this support module.
    new Function(readFileSync(bundlePath, 'utf8'))()
    if (entry === undefined) throw new Error(`bundle ${bundlePath} never called window.__ModuleLoader__.load`)
    const captured = entry as LoaderEntry
    const requireFromBundle = createRequire(bundlePath)
    const runtimeRequests: string[] = []
    const exports = captured.factory((specifier) => {
      runtimeRequests.push(specifier)
      if (!['react', 'react/jsx-runtime', 'react-dom'].includes(specifier)) throw new Error(`not a browser platform seed: ${specifier}`)
      return requireFromBundle(specifier)
    })
    return { id: captured.id, exports, runtimeRequests }
  } finally {
    if (previous === undefined) delete globals.window
    else globals.window = previous
  }
}

/** Build the client context one mount hands to `apply`. */
function createClientContext(state: {
  declaredSlots: Set<string>
  locales: Map<string, { en: Record<string, string>; zh: Record<string, string> }>
  registrations: SlotRegistration[]
  localeListeners: Array<() => void>
  registerDisposer: (dispose: () => void) => void
  countDisposal: () => void
}): FakeClientContext {
  return {
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') state.registerDisposer(dispose)
    },
    locale: {
      register(namespace, dictionaries) {
        state.locales.set(namespace, dictionaries)
        return () => {
          if (state.locales.get(namespace) === dictionaries) {
            state.locales.delete(namespace)
            state.countDisposal()
          }
        }
      },
      bind(namespace) {
        return (key: string) => state.locales.get(namespace)?.en[key] ?? key
      },
      subscribe(listener) {
        state.localeListeners.push(listener)
        return () => {
          const index = state.localeListeners.indexOf(listener)
          if (index !== -1) state.localeListeners.splice(index, 1)
        }
      },
    },
    slots: {
      inject(slot, callback) {
        if (!state.declaredSlots.has(slot)) throw new Error(`slot "${slot}" is not declared`)
        const dispose = callback()
        state.registerDisposer(dispose)
        return dispose
      },
      register(registration) {
        const cell = registration.key ?? registration.id ?? ''
        const priority = registration.priority ?? 0
        const duplicate = state.registrations.some(
          (existing) => existing.name === registration.name && existing.cell === cell && existing.priority === priority,
        )
        if (duplicate) {
          throw new Error(`slot "${registration.name}" already has a "${cell}" entry at priority ${priority}`)
        }
        const entry: SlotRegistration = {
          name: registration.name,
          cell,
          priority,
          order: registration.order ?? 0,
        }
        state.registrations.push(entry)
        return () => {
          const index = state.registrations.indexOf(entry)
          if (index !== -1) {
            state.registrations.splice(index, 1)
            state.countDisposal()
          }
        }
      },
    },
  }
}
