# DSH Nexus Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可安装的 `dsh-nexus` 插件包和一个独立 Nexus 预设，完整提供核心工具、内部协作、系统提示词模块和统一控制台。

**Architecture:** 顶层宿主插件负责状态、控制台 API 和预设注册，工具与系统提示词只在 Nexus 预设作用域生效。浏览器插件添加统一入口与功能子页；底层复用 DSH 服务、权限和生命周期，不建设功能装配平台。

**Tech Stack:** TypeScript、Node.js、pnpm、Cordis、DSH `0.2.1-rc.2` 公共 API、schemastery 配置 schema、zod 存储 schema、宿主 React／主题／槽位、tsdown、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-31-dsh-nexus-design.md`。旧讨论及 `specs/future/` 均不增加本次实施范围。

## Global Constraints

- 一个插件包、一个独立 Nexus 预设，不修改原生预设。
- 完整提供已确定的文件、终端、联网、内部子 Agent 能力，不能只交基础文件操作。
- 保留第三方插件向模型提供工具的能力，不实施全局白名单。
- 沿用 DSH 原生技能、结构化提问、待办和必要运行机制。
- 不直接手改用户 Profile 文件，不修改安装目录，不硬编码密钥、私有地址或环境路径。
- 注册和清理遵守 Cordis 作用域，工具及提示词贡献只作用于 Nexus 目标会话。
- 默认 Git Bash，支持显式选择 PowerShell 7；不能使用 POSIX-only 的 `dsh-bash-local` 充当 Windows 后端。
- 基础提示词严格保持规格原文，不加入强制规划／审查规则，不复制 Pi 全局指令。
- 当前保留提示词模块勾选；延后功能自由装配、多预设、装配管理、外部 CLI 实际适配和新增联网供应商。
- 提示词页不提供配置版本号、版本差异对比或“有更新可用”提醒。
- 没有执行的检查明确列出，不用模拟页面代替真实运行界面，不宣称未测试的账号能力可用。

## Review Focus

1. **观察后文件变化、多个编辑位置重叠、第二项匹配失败：**整次拒绝，不能部分写入。测试归 Task 3。
2. **中文／空格路径、UTF-8 跨输出块、父进程退出但孙进程存活：**参数文本不损坏，未确认整树结束不能报告已清理。测试归 Task 4、5、14。
3. **两个窗口保存、落盘失败、请求进行中应用提示词：**不静默覆盖、不半更新，下一请求才读取完整新快照。测试归 Task 2、8、10、11。
4. **跨会话资源 ID、同 sessionId 的旧 Agent、重启后旧句柄：**重新验证所有者，不误控新资源，不假装恢复活进程。测试归 Task 5、6、7、13。
5. **插件只匹配原生预设、重复加载、异常客户端数据：**报告真实兼容问题，不封禁其他工具、不泄漏注册、不拖垮宿主 UI。测试归 Task 9、11、12、13。

---

## 1. 执行前提

编写日期：2026-11-01。项目当前只有设计文档，没有源码、依赖或 Git 仓库。**先由用户审阅计划并确认执行方式，再初始化和编码。** 本文复选框均为尚未实施的工作。

这些功能共享预设、会话所有权和恢复语义，按一个交付拆成 14 个可测试任务，不拆成独立产品。执行时：

- 先检查当前文件、Git 状态及项目指令；若仍无 Git，仅在 `dsh-nexus/` 初始化。需要 worktree 时加载 `using-git-worktrees`，不得覆盖现有文档或用户修改。
- 每项按红灯、最小实现、绿灯、差异审查、提交推进。红灯必须是目标行为缺失；依赖缺失、目录错误、零测试不是有效验证。
- 每次提交只暂存所属文件，先运行 `git diff --check`；不得修改 Git 配置或自动推送／合并。
- 实际目标实例版本／接口不同先复核公共契约；权限、清理、恢复无法落实时给最小复现并报告阻塞，不静默降级。

## 2. 已核对接口与工程边界

以下来自本机 DSH `0.2.1-rc.2`，不代表其他版本自动兼容。开发参考包位于 `E:/Programme/Tool/node_assets/node_global/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`；该路径不得写入运行配置。

| 能力 | 接入点与关键限制 |
| --- | --- |
| 双端包 | `exports["."]`／`["./client"]`、`dsh.bundle.patch`、`dsh.client`；浏览器不打包 Node 或第二份 React |
| 预设 | `ctx.agentPresets.register(PresetDefinition)`；绑定返回 disposer，不修改 standard |
| 工具 | `defineTool`、`ctx.tools.register`，保留 token／Agent／signal 及权限、观察链 |
| 文件／图片 | `ctx.fs` 的版本 guard、intent、原子写入；模型能力检查后用 `ctx.attachments.saveImage` 返回真实附件 |
| 进程／权限 | `ctx.subprocess.spawn`、`done`、`terminate`、`waitForExit`；`sandboxPolicy.resolve`／`sandbox.confine`，不无约束重试 |
| 持久终端 | `ctx.terminals` 和公开 `BashTerminalBackend`；支持 bash／pwsh 方言，不重造 PTY |
| 后台 | `ctx.jobs`、`attachController`、原生完成报告；不能另建失去会话清理的后台服务 |
| 联网 | `ctx.web.search/fetch`，保持当前 Profile 提供方／账号，不私自切换 |
| 子 Agent | 原生 `startActivation/sendMessage/interrupt/drainChildren` 及会话目录，不启动外部 CLI |
| 提示词 | `ctx.systemPrompt.section`、`interpolate:false`；不用用户消息／AGENTS 代替，不以 `complete:true` 清空其他贡献 |
| 存储／界面 | `storageDomain/defineDomain`；写持久后才确认；原生 sidebar/main/settings、locale、主题 token |

**组合注意：**Web 把许多 Agent 能力移入各预设，新预设不会自动继承 standard。Task 9 必须保留技能、项目指导、提问、待办及有效压缩；不能只少挂工具却丢掉运行机制。Cordis 调用者需声明被调服务冷路径所需 inject，不能靠缓存恰好存在。

## 3. 文件职责与依赖

全部在实施时按任务创建；新文本使用 UTF-8 无 BOM、LF，已有文件保持格式。

| 文件／目录 | 单一职责 |
| --- | --- |
| `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`cordis.patch.yml` | 双端包、兼容依赖、单条安装行 |
| `tsconfig.json`、`tsconfig.client.json`、`tsdown.config.ts`、`vitest.config.ts`、`.gitignore` | 双端构建、默认离线测试、隔离产物 |
| `src/index.ts`、`src/config.ts`、`src/runtime/service.ts` | 顶层注册、部署配置、状态服务 |
| `src/protocol.ts`、`src/runtime/{defaults,errors,owner}.ts` | 浏览器安全数据、默认值、错误、调用者 |
| `src/storage/{domain,store}.ts` | 持久记录、串行条件保存 |
| `src/fs/{read,write,edit,text,policy}.ts` | 读／写／多处编辑、字节保护、原生观察策略 |
| `src/shell/{tool,engines,process,jobs,terminals,output}.ts` | Shell 契约、路径、进程、后台、终端、输出 |
| `src/web/{tool,backend,results,extract}.ts` | 联网包装、当前后端、持久续读、文本转换 |
| `src/agent/{tool,internal,coordination,policy}.ts` | 内部协作、写租约、子权限 |
| `src/prompts/{base,assemble,sessions,register}.ts` | 原文、字面拼接、会话快照、系统层贡献 |
| `src/preset/{definition,index,native}.ts` | 固定组合、作用域、原生边界 |
| `src/http/{routes,guards}.ts` | 控制台 API 和请求安全，不暴露为模型工具 |
| `src/client/{index,console,tool-views}.tsx`、`{api,store,tool-models}.ts`、`styles.css` | 界面注册、状态／传输、新工具呈现 |
| `src/client/pages/{prompts,tools,terminal,agents,integrations}.tsx` | 五个实际功能子页 |
| `src/locale/{zh,en}.json` | 所有界面文案 |
| `test/support/{harness,browser-loader,fixtures}.ts` | 工具管线底座、构建 bundle 加载器、受控外部替身 |
| `test/{bundle,runtime,fs,shell,web,agent,prompts,preset,http,client,integration}/` | 所属行为测试 |
| `scripts/{dev-profile,pack,verify-runtime}.mjs`、专项 Vitest 配置 | 跨平台隔离 Profile、打包、版本和显式验收 |
| `README.md`、`docs/testing/{manual-acceptance,verification-record}.md` | 安装、真实验收、分层证据 |

