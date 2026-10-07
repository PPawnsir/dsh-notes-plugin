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
    //     无 anchor 的存量 every 声明保持纯间隔语义（锚点 lastFiredAt||declaredAt||createdAt，0.4.6-F）——存量零迁移兼容。
    //   ⑨声明重锚（0.4.6-F，notes-046-sched-anchor）：schedule.declaredAt 机器字段（随 schedule JSON front-matter 落盘，已知键容忍输入但剥离）——
    //     声明字段（at/every/anchor/dow/target/action/enabled）任一变更或首次写入时，写入闸门刷新 declaredAt=当前时刻；
    //     声明未变更的改写（等价重提交/只改正文不过闸门）延续存量，缺省不留字段。到期锚点 = lastFiredAt || declaredAt || createdAt
    //     （字段缺省回退 = 存量零迁移）——修「编辑存量约定后当天误触发一轮」：旧口径锚点恒为 note.createdAt（编辑不推进），
    //     老约定（创建多日、从未触发）一经编辑 now-base 远超间隔即到期；重锚后锚点 = 本次声明时刻，下个调度点才触发。
    //     every+anchor 首触防过去候选（schedAnchorNextMs 注入 nowMs）：首触候选陈旧整天以上（base 陈旧）→ 对齐「now 之后第一个锚定时刻」
    //     ——首轮不补发，与⑤「轮询错过不追赶」口径对齐；当日内错过（轮询 tick 恒晚于锚点几秒~几分钟）→ 当日内补发
    //     （0.4.7 闸收紧，notes-047-anchor-firstfire：原「候选 < nowMs 即跳日」在 30s 轮询时钟下首触永不触发——次日 tick 再跳后日）；
    //     已触发分支与 at 单次停机补发语义（⑤）不动。
    //   ⑧专属会话 + 休眠送达（0.4.4-B，notes-044-dormant-dispatch）：target='new'（仅周期模式）= 首轮触发创建「定时 · <标题>」
    //     专属会话并随幂等生命线回写 target=新 sid（持久复用，后续轮次同 sid）；执行红线由「目标 live」改写为「目标可送达」——
    //     live 直通 / 持久化可达（stat 命中）走 _dispatch 休眠送达通道（durable inbox 排队，下次活动送达，零唤醒）；
    //     两路皆不可达才记 lastError 不推进 lastFiredAt（补发语义不变）。lastRun.status 新增 queued 枚举（休眠送达标记）。
    //   ⑩专属会话模型档位（0.4.6-G，notes-046-sched-model）：schedule 声明增可选 model/provider（成对出现、非空字符串；
    //     合法性不联网校验——创建时 agents.create 失败即落 lastError）。declared model/provider 透传 _schedCreateDedicatedSession
    //     的 agentOptions（覆盖宿主默认选择）；缺省 = 现状默认模型（存量零迁移）。声明变更比对键随之扩为九键（重锚口径不变）。
    // 序位说明（§8.4.2 例外备案）：本模块消费 dispatch.js 的 _dispatch 故置于其后；notes.js 的 _create/_update 经函数声明提升
    //   调用本模块的 _schedValidateWrite/SCHEDULE_CONTRACT_TYPE——全部为运行期（RPC 调用时）引用，apply 执行期零触碰，无 TDZ 风险。
    const SCHED_TICK_MS = 30 * 1000              // 常驻 tick 周期（裁决②）
    const SCHED_MIN_INTERVAL_MS = 5 * 60 * 1000  // 校验红线：轮询间隔 ≥5min
    const SCHED_ERR_RETRY_MS = 5 * 60 * 1000     // 执行失败 lastError 刷写节流（防 30s tick 对同一故障反复写盘）
    const SCHEDULE_CONTRACT_TYPE = 'dispatch-schedule'   // 契约身份标记（front-matter contractType，调度声明的主识别键）
    // 专属会话目标字面量（0.4.4-B，notes-044-dormant-dispatch）：schedule.target='new' = 周期任务专属会话——
    //   首轮触发时 agents.create 创建「定时 · <任务名>」会话并回写 target=新 sid（持久复用），后续轮次 live 直发/休眠送达复用同一会话。
    //   仅周期模式（every）接受；存量真实 sid 声明零迁移兼容（'new' 是保留字面量，绝非合法会话 id 形态——session-* 前缀约束天然隔离）。
    const SCHED_TARGET_NEW = 'new'

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
    //   首触（fired=false，base=declaredAt||createdAt，0.4.6-F）= base 之后第一个锚定时刻（weekly 限定 dow 星期几）；
    //   后续（fired=true，base=lastFiredAt）= base + 间隔 所在本地日的锚定时刻（weekly = 下一个 dow 锚定时刻）——
    //   触发延迟（停机错过）只推迟本次，后续仍落回同一时刻序列。
    //   0.4.6-F（notes-046-sched-anchor）首触防过去候选：注入 nowMs 时，首触候选陈旧（base 陈旧：declaredAt 重锚前存量/停机多日）
    //   → 对齐「now 之后第一个锚定时刻」（首轮不补发，与⑤轮询错过不追赶口径对齐）；已触发分支不注入该闸（停机补发一次语义保留）。
    //   0.4.7（notes-047-anchor-firstfire）闸收紧：「落在过去」改判「陈旧整天以上」——候选 < now 当日午夜才跳日/跳周对齐；
    //   候选仅在当日之内错过（nday0 ≤ 候选 < nowMs）正常返回 → 下个 tick 当日内补发（与⑤ at 单次停机补发语义对齐）。
    //   坑（测试时钟盲区）：真实运行是 30s 轮询时钟，tick 恒晚于锚点几秒~几分钟、打不中精确等号——原口径 first < nowMs 即跳日，
    //   新建锚定任务首触永不触发（次日 tick 再跳后日）；e2e/单元测试虚拟时钟精确对齐等号所以全绿，用户实测钓出。
    //   dow=0-6（0=周日，Date.getDay 口径）；ivMs 需整天倍数（写入闸门保证）。非法 → null
    function schedAnchorNextMs(anchor, dow, ivMs, baseMs, fired, nowMs) {
      const off = schedAnchorMs(anchor)
      if (off === null || !isFinite(baseMs) || !baseMs) return null
      const b = new Date(baseMs)
      const day0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()   // base 所在本地日午夜
      // 首触防过去候选闸（0.4.7 收紧）：nday0 = now 当日午夜——候选 < nday0（陈旧整天以上）才跳日/跳周对齐；当日内错过照常返回 → 下个 tick 补发
      const hasNow = typeof nowMs === 'number' && isFinite(nowMs)
      const nd0 = hasNow ? new Date(nowMs) : null
      const nday0 = nd0 ? new Date(nd0.getFullYear(), nd0.getMonth(), nd0.getDate()).getTime() : 0   // now 所在本地日午夜
      if (typeof dow === 'number') {
        // weekly：自 base 当日逐日找首个 getDay()===dow 且锚定时刻 > base 的候选（已触发 → 下周同 dow 准点；首触 → base 之后第一个 dow 锚定时刻）
        let firstDow = null
        for (let i = 0; i < 14; i++) {
          const dm = day0 + i * 86400000
          if (new Date(dm).getDay() === dow && dm + off > baseMs) { firstDow = dm + off; break }
        }
        if (firstDow === null) return null
        if (fired || !hasNow) return firstDow
        // 首触防过去候选（0.4.6-F → 0.4.7 收紧，与每日分支同法）：候选陈旧整天以上（< now 当日午夜）→ 对齐「now 之后第一个 dow 锚定时刻」
        //   （首轮不补发）；当日内错过（今日 dow 锚点刚过几分钟）不跳周——下个 tick 当日内补发
        if (firstDow < nday0) {
          for (let j = 0; j < 14; j++) {
            const dn = nday0 + j * 86400000
            if (new Date(dn).getDay() === dow && dn + off >= nowMs) return dn + off
          }
          return null
        }
        return firstDow
      }
      if (typeof ivMs !== 'number' || !isFinite(ivMs) || ivMs % 86400000 !== 0) return null
      if (fired) { const f = new Date(baseMs + ivMs); return new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime() + off }
      // 首触：base 当日锚定时刻未到 → 当日；已过 → 次日
      const first = (day0 + off > baseMs ? day0 : day0 + 86400000) + off
      // 首触防过去候选（0.4.6-F → 0.4.7 收紧 first < nday0 陈旧整天以上才跳）：对齐「now 之后第一个锚定时刻」（当日锚定未到 → 当日；已过 → 次日）
      if (hasNow && first < nday0) {
        return (nday0 + off >= nowMs ? nday0 : nday0 + 86400000) + off
      }
      return first
    }

    // 声明纯校验（同步部分：形状/未知键/动作/at 未来/every 下限；目标存活为异步部分由 _schedValidateWrite 补）。
    // 返回 { value: 归一化声明 } | { error }；机器状态字段（lastFiredAt/lastRun/lastError）容忍输入但剥离（由既有值延续，见 _schedValidateWrite）
    function schedCheckDecl(raw, nowMs) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'schedule 必须是对象 { at|every, target, action?, enabled?, anchor?, dow?, model?, provider? }' }
      // runLog（notes-041-sched-runlog）：执行记录独立笔记 id 软链——机器字段（回执链路懒创建回写），已知键容忍输入，闸门校验/延续见 _schedValidateWrite
      // declaredAt（0.4.6-F，notes-046-sched-anchor）：声明重锚时刻——机器字段（闸门赋值/延续），同列已知键容忍输入但剥离（防伪声明注入锚点）
      const known = { at: 1, every: 1, target: 1, action: 1, enabled: 1, anchor: 1, dow: 1, model: 1, provider: 1, lastFiredAt: 1, lastRun: 1, lastError: 1, runLog: 1, declaredAt: 1 }
      for (const k of Object.keys(raw)) {
        if (!known[k]) return { error: 'schedule 含未知字段 ' + k + '（声明只允许 at/every/anchor/dow/target/action/enabled/model/provider；错得安全：能力声明必须无歧义）' }
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
      // 专属会话（0.4.4-B）：target='new' 仅周期模式（every）接受——首轮触发自动创建并回写复用；单次 at 无复用场景一律拒绝（错得安全）
      if (target === SCHED_TARGET_NEW && !value.every) return { error: 'schedule.target=\'new\' 专属会话仅周期模式（every）支持——首轮触发自动创建「定时 · 任务名」会话并持久复用；单次 at 请直接指定目标会话 id' }
      // 专属会话模型档位（0.4.6-G，notes-046-sched-model）：model/provider 成对出现（单给其一即歧义拒绝），非空字符串；
      //   空串/null 视为未声明（同 anchor 口径）。合法性不联网校验——创建时 agents.create 失败即落 lastError（声明期零网络，同 at/anchor 纯校验口径）
      const hasModel = raw.model !== undefined && raw.model !== null && raw.model !== ''
      const hasProvider = raw.provider !== undefined && raw.provider !== null && raw.provider !== ''
      if (hasModel !== hasProvider) return { error: 'schedule.model 与 schedule.provider 必须成对出现（专属会话模型档位，单给其一有歧义——错得安全）' }
      if (hasModel) {
        if (typeof raw.model !== 'string' || typeof raw.provider !== 'string') return { error: 'schedule.model/provider 必须是字符串（实得 model:' + typeof raw.model + ' / provider:' + typeof raw.provider + '）' }
        const mv = String(raw.model).trim(), pv = String(raw.provider).trim()
        if (!mv || !pv) return { error: 'schedule.model/provider 不能是空白字符串（错得安全：能力声明必须无歧义）' }
        value.model = mv; value.provider = pv
      }
      return { value: value }
    }

    // 声明字段等价比对（0.4.6-F，notes-046-sched-anchor）：at/every/anchor/dow/target/action/enabled 七键 + 0.4.6-G model/provider 九键——
    //   undefined/null/空串归一为空串比对；任一差异 = 声明变更（declaredAt 重锚触发条件）。
    //   归一化声明（action/enabled 由闸门补齐缺省）与存量比对时，存量缺键（如裸编辑旁路未带 action）按变更处理——保守刷新安全向。
    function schedDeclChanged(decl, ex) {
      const keys = ['at', 'every', 'anchor', 'dow', 'target', 'action', 'enabled', 'model', 'provider']
      for (const k of keys) {
        const a = decl[k], b = ex && ex[k]
        const an = (a === undefined || a === null || a === '') ? '' : String(a)
        const bn = (b === undefined || b === null || b === '') ? '' : String(b)
        if (an !== bn) return true
      }
      return false
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
    // existingSched = 存量 schedule（update 场景）：声明字段被覆盖，机器状态字段（lastFiredAt/lastRun/lastError/runLog）延续——
    //   防重锚点对声明变更自洽（at 改新未来时刻：旧 lastFiredAt < 新 at 自然再触发一次；every 已触发变更：锚点不动对齐下周期）；
    //   declaredAt（0.4.6-F）属机器字段但语义相反——声明字段变更/首次写入时刷新为当前时刻（重锚），未变更改写延续。
    async function _schedValidateWrite(raw, contractType, existingSched) {
      if (raw === null) {
        // 显式清除：契约仍是 dispatch-schedule 时拒绝（契约 ⟺ 声明配对不变量，防悬空调度笔记）
        if ((contractType || '') === SCHEDULE_CONTRACT_TYPE) return { error: 'contractType=dispatch-schedule 需要 schedule 声明；解除调度请同时清除 contractType（contractType: \'\' + schedule: null）' }
        return { value: null }
      }
      if ((contractType || '') !== SCHEDULE_CONTRACT_TYPE) return { error: 'schedule 字段仅允许 contractType=dispatch-schedule 的约定笔记（错得安全：会真执行动作的能力声明必须显式契约分型）' }
      const nowMs = Date.now()
      const chk = schedCheckDecl(raw, nowMs)
      if (chk.error) return { error: chk.error }
      const decl = chk.value
      // 校验红线③目标存活：enabled=false（停用/暂停）豁免——暂停操作随时可落，不因目标漂移锁死治理面；
      //   target='new'（0.4.4-B 专属会话）同豁免——首轮触发时才创建，声明期无目标可校验
      if (decl.enabled !== false && decl.target !== SCHED_TARGET_NEW) {
        const aliveErr = await _schedTargetAliveErr(decl.target)
        if (aliveErr) return { error: aliveErr }
      }
      const ex = existingSched || {}
      if (ex.lastFiredAt) decl.lastFiredAt = ex.lastFiredAt
      if (ex.lastRun) decl.lastRun = ex.lastRun
      if (ex.lastError) decl.lastError = ex.lastError
      // declaredAt（0.4.6-F，notes-046-sched-anchor 声明重锚）：声明字段（schedDeclChanged 九键，0.4.6-G 扩 model/provider）任一变更或首次写入 → 刷新为当前时刻
      //   （到期锚点由陈旧 createdAt 改为本次声明时刻，修「编辑存量约定当天误触发」；输入携带的 declaredAt 已被 schedCheckDecl 剥离，
      //   此处纯机器赋值/延续，伪声明无法注入锚点）；声明未变更的改写延续存量 declaredAt，存量缺省不留字段（到期回退 createdAt，零迁移）
      if (!existingSched || schedDeclChanged(decl, ex)) decl.declaredAt = new Date(nowMs).toISOString()
      else if (ex.declaredAt) decl.declaredAt = ex.declaredAt
      // runLog 软链（notes-041-sched-runlog）：显式声明须为存在的笔记 id（空串 = 显式解除软链，runLog 笔记留档不级联删）；
      //   缺省（未携带）延续存量——声明改写（编辑/暂停/恢复只提交声明字段）不丢软链
      if (raw.runLog !== undefined && raw.runLog !== null) {
        if (raw.runLog === '') { /* 显式解除软链：decl 不带 runLog */ }
        else {
          if (typeof raw.runLog !== 'string') return { error: 'schedule.runLog 必须是笔记 id 字符串或空串（实得 ' + typeof raw.runLog + '）' }
          const rlId = raw.runLog.trim()
          let rlOk = false
          try { const t = await loadNote(rlId); rlOk = !!(t && !t.deleted && !t.tombstoned) } catch (e) {}
          if (!rlOk) return { error: 'schedule.runLog 必须是存在的笔记 id 或空（实得 ' + raw.runLog + '）' }
          decl.runLog = rlId
        }
      } else if (ex.runLog) decl.runLog = ex.runLog
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
    //   every：锚点 = lastFiredAt || declaredAt || createdAt（0.4.6-F 声明重锚：declaredAt=声明最近写入时刻，缺省回退 createdAt 存量零迁移）；
    //     now - 锚点 ≥ 间隔 → 到期（触发后 lastFiredAt=本次时刻对齐下周期，错过不追赶）；
    //   every + anchor（notes-034-sched-time 锚定时刻）：到期 = now ≥ 锚定序列下一时刻（schedAnchorNextMs 注入 nowMs——
    //     首触防过去候选：候选陈旧整天以上对齐下一轮不补发（0.4.6-F；0.4.7 收紧——当日内错过当日内补发，notes-047-anchor-firstfire）；钉死本地 HH:MM 不漂移）；
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
      const declaredMs0 = sched.declaredAt ? Date.parse(sched.declaredAt) : 0
      const declaredMs = isFinite(declaredMs0) ? declaredMs0 : 0
      const base = firedMs || declaredMs || Date.parse(note.createdAt || '') || 0
      if (sched.anchor) {
        const next = schedAnchorNextMs(sched.anchor, typeof sched.dow === 'number' ? sched.dow : undefined, iv, base, !!firedMs, nowMs)
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

    // 专属会话创建（0.4.4-B）：agents.create 真实 agent（走注册 factory——持久化写把手 + 会话注册一体），
    //   setup 内 agentPresets.mount 绑定默认 preset（同 session-controller composeAgent 口径——无 preset 的裸 agent 无工具能力）；
    //   workspace.attachSession 落账（GUI 左侧列表可见性——工作区 sessionIds 经 header cwd 校验归组）；
    //   sessionTitle.rename 命名「定时 · <任务名>」（观察面，失败不阻塞主链路）。
    //   孤儿探测（0.4.5-A notes-045-debt-host）：创建前先按标题探测工作区账目内既有同名专属会话（target 回写失败窗口遗留），
    //   命中即复用其 sid 返回（reused:true，handle=null——非本轮创建，调用方回收路径跳过），未命中才新建（防重复建会话）。
    //   归属模型（实测结论）：create 经调用方 fiber 归属——插件重载/卸载会 dispose 该 agent，但会话日志已持久化，
    //   退化为休眠态（GUI 可见、用户打开即复活），后续触发由休眠送达通道（_queueDormantDispatch）承接，优雅降级不丢任务。
    //   返回 { sessionId, handle, name } | { error }；失败方负责回收半成品（handle.dispose），调用方零清理负担。
    async function _schedCreateDedicatedSession(note) {
      if (!agents || typeof agents.create !== 'function') return { error: '宿主不支持 agents.create（无法创建专属会话）' }
      if (!agentPresets || typeof agentPresets.resolve !== 'function' || typeof agentPresets.mount !== 'function') return { error: 'agentPresets 服务缺失（专属会话需挂载默认 preset 获得工具能力）' }
      // 工作区归属：note.workspace 标题命中优先（笔记创建时自会话上下文自动填充），缺省回落首个工作区
      const wl = workspaceRegistry && workspaceRegistry.list ? workspaceRegistry.list() || [] : []
      if (!wl.length) return { error: '无可用工作区（专属会话无处归属）' }
      let ws = null
      const wtitle = String((note && note.workspace) || '').trim()
      if (wtitle) { for (const w of wl) { if (w && (w.title || '') === wtitle) { ws = w; break } } }
      if (!ws) ws = wl[0]
      const cwd = String((ws && ws.path) || '').trim()
      if (!cwd) return { error: '工作区缺 path（专属会话无 cwd 不可创建）' }
      const name = '定时 · ' + String((note && note.title) || '任务').replace(/^定时\s*·?\s*/, '')
      // 孤儿专属会话探测（0.4.5-A notes-045-debt-host，B 卡 verifier 遗留④）：「agents.create 成功但 target 回写落盘失败/
      //   进程崩溃于回写前」的极端窗口下，工作区账目里已存在上次创建的同名专属会话——下 tick 若不探测会重复创建。
      //   修复：创建前先按标题「定时 · <任务名>」探测既有专属会话（工作区 sessionIds 账目 + readTitleSnapshots 批量读标题，
      //   live/持久化双覆盖，同 _activeSessions 数据源口径），命中则复用其 sid 回写 target（零新建），未命中才走新建。
      //   探测失败（服务缺失/读盘异常）静默降级为直接新建——与改造前行为等价，不扩散主链路。
      try {
        const archivedSet = {}
        const arch0 = workspaceRegistry && workspaceRegistry.archivedSessionIds
        if (Array.isArray(arch0)) { for (const id of arch0) archivedSet[id] = true }
        const candIds = ((ws && ws.sessionIds) || []).filter(function (s) { return s && !archivedSet[s] })
        if (candIds.length && sessionQuery && typeof sessionQuery.readTitleSnapshots === 'function') {
          const snaps = await sessionQuery.readTitleSnapshots(candIds)
          for (const r of (snaps || [])) {
            if (!r || r.status !== 'fulfilled' || !r.value) continue
            const rt = r.value.title && r.value.title.title
            const rsid = r.sessionId || (r.value.session && r.value.session.id)
            // 标题精确命中专属会话命名形态即复用；handle=null（复用会话非本轮创建，调用方 dispose 回收路径天然跳过）
            if (rt === name && rsid) return { sessionId: rsid, handle: null, name: name, reused: true }
          }
        }
      } catch (e) {}
      let presetId
      try { const p = await agentPresets.resolve(); presetId = p && p.id } catch (e) { return { error: 'preset 解析失败：' + String(e && e.message || e) } }
      // 0.4.6-G（notes-046-sched-model）：声明档位 model/provider 优先（写入闸门保证成对非空；合法性=agents.create 成败即 lastError，此处零校验）；
      //   缺省回落宿主当前选择（adm.currentSelection）——无声明存量任务行为零变化（存量零迁移红线）
      const declSel = (function () { const sc = (note && note.schedule) || {}; return (typeof sc.provider === 'string' && sc.provider && typeof sc.model === 'string' && sc.model) ? { provider: sc.provider, model: sc.model } : null })()
      const sel = declSel || (adm && typeof adm.currentSelection === 'function' ? adm.currentSelection() : null)
      const sid = 'session-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
      let handle = null
      try {
        handle = await agents.create({
          sessionId: sid,
          agentOptions: sel ? { provider: sel.provider, model: sel.model } : {},
          meta: presetId ? { cwd: cwd, agentPreset: presetId } : { cwd: cwd },
          // setup 契约（0.4.5 热修，活机故障「(intermediate value)?.commit is not a function」实锤）：宿主
          //   dsh-agent-loop setupAndPublish 对 setup 返回值调 `?.commit()`——mount 返回 disposer 函数会炸。
          //   正解（session-controller composeAgent 同款）：await 掉 mount，setup 本身返回 undefined（?. 短路安全）。
          setup: async function (agentCtx) { await agentPresets.mount(agentCtx, presetId) }
        })
      } catch (e) { return { error: 'agents.create 失败：' + String(e && e.message || e) } }
      // GUI 可见性落账（致命）：失败回收 agent 报错（lastFiredAt 未推进，下 tick 重试创建）
      try { if (typeof ws.attachSession === 'function') await ws.attachSession(sid) } catch (e) {
        try { if (handle && typeof handle.dispose === 'function') await handle.dispose() } catch (e2) {}
        return { error: '工作区落账失败：' + String(e && e.message || e) }
      }
      // 命名（非致命观察面：失败时 GUI 显示缺省标题，不阻塞派发）
      try { if (sessionTitle && typeof sessionTitle.rename === 'function' && handle && handle.agent && handle.agent.session) sessionTitle.rename(handle.agent.session, name) } catch (e) {}
      return { sessionId: sid, handle: handle, name: name }
    }

    // 单笔记触发：专属会话首轮创建（target='new'）→ 可送达预检 → 标记 lastFiredAt 落盘（幂等生命线，先于派发）→ _dispatch 全链路 → lastRun 回写
    async function _schedFire(note, nowMs) {
      const nowIso = new Date(nowMs).toISOString()
      const sched = note.schedule
      // 专属会话（0.4.4-B）：target='new' → 首轮触发先创建「定时 · <标题>」会话，target 回写随幂等生命线同事务落盘（持久复用）
      let created = null
      let effTarget = sched.target
      if (sched.target === SCHED_TARGET_NEW) {
        created = await _schedCreateDedicatedSession(note)
        if (!created || created.error) {
          await _schedMarkError(note.id, '专属会话创建失败：' + (created && created.error || 'unknown'), nowMs, true)
          return false   // 不推进 lastFiredAt——下个 tick 自动重试创建
        }
        effTarget = created.sessionId
      } else {
        // 执行红线（0.4.4-B 改写：目标 live ⟹ 可送达）：live 直通；非 live 探持久化可达（stat 命中 = 休眠送达可排队）——
        //   两路皆不可达 → 记 lastError（节流）不推进 lastFiredAt（目标上线/可送达后下个 tick 自动补发）
        const target = agents && agents.get ? agents.get(effTarget) : undefined
        if (!target || typeof target.send !== 'function') {
          let reachable = false
          try { reachable = !!(sessionPersistence && typeof sessionPersistence.stat === 'function' && (await sessionPersistence.stat(effTarget))) } catch (e) {}
          if (!reachable) {
            await _schedMarkError(note.id, '目标会话当前未打开且持久化不可达，无法触发工作（目标 live 或可送达后下个 tick 自动补发）', nowMs, true)
            return false
          }
        }
      }
      // 幂等生命线：先推进 lastFiredAt 落盘再派发（专属会话首轮：target=新 sid 同事务回写）——进程在「派发后、lastRun 回写前」崩溃最多漏记一次 lastRun，绝不重发同一触发
      const marked = await loadNote(note.id)
      if (!marked || marked.deleted || marked.tombstoned || !marked.schedule || (marked.contractType || '') !== SCHEDULE_CONTRACT_TYPE) {
        if (created && created.handle && typeof created.handle.dispose === 'function') { try { await created.handle.dispose() } catch (e) {} }
        return false
      }
      const markedSched = Object.assign({}, marked.schedule, { lastFiredAt: nowIso })
      if (created) markedSched.target = created.sessionId   // 专属会话持久复用锚点：次轮起按真实 sid 走 live/休眠双通道
      delete markedSched.lastError   // lastError 仅失败记：进入成功路径即摘除（不留空串脏键）
      marked.schedule = markedSched
      marked.updatedAt = nowIso
      try { await persistNote(marked, { history: false }) } catch (e) {
        console.error('notes: schedule lastFiredAt mark failed', note.id, e)
        if (created && created.handle && typeof created.handle.dispose === 'function') { try { await created.handle.dispose() } catch (e2) {} }   // 落盘失败回收新建 agent（防孤儿 live 会话）
        return false
      }
      const r = await _dispatch(note.id, { sessionId: effTarget, sessionName: created ? created.name : undefined, mode: 'existing', sourceLabel: '定时调度 @' + (marked.title || note.title || note.id) })
      if (r && r.error) {
        await _schedMarkError(note.id, '派发执行失败：' + r.error, nowMs, false)
        return false
      }
      // 状态三层①：lastRun{at,status,receiptId}（status：sent=live 直发 / queued=休眠送达·下次活动处理（0.4.4-B 新增枚举值，存量 sent/error 不变）；
      //   receiptId = 派发消息 msgId，与 dispatches 记录关联；回执闭环走既有 dispatch-loop 链路）
      const done = await loadNote(note.id)
      const doneSched = Object.assign({}, done.schedule, { lastRun: { at: nowIso, status: r && r.queued ? 'queued' : 'sent', receiptId: (r.dispatch && r.dispatch.msgId) || '' } })
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
      // 效用账本顺带刷新（0.4.3⑥ notes-043-ledger）：仅在有调度实际触发时（fired>0）顺带跑一轮指标快照（卡⑤：落 telemetry.json）+档案回填——
      // 只 evaluated 不 fired 的普通 tick 不刷新（防后台 tick 与在途断言/写入交错）；10min 节流在 _ledgerRefresh 内部；
      // 全量吞异常——账本是观察面产物，任何故障绝不扩散到调度主链路（同 tick 吞异常裁决）
      if (out.fired > 0) { try { await _ledgerRefresh({ trigger: 'cron' }) } catch (e) { console.error('notes: ledger cron refresh failed', e) } }
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

    // ==== schedule-runlog BEGIN ====（notes-041-sched-runlog：执行记录独立笔记 + schedule.runLog 软链；
    //   0.4.4-A notes-044-dispatch-receipts 升级·三表归一：执行记录 = 派发历史 = 调度回执 同一篇伴生笔记——
    //   每篇派发源笔记 ≤1 篇「执行记录 · <源笔记标题>」（设计修正·用户最新裁决 2026-10-05：kind=log 工作日志型——
    //   注入硬关天然适用（回执永不进系统提示）、可见/可搜/可编辑照常 + folder='执行记录' 专用文件夹（懒创建 ensure；
    //   严禁放「工作日志」夹——工作日志=会话沉淀、执行记录=派发回执，语义不同分目录存放）+ refNote=源笔记 id 回链 +
    //   软链字段统一 runLog：调度约定存 schedule.runLog（存量直接继承零迁移），非调度派发源笔记存顶层 runLog front-matter 条件行）。
    // 设计红线（用户裁决 2026-10-04 晚）：约定正文零改动——克隆体约定正文=派发载荷（整体注入 target 会话），
    //   历史追加会无限膨胀并污染下次派发上下文；执行记录落独立笔记（0.4.4-A 起 kind=log——recall 缺省 false 不进目录/默认召回、
    //   inject 硬闸强制 false（injectForcedOff）；存量 kind=sys 的 runLog 零迁移原样留档，软链指针无关 kind 照常命中），
    //   front-matter 软链存其 id；
    //   回执落盘时机（idle 事件 / resolved 保底 / 手动标记完成三通道共用）懒创建并追加条目；条目倒序（最新在前）≤50 裁尾；
    //   幂等：同 msgId（=lastRun.receiptId）条目已存在跳过；删除约定不级联删 runLog（留档）。
    // 0.4.4-A 行型三族：📤 派发行（_dispatch 成功即落——派发历史笔记化）/ 📥 回执行（idle/resolved 真实回执）/ ✅ 人工闭环行
    //   （_dispatchDone 手动标记）；dispatches[] 数组与 dispatchStatus 状态机零改动（结构化状态给闭环逻辑，笔记行给人读——双载体正交）。
    // 写入纪律：runLog 笔记创建/追加与 runLog 软链回写都是机器自动产物——persistNote { history:false } 不产生历史快照；
    //   软链回写直改 schedule/runLog 不经 _update 声明闸门（避免目标存活等声明校验阻塞回执链路；声明改写时 runLog 由 _schedValidateWrite 延续存量）。
    // 序位：本块跨模块调用点（dispatch.js/notes.js）经函数声明提升在运行期引用，apply 执行期零触碰，无 TDZ 风险（同 _schedValidateWrite 先例）。
    const SCHED_RUNLOG_MAX = 50                        // 条目容量红线：倒序保留最新 50 条裁尾
    const SCHED_RUNLOG_HEAD = '## 执行记录（自动）'     // runLog 笔记正文的自动管理节标题
    const EXEC_LOG_FOLDER_NAME = '执行记录'             // 0.4.4-A 设计修正：伴生笔记专用文件夹（懒创建 ensure folders.json 条目；严禁复用「工作日志」夹）
    // 说明块（预设首行，RootNote pre 区逐字节保留）：机器托管声明 + kind=log 用途 + 行型契约 + 可编辑边界
    const EXEC_LOG_GUIDE = '机器托管笔记（请勿手动清理，由派发管线维护）：本笔记 = 派发源笔记的执行记录（0.4.4-A 三表归一：派发历史/调度回执/执行记录同一篇；kind=log 工作日志型——注入硬关天然适用，回执永不进系统提示）。行型：📤 派发（带（下次活动送达）后缀 = 休眠会话排队送达，0.4.4-B）/ 📥 回执 / ✅ 人工闭环；可直接编辑备注，请保持条目行首 `- 📤/📥/✅` 结构。\n\n'
    // 条目时间戳：ISO → 本地 YYYY-MM-DD HH:MM（人读优先；与调度 at 声明同口径的本地墙钟语义）
    function schedRunLogTs(iso) {
      const ms = Date.parse(iso || '')
      if (!isFinite(ms)) return String(iso || '')
      const d = new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }
    // 派发行时间戳（0.4.4-A）：秒级精度——同分钟连发可区分（行幂等键成分；崩溃重放同秒同文天然去重）
    function schedRunLogTsS(iso) {
      const ms = Date.parse(iso || '')
      if (!isFinite(ms)) return String(iso || '')
      const d = new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
    }
    // 回执条目行：- 📥 {本地时刻} · 回执（{idle|resolved}）· → {会话名|短id} · {msgId}（真实回执）；人工闭环 = ✅（回执（manual））。
    //   0.4.4-A 起真实回执前缀 ✅→📥（设计「📥 回执：<会话> <时间>」）；存量 ✅ 行零迁移原样保留（msgId 幂等键跨新旧行型同口径）
    function schedRunLogLine(d) {
      return '- ' + (d.receipt === 'manual' ? '✅' : '📥') + ' ' + schedRunLogTs(d.doneAt) + ' · 回执（' + (d.receipt || 'manual') + '）· → ' + (d.sessionName || shortSid(d.sessionId) || '?') + ' · ' + d.msgId
    }
    // 派发条目行（0.4.4-A 派发历史笔记化）：- 📤 {本地时刻·秒级} · → {会话名|短id}[（下次活动送达）][ · 指令：{摘要≤40字}][ · {sourceLabel}] · 单号 {msgId 尾段}。
    //   （下次活动送达）后缀（0.4.4-B）：休眠送达（queued）派发专属标注——目标会话未 live，消息已持久化排队，会话下次活动时处理。
    //   红线：行内绝不出现完整 msgId（note-dispatch-* 前缀形态）——keyOfLine 的 msgId 提取与正文 indexOf 幂等去重专属回执族，
    //   派发行混入完整 msgId 会让同 msgId 回执行被误吞；单号尾段 = 行幂等键成分（同秒连发区分 + 崩溃重放同 msgId 去重）兼人读派发↔回执对参
    function schedRunLogDispatchLine(d) {
      let l = '- 📤 ' + schedRunLogTsS(d.at) + ' · → ' + (d.sessionName || shortSid(d.sessionId) || '?') + (d.queued ? '（下次活动送达）' : '')
      const instr = String(d.instruction || '').replace(/[\r\n]+/g, ' ').trim()
      if (instr) l += ' · 指令：' + (instr.length > 40 ? instr.slice(0, 40) + '…' : instr)
      if (d.sourceLabel) l += ' · ' + String(d.sourceLabel)
      const tail = String(d.msgId || '')
      if (tail) l += ' · 单号 ' + (tail.indexOf('note-dispatch-') === 0 ? tail.slice(14) : tail)
      return l
    }
    // 正文重写已上收 RootNote 托管节框架（0.4.3 内核②，notes-043-rootnote）：锚点补建/幂等去重/裁尾/备注区保留
    //   由 src/host/rootnote.js rootNoteRender 统一实现——runLog 是首个消费者，行为等价迁移（节 59 断言不改语义仍全绿 = 等价证明）。
    // runLog 消费者模板：锚点节标题 + 容量 50 + 新→旧排序 + note-dispatch msgId 幂等键 + schedule.runLog 软链键
    const SCHED_RUNLOG_TPL = {
      head: SCHED_RUNLOG_HEAD,
      max: SCHED_RUNLOG_MAX,
      newestFirst: true,
      // 行幂等键：回执族 = 行内 note-dispatch-* msgId；派发行（无 msgId）= 整行（秒级时刻+会话+指令摘要区分连发）
      keyOfLine: function (l) { const m = l.match(/(note-dispatch-\S+)/); return m ? m[1] : l },
      // 条目幂等键：回执 = msgId（=lastRun.receiptId）——与正文 indexOf 命中同口径；派发 = 整行渲染（正文子串命中同口径）
      keyOfEntry: function (d) { return d._dispatch ? schedRunLogDispatchLine(d) : d.msgId },
      lineOf: function (d) { return d._dispatch ? schedRunLogDispatchLine(d) : schedRunLogLine(d) },
      // 软链键统一 runLog（0.4.4-A 裁决·三表归一）：调度约定读 schedule.runLog（存量继承），非调度派发源笔记读顶层 runLog
      linkOf: function (note) { return (note.schedule && note.schedule.runLog) || note.runLog || '' },
      // 软链回写：调度约定写 schedule.runLog、非调度写顶层 runLog（直读最新笔记对象防 tick 在途改写被覆盖；机器状态回写零历史快照）；
      //   顺手给执行记录笔记落 refNote=源笔记 id 回链（0.4.4-A 设计① 双端跳转的机器键；同 { history:false } 口径）
      writeLink: async function (note, rlId) {
        const fresh = await loadNote(note.id)
        if (fresh && !fresh.deleted && !fresh.tombstoned) {
          if (fresh.schedule) fresh.schedule = Object.assign({}, fresh.schedule, { runLog: rlId })
          else fresh.runLog = rlId
          fresh.updatedAt = new Date().toISOString()
          try { await persistNote(fresh, { history: false }) } catch (e) { console.error('notes: schedule runLog link persist failed', note.id, e) }
        }
        try {
          const rl = await rootNoteResolve(rlId)
          if (rl && String(rl.refNote || '') !== String(note.id)) {
            rl.refNote = String(note.id)
            rl.updatedAt = new Date().toISOString()
            await persistNote(rl, { history: false })
          }
        } catch (e) {}
      },
      titleOf: function (note) { return '执行记录 · ' + String(note.title || note.id) },
      // 0.4.4-A 设计修正（用户最新裁决）：kind=log 工作日志型——注入硬关天然适用（injectForcedOff 强制 inject=false、
      //   recall 缺省 false），可见/可搜/可编辑照常；存量 kind=sys runLog 零迁移（软链指针无关 kind 照常命中）
      kind: 'log',
      // 说明块（preText）：创建正文 = 机器托管声明 + 锚点节（RootNote pre 区逐字节保留）
      preText: EXEC_LOG_GUIDE,
      // folder 设计修正（0.4.4-A）：'执行记录' 专用夹——缺省未分类（undefined）；_schedRunLogAppend 懒创建路径先 ensure 夹条目再覆写为夹 id
      folderOf: function (note) { return undefined },
      topicOf: function (note) { return note.topic || '未分类' }
    }
    // 执行记录文件夹 ensure（0.4.4-A 设计修正②）：「执行记录」专用文件夹懒创建——resolveFolderRef 命中（id/名称双通道）直接复用；
    //   未命中经 rootNoteCreateLock 串行化创建 + 锁内双检（并发首建竞态消除；同 ledger「记忆档案」_ledgerArchiveFolderEnsure 先例）。
    //   红线：必须在 rootNoteAppendEnsured 的创建锁之外调用（嵌套同链 = 自死锁，rootnote 红线③）；失败 → '' 降级未分类，不扩散主链路。
    async function _execLogFolderEnsure() {
      try {
        const hit = await resolveFolderRef(EXEC_LOG_FOLDER_NAME)
        if (hit && hit.id) return hit.id
        return await rootNoteCreateLock(async function () {
          const again = await resolveFolderRef(EXEC_LOG_FOLDER_NAME)   // 锁内双检：并发 ensure 前者产物已落 folders.json，命中即复用
          if (again && again.id) return again.id
          const c = await _folders({ op: 'create', name: EXEC_LOG_FOLDER_NAME, sys: true })   // 0.4.4-G：机器属性创建直入（自动沉淀夹默认隐身；幂等——命中复用路径不触碰 sys，用户摘除墓碑不回弹）
          return (c && c.ok && c.folder) ? c.folder.id : ''
        })
      } catch (e) { return '' }
    }
    // 执行记录落盘挂钩（0.4.4-A 起全笔记生效·三表归一；四通道共用：dispatch.js _dispatch 派发 📤 / _receiptDispatchesForSession
    //   idle 事件 📥 / _dispatchDone 手动标记 ✅ / notes.js _update resolved 保底 📥）。
    //   软链空/失效 → 懒创建执行记录笔记并回写软链；条目追加幂等；异常全量吞掉——执行记录是观察面产物，任何故障绝不扩散派发/回执主链路。
    async function _schedRunLogAppend(note, entries) {
      try {
        if (!note || !note.id) return
        const items = (entries || []).filter(function (d) { return d && (d.msgId || d._dispatch) })
        if (!items.length) return
        let tpl = SCHED_RUNLOG_TPL
        // 懒创建路径才 ensure 归夹（0.4.4-A 设计修正：folder='执行记录' 专用夹——folders.json 条目懒创建；
        //   在 rootNoteAppendEnsured 创建锁外求值（嵌套同链 = 自死锁红线不触）；ensure 失败 → '' 降级未分类）
        if (!((note.schedule && note.schedule.runLog) || note.runLog)) {
          const fid = await _execLogFolderEnsure()
          if (fid) tpl = Object.assign({}, SCHED_RUNLOG_TPL, { folderOf: function () { return fid } })
        }
        // RootNote 框架组合口：懒创建（首条派发/回执）+ 幂等追加 + ≤50 裁尾 + 落盘 { history:false }——异常吞在下方
        await rootNoteAppendEnsured(note, tpl, items)
      } catch (e) { console.error('notes: schedule runLog append failed', note && note.id, e) }
    }
    // ==== schedule-runlog END ====
