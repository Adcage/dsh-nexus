/**
 * The Nexus failure vocabulary, carried on DSH's standard error channel.
 *
 * Every Nexus failure is a {@link HarnessError} subclass so the tool registry's
 * `isError` result keeps `{ name, code }` for retry, permission and UI layers
 * without anyone parsing a message. The codes are the stable contract from the
 * plan's shared section; a native failure (for example `FsError`) is never
 * rewrapped, so its own code and reason reach the caller unchanged.
 *
 * @module dsh-nexus/runtime/errors
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable machine-routable failure classes raised by this package. */
export type NexusErrorCode =
  | 'NO_AGENT'
  | 'INVALID_ARGUMENT'
  | 'NOT_OBSERVED'
  | 'FILE_CHANGED'
  | 'AMBIGUOUS_EDIT'
  | 'OVERLAPPING_EDITS'
  | 'UNSUPPORTED_ENCODING'
  | 'SHELL_UNAVAILABLE'
  | 'RESOURCE_NOT_AVAILABLE'
  | 'OUTPUT_LOST'
  | 'WRITE_SCOPE_BUSY'
  | 'CONFIG_CONFLICT'
  | 'UNSUPPORTED_CAPABILITY'

/**
 * One Nexus failure. The class name is the reported `name`, so callers can tell
 * a Nexus decision from a native service error that passed through.
 */
export class NexusError extends HarnessError {
  /** Narrowed from the inherited `string` to the documented vocabulary. */
  declare readonly code: NexusErrorCode

  /**
   * @param code - stable failure class from {@link NexusErrorCode}.
   * @param message - model-facing explanation, never a stack trace.
   * @param options - standard error options (`cause`).
   */
  constructor(code: NexusErrorCode, message: string, options?: ErrorOptions) {
    super(message, code, options)
  }
}
