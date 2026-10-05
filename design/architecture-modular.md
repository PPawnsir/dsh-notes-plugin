# 模块化架构 spec（client 侧 + host 侧 P2）

> 状态：client 侧（P1，§1–§7）已按本文落地（`src/client/**` + `src/app/**` + `src/shared/` + 双拼接器）。host 侧（P2，§8）亦已全部落地：P2·2 组装器恒等起步 → P2·3 kernel 抽出 → P2·4 RPC 核心域抽出 → **P2·5 inject/memory/server 拆分 + 收口（host-impl 单体系谱终结，check.js 587 断言绿）**。
> 范围：§1–§7 = client 侧（已执行）；§8 = host 侧（已执行；§8.3 为撰稿时计划清单，实际落地形见 §8.3 末「as-built」注记与 DEVELOPMENT.md 代码结构表）。
> 口径：本文全部模块清单来自对 `src/client-impl.js`（3902 行）与 `packages/dsh-notes-plugin/app.html`（3620 行）的实盘通读，不凭想象；行号为撰稿时实值，漂移以代码为准。§8 同理：行号锚点来自 host-impl.js（3376 行）/ index.mjs（3718 行）实盘，并经 `scratch/p2-host-concat/` 锚点解析器机械复验。
> 收官复核（2026-10-04，notes-arch-docs-sync）：§6 步骤 A–G 与 §8.5 步骤 H-A–H-D 逐项完成勾选见各节（✅ 标记）；DEVELOPMENT.md 已对照终态全面同步（模块树实景 / 组装器跑法 / 新增模块开发规范 / BOM 防御断言），README 技术性偏差清零；`node check.js` 全量 587/0 绿（`--core` 108 条名单全命中）。

## 1. 背景与目标

`src/client-impl.js` 已长到 353KB / 3902 行，其中 `FloatingPanel` 一个组件占 3160 行（543–3703），17 个 modal、2 个右键菜单、5 个浮层全部寄生在它的 JSX 尾部与 state 堆里。继续堆功能会让「改一个 modal 先读三千行」成为常态。

目标：**源码模块化，产物单文件**。把单文件拆成 `src/client/**` 模块目录，由组装器按清单逐字节拼回单文件形态；运行时链路（`new Function` bootstrap / ModuleLoader factory）与全部发布产物保持逐字节等价，check.js 514 条断言不删不改语义。

非目标：不引入打包器/ESM/构建链；不做 React/DOM 两态统一抽象（§4.3 裁决）；host 侧不在本期动（§8）。

## 2. 现状实盘盘点

### 2.1 文件全景与装配关系（今日事实）

```
开发版（bootstrap 壳形态）                    发布版静态包（packages/dsh-notes-plugin/）
─────────────────────────────              ──────────────────────────────────────
host.js      (25 行壳)                       index.mjs        ← 手工同步「标记块」（非生成）
client.js    (37 行壳)                       lib/client.js    ← scripts/build-dist.cjs 生成
src/host-impl.js   (237KB)                   lib/styles.css   ← build-dist.cjs 复制（LF 归一）
src/client-impl.js (353KB/3902 行)           app.html         ← 手工维护（DOM 版，非生成）
src/styles.css     (72KB)                    package.json / cordis.patch.yml
```

- 开发版 client 链路：`client.js` 壳 → `notes-src` RPC 拉 `src/client-impl.js` 全文 → `new Function('React','styles','host', src)` 执行（800ms×15 重试）。
- 发布版 client 链路：`scripts/build-dist.cjs`（265 行）抽 `apply(ctx)` 函数体 → 6 组机械转换（services-header / styles-block / perf-timer / perf-wrap / host-call→rpc / rpc-helper，各带计数断言，命中数≠期望即中止）→ 包进 `window.__ModuleLoader__.load({ id:'dsh-notes-plugin', factory })` 壳 → `lib/client.js`（3835 行）。
- `app.html` 是**手工维护的第二份实现**（原生 DOM，`rpc()` fetch 封装，3620 行），经 `index.mjs` 的 `GET /dsh-notes-app` 路由下发；它不从任何东西生成。
- host 侧 `index.mjs` 与 `src/host-impl.js` 靠「标记块」手工双份同步（dispatch-loop / export-single / img-path-hint / llm-usage / folder-tree-helpers / list-union-defense / history-engine / sensitive-helpers 等，check.js 逐字节断言）。

### 2.2 React 版 `src/client-impl.js` 行级地图

| 行区间 | 内容 | 归属域 |
|---|---|---|
| 1–8 | `return { inject, apply(ctx) }`、服务接入（`ctx.timer/sessions/workspaces` + `ctx.get('slots')` 守卫） | kernel |
| 9–16 | disposers / listeners / noteRefreshListeners / panelOpen / currentSessionId / toastEmit / showToast(msg,act) | kernel |
| 17–33 | 入口双模式 entryMode header/fab + fabPos + entryListeners + localStorage `dsh-notes-entry` | kernel |
| 34–54 | 文件夹折叠态持久化（PINNED_KEY / pruneFoldersExpanded）+ 侧栏宽度持久化（SIDE_W_KEY / clampSideW） | kernel |
| 56–68 | PAGE_SIZE / KIND_LABELS / KIND_TEMPLATES（四端一致断言对象） | kernel |
| 69–108 | 筛选中心模型：FILTER_STATUS / FILTER_KINDS / FILTER_SORTS / FILTERS0 / loadFiltersState / matchFilters（check.js 语义回归提取对象） | kernel |
| 109–119 | shortSid / isDispatchDone / fmtBytes / fmtHistTs / fmtTok / notify / notifyNotesChanged | kernel |
| 120–167 | `e = React.createElement`；IC 图标集（33 个 e() 结构）+ I(name,size,cls) helper | kernel |
| 168–436 | **双模式编辑器内核 v3 标记块**（`// ===== 双模式编辑器内核 v3` … `// ===== end …`）：esc / assetDisplaySrc / WIKI_RE+extractWikiTargets+wikiLinksTo / unesc / renderMarkdown 族（inline/splitTblRow/parseTblDelims/isTblStart）/ escapeMd+serializeInline/serializeList/serializeInlineWrap/serializeRich / normMd / DEG_RULES+HTML_BLOCK_LINE+analyzeMarkdown / sanitizeFragment | kernel（**三端逐字节共源**，check.js §25 断言） |
| 437–457 | perf 计数器 + host.call 包装劫持 + longtask PerformanceObserver + 30s `notes-perf` 上报 | kernel |
| 458–468 | loadCss / scheduleCssRetry（`notes-css` RPC + styles.insert，10 次重试） | kernel |
| 469–475 | drag(move, done) 通用拖拽 | kernel |
| 476–488 | **HeaderBtn**（slot `conversation.session.header.actions` #40） | panels/entries |
| 489–541 | **FabEntry**（slot `shell.overlay` #199，可拖拽气泡入口） | panels/entries |
| 542–3703 | **FloatingPanel**（slot `shell.overlay` #200）——主面板，内部子域见 §3.2 | panels |
| 3705–3898 | **SelectionCapture**（slot `shell.overlay` #201）——选区速记卡 + **全局 toast 宿主**（toastEmit 在此挂载，3809 行动作按钮延时 4200ms） | panels/selection |
| 3899–3902 | ctx.effect 统一清理 + ready 日志 | kernel |

