# Development

本文档覆盖 DSH Notes Plugin 的架构、代码结构与已知问题。

## 代码结构

| 文件 | 作用 |
|---|---|
| `host.js` | Host 引导壳（~20 行）：`fs.readText` 读 `src/host-impl.js` + `new Function('harness','pluginDir',src)` 执行。顶部 `PLUGIN_DIR` 是唯一需要配置的路径 |
| `client.js` | Client 引导壳：经 `notes-src` RPC 拉 `src/client-impl.js` + `new Function('React','styles','host',src)`，带 800ms×15 重试 |
| `src/host-impl.js` | Host 真正实现：fs 读写、LLM 主题分类、39 个 RPC、3 个 Agent 工具、约定注入、任务派发 |
| `src/client-impl.js` | Client 真正实现：面板 UI、选区记录、键盘流、注入/派发交互 |
| `src/styles.css` | 全部样式（经 `notes-css` RPC 下发），Apple Notes 设计令牌 + 暗色适配 |
| `check.js` | 回归测试套件（内存 mock，不碰真实笔记目录） |
| `design/notes-ui-v2.html` | **UI 交互原型（唯一规格来源）**：单文件原生 JS，浏览器直接打开验证；UI 改动必须同步更新（见下方「UI 改动同步约定」） |
| `scripts/build-dist.cjs` | **P3 发布构建**：把开发版 `src/client-impl.js` 机械转换为发布版 `packages/dsh-notes/lib/client.js`（带计数断言，漏改即中止） |
| `packages/dsh-notes/` | **发布版静态包**（`dsh plugin add` 用）：`index.mjs`(host) / `lib/client.js`(client) / `package.json` / `cordis.patch.yml`；`lib/styles.css` 与开发版 `src/styles.css` 共用同一份（host 经 `notes-css` 下发） |

## 发布版静态包（P3）

开发版（bootstrap 壳）与发布版（静态包）是**两份形态、同一份业务逻辑**：静态包由脚本从开发版生成，不手改产物。

```bash
node scripts/build-dist.cjs     # 改完 src/client-impl.js 后刷新 packages/dsh-notes/lib/client.js
node --check packages/dsh-notes/lib/client.js
node check.js
```

转换规则（详见 `task-board-plugin/docs/PACKAGING.md` 第 4 节，脚本里有对应的计数断言）：

| 动态插件（`src/client-impl.js`） | 静态包（`lib/client.js`） |
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
- **实现**（`src/*-impl.js`/`src/styles.css`）：磁盘文件，运行时由壳加载

迭代流：**改磁盘实现文件 → `cordis_run(mode=run)` 重启即可，无需重新 define**。`src/host-impl.js` 每次加载会写 `.last-host-load` 心跳文件用于自检。

## UI 改动同步约定（硬性）

> ⚠️ **凡改动 UI（`src/client-impl.js` 布局/交互/视觉、`src/styles.css`），必须同步更新交互原型 `design/notes-ui-v2.html`**——原型是 UI 的唯一规格来源（单文件原生 JS + SVG 图标库 + DSH token 配色，浏览器直接打开即可验证），二者不允许出现行为或视觉偏差：
>
> - 新增/修改交互 → 原型先改或同一次改动内一起改，作为实现依据
> - 视觉调整（间距/配色 token/图标）→ 同步进原型 CSS
> - 验收流程：先开原型确认交互预期，再对照实现逐项核对
>
> 该约定同样约束 Agent 看板任务：涉及 UI 的任务，description 必须把「同步更新 `design/notes-ui-v2.html`」列为交付项；Verifier 验收时核对原型与实现一致。

## 看板任务流程约定（提速）

> 两条针对 Agent 看板任务的提速约定（proposal：任务执行提速 落地）：
>
> 1. **原型/文档回写批量后置**：纯行为任务（host/client 逻辑、RPC、字段链路、工具 schema 等不涉及 UI 规格与视觉的改动）在任务书未明确要求时，worker **不改** `design/` 原型与 README 等文档；发版前由专门的批量任务统一补原型回写与文档同步。涉及 UI 规格/视觉/交互的任务仍按上方「UI 改动同步约定（硬性）」同步原型，不适用本例外。
> 2. **小任务可用 `pipeline: work`**：纯入口迁移/文案/注释类小任务（无行为变更、无断言语义变化）创建任务时可标 `pipeline: work` 跳过 verifier 环节，由主窗口抽检替代验收。任务书必须写明理由；凡触及 RPC/工具 schema/注入/归档/编辑器内核等主链路的改动不得使用，仍走 full 流水线（worker `--core` 自测 + verifier 全量验收）。

