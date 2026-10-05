// 节 8.5 显式归档行为矩阵（独立实例）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "8.5",
  title: "8.5 显式归档行为矩阵（独立实例）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, admMock, agentsMock, g, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // ===== 8.5 显式归档全行为矩阵（独立实例：preview 分组规则 / 参数化白名单 / title 覆盖 / 校验 / undo 往返） =====
  section('8.5 显式归档行为矩阵（独立实例）')
  const store9 = new Map()
  let writes9 = 0
  const fsMock9 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store9.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store9.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store9.has(p)) throw new Error('ENOENT: ' + p); return store9.get(p) },
    writeText: async (p, c) => { writes9++; store9.set(p, c) },
  }
  const handlers9 = {}
  const harnessMock9 = { handle: (name, fn) => { handlers9[name] = fn; return () => { delete handlers9[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock9, DIR).apply({
    fs: fsMock9, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  // 造库：直写 store 控 updatedAt 确定性——速记 sess-arch-1 两条（可合）+ sess-arch-2 单条（<2 不合）+ 已删速记一条（不进组）+ 手动同标签两条
  const UNDO_PATH9 = NOTES_DIR + '\\.archive-undo.json'
  function seedNote9(id, fm, body) { store9.set(NOTES_DIR + '\\' + id + '.md', '---\n' + fm + '\n---\n\n' + body) }
  seedNote9('n-qk01', 'id: n-qk01\ntitle: 速记甲\ntopic: 开发\ntags: quick\nsessionId: sess-arch-1\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"', '速记一正文\n')
  seedNote9('n-qk02', 'id: n-qk02\ntitle: 速记乙\ntopic: 运维\ntags: quick\nsessionId: sess-arch-1\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"', '速记二正文\n')
  seedNote9('n-qk03', 'id: n-qk03\ntitle: 速记丙\ntopic: 设计\ntags: quick\nsessionId: sess-arch-2\ncreatedAt: "2026-01-03T00:00:00.000Z"\nupdatedAt: "2026-01-03T00:00:00.000Z"', '速记三正文\n')
  seedNote9('n-qkdel', 'id: n-qkdel\ntitle: 已删速记\ntopic: 其他\ntags: quick\nsessionId: sess-arch-1\ndeleted: true\ncreatedAt: "2026-01-01T12:00:00.000Z"\nupdatedAt: "2026-01-01T12:00:00.000Z"', '已删正文\n')
  const mm1 = await handlers9['notes-create']({ title: '手动甲', body: '手动正文一', tags: ['arc9'], topic: '其他' })
  const mm2 = await handlers9['notes-create']({ title: '手动乙', body: '手动正文二', tags: ['arc9'], topic: '其他' })

  await t('preview：速记按 sessionId 分组（≥2），手动/单条/已删不进组，dry-run 零写入', async () => {
    // 0.4.3 验收修复⑪：idxEnsure 冷缓存水化闸门使启动索引创建链多一跳 _list——零写入窗口前先等启动写沉降
    //   （settings.json 落盘 = idxEnsure 链尾写；轮询确定性等待，不靠裸 sleep 碰运气）
    for (let i = 0; i < 40 && !store9.has(NOTES_DIR + '\\settings.json'); i++) { await new Promise(r => setTimeout(r, 25)) }
    const w0 = writes9
    const pv = await handlers9['notes-archive-preview']({})
    assert.strictEqual(writes9, w0, 'preview 零写入（写入增量 ' + (writes9 - w0) + '）')
    assert(!store9.has(UNDO_PATH9), 'preview 不写 undo 文件')
    assert(Array.isArray(pv.quickGroups) && pv.quickGroups.length === 1, '仅 1 个可合速记组（实得 ' + JSON.stringify(pv.quickGroups).slice(0, 200) + '）')
    const g = pv.quickGroups[0]
    assert.strictEqual(g.sessionId, 'sess-arch-1', '按 sessionId 分组')
    assert.deepStrictEqual(g.members.map(m => m.id), ['n-qk01', 'n-qk02'], '组内 updatedAt 升序；已删速记/单条速记（<2）不进组')
    assert.strictEqual(g.title, '运维', '组标题沿用现规则 last.topic（实得 ' + g.title + '）')
    assert.deepStrictEqual(g.dateSpan, { from: '2026-01-01', to: '2026-01-02' }, 'dateSpan = 首尾成员日期')
    // parseFM 节 77 起吃掉闭合 '---' 后全部前导换行（分隔符空行不属正文语义）：body 不带前导 '\n'（canonical 口径）
    const eb1 = Buffer.byteLength('速记一正文\n', 'utf8'), eb2 = Buffer.byteLength('速记二正文\n', 'utf8')
    assert.strictEqual(g.members[0].bodyBytes, eb1, 'members[].bodyBytes = UTF-8 字节数')
    assert.strictEqual(g.totalBytes, eb1 + eb2, 'totalBytes = 成员字节求和')
    for (const grp of pv.quickGroups) for (const m of grp.members) {
      assert(m.id !== mm1.id && m.id !== mm2.id, '手动笔记不返回（由 client 多选构造组）')
    }
  })

  let arcNote1 = null
  await t('无 groups 归档：只合速记组 + 默认标题 + .bak 备份 + undo 事务落盘', async () => {
    const ar = await handlers9['notes-archive']({})
    assert.strictEqual(ar.merged, 1, 'merged=1（实得 ' + JSON.stringify(ar) + '）')
    assert.strictEqual(ar.groups.length, 1, 'groups 事务结构返回')
    assert.deepStrictEqual(ar.groups[0].memberIds, ['n-qk01', 'n-qk02'], '事务成员 = 组内升序成员')
    assert.strictEqual(ar.mergedIds[0], ar.groups[0].noteId, 'mergedIds 兼容旧返回结构')
    arcNote1 = ar.groups[0].noteId
    const l = await handlers9['notes-list']({})
    assert(!l.notes.find(n => n.id === 'n-qk01') && !l.notes.find(n => n.id === 'n-qk02'), '速记原文已隐藏（软删除）')
    assert(l.notes.find(n => n.id === mm1.id) && l.notes.find(n => n.id === mm2.id), '手动笔记不动（行为变更：无参不合手动组）')
    assert(l.notes.find(n => n.id === 'n-qk03'), '单条速记（<2）不合')
    const g = await handlers9['notes-get']({ id: arcNote1 })
    assert.strictEqual(g.note.title, '运维', '默认标题 = last.topic')
    assert.deepStrictEqual(g.note.mergedFrom, ['n-qk01', 'n-qk02'], 'mergedFrom 记录成员')
    assert(g.note.archivedAt, 'archivedAt 落盘')
    assert(g.note.body.indexOf('## 2026-01-01') >= 0 && g.note.body.indexOf('速记一正文') >= 0 && g.note.body.indexOf('## 2026-01-02') >= 0 && g.note.body.indexOf('速记二正文') >= 0, '正文按 updatedAt 日期分节升序拼接')
    assert(store9.has(NOTES_DIR + '\\n-qk01.md.bak') && store9.has(NOTES_DIR + '\\n-qk02.md.bak'), '.bak 备份机制保留不动')
    const tx = JSON.parse(store9.get(UNDO_PATH9))
    assert(tx.groups && tx.groups.length === 1 && tx.groups[0].noteId === arcNote1 && tx.at, 'undo 事务落盘 { at, groups }（只保留最近一次）')
  })

  await t('undo 往返：成员批量还原 + 归档笔记软删 + undo 清空；二次 undo → undone=0', async () => {
    const ud = await handlers9['notes-archive-undo']({})
    assert.strictEqual(ud.undone, 1, 'undone=1（实得 ' + JSON.stringify(ud) + '）')
    assert.strictEqual(ud.restored, 2, '2 条成员还原')
    const l = await handlers9['notes-list']({})
    assert(l.notes.find(n => n.id === 'n-qk01') && l.notes.find(n => n.id === 'n-qk02'), '成员 restore（deleted=false）')
    assert(!l.notes.find(n => n.id === arcNote1), '归档笔记软删除（列表隐藏）')
    assert(store9.get(NOTES_DIR + '\\' + arcNote1 + '.md').indexOf('deleted: true') >= 0, '归档笔记 deleted:true 落盘（可再 restore 捞回）')
    const tx = JSON.parse(store9.get(UNDO_PATH9))
    assert(tx.groups.length === 0, 'undo 成功后清空事务（groups: []）')
    const ud2 = await handlers9['notes-archive-undo']({})
    assert.strictEqual(ud2.undone, 0, '无可撤销 → { undone: 0 }')
  })

  await t('参数化校验：单成员/重复/不存在 整体报错不动手（无半归档）', async () => {
    const bakBefore = Array.from(store9.keys()).filter(k => k.endsWith('.bak')).length
    const listBefore = (await handlers9['notes-list']({})).notes.length
    const e1 = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id] }] })
    assert(e1.error && e1.error.indexOf('至少 2 条') >= 0, '单成员组拒绝（实得 ' + JSON.stringify(e1) + '）')
    const e2 = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id, mm1.id] }] })
    assert(e2.error && e2.error.indexOf('重复') >= 0, '组内重复拒绝')
    const e3 = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id, 'n-no-such'] }] })
    assert(e3.error && e3.error.indexOf('不存在或已删除') >= 0, '不存在成员拒绝')
    const e4 = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id, mm2.id] }, { memberIds: [mm2.id, 'n-qk01'] }] })
    assert(e4.error && e4.error.indexOf('重复') >= 0, '跨组重复拒绝')
    assert.strictEqual((await handlers9['notes-list']({})).notes.length, listBefore, '校验失败零副作用')
    assert.strictEqual(Array.from(store9.keys()).filter(k => k.endsWith('.bak')).length, bakBefore, '校验失败不写 .bak')
  })

  await t('参数化白名单：多组一次归档 + title 覆盖 + undo 只保留最近一次（整次撤销）', async () => {
    const ar = await handlers9['notes-archive']({ groups: [{ memberIds: [mm1.id, mm2.id], title: '运维归档总集' }, { memberIds: ['n-qk01', 'n-qk02'] }] })
    assert(!ar.error, '归档成功（实得 ' + JSON.stringify(ar) + '）')
    assert.strictEqual(ar.merged, 2, '白名单两组一次合并')
    const g1 = await handlers9['notes-get']({ id: ar.groups[0].noteId })
    assert.strictEqual(g1.note.title, '运维归档总集', 'title 覆盖默认标题')
    assert.deepStrictEqual(g1.note.mergedFrom, [mm1.id, mm2.id], '手动组 mergedFrom = 白名单成员')
    const g2 = await handlers9['notes-get']({ id: ar.groups[1].noteId })
    assert.strictEqual(g2.note.title, '运维', '未传 title 走默认（last.topic）')
    const l = await handlers9['notes-list']({})
    assert(!l.notes.find(n => n.id === mm1.id) && !l.notes.find(n => n.id === mm2.id), '手动白名单成员已合并隐藏')
    const tx = JSON.parse(store9.get(UNDO_PATH9))
    assert.strictEqual(tx.groups.length, 2, 'undo 事务整体覆盖为本次归档')
    const ud = await handlers9['notes-archive-undo']({})
    assert(ud.undone === 2 && ud.restored === 4, '整次撤销：2 组 4 成员（实得 ' + JSON.stringify(ud) + '）')
    const l2 = await handlers9['notes-list']({})
    assert(l2.notes.find(n => n.id === mm1.id) && l2.notes.find(n => n.id === mm2.id) && l2.notes.find(n => n.id === 'n-qk01') && l2.notes.find(n => n.id === 'n-qk02'), '全部成员还原')
    assert(!l2.notes.find(n => n.id === ar.groups[0].noteId) && !l2.notes.find(n => n.id === ar.groups[1].noteId), '两条归档笔记软删')
  })
  }
}
