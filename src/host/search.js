    // ==== search-helpers BEGIN ====（搜索命中字段 + 组合过滤：host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，改动必须双边同步；check.js 提取本标记区间 eval 单测）
    // 命中字段（相关度档位数据源，notes-search 随 slim 结果返回 matches 数组）：标题命中 > 标签命中 > 正文命中；
    // topic 命中不计档（返回空数组——相关度排序时排最末；该笔记仍因 hay 含 topic 而被搜到，向后兼容旧行为）
    function searchMatchFields(n, q) {
      const fields = []
      if (!q) return fields
      if ((n.title || '').toLowerCase().indexOf(q) >= 0) fields.push('title')
      if ((n.tags || []).join(' ').toLowerCase().indexOf(q) >= 0) fields.push('tags')
      if ((n.body || '').toLowerCase().indexOf(q) >= 0) fields.push('body')
      return fields
    }
    // 组合过滤（供筛选面板/工具消费，三态布尔）：true=仅命中 / false=仅排除 / undefined=不过滤；kind 由 _search 既有参数承担
    function searchPassFilters(n, filters) {
      const f = filters || {}
      if (f.sensitive === true && n.sensitive !== true) return false
      if (f.sensitive === false && n.sensitive === true) return false
      if (f.inject === true && n.inject !== true) return false
      if (f.inject === false && n.inject === true) return false
      return true
    }
    // 搜索结果摘要行（0.5.0 交互层首版 notes-050-search-excerpt）：带 query 时 host 侧一次算好摘录 + 命中区间（前端零扫描）。
    //   返回 { text, marks:[{start,len}] }（marks 相对 excerpt.text，含省略号偏移）或 null（无 query / 无正文可摘录）：
    //   ① 正文命中 = 首个命中点 ±SEARCH_EXCERPT_CTX 字窗口（截断端补 …）+ 窗内全部命中区间（越界 len 截到窗沿）；
    //   ② 语义命中（无正文命中时）= 胜出 chunk（per-note max-pooling 冠军块文本由调用方传入）开头 SEARCH_EXCERPT_HEAD 字，marks 空（语义无词位置，诚实呈现）；
    //   ③ 仅标题/标签/topic 命中 = 正文开头 SEARCH_EXCERPT_HEAD 字（上下文补足），marks 空。
    const SEARCH_EXCERPT_CTX = 50
    const SEARCH_EXCERPT_HEAD = 80
    function searchExcerpt(n, q, semChunkText) {
      const body = String((n && n.body) || '')
      if (!q) return null
      const bl = body.toLowerCase()
      const idx = bl.indexOf(q)
      if (idx >= 0) {
        const s = Math.max(0, idx - SEARCH_EXCERPT_CTX)
        const e = Math.min(body.length, idx + q.length + SEARCH_EXCERPT_CTX)
        const pre = s > 0 ? 1 : 0
        let text = body.slice(s, e)
        if (s > 0) text = '…' + text
        if (e < body.length) text = text + '…'
        const marks = []
        let p = idx
        while (p >= 0 && p < e) {
          marks.push({ start: p - s + pre, len: Math.min(q.length, e - p) })
          p = bl.indexOf(q, p + q.length)
        }
        return { text: text, marks: marks }
      }
      if (typeof semChunkText === 'string' && semChunkText) {
        return { text: semChunkText.slice(0, SEARCH_EXCERPT_HEAD) + (semChunkText.length > SEARCH_EXCERPT_HEAD ? '…' : ''), marks: [] }
      }
      if (body) {
        return { text: body.slice(0, SEARCH_EXCERPT_HEAD) + (body.length > SEARCH_EXCERPT_HEAD ? '…' : ''), marks: [] }
      }
      return null
    }
    // ==== search-helpers END ====

    async function _search(query, tag, topic, kind, folder, filters) {
      // 日志同权（0.4.3 验收修复⑦）：默认搜索含 kind=log（可见/可搜）；filters.includeLogs 参数保留向后兼容（已恒为包含）
      // sys 缺省降噪（0.4.3 验收修复⑨）：tag/kind 透传 _list 同一条过滤管线——缺省检索（无 tag/kind、folder 缺省或未分类）排除 kind=sys 机器笔记
      //   （记忆档案/注入索引/runLog/遥测镜像）；显式 kind='sys'/tag/具体文件夹检索 = 显式入口照常命中（降噪谓词仅在平铺口径生效）
      const all = await _list(tag, kind, folder, undefined, true)
      const q = query ? String(query).toLowerCase() : ''
      return all.filter(n => {
        if (tag && (n.tags || []).indexOf(tag) < 0) return false
        if (topic && n.topic !== topic) return false
        if (kind && n.kind !== kind) return false
        if (!searchPassFilters(n, filters)) return false
        if (q) {
          const hay = ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ')).toLowerCase()
          if (hay.indexOf(q) < 0) return false
        }
        return true
        // matches 挂在浅拷贝上（不污染 _list 缓存对象）；无 query 时不带 matches 字段（向后兼容）
      }).map(n => q ? Object.assign({}, n, { matches: searchMatchFields(n, q) }) : n)
    }

    /* ==== rrf-fusion-core BEGIN ====（0.5.0③ notes-050-rrf-fusion：RRF(k=60) 融合纯函数核 + 短关键词噪声压制常量表——search.js 双包单份，check 节 119 提取 eval 行为级测试）
     * 冻结架构 [[n-muz9b97x35et]] + spike [[n-muz91f19rrqj]]：文本通道（现有 _search 排序）+ 语义通道（notes-vectors-search 已过 minScore）→ RRF 合并排序；
     *   语义命中行挂 semantic 标记（评估期「语义」徽标数据源）。降级链（后端未启用/无索引/报错）在 _searchFused 外层静默回落纯文本。
     * 调权常量表（可调，黄金集断言锁值）：
     */
    const RRF_K = 60                            // RRF 常数 k（spike 冻结）
    const RRF_SEMANTIC_LIMIT = 50               // 语义通道召回上限（notes-vectors-search limit）
    const RRF_SHORT_QUERY_MAX = 6               // 短关键词字符数阈值（≤6 视为短查询）
    const RRF_SHORT_MINSCORE_BUMP = 0.05        // 短关键词语义通道 minScore 临时上浮量（spike 遗留「Docker」类擦线噪音压制）
    // 短关键词判定：query ≤RRF_SHORT_QUERY_MAX 字符，或纯英文单词（单 token 无空格/无标点）——「Docker」类擦线噪音压制
    function rrfIsShortQuery(q) {
      const s = String(q == null ? '' : q).trim()
      if (!s) return false
      if (s.length <= RRF_SHORT_QUERY_MAX) return true
      return /^[A-Za-z]+$/.test(s)
    }
    // 短关键词语义通道 minScore 临时上浮：阈值收紧压掉擦线噪音（base 缺省 0；上浮量见常量表）
    function rrfSemanticMinScore(q, base) {
      return (typeof base === 'number' && isFinite(base) ? base : 0) + (rrfIsShortQuery(q) ? RRF_SHORT_MINSCORE_BUMP : 0)
    }
    // RRF 融合纯函数：textIds/semIds = 两通道已排序 id 数组（下标 0 起，rank = 下标 + 1）；
    //   返回 { order:[id...], semantic:{id:true} }——order 按 RRF 降序（平手：文本通道排名优先，再语义排名）；semantic = 语义命中集合。
    function rrfFuse(textIds, semIds) {
      const textRank = {}, semRank = {}
      for (let i = 0; i < textIds.length; i++) { if (textRank[textIds[i]] === undefined) textRank[textIds[i]] = i + 1 }
      for (let i = 0; i < semIds.length; i++) { if (semRank[semIds[i]] === undefined) semRank[semIds[i]] = i + 1 }
      const scores = {}, seen = {}
      for (const id of textIds) { seen[id] = true; scores[id] = (scores[id] || 0) + 1 / (RRF_K + textRank[id]) }
      for (const id of semIds) { seen[id] = true; scores[id] = (scores[id] || 0) + 1 / (RRF_K + semRank[id]) }
      const order = Object.keys(seen)
      order.sort(function (a, b) {
        const d = scores[b] - scores[a]
        if (d !== 0) return d
        const ta = textRank[a] || 1e9, tb = textRank[b] || 1e9
        if (ta !== tb) return ta - tb
        const sa = semRank[a] || 1e9, sb = semRank[b] || 1e9
        return sa - sb
      })
      const semantic = {}
      for (const id of semIds) semantic[id] = true
      return { order: order, semantic: semantic }
    }
    /* ==== rrf-fusion-core END ==== */

    // 语义融合检索（0.5.0③ notes-050-rrf-fusion）：文本通道（现有 _search 排序）+ 语义通道（notes-vectors-search，仅激活后端）→ RRF 合并排序。
    //   红线：总开关关 / 无 query / 后端未启用 / 无索引 / 报错 → 静默纯文本（现有行为逐字节不变）；融合层包在 _search 外，不改 _search 内部。
    //   sensitive 翻转红线：检索只打激活后端命名空间（不传 backend → _vectorsSearch 回落 _activeBackend），旧后端残留集不检索。
    //   0.5.0 交互层（notes-050-search-excerpt）：有 query 时出口统一挂 excerpt 摘要（正文命中=命中点±50 字+区间数组 / 语义命中=胜出 chunk 开头 / 仅标题标签=正文开头补足）——
    //   只在搜索路径计算，正文走 _list 既有缓存零额外读盘；无 query 不带 excerpt 字段（向后兼容）。
    async function _searchFused(query, tag, topic, kind, folder, filters) {
      const textHits = await _search(query, tag, topic, kind, folder, filters)
      if (!query) return textHits
      const qLower = String(query).toLowerCase()
      let out = textHits
      const semChunks = {}   // 语义命中笔记 → 胜出 chunk 序号（per-note max-pooling 冠军块，语义摘要数据源）
      let sem = null
      try {
        sem = await _vectorsSearch({ query: String(query), limit: RRF_SEMANTIC_LIMIT })
      } catch (e) { sem = null }   // 降级链：报错 → 静默纯文本
      if (sem && sem.ok === true && Array.isArray(sem.results) && sem.results.length) {
        const effMin = rrfSemanticMinScore(query, sem.minScore)   // 短关键词噪声压制：语义通道 minScore 临时上浮
        const semScore = {}
        for (const r of sem.results) {
          if (!r || !r.noteId) continue
          if (typeof r.score !== 'number' || r.score < effMin) continue
          if (semScore[r.noteId] === undefined || r.score > semScore[r.noteId]) { semScore[r.noteId] = r.score; semChunks[r.noteId] = r.chunk }
        }
        const semIds = Object.keys(semScore)
        semIds.sort(function (a, b) { return semScore[b] - semScore[a] })
        if (semIds.length) {
          // 候选集 = 过滤后的全量（tag/topic/kind/folder/sensitive/inject 全同口径）：语义召回只在候选集内补缺（已删/sensitive/sys/过滤排除天然不出现）
          const candidate = await _search('', tag, topic, kind, folder, filters)
          const byId = {}
          for (const n of candidate) byId[n.id] = n
          const textIds = textHits.map(function (n) { return n.id })
          const fused = rrfFuse(textIds, semIds)
          const textById = {}
          for (const n of textHits) textById[n.id] = n
          const fusedOut = []
          for (const id of fused.order) {
            let n = textById[id] || byId[id]
            if (!n) continue
            if (!textById[id]) n = Object.assign({}, n, { matches: searchMatchFields(n, qLower) })
            if (fused.semantic[id]) n.semantic = true   // 语义命中徽标（评估期 instrumentation）
            fusedOut.push(n)
          }
          out = fusedOut
        }
      }
      // 摘要行挂载（每条结果均为浅拷贝，挂字段不污染 _list 缓存对象）：优先级 正文命中区间 > 语义胜出块 > 正文开头
      for (const n of out) {
        const ci = semChunks[n.id]
        const chunkText = (typeof ci === 'number' && ci >= 0) ? _vectorChunks(n.body)[ci] : undefined
        const ex = searchExcerpt(n, qLower, typeof chunkText === 'string' ? chunkText : undefined)
        if (ex) n.excerpt = ex
      }
      return out
    }


    // notes-search 扩展（向后兼容）：新增 sensitive/inject 组合过滤参数（true=仅命中 / false=仅排除 / 缺省=不过滤，供筛选面板消费）；
    // 带 query 时每条 slim 结果附 matches 命中字段数组（title/tags/body，供前端高亮与「相关度」排序；旧调用方不读该字段不受影响）
    // 日志同权（0.4.3 验收修复⑦）：搜索默认含日志（args.includeLogs 保留为兼容 no-op）
    disposers.push(handle('notes-search', async (args) => {
      try {
        const a = args || {}
        const found = await _searchFused(a.query, a.tag, a.topic, a.kind, a.folder, { sensitive: a.sensitive, inject: a.inject, includeLogs: !!a.includeLogs })
        // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：search 通道交付事件——实际返回的 id 集日聚合（同日同 id 计数累加不爆行；静默降级）
        _recallHit('search', found.map(function (n) { return n.id }))
        return { notes: found.map(n => { const s = slim(n); if (n.matches) s.matches = n.matches; if (n.semantic) s.semantic = true; if (n.excerpt) s.excerpt = n.excerpt; return s }) }
      } catch (e) { return { error: String(e.message || e) } }
    }))
