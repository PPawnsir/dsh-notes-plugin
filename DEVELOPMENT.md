# Development

本文档覆盖 DSH Notes Plugin 的架构、代码结构与已知问题。

## 代码结构

| 文件 | 作用 |
|---|---|
| `host.js` | Host 引导壳（~33 行）：读 `src/host/manifest.dev.js` + 逐条目 `fs.readText` 拼接（LF 归一）+ `new Function('harness','pluginDir',src)` 执行。顶部 `PLUGIN_DIR` 是唯一需要配置的路径 |
| `client.js` | Client 引导壳：经 `notes-src` RPC 拉 `src/client/**` 按 manifest 拼接的单文件 + `new Function('React','styles','host',src)`，带 800ms×15 重试 |
| `src/host/**` | **Host 唯一源码**（P2·5 终态，昔日 `host-impl.js` 单体系谱已消亡）：模块树按 `src/host/manifest.dev.js`（开发版，host.js 运行时拼接）/ `manifest.dist.js`（发布版，`build-dist.cjs` 构建期拼接写盘 `index.mjs`）逐字节组装——`kernel/`（head/format/front-matter/session-ctx/settings-store/store-cache/persist）→ `inject/sensitive-helpers` → `llm/`（usage-classify/organize）→ `history-trash/`（engine/trash）→ `folders`/`notes` → `server`（RPC 基础设施 handle/perf + 核心注册表 + notes-css/notes-src 源下发；发布版 `server.dist.js` 同模块另含 webServer 三路由 + notes-ping）→ `inject/img-path-hint` → `dispatch`（会话元数据 + 派发闭环）→ `inject`（注入渲染 renderInjected/conventionText + 单一注入注册 order130（0.4.3③ 起目录段并入、order131 撤销；0.4.4-E 起目录段唯挂载行源）+ inject-preview/settings-get/set/usage-get）→ `memory`（归档 + 整理建议 suggest + 日志卫生 + 工作记忆引导 memory-guide）→ `search` → `transfer`（导入导出 + 资产）→ `index`（工具层 3 工具 + 启动装配收尾，尾模块；发布版 `index.dist.js` 另含一次性迁移）。`kernel/format`、`kernel/front-matter`、`kernel/session-ctx`、`inject/sensitive-helpers`、`inject/img-path-hint`、`search` 六片双包逐字节一致 → 物理单份两清单同名引用；差异片以 `.dist.js` 后缀登记变体（§8.4.3 红线 9），`check/sections/45-host-modular.cjs` 锁定序位 + 共源/变体登记 + 方向断言 |
| `src/client/**` | **Client（React 面板）唯一源码**：模块目录按 `src/client/manifest.js` 有序逐字节拼接为单文件（kernel 无 UI 域 / modals / popovers / panels，规格 `design/architecture-modular.md` §3.1）；拼接产物即昔日单文件 `client-impl.js` 全文（LF 归一），运行时经 `notes-src` 下发、`build-dist.cjs` 转换为发布包 |
| `src/app/**` | **app 页（DOM 态）唯一源码**：片段目录按 `src/app/manifest.js` 有序逐字节拼接为 `packages/dsh-notes-plugin/app.html`（域结构镜像 client：kernel/panels/modals/popovers + 页面壳 shell/）；产物写盘提交，check.js 有可复现断言兜底 |
| `src/shared/editor-kernel.js` | 编辑器内核 v3 标记块**物理单份**（两态共源，§4.3 唯一例外）：按列 0 维护；client 拼接侧逐非空行加 4 空格基座缩进（apply 体层级），app 拼接侧原样纳入；check.js 三端逐字节断言继续看守产物 |
| `src/styles.css` | 全部样式（经 `notes-css` RPC 下发），Apple Notes 设计令牌 + 暗色适配 |
| `check.js` | 回归测试 **runner**（模式解析 + CORE 名单 + 节注册表 + 收尾总结）；内存 mock，不碰真实笔记目录 |
| `check/helpers.cjs` | 测试共享设施：`t()`/`section()`/断言计数器/源码常量 + host mock 实例工厂 `createHostMocks()`（原单文件节 2 主体），跨节共享状态经 `S` 对象传递 |
| `check/discover.cjs` | 节注册自动发现（0.4.6-I）：扫 `check/sections/*.cjs` 按数值元组排序契约注册——新增节文件零改动 check.js（消批次共享锁），节 100 常驻断言看守 |
| `check/sections/*.cjs` | 节断言模块群（按节次命名如 `39-memory.cjs`，插节用子号如 `35-5-`），节体自原单文件逐字节迁移；节首从 `H`/`S` 解构依赖、节末 `Object.assign(S, {...})` 导出本节造数 |
| `design/notes-ui-v2.html` | **UI 交互原型（唯一规格来源）**：单文件原生 JS，浏览器直接打开验证；UI 改动必须同步更新（见下方「UI 改动同步约定」） |
| `scripts/concat-client.cjs` | **client 组装器**：`src/client/**` 按 manifest 逐字节拼接（零插入零改写零 banner，LF 归一）；`notes-src` 运行时下发与 `build-dist.cjs` 共用本规则（开发/发布同源）；`@shared/` 条目解析到 `src/shared/` 并加 4 空格基座缩进（同一规则在 `src/host/server.js` 与 `server.dist.js` 的 notes-src 各有一份内联实现） |
| `scripts/concat-app.cjs` | **app 组装器**：`src/app/**` + `src/shared/` 按 manifest 逐字节拼接 → 写盘 `packages/dsh-notes-plugin/app.html`；`@shared/` 条目原样纳入（列 0 即页面形态） |
| `scripts/concat-host.cjs` | **host 组装器**（P2·2 起）：`src/host/**` 按 `manifest.dev.js` / `manifest.dist.js` 双清单逐字节拼接——`concatHost()` 供 check.js 读开发版产物（与 host.js 运行时拼接同一规则），`concatHostDist()` 供 `build-dist.cjs` 写盘 `index.mjs`；`@shared-host/` 条目预留物理共源通道（暂无缩进提升，§8.4.1） |
| `scripts/build-dist.cjs` | **P3 发布构建**：把 `src/client/**` 拼接产物机械转换为发布版 `packages/dsh-notes-plugin/lib/client.js`（带计数断言，漏改即中止），拼接 `src/host/**` → `index.mjs`，并同步 `lib/styles.css` 与 `app.html`（一次命令刷新四产物） |
| `packages/dsh-notes-plugin/` | **发布版静态包**（`dsh plugin add` 用）：`index.mjs`(host) / `lib/client.js`(client，生成) / `app.html`(app 页，生成) / `lib/styles.css`(生成) / `package.json` / `cordis.patch.yml`；`lib/styles.css` 与开发版 `src/styles.css` 共用同一份（host 经 `notes-css` 下发） |

