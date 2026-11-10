# dsh-nexus

`dsh-nexus` 是 DeepSeek Harness（DSH）的一个可安装 bundle：一个宿主插件行、一份独立的 `Nexus` Agent 预设、完整的核心工具集、系统提示词模块库，以及一个统一的前端控制台。

- 包名 / 宿主行 id / client 注册 id / 设置命名空间：`dsh-nexus`
- 预设 id / 显示名：`nexus` / `Nexus`
- 目标运行时：DSH `0.2.1-rc.2`（见 `package.json` 的 `engines.dsh`）
- 不改原生 `standard` 预设，不建第二套装配平台

## 安装

### 直接用 Git 仓库地址安装

仓库随源码一起提交构建好的 `lib/`，安装时不编译插件，不依赖 GitHub Release 附件，也不需要为 Nexus 在 Profile 里放行构建脚本。使用已正常安装的 DSH 即可，不需要另外准备 Nexus 的 TypeScript / tsdown 开发工具链。

以下命令适用于 **CLI 管理的 Profile**；桌面应用管理的 Profile 请使用 **设置 → 插件** 或插件管理工具，提供同一个 Git 安装地址。

1. **加包。** 把 `<profile>` 换成你的 Profile 名（例如 `web`），不要保留尖括号：

   ```sh
   dsh plugin --profile <profile> add git+https://github.com/Adcage/dsh-nexus.git
   ```

2. **重启目标 Profile 的 DSH 宿主进程，再刷新页面。** 新增 bundle 不保证热加载到已打开的页面。

3. **确认安装。** 执行下面的只读命令，检查有无 `dsh-nexus`；再确认新会话可选 `Nexus` 预设、设置里能打开 Nexus 控制台：

   ```sh
   dsh plugin --profile <profile> list
   ```

不带 `#` 的地址跟随仓库默认分支。需要固定版本时，可以在 `.git` 后加 `#<commit>` 或 `#<tag>`；所选提交必须已经包含 `lib/` 且没有安装构建脚本。**旧版本的 tag 不会因为本次改动自动获得 Git 直装能力。**

### 升级与重装

Git 分支不是自动更新通道：推送新代码不会自动更新别人已经安装的插件，重复 `add` 相同地址也可能命中缓存。升级后仍需重启 DSH。

最可靠的方式是使用新提交的完整 commit hash：

```sh
dsh plugin --profile <profile> add git+https://github.com/Adcage/dsh-nexus.git#<新的完整commit>
```

需要移除后重装时，先记录插件设置，并注意原地址是否仍被缓存；移除并不能保证清除 pnpm 的所有 Git 缓存。使用明确的新 commit 能避免分支解析歧义。

Release tarball 仍可作为可选安装方式，但不再是 Git 安装的前提。

### 开发者：提交时自动构建

克隆仓库后，准备 Node.js ≥ 22.17.0 和 pnpm，安装依赖，然后**手动启用一次**提交钩子（不会影响其他仓库）：

```sh
pnpm install
# 如果已经使用 Husky 等钩子，先整合现有钩子，不要直接覆盖 hooksPath。
git config --local core.hooksPath .githooks
```

macOS / Linux 上应确保 `.githooks/pre-commit` 可执行；首次将该文件提交到 Git 时，应记录可执行位：

```sh
git add .githooks/pre-commit
git update-index --chmod=+x .githooks/pre-commit
```

之后正常暂存需要提交的文件，再运行 `git commit` 即可。钩子会自动：

1. 检查暂存区与工作目录是否一致（生成目录 `lib/` 除外），拒绝未解决的冲突、未暂存修改和未被忽略的新增文件。
2. 执行 `pnpm check`（类型检查、构建、离线测试）及 `pnpm verify:runtime`。
3. 再次确认源码和暂存区没有在检查期间变化，然后**只把 `lib/` 的新增、修改和删除纳入这次提交**；不会替你暂存源码、提交或推送。

因此首次提交时，请一并暂存打算提交的新增脚本、测试、文档和配置。若只想提交部分改动，请先自行保存其余改动；钩子不会自动 stash 或丢弃文件。构建失败会阻止提交，生成目录可能已变化，但不会由钩子暂存。每次提交会等待完整检查完成；提交过程中不要同时修改源码或操作暂存区。

钩子只在主动启用的开发机器生效，`git clone` 不会自动启用，`git commit --no-verify` 可以绕过。绕过时必须自行运行检查并同步提交 `lib/`，否则 Git 安装可能拿到旧代码。发布行为变化时仍应更新 `package.json` 的版本号。普通插件安装用户不需要启用钩子。

