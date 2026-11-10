# `shell` 工具判据改造设计：`action` → 可选 `mode`

- 日期：2026-11-10
- 范围：仅 `shell` 工具（`src/shell/tool.ts`）+ `agent` 工具 batch 字段改名 + 客户端兼容读取
- 状态：已实现（见 `2026-11-10-shell-mode-parameter-implementation.md`）

---

## 1. 背景：一份真实会话日志暴露的问题

素材：`debug/dsh-session-session-ae8fbc78-d5ea-4c95-8e68-c231ec135a2c.zip` 解包后的 42 个会话文件，4446 次工具调用事件，345 条错误结果（按 `callId` 去重后 267 次失败调用）。完整统计见 `debug/report/tool-errors.md`。

与本文相关的切片：

- `shell` 共 1789 次唯一调用，其中 **action 类错误 83 次（4.6%）**，是全部错误里最大的单一来源。
- 83 次分两种病理：
  - **49 次漏写 `action`**：每一条都带 `command`（32 条只有 `command`，20 条 `command`+`cwd`，3 条 `command`+`timeoutMs`）。
  - **34 次把命令填进了 `action`**：值是纯命令文本，且**完全没有 `command` 字段**（18 条带 `cwd`，15 条只有 `action`，4 条带 `timeoutMs`，1 条是坏的 `read` 尝试）。
- **83 次的意图 100% 唯一可判定**：82 次是「执行一条命令」，1 次是「读取资源」。
- 代价：93 条 action 类报错中 81 条（87%）下一次调用就改对了，但每一步都是完整的 LLM 往返；全场 2936 个工具 step 里有 **69 个整步报废**直接由该类错误造成。
- 作为对照：`agent` 工具同样是 `action` 必填枚举，323 次调用只有 3 次 action 类错误（0.9%）。

### 机制分析（为什么改名不够，改结构才行）

1. **必填压力**：`action` 是 schema 里唯一的 required 字段。模型想执行命令时，必须往一个字符串字段里填东西；当它的先验里没有 `action` 这个概念时，就把「要做的事」本身填了进去（34 次）。反过来，先验里有 `{command}` 的模型干脆不填 required 字段（49 次）。两种表现是同一个机制的两面。
2. **语义碰撞**：`action` 在中英语境里都读作「要做什么」，而 `command` 读作「命令」。把命令文本塞进 `action`，在语义上是自洽的——这正是 34 次的写法。
3. **schema 层不可拦截**：`invalid arguments:` 这一层校验来自依赖 `@deepseek-ai/dsh-tools`（`lib/types/schema.js:281` 拼文案、`:318` 抛错），并且 `defineTool` 的执行顺序是 `validate(args)` → `userExecute`。只要 `action` 还标着 `required: true`，`{command:"ls"}` 在到达工具本体之前就被拒绝，**任何写在 body 里的容错都不会执行**。本仓库 `package.json` 没有 `pnpm.patchedDependencies`，无法在依赖内部插入归一化。

因此：**想消掉这两类错误，`mode` 不能是 schema 里的 required，全部语义判定必须下沉到工具本体**——而工具本体本来就在做 per-mode 字段封闭（`MODE_FIELDS` 表），这正是判定的正确归属层。

---

## 2. 决策

### D1. 判据改名为 `mode`，并在 schema 中可选

- `action` → `mode`（输入参数名 + 内部类型 + 输出字段，见 D3）。
- 从 `parameters` 中移除 `required: true`：整个 `parameters` 不再有 required 字段。
- **保留 9 值 enum**（已确认）。理由：
  - 34 次「命令填进判据」由必填压力驱动；required 消失后该压力消失，病理大概率随之消失。
  - enum 是模型唯一能看到词表约束的地方；去掉 enum 等于用「可发现性」换一个大概率不发生的场景。
  - 保留 enum 不需要在 body 里再维护一份词表校验，少一处重复真相。

### D2. 形状优先判定（`resolveMode`）

判定顺序（在 `parseShellInput` 最前面执行，先于任何资源访问）：

| 输入形状 | 判定 | 失败文案 |
|---|---|---|
| 有 `command`，无 `mode` | `run` | — |
| 有 `command`，`mode:"run"` | `run` | — |
| 有 `command`，`mode` 为其他合法值 | 拒绝（不猜） | `"command" only applies to the shell mode "run"; mode "read" needs its own fields` |
| 无 `command`，`mode` 明确 | 按该 mode 走现有分支 | 现有各模式的必填检查 |
| 无 `command`、无 `mode`、有 `resourceId` | 拒绝 | `give "mode" to say what to do with "resourceId": send, read, status, wait, stop, close` |
| `command`/`mode`/`resourceId` 都没有 | 拒绝 | `nothing to do: give "command" to run (e.g. {"command":"ls -la"}), or "mode" with "resourceId" to operate on a resource` |

