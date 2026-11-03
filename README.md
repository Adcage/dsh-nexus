# dsh-nexus

`dsh-nexus` 是 DeepSeek Harness（DSH）的一个可安装 bundle：一个宿主插件行、一份独立的 `Nexus` Agent 预设、完整的核心工具集、系统提示词模块库，以及一个统一的前端控制台。

- 包名 / 宿主行 id / client 注册 id / 设置命名空间：`dsh-nexus`
- 预设 id / 显示名：`nexus` / `Nexus`
- 目标运行时：DSH `0.2.1-rc.2`（见 `package.json` 的 `engines.dsh`）
- 不改原生 `standard` 预设，不建第二套装配平台

## 安装

**推荐：直接装 Release 里预构建好的 tarball。** tarball 里已经带着构建产物 `lib/`，安装时不跑构建、不需要本机的 pnpm 开发工具链，也不需要改 Profile 的 `pnpm-workspace.yaml` 去放行任何构建脚本。

```sh
dsh plugin --profile <profile> add https://github.com/Adcage/dsh-nexus/releases/download/v0.1.11/dsh-nexus-0.1.11.tgz
```

安装后必须 **重启该 Profile 的宿主进程** 再刷新页面：新 bundle 不会热进已打开的页面。重复安装同一版本是无声空操作——需要重装时先 `dsh plugin --profile <profile> remove dsh-nexus`，或提升版本号。

### 本地构建后安装（开发用）

插件以 **打包后的 tarball** 安装，不要直接链接工作目录：只有 tarball 会作为真实目录进入 Profile 的 `node_modules`，链接目录要在宿主启动时另外注册才可见。

```sh
pnpm install
pnpm pack:plugin          # 先 check，再打包到 dist/，并检查 tarball 内容
# 产物：dist/dsh-nexus-<version>.tgz

# 用官方插件管理命令装进指定 Profile（不要手改 Profile 里的 package.json / cordis.patch.yml）
dsh plugin --profile <profile> add <绝对路径>/dist/dsh-nexus-<version>.tgz
```

### 从 Git / codeload 安装（替代方案，需要放行构建脚本）

`git+https://…` 和 codeload 源码归档拿到的是**没有 `lib/` 的源码**（构建产物在 `.gitignore` 里，不提交），`package.json` 的 `prepare` 会在安装时执行 `pnpm run build`。pnpm 10 默认**拦截依赖的构建脚本**，所以这条路径有两个硬前提：

1. 机器上有开发工具链（Node.js ≥ 22.17.0 与 pnpm），安装时会下载 `devDependencies`；
2. 目标 Profile 的 `pnpm-workspace.yaml` **放行 dsh-nexus 的构建脚本**。

没有放行时安装会失败（0.1.10 上实际出现的报错）：

```text
ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED  The git-hosted package "dsh-nexus@0.1.10" needs to execute build scripts but is not in the "onlyBuiltDependencies" allowlist.
```

pnpm 会在这条错误里打印需要放行的键；把它写进**目标 Profile 的** `pnpm-workspace.yaml`（不是本仓库根目录的那份，也不要在 Profile 里手改 `package.json` / `cordis.patch.yml`）：

```yaml
onlyBuiltDependencies:
  - 'dsh-nexus@https://codeload.github.com/Adcage/dsh-nexus/tar.gz/b5e1a32cbdc784c52c8f47229058c662e2669a7d'
```

这个键的形状是 `<包名>@<pnpm 解析出的 codeload 源码 URL>`，URL 末尾就是该 ref 的 hash。它**不稳定**：v0.1.9 解析出 `241c1735…`，v0.1.10 是 `b5e1a32…`；换版本、甚至移动 tag，键都会变，必须重新让 pnpm 打印并更新，不能照抄旧键。字段名也以 pnpm 实际打印的为准：pnpm 10.18／10.20 读 `onlyBuiltDependencies`，当前 DSH 的失败提示写的是 `allowBuilds`，不要把两者混着抄。

```sh
# git 按 tag 装（版本可复现）
dsh plugin --profile <profile> add git+https://github.com/Adcage/dsh-nexus.git#v0.1.11

# codeload 源码归档
dsh plugin --profile <profile> add https://codeload.github.com/Adcage/dsh-nexus/tar.gz/refs/tags/v0.1.11
```

另外两点：

- **codeload 归档按 URL 固定**：它锁定的是抓取那个 ref 时产出的字节，tag 被移动或之后有新提交都不会重新解析；换版本要同时改 URL 和上面那个键里的 hash。
- **重复安装同一个 ref 可能被当成“没有变化”**：pnpm 对同一个 git ref 缓存解析结果，再次 `add` 往往什么都不做。需要重装时先 `dsh plugin --profile <profile> remove dsh-nexus`，或换一个 tag / commit。

因为放行键每次都跟着 commit 变，**git / codeload 目前只适合临时验证**；日常安装请用上面的 Release tarball。

