// @vitest-environment jsdom
/**
 * The Nexus tool cards, driven through the real client seam: the shipped
 * `apply` mounts into a real rd.2 SlotRegistry, and every assertion renders the
 * component the registry actually stored for one wire Tool name. That is the
 * same dispatch `@deepseek-ai/dsh-client-ui-tool` performs for each atomic call,
 * so a registration that never lands fails here instead of in the GUI.
 *
 * The safety half is the point of this spec: a card is built only from the
 * payload recorded with the call, and malformed, hostile, oversized or foreign
 * payloads must degrade to bounded text without throwing and without claiming a
 * completion, an exit or a live state.
 *
 * @module dsh-nexus/test/client/tool-views
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../../src/client/index.tsx'
import { NEXUS_TOOL_STAGE, type NexusToolStage } from '../../src/client/tool-models.ts'
import { createConsoleStore } from '../../src/client/store.ts'
import { createNexusApi } from '../../src/client/api.ts'
import en from '../../src/locale/en.json' with { type: 'json' }
import zh from '../../src/locale/zh.json' with { type: 'json' }
import type { LoaderEntry } from '../support/browser-loader.ts'
import { clientFixture } from './fixture.ts'
import { mountConsole } from './render.ts'

const require = createRequire(import.meta.url)
/** Wire names this plugin owns; every other name must keep its own view. */
const NEXUS_KEYS = ['shell', 'web', 'agent'] as const

/** Native SlotRegistry, materialized from the shipped renderer bundle. */
function nativeRegistry(ctx: Context): SlotRegistry {
  let captured: LoaderEntry | undefined
  const previous = Object.getOwnPropertyDescriptor(window, '__ModuleLoader__')
  Object.defineProperty(window, '__ModuleLoader__', { configurable: true, value: { load: (entry: LoaderEntry) => { captured = entry } } })
  try {
    const path = require.resolve('@deepseek-ai/dsh-client-ui-renderer/client')
    new Function(readFileSync(path, 'utf8'))()
    const exports = captured!.factory(require)
    const Registry = exports.SlotRegistry as new (ctx: Context) => SlotRegistry
    return new Registry(ctx)
  } finally {
    if (previous) Object.defineProperty(window, '__ModuleLoader__', previous)
    else Reflect.deleteProperty(window, '__ModuleLoader__')
  }
}

interface Mounted {
  readonly ctx: Context
  readonly slots: SlotRegistry
  /** Declare the Tool owner's slots, as the shipped tool package does. */
  declare(): () => void
  /** Unload this plugin's client half and nothing else; safe to call more than once. */
  unload(): Promise<void>
  /** Unload the plugin and dispose the context; safe to call more than once. */
  readonly close: () => Promise<void>
}

const mounted: Mounted[] = []
afterEach(async () => { for (const view of mounted.splice(0)) await view.close() })

async function mountClient(): Promise<Mounted> {
  const ctx = new Context()
  const slots = nativeRegistry(ctx)
  // The locale service is a controlled external boundary; slot registration and
  // declaration lifecycle below are the actual SDK services.
  ctx.provide('locale', {
    register: () => () => {},
    bind: () => (key: keyof typeof en) => en[key],
    subscribe: () => () => {},
  })
  const fork = ctx.plugin({ name: 'dsh-nexus-client', inject: ['slots', 'locale'], apply })
  await Promise.resolve()
  let closed = false
  const view: Mounted = {
    ctx,
    slots,
    // Declaring a child slot is claiming it, so the owner component must
    // consume the render share for it — exactly as the shipped Tool owner does.
    declare: () => slots.register(
      { name: 'root', children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } } },
      (_props: PropsRenderSlots<'tool.call.toolview'>) => null,
    ),
    unload: async () => {
      if (closed) return
      closed = true
      await fork.dispose()
    },
    close: async () => {
      if (!closed) {
        closed = true
        await fork.dispose()
      }
      await ctx.fiber.dispose()
    },
  }
  mounted.push(view)
  return view
}

