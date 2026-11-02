# 验证记录（Task 14 最终验收）

本文按「静态 → 离线行为 → 构建 bundle → 隔离组合 → 真实安装 → 真实 GUI／账号」分层记录**实际执行过**的验证。每一行都写明命令或操作、版本、结果，以及没有验证的原因。没有执行的项一律写「未验证」，不用替身、模拟页面或推测填补。

- 仓库：`E:/Programme/Project/dsh-nexus`，分支 `dev/nexus-core`
- 包版本：`dsh-nexus` 0.1.1；目标运行时 DSH `0.2.1-rc.2`
- 安装产物：`dist/dsh-nexus-0.1.1.tgz`（455,568 字节，15 个成员，SHA-256 `46779344b6fda34703ebcd5798d2b84a482dd5f2b7e2d9759f54bb5750220b29`）；0.1.0 的旧产物保留在 `dist/` 仅作历史，不再安装
- 执行环境：Windows `win32`，Node v24.22.0，pnpm 10.18.1，Git for Windows 2.48.1（bash 5.2.37 x86_64-pc-msys），PowerShell 7

本文不含凭据、令牌、私有对话内容或环境快照。

## 1. 静态与构建

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 包身份／patch 行／client 注册／脚本接线 | `pnpm verify:runtime` | 通过；`manifest, patch row and client bundle agree` |
| 宿主 + 浏览器类型检查 | `pnpm typecheck`（`pnpm check` 第一步） | 通过 |
| 三入口构建 | `pnpm build`（9 个产物，含 `lib/index.js`、`lib/client.js`、`lib/preset/index.js`） | 通过 |
| 打包内容检查 | `pnpm pack:plugin`（现在先跑 `pnpm run check`，再打包并校验成员） | 通过；15 个成员，`package.json`、`cordis.patch.yml`、`README.md`、`LICENSE`、`lib/index.js`、`lib/client.js`、`lib/preset/index.js` 均在包内，无未声明根目录，也没有「声明了但仓库里没有」的条目 |

## 2. 离线行为

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 默认离线套件 | `pnpm test`（`pnpm pack:plugin` → `pnpm run check` 内） | 41 个文件 / 581 个测试通过 |
| 新增：受限 Git Bash 拒绝分类（5 个回归 + 1 个诊断回归） | `npx vitest run test/shell/process.test.ts` | 28 个测试通过（命中特征、普通非零退出不命中、未受限不命中、pwsh 不命中、非 Windows 不命中，加一条：进程退出状态为 `3221225506`（`0xC0000022`）且 stderr 相同时**不**命中；诊断断言进程状态与 `0xC0000142`、stderr API 错误 `0xC0000022` 分别标注） |
| 新增：工具管线上的受限 Git Bash 拒绝 | `npx vitest run test/shell/tool.test.ts` | 28 个测试通过（`UNSUPPORTED_CAPABILITY`，消息含原始状态码与 `pwsh` 提示） |
| 新增：PID 存活语义 | `npx vitest run test/support/pid-liveness.test.ts` | 5 个测试通过（只有 `ESRCH` 表示不存在；`EPERM` 仍算存活；其它错误显式报「不确定」而不是「已消失」） |
| 新增：生成域退役时仍有打开的终端 | `npx vitest run --config vitest.integration.config.ts test/integration/terminal-scope.test.ts` | 4 个测试通过（含退役场景：无显式 close 时退役生成域，旧 `resourceId` 在新生成域与宿主行重启后都不可用，兄弟实例无后端、无宿主级 `terminals`） |

> 证据保留说明：受限 Git Bash 拒绝的**首次失败日志没有保留**（最早的 `task14-check-*.log` 已经是全绿的 27/28）。「BASE 上没有这个导出」是静态事实，不等于一次执行过的行为 RED；这里不重建历史。本波新增的诊断回归保留了首次失败：`tmp/task14fix2-p1-red.log`（消息缺 `0xC0000142`，exit 1）与 `tmp/task14fix2-pid-red.log`（`EPERM` 被当成消失、意外错误被吞，exit 1）。

## 3. 集成（真实 Cordis 组合、受控模型边界）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 集成套件 | `pnpm test:integration` | 5 个文件 / 16 个测试通过（原 12 个 + 新增 4 个），exit 0 |
| 真实 profile 形状下的终端能力 | `test/integration/terminal-scope.test.ts` | 4 个测试通过：无宿主级 `terminals` 时六个工具与 persona 正常激活；`standard` 形状的兄弟实例 `listBackends()` 保持为空；`open/send/read/close` 使用生成域后端；退役时仍有打开的终端，旧 `resourceId` 在新生成域与宿主行重启后都不可用（脚本化 PTY 边界，真实 OS 证据见 §4） |

