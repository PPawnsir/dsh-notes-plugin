    // ===== modal: inject-preview —— 注入预览对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.injectPreview / injectPreviewOpenRef / setInjectPreviewOpen / setInjectPreviewData / setInjectPreviewSid / openInjectPreview / loadInjectPreview / InjectPreviewModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）、kernel/bus.js（showToast）
    // state 托管：open/data/sid 迁入 store.modal.injectPreview 切片；injectPreviewOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // 视角下拉数据源（sessList/sessPending）属面板域，经 props 注入（禁横向引用）；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.injectPreview = createStore({ open: false, data: null, sid: '' })
    const injectPreviewOpenRef = { current: false }   // 注入预览对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setInjectPreviewOpen(v) { const nv = typeof v === 'function' ? v(injectPreviewOpenRef.current) : v; injectPreviewOpenRef.current = nv; store.modal.injectPreview.set({ open: nv }) }
    function setInjectPreviewData(v) { store.modal.injectPreview.set({ data: typeof v === 'function' ? v(store.modal.injectPreview.get().data) : v }) }
    function setInjectPreviewSid(v) { store.modal.injectPreview.set({ sid: typeof v === 'function' ? v(store.modal.injectPreview.get().sid) : v }) }
    // ===== 注入预览（设置卡片「注入预览」入口）：notes-inject-preview 纯复用 host 注入渲染（约定段 + 合并目录段），
    // 单段只读展示（约定文本 pre + 目录段可点行）+ 三档视角下拉（全局 / 工作区并集 / 单会话；sessList 数据源）+ 底部统计条（总字符/打码/时效标注/预算截断）=====
    // 0.4.3 验收修复③（notes-043-dir-merge）：目录与资料桶合并为单一目录段——挂载行（- [[id]]，增强态）与普通行（- [id]）同段渲染、
    // 点击均可开挂载弹层（panelBridge.openMountModal 中转，modals 禁横向引用；modal 不叠 modal——先关预览再开）：
    // 已挂载 = 编辑模式（notes-mount-list 预填现有文案）；未挂载 = LLM 草稿模式（notes-when-suggest 预填，失败回退标题）
    function openMountFromPreview(id) {
      if (!id) return
      setInjectPreviewOpen(false)
      Promise.all([host.call('notes-get', { id: id }), host.call('notes-mount-list', {})]).then(rs => {
        const g = rs[0], ml = rs[1]
        if (!g || g.error || !g.note) { showToast(t('inj.mountFailed', { msg: (g && g.error) || 'not found' })); return }
        const line = ((ml && ml.lines) || []).filter(l => l.id === id)[0]
        if (panelBridge.openMountModal) panelBridge.openMountModal({ id: id, title: g.note.title || id, existing: line ? line.when : undefined })
      }).catch(err => showToast(t('inj.mountFailed', { msg: String(err.message || err) })))
    }
    // 目录段文本 → 行节点数组：挂载行 `- [[n-xxx]]` 与普通行 `- [n-xxx]` 均可点（🔒 行 id 在方括号内不受打码影响），
    // 其余行（标题/轻推/计数提示/挂载引导）纯文本
    function injPrevDirectoryRows(text, tt) {
      if (!String(text || '').trim()) return [e('div', { key: 'empty', className: 'dsh-notes-injprev-ln' }, '（无目录内容）')]
      return String(text).split('\n').map((ln, i) => {
        const m = ln.match(/^- \[\[?(n-[A-Za-z0-9]+)\]\]?/)
        if (!m) return e('div', { key: i, className: 'dsh-notes-injprev-ln' }, ln || ' ')
        return e('div', { key: i, className: 'dsh-notes-injprev-ln dsh-notes-injprev-hit dsh-nt', 'data-tooltip': tt('inj.mountAdd'), onClick: () => openMountFromPreview(m[1]) }, ln)
      })
    }
    function openInjectPreview() {
      setInjectPreviewData(null); setInjectPreviewSid(''); setError('')
      panelBridge.setSettingsOpen(false); setInjectPreviewOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
      loadInjectPreview('')
    }
    // 视角值编码：'' = 全局；'ws:<工作区标题>' = 工作区并集视角（host workspace 参数）；其余 = 会话短 id（sessionId 参数）
    function loadInjectPreview(sid) {
      const pvArgs = sid ? (sid.indexOf('ws:') === 0 ? { workspace: sid.slice(3) } : { sessionId: sid }) : {}
      host.call('notes-inject-preview', pvArgs).then(res => {
        if (res && res.error) { setError(res.error); setInjectPreviewData({ conventions: '', directory: '', stats: null }); return }
        setInjectPreviewData(res || { conventions: '', directory: '', stats: null })
      }).catch(err => { setError(String(err.message || err)); setInjectPreviewData({ conventions: '', directory: '', stats: null }) })
    }
    // 注入预览对话框宿主（设置卡片「注入预览」入口；mask/modal 复用设置卡片风格）：
    // 单段视图（约定段 pre + 目录段可点行）+ 三档视角下拉（全局 / 工作区并集 / 单会话；sessList 数据源）+ 底部统计条（总字符/打码/时效标注/预算截断）
    function InjectPreviewModal(props) {
      const injectPreviewOpen = store.modal.injectPreview.useSel(s => s.open)
      const injectPreviewData = store.modal.injectPreview.useSel(s => s.data)
      const injectPreviewSid = store.modal.injectPreview.useSel(s => s.sid)
      const tt = useT()   // 目录可点行 tooltip（inj.mountAdd）：组件级订阅语言态
      const error = props.error
      const sessList = props.sessList || []
      const sessPending = props.sessPending || []
      return injectPreviewOpen ? (() => {
        const d = injectPreviewData
        const stats = d && d.stats ? d.stats : null
        // 会话选项 = sessList（注入范围浮层同数据源）；工作区选项 = 会话 workspace 字段去重（含 pending 占位）；已选值不在列表时追加一项保证回显
        const sidOpts = sessList.slice()
        if (injectPreviewSid && injectPreviewSid.indexOf('ws:') !== 0 && !sidOpts.find(s => s.short === injectPreviewSid)) sidOpts.push({ short: injectPreviewSid, name: '' })
        const wsOpts = []
        for (const s of sessList.concat(sessPending)) { if (s && s.workspace && wsOpts.indexOf(s.workspace) < 0) wsOpts.push(s.workspace) }
        if (injectPreviewSid.indexOf('ws:') === 0 && wsOpts.indexOf(injectPreviewSid.slice(3)) < 0) wsOpts.push(injectPreviewSid.slice(3))
        return e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) setInjectPreviewOpen(false) } },
          e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal dsh-notes-injprev-modal' },
            e('div', { className: 'dsh-notes-settings-modal-t' }, I('eye', 14), ' 注入预览', e('span', { className: 'dsh-notes-imgup-sub' }, 'Agent 实际收到的注入文本 · 只读')),
            e('div', { className: 'dsh-notes-injprev-bar' },
              e('select', { className: 'dsh-notes-settings-select dsh-notes-injprev-sess', value: injectPreviewSid, 'data-tooltip': '预览视角三档：全局 = 所有会话共享（injectTo=[]）；工作区 = 该工作区全部会话的注入并集；会话 = 单会话 injectTo 命中口径', onChange: (ev) => { const v = ev.target.value; setInjectPreviewSid(v); loadInjectPreview(v) } },
                e('option', { value: '' }, '全局'),
                wsOpts.length ? e('optgroup', { label: '工作区' }, wsOpts.map(w => e('option', { key: 'ws:' + w, value: 'ws:' + w }, w))) : null,
                e('optgroup', { label: '会话' }, sidOpts.map(s => e('option', { key: s.short, value: s.short }, s.short + (s.name ? ' · ' + s.name : '')))))),
            d === null
              ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
              : e('div', { className: 'dsh-notes-injprev-text' },
                  (d.conventions || '') ? e('pre', { className: 'dsh-notes-injprev-conv' }, d.conventions) : null,
                  injPrevDirectoryRows(d.directory || '', tt)),   // 目录段：挂载行与普通行同段可点（补充/编辑 whenToUse）
            stats ? e('div', { className: 'dsh-notes-injprev-stats' },
              '总字符 ' + stats.totalChars + '（约定 ' + stats.conventionsChars + ' / 目录 ' + stats.directoryChars + '）· 打码 ' + stats.maskedNotes + ' 条 · 时效标注 ' + stats.staleMarked + ' 条 · 预算截断 ' + (stats.budgetTruncated ? '是' : '否')) : null,
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setInjectPreviewOpen(false) }, '关闭'))))
      })()
      : null
    }
