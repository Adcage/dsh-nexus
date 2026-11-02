/**
 * The built browser bundle, loaded the way the web client loads it.
 *
 * A source test never sees the loader banner, and the banner is the difference
 * between a plugin that mounts and `loaded without registering "<id>"`. This
 * spec executes `lib/client.js` behind the fake module loader, materializes it,
 * mounts it, and unloads it twice, so both the registration and its removal are
 * the bundle's own behaviour.
 *
 * @module dsh-nexus/test/bundle/loader
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NS, inject } from '../../src/client/index.tsx'
import { createClientHost, defaultBundlePath, type FakeClientContext } from '../support/browser-loader.ts'

const bundlePath = defaultBundlePath()
const packageName = 'dsh-nexus'

describe('built client bundle', () => {
  it('was built before the suite ran', () => {
    expect(existsSync(bundlePath), `missing ${bundlePath}; run pnpm build`).toBe(true)
  })

  it('registers under the package name — the boot graph row id', () => {
    const host = createClientHost()
    const loaded = host.load()
    expect(loaded.id).toBe(packageName)
    expect(host.loadedClientIds).toEqual([packageName])
  })

  it('exports the face the harness mounts', () => {
    const loaded = createClientHost().load()
    expect(typeof loaded.exports.apply).toBe('function')
    expect(loaded.exports.inject).toEqual(inject)
    expect(loaded.exports.NS).toBe(NS)
  })

  it('registers its dictionaries on mount and removes them on unload, once', () => {
    const host = createClientHost()
    const loaded = host.load()
    expect(loaded.id).toBe(packageName)
    const context = host.mount()
    expect([...host.locales.keys()]).toEqual([NS])
    expect(host.locales.get(NS)).toMatchObject({ en: { panel: 'Nexus' }, zh: { panel: 'Nexus' } })
    expect(context.slots).toBeDefined()

    host.unload()
    const disposeCountAfterUnload = host.disposeCount
    expect(disposeCountAfterUnload).toBe(4)
    expect(host.locales.size).toBe(0)
    expect(host.slotRegistrations).toEqual([])
  })

  it('survives a second start/stop without leaving a registration behind', () => {
    const host = createClientHost()
    host.load()
    host.mount()
    host.unload()
    host.mount()
    expect(host.locales.size).toBe(1)
    host.unload()
    expect(host.locales.size).toBe(0)
    expect(host.disposeCount).toBe(8)
  })

  it('does not mask a registration whose disposer is missing', () => {
    // A host that cleared its own registries during unload would make every
    // "nothing left behind" assertion above vacuous. Mounting a module that
    // registers a dictionary and returns no disposer must leave that dictionary
    // visible, so the cleanup assertions above can fail when they should.
    const host = createClientHost({
      module: {
        id: 'leak-probe',
        exports: {
          inject: ['locale'],
          apply(ctx: FakeClientContext) {
            ctx.locale.register('leaked', { en: { panel: 'Leaked' }, zh: { panel: 'Leaked' } })
          },
        },
      },
    })
    host.load()
    host.mount()
    host.unload()
    expect(host.locales.size).toBe(1)
    expect(host.disposeCount).toBe(0)
  })

  it('materializes using only actual platform seeds, with no Node or SDK registry runtime requests', () => {
    const loaded = createClientHost().load()
    expect(new Set(loaded.runtimeRequests)).toEqual(new Set(['react', 'react/jsx-runtime']))
  })

  it('adds matching sidebar/main/settings cells and removes only its own entries', () => {
    const host = createClientHost()
    host.mount()
    expect(host.slotRegistrations.map((row) => [row.name, row.cell])).toEqual([
      ['main', NS], ['sidebar.panellist', NS], ['settings.section', NS],
    ])
    host.unload()
    expect(host.slotRegistrations).toEqual([])
  })

  it('re-registers the settings cell once when the locale changes', () => {
    const host = createClientHost()
    host.mount()
    const before = host.slotRegistrations.filter((row) => row.name === 'settings.section')
    expect(before).toHaveLength(1)
    host.changeLocale()
    const after = host.slotRegistrations.filter((row) => row.name === 'settings.section')
    expect(after).toHaveLength(1)
    expect(after[0]!.cell).toBe(NS)
    expect(after[0]).not.toBe(before[0])
    host.unload()
    expect(host.slotRegistrations).toEqual([])
  })

  it('does not bundle a second copy of React', () => {
    const source = readFileSync(bundlePath, 'utf8')
    // A bundled React brings its own copy of this internal marker; two Reacts in
    // one page break hooks silently.
    expect(source).not.toContain('__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED')
    for (const specifier of ['react', 'react/jsx-runtime', 'react-dom']) {
      if (source.includes(specifier)) expect(source).toContain(`require("${specifier}")`)
    }
  })
})
