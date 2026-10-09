    function regTool(def) {
      const tool = harness.defineTool(def)
      if (tool) disposers.push(harness.registerTool(ctx, tool))
    }

    const outSchema = { type: 'object', additionalProperties: true }
    function mkRender() {
      return (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    }

    // ---- 工具层：合并 9 个细粒度工具为 3 个（note_search / note_get / note_manage）
    // RPC 层保持 12 个 handler 不变（client panel 仍在用）；工具只面向 Agent，瘦身 schema。
    regTool({
      name: 'note_search',
      description: 'Search local notes by free-text query (matches title/body/topic/tags), with optional tag, topic, kind, folder, sensitive, and inject filters. When a query is given, each result carries a matches array telling which fields matched (title/tags/body — relevance: title > tags > body) and may carry an excerpt {text, marks:[{start,len}]} — keyword body hits: a ±50-char window around the first hit with hit ranges (offsets relative to excerpt text); semantic hits: the winning chunk opening (~80 chars, marks empty); title/tag-only hits: the body opening (~80 chars). Returns slim notes (no body) for fast triage — call note_get for the full body of a specific id. Work logs (kind=log) are first-class: default results INCLUDE them (visible/searchable/editable like any note) — pass kind=log to see only work logs; injection is hard-disabled for logs (no toggle, host-enforced). Machine-managed sys notes (kind=sys: inject index, memory archives「记忆档案」, telemetry mirror) are excluded from default unfiltered results — pass kind=sys (or a tag/folder filter) to see them. Dispatch execution-record companion notes「执行记录 · <源标题>」(0.4.4-A) are kind=log in folder「执行记录」— first-class visible/searchable/editable like other logs, injection hard-disabled, maintained by the dispatch pipeline (do not manually clean up). Semantic search (0.5.0): when enabled, results fuse text matching with semantic (vector) recall via RRF — notes may be returned even without keyword overlap, and such semantically-matched notes carry "semantic": true (a 语义 badge in the UI). Tip: when planning a task, picking an approach, or making decisions, consider searching this notes library first for related decisions, todos, and context recorded in earlier sessions — it may already contain the conclusions you need.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text query against title, body, topic, and tags. Omit to list all (optionally filtered by tag/topic/kind/folder/sensitive/inject).' },
          tag: { type: 'string', description: 'Optional tag filter (exact match)' },
          topic: { type: 'string', description: 'Optional topic filter (exact match) — DEPRECATED legacy field (0.4.8: the topic concept was merged into tags; prefer the tag filter)' },
          kind: { type: 'string', enum: KINDS, description: 'Optional kind filter: note/decision/todo/link/quote/log/sys. Pass log to see only work logs; pass sys to see machine-managed notes (excluded from default unfiltered results).' },
          folder: { type: 'string', description: 'Optional folder filter: folder id or exact folder name; empty string = unfiled notes (未分类). Non-empty filter is a recursive subtree match — it returns notes in that folder AND all its descendant folders (folders nest via parent; maxFolderDepth setting, default 3).' },
          sensitive: { type: 'boolean', description: 'Optional sensitive filter: true = only sensitive (masked) notes, false = exclude sensitive notes. Omit = no filter.' },
          inject: { type: 'boolean', description: 'Optional inject filter: true = only notes injected into the system prompt, false = exclude injected notes. Omit = no filter.' },
          includeLogs: { type: 'boolean', description: 'Backward-compatible no-op: work logs (kind=log) are first-class and always included since 0.4.3; the parameter is still accepted but no longer changes results.' },
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
        const all = await _searchFused(args && args.query, args && args.tag, args && args.topic, args && args.kind, folder, { sensitive: args && args.sensitive, inject: args && args.inject, includeLogs: !!(args && args.includeLogs) })
        const limit = (args && args.limit) || 50
        const page = all.slice(0, limit)
        _recallHit('search', page.map(function (n) { return n.id }))   // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：search 通道交付=工具实际返回页（与 notes-search RPC 同口径日聚合）
        return { count: all.length, notes: page.map(n => { const s = slim(n); if (n.matches) s.matches = n.matches; if (n.semantic) s.semantic = true; if (n.excerpt) s.excerpt = n.excerpt; return s }) }
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
          // 使用遥测（P2 → 0.4.3 验收修复⑧收编 facet）：命中计数 +1（内存视图即时生效；facet 复用遥测 2s 防抖落 telemetry.json，
          //   不再重写笔记 .md——热路径写放大消除，见 use-telemetry 块）
          const uc = bumpUseCount(n.id)
          // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：note_get 工具取用信号（与 notes-get RPC 同通道日聚合）；
          //   卡⑧起与 bumpUseCount 共用遥测 2s 防抖单定时器（facets.use 总计 + byDay.get 日明细分记账，同盘同 flush）
          _recallHit('get', [n.id])
          if (uc !== null) n.useCount = uc
          return { note: n }
        }
        catch (e) { return { error: String(e.message || e) } }
      }
    })

    regTool({
      name: 'note_manage',
      description: 'Single tool for create/list/update/delete/restore/archive. Pick an action and supply its required fields. The Agent should prefer this for any non-search CRUD: one tool means one decision point and one schema to learn.\n\n' +
        'Fields kind (what it is) and status (its lifecycle) are orthogonal: kind ∈ note/decision/todo/link/quote/log (default note); status ∈ active/pinned/resolved/superseded (default active). kind=log is a work log (工作日志): first-class in list/search/edit (visible by default) — inject is force-disabled (hard gate, true is corrected with injectForcedOff in the response) and recall defaults false (the recall field is deprecated — see below); put work logs in folder「工作日志」.\n' +
        'inject (boolean) controls whether the note is injected into the system prompt as context — an explicit field, NOT a tag. injectRole ("convention"|"reference", default "convention") picks the injection bucket: convention = user rules to follow; reference = background facts to consult only when relevant to the current task. Rule of thumb — infer from kind: decision/todo → convention, note/link/quote → reference. injectTo (string[]) is the injection scope, a multi-select list: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict the scope.\n\n' +
        'recall (boolean, default true) is a DEPRECATED compatibility field (deprecated since 0.4.5-A, write side retired): it used to control the notes catalog index (a one-line-per-note flat library listing injected into the system prompt), which was removed entirely in 0.4.4-E — the injected directory section now carries mounted index lines only (a note enters it solely via an explicit mount in the injection index). The argument is still accepted for backward compatibility and existing front-matter recall lines are still parsed (存量行保留不迁移、读侧兼容), but new writes no longer persist the field to disk and it has no effect on injection; every note stays searchable via note_search regardless.\n\n' +
        'sensitive (boolean) marks the note as containing secrets (passwords/tokens/keys); default false. When true, injected text (conventions) masks secret-looking lines — keys and structure are kept, only values are hidden as ******（敏感，note_get <id> 获取）— so agents must call note_get for the original. Create/quick responses may return sensitiveSuggested: true when the body matches secret patterns; quick-capture notes are auto-flagged sensitive instead.\n\n' +
        'hidden (boolean, default false) is the OS-style hidden attribute (0.4.4-D): hidden notes are masked out of the notes panel tree/lists only — a pure client-side UI filter governed by the panel「显示隐藏」toggle (localStorage-persisted). Agents and all read/write paths are UNAFFECTED: note_search/note_get/note_manage see hidden notes exactly like normal ones, and opening a hidden note via backlink/dispatch/search hit renders and edits normally. Folders carry the same flag via the notes-folders RPC op:\'set-flags\' { id, hidden } (a hidden folder masks its row and its nested subtree from the tree).\n\n' +
        'folder (string) assigns a note to a virtual folder: pass a folder id or an exact folder name — a name is normalized to its folder id on write, and an unknown id/name is rejected with an error (never silently filed as unfiled); "" or omitted = unfiled (未分类). Folders (name/order/parent/hidden) are managed via the notes-folders RPC (list/create/rename/delete/reorder/set-flags): folders NEST via a parent field (maxFolderDepth setting caps the depth, default 3, 0 = unlimited), any folder filter is a recursive subtree match (a folder includes notes in all its descendant folders), and deleting a folder that still has child folders or notes requires explicit cascade:true — the folder structure is removed for good while its notes are soft-deleted into the trash and can be restored (restored notes fall back to unfiled when their folder is gone).\n\n' +
        'topic (string) is DEPRECATED since 0.4.8 — the topic concept was merged into tags: on create/update an explicit non-empty topic (≠ 未分类) is merged into tags (deduped) and the stored topic is cleared on write (lazy write-side migration; existing .md files are NEVER batch-rewritten). Reads treat tags ∪ {topic} as effective tags (effTags, panel/app sidebar tag tree). Prefer tags for all new writes.\n\n' +
        'Actions:\n' +
        '- create: { title, body, topic? (deprecated → merged into tags), tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive?, hidden?, folder?, sessionId?, cwd?, workspace?, logDate? }\n' +
        '- list: { tag?, topic?, kind?, folder?, includeLogs? } (no id/title/body needed; work logs kind=log are first-class and included by default — includeLogs is a kept no-op for backward compatibility; machine notes kind=sys are excluded from the default unfiltered list — pass kind:\'sys\', tag, or folder to see them)\n' +
        '- update: { id, title?, body?, topic? (deprecated → merged into tags + cleared), tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, sensitive?, hidden?, confirmClearBody? } (setting body to "" while the stored body is non-empty is REJECTED unless confirmClearBody:true — R-1 data-loss guard against silent empty-body overwrite; setting status to "resolved" auto-closes the dispatch loop: all open entries in the note\'s dispatches are marked dispatchStatus=done with doneAt — kept as a manual fallback（手动兜底）to force-close the loop; since 0.4.5-I dispatched todos no longer ask the target session to resolve the note — the target session\'s idle transition closes the receipt automatically)\n' +
        '- move: { id, folder } (move note into a virtual folder — folders nest, so any folder id at any depth is valid; folder = folder id or exact folder name, "" = move out to unfiled)\n' +
        '- delete: { id } (soft delete; restorable via restore)\n' +
        '- restore: { id } (undo delete/archive)\n' +
        '- archive: { groups? } (explicit archive, undoable once via the notes-archive-undo RPC). groups = whitelist [{memberIds:[noteId,...], title?}]: merge exactly those groups (memberIds must all exist and not be deleted; title overrides the default group title). Without groups: merge ONLY quick-capture notes grouped by session. Behavior change: manual notes are NEVER auto-grouped by tag anymore — pass explicit groups to merge them (preview quick groups first via the notes-archive-preview RPC).\n' +
        '- dispatch: { id, targetSessionId?, targetSessionName?, instruction? } (assemble the todo context plus your instruction into one user message and send it to a live session as a real task — or, when the target session is dormant (not live but persisted), queue it into the session\'s durable inbox with ZERO wake: it is delivered and processed on the session\'s next activity (the dispatch record carries queued:true in that case — 0.4.4-B); the handoff is recorded in the note\'s dispatches property with dispatchStatus=sent, and a 📤 line is appended to the note\'s lazily-created execution-log companion note「执行记录 · <标题>」(kind=log in folder「执行记录」— injection hard-disabled, visible/searchable/editable as usual; soft-linked via schedule.runLog for schedule conventions / top-level runLog field otherwise — 0.4.4-A 三表归一). Omit targetSessionId to list dispatchable sessions (live flag per entry — live:false entries are dormant and get queued delivery). Closed loop: closed via idle-transition receipt of the target session — an idle transition auto-flips that session\'s open dispatches to dispatchStatus=done and writes the receipt (dormant queued deliveries close the same way on next-activity idle, zero wake 零唤醒排队同理); update status=resolved remains available as a manual fallback（手动兜底）that force-closes all open dispatches of the note — since 0.4.5-I dispatch messages no longer instruct the target session to resolve the note.)\n' +
        'Scheduled dispatch (定时派发·约定即调度): create/update a convention note with contractType: \'dispatch-schedule\' + schedule: { at | every, target, action?, enabled?, anchor?, dow?, provider?, model?, preset? } — the host runs a resident 30s cron; when due it auto-dispatches the note body to the target session via the standard dispatch chain (source labeled 定时调度 @标题, receipts accumulate in dispatches as usual, and a lazily-created execution-log note「执行记录 · @标题」is soft-linked via schedule.runLog — shared with manual dispatches of the same note (dispatch 📤 lines + receipt 📥/✅ lines land in one note) — the convention body itself is NEVER appended to (it is the dispatch payload; history would bloat and pollute future dispatch contexts). Declaration red lines (enforced at write): exactly one of at (LOCAL ISO time WITHOUT timezone suffix, e.g. 2026-10-05T09:00 — must be future; Z/±offset suffix is rejected because the declaration is pinned to the host machine local timezone) / every (\'30m\'/\'12h\'/\'3d\'/\'1w\' or ms, >= 5min); anchor: \'HH:MM\' LOCAL wall-clock time (periodic mode only, requires a whole-day interval — pins the firing sequence to that local time: first fire = next anchor time, later fires stay on that time of day without drifting from creation/fire time; declarations WITHOUT anchor keep the legacy pure-interval semantics anchored at lastFiredAt||declaredAt||createdAt — zero migration); dow: 0-6 integer (weekly mode only, 0=Sunday, requires every:\'1w\' + anchor); target session must exist in a workspace and not be archived — OR the reserved literal target: \'new\' (periodic mode only — 0.4.4-B dedicated session: the first fire auto-creates a session named 定时 · <title> in the note\'s workspace, writes schedule.target back to the new sid, and every later round reuses that session via live-send or dormant queued delivery); model/provider: optional dedicated-session model pair (0.4.6-G — declare BOTH or NEITHER, non-empty strings; on target:\'new\' first fire they are passed to agents.create agentOptions, overriding the host default model selection — omitted = host default, zero migration; validity is NOT probed at declaration time, an invalid pair surfaces as schedule.lastError at fire time); preset: optional dedicated-session permission preset (0.4.7 — exactly \'danger-full-access\' | \'workspace-write\', no inherit; on target:\'new\' first fire it is applied via permissionPresets.set right after agents.create, overriding the host-pinned default preset — omitted = host default, zero migration; unknown values rejected at the write gate; service absent or set failure = schedule.lastError note, dispatch never blocked); unknown keys rejected. Machine state (lastFiredAt/lastRun{at,status(sent|queued|error),receiptId}/lastError/runLog/declaredAt) is host-managed in front-matter — reads via note_get, never write it by hand. Un-declare with contractType: \'\' + schedule: null.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'update', 'move', 'delete', 'restore', 'archive', 'dispatch', 'debugws'], description: 'Action to perform' },
          // create / update 字段
          id: { type: 'string', description: 'Note id (required for update/delete/restore/dispatch)' },
          title: { type: 'string', description: 'Title (create/update)' },
          body: { type: 'string', description: 'Markdown body (create/update)' },
          confirmClearBody: { type: 'boolean', description: 'Explicit confirmation (update only): required when setting body to "" while the stored body is non-empty — R-1 data-loss guard rejects silent empty-body overwrite without it.' },
          topic: { type: 'string', description: 'DEPRECATED since 0.4.8 (topic merged into tags): an explicit non-empty value (≠ 未分类) is merged into tags (deduped) and the stored topic is cleared; field kept for backward compatibility — prefer tags. Default 未分类' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags (create/update)' },
          kind: { type: 'string', enum: KINDS, description: 'Kind (create/update): note/decision/todo/link/quote/log/sys; default note. log = work log（同权：默认列表/搜索可见可编辑；inject 强制关闭，recall 缺省 false 注入目录恒不含）; sys = 机器托管笔记（缺省列表/检索降噪排除，显式 kind=sys/tag/folder 过滤可见——一般由系统内部创建，手写请改用其他 kind）' },
          status: { type: 'string', enum: STATUSES, description: 'Status (create/update): active/pinned/resolved/superseded; default active' },
          inject: { type: 'boolean', description: 'Inject into system prompt as context (create/update); default false. Setting inject=true permanently marks injectEver=true (sticky "ever injected" flag — later turning inject off never unsets it; injectEver is read-only and appears in list/get output).' },
          injectRole: { type: 'string', enum: ['convention', 'reference'], description: 'Injection role: convention=rules to follow | reference=background facts to consult as needed; default convention' },
          injectTo: { type: 'array', items: { type: 'string' }, description: 'Injection scope multi-select: [] or omitted=all sessions (default), or session short-ids like ["99f2b674","7f8b49e6"] to restrict' },
          recall: { type: 'boolean', description: 'DEPRECATED compatibility field (create/update); default true. The catalog index it once fed was removed in 0.4.4-E (directory section = mounted lines only); since 0.4.5-A the write side is retired — the argument is still accepted and existing front-matter recall lines are still parsed (read-compatible), but new writes no longer persist the field and it has no injection effect; notes stay searchable via note_search regardless.' },
          sensitive: { type: 'boolean', description: 'Sensitive-content flag (create/update); default false. When true, injected text masks secret-looking lines (keys kept, values hidden as ******（敏感，note_get <id> 获取）); agents call note_get for the original.' },
          hidden: { type: 'boolean', description: 'Hidden flag (create/update); default false. Pure UI mask (0.4.4-D): hidden notes are filtered from the panel tree/lists only when the「显示隐藏」toggle is off; search/get/agent faces are unaffected. Folders: notes-folders RPC op:\'set-flags\' { id, hidden }.' },
          folder: { type: 'string', description: 'Virtual folder (create/move/list filter): folder id or exact folder name (a name is normalized to its id on write; unknown id/name is rejected); "" = unfiled (未分类). Folders nest via parent (maxFolderDepth setting, default 3); a list filter matches the whole subtree recursively (notes in descendant folders included).' },
          // 定时派发·执行层（dispatch-schedule 声明字段；公共写入口 contractType 白名单 '' / dispatch-schedule）
          contractType: { type: 'string', description: 'Contract type (create/update): public writes allow only \'dispatch-schedule\' (scheduled-dispatch convention, must pair with schedule) or \'\' to clear; other contract types are system-managed' },
          schedule: { type: ['object', 'null'], description: 'Scheduled-dispatch declaration (create/update; requires contractType=\'dispatch-schedule\'): { at?: LOCAL ISO time WITHOUT timezone suffix, e.g. 2026-10-05T09:00 (one-shot, must be future; Z/±offset rejected) | every?: \'30m\'/\'12h\'/\'3d\'/\'1w\' or ms (>=5min), anchor?: \'HH:MM\' LOCAL time (periodic only, whole-day interval; pins firing to that time of day, no drift), dow?: 0-6 (weekly only, 0=Sunday, requires every:\'1w\' + anchor), target: sessionId (workspace session, not archived) or \'new\' (periodic only: auto-create a dedicated 定时 · <title> session on first fire, then reuse it — 0.4.4-B), action?: \'dispatch\', enabled?: boolean, provider?: + model?: dedicated-session model pair (0.4.6-G: BOTH or NEITHER, non-empty strings; passed to agents.create agentOptions on first-fire creation of a target:\'new\' session, overriding the host default selection; not probed at declaration time — invalid pair surfaces as lastError at fire time), preset?: \'danger-full-access\' | \'workspace-write\' (0.4.7: dedicated-session permission preset — applied via permissionPresets.set right after agents.create on target:\'new\' first-fire creation, overriding the host-pinned default preset; omitted = host default, zero migration for existing declarations; unknown values rejected at the write gate; service absent/failure degrades to schedule.lastError, never blocks dispatch) }. Host-managed machine fields lastFiredAt/lastRun/lastError/runLog/declaredAt are preserved across declaration edits (declaredAt = declaration anchor timestamp, refreshed only when declaration fields at/every/anchor/dow/target/action/enabled/model/provider/preset change — periodic due-anchor is lastFiredAt||declaredAt||createdAt; runLog = soft-link id of the lazily-created execution-log note; pass an existing note id to relink, \'\' to unlink). null clears the declaration (pair with contractType: \'\').' },
          // archive 字段（显式归档白名单）
          groups: { type: 'array', items: { type: 'object', properties: { memberIds: { type: 'array', items: { type: 'string' } }, title: { type: 'string' } }, required: ['memberIds'] }, description: 'Archive whitelist (archive action only): [{memberIds:[noteId,...], title?}] — merge exactly these groups. Omitted = merge only quick-capture groups; manual notes are NEVER auto-grouped by tag (behavior change).' },
          // dispatch 字段
          targetSessionId: { type: 'string', description: 'Dispatch target: a live session id, or a dormant (persisted) session id — dormant targets are queued into the durable inbox and delivered on the session\'s next activity without waking it (0.4.4-B). Omit to list dispatchable sessions (live flag per entry).' },
          targetSessionName: { type: 'string', description: 'Dispatch target display name (dispatch, optional)' },
          instruction: { type: 'string', description: 'Dispatch: your concrete instruction appended to the todo context (dispatch, optional)' },
          // list 字段
          tag: { type: 'string', description: 'Tag filter (list only)' },
          includeLogs: { type: 'boolean', description: 'Backward-compatible no-op (list only): work logs kind=log are first-class and included by default since 0.4.3.' },
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
            // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule；其余契约类型系统内部管理）
            const ctErr0 = schedPublicContractTypeError(args.contractType)
            if (ctErr0) return { error: ctErr0 }
            // folder 兼容 id 或名称（名称精确命中解析为 id）；找不到直接报错，不写悬空引用
            let folder = args.folder
            if (folder !== undefined) {
              const rf = await resolveFolderRef(folder)
              if (!rf) return { error: '文件夹不存在：' + String(folder) }
              folder = rf.id
            }
            // 0.4.8（notes-048-topic-tag-merge）：显式 topic 入参并入 tags（写侧惰性落盘；空/未分类/分类中占位透传不动——分类中占位永不成标签）
            const tmC = topicMergeWrite(args.tags, args.topic)
            const r = await _create(args.title, args.body, tmC ? tmC.tags : args.tags, tmC ? '' : args.topic, {
              sessionId: args.sessionId, cwd: args.cwd, workspace: args.workspace,
              kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo,
              folder: folder, recall: args.recall, sensitive: args.sensitive, hidden: args.hidden, logDate: args.logDate, contractType: args.contractType, schedule: args.schedule
            })
            const out = { action: 'create', id: r.id, topic: r.topic, kind: r.kind, status: r.status, message: 'Note created' }
            if (tmC) { out.topicMerged = true; out.message += '（topic 已并入 tags：合并去重落盘，topic 字段已清空——0.4.8 懒合并）' }
            // 敏感模式自动识别建议透传（create 不强制落 sensitive，由调用方决策）
            if (r.sensitiveSuggested) { out.sensitiveSuggested = true; out.message += '（检测到疑似敏感信息，建议 sensitive: true 开启注入脱敏）' }
            // 日志隐身硬闸命中告知（kind=log 强制 inject=false、recall 缺省 false）
            if (r.injectForcedOff) { out.injectForcedOff = true; out.message += '（kind=log 工作日志不参与注入：inject 已强制关闭——日志同权可见/可搜/可编辑）' }
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
            // 定时派发：公共写入口 contractType 白名单（'' / dispatch-schedule；其余契约类型系统内部管理）
            const ctErr1 = schedPublicContractTypeError(args.contractType)
            if (ctErr1) return { error: ctErr1 }
            // 0.4.8（notes-048-topic-tag-merge）：显式 topic 入参并入 tags + topic 落盘清空（写侧惰性落盘）；
            // tags 未显式传时读存量 tags 合并（缓存命中零额外磁盘读）；空/未分类/分类中占位透传不动（兼容旧调用）
            let upTags = args.tags, upTopic = args.topic
            if (topicMergeWrite(null, args.topic)) {
              if (upTags === undefined) { const curN = await _get(args.id); upTags = (curN && curN.tags) || [] }
              upTags = topicMergeWrite(upTags, args.topic).tags; upTopic = ''
            }
            const r = await _update(args.id, args.title, args.body, upTags, upTopic, args.kind, args.status, args.inject, args.injectTo, undefined, args.recall, args.injectRole, args.sensitive, { confirmClearBody: args.confirmClearBody === true, contractType: args.contractType, schedule: args.schedule, hidden: args.hidden })
            // P3 派发闭环：resolved 联动回执了派发时在消息里明示（agent 可感知闭环已发生）
            // 工作记忆 v0：kind=log 隐身硬闸命中时告知（inject 被强制关闭）
            // 0.4.8：topic 合并命中时告知（已并入 tags 且清空）
            const topicMerged = upTopic === '' && args.topic !== undefined && args.topic !== ''
            const outU = { action: 'update', id: args.id, kind: r.kind, status: r.status, dispatchClosed: r.dispatchClosed || 0, injectForcedOff: r.injectForcedOff === true, message: 'Note updated' + (topicMerged ? '（topic 已并入 tags：合并去重落盘，topic 字段已清空——0.4.8 懒合并）' : '') + (r.dispatchClosed ? '；已自动回执 ' + r.dispatchClosed + ' 条派发（dispatchStatus→done）' : '') + (r.injectForcedOff ? '（kind=log 工作日志不参与注入：inject 已强制关闭）' : '') }
            if (topicMerged) outU.topicMerged = true
            return outU
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
              // 未指定目标：返回当前可派发会话列表（活跃 + 休眠双区，0.4.4-B；live 字段区分，休眠目标走「下次活动送达」排队）
              const list = (await _activeSessions()).sessions.map(s => ({ sessionId: s.id, short: s.short, name: s.name, workspace: s.workspace, live: s.live !== false }))
              return { action: 'dispatch', needTarget: true, activeSessions: list, message: '请用 targetSessionId 指定目标会话（live:false = 休眠会话，派发将持久化排队、下次活动送达）' }
            }
            const r = await _dispatch(args.id, { sessionId: args.targetSessionId, sessionName: args.targetSessionName, instruction: args.instruction, mode: 'existing' })
            if (r.error) return { error: r.error }
            return { action: 'dispatch', id: args.id, sessionId: r.sessionId, queued: r.queued === true, message: '已派发到「' + r.sessionName + '」' + (r.queued ? '（休眠会话：已持久化排队，下次活动送达）' : '') + (args.instruction ? '（含具体要求）' : '') }
          }
          return { error: 'note_manage: 未知 action：' + String(action) + '（期望 create/list/update/move/delete/restore/archive/dispatch）' }
        } catch (e) { return { error: String(e.message || e) } }
      }
    })

    // 设置启动加载（不阻塞 apply 返回）：classifyTopic/extractInstruction/renderInjected/notes-settings-get 读同一内存缓存
    loadSettings()
    // 用量统计启动加载（同口径不阻塞）：recordUsage 记账前内部也会 await loadUsage()，双保险防覆盖存量
    loadUsage()
    // 0.4.6-H（notes-046-smallfix 卫生小件②）：原子写 .tmpdir 孤儿启动清扫（fire-and-forget；>24h 才删不动在途写；能力缺失静默跳过）
    sweepTmpdirOrphans()
    // 0.4.3⑤ 升级首启自动建「注入索引（自动）」根笔记（notes-043-index，fire-and-forget；失败静默下次启动重试）
    // 0.4.3 验收修复⑪：ensure 落定后顺带孤儿索引自愈（idxHealOrphans：存量同名索引 §1 行并入正式索引 + 软删孤儿；冷缓存防御在 idxEnsure 内水化闸门）
    idxEnsure().then(function (rl) { if (rl) idxHealOrphans(rl) })
    // 0.4.3 验收修复⑤（notes-043-metrics-storage）：遥测存储层启动加载 + 旧「召回遥测（自动）」笔记一次性迁移
    //   （首个 flush 前回填 telemetry.json，幂等；fire-and-forget 内部全吞异常，失败下个事件/启动重试）
    _recallMaybeMigrate()
    // 0.4.3 验收修复⑤：存量注入索引「## §2 召回指标」节一次性摘除（幂等零改动；指标迁 telemetry.json + notes-recall-stats）
    _ledgerStripS2()

    ctx.effect(() => () => {
      for (const d of disposers) { try { d() } catch (e) {} }
      flushUsage()       // 卸载 flush：usage.json 防抖窗口内未落盘的 token 计数立即写盘（同上 fire-and-forget）
      // 卸载 flush：召回遥测 + useCount facet（0.4.3 验收修复⑧收编，facets.use 唯一事实源）防抖窗口内内存增量同盘落 telemetry.json
      //   （0.4.3+ 卡⑫ → 卡⑤机器存储层；旧 flushUseCounts 逐笔记 persistNote 重写 .md 通道已拆除；同上 fire-and-forget）
      _recallFlushAgg()
    })
    console.log('notes plugin: host ready, dir =', NOTES_DIR, ', llm =', !!llm, ', adm =', !!adm)
    // 心跳文件：自检验证 impl 真正加载成功（bootstrap 架构下 apply 异步完成）
    ;(async () => { try { const ft = await fs.resolve(PLUGIN_DIR + '\\.last-host-load'); await fs.writeText(ft, new Date().toISOString(), undefined, undefined, getPolicy()) } catch (e) {} })()
  }
}

