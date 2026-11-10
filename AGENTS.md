# AGENTS.md — dsh-nexus 项目规则

面向在本仓库工作的编码 Agent。**先读这一页，再动手。**

## 1. 这是什么

`dsh-nexus` 是 DeepSeek Harness（DSH）的一个可安装 bundle，同时提供三层内容：

| 层 | 位置 | 说明 |
|---|---|---|
| host 半 | `src/index.ts`、`src/runtime/`、`src/storage/` | harness 进程内的一行 Loader 条目：存储、运行时、路由、设置 |
| Nexus 预设 | `src/preset/`、`src/prompts/` | `nexus` Agent 预设：6 个工具（`read`/`write`/`edit`/`shell`/`web`/`agent`）+ 系统提示词模块 |
| 浏览器半 | `src/client/` | Web UI 的侧栏面板、页面、设置卡片 |
| 线协议 | `src/protocol.ts` | 两侧共享的 wire 类型 |

```
src/            agent/ client/ fs/ http/ locale/ preset/ prompts/ runtime/ shell/ storage/ web/
test/           与 src 同构；integration/ 与 windows/ 各有一套独立 vitest 配置
scripts/        dev-profile.mjs  pack.mjs  precommit.mjs  verify-runtime.mjs
docs/           plans/（设计与计划）  testing/（验收与证据）
.agents/skills/ 随仓库分发的 DSH 插件开发 skill（见 §10）
lib/            构建产物，**必须随源码提交**（Git 直装消费它）
```

## 2. 复用优先（硬性要求）

**所有功能开发先找原生实现；能复用就复用，不自建平行实现。** 判断顺序是「原生有没有 → 能不能用 → 值不值得自建」，不是「先写自己的再说」。

1. **先清点，再设计。** 动手前列出宿主已经提供什么：包 README 里的 Context 服务、事件、Config；`cordis-composition-reference/references/packages.md` 的包清单；本仓库 `src/` 已有实现。在设计文档或任务说明里写清「复用了哪些原生能力 / 哪部分必须自建」，再写代码。
2. **复用是真调用，不是抄一份。** 复用指直接使用原生服务、事件、工具、UI 座位与持久化（例：`shell` 工具用 `dsh-jobs`/`dsh-terminal`/`dsh-subprocess`/`dsh-shell-env`，`read` 用 `ctx.fs` 与 `dsh-attachment`，存储用 `dsh-storage-domain`）。把原生实现复制进 `src/` 不算复用；缺依赖就补 `inject` 或换原生给的替代路径。
3. **自建必须给出理由并留痕。** 只有满足下面任一条才自建，且要在同一处（代码注释或文档）写明为什么不用原生：
   - 原生**不存在**该能力（宿主没有对应服务/座位/事件）；
   - 原生行为与需求**冲突且无法**通过配置或补丁解决（权限语义、所有权模型、持久化形态等）；
   - 原生接口**实测不可用或不好用**（真实运行失败、错误语义不可接受、表达能力缺失）。
4. **自建时按可扩展、可维护设计。** 挂到已有服务或事件上而不是硬编码单一场景；对外契约（工具参数/输出、wire 类型、patch 行 id）保持向后兼容；新增能力优先做成可组合的模块，而不是给单次需求开洞。
5. **不做无差异的壳。** 如果包一层原生只是为了"看起来更整洁"，却没有行为差异或额外约束，那一层就是负债。
6. **选择要能被复核。** 设计文档里写清「为什么用原生 / 为什么自建 / 放弃的替代方案」；只在 commit message 里提一句不算留痕。

## 3. 命令

```bash
pnpm install            # 首次
pnpm typecheck          # host + client 两套 tsc
pnpm build              # tsdown 产出 lib/
pnpm test               # 默认离线套件（不含 integration/windows）
pnpm test:windows       # 真实 Git Bash / ConPTY / pwsh（Windows 必跑）
pnpm test:integration   # 真实 DSH 服务 + 受控模型提供方
pnpm verify:runtime     # 包身份与接线静态检查
pnpm check              # typecheck + build + test（提交前的完整门）
pnpm pack:plugin        # 先 check，再打 dist/dsh-nexus-<version>.tgz
pnpm dev:profile        # 在项目内 .dev-home 里起一个隔离 profile（不碰日常 profile）
```

**改完源码必须 `pnpm build` 并一起提交 `lib/`。** Git 直装不编译插件，`lib/` 旧了就等于发布旧代码。

## 4. 三个 id 必须一致

```
package.json "name"  ==  cordis.patch.yml 行 id  ==  src/index.ts `export const name`
```

设置卡片的 namespace 就是该行 id。浏览器半的 loader id 也必须等于包名，否则加载时报 `loaded without registering "<id>"`。

## 5. 注册纪律（非可选）

