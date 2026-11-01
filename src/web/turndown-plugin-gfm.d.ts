/**
 * Minimal ambient types for the GFM Turndown plugin.
 *
 * The package ships JavaScript only; its documented entry point is a single
 * `gfm` plugin function. Declaring exactly that keeps the import typed without
 * pulling in an untyped dependency's internal shapes.
 */
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown'

  /** Register GitHub-flavored tables and strikethrough on one converter. */
  export function gfm(service: TurndownService): void
}
