    // ===== modal: inject-manager —— 注入管理面板（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.injMgr / injMgrOpenRef / injMgrSearchRef / injMgrSearchDebRef / setInjMgrOpen / setInjMgrList / setInjMgrFilter /
    //           setInjMgrSearch / setInjMgrQ / setInjMgrSel / setInjMgrPending / openInjectManager / loadInjectManager / injMgrRole / injMgrScopeLabel / InjMgrModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）、kernel/bootstrap.js（timer）
    // state 托管：open/list/filter/search/q/sel/pending 迁入 store.modal.injMgr 切片；injMgrOpenRef 为 Esc 栈同步镜像 + injMgrSearchRef/injMgrSearchDebRef
    // 搜索防抖镜像（模块级单例，防抖 effect 挂 InjMgrModal 组件）；列表刷新经 panelBridge.loadNotes 中转；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.injMgr = createStore({ open: false, list: null, filter: 'all', search: '', q: '', sel: {}, pending: false })
    const injMgrOpenRef = { current: false }          // 注入管理面板镜像（Esc 优先关）
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
    // ===== 注入管理面板（设置卡片「注入管理」入口；notes-inject-manager）：全库注入总览 + 单行直改 + 多选批量 =====
    // 契约：数据源 notes-list {includeLogs:true} slim（inject/injectRole/injectEver/sensitive/kind/injectTo 齐备，零新 RPC）；
    // 三态语义与详情区三态分段控件完全一致：off→notes-update {inject:false}；约定/资料→{inject:true, injectRole}（payload 禁 undefined）；
    // 护栏：kind=log 注入硬禁（勾选/档位禁用 + tooltip；host 侧同口径强制 inject=false 并回 injectForcedOff）；
    //       sensitive 允许注入但行内提示「注入时自动脱敏」；排序：注入中在前（约定>资料），组内 updatedAt 降序。
    function openInjectManager() {
      setInjMgrList(null); setInjMgrFilter('all'); setInjMgrSearch(''); setInjMgrQ(''); setInjMgrSel({}); setInjMgrPending(false); setError('')
      injMgrSearchRef.current = ''
      panelBridge.setSettingsOpen(false); setInjMgrOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入/注入预览同款）
      loadInjectManager()
    }
    function loadInjectManager() {
      host.call('notes-list', { includeLogs: true }).then(res => {
        if (res && res.error) { setError(res.error); setInjMgrList([]); return }
        setInjMgrList((res && res.notes) || [])
      }).catch(err => { setError(String(err.message || err)); setInjMgrList([]) })
    }
    // 笔记三态（与详情区同口径）：inject=true → injectRole（缺省 convention）；否则 off
    function injMgrRole(n) { return n.inject === true ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off' }
    // 作用域摘要（injectTo 数；缺省/存量 global·workspace 值 = 全局）
    function injMgrScopeLabel(injectTo) { const arr = (injectTo || []).filter(t => t !== 'global' && t !== 'workspace'); return arr.length === 0 ? '全局' : arr.length + ' 个会话' }
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
      const error = props.error
      // 注入管理面板搜索防抖（250ms，与列表搜索同口径）：输入即更新受控值，防抖后才落过滤词 injMgrQ
      React.useEffect(() => {
        const d = timer.debounce(() => setInjMgrQ(injMgrSearchRef.current.trim().toLowerCase()), 250)
        injMgrSearchDebRef.current = d
        return () => { if (d && d.dispose) d.dispose() }
      }, [])
      // 单行直改：点 segmented 档位即切换（同详情区通道 notes-update {inject, injectRole}），toast 反馈
      async function doInjMgrSet(n, role) {
        if (!n || injMgrPending) return
        if ((n.kind || 'note') === 'log' && role !== 'off') return   // 日志隐身硬禁（按钮已禁用，双保险）
        if (injMgrRole(n) === role) return
        setError('')
        const upd = { id: n.id, inject: role !== 'off' }
        if (upd.inject) upd.injectRole = role   // 非 off 才带 injectRole（off 态不带，payload 禁 undefined；host 仅 inject=true 落盘）
        try {
          const res = await host.call('notes-update', upd)
          if (res && res.error) { setError(res.error); return }
          if (res && res.injectForcedOff) showToast('「' + (n.title || n.id) + '」日志默认隐身：inject 已强制关闭')
          else showToast(role === 'off' ? '已关闭注入：' + (n.title || n.id) : '已设为' + (role === 'reference' ? '资料' : '约定') + '：' + (n.title || n.id))
          // 本地即时回写（injectEver 粘性：开启即曾注入），后台刷新对齐 host
          setInjMgrList(prev => (prev || []).map(x => x.id === n.id ? Object.assign({}, x, role === 'off' ? { inject: false } : { inject: true, injectRole: role, injectEver: true }) : x))
          panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) }
      }
      // 多选：log 行不可选（隐身硬禁——批量三档位对日志无意义）
      function toggleInjMgrSel(id) { setInjMgrSel(prev => { const nx = Object.assign({}, prev); if (nx[id]) delete nx[id]; else nx[id] = true; return nx }) }
      // 批量设为约定/资料/关闭：confirm 条数 → 逐条 notes-update（单条失败计数不中断）；完成后清选 + 刷新
      async function doInjMgrBatch(role) {
        const ids = Object.keys(injMgrSel)
        if (!ids.length || injMgrPending) return
        const label = role === 'off' ? '关闭注入' : ('设为' + (role === 'reference' ? '资料' : '约定'))
        if (!window.confirm('批量' + label + '：所选的 ' + ids.length + ' 条笔记将' + (role === 'off' ? '关闭上下文注入。' : '注入为' + (role === 'reference' ? '资料（按需取用）。' : '约定（须遵守）。')) + '\n确认执行？')) return
        setInjMgrPending(true); setError('')
        let ok = 0, fail = 0
        for (const id of ids) {
          const upd = { id: id, inject: role !== 'off' }
          if (upd.inject) upd.injectRole = role
          try { const res = await host.call('notes-update', upd); if (res && res.error) fail++; else ok++ }
          catch (err) { fail++ }
        }
        setInjMgrPending(false); setInjMgrSel({})
        showToast('已' + label + ' ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''))
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
        const selectable = shown.filter(n => (n.kind || 'note') !== 'log')   // log 行不可选（隐身硬禁）
        const selCnt = Object.keys(injMgrSel).length
        const allChecked = selectable.length > 0 && selectable.every(n => injMgrSel[n.id])
        const chipBtn = (f, label) => e('button', { key: f, className: 'dsh-notes-injmgr-chip' + (injMgrFilter === f ? ' on' : ''), onClick: () => setInjMgrFilter(f) }, label)
        // 行内三态 segmented（语义与详情区三态分段控件完全一致）；log 行约定/资料档禁用（隐身硬禁 + tooltip）
        const segOpt = (n, role, r, label, tip) => {
          const dis = (n.kind || 'note') === 'log' && r !== 'off'
          return e('span', { key: r, className: 'dsh-notes-injmgr-opt dsh-nt' + (role === r ? ' on' : '') + (dis ? ' dis' : ''), 'data-tooltip': dis ? '日志默认隐身：inject 强制关闭（kind=log 硬禁）' : tip, onClick: () => { if (!dis) doInjMgrSet(n, r) } }, label)
        }
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !injMgrPending) setInjMgrOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-injmgr-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('bolt', 14), ' 注入管理', e('span', { className: 'dsh-notes-imgup-sub' }, '全库注入总览 · 单行直改 / 多选批量 · 日志隐身硬禁')),
            e('div', { className: 'dsh-notes-injmgr-bar' },
              e('div', { className: 'dsh-notes-injmgr-chips' },
                chipBtn('all', '全部 ' + listAll.length), chipBtn('convention', '约定 ' + cntConv), chipBtn('reference', '资料 ' + cntRef), chipBtn('off', '未注入 ' + cntOff)),
              e('input', { className: 'dsh-notes-injmgr-search', placeholder: '搜索标题 / 主题 / 标签…', value: injMgrSearch, onChange: (ev) => { injMgrSearchRef.current = ev.target.value; setInjMgrSearch(ev.target.value); if (injMgrSearchDebRef.current) injMgrSearchDebRef.current() } })),
            injMgrList === null
              ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
              : shown.length === 0
                ? e('div', { className: 'dsh-notes-data-hint' }, listAll.length ? '无匹配笔记（调整过滤或搜索词）。' : '笔记库为空。')
                : e(React.Fragment, null,
                    e('div', { className: 'dsh-notes-injmgr-batch' },
                      e('label', { className: 'dsh-notes-trash-all' },
                        e('input', { type: 'checkbox', className: 'dsh-notes-trash-check', checked: allChecked, disabled: injMgrPending || selectable.length === 0, onChange: () => {
                          const nx = {}
                          if (!allChecked) selectable.forEach(n => { nx[n.id] = true })
                          setInjMgrSel(nx)
                        } }),
                        '全选'),
                      e('span', { className: 'dsh-notes-trash-selcnt' }, '已选 ' + selCnt + ' 条'),
                      e('button', { className: 'dsh-notes-trash-act', onClick: () => doInjMgrBatch('convention'), disabled: injMgrPending || selCnt < 1 }, '设为约定'),
                      e('button', { className: 'dsh-notes-trash-act', onClick: () => doInjMgrBatch('reference'), disabled: injMgrPending || selCnt < 1 }, '设为资料'),
                      e('button', { className: 'dsh-notes-trash-act', onClick: () => doInjMgrBatch('off'), disabled: injMgrPending || selCnt < 1 }, injMgrPending ? '执行中…' : '关闭注入')),
                    e('div', { className: 'dsh-notes-injmgr-list' },
                      shown.map(n => {
                        const role = injMgrRole(n)
                        const isLog = (n.kind || 'note') === 'log'
                        return e('div', { key: n.id, className: 'dsh-notes-injmgr-row' },
                          e('span', { className: isLog ? 'dsh-nt' : '', 'data-tooltip': isLog ? '日志默认隐身：inject 强制关闭，不参与注入批量操作' : null },
                            e('input', { type: 'checkbox', className: 'dsh-notes-trash-check', checked: !!injMgrSel[n.id], disabled: isLog || injMgrPending, onChange: () => toggleInjMgrSel(n.id) })),
                          e('span', { className: 'dsh-notes-kind-dot', style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' } }),
                          e('span', { className: 'dsh-notes-injmgr-ti', title: n.title || '无标题' }, n.title || '无标题'),
                          n.sensitive === true ? e('span', { className: 'dsh-notes-injmgr-sens dsh-nt', 'data-tooltip': '敏感笔记：注入时自动脱敏（正文按行打码，键保留值遮蔽）' }, I('lock', 9), '注入时自动脱敏') : null,
                          n.injectEver === true && !n.inject ? e('span', { className: 'dsh-notes-injmgr-ever dsh-nt', 'data-tooltip': '曾注入：历史上开启过上下文注入（现已关闭；injectEver 为粘性标记，不随关闭回退）' }, I('clock', 9), '曾注入') : null,
                          e('span', { className: 'dsh-notes-injmgr-scope' }, injMgrScopeLabel(n.injectTo)),
                          e('span', { className: 'dsh-notes-injmgr-seg' }, I('bolt', 10),
                            segOpt(n, role, 'off', '关闭', '不注入系统提示'),
                            segOpt(n, role, 'convention', '约定', '须遵守的行为规则'),
                            segOpt(n, role, 'reference', '资料', '事实性补充信息，Agent 按需取用')))
                      }))),                error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setInjMgrOpen(false), disabled: injMgrPending }, '关闭'))))
      })()
      : null
    }
