# 验证记录（Task 14 分层证据，UI 修复待独立评审）

本文按「静态 → 离线行为 → 构建 bundle → 隔离组合 → 真实安装 → 真实 GUI／账号」分层记录**实际执行过**的验证。每一行都写明命令或操作、版本、结果，以及没有验证的原因。没有执行的项一律写「未验证」，不用替身、模拟页面或推测填补。

## 0. 当前：0.1.8 工具调用显示修复二（设置读取落定信号／警告去重）

状态：**IMPLEMENTED_PENDING_REVIEW / INSTALLED_PENDING_USER_RELOAD**。本波只关两份复查（`task-14-tool-display-spec-rereview-r1.md`、`task-14-tool-display-quality-rereview-r1.md`）对 0.1.7 修复本身点到的两处「波及面」风险，外加文档；没有新增页面、端点、依赖，卡片标记、工具名、已记录事实、折叠结构、工具 schema 与字典键一律未改。日常 `web` Profile 已用官方管理器装到 0.1.8，但**没有**重启、刷新或重载用户的应用／浏览器／会话，实际渲染仍是待用户重载，本节不是最终验收。

- P2（全局提示被当成设置信号）：0.1.7 用 `snapshot.notice === 'error'` 判断「设置读取失败」；但 `notice` 是 store 级提示，任何请求失败都会发布它，包括 `readLibrary`。于是「库读取先失败、设置 GET 还在路上」时，客户端会退回 `nexus` 并占用 rank 0，正好把上一波关掉的启动窗口又打开（第三方以默认等级注册同名 key 时会因同 key 同优先级抛错）。现在 store 新增快照字段 `settingsSettled`：设置请求成功（`acceptSettings`）与失败（`readSettings` 的 `catch`）两处都置真；`src/client/index.tsx` 的退回条件改为它，不再看全局 `notice`。语义保持不变：模式未知（无草稿、无已保存值、设置读取也没落定）时不注册任何单元格；读取落定且失败才退回 `nexus`；读取成功按存储模式注册。
- 同波加固（如实披露，是本波唯一超出「两处小修」的改动）：如果 refresh 第一段（capabilities／sessions）就失败，原来的代码根本不会去读设置，`settingsSettled` 会永远为假，于是「控制台 API 完全不可用」的组合里 Nexus 卡片会永久消失（0.1.7 靠全局 `error` 退回还能显示）。为不制造新的波及面，`refresh()` 现在把两处读取放在 roster 段之后单独执行：roster 失败只发布既有错误提示，两个读取照旧运行，所以设置读取一定会落定，退回语义在降级路径上同样可达。依赖「无宿主」的两套回归用例（`test/client/tool-views.test.ts` 16 条、`test/bundle/loader.test.ts` 17 条）改前改后都通过，未作改动。
- P2（警告刷屏）：`ctx.slots.inject` 被拒绝时仍不把模式记为已应用（后续发布继续重试，0.1.7 的行为保留），但警告改成「每个请求模式只报一次」：记下 `warned`，模式没变就不再重复打印；请求的模式真正变化时（`mode !== requested`）清空闩锁，所以问题修好后再次被拒仍会重新告警。用例同时断言「每次发布仍在重试」（注入次数 +2）与「警告数仍为 1」，模式切换后警告数变 2。
- TDD（先失败）：改源码前新增 2 条用例并真实失败——`expected [ 'shell', 'web', 'agent' ] to deeply equal [ 'shell' ]`（库读取失败、设置读取被挂起时 Nexus 抢占了 rank 0）与 `expected 2 to be 1`（读取落定时已经重复警告两次）。日志 `tmp/task14-tool-display-fix2/red-client-1.log`（2 failed / 13 passed）；改后 `green-client-1.log` 15/15。
- 聚焦回归：`pnpm exec vitest run test/client` **8 文件 / 66 测试通过**（`focused-client-2.log`）；`pnpm build` 后 `pnpm exec vitest run test/bundle` **2 文件 / 17 测试通过**（`bundle-loader.log`）；`pnpm typecheck` exit 0。
- 最终门禁只跑一次：`pnpm pack:plugin`（typecheck → build → 默认套件 → 包检查）**43 文件 / 609 测试，exit 0**，产物 `dist/dsh-nexus-0.1.8.tgz` = **464,117 字节、15 个成员、SHA-256 `f3513b5f652136543be5e1d43b5ffa0cdfd8c16743350023a5db63ef4a43e835`**（`tmp/task14-tool-display-fix2/pack.log`）。`pnpm verify:runtime` exit 0（`dsh-nexus 0.1.8 targets dsh 0.2.1-rc.2`，`verify-runtime.log`）。集成 16／Windows 13 仍是 651604b 的历史证据，本波按范围没有重跑。
- 产物可重建：包由提交 `da9f687` 的树打出；15 个成员中 14 个与工作树逐字节相同（只有 `package.json` 因 pnpm pack 规范化字段顺序差 1 字节：6352 vs 6353，属打包器行为，与 0.1.6／0.1.7 同）；同一棵提交树再 `pnpm build` 一次，11 个 `lib/` 成员**全部逐字节相同**（`members-after-rebuild.json`）；再用 `pnpm pack` 打到临时目录，两个 tarball 的 SHA-256 **完全相同**（`f3513b5f…`，`repack.log`）。
- 日常安装：唯一命令 `dsh plugin --profile web add E:/Programme/Project/dsh-nexus/dist/dsh-nexus-0.1.8.tgz`，2026-11-02T16:16:26Z 开始、16:16:32Z 结束，**真实 exit 0**；完整 stdout/stderr 在 `tmp/task14-tool-display-fix2/official-install-output.log`，exit 单独存 `official-install-exit.txt`。输出是既有的 peer 警告与 `Packages: +3 -2`、`Done in 2.5s`。安装前后：21 个声明依赖、23 条 bundle、`dsh-nexus` 只有一条；15/15 tarball 成员与 `node_modules/dsh-nexus` 下文件逐字节相同（含 packed `package.json` 与内嵌 CSS 的 `lib/client.js`）；除 Nexus spec 更新为 0.1.8 外，Profile manifest 无其它语义变化，其余 20 个声明包的安装版本与 manifest hash 均未变（`before-inventory.json`／`after-inventory.json`）。安装前后 127.0.0.1:3080（PID 23616）与 18787（PID 34640）监听完全不变，62699 前后都没有监听；未重启、未终止、未刷新用户的应用／浏览器／会话。状态因此是 `INSTALLED_PENDING_USER_RELOAD`：只证明安装落盘，不证明已打开的页面用了新 JavaScript。
- 残余限制（本轮明确记录、不修）：设置 GET **永远不返回**时，客户端拿不到「设置读取落定」，于是不注册任何 Nexus 卡片，宿主自己的通用卡片继续渲染——这是「等模式」的固有代价。本波不加请求超时，因为 `src/client/api.ts` 的 `request()` 被每个调用共用，新增 abort 路径比本波大，应作为独立任务。0.1.7 已披露的另一条限制不变：设置读取**落定失败**时仍按 `nexus` 退回 rank 0（用户能看到 store 的既有错误提示），所以那种错误场景下原本的互撞风险仍然存在。
- 英文说明仍是推断：`en.json` 的 `roughly “Tool call · run”` 来自「宿主把名字当未知工具、用第一个字符串参数当摘要」的既有事实，**没有**在英文宿主上截过真实渲染，所以保持 hedge 措辞，本波未改文案。
- **没有证明的事**：本轮没有重启应用，所以没有新的真实浏览器／像素证据；启动窗口时序只在 jsdom 里对真实 `SlotRegistry` 证明，没有在真实页面启动、真实第三方皮肤组合下证明；0.1.6 的隔离 Profile 台账仍是三个模式**稳态**的浏览器证据。真实模型产生的卡片外观、DPI／zoom、账号／模型、图像／web／子 Agent／AC-17 仍未验证；AC-07 受限 Git Bash 环境阻塞不变。本轮未作交付、接受、推送或合并。

