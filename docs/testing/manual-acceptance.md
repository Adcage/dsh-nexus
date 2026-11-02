# Nexus 手工验收清单

本文是 **真实运行验收** 的操作手册，和自动化证据分层，不能互相冒充。自动化能证明什么、不能证明什么，写在最后。示例命令都在仓库根目录执行，且只操作项目内目录或一个**独立的** DSH Profile；不要动日常使用的 Profile，也不要手工修改 Profile 文件。

当前版本：`dsh-nexus` 0.1.3，目标运行时 DSH `0.2.1-rc.2`（`package.json` 的 `engines.dsh`）。

## 0. 先决条件

| 项 | 要求 |
| --- | --- |
| Node.js | ≥ 22.17 |
| 包管理器 | pnpm（仓库锁文件为 `pnpm-lock.yaml`） |
| DSH CLI | 与 `engines.dsh` 一致的可用版本，`dsh --version` 可执行 |
| Shell | Windows 上需要真实 Git Bash 与（可选）PowerShell 7，且它们在 DSH 权限链内可运行 |
| 账号／联网 | 当前 Profile 中已配置的模型与 web 提供方；本清单不切换账号 |

命令：

```sh
pnpm typecheck          # 宿主 + 浏览器两套类型检查
pnpm build              # 根入口、preset 子入口、client 三份构建
pnpm test               # 默认离线行为套件（不含 integration / windows）
pnpm test:integration   # 项目隔离实例 + 真实 DSH 服务 + 受控模型提供方
pnpm verify:runtime     # 包身份与集成接线静态检查
```

## 1. 隔离实例与安装

```sh
pnpm pack:plugin                             # 先 check 再打包到 dist/，并检查 tarball 内容
node scripts/dev-profile.mjs init            # 把 dist/ 里的 tarball 装进项目内 .dev-home，不启动服务
node scripts/dev-profile.mjs dump            # 打印组合后的 dsh-nexus 行
node scripts/dev-profile.mjs boot --port 19499
```

`init` 装的是**打包后的 tarball**（默认 `dist/<name>-<version>.tgz`，可用 `--tarball <路径>` 覆盖），不是工作目录：只有 tarball 会作为真实目录进入 Profile 的 `node_modules`。没有 tarball 时 `init` 会明确报错并要求先 `pnpm pack:plugin`。

`boot` 才启动服务；不传子命令只会打印用法，不会自动启动。`.dev-home/` 已被 `.gitignore` 忽略，删除前必须显式 `remove --yes`。

正式 bundle 安装到日常 Profile（仅在明确授权时执行，使用官方插件管理命令；不要手改 Profile 文件，也不要在 Profile 目录里跑 pnpm）：

```sh
pnpm pack:plugin
dsh plugin --profile <profile> add <绝对路径>/dist/dsh-nexus-<version>.tgz
```

安装会打印 pnpm 的 `dependencies` 与 peer 警告；`@deepseek-ai/*` 的 “missing peer” 是正常的（运行时由 DSH 安装目录提供）。装完必须**重启该 Profile 的宿主进程**并刷新页面；重复安装同一版本是无声空操作，需要时先 `remove` 或提升版本号。

验收点：

- [ ] `dump` 输出的 `dsh-nexus` 行只有一条，`id` 等于包名，config 与部署配置一致。
- [ ] `dsh --profile <profile> --dump-config` 同样只有一条 `dsh-nexus` 行，且 Profile 的 `dsh.profile.bundles` 里出现 `dsh-nexus`。
- [ ] 安装结果里没有 “已安装但实际上未加载” 的行；重启只针对该实例。
- [ ] 真实日常 Profile 的其它插件与会话**未被修改**；未授权时记为「未验证」，不算通过。

## 2. 预设与工具（AC-01、AC-02）

- [ ] 新会话的预设列表出现 `Nexus`，`standard` 未被修改。
- [ ] Nexus 会话可见 `read`、`write`、`edit`、`shell`、`web`、`agent`，以及原生的 `skill`、`ask_user_question`、`todo_write`。
- [ ] 安装的第三方插件贡献的工具仍可见、可调用；不要用 "没有封禁" 当证明，要真的调用出结果。
- [ ] 同一工具名不会被 Nexus 静默过滤；没有全局白名单。

