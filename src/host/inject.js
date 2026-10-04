    // 约定命中判定（约定注入 conventionText 与目录去重 catalogText 共用）：
    // 注入范围 injectTo 是多选数组（不再有「工作区」维度——笔记无归属，只看会话）：
    //   []（空）                  → 默认所有会话
    //   含 'global' / 'workspace' → 存量值容错：同样视为所有会话（不迁移、不保留工作区过滤）
    //   含会话短 id               → 仅注入这些会话（可多选多个会话）
    // ws 形参保留（调用点不变）但不再用于过滤。
    // curSid 两种形态：字符串 = 单会话命中口径；字符串数组 = 多会话并集（注入预览「工作区」视角专用：
    // 工作区 = 其全部会话的注入并集，injectTo 与集合有交集即命中；空数组 = 只命中 injectTo=[] 的全局笔记）。
    function conventionHit(n, ws, curSid) {
      const targets = n.injectTo || []
      if (targets.length === 0) return true
      const sidSet = Array.isArray(curSid) ? curSid : null
      for (const t of targets) {
        if (t === 'global' || t === 'workspace') return true
        if (sidSet ? sidSet.indexOf(t) >= 0 : t === curSid) return true
      }
      return false
    }

    // 上下文注入（双角色）：从常驻内存 cache 同步读取 inject=true 笔记，按 injectRole 分桶注入 agent 系统提示。
    // text 是同步函数（systemPrompt 契约），故不能 await _list()，必须读 cache。
    // 是否注入：inject 布尔字段（noteFromParsed 已对旧数据回退到 convention 标签）；
    // 注入范围由笔记的 injectTo 字段决定（命中语义见 conventionHit）。
    // 分桶：injectRole='convention' → 用户约定（须遵守）；'reference' → 参考资料（按需取用）；
    // 缺省/非法值已在 noteFromParsed 回退 convention（存量零迁移）；只命中单桶时只输出该桶标题。
    // 文案不再标注工作区归属与来源会话：大量笔记由 agent 快速记录产生，归属标注对注入方无意义。
    // sidOverride（注入预览 RPC 专用）：不传 = 真实注入路径（取当前会话，行为不变）；传 '' = 「全局」视角（只命中 injectTo=[] 的笔记）；
    // 传会话短 id = 按该会话 injectTo 命中过滤；传会话短 id 数组 = 工作区并集视角（workspace 参数，命中集合内任一会话即视为命中）。
    // 拼装逻辑不变，仅 curSid 输入来源不同（纯复用）。
    function conventionText(sidOverride) {
      const shortSid = (x) => x ? String(x).replace(/^session-/, '').slice(0, 8) : ''
      lastConvStats.masked = 0; lastConvStats.budgetTruncated = false
      try {
        let cwd = ''
        let sid = ''
        const a = agents && agents.currentInitiator ? agents.currentInitiator() : undefined
        if (a) {
          cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          sid = a.sessionId || (a.session && a.session.id) || ''
        }
        const ws = basename(cwd)
        const curSid = sidOverride !== undefined ? sidOverride : shortSid(sid)
        const matches = []
        for (const n of cache.values()) {
          if (n.deleted) continue
          if (n.inject !== true) continue
          if (conventionHit(n, ws, curSid)) matches.push(n)
        }
        if (matches.length === 0) { if (sidOverride === undefined) lastInjectChars = 0; return '' }
        matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        // 双角色分桶：约定与资料各自成段，标题换行收拢，正文行统一缩进两格保持在列表项内
        const conventions = []
        const references = []
        for (const n of matches) (n.injectRole === 'reference' ? references : conventions).push(n)
        // 敏感脱敏：sensitive=true 的笔记正文按行打码（键保留值遮蔽，见 sensitive-helpers 块），计数用于尾部提示行
        let maskedCount = 0
        const block = (n) => {
          const bodyTrim = String(n.body || '').trim()
          const bodyOut = n.sensitive === true ? (maskedCount++, maskSensitiveBody(bodyTrim, n.id)) : bodyTrim
          return '- [' + n.id + '] ' + String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ') + '\n  ' + bodyOut.replace(/\n/g, '\n  ')
        }
        const head = '以下是注入的上下文笔记（与当前任务无关时忽略）：'
        const convPart = conventions.length ? '\n\n用户约定（须遵守）：\n\n' + conventions.map(block).join('\n\n') : ''
        // 资料块整列预渲染（block 有 maskedCount 计数副作用，每条只渲染一次；被预算省略时整块丢弃）
        const refBlocks = references.map(block)
        const refHead = '\n\n参考资料（与当前任务相关时按需取用）：\n\n'
        // P1 注入体积预算（约，按字符数近似）：约定桶永不截断；资料桶从最旧（updatedAt 降序的尾部）开始整条省略，
        // 直至总长度回到预算内或资料桶为空；省略计数在尾部提示行告知（note_search 可检索原文）
        const budget = injectBudgetChars()
        let droppedRefs = 0
        if (budget > 0) {
          while (refBlocks.length > 0 && (head + convPart + refHead + refBlocks.join('\n\n')).length > budget) {
            refBlocks.pop()
            droppedRefs++
          }
        }
        let full = head + convPart
        if (refBlocks.length) full += refHead + refBlocks.join('\n\n')
        if (full.length > 4000) full = full.slice(0, 4000) + '\n\n（内容过长已截断）'
        // 尾部提示行恒定可见（截断之后追加）：预算省略计数 + 脱敏计数（原文 note_get 按 id 获取 / note_search 检索）
        if (droppedRefs > 0) full += '\n\n…另有 ' + droppedRefs + ' 条资料超出预算未注入（note_search 可检索）'
        if (maskedCount > 0) full += '\n\n（其中 ' + maskedCount + ' 条含敏感信息已脱敏，原文用 note_get 按 id 获取）'
        // 图片路径消歧（img-path-hint 块）：实际注入的正文含 assets/ 图片引用时，尾部追加一次绝对路径提示（截断之后追加，恒定可见；预算省略的资料不算）
        if (conventions.concat(references.slice(0, refBlocks.length)).some(function (n) { return bodyHasImageRef(n.body) })) full += '\n\n' + assetsHintLine(NOTES_DIR)
        // 预览统计：脱敏条数 + 预算截断标记（资料桶有省略即视为截断）；预览渲染不触碰 lastInjectChars
        lastConvStats.masked = maskedCount; lastConvStats.budgetTruncated = droppedRefs > 0
        if (sidOverride === undefined) lastInjectChars = full.length   // 注入体积缓存：真实注入渲染才更新（设置卡片仪表数据源）
        return full
      } catch (e) { return '' }
    }

    // ---- 笔记目录索引注入（recall 通道，order 131）----
    // 全库一行一条目录 + 轻推提示：让 agent 规划时知道库里有什么，相关条目自主 note_get 拉全文、note_search 检索更多。
    // 准入：排除 deleted、status=resolved/superseded（已了结不进目录）、recall=false（front-matter 逐条关闭，缺省 true）；
    // 与约定注入去重：inject=true 且本会话命中（order 130 已注入全文）的笔记不再出现。
    // 排序：pinned 优先 → updatedAt 降序（注入无工作区维度，不按工作区重排）；CATALOG_LIMIT 条封顶。
    // text 是同步函数（systemPrompt 契约）：读常驻 cache + settingsCache；总开关关闭/无条目/异常 → 返回 ''（不能返回 undefined）。
    const CATALOG_LIMIT = 40
    const CATALOG_KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志' }
    // sidOverride：注入预览 RPC 专用（语义同 conventionText——含数组形态的工作区并集视角）；不传 = 真实注入路径（当前会话），行为不变
    function catalogText(sidOverride) {
      lastCatStats.masked = 0; lastCatStats.stale = 0
      try {
        if (settingsCache && settingsCache.catalogEnabled === false) return ''   // 面板总开关（settings.json，缺省开）
        let cwd = ''
        let sid = ''
        const a = agents && agents.currentInitiator ? agents.currentInitiator() : undefined
        if (a) {
          cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          sid = a.sessionId || (a.session && a.session.id) || ''
        }
        const ws = basename(cwd)
        const curSid = sidOverride !== undefined ? sidOverride : shortSid(sid)
        const pool = []
        // 工作记忆 v0：日志计数提示行数据源（目录条目因 recall 缺省 false 不含日志；有日志时尾部恒出现一行占位提示，不刷屏）
        let logCount = 0
        for (const n of cache.values()) {
          if (n.deleted) continue
          if ((n.kind || 'note') === 'log') { logCount++; continue }
          if (n.status === 'resolved' || n.status === 'superseded') continue   // 已了结的笔记不进目录
          if (n.recall === false) continue                                     // recall=false 逐条关闭
          if (n.inject === true && conventionHit(n, ws, curSid)) continue      // 约定注入去重（全文已在 order 130）
          pool.push(n)
        }
        if (pool.length === 0 && logCount === 0) return ''
        pool.sort((x, y) => {
          const px = x.status === 'pinned' ? 1 : 0
          const py = y.status === 'pinned' ? 1 : 0
          if (px !== py) return py - px                                        // pinned 优先
          return (y.updatedAt || '').localeCompare(x.updatedAt || '')          // 更新时间降序
        })
        const shown = pool.slice(0, CATALOG_LIMIT)
        // 敏感脱敏：目录只出标题一行，sensitive=true 的条目标题同样按行打码（防标题泄值）并加 🔒 标记；计数用于尾部提示行
        let maskedCount = 0
        // P1 时效衰减提醒：kind=note/link（参考资料类）且 updatedAt 距今超过 staleDays（缺省 90 天，0=关闭）的行尾追加 ⚠ 标注
        const staleLimit = staleDaysLimit()
        let staleCount = 0   // 预览统计：被 ⚠ 时效标注的条目数
        const lines = shown.map(n => {
          const kl = CATALOG_KIND_LABELS[n.kind] || CATALOG_KIND_LABELS.note
          let title = String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ')   // 一行一条：标题换行收拢
          let mark = ''
          if (n.sensitive === true) { maskedCount++; title = maskSensitiveLine(title, n.id); mark = '🔒 ' }
          let line = '- [' + n.id + '] ' + mark + title + ' (' + kl + ', ' + (n.topic || '未分类') + ')'
          const sd = staleDaysOf(n.updatedAt, (n.kind === 'note' || n.kind === 'link') ? staleLimit : 0)
          if (sd > 0) { staleCount++; line += ' ⚠ ' + sd + ' 天未更新' }
          return line
        })
        if (pool.length > CATALOG_LIMIT) lines.push('…另有 ' + (pool.length - CATALOG_LIMIT) + ' 条较早笔记，用 note_search 检索')
        if (maskedCount > 0) lines.push('（其中 ' + maskedCount + ' 条含敏感信息已脱敏，原文用 note_get 按 id 获取）')
        // 工作记忆 v0（裁决 B①）：目录尾部固定日志计数提示行——只出计数不出标题（天然无泄露面），引导 agent 显式检索日志
        if (logCount > 0) lines.push('另有 ' + logCount + ' 条工作日志（kind=log，默认隐身不进目录），用 note_search 传 kind=log 检索')
        lastCatStats.masked = maskedCount; lastCatStats.stale = staleCount   // 预览统计（notes-inject-preview）
        let out = '本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：\n' +
          lines.join('\n') +
          '\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手'
        // 图片路径消歧（img-path-hint 块）：目录条目正文含 assets/ 图片引用时尾部追加一次绝对路径提示（note_get 拉全文后可直读图片）
        if (shown.some(function (n) { return bodyHasImageRef(n.body) })) out += '\n' + assetsHintLine(NOTES_DIR)
        return out
      } catch (e) { return '' }
    }


    // 上下文注入（双角色分桶）：注册动态 prompt context（order 130，位于 policy/delegation 之后）
    // 笔记目录索引注入（recall 通道）：order 131 紧邻上下文注入之后；text 同步返回 string，无内容/总开关关闭返回 ''
    if (systemPrompt && typeof systemPrompt.context === 'function') {
      disposers.push(systemPrompt.context({ name: 'notes:workspace-conventions', order: 130, text: () => conventionText() }))
      disposers.push(systemPrompt.context({ name: 'notes:catalog', order: 131, text: () => catalogText() }))
    }
    // 调试 RPC：预览当前会话将注入的上下文笔记文本（双角色分桶新文案，E2E 验证用）
    disposers.push(handle('notes-conventions', async () => ({ text: conventionText() || '' })))
    // 注入预览（设置卡片「注入预览」modal 数据源）：纯复用 conventionText/catalogText 渲染产物 + 统计，不重写拼装。
    // 三档视角：args.sessionId（会话 id/短 id）= 单会话 injectTo 命中口径（conventionHit 同一口径）；
    // args.workspace（工作区标题，notes-sessions 的 workspace 字段）= 该工作区全部会话的注入并集（会话短 id 集合与 injectTo 求交）；
    // 两者缺省 = 「全局」视角（sidOverride=''，只命中 injectTo=[] / 存量 global/workspace 的笔记）。
    // sessionId 与 workspace 互斥、同传时 sessionId 优先；workspace 经 _activeSessions 解析（与 UI 下拉同一数据源 notes-sessions，pending 占位会话同计入——标题未补齐不影响命中）。
    // 预览渲染不更新 lastInjectChars（仪表只反映真实注入）；统计取自同步渲染的 lastConvStats/lastCatStats（无竞态）。
    disposers.push(handle('notes-inject-preview', async (args) => {
      try {
        const sid = args && args.sessionId ? shortSid(String(args.sessionId)) : ''
        const wsName = !sid && args && args.workspace ? String(args.workspace) : ''
        let scope = sid
        if (wsName) {
          const wsSet = []
          const sessRes = await _activeSessions()
          const wsAll = (sessRes.sessions || []).concat(sessRes.pendingSessions || [])
          for (const s of wsAll) { if (s && s.workspace === wsName && s.short && wsSet.indexOf(s.short) < 0) wsSet.push(s.short) }
          scope = wsSet   // 空集合 = 该工作区暂无有效会话：并集退化为只命中 injectTo=[]（全局共享笔记）
        }
        const conventions = conventionText(scope) || ''
        const catalog = catalogText(scope) || ''
        return {
          conventions: conventions,
          catalog: catalog,
          stats: {
            conventionsChars: conventions.length,
            catalogChars: catalog.length,
            totalChars: conventions.length + catalog.length,
            maskedNotes: lastConvStats.masked + lastCatStats.masked,
            staleMarked: lastCatStats.stale,
            budgetTruncated: lastConvStats.budgetTruncated
          }
        }
      } catch (e) { return { error: String(e.message || e) } }
    }))

    // 设置读取（设置卡片数据源）：settings 内存缓存（确保已加载）+ 可用模型列表（探不到为空数组，client 退化手输）
    // + lastInjectChars（最近一次注入体积，约/字符数——设置卡片仪表数据源，conventionText 每次渲染更新）
    disposers.push(handle('notes-settings-get', async () => {
      try { await loadSettings(); return { settings: settingsCache, models: await listAvailableModels(), lastInjectChars: lastInjectChars } }
      catch (e) { return { settings: settingsCache || {}, models: [], lastInjectChars: lastInjectChars, error: String(e.message || e) } }
    }))
    // 设置保存（client 选择即保存）：浅合并顶层键；llm 为 null 恢复跟随会话；catalogEnabled 为 null 恢复默认开
    disposers.push(handle('notes-settings-set', async (args) => {
      try {
        await loadSettings()
        const patch = (args && typeof args === 'object') ? args : {}
        if ('llm' in patch) {
          if (patch.llm === null || patch.llm === undefined) delete settingsCache.llm
          else {
            const l = patch.llm
            const provider = l && typeof l.provider === 'string' ? l.provider.trim() : ''
            const model = l && typeof l.model === 'string' ? l.model.trim() : ''
            if (!provider || !model) return { error: 'notes-settings-set: llm 需要 provider + model（或 null 恢复跟随会话）' }
            settingsCache.llm = { provider: provider, model: model }
          }
        }
        // 目录索引注入总开关：布尔直存；null/undefined 删除 override（缺省 = 开）
        if ('catalogEnabled' in patch) {
          if (patch.catalogEnabled === null || patch.catalogEnabled === undefined) delete settingsCache.catalogEnabled
          else if (typeof patch.catalogEnabled === 'boolean') settingsCache.catalogEnabled = patch.catalogEnabled
          else return { error: 'notes-settings-set: catalogEnabled 需要布尔值（或 null 恢复默认开）' }
        }
        // P1 时效衰减提醒阈值（天）：非负数值取整直存；null/undefined 删除 override（缺省 90）；0 = 关闭标注
        if ('staleDays' in patch) {
          if (patch.staleDays === null || patch.staleDays === undefined) delete settingsCache.staleDays
          else if (typeof patch.staleDays === 'number' && isFinite(patch.staleDays) && patch.staleDays >= 0) settingsCache.staleDays = Math.floor(patch.staleDays)
          else return { error: 'notes-settings-set: staleDays 需要非负数值（或 null 恢复缺省 90 天）' }
        }
        // P1 注入体积预算（约，字符数）：非负数值取整直存；null/undefined 删除 override（缺省 0 = 不限）
        if ('injectBudgetChars' in patch) {
          if (patch.injectBudgetChars === null || patch.injectBudgetChars === undefined) delete settingsCache.injectBudgetChars
          else if (typeof patch.injectBudgetChars === 'number' && isFinite(patch.injectBudgetChars) && patch.injectBudgetChars >= 0) settingsCache.injectBudgetChars = Math.floor(patch.injectBudgetChars)
          else return { error: 'notes-settings-set: injectBudgetChars 需要非负数值（或 null 恢复不限）' }
        }
        // LLM 月度用量预算提醒阈值（tokens/月，notes-token-stats）：非负数值取整直存；null/undefined 删除 override（缺省 0 = 关闭提醒）；
        // 超预算仅 client toast 提醒，不阻断任何调用
        if ('usageBudgetMonthly' in patch) {
          if (patch.usageBudgetMonthly === null || patch.usageBudgetMonthly === undefined) delete settingsCache.usageBudgetMonthly
          else if (typeof patch.usageBudgetMonthly === 'number' && isFinite(patch.usageBudgetMonthly) && patch.usageBudgetMonthly >= 0) settingsCache.usageBudgetMonthly = Math.floor(patch.usageBudgetMonthly)
          else return { error: 'notes-settings-set: usageBudgetMonthly 需要非负数值（或 null 恢复关闭提醒）' }
        }
        // 工作记忆 v0 日志卫生窗口（天）：logWeekAfterDays 周聚合窗口（缺省 7）/ logRetentionDays 月聚合窗口（缺省 90，0 = 关闭月聚合本级）；
        // 非负数值取整直存；null/undefined 删除 override 恢复缺省（settings-set 校验同款模式）
        if ('logWeekAfterDays' in patch) {
          if (patch.logWeekAfterDays === null || patch.logWeekAfterDays === undefined) delete settingsCache.logWeekAfterDays
          else if (typeof patch.logWeekAfterDays === 'number' && isFinite(patch.logWeekAfterDays) && patch.logWeekAfterDays >= 0) settingsCache.logWeekAfterDays = Math.floor(patch.logWeekAfterDays)
          else return { error: 'notes-settings-set: logWeekAfterDays 需要非负数值（或 null 恢复缺省 7 天）' }
        }
        if ('logRetentionDays' in patch) {
          if (patch.logRetentionDays === null || patch.logRetentionDays === undefined) delete settingsCache.logRetentionDays
          else if (typeof patch.logRetentionDays === 'number' && isFinite(patch.logRetentionDays) && patch.logRetentionDays >= 0) settingsCache.logRetentionDays = Math.floor(patch.logRetentionDays)
          else return { error: 'notes-settings-set: logRetentionDays 需要非负数值（或 null 恢复缺省 90 天；0 = 关闭月聚合）' }
        }
        // 文件夹嵌套深度上限（层，根级=1）：非负数值取整直存；null/undefined 删除 override（缺省 3）；0 = 不限层数
        if ('maxFolderDepth' in patch) {
          if (patch.maxFolderDepth === null || patch.maxFolderDepth === undefined) delete settingsCache.maxFolderDepth
          else if (typeof patch.maxFolderDepth === 'number' && isFinite(patch.maxFolderDepth) && patch.maxFolderDepth >= 0) settingsCache.maxFolderDepth = Math.floor(patch.maxFolderDepth)
          else return { error: 'notes-settings-set: maxFolderDepth 需要非负数值（或 null 恢复缺省 3；0 = 不限层数）' }
        }
        await saveSettings()
        return { ok: true, settings: settingsCache }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // LLM 用量统计（notes-token-stats，llm-usage 块数据源）：{ today, week, month, allTime, byFeature, estimatedTokens, exactTokens, calls }
    // month = 当月累计（月度预算提醒口径）；estimatedTokens>0 表示含字符估算部分（UI 文案「约」）
    disposers.push(handle('notes-usage-get', async () => {
      try { await loadUsage(); return usageReport() } catch (e) { return { error: String(e.message || e) } }
    }))