## 历史：0.1.7 工具调用显示修复（启动窗口／文案／重试）

状态：**IMPLEMENTED_PENDING_REVIEW / INSTALLED_PENDING_USER_RELOAD**。本波只修两份评审（`task-14-tool-display-spec-review.md` 的 1 个 P1 与 2 个 P2）指出的问题，没有新增功能、页面、端点或依赖，卡片标记、工具名、已记录事实与折叠结构一律未改。日常 `web` Profile 已用唯一官方命令装到 0.1.7，但**没有**重启、刷新或重载用户的应用／浏览器／会话；实际渲染仍是待用户重载，本节不是最终验收。

- P1（启动窗口）：`src/client/index.tsx` 的模式读取现在返回 `undefined`，直到第一次设置读取落定：既没有草稿、也没有已保存值时**不注册任何单元格**；读取成功后按存储模式的等级注册（`nexus` 0、`auto` 10、`native` 不注册）；读取失败（store 发布 `error`）则退回 `nexus`，让用户照样看到卡片。这样存了 `auto`／`native` 的用户在读取期间不再占用等级 0，第三方视图插件以默认等级注册同名 key 时不会因「同 key 同优先级」抛错、丢掉自己的单元格。原有的「先 dispose 再注册一次、模式不变不重复注册、卸载清理」全部保留。
- P2（重试）：`ctx.slots.inject` 抛错时不再把模式记为已应用，而是在 `catch` 里把 `active` 清回未知，后续发布可以重试；槽位缺失时的既有警告不变。
- P2（文案）：英文 `toolDisplayNativeHelp` 不再引用中文宿主字面量“工具调用 · run”，改为与语言无关的描述（宿主把名字当未知工具、用第一个字符串参数当摘要，所以 `shell` 调用大致显示为 `Tool call · run`）；中英 `toolDisplayHelp` 各加一句：切换会立即在本页预览，但只有「保存全部设置」才让它成为已保存默认（中文原文含义不变）。中英字典键集合仍完全一致。
- TDD（先失败）：新增 6 条客户端用例，其中 4 条在改源码前真实失败——`auto` 与 `native` 启动窗口（第三方已占 rank 0 时仍被 Nexus 占用）、首次读取失败仍应退回 `nexus`、`inject` 抛错后应能重试；日志 `tmp/task14-tool-display-fix/red-final-source.log`（同一用例集在 HEAD 源码上的运行，4 failed / 9 passed）与第一次编写时的 `red-client-1.log` 都保留。另外 2 条是评审点名的缺口护栏（nexus 模式下先占 rank 0 的第三方只让 `shell` 让位、其余两键仍在；卸载清空三个 key），它们在修复前已通过，如实标注为护栏而非新失败。
- 回归适配（如实披露）：`test/client/tool-views.test.ts` 与 `test/bundle/loader.test.ts` 原先假设 `apply` 后卡片立即注册；P1 修复后注册要等第一次读取落定，所以这些渲染／计数用例改为等待该读取（无宿主时是失败退回路径）。第一次 `pnpm pack:plugin` 因此有 3 条 bundle 用例失败（日志 `pack-1-eprem.log`），另 1 条 `test/fs/edit.test.ts` 是既有的 Windows 文件写入抖动；适配后 bundle 套件 11/11 通过（`bundle-loader.log`）。
- 最终门禁：`pnpm pack:plugin`（typecheck → build → 默认套件 → 包检查）**43 文件 / 607 测试，exit 0**，产物 `dist/dsh-nexus-0.1.7.tgz` = **463,144 字节、15 个成员、SHA-256 `e814dcfd832216aeffb464875a840cb6095df2fa0b15f5b08f223b7af65b6e10`**（`tmp/task14-tool-display-fix/pack.log`）。`pnpm verify:runtime` exit 0（`dsh-nexus 0.1.7 targets dsh 0.2.1-rc.2`，`verify-runtime.log`）。集成 16／Windows 13 仍是 651604b 的历史证据，本波按范围没有重跑。
- 门禁重试（如实记录）：在本机并行负载下，完整套件曾连续三次各失败 1–2 条**与本改动无关**的 Windows 文件写入用例（`test/fs/edit`、`test/fs/write`、`test/web/results`；其中一次是 `node_modules/.cache` 的 `EPERM: rename`，与历史记录同一族抖动）。这些文件单独跑 19/19 通过，`--no-file-parallelism` 全量跑 **607/607 通过**（`fs-edit-single*.log`、`full-serial.log`），随后并行门禁一次通过。失败日志 `pack-2-fs-edit.log`、`pack-3-fs.log` 保留，没有把它们说成产品缺陷，也没有删掉首次失败。
- 产物可重建（本波重点）：提交后从干净 HEAD 构建并打包；随后 `pnpm build` 再构建一次，包内 15 个成员中 14 个与工作树逐字节相同（唯一不同的是 `package.json`，由 pnpm pack 规范化字段顺序所致，属打包器行为），即 `lib/` 全部逐字节可重建（`members-after-pack.json`、`members-after-rebuild.json`）；再用同一个已提交源码执行一次 `pnpm pack` 到临时目录，两个 tarball 的 SHA-256 **完全相同**（`e814dcfd…`，`repack.log`）。所以 `dist/` 与 HEAD 对应，0.1.5 那种 sourcemap 行尾差异没有重演。
- 日常安装：唯一命令 `dsh plugin --profile web add E:/Programme/Project/dsh-nexus/dist/dsh-nexus-0.1.7.tgz`，2026-11-02T16:07:53Z 开始、16:07:58Z 结束，**真实 exit 0**；完整 stdout/stderr 在 `tmp/task14-tool-display-fix/official-install-output.log`，exit 单独存 `official-install-exit.txt`。输出是既有的 peer 警告与 `Packages: +3 -3`、`Done in 3s`。安装前后：21 个声明依赖、23 条 bundle、`dsh-nexus` 只有一条；15/15 tarball 成员与 `node_modules/dsh-nexus` 下文件逐字节相同（含 packed `package.json` 与内嵌 CSS 的 `lib/client.js`）；除 Nexus spec 更新为 0.1.7 外，Profile manifest 无其它语义变化，其余 20 个声明包的安装版本与 manifest hash 均未变（`before/after-inventory.json`）。安装前后 127.0.0.1:3080（PID 23616）与 18787（PID 34640）监听完全不变，62699 前后都没有监听；未重启、未终止、未刷新用户的应用／浏览器／会话。状态因此是 `INSTALLED_PENDING_USER_RELOAD`：只证明安装落盘，不证明已打开的页面用了新 JavaScript。
- **没有证明的事**：本轮没有重启应用，所以没有新的真实浏览器／像素证据；0.1.6 的隔离 Profile 台账（三个模式的 rank 与胜出者）仍是那三个模式在**稳态**下的证据，本波新增的是启动窗口时序，只在真实 SlotRegistry 的行为用例里证明（第三方先占 rank 0 时不抛错、不被抢、读完后落到存储等级）。日常第三方皮肤与真实插件组合下的启动竞态、真实模型产生的卡片外观、DPI／zoom、账号／模型、图像／web／子 Agent／AC-17 仍未验证；AC-07 受限 Git Bash 环境阻塞不变。本轮未作交付、接受、推送或合并。

