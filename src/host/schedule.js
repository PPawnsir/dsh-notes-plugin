    // ==== schedule-exec BEGIN ====（定时派发·执行层：dispatch-schedule 声明解析 + 常驻 cron tick + 派发执行 + 状态三层。
    // 本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致（schedule.js 双清单同名共源，无 .dist 变体），check.js 比对；改动必须双边同步）
    // 产品裁决（决策 n-muqyk2ve1sqx / n-musewkked3tq 设计定稿 2026-10-04）：形态 = 「约定即调度」——不做调度器 UI/cron 概念，
    //   约定笔记以 front-matter 结构化字段声明调度意图，插件识别执行（治理面复用约定车道：可见/可编辑/可停用，零新概念）。
    //   ①声明：contractType=dispatch-schedule 约定笔记 + schedule: { at | every, target, action:'dispatch', enabled }；
    //     正文 = 人话描述（即被派发的工作内容本身）。禁自然语言解析（错得安全：会真执行动作的能力声明必须无歧义）。
    //   ②常驻 cron：setInterval 30s tick + .unref() 不挂进程退出 + disposers cleanup（ctx.effect 统一消费，防重载双跑）；
    //     tick 内异常全量吞掉——全局异常 console.error，单笔记异常记该笔记 schedule.lastError，绝不能影响主服务。
    //   ③执行：到期 → 复用 _dispatch 全链路（标准派发卡，来源标注「定时调度 @约定标题」）；回执走既有 dispatch-loop 链路自动积累。
    //   ④状态三层：schedule.lastFiredAt / lastRun{at,status,receiptId} / lastError（front-matter 机器读写，随笔记落盘）；
    //     历史主载体 = 约定笔记既有 dispatches 数组（每次触发 _dispatch 自动登记，零新建）；不建独立 schedule-log。
    //   ⑤防重与错过：lastFiredAt 先落盘再派发是幂等生命线（进程在派发后崩溃最多漏记 lastRun，绝不重发同一触发）；
    //     单次 at 停机错过 → 启动补评估补发一次（lastFiredAt 空 + at 已过 → 到期即补）；轮询错过 → 触发一次即对齐下周期不追赶。
    //   ⑥校验红线（写入闸门 _schedValidateWrite）：at 必须未来且禁止时区后缀（本地时区语义：无后缀串 Date.parse 按本地解析；
    //     带 Z/±偏移会被按 UTC 解释造成整时区偏移——能力声明必须无歧义，错得安全一律拒绝）且禁止纯日期（YYYY-MM-DD 无 T 时间部分，
    //     ES 规范按 UTC 午夜解析，本地时区下产生整时区偏移——与时区后缀同类歧义，notes-034-at-need-time）；轮询间隔 ≥5min；目标会话必须存活（工作区有效且未归档）。
    //   ⑦锚定时刻（notes-034-sched-time）：every 可配 anchor:'HH:MM'（本地墙钟时刻，触发序列钉死该时刻不随创建/触发时刻漂移；
    //     需整天间隔——子日间隔锚定语义有歧义一律拒绝）；weekly 另配 dow:0-6（星期几，0=周日；需搭配 anchor 且 every=1w）。
    //     无 anchor 的存量 every 声明保持纯间隔语义（锚点 lastFiredAt||createdAt）——存量零迁移兼容。
    // 序位说明（§8.4.2 例外备案）：本模块消费 dispatch.js 的 _dispatch 故置于其后；notes.js 的 _create/_update 经函数声明提升
    //   调用本模块的 _schedValidateWrite/SCHEDULE_CONTRACT_TYPE——全部为运行期（RPC 调用时）引用，apply 执行期零触碰，无 TDZ 风险。
    const SCHED_TICK_MS = 30 * 1000              // 常驻 tick 周期（裁决②）
    const SCHED_MIN_INTERVAL_MS = 5 * 60 * 1000  // 校验红线：轮询间隔 ≥5min
    const SCHED_ERR_RETRY_MS = 5 * 60 * 1000     // 执行失败 lastError 刷写节流（防 30s tick 对同一故障反复写盘）
    const SCHEDULE_CONTRACT_TYPE = 'dispatch-schedule'   // 契约身份标记（front-matter contractType，调度声明的主识别键）

    // every 声明 → 毫秒：number 直给（毫秒）；字符串 '<n>m|<n>h|<n>d|<n>w'（分钟/小时/天/周）。非法 → null
    function schedEveryMs(every) {
      if (typeof every === 'number' && isFinite(every) && every > 0) return Math.floor(every)
      if (typeof every === 'string') {
        const m = every.trim().match(/^(\d+)([mhdw])$/)
        if (m) {
          const n = parseInt(m[1], 10)
          const unit = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]]
          return n * unit
        }
      }
      return null
    }

    // 锚定时刻（notes-034-sched-time）：'HH:MM' → 当日分钟偏移 ms（本地墙钟）；非法 → null
    function schedAnchorMs(anchor) {
      const m = typeof anchor === 'string' ? anchor.match(/^([01]\d|2[0-3]):([0-5]\d)$/) : null
      return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60000 : null
    }

    // 锚定时刻序列（notes-034-sched-time）：anchor 声明 → 触发时刻钉死本地 HH:MM，不随创建/触发时刻漂移。
    //   首触（fired=false，base=createdAt）= base 之后第一个锚定时刻（weekly 限定 dow 星期几）；
    //   后续（fired=true，base=lastFiredAt）= base + 间隔 所在本地日的锚定时刻（weekly = 下一个 dow 锚定时刻）——
    //   触发延迟（停机错过）只推迟本次，后续仍落回同一时刻序列。
    //   dow=0-6（0=周日，Date.getDay 口径）；ivMs 需整天倍数（写入闸门保证）。非法 → null
    function schedAnchorNextMs(anchor, dow, ivMs, baseMs, fired) {
      const off = schedAnchorMs(anchor)
      if (off === null || !isFinite(baseMs) || !baseMs) return null
      const b = new Date(baseMs)
      const day0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()   // base 所在本地日午夜
      if (typeof dow === 'number') {
        // weekly：自 base 当日起逐日找首个 getDay()===dow 且锚定时刻 > base 的候选（已触发 → 下周同 dow；首触 → 下一个 dow）
        for (let i = 0; i < 14; i++) {
          const dm = day0 + i * 86400000
          if (new Date(dm).getDay() === dow && dm + off > baseMs) return dm + off
        }
        return null
      }
      if (typeof ivMs !== 'number' || !isFinite(ivMs) || ivMs % 86400000 !== 0) return null
      if (fired) { const f = new Date(baseMs + ivMs); return new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime() + off }
      // 首触：base 当日锚定时刻未到 → 当日；已过 → 次日
      return (day0 + off > baseMs ? day0 : day0 + 86400000) + off
    }

    // 声明纯校验（同步部分：形状/未知键/动作/at 未来/every 下限；目标存活为异步部分由 _schedValidateWrite 补）。
    // 返回 { value: 归一化声明 } | { error }；机器状态字段（lastFiredAt/lastRun/lastError）容忍输入但剥离（由既有值延续，见 _schedValidateWrite）
    function schedCheckDecl(raw, nowMs) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'schedule 必须是对象 { at|every, target, action?, enabled?, anchor?, dow? }' }
      const known = { at: 1, every: 1, target: 1, action: 1, enabled: 1, anchor: 1, dow: 1, lastFiredAt: 1, lastRun: 1, lastError: 1 }
      for (const k of Object.keys(raw)) {
        if (!known[k]) return { error: 'schedule 含未知字段 ' + k + '（声明只允许 at/every/anchor/dow/target/action/enabled；错得安全：能力声明必须无歧义）' }
      }
      const at = raw.at !== undefined && raw.at !== null && raw.at !== '' ? String(raw.at).trim() : ''
      const every = raw.every !== undefined && raw.every !== null && raw.every !== '' ? raw.every : undefined
      // 锚定时刻（notes-034-sched-time）：anchor='HH:MM' 本地时刻 / dow=0-6 星期几（weekly）——空串/null 视为未声明
      const anchorRaw = raw.anchor !== undefined && raw.anchor !== null && raw.anchor !== '' ? String(raw.anchor).trim() : ''
      const hasDow = raw.dow !== undefined && raw.dow !== null && raw.dow !== ''
      if (at && every !== undefined) return { error: 'schedule.at 与 schedule.every 二选一（单次定时 / 轮询定时），不能同时声明' }
      if (!at && every === undefined) return { error: 'schedule 需要 at（单次定时 ISO 时间）或 every（轮询间隔，如 30m/12h/3d）' }
      const target = String(raw.target || '').trim()
      if (!target) return { error: 'schedule.target 缺省：必须声明目标会话 id' }
      const action = raw.action === undefined ? 'dispatch' : String(raw.action)
      if (action !== 'dispatch') return { error: 'schedule.action 仅支持 dispatch（实得 ' + action + '）' }
      const enabled = raw.enabled === undefined ? true : raw.enabled
      if (typeof enabled !== 'boolean') return { error: 'schedule.enabled 必须是布尔值' }
      const value = { target: target, action: 'dispatch', enabled: enabled }
      if (at) {
        // 锚定时刻字段仅周期模式（every）有效——单次 at 自身即完整时刻声明，混声明有歧义一律拒绝
        if (anchorRaw || hasDow) return { error: 'schedule.anchor/dow 仅周期模式（every）有效，单次 at 不接受锚定字段（错得安全：能力声明必须无歧义）' }
        // 校验红线①·本地时区闸门（notes-034-at-local-tz）：拒绝一切时区后缀（Z/z 结尾或 ±HH:MM/±HHMM 偏移），
        //   at 钉死「本地机器时间」语义——无后缀串 Date.parse 按本地解析，带后缀会被按 UTC 解释造成整时区偏移（错得安全：能力声明必须无歧义）
        if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(at)) return { error: 'schedule.at 必须是不带时区的本地时间（如 2026-10-05T09:00），禁止 Z/±偏移后缀（实得 ' + at + '）' }
        const atMs = Date.parse(at)
        if (!isFinite(atMs)) return { error: 'schedule.at 非法时间：' + at + '（期望 ISO 时间串）' }
        // 校验红线①·b 纯日期闸门（notes-034-at-need-time）：at 必须含 'T' 时间部分——纯日期 YYYY-MM-DD 被 ES 规范按 UTC 午夜解析，
        //   本地时区（如 UTC+8）下产生整时区偏移，与时区后缀同属「非本地语义」歧义一律拒绝（置于非法时间之后、未来性之前：纯日期无论古今同口径拒绝）
        if (at.indexOf('T') < 0) return { error: 'schedule.at 必须含日期和时间（如 2026-10-05T09:00），不接受纯日期（实得 ' + at + '）' }
        if (atMs <= nowMs) return { error: 'schedule.at 必须是未来时间（实得 ' + at + '）' }   // 校验红线①
        value.at = at
      } else {
        const iv = schedEveryMs(every)
        if (iv === null) return { error: 'schedule.every 非法：' + JSON.stringify(every) + '（期望毫秒数或 <n>m/<n>h/<n>d/<n>w）' }
        if (iv < SCHED_MIN_INTERVAL_MS) return { error: 'schedule.every 轮询间隔不得低于 5 分钟（实得 ' + Math.round(iv / 1000) + 's）' }   // 校验红线②
        value.every = every
        // 校验红线④·锚定时刻（notes-034-sched-time）：anchor 钉死触发时刻序列（首触=下一个本地 anchor 时刻，不随创建时间漂移）——
        //   HH:MM 严格两位格式；需整天间隔（子日间隔锚定语义有歧义，错得安全一律拒绝）
        if (anchorRaw) {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(anchorRaw)) return { error: 'schedule.anchor 非法：' + JSON.stringify(raw.anchor) + '（期望 HH:MM 本地时刻，如 09:00）' }
          if (iv % 86400000 !== 0) return { error: 'schedule.anchor 需搭配整天周期（每天/每周/每 N 天），子日间隔锚定语义有歧义（实得 every=' + JSON.stringify(every) + '）' }
          value.anchor = anchorRaw
        }
        if (hasDow) {
          if (!anchorRaw) return { error: 'schedule.dow 需搭配 anchor 使用（每周模式锚定：{ every: \'1w\', anchor: \'09:00\', dow: 1 }）' }
          if (typeof raw.dow !== 'number' || !isFinite(raw.dow) || Math.floor(raw.dow) !== raw.dow || raw.dow < 0 || raw.dow > 6) return { error: 'schedule.dow 非法：' + JSON.stringify(raw.dow) + '（期望 0-6 整数，0=周日）' }
          if (iv !== 604800000) return { error: 'schedule.dow 仅每周模式有效（every=\'1w\'；实得 every=' + JSON.stringify(every) + '）' }
          value.dow = raw.dow
        }
      }
      return { value: value }
    }

    // 校验红线③：目标会话必须存活——live 直通；非 live 须在工作区有效会话清单内且未归档（live 与否不影响声明准入，执行时再要求 live）
    async function _schedTargetAliveErr(target) {
      const live = agents && agents.get ? agents.get(target) : undefined
      if (live) return ''
      try {
        const archived = {}
        const arch = workspaceRegistry && workspaceRegistry.archivedSessionIds
        if (Array.isArray(arch)) { for (const id of arch) archived[id] = true }
        const wl = workspaceRegistry && workspaceRegistry.list ? workspaceRegistry.list() || [] : []
        for (const w of wl) {
          const sids = (w && w.sessionIds) || []
          for (const sid of sids) { if (sid === target && !archived[sid]) return '' }
        }
      } catch (e) {}
      return 'schedule.target 目标会话不存在或已归档：' + target
    }

    // 写入闸门（_create/_update 共用）：纯校验 + 目标存活 + 机器状态延续。返回 { value }（null=显式清除）| { error }
    // existingSched = 存量 schedule（update 场景）：声明字段被覆盖，机器状态字段（lastFiredAt/lastRun/lastError）延续——
    //   防重锚点对声明变更自洽（at 改新未来时刻：旧 lastFiredAt < 新 at 自然再触发一次；every 变更：锚点不动对齐下周期）。
    async function _schedValidateWrite(raw, contractType, existingSched) {
      if (raw === null) {
        // 显式清除：契约仍是 dispatch-schedule 时拒绝（契约 ⟺ 声明配对不变量，防悬空调度笔记）
        if ((contractType || '') === SCHEDULE_CONTRACT_TYPE) return { error: 'contractType=dispatch-schedule 需要 schedule 声明；解除调度请同时清除 contractType（contractType: \'\' + schedule: null）' }
        return { value: null }
      }
      if ((contractType || '') !== SCHEDULE_CONTRACT_TYPE) return { error: 'schedule 字段仅允许 contractType=dispatch-schedule 的约定笔记（错得安全：会真执行动作的能力声明必须显式契约分型）' }
      const chk = schedCheckDecl(raw, Date.now())
      if (chk.error) return { error: chk.error }
      const decl = chk.value
      // 校验红线③目标存活：enabled=false（停用/暂停）豁免——暂停操作随时可落，不因目标漂移锁死治理面
      if (decl.enabled !== false) {
        const aliveErr = await _schedTargetAliveErr(decl.target)
        if (aliveErr) return { error: aliveErr }
      }
      const ex = existingSched || {}
      if (ex.lastFiredAt) decl.lastFiredAt = ex.lastFiredAt
      if (ex.lastRun) decl.lastRun = ex.lastRun
      if (ex.lastError) decl.lastError = ex.lastError
      return { value: decl }
    }

    // 公共写入口（RPC / note_manage 工具）contractType 白名单：''（清除）或 dispatch-schedule（定时派发声明）；
    // memory-guide 等内部契约类型由系统流程直写 _create/_update，不对公共入口开放
    function schedPublicContractTypeError(ct) {
      if (ct === undefined || ct === '' || ct === SCHEDULE_CONTRACT_TYPE) return ''
      return 'contractType 公共写入口仅支持 \'dispatch-schedule\' 或 \'\'（其余契约类型由系统内部流程管理）'
    }

    // 到期判定（纯函数，注入时钟 nowMs 便于测试与回放）：
    //   at：lastFiredAt < at <= now → 到期（lastFiredAt 空 = 从未触发——含停机错过启动补发场景；触发后 lastFiredAt ≥ at 永不重发）
    //   every：锚点 = lastFiredAt || createdAt；now - 锚点 ≥ 间隔 → 到期（触发后 lastFiredAt=本次时刻对齐下周期，错过不追赶）；
    //   every + anchor（notes-034-sched-time 锚定时刻）：到期 = now ≥ 锚定序列下一时刻（schedAnchorNextMs，钉死本地 HH:MM 不漂移）；
    //   无 anchor 存量声明保持纯间隔语义（零迁移兼容）；非法声明（写入闸门已拦，此处双保险）一律不触发
    function schedDueAt(note, sched, nowMs) {
      const lastFiredMs = sched.lastFiredAt ? Date.parse(sched.lastFiredAt) : 0
      const firedMs = isFinite(lastFiredMs) ? lastFiredMs : 0
      if (sched.at) {
        const atMs = Date.parse(sched.at)
        if (!isFinite(atMs)) return false
        return atMs <= nowMs && firedMs < atMs
      }
      const iv = schedEveryMs(sched.every)
      if (iv === null || iv < SCHED_MIN_INTERVAL_MS) return false
      const base = firedMs || Date.parse(note.createdAt || '') || 0
      if (sched.anchor) {
        const next = schedAnchorNextMs(sched.anchor, typeof sched.dow === 'number' ? sched.dow : undefined, iv, base, !!firedMs)
        return next !== null && nowMs >= next
      }
      return nowMs - base >= iv
    }

    // lastError 落盘（状态三层①失败面）：throttle=true 时 5min 节流（目标未存活等持续性故障防 tick 刷写）；
    // { history:false }：机器状态回写不算编辑，不产生历史快照（dispatch-loop 回执同先例）
    async function _schedMarkError(noteId, message, nowMs, throttle) {
      const n = await loadNote(noteId)
      if (!n || !n.schedule) return
      const nowIso = new Date(nowMs).toISOString()
      if (throttle) {
        const lastErrMs = n.schedule.lastError && n.schedule.lastError.at ? Date.parse(n.schedule.lastError.at) : 0
        if (isFinite(lastErrMs) && lastErrMs && nowMs - lastErrMs < SCHED_ERR_RETRY_MS) return
      }
      n.schedule = Object.assign({}, n.schedule, { lastError: { at: nowIso, message: String(message || 'unknown') }, lastRun: { at: nowIso, status: 'error', receiptId: '' } })
      n.updatedAt = nowIso
      try { await persistNote(n, { history: false }) } catch (e) { console.error('notes: schedule lastError persist failed', noteId, e) }
    }

    // 单笔记触发：执行红线（目标 live）→ 标记 lastFiredAt 落盘（幂等生命线，先于派发）→ _dispatch 全链路 → lastRun 回写
    async function _schedFire(note, nowMs) {
      const nowIso = new Date(nowMs).toISOString()
      const sched = note.schedule
      // 执行红线：派发经 agent.send 触发工作，目标必须 live；未 live → 记 lastError（节流）不推进 lastFiredAt——目标上线后下个 tick 自动补发
      const target = agents && agents.get ? agents.get(sched.target) : undefined
      if (!target || typeof target.send !== 'function') {
        await _schedMarkError(note.id, '目标会话当前未打开，无法触发工作（目标 live 后下个 tick 自动补发）', nowMs, true)
        return false
      }
      // 幂等生命线：先推进 lastFiredAt 落盘再派发——进程在「派发后、lastRun 回写前」崩溃最多漏记一次 lastRun，绝不重发同一触发
      const marked = await loadNote(note.id)
      if (!marked || marked.deleted || marked.tombstoned || !marked.schedule || (marked.contractType || '') !== SCHEDULE_CONTRACT_TYPE) return false
      const markedSched = Object.assign({}, marked.schedule, { lastFiredAt: nowIso })
      delete markedSched.lastError   // lastError 仅失败记：进入成功路径即摘除（不留空串脏键）
      marked.schedule = markedSched
      marked.updatedAt = nowIso
      try { await persistNote(marked, { history: false }) } catch (e) { console.error('notes: schedule lastFiredAt mark failed', note.id, e); return false }
      const r = await _dispatch(note.id, { sessionId: sched.target, mode: 'existing', sourceLabel: '定时调度 @' + (marked.title || note.title || note.id) })
      if (r && r.error) {
        await _schedMarkError(note.id, '派发执行失败：' + r.error, nowMs, false)
        return false
      }
      // 状态三层①：lastRun{at,status,receiptId}（receiptId = 派发消息 msgId，与 dispatches 记录关联；回执闭环走既有 dispatch-loop 链路）
      const done = await loadNote(note.id)
      const doneSched = Object.assign({}, done.schedule, { lastRun: { at: nowIso, status: 'sent', receiptId: (r.dispatch && r.dispatch.msgId) || '' } })
      delete doneSched.lastError   // lastError 仅失败记：派发成功摘除
      done.schedule = doneSched
      done.updatedAt = nowIso
      try { await persistNote(done, { history: false }) } catch (e) { console.error('notes: schedule lastRun persist failed', note.id, e) }
      return true
    }

    // tick：全库扫描 contractType=dispatch-schedule + enabled!==false 的笔记逐一到期评估。全量吞异常（绝不扩散到主服务）。
    async function _schedTick(nowMs) {
      const out = { evaluated: 0, fired: 0, errors: 0 }
      let all
      try { all = await _list(undefined, undefined, undefined, false, true) } catch (e) { console.error('notes: schedule tick list failed', e); out.errors++; return out }
      for (const n of all) {
        try {
          if (!n || n.deleted || n.tombstoned) continue
          if ((n.contractType || '') !== SCHEDULE_CONTRACT_TYPE) continue
          const sched = n.schedule
          if (!sched || sched.enabled === false) continue
          out.evaluated++
          if (!schedDueAt(n, sched, nowMs)) continue
          if (await _schedFire(n, nowMs)) out.fired++; else out.errors++
        } catch (e) {
          // 单笔记异常全量吞掉记 lastError——任何一个调度笔记的故障绝不扩散到主服务与其它调度
          out.errors++
          console.error('notes: schedule tick note failed', n && n.id, e)
          try { await _schedMarkError(n && n.id, 'tick 执行异常：' + String(e && e.message || e), nowMs, true) } catch (e2) {}
        }
      }
      return out
    }

    // 防重叠闸：上一 tick 未跑完时本轮跳过（30s 周期内 _list 全量扫描未完成时绝不叠加）
    let schedTickRunning = false
    function _schedTickGuarded(nowMs) {
      if (schedTickRunning) return Promise.resolve({ evaluated: 0, fired: 0, errors: 0, skipped: 'running' })
      schedTickRunning = true
      return _schedTick(nowMs).then(function (r) { schedTickRunning = false; return r }, function (e) { schedTickRunning = false; console.error('notes: schedule tick failed', e); return { evaluated: 0, fired: 0, errors: 1 } })
    }

    // 定时调度立即评估（调试/UI「立即检查」通道；args.now 注入 ISO 时钟供测试与回放，缺省真实时钟）。返回 { evaluated, fired, errors }
    disposers.push(handle('notes-schedule-eval', async (args) => {
      try {
        const nowMs = args && args.now !== undefined ? Date.parse(args.now) : Date.now()
        if (!isFinite(nowMs)) return { error: 'notes-schedule-eval: now 非法（期望 ISO 时间串）' }
        return await _schedTickGuarded(nowMs)
      } catch (e) { return { error: String(e.message || e) } }
    }))

    // 常驻 cron 装配（裁决②）：30s tick + .unref() 不挂进程退出 + disposers cleanup（ctx.effect 于 index 尾模块统一消费，防重载双跑）；
    // 启动补评估（裁决⑤）：单次 at 停机错过 → 启动后补发一次；异步 fire-and-forget，异常全量吞掉
    let schedTimer = setInterval(function () { _schedTickGuarded(Date.now()) }, SCHED_TICK_MS)
    if (schedTimer && typeof schedTimer.unref === 'function') schedTimer.unref()
    disposers.push(function () { if (schedTimer) { clearInterval(schedTimer); schedTimer = null } })
    ;(async function () { try { await _schedTickGuarded(Date.now()) } catch (e) {} })()
    // ==== schedule-exec END ====
