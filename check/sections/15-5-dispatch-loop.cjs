// 节 15.5 P3 派发闭环（调研 + 状态回写）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "15.5",
  title: "15.5 P3 派发闭环（调研 + 状态回写）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { ctx, evtListeners, g, handlers, liveAgent, noteManage, plugin, r2, sentMessages } = S
  // ===== 15.5 P3 派发闭环（dispatchStatus/doneAt 状态机 + resolved 保底联动 + agent/status idle 事件回执 + 详情徽章） =====
  section('15.5 P3 派发闭环（调研 + 状态回写）')
  await t('保底联动：notes-update 置 resolved 自动回执全部未闭环派发', async () => {
    const c = await handlers['notes-create']({ title: '闭环A', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const r = await handlers['notes-update']({ id: c.id, status: 'resolved' })
    assert(r.dispatchClosed === 1, '应回执 1 条派发（实得 ' + r.dispatchClosed + '）')
    const g = await handlers['notes-get']({ id: c.id })
    const d = g.note.dispatches[0]
    assert(g.note.status === 'resolved', '笔记状态 resolved')
    assert(d.dispatchStatus === 'done' && d.done === true && d.doneAt && d.receipt === 'resolved', '派发 dispatchStatus=done + doneAt + receipt=resolved（实得 ' + JSON.stringify(d) + '）')
  })
  await t('保底联动：note_manage update resolved 回执 + 消息明示', async () => {
    const c = await noteManage.execute({ action: 'create', title: '闭环B', body: 'x', kind: 'todo' })
    await noteManage.execute({ action: 'dispatch', id: c.id, targetSessionId: 'session-abc12345-0000-0000-0000-000000000000', targetSessionName: '开发会话' })
    const r = await noteManage.execute({ action: 'update', id: c.id, status: 'resolved' })
    assert(r.dispatchClosed === 1 && r.message.indexOf('已自动回执 1 条派发') >= 0, '返回 dispatchClosed + 消息含回执提示（实得 ' + r.message + '）')
    const g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'done', '派发已闭环')
  })
  await t('保底联动幂等/不误伤：重复 resolved 零回执；非 resolved 更新不动派发', async () => {
    const c = await handlers['notes-create']({ title: '闭环C', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const r0 = await handlers['notes-update']({ id: c.id, topic: '运维' })
    assert(!r0.dispatchClosed, '非 resolved 更新不回执（dispatchClosed=' + r0.dispatchClosed + '）')
    let g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'sent', '派发仍待回执')
    await handlers['notes-update']({ id: c.id, status: 'resolved' })
    const r2 = await handlers['notes-update']({ id: c.id, status: 'resolved' })
    assert(r2.dispatchClosed === 0, '重复 resolved 幂等零回执（dispatchClosed=' + r2.dispatchClosed + '）')
    g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches.filter(d => d.dispatchStatus === 'done').length === 1, '只有 1 条 done（不重复写）')
  })
  await t('事件回执：agent/status idle → 该会话未闭环派发 dispatchStatus=done（receipt=idle）', async () => {
    assert(Array.isArray(evtListeners['agent/status']) && evtListeners['agent/status'].length === 1, 'host 应订阅 agent/status（实得 ' + (evtListeners['agent/status'] || []).length + ' 个监听）')
    const c = await handlers['notes-create']({ title: '闭环D', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const fire = (st, agent) => { for (const fn of evtListeners['agent/status']) fn({ agent: agent || liveAgent, status: st }) }
    fire('running')
    await new Promise(r => setTimeout(r, 50))
    let g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'sent', 'running 状态不回执')
    fire('idle')
    await new Promise(r => setTimeout(r, 50))
    g = await handlers['notes-get']({ id: c.id })
    const d = g.note.dispatches[0]
    assert(d.dispatchStatus === 'done' && d.receipt === 'idle' && d.doneAt, 'idle 回执 dispatchStatus=done + receipt=idle（实得 ' + JSON.stringify(d) + '）')
    assert(g.note.status === 'active', 'idle 回执不自动 resolved 笔记（0.4.5-I 起语义完成归 idle 回执；resolved 仅手动兜底）')
  })
  await t('事件回执不误伤：只回执该会话的派发；无 agent 的 payload 静默跳过', async () => {
    const c = await handlers['notes-create']({ title: '闭环E', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    // 另一个会话的 idle：只回执 sessionId 匹配的派发，本笔记目标会话是 abc12345 → 不动
    const otherAgent = { id: 'session-other-9999-0000-0000-000000000000', session: { id: 'session-other-9999-0000-0000-000000000000' } }
    for (const fn of evtListeners['agent/status']) fn({ agent: otherAgent, status: 'idle' })
    await new Promise(r => setTimeout(r, 50))
    let g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'sent', '其它会话 idle 不得回执本派发')
    // 目标会话 idle → 回执
    for (const fn of evtListeners['agent/status']) fn({ agent: liveAgent, status: 'idle' })
    await new Promise(r => setTimeout(r, 50))
    g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].dispatchStatus === 'done' && g.note.dispatches[0].receipt === 'idle', 'abc 会话条目被 idle 回执')
    // 无 agent / 无 id / null payload 不炸不误写
    for (const fn of evtListeners['agent/status']) { fn({ status: 'idle' }); fn({ agent: {}, status: 'idle' }); fn(null) }
    await new Promise(r => setTimeout(r, 20))
    g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches.filter(d => d.dispatchStatus === 'done').length === 1, '畸形 payload 后仍只有 1 条 done')
  })
  await t('dispatch-loop 标记块双包逐字节一致（host-impl / index.mjs）', () => {
    const grab = (s, tag) => { const m = s.match(/\/\/ ==== dispatch-loop BEGIN ====[\s\S]*?\/\/ ==== dispatch-loop END ====/); assert(m, tag + ' 缺 dispatch-loop 标记块'); return m[0] }
    assert.strictEqual(grab(indexSrc, 'index.mjs'), grab(hostSrc, 'host-impl.js'), 'host-impl.js 与 index.mjs 的 dispatch-loop 块必须逐字节一致')
  })
  await t('dispatch-loop 静态结构：ctx.on 守卫 + agent/status 订阅 + 三通道回执', () => {
    for (const [src, tag] of [[hostSrc, 'host-impl.js'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf("typeof ctx.on === 'function'") >= 0, tag + ' ctx.on 存在性守卫（老宿主/无事件 mock 降级）')
      assert(src.indexOf("ctx.on('agent/status'") >= 0, tag + ' 订阅 agent/status')
      assert(src.indexOf("payload.status !== 'idle'") >= 0, tag + ' 只关心 idle 落定')
      assert(src.indexOf("receipt: receipt || 'manual'") >= 0, tag + ' 回执来源标记 receipt')
      assert(src.indexOf("if (status === 'resolved') dispatchClosed = _closeOpenDispatches(note, 'resolved', undefined, dispatchClosedDs)") >= 0, tag + ' _update resolved 保底联动（闭环条目收集供 runLog 追加，notes-041-sched-runlog）')
      assert(src.indexOf("dispatchStatus: 'sent'") >= 0, tag + ' 派发登记 dispatchStatus=sent')
    }
  })
  // 0.4.5-I（notes-045-periodic-no-resolve）：派发消息不再引导 agent resolved（全量统一）——闭环归 idle 空闲回执，resolved 仅手动兜底
  await t('派发消息不再引导 resolved（0.4.5-I：含「不要修改笔记状态」+ 空闲自动回执说明）', async () => {
    const c = await handlers['notes-create']({ title: '闭环F', body: '做F事', kind: 'todo' })
    const before = sentMessages.length
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const m = sentMessages[sentMessages.length - 1]
    const text = m.msg.content[0].text
    assert(sentMessages.length === before + 1 && text.indexOf('处理完即可，**不要**修改笔记状态（保持原样）') >= 0 && text.indexOf('空闲时自动回执') >= 0, '派发消息含「不要修改笔记状态」+ 空闲自动回执说明（0.4.5-I）')
    assert(text.indexOf("status: 'resolved'") < 0 && text.indexOf('了结该笔记') < 0 && text.indexOf('完成后请调用') < 0, '派发消息零 resolved 指示（旧模板串清零）')
  })
  await t('详情徽章三端落地（client-impl / app.html / 原型）+ 样式（styles.css / lib/styles.css）', () => {
    assert(clientSrc.indexOf('isDispatchDone') >= 0 && clientSrc.indexOf('dsh-notes-dispatch-badge') >= 0, 'client-impl 派发徽章 + isDispatchDone')
    assert(clientSrc.indexOf('dispatchOpenCount') >= 0 && clientSrc.indexOf('派发已回执') >= 0, 'client-impl 徽章聚合计数 + 文案')
    const appSrc2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrc2 = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    for (const [s, tag] of [[appSrc2, 'app.html'], [protoSrc2, '原型 notes-ui-v2.html']]) {
      assert(s.indexOf('isDispDone') >= 0, tag + ' isDispDone 判定helper')
      assert(s.indexOf('disp-badge') >= 0 && s.indexOf('mDispBadge') >= 0, tag + ' meta chips 派发徽章（disp-badge + mDispBadge）')
      assert(s.indexOf('派发已回执') >= 0, tag + ' 徽章已回执文案')
      assert(s.indexOf(".disp-badge.pending{color:var(--nwarn)") >= 0, tag + ' 徽章 pending 样式')
    }
    // 原型是带 mock 数据层的设计稿：mock 派发/回执与演示数据带 dispatchStatus；app.html 是真实页面（数据层走 RPC，无 mock）
    assert(protoSrc2.indexOf("dispatchStatus: 'sent'") >= 0, '原型 mock/演示数据 dispatchStatus=sent')
    assert(protoSrc2.indexOf("dispatchStatus: 'done'") >= 0, '原型 mock 回执 dispatchStatus=done')
    const cssDev2 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const [s, tag] of [[cssDev2, 'styles.css'], [cssPkg2, 'lib/styles.css']]) {
      assert(s.indexOf('.dsh-notes-dispatch-badge.pending') >= 0 && s.indexOf('dshNotesDispatchPulse') >= 0, tag + ' 徽章样式（pending + 脉冲动画）')
    }
    // 原型 mock 的 resolved 保底联动（契约同 host）
    assert(protoSrc2.indexOf("receipt: 'resolved'") >= 0 && protoSrc2.indexOf('dispatchClosed') >= 0, '原型 mock notes-update resolved 联动回执')
  })
  }
}
