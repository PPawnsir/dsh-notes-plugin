// 节 125. 0.5.0 R2 保存即嵌入 drain 接通 + 存量回填 host 化（notes-051-save-embed，依赖 R1 的 host embedder）
// 背景：R1（节 124）把 bge 嵌入迁回 host 进程；本卡接通「保存→队列→drain→put」行为链——notes 变更入队
//   （bodyHash 机制不变）→ 2s 防抖微批 drain（单批 ≤8 块，与 R1 并发闸批上限同口径）→ 落边车（保存→可搜 <5s）；
//   rebuild 存量回填真跑（bge 快速失败闸移除——R1 后 host 能嵌入）；双端构建按钮复活为 host rebuild（UI 断言在 120/122）。
// 断言面：①源码锚点（dev/dist 双侧：drain 四件套装/闸移除/status pending 键/读路径强制 drain/rebuild 清挂起）；
//   ②行为链（fake embedder 行为级：改一篇→该篇向量更新）；③防抖合并（连改 3 次只 embed 一次，中间态正文零嵌入）；
//   ④微批压平（2 篇×5 块同窗 → 恰 8/2 两批）；⑤失败不丢（embed 抛错 → pending=1+pendingError 显性；缝换成功 → 重排成功清零）；
//   ⑥保存→可搜即时性（search 强制 drain 不等 2s 防抖尾）；⑦rebuild 权威全量清挂起（挂起期 rebuild → drain 不再重复嵌入）。
// 红线：队列防抖/落盘纪律不变（telemetry-store 同款）；embedder 未就绪入队不丢（status.pending 可见）。
module.exports = {
  id: "125",
  title: "125. 0.5.0 R2 保存即嵌入 drain + 存量回填 host 化（防抖微批/失败不丢/闸移除/读路径强制 drain，notes-051-save-embed）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc } = H
  section('125. 0.5.0 R2 保存即嵌入 drain + 存量回填 host 化（notes-051-save-embed）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const vsDev = read('src/host/kernel/vector-store.js')
  const vsDist = read('src/host/kernel/vector-store.dist.js')

  // ===== 125.1 源码锚点（dev/dist 双侧）=====
  await t('drain 源码锚点（dev/dist 双侧）：防抖四件套 + 快速失败闸移除 + status pending 键 + 读路径强制 drain + rebuild 清挂起', () => {
    for (const [src, tag] of [[vsDev, 'dev'], [vsDist, 'dist']]) {
      assert(src.indexOf('const VECTOR_DRAIN_MS = 2000') >= 0, tag + ' 2s 防抖窗口常量（telemetry-store 同款纪律）')
      assert(src.indexOf('let _vectorPending = new Map()') >= 0, tag + ' 挂起队列（id 集——drain 时经 cache 取最新版，快照竞态消除）')
      assert(src.indexOf('function _vectorQueueIndex(id)') >= 0, tag + ' 入队 + 防抖调度在案')
      assert(src.indexOf('function _vectorDrain()') >= 0 && src.indexOf('function _vectorDrainNow()') >= 0, tag + ' drain/立即 drain 双入口在案')
      assert(src.indexOf('_vectorQueueIndex(n.id)') >= 0, tag + ' 事件总线出口 = 入队（不再逐事件即刻嵌入）')
      assert(src.indexOf('_vectorIndexNote') < 0, tag + ' 旧逐事件 _vectorIndexNote 已拆（drain 取代）')
      // 微批压平 + 批上限同口径
      assert(src.indexOf('i += VECTOR_EMBED_BATCH_MAX') >= 0, tag + ' 跨笔记压平微批 ≤8 块/批（与 R1 并发闸批上限同口径）')
      // bge 快速失败闸移除（R1 后 host 能嵌入——rebuild 真跑）
      assert(src.indexOf('hostEmbed === false') < 0 && src.indexOf('嵌入只在浏览器端运行') < 0, tag + ' rebuild bge 快速失败闸已移除')
      // status 显性面 + 读路径强制 drain
      assert(src.indexOf('pending: _vectorPending.size') >= 0 && src.indexOf('pendingError: _vectorPendingErr') >= 0, tag + ' status pending/pendingError 显性键在案')
      assert(src.indexOf('_vectorDrainNow()') >= 0, tag + ' status/search 读路径强制 drain（读即新鲜，保存→可搜 <5s）')
      // rebuild 权威全量清挂起
      assert(src.indexOf('_vectorPending = new Map()') >= 0 && src.indexOf('clearTimeout(_vectorDrainTimer)') >= 0, tag + ' rebuild 清挂起队列 + 取消防抖计时器（权威全量覆盖）')
      // 失败不丢红线锚
      assert(src.indexOf('_vectorPendingErr = String(') >= 0 && src.indexOf('入队不丢') >= 0, tag + ' drain 失败整批重排回挂起队列 + 报错显性（不自动重试）')
    }
  })

  // ===== 125.2 行为断言（fresh host 实例 + bge 假推理缝计数——真模型不进 CI）=====
  const NOTES_DIR_G = DIR + '\\notes'
  const VECTORS_PATH_G = NOTES_DIR_G + '\\vectors.jsonl'
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
  const settle = async () => { await handlers['notes-vectors-status']({}) }
  const readVectors = () => {
    const raw = store.get(VECTORS_PATH_G)
    if (!raw) return []
    return String(raw).split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))
  }
  // 假推理缝：计数 + 录文本 + 录批形（可换失败态）
  let inferCalls = 0, inferTexts = [], inferBatches = [], inferFail = false
  globalThis.__DSH_NOTES_BGE_INFER__ = async (batch) => {
    inferCalls++
    inferBatches.push(batch.length)
    for (const x of batch) inferTexts.push(String(x))
    if (inferFail) throw new Error('假推理缝失败（模型未下载模拟）')
    return (batch || []).map(() => { const v = new Array(512).fill(0); v[0] = 1; return v })
  }
  const resetCounters = () => { inferCalls = 0; inferTexts = []; inferBatches = []; inferFail = false }
  try {
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'bge-small-zh-q8' } })

    await t('保存→队列→drain→put 行为链：create 即入队 → settle（status 强制 drain）→ 该篇向量落边车（fake 行为级）', async () => {
      resetCounters()
      const n = await handlers['notes-create']({ title: 'D1', body: 'drain 行为链正文甲' })
      assert(inferCalls === 0, '保存瞬间零嵌入（2s 防抖窗口内——不再逐事件即刻嵌入，实得 ' + inferCalls + '）')
      await settle()   // status 读路径强制 drain（不等防抖尾）
      assert(inferCalls === 1, 'drain 后恰嵌入一次（实得 ' + inferCalls + '）')
      assert(inferTexts.join('|').indexOf('drain 行为链正文甲') >= 0, '嵌入文本 = 该篇正文')
      const rows = readVectors().filter(r => r.noteId === n.id && r.backend === 'bge-small-zh-q8')
      assert(rows.length === 1 && rows[0].vector.length === 512 && typeof rows[0].bodyHash === 'string' && rows[0].bodyHash.length > 0, '边车落 1 行（512 维 + bodyHash 锚）')
      const st = await handlers['notes-vectors-status']({})
      assert(st.pending === 0 && st.pendingError === '', '成功后 pending=0/pendingError 空')
      void n
    })

    await t('防抖合并：连改 3 次只 embed 一次（中间态正文零嵌入，drain 取 cache 最新版）', async () => {
      resetCounters()
      const n = await handlers['notes-create']({ title: 'D2', body: '防抖底稿 v0' })
      await settle()   // 建稿先落定（1 次）
      assert(inferCalls === 1, '建稿嵌入 1 次（实得 ' + inferCalls + '）')
      await handlers['notes-update']({ id: n.id, body: '防抖合并 v1（中间态）' })
      await handlers['notes-update']({ id: n.id, body: '防抖合并 v2（中间态）' })
      await handlers['notes-update']({ id: n.id, body: '防抖合并 v3 最终态' })
      await settle()
      assert(inferCalls === 2, '连改 3 次只 embed 一次（总调用 2 = 建稿 1 + 合并 1，实得 ' + inferCalls + '）')
      assert(inferTexts.indexOf('防抖合并 v1（中间态）') < 0 && inferTexts.indexOf('防抖合并 v2（中间态）') < 0, '中间态正文零嵌入（drain 取最新版实证）')
      assert(inferTexts.indexOf('防抖合并 v3 最终态') >= 0, '最终态正文已嵌入')
    })

    await t('微批压平：2 篇 × 5 块同窗入队 → 恰 8/2 两批（跨笔记合并，单批 ≤8）', async () => {
      resetCounters()
      const five = new Array(5).fill('m'.repeat(1800)).join('\n')   // 段落边界恰 5 块
      await handlers['notes-create']({ title: 'M1', body: five })
      await handlers['notes-create']({ title: 'M2', body: five })
      await settle()
      assert(inferCalls === 2 && inferBatches[0] === 8 && inferBatches[1] === 2, '10 块压平恰 8/2 两批（实得 [' + inferBatches.join(',') + ']）')
      assert(inferBatches.every(b => b <= 8), '单批 ≤8（批上限红线）')
    })

    await t('失败不丢（红线）：embed 抛错 → status.pending=1 + pendingError 显性；缝换成功 → 重排成功清零 + 向量落盘', async () => {
      resetCounters()
      inferFail = true
      const n = await handlers['notes-create']({ title: 'F1', body: '失败不丢正文' })
      const st1 = await handlers['notes-vectors-status']({})   // 强制 drain → 失败 → 重排回挂起
      assert(st1.pending === 1, '失败后 pending=1（入队不丢，实得 ' + st1.pending + '）')
      assert(typeof st1.pendingError === 'string' && st1.pendingError.indexOf('假推理缝失败') >= 0, 'pendingError 显性带出原因（实得 ' + st1.pendingError + '）')
      assert(readVectors().filter(r => r.noteId === n.id).length === 0, '失败期零边车行（不写半成品）')
      inferFail = false
      const st2 = await handlers['notes-vectors-status']({})   // 再次 status → 触发重排 → 成功
      assert(st2.pending === 0 && st2.pendingError === '', '恢复后重排成功：pending=0/pendingError 清零')
      assert(readVectors().filter(r => r.noteId === n.id && r.backend === 'bge-small-zh-q8').length === 1, '重排后向量落盘（该篇 1 行）')
    })

    await t('保存→可搜即时性：create 后立即文本 search（不等 2s 防抖尾）→ 强制 drain → 命中新篇', async () => {
      resetCounters()
      const n = await handlers['notes-create']({ title: 'Q1', body: '可搜即时性关键词正文' })
      const r = await handlers['notes-vectors-search']({ query: '可搜即时性', backend: 'bge-small-zh-q8' })
      assert(r && r.ok === true && r.results.some(x => x.noteId === n.id && x.score > 0.99), 'search 强制 drain 后命中新篇（保存→可搜不等防抖尾）')
      assert(inferCalls === 2, 'search 路径恰 2 次推理（drain 新篇 1 + query 文本 1，实得 ' + inferCalls + '）')
    })

    await t('rebuild 权威全量清挂起：挂起期 rebuild → 全量回填真跑（计数）+ 挂起清零（drain 不再重复嵌入）', async () => {
      resetCounters()
      await handlers['notes-create']({ title: 'R1', body: '重建挂起甲' })
      await handlers['notes-create']({ title: 'R2', body: '重建挂起乙' })
      assert(inferCalls === 0, '防抖窗口内零嵌入（挂起中）')
      const rb = await handlers['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' })
      assert(rb && rb.ok === true && rb.indexed >= 2, 'rebuild 真跑全量回填（bge 快速失败闸已拆——0.5.0 R2 前必死路径，实得 indexed=' + (rb && rb.indexed) + '）')
      const callsAfterRebuild = inferCalls
      assert(callsAfterRebuild >= 2, 'rebuild 经假推理缝嵌入（实得 ' + callsAfterRebuild + '）')
      const st = await handlers['notes-vectors-status']({})
      assert(st.pending === 0, 'rebuild 清挂起（pending=0）')
      assert(inferCalls === callsAfterRebuild, 'rebuild 后 drain 零重复嵌入（挂起已清——实得增量 ' + (inferCalls - callsAfterRebuild) + '）')
      assert(st.indexed === st.indexable && st.indexed >= 5, '回填后 indexed=indexable（本节累计 5 篇可索引，实得 ' + st.indexed + '/' + st.indexable + '）')
    })

    await t('双变体逐字节一致回归（drain 改动双侧同步——VECTOR_FLUSH_MS 起切片口径）', () => {
      assert.strictEqual(vsDev.slice(vsDev.indexOf('const VECTOR_FLUSH_MS')), vsDist.slice(vsDist.indexOf('const VECTOR_FLUSH_MS')), 'vector-store dev/dist 逐字节一致（差异仅 VECTORS_PATH 行）')
    })
  } finally { delete globalThis.__DSH_NOTES_BGE_INFER__ }
  }
}
