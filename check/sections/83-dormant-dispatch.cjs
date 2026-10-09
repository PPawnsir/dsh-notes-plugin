// 节 83. 0.4.4-B 休眠会话送达 + 定时派发专属会话复用（notes-044-dormant-dispatch）
// 设计定稿（主窗口调研笔记 + 用户裁决 2026-10-06；0.5.0 P1 notes-050-sched-wake 修订定时触发分支）：
//   A. _dispatch 双通道：live 命中走 agent.send（行为不变）；未命中走 sessionPersistence durable inbox 追加
//      （agent/inbox/spliced——与 live send(msg,'next-turn') 落盘记录同形态，零唤醒零成本「下次活动送达」）；
//      dispatches 记录带 queued 布尔；执行记录 📤 行注（下次活动送达）。
//      0.5.0 P1 修订：以上排队语义**仅服务手动派发**（note_manage/notes-dispatch 不传 wakeDormant）；定时 cron 触发
//      （_schedFire 传 wakeDormant=true）到休眠目标改走 agents.resume 唤醒执行（lastRun.status=sent、零 inbox splice）。
//   B. 派发弹窗目标列表 = 活跃+休眠双区（数据源 _activeSessions 既有全量能力），休眠行标注「下次活动送达」；
//      client 去除「先打开激活」强开唤醒路径（手动派发零唤醒红线，不因定时唤醒而变）。
//   C. schedule.target='new'（仅周期模式）：首轮触发 agents.create 创建「定时 · <任务名> · <id 末 6 位>」专属会话（0.4.7-A⑧ 起命名带 id 尾，防跨笔记同名共享）
//      （agentPresets.mount 默认 preset = 工具能力 + workspace.attachSession 落账 = GUI 可见 + sessionTitle.rename 命名），
//      随幂等生命线回写 target=新 sid（持久复用）；后续轮次 live 直发 / 休眠唤醒执行复用同 sid（0.5.0 P1 起）。
// 测试策略：共享 mock 集群（节 2 扩展 persistLogs/createdAgents/agentPresetsMock/attachCalls/titleRenameCalls/ws1SessionIds）
//   + 注入时钟（notes-schedule-eval {now}）驱动确定性到期；测试调度用 every≥3d（真实时钟永不到期），后台 tick 零干扰。
module.exports = {
  id: "83",
  title: "83. 0.4.4-B 休眠会话送达 + 定时派发专属会话复用",
  async run(H, S) {
  const { t, section, assert, fsNative, path, hostSrc, clientSrc, indexSrc } = H
  const { handlers, noteManage, sentMessages, store, NOTES_DIR, rpc2, evtListeners } = S
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'       // helpers mock 唯一初始 live 会话
  // 0.4.5-A（notes-045-debt-host ② 测试隔离）：本节改用专属 sid，不再与节 48 共用 OFFLINE_SID（sub99）——
  //   共用导致全量模式下两节 splice start 断言互扰（48 的休眠触发追加会抬升 83 的前态折叠口径）。
  //   helpers mock persistLogs 就地可增删（B 卡能力）：本节开场播种一条 seed 日志 = 休眠可送达语义，start 断言恢复精确口径。
  const DORM_SID = 'session-dorm830000-0000-0000-0000-000000000000'  // 工作区外专属休眠目标（持久化有日志 = 休眠可送达）
  S.persistLogs.set(DORM_SID, [{ type: 'session/end-seed', seq: 0, time: 1758000000000, data: {} }])
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
    // 0.4.5-A ② 隔离后前态确定：DORM_SID 日志 = 1 条 seed（seq 0），inbox 折叠为空——start 恢复精确口径（不再相对前态）
    const before = sentMessages.length
    const r = await handlers['notes-dispatch']({ id: c.id, sessionId: DORM_SID, sessionName: '离线会话', instruction: '醒了就办' })
    assert(r && r.ok === true && r.queued === true, '休眠派发成功且 queued:true（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(sentMessages.length, before, '零唤醒红线：未走 agent.send')
    const g = await handlers['notes-get']({ id: c.id })
    const d = (g.note.dispatches || [])[0]
    assert(d && d.queued === true && d.dispatchStatus === 'sent' && d.done === false, 'dispatches 记录 queued:true + sent 待回执（实得 ' + JSON.stringify(d) + '）')
    // 日志追加实证：尾部事件 = agent/inbox/spliced（seq 连续 / target next-turn / 载荷 = 派发消息本体）
    const log = S.persistLogs.get(DORM_SID) || []
    assert.strictEqual(log.length, 2, '持久化日志 = seed + 追加恰好 1 条（实得 ' + log.length + '）')
    const tail = log[log.length - 1]
    assert(tail.type === 'agent/inbox/spliced' && tail.seq === 1 && typeof tail.time === 'number', '事件形态 type/seq/time 合法（seq 接 seed 连续，实得 ' + JSON.stringify(tail).slice(0, 200) + '）')
    assert(tail.data && tail.data.target === 'next-turn' && tail.data.start === 0, 'splice start=0（空 inbox 追加首条，精确口径；实得 start=' + tail.data.start + '）')
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
    const fireIdleOffline = () => { for (const fn of evtListeners['agent/status']) fn({ agent: { id: DORM_SID }, status: 'idle' }) }
    fireIdleOffline(); await flush()
    const g3 = await handlers['notes-get']({ id: c.id })
    assert(g3.note.dispatches[0].dispatchStatus === 'done' && g3.note.dispatches[0].receipt === 'idle', '休眠送达回执闭环（idle → done；实得 ' + JSON.stringify(g3.note.dispatches[0]) + '）')
    await handlers['notes-delete']({ id: c.id })
  })

  await t('休眠送达幂等防御：同会话二次派发再追加 1 条（新 msgId）；不可达目标报错含「未打开」+ needOpen', async () => {
    const c = await handlers['notes-create']({ title: '休眠派单82b', body: 'x', kind: 'todo' })
    const r1 = await handlers['notes-dispatch']({ id: c.id, sessionId: DORM_SID })
    const r2 = await handlers['notes-dispatch']({ id: c.id, sessionId: DORM_SID })
    assert(r1.queued === true && r2.queued === true && r1.dispatch.msgId !== r2.dispatch.msgId, '两次派发各落各的 msgId（队列 FIFO 追加）')
    const log = S.persistLogs.get(DORM_SID) || []
    const tails = log.slice(-2)
    // 0.4.5-A ② 精确口径：A① 已追加 1 条（start=0），本次两条顺队列 = start 1 / 2
    assert(tails.every(ev => ev.type === 'agent/inbox/spliced'), '二次派发均为 inbox splice 追加')
    assert.strictEqual(tails[0].data.start, 1, '第一次 start=1（精确口径，实得 ' + tails[0].data.start + '）')
    assert.strictEqual(tails[1].data.start, 2, '第二次 start=2（折叠态追加尾位，实得 ' + tails[1].data.start + '）')
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
      // 0.4.5 热修锚（活机故障实锤：宿主 setupAndPublish 对 setup 返回值调 ?.commit()——mount 返回 disposer 即炸）：
      //   setup 必须 await mount 且自身返回 undefined；旧写法 `return agentPresets.mount(` 永不得回归
      assert(s.indexOf('setup: async function (agentCtx) { await agentPresets.mount(agentCtx, presetId) }') >= 0, label + ' setup commit 契约修复在位')
      assert(s.indexOf('return agentPresets.mount(agentCtx, presetId)') < 0, label + ' 旧 commit 炸点写法已根除')
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

  // ===== C② 首轮创建 + target 回写 + 二轮复用同 sid + 休眠唤醒执行（断言③④核心；0.5.0 P1 起三轮由 queued 改唤醒） =====
  // 口径说明：全局 fired 计数随运行模式（--core 跳过节会留下他节到期调度）漂移，本测试一律用「本篇笔记状态增量」口径断言
  await t('专属会话全生命周期：首轮创建「定时 · 任务名」+ target 回写 → 二轮复用同 sid（零新建）→ 休眠唤醒执行', async () => {
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
    assert(/^session-/.test(createOpts.sessionId) && createOpts.meta && createOpts.meta.cwd === path.dirname(H.DIR), '创建入参：新 sid + note.workspace 命中工作区 cwd（实得 ' + JSON.stringify(createOpts.meta) + '）')
    assert.strictEqual(createOpts.meta.agentPreset, 'mock-default-preset', '挂载默认 preset（工具能力来源）')
    assert(typeof createOpts.setup === 'function', 'setup 回挂在位（agentPresets.mount 绑定）')
    const newSid = createOpts.sessionId
    // 命名 + 工作区落账（GUI 可见性）——0.4.7-A⑧：命名 = 「定时 · <任务名> · <id 末 6 位>」（同名复用 bug 修复）
    assert(S.titleRenameCalls.some(x => x.id === newSid && x.title === '定时 · 专属巡检约定 · ' + c.id.slice(-6)), 'sessionTitle.rename 命名带 id 尾（实得 ' + JSON.stringify(S.titleRenameCalls.slice(-1)) + '）')
    assert(S.attachCalls.indexOf(newSid) >= 0, 'workspace.attachSession 落账（GUI 左侧列表可见）')
    // target 回写 + 首轮 live 直发（创建即 live）
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.target, newSid, 'target 回写 = 新 sid（持久复用锚点，实得 ' + g.note.schedule.target + '）')
    assert.strictEqual(g.note.schedule.lastFiredAt, clock1, 'lastFiredAt = 首轮触发时刻')
    assert(g.note.schedule.lastRun && g.note.schedule.lastRun.status === 'sent', '首轮 lastRun.status=sent（新建即 live 直发）')
    assert.strictEqual(mySends(newSid), 1, '首轮派发经 live send（新建 agent 立即可工作）')
    const m1 = sentMessages.filter(m => m.via === 'created:' + newSid)[0]
    assert(m1 && m1.msg.content[0].text.indexOf('巡检专属频道内容') >= 0, '首轮消息进专属会话（载荷 = 约定正文）')
    assert(g.note.dispatches.length === 1 && g.note.dispatches[0].sessionName === '定时 · 专属巡检约定 · ' + c.id.slice(-6) && g.note.dispatches[0].sessionId === newSid, 'dispatches 记录专属会话名（带 id 尾）+ sid')
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
    // 休眠唤醒（0.5.0 P1）：模拟插件重载/宿主重启后专属会话退化为休眠（dispose 摘除 live 注册）→ 三轮 agents.resume 唤醒执行
    S.createdAgents.delete(newSid)
    const clock3 = new Date(Date.now() + 12 * 86400000).toISOString()
    const dispBefore3 = await myDispatches()
    const resumesBefore3 = S.agentResumeCalls.length
    const resumedSends3 = sentMessages.filter(m => m.via === 'resumed:' + newSid).length
    const ev3 = await handlers['notes-schedule-eval']({ now: clock3 })
    assert(ev3 && ev3.errors === 0, '三轮评估零故障（实得 ' + JSON.stringify(ev3) + '）')
    assert.strictEqual(await myDispatches(), dispBefore3 + 1, '三轮本篇派发 +1（休眠唤醒触发实证）')
    assert.strictEqual(S.agentResumeCalls.length, resumesBefore3 + 1, '休眠轮专属会话 agents.resume 唤醒恰 1 次')
    assert.strictEqual(S.agentResumeCalls[S.agentResumeCalls.length - 1].resumeSessionId, newSid, '唤醒目标 = 专属会话 sid')
    assert.strictEqual(sentMessages.filter(m => m.via === 'resumed:' + newSid).length, resumedSends3 + 1, '三轮唤醒后 resumed 直发 +1')
    const g3 = await handlers['notes-get']({ id: c.id })
    assert(g3.note.schedule.lastRun && g3.note.schedule.lastRun.status === 'sent', '三轮 lastRun.status=sent（唤醒执行，实得 ' + JSON.stringify(g3.note.schedule.lastRun) + '）')
    assert(g3.note.dispatches.length === 3 && !('queued' in g3.note.dispatches[2]), '三轮 dispatches 零 queued 键（sent 语义）')
    const log3 = S.persistLogs.get(newSid) || []
    assert(log3.length === 0, '专属会话日志零 inbox splice（唤醒执行不排队）')
    S.createdAgents.delete(newSid)   // 复位：唤醒把专属会话注册回 live，删除回归休眠态（防污染后续节）
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== C②b 孤儿专属会话探测（0.4.5-A notes-045-debt-host ③，B 卡 verifier 遗留④）：
  //   「create 成功但 target 回写落盘失败」窗口遗留同名专属会话 → 下轮按标题「定时 · <任务名>」探测命中复用（零新建）；无同名 → 新建 =====
  await t('孤儿专属会话探测：target 回写丢失遗留同名会话 → 下轮复用其 sid（零新建）；账目无同名 → 新建', async () => {
    const c = await handlers['notes-create']({ title: '孤儿探测约定', body: '孤儿探测载荷', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new' } })
    assert(c && c.id && !c.error, '创建孤儿探测调度约定（实得 ' + JSON.stringify(c) + '）')
    const myDispatches = async () => { const g = await handlers['notes-get']({ id: c.id }); return (g.note.dispatches || []).length }
    let sid1 = ''
    try {
      // 首轮：正常创建（探测未命中 → 新建）
      const createsBefore = S.agentCreateCalls.length
      const clock1 = new Date(Date.now() + 4 * 86400000).toISOString()
      const ev1 = await handlers['notes-schedule-eval']({ now: clock1 })
      assert(ev1 && ev1.errors === 0 && ev1.fired >= 1, '首轮触发（实得 ' + JSON.stringify(ev1) + '）')
      assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, '首轮新建 1 次（账目无同名 → 探测未命中）')
      sid1 = S.agentCreateCalls[S.agentCreateCalls.length - 1].sessionId
      const g1 = await handlers['notes-get']({ id: c.id })
      assert.strictEqual(g1.note.schedule.target, sid1, '首轮 target 回写新 sid')
      // 模拟「create 成功但 target 回写落盘失败」窗口：同名专属会话仍挂工作区账目（attachSession 已落账），
      //   但笔记 target 丢失回写 → 复位为 'new'（声明改写机器状态延续，lastFiredAt 不动）
      S.ws1SessionIds.push(sid1)   // attachSession mock 只录不_mutate——就地补账模拟真实落账（本节末复位）
      const u = await handlers['notes-update']({ id: c.id, schedule: { every: '3d', target: 'new' } })
      assert(u && !u.error, 'target 复位为 new（模拟回写丢失；实得 ' + JSON.stringify(u) + '）')
      const g1b = await handlers['notes-get']({ id: c.id })
      assert.strictEqual(g1b.note.schedule.target, 'new', 'target 已复位（实得 ' + g1b.note.schedule.target + '）')
      assert.strictEqual(g1b.note.schedule.lastFiredAt, clock1, '机器状态 lastFiredAt 延续（声明改写不清零）')
      // 二轮：探测命中同名「定时 · 孤儿探测约定」→ 复用 sid1，零新建，target 重新回写 sid1
      const clock2 = new Date(Date.now() + 8 * 86400000).toISOString()
      const dispBefore2 = await myDispatches()
      const ev2 = await handlers['notes-schedule-eval']({ now: clock2 })
      assert(ev2 && ev2.errors === 0, '二轮评估零故障（实得 ' + JSON.stringify(ev2) + '）')
      assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, '探测命中：复用既有专属会话，零新建（防重复建会话）')
      const g2 = await handlers['notes-get']({ id: c.id })
      assert.strictEqual(g2.note.schedule.target, sid1, 'target 重新回写 = 复用 sid（孤儿回收，实得 ' + g2.note.schedule.target + '）')
      assert.strictEqual(await myDispatches(), dispBefore2 + 1, '二轮本篇派发 +1（复用会话照常触发）')
      assert(g2.note.schedule.lastRun && g2.note.schedule.lastRun.status === 'sent', '复用会话仍 live → 直发（实得 ' + JSON.stringify(g2.note.schedule.lastRun) + '）')
      // 三轮：账目同名会话消失（孤儿被清理/用户删除）→ 探测未命中 → 新建新 sid
      const i1 = S.ws1SessionIds.indexOf(sid1); if (i1 >= 0) S.ws1SessionIds.splice(i1, 1)
      S.createdAgents.delete(sid1)
      const u2 = await handlers['notes-update']({ id: c.id, schedule: { every: '3d', target: 'new' } })
      assert(u2 && !u2.error, 'target 再次复位为 new')
      const clock3 = new Date(Date.now() + 12 * 86400000).toISOString()
      const ev3 = await handlers['notes-schedule-eval']({ now: clock3 })
      assert(ev3 && ev3.errors === 0, '三轮评估零故障（实得 ' + JSON.stringify(ev3) + '）')
      assert.strictEqual(S.agentCreateCalls.length, createsBefore + 2, '探测未命中 → 新建 1 次（实得累计 ' + (S.agentCreateCalls.length - createsBefore) + '）')
      const sid2 = S.agentCreateCalls[S.agentCreateCalls.length - 1].sessionId
      assert(sid2 && sid2 !== sid1, '新建新 sid（与孤儿不同）')
      const g3 = await handlers['notes-get']({ id: c.id })
      assert.strictEqual(g3.note.schedule.target, sid2, '三轮 target 回写新 sid')
    } finally {
      await handlers['notes-delete']({ id: c.id })
      const i = S.ws1SessionIds.indexOf(sid1); if (i >= 0) S.ws1SessionIds.splice(i, 1)   // 复位账目（防污染后续节会话清单口径）
    }
  })

  // ===== C②c 同名复用 bug 回归（0.4.7-A⑧ notes-047-cleanup，用户实测 [[n-muy8azorkasl]]）：
  //   修复前孤儿探测只认标题 → 跨笔记同名任务共享先建会话（preset/model 声明被静默丢弃——复用路径不补挂档位）；
  //   修复后命名带 id 末 6 位尾，探测只对同笔记命中。本块：B 触发时账目里挂着 A 的同名孤儿 → 必须各建各的 =====
  await t('同名复用 bug（0.4.7-A⑧）：跨笔记同名调度各建各的专属会话 + preset 意图不丢 + 同笔记孤儿复用不回归', async () => {
    const cA = await handlers['notes-create']({ title: '同名巡检约定', body: 'A 篇载荷', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', enabled: false } })
    const cB = await handlers['notes-create']({ title: '同名巡检约定', body: 'B 篇载荷', contractType: 'dispatch-schedule', schedule: { every: '3d', target: 'new', preset: 'workspace-write' } })
    assert(cA.id && cB.id && cA.id !== cB.id, '两篇同名约定创建成功（A 暂停防首轮自触，实得 ' + cA.id + ' / ' + cB.id + '）')
    const sidOrphan = 'session-samename83a-0000-0000-0000-000000000000'
    const nameA = '定时 · 同名巡检约定 · ' + cA.id.slice(-6)
    const nameB = '定时 · 同名巡检约定 · ' + cB.id.slice(-6)
    assert(nameA !== nameB, '同名任务命名因 id 尾分叉（实得 ' + nameA + ' / ' + nameB + '）')
    try {
      // 造 A 的孤儿专属会话：挂账 + rename 录制表供标题探测命中（模拟「create 成功但 target 回写失败」窗口遗留）
      S.ws1SessionIds.push(sidOrphan)
      S.titleRenameCalls.push({ id: sidOrphan, title: nameA })
      S.persistLogs.set(sidOrphan, [])   // 持久化可达（复用后轮唤醒执行，0.5.0 P1）
      // B 首轮触发：探测目标名 = nameB → 不得命中 A 的孤儿（nameA 尾不同）→ 新建自己的专属会话
      const createsBefore = S.agentCreateCalls.length
      const presetCallsBefore = S.permissionPresetSetCalls.length
      const ev1 = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
      assert(ev1 && ev1.errors === 0 && ev1.fired >= 1, 'B 首轮评估零故障（实得 ' + JSON.stringify(ev1) + '）')
      assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, 'B 新建自己的专属会话（不冒领 A 的同名孤儿）')
      const sidB = S.agentCreateCalls[S.agentCreateCalls.length - 1].sessionId
      assert(sidB && sidB !== sidOrphan, 'B 的 sid 与孤儿不同（实得 ' + sidB + '）')
      const gB = await handlers['notes-get']({ id: cB.id })
      assert.strictEqual(gB.note.schedule.target, sidB, 'B target 回写自有 sid')
      assert(S.titleRenameCalls.some(x => x.id === sidB && x.title === nameB), 'B 专属会话命名带 B 尾（实得 ' + JSON.stringify(S.titleRenameCalls.slice(-1)) + '）')
      // preset 意图不静默丢弃：B 声明 workspace-write → 新建路径 permissionPresets.set 透传（复用路径不补挂 = 旧 bug 的另一半）
      const pp = S.permissionPresetSetCalls.slice(presetCallsBefore)
      assert(pp.some(x => x.id === sidB && x.name === 'workspace-write'), 'B 声明 preset 透传新建会话（实得 ' + JSON.stringify(pp) + '）')
      // 同笔记孤儿复用不回归：A 解除暂停触发 → 探测命中自己的孤儿 sidOrphan（零新建）→ 唤醒执行（0.5.0 P1）
      const u = await handlers['notes-update']({ id: cA.id, schedule: { every: '3d', target: 'new', enabled: true } })
      assert(u && !u.error, 'A 解除暂停（实得 ' + JSON.stringify(u) + '）')
      const resumesBeforeA = S.agentResumeCalls.length
      const ev2 = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 8 * 86400000).toISOString() })
      assert(ev2 && ev2.errors === 0, 'A 轮评估零故障（实得 ' + JSON.stringify(ev2) + '）')
      assert.strictEqual(S.agentCreateCalls.length, createsBefore + 1, 'A 探测命中同 id 尾孤儿 → 复用零新建')
      assert.strictEqual(S.agentResumeCalls.length, resumesBeforeA + 1, '复用会话非 live → agents.resume 唤醒恰 1 次')
      const gA = await handlers['notes-get']({ id: cA.id })
      assert.strictEqual(gA.note.schedule.target, sidOrphan, 'A target 回写 = 孤儿 sid（同笔记复用锚点）')
      assert(gA.note.schedule.lastRun && gA.note.schedule.lastRun.status === 'sent', '复用会话非 live → 唤醒执行 sent（实得 ' + JSON.stringify(gA.note.schedule.lastRun) + '）')
      assert.strictEqual((S.persistLogs.get(sidOrphan) || []).length, 0, '孤儿会话日志零 inbox splice（唤醒执行不排队）')
    } finally {
      await handlers['notes-delete']({ id: cA.id })
      await handlers['notes-delete']({ id: cB.id })
      const i = S.ws1SessionIds.indexOf(sidOrphan); if (i >= 0) S.ws1SessionIds.splice(i, 1)   // 复位账目（防污染后续节会话清单口径）
      S.persistLogs.delete(sidOrphan)
      S.createdAgents.delete(sidOrphan)   // 复位：唤醒把孤儿会话注册为 live，删除回归休眠态
    }
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
    assert(g.body.note.dispatches.length === 1 && g.body.note.dispatches[0].sessionName === '定时 · 静态专属约定 · ' + c.body.id.slice(-6), '静态包 dispatches 专属会话名（带 id 尾，0.4.7-A⑧ 双包一致）')
    await rpc2('notes-delete', { id: c.body.id })
  })

  // ===== 工具面：note_manage dispatch 休眠 queued 语义 + 列表 live 标记 =====
  await t('note_manage dispatch：休眠目标 queued 语义回执 + 无目标列表带 live 标记', async () => {
    const c = await noteManage.execute({ action: 'create', title: '工具休眠派单82', body: 'x', kind: 'todo' })
    assert(c && c.id && !c.error, '工具建单成功')
    const r = await noteManage.execute({ action: 'dispatch', id: c.id, targetSessionId: DORM_SID, targetSessionName: '离线会话' })
    assert(r && r.action === 'dispatch' && r.queued === true && r.message.indexOf('下次活动送达') >= 0, '工具休眠派发 queued 回执（实得 ' + JSON.stringify(r) + '）')
    const l = await noteManage.execute({ action: 'dispatch', id: c.id })
    assert(l && l.needTarget === true && Array.isArray(l.activeSessions) && l.activeSessions.every(s => typeof s.live === 'boolean'), '无目标列表带 live 标记（活跃+休眠双区口径）')
    await handlers['notes-delete']({ id: c.id })
  })
  }
}
