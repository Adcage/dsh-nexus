/// <reference path="./assets.d.ts" />
/**
 * The Nexus tool cards: one keyed view per owned wire Tool name in the shipped
 * `tool.call.toolview` slot.
 *
 * The owner of that slot is `@deepseek-ai/dsh-client-ui-tool`. It renders the
 * whole call tree — root, PTC dispatch children and their pairing — and
 * dispatches every *atomic* call here by wire name, falling back to its generic
 * card for any name nobody registered. This module therefore registers exactly
 * `shell`, `web` and `agent` and nothing else: it never pairs Session events,
 * never rebuilds the transcript, never renders `subCalls` (the tree already
 * does) and never subscribes to a session.
 *
 * Safety: a card is a pure function of the payload recorded with the call, so a
 * replayed transcript cannot show today's file, session, child or process
 * state. See `./tool-models.ts` for the total readers.
 *
 * Known limits, stated rather than invented:
 *
 * - `read`/`write`/`edit` stay on the owner's generic card. Their shipped card
 *   models validate the *native* file-tool arguments (`file_path`, old/new text)
 *   and would decline our `path`/`content`/`edits` arguments, so shadowing their
 *   cells would replace a working native card with one that cannot parse our
 *   calls — or, at the same priority, throw. The generic card falls back to the
 *   flattened recorded text, which is honest and needs no code here.
 * - A durable image in a recorded result (a `read` of an image file) is counted
 *   as a non-text block and linked to nothing. The owner's `tool.call.images`
 *   gallery is a single-occupant child slot claimed by the shipped image card;
 *   a second declaration throws at load, and this plugin composes no
 *   attachment implementation of its own.
 * - The atomic view receives no session-navigation callback, so a recorded
 *   child session id is shown as text with no "open child" action.
 *
 * @module dsh-nexus/client/tool-views
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LocaleNamespaceMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConsoleText } from './console.tsx'
import { NEXUS_TOOL_NAMES, NEXUS_TOOL_STAGE, NEXUS_TOOL_TITLE, readNexusToolCard } from './tool-models.ts'

/** Slot the shipped Tool package dispatches each atomic call through. */
export const TOOL_VIEW_SLOT = 'tool.call.toolview'

/**
 * Dictionary namespace of the console dictionary (`NS` in `./index.tsx`). It is
 * declared as a literal here so this module does not import the entry module it
 * is imported from; the `satisfies` clause fails to compile if the two drift.
 */
const NEXUS_LOCALE = 'dshNexus' satisfies keyof LocaleNamespaceMap

/** The stages the Tool owner hands one atomic view. */
export type NexusToolPhase = 'preparing' | 'start' | 'result'

/**
 * Owner share the Tool dispatch passes to every registered view. Only the fields
 * this card reads are declared; the same payload also carries the call identity,
 * `cwd`/`home` and the `openFile`/`loadImage`/`useDisclosure` seats, which a
 * recorded card with no gallery and no file link intentionally does not claim.
 */
export interface NexusToolCallOwnerProps {
  /** Wire Tool name and keyed dispatch value. */
  readonly toolName: string
  /** Current stage of this call. */
  readonly phase: NexusToolPhase
  /** Recorded call or result payload for the stage; opaque by contract, validated by the model. */
  readonly block: unknown
  /** Opens this call in the trajectory view; the owner omits it when that view is unavailable. */
  readonly inspect?: (() => void) | undefined
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Keyed atomic Tool view dispatched by wire Tool name, owned by
     * `@deepseek-ai/dsh-client-ui-tool`. Registering an occupied key replaces
     * that cell's view; unclaimed keys keep the generic card.
     */
    'tool.call.toolview': {
      kind: 'keyed'
      scope: 'session'
      owner: NexusToolCallOwnerProps
    }
  }
}

/** Composed props of one registered Nexus card. */
export interface NexusToolViewProps extends NexusToolCallOwnerProps {
  /** Locale seat the framework binds for the `dshNexus` dictionary. */
  readonly t: ConsoleText
}

/**
 * One recorded Nexus tool call.
 * @param props - dispatched wire name, stage, recorded block and locale seat.
 * @returns the card; every value in it is read from the recorded payload.
 */
export function NexusToolCard({ toolName, phase, block, inspect, t }: NexusToolViewProps) {
  const model = readNexusToolCard({ tool: toolName, phase, block })
  const settled = model.stage !== 'pending' && model.stage !== 'running'
  const openTrajectory = typeof inspect === 'function' ? inspect : undefined
  return <article className="dsh-nexus-tool" data-dsh-nexus-tool={model.tool ?? toolName} data-dsh-nexus-stage={model.stage}>
    <header className="dsh-nexus-tool-head">
      <strong className="dsh-nexus-tool-title">{model.tool === undefined ? toolName : t(NEXUS_TOOL_TITLE[model.tool])}</strong>
      <span className="dsh-nexus-tool-stage">{t(NEXUS_TOOL_STAGE[model.stage])}</span>
      {openTrajectory !== undefined && <button type="button" className="dsh-nexus-tool-inspect" onClick={() => openTrajectory()}>{t('toolInspect')}</button>}
    </header>
    {model.summary !== undefined && <p className="dsh-nexus-tool-summary"><span>{t('toolArgs')}</span> <code>{model.summary}</code></p>}
    {model.facts.length > 0 && <dl className="dsh-nexus-tool-facts">{model.facts.map((fact) =>
      <div key={fact.label}><dt>{t(fact.label)}</dt><dd>{fact.value}</dd></div>)}</dl>}
    {model.otherBlocks > 0 && <p className="dsh-nexus-tool-note"><span>{t('toolNonTextBlocks')}</span> <span>{model.otherBlocks}</span></p>}
    {model.failure !== undefined && <p className="dsh-nexus-tool-failure">
      <span>{t('toolFailure')}</span> <code>{`${model.failure.name}: ${model.failure.code}`}</code>
      {model.failure.reason !== undefined && <span className="dsh-nexus-tool-reason">{model.failure.reason}</span>}
    </p>}
    {model.output !== '' && <details className="dsh-nexus-tool-output">
      <summary>{t('toolOutput')}</summary>
      <pre>{model.output}</pre>
    </details>}
    {model.outputTruncated && <p className="dsh-nexus-tool-note">{t('toolOutputTruncated')}</p>}
    {settled && <p className="dsh-nexus-tool-note">{t('toolReplayNote')}</p>}
  </article>
}

/**
 * Register the Nexus cards for their wire Tool names.
 *
 * Additive: each key is one cell of a keyed slot, so a missing locale face or an
 * occupied cell refuses that key alone and the owner's generic card stays in
 * place. The returned disposer removes only these three cells.
 *
 * @param ctx - client context; the caller must already hold the `slots` and
 *   `locale` services and must call this inside the `tool.call.toolview`
 *   declaration, as `apply` does.
 * @returns disposer that unregisters every card this call registered.
 */
export function registerNexusToolViews(ctx: Context): () => void {
  const disposers: (() => void)[] = []
  for (const key of NEXUS_TOOL_NAMES) {
    try {
      disposers.push(ctx.slots.register({ name: TOOL_VIEW_SLOT, key, locale: NEXUS_LOCALE }, NexusToolCard))
    } catch {
      // The generic card already renders this name; a refused cell must not
      // take the other two keys, the console seats or the boot down.
      console.warn(`[dsh-nexus] the ${key} tool card could not be registered; the generic card stays in place`)
    }
  }
  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch { /* A stale disposer after a slot collapse is already a no-op. */ }
    }
  }
}