判定出 `mode` 之后，**照旧**执行 `rejectForeignFields(record, mode)` 与各分支的必填/区间检查。「每个 mode 的字段集合封闭」这条不变量完全保留，只是入口多了一层形状解析。

**明确不做隐式猜测**：形状与显式 `mode` 冲突时报错，不按任一方向静默改写。

### D3. 输出字段一并改名，客户端加兼容读取

输入叫 `mode`、输出叫 `action` 会立刻产生认知债，所以输出侧同步改名：

| 位置 | 改动 |
|---|---|
| `src/shell/tool.ts` `ShellValue.action` | → `mode` |
| `SHELL_OUTPUT_SCHEMA.action` | → `mode` |
| `renderShellValue` 的 `switch (value.action)` | → `value.mode` |
| `presentationFor` 的 `meta['action']` | → `meta['mode']` |
| `src/client/tool-models.ts` shell 的 FACT_FIELDS | `['toolFactAction', 'action']` → `['toolFactAction', 'mode']` |
| `src/client/tool-models.ts` `recordedStage` | `meta.action` → `meta.mode ?? meta.action` |

最后一行的回退读取**专为旧会话回放**：历史日志记录的是 `meta.action`，不回退会让老会话丢掉「已记录动作」标签和 `stopRequested` 阶段。`test/client/tool-views.test.ts` 里 `meta: { action: 'run' }` 的 fixture 保留原样，作为兼容守卫用例。

### D4. `agent` 的 batch `mode` → `batchMode`

当前 `agent` 里 `mode` 只用于 `batch` 的 `parallel|sequence`（`src/agent/tool.ts` 的 `ACTION_FIELDS.batch`、`BatchArgs.mode`、`parameters.mode`、`parseAgentInput`），而输出侧早就有 `batchMode`。改名后输入输出一致，并**把 `mode` 这个名字空出来**，避免将来 `agent` 的 `action` 改名时撞车。

`agent` 的 `action` 本轮**不改名、不改必填**：它只有 3 次 action 类错误（0.9%），不在范围内。

### 被否方案

| 方案 | 否决理由 |
|---|---|
| 保留 `required: true`，只加容错 | 技术上不成立：layer-2 先拒绝，body 的容错永远不执行（见 §1 机制 3） |
| 只改描述/报错文案 | layer-2 的文案在依赖里改不了；且无法覆盖 49 次漏写 |
| 判据可选但去掉 enum | 牺牲 schema 级可发现性，换一个 required 消失后大概率不发生的场景；且要在 body 里重复维护词表 |
| 拆工具（run 独立成一个工具） | 需要推翻 `docs/plans/2026-10-31-dsh-nexus-design.md` §5「只提供一个统一的 shell 入口」的决策；`open/send/stop/close/list` 在日志里合计 2 次使用，拆出去收益不足 |
| 参数嵌套 `params` + `oneOf` | DSL 支持（属性值可 `oneOf`），但模型连一层必填都会填错，多一层嵌套的出错率未知、改造面最大 |

---

## 3. 契约规范

### 3.1 schema 草案

```ts
parameters: {
  mode: {
    type: 'string',
    enum: ['run', 'open', 'send', 'read', 'status', 'wait', 'stop', 'close', 'list'],
    description:
      'Optional when "command" is present (implied "run"). Otherwise names what to do with "resourceId": ' +
      'send, read, status, wait, stop, close; or "open"/"list" without a resource.',
  },
  command: {
    type: 'string',
    description: 'run: the command text; supplying it implies mode "run".',
  },
  engine, cwd, background, timeoutMs, resourceId, text, submit, cursor, limit, name   // 不变
}
```

编译结果：`{ type:'object', properties, /* 无 required */ }`。

### 3.2 工具描述（description）改写要点

- 首句从「Every call requires an explicit action; there is no default action」改为「执行一条命令只需要 `{"command":"ls -la"}`，此时 `mode` 隐含为 `run`」。
- 明确「只有在形状不能表达意图时才需要给 `mode`」，并列出资源操作的 6 个 mode 与 `open`/`list`。
- 保留现有全部安全与语义约束段落（输出是数据、空输出不代表完成、cursor 语义等），不改动。

### 3.3 错误面

| 层 | 负责 | 错误码 |
|---|---|---|
| registry（依赖） | 类型、`mode` 枚举、`timeoutMs` 整数 | `INVALID_ARGS` |
| 工具本体 | 形状判定、字段归属、必填、区间、空命令、冲突 | `INVALID_ARGUMENT` |