## 历史：0.1.6 工具调用显示模式（nexus／auto／native）

状态：**IMPLEMENTED_PENDING_REVIEW / INSTALLED_PENDING_USER_RELOAD**。本波只加一个显示模式开关：`RuntimeSettings.toolDisplay`（默认 `nexus`）决定 Nexus 是否、以及以什么优先级占用宿主 `tool.call.toolview` 的三个单元格。0.1.5 的卡片标记、事实、输出、折叠与诚实措辞**完全没改**；本波没有把卡片改成宿主行样式，也没有新增页面、端点或依赖。日常 `web` Profile 安装到 0.1.6 后仍**没有**重启、刷新或重载用户的应用／浏览器／会话，实际渲染状态仍是待用户重载；本节不是最终验收。

- 设置：`toolDisplay` 只接受 `nexus`／`auto`／`native`。存储读取用 `z.enum(...).catch('nexus')` 归一化，所以 0.1.5 写下的、没有该字段的设置记录照常打开为 `nexus`，手改出的未知字符串也只会被当作 `nexus`，不会进入注册路径。GET／PUT 仍走既有 `{value,hash}` 与 409 冲突语义，没有新端点。
- 客户端注册：`src/client/index.tsx` 用与 locale 相同的 effect/disposer 模式，在 console store 每次发布时读取**当前草稿**的模式：`nexus` 以优先级 0 注册三张卡，`auto` 以优先级 10 注册（第三方默认 0 会赢），`native` 完全不注册；模式不变时不重复注册，切换时先 dispose 再注册一次，不留重复单元格。注册还是原来的 `safeRegistration` 与「槽位缺失就保留宿主兜底」行为。
- 控制台：工具页新增「工具调用显示」下拉，只改共享草稿、由既有「保存全部设置」落盘（不静默保存），并按当前模式显示一行说明；`native` 的说明明确写出已验证的宿主兜底行为：宿主把这三个名字当作未知工具、用第一个字符串参数当摘要，所以 `shell` 调用大致显示为“工具调用 · run”，而不是命令本身，且这不是更好看的 Nexus 样式。中英文字典都包含这些键。
- TDD（先失败）：改源码前，客户端新用例 7/7 失败（默认优先级读成 `undefined`、字段与字典键不存在、控制缺失），日志 `tmp/task14-tool-display/red-client.log`；默认/归一化用例 2 条失败，日志 `red-defaults.log`。第一次全量默认套件的唯一失败是 **`lib/` 还是旧的 0.1.5 构建**（preset 测试加载构建后的宿主入口，读到没有 `toolDisplay` 的旧记录），`pnpm build` 后即变绿；日志 `full-suite-precheck.log`、`lifecycle-single-after-build.log` 保留，未把它当成产品缺陷。
- 最终门禁只跑一次：`pnpm pack:plugin`（typecheck → build → 默认套件 → 包检查）**43 文件 / 601 测试，exit 0**，产物 `dist/dsh-nexus-0.1.6.tgz` = **462,544 字节、15 个成员、SHA-256 `943906330c6c942ce1e3afcf5f00ecd21fd0e7862673e53e0244482bf611cd02`**（`tmp/task14-tool-display/pack.log`）。`pnpm verify:runtime` exit 0（`dsh-nexus 0.1.6 targets dsh 0.2.1-rc.2`，`verify-runtime.log`）。集成 16／Windows 13 仍是 651604b 的历史证据，本波按范围没有重跑。
- 隔离 Profile 的真实浏览器检查（`nexus-tool-display`，项目内 `.dev-home`，只装 0.1.6 与一个**测试专用**探针插件）：探针把当前 SlotRegistry 的 `tool.call.toolview` 台账（每个 key 的优先级、注册者、胜出者）暴露给页面；证据只读这个真实台账，不伪造会话、不伪造工具调用。结果：`nexus` = `shell`／`web`／`agent` 三条均为优先级 0、注册者 `NexusToolCard` 且胜出；`native` = 三条全无；`auto` = 三条均为优先级 10；`auto` 下测试探针以优先级 0 占用 `shell` 后，`shell` 的胜出者是 `ThirdPartyProbeView`，`web`／`agent` 仍由 Nexus 的 10 胜出。控制台座位 1 个、五个子页、下拉三个模式与中文说明都在；用页面里的既有保存按钮把模式从 `native` 保存后再读回 `{value.toolDisplay}` 为 `native`，再切回并保存为 `nexus`。证据：`tmp/task14-tool-display/ledger-*.json`、`console-health.json`、`mode-*.png`、`browser-ledger/`。
- 日常安装：唯一命令 `dsh plugin --profile web add E:/Programme/Project/dsh-nexus/dist/dsh-nexus-0.1.6.tgz`，2026-11-02T15:52:54Z 开始、15:53:00Z 结束，**真实 exit 0**；完整 stdout/stderr 留在 `tmp/task14-tool-display/official-install-output.log`，exit 单独存 `official-install-exit.txt`。输出含既有的 peer 警告与 `Packages: +1 -2`、`Done in 2.3s`；没有声称 CLI 暴露了热应用状态。安装前后：21 个声明依赖、23 条 bundle、`dsh-nexus` 只有一条；15/15 tarball 成员与 `node_modules/dsh-nexus` 下文件逐字节相同（含 packed `package.json` 与内嵌 CSS 的 `lib/client.js`）；除 Nexus 的 spec 更新为 0.1.6 外，Profile manifest 无其它语义变化，其余 20 个声明包的安装版本与 manifest hash 均未变（`before/after-inventory.json`）。安装前后 127.0.0.1:3080（PID 23616）与 18787（PID 34640）监听完全不变，62699 前后都没有监听；未重启、未终止、未刷新用户的应用／浏览器／会话。因此状态是 `INSTALLED_PENDING_USER_RELOAD`：这只证明安装落盘，不证明已打开的页面用了新 JavaScript。

