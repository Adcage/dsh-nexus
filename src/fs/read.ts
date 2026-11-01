/**
 * The unified `read` tool.
 *
 * One entry point handles text and images: text is returned as a bounded,
 * line-numbered window with an exact continuation offset, while an image is
 * committed through the mounted attachment store and returned as a real image
 * block beside its `<path>` envelope. An image is never reported as a path-only
 * success: an unknown route, a model without image input, a missing attachment
 * service or an unreadable format is an explicit failure.
 *
 * The observation recorded after a successful read is the one a later guarded
 * write/edit compares against; it is captured from the stat performed *before*
 * reading, so a file that changes while it is being read stays provably stale.
 *
 * @module dsh-nexus/fs/read
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  AttachmentError,
  AttachmentId,
  isAttachmentError,
  type ImageAttachmentRef,
  type ImageMediaType,
} from '@deepseek-ai/dsh-attachment'
import { FsError, type FsInfo, type FsTarget } from '@deepseek-ai/dsh-fs'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { RuntimeSettings } from '../protocol.ts'
import { FILE_READ_MAX_LINES } from '../runtime/defaults.ts'
import { NexusError } from '../runtime/errors.ts'
import { requireOwner } from '../runtime/owner.ts'
import { createEditTool } from './edit.ts'
import { installFsObservationPolicy, recordObservation, resolveTarget } from './policy.ts'
import { buildTextWindow, formatTextReadOutput, READ_MAX_LINE_LENGTH, type TextReadWindow } from './text.ts'
import { createWriteTool } from './write.ts'

/** Lossless JSON shape a presentation projector may return. */
type PresentationMeta =
  | null
  | boolean
  | number
  | string
  | PresentationMeta[]
  | { readonly [key: string]: PresentationMeta }

/** The text branch of a read result. */
export interface TextReadValue {
  readonly kind: 'text'
  /** Canonical path in the filesystem's execution world. */
  readonly path: string
  /** 1-based first line returned. */
  readonly offset: number
  /** Maximum number of lines this call accepted. */
  readonly limit: number
  /** Returned, numbered lines. */
  readonly lines: readonly { readonly number: number; readonly text: string }[]
  /** Exact line count of the whole file. */
  readonly totalLines: number
  /** Offset a continuation call needs, or null at end of file. */
  readonly nextOffset: number | null
  /** Whether more content remains after this window. */
  readonly truncated: boolean
}

/** Image metadata carried by an image read. */
export interface ImageReadValue {
  readonly attachmentId: string
  readonly mediaType: ImageMediaType
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** The image branch of a read result. */
export interface ImageReadResult {
  readonly kind: 'image'
  /** Canonical path in the filesystem's execution world. */
  readonly path: string
  /** Durable attachment reference produced by the mounted store. */
  readonly image: ImageReadValue
}

/** Either branch of a read result. */
export type ReadValue = TextReadValue | ImageReadResult

/** Raw arguments accepted by the read call. */
interface RawReadArgs {
  readonly path: string
  readonly offset?: number
  readonly limit?: number
}

/** Validated read input after defaulting. */
interface ReadInput {
  readonly path: string
  readonly offset: number
  readonly limit: number
}

/** Image extensions the unified read recognizes as images. */
const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
})

/** Image-looking extensions this build cannot read; rejected instead of read as text. */
const UNSUPPORTED_IMAGE_EXTENSIONS = Object.freeze(
  new Set(['.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif', '.svg', '.ico', '.psd', '.raw']),
)

/** Files at or above this size stream instead of loading whole into memory. */
const STREAM_MIN_SIZE = 1 * 1024 * 1024

/**
 * Map a path extension to the image type it declares.
 * @param path - model-supplied path.
 * @returns the declared media type, or undefined for a non-image name.
 */
export function imageMediaTypeForPath(path: string): ImageMediaType | undefined {
  return IMAGE_EXTENSIONS[extname(path).toLowerCase()]
}

