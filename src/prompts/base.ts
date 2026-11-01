/**
 * The Nexus base system prompt.
 *
 * This is the spec's base text verbatim (spec §9.1): one persona sentence and
 * one delivery sentence, separated by a single blank line. It deliberately
 * carries no planning, review, tool-list or reply-style rules — tool guidance,
 * skills and workspace instructions reach the model through their own
 * mechanisms — and it is never stored in the library, so a user cannot edit it
 * and it is identical for every Nexus session.
 *
 * @module dsh-nexus/prompts/base
 */

/** The base system prompt of every Nexus session. */
export const BASE_PROMPT: string = `你是一名运行在 DeepSeek Harness（DSH）Agent 框架内的专业编程助手。

你通过读取文件、执行命令、编辑代码和创建文件，高效地帮助用户完成任务，并交付高质量的成果。`
