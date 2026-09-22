# Development

本文档覆盖 DSH Notes Plugin 的架构、代码结构与已知问题。

## 代码结构

| 文件 | 作用 |
|---|---|
| `host.js` | Host 引导壳（~20 行）：`fs.readText` 读 `host-impl.js` + `new Function('harness','pluginDir',src)` 执行。顶部 `PLUGIN_DIR` 是唯一需要配置的路径 |
| `client.js` | Client 引导壳：经 `notes-src` RPC 拉 `client-impl.js` + `new Function('React','styles','host',src)`，带 800ms×15 重试 |
| `host-impl.js` | Host 真正实现：fs 读写、LLM 主题分类、16 个 RPC、3 个 Agent 工具、约定注入、任务派发 |
| `client-impl.js` | Client 真正实现：面板 UI、选区记录、键盘流、注入/派发交互 |
| `styles.css` | 全部样式（经 `notes-css` RPC 下发），Apple Notes 设计令牌 + 暗色适配 |
| `check.js` | 回归测试套件（内存 mock，不碰真实笔记目录） |
| `scripts/build-dist.cjs` | **P3 发布构建**：把开发版 `client-impl.js` 机械转换为发布版 `packages/dsh-notes/lib/client.js`（带计数断言，漏改即中止） |
| `packages/dsh-notes/` | **发布版静态包**（`dsh plugin add` 用）：`index.mjs`(host) / `lib/client.js`(client) / `package.json` / `cordis.patch.yml`；`styles.css` 与开发版共用同一份（host 经 `notes-css` 下发） |

## 发布版静态包（P3）

开发版（bootstrap 壳）与发布版（静态包）是**两份形态、同一份业务逻辑**：静态包由脚本从开发版生成，不手改产物。

```bash
node scripts/build-dist.cjs     # 改完 client-impl.js 后刷新 packages/dsh-notes/lib/client.js
node --check packages/dsh-notes/lib/client.js
node check.js
```

转换规则（详见 `task-board-plugin/docs/PACKAGING.md` 第 4 节，脚本里有对应的计数断言）：

| 动态插件（`client-impl.js`） | 静态包（`lib/client.js`） |
|---|---|
| `return { inject, apply }` + `new Function` 执行 | `window.__ModuleLoader__.load({ id, factory })`，`module.exports` 返回 `{name, inject, apply}` |
| 全局 `React` | `require('react')`（factory 顶部） |
| `host.call('notes-xxx', args)` | `rpc('notes-xxx', args)` → `fetch('/dsh-notes', {method:'POST', body:{method,args}})` |
| `styles.insert(css)` | `fetch` 取 `notes-css` + `document.createElement('style')` 注入 `document.head` |
| `ctx.interval/timeout/debounce` 快捷方式 | `ctx.get('timer')` + `ctx.effect` |
| `inject: ['timer','sessions','workspaces']` | `inject: ['slots']`，其余服务 `ctx.get` + 守卫（服务未就绪时优雅退出） |

> ⚠️ **进程单例**：静态包 client 全进程一个实例（动态插件是每会话一个）。`panelOpen`/`entryMode`/`fabPos`/`toastEmit` 是进程级 UI 状态（面板本身是 `shell.overlay` 单实例，语义正确）；`currentSessionId` 仍由 Slot props 更新；`listeners`/`noteRefreshListeners` 是所有会话渲染实例共用的通知集合。新增会话级状态时必须按 `sessionId` 分桶。
>
> ⚠️ **RPC payload 不能含 `undefined` 字段**（PACKAGING.md 坑 5）：条件组装，别固定传全字段。
>
> ⚠️ 发布包里**任何位置**（含注释）都不许出现 `host.call` / `styles.insert` 字样——纯文本验收会误判成没迁干净，构建脚本对此有硬断言。

## Bootstrap 壳架构（为什么）

`cordis_define` 传输超长源码字符串可能被截断（历史上连续损坏过多次）。因此拆成：

- **壳**（`host.js`/`client.js`）：极短、稳定，通过 `cordis_define` 传入，永不改业务逻辑
- **实现**（`*-impl.js`/`styles.css`）：磁盘文件，运行时由壳加载

迭代流：**改磁盘实现文件 → `cordis_run(mode=run)` 重启即可，无需重新 define**。`host-impl.js` 每次加载会写 `.last-host-load` 心跳文件用于自检。

`pluginDir` 由 `host.js` 经 `new Function('harness','pluginDir',src)(harness, PLUGIN_DIR)` 注入，实现内所有路径（`NOTES_DIR`/`CSS_PATH`/`perf-report`/心跳/`notes-src`）都从它派生，移植只需改 `host.js` 顶部一处。

## Host 端（`host-impl.js`）

- `inject: ['fs','sandboxPolicy']`；`agents/llm/agentDefaultModel/systemPrompt/sessionPersistence/workspaceRegistry` 经 `ctx.get(...)` 可选读取
- **缓存层**：`cache: Map<id, note>` 常驻内存；`persistNote` 写入即同步缓存，`_list` 命中零磁盘读；外部新增文件 list 时懒加载
- **快速记录队列**：`quickChain` 串行化避免读-改-写竞态；同 session 且 10 分钟内合并，否则新建；主题分类异步回填（先落盘返回，不阻塞）
- **16 个 RPC**：`notes-list/get/create/update/quick/delete/restore/archive/search/css/src/perf/conventions/sessions/active-sessions/dispatch`
- **3 个 Agent 工具**：`note_search`、`note_get`、`note_manage`（七 action：create/list/update/delete/restore/archive/dispatch）

