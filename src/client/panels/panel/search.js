    // ===== panel/search —— 两段式搜索（architecture-modular §6 步骤 E，自 panels/whole.js 拆出）=====
    // provides: usePanelSearch（searchText/searchIds/searchMatches 态 + 250ms 防抖 host 全文检索）/ highlight（行内高亮，纯函数模块级共享）
    // needs: kernel/state.js（searchRef/searchDebRef 跨域镜像 + filtersRef 同步）、kernel/constants.js（FILTER_STATUS）、kernel/icons.js（e）；
    //        filters 经 hook 入参注入（装配层回填，渲染期新鲜值）
    // state 托管：三态留 hook 内 useState（与主面板同一渲染边界；§6 E 裁决记录见 panel/index.js 头注）；
    // searchRef/searchDebRef 在 kernel/state.js 跨域镜像群（Esc 清搜索/侧栏输入框/筛选变更跨域直读）
    // 搜索防抖闭包只注册一次，过滤条件经 ref 镜像供其读取（避免闭包过期）
    const filtersRef = { current: null }   // 筛选条件镜像（debounce 闭包读最新值；hook 内 effect 同步）
    function highlight(text, q) { if (!q || !text) return text; const s = String(text); const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const parts = s.split(new RegExp('(' + esc + ')', 'gi')); if (parts.length === 1) return s; return parts.map((p, i) => i % 2 === 1 ? e('mark', { key: i, className: 'dsh-notes-mark' }, p) : p) }
    // 摘要行区间高亮（0.5.0 交互层 notes-050-search-excerpt）：excerpt {text, marks:[{start,len}]} → React 子节点数组
    // （文本节点 React 自动转义 + mark 元素，零 innerHTML——与 app hlMarks「先 esc 后 mark」同语义；区间越界/重叠防御截断；无 marks 纯文本）
    function excerptKids(ex) {
        if (!ex || !ex.text) return null
        const s = String(ex.text)
        const marks = Array.isArray(ex.marks) ? ex.marks : []
        if (!marks.length) return [s]
        const out = []
        let pos = 0
        marks.forEach((m, i) => {
            const st = Math.max(0, Math.min(s.length, (m && m.start) || 0))
            const en = Math.max(st, Math.min(s.length, st + ((m && m.len) || 0)))
            if (st < pos) return   // 重叠区间跳过（防御）
            if (st > pos) out.push(s.slice(pos, st))
            out.push(e('mark', { key: 'm' + i, className: 'dsh-notes-mark' }, s.slice(st, en)))
            pos = en
        })
        if (pos < s.length) out.push(s.slice(pos))
        return out
    }
    function usePanelSearch(args) {
        const filters = args.filters
        const [searchText, setSearchText] = React.useState('')
        const [searchIds, setSearchIds] = React.useState(null)
        // host notes-search 返回的命中字段（noteId → ['title'|'tags'|'body']）：「相关度」排序数据源；本地即时命中/旧 host 无该字段时按本地字段估算
        const [searchMatches, setSearchMatches] = React.useState({})
        // 0.5.0③（notes-050-rrf-fusion）：语义命中集合（noteId → true），「语义」徽标数据源
        const [searchSemantic, setSearchSemantic] = React.useState({})
        // 0.5.0 交互层（notes-050-search-excerpt）：搜索摘要行数据源（{ q, map: noteId → {text, marks} }，host 侧算好随 notes-search 下发；
        // 查询词 keyed——摘录只在「map 所属词 === 当前词」时渲染，防抖窗口/竞态下旧摘录结构性不残留（错词高亮防线，免清零时序依赖）
        const [searchExcerpts, setSearchExcerpts] = React.useState({ q: '', map: {} })
        React.useEffect(() => { filtersRef.current = filters }, [filters])
        // 搜索两段式：输入即本地过滤（标题/主题/标签/预览），250ms 防抖后 host 全文检索（含正文）补充
        // 用一次性注册的 timer.debounce：每击键调 timer.timeout 等于每击键在 fiber 上注册一次 ctx.effect，是持续簿记开销
        React.useEffect(() => {
          const d = timer.debounce(() => {
            const qq = searchRef.current.trim()
            if (!qq) { setSearchIds(null); setSearchMatches({}); setSearchSemantic({}); setSearchExcerpts({ q: '', map: {} }); return }
            // 筛选中心组合过滤同步 host：类型组恰选 1 个时可传 kind；状态组仅单条件独活时可传 sensitive/inject
            // （多选 OR / 曾注入 语义 host 无法表达，由本地 matchFilters 兜底全量语义）；matches 命中字段供「相关度」排序
            const sArgs = { query: qq }
            const F = filtersRef.current
            if (F.kinds.length === 1) sArgs.kind = F.kinds[0]
            const stOn = FILTER_STATUS.filter(s => F[s.id]).map(s => s.id)
            if (stOn.length === 1 && stOn[0] === 'sensitive') sArgs.sensitive = true
            if (stOn.length === 1 && stOn[0] === 'injected') sArgs.inject = true
            host.call('notes-search', sArgs).then(res => {
              const ns = (res && res.notes) || []
              setSearchIds(ns.map(n => n.id))
              const mm = {}, ss = {}, ee = {}
              ns.forEach(n => { if (Array.isArray(n.matches)) mm[n.id] = n.matches; if (n.semantic) ss[n.id] = true; if (n.excerpt) ee[n.id] = n.excerpt })
              setSearchMatches(mm)
              setSearchSemantic(ss)
              setSearchExcerpts({ q: qq.toLowerCase(), map: ee })   /* 摘录绑定产出它的查询词（渲染侧词不匹配不显示） */
            }).catch(() => {})
          }, 250)
          searchDebRef.current = d
          return () => { if (d && d.dispose) d.dispose() }
        }, [])
        return { searchText: searchText, searchIds: searchIds, searchMatches: searchMatches, searchSemantic: searchSemantic, searchExcerpts: searchExcerpts, setSearchText: setSearchText, setSearchIds: setSearchIds, setSearchMatches: setSearchMatches }
    }
