# `shell` 判据改造 实现计划（`action` → 可选 `mode`）

> **REQUIRED SUB-SKILL:** 使用 superpowers:executing-plans 按任务逐个实现。
> 设计依据：`docs/plans/2026-11-10-shell-mode-parameter-design.md`

**Goal:** 让 `shell` 的判据从「必填的 `action` 枚举」变成「可选的 `mode` + 形状优先」，把真实日志里 83/1789（4.6%）只因判据形状失败的调用降到 0，同时保持每个 mode 的字段封闭性。

**Architecture:** schema 层只声明类型与枚举（不声明 required），全部语义判定下沉到工具本体的 `parseShellInput`；`command` 单独出现即等价于 `mode:"run"`；冲突显式报错、不猜测。输出字段与客户端 meta 同步改名，客户端保留 `meta.action` 回退读取以兼容旧会话。

**Tech Stack:** TypeScript、`@deepseek-ai/dsh-tools` 的 `defineTool`（参数编译 + JSON Schema 子集校验）、vitest。

**工作区:** 当前工作区（用户已确认），基线 commit `7e9a8b2`，`test/shell` 181 passed。

---

## Task 1: `shell` 输入判据 —— 改名 `mode`、可选、形状优先

**Files:**
- Modify: `src/shell/tool.ts`（`SHELL_ACTIONS`/`ACTION_FIELDS`/`ShellAction`/各 `*InputArgs` 接口/`parameters`/`description`/`isAction`/`parseShellInput`/`rejectForeignFields`/`runAction`）
- Modify: `test/shell/tool.test.ts`
- Modify: `README.md:116-117`

### Step 1: 先改测试（预期失败）

在 `test/shell/tool.test.ts` 中：

1. 把所有**调用参数**里的 `action:` 改成 `mode:`（`shell.call({ action: 'run', ... })` 等）。
2. 描述断言改新文案：

```ts
  it('describes the command shorthand before the action list and shows a complete run example', async () => {
    const shell = await openShell()
    const schema = shell.harness.ctx.tools.schemas().find((tool) => tool.name === 'shell')
    const introduction = schema?.description.split('Actions:')[0]

    expect(introduction).toContain('{"command":"ls -la"}')
    expect(introduction).toMatch(/the mode is then "run"/i)
    expect(introduction).toMatch(/name the mode only when/i)
  })
```

3. 新增四个契约用例：

```ts
  it('runs a command whose call omits the mode', async () => {
    const shell = await openShell({ script: () => ({ exitCode: 0, stdout: 'hi\n' }) })
    const result = await shell.call({ command: 'echo hi' })
    expect(valueOf(result).action).toBe('run')          // 输出字段本任务不改名
  })

  it('names the contradiction when a command is supplied beside another mode', async () => {
    const shell = await openShell()
    const result = await shell.call({ mode: 'read', command: 'echo hi', resourceId: 'nexus-proc-1' })
    expectCode(result, 'INVALID_ARGUMENT')
    expect(resultText(result)).toContain('"command" only applies to the shell mode "run"')
  })

  it('asks for a mode when only a resourceId is supplied', async () => {
    const shell = await openShell()
    const result = await shell.call({ resourceId: 'nexus-proc-1' })
    expectCode(result, 'INVALID_ARGUMENT')
    expect(resultText(result)).toContain('give "mode" to say what to do with "resourceId"')
  })

  it('explains both call shapes when nothing is supplied', async () => {
    const shell = await openShell()
    const result = await shell.call({})
    expectCode(result, 'INVALID_ARGUMENT')
    expect(resultText(result)).toContain('{"command":"ls -la"}')
  })
```

4. 非法参数矩阵里 `{ action: 'explode' }` 改成 `{ mode: 'explode' }`，仍断言 `INVALID_ARGS`（enum 保留）。

**Run:** `npx vitest run test/shell/tool.test.ts`
**Expected:** 多个用例失败；`runs a command whose call omits the mode` 报 `INVALID_ARGS`（`missing required property "action"`）。

### Step 2: 实现

`src/shell/tool.ts`：

1. 类型与表重命名（机械）：

| 现在 | 改为 |
|---|---|
| `type ShellAction` | `type ShellMode` |
| `SHELL_ACTIONS` | `SHELL_MODES` |
| `ACTION_FIELDS` | `MODE_FIELDS`（表内第一个键 `'action'` → `'mode'`） |
| `isAction()` | `isMode()` |
| `RunInputArgs` / `OpenInputArgs` / … 的 `readonly action:` | `readonly mode:` |
| `ShellInput` 的 `action` 字段 | `mode` |
| `parseShellInput` 各分支返回的 `{ action, ... }` | `{ mode, ... }` |
| `runAction` 的 `switch (input.action)` | `switch (input.mode)` |
| `isConcurrencySafe: (args) => args.action === …` | `args.mode === …` |
| `rejectForeignFields` 文案 | `the "${key}" field is not accepted by the shell mode "${mode}"` |

