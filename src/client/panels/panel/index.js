    // ===== panel/index —— 主面板装配层（architecture-modular §6 步骤 E 收口：FloatingPanel 大组件消亡于此）=====
    // provides: FloatingPanel（shell.overlay #200 主面板组件）+ slots.register + apply 收尾（ctx.effect 统一清理 + ready 日志）
    // needs: kernel/*（bus/state/persist/constants/format/icons/perf/css-loader/drag + editor-kernel）+ modals/*（18 个）+
    //        popovers/*（7 个）+ panels/panel/*（search/wiki/tree/editor/sidebar/chrome/keyboard）——全部经拼接序位在前可见
    //
    // 【§6 步骤 E 裁决记录】
    // ① state 不迁 store：check.js 逐字锚定一批 useState/useRef 声明原文（selMode/selIds/sortBy/view/filters/foldersExpanded/dragActive/
    //    dragNoteIdRef/dragFolderIdRef/edSens/edSensRef/newNoteKind/setSnap/setInflight 等），且 popover 与 panel 子域 hook
    //    均经本装配层在同一组件（FloatingPanel）渲染边界内按固定序调用——重渲染口径与单文件时代完全一致。store 切片（kernel/state.js
    //    createStore）仅服务真正独立组件边界的 modals（§6 步骤 D 已建立），本步不为 panel 域新建 store 切片。
    // ② 跨域调用：popover/panel 子域禁横向引用，跨域 setter/函数经 kernel/state.js 转发别名 → panelBridge（本组件每渲染回填）；
    //    跨域镜像 ref（notesRef/searchRef/searchInputRef/editorModeRef/switchModeRef/pagedIdsRef 等）为 kernel/state.js 顶层单例；
    //    渲染期 post-guard 求值结果经渲染函数入参注入（renderTreeEls(R)/renderFilterPop(R)/renderSidebar(R)/renderEditorEl(R)）。
    // ③ 子域 hook 内部同名局部绑定遮蔽 kernel 别名，故子域内部代码逐字不动；check 锚点全部为拼接产物文本锚，逐字节保留。
    // ④ apply 收尾 4 行自 panels/selection/capture.js 迁入本文件末尾（manifest 线性拼接契约：收尾必须在最后模块）。
    // ⑤ toast 桶分置 kernel/bus.js（toastEmit 挂点）+ kernel/state.js（回填 createStore 序位约束）保持 C 步裁决：不合并（TDZ 风险）。
    const d3 = slots.inject('shell.overlay', () => {
      function FloatingPanel() {
        perf.panelRender++
        const [open, setOpen] = React.useState(panelOpen)
        const [notes, setNotes] = React.useState([])
        const [selected, setSelected] = React.useState(null)
        // edTitle/edTopic/edTags/edBody/edKind/edStatus/edRole/edSens/edScope + savedAt 已拆出（§6 步骤 E：panel/editor.js——
        // 编辑器域归 usePanelEditor，下方 wiki 装配点后解构接入；「目录可见」chip 态随 0.4.3⑪ 拆除退役）
        // searchText/searchIds/searchMatches 已拆出（§6 步骤 E：panel/search.js——归 usePanelSearch，下方防抖装配点解构接入）
        const [loading, setLoading] = React.useState(false)
        const [error, setError] = React.useState('')
        // 窗口 chrome（pos/size/sideW/sideDrag + 标题栏/分隔条/resize 拖拽族 + titlebarEl/splitterEl/resizeEl JSX）已拆出
        // （§6 步骤 E：panel/chrome.js——归 usePanelChrome；open/close/showHelp 经入参注入，open 居中/位置持久化 effect 同文随迁；
        // hook 调用点位于 help hook 之后——入参 showHelp 自其解构，TDZ 约束）
        // UI v2 视图单选（原型 view）：all=全部 / topic=主题全局过滤（跨文件夹）
        // （0.4.3 验收修复⑦：「文件视图」（文件夹视图）模式整体拆除——树展开即文件夹浏览，漏斗进视图入口/求值分支/样式已移除）
        const [view, setView] = React.useState({ type: 'all', id: '' })
        // 帮助气泡已拆出（§6 步骤 E：popovers/help.js——showHelp 态 + 气泡 JSX 归 usePanelHelp；标题栏「?」经 kernel 转发别名 setShowHelp）
        const { showHelp, setShowHelp, helpEl } = usePanelHelp()
        const { pos, size, sideW, titlebarEl, splitterEl, resizeEl } = usePanelChrome({ open: open, close: close, showHelp: showHelp })
        const [flashId, setFlashId] = React.useState(null)
        const [focusId, setFocusId] = React.useState(null)
        // visibleCount/topicExpanded/topicSecOpen/dragActive 已拆出（§6 步骤 E：panel/tree.js——归 usePanelTree，下方树装配点解构接入）
        // ===== 筛选中心（design/notes-filter-center.html 落地）：filters 状态 {pinned, injected, injectEver, sensitive, kinds[]} =====
        // 组内 OR / 跨组 AND，与文件夹/主题视图/搜索 AND 叠加；localStorage 持久化（dsh-notes-filters，含 sortBy）
        const [filters, setFilters] = React.useState(() => loadFiltersState().filters)
        // P2 使用遥测：列表排序方式（'time'=按更新（缺省，与 host _list 一致）| 'use'=按被引用次数降序 | 'rel'=相关度（搜索时：标题命中>标签>正文，同级 updatedAt 降序））
        // 筛选中心口径：排序是独立控件，与筛选条件正交（互不重置）
        const [sortBy, setSortBy] = React.useState(() => loadFiltersState().sortBy)
        // 0.4.4-D hidden 隐藏属性（notes-044-hidden-attr）：显隐开关态——开=hidden 项半透明渲染（hid 遮罩样式），关=从树/置顶组/未入夹/主题区滤除；
        // 纯 UI 遮罩（host _list/_search 零改动，agent 面/读写面天然完整）；localStorage 独立键持久（dsh-notes-show-hidden，kernel/persist.js）；
        // 与筛选中心条件正交：不计 filterCount、filtersActive 不因其激活、清空筛选不重置
        const [showHidden, setShowHidden] = React.useState(loadShowHidden)
        // 筛选 popover + 排序菜单已拆出（§6 步骤 E：popovers/filter-pop.js + sort-menu.js——filterOpen/sortOpen 态与浮层 JSX 归各自 hook；
        // filterOpenRef/sortOpenRef 为模块顶层绑定（Esc 直读）；共享点外关闭 effect 随 sort-menu 收容；浮层求值依赖 post-guard 结果经渲染函数入参注入）
        const { filterOpen, setFilterOpen, renderFilterPop } = usePanelFilterPop({ filters: filters, sortBy: sortBy, showHidden: showHidden })
        const { sortOpen, setSortOpen, sortMenuEl } = usePanelSortMenu({ sortBy: sortBy, filterOpen: filterOpen })
        // 筛选条件/排序持久化 effect 已随 popovers/filter-pop.js 迁入（筛选中心条件编辑入口收容，hook 内同文，filters/sortBy 经入参注入）
        // searchMatches（host notes-search 命中字段，「相关度」排序数据源）已随 panel/search.js 迁出
        // 虚拟文件夹树：清单走 notes-folders RPC（list/create/rename/delete/reorder）；折叠态持久化 localStorage
        // 文件夹右键菜单 + 管理动作族已拆出（§6 步骤 E：popovers/folder-menu.js——folders/foldersExpanded/内联输入/重命名/folderMenu 态 +
        // 树 helper 族 + loadFolders + CRUD/reorder/reparent 归 usePanelFolderMenu；folderMenuRef/renamingIdRef/folderInputOpenRef/subFolderForRef
        // 为该模块顶层绑定；Esc 栈/树渲染/面包屑经解构或 kernel 转发别名接入）
        // 0.4.4-C：filters 入参注入（sysKids 补拉效应的 kind 单档口径门用）；sysKids 解构接入 → 下方树装配点注入 usePanelTree
        const { folders, foldersExpanded, sysKids, folderInputOpen, folderInputText, subFolderFor, renamingId, renameText, setFolderMenu, setFolderInputOpen, setFolderInputText, setSubFolderFor, setRenamingId, setRenameText, loadFolders, folderSubtreeIdsOf, childFoldersOf, rootFolders, folderPathOf, isFolderExpanded, toggleFolder, expandFolder, folderName, openFolderMenu, doCreateFolder, doRenameFolder, doDeleteFolder, doReorderFolder, doReparentFolder, folderMenuEl } = usePanelFolderMenu({ notes: notes, view: view, filters: filters })
        // 主题过滤行原地展开态（点行主体=展开/收起该主题子列表；object map，session 内有效，不持久化；缺省折叠）
        // 主题过滤区整体折叠态（notes-topic-collapse：缺省折叠——常态只显示「主题 (N)」一行，点击展开/收起列表；session 内记忆，不持久化）
        // （topicExpanded/topicSecOpen 两态已随 panel/tree.js 迁出）
        // folderInputOpen/folderInputText/subFolderFor/folderMenu/renamingId/renameText 六态已随 popovers/folder-menu.js 迁出（上方解构接入）
        // ctxNewFolderText 已随 popovers/ctx-menu.js 迁出（usePanelCtxMenu hook 内）
        // 新建笔记 modal 已拆出（§6 步骤 D1：modals/newnote.js）——open/title/pending 走 store.modal.newnote；newNoteOpenRef/newNoteInputRef/setNewNoteOpen/openNewNote 为该模块顶层绑定
        // panel 订阅 open 供自动聚焦 effect（原口径）；newNoteKind 因 check 锚定其 useState 声明原文而滞留本面板，经 props/转发别名接入 modal
        const newNoteOpen = store.modal.newnote.useSel(s => s.open)
        const [newNoteKind, setNewNoteKind] = React.useState('note')   // 二期：新建选类型，按 KIND_TEMPLATES 预填骨架
        // 注入范围浮层已拆出（§6 步骤 E：popovers/scope.js——sessList/sessPending/scopeOpen 态 + 会话轮询 + injectScopeLabel + 浮层 JSX
        // 归 usePanelScope；setRoleSeg 联动开合经 kernel 转发别名 setScopeOpen；open/notes/edScope 经入参注入）
        // 注入范围浮层 hook 调用点后移（§6 步骤 E：usePanelScope 依赖编辑器域 edScope——editor hook 先行，见 wiki 装配点后）
        // 派发对话框已拆出（§6 步骤 D2：modals/dispatch.js）——open/activeSessions/pending/dispatching/mode/instr 走 store.modal.dispatch；
        // dispatchOpenRef/loadActiveSessions/loadWorkspaces/openDispatch/doDispatchConfirm/doDispatchDone 为该模块顶层绑定（拼接序位对本面板可见）；
        // panel 订阅 open/dispatching 供全局错误条互斥与编辑器「派发」按钮忙态（原渲染期读取口径）
        const dispatchOpen = store.modal.dispatch.useSel(s => s.open)
        const dispatching = store.modal.dispatch.useSel(s => s.dispatching)
        // ===== 双模式编辑器 v3（原型 design/notes-editor-v3.html）：源码 textarea ⇄ 富文本受限 WYSIWYG =====
        // editorMode/degraded/degradedRef/richSyncing 已随 panel/editor.js 迁出（usePanelEditor hook 内同文）；
        // editorModeRef 在 kernel/state.js 跨域镜像群（panel/keyboard.js Ctrl+/ 直读；镜像写入随 panel/editor.js hook 内同文）
        // 图片插入弹窗已拆出（architecture-modular §6 步骤 D1：modals/image.js）——state 走 store.modal.image，imgModalRef/setImgModal/openImgModal/pickImageFile 等为该模块顶层绑定
        // 链接插入弹窗已拆出（architecture-modular §6 步骤 D1：modals/link.js）——state 走 store.modal.link，linkModalRef/setLinkModal 为该模块顶层绑定
        // 笔记行右键菜单已拆出（§6 步骤 E：popovers/ctx-menu.js——ctxMenu/ctxNewFolderText 态 + openCtxMenu/ctxSetStatus/ctxMoveToFolder/
        // ctxCreateFolderMove + 菜单 JSX 归 usePanelCtxMenu；ctxMenuRef 为该模块顶层绑定，Esc 直读；folders 经入参注入）
        const { setCtxMenu, openCtxMenu, ctxMoveToFolder, ctxMenuEl } = usePanelCtxMenu({ folders: folders })
        // 派发级联选择态（dispatchWsId/dispatchSessWs/dispatchSessId/wsList）随 dispatch modal 迁出（modals/dispatch.js）
        // dispatchHistoryOpen（派发历史折叠态）已随 panel/editor.js 迁出（编辑器域派发历史区同文随迁）
        // 设置卡片已拆出（§6 步骤 D2：modals/settings.js——open/data/llm/catalog/stale/budget/usageData/usageBudget/saving/logWeek/logRetention
        // 走 store.modal.settings；usageBudgetRef/setPersistRef/settingsFlushRef/settingsOpenRef 为模块级单例；openSettings/saveSettings*/restoreSettingsAll/
        // flushSettingsPending/closeSettings/SET_NUM_FIELDS 迁入）；panel 经 panelBridge.setSettingsOpen 回填别名中转互斥关闭
        // 下列 3 项因 check 锚定其 useState 声明原文而滞留本面板（同 newNoteKind 先例），值经 props 注入 SettingsModal、setter/值经 panelBridge 供模块函数读写
        const [setSnap, setSetSnap] = React.useState(null)        // 打开时快照（UI 形态值；dirty 判定与还原回滚的基准）
        const [setInflight, setSetInflight] = React.useState(0)   // 在途设置写数（>0 = 存在尚未落盘的待写）
        const [setMaxDepth, setSetMaxDepth] = React.useState('3')   // 文件夹嵌套深度上限（maxFolderDepth，层；0=不限，缺省 3）
        // 数据导入/导出对话框已拆出（§6 步骤 D2：modals/export.js + export-single.js + import.js——open/dir/scope/folder/tag/toc/preview/overwrite/pending
        // 各走 store 切片，exportOpenRef/sExportOpenRef/importOpenRef 为模块级 Esc 镜像）；panel 订阅 open 供全局错误条互斥（原渲染期读取口径）
        const exportOpen = store.modal.export.useSel(s => s.open)
        const sExportOpen = store.modal.exportSingle.useSel(s => s.open)
        const importOpen = store.modal.import.useSel(s => s.open)
        // ===== 显式归档 UI：预览对话框（速记组勾选 → 确认执行 → toast 可撤销）+ 手动笔记多选合并 =====
        // 归档预览 modal 已拆出（§6 步骤 D1：modals/archive.js——open/groups/checked/expand/pending 走 store.modal.archive，openArchive/doArchiveConfirm/doArchiveUndo 迁入）
        // 多选操作条已拆出（§6 步骤 E：popovers/selbar.js——selMode/selIds/selDelPending 态 + toggleSelMode/toggleSelId/
        // doSelBatchDelete + 操作条 JSX 归 usePanelSelbar；selModeRef 为该模块顶层绑定；Esc/拖拽守卫直读该绑定，序位在前）
        const { selMode, selIds, selDelPending, setSelMode, setSelIds, toggleSelMode, toggleSelId, selbarEl } = usePanelSelbar()
        // 多选合并标题输入小对话框已拆出（§6 步骤 D1：modals/merge.js）——state 走 store.modal.merge，mergeOpenRef/setMergeOpen/openMerge 为该模块顶层绑定
        // ===== 二期 ✨整理：notes-ai-organize 按 kind 模板重写正文；organizing/organizeUndoRef 已随 panel/editor.js 迁出（一次撤销栈同文）=====
        // ===== 二期 孤儿资产清理已拆出（§6 步骤 D1：modals/prune.js——open/data/checked/pending 走 store.modal.prune，openPrune/doPruneConfirm 迁入）=====
        // panel 订阅 open 供全局错误条互斥（原渲染期读取口径）；dryRun 返回：{ orphans:[{name,bytes}], totalBytes, referenced, tombstoned, notes }
        const pruneOpen = store.modal.prune.useSel(s => s.open)
        // ===== P1 回收站已拆出（§6 步骤 D1：modals/trash.js——open/list/pending/sel/preview 走 store.modal.trash，openTrash/loadTrash/doTrash*/toggleTrash* 迁入）=====
        // panel 订阅 open 供全局错误条互斥（原渲染期读取口径）；回收站增强（notes-trash-batch-preview：批量选择 + 行内只读预览）随 modal 同域迁出
        const trashOpen = store.modal.trash.useSel(s => s.open)
        // 整理建议/注入预览/注入管理对话框已拆出（§6 步骤 D2：modals/suggest.js + inject-preview.js + inject-manager.js——
        // open/data/pending/logHgExpand、open/data/tab/sid、open/list/filter/search/q/sel/pending 各走 store 切片，openRef/搜索防抖 ref 为模块级单例）；
        // panel 订阅 open 供全局错误条互斥（原渲染期读取口径）
        const suggestOpen = store.modal.suggest.useSel(s => s.open)
        const injectPreviewOpen = store.modal.injectPreview.useSel(s => s.open)
        const injMgrOpen = store.modal.injMgr.useSel(s => s.open)
        // 0.4.3 验收修复③（notes-043-dir-merge）：注入预览改单段视图（约定段 + 合并目录段），原预览双 tab 状态已拆除
        // 工作记忆 v0 启用对话框已拆出（§6 步骤 D2：modals/memory-guide.js——status/open/scope/wsPick/sidPick/pending 走 store.modal.memory，
        // memScopeResolve/openMemEnable/doMemEnable/doMemDisable/memViewNote 迁入；memOpenRef 为模块级 Esc 镜像）；
        // 日志卫生窗口设置项（setLogWeek/setLogRetention）随设置卡迁入 modals/settings.js；panel 订阅 open 供全局错误条互斥（原渲染期读取口径）
        const memOpen = store.modal.memory.useSel(s => s.open)
        // ===== 历史版本面板（notes-history-ui）：详情 meta 行「历史」入口（有版本才显示）→ modal：版本列表（时间+大小）→ 点选只读预览 → 恢复 =====
        // 契约：notes-history {id}→{versions:[{ts,bytes}]}（倒序零正文）/ notes-history-get {id,ts}→{body} / notes-restore-history {id,ts}（恢复前当前版自动快照，可再撤销）
        // modal 本体已拆出（§6 步骤 D1：modals/history.js——open/list/sel/preview/pending 走 store.modal.history，openHistory/selectHistVersion/doRestoreHistory 迁入）；
        // panel 订阅 open 供全局错误条互斥（原渲染期读取口径）
        const histOpen = store.modal.history.useSel(s => s.open)
        // histCount/histCountRef 已随 panel/editor.js 迁出（历史入口探测归编辑器域；panelBridge.histCountRef/setHistCount 回填保持）
        // ===== P2 笔记双链：全库正文惰性索引（列表瘦身不含 body；后台 notes-get-batch 一次批量补齐，驱动行尾双链标记与反向链接面板）=====
        // 双链域已拆出（§6 步骤 E：panel/wiki.js——wikiVer 态 + 解析/索引/跳转函数族归 usePanelWiki；wikiBodiesRef/wikiIdxGenRef/jumpWikiRef
        // 为该模块顶层绑定；view/filters 经入参注入；selectNote/setView/setFilters 经 kernel 转发别名）
        const { wikiVer, ensureWikiIndex, bumpWikiBody, hasWikiLinks, wikiResolve, jumpToWikiTarget } = usePanelWiki({ view: view, filters: filters })
        // 编辑器域已拆出（§6 步骤 E：panel/editor.js——ed* 字段态/整理撤销栈/历史计数/双模式运行时 + selectNote/doSave/doDelete/
        // applyRestoredBody/probeHistCount/insertImageMd/三态开关/工具栏/富文本绑定 + renderEditorEl 渲染函数 归 usePanelEditor；
        // selected/notes/dispatching/wiki 族经入参注入；setSelected/setFocusId/later 等经 kernel 转发别名）
        const { edScope, selectNote, doDelete, applyRestoredBody, probeHistCount, histCountRef, setHistCount, insertImageMd, afterArchiveCleanup, toggleScope, keepSel, restoreSel, scheduleRichSync, setEditorModeState, edBodyDomRef, richRef, richDirtyRef, setEdBody, renderEditorEl } = usePanelEditor({ selected: selected, notes: notes, dispatching: dispatching, wikiVer: wikiVer, wikiResolve: wikiResolve, bumpWikiBody: bumpWikiBody, jumpToWikiTarget: jumpToWikiTarget })
        // 注入范围浮层已拆出（§6 步骤 E：popovers/scope.js；hook 调用点随 edScope 依赖后置于此——editor hook 先行回填 edScope）
        const { sessList, sessPending, scopeOpen, setScopeOpen, injectScopeLabel, scopePanelEl } = usePanelScope({ open: open, notes: notes, edScope: edScope })
        // keepQuickRef/edBodyDomRef/edLoadingRef/rich*Ref/ed*Ref/autoSaveRef 等编辑器运行时 ref 已随 panel/editor.js 迁出（hook 内同文）
        const timersRef = React.useRef([])
        // selectedRef 已迁 kernel/state.js（§6 步骤 D1：历史 modal 调用点被 check 锚定原文；本面板各处读写不变，解析到 kernel 同名绑定）
        // 拖拽状态 ref（dragNoteIdRef/dragFolderIdRef）已随 panel/tree.js 迁出（该模块顶层绑定）
        // 拖拽进行中标记 dragActive 同迁（驱动未入夹区「移出文件夹」落点提示行渲染）
        // 键盘导航所需的 ref：openRef/focusIdRef/selectNoteRef/closeRef/moveFocusRef/openNewNoteRef 已随 panel/keyboard.js 迁出（该模块顶层绑定）；
        // notesRef/searchRef/searchInputRef/searchDebRef/pagedIdsRef/switchModeRef/editorModeRef 迁 kernel/state.js 跨域镜像 ref 群（渲染期下方镜像块写入）
        // 展开态镜像到 ref（keydown 闭包挂一次，需读最新值避免过期）
        // ctxMenuRef 已随 popovers/ctx-menu.js 迁出（模块级单例，Esc 直读）
        // folderMenuRef/renamingIdRef/folderInputOpenRef/subFolderForRef 已随 popovers/folder-menu.js 迁出（该模块顶层绑定，Esc 直读）
        // 设置卡/派发/导出/单文件导出/导入/整理建议/注入预览/注入管理/工作记忆的 open 镜像 ref 随各 modal 迁入 modals/*.js
        //（模块级单例，setter 别名同步写入；Esc 栈直读模块顶层绑定——setter 名与镜像名不变，keydown 长链逐字不动）
        // histCountRef 已随 panel/editor.js 迁出（hook 内同文，经上方解构接入回填 panelBridge）
        // selModeRef 已随多选操作条迁入 popovers/selbar.js（模块级单例，Esc 栈/拖拽守卫直读）
        // 自动保存的编辑字段 ref 群 + autoSaveRef 已随 panel/editor.js 迁出（hook 内同文）
        React.useEffect(() => { selectedRef.current = selected }, [selected])
        function later(fn, ms) { try { const d = timer.timeout(fn, ms); timersRef.current.push(d); return d } catch (err) { return null } }
        React.useEffect(() => {
          const arr = timersRef.current
          timersRef.current = []
          for (const d of arr) { try { d() } catch (err) {} }
        }, [])
        // 面板位置/尺寸持久化恢复 + saveState 已随 panel/chrome.js 迁入（hook 内同文）
        React.useEffect(() => { const fn = (s) => { if (s.panelOpen !== undefined) setOpen(s.panelOpen) }; listeners.add(fn); return () => listeners.delete(fn) }, [])
        // 注入范围浮层的会话清单轮询 + 点外关闭 effect 已随 popovers/scope.js 迁入（该 hook 内同文，open/notes 经入参注入）
        // 筛选中心浮层点外关闭 effect 已随 popovers/sort-menu.js 迁入（popover + 排序菜单共享同一 effect，同文）
        // 派发对话框是 modal（自带 mask 点击外部关闭），无需 document 监听
        React.useEffect(() => { const fn = () => loadNotes(true); noteRefreshListeners.add(fn); return () => noteRefreshListeners.delete(fn) }, [])
        React.useEffect(() => { if (open) loadNotes() }, [open])
        // ⑩ kind 档切换重拉：类型组勾选变化改变取数口径（恰选 1 个 kind → host kind 通道；「机器」档 = sys 全库）——
        // effect 依赖 kinds 数组身份（filter-pop 勾选产生新数组），该渲染闭包的 loadNotes 读最新 filters；面板关闭时不拉（下次 open  effect 兜底）
        React.useEffect(() => { if (open) loadNotes(true) }, [filters.kinds])
        // 打开时居中定位 effect 已随 panel/chrome.js 迁入（hook 内同文，open 经入参注入）
        // 搜索两段式已拆出（§6 步骤 E：panel/search.js——searchText/searchIds/searchMatches 态 + 250ms 防抖 host 检索归 usePanelSearch；
        // searchRef/searchDebRef 在 kernel/state.js 跨域镜像群；filtersRef 镜像随该模块；filters 经入参注入）
        const { searchText, searchIds, searchMatches, setSearchText, setSearchIds, setSearchMatches } = usePanelSearch({ filters: filters })
        // 注入管理面板搜索防抖（250ms）随 modal 迁入 modals/inject-manager.js（injMgrSearchRef/injMgrSearchDebRef 为模块级单例，防抖 effect 挂 InjMgrModal）
        // 搜索/视图/筛选中心条件变化时重置分页 effect 已随 panel/tree.js 迁入（该 hook 内同文，入参注入依赖值）
        // 树渲染/分页/拖拽已拆出（§6 步骤 E：panel/tree.js——visibleCount/dragActive/topicExpanded/topicSecOpen 态 +
        // onListScroll/双向拖拽族/renderTreeEls（内含 renderNoteRow/renderFolderNode）归 usePanelTree；post-guard 求值经 R 入参注入）
        const { visibleCount, setVisibleCount, onListScroll, renderTreeEls } = usePanelTree({ notes: notes, view: view, filters: filters, searchText: searchText, searchIds: searchIds, folders: folders, sysKids: sysKids, showHidden: showHidden })
        // 展开态同步到 ref（keydown 闭包读 ref 避免过期；已拆出 modal 的 open 镜像由各模块 setter 别名同步写入）
        // filtersRef 镜像 + 同步 effect 已随 panel/search.js 迁入（该模块顶层绑定 + hook 内同文）
        // 日志同权（0.4.3 验收修复⑦，用户裁决推翻 R-6 UI 隐身）：kind=log 随默认列表直达（host 已收编），
        // 原「勾选日志/文件夹视图 → includeLogs 重拉」翻转 effect 与 overlay 特化路径已拆除——展开日志夹与普通夹同一代码路径（零额外 RPC）
        // filterOpen/sortOpen 的 ref 镜像 effect 已随 popovers/filter-pop.js / sort-menu.js 迁入（各自 hook 内同文）
        // ctxMenuRef 同步 effect 已随 popovers/ctx-menu.js 迁入（该 hook 内同文）
        // folderMenu/renamingId/folderInputOpen/subFolderFor 的 ref 镜像 effect 已随 popovers/folder-menu.js 迁入（该 hook 内同文）
        // histCountRef 同步 effect 已随 panel/editor.js 迁入（hook 内同文）
        // selModeRef 同步 effect 已随 popovers/selbar.js 迁入（该 hook 内同文）
        // 新建 modal 打开时自动聚焦标题输入框（Alt+N / 侧栏「新建」chip 均由此聚焦）
        React.useEffect(() => { if (newNoteOpen && newNoteInputRef.current) newNoteInputRef.current.focus() }, [newNoteOpen])
        // 键盘导航已拆出（§6 步骤 E：panel/keyboard.js——keydown 监听（Esc 分层栈/Ctrl+K/N/// + j/k 导航）归 usePanelKeyboard；
        // 所需 ref 为该模块顶层绑定 + kernel/state.js 跨域镜像群；本面板经下方镜像块每渲染回填最新值）
        usePanelKeyboard()
        // 标题栏/resize/分隔条拖拽族已随 panel/chrome.js 迁出（usePanelChrome hook 内同文）
        // silent=true 时不显 loading（后台静默刷新，避免闪烁）
        // 日志同权（0.4.3⑦）：列表恒为全量口径（日志随默认列表直达，不再按勾选/视图翻转参数）
        // 0.4.3⑩（notes-043-archive-folder 第二轮裁决）：类型组恰选 1 个 kind 时传 {kind} 给 host——host 谓词 kind 真值短路放行 sys
        // （⑨ 保留的显式 kind 入口），「机器」档（kind=sys）= 全库 sys 笔记（含「记忆档案」夹内档案），树在该档下正常展开档案子行；
        // 不选/多选 kind 时无参调用，行为与 ⑨ 完全一致（缺省降噪）。口径同 panel/search.js sArgs（恰选 1 个可传 kind）。
        // filters 经 filtersRef（search.js 镜像，每渲染同步）读取——noteRefreshListeners 挂载期注册的闭包也能拿到最新筛选（防过期）
        async function loadNotes(silent) { if (!silent) setLoading(true); setError(''); let list = []; try { const F = filtersRef.current || filters; const kf = (F && F.kinds) || []; const res = await host.call('notes-list', kf.length === 1 ? { kind: kf[0] } : undefined); list = res.notes || []; setNotes(list) } catch (err) { setError(String(err.message || err)) } loadFolders(); ensureWikiIndex(list); if (!silent) setLoading(false); return list }
        // 文件夹清单加载已随 popovers/folder-menu.js 迁出（loadFolders 经解构接入；清洗陈旧展开 id 逻辑同文随迁）
        // ===== P2 笔记双链：解析 / 索引 / 跳转 函数族已随 panel/wiki.js 迁出（上方解构接入；内核 extractWikiTargets/wikiLinksTo 同一口径）=====
        // selectNote/doSave/doDelete 已随 panel/editor.js 迁出（经解构/kernel 转发别名接入；panelBridge 回填保持原名）
        openNewNoteRef.current = openNewNote
        // ===== 虚拟文件夹树交互：折叠切换/自动展开/新建/重命名/删除/排序 + 笔记移动（管理走 notes-folders RPC，移动走 notes-update 的 folder 字段）=====
        // 嵌套 helper 族（folderSubtreeIdsOf/childFoldersOf/rootFolders/folderPathOf/isFolderExpanded/toggleFolder/expandFolder）+
        // openFolderMenu + doCreateFolder/doRenameFolder/doDeleteFolder/doReorderFolder/doReparentFolder 已随 popovers/folder-menu.js 迁出（上方解构接入）
        // 主题过滤行原地展开切换 toggleTopicExpanded 已随 panel/tree.js 迁出（同文）
        // 自动展开/菜单打开/CRUD/reorder/reparent 已迁 popovers/folder-menu.js（同文）
        // 笔记行右键「移动到文件夹」/「新建文件夹…」（ctxMoveToFolder/ctxCreateFolderMove）已随 popovers/ctx-menu.js 迁出
        // ===== 拖拽挪入/挪出文件夹（HTML5 DnD；与右键「移动到文件夹」共用 ctxMoveToFolder 移动逻辑）=====
        // 双向拖拽族（onNoteDrag*/onFolderDrag*/onUnfiled*）已随 panel/tree.js 迁出（同文；dragNoteIdRef/dragFolderIdRef 为该模块顶层绑定）
        // 点击菜单外部关闭 effect 已随 popovers/ctx-menu.js / folder-menu.js 迁入各自 hook（同文）
        function close() { panelOpen = false; notify() }
        // jumpToSession（来源会话跳转）已随 panel/editor.js 迁出（编辑器 meta 行「来源」按钮同域）
        // setRoleSeg/toggleSens/toggleScope（注入三态/敏感/范围多选）已随 panel/editor.js 迁出（同文；
        // setScopeOpen 联动经 kernel 转发别名 → panelBridge 回填；「目录可见」开关随 0.4.3⑪ chip 拆除退役）
        // ===== 双模式编辑器 v3：模式切换 / 序列化同步 / 工具栏 / 图片三入口 已随 panel/editor.js 迁出（switchMode/syncFromRich/scheduleRichSync/
        // scheduleDegAnalyze/keepSel/restoreSel/toolbarAction/updateToolbarState/insertSanitizedHtml/insertImageMd + 富文本绑定 effect，同文）=====
        // 派发链路已拆出（§6 步骤 D2：modals/dispatch.js——loadActiveSessions/loadWorkspaces/openDispatch 迁入，
        // 模块顶层绑定经拼接序位对本面板可见；0.1.7 占位轮询经 panelBridge.later 中转，dispatchOpenRef 为模块级终止条件镜像）
        // 设置卡链路已拆出（§6 步骤 D2：modals/settings.js——openSettings/maybeToastUsageBudget/settingsSetQuiet/setPersistMerge/saveSettings*/
        // saveSettingsAll/restoreSettingsAll/flushSettingsPending/closeSettings/SET_NUM_FIELDS 迁入，模块顶层绑定经拼接序位对本面板可见；
        // settingsOpenRef/usageBudgetRef/setPersistRef/settingsFlushRef 为模块级单例，Esc 栈直读模块绑定）
        // 工作记忆 v0 链路已拆出（§6 步骤 D2：modals/memory-guide.js——memScopeResolve/openMemEnable/doMemEnable/doMemDisable/memViewNote 迁入，
        // 模块顶层绑定经拼接序位对本面板可见；作用域解析数据源经 panelBridge.sessList/sessPending 中转）
        // 数据导入/导出链路已拆出（§6 步骤 D2：modals/export.js + export-single.js + import.js——open/do 系列函数迁入，
        // 模块顶层绑定经拼接序位对本面板可见；设置卡互斥经 panelBridge.setSettingsOpen 中转）
        // 派发确认/回执已随 dispatch modal 迁出（§6 步骤 D2：modals/dispatch.js——doDispatchConfirm/doDispatchDone 迁入，
        // 当前选中笔记读 kernel selectedRef，正文回填经 panelBridge.setEdBody 中转）
        // ===== 显式归档：预览 → 勾选 → 执行 → toast 撤销 =====
        // 归档后清理 afterArchiveCleanup 已随 panel/editor.js 迁出（同文；panelBridge.afterArchiveCleanup 回填保持）
        // 归档预览弹窗链路已拆出（§6 步骤 D1：modals/archive.js——openArchive/doArchiveConfirm/doArchiveUndo 迁入，模块顶层绑定经拼接序位对本面板可见；
        // doArchiveUndo 由 ArchiveModal 渲染期回填 panelBridge，merge modal 的撤销 toast 经 kernel 转发别名调最新实例）
        // 孤儿资产清理弹窗链路已拆出（§6 步骤 D1：modals/prune.js——openPrune/doPruneConfirm 迁入，模块顶层绑定经拼接序位对本面板可见）
        // 回收站弹窗链路已拆出（§6 步骤 D1：modals/trash.js——openTrash/loadTrash/doTrash*/toggleTrash* 迁入，模块顶层绑定经拼接序位对本面板可见）
        // 注入预览链路已拆出（§6 步骤 D2：modals/inject-preview.js——openInjectPreview/loadInjectPreview 迁入，模块顶层绑定经拼接序位对本面板可见）
        // 注入管理链路已拆出（§6 步骤 D2：modals/inject-manager.js——openInjectManager/loadInjectManager/injMgrRole/injMgrScopeLabel/doInjMgrSet/toggleInjMgrSel/doInjMgrBatch 迁入，
        // 模块顶层绑定经拼接序位对本面板可见；搜索防抖 ref/句柄为模块级单例，防抖 effect 挂 InjMgrModal）
        // 整理建议链路已拆出（§6 步骤 D2：modals/suggest.js——open/load/go-archive/view/batch-delete 系列函数迁入，
        // 模块顶层绑定经拼接序位对本面板可见；「去归档」直调 archive 模块 openArchive（序位在前可见），孤儿「查看」经 kernel jumpToWikiTarget 别名中转）
        // ===== 手动笔记多选合并：「选择」chip / 右键「合并为一篇」进多选态 → 底部操作条 → 标题输入 → notes-archive =====
        // toggleSelMode/toggleSelId/doSelBatchDelete 已随多选操作条迁入 popovers/selbar.js（usePanelSelbar hook 内同文，
        // 本面板经上方解构接入；selIds 快照供 merge modal 经 panelBridge.selIds 读取——回填行见下）
        // 同步键盘导航所需 ref（keydown 监听挂一次，每次渲染刷新最新值）
        openRef.current = open
        focusIdRef.current = focusId
        notesRef.current = notes
        selectNoteRef.current = selectNote
        closeRef.current = close
        moveFocusRef.current = (ids, delta) => {
          setFocusId(prev => {
            const idx = prev ? ids.indexOf(prev) : -1
            const next = idx < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, idx + delta))
            return (ids[next] != null) ? ids[next] : null
          })
        }
        // 编辑字段 ref 镜像块 + 双模式 ref 镜像块已随 panel/editor.js 迁入（hook 内同文；editorModeRef/switchModeRef 写 kernel 镜像群）
        // ===== panel 能力桥回填（architecture-modular §4.2/§6 步骤 D1：modals 禁横向引用，面板能力经 kernel panelBridge 中转）=====
        // 每渲染刷新（与上方 ref 镜像群同口径）；ref 对象与 useState setter 恒等，函数取当次渲染闭包
        panelBridge.setError = setError
        panelBridge.setShowHelp = setShowHelp   // popovers/help.js（kernel 转发别名 → 本回填）
        panelBridge.loadNotes = loadNotes
        panelBridge.loadFolders = loadFolders
        panelBridge.selectNote = selectNote
        panelBridge.setFlashId = setFlashId
        panelBridge.setSelected = setSelected   // 编辑器域跨域写入（selectNote/doDelete/afterArchiveCleanup 经 kernel 别名中转）
        panelBridge.setFocusId = setFocusId     // 同上（selectNote 同步聚焦行）
        panelBridge.setVisibleCount = setVisibleCount   // 侧栏搜索输入 onChange 重置分页（panel/tree.js setter 经 kernel 别名中转）
        panelBridge.setView = setView           // 编辑器面包屑/双链跳转/树视图过滤跨域写入（kernel 别名中转）
        panelBridge.later = later
        panelBridge.edBodyDomRef = edBodyDomRef
        panelBridge.setEditorModeState = setEditorModeState
        panelBridge.setNewNoteKind = setNewNoteKind
        panelBridge.insertImageMd = insertImageMd
        panelBridge.applyRestoredBody = applyRestoredBody
        panelBridge.probeHistCount = probeHistCount
        panelBridge.histCountRef = histCountRef
        panelBridge.setHistCount = setHistCount
        panelBridge.setSettingsOpen = setSettingsOpen
        panelBridge.openSettings = openSettings   // 单层返回栈（notes-041-settings-back）：二级面板关闭回设置卡经本桥中转（modals 禁横向引用）
        panelBridge.setSelMode = setSelMode
        panelBridge.setSelIds = setSelIds   // popovers/selbar.js（kernel 转发别名 → 本回填；Esc/右键「合并为一篇」跨域写入）
        panelBridge.toggleSelMode = toggleSelMode   // 同上（侧栏「选择」chip 调用点文本被锚定，经 kernel 别名中转）
        panelBridge.toggleSelId = toggleSelId   // 同上（树行复选框/行点击勾选）
        // popovers/folder-menu.js 回填（kernel 转发别名 → 本桥；面板域内调用点经上方解构直取，不走本桥）
        panelBridge.expandFolder = expandFolder
        panelBridge.toggleFolder = toggleFolder
        panelBridge.isFolderExpanded = isFolderExpanded
        panelBridge.folderSubtreeIdsOf = folderSubtreeIdsOf
        panelBridge.childFoldersOf = childFoldersOf
        panelBridge.rootFolders = rootFolders
        panelBridge.folderPathOf = folderPathOf
        panelBridge.folderName = folderName
        panelBridge.doCreateFolder = doCreateFolder
        panelBridge.doRenameFolder = doRenameFolder
        panelBridge.doDeleteFolder = doDeleteFolder
        panelBridge.doReorderFolder = doReorderFolder
        panelBridge.doReparentFolder = doReparentFolder
        panelBridge.setRenamingId = setRenamingId
        panelBridge.setRenameText = setRenameText
        panelBridge.setFolderInputOpen = setFolderInputOpen
        panelBridge.setFolderInputText = setFolderInputText
        panelBridge.setSubFolderFor = setSubFolderFor
        panelBridge.setFolderMenu = setFolderMenu
        // popovers/ctx-menu.js 回填（kernel 转发别名 → 本桥；Esc/拖拽 drop 等调用点经别名中转）
        panelBridge.setCtxMenu = setCtxMenu
        panelBridge.ctxMoveToFolder = ctxMoveToFolder
        panelBridge.doDelete = doDelete   // 编辑器域删除（ctx-menu「删除」项跨域调用；doDelete 滞留本面板，editor.js 迁出后同源回填）
        panelBridge.setScopeOpen = setScopeOpen   // popovers/scope.js（kernel 转发别名 → 本回填；setRoleSeg 联动开合）
        panelBridge.toggleScope = toggleScope   // 范围浮层勾选跨域调用（popover → 编辑器域，经 kernel 别名中转）
        // popovers/filter-pop.js + sort-menu.js 回填（kernel 转发别名 → 本桥；筛选/排序状态机滞留本面板——useState 声明被锚定）
        panelBridge.setFilters = setFilters
        panelBridge.setShowHidden = setShowHidden   // 0.4.4-D：筛选中心「显示隐藏」开关写入桥（popovers/filter-pop.js 经 kernel 别名中转）
        panelBridge.setSortBy = setSortBy
        panelBridge.setFilterOpen = setFilterOpen
        panelBridge.setSortOpen = setSortOpen
        // 搜索域 setter 回填（kernel 转发别名 → 本桥；Esc 清搜索跨域调用；search.js 迁出后同源回填）
        panelBridge.setSearchText = setSearchText
        panelBridge.setSearchIds = setSearchIds
        panelBridge.setSearchMatches = setSearchMatches
        // panel/tree.js + popovers 域能力回填（kernel 转发别名 → 本桥；树行/树行右键/双链标记/范围文字跨域调用点经别名中转）
        panelBridge.openCtxMenu = openCtxMenu
        panelBridge.openFolderMenu = openFolderMenu
        panelBridge.injectScopeLabel = injectScopeLabel
        panelBridge.hasWikiLinks = hasWikiLinks
        panelBridge.selIds = selIds
        panelBridge.notes = notes
        panelBridge.afterArchiveCleanup = afterArchiveCleanup
        // doArchiveUndo 已随 archive modal 迁出：由 ArchiveModal 渲染期回填 panelBridge（本面板不再持有该函数）
        panelBridge.wikiResolve = wikiResolve
        panelBridge.restoreSel = restoreSel
        panelBridge.keepSel = keepSel
        panelBridge.richRef = richRef
        panelBridge.richDirtyRef = richDirtyRef
        panelBridge.scheduleRichSync = scheduleRichSync
        panelBridge.sessList = sessList
        panelBridge.sessPending = sessPending
        panelBridge.jumpToWikiTarget = jumpToWikiTarget
        panelBridge.setEdBody = setEdBody   // dispatch 确认后回填正文（modals/dispatch.js 经此中转，禁横向引用）
        panelBridge.openDispatchEdit = openDispatchEdit   // 调度任务「编辑」回填派发弹窗（modals/inject-manager.js 经此中转，禁横向引用——序位 inject-manager 先于 dispatch）
        panelBridge.openMountModal = openMountModal   // 预览目录行点击开挂载弹层（modals/inject-preview.js 经此中转，禁横向引用——序位 inject-preview 先于 inject-manager）
        // check 锚定 useState 声明而滞留本面板的字段：值/ setter 回填供 modal 模块函数读写（每渲染刷新，点击期口径与昔日闭包一致）
        panelBridge.setMaxDepth = setMaxDepth
        panelBridge.setSetMaxDepth = setSetMaxDepth
        panelBridge.setSnap = setSnap
        panelBridge.setSetSnap = setSetSnap
        panelBridge.setInflight = setInflight
        panelBridge.setSetInflight = setSetInflight
        // 自动保存 debounce 初始化 + triggerAutoSave 已随 panel/editor.js 迁入（hook 内同文，900ms 口径不变）
        if (!open) return null
        // 搜索关键词 <mark> 高亮（防 XSS）已迁 panel/search.js（模块级纯函数 highlight，序位在前对本面板可见）：q 先做正则元字符转义，split 片段全是纯文本、经 React 转义渲染后再包 mark 元素——绝不用 innerHTML 拼原文
        // folderName 已随 popovers/folder-menu.js 迁出（经解构接入；树行尾/视图头/面包屑沿用）
        const q = searchText.trim().toLowerCase()
        const localFiltered = q ? notes.filter(n => { const hay = ((n.title || '') + ' ' + (n.preview || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ') + ' ' + folderName(n.folder)).toLowerCase(); return hay.indexOf(q) >= 0 }) : notes
        // 搜索结果取 host 全文 + 本地即时的并集，RPC 失败/延迟时本地结果保底
        let filtered = searchIds ? notes.filter(n => searchIds.indexOf(n.id) >= 0 || localFiltered.indexOf(n) >= 0) : localFiltered
        // 视图求值（原型 matches）：view 单选（all/topic）∩ 筛选中心（状态组/类型组，组内 OR 跨组 AND）∩ 搜索
        if (view.type === 'topic') filtered = filtered.filter(n => (n.topic || '') === view.id)
        // 日志同权（0.4.3⑦）：无隐身渲染守卫——日志与普通笔记同一过滤管线（类型组勾选「日志」= 只看日志，与普通 kind 过滤同语义）
        filtered = filtered.filter(n => matchFilters(n, filters))
        // 0.4.4-D hidden 纯 UI 遮罩：显隐开关关 → hidden 项从求值结果滤除（树/置顶组/未入夹/主题区同管线一并消失）；
        // OS 语义：note 级 hidden 与 folder 级 hidden 独立判定——父夹 hidden 即其子孙链内笔记一并不可见（hiddenSubtree 子树口径），
        // 直挂笔记行随 nested 容器消失、置顶聚合/主题区同样不再混入；滤除时机在筛选谓词之后、sysKids 合并（panel/tree.js 同层谓词）之前，与 C 卡零互扰；
        // 跳转/open-by-id（反向链接/派发执行记录/搜索命中打开）不经本管线，天然常显（编辑器正常渲染 + meta 区 hidden chip 可切回）
        if (!showHidden) {
          const hiddenSubtree = {}
          for (const f of folders) if (f.hidden === true) Object.assign(hiddenSubtree, folderSubtreeIdsOf(f.id))
          filtered = filtered.filter(n => n.hidden !== true && !hiddenSubtree[(n.folder || '')])
        }
        // 相关度档位（搜索体验升级）：标题命中(3) > 标签命中(2) > 正文命中(1) > 其他(0，如仅 topic 命中)，同级 updatedAt 降序；
        // 命中字段优先取 host notes-search 返回的 matches（全文口径），无则按本地字段估算（preview 仅前 200 字，正文命中可能低估）；无搜索词时退化为 host 序
        function relRank(n) {
          const m = searchMatches[n.id]
          if (m && m.length) { if (m.indexOf('title') >= 0) return 3; if (m.indexOf('tags') >= 0) return 2; if (m.indexOf('body') >= 0) return 1; return 0 }
          if ((n.title || '').toLowerCase().indexOf(q) >= 0) return 3
          if ((n.tags || []).join(' ').toLowerCase().indexOf(q) >= 0) return 2
          if ((n.preview || '').toLowerCase().indexOf(q) >= 0) return 1
          return 0
        }
        // 排序（P2 使用遥测 + 相关度档位）：缺省保持 host 序（pinned → updatedAt 降序）；「按引用」= useCount 降序（同数按 updatedAt 兜底），分组内顺序随过滤数组
        if (sortBy === 'use') filtered = filtered.slice().sort((a, b) => ((b.useCount || 0) - (a.useCount || 0)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        else if (sortBy === 'rel' && q) filtered = filtered.slice().sort((a, b) => (relRank(b) - relRank(a)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        // 懒加载分页：只渲染前 visibleCount 条笔记行，滚动到底再加载更多（避免笔记多时全量渲染 + 每条跑 highlight）
        const paged = filtered.slice(0, visibleCount)
        const hasMore = filtered.length > visibleCount
        // onListScroll 已随 panel/tree.js 迁出（经解构接入；树容器 onScroll 沿用）
        // 注入范围文字函数 injectScopeLabel 已随 popovers/scope.js 迁出（经解构接入；树行尾 bolt tooltip 沿用）
        // ===== 侧栏笔记行 renderNoteRow + 侧栏树构建已随 panel/tree.js 迁出（renderTreeEls 渲染函数内同文；求值上下文经 R 入参注入）=====
        // 筛选中心：激活条件数 = 状态组勾选数 + 类型组勾选数（排序档位不计入）
        const filterCount = FILTER_STATUS.reduce((s, f) => s + (filters[f.id] ? 1 : 0), 0) + filters.kinds.length
        const filtersActive = view.type !== 'all' || filterCount > 0 || !!q
        // 曾注入条件 feature-detect：列表 slim 含 injectEver 字段才显示该选项（host 未提供时隐藏；存量激活条件仍渲染 chip 可 × 移除）
        const hasInjectEver = notes.some(n => n.injectEver !== undefined)
        const sortLabel = sortLabelOf(sortBy)   /* i18n 覆盖卡F：排序档标签走 t() 字典（sort.* 条件映射），FILTER_SORTS[i].label 字面量仅作四端同构锚 */
        // 筛选中心浮层 JSX 依赖视图求值结果（命中数/曾注入 feature-detect）——装配点在求值后渲染（popover 与主面板同渲染边界，口径不变）
        const filterPopEl = renderFilterPop({ notes: notes, filters: filters, hasInjectEver: hasInjectEver, filteredCount: filtered.length, searchDebRef: searchDebRef })
        // viewTitle 计算已随 panel/tree.js 迁入 renderTreeEls（同文）
        const treeEls = renderTreeEls({ loading: loading, selected: selected, focusId: focusId, flashId: flashId, selMode: selMode, selIds: selIds, q: q, filtered: filtered, paged: paged, filtersActive: filtersActive, filterCount: filterCount, hasInjectEver: hasInjectEver, renamingId: renamingId, renameText: renameText, subFolderFor: subFolderFor, folderInputOpen: folderInputOpen, folderInputText: folderInputText })
        // 侧栏 JSX 已随 panel/sidebar.js 迁出（renderSidebar 注册函数，post-guard 求值结果经 R 入参注入）
        const sidebarEl = renderSidebar({ sideW: sideW, size: size, notes: notes, filtersActive: filtersActive, filtered: filtered, filters: filters, sortBy: sortBy, searchText: searchText, filterCount: filterCount, filterOpen: filterOpen, sortOpen: sortOpen, sortLabel: sortLabel, sortMenuEl: sortMenuEl, filterPopEl: filterPopEl, treeEls: treeEls, hasMore: hasMore, paged: paged, onListScroll: onListScroll, selMode: selMode })
        // 树构建主体（视图头/置顶组/文件夹递归/未入夹平铺/主题全局过滤/空态/加载态 + pagedIdsRef 写入）已随 panel/tree.js 迁入 renderTreeEls（同文）
        // ===== 编辑器区（原型 .ed）已随 panel/editor.js 迁出（renderEditorEl 渲染函数内同文：面包屑/meta chips/双模式正文/反向链接/底栏；post-guard 调用口径不变）=====
        const { editorEl, curNote } = renderEditorEl({ scopePanelEl: scopePanelEl, scopeOpen: scopeOpen })
        // ===== 面板根：标题栏（拖拽/入口切换/归档/帮助/关闭）+ 两栏 app 区 + 浮层 =====
        return e('div', { className: 'dsh-notes-floating', style: { left: (pos.x || 0) + 'px', top: (pos.y || 0) + 'px', width: size.width + 'px', height: size.height + 'px' } },
          titlebarEl,
          helpEl,
          e('div', { className: 'dsh-notes-app' },
            sidebarEl,
            // ===== 侧栏分隔条：4px 拖拽条，叠加在两栏 10px 间隙上不占位（负 margin 抵消 gap）；hover/拖拽中高亮；双击重置 =====
            splitterEl,
            editorEl),
          resizeEl,
          error && !dispatchOpen && !exportOpen && !sExportOpen && !importOpen && !pruneOpen && !trashOpen && !injectPreviewOpen && !suggestOpen && !histOpen && !memOpen && !injMgrOpen ? e('div', { className: 'dsh-notes-error' }, error) : null,
          // 派发对话框已拆出（architecture-modular §6 步骤 D2：modals/dispatch.js；state 走 store.modal.dispatch，curNote 经 props 注入）
          e(DispatchModal, { error: error, curNote: curNote }),
          // 设置卡片已拆出（architecture-modular §6 步骤 D2：modals/settings.js；state 走 store.modal.settings，
          // 工作记忆状态行经 store.modal.memory 订阅 + memory-guide 模块顶层绑定（序位在前）接入）
          e(SettingsModal, { error: error, setMaxDepth: setMaxDepth, setSetMaxDepth: setSetMaxDepth, setSnap: setSnap, setInflight: setInflight }),
          // 键盘流速查表已拆出（notes-034-f-cheatsheet：modals/cheatsheet.js；state 走 store.modal.cheatsheet，? 键/Esc 栈经该模块顶层绑定接入）
          e(CheatsheetModal),
          // 工作记忆启用对话框已拆出（architecture-modular §6 步骤 D2：modals/memory-guide.js；state 走 store.modal.memory，sessList/sessPending 经 props 注入）
          e(MemoryGuideModal, { error: error, sessList: sessList, sessPending: sessPending }),
          // 导出对话框已拆出（architecture-modular §6 步骤 D2：modals/export.js；state 走 store.modal.export）
          e(ExportModal, { error: error }),
          // 单文件导出对话框已拆出（architecture-modular §6 步骤 D2：modals/export-single.js；state 走 store.modal.exportSingle，notes/folders 经 props 注入）
          e(SExportModal, { error: error, notes: notes, folders: folders }),
          // 导入对话框已拆出（architecture-modular §6 步骤 D2：modals/import.js；state 走 store.modal.import）
          e(ImportModal, { error: error }),
          // 图片插入弹窗已拆出（architecture-modular §6 步骤 D1：modals/image.js；state 走 store.modal.image）
          e(ImageModal),
          // 链接插入弹窗已拆出（architecture-modular §6 步骤 D1：modals/link.js；state 走 store.modal.link）
          e(LinkModal),
          // 归档预览对话框已拆出（architecture-modular §6 步骤 D1：modals/archive.js；state 走 store.modal.archive）
          e(ArchiveModal, { error: error }),
          // 资产清理对话框已拆出（architecture-modular §6 步骤 D1：modals/prune.js；state 走 store.modal.prune）
          e(PruneModal, { error: error }),
          // 回收站对话框已拆出（architecture-modular §6 步骤 D1：modals/trash.js；state 走 store.modal.trash）
          e(TrashModal, { error: error }),
          // 整理建议对话框已拆出（architecture-modular §6 步骤 D2：modals/suggest.js；state 走 store.modal.suggest）
          e(SuggestModal, { error: error }),
          // 注入预览对话框已拆出（architecture-modular §6 步骤 D2：modals/inject-preview.js；state 走 store.modal.injectPreview，sessList/sessPending 经 props 注入）
          e(InjectPreviewModal, { error: error, sessList: sessList, sessPending: sessPending }),
          // 注入管理面板已拆出（architecture-modular §6 步骤 D2：modals/inject-manager.js；state 走 store.modal.injMgr，搜索防抖 effect 挂 InjMgrModal）
          e(InjMgrModal, { error: error }),
          // 挂载弹层已随 inject-manager 迁入（0.4.3⑤ notes-043-index：modals/inject-manager.js 的 MountModal——资料开注入 → 手写 whenToUse 落索引行）
          e(MountModal),
          // 历史版本面板已拆出（architecture-modular §6 步骤 D1：modals/history.js；state 走 store.modal.history）
          e(HistoryModal, { error: error }),
          // 多选合并标题输入框已拆出（architecture-modular §6 步骤 D1：modals/merge.js；state 走 store.modal.merge，selIds 经 props 注入）
          e(MergeModal, { error: error, selIds: selIds }),
          // 新建笔记 modal 已拆出（architecture-modular §6 步骤 D1：modals/newnote.js；open/title/pending 走 store.modal.newnote，kind/notes/selected/view/error 经 props 注入）
          e(NewNoteModal, { error: error, notes: notes, selected: selected, view: view, newNoteKind: newNoteKind, setNewNoteKind: setNewNoteKind }),
          // 笔记行右键菜单已拆出（§6 步骤 E：popovers/ctx-menu.js；ctxMenuEl 自 usePanelCtxMenu 解构）
          ctxMenuEl,
          // 文件夹项右键菜单已拆出（§6 步骤 E：popovers/folder-menu.js；folderMenuEl 自 usePanelFolderMenu 解构）
          folderMenuEl,
          // 多选操作条已拆出（§6 步骤 E：popovers/selbar.js；selbarEl 自 usePanelSelbar 解构）
          selbarEl)
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-panel', order: 200 }, (props) => e(FloatingPanel, props))
    })
    if (typeof d3 === 'function') disposers.push(d3)

    ctx.effect(() => () => { for (const d of disposers) { try { d() } catch (e2) {} } })
    console.log('notes plugin: client ready')
  }
}