身份固定：包／顶层 row／宿主 name／client id／设置 namespace 均为 `dsh-nexus`；控制台 key 为 `dshNexus`；Agent preset id 为 `nexus`、显示 `Nexus`。包内子入口 `dsh-nexus/preset` 的子行与插件名为 `dsh-nexus-runtime`，不作为另一安装包。

DSH peer／开发依赖精确对应 `0.2.1-rc.2`，Cordis `~4.0.5`、schemastery `~3.18.5`，zod 与目标 SDK 一致。除原生 HTML 转换已有的 Turndown 相关依赖外不新增服务或浏览器引擎；pnpm 仅批准确有需要的构建脚本，模板默认只批准 esbuild。

## 4. 共享契约和默认值

### 4.1 数据与接口

浏览器协议禁止携带 Context、Agent、句柄、环境快照。下列 JSON 类型在 `src/protocol.ts`，宿主 store／owner 类型在所属文件：

- `PromptModule = { id: string; name: string; body: string }`。
- `PromptLibrary = { modules: PromptModule[]; defaultSelection: string[] }`；数组决定选中顺序。
- `PromptSnapshot = { sessionId: string; selection: string[]; modules: PromptModule[]; text: string }`；保存实际正文而非只存引用。
- `RuntimeSettings` 分 `files/terminal/agents/web`；`ShellEngine = "bash" | "pwsh"`。terminal 可保存显式程序路径，优先于部署 Config 默认；变更只影响以后启动，不重定向已有终端。角色为可选名称／任务说明／模型默认，不是能力上限，说明放入子任务用户内容。
- `WebDocument` 保存 owner、resultId、kind、来源／URL、实际内容、上游／保存截断、时间和过期时间；摘要／转换内容／原始已取得内容明确区分。
- `ChildPolicy` 保存 childId、parentSessionId、canonical cwd、access、有效深度上限，供冷恢复核验。
- `ProcessView` 保存 resourceId、kind、status、exitCode、signal、stopRequested、cleanupConfirmed；`OutputPage` 保存 text、cursor、lossy、spillAvailable。

```ts
requireOwner(exec: ToolRunContext): CallOwner
// CallOwner = { agent: Agent; sessionId: SessionId; signal: AbortSignal }
openNexusStore(ctx: Context): Promise<NexusStore>
type Stored<T> = { value: T; hash: string }
interface NexusStore {
  readLibrary(): Promise<Stored<PromptLibrary>>
  saveLibrary(value: PromptLibrary, expectedHash: string): Promise<Stored<PromptLibrary>>
  readSettings(): Promise<Stored<RuntimeSettings>>
  saveSettings(value: RuntimeSettings, expectedHash: string): Promise<Stored<RuntimeSettings>>
  getPrompt(sessionId: string): Promise<PromptSnapshot | undefined>
  putPrompt(value: PromptSnapshot): Promise<void>
  getWeb(owner: string, resultId: string): Promise<WebDocument | undefined>
  putWeb(value: WebDocument): Promise<void>
  getChildPolicy(childId: string): Promise<ChildPolicy | undefined>
  putChildPolicy(value: ChildPolicy): Promise<void>
  deleteChildPolicy(childId: string): Promise<void>
  dispose(): Promise<void>
}
```

hash 仅防两个窗口静默覆盖，不构成配置历史或可见版本号。运行授权使用**精确 Agent 实例**，持久归属使用 sessionId；随机 ID 不代替授权。库和默认选择作为同一记录提交，持久成功后才替换内存引用。

工具声明原生 JSON output 和内容投影：`value` 不自动持久，UI／恢复需要的字段进入 `content/meta`。原生拒绝代码不改写；Nexus 错误经 DSH 标准错误机制保留 code：`NO_AGENT`、`INVALID_ARGUMENT`、`NOT_OBSERVED`、`FILE_CHANGED`、`AMBIGUOUS_EDIT`、`OVERLAPPING_EDITS`、`UNSUPPORTED_ENCODING`、`SHELL_UNAVAILABLE`、`RESOURCE_NOT_AVAILABLE`、`OUTPUT_LOST`、`WRITE_SCOPE_BUSY`、`CONFIG_CONFLICT`、`UNSUPPORTED_CAPABILITY`。