/**
 * Identify a supported image by its file signature.
 * @param data - bytes read through the current backend.
 * @returns the detected media type, or undefined for other bytes.
 */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  const matches = (offset: number, expected: readonly number[]): boolean =>
    data.byteLength >= offset + expected.length && expected.every((byte, index) => data[offset + index] === byte)
  const ascii = (offset: number, value: string): boolean => {
    if (data.byteLength < offset + value.length) return false
    for (let index = 0; index < value.length; index += 1) {
      if (data[offset + index] !== value.charCodeAt(index)) return false
    }
    return true
  }
  if (matches(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (matches(0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  return undefined
}

/**
 * Validate the schema-expressible part of a read call.
 * @param args - schema-validated raw arguments.
 * @param defaultLines - the settings line count used when `limit` is omitted.
 * @returns the validated input.
 * @throws NexusError `INVALID_ARGUMENT` for a blank path or an out-of-range window.
 */
function parseReadArgs(args: RawReadArgs, defaultLines: number): ReadInput {
  if (args.path.trim().length === 0) throw new NexusError('INVALID_ARGUMENT', 'path must be a non-empty string')
  const offset = args.offset ?? 1
  if (!Number.isInteger(offset) || offset < 1) throw new NexusError('INVALID_ARGUMENT', 'offset must be a positive integer')
  const limit = args.limit ?? Math.min(defaultLines, FILE_READ_MAX_LINES)
  if (!Number.isInteger(limit) || limit < 1 || limit > FILE_READ_MAX_LINES) {
    throw new NexusError('INVALID_ARGUMENT', `limit must be an integer between 1 and ${FILE_READ_MAX_LINES}`)
  }
  return { path: args.path, offset, limit }
}

/**
 * Enforce that the exact calling route can accept image input.
 * @param ctx - context providing the optional `llm` service.
 * @param exec - current tool execution supplying the calling agent.
 * @param requestedPath - path rendered in refusal messages.
 * @throws NexusError `UNSUPPORTED_CAPABILITY` when the route cannot be resolved or declares no image input.
 */
async function assertImageCapableRoute(ctx: Context, exec: ToolRunContext, requestedPath: string): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot read "${requestedPath}" as an image: the current model route could not be resolved`,
    )
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot read "${requestedPath}" as an image: model "${model}" does not declare image input; switch to an image-capable model to read images`,
    )
  }
}

/**
 * Translate one attachment refusal into an explicit Nexus capability failure.
 *
 * Storage faults (a write that failed, a corrupt durable object) pass through
 * untouched: they are not caller-correctable content problems.
 * @param error - value caught from `saveImage`.
 * @param requestedPath - model-supplied path.
 * @param displayPath - backend-resolved path.
 * @param declared - media type the extension declared, when any.
 * @param mediaType - media type the bytes were identified as.
 * @returns the error to throw.
 */
function translateAttachmentError(
  error: unknown,
  requestedPath: string,
  displayPath: string,
  declared: ImageMediaType | undefined,
  mediaType: ImageMediaType,
): unknown {
  if (!isAttachmentError(error)) return error
  const attachment = error as AttachmentError
  const path = displayPath.length > 0 ? displayPath : requestedPath
  switch (attachment.code) {
    case 'IMAGE_DIMENSION_TOO_LARGE':
      return new NexusError(
        'UNSUPPORTED_CAPABILITY',
        `cannot read "${path}": at least one image side exceeds this deployment's limit; downscale the copy and read it`,
        { cause: error },
      )
    case 'IMAGE_TOO_MANY_PIXELS':
      return new NexusError(
        'UNSUPPORTED_CAPABILITY',
        `cannot read "${path}": the image exceeds this deployment's decoded-pixel limit; downscale the copy and read it`,
        { cause: error },
      )
    case 'IMAGE_TOO_LARGE':
      return new NexusError(
        'UNSUPPORTED_CAPABILITY',
        `cannot read "${path}": the image cannot be stored within this deployment's byte limits; downscale the copy and read it`,
        { cause: error },
      )
    case 'UNSUPPORTED_IMAGE_TYPE':
      return new NexusError(
        'UNSUPPORTED_CAPABILITY',
        `cannot read "${path}": this deployment does not accept ${mediaType} images`,
        { cause: error },
      )
    case 'IMAGE_TYPE_MISMATCH':
      return new NexusError(
        'UNSUPPORTED_CAPABILITY',
        declared === undefined
          ? `cannot read "${path}": the file signature claims ${mediaType}, but the bytes decode as another image format`
          : `cannot read "${path}": the extension declares ${declared}, but the bytes use another image format; rename or convert the file`,
        { cause: error },
      )
    case 'INVALID_IMAGE':
      return new NexusError(
        'UNSUPPORTED_CAPABILITY',
        `cannot read "${path}": the bytes do not decode as a supported PNG/JPEG/WebP/GIF image; the file may be truncated or corrupt`,
        { cause: error },
      )
    default:
      return error
  }
}

