/* global window, document, fetch, localStorage, performance, PerformanceObserver, console */
// dsh-notes — Browser 侧 bundle（CJS 工厂，供 dsh web 客户端 ModuleLoader 注入）。
//
// 本文件是发布版静态包的 **最终源码**（P3）：由 scripts/build-dist.cjs 从开发版 src/client/** 拼接产物
// 机械转换而来，转换规则见 task-board-plugin/docs/PACKAGING.md 第 4 节：
//   · React        ：require('react')（静态包无全局 React）
//   · RPC          ：fetch('/dsh-notes', POST {method, args}) —— index.mjs 的 webServer exact 路由
//                    （动态插件的 host 调用桥在静态包中不存在）
//   · 样式         ：fetch notes-css + document.createElement('style') 注入（doc 级，进程单例）
//                    （动态插件的 styles 服务在静态包中不存在）
//   · 定时器        ：动态插件的 ctx.interval 快捷方式不存在，用 ctx.get('timer') + ctx.effect
//   · inject       ：声明全部服务（slots/timer/sessions/workspaces），保证就绪后才 apply
//
// 要改 client 行为：改开发版 src/client/** 模块源，然后 `node scripts/build-dist.cjs` 重新生成。
window.__ModuleLoader__.load({
  id: 'dsh-notes-plugin',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    'use strict'
    const React = require('react')

    function apply(ctx) {
    const slots = ctx.get('slots')
    if (!slots) { console.error('[dsh-notes] slots service unavailable'); return }
    const timer = ctx.get('timer')
    if (!timer) { console.error('[dsh-notes] timer service unavailable'); return }
    const sessions = ctx.get('sessions')
    const workspaces = ctx.get('workspaces')
    const disposers = []
    const listeners = new Set()
    const noteRefreshListeners = new Set()
    let panelOpen = false
    let currentSessionId = ''
    let toastEmit = null
    // toast 支持动作按钮：act = { label, fn }（先例 = app.html toast(m, act)；归档「撤销」用它）
    function showToast(msg, act) { try { if (toastEmit) toastEmit(act && act.label ? { msg: msg, act: act } : msg) } catch (e) {} }

    // ===== toast 宿主（architecture-modular §6 步骤 C：由 SelectionCapture 内 state 迁入 kernel/bus）=====
    // 数据桶 toastStore 在 kernel/state.js 回填（createStore 序位在后，bus 不可前向引用，故此处仅声明挂点）；
    // emit/自动消失计时在本文件——showToast/toastEmit 契约不变：toast 值 '' = 无；string = 纯文本；{ msg, act } = 带动作按钮
    let toastStore = null
    let toastTimerOff = null
    function setToast(toast) {
      if (toastTimerOff) { try { toastTimerOff() } catch (err) {} toastTimerOff = null }
      toastStore.set({ toast: toast })
      // toast 自动消失：带动作按钮（如归档「撤销」）时延长展示（先例 = app.html toast(m, act) 的 4200ms）
      if (toast) toastTimerOff = timer.timeout(() => setToast(''), typeof toast === 'object' && toast.act ? 4200 : 2600)
    }
    toastEmit = setToast
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
    function setVisibleCount(v) { return panelBridge.setVisibleCount(v) }
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
    const pagedIdsRef = { current: [] }       // 当前分页渲染 id 序（树渲染写入，keyboard j/k/Enter 导航读）
    const switchModeRef = { current: null }   // 双模式切换最新闭包（Ctrl+/ 经 ref 调最新 switchMode）
    const editorModeRef = { current: 'source' }   // 编辑器模式镜像（Ctrl+/ 守卫 / selectNote / 富文本序列化判读最新值）
    /* ===== i18n 字典·中文（notes-042-i18n-mech）=====
       全量基准字典：回退链终点（key 缺失 → 回退本字典；本字典也缺 → 返回 key 本身，红线永不裸 key 仅指此兜底）。
       扁平 key = 表面.语义；值 = 文案；变量统一 {name} 插值（禁字符串拼接）。
       双端共源（@i18n/ 前缀，同 @shared/ 规则）：app 态列 0 原样纳入 app.html；client 态逐非空行加 4 空格基座缩进。
       本卡（机制卡）只立骨架 + 高频示例；覆盖卡逐表面搬串进本字典，en.js 直译（术语表见 n-mut488gske5v）。 */
    var I18N_ZH = {
      'topbar.refresh': '刷新',
      'topbar.archive': '速记',
      'topbar.theme': '切换主题',
      'topbar.home': 'DSH 主界面',
      'topbar.filter': '筛选',
      'topbar.trash': '回收站',
      'topbar.select': '选择',
      'topbar.searchPlaceholder': '搜索笔记、标签、内容…',
      'common.settings': '设置',
      'common.save': '保存',
      'common.restore': '还原',
      'common.cancel': '取消',
      'common.close': '关闭',
      'common.delete': '删除',
      'common.loading': '加载中…',
      'common.refreshed': '已刷新',
      'common.saveFailed': '保存失败：{msg}',
      'settings.language': '语言',
      'settings.languageTip': '界面语言（本地记忆，切换即生效）',
      /* ===== 覆盖卡 A（notes-042-i18n-cov-a）：顶栏 + 侧栏树 + hintbar ===== */
      'topbar.subtitle': '你的笔记库 · 写下的约定与资料可注入 Agent 会话',
      'topbar.refreshTip': '重新拉取列表/文件夹（LLM 主题分类为异步回填，刷新可见）',
      'topbar.archiveTip': '速记合并：把同一会话的速记合并成一篇；点按弹出预览，勾选后才执行（可撤销）',
      'topbar.themeTip': '切换主题（暗色/亮色）',
      'topbar.homeTip': '返回 DSH 主界面',
      'topbar.filterTip': '筛选中心：分组勾选条件（组内 OR / 跨组 AND）',
      'topbar.sortTip': '排序（与筛选正交，互不重置）',
      'topbar.filterAria': '筛选条件',
      'topbar.trashTip': '回收站：查看已删除的笔记，可恢复或彻底删除',
      'topbar.selectTip': '多选笔记：勾选后可合并为一篇（Esc 退出）',
      'side.brand': '笔记',
      'side.newTip': '新建笔记（Alt+N）',
      'side.splitterTip': '拖拽调整侧栏宽度（双击重置）',
      'side.more': '继续滚动加载更多（已显示 {shown} / {total}）',
      'side.fchipStatusTip': '筛选条件：状态 / {label}（点 × 移除）',
      'side.fchipKindTip': '筛选条件：类型 / {label}（点 × 移除）',
      'tree.topicTip': '主题：{topic}',
      'tree.untitled': '无标题',
      'tree.injectTip': '注入为上下文 · {role}',
      'tree.roleReference': '资料',
      'tree.roleConvention': '约定',
      'tree.injectScope': '范围：{scope}',
      'tree.injectEverTip': '曾注入：历史上开启过上下文注入（现已关闭）',
      'tree.useCountTip': '被 Agent 引用（note_get 命中）{n} 次',
      'tree.wikiTip': '含双链 [[…]]（详情富文本中可点击跳转）',
      'tree.toggleTip': '展开/折叠',
      'tree.sysChipTip': '机器托管笔记（sys）：默认列表/搜索降噪不显示，随文件夹展开可见（0.4.4-C 显式入口）',
      'tree.countN': '{n} 条',
      'tree.viewTopic': '主题 · {id}',
      'tree.viewAll': '全部笔记',
      'tree.crossFolderCount': '（跨文件夹 {n} 条）',
      'tree.clearViewTip': '清除视图过滤',
      'tree.pinned': '置顶',
      'tree.folders': '文件夹',
      'tree.addFolderTip': '新建文件夹',
      'tree.dropOutHint': '拖到此处移出文件夹',
      'tree.dropRootHint': '拖到此处移回根级',
      'tree.topicsHeader': '主题 ({n})',
      'tree.crossFolder': '跨文件夹',
      'tree.topicViewTip': '主题视图（跨文件夹过滤）',
      'tree.noMatch': '无匹配笔记',
      'tree.clearFilters': '清空筛选条件',
      'tree.clearFiltersShort': '清空筛选',
      'tree.clearAllFiltersTip': '清空全部筛选条件',
      'tree.movedTo': '已移动到「{name}」',
      'tree.movedOut': '已移出文件夹',
      'tree.moveFailed': '移动失败：{msg}',
      'tree.subFolderPlaceholder': '子文件夹名…',
      'tree.folderPlaceholder': '文件夹名…',
      'tree.classifying': '识别中',
      'tree.emptyTitle': '还没有笔记',
      'tree.emptySub': '点侧栏「新建」输入标题，创建第一条笔记',
      'tree.emptyBtn': '记第一条',
      'sel.selCount': '已选 {n} 条',
      'sel.merge': '合并',
      'hint.select': '🖱 在右侧正文<b>划选文字松手</b> → 弹出快速记录卡片',
      'hint.drag': '拖笔记 → 文件夹移入 / 拖到根级笔记区移出',
      'hint.folder': '点击展开/折叠 · 右键管理',
      'hint.keys': 'Ctrl K 搜索 · Alt N 新建 · j/k 移动 · Enter 打开 · Esc 关闭浮层 · ? 快捷键',
      'chrome.dragMove': '拖拽移动窗口',
      'chrome.entryModeTip': '切换入口模式：会话头部 / 悬浮气泡',
      'chrome.help': '使用说明',
      'chrome.resizeTip': '拖拽调整',
      /* ===== 覆盖卡 B（notes-042-i18n-cov-b）：编辑器 + meta ===== */
      'common.listSep': '、',
      'editor.richDegradedReasons': '含高级语法（{reasons}），请在源码模式编辑',
      'editor.loadFailed': '正文加载失败：{msg}',
      'editor.loadFailedData': '返回数据异常',
      'editor.loadFailedLocked': '{msg}（已锁定编辑，可点横幅重试）',
      'editor.autoSaved': '✓ 已自动保存 {time}',
      'editor.autoSavedFlat': '已自动保存 {time}',
      'editor.emptyTitle': '选择左侧一条笔记查看和编辑',
      'editor.emptySub': '点侧栏顶部 + 新建笔记（先开草稿，输入内容才落库）；正文划选文字可弹出快速记录卡片',
      'editor.emptyTitleShort': '选择一条笔记查看和编辑',
      'editor.emptySubShort': '点侧栏「新建」输入标题，新建一条笔记',
      'editor.degBanner': '检测到<b>白名单外语法</b>，富文本编辑不可用（仍可源码编辑）：',
      'editor.degBannerPre': '检测到',
      'editor.degBannerB': '白名单外语法',
      'editor.degBannerPost': '，富文本编辑不可用（仍可源码编辑）：',
      'editor.degBanner2': '删净对应语法后，「富文本」入口会实时恢复可用。',
      'editor.loadLockNote': ' — 已锁定编辑并暂停自动保存（防止空内容覆盖原文）。',
      'editor.retry': '重试',
      'editor.bodyPlaceholder': '正文…（Markdown）',
      'editor.richPlaceholder': '正文…（富文本，编辑后失焦自动同步源码）',
      'editor.tbBold': '加粗 **text**',
      'editor.tbItalic': '斜体 *text*',
      'editor.tbCode': '行内码 `text`',
      'editor.tbLink': '链接 [text](url)',
      'editor.tbUl': '无序列表',
      'editor.tbOl': '有序列表',
      'editor.tbQuote': '引用块',
      'editor.tbImage': '插入图片 ![](assets/..)（也可 Ctrl+V 粘贴 / 拖拽文件）',
      'editor.syncing': '编辑中…',
      'editor.synced': '已同步源码',
      'editor.modeSource': '源码模式',
      'editor.modeRich': '富文本模式',
      'editor.imageOnly': '仅支持图片文件',
      'editor.tableReadonly': '表格为只读，请切换源码模式编辑该区域',
      'editor.richRestored': '富文本模式已恢复可用',
      'editor.richDisabled': '检测到白名单外语法 → 富文本入口置灰',
      'editor.degReasonItem': '{label}（第 {line} 行：{sample}）',
      'editor.selectCodeFirst': '先选中要设为行内码的文字',
      'editor.selectLinkFirst': '先选中要加链接的文字',
      'editor.selectNoteFirst': '先选择一条笔记',
      'editor.bodyLoading': '正文加载中，稍后再整理',
      'editor.bodyEmpty': '正文为空，无可整理内容',
      'editor.organizeFailed': '整理失败：{msg}',
      'editor.organizeEmpty': '整理返回为空，原文未动',
      'editor.organized': '已按「{kind}」模板整理',
      'editor.noOrganizeUndo': '没有可撤销的整理',
      'editor.organizeUndone': '已恢复整理前正文',
      'editor.charCount': '{n} 字',
      'editor.backlinks': '反向链接',
      'editor.backlinksCount': '（{n}）',
      'editor.backlinksWarming': '（索引中…）',
      'editor.backlinkJumpTip': '跳转到「{name}」',
      'editor.backlinksEmpty': '暂无其他笔记用 [[…]] 链接到这里',
      'meta.crumbFolderExpandTip': '在目录树中展开：{name}',
      'meta.crumbTopicTip': '按主题全局过滤（跨文件夹）',
      'meta.crumbTopicViewTip': '查看同主题全部笔记',
      'meta.uncategorized': '未分类',
      'meta.unsavedDraft': '未保存草稿',
      'meta.filteredByTopic': '已按主题过滤：{name}',
      'meta.noTopic': '该笔记尚未识别主题',
      'meta.kindTip': '类型',
      'meta.kindTipFull': '笔记类型',
      'meta.kindNote': '笔记',
      'meta.kindDecision': '决策',
      'meta.kindTodo': '待办',
      'meta.kindLink': '链接',
      'meta.kindQuote': '引用',
      'meta.kindLog': '日志',
      'meta.kindSys': '机器',
      'meta.statusTip': '状态',
      'meta.topicTip': '主题（host LLM 可异步回填；改后自动保存）',
      'meta.topicTipClient': '主题（可直接编辑；点右侧按钮按主题全局过滤）',
      'meta.topicPlaceholder': '主题',
      'meta.topicFilterTip': '按主题全局过滤',
      'meta.tagsTip': '标签，逗号分隔',
      'meta.tagsTipClient': '标签（逗号分隔；convention 标签已由注入开关替代）',
      'meta.tagsPlaceholder': '标签…',
      'meta.folderTip': '所在文件夹',
      'meta.useCountTip': '使用遥测：被 Agent 引用（note_get 命中）次数',
      'meta.useCount': '被引用 {n} 次',
      'meta.dispPendingTip': '派发中：{open} 条待回执（共 {total} 条）· 目标会话处理完转 idle 或笔记置 resolved 时自动回执；点击查看派发历史',
      'meta.dispDoneTip': '全部 {total} 条派发已回执 · 点击查看派发历史',
      'meta.dispPending': '派发中 {open}/{total}',
      'meta.dispDone': '派发已回执',
      'meta.roleOffTip': '不注入系统提示',
      'meta.roleOff': '关闭',
      'meta.logNoInject': '日志不参与注入',
      'meta.logNoInjectTip': '工作日志注入硬禁：host 强制 inject=false（injectForcedOff 硬闸）；日志同权——可见/可搜索/可编辑，注入目录恒不含',
      'meta.roleConventionTip': '须遵守的行为规则',
      'meta.roleReferenceTip': '事实性补充信息，Agent 按需取用',
      'meta.scopeTip': '选择注入范围（可多选）',
      'meta.scopeAll': '所有会话',
      'meta.scopeSession': '会话 {name}',
      'meta.scopeHint': '默认注入到所有会话；勾选会话则仅限这些会话',
      'meta.scopePending': '{short} · 标题加载中…',
      'meta.wsOther': '其他',
      'meta.sensTip': '敏感内容：注入系统提示时正文按行打码（键保留值遮蔽），Agent 用 note_get 取原文',
      'meta.sens': '敏感',
      'meta.hiddenTip': '隐藏：不出现在列表/树（显隐开关关时遮罩滤除；跳转与搜索打开不受影响），点按切换',
      'meta.hidden': '隐藏',
      'meta.injectEverTip': '曾注入：历史上开启过上下文注入（现已关闭；injectEver 为粘性标记，不随关闭回退）',
      'meta.injectEver': '曾注入',
      'meta.srcModeTip': 'Markdown 源码编辑',
      'meta.src': '源码',
      'meta.richModeTip': '富文本（受限 WYSIWYG，Ctrl+/ 切换）',
      'meta.richModeTipClient': '富文本（受限 WYSIWYG）',
      'meta.rich': '富文本',
      'meta.richDegradedShort': '含高级语法，请在源码模式编辑',
      'meta.modeAria': '编辑器模式（Ctrl+/ 切换）',
      'meta.organizingTip': 'AI 整理中…',
      'meta.organizeTip': 'AI 整理：按「{kind}」模板重写正文（替换后可撤销）',
      'meta.organizing': '整理中…',
      'meta.organize': '整理',
      'meta.dispatchTip': '派发待办到活跃会话',
      'meta.dispatchTipClient': '派发待办到会话（可补充具体要求）',
      'meta.dispatch': '派发',
      'meta.sourceTip': '来源会话',
      'meta.sourceJumpTip': '跳转到来源会话',
      'meta.source': '来源',
      'meta.histTip': '历史版本（{n} 个快照）：预览 / 一键恢复（恢复前当前版自动快照，可再撤销）',
      'meta.history': '历史',
      'meta.unpin': '取消置顶',
      'meta.pin': '置顶',
      'meta.delTip': '删除（软删除，可撤销/由 Agent 恢复）',
      'meta.delTipClient': '删除（软删除，可恢复）',
      'meta.injectOff': '已关闭上下文注入',
      'meta.injectOn': '已注入为上下文 · {role}（范围见右侧下拉）',
      'meta.sensOn': '已标记敏感（注入时自动脱敏）',
      'meta.sensOff': '已取消敏感标记',
      'meta.hiddenOn': '已隐藏（列表/树不再显示；跳转与搜索打开不受影响）',
      'meta.hiddenOff': '已取消隐藏',
      'meta.sourceToast': '来源会话 {short}（{full}）· 页面无跳转能力，请回 DSH 主界面打开',
      'meta.pinnedToast': '已置顶',
      'meta.unpinnedToast': '已取消置顶',
      'meta.runLogNotFound': '未找到执行记录笔记：{id}',
      'meta.schedPlan': '派发计划',
      'meta.schedPaused': '已暂停',
      'meta.runLogTip': '查看执行记录笔记（schedule.runLog 软链：{id}）',
      'meta.runLog': '执行记录 ↗',
      'meta.schedEditTip': '回填派发弹窗编辑调度声明',
      'meta.edit': '编辑',
      'meta.schedResumeTip': '恢复调度（enabled=true，host 重新校验目标存活红线）',
      'meta.schedPauseTip': '暂停调度（enabled=false，声明与历史保留）',
      'meta.resume': '恢复',
      'meta.pause': '暂停',
      'meta.schedDelTip': '软删约定笔记（回收站可恢复），调度即刻停止',
      'meta.schedPeerTip': '跳转到调度约定「{name}」',
      'meta.schedPeer': '关联调度',
      'meta.schedPeerNotFound': '未找到调度约定：{id}',
      'meta.dispHistory': '派发历史（{n}）',
      'meta.dispStDone': '已完成',
      'meta.dispStPending': '待处理',
      'meta.dispNew': '新会话',
      'meta.dispExisting': '已有会话',
      'meta.dispInstruction': '要求：{text}',
      'meta.dispMarkDone': '标记完成',
      'meta.dispMarkedDone': '已标记完成',
      'meta.opFailed': '操作失败：{msg}',
      'meta.createdAt': '创建 {time}',
      'meta.draftHint': '草稿（首次输入即落库）',
      'meta.updatedAt': '更新 {time}',
      'meta.sourceSession': '来源 会话 {short}',
      'meta.sourcePage': '来源 页面',
      'meta.refreshFailed': '笔记刷新失败，显示本地缓存：{msg}',
      'meta.draftDiscarded': '草稿已丢弃（未落库）',
      'meta.deleted': '已删除（软删除）',
      'meta.undo': '撤销',
      'meta.restored': '已恢复',
      'meta.restoreFailed': '恢复失败：{msg}',
      'meta.deleteFailed': '删除失败：{msg}',
      'meta.schedFailed': '失败 {time}',
      'meta.schedReceiptTip': '回执走派发闭环链路（receiptId={id}）',
      'meta.schedSent': '已派发 {time}',
      'meta.schedNever': '未触发',
      'meta.schedFired': '已触发（单次）',
      'meta.schedNext': '下次 {time}',
      /* ===== 覆盖卡 C（notes-042-i18n-cov-c）：设置卡双语化（app modals/settings.js + client modals/settings.js）=====
         复用既有 key：common.settings/save/restore/loading/saveFailed、topbar.trash/topbar.trashTip、settings.language/languageTip，不重复建 */
      'settings.closeTip': '关闭（Esc；有未落盘改动先自动 flush）',
      'settings.onboardTitle': '概念速览',
      'settings.onboardInject': '· 注入：笔记正文进入 Agent 的系统提示，每次对话都可见（编辑器注入三态开关控制）',
      'settings.onboardRoles': '· 约定 / 资料：注入的两种角色——约定 = 须遵守的规则；资料 = Agent 按需取用的参考',
      'settings.onboardCatalog': '· 目录注入：只向 Agent 提供已挂载笔记的索引行（一行一条，含「何时查我」），需要全文时它再 note_get 调取',
      'settings.onboardDispatch': '· 派发：把待办笔记派给指定会话执行，完成后自动回执闭环。',
      'settings.followSession': '跟随当前会话（默认）',
      'settings.followBtn': '跟随会话',
      'settings.savedSuffix': '（已保存）',
      'settings.llm': 'LLM 模型',
      'settings.llmTip': '笔记自动分类 / 指令提取使用的模型',
      'settings.usage': 'LLM 用量',
      'settings.usageTip': '笔记功能的 token 消耗统计（真实 usage 优先，未回传时按字符估算）；按日累计，usage.json 落盘',
      'settings.usageLine': '今日 {today} · 本周 {week} · 本月 {month} · 累计 {all} tokens',
      'settings.usageCalls': '（{n} 次调用）',
      'settings.usageByFeature': '分类 {classify} · 整理 {organize} · 总结 {summarize}',
      'settings.usageEstimated': '（含字符估算，约）',
      'settings.usageLoadFailed': '用量数据读取失败',
      'settings.usageOverBudget': '⚠ 本月笔记 LLM 用量 {used} tokens 已超预算 {budget}（仅提醒，不阻断）',
      'settings.usageBudget': '用量预算提醒',
      'settings.usageBudgetTip': '本月 token 消耗超过该值时提醒（仅 toast 提示，不阻断调用）；0 = 关闭',
      'settings.usageBudgetTipT': '本月 LLM token 消耗超过该值时 toast 提醒（仅提醒，不阻断调用）；0 = 关闭',
      'settings.stale': '时效衰减提醒',
      'settings.staleTip': '超过 N 天未更新且未被读取的笔记/链接会在「整理建议」中提名为过期候选（提醒参考资料可能过期）；0 = 关闭',
      'settings.staleTipT': '超过 N 天未更新的笔记/链接在「整理建议」中提名为过期候选；0 = 关闭',
      'settings.maxDepth': '文件夹嵌套深度',
      'settings.maxDepthTip': '虚拟文件夹最大嵌套层级（根级 = 第 1 层，缺省 3）；新建子文件夹/拖拽换父超限将拒绝并提示；0 = 不限',
      'settings.maxDepthTipT': '虚拟文件夹最大嵌套层级（根级 = 第 1 层）；新建子文件夹/拖拽换父超限将拒绝并 toast 提示；0 = 不限',
      'settings.budget': '注入体积预算',
      'settings.budgetTip': '单次注入笔记全文的上限（约，按字符数近似）；约定条目永不截断，资料条目从最旧开始省略；0 = 不限',
      'settings.gaugeTip': '最近一次注入的笔记全文体积（约，按字符数）',
      'settings.gaugeCurrent': '当前注入约 {last} 字符',
      'settings.gaugeBudget': '预算约 {budget} 字符',
      'settings.gaugeUnlimited': '（不限）',
      'settings.injPreview': '注入预览',
      'settings.injPreviewTip': '查看 Agent 实际收到的注入文本（约定 + 目录）：敏感打码 / 预算截断效果即所见；可按会话过滤',
      'settings.injPreviewTipT': '预览 Agent 系统提示中实际注入的笔记文本（约定桶 + 目录段），含敏感打码 / 预算截断效果；可按会话过滤',
      'settings.previewBtn': '预览…',
      'settings.injManager': '注入管理',
      'settings.injManagerTip': '全库注入总览：逐篇三态直改（关闭/约定/资料）+ 多选批量 + 三态过滤/搜索；日志不参与注入（硬关，不提供开关），敏感笔记注入自动脱敏；含调度任务区（定时派发约定总览 / 编辑回填 / 暂停 / 删除）',
      'settings.injManagerTipT': '打开注入管理面板：总览全部笔记的注入三态（约定/资料/关闭），单行直改或多选批量调整；顶部统计 chips 点击即过滤；日志不参与注入（硬关，不提供开关），敏感笔记注入自动脱敏；含调度任务区（定时派发约定总览 / 编辑回填 / 暂停 / 删除）',
      'settings.manageBtn': '管理…',
      'settings.data': '数据',
      'settings.dataTip': '全库目录快照导出 / 从快照目录导入（只增改不删，导入前自动全量备份）/ 回收站兜底（恢复或彻底删除）',
      'settings.dataTipClient': '全库目录快照导出 / 单文件拼接导出（图片内联，可分享）/ 从快照目录导入（只增改不删，导入前自动全量备份）/ 回收站兜底（恢复或彻底删除）',
      'settings.exportAll': '导出全部',
      'settings.exportAllTip': '把整个笔记库（含 folders.json）快照到目标目录',
      'settings.exportSingle': '导出单文件…',
      'settings.exportSingleTip': '按范围（全部/文件夹/标签）拼接为单个 Markdown 文件：图片 base64 内联，可直接分享；超 20MB 告警仍导出',
      'settings.importBtn': '导入…',
      'settings.importTip': '从目录快照导入：先预览明细再执行，只增改不删、自动备份',
      'settings.assets': '资产清理',
      'settings.assetsTip': '扫描 assets/ 中未被任何笔记引用的孤儿文件（已删除笔记的引用仍计入保护，宁留勿删）',
      'settings.assetsTipT': '预览 assets/ 中未被任何笔记引用的孤儿文件，勾选后删除（dry-run 先行，零写入）',
      'settings.pruneBtn': '清理…',
      'settings.suggest': '整理建议',
      'settings.suggestTip': '速记组归档 / 过期未引用清理 / 孤儿笔记候选 / 日志卫生提名（只提名不自动执行）',
      'settings.suggestTipClient': '速记组归档 / 过期未引用清理 / 孤儿笔记候选（只提名不自动执行）',
      'settings.suggestTipT': '整理建议：速记组归档 / 过期未引用清理 / 孤儿笔记候选（只提名不自动执行）',
      'settings.openBtn': '打开',
      'settings.memory': '工作记忆',
      'settings.memoryTip': '会话工作结论沉淀为工作日志（kind=log，与普通笔记同权：可见/可搜索/可编辑；注入硬禁，注入目录恒不含）；启用 = 创建一条预填约定笔记（可见/可改/可停用）',
      'settings.memProbing': '探测中…',
      'settings.memEnabled': '已启用',
      'settings.memView': '查看约定',
      'settings.memViewTip': '查看引导约定笔记（可见/可改/可删——单一注入源）',
      'settings.memDisable': '停用',
      'settings.memDisableTip': '停用 = 关闭引导约定笔记的注入（笔记保留可再启用）',
      'settings.memPending': '处理中…',
      'settings.memEnable': '启用沉淀引导…',
      'settings.memEnableTip': '创建一条预填约定笔记（inject=true，contractType: memory-guide），引导 Agent 在任务收尾时把会话结论写为工作日志（kind=log，同权可见/可搜，注入硬禁）——与既有约定并行不冲突',
      'settings.logWeek': '日志周聚合窗口',
      'settings.logWeekTip': '超过 N 天的工作日志在整理建议中按 工作区×周 提名聚合（只提名不执行；缺省 7 天）',
      'settings.logWeekTipT': '超过 N 天的工作日志在整理建议中按 工作区×周 提名聚合（只提名不执行）',
      'settings.logMonth': '日志月聚合窗口',
      'settings.logMonthTip': '超过 N 天提名月聚合（原始日志与周志混合归组；缺省 90 天）；0 = 关闭月聚合',
      'settings.logMonthTipT': '超过 N 天提名月聚合（原始日志与周志混合归组）；0 = 关闭月聚合本级',
      'settings.cheatsheet': '键盘快捷键',
      'settings.cheatsheetTip': '键盘流全部生效快捷键速查表（与实现逐键核对）；非输入焦点时按 ? 直达，Esc 关闭',
      'settings.cheatsheetTipT': '键盘流速查表：全部生效快捷键（与实现逐键核对）；? 键直达，Esc 关闭',
      'settings.viewBtn': '查看…',
      'settings.saving': '保存中…',
      'settings.restoreTip': '还原：全部回滚到打开时的设置（逐键恢复）',
      'settings.saveTip': '保存：flush 全部未落盘改动并显式确认（自动保存不变，此为兜底 + 确认）',
      'settings.savedLlm': '已保存：笔记 LLM = {name}',
      'settings.restoredFollow': '已恢复跟随当前会话（默认）',
      'settings.llmRequired': 'provider 与 model 均需填写',
      'settings.staleInvalid': '时效提醒阈值需为非负整数（0 = 关闭）',
      'settings.staleOff': '已关闭过期候选提名',
      'settings.savedStale': '已保存：超过 {v} 天未更新的资料将在整理建议中提名为过期候选',
      'settings.maxDepthInvalid': '文件夹嵌套深度上限需为非负整数（0 = 不限层数）',
      'settings.maxDepthUnlimited': '已保存：文件夹嵌套不限层数',
      'settings.savedMaxDepth': '已保存：文件夹最多嵌套 {v} 层',
      'settings.budgetInvalid': '注入体积预算需为非负整数（0 = 不限）',
      'settings.budgetOff': '已关闭注入体积预算（不限）',
      'settings.savedBudget': '已保存：注入预算约 {v} 字符',
      'settings.logWeekInvalid': '日志周聚合窗口需为非负整数（天）',
      'settings.savedLogWeek': '已保存：超过 {v} 天的日志将提名周聚合',
      'settings.logMonthInvalid': '日志月聚合窗口需为非负整数（0 = 关闭月聚合）',
      'settings.logMonthOff': '已关闭日志月聚合提名',
      'settings.savedLogMonth': '已保存：超过 {v} 天的日志将提名月聚合',
      'settings.usageBudgetInvalid': '月度用量预算需为非负整数（0 = 关闭提醒）',
      'settings.usageBudgetOff': '已关闭月度用量预算提醒',
      'settings.savedUsageBudget': '已保存：月度用量预算 {v} tokens',
      'settings.savedAll': '设置已保存',
      'settings.restoredAll': '已还原：设置回滚到打开时的状态',
      'settings.restoreFailed': '还原失败：{msg}',
      'settings.flushSaveFailed': '设置保存失败：{msg}',
      'settings.loadFailed': '设置加载失败：{msg}',
      /* ===== 覆盖卡 D（notes-042-i18n-cov-d）：注入管理 + 记忆引导双语化 =====
         复用既有 key（禁重复建别名）：settings.injManager（面板标题）/memProbing/memEnabled/memView/memDisable/memEnable、
           common.loading/close/cancel/delete、tree.untitled/roleConvention/roleReference、sel.selCount、
           meta.roleOff/roleOffTip/roleConventionTip/roleReferenceTip/injectEver/injectEverTip（行内三态 + 曾注入徽章同文案）、
           meta.schedPaused/schedEditTip/edit/schedResumeTip/schedPauseTip/resume/pause/schedDelTip/opFailed/deleteFailed/
           schedFailed/schedReceiptTip/schedSent/schedNever/schedFired/schedNext（调度徽章/下次触发/操作行——B 卡为计划块已建）；
         common.sched* = schedFreqLabel 频率人话（跨表面复用：注入管理 + 详情计划块，app kernel/helpers.js ⇄ client kernel/format.js 同口径） */
      'common.schedOnce': '仅一次 {time}',
      'common.schedInvalid': '非法间隔',
      'common.schedDaily': '每天',
      'common.schedWeekly': '每周',
      'common.schedWeeklyDow': '每周{dow}',
      'common.dowNames': '日|一|二|三|四|五|六',
      'common.schedNDays': '每 {n} 天',
      'common.schedNHours': '每 {n} 小时',
      'common.schedNMinutes': '每 {n} 分钟',
      'common.schedNMs': '每 {n}ms',
      'inj.titleSub': '全库注入总览 · 单行直改 / 多选批量 · 日志不参与注入 · 调度任务区（定时派发）',
      'inj.searchPlaceholder': '搜索标题 / 主题 / 标签…',
      'inj.loadFailed': '加载失败：{msg}',
      'inj.chipAll': '全部 {n}',
      'inj.chipConvention': '约定 {n}',
      'inj.chipReference': '资料 {n}',
      'inj.chipOff': '未注入 {n}',
      'inj.noMatch': '无匹配笔记（调整过滤或搜索词）。',
      'inj.emptyLib': '笔记库为空。',
      'inj.selectAll': '全选',
      'inj.batchConvention': '设为约定',
      'inj.batchReference': '设为资料',
      'inj.batchRefTip': '批量设为资料：每条静默落缺省挂载行（whenToUse=标题），不逐条弹框；单行切「资料」档会先弹编辑框',
      'inj.batchOff': '关闭注入',
      'inj.executing': '执行中…',
      'inj.logNoInject': '日志不参与注入',
      'inj.logNoInjectTip': '工作日志注入硬禁：host 强制 inject=false（injectForcedOff 硬闸）；日志同权——可见/可搜索/可编辑，注入目录恒不含',
      'inj.sensTip': '敏感笔记：注入时自动脱敏（正文按行打码，键保留值遮蔽）',
      'inj.sensBadge': '注入时自动脱敏',
      'inj.scopeGlobal': '全局',
      'inj.scopeSessions': '{n} 个会话',
      'inj.schedTitle': '调度任务（{n}）',
      'inj.schedTitleSub': '定时派发约定 · 声明在 front-matter（contractType: dispatch-schedule），裸编辑即开发者旁路',
      'inj.schedEmpty': '暂无定时任务——派发对话框选「定时执行」即可排定。',
      'inj.schedResumed': '已恢复定时：{title}',
      'inj.schedPausedToast': '已暂停定时：{title}',
      'inj.schedDelConfirm': '删除定时任务「{title}」？\n约定笔记移入回收站（可恢复），调度即刻停止。',
      'inj.schedDeleted': '已删除定时任务：{title}（回收站可恢复）',
      'inj.forcedOff': '「{title}」日志不参与注入：inject 已强制关闭',
      'inj.injectOffToast': '已关闭注入：{title}',
      'inj.injectSetToast': '已设为{role}：{title}',
      'inj.setFailed': '设置失败：{msg}',
      'inj.batchLabelSet': '设为{role}',
      'inj.batchConfirm': '批量{label}：所选的 {n} 条笔记将{effect}\n确认执行？',
      'inj.batchEffOff': '关闭上下文注入。',
      'inj.batchEffRef': '注入为资料（按需取用）。',
      'inj.batchEffConv': '注入为约定（须遵守）。',
      'inj.batchDone': '已{label} {ok} 条',
      'inj.batchDoneFail': '，失败 {n} 条',
      // 0.4.3⑤ 挂载弹层（notes-043-index）：给资料开注入 → 手写 whenToUse → 确认落注入索引 §1 行
      'inj.mountTitle': '挂载到注入索引',
      'inj.mountSub': '写入索引 §1 一行：Agent 何时该查我？',
      'inj.mountLabel': 'whenToUse · 何时查我',
      'inj.mountPlaceholder': '如：接入/校验 e2e 断言口径时…',
      'inj.mountSave': '挂载',
      'inj.mountSkip': '跳过',
      'inj.mountSaved': '已挂载索引：{title}',
      'inj.mountFailed': '挂载失败：{msg}',
      // 0.4.3 验收修复（notes-043-preview-when-edit）：LLM 草稿预填 + 预览目录行点击补充/编辑
      'inj.mountEdit': '编辑挂载',
      'inj.mountAdd': '补充 whenToUse 并挂载',
      'inj.mountGen': '正在生成 whenToUse…',
      // 0.4.3 验收修复⑥（notes-043-metrics-present）：注入管理面板挂载区统计行（notes-recall-stats 账本快照，点开看全量）
      'inj.mntStats': '挂载 {m}｜本周引用 Top：{top}｜零引用 {z}',
      'inj.mntStatsTip': '召回价值信号（数据源 notes-recall-stats · 账本快照）· 点开看全量分通道统计',
      'mem.disabledToast': '已停用沉淀引导（约定笔记保留，inject 已关闭）',
      'mem.notEnabled': '当前未启用沉淀引导',
      'mem.disableFailed': '停用失败：{msg}',
      'mem.enableTitle': '启用沉淀引导',
      'mem.enableSub': '工作记忆 v0 · 约定笔记方案',
      'mem.enableHint': '将创建一条预填约定笔记「约定：工作日志沉淀（工作记忆 v0）」（inject=true，contractType: memory-guide），引导 Agent 在任务收尾/你示意时把会话结论写为工作日志（kind=log）。工作记忆是独立于笔记约定的并行通道——约定管你怎么记（给人看），记忆管 Agent 自己沉淀什么（自用召回），两者可同时对同一事件生效，产物重复是设计意图而非冲突。日志与普通笔记同权：可见、可搜索、可编辑；注入硬禁（不提供注入开关），注入目录恒不含。该约定可见/可改/可停用/可删除；停用后再启用复用同一约定笔记（重新打开注入，不新建第二条）。',
      'mem.scopeTitle': '注入范围（作用域）',
      'mem.scopeGlobal': '所有会话（缺省）',
      'mem.scopeWsPick': '指定工作区（多选，下方勾选）',
      'mem.scopeSessPick': '指定会话（多选，下方勾选）',
      'mem.scopeWsMulti': '指定工作区（多选）',
      'mem.scopeSessMulti': '指定会话（多选）',
      'mem.scopeGlobalTip': 'injectTo=[]：任何会话的系统提示都注入该约定',
      'mem.scopeWsTip': '展开为所选工作区全部会话的短 id 清单（injectTo 无工作区维度）',
      'mem.scopeSessTip': 'injectTo=[勾选的会话短 id]：只有这些会话注入该约定',
      'mem.confirmEnable': '确认启用',
      'mem.enabling': '启用中…',
      'mem.wsLabel': '{name}（{n} 个会话）',
      'mem.noWorkspace': '没有可选工作区',
      'mem.noSessions': '没有可选会话',
      'mem.sessNameSeg': ' · {name}',
      'mem.sessWsSeg': '（{ws}）',
      'mem.sessLoadFailed': '会话清单加载失败：{msg}',
      'mem.needWorkspace': '「指定工作区」需至少勾选 1 个工作区（或改选所有会话）',
      'mem.noSessInWs': '所选工作区暂无可注入会话（请先在其中打开会话）',
      'mem.noSessInScope': '所选范围暂无可注入会话（请先在其中打开会话）',
      'mem.needSession': '「指定会话」需至少勾选 1 个会话（或改选所有会话）',
      'mem.alreadyToast': '沉淀引导已启用（约定笔记已存在）',
      'mem.revivedToast': '已重新启用沉淀引导：复用已有约定笔记（未新建第二条）',
      'mem.enabledToast': '已启用沉淀引导：约定笔记已创建并注入',
      'mem.enableFailed': '启用失败：{msg}',
      /* ===== 覆盖卡 E（notes-042-i18n-cov-e）：弹窗族双语化（dispatch/archive/trash/suggest/newnote/cheatsheet/folder-input + client 同名件）=====
         复用既有 key（禁重复建别名）：editor.selectNoteFirst/autoSaved、mem.sessLoadFailed、common.loading/cancel/close/schedDaily/schedWeekly/dowNames、
           meta.wsOther/scopePending/uncategorized/undo/restored/restoreFailed/deleteFailed、tree.untitled、inj.loadFailed/selectAll/batchDoneFail、
           sel.selCount/merge、settings.saving/suggest/cheatsheet、topbar.trash、meta.kindNote~kindLog（client 新建弹窗类型下拉）；
         数据层保留中文不抽串（跨语言匹配/check 锁定）：调度约定标题前缀「定时 」（schedPeerKey 正则同口径，app editor-meta.js ⇄ client format.js）、
           正文「补充指令：」标记（check 50-schedule-ui 断言锚定原文）、派发兜底会话名「新会话」（写入 dispatches 元数据） */
      'disp.title': '派发待办',
      'disp.editTitle': '编辑定时任务',
      'disp.sub': '注入上下文并触发目标会话处理 · 新建会话派发请回 DSH 面板',
      'disp.editSub': '调度声明与 front-matter 同源 · 保存即改排定',
      'disp.subCounts': '工作区{ws} / 会话{n}（活跃+休眠）{pending}',
      'disp.draftNotSaved': '草稿尚未落库：输入标题或正文自动保存后再派发',
      'disp.noSchedule': '该笔记没有调度声明',
      'disp.noBody': '（无正文）',
      'disp.instrPlaceholder': '补充具体要求 / 指令（可选）…',
      'disp.now': '立即派发',
      'disp.scheduled': '定时执行',
      'disp.modeNDays': '每 N 天',
      'disp.modeOnce': '仅一次（指定时间）',
      'disp.ndaysUnit': '天',
      'disp.dowOption': '周{dow}',
      'disp.ok': '派发',
      'disp.saveSched': '保存排定',
      'disp.savingSched': '排定中…',
      'disp.dispatching': '派发中…',
      'disp.needSession': '请选择目标会话',
      'disp.needWorkspace': '请选择工作区',
      'disp.noWsService': 'workspaces 服务不可用',
      'disp.sessSummary': '可派发会话 {n}（活跃+休眠）{pending} · 按工作区分组',
      'disp.sessPending': '（+{n} 标题加载中…）',
      'disp.noSessions': '没有可派发的会话。请先在 DSH 主界面创建一个会话，或回 DSH 浮动面板使用「新建会话」派发；休眠会话可直接派发（下次活动送达）。',
      'disp.notLive': '休眠 · 下次活动送达',
      'disp.notLiveSuffix': '（休眠 · 下次活动送达）',
      'disp.orphanSessName': '原目标会话（当前不在活跃清单）',
      'disp.orphanSessWs': '原目标',
      'disp.nextTrigger': '下次触发：{time}',
      'disp.schedNeedAt': '仅一次模式需选择定时时间',
      'disp.schedAtFuture': '定时时间必须是未来时刻（host 红线：at 必须未来）',
      'disp.schedNeedAnchor': '周期模式需选择触发时刻（HH:MM）',
      'disp.schedNInvalid': '每 N 天的 N 需为 ≥1 的整数',
      'disp.schedDone': '已排定，下次：{time}',
      'disp.schedUpdated': '已更新排定，下次：{time}',
      'disp.schedFailed': '排定失败：{msg}',
      'disp.needOpenHint': '\n（页面无打开会话能力，请回 DSH 主界面打开该会话后重试）',
      'disp.dispatched': '已派发待办到「{name}」（开始处理）',
      'disp.dispatchedQueued': '已排队到「{name}」（休眠会话 · 下次活动送达）',
      'disp.schedNew': '专属会话（首轮触发自动创建「定时 · 任务名」，后续复用）',
      'disp.newSessDone': '已新建会话，待办已注入并开始处理',
      'disp.failed': '派发失败：{msg}',
      'disp.markedDone': '已标记完成',
      'disp.pickWs': '选择工作区…',
      'disp.pickSess': '选择会话…',
      'disp.noSessInWs': '该工作区暂无会话',
      'disp.pickWsFirst': '先选工作区',
      'disp.pickWsNew': '选择工作区（在其下新建会话）…',
      'disp.modeExisting': '已有会话',
      'disp.modeNew': '新建会话',
      'arch.title': '归档预览',
      'arch.sub': '勾选后才执行 · 合并可撤销',
      'arch.hint': '速记按会话分组，勾选的组合并成一篇归档笔记（原笔记备份后软删除）。',
      'arch.hintClient': '速记按会话分组，勾选的组合并成一篇归档笔记（原笔记 .bak 备份后软删除）。',
      'arch.manualHint': '手动笔记不受影响；如需合并手动笔记，请在列表多选后右键合并。',
      'arch.empty': '没有可归档的速记组（同一会话 ≥2 条速记才会成组）。',
      'arch.ok': '归档所选',
      'arch.okCount': '归档所选（{n} 组）',
      'arch.archiving': '归档中…',
      'arch.groupMeta': '{span} · {n} 条 · {size}',
      'arch.groupUseCount': ' · 被引用 {n} 次',
      'arch.merged': '已合并 {n} 组',
      'arch.failed': '归档失败：{msg}',
      'arch.previewFailed': '预览加载失败：{msg}',
      'arch.undone': '已撤销归档',
      'arch.noUndo': '没有可撤销的归档',
      'arch.undoFailed': '撤销失败：{msg}',
      'arch.needTwo': '至少选择 2 条笔记',
      'arch.mergeTitle': '合并所选笔记',
      'arch.mergeHint': '把所选的 {n} 条笔记合并为一篇（正文按更新时间分节拼接，原笔记软删除，可撤销）。',
      'arch.mergeDefault': '合并笔记',
      'arch.mergePlaceholder': '合并后标题…',
      'arch.merging': '合并中…',
      'arch.mergeFailed': '合并失败：{msg}',
      'arch.mergedSel': '已合并所选 {n} 条',
      'arch.deletedBatch': '已删除 {ok} 条（可在回收站恢复）',
      'common.restoredBatch': '已恢复 {ok} 条',
      'trash.sub': '软删除的笔记 · 恢复可找回 · 彻底删除不可恢复',
      'trash.empty': '回收站为空（删除的笔记会出现在这里）。',
      'trash.restoreSel': '恢复所选',
      'trash.purgeSel': '彻底删除所选',
      'trash.titleTip': '{title}（点击预览正文，只读）',
      'trash.deletedAt': '删于 {time}',
      'trash.preview': '预览',
      'trash.collapse': '收起',
      'trash.restore': '恢复',
      'trash.purge': '彻底删除',
      'trash.previewLoading': '预览加载中…',
      'trash.previewFailed': '预览失败：{msg}',
      'trash.noBody': '无正文',
      'trash.purged': '已彻底删除',
      'trash.purgeConfirm': '彻底删除不可恢复：「{title}」\n删除后正文与归档备份将一并移除，确认彻底删除？',
      'trash.restoreBatchConfirm': '批量恢复：所选的 {n} 条笔记将移出回收站（恢复后回到正常列表）。\n确认恢复？',
      'trash.purgeBatchConfirm': '批量彻底删除：所选的 {n} 条笔记将彻底删除，不可恢复（含历史版本）。\n删除后正文、历史版本快照与归档备份将一并移除，确认彻底删除？',
      'trash.purgedBatch': '已彻底删除 {ok} 条',
      /* 0.4.3⑥（notes-043-sys-kind）：kind=sys 系统根笔记豁免面——多选批量删除红字警示 + confirm 门槛（双端 selbar/archive 共用） */
      'sys.selWarn': '含 {n} 篇系统笔记',
      'sys.batchDelWarn': '所选含 {n} 篇系统托管笔记（kind=sys：执行记录/注入索引/记忆档案等机器产物）。\n删除可能破坏调度回执、资料召回与引用账本，仍要删除吗？',
      'sugg.sub': '只提名不自动执行 · 软删除可恢复',
      'sugg.analyzing': '分析中…',
      'sugg.failed': '分析失败：{msg}',
      'sugg.clean': '库很干净，无需整理。',
      'sugg.secArch': '可整理的速记组',
      'sugg.countGroups': '{n} 组',
      'sugg.goArch': '去归档',
      'sugg.secStale': '过期未引用',
      'sugg.countItems': '{n} 条',
      'sugg.deleting': '删除中…',
      'sugg.batchDel': '一键批量软删除',
      'sugg.staleDays': '{n} 天未更新',
      'sugg.staleEmpty': '没有过期且从未被引用的笔记。',
      'sugg.secOrphan': '可能无用',
      'sugg.view': '查看',
      'sugg.orphanEmpty': '没有孤儿笔记（无双链关联且从未被引用）。',
      'sugg.secLogHg': '日志卫生',
      'sugg.tierWeekly': '周聚合',
      'sugg.tierMonthly': '月聚合',
      'sugg.logHgMeta': '{tier} · {n} 条',
      'sugg.detail': '明细',
      'sugg.sessSeg': ' · 会话 {id}',
      'sugg.logHgEmpty': '没有待聚合的工作日志（超窗日志按 工作区×周/月 归组，同组 ≥2 条才提名）。',
      'sugg.criteria': '判定口径：过期 = 超过时效阈值（设置卡片可调）且从未被引用；可能无用 = 无 [[双链]] 关联、未注入、从未被引用的进行中普通笔记（启发式，请逐条过目）。日志卫生 = 超 7 天周聚合 / 超 90 天月聚合提名（设置卡片「工作记忆」区可调窗口）；v0 仅展示明细，一键合并将在后续版本提供。',
      'sugg.criteriaClient': '判定口径：过期 = 超过时效阈值（设置卡片可调）且从未被引用；可能无用 = 无 [[双链]] 关联、未注入、从未被引用的进行中普通笔记（启发式，请逐条过目）。日志卫生 = 超 7 天周聚合 / 超 90 天月聚合提名（设置卡片「工作记忆」区可调窗口）；日志只聚合不淘汰，永不进过期/孤儿候选；v0 仅展示明细，一键合并将在后续版本提供。',
      'sugg.softDeleted': '已软删除 {ok} 条（回收站可恢复）',
      'newnote.draftToast': '已开草稿：输入标题或正文即自动落库；直接点别的笔记则草稿丢弃（零空笔记）',
      'newnote.createdToast': '已创建笔记（首次编辑自动落库）',
      'newnote.flushedToast': '草稿已自动落库：「{title}」',
      'newnote.failed': '创建失败：{msg}',
      'newnote.title': '新建笔记',
      'newnote.titlePlaceholder': '笔记标题…',
      'newnote.kindLabel': '类型',
      'newnote.templateHint': '将预填模板骨架',
      'newnote.freeHint': '自由格式（空正文）',
      'newnote.create': '创建',
      'newnote.creating': '创建中…',
      'newnote.created': '已创建',
      'cheat.closeTip': '关闭（Esc / ?）',
      'cheat.hint': '非输入焦点时生效；输入框 / 富文本内不响应 j/k、Enter、?。设置卡「键盘快捷键」行也可打开本表。',
      'cheat.kSearch': '聚焦搜索框',
      'cheat.kNew': '新建笔记（Ctrl+N 是浏览器保留键「新建窗口」，页面拿不到，故改用 Alt+N）',
      'cheat.kMode': '编辑器 源码 ⇄ 富文本 切换（编辑中生效；弹窗打开时不切）',
      'cheat.kDown': '列表焦点下移一行',
      'cheat.kUp': '列表焦点上移一行',
      'cheat.kOpen': '打开焦点笔记',
      'cheat.kSearchDown': '搜索框内：直达列表首行（保留过滤上下文，搜索 → ↓ → j/k → Enter 纯键盘路径）',
      'cheat.kSelf': '唤起 / 关闭本速查表',
      'cheat.kEsc': '分层关闭：弹层 → 排序/筛选/范围浮层 → 选区卡/右键菜单 → 退出多选 → 清搜索并还焦列表',
      'cheat.kEscClient': '分层关闭：弹层/浮层/菜单 → 退出多选 → 清搜索并还焦列表 → 关闭面板',
      'fld.where': '位置：{path}',
      'fld.root': '根级文件夹',
      'fld.namePlaceholder': '文件夹名称',
      'fld.okDefault': '确定',
      'fld.errEmpty': '文件夹名称不能为空',
      'fld.errDup': '同级已存在同名文件夹「{name}」',
      /* ===== 覆盖卡 F（notes-042-i18n-cov-f）：其余面板（folders/wiki/selection/search/query/filterbar/organize）+ 双端 popovers
         + 共享常量表条件映射（client kernel/constants.js FILTER_STATUS/KIND_LABELS/FILTER_SORTS、app kernel/state.js KIND/STATUS_LABEL、
         client injectScopeLabel——B/E 卡交接项）+ host toast 面（server.js 无用户可见串：唯一直字面量为 RPC error，本期保持中文红线不动，67 节断言锁定）=====
         复用既有 key（禁重复建别名）：tree.pinned/untitled/movedTo/movedOut、meta.sens/injectEver/kindNote~kindLog/scopeAll/scopeSession/
           scopeHint/scopePending/wsOther/undo/pin/unpin、editor.backlinks/backlinksCount/backlinksWarming/backlinkJumpTip/backlinksEmpty/
           bodyLoading/bodyEmpty/organizeFailed/organizeEmpty/organized/noOrganizeUndo/organizeUndone、mem.sessLoadFailed、
           side.fchipStatusTip/fchipKindTip、sel.selCount/merge、common.delete/cancel/listSep/restoredBatch、arch.deletedBatch、
           inj.batchDoneFail、chrome.help（帮助气泡标题）；
         共享常量表中文字面量保留不抽（四端同构锚：check 30/34/39 锁定 FILTER_STATUS/FILTER_SORTS/KIND_LABELS 原文），渲染经 kindLabel/
           filterStatusLabel/statusLabel/sortLabelOf/sortDescOf 条件映射走 t()（运行时切语言即生效） */
      'filter.statusGroup': '状态',
      'filter.displayGroup': '显示',
      'filter.showHidden': '显示隐藏项',
      'filter.showHiddenTip': '显示/隐藏带「隐藏」属性的笔记与文件夹（OS 文件管理对齐；隐藏项读写与跳转不受影响）',
      'filter.ruleOr': '组内多选 = OR',
      'filter.kindGroup': '类型',
      'filter.ruleOrAnd': '组内 OR · 与状态组 = AND',
      'filter.hitCount': '命中 {n} 条',
      'filter.clear': '清空',
      'filter.done': '完成',
      'filter.removeAria': '移除条件 {label}',
      'filter.clearedToast': '已清空全部筛选条件',
      'filter.stInjected': '已注入',
      'sort.time': '时间',
      'sort.use': '引用',
      'sort.rel': '相关度',
      'sort.timeDesc': '置顶优先 · 更新降序（默认）',
      'sort.useDesc': '被引用次数降序',
      'sort.relDesc': '搜索打分（搜索时生效）',
      'meta.statusActive': '进行中',
      'meta.statusResolved': '已解决',
      'meta.statusSuperseded': '已取代',
      'fld.titleNew': '新建文件夹',
      'fld.titleNewSub': '新建子文件夹',
      'fld.okNew': '新建',
      'fld.titleRename': '重命名文件夹',
      'fld.okRename': '重命名',
      'fld.created': '已建文件夹「{name}」',
      'fld.createFailed': '建文件夹失败：{msg}',
      'fld.renamed': '已重命名为「{name}」',
      'fld.renameFailed': '重命名失败：{msg}',
      'fld.delConfirmCascade': '删除文件夹「{name}」？连子删除：{childN} 个子文件夹 + {noteN} 条笔记移入回收站（可恢复）；文件夹结构不可恢复。',
      'fld.delConfirmEmpty': '删除空文件夹「{name}」？',
      'fld.deleted': '已删除文件夹「{name}」',
      'fld.deletedDetail': '（含 {childN} 个子文件夹，{noteN} 条笔记已入回收站）',
      'fld.deleteFailed': '删除失败：{msg}',
      'fld.sortFailed': '排序失败：{msg}',
      'fld.errSelf': '文件夹不能挂到自己下面',
      'fld.errCycle': '文件夹不能挂到自己的子孙文件夹下面（cycle）',
      'fld.movedInto': '已移入「{name}」',
      'fld.movedRoot': '已移回根级',
      'fld.moveFailed': '移动失败：{msg}',
      'fld.menuUp': '上移',
      'fld.menuDown': '下移',
      'fld.menuRoot': '移回根级',
      'fld.menuHide': '隐藏此文件夹',
      'fld.menuUnhide': '取消隐藏',
      'fld.hiddenToast': '已隐藏文件夹「{name}」（列表遮罩滤除；筛选中心「显示隐藏」可再显）',
      'fld.unhiddenToast': '已取消隐藏「{name}」',
      'fld.hideFailed': '显隐设置失败：{msg}',
      'fld.menuDeleteFolder': '删除文件夹',
      'fld.loadFailed': '文件夹加载失败，显示本地缓存：{msg}',
      'wiki.idxFailedPartial': '双链索引失败 {n} 条：反向链接/行尾标记不完整（下次刷新自动重试）',
      'wiki.idxFailed': '双链索引失败 {n} 条：{msg}（下次刷新自动重试）',
      'wiki.idxFailedClient': '双链索引失败 {n} 条（下次刷新自动重试）',
      'wiki.targetNotFound': '未找到链接目标：{target}',
      'cap.title': '选区速记',
      'cap.autoQuote': '记录为 引用',
      'cap.autoQuoteClient': '识别为 引用',
      'cap.placeholder': '可补充：打标签 / 引导标题 / 定类型…',
      'cap.placeholderClient': '可补充：打标签/引导标题/定类型/注入为上下文…直接回车则仅记录',
      'cap.enterHint': 'Enter 记录',
      'cap.copy': '复制',
      'cap.save': '记录',
      'cap.copied': '已复制选区',
      'cap.copyFailed': '复制失败',
      'cap.noSelection': '无选区可复制',
      'cap.merged': '已合并进今日速记',
      'cap.mergedClient': '已合并到本次速记',
      'cap.savedQuote': '已记录为引用（主题分类由 host LLM 异步回填）',
      'cap.savedClient': '已记录，正在识别主题…',
      'cap.savedPlain': '已记录',
      'cap.savedCtx': '已记录并注入为上下文（{role}）',
      'cap.savedTags': '已记录并标记 {tags}',
      'cap.savedKind': '已记录为{kind}',
      'cap.sensSuffix': '，已标记敏感（注入自动脱敏）',
      'cap.failed': '记录失败：{msg}',
      'search.offline': '在线检索不可用，仅显示本地过滤结果：{msg}',
      'sel.deleting': '删除中…',
      'ctx.reopen': '重开',
      'ctx.markResolved': '标记已解决',
      'ctx.moveTo': '移动到文件夹',
      'ctx.moveOut': '移出文件夹（未分类）',
      'ctx.newFolderPlaceholder': '新文件夹名…',
      'ctx.newFolder': '新建文件夹…',
      'ctx.merge': '合并为一篇',
      'help.newPre': '点侧栏「新建」或按 ',
      'help.newPost': ' 输入标题新建笔记，创建后直接编辑正文',
      'help.capture': '在页面划选文字松手，弹出快速记录卡片（自动识别为引用）',
      'help.mergeWin': '同一会话 10 分钟内的速记自动合并',
      'help.topic': '点面包屑/编辑器里的主题可按主题全局过滤（跨文件夹）',
      'help.drag': '拖笔记到文件夹行移入，拖到树根部未入夹笔记区移出（拖拽中显示落点提示）',
      'help.keysLead': '快捷键：',
      'help.keysSearch': ' 搜索（框内 ',
      'help.keysSearchEnd': ' 直达列表）、',
      'help.keysNew': ' 新建、',
      'help.keysMoveOr': ' 或 ',
      'help.keysMoveEnd': ' 移动、',
      'help.keysOpen': ' 打开、',
      'help.keysEsc': ' 分层（关浮层 → 清搜索并还焦列表 → 关面板）',
      'help.cheatPre': '非输入焦点时按 ',
      'help.cheatPost': ' 唤起快捷键速查表（cheat sheet，Esc 关闭；设置卡「键盘快捷键」行同入口）',
      'help.archive': '「速记」：弹出预览，勾选速记组后才合并（可撤销）；手动笔记点「选择」多选合并',
      'help.organize': '编辑器「整理」：AI 按类型模板重写正文（替换后可撤销一次）；新建笔记按类型预填模板骨架',
      'help.image': '图片超过 1MB 自动压缩转 JPEG；设置卡片「资产清理」清理未被引用的孤儿文件',
      'help.delete': '删除是软删除：侧栏底部「回收站」可恢复或彻底删除（彻底删除不可恢复）',
      'side.loadFailed': '列表加载失败：{msg}',
    }
    /* ===== i18n dictionary · English（notes-042-i18n-mech）=====
       直译优先 + 统一术语表（injection=注入 / convention=约定 / dispatch=派发 / agent memory=工作记忆 /
       folder=文件夹 / topic=主题 / trash=回收站 / schedule=调度 / run log=执行记录 / batch endpoint=批量端点 / cheat sheet=速查表）。
       key 集合必须与 zh.js 完全一致（守卫卡双向断言）；变量统一 {name} 插值。
       双端共源（@i18n/ 前缀，同 @shared/ 规则）：app 态列 0 原样纳入；client 态逐非空行加 4 空格基座缩进。 */
    var I18N_EN = {
      'topbar.refresh': 'Refresh',
      'topbar.archive': 'Quick notes',
      'topbar.theme': 'Toggle theme',
      'topbar.home': 'DSH Home',
      'topbar.filter': 'Filter',
      'topbar.trash': 'Trash',
      'topbar.select': 'Select',
      'topbar.searchPlaceholder': 'Search notes, tags, content…',
      'common.settings': 'Settings',
      'common.save': 'Save',
      'common.restore': 'Restore',
      'common.cancel': 'Cancel',
      'common.close': 'Close',
      'common.delete': 'Delete',
      'common.loading': 'Loading…',
      'common.refreshed': 'Refreshed',
      'common.saveFailed': 'Save failed: {msg}',
      'settings.language': 'Language',
      'settings.languageTip': 'UI language (remembered locally, applies immediately)',
      /* ===== Coverage card A (notes-042-i18n-cov-a): topbar + sidebar tree + hintbar ===== */
      'topbar.subtitle': 'Your note library · conventions and references you write can be injected into Agent sessions',
      'topbar.refreshTip': 'Reload the list and folders (LLM topic classification backfills asynchronously; refresh to see it)',
      'topbar.archiveTip': 'Quick-note merge: merge quick notes from the same session into one; click to preview, only checked groups run (undoable)',
      'topbar.themeTip': 'Toggle theme (dark/light)',
      'topbar.homeTip': 'Back to DSH Home',
      'topbar.filterTip': 'Filter center: check conditions by group (OR within a group, AND across groups)',
      'topbar.sortTip': 'Sort (orthogonal to filters; neither resets the other)',
      'topbar.filterAria': 'Filter conditions',
      'topbar.trashTip': 'Trash: view deleted notes; restore or purge them',
      'topbar.selectTip': 'Multi-select notes: checked notes can be merged into one (Esc to exit)',
      'side.brand': 'Notes',
      'side.newTip': 'New note (Alt+N)',
      'side.splitterTip': 'Drag to resize the sidebar (double-click to reset)',
      'side.more': 'Scroll to load more (showing {shown} / {total})',
      'side.fchipStatusTip': 'Filter: status / {label} (click × to remove)',
      'side.fchipKindTip': 'Filter: type / {label} (click × to remove)',
      'tree.topicTip': 'Topic: {topic}',
      'tree.untitled': 'Untitled',
      'tree.injectTip': 'Injected as context · {role}',
      'tree.roleReference': 'reference',
      'tree.roleConvention': 'convention',
      'tree.injectScope': 'Scope: {scope}',
      'tree.injectEverTip': 'Injected before: context injection was once enabled (now off)',
      'tree.useCountTip': 'Referenced by Agent (note_get hit) {n} times',
      'tree.wikiTip': 'Has [[…]] wiki links (clickable in the detail rich text)',
      'tree.toggleTip': 'Expand/collapse',
      'tree.sysChipTip': 'Machine-managed note (sys): hidden from default list/search, shown when its folder is expanded (0.4.4-C explicit entry)',
      'tree.countN': '{n}',
      'tree.viewTopic': 'Topic · {id}',
      'tree.viewAll': 'All notes',
      'tree.crossFolderCount': '({n} across folders)',
      'tree.clearViewTip': 'Clear view filter',
      'tree.pinned': 'Pinned',
      'tree.folders': 'Folders',
      'tree.addFolderTip': 'New folder',
      'tree.dropOutHint': 'Drop here to remove from folder',
      'tree.dropRootHint': 'Drop here to move back to the root level',
      'tree.topicsHeader': 'Topics ({n})',
      'tree.crossFolder': 'Across folders',
      'tree.topicViewTip': 'Topic view (cross-folder filter)',
      'tree.noMatch': 'No matching notes',
      'tree.clearFilters': 'Clear filter conditions',
      'tree.clearFiltersShort': 'Clear filters',
      'tree.clearAllFiltersTip': 'Clear all filter conditions',
      'tree.movedTo': 'Moved to "{name}"',
      'tree.movedOut': 'Removed from folder',
      'tree.moveFailed': 'Move failed: {msg}',
      'tree.subFolderPlaceholder': 'Subfolder name…',
      'tree.folderPlaceholder': 'Folder name…',
      'tree.classifying': 'Classifying',
      'tree.emptyTitle': 'No notes yet',
      'tree.emptySub': 'Click New in the sidebar, enter a title, and create your first note',
      'tree.emptyBtn': 'Write the first one',
      'sel.selCount': '{n} selected',
      'sel.merge': 'Merge',
      'hint.select': '🖱 <b>Select text and release</b> in the editor on the right → pop up the quick-capture card',
      'hint.drag': 'Drag a note → onto a folder to move in / onto the root note area to move out',
      'hint.folder': 'Click to expand/collapse · right-click to manage',
      'hint.keys': 'Ctrl K search · Alt N new · j/k move · Enter open · Esc close overlays · ? shortcuts',
      'chrome.dragMove': 'Drag to move the window',
      'chrome.entryModeTip': 'Switch entry mode: session header / floating bubble',
      'chrome.help': 'Help',
      'chrome.resizeTip': 'Drag to resize',
      /* ===== Coverage card B (notes-042-i18n-cov-b): editor + meta ===== */
      'common.listSep': ', ',
      'editor.richDegradedReasons': 'Advanced syntax detected ({reasons}); please edit in source mode',
      'editor.loadFailed': 'Failed to load the note body: {msg}',
      'editor.loadFailedData': 'Malformed response',
      'editor.loadFailedLocked': '{msg} (editing locked; click Retry in the banner)',
      'editor.autoSaved': '✓ Autosaved {time}',
      'editor.autoSavedFlat': 'Autosaved {time}',
      'editor.emptyTitle': 'Select a note on the left to view and edit',
      'editor.emptySub': 'Click + at the top of the sidebar to create a note (a draft opens first and is saved on first input); select text in the body to pop up the quick-capture card',
      'editor.emptyTitleShort': 'Select a note to view and edit',
      'editor.emptySubShort': 'Click "New" in the sidebar, enter a title, and create a note',
      'editor.degBanner': 'Detected <b>out-of-whitelist syntax</b>; rich text editing is unavailable (source editing still works):',
      'editor.degBannerPre': 'Detected ',
      'editor.degBannerB': 'out-of-whitelist syntax',
      'editor.degBannerPost': '; rich text editing is unavailable (source editing still works):',
      'editor.degBanner2': 'Once the syntax is removed, the "Rich text" entry becomes available again immediately.',
      'editor.loadLockNote': ' — editing locked and autosave paused (prevents overwriting the original with empty content).',
      'editor.retry': 'Retry',
      'editor.bodyPlaceholder': 'Body… (Markdown)',
      'editor.richPlaceholder': 'Body… (rich text; syncs to source on blur)',
      'editor.tbBold': 'Bold **text**',
      'editor.tbItalic': 'Italic *text*',
      'editor.tbCode': 'Inline code `text`',
      'editor.tbLink': 'Link [text](url)',
      'editor.tbUl': 'Bulleted list',
      'editor.tbOl': 'Numbered list',
      'editor.tbQuote': 'Quote block',
      'editor.tbImage': 'Insert image ![](assets/..) (or Ctrl+V paste / drag a file in)',
      'editor.syncing': 'Editing…',
      'editor.synced': 'Synced to source',
      'editor.modeSource': 'Source mode',
      'editor.modeRich': 'Rich text mode',
      'editor.imageOnly': 'Only image files are supported',
      'editor.tableReadonly': 'Tables are read-only; switch to source mode to edit this region',
      'editor.richRestored': 'Rich text mode is available again',
      'editor.richDisabled': 'Out-of-whitelist syntax detected → rich text entry disabled',
      'editor.degReasonItem': '{label} (line {line}: {sample})',
      'editor.selectCodeFirst': 'Select the text to mark as inline code first',
      'editor.selectLinkFirst': 'Select the text to turn into a link first',
      'editor.selectNoteFirst': 'Select a note first',
      'editor.bodyLoading': 'The body is still loading; organize later',
      'editor.bodyEmpty': 'The body is empty; nothing to organize',
      'editor.organizeFailed': 'Organize failed: {msg}',
      'editor.organizeEmpty': 'Organize returned empty; the original is untouched',
      'editor.organized': 'Organized with the "{kind}" template',
      'editor.noOrganizeUndo': 'No organize to undo',
      'editor.organizeUndone': 'Restored the pre-organize body',
      'editor.charCount': '{n} chars',
      'editor.backlinks': 'Backlinks',
      'editor.backlinksCount': ' ({n})',
      'editor.backlinksWarming': ' (indexing…)',
      'editor.backlinkJumpTip': 'Jump to "{name}"',
      'editor.backlinksEmpty': 'No other notes link here with [[…]] yet',
      'meta.crumbFolderExpandTip': 'Expand in tree: {name}',
      'meta.crumbTopicTip': 'Filter globally by topic (across folders)',
      'meta.crumbTopicViewTip': 'View all notes with this topic',
      'meta.uncategorized': 'Uncategorized',
      'meta.unsavedDraft': 'Unsaved draft',
      'meta.filteredByTopic': 'Filtered by topic: {name}',
      'meta.noTopic': 'This note has no recognized topic yet',
      'meta.kindTip': 'Type',
      'meta.kindTipFull': 'Note type',
      'meta.kindNote': 'Note',
      'meta.kindDecision': 'Decision',
      'meta.kindTodo': 'Todo',
      'meta.kindLink': 'Link',
      'meta.kindQuote': 'Quote',
      'meta.kindLog': 'Log',
      'meta.kindSys': 'Machine',
      'meta.statusTip': 'Status',
      'meta.topicTip': 'Topic (the host LLM may backfill it asynchronously; autosaved on change)',
      'meta.topicTipClient': 'Topic (edit directly; use the button on the right to filter globally by topic)',
      'meta.topicPlaceholder': 'Topic',
      'meta.topicFilterTip': 'Filter globally by topic',
      'meta.tagsTip': 'Tags, comma-separated',
      'meta.tagsTipClient': 'Tags (comma-separated; the convention tag has been replaced by the injection toggle)',
      'meta.tagsPlaceholder': 'Tags…',
      'meta.folderTip': 'Containing folder',
      'meta.useCountTip': 'Usage telemetry: times referenced by the Agent (note_get hits)',
      'meta.useCount': 'Referenced {n} times',
      'meta.dispPendingTip': 'Dispatching: {open} pending receipt (of {total}) · auto-receipt when the target session goes idle or the note is resolved; click to view dispatch history',
      'meta.dispDoneTip': 'All {total} dispatches received · click to view dispatch history',
      'meta.dispPending': 'Dispatching {open}/{total}',
      'meta.dispDone': 'All received',
      'meta.roleOffTip': 'Do not inject into the system prompt',
      'meta.roleOff': 'Off',
      'meta.logNoInject': 'No injection (log)',
      'meta.logNoInjectTip': 'Work logs are hard-gated out of injection (host forces inject=false); logs are first-class — visible/searchable/editable; never included in the injected directory',
      'meta.roleConventionTip': 'Behavioral rules the Agent must follow',
      'meta.roleReferenceTip': 'Factual reference the Agent consults as needed',
      'meta.scopeTip': 'Choose the injection scope (multi-select)',
      'meta.scopeAll': 'All sessions',
      'meta.scopeSession': 'Session {name}',
      'meta.scopeHint': 'Injected into all sessions by default; check sessions to restrict injection to them',
      'meta.scopePending': '{short} · loading title…',
      'meta.wsOther': 'Other',
      'meta.sensTip': 'Sensitive: when injected into the system prompt, the body is masked line by line (keys kept, values hidden); the Agent uses note_get for the original',
      'meta.sens': 'Sensitive',
      'meta.hiddenTip': 'Hidden: not shown in list/tree (masked out while the show-hidden toggle is off; open via link or search is unaffected) — click to toggle',
      'meta.hidden': 'Hidden',
      'meta.injectEverTip': 'Injected before: context injection was once enabled (now off; injectEver is a sticky mark that never reverts)',
      'meta.injectEver': 'Injected before',
      'meta.srcModeTip': 'Markdown source editing',
      'meta.src': 'Source',
      'meta.richModeTip': 'Rich text (limited WYSIWYG, Ctrl+/ to toggle)',
      'meta.richModeTipClient': 'Rich text (limited WYSIWYG)',
      'meta.rich': 'Rich text',
      'meta.richDegradedShort': 'Advanced syntax detected; please edit in source mode',
      'meta.modeAria': 'Editor mode (Ctrl+/ to toggle)',
      'meta.organizingTip': 'AI organizing…',
      'meta.organizeTip': 'AI organize: rewrite the body with the "{kind}" template (undoable after replacement)',
      'meta.organizing': 'Organizing…',
      'meta.organize': 'Organize',
      'meta.dispatchTip': 'Dispatch the todo to a live session',
      'meta.dispatchTipClient': 'Dispatch the todo to a session (extra instructions supported)',
      'meta.dispatch': 'Dispatch',
      'meta.sourceTip': 'Source session',
      'meta.sourceJumpTip': 'Jump to the source session',
      'meta.source': 'Source',
      'meta.histTip': 'History ({n} snapshots): preview / one-click restore (the current version is snapshotted first, undoable)',
      'meta.history': 'History',
      'meta.unpin': 'Unpin',
      'meta.pin': 'Pin',
      'meta.delTip': 'Delete (soft delete; undoable / restorable by the Agent)',
      'meta.delTipClient': 'Delete (soft delete, restorable)',
      'meta.injectOff': 'Context injection disabled',
      'meta.injectOn': 'Injected as context · {role} (scope in the dropdown on the right)',
      'meta.sensOn': 'Marked sensitive (auto-masked when injected)',
      'meta.sensOff': 'Sensitive mark removed',
      'meta.hiddenOn': 'Hidden (no longer shown in list/tree; open via link or search is unaffected)',
      'meta.hiddenOff': 'Unhidden',
      'meta.sourceToast': 'Source session {short} ({full}) · this page cannot jump; open it from the DSH main UI',
      'meta.pinnedToast': 'Pinned',
      'meta.unpinnedToast': 'Unpinned',
      'meta.runLogNotFound': 'Run log note not found: {id}',
      'meta.schedPlan': 'Dispatch schedule',
      'meta.schedPaused': 'Paused',
      'meta.runLogTip': 'View the run log note (schedule.runLog soft link: {id})',
      'meta.runLog': 'Run log ↗',
      'meta.schedEditTip': 'Backfill the dispatch modal to edit the schedule declaration',
      'meta.edit': 'Edit',
      'meta.schedResumeTip': 'Resume the schedule (enabled=true; the host re-validates target liveness)',
      'meta.schedPauseTip': 'Pause the schedule (enabled=false; declaration and history kept)',
      'meta.resume': 'Resume',
      'meta.pause': 'Pause',
      'meta.schedDelTip': 'Soft-delete the convention note (restorable from trash); the schedule stops immediately',
      'meta.schedPeerTip': 'Jump to the schedule convention "{name}"',
      'meta.schedPeer': 'Related schedules',
      'meta.schedPeerNotFound': 'Schedule convention not found: {id}',
      'meta.dispHistory': 'Dispatch history ({n})',
      'meta.dispStDone': 'Done',
      'meta.dispStPending': 'Pending',
      'meta.dispNew': 'new session',
      'meta.dispExisting': 'existing session',
      'meta.dispInstruction': 'Instructions: {text}',
      'meta.dispMarkDone': 'Mark done',
      'meta.dispMarkedDone': 'Marked done',
      'meta.opFailed': 'Operation failed: {msg}',
      'meta.createdAt': 'Created {time}',
      'meta.draftHint': 'Draft (saved on first input)',
      'meta.updatedAt': 'Updated {time}',
      'meta.sourceSession': 'Source session {short}',
      'meta.sourcePage': 'Source page',
      'meta.refreshFailed': 'Failed to refresh the note; showing the local cache: {msg}',
      'meta.draftDiscarded': 'Draft discarded (never saved)',
      'meta.deleted': 'Deleted (soft delete)',
      'meta.undo': 'Undo',
      'meta.restored': 'Restored',
      'meta.restoreFailed': 'Restore failed: {msg}',
      'meta.deleteFailed': 'Delete failed: {msg}',
      'meta.schedFailed': 'Failed {time}',
      'meta.schedReceiptTip': 'Receipt via the dispatch loop (receiptId={id})',
      'meta.schedSent': 'Dispatched {time}',
      'meta.schedNever': 'Never fired',
      'meta.schedFired': 'Fired (one-shot)',
      'meta.schedNext': 'Next {time}',
      /* ===== Coverage card C (notes-042-i18n-cov-c): settings card bilingual (app modals/settings.js + client modals/settings.js) =====
         Reuses existing keys: common.settings/save/restore/loading/saveFailed, topbar.trash/topbar.trashTip, settings.language/languageTip */
      'settings.closeTip': 'Close (Esc; unsaved changes are auto-flushed first)',
      'settings.onboardTitle': 'Concepts at a glance',
      'settings.onboardInject': '· Injection: note bodies go into the Agent system prompt, visible in every conversation (controlled by the editor injection three-state toggle)',
      'settings.onboardRoles': '· Convention / reference: the two injection roles — convention = rules the Agent must follow; reference = material the Agent consults as needed',
      'settings.onboardCatalog': '· Catalog injection: only mounted-note index lines (one per note, with "when to use") are given to the Agent; it fetches full text via note_get on demand',
      'settings.onboardDispatch': '· Dispatch: hand a todo note to a chosen session; receipts close the loop automatically.',
      'settings.followSession': 'Follow the current session (default)',
      'settings.followBtn': 'Follow session',
      'settings.savedSuffix': ' (saved)',
      'settings.llm': 'LLM model',
      'settings.llmTip': 'Model used for note auto-classification / instruction extraction',
      'settings.usage': 'LLM usage',
      'settings.usageTip': 'Token usage stats for note features (real usage first, estimated by characters when not reported); accumulated daily, persisted to usage.json',
      'settings.usageLine': 'Today {today} · this week {week} · this month {month} · all time {all} tokens',
      'settings.usageCalls': ' ({n} calls)',
      'settings.usageByFeature': 'Classify {classify} · organize {organize} · summarize {summarize}',
      'settings.usageEstimated': ' (includes character estimates, approx.)',
      'settings.usageLoadFailed': 'Failed to load usage data',
      'settings.usageOverBudget': '⚠ Note LLM usage this month {used} tokens exceeded the budget {budget} (reminder only, calls not blocked)',
      'settings.usageBudget': 'Usage budget reminder',
      'settings.usageBudgetTip': 'Remind when token usage this month exceeds this value (toast only, calls not blocked); 0 = off',
      'settings.usageBudgetTipT': 'Toast when LLM token usage this month exceeds this value (reminder only, calls not blocked); 0 = off',
      'settings.stale': 'Staleness reminder',
      'settings.staleTip': 'Notes/links not updated for over N days (and never read) are nominated as stale candidates in "Organize Suggestions" (reminds that references may be outdated); 0 = off',
      'settings.staleTipT': 'Notes/links not updated for over N days are nominated as stale candidates in "Organize Suggestions"; 0 = off',
      'settings.maxDepth': 'Folder nesting depth',
      'settings.maxDepthTip': 'Maximum nesting level of virtual folders (root = level 1, default 3); creating subfolders or drag-reparenting beyond the limit is rejected with a notice; 0 = unlimited',
      'settings.maxDepthTipT': 'Maximum nesting level of virtual folders (root = level 1); creating subfolders or drag-reparenting beyond the limit is rejected with a toast; 0 = unlimited',
      'settings.budget': 'Injection size budget',
      'settings.budgetTip': 'Upper limit of a single full-text injection (approx., by character count); convention entries are never truncated, reference entries are omitted oldest first; 0 = unlimited',
      'settings.gaugeTip': 'Size of the most recent full-text injection (approx., by characters)',
      'settings.gaugeCurrent': 'Current injection ≈ {last} chars',
      'settings.gaugeBudget': 'budget ≈ {budget} chars',
      'settings.gaugeUnlimited': ' (unlimited)',
      'settings.injPreview': 'Injection preview',
      'settings.injPreviewTip': 'View the exact injected text the Agent receives (convention + directory): sensitive masking / budget truncation as-is; filterable by session',
      'settings.injPreviewTipT': 'Preview the note text actually injected into the Agent system prompt (convention bucket + directory section), with sensitive masking / budget truncation; filterable by session',
      'settings.previewBtn': 'Preview…',
      'settings.injManager': 'Injection manager',
      'settings.injManagerTip': 'Library-wide injection overview: per-note three-state editing (off/convention/reference) + multi-select batch + three-state filter/search; logs do not participate in injection (hard gate, no switch offered), sensitive notes auto-masked; includes the schedules area (scheduled-dispatch overview / edit backfill / pause / delete)',
      'settings.injManagerTipT': 'Open the injection manager: overview of the injection three-state (convention/reference/off) for all notes; edit inline or batch-adjust with multi-select; top stat chips filter on click; logs do not participate in injection (hard gate, no switch offered), sensitive notes auto-masked; includes the schedules area (scheduled-dispatch overview / edit backfill / pause / delete)',
      'settings.manageBtn': 'Manage…',
      'settings.data': 'Data',
      'settings.dataTip': 'Full-library catalog snapshot export / import from a snapshot directory (adds and updates only, never deletes; full backup before import) / trash as the fallback (restore or purge)',
      'settings.dataTipClient': 'Full-library catalog snapshot export / single-file stitched export (images inlined, shareable) / import from a snapshot directory (adds and updates only; full backup before import) / trash as the fallback (restore or purge)',
      'settings.exportAll': 'Export all',
      'settings.exportAllTip': 'Snapshot the whole note library (including folders.json) to a target directory',
      'settings.exportSingle': 'Export single file…',
      'settings.exportSingleTip': 'Stitch a scope (all/folder/tag) into one Markdown file: images inlined as base64, ready to share; still exports with a warning over 20MB',
      'settings.importBtn': 'Import…',
      'settings.importTip': 'Import from a directory snapshot: preview the details first, then execute; adds and updates only, auto-backup',
      'settings.assets': 'Asset cleanup',
      'settings.assetsTip': 'Scan assets/ for orphan files not referenced by any note (references from deleted notes still count as protection — rather keep than delete)',
      'settings.assetsTipT': 'Preview orphan files in assets/ not referenced by any note, then delete the checked ones (dry-run first, zero writes)',
      'settings.pruneBtn': 'Clean up…',
      'settings.suggest': 'Organize suggestions',
      'settings.suggestTip': 'Quick-note group archiving / stale unreferenced cleanup / orphan note candidates / log hygiene nominations (nominates only, never auto-executes)',
      'settings.suggestTipClient': 'Quick-note group archiving / stale unreferenced cleanup / orphan note candidates (nominates only, never auto-executes)',
      'settings.suggestTipT': 'Organize suggestions: quick-note group archiving / stale unreferenced cleanup / orphan note candidates (nominates only, never auto-executes)',
      'settings.openBtn': 'Open',
      'settings.memory': 'Agent memory',
      'settings.memoryTip': 'Session work conclusions settle into work logs (kind=log, first-class like any note: visible/searchable/editable; injection hard-disabled, never in the injected directory); enabling = create one prefilled convention note (visible/editable/disable-able)',
      'settings.memProbing': 'Probing…',
      'settings.memEnabled': 'Enabled',
      'settings.memView': 'View convention',
      'settings.memViewTip': 'View the guide convention note (visible/editable/deletable — the single injection source)',
      'settings.memDisable': 'Disable',
      'settings.memDisableTip': 'Disable = turn off injection of the guide convention note (the note is kept and can be re-enabled)',
      'settings.memPending': 'Processing…',
      'settings.memEnable': 'Enable settling guide…',
      'settings.memEnableTip': 'Create a prefilled convention note (inject=true, contractType: memory-guide) that guides the Agent to write session conclusions as work logs (kind=log, first-class visible/searchable, injection hard-disabled) at task wrap-up — coexists with existing conventions without conflict',
      'settings.logWeek': 'Log weekly rollup window',
      'settings.logWeekTip': 'Work logs older than N days are nominated for rollup by workspace×week in organize suggestions (nominates only; default 7 days)',
      'settings.logWeekTipT': 'Work logs older than N days are nominated for rollup by workspace×week in organize suggestions (nominates only)',
      'settings.logMonth': 'Log monthly rollup window',
      'settings.logMonthTip': 'Logs older than N days are nominated for monthly rollup (raw logs and weekly logs grouped together; default 90 days); 0 = off',
      'settings.logMonthTipT': 'Logs older than N days are nominated for monthly rollup (raw logs and weekly logs grouped together); 0 = disables this level',
      'settings.cheatsheet': 'Keyboard shortcuts',
      'settings.cheatsheetTip': 'Cheat sheet of all effective keyboard-flow shortcuts (verified key by key against the implementation); press ? when not typing to open directly, Esc to close',
      'settings.cheatsheetTipT': 'Keyboard-flow cheat sheet: all effective shortcuts (verified key by key); ? opens directly, Esc closes',
      'settings.viewBtn': 'View…',
      'settings.saving': 'Saving…',
      'settings.restoreTip': 'Restore: roll everything back to the settings as they were when opened (key by key)',
      'settings.saveTip': 'Save: flush all unsaved changes with explicit confirmation (autosave unchanged; this is the fallback + confirmation)',
      'settings.savedLlm': 'Saved: notes LLM = {name}',
      'settings.restoredFollow': 'Restored to following the current session (default)',
      'settings.llmRequired': 'Both provider and model are required',
      'settings.staleInvalid': 'The staleness threshold must be a non-negative integer (0 = off)',
      'settings.staleOff': 'Stale-candidate nomination disabled',
      'settings.savedStale': 'Saved: references not updated for over {v} days will be nominated as stale candidates in Organize Suggestions',
      'settings.maxDepthInvalid': 'The folder nesting depth limit must be a non-negative integer (0 = unlimited)',
      'settings.maxDepthUnlimited': 'Saved: unlimited folder nesting',
      'settings.savedMaxDepth': 'Saved: folders may nest up to {v} levels',
      'settings.budgetInvalid': 'The injection size budget must be a non-negative integer (0 = unlimited)',
      'settings.budgetOff': 'Injection size budget disabled (unlimited)',
      'settings.savedBudget': 'Saved: injection budget ≈ {v} chars',
      'settings.logWeekInvalid': 'The weekly rollup window must be a non-negative integer (days)',
      'settings.savedLogWeek': 'Saved: logs older than {v} days will be nominated for weekly rollup',
      'settings.logMonthInvalid': 'The monthly rollup window must be a non-negative integer (0 = off)',
      'settings.logMonthOff': 'Monthly rollup nomination disabled',
      'settings.savedLogMonth': 'Saved: logs older than {v} days will be nominated for monthly rollup',
      'settings.usageBudgetInvalid': 'The monthly usage budget must be a non-negative integer (0 = off)',
      'settings.usageBudgetOff': 'Monthly usage budget reminder disabled',
      'settings.savedUsageBudget': 'Saved: monthly usage budget {v} tokens',
      'settings.savedAll': 'Settings saved',
      'settings.restoredAll': 'Restored: settings rolled back to the state when opened',
      'settings.restoreFailed': 'Restore failed: {msg}',
      'settings.flushSaveFailed': 'Failed to save settings: {msg}',
      'settings.loadFailed': 'Failed to load settings: {msg}',
      /* ===== Coverage card D (notes-042-i18n-cov-d): injection manager + memory guide bilingual =====
         Reuses existing keys (no aliases): settings.injManager (panel title)/memProbing/memEnabled/memView/memDisable/memEnable,
           common.loading/close/cancel/delete, tree.untitled/roleConvention/roleReference, sel.selCount,
           meta.roleOff/roleOffTip/roleConventionTip/roleReferenceTip/injectEver/injectEverTip (row three-state + ever badge),
           meta.schedPaused/schedEditTip/edit/schedResumeTip/schedPauseTip/resume/pause/schedDelTip/opFailed/deleteFailed/
           schedFailed/schedReceiptTip/schedSent/schedNever/schedFired/schedNext (schedule badge/next-fire/action row — built by card B);
         common.sched* = schedFreqLabel humanized frequency (cross-surface: injection manager + detail plan block,
           app kernel/helpers.js ⇄ client kernel/format.js, same semantics) */
      'common.schedOnce': 'Once {time}',
      'common.schedInvalid': 'Invalid interval',
      'common.schedDaily': 'Daily',
      'common.schedWeekly': 'Weekly',
      'common.schedWeeklyDow': 'Weekly {dow}',
      'common.dowNames': 'Sun|Mon|Tue|Wed|Thu|Fri|Sat',
      'common.schedNDays': 'Every {n} days',
      'common.schedNHours': 'Every {n} hours',
      'common.schedNMinutes': 'Every {n} minutes',
      'common.schedNMs': 'Every {n}ms',
      'inj.titleSub': 'Library-wide injection overview · inline editing / multi-select batch · logs do not participate in injection · schedules area (scheduled dispatch)',
      'inj.searchPlaceholder': 'Search title / topic / tags…',
      'inj.loadFailed': 'Load failed: {msg}',
      'inj.chipAll': 'All {n}',
      'inj.chipConvention': 'Convention {n}',
      'inj.chipReference': 'Reference {n}',
      'inj.chipOff': 'Not injected {n}',
      'inj.noMatch': 'No matching notes (adjust the filter or search terms).',
      'inj.emptyLib': 'The note library is empty.',
      'inj.selectAll': 'Select all',
      'inj.batchConvention': 'Set as convention',
      'inj.batchReference': 'Set as reference',
      'inj.batchRefTip': 'Batch set as reference: each note silently gets a default mount line (whenToUse = title) without a per-note dialog; switching a single row to Reference opens the editor dialog first',
      'inj.batchOff': 'Disable injection',
      'inj.executing': 'Running…',
      'inj.logNoInject': 'No injection (log)',
      'inj.logNoInjectTip': 'Work logs are hard-gated out of injection (host forces inject=false); logs are first-class — visible/searchable/editable; never included in the injected directory',
      'inj.sensTip': 'Sensitive note: auto-masked when injected (body masked line by line; keys kept, values hidden)',
      'inj.sensBadge': 'Auto-masked on injection',
      'inj.scopeGlobal': 'Global',
      'inj.scopeSessions': '{n} sessions',
      'inj.schedTitle': 'Scheduled tasks ({n})',
      'inj.schedTitleSub': 'Scheduled-dispatch conventions · declared in front-matter (contractType: dispatch-schedule); raw editing is the developer bypass',
      'inj.schedEmpty': 'No scheduled tasks yet — pick "Run on schedule" in the dispatch dialog to schedule one.',
      'inj.schedResumed': 'Schedule resumed: {title}',
      'inj.schedPausedToast': 'Schedule paused: {title}',
      'inj.schedDelConfirm': 'Delete the scheduled task "{title}"?\nThe convention note moves to the trash (restorable) and the schedule stops immediately.',
      'inj.schedDeleted': 'Scheduled task deleted: {title} (restorable from trash)',
      'inj.forcedOff': '"{title}" is a work log (no injection): inject was force-disabled',
      'inj.injectOffToast': 'Injection disabled: {title}',
      'inj.injectSetToast': 'Set as {role}: {title}',
      'inj.setFailed': 'Update failed: {msg}',
      'inj.batchLabelSet': 'Set as {role}',
      'inj.batchConfirm': '{label} (batch): the {n} selected notes will {effect}\nProceed?',
      'inj.batchEffOff': 'have context injection disabled.',
      'inj.batchEffRef': 'be injected as reference (consulted as needed).',
      'inj.batchEffConv': 'be injected as convention (must follow).',
      'inj.batchDone': '{label}: {ok} notes updated',
      'inj.batchDoneFail': ', {n} failed',
      // 0.4.3⑤ 挂载弹层（notes-043-index）：给资料开注入 → 手写 whenToUse → 确认落注入索引 §1 行
      'inj.mountTitle': 'Mount to injection index',
      'inj.mountSub': 'One line in index §1: when should the Agent consult this note?',
      'inj.mountLabel': 'whenToUse — when to consult me',
      'inj.mountPlaceholder': 'e.g. When wiring or asserting e2e check conventions…',
      'inj.mountSave': 'Mount',
      'inj.mountSkip': 'Skip',
      'inj.mountSaved': 'Mounted to index: {title}',
      'inj.mountFailed': 'Mount failed: {msg}',
      // 0.4.3 验收修复（notes-043-preview-when-edit）：LLM 草稿预填 + 预览目录行点击补充/编辑
      'inj.mountEdit': 'Edit mount',
      'inj.mountAdd': 'Add whenToUse & mount',
      'inj.mountGen': 'Generating whenToUse…',
      // 0.4.3 验收修复⑥（notes-043-metrics-present）：注入管理面板挂载区统计行（notes-recall-stats 账本快照，点开看全量）
      'inj.mntStats': 'Mounted {m}｜Week Top: {top}｜Zero-ref {z}',
      'inj.mntStatsTip': 'Recall value signal (source: notes-recall-stats · ledger snapshot) · click for full channel stats',
      'mem.disabledToast': 'Settling guide disabled (the convention note is kept; inject turned off)',
      'mem.notEnabled': 'The settling guide is not enabled',
      'mem.disableFailed': 'Failed to disable: {msg}',
      'mem.enableTitle': 'Enable settling guide',
      'mem.enableSub': 'Agent memory v0 · convention-note approach',
      'mem.enableHint': 'This creates a prefilled convention note "约定：工作日志沉淀（工作记忆 v0）" (inject=true, contractType: memory-guide), guiding the Agent to write session conclusions as work logs (kind=log) at task wrap-up or when you ask. Agent memory is a parallel lane independent of note conventions — conventions govern how you record (for humans), memory governs what the Agent settles itself (for its own recall); both may apply to the same event, and duplicate output is by design, not a conflict. Logs are first-class like any note: visible, searchable, editable; injection is hard-disabled (no inject switch offered) and the injected directory never includes them. This convention is visible/editable/disable-able/deletable; re-enabling after disabling reuses the same convention note (injection is turned back on; no second note is created).',
      'mem.scopeTitle': 'Injection scope',
      'mem.scopeGlobal': 'All sessions (default)',
      'mem.scopeWsPick': 'Specific workspaces (multi-select below)',
      'mem.scopeSessPick': 'Specific sessions (multi-select below)',
      'mem.scopeWsMulti': 'Specific workspaces (multi-select)',
      'mem.scopeSessMulti': 'Specific sessions (multi-select)',
      'mem.scopeGlobalTip': 'injectTo=[]: every session injects this convention into its system prompt',
      'mem.scopeWsTip': 'Expands to the short-id list of all sessions in the chosen workspaces (injectTo has no workspace dimension)',
      'mem.scopeSessTip': 'injectTo=[checked session short ids]: only these sessions inject this convention',
      'mem.confirmEnable': 'Confirm & enable',
      'mem.enabling': 'Enabling…',
      'mem.wsLabel': '{name} ({n} sessions)',
      'mem.noWorkspace': 'No workspaces available',
      'mem.noSessions': 'No sessions available',
      'mem.sessNameSeg': ' · {name}',
      'mem.sessWsSeg': ' ({ws})',
      'mem.sessLoadFailed': 'Failed to load the session list: {msg}',
      'mem.needWorkspace': '"Specific workspaces" needs at least 1 workspace checked (or switch to all sessions)',
      'mem.noSessInWs': 'The chosen workspaces have no injectable sessions yet (open a session in one first)',
      'mem.noSessInScope': 'The chosen scope has no injectable sessions yet (open one first)',
      'mem.needSession': '"Specific sessions" needs at least 1 session checked (or switch to all sessions)',
      'mem.alreadyToast': 'The settling guide is already enabled (the convention note exists)',
      'mem.revivedToast': 'Settling guide re-enabled: reused the existing convention note (no second note created)',
      'mem.enabledToast': 'Settling guide enabled: the convention note was created and injected',
      'mem.enableFailed': 'Failed to enable: {msg}',
      /* ===== Coverage card E (notes-042-i18n-cov-e): modal family bilingual (dispatch/archive/trash/suggest/newnote/cheatsheet/folder-input + client counterparts) =====
         Data-layer strings intentionally stay Chinese (cross-language matching / check-locked): the schedule-note title prefix "定时 "
         (schedPeerKey regex), the body "补充指令：" marker (check 50-schedule-ui anchors the literal), the fallback session name "新会话". */
      'disp.title': 'Dispatch todo',
      'disp.editTitle': 'Edit scheduled task',
      'disp.sub': 'Injects context and triggers the target session · to dispatch into a new session, use the DSH panel',
      'disp.editSub': 'The schedule declaration shares one source with front-matter · saving updates the schedule',
      'disp.subCounts': '{ws} workspaces / {n} sessions (active+dormant){pending}',
      'disp.draftNotSaved': 'Draft not saved yet: enter a title or body to autosave it before dispatching',
      'disp.noSchedule': 'This note has no schedule declaration',
      'disp.noBody': '(no body)',
      'disp.instrPlaceholder': 'Additional requirements / instructions (optional)…',
      'disp.now': 'Dispatch now',
      'disp.scheduled': 'Schedule',
      'disp.modeNDays': 'Every N days',
      'disp.modeOnce': 'Once (specific time)',
      'disp.ndaysUnit': 'days',
      'disp.dowOption': '{dow}',
      'disp.ok': 'Dispatch',
      'disp.saveSched': 'Save schedule',
      'disp.savingSched': 'Scheduling…',
      'disp.dispatching': 'Dispatching…',
      'disp.needSession': 'Select a target session',
      'disp.needWorkspace': 'Select a workspace',
      'disp.noWsService': 'The workspaces service is unavailable',
      'disp.sessSummary': '{n} dispatchable sessions (active+dormant){pending} · grouped by workspace',
      'disp.sessPending': ' (+{n} loading titles…)',
      'disp.noSessions': 'No sessions to dispatch to. Create a session in the DSH main window first, or use "New session" dispatch from the DSH floating panel; dormant sessions can be dispatched directly (delivered on their next activity).',
      'disp.notLive': 'dormant · delivered on next activity',
      'disp.notLiveSuffix': ' (dormant · delivered on next activity)',
      'disp.orphanSessName': 'Original target session (not in the active list now)',
      'disp.orphanSessWs': 'Original target',
      'disp.nextTrigger': 'Next run: {time}',
      'disp.schedNeedAt': 'Once mode needs a scheduled time',
      'disp.schedAtFuture': 'The scheduled time must be in the future (host red line: at must be future)',
      'disp.schedNeedAnchor': 'Recurring modes need a trigger time (HH:MM)',
      'disp.schedNInvalid': 'For every-N-days, N must be an integer ≥ 1',
      'disp.schedDone': 'Scheduled, next: {time}',
      'disp.schedUpdated': 'Schedule updated, next: {time}',
      'disp.schedFailed': 'Failed to schedule: {msg}',
      'disp.needOpenHint': '\n(This page cannot open sessions; go back to the DSH main window, open that session, and retry)',
      'disp.dispatched': 'Todo dispatched to "{name}" (processing started)',
      'disp.dispatchedQueued': 'Queued to "{name}" (dormant session · delivered on its next activity)',
      'disp.schedNew': 'Dedicated session (auto-created on first fire, then reused)',
      'disp.newSessDone': 'New session created; the todo was injected and processing started',
      'disp.failed': 'Dispatch failed: {msg}',
      'disp.markedDone': 'Marked as done',
      'disp.pickWs': 'Select a workspace…',
      'disp.pickSess': 'Select a session…',
      'disp.noSessInWs': 'No sessions in this workspace yet',
      'disp.pickWsFirst': 'Pick a workspace first',
      'disp.pickWsNew': 'Select a workspace (a session will be created under it)…',
      'disp.modeExisting': 'Existing session',
      'disp.modeNew': 'New session',
      'arch.title': 'Archive preview',
      'arch.sub': 'Runs only after you check groups · merge is undoable',
      'arch.hint': 'Quick notes are grouped by session; checked groups merge into one archived note (originals are backed up, then soft-deleted).',
      'arch.hintClient': 'Quick notes are grouped by session; checked groups merge into one archived note (originals are .bak-backed-up, then soft-deleted).',
      'arch.manualHint': 'Manual notes are unaffected; to merge manual notes, multi-select them in the list and right-click → Merge.',
      'arch.empty': 'No quick-note groups to archive (a session needs ≥2 quick notes to form a group).',
      'arch.ok': 'Archive selected',
      'arch.okCount': 'Archive selected ({n} groups)',
      'arch.archiving': 'Archiving…',
      'arch.groupMeta': '{span} · {n} notes · {size}',
      'arch.groupUseCount': ' · referenced {n} times',
      'arch.merged': 'Merged {n} groups',
      'arch.failed': 'Archive failed: {msg}',
      'arch.previewFailed': 'Failed to load the preview: {msg}',
      'arch.undone': 'Archive undone',
      'arch.noUndo': 'No archive to undo',
      'arch.undoFailed': 'Undo failed: {msg}',
      'arch.needTwo': 'Select at least 2 notes',
      'arch.mergeTitle': 'Merge selected notes',
      'arch.mergeHint': 'Merges the selected {n} notes into one (bodies are stitched in sections by update time; originals are soft-deleted; undoable).',
      'arch.mergeDefault': 'Merged note',
      'arch.mergePlaceholder': 'Title after merge…',
      'arch.merging': 'Merging…',
      'arch.mergeFailed': 'Merge failed: {msg}',
      'arch.mergedSel': 'Merged the selected {n} notes',
      'arch.deletedBatch': 'Deleted {ok} notes (restorable from Trash)',
      'common.restoredBatch': 'Restored {ok} notes',
      'trash.sub': 'Soft-deleted notes · restoring brings them back · purging is irreversible',
      'trash.empty': 'Trash is empty (deleted notes appear here).',
      'trash.restoreSel': 'Restore selected',
      'trash.purgeSel': 'Purge selected',
      'trash.titleTip': '{title} (click to preview the body, read-only)',
      'trash.deletedAt': 'Deleted {time}',
      'trash.preview': 'Preview',
      'trash.collapse': 'Collapse',
      'trash.restore': 'Restore',
      'trash.purge': 'Purge',
      'trash.previewLoading': 'Loading preview…',
      'trash.previewFailed': 'Preview failed: {msg}',
      'trash.noBody': 'No body',
      'trash.purged': 'Purged',
      'trash.purgeConfirm': 'Purging is irreversible: "{title}"\nThe body and archive backups will be removed together. Purge for good?',
      'trash.restoreBatchConfirm': 'Batch restore: the selected {n} notes will leave Trash (back to the normal list).\nConfirm restore?',
      'trash.purgeBatchConfirm': 'Batch purge: the selected {n} notes will be permanently deleted, irreversibly (history versions included).\nBodies, history snapshots and archive backups will be removed together. Purge for good?',
      'trash.purgedBatch': 'Purged {ok} notes',
      /* 0.4.3⑥（notes-043-sys-kind）：kind=sys 系统根笔记豁免面——多选批量删除红字警示 + confirm 门槛（双端 selbar/archive 共用） */
      'sys.selWarn': '{n} system note(s) selected',
      'sys.batchDelWarn': 'The selection includes {n} system-hosted note(s) (kind=sys: run logs / injection index / memory archives — machine-produced).\nDeleting them may break dispatch receipts, reference recall and the usage ledger. Delete anyway?',
      'sugg.sub': 'Nominations only, never auto-executed · soft-deletes are restorable',
      'sugg.analyzing': 'Analyzing…',
      'sugg.failed': 'Analysis failed: {msg}',
      'sugg.clean': 'The library is clean; nothing to organize.',
      'sugg.secArch': 'Archivable quick-note groups',
      'sugg.countGroups': '{n} groups',
      'sugg.goArch': 'Go archive',
      'sugg.secStale': 'Stale and unreferenced',
      'sugg.countItems': '{n} notes',
      'sugg.deleting': 'Deleting…',
      'sugg.batchDel': 'Batch soft-delete',
      'sugg.staleDays': 'no update for {n} days',
      'sugg.staleEmpty': 'No notes that are both stale and never referenced.',
      'sugg.secOrphan': 'Possibly useless',
      'sugg.view': 'View',
      'sugg.orphanEmpty': 'No orphan notes (no wiki-link relations and never referenced).',
      'sugg.secLogHg': 'Log hygiene',
      'sugg.tierWeekly': 'Weekly rollup',
      'sugg.tierMonthly': 'Monthly rollup',
      'sugg.logHgMeta': '{tier} · {n} notes',
      'sugg.detail': 'Details',
      'sugg.sessSeg': ' · session {id}',
      'sugg.logHgEmpty': 'No work logs pending rollup (over-window logs group by workspace×week/month; only groups of ≥2 are nominated).',
      'sugg.criteria': 'Criteria: stale = past the freshness threshold (adjustable in the Settings card) and never referenced; possibly useless = active plain notes with no [[wiki-link]] relations, never injected and never referenced (heuristic — review one by one). Log hygiene = weekly rollup beyond 7 days / monthly rollup beyond 90 days (windows adjustable in the Settings "Agent memory" section); v0 shows details only, one-click merge lands in a later version.',
      'sugg.criteriaClient': 'Criteria: stale = past the freshness threshold (adjustable in the Settings card) and never referenced; possibly useless = active plain notes with no [[wiki-link]] relations, never injected and never referenced (heuristic — review one by one). Log hygiene = weekly rollup beyond 7 days / monthly rollup beyond 90 days (windows adjustable in the Settings "Agent memory" section); logs are only rolled up, never eliminated, and never enter stale/orphan candidates; v0 shows details only, one-click merge lands in a later version.',
      'sugg.softDeleted': 'Soft-deleted {ok} notes (restorable from Trash)',
      'newnote.draftToast': 'Draft opened: entering a title or body auto-saves it; clicking another note discards the draft (zero empty notes)',
      'newnote.createdToast': 'Note created (the first edit auto-saved it)',
      'newnote.flushedToast': 'Draft auto-saved: "{title}"',
      'newnote.failed': 'Create failed: {msg}',
      'newnote.title': 'New note',
      'newnote.titlePlaceholder': 'Note title…',
      'newnote.kindLabel': 'Kind',
      'newnote.templateHint': 'A template skeleton will be prefilled',
      'newnote.freeHint': 'Free form (empty body)',
      'newnote.create': 'Create',
      'newnote.creating': 'Creating…',
      'newnote.created': 'Created',
      'cheat.closeTip': 'Close (Esc / ?)',
      'cheat.hint': 'Effective when not typing; inputs / rich text do not respond to j/k, Enter, ?. The Settings "Keyboard shortcuts" row also opens this sheet.',
      'cheat.kSearch': 'Focus the search box',
      'cheat.kNew': 'New note (Ctrl+N is the browser-reserved "new window" key, unavailable to pages, hence Alt+N)',
      'cheat.kMode': 'Editor: source ⇄ rich text toggle (effective while editing; not while a modal is open)',
      'cheat.kDown': 'Move list focus one row down',
      'cheat.kUp': 'Move list focus one row up',
      'cheat.kOpen': 'Open the focused note',
      'cheat.kSearchDown': 'In the search box: jump to the first list row (keeps the filter context; search → ↓ → j/k → Enter pure-keyboard path)',
      'cheat.kSelf': 'Open / close this cheat sheet',
      'cheat.kEsc': 'Layered close: popovers → sort/filter/scope layers → selection card/context menu → exit multi-select → clear search and refocus the list',
      'cheat.kEscClient': 'Layered close: popovers/menus → exit multi-select → clear search and refocus the list → close the panel',
      'fld.where': 'Location: {path}',
      'fld.root': 'Root folder',
      'fld.namePlaceholder': 'Folder name',
      'fld.okDefault': 'OK',
      'fld.errEmpty': 'Folder name cannot be empty',
      'fld.errDup': 'A folder named "{name}" already exists at this level',
      /* ===== Coverage card F (notes-042-i18n-cov-f): remaining panels (folders/wiki/selection/search/query/filterbar/organize)
         + popovers on both ends + shared constant-table conditional mapping (client kernel/constants.js FILTER_STATUS/KIND_LABELS/
         FILTER_SORTS, app kernel/state.js KIND/STATUS_LABEL, client injectScopeLabel — card B/E handovers) + host toast surface
         (server.js has no user-visible strings: the only literal is an RPC error — stays Chinese per red line, asserted in §67) =====
         Reuses existing keys (no aliases): tree.pinned/untitled/movedTo/movedOut, meta.sens/injectEver/kindNote~kindLog/scopeAll/
           scopeSession/scopeHint/scopePending/wsOther/undo/pin/unpin, editor.backlinks/backlinksCount/backlinksWarming/backlinkJumpTip/
           backlinksEmpty/bodyLoading/bodyEmpty/organizeFailed/organizeEmpty/organized/noOrganizeUndo/organizeUndone, mem.sessLoadFailed,
           side.fchipStatusTip/fchipKindTip, sel.selCount/merge, common.delete/cancel/listSep/restoredBatch, arch.deletedBatch,
           inj.batchDoneFail, chrome.help (help bubble title);
         Chinese literals of the shared constant tables stay (four-end parity anchors: checks 30/34/39 lock FILTER_STATUS/FILTER_SORTS/
           KIND_LABELS verbatim); rendering goes through kindLabel/filterStatusLabel/statusLabel/sortLabelOf/sortDescOf conditional
           mapping into t() (language switches take effect at runtime) */
      'filter.statusGroup': 'Status',
      'filter.displayGroup': 'Display',
      'filter.showHidden': 'Show hidden items',
      'filter.showHiddenTip': 'Show/hide notes and folders marked with the hidden attribute (OS file-manager semantics; read/write and jump-to-open of hidden items are unaffected)',
      'filter.ruleOr': 'Multi-select within a group = OR',
      'filter.kindGroup': 'Type',
      'filter.ruleOrAnd': 'OR within the group · AND with the status group',
      'filter.hitCount': '{n} matches',
      'filter.clear': 'Clear',
      'filter.done': 'Done',
      'filter.removeAria': 'Remove filter {label}',
      'filter.clearedToast': 'All filter conditions cleared',
      'filter.stInjected': 'Injected',
      'sort.time': 'Time',
      'sort.use': 'References',
      'sort.rel': 'Relevance',
      'sort.timeDesc': 'Pinned first · recently updated (default)',
      'sort.useDesc': 'Most referenced first',
      'sort.relDesc': 'Search score (active while searching)',
      'meta.statusActive': 'Active',
      'meta.statusResolved': 'Resolved',
      'meta.statusSuperseded': 'Superseded',
      'fld.titleNew': 'New folder',
      'fld.titleNewSub': 'New subfolder',
      'fld.okNew': 'Create',
      'fld.titleRename': 'Rename folder',
      'fld.okRename': 'Rename',
      'fld.created': 'Folder "{name}" created',
      'fld.createFailed': 'Failed to create the folder: {msg}',
      'fld.renamed': 'Renamed to "{name}"',
      'fld.renameFailed': 'Failed to rename: {msg}',
      'fld.delConfirmCascade': 'Delete the folder "{name}"? Cascade: {childN} subfolders + {noteN} notes move to Trash (restorable); the folder structure is not recoverable.',
      'fld.delConfirmEmpty': 'Delete the empty folder "{name}"?',
      'fld.deleted': 'Folder "{name}" deleted',
      'fld.deletedDetail': ' ({childN} subfolders and {noteN} notes moved to Trash)',
      'fld.deleteFailed': 'Delete failed: {msg}',
      'fld.sortFailed': 'Reorder failed: {msg}',
      'fld.errSelf': 'A folder cannot be nested under itself',
      'fld.errCycle': 'A folder cannot be nested under its own descendant (cycle)',
      'fld.movedInto': 'Moved into "{name}"',
      'fld.movedRoot': 'Moved back to the root level',
      'fld.moveFailed': 'Move failed: {msg}',
      'fld.menuUp': 'Move up',
      'fld.menuDown': 'Move down',
      'fld.menuRoot': 'Move to root',
      'fld.menuHide': 'Hide this folder',
      'fld.menuUnhide': 'Unhide',
      'fld.hiddenToast': 'Folder "{name}" hidden (masked from lists; re-show via the filter-center "Show hidden items" toggle)',
      'fld.unhiddenToast': '"{name}" unhidden',
      'fld.hideFailed': 'Failed to set hidden flag: {msg}',
      'fld.menuDeleteFolder': 'Delete folder',
      'fld.loadFailed': 'Failed to load folders; showing the local cache: {msg}',
      'wiki.idxFailedPartial': 'Wiki index failed for {n} notes: backlinks/trailing marks incomplete (auto-retry on next refresh)',
      'wiki.idxFailed': 'Wiki index failed for {n} notes: {msg} (auto-retry on next refresh)',
      'wiki.idxFailedClient': 'Wiki index failed for {n} notes (auto-retry on next refresh)',
      'wiki.targetNotFound': 'Link target not found: {target}',
      'cap.title': 'Selection quick note',
      'cap.autoQuote': 'Save as Quote',
      'cap.autoQuoteClient': 'Recognized as Quote',
      'cap.placeholder': 'Optional: tags / title hint / kind…',
      'cap.placeholderClient': 'Optional: tags/title hint/kind/inject as context… plain Enter only records',
      'cap.enterHint': 'Enter to save',
      'cap.copy': 'Copy',
      'cap.save': 'Save',
      'cap.copied': 'Selection copied',
      'cap.copyFailed': 'Copy failed',
      'cap.noSelection': 'No selection to copy',
      'cap.merged': 'Merged into the quick note of the day',
      'cap.mergedClient': 'Merged into this quick note',
      'cap.savedQuote': 'Saved as a quote (the host LLM backfills the topic asynchronously)',
      'cap.savedClient': 'Saved, recognizing the topic…',
      'cap.savedPlain': 'Saved',
      'cap.savedCtx': 'Saved and injected as context ({role})',
      'cap.savedTags': 'Saved and tagged {tags}',
      'cap.savedKind': 'Saved as {kind}',
      'cap.sensSuffix': '; marked sensitive (auto-masked on injection)',
      'cap.failed': 'Save failed: {msg}',
      'search.offline': 'Online search unavailable; showing local filter results only: {msg}',
      'sel.deleting': 'Deleting…',
      'ctx.reopen': 'Reopen',
      'ctx.markResolved': 'Mark resolved',
      'ctx.moveTo': 'Move to folder',
      'ctx.moveOut': 'Move out of the folder (unfiled)',
      'ctx.newFolderPlaceholder': 'New folder name…',
      'ctx.newFolder': 'New folder…',
      'ctx.merge': 'Merge into one',
      'help.newPre': 'Click "New" in the sidebar or press ',
      'help.newPost': ' to create a note by title, then edit the body right away',
      'help.capture': 'Select text on the page and release to pop up the quick-capture card (auto-recognized as a quote)',
      'help.mergeWin': 'Quick notes within 10 minutes in the same session merge automatically',
      'help.topic': 'Click a topic in the breadcrumb/editor to filter globally by topic (cross-folder)',
      'help.drag': 'Drag a note onto a folder row to move it in, or onto the unfiled area at the tree root to move it out (drop hints shown while dragging)',
      'help.keysLead': 'Shortcuts: ',
      'help.keysSearch': ' search (inside the box, ',
      'help.keysSearchEnd': ' jumps straight to the list), ',
      'help.keysNew': ' new note, ',
      'help.keysMoveOr': ' or ',
      'help.keysMoveEnd': ' move, ',
      'help.keysOpen': ' open, ',
      'help.keysEsc': ' layered close (close overlays → clear search and refocus the list → close the panel)',
      'help.cheatPre': 'When not typing, press ',
      'help.cheatPost': ' to open the shortcut cheat sheet (Esc closes; also on the Settings "Keyboard shortcuts" row)',
      'help.archive': '"Quick notes": opens a preview; only checked groups merge (undoable); manual notes merge via multi-select under "Select"',
      'help.organize': 'Editor "Organize": AI rewrites the body per the kind template (undoable once); new notes prefill the template skeleton by kind',
      'help.image': 'Images over 1MB are auto-compressed to JPEG; the Settings "Asset cleanup" row removes unreferenced orphan files',
      'help.delete': 'Deletion is soft: "Trash" at the sidebar bottom restores or purges (purging is irreversible)',
      'side.loadFailed': 'Failed to load the list: {msg}',
    }
    // ===== i18n 语言机制（notes-042-i18n-mech；与 app kernel/helpers.js 同口径——机制卡，纯机制不改现有文案）=====
    // 字典 @i18n/zh.js+en.js（列 0 维护，client 态逐非空行加 4 空格基座缩进纳入，序位在本文件之前）；
    // 语言态 localStorage 'dsh-notes-lang'（'zh' 缺省），langStore 订阅驱动全量重渲染（§4.4 store 纪律）。
    const I18N_LANG_KEY = 'dsh-notes-lang'
    function loadLang() { try { const v = localStorage.getItem(I18N_LANG_KEY); return v === 'en' ? 'en' : 'zh' } catch (err) { return 'zh' } }
    const langStore = createStore({ lang: loadLang() })
    // tLookup(lang, key, vars)：当前语言字典 → zh 全量基准字典 → key 本身（红线：永不裸 key，仅 zh 也缺才兜底露 key）；{name} 插值（禁拼接）
    function tLookup(lang, key, vars) {
      const dict = lang === 'en' ? I18N_EN : I18N_ZH
      let s = dict[key]
      if (s == null) s = I18N_ZH[key]
      if (s == null) return key
      if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m))
      return s
    }
    // 非组件语境直取（toast/confirm 等命令式调用点，读当下语言态）
    function t(key, vars) { return tLookup(langStore.get().lang, key, vars) }
    // I18nContext：子树级覆盖通道（缺省 null → 走全局语言态；覆盖卡/预览类场景可挂 Provider 局部换语言）
    const I18nContext = React.createContext(null)
    // useT()：组件内取 t——订阅 langStore，切换语言全部消费组件自更新（无需手动重渲染）
    function useT() {
      const override = React.useContext(I18nContext)
      const lang = langStore.useSel(s => s.lang)
      if (typeof override === 'function') return override
      return (key, vars) => tLookup(lang, key, vars)
    }
    // setLang(l)：校验 + 持久化 + store 广播（订阅者自渲染，等价全量 render）
    function setLang(l) {
      if (l !== 'zh' && l !== 'en') return
      try { localStorage.setItem(I18N_LANG_KEY, l) } catch (err) {}
      langStore.set({ lang: l })
    }
    // 文件夹折叠态持久化：JSON 数组记录「展开中」的文件夹 id（'__pinned__' 是置顶折叠组固定 key）；null/缺省 = 全部展开
    const PINNED_KEY = '__pinned__'
    function loadFoldersExpanded() { try { const v = localStorage.getItem('dsh-notes-folders-expanded'); if (!v) return null; const arr = JSON.parse(v); return Array.isArray(arr) ? arr : null } catch (err) { return null } }
    function saveFoldersExpanded(arr) { try { localStorage.setItem('dsh-notes-folders-expanded', JSON.stringify(arr)) } catch (err) {} }
    // 陈旧 id 清洗：按当前文件夹清单过滤失效 id（PINNED_KEY 保留）；过滤后为空 → null（回缺省全展开），并回写持久化
    // （文件夹删除重建后旧 id 残留会让「非 null 数组 = 只展开集合内 id」语义错乱：老 id 占位、新文件夹默认折叠——观感即点哪个都不展开）
    function pruneFoldersExpanded(prev, folderList) {
      if (!prev) return prev
      const next = prev.filter(id => id === PINNED_KEY || folderList.some(f => f.id === id))
      if (next.length === prev.length) return prev
      const fixed = next.length ? next : null
      saveFoldersExpanded(fixed)
      return fixed
    }
    // ===== 侧栏宽度（两栏分隔条拖拽调整；localStorage 记忆；双击分隔条重置缺省）=====
    // clamp：200px ≤ w ≤ 60% 面板宽；key 与 app.html 独立（app.html 侧为 dsh-notes-app-sidebar-w）
    const SIDE_W_KEY = 'dsh-notes-sidebar-w'
    const SIDE_W_DEFAULT = 300   // 与 styles.css .dsh-notes-side 缺省宽一致
    function clampSideW(w, panelW) { return Math.max(200, Math.min(Math.round(panelW * 0.6), Math.round(w))) }
    function loadSideW() { try { const v = parseInt(localStorage.getItem(SIDE_W_KEY), 10); return v >= 200 ? v : null } catch (err) { return null } }
    function saveSideW(w) { try { if (w == null) localStorage.removeItem(SIDE_W_KEY); else localStorage.setItem(SIDE_W_KEY, String(w)) } catch (err) {} }
    // ===== 0.4.4-D hidden 隐藏属性：显隐开关持久化（dsh-notes-show-hidden；缺省关=隐藏项滤除，开=半透明渲染）=====
    // 与筛选条件（dsh-notes-filters）正交独立键——清空筛选/重置条件不动本开关；app 侧独立键 dsh-notes-app-show-hidden
    function loadShowHidden() { try { return localStorage.getItem('dsh-notes-show-hidden') === '1' } catch (err) { return false } }
    function saveShowHidden(v) { try { localStorage.setItem('dsh-notes-show-hidden', v ? '1' : '0') } catch (err) {} }
    loadEntryState()
    const PAGE_SIZE = 50
    const KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志', sys: '机器' }   /* 0.4.3⑩ +sys「机器」（筛选中心「机器」档标签/持久化校验用；编辑器/新建 kind 选项不收 sys——机器托管 kind 人工不转） */
    // ---- 二期：kind 模板骨架（新建笔记预填）——与 host-impl.js / index.mjs / app.html / 原型同一份（check.js 断言一致）----
    // note 为自由格式（空骨架）；机器/运维信息类由 ✨整理按内容套用机器模板（建时无法预判内容，不进 KIND_TEMPLATES）
    const KIND_TEMPLATES = {
      note: '',
      decision: '## 背景\n\n（问题与上下文）\n\n## 结论\n\n（最终选择）\n\n## 理由\n\n（权衡与依据）\n',
      todo: '- [ ] （待办事项）\n',
      link: '## 链接\n\n（URL）\n\n## 说明\n\n（用途与要点）\n',
      quote: '> （引用原文）\n\n—— （出处）\n',
      // 工作记忆 v0 工作日志模板（design/agent-memory-v0.md §4.2 四节结构；同日追加尾部加「## HH:mm 续」小节）
      log: '## 做了什么\n\n（本会话完成的任务/阶段，一句话一条）\n\n## 改动\n\n（改动的文件/配置/数据，路径 + 一句话）\n\n## 遗留与后续\n\n（未完成事项、已知风险、下次接续的入口）\n\n## 相关笔记\n\n（[[n-xxxxxxxx]] 双链引用本库相关笔记；无则空）\n'
    }
    // ===== 筛选中心（design/notes-filter-center.html 落地）：状态组/类型组多选，组内 OR / 跨组 AND =====
    // 与 app.html / 原型 notes-ui-v2.html 同一份条件模型（check.js 断言一致）；injectEver 字段由 notes-inject-filter 任务提供，feature-detect（slim 有该字段才显示选项）
    const FILTER_STATUS = [
      { id: 'pinned', label: '置顶', icon: 'pin', pred: n => n.status === 'pinned' },
      { id: 'injected', label: '已注入', icon: 'bolt', pred: n => n.inject === true },
      { id: 'injectEver', label: '曾注入', icon: 'clock', pred: n => n.injectEver === true },
      { id: 'sensitive', label: '敏感', icon: 'lock', pred: n => n.sensitive === true },
    ]
    const FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log', 'sys']   // 类型组含 log（0.4.3⑦ 日志同权：勾选「日志」= 只看日志，与普通 kind 过滤同语义，不再是隐身专入口）+ sys（0.4.3⑩「机器」档：勾选=全库 sys 机器笔记（含「记忆档案」夹内档案）经 host kind 通道直达，面板翻账本入口）
    const FILTER_SORTS = [
      { id: 'time', label: '时间', desc: '置顶优先 · 更新降序（默认）' },
      { id: 'use', label: '引用', desc: '被引用次数降序' },
      { id: 'rel', label: '相关度', desc: '搜索打分（搜索时生效）' },
    ]
    const FILTERS0 = () => ({ pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] })
    // 筛选条件 + 排序档位持久化（dsh-notes-filters；kinds 按已知 kind 校验，sortBy 非法值回退 time）
    function loadFiltersState() {
      const F = FILTERS0()
      try {
        const v = localStorage.getItem('dsh-notes-filters')
        if (!v) return { filters: F, sortBy: 'time' }
        const s = JSON.parse(v) || {}
        if (s.filters) {
          ['pinned', 'injected', 'injectEver', 'sensitive'].forEach(k => { F[k] = s.filters[k] === true })
          if (Array.isArray(s.filters.kinds)) F.kinds = s.filters.kinds.filter(k => !!KIND_LABELS[k])
        }
        return { filters: F, sortBy: (s.sortBy === 'use' || s.sortBy === 'rel') ? s.sortBy : 'time' }
      } catch (err) { return { filters: F, sortBy: 'time' } }
    }
    // 筛选谓词（纯函数，check.js 提取做语义回归）：状态组组内 OR、类型组组内 OR、跨组 AND
    function matchFilters(n, F) {
      const st = []
      if (F.pinned) st.push(n.status === 'pinned')
      if (F.injected) st.push(n.inject === true)
      if (F.injectEver) st.push(n.injectEver === true)
      if (F.sensitive) st.push(n.sensitive === true)
      if (st.length && st.indexOf(true) < 0) return false
      if (F.kinds.length && F.kinds.indexOf(n.kind || 'note') < 0) return false
      return true
    }
    // ===== i18n 覆盖卡F（notes-042-i18n-cov-f，B 卡交接①）：共享常量表条件映射——KIND_LABELS/FILTER_STATUS/FILTER_SORTS 的
    //    label 中文字面量保留作四端同构锚（check 30/34/39 锁定原文 + 原型不双语红线），渲染一律经下列 helper 走 t() 字典
    //    （kernel/i18n.js 序位在前，langStore 订阅者自渲染即换语言）；未知值回退 ''（调用方 || 兜底），永不裸 key =====
    function kindLabel(k) { return KIND_LABELS[k] ? t('meta.kind' + k.charAt(0).toUpperCase() + k.slice(1)) : '' }
    function filterStatusLabel(id) { return id === 'pinned' ? t('tree.pinned') : id === 'injected' ? t('filter.stInjected') : id === 'injectEver' ? t('meta.injectEver') : id === 'sensitive' ? t('meta.sens') : id }
    function sortLabelOf(id) { return t('sort.' + (id === 'use' || id === 'rel' ? id : 'time')) }
    function sortDescOf(id) { return t('sort.' + (id === 'use' || id === 'rel' ? id : 'time') + 'Desc') }
    const shortSid = (sid) => sid ? String(sid).replace(/^session-/, '').slice(0, 8) : ''
    // injectTo 勾选态归一比对（notes-034-injectto-norm）：存量长 id 经 shortSid 约到短 id 再比——勾选渲染/范围文字/取消勾选三处同口径
    // （host 写入路径已归一兜底，本函数兜住存量长 id 数据在浮层打开时显示为已勾选；app kernel/helpers.js 与原型 notes-ui-v2.html 同口径）
    const scopeHas = (arr, short) => (arr || []).some(t => shortSid(t) === short)
    // P3 派发闭环：单条派发完成判定（dispatchStatus==='done' 或存量 done===true 向后兼容）——host 三通道回执：idle 事件 / resolved 联动 / 手动标记
    const isDispatchDone = (d) => !!(d && (d.dispatchStatus === 'done' || d.done === true))
    // 字节数人性化（归档预览组的 totalBytes 展示用）
    const fmtBytes = (n) => { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB' }
    // 历史版本时间戳（UTC ms）→ 本地可读串（历史面板版本列表/预览/confirm 共用）
    const fmtHistTs = (ts) => { const d = new Date(+ts || 0); if (isNaN(d.getTime())) return String(ts); const p = (x) => ('0' + x).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) }
    // 时间戳渲染统一本地时区（R-5，n-mut3u5xghl1u；与 app 侧 helpers.js fmtDT 同口径）：host 落盘 UTC ISO → 本地 YYYY-MM-DD HH:mm，
    // 与自动保存指示（本地 HH:mm）同区——编辑器底栏/树列表/派发记录/归档/回收站/整理建议的日期段全走本函数切片
    // （YYYY-MM-DD 取 slice(0,10)，MM-DD 取 slice(5,10)，MM-DD HH:mm 取 slice(5)）；无效/非 ISO 值回退旧切片（防御，不抛错）
    const fmtDT = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' '); const p = (x) => ('0' + x).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) }
    // ===== 定时派发·调度 helper（notes-034-sched-ui；与 host schedule.js 同口径的纯函数前端镜像——表单与 front-matter 同一数据源两个视图，无第二份存储） =====
    // every 声明 → 毫秒：number 直给（毫秒）；字符串 '<n>m|<n>h|<n>d|<n>w'（分钟/小时/天/周）。非法 → null（同 host schedEveryMs）
    const schedEveryMs = (every) => {
      if (typeof every === 'number' && isFinite(every) && every > 0) return Math.floor(every)
      if (typeof every === 'string') {
        const m = every.trim().match(/^(\d+)([mhdw])$/)
        if (m) { const n = parseInt(m[1], 10); const unit = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]]; return n * unit }
      }
      return null
    }
    // 锚定时刻（notes-034-sched-time）：'HH:MM' → 当日分钟偏移 ms（本地墙钟）；非法 → null（同 host 闸门 ^([01]\d|2[0-3]):[0-5]\d$）
    const schedAnchorMs = (anchor) => {
      const m = typeof anchor === 'string' ? anchor.match(/^([01]\d|2[0-3]):([0-5]\d)$/) : null
      return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60000 : null
    }
    // 锚定时刻序列（同 host schedDueAt 锚定分支口径）：触发时刻钉死本地 HH:MM，不随创建/触发时刻漂移——
    // 首触（fired=false，base=createdAt）= base 之后第一个锚定时刻（weekly 限定 dow 星期几）；
    // 后续（fired=true，base=lastFiredAt）= base + 间隔 所在本地日的锚定时刻（weekly = 下一个 dow 锚定时刻）。
    // dow=0-6（0=周日，Date.getDay 口径）；ivMs 需整天倍数。非法 → null
    const schedAnchorNextMs = (anchor, dow, ivMs, baseMs, fired) => {
      const off = schedAnchorMs(anchor)
      if (off === null || !isFinite(baseMs) || !baseMs) return null
      const b = new Date(baseMs), day0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
      if (typeof dow === 'number') {
        // weekly：自 base 当日起逐日找首个 getDay()===dow 且锚定时刻 > base 的候选（已触发 → 下周同 dow；首触 → 下一个 dow）
        for (let i = 0; i < 14; i++) { const dm = day0 + i * 86400000; if (new Date(dm).getDay() === dow && dm + off > baseMs) return dm + off }
        return null
      }
      if (typeof ivMs !== 'number' || !isFinite(ivMs) || ivMs % 86400000 !== 0) return null
      if (fired) { const f = new Date(baseMs + ivMs); return new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime() + off }
      return (day0 + off > baseMs ? day0 : day0 + 86400000) + off
    }
    // 频率人话：仅一次 <时间> / 每天 / 每周 / 每 N 天（锚定时刻声明带时刻后缀：每天 09:00 / 每周一 09:00 / 每 3 天 09:00）；非整天间隔（front-matter 裸编辑旁路值）兜底 每 N 小时/分钟/ms
    // i18n 覆盖卡D：文案走 t() 字典 common.sched*（跨表面复用——注入管理 + 详情计划块；app kernel/helpers.js 同口径镜像）；
    // 模块级 t() 直读 langStore 当下语言态——本函数只在渲染期被调（调用方组件已挂 useT 订阅，切语言重渲即换文案）；星期名经 common.dowNames 管道分隔取值（en 多字符名 charAt 不可取）
    const schedFreqLabel = (s) => {
      if (!s) return ''
      if (s.at) return t('common.schedOnce', { time: fmtDT(s.at) })
      const ms = schedEveryMs(s.every)
      if (ms === null) return t('common.schedInvalid')
      const tail = s.anchor ? ' ' + s.anchor : ''   // 锚定时刻（notes-034-sched-time）：周期 + 本地时刻
      if (ms === 86400000) return t('common.schedDaily') + tail
      if (ms === 604800000) return (typeof s.dow === 'number' ? t('common.schedWeeklyDow', { dow: t('common.dowNames').split('|')[s.dow] || '' }) : t('common.schedWeekly')) + tail
      if (ms % 86400000 === 0) return t('common.schedNDays', { n: ms / 86400000 }) + tail
      if (ms % 3600000 === 0) return t('common.schedNHours', { n: ms / 3600000 })
      if (ms % 60000 === 0) return t('common.schedNMinutes', { n: ms / 60000 })
      return t('common.schedNMs', { n: ms })
    }
    // 下次触发毫秒（与 host schedDueAt 锚点同口径：轮询 = lastFiredAt || createdAt + 间隔；单次 = at 本身；
    // 锚定时刻声明（notes-034-sched-time）= 锚定序列下一时刻）；非法 → null
    const schedNextMs = (n) => {
      const s = n && n.schedule; if (!s) return null
      if (s.at) { const t = Date.parse(s.at); return isFinite(t) ? t : null }
      const iv = schedEveryMs(s.every); if (iv === null) return null
      const firedMs = (s.lastFiredAt && Date.parse(s.lastFiredAt)) || 0
      let base = firedMs || Date.parse(n.createdAt || '') || 0
      if (!isFinite(base) || !base) base = Date.now()
      if (s.anchor) return schedAnchorNextMs(s.anchor, typeof s.dow === 'number' ? s.dow : undefined, iv, base, !!firedMs)
      return base + iv
    }
    // ISO → datetime-local 输入值（本地时区 YYYY-MM-DDTHH:mm；非法/空 → ''）
    const isoToLocalInput = (iso) => {
      const d = new Date(iso || ''); if (isNaN(d.getTime())) return ''
      const p = (x) => ('0' + x).slice(-2)
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes())
    }
    // 表单 → schedule 声明片段（{at|every} + 周期模式锚定 anchor:'HH:MM'（weekly 另带 dow），notes-034-sched-time；target/enabled 由确认路径补）：返回 { decl } | { err }（内联报错文案与 host 红线同口径）
    // i18n 覆盖卡E：校验文案走 t() 字典 disp.sched*（app modals/dispatch.js schedFormDecl 同口径镜像）——模块级 t() 直读 langStore 当下语言态（渲染期调用，组件已挂 useT 订阅）
    const schedFormDecl = (mode, n, at, anchor, dow) => {
      if (mode === 'once') {
        const ms = new Date(at || '').getTime()
        if (!at || !isFinite(ms)) return { err: t('disp.schedNeedAt') }
        if (ms <= Date.now()) return { err: t('disp.schedAtFuture') }
        // 本地时区语义（notes-034-at-local-tz）：datetime-local 值本身是本地无后缀串，经 isoToLocalInput 归一提交——禁 toISOString（Z 后缀会被 host 闸门拒绝）
        return { decl: { at: isoToLocalInput(at) } }
      }
      // 锚定时刻（notes-034-sched-time）：周期三模式必携 anchor:'HH:MM'（触发序列钉死本地时刻不漂移）
      if (schedAnchorMs(anchor) === null) return { err: t('disp.schedNeedAnchor') }
      if (mode === 'ndays') {
        const nn = parseInt(n, 10)
        if (!isFinite(nn) || nn < 1) return { err: t('disp.schedNInvalid') }
        return { decl: { every: nn + 'd', anchor: anchor } }
      }
      if (mode === 'weekly') return { decl: { every: '1w', anchor: anchor, dow: typeof dow === 'number' ? dow : 1 } }
      return { decl: { every: '1d', anchor: anchor } }
    }
    // 声明 → 下次触发毫秒（轮询锚点 = lastFiredAt || createdAt || now；锚定时刻声明 = 锚定序列下一时刻，与 host schedDueAt 同口径；编辑模式传入 editNote 取存量锚点）
    const schedDeclNextMs = (decl, note) => {
      if (decl.at) return Date.parse(decl.at)
      let firedMs = 0
      if (note && note.schedule && note.schedule.lastFiredAt) { const f = Date.parse(note.schedule.lastFiredAt); if (isFinite(f)) firedMs = f }
      let base = firedMs
      if (!base && note && note.createdAt) { const c = Date.parse(note.createdAt); if (isFinite(c)) base = c }
      if (!base) base = Date.now()
      const iv = schedEveryMs(decl.every)
      if (decl.anchor) { const nx = schedAnchorNextMs(decl.anchor, typeof decl.dow === 'number' ? decl.dow : undefined, iv, base, !!firedMs); if (nx !== null) return nx }
      return base + iv
    }
    // 关联调度匹配键（notes-034-sched-detail）：标题去「定时」前缀（排定创建时自动加，见 dispatch modal）+ trim；与 app editor-meta.js 同口径
    const schedPeerKey = (title) => String(title || '').replace(/^定时\s*/, '').trim()
    // 关联调度清单：库内其他 dispatch-schedule 约定中匹配键相等者（双向视角：调度约定互见 sibling / 待办笔记见其全部调度）
    const relatedScheds = (cur, list) => {
      if (!cur) return []
      const key = schedPeerKey(cur.title)
      if (!key) return []
      return (list || []).filter(n => n.id !== cur.id && (n.contractType || '') === 'dispatch-schedule' && n.schedule && !n.deleted && schedPeerKey(n.title) === key)
    }
    // token 数人性化（设置卡片「LLM 用量」区）：≥1M → 1.23M，≥10k → 12.3k，其余原样
    const fmtTok = (n) => { n = Math.round(+n || 0); return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n) }
    const notify = () => listeners.forEach(fn => fn({ panelOpen }))
    const notifyNotesChanged = () => noteRefreshListeners.forEach(fn => fn())
    const e = React.createElement
    // ===== SVG 图标集（UI v2：全部图标走 SVG，零 emoji）=====
    // 原型 design/notes-ui-v2.html 的 15 个 symbol 内联化为 e() createElement 结构
    // （check.js 断言这些 path d 串；图标渲染不经过 innerHTML，天然无注入面）
    const IC = {
      search: [e('circle', { key: 'c', cx: 11, cy: 11, r: 7 }), e('path', { key: 'p', d: 'm20 20-3.5-3.5' })],
      plus: [e('path', { key: 'p', d: 'M12 5v14M5 12h14' })],
      chev: [e('path', { key: 'p', d: 'm9 6 6 6-6 6' })],
      pin: [e('path', { key: 'p', d: 'M12 17v5M7 4h10l-1.5 6.5 3 4.5h-13l3-4.5Z' })],
      folder: [e('path', { key: 'p', d: 'M4 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z' })],
      topic: [e('path', { key: 'p', d: 'M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4Z' })],
      bolt: [e('path', { key: 'p', d: 'M13 3 5 13.5h6L11 21l8-10.5h-6Z' })],
      eye: [e('path', { key: 'p', d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z' }), e('circle', { key: 'c', cx: 12, cy: 12, r: 3 })],
      play: [e('path', { key: 'p', d: 'M7 5.5v13l11-6.5Z' })],
      ext: [e('path', { key: 'p', d: 'M14 5h5v5M19 5l-8 8M11 5H6a1.5 1.5 0 0 0-1.5 1.5V18A1.5 1.5 0 0 0 6 19.5h11.5A1.5 1.5 0 0 0 19 18v-5' })],
      trash: [e('path', { key: 'p', d: 'M4.5 6.5h15M9 6V4.5h6V6M7 6.5 8 20h8l1-13.5M10 10v6M14 10v6' })],
      gear: [e('circle', { key: 'c', cx: 12, cy: 12, r: 3.2 }), e('path', { key: 'p', d: 'M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18' })],
      up: [e('path', { key: 'p', d: 'M12 19V6M6.5 11.5 12 6l5.5 5.5M5 20h14' })],
      down: [e('path', { key: 'p', d: 'M12 5v13M6.5 12.5 12 18l5.5-5.5M5 20h14' })],
      note: [e('path', { key: 'p1', d: 'M6 4h9l4 4v12H6Z' }), e('path', { key: 'p2', d: 'M14.5 4v4.5H19' })],
      filter: [e('path', { key: 'p', d: 'M4 5h16l-6.5 7.5V19l-3-1.5v-5Z' })],
      // 原型 defs 遗漏了 i-check（capSave 引用），补上；tag/swap 为 v2 新增（标签 chip / 入口模式切换）
      check: [e('path', { key: 'p', d: 'M4.5 12.5 10 18 19.5 6.5' })],
      tag: [e('path', { key: 'p', d: 'M4 4h7l9 9-7 7-9-9Z' }), e('circle', { key: 'c', cx: 8, cy: 8, r: 1.6 })],
      swap: [e('path', { key: 'p', d: 'M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8' })],
      // v3 双模式编辑器工具栏图标（原型 notes-editor-v3.html defs 内联化）
      codeblock: [e('path', { key: 'p', d: 'm8 6-6 6 6 6M16 6l6 6-6 6' })],
      bold: [e('path', { key: 'p1', d: 'M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z' }), e('path', { key: 'p2', d: 'M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z' })],
      italic: [e('path', { key: 'p', d: 'M19 4h-9M14 20H5M15 4 9 20' })],
      link: [e('path', { key: 'p1', d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }), e('path', { key: 'p2', d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' })],
      ul: [e('path', { key: 'p', d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' })],
      ol: [e('path', { key: 'p', d: 'M11 6h10M11 12h10M11 18h10M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1' })],
      quote: [e('path', { key: 'p1', d: 'M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z' }), e('path', { key: 'p2', d: 'M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z' })],
      image: [e('rect', { key: 'r', x: 3, y: 3, width: 18, height: 18, rx: 2 }), e('circle', { key: 'c', cx: 9, cy: 9, r: 2 }), e('path', { key: 'p', d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' })],
      warn: [e('path', { key: 'p1', d: 'M12 3 2.5 20h19Z' }), e('path', { key: 'p2', d: 'M12 10v4M12 17.5v.01' })],
      // 二期 ✨整理（AI 按 kind 模板重写正文）图标：双星
      sparkle: [e('path', { key: 'p1', d: 'M10 3l1.7 4.8 4.8 1.7-4.8 1.7L10 16l-1.7-4.8-4.8-1.7 4.8-1.7Z' }), e('path', { key: 'p2', d: 'M17.5 14.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9Z' })],
      // 敏感标记（sensitive 字段 toggle）：锁形图标
      lock: [e('rect', { key: 'r', x: 4.5, y: 10.5, width: 15, height: 9.5, rx: 1.5 }), e('path', { key: 'p', d: 'M8 10.5V7.5a4 4 0 0 1 8 0v3' })],
      // 筛选中心新增（design/notes-filter-center.html）：曾注入时钟 / 排序 / 激活 chip × 移除
      clock: [e('circle', { key: 'c', cx: 12, cy: 12, r: 8.5 }), e('path', { key: 'p', d: 'M12 7.5V12l3 2' })],
      sort: [e('path', { key: 'p', d: 'M8 5v14M8 5 4.5 8.5M8 5l3.5 3.5M16 19V5M16 19l3.5-3.5M16 19l-3.5-3.5' })],
      x: [e('path', { key: 'p', d: 'M6 6l12 12M18 6 6 18' })],
      // 键盘流速查表（notes-034-f-cheatsheet）标题图标：键盘
      kbd: [e('rect', { key: 'r', x: 2.5, y: 6, width: 19, height: 12, rx: 2 }), e('path', { key: 'p', d: 'M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6' })],
    }
    // I(name, size?, cls?)：图标 helper——返回 e('svg') 结构（stroke=currentColor 由 CSS 统一，尺寸默认 15px）
    function I(name, size, cls) {
      return e('svg', { className: 'dsh-ic' + (cls ? ' ' + cls : ''), viewBox: '0 0 24 24', style: size ? { width: size + 'px', height: size + 'px' } : undefined, 'aria-hidden': 'true' }, IC[name])
    }
    // ===== 双模式编辑器内核 v3（规格：design/notes-editor-v3.html；app.html/发布包 lib/client.js 同块同步，check.js 断言三端一致）=====
    // 安全红线：esc() 先把 & < > " ' 转为实体，绝不用 innerHTML 直插原文；代码块内容同样转义
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\x22/g, '&quot;').replace(/\x27/g, '&#39;')
    }
    // 资产显示路由：正文相对路径 ![](assets/xxx) → GET /dsh-notes/asset?file=assets/xxx（静态包 index.mjs 路由下发二进制）；
    // img 用 data-md-src 记原始相对路径，序列化时还原（显示 URL 不进 Markdown）
    function assetDisplaySrc(mdSrc) { return '/dsh-notes/asset?file=' + encodeURIComponent(mdSrc) }
    // ===== P2 双链 [[target]]：target 不含方括号/换行。解析放 client（渲染时按当前库匹配；host 不改）=====
    // 口径：[[n-xxx]] 精确 id 优先，其次 [[标题]] 全库标题精确匹配；解析不到 → 纯文本。反向链接扫描复用同一正则口径
    var WIKI_RE = /\[\[([^\[\]\n]+)\]\]/g
    function extractWikiTargets(text) { var out = [], m; WIKI_RE.lastIndex = 0; while ((m = WIKI_RE.exec(String(text == null ? '' : text)))) { out.push(m[1]); if (out.length >= 500) break } return out }
    function wikiLinksTo(body, id, title) { var ts = extractWikiTargets(body); return ts.indexOf(id) >= 0 || (!!title && ts.indexOf(title) >= 0) }
    // 反转义（esc 的逆）：行内文本已转义，双链 target 解析前须还原（否则含 & 的标题永不命中）
    function unesc(s) { return String(s).replace(/&(amp|lt|gt|quot|#39);/g, function (m, k) { return k === 'amp' ? '&' : k === 'lt' ? '<' : k === 'gt' ? '>' : k === 'quot' ? '"' : "'" }) }
    // Markdown → 富文本 HTML（受限 WYSIWYG 渲染方向）。白名单：h1-h3/段落/ul/ol/引用/围栏代码块/分隔线；行内 粗体/斜体/行内码/链接(仅 http/https)/图片(仅 assets/ 前缀)/双链 [[id或标题]]（wikiResolve 解析，不中按纯文本）
    // L1：行内原始 HTML 不解释——esc() 先行转为字面文本（<input type="date"> 原样显示，零注入面），序列化逐字还原
    // L2：GFM 表格（表头行+对齐分隔行）只读渲染为 <table contenteditable="false">，原始源码逐字记 data-md-src，序列化原样回吐
    function renderMarkdown(md, wikiResolve) {
      var src = String(md || '')
      if (!src.trim()) return ''
      var lines = src.replace(/\r\n/g, '\n').split('\n')
      var out = []
      var i = 0
      var inUl = false, inOl = false
      function closeLists() { if (inUl) { out.push('</ul>'); inUl = false } if (inOl) { out.push('</ol>'); inOl = false } }
      // 行内：反斜杠转义（占位符法，与序列化器 escapeMd 互逆）→ 图片（先于链接；仅 assets/ 前缀放行，其余原样呈现纯文本）→ 行内码 → 粗体 → 斜体 → 链接 → 双链 [[..]]
      function inline(s) {
        var t = esc(s), ph = []
        t = t.replace(/\\([\\\x60*\[\]])/g, function (m, c) { ph.push(c); return '\uE000' + (ph.length - 1) + '\uE001' })
        t = t.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, function (m, alt, isrc) {
          if (!/^assets\/[^\s?#]+$/.test(isrc)) return m
          return '<img src="' + esc(assetDisplaySrc(isrc)) + '" data-md-src="' + isrc + '" alt="' + alt + '">'
        })
        t = t.replace(/\x60([^\x60]+)\x60/g, function (m, c) { return '<code>' + c + '</code>' })
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
        t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        // P2 双链：[[target]] → 可点击锚（data-wiki 记原始 target 供序列化还原；点击跳转由调用侧委托绑定）；wikiResolve 解析不到 → 纯文本
        t = t.replace(/\[\[([^\[\]\n]+)\]\]/g, function (m, w) {
          var r = typeof wikiResolve === 'function' ? wikiResolve(unesc(w)) : null
          if (!r) return m
          var label = r.title ? esc(r.title) : w
          return '<a class="dsh-notes-wikilink" data-wiki="' + w + '" href="#wiki" title="' + label + '">' + label + '</a>'
        })
        t = t.replace(/\uE000(\d+)\uE001/g, function (m, n) { return esc(ph[+n]) })
        return t
      }
      var HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
      var STOP = /^(#{1,3}\s|\x60\x60\x60|>\s?|[-*+]\s|\d+\.\s|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/
      // L2 GFM 表格：表头行（含 |）+ 紧跟对齐分隔行（每格 :?-+:?，行内至少一个 |）→ 只读 <table>；
      // 原始源码逐字记 data-md-src（含对齐分隔行），serializeRich 原样回吐——渲染只影响显示，round-trip 逐字一致是硬约束
      // 单元格切分：\| 转义管道不切列（私用区占位 \uE002 防误切，显示还原为 |；原始源码只经 data-md-src 回吐）
      function splitTblRow(line) {
        var t = String(line).trim().replace(/\\\|/g, '\uE002').replace(/^\|/, '').replace(/\|$/, '')
        return t.split('|').map(function (c) { return c.replace(/\uE002/g, '|').trim() })
      }
      // 对齐分隔行判定：命中返回逐列对齐（left/center/right/'' 数组），否则 null
      function parseTblDelims(line) {
        var l = String(line)
        if (l.indexOf('|') < 0 || !/^\s*\|?[\s:|-]*$/.test(l)) return null
        var cells = splitTblRow(l), aligns = []
        for (var k = 0; k < cells.length; k++) {
          var m = cells[k].match(/^(:?)-+(:?)$/)
          if (!m) return null
          aligns.push(m[1] && m[2] ? 'center' : m[1] ? 'left' : m[2] ? 'right' : '')
        }
        return aligns.length ? aligns : null
      }
      // 表格起点：当前行含 | 且下一行是对齐分隔行（段落累积遇此同样断开，防表格被段落吞并丢换行）
      function isTblStart(idx) { return lines[idx].indexOf('|') >= 0 && idx + 1 < lines.length && !!parseTblDelims(lines[idx + 1]) }
      while (i < lines.length) {
        var line = lines[i]
        // 围栏代码块
        if (/^\x60\x60\x60/.test(line)) {
          closeLists()
          var lang = line.replace(/^\x60\x60\x60/, '').trim()
          var codeLines = []
          i++
          while (i < lines.length && !/^\x60\x60\x60/.test(lines[i])) { codeLines.push(lines[i]); i++ }
          i++
          out.push('<pre' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code>' + esc(codeLines.join('\n')) + '</code></pre>')
          continue
        }
        // 分隔线
        if (HR.test(line)) { closeLists(); out.push('<hr>'); i++; continue }
        // 标题 # ~ ###
        var hm = line.match(/^(#{1,3})\s+(.*)$/)
        if (hm) {
          closeLists()
          var lvl = hm[1].length
          out.push('<h' + lvl + '>' + inline(hm[2]) + '</h' + lvl + '>')
          i++
          continue
        }
        // 引用块
        if (/^>\s?/.test(line)) {
          closeLists()
          var quoteLines = []
          while (i < lines.length && /^>\s?/.test(lines[i])) { quoteLines.push(lines[i].replace(/^>\s?/, '')); i++ }
          out.push('<blockquote>' + inline(quoteLines.join(' ')) + '</blockquote>')
          continue
        }
        // 无序列表
        if (/^[-*+]\s+/.test(line)) {
          if (inOl) { out.push('</ol>'); inOl = false }
          if (!inUl) { out.push('<ul>'); inUl = true }
          out.push('<li>' + inline(line.replace(/^[-*+]\s+/, '')) + '</li>')
          i++
          continue
        }
        // 有序列表
        if (/^\d+\.\s+/.test(line)) {
          if (inUl) { out.push('</ul>'); inUl = false }
          if (!inOl) { out.push('<ol>'); inOl = true }
          out.push('<li>' + inline(line.replace(/^\d+\.\s+/, '')) + '</li>')
          i++
          continue
        }
        // L2 GFM 表格（只读渲染）：表头 + 对齐分隔行 + 表体（连续含 | 的非空白行；格数不齐补空/截尾仅影响显示，源码不动）
        if (isTblStart(i)) {
          closeLists()
          var tblRaw = [lines[i], lines[i + 1]]
          var aligns = parseTblDelims(lines[i + 1])
          var headCells = splitTblRow(lines[i])
          i += 2
          var bodyRows = []
          while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') >= 0 && !STOP.test(lines[i])) { tblRaw.push(lines[i]); bodyRows.push(splitTblRow(lines[i])); i++ }
          var cols = Math.max(headCells.length, aligns.length)
          var alAt = function (k2) { var al = aligns[k2] || ''; return al ? ' style="text-align:' + al + '"' : '' }
          var ths = []
          for (var hk = 0; hk < cols; hk++) ths.push('<th' + alAt(hk) + '>' + inline(headCells[hk] || '') + '</th>')
          var trs = ''
          bodyRows.forEach(function (r) { var tds = []; for (var bk = 0; bk < cols; bk++) tds.push('<td' + alAt(bk) + '>' + inline(r[bk] || '') + '</td>'); trs += '<tr>' + tds.join('') + '</tr>' })
          out.push('<table class="dsh-notes-table" contenteditable="false" data-md-src="' + esc(tblRaw.join('\n')) + '"><thead><tr>' + ths.join('') + '</tr></thead><tbody>' + trs + '</tbody></table>')
          continue
        }
        // 空行
        if (line.trim() === '') { closeLists(); i++; continue }
        // 段落（连续非空非特殊行合并；表格起点同样断开）
        closeLists()
        var paraLines = []
        while (i < lines.length && lines[i].trim() !== '' && !STOP.test(lines[i]) && !isTblStart(i)) { paraLines.push(lines[i]); i++ }
        out.push('<p>' + inline(paraLines.join(' ')) + '</p>')
      }
      closeLists()
      return out.join('\n')
    }
    // ===== 序列化器（富文本 DOM → Markdown）：renderMarkdown 的逆函数，只产出白名单语法 =====
    // 行内：escapeMd 与渲染器占位符转义互逆（2*3、a[b]、反引号均可无损往返）
    function escapeMd(t) { return String(t).replace(/\\/g, '\\\\').replace(/([\x60*\[\]])/g, '\\$1') }
    function serializeInline(node) {
      var s = ''
      node.childNodes.forEach(function (ch) {
        if (ch.nodeType === 3) { s += escapeMd(ch.nodeValue); return }
        if (ch.nodeType !== 1) return
        var tag = ch.tagName
        if (tag === 'BR') { s += ' '; return }
        if (tag === 'STRONG' || tag === 'B') { var b = serializeInline(ch); if (b.trim()) s += '**' + b + '**'; return }
        if (tag === 'EM' || tag === 'I') { var em = serializeInline(ch); if (em.trim()) s += '*' + em + '*'; return }
        if (tag === 'CODE') { var c = ch.textContent.replace(/\x60/g, '\\\x60'); s += '`' + c + '`'; return }
        // P2 双链：data-wiki 锚序列化回 [[原始 target]]（显示标题不进 Markdown，目标改名后 target 不漂移）
        if (tag === 'A') { var wk = ch.getAttribute('data-wiki'); if (wk != null) { s += '[[' + wk + ']]'; return } var href = ch.getAttribute('href') || ''; s += '[' + serializeInline(ch) + '](' + href + ')'; return }
        if (tag === 'IMG') { s += '![' + (ch.getAttribute('alt') || '') + '](' + (ch.getAttribute('data-md-src') || ch.getAttribute('src') || '') + ')'; return }
        if (tag === 'SCRIPT' || tag === 'STYLE') return
        s += serializeInline(ch) // SPAN/FONT/MARK 等未知行内 → 拆壳保留文本
      })
      return s
    }
    // 列表序列化：一个列表 = 一个块（item 间单换行，块间才空行）；嵌套列表拍平为同级（白名单只承诺一级）
    function serializeList(listEl) {
      var items = [], ordered = listEl.tagName === 'OL', idx = 0
      listEl.childNodes.forEach(function (li) {
        if (li.nodeType !== 1 || li.tagName !== 'LI') return
        idx++
        var marker = ordered ? (idx + '. ') : '- '
        var inlineParts = '', nested = []
        li.childNodes.forEach(function (c) {
          if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(c)
          else inlineParts += (c.nodeType === 3 ? escapeMd(c.nodeValue) : serializeInlineWrap(c))
        })
        items.push(marker + inlineParts.trim())
        nested.forEach(function (nl) { items.push(serializeList(nl)) })
      })
      return items.join('\n')
    }
    function serializeInlineWrap(node) { var d = document.createElement('span'); d.appendChild(node.cloneNode(true)); return serializeInline(d) }
    function serializeRich(root) {
      var out = []
      root.childNodes.forEach(function (el) {
        if (el.nodeType === 3) { var t0 = escapeMd(el.nodeValue).trim(); if (t0) out.push(t0); return }
        if (el.nodeType !== 1) return
        var tag = el.tagName
        if (tag === 'H1' || tag === 'H2' || tag === 'H3') { var t1 = serializeInline(el).trim(); if (t1) out.push('#'.repeat(+tag[1]) + ' ' + t1) }
        else if (tag === 'P' || tag === 'DIV') {
          var imgs = el.querySelectorAll('img'), onlyImg = imgs.length === 1 && !el.textContent.trim()
          if (onlyImg) { out.push(serializeInline(el).trim()) }
          else { var t2 = serializeInline(el).trim(); if (t2) out.push(t2) }
        }
        else if (tag === 'UL' || tag === 'OL') { var lst = serializeList(el); if (lst) out.push(lst) }
        else if (tag === 'BLOCKQUOTE') {
          var blocks = el.querySelectorAll('p,div')
          if (blocks.length) { blocks.forEach(function (b) { var t3 = serializeInline(b).trim(); if (t3) out.push('> ' + t3) }) }
          else { var t4 = serializeInline(el).trim(); if (t4) out.push('> ' + t4) }
        }
        else if (tag === 'PRE') {
          var lang = el.getAttribute('data-lang') || ''
          var code = el.textContent.replace(/\n+$/, '')
          out.push('```' + lang + '\n' + code + '\n```')
        }
        // L2 只读表格：data-md-src 逐字回吐原始表格源码（含对齐分隔行）；无源码记录的外来表格按文本拆壳兜底
        else if (tag === 'TABLE') { var tsrc = el.getAttribute('data-md-src'); if (tsrc) out.push(tsrc); else { var t6 = serializeInline(el).trim(); if (t6) out.push(t6) } }
        else if (tag === 'HR') { out.push('---') }
        else if (tag === 'IMG') { out.push(serializeInlineWrap(el)) }
        else { var t5 = serializeInline(el).trim(); if (t5) out.push(t5) }
      })
      return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
    }
    // 往返自检归一化：行尾空白/多余空行不视为差异
    function normMd(s) { return String(s || '').replace(/\r\n/g, '\n').split('\n').map(function (l) { return l.replace(/\s+$/, '') }).join('\n').replace(/\n{3,}/g, '\n\n').trim() }
    // ===== 白名单降级分析：正文含白名单外结构 → 富文本入口置灰；围栏代码块内容不参与判定 =====
    // L1 放宽：行内原始 HTML 不再降级——inline() 首步 esc() 已把它渲染成转义字面文本（无注入面），序列化经文本节点逐字还原，
    // 单行往返逐字一致；保留降级的只剩「多行 HTML 块」（段落合并会丢换行、逐字往返不保）与下方歧义结构
    // L2 放宽：GFM 表格不再降级——renderMarkdown 只读渲染（contenteditable=false + 对齐样式），serializeRich 经 data-md-src 逐字回吐
    var DEG_RULES = [
      { key: 'nestedQuote', label: '嵌套引用', re: /^\s*>(?:\s*>)+/ },
      { key: 'h4', label: '四级及以下标题', re: /^\s*#{4,6}\s/ },
      { key: 'task', label: '任务列表', re: /^\s*[-*+]\s+\[[ xX]\]/ }
    ]
    // 多行 HTML 块判定行：行首（可缩进）即 <tag>/</tag>。单行 <tag> 行（含行内代码里的标签）按字面量渲染、逐字往返，放行；
    // 连续 ≥2 个此类行才构成多行 HTML 块 → 降级（记段首行号/样本）
    var HTML_BLOCK_LINE = /^\s*<\/?[a-zA-Z][^>\n]*>/
    function analyzeMarkdown(md) {
      var found = {}, order = []
      var htmlRun = 0, htmlRunStart = -1, htmlRunSample = ''
      String(md || '').split('\n').forEach(function (ln, idx) {
        if (/^\x60\x60\x60/.test(ln)) { analyzeMarkdown._in = !analyzeMarkdown._in; htmlRun = 0; htmlRunStart = -1; return }
        if (analyzeMarkdown._in) return
        if (HTML_BLOCK_LINE.test(ln)) {
          if (htmlRun === 0) { htmlRunStart = idx; htmlRunSample = ln.trim().slice(0, 36) }
          htmlRun++
          if (htmlRun === 2 && !found.htmlBlock) { found.htmlBlock = { label: '多行 HTML 块', line: htmlRunStart + 1, sample: htmlRunSample }; order.push(found.htmlBlock) }
        } else { htmlRun = 0; htmlRunStart = -1 }
        DEG_RULES.forEach(function (r) {
          if (!found[r.key] && r.re.test(ln)) { found[r.key] = { label: r.label, line: idx + 1, sample: ln.trim().slice(0, 36) }; order.push(found[r.key]) }
        })
      })
      analyzeMarkdown._in = false
      return { ok: order.length === 0, reasons: order }
    }
    // ===== 粘贴 HTML 白名单清洗：h4-6 降为段落，table/div 拆壳，script/style 丢弃，链接仅 http/https =====
    function sanitizeFragment(frag) {
      var KEEP_B = { P: 1, H1: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, BR: 1, HR: 1, STRONG: 1, B: 1, EM: 1, I: 1, CODE: 1, IMG: 1 }
      function walk(node, out) {
        node.childNodes.forEach(function (ch) {
          if (ch.nodeType === 3) { out.appendChild(document.createTextNode(ch.nodeValue)); return }
          if (ch.nodeType !== 1) return
          var tag = ch.tagName
          if (tag === 'SCRIPT' || tag === 'STYLE') return
          if (tag === 'A') { var wk = ch.getAttribute('data-wiki'); if (wk != null) { var wa = document.createElement('a'); wa.setAttribute('class', 'dsh-notes-wikilink'); wa.setAttribute('data-wiki', wk); wa.setAttribute('href', '#wiki'); walk(ch, wa); out.appendChild(wa); return } var href = ch.getAttribute('href') || ''; if (/^https?:/.test(href)) { var a = document.createElement('a'); a.href = href; walk(ch, a); out.appendChild(a) } else walk(ch, out); return }
          if (tag === 'IMG') { var isrc = ch.getAttribute('data-md-src') || ''; if (!/^assets\/[^\s?#]+$/.test(isrc)) return; var im = document.createElement('img'); im.src = assetDisplaySrc(isrc); im.setAttribute('data-md-src', isrc); im.alt = ch.alt || ''; out.appendChild(im); return }
          if (/^H[4-6]$/.test(tag)) { var p = document.createElement('p'); walk(ch, p); out.appendChild(p); return }
          if (KEEP_B[tag]) { var el = document.createElement(tag.toLowerCase()); walk(ch, el); out.appendChild(el); return }
          walk(ch, out) // 其他标签拆壳
        })
      }
      var box = document.createElement('div'); walk(frag, box); return box
    }
    // ===== end 双模式编辑器内核 v3 =====
    // 性能自检计数器：浏览器控制台执行 JSON.stringify(window.__dshNotesPerf) 可取数诊断
    const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now()
    const perf = { selChange: 0, selCollapsedSkip: 0, selChangeMs: 0, selShowEval: 0, selShowMs: 0, mousemoveTracked: 0, hostCall: 0, hostCallMs: 0, panelRender: 0, selRender: 0, hdrRender: 0, longTasks: 0, longTaskMs: 0, worstTaskMs: 0 }
    try { window.__dshNotesPerf = perf } catch (e2) {}
    // client → host RPC：静态包走 webServer exact 路由（PACKAGING.md 第 4 节），
    // 与 index.mjs 的 RPC_PATH = '/dsh-notes' 对应。
    function rpc(method, args) {
      perf.hostCall++
      var t0 = now()
      return fetch('/dsh-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: method, args: args || {} })
      }).then(
        function (r) { perf.hostCallMs += now() - t0; return r.json() },
        function (err) { perf.hostCallMs += now() - t0; throw err }
      )
    }
    // 性能计数器在 rpc() helper 内部累加（hostCall/hostCallMs），不再改写全局 host 桥
    // 长任务观察器：主线程阻塞（>50ms）的直接证据
    try {
      if (typeof PerformanceObserver !== 'undefined') {
        const po = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          for (let i = 0; i < entries.length; i++) { const en = entries[i]; perf.longTasks++; perf.longTaskMs += en.duration; if (en.duration > perf.worstTaskMs) perf.worstTaskMs = Math.round(en.duration) }
        })
        po.observe({ type: 'longtask' })
        disposers.push(() => po.disconnect())
      }
    } catch (e2) {}
    // 每 30s 把计数器推给 host，汇总写入 perf-report.json（timer 经 ctx.get + ctx.effect）
    try {
      var pd = typeof timer.interval === 'function' ? timer.interval(function () { try { rpc('notes-perf', { perf: JSON.parse(JSON.stringify(perf)) }) } catch (e2) {} }, 30000) : null
      if (typeof pd === 'function') ctx.effect(function () { return pd })
    } catch (e2) {}
    // 样式从 host 拉取（doc 级 <style> 注入，替代动态插件的 styles 服务）
    // PACKAGING.md 坑5：args 里不能出现值为 undefined 的字段，故 notes-css 不传参
    let cssLoaded = false
    let cssTries = 0
    function loadCss() {
      rpc('notes-css').then(function (res) {
        if (res && res.css) {
          cssLoaded = true
          // 进程单例：样式注入 document.head 一次，卸载时移除
          var tag = document.createElement('style')
          tag.dataset.dshNotes = '1'
          tag.textContent = res.css
          document.head.append(tag)
          disposers.push(function () { try { tag.remove() } catch (e2) {} })
        } else scheduleCssRetry()
      }).catch(scheduleCssRetry)
    }
    function scheduleCssRetry() { if (!cssLoaded && ++cssTries <= 10) { var d = timer.timeout(loadCss, 1200); disposers.push(d) } }
    loadCss()
    // 通用拖拽：move(ev) 在 mousemove 时调用，done() 在 mouseup 时调用
    function drag(move, done) {
      const onMove = (ev) => move(ev)
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); if (done) done() }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
    // ===== modal: link —— 链接插入弹窗（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.link / linkModalRef / setLinkModal / LinkModal
    // needs: kernel/state.js（store/createStore/panelBridge）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：linkModal（null | { text, url }）迁入 store.modal.link 切片（modal 字段）；
    // linkModalRef 为 Esc 栈/Ctrl+/ 守卫的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）
    store.modal.link = createStore({ modal: null })
    const linkModalRef = { current: null }
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：同步写 ref 镜像 + store（订阅方 = LinkModal）
    function setLinkModal(v) { const nv = typeof v === 'function' ? v(linkModalRef.current) : v; linkModalRef.current = nv; store.modal.link.set({ modal: nv }) }
    // 富文本工具栏「链接」按钮的弹窗宿主：选中文字由 toolbarAction（whole.js）经 keepSel 缓存后 setLinkModal 打开
    function LinkModal() {
      const linkModal = store.modal.link.useSel(s => s.modal)
      // 链接弹窗确认（原型 openLinkModal 的确定分支）：仅 http/https；编辑器选区/富文本运行时经 panelBridge 中转
      function doInsertLink() {
        const m = linkModalRef.current
        const url = m ? String(m.url || '').trim() : ''
        if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) { showToast('仅支持 http/https 链接'); return }
        setLinkModal(null)
        panelBridge.restoreSel()
        const el = panelBridge.richRef.current; if (el) el.focus()
        document.execCommand('createLink', false, url)
        panelBridge.keepSel(); panelBridge.richDirtyRef.current = true; panelBridge.scheduleRichSync()
      }
      // 链接插入弹窗（富文本工具栏「链接」按钮，需先选中文字）：URL 仅 http/https
      return linkModal ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setLinkModal(null) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('link', 14), ' 插入链接', e('span', { className: 'dsh-notes-imgup-sub' }, '选中文字：' + (linkModal.text.length > 24 ? linkModal.text.slice(0, 24) + '…' : linkModal.text))),
          e('input', { className: 'dsh-notes-data-input', placeholder: 'https://…', value: linkModal.url, autoFocus: true, onChange: (ev) => setLinkModal(Object.assign({}, linkModal, { url: ev.target.value })), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doInsertLink() } } }),
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setLinkModal(null) }, '取消'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doInsertLink }, '插入'))))
      : null
    }
    // ===== modal: image —— 图片插入弹窗（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.image / imgModalRef / imgFileInputRef / setImgModal / openImgModal / pickImageFile / ImageModal
    //   （IMG_COMPRESS_THRESHOLD/compressImageData 仅服务 pickImageFile，随弹窗同域迁入；insertImageMd 是编辑器域，滞留 whole.js 经 panelBridge 中转）
    // needs: kernel/state.js（store/createStore/panelBridge）、kernel/icons.js（e/I）、kernel/format.js（fmtBytes）、kernel/bus.js（showToast）
    // state 托管：imgModal（null | { name, dataURL, mime, size, alt, uploading, error }）迁入 store.modal.image 切片（modal 字段）；
    // imgModalRef 为 Esc 栈/Ctrl+/ 守卫的同步镜像（模块级单例，与昔日 FloatingPanel 内 useRef 等价）
    store.modal.image = createStore({ modal: null })
    const imgModalRef = { current: null }
    const imgFileInputRef = { current: null }   // 图片弹窗隐藏 file input
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：同步写 ref 镜像 + store（订阅方 = ImageModal）
    function setImgModal(v) { const nv = typeof v === 'function' ? v(imgModalRef.current) : v; imgModalRef.current = nv; store.modal.image.set({ modal: nv }) }
    // ---- 二期 图片压缩：>1MB 的 PNG/JPEG 上传前前端 canvas 降质转 JPEG（GIF/WebP 不动，保动画/透明语义）----
    // 策略：长边封顶 2560px → 质量阶梯 0.85→0.45 逐档试；仍超 1MB 则长边 0.8 递减（下限 800px）；
    // PNG 透明底刷白（JPEG 无 alpha）；任何一步失败 → cb(null) 回退原图上传。压缩产物 <1MB 即收。
    const IMG_COMPRESS_THRESHOLD = 1024 * 1024
    function compressImageData(dataURL, cb) {
      try {
        const img = new Image()
        img.onload = () => {
          try {
            let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
            if (!w || !h) { cb(null); return }
            const MAX_DIM = 2560
            if (Math.max(w, h) > MAX_DIM) { const r = MAX_DIM / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r) }
            const canvas = document.createElement('canvas')
            const c2d = canvas.getContext('2d')
            if (!c2d) { cb(null); return }
            const qs = [0.85, 0.75, 0.65, 0.55, 0.45]
            let out = '', bytes = 0, round = 0
            while (round < 8) {
              canvas.width = w; canvas.height = h
              c2d.fillStyle = '#ffffff'; c2d.fillRect(0, 0, w, h)
              c2d.drawImage(img, 0, 0, w, h)
              out = canvas.toDataURL('image/jpeg', qs[Math.min(round, qs.length - 1)])
              bytes = Math.max(0, Math.round((out.length - 23) * 3 / 4))   // 去掉 data:image/jpeg;base64, 头估算字节
              if (bytes <= IMG_COMPRESS_THRESHOLD) { cb({ dataURL: out, bytes: bytes }); return }
              round++
              if (round >= qs.length && (w > 800 || h > 800)) { w = Math.max(800, Math.round(w * 0.8)); h = Math.max(800, Math.round(h * 0.8)); round = qs.length - 1 }
            }
            cb(out ? { dataURL: out, bytes: bytes } : null)   // 兜底：尽力压缩产物（可能仍 >1MB，5MB 上限内可用）
          } catch (err) { cb(null) }
        }
        img.onerror = () => cb(null)
        img.src = dataURL
      } catch (err) { cb(null) }
    }
    // 图片文件校验 + 读 dataURL → 打开插入弹窗（mime 白名单 png/jpeg/gif/webp、≤5MB，与 host 口径一致）
    // 二期：>1MB 的 PNG/JPEG 先走 compressImageData 压缩转 JPEG 再进弹窗（弹窗大小行显示「已压缩 原 → 现」）
    function pickImageFile(f) {
      if (!f) return
      const MIME_OK = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 }
      if (!MIME_OK[f.type]) { showToast('仅支持 PNG/JPEG/GIF/WebP 图片'); return }
      if (f.size > 5 * 1024 * 1024) { showToast('图片超过 5MB 上限'); return }
      const rd = new FileReader()
      rd.onload = () => {
        const base = { name: f.name || ('pasted-' + Date.now() + '.png'), dataURL: String(rd.result), mime: f.type, size: f.size, alt: (f.name || '').replace(/\.[^.]+$/, ''), uploading: false, error: '' }
        if (f.size > IMG_COMPRESS_THRESHOLD && (f.type === 'image/png' || f.type === 'image/jpeg')) {
          compressImageData(base.dataURL, (res) => {
            if (res && res.dataURL) setImgModal(Object.assign({}, base, { name: base.name.replace(/\.[^.]+$/, '') + '.jpg', dataURL: res.dataURL, mime: 'image/jpeg', size: res.bytes, origSize: f.size }))
            else setImgModal(base)   // 压缩失败回退原图（不阻塞上传）
          })
        } else setImgModal(base)
      }
      rd.onerror = () => showToast('图片读取失败')
      rd.readAsDataURL(f)
    }
    // 图片入口③：工具栏按钮 → 弹窗选文件（draft=null 时打开空弹窗）
    function openImgModal(draft) { setImgModal(draft || { name: '', dataURL: '', mime: '', size: 0, alt: '', uploading: false, error: '' }) }
    // 图片插入弹窗宿主（v3 三入口共用：粘贴/拖拽/工具栏按钮）：选文件 → 预览 + alt → 上传 → 光标处插入
    function ImageModal() {
      const imgModal = store.modal.image.useSel(s => s.modal)
      // 上传并插入：notes-asset-upload RPC → assets/<ts>-<安全名>；成功 → 光标处插入 ![](assets/…)；失败留在弹窗内报错可重试 + toast
      // 插入动作是编辑器域能力（insertImageMd 滞留 whole.js），经 panelBridge 中转
      function doUploadImage() {
        const m = imgModalRef.current
        if (!m || !m.dataURL || m.uploading) return
        setImgModal(Object.assign({}, m, { uploading: true, error: '' }))
        rpc('notes-asset-upload', { name: m.name, data: m.dataURL, mime: m.mime }).then(res => {
          if (res && res.error) {
            showToast('图片上传失败：' + res.error)
            const cur = imgModalRef.current
            if (cur) setImgModal(Object.assign({}, cur, { uploading: false, error: res.error }))
            return
          }
          const file = res && res.file
          if (!file) {
            const cur2 = imgModalRef.current
            if (cur2) setImgModal(Object.assign({}, cur2, { uploading: false, error: '上传返回异常（缺 file 字段）' }))
            return
          }
          const alt = (m.alt || '').trim()
          setImgModal(null)
          panelBridge.insertImageMd(file, alt)
          showToast('已插入图片：' + file)
        }).catch(err => {
          showToast('图片上传失败：' + String(err.message || err))
          const cur = imgModalRef.current
          if (cur) setImgModal(Object.assign({}, cur, { uploading: false, error: String(err.message || err) }))
        })
      }
      return imgModal ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !imgModal.uploading) setImgModal(null) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('image', 14), ' 插入图片', e('span', { className: 'dsh-notes-imgup-sub' }, '上传到笔记库 assets/（PNG/JPEG/GIF/WebP，≤5MB；>1MB 的 PNG/JPG 自动压缩转 JPEG）')),
          imgModal.dataURL
            ? e(React.Fragment, null,
                e('div', { className: 'dsh-notes-imgup-pv' },
                  e('img', { src: imgModal.dataURL, alt: '' }),
                  e('div', null,
                    e('div', { className: 'dsh-notes-imgup-nm' }, imgModal.name),
                    e('div', { className: 'dsh-notes-imgup-sz' }, (imgModal.origSize ? '已压缩 ' + fmtBytes(imgModal.origSize) + ' → ' : '') + (imgModal.size ? fmtBytes(imgModal.size) + ' · ' : '') + (imgModal.mime || '')))),
                e('input', { className: 'dsh-notes-data-input', placeholder: '替代文本 alt（可留空）', value: imgModal.alt, autoFocus: true, onChange: (ev) => setImgModal(Object.assign({}, imgModal, { alt: ev.target.value })), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doUploadImage() } } }))
            : e('div', { className: 'dsh-notes-imgup-zone', onClick: () => { if (imgFileInputRef.current) imgFileInputRef.current.click() } },
                '点击选择本地图片文件（也可直接把图片文件拖进编辑区，或 Ctrl+V 粘贴）',
                e('input', { ref: imgFileInputRef, type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', style: { display: 'none' }, onChange: (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) pickImageFile(f); ev.target.value = '' } })),
          imgModal.uploading ? e('div', { className: 'dsh-notes-imgup-prog on' }, e('i', null)) : null,
          imgModal.error ? e('div', { className: 'dsh-notes-dispatch-err' }, imgModal.error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setImgModal(null), disabled: imgModal.uploading }, '取消'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doUploadImage, disabled: !imgModal.dataURL || imgModal.uploading }, imgModal.uploading ? '上传中…' : '上传并插入'))))
      : null
    }
    // ===== modal: merge —— 多选合并标题输入框（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.merge / mergeOpenRef / setMergeOpen / setMergeTitle / setMergePending / openMerge / MergeModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged + doArchiveUndo 别名）
    // state 托管：open/title/pending 迁入 store.modal.merge 切片；mergeOpenRef 为 Esc 栈同步镜像（模块级单例）
    // 多选集合 selIds / 笔记清单 notes 是面板多选域状态（滞留 whole.js）：打开时经 panelBridge 读快照，弹窗内经 props 订阅
    store.modal.merge = createStore({ open: false, title: '', pending: false })
    const mergeOpenRef = { current: false }   // 多选合并对话框镜像（Esc 优先关）
    function setMergeOpen(v) { const nv = typeof v === 'function' ? v(mergeOpenRef.current) : v; mergeOpenRef.current = nv; store.modal.merge.set({ open: nv }) }
    function setMergeTitle(v) { store.modal.merge.set({ title: typeof v === 'function' ? v(store.modal.merge.get().title) : v }) }
    function setMergePending(v) { store.modal.merge.set({ pending: typeof v === 'function' ? v(store.modal.merge.get().pending) : v }) }
    // 打开合并标题输入框：默认标题 = 所选笔记中最早更新者的 topic（原型口径）
    function openMerge() {
      const selIdsNow = panelBridge.selIds || {}
      const ids = Object.keys(selIdsNow)
      if (ids.length < 2) { showToast('至少选择 2 条笔记'); return }
      const sel = (panelBridge.notes || []).filter(n => selIdsNow[n.id]).sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
      setMergeTitle((sel[0] && sel[0].topic) || '合并笔记'); setMergePending(false); setError(''); setMergeOpen(true)
    }
    // 多选合并标题输入框宿主（多选操作条「合并」入口）
    function MergeModal(props) {
      const mergeOpen = store.modal.merge.useSel(s => s.open)
      const mergeTitle = store.modal.merge.useSel(s => s.title)
      const mergePending = store.modal.merge.useSel(s => s.pending)
      const error = props.error
      const selIds = props.selIds || {}
      async function doMergeConfirm() {
        const ids = Object.keys(selIds)
        const t = mergeTitle.trim()
        if (ids.length < 2 || mergePending || !t) return
        setMergePending(true)
        try {
          const g = { memberIds: ids }; if (t) g.title = t   // payload 禁 undefined：空标题不传 title 字段
          const res = await rpc('notes-archive', { groups: [g] })
          if (res && res.error) { setError(res.error); setMergePending(false); return }
          setMergeOpen(false); setMergePending(false); panelBridge.setSelMode(false)
          showToast('已合并所选 ' + ids.length + ' 条', { label: '撤销', fn: doArchiveUndo })
          panelBridge.afterArchiveCleanup(ids)
          await panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)); setMergePending(false) }
      }
      // 多选合并标题输入框（多选操作条「合并」入口）：默认标题 = 所选最早更新笔记的 topic，可改；Enter 确认
      return mergeOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setMergeOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('note', 14), ' 合并所选笔记'),
          e('div', { className: 'dsh-notes-data-hint' }, '把所选的 ' + Object.keys(selIds).length + ' 条笔记合并为一篇（正文按更新时间分节拼接，原笔记软删除，可撤销）。'),
          e('input', { className: 'dsh-notes-data-input', placeholder: '合并后标题…', value: mergeTitle, autoFocus: true, onChange: (ev) => setMergeTitle(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doMergeConfirm() } } }),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setMergeOpen(false) }, '取消'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doMergeConfirm, disabled: mergePending || !mergeTitle.trim() }, mergePending ? '合并中…' : '合并'))))
      : null
    }
    // ===== modal: newnote —— 新建笔记弹窗（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.newnote / newNoteOpenRef / newNoteInputRef / setNewNoteOpen / setNewNoteTitle / setNewNotePending / openNewNote / NewNoteModal
    // needs: kernel/state.js（store/createStore/panelBridge + setError/setNewNoteKind 转发别名）、kernel/constants.js（KIND_LABELS/KIND_TEMPLATES）、
    //        kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）
    // state 托管：open/title/pending 迁入 store.modal.newnote 切片；newNoteOpenRef 为 Esc 栈同步镜像、newNoteInputRef 为标题输入框 DOM 通道
    // （模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）；
    // newNoteKind 因 check.js 锚定其 useState 声明原文而滞留 whole.js（面板侧声明），经 props（读）+ kernel 转发别名（openNewNote 内复位写）双向接入
    store.modal.newnote = createStore({ open: false, title: '', pending: false })
    const newNoteOpenRef = { current: false }   // 新建笔记 modal 镜像（Esc 优先关 modal）
    const newNoteInputRef = { current: null }   // 新建笔记 modal 标题输入框（whole.js 打开自动聚焦 effect 经此聚焦）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setNewNoteOpen(v) { const nv = typeof v === 'function' ? v(newNoteOpenRef.current) : v; newNoteOpenRef.current = nv; store.modal.newnote.set({ open: nv }) }
    function setNewNoteTitle(v) { store.modal.newnote.set({ title: typeof v === 'function' ? v(store.modal.newnote.get().title) : v }) }
    function setNewNotePending(v) { store.modal.newnote.set({ pending: typeof v === 'function' ? v(store.modal.newnote.get().pending) : v }) }
    // 新建笔记 modal：侧栏「新建」chip / Alt+N 打开（清空上次标题，类型复位 note）
    function openNewNote() { setNewNoteTitle(''); setNewNoteKind('note'); setNewNotePending(false); setError(''); setNewNoteOpen(true) }
    // 新建笔记 modal 宿主：输标题 + 选类型（二期：按类型预填模板骨架）创建 → 选中 → 聚焦正文
    function NewNoteModal(props) {
      const tt = useT()   // i18n 覆盖卡E：订阅 langStore，切语言本卡自渲染（模块级 handler 走 t() 直读当下语言态）
      const newNoteOpen = store.modal.newnote.useSel(s => s.open)
      const newNoteTitle = store.modal.newnote.useSel(s => s.title)
      const newNotePending = store.modal.newnote.useSel(s => s.pending)
      const error = props.error
      const notes = props.notes
      const selected = props.selected
      const view = props.view
      const newNoteKind = props.newNoteKind
      const setNewNoteKind = props.setNewNoteKind
      // 创建流程：notes-create → 静默刷新列表 → 选中新笔记 → 聚焦正文 textarea → toast
      // 落位规则（原型 btnNew）：主题视图带当前主题；否则落选中笔记所在文件夹/未分类
      // （0.4.3 验收修复⑦：「文件视图」（文件夹视图）模式已拆除，原「文件夹视图落当前文件夹」分支随之移除）
      // 面板能力（选中/闪现高亮/聚焦正文/切源码态/刷新列表）经 panelBridge 中转（禁横向引用）
      async function doCreateNote() {
        const title = newNoteTitle.trim()
        if (!title || newNotePending) return
        setNewNotePending(true); setError('')
        try {
          const selNote = notes.find(n => n.id === selected)
          const createFolder = (selNote && selNote.folder) || ''
          // 二期 kind 模板骨架：按所选类型预填（note=空自由格式；机器信息类由 ✨整理按内容适配，建时不预判）
          const payload = { title: title, body: KIND_TEMPLATES[newNoteKind] || '', kind: newNoteKind }
          if (createFolder) payload.folder = createFolder
          if (view.type === 'topic' && view.id) payload.topic = view.id
          const res = await rpc('notes-create', payload)
          if (res && res.error) { setError(res.error); return }
          setNewNoteOpen(false); setNewNoteTitle('')
          showToast(t('newnote.created'))
          // 立即用创建返回值选中新笔记（不等列表刷新，避免列表时序影响选中链路）
          if (res && res.id) {
            panelBridge.selectNote({ id: res.id, title: res.title || title, topic: res.topic || payload.topic || '', kind: res.kind || 'note', status: res.status || 'active', folder: createFolder, tags: [], inject: false, injectTo: [], sensitive: false })
            panelBridge.setFlashId(res.id); panelBridge.later(() => panelBridge.setFlashId(null), 1800)
            // 聚焦正文：等选中态渲染出 textarea 再 focus（富文本态先切回源码态，否则没有 textarea 可聚焦）
            panelBridge.setEditorModeState('source')
            panelBridge.later(() => { try { if (panelBridge.edBodyDomRef.current) panelBridge.edBodyDomRef.current.focus() } catch (err) {} }, 300)
            panelBridge.later(() => { try { if (panelBridge.edBodyDomRef.current && document.activeElement !== panelBridge.edBodyDomRef.current) panelBridge.edBodyDomRef.current.focus() } catch (err) {} }, 700)
          }
          notifyNotesChanged()
          panelBridge.loadNotes(true)  // 后台刷新列表（不 await，不阻塞选中/聚焦链路）
        } catch (err) { setError(String(err.message || err)) } finally { setNewNotePending(false) }
      }
      return newNoteOpen ? e('div', { className: 'dsh-notes-newnote-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setNewNoteOpen(false) } },
        e('div', { className: 'dsh-notes-newnote-modal' },
          e('div', { className: 'dsh-notes-newnote-t' }, tt('newnote.title')),
          e('input', { ref: newNoteInputRef, className: 'dsh-notes-newnote-input', placeholder: tt('newnote.titlePlaceholder'), value: newNoteTitle, onChange: (ev) => setNewNoteTitle(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateNote() } } }),
          e('div', { className: 'dsh-notes-newnote-kind-row' },
            e('span', { className: 'dsh-notes-newnote-kind-lb' }, tt('newnote.kindLabel')),
            e('select', { className: 'dsh-notes-newnote-select', value: newNoteKind, onChange: (ev) => setNewNoteKind(ev.target.value) },
              /* i18n 覆盖卡E：类型标签复用 B 卡 meta.kind* 字典（KIND_LABELS 常量表留作校验/过滤语义锚，不直接渲染） */
              ['note', 'decision', 'todo', 'link', 'quote', 'log'].map(k => e('option', { key: k, value: k }, tt('meta.kind' + k.charAt(0).toUpperCase() + k.slice(1))))),
            e('span', { className: 'dsh-notes-newnote-kind-hint' }, KIND_TEMPLATES[newNoteKind] ? tt('newnote.templateHint') : tt('newnote.freeHint'))),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-newnote-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setNewNoteOpen(false) }, tt('common.cancel')),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doCreateNote, disabled: newNotePending || !newNoteTitle.trim() }, newNotePending ? tt('newnote.creating') : tt('newnote.create')))))
      : null
    }
    // ===== modal: history —— 历史版本面板（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.history / histOpenRef / setHistOpen / setHistList / setHistSel / setHistPreview / setHistPending / openHistory / selectHistVersion / HistoryModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError/wikiResolve 别名/selectedRef）、kernel/format.js（fmtHistTs/fmtBytes）、
    //        kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）、editor-kernel.js（renderMarkdown）
    // state 托管：open/list/sel/preview/pending 迁入 store.modal.history 切片；histOpenRef 为 Esc 栈同步镜像（模块级单例）。
    // 入口计数探测 probeHistCount 与恢复回填 applyRestoredBody 属面板/编辑器域（滞留 whole.js），经 panelBridge 中转；
    // histCount（meta 行入口可见性）滞留 whole.js，本模块经 panelBridge.histCountRef/setHistCount 同步
    store.modal.history = createStore({ open: false, list: null, sel: 0, preview: null, pending: false })
    const histOpenRef = { current: false }   // 历史版本面板镜像（Esc 优先关）
    function setHistOpen(v) { const nv = typeof v === 'function' ? v(histOpenRef.current) : v; histOpenRef.current = nv; store.modal.history.set({ open: nv }) }
    function setHistList(v) { store.modal.history.set({ list: typeof v === 'function' ? v(store.modal.history.get().list) : v }) }
    function setHistSel(v) { store.modal.history.set({ sel: typeof v === 'function' ? v(store.modal.history.get().sel) : v }) }
    function setHistPreview(v) { store.modal.history.set({ preview: typeof v === 'function' ? v(store.modal.history.get().preview) : v }) }
    function setHistPending(v) { store.modal.history.set({ pending: typeof v === 'function' ? v(store.modal.history.get().pending) : v }) }
    // 打开历史面板：重置态 → 拉版本列表（默认选中最新版并加载预览）
    function openHistory() {
      const id = selectedRef.current
      if (!id) { showToast('先选择一条笔记'); return }
      setHistList(null); setHistSel(0); setHistPreview(null); setHistPending(false); setError('')
      setHistOpen(true)
      rpc('notes-history', { id: id }).then(res => {
        if (res && res.error) { setError(res.error); setHistList([]); return }
        const vs = (res && res.versions) || []
        setHistList(vs)
        panelBridge.histCountRef.current = vs.length; panelBridge.setHistCount(vs.length)
        if (vs.length) selectHistVersion(vs[0].ts)
      }).catch(err => { setError(String(err.message || err)); setHistList([]) })
    }
    // 点选版本 → notes-history-get 拉该版正文（只读预览；渲染走 renderMarkdown 内核，全量转义零注入面）
    function selectHistVersion(ts) {
      setHistSel(ts); setHistPreview(null)
      rpc('notes-history-get', { id: selectedRef.current, ts: ts }).then(res => {
        if (res && res.error) { setError(res.error); return }
        if (res) setHistPreview({ ts: ts, body: res.body || '' })
      }).catch(err => setError(String(err.message || err)))
    }
    // 历史版本面板宿主（详情 meta 行「历史」入口；mask/modal 复用设置卡片风格）：
    // 左列版本列表（时间+大小，倒序）→ 点选右侧只读预览 →「恢复此版本」confirm 后 notes-restore-history
    function HistoryModal(props) {
      const histOpen = store.modal.history.useSel(s => s.open)
      const histList = store.modal.history.useSel(s => s.list)
      const histSel = store.modal.history.useSel(s => s.sel)
      const histPreview = store.modal.history.useSel(s => s.preview)
      const histPending = store.modal.history.useSel(s => s.pending)
      const error = props.error
      // 一键恢复：confirm（明示"当前版本会先自动快照，可再撤销"）→ notes-restore-history → 刷新正文与列表 + toast
      // 恢复回填走 panelBridge.applyRestoredBody（whole.js 编辑器域；恢复版已由 host 落盘，不走自动保存）
      async function doRestoreHistory() {
        const id = selectedRef.current
        const ts0 = histSel
        if (histPending || !ts0 || !id) return
        if (!window.confirm('恢复到 ' + fmtHistTs(ts0) + ' 的版本？\n当前版本会先自动快照进历史版本，可再撤销（重新打开历史恢复回滚）。')) return
        setHistPending(true); setError('')
        try {
          const res = await rpc('notes-restore-history', { id: id, ts: ts0 })
          if (res && res.error) { setError(res.error); return }
          setHistOpen(false)
          // 恢复已由 host 落盘（恢复前当前版已自动快照）：本地只回填编辑器，不触发自动保存
          const g = await rpc('notes-get', { id: id })
          if (g && g.note && selectedRef.current === id) panelBridge.applyRestoredBody(id, g.note.body || '')
          await panelBridge.loadNotes(true); notifyNotesChanged()
          panelBridge.probeHistCount(id)   // 恢复前置快照使版本数 +1，重探刷新入口计数
          showToast('已恢复到 ' + fmtHistTs(ts0) + ' 的版本（原当前版已自动快照，可再恢复回滚）')
        } catch (err) { setError(String(err.message || err)) } finally { setHistPending(false) }
      }
      return histOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setHistOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-hist-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('clock', 14), ' 历史版本', e('span', { className: 'dsh-notes-imgup-sub' }, '每次保存自动留快照 · 恢复前当前版本会先自动快照，可再撤销')),
          e('div', { className: 'dsh-notes-hist-body' },
            e('div', { className: 'dsh-notes-hist-list' },
              histList === null
                ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
                : !histList.length
                  ? e('div', { className: 'dsh-notes-data-hint' }, '暂无历史版本（每次保存自动留快照）')
                  : histList.map(v => e('div', { key: v.ts, className: 'dsh-notes-hist-item' + (histSel === v.ts ? ' on' : ''), onClick: () => selectHistVersion(v.ts) },
                      e('div', { className: 'dsh-notes-hist-item-t' }, fmtHistTs(v.ts)),
                      e('div', { className: 'dsh-notes-hist-item-b' }, fmtBytes(v.bytes))))),
            e('div', { className: 'dsh-notes-hist-view' },
              !histSel
                ? e('div', { className: 'dsh-notes-data-hint' }, '选择左侧版本查看预览（只读）')
                : histPreview
                  ? e('div', { className: 'dsh-notes-hist-preview dsh-notes-rich', dangerouslySetInnerHTML: { __html: renderMarkdown(histPreview.body, wikiResolve) } })
                  : e('div', { className: 'dsh-notes-data-hint' }, '预览加载中…'))),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setHistOpen(false) }, '关闭'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doRestoreHistory, disabled: histPending || !histSel }, histPending ? '恢复中…' : '恢复此版本'))))
      : null
    }
    // ===== modal: trash —— 回收站（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.trash / trashOpenRef / setTrashOpen / setTrashList / setTrashPending / setTrashSel / setTrashPreview / openTrash / loadTrash / TrashModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）、
    //        editor-kernel.js（renderMarkdown）+ kernel 转发别名 wikiResolve（行内预览只读渲染）
    // state 托管：open/list/pending/sel/preview 迁入 store.modal.trash 切片；trashOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 列表刷新/文件夹计数刷新属面板域（滞留 whole.js），经 panelBridge 中转
    store.modal.trash = createStore({ open: false, list: null, pending: '', sel: {}, preview: null })
    const trashOpenRef = { current: false }   // 回收站对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setTrashOpen(v) { const nv = typeof v === 'function' ? v(trashOpenRef.current) : v; trashOpenRef.current = nv; store.modal.trash.set({ open: nv }) }
    function setTrashList(v) { store.modal.trash.set({ list: typeof v === 'function' ? v(store.modal.trash.get().list) : v }) }
    function setTrashPending(v) { store.modal.trash.set({ pending: typeof v === 'function' ? v(store.modal.trash.get().pending) : v }) }
    function setTrashSel(v) { store.modal.trash.set({ sel: typeof v === 'function' ? v(store.modal.trash.get().sel) : v }) }
    function setTrashPreview(v) { store.modal.trash.set({ preview: typeof v === 'function' ? v(store.modal.trash.get().preview) : v }) }
    // ===== P1 回收站（侧栏底部「回收站」入口）：notes-list {includeDeleted:true} 过滤 deleted → 恢复（notes-restore）/ 彻底删除（notes-purge）=====
    // 彻底删除双确认：点「彻底删除」→ window.confirm「彻底删除不可恢复」确认才执行；host 侧安全闸只接受已软删除的笔记
    // 确认强度 = 不可恢复性（notes-034-c-confirm）：purge 不可恢复 → 重（双确认保留）；软删可恢复 → 轻（列表侧删除已无 confirm，撤销 toast 兜底）
    function openTrash() {
      setTrashList(null); setTrashPending(''); setTrashSel({}); setTrashPreview(null); setError('')
      panelBridge.setSettingsOpen(false); setTrashOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
      loadTrash()
    }
    function loadTrash() {
      rpc('notes-list', { includeDeleted: true }).then(res => {
        if (res && res.error) { setError(res.error); setTrashList([]); return }
        const del = ((res && res.notes) || []).filter(n => n.deleted === true)
        del.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))   // 删除时间（updatedAt 近似）降序
        setTrashList(del)
        // 列表刷新后清洗勾选/预览态：已不在回收站的 id 剔除（单条恢复/彻底删除后残留勾选会误伤后续批量操作）
        const alive = {}
        del.forEach(n => { alive[n.id] = true })
        setTrashSel(prev => { const nx = {}; let changed = false; for (const id of Object.keys(prev)) { if (alive[id]) nx[id] = true; else changed = true } return changed ? nx : prev })
        setTrashPreview(prev => (prev && !alive[prev.id]) ? null : prev)
      }).catch(err => { setError(String(err.message || err)); setTrashList([]) })
    }
    // 回收站对话框宿主（复用归档预览的列表样式）
    function TrashModal(props) {
      const tt = useT()   // i18n 覆盖卡E：订阅 langStore，切语言本卡自渲染（模块级 handler 走 t() 直读当下语言态）
      const trashOpen = store.modal.trash.useSel(s => s.open)
      const trashList = store.modal.trash.useSel(s => s.list)
      const trashPending = store.modal.trash.useSel(s => s.pending)
      const trashSel = store.modal.trash.useSel(s => s.sel)
      const trashPreview = store.modal.trash.useSel(s => s.preview)
      const error = props.error
      async function doTrashRestore(id) {
        if (!id || trashPending) return
        setTrashPending(id); setError('')
        try {
          const res = await rpc('notes-restore', { id: id })
          if (res && res.error) { setError(res.error); return }
          showToast(t('meta.restored'))
          loadTrash(); await panelBridge.loadNotes(true); panelBridge.loadFolders(); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) } finally { setTrashPending('') }
      }
      async function doTrashPurge(id, title) {
        if (!id || trashPending) return
        if (!window.confirm(t('trash.purgeConfirm', { title: title || id }))) return
        setTrashPending(id); setError('')
        try {
          const res = await rpc('notes-purge', { id: id })
          if (res && res.error) { setError(res.error); return }
          showToast(t('trash.purged'))
          loadTrash(); await panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) } finally { setTrashPending('') }
      }
      // ===== 回收站增强（notes-trash-batch-preview）：批量选择/全选 + 批量恢复/批量彻底删除 + 行内容只读预览 =====
      // 行勾选/全选（trashSel: id→true；全选 = 当前列表全部勾选时再点则清空）
      function toggleTrashSel(id) { setTrashSel(prev => { const nx = Object.assign({}, prev); if (nx[id]) delete nx[id]; else nx[id] = true; return nx }) }
      function toggleTrashAll() {
        const list = trashList || []
        const all = list.length > 0 && list.every(n => trashSel[n.id])
        const nx = {}
        if (!all) list.forEach(n => { nx[n.id] = true })
        setTrashSel(nx)
      }
      // 行预览：notes-get {id, includeDeleted:true} 取已删正文（host includeDeleted 路径，墓碑仍拒绝）→ renderMarkdown 只读渲染（esc 先行零注入面）；再点收起
      function toggleTrashPreview(id) {
        if (trashPreview && trashPreview.id === id) { setTrashPreview(null); return }
        setTrashPreview({ id: id, body: null, error: '' })
        rpc('notes-get', { id: id, includeDeleted: true }).then(res => {
          if (res && res.note && typeof res.note.body === 'string') setTrashPreview(prev => (prev && prev.id === id) ? { id: id, body: res.note.body, error: '' } : prev)
          else setTrashPreview(prev => (prev && prev.id === id) ? { id: id, body: null, error: t('trash.previewFailed', { msg: (res && res.error) || t('trash.noBody') }) } : prev)
        }).catch(err => setTrashPreview(prev => (prev && prev.id === id) ? { id: id, body: null, error: t('trash.previewFailed', { msg: String(err.message || err) }) } : prev))
      }
      // 批量恢复：confirm 后逐条 notes-restore（单条失败计数不中断）；完成后清空勾选/预览 + 刷新
      async function doTrashRestoreBatch() {
        const ids = Object.keys(trashSel)
        if (!ids.length || trashPending) return
        if (!window.confirm(t('trash.restoreBatchConfirm', { n: ids.length }))) return
        setTrashPending('batch'); setError('')
        let ok = 0, fail = 0
        for (const id of ids) {
          try { const res = await rpc('notes-restore', { id: id }); if (res && res.error) fail++; else ok++ }
          catch (err) { fail++ }
        }
        setTrashPending(''); setTrashSel({}); setTrashPreview(null)
        showToast(t('common.restoredBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''))
        loadTrash(); await panelBridge.loadNotes(true); panelBridge.loadFolders(); notifyNotesChanged()
      }
      // 批量彻底删除：confirm 双确认（「不可恢复 + 含历史版本」+ 条数，与单条同口径）→ 逐条 notes-purge（host 安全闸仅限已软删除）
      async function doTrashPurgeBatch() {
        const ids = Object.keys(trashSel)
        if (!ids.length || trashPending) return
        if (!window.confirm(t('trash.purgeBatchConfirm', { n: ids.length }))) return
        setTrashPending('batch'); setError('')
        let ok = 0, fail = 0
        for (const id of ids) {
          try { const res = await rpc('notes-purge', { id: id }); if (res && res.error) fail++; else ok++ }
          catch (err) { fail++ }
        }
        setTrashPending(''); setTrashSel({}); setTrashPreview(null)
        showToast(t('trash.purgedBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''))
        loadTrash(); await panelBridge.loadNotes(true); notifyNotesChanged()
      }
      // P1 回收站对话框（侧栏底部「回收站」入口；复用归档预览的列表样式）：
      // 批量操作条（全选 + 选中计数 + 恢复所选/彻底删除所选）+ 行 = 勾选框 + 标题（点击展开只读预览）+ 删除时间 + 预览/恢复/彻底删除；
      // 彻底删除 confirm 双确认（不可恢复）；批量彻底删除同口径文案 + 条数 + 含历史版本；
      // 行预览 = notes-get {id, includeDeleted:true} 取已删正文 → renderMarkdown 只读渲染（内核全量转义，esc 先行零注入面）
      return trashOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !trashPending) setTrashOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal dsh-notes-trash-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('trash', 14), ' ' + tt('topbar.trash'), e('span', { className: 'dsh-notes-imgup-sub' }, tt('trash.sub'))),
          trashList === null
            ? e('div', { className: 'dsh-notes-data-hint' }, tt('common.loading'))
            : trashList.length === 0
              ? e('div', { className: 'dsh-notes-data-hint' }, tt('trash.empty'))
              : e(React.Fragment, null,
                  e('div', { className: 'dsh-notes-trash-batch' },
                    e('label', { className: 'dsh-notes-trash-all' },
                      e('input', { type: 'checkbox', className: 'dsh-notes-trash-check', checked: trashList.length > 0 && trashList.every(n => trashSel[n.id]), disabled: !!trashPending, onChange: toggleTrashAll }),
                      tt('inj.selectAll')),
                    e('span', { className: 'dsh-notes-trash-selcnt' }, tt('sel.selCount', { n: Object.keys(trashSel).length })),
                    e('button', { className: 'dsh-notes-trash-act', onClick: doTrashRestoreBatch, disabled: !!trashPending || Object.keys(trashSel).length < 1 }, tt('trash.restoreSel')),
                    e('button', { className: 'dsh-notes-trash-act danger', onClick: doTrashPurgeBatch, disabled: !!trashPending || Object.keys(trashSel).length < 1 }, tt('trash.purgeSel'))),
                  e('div', { className: 'dsh-notes-arch-list' },
                    trashList.map(n => e('div', { key: n.id },
                      e('div', { className: 'dsh-notes-arch-row' },
                        e('input', { type: 'checkbox', className: 'dsh-notes-trash-check', checked: !!trashSel[n.id], disabled: !!trashPending, onChange: () => toggleTrashSel(n.id) }),
                        e('span', { className: 'dsh-notes-arch-ti dsh-notes-trash-ti', title: tt('trash.titleTip', { title: n.title || 'Untitled' }), onClick: () => toggleTrashPreview(n.id) }, n.title || 'Untitled'),
                        e('span', { className: 'dsh-notes-arch-meta' }, tt('trash.deletedAt', { time: n.updatedAt ? fmtDT(n.updatedAt).slice(0, 10) : '—' })),
                        e('button', { className: 'dsh-notes-trash-act', onClick: () => toggleTrashPreview(n.id), disabled: !!trashPending }, trashPreview && trashPreview.id === n.id ? tt('trash.collapse') : tt('trash.preview')),
                        e('button', { className: 'dsh-notes-trash-act', onClick: () => doTrashRestore(n.id), disabled: !!trashPending }, tt('trash.restore')),
                        e('button', { className: 'dsh-notes-trash-act danger', onClick: () => doTrashPurge(n.id, n.title), disabled: !!trashPending }, tt('trash.purge'))),
                      // 行内只读预览：正文只经 renderMarkdown 内核渲染（全量转义零注入面）；加载/错误态走 React 文本插值（自动转义）
                      trashPreview && trashPreview.id === n.id
                        ? (typeof trashPreview.body === 'string'
                            ? e('div', { className: 'dsh-notes-trash-preview dsh-notes-rich', dangerouslySetInnerHTML: { __html: renderMarkdown(trashPreview.body, wikiResolve) } })
                            : e('div', { className: 'dsh-notes-data-hint' }, trashPreview.error || tt('trash.previewLoading')))
                        : null)))),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setTrashOpen(false), disabled: !!trashPending }, tt('common.close')))))
      : null
    }
    // ===== modal: prune —— 孤儿资产清理弹窗（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.prune / pruneOpenRef / setPruneOpen / setPruneData / setPruneChecked / setPrunePending / openPrune / PruneModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/format.js（fmtBytes）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：open/data/checked/pending 迁入 store.modal.prune 切片；pruneOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 与设置卡片互斥经 panelBridge.setSettingsOpen 中转（设置卡滞留 whole.js，D2 再迁）
    store.modal.prune = createStore({ open: false, data: null, checked: {}, pending: false })
    const pruneOpenRef = { current: false }   // 资产清理对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setPruneOpen(v) { const nv = typeof v === 'function' ? v(pruneOpenRef.current) : v; pruneOpenRef.current = nv; store.modal.prune.set({ open: nv }) }
    function setPruneData(v) { store.modal.prune.set({ data: typeof v === 'function' ? v(store.modal.prune.get().data) : v }) }
    function setPruneChecked(v) { store.modal.prune.set({ checked: typeof v === 'function' ? v(store.modal.prune.get().checked) : v }) }
    function setPrunePending(v) { store.modal.prune.set({ pending: typeof v === 'function' ? v(store.modal.prune.get().pending) : v }) }
    // ===== 二期 孤儿资产清理（设置卡片「资产清理」入口）：dry-run 预览（零写入）→ 勾选 → 白名单执行 =====
    // 契约：notes-assets-prune 缺省 dryRun=true 返回 { orphans:[{name,bytes}], totalBytes, referenced, tombstoned, notes }；
    // 执行 dryRun:false + files 白名单（host 调用内重扫实时孤儿防漂移；软删除笔记的引用也计入保护，宁留勿删）。
    function openPrune() {
      setPruneData(null); setPruneChecked({}); setPrunePending(false); setError('')
      panelBridge.setSettingsOpen(false); setPruneOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
      rpc('notes-assets-prune', { dryRun: true }).then(res => {
        if (res && res.error) { setError(res.error); setPruneData({ orphans: [], totalBytes: 0 }); return }
        setPruneData(res || { orphans: [], totalBytes: 0 })
      }).catch(err => { setError(String(err.message || err)); setPruneData({ orphans: [], totalBytes: 0 }) })
    }
    // 资产清理对话框宿主（设置卡片「资产清理」入口；复用归档预览的列表样式）
    function PruneModal(props) {
      const pruneOpen = store.modal.prune.useSel(s => s.open)
      const pruneData = store.modal.prune.useSel(s => s.data)
      const pruneChecked = store.modal.prune.useSel(s => s.checked)
      const prunePending = store.modal.prune.useSel(s => s.pending)
      const error = props.error
      async function doPruneConfirm() {
        const orphans = (pruneData && pruneData.orphans) || []
        const files = orphans.filter(o => pruneChecked[o.name] !== false).map(o => o.name)
        if (!files.length || prunePending) return
        setPrunePending(true)
        try {
          const res = await rpc('notes-assets-prune', { dryRun: false, files: files })
          if (res && res.error) { setError(res.error); setPrunePending(false); return }
          setPruneOpen(false); setPrunePending(false)
          showToast('已清理 ' + ((res.deleted || []).length) + ' 个孤儿资产，释放 ' + fmtBytes(res.freedBytes || 0) + ((res.modes && res.modes.tombstoned) ? '（开发版为清空占位）' : ''))
        } catch (err) { setError(String(err.message || err)); setPrunePending(false) }
      }
      // 资产清理对话框（设置卡片「资产清理」入口；复用归档预览的列表样式）：dry-run 孤儿清单默认全勾，
      // 行 = 复选框 + 文件名 + 字节数；底部统计扫描笔记数/引用中/墓碑；「删除所选（N 项 · x KB）」danger 确认才执行
      return pruneOpen ? (() => {
        const orphans = (pruneData && pruneData.orphans) || []
        const checked = orphans.filter(o => pruneChecked[o.name] !== false)
        const checkedBytes = checked.reduce((s, o) => s + (o.bytes || 0), 0)
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !prunePending) setPruneOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('trash', 14), ' 资产清理', e('span', { className: 'dsh-notes-imgup-sub' }, '预览勾选后才删除 · 宁留勿删')),
            e('div', { className: 'dsh-notes-data-hint' }, 'assets/ 中未被任何笔记正文引用的文件（已删除笔记的引用仍计入保护）。' + (pruneData && pruneData.notes != null ? '已扫描 ' + pruneData.notes + ' 条笔记：引用中 ' + (pruneData.referenced || 0) + ' 个，历史清理占位 ' + (pruneData.tombstoned || 0) + ' 个。' : '')),
            pruneData === null
              ? e('div', { className: 'dsh-notes-data-hint' }, '扫描中…')
              : orphans.length === 0
                ? e('div', { className: 'dsh-notes-data-hint' }, '没有孤儿资产（assets/ 全部文件均被引用）。')
                : e('div', { className: 'dsh-notes-arch-list' },
                    orphans.map(o => e('div', { key: o.name, className: 'dsh-notes-arch-row' },
                      e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: pruneChecked[o.name] !== false, onChange: () => setPruneChecked(Object.assign({}, pruneChecked, { [o.name]: pruneChecked[o.name] === false })) }),
                      e('span', { className: 'dsh-notes-arch-ti', title: o.name }, o.name),
                      e('span', { className: 'dsh-notes-arch-meta' }, fmtBytes(o.bytes))))),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setPruneOpen(false), disabled: prunePending }, '取消'),
              e('button', { className: 'dsh-notes-data-danger', onClick: doPruneConfirm, disabled: prunePending || checked.length === 0 }, prunePending ? '删除中…' : '删除所选（' + checked.length + ' 项 · ' + fmtBytes(checkedBytes) + '）'))))
      })()
      : null
    }
    // ===== modal: archive —— 归档预览对话框（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.archive / archOpenRef / setArchOpen / setArchGroups / setArchChecked / setArchExpand / setArchPending / openArchive / ArchiveModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/format.js（fmtBytes）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）
    // state 托管：open/groups/checked/expand/pending 迁入 store.modal.archive 切片；archOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 归档后清理 afterArchiveCleanup 属面板多选/选中域（滞留 whole.js），经 panelBridge 中转；
    // doArchiveUndo 在本组件渲染期回填 panelBridge——merge modal 的撤销 toast 经 kernel 转发别名调最新实例（禁横向引用）
    store.modal.archive = createStore({ open: false, groups: null, checked: {}, expand: {}, pending: false })
    const archOpenRef = { current: false }   // 归档预览对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setArchOpen(v) { const nv = typeof v === 'function' ? v(archOpenRef.current) : v; archOpenRef.current = nv; store.modal.archive.set({ open: nv }) }
    function setArchGroups(v) { store.modal.archive.set({ groups: typeof v === 'function' ? v(store.modal.archive.get().groups) : v }) }
    function setArchChecked(v) { store.modal.archive.set({ checked: typeof v === 'function' ? v(store.modal.archive.get().checked) : v }) }
    function setArchExpand(v) { store.modal.archive.set({ expand: typeof v === 'function' ? v(store.modal.archive.get().expand) : v }) }
    function setArchPending(v) { store.modal.archive.set({ pending: typeof v === 'function' ? v(store.modal.archive.get().pending) : v }) }
    // 打开归档预览（替代旧的直接执行）：dry-run 拉速记组（notes-archive-preview 零写入），默认全勾
    async function openArchive() {
      setError(''); setArchOpen(true); setArchGroups(null); setArchChecked({}); setArchExpand({}); setArchPending(false)
      try {
        const res = await rpc('notes-archive-preview')
        if (res && res.error) { setError(res.error); setArchGroups([]); return }
        setArchGroups((res && res.quickGroups) || [])
      } catch (err) { setError(String(err.message || err)); setArchGroups([]) }
    }
    // 归档预览对话框宿主（标题栏「归档」入口）
    function ArchiveModal(props) {
      const tt = useT()   // i18n 覆盖卡E：订阅 langStore，切语言本卡自渲染（模块级 handler 走 t() 直读当下语言态）
      const archOpen = store.modal.archive.useSel(s => s.open)
      const archGroups = store.modal.archive.useSel(s => s.groups)
      const archChecked = store.modal.archive.useSel(s => s.checked)
      const archExpand = store.modal.archive.useSel(s => s.expand)
      const archPending = store.modal.archive.useSel(s => s.pending)
      const error = props.error
      // 撤销最近一次归档（undo 事务文件）：归档笔记软删 + 成员批量恢复
      async function doArchiveUndo() {
        try {
          const res = await rpc('notes-archive-undo')
          if (res && res.error) { setError(res.error); return }
          showToast(res && res.undone ? t('arch.undone') : t('arch.noUndo'))
          await panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) }
      }
      // 回填 panelBridge：本组件卸载/面板关闭后 toast「撤销」仍可调（bridge 持有最近一次渲染的实例，与昔日闭包捕获语义等价）
      panelBridge.doArchiveUndo = doArchiveUndo
      // 确认归档：勾选组 → notes-archive 白名单组（host 先全量校验再动手）→ toast「已合并 N 组」+ 撤销按钮
      async function doArchiveConfirm() {
        const gs = (archGroups || []).filter(g => archChecked[g.sessionId] !== false)
        if (!gs.length || archPending) return
        setArchPending(true)
        try {
          // payload 禁 undefined：白名单组不带 title（用 host 默认标题规则）
          const res = await rpc('notes-archive', { groups: gs.map(g => ({ memberIds: g.members.map(m => m.id) })) })
          if (res && res.error) { setError(res.error); setArchPending(false); return }
          setArchOpen(false); setArchPending(false)
          showToast(t('arch.merged', { n: res.merged || 0 }), { label: t('meta.undo'), fn: doArchiveUndo })
          panelBridge.afterArchiveCleanup(gs.reduce((acc, g) => acc.concat(g.members.map(m => m.id)), []))
          await panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)); setArchPending(false) }
      }
      // 归档预览对话框（标题栏「归档」→ notes-archive-preview dry-run，零写入）：速记组列表默认全勾——
      // 组行 = 复选框 + 展开 caret + 组标题 + dateSpan · N 条 · totalBytes；caret 展开成员明细（标题+日期）；
      // 底部提示手动笔记走多选合并；「归档所选（N 组）」确认才执行（notes-archive 白名单组）
      return archOpen ? (() => {
        const groups = archGroups || []
        const checkedCount = groups.filter(g => archChecked[g.sessionId] !== false).length
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setArchOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('check', 14), ' ' + tt('arch.title'), e('span', { className: 'dsh-notes-imgup-sub' }, tt('arch.sub'))),
            e('div', { className: 'dsh-notes-data-hint' }, tt('arch.hintClient')),
            archGroups === null
              ? e('div', { className: 'dsh-notes-data-hint' }, tt('common.loading'))
              : groups.length === 0
                ? e('div', { className: 'dsh-notes-data-hint' }, tt('arch.empty'))
                : e('div', { className: 'dsh-notes-arch-list' },
                    groups.map(g => {
                      const checked = archChecked[g.sessionId] !== false
                      const expanded = archExpand[g.sessionId] === true
                      const span = g.dateSpan && g.dateSpan.from ? (g.dateSpan.from === g.dateSpan.to ? g.dateSpan.from : g.dateSpan.from + ' ~ ' + g.dateSpan.to) : ''
                      return e('div', { key: g.sessionId, className: 'dsh-notes-arch-group' + (checked ? '' : ' off') },
                        e('div', { className: 'dsh-notes-arch-row' },
                          e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: checked, onChange: () => setArchChecked(Object.assign({}, archChecked, { [g.sessionId]: !checked })) }),
                          e('span', { className: 'dsh-notes-caret' + (expanded ? ' open' : ''), onClick: () => setArchExpand(Object.assign({}, archExpand, { [g.sessionId]: !expanded })) }, I('chev', 10)),
                          e('span', { className: 'dsh-notes-arch-ti', title: g.title }, g.title),
                          e('span', { className: 'dsh-notes-arch-meta' }, tt('arch.groupMeta', { span: span, n: g.members.length, size: fmtBytes(g.totalBytes) }) + ((g.totalUseCount || 0) > 0 ? tt('arch.groupUseCount', { n: g.totalUseCount }) : ''))),
                        expanded ? e('div', { className: 'dsh-notes-arch-members' },
                          g.members.map(m => e('div', { key: m.id, className: 'dsh-notes-arch-member' },
                            e('span', { className: 'dsh-notes-arch-member-ti' }, m.title || tt('tree.untitled')),
                            e('span', { className: 'dsh-notes-arch-member-dt' }, fmtDT(m.updatedAt).slice(0, 10))))) : null)
                    })),
            e('div', { className: 'dsh-notes-data-hint' }, tt('arch.manualHint')),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setArchOpen(false) }, tt('common.cancel')),
              e('button', { className: 'dsh-notes-dispatch-ok', onClick: doArchiveConfirm, disabled: archPending || checkedCount === 0 }, archPending ? tt('arch.archiving') : tt('arch.okCount', { n: checkedCount })))))
      })()
      : null
    }
    // ===== modal: export —— 导出全部笔记对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.export / exportOpenRef / setExportOpen / setExportDir / setExportPending / openExport / doExport / ExportModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：open/dir/pending 迁入 store.modal.export 切片；exportOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 与设置卡片互斥经 panelBridge.setSettingsOpen 中转（禁横向引用）
    store.modal.export = createStore({ open: false, dir: '', pending: false })
    const exportOpenRef = { current: false }   // 导出对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setExportOpen(v) { const nv = typeof v === 'function' ? v(exportOpenRef.current) : v; exportOpenRef.current = nv; store.modal.export.set({ open: nv }) }
    function setExportDir(v) { store.modal.export.set({ dir: typeof v === 'function' ? v(store.modal.export.get().dir) : v }) }
    function setExportPending(v) { store.modal.export.set({ pending: typeof v === 'function' ? v(store.modal.export.get().pending) : v }) }
    // ===== 数据导入/导出（设置卡片「数据」区入口）=====
    // 导出：打开对话框时回填上次导出目录（localStorage 记忆）；确认 → notes-export → toast 含快照目录路径
    function openExport() {
      let last = ''
      try { last = localStorage.getItem('dsh-notes-last-export-dir') || '' } catch (err) {}
      setExportDir(last); setExportPending(false); setError('')
      panelBridge.setSettingsOpen(false); setExportOpen(true)   // 与设置卡片互斥：modal 不叠 modal
    }
    // 导出对话框宿主（设置卡片「数据」区入口；mask/modal 复用设置卡片风格）：选目标目录 → notes-export → 成功 toast 含快照路径
    function ExportModal(props) {
      const exportOpen = store.modal.export.useSel(s => s.open)
      const exportDir = store.modal.export.useSel(s => s.dir)
      const exportPending = store.modal.export.useSel(s => s.pending)
      const error = props.error
      async function doExport() {
        const dir = exportDir.trim()
        if (!dir || exportPending) return
        setExportPending(true); setError('')
        try {
          const res = await rpc('notes-export', { dir: dir })   // payload 不传 undefined 字段
          if (res && res.error) { setError(res.error); return }
          try { localStorage.setItem('dsh-notes-last-export-dir', dir) } catch (err) {}
          setExportOpen(false)
          showToast('已导出 ' + (res.exported || 0) + ' 条笔记到 ' + (res.target || dir))
        } catch (err) { setError(String(err.message || err)) } finally { setExportPending(false) }
      }
      return exportOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setExportOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('up', 14), ' 导出全部笔记'),
          e('div', { className: 'dsh-notes-data-hint' }, '把整个笔记库（含 folders.json）完整快照到目标目录下的 dsh-notes-export-<时间戳> 子目录，不打包不压缩，目录即格式。'),
          e('input', { className: 'dsh-notes-data-input', placeholder: '目标目录，如 D:\\backup 或桌面路径…', value: exportDir, autoFocus: true, onChange: (ev) => setExportDir(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doExport() } } }),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setExportOpen(false) }, '取消'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doExport, disabled: exportPending || !exportDir.trim() }, exportPending ? '导出中…' : '导出'))))
      : null
    }
    // ===== modal: export-single —— 单文件导出对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.exportSingle / sExportOpenRef / setSExportOpen / setSExportDir / setSExportScope / setSExportFolder / setSExportTag / setSExportToc / setSExportPending / openSExport / SExportModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：open/dir/scope/folder/tag/toc/pending 迁入 store.modal.exportSingle 切片；sExportOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 标签/文件夹选项数据源（notes/folders）属面板域，经 props 注入（禁横向引用）；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.exportSingle = createStore({ open: false, dir: '', scope: 'all', folder: '', tag: '', toc: true, pending: false })
    const sExportOpenRef = { current: false }   // P3 单文件导出对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setSExportOpen(v) { const nv = typeof v === 'function' ? v(sExportOpenRef.current) : v; sExportOpenRef.current = nv; store.modal.exportSingle.set({ open: nv }) }
    function setSExportDir(v) { store.modal.exportSingle.set({ dir: typeof v === 'function' ? v(store.modal.exportSingle.get().dir) : v }) }
    function setSExportScope(v) { store.modal.exportSingle.set({ scope: typeof v === 'function' ? v(store.modal.exportSingle.get().scope) : v }) }
    function setSExportFolder(v) { store.modal.exportSingle.set({ folder: typeof v === 'function' ? v(store.modal.exportSingle.get().folder) : v }) }
    function setSExportTag(v) { store.modal.exportSingle.set({ tag: typeof v === 'function' ? v(store.modal.exportSingle.get().tag) : v }) }
    function setSExportToc(v) { store.modal.exportSingle.set({ toc: typeof v === 'function' ? v(store.modal.exportSingle.get().toc) : v }) }
    function setSExportPending(v) { store.modal.exportSingle.set({ pending: typeof v === 'function' ? v(store.modal.exportSingle.get().pending) : v }) }
    // P3 单文件导出（设置卡片「数据」区入口；复用导出 modal 模式）：选 scope（全部/文件夹/标签）+ 目录 → notes-export-single → toast 含文件路径（>20MB 带 warning）
    function openSExport() {
      let last = ''
      try { last = localStorage.getItem('dsh-notes-last-export-single-dir') || '' } catch (err) {}
      setSExportDir(last); setSExportScope('all'); setSExportFolder(''); setSExportTag(''); setSExportToc(true); setSExportPending(false); setError('')
      panelBridge.setSettingsOpen(false); setSExportOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
    }
    // P3 单文件导出对话框宿主（设置卡片「数据」区「导出单文件…」入口；mask/modal 复用导出对话框风格）：
    // scope 三选一（全部/文件夹/标签，联动下拉）+ 目录页开关 + 目标目录 → notes-export-single → toast 含文件路径（>20MB 带 warning）
    function SExportModal(props) {
      const sExportOpen = store.modal.exportSingle.useSel(s => s.open)
      const sExportDir = store.modal.exportSingle.useSel(s => s.dir)
      const sExportScope = store.modal.exportSingle.useSel(s => s.scope)
      const sExportFolder = store.modal.exportSingle.useSel(s => s.folder)
      const sExportTag = store.modal.exportSingle.useSel(s => s.tag)
      const sExportToc = store.modal.exportSingle.useSel(s => s.toc)
      const sExportPending = store.modal.exportSingle.useSel(s => s.pending)
      const error = props.error
      const notes = props.notes || []
      const folders = props.folders || []
      async function doSExport() {
        const dir = sExportDir.trim()
        if (!dir || sExportPending) return
        if (sExportScope === 'folder' && !sExportFolder) { setError('请选择文件夹'); return }
        if (sExportScope === 'tag' && !sExportTag) { setError('请选择标签'); return }
        setSExportPending(true); setError('')
        try {
          const scope = sExportScope === 'folder' ? { folder: sExportFolder } : (sExportScope === 'tag' ? { tag: sExportTag } : { all: true })
          const res = await rpc('notes-export-single', { dir: dir, scope: scope, format: 'md', toc: sExportToc })   // payload 不传 undefined 字段
          if (res && res.error) { setError(res.error); return }
          try { localStorage.setItem('dsh-notes-last-export-single-dir', dir) } catch (err) {}
          setSExportOpen(false)
          showToast('已导出 ' + (res.exported || 0) + ' 篇到 ' + (res.target || dir) + (res.warning ? '；⚠ ' + res.warning : ''))
        } catch (err) { setError(String(err.message || err)) } finally { setSExportPending(false) }
      }
      return sExportOpen ? (() => {
        const tagSet = {}
        for (const n of notes) for (const tg of (n.tags || [])) tagSet[tg] = true
        const tagOptions = Object.keys(tagSet).sort()
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setSExportOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('note', 14), ' 导出单文件'),
            e('div', { className: 'dsh-notes-data-hint' }, '把所选范围的笔记拼接为单个 Markdown 文件（每篇 = 标题 + 元信息 + 正文，篇间分隔线）：图片 base64 内联、零外部依赖，可直接分享。超过 20MB 会告警但仍照常导出。'),
            e('div', { className: 'dsh-notes-dispatch-modes' },
              [['all', '全部'], ['folder', '按文件夹'], ['tag', '按标签']].map(pair => e('button', { key: pair[0], className: 'dsh-notes-dispatch-mode' + (sExportScope === pair[0] ? ' on' : ''), onClick: () => setSExportScope(pair[0]) }, pair[1]))),
            sExportScope === 'folder' ? e('select', { className: 'dsh-notes-dispatch-select', value: sExportFolder, onChange: (ev) => setSExportFolder(ev.target.value) },
              e('option', { value: '' }, '选择文件夹…'),
              folders.map(f => e('option', { key: f.id, value: f.id }, f.name + '（' + (f.count || 0) + '）')))
            : null,
            sExportScope === 'tag' ? e('select', { className: 'dsh-notes-dispatch-select', value: sExportTag, onChange: (ev) => setSExportTag(ev.target.value) },
              e('option', { value: '' }, tagOptions.length ? '选择标签…' : '（笔记暂无标签）'),
              tagOptions.map(tg => e('option', { key: tg, value: tg }, tg)))
            : null,
            e('label', { className: 'dsh-notes-settings-checkwrap dsh-nt', 'data-tooltip': '在文档头部生成目录页（篇名 + id 清单）' },
              e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: sExportToc, onChange: (ev) => setSExportToc(!!ev.target.checked) }),
              '生成目录页'),
            e('input', { className: 'dsh-notes-data-input', placeholder: '目标目录，如 D:\\backup 或桌面路径…', value: sExportDir, autoFocus: true, onChange: (ev) => setSExportDir(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doSExport() } } }),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setSExportOpen(false) }, '取消'),
              e('button', { className: 'dsh-notes-dispatch-ok', onClick: doSExport, disabled: sExportPending || !sExportDir.trim() || (sExportScope === 'folder' && !sExportFolder) || (sExportScope === 'tag' && !sExportTag) }, sExportPending ? '导出中…' : '导出'))))
      })()
      : null
    }
    // ===== modal: import —— 导入笔记对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.import / importOpenRef / setImportOpen / setImportDir / setImportPreview / setImportOverwrite / setImportPending / openImport / ImportModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）
    // state 托管：open/dir/preview/overwrite/pending 迁入 store.modal.import 切片；importOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 导入完成后列表/文件夹刷新经 panelBridge.loadNotes/loadFolders 中转；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.import = createStore({ open: false, dir: '', preview: null, overwrite: false, pending: false })
    const importOpenRef = { current: false }   // 导入对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setImportOpen(v) { const nv = typeof v === 'function' ? v(importOpenRef.current) : v; importOpenRef.current = nv; store.modal.import.set({ open: nv }) }
    function setImportDir(v) { store.modal.import.set({ dir: typeof v === 'function' ? v(store.modal.import.get().dir) : v }) }
    function setImportPreview(v) { store.modal.import.set({ preview: typeof v === 'function' ? v(store.modal.import.get().preview) : v }) }
    function setImportOverwrite(v) { store.modal.import.set({ overwrite: typeof v === 'function' ? v(store.modal.import.get().overwrite) : v }) }
    function setImportPending(v) { store.modal.import.set({ pending: typeof v === 'function' ? v(store.modal.import.get().pending) : v }) }
    // 导入两步式：第一步选目录 → notes-import-preview 出预览；第二步勾选覆盖 → notes-import 执行
    function openImport() {
      setImportDir(''); setImportPreview(null); setImportOverwrite(false); setImportPending(false); setError('')
      panelBridge.setSettingsOpen(false); setImportOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
    }
    // 导入对话框宿主（两步式）：第一步选目录 → notes-import-preview 预览明细（新增/相同/不同 + 文件夹合并统计）；
    // 第二步勾选「覆盖内容不同的笔记」（默认不勾）→ danger 按钮执行 notes-import → toast 含备份目录提示 → 刷新列表/文件夹
    function ImportModal(props) {
      const importOpen = store.modal.import.useSel(s => s.open)
      const importDir = store.modal.import.useSel(s => s.dir)
      const importPreview = store.modal.import.useSel(s => s.preview)
      const importOverwrite = store.modal.import.useSel(s => s.overwrite)
      const importPending = store.modal.import.useSel(s => s.pending)
      const error = props.error
      async function doImportPreview() {
        const dir = importDir.trim()
        if (!dir || importPending) return
        setImportPending(true); setError('')
        try {
          const res = await rpc('notes-import-preview', { dir: dir })
          if (res && res.error) { setError(res.error); return }
          if (!res.total) { setError('该目录没有可导入的笔记：' + dir); return }
          setImportPreview(res); setImportOverwrite(false)   // 每次新预览重置覆盖勾选（默认不勾）
        } catch (err) { setError(String(err.message || err)) } finally { setImportPending(false) }
      }
      async function doImportExecute() {
        const dir = importDir.trim()
        if (!dir || !importPreview || importPending) return
        setImportPending(true); setError('')
        try {
          const res = await rpc('notes-import', { dir: dir, overwrite: !!importOverwrite })
          if (res && res.error) { setError(res.error); return }
          setImportOpen(false); setImportPreview(null)
          const got = (res.imported || 0) + (res.overwritten || 0)
          const skipped = (res.skippedSame || 0) + (res.skippedDiff || 0)
          const bak = String(res.backupDir || '').split(/[\\/]/).filter(Boolean).pop() || ''   // toast 只带备份目录名（全路径过长）
          showToast('已导入 ' + got + ' 条（跳过 ' + skipped + ' 条）' + (res.foldersMerged ? '，合并文件夹 ' + res.foldersMerged + ' 个' : '') + (bak ? '，已自动备份到 ' + bak : ''))
          await panelBridge.loadNotes(true); panelBridge.loadFolders(); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) } finally { setImportPending(false) }
      }
      return importOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setImportOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('down', 14), ' 导入笔记'),
          e('div', { className: 'dsh-notes-data-hint' }, '从目录快照导入（只增改不删）：库中不存在的直接入库，内容相同的跳过，内容不同的默认跳过；执行前自动全量备份当前库。'),
          e('input', { className: 'dsh-notes-data-input', placeholder: '来源目录（dsh-notes-export-… 或 notes-backup-… 目录）…', value: importDir, autoFocus: true, onChange: (ev) => { setImportDir(ev.target.value); if (importPreview) setImportPreview(null) }, onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doImportPreview() } } }),
          importPreview ? (() => {
            const IMP_STATUS_LABELS = { added: '新增', same: '相同', diff: '不同' }
            const folders = importPreview.folders || { total: 0, new: 0 }
            return e(React.Fragment, null,
              e('div', { className: 'dsh-notes-data-summary' },
                e('span', { className: 'added' }, '新增 ', e('b', null, importPreview.added)),
                e('span', null, '相同 ', e('b', null, importPreview.same)),
                e('span', { className: importPreview.diff ? 'diff' : '' }, '不同 ', e('b', null, importPreview.diff)),
                folders.total ? e('span', null, '文件夹新增 ', e('b', null, folders.new), ' / 共 ' + folders.total) : null),
              importPreview.unreadable ? e('div', { className: 'dsh-notes-data-warn' }, '⚠ ' + importPreview.unreadable + ' 个文件无法读取，已跳过') : null,
              e('div', { className: 'dsh-notes-imp-list' },
                (importPreview.detail || []).map(d => e('div', { key: d.id, className: 'dsh-notes-imp-row' },
                  e('span', { className: 'dsh-notes-imp-badge ' + d.status }, IMP_STATUS_LABELS[d.status] || d.status),
                  e('span', { className: 'dsh-notes-imp-title', title: d.title || 'Untitled' }, d.title || 'Untitled'),
                  d.deleted ? e('span', { className: 'dsh-notes-imp-deltag' }, '已删除') : null))),
              e('label', { className: 'dsh-notes-settings-checkwrap dsh-notes-imp-overwrite' + (importPreview.diff ? '' : ' off') },
                e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: importOverwrite, disabled: !importPreview.diff, onChange: (ev) => setImportOverwrite(!!ev.target.checked) }),
                '覆盖内容不同的笔记（' + importPreview.diff + ' 条，不勾则跳过）'),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setImportOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-data-danger', onClick: doImportExecute, disabled: importPending }, importPending ? '导入中…' : '执行导入')))
          })()
          : e(React.Fragment, null,
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setImportOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doImportPreview, disabled: importPending || !importDir.trim() }, importPending ? '检查中…' : '预览')))))
      : null
    }
    // ===== modal: inject-preview —— 注入预览对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.injectPreview / injectPreviewOpenRef / setInjectPreviewOpen / setInjectPreviewData / setInjectPreviewSid / openInjectPreview / loadInjectPreview / InjectPreviewModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：open/data/sid 迁入 store.modal.injectPreview 切片；injectPreviewOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 视角下拉数据源（sessList/sessPending）属面板域，经 props 注入（禁横向引用）；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.injectPreview = createStore({ open: false, data: null, sid: '' })
    const injectPreviewOpenRef = { current: false }   // 注入预览对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setInjectPreviewOpen(v) { const nv = typeof v === 'function' ? v(injectPreviewOpenRef.current) : v; injectPreviewOpenRef.current = nv; store.modal.injectPreview.set({ open: nv }) }
    function setInjectPreviewData(v) { store.modal.injectPreview.set({ data: typeof v === 'function' ? v(store.modal.injectPreview.get().data) : v }) }
    function setInjectPreviewSid(v) { store.modal.injectPreview.set({ sid: typeof v === 'function' ? v(store.modal.injectPreview.get().sid) : v }) }
    // ===== 注入预览（设置卡片「注入预览」入口）：notes-inject-preview 纯复用 host 注入渲染（约定段 + 合并目录段），
    // 单段只读展示（约定文本 pre + 目录段可点行）+ 三档视角下拉（全局 / 工作区并集 / 单会话；sessList 数据源）+ 底部统计条（总字符/打码/时效标注/预算截断）=====
    // 0.4.3 验收修复③（notes-043-dir-merge）：目录与资料桶合并为单一目录段——挂载行（- [[id]]，增强态）渲染、
    // 点击可开挂载弹层（panelBridge.openMountModal 中转，modals 禁横向引用；modal 不叠 modal——先关预览再开）；
    // 0.4.4-E：目录段唯挂载行源（普通行随 catalog 拆除消亡，行解析正则保留双形态兼容）——
    // 已挂载 = 编辑模式（notes-mount-list 预填现有文案）；未挂载 = LLM 草稿模式（notes-when-suggest 预填，失败回退标题）
    function openMountFromPreview(id) {
      if (!id) return
      setInjectPreviewOpen(false)
      Promise.all([rpc('notes-get', { id: id }), rpc('notes-mount-list', {})]).then(rs => {
        const g = rs[0], ml = rs[1]
        if (!g || g.error || !g.note) { showToast(t('inj.mountFailed', { msg: (g && g.error) || 'not found' })); return }
        const line = ((ml && ml.lines) || []).filter(l => l.id === id)[0]
        if (panelBridge.openMountModal) panelBridge.openMountModal({ id: id, title: g.note.title || id, existing: line ? line.when : undefined })
      }).catch(err => showToast(t('inj.mountFailed', { msg: String(err.message || err) })))
    }
    // 目录段文本 → 行节点数组：挂载行 `- [[n-xxx]]` 可点（行解析正则保留 `- [n-xxx]` 双形态兼容），
    // 其余行（标题/轻推/计数提示/挂载引导）纯文本
    function injPrevDirectoryRows(text, tt) {
      if (!String(text || '').trim()) return [e('div', { key: 'empty', className: 'dsh-notes-injprev-ln' }, '（无目录内容）')]
      return String(text).split('\n').map((ln, i) => {
        const m = ln.match(/^- \[\[?(n-[A-Za-z0-9]+)\]\]?/)
        if (!m) return e('div', { key: i, className: 'dsh-notes-injprev-ln' }, ln || ' ')
        return e('div', { key: i, className: 'dsh-notes-injprev-ln dsh-notes-injprev-hit dsh-nt', 'data-tooltip': tt('inj.mountAdd'), onClick: () => openMountFromPreview(m[1]) }, ln)
      })
    }
    function openInjectPreview() {
      setInjectPreviewData(null); setInjectPreviewSid(''); setError('')
      panelBridge.setSettingsOpen(false); setInjectPreviewOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
      loadInjectPreview('')
    }
    // 视角值编码：'' = 全局；'ws:<工作区标题>' = 工作区并集视角（host workspace 参数）；其余 = 会话短 id（sessionId 参数）
    function loadInjectPreview(sid) {
      const pvArgs = sid ? (sid.indexOf('ws:') === 0 ? { workspace: sid.slice(3) } : { sessionId: sid }) : {}
      rpc('notes-inject-preview', pvArgs).then(res => {
        if (res && res.error) { setError(res.error); setInjectPreviewData({ conventions: '', directory: '', stats: null }); return }
        setInjectPreviewData(res || { conventions: '', directory: '', stats: null })
      }).catch(err => { setError(String(err.message || err)); setInjectPreviewData({ conventions: '', directory: '', stats: null }) })
    }
    // 注入预览对话框宿主（设置卡片「注入预览」入口；mask/modal 复用设置卡片风格）：
    // 单段视图（约定段 pre + 目录段可点行）+ 三档视角下拉（全局 / 工作区并集 / 单会话；sessList 数据源）+ 底部统计条（总字符/打码/时效标注/预算截断）
    function InjectPreviewModal(props) {
      const injectPreviewOpen = store.modal.injectPreview.useSel(s => s.open)
      const injectPreviewData = store.modal.injectPreview.useSel(s => s.data)
      const injectPreviewSid = store.modal.injectPreview.useSel(s => s.sid)
      const tt = useT()   // 目录可点行 tooltip（inj.mountAdd）：组件级订阅语言态
      const error = props.error
      const sessList = props.sessList || []
      const sessPending = props.sessPending || []
      return injectPreviewOpen ? (() => {
        const d = injectPreviewData
        const stats = d && d.stats ? d.stats : null
        // 会话选项 = sessList（注入范围浮层同数据源）；工作区选项 = 会话 workspace 字段去重（含 pending 占位）；已选值不在列表时追加一项保证回显
        const sidOpts = sessList.slice()
        if (injectPreviewSid && injectPreviewSid.indexOf('ws:') !== 0 && !sidOpts.find(s => s.short === injectPreviewSid)) sidOpts.push({ short: injectPreviewSid, name: '' })
        const wsOpts = []
        for (const s of sessList.concat(sessPending)) { if (s && s.workspace && wsOpts.indexOf(s.workspace) < 0) wsOpts.push(s.workspace) }
        if (injectPreviewSid.indexOf('ws:') === 0 && wsOpts.indexOf(injectPreviewSid.slice(3)) < 0) wsOpts.push(injectPreviewSid.slice(3))
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setInjectPreviewOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-injprev-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('eye', 14), ' 注入预览', e('span', { className: 'dsh-notes-imgup-sub' }, 'Agent 实际收到的注入文本 · 只读')),
            e('div', { className: 'dsh-notes-injprev-bar' },
              e('select', { className: 'dsh-notes-settings-select dsh-notes-injprev-sess', value: injectPreviewSid, 'data-tooltip': '预览视角三档：全局 = 所有会话共享（injectTo=[]）；工作区 = 该工作区全部会话的注入并集；会话 = 单会话 injectTo 命中口径', onChange: (ev) => { const v = ev.target.value; setInjectPreviewSid(v); loadInjectPreview(v) } },
                e('option', { value: '' }, '全局'),
                wsOpts.length ? e('optgroup', { label: '工作区' }, wsOpts.map(w => e('option', { key: 'ws:' + w, value: 'ws:' + w }, w))) : null,
                e('optgroup', { label: '会话' }, sidOpts.map(s => e('option', { key: s.short, value: s.short }, s.short + (s.name ? ' · ' + s.name : '')))))),
            d === null
              ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
              : e('div', { className: 'dsh-notes-injprev-text' },
                  (d.conventions || '') ? e('pre', { className: 'dsh-notes-injprev-conv' }, d.conventions) : null,
                  injPrevDirectoryRows(d.directory || '', tt)),   // 目录段：挂载行可点（补充/编辑 whenToUse；0.4.4-E 唯挂载行源）
            stats ? e('div', { className: 'dsh-notes-injprev-stats' },
              '总字符 ' + stats.totalChars + '（约定 ' + stats.conventionsChars + ' / 目录 ' + stats.directoryChars + '）· 打码 ' + stats.maskedNotes + ' 条 · 时效标注 ' + stats.staleMarked + ' 条 · 预算截断 ' + (stats.budgetTruncated ? '是' : '否')) : null,   // 0.4.4-E：目录补充行开关徽标随 catalog 功能整体拆除（notes-044-catalog-remove）
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setInjectPreviewOpen(false) }, '关闭'))))
      })()
      : null
    }
    // ===== modal: inject-manager —— 注入管理面板（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.injMgr / injMgrOpenRef / injMgrBackRef / injMgrSearchRef / injMgrSearchDebRef / setInjMgrOpen / setInjMgrList / setInjMgrFilter /
    //           setInjMgrSearch / setInjMgrQ / setInjMgrSel / setInjMgrPending / openInjectManager / closeInjMgr / loadInjectManager / injMgrRole / injMgrScopeLabel / InjMgrModal /
    //           doInjSchedEdit / doInjSchedToggle / doInjSchedDel（模块级：注入管理调度区 + 详情计划块双上下文共用，notes-041-sched-plan-edit）
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）、kernel/bootstrap.js（timer）
    // state 托管：open/list/filter/search/q/sel/pending 迁入 store.modal.injMgr 切片；injMgrOpenRef 为 Esc 栈同步镜像 + injMgrSearchRef/injMgrSearchDebRef
    // 搜索防抖镜像（模块级单例，防抖 effect 挂 InjMgrModal 组件）；列表刷新经 panelBridge.loadNotes 中转；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    // 单层返回栈（notes-041-settings-back）：injMgrBackRef 记录来源（仅设置卡入口传 'settings'），统一关闭入口 closeInjMgr 在关闭后回设置卡（经 panelBridge.openSettings 中转）
    store.modal.injMgr = createStore({ open: false, list: null, filter: 'all', search: '', q: '', sel: {}, pending: false, rstats: null, rstatsOpen: false })
    const injMgrOpenRef = { current: false }          // 注入管理面板镜像（Esc 优先关）
    const injMgrBackRef = { current: null }           // 单层返回栈镜像（notes-041-settings-back）：'settings' = 从设置卡进入，关闭后自动回设置卡
    const injMgrSearchRef = { current: '' }           // 搜索框即时值镜像（防抖回调读 ref 防闭包过期；plain object 与 useRef 等价——面板为 shell.overlay 单例）
    const injMgrSearchDebRef = { current: null }      // 防抖句柄镜像
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setInjMgrOpen(v) { const nv = typeof v === 'function' ? v(injMgrOpenRef.current) : v; injMgrOpenRef.current = nv; store.modal.injMgr.set({ open: nv }) }
    function setInjMgrList(v) { store.modal.injMgr.set({ list: typeof v === 'function' ? v(store.modal.injMgr.get().list) : v }) }
    function setInjMgrFilter(v) { store.modal.injMgr.set({ filter: typeof v === 'function' ? v(store.modal.injMgr.get().filter) : v }) }
    function setInjMgrSearch(v) { store.modal.injMgr.set({ search: typeof v === 'function' ? v(store.modal.injMgr.get().search) : v }) }
    function setInjMgrQ(v) { store.modal.injMgr.set({ q: typeof v === 'function' ? v(store.modal.injMgr.get().q) : v }) }
    function setInjMgrSel(v) { store.modal.injMgr.set({ sel: typeof v === 'function' ? v(store.modal.injMgr.get().sel) : v }) }
    function setInjMgrPending(v) { store.modal.injMgr.set({ pending: typeof v === 'function' ? v(store.modal.injMgr.get().pending) : v }) }
    function setInjMgrRstats(v) { store.modal.injMgr.set({ rstats: typeof v === 'function' ? v(store.modal.injMgr.get().rstats) : v }) }   // 挂载区统计行数据源切片（0.4.3 验收修复⑥）
    function setInjMgrRstatsOpen(v) { store.modal.injMgr.set({ rstatsOpen: typeof v === 'function' ? v(store.modal.injMgr.get().rstatsOpen) : v }) }
    // 分通道召回率行（挂载区统计点开全量，0.4.3 验收修复⑥ notes-043-metrics-present）：交付通道 `ch used/delivered·pct%`
    // （无交付 → `ch —`）+ get 取用计数——机器通道名原文输出（遥测通道是机器标识符，不进 i18n；口径同 host _recallFmtChannels）
    function injMgrChanLine(channels) {
      const parts = []
      for (const c of ['inject', 'mount', 'search', 'catalog']) {
        const st = channels && channels[c]
        if (!st || !st.delivered) { parts.push(c + ' —'); continue }
        parts.push(c + ' ' + st.used + '/' + st.delivered + '·' + Math.round((st.rate || 0) * 100) + '%')
      }
      const g = channels && channels.get
      parts.push('get ×' + (g ? g.uses : 0))
      return parts.join(' ｜ ')
    }
    // ===== 挂载弹层（0.4.3⑤ notes-043-index；0.4.3 验收修复 notes-043-preview-when-edit：LLM 草稿预填 + 编辑模式）=====
    // 两种模式：未挂载 = LLM 草稿模式（打开即「生成中…」占位 → notes-when-suggest 成功填草稿，失败/8s 超时静默回退预填标题；
    //   用户始终可编辑——touched 后到达的草稿不覆盖）；已挂载（预览目录行点击带 existing）= 编辑模式（预填现有文案，不调 LLM）。
    // 确认统一 notes-mount（幂等换文案；0.4.3 验收修复⑪起 host 单点收口：落行同时把目标翻 reference 档，挂载 ⇔ 资料不变量成立，
    //   挂载行不再被目标笔记的下一次 update 摘掉）；跳过/取消 = 保留现状行；modal 不叠 modal（调用方先关来源 modal）
    // 0.4.3 验收修复⑪（notes-043-mount-ux-final）：openMountModal(n, { onConfirmed } )——确认成功后的回调（三态/管理面板入口的
    //   确认后动作：编辑器同步三态态等）；打开即重置，取消/跳过/关层清零（零副作用语义）；确认后统一 loadNotes 刷新收敛
    store.modal.mount = createStore({ open: false, id: '', title: '', when: '', pending: false, generating: false, edit: false, touched: false })
    function setMountOpen(v) { store.modal.mount.set({ open: typeof v === 'function' ? v(store.modal.mount.get().open) : v }) }
    const mountOnConfirmedRef = { current: null }   // 确认回调（模块级单例镜像；打开时重置）
    function openMountModal(n, opts) {
      if (!n) return
      mountOnConfirmedRef.current = (opts && typeof opts.onConfirmed === 'function') ? opts.onConfirmed : null
      const edit = typeof n.existing === 'string'   // 已挂载 = 编辑模式（预填现有 whenToUse，不调 LLM）
      store.modal.mount.set({ open: true, id: n.id, title: n.title || n.id, when: edit ? n.existing : '', pending: false, generating: !edit, edit: edit, touched: false })
      if (edit) return
      // LLM 草稿预填：成功填草稿；失败/超时回退预填标题（现状行为）；弹层已关/换目标则丢弃迟到响应
      rpc('notes-when-suggest', { id: n.id }).then(res => {
        const m = store.modal.mount.get()
        if (!m.open || m.id !== n.id) return
        const draft = res && !res.error && typeof res.suggestion === 'string' && res.suggestion ? res.suggestion : ''
        store.modal.mount.set(m.touched ? { generating: false } : { generating: false, when: draft || m.title })
      }).catch(() => {
        const m = store.modal.mount.get()
        if (!m.open || m.id !== n.id) return
        store.modal.mount.set(m.touched ? { generating: false } : { generating: false, when: m.title })
      })
    }
    function closeMountModal() { mountOnConfirmedRef.current = null; setMountOpen(false) }
    async function doMountSave() {
      const m = store.modal.mount.get()
      if (!m.id || m.pending) return
      store.modal.mount.set({ pending: true })
      try {
        // 空值兜底（0.4.3⑦ 顺带微修）：「正在生成…」窗口内点确认时 m.when 可能仍为空串——落空则回退标题，whenToUse 行不落空
        const res = await rpc('notes-mount', { id: m.id, whenToUse: m.when || m.title })
        store.modal.mount.set({ pending: false })
        if (res && res.error) { showToast(t('inj.mountFailed', { msg: res.error })); return }
        showToast(t('inj.mountSaved', { title: m.title }))
        const cb = mountOnConfirmedRef.current   // 先取回调再关层（closeMountModal 清零）
        closeMountModal()
        if (cb) { try { cb() } catch (e) {} }
        // 挂载收敛刷新（0.4.3⑪）：host 已把目标翻 reference 档——列表/编辑器选中态数据源即刻对齐（陈旧 inject=false 态保存会摘行）
        panelBridge.loadNotes(true); notifyNotesChanged()
      } catch (err) { store.modal.mount.set({ pending: false }); showToast(t('inj.mountFailed', { msg: String(err.message || err) })) }
    }
    function MountModal() {
      const m = store.modal.mount.useSel(s => s)
      const tt = useT()
      if (!m.open) return null
      return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !m.pending) closeMountModal() } },
        e('div', { className: 'dsh-notes-settings-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('bolt', 14), ' ' + (m.edit ? tt('inj.mountEdit') : tt('inj.mountTitle')), e('span', { className: 'dsh-notes-imgup-sub' }, tt('inj.mountSub'))),
          e('div', { className: 'dsh-notes-inj-mount-body' },
            e('label', { className: 'dsh-notes-inj-mount-label' }, tt('inj.mountLabel')),
            e('textarea', { className: 'dsh-notes-inj-mount-when', rows: 3, placeholder: m.generating ? tt('inj.mountGen') : tt('inj.mountPlaceholder'), value: m.when, autoFocus: true, onChange: (ev) => store.modal.mount.set({ when: ev.target.value, touched: true }) })),
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => closeMountModal(), disabled: m.pending }, tt('inj.mountSkip')),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: () => doMountSave(), disabled: m.pending }, m.pending ? '…' : tt('inj.mountSave')))))
    }
    // ===== 注入管理面板（设置卡片「注入管理」入口；notes-inject-manager）：全库注入总览 + 单行直改 + 多选批量 =====
    // 契约：数据源 notes-list {includeLogs:true} slim（inject/injectRole/injectEver/sensitive/kind/injectTo 齐备，零新 RPC）；
    // 三态语义与详情区三态分段控件完全一致：off→notes-update {inject:false}；约定/资料→{inject:true, injectRole}（payload 禁 undefined）；
    // 护栏：kind=log 注入硬关 UI 化（0.4.3⑦ 用户裁决——行内不渲染注入开关/勾选（UI 层不提供），静态「日志不参与注入」标注；
    //       host 侧 injectForcedOff 硬闸双保险保留）；sensitive 允许注入但行内提示「注入时自动脱敏」；排序：注入中在前（约定>资料），组内 updatedAt 降序。
    function openInjectManager(from) {
      setInjMgrList(null); setInjMgrFilter('all'); setInjMgrSearch(''); setInjMgrQ(''); setInjMgrSel({}); setInjMgrPending(false); setError('')
      setInjMgrRstats(null); setInjMgrRstatsOpen(false)   // 挂载区统计行复位（重新拉取账本快照）
      injMgrSearchRef.current = ''
      injMgrBackRef.current = from === 'settings' ? 'settings' : null   // 单层返回栈：记录来源（仅设置卡入口传 'settings'）
      panelBridge.setSettingsOpen(false); setInjMgrOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入/注入预览同款）
      loadInjectManager()
    }
    // 统一关闭入口（「关闭」/点遮罩/Esc 同口径）：单层返回栈——从设置卡进入的，关闭后自动重开设置卡（经 panelBridge.openSettings 中转，modals 禁横向引用）
    function closeInjMgr() {
      const back = injMgrBackRef.current; injMgrBackRef.current = null
      setInjMgrOpen(false)
      if (back === 'settings' && panelBridge.openSettings) panelBridge.openSettings()
    }
    function loadInjectManager() {
      rpc('notes-list', { includeLogs: true }).then(res => {
        if (res && res.error) { setError(res.error); setInjMgrList([]); return }
        setInjMgrList((res && res.notes) || [])
      }).catch(err => { setError(String(err.message || err)); setInjMgrList([]) })
      // 挂载区统计行数据源（0.4.3 验收修复⑥ notes-043-metrics-present）：notes-recall-stats 只读 RPC（账本快照 ledger 键 + 五通道分列），
      // 零新通道；静默降级——RPC 失败/无快照（新装库 cron 未跑）→ rstats 保持 null，统计行整区省略不占位
      rpc('notes-recall-stats', {}).then(res => { if (res && !res.error && res.ok) setInjMgrRstats(res) }).catch(() => setInjMgrRstats(null))   // 失败清陈旧统计行（刷新场景），遥测静默降级不打扰
    }
    // 笔记三态（与详情区同口径）：inject=true → injectRole（缺省 convention）；否则 off
    function injMgrRole(n) { return n.inject === true ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off' }
    // 作用域摘要（injectTo 数；缺省/存量 global·workspace 值 = 全局）；i18n 覆盖卡D：模块级 t() 直读当下语言态（调用点在渲染期，组件已挂 useT 订阅）
    function injMgrScopeLabel(injectTo) { const arr = (injectTo || []).filter(t => t !== 'global' && t !== 'workspace'); return arr.length === 0 ? t('inj.scopeGlobal') : t('inj.scopeSessions', { n: arr.length }) }
    // ===== 调度任务三操作（notes-034-sched-ui）· 模块级提升（notes-041-sched-plan-edit）：注入管理调度区 + 详情计划块双上下文共用 =====
    // （面板直调：panels/panel/editor.js 计划块操作行，序位 inject-manager 先于 panels；pending 走 store.modal.injMgr 切片——面板打开时驱动按钮禁用态，关闭时仅作重入闸）
    // 编辑 = 回填派发弹窗（modal 不叠 modal：先关注入管理；openDispatchEdit 经 panelBridge 中转——modals 禁横向引用）；清返回栈——调度编辑回填是新链路，关闭不回设置卡
    function doInjSchedEdit(n) { injMgrBackRef.current = null; setInjMgrOpen(false); if (panelBridge.openDispatchEdit) panelBridge.openDispatchEdit(n) }
    // 暂停/恢复：表单与 front-matter 同源——只提交声明字段（机器状态由 host 闸门延续；锚定时刻 anchor/dow 属声明字段随 every 一并回传，防暂停/恢复丢锚定，notes-034-sched-time）；恢复走 host 存活校验，失败内联回显
    // 双上下文：错误在面板打开时内联回显（setError），计划块上下文走 toast；成功后 loadNotes 刷新（curNote 由 notes 缓存派生 → 计划块就地刷新）
    async function doInjSchedToggle(n) {
      const s = n.schedule
      if (!s || store.modal.injMgr.get().pending) return
      const decl = { target: s.target, action: 'dispatch', enabled: s.enabled === false }
      if (s.at) decl.at = s.at; else { decl.every = s.every; if (s.anchor) decl.anchor = s.anchor; if (typeof s.dow === 'number') decl.dow = s.dow }
      setInjMgrPending(true); setError('')
      try {
        const res = await rpc('notes-update', { id: n.id, schedule: decl })
        setInjMgrPending(false)
        if (res && res.error) { if (injMgrOpenRef.current) setError(res.error); else showToast(res.error); return }
        showToast(decl.enabled ? t('inj.schedResumed', { title: n.title || n.id }) : t('inj.schedPausedToast', { title: n.title || n.id }))
        if (injMgrOpenRef.current) loadInjectManager()
        panelBridge.loadNotes(true); notifyNotesChanged()
      } catch (err) { setInjMgrPending(false); if (injMgrOpenRef.current) setError(String(err.message || err)); else showToast(t('meta.opFailed', { msg: String(err.message || err) })) }
    }
    // 删除 = 软删约定笔记（回收站可恢复；tick 跳过已删笔记，调度即刻停止）——暂停与删除是两个独立操作
    // 双上下文：计划块删除的是当前打开笔记时清空选中（同 doDelete 口径，editor 随 curNote 空值收起）
    async function doInjSchedDel(n) {
      if (store.modal.injMgr.get().pending) return
      if (!window.confirm(t('inj.schedDelConfirm', { title: n.title || n.id }))) return
      setInjMgrPending(true); setError('')
      try {
        const res = await rpc('notes-delete', { id: n.id })
        setInjMgrPending(false)
        if (res && res.error) { if (injMgrOpenRef.current) setError(res.error); else showToast(res.error); return }
        showToast(t('inj.schedDeleted', { title: n.title || n.id }))
        if (selectedRef.current === n.id) setSelected(null)
        if (injMgrOpenRef.current) loadInjectManager()
        panelBridge.loadNotes(true); notifyNotesChanged()
      } catch (err) { setInjMgrPending(false); if (injMgrOpenRef.current) setError(String(err.message || err)); else showToast(t('meta.deleteFailed', { msg: String(err.message || err) })) }
    }
    // 注入管理面板宿主（设置卡片「注入管理」入口；mask/modal 复用设置卡片风格；notes-inject-manager）：
    // 顶部统计 chips（约定 N / 资料 M / 未注入 K，点击=过滤）+ 搜索框（250ms 防抖）+ 批量条（全选/已选计数/设为约定/设为资料/关闭注入）
    // + 总览列表（行 = 勾选 + kind 色点 + 标题 + 敏感提示 + 曾注入徽章 + 作用域摘要 + 三态 segmented；注入中在前（约定>资料），组内 updatedAt 降序）
    function InjMgrModal(props) {
      const injMgrOpen = store.modal.injMgr.useSel(s => s.open)
      const injMgrList = store.modal.injMgr.useSel(s => s.list)
      const injMgrFilter = store.modal.injMgr.useSel(s => s.filter)
      const injMgrSearch = store.modal.injMgr.useSel(s => s.search)
      const injMgrQ = store.modal.injMgr.useSel(s => s.q)
      const injMgrSel = store.modal.injMgr.useSel(s => s.sel)
      const injMgrPending = store.modal.injMgr.useSel(s => s.pending)
      const injMgrRstats = store.modal.injMgr.useSel(s => s.rstats)         // 挂载区统计行：notes-recall-stats 账本快照（卡⑥）
      const injMgrRstatsOpen = store.modal.injMgr.useSel(s => s.rstatsOpen) // 点开才见全量（分通道 + 快照明细展开态）
      const error = props.error
      const tt = useT()   // i18n 覆盖卡D：订阅 langStore，切语言本卡自渲染（模块级 handler 走 t() 直读当下语言态）
      // 注入管理面板搜索防抖（250ms，与列表搜索同口径）：输入即更新受控值，防抖后才落过滤词 injMgrQ
      React.useEffect(() => {
        const d = timer.debounce(() => setInjMgrQ(injMgrSearchRef.current.trim().toLowerCase()), 250)
        injMgrSearchDebRef.current = d
        return () => { if (d && d.dispose) d.dispose() }
      }, [])
      // 单行直改：点 segmented 档位即切换（同详情区通道 notes-update {inject, injectRole}），toast 反馈
      async function doInjMgrSet(n, role) {
        if (!n || injMgrPending) return
        if ((n.kind || 'note') === 'log' && role !== 'off') return   // 日志注入硬关（UI 已不渲染开关，函数拦截为双保险）
        if (injMgrRole(n) === role) return
        setError('')
        // 0.4.3 验收修复⑪：单行「设为资料」先开挂载弹层（LLM 预填 whenToUse；确认 = notes-mount 单点收口落行 + 翻 reference 档，
        //   取消零副作用——不先静默翻转）；modal 不叠 modal——先关注入管理面板（沿用卡②「先关再开」，清返回栈）；
        //   确认后的收敛刷新由 doMountSave 统一承担（loadNotes + notifyNotesChanged）
        if (role === 'reference') { setInjMgrOpen(false); injMgrBackRef.current = null; openMountModal({ id: n.id, title: n.title }); return }
        const upd = { id: n.id, inject: role !== 'off' }
        if (upd.inject) upd.injectRole = role   // 非 off 才带 injectRole（off 态不带，payload 禁 undefined；host 仅 inject=true 落盘）
        try {
          const res = await rpc('notes-update', upd)
          if (res && res.error) { setError(res.error); return }
          if (res && res.injectForcedOff) showToast(t('inj.forcedOff', { title: n.title || n.id }))
          else showToast(role === 'off' ? t('inj.injectOffToast', { title: n.title || n.id }) : t('inj.injectSetToast', { role: t(role === 'reference' ? 'tree.roleReference' : 'tree.roleConvention'), title: n.title || n.id }))
          // 本地即时回写（injectEver 粘性：开启即曾注入），后台刷新对齐 host
          setInjMgrList(prev => (prev || []).map(x => x.id === n.id ? Object.assign({}, x, role === 'off' ? { inject: false } : { inject: true, injectRole: role, injectEver: true }) : x))
          panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) }
      }
      // 多选：log 行不可选（注入硬关——不渲染勾选框，批量三档位对日志无意义）
      function toggleInjMgrSel(id) { setInjMgrSel(prev => { const nx = Object.assign({}, prev); if (nx[id]) delete nx[id]; else nx[id] = true; return nx }) }
      // ===== 调度任务区（notes-034-sched-ui）：contractType=dispatch-schedule 约定笔记总览/暂停/删除/编辑回填——
      // 数据源 = notes-list slim 既有 contractType/schedule 字段（零新 RPC；表单与 front-matter 同一数据源两个视图） =====
      // 上次结果徽章：lastError 红 / lastRun sent 绿 / 未触发灰（暂停另出黄徽章 + 行置灰）
      function schedBadgeEl(n) {
        const s = n.schedule
        if (s.lastError) return e('span', { className: 'dsh-notes-sched-badge err dsh-nt', 'data-tooltip': s.lastError.message || '' }, I('x', 9), tt('meta.schedFailed', { time: fmtDT(s.lastError.at) }))
        if (s.lastRun) return s.lastRun.status === 'sent'
          ? e('span', { className: 'dsh-notes-sched-badge ok dsh-nt', 'data-tooltip': tt('meta.schedReceiptTip', { id: s.lastRun.receiptId || '' }) }, I('check', 9), tt('meta.schedSent', { time: fmtDT(s.lastRun.at) }))
          : e('span', { className: 'dsh-notes-sched-badge err' }, I('x', 9), tt('meta.schedFailed', { time: fmtDT(s.lastRun.at) }))
        return e('span', { className: 'dsh-notes-sched-badge' }, tt('meta.schedNever'))
      }
      // 下次触发展示：暂停 → 已暂停；单次已触发 → 已触发；否则「下次 <本地时间>」（锚点同 host schedDueAt 口径）；i18n 覆盖卡D：文案走 tt()（复用 B 卡 meta.sched* key）
      function schedNextLabel(n) {
        const s = n.schedule
        if (s.enabled === false) return tt('meta.schedPaused')
        if (s.at && s.lastFiredAt && Date.parse(s.lastFiredAt) >= Date.parse(s.at)) return tt('meta.schedFired')
        const ms = schedNextMs(n)
        return ms === null ? '—' : tt('meta.schedNext', { time: fmtDT(new Date(ms).toISOString()) })
      }
      // 调度三操作 handler 已提升模块级（notes-041-sched-plan-edit，本组件 JSX 直引同名标识符；详情计划块共用同链路）
      // 批量设为约定/资料/关闭：confirm 条数 → 逐条 notes-update（单条失败计数不中断）；完成后清选 + 刷新
      async function doInjMgrBatch(role) {
        const ids = Object.keys(injMgrSel)
        if (!ids.length || injMgrPending) return
        const label = role === 'off' ? t('inj.batchOff') : t('inj.batchLabelSet', { role: t(role === 'reference' ? 'tree.roleReference' : 'tree.roleConvention') })
        if (!window.confirm(t('inj.batchConfirm', { label: label, n: ids.length, effect: role === 'off' ? t('inj.batchEffOff') : t(role === 'reference' ? 'inj.batchEffRef' : 'inj.batchEffConv') }))) return
        setInjMgrPending(true); setError('')
        let ok = 0, fail = 0
        for (const id of ids) {
          const upd = { id: id, inject: role !== 'off' }
          if (upd.inject) upd.injectRole = role
          try { const res = await rpc('notes-update', upd); if (res && res.error) fail++; else ok++ }
          catch (err) { fail++ }
        }
        setInjMgrPending(false); setInjMgrSel({})
        showToast(t('inj.batchDone', { label: label, ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''))
        loadInjectManager(); panelBridge.loadNotes(true); notifyNotesChanged()
      }
      return injMgrOpen ? (() => {
        const listAll = injMgrList || []
        let cntConv = 0, cntRef = 0, cntOff = 0
        listAll.forEach(n => { const r = injMgrRole(n); if (r === 'convention') cntConv++; else if (r === 'reference') cntRef++; else cntOff++ })
        // 排序：注入中在前（约定 > 资料 > 未注入），组内 updatedAt 降序
        const injMgrWeight = { convention: 0, reference: 1, off: 2 }
        let shown = listAll.slice().sort((a, b) => (injMgrWeight[injMgrRole(a)] - injMgrWeight[injMgrRole(b)]) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        if (injMgrFilter !== 'all') shown = shown.filter(n => injMgrRole(n) === injMgrFilter)
        if (injMgrQ) shown = shown.filter(n => (n.title || '').toLowerCase().indexOf(injMgrQ) >= 0 || (n.topic || '').toLowerCase().indexOf(injMgrQ) >= 0 || (n.tags || []).join(' ').toLowerCase().indexOf(injMgrQ) >= 0)
        const selectable = shown.filter(n => n.kind !== 'log')   // log 行不可选（注入硬关 UI 化，0.4.3⑦）
        const selCnt = Object.keys(injMgrSel).length
        const allChecked = selectable.length > 0 && selectable.every(n => injMgrSel[n.id])
        const chipBtn = (f, label) => e('button', { key: f, className: 'dsh-notes-injmgr-chip' + (injMgrFilter === f ? ' on' : ''), onClick: () => setInjMgrFilter(f) }, label)
        // 行内三态 segmented（语义与详情区三态分段控件完全一致）；log 行不渲染注入开关（0.4.3⑦ 注入硬关 UI 化——UI 层不提供，非后台纠正）
        const segOpt = (n, role, r, label, tip) => {
          return e('span', { key: r, className: 'dsh-notes-injmgr-opt dsh-nt' + (role === r ? ' on' : ''), 'data-tooltip': tip, onClick: () => { doInjMgrSet(n, r) } }, label)
        }
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !injMgrPending) closeInjMgr() } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-injmgr-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('bolt', 14), ' ' + tt('settings.injManager'), e('span', { className: 'dsh-notes-imgup-sub' }, tt('inj.titleSub'))),
            e('div', { className: 'dsh-notes-injmgr-bar' },
              e('div', { className: 'dsh-notes-injmgr-chips' },
                chipBtn('all', tt('inj.chipAll', { n: listAll.length })), chipBtn('convention', tt('inj.chipConvention', { n: cntConv })), chipBtn('reference', tt('inj.chipReference', { n: cntRef })), chipBtn('off', tt('inj.chipOff', { n: cntOff }))),
              e('input', { className: 'dsh-notes-injmgr-search', placeholder: tt('inj.searchPlaceholder'), value: injMgrSearch, onChange: (ev) => { injMgrSearchRef.current = ev.target.value; setInjMgrSearch(ev.target.value); if (injMgrSearchDebRef.current) injMgrSearchDebRef.current() } })),
            // 挂载区统计行（0.4.3 验收修复⑥ notes-043-metrics-present）：账本快照紧凑呈现（挂载 N｜本周引用 Top3｜零引用 M），
            // 点开才见全量（分通道召回率 + 快照明细）；无快照 → 整区省略（静默降级；用途分级红线：本行仅呈现，清理裁决走 notes-recall-stats 全量/人工）
            injMgrRstats && injMgrRstats.ledger ? e('div', { className: 'dsh-notes-injmgr-mntstats' },
              e('div', { className: 'dsh-notes-injmgr-mntstats-row dsh-nt', 'data-tooltip': tt('inj.mntStatsTip'), onClick: () => setInjMgrRstatsOpen(!injMgrRstatsOpen) },
                I('eye', 11), ' ' + tt('inj.mntStats', { m: injMgrRstats.ledger.mountTotal || 0, top: (injMgrRstats.ledger.top || []).slice(0, 3).map(it => it.id + '×' + it.count).join('、') || '—', z: injMgrRstats.ledger.zeroRefCount || 0 })),
              injMgrRstatsOpen ? e('div', { className: 'dsh-notes-injmgr-mntstats-full' },
                e('div', null, injMgrChanLine(injMgrRstats.channels)),
                e('div', null, 'Top5: ' + ((injMgrRstats.ledger.top || []).map(it => it.id + '×' + it.count).join('、') || '—') + ' · zero: ' + ((injMgrRstats.ledger.zeroRef || []).join('、') || '—') + ' · @ ' + fmtDT(injMgrRstats.ledger.at) + (injMgrRstats.noteId ? ' · mirror: ' + injMgrRstats.noteId : ''))) : null) : null,
            // 调度任务区（notes-034-sched-ui）：定时派发约定总览（频率/目标/下次触发/上次结果徽章）+ 编辑回填/暂停/删除
            injMgrList === null ? null : (() => {
              const schedNotes = listAll.filter(n => (n.contractType || '') === 'dispatch-schedule' && n.schedule && !n.deleted)
              return e('div', { className: 'dsh-notes-sched-sec' },
                e('div', { className: 'dsh-notes-sched-sec-t' }, I('clock', 12), ' ' + tt('inj.schedTitle', { n: schedNotes.length }), e('span', { className: 'dsh-notes-sched-sec-sub' }, tt('inj.schedTitleSub'))),
                schedNotes.length === 0
                  ? e('div', { className: 'dsh-notes-data-hint dsh-notes-sched-empty' }, tt('inj.schedEmpty'))
                  : schedNotes.map(n => {
                      const s = n.schedule, paused = s.enabled === false
                      return e('div', { key: n.id, className: 'dsh-notes-sched-row' + (paused ? ' paused' : '') },
                        e('span', { className: 'dsh-notes-sched-row-t', title: n.title || tt('tree.untitled') }, n.title || tt('tree.untitled')),
                        e('span', { className: 'dsh-notes-sched-freq' }, schedFreqLabel(s)),
                        e('span', { className: 'dsh-notes-sched-target dsh-nt', 'data-tooltip': s.target || '' }, '→ ' + shortSid(s.target)),
                        e('span', { className: 'dsh-notes-sched-nf' }, schedNextLabel(n)),
                        schedBadgeEl(n),
                        paused ? e('span', { className: 'dsh-notes-sched-badge off' }, tt('meta.schedPaused')) : null,
                        e('span', { className: 'dsh-notes-sched-acts' },
                          e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': tt('meta.schedEditTip'), disabled: injMgrPending, onClick: () => doInjSchedEdit(n) }, tt('meta.edit')),
                          e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': paused ? tt('meta.schedResumeTip') : tt('meta.schedPauseTip'), disabled: injMgrPending, onClick: () => doInjSchedToggle(n) }, paused ? tt('meta.resume') : tt('meta.pause')),
                          e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': tt('meta.schedDelTip'), disabled: injMgrPending, onClick: () => doInjSchedDel(n) }, tt('common.delete'))))
                    }))
            })(),
            injMgrList === null
              ? e('div', { className: 'dsh-notes-data-hint' }, tt('common.loading'))
              : shown.length === 0
                ? e('div', { className: 'dsh-notes-data-hint' }, listAll.length ? tt('inj.noMatch') : tt('inj.emptyLib'))
                : e(React.Fragment, null,
                    e('div', { className: 'dsh-notes-injmgr-batch' },
                      e('label', { className: 'dsh-notes-trash-all' },
                        e('input', { type: 'checkbox', className: 'dsh-notes-trash-check', checked: allChecked, disabled: injMgrPending || selectable.length === 0, onChange: () => {
                          const nx = {}
                          if (!allChecked) selectable.forEach(n => { nx[n.id] = true })
                          setInjMgrSel(nx)
                        } }),
                        tt('inj.selectAll')),
                      e('span', { className: 'dsh-notes-trash-selcnt' }, tt('sel.selCount', { n: selCnt })),
                      e('button', { className: 'dsh-notes-trash-act', onClick: () => doInjMgrBatch('convention'), disabled: injMgrPending || selCnt < 1 }, tt('inj.batchConvention')),
                      e('button', { className: 'dsh-notes-trash-act dsh-nt', 'data-tooltip': tt('inj.batchRefTip'), onClick: () => doInjMgrBatch('reference'), disabled: injMgrPending || selCnt < 1 }, tt('inj.batchReference')),
                      e('button', { className: 'dsh-notes-trash-act', onClick: () => doInjMgrBatch('off'), disabled: injMgrPending || selCnt < 1 }, injMgrPending ? tt('inj.executing') : tt('inj.batchOff'))),
                    e('div', { className: 'dsh-notes-injmgr-list' },
                      shown.map(n => {
                        const role = injMgrRole(n)
                        const isLog = (n.kind || 'note') === 'log'
                        return e('div', { key: n.id, className: 'dsh-notes-injmgr-row' },
                          // 注入硬关 UI 化（0.4.3⑦）：log 行不渲染勾选框与注入开关——静态标注「日志不参与注入」（host injectForcedOff 硬闸双保险保留）
                          isLog
                            ? e('span', { className: 'dsh-notes-injmgr-checkslot dsh-nt', 'data-tooltip': tt('inj.logNoInjectTip') })
                            : e('span', null, e('input', { type: 'checkbox', className: 'dsh-notes-trash-check', checked: !!injMgrSel[n.id], disabled: injMgrPending, onChange: () => toggleInjMgrSel(n.id) })),
                          e('span', { className: 'dsh-notes-kind-dot', style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' } }),
                          e('span', { className: 'dsh-notes-injmgr-ti', title: n.title || tt('tree.untitled') }, n.title || tt('tree.untitled')),
                          n.sensitive === true ? e('span', { className: 'dsh-notes-injmgr-sens dsh-nt', 'data-tooltip': tt('inj.sensTip') }, I('lock', 9), tt('inj.sensBadge')) : null,
                          n.injectEver === true && !n.inject ? e('span', { className: 'dsh-notes-injmgr-ever dsh-nt', 'data-tooltip': tt('meta.injectEverTip') }, I('clock', 9), tt('meta.injectEver')) : null,
                          e('span', { className: 'dsh-notes-injmgr-scope' }, injMgrScopeLabel(n.injectTo)),
                          isLog
                            ? e('span', { className: 'dsh-notes-injmgr-lognote dsh-nt', 'data-tooltip': tt('inj.logNoInjectTip') }, I('bolt', 10), tt('inj.logNoInject'))
                            : e('span', { className: 'dsh-notes-injmgr-seg' }, I('bolt', 10),
                              segOpt(n, role, 'off', tt('meta.roleOff'), tt('meta.roleOffTip')),
                              segOpt(n, role, 'convention', tt('tree.roleConvention'), tt('meta.roleConventionTip')),
                              segOpt(n, role, 'reference', tt('tree.roleReference'), tt('meta.roleReferenceTip'))))
                      }))),                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => closeInjMgr(), disabled: injMgrPending }, tt('common.close')))))
      })()
      : null
    }
    // ===== modal: suggest —— 整理建议对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.suggest / suggestOpenRef / setSuggestOpen / setSuggestData / setSuggestPending / setLogHgExpand /
    //           openSuggest / loadSuggest / suggestGoArchive / suggestViewNote / SuggestModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError/jumpToWikiTarget 别名）、kernel/format.js（fmtBytes）、
    //        kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）、modals/archive.js（openArchive，序位在前可见）
    // state 托管：open/data/pending/logHgExpand 迁入 store.modal.suggest 切片；suggestOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 「去归档」直调 archive 模块 openArchive（同域序位共享）；孤儿「查看」经 kernel jumpToWikiTarget 转发别名；
    // 批量软删收尾（afterArchiveCleanup/loadNotes）经 panelBridge 中转；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.suggest = createStore({ open: false, data: null, pending: false, logHgExpand: {} })
    const suggestOpenRef = { current: false }   // 整理建议对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setSuggestOpen(v) { const nv = typeof v === 'function' ? v(suggestOpenRef.current) : v; suggestOpenRef.current = nv; store.modal.suggest.set({ open: nv }) }
    function setSuggestData(v) { store.modal.suggest.set({ data: typeof v === 'function' ? v(store.modal.suggest.get().data) : v }) }
    function setSuggestPending(v) { store.modal.suggest.set({ pending: typeof v === 'function' ? v(store.modal.suggest.get().pending) : v }) }
    function setLogHgExpand(v) { store.modal.suggest.set({ logHgExpand: typeof v === 'function' ? v(store.modal.suggest.get().logHgExpand) : v }) }
    // ===== 整理建议（设置卡片「整理建议」行入口）：notes-suggest（dry-run 零写入）四段式 modal =====
    // 契约：{ archiveCandidates:速记组（结构与 notes-archive-preview 同源）, staleCandidates:过期未引用, orphanCandidates:孤儿（仅展示）, logHygieneCandidates:{weekly,monthly}:日志卫生（工作记忆 v0，仅展示明细）, generatedAt }
    // 红线：只提名不自动执行——速记组「去归档」直达归档预览对话框；过期未引用「一键批量软删除」无 confirm 直接逐条 notes-delete（软删可恢复，撤销 toast 兜底——确认强度 = 不可恢复性，notes-034-c-confirm）；
    // 孤儿候选是启发式判定（可能误伤），不提供批量操作，逐条跳转人工过目；日志卫生 v0 仅展开明细（聚合执行留待 Phase 2，日志只聚合不淘汰）。
    function openSuggest() {
      setSuggestData(null); setSuggestPending(false); setError('')
      panelBridge.setSettingsOpen(false); setSuggestOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
      loadSuggest()
    }
    function loadSuggest() {
      const empty = { archiveCandidates: [], staleCandidates: [], orphanCandidates: [], logHygieneCandidates: { weekly: [], monthly: [] } }
      rpc('notes-suggest', {}).then(res => {
        if (res && res.error) { setError(res.error); setSuggestData(empty); return }
        setSuggestData(res || empty)
      }).catch(err => { setError(String(err.message || err)); setSuggestData(empty) })
    }
    // 速记组「去归档」：关建议框 → 复用归档预览对话框（数据同源，勾选/执行/撤销链路不变）
    function suggestGoArchive() { setSuggestOpen(false); openArchive() }
    // 孤儿「查看」：关建议框 → 双链跳转同款（目标被当前视图/kind/置顶过滤藏掉时退回「全部」再选中）
    function suggestViewNote(id) { setSuggestOpen(false); jumpToWikiTarget(id) }
    // 整理建议对话框宿主（设置卡片「整理建议」行入口；复用归档预览的列表样式）：
    // 四段式——① 可整理的速记组（「去归档」直达归档预览对话框，数据与 notes-archive-preview 同源）
    //          ② 过期未引用（超 staleDays 且 useCount=0；「一键批量软删除」直接逐条 notes-delete，撤销 toast 兜底）
    //          ③ 可能无用（孤儿候选：启发式判定可能误伤，仅展示逐条「查看」跳转，不提供批量操作）
    //          ④ 日志卫生（工作记忆 v0：超窗日志 周/月 聚合提名——只提名不执行，v0 「明细」展开逐条「查看」）
    function SuggestModal(props) {
      const tt = useT()   // i18n 覆盖卡E：订阅 langStore，切语言本卡自渲染（模块级 handler 走 t() 直读当下语言态）
      const suggestOpen = store.modal.suggest.useSel(s => s.open)
      const suggestData = store.modal.suggest.useSel(s => s.data)
      const suggestPending = store.modal.suggest.useSel(s => s.pending)
      const logHgExpand = store.modal.suggest.useSel(s => s.logHgExpand)
      const error = props.error
      // 过期未引用一键批量软删：确认强度 = 不可恢复性（notes-034-c-confirm）——软删可恢复 → 轻：无 confirm 直接删，
      // 撤销 toast 兜底（逐条 notes-restore；回收站亦可恢复）；删后刷新建议数据（三段联动，全空 → 空态文案）+ 列表
      async function doSuggestBatchDelete() {
        const list = (suggestData && suggestData.staleCandidates) || []
        if (!list.length || suggestPending) return
        setSuggestPending(true); setError('')
        let ok = 0, fail = 0
        const okIds = []
        for (const n of list) {
          try { const res = await rpc('notes-delete', { id: n.id }); if (res && res.error) fail++; else { ok++; okIds.push(n.id) } }
          catch (err) { fail++ }
        }
        setSuggestPending(false)
        showToast(t('sugg.softDeleted', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''), okIds.length ? { label: t('meta.undo'), fn: () => undoSuggestBatchDelete(okIds) } : undefined)
        panelBridge.afterArchiveCleanup(list.map(n => n.id))   // 正打开的笔记在被删集合中则退出选中态（归档收尾同款语义）
        await panelBridge.loadNotes(true); notifyNotesChanged()
        loadSuggest()
      }
      // 建议器批量软删撤销：逐条 notes-restore 恢复本次成功删除的笔记，恢复后刷新建议数据与列表
      async function undoSuggestBatchDelete(ids) {
        let ok = 0, fail = 0
        for (const id of ids) {
          try { const res = await rpc('notes-restore', { id: id }); if (res && res.error) fail++; else ok++ }
          catch (err) { fail++ }
        }
        showToast(t('common.restoredBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''))
        await panelBridge.loadNotes(true); notifyNotesChanged()
        loadSuggest()
      }
      return suggestOpen ? (() => {
        const d = suggestData
        const arch = (d && d.archiveCandidates) || []
        const stale = (d && d.staleCandidates) || []
        const orphans = (d && d.orphanCandidates) || []
        // 工作记忆 v0 日志卫生（第四段）：周聚合/月聚合两组提名（只提名不执行——v0 仅展示明细，聚合执行留待 Phase 2）
        const logHg = (d && d.logHygieneCandidates) || { weekly: [], monthly: [] }
        const logHgGroups = logHg.weekly.map(g => ({ g: g, tier: tt('sugg.tierWeekly') })).concat(logHg.monthly.map(g => ({ g: g, tier: tt('sugg.tierMonthly') })))
        const allEmpty = d !== null && arch.length === 0 && stale.length === 0 && orphans.length === 0 && logHgGroups.length === 0
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !suggestPending) setSuggestOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal dsh-notes-suggest-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('sparkle', 14), ' ' + tt('settings.suggest'), e('span', { className: 'dsh-notes-imgup-sub' }, tt('sugg.sub'))),
            d === null
              ? e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.analyzing'))
              : allEmpty
                ? e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.clean'))
                : e(React.Fragment, null,
                    e('div', { className: 'dsh-notes-suggest-sec' },
                      e('div', { className: 'dsh-notes-suggest-sec-t' }, tt('sugg.secArch'), e('span', { className: 'dsh-notes-suggest-sec-n' }, tt('sugg.countGroups', { n: arch.length })),
                        arch.length ? e('button', { className: 'dsh-notes-trash-act', onClick: suggestGoArchive }, tt('sugg.goArch')) : null),
                      arch.length
                        ? e('div', { className: 'dsh-notes-arch-list' },
                            arch.map(g => {
                              const span = g.dateSpan && g.dateSpan.from ? (g.dateSpan.from === g.dateSpan.to ? g.dateSpan.from : g.dateSpan.from + ' ~ ' + g.dateSpan.to) : ''
                              return e('div', { key: g.sessionId, className: 'dsh-notes-arch-row' },
                                e('span', { className: 'dsh-notes-arch-ti', title: g.title }, g.title),
                                e('span', { className: 'dsh-notes-arch-meta' }, tt('arch.groupMeta', { span: span, n: g.members.length, size: fmtBytes(g.totalBytes) }) + ((g.totalUseCount || 0) > 0 ? tt('arch.groupUseCount', { n: g.totalUseCount }) : '')))
                            }))
                        : e('div', { className: 'dsh-notes-data-hint' }, tt('arch.empty'))),
                    e('div', { className: 'dsh-notes-suggest-sec' },
                      e('div', { className: 'dsh-notes-suggest-sec-t' }, tt('sugg.secStale'), e('span', { className: 'dsh-notes-suggest-sec-n' }, tt('sugg.countItems', { n: stale.length })),
                        stale.length ? e('button', { className: 'dsh-notes-trash-act danger', onClick: doSuggestBatchDelete, disabled: suggestPending }, suggestPending ? tt('sugg.deleting') : tt('sugg.batchDel')) : null),
                      stale.length
                        ? e('div', { className: 'dsh-notes-arch-list' },
                            stale.map(n => e('div', { key: n.id, className: 'dsh-notes-arch-row' },
                              e('span', { className: 'dsh-notes-arch-ti', title: n.title || 'Untitled' }, n.title || 'Untitled'),
                              e('span', { className: 'dsh-notes-arch-meta' }, (n.topic || tt('meta.uncategorized')) + ' · ' + tt('sugg.staleDays', { n: n.staleDays })))))
                        : e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.staleEmpty'))),
                    e('div', { className: 'dsh-notes-suggest-sec' },
                      e('div', { className: 'dsh-notes-suggest-sec-t' }, tt('sugg.secOrphan'), e('span', { className: 'dsh-notes-suggest-sec-n' }, tt('sugg.countItems', { n: orphans.length }))),
                      orphans.length
                        ? e('div', { className: 'dsh-notes-arch-list' },
                            orphans.map(n => e('div', { key: n.id, className: 'dsh-notes-arch-row' },
                              e('span', { className: 'dsh-notes-arch-ti', title: n.title || 'Untitled' }, n.title || 'Untitled'),
                              e('span', { className: 'dsh-notes-arch-meta' }, (n.topic || tt('meta.uncategorized')) + ' · ' + (n.updatedAt ? fmtDT(n.updatedAt).slice(0, 10) : '—')),
                              e('button', { className: 'dsh-notes-trash-act', onClick: () => suggestViewNote(n.id) }, tt('sugg.view')))))
                        : e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.orphanEmpty'))),
                    // ④ 日志卫生（工作记忆 v0 裁决 B②：超窗旧日志两级聚合提名——只提名不执行，v0 展开明细逐条过目）
                    e('div', { className: 'dsh-notes-suggest-sec' },
                      e('div', { className: 'dsh-notes-suggest-sec-t' }, tt('sugg.secLogHg'), e('span', { className: 'dsh-notes-suggest-sec-n' }, tt('sugg.countGroups', { n: logHgGroups.length }))),
                      logHgGroups.length
                        ? e('div', { className: 'dsh-notes-arch-list' },
                            logHgGroups.map(({ g, tier }) => e(React.Fragment, { key: tier + g.key },
                              e('div', { className: 'dsh-notes-arch-row' },
                                e('span', { className: 'dsh-notes-arch-ti', title: g.title }, g.title),
                                e('span', { className: 'dsh-notes-arch-meta' }, tt('sugg.logHgMeta', { tier: tier, n: g.members.length })),
                                e('button', { className: 'dsh-notes-trash-act', onClick: () => setLogHgExpand(prev => { const nx = Object.assign({}, prev); if (nx[tier + g.key]) delete nx[tier + g.key]; else nx[tier + g.key] = true; return nx }) }, logHgExpand[tier + g.key] ? tt('trash.collapse') : tt('sugg.detail'))),
                              logHgExpand[tier + g.key] ? e('div', { className: 'dsh-notes-arch-list' },
                                g.members.map(m => e('div', { key: m.id, className: 'dsh-notes-arch-row' },
                                  e('span', { className: 'dsh-notes-arch-ti', title: m.title || 'Untitled' }, m.title || 'Untitled'),
                                  e('span', { className: 'dsh-notes-arch-meta' }, (m.logDate || '—') + (m.sessionId ? tt('sugg.sessSeg', { id: String(m.sessionId).replace(/^session-/, '').slice(0, 8) }) : '')),
                                  e('button', { className: 'dsh-notes-trash-act', onClick: () => suggestViewNote(m.id) }, tt('sugg.view'))))) : null)))
                        : e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.logHgEmpty'))),
                    e('div', { className: 'dsh-notes-data-hint' }, tt('sugg.criteriaClient'))),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setSuggestOpen(false), disabled: suggestPending }, tt('common.close')))))
      })()
      : null
    }
    // ===== modal: memory-guide —— 工作记忆启用沉淀引导对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.memory / memOpenRef / memBackRef / setMemStatus / setMemOpen / setMemScope / setMemWsPick / setMemSidPick / setMemPending /
    //           memScopeResolve / openMemEnable / closeMemEnable / doMemEnable / doMemDisable / memViewNote / MemoryGuideModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError/jumpToWikiTarget 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）
    // state 托管：status/open/scope/wsPick/sidPick/pending 迁入 store.modal.memory 切片；memOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 作用域解析/多选清单数据源（sessList/sessPending）属面板域：渲染期经 props 注入，动作期经 panelBridge 中转（禁横向引用）；
    // 「查看约定」跳转经 kernel jumpToWikiTarget 转发别名；与设置卡片互斥经 panelBridge.setSettingsOpen 中转；
    // 单层返回栈（notes-041-settings-back）：memBackRef 记录来源（仅设置卡入口传 'settings'），统一关闭入口 closeMemEnable 在关闭后回设置卡；
    // memStatus 同时供 settings 模块状态行订阅（序位在前的本模块顶层绑定对 settings.js 可见）
    store.modal.memory = createStore({ status: null, open: false, scope: 'global', wsPick: {}, sidPick: {}, pending: false })
    const memOpenRef = { current: false }   // 工作记忆启用对话框镜像（Esc 优先关）
    const memBackRef = { current: null }    // 单层返回栈镜像（notes-041-settings-back）：'settings' = 从设置卡进入，关闭后自动回设置卡
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setMemStatus(v) { store.modal.memory.set({ status: typeof v === 'function' ? v(store.modal.memory.get().status) : v }) }
    function setMemOpen(v) { const nv = typeof v === 'function' ? v(memOpenRef.current) : v; memOpenRef.current = nv; store.modal.memory.set({ open: nv }) }
    function setMemScope(v) { store.modal.memory.set({ scope: typeof v === 'function' ? v(store.modal.memory.get().scope) : v }) }
    function setMemWsPick(v) { store.modal.memory.set({ wsPick: typeof v === 'function' ? v(store.modal.memory.get().wsPick) : v }) }
    function setMemSidPick(v) { store.modal.memory.set({ sidPick: typeof v === 'function' ? v(store.modal.memory.get().sidPick) : v }) }
    function setMemPending(v) { store.modal.memory.set({ pending: typeof v === 'function' ? v(store.modal.memory.get().pending) : v }) }
    // ===== 工作记忆 v0（设置卡片「工作记忆」区，r3 车道模型）：启用沉淀引导 = 创建预填约定笔记（contractType: memory-guide 身份标记 + tag 兼容发现键，inject=true + 作用域三档）=====
    // 车道并行语义：记忆车道与约定车道并行不互斥（无冲突确认闸门）；启用状态不落 settings.json（host 单一事实源 = 存在 contractType=memory-guide 且 inject=true 的笔记）；停用 = 关闭该约定 inject
    // 作用域三档解析（injectTo 落值语义不变：[] = 所有会话；会话短 id 数组 = 仅限这些会话——无「工作区」维度，
    // 指定工作区档展开为所选工作区全部会话短 id 的并集。全局视角多选清单：sessList + pending 占位会话，数据源 notes-sessions）
    function memScopeResolve() {
      const memScope = store.modal.memory.get().scope
      const memWsPick = store.modal.memory.get().wsPick
      const memSidPick = store.modal.memory.get().sidPick
      const sessList = panelBridge.sessList || []
      const sessPending = panelBridge.sessPending || []
      if (memScope === 'global') return []
      if (memScope === 'session') return Object.keys(memSidPick)
      // workspace 档：属于所选工作区的全部会话短 id（并集去重）
      const ids = []
      for (const s of sessList.concat(sessPending)) {
        if (s && s.workspace && memWsPick[s.workspace] && s.short && ids.indexOf(s.short) < 0) ids.push(s.short)
      }
      return ids
    }
    // 启用入口（r3 车道模型）：对话框 = 车道说明文案 + 作用域三档多选；不再有 op:'check' 重叠扫描与冲突确认——
    // enable 幂等直建（已启用返回 already:true，toast 提示现状）
    function openMemEnable(from) {
      setMemScope('global'); setMemWsPick({}); setMemSidPick({}); setMemPending(false); setError('')
      memBackRef.current = from === 'settings' ? 'settings' : null   // 单层返回栈：记录来源（仅设置卡入口传 'settings'）
      panelBridge.setSettingsOpen(false); setMemOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
    }
    // 统一关闭入口（取消/点遮罩/Esc/启用成功 同口径）：单层返回栈——从设置卡进入的，关闭后自动重开设置卡（重开即重新探测启用状态；经 panelBridge.openSettings 中转）
    function closeMemEnable() {
      const back = memBackRef.current; memBackRef.current = null
      setMemOpen(false)
      if (back === 'settings' && panelBridge.openSettings) panelBridge.openSettings()
    }
    async function doMemEnable() {
      const memPending = store.modal.memory.get().pending
      const memScope = store.modal.memory.get().scope
      const memWsPick = store.modal.memory.get().wsPick
      const memSidPick = store.modal.memory.get().sidPick
      if (memPending) return
      // 多选档校验：至少勾 1 项（指定工作区档解析为空 = 所选工作区暂无有效会话，同样拦截）；i18n 覆盖卡D：校验/toast 走模块级 t() 直读当下语言态
      if (memScope === 'workspace' && !Object.keys(memWsPick).length) { setError(t('mem.needWorkspace')); return }
      if (memScope === 'session' && !Object.keys(memSidPick).length) { setError(t('mem.needSession')); return }
      const scope = memScopeResolve()
      if (memScope !== 'global' && !scope.length) { setError(t('mem.noSessInScope')); return }
      setMemPending(true); setError('')
      try {
        const res = await rpc('notes-memory-guide', { op: 'enable', scope: memScopeResolve() })
        if (res && res.error) { setError(res.error); return }
        closeMemEnable()   // 启用成功 = 关闭二级面板（单层返回栈：从设置卡进入的回设置卡，重开即重新探测状态）
        showToast(res && res.already ? t('mem.alreadyToast') : (res && res.revived ? t('mem.revivedToast') : t('mem.enabledToast')))
        setMemStatus({ enabled: true, noteId: res && res.id || '' })
        panelBridge.loadNotes(true); notifyNotesChanged()
      } catch (err) { setError(String(err.message || err)) } finally { setMemPending(false) }
    }
    // 停用 = 关闭引导约定笔记 inject（笔记保留可再启用；彻底退出可在面板删除该笔记）
    async function doMemDisable() {
      const memPending = store.modal.memory.get().pending
      if (memPending) return
      setMemPending(true); setError('')
      try {
        const res = await rpc('notes-memory-guide', { op: 'disable' })
        if (res && res.error) { setError(res.error); return }
        showToast(res && res.disabled ? t('mem.disabledToast') : t('mem.notEnabled'))
        setMemStatus(prev => Object.assign({}, prev || {}, { enabled: false }))
        panelBridge.loadNotes(true); notifyNotesChanged()
      } catch (err) { setError(String(err.message || err)) } finally { setMemPending(false) }
    }
    // 「查看约定」：关设置卡片 → 双链跳转同款选中引导笔记（被过滤藏掉时退回「全部」）
    function memViewNote() { const memStatus = store.modal.memory.get().status; if (memStatus && memStatus.noteId) { panelBridge.setSettingsOpen(false); jumpToWikiTarget(memStatus.noteId) } }
    // 工作记忆 v0 启用沉淀引导对话框宿主（设置卡片「工作记忆」区入口；mask/modal 复用设置卡片风格；r3 车道模型）：
    // 车道说明文案（并行通道，无冲突确认）→ 作用域三档（全局视角挑选：所有会话 / 指定工作区多选 / 指定会话多选，数据源 notes-sessions）→ 确认启用（op:'enable' 幂等直建）
    function MemoryGuideModal(props) {
      const memOpen = store.modal.memory.useSel(s => s.open)
      const memScope = store.modal.memory.useSel(s => s.scope)
      const memWsPick = store.modal.memory.useSel(s => s.wsPick)
      const memSidPick = store.modal.memory.useSel(s => s.sidPick)
      const memPending = store.modal.memory.useSel(s => s.pending)
      const error = props.error
      const sessList = props.sessList || []
      const sessPending = props.sessPending || []
      const tt = useT()   // i18n 覆盖卡D：订阅 langStore，切语言本卡自渲染
      return memOpen ? (() => {
        // 多选清单数据源：sessList + pending 占位会话；工作区清单 = 会话 workspace 字段去重（全局视角：可挑任意工作区/会话，不以「当前」为基准）
        const memSessAll = sessList.concat(sessPending)
        const memWsList = []
        for (const s of memSessAll) { if (s && s.workspace && memWsList.indexOf(s.workspace) < 0) memWsList.push(s.workspace) }
        const scopeOpt = (id, label, tip) => e('label', { key: id, className: 'dsh-notes-scope-item dsh-nt', 'data-tooltip': tip, style: { display: 'flex', gap: 6, padding: '3px 2px', cursor: 'pointer' } },
          e('input', { type: 'radio', name: 'dsh-notes-mem-scope', checked: memScope === id, onChange: () => setMemScope(id) }), label)
        const pickItem = (key, checked, onToggle, label) => e('label', { key: key, className: 'dsh-notes-scope-item', style: { display: 'flex', gap: 6, padding: '2px 2px', cursor: 'pointer' } },
          e('input', { type: 'checkbox', checked: checked, onChange: onToggle }), label)
        const togglePick = (setFn, key) => setFn(prev => { const next = Object.assign({}, prev); if (next[key]) delete next[key]; else next[key] = true; return next })
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !memPending) closeMemEnable() } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('bolt', 14), ' ' + tt('mem.enableTitle'), e('span', { className: 'dsh-notes-imgup-sub' }, tt('mem.enableSub'))),
            e('div', { className: 'dsh-notes-data-hint' }, tt('mem.enableHint')),
            e('div', { className: 'dsh-notes-suggest-sec' },
              e('div', { className: 'dsh-notes-suggest-sec-t' }, tt('mem.scopeTitle')),
              scopeOpt('global', tt('mem.scopeGlobal'), tt('mem.scopeGlobalTip')),
              scopeOpt('workspace', tt('mem.scopeWsMulti'), tt('mem.scopeWsTip')),
              memScope === 'workspace' ? e('div', { style: { maxHeight: 120, overflow: 'auto', margin: '2px 0 4px 20px' } },
                memWsList.length
                  ? memWsList.map(w => pickItem(w, !!memWsPick[w], () => togglePick(setMemWsPick, w), tt('mem.wsLabel', { name: w, n: memSessAll.filter(s => s.workspace === w).length })))
                  : e('div', { className: 'dsh-notes-data-hint' }, tt('mem.noWorkspace'))) : null,
              scopeOpt('session', tt('mem.scopeSessMulti'), tt('mem.scopeSessTip')),
              memScope === 'session' ? e('div', { style: { maxHeight: 160, overflow: 'auto', margin: '2px 0 4px 20px' } },
                memSessAll.length
                  ? memSessAll.map(s => pickItem(s.short, !!memSidPick[s.short], () => togglePick(setMemSidPick, s.short), s.short + (s.name ? tt('mem.sessNameSeg', { name: s.name }) : '') + (s.workspace ? tt('mem.sessWsSeg', { ws: s.workspace }) : '')))
                  : e('div', { className: 'dsh-notes-data-hint' }, tt('mem.noSessions'))) : null),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => closeMemEnable(), disabled: memPending }, tt('common.cancel')),
              e('button', { className: 'dsh-notes-dispatch-ok', onClick: doMemEnable, disabled: memPending }, memPending ? tt('mem.enabling') : tt('mem.confirmEnable')))))
      })()
      : null
    }
    // ===== modal: dispatch —— 派发待办对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.dispatch / dispatchOpenRef / setDispatchOpen / setActiveSessions / setDispatchPending / setDispatching /
    //           setDispatchMode / setDispatchInstr / setDispatchWsId / setDispatchSessWs / setDispatchSessId / setWsList /
    //           setDispatchSched / setDispatchSchedMode / setDispatchSchedN / setDispatchSchedAt / setDispatchSchedAnchor / setDispatchSchedDow /
    //           loadActiveSessions / loadWorkspaces / openDispatch / openDispatchEdit / doDispatchConfirm / doDispatchDone / DispatchModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名/selectedRef）、kernel/icons.js（e/I）、
    //        kernel/format.js（shortSid/fmtDT/schedEveryMs/schedFreqLabel/schedNextMs/isoToLocalInput/schedAnchorMs/schedAnchorNextMs/schedFormDecl/schedDeclNextMs）、
    //        kernel/bus.js（showToast/notifyNotesChanged）、kernel/bootstrap.js（timer/sessions/workspaces 服务接入）
    // state 托管：open/activeSessions/pending/dispatching/mode/instr/wsId/sessWs/sessId/wsList + 调度区 sched/schedMode/schedN/schedAt/editId/editNote/schedAnchor/schedDow
    // 迁入 store.modal.dispatch 切片；dispatchOpenRef 为 titlesPending 轮询终止条件的同步镜像（模块级单例）；轮询调度经 panelBridge.later（面板 timersRef 统一簿记/dispose）；
    // 当前选中笔记 id 读 kernel selectedRef（渲染期镜像）；确认后正文回填/列表刷新经 panelBridge.setEdBody/loadNotes 中转（禁横向引用）
    //
    // 定时派发·设置交互（notes-034-sched-ui）：派发弹窗扩展「调度」区——默认收起 = 立即派发（手动派发路径零改动）；
    // 「定时执行」展开频率设置（每天/每周/每 N 天/仅一次+时间），确认排定 = 创建 contractType=dispatch-schedule 约定笔记
    // （标题自动「定时 」前缀，front-matter 写 schedule 声明，正文 = 原待办正文 + 补充指令——即被派发的工作内容本身）+ toast「已排定，下次：X」；
    // 编辑模式（注入管理「调度任务」区 [编辑]，经 panelBridge.openDispatchEdit 中转）= 同弹窗回填既有声明，保存走 notes-update（机器状态 host 闸门延续）。
    // 锚定时刻（notes-034-sched-time）：周期三模式各补时刻选择（time input，默认 09:00）——声明携 anchor:'HH:MM'
    // （触发序列钉死本地时刻，不随创建时间漂移）；「每周」另加星期几选择（dow 0-6）；仅一次保持 datetime-local 不变。
    // 校验内联报错（at 未来 / N≥1 / 目标必选；host 红线回显同口径）——禁原生 prompt（R1 反面教材 n-mut46q00c3yw）；定时模式仅已有会话（新建会话无未来目标意义）
    store.modal.dispatch = createStore({ open: false, activeSessions: [], pending: [], dispatching: false, mode: 'existing', instr: '', wsId: '', sessWs: '', sessId: '', wsList: [], sched: false, schedMode: 'daily', schedN: 3, schedAt: '', editId: '', editNote: null, schedAnchor: '09:00', schedDow: 1, schedNew: false })
    const dispatchOpenRef = { current: false }   // 派发对话框镜像（titlesPending 轮询重拉的终止条件）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setDispatchOpen(v) { const nv = typeof v === 'function' ? v(dispatchOpenRef.current) : v; dispatchOpenRef.current = nv; store.modal.dispatch.set({ open: nv }) }
    function setActiveSessions(v) { store.modal.dispatch.set({ activeSessions: typeof v === 'function' ? v(store.modal.dispatch.get().activeSessions) : v }) }
    function setDispatchPending(v) { store.modal.dispatch.set({ pending: typeof v === 'function' ? v(store.modal.dispatch.get().pending) : v }) }
    function setDispatching(v) { store.modal.dispatch.set({ dispatching: typeof v === 'function' ? v(store.modal.dispatch.get().dispatching) : v }) }
    function setDispatchMode(v) { store.modal.dispatch.set({ mode: typeof v === 'function' ? v(store.modal.dispatch.get().mode) : v }) }
    function setDispatchInstr(v) { store.modal.dispatch.set({ instr: typeof v === 'function' ? v(store.modal.dispatch.get().instr) : v }) }
    function setDispatchWsId(v) { store.modal.dispatch.set({ wsId: typeof v === 'function' ? v(store.modal.dispatch.get().wsId) : v }) }
    function setDispatchSessWs(v) { store.modal.dispatch.set({ sessWs: typeof v === 'function' ? v(store.modal.dispatch.get().sessWs) : v }) }
    function setDispatchSessId(v) { store.modal.dispatch.set({ sessId: typeof v === 'function' ? v(store.modal.dispatch.get().sessId) : v }) }
    function setWsList(v) { store.modal.dispatch.set({ wsList: typeof v === 'function' ? v(store.modal.dispatch.get().wsList) : v }) }
    function setDispatchSched(v) { store.modal.dispatch.set({ sched: typeof v === 'function' ? v(store.modal.dispatch.get().sched) : v }) }
    function setDispatchSchedMode(v) { store.modal.dispatch.set({ schedMode: typeof v === 'function' ? v(store.modal.dispatch.get().schedMode) : v }) }
    function setDispatchSchedN(v) { store.modal.dispatch.set({ schedN: typeof v === 'function' ? v(store.modal.dispatch.get().schedN) : v }) }
    function setDispatchSchedAt(v) { store.modal.dispatch.set({ schedAt: typeof v === 'function' ? v(store.modal.dispatch.get().schedAt) : v }) }
    function setDispatchSchedAnchor(v) { store.modal.dispatch.set({ schedAnchor: typeof v === 'function' ? v(store.modal.dispatch.get().schedAnchor) : v }) }
    function setDispatchSchedDow(v) { store.modal.dispatch.set({ schedDow: typeof v === 'function' ? v(store.modal.dispatch.get().schedDow) : v }) }
    function setDispatchSchedNew(v) { store.modal.dispatch.set({ schedNew: typeof v === 'function' ? v(store.modal.dispatch.get().schedNew) : v }) }   // 0.4.4-B：专属会话开关（target='new'）
    // 任务派发：加载活跃会话/工作区 + 打开对话框 + 确认派发
    // 0.1.7 首屏提速：host 对缓存未命中会话先返回占位（titlesPending + pendingSessions），对话框立即渲染
    // （占位条目显示「短id · 标题加载中…」）；仍 pending 则 1.5s 轮询重拉，直到标题补齐或对话框关闭。
    async function loadActiveSessions() {
      try {
        const res = await rpc('notes-active-sessions', {})
        if (!res) return
        const st = store.modal.dispatch.get()
        let sess = res.sessions
        /* 编辑模式：目标会话不在活跃清单时补一条合成条目（原目标保持可选；host 落库仍校验存活红线，非 live 只影响执行时刻）；
           0.4.4-B：target='new'（专属会话）不是真实会话 id，跳过合成条目与级联回填（schedNew 复选框承载其编辑态） */
        if (sess && st.editId && st.editNote && st.editNote.schedule && st.editNote.schedule.target !== 'new' && !sess.some(s => s.id === st.editNote.schedule.target)) {
          const tg = st.editNote.schedule.target
          sess = sess.concat([{ id: tg, short: shortSid(tg), name: t('disp.orphanSessName'), workspace: t('disp.orphanSessWs'), live: false }])
        }
        if (sess) {
          setActiveSessions(sess)
          /* 编辑模式回填：目标会话的工作区级联选择（sessWs + sessId） */
          if (st.editId && st.editNote && st.editNote.schedule && st.editNote.schedule.target !== 'new') {
            const f = sess.find(s => s.id === st.editNote.schedule.target)
            if (f) { setDispatchSessWs(f.workspace || t('meta.wsOther')); setDispatchSessId(f.id) }
          }
        }
        setDispatchPending(res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [])
        if (res.titlesPending && dispatchOpenRef.current) panelBridge.later(loadActiveSessions, 1500)
      } catch (e) {}
    }
    async function loadWorkspaces() {
      try { const res = await rpc('notes-workspaces', {}); if (res && res.workspaces) setWsList(res.workspaces) } catch (e) {}
    }
    function openDispatch() {
      setDispatchInstr(''); setDispatchSessId(''); setDispatchSessWs(''); setDispatchWsId(''); setDispatchMode('existing'); setError('')
      store.modal.dispatch.set({ sched: false, schedMode: 'daily', schedN: 3, schedAt: '', editId: '', editNote: null, schedAnchor: '09:00', schedDow: 1, schedNew: false })   // 调度区复位（默认收起 = 立即派发；锚定时刻默认 09:00 / 周一；专属会话缺省关）
      loadActiveSessions(); loadWorkspaces(); setDispatchOpen(true)
    }
    // 编辑模式入口（注入管理「调度任务」区 [编辑]，经 panelBridge.openDispatchEdit 中转——modals 禁横向引用）：同弹窗回填既有声明
    function openDispatchEdit(note) {
      if (!note || !note.schedule) { showToast(t('disp.noSchedule')); return }
      const s = note.schedule
      const isNew = s.target === 'new'   // 0.4.4-B：专属会话声明回填（复选框承载，级联选择无对应真实条目）
      setDispatchInstr(''); setDispatchSessId(isNew ? '' : (s.target || '')); setDispatchSessWs(''); setDispatchWsId(''); setDispatchMode('existing'); setError('')
      store.modal.dispatch.set({ editId: note.id, editNote: note, sched: true, schedNew: isNew })
      /* 回填：at → 仅一次；every 整天数 → 每天/每周/每 N 天；非整天间隔（front-matter 裸编辑旁路值）归一最近整天，保存按表单覆盖；
         锚定时刻（notes-034-sched-time）：anchor/dow 回填（非法 anchor 回退默认 09:00——裸编辑旁路值防御） */
      if (s.at) { store.modal.dispatch.set({ schedMode: 'once', schedAt: isoToLocalInput(s.at), schedN: 3 }) }
      else {
        store.modal.dispatch.set({ schedAnchor: schedAnchorMs(s.anchor) !== null ? s.anchor : '09:00', schedDow: typeof s.dow === 'number' && s.dow >= 0 && s.dow <= 6 ? s.dow : 1 })
        const ms = schedEveryMs(s.every), d = ms && ms % 86400000 === 0 ? ms / 86400000 : 0
        if (d === 1) store.modal.dispatch.set({ schedMode: 'daily', schedN: 3, schedAt: '' })
        else if (d === 7) store.modal.dispatch.set({ schedMode: 'weekly', schedN: 3, schedAt: '' })
        else store.modal.dispatch.set({ schedMode: 'ndays', schedN: d >= 1 ? d : Math.max(1, Math.round((ms || 259200000) / 86400000)), schedAt: '' })
      }
      loadActiveSessions(); loadWorkspaces(); setDispatchOpen(true)
    }
    async function doDispatchConfirm() {
      const selected = selectedRef.current
      const dispatching = store.modal.dispatch.get().dispatching
      const dispatchMode = store.modal.dispatch.get().mode
      const dispatchInstr = store.modal.dispatch.get().instr
      const dispatchWsId = store.modal.dispatch.get().wsId
      const dispatchSessId = store.modal.dispatch.get().sessId
      const wsList = store.modal.dispatch.get().wsList
      const activeSessions = store.modal.dispatch.get().activeSessions
      const dispatchSched = store.modal.dispatch.get().sched
      const dispatchEditId = store.modal.dispatch.get().editId
      const dispatchEditNote = store.modal.dispatch.get().editNote
      const dispatchSchedNew = store.modal.dispatch.get().schedNew
      if (dispatching) return
      // 定时执行 / 编辑排定分支（notes-034-sched-ui）：创建/更新 dispatch-schedule 约定笔记（表单与 front-matter 同源，无第二份存储）
      if (dispatchSched || dispatchEditId) {
        if (!dispatchEditId && !selected) { setError(t('editor.selectNoteFirst')); return }
        if (!dispatchSessId && !dispatchSchedNew) { setError(t('disp.needSession')); return }
        const f = schedFormDecl(store.modal.dispatch.get().schedMode, store.modal.dispatch.get().schedN, store.modal.dispatch.get().schedAt, store.modal.dispatch.get().schedAnchor, store.modal.dispatch.get().schedDow)
        if (f.err) { setError(f.err); return }
        setDispatching(true); setError('')
        try {
          /* 编辑保留原 enabled 态（暂停的任务改排定不被意外拉起）；创建默认 enabled=true；周期模式携锚定时刻 anchor/dow（notes-034-sched-time）；
             0.4.4-B：专属会话开关 → target='new'（首轮触发 host 自动创建「定时 · 任务名」会话并回写复用） */
          const decl = { target: dispatchSchedNew ? 'new' : dispatchSessId, action: 'dispatch', enabled: dispatchEditId ? (dispatchEditNote.schedule.enabled !== false) : true }
          if (f.decl.at) decl.at = f.decl.at; else { decl.every = f.decl.every; decl.anchor = f.decl.anchor; if (typeof f.decl.dow === 'number') decl.dow = f.decl.dow }
          const nextTxt = fmtDT(new Date(schedDeclNextMs(f.decl, dispatchEditNote)).toISOString())
          let res
          if (dispatchEditId) res = await rpc('notes-update', { id: dispatchEditId, schedule: decl })
          else {
            /* 正文人话 = 原待办正文 + 补充指令（即被派发的工作内容本身）；标题自动「定时 」前缀
               （数据层保留中文：schedPeerKey 前缀正则跨语言匹配同口径；「补充指令：」check 50 断言锚定——i18n 覆盖卡E 不抽串） */
            const g0 = await rpc('notes-get', { id: selected })
            const src = (g0 && g0.note) || {}
            const body = String(src.body || '').trim() + (String(dispatchInstr || '').trim() ? '\n\n补充指令：' + String(dispatchInstr).trim() : '') + '\n'
            res = await rpc('notes-create', { title: '定时 ' + (src.title || 'Untitled'), body: body, kind: 'todo', contractType: 'dispatch-schedule', schedule: decl })
          }
          if (res && res.error) { setError(res.error); setDispatching(false); return }
          setDispatchOpen(false); setDispatchInstr('')
          showToast(t(dispatchEditId ? 'disp.schedUpdated' : 'disp.schedDone', { time: nextTxt }))
          await panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) } finally { setDispatching(false) }
        return
      }
      if (!selected) return
      setDispatching(true); setError('')
      try {
        if (dispatchMode === 'new') {
          // 新建会话派发：client connectWorkspace 复用/新建一个 live 会话，再注入上下文+触发工作
          if (!dispatchWsId) { setError(t('disp.needWorkspace')); setDispatching(false); return }
          if (!workspaces || !workspaces.connectWorkspace) { setError(t('disp.noWsService')); setDispatching(false); return }
          const ws = wsList.find(w => w.id === dispatchWsId)
          const newSid = await workspaces.connectWorkspace(dispatchWsId)
          /* '新会话' 兜底名写入 dispatches 元数据（数据层保留中文——i18n 覆盖卡E 不抽串） */
          const res = await rpc('notes-dispatch', { id: selected, sessionId: newSid, sessionName: (ws ? ws.title : '新会话'), workspace: ws ? ws.title : '', mode: 'new', instruction: dispatchInstr })
          if (res && res.error) { setError(res.error); setDispatching(false); return }
          if (sessions && newSid) { try { sessions.open(newSid) } catch (e) {} }
          showToast(t('disp.newSessDone'))
        } else {
          // 已有会话派发
          if (!dispatchSessId) { setError(t('disp.needSession')); setDispatching(false); return }
          const sess = activeSessions.find(s => s.id === dispatchSessId)
          // 0.4.4-B 休眠送达：目标不 live 不再强开唤醒（零成本送达红线）——host 持久化排队，会话下次活动时处理
          const res = await rpc('notes-dispatch', { id: selected, sessionId: dispatchSessId, sessionName: sess ? sess.name : '', workspace: sess ? sess.workspace : '', mode: 'existing', instruction: dispatchInstr })
          if (res && res.error) { setError(res.error); setDispatching(false); return }
          showToast(t(res && res.queued ? 'disp.dispatchedQueued' : 'disp.dispatched', { name: sess ? sess.name : '' }))
        }
        setDispatchOpen(false); setDispatchInstr('')
        const g = await rpc('notes-get', { id: selected }); if (g && g.note) panelBridge.setEdBody(g.note.body || '')
        await panelBridge.loadNotes(true); notifyNotesChanged()
      } catch (err) { setError(String(err.message || err)) } finally { setDispatching(false) }
    }
    // 标记一条派发待办为完成（停止注入目标会话系统提示）
    async function doDispatchDone(origIndex) {
      const selected = selectedRef.current
      try {
        const r = await rpc('notes-dispatch-done', { id: selected, dispatchIndex: origIndex })
        if (r && r.error) { setError(r.error); return }
        showToast(t('disp.markedDone')); await panelBridge.loadNotes(true); notifyNotesChanged()
      } catch (err) { setError(String(err.message || err)) }
    }
    // 派发对话框宿主（modal）：todo 上下文预览 + 补充具体要求 + 调度区（立即派发/定时执行）+ 已有/新建会话（级联下拉）
    function DispatchModal(props) {
      const tt = useT()   // i18n 覆盖卡E：订阅 langStore，切语言本卡自渲染（模块级 handler 走 t() 直读当下语言态）
      const dispatchOpen = store.modal.dispatch.useSel(s => s.open)
      const activeSessions = store.modal.dispatch.useSel(s => s.activeSessions)
      const dispatchPending = store.modal.dispatch.useSel(s => s.pending)
      const dispatching = store.modal.dispatch.useSel(s => s.dispatching)
      const dispatchMode = store.modal.dispatch.useSel(s => s.mode)
      const dispatchInstr = store.modal.dispatch.useSel(s => s.instr)
      const dispatchWsId = store.modal.dispatch.useSel(s => s.wsId)
      const dispatchSessWs = store.modal.dispatch.useSel(s => s.sessWs)
      const dispatchSessId = store.modal.dispatch.useSel(s => s.sessId)
      const wsList = store.modal.dispatch.useSel(s => s.wsList)
      const dispatchSched = store.modal.dispatch.useSel(s => s.sched)
      const dispatchSchedMode = store.modal.dispatch.useSel(s => s.schedMode)
      const dispatchSchedN = store.modal.dispatch.useSel(s => s.schedN)
      const dispatchSchedAt = store.modal.dispatch.useSel(s => s.schedAt)
      const dispatchSchedAnchor = store.modal.dispatch.useSel(s => s.schedAnchor)
      const dispatchSchedDow = store.modal.dispatch.useSel(s => s.schedDow)
      const dispatchSchedNew = store.modal.dispatch.useSel(s => s.schedNew)
      const dispatchEditId = store.modal.dispatch.useSel(s => s.editId)
      const dispatchEditNote = store.modal.dispatch.useSel(s => s.editNote)
      const error = props.error
      const curNote = props.curNote
      const schedOn = dispatchSched || !!dispatchEditId   // 定时形态（手动派发零干扰：缺省收起 = 立即派发）
      const showNote = dispatchEditNote || curNote        // 编辑模式预览调度约定笔记本身
      // 调度表单即时校验 + 下次触发预览（内联，禁原生 prompt）
      const schedForm = schedOn ? schedFormDecl(dispatchSchedMode, dispatchSchedN, dispatchSchedAt, dispatchSchedAnchor, dispatchSchedDow) : null
      // 派发对话框：已有会话模式按工作区过滤活跃会话；新建会话模式选工作区
      const dispatchWsKeys = []
      const dispatchSessByWs = {}
      for (const s of activeSessions) { const w = s.workspace || tt('meta.wsOther'); if (!dispatchSessByWs[w]) { dispatchSessByWs[w] = []; dispatchWsKeys.push(w) } dispatchSessByWs[w].push(s) }
      // 标题后台补齐中的占位会话（0.1.7）：同一下拉按工作区分组，禁用
      for (const p of dispatchPending) { const w = p.workspace || tt('meta.wsOther'); if (!dispatchSessByWs[w]) { dispatchSessByWs[w] = []; dispatchWsKeys.push(w) } dispatchSessByWs[w].push({ id: p.id, short: p.short, name: '', pending: true }) }
      return (dispatchOpen && showNote) ? e('div', { className: 'dsh-notes-dispatch-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setDispatchOpen(false) } },
        e('div', { className: 'dsh-notes-dispatch-modal' },
          e('div', { className: 'dsh-notes-dispatch-modal-t' }, I(dispatchEditId ? 'clock' : 'play', 13), ' ' + (dispatchEditId ? tt('disp.editTitle') : tt('disp.title')), e('span', { style: { fontSize: '10px', color: 'var(--nt3)', fontWeight: 400, marginLeft: '8px' } }, dispatchEditId ? tt('disp.editSub') : tt('disp.subCounts', { ws: wsList.length, n: activeSessions.length, pending: dispatchPending.length ? tt('disp.sessPending', { n: dispatchPending.length }) : '' }))),
          e('div', { className: 'dsh-notes-dispatch-todo' },
            e('div', { className: 'dsh-notes-dispatch-todo-t' }, showNote.title || 'Untitled'),
            e('div', { className: 'dsh-notes-dispatch-todo-b' }, String(showNote.preview || '').trim() || tt('disp.noBody'))),
          dispatchEditId ? null : e('textarea', { className: 'dsh-notes-dispatch-instr', placeholder: tt('disp.instrPlaceholder'), value: dispatchInstr, onChange: (ev) => setDispatchInstr(ev.target.value), rows: 3 }),
          // 调度区（notes-034-sched-ui）：默认收起 = 立即派发；「定时执行」展开频率设置；编辑模式固定定时形态（不再给「立即派发」岔路）
          e('div', { className: 'dsh-notes-sched-box' },
            dispatchEditId ? null : e(React.Fragment, null,
              e('label', { className: 'dsh-notes-sched-opt' }, e('input', { type: 'radio', name: 'dTrig', checked: !dispatchSched, onChange: () => setDispatchSched(false) }), ' ' + tt('disp.now')),
              e('label', { className: 'dsh-notes-sched-opt' }, e('input', { type: 'radio', name: 'dTrig', checked: !!dispatchSched, onChange: () => setDispatchSched(true) }), ' ' + tt('disp.scheduled'))),
            schedOn ? e('div', { className: 'dsh-notes-sched-form' },
              e('select', { className: 'dsh-notes-dispatch-select dsh-notes-sched-sel', value: dispatchSchedMode, onChange: (ev) => { setDispatchSchedMode(ev.target.value); if (ev.target.value === 'once') setDispatchSchedNew(false) } },
                e('option', { value: 'daily' }, tt('common.schedDaily')),
                e('option', { value: 'weekly' }, tt('common.schedWeekly')),
                e('option', { value: 'ndays' }, tt('disp.modeNDays')),
                e('option', { value: 'once' }, tt('disp.modeOnce'))),
              dispatchSchedMode === 'ndays' ? e('span', null, e('input', { className: 'dsh-notes-dispatch-select dsh-notes-sched-n', type: 'number', min: 1, step: 1, value: dispatchSchedN, onChange: (ev) => setDispatchSchedN(ev.target.value) }), ' ' + tt('disp.ndaysUnit')) : null,
              // 锚定时刻（notes-034-sched-time）：每周出星期几选择；周期三模式出时刻框（默认 09:00）；仅一次保持 datetime-local
              dispatchSchedMode === 'weekly' ? e('select', { className: 'dsh-notes-dispatch-select dsh-notes-sched-sel', value: dispatchSchedDow, onChange: (ev) => setDispatchSchedDow(parseInt(ev.target.value, 10)) },
                [1, 2, 3, 4, 5, 6, 0].map(d => e('option', { key: d, value: d }, tt('disp.dowOption', { dow: tt('common.dowNames').split('|')[d] || '' })))) : null,
              dispatchSchedMode !== 'once' ? e('input', { className: 'dsh-notes-dispatch-select dsh-notes-sched-at', type: 'time', value: dispatchSchedAnchor, onChange: (ev) => setDispatchSchedAnchor(ev.target.value) }) : null,
              dispatchSchedMode === 'once' ? e('input', { className: 'dsh-notes-dispatch-select dsh-notes-sched-at', type: 'datetime-local', value: dispatchSchedAt, onChange: (ev) => setDispatchSchedAt(ev.target.value) }) : null,
              e('div', { className: 'dsh-notes-sched-next' + (schedForm && schedForm.err ? ' warn' : '') }, schedForm && schedForm.err ? ('⚠ ' + schedForm.err) : tt('disp.nextTrigger', { time: fmtDT(new Date(schedDeclNextMs(schedForm.decl, dispatchEditNote)).toISOString()) })),
              // 专属会话（0.4.4-B）：周期模式可勾 target='new'——首轮触发 host 自动创建「定时 · 任务名」会话并回写复用；仅一次（at）无复用场景不提供
              dispatchSchedMode !== 'once' ? e('label', { className: 'dsh-notes-sched-opt' }, e('input', { type: 'checkbox', checked: dispatchSchedNew, onChange: (ev) => setDispatchSchedNew(ev.target.checked) }), ' ' + tt('disp.schedNew')) : null) : null),
          // 已有/新建会话切换：定时形态下隐藏（定时仅已有会话——新建会话无未来目标意义）
          schedOn ? null : e('div', { className: 'dsh-notes-dispatch-modes' },
            e('button', { className: 'dsh-notes-dispatch-mode' + (dispatchMode === 'existing' ? ' on' : ''), onClick: () => setDispatchMode('existing') }, tt('disp.modeExisting')),
            e('button', { className: 'dsh-notes-dispatch-mode' + (dispatchMode === 'new' ? ' on' : ''), onClick: () => setDispatchMode('new') }, tt('disp.modeNew'))),
          // 专属会话勾选后隐藏级联选择（目标由 host 首轮创建，无既有会话可选）
          (dispatchMode === 'existing' || schedOn) && !(schedOn && dispatchSchedNew) ? e(React.Fragment, null,
            e('select', { className: 'dsh-notes-dispatch-select', value: dispatchSessWs, onChange: (ev) => { setDispatchSessWs(ev.target.value); setDispatchSessId('') } },
              e('option', { value: '' }, tt('disp.pickWs')),
              wsList.map(w => e('option', { key: w.id, value: w.title }, w.title))),
            e('select', { className: 'dsh-notes-dispatch-select', value: dispatchSessId, onChange: (ev) => setDispatchSessId(ev.target.value), disabled: !dispatchSessWs },
              e('option', { value: '' }, dispatchSessWs ? ((dispatchSessByWs[dispatchSessWs] || []).length ? tt('disp.pickSess') : tt('disp.noSessInWs')) : tt('disp.pickWsFirst')),
              (dispatchSessByWs[dispatchSessWs] || []).map(s => e('option', { key: s.id, value: s.id, disabled: !!s.pending }, s.pending ? tt('meta.scopePending', { short: s.short }) : (s.name + (s.live ? '' : tt('disp.notLiveSuffix')))))))
          : e('select', { className: 'dsh-notes-dispatch-select', value: dispatchWsId, onChange: (ev) => setDispatchWsId(ev.target.value) },
              e('option', { value: '' }, tt('disp.pickWsNew')),
              wsList.map(w => e('option', { key: w.id, value: w.id }, w.title))),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setDispatchOpen(false) }, tt('common.cancel')),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doDispatchConfirm, disabled: dispatching }, dispatching ? (dispatchEditId ? tt('settings.saving') : schedOn ? tt('disp.savingSched') : tt('disp.dispatching')) : (dispatchEditId ? tt('disp.saveSched') : tt('disp.ok'))))))
      : null
    }
    // ===== modal: cheatsheet —— 键盘流快捷键速查表（notes-034-f-cheatsheet：? 键唤起 + 设置卡入口）=====
    // provides: store.modal.cheatsheet / cheatsheetOpenRef / setCheatsheetOpen / openCheatsheet / CHEATSHEET_ROWS / CheatsheetModal
    // needs: kernel/state.js（store/createStore/panelBridge/setShowHelp 别名）、kernel/icons.js（e/I）
    // state 托管：open 迁入 store.modal.cheatsheet 切片；cheatsheetOpenRef 为 Esc 栈 / ? 键守卫的同步镜像
    // （模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）
    // 键位清单与 panels/panel/keyboard.js 实现逐键核对（R-4 口径）：增改快捷键时必须同步本表 + app 页/原型同款表
    store.modal.cheatsheet = createStore({ open: false })
    const cheatsheetOpenRef = { current: false }   // 速查表镜像（Esc 优先关 / ? 键 toggle / 列表导航暂停）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：同步写 ref 镜像 + store（订阅方 = CheatsheetModal）
    function setCheatsheetOpen(v) { const nv = typeof v === 'function' ? v(cheatsheetOpenRef.current) : v; cheatsheetOpenRef.current = nv; store.modal.cheatsheet.set({ open: nv }) }
    // 打开入口（设置卡「键盘快捷键」行 / ? 键）：与设置卡片互斥（modal 不叠 modal，同注入管理先例）；帮助气泡同时收起
    function openCheatsheet() { panelBridge.setSettingsOpen(false); setShowHelp(false); setCheatsheetOpen(true) }
    // 键位表（与 keyboard.js 逐键核对，R-4 口径）：[键帽文案, 说明字典 key]——Ctrl+N 已改 Alt+N 的标注在此收口
    // i18n 覆盖卡E：说明列改存字典 key（cheat.*），渲染期 tt() 取值（Esc 行面板口径 = cheat.kEscClient；app 页面口径 = cheat.kEsc）
    const CHEATSHEET_ROWS = [
      ['Ctrl+K', 'cheat.kSearch'],
      ['Alt+N', 'cheat.kNew'],
      ['Ctrl+/', 'cheat.kMode'],
      ['j / ↓', 'cheat.kDown'],
      ['k / ↑', 'cheat.kUp'],
      ['Enter', 'cheat.kOpen'],
      ['↓', 'cheat.kSearchDown'],
      ['?', 'cheat.kSelf'],
      ['Esc', 'cheat.kEscClient'],
    ]
    // 速查表弹层宿主：复用设置卡片 mask/modal 样式（modal 不叠 modal）；Esc 关闭由 keyboard.js Esc 栈首段接管
    function CheatsheetModal() {
      const tt = useT()   // i18n 覆盖卡E：订阅 langStore，切语言本卡自渲染
      const cheatsheetOpen = store.modal.cheatsheet.useSel(s => s.open)
      return cheatsheetOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setCheatsheetOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-cheatsheet-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('kbd', 14), ' ' + tt('settings.cheatsheet'),
            e('span', { className: 'dsh-notes-settings-t-acts' },
              e('button', { className: 'dsh-notes-settings-close dsh-nt', 'data-tooltip': tt('cheat.closeTip'), onClick: () => setCheatsheetOpen(false) }, I('x', 12)))),
          e('div', { className: 'dsh-notes-data-hint' }, tt('cheat.hint')),
          e('div', { className: 'dsh-notes-cheatsheet-list' },
            CHEATSHEET_ROWS.map(r => e('div', { key: r[0], className: 'dsh-notes-cs-row' },
              e('span', { className: 'dsh-notes-cs-keys' }, e('kbd', null, r[0])),
              e('span', { className: 'dsh-notes-cs-desc' }, tt(r[1])))))))
        : null
    }
    // ===== modal: settings —— 设置卡片（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出；D2 收尾模块，序位最末）=====
    // provides: store.modal.settings / settingsOpenRef / usageBudgetRef / setPersistRef / settingsFlushRef / setSettingsOpen / setSettingsData /
    //           setSetLlmProvider / setSetLlmModel / setSetStale / setSetBudget / setUsageData / setSetUsageBudget /
    //           setSetSaving / setSetLogWeek / setSetLogRetention / openSettings / maybeToastUsageBudget /
    //           settingsSetQuiet / setPersistMerge / saveSettings*（Llm/Stale/MaxDepth/Budget/UsageBudget/LlmManual/LogWeek/LogRetention）/
    //           SET_NUM_FIELDS / saveSettingsAll / restoreSettingsAll / flushSettingsPending / closeSettings / SettingsModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/format.js（fmtTok）、kernel/icons.js（e/I）、kernel/bus.js（showToast）、
    //        kernel/i18n.js（langStore/useT/setLang——语言项，notes-042-i18n-mech）、
    //        modals/export.js + export-single.js + import.js + trash.js + prune.js + suggest.js + inject-preview.js + inject-manager.js + memory-guide.js
    //        + cheatsheet.js（设置行入口 open*/do*/memViewNote 与 setMemStatus——序位在前可见，非横向引用）
    // state 托管：open/data/llmProvider/llmModel/stale/budget/usageData/usageBudget/saving/logWeek/logRetention
    // （0.4.4-E：catalog 目录补充行开关随功能整体拆除——设置卡无此控件，host settings-set 对旧设置键静默忽略）
    // 迁入 store.modal.settings 切片；maxDepth/snap/inflight 因 check 锚定其 useState 声明原文滞留 whole.js（同 newNoteKind 先例）——
    // 组件经 props 注入，模块函数经 panelBridge.setMaxDepth/setSetMaxDepth/setSnap/setSetSnap/setInflight/setSetInflight 中转；
    // settingsOpenRef（Esc 栈）/usageBudgetRef（预算判定）/setPersistRef（已落盘镜像）/settingsFlushRef（Esc 兜底 flush）
    // 为模块级单例（plain object 与 useRef 等价——面板为 shell.overlay 单例）；whole.js 经 panelBridge.setSettingsOpen 回填别名中转互斥关闭
    store.modal.settings = createStore({ open: false, data: null, llmProvider: '', llmModel: '', stale: '90', budget: '0', usageData: null, usageBudget: '0', saving: false, logWeek: '7', logRetention: '90' })
    const settingsOpenRef = { current: false }   // 设置卡片镜像（Esc 优先关设置卡片）
    const usageBudgetRef = { current: 0 }   // 预算镜像 ref：usage-get 与 settings-get 并发放射，toast 判定读 ref 防闭包过期
    const setPersistRef = { current: null }   // 已落盘值镜像（兜底 flush/还原只写真不同的键）
    const settingsFlushRef = { current: null }   // 关闭兜底 flush 镜像（Esc 闭包挂一次，读最新控件值）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setSettingsOpen(v) { const nv = typeof v === 'function' ? v(settingsOpenRef.current) : v; settingsOpenRef.current = nv; store.modal.settings.set({ open: nv }) }
    function setSettingsData(v) { store.modal.settings.set({ data: typeof v === 'function' ? v(store.modal.settings.get().data) : v }) }
    function setSetLlmProvider(v) { store.modal.settings.set({ llmProvider: typeof v === 'function' ? v(store.modal.settings.get().llmProvider) : v }) }
    function setSetLlmModel(v) { store.modal.settings.set({ llmModel: typeof v === 'function' ? v(store.modal.settings.get().llmModel) : v }) }
    function setSetStale(v) { store.modal.settings.set({ stale: typeof v === 'function' ? v(store.modal.settings.get().stale) : v }) }
    function setSetBudget(v) { store.modal.settings.set({ budget: typeof v === 'function' ? v(store.modal.settings.get().budget) : v }) }
    function setUsageData(v) { store.modal.settings.set({ usageData: typeof v === 'function' ? v(store.modal.settings.get().usageData) : v }) }
    function setSetUsageBudget(v) { store.modal.settings.set({ usageBudget: typeof v === 'function' ? v(store.modal.settings.get().usageBudget) : v }) }
    function setSetSaving(v) { store.modal.settings.set({ saving: typeof v === 'function' ? v(store.modal.settings.get().saving) : v }) }
    function setSetLogWeek(v) { store.modal.settings.set({ logWeek: typeof v === 'function' ? v(store.modal.settings.get().logWeek) : v }) }
    function setSetLogRetention(v) { store.modal.settings.set({ logRetention: typeof v === 'function' ? v(store.modal.settings.get().logRetention) : v }) }
    // 设置卡片：打开即拉取 settings + 可用模型列表（host 探 llm 服务目录；探不到时 models=[]，控件退化为手输）
    function openSettings() {
      setSetLlmProvider(''); setSetLlmModel(''); setSettingsData(null); setUsageData(null); setError(''); setSettingsOpen(true)
      panelBridge.setSetSnap(null); setPersistRef.current = null; setSetSaving(false)   // dirty 基准复位（加载完成后再捕获快照）
      // LLM 用量统计接力 settings 拉取（预算 ref 就绪后再判超预算 toast，避免并发竞态漏提醒；settings-get 为本地 RPC 不慢）：
      // 今日/本周/本月/累计 + 按功能分列；超月度预算仅 toast 提醒，不阻断
      const loadUsage = () => rpc('notes-usage-get', {}).then(res => {
        if (!res || res.error) return
        setUsageData(res)
        maybeToastUsageBudget(res)
      }).catch(() => {})
      rpc('notes-settings-get', {}).then(res => {
        if (!res) { loadUsage(); return }
        setSettingsData(res)
        const l = res.settings && res.settings.llm
        if (l && l.provider && l.model) { setSetLlmProvider(l.provider); setSetLlmModel(l.model) }
        setSetStale(String(res.settings && typeof res.settings.staleDays === 'number' ? res.settings.staleDays : 90))   // 时效提醒阈值：缺省 90
        panelBridge.setSetMaxDepth(String(res.settings && typeof res.settings.maxFolderDepth === 'number' ? res.settings.maxFolderDepth : 3))   // 文件夹嵌套深度上限：缺省 3（0=不限）
        setSetBudget(String(res.settings && typeof res.settings.injectBudgetChars === 'number' ? res.settings.injectBudgetChars : 0))   // 注入预算：缺省 0=不限
        setSetUsageBudget(String(res.settings && typeof res.settings.usageBudgetMonthly === 'number' ? res.settings.usageBudgetMonthly : 0))   // 月度用量预算提醒：缺省 0=关闭
        usageBudgetRef.current = (res.settings && typeof res.settings.usageBudgetMonthly === 'number') ? res.settings.usageBudgetMonthly : 0
        setSetLogWeek(String(res.settings && typeof res.settings.logWeekAfterDays === 'number' ? res.settings.logWeekAfterDays : 7))   // 工作记忆 v0：日志周聚合窗口，缺省 7
        setSetLogRetention(String(res.settings && typeof res.settings.logRetentionDays === 'number' ? res.settings.logRetentionDays : 90))   // 日志月聚合窗口，缺省 90（0=关闭本级）
        // dirty/还原基准（notes-settings-feedback）：打开时快照（UI 形态字符串口径，与控件受控值同构）+ 已落盘镜像初始化
        const snap0 = {
          llmP: (l && l.provider && l.model) ? l.provider : '', llmM: (l && l.provider && l.model) ? l.model : '',
          stale: String(res.settings && typeof res.settings.staleDays === 'number' ? res.settings.staleDays : 90),
          maxDepth: String(res.settings && typeof res.settings.maxFolderDepth === 'number' ? res.settings.maxFolderDepth : 3),
          budget: String(res.settings && typeof res.settings.injectBudgetChars === 'number' ? res.settings.injectBudgetChars : 0),
          usageBudget: String(res.settings && typeof res.settings.usageBudgetMonthly === 'number' ? res.settings.usageBudgetMonthly : 0),
          logWeek: String(res.settings && typeof res.settings.logWeekAfterDays === 'number' ? res.settings.logWeekAfterDays : 7),
          logRetention: String(res.settings && typeof res.settings.logRetentionDays === 'number' ? res.settings.logRetentionDays : 90),
        }
        panelBridge.setSetSnap(snap0); setPersistRef.current = snap0
        loadUsage()
      }).catch(() => { loadUsage() })
      // 工作记忆 v0：沉淀引导启用状态探测（单一事实源 = tag memory-guide 且 inject=true 的笔记，不落 settings.json）
      setMemStatus(null)
      rpc('notes-memory-guide', { op: 'status' }).then(res => {
        setMemStatus(res && !res.error ? res : { enabled: false, noteId: '' })
      }).catch(() => setMemStatus({ enabled: false, noteId: '' }))
    }
    // 月度预算提醒：usage.month.total 超 usageBudgetMonthly → toast（仅提醒，不阻断）；budget 读 ref（settings-get/保存预算时同步）
    function maybeToastUsageBudget(u) {
      try {
        const b = usageBudgetRef.current
        if (b > 0 && u && u.month && u.month.total > b) showToast(t('settings.usageOverBudget', { used: fmtTok(u.month.total), budget: fmtTok(b) }))
      } catch (e) {}
    }
    // ===== 设置写通道（notes-settings-feedback）：settingsSetQuiet = 全部 settings-set 的低层共用通道 =====
    // 在途计数（dirty 口径「存在尚未落盘的待写」）+ 已落盘镜像逐键跟进；不 toast——自动保存 saver 自带文案，保存/还原/兜底 flush 统一收口
    function settingsSetQuiet(patch) {
      panelBridge.setSetInflight(n => n + 1)
      return rpc('notes-settings-set', patch).then(res => {
        panelBridge.setSetInflight(n => Math.max(0, n - 1))
        if (res && res.error) throw new Error(res.error)
        if (res && res.settings) setSettingsData(prev => Object.assign({}, prev || {}, { settings: res.settings }))
        setPersistMerge(patch)
        return res
      }, err => { panelBridge.setSetInflight(n => Math.max(0, n - 1)); throw err })
    }
    // 已落盘镜像逐键跟进（写成功后才调；UI 形态字符串口径与快照同构）
    function setPersistMerge(patch) {
      const p = setPersistRef.current; if (!p) return
      const n = Object.assign({}, p)
      if ('llm' in patch) { n.llmP = patch.llm ? patch.llm.provider : ''; n.llmM = patch.llm ? patch.llm.model : '' }
      if ('staleDays' in patch) n.stale = String(patch.staleDays)
      if ('maxFolderDepth' in patch) n.maxDepth = String(patch.maxFolderDepth)
      if ('injectBudgetChars' in patch) n.budget = String(patch.injectBudgetChars)
      if ('usageBudgetMonthly' in patch) n.usageBudget = String(patch.usageBudgetMonthly)
      if ('logWeekAfterDays' in patch) n.logWeek = String(patch.logWeekAfterDays)
      if ('logRetentionDays' in patch) n.logRetention = String(patch.logRetentionDays)
      setPersistRef.current = n
    }
    // 选择即保存：llm=null 恢复跟随当前会话（默认）；否则保存 { provider, model }
    function saveSettingsLlm(llm) {
      settingsSetQuiet({ llm: llm }).then(() => {
        showToast(llm ? t('settings.savedLlm', { name: llm.provider + ' / ' + llm.model }) : t('settings.restoredFollow'))
      }).catch(err => setError(String(err.message || err)))
    }
    // P1 时效衰减提醒阈值：失焦/Enter 即保存（非负整数；0 = 关闭；非法输入报错不落盘）
    function saveSettingsStale() {
      const setStale = store.modal.settings.get().stale
      const raw = setStale.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.staleInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ staleDays: v }).then(() => {
        showToast(v === 0 ? t('settings.staleOff') : t('settings.savedStale', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // 文件夹嵌套深度上限（maxFolderDepth，层；根级=第 1 层，缺省 3，0=不限）：失焦/Enter 即保存（非负整数；非法输入报错不落盘）
    function saveSettingsMaxDepth() {
      const setMaxDepth = panelBridge.setMaxDepth
      const raw = setMaxDepth.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.maxDepthInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ maxFolderDepth: v }).then(() => {
        showToast(v === 0 ? t('settings.maxDepthUnlimited') : t('settings.savedMaxDepth', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // P1 注入体积预算（约，字符数）：失焦/Enter 即保存（非负整数；0 = 不限；约定条目永不截断）
    function saveSettingsBudget() {
      const setBudget = store.modal.settings.get().budget
      const raw = setBudget.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.budgetInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ injectBudgetChars: v }).then(() => {
        showToast(v === 0 ? t('settings.budgetOff') : t('settings.savedBudget', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // LLM 月度用量预算提醒（tokens/月）：失焦/Enter 即保存（非负整数；0 = 关闭提醒）；保存后即按当前用量复核一次（超预算 toast，不阻断）
    function saveSettingsUsageBudget() {
      const setUsageBudget = store.modal.settings.get().usageBudget
      const usageData = store.modal.settings.get().usageData
      const raw = setUsageBudget.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.usageBudgetInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ usageBudgetMonthly: v }).then(() => {
        usageBudgetRef.current = v
        showToast(v === 0 ? t('settings.usageBudgetOff') : t('settings.savedUsageBudget', { v: fmtTok(v) }))
        if (usageData) maybeToastUsageBudget(usageData)
      }).catch(err => setError(String(err.message || err)))
    }
    // 手输模式（探不到模型列表时）：provider/model 两框齐备才保存；清除按钮恢复跟随会话
    function saveSettingsLlmManual() {
      const setLlmProvider = store.modal.settings.get().llmProvider
      const setLlmModel = store.modal.settings.get().llmModel
      const p = setLlmProvider.trim(), m = setLlmModel.trim()
      if (!p || !m) return
      saveSettingsLlm({ provider: p, model: m })
    }
    // ===== 工作记忆 v0：日志卫生窗口保存（设置卡片「工作记忆」区）=====
    // 日志周聚合窗口（天，缺省 7）：失焦/Enter 即保存（非负整数；非法输入报错不落盘）
    function saveSettingsLogWeek() {
      const setLogWeek = store.modal.settings.get().logWeek
      const raw = setLogWeek.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.logWeekInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ logWeekAfterDays: v }).then(() => {
        showToast(t('settings.savedLogWeek', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // 日志月聚合窗口（天，缺省 90；0 = 关闭月聚合本级）
    function saveSettingsLogRetention() {
      const setLogRetention = store.modal.settings.get().logRetention
      const raw = setLogRetention.trim()
      if (!/^\d+$/.test(raw)) { setError(t('settings.logMonthInvalid')); return }
      const v = parseInt(raw, 10)
      settingsSetQuiet({ logRetentionDays: v }).then(() => {
        showToast(v === 0 ? t('settings.logMonthOff') : t('settings.savedLogMonth', { v: v }))
      }).catch(err => setError(String(err.message || err)))
    }
    // ===== 设置卡交互反馈（notes-settings-feedback）：显式保存 / 还原 / 关闭兜底 flush =====
    // 数值字段登记表（快照键 ↔ 设置 RPC 键 ↔ 校验文案 i18n key）：保存校验/兜底 flush/还原回滚三处共用同一份口径
    // （第 3 列为字典 key，用时 t() 取当下语言——登记表在模块加载期求值，不能直接存译文）
    const SET_NUM_FIELDS = [
      ['stale', 'staleDays', 'settings.staleInvalid'],
      ['maxDepth', 'maxFolderDepth', 'settings.maxDepthInvalid'],
      ['budget', 'injectBudgetChars', 'settings.budgetInvalid'],
      ['usageBudget', 'usageBudgetMonthly', 'settings.usageBudgetInvalid'],
      ['logWeek', 'logWeekAfterDays', 'settings.logWeekInvalid'],
      ['logRetention', 'logRetentionDays', 'settings.logMonthInvalid'],
    ]
    // 「保存」：显式确认 + 兜底 flush——先校验全部数值字段（任一非法即中止并报错，改动保留继续编辑），
    // 再串行落盘全部「控件值 ≠ 已落盘」的键（串行防写竞态），全部成功后快照跟进 + toast「设置已保存」+ dirty 复位
    function saveSettingsAll() {
      const setSaving = store.modal.settings.get().saving
      const setSnap = panelBridge.setSnap
      const setStale = store.modal.settings.get().stale
      const setMaxDepth = panelBridge.setMaxDepth
      const setBudget = store.modal.settings.get().budget
      const setUsageBudget = store.modal.settings.get().usageBudget
      const setLogWeek = store.modal.settings.get().logWeek
      const setLogRetention = store.modal.settings.get().logRetention
      const setLlmProvider = store.modal.settings.get().llmProvider
      const setLlmModel = store.modal.settings.get().llmModel
      const settingsData = store.modal.settings.get().data
      if (setSaving || !setSnap) return
      const vals = { stale: setStale, maxDepth: setMaxDepth, budget: setBudget, usageBudget: setUsageBudget, logWeek: setLogWeek, logRetention: setLogRetention }
      for (const f of SET_NUM_FIELDS) { if (!/^\d+$/.test(vals[f[0]].trim())) { setError(t(f[2])); return } }
      const p = setPersistRef.current || setSnap
      const patches = []
      // 手输 LLM 两框齐备且 ≠ 已落盘才补写（下拉选择/开关变更即存无待写；单框不齐 = 存量失焦口径静默跳过）
      const models0 = (settingsData && settingsData.models) || []
      if (!models0.length && setLlmProvider.trim() && setLlmModel.trim() && (setLlmProvider !== p.llmP || setLlmModel !== p.llmM)) patches.push({ llm: { provider: setLlmProvider.trim(), model: setLlmModel.trim() } })
      for (const f of SET_NUM_FIELDS) { const raw = vals[f[0]].trim(); if (raw !== p[f[0]]) { const o = {}; o[f[1]] = parseInt(raw, 10); patches.push(o) } }
      setSetSaving(true)
      let seq = Promise.resolve()
      for (const pt of patches) seq = seq.then(() => settingsSetQuiet(pt))
      seq.then(() => {
        setSetSaving(false)
        // 快照跟进到当前控件值（显式确认完成 → dirty 复位，保存按钮回禁用态）
        panelBridge.setSetSnap({ llmP: setLlmProvider, llmM: setLlmModel, stale: setStale, maxDepth: setMaxDepth, budget: setBudget, usageBudget: setUsageBudget, logWeek: setLogWeek, logRetention: setLogRetention })
        usageBudgetRef.current = parseInt(setUsageBudget.trim(), 10)
        showToast(t('settings.savedAll'))
      }, err => { setSetSaving(false); setError(t('common.saveFailed', { msg: String(err && err.message || err) })) })
    }
    // 「还原」：回滚到打开时快照——已落盘 ≠ 快照的键逐键串行写回（逐键恢复），全部控件复位到快照值
    function restoreSettingsAll() {
      const setSaving = store.modal.settings.get().saving
      const setSnap = panelBridge.setSnap
      if (setSaving || !setSnap) return
      const s = setSnap, p = setPersistRef.current || s
      const patches = []
      if (p.llmP !== s.llmP || p.llmM !== s.llmM) patches.push({ llm: (s.llmP && s.llmM) ? { provider: s.llmP, model: s.llmM } : null })
      for (const f of SET_NUM_FIELDS) { if (p[f[0]] !== s[f[0]]) { const o = {}; o[f[1]] = parseInt(s[f[0]], 10); patches.push(o) } }
      setSetSaving(true)
      let seq = Promise.resolve()
      for (const pt of patches) seq = seq.then(() => settingsSetQuiet(pt))
      seq.then(() => {
        setSetSaving(false)
        setSetLlmProvider(s.llmP); setSetLlmModel(s.llmM)
        setSetStale(s.stale); panelBridge.setSetMaxDepth(s.maxDepth); setSetBudget(s.budget)
        setSetUsageBudget(s.usageBudget); setSetLogWeek(s.logWeek); setSetLogRetention(s.logRetention)
        usageBudgetRef.current = parseInt(s.usageBudget, 10)
        showToast(t('settings.restoredAll'))
      }, err => { setSetSaving(false); setError(t('settings.restoreFailed', { msg: String(err && err.message || err) })) })
    }
    // 关闭兜底 flush（✕/Esc/点遮罩同口径）：「控件值 ≠ 已落盘」的有效改动串行静默落盘；
    // 非法输入按存量口径丢弃（同关闭即弃）；≥1 项落盘则 toast 一次确认
    function flushSettingsPending() {
      const settingsData = store.modal.settings.get().data
      const setLlmProvider = store.modal.settings.get().llmProvider
      const setLlmModel = store.modal.settings.get().llmModel
      const setStale = store.modal.settings.get().stale
      const setMaxDepth = panelBridge.setMaxDepth
      const setBudget = store.modal.settings.get().budget
      const setUsageBudget = store.modal.settings.get().usageBudget
      const setLogWeek = store.modal.settings.get().logWeek
      const setLogRetention = store.modal.settings.get().logRetention
      const p = setPersistRef.current
      if (!p) return
      const patches = []
      const models0 = (settingsData && settingsData.models) || []
      if (!models0.length && setLlmProvider.trim() && setLlmModel.trim() && (setLlmProvider !== p.llmP || setLlmModel !== p.llmM)) patches.push({ llm: { provider: setLlmProvider.trim(), model: setLlmModel.trim() } })
      const vals = { stale: setStale, maxDepth: setMaxDepth, budget: setBudget, usageBudget: setUsageBudget, logWeek: setLogWeek, logRetention: setLogRetention }
      for (const f of SET_NUM_FIELDS) { const raw = vals[f[0]].trim(); if (/^\d+$/.test(raw) && raw !== p[f[0]]) { const o = {}; o[f[1]] = parseInt(raw, 10); patches.push(o) } }
      if (!patches.length) return
      let seq = Promise.resolve()
      for (const pt of patches) seq = seq.then(() => settingsSetQuiet(pt))
      seq.then(() => { showToast(t('settings.savedAll')) }, err => { showToast(t('settings.flushSaveFailed', { msg: String(err && err.message || err) })) })
    }
    // ✕/Esc/点遮罩统一关闭入口：有未落盘改动先兜底 flush（fire-and-forget，落盘完成自 toast），再收起
    function closeSettings() { flushSettingsPending(); setSettingsOpen(false) }
    // 设置卡片宿主（modal，居中，复用派发 modal 的 mask/modal 风格）：通用结构——标题「设置」+ 设置项行列表
    // （每行：左 label + 右控件）。以后加设置项只需往 settingsRows 数组加行，结构不变。
    // 交互（notes-settings-feedback）：自动保存保留（选择即存/失焦/Enter 即存，走 notes-settings-set）；
    // 标题栏 ✕ 常驻关闭 + dirty 态「保存」（accent 实心，显式确认 + 兜底 flush）/「还原」（回滚打开时快照）；
    // 点遮罩 / Esc = ✕ 同义（有未落盘改动先兜底 flush 再关，Esc 在全局 keydown 里优先关本卡片）。
    function SettingsModal(props) {
      const settingsOpen = store.modal.settings.useSel(s => s.open)
      const settingsData = store.modal.settings.useSel(s => s.data)
      const setLlmProvider = store.modal.settings.useSel(s => s.llmProvider)
      const setLlmModel = store.modal.settings.useSel(s => s.llmModel)
      const setStale = store.modal.settings.useSel(s => s.stale)
      const setBudget = store.modal.settings.useSel(s => s.budget)
      const usageData = store.modal.settings.useSel(s => s.usageData)
      const setUsageBudget = store.modal.settings.useSel(s => s.usageBudget)
      const setSaving = store.modal.settings.useSel(s => s.saving)
      const setLogWeek = store.modal.settings.useSel(s => s.logWeek)
      const setLogRetention = store.modal.settings.useSel(s => s.logRetention)
      // i18n 语言态（notes-042-i18n-mech）：订阅 langStore——切换语言本卡即时重渲染为新语言；tt = 本组件 t()
      const lang = langStore.useSel(s => s.lang)
      const tt = useT()
      // maxDepth/snap/inflight 滞留 whole.js（check 锚定 useState 声明原文），经 props 注入
      const setMaxDepth = props.setMaxDepth
      const setSetMaxDepth = props.setSetMaxDepth
      const setSnap = props.setSnap
      const setInflight = props.setInflight
      // 工作记忆 v0 状态行数据源（memory-guide 模块切片；设置卡「工作记忆」区状态行/停用按钮消费）
      const memStatus = store.modal.memory.useSel(s => s.status)
      const memPending = store.modal.memory.useSel(s => s.pending)
      const error = props.error
      React.useEffect(() => { settingsFlushRef.current = flushSettingsPending })   // 关闭兜底 flush 镜像：每渲染刷新（Esc 闭包读最新控件值；函数声明提升可前引）
      return settingsOpen ? (() => {
        // dirty 判定口径：存在在途未落盘待写（setInflight>0）或 任一控件值 ≠ 打开时快照
        const setDirty = setInflight > 0 || (setSnap ? (
          setLlmProvider !== setSnap.llmP || setLlmModel !== setSnap.llmM ||
          setStale !== setSnap.stale || setMaxDepth !== setSnap.maxDepth || setBudget !== setSnap.budget ||
          setUsageBudget !== setSnap.usageBudget || setLogWeek !== setSnap.logWeek || setLogRetention !== setSnap.logRetention) : false)
        const modelList = (settingsData && settingsData.models) || []
        // 下拉选项 = provider/model 组合，第一项「跟随当前会话（默认）」；
        // 已保存值不在列表中（如模型已下线）时追加一项保证回显正确
        const selIdx = modelList.findIndex(m => m.provider === setLlmProvider && m.model === setLlmModel)
        const opts = (setLlmProvider && setLlmModel && selIdx < 0)
          ? modelList.concat([{ provider: setLlmProvider, model: setLlmModel, label: setLlmProvider + ' / ' + setLlmModel + tt('settings.savedSuffix') }])
          : modelList
        const curVal = selIdx >= 0 ? String(selIdx) : (opts.length > modelList.length ? String(opts.length - 1) : '')
        const llmControl = modelList.length
          ? e('select', { className: 'dsh-notes-settings-select', value: curVal, 'data-tooltip': tt('settings.llmTip'), onChange: (ev) => {
                const v = ev.target.value
                if (v === '') { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) }
                else { const m = opts[+v]; if (m) { setSetLlmProvider(m.provider); setSetLlmModel(m.model); saveSettingsLlm({ provider: m.provider, model: m.model }) } }
              } },
              e('option', { value: '' }, tt('settings.followSession')),
              opts.map((m, i) => e('option', { key: m.provider + '/' + m.model + '-' + i, value: String(i) }, m.label || (m.provider + ' / ' + m.model))))
          : e(React.Fragment, null,
              e('input', { className: 'dsh-notes-settings-input', placeholder: 'provider', value: setLlmProvider, onChange: (ev) => setSetLlmProvider(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
              e('input', { className: 'dsh-notes-settings-input', placeholder: 'model', value: setLlmModel, onChange: (ev) => setSetLlmModel(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
              (setLlmProvider || setLlmModel) ? e('button', { className: 'dsh-notes-settings-clear', onClick: () => { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) } }, tt('settings.followSession')) : null)
        // P1 时效衰减提醒控件：数值输入（天），失焦/Enter 即保存；0 = 关闭
        const staleControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setStale, 'data-tooltip': tt('settings.staleTipT'), onChange: (ev) => setSetStale(ev.target.value), onBlur: saveSettingsStale, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsStale() } })
        // 文件夹嵌套深度上限控件（同 staleDays 输入交互）：数值输入（层），失焦/Enter 即保存；0 = 不限层数
        const maxDepthControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setMaxDepth, 'data-tooltip': tt('settings.maxDepthTipT'), onChange: (ev) => setSetMaxDepth(ev.target.value), onBlur: saveSettingsMaxDepth, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsMaxDepth() } })
        // P1 注入体积预算控件：数值输入（约，字符数）+ 仪表（最近一次注入体积 vs 预算，超预算变红）；约定条目永不截断
        const lastChars = (settingsData && typeof settingsData.lastInjectChars === 'number') ? settingsData.lastInjectChars : 0
        const budgetNum = /^\d+$/.test(setBudget.trim()) ? parseInt(setBudget.trim(), 10) : 0
        const gaugePct = budgetNum > 0 ? Math.min(100, Math.round(lastChars / budgetNum * 100)) : 0
        const budgetControl = e('div', { style: { width: '100%' } },
          e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 100, value: setBudget, 'data-tooltip': tt('settings.budgetTip'), onChange: (ev) => setSetBudget(ev.target.value), onBlur: saveSettingsBudget, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsBudget() } }),
          e('div', { className: 'dsh-notes-inject-gauge dsh-nt', 'data-tooltip': tt('settings.gaugeTip') },
            e('div', { className: 'dsh-notes-inject-gauge-bar' + (budgetNum > 0 && lastChars > budgetNum ? ' over' : ''), style: { width: gaugePct + '%' } })),
          e('span', { className: 'dsh-notes-inject-gauge-t' }, tt('settings.gaugeCurrent', { last: lastChars }) + (budgetNum > 0 ? ' / ' + tt('settings.gaugeBudget', { budget: budgetNum }) : tt('settings.gaugeUnlimited'))))
        // 数据区控件：导出全部（目录快照）/ 导出单文件…（P3 scope 拼接 + 图片内联）/ 导入…（两步式预览后执行）/ 回收站（底部收敛后的兜底入口）；点击即关设置卡片、开各自对话框
        const dataControl = e(React.Fragment, null,
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.exportAllTip'), onClick: openExport }, tt('settings.exportAll')),
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.exportSingleTip'), onClick: openSExport }, tt('settings.exportSingle')),
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.importTip'), onClick: openImport }, tt('settings.importBtn')),
          e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('topbar.trashTip'), onClick: openTrash }, tt('topbar.trash')))
        // 二期 资产清理控件：notes-assets-prune dry-run 预览 → 勾选删除（点击即关设置卡片、开预览对话框）
        const assetsControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.assetsTipT'), onClick: openPrune }, tt('settings.pruneBtn'))
        // 整理建议控件：打开三段式建议 modal（点击即关设置卡片、modal 不叠 modal）——底部「整理」按钮收敛后此处为入口
        const suggestControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.suggestTipT'), onClick: openSuggest }, tt('settings.openBtn'))
        // 键盘快捷键控件：打开速查表（点击即关设置卡片、modal 不叠 modal，同注入管理先例；非输入焦点时 ? 键直达）
        const cheatsheetControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.cheatsheetTipT'), onClick: openCheatsheet }, tt('settings.viewBtn'))
        // 注入预览控件：打开预览 modal（点击即关设置卡片、modal 不叠 modal）——agent 实际收到的注入文本即所见
        const injPrevControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.injPreviewTipT'), onClick: openInjectPreview }, tt('settings.previewBtn'))
        // 注入管理控件：打开注入管理面板（点击即关设置卡片、modal 不叠 modal）——全库注入三态总览 + 单行直改 / 多选批量
        const injMgrControl = e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.injManagerTipT'), onClick: () => openInjectManager('settings') }, tt('settings.manageBtn'))   // from=settings：单层返回栈（notes-041-settings-back），关闭二级面板自动回本卡
        // ===== 工作记忆 v0 控件（设置卡片「工作记忆」区）：状态行（已启用→查看约定/停用）+「启用沉淀引导…」=====
        const memoryControl = memStatus === null
          ? e('span', { className: 'dsh-notes-settings-label-s' }, tt('settings.memProbing'))
          : memStatus.enabled
            ? e(React.Fragment, null,
                e('span', { className: 'dsh-notes-settings-label-s' }, tt('settings.memEnabled') + ' '),
                e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.memViewTip'), onClick: memViewNote }, tt('settings.memView')),
                e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.memDisableTip'), onClick: doMemDisable, disabled: memPending }, memPending ? tt('settings.memPending') : tt('settings.memDisable')))
            : e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': tt('settings.memEnableTip'), onClick: () => openMemEnable('settings') }, tt('settings.memEnable'))   // from=settings：单层返回栈（notes-041-settings-back），关闭/启用成功后回本卡
        // 日志卫生窗口控件：周聚合（缺省 7 天）/ 月聚合（缺省 90 天，0=关闭本级）数值输入，失焦/Enter 即保存
        const logWeekControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setLogWeek, 'data-tooltip': tt('settings.logWeekTipT'), onChange: (ev) => setSetLogWeek(ev.target.value), onBlur: saveSettingsLogWeek, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLogWeek() } })
        const logRetentionControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1, value: setLogRetention, 'data-tooltip': tt('settings.logMonthTipT'), onChange: (ev) => setSetLogRetention(ev.target.value), onBlur: saveSettingsLogRetention, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLogRetention() } })
        // LLM 用量区（notes-token-stats）：今日/本周/本月/累计 + 按功能分列（分类/整理/总结）；含字符估算时标注「约」
        const usageControl = e('div', { style: { width: '100%' } },
          (usageData && !usageData.error)
            ? e(React.Fragment, null,
                e('div', { className: 'dsh-notes-usage-line' },
                  tt('settings.usageLine', { today: fmtTok(usageData.today.total), week: fmtTok(usageData.week.total), month: fmtTok(usageData.month.total), all: fmtTok(usageData.allTime.total) }),
                  usageData.calls > 0 ? tt('settings.usageCalls', { n: usageData.calls }) : ''),
                e('div', { className: 'dsh-notes-usage-line dsh-notes-usage-sub' },
                  tt('settings.usageByFeature', { classify: fmtTok(usageData.byFeature.classify.allTime), organize: fmtTok(usageData.byFeature.organize.allTime), summarize: fmtTok(usageData.byFeature.summarize.allTime) })
                    + (usageData.estimatedTokens > 0 ? tt('settings.usageEstimated') : '')))
            : e('span', { className: 'dsh-notes-settings-label-s' }, usageData && usageData.error ? tt('settings.usageLoadFailed') : tt('common.loading')))
        // 月度预算提醒控件：数值输入（tokens/月），失焦/Enter 即保存；0 = 关闭提醒
        const usageBudgetControl = e('input', { className: 'dsh-notes-settings-input', type: 'number', min: 0, step: 1000, value: setUsageBudget, 'data-tooltip': tt('settings.usageBudgetTipT'), onChange: (ev) => setSetUsageBudget(ev.target.value), onBlur: saveSettingsUsageBudget, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsUsageBudget() } })
        // i18n 语言项控件（notes-042-i18n-mech）：localStorage 本地记忆、选择即生效（setLang → langStore 广播全量重渲染）；
        // 不走 settings.json，不参与 dirty 状态机
        const langControl = e('select', { className: 'dsh-notes-settings-select', value: lang, 'data-tooltip': tt('settings.languageTip'), onChange: (ev) => setLang(ev.target.value) },
          e('option', { value: 'zh' }, '中文'),
          e('option', { value: 'en' }, 'English'))
        // 通用设置项行列表：以后加设置项只需往这里加行
        const settingsRows = [
          { key: 'language', label: tt('settings.language'), sub: tt('settings.languageTip'), control: langControl },
          { key: 'llm', label: tt('settings.llm'), sub: tt('settings.llmTip'), control: llmControl },
          { key: 'usage', label: tt('settings.usage'), sub: tt('settings.usageTip'), control: usageControl },
          { key: 'usagebudget', label: tt('settings.usageBudget'), sub: tt('settings.usageBudgetTip'), control: usageBudgetControl },
          { key: 'stale', label: tt('settings.stale'), sub: tt('settings.staleTip'), control: staleControl },
          { key: 'maxdepth', label: tt('settings.maxDepth'), sub: tt('settings.maxDepthTip'), control: maxDepthControl },
          { key: 'budget', label: tt('settings.budget'), sub: tt('settings.budgetTip'), control: budgetControl },
          { key: 'injprev', label: tt('settings.injPreview'), sub: tt('settings.injPreviewTip'), control: injPrevControl },
          { key: 'injmgr', label: tt('settings.injManager'), sub: tt('settings.injManagerTip'), control: injMgrControl },
          // 工作记忆 v0「工作记忆」区：启用沉淀引导（约定笔记方案，裁决 A）+ 日志卫生两级窗口（裁决 B②）
          { key: 'memory', label: tt('settings.memory'), sub: tt('settings.memoryTip'), control: memoryControl },
          { key: 'logweek', label: tt('settings.logWeek'), sub: tt('settings.logWeekTip'), control: logWeekControl },
          { key: 'logmonth', label: tt('settings.logMonth'), sub: tt('settings.logMonthTip'), control: logRetentionControl },
          { key: 'data', label: tt('settings.data'), sub: tt('settings.dataTipClient'), control: dataControl },
          { key: 'assets', label: tt('settings.assets'), sub: tt('settings.assetsTip'), control: assetsControl },
          { key: 'suggest', label: tt('settings.suggest'), sub: tt('settings.suggestTipClient'), control: suggestControl },
          // 键盘流速查表入口（notes-034-f-cheatsheet）：内容与 keyboard.js 逐键核对；? 键为直达通道
          { key: 'cheatsheet', label: tt('settings.cheatsheet'), sub: tt('settings.cheatsheetTip'), control: cheatsheetControl },
        ]
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) closeSettings() } },
          e('div', { className: 'dsh-notes-settings-modal' },
            // 标题栏动作区（notes-settings-feedback）：还原/保存（dirty 状态机驱动 disabled）+ ✕ 常驻关闭
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('gear', 14), ' ' + tt('common.settings'),
              e('span', { className: 'dsh-notes-settings-t-acts' },
                e('button', { className: 'dsh-notes-settings-restore dsh-nt', 'data-tooltip': tt('settings.restoreTip'), disabled: !setDirty || setSaving, onClick: restoreSettingsAll }, tt('common.restore')),
                e('button', { className: 'dsh-notes-settings-save dsh-nt', 'data-tooltip': tt('settings.saveTip'), disabled: !setDirty || setSaving, onClick: saveSettingsAll }, setSaving ? tt('settings.saving') : tt('common.save')),
                e('button', { className: 'dsh-notes-settings-close dsh-nt', 'data-tooltip': tt('settings.closeTip'), onClick: closeSettings }, I('x', 12)))),
            /* onboarding 轻量（notes-034-batch3）：设置卡顶部四概念一行一条速览（注入/约定·资料/目录注入/派发）——新用户前置解释 */
            e('div', { className: 'dsh-notes-data-hint' },
              e('b', null, tt('settings.onboardTitle')),
              e('div', null, tt('settings.onboardInject')),
              e('div', null, tt('settings.onboardRoles')),
              e('div', null, tt('settings.onboardCatalog')),
              e('div', null, tt('settings.onboardDispatch'))),
            e('div', { className: 'dsh-notes-settings-list' },
              settingsRows.map(row => e('div', { key: row.key, className: 'dsh-notes-settings-row' },
                e('div', { className: 'dsh-notes-settings-label' }, row.label, row.sub ? e('span', { className: 'dsh-notes-settings-label-s' }, row.sub) : null),
                e('div', { className: 'dsh-notes-settings-control' }, row.control)))),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null))
      })()
      : null
    }
    // ===== popover: help —— 使用说明气泡（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelHelp（showHelp 态 + 气泡 JSX）
    // needs: kernel/icons.js（e/I）；跨域写入（标题栏「?」按钮）经 kernel/state.js setShowHelp 转发别名 → panelBridge
    // state 托管：showHelp 留 hook 内 useState——popover 与主面板同一组件渲染边界（注册函数经 panel/index.js 装配调用），
    // 重渲染口径与昔日 FloatingPanel 内联态完全一致；check 锚定 useState 族不迁 store（§6 E 裁决记录见 panel/index.js 头注）
    function usePanelHelp() {
        const [showHelp, setShowHelp] = React.useState(false)
        // i18n 覆盖卡F：气泡文案走 t() 字典（help.* 域；标题复用 A 卡 chrome.help）；kbd 键名段与文案段分离拼装
        const helpEl = showHelp ? e('div', { className: 'dsh-notes-help-bubble' },
            e('button', { className: 'dsh-notes-help-close', onClick: () => setShowHelp(false) }, '×'),
            e('h4', null, t('chrome.help')),
            e('ul', null,
              e('li', null, t('help.newPre'), e('kbd', null, 'Alt+N'), t('help.newPost')),
              e('li', null, t('help.capture')),
              e('li', null, t('help.mergeWin')),
              e('li', null, t('help.topic')),
              e('li', null, t('help.drag')),
              e('li', null, t('help.keysLead'), e('kbd', null, 'Ctrl+K'), t('help.keysSearch'), e('kbd', null, '↓'), t('help.keysSearchEnd'), e('kbd', null, 'Alt+N'), t('help.keysNew'), e('kbd', null, 'j/k'), t('help.keysMoveOr'), e('kbd', null, '↑↓'), t('help.keysMoveEnd'), e('kbd', null, 'Enter'), t('help.keysOpen'), e('kbd', null, 'Esc'), t('help.keysEsc')),
              e('li', null, t('help.cheatPre'), e('kbd', null, '?'), t('help.cheatPost')),
              e('li', null, t('help.archive')),
              e('li', null, t('help.organize')),
              e('li', null, t('help.image')),
              e('li', null, t('help.delete')))) : null
        return { showHelp: showHelp, setShowHelp: setShowHelp, helpEl: helpEl }
    }
    // ===== popover: selbar —— 多选操作条（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelSelbar（selMode/selIds/selDelPending 态 + toggleSelMode/toggleSelId/doSelBatchDelete + 操作条 JSX）/ selModeRef
    // needs: kernel/state.js（panelBridge + setError/afterArchiveCleanup/loadNotes 转发别名）、kernel/bus.js（showToast）、
    //        kernel/format.js（notifyNotesChanged）、kernel/icons.js（e/I）、modals/merge.js（openMerge，序位在前）
    // state 托管：selMode/selIds 的 useState 声明原文被 check.js 锚定（26 节），连同 selDelPending 留 hook 内 useState——
    // popover 与主面板同一组件渲染边界，重渲染口径与昔日 FloatingPanel 内联态一致（§6 E 裁决记录见 panel/index.js 头注）；
    // selModeRef 为 Esc 栈/拖拽守卫的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）
    const selModeRef = { current: false }      // 多选态镜像（Esc 退出多选）
    function usePanelSelbar() {
        const [selMode, setSelMode] = React.useState(false)        // 列表多选态（复选框勾选，与搜索/过滤共存）
        const [selIds, setSelIds] = React.useState({})             // 多选勾选集合：noteId → true
        const [selDelPending, setSelDelPending] = React.useState(false)   // 多选批量删除执行中（按钮禁用防重入）
        React.useEffect(() => { selModeRef.current = selMode }, [selMode])
        // ===== 手动笔记多选合并：「选择」chip / 右键「合并为一篇」进多选态 → 底部操作条 → 标题输入 → notes-archive =====
        function toggleSelMode() { setSelMode(!selMode); setSelIds({}) }
        function toggleSelId(id) { setSelIds(prev => { const next = Object.assign({}, prev); if (next[id]) delete next[id]; else next[id] = true; return next }) }
        // 多选合并弹窗已拆出（modals/merge.js：openMerge/doMergeConfirm 迁入）；toggleSelMode/toggleSelId 属多选操作条域
        // 0.4.3⑥（notes-043-sys-kind）：多选集合中 kind=sys 系统根笔记计数（执行记录/注入索引/记忆档案等机器产物）——
        //   操作条红字警示 + 删除前 confirm 门槛（豁免面收口，与 app 端同口径）
        function selSysCount() {
          const ids = Object.keys(selIds)
          if (!ids.length) return 0
          const byId = {}
          for (const n of (notesRef.current || [])) byId[n.id] = n
          let c = 0
          for (const id of ids) { const n = byId[id]; if (n && (n.kind || 'note') === 'sys') c++ }
          return c
        }
        // 多选批量删除（软删进回收站，与整理建议器批量软删同通道）：确认强度 = 不可恢复性（notes-034-c-confirm）——
        // 软删可恢复 → 轻：无 confirm 直接删，撤销 toast 兜底（逐条 notes-restore；回收站亦可恢复）；不可恢复的 purge 才保留双确认；
        // 含 kind=sys 系统根笔记 → 追加 confirm 红线门槛（机器产物误删会破坏调度回执/资料召回/引用账本）
        async function doSelBatchDelete() {
          const ids = Object.keys(selIds)
          if (!ids.length || selDelPending) return
          const sysN = selSysCount()
          if (sysN > 0 && !window.confirm(t('sys.batchDelWarn', { n: sysN }))) return
          setSelDelPending(true); setError('')
          let ok = 0, fail = 0
          const okIds = []
          for (const id of ids) {
            try { const res = await rpc('notes-delete', { id: id }); if (res && res.error) fail++; else { ok++; okIds.push(id) } }
            catch (err) { fail++ }
          }
          setSelDelPending(false); setSelMode(false); setSelIds({})
          showToast(t('arch.deletedBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''), okIds.length ? { label: t('meta.undo'), fn: () => undoBatchDelete(okIds) } : undefined)
          afterArchiveCleanup(ids)   // 正打开的笔记在被删集合中则退出选中态（归档/建议器批量软删同款语义）
          await loadNotes(true); notifyNotesChanged()
        }
        // 批量软删撤销：逐条 notes-restore 恢复本次成功删除的笔记（单条删除撤销链路的批量复用）
        async function undoBatchDelete(ids) {
          let ok = 0, fail = 0
          for (const id of ids) {
            try { const res = await rpc('notes-restore', { id: id }); if (res && res.error) fail++; else ok++ }
            catch (err) { fail++ }
          }
          showToast(t('common.restoredBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''))
          await loadNotes(true); notifyNotesChanged()
        }
        // 多选操作条（「选择」chip / 右键「合并为一篇」进多选态后浮于侧栏底部）：已选 N 条 | 合并 | 删除 | 取消
        // i18n 覆盖卡F：复用 A/E 卡 sel.selCount/merge、common.delete/cancel、meta.undo 字典；sel.deleting 本卡建
        const selbarEl = selMode ? e('div', { className: 'dsh-notes-selbar' },
            e('span', { className: 'dsh-notes-selbar-n' }, t('sel.selCount', { n: Object.keys(selIds).length })),
            selSysCount() > 0 ? e('span', { className: 'dsh-notes-syswarn', title: t('sys.batchDelWarn', { n: selSysCount() }) }, t('sys.selWarn', { n: selSysCount() })) : null,
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: openMerge, disabled: Object.keys(selIds).length < 2 }, t('sel.merge')),
            e('button', { className: 'dsh-notes-data-danger', onClick: doSelBatchDelete, disabled: Object.keys(selIds).length < 1 || selDelPending }, selDelPending ? t('sel.deleting') : t('common.delete')),
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: toggleSelMode }, t('common.cancel')))
          : null
        return { selMode: selMode, selIds: selIds, selDelPending: selDelPending, setSelMode: setSelMode, setSelIds: setSelIds, toggleSelMode: toggleSelMode, toggleSelId: toggleSelId, selbarEl: selbarEl }
    }
    // ===== popover: folder-menu —— 文件夹右键菜单 + 文件夹管理动作族（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelFolderMenu（folders/foldersExpanded/内联输入四态/renaming 二态/folderMenu 态 + 树 helper 族 +
    //           loadFolders + openFolderMenu + doCreateFolder/doRenameFolder/doDeleteFolder/doReorderFolder/doReparentFolder + 菜单 JSX）/
    //           folderMenuRef/renamingIdRef/folderInputOpenRef/subFolderForRef
    // needs: kernel/state.js（panelBridge + setView/setCtxMenu/setError/loadNotes 转发别名）、kernel/persist.js（loadFoldersExpanded 族）、
    //        kernel/bus.js（showToast）、kernel/format.js（notifyNotesChanged）、kernel/icons.js（e/I）
    // 说明：文件夹管理动作（新建/重命名/删除/排序/换父）的全部触发入口是本右键菜单 + 树内联输入/拖拽（panel/tree.js 经回填回调），
    // 故动作族与树 helper 集中于本模块；Esc 栈直读本模块 ref 镜像（序位在前，与 modal 先例同口径）。
    // state 托管：全部 state 留 hook 内 useState（foldersExpanded 声明原文被 check.js 21 节锚定；§6 E 裁决记录见 panel/index.js 头注）
    const folderMenuRef = { current: null }   // 文件夹右键菜单镜像（Esc 栈读最新）
    const renamingIdRef = { current: null }   // 文件夹重命名输入镜像（Esc 取消）
    const folderInputOpenRef = { current: false }   // 文件夹新建输入镜像（Esc 取消）
    const subFolderForRef = { current: null }   // 「新建子文件夹」输入镜像（Esc 取消）
    function usePanelFolderMenu(args) {
        const notes = args.notes
        const view = args.view
        // 虚拟文件夹树：清单走 notes-folders RPC（list/create/rename/delete/reorder）；折叠态持久化 localStorage
        const [folders, setFolders] = React.useState([])
        const [foldersExpanded, setFoldersExpanded] = React.useState(loadFoldersExpanded)
        // ===== 0.4.4-C（notes-044-folder-explicit-view）：文件夹展开 = sys 显式入口（默认降噪不阻拦查看，OS 文件管理逻辑）=====
        // sysKids[fid] = { stamp, rows }：该夹**直挂**的 kind=sys slim 行（host _list 显式 folder 入口 = ⑨ 保留放行通道；
        // 子孙夹 sys 由各夹自身展开时拉取，host folder 过滤为递归子树口径故取回后按直挂过滤）；非 sys 行忽略（已在 paged 主缓存）。
        // stamp = 取数时 notes 缓存身份——折叠不清缓存（同批数据再展开零请求）；列表刷新后陈旧条目由下方效应剔除/重拉（防陈旧）
        const [sysKids, setSysKids] = React.useState({})
        const sysKidsInflightRef = React.useRef({})   // 补拉在途去重闸：effect 重入/快速连点同一夹不并发重复请求
        const [folderInputOpen, setFolderInputOpen] = React.useState(false)   // 文件夹分组头 ＋ → 内联输入（根级新建）
        const [folderInputText, setFolderInputText] = React.useState('')
        const [subFolderFor, setSubFolderFor] = React.useState(null)   // 「新建子文件夹」内联输入的父文件夹 id（null=关闭；输入行渲染在该父夹的子内容容器首位）
        const [folderMenu, setFolderMenu] = React.useState(null)   // 文件夹项右键菜单：{ x, y, folder }（面板内坐标）或 null
        const [renamingId, setRenamingId] = React.useState(null)   // 树内内联重命名中的文件夹 id
        const [renameText, setRenameText] = React.useState('')
        // 日志同权（0.4.3 验收修复⑦）：按夹日志 overlay 懒加载已拆除——日志随 notes 主缓存直达，展开日志夹零额外 RPC
        // 展开态/菜单镜像到 ref（Esc 栈闭包挂一次，需读最新值避免过期）
        React.useEffect(() => { folderMenuRef.current = folderMenu }, [folderMenu])
        React.useEffect(() => { renamingIdRef.current = renamingId }, [renamingId])
        React.useEffect(() => { folderInputOpenRef.current = folderInputOpen }, [folderInputOpen])
        React.useEffect(() => { subFolderForRef.current = subFolderFor }, [subFolderFor])
        // 文件夹清单（含各文件夹计数）：与列表同链路刷新（不 await，不阻塞列表链路）；
        // 文件夹异步到达后顺手清洗展开态陈旧 id（pruneFoldersExpanded：失效 id 剔除 + 空集回 null 缺省全展开）
        async function loadFolders() {
          try {
            const res = await rpc('notes-folders')
            if (res && res.folders) {
              setFolders(res.folders)
              setFoldersExpanded(prev => pruneFoldersExpanded(prev, res.folders))
            }
          } catch (err) {}
        }
        // ===== 嵌套 helper（notes-nested-folder-ui；与 host folder-tree-helpers 同口径的客户端纯函数版，数据全经入参/当前 state）=====
        // folderSubtreeIdsOf(id)：子树 id 集合（含自身 + 全部子孙；BFS 下行，visited 防御存量 cycle 数据）
        function folderSubtreeIdsOf(id) {
          const out = {}; out[id] = true
          const queue = [id]
          while (queue.length) { const cur = queue.shift(); for (const f of folders) if ((f.parent || '') === cur && !out[f.id]) { out[f.id] = true; queue.push(f.id) } }
          return out
        }
        // childFoldersOf(pid)：直接子文件夹（folders 已由 host 按 order 排序，filter 保序 = 兄弟间 order 序）
        function childFoldersOf(pid) { return folders.filter(x => (x.parent || '') === pid) }
        // rootFolders()：根级清单——无 parent 或 parent 悬空（指清单外 id，与 host folderDepth 悬空按根级计同口径防御）
        function rootFolders() { const byId = {}; folders.forEach(f => { byId[f.id] = f }); return folders.filter(f => !(f.parent || '') || !byId[f.parent || '']) }
        // folderPathOf(fid)：面包屑路径（根 → … → 当前）；悬空/cycle 防御截断
        function folderPathOf(fid) {
          const byId = {}; folders.forEach(f => { byId[f.id] = f })
          const path = []; let cur = fid; const seen = {}
          while (cur && byId[cur] && !seen[cur]) { seen[cur] = true; path.unshift(byId[cur]); cur = byId[cur].parent || '' }
          return path
        }
        // 折叠判定：foldersExpanded=null 表示缺省全展开；否则数组为展开中的 id 集合（含置顶组 PINNED_KEY）
        function isFolderExpanded(id) { return foldersExpanded === null ? true : foldersExpanded.indexOf(id) >= 0 }
        // 折叠/展开切换（缺省全展开时先物化全量展开集合再切换，保证其余文件夹保持展开）
        // 日志同权（0.4.3⑦）：展开不再触发日志懒加载（overlay 已拆）——纯折叠态翻转，零副作用
        function toggleFolder(id) {
          setFoldersExpanded(prev => {
            const base = prev === null ? folders.map(f => f.id).concat([PINNED_KEY]) : prev
            const next = base.indexOf(id) >= 0 ? base.filter(x => x !== id) : base.concat([id])
            saveFoldersExpanded(next)
            return next
          })
        }
        // 自动展开目标文件夹（选中笔记/新建文件夹/移入笔记时调用；已展开或缺省全展开时不动）
        function expandFolder(id) {
          if (!id) return
          setFoldersExpanded(prev => {
            if (prev === null || prev.indexOf(id) >= 0) return prev
            const next = prev.concat([id])
            saveFoldersExpanded(next)
            return next
          })
        }
        // 0.4.4-C 按需补拉效应：依赖 展开态/列表缓存/文件夹清单——折叠→展开、列表刷新（loadNotes/notifyNotesChanged 链路）、
        // 清单到达 都触发本效应复核。惰性红线：仅「当前展开 + 无新鲜缓存 + 子树徽标计数(含 sys，0.4.3⑩ folders-count-sys)
        // − 缓存可见数 > 0（=子树藏有降噪不可见 sys）」的夹发 notes-list {folder:id} 定向请求——普通夹/折叠夹恒零请求
        //（0.4.3⑦ 展开零 RPC 口径对普通夹保持）；缺省全展开（foldersExpanded=null）物化为全量展开集，首载即覆盖「记忆档案」场景
        React.useEffect(() => {
          // kind 单档口径门（0.4.3⑩）：恰选 1 个非 sys kind 时缓存 = host kind 通道子集，与 count 不可比——跳过
          //（「机器」档（sys）缓存已含全库 sys 无需补拉；其余单 kind 档下 sys 行本就不该混入）
          const kf = (args.filters && args.filters.kinds) || []
          if (kf.length === 1 && kf[0] !== 'sys') return
          const openSet = {}
          const expandedIds = foldersExpanded === null ? folders.map(f => f.id) : foldersExpanded
          expandedIds.forEach(id => { openSet[id] = true })
          // 防陈旧清理：文件夹已删 → 剔除；折叠且数据陈旧（notes 已刷新换代）→ 剔除
          //（展开中的陈旧条目不清——随下方重拉覆盖，旧行保留到新行落地，不闪断）
          setSysKids(prev => {
            let changed = false
            const next = {}
            for (const fid in prev) {
              if (!folders.some(f => f.id === fid)) { changed = true; continue }
              if (!openSet[fid] && prev[fid].stamp !== notes) { changed = true; continue }
              next[fid] = prev[fid]
            }
            return changed ? next : prev
          })
          for (const fid of expandedIds) {
            if (fid === PINNED_KEY) continue   // 置顶聚合组非真实文件夹
            const f = folders.find(x => x.id === fid)
            if (!f) continue
            const ent = sysKids[fid]
            if (ent && ent.stamp === notes) continue   // 新鲜缓存：同批数据再展开零请求（折叠不清缓存口径）
            if (sysKidsInflightRef.current[fid]) continue
            const sub = folderSubtreeIdsOf(fid)
            let visible = 0
            for (const n of notes) if (sub[n.folder || '']) visible++
            if ((f.count || 0) - visible <= 0) continue   // 无隐藏 sys：普通夹零请求（kids 与 0.4.3 口径逐字等价）
            sysKidsInflightRef.current[fid] = true
            const stamp = notes   // 本批取数的数据身份；响应落地时 notes 已换代则条目即陈旧，下轮本效应自重拉覆盖
            rpc('notes-list', { folder: fid }).then(res => {
              delete sysKidsInflightRef.current[fid]
              const rows = ((res && res.notes) || []).filter(n => (n.kind || 'note') === 'sys' && (n.folder || '') === fid)
              setSysKids(prev => Object.assign({}, prev, { [fid]: { stamp: stamp, rows: rows } }))
            }, () => { delete sysKidsInflightRef.current[fid] })   // 失败静默降级：sys 行不显示，下次复核重试
          }
        }, [foldersExpanded, notes, folders])
        // 文件夹项右键菜单：与笔记行菜单同坐标换算（面板内绝对定位；两菜单互斥）
        function openFolderMenu(ev, f) {
          ev.preventDefault(); ev.stopPropagation()
          const floatEl = ev.currentTarget.closest('.dsh-notes-floating')
          const rect = floatEl ? floatEl.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 500 }
          const mw = 190, mh = 260
          let x = ev.clientX - rect.left, y = ev.clientY - rect.top
          x = Math.max(4, Math.min(x, rect.width - mw - 4))
          y = Math.max(4, Math.min(y, rect.height - mh - 4))
          setFolderMenu({ x: x, y: y, folder: f })
          setCtxMenu(null)
        }
        // 文件夹新建（分组头 ＋ 根级 / 右键「新建子文件夹」嵌套）→ 内联输入：Enter 提交（空串=取消）；建成即展开该文件夹（树内浏览）
        // 嵌套：parent 取 subFolderFor（''=根级）；深度上限/父不存在由 host checkFolderAttach 拒绝 → 错误串去 RPC 前缀后 toast（友好提示）
        async function doCreateFolder() {
          const name = folderInputText.trim()
          const parent = subFolderFor || ''
          if (!name) { setFolderInputOpen(false); setSubFolderFor(null); return }
          setFolderInputOpen(false); setSubFolderFor(null); setFolderInputText(''); setError('')
          try {
            const res = await rpc('notes-folders', { op: 'create', name: name, parent: parent })
            if (res && res.error) { showToast(String(res.error).replace(/^notes-folders\.\w+\s*/, '')); return }
            showToast(t('fld.created', { name: name }))
            if (res.folder && res.folder.id) { if (parent) expandFolder(parent); expandFolder(res.folder.id) }   // 0.4.3⑦：文件视图拆除——建成即展开（不再进文件夹视图）
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 栏内内联重命名：Enter 提交 / Esc 或失焦取消；名字未变时不发 RPC
        async function doRenameFolder() {
          const id = renamingId, name = renameText.trim()
          setRenamingId(null)
          if (!id || !name) return
          const cur = folders.find(f => f.id === id)
          if (cur && cur.name === name) return
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'rename', id: id, name: name })
            if (res && res.error) { setError(res.error); return }
            showToast(t('fld.renamed', { name: name }))
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 右键删除（级联，notes-nested-folder-ui）：confirm 明示「连子删除：N 个子文件夹 + M 条笔记移入回收站；文件夹结构不可恢复」——
        // 统计本地从 folders/notes 清单按子树预估（host 无 dry-run 参数；子树语义与 host cascade 同源 folderSubtreeIds），确认后带 cascade:true 整棵删除
        async function doDeleteFolder(f) {
          setFolderMenu(null)
          const sub = folderSubtreeIdsOf(f.id)
          const childN = folders.filter(x => x.id !== f.id && sub[x.id]).length
          const noteN = notes.filter(n => sub[(n.folder || '')]).length
          const msg = (childN || noteN)
            ? t('fld.delConfirmCascade', { name: f.name, childN: childN, noteN: noteN })
            : t('fld.delConfirmEmpty', { name: f.name })
          if (!window.confirm(msg)) return
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'delete', id: f.id, cascade: true })
            if (res && res.error) { setError(res.error); return }
            showToast(t('fld.deleted', { name: f.name }) + ((childN || noteN) ? t('fld.deletedDetail', { childN: childN, noteN: noteN }) : ''))
            await loadFolders(); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 右键上移/下移：嵌套语义 = 同级兄弟内换位（全局 ids 顺序提交，host 归一化 order；两 id 原位互换，非兄弟相对位次不动）
        async function doReorderFolder(f, delta) {
          setFolderMenu(null)
          const sibs = childFoldersOf(f.parent || '')
          const si = sibs.findIndex(x => x.id === f.id)
          const sj = si + delta
          if (si < 0 || sj < 0 || sj >= sibs.length) return
          const other = sibs[sj]
          const ids = folders.map(x => x.id)
          const i = ids.indexOf(f.id), j = ids.indexOf(other.id)
          ids[i] = other.id; ids[j] = f.id
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'reorder', ids: ids })
            if (res && res.error) { setError(res.error); return }
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 拖拽换父（notes-nested-folder-ui）：文件夹行拖入另一文件夹 = reorder parents 改挂；'' = 移回根级
        // cycle/自挂本地先拦（省一次 RPC 的友好 toast）；深度上限由 host checkFolderAttach 拒绝 → 错误串去 RPC 前缀后 toast
        async function doReparentFolder(fid, parentId) {
          const f = folders.find(x => x.id === fid)
          if (!f || (f.parent || '') === (parentId || '')) return
          setError('')
          if (parentId) {
            if (parentId === fid) { showToast(t('fld.errSelf')); return }
            if (folderSubtreeIdsOf(fid)[parentId]) { showToast(t('fld.errCycle')); return }
          }
          try {
            const res = await rpc('notes-folders', { op: 'reorder', ids: folders.map(x => x.id), parents: { [fid]: parentId || '' } })
            if (res && res.error) { showToast(String(res.error).replace(/^notes-folders\.\w+\s*/, '')); return }
            if (parentId) expandFolder(parentId)
            showToast(parentId ? t('fld.movedInto', { name: folderName(parentId) }) : t('fld.movedRoot'))
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 笔记行右键「移动到文件夹」：notes-update 只改 folder 字段；'' = 移出到未分类
        function folderName(fid) { const f = folders.find(x => x.id === fid); return f ? f.name : '' }
        // 0.4.4-D hidden 隐藏属性：文件夹显隐开关（notes-folders op:'set-flags'）——隐藏后该夹行+nested 子树滤除（OS 语义；
        // 显隐开关开时半透明渲染可再操作）；host 语义零改动，纯 UI 遮罩
        async function doSetFolderHidden(f, hidden) {
          setFolderMenu(null)
          try {
            const res = await rpc('notes-folders', { op: 'set-flags', id: f.id, hidden: hidden === true })
            if (res && res.error) { setError(res.error); return }
            showToast(hidden === true ? t('fld.hiddenToast', { name: f.name }) : t('fld.unhiddenToast', { name: f.name }))
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 文件夹右键菜单：点击菜单外部关闭（与笔记行菜单共用 .dsh-notes-ctxmenu 样式）
        React.useEffect(() => {
          if (!folderMenu) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ctxmenu'))) setFolderMenu(null) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [folderMenu])
        // 文件夹右键菜单的上移/下移边界（嵌套语义：同级兄弟内首项不可上移、末项不可下移）
        const folderMenuSibs = folderMenu ? childFoldersOf(folderMenu.folder.parent || '') : []
        const folderMenuIdx = folderMenu ? folderMenuSibs.findIndex(f => f.id === folderMenu.folder.id) : -1
        // 文件夹项右键菜单：新建子文件夹（嵌套内联输入）/ 重命名 / 上移 / 下移（同级兄弟内）/ 移回根级（有父级时）/ 删除（级联 confirm）
        // （0.4.3 验收修复⑦：文件夹右键「进视图」菜单项随文件视图模式拆除移除）
        // i18n 覆盖卡F：菜单项文案走 t()（fld.* 域；「删除文件夹」= fld.menuDeleteFolder 区别笔记行 common.delete）
        const folderMenuEl = folderMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: folderMenu.x + 'px', top: folderMenu.y + 'px' } },
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const mf = folderMenu.folder; setFolderMenu(null); setFolderInputOpen(false); setFolderInputText(''); expandFolder(mf.id); setSubFolderFor(mf.id) } }, I('plus', 12), t('fld.titleNewSub')),
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { setRenamingId(folderMenu.folder.id); setRenameText(folderMenu.folder.name); setFolderMenu(null) } }, t('fld.okRename')),
            e('button', { className: 'dsh-notes-ctxmenu-item', disabled: folderMenuIdx <= 0, onClick: () => doReorderFolder(folderMenu.folder, -1) }, t('fld.menuUp')),
            e('button', { className: 'dsh-notes-ctxmenu-item', disabled: folderMenuIdx < 0 || folderMenuIdx >= folderMenuSibs.length - 1, onClick: () => doReorderFolder(folderMenu.folder, 1) }, t('fld.menuDown')),
            (folderMenu.folder.parent || '') ? e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const mf = folderMenu.folder; setFolderMenu(null); doReparentFolder(mf.id, '') } }, t('fld.menuRoot')) : null,
            // 0.4.4-D：隐藏此文件夹 / 取消隐藏（hidden 属性，OS 文件管理对齐；隐藏项显隐由筛选中心「显示隐藏」开关总控）
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const mf = folderMenu.folder; doSetFolderHidden(mf, !(mf.hidden === true)) } }, I('eye', 12), folderMenu.folder.hidden === true ? t('fld.menuUnhide') : t('fld.menuHide')),
            e('div', { className: 'dsh-notes-ctxmenu-sep' }),
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => doDeleteFolder(folderMenu.folder) }, t('fld.menuDeleteFolder')))
          : null
        return {
          folders: folders, foldersExpanded: foldersExpanded, sysKids: sysKids, folderInputOpen: folderInputOpen, folderInputText: folderInputText,
          subFolderFor: subFolderFor, folderMenu: folderMenu, renamingId: renamingId, renameText: renameText,
          setFolderInputOpen: setFolderInputOpen, setFolderInputText: setFolderInputText, setSubFolderFor: setSubFolderFor,
          setFolderMenu: setFolderMenu, setRenamingId: setRenamingId, setRenameText: setRenameText,
          loadFolders: loadFolders, folderSubtreeIdsOf: folderSubtreeIdsOf, childFoldersOf: childFoldersOf, rootFolders: rootFolders,
          folderPathOf: folderPathOf, isFolderExpanded: isFolderExpanded, toggleFolder: toggleFolder, expandFolder: expandFolder,
          folderName: folderName, openFolderMenu: openFolderMenu, doCreateFolder: doCreateFolder, doRenameFolder: doRenameFolder,
          doDeleteFolder: doDeleteFolder, doReorderFolder: doReorderFolder, doReparentFolder: doReparentFolder, folderMenuEl: folderMenuEl
        }
    }
    // ===== popover: ctx-menu —— 笔记行右键菜单（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelCtxMenu（ctxMenu/ctxNewFolderText 态 + openCtxMenu/ctxSetStatus/ctxMoveToFolder/ctxCreateFolderMove + 菜单 JSX）/ ctxMenuRef
    // needs: kernel/state.js（panelBridge + setError/setFolderMenu/setSelMode/setSelIds/expandFolder/doDelete/selectNote/loadNotes/loadFolders 转发别名）、
    //        kernel/bus.js（showToast）、kernel/format.js（notifyNotesChanged）、kernel/icons.js（e/I）；
    //        folders 清单经 hook 入参注入（panel/index.js 自 folder-menu hook 回填，渲染期新鲜值）
    // state 托管：ctxMenu/ctxNewFolderText 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // ctxMenuRef 为 Esc 栈/Ctrl+/ 守卫的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）
    const ctxMenuRef = { current: null }   // 右键菜单镜像（keydown 闭包读最新值）
    function usePanelCtxMenu(args) {
        const folders = args.folders
        const [ctxMenu, setCtxMenu] = React.useState(null)   // 笔记行右键菜单：{ x, y, note }（面板内坐标）或 null
        const [ctxNewFolderText, setCtxNewFolderText] = React.useState('')   // 笔记行右键菜单「新建文件夹…」内联输入
        React.useEffect(() => { ctxMenuRef.current = ctxMenu }, [ctxMenu])
        // 笔记行右键菜单（面板内绝对定位；与文件夹菜单互斥）
        function openCtxMenu(ev, n) {
          ev.preventDefault(); ev.stopPropagation()
          const floatEl = ev.currentTarget.closest('.dsh-notes-floating')
          const rect = floatEl ? floatEl.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 500 }
          const mw = 172, mh = 148
          let x = ev.clientX - rect.left, y = ev.clientY - rect.top
          x = Math.max(4, Math.min(x, rect.width - mw - 4))
          y = Math.max(4, Math.min(y, rect.height - mh - 4))
          setCtxMenu({ x: x, y: y, note: n })
          setFolderMenu(null); setCtxNewFolderText('')   // 互斥：关文件夹菜单；清空上次的内联新建输入
          selectNote(n)
        }
        async function ctxSetStatus(n, status) {
          setCtxMenu(null); setError('')
          try {
            const res = await rpc('notes-update', { id: n.id, status: status })
            if (res && res.error) { setError(res.error); return }
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 笔记行右键「移动到文件夹」：notes-update 只改 folder 字段；'' = 移出到未分类
        async function ctxMoveToFolder(n, folderId) {
          setCtxMenu(null); setCtxNewFolderText(''); setError('')
          const fname = folderId ? ((folders.find(f => f.id === folderId) || {}).name || '') : ''
          try {
            const res = await rpc('notes-update', { id: n.id, folder: folderId })
            if (res && res.error) { setError(res.error); return }
            showToast(folderId ? t('tree.movedTo', { name: fname }) : t('tree.movedOut'))
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 笔记行右键「新建文件夹…」：建文件夹并把笔记移入（不切换当前视图）
        async function ctxCreateFolderMove(n) {
          const name = ctxNewFolderText.trim()
          if (!name) return
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'create', name: name })
            if (res && res.error) { setError(res.error); return }
            setCtxNewFolderText('')
            if (res.folder && res.folder.id) {
              expandFolder(res.folder.id)
              const u = await rpc('notes-update', { id: n.id, folder: res.folder.id })
              if (u && u.error) { setError(u.error); return }
              showToast(t('tree.movedTo', { name: res.folder.name }))
            }
            setCtxMenu(null)
            await loadFolders(); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 点击菜单外部关闭（Esc 在全局 keydown 里处理）
        React.useEffect(() => {
          if (!ctxMenu) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ctxmenu'))) setCtxMenu(null) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [ctxMenu])
        // 笔记行右键菜单：置顶/已解决/移动到文件夹/删除（纯文字标签 + SVG 图标面板内统一风格）
        // i18n 覆盖卡F：命令式 toast 走 t() 直读，JSX 标签同（面板=shell.overlay 单例，tt 订阅随树/编辑器 hook 驱动全面板重渲染）
        const ctxMenuEl = ctxMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' } },
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'pinned' ? 'active' : 'pinned') }, I('pin', 12), ctxMenu.note.status === 'pinned' ? t('meta.unpin') : t('meta.pin')),
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'resolved' ? 'active' : 'resolved') }, I('check', 12), ctxMenu.note.status === 'resolved' ? t('ctx.reopen') : t('ctx.markResolved')),
            // 移动到文件夹：点击内联展开子菜单（文件夹列表 + 移出 + 新建），避免二级浮层被面板 overflow:hidden 裁切
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => setCtxMenu({ x: ctxMenu.x, y: ctxMenu.y, note: ctxMenu.note, moveOpen: !ctxMenu.moveOpen }) }, I('folder', 12), t('ctx.moveTo') + (ctxMenu.moveOpen ? ' ▾' : ' ▸')),
            ctxMenu.moveOpen ? e(React.Fragment, null,
              folders.map(f => e('button', { key: f.id, className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => ctxMoveToFolder(ctxMenu.note, f.id) }, ((ctxMenu.note.folder || '') === f.id ? '✓ ' : '') + f.name)),
              (ctxMenu.note.folder || '') ? e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => ctxMoveToFolder(ctxMenu.note, '') }, t('ctx.moveOut')) : null,
              ctxMenu.newFolder
                ? e('input', { className: 'dsh-notes-ctxmenu-input', placeholder: t('ctx.newFolderPlaceholder'), value: ctxNewFolderText, autoFocus: true, onChange: (ev) => setCtxNewFolderText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ctxCreateFolderMove(ctxMenu.note) } } })
                : e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => setCtxMenu({ x: ctxMenu.x, y: ctxMenu.y, note: ctxMenu.note, moveOpen: true, newFolder: true }) }, t('ctx.newFolder')))
            : null,
            // 合并为一篇：进多选态并预勾当前笔记（再到列表勾选其余 ≥1 条，底部操作条合并）
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const nid = ctxMenu.note.id; setCtxMenu(null); setSelMode(true); setSelIds({ [nid]: true }) } }, I('check', 12), t('ctx.merge')),
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => { setCtxMenu(null); doDelete(ctxMenu.note.id) } }, I('trash', 12), t('common.delete')))
          : null
        return { ctxMenu: ctxMenu, setCtxMenu: setCtxMenu, openCtxMenu: openCtxMenu, ctxMoveToFolder: ctxMoveToFolder, ctxMenuEl: ctxMenuEl }
    }
    // ===== popover: scope —— 注入范围浮层（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelScope（sessList/sessPending/scopeOpen 态 + 会话清单轮询 + injectScopeLabel + 浮层 JSX）
    // needs: kernel/state.js（panelBridge + toggleScope 转发别名）、kernel/icons.js（e/I）；
    //        open/notes/edScope 经 hook 入参注入（panel/index.js 装配层回填，渲染期新鲜值）
    // state 托管：scopeOpen/sessList/sessPending 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // 编辑器 setRoleSeg 联动开合经 kernel 转发别名 setScopeOpen → panelBridge 回填
    function usePanelScope(args) {
        const open = args.open
        const notes = args.notes
        const edScope = args.edScope
        const [sessList, setSessList] = React.useState([])
        const [sessPending, setSessPending] = React.useState([])   // 注入范围浮层：标题后台补齐中的占位会话 [{id, short, workspace}]（0.1.7 首屏提速）
        const [scopeOpen, setScopeOpen] = React.useState(false)
        // 注入范围下拉的会话列表：面板打开时 + 笔记数变化时刷新（新会话可能出现）
        // 0.1.7 首屏提速：响应带 titlesPending 说明有会话标题在后台读盘补齐——立即渲染已 resolve 条目 +
        // 占位条目（「短id · 标题加载中…」），1.5s 轮询重拉直到补齐或面板关闭（冷缓存首读可能上百秒，轮询成本≈0）
        React.useEffect(() => {
          if (!open) return
          let stopped = false
          let pendingTimer = null
          function pullSessList() {
            rpc('notes-sessions', {}).then(res => {
              if (stopped || !res) return
              if (res.sessions) setSessList(res.sessions)
              setSessPending(res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [])
              if (res.titlesPending && !stopped) pendingTimer = timer.timeout(pullSessList, 1500)
            }).catch(() => {})
          }
          pullSessList()
          return () => { stopped = true; if (typeof pendingTimer === 'function') pendingTimer() }
        }, [open, notes.length])
        // 范围浮层：点击外部关闭
        React.useEffect(() => {
          if (!scopeOpen) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ed-scope-wrap'))) setScopeOpen(false) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [scopeOpen])
        // 注入范围文字（injectTo 是多选数组）：缺省 = 所有会话（存量 global/workspace 值同样视为所有会话）；否则列出所选会话名
        // i18n 覆盖卡F（B 卡交接③）：复用 B 卡 meta.scopeAll/scopeSession + common.listSep 字典（与 app kernel/helpers.js injectScopeLabel 同口径）
        function injectScopeLabel(injectTo) {
          const arr = (injectTo || []).filter(x => x !== 'global' && x !== 'workspace')
          if (arr.length === 0) return t('meta.scopeAll')
          const names = arr.map(tg => {   /* 形参 tg 消遮蔽（app 侧覆盖卡B 同先例）：回调内 t() 直读字典 */
            const st = shortSid(tg)   // 归一比对（notes-034-injectto-norm）：存量长 id 先约到短 id 再匹配会话名
            const s = sessList.find(x => x.short === st)
            return s ? s.name : t('meta.scopeSession', { name: st })
          })
          return names.join(t('common.listSep'))
        }
        // 范围浮层：会话按工作区分组（两级：工作区 → 会话）
        const scopeByWs = {}
        for (const s of sessList) { const w = s.workspace || t('meta.wsOther'); if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push(s) }
        // 标题后台补齐中的占位会话（0.1.7）：禁用态占位「短id · 标题加载中…」，补齐后轮询重拉自动替换为真名
        for (const p of sessPending) { const w = p.workspace || t('meta.wsOther'); if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push({ id: p.id, short: p.short, name: '', pending: true }) }
        const scopeWsKeys = Object.keys(scopeByWs).sort()
        const scopePanelEl = scopeOpen ? e('div', { className: 'dsh-notes-scope-panel' },
                  // 默认提示行：注入无「工作区/全局」维度——缺省注入所有会话，勾选会话则仅限这些会话
                  e('div', { className: 'dsh-notes-scope-hint' }, t('meta.scopeHint')),
                  scopeWsKeys.map(ws => e('div', { key: ws, className: 'dsh-notes-scope-group' },
                    e('div', { className: 'dsh-notes-scope-ws' }, ws),
                    scopeByWs[ws].map(s => e('label', { key: s.id, className: 'dsh-notes-scope-item dsh-notes-scope-sess' },
                      e('input', { type: 'checkbox', checked: s.pending ? false : scopeHas(edScope, s.short), onChange: () => { if (!s.pending) toggleScope(s.short) }, disabled: !!s.pending }),
                      ' ' + (s.pending ? t('meta.scopePending', { short: s.short }) : s.name))))))
                : null
        return { sessList: sessList, sessPending: sessPending, scopeOpen: scopeOpen, setScopeOpen: setScopeOpen, injectScopeLabel: injectScopeLabel, scopePanelEl: scopePanelEl }
    }
    // ===== popover: filter-pop —— 筛选中心分组浮层（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelFilterPop（filterOpen 态 + renderFilterPop 渲染函数）/ filterOpenRef
    // needs: kernel/state.js（panelBridge + setFilters 转发别名）、kernel/constants.js（FILTER_STATUS/FILTER_KINDS/FILTERS0/KIND_LABELS）、
    //        kernel/icons.js（e/I）；filters/notes/hasInjectEver/filteredCount/searchDebRef 经渲染函数入参注入（装配层 post-guard 新鲜值）
    // state 托管：filterOpen 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // filterOpenRef 为 Esc 栈的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）；
    // 浮层 JSX 依赖 post-guard 视图求值结果（filtered.length/hasInjectEver），故导出渲染函数由装配层在求值后调用（口径不变）
    const filterOpenRef = { current: false }
    function usePanelFilterPop(args) {
        const filters = args.filters, sortBy = args.sortBy
        // 0.4.4-D（notes-044-hidden-attr）：showHidden 显隐开关（panel/index.js 态经入参注入；写入经 kernel 转发别名 setShowHidden +
        // saveShowHidden 独立键持久——与筛选条件正交，「清空」不重置本开关）
        const showHidden = args.showHidden === true
        const [filterOpen, setFilterOpen] = React.useState(false)
        React.useEffect(() => { filterOpenRef.current = filterOpen }, [filterOpen])
        // 筛选条件/排序变化即持久化（与 folders-expanded 等现有 localStorage 记忆同口径）
        React.useEffect(() => { try { localStorage.setItem('dsh-notes-filters', JSON.stringify({ filters, sortBy })) } catch (err) {} }, [filters, sortBy])
        function renderFilterPop(args) {
          const filters = args.filters, notes = args.notes, hasInjectEver = args.hasInjectEver, filteredCount = args.filteredCount, searchDebRef = args.searchDebRef
          // i18n 覆盖卡F：FILTER_STATUS.label/KIND_LABELS 字面量仅作四端同构锚，渲染经 filterStatusLabel/kindLabel 条件映射走 t()
          return filterOpen ? e('div', { className: 'dsh-notes-fpop' },
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, t('filter.statusGroup')), e('span', { className: 'dsh-notes-fg-rule' }, t('filter.ruleOr'))),
                  FILTER_STATUS.filter(f => f.id !== 'injectEver' || hasInjectEver).map(f => e('label', { key: f.id, className: 'dsh-notes-fg-item' },
                    e('input', { type: 'checkbox', checked: filters[f.id] === true, onChange: (ev) => { setFilters(Object.assign({}, filters, { [f.id]: ev.target.checked })); if (searchDebRef.current) searchDebRef.current() } }),
                    I(f.icon, 11), e('span', { className: 'dsh-notes-fg-fl' }, filterStatusLabel(f.id)), e('span', { className: 'dsh-notes-fg-cnt' }, String(notes.filter(f.pred).length)))),
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, t('filter.kindGroup')), e('span', { className: 'dsh-notes-fg-rule' }, t('filter.ruleOrAnd'))),
                  FILTER_KINDS.map(k => e('label', { key: k, className: 'dsh-notes-fg-item' },
                    e('input', { type: 'checkbox', checked: filters.kinds.indexOf(k) >= 0, onChange: (ev) => { setFilters(Object.assign({}, filters, { kinds: ev.target.checked ? filters.kinds.concat(k) : filters.kinds.filter(x => x !== k) })); if (searchDebRef.current) searchDebRef.current() } }),
                    e('span', { className: 'dsh-notes-fg-dot', style: { background: 'var(--nkind-' + k + ')' } }), e('span', { className: 'dsh-notes-fg-fl' }, kindLabel(k)), e('span', { className: 'dsh-notes-fg-cnt' }, String(notes.filter(n => (n.kind || 'note') === k).length)))),
                  // 0.4.4-D：显示组——「显示隐藏」显隐开关（OS 文件管理对齐；独立持久键，非筛选条件——不计 filterCount/清空不重置）
                  e('div', { className: 'dsh-notes-fg-h' }, e('span', null, t('filter.displayGroup'))),
                  e('label', { className: 'dsh-notes-fg-item', 'data-tooltip': t('filter.showHiddenTip') },
                    e('input', { type: 'checkbox', checked: showHidden, onChange: (ev) => { setShowHidden(ev.target.checked); saveShowHidden(ev.target.checked) } }),
                    I('eye', 11), e('span', { className: 'dsh-notes-fg-fl' }, t('filter.showHidden'))),
                  e('div', { className: 'dsh-notes-fpop-foot' },
                    e('span', { className: 'dsh-notes-fpop-pcnt' }, t('filter.hitCount', { n: filteredCount })),
                    e('button', { className: 'dsh-notes-pbtn', onClick: () => { setFilters(FILTERS0()); if (searchDebRef.current) searchDebRef.current() } }, t('filter.clear')),
                    e('button', { className: 'dsh-notes-pbtn primary', onClick: () => setFilterOpen(false) }, t('filter.done')))) : null
        }
        return { filterOpen: filterOpen, setFilterOpen: setFilterOpen, renderFilterPop: renderFilterPop }
    }
    // ===== popover: sort-menu —— 排序菜单浮层（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelSortMenu（sortOpen 态 + 菜单 JSX + 筛选/排序共享点外关闭 effect）/ sortOpenRef
    // needs: kernel/state.js（panelBridge + setSortBy/setFilterOpen 转发别名）、kernel/constants.js（FILTER_SORTS）、kernel/icons.js（e/I）；
    //        sortBy/filterOpen 经 hook 入参注入（装配层回填，渲染期新鲜值）
    // state 托管：sortOpen 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // sortOpenRef 为 Esc 栈的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）；
    // 筛选 popover + 排序菜单共享同一点外关闭 effect（均在 .dsh-notes-filterbar 内）——随序位在后的本模块收容（同文）
    const sortOpenRef = { current: false }
    function usePanelSortMenu(args) {
        const sortBy = args.sortBy
        const filterOpen = args.filterOpen
        const [sortOpen, setSortOpen] = React.useState(false)
        React.useEffect(() => { sortOpenRef.current = sortOpen }, [sortOpen])
        // 筛选中心浮层：点击外部关闭（popover + 排序菜单均在 .dsh-notes-filterbar 内，同一选择器覆盖）
        React.useEffect(() => {
          if (!filterOpen && !sortOpen) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-filterbar'))) { setFilterOpen(false); setSortOpen(false) } }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [filterOpen, sortOpen])
        // i18n 覆盖卡F：FILTER_SORTS label/desc 字面量仅作四端同构锚，渲染经 sortLabelOf/sortDescOf 条件映射走 t()
        const sortMenuEl = sortOpen ? e('div', { className: 'dsh-notes-fsort-menu' },
                    FILTER_SORTS.map(s => e('div', { key: s.id, className: 'dsh-notes-fsort-item' + (sortBy === s.id ? ' on' : ''), onClick: () => { setSortBy(s.id); setSortOpen(false) } }, e('span', { className: 'dsh-notes-fsort-tick' }, I('check', 11)), sortLabelOf(s.id), e('span', { className: 'dsh-notes-fsort-sd' }, sortDescOf(s.id))))) : null
        return { sortOpen: sortOpen, setSortOpen: setSortOpen, sortMenuEl: sortMenuEl }
    }
    const d1 = slots.inject('conversation.session.header.actions', () => {
      function HeaderBtn(props) {
        perf.hdrRender++
        const [, force] = React.useState(0)
        if (props && props.sessionId) currentSessionId = props.sessionId
        React.useEffect(() => { const fn = () => force(v => v + 1); entryListeners.add(fn); listeners.add(fn); return () => { entryListeners.delete(fn); listeners.delete(fn) } }, [])
        // 模式互斥：fab 模式时隐藏会话头部按钮
        if (entryMode !== 'header') return null
        return e('button', { className: 'dsh-notes-hdr-btn dsh-nt' + (panelOpen ? ' active' : ''), onClick: () => { panelOpen = !panelOpen; notify() }, 'data-tooltip': '智能笔记' }, e('span', { className: 'dsh-notes-hdr-ic' }, I('note', 13)), e('span', null, '智能笔记'))
      }
      slots.register({ name: 'conversation.session.header.actions', id: 'dsh-notes-btn', order: 40 }, (props) => e(HeaderBtn, props))
    })
    if (typeof d1 === 'function') disposers.push(d1)
    const d2 = slots.inject('shell.overlay', () => {
      // 悬浮气泡入口（可拖拽；点击展开面板；位置持久化；与会话头部按钮互斥）
      function FabEntry() {
        const [, force] = React.useState(0)
        const [pos, setPos] = React.useState({ x: fabPos.x, y: fabPos.y })
        const posRef = React.useRef(pos)
        React.useEffect(() => { posRef.current = pos }, [pos])
        React.useEffect(() => { const fn = () => force(v => v + 1); entryListeners.add(fn); listeners.add(fn); return () => { entryListeners.delete(fn); listeners.delete(fn) } }, [])
        React.useEffect(() => {
          // 窗口尺寸变化时把气泡 clamp 进视口
          function onResize() {
            const p = posRef.current, nx = Math.max(0, Math.min(window.innerWidth - 44, p.x)), ny = Math.max(0, Math.min(window.innerHeight - 44, p.y))
            if (nx !== p.x || ny !== p.y) { posRef.current = { x: nx, y: ny }; setPos({ x: nx, y: ny }) }
          }
          window.addEventListener('resize', onResize)
          return () => window.removeEventListener('resize', onResize)
        }, [])
        // 模式互斥：header 模式时隐藏悬浮气泡
        if (entryMode !== 'fab') return null
        const SIZE = 44
        function onMouseDown(ev) {
          ev.preventDefault()
          const sx = ev.clientX, sy = ev.clientY, px = pos.x, py = pos.y
          let moved = false
          drag(
            (ev2) => {
              const dx = ev2.clientX - sx, dy = ev2.clientY - sy
              if (!moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) moved = true
              if (moved) {
                const nx = Math.max(0, Math.min(window.innerWidth - SIZE, px + dx))
                const ny = Math.max(0, Math.min(window.innerHeight - SIZE, py + dy))
                posRef.current = { x: nx, y: ny }
                setPos({ x: nx, y: ny })
              }
            },
            () => {
              // 区分点击与拖拽：未移动视为点击 → 展开面板；移动则持久化最终位置
              if (!moved) { panelOpen = true; notify() }
              else { fabPos = { x: posRef.current.x, y: posRef.current.y }; saveEntryState() }
            }
          )
        }
        // v2 卡片式 FAB（G 大图标版）：中央 note 22px + 右下 kind 三色点（todo/decision/quote），无计数角标
        return e('button', { className: 'dsh-notes-fab dsh-nt' + (panelOpen ? ' active' : ''), style: { left: pos.x + 'px', top: pos.y + 'px' }, onMouseDown, 'data-tooltip': '笔记' },
          e('span', { className: 'dsh-notes-fab-ic' }, I('note', 22)),
          e('span', { className: 'dsh-notes-fab-tridots', 'aria-hidden': 'true' },
            e('i', { style: { background: 'var(--nkind-todo)' } }),
            e('i', { style: { background: 'var(--nkind-decision)' } }),
            e('i', { style: { background: 'var(--nkind-quote)' } })))
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-fab', order: 199 }, (props) => e(FabEntry, props))
    })
    if (typeof d2 === 'function') disposers.push(d2)
    // ===== panel/search —— 两段式搜索（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelSearch（searchText/searchIds/searchMatches 态 + 250ms 防抖 host 全文检索）/ highlight（行内高亮，纯函数模块级共享）
    // needs: kernel/state.js（searchRef/searchDebRef 跨域镜像 + filtersRef 同步）、kernel/constants.js（FILTER_STATUS）、kernel/icons.js（e）；
    //        filters 经 hook 入参注入（装配层回填，渲染期新鲜值）
    // state 托管：三态留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // searchRef/searchDebRef 在 kernel/state.js 跨域镜像群（Esc 清搜索/侧栏输入框/筛选变更跨域直读）
    // 搜索防抖闭包只注册一次，过滤条件经 ref 镜像供其读取（避免闭包过期）
    const filtersRef = { current: null }   // 筛选条件镜像（debounce 闭包读最新值；hook 内 effect 同步）
    function highlight(text, q) { if (!q || !text) return text; const s = String(text); const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const parts = s.split(new RegExp('(' + esc + ')', 'gi')); if (parts.length === 1) return s; return parts.map((p, i) => i % 2 === 1 ? e('mark', { key: i, className: 'dsh-notes-mark' }, p) : p) }
    function usePanelSearch(args) {
        const filters = args.filters
        const [searchText, setSearchText] = React.useState('')
        const [searchIds, setSearchIds] = React.useState(null)
        // host notes-search 返回的命中字段（noteId → ['title'|'tags'|'body']）：「相关度」排序数据源；本地即时命中/旧 host 无该字段时按本地字段估算
        const [searchMatches, setSearchMatches] = React.useState({})
        React.useEffect(() => { filtersRef.current = filters }, [filters])
        // 搜索两段式：输入即本地过滤（标题/主题/标签/预览），250ms 防抖后 host 全文检索（含正文）补充
        // 用一次性注册的 timer.debounce：每击键调 timer.timeout 等于每击键在 fiber 上注册一次 ctx.effect，是持续簿记开销
        React.useEffect(() => {
          const d = timer.debounce(() => {
            const qq = searchRef.current.trim()
            if (!qq) { setSearchIds(null); setSearchMatches({}); return }
            // 筛选中心组合过滤同步 host：类型组恰选 1 个时可传 kind；状态组仅单条件独活时可传 sensitive/inject
            // （多选 OR / 曾注入 语义 host 无法表达，由本地 matchFilters 兜底全量语义）；matches 命中字段供「相关度」排序
            const sArgs = { query: qq }
            const F = filtersRef.current
            if (F.kinds.length === 1) sArgs.kind = F.kinds[0]
            const stOn = FILTER_STATUS.filter(s => F[s.id]).map(s => s.id)
            if (stOn.length === 1 && stOn[0] === 'sensitive') sArgs.sensitive = true
            if (stOn.length === 1 && stOn[0] === 'injected') sArgs.inject = true
            rpc('notes-search', sArgs).then(res => {
              const ns = (res && res.notes) || []
              setSearchIds(ns.map(n => n.id))
              const mm = {}
              ns.forEach(n => { if (Array.isArray(n.matches)) mm[n.id] = n.matches })
              setSearchMatches(mm)
            }).catch(() => {})
          }, 250)
          searchDebRef.current = d
          return () => { if (d && d.dispose) d.dispose() }
        }, [])
        return { searchText: searchText, searchIds: searchIds, searchMatches: searchMatches, setSearchText: setSearchText, setSearchIds: setSearchIds, setSearchMatches: setSearchMatches }
    }
    // ===== panel/wiki —— 笔记双链：索引/解析/跳转（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelWiki（wikiVer 态 + resolveWikiTarget/wikiResolve/ensureWikiIndex/bumpWikiBody/hasWikiLinks/jumpToWikiTarget）/ wikiBodiesRef/wikiIdxGenRef/jumpWikiRef
    // needs: kernel/state.js（notesRef 跨域镜像 + setView/setFilters/selectNote 转发别名）、kernel/bus.js（showToast）、kernel/constants.js（FILTERS0/matchFilters）、
    //        editor-kernel.js（extractWikiTargets/wikiLinksTo）；view/filters 经 hook 入参注入（装配层回填，渲染期新鲜值）
    // state 托管：wikiVer 留 hook 内 useState（索引推进触发主面板重渲染，与昔日同边界；§6 E 裁决记录见 panel/index.js 头注）；
    // wikiBodiesRef/wikiIdxGenRef/jumpWikiRef 为模块级单例（与昔日 FloatingPanel 内 useRef 等价——面板是 shell.overlay 单例）
    const wikiBodiesRef = { current: {} }               // noteId → { body, updatedAt }
    const wikiIdxGenRef = { current: 0 }                // 索引构建代际：列表刷新作废旧任务
    const jumpWikiRef = { current: null }               // 富文本 click 委托调最新 jumpToWikiTarget（监听器挂一次，读 ref 防闭包过期）
    function usePanelWiki(args) {
        const view = args.view
        const filters = args.filters
        // ===== P2 笔记双链：全库正文惰性索引（列表瘦身不含 body；后台 notes-get-batch 一次批量补齐，驱动行尾双链标记与反向链接面板）=====
        const [wikiVer, setWikiVer] = React.useState(0)      // 索引版本号：索引推进触发重渲染（行尾标记/反向链接随缓存刷新）
        // ===== P2 笔记双链：解析 / 索引 / 跳转（内核 extractWikiTargets/wikiLinksTo 同一口径；库已在内存，host 不改）=====
        // 渲染时解析：[[n-xxx]] 精确 id 优先，其次 [[标题]] 全库标题精确匹配；均不中 → null（渲染为纯文本）
        function resolveWikiTarget(target) {
          const t = String(target || '')
          if (!t) return null
          const list = notesRef.current || []
          return list.find(n => n.id === t) || list.find(n => (n.title || '') === t) || null
        }
        // 渲染器行内扩展入参（renderMarkdown 第二参）：命中 → {id,title}（锚显示标题）；不中 → null（纯文本）
        function wikiResolve(w) { const n = resolveWikiTarget(w); return n ? { id: n.id, title: n.title || '' } : null }
        // 全库正文索引：补缺/过期（updatedAt 漂移）条目一次 notes-get-batch 批量拉全（N+1 整治 notes-034-batch3：昔日 4 路并发逐条 notes-get，
        // 首屏请求数 O(n)→O(1)）；整批完成一次性推进版本号（防逐条重渲染闪烁/滚动跳动）；
        // 失败口径：整批一次性提示（不逐条刷屏），缺口条目（host missing：已删/墓碑/不存在）留在缓存外、下次刷新自动重试
        function ensureWikiIndex(list) {
          const gen = ++wikiIdxGenRef.current
          const cache = wikiBodiesRef.current
          const stale = (list || []).filter(n => { const c = cache[n.id]; return !c || c.updatedAt !== (n.updatedAt || '') })
          if (!stale.length) return
          rpc('notes-get-batch', { ids: stale.map(n => n.id) }).then(res => {
            if (gen !== wikiIdxGenRef.current) return
            let got = 0
            if (res && !res.error && res.notes) res.notes.forEach(r => { cache[r.id] = { body: r.body || '', updatedAt: r.updatedAt || '' }; got++ })
            setWikiVer(v => v + 1)
            const failed = stale.length - got
            if (failed) showToast(t('wiki.idxFailedPartial', { n: failed }))   /* i18n 覆盖卡F：wiki.* 域 */
          }).catch(() => { if (gen === wikiIdxGenRef.current) showToast(t('wiki.idxFailedClient', { n: stale.length })) })
        }
        // 单条正文写缓存（选中加载/保存后即时新鲜；updatedAt 缺省 '' → 下轮索引复核 reconcile）
        function bumpWikiBody(id, body, updatedAt) { if (!id) return; wikiBodiesRef.current[id] = { body: body || '', updatedAt: updatedAt || '' }; setWikiVer(v => v + 1) }
        // 行尾双链标记：缓存正文优先，索引未到时 preview（host slim 前 200 字符）兜底
        function hasWikiLinks(n) { const c = wikiBodiesRef.current[n.id]; return extractWikiTargets(c ? c.body : (n.preview || '')).length > 0 }
        // 双链跳转：解析 → 选中；目标被当前视图/筛选中心条件藏掉时退回「全部」（搜索词不动，保留用户上下文）
        function jumpToWikiTarget(target) {
          const n = resolveWikiTarget(target)
          if (!n) { showToast(t('wiki.targetNotFound', { target: target })); return }
          const vis = (view.type === 'all' || (view.type === 'topic' && (n.topic || '') === view.id))
            && matchFilters(n, filters)   /* 0.4.3⑦：文件夹视图分支随「文件视图」拆除移除（view 取值收窄 all | topic） */
          if (!vis) { setView({ type: 'all', id: '' }); setFilters(FILTERS0()) }
          selectNote(n)
        }
        return { wikiVer: wikiVer, ensureWikiIndex: ensureWikiIndex, bumpWikiBody: bumpWikiBody, hasWikiLinks: hasWikiLinks, wikiResolve: wikiResolve, jumpToWikiTarget: jumpToWikiTarget }
    }
    // ===== panel/tree —— 文件夹树渲染 + 拖拽换位 + 懒加载分页（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelTree（visibleCount/topicExpanded/topicSecOpen/dragActive 态 + 分页重置/onListScroll + 双向拖拽族 +
    //           renderTreeEls 渲染函数（内含 renderNoteRow/renderFolderNode，签名/正文逐字））
    // needs: kernel/state.js（pagedIdsRef 跨域镜像 + 文件夹域/多选/右键/编辑器域转发别名群）、kernel/constants.js（PAGE_SIZE/PINNED_KEY/FILTER_KINDS/KIND_LABELS/FILTERS0）、
    //        kernel/icons.js（e/I）、kernel/bus.js（showToast）、kernel/format.js（notifyNotesChanged）、panel/search.js（highlight，序位在前）、
    //        modals/newnote.js（openNewNote，序位在前）；notes/view/filters/searchText/searchIds 经 hook 入参注入（装配层回填，渲染期新鲜值）；
    //        post-guard 求值结果（filtered/paged/q/filtersActive 等）经 renderTreeEls 入参注入
    // state 托管：四态留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // dragNoteIdRef/dragFolderIdRef 的 React.useRef 声明原文被 check.js 锚定（21/41 节）——留 hook 内（useRef 不可模块顶层调用）
    function usePanelTree(args) {
        const notes = args.notes, view = args.view, filters = args.filters, searchText = args.searchText, searchIds = args.searchIds, folders = args.folders
        // 0.4.4-C（notes-044-folder-explicit-view）：sysKids = 文件夹显式展开按需补拉的 sys 子行缓存（popovers/folder-menu.js 托管，{fid:{stamp,rows}}）
        const sysKids = args.sysKids || {}
        // 0.4.4-D（notes-044-hidden-attr）：showHidden = 显隐开关（panel/index.js 态，localStorage dsh-notes-show-hidden 持久）；
        // 关=hidden 文件夹行+nested 容器滤除（OS 语义）且 sysKids 合并层同谓词拦截 hidden 行；开=照常渲染 + hid 遮罩样式（半透明）
        const showHidden = args.showHidden === true
        // 日志同权（0.4.3 验收修复⑦）：日志随 notes 主缓存直达——按夹日志懒加载 overlay 特化路径（独立 RPC + 合并）已拆除，
        // 展开日志夹与普通夹同一代码路径（零额外请求，卡顿根因消除）；「文件视图」（文件夹视图）模式同卡整体拆除
        // i18n（notes-042-i18n-cov-a 覆盖卡A）：tt = useT()——订阅 langStore，切语言本 hook（随主面板）自渲染；树区文案全走 tt()
        const tt = useT()
        const dragNoteIdRef = React.useRef(null)   // 笔记拖拽状态：dragstart 记录 noteId（ref 防闭包过期），dragend 清空
        const dragFolderIdRef = React.useRef(null)   // 文件夹拖拽状态（换父）：dragstart 记录 folderId，dragend 清空；与笔记拖拽互斥
        const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
        // 主题过滤行原地展开态（点行主体=展开/收起该主题子列表；object map，session 内有效，不持久化；缺省折叠）
        const [topicExpanded, setTopicExpanded] = React.useState({})
        // 主题过滤区整体折叠态（notes-topic-collapse：缺省折叠——常态只显示「主题 (N)」一行，点击展开/收起列表；session 内记忆，不持久化）
        const [topicSecOpen, setTopicSecOpen] = React.useState(false)
        // 拖拽进行中标记（dragstart 置位 / dragend 复位）：驱动未入夹区「移出文件夹」落点提示行渲染（空态下保证拖拽中仍有可拖出落点）
        const [dragActive, setDragActive] = React.useState(false)
        // 搜索/视图/筛选中心条件变化时重置分页（新结果从头开始）
        React.useEffect(() => { setVisibleCount(PAGE_SIZE) }, [searchText, searchIds, view, filters])
        // 主题过滤行原地展开切换（与文件夹 toggleFolder 同义「点哪个展开哪个」；不持久化）
        function toggleTopicExpanded(tn) { setTopicExpanded(prev => { const next = Object.assign({}, prev); next[tn] = !next[tn]; return next }) }
        // ===== 拖拽挪入/挪出文件夹（HTML5 DnD；与右键「移动到文件夹」共用 ctxMoveToFolder 移动逻辑）=====
        // dragstart：noteId 记到 ref + dataTransfer（Firefox 需 setData 才能起拖），源行加 .dragging 半透明
        function onNoteDragStart(ev, n) {
          if (selModeRef.current) { ev.preventDefault(); return }   // 多选态禁用拖拽（点击=勾选，不挪文件夹）
          dragNoteIdRef.current = n.id
          setDragActive(true)
          try { ev.dataTransfer.setData('text/dsh-note-id', n.id); ev.dataTransfer.effectAllowed = 'move' } catch (err) {}
          try { ev.currentTarget.classList.add('dragging') } catch (err) {}
        }
        // dragend 兜底清理：无论 drop 成功与否（含拖到面板外），摘掉 .dragging 与面板内所有残留 .drop-hint + 拖拽态复位
        function onNoteDragEnd(ev) {
          dragNoteIdRef.current = null
          setDragActive(false)
          try { ev.currentTarget.classList.remove('dragging') } catch (err) {}
          try { const els = document.querySelectorAll('.dsh-notes-floating .drop-hint'); for (let i = 0; i < els.length; i++) els[i].classList.remove('drop-hint') } catch (err) {}
        }
        // ===== 文件夹行拖拽换父（notes-nested-folder-ui；与笔记拖拽共存——drop 目标按 ref 区分拖拽类型）=====
        function onFolderDragStart(ev, f) {
          if (selModeRef.current) { ev.preventDefault(); return }   // 多选态禁用拖拽
          dragFolderIdRef.current = f.id
          setDragActive(true)
          try { ev.dataTransfer.setData('text/dsh-folder-id', f.id); ev.dataTransfer.effectAllowed = 'move' } catch (err) {}
          try { ev.currentTarget.classList.add('dragging') } catch (err) {}
        }
        function onFolderDragEnd(ev) {
          dragFolderIdRef.current = null
          setDragActive(false)
          try { ev.currentTarget.classList.remove('dragging') } catch (err) {}
          try { const els = document.querySelectorAll('.dsh-notes-floating .drop-hint'); for (let i = 0; i < els.length; i++) els[i].classList.remove('drop-hint') } catch (err) {}
        }
        // 文件夹行 drop 目标：本插件拖拽（笔记 ref 或 文件夹 ref 有值）才接管——dragover preventDefault + .drop-hint 高亮；
        // 文件夹换父时自挂/挂到子孙为非法落点（不高亮不 preventDefault，浏览器显示禁止光标，drop 无动作）；深度上限留给 host 拒绝后 toast
        function onFolderDragOver(ev, f) {
          const fid = dragFolderIdRef.current
          if (fid) { if (fid === f.id || folderSubtreeIdsOf(fid)[f.id]) return }
          else if (!dragNoteIdRef.current) return
          ev.preventDefault()
          try { ev.dataTransfer.dropEffect = 'move' } catch (err) {}
          ev.currentTarget.classList.add('drop-hint')
        }
        function onFolderDragLeave(ev) { ev.currentTarget.classList.remove('drop-hint') }
        // drop 到文件夹行：文件夹拖拽 = 换父（doReparentFolder 校验+toast）；笔记拖拽 = 移入该夹（已在该夹则静默无动作）
        function onFolderDrop(ev, f) {
          ev.preventDefault()
          ev.currentTarget.classList.remove('drop-hint')
          const fid = dragFolderIdRef.current
          if (fid) { if (fid !== f.id) doReparentFolder(fid, f.id); return }
          if (!dragNoteIdRef.current) return
          const id = dragNoteIdRef.current
          const noteObj = notes.find(x => x.id === id)
          if (noteObj && (noteObj.folder || '') !== f.id) ctxMoveToFolder({ id: id }, f.id)
        }
        // 未入夹区 drop 目标：笔记拖入本区 = 移出文件夹；文件夹拖入本区 = 移回根级（仅对当前有父级的文件夹生效）
        function onUnfiledDragOver(ev) {
          if (!dragNoteIdRef.current && !dragFolderIdRef.current) return
          ev.preventDefault()
          try { ev.dataTransfer.dropEffect = 'move' } catch (err) {}
          ev.currentTarget.classList.add('drop-hint')
        }
        function onUnfiledDragLeave(ev) { ev.currentTarget.classList.remove('drop-hint') }
        function onUnfiledDrop(ev) {
          ev.preventDefault()
          ev.currentTarget.classList.remove('drop-hint')
          const fid = dragFolderIdRef.current
          if (fid) { const fObj = folders.find(x => x.id === fid); if (fObj && (fObj.parent || '')) doReparentFolder(fid, ''); return }
          if (!dragNoteIdRef.current) return
          const id = dragNoteIdRef.current
          const noteObj = notes.find(x => x.id === id)
          if (noteObj && (noteObj.folder || '')) ctxMoveToFolder({ id: id }, '')
        }
        // 懒加载分页：只渲染前 visibleCount 条笔记行，滚动到底再加载更多（避免笔记多时全量渲染 + 每条跑 highlight）
        function onListScroll(ev) {
          const el = ev.target
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) { setVisibleCount(c => c + PAGE_SIZE) }
        }
        // ===== 侧栏树渲染（原型 renderTree 翻译）：视图求值结果经 R 注入（装配层 post-guard 新鲜值）=====
        function renderTreeEls(R) {
          const loading = R.loading, selected = R.selected, focusId = R.focusId, flashId = R.flashId, selMode = R.selMode, selIds = R.selIds
          const q = R.q, filtered = R.filtered, paged = R.paged, filtersActive = R.filtersActive, filterCount = R.filterCount, hasInjectEver = R.hasInjectEver
          // 文件夹域内联输入/重命名态（popovers/folder-menu.js 托管）经 R 注入
          const renamingId = R.renamingId, renameText = R.renameText, subFolderFor = R.subFolderFor, folderInputOpen = R.folderInputOpen, folderInputText = R.folderInputText
          // ===== 侧栏笔记行（原型 note-row）：kind 色点 + 标题(+置顶 pin) + 注入 bolt + 行尾 =====
          // 行尾（原型 noteRow）：主题视图内显示所属文件夹徽章；文件夹上下文内显示淡灰主题字（方案A）；其余显示日期
          function renderNoteRow(n, inFolderCtx) {
            let tail
            if (view.type === 'topic' && (n.folder || '')) tail = e('span', { className: 'dsh-notes-fbadge' }, I('folder', 9), folderName(n.folder))
            else if (inFolderCtx && n.topic && n.topic !== '分类中') tail = e('span', { className: 'dsh-notes-note-tp', title: tt('tree.topicTip', { topic: n.topic }) }, n.topic)
            else tail = e('span', { className: 'dsh-notes-note-dt' }, n.updatedAt ? fmtDT(n.updatedAt).slice(5, 10) : '')
            // 多选态：行点击=勾选/取消（不再打开笔记），行首渲染复选框；与搜索/过滤共存（勾选按 noteId 记账，过滤不清选）
            return e('div', { key: n.id, className: 'dsh-notes-note-row' + (selected === n.id ? ' sel' : '') + (focusId === n.id ? ' focused' : '') + (flashId === n.id ? ' flash' : '') + (n.status === 'resolved' ? ' resolved' : '') + (n.status === 'superseded' ? ' superseded' : '') + (n.hidden === true ? ' hid' : '') + (selMode && selIds[n.id] ? ' pick' : ''), onClick: () => { if (selMode) { toggleSelId(n.id); return } selectNote(n) }, onContextMenu: (ev) => openCtxMenu(ev, n), draggable: true, onDragStart: (ev) => onNoteDragStart(ev, n), onDragEnd: (ev) => onNoteDragEnd(ev) },
              selMode ? e('input', { type: 'checkbox', className: 'dsh-notes-pick-check', checked: !!selIds[n.id], onChange: () => toggleSelId(n.id), onClick: (ev) => ev.stopPropagation() }) : null,
              // 行首槽位对齐（notes-tree-typography）：caret 槽同宽透明占位（笔记行无折叠箭头）+ 图标槽 16px（kind 色点居中），与文件夹行标题文字起点一致
              e('span', { className: 'dsh-notes-caret-spacer' }),
              e('span', { className: 'dsh-notes-kind-slot' }, e('span', { className: 'dsh-notes-kind-dot', style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' } })),
              e('span', { className: 'dsh-notes-note-ti' }, n.status === 'pinned' ? I('pin', 10, 'dsh-notes-note-pin') : null, highlight(n.title || tt('tree.untitled'), q)),
              n.inject === true ? e('span', { className: 'dsh-notes-note-inj dsh-nt', 'data-tooltip': tt('tree.injectTip', { role: tt(n.injectRole === 'reference' ? 'tree.roleReference' : 'tree.roleConvention') }) + ' · ' + tt('tree.injectScope', { scope: injectScopeLabel(n.injectTo) }) }, I('bolt', 10)) : null,
              // 曾注入徽章（injectEver 粘性标记：历史上开启过注入、现已关闭；已注入时由 bolt 徽章表达，不重复显示；不满足不渲染）
              n.inject !== true && n.injectEver === true ? e('span', { className: 'dsh-notes-note-injevr dsh-nt', 'data-tooltip': tt('tree.injectEverTip') }, I('clock', 9)) : null,
              // 使用遥测（P2）：被引用徽章（0 次不显示）
              (n.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-note-use dsh-nt', 'data-tooltip': tt('tree.useCountTip', { n: n.useCount }) }, I('quote', 9), String(n.useCount)) : null,
              // 双链标记（P2）：正文含 [[..]] 时行尾显示链接图标（缓存正文优先，preview 兜底）
              hasWikiLinks(n) ? e('span', { className: 'dsh-notes-note-wiki dsh-nt', 'data-tooltip': tt('tree.wikiTip') }, I('link', 9)) : null,
              // 0.4.4-C：sys 行「机器」chip（文件夹显式展开/机器档可见的机器托管笔记可辨识；复用 fbadge 徽章样式 + meta.kindSys 字典键）
              (n.kind || 'note') === 'sys' ? e('span', { className: 'dsh-notes-fbadge dsh-nt', 'data-tooltip': tt('tree.sysChipTip') }, tt('meta.kindSys')) : null,
              tail)
          }
          // ===== 侧栏树（原型 renderTree 翻译）：视图头 → 置顶组 → 文件夹组（nested 子笔记）→ 未入夹根级平铺（drop 移出落点）→ 主题全局过滤 =====
          const treeIds = []
          const treeEls = []
          const viewTitle = view.type === 'topic' ? tt('tree.viewTopic', { id: view.id }) : tt('tree.viewAll')
          treeEls.push(e('div', { key: 'sec-view', className: 'dsh-notes-sec-h' },
            I('filter', 11),
            e('span', { className: 'dsh-notes-sec-h-t' }, viewTitle),
            view.type === 'topic' ? e('span', { className: 'dsh-notes-sec-h-sub' }, tt('tree.crossFolderCount', { n: filtered.length })) : null,
            view.type !== 'all' ? e('span', { className: 'dsh-notes-sec-h-clear dsh-nt', 'data-tooltip': tt('tree.clearViewTip'), onClick: (ev) => { ev.stopPropagation(); setView({ type: 'all', id: '' }) } }, '×') : null))
          // 置顶组：置顶笔记仍在其所属位置显示（带 pin 视觉），本组是跨文件夹的置顶聚合视图（可折叠，PINNED_KEY 持久化）
          const pinnedAll = filtered.filter(n => n.status === 'pinned')
          if (pinnedAll.length > 0) {
            // 过滤激活自动展开：含命中的置顶组强制展开（纯计算 OR，不写回 foldersExpanded——清除过滤即恢复手动折叠态）
            const pinOpen = isFolderExpanded(PINNED_KEY) || (filtersActive && pinnedAll.length > 0)
            treeEls.push(e('div', { key: 'sec-pinned', className: 'dsh-notes-sec-h dsh-notes-sec-toggle', onClick: () => toggleFolder(PINNED_KEY) },
              e('span', { className: 'dsh-notes-caret' + (pinOpen ? ' open' : '') }, I('chev', 10)),
              I('pin', 11),
              e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.pinned')),
              e('span', { className: 'dsh-notes-sec-h-n' }, pinnedAll.length)))
            if (pinOpen) {
              const pinRows = []
              paged.filter(n => n.status === 'pinned').forEach(n => { treeIds.push(n.id); pinRows.push(renderNoteRow(n, false)) })
              if (pinRows.length) treeEls.push(e('div', { key: 'pinned-kids', className: 'dsh-notes-nested' }, pinRows))
            }
          }
          // 文件夹组：行 = caret + folder 图标 + 名称 + 计数；行主体单击 = 纯展开/折叠
          // （经典树语义唯一职责——notes-041b 用户裁决去重；caret 与行主体同一 toggle 语义，stopPropagation 防双触发）；右键管理
          // （0.4.3 验收修复⑦：「文件视图」模式拆除——行尾漏斗进视图图标已移除，树展开即文件夹浏览）
          treeEls.push(e('div', { key: 'sec-folders', className: 'dsh-notes-sec-h' },
            I('folder', 11),
            e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.folders')),
            e('span', { className: 'dsh-notes-sec-h-add dsh-nt', 'data-tooltip': tt('tree.addFolderTip'), onClick: (ev) => { ev.stopPropagation(); setFolderInputText(''); setSubFolderFor(null); setFolderInputOpen(true) } }, I('plus', 12))))
          // 嵌套递归渲染（notes-nested-folder-ui）：depth-first——文件夹行 → 展开时 [内联子新建输入 → 子文件夹递归 → 直挂笔记] 包一层
          // .dsh-notes-nested 缩进容器（同级同字体/行首槽位对齐沿用排版体系；嵌套行缩进+小字由 styles.css .dsh-notes-nested 口径承担）；
          // 键盘导航顺序 = 渲染顺序（treeIds 按 depth-first 推入）；过滤命中与展开语义按子树（子树含命中 → 自动展开 + 计数=子树命中数，
          // 与 host f.count 子树口径一致；纯计算 OR 不写回 foldersExpanded——清除过滤即恢复手动折叠态）
          function renderFolderNode(f, sink) {
            // 0.4.4-D：hidden 文件夹在显隐开关关时整节点滤除（行 + nested 子树容器随父夹消失，OS 语义；子文件夹递归与本夹笔记行自然不渲染）
            if (!showHidden && f.hidden === true) return
            const sub = folderSubtreeIdsOf(f.id)
            // 0.4.4-C：合并按需补拉的 sys 子行（置尾从简——sys 行 host 序与主缓存排序口径分离，混排易误导，注释即取舍）；
            // 过滤/搜索激活时不混入（⑨ 默认列表/搜索降噪零放松：sys 仅「文件夹展开」这一个显式入口放行）；id 去重防御陈旧窗口（kind 变更等）；
            // 0.4.4-D：同层叠加 hidden 谓词——显隐开关关时 hidden 档案行不混入（开=带 hid 遮罩样式渲染）；与 C 卡合并零互扰
            const kidsBase = paged.filter(n => (n.folder || '') === f.id)
            const kids = filtersActive ? kidsBase : kidsBase.concat(((sysKids[f.id] && sysKids[f.id].rows) || []).filter(n => !kidsBase.some(x => x.id === n.id) && (showHidden || n.hidden !== true)))
            const subHits = filtersActive ? filtered.filter(n => sub[(n.folder || '')]).length : 0
            const fOpen = isFolderExpanded(f.id) || (filtersActive && subHits > 0)
            // 计数口径：过滤激活（视图/筛选中心/搜索任一）显示子树命中数（无命中 0）；否则显示子树总数（host count 已递归）
            const cnt = filtersActive ? subHits : (f.count || 0)
            sink.push(renamingId === f.id
              ? e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' },
                  e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
                  e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                  e('input', { className: 'dsh-notes-folder-rename', value: renameText, autoFocus: true, onChange: (ev) => setRenameText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doRenameFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setRenamingId(null) } }, onBlur: () => setRenamingId(null) }))
              : e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' + (f.hidden === true ? ' hid' : ''), onClick: () => { toggleFolder(f.id) }, onContextMenu: (ev) => openFolderMenu(ev, f), draggable: true, onDragStart: (ev) => onFolderDragStart(ev, f), onDragEnd: (ev) => onFolderDragEnd(ev), onDragOver: (ev) => onFolderDragOver(ev, f), onDragLeave: onFolderDragLeave, onDrop: (ev) => onFolderDrop(ev, f) },
                  e('span', { className: 'dsh-notes-caret' + (fOpen ? ' open' : '') + ' dsh-nt', 'data-tooltip': tt('tree.toggleTip'), onClick: (ev) => { ev.stopPropagation(); toggleFolder(f.id) } }, I('chev', 10)),
                  e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                  e('span', { className: 'dsh-notes-row-nm' }, f.name),
                  e('span', { className: 'dsh-notes-row-n' }, cnt)))
            if (!fOpen) return
            const childEls = []
            // 「新建子文件夹」内联输入行（右键菜单打开；渲染在本夹子内容容器首位，Enter 提交 / Esc 或空串失焦取消）
            if (subFolderFor === f.id) {
              childEls.push(e('div', { key: 'folder-add-sub', className: 'dsh-notes-folder-row' },
                e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                e('input', { className: 'dsh-notes-folder-rename', placeholder: tt('tree.subFolderPlaceholder'), value: folderInputText, autoFocus: true, onChange: (ev) => setFolderInputText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setSubFolderFor(null) } }, onBlur: () => { if (!folderInputText.trim()) setSubFolderFor(null) } })))
            }
            for (const cf of childFoldersOf(f.id)) renderFolderNode(cf, childEls)
            kids.forEach(n => { treeIds.push(n.id); childEls.push(renderNoteRow(n, true)) })
            if (childEls.length) sink.push(e('div', { key: 'kids-' + f.id, className: 'dsh-notes-nested' }, childEls))
          }
          for (const f of rootFolders()) renderFolderNode(f, treeEls)
          // 新建文件夹内联输入行（分组头 ＋ 展开；Enter 提交 / Esc 或空串失焦取消）
          if (folderInputOpen) {
            treeEls.push(e('div', { key: 'folder-add', className: 'dsh-notes-folder-row' },
              e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
              e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
              e('input', { className: 'dsh-notes-folder-rename', placeholder: tt('tree.folderPlaceholder'), value: folderInputText, autoFocus: true, onChange: (ev) => setFolderInputText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setFolderInputOpen(false) } }, onBlur: () => { if (!folderInputText.trim()) setFolderInputOpen(false) } })))
          }
          // 未入夹笔记：根级同级直显——无 folder 的笔记平铺在树根部，与文件夹行同一缩进层级（紧随文件夹列表之后、主题过滤区之前；
          // 不再渲染「未分类」分组头/分区计数——数量已并入 brand 行总计数；主题聚合由底部「主题过滤」区承担，不重复聚合）；
          // .dsh-notes-unfiled-drop 包裹容器保留为「移出文件夹」drop 落点（拖到本区任意位置 = 移出），仅在 有未入夹笔记 或 拖拽进行中 渲染——
          // 空态非拖拽不渲染任何占位；拖拽中本区头部显示淡提示行「拖到此处移出文件夹」（dragActive 驱动，空态下也保证有可拖出落点）
          const unfiled = paged.filter(n => !(n.folder || ''))
          const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })
          if (unfiledKids.length || dragActive) {
            // 提示行排笔记行**之后**（notes-041d-drag-root-note）：dragActive 点亮瞬间若在行首插入提示行，会把本夹笔记行（=拖拽源行）整体下移，
            // Chromium 判定拖拽源位移直接取消拖拽（dragstart→立即 dragend）——根目录笔记因此拖不进文件夹；置尾后源行零位移，拖拽链路恢复
            treeEls.push(e('div', { key: 'unfiled-drop', className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop },
              unfiledKids,
              dragActive ? e('div', { key: 'unfiled-hint', className: 'dsh-notes-unfiled-hint' }, dragFolderIdRef.current ? tt('tree.dropRootHint') : tt('tree.dropOutHint')) : null))
          }
          // 主题全局过滤（原型底部区）：全库主题 + 计数；点行主体 = 原地展开/收起该主题的笔记子列表（topicExpanded，不持久化）；
          // 主题视图（跨文件夹过滤）降级为行尾过滤图标按钮（不抢占单击）
          const allTopics = {}
          notes.forEach(n => { if (n.topic) allTopics[n.topic] = (allTopics[n.topic] || 0) + 1 })
          const topicNames = Object.keys(allTopics).sort()
          if (topicNames.length) {
            // 整区默认折叠（notes-topic-collapse）：常态只显示「主题 (N)」一行（N=主题数），点分组头展开/收起（topicSecOpen，session 记忆不持久化）；
            // 展开行为与置顶折叠组（PINNED_KEY）同款：过滤激活且有主题命中时纯计算 OR 自动展开（不写回 topicSecOpen——清除过滤即恢复手动折叠态），
            // 头部计数同步切换为命中主题数（folders「过滤激活=命中数」同口径）
            const topicHitSet = {}
            filtered.forEach(n => { if (n.topic) topicHitSet[n.topic] = true })
            const topicHitCount = Object.keys(topicHitSet).length
            const topicSecOpenEff = topicSecOpen || (filtersActive && topicHitCount > 0)
            treeEls.push(e('div', { key: 'sec-topics', className: 'dsh-notes-sec-h dsh-notes-sec-toggle', onClick: () => setTopicSecOpen(!topicSecOpen) },
              e('span', { className: 'dsh-notes-caret' + (topicSecOpenEff ? ' open' : '') }, I('chev', 10)),
              I('topic', 11),
              e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.topicsHeader', { n: filtersActive ? topicHitCount : topicNames.length })),
              e('span', { className: 'dsh-notes-sec-h-sub' }, tt('tree.crossFolder'))))
            if (topicSecOpenEff) topicNames.forEach(tn => {
              const tkidsAll = filtered.filter(n => (n.topic || '') === tn)
              // 过滤激活自动展开：含命中的主题行强制展开（纯计算 OR，不写回 topicExpanded——清除过滤即恢复）；计数同步切换为命中数
              const tOpen = !!topicExpanded[tn] || (filtersActive && tkidsAll.length > 0)
              treeEls.push(e('div', { key: 'tp-' + tn, className: 'dsh-notes-row dsh-notes-topic-row' + (view.type === 'topic' && view.id === tn ? ' on' : ''), onClick: () => toggleTopicExpanded(tn) },
                e('span', { className: 'dsh-notes-caret' + (tOpen ? ' open' : '') }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('topic', 12)),
                e('span', { className: 'dsh-notes-row-nm' }, tn === '分类中' ? tt('tree.classifying') : tn),
                e('span', { className: 'dsh-notes-row-n' }, filtersActive ? tkidsAll.length : allTopics[tn]),
                e('span', { className: 'dsh-notes-row-vfilter dsh-nt' + (view.type === 'topic' && view.id === tn ? ' on' : ''), 'data-tooltip': tt('tree.topicViewTip'), onClick: (ev) => { ev.stopPropagation(); setView(view.type === 'topic' && view.id === tn ? { type: 'all', id: '' } : { type: 'topic', id: tn }) } }, I('filter', 11))))
              if (tOpen) {
                const tkids = paged.filter(n => (n.topic || '') === tn)
                if (tkids.length) { tkids.forEach(n => { treeIds.push(n.id) }); treeEls.push(e('div', { key: 'tpk-' + tn, className: 'dsh-notes-nested' }, tkids.map(n => renderNoteRow(n, false)))) }
              }
            })
          }
          // 空态：全库为空 → 引导新建；有库但过滤为空 → 无匹配提示
          if (notes.length === 0 && !loading) {
            treeEls.push(e('div', { key: 'empty', className: 'dsh-notes-empty-state' },
              e('div', { className: 'dsh-notes-empty-ic' }, I('note', 30)),
              e('div', { className: 'dsh-notes-empty-t' }, tt('tree.emptyTitle')),
              e('div', { className: 'dsh-notes-empty-s' }, tt('tree.emptySub')),
              e('button', { className: 'dsh-notes-empty-btn', onClick: openNewNote }, tt('tree.emptyBtn'))))
          } else if (filtered.length === 0 && filtersActive) {
            // 空结果态：提示 + 筛选中心条件激活时附「清空筛选」快捷动作（设计稿口径⑦）
            treeEls.push(e('div', { key: 'no-match', className: 'dsh-notes-sec-h' }, e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.noMatch')),
              filterCount > 0 ? e('span', { className: 'dsh-notes-sec-h-clear dsh-nt', 'data-tooltip': tt('tree.clearAllFiltersTip'), onClick: () => { setFilters(FILTERS0()); if (searchDebRef.current) searchDebRef.current() } }, tt('tree.clearFiltersShort')) : null))
          }
          if (loading && notes.length === 0) treeEls.unshift(e('div', { key: 'loading', className: 'dsh-notes-loading' }, tt('common.loading')))
          // 键盘导航顺序 = 树渲染顺序（置顶组与所属位置重复出现的笔记去重）
          pagedIdsRef.current = Array.from(new Set(treeIds))
          return treeEls
        }
        return {
          visibleCount: visibleCount, setVisibleCount: setVisibleCount, dragActive: dragActive, onListScroll: onListScroll,
          onNoteDragStart: onNoteDragStart, onNoteDragEnd: onNoteDragEnd, renderTreeEls: renderTreeEls
        }
    }
    // ===== panel/editor —— 编辑器区：meta chips/双模式交互/自动保存/面包屑/反向链接/底栏（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelEditor（ed* 字段态/历史计数/派发历史折叠/整理撤销栈 + selectNote/doSave/doDelete/AI 整理/历史恢复回填/三态开关/双模式运行时 +
    //           renderEditorEl 渲染函数（内含 editorEl/curNote/isInjected/面包屑/反向链接求值））
    // needs: kernel/state.js（selectedRef/editorModeRef/switchModeRef 跨域镜像 + setSelected/setFocusId/setError/setView/setSelIds/setScopeOpen/expandFolder/
    //        folderPathOf/folderName/injectScopeLabel/loadNotes/later 转发别名）、kernel/constants.js（KIND_LABELS）、kernel/format.js（shortSid/isDispatchDone/fmtDT/schedFreqLabel/schedNextMs/schedPeerKey/relatedScheds/notifyNotesChanged）、
    //        kernel/bus.js（showToast）、kernel/icons.js（e/I）、editor-kernel.js（esc/renderMarkdown/serializeRich/analyzeMarkdown/sanitizeFragment/assetDisplaySrc/wikiLinksTo）、
    //        panel/wiki.js（jumpWikiRef/wikiBodiesRef 顶层绑定，序位在前）、modals/link.js（setLinkModal）+ modals/image.js（openImgModal/pickImageFile）+
    //        modals/dispatch.js（openDispatch/doDispatchDone）+ modals/history.js（openHistory）+
    //        modals/inject-manager.js（doInjSchedEdit/doInjSchedToggle/doInjSchedDel——计划块原地操作复用，notes-041-sched-plan-edit；
    //        openMountModal——三态切「资料」档先弹挂载框，0.4.3 验收修复⑪）——序位在前；
    //        selected/notes/dispatching/wikiVer/wikiResolve/bumpWikiBody/jumpToWikiTarget 经 hook 入参注入（装配层回填，渲染期新鲜值）
    // state 托管：全部 state/ref 留 hook 内（useState/useRef 声明原文被 check.js 锚定者不迁 store——27-5 节 edSens/edSensRef 等；
    // 与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）
    function usePanelEditor(args) {
        const selected = args.selected, notes = args.notes, dispatching = args.dispatching
        const wikiVer = args.wikiVer, wikiResolve = args.wikiResolve, bumpWikiBody = args.bumpWikiBody, jumpToWikiTarget = args.jumpToWikiTarget
        // i18n（notes-042-i18n-cov-b 覆盖卡B）：tt = useT()——订阅 langStore，切语言本 hook（随主面板）自渲染；编辑器/meta 区文案全走 tt()
        const tt = useT()
        const [edTitle, setEdTitle] = React.useState('')
        const [edTopic, setEdTopic] = React.useState('')
        const [edTags, setEdTags] = React.useState('')
        const [edBody, setEdBody] = React.useState('')
        const [edKind, setEdKind] = React.useState('note')
        const [edStatus, setEdStatus] = React.useState('active')
        const [edRole, setEdRole] = React.useState('off')   // 注入三态：off=不注入 / convention=约定（须遵守）/ reference=资料（按需取用）
        // 「目录可见」chip 已拆除（0.4.3 验收修复⑪ notes-043-mount-ux-final：目录注入缺省关后开关无感知作用）——
        //   host recall 字段/缺省/目录开关过滤逻辑保留（chip 拆除≠字段退役）；doSave 不再携带 recall（undefined=host 保留存量值）
        const [edSens, setEdSens] = React.useState(false)   // 敏感标记（sensitive 字段，缺省 false；开启后注入系统提示时正文按行打码）
        const [edHidden, setEdHidden] = React.useState(false)   // 0.4.4-D 隐藏标记（hidden 字段，缺省 false；开启后列表/树遮罩滤除，跳转/搜索打开不受影响）
        const [edScope, setEdScope] = React.useState([])
        const [savedAt, setSavedAt] = React.useState(0)
        // ===== 双模式编辑器 v3（原型 design/notes-editor-v3.html）：源码 textarea ⇄ 富文本受限 WYSIWYG =====
        // editorMode：'source' 源码 | 'rich' 富文本；默认源码；Ctrl+/ 或 meta 行两段开关切换
        const [editorMode, setEditorModeState] = React.useState('source')
        // editorModeRef 在 kernel/state.js 跨域镜像群（panel/keyboard.js Ctrl+/ 直读；下方镜像块每渲染写入）
        // 白名单降级分析（analyzeMarkdown 内核）：正文含嵌套引用/h4+/任务列表/多行 HTML 块 → 富文本入口置灰（行内 HTML 自 L1、表格自 L2 起不再降级——表格只读渲染 + 序列化逐字回吐）
        const [degraded, setDegraded] = React.useState({ ok: true, reasons: [] })
        const degradedRef = React.useRef({ ok: true, reasons: [] })
        // 富文本同步态徽标（工具栏右侧）：false=已同步源码 / true=编辑中（防抖未回写）；同值 setState React 自动 bail，逐击键调无重渲染开销
        const [richSyncing, setRichSyncing] = React.useState(false)
        const [dispatchHistoryOpen, setDispatchHistoryOpen] = React.useState(false)   // 派发历史折叠态：默认折叠，点标题行展开
        // 0.4.4-A open-by-id 旁路（notes-044-dispatch-receipts 执行记录跳转）：缓存未命中的笔记（存量 kind=sys 执行记录缺省降噪 /
        //   在途新建列表未刷新）经 notes-get 直开后挂本旁路供渲染层回退——不进 notes 缓存（不刷列表/树红线）
        const [openByIdNote, setOpenByIdNote] = React.useState(null)
        // ===== 派发计划块 + 关联调度清单（notes-034-sched-detail）：本笔记是 dispatch-schedule 约定 → meta 尾部计划块；
        // 关联调度 = 标题去「定时」前缀匹配的其他调度约定（≤5 条，点击 selectNote 跳转）；数据源 = notes slim 缓存（contractType/schedule 字段，零新 RPC）=====
        // schedPeerCacheRef/schedPeerTriedRef = log 型调度约定（front-matter 裸编辑旁路）会话级按需一次 includeLogs 兜底缓存
        const [schedPeerVer, setSchedPeerVer] = React.useState(0)   // 兜底缓存到达驱动重算（wikiVer 同模式）
        const schedPeerCacheRef = React.useRef(null)
        const schedPeerTriedRef = React.useRef(false)
        // ===== 二期 ✨整理：notes-ai-organize 按 kind 模板重写正文；organizeUndoRef = 一次撤销栈（toast「撤销」恢复）=====
        const [organizing, setOrganizing] = React.useState(false)
        const organizeUndoRef = React.useRef(null)   // { body } | null
        // ===== 历史版本面板（notes-history-ui）：详情 meta 行「历史」入口（有版本才显示）→ modal：版本列表（时间+大小）→ 点选只读预览 → 恢复 =====
        const [histCount, setHistCount] = React.useState(null)    // 当前笔记历史版本数（null=未探测；0=无版本不显示入口）
        const keepQuickRef = React.useRef(false)
        const edBodyDomRef = React.useRef(null)      // 正文 textarea DOM（新建笔记创建后聚焦）
        const edLoadingRef = React.useRef(false)     // 正文异步加载中（notes-get 在途）：AI 整理等入口的轻量互斥指示
        // R-1 安全态双字段（P0 数据丢失防护，check 节 46 看守）：edBodyLoadedRef=正文提交闸（仅 notes-get 成功后置 true，doSave 才携带 body）；
        // edLoadErr=加载失败安全态（锁定编辑 + doSave 整体暂停 + 横幅重试），绝不以空 body 为基底提交
        const edBodyLoadedRef = React.useRef(false)
        const [edLoadErr, setEdLoadErr] = React.useState('')
        const edLoadErrRef = React.useRef('')        // doSave 闭包读最新值（与 histCountRef 同模式）
        // 双模式编辑器 DOM/运行时 ref（富文本非受控：编辑期间 React 不重渲染其内容，防 IME 打断/光标丢失）
        const richRef = React.useRef(null)           // 富文本 contenteditable DOM
        const richWrapRef = React.useRef(null)       // 富文本滚动容器（拖拽图片 drop 目标 + 工具栏宿主）
        const richDirtyRef = React.useRef(false)     // 富文本编辑中（未序列化回源码）
        const composingRef = React.useRef(false)     // IME 组合输入中（期间不序列化）
        const savedRangeRef = React.useRef(null)     // 富文本选区缓存（工具栏/弹窗操作后恢复）
        const richSyncTimerRef = React.useRef(null)  // 富文本→源码 900ms 防抖 timer 句柄（disposer）
        const degTimerRef = React.useRef(null)       // 源码→降级分析 450ms 防抖 timer 句柄
        const histCountRef = React.useRef(null)     // 历史版本计数镜像（doSave/openHistory 闭包读最新值；histOpenRef 随 modal 迁入 modals/history.js）
        // 自动保存：编辑字段的最新值 ref（debounce 回调读 ref 而非闭包 state，避免过期）
        const edTitleRef = React.useRef('')
        const edTopicRef = React.useRef('')
        const edTagsRef = React.useRef('')
        const edBodyRef = React.useRef('')
        const edKindRef = React.useRef('note')
        const edStatusRef = React.useRef('active')
        const edRoleRef = React.useRef('off')
        const edSensRef = React.useRef(false)
        const edHiddenRef = React.useRef(false)   // 0.4.4-D hidden 镜像（自动保存 debounce 读最新值）
        const edScopeRef = React.useRef([])
        const autoSaveRef = React.useRef(null)
        React.useEffect(() => { histCountRef.current = histCount }, [histCount])
        function selectNote(n) {
          // 双模式：切换笔记前把富文本在途编辑序列化落回 edBody 并立即保存（防 900ms debounce 打到新笔记上）
          if (editorModeRef.current === 'rich' && richDirtyRef.current) { syncFromRich('切换笔记'); doSave() }
          // 选中笔记所在文件夹自动展开（保证选中笔记在树中可见）
          if (n.folder) expandFolder(n.folder)
          setSelected(n.id); setFocusId(n.id); setEdTitle(n.title); setEdTopic(n.topic && n.topic !== '分类中' ? n.topic : '')
          keepQuickRef.current = (n.tags || []).indexOf('quick') >= 0
          setEdTags((n.tags || []).filter(t => t !== 'quick').join(', '))
          setEdKind(n.kind || 'note'); setEdStatus(n.status || 'active'); setEdRole(n.inject ? (n.injectRole || 'convention') : 'off'); setEdScope(n.injectTo || []); setEdSens(n.sensitive === true)
          setEdHidden(n.hidden === true)   // 0.4.4-D：hidden 状态回填（open-by-id 旁路笔记同口径——跳转打开 hidden 笔记编辑器/meta chip 正常渲染）
          setEdBody('')
          setDegraded({ ok: true, reasons: [] })   // 正文未加载前降级态复位（横幅不残留上一条笔记的分析结果）
          histCountRef.current = null; setHistCount(null)   // 换笔记重置「历史」入口可见性，随即探测版本计数
          // 0.4.4-A：open-by-id 旁路登记——缓存外笔记（执行记录跳转 notes-get 直开产物）挂旁路供 curNote 回退；缓存内选中清零
          setOpenByIdNote(notes.some(x => x.id === n.id) ? null : n)
          probeHistCount(n.id)
          loadEdBody(n.id)
        }
        // 0.4.4-A 执行记录跳转共用入口（派发历史行尾按钮 + 计划块「执行记录 ↗」）：缓存命中直接 selectNote；
        //   未命中（存量 sys 执行记录缺省降噪/在途新建）→ notes-get 直开（open-by-id 通道，selectNote 内登记 openByIdNote 旁路）
        function openExecLog(rid) {
          if (!rid) return
          const hit = notes.find(x => x.id === rid)
          if (hit) { selectNote(hit); return }
          rpc('notes-get', { id: rid }).then(res => {
            if (res && res.note) selectNote(res.note)
            else showToast(tt('meta.runLogNotFound', { id: rid }))
          }).catch(() => showToast(tt('meta.runLogNotFound', { id: rid })))
        }
        // R-1 安全态·正文加载（notes-get 独立成函数，「选中」与横幅「重试」共用）：
        // 成功 → edBodyLoadedRef=true（doSave 唯一放行点）；失败（res.error / 空响应 / 网络异常）→ edLoadErr 安全态
        // （锁定编辑 + 暂停自动保存），绝不以空 body 为基底提交；迟到响应（已切走）零副作用
        function loadEdBody(id) {
          edLoadingRef.current = true
          edBodyLoadedRef.current = false
          edLoadErrRef.current = ''; setEdLoadErr('')
          rpc('notes-get', { id: id }).then(res => {
            if (selectedRef.current !== id) return
            edLoadingRef.current = false
            if (res && res.note) {
              edBodyLoadedRef.current = true   // R-1 正文提交闸：全局唯一放行点
              const body = res.note.body || ''
              setEdBody(body)
              bumpWikiBody(id, body, res.note.updatedAt)   // 双链索引即时新鲜（不等后台补缺）
              // 正文到达后跑降级分析；富文本模式下新正文含白名单外语法 → 回落源码模式，否则重渲染富文本
              const a = analyzeMarkdown(body)
              setDegraded(a)
              if (editorModeRef.current === 'rich') {
                if (!a.ok) { setEditorModeState('source'); showToast(tt('editor.richDegradedReasons', { reasons: a.reasons.map(r => r.label).join(tt('common.listSep')) })) }
                else { richDirtyRef.current = false; try { if (richRef.current) richRef.current.innerHTML = renderMarkdown(body, wikiResolve) } catch (err) {} }
              }
            } else {
              const msg = tt('editor.loadFailed', { msg: res && res.error ? res.error : tt('editor.loadFailedData') })
              edLoadErrRef.current = msg; setEdLoadErr(msg)
              showToast(tt('editor.loadFailedLocked', { msg: msg }))
            }
          }).catch(err => {
            if (selectedRef.current !== id) return
            edLoadingRef.current = false
            const msg = tt('editor.loadFailed', { msg: String(err && err.message || err) })
            edLoadErrRef.current = msg; setEdLoadErr(msg)
            showToast(tt('editor.loadFailedLocked', { msg: msg }))
          })
        }
        async function doSave() {
          const id = selectedRef.current
          if (!id) return
          if (edLoadErrRef.current) return   // R-1 安全态：正文加载失败未恢复，自动保存整体暂停（横幅「重试」是唯一出口）
          setError('')
          const tags = (edTagsRef.current || '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean)
          if (keepQuickRef.current && tags.indexOf('quick') < 0) tags.push('quick')
          const upd = { id: id, title: edTitleRef.current, tags: tags, kind: edKindRef.current, status: edStatusRef.current, inject: edRoleRef.current !== 'off', injectTo: edScopeRef.current, sensitive: edSensRef.current === true, hidden: edHiddenRef.current === true }
          // R-1 正文提交闸：仅 notes-get 成功加载过正文（edBodyLoadedRef）才携带 body（host 对 undefined 保留原内容，防竞态清空正文）；
          // 已加载基础上清空为空串 = 用户有意为之，附 confirmClearBody:true 显式过 host 空覆盖兜底闸（empty-body-overwrite-guard）
          if (edBodyLoadedRef.current) { upd.body = edBodyRef.current; if (upd.body === '') upd.confirmClearBody = true }
          if (upd.inject) upd.injectRole = edRoleRef.current   // 非 off 才带 injectRole（off 态不带，payload 禁 undefined；host 仅 inject=true 落盘）
          if ((edTopicRef.current || '').trim()) upd.topic = edTopicRef.current.trim()
          try {
            const res = await rpc('notes-update', upd)
            if (res && res.error) { setError(res.error); return }
            setSavedAt(Date.now())
            bumpWikiBody(id, edBodyRef.current, '')   // 双链索引：自有正文即时新鲜（updatedAt 置空 → loadNotes 后索引复核 reconcile）
            await loadNotes(true); notifyNotesChanged()
            if (histCountRef.current === 0) probeHistCount(id)   // 首次真实保存产生首份快照（0→1 转折点）→ 补探「历史」入口
          } catch (err) { setError(String(err.message || err)) }
        }
        // 软删除（notes-034-c-confirm）：确认强度 = 不可恢复性——软删可恢复 → 轻：无 confirm 直接删，撤销 toast 兜底（回收站亦可恢复）；
        // 不可恢复的 purge（回收站「彻底删除」）才保留双确认
        async function doDelete(id) {
          if (!id) return
          setError('')
          try {
            const res = await rpc('notes-delete', { id: id })
            if (res.error) { setError(res.error); return }
            if (selected === id) { setSelected(null); setEdTitle(''); setEdTopic(''); setEdTags(''); setEdBody('') }
            showToast(tt('meta.deleted'), { label: tt('meta.undo'), fn: () => undoDelete(id) })
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 单条软删撤销：notes-restore 恢复（与 app.html doDeleteNote 的撤销链路同款）
        async function undoDelete(id) {
          try {
            const res = await rpc('notes-restore', { id: id })
            if (res && res.error) { showToast(res.error); return }
            showToast(tt('meta.restored'))
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { showToast(tt('meta.restoreFailed', { msg: String(err.message || err) })) }
        }
        // ===== 二期 ✨整理：当前草稿经 notes-ai-organize（notes-quick-instruct 同款 LLM 通道）按 kind 模板结构化重写 =====
        // 契约：host 只返回重写正文不落盘；client 替换编辑器内容后走既有自动保存；原正文进一次撤销栈（toast「撤销」恢复）。
        // 容错：正文为空/加载中/整理中不重入；error 或空返回一律不动原文。
        async function doAiOrganize() {
          if (organizing) return
          if (!selectedRef.current) { showToast(tt('editor.selectNoteFirst')); return }
          if (edLoadingRef.current) { showToast(tt('editor.bodyLoading')); return }
          // 富文本在途编辑先序列化落回源码（整理对象是 edBody 源码文本）
          if (editorModeRef.current === 'rich' && richDirtyRef.current) syncFromRich('整理前同步')
          const body = edBodyRef.current
          if (!body || !body.trim()) { showToast(tt('editor.bodyEmpty')); return }
          setOrganizing(true); setError('')
          try {
            const res = await rpc('notes-ai-organize', { body: body, kind: edKindRef.current, title: edTitleRef.current })
            if (res && res.error) { showToast(tt('editor.organizeFailed', { msg: res.error })); return }
            if (!res || !res.body || !res.body.trim()) { showToast(tt('editor.organizeEmpty')); return }
            organizeUndoRef.current = { body: body }   // 一次撤销栈：只保留最近一次整理前的正文
            applyOrganizedBody(res.body)
            showToast(tt('editor.organized', { kind: kindLabel(edKindRef.current) || tt('meta.kindNote') }), { label: tt('meta.undo'), fn: undoAiOrganize })
          } catch (err) { showToast(tt('editor.organizeFailed', { msg: String(err.message || err) })) } finally { setOrganizing(false) }
        }
        // 重写正文落进编辑器双模式：源码 textarea 受控随 edBody 更新；富文本重渲染内核产物（白名单外语法则回落源码模式）
        function applyOrganizedBody(text) {
          edBodyRef.current = text; setEdBody(text)
          const a = analyzeMarkdown(text)
          setDegraded(a)
          if (editorModeRef.current === 'rich') {
            if (!a.ok) setEditorModeState('source')   // 如 todo 模板含任务列表语法 → 自动落源码模式（横幅给出原因）
            else { richDirtyRef.current = false; try { if (richRef.current) richRef.current.innerHTML = renderMarkdown(text, wikiResolve) } catch (err) {} }
          }
          triggerAutoSave()   // 走既有 900ms 防抖自动保存（notes-update）
        }
        // 撤销最近一次整理（一次撤销栈，用后即清）
        function undoAiOrganize() {
          const u = organizeUndoRef.current
          if (!u) { showToast(tt('editor.noOrganizeUndo')); return }
          organizeUndoRef.current = null
          applyOrganizedBody(u.body)
          showToast(tt('editor.organizeUndone'))
        }
        // ===== 历史版本面板（notes-history-ui）：「历史」入口探测 + 列表/预览/恢复链路 =====
        // 入口可见性探测：选中笔记后拉版本计数（notes-history 是轻量列表 RPC，零正文明文）；0 版本不显示入口。
        // doSave 完成后仅在 0→1 转折点补探一次（首次真实保存产生首份快照），其余保存不增 RPC。
        function probeHistCount(id) {
          if (!id) return
          rpc('notes-history', { id: id }).then(res => {
            if (res && !res.error && selectedRef.current === id) { const c = (res.versions || []).length; histCountRef.current = c; setHistCount(c) }
          }).catch(() => {})
        }
        // 恢复回填（与 applyOrganizedBody 差别：恢复版已由 host 落盘，不走 triggerAutoSave——恢复不是新编辑，不能再把恢复版快照一遍污染历史）
        function applyRestoredBody(id, text) {
          edBodyRef.current = text; setEdBody(text)
          const a = analyzeMarkdown(text)
          setDegraded(a)
          if (editorModeRef.current === 'rich') {
            if (!a.ok) setEditorModeState('source')
            else { richDirtyRef.current = false; try { if (richRef.current) richRef.current.innerHTML = renderMarkdown(text, wikiResolve) } catch (err) {} }
          }
          bumpWikiBody(id, text, '')
        }
        function jumpToSession(sessionId) { if (sessions && sessionId) { try { sessions.open(sessionId) } catch (err) {} } }
        // ===== 派发计划块辅助（notes-034-sched-detail；与注入管理调度区同口径同数据源，schedBadgeEl/schedNextLabel 镜像）=====
        // 上次结果徽章：lastError 红 / lastRun sent 绿 / 未触发灰
        function schedPlanBadgeEl(n) {
          const s = n.schedule
          if (s.lastError) return e('span', { className: 'dsh-notes-sched-badge err dsh-nt', 'data-tooltip': s.lastError.message || '' }, I('x', 9), tt('meta.schedFailed', { time: fmtDT(s.lastError.at) }))
          if (s.lastRun) return s.lastRun.status === 'sent'
            ? e('span', { className: 'dsh-notes-sched-badge ok dsh-nt', 'data-tooltip': tt('meta.schedReceiptTip', { id: s.lastRun.receiptId || '' }) }, I('check', 9), tt('meta.schedSent', { time: fmtDT(s.lastRun.at) }))
            : e('span', { className: 'dsh-notes-sched-badge err' }, I('x', 9), tt('meta.schedFailed', { time: fmtDT(s.lastRun.at) }))
          return e('span', { className: 'dsh-notes-sched-badge' }, tt('meta.schedNever'))
        }
        // 下次触发展示：暂停 → 已暂停；单次已触发 → 已触发；否则「下次 <本地时间>」（schedNextMs 本地渲染，锚点同 host schedDueAt 口径）
        function schedPlanNextLabel(n) {
          const s = n.schedule
          if (s.enabled === false) return tt('meta.schedPaused')
          if (s.at && s.lastFiredAt && Date.parse(s.lastFiredAt) >= Date.parse(s.at)) return tt('meta.schedFired')
          const ms = schedNextMs(n)
          return ms === null ? '—' : tt('meta.schedNext', { time: fmtDT(new Date(ms).toISOString()) })
        }
        // 关联调度数据源：notes 缓存优先 + overlay 合并（log 型调度约定旁路兜底；overlay 只补缓存外条目，会话级缓存不重取）
        function schedPeerSource() {
          const extra = schedPeerCacheRef.current
          if (!extra) return notes
          const inList = {}
          notes.forEach(n => { inList[n.id] = true })
          return notes.concat(extra.filter(n => !inList[n.id]))
        }
        // 注入三态切换：独立字段 inject + injectRole（off→inject:false；约定/资料→inject:true+injectRole），不碰标签
        // off→非off 时自动展开范围浮层（与原 toggle 开启行为一致）；切到 off 收起浮层
        // 0.4.3 验收修复⑪（notes-043-mount-ux-final）：切「资料」档不再静默翻转——先弹 MountModal（LLM 草稿预填 whenToUse，
        //   editor 在面板内非 modal 可直接开）；确认 = 弹层内 notes-mount 单点收口（落索引行 + host 同步翻 reference 档），
        //   onConfirmed 同步编辑器三态 + 走既有自动保存；取消/跳过 = 零副作用（不翻注入、不落行）
        // 0.4.3 验收修复⑫（notes-043-final-polish）：开弹层前查 notes-mount-list 取 existing（预览目录行点击同款模式）——
        //   已挂载笔记进编辑模式预填现文案（不调 LLM 草稿）；迟到响应丢弃（已切笔记）；查询失败静默回退草稿模式（读失败不阻塞切换）
        function setRoleSeg(r) {
          if (r === edRole) return
          if (r === 'reference') {
            const wasOff0 = edRole === 'off'
            const mid = selectedRef.current
            if (!mid) return
            rpc('notes-mount-list', {}).then(ml => {
              if (selectedRef.current !== mid) return   // 迟到响应丢弃（已切走）
              const line = ((ml && ml.lines) || []).filter(l => l.id === mid)[0]
              openMountModal({ id: mid, title: edTitleRef.current || mid, existing: line ? line.when : undefined }, { onConfirmed: () => {
                setEdRole('reference')
                if (wasOff0) setScopeOpen(true)
                triggerAutoSave()
              } })
            }).catch(() => {
              if (selectedRef.current !== mid) return
              openMountModal({ id: mid, title: edTitleRef.current || mid }, { onConfirmed: () => {
                setEdRole('reference')
                if (wasOff0) setScopeOpen(true)
                triggerAutoSave()
              } })
            })
            return
          }
          const wasOff = edRole === 'off'
          setEdRole(r)
          if (r === 'off') setScopeOpen(false)
          else if (wasOff) setScopeOpen(true)
          triggerAutoSave()
        }
        // 敏感开关：独立字段 sensitive（缺省 false；开启后注入系统提示时正文按行打码，键保留值遮蔽，Agent 用 note_get 取原文）
        function toggleSens() { setEdSens(!edSens); triggerAutoSave() }
        // 0.4.4-D 隐藏开关：独立字段 hidden（缺省 false；开启后列表/树遮罩滤除——纯 UI 遮罩，跳转/搜索打开/agent 面不受影响）
        function toggleHidden() { setEdHidden(!edHidden); triggerAutoSave() }
        // 范围多选：切换某个会话短 id 的选中态（缺省=所有会话；存量 'global'/'workspace' 值在首次勾选时规范化掉，host 端仍容错）
        // 归一比对（notes-034-injectto-norm）：勾选态以 scopeHas 为准（存量长 id 也算已勾选）；取消勾选连同长 id 存量一并移除，保存落短 id（host 侧另有写入归一兜底）
        function toggleScope(key) {
          const cur = (edScopeRef.current || []).filter(t => t !== 'global' && t !== 'workspace')
          const next = scopeHas(cur, key) ? cur.filter(t => shortSid(t) !== key) : cur.concat([key])
          setEdScope(next)
          triggerAutoSave()
        }
        // ===== 双模式编辑器 v3：模式切换 / 序列化同步 / 工具栏 / 图片三入口（规格：design/notes-editor-v3.html）=====
        // switchModeRef 在 kernel/state.js 跨域镜像群（全局 keydown 闭包挂一次，经 ref 调最新 switchMode）
        // 模式切换（原型 setMode）：进富文本前跑降级分析；离开富文本先把在途编辑序列化落回源码
        function switchMode(m) {
          if (m === editorModeRef.current) return
          if (m === 'rich') {
            const a = analyzeMarkdown(edBodyRef.current)
            setDegraded(a)
            if (!a.ok) { showToast(tt('editor.richDegradedReasons', { reasons: a.reasons.map(r => r.label).join(tt('common.listSep')) })); return }
            richDirtyRef.current = false
            setEditorModeState('rich')
          } else {
            if (richDirtyRef.current) syncFromRich('切换模式')
            setEditorModeState('source')
          }
        }
        // 富文本 → 源码序列化（原型 syncFromRich）：内容无损最高优先——序列化结果有变化才写 edBody 并走既有 doSave 自动保存
        function syncFromRich(why) {
          const el = richRef.current
          if (!el || editorModeRef.current !== 'rich') return
          const md2 = serializeRich(el)
          richDirtyRef.current = false
          setRichSyncing(false)
          if (md2 !== edBodyRef.current) { edBodyRef.current = md2; setEdBody(md2); triggerAutoSave() }
        }
        // 富文本编辑防抖：900ms 未输入即序列化回源码（IME 组合输入期间绝不序列化）
        function scheduleRichSync() {
          if (composingRef.current) return
          if (richSyncTimerRef.current) { try { richSyncTimerRef.current() } catch (err) {} }
          richSyncTimerRef.current = later(() => { richSyncTimerRef.current = null; if (richDirtyRef.current) syncFromRich('防抖') }, 900)
        }
        // 源码模式编辑后 450ms 防抖降级分析（原型 onSourceInput）：降级态翻转时 toast 告知
        function scheduleDegAnalyze() {
          if (degTimerRef.current) { try { degTimerRef.current() } catch (err) {} }
          degTimerRef.current = later(() => {
            degTimerRef.current = null
            const a = analyzeMarkdown(edBodyRef.current)
            const was = degradedRef.current.ok
            setDegraded(a)
            if (was !== a.ok) showToast(a.ok ? tt('editor.richRestored') : tt('editor.richDisabled'))
          }, 450)
        }
        // 富文本选区缓存/恢复（工具栏 mousedown 阻止默认保住选区；弹窗关闭后恢复）
        function keepSel() { const sel = window.getSelection(); if (sel && sel.rangeCount > 0) { try { savedRangeRef.current = sel.getRangeAt(0).cloneRange() } catch (err) {} } }
        function restoreSel() {
          const sel = window.getSelection(); if (!sel) return
          sel.removeAllRanges()
          if (savedRangeRef.current) { try { sel.addRange(savedRangeRef.current); return } catch (err) {} }
          const r = document.createRange(); const el = richRef.current
          if (el) { r.selectNodeContents(el); r.collapse(false); sel.addRange(r) }
        }
        // 富文本工具栏（原型 toolbarAction）：execCommand 语义标签（styleWithCSS:false → <b>/<i>，序列化器可识别）
        function toolbarAction(a) {
          restoreSel()
          const el = richRef.current; if (el) el.focus()
          if (a === 'bold') document.execCommand('bold')
          else if (a === 'italic') document.execCommand('italic')
          else if (a === 'ul') document.execCommand('insertUnorderedList')
          else if (a === 'ol') document.execCommand('insertOrderedList')
          else if (a === 'quote') document.execCommand('formatBlock', false, 'blockquote')
          else if (a === 'code') {
            const sel = window.getSelection(), txt = sel && !sel.isCollapsed ? String(sel) : ''
            if (!txt) { showToast(tt('editor.selectCodeFirst')); return }
            document.execCommand('insertHTML', false, '<code>' + esc(txt) + '</code>')
          }
          else if (a === 'link') {
            const sel2 = window.getSelection()
            if (!sel2 || sel2.isCollapsed) { showToast(tt('editor.selectLinkFirst')); return }
            keepSel(); setLinkModal({ text: String(sel2), url: 'https://' }); return
          }
          else if (a === 'image') { keepSel(); openImgModal(null); return }
          keepSel(); richDirtyRef.current = true; scheduleRichSync(); updateToolbarState()
        }
        // 工具栏激活态（原型 updateToolbarState）：直接拨 className，不走 React setState（selectionchange 高频）
        function updateToolbarState() {
          const wrap = richWrapRef.current
          if (!wrap || editorModeRef.current !== 'rich') return
          const map = { bold: 'bold', italic: 'italic', ul: 'insertUnorderedList', ol: 'insertOrderedList' }
          const btns = wrap.querySelectorAll('.dsh-notes-rtb-btn')
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i], a = b.getAttribute('data-a')
            let on = false
            try { if (map[a]) on = document.queryCommandState(map[a]) } catch (err) {}
            if (a === 'quote' || a === 'code') {
              const sel = window.getSelection()
              let n = sel && sel.rangeCount ? sel.anchorNode : null
              if (n && n.nodeType === 3) n = n.parentNode
              on = !!(n && n.closest && n.closest(a === 'quote' ? 'blockquote' : 'code'))
            }
            b.classList.toggle('on', !!on)
          }
        }
        // 富文本粘贴 HTML 白名单清洗插入（原型 insertSanitizedHtml；清洗规则见内核 sanitizeFragment）
        function insertSanitizedHtml(html) {
          const doc = new DOMParser().parseFromString(html, 'text/html')
          const clean = sanitizeFragment(doc.body)
          const sel = window.getSelection()
          if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0); r.deleteContents()
            const frag = document.createDocumentFragment()
            let n; const nodes = []
            while ((n = clean.firstChild)) nodes.push(n)
            nodes.forEach(x => frag.appendChild(x))
            r.insertNode(frag)
          }
          richDirtyRef.current = true; scheduleRichSync()
        }
        // 光标处插入图片（原型 applyInsertImage）：源码模式插 Markdown 文本，富文本模式插 img 节点（随后序列化同步回源码）
        function insertImageMd(mdSrc, alt) {
          if (editorModeRef.current === 'rich') {
            restoreSel()
            const el = richRef.current; if (!el) return
            el.focus()
            const img = document.createElement('img')
            img.src = assetDisplaySrc(mdSrc); img.setAttribute('data-md-src', mdSrc); img.alt = alt
            const sel = window.getSelection(), range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
            let blk = range ? range.startContainer : null
            if (blk && blk.nodeType === 3) blk = blk.parentNode
            const p = blk && blk.closest ? blk.closest('p') : null
            if (p && !p.textContent.trim() && !p.querySelector('img')) p.appendChild(img)   // 空段落 → 直接放入
            else if (range) { range.deleteContents(); range.insertNode(img) }               // 光标处内联插入
            else el.appendChild(img)
            richDirtyRef.current = true
            syncFromRich('插入图片')
          } else {
            const ta = edBodyDomRef.current
            const cur = edBodyRef.current
            const pos = ta && ta.selectionStart != null ? ta.selectionStart : cur.length
            const ins = '![' + alt + '](' + mdSrc + ')'
            const next = cur.slice(0, pos) + ins + cur.slice(pos)
            edBodyRef.current = next; setEdBody(next); triggerAutoSave(); scheduleDegAnalyze()
            later(() => { try { const t2 = edBodyDomRef.current; if (t2) { t2.focus(); t2.setSelectionRange(pos + ins.length, pos + ins.length) } } catch (err) {} }, 60)
          }
        }
        // 进入富文本 / 切换笔记：渲染内核产物进 contenteditable + 绑定编辑事件（编辑期间不重渲染，防 IME 打断）
        React.useEffect(() => {
          if (editorMode !== 'rich') return
          const el = richRef.current, wrap = richWrapRef.current
          if (!el || !wrap) return
          if (!richDirtyRef.current) el.innerHTML = renderMarkdown(edBodyRef.current, wikiResolve)
          try { document.execCommand('styleWithCSS', false, false) } catch (err) {}
          const onInput = () => { richDirtyRef.current = true; setRichSyncing(true); scheduleRichSync(); keepSel() }
          const onCompStart = () => { composingRef.current = true; if (richSyncTimerRef.current) { try { richSyncTimerRef.current() } catch (e2) {} richSyncTimerRef.current = null } }
          const onCompEnd = () => { composingRef.current = false; richDirtyRef.current = true; setRichSyncing(true); scheduleRichSync() }
          const onBlur = () => { if (richDirtyRef.current) syncFromRich('失焦') }
          const onKeyUp = () => updateToolbarState()
          const onMouseUp = () => { keepSel(); updateToolbarState() }
          const onSelChange = () => { const sel = window.getSelection(); if (sel && sel.rangeCount && el.contains(sel.anchorNode)) { keepSel(); updateToolbarState() } }
          // P2 双链：富文本内点击 [[..]] 锚 → 跳转选中目标笔记（阻止默认 #wiki 哈希跳转；跳前序列化在途编辑落回源码）
          // L2 只读表格：点击表格区块 → toast 提示（contenteditable=false 原子岛屿，富文本内不做表格编辑）
          const onWikiClick = (ev) => {
            const a = ev.target && ev.target.closest ? ev.target.closest('a[data-wiki]') : null
            if (a && el.contains(a)) {
              ev.preventDefault(); ev.stopPropagation()
              if (jumpWikiRef.current) jumpWikiRef.current(a.getAttribute('data-wiki') || '')
              return
            }
            const tb = ev.target && ev.target.closest ? ev.target.closest('table.dsh-notes-table') : null
            if (tb && el.contains(tb)) showToast(tt('editor.tableReadonly'))
          }
          // 图片入口①：Ctrl+V 粘贴（clipboardData.files）；其余粘贴：HTML → 白名单清洗，纯文本 → 纯文本插入
          const onPaste = (ev) => {
            const cd = ev.clipboardData
            // 注：mime 判定用 indexOf 而非正则 /^image\//——build-dist 抽取器不识正则字面量，`\/`+`/` 相邻会被误当行注释
            if (cd && cd.files && cd.files.length && cd.files[0].type.indexOf('image/') === 0) {
              ev.preventDefault(); keepSel(); pickImageFile(cd.files[0]); return
            }
            const html = cd ? cd.getData('text/html') : ''
            if (html) { ev.preventDefault(); insertSanitizedHtml(html); return }
            const txt = cd ? cd.getData('text/plain') : ''
            if (txt) { ev.preventDefault(); document.execCommand('insertText', false, txt) }
          }
          // 图片入口②：拖拽文件进富文本
          const onDragOver = (ev) => { ev.preventDefault(); wrap.classList.add('drop') }
          const onDragLeave = () => wrap.classList.remove('drop')
          const onDrop = (ev) => {
            ev.preventDefault(); wrap.classList.remove('drop')
            const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]
            if (!f) return
            if (!f.type || f.type.indexOf('image/') !== 0) { showToast(tt('editor.imageOnly')); return }
            keepSel(); pickImageFile(f)
          }
          el.addEventListener('input', onInput)
          el.addEventListener('compositionstart', onCompStart)
          el.addEventListener('compositionend', onCompEnd)
          el.addEventListener('blur', onBlur)
          el.addEventListener('keyup', onKeyUp)
          el.addEventListener('mouseup', onMouseUp)
          el.addEventListener('paste', onPaste)
          el.addEventListener('click', onWikiClick)
          wrap.addEventListener('dragover', onDragOver)
          wrap.addEventListener('dragleave', onDragLeave)
          wrap.addEventListener('drop', onDrop)
          document.addEventListener('selectionchange', onSelChange)
          return () => {
            el.removeEventListener('input', onInput)
            el.removeEventListener('compositionstart', onCompStart)
            el.removeEventListener('compositionend', onCompEnd)
            el.removeEventListener('blur', onBlur)
            el.removeEventListener('keyup', onKeyUp)
            el.removeEventListener('mouseup', onMouseUp)
            el.removeEventListener('paste', onPaste)
            el.removeEventListener('click', onWikiClick)
            wrap.removeEventListener('dragover', onDragOver)
            wrap.removeEventListener('dragleave', onDragLeave)
            wrap.removeEventListener('drop', onDrop)
            document.removeEventListener('selectionchange', onSelChange)
          }
        }, [editorMode, selected])
        // 关联调度兜底（notes-034-sched-detail③）：详情涉及调度（自身是调度约定或缓存内已有匹配）且缓存口径不含 log 时，
        // 会话级按需一次 notes-list includeLogs 补齐 log 型调度约定（front-matter 旁路）；常态零新 RPC（复用 notes slim 缓存）
        React.useEffect(() => {
          const cur = notes.find(n => n.id === selected)
          if (!cur) return
          if (!((cur.contractType || '') === 'dispatch-schedule' && cur.schedule) && !relatedScheds(cur, notes).length) return
          if (schedPeerTriedRef.current) return
          schedPeerTriedRef.current = true
          if (notes.some(n => (n.kind || 'note') === 'log')) return   // 缓存已是 includeLogs 口径（含 log 行），主缓存即全量
          rpc('notes-list', { includeLogs: true }).then(res => {
            if (res && res.notes) { schedPeerCacheRef.current = res.notes; setSchedPeerVer(v => v + 1) }
          }).catch(() => {})
        }, [selected, notes])
        // ===== 显式归档：预览 → 勾选 → 执行 → toast 撤销 =====
        // 归档后清理：被合并的笔记从列表消失——清掉多选残留；若正打开的笔记被合并则退出编辑器选中态
        function afterArchiveCleanup(mergedMemberIds) {
          const gone = {}
          for (const id of mergedMemberIds) gone[id] = true
          setSelIds(prev => { const next = {}; let dirty = false; for (const k of Object.keys(prev)) { if (gone[k]) dirty = true; else next[k] = true } return dirty ? next : prev })
          if (selected && gone[selected]) { setSelected(null); setEdTitle(''); setEdTopic(''); setEdTags(''); setEdBody('') }
        }
        // 同步编辑字段 ref（供自动保存 debounce 读最新值）
        edTitleRef.current = edTitle
        edTopicRef.current = edTopic
        edTagsRef.current = edTags
        edBodyRef.current = edBody
        edKindRef.current = edKind
        edStatusRef.current = edStatus
        edRoleRef.current = edRole
        edSensRef.current = edSens
        edHiddenRef.current = edHidden   // 0.4.4-D hidden 镜像同步
        edScopeRef.current = edScope
        // 双模式编辑器 ref 镜像（keydown/effect 闭包读最新值）
        editorModeRef.current = editorMode
        degradedRef.current = degraded
        switchModeRef.current = switchMode
        jumpWikiRef.current = jumpToWikiTarget   // P2 双链跳转（富文本 click 委托读最新闭包；jumpWikiRef 为 panel/wiki.js 顶层绑定）
        // 自动保存：debounce 只注册一次（null 时赋值），回调读 ref 避免闭包过期
        if (!autoSaveRef.current) autoSaveRef.current = timer.debounce(() => { if (selectedRef.current) doSave() }, 900)
        function triggerAutoSave() { if (autoSaveRef.current) autoSaveRef.current() }
        // i18n（覆盖卡B）：rich 空态 CSS content 占位串——styles.css 静态 zh 缺省保留（var() 回退值），运行时按语言态写 CSS 变量（tt 随 langStore 换实例 → 本 effect 重跑）
        React.useEffect(() => { try { document.documentElement.style.setProperty('--dsh-notes-rich-ph', '"' + tt('editor.richPlaceholder') + '"') } catch (err) {} }, [tt])
        // ===== 编辑器区渲染（原型 .ed）：面包屑 + 大标题 + meta chips 行 + 正文 + 底部状态 =====
        // 装配层 post-guard 调用（面板关闭时不求值）；scopePanelEl 等跨域渲染产物经 R 入参注入
        function renderEditorEl(R) {
          const scopePanelEl = R.scopePanelEl
          const scopeOpen = R.scopeOpen
          // 是否注入为上下文：由 inject + injectRole 双字段推出的三态决定（off 之外即注入中，不依赖标签）
          const isInjected = edRole !== 'off'
          // 当前选中笔记（编辑器区多处用）；0.4.4-A：open-by-id 旁路回退（缓存未命中的执行记录笔记直开渲染）
          const curNote = notes.find(n => n.id === selected) || (openByIdNote && openByIdNote.id === selected ? openByIdNote : null)
          const curFolderName = curNote && curNote.folder ? folderName(curNote.folder) : ''
          const curTopicName = curNote && curNote.topic && curNote.topic !== '分类中' ? curNote.topic : ''
          // 主题全局过滤跳转（面包屑主题段 + 主题 chip 跳钮共用）：未识别主题时提示不跳转
          function jumpToTopicFilter() {
            if (!curTopicName) { showToast(tt('meta.noTopic')); return }
            setView({ type: 'topic', id: curTopicName })
            showToast(tt('meta.filteredByTopic', { name: curTopicName }))
          }
          const curDispatches = (curNote && curNote.dispatches) || []
          // 0.4.4-A（notes-044-dispatch-receipts）三表归一：执行记录伴生笔记软链（调度约定 schedule.runLog / 非调度顶层 runLog）——派发历史行尾「执行记录 ↗」跳转目标
          const curExecLogId = (curNote && (curNote.runLog || (curNote.schedule && curNote.schedule.runLog))) || ''
          // P3 派发闭环：待回执条数（驱动详情 meta 徽章）
          const dispatchOpenCount = curDispatches.filter(d => !isDispatchDone(d)).length
          // ===== 派发计划块 + 关联调度清单（notes-034-sched-detail）：同 app.html renderMeta 尾部同款 =====
          void schedPeerVer   // 兜底缓存到达驱动重算（wikiVer 同模式）
          const curIsSched = !!(curNote && (curNote.contractType || '') === 'dispatch-schedule' && curNote.schedule)
          const schedPeers = curNote ? relatedScheds(curNote, schedPeerSource()).slice(0, 5) : []   // 关联清单 ≤5 条（防极端刷屏，注入管理总览看全量）
          // ===== P2 反向链接：全库正文索引扫描（extractWikiTargets/wikiLinksTo 与内核同一口径）；索引未到的条目暂不计，标题行提示「索引中…」=====
          void wikiVer   // 索引版本号驱动本区重算（索引推进 → setWikiVer → 重渲染）
          const wikiWarm = notes.every(n => !!wikiBodiesRef.current[n.id])
          const backlinks = (() => {
            if (!curNote) return []
            const out = []
            for (const n of notes) {
              if (n.id === curNote.id) continue   // 自链不算反向链接
              const c = wikiBodiesRef.current[n.id]
              if (!c) continue
              if (wikiLinksTo(c.body, curNote.id, curNote.title || '')) out.push(n)
            }
            return out
          })()
          const editorEl = curNote ? e('section', { className: 'dsh-notes-ed' },
          e('div', { className: 'dsh-notes-ed-h' },
            e('div', { className: 'dsh-notes-ed-crumb' },
              // 面包屑文件夹段（notes-nested-folder-ui）：「父/子/孙」路径；0.4.3⑦ 文件视图拆除后点击 = 树内展开该文件夹（含祖先链），不切视图
              curNote.folder ? folderPathOf(curNote.folder).map(pf => e(React.Fragment, { key: 'crumbf-' + pf.id },
                e('span', { className: 'dsh-notes-crumb-lnk dsh-nt', 'data-tooltip': tt('meta.crumbFolderExpandTip', { name: pf.name }), onClick: () => { folderPathOf(pf.id).forEach(af => expandFolder(af.id)) } }, pf.name),
                e('span', { className: 'dsh-notes-crumb-sep' }, '/'))) : null,
              e('span', { className: 'dsh-notes-crumb-lnk dsh-nt', 'data-tooltip': tt('meta.crumbTopicViewTip'), onClick: jumpToTopicFilter }, curTopicName || tt('meta.uncategorized')),
              e('span', { className: 'dsh-notes-crumb-sep' }, '/'),
              e('span', null, curNote.id)),
            e('input', { className: 'dsh-notes-ed-title', placeholder: tt('tree.untitled'), value: edTitle, readOnly: !!edLoadErr, onChange: (ev) => { setEdTitle(ev.target.value); triggerAutoSave() } }),
            e('div', { className: 'dsh-notes-ed-meta' },
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.kindTipFull') },
                e('span', { className: 'dsh-notes-meta-dot', style: { background: 'var(--nkind-' + edKind + ')' } }),
                e('select', { className: 'dsh-notes-meta-select', value: edKind, onChange: (ev) => { setEdKind(ev.target.value); triggerAutoSave() } },
                  e('option', { value: 'note' }, tt('meta.kindNote')),
                  e('option', { value: 'decision' }, tt('meta.kindDecision')),
                  e('option', { value: 'todo' }, tt('meta.kindTodo')),
                  e('option', { value: 'link' }, tt('meta.kindLink')),
                  e('option', { value: 'quote' }, tt('meta.kindQuote')),
                  e('option', { value: 'log' }, tt('meta.kindLog')),
                  /* 0.4.3⑩：sys 为机器托管 kind——仅当前笔记已是 sys 时渲染该选项（显示保真，防受控 select 回退首项误导），人工不可转入 */
                  edKind === 'sys' ? e('option', { value: 'sys' }, tt('meta.kindSys')) : null)),
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.topicTipClient') },
                I('topic', 11),
                e('input', { className: 'dsh-notes-meta-topic-input', placeholder: tt('meta.topicPlaceholder'), value: edTopic, onChange: (ev) => { setEdTopic(ev.target.value); triggerAutoSave() } }),
                e('span', { className: 'dsh-notes-meta-jump dsh-nt', 'data-tooltip': tt('meta.topicFilterTip'), onClick: jumpToTopicFilter }, I('filter', 10))),
              curFolderName ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.folderTip') }, I('folder', 11), curFolderName) : null,
              // 使用遥测（P2）：详情 meta chip「被引用 N 次」（0 次不显示）
              (curNote.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.useCountTip') }, I('quote', 11), tt('meta.useCount', { n: curNote.useCount })) : null,
              // P3 派发闭环徽章：有派发记录时聚合显示（pending=有待回执 / done=全部已回执），点击展开派发历史
              curDispatches.length ? e('span', { className: 'dsh-notes-meta-chip dsh-notes-dispatch-badge ' + (dispatchOpenCount ? 'pending' : 'done'), onClick: () => setDispatchHistoryOpen(true), 'data-tooltip': dispatchOpenCount ? tt('meta.dispPendingTip', { open: dispatchOpenCount, total: curDispatches.length }) : tt('meta.dispDoneTip', { total: curDispatches.length }) },
                I(dispatchOpenCount ? 'play' : 'check', 11),
                dispatchOpenCount ? ' ' + tt('meta.dispPending', { open: dispatchOpenCount, total: curDispatches.length }) : ' ' + tt('meta.dispDone')) : null,
              // 注入三态开关（0.4.3⑦ 注入硬关 UI 化）：kind=log 不渲染开关——UI 层不提供日志注入选项（host injectForcedOff 硬闸双保险保留）
              edKind === 'log'
                ? e('span', { className: 'dsh-notes-meta-chip dsh-nt', 'data-tooltip': tt('meta.logNoInjectTip') }, I('bolt', 11), tt('meta.logNoInject'))
                : e('span', { className: 'dsh-notes-meta-chip dsh-notes-role-seg' },
                I('bolt', 11),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'off' ? ' on' : ''), onClick: () => setRoleSeg('off'), 'data-tooltip': tt('meta.roleOffTip') }, tt('meta.roleOff')),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'convention' ? ' on' : ''), onClick: () => setRoleSeg('convention'), 'data-tooltip': tt('meta.roleConventionTip') }, tt('tree.roleConvention')),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'reference' ? ' on' : ''), onClick: () => setRoleSeg('reference'), 'data-tooltip': tt('meta.roleReferenceTip') }, tt('tree.roleReference'))),
              isInjected ? e('span', { className: 'dsh-notes-ed-scope-wrap' },
                e('button', { className: 'dsh-notes-meta-chip dsh-notes-scope-trigger dsh-nt', onClick: (ev) => { ev.stopPropagation(); setScopeOpen(!scopeOpen) }, 'data-tooltip': tt('meta.scopeTip') },
                  injectScopeLabel(edScope), e('span', { className: 'dsh-notes-scope-caret' }, '▾')),
                scopePanelEl)
              : null,
              // 曾注入徽章（injectEver 粘性标记：单向只升不降，不随关闭回退；当前已注入时由上方注入角色段表达，不重复显示）
              curNote.injectEver === true && !isInjected ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.injectEverTip') }, I('clock', 11), tt('meta.injectEver')) : null,
              e('span', { className: 'dsh-notes-meta-chip tgl' + (edSens ? ' on' : ''), onClick: toggleSens, 'data-tooltip': tt('meta.sensTip') }, I('lock', 11), tt('meta.sens')),
              // 0.4.4-D hidden chip（eye 图标）：隐藏中=列表/树不显示（跳转与搜索打开不受影响）；点击切回
              e('span', { className: 'dsh-notes-meta-chip tgl' + (edHidden ? ' on' : ''), onClick: toggleHidden, 'data-tooltip': tt('meta.hiddenTip') }, I('eye', 11), tt('meta.hidden')),
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.tagsTipClient') },
                I('tag', 11),
                e('input', { className: 'dsh-notes-meta-tags-input', placeholder: tt('meta.tagsTip'), value: edTags, onChange: (ev) => { setEdTags(ev.target.value); triggerAutoSave() } })),
              e('span', { className: 'dsh-notes-meta-sp' }),
              // 双模式两段开关（原型 .modeseg）：源码 ⇄ 富文本；降级态富文本段置灰 + tooltip 给出原因
              e('span', { className: 'dsh-notes-modeseg', role: 'group', 'aria-label': tt('meta.modeAria') },
                e('button', { className: 'dsh-notes-modeseg-seg' + (editorMode === 'source' ? ' on' : '') + ' dsh-nt', 'data-tooltip': tt('meta.srcModeTip'), onClick: () => switchMode('source') }, I('codeblock', 12), tt('meta.src')),
                e('button', { className: 'dsh-notes-modeseg-seg' + (editorMode === 'rich' ? ' on' : '') + (!degraded.ok ? ' dis' : '') + ' dsh-nt', 'data-tooltip': !degraded.ok ? tt('editor.richDegradedReasons', { reasons: degraded.reasons.map(r => r.label).join(tt('common.listSep')) }) : tt('meta.richModeTipClient'), onClick: () => switchMode('rich') }, I('eye', 12), tt('meta.rich'))),
              e('span', { className: 'dsh-notes-kbd dsh-notes-modeseg-kbd' }, 'Ctrl+/'),
              // 二期 ✨整理：AI 按当前 kind 模板重写正文（notes-ai-organize；替换后 toast 可撤销一次）
              e('span', { className: 'dsh-notes-meta-act dsh-notes-organize-btn' + (organizing ? ' busy' : '') + ' dsh-nt', onClick: (ev) => { ev.stopPropagation(); if (!organizing) doAiOrganize() }, 'data-tooltip': organizing ? tt('meta.organizingTip') : tt('meta.organizeTip', { kind: kindLabel(edKind) || tt('meta.kindNote') }) }, I('sparkle', 12), organizing ? tt('meta.organizing') : tt('meta.organize')),
              e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: (ev) => { ev.stopPropagation(); openDispatch() }, 'data-tooltip': tt('meta.dispatchTipClient') }, I('play', 12), dispatching ? '…' : tt('meta.dispatch')),
              curNote.sessionId ? e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: () => jumpToSession(curNote.sessionId), 'data-tooltip': tt('meta.sourceJumpTip') }, I('ext', 12), tt('meta.source')) : null,
              // 历史版本面板入口（notes-history-ui）：有版本时才显示（选中笔记后 notes-history 探测计数）
              (histCount || 0) > 0 ? e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: (ev) => { ev.stopPropagation(); openHistory() }, 'data-tooltip': tt('meta.histTip', { n: histCount }) }, I('clock', 12), tt('meta.history')) : null,
              e('span', { className: 'dsh-notes-meta-act' + (edStatus === 'pinned' ? ' on' : '') + ' dsh-nt', onClick: () => { setEdStatus(edStatus === 'pinned' ? 'active' : 'pinned'); triggerAutoSave() }, 'data-tooltip': edStatus === 'pinned' ? tt('meta.unpin') : tt('meta.pin') }, I('pin', 12)),
              e('span', { className: 'dsh-notes-meta-act danger dsh-nt', onClick: () => doDelete(selected), 'data-tooltip': tt('meta.delTipClient') }, I('trash', 12)),
              // 派发计划块 + 关联调度清单（notes-034-sched-detail）：meta 尾部全宽行；无调度笔记零渲染（null = 零 DOM 痕迹红线）
              (curIsSched || schedPeers.length) ? e('div', { className: 'dsh-notes-sched-plan' },
                curIsSched ? e('div', { className: 'dsh-notes-sched-plan-row' + (curNote.schedule.enabled === false ? ' paused' : '') },
                  e('span', { className: 'dsh-notes-sched-plan-t' }, I('clock', 10), tt('meta.schedPlan')),
                  e('span', { className: 'dsh-notes-sched-freq' }, schedFreqLabel(curNote.schedule)),
                  e('span', { className: 'dsh-notes-sched-target dsh-nt', 'data-tooltip': curNote.schedule.target || '' }, '→ ' + shortSid(curNote.schedule.target)),
                  e('span', { className: 'dsh-notes-sched-nf' }, schedPlanNextLabel(curNote)),
                  schedPlanBadgeEl(curNote),
                  curNote.schedule.enabled === false ? e('span', { className: 'dsh-notes-sched-badge off' }, tt('meta.schedPaused')) : null,
                  // 原地操作行（notes-041-sched-plan-edit）：编辑/暂停恢复/删除复用注入管理 doInjSched* handler（模块级同链路，零复制逻辑）；
                  // 操作后就地刷新——toggle/del：handler 内 loadNotes（curNote 由 notes 缓存派生随刷）；edit：保存后 loadNotes 同口径
                  e('span', { className: 'dsh-notes-sched-acts' },
                    // 执行记录 ↗（notes-041-sched-runlog / 0.4.4-A 三表归一）：runLog 软链存在时出跳转链接（软链统一口径 =
                    //   schedule.runLog || 顶层 runLog——手动派发先行建篇时指针在顶层；openExecLog：缓存未命中走 open-by-id 直开）
                    (curNote.schedule.runLog || curNote.runLog) ? e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': tt('meta.runLogTip', { id: curNote.schedule.runLog || curNote.runLog }), onClick: () => openExecLog(curNote.schedule.runLog || curNote.runLog) }, tt('meta.runLog')) : null,
                    e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': tt('meta.schedEditTip'), onClick: () => doInjSchedEdit(curNote) }, tt('meta.edit')),
                    e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': curNote.schedule.enabled === false ? tt('meta.schedResumeTip') : tt('meta.schedPauseTip'), onClick: () => doInjSchedToggle(curNote) }, curNote.schedule.enabled === false ? tt('meta.resume') : tt('meta.pause')),
                    e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': tt('meta.schedDelTip'), onClick: () => doInjSchedDel(curNote) }, tt('common.delete')))) : null,
                schedPeers.map(p => {
                  const ps = p.schedule, pp = ps.enabled === false
                  return e('div', { key: p.id, className: 'dsh-notes-sched-plan-row dsh-notes-sched-peer dsh-nt' + (pp ? ' paused' : ''), 'data-tooltip': tt('meta.schedPeerTip', { name: p.title || tt('tree.untitled') }), onClick: () => { const t = notes.find(x => x.id === p.id); if (t) selectNote(t); else showToast(tt('meta.schedPeerNotFound', { id: p.id })) } },
                    e('span', { className: 'dsh-notes-sched-plan-t' }, I('clock', 10), tt('meta.schedPeer')),
                    e('span', { className: 'dsh-notes-sched-peer-t' }, p.title || tt('tree.untitled')),
                    e('span', { className: 'dsh-notes-sched-freq' }, schedFreqLabel(ps)),
                    e('span', { className: 'dsh-notes-sched-nf' }, schedPlanNextLabel(p)),
                    pp ? e('span', { className: 'dsh-notes-sched-badge off' }, tt('meta.schedPaused')) : null)
                })) : null)),
          curDispatches.length ? e('div', { className: 'dsh-notes-dispatch-history' + (dispatchHistoryOpen ? ' open' : ' collapsed') },
            e('div', { className: 'dsh-notes-dispatch-history-t', onClick: () => setDispatchHistoryOpen(!dispatchHistoryOpen), role: 'button', 'aria-expanded': dispatchHistoryOpen ? 'true' : 'false' },
              I('chev', 9, 'dsh-notes-hist-caret' + (dispatchHistoryOpen ? ' open' : '')), tt('meta.dispHistory', { n: curDispatches.length })),
            dispatchHistoryOpen ? curDispatches.map((d, origIdx) => ({ d: d, origIdx: origIdx })).reverse().map(({ d, origIdx }) => e('div', { key: origIdx, className: 'dsh-notes-dispatch-rec' + (isDispatchDone(d) ? ' done' : '') },
              e('div', { className: 'dsh-notes-dispatch-rec-top' },
                e('span', { className: 'dsh-notes-dispatch-rec-t' }, isDispatchDone(d) ? [I('check', 10, 'dsh-notes-hist-done'), ' ' + (d.sessionName || d.sessionId)] : [e('span', { key: 'dot', className: 'dsh-notes-dispatch-dot' }), ' ' + (d.sessionName || d.sessionId)]),
                e('span', { className: 'dsh-notes-dispatch-rec-m' }, (isDispatchDone(d) ? tt('meta.dispStDone') : tt('meta.dispStPending')) + ' · ' + (d.mode === 'new' ? tt('meta.dispNew') : (d.workspace || tt('meta.dispExisting'))) + (d.at ? ' · ' + fmtDT(d.at).slice(5) : ''))),
              d.instruction ? e('div', { className: 'dsh-notes-dispatch-rec-i' }, tt('meta.dispInstruction', { text: d.instruction })) : null,
              !isDispatchDone(d) ? e('button', { className: 'dsh-notes-dispatch-done-btn', onClick: () => doDispatchDone(origIdx) }, tt('meta.dispMarkDone')) : null,
              // 0.4.4-A：派发历史行尾「执行记录 ↗」按钮（→ 执行记录伴生笔记；openExecLog 内含 open-by-id 兜底）
              curExecLogId ? e('button', { className: 'dsh-notes-dispatch-log-btn dsh-nt', 'data-tooltip': tt('meta.runLogTip', { id: curExecLogId }), onClick: () => openExecLog(curExecLogId) }, tt('meta.runLog')) : null)) : null)
          : null,
          // 降级横幅（原型 .deg）：检测到白名单外语法时提示（富文本入口同步置灰），删净后实时恢复
          !degraded.ok ? e('div', { className: 'dsh-notes-deg' },
            I('warn', 13),
            e('div', null,
              e('div', null, tt('editor.degBannerPre'), e('b', null, tt('editor.degBannerB')), tt('editor.degBannerPost')),
              e('div', { className: 'dsh-notes-deg-rs' }, degraded.reasons.map(r => tt('editor.degReasonItem', { label: r.label, line: r.line, sample: r.sample })).join(tt('common.listSep'))))) : null,
          // R-1 安全态横幅（正文加载失败）：锁定编辑 + 暂停自动保存 + 重试入口（复用降级横幅 .dsh-notes-deg 样式）
          edLoadErr ? e('div', { className: 'dsh-notes-deg dsh-notes-load-err' },
            I('warn', 13),
            e('div', null,
              e('div', null, edLoadErr, tt('editor.loadLockNote')),
              e('div', null, e('span', { className: 'dsh-notes-meta-act', style: { cursor: 'pointer' }, onClick: () => { if (selectedRef.current) loadEdBody(selectedRef.current) } }, tt('editor.retry'))))) : null,
          // 正文双模式（原型 .src / .rich-scroll）：源码 textarea ⇄ 富文本 contenteditable（非受控，编辑期间不重渲染）
          editorMode === 'source'
            ? e('textarea', {
                ref: edBodyDomRef, className: 'dsh-notes-ed-body', placeholder: tt('editor.bodyPlaceholder'), value: edBody, readOnly: !!edLoadErr,
                onChange: (ev) => { setEdBody(ev.target.value); triggerAutoSave(); scheduleDegAnalyze() },
                // 图片入口①/②（源码模式）：粘贴/拖拽图片文件 → 同一上传弹窗 → 光标处插 Markdown 文本
                onPaste: (ev) => { const cd = ev.clipboardData; if (cd && cd.files && cd.files.length && cd.files[0].type.indexOf('image/') === 0) { ev.preventDefault(); pickImageFile(cd.files[0]) } },
                onDragOver: (ev) => { ev.preventDefault() },
                onDrop: (ev) => { const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (!f) return; ev.preventDefault(); if (!f.type || f.type.indexOf('image/') !== 0) { showToast(tt('editor.imageOnly')); return } pickImageFile(f) }
              })
            : e('div', { ref: richWrapRef, className: 'dsh-notes-rich-scroll dsh-notes-rich-wrap' },
                e('div', { className: 'dsh-notes-rtb' },
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'bold', 'data-tooltip': tt('editor.tbBold'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('bold') } }, I('bold', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'italic', 'data-tooltip': tt('editor.tbItalic'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('italic') } }, I('italic', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'code', 'data-tooltip': tt('editor.tbCode'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('code') } }, I('codeblock', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'link', 'data-tooltip': tt('editor.tbLink'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('link') } }, I('link', 14)),
                  e('span', { className: 'dsh-notes-rtb-sep' }),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'ul', 'data-tooltip': tt('editor.tbUl'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('ul') } }, I('ul', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'ol', 'data-tooltip': tt('editor.tbOl'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('ol') } }, I('ol', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'quote', 'data-tooltip': tt('editor.tbQuote'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('quote') } }, I('quote', 14)),
                  e('span', { className: 'dsh-notes-rtb-sep' }),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'image', 'data-tooltip': tt('editor.tbImage'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('image') } }, I('image', 14)),
                  e('span', { className: 'dsh-notes-rtb-sync' + (richSyncing ? '' : ' ok') }, e('span', { className: 'dsh-notes-rtb-sync-sd' }), richSyncing ? tt('editor.syncing') : tt('editor.synced'))),
                e('div', { ref: richRef, className: 'dsh-notes-rich', contentEditable: edLoadErr ? false : true, spellCheck: false, suppressContentEditableWarning: true })),
          // P2 反向链接面板：全库正文含 [[当前id]]/[[当前标题]] 的其他笔记（点击跳转；索引未热提示「索引中…」）
          e('div', { className: 'dsh-notes-backlinks' },
            e('div', { className: 'dsh-notes-backlinks-t' }, I('link', 11), tt('editor.backlinks') + (wikiWarm ? tt('editor.backlinksCount', { n: backlinks.length }) : tt('editor.backlinksWarming'))),
            backlinks.length
              ? e('div', { className: 'dsh-notes-backlinks-list' }, backlinks.map(n => e('span', { key: n.id, className: 'dsh-notes-backlink dsh-nt', 'data-tooltip': tt('editor.backlinkJumpTip', { name: n.title || tt('tree.untitled') }), onClick: () => jumpToWikiTarget(n.id) },
                  e('span', { className: 'dsh-notes-kind-dot', style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' } }), n.title || tt('tree.untitled'))))
              : (wikiWarm ? e('div', { className: 'dsh-notes-backlinks-empty' }, tt('editor.backlinksEmpty')) : null)),
          e('div', { className: 'dsh-notes-ed-foot' },
            e('span', { className: 'dsh-notes-ed-foot-i' }, editorMode === 'source' ? tt('editor.modeSource') : tt('editor.modeRich')),
            e('span', { className: 'dsh-notes-ed-foot-i' }, tt('meta.createdAt', { time: curNote.createdAt ? fmtDT(curNote.createdAt).slice(0, 10) : '—' })),
            e('span', { className: 'dsh-notes-ed-foot-i' }, tt('meta.updatedAt', { time: curNote.updatedAt ? fmtDT(curNote.updatedAt).slice(0, 10) : '—' })),
            curNote.sessionId ? e('span', { className: 'dsh-notes-ed-foot-i' }, tt('meta.sourceSession', { short: shortSid(curNote.sessionId) })) : null,
            e('span', { className: 'dsh-notes-ed-saved' + (savedAt ? ' show' : '') }, savedAt ? tt('editor.autoSavedFlat', { time: new Date(savedAt).toTimeString().slice(0, 5) }) : ''),
            e('span', { className: 'dsh-notes-ed-foot-i' }, tt('editor.charCount', { n: (edBody || '').length }))))
        : e('section', { className: 'dsh-notes-ed' },
            e('div', { className: 'dsh-notes-ed-empty' },
              e('div', { className: 'dsh-notes-ed-empty-ic' }, I('note', 26)),
              e('div', { className: 'dsh-notes-ed-empty-t' }, tt('editor.emptyTitleShort')),
              e('div', { className: 'dsh-notes-ed-empty-s' }, tt('editor.emptySubShort'))))
          return { editorEl: editorEl, curNote: curNote }
        }
        return {
          edScope: edScope, selectNote: selectNote, doSave: doSave, doDelete: doDelete, applyRestoredBody: applyRestoredBody,
          probeHistCount: probeHistCount, histCountRef: histCountRef, setHistCount: setHistCount, insertImageMd: insertImageMd,
          afterArchiveCleanup: afterArchiveCleanup, toggleScope: toggleScope, keepSel: keepSel, restoreSel: restoreSel,
          scheduleRichSync: scheduleRichSync, setEditorModeState: setEditorModeState, edBodyDomRef: edBodyDomRef,
          richRef: richRef, richDirtyRef: richDirtyRef, setEdBody: setEdBody, renderEditorEl: renderEditorEl
        }
    }
    // ===== panel/sidebar —— 侧栏：brand 行 / 搜索框 / 筛选中心控制行 / 树容器 / side-foot（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: renderSidebar(R)（侧栏 JSX 注册函数，装配层 post-guard 调用）
    // needs: kernel/state.js（panelBridge 经 setter 转发别名 + searchRef/searchDebRef/searchInputRef 跨域镜像）、kernel/constants.js（PAGE_SIZE/FILTER_STATUS/KIND_LABELS）、
    //        kernel/persist.js（clampSideW）、kernel/icons.js（e/I）、modals/newnote.js（openNewNote）+ modals/trash.js（openTrash）+
    //        modals/settings.js（openSettings）——序位在前
    // state 托管：本域无自有 state（filters/sortBy 的 useState 声明原文被 check.js 锚定，滞留装配层「state 堆编排」；
    // §6 E 裁决记录见 panel/index.js 头注）；筛选持久化 effect 随 popovers/filter-pop.js（筛选中心条件编辑入口）收容
    function renderSidebar(R) {
              const sideW = R.sideW, size = R.size, notes = R.notes, filtersActive = R.filtersActive, filtered = R.filtered
              const filters = R.filters, sortBy = R.sortBy, searchText = R.searchText, filterCount = R.filterCount
              const filterOpen = R.filterOpen, sortOpen = R.sortOpen, sortLabel = R.sortLabel, sortMenuEl = R.sortMenuEl, filterPopEl = R.filterPopEl
              const treeEls = R.treeEls, hasMore = R.hasMore, paged = R.paged, onListScroll = R.onListScroll, selMode = R.selMode
              return e('aside', { className: 'dsh-notes-side', style: { width: clampSideW(sideW, size.width) + 'px' } },
              e('div', { className: 'dsh-notes-brand' },
                e('span', { className: 'dsh-notes-brand-logo' }, I('note', 13)),
                e('b', null, t('side.brand')),
                e('span', { className: 'dsh-notes-brand-cnt' }, t('tree.countN', { n: filtersActive ? filtered.length : notes.length })),
                // 新建入口（自旧 chips 行迁入 brand 行右侧，筛选中心口径⑥）
                e('span', { className: 'dsh-notes-brand-add dsh-nt', onClick: openNewNote, 'data-tooltip': t('side.newTip') }, I('plus', 13))),
              e('div', { className: 'dsh-notes-quick' },
                I('search', 14),
                e('input', { ref: searchInputRef, className: 'dsh-notes-quick-input', placeholder: t('topbar.searchPlaceholder'), value: searchText, onChange: (ev) => { searchRef.current = ev.target.value; setSearchText(ev.target.value); setSearchIds(null); setVisibleCount(PAGE_SIZE); if (searchDebRef.current) searchDebRef.current() } }),
                e('span', { className: 'dsh-notes-kbd' }, 'Ctrl K')),
              // ===== 筛选中心控制行（design/notes-filter-center.html）：筛选按钮(N) + 激活条件 chips（单行横滚，× 单条移除）+ 独立排序控件 =====
              // 常态度 UI 只有 筛选按钮 + 排序控件（+ 激活 chips）；popover 是唯一条件编辑入口（浮层，不挤压树区）
              e('div', { className: 'dsh-notes-filterbar' },
                e('button', { className: 'dsh-notes-fbtn-filter' + (filterCount > 0 || filterOpen ? ' on' : '') + ' dsh-nt', onClick: () => { setFilterOpen(!filterOpen); if (!filterOpen) setSortOpen(false) }, 'aria-expanded': filterOpen ? 'true' : 'false', 'data-tooltip': t('topbar.filterTip') }, I('filter', 11), t('topbar.filter'), filterCount > 0 ? e('span', { className: 'dsh-notes-fcnt' }, String(filterCount)) : null),
                e('div', { className: 'dsh-notes-fchips' },
                  /* i18n 覆盖卡F：chip 文案经 filterStatusLabel/kindLabel 条件映射走 t()（FILTER_STATUS.label/KIND_LABELS 字面量仅作锚） */
                  FILTER_STATUS.filter(f => filters[f.id]).map(f => e('span', { key: f.id, className: 'dsh-notes-fchip dsh-nt', 'data-tooltip': t('side.fchipStatusTip', { label: filterStatusLabel(f.id) }) }, I(f.icon, 10), filterStatusLabel(f.id), e('span', { className: 'dsh-notes-fchip-x', onClick: () => setFilters(Object.assign({}, filters, { [f.id]: false })) }, I('x', 9)))),
                  filters.kinds.map(k => e('span', { key: 'k-' + k, className: 'dsh-notes-fchip dsh-nt', 'data-tooltip': t('side.fchipKindTip', { label: kindLabel(k) }) }, e('span', { className: 'dsh-notes-fchip-dot', style: { background: 'var(--nkind-' + k + ')' } }), kindLabel(k), e('span', { className: 'dsh-notes-fchip-x', onClick: () => setFilters(Object.assign({}, filters, { kinds: filters.kinds.filter(x => x !== k) })) }, I('x', 9))))),
                e('div', { className: 'dsh-notes-fsort-wrap' },
                  e('button', { className: 'dsh-notes-fsort-btn' + (sortBy !== 'time' || sortOpen ? ' on' : '') + ' dsh-nt', onClick: () => { setSortOpen(!sortOpen); if (!sortOpen) setFilterOpen(false) }, 'data-tooltip': t('topbar.sortTip') }, I('sort', 11), sortLabel),
                  sortMenuEl),
                filterPopEl),
              e('div', { className: 'dsh-notes-tree', ref: treeElRef, tabIndex: -1, onScroll: onListScroll },
                treeEls,
                hasMore ? e('div', { className: 'dsh-notes-more' }, t('side.more', { shown: paged.length, total: filtered.length })) : null),
              // 底部：回收站 + 选择（多选合并，自旧 chips 行迁入）+ 设置；导出/导入 → 设置卡片「数据」区，整理建议 → 设置卡片「整理建议」行（open* 逻辑不变）
              e('div', { className: 'dsh-notes-side-foot' },
                e('span', { className: 'dsh-notes-fbtn dsh-nt', onClick: openTrash, 'data-tooltip': t('topbar.trashTip') }, I('trash', 12), t('topbar.trash')),
                e('span', { className: 'dsh-notes-fbtn' + (selMode ? ' on' : '') + ' dsh-nt', onClick: toggleSelMode, 'data-tooltip': t('topbar.selectTip') }, I('check', 12), t('topbar.select')),
                e('span', { className: 'dsh-notes-fbtn dsh-nt', onClick: openSettings, 'data-tooltip': t('common.settings') }, I('gear', 12), t('common.settings'))))
    }
    // ===== panel/chrome —— 窗口 chrome：pos/size/sideW 态 + 标题栏/分隔条/resize 拖拽族（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelChrome（面板位置/尺寸/侧栏宽 state + 持久化/居中 effect + onTitlebarMouseDown/onResizeMouseDown/onSplitterMouseDown/resetSideW +
    //           titlebarEl/splitterEl/resizeEl JSX）
    // needs: kernel/state.js（setShowHelp 转发别名）、kernel/persist.js（loadSideW/saveSideW/SIDE_W_DEFAULT/clampSideW/entryMode/setEntryMode）、
    //        kernel/drag.js（drag）、kernel/icons.js（e/I）、modals/archive.js（openArchive）——序位在前；
    //        open/close/showHelp 经 hook 入参注入（装配层回填：open 主面板开合态、close 滞留装配层、showHelp 自 popovers/help.js 解构）
    // state 托管：pos/size/sideW/sideDrag 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）
    function usePanelChrome(args) {
        const open = args.open, close = args.close, showHelp = args.showHelp
        // i18n（notes-042-i18n-cov-a 覆盖卡A）：tt = useT()——订阅 langStore，切语言本 hook（随主面板）自渲染；标题栏/分隔条/resize 文案全走 tt()
        const tt = useT()
        const [pos, setPos] = React.useState({ x: null, y: null })
        const [size, setSize] = React.useState({ width: 920, height: 640 })
        // 侧栏宽度：分隔条拖拽调整（clamp 200px–60% 面板宽），localStorage 记忆（SIDE_W_KEY），双击分隔条重置缺省
        const [sideW, setSideW] = React.useState(() => loadSideW() || SIDE_W_DEFAULT)
        const [sideDrag, setSideDrag] = React.useState(false)   // 拖拽中：分隔条高亮 + body 禁文本选择
        const sideWRef = React.useRef(0)   // 拖拽期间最新宽镜像（mouseup 持久化读 ref，防闭包过期）
        React.useEffect(() => { try { const saved = localStorage.getItem('dsh-notes-panel-state'); if (saved) { const s = JSON.parse(saved); if (s.x !== undefined && s.y !== undefined) setPos({ x: s.x, y: s.y }); if (s.width !== undefined && s.height !== undefined) setSize({ width: s.width, height: s.height }) } } catch (err) {} }, [])
        function saveState() { try { localStorage.setItem('dsh-notes-panel-state', JSON.stringify({ x: pos.x, y: pos.y, width: size.width, height: size.height })) } catch (err) {} }
        React.useEffect(() => { if (open && pos.x === null) { const w = window.innerWidth; const h = window.innerHeight; setPos({ x: Math.max(w - 980, w * 0.3), y: Math.max(48, (h - 640) / 2) }) } }, [open])
        function onTitlebarMouseDown(ev) {
          if (ev.target.closest('.dsh-notes-titlebar-btn')) return
          const sx = ev.clientX, sy = ev.clientY, px = pos.x || 0, py = pos.y || 0
          drag((ev2) => setPos({ x: Math.max(0, Math.min(window.innerWidth - 200, px + ev2.clientX - sx)), y: Math.max(0, Math.min(window.innerHeight - 100, py + ev2.clientY - sy)) }), saveState)
        }
        function onResizeMouseDown(direction, ev) {
          ev.stopPropagation(); ev.preventDefault()
          const sx = ev.clientX, sy = ev.clientY, ox = pos.x || 0, oy = pos.y || 0, sw = size.width, sh = size.height
          drag((ev2) => {
            const dx = ev2.clientX - sx, dy = ev2.clientY - sy
            let nw = sw, nh = sh, nx = ox, ny = oy
            if (direction.indexOf('e') >= 0) nw = sw + dx
            if (direction.indexOf('s') >= 0) nh = sh + dy
            if (direction.indexOf('w') >= 0) nw = sw - dx
            if (direction.indexOf('n') >= 0) nh = sh - dy
            nw = Math.max(680, Math.min(window.innerWidth - 40, nw)); nh = Math.max(420, Math.min(window.innerHeight - 40, nh))
            if (direction.indexOf('w') >= 0) nx = ox + sw - nw
            if (direction.indexOf('n') >= 0) ny = oy + sh - nh
            setSize({ width: nw, height: nh }); setPos({ x: nx, y: ny })
          }, saveState)
        }
        // ===== 侧栏分隔条拖拽：mousedown 起拖 → drag() 内 document mousemove 按面板内相对坐标增量算宽 → mouseup 卸监听防泄漏 =====
        // 拖拽期间 body 挂 .dsh-notes-split-drag（禁文本选择 + 强制 col-resize）；mouseup 持久化（读 ref 防闭包过期）
        function onSplitterMouseDown(ev) {
          ev.preventDefault(); ev.stopPropagation()
          const appEl = ev.currentTarget.parentElement   // .dsh-notes-app（分隔条是两栏间的 flex 子项）
          const sx = ev.clientX, sw = sideW
          sideWRef.current = 0
          setSideDrag(true); document.body.classList.add('dsh-notes-split-drag')
          drag((ev2) => {
            const nw = clampSideW(sw + ev2.clientX - sx, appEl ? appEl.getBoundingClientRect().width : size.width)
            sideWRef.current = nw; setSideW(nw)
          }, () => {
            setSideDrag(false); document.body.classList.remove('dsh-notes-split-drag')
            if (sideWRef.current) saveSideW(sideWRef.current)
          })
        }
        // 双击分隔条 = 重置缺省宽度（清除持久化，回 styles.css 缺省 300px）
        function resetSideW() { sideWRef.current = SIDE_W_DEFAULT; setSideW(SIDE_W_DEFAULT); saveSideW(null) }
        const titlebarEl = e('div', { className: 'dsh-notes-titlebar dsh-nt', onMouseDown: onTitlebarMouseDown, 'data-tooltip': tt('chrome.dragMove') },
            e('span', { className: 'dsh-notes-titlebar-title' }, I('note', 14), tt('side.brand')),
            e('div', { className: 'dsh-notes-titlebar-actions' },
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setEntryMode(entryMode === 'header' ? 'fab' : 'header'), 'data-tooltip': tt('chrome.entryModeTip') }, I('swap', 13)),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: openArchive, 'data-tooltip': tt('topbar.archiveTip') }, tt('topbar.archive')),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setShowHelp(!showHelp), 'data-tooltip': tt('chrome.help') }, '?'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: close, 'data-tooltip': tt('common.close') }, '×')))
        const splitterEl = e('div', { className: 'dsh-notes-splitter dsh-nt' + (sideDrag ? ' on' : ''), onMouseDown: onSplitterMouseDown, onDoubleClick: resetSideW, 'data-tooltip': tt('side.splitterTip') })
        const resizeEl = e('div', { className: 'dsh-notes-resize-handle dsh-nt', style: { position: 'absolute', bottom: 0, right: 0 }, onMouseDown: (ev) => onResizeMouseDown('se', ev), 'data-tooltip': tt('chrome.resizeTip') })
        return { pos: pos, size: size, sideW: sideW, titlebarEl: titlebarEl, splitterEl: splitterEl, resizeEl: resizeEl }
    }
    // ===== panel/keyboard —— 键盘流（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelKeyboard（全局 keydown：Ctrl+K / Alt+N / Ctrl+/ / ? 速查表 + j/k/↑↓/Enter + Esc 分层栈）+ focusListFromSearch（搜索框 ↓ 桥接列表）
    // needs: kernel/state.js（notesRef/searchRef/searchInputRef/treeElRef/pagedIdsRef/switchModeRef/editorModeRef + popover/树/搜索 setter 转发别名）、
    //        modals/*.js（imgModalRef/setImgModal 等 open 镜像与 setter 别名，Esc 栈直读模块顶层绑定——D 步先例同口径）
    // 键盘导航所需的私有 ref（keydown 监听挂一次，回调读最新值）：openRef/focusIdRef/selectNoteRef/closeRef/moveFocusRef/openNewNoteRef
    // 为 keyboard 域模块级单例（与昔日 FloatingPanel 内 useRef 等价——面板是 shell.overlay 单例）；跨域共享镜像在 kernel/state.js
    const openRef = { current: false }
    const focusIdRef = { current: null }
    const selectNoteRef = { current: null }
    const closeRef = { current: null }
    const moveFocusRef = { current: null }
    const openNewNoteRef = { current: null }   // Alt+N 调最新 openNewNote（keydown 闭包挂一次）
    /* Esc 焦点分层末段共用：搜索框还焦列表容器（焦点不得滞留输入框，否则 j/k 字母误入搜索） */
    function blurSearchToList() {
      if (searchInputRef.current) searchInputRef.current.blur()
      if (treeElRef.current) treeElRef.current.focus()
    }
    /* 搜索框 ↓ 桥接：还焦列表并把焦点行落到首条可见结果（保留过滤上下文，搜索→↓→j/k→Enter 纯键盘路径） */
    function focusListFromSearch() {
      blurSearchToList()
      const ids = pagedIdsRef.current
      if (ids.length && moveFocusRef.current) moveFocusRef.current(ids, 1)
    }
    function usePanelKeyboard() {
        // 键盘导航：j/k 或 ↑/↓ 移动高亮，Enter 打开，Esc 关闭，Ctrl+K 聚焦搜索，Alt+N 新建笔记
        React.useEffect(() => {
          function onKeyDown(ev) {
            if (!openRef.current) return
            const t = ev.target
            const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
            const mod = ev.ctrlKey || ev.metaKey
            // UI v2：搜索框在侧栏常显，Ctrl+K 直接聚焦（不再走展开态）
            if (mod && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); if (searchInputRef.current) searchInputRef.current.focus(); return }
            // Alt+N 新建（Ctrl+N 是浏览器保留键「新建窗口」，页面 keydown 拿不到——改用无冲突组合；AltGr 带 ctrlKey 天然排除）
            if (ev.altKey && !mod && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); openNewNoteRef.current(); return }
            // v3：Ctrl+/ 双模式切换（源码⇄富文本）；降级时 switchMode 内部拦截并 toast（弹窗/速查表打开时不切）
            if (mod && ev.key === '/') { ev.preventDefault(); if (!imgModalRef.current && !linkModalRef.current && !cheatsheetOpenRef.current && switchModeRef.current) switchModeRef.current(editorModeRef.current === 'source' ? 'rich' : 'source'); return }
            if (ev.key === 'Escape') { ev.preventDefault(); const cm = ctxMenuRef.current; if (cheatsheetOpenRef.current) { setCheatsheetOpen(false); return } if (imgModalRef.current) { setImgModal(null); return } if (linkModalRef.current) { setLinkModal(null); return } if (renamingIdRef.current) { setRenamingId(null); return } if (folderInputOpenRef.current) { setFolderInputOpen(false); return } if (subFolderForRef.current) { setSubFolderFor(null); return } if (cm && cm.newFolder) { setCtxMenu({ x: cm.x, y: cm.y, note: cm.note, moveOpen: true }); return } if (folderMenuRef.current) { setFolderMenu(null); return } if (sortOpenRef.current) { setSortOpen(false); return } if (filterOpenRef.current) { setFilterOpen(false); return } if (newNoteOpenRef.current) { setNewNoteOpen(false); return } if (exportOpenRef.current) { setExportOpen(false); return } if (sExportOpenRef.current) { setSExportOpen(false); return } if (importOpenRef.current) { setImportOpen(false); return } if (pruneOpenRef.current) { setPruneOpen(false); return } if (trashOpenRef.current) { setTrashOpen(false); return } if (suggestOpenRef.current) { setSuggestOpen(false); return } if (memOpenRef.current) { closeMemEnable(); return } if (injectPreviewOpenRef.current) { setInjectPreviewOpen(false); return } if (injMgrOpenRef.current) { closeInjMgr(); return } if (histOpenRef.current) { setHistOpen(false); return } if (mergeOpenRef.current) { setMergeOpen(false); return } if (archOpenRef.current) { setArchOpen(false); return } if (settingsOpenRef.current) { if (settingsFlushRef.current) settingsFlushRef.current(); setSettingsOpen(false); return } if (cm) { setCtxMenu(null); return } if (selModeRef.current) { setSelMode(false); setSelIds({}); return } if (searchRef.current) { searchRef.current = ''; setSearchText(''); setSearchIds(null); setSearchMatches({}); if (searchInputRef.current && document.activeElement === searchInputRef.current) blurSearchToList(); return } if (searchInputRef.current && document.activeElement === searchInputRef.current) { blurSearchToList(); return } closeRef.current(); return }
            // 搜索框 ↓ 桥接列表（保留过滤上下文：搜索→↓→j/k→Enter 纯键盘路径）
            if (t === searchInputRef.current && ev.key === 'ArrowDown') { ev.preventDefault(); focusListFromSearch(); return }
            if (inField) return
            // ? 键唤起/关闭快捷键速查表（notes-034-f-cheatsheet：非输入焦点；其他弹层/浮层打开时不抢——Esc 分层口径同列表导航）
            if (ev.key === '?') {
              ev.preventDefault()
              if (cheatsheetOpenRef.current) { setCheatsheetOpen(false); return }   // 速查表打开时再按 ? = 关闭（toggle）
              if (imgModalRef.current || linkModalRef.current || ctxMenuRef.current || folderMenuRef.current || sortOpenRef.current || filterOpenRef.current || newNoteOpenRef.current || exportOpenRef.current || sExportOpenRef.current || importOpenRef.current || pruneOpenRef.current || trashOpenRef.current || suggestOpenRef.current || memOpenRef.current || injectPreviewOpenRef.current || injMgrOpenRef.current || histOpenRef.current || mergeOpenRef.current || archOpenRef.current || settingsOpenRef.current) return   // 任一弹层打开时不抢键
              openCheatsheet(); return
            }
            if (ctxMenuRef.current || cheatsheetOpenRef.current) return   // 右键菜单/速查表打开时暂停列表导航/打开
            const ids = pagedIdsRef.current
            if (!ids.length) return
            if (ev.key === 'j' || ev.key === 'ArrowDown') { ev.preventDefault(); moveFocusRef.current(ids, 1) }
            else if (ev.key === 'k' || ev.key === 'ArrowUp') { ev.preventDefault(); moveFocusRef.current(ids, -1) }
            else if (ev.key === 'Enter') {
              const fid = focusIdRef.current
              if (fid && ids.indexOf(fid) >= 0) { const n = notesRef.current.find(x => x.id === fid); if (n) selectNoteRef.current(n) }
            }
          }
          document.addEventListener('keydown', onKeyDown)
          return () => document.removeEventListener('keydown', onKeyDown)
        }, [])
    }
    const d4 = slots.inject('shell.overlay', () => {
      // ===== 快速记录卡片 v2（原型 SelectionCapture 重做）：头部（选区速记 + 识别为引用徽章）→ 选区预览 → 补充输入 → 复制/记录/取消 =====
      // 触发链路不变：selectionchange + mouseup；提交链路不变：notes-quick-instruct（备注非空）/ notes-quick（kind=quote）
      function SelectionCapture() {
        perf.selRender++
        const [cap, setCap] = React.useState(null)   // 卡片位置（null=隐藏）
        const tt = useT()   // i18n 覆盖卡F：本组件独立订阅 langStore（shell.overlay 独立边界，切语言自渲染）；命令式 toast 同走 tt（=t 直读）
        // toast 宿主已迁 kernel（architecture-modular §6 步骤 C）：数据桶 = kernel/state.js toastStore，emit/自动消失计时 = kernel/bus.js setToast
        const toast = toastStore.useSel(s => s.toast)
        const [instrText, setInstrText] = React.useState('')
        const selTextRef = React.useRef('')
        const visibleRef = React.useRef(false)
        const instrRef = React.useRef(null)
        React.useEffect(() => {
          let mx = -1, my = -1, watchMouse = false, mouseDown = false
          function hide() { if (visibleRef.current) { visibleRef.current = false; setCap(null) } }
          function onMouseMove(ev) { if (!watchMouse) return; mx = ev.clientX; my = ev.clientY; perf.mousemoveTracked++ }
          function showFromSelection() {
            perf.selShowEval++
            const s0 = now()
            try {
              const sel = window.getSelection()
              const text = sel ? sel.toString().trim() : ''
              // 卡片已展开时，选区被点击清空（如点输入框）不关闭——只有卡片未展开且无选区才 hide
              if (!text || text.length < 2) { if (!visibleRef.current) hide(); return }
              let x, y
              if (mx >= 0) {
                x = mx - 150
                y = my + 14
              } else {
                let rect
                try { if (sel.rangeCount > 0) rect = sel.getRangeAt(0).getBoundingClientRect() } catch (err) {}
                if (rect && !(rect.width === 0 && rect.height === 0)) {
                  x = rect.left + rect.width / 2 - 150
                  y = rect.bottom + 8
                } else { hide(); return }
              }
              // 位置就近 + 视口内夹紧（卡片宽 300）
              x = Math.min(Math.max(8, x), Math.max(60, window.innerWidth - 314))
              y = Math.min(Math.max(8, y), Math.max(60, window.innerHeight - 220))
              selTextRef.current = text
              visibleRef.current = true
              // 位置没有实质变化时不触发重渲染
              setCap(prev => (prev && Math.abs(prev.x - x) < 2 && Math.abs(prev.y - y) < 2) ? prev : { x, y })
            } catch (err) {}
            finally { perf.selShowMs += now() - s0 }
          }
          // 一次性注册的防抖器：timer.timeout 每次调用都会在 fiber 上注册 ctx.effect，击键频率下是持续簿记开销
          const debouncedShow = timer.debounce(showFromSelection, 140)
          // v3：富文本编辑器内的划选归编辑器工具栏所有（加粗/链接等），不弹速记卡
          function inRichEditor() {
            try {
              const sel = window.getSelection()
              const an = sel && sel.rangeCount ? sel.anchorNode : null
              const el = an ? (an.nodeType === 1 ? an : an.parentNode) : null
              return !!(el && el.closest && el.closest('.dsh-notes-rich, .dsh-notes-rtb'))
            } catch (err) { return false }
          }
          function onSelectionChange() {
            perf.selChange++
            const sc0 = now()
            try {
              // 卡片已展开时保持稳定：避免聚焦输入框导致选区收起而误关（文本已在 selTextRef）
              if (visibleRef.current) return
              // 快速路径：光标态（无选区）直接跳过，不创建任何定时器——聊天输入框每次击键都触发本事件
              let collapsed = true
              let sel = null
              try { sel = window.getSelection(); collapsed = !sel || sel.isCollapsed } catch (err) {}
              if (collapsed) { perf.selCollapsedSkip++; watchMouse = false; hide(); return }
              if (inRichEditor()) { watchMouse = false; hide(); return }
              // 记录当前选区文本（供 mouseup 弹卡片预览与提交使用，提交不依赖实时选区）
              try { selTextRef.current = sel ? sel.toString().trim() : '' } catch (err) {}
              watchMouse = true
              // 鼠标拖拽中：只记录选区文本与跟踪坐标，等 mouseup 才弹卡片（避免拖拽中途弹出打断选区）
              if (mouseDown) return
              // 键盘选择（无鼠标按下）：正常防抖弹卡片
              debouncedShow()
            } finally { perf.selChangeMs += now() - sc0 }
          }
          function onMouseDown(ev) {
            if (ev.target.closest && ev.target.closest('.dsh-notes-cap')) return
            // 开始新一次拖拽：置位 mouseDown、停止旧坐标跟踪、隐藏旧卡片
            mouseDown = true; watchMouse = false; hide()
          }
          function onMouseUp(ev) {
            // 拖拽结束：清除 mouseDown；选区非折叠且文本≥2字符时弹卡片（校验在 showFromSelection 内部）
            mouseDown = false
            // 点击卡片内部（输入框/按钮）的 mouseup 不重新评估选区——否则点输入框清空选区后会误关卡片
            if (ev && ev.target && ev.target.closest && ev.target.closest('.dsh-notes-cap')) return
            if (inRichEditor()) return   // v3：富文本编辑器划选不弹速记卡
            showFromSelection()
          }
          document.addEventListener('selectionchange', onSelectionChange)
          document.addEventListener('mousemove', onMouseMove, { passive: true })
          document.addEventListener('mousedown', onMouseDown)
          document.addEventListener('mouseup', onMouseUp)
          return () => {
            document.removeEventListener('selectionchange', onSelectionChange)
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('mouseup', onMouseUp)
            if (debouncedShow && debouncedShow.dispose) debouncedShow.dispose()
          }
        }, [])
        // 弹卡片后不自动 focus 输入框：focus 会清除页面选区，打断拖拽并使选区丢失。
        // 选区文本已存于 selTextRef，提交不依赖实时选区；用户需备注时手动点击输入框（自然 focus）。
        // 选区预览：截断至 3 行 / 160 字符（原型上限），配合渐隐避免卡片过高
        function previewText(text) { if (!text) return ''; const lines = String(text).split(/\n/).slice(0, 3).join(' '); return lines.length > 160 ? lines.slice(0, 160) + '…' : lines }
        async function submit() {
          const text = selTextRef.current
          const note = instrText.trim()
          visibleRef.current = false; setCap(null); setInstrText('')
          if (window.getSelection()) window.getSelection().removeAllRanges()
          if (!text) return
          try {
            if (!note) {
              // 备注为空 → 现有逻辑（行为不变）
              const res = await rpc('notes-quick', { text: text, sessionId: currentSessionId, kind: 'quote' })
              if (res.error) { setToast(tt('cap.failed', { msg: res.error })) }
              // 敏感命中：host 已直接落 sensitive=true（注入自动脱敏），toast 追加标注告知
              else { setToast((res.merged ? tt('cap.mergedClient') : tt('cap.savedClient')) + (res.sensitiveSuggested ? tt('cap.sensSuffix') : '')); notifyNotesChanged() }
            } else {
              // 备注非空 → LLM 提取元数据，按返回结果 toast
              const res = await rpc('notes-quick-instruct', { text: text, note: note, sessionId: currentSessionId })
              if (res.error) { setToast(tt('cap.failed', { msg: res.error })) }
              else if (res.ok && res.applied) {
                const a = res.applied
                let msg = tt('cap.savedPlain')
                if (a.inject) msg = tt('cap.savedCtx', { role: tt(a.injectRole === 'reference' ? 'tree.roleReference' : 'tree.roleConvention') })   /* key 名 cap.savedCtx：规避 1-7 节旧布尔链路清零断言的裸子串扫描 */
                else if (a.tags && a.tags.length) msg = tt('cap.savedTags', { tags: '#' + a.tags.join(' #') })
                else if (a.kind && a.kind !== 'note' && a.kind !== 'quote') msg = tt('cap.savedKind', { kind: kindLabel(a.kind) || a.kind })
                else msg = res.merged ? tt('cap.mergedClient') : tt('cap.savedClient')
                if (res.sensitiveSuggested) msg += tt('cap.sensSuffix')
                setToast(msg); notifyNotesChanged()
              } else {
                setToast((res.merged ? tt('cap.mergedClient') : tt('cap.savedClient')) + (res.sensitiveSuggested ? tt('cap.sensSuffix') : '')); notifyNotesChanged()
              }
            }
          } catch (err) { setToast(tt('cap.failed', { msg: String(err.message || err) })) }
        }
        function cancel() { visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges() }
        // 复制选区文本到剪贴板：优先 navigator.clipboard，不可用/失败时降级 execCommand；
        // 复制成功后与记录/取消一致关闭卡片并清选区（cancel 同款逻辑）；失败/无选区时保持卡片
        function fallbackCopy(text) {
          try {
            var ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            ta.style.pointerEvents = 'none'
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
            setToast(tt('cap.copied'))
            visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges()
          } catch (err) { setToast(tt('cap.copyFailed')) }
        }
        function copySelection() {
          var text = selTextRef.current
          if (!text) { setToast(tt('cap.noSelection')); return }
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () {
                setToast(tt('cap.copied'))
                visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges()
              }, function () { fallbackCopy(text) })
              return
            }
          } catch (err) {}
          fallbackCopy(text)
        }
        return e('div', null, cap ? e('div', { className: 'dsh-notes-cap', style: { left: cap.x + 'px', top: cap.y + 'px' } },
          e('div', { className: 'dsh-notes-cap-h' },
            e('span', { className: 'dsh-notes-cap-src' }, I('note', 11), tt('cap.title')),
            e('span', { className: 'dsh-notes-cap-auto' }, e('span', { className: 'dot' }), tt('cap.autoQuoteClient'))),
          e('div', { className: 'dsh-notes-cap-pv' }, previewText(selTextRef.current)),
          e('div', { className: 'dsh-notes-cap-in' },
            I('plus', 12),
            e('input', { ref: instrRef, className: 'dsh-notes-cap-input', type: 'text', placeholder: tt('cap.placeholderClient'), value: instrText, onChange: function (ev) { setInstrText(ev.target.value) }, onKeyDown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); submit() } else if (ev.key === 'Escape') { ev.preventDefault(); cancel() } } }),
            e('span', { className: 'dsh-notes-kbd' }, tt('cap.enterHint'))),
          e('div', { className: 'dsh-notes-cap-acts' },
            e('button', { className: 'dsh-notes-cbtn', onClick: copySelection }, I('note', 12), tt('cap.copy')),
            e('button', { className: 'dsh-notes-cbtn primary', onClick: submit }, I('check', 12), tt('cap.save')),
            e('button', { className: 'dsh-notes-cbtn', onClick: cancel }, tt('common.cancel'))
          )
        ) : null, e('div', { className: 'dsh-notes-toast' + (toast ? ' show' : '') + (toast && toast.act ? ' has-act' : '') },
          typeof toast === 'string' ? toast : (toast ? toast.msg : ''),
          toast && toast.act ? e('a', { className: 'dsh-notes-toast-act', onClick: () => { const fn = toast.act && toast.act.fn; setToast(''); try { if (fn) fn() } catch (err) {} } }, toast.act.label) : null))
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-selection', order: 201 }, () => e(SelectionCapture))
    })
    if (typeof d4 === 'function') disposers.push(d4)
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
        async function loadNotes(silent) { if (!silent) setLoading(true); setError(''); let list = []; try { const F = filtersRef.current || filters; const kf = (F && F.kinds) || []; const res = await rpc('notes-list', kf.length === 1 ? { kind: kf[0] } : undefined); list = res.notes || []; setNotes(list) } catch (err) { setError(String(err.message || err)) } loadFolders(); ensureWikiIndex(list); if (!silent) setLoading(false); return list }
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

    // inject 声明 apply 用到的全部服务（slots/timer/sessions/workspaces），
    // 保证 Cordis 在服务就绪后才激活 apply；apply 内仍保留 ctx.get + 存在性守卫做双保险。
    module.exports = { name: 'dsh-notes-plugin', inject: ['slots', 'timer', 'sessions', 'workspaces'], apply: apply }
    return module.exports
  }
})