### 4.2 工具输入

| 工具 | 字段 |
| --- | --- |
| read | `path, offset?, limit?`；offset 是 1 起始行号，内部判文本／图片 |
| write | `path, content`；已有文件要求先观察，新文件目标须确实不存在 |
| edit | `path, edits:[{oldText,newText}]`；1～64 项，oldText 非空，唯一精确匹配、禁止重叠 |
| shell | `action:run/open/send/read/status/wait/stop/close/list`；run：`command,engine?,cwd?,background?,timeoutMs?`；open：`engine?,cwd?,name?`；控制：`resourceId`；send：`text,submit?`（默认 true）；read：`cursor?,limit?`；wait：`timeoutMs?` |
| web | `action:search/fetch/read/find`；search：`queries[],maxResults?`；fetch：`urls[]`；read：`resultId,offset?,limit?`；find：`resultId,text,caseSensitive?` |
| agent | `action:start/list/status/read/wait/message/interrupt/stop/continue/batch`；启动：`task,label?,context?:spawn/fork,role?,model?,cwd?,access?:read/write`；控制：`childId`；message/continue：`text`；read：`offset?,limit?`；wait：`timeoutMs?`；batch：`mode:parallel/sequence,tasks:StartInput[]` |

每个 action 使用联合 schema，只接受相关字段，在副作用前验证。web offset 为 0 起始 UTF-16 索引；agent read 为原生记录的 0 起始事件位置；shell cursor 不透明且带资源种类，不能交叉使用。

### 4.3 默认、上限与清理

数值集中于 `runtime/defaults.ts`，设置页只暴露已实现参数：

| 项 | 初始默认／硬边界 |
| --- | --- |
| 文件 | 200 行，允许 1～2,000；输出 32 KiB，允许 1～32 KiB；修改输入最多 16 MiB |
| 普通命令 | 120,000 ms 超时，允许 1～600,000；清理宽限 3,000 ms |
| 进程输出 | stdout/stderr 各 32 KiB 内存、32 MiB spill；单次读取最多 16 KiB |
| 活动资源 | 每 Agent 最多 8 个进程、4 个持久终端 |
| wait | 默认 1,000 ms，上限 30,000；等待超时不杀资源 |
| web | 最多 3 查询／6 URL；默认 5、最多 10 来源；默认 12,000、最多 24,000 字符／页 |
| 网页存储 | 单份 8 MiB；每会话 32 份／32 MiB／7 天，先淘汰最旧 |
| 子 Agent | 初始 spawn／read／继承父模型；并发 4（可设 1～16）、深度 2（0～8）；每批最多 8 项，仍受父有效上限约束 |
| agent read | 默认 20、最多 100 事件，另受 16 KiB 输出界限约束 |
| 提示词 | 默认空选择；最多 32 模块、单项 32 KiB、合计 128 KiB |

文件支持 UTF-8／BOM／LF／CRLF；混合换行未修改部分逐字节保留，其他编码修改明确拒绝。图片服从 Nexus 与宿主更严格限制。

进程状态为 `starting/running/stopping/exited/failed/timed_out/cancelled`，保留原生 exitCode／signal；清理未确认不能标终态。前台取消／超时终止受管范围并等确认；显式后台发布后不随该次工具正常返回而取消，但会话关闭／资源停止必须回收。后台可显式传超时，未传由所有者生命周期负责。

终端 stop 中断前台组，close 结束整个终端；保留 `stdin_read/inferred_idle/timeout/session_exit` 事实，idle 不是任意命令退出证明。scrollback／spill 丢失明确报告，不伪造完整续读。重启不承诺恢复活进程／PTY，旧句柄失效；提示词、保存网页、原生子会话按各自持久语义恢复。

## 5. 实施任务

测试片段列关键断言；其余列举场景也须各有测试。`h/store/owner/path` 等由同任务 fixture 设置，所有测试写入仅限临时目录。默认测试驱动真实工具管线和构建产物，外部网络／进程用受控替身；实际环境另验收。

### Task 1: 双端包与可重复测试底座

**Files:** Create 第 3 节列明的根包／构建文件、`src/{index,config}.ts`、`src/preset/index.ts`、`src/client/index.tsx`、`src/locale/{zh,en}.json`、`scripts/{dev-profile,pack,verify-runtime}.mjs`；Test `test/bundle/{manifest,loader}.test.ts`、`test/support/{harness,browser-loader,fixtures}.ts`。

**Interfaces:** 产出宿主 `apply(ctx:Context,config:Config)`、client `apply(ctx:ClientContext)` 和可构建 preset 子入口；`createToolHarness(options:HarnessOptions):Promise<ToolHarness>`，`call(name,args):Promise<ToolExecutionResult>`／`dispose():Promise<void>`。支持明确 owner 和类型化 FS/web/subprocess 替身；假 loader 驱动真实 bundle 注册／移除。

- [ ] **Step 1：准备可运行测试的最小配置。** 按模板创建缺失文件并安装精确开发依赖；不对已有目录直接运行 scaffold。子入口暂无业务，不宣称核心可用。
- [ ] **Step 2：写 manifest／加载器失败测试。** 测完整身份、双端入口、无第二份 React、重复启停和 disposer：
  ```ts
  // test: registers_packaged_halves_and_disposes_once
  expect(manifest.name).toBe('dsh-nexus')
  expect(manifest.exports['./client']).toBeDefined()
  expect(loadedClientIds).toEqual(['dsh-nexus'])
  expect(disposeCountAfterUnload).toBe(1)
  ```
- [ ] **Step 3：确认红灯。** `pnpm build && pnpm exec vitest run test/bundle`，目标注册断言失败；构建错误先修正，不作红灯证据。
- [ ] **Step 4：实现注册与脚本。** 所有注册绑定 `ctx.effect`；client apply 捕获异常。Node 版隔离脚本替换模板 macOS 专属脚本，参数配置 CLI／端口，只管理项目 `.dev-home`，不改 HOME、不取其他 Profile 凭据、不自动开浏览器或删目录。
- [ ] **Step 5：验证。** `pnpm check` 顺序固定 typecheck→build→test；卸载后零遗留。静态／假 loader 不能声称 GUI 已显示。
- [ ] **Step 6：审查并提交所属文件。** `chore: bootstrap nexus bundle and test harness`。

