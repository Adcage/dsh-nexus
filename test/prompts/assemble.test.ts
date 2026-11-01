/**
 * The literal assembly contract of the Nexus persona (PR-02, PR-06…PR-08).
 *
 * These cases are pure unit checks over the real exported functions: the base
 * text is the spec's verbatim pair of paragraphs, selected bodies follow in
 * selection order separated by exactly one blank line, and nothing is
 * trimmed, interpolated or evaluated. The proof that the result reaches the
 * model as a native system layer lives in `request.test.ts`.
 *
 * @module dsh-nexus/test/prompts/assemble
 */

import { describe, expect, it } from 'vitest'
import type { PromptLibrary, PromptModule } from '../../src/protocol.ts'
import { assemblePrompt, composePromptText, selectedPromptModules } from '../../src/prompts/assemble.ts'
import { BASE_PROMPT } from '../../src/prompts/base.ts'

/** The base text exactly as the spec states it: two paragraphs, one blank line. */
const SPEC_BASE = `你是一名运行在 DeepSeek Harness（DSH）Agent 框架内的专业编程助手。

你通过读取文件、执行命令、编辑代码和创建文件，高效地帮助用户完成任务，并交付高质量的成果。`

/**
 * Build a library record from inline modules.
 * @param modules - modules in library order.
 * @param defaultSelection - default selection ids.
 * @returns the library record.
 */
function libraryOf(modules: readonly PromptModule[], defaultSelection: readonly string[] = []): PromptLibrary {
  return { modules, defaultSelection }
}

/**
 * Run a call that must be refused and return its Nexus error code.
 * @param run - call expected to throw.
 * @returns the error code, or `undefined` when the call succeeded.
 */
function failureCode(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return (error as { code?: unknown }).code
  }
  return undefined
}

describe('the Nexus base prompt', () => {
  it('is exactly the spec text, with no extra behaviour rules', () => {
    expect(BASE_PROMPT).toBe(SPEC_BASE)
    expect(BASE_PROMPT).not.toContain('AGENTS.md')
    expect(BASE_PROMPT).not.toContain('{{')
  })
})

describe('assemblePrompt', () => {
  it('appends selected bodies in selection order with one blank line between parts', () => {
    const library = libraryOf([
      { id: 'first', name: 'First', body: 'FIRST BODY' },
      { id: 'second', name: 'Second', body: 'SECOND BODY' },
    ])
    expect(assemblePrompt(library, ['second', 'first'])).toBe(
      `${SPEC_BASE}\n\nSECOND BODY\n\nFIRST BODY`,
    )
  })

  it('keeps placeholders, shell variables and user whitespace byte for byte', () => {
    const body = '  Use {{secret}} and ${HOME} literally.\n\n  Indented tail.\n'
    const library = libraryOf([{ id: 'literal', name: 'Literal', body }])
    const text = assemblePrompt(library, ['literal'])
    expect(text).toBe(`${SPEC_BASE}\n\n${body}`)
    expect(text).toContain('{{secret}}')
    expect(text).toContain('${HOME}')
    expect(text.endsWith(body)).toBe(true)
  })

  it('is the base prompt alone when nothing is selected', () => {
    expect(assemblePrompt(libraryOf([]), [])).toBe(SPEC_BASE)
  })

  it('refuses a selection that names one module twice', () => {
    const library = libraryOf([{ id: 'a', name: 'A', body: 'A' }])
    expect(failureCode(() => assemblePrompt(library, ['a', 'a']))).toBe('INVALID_ARGUMENT')
  })

  it('refuses a selection id the library does not hold', () => {
    const library = libraryOf([{ id: 'a', name: 'A', body: 'A' }])
    expect(failureCode(() => assemblePrompt(library, ['missing']))).toBe('INVALID_ARGUMENT')
  })

  it('refuses an ambiguous library instead of choosing one of two equal ids', () => {
    const library = libraryOf([
      { id: 'a', name: 'A one', body: 'FIRST' },
      { id: 'a', name: 'A two', body: 'SECOND' },
    ])
    expect(failureCode(() => assemblePrompt(library, ['a']))).toBe('INVALID_ARGUMENT')
  })
})

describe('selectedPromptModules', () => {
  it('returns the selected modules in selection order for a snapshot capture', () => {
    const library = libraryOf([
      { id: 'a', name: 'A', body: 'A BODY' },
      { id: 'b', name: 'B', body: 'B BODY' },
    ])
    expect(selectedPromptModules(library, ['b', 'a']).map((module) => module.id)).toEqual(['b', 'a'])
  })
})

describe('composePromptText', () => {
  it('composes already captured bodies without consulting a library', () => {
    expect(composePromptText([{ id: 'gone', name: 'Gone', body: 'CAPTURED' }])).toBe(`${SPEC_BASE}\n\nCAPTURED`)
  })
})