/**
 * Read one image through the attachment store and build its result.
 * @param ctx - context providing filesystem, attachments and llm.
 * @param exec - current tool execution.
 * @param target - resolved file target.
 * @param info - metadata captured before the read.
 * @param requestedPath - model-supplied path.
 * @param declared - media type the extension declares, when any.
 * @param extension - lower-cased path extension.
 * @returns the image read result.
 */
async function readImage(
  ctx: Context,
  exec: ToolRunContext,
  target: FsTarget,
  info: FsInfo,
  requestedPath: string,
  declared: ImageMediaType | undefined,
  extension: string,
): Promise<ImageReadResult> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot read "${requestedPath}" as an image: no attachment service is mounted`,
    )
  }
  await assertImageCapableRoute(ctx, exec, requestedPath)
  const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
  const data = await ctx.fs.readBytes(target, exec.signal, byteCap)
  const mediaType = declared ?? sniffImageMediaType(data)
  if (mediaType === undefined) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot read "${target.displayPath}": the file content is not a supported image format; read accepts PNG/JPEG/WebP/GIF`,
    )
  }
  if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
    throw new NexusError(
      'UNSUPPORTED_CAPABILITY',
      `cannot read "${target.displayPath}": ${mediaType} images are not accepted by this deployment${
        extension === '' ? '' : ` (extension ${extension})`
      }`,
    )
  }
  let ref: ImageAttachmentRef
  try {
    ref = await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) })
  } catch (error) {
    throw translateAttachmentError(error, requestedPath, target.displayPath, declared, mediaType)
  }
  recordObservation(ctx, target, { kind: 'present', version: info.version }, exec)
  return {
    kind: 'image',
    path: ctx.fs.processPath(target),
    image: {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...(ref.name === undefined ? {} : { name: ref.name }),
    },
  }
}

/**
 * Format an image read as the model-facing envelope beside its image block.
 * @param displayPath - backend-resolved path.
 * @param image - image metadata.
 * @returns the envelope text.
 */
function formatImageReadOutput(displayPath: string, image: ImageReadValue): string {
  return `<path>${displayPath}</path>\n<type>image</type>\n<content>\n${image.mediaType} image, ${image.width}x${image.height} px, ${image.bytes} bytes\n</content>`
}

/**
 * Register the `read` tool in this scope.
 * @param ctx - registration scope.
 * @param settings - current runtime settings, read at call time.
 * @returns the tool definition.
 */
