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
        const res = await host.call('notes-memory-guide', { op: 'enable', scope: memScopeResolve() })
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
        const res = await host.call('notes-memory-guide', { op: 'disable' })
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
