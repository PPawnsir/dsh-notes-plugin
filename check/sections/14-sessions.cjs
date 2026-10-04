// 节 14. notes-sessions 会话名
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "14",
  title: "14. notes-sessions 会话名",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { agentsMock, handlers } = S
  // ===== 14. notes-sessions 会话名 =====
  section('14. notes-sessions 会话名')
  await t('notes-sessions 返回带名字的会话', async () => {
    // 此前已有多条笔记，sessionId 均为 agentsMock 的 'session-abc12345-...'
    const r = await handlers['notes-sessions']({})
    assert(Array.isArray(r.sessions), '返回 sessions 数组')
    const found = r.sessions.find(s => s.short === 'abc12345')
    assert(found, '应包含当前会话')
    assert.strictEqual(found.name, '开发会话', '会话名应读自 session/title 事件')
  })
  await t('notes-sessions 排除子 agent 会话', async () => {
    const r = await handlers['notes-sessions']({})
    assert(!r.sessions.find(s => s.id.indexOf('sub9900000') >= 0), 'origin=subagent 的一次性子 agent 会话不应出现在注入范围里')
    assert(r.sessions.find(s => s.short === 'abc12345'), '主窗口会话应保留')
  })
  await t('notes-sessions 排除已归档会话', async () => {
    const r = await handlers['notes-sessions']({})
    assert(!r.sessions.find(s => s.id.indexOf('arch00000') >= 0), '已归档会话不应出现在注入范围里')
    assert(r.sessions.find(s => s.short === 'abc12345'), '未归档的主会话应保留')
  })
  }
}