2. `parameters` 里：

```ts
      mode: {
        type: 'string',
        enum: [...SHELL_MODES],
        description:
          'Optional when "command" is present (it then means "run"). Otherwise names what to do with "resourceId": ' +
          'send, read, status, wait, stop, close; or "open"/"list" without a resource.',
      },
      command: {
        type: 'string',
        description: 'run: the command text; supplying it implies mode "run".',
      },
```

**删除 `required: true`**（`parameters` 因此不再编译出 `required` 数组）。

3. 新增形状解析（放在 `isMode` 之后）：

```ts
/**
 * Resolve the mode one argument object means before any service is touched.
 *
 * A supplied `command` is unambiguous: the caller wants `run`, and naming any
 * other mode beside it is a contradiction rather than something to guess
 * around. Without a command the mode must be explicit, because `resourceId`
 * alone cannot distinguish read from status, wait, stop, close or send.
 */
function resolveMode(record: Record<string, unknown>): ShellMode {
  const declared = record['mode']
  if (declared !== undefined) {
    if (typeof declared !== 'string' || !isMode(declared)) {
      throw invalidArgument(`the shell mode must be one of: ${SHELL_MODES.join(', ')}`)
    }
    if (record['command'] !== undefined && declared !== 'run') {
      throw invalidArgument(`"command" only applies to the shell mode "run"; mode "${declared}" needs its own fields`)
    }
    return declared
  }
  if (record['command'] !== undefined) return 'run'
  if (record['resourceId'] !== undefined) {
    throw invalidArgument('give "mode" to say what to do with "resourceId": send, read, status, wait, stop, close')
  }
  throw invalidArgument(
    'nothing to do: give "command" to run (e.g. {"command":"ls -la"}), or "mode" with "resourceId" to operate on a resource',
  )
}
```

4. `parseShellInput` 开头：

```ts
function parseShellInput(args: unknown): ShellInput {
  const record = asRecord(args)
  const mode = resolveMode(record)
  rejectForeignFields(record, mode)
  switch (mode) {
    // 各分支函数体不变，只把返回对象里的 action 改成 mode
  }
}
```

5. `description` 首两句改为：

```ts
      'Run a command with {"command":"ls -la"}; the mode is then "run". ' +
      'Name the mode only when the call shape does not already say what to do. ' +
```

（其余段落，包含 `Actions: run (…) …` 列表，保持不动。）

6. `README.md:116-117` 两处示例改为：

```jsonc
{ "command": "ls -la", "engine": "bash" }
{ "command": "Get-ChildItem", "engine": "pwsh" }
```

### Step 3: 跑测试

**Run:** `npx vitest run test/shell/tool.test.ts`
**Expected:** 全绿。

### Step 4: 类型检查与提交

```bash
pnpm typecheck
git add src/shell/tool.ts test/shell/tool.test.ts README.md
git commit -m "feat(shell): make the discriminator an optional mode and infer run from command"
```

---

## Task 2: `shell` 输出字段与客户端 meta 改名（兼容旧会话）

**Files:**
- Modify: `src/shell/tool.ts`（`ShellValue.action`、`SHELL_OUTPUT_SCHEMA`、`renderShellValue`、`presentationFor`）
- Modify: `src/client/tool-models.ts:246,322`
- Modify: `test/shell/tool.test.ts`（`meta` 断言、`valueOf(result).action`）
- Test: `test/client/tool-views.test.ts`（新增 `meta.mode` 用例）

### Step 1: 先改测试（预期失败）

1. `test/shell/tool.test.ts` 里 `result.meta` 断言改为：

```ts
expect(startedResult.meta).toMatchObject({ mode: 'run' })
expect(timedResult.meta).toMatchObject({ mode: 'wait', timedOut: true })
```

2. Task 1 的 `expect(valueOf(result).action)` 改为 `expect(valueOf(result).mode)`；文件顶部测试用的 `ShellValue` 接口字段 `action:` → `mode:`。
3. `test/client/tool-views.test.ts` 在 `stopRequested` 用例之后补一个新模式用例：

```ts
    const stoppedByMode = await render(shell, {
      ...recorded('shell', 'result', resultBlock({ content: [], meta: { mode: 'stop', status: 'exited', resourceId: 'proc-7' } })),
      t: (key: keyof typeof zh) => zh[key],
    })
    expect(stoppedByMode.node.querySelector('[data-dsh-nexus-stage="stopRequested"]')).not.toBeNull()
    stoppedByMode.unmount()
```

