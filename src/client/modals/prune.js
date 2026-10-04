    // ===== modal: prune —— 孤儿资产清理弹窗（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.prune / pruneOpenRef / setPruneOpen / setPruneData / setPruneChecked / setPrunePending / openPrune / PruneModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/format.js（fmtBytes）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：open/data/checked/pending 迁入 store.modal.prune 切片；pruneOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 与设置卡片互斥经 panelBridge.setSettingsOpen 中转（设置卡滞留 whole.js，D2 再迁）
    store.modal.prune = createStore({ open: false, data: null, checked: {}, pending: false })
    const pruneOpenRef = { current: false }   // 资产清理对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setPruneOpen(v) { const nv = typeof v === 'function' ? v(pruneOpenRef.current) : v; pruneOpenRef.current = nv; store.modal.prune.set({ open: nv }) }
    function setPruneData(v) { store.modal.prune.set({ data: typeof v === 'function' ? v(store.modal.prune.get().data) : v }) }
    function setPruneChecked(v) { store.modal.prune.set({ checked: typeof v === 'function' ? v(store.modal.prune.get().checked) : v }) }
    function setPrunePending(v) { store.modal.prune.set({ pending: typeof v === 'function' ? v(store.modal.prune.get().pending) : v }) }
    // ===== 二期 孤儿资产清理（设置卡片「资产清理」入口）：dry-run 预览（零写入）→ 勾选 → 白名单执行 =====
    // 契约：notes-assets-prune 缺省 dryRun=true 返回 { orphans:[{name,bytes}], totalBytes, referenced, tombstoned, notes }；
    // 执行 dryRun:false + files 白名单（host 调用内重扫实时孤儿防漂移；软删除笔记的引用也计入保护，宁留勿删）。
    function openPrune() {
      setPruneData(null); setPruneChecked({}); setPrunePending(false); setError('')
      panelBridge.setSettingsOpen(false); setPruneOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
      host.call('notes-assets-prune', { dryRun: true }).then(res => {
        if (res && res.error) { setError(res.error); setPruneData({ orphans: [], totalBytes: 0 }); return }
        setPruneData(res || { orphans: [], totalBytes: 0 })
      }).catch(err => { setError(String(err.message || err)); setPruneData({ orphans: [], totalBytes: 0 }) })
    }
    // 资产清理对话框宿主（设置卡片「资产清理」入口；复用归档预览的列表样式）
    function PruneModal(props) {
      const pruneOpen = store.modal.prune.useSel(s => s.open)
      const pruneData = store.modal.prune.useSel(s => s.data)
      const pruneChecked = store.modal.prune.useSel(s => s.checked)
      const prunePending = store.modal.prune.useSel(s => s.pending)
      const error = props.error
      async function doPruneConfirm() {
        const orphans = (pruneData && pruneData.orphans) || []
        const files = orphans.filter(o => pruneChecked[o.name] !== false).map(o => o.name)
        if (!files.length || prunePending) return
        setPrunePending(true)
        try {
          const res = await host.call('notes-assets-prune', { dryRun: false, files: files })
          if (res && res.error) { setError(res.error); setPrunePending(false); return }
          setPruneOpen(false); setPrunePending(false)
          showToast('已清理 ' + ((res.deleted || []).length) + ' 个孤儿资产，释放 ' + fmtBytes(res.freedBytes || 0) + ((res.modes && res.modes.tombstoned) ? '（开发版为清空占位）' : ''))
        } catch (err) { setError(String(err.message || err)); setPrunePending(false) }
      }
      // 资产清理对话框（设置卡片「资产清理」入口；复用归档预览的列表样式）：dry-run 孤儿清单默认全勾，
      // 行 = 复选框 + 文件名 + 字节数；底部统计扫描笔记数/引用中/墓碑；「删除所选（N 项 · x KB）」danger 确认才执行
      return pruneOpen ? (() => {
        const orphans = (pruneData && pruneData.orphans) || []
        const checked = orphans.filter(o => pruneChecked[o.name] !== false)
        const checkedBytes = checked.reduce((s, o) => s + (o.bytes || 0), 0)
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !prunePending) setPruneOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-arch-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('trash', 14), ' 资产清理', e('span', { className: 'dsh-notes-imgup-sub' }, '预览勾选后才删除 · 宁留勿删')),
            e('div', { className: 'dsh-notes-data-hint' }, 'assets/ 中未被任何笔记正文引用的文件（已删除笔记的引用仍计入保护）。' + (pruneData && pruneData.notes != null ? '已扫描 ' + pruneData.notes + ' 条笔记：引用中 ' + (pruneData.referenced || 0) + ' 个，历史清理占位 ' + (pruneData.tombstoned || 0) + ' 个。' : '')),
            pruneData === null
              ? e('div', { className: 'dsh-notes-data-hint' }, '扫描中…')
              : orphans.length === 0
                ? e('div', { className: 'dsh-notes-data-hint' }, '没有孤儿资产（assets/ 全部文件均被引用）。')
                : e('div', { className: 'dsh-notes-arch-list' },
                    orphans.map(o => e('div', { key: o.name, className: 'dsh-notes-arch-row' },
                      e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: pruneChecked[o.name] !== false, onChange: () => setPruneChecked(Object.assign({}, pruneChecked, { [o.name]: pruneChecked[o.name] === false })) }),
                      e('span', { className: 'dsh-notes-arch-ti', title: o.name }, o.name),
                      e('span', { className: 'dsh-notes-arch-meta' }, fmtBytes(o.bytes))))),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setPruneOpen(false), disabled: prunePending }, '取消'),
              e('button', { className: 'dsh-notes-data-danger', onClick: doPruneConfirm, disabled: prunePending || checked.length === 0 }, prunePending ? '删除中…' : '删除所选（' + checked.length + ' 项 · ' + fmtBytes(checkedBytes) + '）'))))
      })()
      : null
    }
