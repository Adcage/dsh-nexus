/**
 * The tool harness itself: the substrate every Nexus tool test stands on.
 *
 * If this spec passes, a tool test can trust that `call` reaches the real
 * registry pipeline, that a run carries the explicit owner, that the three
 * capability doubles answer through the shipped service contracts, and that
 * dispatching the harness leaves no registration behind.
 *
 * @module dsh-nexus/test/support/harness
 */

import { describe, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createToolHarness } from './harness.ts'

describe('createToolHarness', () => {
  it('drives a registered tool through the pipeline with the explicit owner', async () => {
    const harness = await createToolHarness({
      owner: { sessionId: 'owner-a' },
      fs: { files: { '/workspace/notes.txt': 'first line\nsecond line\n' } },
      web: { search: (request) => ({ sources: [{ url: `https://example.test/${request.query}` }], truncated: false }) },
      subprocess: { script: () => ({ stdout: 'child output', exitCode: 0 }) },
    })
    try {
      const observed: { sessionId?: string; agentId?: string } = {}
      harness.ctx.effect(
        () =>
          harness.ctx.tools.register(
            defineTool({
              name: 'probe_capabilities',
              description: 'Reads the capability doubles through the tool pipeline.',
              parameters: { path: { type: 'string', required: true } },
              output: {
                schema: { type: 'json' },
                render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
              },
              async execute(args, exec) {
                observed.agentId = exec.agent?.id
                observed.sessionId = exec.agent?.id
                const target = await harness.ctx.fs.resolve(args.path)
                const text = await harness.ctx.fs.readText(target)
                const web = await harness.ctx.web.search({ query: 'nexus', maxResults: 1 })
                const child = harness.ctx.subprocess.spawn({
                  argv: ['node', '-e', 'process.stdout.write("child output")'],
                  cwd: '/workspace',
                  stdio: {
                    stdin: 'ignore',
                    stdout: { maxBytes: 4096 },
                    stderr: { maxBytes: 4096 },
                  },
                  graceMs: 1000,
                })
                const outcome = await child.done
                return {
                  text,
                  source: web.sources[0]?.url ?? null,
                  stdout: child.collected.stdout?.readFrom(0).text ?? null,
                  exitCode: outcome.exitCode,
                }
              },
            }),
          ),
        'probe tool',
      )

      const result = await harness.call('probe_capabilities', { path: '/workspace/notes.txt' })

      expect(result.isError).toBe(false)
      expect(result.value).toEqual({
        text: 'first line\nsecond line\n',
        source: 'https://example.test/nexus',
        stdout: 'child output',
        exitCode: 0,
      })
      expect(observed.agentId).toBe(SessionId('owner-a'))
      expect(harness.web.searches).toEqual([{ query: 'nexus', maxResults: 1 }])
      expect(harness.subprocess.spawns).toHaveLength(1)
      expect(harness.subprocess.spawns[0]?.cwd).toBe('/workspace')
    } finally {
      await harness.dispose()
    }
  })

  it('reports an unregistered tool as a structured failure, not a rejection', async () => {
    const harness = await createToolHarness()
    try {
      const result = await harness.call('no_such_tool')
      expect(result).toMatchObject({ isError: true, error: { info: { code: 'UNKNOWN_TOOL' } } })
    } finally {
      await harness.dispose()
    }
  })

  it('disposes every registration it mounted', async () => {
    const harness = await createToolHarness({ fs: { files: { '/a.txt': 'a' } } })
    expect(harness.ctx.fs).toBeDefined()
    expect(harness.ctx.web).toBeDefined()
    expect(harness.ctx.subprocess).toBeDefined()
    await harness.dispose()
    // dispose() itself throws when a registration or service survived, so this
    // assertion only has to state the expectation the teardown enforces.
    expect(harness.ctx.get('tools')).toBeUndefined()
  })
})
