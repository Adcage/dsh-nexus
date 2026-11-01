/**
 * `dsh-nexus/preset` — the Nexus runtime sub-entry.
 *
 * It is a sub-entry of the same installed package, not a second package: the
 * root row and the browser half belong to `dsh-nexus`, while this row mounts the
 * code that only makes sense inside the Nexus preset scope. Its own row id
 * (`dsh-nexus-runtime`) and plugin name differ from the package name on purpose,
 * because it is mounted as `name: 'dsh-nexus/preset'` by the bundle patch once
 * the preset exists.
 *
 * This entry is buildable and loadable now; the preset definition, its fixed
 * composition and the session-scoped registrations arrive with the tasks that
 * own those seams.
 *
 * @module dsh-nexus/preset
 */

/** Loader row id of the Nexus runtime sub-entry. */
export const name = 'dsh-nexus-runtime'

/** Mount the Nexus runtime. It registers nothing until the preset seam exists. */
export function apply(): void {}
