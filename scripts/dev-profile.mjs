#!/usr/bin/env node
/**
 * Boot the plugin inside an isolated dsh profile, without touching the profile
 * the desktop app is using.
 *
 * It owns exactly one directory — `<this package>/.dev-home/` — and points a
 * child `dsh` process at it through `DSH_HOME`. Nothing is written to the user's
 * home, no other profile's credentials or environment are read, and the browser
 * is never opened: this script starts a server, it does not drive a session.
 *
 * Why it exists: a fresh boot composes the profile with the plugin already
 * installed, so the entry activates without the restart dance a running profile
 * needs. That is the cheapest way to prove the composition accepts the package.
 *
 * It installs the PACKED TARBALL (`dist/<name>-<version>.tgz`, or `--tarball`),
 * never the working directory: the tarball is the artifact a real installation
 * consumes, so this profile proves that artifact instead of a linked tree.
 *
 * Usage:
 *   node scripts/dev-profile.mjs init [--profile nexus-dev] [--cli <dsh>] [--tarball <path>]
 *   node scripts/dev-profile.mjs boot [--port 19499] [--profile nexus-dev] [--cli <dsh>]
 *   node scripts/dev-profile.mjs dump       print the composed row
 *   node scripts/dev-profile.mjs remove --yes
 *
 * No subcommand means usage, never a boot: a server started by accident is a
 * port and a profile the operator did not ask for.
 *
 * The CLI comes from `--cli`, then `$DSH_CLI`, then `dsh` on PATH. No absolute
 * deployment path is baked in, because the plugin must run against whatever
 * harness the user actually has.
 *
 * @module dsh-nexus/scripts/dev-profile
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const devHome = join(packageRoot, '.dev-home')
const DEFAULT_PORT = 19499
const DEFAULT_PROFILE = 'nexus-dev'

/**
 * Parse `--flag value` pairs and one leading command.
 * @param argv - arguments after the script name.
 * @returns the command and its flags.
 */
function parseArgs(argv) {
  const command = argv[0] !== undefined && !argv[0].startsWith('--') ? argv[0] : 'usage'
  const rest = command === argv[0] ? argv.slice(1) : argv
  const flags = new Map()
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg.startsWith('--')) continue
    const next = rest[index + 1]
    if (next === undefined || next.startsWith('--')) flags.set(arg.slice(2), true)
    else {
      flags.set(arg.slice(2), next)
      index += 1
    }
  }
  return { command, flags }
}

/**
 * Quote one argument for the Windows shell, which is the only place a shell is
 * involved: a `.cmd` shim cannot be spawned directly.
 * @param value - the argument text.
 * @returns the argument, quoted when it could break on spaces.
 */