集成套件的边界（不变）：模型传输是受控替身；进程派生与终端派生在该套件里是脚本化提供方（真实 ConPTY／真实 Git Bash 证据见下一节）。

## 4. Windows 专项（真实操作系统）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| Windows 验收套件 | `pnpm test:windows`（`vitest.windows.config.ts` → `test/integration/windows.test.ts`） | 13 个测试通过，exit 0 |
| 覆盖 | 同上 | 真实 Git Bash 与真实 PowerShell 7 两种方言；中文与空格路径（参数 `你好 世界` 原样、`pwd` 回到同一目录）；非零退出码如实报告；不可用 bash 路径 `SHELL_UNAVAILABLE` 且不换引擎；Windows PowerShell 5.1 被拒绝；取消后真实 Windows 子进程从进程表消失；超时后同样消失；父进程被停后孙进程（真实 Windows PID）消失且 `cleanupConfirmed`；真实后台任务可 list／stop／close；真实 ConPTY 持久终端跨 `send` 保留 shell 状态并可 `close` |
| 生成域 PTY 清理（新增） | 同上 | 按 `src/preset/index.ts` 的挂载顺序（`isolate('terminals')` → 挂载 native registry → 注册后端 → 建 shell surface）在一个插件 fiber 内挂载；打开真实 ConPTY 后由 shell 自己通过 `/proc/$$/winpid` 报告真实 Windows PID 并确认存活；**不先 close** 直接退役该生成域，随后该 PID 从进程表消失、宿主级 `terminals` 始终不存在、工具注册消失 |
| 清理断言灵敏度（新增） | 同上 | `assertServicesRemoved` 对仍存活的 service 会抛错（不是空断言）；每个用例结束后立即卸载自己的 fixture，`afterAll` 只作兜底——之前 11 个 fixture 累积导致的 `MaxListenersExceededWarning` 不再出现 |
| 非 Windows 主机 | 同上 | 文件在收集阶段显式报错拒绝，不跳过记成通过 |

### 4.1 受限权限链（AC-07 的受限证据：环境阻塞，未验证）

真实 DSH `web` Profile 的权限链是 `dsh-sandbox-local`（win32 链 = `windows-acl` 受限令牌）+ `sandbox-policy`（`DSH_PERMISSION_MODE ?? 'workspace-write'`）。在该链下 **Git Bash（MSYS2）无法启动**：

```
node <dsh>/lib/runner.js --workspace "<dir>" --temp "<dir>" --mode read-only|workspace-write \
  -- "E:\Programme\software\Git\usr\bin\bash.exe" --noprofile --norc -c "echo confined-ok"
→ 进程退出状态 `3221225794`（`0xC0000142`，`STATUS_DLL_INIT_FAILED`）
→ stderr: bash (…): *** fatal error - NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-…): 0xC0000022（这是 Win32 API 错误 `STATUS_ACCESS_DENIED`，与上面的进程退出状态是两个不同的量）
```

- 与模式（read-only / workspace-write）、cwd、TMP、命令内容无关；`TMPDIR` 覆盖无效。
- 对照组：同一条 provider argv 换成 `C:\Program Files\PowerShell\7\pwsh.exe` 退出码 0；`workspace-write` 下工作区内写入成功，工作区外写入被拒（`Access to the path '…' is denied`，文件不存在）。
- 未受限 bash 正常：退出码 0，中文 + 空格路径原样。
- 结论：这是 MSYS2 运行时与受限令牌的环境级不兼容，不是命令失败。产品现在的行为是在四个事实同时成立时（win32 + bash + 确实应用了受限策略 + 进程退出状态 `3221225794` 且 stderr 命中 `BaseNamedObjects…msys-` 与 `0xC0000022`）以 `UNSUPPORTED_CAPABILITY` 明确拒绝；消息分别标注进程退出状态与它自己的十六进制（`0xC0000142`）、stderr 中的 API 错误（`0xC0000022`）以及有限 stderr 片段，并提示可显式改用 `engine: "pwsh"`，不静默换引擎、不提高权限。**只有前台 `shell run` 走到这条分类**；后台运行的完成报告给原始状态与 stderr，持久终端 `open` 不使用它。
- 因此 **AC-07 的「受限只读／越根写入被拒绝」没有在 Git Bash 上验证**：标记为环境阻塞。受限链路本身可用由 pwsh 对照组证明。

