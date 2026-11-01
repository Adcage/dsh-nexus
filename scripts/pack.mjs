#!/usr/bin/env node
/**
 * Build and pack the installable bundle tarball.
 *
 * The tarball is the only artifact the harness installs: a packed package lands
 * in the profile's `node_modules` as a real directory, while a linked working
 * directory is only reachable once the host has registered that path at boot.
 * `pnpm pack` is used rather than `npm pack` because npm needs a writable
 * `~/.npm` for its cache and log, and it also creates the destination directory.
 *
 * Usage: node scripts/pack.mjs [--destination <dir>]
 *
 * @module dsh-nexus/scripts/pack
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(`${packageRoot}package.json`, 'utf8'))
/**
 * Run one pnpm command in the package root.
 *
 * On Windows pnpm is a `.cmd` shim, which Node cannot spawn without a shell, so
 * the shell is enabled there. Every argument this script passes is a bare word
 * or a package-relative directory name without spaces.
 * @param args - command and arguments.
 */
function runPnpm(args) {
  const options = { cwd: packageRoot, stdio: 'inherit' }
  const result =
    process.platform === 'win32'
      ? spawnSync(`pnpm ${args.join(' ')}`, { ...options, shell: true })
      : spawnSync('pnpm', args, options)
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const destinationArg = process.argv.indexOf('--destination')
const destination = destinationArg === -1 ? 'dist' : process.argv[destinationArg + 1]
if (destination === undefined) {
  console.error('pack: --destination needs a directory')
  process.exit(2)
}

mkdirSync(`${packageRoot}${destination}`, { recursive: true })
runPnpm(['run', 'build'])
runPnpm(['pack', '--pack-destination', destination])

const tarball = `${packageRoot}${destination}/${manifest.name}-${manifest.version}.tgz`
if (!existsSync(tarball)) {
  console.error(`pack: pnpm pack did not produce ${tarball}`)
  process.exit(1)
}
console.log(`pack: ${tarball}`)