### 本地构建后安装（开发用）

插件以 **打包后的 tarball** 安装，不要直接链接工作目录：只有 tarball 会作为真实目录进入 Profile 的 `node_modules`，链接目录要在宿主启动时另外注册才可见。

```sh
pnpm install
pnpm pack:plugin          # 先 check，再打包到 dist/，并检查 tarball 内容
# 产物：dist/dsh-nexus-<version>.tgz

# 用官方插件管理命令装进指定 Profile（不要手改 Profile 里的 package.json / cordis.patch.yml）
dsh plugin --profile <profile> add <绝对路径>/dist/dsh-nexus-<version>.tgz
```

## 使用

1. 新会话选择 `Nexus` 预设（原生 `standard` 不受影响）。
2. Nexus 预设提供 `read`、`write`、`edit`、`shell`、`web`、`agent` 六个工具，并保留原生技能、结构化提问、待办与压缩机制。
3. 设置里的 `dsh-nexus` 卡片进入控制台：提示词、工具、终端、内部 Agent、集成五个子页。

控制台的「工具 → 工具调用显示」决定 Nexus 自己的 `shell`／`web`／`agent` 调用如何出现，默认是 Nexus 卡片：

- **Nexus 卡片**（默认）：在宿主的 `tool.call.toolview` 槽位按默认优先级注册三张卡片，因此这三类调用显示 Nexus 卡片。
- **让位给其它插件**：以较低优先级注册；其它插件针对同名工具的默认优先级视图优先，只有没人占用该单元格时才回落到 Nexus 卡片。
- **宿主默认**：完全不注册 Nexus 视图。宿主会把这三个名字当作未知工具，并用第一个字符串参数当摘要，所以 `shell` 调用大致显示为“工具调用 · run”，而不是命令本身——这是宿主的兜底显示，不是更好看的 Nexus 样式。

该选择只影响显示，随其它设置一起保存，切换后无需刷新页面；卡片本身的内容、折叠的事实与输出、以及“只按记录显示”的措辞都没有变。

### 子 Agent 权限与模型路由

控制台「内部协作」新增两项，编辑只改共享草稿，点击「保存全部设置」才落盘：

- `agents.childAccess`（默认 `inherit`）：`inherit` 让写子 Agent 继承父会话**当前**权限；`workspace-write` 把写子 Agent 限于父会话工作区；`read-only` 把所有子 Agent 限为只读。工具的 `access: "read"` 永远只读，`access: "write"` 还要受此设置与父权限双重限制；父会话自己只读时仍会拒绝写委派。旧记录缺字段按默认值加载，非法值则按只读处理，不会扩大权限。
- `agents.role.provider`（可选）：默认子模型提供方路由，与原有 `agents.role.model` 配合。路由名请到 **DSH 设置 → 模型／子 Agent** 查看（例如订阅插件提供的路由），不是账号名或模型 id。工具 `start` 和 `batch.tasks` 中显式的 `provider`／`model` 优先；留空则使用角色默认，再未配置才沿用父会话路由／模型。空白 provider 视作未提供，模型 id 由所选 provider 解释；未知路由会按名字报 Nexus 错误，**不会偷偷退回父路由**。

**权限警告：`inherit` 给子 Agent 与父会话相同的权限。父会话是 `danger-full-access` 时，写子 Agent 也不受工作区边界限制，可以写到工作区外。** 如需工作区限制或只读，请显式选更窄选项。持久策略记录、深度上限与工作区根目录的独占写租约仍保留；继承完全访问时，租约不能隔离工作区之外的写入。

提供方框使用宿主公开的 `llm.listProviders()` 列出路由建议；离开提供方框或聚焦模型框时，才通过 `llm.listModels(provider)` 懒加载 `provider / model` 建议（最长等待 1.5 秒，失败或超时不影响控制台）。两个输入框仍可自由填写，目录不是白名单，不会把未列出的模型拒之门外，也不会修改 DSH 的账号或模型配置。控制台仅返回路由名与模型 id，不返回连接配置或凭据。

`shell` 工具的引擎设置默认 `bash`（Windows 上是 Git Bash），可显式选择 `pwsh`（要求 PowerShell 7）：

```jsonc
{ "command": "ls -la", "engine": "bash" }
{ "command": "Get-ChildItem", "engine": "pwsh" }
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
