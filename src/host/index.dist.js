    // 工具注册：主通道 = 全局 Builtin harness.defineTool + harness.registerTool（原 host-impl.js 姿势原样保留）；
    // 仅在 harness 缺失时回退到 ctx.tools.register（task-board 的服务路径）。两通道互斥，不会重复注册。
    function regTool(def) {
      if (harnessRef && typeof harnessRef.defineTool === 'function' && typeof harnessRef.registerTool === 'function') {
        const tool = harnessRef.defineTool(def)
        if (tool) { const d = harnessRef.registerTool(ctx, tool); if (typeof d === 'function') disposers.push(d) }
        return
      }
      if (tools && typeof tools.register === 'function') {
        const d = tools.register(defineTool(def))
        if (typeof d === 'function') disposers.push(d)
        return
      }
      console.error('notes: 无可用工具注册通道（harness / ctx.tools），工具未注册：' + (def && def.name))
    }

    const outSchema = { type: 'object', additionalProperties: true }
    function mkRender() {
      return (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    }

    // ---- 工具层：合并 9 个细粒度工具为 3 个（note_search / note_get / note_manage）
    // RPC 层保持 handler 不变（client panel 仍在用）；工具只面向 Agent，瘦身 schema。
    regTool({
      name: 'note_search',
      description: 'Search local notes by free-text query (matches title/body/topic/tags), with optional tag, topic, kind, folder, sensitive, and inject filters. When a query is given, each result carries a matches array telling which fields matched (title/tags/body — relevance: title > tags > body). Returns slim notes (no body) for fast triage — call note_get for the full body of a specific id. Default results EXCLUDE work logs (kind=log, stealth by design) — pass kind=log or includeLogs:true to recall them. Tip: when planning a task, picking an approach, or making decisions, consider searching this notes library first for related decisions, todos, and context recorded in earlier sessions — it may already contain the conclusions you need.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text query against title, body, topic, and tags. Omit to list all (optionally filtered by tag/topic/kind/folder/sensitive/inject).' },
          tag: { type: 'string', description: 'Optional tag filter (exact match)' },
          topic: { type: 'string', description: 'Optional topic filter (exact match)' },
          kind: { type: 'string', enum: KINDS, description: 'Optional kind filter: note/decision/todo/link/quote/log. Pass log to recall work logs (excluded by default).' },
          folder: { type: 'string', description: 'Optional folder filter: folder id or exact folder name; empty string = unfiled notes (未分类). Non-empty filter is a recursive subtree match — it returns notes in that folder AND all its descendant folders (folders nest via parent; maxFolderDepth setting, default 3).' },
          sensitive: { type: 'boolean', description: 'Optional sensitive filter: true = only sensitive (masked) notes, false = exclude sensitive notes. Omit = no filter.' },
          inject: { type: 'boolean', description: 'Optional inject filter: true = only notes injected into the system prompt, false = exclude injected notes. Omit = no filter.' },
          includeLogs: { type: 'boolean', description: 'Include work logs (kind=log) in results; default false (logs are stealth). kind=log implies inclusion.' },
          limit: { type: 'number', description: 'Optional max results (default 50)' }
        }
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        // folder 入参兼容 id 或名称（名称精确命中）；找不到直接报错，不写悬空引用
        let folder = args && args.folder
        if (folder !== undefined) {
          const rf = await resolveFolderRef(folder)
          if (!rf) return { error: '文件夹不存在：' + String(folder) }
          folder = rf.id
        }
        const all = await _search(args && args.query, args && args.tag, args && args.topic, args && args.kind, folder, { sensitive: args && args.sensitive, inject: args && args.inject, includeLogs: !!(args && args.includeLogs) })
        const limit = (args && args.limit) || 50
        return { count: all.length, notes: all.slice(0, limit).map(n => { const s = slim(n); if (n.matches) s.matches = n.matches; return s }) }
      }
    })

    regTool({
      name: 'note_get',
      description: 'Read the full body and metadata of a local note by id. Use after note_search to retrieve the body of an interesting result.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Note id' } },
        required: ['id']
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        try {
          const n = await _get(args.id)
          // 使用遥测（P2）：命中计数 +1（内存即时生效，60s 防抖批量落盘，见 use-telemetry 块）
          const uc = bumpUseCount(n.id)
          if (uc !== null) n.useCount = uc
          return { note: n }
        }
        catch (e) { return { error: String(e.message || e) } }
      }
    })

    regTool({
      name: 'note_manage',
      description: 'Single tool for create/list/update/delete/restore/archive. Pick an action and supply its required fields. The Agent should prefer this for any non-search CRUD: one tool means one decision point and one schema to learn.\n\n' +
        'Fields kind (what it is) and status (its lifecycle) are orthogonal: kind ∈ note/decision/todo/link/quote/log (default note); status ∈ active/pinned/resolved/superseded (default active). kind=log is a work log (工作日志): stealth by design — inject is force-disabled (hard gate, true is corrected with injectForcedOff in the response), recall defaults false, and logs are excluded from default list/search (pass kind=log or includeLogs:true to recall); put work logs in folder「工作日志」.\n' +
        'inject (boolean) controls whether the note is injected into the system prompt as context — an explicit field, NOT a tag. injectRole ("convention"|"reference", default "convention") picks the injection bucket: convention = user rules to follow; reference = background facts to consult only when relevant to the current task. Rule of thumb — infer from kind: decision/todo → convention, note/link/quote → reference. injectTo (string[]) is the injection scope, a multi-select list: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict the scope.\n\n' +
        'recall (boolean) controls whether the note appears in the notes catalog — a one-line-per-note index injected into the system prompt (right after conventions) so you know what the library holds without searching; default true. Set false to hide a note from the catalog (it stays searchable via note_search). Orthogonal to inject; notes with status resolved/superseded never appear in the catalog.\n\n' +
        'sensitive (boolean) marks the note as containing secrets (passwords/tokens/keys); default false. When true, injected text (conventions/catalog) masks secret-looking lines — keys and structure are kept, only values are hidden as ******（敏感，note_get <id> 获取）— so agents must call note_get for the original. Create/quick responses may return sensitiveSuggested: true when the body matches secret patterns; quick-capture notes are auto-flagged sensitive instead.\n\n' +
        'folder (string) assigns a note to a virtual folder: pass a folder id or an exact folder name; "" or omitted = unfiled (未分类). Folders (name/order/parent) are managed via the notes-folders RPC (list/create/rename/delete/reorder): folders NEST via a parent field (maxFolderDepth setting caps the depth, default 3, 0 = unlimited), any folder filter is a recursive subtree match (a folder includes notes in all its descendant folders), and deleting a folder that still has child folders or notes requires explicit cascade:true — the folder structure is removed for good while its notes are soft-deleted into the trash and can be restored (restored notes fall back to unfiled when their folder is gone).\n\n' +
        'Actions:\n' +
        '- create: { title, body, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive?, folder?, sessionId?, cwd?, workspace?, logDate? }\n' +
        '- list: { tag?, topic?, kind?, folder?, includeLogs? } (no id/title/body needed; default excludes kind=log work logs — pass kind=log or includeLogs:true)\n' +
        '- update: { id, title?, body?, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive? } (setting status to "resolved" auto-closes the dispatch loop: all open entries in the note\'s dispatches are marked dispatchStatus=done with doneAt — use this to report completion of a dispatched todo)\n' +
        '- move: { id, folder } (move note into a virtual folder — folders nest, so any folder id at any depth is valid; folder = folder id or exact folder name, "" = move out to unfiled)\n' +
        '- delete: { id } (soft delete; restorable via restore)\n' +
        '- restore: { id } (undo delete/archive)\n' +
        '- archive: { groups? } (explicit archive, undoable once via the notes-archive-undo RPC). groups = whitelist [{memberIds:[noteId,...], title?}]: merge exactly those groups (memberIds must all exist and not be deleted; title overrides the default group title). Without groups: merge ONLY quick-capture notes grouped by session. Behavior change: manual notes are NEVER auto-grouped by tag anymore — pass explicit groups to merge them (preview quick groups first via the notes-archive-preview RPC).\n' +
        '- dispatch: { id, targetSessionId?, targetSessionName?, instruction? } (assemble the todo context plus your instruction into one user message and send it to a live session as a real task; the handoff is recorded in the note\'s dispatches property with dispatchStatus=sent. Omit targetSessionId to list live sessions. Closed loop: when the target session reports completion via update status=resolved, open dispatches auto-flip to dispatchStatus=done; an idle transition of the target session also writes a receipt.)',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'update', 'move', 'delete', 'restore', 'archive', 'dispatch', 'debugws'], description: 'Action to perform' },
          // create / update 字段
          id: { type: 'string', description: 'Note id (required for update/delete/restore/dispatch)' },
          title: { type: 'string', description: 'Title (create/update)' },
          body: { type: 'string', description: 'Markdown body (create/update)' },
          topic: { type: 'string', description: 'Topic (create/update; defaults to 未分类)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags (create/update)' },
          kind: { type: 'string', enum: KINDS, description: 'Kind (create/update): note/decision/todo/link/quote/log; default note. log = work log (隐身：inject 强制关闭，recall 缺省 false，默认列表/搜索不含)' },
          status: { type: 'string', enum: STATUSES, description: 'Status (create/update): active/pinned/resolved/superseded; default active' },
          inject: { type: 'boolean', description: 'Inject into system prompt as context (create/update); default false. Setting inject=true permanently marks injectEver=true (sticky "ever injected" flag — later turning inject off never unsets it; injectEver is read-only and appears in list/get output).' },
          injectRole: { type: 'string', enum: ['convention', 'reference'], description: 'Injection role: convention=rules to follow | reference=background facts to consult as needed; default convention' },
          injectTo: { type: 'array', items: { type: 'string' }, description: 'Injection scope multi-select: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict' },
          recall: { type: 'boolean', description: 'Recall in the notes catalog index (create/update); default true. Set false to hide from the catalog (still searchable via note_search).' },
          sensitive: { type: 'boolean', description: 'Sensitive-content flag (create/update); default false. When true, injected text masks secret-looking lines (keys kept, values hidden as ******（敏感，note_get <id> 获取）); agents call note_get for the original.' },
          folder: { type: 'string', description: 'Virtual folder (create/move/list filter): folder id or exact folder name; "" = unfiled (未分类). Folders nest via parent (maxFolderDepth setting, default 3); a list filter matches the whole subtree recursively (notes in descendant folders included).' },
          // archive 字段（显式归档白名单）
          groups: { type: 'array', items: { type: 'object', properties: { memberIds: { type: 'array', items: { type: 'string' } }, title: { type: 'string' } }, required: ['memberIds'] }, description: 'Archive whitelist (archive action only): [{memberIds:[noteId,...], title?}] — merge exactly these groups. Omitted = merge only quick-capture groups; manual notes are NEVER auto-grouped by tag (behavior change).' },
          // dispatch 字段
          targetSessionId: { type: 'string', description: 'Dispatch target: a live session id (dispatch). Omit to list live sessions.' },
          targetSessionName: { type: 'string', description: 'Dispatch target display name (dispatch, optional)' },
          instruction: { type: 'string', description: 'Dispatch: your concrete instruction appended to the todo context (dispatch, optional)' },
          // list 字段
          tag: { type: 'string', description: 'Tag filter (list only)' },
          includeLogs: { type: 'boolean', description: 'Include work logs kind=log in list results (list only); default false. kind=log implies inclusion.' },
          // 高级（通常自动填充）
          sessionId: { type: 'string', description: 'Session id (advanced; usually auto-filled)' },
          cwd: { type: 'string', description: 'Working dir (advanced; usually auto-filled)' },
          workspace: { type: 'string', description: 'Workspace name (advanced; usually auto-filled)' },
          logDate: { type: 'string', description: 'Work-log date key YYYY-MM-DD local (create with kind=log only; defaults to today — omit normally)' }
        },
        required: ['action']
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        const action = args && args.action
        try {
          if (action === 'create') {
            if (!args.title || !args.body) return { error: 'note_manage.create 需要 title 和 body' }
            // folder 兼容 id 或名称（名称精确命中解析为 id）；找不到直接报错，不写悬空引用
            let folder = args.folder
            if (folder !== undefined) {
              const rf = await resolveFolderRef(folder)
              if (!rf) return { error: '文件夹不存在：' + String(folder) }
              folder = rf.id
            }
            const r = await _create(args.title, args.body, args.tags, args.topic, {
              sessionId: args.sessionId, cwd: args.cwd, workspace: args.workspace,
              kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo,
              folder: folder, recall: args.recall, sensitive: args.sensitive, logDate: args.logDate
            })
            const out = { action: 'create', id: r.id, topic: r.topic, kind: r.kind, status: r.status, message: 'Note created' }
            // 敏感模式自动识别建议透传（create 不强制落 sensitive，由调用方决策）
            if (r.sensitiveSuggested) { out.sensitiveSuggested = true; out.message += '（检测到疑似敏感信息，建议 sensitive: true 开启注入脱敏）' }
            // 日志隐身硬闸命中告知（kind=log 强制 inject=false、recall 缺省 false）
            if (r.injectForcedOff) { out.injectForcedOff = true; out.message += '（kind=log 日志默认隐身：inject 已强制关闭，日志不进系统提示/目录/默认列表与搜索）' }
            return out
          }
          if (action === 'list') {
            // folder 过滤：兼容 id 或名称；'' = 未分类
            let folder = args.folder
            if (folder !== undefined) {
              const rf = await resolveFolderRef(folder)
              if (!rf) return { error: '文件夹不存在：' + String(folder) }
              folder = rf.id
            }
            const notes = await _list(args.tag, args.kind, folder, undefined, !!args.includeLogs)
            return { action: 'list', count: notes.length, notes: notes.map(slim) }
          }
          if (action === 'move') {
            if (!args.id) return { error: 'note_manage.move 需要 id' }
            if (args.folder === undefined) return { error: 'note_manage.move 需要 folder（文件夹 id 或名称，空字符串 = 移出到未分类）' }
            const rf = await resolveFolderRef(args.folder)
            if (!rf) return { error: '文件夹不存在：' + String(args.folder) }
            await _update(args.id, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, rf.id)
            return { action: 'move', id: args.id, folder: rf.id, folderName: rf.name, message: rf.id ? '已移动到文件夹「' + rf.name + '」' : '已移出文件夹（未分类）' }
          }
          if (action === 'update') {
            if (!args.id) return { error: 'note_manage.update 需要 id' }
            const r = await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, undefined, args.recall, args.injectRole, args.sensitive)
            // P3 派发闭环：resolved 联动回执了派发时在消息里明示（agent 可感知闭环已发生）
            // 工作记忆 v0：kind=log 隐身硬闸命中时告知（inject 被强制关闭）
            return { action: 'update', id: args.id, kind: r.kind, status: r.status, dispatchClosed: r.dispatchClosed || 0, injectForcedOff: r.injectForcedOff === true, message: 'Note updated' + (r.dispatchClosed ? '；已自动回执 ' + r.dispatchClosed + ' 条派发（dispatchStatus→done）' : '') + (r.injectForcedOff ? '（kind=log 日志默认隐身：inject 已强制关闭）' : '') }
          }
          if (action === 'delete') {
            if (!args.id) return { error: 'note_manage.delete 需要 id' }
            await _delete(args.id)
            return { action: 'delete', id: args.id, message: 'Note deleted (soft)' }
          }
          if (action === 'restore') {
            if (!args.id) return { error: 'note_manage.restore 需要 id' }
            await _restore(args.id)
            return { action: 'restore', id: args.id, message: 'Note restored' }
          }
          if (action === 'archive') {
            // 显式归档：groups 白名单优先；无 groups 只合速记组（行为变更：手动笔记不再自动分组）
            const r = await _archive({ groups: args.groups })
            return { action: 'archive', merged: r.merged, mergedIds: r.mergedIds, groups: r.groups, message: 'Archived ' + r.merged + ' groups' }
          }
          if (action === 'debugws') {
            // dump 指定会话（args.sessionId=short id）的 title 事件历史 + fold 结果
            if (args.sessionId) {
              const hs = await sessionPersistence.list()
              const h = hs.map(snapHeader).find(x => x && shortSid(x.id) === args.sessionId)
              if (!h) return { error: '会话不存在: ' + args.sessionId }
              const insp = await sessionPersistence.inspect(h.id)
              const evs = (insp && insp.events) || []
              const titleEvs = []
              for (const ev of evs) { if (ev && ev.type === 'session/title') titleEvs.push({ seq: ev.seq, title: ev.data && ev.data.title, source: ev.data && ev.data.source && ev.data.source.kind }) }
              const live = agents && agents.get ? agents.get(h.id) : undefined
              let stTitle = '(not live)'
              if (live) { try { const s = sessionTitle.get(live.session); stTitle = s && s.title } catch (e) { stTitle = 'ERR' } }
              return { action: 'debugws', sessionShort: args.sessionId, live: !!live, parent: h.parentSession ? shortSid(h.parentSession) : '', sessionTitleGet: stTitle, titleEvents: titleEvs }
            }
            // 默认：对比 工作区 sessionIds（左侧列表数据源）vs sessionPersistence.list()（所有持久化），确认"已关闭"会话的差异
            const wl = (workspaceRegistry && workspaceRegistry.list) ? workspaceRegistry.list() : []
            const archivedSet = {}
            try { const arch = workspaceRegistry && workspaceRegistry.archivedSessionIds; if (Array.isArray(arch)) { for (const id of arch) archivedSet[id] = true } } catch (e) {}
            const wsInfo = []
            let totalInWs = 0, archivedInWs = 0
            for (const w of wl) {
              let sids = []
              try { sids = w.sessionIds || [] } catch (e) {}
              const cnt = Array.isArray(sids) ? sids.length : 0
              totalInWs += cnt
              const archCnt = Array.isArray(sids) ? sids.filter(s => archivedSet[s]).length : 0
              archivedInWs += archCnt
              wsInfo.push({ title: w.title, sessionCount: cnt, archivedInIt: archCnt })
            }
            let totalPersist = 0
            try { const hs = await sessionPersistence.list(); totalPersist = hs.length } catch (e) {}
            return {
              action: 'debugws',
              hasInspect: typeof sessionPersistence.inspect,
              hasStat: typeof sessionPersistence.stat,
              totalPersist: totalPersist,
              totalInWorkspaces: totalInWs,
              archivedInWorkspaces: archivedInWs,
              archivedSetSize: Object.keys(archivedSet).length,
              workspaces: wsInfo
            }
          }
          if (action === 'dispatch') {
            if (!args.id) return { error: 'note_manage.dispatch 需要 id' }
            if (!args.targetSessionId) {
              // 未指定目标：返回当前活跃主会话列表（含名字）供 agent 选择（_activeSessions 新形态：取 .sessions）
              const list = (await _activeSessions()).sessions.map(s => ({ sessionId: s.id, short: s.short, name: s.name, workspace: s.workspace }))
              return { action: 'dispatch', needTarget: true, activeSessions: list, message: '请用 targetSessionId 指定目标活跃会话' }
            }
            const r = await _dispatch(args.id, { sessionId: args.targetSessionId, sessionName: args.targetSessionName, instruction: args.instruction, mode: 'existing' })
            if (r.error) return { error: r.error }
            return { action: 'dispatch', id: args.id, sessionId: r.sessionId, message: '已派发到「' + r.sessionName + '」' + (args.instruction ? '（含具体要求）' : '') }
          }
          return { error: 'note_manage: 未知 action：' + String(action) + '（期望 create/list/update/move/delete/restore/archive/dispatch）' }
        } catch (e) { return { error: String(e.message || e) } }
      }
    })

    // ---- 一次性数据迁移：开发版 D:\...\dsh-notes-plugin\notes → ~/.dsh/notes ----
    // 触发：目标目录缺失该 .md 时逐文件复制（幂等、不覆盖已存在的目标文件、不删除源目录）。
    // 走 ctx.fs 服务（而非 node:fs），保证写盘受 sandboxPolicy 管束，单测里也只落在内存 mock。
    async function listMd(dir) {
      try {
        const target = await fs.resolve(dir)
        const info = await fs.stat(target)
        if (!info) return []
        const entries = await fs.listDir(target)
        return (entries || []).map(e => e && e.name).filter(n => n && /\.md$/i.test(n))
      } catch (e) { return [] }
    }
    async function migrateLegacyNotes() {
      try {
        // 图片资产连带迁移（同名跳过）：即使无旧 .md 也执行（开发版可能只攒下 assets）
        const assetsMigrated = await copyAssetsDir(LEGACY_NOTES_DIR, NOTES_ROOT, true)
        if (assetsMigrated > 0) console.log('notes: migrated ' + assetsMigrated + ' legacy asset(s) → ' + path.join(NOTES_ROOT, 'assets'))
        const legacyNames = await listMd(LEGACY_NOTES_DIR)
        if (legacyNames.length === 0) return { migrated: 0, assetsMigrated: assetsMigrated, skipped: 'no-legacy-notes' }
        const existing = {}
        for (const n of await listMd(NOTES_ROOT)) existing[n] = true
        let migrated = 0
        for (const name of legacyNames) {
          if (existing[name]) continue
          try {
            const src = await fs.resolve(path.join(LEGACY_NOTES_DIR, name))
            const dst = await fs.resolve(path.join(NOTES_ROOT, name))
            const content = await fs.readText(src)
            await fs.writeText(dst, content, undefined, undefined, getPolicy())
            migrated++
          } catch (e) { console.error('notes: migrate failed', name, e) }
        }
        if (migrated > 0) console.log('notes: migrated ' + migrated + ' legacy note(s) → ' + NOTES_ROOT)
        return { migrated: migrated, total: legacyNames.length, assetsMigrated: assetsMigrated }
      } catch (e) {
        console.error('notes: legacy migration error', e)
        return { migrated: 0, error: String(e && e.message || e) }
      }
    }
    let migrationDone = migrateLegacyNotes()
    // 设置启动加载（不阻塞 apply 返回）：classifyTopic/extractInstruction/notes-settings-get 内部 await 同一 promise 保证就绪
    loadSettings()
    // 用量统计启动加载（同口径不阻塞）：recordUsage 记账前内部也会 await loadUsage()，双保险防覆盖存量
    loadUsage()

    // 存量一次性修补：agents 未就绪期创建的笔记 workspace 为空，导致“本工作区”注入范围严格匹配后永不命中。
    // 启动时按来源会话推导补填一次（只补空值）。注意：不用 _list()（它 await migrationDone，会与本补全死锁），
    // 直接走底层遍历；也不挂进 migrationDone 链——_list 只需等 legacy 迁移，补全异步自跑即可。
    const legacyDone = migrationDone
    async function fixLegacyWorkspaces() {
      try { await legacyDone } catch (e) {}
      try {
        const dirTarget = await fs.resolve(NOTES_DIR)
        const info = await fs.stat(dirTarget)
        if (!info) return { fixed: 0 }
        const entries = await fs.listDir(dirTarget)
        let fixed = 0
        let skipped = 0
        for (const entry of entries) {
          if (!entry.name || !entry.name.endsWith('.md')) continue
          const id = entry.name.replace(/\.md$/, '')
          try {
            const n = await loadNote(id)
            if (n.deleted || n.workspace) continue
            const ws = await _wsOfSession(n.sessionId)
            if (!ws) { skipped++; console.log('notes: workspace backfill skip ' + id + ' (sid=' + (n.sessionId || 'none') + ', 推导不到 cwd)') ; continue }
            await persistNote(Object.assign({}, n, { workspace: ws }))
            fixed++
          } catch (e) { skipped++; console.error('notes: workspace backfill item failed', id, e) }
        }
        console.log('notes: workspace backfill done, fixed=' + fixed + ' skipped=' + skipped)
        return { fixed: fixed }
      } catch (e) { console.error('notes: workspace backfill error', e); return { fixed: 0, error: String(e && e.message || e) } }
    }
    fixLegacyWorkspaces()

    ctx.effect(() => () => {
      for (const d of disposers) { try { d() } catch (e) {} }
      flushUseCounts()   // 卸载 flush：防抖窗口内未落盘的 useCount 立即写盘（fire-and-forget，不阻塞卸载）
      flushUsage()       // 卸载 flush：usage.json 防抖窗口内未落盘的 token 计数立即写盘（同上 fire-and-forget）
    })
    // 发布版不再写 .last-host-load 开发心跳（静态包 import 即就绪，无需引导壳自检）
    console.log('notes plugin: host ready (static pkg), notes dir =', NOTES_ROOT, ', llm =', !!llm, ', adm =', !!adm, ', rpc =', RPC_PATH, ', app =', APP_PAGE_ROUTE, ', asset =', ASSET_ROUTE)
}

