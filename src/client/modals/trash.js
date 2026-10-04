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
      host.call('notes-list', { includeDeleted: true }).then(res => {
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
          const res = await host.call('notes-restore', { id: id })
          if (res && res.error) { setError(res.error); return }
          showToast('已恢复')
          loadTrash(); await panelBridge.loadNotes(true); panelBridge.loadFolders(); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) } finally { setTrashPending('') }
      }
      async function doTrashPurge(id, title) {
        if (!id || trashPending) return
        if (!window.confirm('彻底删除不可恢复：「' + (title || id) + '」\n删除后正文与归档备份将一并移除，确认彻底删除？')) return
        setTrashPending(id); setError('')
        try {
          const res = await host.call('notes-purge', { id: id })
          if (res && res.error) { setError(res.error); return }
          showToast('已彻底删除')
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
        host.call('notes-get', { id: id, includeDeleted: true }).then(res => {
          if (res && res.note && typeof res.note.body === 'string') setTrashPreview(prev => (prev && prev.id === id) ? { id: id, body: res.note.body, error: '' } : prev)
          else setTrashPreview(prev => (prev && prev.id === id) ? { id: id, body: null, error: '预览失败：' + ((res && res.error) || '无正文') } : prev)
        }).catch(err => setTrashPreview(prev => (prev && prev.id === id) ? { id: id, body: null, error: '预览失败：' + String(err.message || err) } : prev))
      }
      // 批量恢复：confirm 后逐条 notes-restore（单条失败计数不中断）；完成后清空勾选/预览 + 刷新
      async function doTrashRestoreBatch() {
        const ids = Object.keys(trashSel)
        if (!ids.length || trashPending) return
        if (!window.confirm('批量恢复：所选的 ' + ids.length + ' 条笔记将移出回收站（恢复后回到正常列表）。\n确认恢复？')) return
        setTrashPending('batch'); setError('')
        let ok = 0, fail = 0
        for (const id of ids) {
          try { const res = await host.call('notes-restore', { id: id }); if (res && res.error) fail++; else ok++ }
          catch (err) { fail++ }
        }
        setTrashPending(''); setTrashSel({}); setTrashPreview(null)
        showToast('已恢复 ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''))
        loadTrash(); await panelBridge.loadNotes(true); panelBridge.loadFolders(); notifyNotesChanged()
      }
      // 批量彻底删除：confirm 双确认（「不可恢复 + 含历史版本」+ 条数，与单条同口径）→ 逐条 notes-purge（host 安全闸仅限已软删除）
      async function doTrashPurgeBatch() {
        const ids = Object.keys(trashSel)
        if (!ids.length || trashPending) return
        if (!window.confirm('批量彻底删除：所选的 ' + ids.length + ' 条笔记将彻底删除，不可恢复（含历史版本）。\n删除后正文、历史版本快照与归档备份将一并移除，确认彻底删除？')) return
        setTrashPending('batch'); setError('')
        let ok = 0, fail = 0
        for (const id of ids) {
          try { const res = await host.call('notes-purge', { id: id }); if (res && res.error) fail++; else ok++ }
          catch (err) { fail++ }
        }
        setTrashPending(''); setTrashSel({}); setTrashPreview(null)
        showToast('已彻底删除 ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''))
        loadTrash(); await panelBridge.loadNotes(true); notifyNotesChanged()
      }
      // P1 回收站对话框（侧栏底部「回收站」入口；复用归档预览的列表样式）：
      // 批量操作条（全选 + 选中计数 + 恢复所选/彻底删除所选）+ 行 = 勾选框 + 标题（点击展开只读预览）+ 删除时间 + 预览/恢复/彻底删除；
      // 彻底删除 confirm 双确认（不可恢复）；批量彻底删除同口径文案 + 条数 + 含历史版本；
      // 行预览 = notes-get {id, includeDeleted:true} 取已删正文 → renderMarkdown 只读渲染（内核全量转义，esc 先行零注入面）
      return trashOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !trashPending) setTrashOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal dsh-notes-trash-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('trash', 14), ' 回收站', e('span', { className: 'dsh-notes-imgup-sub' }, '软删除的笔记 · 恢复可找回 · 彻底删除不可恢复')),
          trashList === null
            ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
            : trashList.length === 0
              ? e('div', { className: 'dsh-notes-data-hint' }, '回收站为空（删除的笔记会出现在这里）。')
              : e(React.Fragment, null,
                  e('div', { className: 'dsh-notes-trash-batch' },
                    e('label', { className: 'dsh-notes-trash-all' },
                      e('input', { type: 'checkbox', className: 'dsh-notes-trash-check', checked: trashList.length > 0 && trashList.every(n => trashSel[n.id]), disabled: !!trashPending, onChange: toggleTrashAll }),
                      '全选'),
                    e('span', { className: 'dsh-notes-trash-selcnt' }, '已选 ' + Object.keys(trashSel).length + ' 条'),
                    e('button', { className: 'dsh-notes-trash-act', onClick: doTrashRestoreBatch, disabled: !!trashPending || Object.keys(trashSel).length < 1 }, '恢复所选'),
                    e('button', { className: 'dsh-notes-trash-act danger', onClick: doTrashPurgeBatch, disabled: !!trashPending || Object.keys(trashSel).length < 1 }, '彻底删除所选')),
                  e('div', { className: 'dsh-notes-arch-list' },
                    trashList.map(n => e('div', { key: n.id },
                      e('div', { className: 'dsh-notes-arch-row' },
                        e('input', { type: 'checkbox', className: 'dsh-notes-trash-check', checked: !!trashSel[n.id], disabled: !!trashPending, onChange: () => toggleTrashSel(n.id) }),
                        e('span', { className: 'dsh-notes-arch-ti dsh-notes-trash-ti', title: (n.title || 'Untitled') + '（点击预览正文，只读）', onClick: () => toggleTrashPreview(n.id) }, n.title || 'Untitled'),
                        e('span', { className: 'dsh-notes-arch-meta' }, '删于 ' + (n.updatedAt ? fmtDT(n.updatedAt).slice(0, 10) : '—')),
                        e('button', { className: 'dsh-notes-trash-act', onClick: () => toggleTrashPreview(n.id), disabled: !!trashPending }, trashPreview && trashPreview.id === n.id ? '收起' : '预览'),
                        e('button', { className: 'dsh-notes-trash-act', onClick: () => doTrashRestore(n.id), disabled: !!trashPending }, '恢复'),
                        e('button', { className: 'dsh-notes-trash-act danger', onClick: () => doTrashPurge(n.id, n.title), disabled: !!trashPending }, '彻底删除')),
                      // 行内只读预览：正文只经 renderMarkdown 内核渲染（全量转义零注入面）；加载/错误态走 React 文本插值（自动转义）
                      trashPreview && trashPreview.id === n.id
                        ? (typeof trashPreview.body === 'string'
                            ? e('div', { className: 'dsh-notes-trash-preview dsh-notes-rich', dangerouslySetInnerHTML: { __html: renderMarkdown(trashPreview.body, wikiResolve) } })
                            : e('div', { className: 'dsh-notes-data-hint' }, trashPreview.error || '预览加载中…'))
                        : null)))),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setTrashOpen(false), disabled: !!trashPending }, '关闭'))))
      : null
    }