### Task 2: 状态、调用者与条件持久保存

**Files:** Create `src/protocol.ts`、`src/runtime/{defaults,errors,owner}.ts`、`src/storage/{domain,store}.ts`；Modify `src/config.ts`；Test `test/runtime/{owner,defaults,store}.test.ts`。

**Interfaces:** 实现第 4 节类型、`requireOwner`、`openNexusStore`。库／设置单记录、prompt/web/childPolicy 分表；运行对象不入库。

- [ ] **Step 1：写失败测试。** 固定默认值／非法范围、无 Agent、两窗口旧 hash、落盘失败和重开域恢复：
  ```ts
  // test: rejects_stale_save_without_changing_visible_state
  await expect(store.saveLibrary(next, 'stale')).rejects.toMatchObject({code:'CONFIG_CONFLICT'})
  expect((await store.readLibrary()).value).toEqual(previous)
  expect(resourceStartsAfterAgentlessCall).toBe(0)
  ```
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/runtime`，上述目标断言失败。
- [ ] **Step 3：实现状态层。** `defineDomain`／zod 定义具名表；串行入口检查 hash、提交持久后再更新内存。schemastery `Config` 管部署路径，可变行为走 store；原生策略错误身份保留。
- [ ] **Step 4：验证。** `pnpm exec vitest run test/runtime && pnpm typecheck`；注入保存错误后旧值仍有效，同域重开恢复一致。
- [ ] **Step 5：审查并提交。** `feat: add nexus state and owner boundaries`。

### Task 3: 完整文件工具及同源多处编辑

**Files:** Create `src/fs/{read,write,edit,text,policy}.ts`；Test `test/fs/{read,write,edit,policy}.test.ts`。

**Interfaces:** 消费 owner／settings／原生 FS、附件和模型能力。产出 `createFsTools(ctx:Context,settings:()=>RuntimeSettings):readonly ToolDefinition[]`；`planEdits(original:Uint8Array,edits:readonly TextEdit[]):PlannedEdit` 返回最终 UTF-8 字符串和匹配区间，版本 guard 由调用工具持有。

- [ ] **Step 1：写失败测试。** 覆盖分页、真实 image block、无图能力、先读后改、外部变化、BOM／CRLF／混合换行、非法编码、原子发布失败。对临时文件 `alpha\nbeta\n` 固定：
  ```ts
  // test: rejects_the_entire_multi_edit_when_a_later_match_is_missing
  await h.call('read', {path})
  expect(await h.call('edit', {path, edits:[
    {oldText:'alpha',newText:'A'}, {oldText:'missing',newText:'B'},
  ]})).toMatchObject({isError:true})
  expect(await readFile(path,'utf8')).toBe('alpha\nbeta\n')
  ```
  再测多匹配、重叠、前项生成后项 oldText 均不产生中间结果匹配。
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/fs`，附件／guard／多编辑断言失败。
- [ ] **Step 3：实现 read。** 用受限 FS 读取并按原生协议记录观察版本；图片校验模型／格式后保存附件，不能返回路径假装读图；输出实际范围和下一 offset。
- [ ] **Step 4：实现 write/edit。** 内部重读前取得已有观察的 intent guard，不能通过重读洗掉冲突。全部匹配基于同一原文，统一拒绝重叠，再从后向前替换；换行规范化需原始位置映射，未改字节不变。原生 guard 下原子发布一次，不逐项写、不用 Node FS 绕权限。
- [ ] **Step 5：验证并提交。** `pnpm exec vitest run test/fs test/runtime && pnpm typecheck`；拒绝时底层写次数为 0。`feat: add guarded nexus file tools`。

### Task 4: Windows-aware 独立进程与输出

**Files:** Create `src/shell/{engines,process,output}.ts`；Test `test/shell/{engines,process,output}.test.ts`；Modify `test/support/fixtures.ts`。

**Interfaces:** `ShellExecutionConfig = { deployment: Config; terminal: RuntimeSettings['terminal'] }`；`resolveEngine(kind:ShellEngine,config:ShellExecutionConfig):Promise<ShellEngineSpec>` 返回绝对路径／固定参数／方言；`startProcess(ctx:Context,owner:CallOwner,input:RunInput,config:ShellExecutionConfig):Promise<ManagedProcess>`。宿主 `ManagedProcess` 持有 handle、`view():ProcessView`、`read(cursor?:string,limit?:number):Promise<OutputPage>`、`stop(cause:'user'|'timeout'|'cancel'|'dispose'):Promise<ProcessView>` 和 `done:Promise<ProcessView>`，不跨端传输。

