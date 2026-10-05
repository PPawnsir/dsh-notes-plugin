// 节 30. P2 使用遥测（note_get 引用计数 + facet 收编 + 排序 + UI）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
// 0.4.3 验收修复⑧（notes-043-stats-unify）：useCount 收编 note-stats facet——telemetry.json facets.use {id:总计数} 为唯一事实源，
//   front-matter useCount 字段退役（buildFM 不再写入，存量旧值仅作 seed max 合并并入）；
//   内存视图 n.useCount 由 facet 供电（消费面零改动）；旧 60s 防抖逐笔记 persistNote 重写通道拆除（note_get 热路径零 .md 写出）。
module.exports = {
  id: "30",
  title: "30. P2 使用遥测（note_get 引用计数收编 facet + 防抖落盘 telemetry.json + 排序 + UI）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, ctx, g, llmMock, plugin, protoV2Src, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  // ===== 30. P2 使用遥测（note_get 引用计数 + facet 收编 + 列表/详情显示 + 按引用排序） =====
  section('30. P2 使用遥测（note_get 引用计数收编 facet + 防抖落盘 telemetry.json + 排序 + UI）')
  const dayStr30 = (function () { const d = new Date(); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()

  // ---- 30.1 host 双侧结构契约（host-impl / index.mjs 双包同步）----
  await t('use-telemetry 标记块双包逐字节一致（host-impl / index.mjs）', () => {
    const grabBlk = (s) => { const m = s.match(/\/\/ ==== use-telemetry BEGIN ====[\s\S]*?\/\/ ==== use-telemetry END ====/); return m ? m[0] : '' }
    const blkDev = grabBlk(hostSrc), blkPkg = grabBlk(indexSrc)
    assert(blkDev.length > 100, 'host-impl 缺 use-telemetry 标记块')
    assert.strictEqual(blkPkg, blkDev, 'host-impl.js 与 index.mjs 的 use-telemetry 块必须逐字节一致')
  })
  await t('host 双侧：useCount 收编 note-stats facet（telemetry.json 单一事实源）+ front-matter 退役 + 消费面视图供电零改动', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      // 收编：facet API 三件套 + bump 委托 + 视图同步 helper + 空桶缺省/归一
      assert(s.indexOf('async function _telemetryBumpUse(') >= 0 && s.indexOf('function _telemetryUseOf(') >= 0 && s.indexOf('function _telemetrySeedUse(') >= 0, label + ' note-stats facet API 在位（bumpUse/useOf/seedUse）')
      assert(s.indexOf('facets: { use: {} }') >= 0 && s.indexOf('t.facets.use = useOut') >= 0, label + ' telemetry 空桶含 facets.use 缺省 + 读入归一')
      assert(s.indexOf('function bumpUseCount(id)') >= 0 && s.indexOf('_telemetryBumpUse(id)') >= 0, label + ' bumpUseCount 委托 facet（内存视图 + facet 双写）')
      assert(s.indexOf('async function _useFacetSync(n)') >= 0, label + ' facet⇄视图双向同步 helper 在位（载入/创建/导入三入口共用）')
      // 退役：旧 60s 独立防抖 + 逐笔记 persistNote 重写通道清零（热路径写放大消除的结构锚）
      assert(s.indexOf('USE_COUNT_FLUSH_MS') < 0 && s.indexOf('useCountDirty') < 0 && s.indexOf('useCountTimer') < 0, label + ' 旧 60s 独立防抖设施清零')
      assert(s.match(/^\s*(async )?function flushUseCounts/m) === null && s.match(/^\s*flushUseCounts\(\)/m) === null, label + ' flushUseCounts 逐笔记重写通道拆除（函数定义与调用点清零）')
      assert(s.indexOf("'useCount: ' + escYaml(m.useCount || 0)") < 0, label + ' buildFM 停写 useCount（front-matter 字段退役，新笔记无此行）')
      // 兼容/视图链保留（消费面零改动）
      assert(s.indexOf('useCount: Math.max(0, parseInt(p.meta.useCount, 10) || 0)') >= 0, label + ' noteFromParsed 仍读存量旧字段作 seed（兼容，存量零迁移）')
      assert(s.indexOf('useCount: n.useCount || 0,') >= 0, label + ' slim 携带 useCount（视图供电）')
      assert(s.indexOf('const uc = bumpUseCount(n.id)') >= 0, label + ' note_get 工具命中计数')
      assert(s.indexOf('if (note.useCount > 0) await _useFacetSync(note)') >= 0, label + ' _create 显式继承计数 seed 并入 facet（归档合计跨重启不丢）')
      assert(s.indexOf('for (const id of importedNoteIds)') >= 0 && s.indexOf('_useFacetSync(n2)') >= 0, label + ' transfer 导入后 facet 双向同步接线在位（cache 直建旁路补齐）')
      assert(s.indexOf('totalUseCount: members.reduce((s, m) => s + m.useCount, 0)') >= 0, label + ' 归档预览组合计引用数（读视图零改动）')
      assert(s.indexOf('useCount: members.reduce((s, n) => s + Math.max(0, n.useCount || 0), 0)') >= 0, label + ' 归档合并继承成员引用合计（读视图零改动）')
      // 卸载 flush：useCount facet 随召回遥测同盘（_recallFlushAgg 单点），旧独立 flush 调用点清零
      assert(s.indexOf('flushUseCounts()   // 卸载 flush') < 0 && s.indexOf('_recallFlushAgg()') >= 0, label + ' 卸载 flush 归 _recallFlushAgg 单点（facet 随遥测同盘落 telemetry.json）')
    }
  })

  // ---- 30.2 host 行为级（开发版独立实例 storeU + 假定时器捕获防抖，不真实等待）----
  const storeU = new Map()
  let writesU = 0
  const mdWritesU = []   // .md 写出路径清单（热路径写放大消除实证锚）
  const TELEM_U = NOTES_DIR + '\\telemetry.json'
  const fsMockU = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeU.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeU.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeU.has(p)) throw new Error('ENOENT: ' + p); return storeU.get(p) },
    writeText: async (p, c) => { writesU++; if (/\.md$/.test(p)) mdWritesU.push(p); storeU.set(p, c) },
  }
  const mkHostU = () => {
    const handlers = {}
    const tools = []
    const effects = []
    const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: (c, d) => { tools.push(d); return () => {} } }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply({
      fs: fsMockU, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: (fn) => { effects.push(fn) },
    })
    return { handlers, tools, effects, harnessMock }
  }
  const inst1 = mkHostU()
  const handlersU = inst1.handlers, toolsU = inst1.tools, effectsU = inst1.effects, harnessMockU = inst1.harnessMock
  // 预热沉降（真实定时器窗口）：心跳 .last-host-load + 索引根笔记创建 + 首个 RPC 的 perf-report（10s 节流）落定后再装假定时器
  await handlersU['notes-list']({})
  await new Promise(r => setTimeout(r, 20))
  const noteGetU = toolsU.find(x => x.name === 'note_get')
  const flushMicro30 = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  let teleNoteId = ''
  let mdBytes0 = ''
  // 假定时器：捕获防抖调度（不真实等待）；仅本区块生效，finally 恢复
  const realSetTimeout30 = global.setTimeout, realClearTimeout30 = global.clearTimeout
  const scheduledU = []
  global.setTimeout = (fn, ms) => { const h = { fn: fn, ms: ms, cleared: false }; scheduledU.push(h); return h }
  global.clearTimeout = (h) => { if (h) h.cleared = true }
  try {
    await t('note_get 命中计数：内存即时 +1（响应即见），防抖期内零写盘；notes-get RPC 不计数', async () => {
      const cU = await handlersU['notes-create']({ title: '遥测笔记甲', body: '正文甲', tags: [], topic: '运维' })
      teleNoteId = cU.id
      mdBytes0 = storeU.get(NOTES_DIR + '\\' + teleNoteId + '.md')
      assert(mdBytes0.indexOf('\nuseCount:') < 0, '①front-matter 退役：新建笔记磁盘字节零 useCount 行')
      const w0 = writesU
      const g1 = await noteGetU.execute({ id: cU.id })
      const g2 = await noteGetU.execute({ id: cU.id })
      const g3 = await noteGetU.execute({ id: cU.id })
      assert.strictEqual(g1.note.useCount, 1, '第 1 次命中返回 useCount=1')
      assert.strictEqual(g2.note.useCount, 2, '第 2 次命中返回 useCount=2')
      assert.strictEqual(g3.note.useCount, 3, '第 3 次命中返回 useCount=3')
      assert.strictEqual(writesU, w0, '3 次命中防抖期内零写盘（写入增量 ' + (writesU - w0) + '）')
      // 0.4.3 验收修复⑧（notes-043-stats-unify）：facets.use 总计与 byDay.get 日明细共用遥测 2s 防抖单定时器（旧 60s 独立防抖已拆除）
      assert.strictEqual(scheduledU.length, 1, '重复命中只挂一个遥测防抖定时器（facets.use + byDay.get 同通道；实得 ' + scheduledU.length + '）')
      assert.strictEqual(scheduledU[0].ms, 2000, '防抖窗口 = 遥测 2s（卡⑤机器存储层 TELEMETRY_FLUSH_MS）')
      const lst = await handlersU['notes-list']({})
      assert.strictEqual(lst.notes.find(n => n.id === cU.id).useCount, 3, 'slim 列表即时携带 useCount=3（内存视图可见，未落盘）')
      assert.strictEqual(writesU, w0, 'notes-list 不触发写盘')
      // notes-get RPC（client 面板打开笔记）不计数：人类浏览非 agent 引用
      const gRpc = await handlersU['notes-get']({ id: cU.id })
      assert.strictEqual(gRpc.note.useCount, 3, 'notes-get RPC 不计数（仍为 3）')
      // 已删笔记 note_get 报错且不计数
      const cDel = await handlersU['notes-create']({ title: '遥测删除笔记', body: 'x' })
      await handlersU['notes-delete']({ id: cDel.id })
      const gDel = await noteGetU.execute({ id: cDel.id })
      assert(gDel.error, '已删笔记 note_get 报错')
      assert.strictEqual(scheduledU.length, 1, '报错不挂防抖定时器（不计数；仍为先前那一个遥测防抖定时器）')
    })
    await t('遥测防抖落盘只写 telemetry.json：facets.use 总计 + byDay.get 日明细同盘；笔记 .md 字节零触碰（热路径写放大消除）', async () => {
      const w0 = writesU
      mdWritesU.length = 0
      scheduledU[0].fn()   // 模拟遥测 2s 防抖到期
      await flushMicro30()
      assert.strictEqual(writesU, w0 + 1, '3 次命中防抖落盘仅 1 次写盘（增量 ' + (writesU - w0) + '）')
      assert.strictEqual(mdWritesU.length, 0, '⑤落盘零 .md 触碰（旧逐笔记 persistNote 全文重写通道已拆除——写放大消除实证）')
      assert.strictEqual(storeU.get(NOTES_DIR + '\\' + teleNoteId + '.md'), mdBytes0, '笔记文件字节逐字节不变（计数不落 front-matter）')
      const tj = JSON.parse(storeU.get(TELEM_U))
      assert.strictEqual(tj.facets.use[teleNoteId], 3, 'facets.use 总计 = 3（useCount 唯一事实源——只计 note_get 工具命中）')
      assert.strictEqual(tj.byDay.get[dayStr30] && tj.byDay.get[dayStr30][teleNoteId], 4, 'byDay.get 日明细 = 4（卡⑫ 同通道日聚合：note_get 工具 ×3 + notes-get RPC ×1——RPC 计日明细但不计 useCount 总计）')
      // 再命中 → 重挂遥测防抖（供卸载 flush 用）
      await noteGetU.execute({ id: teleNoteId })
      assert.strictEqual(scheduledU.length, 2, '命中重挂遥测防抖定时器（facets.use 增量置脏）')
    })
    await t('插件卸载 flush：防抖窗口内 facet 增量落 telemetry.json；防抖定时器清除不二次触发；全程零 .md 写出', async () => {
      const w1 = writesU
      mdWritesU.length = 0
      const disposeU = effectsU[0]()   // ctx.effect 注册的 effect 体 → 返回 dispose
      disposeU()                        // 模拟插件卸载
      await flushMicro30()
      // 卡⑧：卸载 flush = _recallFlushAgg 单点（召回遥测 + facets.use 同盘）；不再逐笔记重写 .md（旧 flushUseCounts 通道已拆除）
      assert.strictEqual(writesU, w1 + 1, '卸载 flush 仅落 telemetry.json（增量 ' + (writesU - w1) + '；已删速记无 facet 不牵扯）')
      assert.strictEqual(mdWritesU.length, 0, '卸载 flush 零 .md 写出')
      assert.strictEqual(scheduledU[1].cleared, true, '卸载 flush 清掉遥测防抖定时器（不二次触发）')
      const tj = JSON.parse(storeU.get(TELEM_U))
      assert.strictEqual(tj.facets.use[teleNoteId], 4, '卸载后 facets.use = 4（防抖窗口内增量兜底落盘）')
    })
  } finally {
    global.setTimeout = realSetTimeout30; global.clearTimeout = realClearTimeout30
  }

  // ---- 30.2b seed max 合并幂等 +  facet 供电视图（同库新实例 = 模拟重启；真实定时器 + stats 读前落账驱动确定性落盘）----
  let inst3 = null
  await t('存量旧 front-matter 字段 seed max 合并幂等（旧值 5/facet 3 → 5）+ 重放不双计 + facet 抬头供电', async () => {
    // 存量旧格式文件（字段退役前产物：front-matter 带 useCount: 5）+ 盘上 facet 既有 3（模拟升级前 telemetry.json 已累计）
    const legacyPath = NOTES_DIR + '\\n-legacy30.md'
    const legacyBytes = '---\nid: n-legacy30\ntitle: 存量计数笔记\ntopic: 运维\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nuseCount: 5\n---\n存量正文\n'
    storeU.set(legacyPath, legacyBytes)
    const tjPre = JSON.parse(storeU.get(TELEM_U))
    tjPre.facets.use['n-legacy30'] = 3
    storeU.set(TELEM_U, JSON.stringify(tjPre))
    // 第二实例（模拟升级后首次启动）：载入即 seed——视图 = max(旧字段 5, facet 3) = 5，facet 抬升落盘 5
    const inst2 = mkHostU()
    await inst2.handlers['notes-list']({})
    await new Promise(r => setTimeout(r, 30))   // 启动沉降（索引根笔记等启动写出落定）
    const gL = await inst2.handlers['notes-get']({ id: 'n-legacy30' })
    assert.strictEqual(gL.note.useCount, 5, '②旧字段 5 / facet 3 → max 合并视图 5（notes-get RPC 不计数）')
    await inst2.handlers['notes-recall-stats']({})   // 读前落账：seed 增量 flush
    const tjL = JSON.parse(storeU.get(TELEM_U))
    assert.strictEqual(tjL.facets.use['n-legacy30'], 5, '②seed 抬升 facet 3 → 5 落盘（max 合并幂等）')
    assert.strictEqual(tjL.facets.use[teleNoteId], 4, '前实例 facet 计数随盘恢复（telemetry.json 单源跨实例续用）')
    assert.strictEqual(storeU.get(legacyPath), legacyBytes, '红线：存量笔记文件字节零迁移（seed 不触碰 .md；旧字段留存至下次真实保存自然脱落）')
    // bump：视图 +facet 双写 6；.md 仍零触碰（旧字段 5 原样残留）
    const gB = await inst2.tools.find(x => x.name === 'note_get').execute({ id: 'n-legacy30' })
    assert.strictEqual(gB.note.useCount, 6, '②bump 后视图 6（facet 6 同步）')
    await inst2.handlers['notes-recall-stats']({})
    const tjB = JSON.parse(storeU.get(TELEM_U))
    assert.strictEqual(tjB.facets.use['n-legacy30'], 6, '②bump 后 facet = 6')
    assert.strictEqual(storeU.get(legacyPath), legacyBytes, 'bump 全程零 .md 重写（热路径写放大消除）')
    // 第三实例（再重启）：facet 6 为准——旧字段 5 不再叠加（重放不双计）；新格式笔记纯 facet 供电
    inst3 = mkHostU()
    await inst3.handlers['notes-list']({})
    await new Promise(r => setTimeout(r, 30))
    const gL3 = await inst3.handlers['notes-get']({ id: 'n-legacy30' })
    assert.strictEqual(gL3.note.useCount, 6, '②重放不双计：facet 6 为准（旧字段 5 不再叠加；若双计此处为 11）')
    const gT3 = await inst3.handlers['notes-get']({ id: teleNoteId })
    assert.strictEqual(gT3.note.useCount, 4, '②facet 供电实证：.md 无 useCount 行（新格式），视图纯由 facet 抬头为 4')
  })

  // ---- 30.2c 归档合计/继承并入 facet + 命中全程零 .md（第三实例续用）----
  await t('归档预览组行合计引用数（totalUseCount）+ 合并归档继承成员引用合计并入 facet', async () => {
    const qA = await inst3.handlers['notes-create']({ title: '速记甲', body: 'quick a', tags: ['quick'] })
    const qB = await inst3.handlers['notes-create']({ title: '速记乙', body: 'quick b', tags: ['quick'] })
    // 同会话（sessCtx 兜底同一 sessionId）2 条 quick → 1 个速记组；甲被引用 2 次
    const noteGet3 = inst3.tools.find(x => x.name === 'note_get')
    mdWritesU.length = 0
    await noteGet3.execute({ id: qA.id })
    await noteGet3.execute({ id: qA.id })
    await inst3.handlers['notes-recall-stats']({})   // 读前落账（只写 telemetry.json）
    assert.strictEqual(mdWritesU.length, 0, '⑤note_get 命中 + 遥测落盘全程零 .md 写出')
    let tjA = JSON.parse(storeU.get(TELEM_U))
    assert.strictEqual(tjA.facets.use[qA.id], 2, 'facet 总计 = 命中次数（与视图同源）')
    const pv = await inst3.handlers['notes-archive-preview']({})
    const grp = pv.quickGroups.find(g => g.members.some(m => m.id === qA.id))
    assert(grp, 'preview 含该速记组')
    assert.strictEqual(grp.totalUseCount, 2, '组行合计引用数 = 成员合计（视图供电；实得 ' + JSON.stringify(grp.totalUseCount) + '）')
    assert.strictEqual(grp.members.find(m => m.id === qA.id).useCount, 2, '成员条目携带 useCount')
    const ar = await inst3.handlers['notes-archive']({ groups: [{ memberIds: [qA.id, qB.id], title: '遥测归档' }] })
    assert.strictEqual(ar.merged, 1, '合并成功')
    const gArc = await inst3.handlers['notes-get']({ id: ar.groups[0].noteId })
    assert.strictEqual(gArc.note.useCount, 2, '⑥归档笔记继承成员引用合计（合并不丢计数，视图）')
    await inst3.handlers['notes-recall-stats']({})
    tjA = JSON.parse(storeU.get(TELEM_U))
    assert.strictEqual(tjA.facets.use[ar.groups[0].noteId], 2, '⑥归档继承合计并入 facet（_create seed——跨重启不丢）')
    // ③ledger useRank Top5 由 facet 供电（挂载进索引后刷新账本，快照 useRank 计数 = facet 口径视图）
    await inst3.handlers['notes-mount']({ id: teleNoteId, whenToUse: '卡⑧ facet 供电探针挂载行' })
    const lr = await inst3.handlers['notes-ledger-refresh']({})
    assert(lr && lr.ok === true, '账本刷新成功（实得 ' + JSON.stringify(lr).slice(0, 120) + '）')
    const stL = await inst3.handlers['notes-recall-stats']({})
    const rankHit = (stL.ledger && stL.ledger.useRank || []).find(it => it.id === teleNoteId)
    assert(rankHit && rankHit.count === 4, '③ledger useRank Top5 来自 facet 供电视图（' + teleNoteId + ' 计数 4；实得 ' + JSON.stringify(rankHit) + '）')
  })

  // ---- 30.3 静态包行为（独立 ESM 实例 + 假定时器 + webServer 路由链路）----
  await t('静态包：note_get 命中计数收编 facet + 遥测防抖落盘零 .md 触碰 + 卸载 flush（webServer 路由链路）', async () => {
    const storeU2 = new Map()
    let writesU2 = 0
    const mdWritesU2 = []
    const TELEM_U2 = path.join(NOTES_ROOT_STATIC, 'telemetry.json')
    const fsMockU2 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (storeU2.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeU2.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeU2.has(p)) throw new Error('ENOENT: ' + p); return storeU2.get(p) },
      writeText: async (p, c) => { writesU2++; if (/\.md$/.test(p)) mdWritesU2.push(p); storeU2.set(p, c) },
    }
    const routesU2 = []
    const toolsU2 = []
    const effectsU2 = []
    const ctxU2 = {
      fs: fsMockU2,
      sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routesU2.push(r); return () => {} } },
      tools: { register: (d) => { toolsU2.push(d); return () => {} } },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: (fn) => { effectsU2.push(fn) },
    }
    // 真实静态包环境没有 harness Builtin —— 摘掉还原真实条件
    const harnessBackup30 = global.harness
    delete global.harness
    try {
      const modU = await import(pathToFileURL(INDEX_PATH).href + '?use-telemetry=1')
      modU.apply(ctxU2)
      const rpcU2 = (method, args) => new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routesU2[0].handler(req, res)).catch(reject)
      })
      // 预热沉降（真定时器）：首个 RPC 的 perf-report（10s 节流）落定
      await rpcU2('notes-list', {})
      await new Promise(r => setTimeout(r, 20))
      const tGetU2 = toolsU2.find(x => x.name === 'note_get')
      const scheduledU2 = []
      global.setTimeout = (fn, ms) => { const h = { fn: fn, ms: ms, cleared: false }; scheduledU2.push(h); return h }
      global.clearTimeout = (h) => { if (h) h.cleared = true }
      try {
        const cU2 = await rpcU2('notes-create', { title: '静态遥测笔记', body: '静态正文', tags: [], topic: '运维' })
        const idU2 = cU2.body.id
        const mdPathU2 = path.join(NOTES_ROOT_STATIC, idU2 + '.md')
        const mdBytesU2 = storeU2.get(mdPathU2)
        assert(mdBytesU2.indexOf('\nuseCount:') < 0, '静态包新建笔记磁盘字节零 useCount 行（front-matter 退役）')
        const w0 = writesU2
        const g1 = await tGetU2.execute({ id: idU2 })
        const g2 = await tGetU2.execute({ id: idU2 })
        assert.strictEqual(g1.note.useCount, 1, '静态包第 1 次命中 useCount=1')
        assert.strictEqual(g2.note.useCount, 2, '静态包第 2 次命中 useCount=2')
        assert.strictEqual(writesU2, w0, '静态包防抖期内零写盘（增量 ' + (writesU2 - w0) + '）')
        // 0.4.3 验收修复⑧：facets.use 与 byDay.get 共用遥测 2s 防抖单定时器（旧 60s 独立防抖已拆除）
        assert.strictEqual(scheduledU2.length, 1, '静态包重复命中只挂一个遥测防抖定时器（facets.use + byDay.get 同通道）')
        assert.strictEqual(scheduledU2[0].ms, 2000, '静态包防抖窗口 = 遥测 2s（TELEMETRY_FLUSH_MS）')
        mdWritesU2.length = 0
        scheduledU2[0].fn()   // 模拟防抖到期
        await flushMicro30()
        assert.strictEqual(writesU2, w0 + 1, '静态包防抖落盘仅 1 次写盘（增量 ' + (writesU2 - w0) + '）')
        assert.strictEqual(mdWritesU2.length, 0, '静态包落盘零 .md 触碰（热路径写放大消除）')
        assert.strictEqual(storeU2.get(mdPathU2), mdBytesU2, '静态包笔记文件字节逐字节不变')
        const tjU2 = JSON.parse(storeU2.get(TELEM_U2))
        assert.strictEqual(tjU2.facets.use[idU2], 2, '静态包 facets.use = 2（facet 单一事实源）')
        assert.strictEqual(tjU2.byDay.get[dayStr30] && tjU2.byDay.get[dayStr30][idU2], 2, '静态包 byDay.get 日明细 = 2')
        // 卸载 flush
        await tGetU2.execute({ id: idU2 })
        const w1 = writesU2
        mdWritesU2.length = 0
        effectsU2[0]()()   // effect 体 → dispose（插件卸载）
        await flushMicro30()
        assert.strictEqual(writesU2, w1 + 1, '静态包卸载 flush 仅落 telemetry.json（增量 ' + (writesU2 - w1) + '）')
        assert.strictEqual(mdWritesU2.length, 0, '静态包卸载 flush 零 .md 写出')
        assert.strictEqual(scheduledU2[1].cleared, true, '静态包卸载清掉遥测防抖定时器（不二次触发）')
        const tjU3 = JSON.parse(storeU2.get(TELEM_U2))
        assert.strictEqual(tjU3.facets.use[idU2], 3, '静态包卸载后 facets.use = 3（防抖窗口内增量兜底落盘）')
      } finally {
        global.setTimeout = realSetTimeout30; global.clearTimeout = realClearTimeout30
      }
    } finally {
      if (harnessBackup30 !== undefined) global.harness = harnessBackup30
    }
  })

  // ---- 30.4 列表排序「按引用」（chip 开关 + 真实比较器行为 + 四端同步）----
  await t('按引用排序比较器行为：useCount 降序，同数按 updatedAt 兜底（从 client-impl 源码提取真实比较器执行）', () => {
    const m = clientSrc.match(/if \(sortBy === 'use'\) filtered = filtered\.slice\(\)\.sort\(\(a, b\) => ([^\r\n]+)\)\r?\n/)
    assert(m, 'client-impl 缺按引用排序行')
    const cmp = new Function('a', 'b', 'return ' + m[1])
    const arr = [
      { id: 'x', useCount: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'y', useCount: 5, updatedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'z', useCount: 5, updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'w', useCount: 0, updatedAt: '2026-01-04T00:00:00.000Z' },
      { id: 'v', updatedAt: '2026-01-05T00:00:00.000Z' },
    ]
    assert.strictEqual(arr.slice().sort(cmp).map(n => n.id).join(','), 'z,y,x,v,w', 'useCount 降序 → 同数 updatedAt 降序（缺省字段按 0 计）')
  })
  await t('排序三档接入筛选中心独立控件：时间/引用/相关度（client-impl / 发布包 lib/client.js / app.html / 原型）', () => {
    assert(clientSrc.indexOf("const [sortBy, setSortBy] = React.useState(() => loadFiltersState().sortBy)") >= 0, 'client-impl sortBy 状态（持久化恢复，缺省 time）')
    assert(clientSrc.indexOf("const FILTER_SORTS = [") >= 0 && clientSrc.indexOf("{ id: 'time', label: '时间'") >= 0 && clientSrc.indexOf("{ id: 'use', label: '引用'") >= 0 && clientSrc.indexOf("{ id: 'rel', label: '相关度'") >= 0, 'client-impl 排序三档（FILTER_SORTS 独立控件）')
    assert(clientSrc.indexOf('setSortBy(s.id); setSortOpen(false)') >= 0, 'client-impl 排序档位点击切换（选择即关菜单）')
    assert(clientPkgSrc.indexOf('FILTER_SORTS') >= 0 && clientPkgSrc.indexOf("label: '相关度'") >= 0, '发布包 lib/client.js 同步排序三档（需先跑 scripts/build-dist.cjs）')
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("var sortBy = _fs.sortBy;") >= 0, label + ' sortBy 状态（持久化恢复，缺省 time）')
      assert(s.indexOf("if (sortBy === 'use') vis.sort(") >= 0, label + ' 按引用排序逻辑保留')
      assert(s.indexOf("var FILTER_SORTS = [") >= 0 && s.indexOf("{ id: 'time', label: '时间'") >= 0 && s.indexOf("{ id: 'rel', label: '相关度'") >= 0, label + ' 排序三档（FILTER_SORTS 独立控件）')
      assert(s.indexOf("sortBy === 'rel' && qRel") >= 0, label + ' 相关度排序分支')
    }
  })

  // ---- 30.5 列表行尾/详情 meta「被引用 N 次」（0 次不显示）+ 归档预览合计 + 样式（四端同步）----
  await t('被引用显示链路：行尾徽章 + 详情 meta chip + 归档预览合计（0 次不显示；client/app/原型/样式 四端）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("(n.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-note-use dsh-nt'") >= 0, label + ' 行尾被引用徽章（0 次不显示）')
      assert(s.indexOf("(curNote.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-meta-chip'") >= 0, label + ' 详情 meta chip（0 次不显示）')
      assert(s.indexOf("tt('meta.useCount', { n: curNote.useCount })") >= 0, label + ' 详情 meta chip「被引用 N 次」（i18n 覆盖卡B 起走 tt() 字典）')
      assert(s.indexOf("((g.totalUseCount || 0) > 0 ? tt('arch.groupUseCount', { n: g.totalUseCount }) : '')") >= 0, label + ' 归档预览组行合计引用数（0 次不显示；i18n 覆盖卡E 起走 tt() 字典）')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("(n.useCount || 0) > 0 ? '<span class=\"use\" title=\"") >= 0, label + ' 行尾被引用徽章（0 次不显示）')
      /* i18n 覆盖卡B：app 详情 chip 走 t() 字典；原型不双语保留中文原文（分侧断言） */
      if (label === 'app.html') assert(s.indexOf("t('meta.useCount', { n: n.useCount })") >= 0, label + ' 详情 meta chip「被引用 N 次」走 t()（覆盖卡B）')
      else assert(s.indexOf("'被引用 ' + n.useCount + ' 次</span>'") >= 0, label + ' 详情 meta chip「被引用 N 次」')
      /* i18n 覆盖卡E：app 归档预览合计走 t() 字典（esc 包裹）；原型不双语保留中文原文（分侧断言，同上行 chip 先例） */
      if (label === 'app.html') assert(s.indexOf("((g.totalUseCount || 0) > 0 ? esc(t('arch.groupUseCount', { n: g.totalUseCount })) : '')") >= 0, label + ' 归档预览组行合计引用数走 t()（覆盖卡E）')
      else assert(s.indexOf("((g.totalUseCount || 0) > 0 ? ' · 被引用 ' + g.totalUseCount + ' 次' : '')") >= 0, label + ' 归档预览组行合计引用数（0 次不显示）')
      assert(s.indexOf('.note-row .use{') >= 0 && s.indexOf('.note-row .use svg.ic{') >= 0, label + ' 行尾徽章样式')
    }
    // 徽章 tooltip 文案：app 走 t() 字典（i18n 覆盖卡A），原型不双语保留中文原文
    assert(appSrc.indexOf("(n.useCount || 0) > 0 ? '<span class=\"use\" title=\"' + esc(t('tree.useCountTip', { n: n.useCount }))") >= 0, 'app.html 行尾被引用徽章 tooltip 走 t() 字典（i18n 覆盖卡A）')
    assert(protoV2Src.indexOf('(n.useCount || 0) > 0 ? \'<span class="use" title="被 Agent 引用（note_get 命中）\'') >= 0, '原型 行尾被引用徽章 tooltip 中文原文（原型不双语红线）')
    // 原型 mock 演示数据（徽章/合计在原型可见）
    assert(protoV2Src.indexOf('useCount: 12') >= 0 && protoV2Src.indexOf('useCount: 7') >= 0 && protoV2Src.indexOf('useCount: 3') >= 0, '原型 mock 演示数据含 useCount')
    assert(protoV2Src.indexOf('totalUseCount: ms.reduce(') >= 0, '原型 mock 归档 preview 合计')
    const cssDev30 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg30 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev30], ['发布包 lib/styles.css', cssPkg30]]) {
      assert(pair[1].indexOf('.dsh-notes-note-use{') >= 0 && pair[1].indexOf('.dsh-notes-note-use .dsh-ic{') >= 0, pair[0] + ' 缺被引用徽章样式')
    }
  })
  Object.assign(S, { fsMockU, handlersU, harnessMockU, storeU })
  }
}