### 模块树实景（P1+P2 终态）

```
src/
├── client/                  ← React 面板唯一源码（48 片，manifest.js 有序逐字节拼接）
│   ├── manifest.js          ← 唯一组装依据：kernel(10) + @shared(1) → modals(18) → popovers(7) → panels(12)
│   ├── kernel/              ← 无 UI 域：bootstrap / bus / state(最小 store) / persist / constants / format / icons / perf / css-loader / drag
│   ├── modals/              ← 18 个 modal 一文件一个：link image merge newnote history trash prune archive export export-single import inject-preview inject-manager suggest memory-guide dispatch cheatsheet settings
│   ├── popovers/            ← 7 个浮层：help selbar folder-menu ctx-menu scope filter-pop sort-menu
│   └── panels/              ← entries/(header-button fab injected-badge=0.4.5-H 会话头部注入清单徽标📎N) · selection/(capture=选区卡+toast 宿主) · panel/(search wiki tree editor sidebar chrome keyboard index=唯一装配点)
├── app/                     ← app 页（DOM 态）唯一源码（41 片，manifest.js 拼接 → 写盘包内 app.html）
│   ├── shell/               ← 页面壳片段 head.html / body.html / tail.html
│   ├── kernel/              ← rpc / state / dom / helpers / data / bootstrap
│   ├── panels/ modals/ popovers/  ← 域结构镜像 client（各自独立实现不共源，§4.3）；序位 = 昔日单文件字节序（域间交织，不为美学重排）
│   └── manifest.js
├── host/                    ← host 唯一源码（双清单：manifest.dev.js 22 片 / manifest.dist.js 23 片）
│   ├── manifest.dev.js      ← 开发版清单：host.js 运行时拼接的唯一依据
│   ├── manifest.dist.js     ← 发布版清单：build-dist.cjs 拼接写盘 index.mjs 的依据
│   ├── kernel/              ← head(仅 dev) / format° / front-matter° / session-ctx° / settings-store* / store-cache* / persist*
│   ├── inject/              ← sensitive-helpers° · img-path-hint°
│   ├── llm/                 ← usage-classify* / organize*
│   ├── history-trash/       ← engine* / trash*
│   ├── folders.js* notes.js* server.js* dispatch.js* inject.js* memory.js* transfer.js* index.js*
│   ├── search.js°           ← 共源单份片
│   └── head.js apply-head.js（仅 dist，ESM 出口头）
└── shared/
    └── editor-kernel.js     ← 编辑器内核 v3 标记块物理单份（列 0 维护；client 侧拼接逐非空行加 4 空格基座缩进，app 侧原样纳入）
```

（`*` = 双包变体对：同名 `.js` + `.dist.js` 两清单各自登记，差异仅限 design/architecture-modular.md §8.1.5 清单内的设计内分歧，红线 9 禁止第三份拷贝；`°` = 双包逐字节一致、两清单同名引用同一物理文件的共源单份片，共 6 个——format / front-matter / session-ctx / sensitive-helpers / img-path-hint / search，节 45「共源片登记」断言显式看守其中 img-path-hint 与 search 两片不许出 .dist 变体。）

**manifest 机制**：清单是「单引号路径一行一条」的纯文本（正则提取——host.js 沙箱内无 require），**注释中禁止出现单引号**；序位 = 拼接序 = 标识符可见序（后位可见前位顶层标识符，禁反向）。`@shared/` 条目解析到 `src/shared/`；host 侧预留 `@shared-host/` → `src/shared-host/` 通道（当前无条目）。

