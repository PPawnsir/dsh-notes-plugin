    // ===== popover: folder-menu —— 文件夹右键菜单 + 文件夹管理动作族（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelFolderMenu（folders/foldersExpanded/内联输入四态/renaming 二态/folderMenu 态 + 树 helper 族 +
    //           loadFolders + openFolderMenu + doCreateFolder/doRenameFolder/doDeleteFolder/doReorderFolder/doReparentFolder + 菜单 JSX）/
    //           folderMenuRef/renamingIdRef/folderInputOpenRef/subFolderForRef
    // needs: kernel/state.js（panelBridge + setView/setCtxMenu/setError/loadNotes 转发别名）、kernel/persist.js（loadFoldersExpanded 族）、
    //        kernel/bus.js（showToast）、kernel/format.js（notifyNotesChanged）、kernel/icons.js（e/I）
    // 说明：文件夹管理动作（新建/重命名/删除/排序/换父）的全部触发入口是本右键菜单 + 树内联输入/拖拽（panel/tree.js 经回填回调），
    // 故动作族与树 helper 集中于本模块；Esc 栈直读本模块 ref 镜像（序位在前，与 modal 先例同口径）。
    // state 托管：全部 state 留 hook 内 useState（foldersExpanded 声明原文被 check.js 21 节锚定；§6 E 裁决记录见 panel/index.js 头注）
    const folderMenuRef = { current: null }   // 文件夹右键菜单镜像（Esc 栈读最新）
    const renamingIdRef = { current: null }   // 文件夹重命名输入镜像（Esc 取消）
    const folderInputOpenRef = { current: false }   // 文件夹新建输入镜像（Esc 取消）
    const subFolderForRef = { current: null }   // 「新建子文件夹」输入镜像（Esc 取消）
    function usePanelFolderMenu(args) {
        const notes = args.notes
        const view = args.view
        // 虚拟文件夹树：清单走 notes-folders RPC（list/create/rename/delete/reorder）；折叠态持久化 localStorage
        const [folders, setFolders] = React.useState([])
        const [foldersExpanded, setFoldersExpanded] = React.useState(loadFoldersExpanded)
        const [folderInputOpen, setFolderInputOpen] = React.useState(false)   // 文件夹分组头 ＋ → 内联输入（根级新建）
        const [folderInputText, setFolderInputText] = React.useState('')
        const [subFolderFor, setSubFolderFor] = React.useState(null)   // 「新建子文件夹」内联输入的父文件夹 id（null=关闭；输入行渲染在该父夹的子内容容器首位）
        const [folderMenu, setFolderMenu] = React.useState(null)   // 文件夹项右键菜单：{ x, y, folder }（面板内坐标）或 null
        const [renamingId, setRenamingId] = React.useState(null)   // 树内内联重命名中的文件夹 id
        const [renameText, setRenameText] = React.useState('')
        // 展开态/菜单镜像到 ref（Esc 栈闭包挂一次，需读最新值避免过期）
        React.useEffect(() => { folderMenuRef.current = folderMenu }, [folderMenu])
        React.useEffect(() => { renamingIdRef.current = renamingId }, [renamingId])
        React.useEffect(() => { folderInputOpenRef.current = folderInputOpen }, [folderInputOpen])
        React.useEffect(() => { subFolderForRef.current = subFolderFor }, [subFolderFor])
        // 文件夹清单（含各文件夹计数）：与列表同链路刷新（不 await，不阻塞列表链路）；
        // 文件夹异步到达后顺手清洗展开态陈旧 id（pruneFoldersExpanded：失效 id 剔除 + 空集回 null 缺省全展开）
        async function loadFolders() {
          try {
            const res = await host.call('notes-folders')
            if (res && res.folders) {
              setFolders(res.folders)
              setFoldersExpanded(prev => pruneFoldersExpanded(prev, res.folders))
            }
          } catch (err) {}
        }
        // ===== 嵌套 helper（notes-nested-folder-ui；与 host folder-tree-helpers 同口径的客户端纯函数版，数据全经入参/当前 state）=====
        // folderSubtreeIdsOf(id)：子树 id 集合（含自身 + 全部子孙；BFS 下行，visited 防御存量 cycle 数据）
        function folderSubtreeIdsOf(id) {
          const out = {}; out[id] = true
          const queue = [id]
          while (queue.length) { const cur = queue.shift(); for (const f of folders) if ((f.parent || '') === cur && !out[f.id]) { out[f.id] = true; queue.push(f.id) } }
          return out
        }
        // childFoldersOf(pid)：直接子文件夹（folders 已由 host 按 order 排序，filter 保序 = 兄弟间 order 序）
        function childFoldersOf(pid) { return folders.filter(x => (x.parent || '') === pid) }
        // rootFolders()：根级清单——无 parent 或 parent 悬空（指清单外 id，与 host folderDepth 悬空按根级计同口径防御）
        function rootFolders() { const byId = {}; folders.forEach(f => { byId[f.id] = f }); return folders.filter(f => !(f.parent || '') || !byId[f.parent || '']) }
        // folderPathOf(fid)：面包屑路径（根 → … → 当前）；悬空/cycle 防御截断
        function folderPathOf(fid) {
          const byId = {}; folders.forEach(f => { byId[f.id] = f })
          const path = []; let cur = fid; const seen = {}
          while (cur && byId[cur] && !seen[cur]) { seen[cur] = true; path.unshift(byId[cur]); cur = byId[cur].parent || '' }
          return path
        }
        // 折叠判定：foldersExpanded=null 表示缺省全展开；否则数组为展开中的 id 集合（含置顶组 PINNED_KEY）
        function isFolderExpanded(id) { return foldersExpanded === null ? true : foldersExpanded.indexOf(id) >= 0 }
        // 折叠/展开切换（缺省全展开时先物化全量展开集合再切换，保证其余文件夹保持展开）
        function toggleFolder(id) {
          setFoldersExpanded(prev => {
            const base = prev === null ? folders.map(f => f.id).concat([PINNED_KEY]) : prev
            const next = base.indexOf(id) >= 0 ? base.filter(x => x !== id) : base.concat([id])
            saveFoldersExpanded(next)
            return next
          })
        }
        // 自动展开目标文件夹（选中笔记/新建文件夹/移入笔记时调用；已展开或缺省全展开时不动）
        function expandFolder(id) {
          if (!id) return
          setFoldersExpanded(prev => {
            if (prev === null || prev.indexOf(id) >= 0) return prev
            const next = prev.concat([id])
            saveFoldersExpanded(next)
            return next
          })
        }
        // 文件夹项右键菜单：与笔记行菜单同坐标换算（面板内绝对定位；两菜单互斥）
        function openFolderMenu(ev, f) {
          ev.preventDefault(); ev.stopPropagation()
          const floatEl = ev.currentTarget.closest('.dsh-notes-floating')
          const rect = floatEl ? floatEl.getBoundingClientRect() : { left: 0, top: 0, width: 600, height: 500 }
          const mw = 190, mh = 260
          let x = ev.clientX - rect.left, y = ev.clientY - rect.top
          x = Math.max(4, Math.min(x, rect.width - mw - 4))
          y = Math.max(4, Math.min(y, rect.height - mh - 4))
          setFolderMenu({ x: x, y: y, folder: f })
          setCtxMenu(null)
        }
        // 文件夹新建（分组头 ＋ 根级 / 右键「新建子文件夹」嵌套）→ 内联输入：Enter 提交（空串=取消）；建成即展开该文件夹并进入文件夹视图
        // 嵌套：parent 取 subFolderFor（''=根级）；深度上限/父不存在由 host checkFolderAttach 拒绝 → 错误串去 RPC 前缀后 toast（友好提示）
        async function doCreateFolder() {
          const name = folderInputText.trim()
          const parent = subFolderFor || ''
          if (!name) { setFolderInputOpen(false); setSubFolderFor(null); return }
          setFolderInputOpen(false); setSubFolderFor(null); setFolderInputText(''); setError('')
          try {
            const res = await host.call('notes-folders', { op: 'create', name: name, parent: parent })
            if (res && res.error) { showToast(String(res.error).replace(/^notes-folders\.\w+\s*/, '')); return }
            showToast(t('fld.created', { name: name }))
            if (res.folder && res.folder.id) { if (parent) expandFolder(parent); expandFolder(res.folder.id); setView({ type: 'folder', id: res.folder.id }) }
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 栏内内联重命名：Enter 提交 / Esc 或失焦取消；名字未变时不发 RPC
        async function doRenameFolder() {
          const id = renamingId, name = renameText.trim()
          setRenamingId(null)
          if (!id || !name) return
          const cur = folders.find(f => f.id === id)
          if (cur && cur.name === name) return
          setError('')
          try {
            const res = await host.call('notes-folders', { op: 'rename', id: id, name: name })
            if (res && res.error) { setError(res.error); return }
            showToast(t('fld.renamed', { name: name }))
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 右键删除（级联，notes-nested-folder-ui）：confirm 明示「连子删除：N 个子文件夹 + M 条笔记移入回收站；文件夹结构不可恢复」——
        // 统计本地从 folders/notes 清单按子树预估（host 无 dry-run 参数；子树语义与 host cascade 同源 folderSubtreeIds），确认后带 cascade:true 整棵删除
        async function doDeleteFolder(f) {
          setFolderMenu(null)
          const sub = folderSubtreeIdsOf(f.id)
          const childN = folders.filter(x => x.id !== f.id && sub[x.id]).length
          const noteN = notes.filter(n => sub[(n.folder || '')]).length
          const msg = (childN || noteN)
            ? t('fld.delConfirmCascade', { name: f.name, childN: childN, noteN: noteN })
            : t('fld.delConfirmEmpty', { name: f.name })
          if (!window.confirm(msg)) return
          setError('')
          try {
            const res = await host.call('notes-folders', { op: 'delete', id: f.id, cascade: true })
            if (res && res.error) { setError(res.error); return }
            showToast(t('fld.deleted', { name: f.name }) + ((childN || noteN) ? t('fld.deletedDetail', { childN: childN, noteN: noteN }) : ''))
            // 当前文件夹视图落在被删子树内 → 回全部视图（视图 id 悬空会显示空名单）
            if (view.type === 'folder' && sub[view.id]) setView({ type: 'all', id: '' })
            await loadFolders(); await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 右键上移/下移：嵌套语义 = 同级兄弟内换位（全局 ids 顺序提交，host 归一化 order；两 id 原位互换，非兄弟相对位次不动）
        async function doReorderFolder(f, delta) {
          setFolderMenu(null)
          const sibs = childFoldersOf(f.parent || '')
          const si = sibs.findIndex(x => x.id === f.id)
          const sj = si + delta
          if (si < 0 || sj < 0 || sj >= sibs.length) return
          const other = sibs[sj]
          const ids = folders.map(x => x.id)
          const i = ids.indexOf(f.id), j = ids.indexOf(other.id)
          ids[i] = other.id; ids[j] = f.id
          setError('')
          try {
            const res = await host.call('notes-folders', { op: 'reorder', ids: ids })
            if (res && res.error) { setError(res.error); return }
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 拖拽换父（notes-nested-folder-ui）：文件夹行拖入另一文件夹 = reorder parents 改挂；'' = 移回根级
        // cycle/自挂本地先拦（省一次 RPC 的友好 toast）；深度上限由 host checkFolderAttach 拒绝 → 错误串去 RPC 前缀后 toast
        async function doReparentFolder(fid, parentId) {
          const f = folders.find(x => x.id === fid)
          if (!f || (f.parent || '') === (parentId || '')) return
          setError('')
          if (parentId) {
            if (parentId === fid) { showToast(t('fld.errSelf')); return }
            if (folderSubtreeIdsOf(fid)[parentId]) { showToast(t('fld.errCycle')); return }
          }
          try {
            const res = await host.call('notes-folders', { op: 'reorder', ids: folders.map(x => x.id), parents: { [fid]: parentId || '' } })
            if (res && res.error) { showToast(String(res.error).replace(/^notes-folders\.\w+\s*/, '')); return }
            if (parentId) expandFolder(parentId)
            showToast(parentId ? t('fld.movedInto', { name: folderName(parentId) }) : t('fld.movedRoot'))
            await loadFolders()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 笔记行右键「移动到文件夹」：notes-update 只改 folder 字段；'' = 移出到未分类
        function folderName(fid) { const f = folders.find(x => x.id === fid); return f ? f.name : '' }
        // 文件夹右键菜单：点击菜单外部关闭（与笔记行菜单共用 .dsh-notes-ctxmenu 样式）
        React.useEffect(() => {
          if (!folderMenu) return
          const onDown = (ev) => { if (!(ev.target && ev.target.closest && ev.target.closest('.dsh-notes-ctxmenu'))) setFolderMenu(null) }
          document.addEventListener('mousedown', onDown)
          return () => document.removeEventListener('mousedown', onDown)
        }, [folderMenu])
        // 文件夹右键菜单的上移/下移边界（嵌套语义：同级兄弟内首项不可上移、末项不可下移）
        const folderMenuSibs = folderMenu ? childFoldersOf(folderMenu.folder.parent || '') : []
        const folderMenuIdx = folderMenu ? folderMenuSibs.findIndex(f => f.id === folderMenu.folder.id) : -1
        // 文件夹项右键菜单：进入文件夹视图 / 新建子文件夹（嵌套内联输入）/ 重命名 / 上移 / 下移（同级兄弟内）/ 移回根级（有父级时）/ 删除（级联 confirm）
        // i18n 覆盖卡F：菜单项文案走 t()（fld.* 域；「删除文件夹」= fld.menuDeleteFolder 区别笔记行 common.delete）
        const folderMenuEl = folderMenu ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: folderMenu.x + 'px', top: folderMenu.y + 'px' } },
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const mf = folderMenu.folder; setFolderMenu(null); expandFolder(mf.id); setView({ type: 'folder', id: mf.id }) } }, I('filter', 12), t('fld.menuView')),
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const mf = folderMenu.folder; setFolderMenu(null); setFolderInputOpen(false); setFolderInputText(''); expandFolder(mf.id); setSubFolderFor(mf.id) } }, I('plus', 12), t('fld.titleNewSub')),
            e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { setRenamingId(folderMenu.folder.id); setRenameText(folderMenu.folder.name); setFolderMenu(null) } }, t('fld.okRename')),
            e('button', { className: 'dsh-notes-ctxmenu-item', disabled: folderMenuIdx <= 0, onClick: () => doReorderFolder(folderMenu.folder, -1) }, t('fld.menuUp')),
            e('button', { className: 'dsh-notes-ctxmenu-item', disabled: folderMenuIdx < 0 || folderMenuIdx >= folderMenuSibs.length - 1, onClick: () => doReorderFolder(folderMenu.folder, 1) }, t('fld.menuDown')),
            (folderMenu.folder.parent || '') ? e('button', { className: 'dsh-notes-ctxmenu-item', onClick: () => { const mf = folderMenu.folder; setFolderMenu(null); doReparentFolder(mf.id, '') } }, t('fld.menuRoot')) : null,
            e('div', { className: 'dsh-notes-ctxmenu-sep' }),
            e('button', { className: 'dsh-notes-ctxmenu-item danger', onClick: () => doDeleteFolder(folderMenu.folder) }, t('fld.menuDeleteFolder')))
          : null
        return {
          folders: folders, foldersExpanded: foldersExpanded, folderInputOpen: folderInputOpen, folderInputText: folderInputText,
          subFolderFor: subFolderFor, folderMenu: folderMenu, renamingId: renamingId, renameText: renameText,
          setFolderInputOpen: setFolderInputOpen, setFolderInputText: setFolderInputText, setSubFolderFor: setSubFolderFor,
          setFolderMenu: setFolderMenu, setRenamingId: setRenamingId, setRenameText: setRenameText,
          loadFolders: loadFolders, folderSubtreeIdsOf: folderSubtreeIdsOf, childFoldersOf: childFoldersOf, rootFolders: rootFolders,
          folderPathOf: folderPathOf, isFolderExpanded: isFolderExpanded, toggleFolder: toggleFolder, expandFolder: expandFolder,
          folderName: folderName, openFolderMenu: openFolderMenu, doCreateFolder: doCreateFolder, doRenameFolder: doRenameFolder,
          doDeleteFolder: doDeleteFolder, doReorderFolder: doReorderFolder, doReparentFolder: doReparentFolder, folderMenuEl: folderMenuEl
        }
    }
