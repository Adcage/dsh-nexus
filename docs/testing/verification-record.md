# 验证记录（Task 14 最终验收）

本文按「静态 → 离线行为 → 构建 bundle → 隔离组合 → 真实安装 → 真实 GUI／账号」分层记录**实际执行过**的验证。每一行都写明命令或操作、版本、结果，以及没有验证的原因。没有执行的项一律写「未验证」，不用替身、模拟页面或推测填补。

- 仓库：`E:/Programme/Project/dsh-nexus`，分支 `dev/nexus-core`
- 包版本：`dsh-nexus` 0.1.0；目标运行时 DSH `0.2.1-rc.2`
- 安装产物：`dist/dsh-nexus-0.1.0.tgz`（454,903 字节，SHA-256 `442120381680598b2deabd46f66e9c3b6ea6210ac44f57e86341895ba4a5f66b`）
- 执行环境：Windows `win32`，Node v24.22.0，pnpm 10.18.1，Git for Windows 2.48.1（bash 5.2.37 x86_64-pc-msys），PowerShell 7

本文不含凭据、令牌、私有对话内容或环境快照。

## 1. 静态与构建

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 包身份／patch 行／client 注册／脚本接线 | `pnpm verify:runtime` | 通过；`manifest, patch row and client bundle agree` |
| 宿主 + 浏览器类型检查 | `pnpm typecheck`（`pnpm check` 第一步） | 通过 |
| 三入口构建 | `pnpm build`（9 个产物，含 `lib/index.js`、`lib/client.js`、`lib/preset/index.js`） | 通过 |
| 打包内容检查 | `pnpm pack:plugin` | 通过；14 个成员，`package.json`、`cordis.patch.yml`、`README.md`、`lib/index.js`、`lib/client.js`、`lib/preset/index.js` 均在包内，无未声明根目录；`LICENSE` 在 `files` 中声明但仓库里不存在（见残留风险） |

## 2. 离线行为

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 默认离线套件 | `pnpm test`（`pnpm check` 内） | 40 个文件 / 575 个测试通过 |
| 新增：受限 Git Bash 拒绝分类（5 个回归） | `npx vitest run test/shell/process.test.ts` | 27 个测试通过（含 5 个新增：命中特征、普通非零退出不命中、未受限不命中、pwsh 不命中、非 Windows 不命中） |
| 新增：工具管线上的受限 Git Bash 拒绝 | `npx vitest run test/shell/tool.test.ts` | 28 个测试通过（`UNSUPPORTED_CAPABILITY`，消息含原始状态码与 `pwsh` 提示） |

## 3. 集成（真实 Cordis 组合、受控模型边界）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 集成套件 | `pnpm test:integration` | 5 个文件 / 15 个测试通过（原 12 个 + 新增 3 个） |
| 真实 profile 形状下的终端能力（新增） | `test/integration/terminal-scope.test.ts` | 3 个测试通过：无宿主级 `terminals` 时六个工具与 persona 正常激活；`standard` 形状的兄弟实例 `listBackends()` 保持为空；`open/send/read/close` 使用生成域后端；卸载后重新注册不残留 |

集成套件的边界（不变）：模型传输是受控替身；进程派生与终端派生在该套件里是脚本化提供方（真实 ConPTY／真实 Git Bash 证据见下一节）。

## 4. Windows 专项（真实操作系统）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| Windows 验收套件 | `pnpm test:windows`（`vitest.windows.config.ts` → `test/integration/windows.test.ts`） | 11 个测试通过（5.5 秒） |
| 覆盖 | 同上 | 真实 Git Bash 与真实 PowerShell 7 两种方言；中文与空格路径（参数 `你好 世界` 原样、`pwd` 回到同一目录）；非零退出码如实报告；不可用 bash 路径 `SHELL_UNAVAILABLE` 且不换引擎；Windows PowerShell 5.1 被拒绝；取消后真实 Windows 子进程从进程表消失；超时后同样消失；父进程被停后孙进程（真实 Windows PID）消失且 `cleanupConfirmed`；真实后台任务可 list／stop／close；真实 ConPTY 持久终端跨 `send` 保留 shell 状态并可 `close` |
| 非 Windows 主机 | 同上 | 文件在收集阶段显式报错拒绝，不跳过记成通过 |

