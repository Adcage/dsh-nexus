/**
 * Shell-engine and working-directory resolution for the Nexus execution
 * substrate.
 *
 * Engine resolution is a pure, context-free decision: an explicitly configured
 * executable wins, otherwise a real Git for Windows / PowerShell 7 installation
 * is discovered from standard locations and PATH. Nothing here spawns a
 * process, so discovery can run before a Context exists and a runtime version
 * probe stays in the ctx-bearing executor (`process.ts`). The session-directory
 * helper is the one context-bearing member: it reads the native
 * `workingDirectory` fact so relative shell cwd values share the session's
 * effective directory instead of a second notion of it.
 *
 * The result carries argv fields separately from the command text: the command
 * is always one element, so spaces and CJK text are never re-quoted by an
 * intermediate shell.
 *
 * @module dsh-nexus/shell/engines
 */

import { lstatSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '../config.ts'
import type { RuntimeSettings, ShellEngine } from '../protocol.ts'
import { NexusError } from '../runtime/errors.ts'

/** Deployment defaults plus the stored terminal preferences for one resolution. */
export interface ShellExecutionConfig {
  /** Installation-level defaults from the Loader row. */
  readonly deployment: Config
  /** Stored per-installation terminal settings (explicit paths outrank deployment). */
  readonly terminal: RuntimeSettings['terminal']
}

/** One validated shell invocation: executable, fixed arguments and dialect. */
export interface ShellEngineSpec {
  /** Engine this spec was resolved for; the default is `bash`. */
  readonly engine: ShellEngine
  /** Absolute executable path, validated to exist before it is returned. */
  readonly executable: string
  /**
   * Fixed invocation arguments between the executable and the command:
   * `--noprofile --norc -c` for bash, or the no-profile/noninteractive
   * `-Command` pair for pwsh. The caller appends the command as one element.
   */
  readonly args: readonly string[]
  /** Parsing dialect of the executable; always equal to `engine`. */
  readonly dialect: ShellEngine
}

/** The native session-directory service one shell start resolves against. */
export interface SessionDirectoryPort {
  /**
   * Validate the current directory and restore the original project when it
   * disappeared.
   * @param agent - live Agent owning the session.
   * @param signal - cancellation for the filesystem inspection.
   * @returns the existing absolute session directory.
   */
  ensure(agent: Agent, signal?: AbortSignal): Promise<string>
}

/** Inputs a caller may override for deterministic discovery tests. */
export interface EngineDiscovery {
  /** Environment to inspect; defaults to the live process environment. */
  readonly env?: NodeJS.ProcessEnv
  /** Platform whose path conventions apply; defaults to the live platform. */
  readonly platform?: NodeJS.Platform
}

/** Fixed bash arguments: no profile, no rc file, command text next. */
const BASH_ARGS: readonly string[] = ['--noprofile', '--norc', '-c']

/** Fixed pwsh arguments: no logo/profile, noninteractive, command text next. */
const PWSH_ARGS: readonly string[] = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']

/**
 * Require the native session-directory owner.
 *
 * The shell tool and the persistent-terminal backend both resolve a relative or
 * omitted `cwd` against the calling session's effective directory. Reading that
 * fact from the native service (rather than the immutable session header) keeps
 * a durable directory change effective without letting either action change it.
 * @param ctx - host context that should provide `workingDirectory`.
 * @returns the native directory owner.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when the service is not composed.
 */
export function requireSessionDirectory(ctx: Context): SessionDirectoryPort {
  const service = ctx.get('workingDirectory') as SessionDirectoryPort | undefined
  if (service === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      'resolving a shell working directory requires the native ctx.workingDirectory service',
    )
  }
  return service
}

/**
 * Resolve one shell working directory against the native session directory.
 *
 * An omitted value means the session's effective directory; a relative value is
 * resolved against it. The function never commits a directory change.
 * @param ctx - host context providing `workingDirectory`.
 * @param agent - live Agent owning the session.
 * @param requested - model-supplied absolute or relative directory, or undefined.
 * @param signal - cancellation for the filesystem inspection.
 * @returns the absolute directory to start the shell in.
 */
