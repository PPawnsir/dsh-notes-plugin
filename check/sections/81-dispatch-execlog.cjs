// 节 81. 0.4.4-A 派发回执笔记化（三表归一 + 双端跳转，notes-044-dispatch-receipts）
// 设计定稿（主窗口调研笔记 + 设计修正·用户最新裁决 2026-10-05）：
//   每篇派发源笔记 ≤1 篇「执行记录 · <源笔记标题>」伴生笔记（kind=log 工作日志型——注入硬关天然适用；
//   folder='执行记录' 专用夹懒创建 ensure（严禁「工作日志」夹）；refNote=源笔记 id 回链；
//   软链字段统一 runLog：调度约定 schedule.runLog（存量继承零迁移）/ 非调度顶层 runLog front-matter 条件行）；
//   行型三族：📤 派发（_dispatch 成功即落）/ 📥 回执（idle/resolved 真实回执）/ ✅ 人工闭环（_dispatchDone）；
//   dispatches[] 结构与 dispatchStatus 状态机零改动（双载体正交）；行级追加 persistNote {history:false}。
// 测试策略：共享 mock 集群（节 2）+ evtListeners agent/status idle 模拟回执；条目断言直接读执行记录笔记正文。
module.exports = {
  id: "81",
  title: "81. 0.4.4-A 派发回执笔记化（三表归一 + 双端跳转）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc, indexSrc } = H
  const { handlers, evtListeners, liveAgent, store, NOTES_DIR } = S
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'   // helpers mock 唯一 live 会话
  const fireIdle = () => { for (const fn of evtListeners['agent/status']) fn({ agent: liveAgent, status: 'idle' }) }
  const flush = () => new Promise(r => setTimeout(r, 80))
  const entryLines = (body) => String(body || '').split('\n').filter(l => /^- /.test(l))
  section('81. 0.4.4-A 派发回执笔记化（三表归一 + 双端跳转）')
  // 后台 tick 闸沉降（同节 59 口径）
  for (let i = 0; i < 40; i++) {
    const probe = await handlers['notes-schedule-eval']({ now: '2020-01-01T00:00:00.000Z' })
    if (probe && !probe.skipped) break
    await new Promise(r => setTimeout(r, 50))
  }

  // ===== ①②③④ 手动派发 → 执行记录懒创建（设计修正全字段）→ 二次派发行级追加 → idle 真实回执 📥 =====
  let srcA = '', logA = ''
  await t('0.4.4-A① 手动派发 → 执行记录伴生笔记懒创建（顶层 runLog + refNote + kind=log + 执行记录夹 + inject 硬关 + 📤 派发行）', async () => {
    const c = await handlers['notes-create']({ title: '派单甲81', body: '甲正文（必须逐字节不动）', kind: 'todo', topic: '运维' })
    assert(c && c.id && !c.error, '创建源笔记成功（实得 ' + JSON.stringify(c) + '）')
    srcA = c.id
    const r = await handlers['notes-dispatch']({ id: srcA, sessionId: LIVE_SID, sessionName: '开发会话', instruction: '先查日志再动手' })
    assert(r && r.ok, '手动派发成功（实得 ' + JSON.stringify(r) + '）')
    const g = await handlers['notes-get']({ id: srcA })
    logA = g.note.runLog
    assert(logA && typeof logA === 'string', '顶层 runLog 软链已回写（非调度笔记 front-matter 条件行）')
    assert(!g.note.schedule, '非调度笔记不建 schedule 对象（软链位正交）')
    // 顶层 runLog 磁盘 front-matter 往返
    const raw = store.get(NOTES_DIR + '\\' + srcA + '.md')
    assert(/\nrunLog: n-[^\n]*\n/.test(raw || ''), '磁盘 front-matter 含顶层 runLog 条件行（存量零迁移：无值不落行）')
    const rl = await handlers['notes-get']({ id: logA })
    assert.strictEqual(rl.note.title, '执行记录 · 派单甲81', '标题 = 「执行记录 · 源笔记标题」（定稿格式）')
    assert.strictEqual(rl.note.kind, 'log', 'kind=log（设计修正·用户裁决：工作日志型——回执永不进系统提示）')
    assert.strictEqual(rl.note.inject, false, 'inject=false（log 注入硬关 injectForcedOff）')
    assert.strictEqual(rl.note.recall, false, 'recall 缺省 false（log 隐身语义：不进目录/默认召回）')
    assert.strictEqual(rl.note.refNote, srcA, 'refNote 回链源笔记（双端跳转机器键）')
    assert.strictEqual(rl.note.topic, '运维', 'topic 随源笔记')
    const flds = await handlers['notes-folders']({})
    const execFolder = (flds.folders || []).filter(f => f.name === '执行记录')[0]
    assert(execFolder, 'folders.json 懒创建「执行记录」专用夹（ensure 先例同「记忆档案」）')
    assert.strictEqual(rl.note.folder, execFolder.id, 'folder=「执行记录」夹 id（严禁「工作日志」夹）')
    assert(!(flds.folders || []).some(f => f.name === '工作日志' && f.id === rl.note.folder), '不在「工作日志」夹（语义分目录红线）')
    assert(rl.note.body.indexOf('请勿手动清理，由派发管线维护') >= 0 && rl.note.body.indexOf('## 执行记录（自动）') >= 0, '正文 = 说明块（kind=log 用途注明）+ 锚点节（RootNote preText 消费）')
    const lines = entryLines(rl.note.body)
    assert(lines.length === 1 && lines[0].indexOf('- 📤 ') === 0, '恰 1 条 📤 派发行（实得 ' + lines.length + '）')
    assert(lines[0].indexOf('开发会话') >= 0 && lines[0].indexOf('指令：先查日志再动手') >= 0, '派发行含目标会话 + 指令摘要')
    assert(lines[0].indexOf('note-dispatch-') < 0 && lines[0].indexOf('单号 ') >= 0, '派发行不含完整 msgId（回执族幂等键空间隔离）+ 单号尾段对参')
    const g2 = await handlers['notes-get']({ id: srcA })
    assert.strictEqual(g2.note.body, '甲正文（必须逐字节不动）', '源笔记正文零改动（派发载荷零污染红线）')
  })

  await t('0.4.4-A② 同一笔记二次派发 → 行级追加不新建笔记（≤1 篇伴生幂等）+ 同指令连发单号区分', async () => {
    await handlers['notes-dispatch']({ id: srcA, sessionId: LIVE_SID, sessionName: '开发会话', instruction: '第二次派发指令' })
    // 同秒同指令连发：行幂等键含单号尾段（msgId）——两条都落（崩溃重放同 msgId 才去重）
    await handlers['notes-dispatch']({ id: srcA, sessionId: LIVE_SID, sessionName: '开发会话', instruction: '第二次派发指令' })
    await handlers['notes-dispatch']({ id: srcA, sessionId: LIVE_SID, sessionName: '开发会话', instruction: '第二次派发指令' })
    const g = await handlers['notes-get']({ id: srcA })
    assert.strictEqual(g.note.runLog, logA, '软链不变（同一篇·三表归一）')
    assert.strictEqual((g.note.dispatches || []).length, 4, 'dispatches[] 结构化记录 4 条（零改动红线）')
    const rl = await handlers['notes-get']({ id: logA })
    const lines = entryLines(rl.note.body)
    assert.strictEqual(lines.length, 4, '行级追加 4 条 📤（实得 ' + lines.length + '）')
    assert(lines.every(l => l.indexOf('- 📤 ') === 0), '全为派发行（尚未回执）')
    assert(new Set(lines).size === 4, '同秒同指令连发亦分行（单号尾段区分；实得去重后 ' + new Set(lines).size + '）')
    // 全库该源笔记的伴生执行记录恰 1 篇（refNote 口径）
    const all = await handlers['notes-list']({})
    assert.strictEqual(all.notes.filter(n => n.refNote === srcA).length, 1, '≤1 篇伴生笔记（二次派发不新建）')
  })

  await t('0.4.4-A③ 真实回执（idle 事件）→ 📥 行追加（最新在前）', async () => {
    fireIdle(); await flush()
    const g = await handlers['notes-get']({ id: srcA })
    assert(g.note.dispatches.every(d => d.dispatchStatus === 'done' && d.receipt === 'idle'), 'dispatches 状态机闭环（receipt=idle）')
    const rl = await handlers['notes-get']({ id: logA })
    const lines = entryLines(rl.note.body)
    assert.strictEqual(lines.length, 8, '4 回执 + 4 派发（实得 ' + lines.length + '）')
    assert(lines.slice(0, 4).every(l => l.indexOf('- 📥 ') === 0 && l.indexOf('回执（idle）') >= 0 && l.indexOf('note-dispatch-') >= 0), '4 条 📥 回执行在最新侧（含 msgId）')
    // 幂等重放：重复 idle 零追加
    fireIdle(); await flush()
    const rl2 = await handlers['notes-get']({ id: logA })
    assert.strictEqual(rl2.note.body, rl.note.body, '重复 idle 幂等零追加（msgId 去重兜底）')
  })

  await t('0.4.4-A④ 人工闭环 → ✅ 行追加（_dispatchDone 通道）', async () => {
    await handlers['notes-dispatch']({ id: srcA, sessionId: LIVE_SID, sessionName: '开发会话', instruction: '收尾一发' })
    const r = await handlers['notes-dispatch-done']({ id: srcA, dispatchIndex: 4 })
    assert(r && r.ok, '手动标记完成成功')
    const rl = await handlers['notes-get']({ id: logA })
    const lines = entryLines(rl.note.body)
    assert.strictEqual(lines.length, 10, '✅+📤 各补 1（实得 ' + lines.length + '）')
    assert(lines[0].indexOf('- ✅ ') === 0 && lines[0].indexOf('回执（manual）') >= 0, '人工闭环 ✅ 行在首（实得 ' + lines[0] + '）')
    assert(lines[1].indexOf('- 📤 ') === 0 && lines[1].indexOf('指令：收尾一发') >= 0, '其 📤 派发行续后')
  })

  await t('0.4.4-A⑤ resolved 保底通道（非调度笔记）→ 📥 行（receipt=resolved）', async () => {
    const c = await handlers['notes-create']({ title: '派单乙81', body: '乙正文', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: LIVE_SID, sessionName: '开发会话' })
    const u = await handlers['notes-update']({ id: c.id, status: 'resolved' })
    assert(u && u.dispatchClosed === 1, 'resolved 保底回执 1 条')
    const g = await handlers['notes-get']({ id: c.id })
    const rl = await handlers['notes-get']({ id: g.note.runLog })
    const lines = entryLines(rl.note.body)
    assert(lines.length === 2 && lines[0].indexOf('- 📥 ') === 0 && lines[0].indexOf('回执（resolved）') >= 0 && lines[1].indexOf('- 📤 ') === 0, '📥 resolved 行 + 📤 行同篇（实得 ' + JSON.stringify(lines) + '）')
    await handlers['notes-delete']({ id: c.id })
  })

  await t('0.4.4-A⑥ 存量继承零迁移：显式软链指向存量 kind=sys 笔记 → 行进存量篇 + kind 不被改写 + 不新建', async () => {
    // 模拟 0.4.3 存量 runLog（kind=sys）：显式软链（闸门允许存在笔记 id，节 59⑤ 同口径）
    const stock = await handlers['notes-create']({ title: '存量 巡检runlog旧 · 执行记录', body: '## 执行记录（自动）\n\n- ✅ 2026-10-04 21:30 · 回执（idle）· → 旧会话 · note-dispatch-stock0000old\n', kind: 'sys', topic: '运维' })
    assert(stock && stock.id && !stock.error, '存量 sys 执行记录造数（实得 ' + JSON.stringify(stock) + '）')
    const c = await handlers['notes-create']({ title: '定时 存量继承81', body: '丙正文', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID, runLog: stock.id } })
    assert(c && c.id && !c.error, '携带存量 runLog 软链创建调度约定（实得 ' + JSON.stringify(c) + '）')
    await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.schedule.runLog, stock.id, '软链沿用存量（schedule.runLog 字段位不变）')
    assert(!g.note.runLog, '调度约定不落顶层 runLog（单指针）')
    const msgId = g.note.schedule.lastRun.receiptId
    fireIdle(); await flush()
    const rl = await handlers['notes-get']({ id: stock.id })
    assert.strictEqual(rl.note.kind, 'sys', '存量 kind=sys 零迁移（不随新模板改写）')
    const lines = entryLines(rl.note.body)
    assert.strictEqual(lines.length, 3, '存量 ✅ 行保留 + 新 📤/📥 行追加（实得 ' + lines.length + '）')
    assert(lines[0].indexOf('- 📥 ') === 0 && lines[0].indexOf(msgId) >= 0, '新回执 📥 行在首（存量 ✅ 行幂等键同口径）')
    assert(lines.some(l => l.indexOf('note-dispatch-stock0000old') >= 0), '存量条目逐字节保留')
    await handlers['notes-delete']({ id: c.id })
    await handlers['notes-delete']({ id: stock.id })
  })

  await t('0.4.4-A⑦ 「执行记录」夹口径 + 注入硬关：默认列表可见且在夹内（log 同权）+ update inject=true 被硬关纠正', async () => {
    const all = await handlers['notes-list']({})
    const row = all.notes.filter(n => n.id === logA)[0]
    assert(row, '执行记录笔记出现在默认列表（0.4.3⑦ log 同权——不再走 sys 降噪口径）')
    const flds = await handlers['notes-folders']({})
    const execFolder = (flds.folders || []).filter(f => f.name === '执行记录')[0]
    assert(execFolder && row.folder === execFolder.id, '位于「执行记录」夹内（分目录裁决）')
    const u = await handlers['notes-update']({ id: logA, inject: true })
    assert(u && u.injectForcedOff === true, 'update inject=true 被注入硬关纠正（injectForcedOff 回执）')
    const g = await handlers['notes-get']({ id: logA })
    assert(g.note.inject === false, 'inject 保持 false（回执永不进系统提示）')
  })

  await t('0.4.4-A⑧ 双端 UI 静态锚：派发历史行尾「执行记录 ↗」+ openExecLog + open-by-id 通道 + 样式双端', () => {
    const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    const cssDev = fsNative.readFileSync(path.join(DIR, 'src', 'styles.css'), 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    // app 端：派发历史行按钮 + openExecLog 共用入口 + selectNote open-by-id 兜底 + 行按钮样式
    assert(appSrc.indexOf('disp-log-act') >= 0, 'app.html 派发历史行尾「执行记录 ↗」按钮（disp-log-act）')
    assert(appSrc.indexOf('function openExecLog(') >= 0 && appSrc.indexOf('0.4.4-A open-by-id') >= 0, 'app.html openExecLog + selectNote open-by-id 通道')
    assert(appSrc.indexOf('.disp-log-act{') >= 0, 'app.html 行尾按钮样式')
    // client 双端：行按钮 + openExecLog + openByIdNote 旁路 + 样式
    for (const [s, label] of [[clientSrc, 'client 开发版'], [clientPkgSrc, '发布包 lib/client.js']]) {
      assert(s.indexOf('dsh-notes-dispatch-log-btn') >= 0, label + ' 派发历史行尾「执行记录 ↗」按钮')
      assert(s.indexOf('function openExecLog(') >= 0 && s.indexOf('openByIdNote') >= 0, label + ' openExecLog + open-by-id 旁路（缓存未命中 notes-get 直开）')
    }
    assert(cssDev.indexOf('.dsh-notes-dispatch-log-btn{') >= 0 && cssPkg.indexOf('.dsh-notes-dispatch-log-btn{') >= 0, '行尾按钮样式双端（styles.css ⇄ lib/styles.css）')
  })
  }
}
