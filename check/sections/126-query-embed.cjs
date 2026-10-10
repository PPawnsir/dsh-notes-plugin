// 节 126. 0.5.0 R3 查询嵌入接通 + 浏览器 wasm 路径退役（notes-051-query-embed，依赖 R1 host embedder）
// 背景：R1（节 124）host embedder 内核落地后，_vectorsSearch({query}) 文本路径经 host embed 算查询向量——
//   _searchFused 语义通道真触发（note_search/notes-search/app/面板三端零改动受益）；
//   浏览器嵌入路径（app 侧嵌入模块 + jsdelivr/unpkg 运行时拉取链 + Cache API 模型层 + 模型文件代理路由）整体退役。
// 断言面：①退役面静态（模块不存在 / 双 manifest 零登记 / app.html 产物零 transformers·jsdelivr·unpkg·代理路径引用 /
//   head.js·server.dist.js·index.mjs 零代理路由残留 / e2e mock 通道拆除）；②bundle 减重（app.html 字节数上限闸）；
//   ③查询嵌入锚点行为级（假推理缝，真模型不进 CI）：bge hostEmbed:true 在册 + 文本 query 经 host embed 不抛错 +
//   notes-search 融合语义命中（文本不命中的 query 经语义通道召回并挂 semantic 徽标）。
// 红线：spike② 配置知识注释留在 vector-store.js embedder 头注（「为什么是 Symbol.for 注入」）；模型镜像链 hf-mirror→HF host 侧保留（节 124 看守）。
module.exports = {
  id: "126",
  title: "126. 0.5.0 R3 查询嵌入接通 + 浏览器 wasm 路径退役（退役面静态 + bundle 减重 + 融合语义命中锚，notes-051-query-embed）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  section('126. 0.5.0 R3 查询嵌入接通 + 浏览器 wasm 路径退役（notes-051-query-embed）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')

  // ===== 126.1 退役面静态断言 =====
  await t('R3 退役面：浏览器嵌入模块不存在 + 双 manifest 零登记 + app.html 零 transformers/jsdelivr/unpkg/代理路径引用', () => {
    assert(!fsNative.existsSync(path.join(DIR, 'src', 'app', 'kernel', 'wasm-embedder.js')), 'src/app/kernel/wasm-embedder.js 已删码')
    const appM = read('src/app/manifest.js'), cliM = read('src/client/manifest.js')
    assert(appM.indexOf('wasm-embedder') < 0 && cliM.indexOf('wasm-embedder') < 0, 'app/client manifest 双零登记')
    const appSrc = read('packages/dsh-notes-plugin/app.html')
    for (const tok of ['cdn.jsdelivr', 'unpkg.com', 'transformers.min.js', 'WASM_RUNTIME_URLS', 'wasmImportRuntime', 'wasmBuildIndex', 'wasmModel', 'wasmExtractVecs', 'wasmChunkText', 'wasmBodyHash', '/dsh-notes-model', 'dsh-notes-wasm-model']) {
      assert(appSrc.indexOf(tok) < 0, 'app.html 零引用：' + tok + '（浏览器嵌入路径退役面）')
    }
  })

  await t('R3 退役面：模型文件代理路由零残留（head.js/server.dist.js/index.mjs/e2e mock）+ host 镜像链 hf-mirror→HF 保留（红线）', () => {
    assert(read('src/host/head.js').indexOf('MODEL_PROXY_ROUTE') < 0, 'head.js 零 MODEL_PROXY_ROUTE 常量')
    const srvD = read('src/host/server.dist.js')
    assert(srvD.indexOf('MODEL_PROXY_ROUTE') < 0 && srvD.indexOf('MODEL_PROXY_MIRRORS') < 0 && srvD.indexOf('dsh-notes-model') < 0, 'server.dist.js 零代理路由残留')
    assert(indexSrc.indexOf('dsh-notes-model') < 0 && indexSrc.indexOf('MODEL_PROXY_ROUTE') < 0, 'index.mjs 产物零代理残留')
    const mockSrc = read('scripts/e2e/server.cjs')
    assert(mockSrc.indexOf('/dsh-notes-model') < 0 && mockSrc.indexOf('_modelProxyStatus') < 0, 'e2e mock 代理通道拆除（含失败桩）')
    // 红线：模型镜像链 hf-mirror→HF 在 host 侧保留（host embedder 直连下载的唯一消费方）
    const vs = read('src/host/kernel/vector-store.js')
    const mi = vs.indexOf('const BGE_MODEL_MIRRORS')
    assert(mi >= 0 && vs.indexOf("base: 'https://hf-mirror.com'", mi) > mi && vs.indexOf("base: 'https://huggingface.co'", mi) > vs.indexOf("base: 'https://hf-mirror.com'", mi), 'host embedder 镜像链 hf-mirror→HF 保留（红线不动）')
  })

  await t('R3 bundle 减重：app.html 字节数 ≤ 695000（R3 退役前基线 686336——退役净降兑现；文档安全 S1（notes-052-span-kernel2）机密块内核+双模渲染+镜像增量后上限上调）', () => {
    const bytes = fsNative.statSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html')).size
    assert(bytes <= 695000, 'app.html ≤ 695000 字节（实得 ' + bytes + '；R3 前基线 686336，S1 机密块增量 +23KB 后仍低于退役前水位）')
  })

  // ===== 126.2 查询嵌入锚点（fresh host 实例 + bge 假推理缝：真模型不进 CI）=====
  const NOTES_DIR_G = DIR + '\\notes'
  const store = new Map()
  const fsMock = {
    resolve: async (p) => p,
    stat: async (p) => { if (p === NOTES_DIR_G) return { dir: true }; if (store.has(p)) return { file: true }; const prefix = p + '\\'; for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }; return null },
    listDir: async (p) => { const prefix = p + '\\'; const out = []; for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) }); return out },
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

  await t('R3 查询嵌入锚点：bge hostEmbed:true 在册 + 文本 query 经 host embed 不抛错 + 融合检索语义命中（假推理缝）', async () => {
    // 注册面锚：bge hostEmbed:true（dev/dist 双侧）——query 文本路径（_vectorsSearch 内部 embed）不再 throw 的构造前提
    assert(hostSrc.indexOf("hostEmbed: true, embed: _vectorBgeEmbed") >= 0 && indexSrc.indexOf("hostEmbed: true, embed: _vectorBgeEmbed") >= 0, 'bge 注册 hostEmbed:true + _vectorBgeEmbed（双包）')
    globalThis.__DSH_NOTES_BGE_INFER__ = async (batch) => (batch || []).map(() => { const v = new Array(512).fill(0); v[0] = 1; return v })
    try {
      await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'bge-small-zh-q8' } })
      const n = await handlers['notes-create']({ title: 'R3锚点笔记', body: '部署流水线验收口径正文' })
      // ①文本 query 路径不抛错（0.5.0 R1 前抛「只在浏览器端运行」）：notes-vectors-search {query} → host embed → ok
      const q = await handlers['notes-vectors-search']({ query: '运维交接', backend: 'bge-small-zh-q8' })
      assert(q && q.ok === true && !q.error, '文本 query 经 host embed 不抛错（实得 error=' + (q && q.error) + '）')
      assert(q.results.some(x => x.noteId === n.id && x.score > 0.99), 'query 嵌入命中新篇（假推理缝同向量 cosine≈1；保存即嵌入经检索路径强制 drain）')
      // ②融合语义通道真触发：query 文本不命中正文（无「运维交接」字样）→ 文本通道零命中，唯语义通道召回并挂 semantic 徽标
      const f = await handlers['notes-search']({ query: '运维交接' })
      const hit = (f && f.notes || []).filter(x => x.id === n.id)[0]
      assert(hit, 'notes-search 融合召回新篇（文本零命中下唯语义通道可召回）')
      assert(hit.semantic === true, '命中行挂 semantic 徽标（_searchFused 语义通道真触发锚）')
      assert(Array.isArray(hit.matches) && hit.matches.length === 0, '文本通道零命中字段（佐证召回来源 = 语义通道）')
    } finally { delete globalThis.__DSH_NOTES_BGE_INFER__ }
  })
  }
}