### 2.3 FloatingPanel 内部子域（543–3703，未来 panels/panel/ 的拆分单元）

| 子域 | 内容 | 行区间（约） |
|---|---|---|
| state 堆 | ~90 个 useState/useRef：编辑字段、搜索、筛选、文件夹、17 个 modal 开合态、派发、设置卡、wiki 索引、编辑器 v3 运行时 | 543–807 |
| effects 群 | 面板位置持久化、会话轮询（titlesPending 1.5s）、浮层外点关闭、搜索 250ms 防抖、injMgr 防抖、分页重置、~25 个 state→ref 镜像 | 808–928 |
| 键盘流 | 单 document keydown：Ctrl+K / Alt+N / Ctrl+/ 、j/k/↑↓/Enter、**Esc 分层栈**（imgModal→linkModal→重命名→文件夹输入→右键菜单→筛选→各 modal→设置卡 flush→多选→清搜索→搜索框还焦列表→关面板，941 行单行长链） | 929–955 |
| 窗口 chrome | titlebar 拖拽、八向 resize（680×420 下限）、splitter 侧栏宽（clamp 200px–60%，双击重置） | 956–994 |
| 数据加载 | loadNotes（includeLogs 联动）/ loadFolders（prune 陈旧 id） | 995–1009 |
| wiki 双链 | resolveWikiTarget / ensureWikiIndex（惰性小批量补齐）/ bumpWikiBody / jumpToWikiTarget / 反向链接推导 | 1010–1052, 2821–2837 |
| 笔记 CRUD | selectNote / openNewNote+doCreateNote / doSave（900ms 防抖自动保存，edLoading 防竞态）/ doDelete | 1053–1150 |
| AI 整理 | doAiOrganize / applyOrganizedBody / undoAiOrganize（一次撤销栈） | 1151–1190 |
| 历史版本 | probeHistCount / openHistory / selectHistVersion / applyRestoredBody / doRestoreHistory | 1191–1249 |
| 右键菜单 | openCtxMenu / ctxSetStatus / ctxMoveToFolder / ctxCreateFolderMove | 1250–1272, 1413–1525 |
| 文件夹树 | CRUD + reorder + reparent + 双向拖拽（note→folder / folder→parent / unfiled 落点）+ 折叠态 | 1273–1314, 1327–1412, 1425–1493 |
| 编辑器交互 | setRoleSeg / toggleSens / toggleScope / switchMode / syncFromRich / scheduleRichSync(900ms) / scheduleDegAnalyze(450ms) / keepSel+restoreSel / toolbarAction / updateToolbarState / insertSanitizedHtml / compressImageData(>1MB 转 JPEG) / pickImageFile / openImgModal+doUploadImage / insertImageMd / doInsertLink | 1530–1855 |
| 会话/工作区 | loadActiveSessions / loadWorkspaces / openDispatch | 1857–1873 |
| 设置卡 | openSettings / maybeToastUsageBudget / settingsSetQuiet / setPersistMerge / 9 个单项 saveSettings*（Llm/Catalog/Stale/MaxDepth/Budget/UsageBudget/LlmManual/LogWeek/LogRetention）/ saveSettingsAll / restoreSettingsAll / flushSettingsPending / closeSettings（dirty=setSnap+setInflight 双轨） | 1874–2096 |
| 工作记忆 | memScopeResolve / openMemEnable / doMemEnable / doMemDisable / memViewNote | 2097–2145 |
| 数据导出 | openExport+doExport / openSExport+doSExport / openImport+doImportPreview+doImportExecute | 2146–2216 |
| 派发 | doDispatchConfirm / doDispatchDone | 2217–2258 |
| 归档 | afterArchiveCleanup / openArchive / doArchiveConfirm / doArchiveUndo（toast 撤销） | 2259–2300 |
| 资产清理 | openPrune / doPruneConfirm | 2301–2322 |
| 回收站 | openTrash / loadTrash / restore / purge / 批量 / 行内预览 | 2323–2412 |
| 注入预览 | openInjectPreview / loadInjectPreview（三档视角） | 2413–2430 |
| 注入管理 | openInjectManager / loadInjectManager / injMgrRole / injMgrScopeLabel / doInjMgrSet / 批量 | 2431–2484 |
| 整理建议 | openSuggest / loadSuggest / suggestGoArchive / suggestViewNote / doSuggestBatchDelete | 2485–2523 |
| 多选合并 | toggleSelMode / toggleSelId / openMerge / doMergeConfirm / doSelBatchDelete | 2524–2599 |
| 渲染 helpers | highlight（`<mark>` 防 XSS）/ folderName / relRank / onListScroll（距底 40px）/ injectScopeLabel / renderNoteRow / renderFolderNode（递归）/ jumpToTopicFilter | 2600–2820 |
| JSX | editorEl（面包屑/meta chips/工具栏/rich+source/反向链接/底栏）2850–2980；根 return（titlebar/help 气泡/两栏 app/resize/error）2981–3052；**17 个 modal + 浮层** 3053–3700 | 2850–3701 |

### 2.4 modals 实盘点（17 个，全部在 FloatingPanel JSX 尾部，复用 `dsh-notes-settings-mask/modal` 风格）

| # | modal | state 锚 | 行区间（约） | 数据 RPC |
|---|---|---|---|---|
| 1 | 派发待办 dispatch | dispatchOpen | 3053–3078 | notes-dispatch / notes-active-sessions / notes-workspaces |
| 2 | 设置卡 settings | settingsOpen | 3079–3199 | notes-settings-get/set / notes-usage-get |
| 3 | 工作记忆引导 memory-guide | memOpen | 3200–3234 | notes-memory-guide |
| 4 | 导出全部 export | exportOpen | 3235–3245 | notes-export |
| 5 | 单文件导出 export-single | sExportOpen | 3246–3278 | notes-export-single |
| 6 | 导入 import | importOpen | 3279–3312 | notes-import-preview / notes-import |
| 7 | 插入图片 image | imgModal | 3313–3333 | notes-asset-upload |
| 8 | 插入链接 link | linkModal | 3334–3347 | —（纯前端） |
| 9 | 归档预览 archive | archOpen | 3348–3385 | notes-archive-preview / archive / archive-undo |
| 10 | 资产清理 prune | pruneOpen | 3386–3408 | notes-assets-prune |
| 11 | 回收站 trash | trashOpen | 3409–3456 | notes-list{includeDeleted} / restore / purge |
| 12 | 整理建议 suggest | suggestOpen | 3457–3515 | notes-suggest |
| 13 | 注入预览 inject-preview | injectPreviewOpen | 3516–3548 | notes-inject-preview |
| 14 | 注入管理 inject-manager | injMgrOpen | 3549–3614 | notes-list / notes-update |
| 15 | 历史版本 history | histOpen | 3615–3641 | notes-history / history-get / restore-history |
| 16 | 多选合并 merge | mergeOpen | 3642–3650 | notes-archive（groups 白名单） |
| 17 | 新建笔记 newnote | newNoteOpen | 3651–3700 | notes-create |

浮层族（非 modal 同登记）：笔记右键菜单 ctxMenu、文件夹右键菜单 folderMenu、注入范围浮层 scopeOpen、筛选 popover filterOpen、排序菜单 sortOpen、帮助气泡 showHelp、多选操作条 selbar。