### 组装器跑法（双出口）

| 场景 | 命令 / 触发 | 说明 |
|---|---|---|
| 改 `src/host/**` 或 `src/client/**`（日常开发） | **无需跑脚本**：`cordis_run` 重启插件即生效 | host.js 运行时按 `manifest.dev.js` 拼接；client 由 host 的 `notes-src` RPC 按 `src/client/manifest.js` 拼接下发 |
| 改 `src/app/**` 或 `src/shared/editor-kernel.js` | `node scripts/concat-app.cjs` | `app.html` 是写盘提交产物，改源后必须重拼（也可由 build-dist 一并刷新）；check.js「app.html 可复现」断言兜底防忘跑 |
| 发布前 / 刷新发布包 | `node scripts/build-dist.cjs` | 一次刷新四产物：`lib/client.js`（拼接 + 6 组机械转换，计数断言漏改即中止）+ `lib/styles.css`（复制）+ `app.html`（拼接）+ `index.mjs`（按 `manifest.dist.js` 拼接写盘） |
| 产物校验 | `node --check packages/dsh-notes-plugin/lib/client.js` + `node check.js` | index.mjs 为 ESM，其语法由 check.js 节 17 的动态 import 断言覆盖；回归见「测试」节 |

`concat-client.cjs` / `concat-host.cjs` 是纯库（无 CLI 入口）：前者被 `build-dist.cjs` 与 `check/helpers.cjs` 复用；后者导出 `concatHost()` / `concatHostDist()`，分别供 check.js 读开发版拼接产物、`build-dist.cjs` 写盘 `index.mjs`。host 拼接规则共三份实现——host.js 引导壳、`server.js` / `server.dist.js` 的 `notes-src` host 分支、`scripts/concat-host.cjs`（沙箱无 require 无法共享代码），check.js 节 45 锚点断言锁定三者同规则（`manifest.dev.js` + 单引号清单纯文本解析）。

## 发布版静态包（P3）

开发版（bootstrap 壳）与发布版（静态包）是**两份形态、同一份业务逻辑**：静态包由脚本从开发版模块源生成，不手改产物。

```bash
node scripts/build-dist.cjs     # 改完 src/client/** 或 src/app/** 或 src/host/** 后一次性刷新四产物：lib/client.js + lib/styles.css + app.html + index.mjs
node --check packages/dsh-notes-plugin/lib/client.js
node check.js
```

转换规则（详见 `task-board-plugin/docs/PACKAGING.md` 第 4 节，脚本里有对应的计数断言）：

| 动态插件（`src/client/**` 拼接产物） | 静态包（`lib/client.js`） |
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
- **实现**（`src/host/**` 模块树/`src/client/**` 模块源/`src/styles.css`）：磁盘文件，运行时由壳加载（host 侧由 host.js 按 `src/host/manifest.dev.js` 逐字节拼接；client 侧经 `notes-src` 按 `src/client/manifest.js` 逐字节拼接后下发）

迭代流：**改磁盘实现文件 → `cordis_run(mode=run)` 重启即可，无需重新 define**。host 拼接产物每次加载会写 `.last-host-load` 心跳文件用于自检（写入点在尾模块 `src/host/index.js`）。

## UI 改动同步约定（硬性）

> ⚠️ **凡改动 UI（`src/client/**` 布局/交互/视觉、`src/styles.css`），必须同步更新交互原型 `design/notes-ui-v2.html`**——原型是 UI 的唯一规格来源（单文件原生 JS + SVG 图标库 + DSH token 配色，浏览器直接打开即可验证），二者不允许出现行为或视觉偏差：
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
> 5. **npm 页面 README = 包内 `packages/dsh-notes-plugin/README.md`，不是仓库根 README**：release 必须执行 `node scripts/sync-pkg-readme.cjs`（根 README 中英双版四文件复制进包并改写 docs 图片路径，check 节 75 逐字节看守；`docs/` 已在 files 白名单内），否则 npm 页面停留在旧文档。

`pluginDir` 由 `host.js` 经 `new Function('harness','pluginDir',src)(harness, PLUGIN_DIR)` 注入，实现内所有路径（`NOTES_DIR`/`CSS_PATH`/`perf-report`/心跳/`notes-src`）都从它派生，移植只需改 `host.js` 顶部一处。

## Host 端（`src/host/**`）

