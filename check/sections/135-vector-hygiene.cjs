// 节 135. 0.6.x 向量层卫生批（notes-061-vector-hygiene：0.5.x 池 [[n-mv1dohzb2q2x]] #8/#9/#10/#11/#2/#12 六项合并）
//   ① indexable 口径精修（池#8）：status N/M 的 M = 非空可索引（_vectorEmbeddable = _vectorIndexable ∧ 切块≥1）——
//     零块笔记（空正文/剥 secret span 后空）不再计入分母；含空正文笔记的库里 rebuild 后 indexable≡indexed；
//     _vectorIndexable 语义不动（该不该索引：出队/sensitive 红线照走），精修的只是计数口径。
//   ② _vectorPendingErr 按来源分键（池#9）：{ drain, rebuild } 各自记账——drain 成功只清 drain 键（rebuild 失败不再被
//     drain 成功抹掉——旧单键双向清零竞态，节 128 驳回遗留 b 本卡治）；rebuild 成功两键并清（权威全量覆盖增量积压，
//     不对称清零裁决在案）；status.pendingError 合并呈现为字符串（响应面零改动，双端 UI 读面不动）。
//   ③ 启动对账（池#10）：模块 init 异步扫边车已载激活命名空间 vs 当前库 bodyHash——不一致/缺失补入 pending 走正常
//     drain（覆盖「重启瞬间恰有未 drain 编辑」缺口）+ 反向清账（停机期删除/翻转的 id 补队由 drain 出队）；
//     闸口：语义未启用零扫描；命名空间未建立（从未构建）跳过（存量回填归 rebuild/激活流程，不替用户发起首次全库嵌入）。
//   ④ lastBuiltAt 持久化（池#11）：边车命名空间首行 meta 行 { meta:true, backend, lastBuiltAt } 落盘 + _vectorLoad 恢复——
//     重启后 status.lastBuiltAt 非空；旧边车无 meta 行 → 缺省 '' 不报错（向后兼容）。
//   ⑤ notes-vectors-put 通道文档化（池#2 裁决：保留不删）：注释标为「外部嵌入后端回写入口（预留给未来自定义后端）」
//     + DEVELOPMENT.md 一句话在案。
//   ⑥ app 护栏口径注释（池#12）：rpc.js RPC_TIMEOUT_MS=20000 处写明「app 20s / client 30s」双口径；涉 app 护栏的
//     「30s」口径错误注释一并修正（纯注释：vector-store/server 双包/app settings/节 127 头注）。
// 红线回归：bge 嵌入/队列/防抖语义不动（节 117/124/125/127/128 既有断言不动语义全绿——仅 #1/#2 口径锚点翻转并在案注明）；
//   边车格式变更向后兼容（旧边车能载）；双变体逐字节一致（VECTOR_FLUSH_MS 起切片口径）。
module.exports = {
  id: "135",
  title: "135. 0.6.x 向量层卫生批（indexable 口径 + pendingErr 分键 + 启动对账 + lastBuiltAt 持久化 + vectors-put 文档化 + 护栏注释口径，notes-061-vector-hygiene）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  section('135. 0.6.x 向量层卫生批（notes-061-vector-hygiene：池 #8/#9/#10/#11/#2/#12）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const vsDev = read('src/host/kernel/vector-store.js')
  const vsDist = read('src/host/kernel/vector-store.dist.js')
  const srvDev = read('src/host/server.js')
  const srvDist = read('src/host/server.dist.js')
  const appRpc = read('src/app/kernel/rpc.js')
  const cliPerf = read('src/client/kernel/perf.js')
  const appSettings = read('src/app/modals/settings.js')
  const devDoc = read('DEVELOPMENT.md')
  const mockSrc = read('scripts/e2e/server.cjs')

  // ===== 135.1 静态锚点（六项 + dev/dist 双变体 + server 双注册契约注释）=====
  await t('静态锚（池#8 口径）：_vectorEmbeddable helper 双侧在案 + status/rebuild 计数面同口径 + e2e mock 对齐', () => {
    for (const [src, tag] of [[vsDev, 'dev'], [vsDist, 'dist']]) {
      assert(src.indexOf('function _vectorEmbeddable(n)') >= 0 && src.indexOf('return _vectorIndexable(n) && _vectorChunks(n.body).length > 0') >= 0, tag + ' _vectorEmbeddable = _vectorIndexable ∧ 切块≥1（_vectorIndexable 语义不动）')
      assert(src.indexOf('for (const n of all) { if (_vectorEmbeddable(n)) indexable++ }') >= 0, tag + ' status indexable 计数走 _vectorEmbeddable（M 不含零块笔记）')
      assert(src.indexOf('indexable: all.filter(_vectorEmbeddable).length') >= 0, tag + ' rebuild 返回面 indexable 同口径（成功路径 indexed≡indexable）')
    }
    assert(mockSrc.indexOf('indexable: notes.filter(function (n) { return vectorIndexable(n) && vectorChunks(n.body).length > 0 }).length') >= 0, 'e2e mock indexable 口径对齐 host（非空可索引——用例 60 N≡M 翻转锚）')
  })

  await t('静态锚（池#9 分键）：{ drain, rebuild } 台账 + drain/rebuild 各自记账 + status.pendingError 合并呈现（响应面字符串零改动）', () => {
    for (const [src, tag] of [[vsDev, 'dev'], [vsDist, 'dist']]) {
      assert(src.indexOf("let _vectorPendingErr = { drain: '', rebuild: '' }") >= 0, tag + ' 分键台账在案（drain/rebuild 各自记账）')
      assert(src.indexOf("_vectorPendingErr.drain = String(") >= 0 && src.indexOf("_vectorPendingErr.rebuild = String(") >= 0, tag + ' drain 失败记 drain 键 / rebuild 失败记 rebuild 键')
      assert(src.indexOf("_vectorPendingErr.drain = ''   // 池#9 分键：drain 成功只清 drain 账") >= 0, tag + ' drain 成功只清 drain 账（rebuild 账不抹）')
      assert(src.indexOf("pendingError: [_vectorPendingErr.drain, _vectorPendingErr.rebuild].filter(Boolean).join('；')") >= 0, tag + ' status.pendingError 合并呈现（双端 UI 读面零改动）')
    }
  })

  await t('静态锚（池#10 启动对账 + 池#11 meta 行）：_vectorReconcileOnBoot init 挂点 + 边车 meta 行序列化/解析双侧在案', () => {
    for (const [src, tag] of [[vsDev, 'dev'], [vsDist, 'dist']]) {
      assert(src.indexOf('async function _vectorReconcileOnBoot()') >= 0, tag + ' 启动对账本体在案')
      assert(src.indexOf("onNoteChanged(_vectorOnNoteChanged)") >= 0 && src.indexOf('_vectorReconcileOnBoot()   // 池#10：启动对账') >= 0, tag + ' 事件总线注册不动 + init 对账挂点在案（fire-and-forget）')
      assert(src.indexOf("if (!ns || (!Object.keys(ns.rows).length && !Object.keys(ns.hash).length)) return") >= 0, tag + ' 闸口：命名空间未建立 → 不对账（存量回填归 rebuild——不替用户发起首次全库嵌入）')
      assert(src.indexOf('JSON.stringify({ meta: true, backend: bid, lastBuiltAt: ns.lastBuiltAt })') >= 0, tag + ' 池#11：meta 行序列化（lastBuiltAt 随边车落盘）')
      assert(src.indexOf('row.meta === true && typeof row.backend === \'string\'') >= 0, tag + ' 池#11：meta 行解析恢复（旧边车无此行 → 缺省空不报错）')
    }
  })

  await t('静态锚（池#2 put 文档化 + 池#12 护栏口径）：注释裁决在案（vector-store/server 双包/DEVELOPMENT/rpc.js/perf.js/app settings）', () => {
    for (const [src, tag] of [[vsDev, 'dev'], [vsDist, 'dist']]) {
      assert(src.indexOf('外部嵌入后端回写入口（预留给未来自定义后端）') >= 0, tag + ' _vectorsPut 注释 = 池#2 裁决口径（保留不删：删=未来接外部后端时要加回）')
      assert(src.indexOf('超前端 30s 护栏') < 0 && src.indexOf('双端护栏口径不一致是现状裁决') >= 0, tag + ' 池#12：rebuild 后台化注释护栏口径修正（app 20s / client 30s 双口径写明）')
    }
    for (const [src, tag] of [[srvDev, 'server.js'], [srvDist, 'server.dist.js']]) {
      assert(src.indexOf('0.6.x 池#2 裁决：外部嵌入后端回写入口——预留给未来自定义后端') >= 0, tag + ' notes-vectors-put 注册契约注释 = 池#2 裁决口径')
      assert(src.indexOf('不再撞前端 RPC 护栏误报——双端护栏口径不一致是现状裁决') >= 0, tag + ' 池#12：rebuild 注册注释护栏口径修正')
    }
    assert(devDoc.indexOf('外部嵌入后端回写入口（预留给未来自定义后端）') >= 0, 'DEVELOPMENT.md 52 RPC 清单处 put 通道裁决一句话在案（池#2 文档化）')
    assert(appRpc.indexOf('app 端 20s（本常量）/ 面板 client 端 30s') >= 0, '池#12：app rpc.js RPC_TIMEOUT_MS=20000 处注释写明双口径')
    assert(cliPerf.indexOf('client 面板端 30s 口径；app 端另是 20s') >= 0, '池#12：client perf.js HOSTCALL_TIMEOUT_MS=30000 处交叉注明（勿想当然对齐）')
    assert(appSettings.indexOf('护栏双口径：app 20s') >= 0 && appSettings.indexOf('不再超 30s RPC 护栏') < 0, '池#12：app settings.js 构建注释口径修正（app 护栏是 20s 不是 30s——旧注释口径错误消除）')
  })

  // ===== 行为断言设施（fresh host 实例族——独立 store/handlers，零污染共享 S；形态同节 117/125）=====
  const NOTES_DIR_V = DIR + '\\notes'
  const VECTORS_PATH_V = NOTES_DIR_V + '\\vectors.jsonl'
  const bootHost = (storeRef) => {
    const fsMockX = {
      resolve: async (p) => p,
      stat: async (p) => { if (p === NOTES_DIR_V) return { dir: true }; if (storeRef.has(p)) return { file: true }; const prefix = p + '\\'; for (const k of storeRef.keys()) if (k.startsWith(prefix)) return { dir: true }; return null },
      listDir: async (p) => { const prefix = p + '\\'; const out = []; for (const k of storeRef.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) }); return out },
      readText: async (p) => { if (!storeRef.has(p)) throw new Error('ENOENT: ' + p); return storeRef.get(p) },
      writeText: async (p, c) => { storeRef.set(p, c) },
    }
    const handlersX = {}
    const harnessMockX = { handle: (name, fn) => { handlersX[name] = fn; return () => { delete handlersX[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    const ctxX = {
      fs: fsMockX, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: S.llmMock, agentDefaultModel: S.admMock, agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
      effect: () => {},
    }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockX, DIR).apply(ctxX)   // apply 即模块 init（池#10 启动对账点火点）
    return handlersX
  }
  // 存量 .md 直读造数（不经 create——冷缓存口径，同节 117 rev2）；body 不给尾随换行：空正文种子 = 真零块
  const seedNote = (storeRef, id, extra, body) => storeRef.set(NOTES_DIR_V + '\\' + id + '.md', '---\nid: ' + id + '\ntitle: ' + id + '\ntopic: 测试\n' + (extra || '') + 'createdAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n' + body)
  const seedSemantic = (storeRef, backend) => storeRef.set(NOTES_DIR_V + '\\settings.json', JSON.stringify({ semantic: { enabled: true, backend: backend || 'fake-256' } }))
  const readVectors = (storeRef) => {
    const raw = storeRef.get(VECTORS_PATH_V)
    if (!raw) return []
    return String(raw).split(/\r?\n/).filter(l => l.trim()).map(l => { try { return JSON.parse(l) } catch (e) { return null } }).filter(r => r && r.noteId)
  }
  const waitRebuild = async (h) => {   // 与双端 UI 同口径轮询承接：building 消旗即完结
    for (let i = 0; i < 500; i++) {
      const st = await h['notes-vectors-status']({})
      if (st && st.building !== true) return st
      await new Promise(r => setTimeout(r, 10))
    }
    throw new Error('waitRebuild 超时：building 不消旗')
  }
  const pollUntil = async (fn, timeoutMs) => {
    const t0 = Date.now()
    while (Date.now() - t0 < (timeoutMs || 10000)) { if (await fn()) return true; await new Promise(r => setTimeout(r, 25)) }
    return false
  }

  // ===== 135.2 池#8 行为级：含零块笔记的库里 M 不含零块篇，rebuild 后 indexable≡indexed =====
  await t('池#8 行为级：空正文 + 纯机密区笔记不计入 M（构建前 M=2 非 4）；rebuild 后 indexable≡indexed≡2 + 零块笔记零边车行', async () => {
    const storeA = new Map()
    seedNote(storeA, 'nz-a', '', '非空正文甲')
    seedNote(storeA, 'nz-b', '', '非空正文乙')
    seedNote(storeA, 'nz-empty', '', '')                                   // 空正文 → 零块
    seedNote(storeA, 'nz-secret', '', '```secret\npwd: abc123\n```')       // 剥 secret span 后空 → 零块（S2 派生口径）
    seedSemantic(storeA, 'fake-256')
    const hA = bootHost(storeA)
    const st0 = await hA['notes-vectors-status']({})
    assert(st0 && st0.indexable === 2 && st0.indexed === 0, '构建前 M=2（零块笔记不计入——旧口径为 4），indexed=0（实得 ' + (st0 && st0.indexed) + '/' + (st0 && st0.indexable) + '）')
    const rb = await hA['notes-vectors-rebuild']({ backend: 'fake-256' })
    assert(rb && rb.ok === true && rb.started === true, 'rebuild 立即返回 started（P1 形态不动）')
    const st = await waitRebuild(hA)
    assert(st.indexed === 2 && st.indexable === 2, '池#8 断言口径：含零块笔记的库里 rebuild 后 indexable≡indexed≡2（实得 ' + st.indexed + '/' + st.indexable + '）')
    assert(readVectors(storeA).filter(r => r.noteId === 'nz-empty' || r.noteId === 'nz-secret').length === 0, '零块笔记零边车行（rebuild chunks.length>0 跳过口径不动）')
  })

  // ===== 135.3 池#9 行为级：分键记账（bge 假推理缝可换失败态——真模型不进 CI）=====
  await t('池#9 行为级：rebuild 失败不被 drain 成功抹掉；rebuild 成功两键并清；drain 失败/成功自循环（合并呈现响应面不动）', async () => {
    const storeB = new Map()
    seedNote(storeB, 'sp-a', '', '分键正文甲')
    const hB = bootHost(storeB)
    let inferFail = false, inferMsg = ''
    globalThis.__DSH_NOTES_BGE_INFER__ = async (batch) => {
      if (inferFail) throw new Error(inferMsg)
      return (batch || []).map(() => { const v = new Array(512).fill(0); v[0] = 1; return v })
    }
    try {
      await hB['notes-settings-set']({ semantic: { enabled: true, backend: 'bge-small-zh-q8' } })
      await hB['notes-create']({ title: 'SP1', body: '分键基线正文' })
      let st = await hB['notes-vectors-status']({})
      assert(st.pending === 0 && st.pendingError === '', '基线 drain 成功：pending=0/pendingError 空（合并呈现空串口径不动）')
      // rebuild 失败（缝抛错）→ rebuild 键记账
      inferFail = true; inferMsg = '重建失败模拟-B'
      const rf = await hB['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' })
      assert(rf && rf.ok === true && rf.started === true, '失败也立即返回 started（P1 契约不动）')
      st = await waitRebuild(hB)
      assert(typeof st.pendingError === 'string' && st.pendingError.indexOf('重建失败模拟-B') >= 0, 'rebuild 失败落 rebuild 键（合并呈现可见，实得 ' + st.pendingError + '）')
      // 核心断言：缝恢复 + 新建一篇 → drain 成功 → rebuild 账不抹
      inferFail = false
      await hB['notes-create']({ title: 'SP2', body: 'drain 成功正文' })
      st = await hB['notes-vectors-status']({})
      assert(st.pending === 0, 'drain 重排成功（pending=0）')
      assert(st.pendingError.indexOf('重建失败模拟-B') >= 0, '池#9 核心断言：rebuild 失败不被后续 drain 成功抹掉（分键记账——实得 ' + st.pendingError + '）')
      // rebuild 成功 → 两键并清（权威全量覆盖增量积压——不对称清零裁决）
      const r3 = await hB['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' })
      assert(r3 && r3.ok === true && r3.started === true, '恢复后再建 started')
      st = await waitRebuild(hB)
      assert(st.pendingError === '' && st.indexed === 3, 'rebuild 成功两键并清 + 全量爬满（indexed=3，pendingError 实得 ' + JSON.stringify(st.pendingError) + '）')
      // drain 失败/成功自循环（drain 键独立记账）
      inferFail = true; inferMsg = 'drain失败模拟-D'
      await hB['notes-create']({ title: 'SP3', body: 'drain 失败正文' })
      st = await hB['notes-vectors-status']({})
      assert(st.pending === 1 && st.pendingError.indexOf('drain失败模拟-D') >= 0, 'drain 失败落 drain 键（pending=1 入队不丢，实得 ' + st.pendingError + '）')
      inferFail = false
      st = await hB['notes-vectors-status']({})
      assert(st.pending === 0 && st.pendingError === '', 'drain 重排成功只清 drain 键（rebuild 键本空——合并归零）')
    } finally { delete globalThis.__DSH_NOTES_BGE_INFER__ }
  })

  // ===== 135.4 池#10 行为级：启动对账（脏边车 → init 补 pending → drain 对齐）+ 闸口零成本 =====
  await t('池#10 行为级：脏边车（hash 旧于正文 + 幽灵 id）→ init 对账补入 pending → drain 后新鲜度对齐 + 幽灵清除 + 旧边车无 meta 行兼容', async () => {
    const storeC = new Map()
    seedNote(storeC, 'boot-a', '', '对账正文甲')
    seedSemantic(storeC, 'fake-256')
    const vec = new Array(256).fill(0); vec[0] = 1
    // 脏状态构造：boot-a 边车 hash 旧于正文（重启瞬间未 drain 编辑缺口形态）+ boot-ghost 停机期已删除（库中不存在）；
    //   旧格式边车（无 meta 行——池#11 向后兼容面一并覆盖）
    storeC.set(VECTORS_PATH_V, [
      JSON.stringify({ noteId: 'boot-a', chunk: 0, bodyHash: 'stale.hash', backend: 'fake-256', vector: vec }),
      JSON.stringify({ noteId: 'boot-ghost', chunk: 0, bodyHash: 'ghost.hash', backend: 'fake-256', vector: vec }),
    ].join('\n') + '\n')
    const hC = bootHost(storeC)   // apply 即模块 init → 启动对账异步点火
    // 对账补队是 init 后异步扫描——轮询 status（读路径强制 drain + flush）直至边车对齐（等价于「init 后 pending 含该笔记 → drain 后对齐」的行为级证据）
    const ok = await pollUntil(async () => {
      await hC['notes-vectors-status']({})
      const rows = readVectors(storeC).filter(r => r.noteId === 'boot-a' && r.backend === 'fake-256')
      return rows.length === 1 && rows[0].bodyHash !== 'stale.hash'
    })
    assert(ok, 'init 对账补入 pending → drain 重写边车（bodyHash 由 stale.hash 翻转——「重启瞬间恰有未 drain 编辑」缺口补齐）')
    assert(readVectors(storeC).filter(r => r.noteId === 'boot-ghost').length === 0, '反向清账：幽灵 id（停机期删除）向量行被 drain 出队清除')
    const st = await hC['notes-vectors-status']({})
    assert(st && st.indexed === 1 && st.indexable === 1 && st.pending === 0 && st.pendingError === '', '对账后 status：indexed=indexable=1/pending=0/零报错（实得 ' + JSON.stringify({ indexed: st.indexed, indexable: st.indexable, pending: st.pending }) + '）')
    assert(st.lastBuiltAt === '' && String(storeC.get(VECTORS_PATH_V)).indexOf('"meta":true') < 0, '旧边车无 meta 行 → lastBuiltAt 缺省空不报错（池#11 向后兼容）；未构建不写 meta 行')
  })

  await t('池#10 闸口（零成本红线）：语义未启用 → 启动对账零扫描零入队（脏边车逐字节保留）；命名空间未建立 → 不背首次全库嵌入', async () => {
    // 闸口一：语义缺省关闭——对账不跑（边车原样）
    const storeD = new Map()
    seedNote(storeD, 'boot-off', '', '关闭态正文')
    const vec = new Array(256).fill(0); vec[0] = 1
    storeD.set(VECTORS_PATH_V, JSON.stringify({ noteId: 'boot-off', chunk: 0, bodyHash: 'stale.hash', backend: 'fake-256', vector: vec }) + '\n')
    const hD = bootHost(storeD)
    const beforeD = String(storeD.get(VECTORS_PATH_V))
    let stD = null
    for (let i = 0; i < 5; i++) { stD = await hD['notes-vectors-status']({}); await new Promise(r => setTimeout(r, 20)) }
    assert(String(storeD.get(VECTORS_PATH_V)) === beforeD, '语义未启用 → 启动对账不跑（脏边车逐字节保留——缺省关闭零成本红线）')
    assert(stD && stD.enabled === false && stD.pending === 0, 'status 缺省关闭口径不动（enabled:false/pending=0）')
    // 闸口二：语义启用但命名空间未建立（从未构建）→ 跳过（存量回填归 rebuild/激活流程）
    const storeE = new Map()
    seedNote(storeE, 'boot-new', '', '未构建库正文')
    seedSemantic(storeE, 'fake-256')
    const hE = bootHost(storeE)
    const stE = await hE['notes-vectors-status']({})
    assert(!storeE.has(VECTORS_PATH_V), '命名空间未建立 → 启动对账跳过：vectors.jsonl 不因启动创建（不替用户发起首次全库嵌入）')
    assert(stE && stE.indexed === 0 && stE.indexable === 1, '未构建 status：indexed=0/indexable=1（回填缺口显性照旧——节 120 红线②口径不动）')
  })

  // ===== 135.5 池#11 行为级：lastBuiltAt 持久化（rebuild → meta 行落盘 → 重启恢复）=====
  await t('池#11 行为级：rebuild 盖章随边车 meta 行落盘 → 重启（同 store 第二 host 实例重载边车）→ status.lastBuiltAt 恢复非空', async () => {
    const storeF = new Map()
    seedNote(storeF, 'persist-a', '', '持久化正文甲')
    seedSemantic(storeF, 'fake-256')
    const hF = bootHost(storeF)
    const rb = await hF['notes-vectors-rebuild']({ backend: 'fake-256' })
    assert(rb && rb.ok === true && rb.started === true, 'rebuild started')
    const st1 = await waitRebuild(hF)
    assert(st1.lastBuiltAt && Date.parse(st1.lastBuiltAt) > 0, 'rebuild 成功盖章（lastBuiltAt 有效 ISO）')
    const raw = String(storeF.get(VECTORS_PATH_V) || '')
    const metaLines = raw.split('\n').filter(l => l.indexOf('"meta":true') >= 0)
    assert(metaLines.length === 1, '边车恰一行命名空间 meta 行（lastBuiltAt 落盘，实得 ' + metaLines.length + '）')
    const meta = JSON.parse(metaLines[0])
    assert(meta.meta === true && meta.backend === 'fake-256' && meta.lastBuiltAt === st1.lastBuiltAt, 'meta 行内容 = { meta:true, backend, lastBuiltAt }（与盖章一致）')
    // 重启模拟：同一 store 起第二 host 实例（_vectorLoad 从磁盘字节恢复；对账扫描 hash 新鲜零补队）
    const hF2 = bootHost(storeF)
    const st2 = await hF2['notes-vectors-status']({})
    assert(st2 && st2.lastBuiltAt === st1.lastBuiltAt, '重启后 status.lastBuiltAt 恢复（池#11：设置区「上次构建」不再空白，实得 ' + JSON.stringify(st2.lastBuiltAt) + '）')
    const ns2 = (st2.namespaces || []).filter(n => n.backend === 'fake-256')[0]
    assert(ns2 && ns2.lastBuiltAt === st1.lastBuiltAt && st2.indexed === 1, 'namespaces[].lastBuiltAt 同步恢复 + 索引计数随边车保留（indexed=1）')
    assert(String(storeF.get(VECTORS_PATH_V)).indexOf('"meta":true') >= 0, '重启实例 status 读后边车 meta 行仍在（对账零补队零重写污染）')
  })

  // ===== 135.6 双变体逐字节一致回归（六项改动双侧同步——VECTOR_FLUSH_MS 起切片口径）=====
  await t('双变体逐字节一致回归（卫生批改动双侧同步——VECTOR_FLUSH_MS 起切片口径）', () => {
    assert.strictEqual(vsDev.slice(vsDev.indexOf('const VECTOR_FLUSH_MS')), vsDist.slice(vsDist.indexOf('const VECTOR_FLUSH_MS')), 'vector-store dev/dist 逐字节一致（差异仅 VECTORS_PATH 行 + 变体说明行）')
    assert(hostSrc.indexOf('_vectorReconcileOnBoot') >= 0 && indexSrc.indexOf('_vectorReconcileOnBoot') >= 0, '双包拼接产物含启动对账（dev hostSrc / dist index.mjs 源）')
    assert(indexSrc.indexOf('外部嵌入后端回写入口') >= 0, 'dist index.mjs 含池#2 put 裁决注释')
  })
  }
}