- [ ] **Step 1：写失败测试。** 两次普通调用不继承 cd／变量；默认 Bash、失败不换 pwsh；中文／空格 argv；跨块 UTF-8、非零退出、启动失败、超时／取消、孙进程存活：
  ```ts
  // test: keeps_unconfirmed_process_trees_managed_without_shell_fallback
  expect(processWithLiveGrandchild.view()).toMatchObject({status:'stopping',cleanupConfirmed:false})
  expect(pwshStartsAfterBashFailure).toBe(0)
  ```
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/shell/engines.test.ts test/shell/process.test.ts test/shell/output.test.ts`。
- [ ] **Step 3：实现引擎执行。** 显式路径优先，其次系统 Git 安装信息／标准位置，不误选 WSL bash；pwsh 验证为 7。Bash `--noprofile --norc -c`，pwsh 无 profile 非交互；argv/cwd 分开，清除隐式 BASH_ENV，可信 DSH 变量由 shellEnv 提供，不转发完整环境。
- [ ] **Step 4：实现权限、输出和状态。** 解析原生 sandbox policy、confine 完整命令，保留 Windows partial enforcement；collected／spill 如实报告丢失。停止后等待 `waitForExit`，不能仅凭 `done` 确认整树退出；未确认继续受管。
- [ ] **Step 5：验证并提交。** 上述测试及 `pnpm typecheck`；最小 PATH 无 Pi bin 仍能发现系统 Shell。`feat: add managed shell execution`。

### Task 5: 单 Shell 的后台／持久终端／控制

**Files:** Create `src/shell/{tool,jobs,terminals}.ts`、`test/shell/{tool,jobs,terminals}.test.ts`；Modify `src/shell/{process,output}.ts`。

**Interfaces:** `createShellTool(ctx:Context,config:()=>ShellExecutionConfig):ToolDefinition`；`registerTerminalBackends(ctx:Context,config:()=>ShellExecutionConfig):()=>void`。后台使用原生 jobs，terminal service 位于 Nexus realm；两类资源不可混控。

- [ ] **Step 1：写失败测试。** process 后台不是 terminal；open/send 保留状态但不改会话 cwd；busy、重复停止、丢失 cursor、无 controller、退出后续读、卸载异常：
  ```ts
  // test: rejects_foreign_handles_and_preserves_unconfirmed_status
  expect(await otherOwner.call('shell',{action:'stop',resourceId})).toMatchObject({isError:true})
  expect(statusAfterInferredIdle).not.toMatchObject({status:'exited'})
  expect(statusAfterStopRequest).toMatchObject({cleanupConfirmed:false})
  ```
  同 sessionId 旧 Agent、重启旧句柄也必须拒绝。
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/shell`。
- [ ] **Step 3：实现原生适配。** 绑定 job controller／所有者清理；后台发布后脱离本次等待，不脱离会话。懒加载两个 `BashTerminalBackend` 方言，首次 open 才要求程序存在；配置形状从公开构造器参数推断，内部 `ResolvedConfig/resolveConfig` 非根导出，不 deep-import。不自建 PTY 或全局任务服务。
- [ ] **Step 4：实现控制与通知。** 原生 job reporter 只报一次；wait 超时不杀资源；terminal stop 与 close 分离，read 不消费其他观察者输出。spill 只通过受控输出读，不开放任意日志路径；卸载只处理 Nexus 自有资源并报告清理失败。
- [ ] **Step 5：验证并提交。** `pnpm exec vitest run test/shell test/runtime && pnpm typecheck`。`feat: complete shell jobs and persistent terminals`。

### Task 6: DSH 联网与可恢复 read/find

**Files:** Create `src/web/{tool,backend,results,extract}.ts`、`test/web/{tool,results,extract}.test.ts`。

**Interfaces:** `createDshWebBackend(ctx:Context):WebBackend` 仅包装当前 search/fetch；`createWebTool(ctx:Context,store:NexusStore,settings:()=>RuntimeSettings):ToolDefinition`。批量 JSON value 为 `{items:WebItemResult[]}`，每项有输入、ok/error、成功 resultId 或独立错误；read/find 返回该文档范围／位置。

- [ ] **Step 1：写失败测试。** 部分失败、只有摘要、上游／保存截断、分页无漏失、定位范围、重开恢复、过期／淘汰／跨 owner：
  ```ts
  // test: preserves_partial_web_results_without_refetch_or_fallback
  expect(batchReply).toMatchObject({value:{items:[{ok:true},{ok:false},{ok:true}]}})
  expect(networkCallsDuringReadAndFind).toBe(0)
  expect(hiddenProviderFallbackCalls).toBe(0)
  ```
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/web`。
- [ ] **Step 3：实现后端与保存。** 有限并发、逐项 all-settled 保持输入顺序；不切账户／供应商。保留实际内容，HTML 安全转换另标转换结果；持久完成后才给可续读 ID，不把摘要包装成全文。
- [ ] **Step 4：实现续读／定位。** 按限额淘汰，引用保留来源、实际边界和丢失标志；外部文本标为不可信资料，不能自动进入提示词库。后端缺失／额度错误明确反馈，说明现有请求可能消耗额度。
- [ ] **Step 5：验证并提交。** `pnpm exec vitest run test/web test/runtime && pnpm typecheck`。`feat: add native-backed nexus web tool`。

### Task 7: 内部子 Agent 与协作写入隔离

**Files:** Create `src/agent/{tool,internal,coordination,policy}.ts`、`test/agent/{internal,coordination,policy,batch}.test.ts`。

**Interfaces:** `createWriteCoordinator(ctx:Context):WriteCoordinator`；其 `acquire(owner:Agent,childId:SessionId,cwd:string):Promise<WriteLease>`，`release():void` 幂等。`createAgentTool(ctx:Context,store:NexusStore,settings:()=>RuntimeSettings,coordinator:WriteCoordinator):ToolDefinition`；`registerChildPolicy(ctx:Context,store:NexusStore,coordinator:WriteCoordinator):()=>void`。coordinator 由顶层 runtime 持有，跨会话／预设代际共享，不用模块全局变量。

- [ ] **Step 1：写失败测试。** spawn/fork、快照、模型／动态角色、目录和原生 child、消息／通知／输出、interrupt/stop/continue、批次逐项结果：
  ```ts
  // test: bounds_internal_delegation_and_rejects_conflicting_writers
  expect(externalCliStarts).toBe(0)
  expect(fifthConcurrentStart).toMatchObject({isError:true})
  expect(overlappingWriteStart).toMatchObject({isError:true,error:{info:{code:'WRITE_SCOPE_BUSY'}}})
  ```
  再测并发 4、深度 2、批次 8；大小写／junction 规范路径、祖先子目录冲突、越权 cwd、只读 child 经 shell/edit 写入被拒绝。
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/agent`。
- [ ] **Step 3：实现原生路由／权限。** 只用内部 spawn/fork，startActivation 的 parent 为确切 Agent，cwd 用公开字段。先预留 childId／保存策略，再在串行 agent/created、首请求前用原生 sandbox-mode 写入口收窄权限；fork 同样检查。父 workspace-write 不能委派到授权根外；只读默认、写入最多父已授权 workspace-write，不因委派扩大权限。
- [ ] **Step 4：实现协作与控制。** canonical cwd 冲突在启动前拒绝，隔离目录／已有 worktree 可并发；不自动建删用户分支。驻留可续用 child 保留写租约，顺序批次确认并 drain 后再开下一项；冷恢复／原生 UI 继续也重验策略／租约。启动失败清除预留记录。continue 用原生续用语义，不克隆冒充；不可支持明确报错，parent/caller delivery 不重复通知。
- [ ] **Step 5：验证并提交。** `pnpm exec vitest run test/agent test/runtime && pnpm typecheck`；stop 等 dispose，interrupt 仅确认请求。`feat: add internal agent orchestration and write coordination`。

### Task 8: 系统提示词字面拼接与会话快照