模块树与双出口组装见上方「代码结构」表与 `design/architecture-modular.md` §8；序位 = 标识符可见序（后位可引用前位顶层标识符，禁前位引用后位——节 45 方向断言锁定关键跨模块依赖序），跨域共享态全部是 apply 作用域顶层标识符（§8.1.4），无 store 抽象。

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
- **存储加固（0.4.3+，notes-043-atomic-store）**：全部笔记写路径（含 `kind=sys` 系统根笔记，无特例/无旁路）统一收口 `persistNote` → `fs.writeText`——DSH fs 服务底层即 writeFileAtomic（staging 目录 + temp 文件 + fsync + rename 发布，按 targetKey 加锁），单次写入对崩溃半写天然免疫（盘上只会是完整旧版或完整新版，绝无中间字节）；插件层**不叠加 tmp+rename**（`ctx.fs` 契约无 rename 且沙箱不直连 node fs——沙箱边界是协议红线）。`persistNote` 增 **per-note 串行化链**（`_persistChains[id]`：同笔记并发读-改-写不再交错；跨笔记仍并行；失败不断链、错误原样抛给调用方）；`cache` 为常驻内存权威（写入同步缓存，跨 apply 由磁盘 front-matter 逐字段重建，墓碑重载不复活）。崩溃恢复（半写/墓碑）+ 双包字段口径断言见节 76。
- **内核事件总线（0.4.3+，notes-043-event-bus）**：`onNoteChanged(fn)` 单点注册表（`kernel/persist.js` 内 `notes-events` 标记块，双包同步）——`persistNote`/`_purge` 落盘成功后单点分发 `{ event, note?, id? }`（event ∈ create/update/delete/restore/purge；purge 载荷只带 id，彻底删除不经 persistNote）。监听者按注册序同步执行（**manifest 登记序 = 执行序**，节 45 方向断言看守，替代洋葱包裹的隐式叠层序）；监听者异常逐个隔离（console.error 记录），不影响其余监听者与落盘主流程（零阻塞红线）。graph 增量维护为首个迁移监听者（增量逻辑原样搬入 listener，行为等价 = 节 71/72/73 不改语义全绿 + 节 71.6 总线单测）；injectindex 的 `_create/_update/_delete/_purge` 属 RPC 域包装，不在本总线面。
- **48 个 RPC**：`notes-list/get/get-batch/create/update/quick/quick-instruct/delete/restore/purge/archive/archive-preview/archive-undo/search/css/src/perf/conventions/inject-preview/sessions/active-sessions/workspaces/dispatch/dispatch-done/settings-get/settings-set/export/export-single/import-preview/import/asset-upload/folders/ai-organize/assets-prune/suggest/usage-get/history/history-get/restore-history/memory-guide/schedule-eval/graph/recall-stats/mount/mount-list/ledger-refresh/when-suggest/conflict-check`（when-suggest（0.4.3 验收修复②）：`notes-when-suggest {id}` → LLM 单行 whenToUse 草稿（8s 超时/失败回退 {error}，弹层回退标题）；conflict-check（0.4.5-G，notes-045-conflict-check）：`notes-conflict-check {}` → LLM 两两检测注入中约定（inject=true && injectRole=convention && !deleted && status!=='superseded'（0.4.7-A③），敏感正文打码后参与）的冲突/被取代对，120s 超时（0.4.7-A⑨：手动重操作对齐客户端 LLM 护栏）/非 JSON 回退 {error}，只提名不执行，人工裁决走 notes-update status='superseded'；mount/mount-list：注入索引 §1 挂载行写读（幂等换文案）；ledger-refresh：效用账本手动刷新）（图查询 RPC（0.4.3 内核①，notes-043-graph）：`notes-graph {id?, type?, direction?, rebuild?}`——四类边统一建图（0.4.3+ notes-043-graph-registry：边类型收敛为 src/host/graph.js 内 EDGE_REGISTRY 声明式描述符 {type, extract(note,cache), deadLinkable, resolve:'full'/'id', deadVia/via}，link/mount/softref/dispatch 各一描述符、dispatch 以 deadLinkable:false 承载命名空间永不死链语义；类型清单/RPC type 白名单/byType 键/错误消息均由注册表派生，扩展新边类型 = 追加一个描述符，建图/查询/死链自动生效，节 71 注册表扩展性断言看守）：link（正文 [[双链]]）/ mount（行首列表项挂载行）/ softref（front-matter schedule.runLog 软链）/ dispatch（派发记录，to=session:<id> 命名空间永不死链）；无 id 返回全图概览 {nodes,edges,byType,dead 死链清单,types}，有 id 返回 {exists,out 正向边,back 反向边,counts,byType}（direction=out/in/both 缺省 both，type 单选过滤，rebuild:true 强制全量重建）；建图 = 全库一次扫描（复用 _list，含 kind=log，排除软删）+ onNoteChanged 事件监听增量维护（删节点级联删出边 + 入边置死链、改名旧标题边复估置死、新节点复活 raw 命中死链）；图是派生物可随时重建，增量异常一律降级 built=false 下次查询重建自愈，零改写笔记内容；src/host/graph.js 双清单同名共源单份）（RootNote 托管节框架（0.4.3 内核②，notes-043-rootnote）：src/host/rootnote.js 双清单同名共源单份——RootNoteTpl 声明式模板 {锚点节标题 head / 行格式 lineOf / 排序 newestFirst / 容量裁尾 max / 幂等键 keyOfLine+keyOfEntry / 软链键 linkOf+writeLink}，API = rootNoteEnsure（懒创建+软链回写）/rootNoteRender（节重写纯函数，节外零触碰）/rootNoteAppend（幂等去重+裁尾+persistNote {history:false} 零历史快照）/rootNoteAppendEnsured（组合口）/rootNoteRemoveLine（按幂等键摘行）；runLog 为首个消费者行为等价迁移（schedule-runlog 块 SCHED_RUNLOG_TPL 模板化，节 59 断言不改语义全绿=等价证明），框架行为级断言节 72）（N+1 批量端点（notes-034-batch3）：`notes-get-batch {ids:[...]}` → `{notes:[{id,body,updatedAt}],missing:[...]}`——双链索引等全库正文场景一次拉全，首屏请求数 O(n)→O(1)，证据 n-mut6u356mloa；选型弃 notes-list?includeBodies：消费方语义是按 id 补缺 reconcile，增量只传 stale ids 省传输 + 不动 slim 契约；最小传输面仅正文三字段，已删/墓碑/不存在计入 missing 不报错）（定时派发·执行层（约定即调度，决策 n-muqyk2ve1sqx / n-musewkked3tq）：契约笔记 contractType=dispatch-schedule + front-matter schedule 结构化声明 {at|every, target, action, enabled}（写入闸门红线：at 必须未来 / 轮询≥5min / 目标会话存活 / 未知键拒绝 / 公共写入口 contractType 白名单 '' 或 dispatch-schedule），常驻 30s cron tick（unref 不挂进程 + disposers cleanup 防重载双跑 + 启动补评估 + tick 异常全量吞掉记 lastError），到期复用 `_dispatch` 全链路（派发卡来源标注「定时调度 @标题」），状态三层 = front-matter schedule.lastFiredAt/lastRun{at,status,receiptId}/lastError + 既有 dispatches 历史数组 + dispatch-loop 回执链路；lastFiredAt 先落盘再派发为幂等生命线，单次 at 停机错过启动补发一次 / 轮询错过对齐下周期不追赶；`notes-schedule-eval {now?}` 立即评估一次（now 注入 ISO 时钟供测试/回放，缺省真实时钟））（工作记忆 v0 Phase 1：`notes-memory-guide {op:check/enable/status/disable}` 沉淀引导启用流程（约定笔记方案；r3 车道模型——契约身份 contractType=memory-guide 主识别键 + tag 兼容发现键、check 同类唯一性零写入、enable 无 confirmed 闸门幂等直建、确保「工作日志」文件夹）；kind=log 工作日志与普通笔记同权（可见/可搜/可编辑；注入目录恒不含——0.4.4-E 起目录段唯挂载行源，recall 字段 dormant 读写兼容），唯注入硬关（UI 不提供开关 + host 强制纠正含 kind-only 更新路径），且永不被过期/孤儿清理提名；引导激活期日志自动落 origin=memory-guide 产物溯源；front-matter 预留 logDate/entities/summarizedAt；规格 design/agent-memory-v0.md）（历史版本面板：`notes-history {id}` 版本列表倒序轻量零正文 `[{ts,bytes}]`、`notes-history-get {id,ts}` 取单版正文（预览只读）、`notes-restore-history {id,ts}` 把历史版写回正文——恢复前置自动快照：persistNote 缺省语义先把当前版入 `.history`，恢复动作本身可撤销；client 详情 meta 行「历史」入口（有版本才显示）→ modal 列表/预览/一键恢复）（二期新增 `notes-ai-organize` 按 kind 模板重写正文、`notes-assets-prune` 孤儿资产清理 dry-run 预览 + 白名单删除；P1 回收站：`notes-list` 参数化 `includeDeleted` + `notes-purge` 彻底删除——仅限已软删除笔记，`.md` 与 `.md.bak` 一并移除；ctx.fs 无删除契约，开发版落回墓碑式清空（0 字节占位，全链路视作不存在），静态包经 `fs.processPath` + `node:fs` 真删；P3 单文件导出：`notes-export-single` 按 scope（all/folder/tag）拼接单篇自包含 Markdown，图片 base64 内联，>20MB 告警仍导出；注入预览器：`notes-inject-preview {sessionId?, workspace?}` 纯复用 renderInjected 渲染产物 + 统计（脱敏/预算截断；staleMarked 字段保留恒 0——⚠ 时效标注呈现面随 0.4.4-E catalog 拆除），三档视角——缺省全局 / 传工作区标题（workspace）= 该工作区全部会话注入并集 / 传会话 id 按 injectTo 命中过滤（sessionId 与 workspace 互斥、同传 sessionId 优先），预览不更新 lastInjectChars；整理建议器：`notes-suggest` dry-run 零写入返回四类候选——archiveCandidates 速记组（内聚复用 `_archivePreview` 同款结构）/ staleCandidates 过期未引用（kind=note/link 且超 staleDays 且 useCount===0，遥测保护）/ orphanCandidates 孤儿 / logHygieneCandidates 日志卫生（工作记忆 v0：超 7 天周聚合 + 超 90 天月聚合提名，只提名不执行）（无 [[双链]] 出链与反向链接、inject=false、useCount=0、status=active 的普通笔记，排除速记与归档产物防误伤，上限 20），只提名不执行，client 三段式 modal 直达归档预览 / confirm 后批量软删 / 孤儿仅展示逐条跳转；LLM 用量统计：`notes-usage-get` 返回 { today, week, month, allTime, byFeature, estimatedTokens, exactTokens, calls }——llm-usage 标记块计量包装挂 3 个 llm 调用点（classifyTopic/extractInstruction=classify、_aiOrganize=organize，streamMetered 捕获 usage chunk 真实值优先、缺省字符估算 1.6 系数兜底），usage.json 独立于 settings.json 落盘（内存累积 + 5s 防抖 + 卸载 flush），settings 新键 `usageBudgetMonthly` 月度预算提醒阈值（tokens/月，0=关闭，超预算仅 client toast 不阻断））（统一召回遥测 RPC（0.4.3+ 卡⑫，notes-043-inject-receipt）：`notes-recall-stats {sinceDays?}`——五通道（inject 装配 / mount 任务挂载=_dispatch 派发 / search 自由检索 / get 按需取 / catalog 目录——0.4.4-E 随「目录补充行」拆除退役，通道结构 dormant 保留、永不再产事件）× 交付/使用事件流水，低频通道（inject/mount；catalog 已退役 dormant）记原始回执行 {ts,channel,ids[],session?}（装配类签名去重防写盘风暴）、高频通道（search/get）记日聚合行 {day,channel,id,count} 行级 upsert 幂等不爆行；RootNote 框架新建「召回遥测（自动）」根笔记（kind=sys + recall=false + inject 红线锁 + 永不建议器提名，settings.recallNoteId 软链，容量 400 裁尾，{history:false} 零历史快照）；按通道分列 {delivered, deliveries, used, uses, rate}（rate=交付后窗口内被 note_get 取用的去重比例，get 通道纯使用信号 rate=null）；账本 §2 旁挂分通道召回率行（与双链引用口径不混算）；埋点全部静默降级零阻塞，src/host/recall.js 双清单同名共源单份，节 78 看守）
- **3 个 Agent 工具**：`note_search`、`note_get`、`note_manage`（七 action：create/list/update/delete/restore/archive/dispatch）

