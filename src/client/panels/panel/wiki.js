    // ===== panel/wiki —— 笔记双链：索引/解析/跳转（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelWiki（wikiVer 态 + resolveWikiTarget/wikiResolve/ensureWikiIndex/bumpWikiBody/hasWikiLinks/jumpToWikiTarget）/ wikiBodiesRef/wikiIdxGenRef/jumpWikiRef
    // needs: kernel/state.js（notesRef 跨域镜像 + setView/setFilters/selectNote 转发别名）、kernel/bus.js（showToast）、kernel/constants.js（FILTERS0/matchFilters）、
    //        editor-kernel.js（extractWikiTargets/wikiLinksTo）；view/filters 经 hook 入参注入（装配层回填，渲染期新鲜值）
    // state 托管：wikiVer 留 hook 内 useState（索引推进触发主面板重渲染，与昔日同边界；§6 E 裁决记录见 panel/index.js 头注）；
    // wikiBodiesRef/wikiIdxGenRef/jumpWikiRef 为模块级单例（与昔日 FloatingPanel 内 useRef 等价——面板是 shell.overlay 单例）
    const wikiBodiesRef = { current: {} }               // noteId → { body, updatedAt }
    const wikiIdxGenRef = { current: 0 }                // 索引构建代际：列表刷新作废旧任务
    const jumpWikiRef = { current: null }               // 富文本 click 委托调最新 jumpToWikiTarget（监听器挂一次，读 ref 防闭包过期）
    function usePanelWiki(args) {
        const view = args.view
        const filters = args.filters
        // ===== P2 笔记双链：全库正文惰性索引（列表瘦身不含 body；后台 notes-get-batch 一次批量补齐，驱动行尾双链标记与反向链接面板）=====
        const [wikiVer, setWikiVer] = React.useState(0)      // 索引版本号：索引推进触发重渲染（行尾标记/反向链接随缓存刷新）
        // ===== P2 笔记双链：解析 / 索引 / 跳转（内核 extractWikiTargets/wikiLinksTo 同一口径；库已在内存，host 不改）=====
        // 渲染时解析：[[n-xxx]] 精确 id 优先，其次 [[标题]] 全库标题精确匹配；均不中 → null（渲染为纯文本）
        function resolveWikiTarget(target) {
          const t = String(target || '')
          if (!t) return null
          const list = notesRef.current || []
          return list.find(n => n.id === t) || list.find(n => (n.title || '') === t) || null
        }
        // 渲染器行内扩展入参（renderMarkdown 第二参）：命中 → {id,title}（锚显示标题）；不中 → null（纯文本）
        function wikiResolve(w) { const n = resolveWikiTarget(w); return n ? { id: n.id, title: n.title || '' } : null }
        // 全库正文索引：补缺/过期（updatedAt 漂移）条目一次 notes-get-batch 批量拉全（N+1 整治 notes-034-batch3：昔日 4 路并发逐条 notes-get，
        // 首屏请求数 O(n)→O(1)）；整批完成一次性推进版本号（防逐条重渲染闪烁/滚动跳动）；
        // 失败口径：整批一次性提示（不逐条刷屏），缺口条目（host missing：已删/墓碑/不存在）留在缓存外、下次刷新自动重试
        function ensureWikiIndex(list) {
          const gen = ++wikiIdxGenRef.current
          const cache = wikiBodiesRef.current
          const stale = (list || []).filter(n => { const c = cache[n.id]; return !c || c.updatedAt !== (n.updatedAt || '') })
          if (!stale.length) return
          host.call('notes-get-batch', { ids: stale.map(n => n.id) }).then(res => {
            if (gen !== wikiIdxGenRef.current) return
            let got = 0
            if (res && !res.error && res.notes) res.notes.forEach(r => { cache[r.id] = { body: r.body || '', updatedAt: r.updatedAt || '' }; got++ })
            setWikiVer(v => v + 1)
            const failed = stale.length - got
            if (failed) showToast('双链索引失败 ' + failed + ' 条：反向链接/行尾标记不完整（下次刷新自动重试）')
          }).catch(() => { if (gen === wikiIdxGenRef.current) showToast('双链索引失败 ' + stale.length + ' 条（下次刷新自动重试）') })
        }
        // 单条正文写缓存（选中加载/保存后即时新鲜；updatedAt 缺省 '' → 下轮索引复核 reconcile）
        function bumpWikiBody(id, body, updatedAt) { if (!id) return; wikiBodiesRef.current[id] = { body: body || '', updatedAt: updatedAt || '' }; setWikiVer(v => v + 1) }
        // 行尾双链标记：缓存正文优先，索引未到时 preview（host slim 前 200 字符）兜底
        function hasWikiLinks(n) { const c = wikiBodiesRef.current[n.id]; return extractWikiTargets(c ? c.body : (n.preview || '')).length > 0 }
        // 双链跳转：解析 → 选中；目标被当前视图/筛选中心条件藏掉时退回「全部」（搜索词不动，保留用户上下文）
        function jumpToWikiTarget(target) {
          const n = resolveWikiTarget(target)
          if (!n) { showToast('未找到链接目标：' + target); return }
          const vis = (view.type === 'all' || (view.type === 'folder' && (n.folder || '') === view.id) || (view.type === 'topic' && (n.topic || '') === view.id))
            && matchFilters(n, filters)
          if (!vis) { setView({ type: 'all', id: '' }); setFilters(FILTERS0()) }
          selectNote(n)
        }
        return { wikiVer: wikiVer, ensureWikiIndex: ensureWikiIndex, bumpWikiBody: bumpWikiBody, hasWikiLinks: hasWikiLinks, wikiResolve: wikiResolve, jumpToWikiTarget: jumpToWikiTarget }
    }