function quote(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

/**
 * Run the configured dsh CLI with an environment that cannot leak another
 * profile: ambient `DSH_*` values are removed and `DSH_HOME` is the isolated one.
 * @param cli - resolved CLI path or command name.
 * @param args - CLI arguments.
 * @param options - `capture` keeps stdout/stderr for the caller.
 * @returns the completed child process.
 */
function runDsh(cli, args, options = {}) {
  const env = { ...process.env }
  for (const name of ['DSH_HOME', 'DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_SHELL', 'DSH_WEB_URL']) {
    delete env[name]
  }
  env.DSH_HOME = devHome
  const stdio = options.capture ? 'pipe' : 'inherit'
  const result = process.platform === 'win32'
    ? spawnSync([quote(cli), ...args.map(quote)].join(' '), { shell: true, env, encoding: 'utf8', stdio })
    : spawnSync(cli, args, { env, encoding: 'utf8', stdio })
  if (result.error) throw result.error
  return result
}

/**
 * Resolve the packed tarball this script installs.
 *
 * The tarball is the artifact a real installation uses, so the isolated profile
 * proves that artifact rather than a linked working directory. `--tarball`
 * overrides the default location under `dist/`.
 * @param configured - `--tarball` value, when supplied.
 * @returns the absolute tarball path.
 */
function resolveTarball(configured) {
  if (configured !== undefined) {
    if (configured === true) {
      console.error('dev-profile: --tarball needs a file path')
      process.exit(2)
    }
    const resolved = isAbsolute(configured) ? configured : join(packageRoot, configured)
    if (!existsSync(resolved)) {
      console.error(`dev-profile: tarball ${resolved} does not exist`)
      process.exit(2)
    }
    return resolved
  }
  const packaged = join(packageRoot, 'dist', `${manifest.name}-${manifest.version}.tgz`)
  if (!existsSync(packaged)) {
    console.error(
      `dev-profile: no packed tarball at ${packaged}; run \`pnpm pack:plugin\` first, or pass --tarball <path>`,
    )
    process.exit(2)
  }
  return packaged
}

/**
 * Install this package's packed tarball into the isolated profile, which also
 * creates the profile from the shipped `web` template the first time.
 * @param cli - resolved CLI path or command name.
 * @param profile - profile name inside the isolated home.
 */
function initialiseProfile(cli, profile) {
  const storeDir = join(devHome, '.pnpm-store')
  const tarball = resolveTarball(tarballFlag)
  mkdirSync(devHome, { recursive: true })
  const created = runDsh(cli, ['--profile', profile, '--from-default-profile', 'web', '--dump-config'], { capture: true })
  if (created.status !== 0) {
    process.stderr.write(created.stderr ?? '')
    process.exit(created.status ?? 1)
  }
  const added = runDsh(cli, ['plugin', '--profile', profile, 'add', tarball, `--config.store-dir=${storeDir}`], {
    capture: true,
  })
  if (added.status !== 0) {
    process.stderr.write(added.stderr ?? '')
    console.error('dev-profile: the isolated profile could not install the packed tarball')
    process.exit(added.status ?? 1)
  }
  console.log(`dev-profile: installed ${tarball} into profile "${profile}"`)
}

/**
 * Print the composed row for this package out of a `--dump-config` dump.
 * @param cli - resolved CLI path or command name.
 * @param profile - profile name.
 */
function dumpRow(cli, profile) {
  const result = runDsh(cli, ['--profile', profile, '--dump-config'], { capture: true })
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '')
    process.exit(result.status ?? 1)
  }
  const lines = (result.stdout ?? '').split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes(`id: ${manifest.name}`))
  if (index === -1) {
    console.error(`dev-profile: no "${manifest.name}" row in the composed profile`)
    process.exit(1)
  }
  for (const line of lines.slice(Math.max(0, index - 1), index + 3)) console.log(line)
}

const { command, flags } = parseArgs(process.argv.slice(2))
const cli = typeof flags.get('cli') === 'string' ? flags.get('cli') : (process.env.DSH_CLI ?? 'dsh')
const profile = typeof flags.get('profile') === 'string' ? flags.get('profile') : DEFAULT_PROFILE
const port = Number(flags.get('port') ?? DEFAULT_PORT)
const tarballFlag = flags.get('tarball')

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`dev-profile: --port must be a TCP port, got ${String(flags.get('port'))}`)
  process.exit(2)
}

switch (command) {
  case 'init': {
    if (existsSync(join(devHome, 'profiles', profile))) {
      console.log(`dev-profile: profile "${profile}" already exists in ${devHome}`)
      break
    }
    initialiseProfile(cli, profile)
    console.log(`dev-profile: created profile "${profile}" in ${devHome}; no server was started`)
    break
  }
  case 'boot': {
    if (!existsSync(join(devHome, 'profiles', profile))) initialiseProfile(cli, profile)
    console.log(`dev-profile: booting profile "${profile}" on http://127.0.0.1:${port} (Ctrl-C to stop)`)
    const result = runDsh(cli, ['--profile', profile, '--host', '127.0.0.1', '--port', String(port), '--no-open'])
    process.exit(result.status ?? 1)
  }
  case 'dump': {
    dumpRow(cli, profile)
    break
  }
  case 'remove': {
    if (flags.get('yes') !== true) {
      console.error(`dev-profile: refusing to delete ${devHome} without --yes`)
      process.exit(2)
    }
    rmSync(devHome, { recursive: true, force: true })
    console.log(`dev-profile: removed ${devHome}`)
    break
  }
  default: {
    console.error(
      [
        'usage: node scripts/dev-profile.mjs <init|boot|dump|remove> [--port N] [--profile NAME] [--cli PATH] [--tarball PATH]',
        '  init   install the packed tarball into the isolated profile only; no server is started',
        '  boot   start the isolated profile on --port (default 19499)',
        '  dump   print the composed dsh-nexus row',
        '  remove delete the isolated home; requires --yes',
      ].join('\n'),
    )
    process.exit(2)
  }
}