## 5. 隔离 Profile（项目内 `.dev-home`）

| 项 | 操作 | 结果 |
| --- | --- | --- |
| 安装产物 | `node scripts/dev-profile.mjs init`（安装 `dist/dsh-nexus-0.1.0.tgz`，不启动服务） | 成功；`installed … into profile "nexus-dev"` |
| 组合行 | `node scripts/dev-profile.mjs dump` | `- id: dsh-nexus` / `name: dsh-nexus`，单条 |
| 真实启动 | `node scripts/dev-profile.mjs boot --port 19499` | 监听 127.0.0.1:19499（PID 27360，已停止） |
| 页面与 client bundle | `GET /`（先做 launch-token 交换） | 200；页面 preload 含 `plugins/??dsh-nexus/client.js`；该组合包 200 / 212,750 字节，首行 `window.__ModuleLoader__.load({ id: "dsh-nexus"` |
| 带护栏 API | `GET /api/dsh-nexus/capabilities|library|sessions` | 200；`registered.consoleApi=true`、`registered.nexusRuntime=true`；`library` 返回空库与 hash；`sessions` 返回 `[]`（还没有 Nexus 会话） |
| 护栏拒绝 | 同路径带 `Origin: https://evil.invalid` | 403 |

## 6. 真实日常 Profile（`web`，用户明确授权）

| 项 | 操作 | 结果 |
| --- | --- | --- |
| 官方安装命令（0.1.0） | `dsh plugin --profile web add E:/Programme/Project/dsh-nexus/dist/dsh-nexus-0.1.0.tgz` | 成功；`dependencies` 增加 `"dsh-nexus": "file:…/0.1.0.tgz"`，`dsh.profile.bundles` 追加 `dsh-nexus` |
| 官方安装命令（0.1.1 重装） | `dsh plugin --profile web add E:/Programme/Project/dsh-nexus/dist/dsh-nexus-0.1.1.tgz` | 成功；spec 更新为 `file:…/0.1.1.tgz`，`node_modules/dsh-nexus` 版本 0.1.1，`bundles` 23 条（用户原有 22 + `dsh-nexus`），只有一条 `dsh-nexus` |
| 安装告警 | 两次安装输出 | pnpm peer 警告：`dsh-nexus` 的 `@deepseek-ai/*` peer 在 profile 目录里「missing peer」——运行时由 DSH 安装目录提供，不是失败；未手改 Profile 文件 |
| 组合行 | `dsh --profile web --dump-config` | `- id: dsh-nexus` / `name: dsh-nexus`，单条 |
| 真实启动 | `dsh --profile web --no-open --port 19500` | 监听 127.0.0.1:19500；0.1.0 验证 PID 29060、0.1.1 验证 PID 73368，两次都由我停止 |
| 页面与 client bundle | `GET /` 后取该组合包 | 200；页面 preload 含 `dsh-nexus/client.js`；组合包 200 / 212,750 字节，首行 `window.__ModuleLoader__.load({ id: "dsh-nexus"` |
| 带护栏 API | `GET /api/dsh-nexus/capabilities|library|sessions` | 200；`registered.nexusRuntime=true`；`library` 空库；`sessions` 在创建会话前 `[]`、创建后列出该会话；跨站 `Origin` 404/403 被拒 |
| 启动日志 | 两次 boot 输出 | 没有 dsh-nexus 相关错误；日志里的 `usage-billing` 警告来自用户已装第三方插件读取历史会话，与本插件无关 |
| 其他会话 | boot 前后 | 启动前无 DSH 进程；只启动并停止了本次 PID，未中断其他会话 |

### 6.1 安装的依赖变化（披露）

安装 0.1.0 时 pnpm 报告 `Packages: +5 -2`，重装 0.1.1 时报告 `Packages: +1 -2`。逐项核对如下：

- `+5` = `dsh-nexus` 本身加它的四个运行期依赖 `turndown`、`@joplin/turndown-plugin-gfm`、`@mixmark-io/domino`、`zod`（重装时这四项已在，只有 `+1` 个新 tarball）。
- `-2` 的身份**无法从保留的日志确定**：pnpm 只打印了计数。可以肯定的是——安装后 `dsh plugin --profile web list` 显示 21 条声明依赖全部在位，逐条检查 `node_modules/<name>/package.json` 也是 21/21 存在、0 缺失，原有 23 条 bundle 声明里 `dsh-nexus` 只有一条——但这**不**证明被移除/改动的传递包身份，也**不**证明其它每个插件仍可正常工作（没有做 store/家目录审计，也不改 Profile）。
- 本波的 0.1.2 重装沿用同一命令，安装输出与核对结果记在 §6 与报告中。

