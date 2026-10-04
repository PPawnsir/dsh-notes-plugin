    // ===== modal: memory-guide —— 工作记忆启用沉淀引导对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.memory / memOpenRef / setMemStatus / setMemOpen / setMemScope / setMemWsPick / setMemSidPick / setMemPending /
    //           memScopeResolve / openMemEnable / doMemEnable / doMemDisable / memViewNote / MemoryGuideModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError/jumpToWikiTarget 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）
    // state 托管：status/open/scope/wsPick/sidPick/pending 迁入 store.modal.memory 切片；memOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 作用域解析/多选清单数据源（sessList/sessPending）属面板域：渲染期经 props 注入，动作期经 panelBridge 中转（禁横向引用）；
    // 「查看约定」跳转经 kernel jumpToWikiTarget 转发别名；与设置卡片互斥经 panelBridge.setSettingsOpen 中转；
    // memStatus 同时供 settings 模块状态行订阅（序位在前的本模块顶层绑定对 settings.js 可见）
    store.modal.memory = createStore({ status: null, open: false, scope: 'global', wsPick: {}, sidPick: {}, pending: false })
    const memOpenRef = { current: false }   // 工作记忆启用对话框镜像（Esc 优先关）
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
    function openMemEnable() {
      setMemScope('global'); setMemWsPick({}); setMemSidPick({}); setMemPending(false); setError('')
      panelBridge.setSettingsOpen(false); setMemOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
    }
    async function doMemEnable() {
      const memPending = store.modal.memory.get().pending
      const memScope = store.modal.memory.get().scope
      const memWsPick = store.modal.memory.get().wsPick
      const memSidPick = store.modal.memory.get().sidPick
      if (memPending) return
      // 多选档校验：至少勾 1 项（指定工作区档解析为空 = 所选工作区暂无有效会话，同样拦截）
      if (memScope === 'workspace' && !Object.keys(memWsPick).length) { setError('「指定工作区」需至少勾选 1 个工作区（或改选所有会话）'); return }
      if (memScope === 'session' && !Object.keys(memSidPick).length) { setError('「指定会话」需至少勾选 1 个会话（或改选所有会话）'); return }
      const scope = memScopeResolve()
      if (memScope !== 'global' && !scope.length) { setError('所选范围暂无可注入会话（请先在其中打开会话）'); return }
      setMemPending(true); setError('')
      try {
        const res = await host.call('notes-memory-guide', { op: 'enable', scope: memScopeResolve() })
        if (res && res.error) { setError(res.error); return }
        setMemOpen(false)
        showToast(res && res.already ? '沉淀引导已启用（约定笔记已存在）' : (res && res.revived ? '已重新启用沉淀引导：复用已有约定笔记（未新建第二条）' : '已启用沉淀引导：约定笔记已创建并注入'))
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
        showToast(res && res.disabled ? '已停用沉淀引导（约定笔记保留，inject 已关闭）' : '当前未启用沉淀引导')
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
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !memPending) setMemOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('bolt', 14), ' 启用沉淀引导', e('span', { className: 'dsh-notes-imgup-sub' }, '工作记忆 v0 · 约定笔记方案')),
            e('div', { className: 'dsh-notes-data-hint' }, '将创建一条预填约定笔记「约定：工作日志沉淀（工作记忆 v0）」（inject=true，contractType: memory-guide），引导 Agent 在任务收尾/你示意时把会话结论写为工作日志（kind=log）。工作记忆是独立于笔记约定的并行通道——约定管你怎么记（给人看），记忆管 Agent 自己沉淀什么（自用召回），两者可同时对同一事件生效，产物重复是设计意图而非冲突。日志默认隐身：不进系统提示、不进目录、不出现在默认列表与默认搜索；筛选中心类型「日志」为专入口。该约定可见/可改/可停用/可删除；停用后再启用复用同一约定笔记（重新打开注入，不新建第二条）。'),
            e('div', { className: 'dsh-notes-suggest-sec' },
              e('div', { className: 'dsh-notes-suggest-sec-t' }, '注入范围（作用域）'),
              scopeOpt('global', '所有会话（缺省）', 'injectTo=[]：任何会话的系统提示都注入该约定'),
              scopeOpt('workspace', '指定工作区（多选）', '展开为所选工作区全部会话的短 id 清单（injectTo 无工作区维度）'),
              memScope === 'workspace' ? e('div', { style: { maxHeight: 120, overflow: 'auto', margin: '2px 0 4px 20px' } },
                memWsList.length
                  ? memWsList.map(w => pickItem(w, !!memWsPick[w], () => togglePick(setMemWsPick, w), w + '（' + memSessAll.filter(s => s.workspace === w).length + ' 个会话）'))
                  : e('div', { className: 'dsh-notes-data-hint' }, '没有可选工作区')) : null,
              scopeOpt('session', '指定会话（多选）', 'injectTo=[勾选的会话短 id]：只有这些会话注入该约定'),
              memScope === 'session' ? e('div', { style: { maxHeight: 160, overflow: 'auto', margin: '2px 0 4px 20px' } },
                memSessAll.length
                  ? memSessAll.map(s => pickItem(s.short, !!memSidPick[s.short], () => togglePick(setMemSidPick, s.short), s.short + (s.name ? ' · ' + s.name : '') + (s.workspace ? '（' + s.workspace + '）' : '')))
                  : e('div', { className: 'dsh-notes-data-hint' }, '没有可选会话')) : null),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setMemOpen(false), disabled: memPending }, '取消'),
              e('button', { className: 'dsh-notes-dispatch-ok', onClick: doMemEnable, disabled: memPending }, memPending ? '启用中…' : '确认启用'))))
      })()
      : null
    }