### 约定注入（T2.3）

`systemPrompt.context({ name:'notes:workspace-conventions', order:130, text })` 注册动态 prompt 上下文。`text` 是同步函数（不能 await），从 `cache` 读。

匹配规则：`n.deleted` 排除；`inject !== true` 排除（旧文件无 `inject` 字段时 `noteFromParsed` 回退到 `tags` 含 `convention`）；`injectTo` 数组多选过滤（`[]`=所有会话（缺省） / 会话短 id=仅限这些会话；存量 `global`/`workspace` 值一律按所有会话容错，不迁移）。注入无「工作区」维度——笔记无归属，只看会话短 id（取 `agents.currentInitiator()` 的 sessionId 前 8 位）。

> ⚠️ 坑：`systemPrompt.context` 的 `text` 必须返回 `string`，返回 `undefined` 会让 DSH assemble 时 `undefined.indexOf` 崩溃（run 失败）。无匹配时返回 `''`。

**注入价值信号行（0.4.3 验收修复⑥，notes-043-metrics-present，三层架构收口之呈现层）**：`renderInjected` 目录段尾部提示行区追加 `_valueSignalLine(dirIds)`——数据源 `_telemetryCache.ledger` 账本快照（同步读内存权威，零磁盘零 await；存储未加载/无快照/无命中 → 整行静默省略）；快照原子性 = 提及 id 过滤到存活目录行 id 集（预算省略后挂载行——0.4.4-E 起目录段唯挂载行源，构造性同版本，约定桶全文条目不出现；节 78 断言④看守）；纯读零写（render→record 顺序不变，断言⑤）；`（本周引用：id×次数、Top3｜零引用候选：首条｜截至 HH:MM）` ≤200 字符截断。注入管理面板挂载区统计行（client `modals/inject-manager.js` 与 app 同名模块双变体）：复用 `notes-recall-stats` 只读 RPC（零新通道），紧凑行「挂载 N｜本周引用 Top｜零引用 M」+ 点开全量分通道召回率（`injMgrChanLine`），无快照整区省略；i18n 键 `inj.mntStats/mntStatsTip`（覆盖卡 D 清单 81 条看守）。用途分级红线：信号行/统计行只服务呈现，正确性判断与清理裁决必须走 `notes-recall-stats` 全量或人工。§2 语义退役收尾：索引 v2 预设零 §2（`INJECT_INDEX_BODY` = 说明块 + §1 单节），存量索引 §2 由卡⑤ `_ledgerStripS2` 一次性幂等摘除（节 74.1 逐字节断言 + 节 78.7 预设锚复核）。

