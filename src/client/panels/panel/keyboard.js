    // ===== panel/keyboard —— 键盘流（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelKeyboard（全局 keydown：Ctrl+K/N/// + j/k/↑↓/Enter + Esc 分层栈）
    // needs: kernel/state.js（notesRef/searchRef/searchInputRef/pagedIdsRef/switchModeRef/editorModeRef + popover/树/搜索 setter 转发别名）、
    //        modals/*.js（imgModalRef/setImgModal 等 open 镜像与 setter 别名，Esc 栈直读模块顶层绑定——D 步先例同口径）
    // 键盘导航所需的私有 ref（keydown 监听挂一次，回调读最新值）：openRef/focusIdRef/selectNoteRef/closeRef/moveFocusRef/openNewNoteRef
    // 为 keyboard 域模块级单例（与昔日 FloatingPanel 内 useRef 等价——面板是 shell.overlay 单例）；跨域共享镜像在 kernel/state.js
    const openRef = { current: false }
    const focusIdRef = { current: null }
    const selectNoteRef = { current: null }
    const closeRef = { current: null }
    const moveFocusRef = { current: null }
    const openNewNoteRef = { current: null }   // Ctrl+N 调最新 openNewNote（keydown 闭包挂一次）
    function usePanelKeyboard() {
        // 键盘导航：j/k 或 ↑/↓ 移动高亮，Enter 打开，Esc 关闭，Ctrl+K 聚焦搜索，Ctrl+N 新建笔记
        React.useEffect(() => {
          function onKeyDown(ev) {
            if (!openRef.current) return
            const t = ev.target
            const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
            const mod = ev.ctrlKey || ev.metaKey
            // UI v2：搜索框在侧栏常显，Ctrl+K 直接聚焦（不再走展开态）
            if (mod && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); if (searchInputRef.current) searchInputRef.current.focus(); return }
            if (mod && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); openNewNoteRef.current(); return }
            // v3：Ctrl+/ 双模式切换（源码⇄富文本）；降级时 switchMode 内部拦截并 toast（弹窗打开时不切）
            if (mod && ev.key === '/') { ev.preventDefault(); if (!imgModalRef.current && !linkModalRef.current && switchModeRef.current) switchModeRef.current(editorModeRef.current === 'source' ? 'rich' : 'source'); return }
            if (ev.key === 'Escape') { ev.preventDefault(); const cm = ctxMenuRef.current; if (imgModalRef.current) { setImgModal(null); return } if (linkModalRef.current) { setLinkModal(null); return } if (renamingIdRef.current) { setRenamingId(null); return } if (folderInputOpenRef.current) { setFolderInputOpen(false); return } if (subFolderForRef.current) { setSubFolderFor(null); return } if (cm && cm.newFolder) { setCtxMenu({ x: cm.x, y: cm.y, note: cm.note, moveOpen: true }); return } if (folderMenuRef.current) { setFolderMenu(null); return } if (sortOpenRef.current) { setSortOpen(false); return } if (filterOpenRef.current) { setFilterOpen(false); return } if (newNoteOpenRef.current) { setNewNoteOpen(false); return } if (exportOpenRef.current) { setExportOpen(false); return } if (sExportOpenRef.current) { setSExportOpen(false); return } if (importOpenRef.current) { setImportOpen(false); return } if (pruneOpenRef.current) { setPruneOpen(false); return } if (trashOpenRef.current) { setTrashOpen(false); return } if (suggestOpenRef.current) { setSuggestOpen(false); return } if (memOpenRef.current) { setMemOpen(false); return } if (injectPreviewOpenRef.current) { setInjectPreviewOpen(false); return } if (injMgrOpenRef.current) { setInjMgrOpen(false); return } if (histOpenRef.current) { setHistOpen(false); return } if (mergeOpenRef.current) { setMergeOpen(false); return } if (archOpenRef.current) { setArchOpen(false); return } if (settingsOpenRef.current) { if (settingsFlushRef.current) settingsFlushRef.current(); setSettingsOpen(false); return } if (cm) { setCtxMenu(null); return } if (selModeRef.current) { setSelMode(false); setSelIds({}); return } if (searchRef.current) { searchRef.current = ''; setSearchText(''); setSearchIds(null); setSearchMatches({}); return } closeRef.current(); return }
            if (inField) return
            if (ctxMenuRef.current) return   // 右键菜单打开时暂停列表导航/打开
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
