// 节 59. 定时派发·执行记录独立笔记（notes-041-sched-runlog：schedule.runLog 软链 + 计划块「执行记录 ↗」跳转 + 约定正文零改动红线）
// 设计定稿（用户裁决 2026-10-04 晚，修订替代"正文节"方案）：克隆体约定正文=派发载荷（整体注入 target 会话），
//   执行记录追加进正文会无限膨胀并污染下次派发上下文——改为独立笔记懒创建（首条回执时）+ front-matter schedule.runLog 软链。
// 测试策略：共享 mock 集群（节 2）+ 注入时钟（notes-schedule-eval {now}）触发 + evtListeners agent/status idle 模拟回执；
//   约定全部 every≥3d（真时钟下后台 tick 零干扰）；条目断言直接读 runLog 笔记正文。
module.exports = {
  id: "59",
  title: "59. 定时派发·执行记录独立笔记（schedule.runLog 软链 + 约定正文零改动红线）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc, indexSrc } = H
  const { handlers, evtListeners, liveAgent } = S
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'   // helpers mock 唯一 live 会话
  const fireIdle = () => { for (const fn of evtListeners['agent/status']) fn({ agent: liveAgent, status: 'idle' }) }
  const flush = () => new Promise(r => setTimeout(r, 80))
  const entryLines = (body) => String(body || '').split('\n').filter(l => /^- /.test(l))
  section('59. 定时派发·执行记录独立笔记（schedule.runLog 软链 + 约定正文零改动红线）')
  // 启动补评估 tick（apply 时 fire-and-forget）在 --only 快跑模式下可能仍在途（防重叠闸 skipped:running）——
  // 先等闸沉降再驱动注入时钟：过去时刻探针零到期零副作用；全量模式下前置节已耗时，首轮即直通
  for (let i = 0; i < 40; i++) {
    const probe = await handlers['notes-schedule-eval']({ now: '2020-01-01T00:00:00.000Z' })
    if (probe && !probe.skipped) break
    await new Promise(r => setTimeout(r, 50))
  }

  // ===== ① 懒创建 + 软链回写 + 约定正文零改动（关键红线） =====
  let convA = null, bodyA = '', runLogA = ''
  await t('runLog 懒创建 + 软链回写 + 约定正文零改动红线（idle 回执 → 执行记录独立笔记）', async () => {
    const c = await handlers['notes-create']({ title: '定时 巡检runlogA', body: 'A 类巡检正文（派发载荷，必须逐字节不动）', kind: 'todo', topic: '运维', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    assert(c && c.id && !c.error, '创建调度约定成功（实得 ' + JSON.stringify(c) + '）')
    convA = c.id
    const g0 = await handlers['notes-get']({ id: convA }); bodyA = g0.note.body
    assert(!g0.note.schedule.runLog, '首条回执前无 runLog 软链（懒创建语义）')
    const ev = await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
    assert(ev.fired >= 1 && !ev.error, '到期触发（实得 ' + JSON.stringify(ev) + '）')
    const g1 = await handlers['notes-get']({ id: convA })
    const msgId = g1.note.schedule.lastRun.receiptId
    assert(/^note-dispatch-/.test(msgId || ''), '派发已登记 receiptId=msgId')
    assert(!g1.note.schedule.runLog, '派发后仍不建 runLog——回执落盘时机才懒创建')
    fireIdle(); await flush()
    const g2 = await handlers['notes-get']({ id: convA })
    runLogA = g2.note.schedule.runLog
    assert(runLogA, 'idle 回执后 schedule.runLog 软链已回写（实得 ' + JSON.stringify(g2.note.schedule) + '）')
    assert.strictEqual(g2.note.body, bodyA, '约定正文逐字节不动（核心红线：派发载荷零污染）')
    const rl = await handlers['notes-get']({ id: runLogA })
    assert.strictEqual(rl.note.title, '定时 巡检runlogA · 执行记录', 'runLog 笔记标题 = 约定标题 + 「 · 执行记录」')
    assert.strictEqual(rl.note.kind, 'note', 'runLog 笔记 kind=note（可见可检索红线，非 log）')
    assert.strictEqual(rl.note.topic, '运维', 'runLog 笔记 topic 随约定')
    assert(rl.note.body.indexOf('## 执行记录（自动）') >= 0, 'runLog 正文含自动节标题')
    const lines = entryLines(rl.note.body)
    assert(lines.length === 1, '首条回执恰好 1 条目（实得 ' + lines.length + '）')
    assert(lines[0].indexOf('- ✅ ') === 0 && lines[0].indexOf('回执（idle）') >= 0 && lines[0].indexOf(msgId) >= 0, '条目形态：时刻 + 回执来源 + msgId（实得 ' + lines[0] + '）')
  })

  // ===== ② 幂等：重复回执/双通道同 msgId 零重复条目 =====
  await t('runLog 幂等：重复 idle 零追加；已闭环条目手动标记同 msgId 去重跳过', async () => {
    const g0 = await handlers['notes-get']({ id: runLogA })
    const body0 = g0.note.body
    fireIdle(); await flush()
    const g1 = await handlers['notes-get']({ id: runLogA })
    assert.strictEqual(g1.note.body, body0, '重复 idle（无新闭环条目）runLog 零改动')
    // 手动「标记完成」已闭环条目：receipt 覆写为 manual，但 msgId 已在正文 → 幂等去重不新增
    const r = await handlers['notes-dispatch-done']({ id: convA, dispatchIndex: 0 })
    assert(r && r.ok, '手动标记通道可用（实得 ' + JSON.stringify(r) + '）')
    const g2 = await handlers['notes-get']({ id: runLogA })
    assert.strictEqual(g2.note.body, body0, '同 msgId 幂等去重（条目数不变）')
    assert.strictEqual(entryLines(g2.note.body).length, 1, '仍 1 条目')
  })

  // ===== ③ 倒序追加（最新在前）+ resolved 保底通道同口径 =====
  let convB = null, runLogB = ''
  await t('runLog 倒序追加（最新在前）+ resolved 保底通道同口径 + 正文保持纯净', async () => {
    const c = await handlers['notes-create']({ title: '定时 巡检runlogB', body: 'B 正文', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    assert(c && c.id && !c.error, '创建成功（实得 ' + JSON.stringify(c) + '）')
    convB = c.id
    await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 10 * 86400000).toISOString() })
    let g = await handlers['notes-get']({ id: convB }); const m1 = g.note.schedule.lastRun.receiptId
    fireIdle(); await flush()
    g = await handlers['notes-get']({ id: convB }); runLogB = g.note.schedule.runLog
    assert(runLogB, '首条回执建软链')
    await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 20 * 86400000).toISOString() })
    g = await handlers['notes-get']({ id: convB }); const m2 = g.note.schedule.lastRun.receiptId
    assert(m2 && m2 !== m1, '两次触发不同 msgId')
    const u = await handlers['notes-update']({ id: convB, status: 'resolved' })
    assert(u && u.dispatchClosed === 1, 'resolved 保底回执 1 条（实得 ' + JSON.stringify(u) + '）')
    const rl = await handlers['notes-get']({ id: runLogB })
    const lines = entryLines(rl.note.body)
    assert(lines.length === 2, '两条目（实得 ' + lines.length + '）')
    assert(lines[0].indexOf(m2) >= 0 && lines[0].indexOf('回执（resolved）') >= 0, '最新条目在最前（倒序）+ resolved 通道来源标注')
    assert(lines[1].indexOf(m1) >= 0 && lines[1].indexOf('回执（idle）') >= 0, '旧条目续后')
    const g2 = await handlers['notes-get']({ id: convB })
    assert.strictEqual(g2.note.body, 'B 正文', '约定正文仍零改动（resolved 通道同守红线）')
    await handlers['notes-delete']({ id: convB })   // resolved 约定防后续 eval 噪音（tick 不滤 status）
  })

  // ===== ④ 容量红线：批量回执 55 条 → 倒序保留最新 50 裁尾 =====
  await t('runLog 容量红线：批量回执 55 条 → 倒序 ≤50 裁尾（最旧裁掉）', async () => {
    const c = await handlers['notes-create']({ title: '定时 巡检runlogC', body: 'C 正文', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    assert(c && c.id && !c.error, '创建成功（实得 ' + JSON.stringify(c) + '）')
    const capId = c.id
    const base = Date.now() + 30 * 86400000
    for (let i = 0; i < 55; i++) {
      const ev = await handlers['notes-schedule-eval']({ now: new Date(base + i * 3 * 86400000 + 3600000).toISOString() })
      if (i === 0) assert(ev.fired >= 1, '首发触发（实得 ' + JSON.stringify(ev) + '）')
    }
    let g = await handlers['notes-get']({ id: capId })
    assert.strictEqual(g.note.dispatches.length, 55, '55 次触发全部登记（实得 ' + g.note.dispatches.length + '）')
    const firstMsgId = g.note.dispatches[0].msgId
    const lastMsgId = g.note.dispatches[54].msgId
    fireIdle(); await flush()
    g = await handlers['notes-get']({ id: capId })
    const rlId = g.note.schedule.runLog
    assert(rlId, '批量回执后软链已建')
    const rl = await handlers['notes-get']({ id: rlId })
    const lines = entryLines(rl.note.body)
    assert.strictEqual(lines.length, 50, '≤50 裁尾（实得 ' + lines.length + '）')
    assert(lines[0].indexOf(lastMsgId) >= 0, '最新条目在首行（倒序）')
    assert(rl.note.body.indexOf(firstMsgId) < 0, '最旧条目已裁掉')
    assert.strictEqual(g.note.body, 'C 正文', '55 条执行记录后约定正文仍零改动')
    await handlers['notes-delete']({ id: capId })
  })

  // ===== ⑤ 写入闸门：schedCheckDecl 已知键 + _schedValidateWrite 存在性校验 =====
  await t('runLog 写入闸门：存在笔记 id 放行 / 幽灵 id 与非串拒绝 / 缺省延续 / 空串解除', async () => {
    const host = await handlers['notes-create']({ title: '既有笔记X', body: 'x' })
    assert(host && host.id, '既有笔记造数')
    const existId = host.id
    // create 通道：声明即带合法 runLog 放行
    let c = await handlers['notes-create']({ title: '定时 闸门runlog0', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '7d', target: LIVE_SID, enabled: false, runLog: existId } })
    assert(c && c.id && !c.error, 'create 携带合法 runLog 放行（实得 ' + JSON.stringify(c) + '）')
    let g0 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g0.note.schedule.runLog, existId, 'create 通道 runLog 落库')
    await handlers['notes-delete']({ id: c.id })
    // create 通道：幽灵 id 拒绝
    c = await handlers['notes-create']({ title: 'x', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '7d', target: LIVE_SID, enabled: false, runLog: 'n-ghost-00000000' } })
    assert(c.error && c.error.indexOf('runLog') >= 0, 'create 幽灵 runLog 拒绝（实得 ' + c.error + '）')
    // update 通道全口径
    c = await handlers['notes-create']({ title: '定时 闸门runlog', body: 'x', contractType: 'dispatch-schedule', schedule: { every: '7d', target: LIVE_SID, enabled: false } })
    const gid = c.id
    let u = await handlers['notes-update']({ id: gid, schedule: { every: '7d', target: LIVE_SID, enabled: false, runLog: existId } })
    assert(u && !u.error, 'update 显式 runLog=存在笔记 id 放行（实得 ' + JSON.stringify(u) + '）')
    let g = await handlers['notes-get']({ id: gid })
    assert.strictEqual(g.note.schedule.runLog, existId, 'runLog 落库')
    u = await handlers['notes-update']({ id: gid, schedule: { every: '7d', target: LIVE_SID, enabled: false, runLog: 'n-ghost-00000000' } })
    assert(u.error && u.error.indexOf('runLog') >= 0, '幽灵 id 拒绝（实得 ' + u.error + '）')
    u = await handlers['notes-update']({ id: gid, schedule: { every: '7d', target: LIVE_SID, enabled: false, runLog: 123 } })
    assert(u.error && u.error.indexOf('runLog') >= 0, '非字符串拒绝（错得安全，实得 ' + u.error + '）')
    u = await handlers['notes-update']({ id: gid, schedule: { every: '14d', target: LIVE_SID, enabled: false } })
    assert(u && !u.error, '声明改写成功')
    g = await handlers['notes-get']({ id: gid })
    assert.strictEqual(g.note.schedule.runLog, existId, '声明改写缺省延续 runLog（编辑/暂停/恢复不丢软链）')
    assert.strictEqual(g.note.schedule.every, '14d', '声明字段已覆盖')
    u = await handlers['notes-update']({ id: gid, schedule: { every: '14d', target: LIVE_SID, enabled: false, runLog: '' } })
    assert(u && !u.error, '空串显式解除放行')
    g = await handlers['notes-get']({ id: gid })
    assert(!g.note.schedule.runLog, '空串显式解除软链（runLog 笔记留档不级联删）')
    await handlers['notes-delete']({ id: gid })
    await handlers['notes-delete']({ id: existId })
  })

  // ===== ⑥ 删除约定不级联删 runLog（留档红线） =====
  await t('删除约定不级联删 runLog 笔记（留档）', async () => {
    await handlers['notes-delete']({ id: convA })
    const rl = await handlers['notes-get']({ id: runLogA })
    assert(rl && rl.note && !rl.note.deleted, '约定已删，执行记录笔记留档（不级联删除）')
    assert.strictEqual(rl.note.title, '定时 巡检runlogA · 执行记录', '留档笔记内容完整')
  })

  // ===== ⑦ 静态锚点：schedule-runlog 标记块双包逐字节 + 三通道接线 + 四端计划块链接 =====
  await t('runLog 静态锚点：标记块双包逐字节 + 三回执通道接线 + 四端「执行记录 ↗」链接 + 原型 mock 同步', () => {
    const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoV2Src = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    const grab = (s, tag) => { const m = s.match(/\/\/ ==== schedule-runlog BEGIN ====[\s\S]*?\/\/ ==== schedule-runlog END ====/); assert(m, tag + ' 缺 schedule-runlog 标记块'); return m[0] }
    assert.strictEqual(grab(indexSrc, 'index.mjs'), grab(hostSrc, 'host-impl'), 'schedule-runlog 块双包逐字节一致（schedule.js 共源单份）')
    for (const pair of [[hostSrc, 'host-impl'], [indexSrc, 'index.mjs']]) {
      const src = pair[0], tag = pair[1]
      assert(src.indexOf('const SCHED_RUNLOG_MAX = 50') >= 0, tag + ' 容量红线 50')
      assert(src.indexOf("const SCHED_RUNLOG_HEAD = '## 执行记录（自动）'") >= 0, tag + ' 自动节标题常量')
      assert(src.indexOf('async function _schedRunLogAppend(') >= 0, tag + ' 回执挂钩函数')
      assert(src.indexOf('lastError: 1, runLog: 1') >= 0, tag + ' schedCheckDecl 已知键表含 runLog')
      assert(src.indexOf('schedule.runLog 必须是存在的笔记 id 或空') >= 0, tag + ' 闸门存在性校验文案')
      assert(src.indexOf('history: false') >= 0, tag + ' 机器产物零历史快照（runLog 创建回写/追加同口径）')
      // 三回执通道接线
      assert(src.indexOf("_closeOpenDispatches(n, 'idle', sid, closedDs)") >= 0, tag + ' idle 通道收集闭环条目')
      assert(src.indexOf('await _schedRunLogAppend(n, closedDs)') >= 0, tag + ' idle 通道追加')
      assert(src.indexOf("_closeOpenDispatches(note, 'resolved', undefined, dispatchClosedDs)") >= 0, tag + ' resolved 保底通道')
      assert(src.indexOf('await _schedRunLogAppend(note, [ds[i]])') >= 0, tag + ' 手动标记通道')
      // 工具描述同步（agent 面契约）
      assert(src.indexOf('lastError/runLog') >= 0, tag + ' 工具描述机器字段含 runLog')
    }
    // 四端计划块「执行记录 ↗」链接
    for (const pair of [[appSrc, 'app.html'], [protoV2Src, '原型 notes-ui-v2.html']]) {
      const s = pair[0], label = pair[1]
      assert(s.indexOf("s.runLog ? '<button") >= 0, label + ' 软链存在才渲染链接（无 runLog 零 DOM 痕迹）')
      assert(s.indexOf('sched-runlog-act') >= 0 && s.indexOf('执行记录 ↗') >= 0, label + ' 计划块「执行记录 ↗」链接 + 接线标记类')
      assert(s.indexOf("querySelectorAll('.sched-runlog-act')") >= 0 && s.indexOf('selectNote(rid)') >= 0, label + ' 点击走既有 selectNote 跳转（缓存未命中 toast 守卫）')
    }
    for (const pair of [[clientSrc, 'client 开发版'], [clientPkgSrc, '发布包 lib/client.js']]) {
      const s = pair[0], label = pair[0]
      assert(s.indexOf('执行记录 ↗') >= 0 && s.indexOf('curNote.schedule.runLog') >= 0, label + ' 计划块执行记录链接')
      assert(s.indexOf('notes.find(x => x.id === curNote.schedule.runLog)') >= 0, label + ' 点击 selectNote 跳转（缓存守卫）')
    }
    // 原型 mock 同步：闸门已知键 + 存在性校验 + 演示数据（n93 软链 n96）
    assert(protoV2Src.indexOf('lastError: 1, runLog: 1') >= 0, '原型 mock 闸门已知键含 runLog')
    assert(protoV2Src.indexOf("schedule.runLog 必须是存在的笔记 id 或空") >= 0, '原型 mock 闸门存在性校验同口径')
    assert(protoV2Src.indexOf("runLog: 'n96'") >= 0 && protoV2Src.indexOf("· 执行记录'") >= 0, '原型演示数据含 runLog 软链 + 执行记录笔记')
  })
  }
}
