// 节 22. 笔记目录索引注入（recall 通道，host 双侧同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "22",
  title: "22. 笔记目录索引注入（recall 通道，host 双侧同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, admMock, agentsMock, ctx, g, handlers, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // ===== 22. 笔记目录索引注入（notes:catalog order 131 + recall 字段 + catalogEnabled 总开关） =====
  section('22. 笔记目录索引注入（recall 通道，host 双侧同步）')

  // --- 源码结构断言（开发版 host-impl + 静态包 index.mjs 同步） ---
  await t('双侧注册 notes:catalog order 131 + catalogText + 40 封顶 + 文案', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("name: 'notes:catalog'") >= 0 && /order:\s*131/.test(src), label + ' 注册 notes:catalog order 131')
      assert(src.indexOf('function catalogText(sidOverride)') >= 0, label + ' catalogText 生成函数存在（sidOverride 为注入预览形参，缺省行为不变）')
      assert(/CATALOG_LIMIT\s*=\s*40/.test(src), label + ' CATALOG_LIMIT=40 封顶')
      assert(src.indexOf("settingsCache.catalogEnabled === false") >= 0, label + ' catalogEnabled 总开关门（默认开）')
      assert(src.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') >= 0, label + ' 目录标题行文案')
      assert(src.indexOf('规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') >= 0, label + ' 末尾轻推行文案')
      assert(src.indexOf('…另有 ') >= 0 && src.indexOf('条较早笔记，用 note_search 检索') >= 0, label + ' 溢出提示行文案')
      assert(src.indexOf('function conventionHit(n, ws, curSid)') >= 0, label + ' conventionHit 共用命中判定（约定注入与目录去重）')
      assert(src.indexOf("n.status === 'resolved' || n.status === 'superseded'") >= 0, label + ' 排除 resolved/superseded')
      assert(src.indexOf('n.recall === false') >= 0, label + ' 排除 recall=false')
      assert(src.indexOf('conventionHit(n, ws, curSid)') >= 0, label + ' 目录与约定注入去重')
    }
  })
  await t('双侧 recall 字段链路（buildFM / noteFromParsed / persistNote / slim / _update / 工具 schema）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(/'recall: ' \+ escYaml\(m\.recall === false \? 'false' : 'true'\)/.test(src), label + ' buildFM 写 recall 行')
      assert(src.indexOf("recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : (p.meta.kind === 'log' ? false : true)),") >= 0, label + ' noteFromParsed 读 recall（缺省 true；工作记忆 v0：kind=log 缺省 false，显式 true 豁免）')
      assert((src.match(/recall: n\.recall !== false/g) || []).length >= 2, label + ' persistNote 与 slim 均带 recall')
      assert(/if \(recall !== undefined\) note\.recall = recall !== false/.test(src), label + ' _update 显式传 recall 才改（undefined 不动）')
      assert(/recall: \{ type: 'boolean'/.test(src), label + ' note_manage schema 含 recall 参数')
      assert(src.indexOf("handle('notes-settings-set'") >= 0 && src.indexOf('catalogEnabled') >= 0, label + ' notes-settings-set 支持 catalogEnabled')
    }
  })

  // --- 行为断言（开发版 host-impl，全新实例：独立 store/handlers/contexts，计数确定） ---
  const store3 = new Map()
  const fsMock3 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store3.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store3.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store3.has(p)) throw new Error('ENOENT: ' + p); return store3.get(p) },
    writeText: async (p, c) => { store3.set(p, c) },
  }
  const handlers3 = {}
  const tools3 = []
  const harnessMock3 = {
    handle: (name, fn) => { handlers3[name] = fn; return () => { delete handlers3[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { tools3.push(def); return () => {} },
  }
  const contexts3 = []
  const ctx3 = {
    fs: fsMock3, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts3.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock3, DIR).apply(ctx3)
  const catCtx3 = contexts3.find(x => x.name === 'notes:catalog')
  const tMgr3 = tools3.find(x => x.name === 'note_manage')

  await t('notes:catalog context 注册（order 131 紧邻约定注入 130 之后，开发版）', () => {
    assert.strictEqual(contexts3.length, 2, '注册 2 个 systemPrompt context')
    assert.strictEqual(contexts3[0].name, 'notes:workspace-conventions')
    assert.strictEqual(contexts3[0].order, 130, '约定注入 order=130')
    assert.strictEqual(contexts3[1].name, 'notes:catalog')
    assert.strictEqual(contexts3[1].order, 131, '目录注入 order=131')
    assert(typeof catCtx3.text === 'function', 'text 是函数')
  })
  await t('空库目录文本为空串（不注入，绝不返回 undefined）', () => {
    assert.strictEqual(catCtx3.text(), '', '空库返回空串')
  })

  // 造数据：本区笔记 / 跨区笔记 / pinned 待办 / resolved / 约定 inject=true / recall=false
  const cn1 = await handlers3['notes-create']({ title: '目录笔记甲', body: '甲正文', topic: '开发' })
  // updatedAt 为毫秒级 ISO 时间戳：两条创建若落在同一毫秒内，降序断言会因并列序而退化为不稳定（间歇性失败）
  await new Promise(r => setTimeout(r, 2))
  await tMgr3.execute({ action: 'create', title: '目录笔记乙', body: '乙正文', topic: '设计', workspace: 'other-ws' })
  await tMgr3.execute({ action: 'create', title: '目录待办置顶', body: 'x', kind: 'todo', status: 'pinned', topic: '运维' })
  await tMgr3.execute({ action: 'create', title: '已解决笔记', body: 'x', status: 'resolved' })
  await tMgr3.execute({ action: 'create', title: '已被取代笔记', body: 'x', status: 'superseded' })
  await handlers3['notes-create']({ title: '本区约定不入目录', body: '约定全文已注入', inject: true, topic: '约定' })
  const cn6 = await tMgr3.execute({ action: 'create', title: 'recall关闭笔记', body: 'x', recall: false })

  await t('目录标题行 + 一行一条格式 + 末尾轻推行', () => {
    const txt = catCtx3.text()
    assert(txt.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') === 0, '标题行开头（实得：' + txt.slice(0, 80) + '）')
    assert(txt.indexOf('- [' + cn1.id + '] 目录笔记甲 (笔记, 开发)') >= 0, '行格式：- [id] 标题 (kind中文, topic)')
    assert(txt.indexOf('(待办, 运维)') >= 0, 'kind 中文映射（todo→待办）')
    assert(txt.indexOf('\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') > 0, '末尾轻推行')
  })
  await t('排序：pinned 优先 → updatedAt 降序；目录不再标注 ←工作区来源', () => {
    const txt = catCtx3.text()
    assert(txt.indexOf('目录待办置顶') >= 0 && txt.indexOf('目录待办置顶') < txt.indexOf('目录笔记甲'), 'pinned 排最前')
    const i1 = txt.indexOf('目录笔记甲'), i2 = txt.indexOf('目录笔记乙')
    assert(i1 >= 0 && i2 >= 0, '本区/跨区笔记都进目录（无工作区过滤）')
    assert(i2 < i1, 'updatedAt 降序（乙晚于甲创建，排在甲前）')
    assert(txt.indexOf('目录笔记乙 (笔记, 设计)') >= 0 && txt.indexOf('←') < 0, '行尾不再标注 ←工作区名')
    assert(txt.indexOf('目录笔记甲 (笔记, 开发)') >= 0, '行格式不变（- [id] 标题 (kind, topic)）')
  })
  await t('准入排除：resolved / superseded / recall=false / 约定去重', () => {
    const txt = catCtx3.text()
    assert(txt.indexOf('已解决笔记') < 0, 'resolved 不进目录')
    assert(txt.indexOf('已被取代笔记') < 0, 'superseded 不进目录')
    assert(txt.indexOf('recall关闭笔记') < 0, 'recall=false 不进目录')
    assert(txt.indexOf('本区约定不入目录') < 0, 'inject=true 且本会话命中的约定不进目录（order 130 已注入全文）')
    const conv = contexts3[0].text()
    assert(conv.indexOf('本区约定不入目录') >= 0 && conv.indexOf('约定全文已注入') >= 0, '约定全文确实在 order 130 注入（去重成立的前提）')
  })
  await t('recall 字段 front-matter 往返 + 缺省 true', async () => {
    const onDisk1 = store3.get(NOTES_DIR + '\\' + cn1.id + '.md')
    assert(onDisk1.indexOf('\nrecall: true\n') >= 0, '缺省写 recall: true')
    const onDisk6 = store3.get(NOTES_DIR + '\\' + cn6.id + '.md')
    assert(onDisk6.indexOf('\nrecall: false\n') >= 0, 'create recall=false 写 recall: false')
    const g = await handlers3['notes-get']({ id: cn1.id })
    assert.strictEqual(g.note.recall, true, 'notes-get 返回 recall=true（缺省）')
    assert.strictEqual(g.note.inject, false, 'recall 与 inject 正交（缺省 recall=true 不影响 inject）')
  })
  await t('note_manage update 可改 recall（false 出目录 / true 回目录）', async () => {
    const u1 = await tMgr3.execute({ action: 'update', id: cn1.id, recall: false })
    assert(!u1.error, 'update recall=false 成功')
    assert(catCtx3.text().indexOf('目录笔记甲') < 0, 'recall=false 后目录不含该笔记')
    const onDisk = store3.get(NOTES_DIR + '\\' + cn1.id + '.md')
    assert(onDisk.indexOf('\nrecall: false\n') >= 0, '磁盘 front-matter 同步为 recall: false')
    await tMgr3.execute({ action: 'update', id: cn1.id, recall: true })
    assert(catCtx3.text().indexOf('目录笔记甲') >= 0, 'recall 改回 true 后目录恢复')
  })
  await t('旧文件无 recall 字段缺省进目录（向后兼容）', async () => {
    const legacyId = 'n-legacy-recall'
    await fsMock3.writeText(NOTES_DIR + '\\' + legacyId + '.md', '---\nid: ' + legacyId + '\ntitle: 旧版无recall笔记\ntopic: 运维\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文\n')
    const g = await handlers3['notes-get']({ id: legacyId })   // 触发解析进 cache（catalogText 只读 cache）
    assert.strictEqual(g.note.recall, true, '旧文件解析缺省 recall=true')
    assert(catCtx3.text().indexOf('旧版无recall笔记') >= 0, '无 recall 字段的旧笔记缺省进目录')
  })
  await t('note_manage schema 含 recall 参数', () => {
    assert(tMgr3.parameters.properties.recall && tMgr3.parameters.properties.recall.type === 'boolean', 'recall boolean 参数存在')
  })
  await t('catalogEnabled 总开关：默认开 → 关即空 → settings.json 落盘 → 校验非布尔 → 重开恢复', async () => {
    assert(catCtx3.text().length > 0, '默认开：目录非空')
    const bad = await handlers3['notes-settings-set']({ catalogEnabled: 'yes' })
    assert(bad.error && bad.error.indexOf('catalogEnabled') >= 0, '非布尔值报错')
    assert(catCtx3.text().length > 0, '校验失败不影响开关状态')
    const off = await handlers3['notes-settings-set']({ catalogEnabled: false })
    assert(off.ok === true, '关闭成功（实得 ' + JSON.stringify(off) + '）')
    assert.strictEqual(catCtx3.text(), '', '关闭后目录文本为空')
    const onDisk = JSON.parse(store3.get(NOTES_DIR + '\\settings.json'))
    assert.strictEqual(onDisk.catalogEnabled, false, 'settings.json 含 catalogEnabled:false')
    const sg = await handlers3['notes-settings-get']({})
    assert.strictEqual(sg.settings.catalogEnabled, false, 'notes-settings-get 回读一致')
    assert(Array.isArray(sg.models) && sg.models.some(m => m.provider === 'p' && m.model === 'm'), 'settings-get 带 models 目录（llm 探针）')
    await handlers3['notes-settings-set']({ catalogEnabled: true })
    assert(catCtx3.text().length > 0, '重新打开后目录恢复')
  })

  // --- 40 条封顶（再开全新实例，计数确定） ---
  await t('40 条封顶 + 溢出提示行（…另有 N 条较早笔记）', async () => {
    const store4 = new Map()
    const fsMock4 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store4.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store4.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store4.has(p)) throw new Error('ENOENT: ' + p); return store4.get(p) },
      writeText: async (p, c) => { store4.set(p, c) },
    }
    const handlers4 = {}
    const contexts4 = []
    const harnessMock4 = { handle: (name, fn) => { handlers4[name] = fn; return () => {} }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock4, DIR).apply({
      fs: fsMock4, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ agents: agentsMock, systemPrompt: { context: (c) => { contexts4.push(c); return () => {} } } })[name],
      effect: () => {},
    })
    for (let i = 0; i < 45; i++) await handlers4['notes-create']({ title: '批量' + i, body: 'x' })
    const txt = contexts4.find(x => x.name === 'notes:catalog').text()
    const itemLines = txt.split('\n').filter(l => l.indexOf('- [n-') === 0)
    assert.strictEqual(itemLines.length, 40, '目录最多 40 条（实得 ' + itemLines.length + '）')
    assert(txt.indexOf('…另有 5 条较早笔记，用 note_search 检索') >= 0, '溢出提示行（实得尾部：' + txt.split('\n').slice(-2).join(' | ') + '）')
  })
  }
}
