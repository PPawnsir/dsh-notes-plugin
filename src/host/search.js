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


    // notes-search 扩展（向后兼容）：新增 sensitive/inject 组合过滤参数（true=仅命中 / false=仅排除 / 缺省=不过滤，供筛选面板消费）；
    // 带 query 时每条 slim 结果附 matches 命中字段数组（title/tags/body，供前端高亮与「相关度」排序；旧调用方不读该字段不受影响）
    // 日志同权（0.4.3 验收修复⑦）：搜索默认含日志（args.includeLogs 保留为兼容 no-op）
    disposers.push(handle('notes-search', async (args) => {
      try {
        const a = args || {}
        const found = await _search(a.query, a.tag, a.topic, a.kind, a.folder, { sensitive: a.sensitive, inject: a.inject, includeLogs: !!a.includeLogs })
        // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：search 通道交付事件——实际返回的 id 集日聚合（同日同 id 计数累加不爆行；静默降级）
        _recallHit('search', found.map(function (n) { return n.id }))
        return { notes: found.map(n => { const s = slim(n); if (n.matches) s.matches = n.matches; return s }) }
      } catch (e) { return { error: String(e.message || e) } }
    }))