## 使用

1. 新会话选择 `Nexus` 预设（原生 `standard` 不受影响）。
2. Nexus 预设提供 `read`、`write`、`edit`、`shell`、`web`、`agent` 六个工具，并保留原生技能、结构化提问、待办与压缩机制。
3. 设置里的 `dsh-nexus` 卡片进入控制台：提示词、工具、终端、内部 Agent、集成五个子页。

控制台的「工具 → 工具调用显示」决定 Nexus 自己的 `shell`／`web`／`agent` 调用如何出现，默认是 Nexus 卡片：

- **Nexus 卡片**（默认）：在宿主的 `tool.call.toolview` 槽位按默认优先级注册三张卡片，因此这三类调用显示 Nexus 卡片。
- **让位给其它插件**：以较低优先级注册；其它插件针对同名工具的默认优先级视图优先，只有没人占用该单元格时才回落到 Nexus 卡片。
- **宿主默认**：完全不注册 Nexus 视图。宿主会把这三个名字当作未知工具，并用第一个字符串参数当摘要，所以 `shell` 调用大致显示为“工具调用 · run”，而不是命令本身——这是宿主的兜底显示，不是更好看的 Nexus 样式。

该选择只影响显示，随其它设置一起保存，切换后无需刷新页面；卡片本身的内容、折叠的事实与输出、以及“只按记录显示”的措辞都没有变。

`shell` 工具的引擎设置默认 `bash`（Windows 上是 Git Bash），可显式选择 `pwsh`（要求 PowerShell 7）：

```jsonc
{ "action": "run", "command": "ls -la", "engine": "bash" }
{ "action": "run", "command": "Get-ChildItem", "engine": "pwsh" }
```

引擎只在显式设置或部署配置里选择，**不会**在失败后自动换另一个。

## 验证

自动化证据分层，任何一层都不代表更高一层：

| 层 | 命令 | 证明内容 |
| --- | --- | --- |
| 静态 | `pnpm verify:runtime` | 包身份、patch 行、client 注册、脚本接线 |
| 类型 + 构建 | `pnpm typecheck` / `pnpm build` | 宿主与浏览器两份类型、三份构建产物 |
| 离线行为 | `pnpm test` | 工具、存储、提示词、控制台逻辑（不需要 Profile、进程或网络） |
| 集成 | `pnpm test:integration` | 真实 Cordis 组合、原生注册表、受控模型请求组装 |
| Windows 专项 | `pnpm test:windows` | 真实 Git Bash / PowerShell 7、中文与空格路径、后台与持久终端、取消 / 超时、真实进程树清理 |
| 隔离 Profile | `pnpm dev:profile -- init` / `boot` | 组合后的 `dsh-nexus` 行、真实宿主路由与 client bundle |
| 真实 GUI / 账号 | `docs/testing/manual-acceptance.md` | 页面、主题、真实模型与联网 |

`pnpm test:windows` 只接受真实 Windows 主机：在其它平台它显式报错退出，而不是跳过记成通过。

隔离 Profile 演练（只在项目内 `.dev-home/` 建 Profile，不写用户 HOME，不自动开浏览器）：

```sh
pnpm pack:plugin
pnpm dev:profile -- init          # 把 dist/ 里的 tarball 装进 .dev-home 的隔离 Profile
pnpm dev:profile -- dump          # 打印组合后的 dsh-nexus 行
pnpm dev:profile -- boot --port 19499
pnpm dev:profile -- remove --yes  # 用完清理
```

## 已知限制

- **受限权限下 Git Bash 不可用（Windows）。** DSH 在 Windows 用 `windows-acl` 受限令牌执行受管命令，MSYS2 运行时在启动阶段申请 `\BaseNamedObjects` 共享内存对象会被拒绝；stderr 里的这个 Win32 API 错误是 `0xC0000022`（`STATUS_ACCESS_DENIED`），而进程本身的退出状态是 `3221225794`（`0xC0000142`，`STATUS_DLL_INIT_FAILED`）——两者是不同的量，别把它们混成一个。因此在 `read-only` / `workspace-write` 权限预设下，**前台** `shell run` 会以 `UNSUPPORTED_CAPABILITY` 明确拒绝并提示改用 `engine: "pwsh"`，不会静默换引擎或提高权限；后台 `run background: true` 的完成报告目前只给原始退出状态与 stderr（尚未归类），持久终端 `open` 也不走这条分类。`danger-full-access` 预设不受影响。详细命令与最小复现见 `docs/testing/verification-record.md`。
- 插件只提供 Nexus 预设一个组合；不做多预设、装配管理、配置版本号或差异对比。
- 真实第三方插件兼容、真实账号联网与页面双主题需要人工确认，自动化不冒充这部分证据。

## 许可证

MIT（`package.json` 的 `license` 字段）。
