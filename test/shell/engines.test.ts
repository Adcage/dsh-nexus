/**
 * Shell-engine resolution: explicit paths, Git/PowerShell discovery, and the
 * refusal to substitute another engine.
 *
 * @module dsh-nexus/test/shell/engines
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { Config } from '../../src/config.ts'
import type { RuntimeSettings } from '../../src/protocol.ts'
import { NexusError } from '../../src/runtime/errors.ts'
import { resolveEngine, type EngineDiscovery, type ShellExecutionConfig } from '../../src/shell/engines.ts'

/** Project-local cache directory; discovery fixtures never leave the checkout. */
const CACHE_DIR = fileURLToPath(new URL('../../node_modules/.cache/dsh-nexus-shell/', import.meta.url))

/** Roots created by this file, removed once. */
const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** Create one project-local temporary root. */
async function root(prefix: string): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true })
  const directory = await mkdtemp(join(CACHE_DIR, prefix))
  roots.push(directory)
  return directory
}

/** Create an empty file that stands in for an executable. */
async function executable(path: string): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '', 'utf8')
  return path
}

/** Build the configuration pair one resolution takes. */
function shellConfig(terminal: RuntimeSettings['terminal'], deployment: Config = {}): ShellExecutionConfig {
  return { deployment, terminal }
}

/** A discovery environment with only the fields a case names. */
function discovery(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = 'win32'): EngineDiscovery {
  return { env, platform }
}

/** Expect a Nexus `SHELL_UNAVAILABLE` rejection. */
async function expectUnavailable(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(NexusError)
  expect(error).toMatchObject({ code: 'SHELL_UNAVAILABLE' })
}

