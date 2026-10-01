/* global window, document, fetch, localStorage, performance, PerformanceObserver, console */
// dsh-notes — Browser 侧 bundle（CJS 工厂，供 dsh web 客户端 ModuleLoader 注入）。
//
// 本文件是发布版静态包的 **最终源码**（P3）：由 scripts/build-dist.cjs 从开发版 client-impl.js
// 机械转换而来，转换规则见 task-board-plugin/docs/PACKAGING.md 第 4 节：
//   · React        ：require('react')（静态包无全局 React）
//   · RPC          ：fetch('/dsh-notes', POST {method, args}) —— index.mjs 的 webServer exact 路由
//                    （动态插件的 host 调用桥在静态包中不存在）
//   · 样式         ：fetch notes-css + document.createElement('style') 注入（doc 级，进程单例）
//                    （动态插件的 styles 服务在静态包中不存在）
//   · 定时器        ：动态插件的 ctx.interval 快捷方式不存在，用 ctx.get('timer') + ctx.effect
//   · inject       ：声明全部服务（slots/timer/sessions/workspaces），保证就绪后才 apply
//
// 要改 client 行为：改开发版 client-impl.js，然后 `node scripts/build-dist.cjs` 重新生成。
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
    function showToast(msg) { try { if (toastEmit) toastEmit(msg) } catch (e) {} }
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
    // 文件夹折叠态持久化：JSON 数组记录「展开中」的文件夹 id（'__pinned__' 是置顶折叠组固定 key）；null/缺省 = 全部展开
    const PINNED_KEY = '__pinned__'
    function loadFoldersExpanded() { try { const v = localStorage.getItem('dsh-notes-folders-expanded'); if (!v) return null; const arr = JSON.parse(v); return Array.isArray(arr) ? arr : null } catch (err) { return null } }
    function saveFoldersExpanded(arr) { try { localStorage.setItem('dsh-notes-folders-expanded', JSON.stringify(arr)) } catch (err) {} }
    loadEntryState()
    const PAGE_SIZE = 50
    const KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用' }
    const shortSid = (sid) => sid ? String(sid).replace(/^session-/, '').slice(0, 8) : ''
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
    }
    // I(name, size?, cls?)：图标 helper——返回 e('svg') 结构（stroke=currentColor 由 CSS 统一，尺寸默认 15px）
    function I(name, size, cls) {
      return e('svg', { className: 'dsh-ic' + (cls ? ' ' + cls : ''), viewBox: '0 0 24 24', style: size ? { width: size + 'px', height: size + 'px' } : undefined, 'aria-hidden': 'true' }, IC[name])
    }
    // ===== Markdown 预览渲染器（内联手写，零外部依赖；所有插值先 HTML 转义）=====
    // 安全红线：esc() 先把 & < > " ' 转为实体，绝不用 innerHTML 直插原文；代码块内容同样转义
    function esc(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\x22/g, '&quot;').replace(/\x27/g, '&#39;')
    }
    function renderMarkdown(md) {
      var src = String(md || '')
      if (!src.trim()) return ''
      var lines = src.replace(/\r\n/g, '\n').split('\n')
      var out = []
      var i = 0
      var inUl = false, inOl = false
      function closeLists() { if (inUl) { out.push('</ul>'); inUl = false } if (inOl) { out.push('</ol>'); inOl = false } }
      // 行内格式：行内代码 → 粗体 → 斜体 → 链接（仅 http/https）。esc 已在入口执行
      function inline(s) {
        var t = esc(s)
        t = t.replace(/\x60([^\x60]+)\x60/g, function (m, c) { return '<code>' + c + '</code>' })
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
        t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        return t
      }
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
          out.push('<pre class="dsh-notes-preview-code"' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code>' + esc(codeLines.join('\n')) + '</code></pre>')
          continue
        }
        // 标题 # ~ ###
        var hm = line.match(/^(#{1,3})\s+(.*)$/)
        if (hm) {
          closeLists()
          var lvl = hm[1].length
          out.push('<h' + lvl + ' class="dsh-notes-preview-h' + lvl + '">' + inline(hm[2]) + '</h' + lvl + '>')
          i++
          continue
        }
        // 引用块
        if (/^>\s?/.test(line)) {
          closeLists()
          var quoteLines = []
          while (i < lines.length && /^>\s?/.test(lines[i])) { quoteLines.push(lines[i].replace(/^>\s?/, '')); i++ }
          out.push('<blockquote class="dsh-notes-preview-quote">' + inline(quoteLines.join(' ')) + '</blockquote>')
          continue
        }
        // 无序列表
        if (/^[-*+]\s+/.test(line)) {
          if (inOl) { out.push('</ol>'); inOl = false }
          if (!inUl) { out.push('<ul class="dsh-notes-preview-ul">'); inUl = true }
          out.push('<li>' + inline(line.replace(/^[-*+]\s+/, '')) + '</li>')
          i++
          continue
        }
        // 有序列表
        if (/^\d+\.\s+/.test(line)) {
          if (inUl) { out.push('</ul>'); inUl = false }
          if (!inOl) { out.push('<ol class="dsh-notes-preview-ol">'); inOl = true }
          out.push('<li>' + inline(line.replace(/^\d+\.\s+/, '')) + '</li>')
          i++
          continue
        }
        // 空行
        if (line.trim() === '') { closeLists(); i++; continue }
        // 段落（连续非空非特殊行合并）
        closeLists()
        var paraLines = []
        while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|\x60\x60\x60|>\s?|[-*+]\s|\d+\.\s)/.test(lines[i])) { paraLines.push(lines[i]); i++ }
        out.push('<p class="dsh-notes-preview-p">' + inline(paraLines.join(' ')) + '</p>')
      }
      closeLists()
      return out.join('\n')
    }
    // ===== end Markdown 预览渲染器 =====
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
    const d3 = slots.inject('shell.overlay', () => {
      function FloatingPanel() {
        perf.panelRender++
        const [open, setOpen] = React.useState(panelOpen)
        const [notes, setNotes] = React.useState([])
        const [selected, setSelected] = React.useState(null)
        const [edTitle, setEdTitle] = React.useState('')
        const [edTopic, setEdTopic] = React.useState('')
        const [edTags, setEdTags] = React.useState('')
        const [edBody, setEdBody] = React.useState('')
        const [edKind, setEdKind] = React.useState('note')
        const [edStatus, setEdStatus] = React.useState('active')
        const [edRole, setEdRole] = React.useState('off')   // 注入三态：off=不注入 / convention=约定（须遵守）/ reference=资料（按需取用）
        const [edRecall, setEdRecall] = React.useState(true)   // 目录可见（recall 字段，缺省 true=进目录；与 inject 正交）
        const [edScope, setEdScope] = React.useState([])
        const [savedAt, setSavedAt] = React.useState(0)
        const [searchText, setSearchText] = React.useState('')
        const [searchIds, setSearchIds] = React.useState(null)
        const [loading, setLoading] = React.useState(false)
        const [error, setError] = React.useState('')
        const [pos, setPos] = React.useState({ x: null, y: null })
        const [size, setSize] = React.useState({ width: 920, height: 640 })
        // UI v2 视图单选（原型 view）：all=全部 / folder=文件夹视图 / topic=主题全局过滤（跨文件夹）
        const [view, setView] = React.useState({ type: 'all', id: '' })
        const [showHelp, setShowHelp] = React.useState(false)
        const [flashId, setFlashId] = React.useState(null)
        const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
        const [focusId, setFocusId] = React.useState(null)
        const [kindFilter, setKindFilter] = React.useState('all')
        const [pinnedOnly, setPinnedOnly] = React.useState(false)
        // 虚拟文件夹树：清单走 notes-folders RPC（list/create/rename/delete/reorder）；折叠态持久化 localStorage
        const [folders, setFolders] = React.useState([])
        const [foldersExpanded, setFoldersExpanded] = React.useState(loadFoldersExpanded)
        const [folderInputOpen, setFolderInputOpen] = React.useState(false)   // 文件夹分组头 ＋ → 内联输入
        const [folderInputText, setFolderInputText] = React.useState('')
        const [folderMenu, setFolderMenu] = React.useState(null)   // 文件夹项右键菜单：{ x, y, folder }（面板内坐标）或 null
        const [renamingId, setRenamingId] = React.useState(null)   // 树内内联重命名中的文件夹 id
        const [renameText, setRenameText] = React.useState('')
        const [ctxNewFolderText, setCtxNewFolderText] = React.useState('')   // 笔记行右键菜单「新建文件夹…」内联输入
        // 新建笔记 modal（侧栏「新建」chip / Ctrl+N 打开，输标题创建）
        const [newNoteOpen, setNewNoteOpen] = React.useState(false)
        const [newNoteTitle, setNewNoteTitle] = React.useState('')
        const [newNotePending, setNewNotePending] = React.useState(false)
        const [sessList, setSessList] = React.useState([])
        const [sessPending, setSessPending] = React.useState([])   // 注入范围浮层：标题后台补齐中的占位会话 [{id, short, workspace}]（0.1.7 首屏提速）
        const [scopeOpen, setScopeOpen] = React.useState(false)
        const [dispatchOpen, setDispatchOpen] = React.useState(false)
        const [activeSessions, setActiveSessions] = React.useState([])
        const [dispatchPending, setDispatchPending] = React.useState([])   // 派发对话框：标题后台补齐中的占位会话 [{id, short, workspace}]（0.1.7 首屏提速）
        const [dispatching, setDispatching] = React.useState(false)
        const [dispatchMode, setDispatchMode] = React.useState('existing')  // existing=派发到活跃会话 / new=新建会话派发
        const [dispatchInstr, setDispatchInstr] = React.useState('')
        const [previewMode, setPreviewMode] = React.useState(false)   // 编辑/预览双态：默认编辑（textarea 行为不变）
        const [ctxMenu, setCtxMenu] = React.useState(null)   // 笔记行右键菜单：{ x, y, note }（面板内坐标）或 null
        const [dispatchWsId, setDispatchWsId] = React.useState('')       // new 模式：选中的工作区 id
        const [dispatchSessWs, setDispatchSessWs] = React.useState('')   // existing 模式：选中的工作区名
        const [dispatchSessId, setDispatchSessId] = React.useState('')   // existing 模式：选中的会话 id
        const [wsList, setWsList] = React.useState([])
        const [dispatchHistoryOpen, setDispatchHistoryOpen] = React.useState(false)   // 派发历史折叠态：默认折叠，点标题行展开
        // 设置卡片（通用结构：标题「设置」+ 设置项行列表；选择即保存，点遮罩/Esc 关闭）
        const [settingsOpen, setSettingsOpen] = React.useState(false)
        const [settingsData, setSettingsData] = React.useState(null)   // notes-settings-get 返回：{ settings, models }
        const [setLlmProvider, setSetLlmProvider] = React.useState('')
        const [setLlmModel, setSetLlmModel] = React.useState('')
        const [setCatalog, setSetCatalog] = React.useState(true)   // 笔记目录注入总开关（catalogEnabled，缺省开）
        // 数据导入/导出（侧栏底部「导出/导入」直达；设置卡片「数据」区同入口）
        const [exportOpen, setExportOpen] = React.useState(false)
        const [exportDir, setExportDir] = React.useState('')
        const [exportPending, setExportPending] = React.useState(false)
        const [importOpen, setImportOpen] = React.useState(false)
        const [importDir, setImportDir] = React.useState('')
        const [importPreview, setImportPreview] = React.useState(null)   // notes-import-preview 返回：{ total, same, diff, added, detail, folders, unreadable }
        const [importOverwrite, setImportOverwrite] = React.useState(false)   // 「覆盖内容不同的笔记」勾选（默认不勾 = diff 跳过）
        const [importPending, setImportPending] = React.useState(false)   // 预览中 / 执行中共用（按钮禁用防重入）
        const keepQuickRef = React.useRef(false)
        const newNoteInputRef = React.useRef(null)   // 新建笔记 modal 标题输入框（打开自动聚焦）
        const edBodyDomRef = React.useRef(null)      // 正文 textarea DOM（新建笔记创建后聚焦）
        const edLoadingRef = React.useRef(false)     // 正文异步加载中（notes-get 未返回）：期间 doSave 省略 body 字段，防改名触发保存把空正文写盘
        const timersRef = React.useRef([])
        const selectedRef = React.useRef(null)
        const dragNoteIdRef = React.useRef(null)   // 笔记拖拽状态：dragstart 记录 noteId（ref 防闭包过期），dragend 清空
        // 键盘导航所需的 ref（keydown 监听挂一次，回调读最新值）
        const focusIdRef = React.useRef(null)
        const openRef = React.useRef(false)
        const pagedIdsRef = React.useRef([])
        const notesRef = React.useRef([])
        const selectNoteRef = React.useRef(null)
        const closeRef = React.useRef(null)
        const searchInputRef = React.useRef(null)
        const moveFocusRef = React.useRef(null)
        const openNewNoteRef = React.useRef(null)   // Ctrl+N 调最新 openNewNote（keydown 闭包挂一次）
        // 展开态镜像到 ref（keydown 闭包挂一次，需读最新值避免过期）
        const newNoteOpenRef = React.useRef(false)   // 新建笔记 modal 镜像（Esc 优先关 modal）
        const ctxMenuRef = React.useRef(null)   // 右键菜单镜像（keydown 闭包读最新值）
        const folderMenuRef = React.useRef(null)   // 文件夹右键菜单镜像
        const renamingIdRef = React.useRef(null)   // 文件夹重命名输入镜像（Esc 取消）
        const folderInputOpenRef = React.useRef(false)   // 文件夹新建输入镜像（Esc 取消）
        const settingsOpenRef = React.useRef(false)   // 设置卡片镜像（Esc 优先关设置卡片）
        const dispatchOpenRef = React.useRef(false)   // 派发对话框镜像（titlesPending 轮询重拉的终止条件）
        const exportOpenRef = React.useRef(false)   // 导出对话框镜像（Esc 优先关）
        const importOpenRef = React.useRef(false)   // 导入对话框镜像（Esc 优先关）
        // 自动保存：编辑字段的最新值 ref（debounce 回调读 ref 而非闭包 state，避免过期）
        const edTitleRef = React.useRef('')
        const edTopicRef = React.useRef('')
        const edTagsRef = React.useRef('')
        const edBodyRef = React.useRef('')
        const edKindRef = React.useRef('note')
        const edStatusRef = React.useRef('active')
        const edRoleRef = React.useRef('off')
        const edRecallRef = React.useRef(true)
        const edScopeRef = React.useRef([])
        const autoSaveRef = React.useRef(null)
        React.useEffect(() => { selectedRef.current = selected }, [selected])
        function later(fn, ms) { try { const d = timer.timeout(fn, ms); timersRef.current.push(d); return d } catch (err) { return null } }
        React.useEffect(() => {
          const arr = timersRef.current
          timersRef.current = []
          for (const d of arr) { try { d() } catch (err) {} }
        }, [])
        React.useEffect(() => { try { const saved = localStorage.getItem('dsh-notes-panel-state'); if (saved) { const s = JSON.parse(saved); if (s.x !== undefined && s.y !== undefined) setPos({ x: s.x, y: s.y }); if (s.width !== undefined && s.height !== undefined) setSize({ width: s.width, height: s.height }) } } catch (err) {} }, [])
        function saveState() { try { localStorage.setItem('dsh-notes-panel-state', JSON.stringify({ x: pos.x, y: pos.y, width: size.width, height: size.height })) } catch (err) {} }
        React.useEffect(() => { const fn = (s) => { if (s.panelOpen !== undefined) setOpen(s.panelOpen) }; listeners.add(fn); return () => listeners.delete(fn) }, [])
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
        // 派发对话框是 modal（自带 mask 点击外部关闭），无需 document 监听
        React.useEffect(() => { const fn = () => loadNotes(true); noteRefreshListeners.add(fn); return () => noteRefreshListeners.delete(fn) }, [])
        React.useEffect(() => { if (open) loadNotes() }, [open])
        React.useEffect(() => { if (open && pos.x === null) { const w = window.innerWidth; const h = window.innerHeight; setPos({ x: Math.max(w - 980, w * 0.3), y: Math.max(48, (h - 640) / 2) }) } }, [open])
        // 搜索两段式：输入即本地过滤（标题/主题/标签/预览），250ms 防抖后 host 全文检索（含正文）补充
        // 用一次性注册的 timer.debounce：每击键调 timer.timeout 等于每击键在 fiber 上注册一次 ctx.effect，是持续簿记开销
        const searchRef = React.useRef('')
        const searchDebRef = React.useRef(null)
        React.useEffect(() => {
          const d = timer.debounce(() => {
            const qq = searchRef.current.trim()
            if (!qq) { setSearchIds(null); return }
            rpc('notes-search', { query: qq }).then(res => setSearchIds((res.notes || []).map(n => n.id))).catch(() => {})
          }, 250)
          searchDebRef.current = d
          return () => { if (d && d.dispose) d.dispose() }
        }, [])
        // 搜索/视图/kind/置顶条件变化时重置分页（新结果从头开始）
        React.useEffect(() => { setVisibleCount(PAGE_SIZE) }, [searchText, searchIds, view, kindFilter, pinnedOnly])
        // 展开态同步到 ref（keydown 闭包读 ref 避免过期）
        React.useEffect(() => { newNoteOpenRef.current = newNoteOpen }, [newNoteOpen])
        React.useEffect(() => { ctxMenuRef.current = ctxMenu }, [ctxMenu])
        React.useEffect(() => { folderMenuRef.current = folderMenu }, [folderMenu])
        React.useEffect(() => { renamingIdRef.current = renamingId }, [renamingId])
        React.useEffect(() => { folderInputOpenRef.current = folderInputOpen }, [folderInputOpen])
        React.useEffect(() => { settingsOpenRef.current = settingsOpen }, [settingsOpen])
        React.useEffect(() => { exportOpenRef.current = exportOpen }, [exportOpen])
        React.useEffect(() => { importOpenRef.current = importOpen }, [importOpen])
        React.useEffect(() => { dispatchOpenRef.current = dispatchOpen }, [dispatchOpen])
        // 新建 modal 打开时自动聚焦标题输入框（Ctrl+N / 侧栏「新建」chip 均由此聚焦）
        React.useEffect(() => { if (newNoteOpen && newNoteInputRef.current) newNoteInputRef.current.focus() }, [newNoteOpen])
        // 键盘导航：j/k 或 ↑/↓ 移动高亮，Enter 打开，Esc 关闭，Ctrl+K 聚焦搜索，Ctrl+N 新建笔记
        React.useEffect(() => {
          function onKeyDown(ev) {
            if (!openRef.current) return
            const t = ev.target
            const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
            const mod = ev.ctrlKey || ev.metaKey
            // UI v2：搜索框在侧栏常显，Ctrl+K 直接聚焦（不再走展开态）
            if (mod && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); if (searchInputRef.current) searchInputRef.current.focus(); return }
            if (mod && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); openNewNoteRef.current(); return }
            if (ev.key === 'Escape') { ev.preventDefault(); const cm = ctxMenuRef.current; if (renamingIdRef.current) { setRenamingId(null); return } if (folderInputOpenRef.current) { setFolderInputOpen(false); return } if (cm && cm.newFolder) { setCtxMenu({ x: cm.x, y: cm.y, note: cm.note, moveOpen: true }); return } if (folderMenuRef.current) { setFolderMenu(null); return } if (newNoteOpenRef.current) { setNewNoteOpen(false); return } if (exportOpenRef.current) { setExportOpen(false); return } if (importOpenRef.current) { setImportOpen(false); return } if (settingsOpenRef.current) { setSettingsOpen(false); return } if (cm) { setCtxMenu(null); return } if (searchRef.current) { searchRef.current = ''; setSearchText(''); setSearchIds(null); return } closeRef.current(); return }
            if (inField) return
            if (ctxMenuRef.current) return   // 右键菜单打开时暂停列表导航/打开
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
        // silent=true 时不显 loading（后台静默刷新，避免闪烁）
        async function loadNotes(silent) { if (!silent) setLoading(true); setError(''); let list = []; try { const res = await rpc('notes-list'); list = res.notes || []; setNotes(list) } catch (err) { setError(String(err.message || err)) } loadFolders(); if (!silent) setLoading(false); return list }
        // 文件夹清单（含各文件夹计数）：与列表同链路刷新（不 await，不阻塞列表链路）；
        // 顺手清理已删除文件夹的展开态残留（PINNED_KEY 是置顶折叠组固定 key，保留）
        async function loadFolders() {
          try {
            const res = await rpc('notes-folders')
            if (res && res.folders) {
              setFolders(res.folders)
              setFoldersExpanded(prev => {
                if (!prev) return prev
                const next = prev.filter(id => id === PINNED_KEY || res.folders.some(f => f.id === id))
                if (next.length !== prev.length) { saveFoldersExpanded(next); return next }
                return prev
              })
            }
          } catch (err) {}
        }
        function selectNote(n) {
          // 选中笔记所在文件夹自动展开（保证选中笔记在树中可见）
          if (n.folder) expandFolder(n.folder)
          setSelected(n.id); setFocusId(n.id); setEdTitle(n.title); setEdTopic(n.topic && n.topic !== '分类中' ? n.topic : '')
          keepQuickRef.current = (n.tags || []).indexOf('quick') >= 0
          setEdTags((n.tags || []).filter(t => t !== 'quick').join(', '))
          setEdKind(n.kind || 'note'); setEdStatus(n.status || 'active'); setEdRole(n.inject ? (n.injectRole || 'convention') : 'off'); setEdScope(n.injectTo || []); setEdRecall(n.recall !== false)
          setEdBody('')
          // 列表是瘦身数据，正文按需加载；加载期间 edLoadingRef=true，doSave 省略 body（防改名等保存把空正文写盘）
          edLoadingRef.current = true
          const id = n.id
          rpc('notes-get', { id: id }).then(res => { if (res && res.note && selectedRef.current === id) setEdBody(res.note.body || ''); edLoadingRef.current = false }).catch(() => { edLoadingRef.current = false })
        }
        // 新建笔记 modal：侧栏「新建」chip / Ctrl+N 打开（清空上次标题），输标题创建
        function openNewNote() { setNewNoteTitle(''); setNewNotePending(false); setError(''); setNewNoteOpen(true) }
        openNewNoteRef.current = openNewNote
        // 创建流程：notes-create → 静默刷新列表 → 选中新笔记 → 聚焦正文 textarea → toast
        // 落位规则（原型 btnNew）：文件夹视图落当前文件夹；主题视图带当前主题；否则落选中笔记所在文件夹/未分类
        async function doCreateNote() {
          const title = newNoteTitle.trim()
          if (!title || newNotePending) return
          setNewNotePending(true); setError('')
          try {
            const selNote = notes.find(n => n.id === selected)
            const createFolder = view.type === 'folder' ? view.id : ((selNote && selNote.folder) || '')
            const payload = { title: title, body: '', kind: 'note' }
            if (createFolder) payload.folder = createFolder
            if (view.type === 'topic' && view.id) payload.topic = view.id
            const res = await rpc('notes-create', payload)
            if (res && res.error) { setError(res.error); return }
            setNewNoteOpen(false); setNewNoteTitle('')
            showToast('已创建')
            // 立即用创建返回值选中新笔记（不等列表刷新，避免列表时序影响选中链路）
            if (res && res.id) {
              selectNote({ id: res.id, title: res.title || title, topic: res.topic || payload.topic || '', kind: res.kind || 'note', status: res.status || 'active', folder: createFolder, tags: [], inject: false, injectTo: [] })
              setFlashId(res.id); later(() => setFlashId(null), 1800)
              // 聚焦正文：等选中态渲染出 textarea 再 focus（预览态先切回编辑态，否则没有 textarea 可聚焦）
              setPreviewMode(false)
              later(() => { try { if (edBodyDomRef.current) edBodyDomRef.current.focus() } catch (err) {} }, 300)
              later(() => { try { if (edBodyDomRef.current && document.activeElement !== edBodyDomRef.current) edBodyDomRef.current.focus() } catch (err) {} }, 700)
            }
            notifyNotesChanged()
            loadNotes(true)  // 后台刷新列表（不 await，不阻塞选中/聚焦链路）
          } catch (err) { setError(String(err.message || err)) } finally { setNewNotePending(false) }
        }
        async function doSave() {
          const id = selectedRef.current
          if (!id) return
          setError('')
          const tags = (edTagsRef.current || '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean)
          if (keepQuickRef.current && tags.indexOf('quick') < 0) tags.push('quick')
          const upd = { id: id, title: edTitleRef.current, tags: tags, kind: edKindRef.current, status: edStatusRef.current, inject: edRoleRef.current !== 'off', injectTo: edScopeRef.current, recall: edRecallRef.current }
          if (!edLoadingRef.current) upd.body = edBodyRef.current   // 正文加载中省略 body（host 对 undefined 保留原内容，防竞态清空正文）
          if (upd.inject) upd.injectRole = edRoleRef.current   // 非 off 才带 injectRole（off 态不带，payload 禁 undefined；host 仅 inject=true 落盘）
          if ((edTopicRef.current || '').trim()) upd.topic = edTopicRef.current.trim()
          try {
            const res = await rpc('notes-update', upd)
            if (res && res.error) { setError(res.error); return }
            setSavedAt(Date.now())
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        async function doDelete(id) {
          if (!id) return
          setError('')
          try {
            const res = await rpc('notes-delete', { id: id })
            if (res.error) { setError(res.error); return }
            if (selected === id) { setSelected(null); setEdTitle(''); setEdTopic(''); setEdTags(''); setEdBody('') }
            showToast('已删除（可由 Agent 恢复）')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
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
        // ===== 虚拟文件夹树交互：折叠切换/自动展开/新建/重命名/删除/排序 + 笔记移动（管理走 notes-folders RPC，移动走 notes-update 的 folder 字段）=====
        // 折叠判定：foldersExpanded=null 表示缺省全展开；否则数组为展开中的 id 集合（含置顶组 PINNED_KEY）
        function isFolderExpanded(id) { return foldersExpanded === null ? true : foldersExpanded.indexOf(id) >= 0 }
        // 折叠/展开切换（缺省全展开时先物化全量展开集合再切换，保证其余文件夹保持展开）
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
        // 文件夹项右键菜单：与笔记行菜单同坐标换算（面板内绝对定位；两菜单互斥）
        function openFolderMenu(ev, f) {
          ev.preventDefault(); ev.stopPropagation()
          const floatEl = ev.currentTarget.closest('.dsh-notes-floating')
          const rect = floatEl ? floatEl.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 500 }
          const mw = 190, mh = 160
          let x = ev.clientX - rect.left, y = ev.clientY - rect.top
          x = Math.max(4, Math.min(x, rect.width - mw - 4))
          y = Math.max(4, Math.min(y, rect.height - mh - 4))
          setFolderMenu({ x: x, y: y, folder: f })
          setCtxMenu(null)
        }
        // 文件夹分组头 ＋ → 内联输入：Enter 提交（空串=取消）；建成即展开该文件夹并进入文件夹视图
        async function doCreateFolder() {
          const name = folderInputText.trim()
          if (!name) { setFolderInputOpen(false); return }
          setFolderInputOpen(false); setFolderInputText(''); setError('')
          try {
            const res = await rpc('notes-folders', { op: 'create', name: name })
            if (res && res.error) { setError(res.error); return }
            showToast('已建文件夹「' + name + '」')
            if (res.folder && res.folder.id) { expandFolder(res.folder.id); setView({ type: 'folder', id: res.folder.id }) }
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
            showToast('已重命名为「' + name + '」')
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 右键删除：确认后删清单（其下笔记由 host 回退未分类）；展开态残留由 loadFolders 清理
        async function doDeleteFolder(f) {
          setFolderMenu(null)
          if (!window.confirm('删除文件夹「' + f.name + '」？其下 ' + (f.count || 0) + ' 条笔记将移回未分类。')) return
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'delete', id: f.id })
            if (res && res.error) { setError(res.error); return }
            showToast('已删除文件夹「' + f.name + '」')
            if (view.type === 'folder' && view.id === f.id) setView({ type: 'all', id: '' })
            await loadFolders(); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 右键上移/下移：按当前顺序换位后整体提交 reorder（ids 全量，host 归一化 order）
        async function doReorderFolder(f, delta) {
          setFolderMenu(null)
          const ids = folders.map(x => x.id)
          const i = ids.indexOf(f.id)
          const j = i + delta
          if (i < 0 || j < 0 || j >= ids.length) return
          ids.splice(i, 1); ids.splice(j, 0, f.id)
          setError('')
          try {
            const res = await rpc('notes-folders', { op: 'reorder', ids: ids })
            if (res && res.error) { setError(res.error); return }
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 笔记行右键「移动到文件夹」：notes-update 只改 folder 字段；'' = 移出到未分类
        async function ctxMoveToFolder(n, folderId) {
          setCtxMenu(null); setCtxNewFolderText(''); setError('')
          const fname = folderId ? ((folders.find(f => f.id === folderId) || {}).name || '') : ''
          try {
            const res = await rpc('notes-update', { id: n.id, folder: folderId })
            if (res && res.error) { setError(res.error); return }
            showToast(folderId ? '已移动到「' + fname + '」' : '已移出文件夹')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // ===== 拖拽挪入/挪出文件夹（HTML5 DnD；与右键「移动到文件夹」共用 ctxMoveToFolder 移动逻辑）=====
        // dragstart：noteId 记到 ref + dataTransfer（Firefox 需 setData 才能起拖），源行加 .dragging 半透明
        function onNoteDragStart(ev, n) {
          dragNoteIdRef.current = n.id
          try { ev.dataTransfer.setData('text/dsh-note-id', n.id); ev.dataTransfer.effectAllowed = 'move' } catch (err) {}
          try { ev.currentTarget.classList.add('dragging') } catch (err) {}
        }
        // dragend 兜底清理：无论 drop 成功与否（含拖到面板外），摘掉 .dragging 与面板内所有残留 .drop-hint
        function onNoteDragEnd(ev) {
          dragNoteIdRef.current = null
          try { ev.currentTarget.classList.remove('dragging') } catch (err) {}
          try { const els = document.querySelectorAll('.dsh-notes-floating .drop-hint'); for (let i = 0; i < els.length; i++) els[i].classList.remove('drop-hint') } catch (err) {}
        }
        // 文件夹行 drop 目标：仅本插件笔记拖拽（ref 有值）才接管——dragover preventDefault + .drop-hint 高亮；非法目标不高亮不 preventDefault（浏览器显示禁止光标，drop 无动作）
        function onFolderDragOver(ev) {
          if (!dragNoteIdRef.current) return
          ev.preventDefault()
          try { ev.dataTransfer.dropEffect = 'move' } catch (err) {}
          ev.currentTarget.classList.add('drop-hint')
        }
        function onFolderDragLeave(ev) { ev.currentTarget.classList.remove('drop-hint') }
        // drop 到文件夹行 = 移入该夹（已在该夹则静默无动作，不重复弹 toast）
        function onFolderDrop(ev, f) {
          if (!dragNoteIdRef.current) return
          ev.preventDefault()
          ev.currentTarget.classList.remove('drop-hint')
          const id = dragNoteIdRef.current
          const noteObj = notes.find(x => x.id === id)
          if (noteObj && (noteObj.folder || '') !== f.id) ctxMoveToFolder({ id: id }, f.id)
        }
        // 未分类区 drop 目标：拖入本区 = 移出文件夹（仅对当前在文件夹内的笔记生效；已未分类则静默）
        function onUnfiledDragOver(ev) {
          if (!dragNoteIdRef.current) return
          ev.preventDefault()
          try { ev.dataTransfer.dropEffect = 'move' } catch (err) {}
          ev.currentTarget.classList.add('drop-hint')
        }
        function onUnfiledDragLeave(ev) { ev.currentTarget.classList.remove('drop-hint') }
        function onUnfiledDrop(ev) {
          if (!dragNoteIdRef.current) return
          ev.preventDefault()
          ev.currentTarget.classList.remove('drop-hint')
          const id = dragNoteIdRef.current
          const noteObj = notes.find(x => x.id === id)
          if (noteObj && (noteObj.folder || '')) ctxMoveToFolder({ id: id }, '')
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
              showToast('已移动到「' + res.folder.name + '」')
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
        // 文件夹右键菜单：点击菜单外部关闭（与笔记行菜单共用 .dsh-notes-ctxmenu 样式）
        React.useEffect(() => {
          if (!folderMenu) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ctxmenu'))) setFolderMenu(null) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [folderMenu])
        function close() { panelOpen = false; notify() }
        function jumpToSession(sessionId) { if (sessions && sessionId) { try { sessions.open(sessionId) } catch (err) {} } }
        // 注入三态切换：独立字段 inject + injectRole（off→inject:false；约定/资料→inject:true+injectRole），不碰标签
        // off→非off 时自动展开范围浮层（与原 toggle 开启行为一致）；切到 off 收起浮层
        function setRoleSeg(r) {
          if (r === edRole) return
          const wasOff = edRole === 'off'
          setEdRole(r)
          if (r === 'off') setScopeOpen(false)
          else if (wasOff) setScopeOpen(true)
          triggerAutoSave()
        }
        // 目录可见开关：独立字段 recall（缺省 true=进目录；false 逐条排除，与 inject 正交）
        function toggleRecall() { setEdRecall(!edRecall); triggerAutoSave() }
        // 范围多选：切换某个会话短 id 的选中态（缺省=所有会话；存量 'global'/'workspace' 值在首次勾选时规范化掉，host 端仍容错）
        function toggleScope(key) {
          const cur = (edScopeRef.current || []).filter(t => t !== 'global' && t !== 'workspace')
          const next = cur.indexOf(key) >= 0 ? cur.filter(t => t !== key) : cur.concat([key])
          setEdScope(next)
          triggerAutoSave()
        }
        // 任务派发：加载活跃会话/工作区 + 打开对话框 + 确认派发
        // 0.1.7 首屏提速：host 对缓存未命中会话先返回占位（titlesPending + pendingSessions），对话框立即渲染
        // （占位条目显示「短id · 标题加载中…」）；仍 pending 则 1.5s 轮询重拉，直到标题补齐或对话框关闭。
        async function loadActiveSessions() {
          try {
            const res = await rpc('notes-active-sessions', {})
            if (!res) return
            if (res.sessions) setActiveSessions(res.sessions)
            setDispatchPending(res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [])
            if (res.titlesPending && dispatchOpenRef.current) later(loadActiveSessions, 1500)
          } catch (e) {}
        }
        async function loadWorkspaces() {
          try { const res = await rpc('notes-workspaces', {}); if (res && res.workspaces) setWsList(res.workspaces) } catch (e) {}
        }
        function openDispatch() {
          setDispatchInstr(''); setDispatchSessId(''); setDispatchSessWs(''); setDispatchWsId(''); setDispatchMode('existing'); setError('')
          loadActiveSessions(); loadWorkspaces(); setDispatchOpen(true)
        }
        // 设置卡片：打开即拉取 settings + 可用模型列表（host 探 llm 服务目录；探不到时 models=[]，控件退化为手输）
        function openSettings() {
          setSetLlmProvider(''); setSetLlmModel(''); setSettingsData(null); setError(''); setSettingsOpen(true)
          rpc('notes-settings-get', {}).then(res => {
            if (!res) return
            setSettingsData(res)
            const l = res.settings && res.settings.llm
            if (l && l.provider && l.model) { setSetLlmProvider(l.provider); setSetLlmModel(l.model) }
            setSetCatalog(!res.settings || res.settings.catalogEnabled !== false)   // 目录注入总开关：缺省开
          }).catch(() => {})
        }
        // 选择即保存：llm=null 恢复跟随当前会话（默认）；否则保存 { provider, model }
        function saveSettingsLlm(llm) {
          rpc('notes-settings-set', { llm: llm }).then(res => {
            if (res && res.error) { setError(res.error); return }
            if (res && res.settings) setSettingsData(prev => Object.assign({}, prev || {}, { settings: res.settings }))
            showToast(llm ? ('已保存：笔记 LLM = ' + llm.provider + ' / ' + llm.model) : '已恢复跟随当前会话（默认）')
          }).catch(err => setError(String(err.message || err)))
        }
        // 目录注入总开关：勾选即保存（只传布尔 catalogEnabled；host 侧 null 才是恢复默认开，这里不用）
        function saveSettingsCatalog(enabled) {
          rpc('notes-settings-set', { catalogEnabled: enabled }).then(res => {
            if (res && res.error) { setError(res.error); return }
            if (res && res.settings) setSettingsData(prev => Object.assign({}, prev || {}, { settings: res.settings }))
            showToast(enabled ? '已开启笔记目录注入' : '已关闭笔记目录注入')
          }).catch(err => setError(String(err.message || err)))
        }
        // 手输模式（探不到模型列表时）：provider/model 两框齐备才保存；清除按钮恢复跟随会话
        function saveSettingsLlmManual() {
          const p = setLlmProvider.trim(), m = setLlmModel.trim()
          if (!p || !m) return
          saveSettingsLlm({ provider: p, model: m })
        }
        // ===== 数据导入/导出（侧栏底部直达 + 设置卡片「数据」区同入口）=====
        // 导出：打开对话框时回填上次导出目录（localStorage 记忆）；确认 → notes-export → toast 含快照目录路径
        function openExport() {
          let last = ''
          try { last = localStorage.getItem('dsh-notes-last-export-dir') || '' } catch (err) {}
          setExportDir(last); setExportPending(false); setError('')
          setSettingsOpen(false); setExportOpen(true)   // 与设置卡片互斥：modal 不叠 modal
        }
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
        // 导入两步式：第一步选目录 → notes-import-preview 出预览；第二步勾选覆盖 → notes-import 执行
        function openImport() {
          setImportDir(''); setImportPreview(null); setImportOverwrite(false); setImportPending(false); setError('')
          setSettingsOpen(false); setImportOpen(true)
        }
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
            await loadNotes(true); loadFolders(); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) } finally { setImportPending(false) }
        }
        async function doDispatchConfirm() {
          if (!selected || dispatching) return
          setDispatching(true); setError('')
          try {
            if (dispatchMode === 'new') {
              // 新建会话派发：client connectWorkspace 复用/新建一个 live 会话，再注入上下文+触发工作
              if (!dispatchWsId) { setError('请选择工作区'); setDispatching(false); return }
              if (!workspaces || !workspaces.connectWorkspace) { setError('workspaces 服务不可用'); setDispatching(false); return }
              const ws = wsList.find(w => w.id === dispatchWsId)
              const newSid = await workspaces.connectWorkspace(dispatchWsId)
              const res = await rpc('notes-dispatch', { id: selected, sessionId: newSid, sessionName: (ws ? ws.title : '新会话'), workspace: ws ? ws.title : '', mode: 'new', instruction: dispatchInstr })
              if (res && res.error) { setError(res.error); setDispatching(false); return }
              if (sessions && newSid) { try { sessions.open(newSid) } catch (e) {} }
              showToast('已新建会话，待办已注入并开始处理')
            } else {
              // 已有会话派发
              if (!dispatchSessId) { setError('请选择目标会话'); setDispatching(false); return }
              const sess = activeSessions.find(s => s.id === dispatchSessId)
              // 目标未打开（不 live）：先打开激活，等它上线后再注入触发
              if (sess && !sess.live && sessions && sessions.open) {
                try { sessions.open(sess.id) } catch (e) {}
                await timer.timeout(1200)
              }
              const res = await rpc('notes-dispatch', { id: selected, sessionId: dispatchSessId, sessionName: sess ? sess.name : '', workspace: sess ? sess.workspace : '', mode: 'existing', instruction: dispatchInstr })
              if (res && res.error) { setError(res.error); setDispatching(false); return }
              showToast((sess && !sess.live ? '已打开并派发待办到「' : '已派发待办到「') + (sess ? sess.name : '') + '」（开始处理）')
            }
            setDispatchOpen(false); setDispatchInstr('')
            const g = await rpc('notes-get', { id: selected }); if (g && g.note) setEdBody(g.note.body || '')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) } finally { setDispatching(false) }
        }
        // 标记一条派发待办为完成（停止注入目标会话系统提示）
        async function doDispatchDone(origIndex) {
          try {
            const r = await rpc('notes-dispatch-done', { id: selected, dispatchIndex: origIndex })
            if (r && r.error) { setError(r.error); return }
            showToast('已标记完成'); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        async function doArchive() { setError(''); try { const res = await rpc('notes-archive'); if (res.error) { setError(res.error); return } showToast('归档完成：合并 ' + (res.merged || 0) + ' 组'); await loadNotes(true); notifyNotesChanged() } catch (err) { setError(String(err.message || err)) } }
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
        // 同步编辑字段 ref（供自动保存 debounce 读最新值）
        edTitleRef.current = edTitle
        edTopicRef.current = edTopic
        edTagsRef.current = edTags
        edBodyRef.current = edBody
        edKindRef.current = edKind
        edStatusRef.current = edStatus
        edRoleRef.current = edRole
        edRecallRef.current = edRecall
        edScopeRef.current = edScope
        // 自动保存：debounce 只注册一次（null 时赋值），回调读 ref 避免闭包过期
        if (!autoSaveRef.current) autoSaveRef.current = timer.debounce(() => { if (selectedRef.current) doSave() }, 900)
        function triggerAutoSave() { if (autoSaveRef.current) autoSaveRef.current() }
        if (!open) return null
        function groupByTopic(list) { const map = new Map(); for (const n of list) { const t = n.topic || '未分类'; if (!map.has(t)) map.set(t, []); map.get(t).push(n) } return Array.from(map.entries()) }
        function highlight(text, q) { if (!q || !text) return text; const s = String(text); const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const parts = s.split(new RegExp('(' + esc + ')', 'gi')); if (parts.length === 1) return s; return parts.map((p, i) => i % 2 === 1 ? e('mark', { key: i, className: 'dsh-notes-mark' }, p) : p) }
        function folderName(fid) { const f = folders.find(x => x.id === fid); return f ? f.name : '' }
        const q = searchText.trim().toLowerCase()
        const localFiltered = q ? notes.filter(n => { const hay = ((n.title || '') + ' ' + (n.preview || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ') + ' ' + folderName(n.folder)).toLowerCase(); return hay.indexOf(q) >= 0 }) : notes
        // 搜索结果取 host 全文 + 本地即时的并集，RPC 失败/延迟时本地结果保底
        let filtered = searchIds ? notes.filter(n => searchIds.indexOf(n.id) >= 0 || localFiltered.indexOf(n) >= 0) : localFiltered
        // 视图求值（原型 matches）：view 单选（all/folder/topic）∩ kind chips ∩ 置顶 ∩ 搜索（四维 AND）
        if (view.type === 'topic') filtered = filtered.filter(n => (n.topic || '') === view.id)
        else if (view.type === 'folder') filtered = filtered.filter(n => (n.folder || '') === view.id)
        if (kindFilter !== 'all') filtered = filtered.filter(n => (n.kind || 'note') === kindFilter)
        if (pinnedOnly) filtered = filtered.filter(n => n.status === 'pinned')
        // 懒加载分页：只渲染前 visibleCount 条笔记行，滚动到底再加载更多（避免笔记多时全量渲染 + 每条跑 highlight）
        const paged = filtered.slice(0, visibleCount)
        const hasMore = filtered.length > visibleCount
        function onListScroll(ev) {
          const el = ev.target
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) { setVisibleCount(c => c + PAGE_SIZE) }
        }
        // 注入范围文字（injectTo 是多选数组）：缺省 = 所有会话（存量 global/workspace 值同样视为所有会话）；否则列出所选会话名
        function injectScopeLabel(injectTo) {
          const arr = (injectTo || []).filter(t => t !== 'global' && t !== 'workspace')
          if (arr.length === 0) return '所有会话'
          const names = arr.map(t => {
            const s = sessList.find(x => x.short === t)
            return s ? s.name : ('会话 ' + t)
          })
          return names.join('、')
        }
        // ===== 侧栏笔记行（原型 note-row）：kind 色点 + 标题(+置顶 pin) + 注入 bolt + 行尾 =====
        // 行尾（原型 noteRow）：主题视图内显示所属文件夹徽章；文件夹上下文内显示淡灰主题字（方案A）；其余显示日期
        function renderNoteRow(n, inFolderCtx) {
          let tail
          if (view.type === 'topic' && (n.folder || '')) tail = e('span', { className: 'dsh-notes-fbadge' }, I('folder', 9), folderName(n.folder))
          else if (inFolderCtx && n.topic && n.topic !== '分类中') tail = e('span', { className: 'dsh-notes-note-tp', title: '主题：' + n.topic }, n.topic)
          else tail = e('span', { className: 'dsh-notes-note-dt' }, n.updatedAt ? n.updatedAt.slice(5, 10) : '')
          return e('div', { key: n.id, className: 'dsh-notes-note-row' + (selected === n.id ? ' sel' : '') + (focusId === n.id ? ' focused' : '') + (flashId === n.id ? ' flash' : '') + (n.status === 'resolved' ? ' resolved' : '') + (n.status === 'superseded' ? ' superseded' : ''), onClick: () => selectNote(n), onContextMenu: (ev) => openCtxMenu(ev, n), draggable: true, onDragStart: (ev) => onNoteDragStart(ev, n), onDragEnd: (ev) => onNoteDragEnd(ev) },
            e('span', { className: 'dsh-notes-kind-dot', style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' } }),
            e('span', { className: 'dsh-notes-note-ti' }, n.status === 'pinned' ? I('pin', 10, 'dsh-notes-note-pin') : null, highlight(n.title || '无标题', q)),
            n.inject === true ? e('span', { className: 'dsh-notes-note-inj dsh-nt', 'data-tooltip': '注入为上下文 · ' + (n.injectRole === 'reference' ? '资料' : '约定') + ' · 范围：' + injectScopeLabel(n.injectTo) }, I('bolt', 10)) : null,
            tail)
        }
        // ===== 侧栏树（原型 renderTree 翻译）：视图头 → 置顶组 → 文件夹组（nested 子笔记）→ 未分类（主题二级分组）→ 主题全局过滤 =====
        const treeIds = []
        const treeEls = []
        const filtersActive = view.type !== 'all' || kindFilter !== 'all' || pinnedOnly || !!q
        const viewTitle = view.type === 'topic' ? ('主题 · ' + view.id) : view.type === 'folder' ? ('文件夹 · ' + folderName(view.id)) : '全部笔记'
        treeEls.push(e('div', { key: 'sec-view', className: 'dsh-notes-sec-h' },
          I('filter', 11),
          e('span', { className: 'dsh-notes-sec-h-t' }, viewTitle),
          view.type === 'topic' ? e('span', { className: 'dsh-notes-sec-h-sub' }, '（跨文件夹 ' + filtered.length + ' 条）') : null,
          view.type !== 'all' ? e('span', { className: 'dsh-notes-sec-h-clear dsh-nt', 'data-tooltip': '清除视图过滤', onClick: (ev) => { ev.stopPropagation(); setView({ type: 'all', id: '' }) } }, '×') : null))
        // 置顶组：置顶笔记仍在其所属位置显示（带 pin 视觉），本组是跨文件夹的置顶聚合视图（可折叠，PINNED_KEY 持久化）
        const pinnedAll = filtered.filter(n => n.status === 'pinned')
        if (pinnedAll.length > 0) {
          const pinOpen = isFolderExpanded(PINNED_KEY)
          treeEls.push(e('div', { key: 'sec-pinned', className: 'dsh-notes-sec-h dsh-notes-sec-toggle', onClick: () => toggleFolder(PINNED_KEY) },
            e('span', { className: 'dsh-notes-caret' + (pinOpen ? ' open' : '') }, I('chev', 10)),
            I('pin', 11),
            e('span', { className: 'dsh-notes-sec-h-t' }, '置顶'),
            e('span', { className: 'dsh-notes-sec-h-n' }, pinnedAll.length)))
          if (pinOpen) {
            const pinRows = []
            paged.filter(n => n.status === 'pinned').forEach(n => { treeIds.push(n.id); pinRows.push(renderNoteRow(n, false)) })
            if (pinRows.length) treeEls.push(e('div', { key: 'pinned-kids', className: 'dsh-notes-nested' }, pinRows))
          }
        }
        // 文件夹组：行 = caret（折叠切换）+ folder 图标 + 名称 + 计数；点行主体 = 进入/退出文件夹视图（原型行为）；右键管理
        treeEls.push(e('div', { key: 'sec-folders', className: 'dsh-notes-sec-h' },
          I('folder', 11),
          e('span', { className: 'dsh-notes-sec-h-t' }, '文件夹'),
          e('span', { className: 'dsh-notes-sec-h-add dsh-nt', 'data-tooltip': '新建文件夹', onClick: (ev) => { ev.stopPropagation(); setFolderInputText(''); setFolderInputOpen(true) } }, I('plus', 12))))
        for (const f of folders) {
          const fOpen = isFolderExpanded(f.id)
          const kidsAll = filtered.filter(n => (n.folder || '') === f.id)
          const kids = paged.filter(n => (n.folder || '') === f.id)
          // 计数口径（原型）：主题视图下显示命中数；其余显示文件夹总数
          const cnt = view.type === 'topic' ? kidsAll.length : (f.count || 0)
          treeEls.push(renamingId === f.id
            ? e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' },
                e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                e('input', { className: 'dsh-notes-folder-rename', value: renameText, autoFocus: true, onChange: (ev) => setRenameText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doRenameFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setRenamingId(null) } }, onBlur: () => setRenamingId(null) }))
            : e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' + (view.type === 'folder' && view.id === f.id ? ' on' : ''), onClick: (ev) => { if (ev.target && ev.target.closest && ev.target.closest('.dsh-notes-caret')) return; setView(view.type === 'folder' && view.id === f.id ? { type: 'all', id: '' } : { type: 'folder', id: f.id }) }, onContextMenu: (ev) => openFolderMenu(ev, f), onDragOver: onFolderDragOver, onDragLeave: onFolderDragLeave, onDrop: (ev) => onFolderDrop(ev, f) },
                e('span', { className: 'dsh-notes-caret' + (fOpen ? ' open' : ''), onClick: (ev) => { ev.stopPropagation(); toggleFolder(f.id) } }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                e('span', { className: 'dsh-notes-row-nm' }, f.name),
                e('span', { className: 'dsh-notes-row-n' }, cnt)))
          if (fOpen && kids.length) { kids.forEach(n => { treeIds.push(n.id) }); treeEls.push(e('div', { key: 'kids-' + f.id, className: 'dsh-notes-nested' }, kids.map(n => renderNoteRow(n, true)))) }
        }
        // 新建文件夹内联输入行（分组头 ＋ 展开；Enter 提交 / Esc 或空串失焦取消）
        if (folderInputOpen) {
          treeEls.push(e('div', { key: 'folder-add', className: 'dsh-notes-folder-row' },
            e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
            e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
            e('input', { className: 'dsh-notes-folder-rename', placeholder: '文件夹名…', value: folderInputText, autoFocus: true, onChange: (ev) => setFolderInputText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setFolderInputOpen(false) } }, onBlur: () => { if (!folderInputText.trim()) setFolderInputOpen(false) } })))
        }
        // 未分类：整区包一层 .dsh-notes-unfiled-drop 容器作为「移出」drop 目标（拖到本区任意位置 = 移出文件夹）；
        // 内部按主题二级分组（原型：分组头 + nested 子笔记）；为空时仍渲染容器，保证任何时刻都有可拖出的落点
        const unfiled = paged.filter(n => !(n.folder || ''))
        const unfiledKids = []
        for (const [topic, topicNotes] of groupByTopic(unfiled)) {
          unfiledKids.push(e('div', { key: 'tg-' + topic, className: 'dsh-notes-row head dsh-notes-topic-g' },
            e('span', { className: 'dsh-notes-ic-slot' }, I('topic', 11)),
            e('span', { className: 'dsh-notes-row-nm' }, topic === '分类中' ? '识别中' : topic),
            e('span', { className: 'dsh-notes-row-n' }, topicNotes.length)))
          topicNotes.forEach(n => { treeIds.push(n.id) })
          unfiledKids.push(e('div', { key: 'tgk-' + topic, className: 'dsh-notes-nested' }, topicNotes.map(n => renderNoteRow(n, false))))
        }
        if (!unfiled.length) unfiledKids.push(e('div', { key: 'empty-u', className: 'dsh-notes-row dsh-notes-tree-empty' }, '（空）'))
        treeEls.push(e('div', { key: 'unfiled-drop', className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop },
          e('div', { className: 'dsh-notes-sec-h' }, e('span', { className: 'dsh-notes-sec-h-t' }, '未分类')),
          unfiledKids))
        // 主题全局过滤（原型底部区）：全库主题 + 计数，点击 → 主题视图（跨文件夹）；再点取消
        const allTopics = {}
        notes.forEach(n => { if (n.topic) allTopics[n.topic] = (allTopics[n.topic] || 0) + 1 })
        const topicNames = Object.keys(allTopics).sort()
        if (topicNames.length) {
          treeEls.push(e('div', { key: 'sec-topics', className: 'dsh-notes-sec-h' },
            I('topic', 11),
            e('span', { className: 'dsh-notes-sec-h-t' }, '主题过滤'),
            e('span', { className: 'dsh-notes-sec-h-sub' }, '跨文件夹')))
          topicNames.forEach(tn => {
            treeEls.push(e('div', { key: 'tp-' + tn, className: 'dsh-notes-row dsh-notes-topic-row' + (view.type === 'topic' && view.id === tn ? ' on' : ''), onClick: () => setView(view.type === 'topic' && view.id === tn ? { type: 'all', id: '' } : { type: 'topic', id: tn }) },
              e('span', { className: 'dsh-notes-ic-slot' }, I('topic', 12)),
              e('span', { className: 'dsh-notes-row-nm' }, tn === '分类中' ? '识别中' : tn),
              e('span', { className: 'dsh-notes-row-n' }, allTopics[tn])))
          })
        }
        // 空态：全库为空 → 引导新建；有库但过滤为空 → 无匹配提示
        if (notes.length === 0 && !loading) {
          treeEls.push(e('div', { key: 'empty', className: 'dsh-notes-empty-state' },
            e('div', { className: 'dsh-notes-empty-ic' }, I('note', 30)),
            e('div', { className: 'dsh-notes-empty-t' }, '还没有笔记'),
            e('div', { className: 'dsh-notes-empty-s' }, '点侧栏「新建」输入标题，创建第一条笔记'),
            e('button', { className: 'dsh-notes-empty-btn', onClick: openNewNote }, '记第一条')))
        } else if (filtered.length === 0 && filtersActive) {
          treeEls.push(e('div', { key: 'no-match', className: 'dsh-notes-sec-h' }, e('span', { className: 'dsh-notes-sec-h-t' }, '无匹配笔记')))
        }
        if (loading && notes.length === 0) treeEls.unshift(e('div', { key: 'loading', className: 'dsh-notes-loading' }, '加载中...'))
        // 键盘导航顺序 = 树渲染顺序（置顶组与所属位置重复出现的笔记去重）
        pagedIdsRef.current = Array.from(new Set(treeIds))
        // 是否注入为上下文：由 inject + injectRole 双字段推出的三态决定（off 之外即注入中，不依赖标签）
        const isInjected = edRole !== 'off'
        // 当前选中笔记（编辑器区多处用）
        const curNote = notes.find(n => n.id === selected) || null
        const curFolderName = curNote && curNote.folder ? folderName(curNote.folder) : ''
        const curTopicName = curNote && curNote.topic && curNote.topic !== '分类中' ? curNote.topic : ''
        // 主题全局过滤跳转（面包屑主题段 + 主题 chip 跳钮共用）：未识别主题时提示不跳转
        function jumpToTopicFilter() {
          if (!curTopicName) { showToast('该笔记尚未识别主题'); return }
          setView({ type: 'topic', id: curTopicName })
          showToast('已按主题过滤：' + curTopicName)
        }
        // 文件夹右键菜单的上移/下移边界（首项不可上移、末项不可下移）
        const folderMenuIdx = folderMenu ? folders.findIndex(f => f.id === folderMenu.folder.id) : -1
        const curDispatches = (curNote && curNote.dispatches) || []
        // 范围浮层：会话按工作区分组（两级：工作区 → 会话）
        const scopeByWs = {}
        for (const s of sessList) { const w = s.workspace || '其他'; if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push(s) }
        // 标题后台补齐中的占位会话（0.1.7）：禁用态占位「短id · 标题加载中…」，补齐后轮询重拉自动替换为真名
        for (const p of sessPending) { const w = p.workspace || '其他'; if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push({ id: p.id, short: p.short, name: '', pending: true }) }
        const scopeWsKeys = Object.keys(scopeByWs).sort()
        // 派发对话框：已有会话模式按工作区过滤活跃会话；新建会话模式选工作区
        const dispatchWsKeys = []
        const dispatchSessByWs = {}
        for (const s of activeSessions) { const w = s.workspace || '其他'; if (!dispatchSessByWs[w]) { dispatchSessByWs[w] = []; dispatchWsKeys.push(w) } dispatchSessByWs[w].push(s) }
        // 标题后台补齐中的占位会话（0.1.7）：同一下拉按工作区分组，禁用态显示「短id · 标题加载中…」
        for (const p of dispatchPending) { const w = p.workspace || '其他'; if (!dispatchSessByWs[w]) { dispatchSessByWs[w] = []; dispatchWsKeys.push(w) } dispatchSessByWs[w].push({ id: p.id, short: p.short, name: '', pending: true }) }
        // ===== 编辑器区（原型 .ed）：面包屑 + 大标题 + meta chips 行 + 正文 + 底部状态 =====
        const editorEl = curNote ? e('section', { className: 'dsh-notes-ed' },
          e('div', { className: 'dsh-notes-ed-h' },
            e('div', { className: 'dsh-notes-ed-crumb' },
              curFolderName ? e('span', { className: 'dsh-notes-crumb-cur' }, curFolderName) : null,
              curFolderName ? e('span', { className: 'dsh-notes-crumb-sep' }, '/') : null,
              e('span', { className: 'dsh-notes-crumb-lnk dsh-nt', 'data-tooltip': '查看同主题全部笔记', onClick: jumpToTopicFilter }, curTopicName || '未分类'),
              e('span', { className: 'dsh-notes-crumb-sep' }, '/'),
              e('span', null, curNote.id)),
            e('input', { className: 'dsh-notes-ed-title', placeholder: '无标题', value: edTitle, onChange: (ev) => { setEdTitle(ev.target.value); triggerAutoSave() } }),
            e('div', { className: 'dsh-notes-ed-meta' },
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '笔记类型' },
                e('span', { className: 'dsh-notes-meta-dot', style: { background: 'var(--nkind-' + edKind + ')' } }),
                e('select', { className: 'dsh-notes-meta-select', value: edKind, onChange: (ev) => { setEdKind(ev.target.value); triggerAutoSave() } },
                  e('option', { value: 'note' }, '笔记'),
                  e('option', { value: 'decision' }, '决策'),
                  e('option', { value: 'todo' }, '待办'),
                  e('option', { value: 'link' }, '链接'),
                  e('option', { value: 'quote' }, '引用'))),
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '主题（可直接编辑；点右侧按钮按主题全局过滤）' },
                I('topic', 11),
                e('input', { className: 'dsh-notes-meta-topic-input', placeholder: '主题', value: edTopic, onChange: (ev) => { setEdTopic(ev.target.value); triggerAutoSave() } }),
                e('span', { className: 'dsh-notes-meta-jump dsh-nt', 'data-tooltip': '按主题全局过滤', onClick: jumpToTopicFilter }, I('filter', 10))),
              curFolderName ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '所在文件夹' }, I('folder', 11), curFolderName) : null,
              e('span', { className: 'dsh-notes-meta-chip dsh-notes-role-seg' },
                I('bolt', 11),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'off' ? ' on' : ''), onClick: () => setRoleSeg('off'), 'data-tooltip': '不注入系统提示' }, '关闭'),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'convention' ? ' on' : ''), onClick: () => setRoleSeg('convention'), 'data-tooltip': '须遵守的行为规则' }, '约定'),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'reference' ? ' on' : ''), onClick: () => setRoleSeg('reference'), 'data-tooltip': '事实性补充信息，Agent 按需取用' }, '资料')),
              isInjected ? e('span', { className: 'dsh-notes-ed-scope-wrap' },
                e('button', { className: 'dsh-notes-meta-chip dsh-notes-scope-trigger dsh-nt', onClick: (ev) => { ev.stopPropagation(); setScopeOpen(!scopeOpen) }, 'data-tooltip': '选择注入范围（可多选）' },
                  injectScopeLabel(edScope), e('span', { className: 'dsh-notes-scope-caret' }, '▾')),
                scopeOpen ? e('div', { className: 'dsh-notes-scope-panel' },
                  // 默认提示行：注入无「工作区/全局」维度——缺省注入所有会话，勾选会话则仅限这些会话
                  e('div', { className: 'dsh-notes-scope-hint' }, '默认注入到所有会话；勾选会话则仅限这些会话'),
                  scopeWsKeys.map(ws => e('div', { key: ws, className: 'dsh-notes-scope-group' },
                    e('div', { className: 'dsh-notes-scope-ws' }, ws),
                    scopeByWs[ws].map(s => e('label', { key: s.id, className: 'dsh-notes-scope-item dsh-notes-scope-sess' },
                      e('input', { type: 'checkbox', checked: s.pending ? false : edScope.indexOf(s.short) >= 0, onChange: () => { if (!s.pending) toggleScope(s.short) }, disabled: !!s.pending }),
                      ' ' + (s.pending ? (s.short + ' · 标题加载中…') : s.name))))))
                : null)
              : null,
              e('span', { className: 'dsh-notes-meta-chip tgl' + (edRecall ? ' on' : ''), onClick: toggleRecall, 'data-tooltip': '关闭后该笔记不出现在注入给 Agent 的目录中' }, I('eye', 11), '目录可见'),
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': '标签（逗号分隔；convention 标签已由注入开关替代）' },
                I('tag', 11),
                e('input', { className: 'dsh-notes-meta-tags-input', placeholder: '标签，逗号分隔', value: edTags, onChange: (ev) => { setEdTags(ev.target.value); triggerAutoSave() } })),
              e('span', { className: 'dsh-notes-meta-sp' }),
              e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: (ev) => { ev.stopPropagation(); openDispatch() }, 'data-tooltip': '派发待办到会话（可补充具体要求）' }, I('play', 12), dispatching ? '…' : '派发'),
              curNote.sessionId ? e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: () => jumpToSession(curNote.sessionId), 'data-tooltip': '跳转到来源会话' }, I('ext', 12), '来源') : null,
              e('span', { className: 'dsh-notes-meta-act' + (edStatus === 'pinned' ? ' on' : '') + ' dsh-nt', onClick: () => { setEdStatus(edStatus === 'pinned' ? 'active' : 'pinned'); triggerAutoSave() }, 'data-tooltip': edStatus === 'pinned' ? '取消置顶' : '置顶' }, I('pin', 12)),
              e('span', { className: 'dsh-notes-meta-act danger dsh-nt', onClick: () => doDelete(selected), 'data-tooltip': '删除（软删除，可恢复）' }, I('trash', 12)))),
          curDispatches.length ? e('div', { className: 'dsh-notes-dispatch-history' + (dispatchHistoryOpen ? ' open' : ' collapsed') },
            e('div', { className: 'dsh-notes-dispatch-history-t', onClick: () => setDispatchHistoryOpen(!dispatchHistoryOpen), role: 'button', 'aria-expanded': dispatchHistoryOpen ? 'true' : 'false' },
              I('chev', 9, 'dsh-notes-hist-caret' + (dispatchHistoryOpen ? ' open' : '')), '派发历史（' + curDispatches.length + '）'),
            dispatchHistoryOpen ? curDispatches.map((d, origIdx) => ({ d: d, origIdx: origIdx })).reverse().map(({ d, origIdx }) => e('div', { key: origIdx, className: 'dsh-notes-dispatch-rec' + (d.done ? ' done' : '') },
              e('div', { className: 'dsh-notes-dispatch-rec-top' },
                e('span', { className: 'dsh-notes-dispatch-rec-t' }, d.done ? [I('check', 10, 'dsh-notes-hist-done'), ' ' + (d.sessionName || d.sessionId)] : [e('span', { key: 'dot', className: 'dsh-notes-dispatch-dot' }), ' ' + (d.sessionName || d.sessionId)]),
                e('span', { className: 'dsh-notes-dispatch-rec-m' }, (d.done ? '已完成 · ' : '待处理 · ') + (d.mode === 'new' ? '新会话' : (d.workspace || '已有会话')) + (d.at ? ' · ' + String(d.at).slice(5, 16).replace('T', ' ') : ''))),
              d.instruction ? e('div', { className: 'dsh-notes-dispatch-rec-i' }, '要求：' + d.instruction) : null,
              !d.done ? e('button', { className: 'dsh-notes-dispatch-done-btn', onClick: () => doDispatchDone(origIdx) }, '标记完成') : null)) : null)
          : null,
          previewMode
            ? e('div', { className: 'dsh-notes-preview-container', dangerouslySetInnerHTML: { __html: renderMarkdown(edBody) } })
            : e('textarea', { ref: edBodyDomRef, className: 'dsh-notes-ed-body', placeholder: '正文…（Markdown）', value: edBody, onChange: (ev) => { setEdBody(ev.target.value); triggerAutoSave() } }),
          e('div', { className: 'dsh-notes-ed-foot' },
            e('button', { className: 'dsh-notes-preview-toggle dsh-nt' + (previewMode ? ' on' : ''), onClick: () => setPreviewMode(!previewMode), 'data-tooltip': previewMode ? '切换到编辑模式' : '预览 Markdown 渲染' }, previewMode ? I('note', 11) : I('eye', 11), previewMode ? ' 编辑' : ' 预览'),
            e('span', { className: 'dsh-notes-ed-foot-i' }, '创建 ' + (curNote.createdAt ? String(curNote.createdAt).slice(0, 10) : '—')),
            e('span', { className: 'dsh-notes-ed-foot-i' }, '更新 ' + (curNote.updatedAt ? String(curNote.updatedAt).slice(0, 10) : '—')),
            curNote.sessionId ? e('span', { className: 'dsh-notes-ed-foot-i' }, '来源 会话 ' + shortSid(curNote.sessionId)) : null,
            e('span', { className: 'dsh-notes-ed-saved' + (savedAt ? ' show' : '') }, savedAt ? '已自动保存 ' + new Date(savedAt).toTimeString().slice(0, 5) : ''),
            e('span', { className: 'dsh-notes-ed-foot-i' }, (edBody || '').length + ' 字')))
        : e('section', { className: 'dsh-notes-ed' },
            e('div', { className: 'dsh-notes-ed-empty' },
              e('div', { className: 'dsh-notes-ed-empty-ic' }, I('note', 26)),
              e('div', { className: 'dsh-notes-ed-empty-t' }, '选择一条笔记查看和编辑'),
              e('div', { className: 'dsh-notes-ed-empty-s' }, '点侧栏「新建」输入标题，新建一条笔记')))
        // ===== 面板根：标题栏（拖拽/入口切换/归档/帮助/关闭）+ 两栏 app 区 + 浮层 =====
        return e('div', { className: 'dsh-notes-floating', style: { left: (pos.x || 0) + 'px', top: (pos.y || 0) + 'px', width: size.width + 'px', height: size.height + 'px' } },
          e('div', { className: 'dsh-notes-titlebar dsh-nt', onMouseDown: onTitlebarMouseDown, 'data-tooltip': '拖拽移动窗口' },
            e('span', { className: 'dsh-notes-titlebar-title' }, I('note', 14), '笔记'),
            e('div', { className: 'dsh-notes-titlebar-actions' },
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setEntryMode(entryMode === 'header' ? 'fab' : 'header'), 'data-tooltip': '切换入口模式：会话头部 / 悬浮气泡' }, I('swap', 13)),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: doArchive, 'data-tooltip': '归档合并：速记按会话、普通笔记按标签' }, '归档'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setShowHelp(!showHelp), 'data-tooltip': '使用说明' }, '?'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: close, 'data-tooltip': '关闭' }, '×'))),
          showHelp ? e('div', { className: 'dsh-notes-help-bubble' },
            e('button', { className: 'dsh-notes-help-close', onClick: () => setShowHelp(false) }, '×'),
            e('h4', null, '使用说明'),
            e('ul', null,
              e('li', null, '点侧栏「新建」或按 ', e('kbd', null, 'Ctrl+N'), ' 输入标题新建笔记，创建后直接编辑正文'),
              e('li', null, '在页面划选文字松手，弹出快速记录卡片（自动识别为引用）'),
              e('li', null, '同一会话 10 分钟内的速记自动合并'),
              e('li', null, '点面包屑/编辑器里的主题可按主题全局过滤（跨文件夹）'),
              e('li', null, '拖笔记到文件夹行移入，拖到「未分类」区移出'),
              e('li', null, '快捷键：', e('kbd', null, 'Ctrl+K'), ' 搜索、', e('kbd', null, 'Ctrl+N'), ' 新建、', e('kbd', null, 'j/k'), ' 或 ', e('kbd', null, '↑↓'), ' 移动、', e('kbd', null, 'Enter'), ' 打开、', e('kbd', null, 'Esc'), ' 关闭'),
              e('li', null, '「归档」整理：速记按会话、笔记按标签合并'),
              e('li', null, '删除是软删除，可让 Agent 恢复'))) : null,
          e('div', { className: 'dsh-notes-app' },
            e('aside', { className: 'dsh-notes-side' },
              e('div', { className: 'dsh-notes-brand' },
                e('span', { className: 'dsh-notes-brand-logo' }, I('note', 13)),
                e('b', null, '笔记'),
                e('span', { className: 'dsh-notes-brand-cnt' }, (filtersActive ? filtered.length : notes.length) + ' 条')),
              e('div', { className: 'dsh-notes-quick' },
                I('search', 14),
                e('input', { ref: searchInputRef, className: 'dsh-notes-quick-input', placeholder: '搜索笔记、标签、内容…', value: searchText, onChange: (ev) => { searchRef.current = ev.target.value; setSearchText(ev.target.value); setSearchIds(null); setVisibleCount(PAGE_SIZE); if (searchDebRef.current) searchDebRef.current() } }),
                e('span', { className: 'dsh-notes-kbd' }, 'Ctrl K')),
              e('div', { className: 'dsh-notes-chips' },
                ['all', 'note', 'decision', 'todo', 'link', 'quote'].map(k => e('span', { key: k, className: 'dsh-notes-chip' + (kindFilter === k ? ' on' : ''), onClick: () => { setKindFilter(k); setVisibleCount(PAGE_SIZE) } }, k === 'all' ? '全部' : KIND_LABELS[k])),
                e('span', { className: 'dsh-notes-chip' + (pinnedOnly ? ' on' : ''), onClick: () => { setPinnedOnly(!pinnedOnly); setVisibleCount(PAGE_SIZE) } }, I('pin', 11), '置顶'),
                e('span', { className: 'dsh-notes-sp' }),
                e('span', { className: 'dsh-notes-chip new dsh-nt', onClick: openNewNote, 'data-tooltip': '新建笔记（Ctrl+N）' }, I('plus', 11), '新建')),
              e('div', { className: 'dsh-notes-tree', onScroll: onListScroll },
                treeEls,
                hasMore ? e('div', { className: 'dsh-notes-more' }, '继续滚动加载更多（已显示 ' + paged.length + ' / ' + filtered.length + '）') : null),
              e('div', { className: 'dsh-notes-side-foot' },
                e('span', { className: 'dsh-notes-fbtn dsh-nt', onClick: openExport, 'data-tooltip': '导出全部笔记（目录快照）' }, I('up', 12), '导出'),
                e('span', { className: 'dsh-notes-fbtn dsh-nt', onClick: openImport, 'data-tooltip': '从目录快照导入（预览后执行）' }, I('down', 12), '导入'),
                e('span', { className: 'dsh-notes-fbtn dsh-nt', onClick: openSettings, 'data-tooltip': '设置' }, I('gear', 12), '设置'))),
            editorEl),
          e('div', { className: 'dsh-notes-resize-handle dsh-nt', style: { position: 'absolute', bottom: 0, right: 0 }, onMouseDown: (ev) => onResizeMouseDown('se', ev), 'data-tooltip': '拖拽调整' }),
          error && !dispatchOpen && !exportOpen && !importOpen ? e('div', { className: 'dsh-notes-error' }, error) : null,
          // 派发对话框（modal）：todo 上下文预览 + 补充具体要求 + 已有/新建会话（级联下拉）
          (dispatchOpen && curNote) ? e('div', { className: 'dsh-notes-dispatch-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setDispatchOpen(false) } },
            e('div', { className: 'dsh-notes-dispatch-modal' },
              e('div', { className: 'dsh-notes-dispatch-modal-t' }, I('play', 13), ' 派发待办', e('span', { style: { fontSize: '10px', color: 'var(--nt3)', fontWeight: 400, marginLeft: '8px' } }, '工作区' + wsList.length + ' / 活跃会话' + activeSessions.length + (dispatchPending.length ? '（+' + dispatchPending.length + ' 标题加载中…）' : ''))),
              e('div', { className: 'dsh-notes-dispatch-todo' },
                e('div', { className: 'dsh-notes-dispatch-todo-t' }, curNote.title || 'Untitled'),
                e('div', { className: 'dsh-notes-dispatch-todo-b' }, String(curNote.preview || '').trim() || '（无正文）')),
              e('textarea', { className: 'dsh-notes-dispatch-instr', placeholder: '补充具体要求 / 指令（可选）…', value: dispatchInstr, onChange: (ev) => setDispatchInstr(ev.target.value), rows: 3 }),
              e('div', { className: 'dsh-notes-dispatch-modes' },
                e('button', { className: 'dsh-notes-dispatch-mode' + (dispatchMode === 'existing' ? ' on' : ''), onClick: () => setDispatchMode('existing') }, '已有会话'),
                e('button', { className: 'dsh-notes-dispatch-mode' + (dispatchMode === 'new' ? ' on' : ''), onClick: () => setDispatchMode('new') }, '新建会话')),
              dispatchMode === 'existing' ? e(React.Fragment, null,
                e('select', { className: 'dsh-notes-dispatch-select', value: dispatchSessWs, onChange: (ev) => { setDispatchSessWs(ev.target.value); setDispatchSessId('') } },
                  e('option', { value: '' }, '选择工作区…'),
                  wsList.map(w => e('option', { key: w.id, value: w.title }, w.title))),
                e('select', { className: 'dsh-notes-dispatch-select', value: dispatchSessId, onChange: (ev) => setDispatchSessId(ev.target.value), disabled: !dispatchSessWs },
                  e('option', { value: '' }, dispatchSessWs ? ((dispatchSessByWs[dispatchSessWs] || []).length ? '选择会话…' : '该工作区暂无会话') : '先选工作区'),
                  (dispatchSessByWs[dispatchSessWs] || []).map(s => e('option', { key: s.id, value: s.id, disabled: !!s.pending }, s.pending ? (s.short + ' · 标题加载中…') : (s.name + (s.live ? '' : '（未打开）'))))))
              : e('select', { className: 'dsh-notes-dispatch-select', value: dispatchWsId, onChange: (ev) => setDispatchWsId(ev.target.value) },
                  e('option', { value: '' }, '选择工作区（在其下新建会话）…'),
                  wsList.map(w => e('option', { key: w.id, value: w.id }, w.title))),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setDispatchOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doDispatchConfirm, disabled: dispatching }, dispatching ? '派发中…' : '派发'))))
          : null,
          // 设置卡片（modal，居中，复用派发 modal 的 mask/modal 风格）：通用结构——标题「设置」+ 设置项行列表
          // （每行：左 label + 右控件）。以后加设置项只需往 settingsRows 数组加行，结构不变。
          // 交互：选择即保存（notes-settings-set）；点遮罩 / Esc 关闭（Esc 在全局 keydown 里优先关本卡片）。
          settingsOpen ? (() => {
            const modelList = (settingsData && settingsData.models) || []
            // 下拉选项 = provider/model 组合，第一项「跟随当前会话（默认）」；
            // 已保存值不在列表中（如模型已下线）时追加一项保证回显正确
            const selIdx = modelList.findIndex(m => m.provider === setLlmProvider && m.model === setLlmModel)
            const opts = (setLlmProvider && setLlmModel && selIdx < 0)
              ? modelList.concat([{ provider: setLlmProvider, model: setLlmModel, label: setLlmProvider + ' / ' + setLlmModel + '（已保存）' }])
              : modelList
            const curVal = selIdx >= 0 ? String(selIdx) : (opts.length > modelList.length ? String(opts.length - 1) : '')
            const llmControl = modelList.length
              ? e('select', { className: 'dsh-notes-settings-select', value: curVal, 'data-tooltip': '笔记自动分类 / 指令提取使用的模型', onChange: (ev) => {
                    const v = ev.target.value
                    if (v === '') { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) }
                    else { const m = opts[+v]; if (m) { setSetLlmProvider(m.provider); setSetLlmModel(m.model); saveSettingsLlm({ provider: m.provider, model: m.model }) } }
                  } },
                  e('option', { value: '' }, '跟随当前会话（默认）'),
                  opts.map((m, i) => e('option', { key: m.provider + '/' + m.model + '-' + i, value: String(i) }, m.label || (m.provider + ' / ' + m.model))))
              : e(React.Fragment, null,
                  e('input', { className: 'dsh-notes-settings-input', placeholder: 'provider', value: setLlmProvider, onChange: (ev) => setSetLlmProvider(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
                  e('input', { className: 'dsh-notes-settings-input', placeholder: 'model', value: setLlmModel, onChange: (ev) => setSetLlmModel(ev.target.value), onBlur: saveSettingsLlmManual, onKeyDown: (ev) => { if (ev.key === 'Enter') saveSettingsLlmManual() } }),
                  (setLlmProvider || setLlmModel) ? e('button', { className: 'dsh-notes-settings-clear', onClick: () => { setSetLlmProvider(''); setSetLlmModel(''); saveSettingsLlm(null) } }, '跟随当前会话（默认）') : null)
            // 目录注入总开关控件：checkbox 勾选即保存（catalogEnabled，缺省开）；label 挂 tooltip 说明注入形态
            const catalogControl = e('label', { className: 'dsh-notes-settings-checkwrap dsh-nt', 'data-tooltip': '向 Agent 系统提示注入笔记目录（一行一条），供其规划时参考并按需 note_get 取全文' },
              e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: setCatalog, onChange: (ev) => { const v = !!ev.target.checked; setSetCatalog(v); saveSettingsCatalog(v) } }),
              setCatalog ? '已开启' : '已关闭')
            // 数据区控件：导出全部（目录快照）/ 导入…（两步式预览后执行）；点击即关设置卡片、开各自对话框
            const dataControl = e(React.Fragment, null,
              e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '把整个笔记库（含 folders.json）快照到目标目录', onClick: openExport }, '导出全部'),
              e('button', { className: 'dsh-notes-settings-clear dsh-nt', 'data-tooltip': '从目录快照导入：先预览明细再执行，只增改不删、自动备份', onClick: openImport }, '导入…'))
            // 通用设置项行列表：以后加设置项只需往这里加行
            const settingsRows = [
              { key: 'llm', label: 'LLM 模型', sub: '笔记自动分类 / 指令提取使用的模型', control: llmControl },
              { key: 'catalog', label: '笔记目录注入', sub: '向 Agent 系统提示注入笔记目录（一行一条），供其规划时参考并按需 note_get 取全文', control: catalogControl },
              { key: 'data', label: '数据', sub: '全库目录快照导出 / 从快照目录导入（只增改不删，导入前自动全量备份）', control: dataControl },
            ]
            return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setSettingsOpen(false) } },
              e('div', { className: 'dsh-notes-settings-modal' },
                e('div', { className: 'dsh-notes-settings-modal-t' }, I('gear', 14), ' 设置'),
                e('div', { className: 'dsh-notes-settings-list' },
                  settingsRows.map(row => e('div', { key: row.key, className: 'dsh-notes-settings-row' },
                    e('div', { className: 'dsh-notes-settings-label' }, row.label, row.sub ? e('span', { className: 'dsh-notes-settings-label-s' }, row.sub) : null),
                    e('div', { className: 'dsh-notes-settings-control' }, row.control)))),
                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null))
          })()
          : null,
          // 导出对话框（侧栏底部「导出」/ 设置卡片「数据」区入口；mask/modal 复用设置卡片风格）：选目标目录 → notes-export → 成功 toast 含快照路径
          exportOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setExportOpen(false) } },
            e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
              e('div', { className: 'dsh-notes-settings-modal-t' }, I('up', 14), ' 导出全部笔记'),
              e('div', { className: 'dsh-notes-data-hint' }, '把整个笔记库（含 folders.json）完整快照到目标目录下的 dsh-notes-export-<时间戳> 子目录，不打包不压缩，目录即格式。'),
              e('input', { className: 'dsh-notes-data-input', placeholder: '目标目录，如 D:\\backup 或桌面路径…', value: exportDir, autoFocus: true, onChange: (ev) => setExportDir(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doExport() } } }),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setExportOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doExport, disabled: exportPending || !exportDir.trim() }, exportPending ? '导出中…' : '导出'))))
          : null,
          // 导入对话框（两步式）：第一步选目录 → notes-import-preview 预览明细（新增/相同/不同 + 文件夹合并统计）；
          // 第二步勾选「覆盖内容不同的笔记」（默认不勾）→ danger 按钮执行 notes-import → toast 含备份目录提示 → 刷新列表/文件夹
          importOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setImportOpen(false) } },
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
          : null,
          // 新建笔记 modal（侧栏「新建」chip / Ctrl+N）：输标题创建 → 选中 → 聚焦正文
          newNoteOpen ? e('div', { className: 'dsh-notes-newnote-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setNewNoteOpen(false) } },
            e('div', { className: 'dsh-notes-newnote-modal' },
              e('div', { className: 'dsh-notes-newnote-t' }, '新建笔记'),
              e('input', { ref: newNoteInputRef, className: 'dsh-notes-newnote-input', placeholder: '笔记标题…', value: newNoteTitle, onChange: (ev) => setNewNoteTitle(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateNote() } } }),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-newnote-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setNewNoteOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doCreateNote, disabled: newNotePending || !newNoteTitle.trim() }, newNotePending ? '创建中…' : '创建'))))
          : null,
          // 笔记行右键菜单：置顶/已解决/移动到文件夹/删除（纯文字标签 + SVG 图标面板内统一风格）
          ctxMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' } },
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'pinned' ? 'active' : 'pinned') }, I('pin', 12), ctxMenu.note.status === 'pinned' ? '取消置顶' : '置顶'),
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'resolved' ? 'active' : 'resolved') }, I('check', 12), ctxMenu.note.status === 'resolved' ? '重开' : '标记已解决'),
            // 移动到文件夹：点击内联展开子菜单（文件夹列表 + 移出 + 新建），避免二级浮层被面板 overflow:hidden 裁切
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => setCtxMenu({ x: ctxMenu.x, y: ctxMenu.y, note: ctxMenu.note, moveOpen: !ctxMenu.moveOpen }) }, I('folder', 12), '移动到文件夹' + (ctxMenu.moveOpen ? ' ▾' : ' ▸')),
            ctxMenu.moveOpen ? e(React.Fragment, null,
              folders.map(f => e('button', { key: f.id, className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => ctxMoveToFolder(ctxMenu.note, f.id) }, ((ctxMenu.note.folder || '') === f.id ? '✓ ' : '') + f.name)),
              (ctxMenu.note.folder || '') ? e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => ctxMoveToFolder(ctxMenu.note, '') }, '移出文件夹（未分类）') : null,
              ctxMenu.newFolder
                ? e('input', { className: 'dsh-notes-ctxmenu-input', placeholder: '新文件夹名…', value: ctxNewFolderText, autoFocus: true, onChange: (ev) => setCtxNewFolderText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ctxCreateFolderMove(ctxMenu.note) } } })
                : e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => setCtxMenu({ x: ctxMenu.x, y: ctxMenu.y, note: ctxMenu.note, moveOpen: true, newFolder: true }) }, '新建文件夹…'))
            : null,
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => { setCtxMenu(null); doDelete(ctxMenu.note.id) } }, I('trash', 12), '删除'))
          : null,
          // 文件夹项右键菜单：重命名 / 上移 / 下移 / 删除（管理全走 notes-folders RPC）
          folderMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: folderMenu.x + 'px', top: folderMenu.y + 'px' } },
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { setRenamingId(folderMenu.folder.id); setRenameText(folderMenu.folder.name); setFolderMenu(null) } }, '重命名'),
            e('button', { className: 'dsh-notes-ctxmenu-item', disabled: folderMenuIdx <= 0, onClick: () => doReorderFolder(folderMenu.folder, -1) }, '上移'),
            e('button', { className: 'dsh-notes-ctxmenu-item', disabled: folderMenuIdx < 0 || folderMenuIdx >= folders.length - 1, onClick: () => doReorderFolder(folderMenu.folder, 1) }, '下移'),
            e('div', { className: 'dsh-notes-ctxmenu-sep' }),
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => doDeleteFolder(folderMenu.folder) }, '删除文件夹'))
          : null)
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-panel', order: 200 }, (props) => e(FloatingPanel, props))
    })
    if (typeof d3 === 'function') disposers.push(d3)
    const d4 = slots.inject('shell.overlay', () => {
      // ===== 快速记录卡片 v2（原型 SelectionCapture 重做）：头部（选区速记 + 识别为引用徽章）→ 选区预览 → 补充输入 → 复制/记录/取消 =====
      // 触发链路不变：selectionchange + mouseup；提交链路不变：notes-quick-instruct（备注非空）/ notes-quick（kind=quote）
      function SelectionCapture() {
        perf.selRender++
        const [cap, setCap] = React.useState(null)   // 卡片位置（null=隐藏）
        const [toast, setToast] = React.useState('')
        const [instrText, setInstrText] = React.useState('')
        const selTextRef = React.useRef('')
        const visibleRef = React.useRef(false)
        const instrRef = React.useRef(null)
        React.useEffect(() => { toastEmit = setToast; return () => { if (toastEmit === setToast) toastEmit = null } }, [])
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
        React.useEffect(() => { if (!toast) return; const d = timer.timeout(() => setToast(''), 2600); return () => d() }, [toast])
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
              if (res.error) { setToast('记录失败：' + res.error) }
              else { setToast(res.merged ? '已合并到本次速记' : '已记录，正在识别主题…'); notifyNotesChanged() }
            } else {
              // 备注非空 → LLM 提取元数据，按返回结果 toast
              const res = await rpc('notes-quick-instruct', { text: text, note: note, sessionId: currentSessionId })
              if (res.error) { setToast('记录失败：' + res.error) }
              else if (res.ok && res.applied) {
                const a = res.applied
                let msg = '已记录'
                if (a.inject) msg = '已记录并注入为上下文（' + (a.injectRole === 'reference' ? '资料' : '约定') + '）'
                else if (a.tags && a.tags.length) msg = '已记录并标记 #' + a.tags.join(' #')
                else if (a.kind && a.kind !== 'note' && a.kind !== 'quote') msg = '已记录为' + (KIND_LABELS[a.kind] || a.kind)
                else msg = res.merged ? '已合并到本次速记' : '已记录，正在识别主题…'
                setToast(msg); notifyNotesChanged()
              } else {
                setToast(res.merged ? '已合并到本次速记' : '已记录，正在识别主题…'); notifyNotesChanged()
              }
            }
          } catch (err) { setToast('记录失败：' + String(err.message || err)) }
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
            setToast('已复制选区')
            visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges()
          } catch (err) { setToast('复制失败') }
        }
        function copySelection() {
          var text = selTextRef.current
          if (!text) { setToast('无选区可复制'); return }
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () {
                setToast('已复制选区')
                visibleRef.current = false; setCap(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges()
              }, function () { fallbackCopy(text) })
              return
            }
          } catch (err) {}
          fallbackCopy(text)
        }
        return e('div', null, cap ? e('div', { className: 'dsh-notes-cap', style: { left: cap.x + 'px', top: cap.y + 'px' } },
          e('div', { className: 'dsh-notes-cap-h' },
            e('span', { className: 'dsh-notes-cap-src' }, I('note', 11), '选区速记'),
            e('span', { className: 'dsh-notes-cap-auto' }, e('span', { className: 'dot' }), '识别为 引用')),
          e('div', { className: 'dsh-notes-cap-pv' }, previewText(selTextRef.current)),
          e('div', { className: 'dsh-notes-cap-in' },
            I('plus', 12),
            e('input', { ref: instrRef, className: 'dsh-notes-cap-input', type: 'text', placeholder: '可补充：打标签/引导标题/定类型/注入为上下文…直接回车则仅记录', value: instrText, onChange: function (ev) { setInstrText(ev.target.value) }, onKeyDown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); submit() } else if (ev.key === 'Escape') { ev.preventDefault(); cancel() } } }),
            e('span', { className: 'dsh-notes-kbd' }, 'Enter 记录')),
          e('div', { className: 'dsh-notes-cap-acts' },
            e('button', { className: 'dsh-notes-cbtn', onClick: copySelection }, I('note', 12), '复制'),
            e('button', { className: 'dsh-notes-cbtn primary', onClick: submit }, I('check', 12), '记录'),
            e('button', { className: 'dsh-notes-cbtn', onClick: cancel }, '取消')
          )
        ) : null, e('div', { className: 'dsh-notes-toast' + (toast ? ' show' : '') }, toast))
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-selection', order: 201 }, () => e(SelectionCapture))
    })
    if (typeof d4 === 'function') disposers.push(d4)
    ctx.effect(() => () => { for (const d of disposers) { try { d() } catch (e2) {} } })
    console.log('notes plugin: client ready')
    }

    // inject 声明 apply 用到的全部服务（slots/timer/sessions/workspaces），
    // 保证 Cordis 在服务就绪后才激活 apply；apply 内仍保留 ctx.get + 存在性守卫做双保险。
    module.exports = { name: 'dsh-notes-plugin', inject: ['slots', 'timer', 'sessions', 'workspaces'], apply: apply }
    return module.exports
  }
})