## 版本适配映射约定（硬性）

> ⚠️ **DSH 更新频繁，每个 release 必须向用户给出明确的版本引导**：
>
> 1. README 的「版本适配（dsh-notes ↔ DSH）」映射表必须随每个插件版本更新一行：插件版本 / 发布日期 / 声明适配 DSH（取 `peerDependencies` 实值）/ **实测基线**（本版本开发与回归所用 DSH 版本）/ 要点摘要。
> 2. 「实测基线」必须真实：发布前在基线版本上跑过 `node check.js` 与活体验证；未验证过的 DSH 版本不得写进基线列。
> 3. `peerDependencies` 双向随实测走：**下限 = 实测基线**（依赖了某版本 API 即视为依赖；实测发现旧版本不可用必须收紧，如 0.2.2 把下限从 0.1.5-rc.1 收紧到 0.1.7），**上限 = 未验证的保守声明**（如 `<0.2.0-0`）。npm 已发布版本无法修改声明——发现声明与实际不符时，发新 patch 版修正并在映射表标注。
> 4. 发布任务（release）的交付项必须包含：`package.json` version 三处一致（根/包/README 表）+ `files` 白名单核对（`npm pack` 干跑验证新资产，如 app.html）+ 映射表更新。tag==version 校验由 CI（`publish.yml`）兜底。
> 5. **npm 页面 README = 包内 `packages/dsh-notes-plugin/README.md`，不是仓库根 README**：release 必须执行 `node scripts/sync-pkg-readme.cjs`（根 README 复制进包并改写 docs 图片路径；`docs/` 已在 files 白名单内），否则 npm 页面停留在旧文档。

`pluginDir` 由 `host.js` 经 `new Function('harness','pluginDir',src)(harness, PLUGIN_DIR)` 注入，实现内所有路径（`NOTES_DIR`/`CSS_PATH`/`perf-report`/心跳/`notes-src`）都从它派生，移植只需改 `host.js` 顶部一处。

## Host 端（`src/host-impl.js`）

- `inject: ['fs','sandboxPolicy']`；`agents/llm/agentDefaultModel/systemPrompt/sessionPersistence/workspaceRegistry` 经 `ctx.get(...)` 可选读取
- **缓存层**：`cache: Map<id, note>` 常驻内存；`persistNote` 写入即同步缓存，`_list` 命中零磁盘读；外部新增文件 list 时懒加载
- **快照式历史引擎**（`history-engine` 标记块，双包同步——路径拼接与删除通道差异同 `purgeNoteFile` 先例）：
  - 存储：`NOTES_DIR/.history/<noteId>/<UTC ISO 时间戳（':'→'-'）>.<稳定内容 hash>.md`，纯文本目录即格式；文件名字典序即时序，免读 mtime。
  - 触发：`persistNote(n, opts)` 真实落盘前快照「被替换的上一版」（与 client doSave 防抖对齐）；上一版 = 写盘前 `cache` 原件经 `noteFileContent` 重建字节——**零新增磁盘读**（缓存即盘上字节；useCount 未落盘窗口/外部手写文件的重建为内容等价的规范化字节）。创建首版无旧版自然跳过；`persistNote` 第二参 `{ history:false }` 标记自动元数据回写（useCount 防抖落盘 / agent status idle 派发回执）不算编辑、不产生快照。
  - 去重：hash（FNV-1a+长度，纯 JS 无 crypto 依赖）只覆盖稳定内容（剔除 `updatedAt`/`useCount` 易变字段），与该笔记最新快照文件名内嵌 hash 比对，相同跳过；hash 内嵌文件名使重载后去重仍零读盘有效；文件名 ts 按笔记单调递增（同毫秒兜底 +1ms）保证「字典序最大=最新」不错位。
  - 保留（写入路径摊销，无定时器）：分层 1h 每版 / 当天每小时 1 版 / 7 天每天 1 版 / 超期淘汰；单笔记硬上限 20 版；全库 50MB LRU（`histSizes`/`histBytes` 惰性扫描一次后增量记账；导入合并历史后置 null 重扫）。
  - 删除语义同 purge：开发版墓碑式清空（0 字节，扫描视作不存在），静态包 `fs.processPath`+`node:fs` 真删；`notes-purge` 连带清整棵 `.history/<id>`（返回 `historyPurged`）。
  - 导入导出：`copyNotesDir(target, { includeHistory })`——导出默认不含（`notes-export` 新参数 `includeHistory`，返回 `history` 计数），导入前备份恒含；导入合并仅 added 新笔记连带（同名快照跳过，返回 `historyMerged`），同 id 冲突跳过历史合并。
  - 红线：`_list/_get/_search` 主读取路径零新增 IO（`.history` 是子目录，列表只认 `n-*.md` 直子级）；快照/保留/预算全部挂写入路径；快照失败只 log 不阻塞保存。