- **没有证明的事**：本轮没有用真实会话／模型产生一次工具调用，所以没有卡片像素级新证据；卡片渲染代码与 0.1.5 已评审的标记完全相同，台账只证明“哪个视图会赢”，不冒充卡片外观验证。日常第三方皮肤、真实 DPI／zoom、账号／模型、图像／web／子 Agent／AC-17 仍未验证；AC-07 受限 Git Bash 环境阻塞不变。日常 Profile 已用官方管理器装到 0.1.6，但用户未重载；本轮未作交付、接受、推送或合并。

## 历史：0.1.5 真实 Shell 发现修复与工具卡片折叠

状态：**IMPLEMENTED_PENDING_REVIEW / INSTALLED_PENDING_USER_RETRY**。用户报告日常会话里的 `shell` 卡片直接给出 `NexusError: SHELL_UNAVAILABLE`，并指出卡片把内部事实和原始记录整片铺开。本波按两份只读诊断修真实缺陷（A）并压缩 `shell`／`web`／`agent` 卡片（B）。日常 `web` Profile 已用官方管理器从 0.1.4 更新到 0.1.5，但**没有**重启应用、刷新页面或重载会话，实际渲染状态仍是待用户重试；本节不是最终验收。

- 真实缺陷（A）：本机 Git 装在 `E:\Programme\software\Git`，Windows 用户＋机器 `PATH` 只有 `…\Git\cmd`；`cmd\bash.exe` 不存在，`bin\bash.exe`（46,992 字节）与 `usr\bin\bash.exe` 存在；`ProgramFiles\Git` 不存在、`GIT_INSTALL_ROOT` 未设置。原 `findBash` 只探测 `<PATH 项>\bash.exe`，所以真实安装不可发现，用户会话才得到 `SHELL_UNAVAILABLE`。现在只要 PATH 项是 `<gitRoot>\cmd`、`<gitRoot>\mingw64\bin`、`<gitRoot>\mingw64\usr\bin` 或安装根本身，就**按路径文本结构**推导同一安装的 `bin\bash.exe` 与 `usr\bin\bash.exe`；不扫盘、不读注册表、不加依赖。优先级（显式配置 → 标准安装根 → `GIT_INSTALL_ROOT` → Git 形 PATH 项 → 其它非 WSL 项）、WSL／System32／WindowsApps 拒绝、绝对路径且存在校验、绝不回退 pwsh 全部保留；同一 PATH 项里直接存在的 `bash.exe` 仍排在推导结果之前。
- 卡片（B）：默认只显示标题、阶段标签、参数摘要，以及失败时的已记录错误行；已记录事实列表、已记录输出、非文本块计数、截断说明和复读声明全部移入每张卡片**唯一**的折叠 `<details>`，一条不删，wire token 原样保留，不把记录说成成功或退出；`<summary>` 是原生披露控件、可键盘聚焦，沿用既有 focus-visible 描边，没有用点击处理器替代原生展开。
- TDD：改源码前先保留真实失败。A：真实临时 Git 树（`root\cmd` 内有 `git.exe`、`root\bin\bash.exe` 存在，PATH 只有 `root\cmd`）上 2 条断言失败并报 `SHELL_UNAVAILABLE`，日志 `tmp/task14-shell-card-fix/engines-red.log`。B：3 条断言失败，因为折叠内容当时仍出现在默认可见文本里（`exited`、`proc-7`、`web-3`），日志 `tmp/task14-shell-card-fix/cards-red.log`。同轮加入的「同一 PATH 项的直接 `bash.exe` 优先」与「WSL 仍被拒绝」是保护既有行为的护栏，RED 时即通过，如实标注、不算新失败。
- 真实机器有界检查：用 Windows 环境 API 读机器＋用户 `PATH`（不扫盘、不枚举目录），实际 `resolveEngine` 解析到 `E:\Programme\software\Git\bin\bash.exe`；该 PATH 上唯一的直接 `<项>\bash.exe` 命中全部是被拒绝的 WSL `System32\bash.exe`，所以修复前确实没有可用候选。证据 `tmp/task14-shell-card-fix/real-discovery.json`（含逐项事实与期望值）。
- 门禁：`pnpm pack:plugin`（typecheck → build → 默认测试 → 包检查）第一、二次各因**与本改动无关**的 Windows `EPERM: operation not permitted, rename`（`node_modules/.cache` 的原子写在并行测试下的抖动）失败 1 条随机用例；第三次 **42 文件 / 593 测试，exit 0**，产物 458,747 字节、15 个成员、SHA-256 `632815d4ad54864c6436364b5e4b66a36a562235b3c981fcba49bd5ea9e7c41d`。这个 EPERM 是本机既有环境抖动，不是本波缺陷：`tmp/task8-check.log` 早有同样的失败，随后 `tmp/task8-check-final.log` 通过。四次日志全部保留：`pack.log`、`pack-retry.log`、`pack-green.log`、`pack-green2.log`。`pnpm verify:runtime` exit 0（`dsh-nexus 0.1.5 targets dsh 0.2.1-rc.2`）。集成 **16**、Windows **13** 仍属 651604b 的历史证据，本轮按范围没有重跑。
- 产物与源码的行尾差异（如实披露）：提交前把本次改过的 `src/shell/engines.ts` 行尾从编辑工具写出的 CRLF 统一成仓库要求的 LF，从提交源码重新构建时只有 `lib/preset/index.js.map` 变了——它的 `sourcesContent` 内嵌该文件正文，333 行行尾让大小从 560,247 变成 559,581 字节（差 666 字节）。`lib/index.js`、`lib/client.js`、`lib/preset/index.js` 三个可执行产物逐字节不变。因此又跑了第四次 `pnpm pack:plugin`（同样 42 文件 / 593 测试，exit 0），得到能由提交源码逐字节重建的 `bf13721f…` 新包；但官方 manager 对同一个 `file:` spec 与同一版本会复用已安装副本（第二次 `add` 真实 exit 0 但 payload 未替换），所以日常 Profile 里仍是 `632815d4…` 那一版。`dist/` 与文档记录的都是**真正装上的** `632815d4…`；`bf13721f…` 那一版、以及两版的 `lib/preset/index.js.map` 取证都留在 `tmp/task14-shell-card-fix/`。两版唯一差异就是这一个 sourcemap 的内嵌行尾，运行代码完全相同。
- 安装：`dsh plugin --profile web add E:/Programme/Project/dsh-nexus/dist/dsh-nexus-0.1.5.tgz` 共两次（第一次装上 `632815d4…`；第二次 spec 与版本都相同，manager 复用已安装副本、未替换 payload），真实 exit 均为 0；spec 更新为 0.1.5，15/15 tarball 成员与已安装文件逐字节相同，21 个声明依赖、23 条 bundle、`dsh-nexus` 只有一条，其它声明包的 manifest 未变。安装前后原有监听 3080／62699（PID 28296）、18787（PID 61612）完全不变；未重启、未终止、未刷新用户的应用／浏览器／会话，也没有手工改 Profile 文件或手工调用 pnpm。
- **未验证项**：没有真实 GUI 观察折叠后的卡片（要用户自己重载后再看），也没有用真实模型重跑一次 `shell`；日常第三方皮肤、实际 DPI／zoom／插件组合、账号／模型、图像／web／子 Agent 代表性任务、AC-17 仍未验证；AC-07 受限 Git Bash 环境阻塞不变。本轮未作交付、接受、推送或合并。