**modal 互斥惯例**（实盘）：设置卡开任何数据 modal 前先 `setSettingsOpen(false)`（「modal 不叠 modal」注释共 11 处：8 个 open* 入口 + 设置卡 3 行内注释）；Esc 栈顺序即开合优先级；mask 点外关闭。

### 2.5 DOM 版 app.html 实盘点（3620 行）

- `<style>`：token 色板（`:root` + `html[data-theme=dark/light]`，与原型 `notes-ui-v2.html` **逐字节一致**，check.js §1 断言）+ 全套样式（与 styles.css 不同源——app 页独立一份）。
- `<svg>` symbol 库：`i-*` 33 个（与 React 版 IC 的 33 个大体同集，path d 一致；差异=app 页多出页面专属 i-refresh/i-home，缺面板专属 tag/swap；check.js 断言 path 串）。
- `<script>` 结构：rpc() fetch 封装 → 全局 state 变量 → 筛选模型（与 React 版同语义）→ **编辑器内核 v3 标记块（与 client-impl.js 逐字节一致）** → helpers（icon/fname/folder*/toast/fmt*）→ render* 函数族（renderTree/renderEd/renderMeta/renderCrumb/renderFilterBar/renderFilterPop/renderSortMenu/renderSelBar/renderBacklinks/renderScopePanel/renderDispatches/renderEdFoot…）→ 编辑器交互族（bindEditorArea/bindRich/switchMode/toolbarAction/compressImageData…）→ modal 族（openModal/closeModal/modalErr 通用挂载点 `$('modalHost')`/`$('ctxHost')` + 各 render*Modal）→ 选区速记卡（showCap/saveCap/closeCap）→ splitter → 主题切换。
- 页面专属（面板没有）：topbar（logo/标题/主题切换 btnTheme/「返回 DSH」入口）、新建笔记**无标题 modal**（btnNew 直接建，以当前 view/filters 为种子，2161–2175）、独立 localStorage key 族（`dsh-notes-app-*`）。
- 面板专属（app 页没有）：entryMode header/fab 双入口、新建笔记标题 modal、帮助气泡、面板拖拽/resize。

结论：两态功能面大致平行但**并不逐项等价**，同步纪律由 check.js 的标记断言逐点维持，而非整体镜像。

### 2.6 check.js 断言矩阵（迁移必须全部保住的同步红线）

| 断言对象 | 机制 | 断面 |
|---|---|---|
| 编辑器内核 v3 三端逐字节一致 | `grabKernelBlock` 标记区间（去公共缩进比较），§19/§25 | client-impl.js / app.html / lib/client.js |
| token 色板四处同步 | 色板块逐字节比较，§1 | 原型 / app.html（及 styles 链路） |
| KIND_TEMPLATES 四端一致 | 文本断言 | host-impl / index.mjs / app.html / 原型 |
| styles.css ↔ lib/styles.css | 逐字节（LF 归一） | build-dist.cjs 复制 |
| 发布包净化 | build-dist 硬断言：产物任何位置（含注释）禁含 `host.call`/`styles.insert` | lib/client.js |
| host 标记块双包一致 | grab 标记区间逐字节 | host-impl.js / index.mjs |
| UI 结构锚点 | ~300 条 class 名/文案/RPC 调用点串的 `indexOf` 断言（四端同步组） | client-impl / lib/client.js / app.html / 原型 |
| 内核行为级 | round-trip 逐字 / XSS / 降级 / 表格回吐（eval 提取内核函数跑用例） | 同上三端 |

关键事实：**这些断言读的都是产物文件**（client-impl.js 单文件、lib/client.js、app.html），不是模块源。因此「产物逐字节等价」一条红线即自动保住全部锚点断言。

## 3. 模块切分清单（目标态）

### 3.1 目录布局

```
src/
  client/                 ← React 态唯一源码（拼接输入）
    manifest.js           ← 模块清单（有序数组，唯一组装依据）
    kernel/               ← 无 UI 域
      bootstrap.js          服务接入/disposers/ctx.effect 清理
      bus.js                listeners/noteRefreshListeners/entryListeners + showToast/toastEmit
      state.js              panelOpen/currentSessionId/entryMode/fabPos + store（§4.4）
      persist.js            localStorage 四件套（entry/folders-expanded/sideW/filters+panel-state）
      constants.js          PAGE_SIZE/KIND_LABELS/KIND_TEMPLATES/FILTER_*/FILTERS0/matchFilters
      format.js             shortSid/isDispatchDone/fmtBytes/fmtHistTs/fmtTok
      icons.js              e/IC/I
      perf.js               perf 计数器/host.call 包装/longtask/30s 上报
      css-loader.js         loadCss/scheduleCssRetry
      drag.js               drag()
    panels/
      entries/header-button.js
      entries/fab.js
      selection/capture.js    选区速记卡 + toast 宿主
      panel/chrome.js         titlebar/resize/splitter/help 气泡
      panel/sidebar.js        brand/搜索框/筛选中心控制行/side-foot
      panel/tree.js           文件夹树逻辑 + renderNoteRow/renderFolderNode/分页
      panel/editor.js         meta chips/双模式交互/自动保存/面包屑/反向链接/底栏
      panel/wiki.js           索引/解析/跳转
      panel/keyboard.js       键盘流（Esc 栈）
      panel/search.js         两段式搜索
      panel/index.js          FloatingPanel 装配（state 堆编排 + 根 JSX）
    modals/                 ← 每文件一个：open 态 + 数据加载 + 确认动作 + JSX 片段
      dispatch.js settings.js memory-guide.js export.js export-single.js
      import.js archive.js prune.js trash.js suggest.js
      inject-preview.js inject-manager.js history.js merge.js
      image.js link.js newnote.js
    popovers/               ← 浮层族
      ctx-menu.js folder-menu.js scope.js filter-pop.js sort-menu.js help.js selbar.js
  shared/
    editor-kernel.js        ← 编辑器内核 v3 标记块全文（两态物理共源，§4.3 例外）
  app/                    ← DOM 态唯一源码（app.html 组装输入；本期镜像拆分或恒等整搬，§6 步骤 F）
    manifest.js
    ...（镜像 React 态域结构：kernel/panels(tree,editor,settings…)/modals/…）
  host-impl.js            ← 本期不动（P2，§8）
  styles.css              ← 本期不拆（check.js 逐字节断言；CSS 分块留待后续专项）
```

### 3.2 模块职责契约

- **kernel 无 UI**：不引用任何 `dsh-notes-*` class 的结构渲染；可产出 e() 原语（icons.js 例外——它是纯图标结构，视为 kernel）。
- **modals/panels 只依赖 kernel**：经 manifest 序位隐式共享同一作用域（§4.2），**禁止横向 import/引用**——modal 需要别的 modal 的数据（如设置卡开注入预览、整理建议跳归档），经 kernel 的 store/bus 中转，不许直接调对方的 open 函数。
- **popovers 同 modals 规则**。
- **panels/panel/index.js 是唯一的装配点**：各子域导出「注册函数」（接收 store/kernel，返回 JSX 片段或挂监听），index.js 按序调用。子域之间同样禁横向引用。
- 每个 modal 模块的 state（open/pending/data）挂在 store 的命名空间切片下（如 `store.modal.trash`），不再是大组件内并列 useState——这是拆分后能「逐文件读懂」的关键，也是对现状唯一的结构改动（见 §4.4 裁决）。

## 4. 组装契约

### 4.1 双出口（+app 出口）规则

