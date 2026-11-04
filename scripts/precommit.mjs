#!/usr/bin/env node
/**
 * Build the committed source, then stage only the generated lib directory.
 * Never stash user work or silently include unstaged source in the artifact.
 * Run by .githooks/pre-commit after the developer explicitly enables hooks.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const sourcePaths = ['.', ':(exclude)lib']

function fail(message) {
  throw new Error(message)
}

function git(args) {
  // Preserve Git's hook environment, including the index used by git commit.
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`git ${args[0]} failed: ${result.stderr.trim()}`)
  return result.stdout
}

function checkSource() {
  if (git(['ls-files', '--unmerged', '-z'])) {
    fail('Unresolved merge conflicts. Resolve and stage them before committing.')
  }
  if (git(['diff', '--name-only', '-z', '--', ...sourcePaths])) {
    fail('Unstaged changes outside lib/. Stage the intended files, or set aside other changes before committing. No files were staged by this hook.')
  }
  if (git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...sourcePaths])) {
    fail('Untracked files outside lib/. Stage intended new files, or move/ignore local-only files before committing. No source files are added automatically.')
  }
}

function runPnpm(script) {
  console.log(`nexus pre-commit: pnpm run ${script}`)
  // Windows pnpm is a .cmd shim. Script names here are fixed, never user input.
  const result = process.platform === 'win32'
    ? spawnSync(`pnpm run ${script}`, { cwd: root, stdio: 'inherit', shell: true })
    : spawnSync('pnpm', ['run', script], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`${script} failed. Commit stopped; lib/ was not staged. Ensure Node.js and pnpm are available and dependencies are installed.`)
}

try {
  checkSource()
  const indexBefore = git(['write-tree'])
  runPnpm('check')
  runPnpm('verify:runtime')
  checkSource()
  if (git(['write-tree']) !== indexBefore) {
    fail('The Git index changed during checks. Commit stopped; retry after finishing other Git operations.')
  }
  git(['add', '-A', '--', 'lib'])
  console.log('nexus pre-commit: checks passed; generated lib/ added to this commit.')
} catch (error) {
  console.error(`nexus pre-commit: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
