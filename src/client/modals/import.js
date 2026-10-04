    // ===== modal: import —— 导入笔记对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.import / importOpenRef / setImportOpen / setImportDir / setImportPreview / setImportOverwrite / setImportPending / openImport / ImportModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）
    // state 托管：open/dir/preview/overwrite/pending 迁入 store.modal.import 切片；importOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 导入完成后列表/文件夹刷新经 panelBridge.loadNotes/loadFolders 中转；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.import = createStore({ open: false, dir: '', preview: null, overwrite: false, pending: false })
    const importOpenRef = { current: false }   // 导入对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setImportOpen(v) { const nv = typeof v === 'function' ? v(importOpenRef.current) : v; importOpenRef.current = nv; store.modal.import.set({ open: nv }) }
    function setImportDir(v) { store.modal.import.set({ dir: typeof v === 'function' ? v(store.modal.import.get().dir) : v }) }
    function setImportPreview(v) { store.modal.import.set({ preview: typeof v === 'function' ? v(store.modal.import.get().preview) : v }) }
    function setImportOverwrite(v) { store.modal.import.set({ overwrite: typeof v === 'function' ? v(store.modal.import.get().overwrite) : v }) }
    function setImportPending(v) { store.modal.import.set({ pending: typeof v === 'function' ? v(store.modal.import.get().pending) : v }) }
    // 导入两步式：第一步选目录 → notes-import-preview 出预览；第二步勾选覆盖 → notes-import 执行
    function openImport() {
      setImportDir(''); setImportPreview(null); setImportOverwrite(false); setImportPending(false); setError('')
      panelBridge.setSettingsOpen(false); setImportOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
    }
    // 导入对话框宿主（两步式）：第一步选目录 → notes-import-preview 预览明细（新增/相同/不同 + 文件夹合并统计）；
    // 第二步勾选「覆盖内容不同的笔记」（默认不勾）→ danger 按钮执行 notes-import → toast 含备份目录提示 → 刷新列表/文件夹
    function ImportModal(props) {
      const importOpen = store.modal.import.useSel(s => s.open)
      const importDir = store.modal.import.useSel(s => s.dir)
      const importPreview = store.modal.import.useSel(s => s.preview)
      const importOverwrite = store.modal.import.useSel(s => s.overwrite)
      const importPending = store.modal.import.useSel(s => s.pending)
      const error = props.error
      async function doImportPreview() {
        const dir = importDir.trim()
        if (!dir || importPending) return
        setImportPending(true); setError('')
        try {
          const res = await host.call('notes-import-preview', { dir: dir })
          if (res && res.error) { setError(res.error); return }
          if (!res.total) { setError('该目录没有可导入的笔记：' + dir); return }
          setImportPreview(res); setImportOverwrite(false)   // 每次新预览重置覆盖勾选（默认不勾）
        } catch (err) { setError(String(err.message || err)) } finally { setImportPending(false) }
      }
      async function doImportExecute() {
        const dir = importDir.trim()
        if (!dir || !importPreview || importPending) return
        setImportPending(true); setError('')
        try {
          const res = await host.call('notes-import', { dir: dir, overwrite: !!importOverwrite })
          if (res && res.error) { setError(res.error); return }
          setImportOpen(false); setImportPreview(null)
          const got = (res.imported || 0) + (res.overwritten || 0)
          const skipped = (res.skippedSame || 0) + (res.skippedDiff || 0)
          const bak = String(res.backupDir || '').split(/[\\/]/).filter(Boolean).pop() || ''   // toast 只带备份目录名（全路径过长）
          showToast('已导入 ' + got + ' 条（跳过 ' + skipped + ' 条）' + (res.foldersMerged ? '，合并文件夹 ' + res.foldersMerged + ' 个' : '') + (bak ? '，已自动备份到 ' + bak : ''))
          await panelBridge.loadNotes(true); panelBridge.loadFolders(); notifyNotesChanged()
        } catch (err) { setError(String(err.message || err)) } finally { setImportPending(false) }
      }
      return importOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setImportOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('down', 14), ' 导入笔记'),
          e('div', { className: 'dsh-notes-data-hint' }, '从目录快照导入（只增改不删）：库中不存在的直接入库，内容相同的跳过，内容不同的默认跳过；执行前自动全量备份当前库。'),
          e('input', { className: 'dsh-notes-data-input', placeholder: '来源目录（dsh-notes-export-… 或 notes-backup-… 目录）…', value: importDir, autoFocus: true, onChange: (ev) => { setImportDir(ev.target.value); if (importPreview) setImportPreview(null) }, onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doImportPreview() } } }),
          importPreview ? (() => {
            const IMP_STATUS_LABELS = { added: '新增', same: '相同', diff: '不同' }
            const folders = importPreview.folders || { total: 0, new: 0 }
            return e(React.Fragment, null,
              e('div', { className: 'dsh-notes-data-summary' },
                e('span', { className: 'added' }, '新增 ', e('b', null, importPreview.added)),
                e('span', null, '相同 ', e('b', null, importPreview.same)),
                e('span', { className: importPreview.diff ? 'diff' : '' }, '不同 ', e('b', null, importPreview.diff)),
                folders.total ? e('span', null, '文件夹新增 ', e('b', null, folders.new), ' / 共 ' + folders.total) : null),
              importPreview.unreadable ? e('div', { className: 'dsh-notes-data-warn' }, '⚠ ' + importPreview.unreadable + ' 个文件无法读取，已跳过') : null,
              e('div', { className: 'dsh-notes-imp-list' },
                (importPreview.detail || []).map(d => e('div', { key: d.id, className: 'dsh-notes-imp-row' },
                  e('span', { className: 'dsh-notes-imp-badge ' + d.status }, IMP_STATUS_LABELS[d.status] || d.status),
                  e('span', { className: 'dsh-notes-imp-title', title: d.title || 'Untitled' }, d.title || 'Untitled'),
                  d.deleted ? e('span', { className: 'dsh-notes-imp-deltag' }, '已删除') : null))),
              e('label', { className: 'dsh-notes-settings-checkwrap dsh-notes-imp-overwrite' + (importPreview.diff ? '' : ' off') },
                e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: importOverwrite, disabled: !importPreview.diff, onChange: (ev) => setImportOverwrite(!!ev.target.checked) }),
                '覆盖内容不同的笔记（' + importPreview.diff + ' 条，不勾则跳过）'),
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setImportOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-data-danger', onClick: doImportExecute, disabled: importPending }, importPending ? '导入中…' : '执行导入')))
          })()
          : e(React.Fragment, null,
              error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
              e('div', { className: 'dsh-notes-dispatch-actions' },
                e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setImportOpen(false) }, '取消'),
                e('button', { className: 'dsh-notes-dispatch-ok', onClick: doImportPreview, disabled: importPending || !importDir.trim() }, importPending ? '检查中…' : '预览')))))
      : null
    }
