// 节 118. 0.5.0② wasm embedder（notes-050-wasm-embedder：transformers.js 浏览器端 bge 后端 + 镜像链 + 静默预取 + wasm-in-panel 裁决）
// 冻结架构 [[n-muz9b97x35et]] + spike [[n-muz91f19rrqj]]。本卡接①的 backend 注册表 + 三条 RPC（新增第四条 notes-vectors-put 回写通道）。
// 断言面：bge-small-zh-q8 后端注册（dim=512/minScore=0.50，embed 只在浏览器端）/
//   notes-vectors-put 全链路（假 wasm 桩：浏览器算向量 → 回写 → 边车落行 → search queryVector 命中）/
//   镜像链 failover（主镜像 mock 失败 → 兜底成功）+ 下载纪律（Range/If-Range 头）+ 预取只在闲置触发 /
//   semantic.model 增量合并（记录下载不清除 enabled/backend）/ wasm-in-panel 裁决实证（面板不加载 wasm，读现成向量）。
module.exports = {
  id: "118",
  title: "118. 0.5.0② wasm embedder（bge 后端 + notes-vectors-put 回写 + 镜像链 failover + 闲置预取 + wasm-in-panel 裁决，notes-050-wasm-embedder）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  section('118. 0.5.0② wasm embedder（notes-050-wasm-embedder）')

  // ===== 源码结构断言（dev/dist 双侧 + e2e mock + app manifest 接线 + client 不接线）=====
  const embPath = path.join(DIR, 'src', 'app', 'kernel', 'wasm-embedder.js')
  const embSrc = fsNative.readFileSync(embPath, 'utf8').replace(/\r\n/g, '\n')
  const appManifest = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'manifest.js'), 'utf8')
  const clientManifest = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'manifest.js'), 'utf8')
  const mockSrc = fsNative.readFileSync(path.join(DIR, 'scripts', 'e2e', 'server.cjs'), 'utf8')

  await t('双包注册：notes-vectors-put 第四条 RPC（dev + dist）+ e2e mock case + bge 后端注册', () => {
    for (const src of [hostSrc, indexSrc]) {
      assert(src.indexOf("handle('notes-vectors-put'") >= 0, '注册 notes-vectors-put')
      assert(src.indexOf("id: 'bge-small-zh-q8'") >= 0 && src.indexOf('minScore: 0.50') >= 0, '注册 bge-small-zh-q8（minScore 0.50）')
      assert(src.indexOf('_vectorsPut') >= 0, '定义 _vectorsPut 回写函数')
    }
    assert(mockSrc.indexOf("case 'notes-vectors-put':") >= 0, 'e2e mock 落 notes-vectors-put 用例桩')
    assert(mockSrc.indexOf("'bge-small-zh-q8': { id: 'bge-small-zh-q8', dim: 512, minScore: 0.5, hostEmbed: false }") >= 0, 'e2e mock VECTOR_BACKENDS 落 bge-small-zh-q8（hostEmbed:false 快速失败标记）')
  })

  await t('wasm-in-panel 裁决实证：app 接线 embedder、client（面板）不接线（面板读现成向量）', () => {
    assert(appManifest.indexOf("'kernel/wasm-embedder.js'") >= 0, 'app manifest 登记 wasm-embedder.js（嵌入在 app 页跑）')
    assert(clientManifest.indexOf('wasm-embedder') < 0, 'client manifest 不登记 wasm-embedder（面板不加载 wasm）')
    assert(embSrc.indexOf('wasm-in-panel 裁决') >= 0, 'embedder 落 wasm-in-panel 裁决说明块')
    assert(embSrc.indexOf('嵌入只在 app 页') >= 0 && embSrc.indexOf('面板读现成向量') >= 0, '裁决结论：嵌入只在 app 页 / 面板读现成向量')
    // 实证锚点：spike 三数字（transformers.js 867KB / wasm 10.6MB / 模型 23.32MB）留证 + 镜像链双环 + jsDelivr 不复
    assert(embSrc.indexOf('867KB') >= 0 && embSrc.indexOf('23.32MB') >= 0, '实证锚点：transformers.js 867KB + 模型 23.32MB 留证')
    assert(embSrc.indexOf('hf-mirror.com') >= 0 && embSrc.indexOf('huggingface.co') >= 0, '镜像链双环（hf-mirror → huggingface.co）')
    assert(embSrc.indexOf('jsDelivr 已砍') >= 0, 'jsDelivr 已砍不复')
  })

  // ===== core 块行为级 eval（下载走同源 + 超时 + 重试上限 + 下载纪律 + 闲置预取）=====
  const coreStart = embSrc.indexOf('==== wasm-embedder-core BEGIN ====')
  const coreEnd = embSrc.indexOf('==== wasm-embedder-core END ====')
  assert(coreStart >= 0 && coreEnd > coreStart, 'wasm-embedder-core 标记块存在')
  let core = embSrc.slice(coreStart, coreEnd)
  core = core.slice(core.indexOf('*/') + 2)          // 去 BEGIN 注释块
  core = core.slice(0, core.lastIndexOf('/*'))        // 去 END 标记残留开注释符
  const W = new Function(core + '\n;return { wasmModelUrl, wasmShouldPrefetch, wasmDownloadFile, wasmDownloadResumable, wasmDownloadWithFailover, WASM_PROXY_BASE, WASM_MODEL_ID, WASM_MODEL_FILES, WASM_DOWNLOAD_TIMEOUT_MS, WASM_RESUME_MAX_TRIES }')()

  await t('下载走同源：wasmModelUrl 返回 /dsh-notes-model/ 前缀（非 https:// 镜像直连，镜像链迁 host）', () => {
    const u = W.wasmModelUrl('config.json')
    assert(u.indexOf(W.WASM_PROXY_BASE + '/') === 0, 'wasmModelUrl 以代理基址开头（实得 ' + u + '）')
    assert(u.indexOf('https://') < 0 && u.indexOf('hf-mirror') < 0 && u.indexOf('huggingface') < 0, '不再含 https:// 镜像直连（实得 ' + u + '）')
    assert(u.indexOf(W.WASM_MODEL_ID) >= 0 && u.indexOf('config.json') >= 0, '含模型 id + 文件名')
  })

  await t('transformers.js 模型加载走同源代理（0.5.0 P0）：env.remoteHost 不再指 hf-mirror，remotePathTemplate 指向 /dsh-notes-model/', () => {
    assert(embSrc.indexOf("mod.env.remoteHost = 'https://hf-mirror.com'") < 0, 'env.remoteHost 不再直连 hf-mirror.com（浏览器 CORS 根因已灭）')
    assert(embSrc.indexOf("mod.env.remoteHost = ''") >= 0, 'env.remoteHost 置空（同源相对 URL 基址）')
    assert(embSrc.indexOf("mod.env.remotePathTemplate = '/dsh-notes-model/{model}/resolve/{revision}/'") >= 0, 'remotePathTemplate 指向 /dsh-notes-model/ 同源代理')
    assert(embSrc.indexOf('mod.env.allowRemoteModels = true') >= 0, 'allowRemoteModels 保持 true（经代理远程加载）')
  })

  await t('下载超时上限：WASM_DOWNLOAD_TIMEOUT_MS ≤15s + wasmDownloadFile 透传 AbortController signal', async () => {
    assert(typeof W.WASM_DOWNLOAD_TIMEOUT_MS === 'number' && W.WASM_DOWNLOAD_TIMEOUT_MS > 0 && W.WASM_DOWNLOAD_TIMEOUT_MS <= 15000, '超时常量 ≤15000（实得 ' + W.WASM_DOWNLOAD_TIMEOUT_MS + '）')
    const captured = {}
    const fetchImpl = async (url, init) => { captured.url = url; captured.init = init; return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array(3).buffer } }
    await W.wasmDownloadFile(fetchImpl, 'https://x/file', {})
    assert(captured.init && captured.init.signal, 'fetch init 透传 signal（AbortController 超时护栏）')
  })

  await t('重试次数封顶：wasmDownloadResumable 恰 WASM_RESUME_MAX_TRIES 次后抛错（消除 21s×3 无界重试）', async () => {
    let calls = 0
    const fetchImpl = async () => { calls++; return { ok: false, status: 500, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array(0).buffer } }
    let threw = false
    try { await W.wasmDownloadResumable(fetchImpl, 'https://x/f', {}) } catch (e) { threw = true }
    assert(threw, '全败抛错')
    assert.strictEqual(calls, W.WASM_RESUME_MAX_TRIES, '恰 ' + W.WASM_RESUME_MAX_TRIES + ' 次尝试（实得 ' + calls + '）')
  })

  await t('下载纪律：Range 断点续传 + If-Range/ETag 校验头按需附加', async () => {
    const captured = {}
    const fetchImpl = async (url, init) => {
      captured.url = url; captured.init = init
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array(5).buffer }
    }
    await W.wasmDownloadFile(fetchImpl, 'https://x/file', { rangeStart: 100, expectedEtag: '"e1"' })
    assert(captured.init && captured.init.headers && captured.init.headers['Range'] === 'bytes=100-', 'Range 头（断点续传）')
    assert(captured.init.headers['If-Range'] === '"e1"', 'If-Range 头（ETag 完整性核对）')
    const none = {}
    await W.wasmDownloadFile(async (u, i) => { none.init = i; return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new Uint8Array(1).buffer } }, 'https://x/f2', {})
    assert(!none.init.headers, '无 rangeStart/etag 时零附加头')
  })

  await t('预取只在闲置触发：wasmShouldPrefetch 距最后交互超阈值才 true，未超 false', () => {
    assert(W.wasmShouldPrefetch(70000, 0, 60000) === true, '闲置 70s ≥ 60s 阈值 → 允许预取')
    assert(W.wasmShouldPrefetch(30000, 0, 60000) === false, '闲置 30s < 60s 阈值 → 不预取')
    assert(W.wasmShouldPrefetch(100000, 99999, 60000) === false, '距最后交互 1ms → 不预取（不打断任何交互）')
  })

  // ===== 0.5.0 P0 host 模型代理通道行为级（mock 上游 200/404/500 三态 + Range 透传 + 镜像链 failover）=====
  const modProxy = await import(H.pathToFileURL(H.INDEX_PATH).href + '?modelproxy=1')
  const proxyRoutes = []
  const proxyStore = new Map()
  const proxyFs = {
    resolve: async (p) => p,
    stat: async (p) => null,
    listDir: async () => [],
    readText: async (p) => { if (!proxyStore.has(p)) throw new Error('ENOENT: ' + p); return proxyStore.get(p) },
    writeText: async (p, c) => { proxyStore.set(p, c) },
  }
  modProxy.apply({ fs: proxyFs, sandboxPolicy: { resolve: () => ({}) }, webServer: { register: (r) => { proxyRoutes.push(r); return () => {} } }, tools: { register: () => () => {} }, get: () => undefined, effect: () => {} })
  const proxyRoute = proxyRoutes.find(r => r.path === '/dsh-notes-model')
  assert(proxyRoute && proxyRoute.kind === 'prefix' && typeof proxyRoute.handler === 'function', '注册 prefix /dsh-notes-model 代理路由')
  const proxyInvoke = (req, fetchImpl) => new Promise((resolve) => {
    const res = { statusCode: 0, headers: {}, setHeader: (k, v) => { res.headers[k.toLowerCase()] = v }, writeHead: (c) => { res.statusCode = c }, end: (s) => { res.body = s } }
    const realFetch = globalThis.fetch
    globalThis.fetch = fetchImpl
    Promise.resolve(proxyRoute.handler(req, res)).then(function () { globalThis.fetch = realFetch; resolve(res) }, function () { globalThis.fetch = realFetch; resolve(res) })
  })
  const mkUp = (status, body, headers) => ({ status: status, headers: { get: (k) => (headers && headers[k.toLowerCase()]) || null }, arrayBuffer: async () => Buffer.from(body || '') })

  await t('host 代理通道：200 透传（状态码/Content-Type/Content-Length/ETag）+ Range 头透传', async () => {
    const calls = []
    const r = await proxyInvoke({ method: 'GET', url: '/dsh-notes-model/Xenova/bge-small-zh-v1.5/resolve/main/config.json', headers: { range: 'bytes=100-' } }, async (url, init) => {
      calls.push({ url: url, init: init })
      return mkUp(200, 'model-bytes', { 'content-type': 'application/octet-stream', 'content-length': '11', etag: '"e1"' })
    })
    assert.strictEqual(r.statusCode, 200, '200 透传（实得 ' + r.statusCode + '）')
    assert.strictEqual(r.headers['content-type'], 'application/octet-stream', 'Content-Type 透传')
    assert.strictEqual(r.headers['content-length'], '11', 'Content-Length 透传')
    assert.strictEqual(r.headers['etag'], '"e1"', 'ETag 透传')
    assert(r.body && r.body.toString() === 'model-bytes', '响应体透传')
    assert(calls.length === 1 && calls[0].url.indexOf('hf-mirror.com') >= 0, '主镜像先试')
    assert(calls[0].init && calls[0].init.headers && calls[0].init.headers['Range'] === 'bytes=100-', 'Range 头透传（断点续传）')
  })

  await t('host 代理通道：404/500 镜像链 failover（主镜像 500 → 兜底 200）+ 全败 502', async () => {
    const calls = []
    const r = await proxyInvoke({ method: 'GET', url: '/dsh-notes-model/Xenova/bge-small-zh-v1.5/resolve/main/tokenizer.json', headers: {} }, async (url) => {
      calls.push(url)
      if (url.indexOf('hf-mirror.com') >= 0) return mkUp(500, '', {})
      return mkUp(200, 'tokenizer', { 'content-type': 'application/json', 'content-length': '9' })
    })
    assert.strictEqual(r.statusCode, 200, '主镜像 500 → 兜底 200（实得 ' + r.statusCode + '）')
    assert(calls.length === 2 && calls[0].indexOf('hf-mirror.com') >= 0 && calls[1].indexOf('huggingface.co') >= 0, '镜像链按序 failover（hf-mirror → huggingface）')
    const rAll = await proxyInvoke({ method: 'GET', url: '/dsh-notes-model/Xenova/bge-small-zh-v1.5/resolve/main/x.json', headers: {} }, async () => mkUp(404, '', {}))
    assert.strictEqual(rAll.statusCode, 502, '全环 404 → 502（实得 ' + rAll.statusCode + '）')
    assert(String(rAll.body || '').indexOf('model download failed') >= 0, '502 体含失败原因')
  })

  // ===== host 行为断言（fresh 实例：bge 后端 + notes-vectors-put 全链路 + semantic.model 合并）=====
  const NOTES_DIR_W = DIR + '\\notes'
  const VECTORS_PATH = NOTES_DIR_W + '\\vectors.jsonl'
  const store = new Map()
  const fsMock = {
    resolve: async (p) => p,
    stat: async (p) => {
      if (p === NOTES_DIR_W) return { dir: true }
      if (store.has(p)) return { file: true }
      const prefix = p + '\\'
      for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }
      return null
    },
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
    writeText: async (p, c) => { store.set(p, c) },
  }
  const handlers = {}
  const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: S.llmMock, agentDefaultModel: S.admMock, agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply(ctx)
  const readVectors = () => {
    const raw = store.get(VECTORS_PATH)
    if (!raw) return []
    return String(raw).split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))
  }
  const settle = async () => { await handlers['notes-vectors-status']({}) }   // status 内部 await _vectorFlush：强制落盘，读边车前调用

  await t('bge 后端窄接口自报：status dim=512/minScore=0.50 + 激活 bge 后 embed 只在浏览器端（host rebuild/文本 query 抛错）', async () => {
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'bge-small-zh-q8' } })
    const st = await handlers['notes-vectors-status']({})
    assert(st && st.backend === 'bge-small-zh-q8', '激活 bge-small-zh-q8（status.backend）')
    const bns = (st.namespaces || []).filter(n => n.backend === 'bge-small-zh-q8')[0]
    assert(bns && bns.dim === 512 && bns.minScore === 0.5, 'bge 自报 dim=512/minScore=0.5')
    // host 侧 embed 只在浏览器端：文本 query 走 embed → 抛错；rebuild 有笔记时走 embed → 抛错
    const q = await handlers['notes-vectors-search']({ query: '部署', backend: 'bge-small-zh-q8' })
    assert(q && q.error && q.error.indexOf('浏览器端运行') >= 0, '文本 query（host embed）抛错：嵌入只在浏览器端')
    await handlers['notes-create']({ title: 'N', body: 'hello world' })
    const rb = await handlers['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' })
    assert(rb && rb.error && rb.error.indexOf('浏览器端运行') >= 0, 'host rebuild 抛错：bge 重建由浏览器驱动（notes-vectors-put）')
  })

  await t('假 wasm 桩全链路：浏览器算向量 → notes-vectors-put 回写 → 边车落行 → search queryVector 命中', async () => {
    // 假 wasm 桩（浏览器 transformers.js 的替身）：deterministic 512 维单位向量
    const vec512 = new Array(512).fill(0); vec512[0] = 1
    const r = await handlers['notes-vectors-put']({ backend: 'bge-small-zh-q8', rows: [{ noteId: 'wasm-n1', bodyHash: 'h1', vectors: [vec512] }] })
    assert(r && r.ok === true && r.written === 1 && r.skipped === 0 && r.dim === 512, 'put 回写 written=1/skipped=0/dim=512')
    await settle()
    const rows = readVectors().filter(x => x.backend === 'bge-small-zh-q8' && x.noteId === 'wasm-n1')
    assert(rows.length === 1 && rows[0].chunk === 0 && rows[0].vector.length === 512 && rows[0].bodyHash === 'h1', '边车落行（noteId/bodyHash/vector 512 维）')
    const s = await handlers['notes-vectors-search']({ queryVector: vec512, backend: 'bge-small-zh-q8' })
    assert(s && s.ok === true && s.count >= 1 && s.results.some(x => x.noteId === 'wasm-n1' && x.score > 0.99), 'search queryVector 命中（全链路 队列→embed→边车→检索）')
    const st = await handlers['notes-vectors-status']({})
    assert(st.indexed === 1 && st.backend === 'bge-small-zh-q8', 'status indexed=1')
  })

  await t('dim 写前校验 + replace 全量重建：坏行 skipped、replace 清空目标命名空间再写', async () => {
    const bad = await handlers['notes-vectors-put']({ backend: 'bge-small-zh-q8', rows: [{ noteId: 'bad-dim', bodyHash: 'x', vectors: [new Array(256).fill(0)] }] })
    assert(bad && bad.written === 0 && bad.skipped === 1, '256 维向量（≠512）写前校验 skipped（实得 written ' + bad.written + '/skipped ' + bad.skipped + '）')
    const vec512b = new Array(512).fill(0); vec512b[1] = 1
    const rp = await handlers['notes-vectors-put']({ backend: 'bge-small-zh-q8', replace: true, rows: [{ noteId: 'wasm-n2', bodyHash: 'h2', vectors: [vec512b] }] })
    assert(rp && rp.written === 1, 'replace 写入 wasm-n2')
    await settle()
    const rows = readVectors().filter(x => x.backend === 'bge-small-zh-q8')
    assert(!rows.some(x => x.noteId === 'wasm-n1') && rows.some(x => x.noteId === 'wasm-n2'), 'replace 清空旧命名空间（wasm-n1 出队、wasm-n2 落行）')
  })

  await t('semantic.model 增量合并：只 patch model 不清除存量 enabled/backend（下载状态与开关独立）', async () => {
    const m = await handlers['notes-settings-set']({ semantic: { model: { backend: 'bge-small-zh-q8', bytes: 24452000, downloadedAt: '2026-10-08T00:00:00.000Z', source: 'cache-api' } } })
    assert(m && m.ok === true, 'model 回写 ok')
    const g = await handlers['notes-settings-get']({})
    const sm = g.settings && g.settings.semantic
    assert(sm && sm.enabled === true && sm.backend === 'bge-small-zh-q8', '存量 enabled/backend 保留（增量合并不覆盖）')
    assert(sm.model && sm.model.bytes === 24452000 && sm.model.backend === 'bge-small-zh-q8', 'model 下载状态落盘（bytes/backend）')
    await handlers['notes-settings-set']({ semantic: { model: null } })
    const g2 = await handlers['notes-settings-get']({})
    assert(!(g2.settings.semantic && g2.settings.semantic.model), 'model=null 清除下载状态（enabled/backend 仍保留）')
    assert(g2.settings.semantic && g2.settings.semantic.enabled === true, '清除 model 后 enabled 保留')
  })
  }
}
