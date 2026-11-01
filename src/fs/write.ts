/**
 * The guarded `write` tool.
 *
 * `write` creates a file or replaces it completely; it never fakes a targeted
 * edit. A target that already exists must have been observed by this session,
 * and a new target is created with the backend's `createIfAbsent` guard so a
 * concurrent creator wins safely instead of being clobbered. The observation
 * recorded after a successful write carries the backend's new version, so the
 * next guarded mutation has a truthful basis.
 *
 * @module dsh-nexus/fs/write
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { NexusError } from '../runtime/errors.ts'
import { requireOwner } from '../runtime/owner.ts'
import { recordObservation, requestWriteIntent, resolveTarget } from './policy.ts'

/** The structured outcome of one successful write. */
export interface WriteValue {
  /** Canonical path in the filesystem's execution world. */
  readonly path: string
  /** Whether the call created a file or replaced one. */
  readonly operation: 'create' | 'update'
  /** File text before the write (LF-normalized), or null when it was created. */
  readonly before: string | null
  /** File text after the write (LF-normalized). */
  readonly after: string
}

/** Raw arguments accepted by the write call. */
interface RawWriteArgs {
  readonly path: string
  readonly content: string
}

/**
 * Validate the schema-expressible part of a write call.
 * @param args - schema-validated raw arguments.
 * @returns the validated input.
 * @throws NexusError `INVALID_ARGUMENT` for a blank path.
 */
function parseWriteArgs(args: RawWriteArgs): RawWriteArgs {
  if (args.path.trim().length === 0) throw new NexusError('INVALID_ARGUMENT', 'path must be a non-empty string')
  return { path: args.path, content: args.content }
}

/**
 * Format a write outcome as the model-facing confirmation envelope.
 * @param displayPath - backend-resolved path.
 * @param operation - whether the file was created or updated.
 * @returns the envelope text.
 */
function formatWriteOutput(displayPath: string, operation: 'create' | 'update'): string {
  return `<path>${displayPath}</path>\n<type>file</type>\n<content>\n${
    operation === 'create' ? 'Created' : 'Updated'
  } file\n</content>`
}

/**
 * Register the `write` tool in this scope.
 * @param ctx - registration scope.
 * @returns the tool definition.
 */
export function createWriteTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'write',
    description: 'Create or fully replace a UTF-8 text file. An existing file must be read first.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Path to write, resolved against the session directory by the filesystem backend.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'Complete UTF-8 text content of the file.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', enum: ['create', 'update'], required: true },
          before: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          after: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as unknown as WriteValue
        return [{ type: 'text', text: formatWriteOutput(result.path, result.operation) }]
      },
      presentationMeta: (_args, value) => {
        const result = value as unknown as WriteValue
        return { path: result.path, operation: result.operation }
      },
    },
    async execute(args, exec) {
      requireOwner(exec)
      const input = parseWriteArgs(args)
      const target = await resolveTarget(ctx, exec, input.path)
      // Obtain the guard before any internal probe: a later reread must never
      // become the observation an overwrite is based on.
      const intent = await requestWriteIntent(ctx, target, exec)
      if (intent.kind === 'createIfAbsent') {
        const existing = await ctx.fs.stat(target, exec.signal)
        if (existing?.type === 'file') {
          throw new NexusError(
            'NOT_OBSERVED',
            `cannot write "${target.displayPath}": the file already exists and has not been read in this session; read it first`,
          )
        }
      }
      const outcome = await ctx.fs.writeText(target, input.content, intent, exec.signal)
      recordObservation(ctx, target, { kind: 'present', version: outcome.version }, exec)
      return {
        path: ctx.fs.processPath(target),
        operation: outcome.operation,
        before: outcome.before,
        after: outcome.after,
      } satisfies WriteValue
    },
  })
}