完整证据在根 `tmp/task14-shell-card-fix/`：`engines-red.log`、`engines-green.log`、`cards-red.log`、`cards-green.log`、`focused.log`、`pack.log`、`pack-retry.log`、`pack-green.log`、`pack-green2.log`、`verify-runtime.log`、`real-discovery.mjs`／`.log`／`.json`、`inventory.mjs`、`inventory-before.log`、`inventory-after.log`、`inventory-after.artifact2.log`、`before-inventory.json`、`after-inventory.json`、`after-inventory.artifact2.json`、`before-profile-package.json`、`after-profile-package.json`、`official-install-output.log`／`-2.log`、`official-install-exit.txt`／`-2.txt`、`artifact-before-normalize.tgz`、`artifact2-rebuilt.tgz`、`build-hashes-{before,after,after2}.txt`、`listeners-before.txt`、`listeners-after.txt`。权威回执为 `.superpowers/sdd/2026-11-01-dsh-nexus-implementation/task-14-shell-card-fix-receipt.json`。

## 历史：0.1.4 UI 修复（上一轮 §0 原文保留）

状态：**IMPLEMENTED_PENDING_REVIEW**。用户批准 A（局部原生化，同时修正两个入口布局）。日常 Profile 本轮未安装、未重启，仍以其原有 0.1.3 证据为准；本节不是最终验收。