describe('resolveEngine', () => {
  it('returns the configured terminal path and fixed bash argv before every default', async () => {
    const directory = await root('explicit-')
    const chosen = await executable(join(directory, 'chosen bash.exe'))
    const deployment = await executable(join(directory, 'deployment-bash.exe'))
    const spec = await resolveEngine(
      'bash',
      shellConfig({ engine: 'bash', bashPath: chosen }, { bashPath: deployment }),
    )
    expect(spec).toEqual({
      engine: 'bash',
      executable: chosen,
      args: ['--noprofile', '--norc', '-c'],
      dialect: 'bash',
    })
  })

  it('uses the deployment path when the stored terminal setting names none', async () => {
    const directory = await root('deployment-')
    const deployment = await executable(join(directory, 'deployment-bash.exe'))
    const spec = await resolveEngine('bash', shellConfig({ engine: 'bash' }, { bashPath: deployment }))
    expect(spec.executable).toBe(deployment)
  })

  it('refuses a missing explicit path instead of falling back to discovery', async () => {
    const directory = await root('missing-')
    const deployment = await executable(join(directory, 'deployment-bash.exe'))
    await expectUnavailable(
      resolveEngine(
        'bash',
        shellConfig({ engine: 'bash', bashPath: join(directory, 'missing-bash.exe') }, { bashPath: deployment }),
      ),
    )
  })

  it('rejects a relative explicit path', async () => {
    await expectUnavailable(resolveEngine('bash', shellConfig({ engine: 'bash', bashPath: 'bin/bash.exe' })))
  })

  it('discovers a standard Git for Windows installation under a minimal PATH with no Pi directory', async () => {
    const directory = await root('git-standard-')
    const programFiles = join(directory, 'Program Files')
    const bash = await executable(join(programFiles, 'Git', 'bin', 'bash.exe'))
    const spec = await resolveEngine(
      'bash',
      shellConfig({ engine: 'bash' }),
      discovery({
        ProgramFiles: programFiles,
        ProgramW6432: programFiles,
        PATH: join(directory, 'only-system-bin'),
      }),
    )
    expect(spec.executable).toBe(bash)
    expect(spec.executable).not.toMatch(/[\\/]\.?pi[\\/]/i)
  })

  it('discovers a Git installation through GIT_INSTALL_ROOT metadata', async () => {
    const directory = await root('git-metadata-')
    const installRoot = join(directory, 'GitInstall')
    const bash = await executable(join(installRoot, 'bin', 'bash.exe'))
    const spec = await resolveEngine(
      'bash',
      shellConfig({ engine: 'bash' }),
      discovery({ GIT_INSTALL_ROOT: installRoot, PATH: '' }),
    )
    expect(spec.executable).toBe(bash)
  })

  it('derives the Git installation root from a cmd PATH entry that holds no bash.exe', async () => {
    const directory = await root('git-cmd-')
    const installRoot = join(directory, 'Git')
    const bash = await executable(join(installRoot, 'bin', 'bash.exe'))
    // A default Git for Windows installation puts only `<root>\cmd` on PATH,
    // and that directory carries git.exe without any bash.exe beside it.
    await executable(join(installRoot, 'cmd', 'git.exe'))
    const spec = await resolveEngine(
      'bash',
      shellConfig({ engine: 'bash' }),
      discovery({ PATH: join(installRoot, 'cmd') }),
    )
    expect(spec.executable).toBe(bash)
  })

  it('derives the same installation root from mingw64 and installation-root PATH entries', async () => {
    const directory = await root('git-mingw-')
    const installRoot = join(directory, 'Git')
    const bash = await executable(join(installRoot, 'bin', 'bash.exe'))
    for (const entry of [join(installRoot, 'mingw64', 'bin'), join(installRoot, 'mingw64', 'usr', 'bin'), installRoot]) {
      const spec = await resolveEngine(
        'bash',
        shellConfig({ engine: 'bash' }),
        discovery({ PATH: entry }),
      )
      expect(spec.executable, entry).toBe(bash)
    }
  })

  it('keeps a direct bash.exe in a Git PATH entry ahead of the sibling derivation', async () => {
    const directory = await root('git-direct-')
    const installRoot = join(directory, 'Git')
    const direct = await executable(join(installRoot, 'mingw64', 'bin', 'bash.exe'))
    await executable(join(installRoot, 'bin', 'bash.exe'))
    const spec = await resolveEngine(
      'bash',
      shellConfig({ engine: 'bash' }),
      discovery({ PATH: join(installRoot, 'mingw64', 'bin') }),
    )
    expect(spec.executable).toBe(direct)
  })

  it('still refuses a bash.exe reached through a WSL or WindowsApps PATH entry', async () => {
    const directory = await root('git-wsl-sibling-')
    const systemRoot = join(directory, 'Windows')
    await executable(join(directory, 'wsl', 'Ubuntu', 'usr', 'bin', 'bash.exe'))
    await executable(join(directory, 'wsl', 'Ubuntu', 'bin', 'bash.exe'))
    await expectUnavailable(
      resolveEngine(
        'bash',
        shellConfig({ engine: 'bash' }),
        discovery({ SystemRoot: systemRoot, PATH: '\\\\wsl$\\Ubuntu\\usr\\bin' }),
      ),
    )
  })

  it('never selects WSL or a WindowsApps bash alias as Git Bash', async () => {
    const directory = await root('git-wsl-')
    const systemRoot = join(directory, 'Windows')
    const programFiles = join(directory, 'Program Files')
    await executable(join(systemRoot, 'System32', 'bash.exe'))
    await executable(join(programFiles, 'Microsoft', 'WindowsApps', 'bash.exe'))
    await expectUnavailable(
      resolveEngine(
        'bash',
        shellConfig({ engine: 'bash' }),
        discovery({
          SystemRoot: systemRoot,
          ProgramFiles: programFiles,
          PATH: [join(systemRoot, 'System32'), join(programFiles, 'Microsoft', 'WindowsApps')].join(';'),
        }),
      ),
    )
  })

  it('discovers PowerShell 7 from its standard install location', async () => {
    const directory = await root('pwsh-standard-')
    const programFiles = join(directory, 'Program Files')
    const pwsh = await executable(join(programFiles, 'PowerShell', '7', 'pwsh.exe'))
    const spec = await resolveEngine(
      'pwsh',
      shellConfig({ engine: 'pwsh' }),
      discovery({ ProgramFiles: programFiles, ProgramW6432: programFiles, PATH: '' }),
    )
    expect(spec).toEqual({
      engine: 'pwsh',
      executable: pwsh,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'],
      dialect: 'pwsh',
    })
  })

  it('never discovers Windows PowerShell 5.1 as a PowerShell 7 substitute', async () => {
    const directory = await root('pwsh-legacy-')
    const systemRoot = join(directory, 'Windows')
    await executable(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    await expectUnavailable(
      resolveEngine(
        'pwsh',
        shellConfig({ engine: 'pwsh' }),
        discovery({
          SystemRoot: systemRoot,
          PATH: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
        }),
      ),
    )
  })

  it('finds the host Git Bash from a PATH with the Pi directories removed', async () => {
    if (process.platform !== 'win32') return
    const filteredEntries = (process.env.PATH ?? '')
      .split(';')
      .filter((entry) => entry.length > 0 && !/[\\/]\.?pi([\\/]|$)/i.test(entry))
    const spec = await resolveEngine(
      'bash',
      shellConfig({ engine: 'bash' }),
      discovery({ ...process.env, PATH: filteredEntries.join(';') }),
    )
    expect(existsSync(spec.executable)).toBe(true)
    expect(spec.executable).not.toMatch(/[\\/]System32[\\/]bash\.exe$/i)
    // A Git for Windows installation on PATH as `<root>\cmd` resolves to that
    // same installation's bash, never to a bash from another directory.
    const cmdEntry = filteredEntries.find((entry) => /[\\/]git[\\/]cmd[\\/]?$/i.test(entry))
    if (cmdEntry !== undefined) {
      const installRoot = resolve(cmdEntry, '..')
      expect([join(installRoot, 'bin', 'bash.exe'), join(installRoot, 'usr', 'bin', 'bash.exe')])
        .toContain(spec.executable)
    }
  })
})
