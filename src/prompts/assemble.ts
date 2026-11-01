/**
 * Literal assembly of the base prompt and the selected module bodies.
 *
 * The persona is one piece of prompt text: the base paragraphs followed by each
 * selected body in selection order, separated by one blank line. Nothing is
 * trimmed, evaluated, or interpolated, so a body that mentions `{{variable}}`
 * or `${HOME}` reaches the model exactly as the user wrote it. Module NAMES are
 * console labels and never enter the text.
 *
 * Assembly validates references only — it refuses a repeated selection id, an
 * id the library does not hold, and a library that holds one id twice (choosing
 * one of two would be ambiguous). Module count and byte limits belong to the
 * one library validator that the console save/apply/preview path (Task 10) owns,
 * so limits are not duplicated in this seam.
 *
 * @module dsh-nexus/prompts/assemble
 */

import type { PromptLibrary, PromptModule } from '../protocol.ts'
import { NexusError } from '../runtime/errors.ts'
import { BASE_PROMPT } from './base.ts'

/** Text placed between the base prompt and each selected body. */
const PART_SEPARATOR = '\n\n'

/**
 * Index one library's modules by id, refusing an ambiguous record.
 * @param library - the library to index.
 * @returns the module for each id.
 * @throws NexusError `INVALID_ARGUMENT` when one id is held twice.
 */
function indexLibrary(library: PromptLibrary): Map<string, PromptModule> {
  const byId = new Map<string, PromptModule>()
  for (const module of library.modules) {
    if (byId.has(module.id)) {
      throw new NexusError(
        'INVALID_ARGUMENT',
        `the prompt library holds more than one module with id "${module.id}"; refusing to guess which body the selection means`,
      )
    }
    byId.set(module.id, module)
  }
  return byId
}

/**
 * Resolve a selection against a library, in selection order.
 * @param library - the library to resolve against.
 * @param selection - module ids in assembly order.
 * @returns the selected modules, in selection order.
 * @throws NexusError `INVALID_ARGUMENT` for a repeated, unknown or ambiguous id.
 */
export function selectedPromptModules(library: PromptLibrary, selection: readonly string[]): readonly PromptModule[] {
  const byId = indexLibrary(library)
  const chosen: PromptModule[] = []
  const seen = new Set<string>()
  for (const id of selection) {
    if (seen.has(id)) {
      throw new NexusError('INVALID_ARGUMENT', `the selection names module "${id}" more than once`)
    }
    seen.add(id)
    const module = byId.get(id)
    if (module === undefined) {
      throw new NexusError('INVALID_ARGUMENT', `the selection names module "${id}", which the prompt library does not hold`)
    }
    chosen.push(module)
  }
  return chosen
}

/**
 * Compose the prompt text of already captured modules.
 *
 * A snapshot renders from its own captured bodies, so a later library edit or
 * deletion cannot change text that was already assembled.
 * @param modules - selected modules in assembly order.
 * @returns the base prompt followed by each body.
 */
export function composePromptText(modules: readonly PromptModule[]): string {
  if (modules.length === 0) return BASE_PROMPT
  return [BASE_PROMPT, ...modules.map((module) => module.body)].join(PART_SEPARATOR)
}

/**
 * Assemble the system prompt for one selection of one library.
 * @param library - the library to read bodies from.
 * @param selection - module ids in assembly order.
 * @returns the literal prompt text.
 * @throws NexusError `INVALID_ARGUMENT` for a repeated, unknown or ambiguous id.
 */
export function assemblePrompt(library: PromptLibrary, selection: readonly string[]): string {
  return composePromptText(selectedPromptModules(library, selection))
}
