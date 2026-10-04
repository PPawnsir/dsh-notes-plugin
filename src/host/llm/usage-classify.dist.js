    // ==== llm-usage BEGIN ====（本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 比对；改动必须双边同步）
    // LLM token 消耗统计（notes-token-stats）：分功能（classify 分类 / organize 整理 / summarize 总结）× 日 × 累计计量。
    // 计量口径（零侵入 llm 通道本身，只在调用点包装，见 streamMetered）：
    //   1. 真实值优先——dsh-llm 契约：adapter 在 terminal finish 前 emit { type:'usage', usage:TokenUsage }；
    //      取 usage.totalTokens，缺省退 inputTokens+cacheReadTokens+cacheWriteTokens+outputTokens（TokenUsage 三不相交，计费输入=三者之和）。
    //   2. 估算兜底——adapter 未 emit usage 时按字符数估算：tokens ≈ (输入字符+输出字符) / 1.6（中文≈1.6 字符/token 系数，UI 文案注明「约」）；
    //      估算部分累计进 estimatedTokens（exactTokens 记录真实值部分），RPC 透传供 UI 标注。
    // 存储：USAGE_PATH（notes/usage.json，独立于 settings.json）——
    //   { daily: { 'YYYY-MM-DD': { classify, organize, summarize, total } }, allTime: { 同结构 }, estimatedTokens, exactTokens, calls }
    // 落盘节奏：内存累积 + 5s 防抖写盘（搭调用路径，无独立定时器）；插件卸载 flush（ctx.effect dispose，fire-and-forget 不阻塞卸载）。
    // 进程退出丢失防抖窗口内未落盘计数（可接受，同 use-telemetry 口径；timer unref 不阻塞宿主退出）。
    const USAGE_FEATURES = ['classify', 'organize', 'summarize']
    const USAGE_FLUSH_MS = 5000
    const USAGE_EST_CHARS_PER_TOKEN = 1.6   // 中文≈1.6 字符/token 估算系数（仅 adapter 未回 usage 时兜底）
    let usageCache = null
    let usageLoadPromise = null
    let usageTimer = null
    let usageDirty = false
    function usageZeroBucket() { return { classify: 0, organize: 0, summarize: 0, total: 0 } }
    function loadUsage() {
      if (!usageLoadPromise) {
        usageLoadPromise = (async () => {
          const base = { daily: {}, allTime: usageZeroBucket(), estimatedTokens: 0, exactTokens: 0, calls: 0 }
          try {
            const p = await fs.resolve(USAGE_PATH)
            const c = await fs.readText(p)
            const obj = JSON.parse(c)
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
              if (obj.daily && typeof obj.daily === 'object' && !Array.isArray(obj.daily)) base.daily = obj.daily
              if (obj.allTime && typeof obj.allTime === 'object' && !Array.isArray(obj.allTime)) base.allTime = Object.assign(usageZeroBucket(), obj.allTime)
              if (typeof obj.estimatedTokens === 'number' && isFinite(obj.estimatedTokens)) base.estimatedTokens = Math.max(0, Math.round(obj.estimatedTokens))
              if (typeof obj.exactTokens === 'number' && isFinite(obj.exactTokens)) base.exactTokens = Math.max(0, Math.round(obj.exactTokens))
              if (typeof obj.calls === 'number' && isFinite(obj.calls)) base.calls = Math.max(0, Math.round(obj.calls))
            }
          } catch (e) { /* 文件不存在/损坏 → 从零起步（容错，同 settings 口径） */ }
          usageCache = base
          return usageCache
        })()
      }
      return usageLoadPromise
    }
    // 本地日期键（用户观感的「日」按本地时区）：YYYY-MM-DD
    function usageDayKey(d) {
      const m = String(d.getMonth() + 1), dd = String(d.getDate())
      return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (dd.length < 2 ? '0' + dd : dd)
    }
    // 记账：feature ∈ USAGE_FEATURES；usage 为 StreamChunk 的 usage（可空）；inChars/outChars 为估算兜底的输入/输出字符数
    async function recordUsage(feature, usage, inChars, outChars) {
      if (USAGE_FEATURES.indexOf(feature) < 0) return
      let tokens = 0, exact = false
      if (usage && typeof usage === 'object') {
        const t = usage.totalTokens
        if (typeof t === 'number' && isFinite(t) && t > 0) { tokens = Math.round(t); exact = true }
        else {
          const io = (usage.inputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0) + (usage.outputTokens || 0)
          if (io > 0) { tokens = Math.round(io); exact = true }
        }
      }
      if (!exact) tokens = Math.max(1, Math.round(((inChars || 0) + (outChars || 0)) / USAGE_EST_CHARS_PER_TOKEN))   // 估算兜底（UI「约」）
      if (!(tokens > 0)) return
      try { await loadUsage() } catch (e) { return }
      const key = usageDayKey(new Date())
      const day = usageCache.daily[key] || (usageCache.daily[key] = usageZeroBucket())
      day[feature] += tokens; day.total += tokens
      usageCache.allTime[feature] += tokens; usageCache.allTime.total += tokens
      if (exact) usageCache.exactTokens += tokens; else usageCache.estimatedTokens += tokens
      usageCache.calls++
      usageDirty = true
      if (!usageTimer) {
        usageTimer = setTimeout(() => { usageTimer = null; flushUsage() }, USAGE_FLUSH_MS)
        if (usageTimer && typeof usageTimer.unref === 'function') usageTimer.unref()
      }
    }
    // 防抖落盘（独立于 settings.json；写坏不影响设置）
    async function flushUsage() {
      if (usageTimer) { clearTimeout(usageTimer); usageTimer = null }
      if (!usageDirty || !usageCache) return
      usageDirty = false
      try {
        const p = await fs.resolve(USAGE_PATH)
        await fs.writeText(p, JSON.stringify(usageCache, null, 2), undefined, undefined, getPolicy())
      } catch (e) { usageDirty = true; console.error('notes: usage flush failed', e) }
    }
    // 计量包装（挂在现有 llm 调用点，不改 llm 通道）：统一迭代 llm.stream，收集 text-delta 正文 + 捕获 usage chunk，按 feature 记账。
    // 返回 { text, usage }——与原 for-await 循环等价语义（text-delta 拼接、finish 终止），调用点只换迭代壳。
    async function streamMetered(feature, options) {
      let text = ''
      let usage = null
      for await (const chunk of llm.stream(options)) {
        if (chunk && chunk.type === 'text-delta') text += chunk.text
        else if (chunk && chunk.type === 'usage') usage = chunk.usage || null
        if (chunk && chunk.type === 'finish') break
      }
      let inChars = 0
      try {
        if (typeof options.system === 'string') inChars += options.system.length
        for (const m of (options.messages || [])) {
          for (const c of ((m && m.content) || [])) if (c && typeof c.text === 'string') inChars += c.text.length
        }
      } catch (e) {}
      await recordUsage(feature, usage, inChars, text.length)
      return { text: text, usage: usage }
    }
    // 报表（notes-usage-get 数据源）：today（今日）/ week（近 7 天含今日）/ month（当月，月度预算提醒口径）/ allTime + byFeature 分列 + 估算/真实拆分
    function usageReport() {
      const zero = usageZeroBucket
      const d = (usageCache && usageCache.daily) || {}
      const today = Object.assign(zero(), d[usageDayKey(new Date())] || {})
      const week = zero()
      for (let i = 0; i < 7; i++) {
        const v = d[usageDayKey(new Date(Date.now() - i * 86400000))]
        if (v) for (const f of ['classify', 'organize', 'summarize', 'total']) week[f] += v[f] || 0
      }
      const month = zero()
      const prefix = usageDayKey(new Date()).slice(0, 7)   // 'YYYY-MM'
      for (const k of Object.keys(d)) {
        if (k.indexOf(prefix) !== 0) continue
        const v = d[k]
        for (const f of ['classify', 'organize', 'summarize', 'total']) month[f] += (v && v[f]) || 0
      }
      const allTime = Object.assign(zero(), (usageCache && usageCache.allTime) || {})
      const byFeature = {}
      for (const f of USAGE_FEATURES) byFeature[f] = { today: today[f], week: week[f], month: month[f], allTime: allTime[f] }
      return {
        today: today, week: week, month: month, allTime: allTime, byFeature: byFeature,
        estimatedTokens: (usageCache && usageCache.estimatedTokens) || 0,
        exactTokens: (usageCache && usageCache.exactTokens) || 0,
        calls: (usageCache && usageCache.calls) || 0
      }
    }
    // ==== llm-usage END ====
    // LLM 选择：settings.llm（provider+model 齐备）优先；否则回退跟随会话（adm.currentSelection）
    function resolveLlmSelection() {
      const s = settingsCache && settingsCache.llm
      if (s && typeof s.provider === 'string' && s.provider && typeof s.model === 'string' && s.model) {
        return { provider: s.provider, model: s.model }
      }
      if (!adm) return null
      try { return adm.currentSelection() } catch (e) { return null }
    }
    // 可用模型列表（设置卡片下拉数据源）：探 llm 服务目录；探不到返回 []（client 退化为手输 provider/model）
    async function listAvailableModels() {
      const models = []
      if (!llm) return models
      const seen = {}
      function push(provider, model, label) {
        if (!provider || !model) return
        const key = provider + '/' + model
        if (seen[key]) return
        seen[key] = true
        models.push({ provider: provider, model: model, label: label || key })
      }
      // 首选标准目录：llm.listProviders() → llm.listModels(provider)
      let providers = []
      try { if (typeof llm.listProviders === 'function') providers = (await llm.listProviders()) || [] } catch (e) {}
      if (!providers.length && Array.isArray(llm.providers)) providers = llm.providers
      for (const p of providers) {
        const pid = p && (typeof p === 'string' ? p : (p.id || p.provider))
        if (!pid) continue
        try {
          if (typeof llm.listModels === 'function') {
            const ms = (await llm.listModels(pid)) || []
            for (const m of ms) {
              const mid = m && (typeof m === 'string' ? m : (m.id || m.model))
              if (mid) push(pid, mid, (p && p.name ? p.name : pid) + ' / ' + (m && m.name ? m.name : mid))
            }
          }
        } catch (e) {}
      }
      // 退化探针：llm.list() / llm.listModels() 无参全量目录（部署差异兜底）
      if (!models.length) {
        for (const fnName of ['list', 'listModels']) {
          try {
            if (typeof llm[fnName] !== 'function') continue
            const all = (await llm[fnName]()) || []
            for (const m of all) { if (m && m.provider && (m.model || m.id)) push(m.provider, m.model || m.id) }
            if (models.length) break
          } catch (e) {}
        }
      }
      return models
    }

    async function classifyTopic(text) {
      if (!llm) return '未分类'
      try {
        await loadSettings()
        const sel = resolveLlmSelection()   // 设置里的 LLM 优先；未设置 → 跟随会话（adm.currentSelection）
        if (!sel || !sel.provider || !sel.model) return '未分类'
        const preset = ['需求', '设计', '开发', '调试', '运维', '调研', '其他']
        const prompt = '你是一个笔记主题分类器。预设主题：' + preset.join('、') + '。请优先从预设主题中选择最匹配的一个；如果内容明显不属于任何预设主题，可输出一个新的简短主题（2-6个汉字）。只输出主题名本身，不要解释、标点或换行：\n\n' + text
        // 计量包装（llm-usage 块）：usage chunk 真实值优先，缺省字符估算；feature='classify'
        const metered = await streamMetered('classify', {
          provider: sel.provider,
          model: sel.model,
          messages: [{
            id: 'topic-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' }
          }],
          system: '你是一个笔记主题分类器，把用户内容归纳成极简主题。',
          temperature: 0
        })
        const out = metered.text
        const topic = out.trim().replace(/^["'「」『』]+|["'「」『』]+$/g, '')
        return topic || '未分类'
      } catch (e) {
        console.error('notes: classifyTopic failed', e)
        return '未分类'
      }
    }

