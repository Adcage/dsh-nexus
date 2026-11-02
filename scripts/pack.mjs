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
import { gunzipSync } from 'node:zlib'

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
// `check` is typecheck + build + the offline suite, in that order: a tarball is
// only produced from a tree that passes the gates the docs promise.
runPnpm(['run', 'check'])
runPnpm(['pack', '--pack-destination', destination])

const tarball = `${packageRoot}${destination}/${manifest.name}-${manifest.version}.tgz`
if (!existsSync(tarball)) {
  console.error(`pack: pnpm pack did not produce ${tarball}`)
  process.exit(1)
}
inspectTarball(tarball)
console.log(`pack: ${tarball}`)

/**
 * Read one NUL-terminated field out of a tar header.
 * @param buffer - whole archive or one header block.
 * @param offset - field start.
 * @param length - field length.
 * @returns the trimmed field text.
 */
function readField(buffer, offset, length) {
  const field = buffer.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8')
}

/**
 * List the member paths of a gzipped tar without extracting it.
 *
 * The archive is read directly instead of shelling out to `tar`, which is not
 * guaranteed to exist on the platforms this package builds on.
 * @param path - absolute tarball path.
 * @returns member paths, without the npm `package/` prefix.
 */
function listMembers(path) {
  const archive = gunzipSync(readFileSync(path))
  const members = []
  let offset = 0
  let pendingLongName
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readField(header, 0, 100)
    const sizeField = readField(header, 124, 12).trim()
    const size = sizeField === '' ? 0 : Number.parseInt(sizeField, 8)
    const type = String.fromCharCode(header[156])
    const prefix = readField(header, 345, 155)
    const dataOffset = offset + 512
    const longName = pendingLongName
    pendingLongName = undefined
    if (type === 'L') pendingLongName = readField(archive, dataOffset, size)
    else if (type === '0' || type === '\0') {
      const full = longName ?? (prefix === '' ? name : `${prefix}/${name}`)
      members.push(full.replace(/^package\//, '').replace(/\/$/, ''))
    }
    offset = dataOffset + Math.ceil(size / 512) * 512
  }
  return members
}

/**
 * Check the packed tarball against the manifest's `files` list.
 *
 * A tarball that installs is not the same artifact as one that carries the
 * host row, the client bundle and the preset entry: this check fails the pack
 * instead of leaving that discovery to the profile that installs it.
 * @param tarball - absolute tarball path.
 */
function inspectTarball(tarball) {
  const members = listMembers(tarball)
  const required = ['package.json', 'cordis.patch.yml', 'README.md', 'lib/index.js', 'lib/client.js', 'lib/preset/index.js']
  const missing = required.filter((member) => !members.includes(member))
  if (missing.length > 0) {
    console.error(`pack: tarball is missing ${missing.join(', ')}`)
    process.exit(1)
  }
  // Only declared roots may ship: a stray source tree or a local profile would
  // travel to every installing machine.
  const roots = new Set(['package.json', ...manifest.files])
  const stray = members.filter((member) => !roots.has(member.split('/')[0]))
  if (stray.length > 0) {
    console.error(`pack: tarball ships undeclared paths: ${stray.slice(0, 10).join(', ')}`)
    process.exit(1)
  }
  const declaredButAbsent = manifest.files.filter((entry) => !members.some((member) => member === entry || member.startsWith(`${entry}/`)))
  if (declaredButAbsent.length > 0) {
    // A `files` entry with no file behind it is a packaging gap, not a runtime
    // failure: report it loudly and keep the tarball.
    console.warn(`pack: declared but not present in the repository: ${declaredButAbsent.join(', ')}`)
  }
  console.log(`pack: ${members.length} members; ${required.join(', ')} present; no undeclared roots`)
}
