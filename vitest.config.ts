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
    // The integration suite needs a built host row and a real harness; the
    // Windows acceptance file needs real shells. Neither runs offline here.
    exclude: ['test/integration/**', 'test/integration/windows.test.ts', 'test/windows/**', 'node_modules/**'],
  },
})