- 所有注册包在 `ctx.effect(fn, label)` 里并返回 disposer；裸 `register()` 会在卸载/热重载后泄漏。
- 绝不注册不是自己声明的 slot（`slots.inject(ownerKey, cb)` 里做）。
- 要改宿主已有控件：用**更低 priority shadow**，不要替换；相同 priority 会抛错。
- slot 的 `inject` 工厂里不许抛异常——抛了会被静默退役一整个页面生命周期；跨界字段一律当可选。
- 命名路由在自己实现里做 loopback / method / body-size 校验，别依赖启动 token。
- 浏览器半不 import 宿主 UI 包；样式只用 `--dsw-alias-*` token；文案走 `src/locale/{zh,en}.json`。

## 6. 工具契约（模型可见）

- **不要用「必填」来表达语义。** 0.1.17 的教训：`shell` 的判据曾经是唯一必填字段，模型要么漏写、要么把命令塞进去；改成「可选 `mode` + 形状优先」后，真实会话 24 次调用 0 次形状错误。新增工具或多动作工具一律按这个方向设计。
- 工具描述只写模型需要的事实；示例要可直接复制成一次调用。
- 改参数/输出契约时，**同一提交内**改对应的契约用例（`test/{shell,agent,web}/*.test.ts`）。
- 输出字段进 `presentationMeta` 前想清楚回放：改键名要给客户端旧键回退（见 `src/client/tool-models.ts` 的 `meta.mode ?? meta.action`）。

## 7. 危险区域（改动前先读，改完必跑 `pnpm test:windows`）

| 区域 | 风险 |
|---|---|
| `src/shell/{jobs,process,terminals,engines}.ts` | 进程/终端所有权、清理确认、沙箱事实；"已清理"不能猜 |
| `src/agent/{tool,coordination,policy}.ts` | 子 Agent 生命周期、写作用域租约、父权限上限 |
| `src/fs/*` | 先读后改、编码/换行保真、用户已有工作保护 |
| `src/runtime/`、`src/http/routes.ts` | 冷路径、权限、路由围栏 |

不可静默降级或提升权限。Windows 受限预设下 Git Bash 可能起不来（MSYS2 `0xC0000022`），工具会要求显式 `engine: "pwsh"`——这是设计，不要加自动 fallback。

## 8. Git 与发布

- 提交前缀：`feat:` / `fix:` / `docs:` / `test:` / `refactor:` / `build:` / `chore:`。
- 不提交：`debug/`、`tmp/`、`dist/`、`.dev-home/`、`.superpowers/`、`node_modules/`、`.pi/`、`docs/superpowers/`。
- 用户未提交的改动属于用户：不覆盖、不 stash、不 reset。
- 提交钩子（可选启用）：`git config core.hooksPath .githooks`，提交前跑 `pnpm check` 并只暂存 `lib/`。

发布流程（0.1.17 起）：

```bash
# 1. bump package.json version（同版本重装是静默空操作，必须 bump）
# 2. 提交 + 推送
git push origin main
# 3. 打 tag 并发 Release
git tag -a vX.Y.Z -m "dsh-nexus X.Y.Z: <一句话>"
git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --title "..." --notes-file <中文说明>
# 4. 安装/升级（固定 tag，避免跟随分支）
dsh plugin --profile <profile> add git+https://github.com/Adcage/dsh-nexus.git#vX.Y.Z
```

`dist/` 里的 tarball 只是本地产物，不是分发渠道。

## 9. 文档

| 我要写… | 放哪 |
|---|---|
| 设计 / 实施计划 | `docs/plans/YYYY-MM-DD-<topic>{,-design,-implementation}.md` |
| 验收清单 / 验证证据 | `docs/testing/` |
| 一次性讨论、会话总结、历史计划 | 不要入库（`docs/superpowers/` 等被 ignore 的本地区域） |

`docs/superpowers/` 与 `.superpowers/` 是**本机历史**（早期规格、编排产物、worktree），被 `.gitignore` 忽略且不跟踪；不要往里放需要入库的文档，也不要把它们搬进 `docs/`。

索引与「DSH 官方文档在哪读」见 `docs/README.md`。

## 10. 外部权威文档

按顺序读，不要凭记忆：

1. `.agents/skills/dsh-plugin-creator/SKILL.md` + `references/`（随仓库分发）。
2. DSH 安装目录里的官方 skills：`<dsh>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/`
   - `cordis-plugin-development/`、`cordis-composition-reference/`（含 `references/packages.md`：全部可安装包 + Loader 方言）、`editing-cordis-compositions/`、`agent-experience/`（写工具定义时读）。
3. 具体包的 `README.md` 就是它的契约（Context 增强、事件、Config）。

> 注意：`dsh-plugin-creator/scripts/dsh-sdk.mjs` 默认读**桌面版** `app.asar`。本机是 CLI 安装（`node_global`），直接读上面的 `node_modules` 路径。

## 11. 验证与如实报告

按层声明你到底验证到哪一步：

1. `pnpm typecheck` / 单元测试
2. `pnpm build` + `pnpm verify:runtime`
3. 真实 profile 组合（`--dump-config` 里有一行 `dsh-nexus`）
4. 真实 DSH 会话（会话日志里 `agentPreset: nexus` + 模型收到的工具 schema）
5. GUI 渲染

上一层的通过**不能**当作下一层的证据。"装上了/entry active" ≠ "面板渲染正确"；本机没有浏览器自动化时，明确写"视觉检查未执行"。
