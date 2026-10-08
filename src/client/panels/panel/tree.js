    // ===== panel/tree —— 文件夹树渲染 + 拖拽换位 + 分组分页（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelTree（groupShown/topicExpanded/topicSecOpen/dragActive 态 + 分页重置 + renderMoreRow 组尾加载行 + 双向拖拽族 +
    //           renderTreeEls 渲染函数（内含 renderNoteRow/renderFolderNode，签名/正文逐字））
    // needs: kernel/state.js（pagedIdsRef 跨域镜像 + 文件夹域/多选/右键/编辑器域转发别名群）、kernel/constants.js（PAGE_SIZE/group-paging 纯函数核/PINNED_KEY/FILTER_KINDS/KIND_LABELS/FILTERS0）、
    //        kernel/icons.js（e/I）、kernel/bus.js（showToast）、kernel/format.js（notifyNotesChanged）、panel/search.js（highlight，序位在前）、
    //        modals/newnote.js（openNewNote，序位在前）；notes/view/filters/searchText/searchIds 经 hook 入参注入（装配层回填，渲染期新鲜值）；
    //        post-guard 求值结果（filtered/q/filtersActive 等）经 renderTreeEls 入参注入（0.4.6-J 起四组各自分页消费 filtered，不再经全局窗口切片）
    // state 托管：四态留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // dragNoteIdRef/dragFolderIdRef 的 React.useRef 声明原文被 check.js 锚定（21/41 节）——留 hook 内（useRef 不可模块顶层调用）
    function usePanelTree(args) {
        const notes = args.notes, view = args.view, filters = args.filters, searchText = args.searchText, searchIds = args.searchIds, folders = args.folders
        // 0.4.4-C（notes-044-folder-explicit-view）：sysKids = 文件夹显式展开按需补拉的 sys 子行缓存（popovers/folder-menu.js 托管，{fid:{stamp,rows}}）
        const sysKids = args.sysKids || {}
        // 0.4.4-D（notes-044-hidden-attr）：showHidden = 显隐开关（panel/index.js 态，localStorage dsh-notes-show-hidden 持久）；
        // 关=hidden 文件夹行+nested 容器滤除（OS 语义）且 sysKids 合并层同谓词拦截 hidden 行；开=照常渲染 + hid 遮罩样式（半透明）
        const showHidden = args.showHidden === true
        // 0.4.4-G（notes-044-sys-folders）：sys 机器属性文件夹默认隐身——双通道并集放行：①筛选中心「机器」档选中
        // （filters.kinds 含 sys，与⑨⑩ 机器内容总览语义一致）②「显示隐藏」开关开（复用 D 卡开关，一档管全部「被遮」内容）；任一开即见
        const machineOn = ((filters && filters.kinds) || []).indexOf('sys') >= 0
        // 日志同权（0.4.3 验收修复⑦）：日志随 notes 主缓存直达——按夹日志懒加载 overlay 特化路径（独立 RPC + 合并）已拆除，
        // 展开日志夹与普通夹同一代码路径（零额外请求，卡顿根因消除）；「文件视图」（文件夹视图）模式同卡整体拆除
        // i18n（notes-042-i18n-cov-a 覆盖卡A）：tt = useT()——订阅 langStore，切语言本 hook（随主面板）自渲染；树区文案全走 tt()
        const tt = useT()
        const dragNoteIdRef = React.useRef(null)   // 笔记拖拽状态：dragstart 记录 noteId（ref 防闭包过期），dragend 清空
        const dragFolderIdRef = React.useRef(null)   // 文件夹拖拽状态（换父）：dragstart 记录 folderId，dragend 清空；与笔记拖拽互斥
        // 0.4.6-J（notes-046-group-paging）：分组分页 state——key=组标识（'pinned' / folder.id / 'unfiled' / 'topic:'+tn），
        // value=该组当前显示条数（缺省 PAGE_SIZE，groupShownOf 兜底）；全局 flat 窗口切片退役（四组曾共享同一窗口：
        // 文件夹收起时树内容过短 → 无滚动条 → 滚动加载永不触发 → 窗口外条目够不到，反馈 n-muxyj3zodvf3 实证死锁）
        const [groupShown, setGroupShown] = React.useState({})
        // 标签过滤行原地展开态（0.4.8：主题并入标签，state 名不动防地震；点行主体=展开/收起该标签子列表；object map，session 内有效，不持久化；缺省折叠）
        const [topicExpanded, setTopicExpanded] = React.useState({})
        // 标签过滤区整体折叠态（notes-topic-collapse：缺省折叠——常态只显示「标签 (N)」一行，点击展开/收起列表；session 内记忆，不持久化）
        const [topicSecOpen, setTopicSecOpen] = React.useState(false)
        // 拖拽进行中标记（dragstart 置位 / dragend 复位）：驱动未入夹区「移出文件夹」落点提示行渲染（空态下保证拖拽中仍有可拖出落点）
        const [dragActive, setDragActive] = React.useState(false)
        // 搜索/视图/筛选中心条件变化时重置分组分页（各组新结果从头开始；0.4.6-J 沿用原重置 effect 依赖面）
        React.useEffect(() => { setGroupShown({}) }, [searchText, searchIds, view, filters])
        // 标签过滤行原地展开切换（与文件夹 toggleFolder 同义「点哪个展开哪个」；不持久化）
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
        // ==== more-row BEGIN ====
        // 组尾「加载更多（还有 N 条）」按钮行（0.4.6-J 分组分页）：组内命中 > 当前显示数时渲染在该组内容末尾
        // （恒排笔记行之后——沿用 notes-041d-drag-root-note 未入夹区提示行置尾先例，插入/消失均不位移既有笔记行）；
        // 点击 = 该组显示数 += PAGE_SIZE（组间互不影响）；
        // 视觉复用原全局提示行口径 + cursor:pointer + hover 态（styles.css .dsh-notes-more-row）
        // 0.4.7-B③（notes-047-ux，0.4.6-J verifier 残留）：键盘可达——role=button + tabIndex=0 + Enter/Space 触发（原生按钮语义）。
        //   取舍注记：j/k 导航到组尾边界「自动聚焦加载行」不做——j/k 聚焦模型是笔记 id 序列（pagedIdsRef，kernel/state 跨域镜像），
        //   加载行非笔记行，混入要重构「id 序列 ⇄ DOM 行」映射，代价远大于收益；Tab 序列可达 + Enter/Space 触发已满足 WCAG 键盘面。
        function renderMoreRow(key, total) {
          const shown = groupShownOf(groupShown, key)
          if (total <= shown) return null
          const label = tt('tree.moreRows', { n: total - shown })
          return e('div', { key: 'more-' + key, className: 'dsh-notes-more-row', role: 'button', tabIndex: 0, 'aria-label': label, onClick: () => setGroupShown(prev => groupPageNext(prev, key)), onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setGroupShown(prev => groupPageNext(prev, key)) } } }, label)
        }
        // ==== more-row END ====
        // ===== 侧栏树渲染（原型 renderTree 翻译）：视图求值结果经 R 注入（装配层 post-guard 新鲜值）=====
        function renderTreeEls(R) {
          const loading = R.loading, selected = R.selected, focusId = R.focusId, flashId = R.flashId, selMode = R.selMode, selIds = R.selIds
          const landingStall = R.landingStall   // 0.4.6-B：落地页无活跃会话首取数挂起超阈（panel/index.js 计时写入）→ 空态引导替代无限「加载中…」
          const q = R.q, filtered = R.filtered, filtersActive = R.filtersActive, filterCount = R.filterCount, hasInjectEver = R.hasInjectEver
          // 文件夹域内联输入/重命名态（popovers/folder-menu.js 托管）经 R 注入
          const renamingId = R.renamingId, renameText = R.renameText, subFolderFor = R.subFolderFor, folderInputOpen = R.folderInputOpen, folderInputText = R.folderInputText
          // ===== 侧栏笔记行（原型 note-row）：kind 色点 + 标题(+置顶 pin) + 注入 bolt + 行尾 =====
          // 行尾（原型 noteRow）：主题视图内显示所属文件夹徽章；文件夹上下文内显示淡灰主题字（方案A）；其余显示日期
          function renderNoteRow(n, inFolderCtx) {
            let tail
            /* 0.4.8（notes-048-topic-tag-merge）：主题并入标签——行尾标签字改吃 effTagsUi（tags ∪ topic 读侧虚拟合并，剔「分类中」占位；无标签回落日期） */
            const uiTags = inFolderCtx ? effTagsUi(n) : []
            if (view.type === 'topic' && (n.folder || '')) tail = e('span', { className: 'dsh-notes-fbadge' }, I('folder', 9), folderName(n.folder))
            else if (inFolderCtx && uiTags.length) tail = e('span', { className: 'dsh-notes-note-tp', title: tt('tree.topicTip', { topic: uiTags.join(' · ') }) }, uiTags.join(' · '))
            else tail = e('span', { className: 'dsh-notes-note-dt' }, n.updatedAt ? fmtDT(n.updatedAt).slice(5, 10) : '')
            // 多选态：行点击=勾选/取消（不再打开笔记），行首渲染复选框；与搜索/过滤共存（勾选按 noteId 记账，过滤不清选）
            // 0.4.8（notes-048-note-ctxmenu）：行补 data-note 属性（与 app noteRow 同构——右键菜单/e2e 精确锚定，防派生标题子串截胡）
            return e('div', { key: n.id, 'data-note': n.id, className: 'dsh-notes-note-row' + (selected === n.id ? ' sel' : '') + (focusId === n.id ? ' focused' : '') + (flashId === n.id ? ' flash' : '') + (n.status === 'resolved' ? ' resolved' : '') + (n.status === 'superseded' ? ' superseded' : '') + (n.hidden === true ? ' hid' : '') + (selMode && selIds[n.id] ? ' pick' : ''), onClick: () => { if (selMode) { toggleSelId(n.id); return } selectNote(n) }, onContextMenu: (ev) => openCtxMenu(ev, n), draggable: true, onDragStart: (ev) => onNoteDragStart(ev, n), onDragEnd: (ev) => onNoteDragEnd(ev) },
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
              // 0.4.4-C：sys 行「机器」chip（文件夹显式展开/机器档可见的机器托管笔记可辨识；复用 fbadge 徽章样式 + meta.kindSys 字典键）
              (n.kind || 'note') === 'sys' ? e('span', { className: 'dsh-notes-fbadge dsh-nt', 'data-tooltip': tt('tree.sysChipTip') }, tt('meta.kindSys')) : null,
              tail)
          }
          // ===== 侧栏树（原型 renderTree 翻译）：视图头 → 置顶组 → 文件夹组（nested 子笔记）→ 未入夹根级平铺（drop 移出落点）→ 主题全局过滤 =====
          const treeIds = []
          const treeEls = []
          const viewTitle = view.type === 'topic' ? tt('tree.viewTopic', { id: view.id }) : tt('tree.viewAll')
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
              // 0.4.6-J：置顶组独立分页（组标识 'pinned'）——命中全量 pinnedAll 截当前显示数，组尾加载行翻页
              groupPage(pinnedAll, groupShown, 'pinned').forEach(n => { treeIds.push(n.id); pinRows.push(renderNoteRow(n, false)) })
              if (pinRows.length) treeEls.push(e('div', { key: 'pinned-kids', className: 'dsh-notes-nested' }, pinRows, renderMoreRow('pinned', pinnedAll.length)))
            }
          }
          // 文件夹组：行 = caret + folder 图标 + 名称 + 计数；行主体单击 = 纯展开/折叠
          // （经典树语义唯一职责——notes-041b 用户裁决去重；caret 与行主体同一 toggle 语义，stopPropagation 防双触发）；右键管理
          // （0.4.3 验收修复⑦：「文件视图」模式拆除——行尾漏斗进视图图标已移除，树展开即文件夹浏览）
          treeEls.push(e('div', { key: 'sec-folders', className: 'dsh-notes-sec-h' },
            I('folder', 11),
            e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.folders')),
            e('span', { className: 'dsh-notes-sec-h-add dsh-nt', 'data-tooltip': tt('tree.addFolderTip'), onClick: (ev) => { ev.stopPropagation(); setFolderInputText(''); setSubFolderFor(null); setFolderInputOpen(true) } }, I('plus', 12))))
          // 嵌套递归渲染（notes-nested-folder-ui）：depth-first——文件夹行 → 展开时 [内联子新建输入 → 子文件夹递归 → 直挂笔记] 包一层
          // .dsh-notes-nested 缩进容器（同级同字体/行首槽位对齐沿用排版体系；嵌套行缩进+小字由 styles.css .dsh-notes-nested 口径承担）；
          // 键盘导航顺序 = 渲染顺序（treeIds 按 depth-first 推入）；过滤命中与展开语义按子树（子树含命中 → 自动展开 + 计数=子树命中数，
          // 与 host f.count 子树口径一致；纯计算 OR 不写回 foldersExpanded——清除过滤即恢复手动折叠态）
          function renderFolderNode(f, sink) {
            // 0.4.4-D：hidden 文件夹在显隐开关关时整节点滤除（行 + nested 子树容器随父夹消失，OS 语义；子文件夹递归与本夹笔记行自然不渲染）
            if (!showHidden && f.hidden === true) return
            // 0.4.4-G：sys 机器属性文件夹默认整节点滤除（同 hidden 早退同层）；双通道任一开即放行（机器档选中 / 显示隐藏开）；徽标计数照常
            if (f.sys === true && !showHidden && !machineOn) return
            const sub = folderSubtreeIdsOf(f.id)
            // 0.4.4-C：合并按需补拉的 sys 子行（置尾从简——sys 行 host 序与主缓存排序口径分离，混排易误导，注释即取舍）；
            // 过滤/搜索激活时不混入（⑨ 默认列表/搜索降噪零放松：sys 仅「文件夹展开」这一个显式入口放行）；id 去重防御陈旧窗口（kind 变更等）；
            // 0.4.4-D：同层叠加 hidden 谓词——显隐开关关时 hidden 档案行不混入（开=带 hid 遮罩样式渲染）；与 C 卡合并零互扰
            // 0.4.6-J：文件夹组独立分页（组标识 = f.id）——kidsAll = 本夹命中全量，kidsBase = 分页切片（缺省 cap PAGE_SIZE）；
            // sysKids 合并口径不变：分页 slice 之后再 concat sys 置尾行——sys 行不占分页名额
            const kidsAll = filtered.filter(n => (n.folder || '') === f.id)
            const kidsBase = groupPage(kidsAll, groupShown, f.id)
            const kids = filtersActive ? kidsBase : kidsBase.concat(((sysKids[f.id] && sysKids[f.id].rows) || []).filter(n => !kidsBase.some(x => x.id === n.id) && (showHidden || n.hidden !== true)))
            const subHits = filtersActive ? filtered.filter(n => sub[(n.folder || '')]).length : 0
            const fOpen = isFolderExpanded(f.id) || (filtersActive && subHits > 0)
            // 计数口径：过滤激活（视图/筛选中心/搜索任一）显示子树命中数（无命中 0）；否则显示子树总数（host count 已递归）
            const cnt = filtersActive ? subHits : (f.count || 0)
            sink.push(renamingId === f.id
              ? e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' },
                  e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
                  e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                  e('input', { className: 'dsh-notes-folder-rename', value: renameText, autoFocus: true, onChange: (ev) => setRenameText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doRenameFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setRenamingId(null) } }, onBlur: () => setRenamingId(null) }))
              : e('div', { key: 'folder-' + f.id, className: 'dsh-notes-folder-row' + (f.hidden === true ? ' hid' : ''), onClick: () => { toggleFolder(f.id) }, onContextMenu: (ev) => openFolderMenu(ev, f), draggable: true, onDragStart: (ev) => onFolderDragStart(ev, f), onDragEnd: (ev) => onFolderDragEnd(ev), onDragOver: (ev) => onFolderDragOver(ev, f), onDragLeave: onFolderDragLeave, onDrop: (ev) => onFolderDrop(ev, f) },
                  e('span', { className: 'dsh-notes-caret' + (fOpen ? ' open' : '') + ' dsh-nt', 'data-tooltip': tt('tree.toggleTip'), onClick: (ev) => { ev.stopPropagation(); toggleFolder(f.id) } }, I('chev', 10)),
                  e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                  // 0.4.4-G：sys 夹行名带机器托管 tooltip（双通道放行可见时的辨识；无 sys 时零属性零 class 变化）
                  e('span', { className: 'dsh-notes-row-nm' + (f.sys === true ? ' dsh-nt' : ''), 'data-tooltip': f.sys === true ? tt('tree.sysFolderTip') : undefined }, f.name),
                  e('span', { className: 'dsh-notes-row-n' }, cnt)))
            if (!fOpen) return
            const childEls = []
            // 「新建子文件夹」内联输入行（右键菜单打开；渲染在本夹子内容容器首位，Enter 提交 / Esc 或空串失焦取消）
            if (subFolderFor === f.id) {
              childEls.push(e('div', { key: 'folder-add-sub', className: 'dsh-notes-folder-row' },
                e('span', { className: 'dsh-notes-caret' }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('folder', 13)),
                e('input', { className: 'dsh-notes-folder-rename', placeholder: tt('tree.subFolderPlaceholder'), value: folderInputText, autoFocus: true, onChange: (ev) => setFolderInputText(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doCreateFolder() } else if (ev.key === 'Escape') { ev.preventDefault(); setSubFolderFor(null) } }, onBlur: () => { if (!folderInputText.trim()) setSubFolderFor(null) } })))
            }
            /* 0.4.6-H（notes-046-smallfix，R2 n-mux9r8hfh7xy，与 app panels/tree.js 同构）：子夹全被遮罩（sys/hidden 整节点滤除）
               且直挂笔记为空 → 「展开为空」补一行提示（原零反馈）；有可见内容不出现；遮罩本身不松绑。
               注：递归行保持节 41 锚定原文，遮罩计数由前后 length 快照差得出（childFoldersOf 幂等纯函数，二次调用零副作用） */
            const subFolderCnt046h = childFoldersOf(f.id).length
            const beforeSub046h = childEls.length
            for (const cf of childFoldersOf(f.id)) renderFolderNode(cf, childEls)
            if (subFolderCnt046h && childEls.length === beforeSub046h && !kids.length) childEls.push(e('div', { key: 'sysmask-' + f.id, className: 'dsh-notes-sysmask-hint' }, tt('tree.sysMaskHint')))
            kids.forEach(n => { treeIds.push(n.id); childEls.push(renderNoteRow(n, true)) })
            // 0.4.6-J：组尾加载行（恒排笔记行之后；本夹命中 > 当前显示数时出现，点击该组 += PAGE_SIZE）
            const moreRow046j = renderMoreRow(f.id, kidsAll.length)
            if (moreRow046j) childEls.push(moreRow046j)
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
          // 0.4.6-J：未入夹区独立分页（组标识 'unfiled'）——unfiledHits = 命中全量，unfiled = 分页切片（缺省 cap PAGE_SIZE）
          const unfiledHits = filtered.filter(n => !(n.folder || ''))
          const unfiled = groupPage(unfiledHits, groupShown, 'unfiled')
          const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })
          if (unfiledKids.length || dragActive) {
            // 提示行排笔记行**之后**（notes-041d-drag-root-note）：dragActive 点亮瞬间若在行首插入提示行，会把本夹笔记行（=拖拽源行）整体下移，
            // Chromium 判定拖拽源位移直接取消拖拽（dragstart→立即 dragend）——根目录笔记因此拖不进文件夹；置尾后源行零位移，拖拽链路恢复；
            // 0.4.6-J 组尾加载行同例：恒排笔记行之后、拖拽提示行之前（两者皆为尾部固定槽，笔记行零位移）
            treeEls.push(e('div', { key: 'unfiled-drop', className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop },
              unfiledKids,
              renderMoreRow('unfiled', unfiledHits.length),
              dragActive ? e('div', { key: 'unfiled-hint', className: 'dsh-notes-unfiled-hint' }, dragFolderIdRef.current ? tt('tree.dropRootHint') : tt('tree.dropOutHint')) : null))
          }
          // 标签全局过滤区（0.4.8 三重分类收敛 B 方案 notes-048-topic-tag-merge：主题废弃并入标签——分组数据源 = effTags(n)
          // （tags ∪ {topic} 读侧虚拟合并，磁盘 .md 零改动）；多值分组：一篇可在多个标签下出现（语义自然）；组头计数 = 去重篇数；
          // 原「未分类」主题桶消失（topic 空/未分类且无 tags 的笔记不进任何标签组；未入夹区不受影响）；
          // 点行主体 = 原地展开/收起该标签的笔记子列表（topicExpanded，不持久化）；标签视图（跨文件夹过滤）为行尾过滤图标按钮（不抢占单击）；
          // 变量名沿用 topic*（分组键 = 标签名；状态/键名不动防地震，语义切换注释在此）
          const allTags = {}
          notes.forEach(n => { effTags(n).forEach(tg => { (allTags[tg] = allTags[tg] || {})[n.id] = true }) })
          const topicNames = Object.keys(allTags).sort()
          if (topicNames.length) {
            // 整区默认折叠（notes-topic-collapse）：常态只显示「标签 (N)」一行（N=标签数），点分组头展开/收起（topicSecOpen，session 记忆不持久化）；
            // 展开行为与置顶折叠组（PINNED_KEY）同款：过滤激活且有标签命中时纯计算 OR 自动展开（不写回 topicSecOpen——清除过滤即恢复手动折叠态），
            // 头部计数同步切换为命中标签数（folders「过滤激活=命中数」同口径）
            const topicHitSet = {}
            filtered.forEach(n => { effTags(n).forEach(tg => { topicHitSet[tg] = true }) })
            const topicHitCount = Object.keys(topicHitSet).length
            const topicSecOpenEff = topicSecOpen || (filtersActive && topicHitCount > 0)
            treeEls.push(e('div', { key: 'sec-topics', className: 'dsh-notes-sec-h dsh-notes-sec-toggle', onClick: () => setTopicSecOpen(!topicSecOpen) },
              e('span', { className: 'dsh-notes-caret' + (topicSecOpenEff ? ' open' : '') }, I('chev', 10)),
              I('tag', 11),
              e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.topicsHeader', { n: filtersActive ? topicHitCount : topicNames.length })),
              e('span', { className: 'dsh-notes-sec-h-sub' }, tt('tree.crossFolder'))))
            if (topicSecOpenEff) topicNames.forEach(tn => {
              // 多值分组：effTags 含该标签即归入（一篇可出现在多个标签组；组内计数 = 命中篇数）
              const tkidsAll = filtered.filter(n => effTags(n).indexOf(tn) >= 0)
              // 过滤激活自动展开：含命中的标签行强制展开（纯计算 OR，不写回 topicExpanded——清除过滤即恢复）；计数同步切换为命中数
              const tOpen = !!topicExpanded[tn] || (filtersActive && tkidsAll.length > 0)
              treeEls.push(e('div', { key: 'tp-' + tn, className: 'dsh-notes-row dsh-notes-topic-row' + (view.type === 'topic' && view.id === tn ? ' on' : ''), onClick: () => toggleTopicExpanded(tn) },
                e('span', { className: 'dsh-notes-caret' + (tOpen ? ' open' : '') }, I('chev', 10)),
                e('span', { className: 'dsh-notes-ic-slot' }, I('tag', 12)),
                e('span', { className: 'dsh-notes-row-nm' }, tn === '分类中' ? tt('tree.classifying') : tn),
                e('span', { className: 'dsh-notes-row-n' }, filtersActive ? tkidsAll.length : Object.keys(allTags[tn]).length),
                e('span', { className: 'dsh-notes-row-vfilter dsh-nt' + (view.type === 'topic' && view.id === tn ? ' on' : ''), 'data-tooltip': tt('tree.topicViewTip'), onClick: (ev) => { ev.stopPropagation(); setView(view.type === 'topic' && view.id === tn ? { type: 'all', id: '' } : { type: 'topic', id: tn }) } }, I('filter', 11))))
              if (tOpen) {
                // 0.4.6-J：标签组独立分页（组标识 'topic:'+tn 键名不动；命中全量 tkidsAll 截当前显示数，组尾加载行翻页）
                const tkids = groupPage(tkidsAll, groupShown, 'topic:' + tn)
                if (tkids.length) { tkids.forEach(n => { treeIds.push(n.id) }); treeEls.push(e('div', { key: 'tpk-' + tn, className: 'dsh-notes-nested' }, tkids.map(n => renderNoteRow(n, false)), renderMoreRow('topic:' + tn, tkidsAll.length))) }
              }
            })
          }
          // 空态：全库为空 → 引导新建；有库但过滤为空 → 无匹配提示
          if (notes.length === 0 && !loading) {
            treeEls.push(e('div', { key: 'empty', className: 'dsh-notes-empty-state' },
              e('div', { className: 'dsh-notes-empty-ic' }, I('note', 30)),
              e('div', { className: 'dsh-notes-empty-t' }, tt('tree.emptyTitle')),
              e('div', { className: 'dsh-notes-empty-s' }, tt('tree.emptySub')),
              // 0.4.6-C（notes-046-ux-discovery）：首笔记空态补概念指向（→ 标题栏 ? 使用说明首屏「核心概念 30 秒」）
              e('div', { className: 'dsh-notes-empty-s dsh-notes-empty-concept' }, tt('tree.emptyConcept')),
              e('button', { className: 'dsh-notes-empty-btn', onClick: openNewNote }, tt('tree.emptyBtn'))))
          } else if (filtered.length === 0 && filtersActive) {
            // 空结果态：提示 + 筛选中心条件激活时附「清空筛选」快捷动作（设计稿口径⑦）
            treeEls.push(e('div', { key: 'no-match', className: 'dsh-notes-sec-h' }, e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.noMatch')),
              filterCount > 0 ? e('span', { className: 'dsh-notes-sec-h-clear dsh-nt', 'data-tooltip': tt('tree.clearAllFiltersTip'), onClick: () => { setFilters(FILTERS0()); if (searchDebRef.current) searchDebRef.current() } }, tt('tree.clearFiltersShort')) : null))
            // 0.4.6-D（notes-046-copy-consistency，R2 n-mux7as3gnrru）：搜索空态引导行——更短关键词提示 + 「新建一篇」动作出口（→ 新建弹窗）
            treeEls.push(e('div', { key: 'no-match-guide', className: 'dsh-notes-sec-h' },
              e('span', { className: 'dsh-notes-sec-h-t' }, tt('tree.noMatchGuide') + ' '),
              e('span', { className: 'dsh-notes-sec-h-clear dsh-nt', 'data-tooltip': tt('side.newTip'), onClick: (ev) => { ev.stopPropagation(); openNewNote() } }, tt('tree.noMatchNew'))))
          }
          if (loading && notes.length === 0) {
            /* 0.4.6-B（notes-046-rpc-resilience）：落地页空态引导（无活跃会话 + 挂起超阈）——「打开一个会话后使用」+ 重试；
               重试经 kernel loadNotes 别名直取（成功路径 index.js 复位 landingStall），超时由宿主桥 30s 护栏兜底 */
            treeEls.unshift(landingStall
              ? e('div', { key: 'landing-stall', className: 'dsh-notes-empty-state' },
                  e('div', { className: 'dsh-notes-empty-ic' }, I('note', 30)),
                  e('div', { className: 'dsh-notes-empty-t' }, tt('tree.landingTitle')),
                  e('div', { className: 'dsh-notes-empty-s' }, tt('tree.landingSub')),
                  e('button', { className: 'dsh-notes-empty-btn', onClick: () => loadNotes() }, tt('tree.landingRetry')))
              : e('div', { key: 'loading', className: 'dsh-notes-loading' }, tt('common.loading')))
          }
          // 键盘导航顺序 = 树渲染顺序（置顶组与所属位置重复出现的笔记去重；0.4.6-J 组尾加载行非笔记行、不推入 treeIds，j/k 导航不经过）
          pagedIdsRef.current = Array.from(new Set(treeIds))
          return treeEls
        }
        return {
          dragActive: dragActive, renderMoreRow: renderMoreRow,
          onNoteDragStart: onNoteDragStart, onNoteDragEnd: onNoteDragEnd, renderTreeEls: renderTreeEls
        }
    }