**Files:** Create `src/prompts/{base,assemble,sessions,register}.ts`、`test/prompts/{assemble,sessions,request}.test.ts`。

**Interfaces:** `BASE_PROMPT:string`；`assemblePrompt(library:PromptLibrary,selection:readonly string[]):string`；`createPromptSessions(ctx:Context,store:NexusStore):PromptSessions`。该实例提供 `initialize(agent:Agent):Promise<PromptSnapshot>`、`apply(agent:Agent,selection:readonly string[],expectedLibraryHash:string):Promise<PromptSnapshot>`、`peek(agent:Agent):PromptSnapshot`，持有按精确 Agent 隔离的内存引用；`registerPromptSections(ctx:Context,sessions:PromptSessions):()=>void`，不使用模块全局缓存。

- [ ] **Step 1：写失败测试。** 捕获 DSH 真实请求构造边界，验证系统角色，不自造 role 数组：
  ```ts
  // test: keeps_literal_system_sections_and_applies_only_to_the_next_request
  expect(systemText).toContain('{{secret}}')
  expect(systemText).toContain('${HOME}')
  expect(systemText).toContain(thirdPartySection)
  expect(requestA.system).toBe(oldSystem)
  expect(requestB.system).toBe(newSystem)
  ```
  requestA 发出后 apply，再构造 B；另测落盘失败仍旧、编辑／删除库不改既有快照、默认不改旧会话、child 继承父当时实际文本、恢复用持久正文。断言附加内容不在 user/history，AGENTS 仍独立生效。
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/prompts`。
- [ ] **Step 3：实现拼接与快照。** 下文原文写入 base.ts；按选择顺序用两个换行拼接、拒绝重复／不存在 id。apply 核对库 hash 并捕获完整正文，先持久再原子替换实例内引用；新会话默认、child 复制父实际快照、恢复已有正文优先。
  ```text
  你是一名运行在 DeepSeek Harness（DSH）Agent 框架内的专业编程助手。

  你通过读取文件、执行命令、编辑代码和创建文件，高效地帮助用户完成任务，并交付高质量的成果。
  ```
- [ ] **Step 4：注册系统贡献。** 在每个 Nexus Agent 作用域替换 persona 具名 prefix，不清其他 section；`interpolate:false`、非 complete。顺序不创造更高指令等级，UI 说明仍受服务商／权限约束。串行 agent/created 先 initialize，再让 section 闭包捕获该 Agent、同步读取 `sessions.peek(agent).text`，不猜 opaque scope id；apply 不 interrupt、不改已发请求。
- [ ] **Step 5：验证并提交。** `pnpm exec vitest run test/prompts test/agent && pnpm typecheck`，请求证据不含认证头。`feat: persist literal system prompts per session`。

### Task 9: 固定 Nexus 组合与原生保留边界

**Files:** Create `src/runtime/service.ts`、`src/preset/{definition,native}.ts`、`test/preset/{composition,scope,lifecycle}.test.ts`；Modify `src/index.ts`、`src/preset/index.ts`、`package.json`、`cordis.patch.yml`。

**Interfaces:** `detectNativeComposition(ctx:Context):NativeComposition` 记录可继承的全局能力；`createNexusPreset(config:Config,native:NativeComposition):PresetDefinition` 返回 id `nexus`。顶层 `NexusRuntime` 持有 store、settings、coordinator、PromptSessions，提供 `getShellConfig():ShellExecutionConfig`；子入口只注册本预设贡献。

- [ ] **Step 1：写失败测试。** 实际可见定义不是固定 9 个：
  ```ts
  // test: adds_nexus_core_without_filtering_other_presets_or_extra_tools
  expect(names).toEqual(expect.arrayContaining([
    'read','write','edit','shell','web','agent','skill','ask_user_question','todo_write','example_extra_tool',
  ]))
  expect(standardAfter).toEqual(standardBefore)
  expect(registrationCountAfterUnload).toBe(initialRegistrationCount)
  ```
  同时测多会话不串 scope、有效压缩存在、cold path inject、重复启停。
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/preset`，不是仅查 YAML。
- [ ] **Step 3：实现组合。** 显式挂原生 skill-filesystem/tool-skill、agent-instructions、ask、todo 及必要依赖；不挂被替代原生 FS／搜索／Shell／web／subagent 工具。非替换范围的宿主贡献不额外禁用；若受支持组合存在全局重复工具，只在确认第一方归属后 Nexus 内定点限制，不按陌生名字封禁、不全局 allowlist。
- [ ] **Step 4：落实运行机制／清理。** terminal service／backend／消费者同 realm。压缩若全局有效则继承；若只属于 standard，则 Nexus 挂等效隔离 compaction-basic／command-compact／tool-result-pruner（8192/4096/1024）组；保持一个有效机制，具体第三方适配见 Task 13。顶层先 drain 预设资源再关 store，注册诊断放宿主就绪后，避免等待自己加载完成。
- [ ] **Step 5：验证并提交。** `pnpm check`，确认无原生预设／安装文件变更。`feat: compose nexus without global tool filtering`。

### Task 10: 受控配置 API 与精确会话应用

**Files:** Create `src/http/{routes,guards}.ts`、`test/http/{routes,guards}.test.ts`；Modify `src/index.ts`、`src/protocol.ts`。

**Interfaces:** `registerRoutes(ctx:Context,runtime:NexusRuntime):()=>void`。前缀 `/api/dsh-nexus/`：GET/PUT `library`、`settings`（PUT 带 expectedHash）；POST `prompts/preview`（草稿，仅预览）；GET `sessions`（live Nexus id／标题）；GET/POST `sessions/:id/prompt`（读快照／以 selection、expectedLibraryHash 调用 PromptSessions.apply）；GET `capabilities`（后端注册事实、未验证项、设置定位、临时 csrfToken）。

