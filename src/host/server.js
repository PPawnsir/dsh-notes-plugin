    // ---- 性能遥测：RPC 计数/耗时 + 缓存命中 + client 推送快照，节流写盘供诊断 ----
    const perfStats = { started: new Date().toISOString(), rpc: {}, rpcMs: {}, classify: 0, classifyMs: 0, cacheReads: 0, diskReads: 0, diskWrites: 0, client: null }
    let lastPerfWrite = 0
    function writePerfReport() {
      const t = Date.now()
      if (t - lastPerfWrite < 10000) return
      lastPerfWrite = t
      ;(async () => {
        try {
          const ft = await fs.resolve(PLUGIN_DIR + '\\perf-report.json')
          await fs.writeText(ft, JSON.stringify({ writtenAt: new Date().toISOString(), host: perfStats }, null, 2), undefined, undefined, getPolicy())
        } catch (e) {}
      })()
    }
    // ==== slow-rpc-log BEGIN ====（慢请求诊断钩 notes-048-perf-backoff③：server.js 与 server.dist.js 本块逐字节一致，check 节 107 提取比对 + 行为级 eval；改动必须双边同步）
    // 巡检钓出「忙时饿死 vs 恒定挂起」取证面（反馈 n-muyg8rxawuds）：单请求处理 >5s 时 console.warn 一行（方法名+耗时）。
    // 纯进程日志——不写笔记库、不进遥测（perf-report.json 口径零变化）、不动路由并发结构（本次只观测）；阈值集中常量可改。
    const SLOW_RPC_LOG_MS = 5000
    function slowRpcLog(name, ms) {
      if (ms > SLOW_RPC_LOG_MS) { try { console.warn('[dsh-notes] 慢请求 ' + name + '：' + ms + 'ms（>5s）') } catch (e) {} }
    }
    // ==== slow-rpc-log END ====
    function handle(name, fn) {
      return harness.handle(name, async (args) => {
        const t0 = Date.now()
        try { return await fn(args) }
        finally { const ms = Date.now() - t0; perfStats.rpc[name] = (perfStats.rpc[name] || 0) + 1; perfStats.rpcMs[name] = (perfStats.rpcMs[name] || 0) + ms; writePerfReport(); slowRpcLog(name, ms) }
      })
    }
    disposers.push(handle('notes-perf', async (args) => { if (args && args.perf) perfStats.client = args.perf; return { ok: true } }))
    // P1 回收站：args.includeDeleted=true 时含软删除笔记（缺省排除）；tag/kind/folder 过滤口径不变
    // 日志同权（0.4.3 验收修复⑦）：kind=log 默认包含（可见/可搜同权）；args.includeLogs 保留为兼容 no-op（_list 注释承接）
    disposers.push(handle('notes-list', async (args) => ({ notes: (await _list(args && args.tag, args && args.kind, args && args.folder, !!(args && args.includeDeleted), !!(args && args.includeLogs))).map(slim) })))
    // 虚拟文件夹清单/管理：无参=列表（含子树口径计数 + parent/depth 嵌套字段），args={op:'create'(name,parent?)|'rename'|'delete'(id,cascade?——缺省拒绝有子内容)|'reorder'(ids,parents? 拖父级改挂), ...}
    disposers.push(handle('notes-folders', async (args) => {
      try { return await _folders(args) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 样式文件按需下发：避免 client 内嵌超长 CSS 字符串在 define 传输中被截断
    disposers.push(handle('notes-css', async () => {
      try { const ft = await fs.resolve(CSS_PATH); return { css: await fs.readText(ft) } } catch (e) { return { error: String(e.message || e) } }
    }))
    // client 实现源码下发：bootstrap 壳通过它加载 client 实现（同理避免 define 传大字符串）
    // client 源 = src/client/** 按 manifest.js 逐字节拼接（architecture-modular.md §4.1：零插入零改写，LF 归一；
    // 与 scripts/concat-client.cjs 同一解析规则——manifest 为单引号路径一行一条，沙箱无 require 故文本提取；
    // @shared/ 条目 = src/shared/ 两态物理共源块，client 态纳入时逐非空行加 4 空格基座缩进（apply 体层级））
    disposers.push(handle('notes-src', async (args) => {
      try {
        if (args && args.which === 'client') {
          const mtext = await fs.readText(await fs.resolve(PLUGIN_DIR + '\\src\\client\\manifest.js'))
          const list = (String(mtext).match(/'[^'\n]+'/g) || []).map(s => s.slice(1, -1))
          let src = ''
          for (const rel of list) {
            if (rel.indexOf('@shared/') === 0 || rel.indexOf('@i18n/') === 0) {
              // @i18n/ 条目 = src/i18n/ 双语字典（notes-042-i18n-mech），共源 + 基座缩进规则与 @shared/ 完全一致
              const seg = rel.slice(rel.indexOf('/') + 1).replace(/\//g, '\\')
              const shared = await fs.readText(await fs.resolve(PLUGIN_DIR + (rel.indexOf('@shared/') === 0 ? '\\src\\shared\\' : '\\src\\i18n\\') + seg))
              src += String(shared).replace(/\r\n/g, '\n').split('\n').map(l => l ? '    ' + l : l).join('\n')
            } else {
              src += await fs.readText(await fs.resolve(PLUGIN_DIR + '\\src\\client\\' + rel.replace(/\//g, '\\')))
            }
          }
          return { src: src.replace(/\r\n/g, '\n') }
        }
        // host 源下发：src/host/** 按 manifest.dev.js 逐字节拼接（与 host.js 引导壳同一拼接规则；P2·2 起 host-impl.js 已拆为模块树）
        const hmtext = await fs.readText(await fs.resolve(PLUGIN_DIR + '\\src\\host\\manifest.dev.js'))
        const hlist = (String(hmtext).match(/'[^'\n]+'/g) || []).map(s => s.slice(1, -1))
        let hsrc = ''
        for (const rel of hlist) hsrc += await fs.readText(await fs.resolve(PLUGIN_DIR + '\\src\\host\\' + rel.replace(/\//g, '\\')))
        return { src: hsrc.replace(/\r\n/g, '\n') }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // args.includeDeleted（回收站行预览 notes-trash-batch-preview）：已软删笔记正文只读可达（缺省拒绝，编辑器链路口径不变）；墓碑仍拒绝
    disposers.push(handle('notes-get', async (args) => {
      try {
        const n = args && args.includeDeleted ? await _getDeleted(args.id) : await _get(args.id)
        _recallHit('get', [n.id])   // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：get 通道取用信号日聚合（成功返回才计；静默降级）
        const s = slim(n); s.body = n.body; return { note: s }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== notes-get-batch BEGIN ====（N+1 批量端点 notes-034-batch3：双包同源——server.js 与 server.dist.js 本块逐字节一致，check 节 49 看守）
    // 首屏双链索引等「全库正文」场景的批量通道：一次调用拉全补缺/过期条目，请求数 O(n)→O(1)（证据 n-mut6u356mloa：76 条库 159 次 notes-get）。
    // 选型（弃 notes-list?includeBodies）：①消费方语义是「按 id 补缺 reconcile」，增量刷新只传 stale ids 省传输（includeBodies 每次全库往返）；
    //   ②notes-list 既有 slim 契约零风险（注入管理等调用方依赖瘦身列表）；③ids 数组给调用方留分片闸口。
    // 入参 {ids:[...]}；返回 { notes:[{id,body,updatedAt}], missing:[id...] }——最小传输面（正文三字段）；已删/墓碑/不存在条目计入 missing 不报错（调用方按缺口径下轮重试）。
    disposers.push(handle('notes-get-batch', async (args) => {
      try {
        const ids = (args && Array.isArray(args.ids)) ? args.ids : []
        const out = [], missing = []
        for (const id of ids) {
          try { const n = await _get(id); out.push({ id: n.id, body: n.body || '', updatedAt: n.updatedAt || '' }) }
          catch (e) { missing.push(id) }
        }
        return { notes: out, missing: missing }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== notes-get-batch END ====
    // 工作记忆 v0：kind=log 日志经同一 _create（隐身硬闸在内部生效）；logDate/entities/summarizedAt 检索字段透传（§7.2 往返预留）
    disposers.push(handle('notes-create', async (args) => {
      try {
        const ctErr = schedPublicContractTypeError(args && args.contractType)   // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule）
        if (ctErr) return { error: ctErr }
        return await _create(args.title, args.body, args.tags, args.topic, { kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo, folder: args.folder, recall: args.recall, sensitive: args.sensitive, hidden: args.hidden, logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt, contractType: args.contractType, origin: args.origin, schedule: args.schedule })
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // R-1：confirmClearBody 透传 _update 空正文覆盖兜底闸（body:'' 覆盖非空正文需显式确认，见 notes.js empty-body-overwrite-guard 块）
    disposers.push(handle('notes-update', async (args) => {
      try {
        const ctErr = schedPublicContractTypeError(args && args.contractType)   // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule）
        if (ctErr) return { error: ctErr }
        return await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, args.folder, args.recall, args.injectRole, args.sensitive, { logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt, contractType: args.contractType, origin: args.origin, schedule: args.schedule, hidden: args.hidden, confirmClearBody: args.confirmClearBody === true })
      } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-quick', async (args) => {
      try { return await _quickCapture(args.text, args.sessionId, args.cwd, args.kind) } catch (e) { return { error: String(e.message || e) } }
    }))
    // T3 指令式快速记录：备注非空时 LLM 提取 tags/titleHint/kind/inject，选区原文原样为 body，备注不进笔记
    disposers.push(handle('notes-quick-instruct', async (args) => {
      try { return await _quickInstruct(args.text, args.note, args.sessionId, args.cwd) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-delete', async (args) => {
      try { return await _delete(args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-restore', async (args) => {
      try { return await _restore(args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    // P1 回收站：彻底删除（仅限已软删除笔记；.md 与 .bak 一并移除，不可恢复；开发版为墓碑式清空）
    disposers.push(handle('notes-purge', async (args) => {
      if (!args || !args.id) return { error: 'notes-purge 需要 id' }
      try { return await _purge(args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 历史版本面板（notes-history-ui）：版本列表（倒序轻量零正文）/ 单版正文预览 / 一键恢复（恢复前当前版自动快照——恢复本身可撤销）
    disposers.push(handle('notes-history', async (args) => {
      try { return await _historyList(args && args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-history-get', async (args) => {
      try { return await _historyGet(args && args.id, args && args.ts) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-restore-history', async (args) => {
      try { return await _historyRestore(args && args.id, args && args.ts) } catch (e) { return { error: String(e.message || e) } }
    }))

    // 二期 ✨整理：{id?, body, kind, title?} → LLM 按 kind 模板重写正文，返回 { ok, body, kind }（不落盘，client 替换编辑器 + 一次撤销栈）
    disposers.push(handle('notes-ai-organize', async (args) => {
      try { return await _aiOrganize(args || {}) } catch (e) { return { error: String(e.message || e) } }
    }))

    // ==== when-suggest BEGIN ====（0.4.3 验收修复 notes-043-preview-when-edit：server.js 与 server.dist.js 本块逐字节一致，check 节 73 看守）
    // notes-when-suggest {id} → LLM 生成 whenToUse 单行草稿（挂载弹层预填数据源；仅用户主动触发——资料开注入/预览目录行点击，不批量后台跑）。
    // 同构 llm/usage-classify.js 调用模式：resolveLlmSelection（settingsCache.llm provider+model 齐备优先，否则跟随会话 adm.currentSelection）；
    //   prompt = 标题 + 正文前 1200 字摘要，要求随笔记语言输出一行 ≤40 字「何时查我」。
    // 红线：无 LLM / 未配置 / 笔记缺失 / 异常 / 8s 超时 → 一律 { error }（client 静默回退预填标题，草稿失败绝不阻断挂载）；
    //   草稿为低频用户主动触发，不进 llm-usage 计量（USAGE_FEATURES 三功能口径不动）。
    const WHEN_SUGGEST_TIMEOUT_MS = 8000
    disposers.push(handle('notes-when-suggest', async (args) => {
      try {
        if (!args || !args.id) return { error: 'notes-when-suggest 需要 id' }
        if (!llm) return { error: 'llm 不可用' }
        let n = null
        try { n = await loadNote(String(args.id)) } catch (e) { return { error: 'notes-when-suggest: 笔记不存在' } }
        if (!n || n.deleted || n.tombstoned) return { error: 'notes-when-suggest: 笔记不存在' }
        await loadSettings()
        const sel = resolveLlmSelection()
        if (!sel || !sel.provider || !sel.model) return { error: 'llm 未配置' }
        const excerpt = String(n.body || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
        const prompt = '笔记标题：' + String(n.title || '').replace(/[\r\n]+/g, ' ') + '\n\n笔记正文摘要：\n' + (excerpt || '（空）') + '\n\n请用笔记自身的语言，输出一行「何时查我」（whenToUse）：描述 Agent 在什么场景下应该查阅这条笔记。只输出这一行本身，不超过 40 字，不要解释、引号、结尾标点或换行。'
        let timer = null
        const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('when-suggest 超时（8s）')), WHEN_SUGGEST_TIMEOUT_MS); if (timer && typeof timer.unref === 'function') timer.unref() })
        let text = ''
        try {
          await Promise.race([(async () => {
            for await (const chunk of llm.stream({
              provider: sel.provider,
              model: sel.model,
              messages: [{
                id: 'when-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                role: 'user',
                content: [{ type: 'text', text: prompt }],
                source: { kind: 'user' }
              }],
              system: '你是笔记挂载助手，为笔记生成一行极简的「何时查我」使用场景说明。',
              temperature: 0
            })) {
              if (chunk && chunk.type === 'text-delta') text += chunk.text
              if (chunk && chunk.type === 'finish') break
            }
          })(), timeout])
        } finally { if (timer) clearTimeout(timer) }
        const one = Array.from(String(text || '').split('\n')[0].trim().replace(/^["'「」『』\s]+|["'「」『』。；;，,\.\s]+$/g, '')).slice(0, 40).join('')
        if (!one) return { error: 'llm 空输出' }
        return { ok: true, id: String(args.id), suggestion: one }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== when-suggest END ====

    // ==== conflict-check BEGIN ====（0.4.5-G 约定体检 notes-045-conflict-check：server.js 与 server.dist.js 本块逐字节一致，check 节 90 看守）
    // notes-conflict-check {} → LLM 对全部注入中约定（inject=true && injectRole=convention && !deleted && status!=='superseded'（0.4.7-A③））两两检测冲突/被取代对，返回 { ok, pairs:[{aId,bId,aTitle,bTitle,relation,reason}], total }。
    // 只提名不执行：本通道零写入——「标已取代」裁决动作由 client 走既有 notes-update status='superseded'；敏感笔记正文打码后才进 prompt（maskSensitiveBody，llm/conflict.js 内）；
    //   <2 条约定 → { ok, pairs: [] } 零 LLM 调用；LLM 不可用/未配置/超时（120s，0.4.7-A⑨）/输出非合法 JSON → { error }（client 内联回显，不阻断面板）。
    disposers.push(handle('notes-conflict-check', async (args) => {
      try { return await _conflictCheck(args || {}) } catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== conflict-check END ====

    // ==== vectors BEGIN ====（0.5.0① notes-050-vector-layer：语义检索向量层四条 RPC 通道——status/rebuild/search/put，③卡消费 search，④卡按钮调 rebuild，②卡浏览器回写 put）
    // notes-vectors-status {} → { ok, enabled, backend, indexed, indexable, lastBuiltAt, namespaces:[{backend,dim,minScore,count,lastBuiltAt}] }（N/M 篇·后端·上次构建·各命名空间统计）
    // notes-vectors-rebuild { backend } → 全量重建指定后端命名空间（换后端不重建、旧集保留）；backend 缺省回落激活后端。
    // notes-vectors-search { queryVector|query, backend, limit } → 余弦 + minScore 过滤 + per-note max-pooling（③卡消费；query 为内部 embed 便捷形态）
    // notes-vectors-put { backend, rows:[{noteId, bodyHash, vectors:[...]}], replace? } → 外部算好的向量经队列回写边车（②卡落通道；replace:true 全量重建清空目标命名空间；0.5.0 R3 起浏览器嵌入生产方退役，通道保留）
    disposers.push(handle('notes-vectors-status', async (args) => { try { return await _vectorsStatus() } catch (e) { return { error: String(e.message || e) } } }))
    disposers.push(handle('notes-vectors-rebuild', async (args) => { try { return await _vectorsRebuild(args && args.backend) } catch (e) { return { error: String(e.message || e) } } }))
    disposers.push(handle('notes-vectors-search', async (args) => { try { return await _vectorsSearch(args || {}) } catch (e) { return { error: String(e.message || e) } } }))
    disposers.push(handle('notes-vectors-put', async (args) => { try { return await _vectorsPut(args || {}) } catch (e) { return { error: String(e.message || e) } } }))
    // ==== vectors END ====
