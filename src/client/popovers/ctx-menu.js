    // ===== popover: ctx-menu —— 笔记行右键菜单（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelCtxMenu（ctxMenu/ctxNewFolderText 态 + openCtxMenu/ctxSetStatus/ctxMoveToFolder/ctxCreateFolderMove + 菜单 JSX）/ ctxMenuRef
    // needs: kernel/state.js（panelBridge + setError/setFolderMenu/setSelMode/setSelIds/expandFolder/doDelete/selectNote/loadNotes/loadFolders 转发别名）、
    //        kernel/bus.js（showToast）、kernel/format.js（notifyNotesChanged）、kernel/icons.js（e/I）；
    //        folders 清单经 hook 入参注入（panel/index.js 自 folder-menu hook 回填，渲染期新鲜值）；
    //        modals/dispatch.js openDispatch 直调（序位在前——popovers/selbar.js 直调 openMerge 同先例）
    // state 托管：ctxMenu/ctxNewFolderText 留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // ctxMenuRef 为 Esc 栈/Ctrl+/ 守卫的同步镜像（模块级单例——面板是 shell.overlay 单例，与昔日 FloatingPanel 内 useRef 等价）
    // 0.4.8（notes-048-note-ctxmenu；反馈 n-mut4lscwg6tf R1+R2）：菜单重排为冻结四项（顺序即序）——
    //   移动到…（子层文件夹树，嵌套夹缩进，当前归属打勾禁用，尾部恒有「未分类（移出文件夹）」，零文件夹禁用显示「暂无文件夹」）/ 置顶 / 派发 / 删除，
    //   与 app.html openNoteMenu 双端同构；移动到夹复用 ctxMoveToFolder（notes-update folder 字段通道）不新造；
    //   遗留项保留在分隔线后（worker 裁决留注：标记已解决=本面板唯一 resolve 入口、合并为一篇=多选态快捷入口，删则能力回退/路径变更，故保留）；
    //   多选态右键 v1 裁决留注：菜单恒作用本行单行（选中集批量动作走底部操作条 selbar；批量菜单化留后续批次）
    const ctxMenuRef = { current: null }   // 右键菜单镜像（keydown 闭包读最新值）
    // ===== 0.4.8 note-ctxmenu BEGIN =====（check 110 行为级 eval 提取区间；与 app panels/tree.js noteMenuFolderRows 同口径）
    // 移动到…子层行（纯函数）：depth-first 打平文件夹树（嵌套夹 depth 缩进展示；folders 已由 host 按 order 排序，filter 保序 = 兄弟间 order 序）；
    // 当前归属项 cur=true（渲染打勾禁用）；悬空 parent 按根级防御（rootFolders 同口径）+ cycle 守卫（存量脏数据）；
    // 目标清单 = 全量 folders——hidden/sys 遮罩夹仍是合法移动目标（遮罩语义仅树隐身，目标选择器不降噪）
    function ctxFolderRows(folders, noteFolder) {
      const byId = {}, guard = {}, rows = []
      folders.forEach(f => { byId[f.id] = f })
      function walk(pid, depth) {
        folders.filter(f => (f.parent || '') === pid).forEach(f => {
          if (guard[f.id]) return
          guard[f.id] = true
          rows.push({ id: f.id, name: f.name, depth: depth, cur: (noteFolder || '') === f.id })
          walk(f.id, depth + 1)
        })
      }
      walk('', 0)
      // 悬空 parent 防御补挂根级（host checkFolderAttach 写侧已拒，读侧兜底防脏数据隐身）
      folders.forEach(f => { if ((f.parent || '') && !byId[f.parent || ''] && !guard[f.id]) { guard[f.id] = true; rows.push({ id: f.id, name: f.name, depth: 0, cur: (noteFolder || '') === f.id }); walk(f.id, 1) } })
      return rows
    }
    // ===== 0.4.8 note-ctxmenu END =====
    function usePanelCtxMenu(args) {
        const folders = args.folders
        const [ctxMenu, setCtxMenu] = React.useState(null)   // 笔记行右键菜单：{ x, y, note, moveOpen?, newFolder? }（面板内坐标）或 null
        const [ctxNewFolderText, setCtxNewFolderText] = React.useState('')   // 笔记行右键菜单「新建文件夹…」内联输入
        React.useEffect(() => { ctxMenuRef.current = ctxMenu }, [ctxMenu])
        // 面板浮层坐标系（面板内绝对定位的换算基准；缺席兜底 600×500）
        function ctxRect() { const el = document.querySelector('.dsh-notes-floating'); return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 500 } }
        // 笔记行右键菜单（面板内绝对定位；与文件夹菜单互斥）
        function openCtxMenu(ev, n) {
          ev.preventDefault(); ev.stopPropagation()
          const rect = ctxRect()
          const mw = 172, mh = 236   // 基础菜单高估值（冻结四项 + 分隔 + 遗留两项；子层展开重夹紧见 toggleCtxMove）
          let x = ev.clientX - rect.left, y = ev.clientY - rect.top
          x = Math.max(4, Math.min(x, rect.width - mw - 4))
          y = Math.max(4, Math.min(y, rect.height - mh - 4))
          setCtxMenu({ x: x, y: y, note: n })
          setFolderMenu(null); setCtxNewFolderText('')   // 互斥：关文件夹菜单；清空上次的内联新建输入
          selectNote(n)   // 右键即选中：派发弹窗/删除流均以选中笔记为对象（app openNoteMenu 同口径）
        }
        // 移动到…子层开合：不关菜单重渲 + 视口重夹紧（展开增高后 y 重新 clamp；CSS max-height:320 滚动兜底超长子层）
        function toggleCtxMove() {
          const rect = ctxRect()
          const y = Math.max(4, Math.min(ctxMenu.y, rect.height - 320 - 4))
          setCtxMenu({ x: ctxMenu.x, y: y, note: ctxMenu.note, moveOpen: !ctxMenu.moveOpen })
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
            showToast(folderId ? t('tree.movedTo', { name: fname }) : t('tree.movedOut'))
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
              showToast(t('tree.movedTo', { name: res.folder.name }))
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
        // 笔记行右键菜单（0.4.8 冻结四项，顺序即序）：移动到…/置顶/派发/删除 + 分隔线 + 遗留项（已解决/合并）
        // i18n 覆盖卡F：命令式 toast 走 t() 直读，JSX 标签同（面板=shell.overlay 单例，tt 订阅随树/编辑器 hook 驱动全面板重渲染）；
        // 0.4.8 起移动到…/移出改走 note.menu* 新键域（ctx.moveTo/ctx.moveOut 收编更名退役），置顶/派发/删除复用 meta.*/common.* 既有键
        const ctxMoveRows = ctxMenu ? ctxFolderRows(folders, ctxMenu.note.folder) : []
        const ctxMenuEl = ctxMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' } },
            // ① 移动到…：零文件夹禁用并显示「暂无文件夹」（规格冻结）；否则点击内联展开子层（避免二级浮层被面板 overflow:hidden 裁切）
            ctxMoveRows.length === 0
              ? e('button', { className: 'dsh-notes-ctxmenu-item', disabled: true }, I('folder', 12), t('note.menuMoveTo') + ' · ' + t('note.menuNoFolders'))
              : e('button', { className: 'dsh-notes-ctxmenu-item', onClick: toggleCtxMove }, I('folder', 12), t('note.menuMoveTo') + (ctxMenu.moveOpen ? ' ▾' : ' ▸')),
            ctxMenu.moveOpen && ctxMoveRows.length ? e(React.Fragment, null,
              // 文件夹树子层：嵌套夹 depth 缩进；当前归属项打勾禁用
              ctxMoveRows.map(r => e('button', { key: r.id, className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', style: { paddingLeft: (22 + r.depth * 14) + 'px' }, disabled: r.cur, onClick: () => ctxMoveToFolder(ctxMenu.note, r.id) }, (r.cur ? '✓ ' : '') + r.name)),
              // 「未分类（移出文件夹）」恒在子层尾部；笔记本无归属时它即当前项（打勾禁用）
              e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', disabled: !(ctxMenu.note.folder || ''), onClick: () => ctxMoveToFolder(ctxMenu.note, '') }, ((ctxMenu.note.folder || '') ? '' : '✓ ') + t('note.menuMoveOut')),
              ctxMenu.newFolder
                ? e('input', { className: 'dsh-notes-ctxmenu-input', placeholder: t('ctx.newFolderPlaceholder'), value: ctxNewFolderText, autoFocus: true, onChange: (ev) => setCtxNewFolderText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ctxCreateFolderMove(ctxMenu.note) } } })
                : e('button', { className: 'dsh-notes-ctxmenu-item dsh-notes-ctxmenu-sub', onClick: () => setCtxMenu({ x: ctxMenu.x, y: ctxMenu.y, note: ctxMenu.note, moveOpen: true, newFolder: true }) }, t('ctx.newFolder')))
            : null,
            // ② 置顶切换（复用 meta 区 pin 同款 RPC 通道 notes-update status 字段；label 复用 meta.pin/unpin 既有键）
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'pinned' ? 'active' : 'pinned') }, I('pin', 12), ctxMenu.note.status === 'pinned' ? t('meta.unpin') : t('meta.pin')),
            // ③ 派发（直开派发弹窗，复用既有入口 openDispatch——openCtxMenu 已 selectNote，selected 就位）
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { setCtxMenu(null); openDispatch() } }, I('play', 12), t('meta.dispatch')),
            // ④ 删除（复用既有删除流 doDelete 软删+撤销；sys 警示既有逻辑：kind=sys 追加 confirm 红线门槛——sys.batchDelWarn 既有键单篇 n=1 口径）
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => { const n0 = ctxMenu.note; setCtxMenu(null); if ((n0.kind || 'note') === 'sys' && !window.confirm(t('sys.batchDelWarn', { n: 1 }))) return; doDelete(n0.id) } }, I('trash', 12), t('common.delete')),
            e('div', { className: 'dsh-notes-ctxmenu-sep' }),
            // 遗留项（冻结清单之外保留，见头注裁决留注）：标记已解决/重开（本面板唯一 resolve 入口）
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => ctxSetStatus(ctxMenu.note, ctxMenu.note.status === 'resolved' ? 'active' : 'resolved') }, I('check', 12), ctxMenu.note.status === 'resolved' ? t('ctx.reopen') : t('ctx.markResolved')),
            // 合并为一篇：进多选态并预勾当前笔记（再到列表勾选其余 ≥1 条，底部操作条合并）
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const nid = ctxMenu.note.id; setCtxMenu(null); setSelMode(true); setSelIds({ [nid]: true }) } }, I('check', 12), t('ctx.merge')))
          : null
        return { ctxMenu: ctxMenu, setCtxMenu: setCtxMenu, openCtxMenu: openCtxMenu, ctxMoveToFolder: ctxMoveToFolder, ctxMenuEl: ctxMenuEl }
    }
