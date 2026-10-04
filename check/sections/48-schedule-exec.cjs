// 节 48. 定时派发·执行层（notes-034-sched-exec：dispatch-schedule 声明解析 + 常驻 cron tick + 派发执行 + 状态三层）
// 产品裁决（决策 n-muqyk2ve1sqx / n-musewkked3tq）：约定即调度——契约笔记 front-matter 结构化声明，host 常驻 30s cron 识别执行。
// 测试策略：共享 mock 集群（节 2）+ 注入时钟（notes-schedule-eval {now}）驱动确定性到期，断言不 sleep 不依赖真实 30s tick；
//   测试调度全部用 every≥3d / at=+1h（真实时钟下永不到期），后台 tick 对断言零干扰；静态包行为经节 17 的 rpc2/store2 链路。
module.exports = {
  id: "48",
  title: "48. 定时派发·执行层（dispatch-schedule 声明 + cron tick + 状态三层）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, handlers, noteManage, sentMessages, store, rpc2, store2, NOTES_ROOT_STATIC } = S
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'       // helpers mock 唯一 live 会话
  const OFFLINE_SID = 'session-sub9900000-0000-0000-0000-000000000000'  // 工作区有效且未归档但非 live（agents.get → undefined）
  const ARCH_SID = 'session-arch00000-0000-0000-0000-000000000000'      // 已归档会话
  // 本地无后缀 ISO（notes-034-at-local-tz：at 声明钉死本地时区语义，禁 Z/±偏移后缀——测试造数必须走本地墙钟串，与 datetime-local 提交同形态）
  const localIso = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) }
  section('48. 定时派发·执行层（dispatch-schedule 声明 + cron tick + 状态三层）')

  // ===== 声明解析（schema 定稿：schedule { at|every, target, action, enabled } + front-matter JSON 单行往返） =====
  let schedA = null   // 轮询 3d 约定（贯穿触发/防重/对齐/暂停/解除断言链）
  await t('声明解析：create 落 front-matter schedule 行 + get/list 往返 + 归一化缺省值', async () => {
    const c = await handlers['notes-create']({ title: 'UX巡检约定', body: '每 3 天一轮 UX 巡检', kind: 'todo', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    assert(c && c.id && !c.error, '创建调度约定应成功（实得 ' + JSON.stringify(c) + '）')
    schedA = c.id
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.contractType, 'dispatch-schedule', 'contractType 落库')
    assert(g.note.schedule && typeof g.note.schedule === 'object', 'schedule 解析为对象')
    assert.strictEqual(g.note.schedule.every, '3d', 'every 原样保留（声明形态）')
    assert.strictEqual(g.note.schedule.target, LIVE_SID, 'target 落库')
    assert.strictEqual(g.note.schedule.action, 'dispatch', 'action 缺省归一 dispatch')
    assert.strictEqual(g.note.schedule.enabled, true, 'enabled 缺省 true')
    assert(!g.note.schedule.lastFiredAt && !g.note.schedule.lastRun && !g.note.schedule.lastError, '机器状态三层缺省空')
    const raw = store.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(/\nschedule: \{/.test(raw) || /\nschedule: "\{/.test(raw), '磁盘 front-matter 含 schedule 条件行（JSON 单行）')
    const l = await handlers['notes-list']({})
    const li = l.notes.find(n => n.id === c.id)
    assert(li && li.schedule && li.schedule.every === '3d', 'slim 列表携带 schedule（UI 调度任务区数据源，零新 RPC）')
  })

  await t('未到期评估零触发（notes-schedule-eval 真时钟）', async () => {
    const ev = await handlers['notes-schedule-eval']({})
    assert(!ev.error && ev.evaluated >= 1 && ev.fired === 0 && ev.errors === 0, '未到期 fired=0（实得 ' + JSON.stringify(ev) + '）')
    const bad = await handlers['notes-schedule-eval']({ now: 'not-a-time' })
    assert(bad && bad.error && bad.error.indexOf('now 非法') >= 0, '非法 now 注入报错（实得 ' + JSON.stringify(bad) + '）')
  })

  // ===== tick 触发 + 状态三层（注入时钟：now+4d ≥ createdAt+3d → 到期） =====
  let fireClock = ''
  await t('tick 触发：到期复用 _dispatch 全链路（来源标注 定时调度 @标题）+ 状态三层落盘', async () => {
    fireClock = new Date(Date.now() + 4 * 86400000).toISOString()
    const before = sentMessages.length
    const ev = await handlers['notes-schedule-eval']({ now: fireClock })
    assert(ev.fired === 1 && ev.errors === 0, '到期触发 fired=1（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(sentMessages.length, before + 1, 'agent.send 注入上下文并触发工作')
    const m = sentMessages[sentMessages.length - 1]
    assert.strictEqual(m.target, 'next-turn'); assert.strictEqual(m.wakeup, true, '与手动派发同链路（next-turn + wakeup）')
    assert(m.msg.source && m.msg.source.kind === 'plugin:dsh-notes' && m.msg.source.form === 'recall', 'source 标记同派发链路')
    assert(m.msg.content[0].text.indexOf('每 3 天一轮 UX 巡检') >= 0, '派发卡含约定正文（人话描述即工作内容）')
    assert(m.msg.content[0].text.indexOf('来源：定时调度 @UX巡检约定') >= 0, '来源标注「定时调度 @约定标题」')
    const g = await handlers['notes-get']({ id: schedA })
    const s = g.note.schedule
    assert.strictEqual(s.lastFiredAt, fireClock, '状态① lastFiredAt = 触发时刻（注入时钟）')
    assert(s.lastRun && s.lastRun.at === fireClock && s.lastRun.status === 'sent' && /^note-dispatch-/.test(s.lastRun.receiptId || ''), '状态① lastRun{at,status:sent,receiptId=msgId}（实得 ' + JSON.stringify(s.lastRun) + '）')
    assert(!('lastError' in s), 'lastError 仅失败记（成功路径无此键）')
    assert(g.note.dispatches.length === 1, '状态② 历史主载体 = 既有 dispatches 数组（零新建）')
    const d = g.note.dispatches[0]
    assert.strictEqual(d.sourceLabel, '定时调度 @UX巡检约定', 'dispatches 记录带来源标注')
    assert.strictEqual(d.msgId, s.lastRun.receiptId, 'dispatches.msgId 与 lastRun.receiptId 关联')
    assert.strictEqual(d.dispatchStatus, 'sent', '回执走既有链路（dispatchStatus=sent 待 idle/resolved 闭环）')
    const raw = store.get(NOTES_DIR + '\\' + schedA + '.md')
    assert(raw.indexOf('lastFiredAt') >= 0 && raw.indexOf('lastRun') >= 0, '机器状态随 front-matter 落盘（机器读写层）')
  })

  // ===== 防重（幂等生命线：lastFiredAt 落盘） =====
  await t('lastFiredAt 防重：同时钟重复评估零重发；下一周期未对齐不触发', async () => {
    const before = sentMessages.length
    let ev = await handlers['notes-schedule-eval']({ now: fireClock })
    assert(ev.fired === 0, '同时钟重复评估零重发（实得 ' + JSON.stringify(ev) + '）')
    ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 5 * 86400000).toISOString() })
    assert(ev.fired === 0, '距 lastFiredAt 仅 1d < 3d 不触发（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(sentMessages.length, before, '零新增派发消息')
    const g = await handlers['notes-get']({ id: schedA })
    assert.strictEqual(g.note.dispatches.length, 1, 'dispatches 历史不重复登记')
    assert.strictEqual(g.note.schedule.lastFiredAt, fireClock, 'lastFiredAt 不动')
  })

  let alignClock = ''   // 轮询对齐触发时刻（后续「声明改写延续机器状态」断言复用，避免 Date.now() 重算漂移）
  await t('轮询错过对齐下周期不追赶：跨多周期只补一次', async () => {
    // 距 lastFiredAt（+4d）10 天 ≈ 错过 3 个周期 → 只触发一次，lastFiredAt 对齐到本次时刻
    const clock2 = new Date(Date.now() + 14 * 86400000).toISOString()
    alignClock = clock2
    const before = sentMessages.length
    const ev = await handlers['notes-schedule-eval']({ now: clock2 })
    assert(ev.fired === 1, '错过 3 个周期只补发一次（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(sentMessages.length, before + 1, '恰好一次派发（不追赶欠账）')
    const g = await handlers['notes-get']({ id: schedA })
    assert.strictEqual(g.note.schedule.lastFiredAt, clock2, 'lastFiredAt 对齐本次触发时刻（下周期由此起算）')
    assert.strictEqual(g.note.dispatches.length, 2, '历史第二次登记')
    const ev2 = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 14 * 86400000 + 60000).toISOString() })
    assert(ev2.fired === 0, '对齐后 1min 内不重复触发')
  })

  // ===== 单次 at：停机错过 → 补评估补发一次且仅一次 =====
  await t('单次 at：未触发前不发射；停机错过补发一次；之后永不重发', async () => {
    const at = localIso(Date.now() + 3600000)   // 本地无后缀串（闸门红线：带 Z 后缀一律拒绝）
    const c = await handlers['notes-create']({ title: '单次定时约定', body: '一次性任务', contractType: 'dispatch-schedule', schedule: { at: at, target: LIVE_SID } })
    assert(c && c.id && !c.error, 'at 声明创建成功（实得 ' + JSON.stringify(c) + '）')
    let ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 1800000).toISOString() })
    assert(ev.fired === 0, 'at 未到不触发')
    const missedClock = new Date(Date.now() + 3600000 + 60000).toISOString()   // 模拟停机错过：评估时刻已过 at
    const before = sentMessages.length
    ev = await handlers['notes-schedule-eval']({ now: missedClock })
    assert(ev.fired === 1, '停机错过 → 补评估补发一次（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(sentMessages.length, before + 1, 'at 补发派发一次')
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.lastFiredAt, missedClock, 'at 触发落 lastFiredAt')
    ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 3600000 + 120000).toISOString() })
    assert(ev.fired === 0, 'at 触发后永不重发（实得 ' + JSON.stringify(ev) + '）')
  })

  // ===== 校验红线：非法声明全量拒绝（错得安全） =====
  await t('拒绝非法声明：every<5min / at 过去 / at+every 同声明 / 目标不存在或已归档 / 未知字段 / 契约不配对 / 公共写白名单', async () => {
    let r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1m', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('5 分钟') >= 0, '轮询间隔 <5min 拒绝（实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '4m', target: LIVE_SID } })
    assert(r.error, '4m 边界拒绝')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '5m', target: LIVE_SID } })
    assert(r.id && !r.error, '5m 边界放行（红线 ≥5min）')
    await handlers['notes-delete']({ id: r.id })
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: '2020-01-01T00:00:00', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('未来') >= 0, 'at 过去拒绝（本地无后缀串，实得 ' + r.error + '）')
    // ===== 本地时区闸门（notes-034-at-local-tz）：at 带任何时区后缀一律拒绝，无后缀本地串放行 =====
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: new Date(Date.now() + 86400000).toISOString(), target: LIVE_SID } })
    assert(r.error && r.error.indexOf('禁止 Z/±偏移后缀') >= 0, 'at 带 Z 后缀拒绝（本地时区语义，实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: localIso(Date.now() + 86400000) + '+08:00', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('禁止 Z/±偏移后缀') >= 0, 'at 带 +08:00 偏移拒绝（实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: localIso(Date.now() + 86400000).slice(0, 16) + '-07:00', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('禁止 Z/±偏移后缀') >= 0, 'at 带 -07:00 负偏移拒绝（实得 ' + r.error + '）')
    // ===== 纯日期闸门（notes-034-at-need-time）：YYYY-MM-DD 被 ES 按 UTC 午夜解析（UTC+8 偏移 8h），与时区后缀同类歧义一律拒绝 =====
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: '2026-10-05', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('不接受纯日期') >= 0, 'at 纯日期拒绝（实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: localIso(Date.now() + 86400000).slice(0, 10), target: LIVE_SID } })
    assert(r.error && r.error.indexOf('必须含日期和时间') >= 0, 'at 未来纯日期同样拒绝（闸门先于未来性校验，实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: localIso(Date.now() + 86400000), target: LIVE_SID } })
    assert(r.id && !r.error, 'at 无后缀本地时间放行（datetime-local 同形态，实得 ' + JSON.stringify(r) + '）')
    await handlers['notes-delete']({ id: r.id })
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: 'not-a-date', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('非法时间') >= 0, 'at 非法时间串拒绝')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: localIso(Date.now() + 3600000), every: '3d', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('二选一') >= 0, 'at+every 同声明拒绝')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'session-ghost-00000000' } })
    assert(r.error && r.error.indexOf('不存在或已归档') >= 0, '目标不存在拒绝（实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: ARCH_SID } })
    assert(r.error && r.error.indexOf('不存在或已归档') >= 0, '目标已归档拒绝')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID, hack: 1 } })
    assert(r.error && r.error.indexOf('未知字段') >= 0, '未知字段拒绝（无歧义红线）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID, action: 'notify' } })
    assert(r.error && r.error.indexOf('仅支持 dispatch') >= 0, 'action 非 dispatch 拒绝')
    r = await handlers['notes-create']({ title: 'x', body: 'x', schedule: { every: '3d', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('dispatch-schedule') >= 0, 'schedule 缺 contractType 拒绝（契约配对）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule' })
    assert(r.error && r.error.indexOf('需要 schedule') >= 0, 'contractType 缺 schedule 拒绝（契约配对）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'memory-guide' })
    assert(r.error && r.error.indexOf('系统内部') >= 0, '公共写 memory-guide 契约拒绝（白名单，实得 ' + r.error + '）')
  })

  // ===== 锚定时刻闸门（notes-034-sched-time）：anchor HH:MM / dow 0-6 / at 互斥 / 子日间隔拒绝 / 存量零迁移兼容 =====
  await t('锚定时刻闸门：anchor HH:MM 校验 + dow 0-6 + at+anchor 互斥 + 子日间隔拒绝 + 无 anchor 存量兼容', async () => {
    let r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '9:00', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('anchor 非法') >= 0, 'anchor 单数字小时拒绝（严格 HH:MM，实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '24:00', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('anchor 非法') >= 0, 'anchor 24:00 越界拒绝')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '09:60', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('anchor 非法') >= 0, 'anchor 分钟越界拒绝')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '12h', anchor: '09:00', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('整天周期') >= 0, '子日间隔 + anchor 拒绝（锚定语义有歧义，实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: localIso(Date.now() + 3600000), anchor: '09:00', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('仅周期模式') >= 0, 'at + anchor 拒绝（锚定字段仅周期模式，实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1d', dow: 1, target: LIVE_SID } })
    assert(r.error && r.error.indexOf('搭配 anchor') >= 0, 'dow 缺 anchor 拒绝（实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1w', anchor: '09:00', dow: 7, target: LIVE_SID } })
    assert(r.error && r.error.indexOf('dow 非法') >= 0, 'dow 7 越界拒绝')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1w', anchor: '09:00', dow: '1', target: LIVE_SID } })
    assert(r.error && r.error.indexOf('dow 非法') >= 0, 'dow 字符串拒绝（必须 number，错得安全）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', anchor: '09:00', dow: 1, target: LIVE_SID } })
    assert(r.error && r.error.indexOf('仅每周模式') >= 0, 'dow 非每周间隔拒绝（实得 ' + r.error + '）')
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1w', anchor: '09:00', dow: 1, target: LIVE_SID } })
    assert(r.id && !r.error, 'weekly + anchor + dow 合法放行（实得 ' + JSON.stringify(r) + '）')
    let g = await handlers['notes-get']({ id: r.id })
    assert(g.note.schedule.anchor === '09:00' && g.note.schedule.dow === 1 && g.note.schedule.every === '1w', 'anchor/dow 落库（front-matter 同源）')
    await handlers['notes-delete']({ id: r.id })
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', anchor: '08:30', target: LIVE_SID } })
    assert(r.id && !r.error, '每 N 天 + anchor 合法放行')
    await handlers['notes-delete']({ id: r.id })
    // 存量零迁移兼容：无 anchor 的 every 声明不补 anchor/dow 字段，语义不变（行为链见既有 3d 断言组）
    r = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    assert(r.id && !r.error, '无 anchor 存量形态声明放行')
    g = await handlers['notes-get']({ id: r.id })
    assert(!('anchor' in g.note.schedule) && !('dow' in g.note.schedule), '无 anchor 声明零字段迁移（兼容）')
    await handlers['notes-delete']({ id: r.id })
  })

  // ===== 执行红线：目标非 live → 记 lastError（节流）不推进 lastFiredAt =====
  let schedOffline = null
  await t('执行红线：目标非 live 记 lastError + 不推进 lastFiredAt（上线后自动补发）+ 5min 节流', async () => {
    const c = await handlers['notes-create']({ title: '离线目标约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '5m', target: OFFLINE_SID } })
    assert(c && c.id && !c.error, '非 live 但存活的目标允许声明（实得 ' + JSON.stringify(c) + '）')
    schedOffline = c.id
    const clock1 = new Date(Date.now() + 3600000).toISOString()
    const before = sentMessages.length
    const ev = await handlers['notes-schedule-eval']({ now: clock1 })
    assert(ev.fired === 0 && ev.errors === 1, '目标未 live：触发失败记 error（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(sentMessages.length, before, '未派发消息')
    let g = await handlers['notes-get']({ id: c.id })
    assert(g.note.schedule.lastError && g.note.schedule.lastError.message.indexOf('未打开') >= 0, '状态① lastError 落盘（实得 ' + JSON.stringify(g.note.schedule.lastError) + '）')
    assert(g.note.schedule.lastRun && g.note.schedule.lastRun.status === 'error', 'lastRun.status=error')
    assert(!g.note.schedule.lastFiredAt, 'lastFiredAt 不推进（上线后补发语义）')
    // 节流：5min 内同类故障不重复刷写 lastError
    const ev2 = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 3600000 + 120000).toISOString() })
    g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.lastError.at, clock1, '5min 节流窗内 lastError 不刷写（实得 ' + g.note.schedule.lastError.at + '）')
    assert(ev2.errors === 1, '故障仍计数（evaluated errors 口径不受节流影响）')
  })

  // ===== 声明改写：机器状态延续 + enabled=false 暂停豁免存活校验 =====
  await t('声明改写延续机器状态；enabled=false 暂停后评估跳过', async () => {
    const u = await handlers['notes-update']({ id: schedA, schedule: { every: '7d', target: LIVE_SID, enabled: false } })
    assert(u && !u.error, '暂停改写成功（实得 ' + JSON.stringify(u) + '）')
    const g = await handlers['notes-get']({ id: schedA })
    assert.strictEqual(g.note.schedule.every, '7d', '声明字段被覆盖')
    assert.strictEqual(g.note.schedule.enabled, false, 'enabled=false 落库')
    assert.strictEqual(g.note.schedule.lastFiredAt, alignClock, '机器状态 lastFiredAt 延续（不被声明改写清零）')
    assert(g.note.schedule.lastRun && g.note.schedule.lastRun.status === 'sent', 'lastRun 延续')
    const before = sentMessages.length
    const ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 60 * 86400000).toISOString() })
    assert.strictEqual(sentMessages.length, before, '暂停后永不触发')
    assert(ev.fired === 0, '暂停 fired=0（实得 ' + JSON.stringify(ev) + '）')
  })

  // ===== 解除声明：契约+声明成对清除，历史保留 =====
  await t('解除声明：contractType=\'\' + schedule=null 成对清除，dispatches 历史保留', async () => {
    let u = await handlers['notes-update']({ id: schedA, schedule: null })
    assert(u.error && u.error.indexOf('同时清除') >= 0, '单清 schedule 保留契约拒绝（实得 ' + u.error + '）')
    u = await handlers['notes-update']({ id: schedA, contractType: '', schedule: null })
    assert(u && !u.error, '成对清除成功（实得 ' + JSON.stringify(u) + '）')
    const g = await handlers['notes-get']({ id: schedA })
    assert(!g.note.schedule && !g.note.contractType, 'schedule + contractType 已清除')
    assert(g.note.dispatches.length === 2, 'dispatches 历史保留（状态②不因解除声明丢失）')
    const raw = store.get(NOTES_DIR + '\\' + schedA + '.md')
    assert(raw.indexOf('\nschedule:') < 0, '磁盘 schedule 条件行已摘除')
  })

  // ===== 锚定时刻行为（notes-034-sched-time）：注入时钟 + 本地墙钟推算（时区无关）——首触=下一个本地锚定时刻，触发后钉死时刻序列不漂移 =====
  await t('锚定时刻语义：每天 09:00 首触=下一个本地 09:00 + 触发后对齐不漂移 + 错过不追赶', async () => {
    const c = await handlers['notes-create']({ title: '锚定每日约定', body: '每天 09:00 巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '09:00', target: LIVE_SID } })
    assert(c && c.id && !c.error, '锚定声明创建成功（实得 ' + JSON.stringify(c) + '）')
    const g0 = await handlers['notes-get']({ id: c.id })
    const created = Date.parse(g0.note.createdAt)
    const d0 = new Date(created), dayMid = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime()
    const firstDue = (dayMid + 9 * 3600000 > created ? dayMid : dayMid + 86400000) + 9 * 3600000   // 下一个本地 09:00（严格大于创建时刻）
    const before = sentMessages.length
    let ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue - 60000).toISOString() })
    assert(ev.fired === 0, '09:00 前一分钟不触发（首触=下一个锚定时刻，非创建时间+24h，实得 ' + JSON.stringify(ev) + '）')
    ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue).toISOString() })
    assert(ev.fired === 1, '09:00 整点到期触发（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(sentMessages.length, before + 1, '恰好一次派发')
    let g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.lastFiredAt, new Date(firstDue).toISOString(), 'lastFiredAt=首触时刻（注入时钟）')
    // 触发延迟不漂移：模拟停机错过 3 小时，补发后下一触发仍钉在次日 09:00（而非 补发时刻+24h）
    const late = firstDue + 86400000 + 3 * 3600000   // 次日 12:00（错过当日 09:00 三小时）
    ev = await handlers['notes-schedule-eval']({ now: new Date(late).toISOString() })
    assert(ev.fired === 1, '停机错过 → 补发一次（错过不追赶语义保留）')
    g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.lastFiredAt, new Date(late).toISOString(), 'lastFiredAt=补发时刻（延迟 3h）')
    ev = await handlers['notes-schedule-eval']({ now: new Date(late + 3600000).toISOString() })
    assert(ev.fired === 0, '补发后当日不再触发（防重）')
    const nextDay = firstDue + 2 * 86400000   // 第三日 09:00
    ev = await handlers['notes-schedule-eval']({ now: new Date(nextDay - 60000).toISOString() })
    assert(ev.fired === 0, '次日 08:59 不触发（锚定 09:00 不随补发延迟漂移）')
    ev = await handlers['notes-schedule-eval']({ now: new Date(nextDay).toISOString() })
    assert(ev.fired === 1, '次日 09:00 准点触发（时刻序列钉死）')
    await handlers['notes-delete']({ id: c.id })
  })

  await t('锚定时刻·每周 dow：首触=下一个周一 09:00 + 触发后下周同 dow 准点 + 非 dow 日不触发', async () => {
    const c = await handlers['notes-create']({ title: '锚定每周约定', body: '每周一 09:00 周报', contractType: 'dispatch-schedule', schedule: { every: '1w', anchor: '09:00', dow: 1, target: LIVE_SID } })
    assert(c && c.id && !c.error, 'weekly dow 声明创建成功（实得 ' + JSON.stringify(c) + '）')
    const g0 = await handlers['notes-get']({ id: c.id })
    const created = Date.parse(g0.note.createdAt)
    const d0 = new Date(created), dayMid = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime()
    let firstDue = 0
    for (let i = 0; i < 14 && !firstDue; i++) { const dm = dayMid + i * 86400000; if (new Date(dm).getDay() === 1 && dm + 9 * 3600000 > created) firstDue = dm + 9 * 3600000 }
    assert(firstDue > 0, '推算出下一个周一 09:00（本地墙钟）')
    let ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue - 60000).toISOString() })
    assert(ev.fired === 0, '周一 09:00 前不触发')
    ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue).toISOString() })
    assert(ev.fired === 1, '周一 09:00 触发（实得 ' + JSON.stringify(ev) + '）')
    ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue + 86400000).toISOString() })
    assert(ev.fired === 0, '次日（周二 09:00）不触发——weekly 锚定 dow 日')
    ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue + 7 * 86400000 - 60000).toISOString() })
    assert(ev.fired === 0, '下周一 08:59 不触发')
    ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue + 7 * 86400000).toISOString() })
    assert(ev.fired === 1, '下周一 09:00 准点触发（每周同 dow 同时刻）')
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== note_manage 工具通道（agent 面声明入口） =====
  await t('note_manage 工具：create/update 携带 contractType+schedule；白名单拒绝内部契约', async () => {
    const c = await noteManage.execute({ action: 'create', title: '工具声明约定', body: 'agent 侧声明', contractType: 'dispatch-schedule', schedule: { every: '7d', target: LIVE_SID, enabled: false } })
    assert(c && c.id && !c.error, '工具 create 声明成功（实得 ' + JSON.stringify(c) + '）')
    const g = await handlers['notes-get']({ id: c.id })
    assert(g.note.schedule && g.note.schedule.every === '7d' && g.note.schedule.enabled === false, '工具声明落库（enabled=false 不触发）')
    const u = await noteManage.execute({ action: 'update', id: c.id, schedule: { every: '14d', target: LIVE_SID, enabled: false } })
    assert(u && !u.error, '工具 update 声明成功（实得 ' + JSON.stringify(u) + '）')
    const bad = await noteManage.execute({ action: 'create', title: 'x', body: 'x', contractType: 'memory-guide' })
    assert(bad && bad.error && bad.error.indexOf('系统内部') >= 0, '工具公共写白名单拒绝 memory-guide（实得 ' + bad.error + '）')
    const bad2 = await noteManage.execute({ action: 'update', id: c.id, contractType: 'dispatch-schedule', schedule: { every: '1m', target: LIVE_SID } })
    assert(bad2 && bad2.error && bad2.error.indexOf('5 分钟') >= 0, '工具 update 同红线校验（实得 ' + bad2.error + '）')
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== 双包一致：标记块逐字节 + 静态包行为（webServer 路由链路全链路） =====
  await t('schedule-exec 标记块双包逐字节一致 + cron 装配静态锚点（host-impl / index.mjs）', () => {
    const grab = (s, tag) => { const m = s.match(/\/\/ ==== schedule-exec BEGIN ====[\s\S]*?\/\/ ==== schedule-exec END ====/); assert(m, tag + ' 缺 schedule-exec 标记块'); return m[0] }
    assert.strictEqual(grab(indexSrc, 'index.mjs'), grab(hostSrc, 'host-impl.js'), 'schedule-exec 块必须双包逐字节一致（schedule.js 共源单份）')
    for (const [src, tag] of [[hostSrc, 'host-impl.js'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('const SCHED_TICK_MS = 30 * 1000') >= 0, tag + ' 30s tick 周期')
      assert(src.indexOf("setInterval(function () { _schedTickGuarded(Date.now()) }, SCHED_TICK_MS)") >= 0, tag + ' 常驻 setInterval tick')
      assert(src.indexOf("typeof schedTimer.unref === 'function'") >= 0, tag + ' .unref() 不挂进程退出')
      assert(src.indexOf('disposers.push(function () { if (schedTimer) { clearInterval(schedTimer)') >= 0, tag + ' disposers cleanup（防重载双跑）')
      assert(src.indexOf('let schedTimer') >= 0 && src.indexOf('schedTickRunning') >= 0, tag + ' tick 防重叠闸')
      assert(src.indexOf("handle('notes-schedule-eval'") >= 0, tag + ' notes-schedule-eval RPC 注册')
      assert(src.indexOf("sourceLabel: '定时调度 @'") >= 0, tag + ' 派发来源标注')
      assert(src.indexOf('history: false') >= 0, tag + ' 机器状态回写不产生历史快照')
      assert(src.indexOf('禁止 Z/±偏移后缀') >= 0 && src.indexOf("([zZ]|[+-]\\d{2}:?\\d{2})$") >= 0, tag + ' at 本地时区闸门（禁时区后缀正则 + 报错文案）')
      assert(src.indexOf('不接受纯日期') >= 0 && src.indexOf("at.indexOf('T') < 0") >= 0, tag + ' at 纯日期闸门（必须含 T 时间部分，notes-034-at-need-time）')
      assert(src.indexOf('function schedAnchorMs(') >= 0 && src.indexOf('function schedAnchorNextMs(') >= 0, tag + ' 锚定时刻 helper（notes-034-sched-time）')
      assert(src.indexOf('schedule.anchor 非法') >= 0 && src.indexOf('schedule.dow 非法') >= 0 && src.indexOf('仅每周模式') >= 0, tag + ' 锚定时刻写入闸门（anchor HH:MM / dow 0-6 / 仅每周）')
      assert(src.indexOf('sched.anchor') >= 0 && src.indexOf('schedAnchorNextMs(sched.anchor') >= 0, tag + ' schedDueAt 锚定分支（无 anchor 存量保持纯间隔语义）')
    }
  })

  await t('静态包行为：index.mjs 声明解析 + 注入时钟触发 + 防重（webServer 路由链路）', async () => {
    const c = await rpc2('notes-create', { title: '静态调度约定', body: '静态包巡检', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    assert(c.body && c.body.id && !c.body.error, '静态包创建调度约定（实得 ' + JSON.stringify(c.body) + '）')
    const sid = c.body.id
    let ev = await rpc2('notes-schedule-eval', {})
    assert(ev.body && ev.body.fired === 0, '静态包未到期零触发（实得 ' + JSON.stringify(ev.body) + '）')
    const clock = new Date(Date.now() + 4 * 86400000).toISOString()
    ev = await rpc2('notes-schedule-eval', { now: clock })
    assert(ev.body && ev.body.fired === 1 && ev.body.errors === 0, '静态包到期触发（实得 ' + JSON.stringify(ev.body) + '）')
    const raw = store2.get(path.join(NOTES_ROOT_STATIC, sid + '.md'))
    assert(raw && raw.indexOf('lastFiredAt') >= 0 && raw.indexOf('schedule:') >= 0, '静态包 front-matter 机器状态落盘')
    const g = await rpc2('notes-get', { id: sid })
    assert(g.body.note.schedule.lastFiredAt === clock && g.body.note.schedule.lastRun.status === 'sent', '静态包状态三层一致')
    assert(g.body.note.dispatches.length === 1 && g.body.note.dispatches[0].sourceLabel === '定时调度 @静态调度约定', '静态包 dispatches 历史 + 来源标注')
    ev = await rpc2('notes-schedule-eval', { now: clock })
    assert(ev.body.fired === 0, '静态包同时钟防重')
    const bad = await rpc2('notes-create', { title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1m', target: LIVE_SID } })
    assert(bad.body && bad.body.error && bad.body.error.indexOf('5 分钟') >= 0, '静态包同红线拒绝非法声明')
    const badTz = await rpc2('notes-create', { title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: new Date(Date.now() + 86400000).toISOString(), target: LIVE_SID } })
    assert(badTz.body && badTz.body.error && badTz.body.error.indexOf('禁止 Z/±偏移后缀') >= 0, '静态包 at 带 Z 后缀同红线拒绝（实得 ' + (badTz.body && badTz.body.error) + '）')
    // 静态包锚定时刻（notes-034-sched-time）：anchor 声明 → 首触=下一个本地 09:00；非法 anchor 同红线拒绝
    const ac = await rpc2('notes-create', { title: '静态锚定约定', body: '静态包锚定巡检', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '09:00', target: LIVE_SID } })
    assert(ac.body && ac.body.id && !ac.body.error, '静态包锚定声明创建（实得 ' + JSON.stringify(ac.body) + '）')
    const ag = await rpc2('notes-get', { id: ac.body.id })
    assert(ag.body.note.schedule.anchor === '09:00', '静态包 anchor 落库')
    const aCreated = Date.parse(ag.body.note.createdAt)
    const ad0 = new Date(aCreated), aMid = new Date(ad0.getFullYear(), ad0.getMonth(), ad0.getDate()).getTime()
    const aFirst = (aMid + 32400000 > aCreated ? aMid : aMid + 86400000) + 32400000
    let aev = await rpc2('notes-schedule-eval', { now: new Date(aFirst - 60000).toISOString() })
    assert(aev.body && aev.body.fired === 0, '静态包锚定时刻未到不触发（实得 ' + JSON.stringify(aev.body) + '）')
    aev = await rpc2('notes-schedule-eval', { now: new Date(aFirst).toISOString() })
    assert(aev.body && aev.body.fired === 1, '静态包锚定时刻到期触发（实得 ' + JSON.stringify(aev.body) + '）')
    const badAnchor = await rpc2('notes-create', { title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '9:00', target: LIVE_SID } })
    assert(badAnchor.body && badAnchor.body.error && badAnchor.body.error.indexOf('anchor 非法') >= 0, '静态包 anchor 非法同红线拒绝（实得 ' + (badAnchor.body && badAnchor.body.error) + '）')
  })
  }
}