一个拼接器 `scripts/concat-client.cjs`（新），两个已知出口 + 一个 app 出口：

| 出口 | 输入 | 产物 | 时机 |
|---|---|---|---|
| 开发版下发 | src/client/** + src/shared/editor-kernel.js | 单文件文本（`return {inject, apply}` 形态） | `notes-src` RPC 运行时拼接（host 侧按 manifest 读盘拼接，LF 归一） |
| 发布版 | 同上 | `lib/client.js` | `build-dist.cjs` 改为先调拼接器拿单文件，再走现有 6 组机械转换（转换规则/计数断言全保留） |
| app 页 | src/app/** + src/shared/editor-kernel.js + 色板块 | `app.html` | `scripts/concat-app.cjs` 构建时拼接（写盘提交，check.js 照读产物） |

拼接语义：**逐字节串接，零插入零改写**。拼接器不加 banner、不加行、不动缩进；模块文件各自是「单文件时代的连续片段」，拼接产物与今日单文件逐字节一致（LF 归一后）。`notes-src` 与 `build-dist.cjs` 共用同一拼接器，保证开发/发布两出口同源（消灭「调试的是 A、发布的是 B」）。

### 4.2 模块间依赖方向与共享机制

不引入 ESM/import——运行时仍是单文件 `new Function`。模块间共享靠**拼接序位 + 注释契约**：

- manifest 数组顺序 = 拼接顺序 = 标识符可见顺序（kernel → panels → popovers → modals → panel/index 装配）。后位模块可见前位模块的顶层标识符（函数声明/const），前位不可见后位。
- 方向红线：**modals/popovers/panels 只依赖 kernel**（及按序位在前的同域兄弟的导出契约——但登记为「禁横向引用」，跨域一律走 kernel bus/store）。检查方式：check.js 新增静态断言，逐模块文件 grep 禁止名单（modal 文件不得出现其他 modal 的函数名）——具体名单组装器落地时定。（as-built：client 侧静态断言未落地，由序位强制 + 模块头 `provides/needs` 注释契约维持，见 §6 步骤 G 注记；host 侧已落地为节 45 方向断言。）
- 模块头部注释声明 `// provides: xxx, yyy` / `// needs: kernel/bus, kernel/icons`（纯注释，供断言与人读）。

### 4.3 两态裁决：React e() 与 DOM 如何共源

**裁决：两态各留一份模块源（现状延续），禁止统一抽象。**

- React 态拆 `src/client/**`，DOM 态拆 `src/app/**`，两棵目录树各自装配，UI/交互层零共享——两态本就有真实分歧（§2.5：入口模式/新建流程/主题切换/帮助气泡），抽象出「渲染层适配」是典型的过度设计。
- **唯一例外 = 已经是共源的**：编辑器内核 v3 标记块（今日三端逐字节一致，check.js 强制）与 token 色板（原型/app.html 逐字节一致）。这两块从「复制粘贴 + 断言同步」升级为「物理单份 `src/shared/` + 两态拼接器各自包含」——这不是新抽象，是把已存在的字节级共源落到实处，check.js 的逐字节断言原样继续生效（断言读产物，产物不变）。
- 两态语义同步纪律不变：UI 改动同步原型 `design/notes-ui-v2.html` 的硬性约定、check.js 四端结构断言，全部照旧。

### 4.4 store 裁决（FloatingPanel 拆分的前置）

现状 3160 行单组件内 ~90 个 useState 直接互访，拆文件后必须有共享态。裁决：**kernel/state.js 提供最小 store**——

- 形态：`createStore(slice)` 返回 `{ get, set(patch), subscribe(fn), useSel(selector) }`；`useSel` 内部用 `React.useSyncExternalStore`（加载器注入的 React 18 具备；若实测版本无此 API，回退 useState+useEffect subscribe，先例= listeners/entryListeners 已在这么干）。
- 不做 reducer/action/中间件——就是带订阅的命名空间状态桶。现状的「state→ref 镜像」群（~25 个 effect）在 store 里以 `get()` 永远读最新值自然消亡。
- 进程单例语义不变：静态包全进程一个 store；会话级字段（currentSessionId）维持 props 通道，不入 store。

### 4.5 不变契约（发布面，逐字）

模块化后以下全部不变：39+ RPC 方法面与 payload 形状；`webServer` 路由（`/dsh-notes` POST、`/dsh-notes-app` GET、`/dsh-notes/asset` GET）；`inject` 声明（开发版 `['timer','sessions','workspaces']`，静态包 `['slots','timer','sessions','workspaces']`）；localStorage key 全集（`dsh-notes-entry/folders-expanded/sidebar-w/filters/panel-state` + `dsh-notes-app-*`）；slot 注册四元组（name/id/order 各值）；`window.__dshNotesPerf` 自检面；`window.__ModuleLoader__.load` 产物形态；`.last-host-load` 心跳。

**RPC 面后续新增登记**（增量契约，双包同源 + check 计数断言同步）：
- `notes-get-batch`（notes-034-batch3，N+1 整治）：`{ids:[...]}` → `{notes:[{id,body,updatedAt}], missing:[...]}`。双链索引等全库正文场景一次拉全（首屏请求数 O(n)→O(1)，证据 n-mut6u356mloa）；最小传输面仅正文三字段，已删/墓碑/不存在计入 missing 不报错。登记于 server.js + server.dist.js 同序位（块双包逐字节一致，check 节 49 看守）。

## 5. 红线

1. **产物逐字节等价**：每一步迁移完成后，(a) `node scripts/build-dist.cjs` 产出的 `lib/client.js`、`lib/styles.css` 与迁移前逐字节一致（LF 归一后 diff 为空）；(b) 开发版 `notes-src` 下发文本与迁移前 `src/client-impl.js` 逐字节一致；(c) app 出口产出的 `app.html` 与迁移前逐字节一致。拼接器连注释 banner 都不许加。
2. **check.js 全量绿**：514 断言 + `--core` 名单命中校验，每步必跑全量；断言语义不删不改（锚点串在产物中同位出现——红线 1 自动保证）。
3. **发布契约不变**：§4.5 清单逐项成立。
4. **迁移期功能不冻结**：迁移期间新功能/BUG 修复照常进行——在模块边界内改，改完跑一次拼接+check.js 即可；不得以「正在模块化」为由积压需求。若功能改动与某迁移步撞车，功能先行、迁移步 rebase。
5. **build-dist 转换断言不回退**：6 组计数断言全保留且期望值不变；拼接器产物必须让锚点（services-header/styles-block/perf-timer/perf-wrap/rpc-helper 的精确文本）原样命中。
6. **两态不抽象**：除 `src/shared/` 已共源块外，不得为 React/DOM 提取公共渲染层。

## 6. 迁移步骤（绞杀者顺序）

每步完成判据相同：`node check.js` 全量绿 + 红线 1 的 (a)(b)（涉及 app 的步骤含 (c)）逐字节 diff 为空 + `node --check lib/client.js`。**每步一个可独立验收的 commit 粒度；翻车即 revert 该步，不带病前进。**

- ✅ **步骤 A（组装器恒等起步）**：写 `scripts/concat-client.cjs`（manifest 驱动逐字节拼接）；`src/client/` 先只有一个模块文件 = 现 `client-impl.js` 全文原地搬入（拆为 kernel/whole.js 一个文件也行，目标是跑通链路）；`notes-src`（host 侧加拼接读取）与 `build-dist.cjs` 切到拼接输出。验收：双出口产物与今日逐字节一致。
- ✅ **步骤 B（kernel 抽出）**：按 §3.1 kernel 清单逐个文件切出。建议顺序：format → constants → persist → bus → state → drag → perf → css-loader → icons → bootstrap；`src/shared/editor-kernel.js` 最后切（它要同步改 app.html 侧的包含方式，但本期 app 侧先不切——内核块在 app.html 原样保留，check.js 三端断言继续看守；物理共源等步骤 F 一起落）。每抽一个文件跑全量。
- ✅ **步骤 C（entries + selection）**：header-button、fab、capture 三个小 panel 先搬——验证 panels 拆分姿势（store 接入、toast 宿主迁移到 bus）。toast 宿主从 SelectionCapture 内 state 移到 kernel/bus.js 是本步唯一的行为等价改造（showToast/toastEmit 契约不变）。
- ✅ **步骤 D（modals 逐个搬）**：依赖面从小到大：link → image → merge → newnote → history → trash → prune → archive → export → export-single → import → inject-preview → inject-manager → suggest → memory-guide → dispatch → settings（最大最后）。每搬一个：该 modal 的 state 迁入 store 切片、open*/do* 函数迁入模块文件、JSX 片段经装配点挂载，跑全量。
- ✅ **步骤 E（panel 子域）**：popovers → keyboard → search → wiki → tree → sidebar → editor → chrome，最后 `panel/index.js` 收口。FloatingPanel 死亡即本 epic 完成。
- ✅ **步骤 F（app 态恒等迁移 + 物理共源）**：`scripts/concat-app.cjs` + `src/app/**` 恒等整搬（镜像拆分粒度可粗于 React 态，先 1→N 个文件均可）；同时 `src/shared/editor-kernel.js` 与色板块切物理单份，两端拼接器包含。验收含红线 1(c)。
- ✅ **步骤 G（收口）**：DEVELOPMENT.md 代码结构表更新；check.js 增补「模块方向断言」（§4.2 禁横向引用名单）；删除过渡残留。
  - as-built 注记：结构表与过渡残留清理已做；**client 侧静态方向断言最终未落地**——禁横向由 manifest 序位强制（modals 排在 panels 前、只依赖 kernel）+ 模块头 `provides/needs` 注释契约 + 评审维持，host 侧方向断言已落地为节 45（12 组序位钉桩）。本节 ✅ 按「收口动作完成、client 静态断言为已知偏差」标注。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| build-dist 锚点正则依赖 apply 体精确文本 | 拼接器逐字节零改写（红线 1/5），锚点天然保住；步骤 A 恒等验收先行暴露 |
