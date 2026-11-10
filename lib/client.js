window.__ModuleLoader__.load({
	id: "dsh-nexus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/locale/en.json
		var en_default = {
			panel: "Nexus",
			consoleHelp: "Saved defaults and an explicit live Nexus session are managed separately.",
			prompts: "Prompts",
			tools: "Tools",
			terminal: "Terminal",
			agents: "Internal agents",
			integrations: "Integrations",
			refresh: "Refresh saved data and sessions",
			loading: "Loading…",
			unavailable: "Nexus data is unavailable. Refresh to try a new read; unsaved drafts are retained.",
			idle: "",
			saved: "Defaults saved. This does not apply prompts to a current session.",
			previewed: "Draft preview only; nothing was saved or applied.",
			applied: "Saved prompt bodies applied to the selected session for its next request.",
			error: "The operation failed or returned invalid data. Drafts are retained. A failed write may already have committed; refresh before deciding whether to retry.",
			conflict: "Saved data changed in another window. Your draft is retained. Refresh to read saved data while keeping the draft, or explicitly reload to discard it before saving again.",
			base: "Base prompt (read-only, literal text)",
			modules: "Prompt modules",
			addModule: "Add module",
			untitledModule: "Untitled module",
			moduleName: "Module name",
			moduleBody: "Literal module body",
			includeModule: "Include in ordered selection",
			deleteModule: "Delete module",
			selection: "Ordered selection for preview / current session",
			emptySelection: "No modules selected; only the base prompt is used.",
			moveUp: "Move up",
			moveDown: "Move down",
			useDefault: "Use this selection as draft default",
			defaultHelp: "Selection is independent of saved defaults. To change defaults, copy this selection into the draft and save the library.",
			savedDefault: "Saved default selection",
			saveLibrary: "Save default library",
			reloadLibrary: "Reload library and discard draft",
			libraryDirty: "Unsaved library draft",
			libraryClean: "Library matches saved defaults",
			preview: "Preview draft",
			previewTitle: "Draft preview (not saved or effective)",
			target: "Live Nexus target",
			noTarget: "Select a live session explicitly",
			apply: "Apply saved bodies to selected session",
			applyHelp: "No target means no apply. Selected module edits must be saved first. Applying does not change defaults, interrupt a request, or cancel an apply already sent to another target.",
			appliedTitle: "Current target's captured effective prompt",
			noApplied: "No captured prompt loaded for this target.",
			settingsHelp: "Tools, terminal and agent preferences share one draft. Save commits all edited sections together; it does not apply prompts.",
			settingsDirty: "Unsaved settings across pages",
			settingsClean: "Settings match saved defaults",
			saveSettings: "Save all settings",
			reloadSettings: "Reload all settings and discard draft",
			defaultLines: "Default file read lines",
			maxOutputBytes: "Maximum file output bytes",
			maxResults: "Maximum web sources",
			maxCharsPerPage: "Web characters per page",
			pageBudgetHelp: "Page size limits model-facing output, not saved document content. Later pages can continue reading.",
			toolDisplay: "Tool call display",
			toolDisplayHelp: "Presentation only: the switch previews immediately in this page, but only Save makes it the stored default, which then applies without a page reload. Nothing about the recorded call changes.",
			toolDisplayNexus: "Nexus cards",
			toolDisplayAuto: "Yield to other plugins",
			toolDisplayNative: "Host default",
			toolDisplayNexusHelp: "Nexus draws its own card for shell, web and Nexus agent calls, with the recorded facts and output folded on the card.",
			toolDisplayAutoHelp: "Nexus registers its cards at a lower precedence: another plugin's view for these tool names wins, and the Nexus card appears only where no one else claims that cell.",
			toolDisplayNativeHelp: "Nexus registers no tool view and the host's own fallback renders these calls. That fallback treats the names as unknown and summarises the first string argument, so a shell call shows roughly “Tool call · run”, not the command. It is a fallback, not a prettier Nexus card.",
			engine: "Default shell engine",
			bash: "Git Bash",
			pwsh: "PowerShell 7",
			bashPath: "Bash executable override",
			pwshPath: "PowerShell executable override",
			terminalHelp: "Blank paths use deployment defaults. Changes affect future launches only; existing terminals are not redirected.",
			timeoutHelp: "Ordinary command timeout: 120,000 ms by default, up to 600,000 ms per call. This is not a persisted setting; background calls have separate lifecycle semantics.",
			concurrency: "Child concurrency",
			maxDepth: "Maximum descendant depth",
			roleName: "Default role name (optional)",
			roleInstructions: "Default role task instructions (optional)",
			roleModel: "Default child model (blank inherits parent)",
			agentHelp: "One optional default role, not a role library. Task guidance goes into child user content. Native inherited permission and depth ceilings still apply; these fields grant no abilities.",
			childAccess: "Child sandbox ceiling",
			childAccessInherit: "Inherit the parent session",
			childAccessWorkspaceWrite: "Workspace write",
			childAccessReadOnly: "Read-only",
			childAccessInheritHelp: "Inherit: a write child runs with this session's current mode (a read-only session stays read-only).",
			childAccessWorkspaceWriteHelp: "Workspace write: a write child may only write this session's workspace root, and holds that whole tree as its exclusive scope; a read child stays read-only.",
			childAccessReadOnlyHelp: "Read-only: every child is read-only, whatever access the call asks for.",
			childAccessWarning: "Warning: “Inherit the parent session” gives child agents the same rights as this session — including danger-full-access when this session runs unrestricted, so a child can then write outside the workspace. Pick a narrower ceiling if children must not write freely.",
			roleProvider: "Default child provider route (optional)",
			roleProviderHelp: "A provider route comes from DSH Settings → Models / Subagents (for example the route a subscription plugin adds). The child's model id is interpreted by that route; blank keeps this session's route. A route with no registered adapter is refused by name, never replaced with this session's route. Registered routes are suggested; focus the model field to load provider / model suggestions (a slow or failed catalog gives none). Suggestions do not restrict what you type; save applies the draft.",
			registrationHelp: "Registration facts cover only the effective HTTP context. They do not prove executable detection, OS support, PTY operation, provider connectivity or account readiness.",
			terminalRegistration: "Terminal registrations",
			webRegistration: "Web registrations",
			agentRegistration: "Internal-agent registrations",
			present: "Service present",
			absent: "Absent in this scope",
			unknown: "Unknown (not proven absent)",
			registered: "Registered backends",
			unverified: "Readiness unverified",
			diagnostics: "Compatibility diagnostics",
			nativeSettingsHelp: "Native Settings → Models manages models and accounts; Settings → Built-in plugins manages native providers. Use the native Settings button in the sidebar. No public settings-opening service is available to this panel, so no guessed navigation link is offered.",
			toolTitleShell: "Shell",
			toolTitleWeb: "Web",
			toolTitleAgent: "Nexus agent",
			toolStagePending: "Preparing arguments — nothing has run yet",
			toolStageRunning: "Running — no result recorded yet",
			toolStageRecorded: "Recorded result",
			toolStageFailed: "Failed",
			toolStageStopRequested: "Stop or close requested — not a process exit",
			toolStageTimedOut: "Wait timed out — not completion",
			toolStageEmpty: "No recorded output — not proof of completion",
			toolArgs: "Recorded arguments",
			toolOutput: "Recorded output",
			toolDetails: "Recorded facts and output",
			toolOutputTruncated: "This preview is cut; the recorded call in the session log still holds the rest.",
			toolNonTextBlocks: "Recorded non-text blocks not shown here:",
			toolFailure: "Recorded error",
			toolReplayNote: "Shown from this call's record only; the file, session, child or process is not re-read.",
			toolInspect: "Inspect",
			toolFactAction: "Recorded action",
			toolFactKind: "Recorded kind",
			toolFactStatus: "Recorded status",
			toolFactResource: "Resource",
			toolFactResult: "Saved web result",
			toolFactSources: "Recorded sources",
			toolFactSaved: "Saved sources",
			toolFactChild: "Child session",
			toolFactLabel: "Recorded label",
			toolFactActivity: "Recorded activity",
			toolFactLive: "Live at call time",
			toolFactChildren: "Listed children",
			toolFactEvents: "Recorded events"
		};
		// src/locale/zh.json
		var zh_default = {
			panel: "Nexus",
			consoleHelp: "保存的默认配置与明确选择的当前 Nexus 会话分别管理。",
			prompts: "提示词",
			tools: "工具",
			terminal: "终端",
			agents: "内部协作",
			integrations: "集成",
			refresh: "刷新已保存数据与会话",
			loading: "正在读取…",
			unavailable: "暂时无法读取 Nexus 数据。可刷新重新读取；未保存的草稿会保留。",
			idle: "",
			saved: "默认配置已保存。这不会将提示词应用到当前会话。",
			previewed: "这只是草稿预览，未保存，也未应用。",
			applied: "已将保存的提示词正文应用到选定会话，从下一次请求开始生效。",
			error: "操作失败或返回数据无效，草稿已保留。失败的写入可能已经落盘；请先刷新读取，再决定是否重试。",
			conflict: "另一窗口修改了已保存数据，当前草稿已保留。刷新可读取已保存数据并保留草稿；也可明确重新载入，放弃草稿后再保存。",
			base: "基础提示词（只读，保留原文）",
			modules: "提示词模块",
			addModule: "新增模块",
			untitledModule: "未命名模块",
			moduleName: "模块名称",
			moduleBody: "模块正文（字面文本）",
			includeModule: "加入有序选择",
			deleteModule: "删除模块",
			selection: "用于预览／当前会话的有序选择",
			emptySelection: "未选择模块，仅使用基础提示词。",
			moveUp: "上移",
			moveDown: "下移",
			useDefault: "将此选择设为草稿默认",
			defaultHelp: "当前选择与保存的默认选择相互独立。修改默认时，请先复制到草稿，再保存模块库。",
			savedDefault: "已保存的默认选择",
			saveLibrary: "保存默认模块库",
			reloadLibrary: "重新载入模块库并放弃草稿",
			libraryDirty: "模块库有未保存草稿",
			libraryClean: "模块库与已保存默认一致",
			preview: "预览草稿",
			previewTitle: "草稿预览（未保存，未生效）",
			target: "当前 Nexus 目标会话",
			noTarget: "请明确选择一个活跃会话",
			apply: "将已保存正文应用到选定会话",
			applyHelp: "未选择目标时无法应用。已选模块的编辑须先保存。应用不会修改默认配置、打断请求，也不会取消已经发往其他目标的应用操作。",
			appliedTitle: "当前目标实际捕获的生效提示词",
			noApplied: "尚未读取此目标的实际提示词快照。",
			settingsHelp: "工具、终端和内部协作共用一份草稿。保存会一次提交所有已编辑部分，不会应用提示词。",
			settingsDirty: "各页存在未保存设置",
			settingsClean: "设置与已保存默认一致",
			saveSettings: "保存全部设置",
			reloadSettings: "重新载入全部设置并放弃草稿",
			defaultLines: "文件默认读取行数",
			maxOutputBytes: "文件输出最大字节数",
			maxResults: "网页最大来源数",
			maxCharsPerPage: "网页每页字符数",
			pageBudgetHelp: "每页预算限制提供给模型的输出，不会截短已保存正文；可继续读取后续页。",
			toolDisplay: "工具调用显示",
			toolDisplayHelp: "只影响显示：切换会立即在本页预览，但只有点「保存全部设置」才会成为已保存默认，保存后无需刷新页面即可生效；调用记录本身没有任何变化。",
			toolDisplayNexus: "Nexus 卡片",
			toolDisplayAuto: "让位给其它插件",
			toolDisplayNative: "宿主默认",
			toolDisplayNexusHelp: "Nexus 为 shell、web 和 Nexus 子会话调用绘制自己的卡片，已记录的事实和输出折叠在卡片里。",
			toolDisplayAutoHelp: "Nexus 以较低优先级注册卡片：其它插件针对这些工具名的视图会优先显示，只有该单元格没有被别人占用时才显示 Nexus 卡片。",
			toolDisplayNativeHelp: "Nexus 不注册任何工具视图，由宿主自己的兜底卡片渲染这些调用。该兜底会把名字当作未知工具，并用第一个字符串参数当摘要，所以 shell 调用大致显示为“工具调用 · run”，而不是命令本身。它是兜底显示，不是更漂亮的 Nexus 卡片。",
			engine: "默认 Shell 引擎",
			bash: "Git Bash",
			pwsh: "PowerShell 7",
			bashPath: "Bash 程序路径覆盖",
			pwshPath: "PowerShell 程序路径覆盖",
			terminalHelp: "路径留空使用部署默认值。修改只影响以后启动的终端，不会重定向已有终端。",
			timeoutHelp: "普通命令默认超时为 120,000 毫秒，每次调用最多 600,000 毫秒。这不是持久设置；后台调用另有生命周期规则。",
			concurrency: "子会话并发数",
			maxDepth: "后代最大深度",
			roleName: "默认角色名称（可选）",
			roleInstructions: "默认角色任务说明（可选）",
			roleModel: "默认子模型（留空继承父模型）",
			agentHelp: "仅提供一个可选默认角色，不是角色库。任务说明进入子会话的用户内容。原生继承权限和深度上限仍然生效，这些字段不会授予能力。",
			childAccess: "子 Agent 权限上限",
			childAccessInherit: "继承父会话权限",
			childAccessWorkspaceWrite: "仅可写工作区",
			childAccessReadOnly: "只读",
			childAccessInheritHelp: "继承父会话：写子 Agent 按父会话当前权限运行（父会话只读就仍是只读）。这是默认值。",
			childAccessWorkspaceWriteHelp: "仅可写工作区：写子 Agent 只能写父会话的工作区根目录，并把整棵目录树作为独占写范围；读子 Agent 仍是只读。",
			childAccessReadOnlyHelp: "只读：无论调用方请求什么权限，所有子 Agent 都是只读。",
			childAccessWarning: "警告：「继承父会话权限」会让子 Agent 拥有与当前会话相同的权限——当会话本身是不受限的 danger-full-access 时，子 Agent 也能写到工作区之外。如果不希望子 Agent 自由写入，请选更窄的上限。",
			roleProvider: "默认子模型提供方路由（可选）",
			roleProviderHelp: "路由名来自 DSH 设置 → 模型／子 Agent（例如订阅插件新增的那条路由）。子模型的模型 id 由该路由解释；留空则沿用当前会话的路由。没有注册适配器的路由会直接按名字报错，绝不会偷偷退回当前会话的路由。输入框建议已注册路由；聚焦模型框时才加载 provider / model 建议（目录慢或失败时无建议）。建议不限制手填值，仍需保存草稿。",
			registrationHelp: "注册事实仅覆盖当前 HTTP 有效作用域，不代表已检测程序、操作系统支持、PTY 运行、供应方连通性或账号就绪。",
			terminalRegistration: "终端注册情况",
			webRegistration: "网页注册情况",
			agentRegistration: "内部协作注册情况",
			present: "服务存在",
			absent: "此作用域内不存在",
			unknown: "未知（并非确认不存在）",
			registered: "已注册后端",
			unverified: "就绪情况未经验证",
			diagnostics: "兼容诊断",
			nativeSettingsHelp: "原生“设置 → 模型”管理模型与账号，“设置 → 内置插件”管理原生供应方。请使用侧边栏原生设置按钮。当前面板没有公共的设置打开服务，因此不提供猜测的跳转链接。",
			toolTitleShell: "终端命令",
			toolTitleWeb: "联网",
			toolTitleAgent: "Nexus 子会话",
			toolStagePending: "正在准备参数，尚未执行",
			toolStageRunning: "执行中，尚未记录结果",
			toolStageRecorded: "已记录的结果",
			toolStageFailed: "失败",
			toolStageStopRequested: "已记录停止或关闭请求，不代表进程退出",
			toolStageTimedOut: "等待超时，不代表完成",
			toolStageEmpty: "未记录输出，不能视为完成",
			toolArgs: "已记录参数",
			toolOutput: "已记录输出",
			toolDetails: "已记录的事实与输出",
			toolOutputTruncated: "此处只是截断预览；完整内容仍在会话日志的该次调用记录里。",
			toolNonTextBlocks: "此处未显示的非文本记录块：",
			toolFailure: "已记录错误",
			toolReplayNote: "仅显示该次调用记录的内容，不会重新读取文件、会话、子会话或进程。",
			toolInspect: "查看轨迹",
			toolFactAction: "已记录动作",
			toolFactKind: "已记录类型",
			toolFactStatus: "已记录状态",
			toolFactResource: "资源",
			toolFactResult: "已保存网页结果",
			toolFactSources: "已记录来源数",
			toolFactSaved: "已保存来源数",
			toolFactChild: "子会话",
			toolFactLabel: "已记录标签",
			toolFactActivity: "已记录活动",
			toolFactLive: "调用时是否活跃",
			toolFactChildren: "列出的子会话数",
			toolFactEvents: "已记录事件数"
		};
		// src/client/styles.css?raw
		var styles_default = ".dsh-nexus-console {\n  box-sizing: border-box;\n  min-width: 0;\n  min-height: 0;\n  height: 100%;\n  overflow: auto;\n  padding: max(24px, var(--dsh-frame-top-clearance, 24px)) 24px 32px max(24px, var(--dsh-frame-leading-clearance, 24px));\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-layer-1);\n  font-family: inherit;\n  font-size: 14px;\n  line-height: 22px;\n  overflow-wrap: anywhere;\n}\n/* The settings seat already owns its padding, background and scrolling. */\n.dsh-nexus-console[data-dsh-nexus-surface='settings'] {\n  height: auto;\n  overflow: visible;\n  padding: 0;\n  background: transparent;\n}\n.dsh-nexus-console > header,\n.dsh-nexus-console > nav,\n.dsh-nexus-console > article,\n.dsh-nexus-console > p {\n  max-width: 960px;\n  margin-inline: auto;\n}\n.dsh-nexus-console .dsh-nexus-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 8px; }\n.dsh-nexus-console h1 { flex: 1 1 auto; margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }\n.dsh-nexus-console h2 { margin: 16px 0 8px; font-size: 16px; line-height: 24px; font-weight: 500; }\n.dsh-nexus-console h3 { margin: 16px 0 8px; font-size: 14px; line-height: 22px; font-weight: 600; }\n.dsh-nexus-console p { margin-block: 0 8px; color: var(--dsw-alias-label-secondary); }\n.dsh-nexus-console nav { display: flex; flex-wrap: wrap; gap: 0 4px; padding-top: 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }\n.dsh-nexus-console button,\n.dsh-nexus-console input,\n.dsh-nexus-console textarea,\n.dsh-nexus-console select {\n  box-sizing: border-box;\n  min-width: 0;\n  max-width: 100%;\n  min-height: 34px;\n  font: inherit;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-layer-1);\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 8px;\n  padding: 5px 10px;\n}\n.dsh-nexus-console button { cursor: pointer; margin: 4px 8px 4px 0; white-space: normal; overflow-wrap: anywhere; }\n.dsh-nexus-console .dsh-nexus-heading button { margin: 0; }\n.dsh-nexus-console nav button { margin: 0; padding: 5px 12px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--dsw-alias-label-secondary); }\n.dsh-nexus-console nav button[aria-pressed='true'] { border-bottom-color: var(--dsw-alias-label-primary); color: var(--dsw-alias-label-primary); font-weight: 600; }\n.dsh-nexus-console button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); }\n.dsh-nexus-console button:disabled { cursor: not-allowed; opacity: .5; }\n.dsh-nexus-console :is(button,input,textarea,select):focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 2px; }\n.dsh-nexus-console label { display: flex; flex-direction: column; min-width: 0; gap: 4px; margin-block: 8px; }\n.dsh-nexus-console label.dsh-nexus-check { flex-direction: row; align-items: center; }\n.dsh-nexus-console input[type='checkbox'] { flex-shrink: 0; min-height: 0; margin: 0; }\n.dsh-nexus-console textarea { min-height: 120px; resize: vertical; white-space: pre-wrap; }\n.dsh-nexus-console fieldset { margin: 12px 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; min-width: 0; }\n.dsh-nexus-console legend { max-width: 100%; padding-inline: 4px; }\n.dsh-nexus-console ol { margin-block: 8px; padding-inline-start: 24px; }\n.dsh-nexus-console pre { margin-block: 8px 12px; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; font-family: var(--dsh-font-family-code, monospace); font-size: 13px; line-height: 20px; }\n.dsh-nexus-console .dsh-nexus-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 0 16px; }\n.dsh-nexus-console .dsh-nexus-actions { margin-block: 16px; }\n.dsh-nexus-console .dsh-nexus-error { color: var(--dsw-alias-state-error-primary); }\n.dsh-nexus-console .dsh-nexus-fact { border-bottom: 1px solid var(--dsw-alias-border-l1); padding-block: 8px; }\n\n/* Tool result cards. Rendered inside the conversation flow, outside the\n   console panel, so these rules are namespaced under .dsh-nexus-tool instead of\n   the .dsh-nexus-console scope and only use host theme tokens. */\n.dsh-nexus-tool { display: block; margin-block: 4px; color: var(--dsw-alias-label-primary); font: inherit; }\n.dsh-nexus-tool-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }\n.dsh-nexus-tool-title { font-size: calc(var(--dsh-content-font-size-secondary, 13px)); font-weight: 600; }\n.dsh-nexus-tool-stage { color: var(--dsw-alias-label-secondary); font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); }\n.dsh-nexus-tool[data-dsh-nexus-stage='failed'] .dsh-nexus-tool-stage { color: var(--dsw-alias-state-error-primary); }\n.dsh-nexus-tool[data-dsh-nexus-stage='stopRequested'] .dsh-nexus-tool-stage { color: var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary)); }\n.dsh-nexus-tool-inspect { box-sizing: border-box; font: inherit; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 0 10px; cursor: pointer; }\n.dsh-nexus-tool-inspect:hover { background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); }\n.dsh-nexus-tool-inspect:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 2px; }\n.dsh-nexus-tool-summary { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); }\n.dsh-nexus-tool-summary code { color: var(--dsw-alias-label-primary); font-family: var(--dsh-font-family-code, monospace); white-space: pre-wrap; overflow-wrap: anywhere; }\n.dsh-nexus-tool-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 6px 0 0; }\n.dsh-nexus-tool-facts > div { display: contents; }\n.dsh-nexus-tool-facts dt { color: var(--dsw-alias-label-secondary); }\n.dsh-nexus-tool-facts dd { margin: 0; overflow-wrap: anywhere; }\n.dsh-nexus-tool-failure { margin: 6px 0 0; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }\n.dsh-nexus-tool-reason { display: block; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; }\n.dsh-nexus-tool-note { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); }\n.dsh-nexus-tool-details { margin-block: 6px 0; }\n.dsh-nexus-tool-details > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); }\n.dsh-nexus-tool-details > summary:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 2px; }\n.dsh-nexus-tool-details pre { margin: 6px 0 0; padding: 8px 12px; max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; font-family: var(--dsh-font-family-code, monospace); }\n";
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
		var _a$1;
		/* @__NO_SIDE_EFFECTS__ */
		function $constructor(name, initializer, params) {
			function init(inst, def) {
				if (!inst._zod) Object.defineProperty(inst, "_zod", {
					value: {
						def,
						constr: _,
						traits: /* @__PURE__ */ new Set()
					},
					enumerable: false
				});
				if (inst._zod.traits.has(name)) return;
				inst._zod.traits.add(name);
				initializer(inst, def);
				const proto = _.prototype;
				const keys = Object.keys(proto);
				for (let i = 0; i < keys.length; i++) {
					const k = keys[i];
					if (!(k in inst)) inst[k] = proto[k].bind(inst);
				}
			}
			const Parent = params?.Parent ?? Object;
			class Definition extends Parent {}
			Object.defineProperty(Definition, "name", { value: name });
			function _(def) {
				var _a;
				const inst = params?.Parent ? new Definition() : this;
				init(inst, def);
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				for (const fn of inst._zod.deferred) fn();
				return inst;
			}
			Object.defineProperty(_, "init", { value: init });
			Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
				if (params?.Parent && inst instanceof params.Parent) return true;
				return inst?._zod?.traits?.has(name);
			} });
			Object.defineProperty(_, "name", { value: name });
			return _;
		}
		var $ZodAsyncError = class extends Error {
			constructor() {
				super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
			}
		};
		var $ZodEncodeError = class extends Error {
			constructor(name) {
				super(`Encountered unidirectional transform during encode: ${name}`);
				this.name = "ZodEncodeError";
			}
		};
		(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
		const globalConfig = globalThis.__zod_globalConfig;
		function config(newConfig) {
			if (newConfig) Object.assign(globalConfig, newConfig);
			return globalConfig;
		}
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
		function getEnumValues(entries) {
			const numericValues = Object.values(entries).filter((v) => typeof v === "number");
			return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
		}
		function jsonStringifyReplacer(_, value) {
			if (typeof value === "bigint") return value.toString();
			return value;
		}
		function cached(getter) {
			return { get value() {
				{
					const value = getter();
					Object.defineProperty(this, "value", { value });
					return value;
				}
			} };
		}
		function nullish(input) {
			return input === null || input === void 0;
		}
		function cleanRegex(source) {
			const start = source.startsWith("^") ? 1 : 0;
			const end = source.endsWith("$") ? source.length - 1 : source.length;
			return source.slice(start, end);
		}
		function floatSafeRemainder(val, step) {
			const ratio = val / step;
			const roundedRatio = Math.round(ratio);
			const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
			if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
			return ratio - roundedRatio;
		}
		const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
		function defineLazy(object, key, getter) {
			let value = void 0;
			Object.defineProperty(object, key, {
				get() {
					if (value === EVALUATING) return;
					if (value === void 0) {
						value = EVALUATING;
						value = getter();
					}
					return value;
				},
				set(v) {
					Object.defineProperty(object, key, { value: v });
				},
				configurable: true
			});
		}
		function assignProp(target, prop, value) {
			Object.defineProperty(target, prop, {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			});
		}
		function mergeDefs(...defs) {
			const mergedDescriptors = {};
			for (const def of defs) {
				const descriptors = Object.getOwnPropertyDescriptors(def);
				Object.assign(mergedDescriptors, descriptors);
			}
			return Object.defineProperties({}, mergedDescriptors);
		}
		function esc(str) {
			return JSON.stringify(str);
		}
		function slugify(input) {
			return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
		}
		const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
		function isObject(data) {
			return typeof data === "object" && data !== null && !Array.isArray(data);
		}
		const allowsEval = /* @__PURE__*/ cached(() => {
			if (globalConfig.jitless) return false;
			if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
			try {
				new Function("");
				return true;
			} catch (_) {
				return false;
			}
		});
		function isPlainObject(o) {
			if (isObject(o) === false) return false;
			const ctor = o.constructor;
			if (ctor === void 0) return true;
			if (typeof ctor !== "function") return true;
			const prot = ctor.prototype;
			if (isObject(prot) === false) return false;
			if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
			return true;
		}
		function shallowClone(o) {
			if (isPlainObject(o)) return { ...o };
			if (Array.isArray(o)) return [...o];
			if (o instanceof Map) return new Map(o);
			if (o instanceof Set) return new Set(o);
			return o;
		}
		const propertyKeyTypes = /* @__PURE__*/ new Set([
			"string",
			"number",
			"symbol"
		]);
		function escapeRegex(str) {
			return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
		function clone(inst, def, params) {
			const cl = new inst._zod.constr(def ?? inst._zod.def);
			if (!def || params?.parent) cl._zod.parent = inst;
			return cl;
		}
		function normalizeParams(_params) {
			const params = _params;
			if (!params) return {};
			if (typeof params === "string") return { error: () => params };
			if (params?.message !== void 0) {
				if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
				params.error = params.message;
			}
			delete params.message;
			if (typeof params.error === "string") return {
				...params,
				error: () => params.error
			};
			return params;
		}
		function optionalKeys(shape) {
			return Object.keys(shape).filter((k) => {
				return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
			});
		}
		const NUMBER_FORMAT_RANGES = {
			safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			int32: [-2147483648, 2147483647],
			uint32: [0, 4294967295],
			float32: [-34028234663852886e22, 34028234663852886e22],
			float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
		};
		function pick(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = {};
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						newShape[key] = currDef.shape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function omit(schema, mask) {
			const currDef = schema._zod.def;
			const checks = currDef.checks;
			if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const newShape = { ...schema._zod.def.shape };
					for (const key in mask) {
						if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						delete newShape[key];
					}
					assignProp(this, "shape", newShape);
					return newShape;
				},
				checks: []
			}));
		}
		function extend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) {
				const existingShape = schema._zod.def.shape;
				for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
			}
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function safeExtend(schema, shape) {
			if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const _shape = {
					...schema._zod.def.shape,
					...shape
				};
				assignProp(this, "shape", _shape);
				return _shape;
			} }));
		}
		function merge(a, b) {
			if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
			return clone(a, mergeDefs(a._zod.def, {
				get shape() {
					const _shape = {
						...a._zod.def.shape,
						...b._zod.def.shape
					};
					assignProp(this, "shape", _shape);
					return _shape;
				},
				get catchall() {
					return b._zod.def.catchall;
				},
				checks: b._zod.def.checks ?? []
			}));
		}
		function partial(Class, schema, mask) {
			const checks = schema._zod.def.checks;
			if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
			return clone(schema, mergeDefs(schema._zod.def, {
				get shape() {
					const oldShape = schema._zod.def.shape;
					const shape = { ...oldShape };
					if (mask) for (const key in mask) {
						if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
						if (!mask[key]) continue;
						shape[key] = Class ? new Class({
							type: "optional",
							innerType: oldShape[key]
						}) : oldShape[key];
					}
					else for (const key in oldShape) shape[key] = Class ? new Class({
						type: "optional",
						innerType: oldShape[key]
					}) : oldShape[key];
					assignProp(this, "shape", shape);
					return shape;
				},
				checks: []
			}));
		}
		function required(Class, schema, mask) {
			return clone(schema, mergeDefs(schema._zod.def, { get shape() {
				const oldShape = schema._zod.def.shape;
				const shape = { ...oldShape };
				if (mask) for (const key in mask) {
					if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
					if (!mask[key]) continue;
					shape[key] = new Class({
						type: "nonoptional",
						innerType: oldShape[key]
					});
				}
				else for (const key in oldShape) shape[key] = new Class({
					type: "nonoptional",
					innerType: oldShape[key]
				});
				assignProp(this, "shape", shape);
				return shape;
			} }));
		}
		function aborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
			return false;
		}
		function explicitlyAborted(x, startIndex = 0) {
			if (x.aborted === true) return true;
			for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
			return false;
		}
		function prefixIssues(path, issues) {
			return issues.map((iss) => {
				var _a;
				(_a = iss).path ?? (_a.path = []);
				iss.path.unshift(path);
				return iss;
			});
		}
		function unwrapMessage(message) {
			return typeof message === "string" ? message : message?.message;
		}
		function finalizeIssue(iss, ctx, config) {
			const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
			const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
			rest.path ?? (rest.path = []);
			rest.message = message;
			if (ctx?.reportInput) rest.input = _input;
			return rest;
		}
		function getLengthableOrigin(input) {
			if (Array.isArray(input)) return "array";
			if (typeof input === "string") return "string";
			return "unknown";
		}
		function issue(...args) {
			const [iss, input, inst] = args;
			if (typeof iss === "string") return {
				message: iss,
				code: "custom",
				input,
				inst
			};
			return { ...iss };
		}
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
		const initializer$1 = (inst, def) => {
			inst.name = "$ZodError";
			Object.defineProperty(inst, "_zod", {
				value: inst._zod,
				enumerable: false
			});
			Object.defineProperty(inst, "issues", {
				value: def,
				enumerable: false
			});
			inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
			Object.defineProperty(inst, "toString", {
				value: () => inst.message,
				enumerable: false
			});
		};
		const $ZodError = /* @__PURE__ */ $constructor("$ZodError", initializer$1);
		const $ZodRealError = /* @__PURE__ */ $constructor("$ZodError", initializer$1, { Parent: Error });
		function flattenError(error, mapper = (issue) => issue.message) {
			const fieldErrors = {};
			const formErrors = [];
			for (const sub of error.issues) if (sub.path.length > 0) {
				fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
				fieldErrors[sub.path[0]].push(mapper(sub));
			} else formErrors.push(mapper(sub));
			return {
				formErrors,
				fieldErrors
			};
		}
		function formatError(error, mapper = (issue) => issue.message) {
			const fieldErrors = { _errors: [] };
			const processError = (error, path = []) => {
				for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
				else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
				else {
					const fullpath = [...path, ...issue.path];
					if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
					else {
						let curr = fieldErrors;
						let i = 0;
						while (i < fullpath.length) {
							const el = fullpath[i];
							if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
							else {
								curr[el] = curr[el] || { _errors: [] };
								curr[el]._errors.push(mapper(issue));
							}
							curr = curr[el];
							i++;
						}
					}
				}
			};
			processError(error);
			return fieldErrors;
		}
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
		const _parse = (_Err) => (schema, value, _ctx, _params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			if (result.issues.length) {
				const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, _params?.callee);
				throw e;
			}
			return result.value;
		};
		const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			if (result.issues.length) {
				const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
				captureStackTrace(e, params?.callee);
				throw e;
			}
			return result.value;
		};
		const _safeParse = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: false
			} : { async: false };
			const result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) throw new $ZodAsyncError();
			return result.issues.length ? {
				success: false,
				error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
		const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				async: true
			} : { async: true };
			let result = schema._zod.run({
				value,
				issues: []
			}, ctx);
			if (result instanceof Promise) result = await result;
			return result.issues.length ? {
				success: false,
				error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			} : {
				success: true,
				data: result.value
			};
		};
		const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
		const _encode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parse(_Err)(schema, value, ctx);
		};
		const _decode = (_Err) => (schema, value, _ctx) => {
			return _parse(_Err)(schema, value, _ctx);
		};
		const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _parseAsync(_Err)(schema, value, ctx);
		};
		const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _parseAsync(_Err)(schema, value, _ctx);
		};
		const _safeEncode = (_Err) => (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParse(_Err)(schema, value, ctx);
		};
		const _safeDecode = (_Err) => (schema, value, _ctx) => {
			return _safeParse(_Err)(schema, value, _ctx);
		};
		const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
			const ctx = _ctx ? {
				..._ctx,
				direction: "backward"
			} : { direction: "backward" };
			return _safeParseAsync(_Err)(schema, value, ctx);
		};
		const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
			return _safeParseAsync(_Err)(schema, value, _ctx);
		};
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const cuid = /^[cC][0-9a-z]{6,}$/;
		const cuid2 = /^[0-9a-z]+$/;
		const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
		const xid = /^[0-9a-vA-V]{20}$/;
		const ksuid = /^[A-Za-z0-9]{27}$/;
		const nanoid = /^[a-zA-Z0-9_-]{21}$/;
		/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
		const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
		/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
		const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
		/** Returns a regex for validating an RFC 9562/4122 UUID.
		*
		* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
		const uuid = (version) => {
			if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
			return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
		};
		/** Practical email validation */
		const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
		const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
		function emoji() {
			return new RegExp(_emoji$1, "u");
		}
		const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
		const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
		const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
		const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
		const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
		const base64url = /^[A-Za-z0-9_-]*$/;
		const httpProtocol = /^https?$/;
		const e164 = /^\+[1-9]\d{6,14}$/;
		const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
		const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
		function timeSource(args) {
			const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
			return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
		}
		function time$1(args) {
			return new RegExp(`^${timeSource(args)}$`);
		}
		function datetime$1(args) {
			const time = timeSource({ precision: args.precision });
			const opts = ["Z"];
			if (args.local) opts.push("");
			if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
			const timeRegex = `${time}(?:${opts.join("|")})`;
			return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
		}
		const string$1 = (params) => {
			const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
			return new RegExp(`^${regex}$`);
		};
		const integer = /^-?\d+$/;
		const number$1 = /^-?\d+(?:\.\d+)?$/;
		const boolean$1 = /^(?:true|false)$/i;
		const _null$2 = /^null$/i;
		const lowercase = /^[^A-Z]*$/;
		const uppercase = /^[^a-z]*$/;
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
		const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
			var _a;
			inst._zod ?? (inst._zod = {});
			inst._zod.def = def;
			(_a = inst._zod).onattach ?? (_a.onattach = []);
		});
		const numericOriginMap = {
			number: "number",
			bigint: "bigint",
			object: "date"
		};
		const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
				if (def.value < curr) {
					if (def.inclusive) bag.maximum = def.value;
					else bag.exclusiveMaximum = def.value;
				}
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
			$ZodCheck.init(inst, def);
			const origin = numericOriginMap[typeof def.value];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
				if (def.value > curr) {
					if (def.inclusive) bag.minimum = def.value;
					else bag.exclusiveMinimum = def.value;
				}
			});
			inst._zod.check = (payload) => {
				if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
					input: payload.value,
					inclusive: def.inclusive,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				var _a;
				(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
			});
			inst._zod.check = (payload) => {
				if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
				if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
				payload.issues.push({
					origin: typeof payload.value,
					code: "not_multiple_of",
					divisor: def.value,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
			$ZodCheck.init(inst, def);
			def.format = def.format || "float64";
			const isInt = def.format?.includes("int");
			const origin = isInt ? "int" : "number";
			const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				bag.minimum = minimum;
				bag.maximum = maximum;
				if (isInt) bag.pattern = integer;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (isInt) {
					if (!Number.isInteger(input)) {
						payload.issues.push({
							expected: origin,
							format: def.format,
							code: "invalid_type",
							continue: false,
							input,
							inst
						});
						return;
					}
					if (!Number.isSafeInteger(input)) {
						if (input > 0) payload.issues.push({
							input,
							code: "too_big",
							maximum: Number.MAX_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						else payload.issues.push({
							input,
							code: "too_small",
							minimum: Number.MIN_SAFE_INTEGER,
							note: "Integers must be within the safe integer range.",
							inst,
							origin,
							inclusive: true,
							continue: !def.abort
						});
						return;
					}
				}
				if (input < minimum) payload.issues.push({
					origin: "number",
					input,
					code: "too_small",
					minimum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
				if (input > maximum) payload.issues.push({
					origin: "number",
					input,
					code: "too_big",
					maximum,
					inclusive: true,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
				if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length <= def.maximum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_big",
					maximum: def.maximum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
				if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				if (input.length >= def.minimum) return;
				const origin = getLengthableOrigin(input);
				payload.issues.push({
					origin,
					code: "too_small",
					minimum: def.minimum,
					inclusive: true,
					input,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
			var _a;
			$ZodCheck.init(inst, def);
			(_a = inst._zod.def).when ?? (_a.when = (payload) => {
				const val = payload.value;
				return !nullish(val) && val.length !== void 0;
			});
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.minimum = def.length;
				bag.maximum = def.length;
				bag.length = def.length;
			});
			inst._zod.check = (payload) => {
				const input = payload.value;
				const length = input.length;
				if (length === def.length) return;
				const origin = getLengthableOrigin(input);
				const tooBig = length > def.length;
				payload.issues.push({
					origin,
					...tooBig ? {
						code: "too_big",
						maximum: def.length
					} : {
						code: "too_small",
						minimum: def.length
					},
					inclusive: true,
					exact: true,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
			var _a, _b;
			$ZodCheck.init(inst, def);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.format = def.format;
				if (def.pattern) {
					bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
					bag.patterns.add(def.pattern);
				}
			});
			if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: def.format,
					input: payload.value,
					...def.pattern ? { pattern: def.pattern.toString() } : {},
					inst,
					continue: !def.abort
				});
			});
			else (_b = inst._zod).check ?? (_b.check = () => {});
		});
		const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				def.pattern.lastIndex = 0;
				if (def.pattern.test(payload.value)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "regex",
					input: payload.value,
					pattern: def.pattern.toString(),
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
			def.pattern ?? (def.pattern = lowercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
			def.pattern ?? (def.pattern = uppercase);
			$ZodCheckStringFormat.init(inst, def);
		});
		const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
			$ZodCheck.init(inst, def);
			const escapedRegex = escapeRegex(def.includes);
			const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
			def.pattern = pattern;
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.includes(def.includes, def.position)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "includes",
					includes: def.includes,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.startsWith(def.prefix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "starts_with",
					prefix: def.prefix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
			$ZodCheck.init(inst, def);
			const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
			def.pattern ?? (def.pattern = pattern);
			inst._zod.onattach.push((inst) => {
				const bag = inst._zod.bag;
				bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
				bag.patterns.add(pattern);
			});
			inst._zod.check = (payload) => {
				if (payload.value.endsWith(def.suffix)) return;
				payload.issues.push({
					origin: "string",
					code: "invalid_format",
					format: "ends_with",
					suffix: def.suffix,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
			$ZodCheck.init(inst, def);
			inst._zod.check = (payload) => {
				payload.value = def.tx(payload.value);
			};
		});
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
		var Doc = class {
			constructor(args = []) {
				this.content = [];
				this.indent = 0;
				if (this) this.args = args;
			}
			indented(fn) {
				this.indent += 1;
				fn(this);
				this.indent -= 1;
			}
			write(arg) {
				if (typeof arg === "function") {
					arg(this, { execution: "sync" });
					arg(this, { execution: "async" });
					return;
				}
				const lines = arg.split("\n").filter((x) => x);
				const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
				const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
				for (const line of dedented) this.content.push(line);
			}
			compile() {
				const F = Function;
				const args = this?.args;
				const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
				return new F(...args, lines.join("\n"));
			}
		};
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
		const version = {
			major: 4,
			minor: 4,
			patch: 3
		};
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
		const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
			var _a;
			inst ?? (inst = {});
			inst._zod.def = def;
			inst._zod.bag = inst._zod.bag || {};
			inst._zod.version = version;
			const checks = [...inst._zod.def.checks ?? []];
			if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
			for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
			if (checks.length === 0) {
				(_a = inst._zod).deferred ?? (_a.deferred = []);
				inst._zod.deferred?.push(() => {
					inst._zod.run = inst._zod.parse;
				});
			} else {
				const runChecks = (payload, checks, ctx) => {
					let isAborted = aborted(payload);
					let asyncResult;
					for (const ch of checks) {
						if (ch._zod.def.when) {
							if (explicitlyAborted(payload)) continue;
							if (!ch._zod.def.when(payload)) continue;
						} else if (isAborted) continue;
						const currLen = payload.issues.length;
						const _ = ch._zod.check(payload);
						if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
						if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
							await _;
							if (payload.issues.length === currLen) return;
							if (!isAborted) isAborted = aborted(payload, currLen);
						});
						else {
							if (payload.issues.length === currLen) continue;
							if (!isAborted) isAborted = aborted(payload, currLen);
						}
					}
					if (asyncResult) return asyncResult.then(() => {
						return payload;
					});
					return payload;
				};
				const handleCanaryResult = (canary, payload, ctx) => {
					if (aborted(canary)) {
						canary.aborted = true;
						return canary;
					}
					const checkResult = runChecks(payload, checks, ctx);
					if (checkResult instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
					}
					return inst._zod.parse(checkResult, ctx);
				};
				inst._zod.run = (payload, ctx) => {
					if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
					if (ctx.direction === "backward") {
						const canary = inst._zod.parse({
							value: payload.value,
							issues: []
						}, {
							...ctx,
							skipChecks: true
						});
						if (canary instanceof Promise) return canary.then((canary) => {
							return handleCanaryResult(canary, payload, ctx);
						});
						return handleCanaryResult(canary, payload, ctx);
					}
					const result = inst._zod.parse(payload, ctx);
					if (result instanceof Promise) {
						if (ctx.async === false) throw new $ZodAsyncError();
						return result.then((result) => runChecks(result, checks, ctx));
					}
					return runChecks(result, checks, ctx);
				};
			}
			defineLazy(inst, "~standard", () => ({
				validate: (value) => {
					try {
						const r = safeParse$1(inst, value);
						return r.success ? { value: r.data } : { issues: r.error?.issues };
					} catch (_) {
						return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
					}
				},
				vendor: "zod",
				version: 1
			}));
		});
		const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
			inst._zod.parse = (payload, _) => {
				if (def.coerce) try {
					payload.value = String(payload.value);
				} catch (_) {}
				if (typeof payload.value === "string") return payload;
				payload.issues.push({
					expected: "string",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
			$ZodCheckStringFormat.init(inst, def);
			$ZodString.init(inst, def);
		});
		const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
			def.pattern ?? (def.pattern = guid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
			if (def.version) {
				const v = {
					v1: 1,
					v2: 2,
					v3: 3,
					v4: 4,
					v5: 5,
					v6: 6,
					v7: 7,
					v8: 8
				}[def.version];
				if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
				def.pattern ?? (def.pattern = uuid(v));
			} else def.pattern ?? (def.pattern = uuid());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
			def.pattern ?? (def.pattern = email);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				try {
					const trimmed = payload.value.trim();
					if (!def.normalize && def.protocol?.source === httpProtocol.source) {
						if (!/^https?:\/\//i.test(trimmed)) {
							payload.issues.push({
								code: "invalid_format",
								format: "url",
								note: "Invalid URL format",
								input: payload.value,
								inst,
								continue: !def.abort
							});
							return;
						}
					}
					const url = new URL(trimmed);
					if (def.hostname) {
						def.hostname.lastIndex = 0;
						if (!def.hostname.test(url.hostname)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid hostname",
							pattern: def.hostname.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.protocol) {
						def.protocol.lastIndex = 0;
						if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
							code: "invalid_format",
							format: "url",
							note: "Invalid protocol",
							pattern: def.protocol.source,
							input: payload.value,
							inst,
							continue: !def.abort
						});
					}
					if (def.normalize) payload.value = url.href;
					else payload.value = trimmed;
					return;
				} catch (_) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
			def.pattern ?? (def.pattern = emoji());
			$ZodStringFormat.init(inst, def);
		});
		const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
			def.pattern ?? (def.pattern = nanoid);
			$ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
			def.pattern ?? (def.pattern = cuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
			def.pattern ?? (def.pattern = cuid2);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
			def.pattern ?? (def.pattern = ulid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
			def.pattern ?? (def.pattern = xid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
			def.pattern ?? (def.pattern = ksuid);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
			def.pattern ?? (def.pattern = datetime$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
			def.pattern ?? (def.pattern = date$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
			def.pattern ?? (def.pattern = time$1(def));
			$ZodStringFormat.init(inst, def);
		});
		const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
			def.pattern ?? (def.pattern = duration$1);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
			def.pattern ?? (def.pattern = ipv4);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv4`;
		});
		const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
			def.pattern ?? (def.pattern = ipv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.format = `ipv6`;
			inst._zod.check = (payload) => {
				try {
					new URL(`http://[${payload.value}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "ipv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv4);
			$ZodStringFormat.init(inst, def);
		});
		const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
			def.pattern ?? (def.pattern = cidrv6);
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				const parts = payload.value.split("/");
				try {
					if (parts.length !== 2) throw new Error();
					const [address, prefix] = parts;
					if (!prefix) throw new Error();
					const prefixNum = Number(prefix);
					if (`${prefixNum}` !== prefix) throw new Error();
					if (prefixNum < 0 || prefixNum > 128) throw new Error();
					new URL(`http://[${address}]`);
				} catch {
					payload.issues.push({
						code: "invalid_format",
						format: "cidrv6",
						input: payload.value,
						inst,
						continue: !def.abort
					});
				}
			};
		});
		function isValidBase64(data) {
			if (data === "") return true;
			if (/\s/.test(data)) return false;
			if (data.length % 4 !== 0) return false;
			try {
				atob(data);
				return true;
			} catch {
				return false;
			}
		}
		const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
			def.pattern ?? (def.pattern = base64);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64";
			inst._zod.check = (payload) => {
				if (isValidBase64(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		function isValidBase64URL(data) {
			if (!base64url.test(data)) return false;
			const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
			return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		}
		const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
			def.pattern ?? (def.pattern = base64url);
			$ZodStringFormat.init(inst, def);
			inst._zod.bag.contentEncoding = "base64url";
			inst._zod.check = (payload) => {
				if (isValidBase64URL(payload.value)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "base64url",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
			def.pattern ?? (def.pattern = e164);
			$ZodStringFormat.init(inst, def);
		});
		function isValidJWT(token, algorithm = null) {
			try {
				const tokensParts = token.split(".");
				if (tokensParts.length !== 3) return false;
				const [header] = tokensParts;
				if (!header) return false;
				const parsedHeader = JSON.parse(atob(header));
				if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
				if (!parsedHeader.alg) return false;
				if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
				return true;
			} catch {
				return false;
			}
		}
		const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			inst._zod.check = (payload) => {
				if (isValidJWT(payload.value, def.alg)) return;
				payload.issues.push({
					code: "invalid_format",
					format: "jwt",
					input: payload.value,
					inst,
					continue: !def.abort
				});
			};
		});
		const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Number(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
				const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
				payload.issues.push({
					expected: "number",
					code: "invalid_type",
					input,
					inst,
					...received ? { received } : {}
				});
				return payload;
			};
		});
		const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
			$ZodCheckNumberFormat.init(inst, def);
			$ZodNumber.init(inst, def);
		});
		const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = boolean$1;
			inst._zod.parse = (payload, _ctx) => {
				if (def.coerce) try {
					payload.value = Boolean(payload.value);
				} catch (_) {}
				const input = payload.value;
				if (typeof input === "boolean") return payload;
				payload.issues.push({
					expected: "boolean",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodNull = /*@__PURE__*/ $constructor("$ZodNull", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.pattern = _null$2;
			inst._zod.values = /* @__PURE__ */ new Set([null]);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (input === null) return payload;
				payload.issues.push({
					expected: "null",
					code: "invalid_type",
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload) => payload;
		});
		const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _ctx) => {
				payload.issues.push({
					expected: "never",
					code: "invalid_type",
					input: payload.value,
					inst
				});
				return payload;
			};
		});
		function handleArrayResult(result, final, index) {
			if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
			final.value[index] = result.value;
		}
		const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				if (!Array.isArray(input)) {
					payload.issues.push({
						expected: "array",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = Array(input.length);
				const proms = [];
				for (let i = 0; i < input.length; i++) {
					const item = input[i];
					const result = def.element._zod.run({
						value: item,
						issues: []
					}, ctx);
					if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
					else handleArrayResult(result, payload, i);
				}
				if (proms.length) return Promise.all(proms).then(() => payload);
				return payload;
			};
		});
		function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
			const isPresent = key in input;
			if (result.issues.length) {
				if (isOptionalIn && isOptionalOut && !isPresent) return;
				final.issues.push(...prefixIssues(key, result.issues));
			}
			if (!isPresent && !isOptionalIn) {
				if (!result.issues.length) final.issues.push({
					code: "invalid_type",
					expected: "nonoptional",
					input: void 0,
					path: [key]
				});
				return;
			}
			if (result.value === void 0) {
				if (isPresent) final.value[key] = void 0;
			} else final.value[key] = result.value;
		}
		function normalizeDef(def) {
			const keys = Object.keys(def.shape);
			for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
			const okeys = optionalKeys(def.shape);
			return {
				...def,
				keys,
				keySet: new Set(keys),
				numKeys: keys.length,
				optionalKeys: new Set(okeys)
			};
		}
		function handleCatchall(proms, input, payload, ctx, def, inst) {
			const unrecognized = [];
			const keySet = def.keySet;
			const _catchall = def.catchall._zod;
			const t = _catchall.def.type;
			const isOptionalIn = _catchall.optin === "optional";
			const isOptionalOut = _catchall.optout === "optional";
			for (const key in input) {
				if (key === "__proto__") continue;
				if (keySet.has(key)) continue;
				if (t === "never") {
					unrecognized.push(key);
					continue;
				}
				const r = _catchall.run({
					value: input[key],
					issues: []
				}, ctx);
				if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
				else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
			}
			if (unrecognized.length) payload.issues.push({
				code: "unrecognized_keys",
				keys: unrecognized,
				input,
				inst
			});
			if (!proms.length) return payload;
			return Promise.all(proms).then(() => {
				return payload;
			});
		}
		const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
			$ZodType.init(inst, def);
			if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
				const sh = def.shape;
				Object.defineProperty(def, "shape", { get: () => {
					const newSh = { ...sh };
					Object.defineProperty(def, "shape", { value: newSh });
					return newSh;
				} });
			}
			const _normalized = cached(() => normalizeDef(def));
			defineLazy(inst._zod, "propValues", () => {
				const shape = def.shape;
				const propValues = {};
				for (const key in shape) {
					const field = shape[key]._zod;
					if (field.values) {
						propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
						for (const v of field.values) propValues[key].add(v);
					}
				}
				return propValues;
			});
			const isObject$1 = isObject;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$1(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				payload.value = {};
				const proms = [];
				const shape = value.shape;
				for (const key of value.keys) {
					const el = shape[key];
					const isOptionalIn = el._zod.optin === "optional";
					const isOptionalOut = el._zod.optout === "optional";
					const r = el._zod.run({
						value: input[key],
						issues: []
					}, ctx);
					if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
					else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
				}
				if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
				return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
			};
		});
		const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
			$ZodObject.init(inst, def);
			const superParse = inst._zod.parse;
			const _normalized = cached(() => normalizeDef(def));
			const generateFastpass = (shape) => {
				const doc = new Doc([
					"shape",
					"payload",
					"ctx"
				]);
				const normalized = _normalized.value;
				const parseStr = (key) => {
					const k = esc(key);
					return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
				};
				doc.write(`const input = payload.value;`);
				const ids = Object.create(null);
				let counter = 0;
				for (const key of normalized.keys) ids[key] = `key_${counter++}`;
				doc.write(`const newResult = {};`);
				for (const key of normalized.keys) {
					const id = ids[key];
					const k = esc(key);
					const schema = shape[key];
					const isOptionalIn = schema?._zod?.optin === "optional";
					const isOptionalOut = schema?._zod?.optout === "optional";
					doc.write(`const ${id} = ${parseStr(key)};`);
					if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
					else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
					else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
				}
				doc.write(`payload.value = newResult;`);
				doc.write(`return payload;`);
				const fn = doc.compile();
				return (payload, ctx) => fn(shape, payload, ctx);
			};
			let fastpass;
			const isObject$2 = isObject;
			const jit = !globalConfig.jitless;
			const fastEnabled = jit && allowsEval.value;
			const catchall = def.catchall;
			let value;
			inst._zod.parse = (payload, ctx) => {
				value ?? (value = _normalized.value);
				const input = payload.value;
				if (!isObject$2(input)) {
					payload.issues.push({
						expected: "object",
						code: "invalid_type",
						input,
						inst
					});
					return payload;
				}
				if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
					if (!fastpass) fastpass = generateFastpass(def.shape);
					payload = fastpass(payload, ctx);
					if (!catchall) return payload;
					return handleCatchall([], input, payload, ctx, value, inst);
				}
				return superParse(payload, ctx);
			};
		});
		function handleUnionResults(results, final, inst, ctx) {
			for (const result of results) if (result.issues.length === 0) {
				final.value = result.value;
				return final;
			}
			const nonaborted = results.filter((r) => !aborted(r));
			if (nonaborted.length === 1) {
				final.value = nonaborted[0].value;
				return nonaborted[0];
			}
			final.issues.push({
				code: "invalid_union",
				input: final.value,
				inst,
				errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
			});
			return final;
		}
		const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
			defineLazy(inst._zod, "values", () => {
				if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
			});
			defineLazy(inst._zod, "pattern", () => {
				if (def.options.every((o) => o._zod.pattern)) {
					const patterns = def.options.map((o) => o._zod.pattern);
					return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
				}
			});
			const first = def.options.length === 1 ? def.options[0]._zod.run : null;
			inst._zod.parse = (payload, ctx) => {
				if (first) return first(payload, ctx);
				let async = false;
				const results = [];
				for (const option of def.options) {
					const result = option._zod.run({
						value: payload.value,
						issues: []
					}, ctx);
					if (result instanceof Promise) {
						results.push(result);
						async = true;
					} else {
						if (result.issues.length === 0) return result;
						results.push(result);
					}
				}
				if (!async) return handleUnionResults(results, payload, inst, ctx);
				return Promise.all(results).then((results) => {
					return handleUnionResults(results, payload, inst, ctx);
				});
			};
		});
		const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, ctx) => {
				const input = payload.value;
				const left = def.left._zod.run({
					value: input,
					issues: []
				}, ctx);
				const right = def.right._zod.run({
					value: input,
					issues: []
				}, ctx);
				if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
					return handleIntersectionResults(payload, left, right);
				});
				return handleIntersectionResults(payload, left, right);
			};
		});
		function mergeValues(a, b) {
			if (a === b) return {
				valid: true,
				data: a
			};
			if (a instanceof Date && b instanceof Date && +a === +b) return {
				valid: true,
				data: a
			};
			if (isPlainObject(a) && isPlainObject(b)) {
				const bKeys = Object.keys(b);
				const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
				const newObj = {
					...a,
					...b
				};
				for (const key of sharedKeys) {
					const sharedValue = mergeValues(a[key], b[key]);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
					};
					newObj[key] = sharedValue.data;
				}
				return {
					valid: true,
					data: newObj
				};
			}
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return {
					valid: false,
					mergeErrorPath: []
				};
				const newArray = [];
				for (let index = 0; index < a.length; index++) {
					const itemA = a[index];
					const itemB = b[index];
					const sharedValue = mergeValues(itemA, itemB);
					if (!sharedValue.valid) return {
						valid: false,
						mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
					};
					newArray.push(sharedValue.data);
				}
				return {
					valid: true,
					data: newArray
				};
			}
			return {
				valid: false,
				mergeErrorPath: []
			};
		}
		function handleIntersectionResults(result, left, right) {
			const unrecKeys = /* @__PURE__ */ new Map();
			let unrecIssue;
			for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
				unrecIssue ?? (unrecIssue = iss);
				for (const k of iss.keys) {
					if (!unrecKeys.has(k)) unrecKeys.set(k, {});
					unrecKeys.get(k).l = true;
				}
			} else result.issues.push(iss);
			for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
				if (!unrecKeys.has(k)) unrecKeys.set(k, {});
				unrecKeys.get(k).r = true;
			}
			else result.issues.push(iss);
			const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
			if (bothKeys.length && unrecIssue) result.issues.push({
				...unrecIssue,
				keys: bothKeys
			});
			if (aborted(result)) return result;
			const merged = mergeValues(left.value, right.value);
			if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
			result.value = merged.data;
			return result;
		}
		const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
			$ZodType.init(inst, def);
			const values = getEnumValues(def.entries);
			const valuesSet = new Set(values);
			inst._zod.values = valuesSet;
			inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (valuesSet.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
			$ZodType.init(inst, def);
			if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
			const values = new Set(def.values);
			inst._zod.values = values;
			inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
			inst._zod.parse = (payload, _ctx) => {
				const input = payload.value;
				if (values.has(input)) return payload;
				payload.issues.push({
					code: "invalid_value",
					values: def.values,
					input,
					inst
				});
				return payload;
			};
		});
		const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				const _out = def.transform(payload.value, payload);
				if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				if (_out instanceof Promise) throw new $ZodAsyncError();
				payload.value = _out;
				payload.fallback = true;
				return payload;
			};
		});
		function handleOptionalResult(result, input) {
			if (input === void 0 && (result.issues.length || result.fallback)) return {
				issues: [],
				value: void 0
			};
			return result;
		}
		const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			inst._zod.optout = "optional";
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
			});
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (def.innerType._zod.optin === "optional") {
					const input = payload.value;
					const result = def.innerType._zod.run(payload, ctx);
					if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
					return handleOptionalResult(result, input);
				}
				if (payload.value === void 0) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
			inst._zod.parse = (payload, ctx) => {
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "pattern", () => {
				const pattern = def.innerType._zod.pattern;
				return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
			});
			defineLazy(inst._zod, "values", () => {
				return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				if (payload.value === null) return payload;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) {
					payload.value = def.defaultValue;
					/**
					* $ZodDefault returns the default value immediately in forward direction.
					* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
					return payload;
				}
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
				return handleDefaultResult(result, def);
			};
		});
		function handleDefaultResult(payload, def) {
			if (payload.value === void 0) payload.value = def.defaultValue;
			return payload;
		}
		const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				if (payload.value === void 0) payload.value = def.defaultValue;
				return def.innerType._zod.run(payload, ctx);
			};
		});
		const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => {
				const v = def.innerType._zod.values;
				return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
			});
			inst._zod.parse = (payload, ctx) => {
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
				return handleNonOptionalResult(result, inst);
			};
		});
		function handleNonOptionalResult(payload, inst) {
			if (!payload.issues.length && payload.value === void 0) payload.issues.push({
				code: "invalid_type",
				expected: "nonoptional",
				input: payload.value,
				inst
			});
			return payload;
		}
		const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
			$ZodType.init(inst, def);
			inst._zod.optin = "optional";
			defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then((result) => {
					payload.value = result.value;
					if (result.issues.length) {
						payload.value = def.catchValue({
							...payload,
							error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
							input: payload.value
						});
						payload.issues = [];
						payload.fallback = true;
					}
					return payload;
				});
				payload.value = result.value;
				if (result.issues.length) {
					payload.value = def.catchValue({
						...payload,
						error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
						input: payload.value
					});
					payload.issues = [];
					payload.fallback = true;
				}
				return payload;
			};
		});
		const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "values", () => def.in._zod.values);
			defineLazy(inst._zod, "optin", () => def.in._zod.optin);
			defineLazy(inst._zod, "optout", () => def.out._zod.optout);
			defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") {
					const right = def.out._zod.run(payload, ctx);
					if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
					return handlePipeResult(right, def.in, ctx);
				}
				const left = def.in._zod.run(payload, ctx);
				if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
				return handlePipeResult(left, def.out, ctx);
			};
		});
		function handlePipeResult(left, next, ctx) {
			if (left.issues.length) {
				left.aborted = true;
				return left;
			}
			return next._zod.run({
				value: left.value,
				issues: left.issues,
				fallback: left.fallback
			}, ctx);
		}
		const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
			$ZodType.init(inst, def);
			defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
			defineLazy(inst._zod, "values", () => def.innerType._zod.values);
			defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
			defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
			inst._zod.parse = (payload, ctx) => {
				if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
				const result = def.innerType._zod.run(payload, ctx);
				if (result instanceof Promise) return result.then(handleReadonlyResult);
				return handleReadonlyResult(result);
			};
		});
		function handleReadonlyResult(payload) {
			payload.value = Object.freeze(payload.value);
			return payload;
		}
		const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
			$ZodCheck.init(inst, def);
			$ZodType.init(inst, def);
			inst._zod.parse = (payload, _) => {
				return payload;
			};
			inst._zod.check = (payload) => {
				const input = payload.value;
				const r = def.fn(input);
				if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
				handleRefineResult(r, payload, input, inst);
			};
		});
		function handleRefineResult(result, payload, input, inst) {
			if (!result) {
				const _iss = {
					code: "custom",
					input,
					inst,
					path: [...inst._zod.def.path ?? []],
					continue: !inst._zod.def.abort
				};
				if (inst._zod.def.params) _iss.params = inst._zod.def.params;
				payload.issues.push(issue(_iss));
			}
		}
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
		var _a;
		var $ZodRegistry = class {
			constructor() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
			}
			add(schema, ..._meta) {
				const meta = _meta[0];
				this._map.set(schema, meta);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
				return this;
			}
			clear() {
				this._map = /* @__PURE__ */ new WeakMap();
				this._idmap = /* @__PURE__ */ new Map();
				return this;
			}
			remove(schema) {
				const meta = this._map.get(schema);
				if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
				this._map.delete(schema);
				return this;
			}
			get(schema) {
				const p = schema._zod.parent;
				if (p) {
					const pm = { ...this.get(p) ?? {} };
					delete pm.id;
					const f = {
						...pm,
						...this._map.get(schema)
					};
					return Object.keys(f).length ? f : void 0;
				}
				return this._map.get(schema);
			}
			has(schema) {
				return this._map.has(schema);
			}
		};
		function registry() {
			return new $ZodRegistry();
		}
		(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
		const globalRegistry = globalThis.__zod_globalRegistry;
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
		// @__NO_SIDE_EFFECTS__
		function _string(Class, params) {
			return new Class({
				type: "string",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _email(Class, params) {
			return new Class({
				type: "string",
				format: "email",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _guid(Class, params) {
			return new Class({
				type: "string",
				format: "guid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuid(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv4(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v4",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv6(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v6",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uuidv7(Class, params) {
			return new Class({
				type: "string",
				format: "uuid",
				check: "string_format",
				abort: false,
				version: "v7",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _url(Class, params) {
			return new Class({
				type: "string",
				format: "url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _emoji(Class, params) {
			return new Class({
				type: "string",
				format: "emoji",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _nanoid(Class, params) {
			return new Class({
				type: "string",
				format: "nanoid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link _cuid2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		// @__NO_SIDE_EFFECTS__
		function _cuid(Class, params) {
			return new Class({
				type: "string",
				format: "cuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cuid2(Class, params) {
			return new Class({
				type: "string",
				format: "cuid2",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ulid(Class, params) {
			return new Class({
				type: "string",
				format: "ulid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _xid(Class, params) {
			return new Class({
				type: "string",
				format: "xid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ksuid(Class, params) {
			return new Class({
				type: "string",
				format: "ksuid",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv4(Class, params) {
			return new Class({
				type: "string",
				format: "ipv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _ipv6(Class, params) {
			return new Class({
				type: "string",
				format: "ipv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv4(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv4",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _cidrv6(Class, params) {
			return new Class({
				type: "string",
				format: "cidrv6",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64(Class, params) {
			return new Class({
				type: "string",
				format: "base64",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _base64url(Class, params) {
			return new Class({
				type: "string",
				format: "base64url",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _e164(Class, params) {
			return new Class({
				type: "string",
				format: "e164",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _jwt(Class, params) {
			return new Class({
				type: "string",
				format: "jwt",
				check: "string_format",
				abort: false,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDateTime(Class, params) {
			return new Class({
				type: "string",
				format: "datetime",
				check: "string_format",
				offset: false,
				local: false,
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDate(Class, params) {
			return new Class({
				type: "string",
				format: "date",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoTime(Class, params) {
			return new Class({
				type: "string",
				format: "time",
				check: "string_format",
				precision: null,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _isoDuration(Class, params) {
			return new Class({
				type: "string",
				format: "duration",
				check: "string_format",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _number(Class, params) {
			return new Class({
				type: "number",
				checks: [],
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _int(Class, params) {
			return new Class({
				type: "number",
				check: "number_format",
				abort: false,
				format: "safeint",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _boolean(Class, params) {
			return new Class({
				type: "boolean",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _null$1(Class, params) {
			return new Class({
				type: "null",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _unknown(Class) {
			return new Class({ type: "unknown" });
		}
		// @__NO_SIDE_EFFECTS__
		function _never(Class, params) {
			return new Class({
				type: "never",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lt(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lte(value, params) {
			return new $ZodCheckLessThan({
				check: "less_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gt(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: false
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _gte(value, params) {
			return new $ZodCheckGreaterThan({
				check: "greater_than",
				...normalizeParams(params),
				value,
				inclusive: true
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _multipleOf(value, params) {
			return new $ZodCheckMultipleOf({
				check: "multiple_of",
				...normalizeParams(params),
				value
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _maxLength(maximum, params) {
			return new $ZodCheckMaxLength({
				check: "max_length",
				...normalizeParams(params),
				maximum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _minLength(minimum, params) {
			return new $ZodCheckMinLength({
				check: "min_length",
				...normalizeParams(params),
				minimum
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _length(length, params) {
			return new $ZodCheckLengthEquals({
				check: "length_equals",
				...normalizeParams(params),
				length
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _regex(pattern, params) {
			return new $ZodCheckRegex({
				check: "string_format",
				format: "regex",
				...normalizeParams(params),
				pattern
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _lowercase(params) {
			return new $ZodCheckLowerCase({
				check: "string_format",
				format: "lowercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _uppercase(params) {
			return new $ZodCheckUpperCase({
				check: "string_format",
				format: "uppercase",
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _includes(includes, params) {
			return new $ZodCheckIncludes({
				check: "string_format",
				format: "includes",
				...normalizeParams(params),
				includes
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _startsWith(prefix, params) {
			return new $ZodCheckStartsWith({
				check: "string_format",
				format: "starts_with",
				...normalizeParams(params),
				prefix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _endsWith(suffix, params) {
			return new $ZodCheckEndsWith({
				check: "string_format",
				format: "ends_with",
				...normalizeParams(params),
				suffix
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _overwrite(tx) {
			return new $ZodCheckOverwrite({
				check: "overwrite",
				tx
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _normalize(form) {
			return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
		}
		// @__NO_SIDE_EFFECTS__
		function _trim() {
			return /* @__PURE__ */ _overwrite((input) => input.trim());
		}
		// @__NO_SIDE_EFFECTS__
		function _toLowerCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _toUpperCase() {
			return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
		}
		// @__NO_SIDE_EFFECTS__
		function _slugify() {
			return /* @__PURE__ */ _overwrite((input) => slugify(input));
		}
		// @__NO_SIDE_EFFECTS__
		function _array(Class, element, params) {
			return new Class({
				type: "array",
				element,
				...normalizeParams(params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _refine(Class, fn, _params) {
			return new Class({
				type: "custom",
				check: "custom",
				fn,
				...normalizeParams(_params)
			});
		}
		// @__NO_SIDE_EFFECTS__
		function _superRefine(fn, params) {
			const ch = /* @__PURE__ */ _check((payload) => {
				payload.addIssue = (issue$2) => {
					if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
					else {
						const _issue = issue$2;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = ch);
						_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
						payload.issues.push(issue(_issue));
					}
				};
				return fn(payload.value, payload);
			}, params);
			return ch;
		}
		// @__NO_SIDE_EFFECTS__
		function _check(fn, params) {
			const ch = new $ZodCheck({
				check: "custom",
				...normalizeParams(params)
			});
			ch._zod.check = fn;
			return ch;
		}
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
		function initializeContext(params) {
			let target = params?.target ?? "draft-2020-12";
			if (target === "draft-4") target = "draft-04";
			if (target === "draft-7") target = "draft-07";
			return {
				processors: params.processors ?? {},
				metadataRegistry: params?.metadata ?? globalRegistry,
				target,
				unrepresentable: params?.unrepresentable ?? "throw",
				override: params?.override ?? (() => {}),
				io: params?.io ?? "output",
				counter: 0,
				seen: /* @__PURE__ */ new Map(),
				cycles: params?.cycles ?? "ref",
				reused: params?.reused ?? "inline",
				external: params?.external ?? void 0
			};
		}
		function process(schema, ctx, _params = {
			path: [],
			schemaPath: []
		}) {
			var _a;
			const def = schema._zod.def;
			const seen = ctx.seen.get(schema);
			if (seen) {
				seen.count++;
				if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
				return seen.schema;
			}
			const result = {
				schema: {},
				count: 1,
				cycle: void 0,
				path: _params.path
			};
			ctx.seen.set(schema, result);
			const overrideSchema = schema._zod.toJSONSchema?.();
			if (overrideSchema) result.schema = overrideSchema;
			else {
				const params = {
					..._params,
					schemaPath: [..._params.schemaPath, schema],
					path: _params.path
				};
				if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
				else {
					const _json = result.schema;
					const processor = ctx.processors[def.type];
					if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
					processor(schema, ctx, _json, params);
				}
				const parent = schema._zod.parent;
				if (parent) {
					if (!result.ref) result.ref = parent;
					process(parent, ctx, params);
					ctx.seen.get(parent).isParent = true;
				}
			}
			const meta = ctx.metadataRegistry.get(schema);
			if (meta) Object.assign(result.schema, meta);
			if (ctx.io === "input" && isTransforming(schema)) {
				delete result.schema.examples;
				delete result.schema.default;
			}
			if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
			delete result.schema._prefault;
			return ctx.seen.get(schema).schema;
		}
		function extractDefs(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const idToSchema = /* @__PURE__ */ new Map();
			for (const entry of ctx.seen.entries()) {
				const id = ctx.metadataRegistry.get(entry[0])?.id;
				if (id) {
					const existing = idToSchema.get(id);
					if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
					idToSchema.set(id, entry[0]);
				}
			}
			const makeURI = (entry) => {
				const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
				if (ctx.external) {
					const externalId = ctx.external.registry.get(entry[0])?.id;
					const uriGenerator = ctx.external.uri ?? ((id) => id);
					if (externalId) return { ref: uriGenerator(externalId) };
					const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
					entry[1].defId = id;
					return {
						defId: id,
						ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
					};
				}
				if (entry[1] === root) return { ref: "#" };
				const defUriPrefix = `#/${defsSegment}/`;
				const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
				return {
					defId,
					ref: defUriPrefix + defId
				};
			};
			const extractToDef = (entry) => {
				if (entry[1].schema.$ref) return;
				const seen = entry[1];
				const { ref, defId } = makeURI(entry);
				seen.def = { ...seen.schema };
				if (defId) seen.defId = defId;
				const schema = seen.schema;
				for (const key in schema) delete schema[key];
				schema.$ref = ref;
			};
			if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
			}
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (schema === entry[0]) {
					extractToDef(entry);
					continue;
				}
				if (ctx.external) {
					const ext = ctx.external.registry.get(entry[0])?.id;
					if (schema !== entry[0] && ext) {
						extractToDef(entry);
						continue;
					}
				}
				if (ctx.metadataRegistry.get(entry[0])?.id) {
					extractToDef(entry);
					continue;
				}
				if (seen.cycle) {
					extractToDef(entry);
					continue;
				}
				if (seen.count > 1) {
					if (ctx.reused === "ref") {
						extractToDef(entry);
						continue;
					}
				}
			}
		}
		function finalize(ctx, schema) {
			const root = ctx.seen.get(schema);
			if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
			const flattenRef = (zodSchema) => {
				const seen = ctx.seen.get(zodSchema);
				if (seen.ref === null) return;
				const schema = seen.def ?? seen.schema;
				const _cached = { ...schema };
				const ref = seen.ref;
				seen.ref = null;
				if (ref) {
					flattenRef(ref);
					const refSeen = ctx.seen.get(ref);
					const refSchema = refSeen.schema;
					if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
						schema.allOf = schema.allOf ?? [];
						schema.allOf.push(refSchema);
					} else Object.assign(schema, refSchema);
					Object.assign(schema, _cached);
					if (zodSchema._zod.parent === ref) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (!(key in _cached)) delete schema[key];
					}
					if (refSchema.$ref && refSeen.def) for (const key in schema) {
						if (key === "$ref" || key === "allOf") continue;
						if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
					}
				}
				const parent = zodSchema._zod.parent;
				if (parent && parent !== ref) {
					flattenRef(parent);
					const parentSeen = ctx.seen.get(parent);
					if (parentSeen?.schema.$ref) {
						schema.$ref = parentSeen.schema.$ref;
						if (parentSeen.def) for (const key in schema) {
							if (key === "$ref" || key === "allOf") continue;
							if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
						}
					}
				}
				ctx.override({
					zodSchema,
					jsonSchema: schema,
					path: seen.path ?? []
				});
			};
			for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
			const result = {};
			if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
			else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
			else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
			else if (ctx.target === "openapi-3.0") {}
			if (ctx.external?.uri) {
				const id = ctx.external.registry.get(schema)?.id;
				if (!id) throw new Error("Schema is missing an `id` property");
				result.$id = ctx.external.uri(id);
			}
			Object.assign(result, root.def ?? root.schema);
			const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
			if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
			const defs = ctx.external?.defs ?? {};
			for (const entry of ctx.seen.entries()) {
				const seen = entry[1];
				if (seen.def && seen.defId) {
					if (seen.def.id === seen.defId) delete seen.def.id;
					defs[seen.defId] = seen.def;
				}
			}
			if (ctx.external) {} else if (Object.keys(defs).length > 0) {
				if (ctx.target === "draft-2020-12") result.$defs = defs;
				else result.definitions = defs;
			}
			try {
				const finalized = JSON.parse(JSON.stringify(result));
				Object.defineProperty(finalized, "~standard", {
					value: {
						...schema["~standard"],
						jsonSchema: {
							input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
							output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
						}
					},
					enumerable: false,
					writable: false
				});
				return finalized;
			} catch (_err) {
				throw new Error("Error converting schema to JSON.");
			}
		}
		function isTransforming(_schema, _ctx) {
			const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
			if (ctx.seen.has(_schema)) return false;
			ctx.seen.add(_schema);
			const def = _schema._zod.def;
			if (def.type === "transform") return true;
			if (def.type === "array") return isTransforming(def.element, ctx);
			if (def.type === "set") return isTransforming(def.valueType, ctx);
			if (def.type === "lazy") return isTransforming(def.getter(), ctx);
			if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
			if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
			if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
			if (def.type === "pipe") {
				if (_schema._zod.traits.has("$ZodCodec")) return true;
				return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
			}
			if (def.type === "object") {
				for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
				return false;
			}
			if (def.type === "union") {
				for (const option of def.options) if (isTransforming(option, ctx)) return true;
				return false;
			}
			if (def.type === "tuple") {
				for (const item of def.items) if (isTransforming(item, ctx)) return true;
				if (def.rest && isTransforming(def.rest, ctx)) return true;
				return false;
			}
			return false;
		}
		/**
		* Creates a toJSONSchema method for a schema instance.
		* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
		*/
		const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
			const ctx = initializeContext({
				...params,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
			const { libraryOptions, target } = params ?? {};
			const ctx = initializeContext({
				...libraryOptions ?? {},
				target,
				io,
				processors
			});
			process(schema, ctx);
			extractDefs(ctx, schema);
			return finalize(ctx, schema);
		};
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
		const formatMap = {
			guid: "uuid",
			url: "uri",
			datetime: "date-time",
			json_string: "json-string",
			regex: ""
		};
		const stringProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			json.type = "string";
			const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
			if (typeof minimum === "number") json.minLength = minimum;
			if (typeof maximum === "number") json.maxLength = maximum;
			if (format) {
				json.format = formatMap[format] ?? format;
				if (json.format === "") delete json.format;
				if (format === "time") delete json.format;
			}
			if (contentEncoding) json.contentEncoding = contentEncoding;
			if (patterns && patterns.size > 0) {
				const regexes = [...patterns];
				if (regexes.length === 1) json.pattern = regexes[0].source;
				else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
					...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
					pattern: regex.source
				}))];
			}
		};
		const numberProcessor = (schema, ctx, _json, _params) => {
			const json = _json;
			const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
			if (typeof format === "string" && format.includes("int")) json.type = "integer";
			else json.type = "number";
			const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
			const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
			const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
			if (exMin) {
				if (legacy) {
					json.minimum = exclusiveMinimum;
					json.exclusiveMinimum = true;
				} else json.exclusiveMinimum = exclusiveMinimum;
			} else if (typeof minimum === "number") json.minimum = minimum;
			if (exMax) {
				if (legacy) {
					json.maximum = exclusiveMaximum;
					json.exclusiveMaximum = true;
				} else json.exclusiveMaximum = exclusiveMaximum;
			} else if (typeof maximum === "number") json.maximum = maximum;
			if (typeof multipleOf === "number") json.multipleOf = multipleOf;
		};
		const booleanProcessor = (_schema, _ctx, json, _params) => {
			json.type = "boolean";
		};
		const nullProcessor = (_schema, ctx, json, _params) => {
			if (ctx.target === "openapi-3.0") {
				json.type = "string";
				json.nullable = true;
				json.enum = [null];
			} else json.type = "null";
		};
		const neverProcessor = (_schema, _ctx, json, _params) => {
			json.not = {};
		};
		const enumProcessor = (schema, _ctx, json, _params) => {
			const def = schema._zod.def;
			const values = getEnumValues(def.entries);
			if (values.every((v) => typeof v === "number")) json.type = "number";
			if (values.every((v) => typeof v === "string")) json.type = "string";
			json.enum = values;
		};
		const literalProcessor = (schema, ctx, json, _params) => {
			const def = schema._zod.def;
			const vals = [];
			for (const val of def.values) if (val === void 0) {
				if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
			} else if (typeof val === "bigint") {
				if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
				else vals.push(Number(val));
			} else vals.push(val);
			if (vals.length === 0) {} else if (vals.length === 1) {
				const val = vals[0];
				json.type = val === null ? "null" : typeof val;
				if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
				else json.const = val;
			} else {
				if (vals.every((v) => typeof v === "number")) json.type = "number";
				if (vals.every((v) => typeof v === "string")) json.type = "string";
				if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
				if (vals.every((v) => v === null)) json.type = "null";
				json.enum = vals;
			}
		};
		const customProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
		};
		const transformProcessor = (_schema, ctx, _json, _params) => {
			if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
		};
		const arrayProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			const { minimum, maximum } = schema._zod.bag;
			if (typeof minimum === "number") json.minItems = minimum;
			if (typeof maximum === "number") json.maxItems = maximum;
			json.type = "array";
			json.items = process(def.element, ctx, {
				...params,
				path: [...params.path, "items"]
			});
		};
		const objectProcessor = (schema, ctx, _json, params) => {
			const json = _json;
			const def = schema._zod.def;
			json.type = "object";
			json.properties = {};
			const shape = def.shape;
			for (const key in shape) json.properties[key] = process(shape[key], ctx, {
				...params,
				path: [
					...params.path,
					"properties",
					key
				]
			});
			const allKeys = new Set(Object.keys(shape));
			const requiredKeys = new Set([...allKeys].filter((key) => {
				const v = def.shape[key]._zod;
				if (ctx.io === "input") return v.optin === void 0;
				else return v.optout === void 0;
			}));
			if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
			if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
			else if (!def.catchall) {
				if (ctx.io === "output") json.additionalProperties = false;
			} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
				...params,
				path: [...params.path, "additionalProperties"]
			});
		};
		const unionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const isExclusive = def.inclusive === false;
			const options = def.options.map((x, i) => process(x, ctx, {
				...params,
				path: [
					...params.path,
					isExclusive ? "oneOf" : "anyOf",
					i
				]
			}));
			if (isExclusive) json.oneOf = options;
			else json.anyOf = options;
		};
		const intersectionProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const a = process(def.left, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					0
				]
			});
			const b = process(def.right, ctx, {
				...params,
				path: [
					...params.path,
					"allOf",
					1
				]
			});
			const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
			json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
		};
		const nullableProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			const inner = process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			if (ctx.target === "openapi-3.0") {
				seen.ref = def.innerType;
				json.nullable = true;
			} else json.anyOf = [inner, { type: "null" }];
		};
		const nonoptionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		const defaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.default = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const prefaultProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
		};
		const catchProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			let catchValue;
			try {
				catchValue = def.catchValue(void 0);
			} catch {
				throw new Error("Dynamic catch values are not supported in JSON Schema");
			}
			json.default = catchValue;
		};
		const pipeProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			const inIsTransform = def.in._zod.traits.has("$ZodTransform");
			const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
			process(innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = innerType;
		};
		const readonlyProcessor = (schema, ctx, json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
			json.readOnly = true;
		};
		const optionalProcessor = (schema, ctx, _json, params) => {
			const def = schema._zod.def;
			process(def.innerType, ctx, params);
			const seen = ctx.seen.get(schema);
			seen.ref = def.innerType;
		};
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
		const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
			$ZodISODateTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function datetime(params) {
			return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
		}
		const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
			$ZodISODate.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function date(params) {
			return /* @__PURE__ */ _isoDate(ZodISODate, params);
		}
		const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
			$ZodISOTime.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function time(params) {
			return /* @__PURE__ */ _isoTime(ZodISOTime, params);
		}
		const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
			$ZodISODuration.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		function duration(params) {
			return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
		}
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
		const initializer = (inst, issues) => {
			$ZodError.init(inst, issues);
			inst.name = "ZodError";
			Object.defineProperties(inst, {
				format: { value: (mapper) => formatError(inst, mapper) },
				flatten: { value: (mapper) => flattenError(inst, mapper) },
				addIssue: { value: (issue) => {
					inst.issues.push(issue);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				addIssues: { value: (issues) => {
					inst.issues.push(...issues);
					inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
				} },
				isEmpty: { get() {
					return inst.issues.length === 0;
				} }
			});
		};
		const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
		const parse = /* @__PURE__ */ _parse(ZodRealError);
		const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
		const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
		const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
		const encode = /* @__PURE__ */ _encode(ZodRealError);
		const decode = /* @__PURE__ */ _decode(ZodRealError);
		const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
		const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
		const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
		const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
		const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
		const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
		// node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
		const _installedGroups = /* @__PURE__ */ new WeakMap();
		function _installLazyMethods(inst, group, methods) {
			const proto = Object.getPrototypeOf(inst);
			let installed = _installedGroups.get(proto);
			if (!installed) {
				installed = /* @__PURE__ */ new Set();
				_installedGroups.set(proto, installed);
			}
			if (installed.has(group)) return;
			installed.add(group);
			for (const key in methods) {
				const fn = methods[key];
				Object.defineProperty(proto, key, {
					configurable: true,
					enumerable: false,
					get() {
						const bound = fn.bind(this);
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: bound
						});
						return bound;
					},
					set(v) {
						Object.defineProperty(this, key, {
							configurable: true,
							writable: true,
							enumerable: true,
							value: v
						});
					}
				});
			}
		}
		const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
			$ZodType.init(inst, def);
			Object.assign(inst["~standard"], { jsonSchema: {
				input: createStandardJSONSchemaMethod(inst, "input"),
				output: createStandardJSONSchemaMethod(inst, "output")
			} });
			inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
			inst.def = def;
			inst.type = def.type;
			Object.defineProperty(inst, "_def", { value: def });
			inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
			inst.safeParse = (data, params) => safeParse(inst, data, params);
			inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
			inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
			inst.spa = inst.safeParseAsync;
			inst.encode = (data, params) => encode(inst, data, params);
			inst.decode = (data, params) => decode(inst, data, params);
			inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
			inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
			inst.safeEncode = (data, params) => safeEncode(inst, data, params);
			inst.safeDecode = (data, params) => safeDecode(inst, data, params);
			inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
			inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
			_installLazyMethods(inst, "ZodType", {
				check(...chks) {
					const def = this.def;
					return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
						check: ch,
						def: { check: "custom" },
						onattach: []
					} } : ch)] }), { parent: true });
				},
				with(...chks) {
					return this.check(...chks);
				},
				clone(def, params) {
					return clone(this, def, params);
				},
				brand() {
					return this;
				},
				register(reg, meta) {
					reg.add(this, meta);
					return this;
				},
				refine(check, params) {
					return this.check(refine(check, params));
				},
				superRefine(refinement, params) {
					return this.check(superRefine(refinement, params));
				},
				overwrite(fn) {
					return this.check(/* @__PURE__ */ _overwrite(fn));
				},
				optional() {
					return optional(this);
				},
				exactOptional() {
					return exactOptional(this);
				},
				nullable() {
					return nullable(this);
				},
				nullish() {
					return optional(nullable(this));
				},
				nonoptional(params) {
					return nonoptional(this, params);
				},
				array() {
					return array(this);
				},
				or(arg) {
					return union([this, arg]);
				},
				and(arg) {
					return intersection(this, arg);
				},
				transform(tx) {
					return pipe(this, transform(tx));
				},
				default(d) {
					return _default(this, d);
				},
				prefault(d) {
					return prefault(this, d);
				},
				catch(params) {
					return _catch(this, params);
				},
				pipe(target) {
					return pipe(this, target);
				},
				readonly() {
					return readonly(this);
				},
				describe(description) {
					const cl = this.clone();
					globalRegistry.add(cl, { description });
					return cl;
				},
				meta(...args) {
					if (args.length === 0) return globalRegistry.get(this);
					const cl = this.clone();
					globalRegistry.add(cl, args[0]);
					return cl;
				},
				isOptional() {
					return this.safeParse(void 0).success;
				},
				isNullable() {
					return this.safeParse(null).success;
				},
				apply(fn) {
					return fn(this);
				}
			});
			Object.defineProperty(inst, "description", {
				get() {
					return globalRegistry.get(inst)?.description;
				},
				configurable: true
			});
			return inst;
		});
		/** @internal */
		const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
			const bag = inst._zod.bag;
			inst.format = bag.format ?? null;
			inst.minLength = bag.minimum ?? null;
			inst.maxLength = bag.maximum ?? null;
			_installLazyMethods(inst, "_ZodString", {
				regex(...args) {
					return this.check(/* @__PURE__ */ _regex(...args));
				},
				includes(...args) {
					return this.check(/* @__PURE__ */ _includes(...args));
				},
				startsWith(...args) {
					return this.check(/* @__PURE__ */ _startsWith(...args));
				},
				endsWith(...args) {
					return this.check(/* @__PURE__ */ _endsWith(...args));
				},
				min(...args) {
					return this.check(/* @__PURE__ */ _minLength(...args));
				},
				max(...args) {
					return this.check(/* @__PURE__ */ _maxLength(...args));
				},
				length(...args) {
					return this.check(/* @__PURE__ */ _length(...args));
				},
				nonempty(...args) {
					return this.check(/* @__PURE__ */ _minLength(1, ...args));
				},
				lowercase(params) {
					return this.check(/* @__PURE__ */ _lowercase(params));
				},
				uppercase(params) {
					return this.check(/* @__PURE__ */ _uppercase(params));
				},
				trim() {
					return this.check(/* @__PURE__ */ _trim());
				},
				normalize(...args) {
					return this.check(/* @__PURE__ */ _normalize(...args));
				},
				toLowerCase() {
					return this.check(/* @__PURE__ */ _toLowerCase());
				},
				toUpperCase() {
					return this.check(/* @__PURE__ */ _toUpperCase());
				},
				slugify() {
					return this.check(/* @__PURE__ */ _slugify());
				}
			});
		});
		const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
			$ZodString.init(inst, def);
			_ZodString.init(inst, def);
			inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
			inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
			inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
			inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
			inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
			inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
			inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
			inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
			inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
			inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
			inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
			inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
			inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
			inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
			inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
			inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
			inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
			inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
			inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
			inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
			inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
			inst.datetime = (params) => inst.check(datetime(params));
			inst.date = (params) => inst.check(date(params));
			inst.time = (params) => inst.check(time(params));
			inst.duration = (params) => inst.check(duration(params));
		});
		function string(params) {
			return /* @__PURE__ */ _string(ZodString, params);
		}
		const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
			$ZodStringFormat.init(inst, def);
			_ZodString.init(inst, def);
		});
		const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
			$ZodEmail.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
			$ZodGUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
			$ZodUUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
			$ZodURL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
			$ZodEmoji.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
			$ZodNanoID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		/**
		* @deprecated CUID v1 is deprecated by its authors due to information leakage
		* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
		* See https://github.com/paralleldrive/cuid.
		*/
		const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
			$ZodCUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
			$ZodCUID2.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
			$ZodULID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
			$ZodXID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
			$ZodKSUID.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
			$ZodIPv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
			$ZodIPv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
			$ZodCIDRv4.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
			$ZodCIDRv6.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
			$ZodBase64.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
			$ZodBase64URL.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
			$ZodE164.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
			$ZodJWT.init(inst, def);
			ZodStringFormat.init(inst, def);
		});
		const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
			$ZodNumber.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
			_installLazyMethods(inst, "ZodNumber", {
				gt(value, params) {
					return this.check(/* @__PURE__ */ _gt(value, params));
				},
				gte(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				min(value, params) {
					return this.check(/* @__PURE__ */ _gte(value, params));
				},
				lt(value, params) {
					return this.check(/* @__PURE__ */ _lt(value, params));
				},
				lte(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				max(value, params) {
					return this.check(/* @__PURE__ */ _lte(value, params));
				},
				int(params) {
					return this.check(int(params));
				},
				safe(params) {
					return this.check(int(params));
				},
				positive(params) {
					return this.check(/* @__PURE__ */ _gt(0, params));
				},
				nonnegative(params) {
					return this.check(/* @__PURE__ */ _gte(0, params));
				},
				negative(params) {
					return this.check(/* @__PURE__ */ _lt(0, params));
				},
				nonpositive(params) {
					return this.check(/* @__PURE__ */ _lte(0, params));
				},
				multipleOf(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				step(value, params) {
					return this.check(/* @__PURE__ */ _multipleOf(value, params));
				},
				finite() {
					return this;
				}
			});
			const bag = inst._zod.bag;
			inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
			inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
			inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
			inst.isFinite = true;
			inst.format = bag.format ?? null;
		});
		function number(params) {
			return /* @__PURE__ */ _number(ZodNumber, params);
		}
		const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
			$ZodNumberFormat.init(inst, def);
			ZodNumber.init(inst, def);
		});
		function int(params) {
			return /* @__PURE__ */ _int(ZodNumberFormat, params);
		}
		const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
			$ZodBoolean.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
		});
		function boolean(params) {
			return /* @__PURE__ */ _boolean(ZodBoolean, params);
		}
		const ZodNull = /*@__PURE__*/ $constructor("ZodNull", (inst, def) => {
			$ZodNull.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullProcessor(inst, ctx, json, params);
		});
		function _null(params) {
			return /* @__PURE__ */ _null$1(ZodNull, params);
		}
		const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
			$ZodUnknown.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => void 0;
		});
		function unknown() {
			return /* @__PURE__ */ _unknown(ZodUnknown);
		}
		const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
			$ZodNever.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
		});
		function never(params) {
			return /* @__PURE__ */ _never(ZodNever, params);
		}
		const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
			$ZodArray.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
			inst.element = def.element;
			_installLazyMethods(inst, "ZodArray", {
				min(n, params) {
					return this.check(/* @__PURE__ */ _minLength(n, params));
				},
				nonempty(params) {
					return this.check(/* @__PURE__ */ _minLength(1, params));
				},
				max(n, params) {
					return this.check(/* @__PURE__ */ _maxLength(n, params));
				},
				length(n, params) {
					return this.check(/* @__PURE__ */ _length(n, params));
				},
				unwrap() {
					return this.element;
				}
			});
		});
		function array(element, params) {
			return /* @__PURE__ */ _array(ZodArray, element, params);
		}
		const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
			$ZodObjectJIT.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
			defineLazy(inst, "shape", () => {
				return def.shape;
			});
			_installLazyMethods(inst, "ZodObject", {
				keyof() {
					return _enum(Object.keys(this._zod.def.shape));
				},
				catchall(catchall) {
					return this.clone({
						...this._zod.def,
						catchall
					});
				},
				passthrough() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				loose() {
					return this.clone({
						...this._zod.def,
						catchall: unknown()
					});
				},
				strict() {
					return this.clone({
						...this._zod.def,
						catchall: never()
					});
				},
				strip() {
					return this.clone({
						...this._zod.def,
						catchall: void 0
					});
				},
				extend(incoming) {
					return extend(this, incoming);
				},
				safeExtend(incoming) {
					return safeExtend(this, incoming);
				},
				merge(other) {
					return merge(this, other);
				},
				pick(mask) {
					return pick(this, mask);
				},
				omit(mask) {
					return omit(this, mask);
				},
				partial(...args) {
					return partial(ZodOptional, this, args[0]);
				},
				required(...args) {
					return required(ZodNonOptional, this, args[0]);
				}
			});
		});
		function object(shape, params) {
			const def = {
				type: "object",
				shape: shape ?? {},
				...normalizeParams(params)
			};
			return new ZodObject(def);
		}
		const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
			$ZodUnion.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
			inst.options = def.options;
		});
		function union(options, params) {
			return new ZodUnion({
				type: "union",
				options,
				...normalizeParams(params)
			});
		}
		const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
			$ZodIntersection.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
		});
		function intersection(left, right) {
			return new ZodIntersection({
				type: "intersection",
				left,
				right
			});
		}
		const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
			$ZodEnum.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
			inst.enum = def.entries;
			inst.options = Object.values(def.entries);
			const keys = new Set(Object.keys(def.entries));
			inst.extract = (values, params) => {
				const newEntries = {};
				for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
			inst.exclude = (values, params) => {
				const newEntries = { ...def.entries };
				for (const value of values) if (keys.has(value)) delete newEntries[value];
				else throw new Error(`Key ${value} not found in enum`);
				return new ZodEnum({
					...def,
					checks: [],
					...normalizeParams(params),
					entries: newEntries
				});
			};
		});
		function _enum(values, params) {
			const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
			return new ZodEnum({
				type: "enum",
				entries,
				...normalizeParams(params)
			});
		}
		const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
			$ZodLiteral.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
			inst.values = new Set(def.values);
			Object.defineProperty(inst, "value", { get() {
				if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
				return def.values[0];
			} });
		});
		function literal(value, params) {
			return new ZodLiteral({
				type: "literal",
				values: Array.isArray(value) ? value : [value],
				...normalizeParams(params)
			});
		}
		const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
			$ZodTransform.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
			inst._zod.parse = (payload, _ctx) => {
				if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
				payload.addIssue = (issue$1) => {
					if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
					else {
						const _issue = issue$1;
						if (_issue.fatal) _issue.continue = false;
						_issue.code ?? (_issue.code = "custom");
						_issue.input ?? (_issue.input = payload.value);
						_issue.inst ?? (_issue.inst = inst);
						payload.issues.push(issue(_issue));
					}
				};
				const output = def.transform(payload.value, payload);
				if (output instanceof Promise) return output.then((output) => {
					payload.value = output;
					payload.fallback = true;
					return payload;
				});
				payload.value = output;
				payload.fallback = true;
				return payload;
			};
		});
		function transform(fn) {
			return new ZodTransform({
				type: "transform",
				transform: fn
			});
		}
		const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
			$ZodOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function optional(innerType) {
			return new ZodOptional({
				type: "optional",
				innerType
			});
		}
		const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
			$ZodExactOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function exactOptional(innerType) {
			return new ZodExactOptional({
				type: "optional",
				innerType
			});
		}
		const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
			$ZodNullable.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nullable(innerType) {
			return new ZodNullable({
				type: "nullable",
				innerType
			});
		}
		const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
			$ZodDefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeDefault = inst.unwrap;
		});
		function _default(innerType, defaultValue) {
			return new ZodDefault({
				type: "default",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
			$ZodPrefault.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function prefault(innerType, defaultValue) {
			return new ZodPrefault({
				type: "prefault",
				innerType,
				get defaultValue() {
					return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
				}
			});
		}
		const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
			$ZodNonOptional.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function nonoptional(innerType, params) {
			return new ZodNonOptional({
				type: "nonoptional",
				innerType,
				...normalizeParams(params)
			});
		}
		const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
			$ZodCatch.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
			inst.removeCatch = inst.unwrap;
		});
		function _catch(innerType, catchValue) {
			return new ZodCatch({
				type: "catch",
				innerType,
				catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
			});
		}
		const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
			$ZodPipe.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
			inst.in = def.in;
			inst.out = def.out;
		});
		function pipe(in_, out) {
			return new ZodPipe({
				type: "pipe",
				in: in_,
				out
			});
		}
		const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
			$ZodReadonly.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
			inst.unwrap = () => inst._zod.def.innerType;
		});
		function readonly(innerType) {
			return new ZodReadonly({
				type: "readonly",
				innerType
			});
		}
		const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
			$ZodCustom.init(inst, def);
			ZodType.init(inst, def);
			inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
		});
		function refine(fn, _params = {}) {
			return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
		}
		function superRefine(fn, params) {
			return /* @__PURE__ */ _superRefine(fn, params);
		}
		// src/protocol.ts
		/** HTTP console namespace; these named routes have their own security boundary. */
		const NEXUS_API_PREFIX = "/api/dsh-nexus";
		/** A distinct keyed route prevents WHATWG dot-segment normalization. The literal
		* `~` prefix is framing, never part of the ID; the remainder is decoded ONCE.
		* Legacy /sessions/:id/prompt paths retain their original interpretation. */
		function consolePromptPath(sessionId) {
			return `${NEXUS_API_PREFIX}/session-keys/~${encodeURIComponent(sessionId)}/prompt`;
		}
		/** Every accepted display mode, in display order; the stored field accepts only these. */
		const TOOL_DISPLAY_MODES = [
			"nexus",
			"auto",
			"native"
		];
		/** Every accepted child-access ceiling, in display order. */
		const CHILD_ACCESS_SETTINGS = [
			"inherit",
			"workspace-write",
			"read-only"
		];
		// src/client/api.ts
		/** Browser-only transport. Relative URLs, memory-only authorization, no mutation retries. */
		const strings = array(string());
		const moduleSchema = object({
			id: string(),
			name: string(),
			body: string()
		});
		const library = object({
			modules: array(moduleSchema),
			defaultSelection: strings
		}).refine((v) => {
			const ids = new Set(v.modules.map((m) => m.id));
			return ids.size === v.modules.length && new Set(v.defaultSelection).size === v.defaultSelection.length && v.defaultSelection.every((id) => ids.has(id));
		});
		const settings = object({
			files: object({
				defaultLines: number().int(),
				maxOutputBytes: number().int()
			}),
			terminal: object({
				engine: _enum(["bash", "pwsh"]),
				bashPath: string().optional(),
				pwshPath: string().optional()
			}),
			agents: object({
				concurrency: number().int(),
				maxDepth: number().int(),
				childAccess: _enum(CHILD_ACCESS_SETTINGS).catch("read-only").default("inherit"),
				role: object({
					name: string().optional(),
					instructions: string().optional(),
					model: string().optional(),
					provider: string().trim().transform((value) => value === "" ? void 0 : value).optional()
				}).optional()
			}),
			web: object({
				maxResults: number().int(),
				maxCharsPerPage: number().int()
			}),
			toolDisplay: _enum(TOOL_DISPLAY_MODES).catch("nexus")
		});
		const backend = object({
			service: _enum([
				"present",
				"absent",
				"unknown"
			]),
			backends: union([object({
				state: _enum(["registered", "absent"]),
				names: strings
			}), object({
				state: literal("unknown"),
				names: _null()
			})]),
			readiness: literal("unverified")
		});
		const capabilities = object({
			verification: literal("unverified"),
			registered: object({
				consoleApi: literal(true),
				nexusRuntime: literal(true)
			}),
			backendRegistrations: object({
				scope: literal("effective-http-context"),
				terminal: backend,
				web: backend,
				internalAgent: backend
			}),
			providers: strings.default([]),
			diagnostics: strings,
			settingsLocation: object({
				namespace: literal("dsh-nexus"),
				domain: literal("dsh_nexus")
			}),
			basePrompt: string()
		});
		const preview = object({
			selection: strings,
			modules: array(moduleSchema),
			text: string()
		});
		/** Shape checks only; host validation remains the authority on limits and saves. */
		const consoleData = {
			library: object({
				value: library,
				hash: string().min(1)
			}),
			settings: object({
				value: settings,
				hash: string().min(1)
			}),
			childModels: object({ models: strings }),
			capabilities,
			sessions: array(object({
				id: string(),
				title: string()
			})),
			preview,
			prompt: preview.extend({ sessionId: string() })
		};
		var NexusApiError = class extends Error {
			status;
			code;
			constructor(status, code) {
				super(code);
				this.status = status;
				this.code = code;
				this.name = "NexusApiError";
			}
		};
		function createNexusApi(fetcher = globalThis.fetch) {
			let csrfToken;
			let authorizing;
			async function request(path, method = "GET", body) {
				if (method !== "GET" && csrfToken === void 0) await authorize();
				const response = await fetcher(path, {
					method,
					credentials: "same-origin",
					mode: "same-origin",
					redirect: "error",
					cache: "no-store",
					headers: method === "GET" ? { Accept: "application/json" } : {
						Accept: "application/json",
						"Content-Type": "application/json",
						"X-Nexus-CSRF": csrfToken
					},
					...body === void 0 ? {} : { body: JSON.stringify(body) }
				});
				if (response.redirected) throw new NexusApiError(502, "INVALID_RESPONSE");
				let data;
				try {
					data = await response.json();
				} catch {
					throw new NexusApiError(response.status, "INVALID_RESPONSE");
				}
				if (!response.ok) {
					const failure = object({ error: object({ code: string() }) }).safeParse(data);
					if (response.status === 403) csrfToken = void 0;
					throw new NexusApiError(response.status, failure.success ? failure.data.error.code : "HTTP_ERROR");
				}
				return data;
			}
			function authorize() {
				if (authorizing !== void 0) return authorizing;
				authorizing = (async () => {
					const value = await request(`${NEXUS_API_PREFIX}/capabilities`);
					const token = object({ csrfToken: string().min(1) }).parse(value).csrfToken;
					const facts = capabilities.parse(value);
					csrfToken = token;
					return facts;
				})().finally(() => {
					authorizing = void 0;
				});
				return authorizing;
			}
			return {
				capabilities: authorize,
				async childModels(provider) {
					return consoleData.childModels.parse(await request(`${NEXUS_API_PREFIX}/capabilities?provider=${encodeURIComponent(provider)}`));
				},
				async library() {
					return consoleData.library.parse(await request(`${NEXUS_API_PREFIX}/library`));
				},
				async settings() {
					return consoleData.settings.parse(await request(`${NEXUS_API_PREFIX}/settings`));
				},
				async sessions() {
					return consoleData.sessions.parse(await request(`${NEXUS_API_PREFIX}/sessions`));
				},
				async saveLibrary(value, expectedHash) {
					return consoleData.library.parse(await request(`${NEXUS_API_PREFIX}/library`, "PUT", {
						value,
						expectedHash
					}));
				},
				async saveSettings(value, expectedHash) {
					return consoleData.settings.parse(await request(`${NEXUS_API_PREFIX}/settings`, "PUT", {
						value,
						expectedHash
					}));
				},
				async preview(library, selection) {
					return preview.parse(await request(`${NEXUS_API_PREFIX}/prompts/preview`, "POST", {
						library,
						selection
					}));
				},
				async prompt(id) {
					return consoleData.prompt.parse(await request(consolePromptPath(id)));
				},
				async apply(id, selection, expectedLibraryHash) {
					return consoleData.prompt.parse(await request(consolePromptPath(id), "POST", {
						selection,
						expectedLibraryHash
					}));
				}
			};
		}
		// src/client/store.ts
		/** One lifecycle-owned console state. Draft revisions and target epochs are independent. */
		function freeze(value) {
			if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
				for (const child of Object.values(value)) freeze(child);
				Object.freeze(value);
			}
			return value;
		}
		const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
		const EMPTY_CONSOLE_SNAPSHOT = freeze({
			sessions: [],
			libraryDirty: false,
			settingsDirty: false,
			settingsSettled: false,
			selection: [],
			canApply: false,
			notice: "idle",
			busy: {
				refresh: false,
				library: false,
				settings: false,
				preview: false,
				apply: false
			}
		});
		function createConsoleStore(api) {
			let state = EMPTY_CONSOLE_SNAPSHOT;
			let disposed = false;
			let libraryRevision = 0, settingsRevision = 0, selectionRevision = 0;
			let childModelsRequest = 0;
			let libraryRequest = 0, settingsRequest = 0, refreshRequest = 0, previewRequest = 0, targetEpoch = 0;
			const listeners = /* @__PURE__ */ new Set();
			function publish(patch) {
				if (disposed) return;
				const next = {
					...state,
					...patch
				};
				next.libraryDirty = !same(next.libraryDraft, next.librarySaved?.value);
				next.settingsDirty = !same(next.settingsDraft, next.settingsSaved?.value);
				next.canApply = next.targetId !== void 0 && next.sessions.some((s) => s.id === next.targetId) && next.librarySaved !== void 0 && !next.busy.apply && next.selection.every((id) => {
					const saved = next.librarySaved?.value.modules.find((m) => m.id === id);
					return saved !== void 0 && same(saved, next.libraryDraft?.modules.find((m) => m.id === id));
				});
				state = freeze(next);
				for (const listener of listeners) try {
					listener();
				} catch {}
			}
			const busy = (key, value) => publish({ busy: {
				...state.busy,
				[key]: value
			} });
			const failed = (error, patch = {}) => publish({
				...patch,
				notice: error instanceof NexusApiError && error.status === 409 ? "conflict" : "error"
			});
			function acceptLibrary(value, revision, discard) {
				const saved = consoleData.library.parse(value);
				if (!(libraryRevision === revision && (discard || !state.libraryDirty))) {
					publish({ librarySaved: saved });
					return;
				}
				const selection = selectionRevision === 0 ? [...saved.value.defaultSelection] : state.selection.filter((id) => saved.value.modules.some((m) => m.id === id));
				const changed = !same(state.libraryDraft, saved.value) || !same(state.selection, selection);
				if (changed) previewRequest++;
				publish({
					librarySaved: saved,
					libraryDraft: saved.value,
					selection,
					...changed ? {
						preview: void 0,
						busy: {
							...state.busy,
							preview: false
						}
					} : {},
					...discard ? { notice: "idle" } : {}
				});
			}
			function acceptSettings(value, revision, discard) {
				const saved = consoleData.settings.parse(value);
				publish({
					settingsSaved: saved,
					settingsSettled: true,
					...settingsRevision === revision && (discard || !state.settingsDirty) ? {
						settingsDraft: saved.value,
						...discard ? { notice: "idle" } : {}
					} : {}
				});
			}
			async function readLibrary(discard) {
				if (disposed || state.busy.library) return;
				const request = ++libraryRequest, revision = libraryRevision;
				try {
					const value = await api.library();
					if (request === libraryRequest) acceptLibrary(value, revision, discard);
				} catch (e) {
					if (request === libraryRequest) failed(e);
				}
			}
			async function readSettings(discard) {
				if (disposed || state.busy.settings) return;
				const request = ++settingsRequest, revision = settingsRevision;
				try {
					const value = await api.settings();
					if (request === settingsRequest) acceptSettings(value, revision, discard);
				} catch (e) {
					if (request === settingsRequest) failed(e, { settingsSettled: true });
				}
			}
			const store = {
				getSnapshot: () => state,
				subscribe(listener) {
					if (disposed) return () => {};
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				async refresh() {
					if (disposed || state.busy.library || state.busy.settings) return;
					const request = ++refreshRequest;
					busy("refresh", true);
					try {
						try {
							const [caps, sessions] = await Promise.all([api.capabilities(), api.sessions()]);
							if (disposed || request !== refreshRequest) return;
							const facts = consoleData.capabilities.parse(caps), roster = consoleData.sessions.parse(sessions);
							publish({
								capabilities: facts,
								sessions: roster
							});
							if (state.targetId !== void 0 && !roster.some((s) => s.id === state.targetId)) await store.selectTarget(void 0);
						} catch (e) {
							if (request === refreshRequest) failed(e);
						}
						await Promise.all([readLibrary(false), readSettings(false)]);
					} finally {
						if (request === refreshRequest) busy("refresh", false);
					}
				},
				async suggestChildModels(provider) {
					const route = provider.trim(), request = ++childModelsRequest;
					if (disposed) return;
					publish({ childModels: {
						provider: route,
						models: []
					} });
					if (route === "") return;
					try {
						const { models } = await api.childModels(route);
						if (request === childModelsRequest) publish({ childModels: {
							provider: route,
							models
						} });
					} catch {}
				},
				reloadLibrary: () => readLibrary(true),
				reloadSettings: () => readSettings(true),
				editLibrary(value) {
					if (disposed) return;
					try {
						const draft = consoleData.library.parse({
							value,
							hash: "draft"
						}).value;
						libraryRevision++;
						previewRequest++;
						publish({
							libraryDraft: draft,
							preview: void 0,
							notice: "idle",
							selection: state.selection.filter((id) => draft.modules.some((m) => m.id === id)),
							busy: {
								...state.busy,
								preview: false
							}
						});
					} catch (e) {
						failed(e);
					}
				},
				editSettings(value) {
					if (disposed) return;
					try {
						const draft = consoleData.settings.parse({
							value,
							hash: "draft"
						}).value;
						settingsRevision++;
						publish({
							settingsDraft: draft,
							notice: "idle"
						});
					} catch (e) {
						failed(e);
					}
				},
				setSelection(selection) {
					if (disposed || new Set(selection).size !== selection.length || !selection.every((id) => state.libraryDraft?.modules.some((m) => m.id === id))) return;
					selectionRevision++;
					previewRequest++;
					publish({
						selection: [...selection],
						preview: void 0,
						notice: "idle",
						busy: {
							...state.busy,
							preview: false
						}
					});
				},
				useSelectionAsDefault() {
					if (state.libraryDraft !== void 0) store.editLibrary({
						...state.libraryDraft,
						defaultSelection: [...state.selection]
					});
				},
				async saveLibrary() {
					if (disposed || state.busy.library || state.libraryDraft === void 0 || state.librarySaved === void 0) return;
					const draft = state.libraryDraft, hash = state.librarySaved.hash, revision = libraryRevision, request = ++libraryRequest;
					busy("library", true);
					try {
						const saved = consoleData.library.parse(await api.saveLibrary(draft, hash));
						if (!same(saved.value, draft)) throw new Error("Invalid save response");
						if (request !== libraryRequest || disposed) return;
						publish({
							librarySaved: saved,
							...revision === libraryRevision ? { libraryDraft: saved.value } : {},
							notice: "saved"
						});
					} catch (e) {
						if (request === libraryRequest) failed(e);
					} finally {
						if (request === libraryRequest) busy("library", false);
					}
				},
				async saveSettings() {
					if (disposed || state.busy.settings || state.settingsDraft === void 0 || state.settingsSaved === void 0) return;
					const draft = state.settingsDraft, hash = state.settingsSaved.hash, revision = settingsRevision, request = ++settingsRequest;
					busy("settings", true);
					try {
						const saved = consoleData.settings.parse(await api.saveSettings(draft, hash));
						if (!same(saved.value, draft)) throw new Error("Invalid save response");
						if (request !== settingsRequest || disposed) return;
						publish({
							settingsSaved: saved,
							...revision === settingsRevision ? { settingsDraft: saved.value } : {},
							notice: "saved"
						});
					} catch (e) {
						if (request === settingsRequest) failed(e);
					} finally {
						if (request === settingsRequest) busy("settings", false);
					}
				},
				async preview() {
					if (disposed || state.libraryDraft === void 0) return;
					const request = ++previewRequest, draft = state.libraryDraft, selection = [...state.selection];
					busy("preview", true);
					try {
						const value = consoleData.preview.parse(await api.preview(draft, selection));
						if (request === previewRequest) publish({
							preview: value,
							notice: "previewed"
						});
					} catch (e) {
						if (request === previewRequest) failed(e);
					} finally {
						if (request === previewRequest) busy("preview", false);
					}
				},
				async selectTarget(id) {
					if (disposed) return;
					const epoch = ++targetEpoch;
					const target = state.sessions.some((s) => s.id === id) ? id : void 0;
					publish({
						targetId: target,
						applied: void 0,
						notice: "idle",
						busy: {
							...state.busy,
							apply: false
						}
					});
					if (target === void 0) return;
					try {
						const value = consoleData.prompt.parse(await api.prompt(target));
						if (value.sessionId !== target) throw new Error("Invalid target response");
						if (epoch === targetEpoch) publish({ applied: value });
					} catch (e) {
						if (epoch === targetEpoch) failed(e);
					}
				},
				async applySelection() {
					if (disposed || !state.canApply || state.targetId === void 0 || state.librarySaved === void 0) return;
					const epoch = ++targetEpoch, id = state.targetId, selection = [...state.selection], hash = state.librarySaved.hash;
					busy("apply", true);
					try {
						const value = consoleData.prompt.parse(await api.apply(id, selection, hash));
						if (value.sessionId !== id) throw new Error("Invalid target response");
						if (epoch === targetEpoch) publish({
							applied: value,
							notice: "applied"
						});
					} catch (e) {
						if (epoch === targetEpoch) failed(e);
					} finally {
						if (epoch === targetEpoch) busy("apply", false);
					}
				},
				dispose() {
					disposed = true;
					targetEpoch++;
					previewRequest++;
					listeners.clear();
				}
			};
			return store;
		}
		const snapshotShape = object({
			childModels: object({
				provider: string(),
				models: array(string())
			}).optional(),
			capabilities: consoleData.capabilities.optional(),
			sessions: consoleData.sessions,
			librarySaved: consoleData.library.optional(),
			libraryDraft: consoleData.library.shape.value.optional(),
			settingsSaved: consoleData.settings.optional(),
			settingsDraft: consoleData.settings.shape.value.optional(),
			libraryDirty: boolean(),
			settingsDirty: boolean(),
			settingsSettled: boolean(),
			selection: array(string()),
			targetId: string().optional(),
			applied: consoleData.prompt.optional(),
			preview: consoleData.preview.optional(),
			canApply: boolean(),
			notice: _enum([
				"idle",
				"saved",
				"previewed",
				"applied",
				"error",
				"conflict"
			]),
			busy: object({
				refresh: boolean(),
				library: boolean(),
				settings: boolean(),
				preview: boolean(),
				apply: boolean()
			})
		});
		/** Foreign sources may throw or return a fresh object on every read. Normalize
		* once per changed JSON value so useSyncExternalStore always gets stable identity. */
		function protectConsoleSource(source) {
			let accepted = EMPTY_CONSOLE_SNAPSHOT, serialized = JSON.stringify(accepted);
			return {
				getSnapshot: () => {
					try {
						const value = snapshotShape.parse(source.getSnapshot());
						const next = JSON.stringify(value);
						if (next !== serialized) {
							accepted = freeze(value);
							serialized = next;
						}
					} catch {}
					return accepted;
				},
				subscribe(listener) {
					let off;
					try {
						const candidate = source.subscribe(listener);
						if (typeof candidate === "function") off = candidate;
					} catch {}
					return () => {
						try {
							off?.();
						} catch {}
					};
				}
			};
		}
		/** Largest accepted read line count. */
		const FILE_READ_MAX_LINES = 2e3;
		/** Byte cap of one read result when the settings name no other value. */
		const FILE_OUTPUT_DEFAULT_BYTES = 32768;
		/** Largest accepted read output cap. */
		const FILE_OUTPUT_MAX_BYTES = 32768;
		/** Characters per saved page when the settings name no other value. */
		const WEB_DEFAULT_CHARS_PER_PAGE = 12e3;
		/** Largest accepted characters per saved page. */
		const WEB_MAX_CHARS_PER_PAGE = 24e3;
		Object.freeze({
			files: Object.freeze({
				defaultLines: 200,
				maxOutputBytes: FILE_OUTPUT_DEFAULT_BYTES
			}),
			terminal: Object.freeze({ engine: "bash" }),
			agents: Object.freeze({
				concurrency: 4,
				maxDepth: 2,
				childAccess: "inherit"
			}),
			web: Object.freeze({
				maxResults: 5,
				maxCharsPerPage: WEB_DEFAULT_CHARS_PER_PAGE
			}),
			toolDisplay: "nexus"
		});
		Object.freeze({
			modules: Object.freeze([]),
			defaultSelection: Object.freeze([])
		});
		// src/client/pages/prompts.tsx
		let fallbackModuleIds = 0;
		/** Session-unique module id; the timestamp-plus-counter fallback survives a non-secure origin without randomUUID. */
		function newModuleId() {
			return globalThis.crypto?.randomUUID?.() ?? `m${Date.now().toString(36)}-${fallbackModuleIds++}`;
		}
		function PromptsPage({ store, state, t }) {
			const library = state.libraryDraft;
			if (library === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("unavailable") });
			const update = (id, patch) => store.editLibrary({
				...library,
				modules: library.modules.map((m) => m.id === id ? {
					...m,
					...patch
				} : m)
			});
			const atModuleCap = library.modules.length >= 32;
			const addModule = () => {
				if (atModuleCap) return;
				store.editLibrary({
					...library,
					modules: [...library.modules, {
						id: newModuleId(),
						name: "",
						body: ""
					}]
				});
			};
			function move(index, offset) {
				const selection = [...state.selection];
				const destination = index + offset;
				if (destination < 0 || destination >= selection.length) return;
				[selection[index], selection[destination]] = [selection[destination], selection[index]];
				store.setSelection(selection);
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("prompts") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("base") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					"data-base": true,
					children: state.capabilities?.basePrompt
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("modules") }),
				library.modules.map((module) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: module.name || t("untitledModule") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("moduleName"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						"data-module-name": true,
						value: module.name,
						onChange: (e) => update(module.id, { name: e.currentTarget.value })
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("moduleBody"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						"data-module-body": true,
						value: module.body,
						onChange: (e) => update(module.id, { body: e.currentTarget.value })
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dsh-nexus-check",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							"data-module-select": true,
							type: "checkbox",
							checked: state.selection.includes(module.id),
							onChange: (e) => store.setSelection(e.currentTarget.checked ? [...state.selection, module.id] : state.selection.filter((id) => id !== module.id))
						}), t("includeModule")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => store.editLibrary({
							modules: library.modules.filter((m) => m.id !== module.id),
							defaultSelection: library.defaultSelection.filter((id) => id !== module.id)
						}),
						children: t("deleteModule")
					})
				] }, module.id)),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					disabled: atModuleCap,
					onClick: addModule,
					children: t("addModule")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("selection") }),
				state.selection.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("emptySelection") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", { children: state.selection.map((id, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: library.modules.find((m) => m.id === id)?.name || t("untitledModule") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: index === 0,
						onClick: () => move(index, -1),
						children: t("moveUp")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: index === state.selection.length - 1,
						onClick: () => move(index, 1),
						children: t("moveDown")
					})
				] }, id)) }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("defaultHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => store.useSelectionAsDefault(),
					children: t("useDefault")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("savedDefault") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", { children: state.librarySaved?.value.defaultSelection.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: state.librarySaved?.value.modules.find((m) => m.id === id)?.name || t("untitledModule") }, id)) }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(state.libraryDirty ? "libraryDirty" : "libraryClean") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-nexus-actions",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: state.busy.library,
							onClick: () => void store.saveLibrary(),
							children: t("saveLibrary")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: state.busy.library,
							onClick: () => void store.reloadLibrary(),
							children: t("reloadLibrary")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: state.busy.preview,
							onClick: () => void store.preview(),
							children: t("preview")
						})
					]
				}),
				state.preview !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("previewTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					"data-preview": true,
					children: state.preview.text
				})] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("target"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
					value: state.targetId === void 0 ? "" : `id:${state.targetId}`,
					onChange: (e) => void store.selectTarget(e.currentTarget.value === "" ? void 0 : e.currentTarget.value.slice(3)),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: "",
						children: t("noTarget")
					}), state.sessions.map((session) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: `id:${session.id}`,
						children: session.title ? `${session.title} (${session.id})` : session.id
					}, session.id))]
				})] }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("applyHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					disabled: !state.canApply,
					onClick: () => void store.applySelection(),
					children: t("apply")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("appliedTitle") }),
				state.applied === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("noApplied") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					"data-applied": true,
					children: state.applied.text
				})
			] });
		}
		// src/client/pages/tools.tsx
		/** Dictionary label and one-line explanation of each display mode. */
		const MODE_LABEL = {
			nexus: "toolDisplayNexus",
			auto: "toolDisplayAuto",
			native: "toolDisplayNative"
		};
		const MODE_HELP = {
			nexus: "toolDisplayNexusHelp",
			auto: "toolDisplayAutoHelp",
			native: "toolDisplayNativeHelp"
		};
		function ToolsPage(props) {
			const { store, state, t } = props, draft = state.settingsDraft;
			if (draft === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("unavailable") });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("tools") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-nexus-fields",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("toolDisplay"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							value: draft.toolDisplay,
							onChange: (event) => {
								const mode = TOOL_DISPLAY_MODES.find((candidate) => candidate === event.currentTarget.value);
								if (mode !== void 0) store.editSettings({
									...draft,
									toolDisplay: mode
								});
							},
							children: TOOL_DISPLAY_MODES.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: mode,
								children: t(MODE_LABEL[mode])
							}, mode))
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("defaultLines"),
							value: draft.files.defaultLines,
							min: 1,
							max: FILE_READ_MAX_LINES,
							onChange: (defaultLines) => store.editSettings({
								...draft,
								files: {
									...draft.files,
									defaultLines
								}
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("maxOutputBytes"),
							value: draft.files.maxOutputBytes,
							min: 1,
							max: FILE_OUTPUT_MAX_BYTES,
							onChange: (maxOutputBytes) => store.editSettings({
								...draft,
								files: {
									...draft.files,
									maxOutputBytes
								}
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("maxResults"),
							value: draft.web.maxResults,
							min: 1,
							max: 10,
							onChange: (maxResults) => store.editSettings({
								...draft,
								web: {
									...draft.web,
									maxResults
								}
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("maxCharsPerPage"),
							value: draft.web.maxCharsPerPage,
							min: 1,
							max: WEB_MAX_CHARS_PER_PAGE,
							onChange: (maxCharsPerPage) => store.editSettings({
								...draft,
								web: {
									...draft.web,
									maxCharsPerPage
								}
							})
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("toolDisplayHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(MODE_HELP[draft.toolDisplay]) }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("pageBudgetHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsActions, { ...props })
			] });
		}
		// src/client/pages/integrations.tsx
		function RegistrationFacts({ title, fact, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-nexus-fact",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: title }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(fact?.service ?? "unknown") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: fact?.backends.state === "registered" ? t("registered") : t(fact?.backends.state ?? "unknown") }),
					fact?.backends.names !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: fact?.backends.names.map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: name }, name)) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("unverified") })
				]
			});
		}
		function IntegrationsPage({ state, t }) {
			const facts = state.capabilities?.backendRegistrations;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("integrations") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("registrationHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegistrationFacts, {
					title: t("terminalRegistration"),
					fact: facts?.terminal,
					t
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegistrationFacts, {
					title: t("webRegistration"),
					fact: facts?.web,
					t
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegistrationFacts, {
					title: t("agentRegistration"),
					fact: facts?.internalAgent,
					t
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("diagnostics") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: state.capabilities?.diagnostics.map((message, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: message }, index)) }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("nativeSettingsHelp") })
			] });
		}
		// src/client/pages/terminal.tsx
		function TerminalPage(props) {
			const { store, state, t } = props, draft = state.settingsDraft;
			if (draft === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("unavailable") });
			function path(key, value) {
				if (draft === void 0) return;
				const terminal = { ...draft.terminal };
				if (value === "") delete terminal[key];
				else terminal[key] = value;
				store.editSettings({
					...draft,
					terminal
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("terminal") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-nexus-fields",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("engine"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							value: draft.terminal.engine,
							onChange: (e) => store.editSettings({
								...draft,
								terminal: {
									...draft.terminal,
									engine: e.currentTarget.value === "pwsh" ? "pwsh" : "bash"
								}
							}),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "bash",
								children: t("bash")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "pwsh",
								children: t("pwsh")
							})]
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("bashPath"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: draft.terminal.bashPath ?? "",
							onChange: (e) => path("bashPath", e.currentTarget.value)
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("pwshPath"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: draft.terminal.pwshPath ?? "",
							onChange: (e) => path("pwshPath", e.currentTarget.value)
						})] })
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("terminalHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("timeoutHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RegistrationFacts, {
					title: t("terminalRegistration"),
					fact: state.capabilities?.backendRegistrations.terminal,
					t
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("registrationHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsActions, { ...props })
			] });
		}
		// src/client/pages/agents.tsx
		/** Label key of each ceiling option. */
		const ACCESS_LABEL = {
			inherit: "childAccessInherit",
			"workspace-write": "childAccessWorkspaceWrite",
			"read-only": "childAccessReadOnly"
		};
		/** One explanation line per ceiling option, in the same order as the options. */
		const ACCESS_HELP = {
			inherit: "childAccessInheritHelp",
			"workspace-write": "childAccessWorkspaceWriteHelp",
			"read-only": "childAccessReadOnlyHelp"
		};
		function AgentsPage(props) {
			const { store, state, t } = props, draft = state.settingsDraft;
			const providerList = (0, react.useId)(), modelList = (0, react.useId)();
			if (draft === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("unavailable") });
			function role(key, value) {
				if (draft === void 0) return;
				const next = { ...draft.agents.role };
				if (value === "") delete next[key];
				else next[key] = value;
				const agents = { ...draft.agents };
				if (Object.keys(next).length === 0) delete agents.role;
				else agents.role = next;
				store.editSettings({
					...draft,
					agents
				});
			}
			function childAccess(value) {
				if (draft === void 0) return;
				const mode = CHILD_ACCESS_SETTINGS.find((candidate) => candidate === value);
				if (mode !== void 0) store.editSettings({
					...draft,
					agents: {
						...draft.agents,
						childAccess: mode
					}
				});
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("agents") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("agentHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-nexus-fields",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("concurrency"),
							value: draft.agents.concurrency,
							min: 1,
							max: 16,
							onChange: (concurrency) => store.editSettings({
								...draft,
								agents: {
									...draft.agents,
									concurrency
								}
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NumberField, {
							label: t("maxDepth"),
							value: draft.agents.maxDepth,
							min: 0,
							max: 8,
							onChange: (maxDepth) => store.editSettings({
								...draft,
								agents: {
									...draft.agents,
									maxDepth
								}
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("childAccess"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							value: draft.agents.childAccess,
							onChange: (e) => childAccess(e.currentTarget.value),
							children: CHILD_ACCESS_SETTINGS.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: mode,
								children: t(ACCESS_LABEL[mode])
							}, mode))
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("roleName"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: draft.agents.role?.name ?? "",
							onChange: (e) => role("name", e.currentTarget.value)
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("roleInstructions"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							value: draft.agents.role?.instructions ?? "",
							onChange: (e) => role("instructions", e.currentTarget.value)
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("roleProvider"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							list: providerList,
							value: draft.agents.role?.provider ?? "",
							onChange: (e) => role("provider", e.currentTarget.value),
							onBlur: (e) => void store.suggestChildModels(e.currentTarget.value)
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
							id: providerList,
							children: state.capabilities?.providers.map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", { value: provider }, provider))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("roleModel"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							list: modelList,
							value: draft.agents.role?.model ?? "",
							onChange: (e) => role("model", e.currentTarget.value),
							onFocus: () => void store.suggestChildModels(draft.agents.role?.provider ?? "")
						})] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("datalist", {
							id: modelList,
							children: state.childModels !== void 0 && state.childModels.provider === draft.agents.role?.provider?.trim() && state.childModels.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: model,
								children: [
									state.childModels?.provider,
									" / ",
									model
								]
							}, model))
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "dsh-nexus-access-lines",
					children: CHILD_ACCESS_SETTINGS.map((mode) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: t(ACCESS_HELP[mode]) }, mode))
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dsh-nexus-error",
					children: t("childAccessWarning")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("roleProviderHelp") }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsActions, { ...props })
			] });
		}
		// src/client/console.tsx
		const pages = {
			prompts: PromptsPage,
			tools: ToolsPage,
			terminal: TerminalPage,
			agents: AgentsPage,
			integrations: IntegrationsPage
		};
		function NexusConsole({ store, t, surface = "main" }) {
			const source = (0, react.useMemo)(() => protectConsoleSource(store), [store]);
			const state = (0, react.useSyncExternalStore)(source.subscribe, source.getSnapshot, () => EMPTY_CONSOLE_SNAPSHOT);
			const [page, setPage] = (0, react.useState)("prompts");
			const Page = pages[page];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-nexus-console",
				"data-dsh-nexus-surface": surface,
				"aria-label": t("panel"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-nexus-heading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: t("panel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: state.busy.refresh || state.busy.library || state.busy.settings,
							onClick: () => void store.refresh(),
							children: t("refresh")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("consoleHelp") })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
						"aria-label": t("panel"),
						children: Object.keys(pages).map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							"aria-pressed": page === key,
							onClick: () => setPage(key),
							children: t(key)
						}, key))
					}),
					state.busy.refresh && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: t("loading")
					}),
					state.notice !== "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: state.notice === "error" || state.notice === "conflict" ? "dsh-nexus-error" : "",
						role: "status",
						children: t(state.notice)
					}),
					state.capabilities === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("unavailable") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Page, {
						store,
						state,
						t
					})
				]
			});
		}
		function SettingsActions({ store, state, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-nexus-actions",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("settingsHelp") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(state.settingsDirty ? "settingsDirty" : "settingsClean") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: state.settingsDraft === void 0 || state.busy.settings,
						onClick: () => void store.saveSettings(),
						children: t("saveSettings")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						disabled: state.busy.settings,
						onClick: () => void store.reloadSettings(),
						children: t("reloadSettings")
					})
				]
			});
		}
		function NumberField({ label, value, min, max, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [label, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				type: "number",
				min,
				max,
				step: 1,
				value,
				onChange: (e) => {
					const next = e.currentTarget.valueAsNumber;
					if (Number.isInteger(next) && next >= min && next <= max) onChange(next);
				}
			})] });
		}
		// src/client/tool-models.ts
		/** Wire Tool names this plugin renders; every other name keeps its own view. */
		const NEXUS_TOOL_NAMES = [
			"shell",
			"web",
			"agent"
		];
		/** Characters of recorded result text a card shows before marking the preview cut. */
		const OUTPUT_LIMIT = 4e3;
		/** Characters of one recorded scalar (fact value, argument summary) a card shows. */
		const VALUE_LIMIT = 240;
		/** Characters of one recorded reason a card shows. */
		const REASON_LIMIT = 400;
		/** Argument text larger than this is not parsed: an unusable summary, not a parse risk. */
		const ARGUMENT_LIMIT = 262144;
		/** Read one field of a foreign value without letting a hostile getter escape. */
		function field(value, key) {
			if (typeof value !== "object" || value === null) return void 0;
			try {
				return value[key];
			} catch {
				return;
			}
		}
		/** Narrow to a plain non-array object, which is the only result shape either record uses. */
		function recordOf(value) {
			if (typeof value !== "object" || value === null) return void 0;
			try {
				return Array.isArray(value) ? void 0 : value;
			} catch {
				return;
			}
		}
		/** A non-blank recorded string, verbatim. */
		function textOf(value) {
			return typeof value === "string" && value.trim() !== "" ? value : void 0;
		}
		/** A recorded non-negative integer, which is the only count a tool writes. */
		function countOf(value) {
			return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : void 0;
		}
		/**
		* Bound text to a prefix without splitting a surrogate pair, so a cut emoji or
		* CJK character cannot become a replacement character.
		*/
		function clip(value, limit) {
			if (value.length <= limit) return value;
			const prefix = value.slice(0, limit);
			const last = prefix.charCodeAt(prefix.length - 1);
			return last >= 55296 && last <= 56319 ? prefix.slice(0, -1) : prefix;
		}
		/** Resolve a dispatched wire name to a card this plugin owns. */
		function asNexusToolName(value) {
			return NEXUS_TOOL_NAMES.find((name) => name === value);
		}
		/** Whether `value` owns `key`, without letting a hostile proxy trap escape. */
		function hasOwn(value, key) {
			if (typeof value !== "object" || value === null) return false;
			try {
				return Object.prototype.hasOwnProperty.call(value, key);
			} catch {
				return true;
			}
		}
		/** Whether `value` declares `key` at all, without letting a hostile trap escape. */
		function hasKey(value, key) {
			if (typeof value !== "object" || value === null) return false;
			try {
				return key in value;
			} catch {
				return true;
			}
		}
		/**
		* The stage to read, from the owner's phase when it supplies one.
		*
		* The 0.2.1 owner passes `phase`; the profile's 0.1.0 owner passes the frozen
		* call block alone. In that block a settled result is the only variant that
		* declares a `kind` (the 0.2.1 owner derives its phase the same way), while a
		* running call is the one that carries its own `callId` and `name` and no result
		* `content`. A block matching neither keeps the conservative settled default, so
		* an unrecognised payload never presents the unfinished-stage copy. No live
		* state is consulted: the block is the recorded call or result itself.
		*/
		function stageOf(phase, block) {
			if (phase === "preparing" || phase === "start" || phase === "result") return phase;
			if (phase !== void 0) return "result";
			if (hasKey(block, "kind")) return "result";
			const callId = field(block, "callId");
			const name = field(block, "name");
			return typeof callId === "string" && callId.trim() !== "" && typeof name === "string" && name.trim() !== "" && !hasOwn(block, "content") ? "start" : "result";
		}
		/** Recorded result text, joined in order, bounded, with the non-text blocks counted. */
		function recordedOutput(content) {
			const parts = [];
			let length = 0;
			let truncated = false;
			let otherBlocks = 0;
			let blocks;
			try {
				blocks = Array.isArray(content) ? content : [];
			} catch {
				blocks = [];
			}
			try {
				for (const block of blocks) {
					if (field(block, "type") !== "text") {
						otherBlocks += 1;
						continue;
					}
					const text = textOf(field(block, "text"));
					if (text === void 0) {
						otherBlocks += 1;
						continue;
					}
					const room = OUTPUT_LIMIT - length;
					if (room <= 0) {
						truncated = true;
						break;
					}
					const piece = clip(text, room);
					if (piece.length < text.length) truncated = true;
					parts.push(piece);
					length += piece.length;
				}
			} catch {}
			return {
				text: parts.join("\n"),
				truncated,
				otherBlocks
			};
		}
		/** The recorded argument fields that name what one call was about, in priority order. */
		const SUMMARY_FIELDS = {
			shell: [
				"command",
				"resourceId",
				"name",
				"cwd"
			],
			web: [
				"queries",
				"urls",
				"url",
				"resultId",
				"text"
			],
			agent: [
				"task",
				"childId",
				"label"
			]
		};
		/** The recorded action values that only request a stop, and are not an exit. */
		const STOP_ACTIONS = {
			shell: ["stop", "close"],
			web: [],
			agent: ["stop", "interrupt"]
		};
		/** Recorded facts each owning tool's `presentationMeta` can supply. */
		const FACT_FIELDS = {
			shell: [
				["toolFactAction", "mode"],
				["toolFactKind", "family"],
				["toolFactStatus", "status"],
				["toolFactResource", "resourceId"]
			],
			web: [
				["toolFactAction", "action"],
				["toolFactKind", "kind"],
				["toolFactResult", "resultId"],
				["toolFactSources", "itemCount"],
				["toolFactSaved", "savedCount"]
			],
			agent: [
				["toolFactAction", "action"],
				["toolFactChild", "childId"],
				["toolFactLabel", "label"],
				["toolFactActivity", "activity"],
				["toolFactLive", "live"],
				["toolFactChildren", "childCount"],
				["toolFactEvents", "eventCount"]
			]
		};
		/** Recorded argument text for the stage, as plain JSON text or nothing. */
		function recordedArguments(phase, block) {
			const raw = phase === "start" ? field(block, "argsRaw") : phase === "result" ? field(field(block, "call"), "argsRaw") : void 0;
			if (typeof raw !== "string" || raw === "" || raw.length > ARGUMENT_LIMIT) return void 0;
			try {
				return recordOf(JSON.parse(raw));
			} catch {
				return;
			}
		}
		/** One bounded argument summary naming what the call was about. */
		function recordedSummary(tool, phase, block) {
			const args = recordedArguments(phase, block);
			if (args === void 0) return void 0;
			for (const key of SUMMARY_FIELDS[tool]) {
				const value = field(args, key);
				const candidate = Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim() !== "").join(", ") : textOf(value);
				if (candidate !== void 0 && candidate !== "") return clip(candidate, VALUE_LIMIT);
			}
		}
		/** The recorded failure identity, present exactly when the result recorded an error. */
		function recordedFailure(block) {
			if (field(block, "isError") !== true) return void 0;
			const error = recordOf(field(block, "error"));
			const name = textOf(field(error, "name"));
			const code = textOf(field(error, "code"));
			const reason = textOf(field(error, "reason"));
			return {
				name: name === void 0 ? "" : clip(name, VALUE_LIMIT),
				code: code === void 0 ? "" : clip(code, VALUE_LIMIT),
				...reason === void 0 ? {} : { reason: clip(reason, REASON_LIMIT) }
			};
		}
		/** Recorded scalar facts, bounded, in the owning tool's declared order. */
		function recordedFacts(tool, meta, stage) {
			const facts = [];
			for (const [label, key] of FACT_FIELDS[tool]) {
				if (stage === "stopRequested" && label === "toolFactStatus") continue;
				const value = field(meta, key);
				const text = typeof value === "string" ? textOf(value) : typeof value === "boolean" || countOf(value) !== void 0 ? String(value) : void 0;
				if (text === void 0) continue;
				facts.push({
					label,
					value: clip(text, VALUE_LIMIT)
				});
			}
			return facts;
		}
		/**
		* The stage fact of one call, from its recorded stage and result payload.
		* @param stopActions - the recorded actions that only request a stop for this tool.
		*/
		function recordedStage(phase, block, output, stopActions) {
			if (phase === "preparing") return "pending";
			if (phase !== "result") return "running";
			if (field(block, "isError") === true) return "failed";
			const meta = field(block, "meta");
			const action = textOf(field(meta, "mode")) ?? textOf(field(meta, "action"));
			if (action !== void 0 && stopActions.includes(action)) return "stopRequested";
			if (field(field(block, "meta"), "timedOut") === true) return "timedOut";
			return output === "" ? "empty" : "recorded";
		}
		/**
		* Derive one card from the payload the dispatch recorded with the call.
		* @param input - the dispatched wire name, the owner's stage when it supplies
		*   one (`undefined` in the 0.1.0 owner build) and the recorded block.
		* @returns the card model; every field is derived from `input` alone.
		*/
		function readNexusToolCard(input) {
			const tool = asNexusToolName(input.tool);
			const phase = stageOf(input.phase, input.block);
			const output = phase === "result" ? recordedOutput(field(input.block, "content")) : {
				text: "",
				truncated: false,
				otherBlocks: 0
			};
			const stage = recordedStage(phase, input.block, output.text, tool === void 0 ? [] : STOP_ACTIONS[tool]);
			return {
				tool,
				stage,
				summary: tool === void 0 ? void 0 : recordedSummary(tool, phase, input.block),
				facts: tool === void 0 ? [] : recordedFacts(tool, field(input.block, "meta"), stage),
				failure: phase === "result" ? recordedFailure(input.block) : void 0,
				otherBlocks: output.otherBlocks,
				output: output.text,
				outputTruncated: output.truncated
			};
		}
		/** Locale key of one card title. */
		const NEXUS_TOOL_TITLE = {
			shell: "toolTitleShell",
			web: "toolTitleWeb",
			agent: "toolTitleAgent"
		};
		/** Locale key of one stage label. */
		const NEXUS_TOOL_STAGE = {
			pending: "toolStagePending",
			running: "toolStageRunning",
			recorded: "toolStageRecorded",
			failed: "toolStageFailed",
			stopRequested: "toolStageStopRequested",
			timedOut: "toolStageTimedOut",
			empty: "toolStageEmpty"
		};
		// src/client/tool-views.tsx
		/** Slot the shipped Tool package dispatches each atomic call through. */
		const TOOL_VIEW_SLOT = "tool.call.toolview";
		/**
		* Cell rank each mode registers at.
		*
		* The slot sorts one cell's entries by ascending `priority` and renders the
		* lowest; the default is 0 and a second entry at an occupied rank throws. So
		* `nexus` keeps rank 0 (ours wins) and `auto` deliberately sits at 10: another
		* plugin's ordinary rank-0 view wins, and ours still renders if nobody claims
		* the key. `native` never reaches this map because it registers nothing.
		*/
		const TOOL_VIEW_PRIORITY = Object.freeze({
			nexus: 0,
			auto: 10
		});
		/**
		* Dictionary namespace of the console dictionary (`NS` in `./index.tsx`). It is
		* declared as a literal here so this module does not import the entry module it
		* is imported from; the `satisfies` clause fails to compile if the two drift.
		*/
		const NEXUS_LOCALE = "dshNexus";
		/**
		* One recorded Nexus tool call.
		* @param props - dispatched wire name, stage, recorded block and locale seat.
		* @returns the card; every value in it is read from the recorded payload.
		*/
		function NexusToolCard({ toolName, phase, block, inspect, t }) {
			const model = readNexusToolCard({
				tool: toolName,
				phase,
				block
			});
			const settled = model.stage !== "pending" && model.stage !== "running";
			const openTrajectory = typeof inspect === "function" ? inspect : void 0;
			const failureIdentity = model.failure === void 0 ? "" : [model.failure.name, model.failure.code].filter((part) => part !== "").join(": ");
			const folded = model.facts.length > 0 || model.otherBlocks > 0 || model.output !== "" || model.outputTruncated || settled;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: "dsh-nexus-tool",
				"data-dsh-nexus-tool": model.tool ?? toolName,
				"data-dsh-nexus-stage": model.stage,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-nexus-tool-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								className: "dsh-nexus-tool-title",
								children: model.tool === void 0 ? toolName : t(NEXUS_TOOL_TITLE[model.tool])
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-nexus-tool-stage",
								children: t(NEXUS_TOOL_STAGE[model.stage])
							}),
							openTrajectory !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dsh-nexus-tool-inspect",
								onClick: () => openTrajectory(),
								children: t("toolInspect")
							})
						]
					}),
					model.summary !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsh-nexus-tool-summary",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("toolArgs") }),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: model.summary })
						]
					}),
					model.failure !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsh-nexus-tool-failure",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("toolFailure") }),
							failureIdentity !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: failureIdentity })] }),
							model.failure.reason !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-nexus-tool-reason",
								children: model.failure.reason
							})
						]
					}),
					folded && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: "dsh-nexus-tool-details",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("toolDetails") }),
							model.facts.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dl", {
								className: "dsh-nexus-tool-facts",
								children: model.facts.map((fact) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t(fact.label) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: fact.value })] }, fact.label))
							}),
							model.otherBlocks > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dsh-nexus-tool-note",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("toolNonTextBlocks") }),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.otherBlocks })
								]
							}),
							model.output !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-nexus-tool-note",
								children: t("toolOutput")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: model.output })] }),
							model.outputTruncated && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-nexus-tool-note",
								children: t("toolOutputTruncated")
							}),
							settled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dsh-nexus-tool-note",
								children: t("toolReplayNote")
							})
						]
					})
				]
			});
		}
		/**
		* Register the Nexus cards for their wire Tool names.
		*
		* Additive: each key is one cell of a keyed slot, so a missing locale face or an
		* occupied cell refuses that key alone and the owner's generic card stays in
		* place. The returned disposer removes only these three cells.
		*
		* @param ctx - client context; the caller must already hold the `slots` and
		*   `locale` services and must call this inside the `tool.call.toolview`
		*   declaration, as `apply` does.
		* @param priority - cell rank to register at; see {@link TOOL_VIEW_PRIORITY}.
		* @returns disposer that unregisters every card this call registered.
		*/
		function registerNexusToolViews(ctx, priority) {
			const disposers = [];
			for (const key of NEXUS_TOOL_NAMES) try {
				disposers.push(ctx.slots.register({
					name: TOOL_VIEW_SLOT,
					key,
					priority,
					locale: NEXUS_LOCALE
				}, NexusToolCard));
			} catch {
				console.warn(`[dsh-nexus] the ${key} tool card could not be registered; the generic card stays in place`);
			}
			return () => {
				for (const dispose of disposers.splice(0)) try {
					dispose();
				} catch {}
			};
		}
		// src/client/index.tsx
		const NS = "dshNexus";
		const inject = ["slots", "locale"];
		const noop = () => {};
		function safeRegistration(register) {
			try {
				return register();
			} catch {
				console.warn("[dsh-nexus] a native console seat is unavailable");
				return noop;
			}
		}
		/**
		* The display mode the live console asks for right now, or `undefined` while the
		* stored mode is still unknown.
		*
		* Draft first: the console control previews its own presentation immediately,
		* while saving remains the explicit action that makes it the stored default.
		* Saved settings answer on a fresh load before the read completes. Until either
		* exists nothing may be registered: the documented default would claim rank 0
		* in that window and can make a third-party plugin registering the same key at
		* that rank throw, which is the coexistence case this switch exists for.
		*
		* The `nexus` fallback waits for the settings read itself, not for a failed
		* request: `notice` is store-wide, so a failing library read while the settings
		* GET is still in flight would otherwise claim rank 0 in exactly that window.
		* Only a settled settings read with no stored value answers with the default, so
		* a user still gets cards when the settings read is refused.
		*/
		function requestedToolDisplay(store) {
			const snapshot = store.getSnapshot();
			if (snapshot.settingsDraft !== void 0) return snapshot.settingsDraft.toolDisplay;
			if (snapshot.settingsSaved !== void 0) return snapshot.settingsSaved.value.toolDisplay;
			return snapshot.settingsSettled ? "nexus" : void 0;
		}
		function ConsoleIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "3",
					y: "3",
					width: "18",
					height: "18",
					rx: "4"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 8h8M8 12h8M8 16h5" })]
			});
		}
		function apply(ctx) {
			try {
				ctx.effect(() => ctx.locale.register(NS, {
					en: en_default,
					zh: zh_default
				}), "dsh-nexus: dictionaries");
				const store = createConsoleStore(createNexusApi());
				ctx.effect(() => () => store.dispose(), "dsh-nexus: console state");
				ctx.effect(() => {
					if (typeof document === "undefined") return noop;
					const style = document.createElement("style");
					style.dataset.dshNexus = "";
					style.textContent = styles_default;
					document.head.append(style);
					return () => style.remove();
				}, "dsh-nexus: console styles");
				const t = ctx.locale.bind(NS);
				const mainFace = () => ({
					store,
					surface: "main"
				});
				const settingsFace = () => ({
					store,
					surface: "settings"
				});
				ctx.effect(() => ctx.slots.inject("main", () => safeRegistration(() => ctx.slots.register({
					name: "main",
					key: NS,
					locale: NS,
					inject: mainFace
				}, NexusConsole))), "dsh-nexus: main console");
				ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => safeRegistration(() => ctx.slots.register({
					name: "sidebar.panellist",
					id: NS,
					order: 50,
					label: () => t("panel")
				}, ConsoleIcon))), "dsh-nexus: sidebar entry");
				ctx.effect(() => ctx.slots.inject("settings.section", () => safeRegistration(() => {
					let remove = noop;
					const register = () => {
						remove();
						remove = safeRegistration(() => ctx.slots.register({
							name: "settings.section",
							id: NS,
							order: 50,
							label: t("panel"),
							locale: NS,
							inject: settingsFace
						}, NexusConsole));
					};
					register();
					let unsubscribe = noop;
					try {
						unsubscribe = ctx.locale.subscribe(register);
					} catch {}
					return () => {
						try {
							unsubscribe();
						} catch {}
						remove();
					};
				})), "dsh-nexus: settings console");
				ctx.effect(() => {
					let dispose = noop;
					let active;
					let requested;
					let warned;
					const reconcile = () => {
						const mode = requestedToolDisplay(store);
						if (mode !== requested) {
							requested = mode;
							warned = void 0;
						}
						if (mode === active) return;
						dispose();
						dispose = noop;
						if (mode === void 0 || mode === "native") {
							active = mode;
							return;
						}
						try {
							dispose = ctx.slots.inject(TOOL_VIEW_SLOT, () => registerNexusToolViews(ctx, TOOL_VIEW_PRIORITY[mode]));
							active = mode;
						} catch {
							if (warned === mode) return;
							warned = mode;
							console.warn("[dsh-nexus] the native tool card slot is unavailable");
						}
					};
					reconcile();
					const unsubscribe = store.subscribe(reconcile);
					return () => {
						unsubscribe();
						dispose();
					};
				}, "dsh-nexus: tool result views");
				store.refresh();
			} catch {
				console.warn("[dsh-nexus] the console could not mount");
			}
		}
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map