/**
 * `requireOwner`: the one place every Nexus tool resolves its caller.
 *
 * Two authorities are deliberately kept apart here. Runtime authorization is the
 * exact `Agent` instance the harness handed to the run, because a session id can
 * be reused by a stale Agent after a restart. Durable ownership is the session
 * id, because the medium outlives the process. `CallOwner` therefore carries
 * both, and an agentless run is rejected as `NO_AGENT` before a tool touches any
 * resource.
 *
 * The probe tool drives the real registry pipeline (`ctx.tools.execute`), so the
 * tests also pin that the Nexus error code survives DSH's standard
 * `{ name, code }` result projection, and that a native failure is not rewritten.
 *
 * @module dsh-nexus/test/runtime/owner
 */

import { describe, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { HarnessError, ToolCallId } from '@deepseek-ai/dsh-llm'
import { FsError } from '@deepseek-ai/dsh-fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId as SessionIdValue } from '@deepseek-ai/dsh-session'
import { createToolHarness, type ToolHarness } from '../support/harness.ts'
import { NexusError } from '../../src/runtime/errors.ts'
import { requireOwner } from '../../src/runtime/owner.ts'

/** What one probe run observed through `requireOwner`. */
interface OwnerObservation {
  agent?: Agent
  sessionId?: SessionIdValue
  signal?: AbortSignal
  /** Resources started by the body; must stay 0 when the owner is missing. */
  allocations: number
}

/**
 * Register a probe tool that resolves its owner first and allocates afterwards,
 * mirroring the ordering every Nexus tool must keep.
 * @param harness - the harness context the probe registers on.
 * @param observation - mutable record of what the run saw.
 */
function registerOwnerProbe(harness: ToolHarness, observation: OwnerObservation): void {
  harness.ctx.effect(
    () =>
      harness.ctx.tools.register(
        defineTool({
          name: 'owner_probe',
          description: 'Resolves the caller through requireOwner.',
          parameters: {},
          output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          async execute(_args, exec) {
            const owner = requireOwner(exec)
            observation.allocations += 1
            observation.agent = owner.agent
            observation.sessionId = owner.sessionId
            observation.signal = owner.signal
            return { sessionId: owner.sessionId }
          },
        }),
      ),
    'owner probe',
  )
}

/**
 * Register a probe tool that throws one error from its body unchanged.
 * @param harness - the harness context the probe registers on.
 * @param failure - the error instance the body throws.
 */
function registerFailingProbe(harness: ToolHarness, failure: Error): void {
  harness.ctx.effect(
    () =>
      harness.ctx.tools.register(
        defineTool({
          name: 'owner_probe',
          description: 'Throws a prepared failure.',
          parameters: {},
          output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          async execute() {
            throw failure
          },
        }),
      ),
    'owner probe',
  )
}

describe('requireOwner', () => {
  it('returns the exact Agent instance, its session id and the caller signal', async () => {
    const harness = await createToolHarness({ owner: { sessionId: 'owner-session' } })
    try {
      const observation: OwnerObservation = { allocations: 0 }
      registerOwnerProbe(harness, observation)

      const result = await harness.call('owner_probe')

      expect(result.isError).toBe(false)
      expect(result.value).toEqual({ sessionId: 'owner-session' })
      expect(observation.agent).toBe(harness.owner.agent)
      expect(observation.sessionId).toBe(SessionId('owner-session'))
      expect(observation.signal).toBe(harness.owner.signal)
    } finally {
      await harness.dispose()
    }
  })

  it('rejects an agentless run as NO_AGENT before the tool allocates anything', async () => {
    const harness = await createToolHarness()
    try {
      const observation: OwnerObservation = { allocations: 0 }
      registerOwnerProbe(harness, observation)

      const result = await harness.ctx.tools.execute({
        callId: ToolCallId('agentless-call'),
        name: 'owner_probe',
        arguments: {},
        signal: harness.owner.signal,
      })

      expect(observation.allocations).toBe(0)
      expect(observation.agent).toBeUndefined()
      expect(result).toMatchObject({
        isError: true,
        error: { info: { name: 'NexusError', code: 'NO_AGENT' } },
      })
    } finally {
      await harness.dispose()
    }
  })

  it('keeps the Agent instance and the durable session id as different authorities', async () => {
    const first = await createToolHarness({ owner: { sessionId: 'shared-session' } })
    const stale = await createToolHarness({ owner: { sessionId: 'shared-session' } })
    try {
      const firstObservation: OwnerObservation = { allocations: 0 }
      const staleObservation: OwnerObservation = { allocations: 0 }
      registerOwnerProbe(first, firstObservation)
      registerOwnerProbe(stale, staleObservation)

      await first.call('owner_probe')
      await stale.call('owner_probe')

      expect(firstObservation.agent).not.toBe(staleObservation.agent)
      expect(firstObservation.agent).toBe(first.owner.agent)
      expect(staleObservation.agent).toBe(stale.owner.agent)
      expect(firstObservation.sessionId).toBe(SessionId('shared-session'))
      expect(staleObservation.sessionId).toBe(SessionId('shared-session'))
    } finally {
      await first.dispose()
      await stale.dispose()
    }
  })

  it('leaves a native denial name, code and reason untouched', async () => {
    const harness = await createToolHarness()
    try {
      const denial = new FsError('sandbox denied: /workspace/hosts', 'FS_SANDBOX_DENIED')
      registerFailingProbe(harness, denial)

      const result = await harness.call('owner_probe')

      expect(result).toMatchObject({
        isError: true,
        error: { info: { name: 'FsError', code: 'FS_SANDBOX_DENIED' }, message: 'sandbox denied: /workspace/hosts' },
      })
      expect(result.content).toEqual([{ type: 'text', text: 'Error: sandbox denied: /workspace/hosts' }])
    } finally {
      await harness.dispose()
    }
  })

  it('builds a Nexus error that keeps a stable code through the standard channel', () => {
    const error = new NexusError('CONFIG_CONFLICT', 'the stored prompt library moved on')

    expect(error).toBeInstanceOf(HarnessError)
    expect(error).toMatchObject({ name: 'NexusError', code: 'CONFIG_CONFLICT' })
  })
})
