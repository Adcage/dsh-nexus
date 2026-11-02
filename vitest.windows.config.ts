import { defineConfig } from 'vitest/config'

/**
 * Real-Windows acceptance suite: Git Bash and PowerShell 7 execute as real
 * child processes and real ConPTY sessions on this host, through the shipped
 * `@deepseek-ai/dsh-subprocess-local` provider and this package's own shell
 * tool, terminal controller and terminal backends.
 *
 * It is a separate configuration because it needs those real executables and
 * cannot run in the default offline suite. The file itself refuses on a
 * non-Windows host instead of skipping to green, so a CI run on another
 * platform fails loudly rather than reporting acceptance it never performed.
 *
 * Files run one at a time: each case owns real processes, ports and temporary
 * roots, and serial execution keeps the process census attributable.
 */
export default defineConfig({
  test: {
    include: ['test/integration/windows.test.ts'],
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    reporters: ['default'],
  },
})
