# 文档索引

本仓库的文档分三类：**入库文档**（随仓库分发）、**本机历史**（被 `.gitignore` 忽略，不入库）、**上游文档**（DSH 官方，在安装目录里，不复制进仓库）。

---

## 1. 入库文档

### 设计与计划（`docs/plans/`）

| 文档 | 讲什么 | 状态 |
|---|---|---|
| [`2026-10-31-dsh-nexus-design.md`](plans/2026-10-31-dsh-nexus-design.md) | 最初的定位、工具方案、终端策略等**讨论记录**（不是最终需求来源） | 历史讨论 |
| [`2026-11-04-git-install-hooks.md`](plans/2026-11-04-git-install-hooks.md) | Git 直装与本地构建钩子的实施计划 | 已完成 |
| [`2026-11-10-shell-mode-parameter-design.md`](plans/2026-11-10-shell-mode-parameter-design.md) | `shell` 判据 `action` → 可选 `mode` 的设计（含证据与取舍） | 已实现 |
| [`2026-11-10-shell-mode-parameter-implementation.md`](plans/2026-11-10-shell-mode-parameter-implementation.md) | 上面那份设计的实施计划与任务拆解 | 已完成 |
| [`2026-11-10-tool-profile-design.md`](plans/2026-11-10-tool-profile-design.md) | 会话级工具开关（档位 + 逐项开关，`ctx.tools.restrict`） | 已实现 |

### 验收与证据（`docs/testing/`）

| 文档 | 讲什么 |
|---|---|
| [`manual-acceptance.md`](testing/manual-acceptance.md) | 真实运行验收手册：隔离实例安装、预设与工具、终端、文件工具等人工核对项 |
| [`verification-record.md`](testing/verification-record.md) | 分层验证记录（含 Task 14 证据与 Windows 受限权限下的已知限制） |
| [`git-install-verification.md`](testing/git-install-verification.md) | Git 直装与提交钩子的验证过程和结论 |

写新文档时遵循 `AGENTS.md` §9：设计与计划进 `docs/plans/`，验收证据进 `docs/testing/`。

---

## 2. 本机历史（不入库）

以下内容被 `.gitignore` 忽略，只存在于本机，**不是**实施依据，也不要往里面放需要入库的文档：

| 路径 | 是什么 |
|---|---|
| `docs/superpowers/specs/2026-11-05-session-branches-design.md` | 会话分支功能设计规格（对应未合并的 `feat/session-branches`） |
| `docs/superpowers/plans/2026-11-05-session-branches-implementation.md` | 上面那份规格的实施计划 |
| `.superpowers/orchestration/`、`.superpowers/sdd/` | 子 Agent 编排产物、任务证据 |
| `.superpowers/worktrees/` | 本地分支 worktree（含未合并的 `feat/session-branches`） |
| `.pi/` | 本机编码 Agent 配置（含 `nexus-deepseek-runtime` 子 Agent 定义） |

早期那批记录（核心功能规格、自由装配扩展设计、0.1.x 实施计划）已按项目决定**删除**。它们只存在于 Git 历史里，需要追溯时用：

```bash
git show a1f587c^:docs/superpowers/specs/2026-10-31-dsh-nexus-design.md
git show a1f587c^:docs/superpowers/plans/2026-11-01-dsh-nexus-implementation.md
```

---

## 3. 上游文档：DSH 官方与插件开发

**先读项目内随仓库分发的 skill，再读 DSH 安装目录里的官方文档。**

### 3.1 项目内 skill（已入库）

`.agents/skills/dsh-plugin-creator/`

| 文件 | 什么时候读 |
|---|---|
| `SKILL.md` | 新建/修改插件、bundle、panel、设置卡片、工具、后台策略、HTTP API |
| `references/host-half.md` | 写 host 半：导出、`ctx.effect`、schemastery Config、事件、路由、工具 |
| `references/client-half.md` | 写浏览器半：bundle 形式、清单、slot、注入、样式 |
| `references/surfaces.md` | 选 surface、查 UI 座位与扩展点 |
| `references/replacing-shipped-ui.md` | 修改宿主已有控件（shadow 规则） |
| `references/packaging.md` | 清单字段、patch 行、安装与分发、fork |
| `references/verification.md` | 决定测什么，以及测试**不能**证明什么 |
| `scripts/new-plugin.sh` + `assets/plugin-template/` | 脚手架与可运行模板 |

### 3.2 DSH 安装目录里的官方 skill

路径前缀（CLI 安装）：

```
<dsh 安装目录>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/
```

| skill | 内容 |
|---|---|
| `cordis-plugin-development/` | 插件/bundle/页面/工具/MCP 的设计与排错总纲 |
| `cordis-composition-reference/` | Loader YAML 方言（insert / override by id / group / disabled / isolate / `!!js`）+ `references/packages.md`：全部可安装包及各自提供什么 |
| `editing-cordis-compositions/` | 写/改 agent preset，判断 host 还是 preset，验证能挂载 |
| `agent-experience/` | 写模型可见的工具定义（名字、描述、参数 schema）与 skill/上下文设计 |

### 3.3 包 README 就是契约

每个 `@deepseek-ai/*` 包的 `README.md` 记录它暴露的 Context 服务、事件及分发方式、Config 字段。

> ⚠️ `dsh-plugin-creator/scripts/dsh-sdk.mjs` 默认读**桌面版** `app.asar`。本机是 CLI 安装（`node_global`），该脚本会 `ENOENT`；直接读上面的 `node_modules` 路径即可。

---

## 4. 其他

- 项目规则： [`../AGENTS.md`](../AGENTS.md)
- 面向使用者的安装/配置说明： [`../README.md`](../README.md)
