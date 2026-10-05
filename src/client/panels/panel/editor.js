    // ===== panel/editor —— 编辑器区：meta chips/双模式交互/自动保存/面包屑/反向链接/底栏（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelEditor（ed* 字段态/历史计数/派发历史折叠/整理撤销栈 + selectNote/doSave/doDelete/AI 整理/历史恢复回填/三态开关/双模式运行时 +
    //           renderEditorEl 渲染函数（内含 editorEl/curNote/isInjected/面包屑/反向链接求值））
    // needs: kernel/state.js（selectedRef/editorModeRef/switchModeRef 跨域镜像 + setSelected/setFocusId/setError/setView/setSelIds/setScopeOpen/expandFolder/
    //        folderPathOf/folderName/injectScopeLabel/loadNotes/later 转发别名）、kernel/constants.js（KIND_LABELS）、kernel/format.js（shortSid/isDispatchDone/fmtDT/schedFreqLabel/schedNextMs/schedPeerKey/relatedScheds/notifyNotesChanged）、
    //        kernel/bus.js（showToast）、kernel/icons.js（e/I）、editor-kernel.js（esc/renderMarkdown/serializeRich/analyzeMarkdown/sanitizeFragment/assetDisplaySrc/wikiLinksTo）、
    //        panel/wiki.js（jumpWikiRef/wikiBodiesRef 顶层绑定，序位在前）、modals/link.js（setLinkModal）+ modals/image.js（openImgModal/pickImageFile）+
    //        modals/dispatch.js（openDispatch/doDispatchDone）+ modals/history.js（openHistory）+
    //        modals/inject-manager.js（doInjSchedEdit/doInjSchedToggle/doInjSchedDel——计划块原地操作复用，notes-041-sched-plan-edit）——序位在前；
    //        selected/notes/dispatching/wikiVer/wikiResolve/bumpWikiBody/jumpToWikiTarget 经 hook 入参注入（装配层回填，渲染期新鲜值）
    // state 托管：全部 state/ref 留 hook 内（useState/useRef 声明原文被 check.js 锚定者不迁 store——27-5 节 edSens/edSensRef 等；
    // 与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）
    function usePanelEditor(args) {
        const selected = args.selected, notes = args.notes, dispatching = args.dispatching
        const wikiVer = args.wikiVer, wikiResolve = args.wikiResolve, bumpWikiBody = args.bumpWikiBody, jumpToWikiTarget = args.jumpToWikiTarget
        // i18n（notes-042-i18n-cov-b 覆盖卡B）：tt = useT()——订阅 langStore，切语言本 hook（随主面板）自渲染；编辑器/meta 区文案全走 tt()
        const tt = useT()
        const [edTitle, setEdTitle] = React.useState('')
        const [edTopic, setEdTopic] = React.useState('')
        const [edTags, setEdTags] = React.useState('')
        const [edBody, setEdBody] = React.useState('')
        const [edKind, setEdKind] = React.useState('note')
        const [edStatus, setEdStatus] = React.useState('active')
        const [edRole, setEdRole] = React.useState('off')   // 注入三态：off=不注入 / convention=约定（须遵守）/ reference=资料（按需取用）
        const [edRecall, setEdRecall] = React.useState(true)   // 目录可见（recall 字段，缺省 true=进目录；与 inject 正交）
        const [edSens, setEdSens] = React.useState(false)   // 敏感标记（sensitive 字段，缺省 false；开启后注入系统提示时正文按行打码）
        const [edScope, setEdScope] = React.useState([])
        const [savedAt, setSavedAt] = React.useState(0)
        // ===== 双模式编辑器 v3（原型 design/notes-editor-v3.html）：源码 textarea ⇄ 富文本受限 WYSIWYG =====
        // editorMode：'source' 源码 | 'rich' 富文本；默认源码；Ctrl+/ 或 meta 行两段开关切换
        const [editorMode, setEditorModeState] = React.useState('source')
        // editorModeRef 在 kernel/state.js 跨域镜像群（panel/keyboard.js Ctrl+/ 直读；下方镜像块每渲染写入）
        // 白名单降级分析（analyzeMarkdown 内核）：正文含嵌套引用/h4+/任务列表/多行 HTML 块 → 富文本入口置灰（行内 HTML 自 L1、表格自 L2 起不再降级——表格只读渲染 + 序列化逐字回吐）
        const [degraded, setDegraded] = React.useState({ ok: true, reasons: [] })
        const degradedRef = React.useRef({ ok: true, reasons: [] })
        // 富文本同步态徽标（工具栏右侧）：false=已同步源码 / true=编辑中（防抖未回写）；同值 setState React 自动 bail，逐击键调无重渲染开销
        const [richSyncing, setRichSyncing] = React.useState(false)
        const [dispatchHistoryOpen, setDispatchHistoryOpen] = React.useState(false)   // 派发历史折叠态：默认折叠，点标题行展开
        // ===== 派发计划块 + 关联调度清单（notes-034-sched-detail）：本笔记是 dispatch-schedule 约定 → meta 尾部计划块；
        // 关联调度 = 标题去「定时」前缀匹配的其他调度约定（≤5 条，点击 selectNote 跳转）；数据源 = notes slim 缓存（contractType/schedule 字段，零新 RPC）=====
        // schedPeerCacheRef/schedPeerTriedRef = log 型调度约定（front-matter 裸编辑旁路）会话级按需一次 includeLogs 兜底缓存
        const [schedPeerVer, setSchedPeerVer] = React.useState(0)   // 兜底缓存到达驱动重算（wikiVer 同模式）
        const schedPeerCacheRef = React.useRef(null)
        const schedPeerTriedRef = React.useRef(false)
        // ===== 二期 ✨整理：notes-ai-organize 按 kind 模板重写正文；organizeUndoRef = 一次撤销栈（toast「撤销」恢复）=====
        const [organizing, setOrganizing] = React.useState(false)
        const organizeUndoRef = React.useRef(null)   // { body } | null
        // ===== 历史版本面板（notes-history-ui）：详情 meta 行「历史」入口（有版本才显示）→ modal：版本列表（时间+大小）→ 点选只读预览 → 恢复 =====
        const [histCount, setHistCount] = React.useState(null)    // 当前笔记历史版本数（null=未探测；0=无版本不显示入口）
        const keepQuickRef = React.useRef(false)
        const edBodyDomRef = React.useRef(null)      // 正文 textarea DOM（新建笔记创建后聚焦）
        const edLoadingRef = React.useRef(false)     // 正文异步加载中（notes-get 在途）：AI 整理等入口的轻量互斥指示
        // R-1 安全态双字段（P0 数据丢失防护，check 节 46 看守）：edBodyLoadedRef=正文提交闸（仅 notes-get 成功后置 true，doSave 才携带 body）；
        // edLoadErr=加载失败安全态（锁定编辑 + doSave 整体暂停 + 横幅重试），绝不以空 body 为基底提交
        const edBodyLoadedRef = React.useRef(false)
        const [edLoadErr, setEdLoadErr] = React.useState('')
        const edLoadErrRef = React.useRef('')        // doSave 闭包读最新值（与 histCountRef 同模式）
        // 双模式编辑器 DOM/运行时 ref（富文本非受控：编辑期间 React 不重渲染其内容，防 IME 打断/光标丢失）
        const richRef = React.useRef(null)           // 富文本 contenteditable DOM
        const richWrapRef = React.useRef(null)       // 富文本滚动容器（拖拽图片 drop 目标 + 工具栏宿主）
        const richDirtyRef = React.useRef(false)     // 富文本编辑中（未序列化回源码）
        const composingRef = React.useRef(false)     // IME 组合输入中（期间不序列化）
        const savedRangeRef = React.useRef(null)     // 富文本选区缓存（工具栏/弹窗操作后恢复）
        const richSyncTimerRef = React.useRef(null)  // 富文本→源码 900ms 防抖 timer 句柄（disposer）
        const degTimerRef = React.useRef(null)       // 源码→降级分析 450ms 防抖 timer 句柄
        const histCountRef = React.useRef(null)     // 历史版本计数镜像（doSave/openHistory 闭包读最新值；histOpenRef 随 modal 迁入 modals/history.js）
        // 自动保存：编辑字段的最新值 ref（debounce 回调读 ref 而非闭包 state，避免过期）
        const edTitleRef = React.useRef('')
        const edTopicRef = React.useRef('')
        const edTagsRef = React.useRef('')
        const edBodyRef = React.useRef('')
        const edKindRef = React.useRef('note')
        const edStatusRef = React.useRef('active')
        const edRoleRef = React.useRef('off')
        const edRecallRef = React.useRef(true)
        const edSensRef = React.useRef(false)
        const edScopeRef = React.useRef([])
        const autoSaveRef = React.useRef(null)
        React.useEffect(() => { histCountRef.current = histCount }, [histCount])
        function selectNote(n) {
          // 双模式：切换笔记前把富文本在途编辑序列化落回 edBody 并立即保存（防 900ms debounce 打到新笔记上）
          if (editorModeRef.current === 'rich' && richDirtyRef.current) { syncFromRich('切换笔记'); doSave() }
          // 选中笔记所在文件夹自动展开（保证选中笔记在树中可见）
          if (n.folder) expandFolder(n.folder)
          setSelected(n.id); setFocusId(n.id); setEdTitle(n.title); setEdTopic(n.topic && n.topic !== '分类中' ? n.topic : '')
          keepQuickRef.current = (n.tags || []).indexOf('quick') >= 0
          setEdTags((n.tags || []).filter(t => t !== 'quick').join(', '))
          setEdKind(n.kind || 'note'); setEdStatus(n.status || 'active'); setEdRole(n.inject ? (n.injectRole || 'convention') : 'off'); setEdScope(n.injectTo || []); setEdRecall(n.recall !== false); setEdSens(n.sensitive === true)
          setEdBody('')
          setDegraded({ ok: true, reasons: [] })   // 正文未加载前降级态复位（横幅不残留上一条笔记的分析结果）
          histCountRef.current = null; setHistCount(null)   // 换笔记重置「历史」入口可见性，随即探测版本计数
          probeHistCount(n.id)
          loadEdBody(n.id)
        }
        // R-1 安全态·正文加载（notes-get 独立成函数，「选中」与横幅「重试」共用）：
        // 成功 → edBodyLoadedRef=true（doSave 唯一放行点）；失败（res.error / 空响应 / 网络异常）→ edLoadErr 安全态
        // （锁定编辑 + 暂停自动保存），绝不以空 body 为基底提交；迟到响应（已切走）零副作用
        function loadEdBody(id) {
          edLoadingRef.current = true
          edBodyLoadedRef.current = false
          edLoadErrRef.current = ''; setEdLoadErr('')
          host.call('notes-get', { id: id }).then(res => {
            if (selectedRef.current !== id) return
            edLoadingRef.current = false
            if (res && res.note) {
              edBodyLoadedRef.current = true   // R-1 正文提交闸：全局唯一放行点
              const body = res.note.body || ''
              setEdBody(body)
              bumpWikiBody(id, body, res.note.updatedAt)   // 双链索引即时新鲜（不等后台补缺）
              // 正文到达后跑降级分析；富文本模式下新正文含白名单外语法 → 回落源码模式，否则重渲染富文本
              const a = analyzeMarkdown(body)
              setDegraded(a)
              if (editorModeRef.current === 'rich') {
                if (!a.ok) { setEditorModeState('source'); showToast(tt('editor.richDegradedReasons', { reasons: a.reasons.map(r => r.label).join(tt('common.listSep')) })) }
                else { richDirtyRef.current = false; try { if (richRef.current) richRef.current.innerHTML = renderMarkdown(body, wikiResolve) } catch (err) {} }
              }
            } else {
              const msg = tt('editor.loadFailed', { msg: res && res.error ? res.error : tt('editor.loadFailedData') })
              edLoadErrRef.current = msg; setEdLoadErr(msg)
              showToast(tt('editor.loadFailedLocked', { msg: msg }))
            }
          }).catch(err => {
            if (selectedRef.current !== id) return
            edLoadingRef.current = false
            const msg = tt('editor.loadFailed', { msg: String(err && err.message || err) })
            edLoadErrRef.current = msg; setEdLoadErr(msg)
            showToast(tt('editor.loadFailedLocked', { msg: msg }))
          })
        }
        async function doSave() {
          const id = selectedRef.current
          if (!id) return
          if (edLoadErrRef.current) return   // R-1 安全态：正文加载失败未恢复，自动保存整体暂停（横幅「重试」是唯一出口）
          setError('')
          const tags = (edTagsRef.current || '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean)
          if (keepQuickRef.current && tags.indexOf('quick') < 0) tags.push('quick')
          const upd = { id: id, title: edTitleRef.current, tags: tags, kind: edKindRef.current, status: edStatusRef.current, inject: edRoleRef.current !== 'off', injectTo: edScopeRef.current, recall: edRecallRef.current, sensitive: edSensRef.current === true }
          // R-1 正文提交闸：仅 notes-get 成功加载过正文（edBodyLoadedRef）才携带 body（host 对 undefined 保留原内容，防竞态清空正文）；
          // 已加载基础上清空为空串 = 用户有意为之，附 confirmClearBody:true 显式过 host 空覆盖兜底闸（empty-body-overwrite-guard）
          if (edBodyLoadedRef.current) { upd.body = edBodyRef.current; if (upd.body === '') upd.confirmClearBody = true }
          if (upd.inject) upd.injectRole = edRoleRef.current   // 非 off 才带 injectRole（off 态不带，payload 禁 undefined；host 仅 inject=true 落盘）
          if ((edTopicRef.current || '').trim()) upd.topic = edTopicRef.current.trim()
          try {
            const res = await host.call('notes-update', upd)
            if (res && res.error) { setError(res.error); return }
            setSavedAt(Date.now())
            bumpWikiBody(id, edBodyRef.current, '')   // 双链索引：自有正文即时新鲜（updatedAt 置空 → loadNotes 后索引复核 reconcile）
            await loadNotes(true); notifyNotesChanged()
            if (histCountRef.current === 0) probeHistCount(id)   // 首次真实保存产生首份快照（0→1 转折点）→ 补探「历史」入口
          } catch (err) { setError(String(err.message || err)) }
        }
        // 软删除（notes-034-c-confirm）：确认强度 = 不可恢复性——软删可恢复 → 轻：无 confirm 直接删，撤销 toast 兜底（回收站亦可恢复）；
        // 不可恢复的 purge（回收站「彻底删除」）才保留双确认
        async function doDelete(id) {
          if (!id) return
          setError('')
          try {
            const res = await host.call('notes-delete', { id: id })
            if (res.error) { setError(res.error); return }
            if (selected === id) { setSelected(null); setEdTitle(''); setEdTopic(''); setEdTags(''); setEdBody('') }
            showToast(tt('meta.deleted'), { label: tt('meta.undo'), fn: () => undoDelete(id) })
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { setError(String(err.message || err)) }
        }
        // 单条软删撤销：notes-restore 恢复（与 app.html doDeleteNote 的撤销链路同款）
        async function undoDelete(id) {
          try {
            const res = await host.call('notes-restore', { id: id })
            if (res && res.error) { showToast(res.error); return }
            showToast(tt('meta.restored'))
            await loadNotes(true); notifyNotesChanged()
          } catch (err) { showToast(tt('meta.restoreFailed', { msg: String(err.message || err) })) }
        }
        // ===== 二期 ✨整理：当前草稿经 notes-ai-organize（notes-quick-instruct 同款 LLM 通道）按 kind 模板结构化重写 =====
        // 契约：host 只返回重写正文不落盘；client 替换编辑器内容后走既有自动保存；原正文进一次撤销栈（toast「撤销」恢复）。
        // 容错：正文为空/加载中/整理中不重入；error 或空返回一律不动原文。
        async function doAiOrganize() {
          if (organizing) return
          if (!selectedRef.current) { showToast(tt('editor.selectNoteFirst')); return }
          if (edLoadingRef.current) { showToast(tt('editor.bodyLoading')); return }
          // 富文本在途编辑先序列化落回源码（整理对象是 edBody 源码文本）
          if (editorModeRef.current === 'rich' && richDirtyRef.current) syncFromRich('整理前同步')
          const body = edBodyRef.current
          if (!body || !body.trim()) { showToast(tt('editor.bodyEmpty')); return }
          setOrganizing(true); setError('')
          try {
            const res = await host.call('notes-ai-organize', { body: body, kind: edKindRef.current, title: edTitleRef.current })
            if (res && res.error) { showToast(tt('editor.organizeFailed', { msg: res.error })); return }
            if (!res || !res.body || !res.body.trim()) { showToast(tt('editor.organizeEmpty')); return }
            organizeUndoRef.current = { body: body }   // 一次撤销栈：只保留最近一次整理前的正文
            applyOrganizedBody(res.body)
            showToast(tt('editor.organized', { kind: kindLabel(edKindRef.current) || tt('meta.kindNote') }), { label: tt('meta.undo'), fn: undoAiOrganize })
          } catch (err) { showToast(tt('editor.organizeFailed', { msg: String(err.message || err) })) } finally { setOrganizing(false) }
        }
        // 重写正文落进编辑器双模式：源码 textarea 受控随 edBody 更新；富文本重渲染内核产物（白名单外语法则回落源码模式）
        function applyOrganizedBody(text) {
          edBodyRef.current = text; setEdBody(text)
          const a = analyzeMarkdown(text)
          setDegraded(a)
          if (editorModeRef.current === 'rich') {
            if (!a.ok) setEditorModeState('source')   // 如 todo 模板含任务列表语法 → 自动落源码模式（横幅给出原因）
            else { richDirtyRef.current = false; try { if (richRef.current) richRef.current.innerHTML = renderMarkdown(text, wikiResolve) } catch (err) {} }
          }
          triggerAutoSave()   // 走既有 900ms 防抖自动保存（notes-update）
        }
        // 撤销最近一次整理（一次撤销栈，用后即清）
        function undoAiOrganize() {
          const u = organizeUndoRef.current
          if (!u) { showToast(tt('editor.noOrganizeUndo')); return }
          organizeUndoRef.current = null
          applyOrganizedBody(u.body)
          showToast(tt('editor.organizeUndone'))
        }
        // ===== 历史版本面板（notes-history-ui）：「历史」入口探测 + 列表/预览/恢复链路 =====
        // 入口可见性探测：选中笔记后拉版本计数（notes-history 是轻量列表 RPC，零正文明文）；0 版本不显示入口。
        // doSave 完成后仅在 0→1 转折点补探一次（首次真实保存产生首份快照），其余保存不增 RPC。
        function probeHistCount(id) {
          if (!id) return
          host.call('notes-history', { id: id }).then(res => {
            if (res && !res.error && selectedRef.current === id) { const c = (res.versions || []).length; histCountRef.current = c; setHistCount(c) }
          }).catch(() => {})
        }
        // 恢复回填（与 applyOrganizedBody 差别：恢复版已由 host 落盘，不走 triggerAutoSave——恢复不是新编辑，不能再把恢复版快照一遍污染历史）
        function applyRestoredBody(id, text) {
          edBodyRef.current = text; setEdBody(text)
          const a = analyzeMarkdown(text)
          setDegraded(a)
          if (editorModeRef.current === 'rich') {
            if (!a.ok) setEditorModeState('source')
            else { richDirtyRef.current = false; try { if (richRef.current) richRef.current.innerHTML = renderMarkdown(text, wikiResolve) } catch (err) {} }
          }
          bumpWikiBody(id, text, '')
        }
        function jumpToSession(sessionId) { if (sessions && sessionId) { try { sessions.open(sessionId) } catch (err) {} } }
        // ===== 派发计划块辅助（notes-034-sched-detail；与注入管理调度区同口径同数据源，schedBadgeEl/schedNextLabel 镜像）=====
        // 上次结果徽章：lastError 红 / lastRun sent 绿 / 未触发灰
        function schedPlanBadgeEl(n) {
          const s = n.schedule
          if (s.lastError) return e('span', { className: 'dsh-notes-sched-badge err dsh-nt', 'data-tooltip': s.lastError.message || '' }, I('x', 9), tt('meta.schedFailed', { time: fmtDT(s.lastError.at) }))
          if (s.lastRun) return s.lastRun.status === 'sent'
            ? e('span', { className: 'dsh-notes-sched-badge ok dsh-nt', 'data-tooltip': tt('meta.schedReceiptTip', { id: s.lastRun.receiptId || '' }) }, I('check', 9), tt('meta.schedSent', { time: fmtDT(s.lastRun.at) }))
            : e('span', { className: 'dsh-notes-sched-badge err' }, I('x', 9), tt('meta.schedFailed', { time: fmtDT(s.lastRun.at) }))
          return e('span', { className: 'dsh-notes-sched-badge' }, tt('meta.schedNever'))
        }
        // 下次触发展示：暂停 → 已暂停；单次已触发 → 已触发；否则「下次 <本地时间>」（schedNextMs 本地渲染，锚点同 host schedDueAt 口径）
        function schedPlanNextLabel(n) {
          const s = n.schedule
          if (s.enabled === false) return tt('meta.schedPaused')
          if (s.at && s.lastFiredAt && Date.parse(s.lastFiredAt) >= Date.parse(s.at)) return tt('meta.schedFired')
          const ms = schedNextMs(n)
          return ms === null ? '—' : tt('meta.schedNext', { time: fmtDT(new Date(ms).toISOString()) })
        }
        // 关联调度数据源：notes 缓存优先 + overlay 合并（log 型调度约定旁路兜底；overlay 只补缓存外条目，会话级缓存不重取）
        function schedPeerSource() {
          const extra = schedPeerCacheRef.current
          if (!extra) return notes
          const inList = {}
          notes.forEach(n => { inList[n.id] = true })
          return notes.concat(extra.filter(n => !inList[n.id]))
        }
        // 注入三态切换：独立字段 inject + injectRole（off→inject:false；约定/资料→inject:true+injectRole），不碰标签
        // off→非off 时自动展开范围浮层（与原 toggle 开启行为一致）；切到 off 收起浮层
        function setRoleSeg(r) {
          if (r === edRole) return
          const wasOff = edRole === 'off'
          setEdRole(r)
          if (r === 'off') setScopeOpen(false)
          else if (wasOff) setScopeOpen(true)
          triggerAutoSave()
        }
        // 目录可见开关：独立字段 recall（缺省 true=进目录；false 逐条排除，与 inject 正交）
        function toggleRecall() { setEdRecall(!edRecall); triggerAutoSave() }
        // 敏感开关：独立字段 sensitive（缺省 false；开启后注入系统提示时正文按行打码，键保留值遮蔽，Agent 用 note_get 取原文）
        function toggleSens() { setEdSens(!edSens); triggerAutoSave() }
        // 范围多选：切换某个会话短 id 的选中态（缺省=所有会话；存量 'global'/'workspace' 值在首次勾选时规范化掉，host 端仍容错）
        // 归一比对（notes-034-injectto-norm）：勾选态以 scopeHas 为准（存量长 id 也算已勾选）；取消勾选连同长 id 存量一并移除，保存落短 id（host 侧另有写入归一兜底）
        function toggleScope(key) {
          const cur = (edScopeRef.current || []).filter(t => t !== 'global' && t !== 'workspace')
          const next = scopeHas(cur, key) ? cur.filter(t => shortSid(t) !== key) : cur.concat([key])
          setEdScope(next)
          triggerAutoSave()
        }
        // ===== 双模式编辑器 v3：模式切换 / 序列化同步 / 工具栏 / 图片三入口（规格：design/notes-editor-v3.html）=====
        // switchModeRef 在 kernel/state.js 跨域镜像群（全局 keydown 闭包挂一次，经 ref 调最新 switchMode）
        // 模式切换（原型 setMode）：进富文本前跑降级分析；离开富文本先把在途编辑序列化落回源码
        function switchMode(m) {
          if (m === editorModeRef.current) return
          if (m === 'rich') {
            const a = analyzeMarkdown(edBodyRef.current)
            setDegraded(a)
            if (!a.ok) { showToast(tt('editor.richDegradedReasons', { reasons: a.reasons.map(r => r.label).join(tt('common.listSep')) })); return }
            richDirtyRef.current = false
            setEditorModeState('rich')
          } else {
            if (richDirtyRef.current) syncFromRich('切换模式')
            setEditorModeState('source')
          }
        }
        // 富文本 → 源码序列化（原型 syncFromRich）：内容无损最高优先——序列化结果有变化才写 edBody 并走既有 doSave 自动保存
        function syncFromRich(why) {
          const el = richRef.current
          if (!el || editorModeRef.current !== 'rich') return
          const md2 = serializeRich(el)
          richDirtyRef.current = false
          setRichSyncing(false)
          if (md2 !== edBodyRef.current) { edBodyRef.current = md2; setEdBody(md2); triggerAutoSave() }
        }
        // 富文本编辑防抖：900ms 未输入即序列化回源码（IME 组合输入期间绝不序列化）
        function scheduleRichSync() {
          if (composingRef.current) return
          if (richSyncTimerRef.current) { try { richSyncTimerRef.current() } catch (err) {} }
          richSyncTimerRef.current = later(() => { richSyncTimerRef.current = null; if (richDirtyRef.current) syncFromRich('防抖') }, 900)
        }
        // 源码模式编辑后 450ms 防抖降级分析（原型 onSourceInput）：降级态翻转时 toast 告知
        function scheduleDegAnalyze() {
          if (degTimerRef.current) { try { degTimerRef.current() } catch (err) {} }
          degTimerRef.current = later(() => {
            degTimerRef.current = null
            const a = analyzeMarkdown(edBodyRef.current)
            const was = degradedRef.current.ok
            setDegraded(a)
            if (was !== a.ok) showToast(a.ok ? tt('editor.richRestored') : tt('editor.richDisabled'))
          }, 450)
        }
        // 富文本选区缓存/恢复（工具栏 mousedown 阻止默认保住选区；弹窗关闭后恢复）
        function keepSel() { const sel = window.getSelection(); if (sel && sel.rangeCount > 0) { try { savedRangeRef.current = sel.getRangeAt(0).cloneRange() } catch (err) {} } }
        function restoreSel() {
          const sel = window.getSelection(); if (!sel) return
          sel.removeAllRanges()
          if (savedRangeRef.current) { try { sel.addRange(savedRangeRef.current); return } catch (err) {} }
          const r = document.createRange(); const el = richRef.current
          if (el) { r.selectNodeContents(el); r.collapse(false); sel.addRange(r) }
        }
        // 富文本工具栏（原型 toolbarAction）：execCommand 语义标签（styleWithCSS:false → <b>/<i>，序列化器可识别）
        function toolbarAction(a) {
          restoreSel()
          const el = richRef.current; if (el) el.focus()
          if (a === 'bold') document.execCommand('bold')
          else if (a === 'italic') document.execCommand('italic')
          else if (a === 'ul') document.execCommand('insertUnorderedList')
          else if (a === 'ol') document.execCommand('insertOrderedList')
          else if (a === 'quote') document.execCommand('formatBlock', false, 'blockquote')
          else if (a === 'code') {
            const sel = window.getSelection(), txt = sel && !sel.isCollapsed ? String(sel) : ''
            if (!txt) { showToast(tt('editor.selectCodeFirst')); return }
            document.execCommand('insertHTML', false, '<code>' + esc(txt) + '</code>')
          }
          else if (a === 'link') {
            const sel2 = window.getSelection()
            if (!sel2 || sel2.isCollapsed) { showToast(tt('editor.selectLinkFirst')); return }
            keepSel(); setLinkModal({ text: String(sel2), url: 'https://' }); return
          }
          else if (a === 'image') { keepSel(); openImgModal(null); return }
          keepSel(); richDirtyRef.current = true; scheduleRichSync(); updateToolbarState()
        }
        // 工具栏激活态（原型 updateToolbarState）：直接拨 className，不走 React setState（selectionchange 高频）
        function updateToolbarState() {
          const wrap = richWrapRef.current
          if (!wrap || editorModeRef.current !== 'rich') return
          const map = { bold: 'bold', italic: 'italic', ul: 'insertUnorderedList', ol: 'insertOrderedList' }
          const btns = wrap.querySelectorAll('.dsh-notes-rtb-btn')
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i], a = b.getAttribute('data-a')
            let on = false
            try { if (map[a]) on = document.queryCommandState(map[a]) } catch (err) {}
            if (a === 'quote' || a === 'code') {
              const sel = window.getSelection()
              let n = sel && sel.rangeCount ? sel.anchorNode : null
              if (n && n.nodeType === 3) n = n.parentNode
              on = !!(n && n.closest && n.closest(a === 'quote' ? 'blockquote' : 'code'))
            }
            b.classList.toggle('on', !!on)
          }
        }
        // 富文本粘贴 HTML 白名单清洗插入（原型 insertSanitizedHtml；清洗规则见内核 sanitizeFragment）
        function insertSanitizedHtml(html) {
          const doc = new DOMParser().parseFromString(html, 'text/html')
          const clean = sanitizeFragment(doc.body)
          const sel = window.getSelection()
          if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0); r.deleteContents()
            const frag = document.createDocumentFragment()
            let n; const nodes = []
            while ((n = clean.firstChild)) nodes.push(n)
            nodes.forEach(x => frag.appendChild(x))
            r.insertNode(frag)
          }
          richDirtyRef.current = true; scheduleRichSync()
        }
        // 光标处插入图片（原型 applyInsertImage）：源码模式插 Markdown 文本，富文本模式插 img 节点（随后序列化同步回源码）
        function insertImageMd(mdSrc, alt) {
          if (editorModeRef.current === 'rich') {
            restoreSel()
            const el = richRef.current; if (!el) return
            el.focus()
            const img = document.createElement('img')
            img.src = assetDisplaySrc(mdSrc); img.setAttribute('data-md-src', mdSrc); img.alt = alt
            const sel = window.getSelection(), range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
            let blk = range ? range.startContainer : null
            if (blk && blk.nodeType === 3) blk = blk.parentNode
            const p = blk && blk.closest ? blk.closest('p') : null
            if (p && !p.textContent.trim() && !p.querySelector('img')) p.appendChild(img)   // 空段落 → 直接放入
            else if (range) { range.deleteContents(); range.insertNode(img) }               // 光标处内联插入
            else el.appendChild(img)
            richDirtyRef.current = true
            syncFromRich('插入图片')
          } else {
            const ta = edBodyDomRef.current
            const cur = edBodyRef.current
            const pos = ta && ta.selectionStart != null ? ta.selectionStart : cur.length
            const ins = '![' + alt + '](' + mdSrc + ')'
            const next = cur.slice(0, pos) + ins + cur.slice(pos)
            edBodyRef.current = next; setEdBody(next); triggerAutoSave(); scheduleDegAnalyze()
            later(() => { try { const t2 = edBodyDomRef.current; if (t2) { t2.focus(); t2.setSelectionRange(pos + ins.length, pos + ins.length) } } catch (err) {} }, 60)
          }
        }
        // 进入富文本 / 切换笔记：渲染内核产物进 contenteditable + 绑定编辑事件（编辑期间不重渲染，防 IME 打断）
        React.useEffect(() => {
          if (editorMode !== 'rich') return
          const el = richRef.current, wrap = richWrapRef.current
          if (!el || !wrap) return
          if (!richDirtyRef.current) el.innerHTML = renderMarkdown(edBodyRef.current, wikiResolve)
          try { document.execCommand('styleWithCSS', false, false) } catch (err) {}
          const onInput = () => { richDirtyRef.current = true; setRichSyncing(true); scheduleRichSync(); keepSel() }
          const onCompStart = () => { composingRef.current = true; if (richSyncTimerRef.current) { try { richSyncTimerRef.current() } catch (e2) {} richSyncTimerRef.current = null } }
          const onCompEnd = () => { composingRef.current = false; richDirtyRef.current = true; setRichSyncing(true); scheduleRichSync() }
          const onBlur = () => { if (richDirtyRef.current) syncFromRich('失焦') }
          const onKeyUp = () => updateToolbarState()
          const onMouseUp = () => { keepSel(); updateToolbarState() }
          const onSelChange = () => { const sel = window.getSelection(); if (sel && sel.rangeCount && el.contains(sel.anchorNode)) { keepSel(); updateToolbarState() } }
          // P2 双链：富文本内点击 [[..]] 锚 → 跳转选中目标笔记（阻止默认 #wiki 哈希跳转；跳前序列化在途编辑落回源码）
          // L2 只读表格：点击表格区块 → toast 提示（contenteditable=false 原子岛屿，富文本内不做表格编辑）
          const onWikiClick = (ev) => {
            const a = ev.target && ev.target.closest ? ev.target.closest('a[data-wiki]') : null
            if (a && el.contains(a)) {
              ev.preventDefault(); ev.stopPropagation()
              if (jumpWikiRef.current) jumpWikiRef.current(a.getAttribute('data-wiki') || '')
              return
            }
            const tb = ev.target && ev.target.closest ? ev.target.closest('table.dsh-notes-table') : null
            if (tb && el.contains(tb)) showToast(tt('editor.tableReadonly'))
          }
          // 图片入口①：Ctrl+V 粘贴（clipboardData.files）；其余粘贴：HTML → 白名单清洗，纯文本 → 纯文本插入
          const onPaste = (ev) => {
            const cd = ev.clipboardData
            // 注：mime 判定用 indexOf 而非正则 /^image\//——build-dist 抽取器不识正则字面量，`\/`+`/` 相邻会被误当行注释
            if (cd && cd.files && cd.files.length && cd.files[0].type.indexOf('image/') === 0) {
              ev.preventDefault(); keepSel(); pickImageFile(cd.files[0]); return
            }
            const html = cd ? cd.getData('text/html') : ''
            if (html) { ev.preventDefault(); insertSanitizedHtml(html); return }
            const txt = cd ? cd.getData('text/plain') : ''
            if (txt) { ev.preventDefault(); document.execCommand('insertText', false, txt) }
          }
          // 图片入口②：拖拽文件进富文本
          const onDragOver = (ev) => { ev.preventDefault(); wrap.classList.add('drop') }
          const onDragLeave = () => wrap.classList.remove('drop')
          const onDrop = (ev) => {
            ev.preventDefault(); wrap.classList.remove('drop')
            const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]
            if (!f) return
            if (!f.type || f.type.indexOf('image/') !== 0) { showToast(tt('editor.imageOnly')); return }
            keepSel(); pickImageFile(f)
          }
          el.addEventListener('input', onInput)
          el.addEventListener('compositionstart', onCompStart)
          el.addEventListener('compositionend', onCompEnd)
          el.addEventListener('blur', onBlur)
          el.addEventListener('keyup', onKeyUp)
          el.addEventListener('mouseup', onMouseUp)
          el.addEventListener('paste', onPaste)
          el.addEventListener('click', onWikiClick)
          wrap.addEventListener('dragover', onDragOver)
          wrap.addEventListener('dragleave', onDragLeave)
          wrap.addEventListener('drop', onDrop)
          document.addEventListener('selectionchange', onSelChange)
          return () => {
            el.removeEventListener('input', onInput)
            el.removeEventListener('compositionstart', onCompStart)
            el.removeEventListener('compositionend', onCompEnd)
            el.removeEventListener('blur', onBlur)
            el.removeEventListener('keyup', onKeyUp)
            el.removeEventListener('mouseup', onMouseUp)
            el.removeEventListener('paste', onPaste)
            el.removeEventListener('click', onWikiClick)
            wrap.removeEventListener('dragover', onDragOver)
            wrap.removeEventListener('dragleave', onDragLeave)
            wrap.removeEventListener('drop', onDrop)
            document.removeEventListener('selectionchange', onSelChange)
          }
        }, [editorMode, selected])
        // 关联调度兜底（notes-034-sched-detail③）：详情涉及调度（自身是调度约定或缓存内已有匹配）且缓存口径不含 log 时，
        // 会话级按需一次 notes-list includeLogs 补齐 log 型调度约定（front-matter 旁路）；常态零新 RPC（复用 notes slim 缓存）
        React.useEffect(() => {
          const cur = notes.find(n => n.id === selected)
          if (!cur) return
          if (!((cur.contractType || '') === 'dispatch-schedule' && cur.schedule) && !relatedScheds(cur, notes).length) return
          if (schedPeerTriedRef.current) return
          schedPeerTriedRef.current = true
          if (notes.some(n => (n.kind || 'note') === 'log')) return   // 缓存已是 includeLogs 口径（含 log 行），主缓存即全量
          host.call('notes-list', { includeLogs: true }).then(res => {
            if (res && res.notes) { schedPeerCacheRef.current = res.notes; setSchedPeerVer(v => v + 1) }
          }).catch(() => {})
        }, [selected, notes])
        // ===== 显式归档：预览 → 勾选 → 执行 → toast 撤销 =====
        // 归档后清理：被合并的笔记从列表消失——清掉多选残留；若正打开的笔记被合并则退出编辑器选中态
        function afterArchiveCleanup(mergedMemberIds) {
          const gone = {}
          for (const id of mergedMemberIds) gone[id] = true
          setSelIds(prev => { const next = {}; let dirty = false; for (const k of Object.keys(prev)) { if (gone[k]) dirty = true; else next[k] = true } return dirty ? next : prev })
          if (selected && gone[selected]) { setSelected(null); setEdTitle(''); setEdTopic(''); setEdTags(''); setEdBody('') }
        }
        // 同步编辑字段 ref（供自动保存 debounce 读最新值）
        edTitleRef.current = edTitle
        edTopicRef.current = edTopic
        edTagsRef.current = edTags
        edBodyRef.current = edBody
        edKindRef.current = edKind
        edStatusRef.current = edStatus
        edRoleRef.current = edRole
        edRecallRef.current = edRecall
        edSensRef.current = edSens
        edScopeRef.current = edScope
        // 双模式编辑器 ref 镜像（keydown/effect 闭包读最新值）
        editorModeRef.current = editorMode
        degradedRef.current = degraded
        switchModeRef.current = switchMode
        jumpWikiRef.current = jumpToWikiTarget   // P2 双链跳转（富文本 click 委托读最新闭包；jumpWikiRef 为 panel/wiki.js 顶层绑定）
        // 自动保存：debounce 只注册一次（null 时赋值），回调读 ref 避免闭包过期
        if (!autoSaveRef.current) autoSaveRef.current = timer.debounce(() => { if (selectedRef.current) doSave() }, 900)
        function triggerAutoSave() { if (autoSaveRef.current) autoSaveRef.current() }
        // i18n（覆盖卡B）：rich 空态 CSS content 占位串——styles.css 静态 zh 缺省保留（var() 回退值），运行时按语言态写 CSS 变量（tt 随 langStore 换实例 → 本 effect 重跑）
        React.useEffect(() => { try { document.documentElement.style.setProperty('--dsh-notes-rich-ph', '"' + tt('editor.richPlaceholder') + '"') } catch (err) {} }, [tt])
        // ===== 编辑器区渲染（原型 .ed）：面包屑 + 大标题 + meta chips 行 + 正文 + 底部状态 =====
        // 装配层 post-guard 调用（面板关闭时不求值）；scopePanelEl 等跨域渲染产物经 R 入参注入
        function renderEditorEl(R) {
          const scopePanelEl = R.scopePanelEl
          const scopeOpen = R.scopeOpen
          // 是否注入为上下文：由 inject + injectRole 双字段推出的三态决定（off 之外即注入中，不依赖标签）
          const isInjected = edRole !== 'off'
          // 当前选中笔记（编辑器区多处用）
          const curNote = notes.find(n => n.id === selected) || null
          const curFolderName = curNote && curNote.folder ? folderName(curNote.folder) : ''
          const curTopicName = curNote && curNote.topic && curNote.topic !== '分类中' ? curNote.topic : ''
          // 主题全局过滤跳转（面包屑主题段 + 主题 chip 跳钮共用）：未识别主题时提示不跳转
          function jumpToTopicFilter() {
            if (!curTopicName) { showToast(tt('meta.noTopic')); return }
            setView({ type: 'topic', id: curTopicName })
            showToast(tt('meta.filteredByTopic', { name: curTopicName }))
          }
          const curDispatches = (curNote && curNote.dispatches) || []
          // P3 派发闭环：待回执条数（驱动详情 meta 徽章）
          const dispatchOpenCount = curDispatches.filter(d => !isDispatchDone(d)).length
          // ===== 派发计划块 + 关联调度清单（notes-034-sched-detail）：同 app.html renderMeta 尾部同款 =====
          void schedPeerVer   // 兜底缓存到达驱动重算（wikiVer 同模式）
          const curIsSched = !!(curNote && (curNote.contractType || '') === 'dispatch-schedule' && curNote.schedule)
          const schedPeers = curNote ? relatedScheds(curNote, schedPeerSource()).slice(0, 5) : []   // 关联清单 ≤5 条（防极端刷屏，注入管理总览看全量）
          // ===== P2 反向链接：全库正文索引扫描（extractWikiTargets/wikiLinksTo 与内核同一口径）；索引未到的条目暂不计，标题行提示「索引中…」=====
          void wikiVer   // 索引版本号驱动本区重算（索引推进 → setWikiVer → 重渲染）
          const wikiWarm = notes.every(n => !!wikiBodiesRef.current[n.id])
          const backlinks = (() => {
            if (!curNote) return []
            const out = []
            for (const n of notes) {
              if (n.id === curNote.id) continue   // 自链不算反向链接
              const c = wikiBodiesRef.current[n.id]
              if (!c) continue
              if (wikiLinksTo(c.body, curNote.id, curNote.title || '')) out.push(n)
            }
            return out
          })()
          const editorEl = curNote ? e('section', { className: 'dsh-notes-ed' },
          e('div', { className: 'dsh-notes-ed-h' },
            e('div', { className: 'dsh-notes-ed-crumb' },
              // 面包屑文件夹段（notes-nested-folder-ui）：「父/子/孙」路径；0.4.3⑦ 文件视图拆除后点击 = 树内展开该文件夹（含祖先链），不切视图
              curNote.folder ? folderPathOf(curNote.folder).map(pf => e(React.Fragment, { key: 'crumbf-' + pf.id },
                e('span', { className: 'dsh-notes-crumb-lnk dsh-nt', 'data-tooltip': tt('meta.crumbFolderExpandTip', { name: pf.name }), onClick: () => { folderPathOf(pf.id).forEach(af => expandFolder(af.id)) } }, pf.name),
                e('span', { className: 'dsh-notes-crumb-sep' }, '/'))) : null,
              e('span', { className: 'dsh-notes-crumb-lnk dsh-nt', 'data-tooltip': tt('meta.crumbTopicViewTip'), onClick: jumpToTopicFilter }, curTopicName || tt('meta.uncategorized')),
              e('span', { className: 'dsh-notes-crumb-sep' }, '/'),
              e('span', null, curNote.id)),
            e('input', { className: 'dsh-notes-ed-title', placeholder: tt('tree.untitled'), value: edTitle, readOnly: !!edLoadErr, onChange: (ev) => { setEdTitle(ev.target.value); triggerAutoSave() } }),
            e('div', { className: 'dsh-notes-ed-meta' },
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.kindTipFull') },
                e('span', { className: 'dsh-notes-meta-dot', style: { background: 'var(--nkind-' + edKind + ')' } }),
                e('select', { className: 'dsh-notes-meta-select', value: edKind, onChange: (ev) => { setEdKind(ev.target.value); triggerAutoSave() } },
                  e('option', { value: 'note' }, tt('meta.kindNote')),
                  e('option', { value: 'decision' }, tt('meta.kindDecision')),
                  e('option', { value: 'todo' }, tt('meta.kindTodo')),
                  e('option', { value: 'link' }, tt('meta.kindLink')),
                  e('option', { value: 'quote' }, tt('meta.kindQuote')),
                  e('option', { value: 'log' }, tt('meta.kindLog')),
                  /* 0.4.3⑩：sys 为机器托管 kind——仅当前笔记已是 sys 时渲染该选项（显示保真，防受控 select 回退首项误导），人工不可转入 */
                  edKind === 'sys' ? e('option', { value: 'sys' }, tt('meta.kindSys')) : null)),
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.topicTipClient') },
                I('topic', 11),
                e('input', { className: 'dsh-notes-meta-topic-input', placeholder: tt('meta.topicPlaceholder'), value: edTopic, onChange: (ev) => { setEdTopic(ev.target.value); triggerAutoSave() } }),
                e('span', { className: 'dsh-notes-meta-jump dsh-nt', 'data-tooltip': tt('meta.topicFilterTip'), onClick: jumpToTopicFilter }, I('filter', 10))),
              curFolderName ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.folderTip') }, I('folder', 11), curFolderName) : null,
              // 使用遥测（P2）：详情 meta chip「被引用 N 次」（0 次不显示）
              (curNote.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.useCountTip') }, I('quote', 11), tt('meta.useCount', { n: curNote.useCount })) : null,
              // P3 派发闭环徽章：有派发记录时聚合显示（pending=有待回执 / done=全部已回执），点击展开派发历史
              curDispatches.length ? e('span', { className: 'dsh-notes-meta-chip dsh-notes-dispatch-badge ' + (dispatchOpenCount ? 'pending' : 'done'), onClick: () => setDispatchHistoryOpen(true), 'data-tooltip': dispatchOpenCount ? tt('meta.dispPendingTip', { open: dispatchOpenCount, total: curDispatches.length }) : tt('meta.dispDoneTip', { total: curDispatches.length }) },
                I(dispatchOpenCount ? 'play' : 'check', 11),
                dispatchOpenCount ? ' ' + tt('meta.dispPending', { open: dispatchOpenCount, total: curDispatches.length }) : ' ' + tt('meta.dispDone')) : null,
              // 注入三态开关（0.4.3⑦ 注入硬关 UI 化）：kind=log 不渲染开关——UI 层不提供日志注入选项（host injectForcedOff 硬闸双保险保留）
              edKind === 'log'
                ? e('span', { className: 'dsh-notes-meta-chip dsh-nt', 'data-tooltip': tt('meta.logNoInjectTip') }, I('bolt', 11), tt('meta.logNoInject'))
                : e('span', { className: 'dsh-notes-meta-chip dsh-notes-role-seg' },
                I('bolt', 11),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'off' ? ' on' : ''), onClick: () => setRoleSeg('off'), 'data-tooltip': tt('meta.roleOffTip') }, tt('meta.roleOff')),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'convention' ? ' on' : ''), onClick: () => setRoleSeg('convention'), 'data-tooltip': tt('meta.roleConventionTip') }, tt('tree.roleConvention')),
                e('span', { className: 'dsh-notes-role-opt dsh-nt' + (edRole === 'reference' ? ' on' : ''), onClick: () => setRoleSeg('reference'), 'data-tooltip': tt('meta.roleReferenceTip') }, tt('tree.roleReference'))),
              isInjected ? e('span', { className: 'dsh-notes-ed-scope-wrap' },
                e('button', { className: 'dsh-notes-meta-chip dsh-notes-scope-trigger dsh-nt', onClick: (ev) => { ev.stopPropagation(); setScopeOpen(!scopeOpen) }, 'data-tooltip': tt('meta.scopeTip') },
                  injectScopeLabel(edScope), e('span', { className: 'dsh-notes-scope-caret' }, '▾')),
                scopePanelEl)
              : null,
              // 曾注入徽章（injectEver 粘性标记：单向只升不降，不随关闭回退；当前已注入时由上方注入角色段表达，不重复显示）
              curNote.injectEver === true && !isInjected ? e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.injectEverTip') }, I('clock', 11), tt('meta.injectEver')) : null,
              e('span', { className: 'dsh-notes-meta-chip tgl' + (edRecall ? ' on' : ''), onClick: toggleRecall, 'data-tooltip': tt('meta.recallTipNote') }, I('eye', 11), tt('meta.recall')),
              e('span', { className: 'dsh-notes-meta-chip tgl' + (edSens ? ' on' : ''), onClick: toggleSens, 'data-tooltip': tt('meta.sensTip') }, I('lock', 11), tt('meta.sens')),
              e('span', { className: 'dsh-notes-meta-chip', 'data-tooltip': tt('meta.tagsTipClient') },
                I('tag', 11),
                e('input', { className: 'dsh-notes-meta-tags-input', placeholder: tt('meta.tagsTip'), value: edTags, onChange: (ev) => { setEdTags(ev.target.value); triggerAutoSave() } })),
              e('span', { className: 'dsh-notes-meta-sp' }),
              // 双模式两段开关（原型 .modeseg）：源码 ⇄ 富文本；降级态富文本段置灰 + tooltip 给出原因
              e('span', { className: 'dsh-notes-modeseg', role: 'group', 'aria-label': tt('meta.modeAria') },
                e('button', { className: 'dsh-notes-modeseg-seg' + (editorMode === 'source' ? ' on' : '') + ' dsh-nt', 'data-tooltip': tt('meta.srcModeTip'), onClick: () => switchMode('source') }, I('codeblock', 12), tt('meta.src')),
                e('button', { className: 'dsh-notes-modeseg-seg' + (editorMode === 'rich' ? ' on' : '') + (!degraded.ok ? ' dis' : '') + ' dsh-nt', 'data-tooltip': !degraded.ok ? tt('editor.richDegradedReasons', { reasons: degraded.reasons.map(r => r.label).join(tt('common.listSep')) }) : tt('meta.richModeTipClient'), onClick: () => switchMode('rich') }, I('eye', 12), tt('meta.rich'))),
              e('span', { className: 'dsh-notes-kbd dsh-notes-modeseg-kbd' }, 'Ctrl+/'),
              // 二期 ✨整理：AI 按当前 kind 模板重写正文（notes-ai-organize；替换后 toast 可撤销一次）
              e('span', { className: 'dsh-notes-meta-act dsh-notes-organize-btn' + (organizing ? ' busy' : '') + ' dsh-nt', onClick: (ev) => { ev.stopPropagation(); if (!organizing) doAiOrganize() }, 'data-tooltip': organizing ? tt('meta.organizingTip') : tt('meta.organizeTip', { kind: kindLabel(edKind) || tt('meta.kindNote') }) }, I('sparkle', 12), organizing ? tt('meta.organizing') : tt('meta.organize')),
              e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: (ev) => { ev.stopPropagation(); openDispatch() }, 'data-tooltip': tt('meta.dispatchTipClient') }, I('play', 12), dispatching ? '…' : tt('meta.dispatch')),
              curNote.sessionId ? e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: () => jumpToSession(curNote.sessionId), 'data-tooltip': tt('meta.sourceJumpTip') }, I('ext', 12), tt('meta.source')) : null,
              // 历史版本面板入口（notes-history-ui）：有版本时才显示（选中笔记后 notes-history 探测计数）
              (histCount || 0) > 0 ? e('span', { className: 'dsh-notes-meta-act dsh-nt', onClick: (ev) => { ev.stopPropagation(); openHistory() }, 'data-tooltip': tt('meta.histTip', { n: histCount }) }, I('clock', 12), tt('meta.history')) : null,
              e('span', { className: 'dsh-notes-meta-act' + (edStatus === 'pinned' ? ' on' : '') + ' dsh-nt', onClick: () => { setEdStatus(edStatus === 'pinned' ? 'active' : 'pinned'); triggerAutoSave() }, 'data-tooltip': edStatus === 'pinned' ? tt('meta.unpin') : tt('meta.pin') }, I('pin', 12)),
              e('span', { className: 'dsh-notes-meta-act danger dsh-nt', onClick: () => doDelete(selected), 'data-tooltip': tt('meta.delTipClient') }, I('trash', 12)),
              // 派发计划块 + 关联调度清单（notes-034-sched-detail）：meta 尾部全宽行；无调度笔记零渲染（null = 零 DOM 痕迹红线）
              (curIsSched || schedPeers.length) ? e('div', { className: 'dsh-notes-sched-plan' },
                curIsSched ? e('div', { className: 'dsh-notes-sched-plan-row' + (curNote.schedule.enabled === false ? ' paused' : '') },
                  e('span', { className: 'dsh-notes-sched-plan-t' }, I('clock', 10), tt('meta.schedPlan')),
                  e('span', { className: 'dsh-notes-sched-freq' }, schedFreqLabel(curNote.schedule)),
                  e('span', { className: 'dsh-notes-sched-target dsh-nt', 'data-tooltip': curNote.schedule.target || '' }, '→ ' + shortSid(curNote.schedule.target)),
                  e('span', { className: 'dsh-notes-sched-nf' }, schedPlanNextLabel(curNote)),
                  schedPlanBadgeEl(curNote),
                  curNote.schedule.enabled === false ? e('span', { className: 'dsh-notes-sched-badge off' }, tt('meta.schedPaused')) : null,
                  // 原地操作行（notes-041-sched-plan-edit）：编辑/暂停恢复/删除复用注入管理 doInjSched* handler（模块级同链路，零复制逻辑）；
                  // 操作后就地刷新——toggle/del：handler 内 loadNotes（curNote 由 notes 缓存派生随刷）；edit：保存后 loadNotes 同口径
                  e('span', { className: 'dsh-notes-sched-acts' },
                    // 执行记录 ↗（notes-041-sched-runlog）：schedule.runLog 软链存在时出跳转链接（selectNote 跳执行记录笔记；缓存未命中 toast 不硬跳）
                    curNote.schedule.runLog ? e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': tt('meta.runLogTip', { id: curNote.schedule.runLog }), onClick: () => { const t = notes.find(x => x.id === curNote.schedule.runLog); if (t) selectNote(t); else showToast(tt('meta.runLogNotFound', { id: curNote.schedule.runLog })) } }, tt('meta.runLog')) : null,
                    e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': tt('meta.schedEditTip'), onClick: () => doInjSchedEdit(curNote) }, tt('meta.edit')),
                    e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': curNote.schedule.enabled === false ? tt('meta.schedResumeTip') : tt('meta.schedPauseTip'), onClick: () => doInjSchedToggle(curNote) }, curNote.schedule.enabled === false ? tt('meta.resume') : tt('meta.pause')),
                    e('button', { className: 'dsh-notes-sched-act dsh-nt', 'data-tooltip': tt('meta.schedDelTip'), onClick: () => doInjSchedDel(curNote) }, tt('common.delete')))) : null,
                schedPeers.map(p => {
                  const ps = p.schedule, pp = ps.enabled === false
                  return e('div', { key: p.id, className: 'dsh-notes-sched-plan-row dsh-notes-sched-peer dsh-nt' + (pp ? ' paused' : ''), 'data-tooltip': tt('meta.schedPeerTip', { name: p.title || tt('tree.untitled') }), onClick: () => { const t = notes.find(x => x.id === p.id); if (t) selectNote(t); else showToast(tt('meta.schedPeerNotFound', { id: p.id })) } },
                    e('span', { className: 'dsh-notes-sched-plan-t' }, I('clock', 10), tt('meta.schedPeer')),
                    e('span', { className: 'dsh-notes-sched-peer-t' }, p.title || tt('tree.untitled')),
                    e('span', { className: 'dsh-notes-sched-freq' }, schedFreqLabel(ps)),
                    e('span', { className: 'dsh-notes-sched-nf' }, schedPlanNextLabel(p)),
                    pp ? e('span', { className: 'dsh-notes-sched-badge off' }, tt('meta.schedPaused')) : null)
                })) : null)),
          curDispatches.length ? e('div', { className: 'dsh-notes-dispatch-history' + (dispatchHistoryOpen ? ' open' : ' collapsed') },
            e('div', { className: 'dsh-notes-dispatch-history-t', onClick: () => setDispatchHistoryOpen(!dispatchHistoryOpen), role: 'button', 'aria-expanded': dispatchHistoryOpen ? 'true' : 'false' },
              I('chev', 9, 'dsh-notes-hist-caret' + (dispatchHistoryOpen ? ' open' : '')), tt('meta.dispHistory', { n: curDispatches.length })),
            dispatchHistoryOpen ? curDispatches.map((d, origIdx) => ({ d: d, origIdx: origIdx })).reverse().map(({ d, origIdx }) => e('div', { key: origIdx, className: 'dsh-notes-dispatch-rec' + (isDispatchDone(d) ? ' done' : '') },
              e('div', { className: 'dsh-notes-dispatch-rec-top' },
                e('span', { className: 'dsh-notes-dispatch-rec-t' }, isDispatchDone(d) ? [I('check', 10, 'dsh-notes-hist-done'), ' ' + (d.sessionName || d.sessionId)] : [e('span', { key: 'dot', className: 'dsh-notes-dispatch-dot' }), ' ' + (d.sessionName || d.sessionId)]),
                e('span', { className: 'dsh-notes-dispatch-rec-m' }, (isDispatchDone(d) ? tt('meta.dispStDone') : tt('meta.dispStPending')) + ' · ' + (d.mode === 'new' ? tt('meta.dispNew') : (d.workspace || tt('meta.dispExisting'))) + (d.at ? ' · ' + fmtDT(d.at).slice(5) : ''))),
              d.instruction ? e('div', { className: 'dsh-notes-dispatch-rec-i' }, tt('meta.dispInstruction', { text: d.instruction })) : null,
              !isDispatchDone(d) ? e('button', { className: 'dsh-notes-dispatch-done-btn', onClick: () => doDispatchDone(origIdx) }, tt('meta.dispMarkDone')) : null)) : null)
          : null,
          // 降级横幅（原型 .deg）：检测到白名单外语法时提示（富文本入口同步置灰），删净后实时恢复
          !degraded.ok ? e('div', { className: 'dsh-notes-deg' },
            I('warn', 13),
            e('div', null,
              e('div', null, tt('editor.degBannerPre'), e('b', null, tt('editor.degBannerB')), tt('editor.degBannerPost')),
              e('div', { className: 'dsh-notes-deg-rs' }, degraded.reasons.map(r => tt('editor.degReasonItem', { label: r.label, line: r.line, sample: r.sample })).join(tt('common.listSep'))))) : null,
          // R-1 安全态横幅（正文加载失败）：锁定编辑 + 暂停自动保存 + 重试入口（复用降级横幅 .dsh-notes-deg 样式）
          edLoadErr ? e('div', { className: 'dsh-notes-deg dsh-notes-load-err' },
            I('warn', 13),
            e('div', null,
              e('div', null, edLoadErr, tt('editor.loadLockNote')),
              e('div', null, e('span', { className: 'dsh-notes-meta-act', style: { cursor: 'pointer' }, onClick: () => { if (selectedRef.current) loadEdBody(selectedRef.current) } }, tt('editor.retry'))))) : null,
          // 正文双模式（原型 .src / .rich-scroll）：源码 textarea ⇄ 富文本 contenteditable（非受控，编辑期间不重渲染）
          editorMode === 'source'
            ? e('textarea', {
                ref: edBodyDomRef, className: 'dsh-notes-ed-body', placeholder: tt('editor.bodyPlaceholder'), value: edBody, readOnly: !!edLoadErr,
                onChange: (ev) => { setEdBody(ev.target.value); triggerAutoSave(); scheduleDegAnalyze() },
                // 图片入口①/②（源码模式）：粘贴/拖拽图片文件 → 同一上传弹窗 → 光标处插 Markdown 文本
                onPaste: (ev) => { const cd = ev.clipboardData; if (cd && cd.files && cd.files.length && cd.files[0].type.indexOf('image/') === 0) { ev.preventDefault(); pickImageFile(cd.files[0]) } },
                onDragOver: (ev) => { ev.preventDefault() },
                onDrop: (ev) => { const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (!f) return; ev.preventDefault(); if (!f.type || f.type.indexOf('image/') !== 0) { showToast(tt('editor.imageOnly')); return } pickImageFile(f) }
              })
            : e('div', { ref: richWrapRef, className: 'dsh-notes-rich-scroll dsh-notes-rich-wrap' },
                e('div', { className: 'dsh-notes-rtb' },
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'bold', 'data-tooltip': tt('editor.tbBold'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('bold') } }, I('bold', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'italic', 'data-tooltip': tt('editor.tbItalic'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('italic') } }, I('italic', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'code', 'data-tooltip': tt('editor.tbCode'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('code') } }, I('codeblock', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'link', 'data-tooltip': tt('editor.tbLink'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('link') } }, I('link', 14)),
                  e('span', { className: 'dsh-notes-rtb-sep' }),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'ul', 'data-tooltip': tt('editor.tbUl'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('ul') } }, I('ul', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'ol', 'data-tooltip': tt('editor.tbOl'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('ol') } }, I('ol', 14)),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'quote', 'data-tooltip': tt('editor.tbQuote'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('quote') } }, I('quote', 14)),
                  e('span', { className: 'dsh-notes-rtb-sep' }),
                  e('button', { className: 'dsh-notes-rtb-btn dsh-nt', 'data-a': 'image', 'data-tooltip': tt('editor.tbImage'), onMouseDown: (ev) => { ev.preventDefault(); toolbarAction('image') } }, I('image', 14)),
                  e('span', { className: 'dsh-notes-rtb-sync' + (richSyncing ? '' : ' ok') }, e('span', { className: 'dsh-notes-rtb-sync-sd' }), richSyncing ? tt('editor.syncing') : tt('editor.synced'))),
                e('div', { ref: richRef, className: 'dsh-notes-rich', contentEditable: edLoadErr ? false : true, spellCheck: false, suppressContentEditableWarning: true })),
          // P2 反向链接面板：全库正文含 [[当前id]]/[[当前标题]] 的其他笔记（点击跳转；索引未热提示「索引中…」）
          e('div', { className: 'dsh-notes-backlinks' },
            e('div', { className: 'dsh-notes-backlinks-t' }, I('link', 11), tt('editor.backlinks') + (wikiWarm ? tt('editor.backlinksCount', { n: backlinks.length }) : tt('editor.backlinksWarming'))),
            backlinks.length
              ? e('div', { className: 'dsh-notes-backlinks-list' }, backlinks.map(n => e('span', { key: n.id, className: 'dsh-notes-backlink dsh-nt', 'data-tooltip': tt('editor.backlinkJumpTip', { name: n.title || tt('tree.untitled') }), onClick: () => jumpToWikiTarget(n.id) },
                  e('span', { className: 'dsh-notes-kind-dot', style: { background: 'var(--nkind-' + (n.kind || 'note') + ')' } }), n.title || tt('tree.untitled'))))
              : (wikiWarm ? e('div', { className: 'dsh-notes-backlinks-empty' }, tt('editor.backlinksEmpty')) : null)),
          e('div', { className: 'dsh-notes-ed-foot' },
            e('span', { className: 'dsh-notes-ed-foot-i' }, editorMode === 'source' ? tt('editor.modeSource') : tt('editor.modeRich')),
            e('span', { className: 'dsh-notes-ed-foot-i' }, tt('meta.createdAt', { time: curNote.createdAt ? fmtDT(curNote.createdAt).slice(0, 10) : '—' })),
            e('span', { className: 'dsh-notes-ed-foot-i' }, tt('meta.updatedAt', { time: curNote.updatedAt ? fmtDT(curNote.updatedAt).slice(0, 10) : '—' })),
            curNote.sessionId ? e('span', { className: 'dsh-notes-ed-foot-i' }, tt('meta.sourceSession', { short: shortSid(curNote.sessionId) })) : null,
            e('span', { className: 'dsh-notes-ed-saved' + (savedAt ? ' show' : '') }, savedAt ? tt('editor.autoSavedFlat', { time: new Date(savedAt).toTimeString().slice(0, 5) }) : ''),
            e('span', { className: 'dsh-notes-ed-foot-i' }, tt('editor.charCount', { n: (edBody || '').length }))))
        : e('section', { className: 'dsh-notes-ed' },
            e('div', { className: 'dsh-notes-ed-empty' },
              e('div', { className: 'dsh-notes-ed-empty-ic' }, I('note', 26)),
              e('div', { className: 'dsh-notes-ed-empty-t' }, tt('editor.emptyTitleShort')),
              e('div', { className: 'dsh-notes-ed-empty-s' }, tt('editor.emptySubShort'))))
          return { editorEl: editorEl, curNote: curNote }
        }
        return {
          edScope: edScope, selectNote: selectNote, doSave: doSave, doDelete: doDelete, applyRestoredBody: applyRestoredBody,
          probeHistCount: probeHistCount, histCountRef: histCountRef, setHistCount: setHistCount, insertImageMd: insertImageMd,
          afterArchiveCleanup: afterArchiveCleanup, toggleScope: toggleScope, keepSel: keepSel, restoreSel: restoreSel,
          scheduleRichSync: scheduleRichSync, setEditorModeState: setEditorModeState, edBodyDomRef: edBodyDomRef,
          richRef: richRef, richDirtyRef: richDirtyRef, setEdBody: setEdBody, renderEditorEl: renderEditorEl
        }
    }