### 4.1 受限权限链（AC-07 的受限证据：环境阻塞，未验证）

真实 DSH `web` Profile 的权限链是 `dsh-sandbox-local`（win32 链 = `windows-acl` 受限令牌）+ `sandbox-policy`（`DSH_PERMISSION_MODE ?? 'workspace-write'`）。在该链下 **Git Bash（MSYS2）无法启动**：

```
node <dsh>/lib/runner.js --workspace "<dir>" --temp "<dir>" --mode read-only|workspace-write \
  -- "E:\Programme\software\Git\usr\bin\bash.exe" --noprofile --norc -c "echo confined-ok"
→ 退出码 3221225794 (0xC0000022)
→ stderr: bash (…): *** fatal error - NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-…): 0xC0000022
```

- 与模式（read-only / workspace-write）、cwd、TMP、命令内容无关；`TMPDIR` 覆盖无效。
- 对照组：同一条 provider argv 换成 `C:\Program Files\PowerShell\7\pwsh.exe` 退出码 0；`workspace-write` 下工作区内写入成功，工作区外写入被拒（`Access to the path '…' is denied`，文件不存在）。
- 未受限 bash 正常：退出码 0，中文 + 空格路径原样。
- 结论：这是 MSYS2 运行时与受限令牌的环境级不兼容，不是命令失败。产品现在的行为是在四个事实同时成立时（win32 + bash + 确实应用了受限策略 + `0xC0000022` 且 stderr 命中 `BaseNamedObjects…msys-`）以 `UNSUPPORTED_CAPABILITY` 明确拒绝，消息保留原始状态码与有限 stderr 片段，并提示可显式改用 `engine: "pwsh"`，不静默换引擎、不提高权限。
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
| 官方安装命令 | `dsh plugin --profile web add E:/Programme/Project/dsh-nexus/dist/dsh-nexus-0.1.0.tgz` | 成功；profile `dependencies` 增加 `"dsh-nexus": "file:…/dist/dsh-nexus-0.1.0.tgz"`，`dsh.profile.bundles` 追加 `dsh-nexus` |
| 安装告警 | 同上输出 | pnpm peer 警告：`dsh-nexus` 的 `@deepseek-ai/*` peer 在 profile 目录里「missing peer」（运行时由 DSH 安装目录提供，非失败）；未修改任何 Profile 文件 |
| 组合行 | `dsh --profile web --dump-config` | `- id: dsh-nexus` / `name: dsh-nexus`，单条（第 1398 行附近） |
| 真实启动 | `dsh --profile web --no-open --port 19500` | 监听 127.0.0.1:19500（PID 29060，已停止） |
| 页面与 client bundle | `GET /` 后取该组合包 | 200；页面 preload 含 `dsh-nexus/client.js`；组合包 200 / 212,750 字节，`id: "dsh-nexus"` |
| 带护栏 API | `GET /api/dsh-nexus/capabilities|library|sessions` | 200；`registered.nexusRuntime=true`（宿主行在真实 Profile 中已激活）；`library` 空库；`sessions` `[]` |
| 启动日志 | 该次 boot 输出 | 没有 dsh-nexus 相关错误；日志里的 `usage-billing` 警告来自用户已装第三方插件对历史会话的读取，与本插件无关 |
| 其他会话 | boot 前后 | 启动前无 DSH 进程；只启动并停止了本次 PID，未中断其他会话 |

**未做**：profile 内的 `pnpm` 调用、手改 `package.json`／`cordis.patch.yml`、账号切换、凭据复制、发布／推送／合并、修改用户已有的 `pet`／`dsh-proxy-router` 漂移。

