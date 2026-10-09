// 节 118. 0.5.0② wasm embedder → 0.5.0 R3 退役（notes-050-wasm-embedder → notes-051-query-embed）
// 沿革：②卡落浏览器端 bge 后端（transformers.js + 镜像链 + 闲置预取 + notes-vectors-put 回写）；P0 模型下载 host 代理化；
//   R1（节 124）bge 嵌入迁回 host 进程（hostEmbed:true）；R2（节 125）构建按钮改道 host rebuild；
//   R3 浏览器嵌入路径整体退役——wasm-embedder.js 删码 + app manifest 除名 + /dsh-notes-model 代理路由拆除 +
//   Cache API 模型层/设置区模型行拆除（退役面静态断言在节 126）。
// 保留断言面：notes-vectors-put 回写通道（双包注册 + e2e mock case + 行为链路：put → 边车落行 → queryVector 命中）/
//   bge 后端窄接口自报 + host embed 文本 query 不抛错（查询嵌入锚点，0.5.0 R1 起）/ dim 写前校验显性化 / semantic.model 白名单兼容合并。
module.exports = {
  id: "118",
  title: "118. 0.5.0② wasm embedder → R3 退役（notes-vectors-put 回写通道 + bge host embed 锚，notes-050-wasm-embedder → notes-051-query-embed）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  section('118. 0.5.0② wasm embedder → R3 退役（notes-050-wasm-embedder → notes-051-query-embed）')

  // ===== 源码结构断言（dev/dist 双侧 + e2e mock；浏览器嵌入模块退役锚）=====
  const embPath = path.join(DIR, 'src', 'app', 'kernel', 'wasm-embedder.js')
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
    assert(mockSrc.indexOf("'bge-small-zh-q8': { id: 'bge-small-zh-q8', dim: 512, minScore: 0.5 }") >= 0, 'e2e mock VECTOR_BACKENDS 落 bge-small-zh-q8（0.5.0 R2：hostEmbed:false 快速失败标记已拆——mock rebuild 真跑同 host）')
  })

  await t('浏览器嵌入模块退役（0.5.0 R3）：wasm-embedder.js 删码 + app/client manifest 双零登记', () => {
    assert(!fsNative.existsSync(embPath), 'src/app/kernel/wasm-embedder.js 已删码（浏览器嵌入路径整体退役）')
    assert(appManifest.indexOf('wasm-embedder') < 0, 'app manifest 零 wasm-embedder 登记')
    assert(clientManifest.indexOf('wasm-embedder') < 0, 'client manifest 零 wasm-embedder 登记（面板从不加载嵌入运行时——wasm-in-panel 裁决不变）')
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

  await t('bge 后端窄接口自报：status dim=512/minScore=0.50 + 0.5.0 R1 host embedder（文本 query 走 host embed，假推理缝）', async () => {
    // 0.5.0 R1（notes-051-host-embedder）：bge 嵌入迁回 host 进程（onnxruntime-web 纯 wasm）——host embed 不再抛「只在浏览器端」；
    //   check 经假推理缝接入（真模型不进 CI）；并发闸/批上限/懒加载行为断言在节 124。本断言只锁窄接口自报 + host embed 通道在案。
    globalThis.__DSH_NOTES_BGE_INFER__ = async (batch) => (batch || []).map(() => { const v = new Array(512).fill(0); v[0] = 1; return v })
    try {
      await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'bge-small-zh-q8' } })
      const st = await handlers['notes-vectors-status']({})
      assert(st && st.backend === 'bge-small-zh-q8', '激活 bge-small-zh-q8（status.backend）')
      const bns = (st.namespaces || []).filter(n => n.backend === 'bge-small-zh-q8')[0]
      assert(bns && bns.dim === 512 && bns.minScore === 0.5, 'bge 自报 dim=512/minScore=0.5')
      // host embed 在案：文本 query 经 host embed（假推理缝）→ ok 返回（0.5.0 R1 前抛「只在浏览器端运行」）
      const q = await handlers['notes-vectors-search']({ query: '部署', backend: 'bge-small-zh-q8' })
      assert(q && q.ok === true && !q.error, '文本 query 走 host embed 不再抛错（实得 error=' + (q && q.error) + '）')
      // host 源注册面：hostEmbed:true + _vectorBgeEmbed（dev/dist 双侧）
      assert(hostSrc.indexOf("hostEmbed: true, embed: _vectorBgeEmbed") >= 0 && indexSrc.indexOf("hostEmbed: true, embed: _vectorBgeEmbed") >= 0, 'bge 注册 hostEmbed:true + _vectorBgeEmbed（双包）')
    } finally { delete globalThis.__DSH_NOTES_BGE_INFER__ }
  })

  await t('假向量桩全链路：外部算向量 → notes-vectors-put 回写 → 边车落行 → search queryVector 命中', async () => {
    // 假向量桩（外部生产方的替身）：deterministic 512 维单位向量
    const vec512 = new Array(512).fill(0); vec512[0] = 1
    const r = await handlers['notes-vectors-put']({ backend: 'bge-small-zh-q8', rows: [{ noteId: 'wasm-n1', bodyHash: 'h1', vectors: [vec512] }] })
    assert(r && r.ok === true && r.written === 1 && r.dropped === 0 && r.dim === 512, 'put 回写 written=1/dropped=0/dim=512')
    await settle()
    const rows = readVectors().filter(x => x.backend === 'bge-small-zh-q8' && x.noteId === 'wasm-n1')
    assert(rows.length === 1 && rows[0].chunk === 0 && rows[0].vector.length === 512 && rows[0].bodyHash === 'h1', '边车落行（noteId/bodyHash/vector 512 维）')
    const s = await handlers['notes-vectors-search']({ queryVector: vec512, backend: 'bge-small-zh-q8' })
    assert(s && s.ok === true && s.count >= 1 && s.results.some(x => x.noteId === 'wasm-n1' && x.score > 0.99), 'search queryVector 命中（全链路 队列→embed→边车→检索）')
    const st = await handlers['notes-vectors-status']({})
    assert(st.indexed === 1 && st.backend === 'bge-small-zh-q8', 'status indexed=1')
  })

  await t('dim 写前校验显性化 + replace 全量重建：坏行 dropped+reasons+全丢 error、replace 清空目标命名空间再写', async () => {
    const bad = await handlers['notes-vectors-put']({ backend: 'bge-small-zh-q8', rows: [{ noteId: 'bad-dim', bodyHash: 'x', vectors: [new Array(256).fill(0)] }] })
    assert(bad && bad.ok === false && bad.error && bad.written === 0 && bad.dropped === 1 && Array.isArray(bad.reasons) && bad.reasons.length === 1, '256 维向量（≠512）全丢 → dropped=1 + error 面（实得 written ' + bad.written + '/dropped ' + bad.dropped + '/error ' + (bad && bad.error) + '）')
    const vec512b = new Array(512).fill(0); vec512b[1] = 1
    const rp = await handlers['notes-vectors-put']({ backend: 'bge-small-zh-q8', replace: true, rows: [{ noteId: 'wasm-n2', bodyHash: 'h2', vectors: [vec512b] }] })
    assert(rp && rp.written === 1, 'replace 写入 wasm-n2')
    await settle()
    const rows = readVectors().filter(x => x.backend === 'bge-small-zh-q8')
    assert(!rows.some(x => x.noteId === 'wasm-n1') && rows.some(x => x.noteId === 'wasm-n2'), 'replace 清空旧命名空间（wasm-n1 出队、wasm-n2 落行）')
  })

  await t('semantic.model 增量合并：只 patch model 不清除存量 enabled/backend（白名单兼容——0.5.0 R3 起生产方退役，存量值读回兼容）', async () => {
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
