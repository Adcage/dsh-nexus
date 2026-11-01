/**
 * Observation policy and the Nexus filesystem tool suite.
 *
 * The suite keeps the shipped filesystem policy's rule — a mutation needs a
 * prior authoritative observation of the target — but expresses the rejection
 * with Nexus error codes. Observations arrive over the same `fs/observed`
 * event, so any tool that reads through the standard seam can satisfy the gate,
 * and a policy plugin mounted before Nexus keeps its own decision (the event is
 * first-wins, so this gate only acts when no earlier decider did).
 *
 * @module dsh-nexus/fs/policy
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsObservation, FsTarget, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { NexusError } from '../runtime/errors.ts'

/** Per-session record of the last authoritative observation of each target. */
export class FsObservationGate {
  private observed = new WeakMap<object, Map<string, FsObservation>>()

  /**
   * Decide the write intent from the prior observation.
   * @param target - resolved target about to be written.
   * @param actor - opaque execution context the event carried.
   * @returns a guarded replace for an observed file, otherwise a guarded create.
   */
  writeIntent(target: FsTarget, actor: object | undefined): FsWriteIntent {
    const prior = this.get(actor, target)
    return prior?.kind === 'present'
      ? { kind: 'replaceIfVersion', version: prior.version }
      : { kind: 'createIfAbsent' }
  }

  /**
   * Decide the edit guard from the prior observation.
   * @param target - resolved target about to be edited.
   * @param actor - opaque execution context the event carried.
   * @returns the observed version to use as the compare-and-swap basis.
   * @throws NexusError `NOT_OBSERVED` when the session never observed the target.
   * @throws NexusError `FILE_CHANGED` when the session observed the target absent.
   */
  editIntent(target: FsTarget, actor: object | undefined): { version: FsVersion } {
    const prior = this.get(actor, target)
    if (prior === undefined) {
      throw new NexusError('NOT_OBSERVED', `edit requires reading "${target.displayPath}" first`)
    }
    if (prior.kind === 'absent') {
      throw new NexusError(
        'FILE_CHANGED',
        `cannot edit "${target.displayPath}": it was observed as missing; read it again before editing`,
      )
    }
    return { version: prior.version }
  }

  /**
   * Record one authoritative observation.
   * @param target - observed target.
   * @param observation - present version or confirmed absence.
   * @param actor - opaque execution context the event carried.
   */
  observe(target: FsTarget, observation: FsObservation, actor: object | undefined): void {
    const owner = observationOwner(actor)
    if (owner === undefined) return
    let byTarget = this.observed.get(owner)
    if (byTarget === undefined) {
      byTarget = new Map()
      this.observed.set(owner, byTarget)
    }
    byTarget.set(target.targetKey, observation)
  }

  /** Drop every record; called when the owning plugin scope is disposed. */
  clear(): void {
    this.observed = new WeakMap()
  }

  private get(actor: object | undefined, target: FsTarget): FsObservation | undefined {
    const owner = observationOwner(actor)
    return owner === undefined ? undefined : this.observed.get(owner)?.get(target.targetKey)
  }
}

/**
 * Derive the observation owner from an opaque event actor.
 * @param actor - the execution context the filesystem event carried.
 * @returns the live session object, or undefined for an agentless run.
 */
function observationOwner(actor: object | undefined): object | undefined {
  if (actor === null || typeof actor !== 'object') return undefined
  const agent = (actor as { agent?: { session?: object } }).agent
  return agent?.session
}

/**
 * Register the Nexus fallback deciders for the three filesystem events.
 * @param ctx - registration scope; teardown drops every recorded observation.
 * @returns the gate used by this scope.
 */
export function installFsObservationPolicy(ctx: Context): FsObservationGate {
  const gate = new FsObservationGate()
  ctx.effect(() => {
    const removeWrite = ctx.on('fs/write-intent', (target, actor) =>
      Promise.resolve().then(() => gate.writeIntent(target, actor)),
    )
    const removeEdit = ctx.on('fs/edit-intent', (target, actor) =>
      Promise.resolve().then(() => gate.editIntent(target, actor)),
    )
    const removeObserved = ctx.on('fs/observed', (target, observation, actor) => gate.observe(target, observation, actor))
    return () => {
      removeWrite()
      removeEdit()
      removeObserved()
      gate.clear()
    }
  }, 'nexus fs observation policy')
  return gate
}

/**
 * Resolve a model-supplied path in the caller's session directory.
 * @param ctx - context providing the filesystem backend and working directory.
 * @param exec - current tool execution.
 * @param path - path as the model supplied it.
 * @returns the resolved stable target.
 */
export async function resolveTarget(ctx: Context, exec: ToolRunContext, path: string): Promise<FsTarget> {
  const workingDirectory = ctx.get('workingDirectory')
  const cwd =
    exec.agent === undefined || workingDirectory === undefined
      ? undefined
      : await workingDirectory.ensure(exec.agent, exec.signal)
  return ctx.fs.resolve(path, { ...(cwd === undefined ? {} : { cwd }), signal: exec.signal })
}

/**
 * Ask the mounted policy for a write intent.
 * @param ctx - context owning the `fs/write-intent` waterfall.
 * @param target - resolved target about to be written.
 * @param exec - current tool execution.
 * @returns the intent to stamp onto the write; a guarded create when no decider answered.
 */
export async function requestWriteIntent(
  ctx: Context,
  target: FsTarget,
  exec: ToolRunContext,
): Promise<FsWriteIntent> {
  return (await ctx.waterfall('fs/write-intent', target, exec, () => undefined)) ?? { kind: 'createIfAbsent' }
}

/**
 * Ask the mounted policy for an edit guard before any internal reread.
 * @param ctx - context owning the `fs/edit-intent` waterfall.
 * @param target - resolved target about to be edited.
 * @param exec - current tool execution.
 * @returns the version to use as the compare-and-swap basis.
 * @throws NexusError `NOT_OBSERVED` when no decider could supply a prior observation.
 */
export async function requestEditGuard(
  ctx: Context,
  target: FsTarget,
  exec: ToolRunContext,
): Promise<{ version: FsVersion }> {
  const guard = await ctx.waterfall('fs/edit-intent', target, exec, () => undefined)
  if (guard === undefined) {
    throw new NexusError('NOT_OBSERVED', `edit requires reading "${target.displayPath}" first`)
  }
  return guard
}

/**
 * Record a successful observation on the standard filesystem event.
 * @param ctx - context owning the `fs/observed` event.
 * @param target - observed target.
 * @param observation - present version or confirmed absence.
 * @param exec - current tool execution, used as the opaque actor.
 */
export function recordObservation(
  ctx: Context,
  target: FsTarget,
  observation: FsObservation,
  exec: ToolRunContext,
): void {
  ctx.emit('fs/observed', target, observation, exec)
}
