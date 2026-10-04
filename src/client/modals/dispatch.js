    // ===== modal: dispatch —— 派发待办对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.dispatch / dispatchOpenRef / setDispatchOpen / setActiveSessions / setDispatchPending / setDispatching /
    //           setDispatchMode / setDispatchInstr / setDispatchWsId / setDispatchSessWs / setDispatchSessId / setWsList /
    //           loadActiveSessions / loadWorkspaces / openDispatch / doDispatchConfirm / doDispatchDone / DispatchModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名/selectedRef）、kernel/icons.js（e/I）、
    //        kernel/bus.js（showToast/notifyNotesChanged）、kernel/bootstrap.js（timer/sessions/workspaces 服务接入）
    // state 托管：open/activeSessions/pending/dispatching/mode/instr/wsId/sessWs/sessId/wsList 迁入 store.modal.dispatch 切片；
    // dispatchOpenRef 为 titlesPending 轮询终止条件的同步镜像（模块级单例）；轮询调度经 panelBridge.later（面板 timersRef 统一簿记/dispose）；
    // 当前选中笔记 id 读 kernel selectedRef（渲染期镜像）；确认后正文回填/列表刷新经 panelBridge.setEdBody/loadNotes 中转（禁横向引用）
    store.modal.dispatch = createStore({ open: false, activeSessions: [], pending: [], dispatching: false, mode: 'existing', instr: '', wsId: '', sessWs: '', sessId: '', wsList: [] })
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
    // 任务派发：加载活跃会话/工作区 + 打开对话框 + 确认派发
    // 0.1.7 首屏提速：host 对缓存未命中会话先返回占位（titlesPending + pendingSessions），对话框立即渲染
    // （占位条目显示「短id · 标题加载中…」）；仍 pending 则 1.5s 轮询重拉，直到标题补齐或对话框关闭。
    async function loadActiveSessions() {
      try {
        const res = await host.call('notes-active-sessions', {})
        if (!res) return
        if (res.sessions) setActiveSessions(res.sessions)
        setDispatchPending(res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [])
        if (res.titlesPending && dispatchOpenRef.current) panelBridge.later(loadActiveSessions, 1500)
      } catch (e) {}
    }
    async function loadWorkspaces() {
      try { const res = await host.call('notes-workspaces', {}); if (res && res.workspaces) setWsList(res.workspaces) } catch (e) {}
    }
    function openDispatch() {
      setDispatchInstr(''); setDispatchSessId(''); setDispatchSessWs(''); setDispatchWsId(''); setDispatchMode('existing'); setError('')
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
        const g = await host.call('notes-get', { id: selected }); if (g && g.note) panelBridge.setEdBody(g.note.body || '')
        await panelBridge.loadNotes(true); notifyNotesChanged()
      } catch (err) { setError(String(err.message || err)) } finally { setDispatching(false) }
    }
    // 标记一条派发待办为完成（停止注入目标会话系统提示）
    async function doDispatchDone(origIndex) {
      const selected = selectedRef.current
      try {
        const r = await host.call('notes-dispatch-done', { id: selected, dispatchIndex: origIndex })
        if (r && r.error) { setError(r.error); return }
        showToast('已标记完成'); await panelBridge.loadNotes(true); notifyNotesChanged()
      } catch (err) { setError(String(err.message || err)) }
    }
    // 派发对话框宿主（modal）：todo 上下文预览 + 补充具体要求 + 已有/新建会话（级联下拉）
    function DispatchModal(props) {
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
      const error = props.error
      const curNote = props.curNote
      // 派发对话框：已有会话模式按工作区过滤活跃会话；新建会话模式选工作区
      const dispatchWsKeys = []
      const dispatchSessByWs = {}
      for (const s of activeSessions) { const w = s.workspace || '其他'; if (!dispatchSessByWs[w]) { dispatchSessByWs[w] = []; dispatchWsKeys.push(w) } dispatchSessByWs[w].push(s) }
      // 标题后台补齐中的占位会话（0.1.7）：同一下拉按工作区分组，禁用态显示「短id · 标题加载中…」
      for (const p of dispatchPending) { const w = p.workspace || '其他'; if (!dispatchSessByWs[w]) { dispatchSessByWs[w] = []; dispatchWsKeys.push(w) } dispatchSessByWs[w].push({ id: p.id, short: p.short, name: '', pending: true }) }
      return (dispatchOpen && curNote) ? e('div', { className: 'dsh-notes-dispatch-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setDispatchOpen(false) } },
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
      : null
    }
