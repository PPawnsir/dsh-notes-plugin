    // ===== modal: archive —— 归档预览对话框（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.archive / archOpenRef / setArchOpen / setArchGroups / setArchChecked / setArchExpand / setArchPending / openArchive / ArchiveModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/format.js（fmtBytes）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）
    // state 托管：open/groups/checked/expand/pending 迁入 store.modal.archive 切片；archOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 归档后清理 afterArchiveCleanup 属面板多选/选中域（滞留 whole.js），经 panelBridge 中转；
    // doArchiveUndo 在本组件渲染期回填 panelBridge——merge modal 的撤销 toast 经 kernel 转发别名调最新实例（禁横向引用）
    store.modal.archive = createStore({ open: false, groups: null, checked: {}, expand: {}, pending: false })
    const archOpenRef = { current: false }   // 归档预览对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setArchOpen(v) { const nv = typeof v === 'function' ? v(archOpenRef.current) : v; archOpenRef.current = nv; store.modal.archive.set({ open: nv }) }
    function setArchGroups(v) { store.modal.archive.set({ groups: typeof v === 'function' ? v(store.modal.archive.get().groups) : v }) }
    function setArchChecked(v) { store.modal.archive.set({ checked: typeof v === 'function' ? v(store.modal.archive.get().checked) : v }) }
    function setArchExpand(v) { store.modal.archive.set({ expand: typeof v === 'function' ? v(store.modal.archive.get().expand) : v }) }
    function setArchPending(v) { store.modal.archive.set({ pending: typeof v === 'function' ? v(store.modal.archive.get().pending) : v }) }
    // 打开归档预览（替代旧的直接执行）：dry-run 拉速记组（notes-archive-preview 零写入），默认全勾
    async function openArchive() {
      setError(''); setArchOpen(true); setArchGroups(null); setArchChecked({}); setArchExpand({}); setArchPending(false)
      try {
        const res = await host.call('notes-archive-preview')
        if (res && res.error) { setError(res.error); setArchGroups([]); return }
        setArchGroups((res && res.quickGroups) || [])
      } catch (err) { setError(String(err.message || err)); setArchGroups([]) }
    }
    // 归档预览对话框宿主（标题栏「归档」入口）
    function ArchiveModal(props) {
      const tt = useT()   // i18n 覆盖卡E：订阅 langStore，切语言本卡自渲染（模块级 handler 走 t() 直读当下语言态）
      const archOpen = store.modal.archive.useSel(s => s.open)
      const archGroups = store.modal.archive.useSel(s => s.groups)
      const archChecked = store.modal.archive.useSel(s => s.checked)
      const archExpand = store.modal.archive.useSel(s => s.expand)
      const archPending = store.modal.archive.useSel(s => s.pending)
      const error = props.error
      // 撤销最近一次归档（undo 事务文件）：归档笔记软删 + 成员批量恢复
      async function doArchiveUndo() {
        try {
          const res = await host.call('notes-archive-undo')
          if (res && res.error) { setError(res.error); return }
          showToast(res && res.undone ? t('arch.undone') : t('arch.noUndo'))
          await panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) }
      }
      // 回填 panelBridge：本组件卸载/面板关闭后 toast「撤销」仍可调（bridge 持有最近一次渲染的实例，与昔日闭包捕获语义等价）
      panelBridge.doArchiveUndo = doArchiveUndo
      // 确认归档：勾选组 → notes-archive 白名单组（host 先全量校验再动手）→ toast「已合并 N 组」+ 撤销按钮
      async function doArchiveConfirm() {
        const gs = (archGroups || []).filter(g => archChecked[g.sessionId] !== false)
        if (!gs.length || archPending) return
        setArchPending(true)
        try {
          // payload 禁 undefined：白名单组不带 title（用 host 默认标题规则）
          const res = await host.call('notes-archive', { groups: gs.map(g => ({ memberIds: g.members.map(m => m.id) })) })
          if (res && res.error) { setError(res.error); setArchPending(false); return }
          setArchOpen(false); setArchPending(false)
          showToast(t('arch.merged', { n: res.merged || 0 }), { label: t('meta.undo'), fn: doArchiveUndo })
          panelBridge.afterArchiveCleanup(gs.reduce((acc, g) => acc.concat(g.members.map(m => m.id)), []))
          await panelBridge.loadNotes(true); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)); setArchPending(false) }
      }
      // 归档预览对话框（标题栏「归档」→ notes-archive-preview dry-run，零写入）：速记组列表默认全勾——
      // 组行 = 复选框 + 展开 caret + 组标题 + dateSpan · N 条 · totalBytes；caret 展开成员明细（标题+日期）；
      // 底部提示手动笔记走多选合并；「归档所选（N 组）」确认才执行（notes-archive 白名单组）
      return archOpen ? (() => {
        const groups = archGroups || []
        const checkedCount = groups.filter(g => archChecked[g.sessionId] !== false).length
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setArchOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('check', 14), ' ' + tt('arch.title'), e('span', { className: 'dsh-notes-imgup-sub' }, tt('arch.sub'))),
            e('div', { className: 'dsh-notes-data-hint' }, tt('arch.hintClient')),
            archGroups === null
              ? e('div', { className: 'dsh-notes-data-hint' }, tt('common.loading'))
              : groups.length === 0
                ? e('div', { className: 'dsh-notes-data-hint' }, tt('arch.empty'))
                : e('div', { className: 'dsh-notes-arch-list' },
                    groups.map(g => {
                      const checked = archChecked[g.sessionId] !== false
                      const expanded = archExpand[g.sessionId] === true
                      const span = g.dateSpan && g.dateSpan.from ? (g.dateSpan.from === g.dateSpan.to ? g.dateSpan.from : g.dateSpan.from + ' ~ ' + g.dateSpan.to) : ''
                      return e('div', { key: g.sessionId, className: 'dsh-notes-arch-group' + (checked ? '' : ' off') },
                        e('div', { className: 'dsh-notes-arch-row' },
                          e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: checked, onChange: () => setArchChecked(Object.assign({}, archChecked, { [g.sessionId]: !checked })) }),
                          e('span', { className: 'dsh-notes-caret' + (expanded ? ' open' : ''), onClick: () => setArchExpand(Object.assign({}, archExpand, { [g.sessionId]: !expanded })) }, I('chev', 10)),
                          e('span', { className: 'dsh-notes-arch-ti', title: g.title }, g.title),
                          e('span', { className: 'dsh-notes-arch-meta' }, tt('arch.groupMeta', { span: span, n: g.members.length, size: fmtBytes(g.totalBytes) }) + ((g.totalUseCount || 0) > 0 ? tt('arch.groupUseCount', { n: g.totalUseCount }) : ''))),
                        expanded ? e('div', { className: 'dsh-notes-arch-members' },
                          g.members.map(m => e('div', { key: m.id, className: 'dsh-notes-arch-member' },
                            e('span', { className: 'dsh-notes-arch-member-ti' }, m.title || tt('tree.untitled')),
                            e('span', { className: 'dsh-notes-arch-member-dt' }, fmtDT(m.updatedAt).slice(0, 10))))) : null)
                    })),
            e('div', { className: 'dsh-notes-data-hint' }, tt('arch.manualHint')),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setArchOpen(false) }, tt('common.cancel')),
              e('button', { className: 'dsh-notes-dispatch-ok', onClick: doArchiveConfirm, disabled: archPending || checkedCount === 0 }, archPending ? tt('arch.archiving') : tt('arch.okCount', { n: checkedCount })))))
      })()
      : null
    }
