    const shortSid = (sid) => sid ? String(sid).replace(/^session-/, '').slice(0, 8) : ''
    // injectTo 勾选态归一比对（notes-034-injectto-norm）：存量长 id 经 shortSid 约到短 id 再比——勾选渲染/范围文字/取消勾选三处同口径
    // （host 写入路径已归一兜底，本函数兜住存量长 id 数据在浮层打开时显示为已勾选；app kernel/helpers.js 与原型 notes-ui-v2.html 同口径）
    const scopeHas = (arr, short) => (arr || []).some(t => shortSid(t) === short)
    // P3 派发闭环：单条派发完成判定（dispatchStatus==='done' 或存量 done===true 向后兼容）——host 三通道回执：idle 事件 / resolved 联动 / 手动标记
    const isDispatchDone = (d) => !!(d && (d.dispatchStatus === 'done' || d.done === true))
    // 字节数人性化（归档预览组的 totalBytes 展示用）
    const fmtBytes = (n) => { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB' }
    // 历史版本时间戳（UTC ms）→ 本地可读串（历史面板版本列表/预览/confirm 共用）
    const fmtHistTs = (ts) => { const d = new Date(+ts || 0); if (isNaN(d.getTime())) return String(ts); const p = (x) => ('0' + x).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) }
    // 时间戳渲染统一本地时区（R-5，n-mut3u5xghl1u；与 app 侧 helpers.js fmtDT 同口径）：host 落盘 UTC ISO → 本地 YYYY-MM-DD HH:mm，
    // 与自动保存指示（本地 HH:mm）同区——编辑器底栏/树列表/派发记录/归档/回收站/整理建议的日期段全走本函数切片
    // （YYYY-MM-DD 取 slice(0,10)，MM-DD 取 slice(5,10)，MM-DD HH:mm 取 slice(5)）；无效/非 ISO 值回退旧切片（防御，不抛错）
    const fmtDT = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' '); const p = (x) => ('0' + x).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) }
    // ===== 定时派发·调度 helper（notes-034-sched-ui；与 host schedule.js 同口径的纯函数前端镜像——表单与 front-matter 同一数据源两个视图，无第二份存储） =====
    // every 声明 → 毫秒：number 直给（毫秒）；字符串 '<n>m|<n>h|<n>d|<n>w'（分钟/小时/天/周）。非法 → null（同 host schedEveryMs）
    const schedEveryMs = (every) => {
      if (typeof every === 'number' && isFinite(every) && every > 0) return Math.floor(every)
      if (typeof every === 'string') {
        const m = every.trim().match(/^(\d+)([mhdw])$/)
        if (m) { const n = parseInt(m[1], 10); const unit = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]]; return n * unit }
      }
      return null
    }
    // 锚定时刻（notes-034-sched-time）：'HH:MM' → 当日分钟偏移 ms（本地墙钟）；非法 → null（同 host 闸门 ^([01]\d|2[0-3]):[0-5]\d$）
    const schedAnchorMs = (anchor) => {
      const m = typeof anchor === 'string' ? anchor.match(/^([01]\d|2[0-3]):([0-5]\d)$/) : null
      return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60000 : null
    }
    // 锚定时刻序列（同 host schedDueAt 锚定分支口径）：触发时刻钉死本地 HH:MM，不随创建/触发时刻漂移——
    // 首触（fired=false，base=declaredAt||createdAt，0.4.6-F）= base 之后第一个锚定时刻（weekly 限定 dow 星期几）；
    // 后续（fired=true，base=lastFiredAt）= base + 间隔 所在本地日的锚定时刻（weekly = 下一个 dow 锚定时刻）。
    // 0.4.6-F 首触防过去候选：注入 nowMs 时首触候选陈旧（base 陈旧）→ 对齐「now 之后第一个锚定时刻」（首轮不补发，同 host）。
    // 0.4.7 闸收紧（notes-047-anchor-firstfire，同 host）：「落在过去」改判「陈旧整天以上」——候选 < now 当日午夜才跳日/跳周对齐；
    // 当日内错过（轮询 tick 恒晚于锚点几分钟，30s 轮询打不中精确等号）正常返回 → 当日内补发。
    // dow=0-6（0=周日，Date.getDay 口径）；ivMs 需整天倍数。非法 → null
    const schedAnchorNextMs = (anchor, dow, ivMs, baseMs, fired, nowMs) => {
      const off = schedAnchorMs(anchor)
      if (off === null || !isFinite(baseMs) || !baseMs) return null
      const b = new Date(baseMs), day0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
      // 首触防过去候选闸（0.4.7 收紧，同 host）：nday0 = now 当日午夜——候选 < nday0（陈旧整天以上）才跳日/跳周对齐，当日内错过照常返回补发
      const hasNow = typeof nowMs === 'number' && isFinite(nowMs)
      const nd0 = hasNow ? new Date(nowMs) : null
      const nday0 = nd0 ? new Date(nd0.getFullYear(), nd0.getMonth(), nd0.getDate()).getTime() : 0   // now 所在本地日午夜
      if (typeof dow === 'number') {
        // weekly：自 base 当日逐日找首个 getDay()===dow 且锚定时刻 > base 的候选（已触发 → 下周同 dow 准点；首触 → base 之后第一个 dow 锚定时刻）
        let firstDow = null
        for (let i = 0; i < 14; i++) { const dm = day0 + i * 86400000; if (new Date(dm).getDay() === dow && dm + off > baseMs) { firstDow = dm + off; break } }
        if (firstDow === null) return null
        if (fired || !hasNow) return firstDow
        // 首触防过去候选（0.4.6-F → 0.4.7 收紧，同 host）：候选陈旧整天以上（< now 当日午夜）→ 对齐「now 之后第一个 dow 锚定时刻」（首轮不补发）；当日内错过不跳周
        if (firstDow < nday0) {
          for (let j = 0; j < 14; j++) { const dn = nday0 + j * 86400000; if (new Date(dn).getDay() === dow && dn + off >= nowMs) return dn + off }
          return null
        }
        return firstDow
      }
      if (typeof ivMs !== 'number' || !isFinite(ivMs) || ivMs % 86400000 !== 0) return null
      if (fired) { const f = new Date(baseMs + ivMs); return new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime() + off }
      // 首触：base 当日锚定时刻未到 → 当日；已过 → 次日；候选陈旧整天以上（0.4.6-F → 0.4.7 收紧 first < nday0）→ 对齐「now 之后第一个锚定时刻」
      const first = (day0 + off > baseMs ? day0 : day0 + 86400000) + off
      if (hasNow && first < nday0) { return (nday0 + off >= nowMs ? nday0 : nday0 + 86400000) + off }
      return first
    }
    // 频率人话：仅一次 <时间> / 每天 / 每周 / 每 N 天（锚定时刻声明带时刻后缀：每天 09:00 / 每周一 09:00 / 每 3 天 09:00）；非整天间隔（front-matter 裸编辑旁路值）兜底 每 N 小时/分钟/ms
    // i18n 覆盖卡D：文案走 t() 字典 common.sched*（跨表面复用——注入管理 + 详情计划块；app kernel/helpers.js 同口径镜像）；
    // 模块级 t() 直读 langStore 当下语言态——本函数只在渲染期被调（调用方组件已挂 useT 订阅，切语言重渲即换文案）；星期名经 common.dowNames 管道分隔取值（en 多字符名 charAt 不可取）
    const schedFreqLabel = (s) => {
      if (!s) return ''
      if (s.at) return t('common.schedOnce', { time: fmtDT(s.at) })
      const ms = schedEveryMs(s.every)
      if (ms === null) return t('common.schedInvalid')
      const tail = s.anchor ? ' ' + s.anchor : ''   // 锚定时刻（notes-034-sched-time）：周期 + 本地时刻
      if (ms === 86400000) return t('common.schedDaily') + tail
      if (ms === 604800000) return (typeof s.dow === 'number' ? t('common.schedWeeklyDow', { dow: t('common.dowNames').split('|')[s.dow] || '' }) : t('common.schedWeekly')) + tail
      if (ms % 86400000 === 0) return t('common.schedNDays', { n: ms / 86400000 }) + tail
      if (ms % 3600000 === 0) return t('common.schedNHours', { n: ms / 3600000 })
      if (ms % 60000 === 0) return t('common.schedNMinutes', { n: ms / 60000 })
      return t('common.schedNMs', { n: ms })
    }
    // 下次触发毫秒（与 host schedDueAt 锚点同口径：轮询 = lastFiredAt || declaredAt || createdAt + 间隔（0.4.6-F 声明重锚）；单次 = at 本身；
    // 锚定时刻声明（notes-034-sched-time）= 锚定序列下一时刻（首触防过去候选注入当前时刻，0.4.6-F））；非法 → null
    const schedNextMs = (n) => {
      const s = n && n.schedule; if (!s) return null
      if (s.at) { const t = Date.parse(s.at); return isFinite(t) ? t : null }
      const iv = schedEveryMs(s.every); if (iv === null) return null
      const firedMs = (s.lastFiredAt && Date.parse(s.lastFiredAt)) || 0
      const declaredMs = (s.declaredAt && Date.parse(s.declaredAt)) || 0
      let base = firedMs || declaredMs || Date.parse(n.createdAt || '') || 0
      if (!isFinite(base) || !base) base = Date.now()
      if (s.anchor) return schedAnchorNextMs(s.anchor, typeof s.dow === 'number' ? s.dow : undefined, iv, base, !!firedMs, Date.now())
      return base + iv
    }
    // ISO → datetime-local 输入值（本地时区 YYYY-MM-DDTHH:mm；非法/空 → ''）
    const isoToLocalInput = (iso) => {
      const d = new Date(iso || ''); if (isNaN(d.getTime())) return ''
      const p = (x) => ('0' + x).slice(-2)
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes())
    }
    // 表单 → schedule 声明片段（{at|every} + 周期模式锚定 anchor:'HH:MM'（weekly 另带 dow），notes-034-sched-time；target/enabled 由确认路径补）：返回 { decl } | { err }（内联报错文案与 host 红线同口径）
    // i18n 覆盖卡E：校验文案走 t() 字典 disp.sched*（app modals/dispatch.js schedFormDecl 同口径镜像）——模块级 t() 直读 langStore 当下语言态（渲染期调用，组件已挂 useT 订阅）
    const schedFormDecl = (mode, n, at, anchor, dow) => {
      if (mode === 'once') {
        const ms = new Date(at || '').getTime()
        if (!at || !isFinite(ms)) return { err: t('disp.schedNeedAt') }
        if (ms <= Date.now()) return { err: t('disp.schedAtFuture') }
        // 本地时区语义（notes-034-at-local-tz）：datetime-local 值本身是本地无后缀串，经 isoToLocalInput 归一提交——禁 toISOString（Z 后缀会被 host 闸门拒绝）
        return { decl: { at: isoToLocalInput(at) } }
      }
      // 锚定时刻（notes-034-sched-time）：周期三模式必携 anchor:'HH:MM'（触发序列钉死本地时刻不漂移）
      if (schedAnchorMs(anchor) === null) return { err: t('disp.schedNeedAnchor') }
      if (mode === 'ndays') {
        const nn = parseInt(n, 10)
        if (!isFinite(nn) || nn < 1) return { err: t('disp.schedNInvalid') }
        return { decl: { every: nn + 'd', anchor: anchor } }
      }
      if (mode === 'weekly') return { decl: { every: '1w', anchor: anchor, dow: typeof dow === 'number' ? dow : 1 } }
      return { decl: { every: '1d', anchor: anchor } }
    }
    // 声明 → 下次触发毫秒（轮询锚点 = lastFiredAt || declaredAt || createdAt || now（0.4.6-F 声明重锚）；锚定时刻声明 = 锚定序列下一时刻，与 host schedDueAt 同口径；编辑模式传入 editNote 取存量锚点）
    const schedDeclNextMs = (decl, note) => {
      if (decl.at) return Date.parse(decl.at)
      let firedMs = 0
      if (note && note.schedule && note.schedule.lastFiredAt) { const f = Date.parse(note.schedule.lastFiredAt); if (isFinite(f)) firedMs = f }
      let declaredMs = 0
      if (!firedMs && note && note.schedule && note.schedule.declaredAt) { const dd = Date.parse(note.schedule.declaredAt); if (isFinite(dd)) declaredMs = dd }
      let base = firedMs || declaredMs
      if (!base && note && note.createdAt) { const c = Date.parse(note.createdAt); if (isFinite(c)) base = c }
      if (!base) base = Date.now()
      const iv = schedEveryMs(decl.every)
      if (decl.anchor) { const nx = schedAnchorNextMs(decl.anchor, typeof decl.dow === 'number' ? decl.dow : undefined, iv, base, !!firedMs, Date.now()); if (nx !== null) return nx }
      return base + iv
    }
    // 关联调度匹配键（notes-034-sched-detail）：标题去「定时」前缀（排定创建时自动加，见 dispatch modal）+ trim；与 app editor-meta.js 同口径
    const schedPeerKey = (title) => String(title || '').replace(/^定时\s*/, '').trim()
    // 关联调度清单：库内其他 dispatch-schedule 约定中匹配键相等者（双向视角：调度约定互见 sibling / 待办笔记见其全部调度）
    const relatedScheds = (cur, list) => {
      if (!cur) return []
      const key = schedPeerKey(cur.title)
      if (!key) return []
      return (list || []).filter(n => n.id !== cur.id && (n.contractType || '') === 'dispatch-schedule' && n.schedule && !n.deleted && schedPeerKey(n.title) === key)
    }
    // token 数人性化（设置卡片「LLM 用量」区）：≥1M → 1.23M，≥10k → 12.3k，其余原样
    const fmtTok = (n) => { n = Math.round(+n || 0); return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n) }
    const notify = () => listeners.forEach(fn => fn({ panelOpen }))
    const notifyNotesChanged = () => noteRefreshListeners.forEach(fn => fn())