- 产物：`dist/dsh-nexus-0.1.4.tgz`，457,443 字节、15 个成员，SHA-256 `02e6e51dd5285125031be24a7f296869b6cb74d7f481fc1ab37c587958c1605e`。官方 `dev-profile.mjs init --profile nexus-ui-fix-014 --tarball dist/dsh-nexus-0.1.4.tgz` 创建新项目隔离 Profile，15/15 已安装文件与包内字节相同。旧 `nexus-dev` 和旧产物保留；`init` 遇到已有 Profile 会跳过，不能把它当作更新命令。
- 改动仅限 Console 的静态座位属性、头部标记、局部样式和测试／版本／本文档。主入口仍拥有页面留白及滚动；设置入口复用宿主留白、背景及滚动。同一 store、五页、默认／草稿／预览／应用及警告说明未合并。宿主、preset、config 的可执行 bundle 与 0.1.3 逐字节相同。
- TDD：改源码前保留客户端 5 个预期断言失败（缺座位标识），以及实际已安装 0.1.3 的 Chrome DOM 布局失败；不是导入失败、jsdom 布局或 CSS 文本替身。原有保存／预览／应用测试在 RED 时已经通过，如实作为已有覆盖。
- 最终门禁仅跑一次 `pnpm pack:plugin`（含 typecheck → build → 默认测试 → 包检查）：**42 文件 / 586 测试，exit 0**；`pnpm verify:runtime` exit 0。此前聚焦客户端验证为 7 文件 / 48 测试通过。集成 **16**、Windows **13** 仍是下文 651604b 的历史证据，UI-only 本轮没有重跑。
- 真实 DSH `0.2.1-rc.2` + Chrome `156.0.8078.74`，自有 CDP 19515 / app 19514；1000×994、DPR 1、scale 1。双入口 × 五页 × light/dark 共 **20** 张普通中文截图；另有 600×994 英文长标签／长模块名相同 **20** 格压力矩阵。原 RED 原样变 GREEN：正文 **14/22**、标题 **16/24**、普通刷新按钮 **34px**，设置入口自身 padding **0**、overflow **visible**；40 格均无 Nexus 横向溢出。主入口保留 frame-clearance。
- 实际键盘 Tab / Enter 在两个入口均可切页并显示 2px 焦点环；33 项浏览器交互断言覆盖共享草稿、refresh busy/status、保存设置、显式丢弃草稿、只预览不保存、只保存不应用、显式目标应用及应用后编辑隔离。只写新隔离 Profile 的测试库／设置及一个空白 Nexus fixture 会话，未发消息。窄屏 20 页、232 次启用控件观察均可滚动到可见位置且可键盘聚焦；保存／应用动作未丢失。
- 防旧包：实际 `style[data-dsh-nexus]` 唯一且 SHA-256 与源码一致；实际加载的组合资源包含最终可执行 client 全文（宿主只移除 sourceMappingURL 尾注），并核对已安装包字节。早期探针误用不带 revision 的资源路径产生 3 个 404，日志保留；最终压力／交互记录无 console/exception/log 错误。没有把这些探针失败说成产品缺陷，也没有删除首次失败记录。
- 所有自有 app/browser PID 树均在 finally 清理，记录 PID 已消失，19514/19515 已关闭；原 3080/62699（PID 28296）、18787（PID 61612）仍监听。未读私人 DOM／日常配置、未登录或请求模型。原生启动可能请求本地模型元数据，本轮不是完整网络审计。

