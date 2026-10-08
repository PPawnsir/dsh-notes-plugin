// 节 10. note_manage 工具：六种 action 路由
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "10",
  title: "10. note_manage 工具：六种 action 路由",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { findTool, g, handlers, m1, m2 } = S
  // ===== 10. note_manage 各 action 行为 =====
  section('10. note_manage 工具：六种 action 路由')
  const noteManage = findTool('note_manage')
  const tMgr1 = await noteManage.execute({ action: 'create', title: 'mgr-A', body: 'ma', topic: '设计' })
  await t('manage.create 返回 id', () => assert(tMgr1.id && tMgr1.action === 'create'))
  const tMgr1Get = await handlers['notes-get']({ id: tMgr1.id })
  await t('manage.create 的笔记可 get', () => assert.strictEqual(tMgr1Get.note.title, 'mgr-A'))
  const tMgrList = await noteManage.execute({ action: 'list', tag: 'arc' })
  await t('manage.list 按 tag 过滤', () => {
    assert(tMgrList.action === 'list' && Array.isArray(tMgrList.notes))
  })
  const tMgrUpd = await noteManage.execute({ id: tMgr1.id, action: 'update', topic: '设计-改' })
  await t('manage.update topic 并入 tags 且清空（0.4.8 主题并入标签·懒合并；create 的 设计 + update 的 设计-改 双双入 tags）', async () => {
    assert.strictEqual(tMgrUpd.action, 'update')
    assert.strictEqual(tMgrUpd.topicMerged, true, '回执 topicMerged 标记（实得 ' + JSON.stringify(tMgrUpd) + '）')
    const g = await handlers['notes-get']({ id: tMgr1.id })
    assert.strictEqual(g.note.topic, '', 'topic 落盘清空（实得 ' + JSON.stringify(g.note.topic) + '）')
    assert.deepStrictEqual((g.note.tags || []).slice().sort(), ['设计', '设计-改'], 'create/update 显式 topic 均并入 tags（去重保序；实得 ' + JSON.stringify(g.note.tags) + '）')
  })
  const tMgrDel = await noteManage.execute({ id: tMgr1.id, action: 'delete' })
  await t('manage.delete 软删除', async () => {
    assert.strictEqual(tMgrDel.action, 'delete')
    const lst = await handlers['notes-list']({})
    assert(!lst.notes.find(n => n.id === tMgr1.id))
  })
  const tMgrRes = await noteManage.execute({ id: tMgr1.id, action: 'restore' })
  await t('manage.restore 恢复', async () => {
    assert.strictEqual(tMgrRes.action, 'restore')
    const lst = await handlers['notes-list']({})
    assert(lst.notes.find(n => n.id === tMgr1.id))
  })
  const tMgrArc = await noteManage.execute({ action: 'archive' })
  await t('manage.archive 无 groups：只合速记组，返回 merged 计数', () => {
    assert.strictEqual(tMgrArc.action, 'archive')
    assert.strictEqual(typeof tMgrArc.merged, 'number')
    assert(Array.isArray(tMgrArc.groups), '返回 groups（undo 事务同源字段）')
  })
  // 显式白名单：note_manage archive 传 groups 合并手动笔记（行为变更后手动合并的唯一入口）+ title 覆盖
  const tMgrArcG = await noteManage.execute({ action: 'archive', groups: [{ memberIds: [m1.id, m2.id], title: '手动归档X' }] })
  await t('manage.archive 显式 groups 合并手动组（白名单 + title 覆盖）', async () => {
    assert.strictEqual(tMgrArcG.action, 'archive')
    assert.strictEqual(tMgrArcG.merged, 1, 'merged=1（实得 ' + JSON.stringify(tMgrArcG) + '）')
    assert(tMgrArcG.groups && tMgrArcG.groups.length === 1 && tMgrArcG.groups[0].noteId, '返回 groups:[{ noteId, memberIds }]')
    const g = await handlers['notes-get']({ id: tMgrArcG.groups[0].noteId })
    assert.strictEqual(g.note.title, '手动归档X', 'title 覆盖默认标题')
    assert.deepStrictEqual(g.note.mergedFrom, [m1.id, m2.id], 'mergedFrom = 白名单成员')
    const lst = await handlers['notes-list']({})
    assert(!lst.notes.find(n => n.id === m1.id) && !lst.notes.find(n => n.id === m2.id), '手动成员已合并隐藏')
  })
  const tMgrArcBad = await noteManage.execute({ action: 'archive', groups: [{ memberIds: [m1.id] }] })
  await t('manage.archive groups 校验失败返回 error（m1 已归档不存在于活跃库）', () => {
    assert(tMgrArcBad.error, '单成员组须报错（实得 ' + JSON.stringify(tMgrArcBad) + '）')
  })
  const tMgrBad = await noteManage.execute({ action: 'nonexistent' })
  await t('manage 未知 action 返回错误', () => {
    assert(tMgrBad.error && tMgrBad.error.indexOf('未知 action') >= 0)
  })
  const tMgrNoId = await noteManage.execute({ action: 'delete' })
  await t('manage.delete 缺 id 返回错误', () => {
    assert(tMgrNoId.error && tMgrNoId.error.indexOf('需要 id') >= 0)
  })
  const tMgrCreateNoBody = await noteManage.execute({ action: 'create', title: 'no-body' })
  await t('manage.create 缺 body 返回错误', () => {
    assert(tMgrCreateNoBody.error && tMgrCreateNoBody.error.indexOf('需要 title 和 body') >= 0)
  })
  Object.assign(S, { noteManage })
  }
}