export function createReadTool(ctx: Context, settings: () => RuntimeSettings): ToolDefinition {
  return defineTool({
    name: 'read',
    description:
      'Read a text file as numbered lines (paginated with offset/limit), or an image file as an actual image attachment.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Path to read, resolved against the session directory by the filesystem backend.',
      },
      offset: {
        type: 'number',
        description: '1-based first line to return. Defaults to 1.',
      },
      limit: {
        type: 'number',
        description: `Maximum number of lines to return. Defaults to the user setting and is capped at ${FILE_READ_MAX_LINES}.`,
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['text'], required: true },
              path: { type: 'string', required: true },
              offset: { type: 'integer', required: true },
              limit: { type: 'integer', required: true },
              lines: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    number: { type: 'integer', required: true },
                    text: { type: 'string', required: true },
                  },
                },
              },
              totalLines: { type: 'integer', required: true },
              nextOffset: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
              truncated: { type: 'boolean', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['image'], required: true },
              path: { type: 'string', required: true },
              image: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  attachmentId: { type: 'string', required: true },
                  mediaType: {
                    type: 'string',
                    enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
                    required: true,
                  },
                  bytes: { type: 'integer', required: true },
                  width: { type: 'integer', required: true },
                  height: { type: 'integer', required: true },
                  name: { type: 'string' },
                },
              },
            },
          },
        ],
      },
      render: (_args, value) => {
        const result = value as unknown as ReadValue
        if (result.kind === 'text') {
          return [{ type: 'text', text: formatTextReadOutput(result.path, toWindow(result)) }]
        }
        return [
          { type: 'text', text: formatImageReadOutput(result.path, result.image) },
          {
            type: 'image',
            attachment: {
              attachmentId: AttachmentId(result.image.attachmentId),
              mediaType: result.image.mediaType,
              bytes: result.image.bytes,
              width: result.image.width,
              height: result.image.height,
              ...(result.image.name === undefined ? {} : { name: result.image.name }),
            },
          },
        ]
      },
      presentationMeta: (_args, value): PresentationMeta => {
        const result = value as unknown as ReadValue
        if (result.kind === 'image') return { path: result.path }
        return {
          path: result.path,
          offset: result.offset,
          lines: result.lines.map(({ number, text }) => ({ number, text })),
          totalLines: result.totalLines,
        }
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      requireOwner(exec)
      const input = parseReadArgs(args, settings().files.defaultLines)
      const target = await resolveTarget(ctx, exec, input.path)
      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) {
        recordObservation(ctx, target, { kind: 'absent' }, exec)
        throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      if (info.type !== 'file') {
        throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
      }

      const declared = imageMediaTypeForPath(input.path)
      const extension = extname(input.path).toLowerCase()
      if (declared !== undefined || extension === '') {
        const prefix = await ctx.fs.readByteRange(target, { offset: 0, length: 16 }, exec.signal)
        if (declared !== undefined || sniffImageMediaType(prefix) !== undefined) {
          return readImage(ctx, exec, target, info, input.path, declared, extension)
        }
      } else if (UNSUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
        throw new NexusError(
          'UNSUPPORTED_CAPABILITY',
          `cannot read "${input.path}": the ${extension} extension does not declare a supported image format; read accepts PNG/JPEG/WebP/GIF`,
        )
      }

      const chunks =
        info.size === undefined || info.size >= STREAM_MIN_SIZE
          ? await ctx.fs.streamText(target, exec.signal)
          : [await ctx.fs.readText(target, exec.signal)]
      const window = await buildTextWindow(
        chunks,
        {
          offset: input.offset,
          limit: input.limit,
          maxLineLength: READ_MAX_LINE_LENGTH,
          maxBytes: settings().files.maxOutputBytes,
        },
        target.displayPath,
      )
      recordObservation(ctx, target, { kind: 'present', version: info.version }, exec)
      return {
        kind: 'text',
        path: ctx.fs.processPath(target),
        offset: window.offset,
        limit: input.limit,
        lines: window.lines.map(({ number, text }) => ({ number, text })),
        totalLines: window.totalLines,
        nextOffset: window.nextOffset,
        truncated: window.truncated,
      } satisfies TextReadValue
    },
  })
}

/**
 * Build the Nexus filesystem tools for one registration scope.
 *
 * This is the suite entry point: it installs the observation gate on the same
 * scope and returns the three definitions for the caller to register.
 * @param ctx - registration scope; the observation gate is installed here.
 * @param settings - current runtime settings, read at call time.
 * @returns the read, write and edit tool definitions.
 */
export function createFsTools(ctx: Context, settings: () => RuntimeSettings): readonly ToolDefinition[] {
  installFsObservationPolicy(ctx)
  return [createReadTool(ctx, settings), createWriteTool(ctx), createEditTool(ctx)]
}

/**
 * Rebuild the pure window shape from a read value.
 * @param value - text branch of a read result.
 * @returns the window used by the formatter.
 */
function toWindow(value: TextReadValue): TextReadWindow {
  return {
    offset: value.offset,
    lines: value.lines,
    totalLines: value.totalLines,
    nextOffset: value.nextOffset,
    truncated: value.truncated,
  }
}
