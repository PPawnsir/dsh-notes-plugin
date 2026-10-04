    // ===== panel/keyboard —— 键盘流（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelKeyboard（全局 keydown：Ctrl+K / Alt+N / Ctrl+/ / ? 速查表 + j/k/↑↓/Enter + Esc 分层栈）+ focusListFromSearch（搜索框 ↓ 桥接列表）
    // needs: kernel/state.js（notesRef/searchRef/searchInputRef/treeElRef/pagedIdsRef/switchModeRef/editorModeRef + popover/树/搜索 setter 转发别名）、
    //        modals/*.js（imgModalRef/setImgModal 等 open 镜像与 setter 别名，Esc 栈直读模块顶层绑定——D 步先例同口径）
    // 键盘导航所需的私有 ref（keydown 监听挂一次，回调读最新值）：openRef/focusIdRef/selectNoteRef/closeRef/moveFocusRef/openNewNoteRef
    // 为 keyboard 域模块级单例（与昔日 FloatingPanel 内 useRef 等价——面板是 shell.overlay 单例）；跨域共享镜像在 kernel/state.js
    const openRef = { current: false }
    const focusIdRef = { current: null }
    const selectNoteRef = { current: null }
    const closeRef = { current: null }
    const moveFocusRef = { current: null }
    const openNewNoteRef = { current: null }   // Alt+N 调最新 openNewNote（keydown 闭包挂一次）
    /* Esc 焦点分层末段共用：搜索框还焦列表容器（焦点不得滞留输入框，否则 j/k 字母误入搜索） */
    function blurSearchToList() {
      if (searchInputRef.current) searchInputRef.current.blur()
      if (treeElRef.current) treeElRef.current.focus()
    }
    /* 搜索框 ↓ 桥接：还焦列表并把焦点行落到首条可见结果（保留过滤上下文，搜索→↓→j/k→Enter 纯键盘路径） */
    function focusListFromSearch() {
      blurSearchToList()
      const ids = pagedIdsRef.current
      if (ids.length && moveFocusRef.current) moveFocusRef.current(ids, 1)
    }
    function usePanelKeyboard() {
        // 键盘导航：j/k 或 ↑/↓ 移动高亮，Enter 打开，Esc 关闭，Ctrl+K 聚焦搜索，Alt+N 新建笔记
        React.useEffect(() => {
          function onKeyDown(ev) {
            if (!openRef.current) return
            const t = ev.target
            const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
            const mod = ev.ctrlKey || ev.metaKey
            // UI v2：搜索框在侧栏常显，Ctrl+K 直接聚焦（不再走展开态）
            if (mod && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); if (searchInputRef.current) searchInputRef.current.focus(); return }
            // Alt+N 新建（Ctrl+N 是浏览器保留键「新建窗口」，页面 keydown 拿不到——改用无冲突组合；AltGr 带 ctrlKey 天然排除）
            if (ev.altKey && !mod && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); openNewNoteRef.current(); return }
            // v3：Ctrl+/ 双模式切换（源码⇄富文本）；降级时 switchMode 内部拦截并 toast（弹窗/速查表打开时不切）
            if (mod && ev.key === '/') { ev.preventDefault(); if (!imgModalRef.current && !linkModalRef.current && !cheatsheetOpenRef.current && switchModeRef.current) switchModeRef.current(editorModeRef.current === 'source' ? 'rich' : 'source'); return }
            if (ev.key === 'Escape') { ev.preventDefault(); const cm = ctxMenuRef.current; if (cheatsheetOpenRef.current) { setCheatsheetOpen(false); return } if (imgModalRef.current) { setImgModal(null); return } if (linkModalRef.current) { setLinkModal(null); return } if (renamingIdRef.current) { setRenamingId(null); return } if (folderInputOpenRef.current) { setFolderInputOpen(false); return } if (subFolderForRef.current) { setSubFolderFor(null); return } if (cm && cm.newFolder) { setCtxMenu({ x: cm.x, y: cm.y, note: cm.note, moveOpen: true }); return } if (folderMenuRef.current) { setFolderMenu(null); return } if (sortOpenRef.current) { setSortOpen(false); return } if (filterOpenRef.current) { setFilterOpen(false); return } if (newNoteOpenRef.current) { setNewNoteOpen(false); return } if (exportOpenRef.current) { setExportOpen(false); return } if (sExportOpenRef.current) { setSExportOpen(false); return } if (importOpenRef.current) { setImportOpen(false); return } if (pruneOpenRef.current) { setPruneOpen(false); return } if (trashOpenRef.current) { setTrashOpen(false); return } if (suggestOpenRef.current) { setSuggestOpen(false); return } if (memOpenRef.current) { closeMemEnable(); return } if (injectPreviewOpenRef.current) { setInjectPreviewOpen(false); return } if (injMgrOpenRef.current) { closeInjMgr(); return } if (histOpenRef.current) { setHistOpen(false); return } if (mergeOpenRef.current) { setMergeOpen(false); return } if (archOpenRef.current) { setArchOpen(false); return } if (settingsOpenRef.current) { if (settingsFlushRef.current) settingsFlushRef.current(); setSettingsOpen(false); return } if (cm) { setCtxMenu(null); return } if (selModeRef.current) { setSelMode(false); setSelIds({}); return } if (searchRef.current) { searchRef.current = ''; setSearchText(''); setSearchIds(null); setSearchMatches({}); if (searchInputRef.current && document.activeElement === searchInputRef.current) blurSearchToList(); return } if (searchInputRef.current && document.activeElement === searchInputRef.current) { blurSearchToList(); return } closeRef.current(); return }
            // 搜索框 ↓ 桥接列表（保留过滤上下文：搜索→↓→j/k→Enter 纯键盘路径）
            if (t === searchInputRef.current && ev.key === 'ArrowDown') { ev.preventDefault(); focusListFromSearch(); return }
            if (inField) return
            // ? 键唤起/关闭快捷键速查表（notes-034-f-cheatsheet：非输入焦点；其他弹层/浮层打开时不抢——Esc 分层口径同列表导航）
            if (ev.key === '?') {
              ev.preventDefault()
              if (cheatsheetOpenRef.current) { setCheatsheetOpen(false); return }   // 速查表打开时再按 ? = 关闭（toggle）
              if (imgModalRef.current || linkModalRef.current || ctxMenuRef.current || folderMenuRef.current || sortOpenRef.current || filterOpenRef.current || newNoteOpenRef.current || exportOpenRef.current || sExportOpenRef.current || importOpenRef.current || pruneOpenRef.current || trashOpenRef.current || suggestOpenRef.current || memOpenRef.current || injectPreviewOpenRef.current || injMgrOpenRef.current || histOpenRef.current || mergeOpenRef.current || archOpenRef.current || settingsOpenRef.current) return   // 任一弹层打开时不抢键
              openCheatsheet(); return
            }
            if (ctxMenuRef.current || cheatsheetOpenRef.current) return   // 右键菜单/速查表打开时暂停列表导航/打开
            const ids = pagedIdsRef.current
            if (!ids.length) return
            if (ev.key === 'j' || ev.key === 'ArrowDown') { ev.preventDefault(); moveFocusRef.current(ids, 1) }
            else if (ev.key === 'k' || ev.key === 'ArrowUp') { ev.preventDefault(); moveFocusRef.current(ids, -1) }
            else if (ev.key === 'Enter') {
              const fid = focusIdRef.current
              if (fid && ids.indexOf(fid) >= 0) { const n = notesRef.current.find(x => x.id === fid); if (n) selectNoteRef.current(n) }
            }
          }
          document.addEventListener('keydown', onKeyDown)
          return () => document.removeEventListener('keydown', onKeyDown)
        }, [])
    }
