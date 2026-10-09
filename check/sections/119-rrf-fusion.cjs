// 节 119. 0.5.0③ RRF 融合检索（notes-050-rrf-fusion：RRF(k=60) 融合进 notes-search + note_search + 语义徽标 + 短关键词噪声压制 + 黄金集断言 + sensitive 翻转账面）
// 冻结架构 [[n-muz9b97x35et]] + spike [[n-muz91f19rrqj]]。本卡接①向量层 + ②wasm embedder：融合层包在 _search 外（不改里面，红线）。
// 断言面：RRF 纯函数三案例（文本强/语义强/双强 + 平手文本优先）/ 短关键词判定 + minScore 上浮常量 /
//   融合检索 + 语义徽标下发（fake-64 桩确定性向量黄金集）/ note_search ≡ notes-search 融合一致 /
//   开关关=旧行为逐字节 / sensitive 翻转全命名空间出队（任何后端命名空间不再命中）/
//   检索只打激活后端（残留集不检索）/ 降级链（报错/无索引静默纯文本）。
module.exports = {
  id: "119",
  title: "119. 0.5.0③ RRF 融合检索（RRF(k=60) + note_search + 语义徽标 + 短关键词压制 + 黄金集 + sensitive 翻转，notes-050-rrf-fusion）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  section('119. 0.5.0③ RRF 融合检索（notes-050-rrf-fusion）')

  // ===== 源码结构断言（dev/dist 双侧 + e2e mock）=====
  const searchSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'search.js'), 'utf8').replace(/\r\n/g, '\n')
  const vsDev = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'vector-store.js'), 'utf8').replace(/\r\n/g, '\n')
  const vsDist = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'vector-store.dist.js'), 'utf8').replace(/\r\n/g, '\n')
  const mockSrc = fsNative.readFileSync(path.join(DIR, 'scripts', 'e2e', 'server.cjs'), 'utf8')

  await t('融合层落点：search.js 双包单份（rrf-fusion-core + _searchFused）+ notes-search/note_search 消费 _searchFused + 语义徽标下发', () => {
    for (const src of [hostSrc, indexSrc]) {
      assert(src.indexOf('_searchFused') >= 0, '_searchFused 存在')
      assert(src.indexOf('rrfFuse') >= 0, 'rrfFuse 纯函数存在')
      assert(src.indexOf("if (n.semantic) s.semantic = true") >= 0, 'slim 输出挂 semantic 徽标字段')
    }
    assert(searchSrc.indexOf('==== rrf-fusion-core BEGIN ====') >= 0 && searchSrc.indexOf('==== rrf-fusion-core END ====') >= 0, 'rrf-fusion-core 标记块存在')
    assert(hostSrc.indexOf('const found = await _searchFused(a.query') >= 0, 'notes-search RPC 走 _searchFused')
    assert(hostSrc.indexOf('const all = await _searchFused(args && args.query') >= 0, 'note_search 工具走 _searchFused（dev）')
    assert(indexSrc.indexOf('const all = await _searchFused(args && args.query') >= 0, 'note_search 工具走 _searchFused（dist）')
    assert(hostSrc.indexOf('Semantic search (0.5.0)') >= 0 && indexSrc.indexOf('Semantic search (0.5.0)') >= 0, 'note_search 描述补语义能力说明（双包）')
    assert(mockSrc.indexOf('vectorDropNote') >= 0, 'e2e mock 落 vectorDropNote 全命名空间出队通道')
  })

  await t('sensitive 翻转全命名空间出队（dev/dist 逐字节一致）+ 融合检索只打激活后端', () => {
    assert(vsDev.indexOf('_vectorCache || _vectorLoadPromise') >= 0 && vsDist.indexOf('_vectorCache || _vectorLoadPromise') >= 0, '非可索引 → 全命名空间出队守卫（双变体）')
    assert(vsDev.indexOf('return _vectorDropNote(id)') >= 0 && vsDist.indexOf('return _vectorDropNote(id)') >= 0, '路由到 _vectorDropNote（全命名空间出队）')
    assert.strictEqual(vsDev.slice(vsDev.indexOf('const VECTOR_FLUSH_MS')), vsDist.slice(vsDist.indexOf('const VECTOR_FLUSH_MS')), 'vector-store 两变体 VECTOR_FLUSH_MS 起逐字节一致')
    assert(searchSrc.indexOf('_vectorsSearch({ query: String(query), limit: RRF_SEMANTIC_LIMIT })') >= 0, '融合检索不带 backend（只打激活后端命名空间）')
  })

  // ===== RRF 纯函数行为级（eval core 标记块）=====
  const coreStart = searchSrc.indexOf('==== rrf-fusion-core BEGIN ====')
  const coreEnd = searchSrc.indexOf('==== rrf-fusion-core END ====')
  assert(coreStart >= 0 && coreEnd > coreStart, 'rrf-fusion-core 标记块存在')
  let core = searchSrc.slice(coreStart, coreEnd)
  core = core.slice(core.indexOf('*/') + 2)
  core = core.slice(0, core.lastIndexOf('/*'))
  const R = new Function(core + '\n;return { rrfFuse, rrfIsShortQuery, rrfSemanticMinScore, RRF_K }')()

  await t('RRF 三案例：文本强 / 语义强 / 双强 + 平手文本优先', () => {
    assert.deepStrictEqual(R.rrfFuse(['A', 'B', 'C'], []), { order: ['A', 'B', 'C'], semantic: {} }, '纯文本通道保序（文本强）')
    assert.deepStrictEqual(R.rrfFuse([], ['X', 'Y']), { order: ['X', 'Y'], semantic: { X: true, Y: true } }, '纯语义通道保序 + 全语义徽标（语义强）')
    const both = R.rrfFuse(['A', 'B', 'C'], ['C'])
    assert.strictEqual(both.order[0], 'C', '双强 C 双通道分数最高跃顶')
    assert.deepStrictEqual(both.order.slice(1), ['A', 'B'], '双强余下按文本序（A 文本 rank1 > B rank2）')
    assert.strictEqual(both.semantic.C, true, 'C 挂语义徽标')
    assert(!both.semantic.A && !both.semantic.B, '纯文本 A/B 无语义徽标')
    const tie = R.rrfFuse(['A', 'B'], ['B', 'A'])
    assert.deepStrictEqual(tie.order, ['A', 'B'], '平手（双通道分数相等）→ 文本排名优先')
    assert.strictEqual(R.RRF_K, 60, 'RRF k=60 冻结')
  })

  await t('短关键词判定 + minScore 上浮常量（Docker 类擦线噪音压制）', () => {
    assert(R.rrfIsShortQuery('Docker') === true, 'Docker（6 字符）短')
    assert(R.rrfIsShortQuery('docker') === true, 'docker 短')
    assert(R.rrfIsShortQuery('release') === true, '纯英文单词（>6 字符）短')
    assert(R.rrfIsShortQuery('docker compose') === false, '带空格多词非短')
    assert(R.rrfIsShortQuery('部署相关的约定') === false, '7 字中文短语非短')
    assert(R.rrfSemanticMinScore('docker', 0) === 0.05, '短关键词 minScore 上浮 +0.05')
    assert(Math.abs(R.rrfSemanticMinScore('docker', 0.9) - 0.95) < 1e-9, '短关键词 fake-64 minScore 0.9→0.95')
    assert(R.rrfSemanticMinScore('部署相关的约定', 0.50) === 0.50, '非短关键词不上浮')
  })

  // ===== 行为断言（fresh host 实例：fake-64 桩确定性向量黄金集；独立 store/handlers/tools）=====
  function mk() {
    const NOTES_DIR_V = DIR + '\\notes'
    const store = new Map()
    const fsMock = {
      resolve: async (p) => p,
      stat: async (p) => {
        if (p === NOTES_DIR_V) return { dir: true }
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
    const registeredTools = []
    const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: (ctx, def) => { registeredTools.push(def); return () => {} } }
    const ctx = {
      fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: S.llmMock, agentDefaultModel: S.admMock, agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
      effect: () => {},
    }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply(ctx)
    const settle = async () => { await handlers['notes-vectors-status']({}) }
    const searchTool = () => registeredTools.find(d => d.name === 'note_search')
    return { handlers: handlers, registeredTools: registeredTools, settle: settle, searchTool: searchTool }
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))   // 确保两笔记 updatedAt 不同毫秒（_list 按 updatedAt 降序，文本 rank 可控）

  await t('融合检索 + 语义徽标（fake-64 黄金集）：双强跃顶 + 文本强次之 + 语义徽标只挂语义命中行', async () => {
    const { handlers, settle } = mk()
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-64' } })
    const nBoth = await handlers['notes-create']({ title: '部署', body: '部署相关的约定' })          // 双强：body 块精确等于查询 → 语义命中 + 文本命中（旧，文本 rank 低）
    await sleep(50)
    const nText = await handlers['notes-create']({ title: '关于部署相关的约定的记录', body: '其他内容' })  // 文本强：title 命中、body 不命中 → 仅文本（新，文本 rank 高）
    const nUnrel = await handlers['notes-create']({ title: '购物清单', body: '牛奶面包' })            // 无关
    await settle()
    const r = await handlers['notes-search']({ query: '部署相关的约定' })
    const ids = (r.notes || []).map(n => n.id)
    assert.strictEqual(ids.length, 2, '恰 2 命中（双强 + 文本强；无关排除，实得 ' + ids.length + '）')
    assert.strictEqual(ids[0], nBoth.id, '双强跃顶（语义 rank1 + 文本 rank2 > 文本 rank1）')
    assert.strictEqual(ids[1], nText.id, '文本强次之')
    assert.strictEqual(r.notes[0].semantic, true, '双强行挂 semantic 徽标')
    assert.strictEqual(r.notes[1].semantic, undefined, '文本强行无语义徽标')
    assert(r.notes[0].matches && r.notes[0].matches.indexOf('body') >= 0, '双强 matches 含 body')
    assert(r.notes[1].matches && r.notes[1].matches.indexOf('title') >= 0, '文本强 matches 含 title')
  })

  await t('note_search 工具 ≡ notes-search 融合一致（同黄金集同序同徽标）', async () => {
    const { handlers, settle, searchTool } = mk()
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-64' } })
    const nBoth = await handlers['notes-create']({ title: '部署', body: '部署相关的约定' })
    await sleep(50)
    const nText = await handlers['notes-create']({ title: '关于部署相关的约定的记录', body: '其他内容' })
    await settle()
    const rpc = await handlers['notes-search']({ query: '部署相关的约定' })
    const tool = searchTool()
    assert(tool, 'note_search 工具已注册')
    const tr = await tool.execute({ query: '部署相关的约定' })
    assert.deepStrictEqual(tr.notes.map(n => n.id), rpc.notes.map(n => n.id), 'note_search ≡ notes-search 结果顺序一致')
    assert.strictEqual(tr.notes[0].semantic, true, 'note_search 同样下发语义徽标')
    assert.strictEqual(tr.count, 2, 'note_search count 口径一致')
  })

  await t('开关关=旧行为逐字节（纯文本零语义徽标 + 旧序）', async () => {
    const { handlers, settle } = mk()
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-64' } })
    const nBoth = await handlers['notes-create']({ title: '部署', body: '部署相关的约定' })
    await sleep(50)
    const nText = await handlers['notes-create']({ title: '关于部署相关的约定的记录', body: '其他内容' })
    await settle()
    await handlers['notes-settings-set']({ semantic: { enabled: false } })
    const r = await handlers['notes-search']({ query: '部署相关的约定' })
    assert(!r.notes.some(n => n.semantic), '关=零语义徽标（逐字节旧行为）')
    assert.deepStrictEqual(r.notes.map(n => n.id), [nText.id, nBoth.id], '关=纯文本旧序（_list 序：pinned→updatedAt 降序）')
  })

  await t('sensitive 翻转：任何后端命名空间不再命中（全命名空间出队，残留集不泄漏）', async () => {
    const { handlers, settle } = mk()
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-64' } })
    const X = await handlers['notes-create']({ title: '敏感待翻', body: '发版推送纪律' })
    await settle()
    const rb = await handlers['notes-vectors-rebuild']({ backend: 'fake-256' })
    assert(rb && rb.ok === true, 'rebuild fake-256 建残留命名空间')
    const s64 = await handlers['notes-vectors-search']({ query: '发版推送纪律', backend: 'fake-64' })
    const s256 = await handlers['notes-vectors-search']({ query: '发版推送纪律', backend: 'fake-256' })
    assert(s64.results.some(x => x.noteId === X.id), '翻转前 fake-64 命中 X')
    assert(s256.results.some(x => x.noteId === X.id), '翻转前 fake-256（残留）命中 X')
    await handlers['notes-update']({ id: X.id, sensitive: true })
    await settle()
    const s64b = await handlers['notes-vectors-search']({ query: '发版推送纪律', backend: 'fake-64' })
    const s256b = await handlers['notes-vectors-search']({ query: '发版推送纪律', backend: 'fake-256' })
    assert(!s64b.results.some(x => x.noteId === X.id), '翻转 sensitive 后 fake-64 不再命中 X')
    assert(!s256b.results.some(x => x.noteId === X.id), '翻转 sensitive 后 fake-256（残留）不再命中 X——敏感永不进语义通道在残留面也守')
  })

  await t('融合检索只打激活后端（残留集不检索，语义徽标不误挂）', async () => {
    const { handlers, settle } = mk()
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-256' } })
    const A = await handlers['notes-create']({ title: 'A', body: 'hello world' })   // indexed under fake-256（激活）
    await settle()
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-64' } })  // fake-256 变残留
    await handlers['notes-create']({ title: 'B', body: 'completely different' })    // indexed under fake-64
    await settle()
    const r = await handlers['notes-search']({ query: 'hello world' })
    const aNote = (r.notes || []).find(n => n.id === A.id)
    assert(aNote, 'A 文本命中（body 含 hello world）')
    assert.strictEqual(aNote.semantic, undefined, 'A 不误挂语义徽标（激活=fake-64，残留 fake-256 的 A 不检索）')
  })

  await t('降级链：bge 报错 / 无索引 → 静默纯文本（无 error、无语义徽标）', async () => {
    const { handlers, settle } = mk()
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'bge-small-zh-q8' } })
    await handlers['notes-create']({ title: '发版', body: '发版纪律正文' })
    await settle()
    // bge 嵌入只在浏览器端 → _vectorsSearch 文本 query 抛错 → 融合静默回落纯文本
    const rb = await handlers['notes-search']({ query: '发版' })
    assert(rb && !rb.error, 'bge 报错静默回落纯文本（无 error）')
    assert(Array.isArray(rb.notes) && rb.notes.length >= 1, '纯文本结果照常返回')
    assert(!rb.notes.some(n => n.semantic), '降级路径无语义徽标')
    // 无索引：fake-64 启用但查询无精确块命中 → 语义空 → 纯文本
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-64' } })
    const r2 = await handlers['notes-search']({ query: '完全不存在的查询词' })
    assert(r2 && !r2.error && Array.isArray(r2.notes), '无索引静默纯文本（无 error）')
    assert(!r2.notes.some(n => n.semantic), '无索引无语义徽标')
  })
  }
}