/** The component the registry stored for one wire Tool name. */
function viewOf(slots: SlotRegistry, key: string): ComponentType<Record<string, unknown>> {
  const entry = slots.entries('tool.call.toolview').find((row) => row.options.key === key)
  expect(entry, `registered view for ${key}`).toBeDefined()
  return entry!.component as ComponentType<Record<string, unknown>>
}

interface Rendered { readonly node: HTMLDivElement; readonly text: string; readonly unmount: () => void }

async function render(component: ComponentType<Record<string, unknown>>, props: Record<string, unknown>): Promise<Rendered> {
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  await act(async () => root.render(createElement(component, props)))
  return {
    node,
    get text() { return node.textContent ?? '' },
    unmount: () => { act(() => root.unmount()); node.remove() },
  }
}

/** One recorded call or result, in the shape the Runtime persists it. */
function recorded(tool: string, phase: string, block: Record<string, unknown>) {
  return { callId: 'call-1', toolName: tool, phase, block, t: (key: keyof typeof en) => en[key] }
}

/**
 * The text a reader sees before opening any disclosure: everything outside a
 * closed `<details>` subtree. `textContent` alone cannot tell a folded fact from
 * a visible one.
 */
function visibleText(node: Node): string {
  let text = ''
  for (const child of node.childNodes) {
    if (child.nodeType === 3) text += child.textContent ?? ''
    else if (child instanceof Element) {
      if (child.tagName === 'DETAILS' && !(child as HTMLDetailsElement).open) continue
      text += visibleText(child)
    }
  }
  return text
}

function resultBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'tool-result',
    seq: 4,
    time: 1_700_000_000_000,
    callId: 'call-1',
    name: 'shell',
    call: { name: 'shell', argsRaw: JSON.stringify({ action: 'run', command: 'echo hi' }) },
    callTime: 1_700_000_000_000,
    content: [{ type: 'text', text: '<process status="exited" exitCode="0" />\n<output>hi</output>' }],
    isError: false,
    meta: { action: 'run', status: 'exited', resourceId: 'proc-7' },
    subCalls: [],
    ...overrides,
  }
}

