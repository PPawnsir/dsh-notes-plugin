    // ===== modal: link —— 链接插入弹窗（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.link / linkModalRef / setLinkModal / LinkModal
    // needs: kernel/state.js（store/createStore/panelBridge）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：linkModal（null | { text, url }）迁入 store.modal.link 切片（modal 字段）；
    // linkModalRef 为 Esc 栈/Ctrl+/ 守卫的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）
    store.modal.link = createStore({ modal: null })
    const linkModalRef = { current: null }
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：同步写 ref 镜像 + store（订阅方 = LinkModal）
    function setLinkModal(v) { const nv = typeof v === 'function' ? v(linkModalRef.current) : v; linkModalRef.current = nv; store.modal.link.set({ modal: nv }) }
    // 富文本工具栏「链接」按钮的弹窗宿主：选中文字由 toolbarAction（whole.js）经 keepSel 缓存后 setLinkModal 打开
    function LinkModal() {
      const linkModal = store.modal.link.useSel(s => s.modal)
      // 链接弹窗确认（原型 openLinkModal 的确定分支）：仅 http/https；编辑器选区/富文本运行时经 panelBridge 中转
      function doInsertLink() {
        const m = linkModalRef.current
        const url = m ? String(m.url || '').trim() : ''
        if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) { showToast('仅支持 http/https 链接'); return }
        setLinkModal(null)
        panelBridge.restoreSel()
        const el = panelBridge.richRef.current; if (el) el.focus()
        document.execCommand('createLink', false, url)
        panelBridge.keepSel(); panelBridge.richDirtyRef.current = true; panelBridge.scheduleRichSync()
      }
      // 链接插入弹窗（富文本工具栏「链接」按钮，需先选中文字）：URL 仅 http/https
      return linkModal ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setLinkModal(null) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('link', 14), ' 插入链接', e('span', { className: 'dsh-notes-imgup-sub' }, '选中文字：' + (linkModal.text.length > 24 ? linkModal.text.slice(0, 24) + '…' : linkModal.text))),
          e('input', { className: 'dsh-notes-data-input', placeholder: 'https://…', value: linkModal.url, autoFocus: true, onChange: (ev) => setLinkModal(Object.assign({}, linkModal, { url: ev.target.value })), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doInsertLink() } } }),
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setLinkModal(null) }, '取消'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doInsertLink }, '插入'))))
      : null
    }