### 任务派发

- `agents.roots()` 拿顶层 live agents（天然排除子 agent）作活跃会话列表
- `_dispatch` 共享函数：`_get` 笔记 → `agents.get(sessionId)` 校验活跃 → `agent.send(msg, 'next-turn', true)` 注入 → 正文追加「已派发→会话X @时间」
- `note_manage dispatch` 无 `targetSessionId` 时返回活跃会话列表（`needTarget:true`）

## Client 端（`src/client/**`）

模块目录按 `src/client/manifest.js` 拼接为单文件下发（kernel → modals → popovers → panels 序位 = 标识符可见顺序；禁横向引用，跨域走 kernel bus/store——规格 `design/architecture-modular.md` §4.2）。编辑器内核 v3 标记块是 `src/shared/editor-kernel.js` 物理单份，拼接时纳入。

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

## app 页（`src/app/**` → `packages/dsh-notes-plugin/app.html`）

- 半独立全窗口笔记页（`/dsh-notes-app` GET 路由下发）：原生 DOM 实现，与 React 面板两态并存、功能面大致平行但**不逐项等价**（页面专属 topbar/主题切换/无标题直建；面板专属双入口/标题 modal/帮助气泡）——两态不抽象（architecture-modular.md §4.3）
- 源在 `src/app/**`（域结构镜像 client：kernel/panels/modals/popovers + shell 页面壳），改源后跑 `node scripts/concat-app.cjs`（或 `build-dist.cjs` 一并）拼回单文件 `app.html` **写盘提交**；check.js 读产物做锚点断言，另有可复现断言兜底防忘跑
- 与 client 的物理共源仅 `src/shared/editor-kernel.js`（编辑器内核 v3 标记块，§4.3 唯一例外）；其余两态同步纪律不变：check.js 四端锚点断言 + 原型 `design/notes-ui-v2.html` 回写