完整证据在根 `tmp/task14-ui-fix/`：`client-red.log`、`browser-red.log`、`client-green.log`、`pack.log`、`verify-runtime.log`、`artifact.json`、`after/{matrix,stress-matrix,interactions,reachability,provenance}.json`；每条最终命令和首次失败日志保留真实 exit 页脚。截图名与每格 DOM 指标在两个 matrix JSON 中逐一对应。同视口 BEFORE 在 `tmp/task14-ui-diag/` 和本轮 `before/`。权威 UI 修复回执为 `.superpowers/sdd/2026-11-01-dsh-nexus-implementation/task-14-ui-fix-receipt.json`。

**未验证项不变：** 日常第三方皮肤、用户实际 DPI／zoom／插件组合及真实账号／模型、图像、web、子 Agent 代表性任务、AC-17；AC-07 仍有受限 Git Bash 环境阻塞。先独立 SPEC、再 fresh QUALITY review；本轮未作交付、接受、推送或合并。

## 历史基线：0.1.3（以下 §1–9 保留其原始来源）

- 仓库：`E:/Programme/Project/dsh-nexus`，分支 `dev/nexus-core`
- 包版本：`dsh-nexus` 0.1.3；目标运行时 DSH `0.2.1-rc.2`
- 当前安装产物：`dist/dsh-nexus-0.1.3.tgz`（456,776 字节，15 个成员，SHA-256 `c36afce3cec2d6f366ed7251e91ed0edc7df392a0a99170f0fdd38d6d393f3ce`）。0.1.0／0.1.1／0.1.2 的旧产物与它们当时的探测记录一并保留在 `dist/` 与 §6，仅作历史，不再安装
- 0.1.3 是**只改注释/文档/版本号**的发布：`src/shell/process.ts` 的 JSDoc 把进程退出状态写成了 `0xC0000022`（错），本波改为 `3221225794`（`0xC0000142`）；这一句会随构建进入 `lib/preset/index.js`，所以必须重打包并用官方管理器更新安装。运行期逻辑、测试与配置未改，因此本波**没有**重跑集成/Windows 套件（那些证据属于 651604b，见 §3／§4）
- 0.1.3 安装后**没有**再做真实应用启动或会话探测：激活相关代码未变，保留的 §6.2 探测仍属于 0.1.0／0.1.1
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
| 官方安装命令（0.1.3 更新） | `dsh plugin --profile web add E:/Programme/Project/dsh-nexus/dist/dsh-nexus-0.1.3.tgz` | exit 0；spec 更新为 `file:…/0.1.3.tgz`，`node_modules/dsh-nexus` 版本 0.1.3，`bundles` 23 条且 `dsh-nexus` 只有一条，21/21 声明依赖均在位；15/15 tarball 成员与已安装文件逐字节相同；安装后的 `lib/preset/index.js` 已带修正后的注释（进程退出写成 3221225794 / 0xC0000142，并说明 0xC0000022 只属 stderr 里的 API 错误），旧错误句子不再出现。本次 pnpm 报 `Packages: +5`（没有 `-2`）；身份同样不从日志推断。**本次没有启动应用、没有创建会话、没有模型请求** |
| 安装告警 | 各次安装输出 | pnpm peer 警告：`dsh-nexus` 的 `@deepseek-ai/*` peer 在 profile 目录里「missing peer」——运行时由 DSH 安装目录提供，不是失败；未手改 Profile 文件 |
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
| AC-15 | 0.1.3 的客户端标记／行为测试；0.1.4 新增真实隔离双入口、五页、双主题及英文窄屏证据，见 §0；**日常第三方皮肤组合仍未验证** | 隔离 GUI 已验证，日常环境仍待用户核验 |
| AC-16 | 集成：具体第三方插件（工具、系统提示词段、压缩适配）通过；真实第三方安装到日常 Profile 的兼容性：**未验证** | 部分验证 |
| AC-17 | 本任务未在 GUI 中执行完整「读含图资料→多处编辑→测试→后台/交互→联网→内部委派→父任务整合」代表性任务；相应能力由测试层逐项覆盖 | **未验证** |
| AC-18 | 代码与组合检查：无新增装配平台、无多预设管理、无配置版本/对比/更新入口 | 已验证（静态与测试层） |

