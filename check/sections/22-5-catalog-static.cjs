// 节 22.5 笔记目录段（静态包 index.mjs 行为；0.4.4-E 唯挂载行源——「目录段补充未挂载条目」整体移除）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "22.5",
  title: "22.5 笔记目录段（静态包 index.mjs 行为；0.4.4-E 唯挂载行源）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_ROOT_STATIC, admMock, agentsMock, ctx, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // --- 静态包行为（独立 ESM 实例 + 独立 store；harness 缺席 → webServer 路由 + ctx.tools） ---
  section('22.5 笔记目录段（静态包 index.mjs 行为；0.4.4-E 唯挂载行源）')
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
  const catCtx5 = contexts5.find(x => x.name === 'notes:workspace-conventions')   // 0.4.3③：目录段并入 order 130，单一 context
  const dirPart5 = (txt) => { const i = String(txt || '').indexOf('本地笔记库目录（'); return i < 0 ? '' : String(txt).slice(i) }
  await t('静态包注册单一 context order 130（目录段并入，order 131 撤销；无迁移干扰的干净库）', () => {
    assert.strictEqual(contexts5.length, 1, '静态包注册 1 个 context（目录段合并后 order 131 撤销）')
    assert.strictEqual(contexts5[0].order, 130, '约定注入 order=130')
    assert.strictEqual(contexts5[0].name, 'notes:workspace-conventions', '单一 context 名')
    assert.strictEqual(catCtx5.text(), '', '空库注入为空串（目录段整段空）')
  })
  await t('静态包目录段行为（0.4.4-E 唯挂载行源）：create 不进段 → 挂载行进段（§1 原样）→ recall dormant 读写不影响', async () => {
    const c = await rpc5('notes-create', { title: '静态目录笔记', body: 'x', topic: '开发' })
    assert(c.body.id, 'notes-create 成功')
    // 0.4.4-E：普通行装配已拆——库内有笔记目录段也为空（不再有 settings 开关可填充）
    assert.strictEqual(dirPart5(catCtx5.text()), '', '目录段整段为空（无挂载行；实得长度 ' + catCtx5.text().length + '）')
    // 挂载行进段（正向锚）
    const mt = await rpc5('notes-mount', { id: c.body.id, whenToUse: '静态包目录段断言' })
    assert(mt.body && mt.body.ok === true, 'notes-mount 成功（实得 ' + JSON.stringify(mt.body) + '）')
    const txt = dirPart5(catCtx5.text())
    assert(txt.indexOf('- [[' + c.body.id + ']] 何时查我：静态包目录段断言') >= 0, '挂载行（§1 原样）进目录段（实得：' + txt + '）')
    assert(txt.indexOf('（以上为挂载索引行：正文用 note_get <id> 获取）') >= 0, '挂载 note_get 引导行归属本段')
    // recall dormant：update recall=false/true 读写照常（字段保留），目录段行为与 recall 无关（消费方已拆）
    const tMgr5 = tools5b.find(x => x.name === 'note_manage')
    const u = await tMgr5.execute({ action: 'update', id: c.body.id, recall: false })
    assert(!u.error, '工具 update recall=false 成功')
    const onDisk = store5.get(path.join(NOTES_ROOT_STATIC, c.body.id + '.md'))
    assert(onDisk.indexOf('\nrecall: false\n') >= 0, '静态包磁盘 front-matter 同步 recall: false（dormant 读写兼容）')
    assert(dirPart5(catCtx5.text()).indexOf('- [[' + c.body.id + ']]') >= 0, 'recall=false 不影响挂载行（recall 已无目录消费方）')
    await tMgr5.execute({ action: 'update', id: c.body.id, recall: true })
    assert(dirPart5(catCtx5.text()).indexOf('- [[' + c.body.id + ']]') >= 0, 'recall 改回 true 挂载行仍在')
  })
  await t('静态包 settings-set 传 catalogEnabled 静默忽略（经 webServer 路由）：不报错不落盘不改行为', async () => {
    const before = catCtx5.text()
    const ig = await rpc5('notes-settings-set', { catalogEnabled: false })
    assert(ig.body && ig.body.ok === true && !ig.body.error, 'catalogEnabled:false 静默忽略（ok 不报错；实得 ' + JSON.stringify(ig.body) + '）')
    const ig2 = await rpc5('notes-settings-set', { catalogEnabled: 1 })
    assert(ig2.body && ig2.body.ok === true && !ig2.body.error, '非布尔值同样静默忽略（旧校验随分支拆除）')
    const ig3 = await rpc5('notes-settings-set', { catalogEnabled: null })
    assert(ig3.body && ig3.body.ok === true && !ig3.body.error, 'catalogEnabled:null 静默忽略')
    const sg = await rpc5('notes-settings-get', {})
    assert(!('catalogEnabled' in sg.body.settings), 'settings-get 无 catalogEnabled 键（干净库永不落键）')
    const onDisk = JSON.parse(store5.get(path.join(NOTES_ROOT_STATIC, 'settings.json')))
    assert(!('catalogEnabled' in onDisk), 'settings.json 不落 catalogEnabled')
    assert.strictEqual(catCtx5.text(), before, '注入文本不因 catalogEnabled 设置改变（唯挂载行源）')
  })
  }
}