### 约定注入（T2.3）

`systemPrompt.context({ name:'notes:workspace-conventions', order:130, text })` 注册动态 prompt 上下文。`text` 是同步函数（不能 await），从 `cache` 读。

匹配规则：`n.deleted` 排除；`inject !== true` 排除（旧文件无 `inject` 字段时 `noteFromParsed` 回退到 `tags` 含 `convention`）；`injectTo` 数组多选过滤（`[]`=本工作区 / `global` / 会话短 id）。当前工作区取 `agents.currentInitiator().session.header.cwd` 的 basename。

> ⚠️ 坑：`systemPrompt.context` 的 `text` 必须返回 `string`，返回 `undefined` 会让 DSH assemble 时 `undefined.indexOf` 崩溃（run 失败）。无匹配时返回 `''`。

### 任务派发

- `agents.roots()` 拿顶层 live agents（天然排除子 agent）作活跃会话列表
- `_dispatch` 共享函数：`_get` 笔记 → `agents.get(sessionId)` 校验活跃 → `agent.send(msg, 'next-turn', true)` 注入 → 正文追加「已派发→会话X @时间」
- `note_manage dispatch` 无 `targetSessionId` 时返回活跃会话列表（`needTarget:true`）

## Client 端（`client-impl.js`）

- 注入 `conversation.session.header.actions`（order 40）头部按钮 + `shell.overlay`（order 200 面板 / 201 选区按钮）
- 面板状态（位置/尺寸/列宽）持久化 `localStorage` `dsh-notes-panel-state`
- **动态 client 禁用 `setTimeout/setInterval`**：用 `timer.timeout`（每次注册 effect）做一次性延迟，`timer.debounce`（生命周期单注册）做击键级防抖
- **选区记录**：监听 `selectionchange`（`mouseup` 不从 DSH 消息区冒泡），`isCollapsed` 快速路径跳过打字场景，mousemove 仅选区存在时跟踪
- **键盘流**：document 级 `keydown` 挂一次，回调读 ref（避免闭包过期）
- **自动保存**：编辑字段 onChange → `timer.debounce(doSave, 900)`，读 ref 取最新值

### 数据流（client ↔ host）

- `host.call('notes-*', args)` → host `harness.handle` 注册的 RPC
- 正文编辑走 `notes-get` 按需加载（列表是瘦身数据，不含 body）
- 样式经 `notes-css`、实现源码经 `notes-src` 下发（避免 define 传大字符串）

## 笔记文件格式

见 [README.md](README.md#数据模型)。完整字段：`id/title/topic/workspace/tags/kind/status/inject/injectTo/createdAt/updatedAt/sessionId/cwd/mergedFrom/archivedAt/deleted`。

## 测试

```bash
node check.js
```

内存 mock（`fs`/`llm`/`agents`/`sessionPersistence`/`workspaceRegistry`/`systemPrompt`），不触碰真实笔记。覆盖：语法、host 全链路（create/list/缓存/update/quick 合并+异步分类/跨 session/search/delete/restore/archive）、注入范围（global/workspace/会话/旧文件兼容）、会话名与子 agent/归档过滤、任务派发、工具 schema、client 结构断言；第 17 节覆盖发布版 host（`packages/dsh-notes/index.mjs`），第 18 节覆盖发布版 client（`lib/client.js`：形态/API 面/UI 功能面/4 个 Slot 注册/React 树可构建/卸载清理/构建可复现）。

> ⚠️ 关键：`t(name, fn)` 必须 `await fn()`——曾不同步导致 async 断言未执行就 passed++（假通过）。修复后暴露并修正了 5 个假通过。

## 已知问题：Windows 沙箱后端

Windows 上 DSH 的 `workspace-write` 沙箱模式不可用（"Windows ACL temp root must be outside the workspace"）。**症状隐蔽**：读正常（列表能渲染），写/删静默失败（不落盘）。

**修复**：每个 `fs.writeText` 显式传 `danger-full-access` 策略：

```js
function getPolicy() {
  try { if (sp && sp.resolve) return sp.resolve({ mode: 'danger-full-access' }) } catch (e) {}
  return undefined
}
await fs.writeText(target, content, undefined, undefined, getPolicy())
```

## Troubleshooting

- **列表能渲染但增删改无效**：沙箱策略没传。确认 `getPolicy()` 返回 `danger-full-access` 且作为第 5 参传给 `fs.writeText`
- **插件加载报错 `reading 'indexOf'`**：`systemPrompt.context` 的 `text` 返回了 `undefined`，应返回 `''`
- **选区按钮看不见**：它是 `position:fixed` 不在 `.dsh-notes-floating` 内，拿不到面板 CSS 变量——fixed 元素要用具体颜色值
- **DSH 重启后插件消失**：动态插件不持久，需重新 `cordis_define` + `cordis_run`
