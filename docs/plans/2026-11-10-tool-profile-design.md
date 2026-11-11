# 工具开关（tool profile）设计

- 日期：2026-11-10
- 范围：**会话级**工具可见性；不涉及安装级能力拆分
- 状态：已实现

## 1. 目标与非目标

**目标**：让每个 Nexus 会话可以只拿到一部分工具（`read`/`write`/`edit`/`shell`/`web`/`agent`），由控制台配置、即时生效、不重启插件。

**非目标**（本次不做）：
- 安装级能力开关（行 Config + `.volatile()`），见 §7；
- 把插件拆成每功能一条 Loader 行；
- 关闭原生模块（`skill`/`ask_user`/`todo`/`AGENTS.md`/compaction）。

## 2. 契约

### 2.1 数据：只存布尔

```ts
RuntimeSettings.tools = { read, write, edit, shell, web, agent }: ToolSettings
```

单一真相。**档位不是存储字段**，只是控制台上的批量填充：

| 档位 | read | write | edit | shell | web | agent |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `minimal` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `coding`（默认） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `research` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |

与任何档位都不一致的组合显示为 `custom`（反推，不落盘）。这样避免"档位与开关打架"这类双真相问题。

### 2.2 兼容

- 旧记录没有 `tools` 字段：`runtimeSettingsSchema` 用 `.catch(DEFAULT_TOOL_SETTINGS)` 在加载边界补齐为**全开**，不会让整个 domain 打开失败。
- 保存时 `parseRecord` 同样归一化，未知形状不会被存回去。

## 3. 生效机制

1. **可见性**：`agent/created` 时对每个 Nexus Agent 调用原生
   `agent.ctx.tools.restrict({ deny: […] })`；被关闭的工具从该 Agent 的 end-tool set 消失，模型的请求里不再出现。
   > 这是 `dsh-tools` 的公开语义：`restrict` 只影响一个 Agent 继承到的工具，返回的 disposer 可以撤销。
2. **热更新**：`NexusRuntime.onSettingsChange(listener)` 在**持久化成功之后**通知；预设 scope 对活着的 Nexus Agent 重建 restriction（先撤旧的再按新值应用）。不需要重建 generation、不会重启 runtime。
3. **兜底**：`guardNexusTool` 读当前设置，被停用的工具即使仍然可见（陈旧定义、restriction 失败）也返回 `TOOL_DISABLED`，而不是带着被撤销的权限执行。
4. **子 Agent**：子会话在没有显式预设时沿用父会话的当前预设修订，因此同一条 `agent/created` 路径也会给子 Agent 应用同一套 restriction（已由 `test/preset/tool-profile.test.ts` 验证）。

## 4. 控制台

「工具」页新增：

- 档位下拉（`minimal` / `coding` / `research` / `custom`）——选中即把 6 个布尔写入草稿；
- 6 个复选框——逐项微调；离开某个档位后下拉自动显示 `custom`；
- 说明文案：只影响模型可见性；改完保存后对之后的请求生效，不会打断正在进行的调用。

仍然走既有的「保存全部设置」（`PUT /settings`，带 `expectedHash` 乐观锁）。

## 5. 测试

`test/preset/tool-profile.test.ts`（真实预设 generation + 真实工具注册表）：

1. 默认全部工具可见；
2. 关掉 `web` 后，下一次装配的请求里没有 `web`，`read`/`shell`/`agent` 仍在；恢复后重新出现；
3. 直接调用被停用工具会被拒绝（注册表按"未知工具"拒绝；Nexus guard 的 `TOOL_DISABLED` 是同一名字仍可见时的兜底），未停用工具不受影响；
4. 子 Agent 的请求同样缺少被停用的工具；
5. 缺 `tools` 字段的旧记录解析为全开。

`test/client/settings.test.ts`：档位填入、逐项覆盖、下拉显示 `custom`、保存载荷正确。

`test/runtime/store.test.ts`、`test/runtime/defaults.test.ts`：形态与默认值随新字段更新。

## 6. 风险与限制

| 项 | 说明 |
|---|---|
| 只影响可见性 | 工具仍注册在 generation scope；`restrict` 是官方允许的裁剪方式，不改变工具实现 |
| 设置是 DSH_HOME 级 | 所有 profile 共享同一份 `tools`；要 per-profile 差异需走行 Config（§7） |
| 运行中的回合 | 变更作用于**之后装配的请求**；一个已发出、已开始的调用不受影响 |
| `run_code` | PTC 保留名，本来就不能被 restrict；Nexus 不注册它 |
| 关闭 `agent` | 只阻止新的委派；已经存在的子会话继续按各自设置运行 |

## 7. 后续（未做）

- **安装级能力开关**：行 Config + `.volatile()`，适合"这台机器不装 web 能力"；代价是改配置会重挂该行、打断会话。
- **拆行**：每功能一条 Loader 行，支持 `- id: … / disabled: true` 与第三方替换某一层；改造面最大。
- 原生 5 行模块（`skill`/`ask_user`/`todo`/`AGENTS.md`/compaction）的开关，需要改预设定义的条件拼装。