body 的错误文案必须包含**可复制的示例**，不再出现只有一句 `missing required property` 的情况。

---

## 4. 影响面

| 文件 | 内容 |
|---|---|
| `src/shell/tool.ts` | `SHELL_ACTIONS`→`SHELL_MODES`、`ACTION_FIELDS`→`MODE_FIELDS`、`ShellAction`→`ShellMode`、输入/输出接口、`parseShellInput` + 新增 `resolveMode`、`parameters`、`description`、`isConcurrencySafe`、`runAction` 的 `switch`、`renderShellValue`、`presentationFor` |
| `src/agent/tool.ts` | batch 的 `mode` → `batchMode`（`ACTION_FIELDS`、`BatchArgs`、`parameters`、`parseAgentInput`、`runBatch` 调用点、描述） |
| `src/client/tool-models.ts` | shell FACT_FIELDS 的 meta 键 + `recordedStage` 回退读取 |
| `README.md` | 116-117 行两处 `{"action":"run", ...}` 示例 |
| `test/shell/tool.test.ts` | 现有 `{action:...}` 矩阵改 `{mode:...}`；新增形状优先用例 |
| `test/agent/internal.test.ts` | batch 的 `mode` 断言改 `batchMode` |
| `docs/plans/2026-11-10-shell-mode-parameter-design.md` | 本文 |

**不改**：`web` 工具、`edit`/`read`/`write`、`agent` 的 `action`、`docs/plans/2026-10-31-dsh-nexus-design.md` §5 决策、历史计划文档 `docs/superpowers/plans/2026-11-01-*`。

---

## 5. 兼容性

- **旧调用日志回放**：输入侧无影响（回放不重新执行）。输出侧的 `meta.action` 由客户端的 `??` 回退读取兼容。
- **新调用**：`{mode:'run', command}` 与 `{mode:'read', resourceId}` 等旧写法**继续有效**，行为不变；`mode` 只是从「必填」变成「可选」。
- **`agent` batch**：`{action:'batch', mode:'parallel'}` 这种旧写法将失效（改名 `batchMode`），属于有意的破坏性变更；`agent` 是内部工具，调用方是模型而非外部程序。

---

## 6. 测试计划

新增用例（`test/shell/tool.test.ts`）：

1. `{command:'echo hi'}` → 成功执行（核心回归；改动前报 `INVALID_ARGS`）
2. `{command:'echo hi', cwd, timeoutMs: 5000}` → 成功
3. `{command:'echo hi', mode:'read'}` → `INVALID_ARGUMENT`，文案含 `"command" only applies to mode "run"`
4. `{resourceId:'nexus-proc-1'}`（无 mode）→ `INVALID_ARGUMENT`，文案列出可用 mode
5. `{}` → `INVALID_ARGUMENT`，文案含 `{"command":"ls -la"}` 示例
6. `{mode:'read', resourceId}` / `{mode:'open'}` / `{mode:'list'}` → 行为不变
7. `presentationMeta` 出现 `mode` 而非 `action`
8. 客户端：旧 fixture `meta:{action:'run'}` 仍渲染阶段标签（回退守卫）

需修改的现有用例：`:600-616` 的非法参数矩阵、`:617-633` 的 null/type 矩阵（`{mode:'explode'}` 仍应为 `INVALID_ARGS`，因为 enum 保留）。

验证顺序：`pnpm typecheck` → `pnpm build` → `pnpm test` → `pnpm test:windows`。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 去掉 required 后，出现「完全空调用」直达 body | body 有明确错误文案 + 测试用例 5 |
| 模型给出形状与 `mode` 冲突的组合 | 显式报冲突、不猜测（判定表第 3 行） |
| 输出字段改名导致旧会话展示退化 | 客户端 `meta.mode ?? meta.action` + 兼容守卫用例 |
| 客户端与插件版本不同步（旧客户端 + 新插件） | 回退读取在本仓库客户端内，随插件一起发布；旧客户端读不到 `mode` 时只是少一个标签，不影响功能 |
| 改名面积大导致漏改 | `pnpm typecheck` 会拦住所有 `ShellAction`/`.action` 残留 |

**回滚**：本次改动集中在单个 commit，`git revert` 即可；不涉及数据迁移、不改变持久化格式。

---

## 8. 验收标准

1. `{command:'ls -la'}` 一次成功，无 `INVALID_ARGS`。
2. 日志里对应 A 类错误（漏写判据 / 命令填进判据）在同类真实任务中不再出现。
3. `mode` 的其他 8 个取值的行为与改造前逐条一致。
4. 旧会话回放的动作标签与 `stopRequested` 阶段不退化。
5. `pnpm typecheck`、`pnpm build`、`pnpm test`、`pnpm test:windows` 全绿。
