    // 约定命中判定（约定注入与目录段普通行去重共用）：
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

    // 上下文注入（约定桶 + 目录段）：从常驻内存 cache 同步读取 inject=true 笔记，按 injectRole 分桶注入 agent 系统提示。
    // text 是同步函数（systemPrompt 契约），故不能 await _list()，必须读 cache。
    // 是否注入：inject 布尔字段（noteFromParsed 已对旧数据回退到 convention 标签）；
    // 注入范围由笔记的 injectTo 字段决定（命中语义见 conventionHit）。
    // 分桶：injectRole='convention' → 用户约定（须遵守，全文注入，红线零触碰）；挂载行 = 注入索引根笔记 §1 逐行（0.4.3⑤ 管线载荷）。
    // 0.4.4-E（notes-044-catalog-remove）：「目录段补充未挂载条目」整体移除——全库平铺普通行与「资料=显式挂载」模型冲突，
    //   挂载行（注入索引 §1 管线载荷）是目录段唯一内容源；catalogEnabled 设置分支/UI 开关/预览徽标/catalog 遥测埋点/catalog 兼容别名一并退役
    //   （用户 settings.json 存量 catalogEnabled 键保留不迁移 = 惰性死键无人读；recall 字段随之失去最后消费方——
    //   0.4.5-A（notes-045-debt-host）写侧退役落地：buildFM 不再写 recall 行，存量行解析保留 = 读写兼容；
    //   staleDays 的 ⚠ 注入标注呈现面随普通行拆除——现存唯一消费方 = 整理建议器过期候选提名（memory.js suggestCandidates））。
    // 目录段语义：挂载行排前（§1 行原样进段）+ 挂载 note_get 引导 + 尾部提示行（价值信号行[0.4.3⑥]/预算省略计数/约定脱敏计数/日志计数尾行/规划轻推）；
    //   无挂载行且无日志 → 目录段整段为空。约定桶与索引 §1 行格式零变化（红线）。
    // 文案不再标注工作区归属与来源会话：大量笔记由 agent 快速记录产生，归属标注对注入方无意义。
    // sidOverride（注入预览 RPC 专用）：不传 = 真实注入路径（取当前会话，行为不变）；传 '' = 「全局」视角（只命中 injectTo=[] 的笔记）；
    // 传会话短 id = 按该会话 injectTo 命中过滤；传会话短 id 数组 = 工作区并集视角（workspace 参数，命中集合内任一会话即视为命中）。
    // renderInjected 返回 { full, conventions, directory }：full = order 130 注入全文（conventionText 口径）；
    //   conventions = 约定段文本（引导词 + 约定桶）；directory = 目录段文本（含尾部提示行）。
    // 注入价值信号行（0.4.3 验收修复⑥ notes-043-metrics-present，三层架构收口之呈现层）：
    // 数据源 = telemetry 内存缓存的账本快照（_telemetryCache.ledger——cron/手动 _ledgerRefresh 经 _telemetrySetLedger 写入）：
    //   同步读内存权威，零磁盘零 await（renderInjected 同步契约守住）；存储未加载/无快照/快照无命中 → 整行省略（静默降级，不占位不报错）。
    // 快照原子性（构造性保证，节 78 断言④看守）：本行与本次渲染目录行在同一同步装配时刻现算，提及 id 一律过滤到
    //   存活目录行 id 集（预算省略后挂载行——0.4.4-E 起目录段唯挂载行源）——信号行与目录行构造性同版本；约定桶全文条目不进目录行 → 不出现。
    // 埋点纪律：纯读零写（零 _recallRaw/_telemetry 写入）——render→record 顺序不变，本次装配自排除（信号反映装配前存量快照）。
    // 用途分级红线：本行只服务注入呈现（Top3 + 零引用候选首条紧凑信号，≤200 字符截断）；正确性判断/清理裁决必须走
    //   notes-recall-stats 全量或人工（README 治理节明示）。
    function _valueSignalLine(dirIds) {
      try {
        const lg = _telemetryCache && _telemetryCache.ledger
        if (!lg || !lg.at) return ''
        const inDir = function (id) { return dirIds.indexOf(String(id)) >= 0 }
        const tops = []
        for (const it of lg.top || []) {
          if (!it || !inDir(it.id)) continue
          tops.push(String(it.id) + '×' + Math.max(0, Math.floor(Number(it.count) || 0)))
          if (tops.length >= 3) break   // Top3 截断
        }
        let zero = ''
        for (const z0 of lg.zeroRef || []) { if (inDir(z0)) { zero = String(z0); break } }   // 零引用候选首条
        if (!tops.length && !zero) return ''   // 无可呈现信号 → 整行省略（不占位）
        const ms = Date.parse(lg.at)
        const d = isFinite(ms) ? new Date(ms) : null
        const pad = function (n) { return (n < 10 ? '0' : '') + n }
        const parts = []
        if (tops.length) parts.push('本周引用：' + tops.join('、'))
        if (zero) parts.push('零引用候选：' + zero)
        parts.push('截至 ' + (d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : String(lg.at)))
        return ('（' + parts.join('｜') + '）').slice(0, 200)   // 红线：信号行总长 ≤200 字符
      } catch (e) { return '' }
    }
    function renderInjected(sidOverride) {
      const EMPTY = { full: '', conventions: '', directory: '' }
      lastConvStats.masked = 0; lastConvStats.budgetTruncated = false
      lastCatStats.masked = 0; lastCatStats.stale = 0
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
        matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        // 约定桶：injectRole 非 reference 的命中笔记全文注入（红线不动）
        const conventions = []
        for (const n of matches) { if (n.injectRole !== 'reference') conventions.push(n) }
        // 挂载行（目录段排前 = 增强态载荷）：注入索引根笔记 §1 逐行（每行 whenToUse + [[链接]]，agent 按需 note_get 拉正文）。
        // 索引行先于空判计算：约定零命中但有挂载行/目录行时仍要注入（行即载荷）。
        // refBlocks 保对象形态（遥测取 id 用——Verifier 驳回①修复锚：此前直接 .map 成字符串后再取 b.id 恒 undefined，交付静默丢失）；
        // refLines = §1 行原样进段：raw 已是 `- [[id]] …` 完整列表行（Verifier 驳回②修复锚——此前再叠 '- ' 前缀产出 `- - [[id]]` 双横线行，
        //   与卡面契约/README 单横线形态及前端行解析正则 ^- \[\[? 三重不符，预览挂载行不可点；禁止再加前缀）；
        // 预算省略 pop 只动 refLines 尾部，存活 id = refBlocks.slice(0, refLines.length)；
        // 排序：按挂载目标 updatedAt 降序（延续「从最旧开始省略」预算语义；目标不在库/无时间 → 视为最旧沉底）
        const refBlocks = idxLinesSync()
          .map(function (l) { const n = cache.get(l.id); return { id: l.id, raw: l.raw, ts: (n && !n.deleted && !n.tombstoned && n.updatedAt) || '' } })
          .sort(function (a, b) { return (b.ts || '').localeCompare(a.ts || '') })
        const refLines = refBlocks.map(function (it) { return it.raw })
        // 日志计数尾行（段尾提示，0.4.4-E 保留）：原 catalog 普通行分支内的计数随拆除移到段装配层，口径放宽为全量未删除日志——
        // recall=true 显式豁免进目录的通道已随 catalog 拆除（目录段唯挂载行源），计数尾行是日志存在性的唯一注入面提示
        let logCount = 0
        for (const n of cache.values()) { if (!n.deleted && (n.kind || 'note') === 'log') logCount++ }
        // 空判：约定零命中 + 无挂载行 + 无日志计数 → 整段为空不注入
        if (conventions.length === 0 && refLines.length === 0 && logCount === 0) { if (sidOverride === undefined) lastInjectChars = 0; return EMPTY }
        // 敏感脱敏：sensitive=true 的约定正文按行打码（键保留值遮蔽，见 sensitive-helpers 块），计数用于尾部提示行
        let maskedCount = 0
        const block = (n) => {
          const bodyTrim = String(n.body || '').trim()
          const bodyOut = n.sensitive === true ? (maskedCount++, maskSensitiveBody(bodyTrim, n.id)) : bodyTrim
          return '- [' + n.id + '] ' + String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ') + '\n  ' + bodyOut.replace(/\n/g, '\n  ')
        }
        const head = '以下是注入的上下文笔记（与当前任务无关时忽略）：'
        const convPart = conventions.length ? '\n\n用户约定（须遵守）：\n\n' + conventions.map(block).join('\n\n') : ''
        // 目录段拼装（预算省略循环反复重算，故为函数）：挂载行 + 挂载 note_get 引导 + 日志计数尾行 + 规划轻推行
        const dirBody = () => {
          if (refLines.length === 0 && logCount === 0) return ''
          let d = '\n\n本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：\n\n'
          if (refLines.length) d += refLines.join('\n') + '\n\n（以上为挂载索引行：正文用 note_get <id> 获取）'
          if (logCount > 0) d += '\n另有 ' + logCount + ' 条工作日志（kind=log，注入不含），note_search 可检索'
          d += '\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手'
          return d
        }
        // P1 注入体积预算（约，按字符数近似统计，不引 token 计算库）：约定桶永不截断；目录段 = 挂载行单源（0.4.4-E），
        // 超预算时挂载行内部仍 updatedAt 降序从旧整条省略，直至总长度回到预算内或目录段为空；省略计数在尾部提示行告知（note_search 可检索原文）
        const budget = injectBudgetChars()
        let droppedRefs = 0
        if (budget > 0) {
          while (refLines.length > 0 && (head + convPart + dirBody()).length > budget) { refLines.pop(); droppedRefs++ }
        }
        const convText = head + convPart
        let full = convText + dirBody()
        if (full.length > 4000) full = full.slice(0, 4000) + '\n\n（内容过长已截断）'
        // 尾部提示行恒定可见（截断之后追加）：价值信号行（卡⑥，先渲染后记账——本行纯读内存快照，随后的 _recallRaw 才记账）+ 预算省略计数（挂载行）+ 约定脱敏计数 + 图片路径消歧
        // 快照原子性锚（卡⑥）：存活目录行 id 集 = 预算省略后挂载行（refBlocks 前 refLines.length 项——0.4.4-E 起目录段唯挂载行源）；
        //   信号行与目录行同一同步装配时刻现算，构造性同版本（节 78 断言④：信号行 id ⊆ 本集）
        const dirIds = refBlocks.slice(0, refLines.length).map(function (it) { return it.id })
        const sigLine = _valueSignalLine(dirIds)
        let tailLines = sigLine ? '\n\n' + sigLine : ''
        if (droppedRefs > 0) tailLines += '\n\n…另有 ' + droppedRefs + ' 条目录行超出预算未注入（note_search 可检索）'
        if (maskedCount > 0) tailLines += '\n\n（其中 ' + maskedCount + ' 条含敏感信息已脱敏，原文用 note_get 按 id 获取）'
        // 图片路径消歧（img-path-hint 块）：实际注入的约定正文含 assets/ 图片引用时，尾部追加一次绝对路径提示（全量只出一次）
        if (conventions.some(function (n) { return bodyHasImageRef(n.body) })) tailLines += '\n\n' + assetsHintLine(NOTES_ROOT)
        full += tailLines
        // 预览统计：约定脱敏条数 + 预算截断标记（目录段有省略即视为截断）；预览渲染不触碰 lastInjectChars；
        // lastCatStats（原目录普通行打码/时效计数）随 0.4.4-E catalog 拆除恒 0（stats.maskedNotes/staleMarked 字段保留 = 约定桶口径）
        lastConvStats.masked = maskedCount; lastConvStats.budgetTruncated = droppedRefs > 0
        if (sidOverride === undefined) lastInjectChars = full.length   // 注入体积缓存：真实注入渲染才更新（设置卡片仪表数据源）
        // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：真实注入路径才记（预览 sidOverride 不计），签名去重 + 静默降级（recall-telemetry 块）；
        // inject 通道 ids = 约定 + 存活挂载行 id 集（refLines 尾部省略 → 存活 = refBlocks 前 refLines.length 项）；
        // 0.4.4-E：catalog 通道埋点随「目录补充行」拆除退役（recall.js 通道结构保留 dormant，永不再产事件）
        if (sidOverride === undefined) {
          _recallRaw('inject', conventions.map(function (n) { return n.id }).concat(refBlocks.slice(0, refLines.length).map(function (it) { return it.id })), curSid)
        }
        // 预览拆分：conventions = 约定段（截断口径）；directory = 目录段 + 尾部提示行（totalChars = 两者之和保持）
        const convShown = full.slice(0, Math.min(convText.length, full.length))
        const dirShown = full.slice(convShown.length)
        return { full: full, conventions: convShown, directory: dirShown }
      } catch (e) { return { full: '', conventions: '', directory: '' } }
    }
    function conventionText(sidOverride) { return renderInjected(sidOverride).full }

    // 上下文注入（约定桶 + 合并目录段）：注册唯一动态 prompt context（order 130，位于 policy/delegation 之后）；
    // 0.4.3 验收修复③：目录段并入本 context，原 notes:catalog order 131 撤销（单一目录段语义见 renderInjected 头注）
    if (systemPrompt && typeof systemPrompt.context === 'function') {
      disposers.push(systemPrompt.context({ name: 'notes:workspace-conventions', order: 130, text: () => conventionText() }))
    }
    // 调试 RPC：预览当前会话将注入的上下文笔记文本（真实注入路径同渲染，E2E 验证用）；
    // 0.4.3③ 起附 conventions/directory 分段（text = 全文 = conventions + directory，向后兼容）
    disposers.push(handle('notes-conventions', async () => { const r = renderInjected(); return { text: r.full, conventions: r.conventions, directory: r.directory } }))
    // 注入预览（设置卡片「注入预览」modal 数据源）：纯复用 renderInjected 渲染产物 + 统计，不重写拼装。
    // 返回结构 0.4.4-E：{ conventions, directory, stats }（0.4.3③ 的 catalog 兼容别名 + stats.catalogEnabled/catalogChars
    // 随「目录补充行」整体拆除退役——目录段唯挂载行源，无普通行可别名）。
    // 三档视角：args.sessionId（会话 id/短 id）= 单会话 injectTo 命中口径（conventionHit 同一口径）；
    // args.workspace（工作区标题，notes-sessions 的 workspace 字段）= 该工作区全部会话的注入并集（会话短 id 集合与 injectTo 求交）；
    // 两者缺省 = 「全局」视角（sidOverride=''，只命中 injectTo=[] / 存量 global/workspace 的笔记）。
    // sessionId 与 workspace 互斥、同传时 sessionId 优先；workspace 经 _activeSessions 解析（与 UI 下拉同一数据源 notes-sessions，pending 占位会话同计入——标题未补齐不影响命中）。
    // 预览渲染不更新 lastInjectChars（仪表只反映真实注入）；统计取自同步渲染的 lastConvStats/lastCatStats（无竞态；lastCatStats 恒 0 = 原目录普通行统计随拆除归零）。
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
        const r = renderInjected(scope)
        return {
          conventions: r.conventions,
          directory: r.directory,
          stats: {
            conventionsChars: r.conventions.length,
            directoryChars: r.directory.length,
            totalChars: r.full.length,
            maskedNotes: lastConvStats.masked + lastCatStats.masked,
            staleMarked: lastCatStats.stale,
            budgetTruncated: lastConvStats.budgetTruncated
          }
        }
      } catch (e) { return { error: String(e.message || e) } }
    }))

    // 设置读取（设置卡片数据源）：settings 内存缓存（确保已加载）+ 可用模型列表（探不到为空数组，client 退化手输）
    // + lastInjectChars（最近一次注入体积，约/字符数——设置卡片仪表数据源，conventionText 每次渲染更新）
    // 0.4.7（notes-047-sched-preset）：响应增带 permissionPresets.defaultPreset——派发弹窗专属会话权限下拉的预填数据源
    //   （宿主 dsh-permission-presets 服务，零新 RPC）；服务缺席/getter 异常 → 键整体省略（优雅降级：client 读不到即按完全权限兜底预填，不渲染异常态）
    disposers.push(handle('notes-settings-get', async () => {
      let pp
      try { const dp = permissionPresets && permissionPresets.defaultPreset; if (typeof dp === 'string' && dp) pp = { defaultPreset: dp } } catch (e) {}
      try {
        await loadSettings()
        // 0.4.7-B⑦（notes-047-ux）：响应增带 organizeMaxChars 生效值（用户覆盖 || 模型表 || 12000 回落）——
        //   整理引导卡超限前置校验的数据源（零新 RPC，同 defaultPreset 先例）；计算不抛错（内部全回落）
        const out = { settings: settingsCache, models: await listAvailableModels(), lastInjectChars: lastInjectChars, organizeMaxChars: organizeMaxChars() }
        if (pp) out.permissionPresets = pp
        return out
      }
      catch (e) {
        const out = { settings: settingsCache || {}, models: [], lastInjectChars: lastInjectChars, organizeMaxChars: organizeMaxChars(), error: String(e.message || e) }
        if (pp) out.permissionPresets = pp
        return out
      }
    }))
    // 设置保存（client 选择即保存）：白名单顶层键；llm 为 null 恢复跟随会话；
    // 0.4.4-E：catalogEnabled 分支已随「目录补充行」拆除——该键现为未知键静默忽略（不报错不落盘）；
    // 用户存量 settings.json 残留的 catalogEnabled:true 保留不迁移（惰性死键无人读，加载即躺在 settingsCache 但无任何消费方）
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
        // P1 时效阈值（天）：非负数值取整直存；null/undefined 删除 override（缺省 90）；0 = 关闭
        // （0.4.4-E：⚠ 注入标注呈现面 = 目录普通行，已随 catalog 拆除；现存唯一消费方 = 整理建议器过期候选提名
        //   （memory.js suggestCandidates）——设置行保留服务该口径，读写兼容不迁移）
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
        // 0.4.7-B⑦（notes-047-ux）整理长度上限（字符）：正整数取整直存；0/null/undefined 删除 override = 跟随所配模型自动（模型表 || 12000 回落）
        if ('organizeMaxChars' in patch) {
          if (patch.organizeMaxChars === null || patch.organizeMaxChars === undefined || patch.organizeMaxChars === 0) delete settingsCache.organizeMaxChars
          else if (typeof patch.organizeMaxChars === 'number' && isFinite(patch.organizeMaxChars) && patch.organizeMaxChars > 0) settingsCache.organizeMaxChars = Math.floor(patch.organizeMaxChars)
          else return { error: 'notes-settings-set: organizeMaxChars 需要非负数值（0 = 按所配模型自动）' }
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
