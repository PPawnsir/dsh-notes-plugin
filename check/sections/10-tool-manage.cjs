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
  // ===== 10.5 note_manage.create 入口参数画像 + 精确分类 + DIAG 探针（note-create-diag，issue: note-manage-create-body-missing）=====
  // 背景：aa61f7c9 主 fork 会话持续报「需要 title 和 body」。插件入口只能证明「收到缺失/空值/类型错误」，
  //   上游（agent 出参 / Harness 序列化 / RPC 转发）是否丢参仍待原始失败请求取证——本节只锁插件边界可证事实，不预设根因。
  const { store, NOTES_DIR, llmMock, admMock, agentsMock, sessionPersistenceMock, workspaceRegistryMock, sessionTitleMock, sessionQueryMock } = S
  const DIAG_LOG = NOTES_DIR + '\\_note-create-diag.log'
  const listCount = async () => (await handlers['notes-list']({})).notes.length
  const SENTINEL_BODY = 'mf-meta-6139 正文哨兵'   // ⑥ 正文逐字一致哨兵
  const DIAG_SENTINEL = 'DIAG-TITLE-SENTINEL-6139'   // ⑦ title 哨兵：诊断行只可出现其 len，不可出现其正文
  const MF_SID = 'session-aa61f7c9-0e21-4080-b252-4b95ada9b7c4'   // ⑥ 主 fork 会话元数据原值

  // ① 正常链路（复用 tMgr1）：create → id → note_get 正文逐字一致
  await t('manage.create 正常链路：body 逐字落盘（note_get 回读一致）', async () => {
    const g1 = await handlers['notes-get']({ id: tMgr1.id })
    assert.strictEqual(g1.note.body, 'ma', '正文逐字一致（实得 ' + JSON.stringify(g1.note.body) + '）')
  })

  // ②-⑤ 边界矩阵：缺 body / 空串 body / 对象 body / 缺 title → 精确分类 + 零落盘
  const cntBefore = await listCount()
  const nbMiss = await noteManage.execute({ action: 'create', title: 'nb-miss' })
  const nbEmpty = await noteManage.execute({ action: 'create', title: 'nb-empty', body: '' })
  const nbObj = await noteManage.execute({ action: 'create', title: 'nb-obj', body: { text: 'x' } })
  const ntMiss = await noteManage.execute({ action: 'create', body: 'nt-miss-body' })
  await t('manage.create 缺 body → body:missing 精确分类 + 原错误前缀保留 + 零落盘', async () => {
    assert(nbMiss.error && nbMiss.error.indexOf('note_manage.create 需要 title 和 body') === 0, '原错误前缀保留（实得 ' + JSON.stringify(nbMiss.error) + '）')
    assert.strictEqual(nbMiss.reason, 'body:missing', 'reason 精确分类（实得 ' + JSON.stringify(nbMiss.reason) + '）')
    assert(nbMiss.details && nbMiss.details.body.state === 'missing' && nbMiss.details.body.type === 'undefined' && nbMiss.details.body.own === false, 'details.body 画像 missing/undefined/own=false（实得 ' + JSON.stringify(nbMiss.details) + '）')
    assert(nbMiss.details.title.state === 'ok' && nbMiss.details.title.type === 'string' && nbMiss.details.title.len === 'nb-miss'.length, 'details.title 画像 ok/string/len（只有长度没有正文）')
    assert.strictEqual(await listCount(), cntBefore, '零落盘：活跃列表计数不变')
  })
  await t('manage.create body 空串 → body:empty-string 精确分类 + 零落盘', async () => {
    assert.strictEqual(nbEmpty.reason, 'body:empty-string', 'reason（实得 ' + JSON.stringify(nbEmpty.reason) + '）')
    assert(nbEmpty.details.body.state === 'empty-string' && nbEmpty.details.body.type === 'string' && nbEmpty.details.body.len === 0, 'details.body 画像 empty-string/string/len=0（实得 ' + JSON.stringify(nbEmpty.details.body) + '）')
    assert.strictEqual(await listCount(), cntBefore, '零落盘：活跃列表计数不变')
  })
  await t('manage.create body 非字符串对象 → body:wrong-type 精确分类 + 零落盘', async () => {
    assert.strictEqual(nbObj.reason, 'body:wrong-type', 'reason（实得 ' + JSON.stringify(nbObj.reason) + '）')
    assert(nbObj.details.body.state === 'wrong-type' && nbObj.details.body.type === 'object', 'details.body 画像 wrong-type/object（实得 ' + JSON.stringify(nbObj.details.body) + '）')
    assert.strictEqual(await listCount(), cntBefore, '零落盘：活跃列表计数不变')
  })
  await t('manage.create 缺 title → title:missing 精确分类 + 原错误前缀保留 + 零落盘', async () => {
    assert(ntMiss.error && ntMiss.error.indexOf('note_manage.create 需要 title 和 body') === 0, '原错误前缀保留（实得 ' + JSON.stringify(ntMiss.error) + '）')
    assert.strictEqual(ntMiss.reason, 'title:missing', 'reason（实得 ' + JSON.stringify(ntMiss.reason) + '）')
    assert(ntMiss.details.title.state === 'missing' && ntMiss.details.title.own === false && ntMiss.details.body.state === 'ok' && ntMiss.details.body.len === 'nt-miss-body'.length, 'details 双键画像（实得 ' + JSON.stringify(ntMiss.details) + '）')
    assert.strictEqual(await listCount(), cntBefore, '零落盘：活跃列表计数不变')
  })
  // ⑥ 主 fork 元数据：sessionId/cwd 原值 + kind=log 仍创建成功且正文逐字一致（仅证元数据不影响插件 create，不冒充 goal/rebase/RPC 复现）。
  //   【实例隔离硬要求】kind=log 落 共享 S.store 会污染后续节（12 节注入目录段 logCount 尾行、74 节 weekLogs 近窗计数）——
  //   本用例走自建隔离实例（109 节同款姿势；节 10 先于 23 节跑，S.mkFsMockImp 尚未导出，故本地内联同形 fs mock）。
  const store6 = new Map()
  const fs6 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store6.has(p) ? { file: true } : null)),
    listDir: async (p) => { const prefix = p + '\\'; const out = []; for (const k of store6.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) }); return out },
    readText: async (p) => { if (!store6.has(p)) throw new Error('ENOENT: ' + p); return store6.get(p) },
    writeText: async (p, c) => { store6.set(p, c) },
  }
  const handlers6 = {}
  const tools6 = []
  const harness6 = {
    handle: (name, fn) => { handlers6[name] = fn; return () => { delete handlers6[name] } },
    defineTool: (d) => d,
    registerTool: (ctx2, d) => { tools6.push(d); return () => {} },
  }
  new Function('harness', 'pluginDir', hostSrc)(harness6, DIR).apply({
    fs: fs6, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const nm6 = tools6.find(x => x.name === 'note_manage')
  assert(nm6, '⑥ 隔离实例注册 note_manage')
  const mf = await nm6.execute({ action: 'create', title: '主fork元数据6139', body: SENTINEL_BODY, kind: 'log', inject: true, sessionId: MF_SID, cwd: 'D:\\Code\\ontology_ai' })
  await t('manage.create 主 fork 元数据（sessionId/cwd 原值 + kind=log）创建成功 + 正文逐字一致', async () => {
    assert(mf.id && mf.action === 'create' && !mf.error, '创建成功（实得 ' + JSON.stringify(mf).slice(0, 200) + '）')
    assert(mf.injectForcedOff === true, 'kind=log + inject:true 隐身硬闸告知（日志语义生效）')
    const g6 = await handlers6['notes-get']({ id: mf.id })
    assert.strictEqual(g6.note.body, SENTINEL_BODY, '正文逐字一致（实得 ' + JSON.stringify(g6.note.body) + '）')
    assert.strictEqual(g6.note.sessionId, MF_SID, 'sessionId 原值落盘')
    assert.strictEqual(g6.note.cwd, 'D:\\Code\\ontology_ai', 'cwd 原值落盘')
    assert.strictEqual(g6.note.kind, 'log', 'kind=log 落盘')
    assert.strictEqual(g6.note.inject, false, 'inject 被硬闸纠正为 false（kind=log 永不注入）')
    assert(store6.has(NOTES_DIR + '\\' + mf.id + '.md'), '隔离盘 .md 落盘（共享 S.store 零污染——不写 kind=log 进共享库）')
    assert(!store.has(NOTES_DIR + '\\' + mf.id + '.md'), '共享 store 无本笔记（隔离红线）')
  })

  // ⑦ DIAG 诊断行：轮询完成条件 + deadline（禁固定 sleep）；只可读出 keys/type/len/sessionIdType，绝不含 title 正文哨兵
  await t('note-create DIAG 诊断行：keys/type/len/sessionIdType 在位 + 不含 title 正文哨兵（轮询 deadline）', async () => {
    const linesBefore = String(store.get(DIAG_LOG) || '').split('\n').filter(l => l.trim())
    // 哨兵失败调用带 sessionId：键形 ['action','sessionId','title'] + sessionIdType:'string' 在既有失败行中唯一，可无歧义定位本行
    const r7 = await noteManage.execute({ action: 'create', title: DIAG_SENTINEL, sessionId: 'diag-session-6139' })
    assert(r7 && r7.error && r7.reason === 'body:missing', '哨兵失败调用返回错误（实得 ' + JSON.stringify(r7).slice(0, 160) + '）')
    const deadline = Date.now() + 2000
    let lines = linesBefore, raw = ''
    while (Date.now() < deadline) {
      lines = String(store.get(DIAG_LOG) || '').split('\n').filter(l => l.trim())
      raw = lines[lines.length - 1] || ''
      if (lines.length > linesBefore.length) { try { if (JSON.parse(raw).sessionIdType === 'string') break } catch (e) {} }
      await new Promise(r => setTimeout(r, 25))
    }
    assert(lines.length > linesBefore.length, '诊断行已落盘（轮询到新增行；' + lines.length + '/' + linesBefore.length + ' 行）')
    assert(raw.indexOf(DIAG_SENTINEL) < 0, '诊断行不含 title 正文（哨兵未泄露；实得行 ' + raw.slice(0, 120) + '）')
    const d7 = JSON.parse(raw)
    assert(d7.ev === 'create-args' && d7.action === 'create', 'ev/action 字段在位')
    assert.deepStrictEqual(d7.keys, ['action', 'sessionId', 'title'], 'keys = 排序后参数键清单（实得 ' + JSON.stringify(d7.keys) + '）')
    assert(d7.title && d7.title.state === 'ok' && d7.title.type === 'string' && d7.title.len === DIAG_SENTINEL.length && d7.title.own === true, 'title 画像：state/type/len/own（只有长度没有正文）')
    assert(d7.body && d7.body.state === 'missing' && d7.body.type === 'undefined' && d7.body.own === false, 'body 画像：missing/undefined/own=false')
    assert.strictEqual(d7.sessionIdType, 'string', 'sessionId 类型记录（不含值）')
    assert.strictEqual(d7.reason, 'body:missing', 'reason 分类随行')
  })
  Object.assign(S, { noteManage })
  }
}
