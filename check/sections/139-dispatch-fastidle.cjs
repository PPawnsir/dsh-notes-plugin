// 节 139. 派发回执快 idle 可疑标注（notes-066-dispatch-fastidle：静默蒸发假阳性 → ⚠ 可见）
// 背景（反馈 n-mvled7yka94e，主窗口日评估实证）：10-23 看板巡检轮静默蒸发——派发 → 6 秒 idle 回执 done → 零产出，账本假阳性。
// 设计：回执闭合时算时长 = doneAt - d.at；< DISPATCH_FAST_IDLE_MS（=60000，任何真实派发轮不可能低于 60s）→ receipt='idle-fast'
//   + fastIdle:true + idleMs 结构化字段；执行记录 📥 行渲染「回执（idle·⚠ Ns 秒回）」。标注 ≠ 拦截：照常闭合不阻塞；仅 idle 通道参与。
// 下游兼容：graph.js 状态映射 / isDispatchDone / client·app 徽章全走 dispatchStatus/done —— idle-fast 仍算 done（闭环语义不变，只多标注）；
//   receipt 文案唯一消费点 = schedRunLogLine（host 侧机器日志，不进 i18n 双语面）。
// 测试策略：共享 mock 集群（节 2）+ evtListeners agent/status idle 模拟回执；正常时长路径用 Date.parse 定向位移（节 107 先例，零真实等待）。
module.exports = {
  id: "139",
  title: "139. 派发回执快 idle 可疑标注（idle-fast + fastIdle/idleMs + ⚠ 执行记录行）",
  async run(H, S) {
  const { t, section, assert, hostSrc, indexSrc } = H
  const { handlers, evtListeners, liveAgent } = S
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'   // helpers mock 唯一 live 会话
  const fireIdle = () => { for (const fn of evtListeners['agent/status']) fn({ agent: liveAgent, status: 'idle' }) }
  const flush = () => new Promise(r => setTimeout(r, 80))
  const entryLines = (body) => String(body || '').split('\n').filter(l => /^- /.test(l))
  section('139. 派发回执快 idle 可疑标注（idle-fast + fastIdle/idleMs + ⚠ 执行记录行）')

  // ===== ① 行为级：派发后立刻 idle → 条目照常闭合 + receipt='idle-fast' + fastIdle:true + idleMs 在案 =====
  await t('快 idle 可疑标注：派发→秒级 idle 回执 receipt=idle-fast + fastIdle/idleMs 在案（照常闭合不阻塞）', async () => {
    const c = await handlers['notes-create']({ title: '快idle甲139', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: LIVE_SID, sessionName: '开发会话' })
    fireIdle(); await flush()
    const g = await handlers['notes-get']({ id: c.id })
    const d = g.note.dispatches[0]
    assert(d.dispatchStatus === 'done' && d.done === true && !!d.doneAt, '照常闭合 done（标注非拦截；实得 ' + JSON.stringify(d) + '）')
    assert(d.receipt === 'idle-fast', 'receipt=idle-fast（秒级闭合；实得 ' + d.receipt + '）')
    assert(d.fastIdle === true && typeof d.idleMs === 'number' && d.idleMs >= 0 && d.idleMs < 60000, 'fastIdle:true + idleMs ∈ [0,60000) 结构化字段（实得 fastIdle=' + d.fastIdle + ' idleMs=' + d.idleMs + '）')
    assert(g.note.status === 'active', 'idle 回执不自动 resolved 笔记（0.4.5-I 语义不动）')
  })

  // ===== ② 回归：≥60s 正常时长 idle → receipt='idle' 不变 + 无 fast 字段（Date.parse 定向位移 120s，零真实等待） =====
  await t('正常时长回归：≥60s idle 回执 receipt=idle 不变（Date.parse 定向位移，节 107 先例）', async () => {
    const c = await handlers['notes-create']({ title: '快idle乙139', body: 'x', kind: 'todo' })
    const r = await handlers['notes-dispatch']({ id: c.id, sessionId: LIVE_SID, sessionName: '开发会话' })
    const at0 = r.dispatch.at
    const realParse = Date.parse
    Date.parse = (s) => realParse(s) - (s === at0 ? 120000 : 0)   // 只位移本篇派发 at：回执视角时长 = 120s ≥ 阈值
    try { fireIdle(); await flush() } finally { Date.parse = realParse }
    const g = await handlers['notes-get']({ id: c.id })
    const d = g.note.dispatches[0]
    assert(d.dispatchStatus === 'done' && d.receipt === 'idle', '正常时长 receipt=idle 回归（实得 ' + d.receipt + '）')
    assert(!d.fastIdle && d.idleMs === undefined, '正常时长无 fastIdle/idleMs 字段（实得 ' + JSON.stringify(d) + '）')
    // 执行记录行同步无 ⚠（普通 idle 文案原样）
    const rl = await handlers['notes-get']({ id: g.note.runLog })
    const lines = entryLines(rl.note.body)
    assert(lines[0].indexOf('- 📥 ') === 0 && lines[0].indexOf('回执（idle）') >= 0 && lines[0].indexOf('⚠') < 0, '正常时长回执行文案原样（回执（idle）零 ⚠；实得 ' + lines[0] + '）')
  })

  // ===== ③ 执行记录行：idle-fast → ⚠ 秒数文案 + msgId 幂等键位不动 + 秒数与结构化 idleMs 同口径 =====
  await t('执行记录行 ⚠ 后缀：「回执（idle·⚠ Ns 秒回）」+ msgId 幂等键位不动 + 秒数≈idleMs 同口径', async () => {
    const c = await handlers['notes-create']({ title: '快idle丙139', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: LIVE_SID, sessionName: '开发会话' })
    const g0 = await handlers['notes-get']({ id: c.id })
    const runLogId = g0.note.runLog
    const msgId = g0.note.dispatches[0].msgId
    assert(runLogId && msgId, '派发后即建顶层 runLog 软链 + msgId 登记（0.4.4-A 三表归一）')
    fireIdle(); await flush()
    const rl = await handlers['notes-get']({ id: runLogId })
    const lines = entryLines(rl.note.body)
    assert(lines.length === 2, '2 条目（📥+📤；实得 ' + lines.length + '）')
    const m = lines[0].match(/回执（idle·⚠ (\d+)s 秒回）/)
    assert(lines[0].indexOf('- 📥 ') === 0 && m, '⚠ 秒数文案形态「回执（idle·⚠ Ns 秒回）」（实得 ' + lines[0] + '）')
    assert(lines[0].indexOf(msgId) >= 0, '行尾 msgId 幂等键位不动（重复 idle 去重依赖）')
    const g = await handlers['notes-get']({ id: c.id })
    const d = g.note.dispatches[0]
    assert(Math.abs(parseInt(m[1], 10) - Math.round(d.idleMs / 1000)) <= 1, '行文案秒数 ≈ dispatches[].idleMs（双载体同口径；行 ' + m[1] + 's / idleMs ' + d.idleMs + '）')
    // 幂等：重复 idle 零追加（msgId 去重对 ⚠ 行型同口径生效）
    const body0 = rl.note.body
    fireIdle(); await flush()
    const rl2 = await handlers['notes-get']({ id: runLogId })
    assert.strictEqual(rl2.note.body, body0, '重复 idle 幂等零追加（⚠ 行型 msgId 去重同口径）')
  })

  // ===== ④ 三通道隔离：resolved 保底 / manual 手动在 <60s 内闭环不标 fast（仅 idle 通道参与快标注） =====
  await t('三通道隔离：resolved/manual <60s 闭环不标 fast（仅 idle 通道参与）', async () => {
    const c1 = await handlers['notes-create']({ title: '快idle丁139', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c1.id, sessionId: LIVE_SID, sessionName: '开发会话' })
    const u = await handlers['notes-update']({ id: c1.id, status: 'resolved' })
    assert(u.dispatchClosed === 1, 'resolved 保底回执 1 条')
    const g1 = await handlers['notes-get']({ id: c1.id })
    assert(g1.note.dispatches[0].receipt === 'resolved' && !g1.note.dispatches[0].fastIdle && g1.note.dispatches[0].idleMs === undefined, 'resolved 通道 receipt=resolved 零 fast 字段（实得 ' + JSON.stringify(g1.note.dispatches[0]) + '）')
    const rl1 = await handlers['notes-get']({ id: g1.note.runLog })
    const l1 = entryLines(rl1.note.body)
    assert(l1[0].indexOf('回执（resolved）') >= 0 && l1[0].indexOf('⚠') < 0, 'resolved 回执行文案原样零 ⚠')
    const c2 = await handlers['notes-create']({ title: '快idle戊139', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c2.id, sessionId: LIVE_SID, sessionName: '开发会话' })
    const dn = await handlers['notes-dispatch-done']({ id: c2.id, dispatchIndex: 0 })
    assert(dn && dn.ok, '手动标记通道可用')
    const g2 = await handlers['notes-get']({ id: c2.id })
    assert(g2.note.dispatches[0].receipt === 'manual' && !g2.note.dispatches[0].fastIdle && g2.note.dispatches[0].idleMs === undefined, 'manual 通道 receipt=manual 零 fast 字段（实得 ' + JSON.stringify(g2.note.dispatches[0]) + '）')
    const rl2 = await handlers['notes-get']({ id: g2.note.runLog })
    const l2 = entryLines(rl2.note.body)
    assert(l2[0].indexOf('- ✅ ') === 0 && l2[0].indexOf('回执（manual）') >= 0 && l2[0].indexOf('⚠') < 0, 'manual ✅ 行文案原样零 ⚠')
  })

  // ===== ⑤ 双包静态锚：阈值常量 + 快标注写入点 + 结构化字段 + ⚠ 渲染 + 说明块行型注（i18n 无涉：host 机器日志先例） =====
  await t('双包静态锚：DISPATCH_FAST_IDLE_MS + idle-fast 标注 + fastIdle/idleMs + ⚠ 秒回渲染（host-impl / index.mjs）', () => {
    for (const [src, tag] of [[hostSrc, 'host-impl.js'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('DISPATCH_FAST_IDLE_MS') >= 0, tag + ' 快 idle 阈值常量（=60000，注释写明依据）')
      assert(src.indexOf("r = 'idle-fast'") >= 0, tag + ' idle-fast 标注写入点（_closeOpenDispatches idle 通道分流）')
      assert(src.indexOf('fastIdle: true') >= 0 && src.indexOf('idleMs: idleMs') >= 0, tag + ' fastIdle/idleMs 结构化字段落库')
      assert(src.indexOf("' 秒回'") >= 0 && src.indexOf('idle·⚠') >= 0, tag + ' 执行记录 ⚠ 秒回渲染（schedRunLogLine）')
      assert(src.indexOf('快 idle 可疑标注·静默蒸发预警') >= 0, tag + ' 说明块行型注（EXEC_LOG_GUIDE 新建笔记可见）')
    }
    // 下游兼容静态核查：graph 状态映射 / 完成判定均走 dispatchStatus·done（receipt 新值 idle-fast 不改闭环语义）
    assert(hostSrc.indexOf('function isDispatchDone(d) { return !!(d && (d.dispatchStatus === \'done\' || d.done === true)) }') >= 0, 'isDispatchDone 判完成不看 receipt（idle-fast 仍算 done）')
  })
  }
}
