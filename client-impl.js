return {
  inject: ['timer', 'sessions'],
  apply(ctx) {
    const timer = ctx.timer
    const sessions = ctx.sessions
    const slots = ctx.get('slots')
    if (!slots) { console.error('notes plugin: slots unavailable'); return }
    const disposers = []
    const listeners = new Set()
    const noteRefreshListeners = new Set()
    let panelOpen = false
    let currentSessionId = ''
    let toastEmit = null
    function showToast(msg) { try { if (toastEmit) toastEmit(msg) } catch (e) {} }
    const PRESET_TOPICS = ['需求', '设计', '开发', '调试', '运维', '调研', '其他']
    const PAGE_SIZE = 50
    const KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用' }
    const KIND_ICONS = { note: '○', decision: '◆', todo: '☑', link: '↗', quote: '❝' }
    const shortSid = (sid) => sid ? String(sid).replace(/^session-/, '').slice(0, 8) : ''
    const notify = () => listeners.forEach(fn => fn({ panelOpen }))
    const notifyNotesChanged = () => noteRefreshListeners.forEach(fn => fn())
    const e = React.createElement
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
        const [count, setCount] = React.useState(0)
        if (props && props.sessionId) currentSessionId = props.sessionId
        const refresh = () => { host.call('notes-list').then(res => setCount((res.notes || []).length)).catch(() => {}) }
        React.useEffect(refresh, [])
        React.useEffect(() => { noteRefreshListeners.add(refresh); return () => noteRefreshListeners.delete(refresh) }, [])
        return e('button', { className: 'dsh-notes-hdr-btn dsh-nt' + (panelOpen ? ' active' : ''), onClick: () => { panelOpen = !panelOpen; notify() }, 'data-tooltip': '笔记' }, e('span', null, '笔记'), count > 0 ? e('span', { className: 'dsh-notes-hdr-btn-badge' }, count) : null)
      }
      slots.register({ name: 'conversation.session.header.actions', id: 'dsh-notes-btn', order: 40 }, (props) => e(HeaderBtn, props))
    })
    if (typeof d1 === 'function') disposers.push(d1)
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
        const [capText, setCapText] = React.useState('')
        const [capPending, setCapPending] = React.useState(false)
        const [capSaved, setCapSaved] = React.useState(false)
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
        const [sessList, setSessList] = React.useState([])
        const [scopeOpen, setScopeOpen] = React.useState(false)
        const [dispatchOpen, setDispatchOpen] = React.useState(false)
        const [activeSessions, setActiveSessions] = React.useState([])
        const [dispatching, setDispatching] = React.useState(false)
        const keepQuickRef = React.useRef(false)
        const capRef = React.useRef(null)
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
        // 派发浮层：点击外部关闭
        React.useEffect(() => {
          if (!dispatchOpen) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ed-dispatch-wrap'))) setDispatchOpen(false) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [dispatchOpen])
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
        // 键盘导航：j/k 或 ↑/↓ 移动高亮，Enter 打开，Esc 关闭，Ctrl+K 聚焦搜索，Ctrl+N 聚焦捕获
        React.useEffect(() => {
          function onKeyDown(ev) {
            if (!openRef.current) return
            const t = ev.target
            const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
            const mod = ev.ctrlKey || ev.metaKey
            if (mod && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); if (searchInputRef.current) searchInputRef.current.focus(); return }
            if (mod && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); if (capRef.current) capRef.current.focus(); return }
            if (ev.key === 'Escape') { ev.preventDefault(); closeRef.current(); return }
            if (inField) return
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
        function syncTopicLater(id) {
          const check = async () => { const list = await loadNotes(true); const n = list.find(x => x.id === id); if (n && n.topic && n.topic !== '分类中') setEdTopic(prev => (prev === '' && selectedRef.current === id) ? n.topic : prev) }
          later(check, 3800)
          later(check, 8500)
        }
        async function doCapture() {
          const text = capText.trim()
          if (!text || capPending) return
          setCapPending(true); setError('')
          try {
            const res = await host.call('notes-quick', { text: text, sessionId: currentSessionId })
            if (res && res.error) { setError(res.error); return }
            setCapText('')
            if (capRef.current) { capRef.current.style.height = '38px'; capRef.current.focus() }
            setCapSaved(true); later(() => setCapSaved(false), 1600)
            showToast(res && res.merged ? '已合并到本次速记' : '已记录，正在识别主题…')
            if (res && res.id) { setFlashId(res.id); later(() => setFlashId(null), 1800) }
            const list = await loadNotes(true)
            if (res && res.id) { const n = list.find(x => x.id === res.id); if (n) selectNote(n); syncTopicLater(res.id) }
            notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) } finally { setCapPending(false) }
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
        // 任务派发：加载活跃会话 + 派发待办到目标会话
        async function loadActiveSessions() {
          try { const res = await host.call('notes-active-sessions', {}); if (res && res.sessions) setActiveSessions(res.sessions) } catch (e) {}
        }
        async function doDispatch(sess) {
          if (!selected || dispatching) return
          setDispatching(true); setDispatchOpen(false); setError('')
          try {
            const res = await host.call('notes-dispatch', { id: selected, sessionId: sess.id, sessionName: sess.name })
            if (res && res.error) { setError(res.error); return }
            showToast('已派发到「' + sess.name + '」')
            const g = await host.call('notes-get', { id: selected }); if (g && g.note) setEdBody(g.note.body || '')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) } finally { setDispatching(false) }
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
          return e('div', { key: n.id, className: 'dsh-note-item' + (selected === n.id ? ' selected' : '') + (flashId === n.id ? ' flash' : '') + (focusId === n.id ? ' focused' : '') + statusCls, onClick: () => selectNote(n), 'data-tooltip': n.title },
            e('div', { className: 'dsh-note-row' },
              e('span', { className: 'dsh-note-kind-ic dsh-note-kind-' + (n.kind || 'note') }, kindIc),
              e('span', { className: 'dsh-note-title' }, e('span', { className: 'dsh-note-title-text' }, highlight(n.title, q))),
              e('span', { className: 'dsh-note-date' }, n.updatedAt ? n.updatedAt.slice(0, 10) : '')),
            metaEls.length ? e('div', { className: 'dsh-note-meta' }, metaEls) : null,
            e('button', { className: 'dsh-note-delete dsh-nt', onClick: (ev) => { ev.stopPropagation(); doDelete(n.id) }, 'data-tooltip': '删除' }, '×'))
        }
        let listContent
        if (loading && notes.length === 0) listContent = e('div', { className: 'dsh-notes-loading' }, '加载中...')
        else if (filtered.length === 0) listContent = e('div', { className: 'dsh-notes-empty-state' },
          e('div', { className: 'dsh-notes-empty-ic' }, q ? '⌕' : '📝'),
          e('div', { className: 'dsh-notes-empty-t' }, q ? '无匹配结果' : '还没有笔记'),
          e('div', { className: 'dsh-notes-empty-s' }, q ? '换个关键词试试，或清空筛选' : '在上方输入框记点什么，主题会自动识别'),
          !q ? e('button', { className: 'dsh-notes-empty-btn', onClick: () => { if (capRef.current) capRef.current.focus() } }, '记第一条') : null)
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
        // 范围浮层：会话按工作区分组（两级：工作区 → 会话）
        const scopeByWs = {}
        for (const s of sessList) { const w = s.workspace || '其他'; if (!scopeByWs[w]) scopeByWs[w] = []; scopeByWs[w].push(s) }
        const scopeWsKeys = Object.keys(scopeByWs).sort()
        return e('div', { className: 'dsh-notes-floating', style: { left: (pos.x || 0) + 'px', top: (pos.y || 0) + 'px', width: size.width + 'px', height: size.height + 'px' } },
          e('div', { className: 'dsh-notes-titlebar dsh-nt', onMouseDown: onTitlebarMouseDown, 'data-tooltip': '拖拽移动窗口' },
            e('span', { className: 'dsh-notes-titlebar-title' }, '笔记'),
            e('span', { className: 'dsh-notes-titlebar-grip' }, '⋮⋮'),
            e('div', { className: 'dsh-notes-titlebar-actions' },
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: doArchive, 'data-tooltip': '归档合并：速记按会话、普通笔记按标签' }, '归档'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: () => setShowHelp(!showHelp), 'data-tooltip': '使用说明' }, '?'),
              e('button', { className: 'dsh-notes-titlebar-btn dsh-nt', onClick: close, 'data-tooltip': '关闭' }, '×'))),
          showHelp ? e('div', { className: 'dsh-notes-help-bubble' },
            e('button', { className: 'dsh-notes-help-close', onClick: () => setShowHelp(false) }, '×'),
            e('h4', null, '使用说明'),
            e('ul', null,
              e('li', null, '顶部输入框按 ', e('kbd', null, 'Enter'), ' 快速记录，主题自动识别'),
              e('li', null, '选中页面文字后点「快速记录」'),
              e('li', null, '同一会话 10 分钟内的速记自动合并'),
              e('li', null, '点击笔记的主题标签可快速更换'),
              e('li', null, '点击标题跳转到来源会话'),
              e('li', null, '快捷键：', e('kbd', null, 'Ctrl+K'), ' 搜索、', e('kbd', null, 'Ctrl+N'), ' 新建、', e('kbd', null, 'j/k'), ' 或 ', e('kbd', null, '↑↓'), ' 移动、', e('kbd', null, 'Enter'), ' 打开、', e('kbd', null, 'Esc'), ' 关闭'),
              e('li', null, '「归档」整理：速记按会话、笔记按标签合并'),
              e('li', null, '删除是软删除，可让 Agent 恢复'))) : null,
          e('div', { className: 'dsh-notes-capture' },
            e('textarea', { ref: capRef, className: 'dsh-notes-capture-input', placeholder: '记点什么…（Enter 保存，Shift+Enter 换行）', value: capText, rows: 1,
              onChange: (ev) => { setCapText(ev.target.value); const t = ev.target; t.style.height = 'auto'; t.style.height = Math.min(110, Math.max(38, t.scrollHeight)) + 'px' },
              onKeyDown: (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); doCapture() } } }),
            e('button', { className: 'dsh-notes-capture-btn dsh-nt' + (capSaved ? ' saved' : ''), onClick: doCapture, disabled: capPending || !capText.trim(), 'data-tooltip': '保存这条记录' }, capPending ? '…' : (capSaved ? '✓' : '记录'))),
          e('div', { className: 'dsh-notes-search' },
            e('div', { className: 'dsh-notes-search-box' },
              e('span', { className: 'dsh-notes-search-icon' }, '⌕'),
              e('input', { ref: searchInputRef, className: 'dsh-notes-search-input', placeholder: '搜索笔记、标签、内容…', value: searchText, onChange: (ev) => { searchRef.current = ev.target.value; setSearchText(ev.target.value); setSearchIds(null); setVisibleCount(PAGE_SIZE); if (searchDebRef.current) searchDebRef.current() } })),
            e('button', { className: 'dsh-notes-new-btn dsh-nt', onClick: () => { if (capRef.current) capRef.current.focus() }, 'data-tooltip': '新建笔记（Ctrl+N）' }, '+')),
          e('div', { className: 'dsh-notes-kinds' },
            ['all', 'note', 'decision', 'todo', 'link', 'quote'].map(k => e('button', { key: k, className: 'dsh-notes-kind-chip' + (kindFilter === k ? ' on' : ''), onClick: () => { setKindFilter(k); setVisibleCount(PAGE_SIZE) } }, k === 'all' ? '全部' : KIND_LABELS[k])),
            e('button', { className: 'dsh-notes-pin-toggle' + (pinnedOnly ? ' on' : ''), onClick: () => { setPinnedOnly(!pinnedOnly); setVisibleCount(PAGE_SIZE) }, 'data-tooltip': '只看置顶' }, '📌 置顶')),
          e('div', { className: 'dsh-notes-content' },
            e('div', { className: 'dsh-notes-list', style: { width: listWidth + 'px' } },
              e('div', { className: 'dsh-notes-list-items', onScroll: onListScroll }, listContent, hasMore ? e('div', { className: 'dsh-notes-more' }, '继续滚动加载更多（已显示 ' + paged.length + ' / ' + filtered.length + '）') : null)),
            e('div', { className: 'dsh-notes-divider dsh-nt', onMouseDown: onDividerMouseDown, 'data-tooltip': '拖拽调整宽度' }),
            selected ? e('div', { className: 'dsh-notes-editor' },
              e('div', { className: 'dsh-notes-ed-head' },
                e('input', { className: 'dsh-notes-editor-title', placeholder: '标题', value: edTitle, onChange: (ev) => { setEdTitle(ev.target.value); triggerAutoSave() } }),
                e('div', { className: 'dsh-notes-ed-meta' },
                  e('select', { className: 'dsh-notes-ed-select', value: edKind, onChange: (ev) => { setEdKind(ev.target.value); triggerAutoSave() }, 'data-tooltip': '笔记类型' },
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
                  e('input', { className: 'dsh-notes-ed-topic', placeholder: '标签，逗号分隔', value: edTags, onChange: (ev) => { setEdTags(ev.target.value); triggerAutoSave() }, 'data-tooltip': '标签（convention 表示工作区约定）' }),
                  e('div', { className: 'dsh-notes-ed-meta-right' },
                    e('div', { className: 'dsh-notes-ed-dispatch-wrap' },
                      e('button', { className: 'dsh-notes-ed-action dsh-nt', onClick: (ev) => { ev.stopPropagation(); if (!dispatchOpen) loadActiveSessions(); setDispatchOpen(!dispatchOpen) }, 'data-tooltip': '派发为任务给活跃会话' }, dispatching ? '…' : '▶ 派发'),
                      dispatchOpen ? e('div', { className: 'dsh-notes-dispatch-panel' },
                        activeSessions.length === 0 ? e('div', { className: 'dsh-notes-dispatch-empty' }, '暂无活跃会话')
                          : activeSessions.map(s => e('button', { key: s.id, className: 'dsh-notes-dispatch-item dsh-nt', onClick: () => doDispatch(s), 'data-tooltip': s.cwd || s.id }, e('span', { className: 'dsh-notes-dispatch-name' }, s.name), s.workspace ? e('span', { className: 'dsh-notes-dispatch-ws' }, s.workspace) : null)))
                      : null),
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
              e('textarea', { className: 'dsh-notes-editor-body', placeholder: '开始记录…（支持 Markdown）', value: edBody, onChange: (ev) => { setEdBody(ev.target.value); triggerAutoSave() } }),
              e('div', { className: 'dsh-notes-ed-foot' },
                e('span', { className: 'dsh-notes-ed-saved' + (savedAt ? ' show' : '') }, savedAt ? '已自动保存 ' + new Date(savedAt).toTimeString().slice(0, 5) : ''),
                e('span', null, (edBody || '').length + ' 字')))
            : e('div', { className: 'dsh-notes-editor-empty' },
                e('div', { className: 'dsh-notes-editor-empty-ic' }, '✎'),
                e('div', { className: 'dsh-notes-editor-empty-t' }, '选择一条笔记查看和编辑'),
                e('div', { className: 'dsh-notes-editor-empty-s' }, '在上方输入框直接记录，主题自动识别'))),
          e('div', { className: 'dsh-notes-resize-handle dsh-nt', style: { position: 'absolute', bottom: 0, right: 0 }, onMouseDown: (ev) => onResizeMouseDown('se', ev), 'data-tooltip': '拖拽调整' }),
          error ? e('div', { className: 'dsh-notes-error' }, error) : null)
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-panel', order: 200 }, (props) => e(FloatingPanel, props))
    })
    if (typeof d3 === 'function') disposers.push(d3)
    const d4 = slots.inject('shell.overlay', () => {
      function SelectionCapture() {
        perf.selRender++
        const [btn, setBtn] = React.useState(null)
        const [toast, setToast] = React.useState('')
        const selTextRef = React.useRef('')
        const visibleRef = React.useRef(false)
        React.useEffect(() => { toastEmit = setToast; return () => { if (toastEmit === setToast) toastEmit = null } }, [])
        React.useEffect(() => {
          let mx = -1, my = -1, watchMouse = false
          function hide() { if (visibleRef.current) { visibleRef.current = false; setBtn(null) } }
          function onMouseMove(ev) { if (!watchMouse) return; mx = ev.clientX; my = ev.clientY; perf.mousemoveTracked++ }
          function showFromSelection() {
            perf.selShowEval++
            const s0 = now()
            try {
              const sel = window.getSelection()
              const text = sel ? sel.toString().trim() : ''
              if (!text || text.length < 2) { hide(); return }
              let x, y
              if (mx >= 0) {
                x = mx - 50
                y = my + 14
              } else {
                let rect
                try { if (sel.rangeCount > 0) rect = sel.getRangeAt(0).getBoundingClientRect() } catch (err) {}
                if (rect && !(rect.width === 0 && rect.height === 0)) {
                  x = rect.left + rect.width / 2 - 50
                  y = rect.bottom + 8
                } else { hide(); return }
              }
              x = Math.min(Math.max(8, x), window.innerWidth - 140)
              y = Math.min(Math.max(8, y), window.innerHeight - 40)
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
              // 快速路径：光标态（无选区）直接跳过，不创建任何定时器——聊天输入框每次击键都触发本事件
              let collapsed = true
              try { const sel = window.getSelection(); collapsed = !sel || sel.isCollapsed } catch (err) {}
              if (collapsed) { perf.selCollapsedSkip++; watchMouse = false; hide(); return }
              watchMouse = true
              debouncedShow()
            } finally { perf.selChangeMs += now() - sc0 }
          }
          function onMouseDown(ev) { if (ev.target.closest && ev.target.closest('.dsh-notes-sel-btn')) return; watchMouse = false; hide() }
          document.addEventListener('selectionchange', onSelectionChange)
          document.addEventListener('mousemove', onMouseMove, { passive: true })
          document.addEventListener('mousedown', onMouseDown)
          return () => {
            document.removeEventListener('selectionchange', onSelectionChange)
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mousedown', onMouseDown)
            if (debouncedShow && debouncedShow.dispose) debouncedShow.dispose()
          }
        }, [])
        React.useEffect(() => { if (!toast) return; const d = timer.timeout(() => setToast(''), 2600); return () => d() }, [toast])
        async function capture() { const text = selTextRef.current; visibleRef.current = false; setBtn(null); if (window.getSelection()) window.getSelection().removeAllRanges(); try { const res = await host.call('notes-quick', { text: text, sessionId: currentSessionId, kind: 'quote' }); if (res.error) { setToast('记录失败：' + res.error) } else { setToast(res.merged ? '已合并到本次速记' : '已记录，正在识别主题…'); notifyNotesChanged() } } catch (err) { setToast('记录失败：' + String(err.message || err)) } }
        return e('div', null, btn ? e('button', { className: 'dsh-notes-sel-btn', style: { left: btn.x + 'px', top: btn.y + 'px' }, onClick: capture }, '快速记录') : null, e('div', { className: 'dsh-notes-toast' + (toast ? ' show' : '') }, toast))
      }
      slots.register({ name: 'shell.overlay', id: 'dsh-notes-selection', order: 201 }, () => e(SelectionCapture))
    })
    if (typeof d4 === 'function') disposers.push(d4)
    ctx.effect(() => () => { for (const d of disposers) { try { d() } catch (e2) {} } })
    console.log('notes plugin: client ready')
  }
}
