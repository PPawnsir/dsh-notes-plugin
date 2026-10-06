// 节 91. 0.4.5-I 派发完成不再标记已解决（全量统一：周期/一次性定时/手动，notes-045-periodic-no-resolve）
// 用户裁决（2026-10-06，两轮合并）：「尤其对于循环任务来说，标记为已解决很容易给用户造成困扰」+
//   「一次性派发也不要 resolved 语义吧，已经有执行历史了」——任何派发完成后都不再改笔记 status；
//   完成证据 = 派发记录 dispatchStatus=done + 执行记录伴生笔记 📤/📥 行；resolved 联动保留为手动兜底。
// 机制定位：根因=派发消息模板（dispatch.js _dispatch 尾部指示）——0.4.5-I 整段替换为「不要修改笔记状态 +
//   空闲自动回执」口径；回执双通道中 idle 事件回执接管一切闭环（_closeOpenDispatches/_receiptDispatchesForSession
//   逻辑本体零改动红线）；notes.js _update resolved 保底联动保留（节 15.5/81⑤ 回归锁）。
// 测试策略：共享 mock 集群（节 2）+ evtListeners agent/status idle 模拟回执 + hostSrc/indexSrc 双包静态锚。
module.exports = {
  id: "91",
  title: "91. 0.4.5-I 派发完成不再标记已解决（全量统一）",
  async run(H, S) {
  const { t, section, assert, hostSrc, indexSrc } = H
  const { handlers, noteManage, sentMessages, evtListeners, liveAgent } = S
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'   // helpers mock 唯一初始 live 会话
  const fireIdle = () => { for (const fn of evtListeners['agent/status']) fn({ agent: liveAgent, status: 'idle' }) }
  const flush = () => new Promise(r => setTimeout(r, 80))
  const entryLines = (body) => String(body || '').split('\n').filter(l => /^- /.test(l))
  // 新模板口径（eval 后消息文本）：含新指示 + 零 resolved 旧串
  const assertNewTemplate = (txt, tag) => {
    assert(txt.indexOf('处理完即可，**不要**修改笔记状态（保持原样）') >= 0 && txt.indexOf('空闲时自动回执本轮完成') >= 0, tag + ' 含「不要修改笔记状态」+ 空闲自动回执说明')
    assert(txt.indexOf("status: 'resolved'") < 0 && txt.indexOf('了结该笔记') < 0 && txt.indexOf('完成后请调用') < 0, tag + ' 零 resolved 指示（旧模板串清零）')
  }
  section('91. 0.4.5-I 派发完成不再标记已解决（全量统一）')
  // 后台 tick 闸沉降（同节 59/81/83 口径：防启动补评估与断言交错）
  for (let i = 0; i < 40; i++) {
    const probe = await handlers['notes-schedule-eval']({ now: '2020-01-01T00:00:00.000Z' })
    if (probe && !probe.skipped) break
    await new Promise(r => setTimeout(r, 50))
  }

  // ===== ① 派发消息模板三形态同口径（手动 RPC / note_manage 工具 / 定时调度——三入口同走 _dispatch 单点） =====
  await t('0.4.5-I① 派发消息三形态同口径：不含 resolved 指示 + 含「不要修改笔记状态」空闲回执说明', async () => {
    // 形态一：手动 RPC 派发（notes-dispatch）
    const c1 = await handlers['notes-create']({ title: '派单91甲', body: '甲正文91', kind: 'todo' })
    assert(c1 && c1.id && !c1.error, '创建源笔记甲（实得 ' + JSON.stringify(c1) + '）')
    const b1 = sentMessages.length
    await handlers['notes-dispatch']({ id: c1.id, sessionId: LIVE_SID, sessionName: '开发会话' })
    assert.strictEqual(sentMessages.length, b1 + 1, '手动派发 live 直发 1 条')
    assertNewTemplate(sentMessages[sentMessages.length - 1].msg.content[0].text, '手动派发')
    // 形态二：note_manage 工具派发
    const c2 = await noteManage.execute({ action: 'create', title: '派单91乙', body: '乙正文91', kind: 'todo' })
    assert(c2 && c2.id && !c2.error, '工具建单乙成功')
    const b2 = sentMessages.length
    const r2 = await noteManage.execute({ action: 'dispatch', id: c2.id, targetSessionId: LIVE_SID, targetSessionName: '开发会话' })
    assert(r2 && r2.action === 'dispatch' && !r2.error, '工具派发成功（实得 ' + JSON.stringify(r2) + '）')
    assert.strictEqual(sentMessages.length, b2 + 1, '工具派发 live 直发 1 条')
    assertNewTemplate(sentMessages[sentMessages.length - 1].msg.content[0].text, '工具派发')
    // 形态三：定时调度派发（_schedFire → _dispatch 同模板；本篇增量口径防他节到期干扰）
    const marker = '巡检九一专属载荷'
    const c3 = await handlers['notes-create']({ title: '定时巡检91', body: marker, contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    assert(c3 && c3.id && !c3.error, '创建周期约定（实得 ' + JSON.stringify(c3) + '）')
    const ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
    assert(ev && !ev.error && ev.errors === 0, '定时评估零故障（实得 ' + JSON.stringify(ev) + '）')
    const g3 = await handlers['notes-get']({ id: c3.id })
    assert.strictEqual((g3.note.dispatches || []).length, 1, '本篇定时派发 +1（增量口径）')
    const mine = sentMessages.filter(m => m.msg.content[0].text.indexOf(marker) >= 0)
    assert(mine.length === 1, '定时派发消息已发送且可定位（实得 ' + mine.length + '）')
    assertNewTemplate(mine[0].msg.content[0].text, '定时调度派发')
    await handlers['notes-delete']({ id: c1.id })
    await handlers['notes-delete']({ id: c2.id })
    await handlers['notes-delete']({ id: c3.id })
  })

  // ===== ② idle 回执接管闭环：dispatchStatus→done + 笔记 status 不变 + 执行记录回执行照落（复用节 83 既有链路） =====
  await t('0.4.5-I② idle 回执闭环：dispatchStatus→done + 笔记 status 不变 + 执行记录 📥 行照落', async () => {
    const c = await handlers['notes-create']({ title: '派单91丙', body: '丙正文91', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: LIVE_SID, sessionName: '开发会话' })
    let g = await handlers['notes-get']({ id: c.id })
    assert(g.note.status === 'active', '派发后笔记 status 保持 active（派发本身不动状态）')
    fireIdle(); await flush()
    g = await handlers['notes-get']({ id: c.id })
    const d = g.note.dispatches[0]
    assert(d.dispatchStatus === 'done' && d.receipt === 'idle' && d.doneAt, 'idle 回执 dispatchStatus→done（receipt=idle；实得 ' + JSON.stringify(d) + '）')
    assert(g.note.status === 'active', '闭环后笔记 status 仍 active（0.4.5-I：派发完成不再标记已解决）')
    const rl = await handlers['notes-get']({ id: g.note.runLog })
    const lines = entryLines(rl.note.body)
    assert(lines.length === 2 && lines[0].indexOf('- 📥 ') === 0 && lines[0].indexOf('回执（idle）') >= 0 && lines[1].indexOf('- 📤 ') === 0, '执行记录 📥 回执行 + 📤 派发行同篇照落（实得 ' + JSON.stringify(lines) + '）')
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== ③ 手动兜底回归：note_manage update resolved 保底联动仍可用（机制保留，非派发标准姿势） =====
  await t('0.4.5-I③ 手动兜底回归：note_manage update resolved 保底联动仍可用（机制保留）', async () => {
    const c = await noteManage.execute({ action: 'create', title: '派单91丁', body: 'x', kind: 'todo' })
    await noteManage.execute({ action: 'dispatch', id: c.id, targetSessionId: LIVE_SID, targetSessionName: '开发会话' })
    const r = await noteManage.execute({ action: 'update', id: c.id, status: 'resolved' })
    assert(r && r.dispatchClosed === 1 && r.message.indexOf('已自动回执 1 条派发') >= 0, 'resolved 手动兜底回执 1 条（实得 ' + JSON.stringify(r) + '）')
    const g = await handlers['notes-get']({ id: c.id })
    assert(g.note.status === 'resolved' && g.note.dispatches[0].dispatchStatus === 'done' && g.note.dispatches[0].receipt === 'resolved', 'resolved 兜底：笔记 resolved + 派发 done（receipt=resolved）')
    await handlers['notes-delete']({ id: c.id })
  })

  // ===== ④ 工具描述新口径 + 消息模板双包静态锚（host-impl.js 开发版拼接产物 / index.mjs 发布包） =====
  await t('0.4.5-I④ 工具描述新口径 + 派发模板双包锚（host-impl / index.mjs）', () => {
    for (const [s, tag] of [[hostSrc, 'host-impl.js'], [indexSrc, 'index.mjs']]) {
      // 派发消息模板新口径（源形态含 JS 转义，锚点取无转义片段）
      assert(s.indexOf('处理完即可，**不要**修改笔记状态（保持原样）；系统会在你会话空闲时自动回执本轮完成（派发记录与执行记录自动闭环）。') >= 0, tag + ' 派发消息尾部新指示在位')
      assert(s.indexOf('了结该笔记') < 0 && s.indexOf('系统会自动回执派发状态') < 0, tag + ' 旧 resolved 指示模板清零')
      // 工具描述 dispatch 条目：idle 回执主通道 + resolved 手动兜底新口径
      assert(s.indexOf('Closed loop: closed via idle-transition receipt of the target session') >= 0, tag + ' dispatch 条目闭环主通道 = idle 回执（零唤醒排队同理）')
      assert(s.indexOf('manual fallback（手动兜底）that force-closes all open dispatches') >= 0, tag + ' dispatch 条目 resolved 手动兜底措辞在位')
      assert(s.indexOf('when the target session reports completion via update status=resolved') < 0, tag + ' dispatch 条目旧「resolved 标准姿势」口径清零')
      // 工具描述 update 条目：resolved 联动保留但改为兜底措辞
      assert(s.indexOf('auto-closes the dispatch loop') >= 0 && s.indexOf('kept as a manual fallback（手动兜底）to force-close the loop') >= 0, tag + ' update 条目 resolved 联动保留为兜底措辞')
      assert(s.indexOf('use this to report completion of a dispatched todo') < 0, tag + ' update 条目旧「派发待办完成的标准姿势」措辞清零')
    }
  })
  }
}
