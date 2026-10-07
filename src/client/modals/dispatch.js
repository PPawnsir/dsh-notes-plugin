    // ===== modal: dispatch —— 派发待办对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.dispatch / dispatchOpenRef / setDispatchOpen / setActiveSessions / setDispatchPending / setDispatching /
    //           setDispatchMode / setDispatchInstr / setDispatchWsId / setDispatchSessWs / setDispatchSessId / setWsList /
    //           setDispatchSched / setDispatchSchedMode / setDispatchSchedN / setDispatchSchedAt / setDispatchSchedAnchor / setDispatchSchedDow /
    //           setDispatchSchedModel / setDispatchSchedPreset / loadActiveSessions / loadWorkspaces / openDispatch / openDispatchEdit / doDispatchConfirm / doDispatchDone / DispatchModal
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
    // 专属会话模型档位（0.4.6-G，notes-046-sched-model）：专属会话复选框勾选时出模型下拉（数据源 = notes-settings-get 的
    //   models 清单通道，与设置卡同通道零新 RPC；清单缺席 → 下拉隐藏静默降级），选中值以 provider/model 拆分随声明提交
    //   （缺省空 = 跟随宿主默认选择）；编辑模式回填 s.provider/s.model（清单外存量值补合成条目防丢档）
    // 专属会话权限预设（0.4.7，notes-047-sched-preset，主窗口裁决「显示层显式化」）：专属会话勾选时出权限下拉——
    //   恒两档具体值 完全权限（danger-full-access）/ 受限（workspace-write），无「继承默认」概念（用户看到的永远是具体值）；
    //   打开弹窗预填 = 当前 defaultPreset 对应档（数据源 = notes-settings-get 响应的 permissionPresets 键，与模型清单同一次调用零新 RPC；
    //   读不到 → 预填完全权限兜底）；勾选专属会话创建时 preset 键总是显式落盘；编辑模式回填存量 preset（存量无键 = 按 defaultPreset 预填显示，
    //   保存才显式化——显示层显式化、存储层零迁移）；编辑模式存量 preset 防丢档透传（同 model 先例）
    store.modal.dispatch = createStore({ open: false, activeSessions: [], pending: [], dispatching: false, mode: 'existing', instr: '', wsId: '', sessWs: '', sessId: '', wsList: [], sched: false, schedMode: 'daily', schedN: 3, schedAt: '', editId: '', editNote: null, schedAnchor: '09:00', schedDow: 1, schedNew: false, schedModel: '', schedModels: [], schedPreset: 'danger-full-access' })
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
    function setDispatchSchedModel(v) { store.modal.dispatch.set({ schedModel: typeof v === 'function' ? v(store.modal.dispatch.get().schedModel) : v }) }   // 0.4.6-G：专属会话模型档位选中值（'provider/model'，空 = 跟随宿主默认）
    function setDispatchSchedPreset(v) { store.modal.dispatch.set({ schedPreset: typeof v === 'function' ? v(store.modal.dispatch.get().schedPreset) : v }) }   // 0.4.7：专属会话权限档位选中值（恒两档具体值，无 inherit）
    // 模型清单会话级缓存（0.4.6-G）：开弹窗即取缓存渲染，后台刷新对齐 host；通道缺席/失败 → schedModels 空 → 下拉隐藏（静默降级红线）
    let schedModelsCache = null
    // 默认权限预设会话级缓存（0.4.7）：settings-get 响应 permissionPresets.defaultPreset；读不到 → null（预填兜底完全权限）
    let schedPresetCache = null
    // 权限下拉预填值（0.4.7 显示层显式化）：存量声明 preset 优先（编辑态回填）；缺省 = 宿主默认档映射；读不到 → 完全权限兜底
    function schedPresetPrefill(editSched) {
      const p = editSched && editSched.preset
      if (p === 'workspace-write' || p === 'danger-full-access') return p
      return schedPresetCache || 'danger-full-access'
    }
    async function loadSchedModels() {
      try {
        const res = await host.call('notes-settings-get', {})
        if (res && res.models && res.models.length) { schedModelsCache = res.models; store.modal.dispatch.set({ schedModels: res.models }) }
        // 0.4.7：同一响应的 permissionPresets.defaultPreset 通道（零新 RPC）——权限下拉预填刷新：
        //   仅当当前值仍是上次预填基准（用户未改离）且非「编辑态存量 preset」时跟随宿主默认（存量声明显式值优先，防丢档优先级最高）
        const dp = res && res.permissionPresets && res.permissionPresets.defaultPreset
        const v = (dp === 'workspace-write' || dp === 'danger-full-access') ? dp : 'danger-full-access'
        const prev = schedPresetCache
        schedPresetCache = v
        const st = store.modal.dispatch.get()
        if (st.open && !(st.editNote && st.editNote.schedule && st.editNote.schedule.preset) && st.schedPreset === (prev || 'danger-full-access')) store.modal.dispatch.set({ schedPreset: v })
      } catch (e) {}
    }
    // 任务派发：加载活跃会话/工作区 + 打开对话框 + 确认派发
    // 0.1.7 首屏提速：host 对缓存未命中会话先返回占位（titlesPending + pendingSessions），对话框立即渲染
    // （占位条目显示「短id · 标题加载中…」）；仍 pending 则 1.5s 轮询重拉，直到标题补齐或对话框关闭。
    async function loadActiveSessions() {
      try {
        const res = await host.call('notes-active-sessions', {})
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
      try { const res = await host.call('notes-workspaces', {}); if (res && res.workspaces) setWsList(res.workspaces) } catch (e) {}
    }
    function openDispatch() {
      setDispatchInstr(''); setDispatchSessId(''); setDispatchSessWs(''); setDispatchWsId(''); setDispatchMode('existing'); setError('')
      store.modal.dispatch.set({ sched: false, schedMode: 'daily', schedN: 3, schedAt: '', editId: '', editNote: null, schedAnchor: '09:00', schedDow: 1, schedNew: false, schedModel: '', schedModels: schedModelsCache || [], schedPreset: schedPresetPrefill(null) })   // 调度区复位（默认收起 = 立即派发；锚定时刻默认 09:00 / 周一；专属会话缺省关；模型档位缺省跟随宿主默认；权限档位预填宿主默认档，0.4.7）
      loadActiveSessions(); loadWorkspaces(); loadSchedModels(); setDispatchOpen(true)
    }
    // 编辑模式入口（注入管理「调度任务」区 [编辑]，经 panelBridge.openDispatchEdit 中转——modals 禁横向引用）：同弹窗回填既有声明
    function openDispatchEdit(note) {
      if (!note || !note.schedule) { showToast(t('disp.noSchedule')); return }
      const s = note.schedule
      const isNew = s.target === 'new'   // 0.4.4-B：专属会话声明回填（复选框承载，级联选择无对应真实条目）
      setDispatchInstr(''); setDispatchSessId(isNew ? '' : (s.target || '')); setDispatchSessWs(''); setDispatchWsId(''); setDispatchMode('existing'); setError('')
      // 0.4.6-G：模型档位回填（provider/model 成对落库 → 合成 provider/model 选中值；缺省空 = 跟随宿主默认）
      // 0.4.7：权限档位回填——存量 preset 优先；存量无键按宿主默认档预填显示（显示层显式化、存储层零迁移：保存才落键）
      store.modal.dispatch.set({ editId: note.id, editNote: note, sched: true, schedNew: isNew, schedModel: (s.provider && s.model) ? s.provider + '/' + s.model : '', schedModels: schedModelsCache || [], schedPreset: schedPresetPrefill(s) })
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
      loadActiveSessions(); loadWorkspaces(); loadSchedModels(); setDispatchOpen(true)
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
          // 0.4.6-G：专属会话 + 已选模型档位 → 声明携 provider/model（成对；缺省空 = 跟随宿主默认，声明零字段）；
          //   编辑模式保留存量档位（首轮回写后 target=真实 sid、复选框摘勾下拉隐藏，schedModel 仍持回填值——表单与 front-matter 同源，防丢档同 anchor/dow 先例）
          const dispatchSchedModel = store.modal.dispatch.get().schedModel
          if (dispatchSchedModel && (dispatchSchedNew || dispatchEditId)) { const mp = dispatchSchedModel.split('/'); decl.provider = mp[0]; decl.model = mp.slice(1).join('/') }
          // 0.4.7（notes-047-sched-preset）：专属会话勾选 → preset 键总是显式落盘（恒具体两档，无 inherit——显示层显式化裁决）；
          //   编辑模式存量 preset 防丢档透传（下拉已隐时原值回传，同 model 先例）；存量无键且未勾专属 → 不落键（存储层零迁移）
          if (dispatchSchedNew) decl.preset = store.modal.dispatch.get().schedPreset
          else if (dispatchEditId && dispatchEditNote.schedule && dispatchEditNote.schedule.preset) decl.preset = dispatchEditNote.schedule.preset
          const nextTxt = fmtDT(new Date(schedDeclNextMs(f.decl, dispatchEditNote)).toISOString())
          let res
          if (dispatchEditId) res = await host.call('notes-update', { id: dispatchEditId, schedule: decl })
          else {
            /* 正文人话 = 原待办正文 + 补充指令（即被派发的工作内容本身）；标题自动「定时 」前缀
               （数据层保留中文：schedPeerKey 前缀正则跨语言匹配同口径；「补充指令：」check 50 断言锚定——i18n 覆盖卡E 不抽串） */
            const g0 = await host.call('notes-get', { id: selected })
            const src = (g0 && g0.note) || {}
            const body = String(src.body || '').trim() + (String(dispatchInstr || '').trim() ? '\n\n补充指令：' + String(dispatchInstr).trim() : '') + '\n'
            res = await host.call('notes-create', { title: '定时 ' + (src.title || 'Untitled'), body: body, kind: 'todo', contractType: 'dispatch-schedule', schedule: decl })
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
          const res = await host.call('notes-dispatch', { id: selected, sessionId: newSid, sessionName: (ws ? ws.title : '新会话'), workspace: ws ? ws.title : '', mode: 'new', instruction: dispatchInstr })
          if (res && res.error) { setError(res.error); setDispatching(false); return }
          if (sessions && newSid) { try { sessions.open(newSid) } catch (e) {} }
          showToast(t('disp.newSessDone'))
        } else {
          // 已有会话派发
          if (!dispatchSessId) { setError(t('disp.needSession')); setDispatching(false); return }
          const sess = activeSessions.find(s => s.id === dispatchSessId)
          // 0.4.4-B 休眠送达：目标不 live 不再强开唤醒（零成本送达红线）——host 持久化排队，会话下次活动时处理
          const res = await host.call('notes-dispatch', { id: selected, sessionId: dispatchSessId, sessionName: sess ? sess.name : '', workspace: sess ? sess.workspace : '', mode: 'existing', instruction: dispatchInstr })
          if (res && res.error) { setError(res.error); setDispatching(false); return }
          showToast(t(res && res.queued ? 'disp.dispatchedQueued' : 'disp.dispatched', { name: sess ? sess.name : '' }))
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
      const dispatchSchedModel = store.modal.dispatch.useSel(s => s.schedModel)
      const dispatchSchedModels = store.modal.dispatch.useSel(s => s.schedModels)
      const dispatchSchedPreset = store.modal.dispatch.useSel(s => s.schedPreset)
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
              dispatchSchedMode !== 'once' ? e('label', { className: 'dsh-notes-sched-opt' }, e('input', { type: 'checkbox', checked: dispatchSchedNew, onChange: (ev) => setDispatchSchedNew(ev.target.checked) }), ' ' + tt('disp.schedNew')) : null,
              // 专属会话模型下拉（0.4.6-G）：勾选专属会话 + 清单非空才显示（清单缺席静默降级）；清单外存量值补合成条目回显防丢档
              (dispatchSchedNew && dispatchSchedMode !== 'once' && dispatchSchedModels.length > 0) ? e('select', { className: 'dsh-notes-dispatch-select dsh-notes-sched-sel', 'data-tooltip': tt('disp.schedModelTip', { model: dispatchSchedModel || tt('disp.schedModelDefault') }), value: (dispatchSchedModel && dispatchSchedModels.some(m => m.provider + '/' + m.model === dispatchSchedModel)) ? dispatchSchedModel : (dispatchSchedModel || ''), onChange: (ev) => setDispatchSchedModel(ev.target.value) },
                e('option', { value: '' }, tt('disp.schedModelDefault')),
                dispatchSchedModels.map(m => e('option', { key: m.provider + '/' + m.model, value: m.provider + '/' + m.model }, m.label || (m.provider + '/' + m.model))),
                (dispatchSchedModel && !dispatchSchedModels.some(m => m.provider + '/' + m.model === dispatchSchedModel)) ? e('option', { key: '__stale', value: dispatchSchedModel }, dispatchSchedModel) : null) : null,
              // 专属会话权限下拉（0.4.7，notes-047-sched-preset）：勾选专属会话即显示（数据源 = 静态两档 + defaultPreset 预填，
              //   无清单依赖不随 models 缺席降级——可见性缺口补全的常驻入口）；恒两档具体值，无「继承默认」选项
              (dispatchSchedNew && dispatchSchedMode !== 'once') ? e('select', { className: 'dsh-notes-dispatch-select dsh-notes-sched-sel', 'data-tooltip': tt('disp.schedPresetTip'), value: dispatchSchedPreset, onChange: (ev) => setDispatchSchedPreset(ev.target.value) },
                e('option', { value: 'danger-full-access' }, tt('disp.schedPresetFull')),
                e('option', { value: 'workspace-write' }, tt('disp.schedPresetRestricted'))) : null) : null),
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
