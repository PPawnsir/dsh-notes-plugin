    // 派发目标会话列表（共享）：**未归档的主会话**（可继续对话，符合 DSH 交互逻辑），不只是当前 live。
    // sessionPersistence.list() 返回 SessionPersistenceSnapshot[]（{header, revision, ...}），id/origin/cwd/createdAt 都在 header 里；兼容旧版直接返回 SessionHeader
    function snapHeader(h) { return (h && h.header) ? h.header : h }
    // 后台批量读 title + header（origin/cwd/createdAt）：sessionQuery.readTitleSnapshots（live/persisted 都行，取代已删除的 inspect）。
    // 0.1.7 下该 API 对非 live 会话走全量日志解析（~10s/会话），故只在后台补缓存，绝不阻塞 RPC 返回。
    // 串行化：已有批量读在跑时本轮跳过（未命中会话保持 pending，client 轮询重拉时自然再触发）。
    async function _fillSessMeta(missIds) {
      if (!missIds || !missIds.length) return
      if (!sessionQuery || !sessionQuery.readTitleSnapshots) return
      if (sessMetaFillRunning) return
      sessMetaFillRunning = true
      try {
        const results = await sessionQuery.readTitleSnapshots(missIds)
        const ts = Date.now()
        for (const r of (results || [])) {
          if (r && r.status === 'fulfilled' && r.value) {
            const hd = r.value.session || {}
            sessMetaCache.set(r.sessionId, { title: (r.value.title && r.value.title.title) || '', cwd: hd.cwd || '', origin: hd.origin || '', createdAt: hd.createdAt, ts: ts })
          }
        }
      } catch (e) {} finally { sessMetaFillRunning = false }
    }
    // 与左侧会话列表一致：workspaceRegistry 各工作区 sessionIds 过滤子 agent + 已归档；名字 live 实时（sessionTitle.get 最新 fold），非 live 走元数据缓存。
    // 返回 { sessions, titlesPending?, pendingIds?, pendingSessions? }：
    //   sessions        —— 已 resolve 的条目（live 实时 + 缓存命中/兜底的非 live），立即可用
    //   titlesPending   —— 存在缓存未命中 / title 过期会话，已后台触发 _fillSessMeta（全命中时不带此字段）
    //   pendingIds      —— 后台读盘中的 sid 列表（未命中 + 过期刷新）
    //   pendingSessions —— 未命中会话的占位条目 [{id, short, workspace}]，client 渲染「短id · 标题加载中…」
    async function _activeSessions() {
      const empty = { sessions: [] }
      if (!workspaceRegistry || !workspaceRegistry.list) return empty
      // 已归档集合（workspaceRegistry.archivedSessionIds 是 registry 级归档集合）
      const archivedSet = {}
      try { const arch = workspaceRegistry.archivedSessionIds; if (Array.isArray(arch)) { for (const id of arch) archivedSet[id] = true } } catch (e) {}
      // 数据源：各工作区的 sessionIds（= 左侧会话列表显示的有效会话；已关闭/废弃的不在任何工作区里，自然排除）
      const entries = []
      const seen = {}
      const wl = workspaceRegistry.list() || []
      for (const w of wl) {
        const wsTitle = (w && w.title) || basename((w && w.path) || '')
        let sids = []
        try { sids = w.sessionIds || [] } catch (e) {}
        for (const sid of (sids || [])) {
          if (!sid || seen[sid]) continue
          seen[sid] = true
          if (archivedSet[sid]) continue  // 已归档跳过
          entries.push({ sid, wsTitle })
        }
      }
      if (entries.length === 0) return empty
      const nowTs = Date.now()
      const out = []
      const missIds = []        // 缓存未命中：必须读盘才知道 title/origin，先占位、后台补齐
      const refreshIds = []     // 缓存有但 title 过期：旧标题兜底展示，后台重读刷新
      const pendingSessions = []
      for (const e of entries) {
        const liveAgent = agents && agents.get ? agents.get(e.sid) : undefined
        const live = !!liveAgent
        if (live) {
          // live 会话始终实时：sessionTitle.get 走内存（最新 fold，含 fork 改名后的新名），近零成本
          let title = ''
          if (sessionTitle && sessionTitle.get && liveAgent.session) {
            try { const snap = sessionTitle.get(liveAgent.session); if (snap && snap.title) title = snap.title } catch (e2) {}
          }
          const hd = (liveAgent.session && liveAgent.session.header) || {}
          // 反哺缓存：live 转非 live 后标题即刻可用（origin 读不到就保留旧值，避免污染子 agent 过滤）
          const prev = sessMetaCache.get(e.sid) || {}
          sessMetaCache.set(e.sid, { title: title || prev.title || '', cwd: hd.cwd || prev.cwd || '', origin: hd.origin !== undefined ? hd.origin : prev.origin, createdAt: hd.createdAt || prev.createdAt, ts: nowTs })
          out.push({ id: e.sid, short: shortSid(e.sid), name: title || (e.wsTitle + ' · ' + shortSid(e.sid)), cwd: hd.cwd || prev.cwd || '', workspace: e.wsTitle, live: true, createdAt: hd.createdAt || prev.createdAt })
          continue
        }
        const c = sessMetaCache.get(e.sid)
        if (!c) {
          // 未命中：占位条目进 pendingSessions（client 显示「短id · 标题加载中…」），后台批量读盘补齐
          missIds.push(e.sid)
          pendingSessions.push({ id: e.sid, short: shortSid(e.sid), workspace: e.wsTitle })
          continue
        }
        if (c.origin === 'subagent') continue  // 排除一次性子 agent
        const fresh = (nowTs - (c.ts || 0)) < SESS_META_TTL
        if (!fresh) refreshIds.push(e.sid)     // title 过期：后台重读（空标题会话也可能后来补上了标题），本轮先用旧值兜底
        // 无标题且非 live 的会话视为已关闭/废弃（从没生成标题，也不在运行），不在派发/注入列表显示
        if (!c.title) continue
        out.push({ id: e.sid, short: shortSid(e.sid), name: c.title, cwd: c.cwd || '', workspace: e.wsTitle, live: false, createdAt: c.createdAt })
      }
      // 后台补齐/刷新：不阻塞首屏返回（0.1.7 下非 live 会话读盘 ~10s/个，同步等即复现 128s 空白）
      const bgIds = missIds.concat(refreshIds)
      if (bgIds.length) _fillSessMeta(bgIds)
      // 排序：live 在前，再按创建时间倒序
      out.sort((a, b) => { if (a.live !== b.live) return a.live ? -1 : 1; return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) })
      if (bgIds.length === 0) return { sessions: out }
      return { sessions: out, titlesPending: true, pendingIds: bgIds, pendingSessions: pendingSessions }
    }


    // 休眠送达通道（0.4.4-B，notes-044-dormant-dispatch）：目标非 live 时，向其持久化日志追加 durable inbox splice
    // （agent/inbox/spliced，与 live send(msg,'next-turn') 的落盘记录同形态）——零唤醒零成本：不启动 agent，
    // 会话下次活动（用户打开/恢复）时由 loop 认领该消息开始处理；GUI 打开时即显示为排队消息。
    // 落盘前折叠 inbox 现状求精确 splice start（dsh-agent-loop inboxProjectionDefinition 对 start>length 拒绝，
    // 错写会让会话恢复即抛 invalid persisted inbox splice——必须全量读日志现算，无更便宜通道）。
    // 幂等：同 msgId 已在队列则跳过追加（inbox 折叠对重复 pending id 拒绝，重复写入会毁掉恢复路径）。
    // 失败一律 { error, needOpen:true }（含「未打开」字样供调度链 lastError 口径与 UI 提示复用）。
    async function _queueDormantDispatch(sid, msg) {
      const fail = function (why) { return { error: '目标会话当前未打开，休眠送达失败（' + why + '）。请先打开它，或改用「新建会话」。', needOpen: true } }
      if (!sessionPersistence || typeof sessionPersistence.open !== 'function') return fail('宿主无 sessionPersistence.open 能力')
      let handle = null
      try { handle = await sessionPersistence.open(sid, 'write') } catch (e) { return fail('会话不存在于持久化存储或写锁被占用：' + String(e && e.message || e)) }
      try {
        const rd = await handle.read(0)
        const events = (rd && rd.events) || []
        // 折叠 durable inbox（同 loop 投影口径：agent/inbox/spliced 标准 splice 语义，越界钳位容错）
        const inbox = { 'next-turn': [], 'next-step': [] }
        for (const ev of events) {
          if (!ev || ev.type !== 'agent/inbox/spliced') continue
          const d = ev.data || {}
          const list = inbox[d.target]
          if (!Array.isArray(list)) continue
          const start = Math.max(0, Math.min(typeof d.start === 'number' && isFinite(d.start) ? Math.trunc(d.start) : list.length, list.length))
          const rm = typeof d.removedCount === 'number' && isFinite(d.removedCount) ? Math.min(Math.max(Math.trunc(d.removedCount), 0), list.length - start) : 0
          const ins = Array.isArray(d.inserted) ? d.inserted : []
          inbox[d.target] = list.slice(0, start).concat(ins, list.slice(start + rm))
        }
        const dup = inbox['next-turn'].concat(inbox['next-step']).some(function (m) { return m && m.id === msg.id })
        if (!dup) {
          await handle.append([{ type: 'agent/inbox/spliced', seq: events.length, time: Date.now(), data: { target: 'next-turn', start: inbox['next-turn'].length, inserted: [msg] } }])
          await handle.flush()   // 耐久屏障：flush 落定后崩溃也送达
        }
        return { ok: true }
      } catch (e) {
        return fail('日志追加异常：' + String(e && e.message || e))
      } finally { try { if (handle) await handle.close() } catch (e) {} }
    }

    // 任务派发（共享）：主动注入上下文 + 触发对话——agent.send 一条消息到目标会话，
    // source 标记为 { kind:'plugin', form:'recall' }（todo 作为"召回的上下文"，区别于用户指令/系统提示拼接），
    // wakeup=true 保证触发该会话 agent 去获取并处理这条上下文（可见反应，不污染系统提示）。
    // 双通道（0.4.4-B）：live 命中走现行 send 立即触发；未命中走休眠送达（_queueDormantDispatch 持久化排队，
    // 「下次活动送达」语义——不主动唤醒休眠会话），返回 queued:true + dispatches 记录带 queued 布尔。
    // opts: { sessionId, sessionName, workspace, mode('existing'|'new'), instruction, sourceLabel（派发来源标注，定时调度传 '定时调度 @约定标题'，进消息尾行与 dispatches 记录） }
    async function _dispatch(id, opts) {
      const o = opts || {}
      const note = await _get(id)
      if (note.deleted) return { error: '笔记已删除' }
      if (!o.sessionId) return { error: '缺少目标会话' }
      const instruction = String(o.instruction || '').trim()
      const text = '【笔记插件 · 派发的待办上下文】\n\n【待办】' + (note.title || 'Untitled') + '\n' + String(note.body || note.title || '').trim() + (instruction ? '\n\n【派发方补充的要求】\n' + instruction : '') + '\n\n—— 以上是笔记插件派发给你的待办上下文（recall' + (o.sourceLabel ? '，来源：' + o.sourceLabel : '') + '）。请获取此上下文并开始处理。完成后请调用 note_manage（action: \'update\', id: \'' + note.id + '\', status: \'resolved\'）了结该笔记，系统会自动回执派发状态（dispatchStatus→done）。' + (bodyHasImageRef(note.body) ? '\n\n' + assetsHintLine(NOTES_DIR) : '')
      const msg = {
        id: 'note-dispatch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        role: 'user',
        content: [{ type: 'text', text: text }],
        // form:'recall'：标记为"召回的上下文"而非用户指令；agent loop 照常处理（wakeup 触发），模型据 form 理解为参考资料
        // v0.1.7 起会话日志为 format v4：kind:'plugin' 是已退役的 v3 包装写法，落盘会抛
        // SessionFormatError 并炸掉目标会话当前轮次；v3→v4 迁移映射为 plugin:dsh-notes，直接写迁移后形态
        source: { kind: 'plugin:dsh-notes', form: 'recall' }
      }
      // 双通道分流（0.4.4-B）：live → send 立即触发；非 live → 休眠送达（持久化排队，下次活动送达）
      const target = agents && agents.get ? agents.get(o.sessionId) : undefined
      let queued = false
      if (target && typeof target.send === 'function') {
        target.send(msg, 'next-turn', true)
      } else {
        const q = await _queueDormantDispatch(o.sessionId, msg)
        if (q.error) return q
        queued = true
      }
      // 派发历史：作为笔记属性记录（不改正文）；P3 起带 dispatchStatus（'sent'|'done'）状态机字段，done 布尔保留兼容旧 client
      const rec = {
        sessionId: o.sessionId,
        sessionName: o.sessionName || shortSid(o.sessionId),
        workspace: o.workspace || '',
        mode: o.mode || 'existing',
        instruction: instruction,
        at: new Date().toISOString(),
        // msgId 派发消息关联键（定时调度 lastRun.receiptId 回执关联用；存量记录无此字段，向后兼容）
        msgId: msg.id,
        done: false,
        dispatchStatus: 'sent'
      }
      // queued 布尔（0.4.4-B）：休眠送达标记——仅 queued 时落键（存量/live 记录零字段变化，向后兼容）；
      // 回执闭环沿用 dispatch-loop（会话活动处理完该消息转 idle → 自动回执 done）
      if (queued) rec.queued = true
      if (o.sourceLabel) rec.sourceLabel = o.sourceLabel
      note.dispatches = (note.dispatches || []).concat([rec])
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      // 召回遥测（0.4.3+ 卡⑫ notes-043-inject-receipt）：mount 通道交付事件——笔记作为待办上下文挂载进目标任务会话
      // （notes-dispatch / note_manage.dispatch / 定时派发 _schedFire 三入口同走本单点；签名含会话——换会话重派计独立交付）
      _recallRaw('mount', [note.id], shortSid(o.sessionId))
      // 0.4.4-A（notes-044-dispatch-receipts）派发回执笔记化·三表归一：派发事件本身落「执行记录」伴生笔记 📤 行（派发历史笔记化）——
      //   懒创建 + runLog 软链回写（调度约定 schedule.runLog 存量继承 / 非调度笔记顶层 runLog）；观察面产物异常内部全吞，不扩散派发主链路
      await _schedRunLogAppend(note, [{ _dispatch: true, at: rec.at, sessionId: o.sessionId, sessionName: rec.sessionName, instruction: instruction, sourceLabel: o.sourceLabel || '', msgId: rec.msgId, queued: queued }])
      return { ok: true, id: note.id, sessionId: o.sessionId, sessionName: rec.sessionName, queued: queued, dispatch: rec }
    }

    // 标记一条派发待办为完成（手动闭环通道；P3 起写 dispatchStatus='done' + doneAt + receipt='manual'，done 布尔同步保留）
    async function _dispatchDone(id, dispatchIndex) {
      const note = await _get(id)
      if (note.deleted) return { error: '笔记已删除' }
      const ds = note.dispatches || []
      const i = typeof dispatchIndex === 'number' ? dispatchIndex : -1
      if (i < 0 || i >= ds.length) return { error: '无效的派发记录索引' }
      ds[i] = Object.assign({}, ds[i], { done: true, dispatchStatus: 'done', doneAt: new Date().toISOString(), receipt: 'manual' })
      note.dispatches = ds
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      await _schedRunLogAppend(note, [ds[i]])   // 执行记录独立笔记（notes-041-sched-runlog）：手动标记同回执落盘口径（幂等由 msgId 去重兜底）
      return { ok: true, id: note.id }
    }

    // ==== dispatch-loop BEGIN ====（P3 派发闭环；host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取比对，改动必须双边同步）
    // 调研结论（DSH 0.2.0-rc.2 实机核验 node_modules 源码）：Cordis Events 暴露 agent/* 生命周期事件——
    //   agent/status（idle⇄running，emit 模式，dsh-agent-loop setPhase 发出；插件 ctx.on 可订阅，
    //   先例：dsh-api-session-controller / dsh-goal-round-driver / dsh-agent invariant.js）。
    //   但 0.2.0 没有「任务语义完成」事件：idle 只代表目标会话驱动静止（可能是报错、追问或部分处理后的停顿），
    //   把 idle 当完成信号自动 resolved 笔记会误报——故本订阅只做「派发回执」（dispatchStatus→done），
    //   笔记 resolved 走保底联动（_update 置 status='resolved' 时 _closeOpenDispatches 全量回执，必然可行）。
    //   轮询方案（面板打开时读目标会话最新消息摘要判完成）评估后放弃：非 live 会话读盘 ~10s/个（0.1.7 教训），
    //   且「最新消息」无法判定语义完成，不可靠。
    // 已知局限：插件重载/宿主重启期间错过的 idle 无事件回执（由保底联动或手动「标记完成」兜底）。
    // 单条派发完成判定：dispatchStatus==='done' 或存量 done===true（0.2.0 前记录只有 done 字段，向后兼容）
    function isDispatchDone(d) { return !!(d && (d.dispatchStatus === 'done' || d.done === true)) }
    // 回执落库（作用于笔记对象内联）：把 note.dispatches 中未闭环条目标记 done（dispatchStatus/done/doneAt + receipt 来源）；
    // onlySessionId 限定只回执派发到该会话的条目（idle 事件回执用）；缺省全量（resolved 保底联动用）。返回新闭环条数；
    // out（可选数组，notes-041-sched-runlog）：收集本次新闭环的派发记录（执行记录独立笔记追加用）
    function _closeOpenDispatches(note, receipt, onlySessionId, out) {
      const ds = note.dispatches || []
      let closed = 0
      const now = new Date().toISOString()
      for (let i = 0; i < ds.length; i++) {
        const d = ds[i]
        if (isDispatchDone(d)) continue
        if (onlySessionId && (!d || d.sessionId !== onlySessionId)) continue
        ds[i] = Object.assign({}, d, { done: true, dispatchStatus: 'done', doneAt: now, receipt: receipt || 'manual' })
        if (out) out.push(ds[i])
        closed++
      }
      if (closed) note.dispatches = ds
      return closed
    }
    // agent/status idle 事件回执：目标会话处理完派发消息转入静止 → 全库扫描该会话的未闭环派发逐笔记落盘。
    // _list 走内存缓存（二次起零磁盘读）；idle 每轮次至多一次，开销可忽略。
    // { history:false }：回执是自动元数据回写（作用于 _list 返回的缓存原件，dispatches 原地变异），不算编辑，不产生历史快照
    async function _receiptDispatchesForSession(sid) {
      const all = await _list()
      for (const n of all) {
        if (!n || n.deleted || n.tombstoned) continue
        if (!(n.dispatches || []).length) continue
        const closedDs = []   // 执行记录独立笔记（notes-041-sched-runlog）：收集本次闭环条目供 runLog 追加
        if (_closeOpenDispatches(n, 'idle', sid, closedDs) > 0) {
          n.updatedAt = new Date().toISOString()
          try { await persistNote(n, { history: false }) } catch (e) { console.error('notes: dispatch receipt persist failed', n.id, e) }
          await _schedRunLogAppend(n, closedDs)   // 0.4.4-A 起全笔记生效·三表归一（内部全量吞异常；源笔记正文零改动红线不破）
        }
      }
    }
    // 订阅 agent/status：只关心 idle 落定（running 无关）；ctx.on 不存在（老宿主/单测 mock）时静默跳过——保底联动不依赖本订阅
    if (typeof ctx.on === 'function') {
      try {
        const offDispatchStatus = ctx.on('agent/status', (payload) => {
          try {
            if (!payload || payload.status !== 'idle') return
            const agent = payload.agent
            const sid = agent && (agent.id || (agent.session && agent.session.id))
            if (!sid) return
            _receiptDispatchesForSession(sid).catch((e) => { console.error('notes: dispatch receipt failed', e) })
          } catch (e) {}
        })
        if (typeof offDispatchStatus === 'function') disposers.push(offDispatchStatus)
      } catch (e) {}
    }
    // ==== dispatch-loop END ====


    // 会话列表（注入范围多选用）：与派发同源——工作区有效会话（排除已归档 + 子 agent），复用 _activeSessions
    // 返回 { sessions, titlesPending?, pendingIds?, pendingSessions? }：缓存未命中的会话后台补标题（0.1.7 首屏不阻塞）
    disposers.push(handle('notes-sessions', async () => {
      try { return await _activeSessions() } catch (e) { return { sessions: [] } }
    }))
    // 活跃主会话列表（任务派发目标用）：同 notes-sessions——live 实时 + 非 live 走元数据缓存（TTL 10min）
    disposers.push(handle('notes-active-sessions', async () => {
      try { return await _activeSessions() } catch (e) { return { sessions: [] } }
    }))
    // 工作区列表（派发对话框的"新建会话"下拉用）
    disposers.push(handle('notes-workspaces', async () => {
      try {
        if (!workspaceRegistry || !workspaceRegistry.list) return { workspaces: [] }
        const list = workspaceRegistry.list() || []
        return { workspaces: list.map(w => ({ id: w.id, title: w.title || basename(w.path || ''), cwd: w.path || '' })) }
      } catch (e) { return { workspaces: [] } }
    }))
    // 任务派发（client 面板用）：复用共享 _dispatch（系统提示注入形式，登记到 dispatches）
    disposers.push(handle('notes-dispatch', async (args) => {
      try { return await _dispatch(args.id, { sessionId: args.sessionId, sessionName: args.sessionName, workspace: args.workspace, mode: args.mode, instruction: args.instruction }) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 标记派发待办完成（停止注入目标会话系统提示）
    disposers.push(handle('notes-dispatch-done', async (args) => {
      try { return await _dispatchDone(args.id, args.dispatchIndex) } catch (e) { return { error: String(e.message || e) } }
    }))