describe('Nexus tool views', () => {
  it('registers one keyed view per Nexus wire name, keeps foreign views and unregisters cleanly', async () => {
    const client = await mountClient()
    const owner = client.declare()
    expect(client.slots.entries('tool.call.toolview').map((row) => row.options.key)).toEqual([...NEXUS_KEYS])
    expect(client.slots.spec('tool.call.toolview')).toMatchObject({ kind: 'keyed', scope: 'session' })

    // Collapsing the owner's declaration clears every child entry; declaring it
    // again runs our registration once more, without a duplicate cell.
    owner()
    expect(client.slots.entries('tool.call.toolview')).toEqual([])
    client.declare()
    expect(client.slots.entries('tool.call.toolview').map((row) => row.options.key).sort()).toEqual(['agent', 'shell', 'web'])

    // A third-party view keeps its own cell: our unload removes our three and
    // leaves that one alone.
    client.slots.register({ name: 'tool.call.toolview', key: 'read' }, () => null)
    expect(client.slots.entries('tool.call.toolview').map((row) => row.options.key)).toEqual([...NEXUS_KEYS, 'read'])
    await client.unload()
    expect(client.slots.entries('tool.call.toolview').map((row) => row.options.key)).toEqual(['read'])
  })

  it('presents the preparing and running stages with no recorded output and no completion claim', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    const preparing = await render(shell, recorded('shell', 'preparing', { phase: 'preparing', name: 'shell' }))
    expect(preparing.node.querySelector('[data-dsh-nexus-stage="pending"]')).not.toBeNull()
    expect(preparing.text).toContain(en.toolStagePending)
    expect(preparing.node.querySelector('pre')).toBeNull()
    preparing.unmount()
    const running = await render(shell, recorded('shell', 'start', { phase: 'start', name: 'shell', argsRaw: JSON.stringify({ action: 'run', command: 'pnpm test' }) }))
    expect(running.node.querySelector('[data-dsh-nexus-stage="running"]')).not.toBeNull()
    expect(running.text).toContain('pnpm test')
    expect(running.text).toContain(en.toolStageRunning)
    running.unmount()
  })

  it('reads the stage from the recorded block when the owner passes no phase', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    const dispatch = (block: unknown) => ({ callId: 'call-1', toolName: 'shell', block, t: (key: keyof typeof en) => en[key] })
    // The profile's 0.1.0 owner passes the frozen call block and no `phase`; its
    // running call has neither a `kind` nor a stage field, only the identity of
    // the call it started.
    const live = await render(shell, dispatch({
      callId: 'call-1',
      name: 'shell',
      argsRaw: JSON.stringify({ action: 'run', command: 'pnpm test' }),
      turn: 1,
      step: 0,
      time: 1_700_000_000_000,
      callView: null,
      subCalls: [],
    }))
    expect(live.node.querySelector('[data-dsh-nexus-stage="running"]')).not.toBeNull()
    expect(live.text).toContain(en.toolStageRunning)
    expect(live.text).toContain('pnpm test')
    expect(live.text, 'a live call is not settled').not.toContain(en.toolStageEmpty)
    expect(live.text, 'a live call carries no replay note').not.toContain(en.toolReplayNote)
    live.unmount()
    // A settled record carries `kind` and still settles without the phase prop.
    const settled = await render(shell, dispatch(resultBlock()))
    expect(settled.node.querySelector('[data-dsh-nexus-stage="recorded"]')).not.toBeNull()
    expect(settled.text).toContain(en.toolStageRecorded)
    expect(settled.text).toContain(en.toolReplayNote)
    settled.unmount()
    // A payload with neither running-call evidence nor a recognised stage keeps
    // the conservative settled default instead of claiming an unfinished run.
    const unreadable = await render(shell, dispatch({}))
    expect(unreadable.node.querySelector('[data-dsh-nexus-stage="empty"]')).not.toBeNull()
    unreadable.unmount()
    // A block that throws on every read stays settled and does not throw.
    const hostile = new Proxy({}, { get() { throw new Error('hostile block') }, has() { throw new Error('hostile block') } })
    const hostileView = await render(shell, dispatch(hostile))
    expect(hostileView.node.querySelector('[data-dsh-nexus-tool]')!.getAttribute('data-dsh-nexus-stage')).toBe('empty')
    hostileView.unmount()
    // A phase prop this card cannot classify stays settled even next to a block
    // that would otherwise read as running.
    const unexpected = await render(shell, { ...dispatch({ callId: 'call-1', name: 'shell', argsRaw: '{}', subCalls: [] }), phase: 'unexpected' })
    expect(unexpected.node.querySelector('[data-dsh-nexus-stage="empty"]')).not.toBeNull()
    unexpected.unmount()
  })

  it('renders recorded shell facts and the recorded failure identity as recorded', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    const settled = await render(shell, recorded('shell', 'result', resultBlock()))
    expect(settled.node.querySelector('[data-dsh-nexus-stage="recorded"]')).not.toBeNull()
    expect(settled.text).toContain(en.toolStageRecorded)
    expect(settled.text).toContain('exited')
    expect(settled.text).toContain('proc-7')
    expect(settled.text).toContain('echo hi')
    expect(settled.text).toContain('<output>hi</output>')
    settled.unmount()
    const failed = await render(shell, recorded('shell', 'result', resultBlock({
      isError: true,
      content: [],
      error: { name: 'NexusError', code: 'SHELL_UNAVAILABLE' },
    })))
    expect(failed.node.querySelector('[data-dsh-nexus-stage="failed"]')).not.toBeNull()
    expect(failed.text).toContain(en.toolStageFailed)
    expect(failed.text).toContain('SHELL_UNAVAILABLE')
    failed.unmount()
    // An error record with neither a name nor a code has no failure identity to
    // print, so the card shows the failure label alone rather than a bare ": ".
    const withoutDetails = await render(shell, recorded('shell', 'result', resultBlock({ isError: true, content: [] })))
    expect(withoutDetails.node.querySelector('[data-dsh-nexus-stage="failed"]')).not.toBeNull()
    const failure = withoutDetails.node.querySelector('.dsh-nexus-tool-failure')
    expect(failure).not.toBeNull()
    expect(failure!.querySelector('code')).toBeNull()
    expect(failure!.textContent).toBe(en.toolFailure)
    withoutDetails.unmount()
  })

  it('shows only the title, stage, argument summary and failure line until the card disclosure opens', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    const card = await render(shell, recorded('shell', 'result', resultBlock({
      isError: true,
      error: { name: 'NexusError', code: 'SHELL_UNAVAILABLE', reason: 'no Git Bash executable was found' },
      meta: { action: 'run', status: 'exited', resourceId: 'proc-7' },
    })))
    const visible = visibleText(card.node)
    expect(visible).toContain(en.toolTitleShell)
    expect(visible).toContain(en.toolStageFailed)
    expect(visible).toContain('echo hi')
    expect(visible).toContain(en.toolFailure)
    expect(visible).toContain('SHELL_UNAVAILABLE')
    expect(visible).toContain('no Git Bash executable was found')
    // Every recorded fact, the recorded output and the replay note stay on the
    // card, but folded into the one disclosure instead of the default view.
    expect(visible).not.toContain('exited')
    expect(visible).not.toContain('proc-7')
    expect(visible).not.toContain('<output>hi</output>')
    expect(visible).not.toContain(en.toolReplayNote)
    const disclosures = card.node.querySelectorAll('details')
    expect(disclosures).toHaveLength(1)
    const disclosure = disclosures[0] as HTMLDetailsElement
    expect(disclosure.open).toBe(false)
    expect(disclosure.querySelector('summary')?.textContent).toBe(en.toolDetails)
    expect(disclosure.textContent).toContain(en.toolFactStatus)
    expect(disclosure.textContent).toContain('exited')
    expect(disclosure.textContent).toContain('proc-7')
    expect(disclosure.textContent).toContain('<output>hi</output>')
    expect(disclosure.textContent).toContain(en.toolReplayNote)
    // The disclosure is the native one: opening it with the summary shows the
    // folded record, so a keyboard user reaches the same facts.
    const summary = disclosure.querySelector('summary')!
    expect(summary.tabIndex).toBe(0)
    await act(async () => summary.click())
    expect(disclosure.open).toBe(true)
    expect(visibleText(card.node)).toContain('proc-7')
    card.unmount()
  })

  it('folds the non-text block count and the cut-preview note into the same disclosure', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    const card = await render(shell, recorded('shell', 'result', resultBlock({
      content: [{ type: 'image', source: { type: 'base64', data: 'AAAA' } }, { type: 'text', text: 'z'.repeat(40_000) }],
      meta: { action: 'run', status: 'exited', resourceId: 'proc-7' },
    })))
    const visible = visibleText(card.node)
    expect(visible).toContain(en.toolStageRecorded)
    expect(visible).not.toContain(en.toolNonTextBlocks)
    expect(visible).not.toContain(en.toolOutputTruncated)
    const disclosure = card.node.querySelector('details')!
    expect(disclosure.textContent).toContain(`${en.toolNonTextBlocks} 1`)
    expect(disclosure.textContent).toContain(en.toolOutputTruncated)
    expect(disclosure.querySelector('pre')?.textContent).toHaveLength(4_000)
    card.unmount()
  })

  it('compacts the web and agent cards without dropping a recorded fact', async () => {
    const client = await mountClient()
    client.declare()
    const web = await render(viewOf(client.slots, 'web'), recorded('web', 'result', resultBlock({
      name: 'web',
      call: { name: 'web', argsRaw: JSON.stringify({ action: 'search', queries: ['dsh tools'] }) },
      meta: { action: 'search', kind: 'search', resultId: 'web-3', itemCount: 3, savedCount: 2 },
    })))
    const webVisible = visibleText(web.node)
    expect(webVisible).toContain('dsh tools')
    expect(webVisible).toContain(en.toolStageRecorded)
    expect(webVisible).not.toContain('web-3')
    expect(web.node.querySelectorAll('details')).toHaveLength(1)
    expect(web.node.querySelector('details')!.textContent).toContain('web-3')
    web.unmount()
    const agent = await render(viewOf(client.slots, 'agent'), recorded('agent', 'result', resultBlock({
      name: 'agent',
      call: { name: 'agent', argsRaw: JSON.stringify({ action: 'start', task: 'audit the shell tool' }) },
      meta: { action: 'start', childId: 'session-child-1', label: 'audit', live: true, activity: 'running' },
    })))
    const agentVisible = visibleText(agent.node)
    expect(agentVisible).toContain('audit the shell tool')
    expect(agentVisible).not.toContain('session-child-1')
    expect(agent.node.querySelectorAll('details')).toHaveLength(1)
    expect(agent.node.querySelector('details')!.textContent).toContain('session-child-1')
    agent.unmount()
  })

  it('renders web and agent facts from the recorded meta of their owning tools', async () => {
    const client = await mountClient()
    client.declare()
    const web = await render(viewOf(client.slots, 'web'), recorded('web', 'result', resultBlock({
      name: 'web',
      call: { name: 'web', argsRaw: JSON.stringify({ action: 'search', queries: ['dsh tools'] }) },
      meta: { action: 'search', kind: 'search', resultId: 'web-3', itemCount: 3, savedCount: 2 },
    })))
    expect(web.text).toContain('search')
    expect(web.text).toContain('web-3')
    expect(web.text).toContain('dsh tools')
    expect(web.text).toContain('3')
    expect(web.text).toContain('2')
    web.unmount()
    const agent = await render(viewOf(client.slots, 'agent'), recorded('agent', 'result', resultBlock({
      name: 'agent',
      call: { name: 'agent', argsRaw: JSON.stringify({ action: 'start', task: 'audit the shell tool' }) },
      meta: { action: 'start', childId: 'session-child-1', label: 'audit', live: true, activity: 'running' },
    })))
    expect(agent.text).toContain('session-child-1')
    expect(agent.text).toContain('audit the shell tool')
    expect(agent.text).toContain('true')
    agent.unmount()
  })

  it('never renders a background launch, a stop request, a timeout or empty output as an exit or a success', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    // A published background command returns before the process does: the card
    // shows the recorded status and never a completion label.
    const background = await render(shell, {
      ...recorded('shell', 'result', resultBlock({
        call: { name: 'shell', argsRaw: JSON.stringify({ action: 'run', command: 'sleep 60', background: true }) },
        content: [{ type: 'text', text: 'background command published' }],
        meta: { action: 'run', status: 'running', resourceId: 'proc-9' },
      })),
      t: (key: keyof typeof zh) => zh[key],
    })
    const backgroundLabel = background.node.querySelector('.dsh-nexus-tool-stage')?.textContent
    expect(backgroundLabel).toBe(zh.toolStageRecorded)
    expect(backgroundLabel).not.toBe('已完成')
    expect(background.text).toContain('running')
    expect(background.text).not.toContain(zh.toolStageStopRequested)
    background.unmount()
    const stopped = await render(shell, {
      ...recorded('shell', 'result', resultBlock({ content: [], meta: { action: 'stop', status: 'exited', resourceId: 'proc-7' } })),
      t: (key: keyof typeof zh) => zh[key],
    })
    expect(stopped.node.querySelector('[data-dsh-nexus-stage="stopRequested"]')).not.toBeNull()
    expect(stopped.text).toContain(zh.toolStageStopRequested)
    expect(stopped.text).not.toContain(zh.toolStageRecorded)
    // The interrupted resource is still named, but its recorded status is not
    // restated: that status describes the resource, not the stop request.
    expect(stopped.text).toContain('proc-7')
    expect(stopped.text).not.toContain('exited')
    expect(stopped.text).not.toContain(zh.toolFactStatus)
    stopped.unmount()
    const timedOut = await render(viewOf(client.slots, 'agent'), recorded('agent', 'result', resultBlock({
      name: 'agent',
      meta: { action: 'wait', childId: 'session-child-1', timedOut: true },
    })))
    expect(timedOut.node.querySelector('[data-dsh-nexus-stage="timedOut"]')).not.toBeNull()
    expect(timedOut.text).toContain(en.toolStageTimedOut)
    timedOut.unmount()
    const empty = await render(shell, recorded('shell', 'result', resultBlock({ content: [], meta: { action: 'read', family: 'process' } })))
    expect(empty.node.querySelector('[data-dsh-nexus-stage="empty"]')).not.toBeNull()
    expect(empty.text).toContain(en.toolStageEmpty)
    empty.unmount()
    // A stage this card cannot classify is read as the settled one, so an
    // unexpected payload can never present the unfinished-stage copy.
    const unclassified = await render(shell, recorded('shell', 'unexpected', {}))
    expect(unclassified.node.querySelector('[data-dsh-nexus-stage="empty"]')).not.toBeNull()
    unclassified.unmount()
  })

  it('safely_replays_malformed_results_without_inventing_completion', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    const hostile = new Proxy({}, { get() { throw new Error('hostile block') } })
    const payloads: Record<string, unknown>[] = [
      resultBlock({ meta: { get action() { throw new Error('hostile meta') } } }),
      resultBlock({ meta: [1, 2, 3] }),
      resultBlock({ meta: 'not-an-object' }),
      resultBlock({ meta: { action: { nested: true }, status: 12, resourceId: 'x'.repeat(10_000) } }),
      resultBlock({ meta: undefined }),
      resultBlock({ content: 'text-not-array' }),
      resultBlock({ content: [null, 42, { type: 'text', text: 5 }, { get type(): string { throw new Error('hostile block') } }] }),
      resultBlock({ content: undefined, meta: undefined }),
      resultBlock({ isError: true, error: { get code() { throw new Error('hostile error') } } }),
      resultBlock({ isError: 'yes' }),
      resultBlock({ call: { argsRaw: '{not json' } }),
      resultBlock({ call: { argsRaw: 'y'.repeat(300_000) } }),
      resultBlock({ subCalls: [{ callId: 'child', name: 'echo', phase: 'start', subCalls: [null, 7] }, null] }),
      hostile,
    ]
    for (const [index, block] of payloads.entries()) {
      const view = await render(shell, recorded('shell', 'result', block))
      const stage = view.node.querySelector('[data-dsh-nexus-tool]')!.getAttribute('data-dsh-nexus-stage')!
      expect(['recorded', 'failed', 'empty', 'timedOut', 'stopRequested'], `payload ${index} stage`).toContain(stage)
      // The English face is checked here too: the visible label is the English
      // dictionary's own label for the classified stage. A word blocklist cannot
      // carry this, because the English stage copy negates completion in words.
      expect(view.node.querySelector('.dsh-nexus-tool-stage')?.textContent, `payload ${index} label`)
        .toBe(en[NEXUS_TOOL_STAGE[stage as NexusToolStage]])
      expect(view.text, `payload ${index} must not claim completion`).not.toContain('已完成')
      expect(view.text, `payload ${index} must not claim an exit`).not.toContain('已退出')
      view.unmount()
    }
  })

  it('bounds oversized recorded output and meta instead of rendering them whole', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    const oversized = await render(shell, recorded('shell', 'result', resultBlock({
      content: [{ type: 'text', text: 'z'.repeat(40_000) }],
      meta: { action: 'run', resourceId: 'r'.repeat(40_000) },
    })))
    expect(oversized.text.length).toBeLessThan(9_000)
    expect(oversized.text).toContain(en.toolOutputTruncated)
    oversized.unmount()
  })

  it('renders PTC subcalls as recorded without rebuilding their pairing', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    const parent = await render(shell, recorded('shell', 'result', resultBlock({
      content: [{ type: 'text', text: 'parent call recorded output' }],
      subCalls: [
        { callId: 'child-1', parentCallId: 'call-1', name: 'shell', phase: 'start', argsRaw: '{}', subCalls: [] },
        { kind: 'tool-result', callId: 'child-2', parentCallId: 'call-1', name: 'shell', content: [{ type: 'text', text: 'child secret' }], isError: false, meta: {}, subCalls: [] },
      ],
    })))
    expect(parent.text).toContain('parent call recorded output')
    expect(parent.text, 'the shipped tree renders descendants').not.toContain('child secret')
    expect(parent.node.querySelector('[data-subcalls]')).toBeNull()
    parent.unmount()
  })

  it('offers Inspect only when the owner supplies that callback, and offers no live lookup', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    let inspected = 0
    let loaded = 0
    const withInspect = await render(shell, {
      ...recorded('shell', 'result', resultBlock()),
      inspect: () => { inspected += 1 },
      openFile: () => { throw new Error('a recorded card must not open files') },
      loadImage: () => { loaded += 1; throw new Error('a recorded card must not load images') },
    })
    const inspect = withInspect.node.querySelector('button')
    expect(inspect?.textContent).toBe(en.toolInspect)
    await act(async () => inspect!.click())
    expect(inspected).toBe(1)
    expect(loaded).toBe(0)
    withInspect.unmount()
    const withoutInspect = await render(shell, recorded('shell', 'result', resultBlock()))
    expect(withoutInspect.node.querySelector('button')).toBeNull()
    withoutInspect.unmount()
  })

  it('replays the same recorded payload identically and does not consult current state', async () => {
    const client = await mountClient()
    client.declare()
    const shell = viewOf(client.slots, 'shell')
    const block = resultBlock()
    const first = await render(shell, recorded('shell', 'result', block))
    const text = first.text
    first.unmount()
    const second = await render(shell, recorded('shell', 'result', block))
    expect(second.text).toBe(text)
    second.unmount()
  })

  it('keeps every dshNexus dictionary key in both locales', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(typeof zh[key], key).toBe('string')
    for (const key of Object.keys(en).filter((name) => name.startsWith('tool')) as (keyof typeof en)[]) {
      expect(en[key], key).not.toBe('')
      expect(zh[key], key).not.toBe('')
    }
    expect(zh.toolStageRecorded).not.toBe(en.toolStageRecorded)
  })
})

describe('Nexus prompts labels', () => {
  it('names an unnamed module with the existing placeholder in the selection and saved-default rows', async () => {
    const f = clientFixture()
    f.library = { value: { modules: [{ id: 'unnamed-module-1', name: '', body: 'body' }], defaultSelection: ['unnamed-module-1'] }, hash: 'unnamed' }
    const store = createConsoleStore(createNexusApi(f.fetch))
    await store.refresh()
    const view = await mountConsole(store)
    try {
      const savedDefault = [...view.node.querySelectorAll('ol li')].map((row) => row.textContent)
      expect(savedDefault).toContain(en.untitledModule)
      await view.click(view.node.querySelector<HTMLInputElement>('input[data-module-select]')!)
      const selection = view.node.querySelector('ol')?.textContent ?? ''
      expect(selection).toContain(en.untitledModule)
      expect(selection).not.toContain('unnamed-module-1')
      expect(view.node.textContent).not.toContain('unnamed-module-1')
    } finally {
      view.dispose()
    }
  })
})
