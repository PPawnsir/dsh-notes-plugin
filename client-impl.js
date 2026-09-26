return {
  inject: ['timer', 'sessions', 'workspaces'],
  apply(ctx) {
    const timer = ctx.timer
    const sessions = ctx.sessions
    const workspaces = ctx.workspaces
    const slots = ctx.get('slots')
    if (!slots) { console.error('notes plugin: slots unavailable'); return }
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
    loadEntryState()
    const PRESET_TOPICS = ['需求', '设计', '开发', '调试', '运维', '调研', '其他']
    const PAGE_SIZE = 50
    const KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用' }
    const KIND_ICONS = { note: '○', decision: '◆', todo: '☑', link: '↗', quote: '❝' }
    const shortSid = (sid) => sid ? String(sid).replace(/^session-/, '').slice(0, 8) : ''
    const notify = () => listeners.forEach(fn => fn({ panelOpen }))
    const notifyNotesChanged = () => noteRefreshListeners.forEach(fn => fn())
    const e = React.createElement
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
    try {
      const origCall = host.call.bind(host)
      host.call = (m, a) => { perf.hostCall++; const t0 = now(); return origCall(m, a).then(r => { perf.hostCallMs += now() - t0; return r }, err => { perf.hostCallMs += now() - t0; throw err }) }
    } catch (e2) {}
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
    // 每 30s 把计数器推给 host，汇总写入 perf-report.json
    try { const pd = timer.interval(() => { try { host.call('notes-perf', { perf: JSON.parse(JSON.stringify(perf)) }) } catch (e2) {} }, 30000); disposers.push(pd) } catch (e2) {}
    // 样式从 host 拉取（styles.css 独立文件）：避免内嵌超长 CSS 字符串在 define 传输中被截断
    let cssLoaded = false
    let cssTries = 0
    function loadCss() {
      host.call('notes-css').then(res => {
        if (res && res.css) { cssLoaded = true; const d = styles.insert(res.css); if (typeof d === 'function') disposers.push(d) }
        else scheduleCssRetry()
      }).catch(scheduleCssRetry)
    }
    function scheduleCssRetry() { if (!cssLoaded && ++cssTries <= 10) { const d = timer.timeout(loadCss, 1200); disposers.push(d) } }
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
        return e('button', { className: 'dsh-notes-hdr-btn dsh-nt' + (panelOpen ? ' active' : ''), onClick: () => { panelOpen = !panelOpen; notify() }, 'data-tooltip': '智能笔记' }, e('span', { className: 'dsh-notes-hdr-ic' }, '✎'), e('span', null, '智能笔记'))
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
        return e('button', { className: 'dsh-notes-fab dsh-nt' + (panelOpen ? ' active' : ''), style: { left: pos.x + 'px', top: pos.y + 'px' }, onMouseDown, 'data-tooltip': '笔记' }, e('span', { className: 'dsh-notes-fab-ic' }, '✎'))
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
        const [edInject, setEdInject] = React.useState(false)
        const [edScope, setEdScope] = React.useState([])
        const [savedTick, setSavedTick] = React.useState(false)
        const [savedAt, setSavedAt] = React.useState(0)
        const [searchText, setSearchText] = React.useState('')
        const [searchIds, setSearchIds] = React.useState(null)
        const [loading, setLoading] = React.useState(false)
        const [error, setError] = React.useState('')
        const [pos, setPos] = React.useState({ x: null, y: null })
        const [size, setSize] = React.useState({ width: 560, height: 620 })
        const [listWidth, setListWidth] = React.useState(230)
        const [showHelp, setShowHelp] = React.useState(false)
        const [topicPickFor, setTopicPickFor] = React.useState(null)
        const [flashId, setFlashId] = React.useState(null)
        const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
        const [focusId, setFocusId] = React.useState(null)
        const [kindFilter, setKindFilter] = React.useState('all')
        const [pinnedOnly, setPinnedOnly] = React.useState(false)
        // T2 顶栏压缩：搜索框默认收起为图标，点击或快捷键内联展开
        const [searchOpen, setSearchOpen] = React.useState(false)
        // 新建笔记 modal（＋ 按钮 / Ctrl+N 打开，输标题创建）
        const [newNoteOpen, setNewNoteOpen] = React.useState(false)
        const [newNoteTitle, setNewNoteTitle] = React.useState('')
        const [newNotePending, setNewNotePending] = React.useState(false)
        const [sessList, setSessList] = React.useState([])
        const [scopeOpen, setScopeOpen] = React.useState(false)
        const [dispatchOpen, setDispatchOpen] = React.useState(false)
        const [activeSessions, setActiveSessions] = React.useState([])
        const [dispatching, setDispatching] = React.useState(false)
        const [dispatchMode, setDispatchMode] = React.useState('existing')  // existing=派发到活跃会话 / new=新建会话派发
        const [dispatchInstr, setDispatchInstr] = React.useState('')
        const [previewMode, setPreviewMode] = React.useState(false)   // 编辑/预览双态：默认编辑（textarea 行为不变）
        const [ctxMenu, setCtxMenu] = React.useState(null)   // 列表项右键菜单：{ x, y, note }（面板内坐标）或 null
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
        const keepQuickRef = React.useRef(false)
        const newNoteInputRef = React.useRef(null)   // 新建笔记 modal 标题输入框（打开自动聚焦）
        const edBodyDomRef = React.useRef(null)      // 正文 textarea DOM（新建笔记创建后聚焦）
        const timersRef = React.useRef([])
        const selectedRef = React.useRef(null)
        const dragRef = React.useRef(null)
        const dividerRef = React.useRef(null)
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
        const searchOpenRef = React.useRef(false)
        const newNoteOpenRef = React.useRef(false)   // 新建笔记 modal 镜像（Esc 优先关 modal）
        const ctxMenuRef = React.useRef(null)   // 右键菜单镜像（keydown 闭包读最新值）
        const settingsOpenRef = React.useRef(false)   // 设置卡片镜像（Esc 优先关设置卡片）
        // 自动保存：编辑字段的最新值 ref（debounce 回调读 ref 而非闭包 state，避免过期）
        const edTitleRef = React.useRef('')
        const edTopicRef = React.useRef('')
        const edTagsRef = React.useRef('')
        const edBodyRef = React.useRef('')
        const edKindRef = React.useRef('note')
        const edStatusRef = React.useRef('active')
        const edInjectRef = React.useRef(false)
        const edScopeRef = React.useRef([])
        const autoSaveRef = React.useRef(null)
        React.useEffect(() => { selectedRef.current = selected }, [selected])
        function later(fn, ms) { try { const d = timer.timeout(fn, ms); timersRef.current.push(d); return d } catch (err) { return null } }
        React.useEffect(() => {
          const arr = timersRef.current
          timersRef.current = []
          for (const d of arr) { try { d() } catch (err) {} }
        }, [])
        React.useEffect(() => { try { const saved = localStorage.getItem('dsh-notes-panel-state'); if (saved) { const s = JSON.parse(saved); if (s.x !== undefined && s.y !== undefined) setPos({ x: s.x, y: s.y }); if (s.width !== undefined && s.height !== undefined) setSize({ width: s.width, height: s.height }); if (s.listWidth !== undefined) setListWidth(Math.max(170, s.listWidth)) } } catch (err) {} }, [])
        function saveState() { try { localStorage.setItem('dsh-notes-panel-state', JSON.stringify({ x: pos.x, y: pos.y, width: size.width, height: size.height, listWidth })) } catch (err) {} }
        React.useEffect(() => { const fn = (s) => { if (s.panelOpen !== undefined) setOpen(s.panelOpen) }; listeners.add(fn); return () => listeners.delete(fn) }, [])
        // 注入范围下拉的会话列表：面板打开时 + 笔记数变化时刷新（新会话可能出现）
        React.useEffect(() => { if (!open) return; host.call('notes-sessions', {}).then(res => { if (res && res.sessions) setSessList(res.sessions) }).catch(() => {}) }, [open, notes.length])
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
        React.useEffect(() => { if (open && pos.x === null) { const w = window.innerWidth; const h = window.innerHeight; setPos({ x: Math.max(w - 620, w * 0.45), y: Math.max(56, (h - 620) / 2) }) } }, [open])
        // 搜索两段式：输入即本地过滤（标题/主题/标签/预览），250ms 防抖后 host 全文检索（含正文）补充
        // 用一次性注册的 timer.debounce：每击键调 timer.timeout 等于每击键在 fiber 上注册一次 ctx.effect，是持续簿记开销
        const searchRef = React.useRef('')
        const searchDebRef = React.useRef(null)
        React.useEffect(() => {
          const d = timer.debounce(() => {
            const qq = searchRef.current.trim()
            if (!qq) { setSearchIds(null); return }
            host.call('notes-search', { query: qq }).then(res => setSearchIds((res.notes || []).map(n => n.id))).catch(() => {})
          }, 250)
          searchDebRef.current = d
          return () => { if (d && d.dispose) d.dispose() }
        }, [])
        // 搜索条件变化时重置分页（新结果从头开始）
        React.useEffect(() => { setVisibleCount(PAGE_SIZE) }, [searchText, searchIds])
        // 展开态同步到 ref（keydown 闭包读 ref 避免过期）
        React.useEffect(() => { searchOpenRef.current = searchOpen }, [searchOpen])
        React.useEffect(() => { newNoteOpenRef.current = newNoteOpen }, [newNoteOpen])
        React.useEffect(() => { ctxMenuRef.current = ctxMenu }, [ctxMenu])
        React.useEffect(() => { settingsOpenRef.current = settingsOpen }, [settingsOpen])
        // 展开时自动聚焦（Ctrl+K → 搜索；Ctrl+N / ＋ → 新建笔记 modal 标题输入框，由此 effect 完成聚焦）
        React.useEffect(() => { if (searchOpen && searchInputRef.current) searchInputRef.current.focus() }, [searchOpen])
        React.useEffect(() => { if (newNoteOpen && newNoteInputRef.current) newNoteInputRef.current.focus() }, [newNoteOpen])
        // 键盘导航：j/k 或 ↑/↓ 移动高亮，Enter 打开，Esc 关闭，Ctrl+K 聚焦搜索，Ctrl+N 新建笔记
        React.useEffect(() => {
          function onKeyDown(ev) {
            if (!openRef.current) return
            const t = ev.target
            const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
            const mod = ev.ctrlKey || ev.metaKey
            if (mod && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); setSearchOpen(true); return }
            if (mod && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); openNewNoteRef.current(); return }
            if (ev.key === 'Escape') { ev.preventDefault(); if (newNoteOpenRef.current) { setNewNoteOpen(false); return } if (settingsOpenRef.current) { setSettingsOpen(false); return } if (ctxMenuRef.current) { setCtxMenu(null); return } if (searchOpenRef.current) { setSearchOpen(false); return } closeRef.current(); return }
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
            nw = Math.max(420, Math.min(window.innerWidth - 40, nw)); nh = Math.max(340, Math.min(window.innerHeight - 40, nh))
            if (direction.indexOf('w') >= 0) nx = ox + sw - nw
            if (direction.indexOf('n') >= 0) ny = oy + sh - nh
            setSize({ width: nw, height: nh }); setPos({ x: nx, y: ny })
          }, saveState)
        }
        function onDividerMouseDown(ev) {
          ev.preventDefault()
          const sx = ev.clientX, sw = listWidth
          drag((ev2) => setListWidth(Math.max(170, Math.min(400, sw + ev2.clientX - sx))), saveState)
        }
        // silent=true 时不显 loading（后台静默刷新，避免闪烁）
        async function loadNotes(silent) { if (!silent) setLoading(true); setError(''); let list = []; try { const res = await host.call('notes-list'); list = res.notes || []; setNotes(list) } catch (err) { setError(String(err.message || err)) } if (!silent) setLoading(false); return list }
        function selectNote(n) {
          setSelected(n.id); setFocusId(n.id); setEdTitle(n.title); setEdTopic(n.topic && n.topic !== '分类中' ? n.topic : '')
          keepQuickRef.current = (n.tags || []).indexOf('quick') >= 0
          setEdTags((n.tags || []).filter(t => t !== 'quick').join(', '))
          setEdKind(n.kind || 'note'); setEdStatus(n.status || 'active'); setEdInject(n.inject === true); setEdScope(n.injectTo || [])
          setEdBody(''); setTopicPickFor(null)
          // 列表是瘦身数据，正文按需加载
          const id = n.id
          host.call('notes-get', { id: id }).then(res => { if (res && res.note && selectedRef.current === id) setEdBody(res.note.body || '') }).catch(() => {})
        }
        // 新建笔记 modal：＋ 按钮 / Ctrl+N 打开（清空上次标题），输标题创建
        function openNewNote() { setNewNoteTitle(''); setNewNotePending(false); setError(''); setNewNoteOpen(true) }
        openNewNoteRef.current = openNewNote
        // 创建流程：notes-create → 静默刷新列表 → 选中新笔记 → 聚焦正文 textarea → toast
        async function doCreateNote() {
          const title = newNoteTitle.trim()
          if (!title || newNotePending) return
          setNewNotePending(true); setError('')
          try {
            const res = await host.call('notes-create', { title: title, body: '', kind: 'note' })
            if (res && res.error) { setError(res.error); return }
            setNewNoteOpen(false); setNewNoteTitle('')
            showToast('已创建')
            // 立即用创建返回值选中新笔记（不等列表刷新，避免列表时序影响选中链路）
            if (res && res.id) {
              selectNote({ id: res.id, title: res.title || title, topic: res.topic || '', kind: res.kind || 'note', status: res.status || 'active', tags: [], inject: false, injectTo: [] })
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
          const upd = { id: id, title: edTitleRef.current, tags: tags, body: edBodyRef.current, kind: edKindRef.current, status: edStatusRef.current, inject: edInjectRef.current, injectTo: edScopeRef.current }
          if ((edTopicRef.current || '').trim()) upd.topic = edTopicRef.current.trim()
          try {
            const res = await host.call('notes-update', upd)
            if (res && res.error) { setError(res.error); return }
            setSavedAt(Date.now())
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        async function doDelete(id) {
          if (!id) return
          setError('')
          try {
            const res = await host.call('notes-delete', { id: id })
            if (res.error) { setError(res.error); return }
            if (selected === id) { setSelected(null); setEdTitle(''); setEdTopic(''); setEdTags(''); setEdBody('') }
            showToast('已删除（可由 Agent 恢复）')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 列表项右键菜单：替代悬浮 × 按钮（打开即选中目标笔记，操作上下文明确）
        function openCtxMenu(ev, n) {
          ev.preventDefault(); ev.stopPropagation()
          const floatEl = ev.currentTarget.closest('.dsh-notes-floating')
          const rect = floatEl ? floatEl.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 500 }
          const mw = 160, mh = 116
          let x = ev.clientX - rect.left, y = ev.clientY - rect.top
          x = Math.max(4, Math.min(x, rect.width - mw - 4))
          y = Math.max(4, Math.min(y, rect.height - mh - 4))
          setCtxMenu({ x: x, y: y, note: n })
          selectNote(n)
        }
        async function ctxSetStatus(n, status) {
          setCtxMenu(null); setError('')
          try {
            const res = await host.call('notes-update', { id: n.id, status: status })
            if (res && res.error) { setError(res.error); return }
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 点击菜单外部关闭（Esc 在全局 keydown 里处理）
        React.useEffect(() => {
          if (!ctxMenu) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ctxmenu'))) setCtxMenu(null) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [ctxMenu])
        async function pickTopic(id, topic) {
          setTopicPickFor(null); setError('')
          try {
            const res = await host.call('notes-update', { id: id, topic: topic })
            if (res && res.error) { setError(res.error); return }
            if (selectedRef.current === id) setEdTopic(topic)
            await loadNotes(true)
          } catch (err) { setError(String(err.message || err)) }
        }
        function close() { panelOpen = false; notify() }
        function jumpToSession(sessionId) { if (sessions && sessionId) { try { sessions.open(sessionId) } catch (err) {} } }
        // 注入开关：独立字段 inject，不碰标签
        function toggleInject() { setEdInject(!edInject); triggerAutoSave() }
        // 范围多选：切换某个目标（global/workspace/会话短id）的选中态
        function toggleScope(key) {
          const cur = edScopeRef.current || []
          let next
          if (key === 'global') {
            // global 是排他的：选了 global 就清空其他
            next = cur.indexOf('global') >= 0 ? [] : ['global']
          } else {
            const withoutGlobal = cur.filter(t => t !== 'global')
            next = withoutGlobal.indexOf(key) >= 0 ? withoutGlobal.filter(t => t !== key) : withoutGlobal.concat([key])
          }
          setEdScope(next)
          triggerAutoSave()
        }
        // 任务派发：加载活跃会话/工作区 + 打开对话框 + 确认派发
        async function loadActiveSessions() {
          try { const res = await host.call('notes-active-sessions', {}); if (res && res.sessions) setActiveSessions(res.sessions) } catch (e) {}
        }
        async function loadWorkspaces() {
          try { const res = await host.call('notes-workspaces', {}); if (res && res.workspaces) setWsList(res.workspaces) } catch (e) {}
        }
        function openDispatch() {
          setDispatchInstr(''); setDispatchSessId(''); setDispatchSessWs(''); setDispatchWsId(''); setDispatchMode('existing'); setError('')
          loadActiveSessions(); loadWorkspaces(); setDispatchOpen(true)
        }
        // 设置卡片：打开即拉取 settings + 可用模型列表（host 探 llm 服务目录；探不到时 models=[]，控件退化为手输）
        function openSettings() {
          setSetLlmProvider(''); setSetLlmModel(''); setSettingsData(null); setError(''); setSettingsOpen(true)
          host.call('notes-settings-get', {}).then(res => {
            if (!res) return
            setSettingsData(res)
            const l = res.settings && res.settings.llm
            if (l && l.provider && l.model) { setSetLlmProvider(l.provider); setSetLlmModel(l.model) }
          }).catch(() => {})
        }
        // 选择即保存：llm=null 恢复跟随当前会话（默认）；否则保存 { provider, model }
        function saveSettingsLlm(llm) {
          host.call('notes-settings-set', { llm: llm }).then(res => {
            if (res && res.error) { setError(res.error); return }
            if (res && res.settings) setSettingsData(prev => Object.assign({}, prev || {}, { settings: res.settings }))
            showToast(llm ? ('已保存：笔记 LLM = ' + llm.provider + ' / ' + llm.model) : '已恢复跟随当前会话（默认）')
          }).catch(err => setError(String(err.message || err)))
        }
        // 手输模式（探不到模型列表时）：provider/model 两框齐备才保存；清除按钮恢复跟随会话
        function saveSettingsLlmManual() {
          const p = setLlmProvider.trim(), m = setLlmModel.trim()
          if (!p || !m) return
          saveSettingsLlm({ provider: p, model: m })
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
              const res = await host.call('notes-dispatch', { id: selected, sessionId: newSid, sessionName: (ws ? ws.title : '新会话'), workspace: ws ? ws.title : '', mode: 'new', instruction: dispatchInstr })
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
              const res = await host.call('notes-dispatch', { id: selected, sessionId: dispatchSessId, sessionName: sess ? sess.name : '', workspace: sess ? sess.workspace : '', mode: 'existing', instruction: dispatchInstr })
              if (res && res.error) { setError(res.error); setDispatching(false); return }
              showToast((sess && !sess.live ? '已打开并派发待办到「' : '已派发待办到「') + (sess ? sess.name : '') + '」（开始处理）')
            }
            setDispatchOpen(false); setDispatchInstr('')
            const g = await host.call('notes-get', { id: selected }); if (g && g.note) setEdBody(g.note.body || '')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) } finally { setDispatching(false) }
        }
        // 标记一条派发待办为完成（停止注入目标会话系统提示）
        async function doDispatchDone(origIndex) {
          try {
            const r = await host.call('notes-dispatch-done', { id: selected, dispatchIndex: origIndex })
            if (r && r.error) { setError(r.error); return }
            showToast('已标记完成'); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        async function doArchive() { setError(''); try { const res = await host.call('notes-archive'); if (res.error) { setError(res.error); return } showToast('归档完成：合并 ' + (res.merged || 0) + ' 组'); await loadNotes(true); notifyNotesChanged() } catch (err) { setError(String(err.message || err)) } }
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
        edInjectRef.current = edInject
        edScopeRef.current = edScope
        // 自动保存：debounce 只注册一次（null 时赋值），回调读 ref 避免闭包过期
        if (!autoSaveRef.current) autoSaveRef.current = timer.debounce(() => { if (selectedRef.current) doSave() }, 900)
        function triggerAutoSave() { if (autoSaveRef.current) autoSaveRef.current() }
        if (!open) return null
        function groupByTopic(list) { const map = new Map(); for (const n of list) { const t = n.topic || '未分类'; if (!map.has(t)) map.set(t, []); map.get(t).push(n) } return Array.from(map.entries()) }
        function highlight(text, q) { if (!q || !text) return text; const s = String(text); const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const parts = s.split(new RegExp('(' + esc + ')', 'gi')); if (parts.length === 1) return s; return parts.map((p, i) => i % 2 === 1 ? e('mark', { key: i, className: 'dsh-notes-mark' }, p) : p) }
        const q = searchText.trim().toLowerCase()
        const localFiltered = q ? notes.filter(n => { const hay = ((n.title || '') + ' ' + (n.preview || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ')).toLowerCase(); return hay.indexOf(q) >= 0 }) : notes
        // 搜索结果取 host 全文 + 本地即时的并集，RPC 失败/延迟时本地结果保底
        let filtered = searchIds ? notes.filter(n => searchIds.indexOf(n.id) >= 0 || localFiltered.indexOf(n) >= 0) : localFiltered
        // kind 筛选 + 置顶筛选
        if (kindFilter !== 'all') filtered = filtered.filter(n => (n.kind || 'note') === kindFilter)
        if (pinnedOnly) filtered = filtered.filter(n => n.status === 'pinned')
        // 懒加载分页：只渲染前 visibleCount 条，滚动到底再加载更多（避免笔记多时全量渲染 + 每条跑 highlight）
        const paged = filtered.slice(0, visibleCount)
        const hasMore = filtered.length > visibleCount
        pagedIdsRef.current = paged.map(n => n.id)
        function onListScroll(ev) {
          const el = ev.target
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) { setVisibleCount(c => c + PAGE_SIZE) }
        }
        // 注入范围文字：工作区 / 全局 / 会话名（查 sessList 拿名字，拿不到回退短 id）
        // 注入范围文字（injectTo 是多选数组）：[] = 本工作区；含 global = 全局；否则列出所选会话名
        function injectScopeLabel(injectTo) {
          const arr = injectTo || []
          if (arr.length === 0) return '本工作区'
          if (arr.indexOf('global') >= 0) return '全局'
          const names = arr.map(t => {
            if (t === 'workspace') return '本工作区'
            const s = sessList.find(x => x.short === t)
            return s ? s.name : ('会话 ' + t)
          })
          return names.join('、')
        }
        // Apple Notes 风格列表项：kind 图标 + 标题 + 时间单行；meta 行极简；删除 hover 显示
        function renderNoteItem(n) {
          const statusCls = (n.status === 'pinned' ? ' pinned' : '') + (n.status === 'resolved' ? ' resolved' : '') + (n.status === 'superseded' ? ' superseded' : '')
          const kindIc = KIND_ICONS[n.kind] || KIND_ICONS.note
          const isConv = n.inject === true
          const visTags = (n.tags || []).filter(t => t !== 'quick' && t !== 'convention')
          // meta 行：⚡注入徽章（约定笔记，最前）+ 主题 + 会话 + 其他标签
          const metaEls = []
          if (isConv) metaEls.push(e('span', { className: 'dsh-note-inject dsh-nt', 'data-tooltip': '注入为约定 · 范围：' + injectScopeLabel(n.injectTo) }, '⚡ ' + injectScopeLabel(n.injectTo)))
          if (n.topic && n.topic !== '分类中') metaEls.push(e('span', { className: 'dsh-note-meta-topic' }, n.topic))
          if (n.sessionId) metaEls.push(e('span', { className: 'dsh-note-meta-sess' }, '会话 ' + shortSid(n.sessionId)))
          if (visTags.length) metaEls.push(e('span', { className: 'dsh-note-meta-tags' }, visTags.join(' · ')))
          return e('div', { key: n.id, className: 'dsh-note-item' + (selected === n.id ? ' selected' : '') + (flashId === n.id ? ' flash' : '') + (focusId === n.id ? ' focused' : '') + statusCls, onClick: () => selectNote(n), onContextMenu: (ev) => openCtxMenu(ev, n), 'data-tooltip': n.title },
            e('div', { className: 'dsh-note-row' },
              e('span', { className: 'dsh-note-kind-ic dsh-note-kind-' + (n.kind || 'note') }, kindIc),
              e('span', { className: 'dsh-note-title' }, e('span', { className: 'dsh-note-title-text' }, highlight(n.title, q))),
              e('span', { className: 'dsh-note-date' }, n.updatedAt ? n.updatedAt.slice(0, 10) : '')),
            metaEls.length ? e('div', { className: 'dsh-note-meta' }, metaEls) : null)
        }
        let listContent
        if (loading && notes.length === 0) listContent = e('div', { className: 'dsh-notes-loading' }, '加载中...')
        else if (filtered.length === 0) listContent = e('div', { className: 'dsh-notes-empty-state' },
          e('div', { className: 'dsh-notes-empty-ic' }, q ? '⌕' : '📝'),
          e('div', { className: 'dsh-notes-empty-t' }, q ? '无匹配结果' : '还没有笔记'),
          e('div', { className: 'dsh-notes-empty-s' }, q ? '换个关键词试试，或清空筛选' : '点上方 ＋ 按钮输入标题，创建第一条笔记'),
          !q ? e('button', { className: 'dsh-notes-empty-btn', onClick: openNewNote }, '记第一条') : null)
        else {
          listContent = []
          const pinned = paged.filter(n => n.status === 'pinned')
          const rest = paged.filter(n => n.status !== 'pinned')
          if (pinned.length) {
            listContent.push(e('div', { key: 'grp-pinned', className: 'dsh-notes-topic-header' }, e('span', null, '📌 置顶'), e('span', { className: 'dsh-notes-topic-count' }, pinned.length)))
            pinned.forEach(n => listContent.push(renderNoteItem(n)))
          }
          for (const [topic, topicNotes] of groupByTopic(rest)) {
            listContent.push(e('div', { key: 'topic-' + topic, className: 'dsh-notes-topic-header' }, e('span', null, topic === '分类中' ? '识别中' : topic), e('span', { className: 'dsh-notes-topic-count' }, topicNotes.length)))
            topicNotes.forEach(n => listContent.push(renderNoteItem(n)))
          }
        }
        // 是否注入为约定：由独立的 inject 布尔字段决定（不依赖标签）
        const isConvention = edInject
        // 当前选中笔记（详情区多处用）
        const curNote = notes.find(n => n.id === selected) || null
        const curDispatches = (curNote && curNote.dispatches) || []
        // 范围浮层：会话按工作区分组（两级：工作区 → 会话）
        const scopeByWs = {}
        for (const s of sessList) { const w = s.workspace || '其他'; if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push(s) }
        const scopeWsKeys = Object.keys(scopeByWs).sort()
        // 派发对话框：已有会话模式按工作区过滤活跃会话；新建会话模式选工作区
        const dispatchWsKeys = []
        const dispatchSessByWs = {}
        for (const s of activeSessions) { const w = s.workspace || '其他'; if (!dispatchSessByWs[w]) { dispatchSessByWs[w] = []; dispatchWsKeys.push(w) } dispatchSessByWs[w].push(s) }
        return e('div', { className: 'dsh-notes-floating', style: { left: (pos.x || 0) + 'px', top: (pos.y || 0) + 'px', width: size.width + 'px', height: size.height + 'px' } },
          e('div', { className: 'dsh-notes-titlebar dsh-nt', onMouseDown: onTitlebarMouseDown, 'data-tooltip': '拖拽移动窗口' },
            e('span', { className: 'dsh-notes-titlebar-title' }, '笔记'),
            e('span', { className: 'dsh-notes-titlebar-grip' }, '⋮⋮'),
            e('div', { className: 'dsh-notes-titlebar-actions' },
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setEntryMode(entryMode === 'header' ? 'fab' : 'header'), 'data-tooltip': '切换入口模式：会话头部 / 悬浮气泡' }, '⇄'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: openSettings, 'data-tooltip': '设置' }, '⚙'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: doArchive, 'data-tooltip': '归档合并：速记按会话、普通笔记按标签' }, '归档'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setShowHelp(!showHelp), 'data-tooltip': '使用说明' }, '?'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: close, 'data-tooltip': '关闭' }, '×'))),
          showHelp ? e('div', { className: 'dsh-notes-help-bubble' },
            e('button', { className: 'dsh-notes-help-close', onClick: () => setShowHelp(false) }, '×'),
            e('h4', null, '使用说明'),
            e('ul', null,
              e('li', null, '点 ', e('kbd', null, '＋'), ' 或按 ', e('kbd', null, 'Ctrl+N'), ' 输入标题新建笔记，创建后直接编辑正文'),
              e('li', null, '点 ', e('kbd', null, '⌕'), ' 图标展开搜索；选中页面文字后用 ＋ 记录'),
              e('li', null, '同一会话 10 分钟内的速记自动合并'),
              e('li', null, '点击笔记的主题标签可快速更换'),
              e('li', null, '点击标题跳转到来源会话'),
              e('li', null, '快捷键：', e('kbd', null, 'Ctrl+K'), ' 搜索、', e('kbd', null, 'Ctrl+N'), ' 新建、', e('kbd', null, 'j/k'), ' 或 ', e('kbd', null, '↑↓'), ' 移动、', e('kbd', null, 'Enter'), ' 打开、', e('kbd', null, 'Esc'), ' 关闭'),
              e('li', null, '「归档」整理：速记按会话、笔记按标签合并'),
              e('li', null, '删除是软删除，可让 Agent 恢复'))) : null,
          e('div', { className: 'dsh-notes-toolbar' },
            e('button', { className: 'dsh-notes-tool-btn dsh-nt' + (searchOpen ? ' on' : ''), onClick: () => setSearchOpen(!searchOpen), 'data-tooltip': '搜索笔记（Ctrl+K）' }, '⌕'),
            e('button', { className: 'dsh-notes-tool-btn dsh-nt', onClick: openNewNote, 'data-tooltip': '新建笔记（Ctrl+N）' }, '＋'),
            e('div', { className: 'dsh-notes-kinds' },
              ['all', 'note', 'decision', 'todo', 'link', 'quote'].map(k => e('button', { key: k, className: 'dsh-notes-kind-chip' + (kindFilter === k ? ' on' : ''), onClick: () => { setKindFilter(k); setVisibleCount(PAGE_SIZE) } }, k === 'all' ? '全部' : KIND_LABELS[k])),
              e('button', { className: 'dsh-notes-pin-toggle' + (pinnedOnly ? ' on' : ''), onClick: () => { setPinnedOnly(!pinnedOnly); setVisibleCount(PAGE_SIZE) }, 'data-tooltip': '只看置顶' }, '📌 置顶'))),
          searchOpen ? e('div', { className: 'dsh-notes-search dsh-notes-expand' },
            e('div', { className: 'dsh-notes-search-box' },
              e('span', { className: 'dsh-notes-search-icon' }, '⌕'),
              e('input', { ref: searchInputRef, className: 'dsh-notes-search-input', placeholder: '搜索笔记、标签、内容…', value: searchText, onChange: (ev) => { searchRef.current = ev.target.value; setSearchText(ev.target.value); setSearchIds(null); setVisibleCount(PAGE_SIZE); if (searchDebRef.current) searchDebRef.current() } })),
            e('button', { className: 'dsh-notes-expand-close dsh-nt', onClick: () => setSearchOpen(false), 'data-tooltip': '收起搜索' }, '×')) : null,
          e('div', { className: 'dsh-notes-content' },
            e('div', { className: 'dsh-notes-list', style: { width: listWidth + 'px' } },
              e('div', { className: 'dsh-notes-list-items', onScroll: onListScroll }, listContent, hasMore ? e('div', { className: 'dsh-notes-more' }, '继续滚动加载更多（已显示 ' + paged.length + ' / ' + filtered.length + '）') : null)),
            e('div', { className: 'dsh-notes-divider dsh-nt', onMouseDown: onDividerMouseDown, 'data-tooltip': '拖拽调整宽度' }),
            selected ? e('div', { className: 'dsh-notes-editor' },
              e('div', { className: 'dsh-notes-ed-head' },
                e('input', { className: 'dsh-notes-editor-title', placeholder: '标题', value: edTitle, onChange: (ev) => { setEdTitle(ev.target.value); triggerAutoSave() } }),
                e('div', { className: 'dsh-notes-ed-meta' },
                  e('select', { className: 'dsh-notes-ed-select dsh-notes-ed-kind-chip dsh-notes-ed-kind-' + edKind, value: edKind, onChange: (ev) => { setEdKind(ev.target.value); triggerAutoSave() }, 'data-tooltip': '笔记类型' },
                    e('option', { value: 'note' }, '笔记'),
                    e('option', { value: 'decision' }, '决策'),
                    e('option', { value: 'todo' }, '待办'),
                    e('option', { value: 'link' }, '链接'),
                    e('option', { value: 'quote' }, '引用')),
                  e('select', { className: 'dsh-notes-ed-select', value: edStatus, onChange: (ev) => { setEdStatus(ev.target.value); triggerAutoSave() }, 'data-tooltip': '状态' },
                    e('option', { value: 'active' }, '进行中'),
                    e('option', { value: 'pinned' }, '置顶'),
                    e('option', { value: 'resolved' }, '已解决'),
                    e('option', { value: 'superseded' }, '已取代')),
                  e('input', { className: 'dsh-notes-ed-topic', placeholder: '主题', value: edTopic, onChange: (ev) => { setEdTopic(ev.target.value); triggerAutoSave() }, 'data-tooltip': '主题' }),
                  e('input', { className: 'dsh-notes-ed-tags-input', placeholder: '标签，逗号分隔', value: edTags, onChange: (ev) => { setEdTags(ev.target.value); triggerAutoSave() }, 'data-tooltip': '标签（convention 表示工作区约定）' }),
                  (edTags || '').split(/[,，;；]/).map(function (s) { return s.trim() }).filter(Boolean).length
                    ? e('div', { className: 'dsh-notes-ed-tags-chips' },
                        (edTags || '').split(/[,，;；]/).map(function (s) { return s.trim() }).filter(Boolean)
                          .map(function (tag, i) { return e('span', { key: 'tag-' + i, className: 'dsh-notes-ed-tag-chip' }, tag) }))
                    : null,
                  e('div', { className: 'dsh-notes-ed-meta-right' },
                    e('button', { className: 'dsh-notes-ed-action dsh-notes-dispatch-btn dsh-nt', onClick: (ev) => { ev.stopPropagation(); openDispatch() }, 'data-tooltip': '派发待办到会话（可补充具体要求）' }, dispatching ? '…' : '▶ 派发'),
                    notes.find(n => n.id === selected) && notes.find(n => n.id === selected).sessionId ? e('button', { className: 'dsh-notes-ed-action dsh-nt', onClick: () => jumpToSession(notes.find(n => n.id === selected).sessionId), 'data-tooltip': '跳转到来源会话' }, '↗ 会话') : null,
                    e('button', { className: 'dsh-notes-ed-action' + (edStatus === 'pinned' ? ' on' : ''), onClick: () => { setEdStatus(edStatus === 'pinned' ? 'active' : 'pinned'); triggerAutoSave() }, 'data-tooltip': edStatus === 'pinned' ? '取消置顶' : '置顶' }, '📌'),
                    e('button', { className: 'dsh-notes-ed-action danger', onClick: () => doDelete(selected), 'data-tooltip': '删除（软删除，可恢复）' }, '🗑'))),
                e('div', { className: 'dsh-notes-ed-injectrow' },
                  e('button', { className: 'dsh-notes-ed-inject-btn dsh-nt' + (isConvention ? ' on' : ''), onClick: () => { toggleInject(); if (!isConvention) setScopeOpen(true) }, 'data-tooltip': '作为约定注入到系统提示（Agent 每回合可见）' }, isConvention ? '⚡ 注入中' : '注入为约定'),
                  isConvention ? e('div', { className: 'dsh-notes-ed-scope-wrap' },
                    e('button', { className: 'dsh-notes-scope-trigger dsh-nt', onClick: (ev) => { ev.stopPropagation(); setScopeOpen(!scopeOpen) }, 'data-tooltip': '选择注入范围（可多选）' },
                      injectScopeLabel(edScope), e('span', { className: 'dsh-notes-scope-caret' }, ' ▾')),
                    scopeOpen ? e('div', { className: 'dsh-notes-scope-panel' },
                      e('label', { className: 'dsh-notes-scope-item' }, e('input', { type: 'checkbox', checked: edScope.length === 0 || edScope.indexOf('workspace') >= 0, onChange: () => toggleScope('workspace') }), ' 本工作区'),
                      e('label', { className: 'dsh-notes-scope-item' }, e('input', { type: 'checkbox', checked: edScope.indexOf('global') >= 0, onChange: () => toggleScope('global') }), ' 全局（所有会话）'),
                      scopeWsKeys.length ? e('div', { className: 'dsh-notes-scope-sep' }, '指定会话') : null,
                      scopeWsKeys.map(ws => e('div', { key: ws, className: 'dsh-notes-scope-group' },
                        e('div', { className: 'dsh-notes-scope-ws' }, ws),
                        scopeByWs[ws].map(s => e('label', { key: s.id, className: 'dsh-notes-scope-item dsh-notes-scope-sess' },
                          e('input', { type: 'checkbox', checked: edScope.indexOf(s.short) >= 0, onChange: () => toggleScope(s.short) }),
                          ' ' + s.name)))))
                    : null)
                  : null)),
              curDispatches.length ? e('div', { className: 'dsh-notes-dispatch-history' + (dispatchHistoryOpen ? ' open' : ' collapsed') },
                e('div', { className: 'dsh-notes-dispatch-history-t', onClick: () => setDispatchHistoryOpen(!dispatchHistoryOpen), role: 'button', 'aria-expanded': dispatchHistoryOpen ? 'true' : 'false' },
                  (dispatchHistoryOpen ? '▼ ' : '▶ ') + '派发历史（' + curDispatches.length + '）'),
                dispatchHistoryOpen ? curDispatches.map((d, origIdx) => ({ d: d, origIdx: origIdx })).reverse().map(({ d, origIdx }) => e('div', { key: origIdx, className: 'dsh-notes-dispatch-rec' + (d.done ? ' done' : '') },
                  e('div', { className: 'dsh-notes-dispatch-rec-top' },
                    e('span', { className: 'dsh-notes-dispatch-rec-t' }, d.done ? '✓ ' + (d.sessionName || d.sessionId) : [e('span', { key: 'dot', className: 'dsh-notes-dispatch-dot' }), ' ' + (d.sessionName || d.sessionId)]),
                    e('span', { className: 'dsh-notes-dispatch-rec-m' }, (d.done ? '已完成 · ' : '待处理 · ') + (d.mode === 'new' ? '新会话' : (d.workspace || '已有会话')) + (d.at ? ' · ' + String(d.at).slice(5, 16).replace('T', ' ') : ''))),
                  d.instruction ? e('div', { className: 'dsh-notes-dispatch-rec-i' }, '要求：' + d.instruction) : null,
                  !d.done ? e('button', { className: 'dsh-notes-dispatch-done-btn', onClick: () => doDispatchDone(origIdx) }, '标记完成') : null)) : null)
              : null,
              previewMode
                ? e('div', { className: 'dsh-notes-preview-container', dangerouslySetInnerHTML: { __html: renderMarkdown(edBody) } })
                : e('textarea', { ref: edBodyDomRef, className: 'dsh-notes-editor-body', placeholder: '开始记录…（支持 Markdown）', value: edBody, onChange: (ev) => { setEdBody(ev.target.value); triggerAutoSave() } }),
              e('div', { className: 'dsh-notes-ed-foot' },
                e('button', { className: 'dsh-notes-preview-toggle dsh-nt' + (previewMode ? ' on' : ''), onClick: () => setPreviewMode(!previewMode), 'data-tooltip': previewMode ? '切换到编辑模式' : '预览 Markdown 渲染' }, previewMode ? '✎ 编辑' : '👁 预览'),
                e('span', { className: 'dsh-notes-ed-saved' + (savedAt ? ' show' : '') }, savedAt ? '已自动保存 ' + new Date(savedAt).toTimeString().slice(0, 5) : ''),
                e('span', null, (edBody || '').length + ' 字')))
            : e('div', { className: 'dsh-notes-editor-empty' },
                e('div', { className: 'dsh-notes-editor-empty-ic' }, '✎'),
                e('div', { className: 'dsh-notes-editor-empty-t' }, '选择一条笔记查看和编辑'),
                e('div', { className: 'dsh-notes-editor-empty-s' }, '点上方 ＋ 按钮输入标题，新建一条笔记'))),
          e('div', { className: 'dsh-notes-resize-handle dsh-nt', style: { position: 'absolute', bottom: 0, right: 0 }, onMouseDown: (ev) => onResizeMouseDown('se', ev), 'data-tooltip': '拖拽调整' }),
          error && !dispatchOpen ? e('div', { className: 'dsh-notes-error' }, error) : null,
          // 派发对话框（modal）：todo 上下文预览 + 补充具体要求 + 已有/新建会话（级联下拉）
          (dispatchOpen && curNote) ? e('div', { className: 'dsh-notes-dispatch-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setDispatchOpen(false) } },
            e('div', { className: 'dsh-notes-dispatch-modal' },
              e('div', { className: 'dsh-notes-dispatch-modal-t' }, '▶ 派发待办', e('span', { style: { fontSize: '10px', color: 'var(--nt3)', fontWeight: 400, marginLeft: '8px' } }, '工作区' + wsList.length + ' / 活跃会话' + activeSessions.length)),
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
                  (dispatchSessByWs[dispatchSessWs] || []).map(s => e('option', { key: s.id, value: s.id }, s.name + (s.live ? '' : '（未打开）')))))
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
            // 通用设置项行列表：以后加设置项只需往这里加行
            const settingsRows = [
              { key: 'llm', label: 'LLM 模型', sub: '笔记自动分类 / 指令提取使用的模型', control: llmControl },
            ]
            return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setSettingsOpen(false) } },
              e('div', { className: 'dsh-notes-settings-modal' },
                e('div', { className: 'dsh-notes-settings-modal-t' }, '⚙ 设置'),
                e('div', { className: 'dsh-notes-settings-list' },
                  settingsRows.map(row => e('div', { key: row.key, className: 'dsh-notes-settings-row' },
                    e('div', { className: 'dsh-notes-settings-label' }, row.label, row.sub ? e('span', { className: 'dsh-notes-settings-label-s' }, row.sub) : null),
                    e('div', { className: 'dsh-notes-settings-control' }, row.control)))),
                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null))
          })()
          : null,
          // 新建笔记 modal（＋ 按钮 / Ctrl+N）：输标题创建 → 选中 → 聚焦正文
          newNoteOpen ? e('div', { className: 'dsh-notes-newnote-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setNewNoteOpen(false) } },
            e('div', { className: 'dsh-notes-newnote-modal' },
              e('div', { className: 'dsh-notes-newnote-t' }, '新建笔记'),
              e('input', { ref: newNoteInputRef, className: 'dsh-notes-newnote-input', placeholder: '笔记标题…', value: newNoteTitle, onChange: (ev) => setNewNoteTitle(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateNote() } } }),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-newnote-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setNewNoteOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doCreateNote, disabled: newNotePending || !newNoteTitle.trim() }, newNotePending ? '创建中…' : '创建'))))
          : null,
          // 列表项右键菜单（替代悬浮 ×）：置顶/已解决/删除
          ctxMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' } },
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'pinned' ? 'active' : 'pinned') }, '📌 ' + (ctxMenu.note.status === 'pinned' ? '取消置顶' : '置顶')),
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'resolved' ? 'active' : 'resolved') }, '✓ ' + (ctxMenu.note.status === 'resolved' ? '重开' : '标记已解决')),
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => { setCtxMenu(null); doDelete(ctxMenu.note.id) } }, '🗑 删除'))
          : null)
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-panel', order: 200 }, (props) => e(FloatingPanel, props))
    })
    if (typeof d3 === 'function') disposers.push(d3)
    const d4 = slots.inject('shell.overlay', () => {
      function SelectionCapture() {
        perf.selRender++
        const [btn, setBtn] = React.useState(null)
        const [toast, setToast] = React.useState('')
        const [instrText, setInstrText] = React.useState('')
        const selTextRef = React.useRef('')
        const visibleRef = React.useRef(false)
        const instrRef = React.useRef(null)
        React.useEffect(() => { toastEmit = setToast; return () => { if (toastEmit === setToast) toastEmit = null } }, [])
        React.useEffect(() => {
          let mx = -1, my = -1, watchMouse = false, mouseDown = false
          function hide() { if (visibleRef.current) { visibleRef.current = false; setBtn(null) } }
          function onMouseMove(ev) { if (!watchMouse) return; mx = ev.clientX; my = ev.clientY; perf.mousemoveTracked++ }
          function showFromSelection() {
            perf.selShowEval++
            const s0 = now()
            try {
              const sel = window.getSelection()
              const text = sel ? sel.toString().trim() : ''
              // 框已展开时，选区被点击清空（如点输入框）不关闭——只有框未展开且无选区才 hide
              if (!text || text.length < 2) { if (!visibleRef.current) hide(); return }
              let x, y
              if (mx >= 0) {
                x = mx - 160
                y = my + 14
              } else {
                let rect
                try { if (sel.rangeCount > 0) rect = sel.getRangeAt(0).getBoundingClientRect() } catch (err) {}
                if (rect && !(rect.width === 0 && rect.height === 0)) {
                  x = rect.left + rect.width / 2 - 160
                  y = rect.bottom + 8
                } else { hide(); return }
              }
              x = Math.min(Math.max(8, x), Math.max(60, window.innerWidth - 340))
              y = Math.min(Math.max(8, y), Math.max(60, window.innerHeight - 200))
              selTextRef.current = text
              visibleRef.current = true
              // 位置没有实质变化时不触发重渲染
              setBtn(prev => (prev && Math.abs(prev.x - x) < 2 && Math.abs(prev.y - y) < 2) ? prev : { x, y })
            } catch (err) {}
            finally { perf.selShowMs += now() - s0 }
          }
          // 一次性注册的防抖器：timer.timeout 每次调用都会在 fiber 上注册 ctx.effect，击键频率下是持续簿记开销
          const debouncedShow = timer.debounce(showFromSelection, 140)
          function onSelectionChange() {
            perf.selChange++
            const sc0 = now()
            try {
              // 指令框已展开时保持稳定：避免聚焦输入框导致选区收起而误关（文本已在 selTextRef）
              if (visibleRef.current) return
              // 快速路径：光标态（无选区）直接跳过，不创建任何定时器——聊天输入框每次击键都触发本事件
              let collapsed = true
              let sel = null
              try { sel = window.getSelection(); collapsed = !sel || sel.isCollapsed } catch (err) {}
              if (collapsed) { perf.selCollapsedSkip++; watchMouse = false; hide(); return }
              // 记录当前选区文本（供 mouseup 弹框预览与提交使用，提交不依赖实时选区）
              try { selTextRef.current = sel ? sel.toString().trim() : '' } catch (err) {}
              watchMouse = true
              // 鼠标拖拽中：只记录选区文本与跟踪坐标，等 mouseup 才弹框（避免拖拽中途弹出打断选区）
              if (mouseDown) return
              // 键盘选择（无鼠标按下）：正常防抖弹框
              debouncedShow()
            } finally { perf.selChangeMs += now() - sc0 }
          }
          function onMouseDown(ev) {
            if (ev.target.closest && ev.target.closest('.dsh-notes-instruct-box')) return
            // 开始新一次拖拽：置位 mouseDown、停止旧坐标跟踪、隐藏旧指令框
            mouseDown = true; watchMouse = false; hide()
          }
          function onMouseUp(ev) {
            // 拖拽结束：清除 mouseDown；选区非折叠且文本≥2字符时弹框（校验在 showFromSelection 内部）
            mouseDown = false
            // 点击指令框内部（输入框/按钮）的 mouseup 不重新评估选区——否则点输入框清空选区后会误关框
            if (ev && ev.target && ev.target.closest && ev.target.closest('.dsh-notes-instruct-box')) return
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
        // 弹框后不自动 focus 输入框：focus 会清除页面选区，打断拖拽并使选区丢失。
        // 选区文本已存于 selTextRef，提交不依赖实时选区；用户需备注时手动点击输入框（自然 focus）。
        // 选区预览：截断至 3 行 / 120 字符，避免指令框过高
        function previewText(text) { if (!text) return ''; const lines = String(text).split(/\n/).slice(0, 3).join(' '); return lines.length > 120 ? lines.slice(0, 120) + '…' : lines }
        async function submit() {
          const text = selTextRef.current
          const note = instrText.trim()
          visibleRef.current = false; setBtn(null); setInstrText('')
          if (window.getSelection()) window.getSelection().removeAllRanges()
          if (!text) return
          try {
            if (!note) {
              // 备注为空 → 现有逻辑（行为不变）
              const res = await host.call('notes-quick', { text: text, sessionId: currentSessionId, kind: 'quote' })
              if (res.error) { setToast('记录失败：' + res.error) }
              else { setToast(res.merged ? '已合并到本次速记' : '已记录，正在识别主题…'); notifyNotesChanged() }
            } else {
              // 备注非空 → LLM 提取元数据，按返回结果 toast
              const res = await host.call('notes-quick-instruct', { text: text, note: note, sessionId: currentSessionId })
              if (res.error) { setToast('记录失败：' + res.error) }
              else if (res.ok && res.applied) {
                const a = res.applied
                let msg = '已记录'
                if (a.inject) msg = '已记录并设为约定'
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
        function cancel() { visibleRef.current = false; setBtn(null); setInstrText(''); if (window.getSelection()) window.getSelection().removeAllRanges() }
        // 复制选区文本到剪贴板：优先 navigator.clipboard，不可用/失败时降级 execCommand；不关浮层不清选区
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
          } catch (err) { setToast('复制失败') }
        }
        function copySelection() {
          var text = selTextRef.current
          if (!text) { setToast('无选区可复制'); return }
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () { setToast('已复制选区') }, function () { fallbackCopy(text) })
              return
            }
          } catch (err) {}
          fallbackCopy(text)
        }
        return e('div', null, btn ? e('div', { className: 'dsh-notes-instruct-box', style: { left: btn.x + 'px', top: btn.y + 'px' } },
          e('div', { className: 'dsh-notes-instruct-preview' }, previewText(selTextRef.current)),
          e('input', { ref: instrRef, className: 'dsh-notes-instruct-input', type: 'text', placeholder: '可补充：打标签/引导标题/定类型/设为约定…直接回车则仅记录', value: instrText, onChange: function (ev) { setInstrText(ev.target.value) }, onKeyDown: function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); submit() } else if (ev.key === 'Escape') { ev.preventDefault(); cancel() } } }),
          e('div', { className: 'dsh-notes-instruct-actions' },
            e('button', { className: 'dsh-notes-instruct-btn', onClick: copySelection }, '复制'),
            e('button', { className: 'dsh-notes-instruct-btn primary', onClick: submit }, '记录'),
            e('button', { className: 'dsh-notes-instruct-btn', onClick: cancel }, '取消')
          )
        ) : null, e('div', { className: 'dsh-notes-toast' + (toast ? ' show' : '') }, toast))
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-selection', order: 201 }, () => e(SelectionCapture))
    })
    if (typeof d4 === 'function') disposers.push(d4)
    ctx.effect(() => () => { for (const d of disposers) { try { d() } catch (e2) {} } })
    console.log('notes plugin: client ready')
  }
}
