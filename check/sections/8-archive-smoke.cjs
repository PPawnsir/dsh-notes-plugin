// 节 8. 显式归档：行为变更冒烟（手动笔记不再自动分组）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "8",
  title: "8. 显式归档：行为变更冒烟（手动笔记不再自动分组）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, g, handlers, store } = S
  // ===== 8. 显式归档（重构）：共享实例冒烟 =====
  section('8. 显式归档：行为变更冒烟（手动笔记不再自动分组）')
  // 行为变更：旧版按 manual:<tags排序串> 自动分组手动笔记（漏合/过合两类失败的根因），现已删除；
  // 无 groups 参数的 notes-archive 只自动合并速记组（tags 含 quick 按 sessionId，≥2 条）；
  // 手动笔记合并只能由调用方显式传 groups 白名单（见 8.5 全行为矩阵）。
  const m1 = await handlers['notes-create']({ title: 'M1', body: 'b1', tags: ['arc'], topic: '其他' })
  const m2 = await handlers['notes-create']({ title: 'M2', body: 'b2', tags: ['arc'], topic: '其他' })
  const writesBeforePv = io.writes
  const pv0 = await handlers['notes-archive-preview']({})
  await t('preview（dry-run）：零写入 + 手动笔记不进速记组', () => {
    assert.strictEqual(io.writes, writesBeforePv, 'preview 零写入（写入增量 ' + (io.writes - writesBeforePv) + '）')
    assert(Array.isArray(pv0.quickGroups), 'preview 返回 { quickGroups } 结构')
    for (const g of pv0.quickGroups) for (const mm of g.members) {
      assert(mm.id !== m1.id && mm.id !== m2.id, '手动笔记不得出现在 preview 速记组')
    }
    assert(!store.has(NOTES_DIR + '\\.archive-undo.json'), 'preview 不写 undo 事务文件')
  })
  const ar0 = await handlers['notes-archive']({})
  await t('无 groups 归档：只合速记组（本库速记均单条 → merged=0），手动笔记不动', () => {
    assert.strictEqual(ar0.merged, 0, '无可合速记组 → merged=0（实得 ' + JSON.stringify(ar0) + '）')
    assert.deepStrictEqual(ar0.groups, [], '空归档返回 groups=[]（undo 事务同源字段）')
  })
  const afterArc0 = await handlers['notes-list']({})
  await t('手动笔记仍在列表（行为变更：不再按标签自动分组）', () => assert(afterArc0.notes.find(n => n.id === m1.id) && afterArc0.notes.find(n => n.id === m2.id)))
  await t('空归档零副作用：不写 .bak / 不覆盖 undo 文件', () => {
    assert(!store.has(NOTES_DIR + '\\' + m1.id + '.md.bak') && !store.has(NOTES_DIR + '\\' + m2.id + '.md.bak'), '未合并不产生 .bak')
    assert(!store.has(NOTES_DIR + '\\.archive-undo.json'), '空归档不写 undo 文件（保留上一次撤销能力）')
  })
  await t('双侧归档源码同步：preview/参数化/undo 齐备 + 旧手动分组已删除 + 行为变更写进工具描述', () => {
    for (const pair of [[hostSrc, 'host-impl.js'], [indexSrc, 'index.mjs']]) {
      const src = pair[0], label = pair[1]
      assert(src.indexOf('async function _archivePreview()') >= 0, label + ' 缺 _archivePreview')
      assert(src.indexOf('async function _archiveUndo()') >= 0, label + ' 缺 _archiveUndo')
      assert(src.indexOf("handle('notes-archive-preview'") >= 0, label + ' 未注册 notes-archive-preview RPC')
      assert(src.indexOf("handle('notes-archive-undo'") >= 0, label + ' 未注册 notes-archive-undo RPC')
      assert(src.indexOf('.archive-undo.json') >= 0, label + ' 缺 undo 事务文件路径')
      assert(src.indexOf("'manual:'") < 0, label + ' 旧 manual:<tags> 自动分组逻辑必须已删除')
      assert(src.indexOf('NEVER auto-grouped by tag') >= 0, label + ' note_manage 工具描述须写明行为变更（手动笔记不再按标签自动分组）')
      assert(src.indexOf('memberIds') >= 0, label + ' notes-archive 参数化 groups 白名单（memberIds）')
    }
  })
  Object.assign(S, { m1, m2 })
  }
}
