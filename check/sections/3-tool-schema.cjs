// 节 3. 工具 schema 校验
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "3",
  title: "3. 工具 schema 校验",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { registeredTools } = S
  // ===== 3. 工具 schema 校验 =====
  section('3. 工具 schema 校验')
  function findTool(name) { return registeredTools.find(x => x.name === name) }
  await t('note_search 已注册', () => assert(findTool('note_search'), 'note_search 存在'))
  await t('note_get 已注册', () => assert(findTool('note_get'), 'note_get 存在'))
  await t('note_manage 已注册', () => assert(findTool('note_manage'), 'note_manage 存在'))
  const t1 = findTool('note_search')
  const t2 = findTool('note_get')
  const t3 = findTool('note_manage')
  await t('note_search.output.render 存在', () => assert(typeof t1.output.render === 'function'))
  await t('note_get.output.render 存在', () => assert(typeof t2.output.render === 'function'))
  await t('note_manage.output.render 存在', () => assert(typeof t3.output.render === 'function'))
  await t('note_search.parameters 含 query/tag/topic', () => {
    const p = t1.parameters.properties
    assert(p.query && p.tag && p.topic, '缺字段')
  })
  await t('note_get.parameters 含 id', () => assert(t2.parameters.properties.id))
  await t('note_manage.parameters 含 action', () => {
    assert(t3.parameters.properties && t3.parameters.properties.action, 'note_manage 需 action 字段区分动作')
  })
  Object.assign(S, { findTool, t1, t2, t3 })
  }
}
