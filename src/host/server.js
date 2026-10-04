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
    function handle(name, fn) {
      return harness.handle(name, async (args) => {
        const t0 = Date.now()
        try { return await fn(args) }
        finally { perfStats.rpc[name] = (perfStats.rpc[name] || 0) + 1; perfStats.rpcMs[name] = (perfStats.rpcMs[name] || 0) + (Date.now() - t0); writePerfReport() }
      })
    }
    disposers.push(handle('notes-perf', async (args) => { if (args && args.perf) perfStats.client = args.perf; return { ok: true } }))
    // P1 回收站：args.includeDeleted=true 时含软删除笔记（缺省排除）；tag/kind/folder 过滤口径不变
    // 工作记忆 v0：args.includeLogs=true 时含 kind=log 日志（缺省排除——默认隐身；筛选中心 kind=日志 专入口由 client 传此参数）；
    // R-6：args.folder 显式给出（含 '' 未分类）时隐式含日志（_list effLogs 承接——显式文件夹导航放行，四个隐式表面隐身不变）
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
      try { const n = args && args.includeDeleted ? await _getDeleted(args.id) : await _get(args.id); const s = slim(n); s.body = n.body; return { note: s } } catch (e) { return { error: String(e.message || e) } }
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
        return await _create(args.title, args.body, args.tags, args.topic, { kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo, folder: args.folder, recall: args.recall, sensitive: args.sensitive, logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt, contractType: args.contractType, origin: args.origin, schedule: args.schedule })
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // R-1：confirmClearBody 透传 _update 空正文覆盖兜底闸（body:'' 覆盖非空正文需显式确认，见 notes.js empty-body-overwrite-guard 块）
    disposers.push(handle('notes-update', async (args) => {
      try {
        const ctErr = schedPublicContractTypeError(args && args.contractType)   // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule）
        if (ctErr) return { error: ctErr }
        return await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, args.folder, args.recall, args.injectRole, args.sensitive, { logDate: args.logDate, entities: args.entities, summarizedAt: args.summarizedAt, contractType: args.contractType, origin: args.origin, schedule: args.schedule, confirmClearBody: args.confirmClearBody === true })
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