## 8. 需要用户目视或使用真实账号的项目

1. 在运行中的 DSH 里新建一个 Nexus 会话，确认六个 Nexus 工具（`read`、`write`、`edit`、`shell`、`web`、`agent`）出现在请求里并能调用一次 `shell`（AC-02/AC-13）。生成域激活与 persona 快照已由 §6.2 无模型证明；工具清单只能从一次真实请求或 GUI 看到。
2. 日常第三方皮肤／插件组合下五个子页与浅色/深色主题（AC-15）；隔离原生环境已有 §0 的实际 Chrome 证据，不能替代日常环境。
3. 真实模型的图片送入与联网搜索/抓取（AC-03/AC-08/AC-09）。
4. 真实第三方插件在本 Profile 中的兼容结论（AC-16）。
5. 代表性开发任务（AC-17）。
6. 若要在 `read-only` / `workspace-write` 权限预设下使用终端，请显式选择 `engine: "pwsh"`；受限 Git Bash 在此主机不可用（第 4.1 节）。

## 9. 附录：证据位置、口径与后续修正

- **日志位置与退出状态是两个工件**：fix2 的完整 stdout/stderr 日志在 SDD 目录 `.superpowers/sdd/2026-11-01-dsh-nexus-implementation/tmp/task14fix2-*.log`；这些文件里**没有** `rc=`/`exit=` 页脚——每条命令的退出状态是在 worker 的原生工具输出里单独打印的，控制器独立读取了那些行（pack/integration/windows/verify `exit=0`，install `exit=0`），记录在 `task-14-fix2-controller-evidence.md`。fix3 的新日志（`task14fix3-pack.log`、`task14fix3-verify.log`、`task14fix3-install.log`）带显式的 `* exit=0` 页脚。fix1 的 pack/install/list/boot 日志与更早的历史证据在**仓库根** `tmp/`（自 fix2 起被 `.gitignore` 忽略，既有文件保留未删）。最初的日志里多数只有 Vitest 摘要、没有退出状态，已由控制器补充的 `task14-controller-gates.log` 佐证，但**没有**完整日志可引用；不重跑已完成的工作来补历史。
- **`/tmp/` 忽略规则是本次新增的**：本波之前仓库并未忽略根 `tmp/`，相关文档里「已被 git 忽略」的说法当时并不成立；本波加上了 `/tmp/`，并且没有删除任何既有文件。
- **状态码口径修正**：进程退出状态是 `3221225794`（`0xC0000142`），stderr 里的 Win32 API 错误才是 `0xC0000022`（`3221225506`）。此前文档把它们写成同一个值，本波已在前台拒绝消息、README、manual-acceptance 与本文 §4.1 更正；数值守卫（`3221225794`）与 stderr 正则未改。
- **C1 的边界**：§6.2 的无模型探针只证明「生成域激活 + 活会话 + persona 快照 + 原生 `agentPreset` 投影」。它**没有**证明六个工具的真实 schema、请求内系统层顺序、GUI/主题、图片/联网或第三方安装，也没有证明 AC-17。
- **AC-07** 仍是环境阻塞，不是用户批准的降级；命名拒绝只覆盖**前台** `run`。
