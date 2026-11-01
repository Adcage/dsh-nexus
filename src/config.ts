/**
 * Deployment configuration for the `dsh-nexus` Loader row.
 *
 * A Loader entry's `Config` is also its settings namespace, which is why the row
 * id, the host `name` and this schema's owner all read `dsh-nexus`. The schema is
 * empty until a task adds a deployment-level default that the console and the
 * host half both need; per-session behaviour belongs to the stored settings
 * record, not here.
 *
 * @module dsh-nexus/config
 */

import z from '@deepseek-ai/schemastery'

/** Deployment-level configuration accepted by the `dsh-nexus` row. */
export interface Config {}

/** Schemastery schema cordis validates the row's `config` against. */
export const Config: z<Config> = z.object({})
