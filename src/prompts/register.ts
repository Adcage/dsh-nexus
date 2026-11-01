/**
 * The native system-layer contribution of the Nexus persona.
 *
 * The persona is delivered as the REAL system prompt of a Nexus session, not as a
 * user message and not by rewriting `AGENTS.md` (PR-06, PR-11). Two properties
 * make that work without taking anything else away:
 *
 * - Registration targets the named persona PREFIX section
 *   (`deployment:persona-prefix`) through the public `SystemPrompt.section`
 *   surface. The registry documents that name as the slot a composition shadows,
 *   so a scoped registration replaces exactly that one contribution. The
 *   harness identity, first-party tool guidance, runtime context, the deployment
 *   persona suffix and every third-party section keep contributing; nothing here
 *   sets `complete`, clears other sections or disables runtime context, and
 *   `interpolate: false` keeps `{{…}}` in user text literal (PR-08, PR-10).
 * - The registration is made through the AGENT's own context (`agent.ctx`), which
 *   is the SDK's supported per-agent scope. That is why an unrelated Agent keeps
 *   the deployment persona: there is no global registration, no guessed opaque
 *   scope id and no global persona teardown.
 *
 * Lifecycle: `agent/created` is a serial, awaited native edge that runs before
 * the first prompt assembly and before queued input is released. The listener
 * awaits the session's snapshot initialization and only then registers a section
 * whose text provider reads `sessions.peek(agent).text` synchronously on every
 * assembly — so `apply` changes the NEXT request without touching, aborting or
 * rewriting a request already in flight (PR-14, PR-15). Both the listener and the
 * per-agent section registrations unwind with the returned idempotent disposer.
 *
 * Production composition is Task 9's seam: it mounts this function inside the
 * Nexus preset scope, so only Nexus sessions receive the contribution.
 *
 * A section's position in the prompt creates no new instruction authority:
 * ordering does not outrank provider rules, permissions or model limits (PR-09).
 *
 * @module dsh-nexus/prompts/register
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import type { PromptSessions } from './sessions.ts'

/**
 * Register the Nexus persona contribution for the agents of this scope.
 *
 * The returned disposer is idempotent and effect-scoped: it removes the creation
 * listener and every section this call registered for an already created Agent.
 * @param ctx - registration scope; the containing Nexus preset scope in production, an exact Agent scope for a per-agent registration.
 * @param sessions - per-session prompt state that holds the actual text.
 * @returns the disposer.
 */
export function registerPromptSections(ctx: Context, sessions: PromptSessions): () => void {
  const sections = new Map<Agent, () => void>()
  const onCreated = ctx.on('agent/created', async ({ agent }) => {
    // The snapshot must exist before any assembly of this Agent can run, and the
    // section is bound to this exact Agent so its text follows that Agent only.
    await sessions.initialize(agent)
    if (sections.has(agent)) return
    sections.set(
      agent,
      agent.ctx.systemPrompt.section({
        name: PERSONA_PREFIX_SECTION,
        order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
        interpolate: false,
        text: () => sessions.peek(agent).text,
      }),
    )
  })
  // The Agent's own scope already unwinds its section; dropping the bookkeeping
  // entry by exact identity keeps this scope from retaining a disposed Agent and
  // can never affect another Agent that shares the session id.
  const onDisposed = ctx.on('agent/disposed', ({ agent }) => {
    sections.delete(agent)
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    onCreated()
    onDisposed()
    for (const dispose of sections.values()) dispose()
    sections.clear()
  }
}
