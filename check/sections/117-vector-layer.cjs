// 节 117. 0.5.0① host 向量层（notes-050-vector-layer：语义检索地基——vectors.jsonl 边车 + backend 窄接口注册表 + 索引队列 + 分段嵌入 + 三条 RPC）
// 冻结架构 [[n-muz9b97x35et]] + spike [[n-muz91f19rrqj]]。本卡纯 host 地基（不动 UI）：真 wasm 后端②卡、检索融合③卡、设置区④卡。
// 断言面：边车格式/增量（bodyHash 变才重算）/墓碑（软删出队）/sensitive 排除（id 永不出现在边车）/命名空间隔离（两后端各建各的）/
//   分段（>1800 长笔记出多块 + per-note max-pooling 取最高）/窄接口契约（桩后端 minScore 自报生效）。
module.exports = {
  id: "117",
  title: "117. 0.5.0① host 向量层（vectors.jsonl 边车 + backend 注册表 + 索引队列 + 分段嵌入 + 三 RPC，notes-050-vector-layer）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { llmMock, admMock, agentsMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('117. 0.5.0① host 向量层（notes-050-vector-layer）')

  // ===== 源码结构断言（dev/dist 双侧 + mock 三 case + 变体逐字节一致）=====
  const vsDev = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'vector-store.js'), 'utf8').replace(/\r\n/g, '\n')
  const vsDist = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'vector-store.dist.js'), 'utf8').replace(/\r\n/g, '\n')
  const headSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'head.js'), 'utf8').replace(/\r\n/g, '\n')
  const mockSrc = fsNative.readFileSync(path.join(DIR, 'scripts', 'e2e', 'server.cjs'), 'utf8')

  await t('双包注册：notes-vectors-status/rebuild/search 三 RPC（dev + dist）+ e2e mock 三 case', () => {
    for (const src of [hostSrc, indexSrc]) {
      assert(src.indexOf("handle('notes-vectors-status'") >= 0, '注册 notes-vectors-status')
      assert(src.indexOf("handle('notes-vectors-rebuild'") >= 0, '注册 notes-vectors-rebuild')
      assert(src.indexOf("handle('notes-vectors-search'") >= 0, '注册 notes-vectors-search')
    }
    for (const m of ['notes-vectors-status', 'notes-vectors-rebuild', 'notes-vectors-search']) {
      assert(mockSrc.indexOf("case '" + m + "':") >= 0, 'e2e mock 落 ' + m + ' 用例桩（113 契约闸注册对等）')
    }
  })

  await t('vector-store 双变体逐字节一致（差异仅 VECTORS_PATH 定义行 + 变体说明行）：dev 定义 NOTES_DIR 拼接、dist 由 head.js 定义', () => {
    assert(vsDev.indexOf("const VECTORS_PATH = NOTES_DIR + '\\\\vectors.jsonl'") >= 0, 'dev vector-store.js 定义 VECTORS_PATH（NOTES_DIR 拼接）')
    assert(vsDist.indexOf('const VECTORS_PATH') < 0, 'dist vector-store.dist.js 不定义 VECTORS_PATH（由 head.js 定义）')
    assert(headSrc.indexOf("const VECTORS_PATH = path.join(NOTES_ROOT, 'vectors.jsonl')") >= 0, 'dist head.js 定义 VECTORS_PATH（path.join）')
    assert.strictEqual(vsDev.slice(vsDev.indexOf('const VECTOR_FLUSH_MS')), vsDist.slice(vsDist.indexOf('const VECTOR_FLUSH_MS')), 'VECTOR_FLUSH_MS 起两变体逐字节一致')
  })

  await t('status indexable 精确计数（0.5.0 P0 rev2）：走 _list 全库扫描 + _vectorIndexable 过滤（同 rebuild 口径，灭冷缓存低报）', () => {
    assert(vsDev.indexOf('await _list(undefined, undefined, undefined, false, false, true)') >= 0, 'status indexable 走 _list 全库扫描（与 rebuild 同口径，含 sys）')
    assert(vsDev.indexOf('for (const n of all) { if (_vectorIndexable(n)) indexable++ }') >= 0, 'status indexable 逐条 _vectorIndexable 过滤（排除 deleted/tombstoned/sensitive/sys）')
    assert(vsDev.indexOf('for (const n of cache.values())') < 0, 'status indexable 不再走 cache.values()（冷缓存低报已拆）')
    assert(vsDist.indexOf('await _list(undefined, undefined, undefined, false, false, true)') >= 0, 'dist 变体同改（_list 精确计数）')
  })

  await t('e2e mock bge rebuild 真跑（0.5.0 R2 notes-051-save-embed：快速失败闸移除——R1 后 host 能嵌入，双端构建按钮=host rebuild）', () => {
    assert(mockSrc.indexOf("'bge-small-zh-q8': { id: 'bge-small-zh-q8', dim: 512, minScore: 0.5 }") >= 0, 'mock bge 后端无 hostEmbed:false 标记（R2 起 mock rebuild 真跑，与 host 同口径）')
    assert(mockSrc.indexOf('hostEmbed === false') < 0 && mockSrc.indexOf('嵌入只在浏览器端运行') < 0, 'mock rebuild 快速失败闸已拆（bge 快速失败闸断言移除）')
    assert(mockSrc.indexOf('state._vectorRebuildError') >= 0, 'mock rebuild 显式失败桩在案（用例㊽ sticky 报错数据源）')
  })

  // ===== 行为断言（fresh host 实例：独立 store/handlers，计数确定，零污染共享 S）=====
  const NOTES_DIR_V = DIR + '\\notes'
  const VECTORS_PATH = NOTES_DIR_V + '\\vectors.jsonl'
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
  const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply(ctx)
  const readVectors = () => {
    const raw = store.get(VECTORS_PATH)
    if (!raw) return []
    return String(raw).split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))
  }
  const rowsOf = (noteId, backend) => readVectors().filter(r => r.noteId === noteId && (backend === undefined || r.backend === backend))
  const settle = async () => { await handlers['notes-vectors-status']({}) }

  await t('缺省关闭零成本：未启用语义时 status enabled:false + backend:null + 无任何边车写入', async () => {
    const st = await handlers['notes-vectors-status']({})
    assert(st && st.ok === true && st.enabled === false && st.backend === null, '缺省 enabled:false/backend:null（实得 ' + JSON.stringify(st) + '）')
    assert(st.indexed === 0 && st.indexable === 0 && st.namespaces.length === 0, '缺省零命名空间零计数')
    assert(!store.has(VECTORS_PATH), '缺省不写 vectors.jsonl（零成本红线）')
  })

  await t('保存路径挂钩（增量）：启用语义后 create 即入边车（行格式 noteId/chunk/bodyHash/backend/vector 全齐）', async () => {
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-256' } })
    const b = await handlers['notes-create']({ title: 'B', body: 'hello world' })
    await settle()
    const rows = rowsOf(b.id, 'fake-256')
    assert(rows.length === 1, '单块笔记恰 1 行（实得 ' + rows.length + '）')
    const r = rows[0]
    assert(r.chunk === 0 && r.backend === 'fake-256' && typeof r.bodyHash === 'string' && r.bodyHash.length > 0, '行格式字段齐备（chunk/bodyHash/backend）')
    assert(Array.isArray(r.vector) && r.vector.length === 256, 'vector = 256 维数组')
  })

  await t('增量（bodyHash 变才重算）：同正文元数据更新 hash 不变、正文变 hash/向量变', async () => {
    const rows0 = readVectors().filter(r => r.backend === 'fake-256')
    const bid = rows0[0].noteId
    const hash0 = rows0[0].bodyHash
    const vec0 = JSON.stringify(rows0[0].vector)
    await handlers['notes-update']({ id: bid, title: 'B 改' })
    await settle()
    const r1 = rowsOf(bid, 'fake-256')[0]
    assert(r1.bodyHash === hash0 && JSON.stringify(r1.vector) === vec0, '同正文元数据更新 → bodyHash/向量不变（增量不重算）')
    await handlers['notes-update']({ id: bid, body: 'goodbye world' })
    await settle()
    const r2 = rowsOf(bid, 'fake-256')[0]
    assert(r2.bodyHash !== hash0 && JSON.stringify(r2.vector) !== vec0, '正文变 → bodyHash/向量变（重算）')
  })

  await t('墓碑（软删出队）：delete 后该笔记向量行全部移除', async () => {
    const bid = readVectors().filter(r => r.backend === 'fake-256')[0].noteId
    await handlers['notes-delete']({ id: bid })
    await settle()
    assert(rowsOf(bid, 'fake-256').length === 0, '软删后向量行移除（墓碑出队）')
  })

  await t('sensitive 排除红线：sensitive 笔记 id 永不出现在边车（正文不进 embed 队列）', async () => {
    const s = await handlers['notes-create']({ title: 'S', body: 'secret-key-abc123', sensitive: true })
    await settle()
    assert(readVectors().filter(r => r.noteId === s.id).length === 0, 'sensitive 笔记零向量行（id 永不出现在边车）')
  })

  let _LId = null, _CId = null
  await t('分段嵌入：>1800 字符长笔记出多块（chunk=块序共享同一 bodyHash），短笔记单块零开销', async () => {
    const long = await handlers['notes-create']({ title: 'L', body: 'y'.repeat(1800) + '\nhello world' })
    await settle()
    _LId = long.id
    const rows = rowsOf(long.id, 'fake-256')
    assert(rows.length === 2, '长笔记（1812 字符）出 2 块（实得 ' + rows.length + '）')
    assert(rows[0].chunk === 0 && rows[1].chunk === 1, 'chunk=块序 0/1')
    assert(rows[0].bodyHash === rows[1].bodyHash, '两块共享同一 bodyHash（全文 hash 锚）')
    const c = await handlers['notes-create']({ title: 'C', body: 'hello world' })
    await settle()
    _CId = c.id
    assert(rowsOf(c.id, 'fake-256').length === 1, '短笔记单块零开销')
  })

  await t('全量重建统计口径：rebuild 精确 indexed/indexable（排除 deleted/sensitive/sys）+ lastBuiltAt + 窄接口自报 dim/minScore', async () => {
    const r = await handlers['notes-vectors-rebuild']({ backend: 'fake-256' })
    assert(r && r.ok === true && r.backend === 'fake-256' && r.dim === 256 && r.minScore === 0, 'rebuild fake-256 自报 dim=256/minScore=0')
    assert(r.indexed === 2 && r.indexable === 2, 'indexed=indexable=2（短笔记 C + 长笔记 L；deleted B/sensitive S/sys 索引均排除，实得 ' + r.indexed + '/' + r.indexable + '）')
    assert(r.lastBuiltAt && Date.parse(r.lastBuiltAt) > 0, 'lastBuiltAt 有效 ISO 时间')
  })

  await t('检索 + per-note max-pooling：查询命中长笔记尾块，每 note 只出一条（chunk=胜出块序，score=最高块）', async () => {
    const r = await handlers['notes-vectors-search']({ query: 'hello world', backend: 'fake-256', limit: 20 })
    assert(r && r.ok === true && r.backend === 'fake-256' && r.dim === 256 && r.minScore === 0, 'search 自报 backend/dim/minScore')
    const byId = {}
    for (const it of r.results) byId[it.noteId] = it
    assert(byId[_LId] && byId[_LId].chunk === 1 && byId[_LId].score > 0.99, '长笔记命中胜出块 chunk=1（score ' + (byId[_LId] && byId[_LId].score) + '）——max-pooling 取最高块')
    assert(byId[_CId] && byId[_CId].chunk === 0 && byId[_CId].score > 0.99, '短笔记命中 chunk=0')
    assert(r.results.length === 2, '结果集每 note 恰一条（max-pooling 不重复，实得 ' + r.results.length + '）')
  })

  await t('命名空间隔离：rebuild fake-64 不清空 fake-256（换后端不重建、旧集保留）+ status 各命名空间统计', async () => {
    const before = readVectors().filter(r => r.backend === 'fake-256').length
    const r64 = await handlers['notes-vectors-rebuild']({ backend: 'fake-64' })
    assert(r64 && r64.ok === true && r64.backend === 'fake-64' && r64.dim === 64 && r64.minScore === 0.9, 'rebuild fake-64 自报 dim=64/minScore=0.9')
    const after = readVectors().filter(r => r.backend === 'fake-256').length
    assert(after === before && before > 0, 'rebuild fake-64 后 fake-256 命名空间保留（换后端不重建）')
    const both = readVectors()
    assert(both.some(r => r.backend === 'fake-256') && both.some(r => r.backend === 'fake-64'), '边车两后端命名空间并存（各建各的）')
    const st = await handlers['notes-vectors-status']({})
    const nsIds = (st.namespaces || []).map(n => n.backend).sort()
    assert(nsIds.indexOf('fake-256') >= 0 && nsIds.indexOf('fake-64') >= 0, 'status 各命名空间统计含两后端')
  })

  await t('窄接口契约（minScore 自报生效）：fake-64（0.9）过滤余弦 0 结果，fake-256（0）不过滤', async () => {
    const r64 = await handlers['notes-vectors-search']({ queryVector: new Array(64).fill(0), backend: 'fake-64' })
    assert(r64 && r64.ok === true && r64.minScore === 0.9, 'fake-64 minScore 自报 0.9')
    assert(r64.count === 0 && r64.results.length === 0, 'fake-64（minScore 0.9）过滤余弦 0 结果（count ' + r64.count + '）')
    const r256 = await handlers['notes-vectors-search']({ queryVector: new Array(256).fill(0), backend: 'fake-256' })
    assert(r256 && r256.ok === true && r256.minScore === 0, 'fake-256 minScore 自报 0')
    assert(r256.count >= 2, 'fake-256（minScore 0）不过滤余弦 0 结果（count ' + r256.count + '）')
  })

  // ===== 0.5.0 P0 rev2：status indexable 冷缓存精确计数（存量 .md 直读，不经任何 create/list 暖缓存）=====
  await t('status indexable 冷缓存精确计数：存量 .md 直读（无 create/list 暖缓存）→ indexable 与 rebuild 同口径（排除 deleted/sensitive/sys）', async () => {
    const storeC = new Map()
    const NOTES_DIR_C = DIR + '\\notes'
    const seedC = (id, extra, body) => storeC.set(NOTES_DIR_C + '\\' + id + '.md', '---\nid: ' + id + '\ntitle: ' + id + '\ntopic: 测试\n' + (extra || '') + 'createdAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n' + body + '\n')
    seedC('n-cold-a', '', '冷甲正文')
    seedC('n-cold-b', '', '冷乙正文')
    seedC('n-cold-sens', 'sensitive: true\n', '敏感正文')
    seedC('n-cold-sys', 'kind: sys\n', '系统正文')
    seedC('n-cold-del', 'deleted: true\n', '已删正文')
    const fsMockC = {
      resolve: async (p) => p,
      stat: async (p) => { if (p === NOTES_DIR_C) return { dir: true }; if (storeC.has(p)) return { file: true }; const prefix = p + '\\'; for (const k of storeC.keys()) if (k.startsWith(prefix)) return { dir: true }; return null },
      listDir: async (p) => { const prefix = p + '\\'; const out = []; for (const k of storeC.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) }); return out },
      readText: async (p) => { if (!storeC.has(p)) throw new Error('ENOENT: ' + p); return storeC.get(p) },
      writeText: async (p, c) => { storeC.set(p, c) },
    }
    const handlersC = {}
    const harnessMockC = { handle: (name, fn) => { handlersC[name] = fn; return () => { delete handlersC[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    const ctxC = {
      fs: fsMockC, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockC, DIR).apply(ctxC)
    const stC = await handlersC['notes-vectors-status']({})
    assert(stC && stC.indexable === 2, '冷缓存 indexable=2（普通甲/乙；deleted/sensitive/sys 均排除，实得 ' + (stC && stC.indexable) + '）')
  })
  }
}
