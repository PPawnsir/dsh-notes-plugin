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
    assert(mockSrc.indexOf("'bge-small-zh-q8': { id: 'bge-small-zh-q8', dim: 512, minScore: 0.5 }") >= 0, 'e2e mock VECTOR_BACKENDS 落 bge-small-zh-q8')
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

  // ===== core 块行为级 eval（镜像链 failover + 下载纪律 + 闲置预取）=====
  const coreStart = embSrc.indexOf('==== wasm-embedder-core BEGIN ====')
  const coreEnd = embSrc.indexOf('==== wasm-embedder-core END ====')
  assert(coreStart >= 0 && coreEnd > coreStart, 'wasm-embedder-core 标记块存在')
  let core = embSrc.slice(coreStart, coreEnd)
  core = core.slice(core.indexOf('*/') + 2)          // 去 BEGIN 注释块
  core = core.slice(0, core.lastIndexOf('/*'))        // 去 END 标记残留开注释符
  const W = new Function(core + '\n;return { wasmMirrorChain, wasmModelUrl, wasmShouldPrefetch, wasmDownloadFile, wasmDownloadWithFailover, WASM_MIRRORS, WASM_MODEL_FILES }')()

  await t('镜像链 failover：主镜像 mock 失败 → 兜底成功（返回 mirror=hf-official + bytes + etag）', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url: url, init: init })
      if (url.indexOf('hf-mirror.com') >= 0) return { ok: false, status: 500 }
      return {
        ok: true, status: 200,
        headers: { get: (k) => (k === 'etag' ? '"spike-etag-001"' : (k === 'content-length' ? '3' : null)) },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }
    }
    const r = await W.wasmDownloadWithFailover(fetchImpl, W.WASM_MIRRORS, 'config.json', {})
    assert(r && r.mirror === 'hf-official', '失败主镜像后兜底成功（mirror=hf-official，实得 ' + (r && r.mirror) + '）')
    assert(r.bytes && r.bytes.length === 3, '下载字节数正确（3 字节）')
    assert(r.etag === '"spike-etag-001"', 'ETag 完整性核对（etag 透传）')
    const kind = (u) => u.indexOf('hf-mirror.com') >= 0 ? 'hf-mirror' : (u.indexOf('huggingface.co') >= 0 ? 'hf-official' : 'other')
    const seq = calls.map(c => kind(c.url))
    assert(seq.indexOf('hf-mirror') >= 0 && seq.indexOf('hf-official') >= 0, '两镜像都被尝试')
    assert(seq.indexOf('hf-official') > seq.indexOf('hf-mirror'), '主镜像先试、兜底后试（failover 顺序）')
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
