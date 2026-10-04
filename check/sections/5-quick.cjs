// 节 5. 快速记录：合并窗口 + 异步分类
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "5",
  title: "5. 快速记录：合并窗口 + 异步分类",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { handlers } = S
  // ===== 5. 快速记录合并窗口 =====
  section('5. 快速记录：合并窗口 + 异步分类')
  const q1 = await handlers['notes-quick']({ text: '速记第一条', sessionId: 'sess-test-1' })
  await t('首次 quick 创建新笔记', () => assert(!q1.merged && q1.id))
  const q2 = await handlers['notes-quick']({ text: '速记第二条', sessionId: 'sess-test-1' })
  await t('同 session 窗口内合并', () => assert(q2.merged && q2.id === q1.id))
  await new Promise(r => setTimeout(r, 150))
  const gq = await handlers['notes-get']({ id: q1.id })
  await t('异步分类填主题', () => assert.strictEqual(gq.note.topic, '开发'))
  await t('标题含分类主题', () => assert(gq.note.title.indexOf('开发') >= 0))
  await t('合并后正文含两段', () => assert(gq.note.body.indexOf('速记第一条') >= 0 && gq.note.body.indexOf('速记第二条') >= 0))
  const q3 = await handlers['notes-quick']({ text: '别的会话', sessionId: 'sess-test-2' })
  await t('跨 session 不合并', () => assert(!q3.merged && q3.id !== q1.id))
  await new Promise(r => setTimeout(r, 150))
  Object.assign(S, { q1, q2 })
  }
}
