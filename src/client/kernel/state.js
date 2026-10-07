    // 入口双模式：'header'（会话头部按钮）| 'fab'（可拖拽悬浮气泡）；互斥、可持久化
    let entryMode = 'header'
    let fabPos = { x: 16, y: 80 }   // 悬浮气泡默认位置（左上角）
    const entryListeners = new Set()
    function loadEntryState() {
      try {
        const saved = localStorage.getItem('dsh-notes-entry')
        if (saved) {
          const s = JSON.parse(saved)
          if (s.mode === 'header' || s.mode === 'fab') entryMode = s.mode
          if (typeof s.fabX === 'number' && typeof s.fabY === 'number') fabPos = { x: s.fabX, y: s.fabY }
        }
      } catch (err) {}
    }
    function saveEntryState() { try { localStorage.setItem('dsh-notes-entry', JSON.stringify({ mode: entryMode, fabX: fabPos.x, fabY: fabPos.y })) } catch (err) {} }
    function notifyEntry() { entryListeners.forEach(fn => fn({ entryMode })) }
    function setEntryMode(m) { entryMode = m; saveEntryState(); notifyEntry() }

    // ===== 最小 store（architecture-modular.md §4.4 裁决）：带订阅的命名空间状态桶，禁 reducer/action/中间件 =====
    // createStore(slice) → { get, set(patch), subscribe(fn), useSel(selector) }；步骤 C/D 起各 modal state 迁入 store 切片
    function createStore(slice) {
      let state = slice || {}
      const subs = new Set()
      function get() { return state }
      function set(patch) { state = Object.assign({}, state, patch); subs.forEach(fn => fn()) }
      function subscribe(fn) { subs.add(fn); return () => subs.delete(fn) }
      function useSel(selector) {
        if (typeof React.useSyncExternalStore === 'function') return React.useSyncExternalStore(subscribe, () => selector(state))
        const pair = React.useState(() => selector(state))
        React.useEffect(() => subscribe(() => pair[1](selector(state))), [])
        return pair[0]
      }
      return { get, set, subscribe, useSel }
    }

    // ===== toast store（§6 步骤 C）：kernel/bus.js toast 宿主的数据桶；panels 侧经 toastStore.useSel(s => s.toast) 订阅 =====
    toastStore = createStore({ toast: '' })

    // ===== modal store 群 + panel 能力桥（architecture-modular §4.2/§4.4，§6 步骤 D1）=====
    // store.modal.<name> = 每个 modal 一个 createStore 切片（modals/*.js 各自回填 open/数据字段）；
    // open 态同时供 whole.js 订阅（Esc 栈/全局错误条互斥/自动聚焦等渲染期读取口径与单文件时代一致）。
    const store = { modal: {} }
    // panelBridge = FloatingPanel 每渲染回填的面板能力登记表（modal 模块禁横向引用，面板内部能力经此中转）
    const panelBridge = {}
    // 转发别名：check.js 锚定昔日单文件的源码形态（openNewNote 全文 / renderMarkdown(x, wikiResolve) / fn: doArchiveUndo 等），
    // modal 模块中的同名标识符解析到此处——运行期转调 panelBridge 内 FloatingPanel 回填的实函数，行为不变
    function setError(v) { return panelBridge.setError(v) }
    function setNewNoteKind(v) { return panelBridge.setNewNoteKind(v) }
    function wikiResolve(w) { return panelBridge.wikiResolve(w) }
    function doArchiveUndo() { return panelBridge.doArchiveUndo() }
    // jumpToWikiTarget（双链跳转/选中）属面板域（whole.js 内局部实现遮蔽本别名）：suggest「查看」/memory-guide「查看约定」经此中转（§6 步骤 D2）
    function jumpToWikiTarget(t) { return panelBridge.jumpToWikiTarget(t) }
    // selectedRef（当前选中笔记 id 镜像）迁入 kernel：历史版本 modal 的预览/恢复调用点被 check 锚定 selectedRef.current 原文，
    // 由 whole.js 渲染期写入、modal 模块直读（纯逻辑镜像 ref，从不挂 JSX——plain object 与 useRef 等价；面板为 shell.overlay 单例）
    const selectedRef = { current: null }

    // ===== panel 子域跨域转发别名群（architecture-modular §6 步骤 E）=====
    // FloatingPanel 拆为 panel/* 子域 hook + popovers/* 后，跨域调用点保持昔日裸名（Esc 栈长链/右键菜单/视图求值等
    // 调用点文本被 check.js 锚定，须原样保留）：统一经 kernel 转发别名 → panelBridge（panel/index.js 主组件每渲染
    // 自各子域 hook 回填实函数；setter 值/updater 函数形态透传不变）。依赖方向保持「popovers/panels → kernel」——
    // 子域 hook 内部同名局部绑定（useState 解构/嵌套函数声明）遮蔽本群别名，故子域内部代码逐字不动。
    function setView(v) { return panelBridge.setView(v) }
    function setFilters(v) { return panelBridge.setFilters(v) }
    function setShowHidden(v) { return panelBridge.setShowHidden(v) }   // 0.4.4-D：显隐开关跨域写入（popovers/filter-pop.js → panel/index.js state）
    function setSortBy(v) { return panelBridge.setSortBy(v) }
    function selectNote(n) { return panelBridge.selectNote(n) }
    function doDelete(id) { return panelBridge.doDelete(id) }
    function loadNotes(silent) { return panelBridge.loadNotes(silent) }
    function loadFolders() { return panelBridge.loadFolders() }
    function ctxMoveToFolder(n, folderId) { return panelBridge.ctxMoveToFolder(n, folderId) }
    function openCtxMenu(ev, n) { return panelBridge.openCtxMenu(ev, n) }
    function openFolderMenu(ev, f) { return panelBridge.openFolderMenu(ev, f) }
    function injectScopeLabel(injectTo) { return panelBridge.injectScopeLabel(injectTo) }
    function hasWikiLinks(n) { return panelBridge.hasWikiLinks(n) }
    function setSelected(v) { return panelBridge.setSelected(v) }
    function setFocusId(v) { return panelBridge.setFocusId(v) }
    function later(fn, ms) { return panelBridge.later(fn, ms) }
    function expandFolder(id) { return panelBridge.expandFolder(id) }
    function toggleFolder(id) { return panelBridge.toggleFolder(id) }
    function isFolderExpanded(id) { return panelBridge.isFolderExpanded(id) }
    function folderSubtreeIdsOf(id) { return panelBridge.folderSubtreeIdsOf(id) }
    function childFoldersOf(pid) { return panelBridge.childFoldersOf(pid) }
    function rootFolders() { return panelBridge.rootFolders() }
    function folderPathOf(fid) { return panelBridge.folderPathOf(fid) }
    function folderName(fid) { return panelBridge.folderName(fid) }
    function doCreateFolder() { return panelBridge.doCreateFolder() }
    function doRenameFolder() { return panelBridge.doRenameFolder() }
    function doDeleteFolder(f) { return panelBridge.doDeleteFolder(f) }
    function doReorderFolder(f, delta) { return panelBridge.doReorderFolder(f, delta) }
    function doReparentFolder(fid, parentId) { return panelBridge.doReparentFolder(fid, parentId) }
    function setRenamingId(v) { return panelBridge.setRenamingId(v) }
    function setRenameText(v) { return panelBridge.setRenameText(v) }
    function setFolderInputOpen(v) { return panelBridge.setFolderInputOpen(v) }
    function setFolderInputText(v) { return panelBridge.setFolderInputText(v) }
    function setSubFolderFor(v) { return panelBridge.setSubFolderFor(v) }
    function toggleSelMode() { return panelBridge.toggleSelMode() }
    function toggleSelId(id) { return panelBridge.toggleSelId(id) }
    function setSelMode(v) { return panelBridge.setSelMode(v) }
    function setSelIds(v) { return panelBridge.setSelIds(v) }
    function afterArchiveCleanup(ids) { return panelBridge.afterArchiveCleanup(ids) }
    function setCtxMenu(v) { return panelBridge.setCtxMenu(v) }
    function setFolderMenu(v) { return panelBridge.setFolderMenu(v) }
    function setScopeOpen(v) { return panelBridge.setScopeOpen(v) }
    function setFilterOpen(v) { return panelBridge.setFilterOpen(v) }
    function setSortOpen(v) { return panelBridge.setSortOpen(v) }
    function setShowHelp(v) { return panelBridge.setShowHelp(v) }
    function setSearchText(v) { return panelBridge.setSearchText(v) }
    function setSearchIds(v) { return panelBridge.setSearchIds(v) }
    function setSearchMatches(v) { return panelBridge.setSearchMatches(v) }
    function toggleScope(key) { return panelBridge.toggleScope(key) }

    // ===== panel 跨域镜像 ref 群（architecture-modular §6 步骤 E）=====
    // keydown 长链（panel/keyboard.js）/双链解析/搜索防抖等「监听挂一次、读最新值」的共享镜像：
    // 模块级 plain object 与昔日 FloatingPanel 内 useRef 等价（面板为 shell.overlay 单例，selectedRef 先例）；
    // 渲染期由 panel/index.js 装配层镜像块/各子域 hook 写入，panel/keyboard.js、panel/wiki.js 等按序位直读
    const notesRef = { current: [] }          // 笔记清单镜像（wiki 解析 / keyboard Enter 打开 / renderFolderNode 计数）
    const searchRef = { current: '' }         // 搜索词镜像（防抖闭包 / Esc 清搜索 / 侧栏输入框写入）
    const searchDebRef = { current: null }    // 搜索 250ms 防抖器句柄（一次性注册；侧栏输入/筛选变更/清空动作触发重搜）
    const searchInputRef = { current: null }  // 侧栏搜索框 DOM（Ctrl+K 聚焦）
    const treeElRef = { current: null }       // 侧栏树容器 DOM（Esc 焦点分层/搜索↓桥接：还焦列表，j/k 立即可用）
    const pagedIdsRef = { current: [] }       // 当前树渲染 id 序（0.4.6-J 起 = 各分组分页当前页并集，不含加载行；树渲染写入，keyboard j/k/Enter 导航读）
    const switchModeRef = { current: null }   // 双模式切换最新闭包（Ctrl+/ 经 ref 调最新 switchMode）
    const editorModeRef = { current: 'source' }   // 编辑器模式镜像（Ctrl+/ 守卫 / selectNote / 富文本序列化判读最新值）