## 3. 文件工具（AC-03、AC-04）

- [ ] 读取含图片的文件时，模型能力允许的情况下返回真实图片附件，而不是占位文本。
- [ ] `write`／`edit` 对未观察过的已有文件拒绝；观察后修改成功。
- [ ] 多处编辑里第二处匹配失败、或两处区间重叠时，整次拒绝且文件字节不变。
- [ ] UTF-8、BOM、LF／CRLF 混合文件修改后，未修改部分逐字节保留；不支持的编码明确拒绝。
- [ ] 中文名和带空格路径可以读写。

## 4. 终端（AC-05、AC-06、AC-07）

- [ ] `shell` 的 `run` 与 `open` 分别证明普通命令和持久终端；`engine: "bash"` 与 `"pwsh"` 都能启动。
- [ ] 后台任务：`run background: true` 后进程仍在运行，`read` 续读游标连贯，`stop`／`close` 后资源确实释放。
- [ ] 持久终端：`send` 输入被 shell 接收，`read` 按行分页，`close` 结束整个终端；关闭后旧 `resourceId` 不可再操作。
- [ ] 非零退出码如实报告，不当作工具失败；失败命令的错误流可见。
- [ ] 取消或超时只终止受管范围，且清理得到确认后才报告终态。
- [ ] 父进程退出但孙进程仍存活时，不报告 "已清理"。
- [ ] 只读模式下写文件、向工作区外写入都被拒绝（AC-07 需要真实权限链）。
- [ ] 持久终端打开在真实权限链下能成功（本项是 Task 13 修复的 `sandboxPolicy` 冷路径缺陷的真实验收）。

### 4.1 受限权限与 Git Bash（本机环境阻塞）

DSH 在 Windows 用 `windows-acl` 受限令牌执行受管命令；MSYS2 运行时在启动阶段申请 `\BaseNamedObjects` 共享内存对象会被该令牌拒绝。这里有两个不同的量：stderr 里的 Win32 API 错误是 `0xC0000022`（`STATUS_ACCESS_DENIED`），进程退出状态是 `3221225794`（`0xC0000142`，`STATUS_DLL_INIT_FAILED`）。因此在 `read-only`／`workspace-write` 权限预设下：

- 只有**前台** `shell run` 会返回 `UNSUPPORTED_CAPABILITY`：消息说明是 MSYS2 运行时无法启动、同时保留原始退出状态（`3221225794` / `0xC0000142`）与有限的 stderr 片段（含 `0xC0000022`），并提示显式改用 `engine: "pwsh"`；不会静默换引擎，也不会提高权限。
- 后台 `run background: true` 的完成报告目前只给原始退出状态与 stderr，没有这条命名错误；持久终端 `open` 也不走这条分类。
- 需要受限执行时请显式传 `engine: "pwsh"`（PowerShell 7）。
- `danger-full-access` 预设（默认）不受影响，Git Bash 正常。

对应的最小复现、对照组与完整结论在 `docs/testing/verification-record.md` §4.1。**这一项不要求用户在 GUI 里验收，也不能当成已验证。**

## 5. 联网（AC-08、AC-09）

- [ ] 搜索与抓取走当前 Profile 已配置的提供方，没有隐藏切换；无法访问时明确报错。
- [ ] 结果保存后可用 `read` 续读、`find` 定位；逐项失败独立报告，不伪造完整内容。
- [ ] 超过会话配额时先淘汰最旧记录，续读被淘汰的 id 明确报 "不可用"。

## 6. 原生机制（AC-10）

- [ ] 首次请求前就能看到技能目录（名称 + 摘要），但**看不到正文**。
- [ ] 调用 `skill` 工具后才出现完整正文，且以 `<skill_content>` 形式进入历史。
- [ ] `ask_user_question` 能真正完成一轮问答；结构化答案模型可见。
- [ ] `todo_write` 能真正更新待办，界面显示新列表。