## 7. 逐 AC 结论

| AC | 证据 | 结论 |
| --- | --- | --- |
| AC-01 | tarball 成员检查；隔离与真实 Profile 的 `dsh-nexus` 组合行；预设只新增 `nexus`（集成测试断言 `standard` 未改） | 已验证（安装与组合） |
| AC-02 | 集成：真实定义、同 scope 六工具、第三方同名工具并存可调用 | 已验证（测试层）。运行中的真实 Nexus 会话内的工具清单：**未验证**，需要用户在 GUI 里新建 Nexus 会话（本机无浏览器自动化，且模型调用需要用户账号） |
| AC-03 | 离线行为测试（分页、图片附件、目标模型能力检查） | 已验证（测试层）。真实模型送图的实机效果：**未验证**（需要用户账号与实际模型） |
| AC-04 | 离线行为测试（观察守卫、多处编辑、字节/原子失败） | 已验证（测试层） |
| AC-05 | 离线 + Windows 真实 ConPTY（持久状态）与普通命令（独立状态）对照 | 已验证（含真实 ConPTY） |
| AC-06 | 离线行为（续读游标、停止清理）+ Windows 真实后台任务与真实树清理 | 已验证 |
| AC-07 | Windows 两种方言、中文/空格路径、真实树清理通过；受限只读/越根写入未能在 Git Bash 上验证（第 4.1 节，环境阻塞），受限链路由 pwsh 对照组证明 | 部分验证 + 部分**环境阻塞** |
| AC-08 | 集成：当前配置的后端请求组装；未接后端时明确失败 | 已验证（测试层）。真实联网账号：**未验证**，未使用用户账号发起请求 |
| AC-09 | 离线 + 集成行为（来源、范围、续读定位、逐项失败） | 已验证（测试层） |
| AC-10 | 集成：技能目录/正文、`ask_user_question`、`todo_write` 真实往返 | 已验证（测试层） |
| AC-11 | 集成：任务内子 Agent 启动/查看/介入；Windows 套件证明真实进程树；真实 GUI 中的子 Agent 面板：**未验证** | 部分验证 |
| AC-12 | 集成：通信状态、通知回收、写协调 | 已验证（测试层） |
| AC-13 | 集成：系统提示词层与其他贡献进入真实请求 | 已验证（测试层）。真实模型请求中的实际系统层：**未验证**（无账号调用） |
| AC-14 | 集成：默认隔离、下一请求生效、会话恢复原文 | 已验证（测试层） |
| AC-15 | 客户端 jest-dom/标记渲染测试覆盖五个子页与无版本/对比/更新 UI；**真实页面与双主题：未验证**，需要用户目视 | 部分验证 |
| AC-16 | 集成：具体第三方插件（工具、系统提示词段、压缩适配）通过；真实第三方安装到日常 Profile 的兼容性：**未验证** | 部分验证 |
| AC-17 | 本任务未在 GUI 中执行完整「读含图资料→多处编辑→测试→后台/交互→联网→内部委派→父任务整合」代表性任务；相应能力由测试层逐项覆盖 | **未验证** |
| AC-18 | 代码与组合检查：无新增装配平台、无多预设管理、无配置版本/对比/更新入口 | 已验证（静态与测试层） |

## 8. 需要用户目视或使用真实账号的项目

1. 在运行中的 DSH 里新建一个 Nexus 会话，确认六个 Nexus 工具与 persona 生效（AC-02/AC-13）。
2. 五个子页与浅色/深色主题（AC-15）。
3. 真实模型的图片送入与联网搜索/抓取（AC-03/AC-08/AC-09）。
4. 真实第三方插件在本 Profile 中的兼容结论（AC-16）。
5. 代表性开发任务（AC-17）。
6. 若要在 `read-only` / `workspace-write` 权限预设下使用终端，请显式选择 `engine: "pwsh"`；受限 Git Bash 在此主机不可用（第 4.1 节）。