| store 改造引入行为漂移（渲染时机/闭包过期语义） | useSel 等价于现状 useState+镜像 ref；步骤 C 先用三个小 panel 验证姿势再推广 |
| 功能迭代与迁移撞车 | 红线 4：功能先行；拼接器恒等保证 rebase 成本低（冲突方在模块文件上改，不重排产物） |
| check.js 断言读的是产物，模块源改名/移动无感 | 这正是设计意图；但「模块方向断言」须新增以守住 §4.2（步骤 G） |
| app.html 手工维护惯了，组装化后忘记跑 concat-app | concat-app 并入 build-dist.cjs 同一入口（一次命令刷新三产物），check.js 读产物兜底 |

## 8. P2：host 侧模块化（已落地 · P2·5 收口）

> 状态：本章撰稿时为 spec 草案（P2·1 产出：实盘盘点 + 技术验证 + 切分清单 + 绞杀者步骤），现已按绞杀者顺序全部执行完毕：
> P2·2 组装器恒等起步（`scripts/concat-host.cjs` + `src/host/**` 首片 whole.js 原地搬入 + host.js 引导壳切 manifest 拼接）→
> P2·3 kernel 六模块抽出 → P2·4 RPC 核心域（folders/notes/history-trash·trash/llm·organize）→
> **P2·5 收口**：whole.js/dist-whole.js 续切为 server/dispatch/inject/memory/search/transfer/index 七域 + 双出口同源复查（notes-src host 分支死引用清零）+ `check/sections/45-host-modular.cjs` 序位/共源/方向断言 + DEVELOPMENT.md 终态结构。
> `scratch/p2-host-concat/` 是一次性验证现场（历史留档）；P2·5 切片工装为 `scratch/p25-slice.cjs`（锚点定位 + 全覆盖校验 + 行多重集账目核对）。
> 口径：行号锚点全部来自 `src/host-impl.js`（3376 行 / 239KB）与 `packages/dsh-notes-plugin/index.mjs`（3718 行 / 260KB）实盘，且经 `scratch/p2-host-concat/ranges.cjs` 锚点解析器机械复验（锚点漂移即 throw，非纸面推断）。

### 8.1 host-impl.js 实盘盘点

#### 8.1.1 形态与加载链路（今日事实）

- **开发版**：`host.js`（23 行引导壳）→ `fs.resolve`+`fs.readText` 读 `src/host-impl.js` 全文 → `new Function('harness','pluginDir',src)` 执行 → `plugin.apply(ctx)`。`inject: ['fs','sandboxPolicy']`（L13）；agents/llm/agentDefaultModel/systemPrompt/sessionPersistence/workspaceRegistry/sessionTitle/sessionQuery 八个服务走 `ctx.get` + 守卫降级（L17–24）。心跳 `.last-host-load` 自检验收（L3374）。
- **发布版**：`index.mjs` ESM `export name/inject/apply`（package.json `type:module`）；`inject` 声明 9 服务（L29：fs/sandboxPolicy/webServer/tools/agents/workspaceRegistry/sessionPersistence/sessionQuery/sessionTitle）；无心跳（L3716 注释：静态包 import 即就绪）。
- **在役先例**：client 源下发 `notes-src` RPC（host-impl.js L2790–2809 / index.mjs L2938–2964）就是「读 manifest + 逐条目读盘拼接 + LF 归一」的运行时拼接——host 侧「加载时拼接」不是新机制，是把同一姿势挪进引导壳/构建脚本。

#### 8.1.2 RPC 面（39 个 handler，按功能域分组；行号 = host-impl.js 实值）

注册区集中在 L2767–3118（`handle()` 包装 = harness.handle + perf 计数，L2767–2773）。发布版同 39 个 + `notes-ping`（POC 遗留，index.mjs L3275）。

