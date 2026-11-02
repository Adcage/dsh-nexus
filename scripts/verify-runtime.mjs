#!/usr/bin/env node
/**
 * Static identity check for the built `dsh-nexus` package.
 *
 * It answers the four questions that otherwise surface only in the browser
 * console or as "the plugin installed but nothing appeared":
 * is the bundle patch declared and present, does its row id equal the package
 * name, is the browser half declared as web, and does the built `lib/client.js`
 * register itself under that same id?
 *
 * It runs no harness, no network and no profile, so it is safe in `pnpm check`
 * and in any sandbox. A missing build is reported as a missing build.
 *
 * @module dsh-nexus/scripts/verify-runtime
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))

/**
 * Read and parse one package-relative file.
 * @param path - package-relative path.
 * @returns the parsed JSON document.
 */
function readJson(path) {
  return JSON.parse(readFileSync(`${packageRoot}${path}`, 'utf8'))
}

/** Collected failures; every check is reported, not just the first. */
const failures = []

/**
 * Record a check and its outcome.
 * @param label - what is being checked.
 * @param passed - whether the check passed.
 * @param detail - evidence shown either way.
 */
function check(label, passed, detail) {
  const status = passed ? 'ok  ' : 'FAIL'
  console.log(`${status} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!passed) failures.push(label)
}

const manifest = readJson('package.json')
check('package name is dsh-nexus', manifest.name === 'dsh-nexus', manifest.name)

const patchPath = manifest.dsh?.bundle?.patch
check('dsh.bundle.patch is declared', typeof patchPath === 'string', patchPath)
check('the patch file exists', typeof patchPath === 'string' && existsSync(`${packageRoot}${patchPath}`), patchPath)

check('dsh.client.platform is web', manifest.dsh?.client?.platform === 'web', manifest.dsh?.client?.platform)
check('exports "." is declared', manifest.exports?.['.'] !== undefined)
check('exports "./client" points at lib/client.js', manifest.exports?.['./client'] === './lib/client.js')
check('exports "./preset" is declared', manifest.exports?.['./preset'] !== undefined)
check('exports "./package.json" is declared', manifest.exports?.['./package.json'] === './package.json')

if (typeof patchPath === 'string' && existsSync(`${packageRoot}${patchPath}`)) {
  const patch = readFileSync(`${packageRoot}${patchPath}`, 'utf8')
  const rowIds = [...patch.matchAll(/^\s*-?\s*id:\s*(\S+)\s*$/gm)].map((match) => match[1])
  check('the patch inserts one row', rowIds.length === 1, rowIds.join(', '))
  check('the row id equals the package name', rowIds[0] === manifest.name, rowIds[0])
}

for (const artifact of ['lib/index.js', 'lib/preset/index.js', 'lib/client.js']) {
  check(`built artifact ${artifact}`, existsSync(`${packageRoot}${artifact}`), 'run pnpm build first')
}

if (existsSync(`${packageRoot}lib/client.js`)) {
  const banner = readFileSync(`${packageRoot}lib/client.js`, 'utf8').slice(0, 240)
  check(
    'the client bundle registers the package name',
    banner.includes(`id: "${manifest.name}"`),
    banner.split('\n')[0],
  )
}

const runtimeVersion = manifest.engines?.dsh
check(
  'the declared runtime is a concrete version',
  typeof runtimeVersion === 'string' && /^\d+\.\d+\.\d+/.test(runtimeVersion),
  runtimeVersion,
)

// The integration suite is a real command over real files, not a documentation
// claim: it needs an own config, its own cases and the built host row it drives.
const integrationScript = manifest.scripts?.['test:integration']
check(
  'scripts.test:integration runs the integration config',
  typeof integrationScript === 'string' && integrationScript.includes('vitest.integration.config.ts'),
  integrationScript,
)
check(
  'vitest.integration.config.ts exists',
  existsSync(`${packageRoot}vitest.integration.config.ts`),
  'the integration suite has no configuration without it',
)
const integrationCases = [
  'test/integration/preset.test.ts',
  'test/integration/native.test.ts',
  'test/integration/prompts.test.ts',
  'test/integration/cleanup.test.ts',
]
for (const file of integrationCases) {
  const present = existsSync(`${packageRoot}${file}`)
  const text = present ? readFileSync(`${packageRoot}${file}`, 'utf8') : ''
  // A file with no case would make the suite a config-only pass.
  check(`integration case ${file} has at least one test`, present && /\bit\(/.test(text), present ? 'present' : 'missing')
}
const windowsCase = 'test/integration/windows.test.ts'
for (const configFile of ['vitest.config.ts', 'vitest.integration.config.ts']) {
  const path = `${packageRoot}${configFile}`
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  check(
    `${configFile} excludes the Windows acceptance file`,
    text.includes(windowsCase),
    windowsCase,
  )
}

if (failures.length > 0) {
  console.error(`\nverify-runtime: ${failures.length} check(s) failed`)
  process.exit(1)
}
console.log(`\nverify-runtime: ${manifest.name} ${manifest.version} targets dsh ${runtimeVersion}; manifest, patch row and client bundle agree`)
