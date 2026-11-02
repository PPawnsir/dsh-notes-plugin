// 节 141. rc.5 派发回执诊断+防御（notes-069-rc5-receipt-diag：D1-D4 诊断探针 + sid 多形态 + 无 sid 安全兜底）
// 背景：宿主 0.2.1-rc.5 实测 idle 回执永不闭合（cron/投递/唤醒/执行全通，dispatchStatus 停 'sent'）。
// 本节看守：①诊断点静态锚（dispatch.js / dispatch.dist.js 双包）②sid 多形态行为级 ③无 sid 兜底仅确认 idle 才闭合
// ④无 status 字段负向不误闭合 ⑤双包 dispatch-loop 块逐字节一致 ⑥诊断日志 200 行截断 + D1/D3/D4 事件落盘。
module.exports = {
  id: "141",
  title: "141. rc.5 派发回执诊断+防御（DIAG 探针 + sid 多形态 + 无 sid 安全兜底）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { ctx, evtListeners, handlers, createdAgents, store } = S
  section('141. rc.5 派发回执诊断+防御（DIAG 探针 + sid 多形态 + 无 sid 安全兜底）')
  const read = (rel) => fsNative.readFileSync(path.join(DIR, 'src', 'host', rel), 'utf8').replace(/\r\n/g, '\n')
  const DIAG_PATH = S.NOTES_DIR + '\\_dispatch-diag.log'
  const fire = (payload) => { for (const fn of evtListeners['agent/status']) fn(payload) }
  const sidN = (n) => 'session-rc5diag' + n + '00000000'   // 唯一即可：mock 侧不校验 sid 形态

  await t('静态锚：D1-D4 诊断点 + sid 多形态 + 兜底判定双包在位（dispatch.js / dispatch.dist.js / index.mjs）', () => {
    const dj = read('dispatch.js'), dd = read('dispatch.dist.js')
    for (const [s, tag] of [[dj, 'dispatch.js'], [dd, 'dispatch.dist.js'], [indexSrc, 'index.mjs']]) {
      assert(s.indexOf('/* DIAG rc.5 */') >= 0, tag + ' 含 /* DIAG rc.5 */ 诊断标记')
      assert(s.indexOf("ev: 'subscribed'") >= 0, tag + ' D1 订阅成功诊断点')
      assert(s.indexOf("ev: 'subscribe-failed'") >= 0, tag + ' D2 订阅抛错诊断点')
      assert(s.indexOf("ev: 'status'") >= 0, tag + ' D3 事件现场诊断点')
      assert(s.indexOf("ev: 'no-sid'") >= 0, tag + ' D4 无 sid 诊断点')
      assert(s.indexOf('DIAG_LOG_MAX_LINES = 200') >= 0, tag + ' 诊断日志 200 行截断常量')
      assert(s.indexOf('_dispatchSidFromPayload') >= 0, tag + ' sid 多形态取值函数')
      assert(s.indexOf('a.sessionId') >= 0 && s.indexOf('payload.sessionId') >= 0 && s.indexOf('payload.id') >= 0, tag + ' sid 兜底链含 agent.sessionId / payload.sessionId / payload.id')
      assert(s.indexOf('_dispatchIdleFallback') >= 0 && s.indexOf('_receiptIdleConfirmed') >= 0, tag + ' 无 sid 兜底路径')
      assert(s.indexOf("a.status === 'idle'") >= 0, tag + ' 兜底仅确认 idle 才闭合')
    }
  })

  await t('双包同步：dispatch.js ⇄ dispatch.dist.js 的 dispatch-loop 标记块逐字节一致', () => {
    const grab = (s, tag) => { const m = s.match(/\/\/ ==== dispatch-loop BEGIN ====[\s\S]*?\/\/ ==== dispatch-loop END ====/); assert(m, tag + ' 缺 dispatch-loop 标记块'); return m[0] }
    assert.strictEqual(grab(read('dispatch.js'), 'dispatch.js'), grab(read('dispatch.dist.js'), 'dispatch.dist.js'), 'dispatch-loop 块必须逐字节一致')
  })

  await t('sid 多形态行为级：五种 payload 形态各自命中目标会话派发（idle 回执）', async () => {
    const shapes = [
      (sid) => ({ agent: { id: sid }, status: 'idle' }),
      (sid) => ({ agent: { session: { id: sid } }, status: 'idle' }),
      (sid) => ({ agent: { sessionId: sid }, status: 'idle' }),
      (sid) => ({ agent: { session: { sessionId: sid } }, status: 'idle' }),
      (sid) => ({ sessionId: sid, status: 'idle' })
    ]
    const ids = []
    for (let i = 0; i < shapes.length; i++) {
      const sid = sidN(100 + i)
      createdAgents.set(sid, { id: sid, session: { id: sid }, send: () => {} })   // 注册 live（send 通道），派发才走 sent 语义
      const c = await handlers['notes-create']({ title: 'rc5形态' + i, body: 'x', kind: 'todo' })
      await handlers['notes-dispatch']({ id: c.id, sessionId: sid, sessionName: '会话' + i })
      ids.push({ note: c.id, sid: sid })
      fire(shapes[i](sid))
      createdAgents.delete(sid)
    }
    await new Promise(r => setTimeout(r, 80))
    for (const { note, sid } of ids) {
      const g = await handlers['notes-get']({ id: note })
      const d = g.note.dispatches[0]
      assert(d.dispatchStatus === 'done' && d.sessionId === sid, '形态 ' + sid + ' 命中回执（实得 ' + JSON.stringify(d) + '）')
    }
  })

  await t('无 sid 兜底：仅 agents.get 命中且 status=idle 的会话被闭合；running / 非 live / 无 status 一律不闭合', async () => {
    const sidIdle = sidN(201), sidRun = sidN(202), sidDead = sidN(203), sidBare = sidN(204)
    // 自建带 status 的 mock agent（裁决要点：check mock liveAgent 无 status 字段，须自建才能测兜底正路径）
    createdAgents.set(sidIdle, { id: sidIdle, session: { id: sidIdle }, status: 'idle', send: () => {} })
    createdAgents.set(sidRun, { id: sidRun, session: { id: sidRun }, status: 'running', send: () => {} })
    // sidBare：映射到无 status 字段的裸 agent（负向——状态不明不得闭合）
    createdAgents.set(sidBare, { id: sidBare, session: { id: sidBare }, send: () => {} })
    // sidDead：非 live 目标——播种持久化日志走休眠送达（queued 语义），兜底时 agents.get 未命中
    S.persistLogs.set(sidDead, [])
    const mk = async (sid, name) => {
      const c = await handlers['notes-create']({ title: 'rc5兜底' + name, body: 'x', kind: 'todo' })
      await handlers['notes-dispatch']({ id: c.id, sessionId: sid, sessionName: name })
      return c.id
    }
    const nIdle = await mk(sidIdle, 'idle'), nRun = await mk(sidRun, 'run'), nDead = await mk(sidDead, 'dead'), nBare = await mk(sidBare, 'bare')
    fire({ status: 'idle' })   // 无 sid 无 agent → 触发 1.5s 延迟兜底
    await new Promise(r => setTimeout(r, 1900))
    const st = async (id) => (await handlers['notes-get']({ id: id })).note.dispatches[0].dispatchStatus
    assert.strictEqual(await st(nIdle), 'done', '确认 idle 的会话派发被兜底闭合')
    assert.strictEqual(await st(nRun), 'sent', 'running 会话不得闭合（宁漏勿错）')
    assert.strictEqual(await st(nDead), 'sent', '非 live（agents.get 未命中）会话不得闭合')
    assert.strictEqual(await st(nBare), 'sent', '无 status 字段（状态不明）不得闭合（负向）')
    createdAgents.delete(sidIdle); createdAgents.delete(sidRun); createdAgents.delete(sidBare); S.persistLogs.delete(sidDead)
  })

  await t('诊断日志：D1 subscribed 落盘 + D3/D4 事件单行 JSON + 200 行截断', async () => {
    const txt0 = String(store.get(DIAG_PATH) || '')
    const lines0 = txt0.split('\n').filter(l => l.trim())
    assert(lines0.some(l => { try { return JSON.parse(l).ev === 'subscribed' } catch (e) { return false } }), 'D1 subscribed 诊断行已落盘')
    assert(lines0.some(l => { try { return JSON.parse(l).ev === 'status' } catch (e) { return false } }), 'D3 status 诊断行已落盘')
    assert(lines0.some(l => { try { return JSON.parse(l).ev === 'no-sid' } catch (e) { return false } }), 'D4 no-sid 诊断行已落盘')
    const d3 = JSON.parse(lines0.filter(l => l.indexOf('"ev":"status"') >= 0).pop())
    assert(d3.payloadKeys && d3.t && ('hasAgent' in d3) && ('agentId' in d3) && ('agentSession' in d3), 'D3 行含 payloadKeys/t/hasAgent/agentId/agentSession 字段')
    // 截断：预置 250 行旧记录 → 触发一次事件 → 上限 200 保最新裁最旧
    const fake = []
    for (let i = 0; i < 250; i++) fake.push(JSON.stringify({ t: '2026-11-02T00:00:00.000Z', ev: 'fake', i: i }))
    store.set(DIAG_PATH, fake.join('\n') + '\n')
    fire({ agent: { id: sidN(300) }, status: 'running' })
    await new Promise(r => setTimeout(r, 80))
    const lines = String(store.get(DIAG_PATH) || '').split('\n').filter(l => l.trim())
    assert.strictEqual(lines.length, 200, '诊断日志截断到 200 行（实得 ' + lines.length + '）')
    const last = JSON.parse(lines[lines.length - 1])
    assert(last.ev === 'status' && last.agentId === sidN(300), '最新行是本次事件（保最新）')
    assert(lines[0].indexOf('"i":51') >= 0, '最旧被裁（首行应为 fake i=51，实得 ' + lines[0].slice(0, 80) + '）')
  })
  }
}
