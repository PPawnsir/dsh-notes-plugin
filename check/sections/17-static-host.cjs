// 节 17. P2 静态包 host 全链路（ESM import + webServer RPC 路由）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "17",
  title: "17. P2 静态包 host 全链路（ESM import + webServer RPC 路由）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { admMock, agentsMock, ctx, g, handlers, liveAgent, llmMock, m1, m2, mkHarness, plugin, q1, q2, r1, r2, registeredTools, sentMessages, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // ===== 17. P2 静态包 host 全链路（ESM import + webServer RPC 路由 + tools） =====
  section('17. P2 静态包 host 全链路（ESM import + webServer RPC 路由）')
  const NOTES_ROOT_STATIC = path.join(osNative.homedir(), '.dsh', 'notes')
  const LEGACY_NOTES_STATIC = path.join('D:\\deepseek-work\\dsh-notes-plugin', 'notes')
  const store2 = new Map()
  const fsMock2 = {
    resolve: async (p) => p,
    stat: async (p) => ((p === NOTES_ROOT_STATIC || p === LEGACY_NOTES_STATIC) ? { dir: true } : (store2.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store2.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store2.has(p)) throw new Error('ENOENT: ' + p); return store2.get(p) },
    writeText: async (p, c) => { store2.set(p, c) },
  }
  // 迁移源：预置一条开发版笔记（apply 时应被复制到 ~/.dsh/notes，且原目录保留）
  const legacyIdP2 = 'n-legacy-p2'
  const legacySrcPath = path.join(LEGACY_NOTES_STATIC, legacyIdP2 + '.md')
  store2.set(legacySrcPath, '---\nid: ' + legacyIdP2 + '\ntitle: 迁移前旧笔记\ntopic: 调用约定\nworkspace: deepseek-work\nstatus: active\ninject: true\ncreatedAt: 2026-09-17T00:00:00.000Z\nupdatedAt: 2026-09-17T00:00:00.000Z\n---\n\n旧笔记正文\n')
  const routes2 = []
  const tools2 = []
  const contexts2 = []
  const evtListeners2 = {}   // P3 派发闭环：静态包 ctx.on 事件订阅捕获
  const ctx2 = {
    fs: fsMock2,
    sandboxPolicy: { resolve: () => ({}) },
    webServer: { register: (r) => { routes2.push(r); return () => {} } },
    tools: { register: (d) => { tools2.push(d); return () => {} } },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts2.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: (name, fn) => { (evtListeners2[name] = evtListeners2[name] || []).push(fn); return () => {} },
  }
  // 真实静态包环境没有动态沙箱的 harness Builtin —— 临时摘掉 mock 的 global.harness 还原真实条件
  const harnessBackup = global.harness
  delete global.harness
  let modIndex = null
  // --only 补偿（notes-check-split）：本节未被 --only 选中时补做 import/apply 副作用（断言体跳过不执行）
  if (H.state.ONLY_MODE && !H.state.currentSelected) {
    try { modIndex = await import(pathToFileURL(INDEX_PATH).href) } catch (eImp) { /* 非选中节静默；选中节由断言体报错 */ }
    if (modIndex) modIndex.apply(ctx2)
  }
  await t('index.mjs 可被 ESM import（语法 + 顶层无副作用）', async () => {
    modIndex = await import(pathToFileURL(INDEX_PATH).href)
    assert.strictEqual(modIndex.name, 'dsh-notes-plugin', 'name 导出')
    assert(Array.isArray(modIndex.inject) && modIndex.inject.indexOf('fs') >= 0 && modIndex.inject.indexOf('sandboxPolicy') >= 0, 'inject 含 fs/sandboxPolicy')
    assert(typeof modIndex.apply === 'function', 'apply 导出')
  })
  await t('harness 缺失时兜底：3 条 exact 路由（RPC + 全窗口页面 + 资产）+ ctx.tools 3 工具 + 约定注入 order130 + 目录注入 order131', () => {
    modIndex.apply(ctx2)
    assert.strictEqual(routes2.length, 3, '应注册 3 条路由（/dsh-notes RPC + /dsh-notes-app 页面 + /dsh-notes/asset 资产），实得 ' + routes2.length)
    assert.strictEqual(routes2[0].kind, 'exact', "路由 kind='exact'")
    assert.strictEqual(routes2[0].path, '/dsh-notes', "路由 path='/dsh-notes'")
    assert.strictEqual(typeof routes2[0].handler, 'function', 'handler 是函数')
    assert.strictEqual(routes2[1].kind, 'exact', "页面路由 kind='exact'")
    assert.strictEqual(routes2[1].path, '/dsh-notes-app', "页面路由 path='/dsh-notes-app'")
    assert.strictEqual(typeof routes2[1].handler, 'function', '页面 handler 是函数')
    assert.strictEqual(routes2[2].kind, 'exact', "资产路由 kind='exact'")
    assert.strictEqual(routes2[2].path, '/dsh-notes/asset', "资产路由 path='/dsh-notes/asset'")
    assert.strictEqual(typeof routes2[2].handler, 'function', '资产 handler 是函数')
    assert.deepStrictEqual(tools2.map(x => x.name).sort(), ['note_get', 'note_manage', 'note_search'], '注册 3 个工具')
    assert.strictEqual(contexts2.length, 2, '注册 2 个 systemPrompt context（约定 + 目录）')
    assert.strictEqual(contexts2[0].order, 130, '约定注入 order=130')
    assert.strictEqual(contexts2[1].name, 'notes:catalog', '目录注入 context 名')
    assert.strictEqual(contexts2[1].order, 131, '目录注入 order=131（紧邻约定注入之后）')
  })
  // 走真实 HTTP handler 形态调用 RPC（等价 client 侧 fetch POST /dsh-notes）
  function rpc2(method, args) {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify({ method: method, args: args }))
      const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
      const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
      Promise.resolve(routes2[0].handler(req, res)).catch(reject)
    })
  }
  // GET /dsh-notes-app 页面路由行为：真实读包内 app.html 返回 text/html；非 GET/HEAD 405
  function pageReq(method) {
    const headers = {}
    const res = { statusCode: 0, body: null, setHeader: (k, v) => { headers[String(k).toLowerCase()] = v }, writeHead: (c) => { res.statusCode = c }, end: (s) => { res.body = s } }
    return Promise.resolve(routes2[1].handler({ method: method }, res)).then(() => ({ status: res.statusCode, headers: headers, body: res.body }))
  }
  await t('GET /dsh-notes-app 返回 app.html（200 + text/html; charset=utf-8）', async () => {
    const r = await pageReq('GET')
    assert.strictEqual(r.status, 200, 'GET 应 200（实得 ' + r.status + '）')
    assert(String(r.headers['content-type'] || '').indexOf('text/html') === 0, "Content-Type 应以 text/html 开头（实得 " + r.headers['content-type'] + '）')
    assert(String(r.headers['cache-control'] || '').indexOf('no-store') >= 0, 'Cache-Control: no-store（每次读盘，开发期改页面免重启）')
    assert(r.body.indexOf('<title>dsh-notes</title>') >= 0, '页面 <title> 应为 dsh-notes')
    assert(r.body.indexOf("fetch('/dsh-notes'") >= 0, '页面应含 /dsh-notes RPC 数据层')
  })
  await t('POST /dsh-notes-app 返回 405（页面路由只服务 GET/HEAD）', async () => {
    const r = await pageReq('POST')
    assert.strictEqual(r.status, 405, 'POST 应 405（实得 ' + r.status + '）')
  })
  // GET /dsh-notes/asset 资产路由行为：真实走 handler（读盘经 ctx.fs → 内存 store2）
  const pngBytes2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const pngB64_2 = pngBytes2.toString('base64')
  function assetReq(method, url) {
    const headers = {}
    const res = { statusCode: 0, body: null, setHeader: (k, v) => { headers[String(k).toLowerCase()] = v }, writeHead: (c) => { res.statusCode = c }, end: (s) => { res.body = s === undefined ? null : s } }
    return Promise.resolve(routes2[2].handler({ method: method, url: url }, res)).then(() => ({ status: res.statusCode, headers: headers, body: res.body }))
  }
  const assetUp2 = await rpc2('notes-asset-upload', { name: '像素图.png', data: pngB64_2, mime: 'image/png' })
  await t('notes-asset-upload（静态包 RPC）：落盘 assets/<ts>-<安全名> 且内容为 base64 文本', () => {
    assert(!assetUp2.body.error, '上传成功（实得 ' + JSON.stringify(assetUp2.body) + '）')
    assert(/^assets\/\d{8}-\d{6}-.+\.png$/.test(assetUp2.body.file), '返回相对路径 assets/<ts>-<名>.png（实得 ' + assetUp2.body.file + '）')
    assert.strictEqual(assetUp2.body.bytes, pngBytes2.length, 'bytes = 解码后字节数')
    assert.strictEqual(store2.get(path.join(NOTES_ROOT_STATIC, 'assets', assetUp2.body.name)), pngB64_2, '磁盘内容为 base64 文本形态')
  })
  await t('GET /dsh-notes/asset 命中：200 + image/png + 解码回原始字节 + immutable 缓存', async () => {
    const r = await assetReq('GET', '/dsh-notes/asset?file=' + assetUp2.body.file)
    assert.strictEqual(r.status, 200, '实得 ' + r.status)
    assert.strictEqual(r.headers['content-type'], 'image/png', 'Content-Type 按扩展名白名单')
    assert.strictEqual(r.headers['cache-control'], 'public, max-age=31536000, immutable', 'immutable 长缓存')
    assert(Buffer.isBuffer(r.body) && r.body.equals(pngBytes2), '响应体 = base64 解码后的原始字节')
    assert.strictEqual(Number(r.headers['content-length']), pngBytes2.length, 'Content-Length 匹配')
  })
  await t('GET /dsh-notes/asset 防穿越/形态/白名单/404', async () => {
    for (const bad of ['assets/../secret.md', 'assets/../../x', 'assets', 'x.png', 'assets/sub/x.png', 'assets/%2e%2e/x.md', '/etc/passwd', 'assets/..']) {
      const r = await assetReq('GET', '/dsh-notes/asset?file=' + bad)
      assert(r.status === 400, '穿越/非法形态应 400：' + bad + '（实得 ' + r.status + '）')
    }
    const nf = await assetReq('GET', '/dsh-notes/asset?file=assets/20990101-000000-none.png')
    assert.strictEqual(nf.status, 404, '不存在 → 404')
    const badExt = await assetReq('GET', '/dsh-notes/asset?file=assets/x.svg')
    assert.strictEqual(badExt.status, 404, '扩展名白名单外 → 404')
    const h = await assetReq('HEAD', '/dsh-notes/asset?file=' + assetUp2.body.file)
    assert.strictEqual(h.status, 200, 'HEAD 200')
    assert(h.body === null || h.body === '', 'HEAD 空体')
    const p = await assetReq('POST', '/dsh-notes/asset?file=' + assetUp2.body.file)
    assert.strictEqual(p.status, 405, 'POST → 405')
  })
  const listP2 = await rpc2('notes-list', {})
  await t('RPC 200 + 首次启动迁移开发版笔记到 ~/.dsh/notes', () => {
    assert.strictEqual(listP2.status, 200, 'HTTP 200')
    const ids = listP2.body.notes.map(n => n.id)
    assert(ids.indexOf(legacyIdP2) >= 0, '迁移后的旧笔记应出现在列表（实得：' + JSON.stringify(ids) + '）')
    assert.strictEqual(listP2.body.notes.find(n => n.id === legacyIdP2).title, '迁移前旧笔记', '迁移保留标题')
    assert(store2.has(path.join(NOTES_ROOT_STATIC, legacyIdP2 + '.md')), '目标目录出现迁移副本')
    assert(store2.has(legacySrcPath), '迁移不删除开发版原目录')
  })
  const cr2 = await rpc2('notes-create', { title: '静态包笔记', body: '正文P2', tags: ['p2'], topic: '开发' })
  await t('notes-create 走静态包 RPC', () => assert(cr2.body.id, '返回 id（实得 ' + JSON.stringify(cr2.body) + '）'))
  const get2 = await rpc2('notes-get', { id: cr2.body.id })
  await t('notes-get 返回正文', () => assert.strictEqual(get2.body.note.body, '正文P2', 'body 原样'))
  await t('notes-update 生效', async () => {
    const up = await rpc2('notes-update', { id: cr2.body.id, topic: '运维' })
    assert.strictEqual(up.body.id, cr2.body.id, 'update 返回 id')
    const g = await rpc2('notes-get', { id: cr2.body.id })
    assert.strictEqual(g.body.note.topic, '运维', 'topic 更新为 运维')
  })
  await t('notes-quick 合并窗口 + 异步分类回填', async () => {
    const q1 = await rpc2('notes-quick', { text: '速记P2第一条', sessionId: 'sess-p2-1' })
    assert(q1.body.id && q1.body.merged === false, '首条新建')
    const q2 = await rpc2('notes-quick', { text: '速记P2第二条', sessionId: 'sess-p2-1' })
    assert.strictEqual(q2.body.id, q1.body.id, '10 分钟内同会话合并')
    const g = await rpc2('notes-get', { id: q1.body.id })
    assert(g.body.note.body.indexOf('速记P2第二条') >= 0, '合并正文含第二条')
  })
  await t('notes-search 命中', async () => {
    const s = await rpc2('notes-search', { query: '速记P2第二' })
    assert.strictEqual(s.body.notes.length, 1, '命中 1 条')
    assert(Array.isArray(s.body.notes[0].matches) && s.body.notes[0].matches.indexOf('body') >= 0, '静态包附 matches 命中字段（正文命中标 body）')
  })
  await t('notes-delete / notes-restore 软删除往返', async () => {
    await rpc2('notes-delete', { id: cr2.body.id })
    const l1 = await rpc2('notes-list', {})
    assert(l1.body.notes.every(n => n.id !== cr2.body.id), '软删除后不在列表')
    await rpc2('notes-restore', { id: cr2.body.id })
    const l2 = await rpc2('notes-list', {})
    assert(l2.body.notes.some(n => n.id === cr2.body.id), '恢复后回到列表')
  })
  await t('notes-conventions 读到迁移笔记的 inject 约定', async () => {
    const c = await rpc2('notes-conventions', {})
    assert(c.body.text.indexOf('迁移前旧笔记') >= 0, 'inject=true 且 workspace 匹配时应注入（实得：' + c.body.text + '）')
    assert(c.body.text.indexOf('旧笔记正文') >= 0, '注入正文')
    assert(c.body.text.indexOf('用户约定（须遵守）：') >= 0, '迁移旧笔记（无 injectRole 字段）缺省进约定桶')
    assert(c.body.text.indexOf('已记录的约定') < 0 && c.body.text.indexOf('记录会话') < 0, '静态包新文案不含旧归属标注')
  })
  await t('静态包 injectRole 链路：create reference → get/front-matter/双桶文案/update 一致', async () => {
    const c = await rpc2('notes-create', { title: '静态包资料', body: '参考资料正文P2', tags: ['rolep2'], inject: true, topic: '资料', injectRole: 'reference' })
    assert(c.body.id, 'create 返回 id（实得 ' + JSON.stringify(c.body) + '）')
    const g = await rpc2('notes-get', { id: c.body.id })
    assert.strictEqual(g.body.note.injectRole, 'reference', '静态包 notes-get 返回 injectRole=reference')
    const onDisk = store2.get(path.join(NOTES_ROOT_STATIC, c.body.id + '.md'))
    assert(onDisk && onDisk.indexOf('\ninjectRole: reference\n') >= 0, '静态包磁盘 front-matter 写 injectRole: reference')
    const conv = await rpc2('notes-conventions', {})
    const iRef = conv.body.text.indexOf('参考资料（与当前任务相关时按需取用）：')
    assert(conv.body.text.indexOf('用户约定（须遵守）：') >= 0 && iRef >= 0, '双桶引导词并列')
    assert(conv.body.text.indexOf('静态包资料') > iRef, 'reference 笔记列在资料桶下')
    const u = await rpc2('notes-update', { id: c.body.id, injectRole: 'convention' })
    assert(!u.body.error, 'notes-update 透传 injectRole')
    const g2 = await rpc2('notes-get', { id: c.body.id })
    assert.strictEqual(g2.body.note.injectRole, 'convention', '静态包 notes-update 改 injectRole 生效')
    const onDisk2 = store2.get(path.join(NOTES_ROOT_STATIC, c.body.id + '.md'))
    assert(onDisk2.indexOf('\ninjectRole: convention\n') >= 0, '静态包 update 后磁盘 front-matter 同步')
  })
  await t('notes:catalog 目录注入行为（静态包）：普通笔记进目录、约定去重、标题行+轻推行', () => {
    const cat = contexts2.find(x => x.name === 'notes:catalog')
    assert(cat && typeof cat.text === 'function', 'notes:catalog context 已注册且 text 为函数')
    const txt = cat.text()
    assert(txt.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') === 0, '目录标题行开头（实得：' + txt.slice(0, 80) + '）')
    assert(txt.indexOf('- [' + cr2.body.id + '] 静态包笔记 (笔记, 运维)') >= 0, '一行一条格式：- [id] 标题 (kind中文, topic)（实得：' + txt + '）')
    assert(txt.indexOf('迁移前旧笔记') < 0, 'inject=true 且本会话命中的约定不进目录（order 130 已注入全文，目录去重）')
    assert(txt.indexOf('规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') >= 0, '末尾轻推行')
  })
  await t('notes-sessions / notes-active-sessions / notes-workspaces 可用', async () => {
    const s1 = await rpc2('notes-sessions', {})
    assert(Array.isArray(s1.body.sessions), 'sessions 数组')
    assert(s1.body.sessions.some(x => x.id === 'session-abc12345-0000-0000-0000-000000000000'), '含有效会话')
    assert(!s1.body.sessions.some(x => String(x.id).indexOf('arch') >= 0), '排除已归档会话')
    assert(!s1.body.sessions.some(x => String(x.id).indexOf('sub99') >= 0), '排除子 agent')
    const s2 = await rpc2('notes-active-sessions', {})
    assert(Array.isArray(s2.body.sessions), 'active-sessions 数组')
    const s3 = await rpc2('notes-workspaces', {})
    assert(s3.body.workspaces.length === 1 && s3.body.workspaces[0].cwd === 'D:\\deepseek-work', 'workspaces 映射')
  })
  await t('notes-active-sessions 缓存命中：再次调用零 readTitleSnapshots 增量（静态包模块级缓存）', async () => {
    // 上一个测试的 notes-sessions 冷调用已后台填充缓存；此处再调必须全命中
    const before = io.sharedTitleReads
    const r = await rpc2('notes-active-sessions', {})
    assert.strictEqual(io.sharedTitleReads, before, '缓存命中不应再触发 readTitleSnapshots（实得增量 ' + (io.sharedTitleReads - before) + '）')
    assert(!r.body.titlesPending, '全命中响应不带 titlesPending')
    assert(Array.isArray(r.body.sessions) && r.body.sessions.some(x => x.id === 'session-abc12345-0000-0000-0000-000000000000'), 'live 会话仍实时返回')
  })
  await t('index.mjs 冷缓存首屏：titlesPending + pendingIds，补齐后零重读（?coldcache 独立 ESM 实例）', async () => {
    const modCold = await import(pathToFileURL(INDEX_PATH).href + '?coldcache=1')
    const handlersCold = {}
    global.harness = mkHarness(handlersCold)
    try {
      const storeCold = new Map()
      const fsMockCold = {
        resolve: async (p) => p,
        stat: async (p) => ((p === NOTES_ROOT_STATIC || p === LEGACY_NOTES_STATIC) ? { dir: true } : (storeCold.has(p) ? { file: true } : null)),
        listDir: async () => [],
        readText: async (p) => { if (!storeCold.has(p)) throw new Error('ENOENT: ' + p); return storeCold.get(p) },
        writeText: async (p, c) => { storeCold.set(p, c) },
      }
      modCold.apply({
        fs: fsMockCold, sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
        effect: () => {},
      })
      const before = io.sharedTitleReads
      const r = await handlersCold['notes-active-sessions']({})
      assert.strictEqual(r.titlesPending, true, '静态包冷缓存响应带 titlesPending')
      assert(Array.isArray(r.pendingIds) && r.pendingIds.length === 1 && r.pendingIds[0].indexOf('sub9900000') >= 0, 'pendingIds 含未命中非 live 会话（实得 ' + JSON.stringify(r.pendingIds) + '）')
      assert(r.sessions.length === 1 && r.sessions[0].short === 'abc12345', 'live 会话同步返回，首屏不空')
      assert.strictEqual(io.sharedTitleReads, before + 1, '未命中后台触发一次批量读（实得增量 ' + (io.sharedTitleReads - before) + '）')
      const r2 = await handlersCold['notes-active-sessions']({})
      assert.strictEqual(io.sharedTitleReads, before + 1, '第二次调用零 readTitleSnapshots 增量')
      assert(!r2.titlesPending && r2.sessions.length === 1, '缓存命中后稳定（subagent 过滤、archived 排除）')
    } finally {
      delete global.harness
    }
  })
  await t('notes-dispatch 派发到 live 会话 + 记录 dispatches', async () => {
    const before = sentMessages.length
    const d = await rpc2('notes-dispatch', { id: cr2.body.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话', instruction: '静态包派发要求' })
    assert(d.body.ok === true, '派发成功（实得 ' + JSON.stringify(d.body) + '）')
    assert.strictEqual(sentMessages.length, before + 1, 'agent.send 触发一次')
    assert.strictEqual(sentMessages[sentMessages.length - 1].msg.source.form, 'recall', "source.form='recall'")
    const g = await rpc2('notes-get', { id: cr2.body.id })
    assert(g.body.note.dispatches.length >= 1 && g.body.note.dispatches[g.body.note.dispatches.length - 1].instruction === '静态包派发要求', 'dispatches 记录')
    const idx = g.body.note.dispatches.length - 1
    const dn = await rpc2('notes-dispatch-done', { id: cr2.body.id, dispatchIndex: idx })
    assert(dn.body.ok === true, 'dispatch-done 成功')
  })
  await t('静态包 P3 派发闭环：dispatchStatus=sent → resolved 保底联动 → idle 事件回执', async () => {
    const c = await rpc2('notes-create', { title: '静态闭环', body: 'x', kind: 'todo' })
    const sid = 'session-abc12345-0000-0000-0000-000000000000'
    const d = await rpc2('notes-dispatch', { id: c.body.id, sessionId: sid, sessionName: '开发会话' })
    assert(d.body.ok === true && d.body.dispatch && d.body.dispatch.dispatchStatus === 'sent', '静态包派发登记 dispatchStatus=sent（实得 ' + JSON.stringify(d.body.dispatch) + '）')
    // 保底联动：notes-update resolved → 自动回执未闭环派发
    const u = await rpc2('notes-update', { id: c.body.id, status: 'resolved' })
    assert(u.body.dispatchClosed === 1, 'resolved 联动回执 1 条（实得 ' + u.body.dispatchClosed + '）')
    let g = await rpc2('notes-get', { id: c.body.id })
    assert(g.body.note.dispatches[0].dispatchStatus === 'done' && g.body.note.dispatches[0].receipt === 'resolved' && g.body.note.dispatches[0].doneAt, '静态包保底联动写 dispatchStatus=done + receipt=resolved + doneAt')
    // 事件回执：ctx2.on 捕获 agent/status 监听；目标会话 idle → 未闭环派发回执
    assert(Array.isArray(evtListeners2['agent/status']) && evtListeners2['agent/status'].length === 1, '静态包应订阅 agent/status（实得 ' + (evtListeners2['agent/status'] || []).length + '）')
    const c2b = await rpc2('notes-create', { title: '静态闭环2', body: 'x', kind: 'todo' })
    await rpc2('notes-dispatch', { id: c2b.body.id, sessionId: sid, sessionName: '开发会话' })
    for (const fn of evtListeners2['agent/status']) fn({ agent: liveAgent, status: 'idle' })
    await new Promise(r => setTimeout(r, 50))
    g = await rpc2('notes-get', { id: c2b.body.id })
    assert(g.body.note.dispatches[0].dispatchStatus === 'done' && g.body.note.dispatches[0].receipt === 'idle', '静态包 idle 事件回执（实得 ' + JSON.stringify(g.body.note.dispatches[0]) + '）')
    // 已 resolved 的第一篇不受 idle 影响（幂等）
    g = await rpc2('notes-get', { id: c.body.id })
    assert(g.body.note.dispatches.filter(x => x.dispatchStatus === 'done').length === 1, '幂等：已闭环条目不重复回执')
  })
  await t('静态包显式归档全链路：preview → 无参仅速记 → 显式 groups 手动组 → undo → notes-perf / notes-ping', async () => {
    // 直写 store2 造速记组（sess-st-1 两条，updatedAt 确定性）；静态包与开发版同一归档语义
    const seedStatic = (id, day, title, topic) => store2.set(path.join(NOTES_ROOT_STATIC, id + '.md'),
      '---\nid: ' + id + '\ntitle: ' + title + '\ntopic: ' + topic + '\ntags: quick\nsessionId: sess-st-1\ncreatedAt: "2026-01-0' + day + 'T00:00:00.000Z"\nupdatedAt: "2026-01-0' + day + 'T00:00:00.000Z"\n---\n\n' + title + '正文\n')
    seedStatic('n-sqk1', 1, '静态速记一', '开发')
    seedStatic('n-sqk2', 2, '静态速记二', '运维')
    const cA = await rpc2('notes-create', { title: '归档A', body: 'a', tags: ['arc2'], topic: '其他' })
    const cB = await rpc2('notes-create', { title: '归档B', body: 'b', tags: ['arc2'], topic: '其他' })
    // preview（dry-run）：速记组出现，手动笔记不出现
    const pv = await rpc2('notes-archive-preview', {})
    assert(!pv.body.error && Array.isArray(pv.body.quickGroups), 'preview 返回 quickGroups（实得 ' + JSON.stringify(pv.body).slice(0, 160) + '）')
    const gSt = pv.body.quickGroups.find(g => g.sessionId === 'sess-st-1')
    assert(gSt && gSt.members.length === 2 && gSt.title === '运维', '速记按 sessionId 分组 + 默认标题 last.topic（实得 ' + JSON.stringify(gSt) + '）')
    assert(pv.body.quickGroups.every(g => g.members.every(m => m.id !== cA.body.id && m.id !== cB.body.id)), '手动笔记不进 preview（行为变更）')
    // 无参归档：只合速记组，手动笔记不动
    const ar = await rpc2('notes-archive', {})
    assert.strictEqual(ar.body.merged, 1, '无参只合速记组（实得 ' + JSON.stringify(ar.body) + '）')
    let l = await rpc2('notes-list', {})
    assert(l.body.notes.some(n => n.id === cA.body.id) && l.body.notes.some(n => n.id === cB.body.id), '手动笔记不再按标签自动分组（保持可见）')
    assert(!l.body.notes.some(n => n.id === 'n-sqk1') && !l.body.notes.some(n => n.id === 'n-sqk2'), '速记组已合并隐藏')
    // 显式白名单：手动组 + title 覆盖
    const ar2 = await rpc2('notes-archive', { groups: [{ memberIds: [cA.body.id, cB.body.id], title: '静态手动归档' }] })
    assert.strictEqual(ar2.body.merged, 1, '显式 groups 合并手动组（实得 ' + JSON.stringify(ar2.body) + '）')
    const gArc = await rpc2('notes-get', { id: ar2.body.groups[0].noteId })
    assert.strictEqual(gArc.body.note.title, '静态手动归档', 'title 覆盖默认标题')
    // undo：只撤销最近一次（手动组）；前一次速记合并不回滚
    const ud = await rpc2('notes-archive-undo', {})
    assert(ud.body.undone === 1 && ud.body.restored === 2, 'undo 撤销最近一次归档（实得 ' + JSON.stringify(ud.body) + '）')
    l = await rpc2('notes-list', {})
    assert(l.body.notes.some(n => n.id === cA.body.id) && l.body.notes.some(n => n.id === cB.body.id), 'undo 成员批量还原')
    assert(!l.body.notes.some(n => n.id === ar2.body.groups[0].noteId), 'undo 归档笔记软删')
    assert(!l.body.notes.some(n => n.id === 'n-sqk1'), 'undo 只保留最近一次：前一次速记合并不回滚')
    const ud2 = await rpc2('notes-archive-undo', {})
    assert.strictEqual(ud2.body.undone, 0, '无可撤销 → { undone: 0 }')
    const pf = await rpc2('notes-perf', { perf: { hostCall: 1 } })
    assert(pf.body.ok === true, 'notes-perf ok')
    const pg = await rpc2('notes-ping', { t: 1 })
    assert(pg.body.ok === true && pg.body.echo.t === 1, 'P1 存活探测保留')
  })
  await t('notes-src / notes-css handler 保留（静态资产可回退读取）', async () => {
    const src = await rpc2('notes-src', { which: 'host' })
    assert(typeof src.body.src === 'string' && src.body.src.length > 1000, 'host 源码可下发')
    const src2 = await rpc2('notes-src', { which: 'client' })
    assert(typeof src2.body.src === 'string' && src2.body.src.length > 1000, 'client 源码可下发')
    const err = await rpc2('no-such-method', {})
    assert.strictEqual(err.status, 404, '未知方法 404')
  })
  await t('notes-css 从候选路径读到真实 styles.css', async () => {
    const css = await rpc2('notes-css', {})
    assert(typeof css.body.css === 'string' && css.body.css.indexOf('.dsh-notes-settings-modal') >= 0, 'css 下发成功（实得：' + JSON.stringify(css.body).slice(0, 120) + '）')
  })
  await t('静态包 3 工具可执行（note_search / note_get / note_manage）', async () => {
    const tSearch = tools2.find(x => x.name === 'note_search')
    const tGet = tools2.find(x => x.name === 'note_get')
    const tMgr = tools2.find(x => x.name === 'note_manage')
    const s = await tSearch.execute({ query: '静态包笔记' })
    assert(s.count >= 1, 'note_search 命中')
    const g = await tGet.execute({ id: cr2.body.id })
    assert(g.note && g.note.id === cr2.body.id, 'note_get 返回笔记')
    const l = await tMgr.execute({ action: 'list' })
    assert(l.action === 'list' && l.count >= 1, 'note_manage.list 可用')
    const c = await tMgr.execute({ action: 'create', title: '工具建笔记', body: '工具正文' })
    assert(c.action === 'create' && c.id, 'note_manage.create 可用')
    const d = await tMgr.execute({ action: 'delete', id: c.id })
    assert(d.action === 'delete', 'note_manage.delete 可用')
    assert(typeof tSearch.output.render === 'function', 'output.render 保留')
  })
  // 虚拟文件夹（静态包运行面）：notes-folders 经 webServer 兜底路由可达 + folder 字段链路 + move 往返
  await t('notes-folders RPC（webServer 路由）：create/list 计数 + folders.json 落盘', async () => {
    const c1 = await rpc2('notes-folders', { op: 'create', name: '静态包文件夹' })
    assert(c1.status === 200 && c1.body.ok === true && c1.body.folder && c1.body.folder.id.indexOf('f-') === 0, 'create 返回 f- 前缀 id（实得：' + JSON.stringify(c1.body) + '）')
    assert.strictEqual(c1.body.folder.order, 0, '首个文件夹 order=0')
    const foldersJsonPath = path.join(NOTES_ROOT_STATIC, 'folders.json')
    assert(store2.has(foldersJsonPath), 'folders.json 已写入 ~/.dsh/notes')
    assert.deepStrictEqual(JSON.parse(store2.get(foldersJsonPath)), [{ id: c1.body.folder.id, name: '静态包文件夹', order: 0 }], '磁盘清单内容一致')
    const lst = await rpc2('notes-folders', {})
    assert(lst.body.folders.length === 1 && lst.body.folders[0].id === c1.body.folder.id, 'list 含新文件夹')
    assert.strictEqual(typeof lst.body.unfiled, 'number', 'list 返回 unfiled 计数')
    const bad = await rpc2('notes-folders', { op: 'purge' })
    assert(bad.body.error && bad.body.error.indexOf('未知 op') >= 0, '未知 op 报错')
  })
  await t('静态包 folder 字段链路：create 带 folder → get/list/front-matter 一致 + 过滤', async () => {
    const fid = (await rpc2('notes-folders', {})).body.folders[0].id
    const n = await rpc2('notes-create', { title: 'fld-静态包', body: 'x', folder: fid })
    assert(n.body.id, 'notes-create 接受 folder')
    const g = await rpc2('notes-get', { id: n.body.id })
    assert.strictEqual(g.body.note.folder, fid, 'get 返回 folder id')
    const content = store2.get(path.join(NOTES_ROOT_STATIC, n.body.id + '.md'))
    assert(content.indexOf('\nfolder: ' + fid + '\n') >= 0, 'front-matter 含 folder 行')
    const inF = await rpc2('notes-list', { folder: fid })
    assert(inF.body.notes.some(x => x.id === n.body.id) && inF.body.notes.every(x => x.folder === fid), 'notes-list 按 folder 过滤')
    const unf = await rpc2('notes-list', { folder: '' })
    assert(!unf.body.notes.some(x => x.id === n.body.id), 'folder=\'\' 未分类不含该笔记')
    const lst = await rpc2('notes-folders', {})
    assert.strictEqual(lst.body.folders.find(f => f.id === fid).count, 1, '文件夹计数=1')
  })
  await t('静态包 note_manage move/create 名称解析 + 移出往返', async () => {
    const fid = (await rpc2('notes-folders', {})).body.folders[0].id
    const tMgr = tools2.find(x => x.name === 'note_manage')
    // create 按名称落位（修复：不再把名称当 id 写入悬空引用）
    const c = await tMgr.execute({ action: 'create', title: 'fld-静态包-mgr', body: 'x', folder: '静态包文件夹' })
    assert(c.id, 'create 按名称接受 folder')
    const g1 = await rpc2('notes-get', { id: c.id })
    assert.strictEqual(g1.body.note.folder, fid, 'create 名称解析为 id 落盘')
    const cbad = await tMgr.execute({ action: 'create', title: 'fld-bad', body: 'x', folder: '不存在的文件夹' })
    assert(cbad.error && cbad.error.indexOf('文件夹不存在') >= 0, 'create 不存在文件夹报错')
    // move：移出 → 按名称移回
    const m1 = await tMgr.execute({ action: 'move', id: c.id, folder: '' })
    assert.strictEqual(m1.folder, '', 'move 空串 = 移出未分类')
    assert.strictEqual((await rpc2('notes-get', { id: c.id })).body.note.folder, '', '移出生效')
    const m2 = await tMgr.execute({ action: 'move', id: c.id, folder: '静态包文件夹' })
    assert.strictEqual(m2.folder, fid, 'move 按名称解析为 id')
    assert.strictEqual(m2.folderName, '静态包文件夹', 'move 返回 folderName')
    assert.strictEqual((await rpc2('notes-get', { id: c.id })).body.note.folder, fid, '移回生效')
    const mbad = await tMgr.execute({ action: 'move', id: c.id, folder: '不存在的文件夹' })
    assert(mbad.error && mbad.error.indexOf('文件夹不存在') >= 0, 'move 不存在文件夹报错')
    // note_search folder 过滤（名称命中）
    const tSearch = tools2.find(x => x.name === 'note_search')
    const s1 = await tSearch.execute({ query: 'fld-静态包-mgr', folder: '静态包文件夹' })
    assert(s1.count >= 1 && s1.notes.every(n => n.folder === fid), 'note_search 按名称过滤命中')
    const s2 = await tSearch.execute({ query: 'fld-静态包-mgr', folder: '' })
    assert.strictEqual(s2.count, 0, 'folder=\'\' 未分类查不到该笔记')
  })
  await t('静态包 folders.json 损坏兜底：空清单 + 主流程不受影响', async () => {
    const foldersJsonPath = path.join(NOTES_ROOT_STATIC, 'folders.json')
    const backup = store2.get(foldersJsonPath)
    store2.set(foldersJsonPath, '这不是 JSON {')
    const r1 = await rpc2('notes-folders', {})
    assert(r1.status === 200 && Array.isArray(r1.body.folders) && r1.body.folders.length === 0 && !r1.body.error, '坏 JSON → 空清单不抛错')
    const l = await rpc2('notes-list', {})
    assert(l.body.notes.length >= 1, 'notes-list 主流程不受 folders.json 损坏影响')
    store2.set(foldersJsonPath, backup)
  })
  // 文件夹嵌套（静态包运行面）：parent 建层/深度上限/cycle 拒绝/递归子树过滤/cascade 软删恢复（webServer 兜底路由链路，与开发版同一 _folders 实现）
  await t('静态包嵌套文件夹：parent 建层/深度超限拒绝/cycle 拒绝/cascade 软删恢复落未分类', async () => {
    const A = (await rpc2('notes-folders', { op: 'create', name: '静态A' })).body.folder
    const rB = await rpc2('notes-folders', { op: 'create', name: '静态B', parent: A.id })
    assert(rB.body.ok === true && rB.body.folder.parent === A.id, 'create parent 落位（实得：' + JSON.stringify(rB.body) + '）')
    const B = rB.body.folder
    const C = (await rpc2('notes-folders', { op: 'create', name: '静态C', parent: B.id })).body.folder
    // 深度上限：缺省 maxFolderDepth=3，C 已是第 3 层 → 第 4 层拒绝
    const d4 = await rpc2('notes-folders', { op: 'create', name: '静态D', parent: C.id })
    assert(d4.body.error && d4.body.error.indexOf('maxFolderDepth') >= 0, '第 4 层超限拒绝（实得：' + JSON.stringify(d4.body) + '）')
    // cycle：A 不能挂到自己的子孙 C 下
    const cyc = await rpc2('notes-folders', { op: 'reorder', ids: [A.id], parents: { [A.id]: C.id } })
    assert(cyc.body.error && cyc.body.error.indexOf('cycle') >= 0, 'cycle 拒绝（实得：' + JSON.stringify(cyc.body) + '）')
    // list 带 parent/depth + 子树口径计数；notes-list 递归子树过滤
    const n = await rpc2('notes-create', { title: '静态嵌套笔记', body: 'x', folder: C.id })
    const lst = await rpc2('notes-folders', {})
    const la = lst.body.folders.find(f => f.id === A.id)
    const lc = lst.body.folders.find(f => f.id === C.id)
    assert(la.parent === '' && la.depth === 1 && la.count === 1, 'A 根级 depth=1 + 子树计数含 C 的笔记（实得：' + JSON.stringify(la) + '）')
    assert(lc.parent === B.id && lc.depth === 3 && lc.count === 1, 'C depth=3 + parent=B（实得：' + JSON.stringify(lc) + '）')
    const inA = await rpc2('notes-list', { folder: A.id })
    assert(inA.body.notes.some(x => x.id === n.body.id), 'notes-list folder=A 递归含子孙文件夹笔记')
    const inC = await rpc2('notes-list', { folder: C.id })
    assert(inC.body.notes.length === 1 && inC.body.notes[0].id === n.body.id, 'folder=C 只自身')
    // cascade：缺省拒绝（needCascade + 统计）→ cascade:true 整棵删除 + 笔记软删
    const refuse = await rpc2('notes-folders', { op: 'delete', id: A.id })
    assert(refuse.body.error && refuse.body.needCascade === true && refuse.body.childFolders === 2 && refuse.body.notes === 1, '缺省拒绝 + 统计（实得：' + JSON.stringify(refuse.body) + '）')
    const del = await rpc2('notes-folders', { op: 'delete', id: A.id, cascade: true })
    assert(del.body.ok === true && del.body.folders === 3 && del.body.notes === 1, 'cascade 统计 {folders:3, notes:1}（实得：' + JSON.stringify(del.body) + '）')
    assert(!(await rpc2('notes-folders', {})).body.folders.some(f => f.id === A.id || f.id === B.id || f.id === C.id), 'A/B/C 整棵出清单')
    // 恢复 → 原文件夹已不存在 → effectiveFolder 兜底未分类
    await rpc2('notes-restore', { id: n.body.id })
    assert((await rpc2('notes-list', { folder: '' })).body.notes.some(x => x.id === n.body.id), '恢复后落未分类（effectiveFolder 兜底）')
  })
  await t('harness 主通道：handle 经 harness.handle 注册（host.call 链路可用）', async () => {
    global.harness = harnessBackup
    try {
      const modBridge = await import(pathToFileURL(INDEX_PATH).href + '?bridge=1')
      modBridge.apply(ctx2)
      assert.strictEqual(routes2.length, 6, '兜底路由仍在（两次 apply × 3 条路由：RPC + 页面 + 资产），实得 ' + routes2.length)
      assert.strictEqual(typeof handlers['notes-list'], 'function', 'notes-list 经 harness.handle 注册')
      assert.strictEqual((await handlers['notes-ping']({ t: 2 })).ok, true, 'P1 notes-ping 经 harness.handle 可调用')
    } finally {
      delete global.harness
    }
  })

  await t('harness 存在时工具走 harness.defineTool/registerTool（不回退 ctx.tools，无重复注册）', async () => {
    global.harness = harnessBackup
    try {
      const modPrimary = await import(pathToFileURL(INDEX_PATH).href + '?primary=1')
      const tools5 = []
      const beforeTools = registeredTools.length
      modPrimary.apply({ fs: fsMock2, sandboxPolicy: { resolve: () => ({}) }, webServer: { register: () => () => {} }, tools: { register: (d) => { tools5.push(d); return () => {} } }, get: () => undefined, effect: () => {} })
      const added = registeredTools.slice(beforeTools).map(x => x.name).sort()
      assert.deepStrictEqual(added, ['note_get', 'note_manage', 'note_search'], 'harness.defineTool/registerTool 注册 3 个工具（实得：' + JSON.stringify(added) + '）')
      assert.strictEqual(tools5.length, 0, '两通道互斥：不应重复走 ctx.tools')
    } finally {
      delete global.harness
    }
  })
  Object.assign(S, { NOTES_ROOT_STATIC, contexts2, rpc2, store2 })
  }
}