## 7. 内部子 Agent（AC-11、AC-12）

- [ ] `agent start` 的 `spawn` 与 `fork` 子 Agent 都能被原生查看、介入、停止。
- [ ] 子 Agent 的完成通知回到父会话；父 Agent 能取消订阅或不再收到残留通知。
- [ ] 写子 Agent 与父 Agent 同工作区时，不会出现两个写者同时进入同一棵树。
- [ ] 停止一个仍持有未确认清理范围的写子 Agent 时，写权限不被错误释放；重启也不会自动解锁。

## 8. 系统提示词（AC-13、AC-14）

- [ ] 提示词页能保存模块、调整顺序、预览草稿；保存后**不代表**已应用到当前会话。
- [ ] 显式应用后，**下一个请求**才生效；进行中的请求不被改写、不中断。
- [ ] 打开新窗口保存时，不静默覆盖，冲突给出明确提示。
- [ ] 子 Agent 继承父会话实际生效的提示词正文，而不是库里的默认选择。
- [ ] 会话重开后恢复自己的历史快照正文，不按今天的库重新拼装。

## 9. 控制台与主题（AC-15）

- [ ] 五个子页（提示词／工具／终端／内部 Agent／集成）都能打开并显示真实数据。
- [ ] 浅色与深色主题都正常，无硬编码颜色导致的不可读。
- [ ] 页面没有 "配置版本号""版本差异对比""有更新可用" 之类未实现入口。
- [ ] 排版错误、未命名模块等文案正常。

## 10. 第三方与压缩兼容（AC-16）

- [ ] 安装一个具体第三方插件后，它的工具与系统提示词段落都进入真实请求。
- [ ] 该插件绑定在 `standard` 预设上的压缩机制**不会**被 Nexus 继承；Nexus 会话仍然只有一个有效压缩机制。
- [ ] 不通过关闭第三方来 "解决" 兼容问题；报告真实兼容结论。

## 11. 代表性开发任务（AC-17）与边界（AC-18）

- [ ] 在一个临时 workspace 中完成：读含图资料 → 多处编辑 → 运行测试 → 后台命令／交互终端 → 联网查资料 → 内部委派 → 父任务整合。
- [ ] 记录选错工具、参数错误、轮询、上下文占用与结果，而不是只数工具名字。
- [ ] 没有新增后置装配平台、多预设管理或装配管理界面。

## 12. 自动化证据与限制

自动化分层如下，**任何一层都不代表更高一层**：

| 层 | 命令 | 证明内容 | 不能证明 |
| --- | --- | --- | --- |
| 静态 | `pnpm verify:runtime` | 包身份、patch 行、client 注册、集成接线存在 | 任何运行时行为 |
| 离线行为 | `pnpm test` | 工具、存储、提示词、控制台逻辑 | 真实 profile、真实进程、真实 UI |
| 集成 | `pnpm test:integration` | 真实 Cordis 组合、原生注册表、受控模型请求组装、第三方 fixture、生命周期清理 | 真实账号、真实 GUI、真实 PTY、安装包 |
| Windows 专项 | `pnpm test:windows` | 真实 Git Bash／PowerShell 7、中文与空格路径、后台任务、持久终端（真实 ConPTY）、取消／超时、真实进程树清理、不可用引擎与 PowerShell 5.1 拒绝 | 受限权限下的 Git Bash（环境阻塞，见 §4）、其他平台 |
| 真实 GUI／账号 | 本文手工步骤 | 页面、主题、真实模型与联网 | 不能在自动化里冒充 |

集成套件的明确限制：

- 模型传输是受控替身，**请求组装是真的**（系统节点、工具 schema、消息），但没有真实账号调用。
- 进程与 PTY 是脚本化提供方实现；不证明真实 ConPTY、真实 Git Bash 或 OS 沙箱。
- 不启动 HTTP 服务，不占用端口，不写用户 Profile。
- 浏览器端只通过构建产物与 jsdom 级测试验证，真实渲染与双主题仍需人工。
