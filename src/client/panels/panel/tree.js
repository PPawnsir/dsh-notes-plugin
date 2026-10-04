    // ===== panel/tree —— 文件夹树渲染 + 拖拽换位 + 懒加载分页（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelTree（visibleCount/topicExpanded/topicSecOpen/dragActive 态 + 分页重置/onListScroll + 双向拖拽族 +
    //           renderTreeEls 渲染函数（内含 renderNoteRow/renderFolderNode，签名/正文逐字））
    // needs: kernel/state.js（pagedIdsRef 跨域镜像 + 文件夹域/多选/右键/编辑器域转发别名群）、kernel/constants.js（PAGE_SIZE/PINNED_KEY/FILTER_KINDS/KIND_LABELS/FILTERS0）、
    //        kernel/icons.js（e/I）、kernel/bus.js（showToast）、kernel/format.js（notifyNotesChanged）、panel/search.js（highlight，序位在前）、
    //        modals/newnote.js（openNewNote，序位在前）；notes/view/filters/searchText/searchIds 经 hook 入参注入（装配层回填，渲染期新鲜值）；
    //        post-guard 求值结果（filtered/paged/q/filtersActive 等）经 renderTreeEls 入参注入
    // state 托管：四态留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // dragNoteIdRef/dragFolderIdRef 的 React.useRef 声明原文被 check.js 锚定（21/41 节）——留 hook 内（useRef 不可模块顶层调用）
    function usePanelTree(args) {
        const notes = args.notes, view = args.view, filters = args.filters, searchText = args.searchText, searchIds = args.searchIds, folders = args.folders
        // i18n（notes-042-i18n-cov-a 覆盖卡A）：tt = useT()——订阅 langStore，切语言本 hook（随主面板）自渲染；树区文案全走 tt()
        const tt = useT()
        const dragNoteIdRef = React.useRef(null)   // 笔记拖拽状态：dragstart 记录 noteId（ref 防闭包过期），dragend 清空
        const dragFolderIdRef = React.useRef(null)   // 文件夹拖拽状态（换父）：dragstart 记录 folderId，dragend 清空；与笔记拖拽互斥
        const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
        // 主题过滤行原地展开态（点行主体=展开/收起该主题子列表；object map，session 内有效，不持久化；缺省折叠）
        const [topicExpanded, setTopicExpanded] = React.useState({})
        // 主题过滤区整体折叠态（notes-topic-collapse：缺省折叠——常态只显示「主题 (N)」一行，点击展开/收起列表；session 内记忆，不持久化）
        const [topicSecOpen, setTopicSecOpen] = React.useState(false)
        // 拖拽进行中标记（dragstart 置位 / dragend 复位）：驱动未入夹区「移出文件夹」落点提示行渲染（空态下保证拖拽中仍有可拖出落点）
        const [dragActive, setDragActive] = React.useState(false)
        // 搜索/视图/筛选中心条件变化时重置分页（新结果从头开始）
        React.useEffect(() => { setVisibleCount(PAGE_SIZE) }, [searchText, searchIds, view, filters])
        // 主题过滤行原地展开切换（与文件夹 toggleFolder 同义「点哪个展开哪个」；不持久化）
        function toggleTopicExpanded(tn) { setTopicExpanded(prev => { const next = Object.assign({}, prev); next[tn] = !next[tn]; return next }) }
        // ===== 拖拽挪入/挪出文件夹（HTML5 DnD；与右键「移动到文件夹」共用 ctxMoveToFolder 移动逻辑）=====
        // dragstart：noteId 记到 ref + dataTransfer（Firefox 需 setData 才能起拖），源行加 .dragging 半透明
        function onNoteDragStart(ev, n) {
          if (selModeRef.current) { ev.preventDefault(); return }   // 多选态禁用拖拽（点击=勾选，不挪文件夹）
          dragNoteIdRef.current = n.id
          setDragActive(true)
          try { ev.dataTransfer.setData('text/dsh-note-id', n.id); ev.dataTransfer.effectAllowed = 'move' } catch (err) {}
          try { ev.currentTarget.classList.add('dragging') } catch (err) {}
        }
        // dragend 兜底清理：无论 drop 成功与否（含拖到面板外），摘掉 .dragging 与面板内所有残留 .drop-hint + 拖拽态复位
        function onNoteDragEnd(ev) {
          dragNoteIdRef.current = null
          setDragActive(false)
          try { ev.currentTarget.classList.remove('dragging') } catch (err) {}
          try { const els = document.querySelectorAll('.dsh-notes-floating .drop-hint'); for (let i = 0; i < els.length; i++) els[i].classList.remove('drop-hint') } catch (err) {}
        }
        // ===== 文件夹行拖拽换父（notes-nested-folder-ui；与笔记拖拽共存——drop 目标按 ref 区分拖拽类型）=====
        function onFolderDragStart(ev, f) {
          if (selModeRef.current) { ev.preventDefault(); return }   // 多选态禁用拖拽
          dragFolderIdRef.current = f.id
          setDragActive(true)
          try { ev.dataTransfer.setData('text/dsh-folder-id', f.id); ev.dataTransfer.effectAllowed = 'move' } catch (err) {}
          try { ev.currentTarget.classList.add('dragging') } catch (err) {}
        }
        function onFolderDragEnd(ev) {
          dragFolderIdRef.current = null
          setDragActive(false)
          try { ev.currentTarget.classList.remove('dragging') } catch (err) {}
          try { const els = document.querySelectorAll('.dsh-notes-floating .drop-hint'); for (let i = 0; i < els.length; i++) els[i].classList.remove('drop-hint') } catch (err) {}
        }
        // 文件夹行 drop 目标：本插件拖拽（笔记 ref 或 文件夹 ref 有值）才接管——dragover preventDefault + .drop-hint 高亮；
        // 文件夹换父时自挂/挂到子孙为非法落点（不高亮不 preventDefault，浏览器显示禁止光标，drop 无动作）；深度上限留给 host 拒绝后 toast
        function onFolderDragOver(ev, f) {
          const fid = dragFolderIdRef.current
          if (fid) { if (fid === f.id || folderSubtreeIdsOf(fid)[f.id]) return }
          else if (!dragNoteIdRef.current) return
          ev.preventDefault()
          try { ev.dataTransfer.dropEffect = 'move' } catch (err) {}
          ev.currentTarget.classList.add('drop-hint')
        }
        function onFolderDragLeave(ev) { ev.currentTarget.classList.remove('drop-hint') }
        // drop 到文件夹行：文件夹拖拽 = 换父（doReparentFolder 校验+toast）；笔记拖拽 = 移入该夹（已在该夹则静默无动作）
        function onFolderDrop(ev, f) {
          ev.preventDefault()
          ev.currentTarget.classList.remove('drop-hint')
          const fid = dragFolderIdRef.current
          if (fid) { if (fid !== f.id) doReparentFolder(fid, f.id); return }
          if (!dragNoteIdRef.current) return
          const id = dragNoteIdRef.current
          const noteObj = notes.find(x => x.id === id)
          if (noteObj && (noteObj.folder || '') !== f.id) ctxMoveToFolder({ id: id }, f.id)
        }
        // 未入夹区 drop 目标：笔记拖入本区 = 移出文件夹；文件夹拖入本区 = 移回根级（仅对当前有父级的文件夹生效）
        function onUnfiledDragOver(ev) {
          if (!dragNoteIdRef.current && !dragFolderIdRef.current) return
          ev.preventDefault()
          try { ev.dataTransfer.dropEffect = 'move' } catch (err) {}
          ev.currentTarget.classList.add('drop-hint')
        }
        function onUnfiledDragLeave(ev) { ev.currentTarget.classList.remove('drop-hint') }
        function onUnfiledDrop(ev) {
          ev.preventDefault()
          ev.currentTarget.classList.remove('drop-hint')
          const fid = dragFolderIdRef.current
          if (fid) { const fObj = folders.find(x => x.id === fid); if (fObj && (fObj.parent || '')) doReparentFolder(fid, ''); return }
          if (!dragNoteIdRef.current) return
          const id = dragNoteIdRef.current
          const noteObj = notes.find(x => x.id === id)
          if (noteObj && (noteObj.folder || '')) ctxMoveToFolder({ id: id }, '')
        }
        // 懒加载分页：只渲染前 visibleCount 条笔记行，滚动到底再加载更多（避免笔记多时全量渲染 + 每条跑 highlight）
        function onListScroll(ev) {
          const el = ev.target
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) { setVisibleCount(c => c + PAGE_SIZE) }
        }
        // ===== 侧栏树渲染（原型 renderTree 翻译）：视图求值结果经 R 注入（装配层 post-guard 新鲜值）=====
        function renderTreeEls(R) {
          const loading = R.loading, selected = R.selected, focusId = R.focusId, flashId = R.flashId, selMode = R.selMode, selIds = R.selIds
          const q = R.q, filtered = R.filtered, paged = R.paged, filtersActive = R.filtersActive, filterCount = R.filterCount, hasInjectEver = R.hasInjectEver
          // 文件夹域内联输入/重命名态（popovers/folder-menu.js 托管）经 R 注入
          const renamingId = R.renamingId, renameText = R.renameText, subFolderFor = R.subFolderFor, folderInputOpen = R.folderInputOpen, folderInputText = R.folderInputText
          // ===== 侧栏笔记行（原型 note-row）：kind 色点 + 标题(+置顶 pin) + 注入 bolt + 行尾 =====
          // 行尾（原型 noteRow）：主题视图内显示所属文件夹徽章；文件夹上下文内显示淡灰主题字（方案A）；其余显示日期
          function renderNoteRow(n, inFolderCtx) {
            let tail
            if (view.type === 'topic' && (n.folder || '')) tail = e('span', { className: 'dsh-notes-fbadge' }, I('folder', 9), folderName(n.folder))
            else if (inFolderCtx && n.topic && n.topic !== '分类中') tail = e('span', { className: 'dsh-notes-note-tp', title: tt('tree.topicTip', { topic: n.topic }) }, n.topic)
            else tail = e('span', { className: 'dsh-notes-note-dt' }, n.updatedAt ? fmtDT(n.updatedAt).slice(5, 10) : '')
            // 多选态：行点击=勾选/取消（不再打开笔记），行首渲染复选框；与搜索/过滤共存（勾选按 noteId 记账，过滤不清选）
            return e('div', { key: n.id, className: 'dsh-notes-note-row' + (selected === n.id ? ' sel' : '') + (focusId === n.id ? ' focused' : '') + (flashId === n.id ? ' flash' : '') + (n.status === 'resolved' ? ' resolved' : '') + (n.status === 'superseded' ? ' superseded' : '') + (selMode && selIds[n.id] ? ' pick' : ''), onClick: () => { if (selMode) { toggleSelId(n.id); return } selectNote(n) }, onContextMenu: (ev) => openCtxMenu(ev, n), draggable: true, onDragStart: (ev) => onNoteDragStart(ev, n), onDragEnd: (ev) => onNoteDragEnd(ev) },
              selMode ? e('input', { type: 'checkbox', className: 'dsh-notes-pick-check', checked: !!selIds[n.id], onChange: () => toggleSelId(n.id), onClick: (ev) => ev.stopPropagation() }) : null,
              // 行首槽位对齐（notes-tree-typography）：caret 槽同宽透明占位（笔记行无折叠箭头）+ 图标槽 16px（kind 色点居中），与文件夹行标题文字起点一致
              e('span', { className: 'dsh-notes-caret-spacer' }),
              e('span', { className: 'dsh-notes-kind-slot' }, e('span', { className: 'dsh-notes-kind-dot', style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' } })),
              e('span', { className: 'dsh-notes-note-ti' }, n.status === 'pinned' ? I('pin', 10, 'dsh-notes-note-pin') : null, highlight(n.title || tt('tree.untitled'), q)),
              n.inject === true ? e('span', { className: 'dsh-notes-note-inj dsh-nt', 'data-tooltip': tt('tree.injectTip', { role: tt(n.injectRole === 'reference' ? 'tree.roleReference' : 'tree.roleConvention') }) + ' · ' + tt('tree.injectScope', { scope: injectScopeLabel(n.injectTo) }) }, I('bolt', 10)) : null,
              // 曾注入徽章（injectEver 粘性标记：历史上开启过注入、现已关闭；已注入时由 bolt 徽章表达，不重复显示；不满足不渲染）
              n.inject !== true && n.injectEver === true ? e('span', { className: 'dsh-notes-note-injevr dsh-nt', 'data-tooltip': tt('tree.injectEverTip') }, I('clock', 9)) : null,
              // 使用遥测（P2）：被引用徽章（0 次不显示）
              (n.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-note-use dsh-nt', 'data-tooltip': tt('tree.useCountTip', { n: n.useCount }) }, I('quote', 9), String(n.useCount)) : null,
              // 双链标记（P2）：正文含 [[..]] 时行尾显示链接图标（缓存正文优先，preview 兜底）
              hasWikiLinks(n) ? e('span', { className: 'dsh-notes-note-wiki dsh-nt', 'data-tooltip': tt('tree.wikiTip') }, I('link', 9)) : null,
              tail)
          }
          // ===== 侧栏树（原型 renderTree 翻译）：视图头 → 置顶组 → 文件夹组（nested 子笔记）→ 未入夹根级平铺（drop 移出落点）→ 主题全局过滤 =====
          const treeIds = []
          const treeEls = []
          const viewTitle = view.type === 'topic' ? tt('tree.viewTopic', { id: view.id }) : view.type === 'folder' ? tt('tree.viewFolder', { name: folderName(view.id) }) : tt('tree.viewAll')
          treeEls.push(e('div', { key: 'sec-view', className: 'dsh-notes-sec-h' },
            I('filter', 11),
            e('span', { className: 'dsh-notes-sec-h-t' }, viewTitle),
            view.type === 'topic' ? e('span', { className: 'dsh-notes-sec-h-sub' }, tt('tree.crossFolderCount', { n: filtered.length })) : null,
            view.type !== 'all' ? e('span', { className: 'dsh-notes-sec-h-clear dsh-nt', 'data-tooltip': tt('tree.clearViewTip'), onClick: (ev) => { ev.stopPropagation(); setView({ type: 'all', id: '' }) } }, '×') : null))
          // 置顶组：置顶笔记仍在其所属位置显示（带 pin 视觉），本组是跨文件夹的置顶聚合视图（可折叠，PINNED_KEY 持久化）
          const pinnedAll = filtered.filter(n => n.status === 'pinned')
          if (pinnedAll.length > 0) {
            // 过滤激活自动展开：含命中的置顶组强制展开（纯计算 OR，不写回 foldersExpanded——清除过滤即恢复手动折叠态）
            const pinOpen = isFolderExpanded(PINNED_KEY) || (filtersActive && pinnedAll.length > 0)
            treeEls.push(e('div', { key: 'sec-pinned', className: 'dsh-notes-sec-h dsh-notes-sec-toggle', onClick: () => toggleFolder(PINNED_KEY) },
              e('span', { className: 'dsh-notes-caret' + (pinOpen ? ' open' : '') }, I('chev', 10)),
              I('pin', 11),
              e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.pinned')),
              e('span', { className: 'dsh-notes-sec-h-n' }, pinnedAll.length)))
            if (pinOpen) {
              const pinRows = []
              paged.filter(n => n.status === 'pinned').forEach(n => { treeIds.push(n.id); pinRows.push(renderNoteRow(n, false)) })
              if (pinRows.length) treeEls.push(e('div', { key: 'pinned-kids', className: 'dsh-notes-nested' }, pinRows))
            }
          }
          // 文件夹组：行 = caret + folder 图标 + 名称 + 计数 + 行尾过滤图标；行主体单击 = 纯展开/折叠
          // （经典树语义唯一职责——notes-041b 用户裁决去重；caret 与行主体同一 toggle 语义，stopPropagation 防双触发）；
          // 行尾过滤图标 = 进入/退出文件夹视图（唯一进视图入口，不抢占单击）+ 右键菜单项；右键管理
          treeEls.push(e('div', { key: 'sec-folders', className: 'dsh-notes-sec-h' },
            I('folder', 11),
            e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.folders')),
            e('span', { className: 'dsh-notes-sec-h-add dsh-nt', 'data-tooltip': tt('tree.addFolderTip'), onClick: (ev) => { ev.stopPropagation(); setFolderInputText(''); setSubFolderFor(null); setFolderInputOpen(true) } }, I('plus', 12))))
          // 嵌套递归渲染（notes-nested-folder-ui）：depth-first——文件夹行 → 展开时 [内联子新建输入 → 子文件夹递归 → 直挂笔记] 包一层
          // .dsh-notes-nested 缩进容器（同级同字体/行首槽位对齐沿用排版体系；嵌套行缩进+小字由 styles.css .dsh-notes-nested 口径承担）；
          // 键盘导航顺序 = 渲染顺序（treeIds 按 depth-first 推入）；过滤命中与展开语义按子树（子树含命中 → 自动展开 + 计数=子树命中数，
          // 与 host f.count 子树口径一致；纯计算 OR 不写回 foldersExpanded——清除过滤即恢复手动折叠态）
          function renderFolderNode(f, sink) {
            const sub = folderSubtreeIdsOf(f.id)
            const kids = paged.filter(n => (n.folder || '') === f.id)
            const subHits = filtersActive ? filtered.filter(n => sub[(n.folder || '')]).length : 0
            const fOpen = isFolderExpanded(f.id) || (filtersActive && subHits > 0)
            // 计数口径：过滤激活（视图/筛选中心/搜索任一）显示子树命中数（无命中 0）；否则显示子树总数（host count 已递归）
            const cnt = filtersActive ? subHits : (f.count || 0)
            sink.push(renamingId === f.id
              ? e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' },
                  e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
                  e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                  e('input', { className: 'dsh-notes-folder-rename', value: renameText, autoFocus: true, onChange: (ev) => setRenameText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doRenameFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setRenamingId(null) } }, onBlur: () => setRenamingId(null) }))
              : e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' + (view.type === 'folder' && view.id === f.id ? ' on' : ''), onClick: () => { toggleFolder(f.id) }, onContextMenu: (ev) => openFolderMenu(ev, f), draggable: true, onDragStart: (ev) => onFolderDragStart(ev, f), onDragEnd: (ev) => onFolderDragEnd(ev), onDragOver: (ev) => onFolderDragOver(ev, f), onDragLeave: onFolderDragLeave, onDrop: (ev) => onFolderDrop(ev, f) },
                  e('span', { className: 'dsh-notes-caret' + (fOpen ? ' open' : '') + ' dsh-nt', 'data-tooltip': tt('tree.toggleTip'), onClick: (ev) => { ev.stopPropagation(); toggleFolder(f.id) } }, I('chev', 10)),
                  e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                  e('span', { className: 'dsh-notes-row-nm' }, f.name),
                  e('span', { className: 'dsh-notes-row-n' }, cnt),
                  e('span', { className: 'dsh-notes-row-vfilter dsh-nt' + (view.type === 'folder' && view.id === f.id ? ' on' : ''), 'data-tooltip': tt('tree.folderViewTip'), onClick: (ev) => { ev.stopPropagation(); setView(view.type === 'folder' && view.id === f.id ? { type: 'all', id: '' } : { type: 'folder', id: f.id }) } }, I('filter', 11))))
            if (!fOpen) return
            const childEls = []
            // 「新建子文件夹」内联输入行（右键菜单打开；渲染在本夹子内容容器首位，Enter 提交 / Esc 或空串失焦取消）
            if (subFolderFor === f.id) {
              childEls.push(e('div', { key: 'folder-add-sub', className: 'dsh-notes-folder-row' },
                e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                e('input', { className: 'dsh-notes-folder-rename', placeholder: tt('tree.subFolderPlaceholder'), value: folderInputText, autoFocus: true, onChange: (ev) => setFolderInputText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setSubFolderFor(null) } }, onBlur: () => { if (!folderInputText.trim()) setSubFolderFor(null) } })))
            }
            for (const cf of childFoldersOf(f.id)) renderFolderNode(cf, childEls)
            kids.forEach(n => { treeIds.push(n.id); childEls.push(renderNoteRow(n, true)) })
            if (childEls.length) sink.push(e('div', { key: 'kids-' + f.id, className: 'dsh-notes-nested' }, childEls))
          }
          for (const f of rootFolders()) renderFolderNode(f, treeEls)
          // 新建文件夹内联输入行（分组头 ＋ 展开；Enter 提交 / Esc 或空串失焦取消）
          if (folderInputOpen) {
            treeEls.push(e('div', { key: 'folder-add', className: 'dsh-notes-folder-row' },
              e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
              e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
              e('input', { className: 'dsh-notes-folder-rename', placeholder: tt('tree.folderPlaceholder'), value: folderInputText, autoFocus: true, onChange: (ev) => setFolderInputText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setFolderInputOpen(false) } }, onBlur: () => { if (!folderInputText.trim()) setFolderInputOpen(false) } })))
          }
          // 未入夹笔记：根级同级直显——无 folder 的笔记平铺在树根部，与文件夹行同一缩进层级（紧随文件夹列表之后、主题过滤区之前；
          // 不再渲染「未分类」分组头/分区计数——数量已并入 brand 行总计数；主题聚合由底部「主题过滤」区承担，不重复聚合）；
          // .dsh-notes-unfiled-drop 包裹容器保留为「移出文件夹」drop 落点（拖到本区任意位置 = 移出），仅在 有未入夹笔记 或 拖拽进行中 渲染——
          // 空态非拖拽不渲染任何占位；拖拽中本区头部显示淡提示行「拖到此处移出文件夹」（dragActive 驱动，空态下也保证有可拖出落点）
          const unfiled = paged.filter(n => !(n.folder || ''))
          const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })
          if (unfiledKids.length || dragActive) {
            treeEls.push(e('div', { key: 'unfiled-drop', className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop },
              dragActive ? e('div', { key: 'unfiled-hint', className: 'dsh-notes-unfiled-hint' }, dragFolderIdRef.current ? tt('tree.dropRootHint') : tt('tree.dropOutHint')) : null,
              unfiledKids))
          }
          // 主题全局过滤（原型底部区）：全库主题 + 计数；点行主体 = 原地展开/收起该主题的笔记子列表（topicExpanded，不持久化）；
          // 主题视图（跨文件夹过滤）降级为行尾过滤图标按钮（不抢占单击）
          const allTopics = {}
          notes.forEach(n => { if (n.topic) allTopics[n.topic] = (allTopics[n.topic] || 0) + 1 })
          const topicNames = Object.keys(allTopics).sort()
          if (topicNames.length) {
            // 整区默认折叠（notes-topic-collapse）：常态只显示「主题 (N)」一行（N=主题数），点分组头展开/收起（topicSecOpen，session 记忆不持久化）；
            // 展开行为与置顶折叠组（PINNED_KEY）同款：过滤激活且有主题命中时纯计算 OR 自动展开（不写回 topicSecOpen——清除过滤即恢复手动折叠态），
            // 头部计数同步切换为命中主题数（folders「过滤激活=命中数」同口径）
            const topicHitSet = {}
            filtered.forEach(n => { if (n.topic) topicHitSet[n.topic] = true })
            const topicHitCount = Object.keys(topicHitSet).length
            const topicSecOpenEff = topicSecOpen || (filtersActive && topicHitCount > 0)
            treeEls.push(e('div', { key: 'sec-topics', className: 'dsh-notes-sec-h dsh-notes-sec-toggle', onClick: () => setTopicSecOpen(!topicSecOpen) },
              e('span', { className: 'dsh-notes-caret' + (topicSecOpenEff ? ' open' : '') }, I('chev', 10)),
              I('topic', 11),
              e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.topicsHeader', { n: filtersActive ? topicHitCount : topicNames.length })),
              e('span', { className: 'dsh-notes-sec-h-sub' }, tt('tree.crossFolder'))))
            if (topicSecOpenEff) topicNames.forEach(tn => {
              const tkidsAll = filtered.filter(n => (n.topic || '') === tn)
              // 过滤激活自动展开：含命中的主题行强制展开（纯计算 OR，不写回 topicExpanded——清除过滤即恢复）；计数同步切换为命中数
              const tOpen = !!topicExpanded[tn] || (filtersActive && tkidsAll.length > 0)
              treeEls.push(e('div', { key: 'tp-' + tn, className: 'dsh-notes-row dsh-notes-topic-row' + (view.type === 'topic' && view.id === tn ? ' on' : ''), onClick: () => toggleTopicExpanded(tn) },
                e('span', { className: 'dsh-notes-caret' + (tOpen ? ' open' : '') }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('topic', 12)),
                e('span', { className: 'dsh-notes-row-nm' }, tn === '分类中' ? tt('tree.classifying') : tn),
                e('span', { className: 'dsh-notes-row-n' }, filtersActive ? tkidsAll.length : allTopics[tn]),
                e('span', { className: 'dsh-notes-row-vfilter dsh-nt' + (view.type === 'topic' && view.id === tn ? ' on' : ''), 'data-tooltip': tt('tree.topicViewTip'), onClick: (ev) => { ev.stopPropagation(); setView(view.type === 'topic' && view.id === tn ? { type: 'all', id: '' } : { type: 'topic', id: tn }) } }, I('filter', 11))))
              if (tOpen) {
                const tkids = paged.filter(n => (n.topic || '') === tn)
                if (tkids.length) { tkids.forEach(n => { treeIds.push(n.id) }); treeEls.push(e('div', { key: 'tpk-' + tn, className: 'dsh-notes-nested' }, tkids.map(n => renderNoteRow(n, false)))) }
              }
            })
          }
          // 空态：全库为空 → 引导新建；有库但过滤为空 → 无匹配提示
          if (notes.length === 0 && !loading) {
            treeEls.push(e('div', { key: 'empty', className: 'dsh-notes-empty-state' },
              e('div', { className: 'dsh-notes-empty-ic' }, I('note', 30)),
              e('div', { className: 'dsh-notes-empty-t' }, tt('tree.emptyTitle')),
              e('div', { className: 'dsh-notes-empty-s' }, tt('tree.emptySub')),
              e('button', { className: 'dsh-notes-empty-btn', onClick: openNewNote }, tt('tree.emptyBtn'))))
          } else if (filtered.length === 0 && filtersActive) {
            // 空结果态：提示 + 筛选中心条件激活时附「清空筛选」快捷动作（设计稿口径⑦）
            treeEls.push(e('div', { key: 'no-match', className: 'dsh-notes-sec-h' }, e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.noMatch')),
              filterCount > 0 ? e('span', { className: 'dsh-notes-sec-h-clear dsh-nt', 'data-tooltip': tt('tree.clearAllFiltersTip'), onClick: () => { setFilters(FILTERS0()); if (searchDebRef.current) searchDebRef.current() } }, tt('tree.clearFiltersShort')) : null))
          }
          if (loading && notes.length === 0) treeEls.unshift(e('div', { key: 'loading', className: 'dsh-notes-loading' }, tt('common.loading')))
          // 键盘导航顺序 = 树渲染顺序（置顶组与所属位置重复出现的笔记去重）
          pagedIdsRef.current = Array.from(new Set(treeIds))
          return treeEls
        }
        return {
          visibleCount: visibleCount, setVisibleCount: setVisibleCount, dragActive: dragActive, onListScroll: onListScroll,
          onNoteDragStart: onNoteDragStart, onNoteDragEnd: onNoteDragEnd, renderTreeEls: renderTreeEls
        }
    }