- [ ] **Step 1：写失败测试。** 非 loopback、非法 Origin/Host、method、非 JSON、超 256 KiB、无防伪 token、错误／已销毁／非 Nexus 会话、旧 hash、保存失败：
  ```ts
  // test: rejects_unsafe_console_writes_before_applying_any_change
  expect(crossOriginWrite.status).toBe(403)
  expect(oversizeWrite.status).toBe(413)
  expect(applyCallsAfterRejectedRequests).toBe(0)
  ```
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/http`。
- [ ] **Step 3：实现请求边界。** 具名 route 不受 SPA launch token 自动保护；检查 loopback／认可的本地 Host／同源，写请求须 JSON 和 `X-Nexus-CSRF`。token 在成功 GET capabilities 返回、插件实例内随机签发，不开放 CORS。错误不泄露 stack／凭据，输入先验证。
- [ ] **Step 4：实现应用。** 写前重查精确 live Nexus Agent，固定请求目标，不能猜第一个会话；只从已保存库应用，未保存草稿不标已应用。持久成功再回成功，运行中只影响下一请求。
- [ ] **Step 5：验证并提交。** `pnpm exec vitest run test/http test/prompts && pnpm typecheck`。`feat: add guarded nexus console APIs`。

### Task 11: 统一控制台与五个实际子页

**Files:** Create `src/client/{api,store}.ts`、`src/client/console.tsx`、`src/client/styles.css`、`src/client/pages/{prompts,tools,terminal,agents,integrations}.tsx`、`test/client/{console,prompts,settings}.test.ts`；Modify `src/client/index.tsx`、`src/locale/{zh,en}.json`。

**Interfaces:** `createConsoleStore(api:NexusApi):ConsoleStore` 暴露受保护 getSnapshot/subscribe；NexusApi 对应 Task 10；`NexusConsole` 与 pages，不另造账号接口。

- [ ] **Step 1：写交互失败测试。** 新增／编辑／勾选／排序／预览、保存默认和应用分离；失败留草稿、两窗口冲突、切目标的迟到响应：
  ```ts
  // test: preserves_unsaved_drafts_and_uses_the_explicit_session_target
  expect(draftAfterSaveFailure).toEqual(editedDraft)
  expect(appliedSessionId).toBe(explicitTargetId)
  expect(visibleText).not.toMatch(/配置版本号|版本差异|有更新可用/)
  ```
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/client/console.test.ts test/client/prompts.test.ts test/client/settings.test.ts`。
- [ ] **Step 3：实现入口／提示词页。** 新增 sidebar/main/settings 入口，不替换布局；基础只读、模块编辑／选择／排序／预览／默认／会话应用齐全。使用有文档的当前会话绑定，缺失时明确选择 live Nexus 目标；没目标禁用应用，不自动取第一项。
- [ ] **Step 4：实现其他子页。** tools 配文件／网页输出；terminal 配默认引擎、部署路径、超时并显示实际检测；agents 配模型／角色／并发／深度；integrations 显示可用性／兼容诊断并定位原生设置。只提供实际支持字段／链接，无占位页、功能装配矩阵。locale 和 `--dsw-alias-*` token 统一，apply/inject/外部快照异常隔离。
- [ ] **Step 5：验证并提交。** `pnpm exec vitest run test/client test/bundle && pnpm typecheck`；主题 token 测试不代替真实视觉。`feat: add nexus configuration console`。

### Task 12: 新工具呈现与安全历史回放

**Files:** Create `src/client/tool-views.tsx`、`src/client/tool-models.ts`、`test/client/tool-views.test.ts`；Modify `src/client/index.tsx`、`src/locale/{zh,en}.json`；仅有呈现字段缺失时补对应工具 durable meta。

**Interfaces:** `registerNexusToolViews(ctx:ClientContext):()=>void`，消费真实 preparing/start/result owner payload 和 content/meta；不消费只在执行期存在的 value。

- [ ] **Step 1：写失败测试。** preparing 未闭合、历史 meta 缺失／恶意字段、error/stopped、PTC 子调用：
  ```ts
  // test: safely_replays_malformed_results_without_inventing_completion
  expect(() => renderMalformedRecordedResult()).not.toThrow()
  expect(backgroundLaunchLabel).not.toBe('已完成')
  expect(stopRequestedLabel).not.toBe('已退出')
  ```
  核验新 read/write/edit 字段与原生卡兼容，不能只凭名字假定适配。
- [ ] **Step 2：确认红灯。** `pnpm exec vitest run test/client/tool-views.test.ts`。
- [ ] **Step 3：实现 keyed renderer。** 注入 `tool.call.toolview` 的 shell/web/agent key；不重建会话树／事件配对、不导入非公开宿主 UI。必要覆盖 read/write/edit 时用低 priority shadow 保留原生 fallback，不能同优先级抢占。
- [ ] **Step 4：接通附件／原生子会话。** 授权图片 loader、原生 child 打开机制；历史卡只显示当时记录，不查当前资源改写历史；不兼容数据退 generic。
- [ ] **Step 5：验证并提交。** `pnpm check`；覆盖注册／移除／fallback。`feat: render nexus tool results safely`。

### Task 13: 原生机制与具体第三方兼容验证

**Files:** Create `test/integration/{preset,native,prompts,cleanup}.test.ts`、`test/integration/third-party-fixture.ts`、`vitest.integration.config.ts`、`docs/testing/manual-acceptance.md`；Modify `scripts/{dev-profile,verify-runtime}.mjs`、`package.json`；缺陷修复限定于对应实现。

**Interfaces:** `pnpm test:integration` 使用项目隔离实例、真实 DSH 服务与受控模型提供方；默认 test 和此配置均排除 windows 验收文件。记录具体插件／版本／scope，不用“未封禁”作证明。

- [ ] **Step 1：写组合失败测试。** test-only 插件提供额外工具、系统 section、只匹配 standard 的压缩 fixture；新增技能必须先摘要发现、调用后正文加载：
  ```ts
  // test: verifies_native_skill_loading_and_actual_third_party_compatibility
  expect(skillBodyBeforeLoad).toBe(false)
  expect(skillBodyAfterLoad).toBe(true)
  expect(nativeOnlyCompressionDiagnostic.compatible).toBe(false)
  expect(thirdPartyToolInvocationSucceeded).toBe(true)
  ```
  ask/todo 实际完成，模型/user 调用标记保留。
- [ ] **Step 2：确认红灯。** `pnpm test:integration`；仅 dump 配置或零测试不算。
- [ ] **Step 3：检查具体压缩插件。** 全局有效不重复挂；只绑定原生 ID 且有公共配置则正规适配；无公共适配点给阻塞，不改安装文件、不另叠压缩掩盖。缺插件／权限则 AC-16 记未验证。
- [ ] **Step 4：验证实际生命周期／请求。** 同 ID 旧 Agent、多会话、关闭 job/PTY/child、热卸载、重开 prompt/web、callee inject cold path；模型替身捕获真实 DSH 请求组装，不是手写数组自证系统角色。
- [ ] **Step 5：验证并提交。** `pnpm check && pnpm test:integration`。`test: verify nexus with native and third-party services`。

