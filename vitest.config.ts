import { defineConfig } from 'vitest/config'

/**
 * Default suite: node environment, offline, project-local temporary state.
 *
 * The integration and Windows configurations are separate files so a default
 * `pnpm test` never needs a harness, a profile, or a network provider.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**', 'test/windows/**', 'node_modules/**'],
  },
})
