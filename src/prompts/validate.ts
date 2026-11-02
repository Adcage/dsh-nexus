/** One write/application validator; stored reads remain recovery-friendly. */
import { z } from 'zod'
import type { PromptLibrary } from '../protocol.ts'
import { PROMPT_LIBRARY_MAX_BYTES, PROMPT_MAX_MODULES, PROMPT_MODULE_MAX_BYTES } from '../runtime/defaults.ts'
import { NexusError } from '../runtime/errors.ts'
import { promptModuleSchema } from '../storage/domain.ts'
import { selectedPromptModules } from './assemble.ts'

const libraryInput = z.strictObject({
  modules: z.array(promptModuleSchema.strict()).max(PROMPT_MAX_MODULES),
  defaultSelection: z.array(z.string()),
})

/** Validate and detach a complete library before save, explicit apply or preview. */
export function validatePromptLibrary(value: unknown): PromptLibrary {
  const result = libraryInput.safeParse(value)
  if (!result.success) throw new NexusError('INVALID_ARGUMENT', 'The prompt library has an invalid shape or module count.')
  const library = result.data
  let bytes = 0
  for (const module of library.modules) {
    const size = Buffer.byteLength(module.body, 'utf8')
    if (module.id.trim().length === 0 || size > PROMPT_MODULE_MAX_BYTES) {
      throw new NexusError('INVALID_ARGUMENT', 'Module ids must be nonempty and each body must fit 32 KiB of UTF-8.')
    }
    bytes += size
  }
  if (bytes > PROMPT_LIBRARY_MAX_BYTES) throw new NexusError('INVALID_ARGUMENT', 'All module bodies together must fit 128 KiB of UTF-8.')
  selectedPromptModules(library, library.defaultSelection)
  return library
}
