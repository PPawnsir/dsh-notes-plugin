// 节 22.5 笔记目录索引注入（静态包 index.mjs 行为）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "22.5",
  title: "22.5 笔记目录索引注入（静态包 index.mjs 行为）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_ROOT_STATIC, admMock, agentsMock, ctx, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // --- 静态包行为（独立 ESM 实例 + 独立 store；harness 缺席 → webServer 路由 + ctx.tools） ---
  section('22.5 笔记目录索引注入（静态包 index.mjs 行为）')
  const store5 = new Map()
  const fsMock5 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (store5.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store5.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store5.has(p)) throw new Error('ENOENT: ' + p); return store5.get(p) },
    writeText: async (p, c) => { store5.set(p, c) },
  }
  const routes5 = []
  const tools5b = []
  const contexts5 = []
  const ctx5 = {
    fs: fsMock5,
    sandboxPolicy: { resolve: () => ({}) },
    webServer: { register: (r) => { routes5.push(r); return () => {} } },
    tools: { register: (d) => { tools5b.push(d); return () => {} } },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts5.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  const modCat = await import(pathToFileURL(INDEX_PATH).href + '?catalog=1')
  modCat.apply(ctx5)
  function rpc5(method, args) {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify({ method: method, args: args }))
      const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
      const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
      Promise.resolve(routes5[0].handler(req, res)).catch(reject)
    })
  }
  const catCtx5 = contexts5.find(x => x.name === 'notes:catalog')
  await t('静态包注册 notes:catalog order 131（无迁移干扰的干净库）', () => {
    assert.strictEqual(contexts5.length, 2, '静态包注册 2 个 context')
    assert.strictEqual(contexts5[0].order, 130, '约定注入 order=130')
    assert.strictEqual(catCtx5 && catCtx5.order, 131, '目录注入 order=131')
    assert.strictEqual(catCtx5.text(), '', '空库目录为空串')
  })
  await t('静态包目录行为：create 进目录 / recall=false 排除 / update 可改', async () => {
    const c = await rpc5('notes-create', { title: '静态目录笔记', body: 'x', topic: '开发' })
    assert(c.body.id, 'notes-create 成功')
    let txt = catCtx5.text()
    assert(txt.indexOf('- [' + c.body.id + '] 静态目录笔记 (笔记, 开发)') >= 0, '新建笔记进目录（实得：' + txt + '）')
    const tMgr5 = tools5b.find(x => x.name === 'note_manage')
    const c2 = await tMgr5.execute({ action: 'create', title: '静态recall关', body: 'x', recall: false })
    assert(c2.id && !c2.error, '工具 create recall=false 成功')
    assert(catCtx5.text().indexOf('静态recall关') < 0, 'recall=false 不进目录')
    const u = await tMgr5.execute({ action: 'update', id: c.body.id, recall: false })
    assert(!u.error, '工具 update recall=false 成功')
    assert(catCtx5.text().indexOf('静态目录笔记') < 0, 'update recall=false 后出目录')
    const onDisk = store5.get(path.join(NOTES_ROOT_STATIC, c.body.id + '.md'))
    assert(onDisk.indexOf('\nrecall: false\n') >= 0, '静态包磁盘 front-matter 同步 recall: false')
    await tMgr5.execute({ action: 'update', id: c.body.id, recall: true })
    assert(catCtx5.text().indexOf('静态目录笔记') >= 0, 'recall 改回 true 后回目录')
  })
  await t('静态包 catalogEnabled 总开关（notes-settings-set 经 webServer 路由）', async () => {
    const off = await rpc5('notes-settings-set', { catalogEnabled: false })
    assert(off.body.ok === true, '关闭成功（实得 ' + JSON.stringify(off.body) + '）')
    assert.strictEqual(catCtx5.text(), '', '关闭后目录为空')
    const onDisk = JSON.parse(store5.get(path.join(NOTES_ROOT_STATIC, 'settings.json')))
    assert.strictEqual(onDisk.catalogEnabled, false, 'settings.json 落盘 catalogEnabled:false')
    const sg = await rpc5('notes-settings-get', {})
    assert.strictEqual(sg.body.settings.catalogEnabled, false, 'settings-get 回读一致')
    const bad = await rpc5('notes-settings-set', { catalogEnabled: 1 })
    assert(bad.body.error && bad.body.error.indexOf('catalogEnabled') >= 0, '非布尔值报错')
    await rpc5('notes-settings-set', { catalogEnabled: null })
    const sg2 = await rpc5('notes-settings-get', {})
    assert(!('catalogEnabled' in sg2.body.settings), 'null 删除 override（恢复缺省开）')
    assert(catCtx5.text().length > 0, '恢复默认开后目录回来')
  })
  }
}
