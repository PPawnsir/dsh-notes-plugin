    // ===== modal: merge —— 多选合并标题输入框（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.merge / mergeOpenRef / setMergeOpen / setMergeTitle / setMergePending / openMerge / MergeModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged + doArchiveUndo 别名）
    // state 托管：open/title/pending 迁入 store.modal.merge 切片；mergeOpenRef 为 Esc 栈同步镜像（模块级单例）
    // 多选集合 selIds / 笔记清单 notes 是面板多选域状态（滞留 whole.js）：打开时经 panelBridge 读快照，弹窗内经 props 订阅
    store.modal.merge = createStore({ open: false, title: '', pending: false })
    const mergeOpenRef = { current: false }   // 多选合并对话框镜像（Esc 优先关）
    function setMergeOpen(v) { const nv = typeof v === 'function' ? v(mergeOpenRef.current) : v; mergeOpenRef.current = nv; store.modal.merge.set({ open: nv }) }
    function setMergeTitle(v) { store.modal.merge.set({ title: typeof v === 'function' ? v(store.modal.merge.get().title) : v }) }
    function setMergePending(v) { store.modal.merge.set({ pending: typeof v === 'function' ? v(store.modal.merge.get().pending) : v }) }
    // 打开合并标题输入框：默认标题 = 所选笔记中最早更新者的首枚有效标签（0.4.8 主题并入标签后同口径：effTagsUi = tags ∪ topic，剔占位）
    function openMerge() {
      const selIdsNow = panelBridge.selIds || {}
      const ids = Object.keys(selIdsNow)
      if (ids.length < 2) { showToast('至少选择 2 条笔记'); return }
      const sel = (panelBridge.notes || []).filter(n => selIdsNow[n.id]).sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
      setMergeTitle((sel[0] && effTagsUi(sel[0])[0]) || '合并笔记'); setMergePending(false); setError(''); setMergeOpen(true)
    }
    // 多选合并标题输入框宿主（多选操作条「合并」入口）
    function MergeModal(props) {
      const mergeOpen = store.modal.merge.useSel(s => s.open)
      const mergeTitle = store.modal.merge.useSel(s => s.title)
      const mergePending = store.modal.merge.useSel(s => s.pending)
      const error = props.error
      const selIds = props.selIds || {}
      async function doMergeConfirm() {
        const ids = Object.keys(selIds)
        const t = mergeTitle.trim()
        if (ids.length < 2 || mergePending || !t) return
        setMergePending(true)
        try {
          const g = { memberIds: ids }; if (t) g.title = t   // payload 禁 undefined：空标题不传 title 字段
          const res = await host.call('notes-archive', { groups: [g] })
          if (res && res.error) { setError(res.error); setMergePending(false); return }
          setMergeOpen(false); setMergePending(false); panelBridge.setSelMode(false)
          showToast('已合并所选 ' + ids.length + ' 条', { label: '撤销', fn: doArchiveUndo })
          panelBridge.afterArchiveCleanup(ids)
          await panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)); setMergePending(false) }
      }
      // 多选合并标题输入框（多选操作条「合并」入口）：默认标题 = 所选最早更新笔记的 topic，可改；Enter 确认
      return mergeOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setMergeOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('note', 14), ' 合并所选笔记'),
          e('div', { className: 'dsh-notes-data-hint' }, '把所选的 ' + Object.keys(selIds).length + ' 条笔记合并为一篇（正文按更新时间分节拼接，原笔记软删除，可撤销）。'),
          e('input', { className: 'dsh-notes-data-input', placeholder: '合并后标题…', value: mergeTitle, autoFocus: true, onChange: (ev) => setMergeTitle(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doMergeConfirm() } } }),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setMergeOpen(false) }, '取消'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doMergeConfirm, disabled: mergePending || !mergeTitle.trim() }, mergePending ? '合并中…' : '合并'))))
      : null
    }