**Run:** `npx vitest run test/shell/tool.test.ts test/client/tool-views.test.ts`
**Expected:** shell 侧 `meta.mode` 断言失败（实际只有 `action`）；客户端新模式用例失败。

### Step 2: 实现

`src/shell/tool.ts`：

- `interface ShellValue { readonly action: ShellMode … }` → `readonly mode: ShellMode`
- `SHELL_OUTPUT_SCHEMA` 的 `action: required({...})` → `mode: required({...})`
- `renderShellValue` 的 `switch (value.action)` → `switch (value.mode)`
- `presentationFor` 的 `const meta = { action: value.action }` → `{ mode: value.mode }`

`src/client/tool-models.ts`：

```ts
  shell: [['toolFactAction', 'mode'], ['toolFactKind', 'family'], ['toolFactStatus', 'status'], ['toolFactResource', 'resourceId']],
```

```ts
  // 旧会话记录的是 meta.action；新会话记录 meta.mode。两种都认，展示不退化。
  const action = textOf(field(field(block, 'meta'), 'mode')) ?? textOf(field(field(block, 'meta'), 'action'))
```

### Step 3: 跑测试

**Run:** `npx vitest run test/shell test/client`
**Expected:** 全绿（含旧的 `meta.action` fixture 走回退分支）。

### Step 4: 提交

```bash
pnpm typecheck
git add src/shell/tool.ts src/client/tool-models.ts test/shell/tool.test.ts test/client/tool-views.test.ts
git commit -m "feat(shell): report mode instead of action and keep reading legacy meta"
```

---

## Task 3: `agent` batch 的 `mode` → `batchMode`

**Files:**
- Modify: `src/agent/tool.ts`（`ACTION_FIELDS.batch`、`BatchArgs.mode`、`parameters.mode`、`parseAgentInput`、`runBatch` 调用点、描述）
- Modify: `test/agent/internal.test.ts`

### Step 1: 先改测试

`test/agent/internal.test.ts` 的 batch 用例补一条断言：

```ts
    const result = await testCase.call({ action: 'batch', batchMode: 'sequence', tasks: [{ task: 'one' }] })
    expect(valueOf(result).batchMode).toBe('sequence')
```

**Run:** `npx vitest run test/agent/internal.test.ts`
**Expected:** 新用例失败（`batchMode` 是未声明字段，或 batchMode 行为未生效）。

### Step 2: 实现

```ts
  batch: ['action', 'batchMode', 'tasks'],          // ACTION_FIELDS

  interface BatchArgs {
    readonly action: 'batch'
    readonly batchMode: BatchMode                    // 原 mode
    readonly tasks: readonly ChildStartInput[]
  }

  batchMode: {                                       // parameters 里的 mode
    type: 'string',
    enum: ['parallel', 'sequence'],
    description: 'batch only: "parallel" (default) …',
  },

  // parseAgentInput
  const batchMode = args.batchMode ?? 'parallel'
  if (batchMode !== 'parallel' && batchMode !== 'sequence') {
    throw new NexusError('INVALID_ARGUMENT', `batchMode must be "parallel" or "sequence"; received ${JSON.stringify(batchMode)}`)
  }
  return { action: 'batch', batchMode, tasks }

  // 调用点
  return runBatch(runtime, owner, input.batchMode, input.tasks, owner.signal)
```

`description` 中 `batch (up to 8 starts, parallel or sequence)` 末尾补一句：`"batchMode":"sequence"` 才是顺序执行。

### Step 3: 跑测试并提交

```bash
npx vitest run test/agent
pnpm typecheck
git add src/agent/tool.ts test/agent/internal.test.ts
git commit -m "refactor(agent): rename the batch ordering field to batchMode"
```

---

## Task 4: 全量验证

```bash
pnpm typecheck       # 期待：无输出，退出码 0
pnpm build           # 期待：tsdown 产出 lib/，无错误
pnpm test            # 期待：全绿（基线 181 shell 用例 + 新增用例）
pnpm test:windows    # 期待：全绿
```

任一失败都停下来定位，不带着失败提交。

**验收对照**（设计文档 §8）：

1. `{command:'ls -la'}` 一次成功。
2. `mode` 其余 8 个取值行为与改造前逐条一致（现有用例即为回归）。
3. 旧会话 `meta.action` 回放不退化（客户端回退用例）。
4. 四道验证命令全绿。

---

## 回滚

每个任务一个 commit，`git revert <sha>` 即可；无数据迁移、无持久化格式变化。
