// 节 78. 0.4.3+ 卡⑫：统一召回遥测——五通道 × 交付/使用事件流水 + 分通道召回率（notes-043-inject-receipt）
// 行为规格（主窗口修订设计）：
//   ①流水：RootNote 框架懒建「召回遥测（自动）」根笔记（kind=sys + recall=false + inject 红线锁 + settings.recallNoteId 软链 + 容量 400 裁尾）；
//     低频通道（inject/mount/catalog）记原始回执行 {ts,channel,ids[],session?}（装配类签名去重防写盘风暴）；
//     高频通道（search/get）记日聚合行 {day,channel,id,count} 行级 upsert 幂等（同日同键计数累加不爆行，3s 防抖批量落盘 + 卸载 flush）。
//   ②五处埋点（全部静默降级零阻塞）：conventionText/catalogText 真实渲染路径（预览 sidOverride 不计）/ _dispatch 派发成功 /
//     notes-search RPC + note_search 工具（实际返回页）/ notes-get RPC + note_get 工具（成功返回才计）。
//   ③查询面：notes-recall-stats {sinceDays?} → 五通道分列 {delivered, deliveries, used, uses, rate}
//     （rate = 交付去重笔记中窗口内被 get 实际取用的比例；get 通道纯使用信号 rate=null）；账本 §2 旁挂分通道召回率行（口径不混算标注）。
// 红线看守：埋点零阻塞（fire-and-forget + 吞异常）；查询语义零变化（既有返回结构零改动——既有节全绿即证）；sys 排除契约。
module.exports = {
  id: "78",
  title: "78. 统一召回遥测：五通道交付/使用事件流水 + 分通道召回率（notes-043-inject-receipt）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { NOTES_DIR, handlers, registeredContexts, llmMock, admMock, agentsMock, sessionPersistenceMock, workspaceRegistryMock, sessionTitleMock, sessionQueryMock, mkFsMockImp } = S
  section('78. 统一召回遥测：五通道交付/使用事件流水 + 分通道召回率（notes-043-inject-receipt）')
  const dayStr = (function () { const d = new Date(); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
  const parseRows = (body) => String(body || '').split('\n').map(l => { const m = l.match(/^\s*-\s(\{.*\})\s*$/); if (!m) return null; try { return JSON.parse(m[1]) } catch (e) { return null } }).filter(Boolean)
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'
  // 共享实例被节 17（静态包）/21/58 多次 plugin.apply 重挂：handlers 恒指向最新作用域，registeredContexts 逐次追加——
  //   取 LAST 匹配 = 当前活跃作用域的装配函数（取第一个会读到重挂前的陈旧闭包 cache，装配看不到新建笔记）
  const lastCtx = (name) => { const all = registeredContexts.filter(c => c.name === name); return all[all.length - 1] }

  // ---- 78.0 落地结构：recall.js 双清单共源 + 序位 + 标记块/核心 API/RPC + 五处埋点锚双包双侧同步 + 账本旁挂锚 ----
  await t('卡⑫ 落地结构：src/host/recall.js 双清单同名共源 + 序位（ledger 之后）+ 标记块/核心 API/RPC + 五处埋点锚双包同步', () => {
    assert(fsNative.existsSync(path.join(DIR, 'src', 'host', 'recall.js')), 'src/host/recall.js 存在')
    const devM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dev.js'), 'utf8')
    const distM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dist.js'), 'utf8')
    assert(devM.indexOf("'recall.js'") >= 0 && distM.indexOf("'recall.js'") >= 0, '双清单同名登记 recall.js（共源单份）')
    assert(devM.indexOf("'ledger.js'") < devM.indexOf("'recall.js'") && devM.indexOf("'recall.js'") < devM.indexOf("'inject/img-path-hint.js'"), 'dev 序位：ledger.js 之后、inject/img-path-hint.js 之前')
    assert(distM.indexOf("'ledger.js'") < distM.indexOf("'recall.js'") && distM.indexOf("'recall.js'") < distM.indexOf("'inject/img-path-hint.js'"), 'dist 序位同上')
    assert(!fsNative.existsSync(path.join(DIR, 'src', 'host', 'recall.dist.js')), 'recall.js 不得出现 .dist 变体（第三份拷贝红线）')
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('==== recall-telemetry BEGIN ====') >= 0 && src.indexOf('==== recall-telemetry END ====') >= 0, tag + ' 含 recall-telemetry 标记块')
      assert(src.indexOf('function _recallRaw(') >= 0 && src.indexOf('function _recallHit(') >= 0 && src.indexOf('async function _recallFlushAgg(') >= 0, tag + ' 埋点 API 在位（raw/hit/flushAgg）')
      assert(src.indexOf('async function _recallStats(') >= 0 && src.indexOf('function _recallFmtChannels(') >= 0, tag + ' 查询面 API 在位（stats/fmtChannels）')
      assert(src.indexOf("handle('notes-recall-stats'") >= 0, tag + ' notes-recall-stats RPC 注册')
      assert(src.indexOf('const RECALL_TPL = rootNoteTpl(') >= 0 && src.indexOf('const RECALL_MAX = 400') >= 0, tag + ' RootNote 模板消费 + 容量 400 裁尾')
      assert(src.indexOf("kind: 'sys', inject: false, recall: false") >= 0, tag + ' sys 根笔记创建契约（kind=sys + inject=false + recall=false）')
      assert(src.indexOf('settingsCache.recallNoteId') >= 0, tag + ' settings.recallNoteId 软链指针')
      assert(src.indexOf('await _recallFlushAgg()') >= 0, tag + ' stats 读前落账（自洽读）')
    }
    // 五处埋点锚（逐文件看守双侧同步，防单侧漏改）
    const read = (rel) => fsNative.readFileSync(path.join(DIR, 'src', 'host', rel), 'utf8')
    for (const f of ['inject.js', 'inject.dist.js']) {
      assert(read(f).indexOf("_recallRaw('inject'") >= 0 && read(f).indexOf("_recallRaw('catalog'") >= 0, f + ' inject/catalog 装配埋点在位')
    }
    for (const f of ['dispatch.js', 'dispatch.dist.js']) assert(read(f).indexOf("_recallRaw('mount'") >= 0, f + ' mount 派发埋点在位')
    assert(read('search.js').indexOf("_recallHit('search'") >= 0, 'search.js notes-search 埋点在位（共源单份）')
    for (const f of ['server.js', 'server.dist.js', 'index.js', 'index.dist.js']) assert(read(f).indexOf("_recallHit('get'") >= 0, f + ' get 取用埋点在位')
    for (const f of ['index.js', 'index.dist.js']) assert(read(f).indexOf('_recallFlushAgg()') >= 0, f + ' 卸载 flush 挂载点在位')
    // 驳回修复回归锚（Verifier 2026-10-05）：①inject 资料桶 id——refBlocks 保对象形态 + refLines 渲染行，遥测取存活切片；
    //   ②原始行签名集合序（排序 join，同 id 集换序不重复记）
    for (const f of ['inject.js', 'inject.dist.js']) {
      const src = read(f)
      assert(src.indexOf('const refBlocks = idxLinesSync()') >= 0 && src.indexOf('const refLines = refBlocks.map(') >= 0, f + ' refBlocks 对象形态 + refLines 渲染行拆分（驳回①锚）')
      assert(src.indexOf('refBlocks.slice(0, refLines.length).map(function (it) { return it.id })') >= 0, f + ' inject 遥测记资料桶存活索引行 id（驳回①锚）')
    }
    assert(read('recall.js').indexOf("list.slice().sort().join(',')") >= 0, 'recall.js 原始行签名集合序（驳回②锚）')
    // 账本 §2 旁挂锚（ledger.js 双包共源物理单份）
    const ledSrc = read('ledger.js')
    assert(ledSrc.indexOf('_recallStats({ sinceDays: 7 })') >= 0 && ledSrc.indexOf('分通道召回率') >= 0 && ledSrc.indexOf('不混算') >= 0, 'ledger §2 旁挂分通道召回率（口径不混算标注）')
  })

  // ---- 78.1 五通道埋点 fixture（共享实例）：inject/catalog/mount 原始行 + search/get 日聚合行各落流水且字段正确 ----
  const uniq = '遥测78-' + Date.now().toString(36)
  let RID = null, N1 = null, N2 = null, N3 = null
  const readRecallBody = async () => {
    await handlers['notes-recall-stats']({})   // 读前落账（flush 防抖 pending + 在途原始行）
    const g = await handlers['notes-get']({ id: RID })
    return g.note.body
  }
  await t('五通道埋点 fixture：inject/catalog/mount 原始回执行 + search/get 日聚合行各落流水且字段正确', async () => {
    N1 = await handlers['notes-create']({ title: uniq + '-inject', body: uniq + ' 约定正文', inject: true })
    N2 = await handlers['notes-create']({ title: uniq + '-catalog', body: uniq + ' 目录正文' })
    N3 = await handlers['notes-create']({ title: uniq + '-mount', body: uniq + ' 待办正文', kind: 'todo' })
    assert(N1.id && N2.id && N3.id, '三条 fixture 笔记创建成功')
    // 装配路径（conventionText/catalogText）只读常驻 cache——先 notes-list 触发全库解析进 cache（节 22 同款预热姿势：
    // 前节造数经独立实例/直接写盘的条目可能不在共享实例 cache，list 后口径确定）
    await handlers['notes-list']({})
    const conv = lastCtx('notes:workspace-conventions')
    const cat = lastCtx('notes:catalog')
    assert(conv && cat, '双注入 context 已注册（前置）')
    // ① inject 装配（真实路径，sidOverride 缺省）
    const convText = conv.text()
    assert(convText.indexOf(N1.id) >= 0, 'N1 进入注入文本（前置；实得长度 ' + convText.length + '）')
    // ⑤ catalog 目录装配（真实路径）
    const catText = cat.text()
    assert(catText.indexOf(N2.id) >= 0, 'N2 进入目录文本（前置）')
    // ② mount 任务挂载（派发路径单点）
    const dp = await handlers['notes-dispatch']({ id: N3.id, sessionId: LIVE_SID })
    assert(dp && dp.ok === true, '派发成功（前置；实得 ' + JSON.stringify(dp).slice(0, 120) + '）')
    // ③ search 自由检索（返回 id 集日聚合）
    const sr = await handlers['notes-search']({ query: uniq })
    assert((sr.notes || []).length >= 3, '搜索命中三条 fixture 笔记（前置，实得 ' + (sr.notes || []).length + '）')
    // ④ get 按需取 ×2（同日同键计数累加）
    await handlers['notes-get']({ id: N2.id })
    await handlers['notes-get']({ id: N2.id })
    // 落账 + 取流水
    const st = await handlers['notes-recall-stats']({})
    assert(st && st.ok === true && st.noteId, 'notes-recall-stats 返回遥测根笔记 id（实得 ' + JSON.stringify(st).slice(0, 160) + '）')
    RID = st.noteId
    const rows = parseRows((await handlers['notes-get']({ id: RID })).note.body)
    const injRows = rows.filter(r => r.channel === 'inject' && (r.ids || []).indexOf(N1.id) >= 0)
    assert(injRows.length === 1 && !!injRows[0].ts, 'inject 原始回执行恰 1 条含 N1（实得 ' + injRows.length + '）')
    assert(injRows[0].session === 'abc12345', 'inject 行带会话短 id（实得 ' + injRows[0].session + '）')
    const catRows = rows.filter(r => r.channel === 'catalog' && (r.ids || []).indexOf(N2.id) >= 0)
    assert(catRows.length === 1 && !!catRows[0].ts, 'catalog 原始回执行恰 1 条含 N2（实得 ' + catRows.length + '）')
    const mntRows = rows.filter(r => r.channel === 'mount' && (r.ids || []).indexOf(N3.id) >= 0)
    assert(mntRows.length === 1 && !!mntRows[0].ts, 'mount 原始回执行恰 1 条含 N3（实得 ' + mntRows.length + '）')
    assert(mntRows[0].session === 'abc12345', 'mount 行带目标会话短 id（实得 ' + mntRows[0].session + '）')
    const sAgg = rows.filter(r => r.channel === 'search' && r.day === dayStr && r.id === N2.id)
    assert(sAgg.length === 1 && sAgg[0].count === 1, 'search 日聚合行恰 1 条 count=1（实得 ' + JSON.stringify(sAgg) + '）')
    const gAgg = rows.filter(r => r.channel === 'get' && r.day === dayStr && r.id === N2.id)
    assert(gAgg.length === 1 && gAgg[0].count === 2, 'get 日聚合行恰 1 条 count=2（两次取用同日同键累加不爆行；实得 ' + JSON.stringify(gAgg) + '）')
  })

  // ---- 78.2 幂等：同日同键 upsert 不爆行 + 装配签名去重 + 分通道 rate 不变量（共享实例含前节噪声，断不变量不断绝对值）----
  await t('幂等：search/get 同日同键计数累加恰 1 行 + 装配签名去重不重复记 + 分通道 rate = used/delivered 不变量', async () => {
    const base = parseRows(await readRecallBody())
    const baseInj = base.filter(r => r.channel === 'inject' && (r.ids || []).indexOf(N1.id) >= 0).length
    const baseCat = base.filter(r => r.channel === 'catalog' && (r.ids || []).indexOf(N2.id) >= 0).length
    const conv = lastCtx('notes:workspace-conventions')
    const cat = lastCtx('notes:catalog')
    conv.text(); conv.text()   // 同 id 集重复装配 → 签名去重不新增
    cat.text()                 // 目录同理
    // 驳回②回归锁：确定性换序——N3 updatedAt 前移至目录首位（id 集不变、渲染顺序必变），集合序签名判等仍不新增
    await handlers['notes-update']({ id: N3.id, body: uniq + ' 待办正文 v2' })
    cat.text()
    await handlers['notes-search']({ query: uniq })   // search 第二次（同日同键）
    await handlers['notes-get']({ id: N2.id })        // get 第三次（同日同键）
    const rows = parseRows(await readRecallBody())
    assert(rows.filter(r => r.channel === 'inject' && (r.ids || []).indexOf(N1.id) >= 0).length === baseInj, 'inject 同签名重复装配不重复记行')
    assert(rows.filter(r => r.channel === 'catalog' && (r.ids || []).indexOf(N2.id) >= 0).length === baseCat, 'catalog 同签名重复装配不重复记行（含同集换序场景）')
    const sAgg = rows.filter(r => r.channel === 'search' && r.day === dayStr && r.id === N2.id)
    assert(sAgg.length === 1 && sAgg[0].count === 2, 'search 同日同键 upsert：count=2 恰 1 行（实得 ' + JSON.stringify(sAgg) + '）')
    const gAgg = rows.filter(r => r.channel === 'get' && r.day === dayStr && r.id === N2.id)
    assert(gAgg.length === 1 && gAgg[0].count === 3, 'get 同日同键 upsert：count=3 恰 1 行（实得 ' + JSON.stringify(gAgg) + '）')
    // 分通道 rate 不变量（共享实例含前节遥测噪声：断结构不变量，不追绝对值——精确值由 78.3 隔离实例锁定）
    const st = await handlers['notes-recall-stats']({ sinceDays: 7 })
    for (const c of ['inject', 'mount', 'search', 'catalog']) {
      const ch = st.channels[c]
      assert(ch && typeof ch.delivered === 'number' && typeof ch.used === 'number' && ch.used <= ch.delivered, c + ' 通道结构完整且 used ≤ delivered（实得 ' + JSON.stringify(ch) + '）')
      assert(ch.delivered === 0 ? ch.rate === null : ch.rate === Math.round(ch.used / ch.delivered * 1000) / 1000, c + ' 通道 rate = used/delivered（实得 ' + JSON.stringify(ch) + '）')
    }
    assert(st.channels.get.rate === null && st.channels.get.delivered === 0 && st.channels.get.used >= 1 && st.channels.get.uses >= st.channels.get.used, 'get 通道纯使用信号（rate=null；实得 ' + JSON.stringify(st.channels.get) + '）')
    const st1 = await handlers['notes-recall-stats']({ sinceDays: 1 })
    assert(st1.ok === true && st1.sinceDays === 1 && st1.channels, 'sinceDays 参数透传 + 结构稳定')
  })

  // ---- 78.3 隔离实例精确 rate + 账本 §2 旁挂（全新库，计数确定）----
  await t('隔离实例精确口径：五通道 {delivered,used,rate} 精确值 + get 纯使用信号 + 账本 §2 旁挂分通道召回率行', async () => {
    const storeR = new Map()
    const fsMockR = mkFsMockImp(storeR, [NOTES_DIR])
    const handlersR = {}
    const toolsR = {}
    const ctxsR = []
    const harnessMockR = { handle: (n, fn) => { handlersR[n] = fn; return () => { delete handlersR[n] } }, defineTool: (d) => d, registerTool: (c, def) => { toolsR[def.name] = def; return () => {} } }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockR, DIR).apply({
      fs: fsMockR, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { ctxsR.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const tok = 'zh78r-' + Date.now().toString(36)
    const A = await handlersR['notes-create']({ title: tok + '-A', body: tok + ' A 约定正文', inject: true })   // 约定桶注入
    const B = await handlersR['notes-create']({ title: tok + '-B', body: tok + ' B 普通正文' })                 // 资料桶挂载 + 目录可见
    const C = await handlersR['notes-create']({ title: tok + '-C', body: tok + ' C 待办正文', kind: 'todo' })   // 派发 + 目录可见
    // 驳回①前置：B 挂载进注入索引 §1（资料桶非空——此前 78.3 未调 notes-mount，refBlocks 恒空测不出漏记）；
    // whenToUse 不含 tok：防索引笔记正文命中搜索查询污染 search 通道口径
    const mt = await handlersR['notes-mount']({ id: B.id, whenToUse: 'B 资料挂载行' })
    assert(mt && mt.ok === true, 'notes-mount 挂载 B 成功（实得 ' + JSON.stringify(mt).slice(0, 120) + '）')
    const convR = ctxsR.find(c => c.name === 'notes:workspace-conventions')
    const catR = ctxsR.find(c => c.name === 'notes:catalog')
    const convTextR = convR.text()                                               // inject 交付 {A 约定桶, B 资料桶索引行}
    assert(convTextR.indexOf(B.id) >= 0, '资料桶渲染含 B 索引行（前置——Verifier 探针同姿势）')
    catR.text()                                                               // catalog 交付 {B,C}（A 注入去重排除；sys 根笔记 recall=false 不进）
    await handlersR['notes-dispatch']({ id: C.id, sessionId: LIVE_SID })      // mount 交付 {C}
    const sRes = await toolsR['note_search'].execute({ query: tok })          // search 交付 {A,B,C}（工具通道）
    assert(sRes.count === 3, '隔离库搜索恰 3 条（实得 ' + sRes.count + '）')
    await toolsR['note_get'].execute({ id: A.id })                            // get 取用 {A}×1（工具通道）
    const st = await handlersR['notes-recall-stats']({})
    assert(st.ok === true && st.events > 0, '隔离实例遥测有事件（实得 ' + JSON.stringify(st).slice(0, 200) + '）')
    assert.deepStrictEqual(st.channels.inject, { delivered: 2, deliveries: 2, used: 1, uses: 1, rate: 0.5 }, 'inject 精确：交付 A 约定+B 资料桶×2、A 被取用 → rate=0.5（实得 ' + JSON.stringify(st.channels.inject) + '）')
    assert.deepStrictEqual(st.channels.catalog, { delivered: 2, deliveries: 2, used: 0, uses: 0, rate: 0 }, 'catalog 精确：交付 B/C×2、零取用 → rate=0（实得 ' + JSON.stringify(st.channels.catalog) + '）')
    assert.deepStrictEqual(st.channels.mount, { delivered: 1, deliveries: 1, used: 0, uses: 0, rate: 0 }, 'mount 精确：交付 C×1、零取用 → rate=0（实得 ' + JSON.stringify(st.channels.mount) + '）')
    assert.deepStrictEqual(st.channels.search, { delivered: 3, deliveries: 3, used: 1, uses: 1, rate: 0.333 }, 'search 精确：交付 A/B/C×3、A 被取用 → rate=1/3（实得 ' + JSON.stringify(st.channels.search) + '）')
    assert.deepStrictEqual(st.channels.get, { delivered: 0, deliveries: 0, used: 1, uses: 1, rate: null }, 'get 精确：纯使用信号 used=1/uses=1/rate=null（实得 ' + JSON.stringify(st.channels.get) + '）')
    // 账本 §2 旁挂（stats 断言之后：refresh/读正文引入的新事件不影响已锁断言）
    const lr = await handlersR['notes-ledger-refresh']({})
    assert(lr && lr.ok === true, '隔离实例账本刷新成功（实得 ' + JSON.stringify(lr).slice(0, 120) + '）')
    const idxBody = (await handlersR['notes-get']({ id: lr.indexNoteId })).note.body
    const line = idxBody.split('\n').find(l => l.indexOf('分通道召回率') >= 0)
    assert(line, '§2 含分通道召回率旁挂行')
    assert(line.indexOf('不混算') >= 0, '旁挂行口径标注在位（与双链引用口径不混算）')
    assert(line.indexOf('inject 1/2·50%') >= 0 && line.indexOf('search 1/3·33%') >= 0 && line.indexOf('get 取用 1 条/1 次') >= 0, '旁挂行五通道数值精确（实得：' + line + '）')
    // 驳回①回归锁：inject 原始回执行 ids 同时含约定 A 与资料桶 B（refBlocks 字符串化后取 .id 的缺陷复活即红）；
    // 置账本断言之后：本读操作给遥测根笔记记 get 事件，不影响已锁的通道数值与旁挂行
    const injRow = parseRows((await handlersR['notes-get']({ id: st.noteId })).note.body).find(r => r.channel === 'inject')
    assert(injRow && (injRow.ids || []).indexOf(A.id) >= 0 && (injRow.ids || []).indexOf(B.id) >= 0, 'inject 交付行含约定 A + 资料桶 B 双 id（实得 ' + JSON.stringify(injRow) + '）')
  })

  // ---- 78.4 sys 排除契约 + inject 红线锁（共享实例）----
  await t('sys 排除契约：遥测根笔记 kind=sys + recall=false + 不进目录注入 + 建议器不提名 + inject 红线锁强制纠正', async () => {
    assert(RID, '前置：遥测根笔记已建（78.1）')
    const g = await handlers['notes-get']({ id: RID })
    assert(g.note.kind === 'sys', 'kind=sys（实得 ' + g.note.kind + '）')
    assert(g.note.recall === false, 'recall=false（不进目录注入）')
    assert(g.note.inject !== true, 'inject=false')
    const cat = lastCtx('notes:catalog')
    assert(cat.text().indexOf(RID) < 0, '目录注入文本不含遥测根笔记 id')
    const sg = await handlers['notes-suggest']({})
    const sgStr = JSON.stringify(sg)
    assert(sgStr.indexOf(RID) < 0 && sgStr.indexOf('召回遥测') < 0, '整理建议器不提名 sys 根笔记（kind=sys 豁免面收口）')
    // inject 红线锁：人为开注入 → 下一次落盘链 ensure 强制纠正回 false（防套娃注入）
    await handlers['notes-update']({ id: RID, inject: true })
    assert((await handlers['notes-get']({ id: RID })).note.inject === true, '人为开注入生效（前置）')
    await handlers['notes-get']({ id: N2.id })   // 触发一个 get 事件 → 落盘链 ensure → 纠正
    await handlers['notes-recall-stats']({})     // 落账等链
    assert((await handlers['notes-get']({ id: RID })).note.inject === false, '红线锁强制纠正回 inject=false（防套娃注入）')
  })
  }
}
