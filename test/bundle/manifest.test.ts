/**
 * Package identity and the dual-half manifest.
 *
 * These assertions cover what the harness and the plugin inventory read before
 * any code runs: the package name, the two entry points, the bundle patch, the
 * browser-half declaration, and the runtime version the package was built for.
 * A mismatch here fails at install or load time — a plugin that composes nothing
 * looks exactly like a plugin with no rows.
 *
 * @module dsh-nexus/test/bundle/manifest
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

interface Manifest {
  readonly name: string
  readonly version: string
  readonly type: string
  readonly main: string
  readonly types: string
  readonly exports: Record<string, string | Record<string, string>>
  readonly files: readonly string[]
  readonly engines: Record<string, string>
  readonly dsh: {
    readonly manifestVersion: number
    readonly bundle: { readonly patch: string }
    readonly client: { readonly platform: string; readonly inject: readonly string[] }
  }
}

/**
 * @param path - package-relative file.
 * @returns the file's text.
 */
function read(path: string): string {
  return readFileSync(`${packageRoot}${path}`, 'utf8')
}

const manifest = JSON.parse(read('package.json')) as Manifest

describe('dsh-nexus package identity', () => {
  it('is a dual-half bundle named dsh-nexus', () => {
    expect(manifest.name).toBe('dsh-nexus')
    expect(manifest.type).toBe('module')
    expect(manifest.exports['.']).toBeDefined()
    expect(manifest.exports['./client']).toBe('./lib/client.js')
    expect(manifest.exports['./preset']).toBeDefined()
    expect(manifest.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    expect(manifest.exports['./package.json']).toBe('./package.json')
  })

  it('declares the bundle patch and a web browser half', () => {
    expect(manifest.dsh.manifestVersion).toBe(1)
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(existsSync(`${packageRoot}cordis.patch.yml`)).toBe(true)
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.client.inject).toEqual(['@deepseek-ai/dsh-client-locale'])
  })

  it('pins the runtime the package was built for', () => {
    expect(manifest.engines.dsh).toBe('0.2.1-rc.2')
    expect(manifest.engines.node).toBe('>=22.17.0')
  })

  it('ships both halves and the patch in the tarball whitelist', () => {
    expect(manifest.files).toContain('lib')
    expect(manifest.files).toContain('cordis.patch.yml')
  })

  it('targets an un-bundled host main with published types', () => {
    expect(manifest.main).toBe('lib/index.js')
    expect(manifest.types).toBe('lib/index.d.ts')
    const root = manifest.exports['.']
    expect(root).toEqual({ types: './lib/index.d.ts', default: './lib/index.js' })
  })
})

describe('cordis.patch.yml row identity', () => {
  const patch = read('cordis.patch.yml')

  it('inserts exactly one top-level row named after the package', () => {
    const rows = [...patch.matchAll(/^\s*-?\s*id:\s*(\S+)\s*$/gm)].map((match) => match[1])
    expect(rows).toEqual(['dsh-nexus'])
    const names = [...patch.matchAll(/^\s*name:\s*'?([^'\n]+)'?\s*$/gm)].map((match) => match[1])
    expect(names).toEqual(['dsh-nexus'])
  })
})
