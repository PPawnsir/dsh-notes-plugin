    // ===== modal: history —— 历史版本面板（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.history / histOpenRef / setHistOpen / setHistList / setHistSel / setHistPreview / setHistPending / openHistory / selectHistVersion / HistoryModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError/wikiResolve 别名/selectedRef）、kernel/format.js（fmtHistTs/fmtBytes）、
    //        kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）、editor-kernel.js（renderMarkdown）
    // state 托管：open/list/sel/preview/pending 迁入 store.modal.history 切片；histOpenRef 为 Esc 栈同步镜像（模块级单例）。
    // 入口计数探测 probeHistCount 与恢复回填 applyRestoredBody 属面板/编辑器域（滞留 whole.js），经 panelBridge 中转；
    // histCount（meta 行入口可见性）滞留 whole.js，本模块经 panelBridge.histCountRef/setHistCount 同步
    store.modal.history = createStore({ open: false, list: null, sel: 0, preview: null, pending: false })
    const histOpenRef = { current: false }   // 历史版本面板镜像（Esc 优先关）
    function setHistOpen(v) { const nv = typeof v === 'function' ? v(histOpenRef.current) : v; histOpenRef.current = nv; store.modal.history.set({ open: nv }) }
    function setHistList(v) { store.modal.history.set({ list: typeof v === 'function' ? v(store.modal.history.get().list) : v }) }
    function setHistSel(v) { store.modal.history.set({ sel: typeof v === 'function' ? v(store.modal.history.get().sel) : v }) }
    function setHistPreview(v) { store.modal.history.set({ preview: typeof v === 'function' ? v(store.modal.history.get().preview) : v }) }
    function setHistPending(v) { store.modal.history.set({ pending: typeof v === 'function' ? v(store.modal.history.get().pending) : v }) }
    // 打开历史面板：重置态 → 拉版本列表（默认选中最新版并加载预览）
    function openHistory() {
      const id = selectedRef.current
      if (!id) { showToast('先选择一条笔记'); return }
      setHistList(null); setHistSel(0); setHistPreview(null); setHistPending(false); setError('')
      setHistOpen(true)
      host.call('notes-history', { id: id }).then(res => {
        if (res && res.error) { setError(res.error); setHistList([]); return }
        const vs = (res && res.versions) || []
        setHistList(vs)
        panelBridge.histCountRef.current = vs.length; panelBridge.setHistCount(vs.length)
        if (vs.length) selectHistVersion(vs[0].ts)
      }).catch(err => { setError(String(err.message || err)); setHistList([]) })
    }
    // 点选版本 → notes-history-get 拉该版正文（只读预览；渲染走 renderMarkdown 内核，全量转义零注入面）
    function selectHistVersion(ts) {
      setHistSel(ts); setHistPreview(null)
      host.call('notes-history-get', { id: selectedRef.current, ts: ts }).then(res => {
        if (res && res.error) { setError(res.error); return }
        if (res) setHistPreview({ ts: ts, body: res.body || '' })
      }).catch(err => setError(String(err.message || err)))
    }
    // 历史版本面板宿主（详情 meta 行「历史」入口；mask/modal 复用设置卡片风格）：
    // 左列版本列表（时间+大小，倒序）→ 点选右侧只读预览 →「恢复此版本」confirm 后 notes-restore-history
    function HistoryModal(props) {
      const histOpen = store.modal.history.useSel(s => s.open)
      const histList = store.modal.history.useSel(s => s.list)
      const histSel = store.modal.history.useSel(s => s.sel)
      const histPreview = store.modal.history.useSel(s => s.preview)
      const histPending = store.modal.history.useSel(s => s.pending)
      const error = props.error
      // 一键恢复：confirm（明示"当前版本会先自动快照，可再撤销"）→ notes-restore-history → 刷新正文与列表 + toast
      // 恢复回填走 panelBridge.applyRestoredBody（whole.js 编辑器域；恢复版已由 host 落盘，不走自动保存）
      async function doRestoreHistory() {
        const id = selectedRef.current
        const ts0 = histSel
        if (histPending || !ts0 || !id) return
        if (!window.confirm('恢复到 ' + fmtHistTs(ts0) + ' 的版本？\n当前版本会先自动快照进历史版本，可再撤销（重新打开历史恢复回滚）。')) return
        setHistPending(true); setError('')
        try {
          const res = await host.call('notes-restore-history', { id: id, ts: ts0 })
          if (res && res.error) { setError(res.error); return }
          setHistOpen(false)
          // 恢复已由 host 落盘（恢复前当前版已自动快照）：本地只回填编辑器，不触发自动保存
          const g = await host.call('notes-get', { id: id })
          if (g && g.note && selectedRef.current === id) panelBridge.applyRestoredBody(id, g.note.body || '')
          await panelBridge.loadNotes(true); notifyNotesChanged()
          panelBridge.probeHistCount(id)   // 恢复前置快照使版本数 +1，重探刷新入口计数
          showToast('已恢复到 ' + fmtHistTs(ts0) + ' 的版本（原当前版已自动快照，可再恢复回滚）')
        } catch (err) { setError(String(err.message || err)) } finally { setHistPending(false) }
      }
      return histOpen ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setHistOpen(false) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-hist-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('clock', 14), ' 历史版本', e('span', { className: 'dsh-notes-imgup-sub' }, '每次保存自动留快照 · 恢复前当前版本会先自动快照，可再撤销')),
          e('div', { className: 'dsh-notes-hist-body' },
            e('div', { className: 'dsh-notes-hist-list' },
              histList === null
                ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
                : !histList.length
                  ? e('div', { className: 'dsh-notes-data-hint' }, '暂无历史版本（每次保存自动留快照）')
                  : histList.map(v => e('div', { key: v.ts, className: 'dsh-notes-hist-item' + (histSel === v.ts ? ' on' : ''), onClick: () => selectHistVersion(v.ts) },
                      e('div', { className: 'dsh-notes-hist-item-t' }, fmtHistTs(v.ts)),
                      e('div', { className: 'dsh-notes-hist-item-b' }, fmtBytes(v.bytes))))),
            e('div', { className: 'dsh-notes-hist-view' },
              !histSel
                ? e('div', { className: 'dsh-notes-data-hint' }, '选择左侧版本查看预览（只读）')
                : histPreview
                  ? e('div', { className: 'dsh-notes-hist-preview dsh-notes-rich', dangerouslySetInnerHTML: { __html: renderMarkdown(histPreview.body, wikiResolve, { secretStatic: true, secretLabel: tt('editor.secretPlaceholder') }) } })   /* 文档安全 S1：只读预览机密块走静态占位（保守面） */
                  : e('div', { className: 'dsh-notes-data-hint' }, '预览加载中…'))),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setHistOpen(false) }, '关闭'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doRestoreHistory, disabled: histPending || !histSel }, histPending ? '恢复中…' : '恢复此版本'))))
      : null
    }
