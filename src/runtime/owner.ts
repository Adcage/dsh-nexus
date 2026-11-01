/**
 * Caller identity for one Nexus tool run.
 *
 * @module dsh-nexus/runtime/owner
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { NexusError } from './errors.ts'

/** The two authorities one tool run needs, plus its cancellation. */
export interface CallOwner {
  /** The exact live Agent instance the run is attributed to. */
  readonly agent: Agent
  /** Durable session identity; survives a restart, unlike the Agent instance. */
  readonly sessionId: SessionId
  /** Caller-owned cancellation for the run. */
  readonly signal: AbortSignal
}

/**
 * Resolve the owner of one tool run.
 *
 * A registry execution can arrive without an Agent (a transport or PTC dispatch
 * that no session owns). That run has no authority to act on anyone's behalf, so
 * it is rejected here — before the caller starts a process, opens a terminal or
 * writes a record. The Agent instance is returned as-is: a session id alone is
 * not authorization, because a restarted session may carry a stale Agent.
 * @param exec - the registry's run context.
 * @returns the caller's Agent, session id and signal.
 * @throws NexusError `NO_AGENT` when the run carries no Agent.
 */
export function requireOwner(exec: ToolRunContext): CallOwner {
  const agent = exec.agent
  if (agent === undefined) {
    throw new NexusError('NO_AGENT', `${exec.name} needs an agent-owned session; this run has no calling agent`)
  }
  return { agent, sessionId: agent.id, signal: exec.signal }
}