export async function resolveShellCwd(
  ctx: Context,
  agent: Agent,
  requested: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const base = await requireSessionDirectory(ctx).ensure(agent, signal)
  if (requested === undefined) return base
  return isAbsolute(requested) ? requested : resolve(base, requested)
}

/**
 * Resolve the executable and fixed arguments of one engine.
 * @param kind - engine the caller wants; `bash` is the default.
 * @param config - deployment defaults and stored terminal preferences.
 * @param discovery - optional environment/platform override for discovery.
 * @returns a validated spec whose executable is absolute and exists.
 * @throws NexusError `SHELL_UNAVAILABLE` when the configured or discovered program is unusable.
 */
export async function resolveEngine(
  kind: ShellEngine,
  config: ShellExecutionConfig,
  discovery: EngineDiscovery = {},
): Promise<ShellEngineSpec> {
  const env = discovery.env ?? process.env
  const platform = discovery.platform ?? process.platform
  const explicit = kind === 'bash'
    ? nonEmpty(config.terminal.bashPath) ?? nonEmpty(config.deployment.bashPath)
    : nonEmpty(config.terminal.pwshPath) ?? nonEmpty(config.deployment.pwshPath)
  if (explicit !== undefined) {
    if (!isAbsolute(explicit)) {
      throw new NexusError(
        'SHELL_UNAVAILABLE',
        `the configured ${kind} path "${explicit}" is not absolute; set an absolute executable path instead`,
      )
    }
    if (!isUsableExecutable(explicit)) {
      throw new NexusError(
        'SHELL_UNAVAILABLE',
        `the configured ${kind} executable "${explicit}" does not exist; fix the terminal setting instead of relying on a fallback`,
      )
    }
    return specFor(kind, explicit)
  }
  const discovered = kind === 'bash' ? findBash(env, platform) : findPwsh(env, platform)
  if (discovered === undefined) {
    throw new NexusError(
      'SHELL_UNAVAILABLE',
      kind === 'bash'
        ? 'no Git Bash executable was found; install Git for Windows or set an absolute bashPath'
        : 'no PowerShell 7 executable was found; install PowerShell 7 or set an absolute pwshPath',
    )
  }
  return specFor(kind, discovered)
}

/** Build the immutable spec for one engine/executable pair. */
function specFor(kind: ShellEngine, executable: string): ShellEngineSpec {
  return Object.freeze({
    engine: kind,
    executable,
    args: kind === 'bash' ? BASH_ARGS : PWSH_ARGS,
    dialect: kind,
  })
}

/** Treat an empty configured string as "not configured". */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

/** Whether a candidate is a file or execution alias the host can spawn. */
function isUsableExecutable(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** First candidate that exists in the given order. */
function firstExisting(candidates: readonly string[]): string | undefined {
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = candidate.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (isUsableExecutable(candidate)) return candidate
  }
  return undefined
}

/** Split a PATH value without inventing entries. */
function pathEntries(value: string | undefined, separator: ';' | ':'): string[] {
  if (value === undefined) return []
  return value
    .split(separator)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter((entry) => entry.length > 0)
}

/** Whether a directory is a Git-for-Windows installation directory. */
function looksLikeGitDirectory(directory: string): boolean {
  return /(^|[\\/])git([\\/]|$)/i.test(directory)
}

/**
 * PATH-entry tails a Git for Windows installation exposes, longest first: an
 * installer adds `<root>\cmd` alone, while a bash session adds the
 * `mingw64` directories of the same installation.
 */
const GIT_PATH_TAILS: readonly string[] = ['mingw64\\usr\\bin', 'mingw64\\bin', 'cmd']

/**
 * The installation root a Git-looking PATH directory names.
 *
 * `<root>\cmd`, `<root>\mingw64\bin` and `<root>\mingw64\usr\bin` are all
 * directories of one installation whose bash lives in `<root>\bin` and
 * `<root>\usr\bin`. The root is read from the entry text alone: discovery never
 * scans a disk and never reads the registry, so an unknown layout stays
 * unknown instead of being guessed. An entry with no such tail names the root
 * itself.
 */