- **快速记录队列**：`quickChain` 串行化避免读-改-写竞态；同 session 且 10 分钟内合并，否则新建；主题分类异步回填（先落盘返回，不阻塞）
- **39 个 RPC**：`notes-list/get/create/update/quick/quick-instruct/delete/restore/purge/archive/archive-preview/archive-undo/search/css/src/perf/conventions/inject-preview/sessions/active-sessions/workspaces/dispatch/dispatch-done/settings-get/settings-set/export/export-single/import-preview/import/asset-upload/folders/ai-organize/assets-prune/suggest/usage-get/history/history-get/restore-history/memory-guide`（工作记忆 v0 Phase 1：`notes-memory-guide {op:check/enable/status/disable}` 沉淀引导启用流程（约定笔记方案，tag memory-guide 发现键 + 语义重叠检查 + 确保「工作日志」文件夹）；kind=log 工作日志默认隐身（inject 硬 false / recall 缺省 false / 列表与默认搜索排除，筛选中心 kind=日志 专入口）且永不被过期/孤儿清理提名；front-matter 预留 logDate/entities/summarizedAt；规格 design/agent-memory-v0.md）（历史版本面板：`notes-history {id}` 版本列表倒序轻量零正文 `[{ts,bytes}]`、`notes-history-get {id,ts}` 取单版正文（预览只读）、`notes-restore-history {id,ts}` 把历史版写回正文——恢复前置自动快照：persistNote 缺省语义先把当前版入 `.history`，恢复动作本身可撤销；client 详情 meta 行「历史」入口（有版本才显示）→ modal 列表/预览/一键恢复）（二期新增 `notes-ai-organize` 按 kind 模板重写正文、`notes-assets-prune` 孤儿资产清理 dry-run 预览 + 白名单删除；P1 回收站：`notes-list` 参数化 `includeDeleted` + `notes-purge` 彻底删除——仅限已软删除笔记，`.md` 与 `.md.bak` 一并移除；ctx.fs 无删除契约，开发版落回墓碑式清空（0 字节占位，全链路视作不存在），静态包经 `fs.processPath` + `node:fs` 真删；P3 单文件导出：`notes-export-single` 按 scope（all/folder/tag）拼接单篇自包含 Markdown，图片 base64 内联，>20MB 告警仍导出；注入预览器：`notes-inject-preview {sessionId?, workspace?}` 纯复用 conventionText/catalogText 渲染产物 + 统计（脱敏/时效标注/预算截断），三档视角——缺省全局 / 传工作区标题（workspace）= 该工作区全部会话注入并集 / 传会话 id 按 injectTo 命中过滤（sessionId 与 workspace 互斥、同传 sessionId 优先），预览不更新 lastInjectChars；整理建议器：`notes-suggest` dry-run 零写入返回四类候选——archiveCandidates 速记组（内聚复用 `_archivePreview` 同款结构）/ staleCandidates 过期未引用（kind=note/link 且超 staleDays 且 useCount===0，遥测保护）/ orphanCandidates 孤儿 / logHygieneCandidates 日志卫生（工作记忆 v0：超 7 天周聚合 + 超 90 天月聚合提名，只提名不执行）（无 [[双链]] 出链与反向链接、inject=false、useCount=0、status=active 的普通笔记，排除速记与归档产物防误伤，上限 20），只提名不执行，client 三段式 modal 直达归档预览 / confirm 后批量软删 / 孤儿仅展示逐条跳转；LLM 用量统计：`notes-usage-get` 返回 { today, week, month, allTime, byFeature, estimatedTokens, exactTokens, calls }——llm-usage 标记块计量包装挂 3 个 llm 调用点（classifyTopic/extractInstruction=classify、_aiOrganize=organize，streamMetered 捕获 usage chunk 真实值优先、缺省字符估算 1.6 系数兜底），usage.json 独立于 settings.json 落盘（内存累积 + 5s 防抖 + 卸载 flush），settings 新键 `usageBudgetMonthly` 月度预算提醒阈值（tokens/月，0=关闭，超预算仅 client toast 不阻断））
- **3 个 Agent 工具**：`note_search`、`note_get`、`note_manage`（七 action：create/list/update/delete/restore/archive/dispatch）

