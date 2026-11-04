import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixtures: string[] = []
// Hooks export GIT_INDEX_FILE, GIT_DIR, etc. Never let test repositories operate
// on the real commit's index when this suite is itself run from a hook.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

function run(cwd: string, command: string, args: string[]) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8' })
}

function git(cwd: string, ...args: string[]) {
  const result = run(cwd, 'git', args)
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message)
  return result.stdout
}

function fixture(check = "mkdirSync('lib', { recursive: true }); writeFileSync('lib/index.js', readFileSync('source.txt', 'utf8'))") {
  mkdirSync(join(root, 'tmp'), { recursive: true })
  const dir = mkdtempSync(join(root, 'tmp', 'precommit-'))
  fixtures.push(dir)
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, '.githooks'))
  copyFileSync(join(root, 'scripts/precommit.mjs'), join(dir, 'scripts/precommit.mjs'))
  copyFileSync(join(root, '.githooks/pre-commit'), join(dir, '.githooks/pre-commit'))
  chmodSync(join(dir, '.githooks/pre-commit'), 0o755)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: {
    check: 'node check.mjs',
    'verify:runtime': 'node verify.mjs',
  } }))
  writeFileSync(join(dir, 'check.mjs'), `import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';\n${check}\n`)
  writeFileSync(join(dir, 'verify.mjs'), "import { accessSync } from 'node:fs'; accessSync('lib/index.js');\n")
  writeFileSync(join(dir, 'source.txt'), 'staged source\n')
  git(dir, 'init', '--quiet')
  git(dir, 'add', '.')
  return dir
}

function hook(dir: string) {
  return run(dir, process.execPath, ['scripts/precommit.mjs'])
}

function expectBlocked(dir: string, pattern: RegExp) {
  const before = git(dir, 'write-tree')
  const result = hook(dir)
  expect(result.status, result.stdout + result.stderr).not.toBe(0)
  expect(result.stdout + result.stderr).toMatch(pattern)
  expect(git(dir, 'write-tree')).toBe(before)
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('local build-on-commit hook', () => {
  it('ships a hook and does not require an installation lifecycle build', () => {
    expect(existsSync(join(root, 'scripts/precommit.mjs'))).toBe(true)
    expect(existsSync(join(root, '.githooks/pre-commit'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const name of ['prepare', 'preinstall', 'install', 'postinstall', 'prepack']) {
      expect(manifest.scripts[name]).toBeUndefined()
    }
  })

  it('builds and includes lib in the same real Git commit', () => {
    const dir = fixture()
    const result = run(dir, 'git', [
      '-c', 'user.name=Hook Test', '-c', 'user.email=hook@example.invalid',
      '-c', 'core.hooksPath=.githooks', 'commit', '-m', 'fixture',
    ])
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(git(dir, 'show', 'HEAD:lib/index.js')).toBe('staged source\n')
    expect(git(dir, 'status', '--porcelain')).toBe('')
  }, 30_000)

  it('rejects partially staged source without building or changing the index', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'source.txt'), 'not staged\n')
    expectBlocked(dir, /unstaged/i)
    expect(existsSync(join(dir, 'lib'))).toBe(false)
  })

  it('rejects non-ignored untracked files without automatically adding them', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'new source.txt'), 'untracked\n')
    expectBlocked(dir, /untracked/i)
    expect(existsSync(join(dir, 'lib'))).toBe(false)
  })

  it('leaves the index untouched on a failed check', () => {
    const dir = fixture('process.exit(7)')
    expectBlocked(dir, /check.*failed/i)
  }, 30_000)

  it('does not stage generated output when verification fails', () => {
    const dir = fixture('/* deliberately produce no output */')
    expectBlocked(dir, /verify:runtime.*failed/i)
  }, 30_000)

  it('rejects source changes made during checks', () => {
    const dir = fixture("mkdirSync('lib'); writeFileSync('lib/index.js', 'output'); writeFileSync('source.txt', 'changed during build')")
    expectBlocked(dir, /unstaged/i)
  }, 30_000)

  it('rejects unresolved merges before running checks', () => {
    const dir = fixture()
    const blob = git(dir, 'hash-object', '-w', 'source.txt').trim()
    const conflict = spawnSync('git', ['update-index', '--index-info'], {
      cwd: dir, env, encoding: 'utf8',
      input: `0 ${'0'.repeat(40)}\tsource.txt\n100644 ${blob} 1\tsource.txt\n100644 ${blob} 2\tsource.txt\n100644 ${blob} 3\tsource.txt\n`,
    })
    expect(conflict.status, conflict.stderr).toBe(0)
    const before = git(dir, 'ls-files', '--stage')
    const result = hook(dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/merge conflicts/i)
    expect(git(dir, 'ls-files', '--stage')).toBe(before)
    expect(existsSync(join(dir, 'lib'))).toBe(false)
  })

  it('does not stage lib when another operation changes the index during checks', () => {
    const dir = fixture("mkdirSync('lib'); writeFileSync('lib/index.js', 'output'); writeFileSync('source.txt', 'new staged input'); const { execFileSync } = await import('node:child_process'); execFileSync('git', ['add', 'source.txt']);")
    const result = hook(dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/index changed/i)
    expect(git(dir, 'ls-files', 'lib')).toBe('')
    expect(git(dir, 'show', ':source.txt')).toBe('new staged input')
  }, 30_000)

  it('allows ignored local files and replaces old generated files including deletions', () => {
    const dir = fixture()
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'lib/old.js'), 'old output')
    writeFileSync(join(dir, '.gitignore'), 'local-only/\n')
    git(dir, 'add', '.')
    rmSync(join(dir, 'lib/old.js'))
    mkdirSync(join(dir, 'local-only'))
    writeFileSync(join(dir, 'local-only/scratch.txt'), 'not an input')
    const result = hook(dir)
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(git(dir, 'ls-files', 'lib')).toBe('lib/index.js\n')
  }, 30_000)
})
