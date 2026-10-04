    // ===== modal: inject-preview —— 注入预览对话框（architecture-modular §6 步骤 D2，自 panels/whole.js 拆出）=====
    // provides: store.modal.injectPreview / injectPreviewOpenRef / setInjectPreviewOpen / setInjectPreviewData / setInjectPreviewSid / openInjectPreview / loadInjectPreview / InjectPreviewModal
    // needs: kernel/state.js（store/createStore/panelBridge/setError 别名）、kernel/icons.js（e/I）
    // state 托管：open/data/sid 迁入 store.modal.injectPreview 切片；injectPreviewOpenRef 为 Esc 栈同步镜像（模块级单例）；
    // tab 因 check 锚定其 useState 声明原文滞留 whole.js（同 newNoteKind 先例）——组件经 props 注入，open 复位经 panelBridge.setInjectPreviewTab 中转；
    // 视角下拉数据源（sessList/sessPending）属面板域，经 props 注入（禁横向引用）；与设置卡片互斥经 panelBridge.setSettingsOpen 中转
    store.modal.injectPreview = createStore({ open: false, data: null, sid: '' })
    const injectPreviewOpenRef = { current: false }   // 注入预览对话框镜像（Esc 优先关）
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：open 态同步写 ref 镜像 + store，字段态直写 store
    function setInjectPreviewOpen(v) { const nv = typeof v === 'function' ? v(injectPreviewOpenRef.current) : v; injectPreviewOpenRef.current = nv; store.modal.injectPreview.set({ open: nv }) }
    function setInjectPreviewData(v) { store.modal.injectPreview.set({ data: typeof v === 'function' ? v(store.modal.injectPreview.get().data) : v }) }
    function setInjectPreviewSid(v) { store.modal.injectPreview.set({ sid: typeof v === 'function' ? v(store.modal.injectPreview.get().sid) : v }) }
    // ===== 注入预览（设置卡片「注入预览」入口）：notes-inject-preview 纯复用 host 注入渲染（约定桶 + 目录桶），
    // 双 tab 只读等宽展示 + 三档视角下拉（全局 / 工作区并集 / 单会话；sessList 数据源）+ 底部统计条（总字符/打码/时效标注/预算截断）=====
    function openInjectPreview() {
      setInjectPreviewData(null); panelBridge.setInjectPreviewTab('conv'); setInjectPreviewSid(''); setError('')
      panelBridge.setSettingsOpen(false); setInjectPreviewOpen(true)   // 与设置卡片互斥：modal 不叠 modal（导出/导入同款）
      loadInjectPreview('')
    }
    // 视角值编码：'' = 全局；'ws:<工作区标题>' = 工作区并集视角（host workspace 参数）；其余 = 会话短 id（sessionId 参数）
    function loadInjectPreview(sid) {
      const pvArgs = sid ? (sid.indexOf('ws:') === 0 ? { workspace: sid.slice(3) } : { sessionId: sid }) : {}
      host.call('notes-inject-preview', pvArgs).then(res => {
        if (res && res.error) { setError(res.error); setInjectPreviewData({ conventions: '', catalog: '', stats: null }); return }
        setInjectPreviewData(res || { conventions: '', catalog: '', stats: null })
      }).catch(err => { setError(String(err.message || err)); setInjectPreviewData({ conventions: '', catalog: '', stats: null }) })
    }
    // 注入预览对话框宿主（设置卡片「注入预览」入口；mask/modal 复用设置卡片风格）：
    // 双 tab（约定/目录）+ 三档视角下拉（全局 / 工作区并集 / 单会话；sessList 数据源）+ 只读等宽文本区 + 底部统计条（总字符/打码/时效标注/预算截断）
    function InjectPreviewModal(props) {
      const injectPreviewOpen = store.modal.injectPreview.useSel(s => s.open)
      const injectPreviewData = store.modal.injectPreview.useSel(s => s.data)
      const injectPreviewSid = store.modal.injectPreview.useSel(s => s.sid)
      const error = props.error
      const sessList = props.sessList || []
      const sessPending = props.sessPending || []
      const injectPreviewTab = props.injectPreviewTab
      const setInjectPreviewTab = props.setInjectPreviewTab
      return injectPreviewOpen ? (() => {
        const d = injectPreviewData
        const stats = d && d.stats ? d.stats : null
        const text = !d ? '' : (injectPreviewTab === 'cat' ? (d.catalog || '') : (d.conventions || ''))
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
              e('div', { className: 'dsh-notes-injprev-tabs' },
                e('button', { className: 'dsh-notes-injprev-tab' + (injectPreviewTab === 'conv' ? ' on' : ''), onClick: () => setInjectPreviewTab('conv') }, '约定'),
                e('button', { className: 'dsh-notes-injprev-tab' + (injectPreviewTab === 'cat' ? ' on' : ''), onClick: () => setInjectPreviewTab('cat') }, '目录')),
              e('select', { className: 'dsh-notes-settings-select dsh-notes-injprev-sess', value: injectPreviewSid, 'data-tooltip': '预览视角三档：全局 = 所有会话共享（injectTo=[]）；工作区 = 该工作区全部会话的注入并集；会话 = 单会话 injectTo 命中口径', onChange: (ev) => { const v = ev.target.value; setInjectPreviewSid(v); loadInjectPreview(v) } },
                e('option', { value: '' }, '全局'),
                wsOpts.length ? e('optgroup', { label: '工作区' }, wsOpts.map(w => e('option', { key: 'ws:' + w, value: 'ws:' + w }, w))) : null,
                e('optgroup', { label: '会话' }, sidOpts.map(s => e('option', { key: s.short, value: s.short }, s.short + (s.name ? ' · ' + s.name : '')))))),
            d === null
              ? e('div', { className: 'dsh-notes-data-hint' }, '加载中…')
              : e('pre', { className: 'dsh-notes-injprev-text' }, text || (injectPreviewTab === 'cat' ? '（无目录内容）' : '（无约定内容）')),
            stats ? e('div', { className: 'dsh-notes-injprev-stats' },
              '总字符 ' + stats.totalChars + '（约定 ' + stats.conventionsChars + ' / 目录 ' + stats.catalogChars + '）· 打码 ' + stats.maskedNotes + ' 条 · 时效标注 ' + stats.staleMarked + ' 条 · 预算截断 ' + (stats.budgetTruncated ? '是' : '否')) : null,
            error ? e('div', { className: 'dsh-notes-dispatch-err' }, error) : null,
            e('div', { className: 'dsh-notes-dispatch-actions' },
              e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setInjectPreviewOpen(false) }, '关闭'))))
      })()
      : null
    }