### 约定注入（T2.3）

`systemPrompt.context({ name:'notes:workspace-conventions', order:130, text })` 注册动态 prompt 上下文。`text` 是同步函数（不能 await），从 `cache` 读。

匹配规则：`n.deleted` 排除；`inject !== true` 排除（旧文件无 `inject` 字段时 `noteFromParsed` 回退到 `tags` 含 `convention`）；`injectTo` 数组多选过滤（`[]`=所有会话（缺省） / 会话短 id=仅限这些会话；存量 `global`/`workspace` 值一律按所有会话容错，不迁移）。注入无「工作区」维度——笔记无归属，只看会话短 id（取 `agents.currentInitiator()` 的 sessionId 前 8 位）。

> ⚠️ 坑：`systemPrompt.context` 的 `text` 必须返回 `string`，返回 `undefined` 会让 DSH assemble 时 `undefined.indexOf` 崩溃（run 失败）。无匹配时返回 `''`。

### 任务派发

- `agents.roots()` 拿顶层 live agents（天然排除子 agent）作活跃会话列表
- `_dispatch` 共享函数：`_get` 笔记 → `agents.get(sessionId)` 校验活跃 → `agent.send(msg, 'next-turn', true)` 注入 → 正文追加「已派发→会话X @时间」
- `note_manage dispatch` 无 `targetSessionId` 时返回活跃会话列表（`needTarget:true`）

## Client 端（`src/client-impl.js`）

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
node check.js           # 全量回归（默认，514 条；verifier/发布前用）
node check.js --core    # 核心快检：73 条主链路代表性断言，秒级（worker 自测用）；也可用 CHECK_CORE=1
```

**两档约定（硬性）**：

- **worker 自测跑 `--core`**：核心名单覆盖各主链路代表性失败面——RPC 面/缓存/quick 合并/搜索/软删/归档三连（preview→archive→undo）/工具路由/约定注入+脱敏/injectTo/派发+闭环/静态包全链路（迁移+资产路由+归档+perf）/设置持久化/构建可复现/编辑器内核 round-trip+XSS/文件夹/目录注入/资产上传/导入导出/三端内核同步/预算截断/遥测计数/注入预览/整理建议/组合过滤/injectEver/img-path-hint/快照式历史引擎（触发+去重+零读盘红线/导入导出适配）。
- **verifier 验收 / 发布前跑全量**（无参），并 `node check.js > check-result.txt` 刷新基线存档；`--core` 模式不刷新 check-result.txt。
- 核心名单 = `check.js` 顶部 `CORE` 集合，按断言名精确匹配。**新增/改名断言后跑一次 `--core`**：收尾会校验名单全命中，未命中（改名/删除）计 1 个 failed，防静默漏检。核心与非核心断言共享同一套 mock 实例与造数流程（节间 setup 两模式都照常执行，只跳过 t() 断言体），断言语义零差异。

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
