    // ===== modal: newnote —— 新建笔记弹窗（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.newnote / newNoteOpenRef / newNoteInputRef / setNewNoteOpen / setNewNoteTitle / setNewNotePending / openNewNote / NewNoteModal
    // needs: kernel/state.js（store/createStore/panelBridge + setError/setNewNoteKind 转发别名）、kernel/constants.js（KIND_LABELS/KIND_TEMPLATES）、
    //        kernel/icons.js（e/I）、kernel/bus.js（showToast/notifyNotesChanged）
    // state 托管：open/title/pending 迁入 store.modal.newnote 切片；newNoteOpenRef 为 Esc 栈同步镜像、newNoteInputRef 为标题输入框 DOM 通道
    // （模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）；
    // newNoteKind 因 check.js 锚定其 useState 声明原文而滞留 whole.js（面板侧声明），经 props（读）+ kernel 转发别名（openNewNote 内复位写）双向接入
    store.modal.newnote = createStore({ open: false, title: '', pending: false })
    const newNoteOpenRef = { current: false }   // 新建笔记 modal 镜像（Esc 优先关 modal）
    const newNoteInputRef = { current: null }   // 新建笔记 modal 标题输入框（whole.js 打开自动聚焦 effect 经此聚焦）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setNewNoteOpen(v) { const nv = typeof v === 'function' ? v(newNoteOpenRef.current) : v; newNoteOpenRef.current = nv; store.modal.newnote.set({ open: nv }) }
    function setNewNoteTitle(v) { store.modal.newnote.set({ title: typeof v === 'function' ? v(store.modal.newnote.get().title) : v }) }
    function setNewNotePending(v) { store.modal.newnote.set({ pending: typeof v === 'function' ? v(store.modal.newnote.get().pending) : v }) }
    // 新建笔记 modal：侧栏「新建」chip / Ctrl+N 打开（清空上次标题，类型复位 note）
    function openNewNote() { setNewNoteTitle(''); setNewNoteKind('note'); setNewNotePending(false); setError(''); setNewNoteOpen(true) }
    // 新建笔记 modal 宿主：输标题 + 选类型（二期：按类型预填模板骨架）创建 → 选中 → 聚焦正文
    function NewNoteModal(props) {
      const newNoteOpen = store.modal.newnote.useSel(s => s.open)
      const newNoteTitle = store.modal.newnote.useSel(s => s.title)
      const newNotePending = store.modal.newnote.useSel(s => s.pending)
      const error = props.error
      const notes = props.notes
      const selected = props.selected
      const view = props.view
      const newNoteKind = props.newNoteKind
      const setNewNoteKind = props.setNewNoteKind
      // 创建流程：notes-create → 静默刷新列表 → 选中新笔记 → 聚焦正文 textarea → toast
      // 落位规则（原型 btnNew）：文件夹视图落当前文件夹；主题视图带当前主题；否则落选中笔记所在文件夹/未分类
      // 面板能力（选中/闪现高亮/聚焦正文/切源码态/刷新列表）经 panelBridge 中转（禁横向引用）
      async function doCreateNote() {
        const title = newNoteTitle.trim()
        if (!title || newNotePending) return
        setNewNotePending(true); setError('')
        try {
          const selNote = notes.find(n => n.id === selected)
          const createFolder = view.type === 'folder' ? view.id : ((selNote && selNote.folder) || '')
          // 二期 kind 模板骨架：按所选类型预填（note=空自由格式；机器信息类由 ✨整理按内容适配，建时不预判）
          const payload = { title: title, body: KIND_TEMPLATES[newNoteKind] || '', kind: newNoteKind }
          if (createFolder) payload.folder = createFolder
          if (view.type === 'topic' && view.id) payload.topic = view.id
          const res = await host.call('notes-create', payload)
          if (res && res.error) { setError(res.error); return }
          setNewNoteOpen(false); setNewNoteTitle('')
          showToast('已创建')
          // 立即用创建返回值选中新笔记（不等列表刷新，避免列表时序影响选中链路）
          if (res && res.id) {
            panelBridge.selectNote({ id: res.id, title: res.title || title, topic: res.topic || payload.topic || '', kind: res.kind || 'note', status: res.status || 'active', folder: createFolder, tags: [], inject: false, injectTo: [], sensitive: false })
            panelBridge.setFlashId(res.id); panelBridge.later(() => panelBridge.setFlashId(null), 1800)
            // 聚焦正文：等选中态渲染出 textarea 再 focus（富文本态先切回源码态，否则没有 textarea 可聚焦）
            panelBridge.setEditorModeState('source')
            panelBridge.later(() => { try { if (panelBridge.edBodyDomRef.current) panelBridge.edBodyDomRef.current.focus() } catch (err) {} }, 300)
            panelBridge.later(() => { try { if (panelBridge.edBodyDomRef.current && document.activeElement !== panelBridge.edBodyDomRef.current) panelBridge.edBodyDomRef.current.focus() } catch (err) {} }, 700)
          }
          notifyNotesChanged()
          panelBridge.loadNotes(true)  // 后台刷新列表（不 await，不阻塞选中/聚焦链路）
        } catch (err) { setError(String(err.message || err)) } finally { setNewNotePending(false) }
      }
      return newNoteOpen ? e('div', { className: 'dsh-notes-newnote-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setNewNoteOpen(false) } },
        e('div', { className: 'dsh-notes-newnote-modal' },
          e('div', { className: 'dsh-notes-newnote-t' }, '新建笔记'),
          e('input', { ref: newNoteInputRef, className: 'dsh-notes-newnote-input', placeholder: '笔记标题…', value: newNoteTitle, onChange: (ev) => setNewNoteTitle(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateNote() } } }),
          e('div', { className: 'dsh-notes-newnote-kind-row' },
            e('span', { className: 'dsh-notes-newnote-kind-lb' }, '类型'),
            e('select', { className: 'dsh-notes-newnote-select', value: newNoteKind, onChange: (ev) => setNewNoteKind(ev.target.value) },
              ['note', 'decision', 'todo', 'link', 'quote', 'log'].map(k => e('option', { key: k, value: k }, KIND_LABELS[k]))),
            e('span', { className: 'dsh-notes-newnote-kind-hint' }, KIND_TEMPLATES[newNoteKind] ? '将预填模板骨架' : '自由格式（空正文）')),
          error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
          e('div', { className: 'dsh-notes-newnote-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setNewNoteOpen(false) }, '取消'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doCreateNote, disabled: newNotePending || !newNoteTitle.trim() }, newNotePending ? '创建中…' : '创建'))))
      : null
    }
