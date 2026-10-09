// 节 121. 0.5.0 P1 定时调度唤醒休眠目标（notes-050-sched-wake）
// 设计定稿（主窗口调研笔记 + 用户现场实证 2026-10-09）：0.4.4-B 零唤醒排队语义只服务手动派发（人发起，零唤醒是对的）；
//   定时 cron 触发是「到点执行」语义——排队=失败（用户 10-08 21:30 定时触发时目标休眠 → queued 悬挂，22:32 手动点开会话发「1」才执行）。
//   修复：定时触发（_schedFire wakeDormant=true）目标休眠且持久化可达 → agents.resume 唤醒执行（host AgentFactory.resume 启动通道，
//   非 inbox splice）；唤醒成功 lastRun.status=sent，唤醒失败（会话被删/加载失败）落 lastError + lastRun.status=error（不静默 queued）。
//   手动 note_manage/notes-dispatch 不传 wakeDormant → 零唤醒排队语义不变（回归锁）。
// 测试策略：共享 mock 集群（节 2 扩展 agentsMock.resume + agentResumeCalls 录制 + resumeState.failResume 故障注入）
//   + 注入时钟（notes-schedule-eval {now}）驱动确定性到期；测试调度用 every≥3d（真实时钟永不到期），后台 tick 零干扰。
module.exports = {
  id: "121",
  title: "121. 0.5.0 P1 定时调度唤醒休眠目标（agents.resume 唤醒执行 + 手动排队回归锁 + 唤醒失败 lastError）",
  async run(H, S) {
  const { t, section, assert, hostSrc, indexSrc } = H
  const { handlers, sentMessages } = S
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'       // helpers mock 唯一初始 live 会话
  const WAKE_SID = 'session-wake121000-0000-0000-0000-000000000000'     // 工作区外专属休眠目标（持久化有日志 = 可唤醒）
  const FAIL_SID = 'session-wakefail121-0000-0000-0000-000000000000'    // 唤醒失败演练目标（持久化可达但 resume 抛错）
  S.persistLogs.set(WAKE_SID, [{ type: 'session/end-seed', seq: 0, time: 1758000000000, data: {} }])
  S.persistLogs.set(FAIL_SID, [{ type: 'session/end-seed', seq: 0, time: 1758000000000, data: {} }])
  S.ws1SessionIds.push(WAKE_SID, FAIL_SID)   // 就地扩账（声明期存活校验通过；本节末复位）
  section('121. 0.5.0 P1 定时调度唤醒休眠目标（agents.resume 唤醒执行 + 手动排队回归锁 + 唤醒失败 lastError）')
  // 后台 tick 闸沉降（同节 83 口径：防启动补评估与断言交错）
  for (let i = 0; i < 40; i++) {
    const probe = await handlers['notes-schedule-eval']({ now: '2020-01-01T00:00:00.000Z' })
    if (probe && !probe.skipped) break
    await new Promise(r => setTimeout(r, 50))
  }

  // ===== ① 核心：定时触发 + 休眠目标 → agents.resume 唤醒执行（sent 语义，非 inbox splice） =====
  await t('定时触发休眠目标 → agents.resume 唤醒执行（resume 录制 + resumed 直发 + 零 inbox splice + lastRun.status=sent）', async () => {
    const c = await handlers['notes-create']({ title: '定时唤醒巡检', body: '唤醒执行载荷', contractType: 'dispatch-schedule', schedule: { every: '3d', target: WAKE_SID } })
    assert(c && c.id && !c.error, '创建唤醒调度约定（实得 ' + JSON.stringify(c) + '）')
    try {
      const logBefore = (S.persistLogs.get(WAKE_SID) || []).length
      const resumesBefore = S.agentResumeCalls.length
      const clock = new Date(Date.now() + 4 * 86400000).toISOString()
      const ev = await handlers['notes-schedule-eval']({ now: clock })
      assert(ev && ev.errors === 0, '评估零故障（实得 ' + JSON.stringify(ev) + '）')
      // 唤醒通道实证：agents.resume 被调用（宿主启动通道），而非 _queueDormantDispatch 的 inbox splice
      assert.strictEqual(S.agentResumeCalls.length, resumesBefore + 1, 'agents.resume 唤醒恰调用 1 次（宿主启动通道，非 inbox splice）')
      const rc = S.agentResumeCalls[S.agentResumeCalls.length - 1]
      assert.strictEqual(rc.resumeSessionId, WAKE_SID, 'resume 目标 = 休眠会话 sid（实得 ' + rc.resumeSessionId + '）')
      assert.strictEqual((S.persistLogs.get(WAKE_SID) || []).length, logBefore, '零 inbox splice（唤醒执行不排队，日志零追加）')
      // 消息经 resumed 通道送达（唤醒后 live send）
      const wsend = sentMessages.filter(m => m.via === 'resumed:' + WAKE_SID)
      assert.strictEqual(wsend.length, 1, '唤醒后消息经 resumed 通道直发 1 次（实得 ' + wsend.length + '）')
      assert(wsend[0].msg.content[0].text.indexOf('唤醒执行载荷') >= 0, '唤醒消息含约定正文')
      // lastRun.status=sent（不再是 queued）
      const g = await handlers['notes-get']({ id: c.id })
      assert(g.note.schedule.lastRun && g.note.schedule.lastRun.status === 'sent', 'lastRun.status=sent（唤醒执行，实得 ' + JSON.stringify(g.note.schedule.lastRun) + '）')
      assert(!('lastError' in g.note.schedule), '成功路径零 lastError')
      assert(g.note.dispatches.length === 1 && !('queued' in g.note.dispatches[0]), 'dispatches 零 queued 键（sent 语义）')
    } finally {
      await handlers['notes-delete']({ id: c.id })
      S.createdAgents.delete(WAKE_SID)   // 复位：唤醒把休眠目标注册为 live，删除回归休眠态
    }
  })

  // ===== ② 回归锁：手动派发休眠目标仍零唤醒排队（0.4.4-B 语义不动） =====
  await t('手动派发休眠目标仍 queued（回归锁：零 agents.resume + inbox splice 落盘 + queued:true）', async () => {
    const c = await handlers['notes-create']({ title: '手动休眠派单121', body: 'x', kind: 'todo' })
    try {
      const logBefore = (S.persistLogs.get(WAKE_SID) || []).length
      const resumesBefore = S.agentResumeCalls.length
      const r = await handlers['notes-dispatch']({ id: c.id, sessionId: WAKE_SID, sessionName: '休眠会话' })
      assert(r && r.ok === true && r.queued === true, '手动派发休眠目标 queued:true（实得 ' + JSON.stringify(r) + '）')
      assert.strictEqual(S.agentResumeCalls.length, resumesBefore, '手动派发零 agents.resume（零唤醒红线不变）')
      assert.strictEqual((S.persistLogs.get(WAKE_SID) || []).length, logBefore + 1, '手动派发 inbox splice 落盘 +1（排队语义保留）')
      const g = await handlers['notes-get']({ id: c.id })
      assert(g.note.dispatches[0] && g.note.dispatches[0].queued === true, '手动派发 dispatches queued:true')
    } finally {
      await handlers['notes-delete']({ id: c.id })
    }
  })

  // ===== ③ 唤醒失败 → lastError + lastRun.status=error（不静默 queued） =====
  await t('唤醒失败（resume 抛错）→ lastError 落盘 + lastRun.status=error（不静默 queued）', async () => {
    const c = await handlers['notes-create']({ title: '唤醒失败巡检', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '3d', target: FAIL_SID } })
    assert(c && c.id && !c.error, '创建唤醒失败演练约定（实得 ' + JSON.stringify(c) + '）')
    S.resumeState.failResume = true
    try {
      const clock = new Date(Date.now() + 4 * 86400000).toISOString()
      const ev = await handlers['notes-schedule-eval']({ now: clock })
      assert(ev && ev.errors >= 1, '唤醒失败计入 errors（实得 ' + JSON.stringify(ev) + '）')
      const g = await handlers['notes-get']({ id: c.id })
      assert(g.note.schedule.lastError && g.note.schedule.lastError.message.indexOf('唤醒目标会话失败') >= 0, 'lastError 记录唤醒失败（实得 ' + JSON.stringify(g.note.schedule.lastError) + '）')
      assert(g.note.schedule.lastRun && g.note.schedule.lastRun.status === 'error', 'lastRun.status=error（不静默 queued）')
      assert.strictEqual((S.persistLogs.get(FAIL_SID) || []).length, 1, '零 inbox splice（唤醒失败不落排队，日志零追加）')
    } finally {
      S.resumeState.failResume = false
      await handlers['notes-delete']({ id: c.id })
      S.createdAgents.delete(FAIL_SID)
      const i = S.ws1SessionIds.indexOf(WAKE_SID); if (i >= 0) S.ws1SessionIds.splice(i, 1)
      const j = S.ws1SessionIds.indexOf(FAIL_SID); if (j >= 0) S.ws1SessionIds.splice(j, 1)
      S.persistLogs.delete(WAKE_SID)
      S.persistLogs.delete(FAIL_SID)
    }
  })

  // ===== ④ 静态锚：双包（dev hostSrc / 发布包 indexSrc）唤醒通道在位 + 手动派发零唤醒语义保持 =====
  await t('静态锚：双包 _wakeDormant 唤醒通道 + agents.resume + wakeDormant 分流 + 手动派发不传 wakeDormant', () => {
    for (const [s, label] of [[hostSrc, 'host-impl'], [indexSrc, 'index.mjs']]) {
      assert(s.indexOf('async function _wakeDormant(') >= 0, label + ' 唤醒送达函数在位')
      assert(s.indexOf('agents.resume({') >= 0 || s.indexOf('await agents.resume({') >= 0, label + ' agents.resume 启动通道在位')
      assert(s.indexOf('resumeSessionId: sid') >= 0, label + ' resume 目标 = 休眠会话 sid')
      assert(s.indexOf("} else if (o.wakeDormant) {") >= 0, label + ' _dispatch 三通道分流（live / wake / queue）在位')
      assert(s.indexOf('wakeDormant: true') >= 0, label + ' schedule 定时触发传 wakeDormant=true（唤醒路径只服务定时 cron）')
      assert(s.indexOf('_queueDormantDispatch') >= 0, label + ' 休眠排队通道保留（手动派发零唤醒语义不变）')
    }
  })
  }
}
