import { defineConfig } from 'vitest/config'

/**
 * Integration suite: the real DSH host composition with a controlled model
 * provider, run against a project-isolated home and store.
 *
 * It is a separate file so the default `pnpm test` never needs a built host row,
 * a harness, or a profile. Files run in one fork at a time: each case pins
 * project-global `DSH_HOME`/`DSH_AGENTS_HOME` for the duration of its harness, so
 * concurrent files would race those variables.
 *
 * `test/integration/windows.test.ts` is the real-Windows acceptance file of the
 * later task: it needs a real Git Bash/pwsh7 and must never run here.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    exclude: ['test/integration/windows.test.ts', 'node_modules/**'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
})