## 新增功能开发规范（模块往哪放）

P1+P2 模块化落地后，一切改动都在 `src/**` 模块源上进行，**禁止手工编辑四产物**（`lib/client.js` / `lib/styles.css` / `app.html` / `index.mjs` 全部由组装器/构建脚本生成，check.js 可复现断言兜底）。新功能按下面落点表选文件：

### 新 RPC（host 侧）

1. **选域**：按功能归属放进现有域模块——笔记 CRUD → `src/host/notes.js`；文件夹 → `folders.js`；历史/回收站 → `history-trash/`；归档/整理建议/日志卫生/工作记忆 → `memory.js`；注入渲染/设置面 → `inject.js`；会话元数据与派发 → `dispatch.js`；检索 → `search.js`；导入导出/资产 → `transfer.js`；LLM → `llm/`；基础设施（handle 包装/perf/notes-css/notes-src 下发）→ `server.js`；工具层 → `index.js`（尾模块）。确实不属于任何域才新建模块文件。
2. **双包形态**：开发/发布无差异 → 单文件、两 manifest 同名引用（先例：`search.js`、`inject/img-path-hint.js`）；有设计内差异（路径拼接/删除通道/webServer 路由/一次性迁移等，architecture-modular.md §8.1.5 清单）→ 建 `<name>.js` + `<name>.dist.js` 变体对，两 manifest 各自登记（§8.4.3 红线 9：禁止第三份拷贝）。
3. **登记 manifest**：在 `src/host/manifest.dev.js` / `manifest.dist.js` 按序位插入——**序位 = 标识符可见序**，消费方必须排在定义方之后（节 45 方向断言锁定关键跨模块序位）；manifest 注释禁单引号。
4. **配套断言**：带数字的 RPC 面断言（如「40 个 RPC」「host 应用成功」）同步 +1；新行为断言加进对应 check 节或新建节。
5. 改完先 `node check.js --only=<相关节>` 聚焦，再全量收尾。

### 新 client UI（modal / popover / panel）

1. **落点**：modal → `src/client/modals/<name>.js`（一文件一个：open 态 + 数据加载 + 确认动作 + JSX 片段）；浮层 → `popovers/`；面板子域 → `panels/panel/`（唯一装配点 `panels/panel/index.js`）。
2. **登记 manifest**：`src/client/manifest.js` 域内按序插入。**依赖红线：modals/popovers/panels 只依赖 kernel，禁横向引用**——modal 需要别的 modal 的数据（如设置卡开注入预览）经 kernel bus/store 中转，不许直接调对方的 open 函数；序位即可见性，kernel 先于一切。模块头部按 `// provides:` / `// needs:` 注释契约声明出入参。
3. **状态**：modal state 挂 kernel store 的命名空间切片（`store.modal.<name>`），不在装配组件里加并列 useState；会话级状态按 sessionId 分桶（静态包进程单例约束，见「发布版静态包」节警告）。
4. **同步纪律（硬性）**：UI/视觉/交互改动必须同步原型 `design/notes-ui-v2.html`（见上方「UI 改动同步约定」）；四端锚点断言（开发版 client / 发布包 lib/client.js / app.html / 原型）随功能补齐；app 页对应功能改 `src/app/**` 后跑 `node scripts/concat-app.cjs`。

### 新测试节

