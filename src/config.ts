/**
 * Deployment configuration for the `dsh-nexus` Loader row.
 *
 * A Loader entry's `Config` is also its settings namespace, which is why the row
 * id, the host `name` and this schema's owner all read `dsh-nexus`. Only values
 * that are fixed for the installation belong here: the default executables of the
 * two supported shells. Which engine a call uses, and any per-installation
 * override of these paths, is a stored setting (`RuntimeSettings.terminal`),
 * because the console changes it while the plugin runs.
 *
 * @module dsh-nexus/config
 */

import z from '@deepseek-ai/schemastery'

/** Deployment-level configuration accepted by the `dsh-nexus` row. */
export interface Config {
  /** Bash executable used when the stored terminal settings name none; Git Bash by default on Windows. */
  bashPath?: string
  /** PowerShell 7 executable used when the stored terminal settings name none. */
  pwshPath?: string
}

/** Schemastery schema cordis validates the row's `config` against. */
export const Config: z<Config> = z.object({
  bashPath: z.string().description('Bash executable used when the terminal settings name none'),
  pwshPath: z.string().description('PowerShell 7 executable used when the terminal settings name none'),
})