| 域 | RPC（host-impl.js 行锚点） | 依赖面（读/写） |
|---|---|---|
| server 基础设施 | notes-perf(2774) notes-css(2783) notes-src(2790) | 写 perf-report.json（10s 节流）；读 styles.css；读 src/client/** + src/shared/** 拼接下发 |
| notes CRUD | notes-list(2777) notes-get(2811) notes-create(2815) notes-update(2818) notes-quick(2821) notes-quick-instruct(2825) notes-delete(2828) notes-restore(2831) notes-purge(2835) | cache Map(L504) 全量读写；写 notes/*.md + .bak 墓碑；settings（log 隐身硬闸）；folders.json 校验；update resolved 联动派发闭环 |
| history-trash | notes-history(2840) notes-history-get(2843) notes-restore-history(2846) | .history/ 读写 + histSizes/histBytes(L644–645) 惰性扫描；恢复前置快照 |
| notes 归档/建议 | notes-archive(2850) notes-archive-preview(2854) notes-archive-undo(2858) notes-suggest(2862) | .archive-undo.json 事务；.bak 备份；cache 直读 |
| memory 工作记忆 | notes-memory-guide(2935) | notes/*.md（contractType=memory-guide 单一事实源，L2874–2934） |
| search 检索 | notes-search(2941) | cache（search-helpers 纯函数，L2105–2125） |
| inject 注入 | notes-conventions(2955) notes-inject-preview(2962) + systemPrompt.context ×2（L2951–2952，order 130/131） | cache 同步直读（systemPrompt text 同步契约）；settingsCache（预算/开关）；lastInjectChars/lastConvStats/lastCatStats(L259–263) |
| dispatch 会话/派发 | notes-sessions(2992) notes-active-sessions(2996) notes-workspaces(3000) notes-dispatch(3008) notes-dispatch-done(3012) | sessMetaCache（模块级 L8–10，TTL 10min）；agents/sessionPersistence/workspaceRegistry/sessionTitle/sessionQuery 五服务；ctx.on('agent/status') 事件回执（L2091） |
| settings 设置 | notes-settings-get(3017) notes-settings-set(3022) notes-usage-get(3085) | settings.json（settingsCache L205–206）；usage.json（usageCache L286–289，防抖 5s） |
| transfer 导入导出/资产 | notes-export(3090) notes-export-single(3095) notes-import-preview(3099) notes-import(3104) notes-asset-upload(3108) notes-assets-prune(3116) | 目录快照读写；assets/（mime 白名单 + 5MB 上限）；folders.json 合并 |

工具层 3 个（regTool → harness.defineTool + harness.registerTool，L3120–3360）：`note_search`(3132) / `note_get`(3164) / `note_manage`(3185，9 个 action：create/list/update/move/delete/restore/archive/dispatch/debugws)。

#### 8.1.3 webServer 路由与 inject 声明位置

webServer 路由**仅发布版**（开发版无 webServer 依赖，harness 唯一通道）：

| 路由 | index.mjs 位置 | 说明 |
|---|---|---|
| POST `/dsh-notes` | L3286–3301（常量 RPC_PATH L44） | RPC 兜底分发（handlers 表 L2905 始终维护）；12MB 上限（asset-upload base64） |
| GET `/dsh-notes-app` | L3309–3329（常量 L47–48） | 全窗口笔记页，app.html 逐请求读盘（符号链接安装免重启） |
| GET `/dsh-notes/asset` | L3337–3380（常量 ASSET_ROUTE L52） | 图片资产：两段式防穿越 + dirname 复核 + 扩展名 mime 白名单 + immutable 缓存 |

inject 声明：开发版 host-impl.js L13（2 服务）⇄ 发布版 index.mjs L29（9 服务）——差异原因见 index.mjs L24–28 注释（静态包无 harness Builtin，必须走 ctx 服务通道；注册时机晚于基础服务故必须显式 inject）。

#### 8.1.4 store/cache 读写面（模块拆分的共享态清单）

- **模块级**（随引导壳生命周期，跨 apply 存活；静态包为模块级单例）：`sessMetaCache`/`sessMetaFillRunning`/`SESS_META_TTL`（L8–10）。
- **apply 作用域**：`disposers`(L29)；`settingsCache`+`settingsLoadPromise`(L205–206)；`usageCache`+`usageLoadPromise`+`usageTimer`+`usageDirty`(L286–289)；`lastInjectChars`+`lastConvStats`+`lastCatStats`(L259–263)；`cache`(L504，笔记解析结果常驻)；`useCountDirty`+`useCountTimer`(L580–581)；`histSizes`+`histBytes`(L644–645)；`quickChain`(L1286，速记合并串行化)；`perfStats`+`lastPerfWrite`(L2754–2755)。
- **文件面**：notes/*.md（+.bak 墓碑）、.history/、folders.json、settings.json、usage.json、.archive-undo.json、assets/、perf-report.json、.last-host-load（仅开发版）。

拆分含义：host 侧无 React state 堆问题（对照 §4.4），共享态全部是「同作用域顶层标识符」——manifest 序位拼接天然保住可见性，**无需引入 store 抽象**；唯一的拆分纪律 = 序位 + 禁后位引用。

#### 8.1.5 双包差异点（host-impl.js ⇄ index.mjs，实盘 14 项）

1. **形式**：`return {inject, apply}`（new Function 执行）⇄ ESM `export name/inject/apply`。
2. **路径根**：`PLUGIN_DIR\notes`（pluginDir 参数注入，L26–27）⇄ `~/.dsh/notes`（os.homedir，模块级常量 L34–52）。
3. **inject**：2 服务 ⇄ 9 服务（§8.1.3）。
4. **handle()**：harness 单通道（L2767–2773）⇄ handlers{} 表始终维护 + harness 主通道 + webServer 兜底分发（L2904–2915）。
5. **regTool**：harness 单通道（L3120–3123）⇄ harness/ctx.tools 双通道互斥（L3384–3396，含 defineTool 内联等价实现 L58–72）。
6. **webServer 路由**：无 ⇄ 3 条（§8.1.3）。
7. **notes-ping**：无 ⇄ 有（L3275，POC 骨架遗留，lib/client.js「笔记POC」按钮消费）。
8. **一次性迁移**：无 ⇄ migrateLegacyNotes + fixLegacyWorkspaces（L3635–3709；含 workspace 空值启动修补）。
9. **workspace 推导**：conventionText 用 `basename(cwd)`（L2632）⇄ 静态包 `_wsOfSession`（L1187，_create 时 L1391 + 启动修补 L3699 两处调用）。
10. **路径拼接/删除**：`'\\'` 拼接 + 墓碑式清空 ⇄ `path.join` + `fs.processPath` 真删（history-engine 块为设计内差异，见 §8.1.6；其余散点同先例）。
11. **notes-css**：CSS_PATH 单路径（L2783）⇄ CSS_CANDIDATES 候选表（L2925–2932：包内 lib/ → 包根 → 开发版回退）。
12. **notes-src**：开发目录直读/拼接（L2790–2809）⇄ 开发目录 manifest 拼接优先、包内 `lib/client.js` 回退；host 候选 host-impl.js / index.mjs（L2938–2964）。
13. **心跳**：`.last-host-load`（L3374）⇄ 无（L3716）。
14. **常量层级**：SETTINGS_PATH/USAGE_PATH apply 内派生（L202–204）⇄ 模块级常量（L36–39，import 时求值）。

#### 8.1.6 双包标记块同步面（11 块，实测字节比对）

| 标记块 | host-impl.js | index.mjs | 实测 |
|---|---|---|---|
| sensitive-helpers | 58–101 | 131–174 | 逐字节一致（44 行） |
| llm-usage | 272–402 | 341–471 | 逐字节一致（131 行） |
| use-telemetry | 574–607 | 645–678 | 逐字节一致（34 行） |
| history-engine | 624–870 | 695–948 | **结构同步，含设计内差异**（247 vs 254 行：路径拼接/删除通道，check.js 结构级断言看守） |
| folder-tree-helpers | 922–970 | 1001–1049 | 逐字节一致（49 行） |
| list-union-defense | 1189–1212 | 1301–1324 | 逐字节一致（24 行，8 空格缩进层级） |
| suggest-helpers | 1617–1753 | 1740–1876 | 逐字节一致（137 行） |
| img-path-hint | 1981–1990 | 2104–2113 | 逐字节一致（10 行） |
| dispatch-loop | 2046–2103 | 2169–2226 | 逐字节一致（58 行） |
| search-helpers | 2105–2125 | 2228–2248 | 逐字节一致（21 行） |
| export-single | 2234–2302 | 2360–2428 | 逐字节一致（69 行） |

### 8.2 技术验证：「加载时拼接」可行（可运行证据）

验证现场：`scratch/p2-host-concat/`（README 含复跑命令；`result.txt` 为 2026-10-03 实跑留档）。两条腿各自闭环：

**开发版（沙箱运行时拼接）**——`verify-dev-sandbox.cjs`，21 断言全绿：

- A. 26 片经沙箱 fs 形态异步接口（`resolve`/`readText`）读盘拼接，产物与 `src/host-impl.js` **逐字节一致**（LF 归一后）；
- B. CRLF 鲁棒性：切片改写为 CRLF 后拼接归一仍逐字节一致（Windows 编辑回流场景）；
- C. 拼接产物经 `new Function('harness','pluginDir',src)` 求值 → `apply(mock ctx)` 成功：`inject` 形态不变、39 RPC 全注册（与 §8.1.2 清单同名同数）、3 工具、systemPrompt.context order 130/131；
- D. 14 项行为冒烟（create/list/get/update/search/inject 注入/folders/settings/suggest/usage/删除恢复/三工具 execute）口径对齐 check.js 对应节；
- E. 心跳 `.last-host-load` 写入照常。
- 性能实测：manifest + 26 片读盘拼接 **18ms**（引导壳启动一次性成本，可忽略）。

**发布版（构建期拼接）**——`verify-dist-build.cjs`，11 断言全绿：

- A. 28 片拼接产物与 `index.mjs` **逐字节一致**；B. `node --check` 语法通过；C. 动态 import 成功且顶层无副作用，`export name/inject/apply` 形态不变（inject 9 服务逐项一致）；
- D. harness 缺失通道：3 条 webServer exact 路由 + ctx.tools 3 工具 + `POST /dsh-notes` 分发 notes-ping/notes-create/notes-list 全链路；
- E. harness 存在通道：40 RPC（39+notes-ping）经 harness.handle 注册、路由同登、工具走主通道。

**共源面实测**——`compare-flavors.cjs`：26 对同名切片中 **6 片逐字节一致**（kernel/format、inject/sensitive-helpers、notes/front-matter、kernel/session-ctx、search/helpers、memory/guide），19 片有差异（绝大多数是 §8.1.5 的路径/常量/通道差异），另有 dev-only 1 片（kernel/head）与 dist-only 3 片（head、apply-head、server/migration）。

**回归**：`node check.js --core` 107/0 绿；`node check.js` 全量 **578/0 绿**（PoC 只新增 scratch 文件，不触碰任何产物/断言对象）。（收官复核 2026-10-04：`--core` 108 条名单全命中，全量 **587/0** 绿。）

结论：两条腿机制全部跑通且产物逐字节等价，「加载时拼接」无技术悬念；host.js 改造 = 把壳内「读一个文件」换成「读 manifest + 逐条目读」（notes-src 同款循环），`new Function` 调用形态原样不动。

### 8.3 模块切分清单（目标态 src/host/**）

沿用 P1 契约：模块文件 = 「单文件时代的连续片段」，manifest 序位 = 拼接序位 = 标识符可见序。PoC 已按下列切分机械切片并恒等复验（`out/ranges-host.json` / `out/ranges-dist.json` 留档）：

```
src/host/
  manifest.dev.js           ← 开发版清单（host.js 运行时拼接的唯一组装依据）
  manifest.dist.js          ← 发布版清单（concat-host-dist.cjs 构建期拼接依据）
  kernel/        head.js(变体:dev) format.js* session-ctx.js* bootstrap-tail.js(变体)
  notes/         front-matter.js* store-cache.js persist.js create-list.js
                 get-update.js quick.js archive-suggest.js
  folders/       tree.js（含 folder-tree-helpers 标记块）
  history-trash/ engine.js（含 history-engine 标记块，双包结构同步）trash.js
  inject/        sensitive-helpers.js* conventions.js
  memory/        guide.js*（序位固定在 server/rpc-a 与 rpc-b 之间——现状即如此，不重排）
  settings/      store.js
  server/        rpc-a.js rpc-b.js tools.js migration.js(变体:dist)
  llm/           usage-classify.js（含 llm-usage 标记块）organize.js
  dispatch/      sessions.js（含 img-path-hint / dispatch-loop 标记块）
  search/        helpers.js*（含 search-helpers 标记块）
  transfer/      import-export.js（含 export-single 标记块）
```

`*` = 双包逐字节一致的整片（物理共源候选，§8.4.3）；「变体」= dev/dist 内容本质不同的片。llm/dispatch/search/transfer 四个子域是实盘自然析出（主窗口清单 kernel/notes/folders/history-trash/inject/memory/settings/server 八域的新增细分），需评审确认。

> **as-built 注记（P2·5 收口后实态，以上表为计划稿）**：实际落地为扁平布局——`kernel/`（head/dev-only + format + session-ctx + front-matter + settings-store + store-cache + persist，后三者为 `.dist.js` 变体对）+ `inject/sensitive-helpers.js` + `llm/`（usage-classify + organize，均变体对）+ `history-trash/`（engine + trash，变体对）+ `folders.js` / `notes.js`（变体对）+ **P2·5 尾部七域**：`server`（handle/perf + 核心注册表 + notes-css/notes-src；dist 同模块含 webServer 三路由 + notes-ping + ASSET_EXT_MIME 随路由迁入）→ `inject/img-path-hint.js`（共源单份）→ `dispatch`（变体对）→ `inject`（注入渲染 + settings 面，变体对）→ `memory`（归档 + suggest + 日志卫生 + memory-guide，变体对）→ `search.js`（共源单份）→ `transfer`（变体对）→ `index`（工具层 + 启动装配/迁移，变体对，尾模块）。settings 未成独立 `settings/` 目录：settings-store 在 kernel，settings-get/set/usage-get 三个 handler 随注入面入 `inject.js`（设置键绝大多数是注入/治理旋钮）。

### 8.4 组装契约

#### 8.4.1 双出口规则

| 出口 | 输入 | 产物 | 时机 |
|---|---|---|---|
| 开发版 | src/host/**（manifest.dev.js） | 单文件文本（`return {inject, apply}` 形态） | **host.js 引导壳运行时拼接**：`fs.resolve`+`fs.readText` 读 manifest 与逐条目，串接 + LF 归一后喂 `new Function('harness','pluginDir',src)`（调用形态原样不动） |
| 发布版 | src/host/**（manifest.dist.js） | `packages/dsh-notes-plugin/index.mjs` | `scripts/concat-host-dist.cjs` **构建期拼接写盘提交**（同 concat-app.cjs 姿势），check.js 读产物 + 新增可复现断言 |

拼接语义与 §4.1 完全相同：**逐字节串接，零插入零改写零 banner，LF 归一**；manifest 解析复用同一规则（单引号路径一行一条、文本正则提取、注释禁单引号）。host 侧比 client 侧更简单：两态同为 apply 体 4 空格基座，`@shared-host/` 条目**原样纳入、无缩进提升**。

#### 8.4.2 依赖方向

kernel 在最前（head/format/session-ctx 提供全作用域基元），server/tools 在最后（消费全部域）；同域序位保持现状文件序。memory/guide 片物理位置夹在两片 RPC 注册之间（L2865–2934）——**序位即现状，不为目录美学重排**（逐字节红线优先）。方向红线：后位可引用前位顶层标识符，禁前位引用后位（check.js 方向断言随 H-D 收口增补）。

#### 8.4.3 双包同源策略（红线延续 + 可选增强）

- **底线（不弱化现状）**：11 个标记块维持「双份 + check.js 逐字节/结构断言」纪律；两棵清单的差异片显式登记为变体。
- **增强（建议随 H-C 落地）**：6 个整片一致块（§8.2 实测）升级为 `src/host/shared/` 物理单份，两 manifest 以 `@shared-host/` 条目同名引用——与 §4.3 同一先例（已共源的才物理单份，不为共源发明抽象）。
- **裁决点**：8 个块级一致标记块（llm-usage/use-telemetry/folder-tree-helpers/list-union-defense/suggest-helpers/img-path-hint/dispatch-loop/export-single）是否细化切片边界到标记块做块级共源——建议**不做**（粒度收益低、check.js 逐字节断言已在守），留主窗口裁决；history-engine 永为变体（设计内差异）。

#### 8.4.4 红线（在 §5 六条之上追加 host 侧三条）

7. **host 产物逐字节等价**：(a) 开发版 host.js 拼接产物 === 迁移前 `src/host-impl.js`；(b) 构建期拼接产物 === 迁移前 `index.mjs`（均 LF 归一后 diff 为空）。
8. **§4.5 RPC 面不变**：39 RPC + 3 工具 + 2 注入（order 130/131）+ 发布面（inject 声明、webServer 3 路由、notes-ping、心跳）逐项成立。
9. **双包同源纪律不弱化**：标记块断言全部保留；变体片两清单显式登记，禁止出现第三份拷贝。

### 8.5 迁移步骤（绞杀者顺序，同 P1 模式）

每步完成判据：`node check.js` 全量绿 + 红线 7 逐字节 diff 为空 + 开发环境真实插件重载实测（心跳写入 + 面板功能冒烟）。每步一个可独立验收的 commit 粒度；翻车即 revert 该步。

- ✅ **步骤 H-A（组装器恒等起步）**：`scripts/concat-host.cjs`（manifest.dev.js 驱动）+ `src/host/**` 按 §8.3 一次切片（PoC 已证 26 片恒等；若求更稳可先单片 whole.js 再逐域切出，裁决点）；`host.js` 壳切换为 manifest 拼接（PLUGIN_DIR 常量与移植注释不动）；`check/helpers.cjs` 的 `hostSrc` 从读文件切换为 `concatHost()` 产物（与 L22 clientSrc 同法）；删除 `src/host-impl.js`。
  - as-built：取了更稳路径——P2·2 先单片 `whole.js` 恒等起步，P2·3/P2·4/P2·5 逐域切出后余量清零（节 45「whole.js/dist-whole.js 余量清零」断言看守）。
- ✅ **步骤 H-B（发布版构建期拼接）**：`scripts/concat-host-dist.cjs` + manifest.dist.js + 变体片（head/apply-head/migration/bootstrap-tail 等）；`index.mjs` 转为写盘提交的产物；check.js 新增「index.mjs 是 concat-host-dist 的产物且可复现」断言（对照 lib/client.js 先例）。
  - as-built：无独立 `concat-host-dist.cjs` 文件——`concat-host.cjs` 导出 `concatHostDist()`，由 `build-dist.cjs` 同一入口调用（§8.6 末行对策兑现）；可复现断言在 CORE 名单内（「index.mjs 是 scripts/concat-host.cjs 的产物且可复现」）。
- ✅ **步骤 H-C（物理共源）**：6 个整片一致块切 `src/host/shared/`，两 manifest `@shared-host/` 引用；check.js 双包比对断言改为读 shared 源（产物不变，行为断言无感）。
  - as-built：`@shared-host/` 通道预留未启用（`concat-host.cjs` 留有 SHARED_HOST_DIR 解析）；实际共源两片（`inject/img-path-hint.js`、`search.js`）按更简形态落地——**双清单同名引用同一物理文件、不搬目录**，节 45「共源片登记」断言看守；块级共源按 §8.4.3 裁决点建议不做（逐字节断言已在守）。
- ✅ **步骤 H-D（收口）**：DEVELOPMENT.md 代码结构表更新；check.js 增补 host 模块方向断言；清理 `scratch/p2-host-concat/`（或归档为工装）。
  - as-built：方向断言落地为节 45（12 组序位钉桩）；`scratch/p2-host-concat/` 保留为历史留档未清理（§8 章首注记）；DEVELOPMENT.md 收官复核同步（2026-10-04：模块树实景 + 组装器跑法 + 新增模块规范）。

迁移期功能不冻结（§5 红线 4 同样适用于 host 侧）。

### 8.6 风险与对策

| 风险 | 对策 |
|---|---|
| 引导壳读盘 1→27 次的启动开销 | 实测 18ms 一次性成本（§8.2）；沙箱 fs 为本地盘通道 |
| Windows CRLF 回流破坏逐字节红线 | 拼接契约 LF 归一（§8.2-B 已证）；红线 7 的 diff 判据同为 LF 归一后 |
| 锚点/序位漂移导致切错 | ranges 锚点解析漂移即 throw；每步跑全量 check + 逐字节 diff，翻车 revert |
| check/helpers.cjs 读源方式切换引入断言口径漂移 | hostSrc 切换与 clientSrc（L22 concatClient）同一先例；切换当步以「拼接产物 === 旧文件」逐字节断言兜底 |
| 双包变体片登记漏项导致三份拷贝 | 红线 9 + compare-flavors 比对脚本迁入工装（H-D），CI 化检查同名片一致/登记状态 |
| index.mjs 转为产物后手工直改回流 | 可复现断言（H-B）兜底防忘跑；concat-host-dist 并入 build-dist.cjs 同一入口（一次命令刷新全部产物） |

## 9. 已裁决事项汇总（供主窗口复核）

1. 源码模块化、产物单文件；不引入打包器/ESM。
2. 拼接器逐字节零插入零改写；`notes-src` 与 `build-dist` 共用同一拼接器；app 出口独立拼接器写盘提交。
3. 两态各留一份模块源，禁止统一抽象；唯一例外 = 已共源的内核 v3 块与色板块 → `src/shared/` 物理单份（随步骤 F 落地）。
4. kernel 最小 store（useSyncExternalStore 或 subscribe 回退），不做 reducer/中间件；会话级字段不入 store。
5. 依赖方向：modals/popovers/panels → kernel，禁横向；manifest 序位 = 可见性；check.js 增方向断言。
6. 绞杀者顺序：A 组装器恒等 → B kernel → C 小 panels → D modals（小→大）→ E panel 子域 → F app 态 → G 收口；每步全量 check + 逐字节 diff。
7. 红线六条（§5）不可谈判；迁移期功能不冻结。
8. host 侧 P2 另立项，本期仅占位。→ **已另立项并全部落地**（§8 章首状态注记：P2·2 恒等起步 → P2·3 kernel → P2·4 RPC 核心域 → P2·5 收口；§8.5 步骤逐项 ✅）。
