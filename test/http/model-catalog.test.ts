/** Catalog coalescing follows adapter lifetime, not the bounded HTTP wait. */
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createModelInspector } from '../../src/http/capabilities.ts'

let ctx: Context
let inspectModelIds: ReturnType<typeof createModelInspector>
beforeEach(async () => {
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  inspectModelIds = createModelInspector(ctx)
})
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await ctx.fiber.dispose()
})

it('joins concurrent requests for one provider and projects only model ids', async () => {
  let settle!: (models: LlmModelInfo[]) => void
  const pending = new Promise<LlmModelInfo[]>((resolve) => { settle = resolve })
  const read = vi.spyOn(ctx.llm, 'listModels').mockReturnValue(pending)
  const first = inspectModelIds('second-route')
  const second = inspectModelIds('second-route')
  await Promise.resolve()
  const calls = read.mock.calls.length
  settle([{ provider: 'second-route', id: 'second-model', name: 'private metadata', description: 'not returned' }])
  expect(await Promise.all([first, second])).toEqual([['second-model'], ['second-model']])
  expect(calls).toBe(1)
})

it('keeps a timed-out provider lookup joined until the underlying adapter settles', async () => {
  vi.useFakeTimers()
  let settle!: (models: LlmModelInfo[]) => void
  const pending = new Promise<LlmModelInfo[]>((resolve) => { settle = resolve })
  const read = vi.spyOn(ctx.llm, 'listModels').mockReturnValue(pending)
  const first = inspectModelIds('slow-route')
  await vi.advanceTimersByTimeAsync(1500)
  expect(await first).toEqual([])
  const afterTimeout = inspectModelIds('slow-route')
  await vi.advanceTimersByTimeAsync(1500)
  expect(await afterTimeout).toEqual([])
  const callsBeforeSettling = read.mock.calls.length
  settle([{ provider: 'slow-route', id: 'eventual-model', name: 'Eventual' }])
  // Let the adapter-completion cleanup run before asking for fresh metadata.
  await vi.advanceTimersByTimeAsync(0)
  read.mockResolvedValueOnce([{ provider: 'slow-route', id: 'fresh-model', name: 'Fresh' }])
  expect(await inspectModelIds('slow-route')).toEqual(['fresh-model'])
  expect(callsBeforeSettling).toBe(1)
  expect(read).toHaveBeenCalledTimes(2)
})

it('does not join different providers and retries after a shared rejection', async () => {
  let reject!: (error: Error) => void
  const pending = new Promise<LlmModelInfo[]>((_resolve, refuse) => { reject = refuse })
  const read = vi.spyOn(ctx.llm, 'listModels').mockImplementation((provider) => provider === 'failed-route'
    ? pending : Promise.resolve([{ provider, id: 'other-model', name: 'Other' }]))
  const first = inspectModelIds('failed-route')
  const second = inspectModelIds('failed-route')
  expect(await inspectModelIds('other-route')).toEqual(['other-model'])
  const callsBeforeRejection = read.mock.calls.length
  reject(new Error('private connection failure'))
  expect(await Promise.all([first, second])).toEqual([[], []])
  read.mockResolvedValueOnce([])
  expect(await inspectModelIds('failed-route')).toEqual([])
  expect(callsBeforeRejection).toBe(2)
  expect(read).toHaveBeenCalledTimes(3)
})
