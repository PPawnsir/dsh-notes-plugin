// 节 15. 任务派发（系统提示注入形式）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "15",
  title: "15. 任务派发（系统提示注入形式）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { g, handlers, noteManage, plugin, sentMessages } = S
  // ===== 15. 任务派发（系统提示注入形式：登记 dispatches + 目标会话系统提示注入待办） =====
  section('15. 任务派发（系统提示注入形式）')
  await t('notes-active-sessions 返回活跃主会话', async () => {
    const r = await handlers['notes-active-sessions']({})
    assert(Array.isArray(r.sessions), '返回 sessions 数组')
    assert(r.sessions.length === 1, 'mock 只有 1 个活跃主会话')
    assert.strictEqual(r.sessions[0].short, 'abc12345')
  })
  await t('notes-dispatch 注入上下文+触发工作（agent.send）', async () => {
    const c = await handlers['notes-create']({ title: '待办A', body: '重构 X 模块', kind: 'todo' })
    const before = sentMessages.length
    const r = await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话', workspace: 'deepseek-work', mode: 'existing', instruction: '重点处理性能瓶颈' })
    assert(r.ok === true, '派发应成功')
    assert.strictEqual(sentMessages.length, before + 1, '应 agent.send 注入上下文并触发工作')
    const m = sentMessages[sentMessages.length - 1]
    assert.strictEqual(m.target, 'next-turn'); assert.strictEqual(m.wakeup, true, 'wakeup=true 触发 agent 开始工作')
    assert(m.msg.source && m.msg.source.kind === 'plugin:dsh-notes' && m.msg.source.form === 'recall', 'source 应为生产者自有 kind（v4：plugin:dsh-notes）+ form=recall（召回上下文，非用户指令）')
    assert(m.msg.content[0].text.indexOf('重构 X 模块') >= 0, '消息含 todo 上下文')
    assert(m.msg.content[0].text.indexOf('重点处理性能瓶颈') >= 0, '消息含派发方补充要求')
    const g = await handlers['notes-get']({ id: c.id })
    assert(Array.isArray(g.note.dispatches) && g.note.dispatches.length === 1, 'dispatches 属性应有 1 条记录')
    const d = g.note.dispatches[0]
    assert.strictEqual(d.sessionName, '开发会话'); assert.strictEqual(d.instruction, '重点处理性能瓶颈'); assert.strictEqual(d.done, false, '新派发为待处理 done=false')
    assert.strictEqual(d.dispatchStatus, 'sent', 'P3：新派发带状态机字段 dispatchStatus=sent')
    assert(g.note.body.indexOf('已派发到') < 0, '派发记录不应写进正文')
  })
  await t('notes-dispatch 目标未打开返回 needOpen', async () => {
    const c = await handlers['notes-create']({ title: '待办B2', body: 'x', kind: 'todo' })
    const r = await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-notlive-0000' })
    assert(r.error && r.needOpen === true, '目标不 live 应返回 needOpen 提示')
  })
  await t('notes-dispatch-done 标记完成停止注入', async () => {
    const c = await handlers['notes-create']({ title: '待办-done', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    const r = await handlers['notes-dispatch-done']({ id: c.id, dispatchIndex: 0 })
    assert(r.ok === true, '标记完成应成功')
    const g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches[0].done === true && g.note.dispatches[0].doneAt, 'dispatch 应标记 done + doneAt')
    assert(g.note.dispatches[0].dispatchStatus === 'done' && g.note.dispatches[0].receipt === 'manual', 'P3：手动标记写 dispatchStatus=done + receipt=manual')
  })
  await t('notes-dispatch 缺少目标会话报错', async () => {
    const c = await handlers['notes-create']({ title: '待办C', body: 'x', kind: 'todo' })
    const r = await handlers['notes-dispatch']({ id: c.id })
    assert(r.error && r.error.indexOf('缺少目标会话') >= 0, '缺 sessionId 应报错')
  })
  await t('dispatches 字段 front-matter 往返', async () => {
    const c = await handlers['notes-create']({ title: '待办D2', body: 'x', kind: 'todo' })
    await handlers['notes-dispatch']({ id: c.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话', instruction: '含,逗号"引号' })
    const r = await handlers['notes-get']({ id: c.id })
    assert(r.note.dispatches.length === 1 && r.note.dispatches[0].instruction === '含,逗号"引号', 'dispatches 应正确序列化/反序列化（含特殊字符）')
  })
  await t('note_manage dispatch 无目标时列出活跃会话', async () => {
    const c = await noteManage.execute({ action: 'create', title: '待办D', body: 'x', kind: 'todo' })
    const r = await noteManage.execute({ action: 'dispatch', id: c.id })
    assert(r.needTarget === true && Array.isArray(r.activeSessions), '无目标时应返回活跃会话列表')
    assert(r.activeSessions.find(s => s.short === 'abc12345'), '列表应含当前活跃会话')
    assert(r.activeSessions[0].name, '活跃会话应带名字')
  })
  await t('note_manage dispatch 注入上下文+触发工作', async () => {
    const c = await noteManage.execute({ action: 'create', title: '待办E', body: '做E事', kind: 'todo' })
    const before = sentMessages.length
    const r = await noteManage.execute({ action: 'dispatch', id: c.id, targetSessionId: 'session-abc12345-0000-0000-0000-000000000000', targetSessionName: '开发会话', instruction: '按要求做' })
    assert(r.action === 'dispatch' && !r.error, '派发应成功')
    assert.strictEqual(sentMessages.length, before + 1, '应 agent.send 触发工作')
    assert(sentMessages[sentMessages.length - 1].msg.content[0].text.indexOf('按要求做') >= 0, '消息含 instruction')
    const g = await handlers['notes-get']({ id: c.id })
    assert(g.note.dispatches.length === 1 && g.note.dispatches[0].instruction === '按要求做', 'dispatches 记录含 instruction')
  })
  }
}