### Task 14: Windows、真实 Harness 与安装包验收

**Files:** Create `vitest.windows.config.ts`、`test/integration/windows.test.ts`、`docs/testing/verification-record.md`、`README.md`；Modify `docs/testing/manual-acceptance.md`、`scripts/{dev-profile,pack}.mjs`、`package.json`；缺陷先补所属回归测试。

**Interfaces:** `pnpm test:windows`、`pnpm pack:plugin`；持久 tarball 路径和逐 AC 证据。实际账号／页面仅用明确允许访问的实例。

- [ ] **Step 1：写实际 Windows 测试并运行。** 中文／空格目录下 Bash/pwsh 独立、后台、持久输入、非零、失败、取消／超时、父孙进程；无 Pi PATH，真实 read-only／越根写入拒绝：
  ```ts
  // test: proves_windows_owned_tree_cleanup_and_write_policy_enforcement
  expect(await ownedHandle.waitForExit(cleanupSignal)).toBe(true)
  expect(readOnlyWrite.exitCode).not.toBe(0)
  expect(workspaceEscapeWrite.exitCode).not.toBe(0)
  ```
  非 Windows 显式拒绝此验收，不能全 skip 后标通过。
- [ ] **Step 2：通过权限风险门。** Git Bash 必须在目标 DSH 权限链实际可运行；若沙箱不兼容，保留命令／策略／最小复现并阻塞交付，不能自动换 pwsh／提高权限。Windows partial 限制如实记录，可提前执行此门暴露阻塞。
- [ ] **Step 3：真实界面／请求／账号验收。** 先查已有进程／端口，优先已连接页面；必要时仅启动项目隔离实例并记录 PID／端口，不新开浏览器冒充验证。实际看五子页／双主题／保存反馈、图片送模、child 打开／观察／介入、系统字段；不导出认证头。当前 DSH 账号实际 search/fetch，无授权／账号则列未测，不找其他 Profile 凭据。
- [ ] **Step 4：代表任务与打包安装。** 临时 workspace 做“读含图资料→多处编辑→测试→后台／交互→联网→内部委派→父任务整合”；记录选错工具／参数错／轮询／上下文／结果，不只数名字。运行 check、integration、windows；pack 到 dist 并检查发布内容。正规 bundle 工具把 tarball 装入隔离 Profile，读取 application/warnings，刷新／必要重启复验；不手改 Profile、不在内运行 pnpm，不未经允许安装日常 Profile。
- [ ] **Step 5：验收／清理并提交。** 逐 AC 记录实际证据和未测原因，关闭本次资源；核心／真实验收缺项不能宣称完成。`test: validate and package complete nexus core`，不自动推送合并。

## 6. 验收覆盖和命令

| 验收 | 任务 | 不能省的证据 |
| --- | --- | --- |
| AC-01 | 1/9/14 | tarball、独立预设、原生未改 |
| AC-02 | 9/13 | 实际定义、无重复、额外工具可调用 |
| AC-03 | 3/14 | 分页／真实附件／目标模型 |
| AC-04 | 3 | guard、同源编辑、字节／原子失败 |
| AC-05 | 4/5/14 | 独立与持久状态对照 |
| AC-06 | 5/13/14 | 查询续读／真实停止清理 |
| AC-07 | 4/14 | Windows 两 Shell／路径／树／权限 |
| AC-08 | 6/14 | 当前后端实际请求、无隐藏切换 |
| AC-09 | 6/14 | 来源／范围／续读定位／逐项失败 |
| AC-10 | 9/13 | 原生技能发现加载／ask/todo |
| AC-11 | 7/12/14 | 任务内委派／原生查看介入 |
| AC-12 | 7/13/14 | 通信状态／通知回收／写协调 |
| AC-13 | 8/13/14 | 实际请求系统层与其他贡献 |
| AC-14 | 2/8/10/11/13 | 默认隔离／下一请求／恢复原文 |
| AC-15 | 10/11/14 | 五子页、无版本／对比／更新 UI |
| AC-16 | 9/13 | 具体第三方／压缩适配 |
| AC-17 | 全部 | 完整核心／代表性开发任务 |
| AC-18 | 9/11/14 | 无后置装配／多预设／装配管理 |

需求分组交叉检查：CORE-01～06→9/13；FS-01～07→3；SH-01～13→4/5/14；WEB-01～09→6/14；AG-01～11→7/12/14；NAT-01～07→9/13；PR-01～18→8/10/11/13；UI-01～05→10/11/12/14。

阶段门：Task 1～3 只是底座／文件，不能最终交付；4～7 形成执行契约；8～12 接通预设／提示词／控制台；13～14 才完成具体兼容和真实运行验收。静态、替身或挂载成功不能替代后两个阶段。

脚本在所属任务建立，不先放空脚本返回成功：

- `pnpm typecheck`：宿主和浏览器两个配置；`pnpm build`：根、preset、client 三入口。
- `pnpm test`：默认离线行为；`pnpm check`：严格 `typecheck && build && test`。
- `pnpm test:integration`：实际隔离服务／受控请求；`pnpm test:windows`：真实 Windows 专项。
- `pnpm dev:profile -- init|dump|boot --port <port>`：项目私有 DSH home，不改 HOME，不自动开浏览器。
- `pnpm pack:plugin`：先 check 再打包／检查内容，保留 tarball，不默认安装日常 Profile。

`verification-record.md` 分静态、离线行为、构建 bundle、隔离组合、真实 GUI、真实模型／联网账号记录命令或操作、版本、结果、未测原因；不得保存凭据／私有对话全文／环境快照。

## 7. 自检与交接

计划编写期检查：逐段对照规格及上述需求／验收表；核对前后接口、Review Focus 测试、任务 red/green 命令、实际与模拟验证边界。实施框保持未勾选，计划阶段只新增本文，不初始化工程／安装依赖／启动服务／修改 Profile。

**等待审阅和执行方式确认。** 可选当前会话原生逐任务实施后整体验收／独立评审，或逐任务子 Agent 实施及独立审查；两者均不得跳过权限、恢复、兼容和真实运行门。
