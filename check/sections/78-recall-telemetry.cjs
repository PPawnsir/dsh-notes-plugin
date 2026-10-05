// 节 78. 0.4.3+ 卡⑫ 统一召回遥测 → 0.4.3 验收修复⑤：机器存储层 telemetry.json（notes-043-metrics-storage）
//   → 0.4.3 验收修复⑥：呈现层（notes-043-metrics-present）——注入价值信号行（inject 目录段尾部，账本快照内存现算）
//     + 注入管理面板挂载区统计行（notes-recall-stats 复用，点开才见全量），见 78.7。
// 行为规格（卡⑤修订）：
//   ①存储：五通道事件全部落 kernel/telemetry-store.js（notes/telemetry.json）——receipts（inject/mount/catalog 原始回执 ≤200 裁尾）
//     + byDay（search/get 日聚合 >90 天剪枝）+ meta + ledger（账本快照派生字段）；内存增量 + 2s 防抖原子落盘 + 卸载 flush；
//     读失败空桶重建 / 写失败内存续用（静默降级）；体积护栏 TELEMETRY_MAX_BYTES。
//   ②埋点（点位/口径零变化）：renderInjected 真实渲染路径（inject/catalog，预览不计）/ _dispatch 派发成功 /
//     notes-search RPC + note_search 工具 / notes-get RPC + note_get 工具；签名去重（集合序）。
//   ③查询面：notes-recall-stats {sinceDays?} → 五通道分列 {delivered, deliveries, used, uses, rate}（结构不变）+ ledger 新增键
//     （账本「召回指标」汇总输出本 RPC——面板数据源；索引笔记 §2 通道退役摘除）。
//   ④遥测笔记降级：存量「召回遥测（自动）」一次性迁移回填 JSON（meta.migratedAt 幂等）→ 降级人读镜像（日评估 cron 顺带刷新，
//     热路径零笔记写入）；新装库无旧笔记 → 永不建镜像（遥测零笔记足迹）。
//   ⑤一致性三定案断言面：单写者（client/app 零 telemetry.json 引用 + host 内 writeText 唯一点）/先渲染后记账（埋点点位不变）/单调性（下界语义）。
//   → 0.4.3 验收修复⑧：note-stats facet（notes-043-stats-unify）——facets.use {id:总计数} = useCount 唯一事实源，
//     front-matter useCount 字段退役；行为断言集中在节 30（本节 78.0 补存储层结构锚）。
module.exports = {
  id: "78",
  title: "78. 统一召回遥测：telemetry.json 机器存储层 + 分通道召回率 + 遥测笔记降级人读镜像（notes-043-metrics-storage）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc, clientSrc } = H
  const { NOTES_DIR, handlers, registeredContexts, llmMock, admMock, agentsMock, sessionPersistenceMock, workspaceRegistryMock, sessionTitleMock, sessionQueryMock, mkFsMockImp, store } = S
  section('78. 统一召回遥测：telemetry.json 机器存储层 + 分通道召回率 + 遥测笔记降级人读镜像（notes-043-metrics-storage）')
  const dayStr = (function () { const d = new Date(); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'
  const TELEMETRY_FILE = NOTES_DIR + '\\telemetry.json'
  // 共享实例被节 17（静态包）/21/58 多次 plugin.apply 重挂：handlers 恒指向最新作用域，registeredContexts 逐次追加——
  //   取 LAST 匹配 = 当前活跃作用域的装配函数（取第一个会读到重挂前的陈旧闭包 cache，装配看不到新建笔记）
  const lastCtx = (name) => { const all = registeredContexts.filter(c => c.name === name); return all[all.length - 1] }
  // 遥测 JSON 读取（读前落账：stats 自洽读 flush 防抖 pending + 在途回执链沉降）
  const readTelemetry = async (hs) => {
    await (hs || handlers)['notes-recall-stats']({})
    const raw = store.get(TELEMETRY_FILE)
    return raw ? JSON.parse(raw) : null
  }

  // ---- 78.0 落地结构：telemetry-store 双清单变体登记 + 序位 + 标记块/核心 API/RPC + 单写者 grep 锚 + 五处埋点锚不变 + transfer/ledger 接线锚 ----
  await t('卡⑤ 落地结构：kernel/telemetry-store.js 双清单变体登记 + 序位 + 标记块/核心 API + 单写者锚 + 埋点/接线锚双包同步', () => {
    assert(fsNative.existsSync(path.join(DIR, 'src', 'host', 'kernel', 'telemetry-store.js')), 'src/host/kernel/telemetry-store.js 存在')
    assert(fsNative.existsSync(path.join(DIR, 'src', 'host', 'kernel', 'telemetry-store.dist.js')), 'src/host/kernel/telemetry-store.dist.js 存在（发布版变体）')
    const devM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dev.js'), 'utf8')
    const distM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dist.js'), 'utf8')
    assert(devM.indexOf("'kernel/telemetry-store.js'") >= 0 && distM.indexOf("'kernel/telemetry-store.dist.js'") >= 0, '双清单登记 telemetry-store（变体后缀映射）')
    assert(devM.indexOf("'kernel/settings-store.js'") < devM.indexOf("'kernel/telemetry-store.js'") && devM.indexOf("'kernel/telemetry-store.js'") < devM.indexOf("'recall.js'"), 'dev 序位：settings-store 之后、recall.js 之前')
    assert(distM.indexOf("'kernel/settings-store.dist.js'") < distM.indexOf("'kernel/telemetry-store.dist.js'") && distM.indexOf("'kernel/telemetry-store.dist.js'") < distM.indexOf("'recall.js'"), 'dist 序位同上')
    // 变体差异唯一性：dev 片自带 TELEMETRY_PATH 定义；dist 片不带（head.js 定义 path.join(NOTES_ROOT, ...)）
    const devStore = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'telemetry-store.js'), 'utf8')
    const distStore = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'telemetry-store.dist.js'), 'utf8')
    assert(devStore.indexOf("const TELEMETRY_PATH = NOTES_DIR + '\\\\telemetry.json'") >= 0, 'dev 片定义 TELEMETRY_PATH（NOTES_DIR 拼接）')
    assert(distStore.indexOf('const TELEMETRY_PATH') < 0, 'dist 片不定义 TELEMETRY_PATH（head.js 统一锚）')
    assert(distStore.replace(/\r\n/g, '\n') === devStore.replace(/\r\n/g, '\n').replace("    const TELEMETRY_PATH = NOTES_DIR + '\\\\telemetry.json'\n", ''), '变体差异仅 TELEMETRY_PATH 一行（其余逐字节一致）')
    const headSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'head.js'), 'utf8')
    assert(headSrc.indexOf("const TELEMETRY_PATH = path.join(NOTES_ROOT, 'telemetry.json')") >= 0, 'dist head.js 定义 TELEMETRY_PATH')
    // 标记块 + 核心 API（双产物）
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('==== telemetry-store BEGIN ====') >= 0 && src.indexOf('==== telemetry-store END ====') >= 0, tag + ' 含 telemetry-store 标记块')
      assert(src.indexOf('function _telemetryLoad(') >= 0 && src.indexOf('function _telemetryFlushNow(') >= 0 && src.indexOf('function _telemetryScheduleFlush(') >= 0, tag + ' 存储层 load/flush/schedule API 在位')
      assert(src.indexOf('function _telemetryAddReceipt(') >= 0 && src.indexOf('function _telemetryBumpDay(') >= 0 && src.indexOf('async function _telemetrySetLedger(') >= 0 && src.indexOf('async function _telemetryImportMerge(') >= 0, tag + ' 存储层记账/账本快照/导入合并 API 在位')
      // 0.4.3 验收修复⑧（notes-043-stats-unify）：note-stats facet 结构锚——facets.use = useCount 唯一事实源
      assert(src.indexOf('async function _telemetryBumpUse(') >= 0 && src.indexOf('function _telemetryUseOf(') >= 0 && src.indexOf('function _telemetrySeedUse(') >= 0, tag + ' note-stats facet API 在位（bumpUse/useOf/seedUse，卡⑧）')
      assert(src.indexOf('facets: { use: {} }') >= 0 && src.indexOf('t.facets.use = useOut') >= 0, tag + ' facets.use 空桶缺省 + 读入归一（卡⑧）')
      assert(src.indexOf('note-stats facet') >= 0, tag + ' note-stats facet 注释锚（卡⑧）')
      assert(src.indexOf('const TELEMETRY_FLUSH_MS = 2000') >= 0, tag + ' 纪律①：2s 防抖常量')
      assert(src.indexOf('const TELEMETRY_RECEIPT_MAX = 200') >= 0 && src.indexOf('const TELEMETRY_BYDAY_KEEP_DAYS = 90') >= 0 && src.indexOf('const TELEMETRY_MAX_BYTES = 256 * 1024') >= 0, tag + ' 纪律③容量三闸常量（200/90 天/体积护栏）')
      assert(src.indexOf('version: TELEMETRY_VERSION') >= 0 || src.indexOf('version: 1') >= 0, tag + ' telemetry.json version 字段（迁移/合并兼容锚）')
      assert(src.indexOf('==== recall-telemetry BEGIN ====') >= 0 && src.indexOf('==== recall-telemetry END ====') >= 0, tag + ' 含 recall-telemetry 标记块')
      assert(src.indexOf('function _recallRaw(') >= 0 && src.indexOf('function _recallHit(') >= 0 && src.indexOf('async function _recallFlushAgg(') >= 0, tag + ' 埋点 API 在位（raw/hit/flushAgg 签名不变）')
      assert(src.indexOf('function _recallComputeStats(') >= 0 && src.indexOf('async function _recallStats(') >= 0 && src.indexOf('function _recallFmtChannels(') >= 0, tag + ' 查询面 API 在位（computeStats 纯函数现算/stats/fmtChannels）')
      assert(src.indexOf('function _recallMaybeMigrate(') >= 0 && src.indexOf('async function _recallMirrorRefresh(') >= 0, tag + ' 一次性迁移 + 人读镜像 API 在位')
      assert(src.indexOf("handle('notes-recall-stats'") >= 0, tag + ' notes-recall-stats RPC 注册')
      assert(src.indexOf("'## 遥测摘要（人读镜像）'") >= 0, tag + ' 人读镜像节锚常量')
      assert(src.indexOf('await _recallFlushAgg()') >= 0, tag + ' stats 读前落账（自洽读）')
      // 单写者 grep 锚（三定案①）：TELEMETRY_PATH 的 writeText 写盘唯一点——只出现在 telemetry-store 标记块内；
      //   块外（ledger/recall/transfer 等）只允许 readText/resolve 读引用，任何写入口都是双写红线违例
      const blk = src.slice(src.indexOf('==== telemetry-store BEGIN ===='), src.indexOf('==== telemetry-store END ===='))
      assert(blk.indexOf('fs.writeText') >= 0 && blk.indexOf('TELEMETRY_PATH') >= 0, tag + ' 存储层块内含唯一写盘点')
      const outside = src.slice(0, src.indexOf('==== telemetry-store BEGIN ====')) + src.slice(src.indexOf('==== telemetry-store END ===='))
      const badWrite = outside.split('\n').filter(l => l.indexOf('writeText') >= 0 && l.indexOf('TELEMETRY_PATH') >= 0)
      assert(badWrite.length === 0, tag + ' 单写者：telemetry-store 块外零 TELEMETRY_PATH 写盘（实得 ' + JSON.stringify(badWrite).slice(0, 120) + '）')
      assert(src.indexOf("handle('notes-telemetry") < 0, tag + ' 无遥测写入口 RPC（notes-recall-stats 只读）')
    }
    // client/app 零引用（构造性无双写——面板卡⑥才接，且也只读 RPC）
    assert(clientSrc.indexOf('telemetry.json') < 0, 'client bundle 零 telemetry.json 引用（单写者）')
    const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    assert(appSrc.indexOf('telemetry.json') < 0, 'app.html 零 telemetry.json 引用（单写者）')
    // 五处埋点锚（点位零变化红线——逐文件看守双侧同步，防单侧漏改）
    const read = (rel) => fsNative.readFileSync(path.join(DIR, 'src', 'host', rel), 'utf8')
    for (const f of ['inject.js', 'inject.dist.js']) {
      assert(read(f).indexOf("_recallRaw('inject'") >= 0 && read(f).indexOf("_recallRaw('catalog'") >= 0, f + ' inject/catalog 装配埋点在位（先渲染后记账：渲染完成后调用）')
    }
    for (const f of ['dispatch.js', 'dispatch.dist.js']) assert(read(f).indexOf("_recallRaw('mount'") >= 0, f + ' mount 派发埋点在位')
    assert(read('search.js').indexOf("_recallHit('search'") >= 0, 'search.js notes-search 埋点在位（共源单份）')
    for (const f of ['server.js', 'server.dist.js', 'index.js', 'index.dist.js']) assert(read(f).indexOf("_recallHit('get'") >= 0, f + ' get 取用埋点在位')
    for (const f of ['index.js', 'index.dist.js']) assert(read(f).indexOf('_recallFlushAgg()') >= 0, f + ' 卸载 flush 挂载点在位')
    for (const f of ['index.js', 'index.dist.js']) assert(read(f).indexOf('_recallMaybeMigrate()') >= 0 && read(f).indexOf('_ledgerStripS2()') >= 0, f + ' 启动迁移 + §2 摘除触发点在位')
    // 驳回修复回归锚（Verifier 2026-10-05）：①inject 资料桶 id——refBlocks 保对象形态 + refLines 渲染行，遥测取存活切片；
    //   ②原始行签名集合序（排序 join，同 id 集换序不重复记）
    for (const f of ['inject.js', 'inject.dist.js']) {
      const src = read(f)
      assert(src.indexOf('const refBlocks = idxLinesSync()') >= 0 && src.indexOf('const refLines = refBlocks.map(') >= 0, f + ' refBlocks 对象形态 + refLines 渲染行拆分（驳回①锚）')
      assert(src.indexOf('refBlocks.slice(0, refLines.length).map(function (it) { return it.id })') >= 0, f + ' inject 遥测记资料桶存活索引行 id（驳回①锚）')
    }
    assert(read('recall.js').indexOf("list.slice().sort().join(',')") >= 0, 'recall.js 原始行签名集合序（驳回②锚）')
    // transfer 接线锚（Step3.5：导出/备份连带 + 导入合并，双变体同步）
    for (const f of ['transfer.js', 'transfer.dist.js']) {
      const src = read(f)
      assert(src.indexOf("await _telemetryFlushNow()") >= 0 && src.indexOf('telemetry') >= 0, f + ' 导出/备份连带 telemetry.json（先落账再复制）')
      assert(src.indexOf('_telemetryImportMerge(') >= 0 && src.indexOf('telemetryMerged') >= 0, f + ' 导入遥测合并（冲突取大 + 幂等返回键）')
    }
    // ledger 数据源切换锚（Step3：§2 通道退役 + 存量摘除 + 指标落存储层）
    const ledSrc = read('ledger.js')
    assert(ledSrc.indexOf('LEDGER_S2_TPL') < 0 && ledSrc.indexOf('_ledgerWriteS2') < 0, 'ledger §2 写通道已退役（模板/写函数摘除）')
    assert(ledSrc.indexOf('function _ledgerStripS2FromBody(') >= 0 && ledSrc.indexOf('async function _ledgerStripS2(') >= 0, 'ledger 存量 §2 摘除 API 在位（一次性幂等）')
    assert(ledSrc.indexOf('await _telemetrySetLedger({') >= 0 && ledSrc.indexOf('_recallMirrorRefresh(') >= 0, 'ledger 指标快照落 telemetry.json + 镜像顺带刷新')
    assert(ledSrc.indexOf('_recallStats(') < 0, 'ledger 不再直读 recall 统计（口径经 telemetry.json ledger 键 + notes-recall-stats 汇总）')
  })

  // ---- 78.1 五通道埋点 fixture（共享实例）：inject/catalog/mount 原始回执 + search/get 日聚合各落 telemetry.json 且字段正确 + 热路径零笔记写入 ----
  const uniq = '遥测78-' + Date.now().toString(36)
  let N1 = null, N2 = null, N3 = null
  await t('五通道埋点 fixture：inject/catalog/mount 原始回执 + search/get 日聚合各落 telemetry.json 且字段正确 + 热路径零笔记写入', async () => {
    N1 = await handlers['notes-create']({ title: uniq + '-inject', body: uniq + ' 约定正文', inject: true })
    N2 = await handlers['notes-create']({ title: uniq + '-catalog', body: uniq + ' 目录正文' })
    N3 = await handlers['notes-create']({ title: uniq + '-mount', body: uniq + ' 待办正文', kind: 'todo' })
    assert(N1.id && N2.id && N3.id, '三条 fixture 笔记创建成功')
    // 装配路径（renderInjected）只读常驻 cache——先 notes-list 触发全库解析进 cache（节 22 同款预热姿势）
    await handlers['notes-list']({})
    const conv = lastCtx('notes:workspace-conventions')
    assert(conv, '注入 context 已注册（前置；0.4.3③ 单一 context）')
    await handlers['notes-settings-set']({ catalogEnabled: true })   // 0.4.3：catalog 缺省关——遥测 fixture 需显式开启目录通道
    // ① inject 装配 + ⑤ catalog 目录段普通行装配（真实路径，sidOverride 缺省；同一次渲染双通道各记一行）
    const convText = conv.text()
    assert(convText.indexOf(N1.id) >= 0, 'N1 进入注入文本（前置；实得长度 ' + convText.length + '）')
    assert(convText.indexOf(N2.id) >= 0, 'N2 进入目录段普通行（前置）')
    // ② mount 任务挂载（派发路径单点）
    const dp = await handlers['notes-dispatch']({ id: N3.id, sessionId: LIVE_SID })
    assert(dp && dp.ok === true, '派发成功（前置；实得 ' + JSON.stringify(dp).slice(0, 120) + '）')
    // ③ search 自由检索（返回 id 集日聚合）
    const sr = await handlers['notes-search']({ query: uniq })
    assert((sr.notes || []).length >= 3, '搜索命中三条 fixture 笔记（前置，实得 ' + (sr.notes || []).length + '）')
    // ④ get 按需取 ×2（同日同键计数累加）
    await handlers['notes-get']({ id: N2.id })
    await handlers['notes-get']({ id: N2.id })
    // 落账 + 读 telemetry.json
    const st = await handlers['notes-recall-stats']({})
    assert(st && st.ok === true, 'notes-recall-stats 返回 ok（实得 ' + JSON.stringify(st).slice(0, 160) + '）')
    assert(st.noteId === null, '新装库零遥测笔记足迹（noteId=null——遥测不再建根笔记）')
    const tj = await readTelemetry()
    assert(tj && tj.version === 1 && tj.receipts && tj.byDay && tj.meta, 'telemetry.json 结构 {version,receipts,byDay,meta} 齐备')
    assert(tj.meta.lastFlush, 'meta.lastFlush 落盘时间戳在位')
    const injRows = tj.receipts.inject.filter(r => (r.ids || []).indexOf(N1.id) >= 0)
    assert(injRows.length === 1 && !!injRows[0].ts, 'inject 原始回执恰 1 条含 N1（实得 ' + injRows.length + '）')
    assert(injRows[0].session === 'abc12345', 'inject 回执带会话短 id（实得 ' + injRows[0].session + '）')
    const catRows = tj.receipts.catalog.filter(r => (r.ids || []).indexOf(N2.id) >= 0)
    assert(catRows.length === 1 && !!catRows[0].ts, 'catalog 原始回执恰 1 条含 N2（实得 ' + catRows.length + '）')
    const mntRows = tj.receipts.mount.filter(r => (r.ids || []).indexOf(N3.id) >= 0)
    assert(mntRows.length === 1 && !!mntRows[0].ts, 'mount 原始回执恰 1 条含 N3（实得 ' + mntRows.length + '）')
    assert(mntRows[0].session === 'abc12345', 'mount 回执带目标会话短 id（实得 ' + mntRows[0].session + '）')
    assert(tj.byDay.search[dayStr] && tj.byDay.search[dayStr][N2.id] === 1, 'search 日聚合 count=1（实得 ' + JSON.stringify(tj.byDay.search[dayStr] || {}).slice(0, 120) + '）')
    assert(tj.byDay.get[dayStr] && tj.byDay.get[dayStr][N2.id] === 2, 'get 日聚合 count=2（两次取用同日同键累加不爆行）')
    // ⑦热路径零笔记写入：全库零「召回遥测（自动）」笔记（热路径只落 telemetry.json，不触碰任何 .md）
    const telemNote = Array.from(store.keys()).filter(k => /\.md$/.test(k) && String(store.get(k)).indexOf('召回遥测（自动）') >= 0)
    assert(telemNote.length === 0, '热路径零笔记写入：遥测根笔记从未创建（实得命中 ' + telemNote.length + ' 个 .md）')
    const settingsRaw = store.get(NOTES_DIR + '\\settings.json') || ''
    assert(settingsRaw.indexOf('recallNoteId') < 0, 'settings.json 不再回写 recallNoteId 指针（镜像不懒建，指针无新建需求）')
  })

  // ---- 78.2 幂等：同日同键累加不爆键 + 装配签名去重 + 分通道 rate 不变量（共享实例含前节噪声，断不变量不断绝对值）----
  await t('幂等：search/get 同日同键计数累加 + 装配签名去重不重复记 + 分通道 rate = used/delivered 不变量', async () => {
    const base = await readTelemetry()
    const baseInj = base.receipts.inject.filter(r => (r.ids || []).indexOf(N1.id) >= 0).length
    const baseCat = base.receipts.catalog.filter(r => (r.ids || []).indexOf(N2.id) >= 0).length
    const conv = lastCtx('notes:workspace-conventions')
    conv.text(); conv.text()   // 同 id 集重复装配 → 签名去重不新增（单次渲染同记 inject+catalog 双通道）
    // 驳回②回归锁：确定性换序——N3 updatedAt 前移至目录段普通行首位（id 集不变、渲染顺序必变），集合序签名判等仍不新增
    await handlers['notes-update']({ id: N3.id, body: uniq + ' 待办正文 v2' })
    conv.text()
    await handlers['notes-search']({ query: uniq })   // search 第二次（同日同键）
    await handlers['notes-get']({ id: N2.id })        // get 第三次（同日同键）
    const tj = await readTelemetry()
    assert(tj.receipts.inject.filter(r => (r.ids || []).indexOf(N1.id) >= 0).length === baseInj, 'inject 同签名重复装配不重复记回执')
    assert(tj.receipts.catalog.filter(r => (r.ids || []).indexOf(N2.id) >= 0).length === baseCat, 'catalog 同签名重复装配不重复记回执（含同集换序场景）')
    assert(tj.byDay.search[dayStr][N2.id] === 2, 'search 同日同键累加 count=2（实得 ' + (tj.byDay.search[dayStr] || {})[N2.id] + '）')
    assert(tj.byDay.get[dayStr][N2.id] === 3, 'get 同日同键累加 count=3（实得 ' + (tj.byDay.get[dayStr] || {})[N2.id] + '）')
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

  // ---- 78.3 隔离实例精确 rate + JSON 落盘内容 + 账本快照经 notes-recall-stats ledger 键汇总（全新库，计数确定）----
  await t('隔离实例精确口径：五通道 {delivered,used,rate} 精确值 + telemetry.json 落盘内容 + 账本快照 ledger 键汇总输出', async () => {
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
    // 驳回①前置：B 挂载进注入索引 §1（资料桶非空——否则 refBlocks 恒空测不出漏记）；
    // whenToUse 不含 tok：防索引笔记正文命中搜索查询污染 search 通道口径
    const mt = await handlersR['notes-mount']({ id: B.id, whenToUse: 'B 资料挂载行' })
    assert(mt && mt.ok === true, 'notes-mount 挂载 B 成功（实得 ' + JSON.stringify(mt).slice(0, 120) + '）')
    const convR = ctxsR.find(c => c.name === 'notes:workspace-conventions')
    const catR = convR                                                        // 0.4.3③：目录段并入单一 context（catalog 通道 = 目录补充行口径）
    const convTextR = convR.text()                                            // inject 交付 {A 约定桶, B 挂载行}（catalog 关 → 普通行不记）
    assert(convTextR.indexOf(B.id) >= 0, '目录段渲染含 B 挂载行（前置——Verifier 探针同姿势）')
    await handlersR['notes-settings-set']({ catalogEnabled: true })           // 0.4.3：catalog 缺省关——隔离实例显式开启目录通道
    catR.text()                                                             // catalog 交付 {C}（A 注入去重排除；B 已挂载=增强态不进普通行；sys 根笔记 recall=false 不进）
    await handlersR['notes-dispatch']({ id: C.id, sessionId: LIVE_SID })      // mount 交付 {C}
    const sRes = await toolsR['note_search'].execute({ query: tok })          // search 交付 {A,B,C}（工具通道）
    assert(sRes.count === 3, '隔离库搜索恰 3 条（实得 ' + sRes.count + '）')
    await toolsR['note_get'].execute({ id: A.id })                            // get 取用 {A}×1（工具通道）
    const st = await handlersR['notes-recall-stats']({})
    assert(st.ok === true && st.events > 0, '隔离实例遥测有事件（实得 ' + JSON.stringify(st).slice(0, 200) + '）')
    assert(st.noteId === null && st.ledger === null, '隔离新库：无镜像笔记 + 无账本快照（结构键在位、值为空）')
    assert.deepStrictEqual(st.channels.inject, { delivered: 2, deliveries: 2, used: 1, uses: 1, rate: 0.5 }, 'inject 精确：交付 A 约定+B 资料桶×2、A 被取用 → rate=0.5（实得 ' + JSON.stringify(st.channels.inject) + '）')
    assert.deepStrictEqual(st.channels.catalog, { delivered: 1, deliveries: 1, used: 0, uses: 0, rate: 0 }, 'catalog 精确：交付 C×1（B 已挂载=增强态行，不重复计入普通行通道）、零取用 → rate=0（实得 ' + JSON.stringify(st.channels.catalog) + '）')
    assert.deepStrictEqual(st.channels.mount, { delivered: 1, deliveries: 1, used: 0, uses: 0, rate: 0 }, 'mount 精确：交付 C×1、零取用 → rate=0（实得 ' + JSON.stringify(st.channels.mount) + '）')
    assert.deepStrictEqual(st.channels.search, { delivered: 3, deliveries: 3, used: 1, uses: 1, rate: 0.333 }, 'search 精确：交付 A/B/C×3、A 被取用 → rate=1/3（实得 ' + JSON.stringify(st.channels.search) + '）')
    assert.deepStrictEqual(st.channels.get, { delivered: 0, deliveries: 0, used: 1, uses: 1, rate: null }, 'get 精确：纯使用信号 used=1/uses=1/rate=null（实得 ' + JSON.stringify(st.channels.get) + '）')
    // ①recallRaw 内存增量 → 防抖 flush → JSON 落盘内容正确（stats 读前落账后读盘逐字段核对）
    const tjR = JSON.parse(storeR.get(TELEMETRY_FILE))
    assert(tjR.receipts.inject.length === 1 && tjR.receipts.catalog.length === 1 && tjR.receipts.mount.length === 1, 'receipts 三通道各 1 条回执（实得 ' + JSON.stringify({ i: tjR.receipts.inject.length, c: tjR.receipts.catalog.length, m: tjR.receipts.mount.length }) + '）')
    const injRow = tjR.receipts.inject[0]
    assert(injRow.ids.indexOf(A.id) >= 0 && injRow.ids.indexOf(B.id) >= 0 && injRow.session === 'abc12345' && !!injRow.ts, 'inject 回执含约定 A + 资料桶 B 双 id + 会话短 id（驳回①回归锁；实得 ' + JSON.stringify(injRow) + '）')
    assert(tjR.receipts.catalog[0].ids.length === 1 && tjR.receipts.catalog[0].ids[0] === C.id, 'catalog 回执恰含 C')
    assert(tjR.receipts.mount[0].ids[0] === C.id && tjR.receipts.mount[0].session === 'abc12345', 'mount 回执含 C + 目标会话短 id')
    assert.deepStrictEqual(tjR.byDay.search[dayStr], (function () { const o = {}; o[A.id] = 1; o[B.id] = 1; o[C.id] = 1; return o })(), 'byDay.search 当日 = {A:1,B:1,C:1}（实得 ' + JSON.stringify(tjR.byDay.search[dayStr]) + '）')
    assert.deepStrictEqual(tjR.byDay.get[dayStr], (function () { const o = {}; o[A.id] = 1; return o })(), 'byDay.get 当日 = {A:1}（实得 ' + JSON.stringify(tjR.byDay.get[dayStr]) + '）')
    // 账本快照（卡⑤数据源切换）：refresh → telemetry.json ledger 派生字段 + notes-recall-stats ledger 键汇总输出（面板数据源）；索引零 §2
    const lr = await handlersR['notes-ledger-refresh']({})
    assert(lr && lr.ok === true, '隔离实例账本刷新成功（实得 ' + JSON.stringify(lr).slice(0, 120) + '）')
    const st2 = await handlersR['notes-recall-stats']({})
    assert(st2.ledger && st2.ledger.mountTotal === 1 && st2.ledger.trigger === 'manual' && !!st2.ledger.at, '召回指标经 notes-recall-stats ledger 键汇总输出（实得 ' + JSON.stringify(st2.ledger) + '）')
    assert(st2.ledger.zeroRefCount === 1 && st2.ledger.zeroRef.indexOf(B.id) >= 0, '账本快照零引用候选含 B（挂载且全库零引用）')
    const tjR2 = JSON.parse(storeR.get(TELEMETRY_FILE))
    assert(tjR2.ledger && tjR2.ledger.mountTotal === 1 && tjR2.ledger.weekRefs === 0, '账本快照落盘 telemetry.json ledger 键（实得 ' + JSON.stringify(tjR2.ledger).slice(0, 140) + '）')
    const idxBodyR = (await handlersR['notes-get']({ id: lr.indexNoteId })).note.body
    assert(idxBodyR.indexOf('§2') < 0, '索引笔记零 §2（v2 预设 + 摘除通道幂等）')
  })

  // ---- 78.4 热路径零 .md 写入 + 崩溃窗口（flush 前死亡丢内存增量 = 下界语义；新实例同库内存续用重建）----
  await t('热路径零 .md 写入 + 崩溃窗口：flushNow 前死亡丢 ≤2s 内存增量 + 新实例内存续用重建不复活', async () => {
    // A. 热路径零笔记写入（新装实例：埋点/flush/stats 全程只写 telemetry.json，零 .md 写出）
    const storeZ = new Map()
    let mdWrites = 0
    const baseZ = mkFsMockImp(storeZ, [NOTES_DIR])
    const fsMockZ = { resolve: baseZ.resolve, stat: baseZ.stat, listDir: baseZ.listDir, readText: baseZ.readText, writeText: async (p, c) => { if (/\.md$/.test(p)) mdWrites++; return baseZ.writeText(p, c) } }
    const handlersZ = {}
    const harnessMockZ = { handle: (n, fn) => { handlersZ[n] = fn; return () => { delete handlersZ[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockZ, DIR).apply({
      fs: fsMockZ, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    await handlersZ['notes-list']({})            // 启动沉降（索引建帐等启动写出落定）
    await new Promise(r => setTimeout(r, 30))
    const zN = await handlersZ['notes-create']({ title: '热路径fixture', body: 'x', topic: '运维' })
    mdWrites = 0                                 // 计数窗口：fixture 创建之后（其自身落盘不计）
    await handlersZ['notes-get']({ id: zN.id })            // get 取用事件
    await handlersZ['notes-search']({ query: '热路径fixture' })   // search 交付事件
    const stZ = await handlersZ['notes-recall-stats']({})          // 读前落账 flush
    assert(stZ.ok === true && stZ.events >= 2, '遥测事件已记账（实得 events=' + stZ.events + '）')
    assert.strictEqual(mdWrites, 0, '⑦遥测笔记降级后热路径零 .md 写入（实得 ' + mdWrites + ' 次 .md 写出）')
    assert(storeZ.has(TELEMETRY_FILE), '遥测只落 telemetry.json')
    assert(!Array.from(storeZ.keys()).some(k => /\.md$/.test(k) && String(storeZ.get(k)).indexOf('召回遥测') >= 0), '零遥测笔记足迹（新装永不建镜像）')
    // B. 崩溃窗口（假定时器捕获防抖 → 永不触发 flush = flushNow 前 kill；随后新实例同库续用）
    const storeC = new Map()
    const handlersC = {}
    const harnessMockC = { handle: (n, fn) => { handlersC[n] = fn; return () => { delete handlersC[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    const realSetTimeoutC = global.setTimeout, realClearTimeoutC = global.clearTimeout
    global.setTimeout = (fn, ms) => ({ fn: fn, ms: ms, cleared: false })   // 防抖句柄捕获即不落盘（崩溃语义）
    global.clearTimeout = () => {}
    try {
      new Function('harness', 'pluginDir', hostSrc)(harnessMockC, DIR).apply({
        fs: mkFsMockImp(storeC, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
        get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
        effect: () => {},
      })
      const cN = await handlersC['notes-create']({ title: '崩溃fixture', body: 'x', topic: '运维' })
      await handlersC['notes-get']({ id: cN.id })   // get 事件：内存 +1，防抖窗口内（假定时器永不触发）
      await new Promise(r => { realSetTimeoutC(r, 30) })   // 微任务链沉降（记账已入内存，flush 未触发）
      var cNid = cN.id
    } finally {
      global.setTimeout = realSetTimeoutC; global.clearTimeout = realClearTimeoutC
    }
    // …崩溃 = 丢弃实例（不 flush、不 dispose；防抖句柄随假定时器永不触发，无后台污染）
    assert(!storeC.has(TELEMETRY_FILE), '③崩溃窗口内 telemetry.json 未落盘（内存增量丢失 = 下界语义）')
    // 新实例同库：读失败/缺失 = 空桶重建，内存续用正常记账落盘；崩溃实例的未落盘增量不复活、不双计
    const handlersC2 = {}
    const harnessMockC2 = { handle: (n, fn) => { handlersC2[n] = fn; return () => { delete handlersC2[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockC2, DIR).apply({
      fs: mkFsMockImp(storeC, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const c2 = await handlersC2['notes-create']({ title: '崩溃重建fixture', body: 'x', topic: '运维' })
    await handlersC2['notes-get']({ id: c2.id })
    const stC = await handlersC2['notes-recall-stats']({})
    assert(stC.ok === true && stC.channels.get.uses === 1, '新实例仅见自身事件（崩溃实例未落盘增量不复活；实得 ' + JSON.stringify(stC.channels.get) + '）')
    const tjC = JSON.parse(storeC.get(TELEMETRY_FILE))
    assert(tjC.byDay.get[dayStr] && tjC.byDay.get[dayStr][c2.id] === 1 && !tjC.byDay.get[dayStr][cNid], '落盘恰含新实例事件；崩溃增量不双计不复活（下界语义）')
  })

  // ---- 78.5 一次性迁移 + 容量三闸 + 遥测笔记降级人读镜像 + 迁移幂等重放 + inject 红线锁 ----
  await t('一次性迁移：旧遥测笔记行回填 JSON（≤200 裁尾/90 天剪枝幂等）+ 降级人读镜像 + 重放不双计 + 红线锁', async () => {
    const storeM = new Map()
    // 预置旧版存量：settings.json 指针 +「召回遥测（自动）」笔记（250 条 inject 原始行[文件序新→旧] + 当日/100 天前聚合行 + 手写备注行）
    const seedLines = []
    for (let i = 249; i >= 0; i--) {
      seedLines.push('- {"ts":"' + new Date(Date.parse('2026-09-01T00:00:00.000Z') + i * 60000).toISOString() + '","channel":"inject","ids":["n-seed' + i + '"],"session":"seed"}')
    }
    const dayOld = (function () { const d = new Date(Date.now() - 100 * 86400000); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
    seedLines.push('- {"day":"' + dayStr + '","channel":"search","id":"n-seedA","count":5}')
    seedLines.push('- {"day":"' + dayOld + '","channel":"get","id":"n-seedOld","count":9}')
    const legacyBody = '## 事件流水（自动）\n\n' + seedLines.join('\n') + '\n\n手写备注：迁移前存量要保留\n'
    storeM.set(NOTES_DIR + '\\n-telem01.md', '---\nid: n-telem01\ntitle: 召回遥测（自动）\nkind: sys\nrecall: false\ninject: false\ncreatedAt: "2026-09-01T00:00:00.000Z"\nupdatedAt: "2026-09-01T00:00:00.000Z"\n---\n' + legacyBody)
    storeM.set(NOTES_DIR + '\\settings.json', JSON.stringify({ recallNoteId: 'n-telem01' }))
    const handlersM = {}
    const ctxsM = []
    const harnessMockM = { handle: (n, fn) => { handlersM[n] = fn; return () => { delete handlersM[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockM, DIR).apply({
      fs: mkFsMockImp(storeM, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { ctxsM.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    // 迁移在首个 flush 前闭环（启动触发；stats 读前落账 = 迁移 + flush 全链等待点）
    const cM = await handlersM['notes-create']({ title: '迁移fixture', body: 'x', topic: '运维' })
    await handlersM['notes-get']({ id: cM.id })
    const stM = await handlersM['notes-recall-stats']({})
    assert(stM.ok === true && stM.noteId === 'n-telem01', 'stats 结构不变：noteId 指向存量镜像笔记（实得 ' + stM.noteId + '）')
    const tjM = JSON.parse(storeM.get(TELEMETRY_FILE))
    assert(tjM.meta && tjM.meta.migratedAt && tjM.meta.migratedFrom === 'n-telem01', '迁移标记 meta.migratedAt/migratedFrom 落盘（跨重启幂等锚）')
    assert(tjM.receipts.inject.length === 200, '②容量闸一：receipts ≤200 裁尾（250 行 → 200；实得 ' + tjM.receipts.inject.length + '）')
    assert(tjM.receipts.inject.some(r => (r.ids || []).indexOf('n-seed249') >= 0) && !tjM.receipts.inject.some(r => (r.ids || []).indexOf('n-seed49') >= 0), '裁尾保最新（n-seed249 在 / n-seed49 摘）')
    assert(tjM.byDay.search[dayStr] && tjM.byDay.search[dayStr]['n-seedA'] === 5, '当日聚合行回填（count=5）')
    assert(!(tjM.byDay.get && tjM.byDay.get[dayOld]), '②容量闸二：100 天前聚合行 >90 天剪枝摘除')
    assert(tjM.byDay.get[dayStr] && tjM.byDay.get[dayStr][cM.id] === 1, '迁移后新事件正常记账（内存续用）')
    // 遥测笔记降级人读镜像：全量重写为可读摘要 + 零机器流水行 + 手写备注保留 + sys/recall 语义不变
    const gM = await handlersM['notes-get']({ id: 'n-telem01' })
    assert(gM.note.body.indexOf('## 遥测摘要（人读镜像）') === 0, '笔记降级人读镜像（镜像节锚开头）')
    assert(gM.note.body.indexOf('telemetry.json') >= 0, '镜像声明机器存储迁至 telemetry.json')
    assert(gM.note.body.split('\n').filter(l => l.indexOf('- {') === 0).length === 0, '镜像零 `- {` 机器流水行（热路径解析负担归零）')
    assert(gM.note.body.indexOf('手写备注：迁移前存量要保留') >= 0, '旧流水节手写备注迁入保留节')
    assert(gM.note.kind === 'sys' && gM.note.recall === false && gM.note.inject !== true, '镜像 sys + recall=false + inject=false 语义保留')
    const convM = ctxsM.find(c => c.name === 'notes:workspace-conventions')
    assert(convM.text().indexOf('n-telem01') < 0, '目录段不含镜像笔记（sys + recall=false 豁免面）')
    const sgM = await handlersM['notes-suggest']({})
    assert(JSON.stringify(sgM).indexOf('n-telem01') < 0, '整理建议器不提名镜像笔记（kind=sys 豁免面收口）')
    // inject 红线锁：人为开注入 → 账本刷新顺带镜像重写强制纠正回 false（防套娃注入）
    await handlersM['notes-update']({ id: 'n-telem01', inject: true })
    assert((await handlersM['notes-get']({ id: 'n-telem01' })).note.inject === true, '人为开注入生效（前置）')
    const lrM = await handlersM['notes-ledger-refresh']({})
    assert(lrM && lrM.ok === true, '账本刷新成功（镜像顺带通道）')
    const gM2 = await handlersM['notes-get']({ id: 'n-telem01' })
    assert(gM2.note.inject === false, '红线锁强制纠正回 inject=false（镜像重写随纠正）')
    assert(gM2.note.body.indexOf('账本快照') >= 0, '镜像含账本快照摘要行（_telemetrySetLedger 同盘口径）')
    // ⑤迁移幂等（重放不双计）：第二实例同库重启回放——迁移标记收口跳过回填，新事件正常累加
    const handlersM2 = {}
    const harnessMockM2 = { handle: (n, fn) => { handlersM2[n] = fn; return () => { delete handlersM2[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockM2, DIR).apply({
      fs: mkFsMockImp(storeM, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const cM2 = await handlersM2['notes-create']({ title: '迁移重放fixture', body: 'x', topic: '运维' })
    await handlersM2['notes-get']({ id: cM2.id })
    await handlersM2['notes-recall-stats']({})
    const tjM2 = JSON.parse(storeM.get(TELEMETRY_FILE))
    assert(tjM2.byDay.search[dayStr]['n-seedA'] === 5, '⑤重放不双计：迁移回填计数不因重启回放翻倍')
    assert(tjM2.receipts.inject.length === 200 && tjM2.receipts.inject.filter(r => (r.ids || []).indexOf('n-seed249') >= 0).length === 1, '⑤重放不重复回填 receipts（仍 200 裁尾；n-seed249 恰 1 条）')
    assert(tjM2.byDay.get[dayStr][cM2.id] === 1, '重放实例新事件正常记账')
  })

  // ---- 78.6 体积护栏（纪律③闸三）：超限文件 flush 时收紧——receipts 先裁 100、再逐日摘最旧 byDay 桶直至达标 ----
  await t('体积护栏：telemetry.json 超 TELEMETRY_MAX_BYTES → flush 收紧达标 + 新事件不丢', async () => {
    const storeG = new Map()
    // 预置超限 sidecar：80 天前（90 天窗口内、年龄剪枝保留）的 byDay.search 日桶塞 18000 个 id（compact ≈288KB 超 256KB 护栏）；
    //   取「窗口内最旧日」语义：护栏逐日摘最旧 → 该桶先于当日至新事件桶被摘
    const dayBig = (function () { const d = new Date(Date.now() - 80 * 86400000); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
    const bigBucket = {}
    for (let i = 0; i < 18000; i++) bigBucket['n-big' + String(i).padStart(6, '0')] = 1
    const bigSeed = { version: 1, receipts: { inject: [], mount: [], catalog: [] }, byDay: { search: {}, get: {} }, meta: {} }
    bigSeed.byDay.search[dayBig] = bigBucket
    storeG.set(TELEMETRY_FILE, JSON.stringify(bigSeed))
    const handlersG = {}
    const harnessMockG = { handle: (n, fn) => { handlersG[n] = fn; return () => { delete handlersG[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockG, DIR).apply({
      fs: mkFsMockImp(storeG, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const gN = await handlersG['notes-create']({ title: '护栏fixture', body: 'x', topic: '运维' })
    await handlersG['notes-get']({ id: gN.id })
    await handlersG['notes-recall-stats']({})   // 读前落账：flush 内 prune 护栏生效
    const rawG = storeG.get(TELEMETRY_FILE)
    assert(rawG.length <= 256 * 1024, '②容量闸三：flush 后文件体积回到护栏内（实得 ' + rawG.length + ' 字节）')
    const tjG = JSON.parse(rawG)
    assert(!(tjG.byDay.search && tjG.byDay.search[dayBig]), '超限日桶被摘除（逐日摘最旧直至达标）')
    assert(tjG.byDay.get[dayStr] && tjG.byDay.get[dayStr][gN.id] === 1, '护栏收紧不丢新事件（内存续用）')
  })

  // ---- 78.7 卡⑥ 呈现层（notes-043-metrics-present）：注入价值信号行（快照原子/静默降级/纯读零写）+ 面板挂载区统计行双端锚 ----
  await t('卡⑥ 呈现层：注入价值信号行（Top/零引用/截至 + 快照同版本 + 降级省略 + render→record 顺序）+ 面板统计行双端锚', async () => {
    const readH = (rel) => fsNative.readFileSync(path.join(DIR, 'src', 'host', rel), 'utf8')
    // A. 静态锚：双变体信号行 API + 纯读零写（函数体零埋点/零写盘）+ 先渲染后记账源码序 + 双产物接入锚 + §2 退役fixture复核
    for (const f of ['inject.js', 'inject.dist.js']) {
      const src = readH(f)
      assert(src.indexOf('function _valueSignalLine(dirIds)') >= 0, f + ' 价值信号行函数在位')
      const fnBlk = src.slice(src.indexOf('function _valueSignalLine(dirIds)'), src.indexOf('function renderInjected('))
      assert(fnBlk.indexOf('_recallRaw') < 0 && fnBlk.indexOf('_telemetryAddReceipt') < 0 && fnBlk.indexOf('_telemetryBumpDay') < 0 && fnBlk.indexOf('writeText') < 0, f + ' 信号行纯读零写（埋点/写盘零引用——埋点纪律红线）')
      assert(fnBlk.indexOf('.slice(0, 200)') >= 0, f + ' 信号行 ≤200 字符截断红线')
      assert(src.indexOf('const sigLine = _valueSignalLine(dirIds)') >= 0 && src.indexOf('const sigLine = _valueSignalLine(dirIds)') < src.indexOf("_recallRaw('inject'"), f + ' ⑤先渲染后记账：信号行现算先于 inject 埋点（源码序锚）')
      assert(src.indexOf('refBlocks.slice(0, refLines.length).map(function (it) { return it.id }).concat(catIds)') >= 0, f + ' ④快照原子性锚：存活目录行 id 集 = 预算省略后挂载行 + 普通行')
    }
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('function _valueSignalLine(dirIds)') >= 0 && src.indexOf('const sigLine = _valueSignalLine(dirIds)') >= 0, tag + ' 信号行接入目录段尾部提示行区')
      assert(src.indexOf('本周引用：') >= 0 && src.indexOf('零引用候选：') >= 0 && src.indexOf('截至 ') >= 0, tag + ' 信号行三段格式锚（本周引用/零引用候选/截至）')
    }
    // ⑥§2 语义退役复核（fixture 断言锚定⑤成果）：索引 v2 预设零 §2 + 存量摘除通道断言见 74.1/78.3（此处锁预设源头）
    const idxSrcP = readH('injectindex.js')
    const presetLine = idxSrcP.match(/const INJECT_INDEX_BODY = INJECT_INDEX_GUIDE \+ INJECT_INDEX_HEAD \+ '\\n'/)
    assert(presetLine && idxSrcP.indexOf("INJECT_INDEX_BODY + ") < 0 && idxSrcP.indexOf('INJECT_INDEX_S2 + ') < 0, '⑥索引 v2 预设零 §2（INJECT_INDEX_BODY 仅 说明块+§1；存量摘除见 74.1 逐字节断言）')
    // B. 行为级（隔离实例）：挂载 2 行 + 近窗日志引用 fixture → 信号行数值正确 + 约定桶过滤 + 快照同版本 + 双档降级 + 纯读零写
    const storeP = new Map()
    const fsMockP = mkFsMockImp(storeP, [NOTES_DIR])
    const handlersP = {}
    const ctxsP = []
    const harnessMockP = { handle: (n, fn) => { handlersP[n] = fn; return () => { delete handlersP[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockP, DIR).apply({
      fs: fsMockP, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { ctxsP.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const tokP = 'sig78-' + Date.now().toString(36)
    const pB = await handlersP['notes-create']({ title: tokP + '-B', body: 'B 资料正文' })
    const pC = await handlersP['notes-create']({ title: tokP + '-C', body: 'C 资料正文' })
    const pD = await handlersP['notes-create']({ title: tokP + '-D', body: 'D 约定正文', inject: true })   // 约定桶：全文注入不进目录行
    await handlersP['notes-mount']({ id: pB.id, whenToUse: 'B 挂载行' })
    await handlersP['notes-mount']({ id: pC.id, whenToUse: 'C 挂载行' })
    const convP = ctxsP.find(c => c.name === 'notes:workspace-conventions')
    // ③降级档一：遥测零事件（存储空/未加载）→ 渲染无信号行（整行省略不报错，挂载行照常渲染）
    const txtEmpty = convP.text()
    assert(txtEmpty.indexOf(pB.id) >= 0 && txtEmpty.indexOf(pD.id) >= 0, '前置：挂载行 B + 约定 D 照常渲染')
    assert(txtEmpty.indexOf('本周引用：') < 0 && txtEmpty.indexOf('零引用候选：') < 0, '③遥测零事件 → 无信号行（静默降级档一）')
    // ③降级档二：遥测已加载（get 事件落账）但无账本快照（cron 未跑）→ 仍无信号行
    await handlersP['notes-get']({ id: pB.id })
    await handlersP['notes-recall-stats']({})   // 读前落账：telemetry.json 已建、ledger 键仍 null
    const txtNoLedger = convP.text()
    assert(txtNoLedger.indexOf('本周引用：') < 0, '③有遥测无快照（ledger=null）→ 无信号行（静默降级档二）')
    // fixture 遥测：近 7 天日志引用——B×1、D×5（D 为约定桶全文注入：Top 榜首但不进目录行，信号行须过滤——快照原子性探针）
    await handlersP['notes-create']({ title: tokP + '-日志', body: '## 相关笔记\n\n[[' + pB.id + ']] 引用B\n[[' + pD.id + ']] [[' + pD.id + ']]\n[[' + pD.id + ']] [[' + pD.id + ']]\n[[' + pD.id + ']]', kind: 'log', logDate: dayStr })
    const lrP = await handlersP['notes-ledger-refresh']({})
    assert(lrP && lrP.ok === true && lrP.mountTotal === 2, '前置：账本刷新成功、挂载 2 行（实得 ' + JSON.stringify(lrP).slice(0, 140) + '）')
    const stP0 = await handlersP['notes-recall-stats']({})
    assert(stP0.ledger && stP0.ledger.top[0] && stP0.ledger.top[0].id === pD.id && stP0.ledger.top[0].count === 5, '前置：Top 榜首 D×5（约定桶，待过滤探针）')
    assert(stP0.ledger.top[1] && stP0.ledger.top[1].id === pB.id && stP0.ledger.top[1].count === 1 && stP0.ledger.zeroRef.indexOf(pC.id) >= 0, '前置：Top 次席 B×1 + 零引用候选含 C')
    // ①渲染：注入含信号行且 Top/零引用数值正确（D 过滤后 B 升榜首；C 零引用首条）
    const txtSig = convP.text()
    const sigRow = txtSig.split('\n').filter(l => l.indexOf('本周引用：') >= 0)[0] || ''
    assert(sigRow, '①注入文本含价值信号行（实得目录尾部无信号行？全长 ' + txtSig.length + '）')
    assert(sigRow.indexOf('本周引用：' + pB.id + '×1') >= 0, '①信号行 Top 数值正确：B×1（D 约定桶已过滤；实得 ' + sigRow + '）')
    assert(sigRow.indexOf(pD.id) < 0, '④快照原子性：约定桶 D（不进目录行）不出现在信号行（过滤锚）')
    assert(sigRow.indexOf('零引用候选：' + pC.id) >= 0, '①零引用候选首条 = C（实得 ' + sigRow + '）')
    assert(/截至 \d{2}:\d{2}/.test(sigRow), '②截至时刻格式锚 HH:MM（实得 ' + sigRow + '）')
    assert(sigRow.length <= 200, '信号行 ≤200 字符（实得 ' + sigRow.length + '）')
    // ④信号行 id ⊆ 目录行 id（同版本快照）：信号行全部 id 逐一命中同一次渲染的目录段（约定段在「本地笔记库目录」锚之前）
    const dirPart = txtSig.slice(txtSig.indexOf('本地笔记库目录'))
    const sigIds = sigRow.match(/n-[A-Za-z0-9]+/g) || []
    assert(sigIds.length >= 2, '信号行含 id 提及（实得 ' + sigIds.join(',') + '）')
    for (const id of sigIds) assert(dirPart.indexOf(id) >= 0, '④信号行 id ⊆ 目录行 id：' + id + ' 在目录段存活行中')
    // ⑤render→record 顺序保持（纯读零写行为级）：stats 落账 → 重复渲染 → events 零增长（信号行现算不记账 + 签名去重）
    const stP1 = await handlersP['notes-recall-stats']({})
    convP.text(); convP.text()
    const stP2 = await handlersP['notes-recall-stats']({})
    assert(stP2.events === stP1.events, '⑤信号行渲染纯读零写：重复装配 events 零增长（实得 ' + stP1.events + ' → ' + stP2.events + '）')
    // ⑥面板统计行双端锚（client 开发版 + 发布包 + app 源 + app.html 产物）：notes-recall-stats 复用（零新 RPC）+ 统计行 + i18n 键 + 点开全量
    const cliMgr = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'modals', 'inject-manager.js'), 'utf8')
    const appMgr = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'inject-manager.js'), 'utf8')
    const clientPkgP = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    const appHtmlP = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    assert(cliMgr.indexOf("host.call('notes-recall-stats', {})") >= 0 && cliMgr.indexOf("tt('inj.mntStats'") >= 0 && cliMgr.indexOf('dsh-notes-injmgr-mntstats-row') >= 0 && cliMgr.indexOf('function injMgrChanLine(') >= 0, 'client 统计行：recall-stats 数据源 + i18n 键 + 行类 + 全量分通道 helper')
    assert(cliMgr.indexOf('setInjMgrRstatsOpen(!injMgrRstatsOpen)') >= 0, 'client 点开才见全量（展开态切换）')
    assert(appMgr.indexOf("rpc('notes-recall-stats', {})") >= 0 && appMgr.indexOf("t('inj.mntStats'") >= 0 && appMgr.indexOf('injmgr-mntstats-row') >= 0 && appMgr.indexOf('function renderInjMntStats(') >= 0, 'app 统计行：recall-stats 数据源 + i18n 键 + 行类 + 渲染函数')
    assert(appMgr.indexOf('id="injMntStats"') >= 0 && appMgr.indexOf('injMgrState.rstatsOpen = !injMgrState.rstatsOpen') >= 0, 'app 挂载宿主位 + 点开全量切换')
    assert(clientPkgP.indexOf('dsh-notes-injmgr-mntstats-row') >= 0 && clientPkgP.indexOf("tt('inj.mntStats'") >= 0, '发布包 lib/client.js 统计行同步（需先跑 scripts/build-dist.cjs）')
    assert(appHtmlP.indexOf('injmgr-mntstats-row') >= 0 && appHtmlP.indexOf("t('inj.mntStats'") >= 0, 'app.html 产物统计行同步（需先跑 scripts/concat-app.cjs）')
    const zhP = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const enP = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    for (const k of ['inj.mntStats', 'inj.mntStatsTip']) {
      assert(zhP.indexOf("'" + k + "':") >= 0 && enP.indexOf("'" + k + "':") >= 0, 'i18n 双端含 ' + k)
    }
    assert(zhP.indexOf('挂载 {m}｜本周引用 Top：{top}｜零引用 {z}') >= 0, 'zh 统计行文案锚（挂载 N｜本周引用 Top｜零引用 M）')
    // 面板单写者防线回归：client/app 统计行只经 RPC 读，零 telemetry.json 引用（78.0 三定案①口径延续）
    assert(cliMgr.indexOf('telemetry.json') < 0 && appMgr.indexOf('telemetry.json') < 0, '⑥单写者：双端统计行零 telemetry.json 引用（只读 notes-recall-stats RPC）')
  })
  }
}