function gitInstallRootOf(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, '')
  const normalized = trimmed.replace(/\//g, '\\').toLowerCase()
  for (const tail of GIT_PATH_TAILS) {
    if (normalized.endsWith(`\\${tail}`)) return trimmed.slice(0, trimmed.length - tail.length - 1)
  }
  return trimmed
}

/** Whether a directory belongs to WSL or an app-execution alias, never Git Bash. */
function isWslOrAliasDirectory(directory: string, env: NodeJS.ProcessEnv): boolean {
  const normalized = directory.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
  const systemRoot = (env.SystemRoot ?? 'C:\\Windows').replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
  if (normalized === `${systemRoot}\\system32` || normalized.startsWith(`${systemRoot}\\system32\\`)) return true
  if (normalized.endsWith('\\microsoft\\windowsapps')) return true
  return normalized.startsWith('\\\\wsl$') || normalized.startsWith('\\\\wsl.localhost')
}

/**
 * Discover Git Bash without ever selecting WSL's `bash.exe`.
 *
 * Order: Git installation roots derived from standard Windows locations and
 * `GIT_INSTALL_ROOT`, then Git-looking PATH entries (a direct `bash.exe` first,
 * then the sibling `bin`/`usr\bin` of the installation that entry belongs to),
 * then other non-WSL PATH entries. PowerShell is not consulted here; no
 * fallback engine is chosen.
 */
function findBash(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') {
    return firstExisting([
      '/bin/bash',
      '/usr/bin/bash',
      '/usr/local/bin/bash',
      ...pathEntries(env.PATH, ':').map((directory) => join(directory, 'bash')),
    ])
  }
  const programRoots = unique([
    nonEmpty(env.ProgramFiles),
    nonEmpty(env.ProgramW6432),
    nonEmpty(env['ProgramFiles(x86)']),
  ])
  const candidates: string[] = []
  for (const root of programRoots) {
    candidates.push(join(root, 'Git', 'bin', 'bash.exe'), join(root, 'Git', 'usr', 'bin', 'bash.exe'))
  }
  const localAppData = nonEmpty(env.LOCALAPPDATA)
  if (localAppData !== undefined) candidates.push(join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'))
  const gitInstallRoot = nonEmpty(env.GIT_INSTALL_ROOT)
  if (gitInstallRoot !== undefined) {
    candidates.push(join(gitInstallRoot, 'bin', 'bash.exe'), join(gitInstallRoot, 'usr', 'bin', 'bash.exe'))
  }
  const pathDirectories = pathEntries(env.PATH, ';').filter(
    (directory) => !isWslOrAliasDirectory(directory, env),
  )
  for (const directory of pathDirectories.filter(looksLikeGitDirectory)) {
    const root = gitInstallRootOf(directory)
    candidates.push(
      join(directory, 'bash.exe'),
      join(root, 'bin', 'bash.exe'),
      join(root, 'usr', 'bin', 'bash.exe'),
    )
  }
  for (const directory of pathDirectories.filter((entry) => !looksLikeGitDirectory(entry))) {
    candidates.push(join(directory, 'bash.exe'))
  }
  return firstExisting(candidates)
}

/**
 * Discover PowerShell 7. Windows PowerShell 5.1 is deliberately absent: the
 * runtime probe in `process.ts` still verifies the discovered program's major
 * version before the first command runs.
 */
function findPwsh(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') {
    return firstExisting([
      '/usr/bin/pwsh',
      '/usr/local/bin/pwsh',
      ...pathEntries(env.PATH, ':').map((directory) => join(directory, 'pwsh')),
    ])
  }
  const candidates: string[] = []
  for (const root of unique([nonEmpty(env.ProgramFiles), nonEmpty(env.ProgramW6432)])) {
    candidates.push(join(root, 'PowerShell', '7', 'pwsh.exe'))
  }
  const localAppData = nonEmpty(env.LOCALAPPDATA)
  if (localAppData !== undefined) candidates.push(join(localAppData, 'Microsoft', 'WindowsApps', 'pwsh.exe'))
  for (const directory of pathEntries(env.PATH, ';')) {
    candidates.push(join(directory, 'pwsh.exe'))
  }
  return firstExisting(candidates)
}

/** Drop undefined entries while preserving order. */
function unique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))]
}
