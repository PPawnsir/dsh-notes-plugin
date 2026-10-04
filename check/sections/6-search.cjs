// 节 6. 搜索
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "6",
  title: "6. 搜索",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { handlers, q1 } = S
  // ===== 6. 搜索 =====
  section('6. 搜索')
  const sRpc = await handlers['notes-search']({ query: '速记第二' })
  await t('notes-search RPC 命中正文且瘦身', () => {
    assert(sRpc.notes && sRpc.notes.length >= 1 && !('body' in sRpc.notes[0]))
  })
  // 搜索体验升级：matches 命中字段（只读断言，写库的组合过滤/全档用例在 34.2 独立实例，防污染共享库）
  await t('notes-search 附 matches 命中字段（正文命中标记 body）', () => {
    const hit = sRpc.notes.find(n => n.id === q1.id)
    assert(hit && Array.isArray(hit.matches), '带 query 的结果附 matches 数组（实得 ' + JSON.stringify(hit && hit.matches) + '）')
    assert(hit.matches.indexOf('body') >= 0 && hit.matches.indexOf('title') < 0, '正文命中标 body、标题未中不标 title')
  })
  }
}
