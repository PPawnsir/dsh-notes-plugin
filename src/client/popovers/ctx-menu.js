    // ===== popover: ctx-menu —— 笔记行右键菜单（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelCtxMenu（ctxMenu/ctxNewFolderText 态 + openCtxMenu/ctxSetStatus/ctxMoveToFolder/ctxCreateFolderMove + 菜单 JSX）/ ctxMenuRef
    // needs: kernel/state.js（panelBridge + setError/setFolderMenu/setSelMode/setSelIds/expandFolder/doDelete/selectNote/loadNotes/loadFolders 转发别名）、
    //        kernel/bus.js（showToast）、kernel/format.js（notifyNotesChanged）、kernel/icons.js（e/I）；
    //        folders 清单经 hook 入参注入（panel/index.js 自 folder-menu hook 回填，渲染期新鲜值）
    // state 托管：ctxMenu/ctxNewFolderText 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // ctxMenuRef 为 Esc 栈/Ctrl+/ 守卫的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）
    const ctxMenuRef = { current: null }   // 右键菜单镜像（keydown 闭包读最新值）
    function usePanelCtxMenu(args) {
        const folders = args.folders
        const [ctxMenu, setCtxMenu] = React.useState(null)   // 笔记行右键菜单：{ x, y, note }（面板内坐标）或 null
        const [ctxNewFolderText, setCtxNewFolderText] = React.useState('')   // 笔记行右键菜单「新建文件夹…」内联输入
        React.useEffect(() => { ctxMenuRef.current = ctxMenu }, [ctxMenu])
        // 笔记行右键菜单（面板内绝对定位；与文件夹菜单互斥）
        function openCtxMenu(ev, n) {
          ev.preventDefault(); ev.stopPropagation()
          const floatEl = ev.currentTarget.closest('.dsh-notes-floating')
          const rect = floatEl ? floatEl.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 500 }
          const mw = 172, mh = 148
          let x = ev.clientX - rect.left, y = ev.clientY - rect.top
          x = Math.max(4, Math.min(x, rect.width - mw - 4))
          y = Math.max(4, Math.min(y, rect.height - mh - 4))
          setCtxMenu({ x: x, y: y, note: n })
          setFolderMenu(null); setCtxNewFolderText('')   // 互斥：关文件夹菜单；清空上次的内联新建输入
          selectNote(n)
        }
        async function ctxSetStatus(n, status) {
          setCtxMenu(null); setError('')
          try {
            const res = await host.call('notes-update', { id: n.id, status: status })
            if (res && res.error) { setError(res.error); return }
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 笔记行右键「移动到文件夹」：notes-update 只改 folder 字段；'' = 移出到未分类
        async function ctxMoveToFolder(n, folderId) {
          setCtxMenu(null); setCtxNewFolderText(''); setError('')
          const fname = folderId ? ((folders.find(f => f.id === folderId) || {}).name || '') : ''
          try {
            const res = await host.call('notes-update', { id: n.id, folder: folderId })
            if (res && res.error) { setError(res.error); return }
            showToast(folderId ? '已移动到「' + fname + '」' : '已移出文件夹')
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 笔记行右键「新建文件夹…」：建文件夹并把笔记移入（不切换当前视图）
        async function ctxCreateFolderMove(n) {
          const name = ctxNewFolderText.trim()
          if (!name) return
          setError('')
          try {
            const res = await host.call('notes-folders', { op: 'create', name: name })
            if (res && res.error) { setError(res.error); return }
            setCtxNewFolderText('')
            if (res.folder && res.folder.id) {
              expandFolder(res.folder.id)
              const u = await host.call('notes-update', { id: n.id, folder: res.folder.id })
              if (u && u.error) { setError(u.error); return }
              showToast('已移动到「' + res.folder.name + '」')
            }
            setCtxMenu(null)
            await loadFolders(); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 点击菜单外部关闭（Esc 在全局 keydown 里处理）
        React.useEffect(() => {
          if (!ctxMenu) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ctxmenu'))) setCtxMenu(null) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [ctxMenu])
        // 笔记行右键菜单：置顶/已解决/移动到文件夹/删除（纯文字标签 + SVG 图标面板内统一风格）
        const ctxMenuEl = ctxMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' } },
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'pinned' ? 'active' : 'pinned') }, I('pin', 12), ctxMenu.note.status === 'pinned' ? '取消置顶' : '置顶'),
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'resolved' ? 'active' : 'resolved') }, I('check', 12), ctxMenu.note.status === 'resolved' ? '重开' : '标记已解决'),
            // 移动到文件夹：点击内联展开子菜单（文件夹列表 + 移出 + 新建），避免二级浮层被面板 overflow:hidden 裁切
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => setCtxMenu({ x: ctxMenu.x, y: ctxMenu.y, note: ctxMenu.note, moveOpen: !ctxMenu.moveOpen }) }, I('folder', 12), '移动到文件夹' + (ctxMenu.moveOpen ? ' ▾' : ' ▸')),
            ctxMenu.moveOpen ? e(React.Fragment, null,
              folders.map(f => e('button', { key: f.id, className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => ctxMoveToFolder(ctxMenu.note, f.id) }, ((ctxMenu.note.folder || '') === f.id ? '✓ ' : '') + f.name)),
              (ctxMenu.note.folder || '') ? e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => ctxMoveToFolder(ctxMenu.note, '') }, '移出文件夹（未分类）') : null,
              ctxMenu.newFolder
                ? e('input', { className: 'dsh-notes-ctxmenu-input', placeholder: '新文件夹名…', value: ctxNewFolderText, autoFocus: true, onChange: (ev) => setCtxNewFolderText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ctxCreateFolderMove(ctxMenu.note) } } })
                : e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => setCtxMenu({ x: ctxMenu.x, y: ctxMenu.y, note: ctxMenu.note, moveOpen: true, newFolder: true }) }, '新建文件夹…'))
            : null,
            // 合并为一篇：进多选态并预勾当前笔记（再到列表勾选其余 ≥1 条，底部操作条合并）
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const nid = ctxMenu.note.id; setCtxMenu(null); setSelMode(true); setSelIds({ [nid]: true }) } }, I('check', 12), '合并为一篇'),
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => { setCtxMenu(null); doDelete(ctxMenu.note.id) } }, I('trash', 12), '删除'))
          : null
        return { ctxMenu: ctxMenu, setCtxMenu: setCtxMenu, openCtxMenu: openCtxMenu, ctxMoveToFolder: ctxMoveToFolder, ctxMenuEl: ctxMenuEl }
    }
