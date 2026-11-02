import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

/**
 * Two builds, because the halves have different shapes.
 *
 * The host half is an ES module for the harness process: one entry for the
 * package root (`.`, the Loader row's plugin) and one for the `./preset`
 * sub-entry. `@deepseek-ai/*` peers stay external, as they are resolved from the
 * profile the plugin is installed into.
 *
 * The browser half is the module loader's factory form: `lib/client.js` registers
 * its factory under an id that MUST equal the package name — it is the boot graph
 * row id, and a mismatch makes the module system reject the bundle with
 * "loaded without registering <id>". React is the only unbundled import there,
 * because `react` and `react/jsx-runtime` are platform seeds in the browser
 * module table; everything else the client imports is bundled in, which is why
 * the client needs no runtime dependencies.
 *
 * `deps.neverBundle` is the current spelling of the deprecated top-level
 * `external`; the meaning is identical (mark these imports external rather than
 * resolve and inline them). It is load-bearing here, not decorative:
 * `@deepseek-ai/*` packages carry identity-bearing classes (`HarnessError`,
 * `FsError`, `TerminalError`, `TerminalBackendCleanupError`,
 * `BashTerminalBackend`, …). Inlining a second copy breaks every
 * `instanceof`-based classification across the plugin boundary — the native
 * `ToolRuntime` would drop a `NexusError`'s code, and a native terminal refusal
 * would stop being recognised — so the whole SDK namespace must resolve from the
 * profile the plugin is installed into. The packages that are VALUE-imported at
 * runtime are also declared as exact peers in `package.json`, so the requirement
 * is visible to the installer instead of being inferred from the bundle.
 */
const hostConfig: UserConfig = {
  entry: {
    index: 'src/index.ts',
    'preset/index': 'src/preset/index.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  sourcemap: true,
  clean: false,
  deps: { neverBundle: [/^@deepseek-ai\//, 'schemastery'] },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
}

const clientConfig: UserConfig = {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'], alwaysBundle: ['zod'], onlyBundle: ['zod'] },
  plugins: [{
    name: 'nexus-inline-styles',
    load(id) {
      if (id.endsWith('/styles.css?raw') || id.endsWith('\\styles.css?raw')) {
        return `export default ${JSON.stringify(readFileSync(id.slice(0, -4), 'utf8'))}`
      }
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-nexus", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [hostConfig, clientConfig]