### 6.2 真实 Nexus 会话（无模型、无账号）

在不发送任何消息、因此不产生模型请求的前提下，用应用自己的 session-controller 接口创建 Nexus 会话并读回（脚本 `tmp/task14fix1-nexus-session.mjs`，本地产物，未提交；0.1.0 与 0.1.1 各跑一次，结果一致）：

| 步骤 | 调用 | 观察 |
| --- | --- | --- |
| 1 | `GET /?token=…`（启动令牌换 Cookie） | 303，取得浏览器 Cookie |
| 2 | `POST /api/session/create`，payload `{args:{request:{cwd:"…/tmp/task14fix1-workspace", agentPreset:"nexus"}}}` | `{"sessionId":"session-…","agentPreset":"nexus"}`——应用自己确认该会话按 `nexus` 预设创建 |
| 3 | `GET /api/dsh-nexus/sessions` | 200，列出该会话 id——产品自身的 `runtime.isNexusAgent` 为真，说明 **Nexus 预设行已激活并登记了这个 Agent** |
| 4 | `GET /api/dsh-nexus/sessions/<id>/prompt` | 200，返回该会话的提示词快照，正文即 Nexus persona 原文（`你是一名运行在 DeepSeek Harness（DSH）…`） |
| 5 | `POST /api/pluginInventory/list` | `dsh-nexus` 宿主行 `fiberPhase: "active"`；`nexus` 预设组合里 `dsh-nexus/preset` 以及 `agent-instructions`、`skill-filesystem`、`tool-skill`、`tool-ask-user`、`tool-todo`、三个压缩模块全部 `fiberPhase: "active"` |
| 6 | `POST /api/session/list` | 该会话 `blank: true`、`running: false`，`cwd` 是本次临时工作区 |
| 7 | `POST /api/session/projections` | 原生投影 `agentPreset: "nexus"`、`permissions.currentValue: "danger-full-access"`（未改动用户权限预设） |
| 8 | `POST /api/session/cancel` | `{"accepted":true}`；随后停掉应用，并删除本次探针创建的空白会话目录（`~/.dsh/sessions/--E-Programme-Project-dsh-nexus-tmp-task14fix1-workspace--/`，只含这两次探针的会话） |

这一步证明了「组合行存在」之外的关键事实：**安装后的真实 Profile 里，Nexus 预设生成域确实激活、登记了会话、并提供了 persona 提示词**。

同一模型无关探针**不能**证明六件工具名与「请求中实际出现的系统层」：那两者只在一次真实请求（模型调用，使用用户账号）或 GUI 中可见，见 §8。

## 7. 逐 AC 结论

