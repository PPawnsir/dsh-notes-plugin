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
    // 确认统一 notes-mount（幂等换文案）；跳过/取消 = 保留现状行；modal 不叠 modal（调用方先关来源 modal）
    store.modal.mount = createStore({ open: false, id: '', title: '', when: '', pending: false, generating: false, edit: false, touched: false })
    function setMountOpen(v) { store.modal.mount.set({ open: typeof v === 'function' ? v(store.modal.mount.get().open) : v }) }
    function openMountModal(n) {
      if (!n) return
      const edit = typeof n.existing === 'string'   // 已挂载 = 编辑模式（预填现有 whenToUse，不调 LLM）
      store.modal.mount.set({ open: true, id: n.id, title: n.title || n.id, when: edit ? n.existing : '', pending: false, generating: !edit, edit: edit, touched: false })
      if (edit) return
      // LLM 草稿预填：成功填草稿；失败/超时回退预填标题（现状行为）；弹层已关/换目标则丢弃迟到响应
      host.call('notes-when-suggest', { id: n.id }).then(res => {
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
    function closeMountModal() { setMountOpen(false) }
    async function doMountSave() {
      const m = store.modal.mount.get()
      if (!m.id || m.pending) return
      store.modal.mount.set({ pending: true })
      try {
        // 空值兜底（0.4.3⑦ 顺带微修）：「正在生成…」窗口内点确认时 m.when 可能仍为空串——落空则回退标题，whenToUse 行不落空
        const res = await host.call('notes-mount', { id: m.id, whenToUse: m.when || m.title })
        store.modal.mount.set({ pending: false })
        if (res && res.error) { showToast(t('inj.mountFailed', { msg: res.error })); return }
        showToast(t('inj.mountSaved', { title: m.title }))
        closeMountModal()
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
      host.call('notes-list', { includeLogs: true }).then(res => {
        if (res && res.error) { setError(res.error); setInjMgrList([]); return }
        setInjMgrList((res && res.notes) || [])
      }).catch(err => { setError(String(err.message || err)); setInjMgrList([]) })
      // 挂载区统计行数据源（0.4.3 验收修复⑥ notes-043-metrics-present）：notes-recall-stats 只读 RPC（账本快照 ledger 键 + 五通道分列），
      // 零新通道；静默降级——RPC 失败/无快照（新装库 cron 未跑）→ rstats 保持 null，统计行整区省略不占位
      host.call('notes-recall-stats', {}).then(res => { if (res && !res.error && res.ok) setInjMgrRstats(res) }).catch(() => setInjMgrRstats(null))   // 失败清陈旧统计行（刷新场景），遥测静默降级不打扰
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
        const res = await host.call('notes-update', { id: n.id, schedule: decl })
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
        const res = await host.call('notes-delete', { id: n.id })
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
        const upd = { id: n.id, inject: role !== 'off' }
        if (upd.inject) upd.injectRole = role   // 非 off 才带 injectRole（off 态不带，payload 禁 undefined；host 仅 inject=true 落盘）
        try {
          const res = await host.call('notes-update', upd)
          if (res && res.error) { setError(res.error); return }
          if (res && res.injectForcedOff) showToast(t('inj.forcedOff', { title: n.title || n.id }))
          else showToast(role === 'off' ? t('inj.injectOffToast', { title: n.title || n.id }) : t('inj.injectSetToast', { role: t(role === 'reference' ? 'tree.roleReference' : 'tree.roleConvention'), title: n.title || n.id }))
          // 0.4.3⑤ 挂载弹层：设为资料（reference）→ 手写 whenToUse（host 已自动落缺省行，弹层换文案；modal 不叠 modal——先关注入管理面板）
          if (role === 'reference') { setInjMgrOpen(false); injMgrBackRef.current = null; openMountModal({ id: n.id, title: n.title }) }
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
          try { const res = await host.call('notes-update', upd); if (res && res.error) fail++; else ok++ }
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
                      e('button', { className: 'dsh-notes-trash-act', onClick: () => doInjMgrBatch('reference'), disabled: injMgrPending || selCnt < 1 }, tt('inj.batchReference')),
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
