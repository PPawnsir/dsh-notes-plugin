// 节 83. 0.4.4-B 休眠会话送达 + 定时派发专属会话复用（notes-044-dormant-dispatch）
// 设计定稿（主窗口调研笔记 + 用户裁决 2026-10-06）：
//   A. _dispatch 双通道：live 命中走 agent.send（行为不变）；未命中走 sessionPersistence durable inbox 追加
//      （agent/inbox/spliced——与 live send(msg,'next-turn') 落盘记录同形态，零唤醒零成本「下次活动送达」）；
//      dispatches 记录带 queued 布尔；执行记录 📤 行注（下次活动送达）。
//   B. 派发弹窗目标列表 = 活跃+休眠双区（数据源 _activeSessions 既有全量能力），休眠行标注「下次活动送达」；
//      client 去除「先打开激活」强开唤醒路径（零唤醒红线）。
//   C. schedule.target='new'（仅周期模式）：首轮触发 agents.create 创建「定时 · <任务名>」专属会话
//      （agentPresets.mount 默认 preset = 工具能力 + workspace.attachSession 落账 = GUI 可见 + sessionTitle.rename 命名），
//      随幂等生命线回写 target=新 sid（持久复用）；后续轮次 live 直发 / 休眠送达复用同 sid。
// 测试策略：共享 mock 集群（节 2 扩展 persistLogs/createdAgents/agentPresetsMock/attachCalls/titleRenameCalls/ws1SessionIds）
//   + 注入时钟（notes-schedule-eval {now}）驱动确定性到期；测试调度用 every≥3d（真实时钟永不到期），后台 tick 零干扰。
module.exports = {
  id: "83",
  title: "83. 0.4.4-B 休眠会话送达 + 定时派发专属会话复用",
  async run(H, S) {
  const { t, section, assert, fsNative, path, hostSrc, clientSrc, indexSrc } = H
  const { handlers, noteManage, sentMessages, store, NOTES_DIR, rpc2, evtListeners } = S
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'       // helpers mock 唯一初始 live 会话
  const OFFLINE_SID = 'session-sub9900000-0000-0000-0000-000000000000'  // 工作区有效未归档但非 live（持久化有日志 = 休眠可送达）
  const flush = () => new Promise(r => setTimeout(r, 80))
  const entryLines = (body) => String(body || '').split('\n').filter(l => /^- /.test(l))
  section('83. 0.4.4-B 休眠会话送达 + 定时派发专属会话复用')
  // 后台 tick 闸沉降（同节 59/81 口径：防启动补评估与断言交错）
  for (let i = 0; i < 40; i++) {
    const probe = await handlers['notes-schedule-eval']({ now: '2020-01-01T00:00:00.000Z' })
    if (probe && !probe.skipped) break
    await new Promise(r => setTimeout(r, 50))
  }

  // ===== A① 休眠目标派发：queued 记录 + 日志追加 inbox splice + 重开可见（折叠可读出） =====
  let dormNote = ''
  await t('休眠目标派发 → queued:true + durable inbox splice 落盘（agent/inbox/spliced 同 live send 形态）+ 执行记录行注（下次活动送达）', async () => {
    const c = await handlers['notes-create']({ title: '休眠派单82', body: '休眠投递正文载荷', kind: 'todo' })
    assert(c && c.id && !c.error, '创建源笔记成功（实得 ' + JSON.stringify(c) + '）')
    dormNote = c.id
    const logBefore = (S.persistLogs.get(OFFLINE_SID) || []).length
    // 派发前折叠 inbox 长度（日志 append-only：前节/前测试的排队消息仍在——start 断言以前态为基准，不假设空队列）
    const inboxLenBefore = (S.persistLogs.get(OFFLINE_SID) || []).reduce(function (acc, ev) {
      if (!ev || ev.type !== 'agent/inbox/spliced' || ev.data.target !== 'next-turn') return acc
      var del = ev.data.removedCount || 0
      return acc - del + ((ev.data.inserted || []).length)
    }, 0)
    const before = sentMessages.length
    const r = await handlers['notes-dispatch']({ id: c.id, sessionId: OFFLINE_SID, sessionName: '离线会话', instruction: '醒了就办' })
    assert(r && r.ok === true && r.queued === true, '休眠派发成功且 queued:true（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(sentMessages.length, before, '零唤醒红线：未走 agent.send')
    const g = await handlers['notes-get']({ id: c.id })
    const d = (g.note.dispatches || [])[0]
    assert(d && d.queued === true && d.dispatchStatus === 'sent' && d.done === false, 'dispatches 记录 queued:true + sent 待回执（实得 ' + JSON.stringify(d) + '）')
    // 日志追加实证：尾部事件 = agent/inbox/spliced（seq 连续 / target next-turn / 载荷 = 派发消息本体）
    const log = S.persistLogs.get(OFFLINE_SID) || []
    assert.strictEqual(log.length, logBefore + 1, '持久化日志追加恰好 1 条')
    const tail = log[log.length - 1]
    assert(tail.type === 'agent/inbox/spliced' && tail.seq === logBefore && typeof tail.time === 'number', '事件形态 type/seq/time 合法（实得 ' + JSON.stringify(tail).slice(0, 200) + '）')
    assert(tail.data && tail.data.target === 'next-turn' && tail.data.start === inboxLenBefore, 'splice start=派发前 inbox 长度（append 语义，实得 start=' + tail.data.start + ' 前态 ' + inboxLenBefore + '）')
    const m = tail.data.inserted && tail.data.inserted[0]
    assert(m && m.id === d.msgId && m.role === 'user', '排队消息 = 派发消息本体（msgId 关联）')
    assert(m.source && m.source.kind === 'plugin:dsh-notes' && m.source.form === 'recall', 'source 标记同 live 链路（v4 形态）')
    assert(m.content[0].text.indexOf('休眠投递正文载荷') >= 0 && m.content[0].text.indexOf('醒了就办') >= 0, '排队消息含正文载荷 + 补充指令')
    // 重开可见性证明：按 loop 投影口径折叠持久化日志 → inbox 含该消息（会话恢复后 loop 认领处理）
    const inboxIds = []
    for (const ev of log) {
      if (!ev || ev.type !== 'agent/inbox/spliced') continue
      const dd = ev.data || {}
      const ins = Array.isArray(dd.inserted) ? dd.inserted : []
      for (let i = 0; i < (dd.removedCount || 0); i++) inboxIds.splice(dd.start, 1)
      inboxIds.splice(dd.start, 0, ...ins.map(x => x.id))
    }
    assert(inboxIds.indexOf(d.msgId) >= 0, '重开折叠 inbox 可见该排队消息（下次活动送达语义成立）')
    // 执行记录行注：📤 派发行带（下次活动送达）后缀（0.4.4-A 三表归一篇）
    const g2 = await handlers['notes-get']({ id: c.id })
    assert(g2.note.runLog, '执行记录伴生笔记软链已回写')
    const rl = await handlers['notes-get']({ id: g2.note.runLog })
    const lines = entryLines(rl.note.body)
    assert(lines.length === 1 && lines[0].indexOf('- 📤 ') === 0 && lines[0].indexOf('（下次活动送达）') >= 0, '📤 行注（下次活动送达）（实得 ' + lines[0] + '）')
    assert(lines[0].indexOf('note-dispatch-') < 0 && lines[0].indexOf('单号 ') >= 0, '派发行不含完整 msgId 红线不破（回执族幂等键空间隔离）')
    // 回执闭环：会话下次活动处理完转 idle → dispatch-loop 事件回执 done（receipt=idle）
    const fireIdleOffline = () => { for (const fn of evtListeners['agent/status']) fn({ agent: { id: OFFLINE_SID }, status: 'idle' }) }
    fireIdleOffline(); await flush()
    const g3 = await handlers['notes-get']({ id: c.id })
    assert(g3.note.dispatches[0].dispatchStatus === 'done' && g3.note.dispatches[0].receipt === 'idle', '休眠送达回执闭环（idle → done；实得 ' + JSON.stringify(g3.note.dispatches[0]) + '）')
    await handlers['notes-delete']({ id: c.id })
  })

  await t('休眠送达幂等防御：同会话二次派发再追加 1 条（新 msgId）；不可达目标报错含「未打开」+ needOpen', async () => {
    const c = await handlers['notes-create']({ title: '休眠派单82b', body: 'x', kind: 'todo' })
    const r1 = await handlers['notes-dispatch']({ id: c.id, sessionId: OFFLINE_SID })
    const r2 = await handlers['notes-dispatch']({ id: c.id, sessionId: OFFLINE_SID })
    assert(r1.queued === true && r2.queued === true && r1.dispatch.msgId !== r2.dispatch.msgId, '两次派发各落各的 msgId（队列 FIFO 追加）')
    const log = S.persistLogs.get(OFFLINE_SID) || []
    const tails = log.slice(-2)
    assert(tails.every(ev => ev.type === 'agent/inbox/spliced' && ev.data.start >= 0), '二次派发 splice start 顺队列递增（实得 ' + tails.map(ev => ev.data.start).join(',') + '）')
    assert.strictEqual(tails[1].data.start, tails[0].data.start + 1, '第二次 start=1（折叠态追加尾位）')
    // 持久化不可达目标：open 抛 NotFound → 报错含「未打开」+ needOpen（UI 引导打开/新建）
    const opensBefore = S.persistOpenCalls.length
    const r3 = await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-notlive-0000' })
    assert(r3 && r3.error && r3.error.indexOf('未打开') >= 0 && r3.needOpen === true, '不可达目标报错 + needOpen（实得 ' + JSON.stringify(r3) + '）')
    assert.strictEqual(S.persistOpenCalls.length, opensBefore + 1, '休眠通道已探测（open 调用录制）')
    await handlers['notes-delete']({ id: c.id })
  })

  await t('活跃会话路径行为不变：live 派发零 queued 键 + agent.send 立即触发 + 执行记录行无行注', async () => {
    const c = await handlers['notes-create']({ title: '活跃派单82', body: 'x', kind: 'todo' })
    const before = sentMessages.length
    const r = await handlers['notes-dispatch']({ id: c.id, sessionId: LIVE_SID, sessionName: '开发会话' })
    assert(r && r.ok === true && r.queued === false, 'live 派发 queued:false（实得 ' + JSON.stringify(r.queued) + '）')
    assert.strictEqual(sentMessages.length, before + 1, 'live 直发 agent.send 不变')
    const g = await handlers['notes-get']({ id: c.id })
    assert(!('queued' in g.note.dispatches[0]), 'live 派发记录零 queued 键（存量形态不变，向后兼容）')
    const rl = await handlers['notes-get']({ id: g.note.runLog })
    const lines = entryLines(rl.note.body)
    assert(lines.length === 1 && lines[0].indexOf('（下次活动送达）') < 0, 'live 派发行无行注（实得 ' + lines[0] + '）')
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== B 派发弹窗双区静态锚（开发版双端 + 发布包产物）=====
  await t('弹窗双区静态锚：休眠行标注「下次活动送达」+ client 去除强开唤醒 + 专属会话复选框接线（四端）', () => {
    const appModal = fsNative.readFileSync(path.join(H.DIR, 'src', 'app', 'modals', 'dispatch.js'), 'utf8')
    const cliModal = fsNative.readFileSync(path.join(H.DIR, 'src', 'client', 'modals', 'dispatch.js'), 'utf8')
    const zhSrc = fsNative.readFileSync(path.join(H.DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    assert(zhSrc.indexOf("'disp.notLiveSuffix': '（休眠 · 下次活动送达）'") >= 0, 'zh 字典休眠行标注「下次活动送达」')
    // client：强开唤醒路径拆除（零唤醒红线）+ queued toast 分流
    assert(cliModal.indexOf('sessions.open(sess.id)') < 0, 'client 派发确认不再强开休眠会话（不主动唤醒红线）')
    assert(cliModal.indexOf("res && res.queued ? 'disp.dispatchedQueued' : 'disp.dispatched'") >= 0, 'client queued toast 分流')
    // app：页面无打开能力，queued toast 同口径
    assert(appModal.indexOf("res && res.queued ? 'disp.dispatchedQueued' : 'disp.dispatched'") >= 0, 'app queued toast 分流')
    // 专属会话复选框（target='new'）双端接线
    for (const [s, label] of [[cliModal, 'client'], [appModal, 'app']]) {
      assert(s.indexOf('schedNew') >= 0 && s.indexOf("t('disp.schedNew')") >= 0, label + ' 专属会话复选框（disp.schedNew）接线')
      assert(s.indexOf("target: " + (label === 'client' ? 'dispatchSchedNew' : 'dState.schedNew') + " ? 'new' : ") >= 0, label + ' 确认排定 target=new 提交')
    }
    // 发布包产物锚点（build-dist 已跑）
    const clientPkgSrc = fsNative.readFileSync(path.join(H.DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    const appPkgSrc = fsNative.readFileSync(path.join(H.DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    assert(clientPkgSrc.indexOf('disp.dispatchedQueued') >= 0 && clientPkgSrc.indexOf('disp.schedNew') >= 0, '发布包 lib/client.js 含 queued/schedNew 锚点')
    assert(appPkgSrc.indexOf('disp.dispatchedQueued') >= 0 && appPkgSrc.indexOf('disp.schedNew') >= 0, '发布包 app.html 含 queued/schedNew 锚点')
    // host 双包锚点：休眠通道 + 专属会话 + 行注（dev 拼接产物 / 发布包 index.mjs）
    for (const [s, label] of [[hostSrc, 'host-impl'], [indexSrc, 'index.mjs']]) {
      assert(s.indexOf('function _queueDormantDispatch(') >= 0 && s.indexOf("type: 'agent/inbox/spliced'") >= 0, label + ' 休眠送达通道在位')
      assert(s.indexOf("SCHED_TARGET_NEW = 'new'") >= 0 && s.indexOf('function _schedCreateDedicatedSession(') >= 0, label + ' 专属会话创建链在位')
      assert(s.indexOf("（下次活动送达）") >= 0, label + ' 执行记录行注在位')
      assert(s.indexOf("rec.queued = true") >= 0 && s.indexOf("queued: queued") >= 0, label + ' dispatches queued 布尔 + runLog 传递在位')
    }
  })

  // ===== C① 专属会话写入闸门：target='new' 仅周期模式 =====
  await t('专属会话闸门：target=new 仅周期模式接受（at 拒绝）+ enabled=false 同豁免 + 落库形态', async () => {
    const c = await handlers['notes-create']({ title: '专属巡检约定', body: '每天巡检专属频道', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new' } })
    assert(c && c.id && !c.error, 'every + target=new 放行（实得 ' + JSON.stringify(c) + '）')
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.target, 'new', 'target=new 落库（首轮前保持字面量）')
    await handlers['notes-delete']({ id: c.id })
    const localIso = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) }
    const bad = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: localIso(Date.now() + 3600000), target: 'new' } })
    assert(bad && bad.error && bad.error.indexOf('仅周期模式') >= 0, 'at + target=new 拒绝（单次无复用场景，实得 ' + bad.error + '）')
    const dis = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '7d', target: 'new', enabled: false } })
    assert(dis && dis.id && !dis.error, 'enabled=false + target=new 放行（暂停随时可落）')
    await handlers['notes-delete']({ id: dis.id })
  })

  // ===== C② 首轮创建 + target 回写 + 二轮复用同 sid + 休眠降级送达（断言③④核心） =====
  // 口径说明：全局 fired 计数随运行模式（--core 跳过节会留下他节到期调度）漂移，本测试一律用「本篇笔记状态增量」口径断言
  await t('专属会话全生命周期：首轮创建「定时 · 任务名」+ target 回写 → 二轮复用同 sid（零新建）→ 休眠降级 queued 送达', async () => {
    const c = await handlers['notes-create']({ title: '专属巡检约定', body: '巡检专属频道内容', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new' } })
    assert(c && c.id && !c.error, '创建专属会话调度约定（实得 ' + JSON.stringify(c) + '）')
    const myDispatches = async () => { const g = await handlers['notes-get']({ id: c.id }); return (g.note.dispatches || []).length }
    const mySends = (sid) => sentMessages.filter(m => m.via === 'created:' + sid).length
    // 首轮触发：创建专属会话
    const createsBefore = S.agentCreateCalls.length
    const clock1 = new Date(Date.now() + 4 * 86400000).toISOString()
    const ev = await handlers['notes-schedule-eval']({ now: clock1 })
    assert(ev && !ev.error && ev.errors === 0 && ev.fired >= 1, '首轮评估零故障（实得 ' + JSON.stringify(ev) + '）')
    assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, 'agents.create 恰调用 1 次')
    const createOpts = S.agentCreateCalls[S.agentCreateCalls.length - 1]
    assert(/^session-/.test(createOpts.sessionId) && createOpts.meta && createOpts.meta.cwd === 'D:\\deepseek-work', '创建入参：新 sid + note.workspace 命中工作区 cwd（实得 ' + JSON.stringify(createOpts.meta) + '）')
    assert.strictEqual(createOpts.meta.agentPreset, 'mock-default-preset', '挂载默认 preset（工具能力来源）')
    assert(typeof createOpts.setup === 'function', 'setup 回挂在位（agentPresets.mount 绑定）')
    const newSid = createOpts.sessionId
    // 命名 + 工作区落账（GUI 可见性）
    assert(S.titleRenameCalls.some(x => x.id === newSid && x.title === '定时 · 专属巡检约定'), 'sessionTitle.rename 命名「定时 · <任务名>」（实得 ' + JSON.stringify(S.titleRenameCalls.slice(-1)) + '）')
    assert(S.attachCalls.indexOf(newSid) >= 0, 'workspace.attachSession 落账（GUI 左侧列表可见）')
    // target 回写 + 首轮 live 直发（创建即 live）
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.target, newSid, 'target 回写 = 新 sid（持久复用锚点，实得 ' + g.note.schedule.target + '）')
    assert.strictEqual(g.note.schedule.lastFiredAt, clock1, 'lastFiredAt = 首轮触发时刻')
    assert(g.note.schedule.lastRun && g.note.schedule.lastRun.status === 'sent', '首轮 lastRun.status=sent（新建即 live 直发）')
    assert.strictEqual(mySends(newSid), 1, '首轮派发经 live send（新建 agent 立即可工作）')
    const m1 = sentMessages.filter(m => m.via === 'created:' + newSid)[0]
    assert(m1 && m1.msg.content[0].text.indexOf('巡检专属频道内容') >= 0, '首轮消息进专属会话（载荷 = 约定正文）')
    assert(g.note.dispatches.length === 1 && g.note.dispatches[0].sessionName === '定时 · 专属巡检约定' && g.note.dispatches[0].sessionId === newSid, 'dispatches 记录专属会话名 + sid')
    // 二轮复用：同 sid 零新建
    const clock2 = new Date(Date.now() + 8 * 86400000).toISOString()
    const dispBefore2 = await myDispatches()
    const ev2 = await handlers['notes-schedule-eval']({ now: clock2 })
    assert(ev2 && ev2.errors === 0, '二轮评估零故障（实得 ' + JSON.stringify(ev2) + '）')
    assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, '二轮零新建（复用同 sid）')
    assert.strictEqual(await myDispatches(), dispBefore2 + 1, '二轮本篇派发 +1（复用触发实证）')
    assert.strictEqual(mySends(newSid), 2, '二轮复用同会话直发')
    const g2 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.schedule.target, newSid, 'target 稳定不复位')
    assert.strictEqual(g2.note.schedule.lastFiredAt, clock2, '二轮 lastFiredAt 对齐')
    // 休眠降级：模拟插件重载/宿主重启后专属会话退化为休眠（dispose 摘除 live 注册）→ 三轮走休眠送达
    S.createdAgents.delete(newSid)
    const clock3 = new Date(Date.now() + 12 * 86400000).toISOString()
    const mySendsBefore3 = sentMessages.length
    const dispBefore3 = await myDispatches()
    const ev3 = await handlers['notes-schedule-eval']({ now: clock3 })
    assert(ev3 && ev3.errors === 0, '三轮评估零故障（实得 ' + JSON.stringify(ev3) + '）')
    assert.strictEqual(await myDispatches(), dispBefore3 + 1, '三轮本篇派发 +1（休眠降级触发实证）')
    assert.strictEqual(sentMessages.filter(m => m.via === 'created:' + newSid).length, 2, '休眠轮专属会话零 agent.send（零唤醒；全局 send 增量 ' + (sentMessages.length - mySendsBefore3) + ' 为他节到期调度，与本篇无关）')
    const g3 = await handlers['notes-get']({ id: c.id })
    assert(g3.note.schedule.lastRun && g3.note.schedule.lastRun.status === 'queued', '三轮 lastRun.status=queued（休眠送达，实得 ' + JSON.stringify(g3.note.schedule.lastRun) + '）')
    assert(g3.note.dispatches.length === 3 && g3.note.dispatches[2].queued === true, '三轮 dispatches queued:true')
    const log3 = S.persistLogs.get(newSid) || []
    assert(log3.length === 1 && log3[0].type === 'agent/inbox/spliced', '专属会话日志落 1 条排队消息（会话下次活动时处理）')
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== C③ 静态包同口径：target=new 闸门 + 首轮创建回写（webServer 路由链路 + 双包一致） =====
  await t('静态包专属会话：rpc2 链路 target=new 闸门 + 首轮创建回写复用（index.mjs 行为）', async () => {
    const bad = await rpc2('notes-create', { title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { at: '2027-01-01T09:00', target: 'new' } })
    assert(bad.body && bad.body.error && bad.body.error.indexOf('仅周期模式') >= 0, '静态包 at+new 同闸门拒绝（实得 ' + (bad.body && bad.body.error) + '）')
    const c = await rpc2('notes-create', { title: '静态专属约定', body: '静态包专属巡检', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new' } })
    assert(c.body && c.body.id && !c.body.error, '静态包 target=new 创建（实得 ' + JSON.stringify(c.body) + '）')
    const createsBefore = S.agentCreateCalls.length
    const clock = new Date(Date.now() + 4 * 86400000).toISOString()
    const ev = await rpc2('notes-schedule-eval', { now: clock })
    assert(ev.body && ev.body.fired >= 1 && ev.body.errors === 0, '静态包首轮触发（实得 ' + JSON.stringify(ev.body) + '）')
    assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, '静态包 agents.create 恰 1 次')
    const g = await rpc2('notes-get', { id: c.body.id })
    assert(g.body.note.schedule.target === S.agentCreateCalls[S.agentCreateCalls.length - 1].sessionId, '静态包 target 回写新 sid')
    assert(g.body.note.dispatches.length === 1 && g.body.note.dispatches[0].sessionName === '定时 · 静态专属约定', '静态包 dispatches 专属会话名')
    await rpc2('notes-delete', { id: c.body.id })
  })

  // ===== 工具面：note_manage dispatch 休眠 queued 语义 + 列表 live 标记 =====
  await t('note_manage dispatch：休眠目标 queued 语义回执 + 无目标列表带 live 标记', async () => {
    const c = await noteManage.execute({ action: 'create', title: '工具休眠派单82', body: 'x', kind: 'todo' })
    assert(c && c.id && !c.error, '工具建单成功')
    const r = await noteManage.execute({ action: 'dispatch', id: c.id, targetSessionId: OFFLINE_SID, targetSessionName: '离线会话' })
    assert(r && r.action === 'dispatch' && r.queued === true && r.message.indexOf('下次活动送达') >= 0, '工具休眠派发 queued 回执（实得 ' + JSON.stringify(r) + '）')
    const l = await noteManage.execute({ action: 'dispatch', id: c.id })
    assert(l && l.needTarget === true && Array.isArray(l.activeSessions) && l.activeSessions.every(s => typeof s.live === 'boolean'), '无目标列表带 live 标记（活跃+休眠双区口径）')
    await handlers['notes-delete']({ id: c.id })
  })
  }
}
