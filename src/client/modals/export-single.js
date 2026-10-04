    // ===== modal: export-single —— 单文件导出对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.exportSingle / sExportOpenRef / setSExportOpen / setSExportDir / setSExportScope / setSExportFolder / setSExportTag / setSExportToc / setSExportPending / openSExport / SExportModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：open/dir/scope/folder/tag/toc/pending 迁入 store.modal.exportSingle 切片；sExportOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 标签/文件夹选项数据源（notes/folders）属面板域，经 props 注入（禁横向引用）；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.exportSingle = createStore({ open: false, dir: '', scope: 'all', folder: '', tag: '', toc: true, pending: false })
    const sExportOpenRef = { current: false }   // P3 单文件导出对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setSExportOpen(v) { const nv = typeof v === 'function' ? v(sExportOpenRef.current) : v; sExportOpenRef.current = nv; store.modal.exportSingle.set({ open: nv }) }
    function setSExportDir(v) { store.modal.exportSingle.set({ dir: typeof v === 'function' ? v(store.modal.exportSingle.get().dir) : v }) }
    function setSExportScope(v) { store.modal.exportSingle.set({ scope: typeof v === 'function' ? v(store.modal.exportSingle.get().scope) : v }) }
    function setSExportFolder(v) { store.modal.exportSingle.set({ folder: typeof v === 'function' ? v(store.modal.exportSingle.get().folder) : v }) }
    function setSExportTag(v) { store.modal.exportSingle.set({ tag: typeof v === 'function' ? v(store.modal.exportSingle.get().tag) : v }) }
    function setSExportToc(v) { store.modal.exportSingle.set({ toc: typeof v === 'function' ? v(store.modal.exportSingle.get().toc) : v }) }
    function setSExportPending(v) { store.modal.exportSingle.set({ pending: typeof v === 'function' ? v(store.modal.exportSingle.get().pending) : v }) }
    // P3 单文件导出（设置卡片「数据」区入口；复用导出 modal 模式）：选 scope（全部/文件夹/标签）+ 目录 → notes-export-single → toast 含文件路径（>20MB 带 warning）
    function openSExport() {
      let last = ''
      try { last = localStorage.getItem('dsh-notes-last-export-single-dir') || '' } catch (err) {}
      setSExportDir(last); setSExportScope('all'); setSExportFolder(''); setSExportTag(''); setSExportToc(true); setSExportPending(false); setError('')
      panelBridge.setSettingsOpen(false); setSExportOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
    }
    // P3 单文件导出对话框宿主（设置卡片「数据」区「导出单文件…」入口；mask/modal 复用导出对话框风格）：
    // scope 三选一（全部/文件夹/标签，联动下拉）+ 目录页开关 + 目标目录 → notes-export-single → toast 含文件路径（>20MB 带 warning）
    function SExportModal(props) {
      const sExportOpen = store.modal.exportSingle.useSel(s => s.open)
      const sExportDir = store.modal.exportSingle.useSel(s => s.dir)
      const sExportScope = store.modal.exportSingle.useSel(s => s.scope)
      const sExportFolder = store.modal.exportSingle.useSel(s => s.folder)
      const sExportTag = store.modal.exportSingle.useSel(s => s.tag)
      const sExportToc = store.modal.exportSingle.useSel(s => s.toc)
      const sExportPending = store.modal.exportSingle.useSel(s => s.pending)
      const error = props.error
      const notes = props.notes || []
      const folders = props.folders || []
      async function doSExport() {
        const dir = sExportDir.trim()
        if (!dir || sExportPending) return
        if (sExportScope === 'folder' && !sExportFolder) { setError('请选择文件夹'); return }
        if (sExportScope === 'tag' && !sExportTag) { setError('请选择标签'); return }
        setSExportPending(true); setError('')
        try {
          const scope = sExportScope === 'folder' ? { folder: sExportFolder } : (sExportScope === 'tag' ? { tag: sExportTag } : { all: true })
          const res = await host.call('notes-export-single', { dir: dir, scope: scope, format: 'md', toc: sExportToc })   // payload 不传 undefined 字段
          if (res && res.error) { setError(res.error); return }
          try { localStorage.setItem('dsh-notes-last-export-single-dir', dir) } catch (err) {}
          setSExportOpen(false)
          showToast('已导出 ' + (res.exported || 0) + ' 篇到 ' + (res.target || dir) + (res.warning ? '；⚠ ' + res.warning : ''))
        } catch (err) { setError(String(err.message || err)) } finally { setSExportPending(false) }
      }
      return sExportOpen ? (() => {
        const tagSet = {}
        for (const n of notes) for (const tg of (n.tags || [])) tagSet[tg] = true
        const tagOptions = Object.keys(tagSet).sort()
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setSExportOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('note', 14), ' 导出单文件'),
            e('div', { className: 'dsh-notes-data-hint' }, '把所选范围的笔记拼接为单个 Markdown 文件（每篇 = 标题 + 元信息 + 正文，篇间分隔线）：图片 base64 内联、零外部依赖，可直接分享。超过 20MB 会告警但仍照常导出。'),
            e('div', { className: 'dsh-notes-dispatch-modes' },
              [['all', '全部'], ['folder', '按文件夹'], ['tag', '按标签']].map(pair => e('button', { key: pair[0], className: 'dsh-notes-dispatch-mode' + (sExportScope === pair[0] ? ' on' : ''), onClick: () => setSExportScope(pair[0]) }, pair[1]))),
            sExportScope === 'folder' ? e('select', { className: 'dsh-notes-dispatch-select', value: sExportFolder, onChange: (ev) => setSExportFolder(ev.target.value) },
              e('option', { value: '' }, '选择文件夹…'),
              folders.map(f => e('option', { key: f.id, value: f.id }, f.name + '（' + (f.count || 0) + '）')))
            : null,
            sExportScope === 'tag' ? e('select', { className: 'dsh-notes-dispatch-select', value: sExportTag, onChange: (ev) => setSExportTag(ev.target.value) },
              e('option', { value: '' }, tagOptions.length ? '选择标签…' : '（笔记暂无标签）'),
              tagOptions.map(tg => e('option', { key: tg, value: tg }, tg)))
            : null,
            e('label', { className: 'dsh-notes-settings-checkwrap dsh-nt', 'data-tooltip': '在文档头部生成目录页（篇名 + id 清单）' },
              e('input', { type: 'checkbox', className: 'dsh-notes-settings-check', checked: sExportToc, onChange: (ev) => setSExportToc(!!ev.target.checked) }),
              '生成目录页'),
            e('input', { className: 'dsh-notes-data-input', placeholder: '目标目录，如 D:\\backup 或桌面路径…', value: sExportDir, autoFocus: true, onChange: (ev) => setSExportDir(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doSExport() } } }),
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setSExportOpen(false) }, '取消'),
              e('button', { className: 'dsh-notes-dispatch-ok', onClick: doSExport, disabled: sExportPending || !sExportDir.trim() || (sExportScope === 'folder' && !sExportFolder) || (sExportScope === 'tag' && !sExportTag) }, sExportPending ? '导出中…' : '导出'))))
      })()
      : null
    }
