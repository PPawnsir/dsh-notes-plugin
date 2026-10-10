    // ===== modal: export —— 导出全部笔记对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.export / exportOpenRef / setExportOpen / setExportDir / setExportSecret / setExportPending / openExport / doExport / ExportModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：open/dir/secret/pending 迁入 store.modal.export 切片；exportOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 与设置卡片互斥经 panelBridge.setSettingsOpen 中转（禁横向引用）
    // secret = 「包含机密明文」开关（文档安全 S2 notes-052-pipeline-mask）：缺省关不反向——明文导出需显式勾选；缺省导出时 secret span 同形态占位
    store.modal.export = createStore({ open: false, dir: '', secret: false, pending: false })
    const exportOpenRef = { current: false }   // 导出对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setExportOpen(v) { const nv = typeof v === 'function' ? v(exportOpenRef.current) : v; exportOpenRef.current = nv; store.modal.export.set({ open: nv }) }
    function setExportDir(v) { store.modal.export.set({ dir: typeof v === 'function' ? v(store.modal.export.get().dir) : v }) }
    function setExportSecret(v) { store.modal.export.set({ secret: typeof v === 'function' ? v(store.modal.export.get().secret) : v }) }
    function setExportPending(v) { store.modal.export.set({ pending: typeof v === 'function' ? v(store.modal.export.get().pending) : v }) }
    // ===== 数据导入/导出（设置卡片「数据」区入口）=====
    // 导出：打开对话框时回填上次导出目录（localStorage 记忆）；确认 → notes-export → toast 含快照目录路径
    function openExport() {
      let last = ''
      try { last = localStorage.getItem('dsh-notes-last-export-dir') || '' } catch (err) {}
      setExportDir(last); setExportSecret(false); setExportPending(false); setError('')
      panelBridge.setSettingsOpen(false); setExportOpen(true)   // 与设置卡片互斥：modal 不叠 modal
    }
    // 导出对话框宿主（设置卡片「数据」区入口；mask/modal 复用设置卡片风格）：选目标目录 → notes-export → 成功 toast 含快照路径
    function ExportModal(props) {
      const exportOpen = store.modal.export.useSel(s => s.open)
      const exportDir = store.modal.export.useSel(s => s.dir)
      const exportSecret = store.modal.export.useSel(s => s.secret)
      const exportPending = store.modal.export.useSel(s => s.pending)
      const error = props.error
      async function doExport() {
        const dir = exportDir.trim()
        if (!dir || exportPending) return
        setExportPending(true); setError('')
        try {
          const res = await host.call('notes-export', Object.assign({ dir: dir }, exportSecret ? { includeSecret: true } : {}))   // payload 不传 undefined 字段
          if (res && res.error) { setError(res.error); return }
          try { localStorage.setItem('dsh-notes-last-export-dir', dir) } catch (err) {}
          setExportOpen(false)
          showToast('已导出 ' + (res.exported || 0) + ' 条笔记到 ' + (res.target || dir) + (res.maskedSpans ? '（机密区已打码 ' + res.maskedSpans + ' 处，明文导出需勾选「包含机密明文」）' : ''))
        } catch (err) { setError(String(err.message || err)) } finally { setExportPending(false) }
      }
      return exportOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setExportOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('up', 14), ' 导出全部笔记'),
          e('div', { className: 'dsh-notes-data-hint' }, '把整个笔记库（含 folders.json）完整快照到目标目录下的 dsh-notes-export-<时间戳> 子目录，不打包不压缩，目录即格式。'),
          e('label', { className: 'dsh-notes-settings-checkwrap dsh-nt', 'data-tooltip': '缺省导出时正文里的机密区（secret span）替换为占位行；勾选后才导出明文' },
            e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: exportSecret, onChange: (ev) => setExportSecret(!!ev.target.checked) }),
            '包含机密明文（缺省打码机密区）'),
          e('input', { className: 'dsh-notes-data-input', placeholder: '目标目录，如 D:\\backup 或桌面路径…', value: exportDir, autoFocus: true, onChange: (ev) => setExportDir(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doExport() } } }),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setExportOpen(false) }, '取消'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doExport, disabled: exportPending || !exportDir.trim() }, exportPending ? '导出中…' : '导出'))))
      : null
    }