`check/sections/<节号>-<名称>.cjs` 一文件一节：`module.exports = { id, title, run(H, S) }`，节首从 `H`/`S` 解构依赖、节末 `Object.assign(S, {...})` 导出本节造数；**0.4.6-I 起注册零改动 check.js**——`check/discover.cjs` 自动发现 `check/sections/*.cjs` 并按数值元组排序注册（文件名开头数字前缀按 `-` 分段转数值元组逐段数值比较，如 `1-2` → [1,2]；互为他方前缀时短者在前；等值/无数字前缀按文件名全串字典序兜底）。**命名即节序**：插节用子号先例（`8-5-`/`35-5-`），文件名首段数字必须等于 title 首号（节 100 常驻断言看守排序契约 + 注册契约 + 反硬编码锚）。代表性断言加进 `check.js` 顶部 `CORE` 名单（名单名与断言名逐字一致，收尾命中校验兜底改名/删除）。

## 笔记文件格式

见 [README.md](README.md#数据位置)。完整字段：`id/title/topic/workspace/tags/kind/status/inject/injectTo/createdAt/updatedAt/sessionId/cwd/mergedFrom/archivedAt/deleted`。

## 测试

测试套件为模块化结构：`check.js`（runner：模式解析/CORE 名单/节注册表/总结）+ `check/helpers.cjs`（共享设施）+ `check/discover.cjs`（节注册自动发现，0.4.6-I）+ `check/sections/*.cjs`（节断言体，自动发现注册、零改动 check.js）。断言总数随版本演进（拆分自原单文件时逐字节迁移，语义零变化；最新数以全量运行输出为准）。

```bash
node check.js                 # 全量回归（默认，1029 条；verifier/发布前用）
node check.js --core          # 核心快检：143 条主链路代表性断言，秒级（worker 自测用）；也可用 CHECK_CORE=1
node check.js --only=39,42    # 分节运行：只执行选中节的断言（逗号分隔节号或节名前缀）；也可用 CHECK_ONLY=39,42
node check.js --core --only=40  # 可组合：选中节内再按 CORE 名单过滤（此时名单命中校验自动跳过）
```

`--only` 匹配规则：节号精确（`42`）/ 节标题前缀（`42.`、`1.5`）/ 去编号后的节名前缀（`工作记忆`）。节间 mock 实例与造数代码**全部照常执行**（与 `--core` 同一原则），选中节看到的共享状态与全量完全一致，只跳过非选中节的 `t()` 断言体——因此 `--only=N` 可独立运行任意节，无需关心上游依赖。

**两档约定（硬性）**：

- **worker 自测跑 `--core`**：核心名单覆盖各主链路代表性失败面——RPC 面/缓存/quick 合并/搜索/软删/归档三连（preview→archive→undo）/工具路由/约定注入+脱敏/injectTo/派发+闭环/静态包全链路（迁移+资产路由+归档+perf）/设置持久化/构建可复现/app.html 可复现/发布面零 BOM/编辑器内核 round-trip+XSS/文件夹/目录注入/资产上传/导入导出/三端内核同步/预算截断/遥测计数/注入预览/整理建议/组合过滤/injectEver/img-path-hint/快照式历史引擎（触发+去重+零读盘红线/导入导出适配）。
- **verifier 验收 / 发布前跑全量**（无参），并 `node check.js > check-result.txt` 刷新基线存档；`--core` 模式不刷新 check-result.txt。验收某个任务的相关节时可先 `--only=<节号>` 快速聚焦，再以全量为准。
- 核心名单 = `check.js` 顶部 `CORE` 集合，按断言名精确匹配。**新增/改名断言后跑一次 `--core`**：收尾会校验名单全命中，未命中（改名/删除）计 1 个 failed，防静默漏检（`--only` 组合时跳过该校验——子集注定不全命中）。核心与非核心断言共享同一套 mock 实例与造数流程（节间 setup 两模式都照常执行，只跳过 t() 断言体），断言语义零差异。
- **发布面零 BOM 断言（事故防御，节 1）**：扫描壳入口 + 发布包全发布面共 11 个文件（根 `package.json`/`host.js`/`client.js`/`README.md` + 包内 `package.json`/`index.mjs`/`app.html`/`README.md`/`cordis.patch.yml`/`lib/client.js`/`lib/styles.css`）首 3 字节非 EF BB BF——0.3.x 发版期真实事故：编辑器给 `package.json` 写入 BOM，DSH 解析失败**静默 skip 整个插件**（零报错）。编辑这些文件务必保持无 BOM UTF-8；新增发布面文件时把路径补进 `check/sections/1-static.cjs` 的 surfaces 清单。

内存 mock（`fs`/`llm`/`agents`/`sessionPersistence`/`workspaceRegistry`/`systemPrompt`），不触碰真实笔记。覆盖：语法、host 全链路（create/list/缓存/update/quick 合并+异步分类/跨 session/search/delete/restore/archive）、注入范围（global/workspace/会话/旧文件兼容）、会话名与子 agent/归档过滤、任务派发、工具 schema、client 结构断言；第 17 节覆盖发布版 host（`packages/dsh-notes-plugin/index.mjs`），第 18 节覆盖发布版 client（`lib/client.js`：形态/API 面/UI 功能面/4 个 Slot 注册/React 树可构建/卸载清理/构建可复现）；节 45 锁定 host 模块终态（manifest 序位 + 共源/变体登记 + 跨模块方向断言 + notes-src 死引用清零）。

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
