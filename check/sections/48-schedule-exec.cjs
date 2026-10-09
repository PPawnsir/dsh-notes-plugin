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

  // ===== 执行红线改写（0.5.0 P1 唤醒执行，notes-050-sched-wake）：目标非 live 但持久化可达 → agents.resume 唤醒执行（sent），不再是休眠排队 =====
  await t('休眠目标触发：持久化可达 → agents.resume 唤醒执行（lastRun.status=sent + 零 inbox splice + resumed 直发）', async () => {
    const c = await handlers['notes-create']({ title: '离线目标约定', body: '巡检离线工作项', contractType: 'dispatch-schedule', schedule: { every: '5m', target: OFFLINE_SID } })
    assert(c && c.id && !c.error, '非 live 但存活的目标允许声明（实得 ' + JSON.stringify(c) + '）')
    const clock1 = new Date(Date.now() + 3600000).toISOString()
    const logBefore = (S.persistLogs.get(OFFLINE_SID) || []).length
    const resumesBefore = S.agentResumeCalls.length
    const before = sentMessages.length
    const ev = await handlers['notes-schedule-eval']({ now: clock1 })
    assert(ev.fired === 1 && ev.errors === 0, '休眠目标可送达：唤醒执行 fired=1（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(S.agentResumeCalls.length, resumesBefore + 1, 'agents.resume 唤醒恰调用 1 次')
    assert.strictEqual(S.agentResumeCalls[S.agentResumeCalls.length - 1].resumeSessionId, OFFLINE_SID, 'resume 目标 = 休眠会话 sid')
    assert.strictEqual(sentMessages.length, before + 1, '唤醒后 agent.send 直发（resumed 通道）')
    assert(sentMessages[sentMessages.length - 1].via === 'resumed:' + OFFLINE_SID, '消息经 resumed 通道送达（唤醒执行，非 live 直通）')
    assert.strictEqual((S.persistLogs.get(OFFLINE_SID) || []).length, logBefore, '零 inbox splice（唤醒执行不排队）')
    const g = await handlers['notes-get']({ id: c.id })
    const s = g.note.schedule
    assert.strictEqual(s.lastFiredAt, clock1, '唤醒执行推进 lastFiredAt（触发即消费，不重发）')
    assert(s.lastRun && s.lastRun.status === 'sent' && /^note-dispatch-/.test(s.lastRun.receiptId || ''), 'lastRun.status=sent（唤醒执行，实得 ' + JSON.stringify(s.lastRun) + '）')
    assert(!('lastError' in s), '成功路径摘除 lastError 键')
    assert(g.note.dispatches.length === 1 && !('queued' in g.note.dispatches[0]) && g.note.dispatches[0].dispatchStatus === 'sent', 'dispatches 记录零 queued 键（sent 语义）')
    await handlers['notes-delete']({ id: c.id })
    S.createdAgents.delete(OFFLINE_SID)   // 复位：唤醒把休眠目标注册为 live，删除后回归休眠态（防污染后续节）
  })

  // ===== 执行红线：目标非 live 且持久化不可达 → 记 lastError（节流）不推进 lastFiredAt =====
  await t('执行红线：目标非 live 且持久化不可达记 lastError + 不推进 lastFiredAt（可送达后自动补发）+ 5min 节流', async () => {
    const GONE_SID = 'session-gone00000-0000-0000-0000-000000000000'   // 工作区有效（声明期存活校验过）但持久化无此会话（stat 探针 miss）
    S.ws1SessionIds.push(GONE_SID)   // 就地扩账（本节末复位，防污染后续节会话清单口径）
    let goneId = null
    try {
      const c = await handlers['notes-create']({ title: '失联目标约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '5m', target: GONE_SID } })
      assert(c && c.id && !c.error, '声明期存活校验放行（工作区有效且未归档；实得 ' + JSON.stringify(c) + '）')
      goneId = c.id
      const clock1 = new Date(Date.now() + 3600000).toISOString()
      const before = sentMessages.length
      const logBefore = (S.persistLogs.get(OFFLINE_SID) || []).length
      const ev = await handlers['notes-schedule-eval']({ now: clock1 })
      assert(ev.fired === 0 && ev.errors === 1, '不可送达：触发失败记 error（实得 ' + JSON.stringify(ev) + '）')
      assert.strictEqual(sentMessages.length, before, '未派发消息')
      assert.strictEqual((S.persistLogs.get(OFFLINE_SID) || []).length, logBefore, '休眠日志零追加（预检闸门前置拦截）')
      let g = await handlers['notes-get']({ id: c.id })
      assert(g.note.schedule.lastError && g.note.schedule.lastError.message.indexOf('未打开') >= 0, '状态① lastError 落盘（实得 ' + JSON.stringify(g.note.schedule.lastError) + '）')
      assert(g.note.schedule.lastRun && g.note.schedule.lastRun.status === 'error', 'lastRun.status=error')
      assert(!g.note.schedule.lastFiredAt, 'lastFiredAt 不推进（可送达后补发语义）')
      // 节流：5min 内同类故障不重复刷写 lastError
      const ev2 = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 3600000 + 120000).toISOString() })
      g = await handlers['notes-get']({ id: c.id })
      assert.strictEqual(g.note.schedule.lastError.at, clock1, '5min 节流窗内 lastError 不刷写（实得 ' + g.note.schedule.lastError.at + '）')
      assert(ev2.errors === 1, '故障仍计数（evaluated errors 口径不受节流影响）')
      // 补发语义：持久化恢复可达（模拟会话日志落盘回归）→ 下轮评估唤醒执行补发成功（0.5.0 P1）
      S.persistLogs.set(GONE_SID, [])
      const clock2 = new Date(Date.now() + 3600000 + 6 * 60000).toISOString()
      const ev3 = await handlers['notes-schedule-eval']({ now: clock2 })
      assert(ev3.fired === 1, '持久化可达后补发成功（实得 ' + JSON.stringify(ev3) + '）')
      g = await handlers['notes-get']({ id: c.id })
      assert(g.note.schedule.lastFiredAt === clock2 && g.note.schedule.lastRun.status === 'sent' && !('lastError' in g.note.schedule), '补发推进 lastFiredAt + lastRun=sent（唤醒执行）+ lastError 摘除')
      assert.strictEqual((S.persistLogs.get(GONE_SID) || []).length, 0, '补发走唤醒执行（零 inbox splice）')
    } finally {
      if (goneId) await handlers['notes-delete']({ id: goneId })
      const i = S.ws1SessionIds.indexOf(GONE_SID); if (i >= 0) S.ws1SessionIds.splice(i, 1)   // 复位账目
      S.persistLogs.delete(GONE_SID)
      S.createdAgents.delete(GONE_SID)   // 复位：唤醒补发把 GONE_SID 注册为 live，删除回归休眠态
    }
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

  // ===== 声明重锚 declaredAt（0.4.6-F，notes-046-sched-anchor）：修「编辑存量约定后当天误触发一轮」 =====
  // 造数：直写 store 构造存量笔记（老 createdAt / 指定 declaredAt / 缺字段——cache 未命中由磁盘解析，同真实存量路径；节 42 先例）
  const mdOf46F = (id, title, createdAtIso, schedObj) => {
    const schedJson = JSON.stringify(schedObj)
    return '---\n' +
      'id: ' + id + '\n' +
      'title: ' + title + '\n' +
      'topic: 未分类\n' +
      'workspace: deepseek-work\n' +
      'folder: \n' +
      'tags: \n' +
      'kind: todo\n' +
      'status: active\n' +
      'inject: false\n' +
      'injectEver: false\n' +
      'injectTo: \n' +
      'sensitive: false\n' +
      'createdAt: "' + createdAtIso + '"\n' +
      'updatedAt: "' + createdAtIso + '"\n' +
      'sessionId: ' + LIVE_SID + '\n' +
      'cwd: "D:\\deepseek-work"\n' +
      'logDate: \n' +
      'mergedFrom: \n' +
      'contractType: dispatch-schedule\n' +
      'schedule: "' + schedJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"\n' +
      'dispatches: "[]"\n' +
      'archivedAt: \n' +
      'deleted: false\n' +
      '---\n' +
      '0.4.6-F 断言造数正文\n'
  }

  await t('declaredAt 写入闸门：首次=now + 声明变更刷新 + 未变更/正文改写延续 + 伪 declaredAt 剥离（断言④）', async () => {
    const c = await handlers['notes-create']({ title: '重锚约定A', body: '声明重锚断言', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID, declaredAt: '2020-01-01T00:00:00.000Z' } })
    assert(c && c.id && !c.error, '创建成功（携带伪 declaredAt 试探剥离，实得 ' + JSON.stringify(c) + '）')
    let g = await handlers['notes-get']({ id: c.id })
    const d0 = g.note.schedule.declaredAt
    assert(d0 && d0 !== '2020-01-01T00:00:00.000Z' && Math.abs(Date.parse(d0) - Date.now()) < 60000, '首次写入 declaredAt=now（输入伪值剥离，实得 ' + d0 + '）')
    const raw0 = store.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(raw0.indexOf('declaredAt') >= 0, 'declaredAt 随 schedule JSON 落 front-matter 条件行')
    // 断言④：声明未变更的 update（等价重提交）→ declaredAt 延续不刷新
    let u = await handlers['notes-update']({ id: c.id, schedule: { every: '3d', target: LIVE_SID } })
    assert(u && !u.error, '等价声明重提交成功（实得 ' + JSON.stringify(u) + '）')
    g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.declaredAt, d0, '声明未变更的 update 不刷新 declaredAt（断言④）')
    // 断言④：只改正文 → 不过声明闸门 → 延续
    u = await handlers['notes-update']({ id: c.id, body: '只改正文不动声明' })
    assert(u && !u.error, '正文更新成功')
    g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.declaredAt, d0, '只改正文 declaredAt 延续（断言④）')
    // 声明变更（every 3d→7d + 伪 declaredAt 二次试探）→ 刷新 now
    u = await handlers['notes-update']({ id: c.id, schedule: { every: '7d', target: LIVE_SID, declaredAt: '1999-12-31T00:00:00.000Z' } })
    assert(u && !u.error, '声明变更成功（实得 ' + JSON.stringify(u) + '）')
    g = await handlers['notes-get']({ id: c.id })
    const d1 = g.note.schedule.declaredAt
    assert(d1 && d1 !== '1999-12-31T00:00:00.000Z' && Date.parse(d1) >= Date.parse(d0) && Math.abs(Date.parse(d1) - Date.now()) < 60000, '声明变更刷新 declaredAt=now（伪值再剥离，实得 ' + d1 + '）')
    // enabled 翻转（暂停）属声明字段 → 刷新
    u = await handlers['notes-update']({ id: c.id, schedule: { every: '7d', target: LIVE_SID, enabled: false } })
    assert(u && !u.error, '暂停改写成功')
    g = await handlers['notes-get']({ id: c.id })
    assert(Date.parse(g.note.schedule.declaredAt) >= Date.parse(d1), 'enabled 翻转刷新 declaredAt（声明字段，实得 ' + g.note.schedule.declaredAt + '）')
    await handlers['notes-delete']({ id: c.id })
  })

  await t('declaredAt 确定性变更判定（存量 declaredAt=2020 造数）：未变更延续旧值 / 变更刷新 now', async () => {
    const LEG = 'n-reanchor046fa'
    try {
      const oldIso = new Date(Date.now() - 10 * 86400000).toISOString()
      store.set(NOTES_DIR + '\\' + LEG + '.md', mdOf46F(LEG, '存量重锚约定', oldIso, { every: '3d', target: LIVE_SID, action: 'dispatch', enabled: true, declaredAt: '2020-01-01T00:00:00.000Z' }))
      let g = await handlers['notes-get']({ id: LEG })
      assert(g && g.note && g.note.schedule && g.note.schedule.declaredAt === '2020-01-01T00:00:00.000Z', '造数读取 declaredAt=2020（front-matter JSON 往返）')
      let u = await handlers['notes-update']({ id: LEG, schedule: { every: '3d', target: LIVE_SID } })
      assert(u && !u.error, '等价重提交成功（实得 ' + JSON.stringify(u) + '）')
      g = await handlers['notes-get']({ id: LEG })
      assert.strictEqual(g.note.schedule.declaredAt, '2020-01-01T00:00:00.000Z', '声明未变更 → 存量 declaredAt 原样延续（确定性）')
      u = await handlers['notes-update']({ id: LEG, schedule: { every: '7d', target: LIVE_SID } })
      assert(u && !u.error, '声明变更成功')
      g = await handlers['notes-get']({ id: LEG })
      assert(g.note.schedule.declaredAt !== '2020-01-01T00:00:00.000Z' && Math.abs(Date.parse(g.note.schedule.declaredAt) - Date.now()) < 60000, '声明变更 → declaredAt 刷新为 now（确定性，实得 ' + g.note.schedule.declaredAt + '）')
    } finally {
      await handlers['notes-delete']({ id: LEG })   // finally 清理：断言失败也不留活口污染后续节评估计数
    }
  })

  await t('编辑重锚行为级（断言①③）：老约定编辑后当天不触发，下个调度点才触发；触发后锚点=lastFiredAt', async () => {
    const LEG = 'n-reanchor046fb'
    try {
      const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()
      const declaredIso = new Date().toISOString()   // 模拟「刚编辑过声明」：declaredAt = 现在（真实时钟）
      const declaredMs = Date.parse(declaredIso)
      store.set(NOTES_DIR + '\\' + LEG + '.md', mdOf46F(LEG, '老约定重锚', tenDaysAgo, { every: '3d', target: LIVE_SID, action: 'dispatch', enabled: true, declaredAt: declaredIso }))
      // 修复前口径：now - createdAt = 10d ≥ 3d → 当天立即误触发；修复后锚点 = declaredAt（现在）→ 不到期
      let ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 60000).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, '编辑后当天不触发（declaredAt 重锚，实得 ' + JSON.stringify(ev) + '）')
      let g = await handlers['notes-get']({ id: LEG })
      assert(!g.note.schedule.lastFiredAt, 'lastFiredAt 仍空（未误触发）')
      // 下个调度点（declaredAt + 3d）边界：前 1min 不触发，到点触发
      ev = await handlers['notes-schedule-eval']({ now: new Date(declaredMs + 3 * 86400000 - 60000).toISOString() })
      assert(ev.fired === 0, 'declaredAt+3d 前 1min 不触发（实得 ' + JSON.stringify(ev) + '）')
      const before = sentMessages.length
      const fireClock = new Date(declaredMs + 3 * 86400000 + 60000).toISOString()
      ev = await handlers['notes-schedule-eval']({ now: fireClock })
      assert(ev.fired === 1 && ev.errors === 0, '下个调度点准点触发（实得 ' + JSON.stringify(ev) + '）')
      assert.strictEqual(sentMessages.length, before + 1, '恰好一次派发')
      g = await handlers['notes-get']({ id: LEG })
      assert.strictEqual(g.note.schedule.lastFiredAt, fireClock, 'lastFiredAt=触发时刻')
      assert.strictEqual(g.note.schedule.declaredAt, declaredIso, '触发不触碰 declaredAt（机器字段各司其职）')
      // 断言③回归：触发后锚点 = lastFiredAt（非 declaredAt）——距触发 1d < 3d 不触发（若锚点退回 declaredAt：4d+ ≥ 3d 会误触发，本断言即红）
      ev = await handlers['notes-schedule-eval']({ now: new Date(declaredMs + 4 * 86400000 + 120000).toISOString() })
      assert(ev.fired === 0, '触发后锚点=lastFiredAt（距 lastFiredAt 1d 不触发，断言③回归）')
      ev = await handlers['notes-schedule-eval']({ now: new Date(Date.parse(fireClock) + 3 * 86400000 + 60000).toISOString() })
      assert(ev.fired === 1, 'lastFiredAt+3d 再次到期（周期推进正常）')
    } finally {
      await handlers['notes-delete']({ id: LEG })   // finally 清理：断言失败也不留活口污染后续节评估计数
    }
  })

  await t('存量兼容（断言②）：无 declaredAt 字段回退 createdAt 锚点（到期语义不变 + 字段零迁移）', async () => {
    const LEG = 'n-reanchor046fc'
    try {
      const GONE = 'session-gone046f00-0000-0000-0000-000000000000'   // 非 live 且持久化不可达：到期尝试触发失败记 lastError，不产生派发消息（断言零干扰）
      const tenDaysAgo = Date.now() - 10 * 86400000
      store.set(NOTES_DIR + '\\' + LEG + '.md', mdOf46F(LEG, '存量无重锚字段约定', new Date(tenDaysAgo).toISOString(), { every: '3d', target: GONE, action: 'dispatch', enabled: true }))
      // createdAt+2d（首个到期点之前）→ 不到期：createdAt 锚点语义不变
      let ev = await handlers['notes-schedule-eval']({ now: new Date(tenDaysAgo + 2 * 86400000).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, 'createdAt+2d 不到期（实得 ' + JSON.stringify(ev) + '）')
      // createdAt+4d ≥ +3d → 到期（触发尝试失败记 lastError = 到期判定回退 createdAt 生效的行为证据）
      ev = await handlers['notes-schedule-eval']({ now: new Date(tenDaysAgo + 4 * 86400000).toISOString() })
      assert(ev.fired === 0 && ev.errors === 1, '存量无 declaredAt → 回退 createdAt 到期（实得 ' + JSON.stringify(ev) + '）')
      const g = await handlers['notes-get']({ id: LEG })
      assert(!('declaredAt' in g.note.schedule), 'declaredAt 字段零迁移（机器状态回写不补字段）')
      assert(!g.note.schedule.lastFiredAt && g.note.schedule.lastError, 'lastFiredAt 不推进 + lastError 落盘（不可送达语义不变）')
      const raw = store.get(NOTES_DIR + '\\' + LEG + '.md')
      const schedLine = (raw || '').split('\n').find(l => l.indexOf('schedule:') === 0) || ''
      assert(schedLine && schedLine.indexOf('declaredAt') < 0 && schedLine.indexOf('lastError') >= 0, '磁盘 schedule 行仍无 declaredAt（存量零迁移）+ lastError 落盘（实得 ' + schedLine.slice(0, 120) + '…）')
    } finally {
      await handlers['notes-delete']({ id: LEG })   // finally 清理：断言失败也不留活口污染后续节评估计数
    }
  })

  await t('anchor 首触防过去候选（断言①对齐轮询不追赶）：base 陈旧 → 候选落过去不补发，下个锚定点才触发', async () => {
    const LEG = 'n-reanchor046fd'
    try {
      const nowReal = Date.now()
      const threeDaysAgo = new Date(nowReal - 3 * 86400000).toISOString()
      store.set(NOTES_DIR + '\\' + LEG + '.md', mdOf46F(LEG, '锚定存量约定', threeDaysAgo, { every: '1d', anchor: '09:00', target: LIVE_SID, action: 'dispatch', enabled: true, declaredAt: threeDaysAgo }))
      // 修复前口径：base=3d 前 → 首触候选=base 次日 09:00（落在过去）→ now≥next 恒真立即误触发；修复后对齐「now 之后第一个 09:00」
      const nd = new Date(nowReal), ndMid = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate()).getTime()
      const nextAnchor = (ndMid + 9 * 3600000 >= nowReal ? ndMid : ndMid + 86400000) + 9 * 3600000   // 与首触防过去候选口径同构的期望推算
      let ev = await handlers['notes-schedule-eval']({ now: new Date(nowReal).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, '候选落过去不补发（首轮不追赶，实得 ' + JSON.stringify(ev) + '）')
      ev = await handlers['notes-schedule-eval']({ now: new Date(nextAnchor - 60000).toISOString() })
      assert(ev.fired === 0, '下个锚定点前 1min 不触发（实得 ' + JSON.stringify(ev) + '）')
      const before = sentMessages.length
      ev = await handlers['notes-schedule-eval']({ now: new Date(nextAnchor).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, '下个锚定点 09:00 准点触发（实得 ' + JSON.stringify(ev) + '）')
      assert.strictEqual(sentMessages.length, before + 1, '恰好一次派发')
      const g = await handlers['notes-get']({ id: LEG })
      assert.strictEqual(g.note.schedule.lastFiredAt, new Date(nextAnchor).toISOString(), 'lastFiredAt=锚定点触发时刻')
      assert.strictEqual(g.note.schedule.declaredAt, threeDaysAgo, 'declaredAt 不被触发触碰')
      // 触发后锚定序列不漂移（fired 分支不注入防过去闸：停机补发一次语义保留）——次日 09:00 再触发一次
      ev = await handlers['notes-schedule-eval']({ now: new Date(nextAnchor + 3600000).toISOString() })
      assert(ev.fired === 0, '触发后当日不再触发（防重）')
      ev = await handlers['notes-schedule-eval']({ now: new Date(nextAnchor + 86400000).toISOString() })
      assert(ev.fired === 1, '次日 09:00 准点触发（锚定序列钉死不漂移）')
    } finally {
      await handlers['notes-delete']({ id: LEG })   // finally 清理：断言失败也不留活口污染后续节评估计数
    }
  })

  // ===== 0.4.7 首触防过去闸收紧（notes-047-anchor-firstfire）：原闸「候选 < nowMs 即跳日」过宽——30s 轮询时钟恒晚于锚点几秒~几分钟 =====
  //   （虚拟时钟测试精确对齐等号全绿 = 测试时钟盲区，用户实测钓出：新建锚定任务首触永不触发）；收紧为「陈旧整天以上才跳」
  //   （候选 < now 当日午夜），当日内错过的锚点当日内补发（与 at 单次停机补发语义对齐）；weekly/dow 分支 scan0 同款过宽同法收紧
  await t('0.4.7 首触闸收紧（断言①）：当日建+当日锚点已过几分钟（轮询时钟）→ 当日内补发触发（修复前跳次日=首触永不触发）', async () => {
    const LEG = 'n-anchor047a'
    try {
      const n0 = new Date(), y = n0.getFullYear(), mo = n0.getMonth(), dd = n0.getDate()
      const baseIso = new Date(y, mo, dd, 20, 41, 42).toISOString()   // 当日 20:41:42 建（用户现场时刻复刻）
      store.set(NOTES_DIR + '\\' + LEG + '.md', mdOf46F(LEG, '首触闸收紧约定', baseIso, { every: '1d', anchor: '20:45', target: LIVE_SID, action: 'dispatch', enabled: true, declaredAt: baseIso }))
      let ev = await handlers['notes-schedule-eval']({ now: new Date(y, mo, dd, 20, 44, 59).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, '锚点前 1min 不触发（实得 ' + JSON.stringify(ev) + '）')
      // 断言①：now=当日 21:04:30（轮询 tick 晚于锚点 19 分钟）→ next=当日 20:45 → due=true（修复前闸跳次日 20:45、due=false——本断言锁定回归）
      const tickClock = new Date(y, mo, dd, 21, 4, 30).toISOString()
      const before = sentMessages.length
      ev = await handlers['notes-schedule-eval']({ now: tickClock })
      assert(ev.fired === 1 && ev.errors === 0, '断言①：当日锚点刚过 → 当日内补发触发（0.4.7 闸收紧，实得 ' + JSON.stringify(ev) + '）')
      assert.strictEqual(sentMessages.length, before + 1, '恰好一次派发')
      let g = await handlers['notes-get']({ id: LEG })
      assert.strictEqual(g.note.schedule.lastFiredAt, tickClock, 'lastFiredAt=补发 tick 时刻（注入时钟）')
      ev = await handlers['notes-schedule-eval']({ now: tickClock })
      assert(ev.fired === 0, '同时钟防重')
      // fired 分支不动（红线：:90 分支不注入该闸）：次日 20:45 准点再触发
      ev = await handlers['notes-schedule-eval']({ now: new Date(y, mo, dd + 1, 20, 45, 0).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, 'fired 分支不动：次日 20:45 准点触发（实得 ' + JSON.stringify(ev) + '）')
      g = await handlers['notes-get']({ id: LEG })
      assert.strictEqual(g.note.schedule.declaredAt, baseIso, 'declaredAt 不被触发触碰')
    } finally {
      await handlers['notes-delete']({ id: LEG })   // finally 清理：断言失败也不留活口污染后续节评估计数
    }
  })

  await t('0.4.7 闸收紧不退化（断言②③④）：陈旧欠款仍跳日不补发 + 跨日 00:00 边界 + declaredAt 重锚当天不误触', async () => {
    // 断言②：base=3 天前 10:00（declaredAt 同）、now=今日 15:00、anchor=09:00 → 候选陈旧整天以上 → next=明日 09:00、due=false（欠款不补发不退化）
    const LEG = 'n-anchor047b'
    try {
      const n0 = new Date(), y = n0.getFullYear(), mo = n0.getMonth(), dd = n0.getDate()
      const baseIso = new Date(y, mo, dd - 3, 10, 0, 0).toISOString()
      store.set(NOTES_DIR + '\\' + LEG + '.md', mdOf46F(LEG, '陈旧欠款锚定约定', baseIso, { every: '1d', anchor: '09:00', target: LIVE_SID, action: 'dispatch', enabled: true, declaredAt: baseIso }))
      let ev = await handlers['notes-schedule-eval']({ now: new Date(y, mo, dd, 15, 0, 0).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, '断言②：陈旧欠款 → 今日不补发（实得 ' + JSON.stringify(ev) + '）')
      const na = new Date(y, mo, dd + 1, 9, 0, 0).getTime()   // 明日 09:00
      ev = await handlers['notes-schedule-eval']({ now: new Date(na - 60000).toISOString() })
      assert(ev.fired === 0, '断言②：明日 09:00 前 1min 不触发')
      ev = await handlers['notes-schedule-eval']({ now: new Date(na).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, '断言②：next=明日 09:00 准点触发（实得 ' + JSON.stringify(ev) + '）')
    } finally {
      await handlers['notes-delete']({ id: LEG })
    }
    // 断言③：跨日边界——锚点 00:00（今日 10:00 建）→ now=今日 23:59 未来候选闸不插手；次日 00:00:30 tick 当日内补发（修复前跳后日=永不触发）
    const LEG2 = 'n-anchor047c'
    try {
      const n0 = new Date(), y = n0.getFullYear(), mo = n0.getMonth(), dd = n0.getDate()
      const baseIso = new Date(y, mo, dd, 10, 0, 0).toISOString()
      store.set(NOTES_DIR + '\\' + LEG2 + '.md', mdOf46F(LEG2, '跨日零点锚定约定', baseIso, { every: '1d', anchor: '00:00', target: LIVE_SID, action: 'dispatch', enabled: true, declaredAt: baseIso }))
      let ev = await handlers['notes-schedule-eval']({ now: new Date(y, mo, dd, 23, 59, 0).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, '断言③：now=23:59 vs anchor=00:00 → 未来候选不触发（实得 ' + JSON.stringify(ev) + '）')
      const midTick = new Date(y, mo, dd + 1, 0, 0, 30).toISOString()
      ev = await handlers['notes-schedule-eval']({ now: midTick })
      assert(ev.fired === 1 && ev.errors === 0, '断言③：跨日 00:00:30 tick → 零点锚点当日内补发（实得 ' + JSON.stringify(ev) + '）')
      const g = await handlers['notes-get']({ id: LEG2 })
      assert.strictEqual(g.note.schedule.lastFiredAt, midTick, 'lastFiredAt=跨日 tick 时刻')
    } finally {
      await handlers['notes-delete']({ id: LEG2 })
    }
    // 断言④：declaredAt 重锚回归（0.4.6-F 原修复场景 + anchor）——编辑存量锚定约定（declaredAt=今日 15:00）当天不误触发，下个锚定点才触发
    const LEG3 = 'n-anchor047d'
    try {
      const n0 = new Date(), y = n0.getFullYear(), mo = n0.getMonth(), dd = n0.getDate()
      const createdIso = new Date(y, mo, dd - 10, 9, 0, 0).toISOString()   // 老 createdAt（10 天前）
      const declIso = new Date(y, mo, dd, 15, 0, 0).toISOString()         // 模拟「今日 15:00 刚编辑过声明」：declaredAt 重锚
      store.set(NOTES_DIR + '\\' + LEG3 + '.md', mdOf46F(LEG3, '编辑重锚锚定约定', createdIso, { every: '1d', anchor: '09:00', target: LIVE_SID, action: 'dispatch', enabled: true, declaredAt: declIso }))
      let ev = await handlers['notes-schedule-eval']({ now: new Date(y, mo, dd, 16, 0, 0).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, '断言④：编辑锚定约定当天不误触发（declaredAt 重锚回归，实得 ' + JSON.stringify(ev) + '）')
      ev = await handlers['notes-schedule-eval']({ now: new Date(y, mo, dd + 1, 9, 0, 0).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, '断言④：下个锚定点（明日 09:00）准点触发（实得 ' + JSON.stringify(ev) + '）')
    } finally {
      await handlers['notes-delete']({ id: LEG3 })
    }
  })

  await t('0.4.7 weekly 同款闸收紧：当日 dow 锚点刚过 → 当日内补发不跳下周；陈旧 weekly 欠款仍跳下周（scan0 抬升同款过宽复核）', async () => {
    const LEG = 'n-anchor047e'
    try {
      const n0 = new Date(), y = n0.getFullYear(), mo = n0.getMonth(), dd = n0.getDate()
      const dow = n0.getDay()   // 今日即 dow
      const baseIso = new Date(y, mo, dd, 10, 0, 0).toISOString()   // 当日 10:00 建
      store.set(NOTES_DIR + '\\' + LEG + '.md', mdOf46F(LEG, '周锚定首触约定', baseIso, { every: '1w', anchor: '10:30', dow: dow, target: LIVE_SID, action: 'dispatch', enabled: true, declaredAt: baseIso }))
      // 当日 dow 锚点 10:30 刚过 5 分钟（轮询时钟）→ 当日内补发（修复前候选 < nowMs 跳下周 = 首触永不触发）
      const tick = new Date(y, mo, dd, 10, 35, 0).toISOString()
      const ev = await handlers['notes-schedule-eval']({ now: tick })
      assert(ev.fired === 1 && ev.errors === 0, 'weekly 首触：当日锚点刚过 → 当日内补发不跳下周（0.4.7 同款收紧，实得 ' + JSON.stringify(ev) + '）')
      const g = await handlers['notes-get']({ id: LEG })
      assert.strictEqual(g.note.schedule.lastFiredAt, tick, 'lastFiredAt=weekly 补发 tick 时刻')
    } finally {
      await handlers['notes-delete']({ id: LEG })
    }
    const LEG2 = 'n-anchor047f'
    try {
      const n0 = new Date(), y = n0.getFullYear(), mo = n0.getMonth(), dd = n0.getDate()
      const dow = n0.getDay()
      const baseIso = new Date(y, mo, dd - 21, 10, 0, 0).toISOString()   // 3 周前（同星期几）
      store.set(NOTES_DIR + '\\' + LEG2 + '.md', mdOf46F(LEG2, '周锚定陈旧约定', baseIso, { every: '1w', anchor: '10:30', dow: dow, target: LIVE_SID, action: 'dispatch', enabled: true, declaredAt: baseIso }))
      // 陈旧 weekly 欠款：今日即 dow 但锚点已过 → 跳下周（首轮不补发，欠款语义不退化）
      let ev = await handlers['notes-schedule-eval']({ now: new Date(y, mo, dd, 10, 35, 0).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, '陈旧 weekly 欠款 → 今日不补发（实得 ' + JSON.stringify(ev) + '）')
      ev = await handlers['notes-schedule-eval']({ now: new Date(y, mo, dd + 7, 10, 30, 0).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, '下周同 dow 10:30 准点触发（实得 ' + JSON.stringify(ev) + '）')
    } finally {
      await handlers['notes-delete']({ id: LEG2 })
    }
  })

  // ===== 时间闸门断言三件套（0.4.7-A⑦ notes-047-cleanup；P0 首触 bug 测试盲区教训：真实轮询时钟打不中精确等号）=====
  //   凡含 nowMs 注入的判定函数各补一轮「精确命中 / 差一秒未到 / 差几秒已过」非对齐值变体：
  //   schedDueAt 三分支（every 纯间隔 nowMs-base>=iv / at 单次 atMs<=nowMs && firedMs<atMs / anchor 锚定 nowMs>=next）+ lastError 5min 节流闸（nowMs-lastErrMs<RETRY）。
  //   注意：触发会推进 lastFiredAt，三件套的「已过」变体须分篇造数（同篇首触后边界语义已变）。
  await t('时间闸门三件套（非对齐值变体）：every/at/anchor 三判定分支 + lastError 节流闸 各补 精确命中/差一秒未到/差几秒已过', async () => {
    // ---- every 纯间隔分支（nowMs - base >= iv；base=declaredAt 重锚口径） ----
    const cE = await handlers['notes-create']({ title: '三件套轮询约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    try {
      const dMs = Date.parse((await handlers['notes-get']({ id: cE.id })).note.schedule.declaredAt)
      assert(isFinite(dMs), 'declaredAt 可读（0.4.6-F 锚点）')
      let ev = await handlers['notes-schedule-eval']({ now: new Date(dMs + 3 * 86400000 - 1000).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, 'every：差一秒未到不触发（实得 ' + JSON.stringify(ev) + '）')
      ev = await handlers['notes-schedule-eval']({ now: new Date(dMs + 3 * 86400000).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, 'every：精确命中 base+3d 即触发（等号归属到期侧，实得 ' + JSON.stringify(ev) + '）')
    } finally { await handlers['notes-delete']({ id: cE.id }) }
    const cE2 = await handlers['notes-create']({ title: '三件套轮询约定乙', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    try {
      const dMs2 = Date.parse((await handlers['notes-get']({ id: cE2.id })).note.schedule.declaredAt)
      const ev = await handlers['notes-schedule-eval']({ now: new Date(dMs2 + 3 * 86400000 + 3000).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, 'every：差几秒已过照常触发（轮询时钟语义，实得 ' + JSON.stringify(ev) + '）')
    } finally { await handlers['notes-delete']({ id: cE2.id }) }
    // ---- at 单次分支（atMs <= nowMs && firedMs < atMs；localIso 精度到秒——边界按秒整对齐） ----
    const atIso1 = localIso(Date.now() + 120000)
    const atMs1 = Date.parse(atIso1)
    const cA1 = await handlers['notes-create']({ title: '三件套单次约定', body: 'x', contractType: 'dispatch-schedule', schedule: { at: atIso1, target: LIVE_SID } })
    try {
      let ev = await handlers['notes-schedule-eval']({ now: new Date(atMs1 - 1000).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, 'at：差一秒未到不触发（实得 ' + JSON.stringify(ev) + '）')
      ev = await handlers['notes-schedule-eval']({ now: new Date(atMs1).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, 'at：精确命中 atMs 即触发（等号归属到期侧，实得 ' + JSON.stringify(ev) + '）')
    } finally { await handlers['notes-delete']({ id: cA1.id }) }
    const atIso2 = localIso(Date.now() + 120000)
    const atMs2 = Date.parse(atIso2)
    const cA2 = await handlers['notes-create']({ title: '三件套单次约定乙', body: 'x', contractType: 'dispatch-schedule', schedule: { at: atIso2, target: LIVE_SID } })
    try {
      const ev = await handlers['notes-schedule-eval']({ now: new Date(atMs2 + 5000).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, 'at：差几秒已过补发一次（停机错过语义，实得 ' + JSON.stringify(ev) + '）')
    } finally { await handlers['notes-delete']({ id: cA2.id }) }
    // ---- anchor 锚定分支（nowMs >= schedAnchorNextMs(...)） ----
    const cN1 = await handlers['notes-create']({ title: '三件套锚定约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '09:00', target: LIVE_SID } })
    try {
      const created = Date.parse((await handlers['notes-get']({ id: cN1.id })).note.createdAt)
      const d0 = new Date(created), dayMid = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime()
      const firstDue = (dayMid + 9 * 3600000 > created ? dayMid : dayMid + 86400000) + 9 * 3600000   // 下一个本地 09:00（同上方锚定行为断言口径）
      let ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue - 1000).toISOString() })
      assert(ev.fired === 0 && ev.errors === 0, 'anchor：差一秒未到不触发（实得 ' + JSON.stringify(ev) + '）')
      ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, 'anchor：精确命中锚定时刻即触发（等号归属到期侧，实得 ' + JSON.stringify(ev) + '）')
    } finally { await handlers['notes-delete']({ id: cN1.id }) }
    const cN2 = await handlers['notes-create']({ title: '三件套锚定约定乙', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '1d', anchor: '09:00', target: LIVE_SID } })
    try {
      const created2 = Date.parse((await handlers['notes-get']({ id: cN2.id })).note.createdAt)
      const d2 = new Date(created2), dayMid2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate()).getTime()
      const firstDue2 = (dayMid2 + 9 * 3600000 > created2 ? dayMid2 : dayMid2 + 86400000) + 9 * 3600000
      const ev = await handlers['notes-schedule-eval']({ now: new Date(firstDue2 + 5000).toISOString() })
      assert(ev.fired === 1 && ev.errors === 0, 'anchor：差几秒已过照常触发（当日内补发，0.4.7 闸收紧口径，实得 ' + JSON.stringify(ev) + '）')
    } finally { await handlers['notes-delete']({ id: cN2.id }) }
    // ---- lastError 5min 节流闸（nowMs - lastErrMs < SCHED_ERR_RETRY_MS；< 号等号归属刷新侧） ----
    const GONE_SID = 'session-gone047a00-0000-0000-0000-000000000000'   // 声明期存活（就地扩账）执行期持久化失联 → 每轮到期必失败
    S.ws1SessionIds.push(GONE_SID)
    let goneId = null
    try {
      const c = await handlers['notes-create']({ title: '三件套节流约定', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '5m', target: GONE_SID } })
      assert(c && c.id && !c.error, '节流探针创建（实得 ' + JSON.stringify(c) + '）')
      goneId = c.id
      const t0 = new Date(Date.now() + 3600000).toISOString()
      let ev = await handlers['notes-schedule-eval']({ now: t0 })
      assert(ev.fired === 0 && ev.errors === 1, '节流基线：首次故障落 lastError（实得 ' + JSON.stringify(ev) + '）')
      let g = await handlers['notes-get']({ id: c.id })
      assert.strictEqual(g.note.schedule.lastError.at, t0, 'lastError.at = 基线时刻')
      ev = await handlers['notes-schedule-eval']({ now: new Date(Date.parse(t0) + 300000 - 1000).toISOString() })
      g = await handlers['notes-get']({ id: c.id })
      assert(ev.errors === 1 && g.note.schedule.lastError.at === t0, '节流闸：差一秒未到窗不刷写（实得 ' + g.note.schedule.lastError.at + '）')
      const t1 = new Date(Date.parse(t0) + 300000).toISOString()
      ev = await handlers['notes-schedule-eval']({ now: t1 })
      g = await handlers['notes-get']({ id: c.id })
      assert(ev.errors === 1 && g.note.schedule.lastError.at === t1, '节流闸：精确命中窗口边缘即刷写（等号归属刷新侧）')
      const t2 = new Date(Date.parse(t1) + 300000 + 3000).toISOString()
      ev = await handlers['notes-schedule-eval']({ now: t2 })
      g = await handlers['notes-get']({ id: c.id })
      assert(ev.errors === 1 && g.note.schedule.lastError.at === t2, '节流闸：差几秒已过窗照常刷写')
    } finally {
      if (goneId) await handlers['notes-delete']({ id: goneId })
      const i = S.ws1SessionIds.indexOf(GONE_SID); if (i >= 0) S.ws1SessionIds.splice(i, 1)   // 复位账目（防污染后续节会话清单口径）
    }
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
      // 0.4.6-F（notes-046-sched-anchor）：declaredAt 声明重锚 + 首触防过去候选——静态锚点双包看守
      assert(src.indexOf('declaredAt: 1') >= 0 && src.indexOf('function schedDeclChanged(') >= 0, tag + ' declaredAt 已知键 + 声明变更比对（0.4.6-F）')
      assert(src.indexOf('firedMs || declaredMs ||') >= 0, tag + ' 到期锚点 lastFiredAt||declaredAt||createdAt（0.4.6-F）')
      assert(src.indexOf('首触防过去候选') >= 0 && src.indexOf('!!firedMs, nowMs)') >= 0, tag + ' 首触防过去候选注入 nowMs（0.4.6-F）')
      // 0.4.7（notes-047-anchor-firstfire）：闸收紧为「陈旧整天以上才跳」（first < nday0）——轮询时钟 vs 精确等号盲区热修，静态锚点双包看守
      assert(src.indexOf('first < nday0') >= 0 && src.indexOf('firstDow < nday0') >= 0 && src.indexOf('notes-047-anchor-firstfire') >= 0, tag + ' 首触防过去闸收紧=陈旧整天以上才跳（0.4.7，daily+weekly 同款）')
    }
  })

  await t('静态包行为：index.mjs 声明解析 + 注入时钟触发 + 防重（webServer 路由链路）', async () => {
    const c = await rpc2('notes-create', { title: '静态调度约定', body: '静态包巡检', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    assert(c.body && c.body.id && !c.body.error, '静态包创建调度约定（实得 ' + JSON.stringify(c.body) + '）')
    const sid = c.body.id
    const g0st = await rpc2('notes-get', { id: sid })
    assert(g0st.body && g0st.body.note.schedule.declaredAt && Math.abs(Date.parse(g0st.body.note.schedule.declaredAt) - Date.now()) < 60000, '静态包首次写入 declaredAt=now（0.4.6-F 声明重锚双包一致，实得 ' + (g0st.body && g0st.body.note.schedule.declaredAt) + '）')
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