| AC | 证据 | 结论 |
| --- | --- | --- |
| AC-01 | tarball 成员检查；隔离与真实 Profile 的 `dsh-nexus` 组合行；预设只新增 `nexus`（集成测试断言 `standard` 未改） | 已验证（安装与组合） |
| AC-02 | 集成：真实定义、同 scope 六工具、第三方同名工具并存可调用；§6.2：安装后的真实 Profile 里用 `session/create` 建 Nexus 会话，`/api/dsh-nexus/sessions`、`/prompt`、`pluginInventory` 都证明预设行与生成域已激活 | 已验证到「生成域激活 + persona 快照」；**六个工具名的运行时清单未验证**：无只读接口可枚举某个生成域的工具 schema，观察它们需要一次真实模型请求或 GUI 目视，列入 §8 用户步骤 |
| AC-03 | 离线行为测试（分页、图片附件、目标模型能力检查） | 已验证（测试层）。真实模型送图的实机效果：**未验证**（需要用户账号与实际模型） |
| AC-04 | 离线行为测试（观察守卫、多处编辑、字节/原子失败） | 已验证（测试层） |
| AC-05 | 离线 + Windows 真实 ConPTY（持久状态）与普通命令（独立状态）对照 | 已验证（含真实 ConPTY） |
| AC-06 | 离线行为（续读游标、停止清理）+ Windows 真实后台任务与真实树清理 | 已验证 |
| AC-07 | Windows 两种方言、中文/空格路径、真实树清理通过；受限只读/越根写入未能在 Git Bash 上验证（第 4.1 节，环境阻塞），受限链路由 pwsh 对照组证明；命名拒绝只覆盖前台 `run` | 部分验证 + 部分**环境阻塞** |
| AC-08 | 集成：当前配置的后端请求组装；未接后端时明确失败 | 已验证（测试层）。真实联网账号：**未验证**，未使用用户账号发起请求 |
| AC-09 | 离线 + 集成行为（来源、范围、续读定位、逐项失败） | 已验证（测试层） |
| AC-10 | 集成：技能目录/正文、`ask_user_question`、`todo_write` 真实往返 | 已验证（测试层） |
| AC-11 | 集成：任务内子 Agent 启动/查看/介入；Windows 套件证明真实进程树；真实 GUI 中的子 Agent 面板：**未验证** | 部分验证 |
| AC-12 | 集成：通信状态、通知回收、写协调 | 已验证（测试层） |
| AC-13 | 集成：系统提示词层与其他贡献进入真实请求；§6.2：真实会话的提示词快照返回 Nexus persona 原文 | 已验证（测试层 + 真实会话快照）。一次真实模型请求里系统层的实际顺序与 token：**未验证**（需要用户账号；本次刻意不发送消息） |
| AC-14 | 集成：默认隔离、下一请求生效、会话恢复原文 | 已验证（测试层） |
| AC-15 | 客户端 jest-dom/标记渲染测试覆盖五个子页与无版本/对比/更新 UI；**真实页面与双主题：未验证**，需要用户目视 | 部分验证 |
| AC-16 | 集成：具体第三方插件（工具、系统提示词段、压缩适配）通过；真实第三方安装到日常 Profile 的兼容性：**未验证** | 部分验证 |
| AC-17 | 本任务未在 GUI 中执行完整「读含图资料→多处编辑→测试→后台/交互→联网→内部委派→父任务整合」代表性任务；相应能力由测试层逐项覆盖 | **未验证** |
| AC-18 | 代码与组合检查：无新增装配平台、无多预设管理、无配置版本/对比/更新入口 | 已验证（静态与测试层） |

## 8. 需要用户目视或使用真实账号的项目

1. 在运行中的 DSH 里新建一个 Nexus 会话，确认六个 Nexus 工具（`read`、`write`、`edit`、`shell`、`web`、`agent`）出现在请求里并能调用一次 `shell`（AC-02/AC-13）。生成域激活与 persona 快照已由 §6.2 无模型证明；工具清单只能从一次真实请求或 GUI 看到。
2. 五个子页与浅色/深色主题（AC-15）。
3. 真实模型的图片送入与联网搜索/抓取（AC-03/AC-08/AC-09）。
4. 真实第三方插件在本 Profile 中的兼容结论（AC-16）。
5. 代表性开发任务（AC-17）。
6. 若要在 `read-only` / `workspace-write` 权限预设下使用终端，请显式选择 `engine: "pwsh"`；受限 Git Bash 在此主机不可用（第 4.1 节）。

## 9. 附录：证据位置、口径与后续修正

- **日志位置**：本波（fix2）的完整日志在 SDD 目录 `.superpowers/sdd/2026-11-01-dsh-nexus-implementation/tmp/task14fix2-*.log`（含真实 exit 状态，用 `cmd > log 2>&1; echo rc=$?` 采集，不经管道）。fix1 的 pack/install/list/boot 日志与历史证据在**仓库根** `tmp/`（本波开始被 `.gitignore` 忽略，既有文件保留未删）。最初的日志里多数只有 Vitest 摘要、没有保留退出码（当时用了管道），已由控制器补充的 `task14-controller-gates.log` 佐证，但**没有**完整日志可引用。
- **`/tmp/` 忽略规则是本次新增的**：本波之前仓库并未忽略根 `tmp/`，相关文档里「已被 git 忽略」的说法当时并不成立；本波加上了 `/tmp/`，并且没有删除任何既有文件。
- **状态码口径修正**：进程退出状态是 `3221225794`（`0xC0000142`），stderr 里的 Win32 API 错误才是 `0xC0000022`（`3221225506`）。此前文档把它们写成同一个值，本波已在前台拒绝消息、README、manual-acceptance 与本文 §4.1 更正；数值守卫（`3221225794`）与 stderr 正则未改。
- **C1 的边界**：§6.2 的无模型探针只证明「生成域激活 + 活会话 + persona 快照 + 原生 `agentPreset` 投影」。它**没有**证明六个工具的真实 schema、请求内系统层顺序、GUI/主题、图片/联网或第三方安装，也没有证明 AC-17。
- **AC-07** 仍是环境阻塞，不是用户批准的降级；命名拒绝只覆盖**前台** `run`。
