// 节 33. 整理建议器（notes-suggest + 三段式 modal + 四端同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "33",
  title: "33. 整理建议器（notes-suggest + 三段式 modal + 四端同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, llmMock, mkFsMockImp, plugin, protoV2Src, q1, q2, r1, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // ===== 33. 整理建议器（notes-suggest RPC + 侧栏「整理」入口三段式 modal + 四端同步）=====
  // 契约：notes-suggest（dry-run 零写入）→ { archiveCandidates（速记组，内聚复用 _archivePreview，与 notes-archive-preview 同源）,
  //   staleCandidates（kind=note/link 且超 staleDays 且 useCount===0——遥测保护：useCount>0 不入选）,
  //   orphanCandidates（孤儿：无 [[双链]] 出链/反向链接 + inject=false + useCount=0 + status=active 的普通笔记，排除速记/归档产物防误伤，上限 20）, generatedAt }。
  // 红线：只提名不自动执行——「去归档」直达归档预览对话框；「一键批量软删除」无 confirm 直接逐条 notes-delete（撤销 toast 兜底，notes-034-c-confirm）；孤儿仅展示逐条跳转。
  section('33. 整理建议器（notes-suggest + 三段式 modal + 四端同步）')

  // ---- 33.1 host 双侧：suggest-helpers 标记块逐字节一致 + eval 单测（与 sensitive-helpers/export-single 同款姿势）----
  const grabSuggestBlk = (s, tag) => { const m = s.match(/\/\/ ==== suggest-helpers BEGIN ====[\s\S]*?\/\/ ==== suggest-helpers END ====/); assert(m, tag + ' 缺 suggest-helpers 标记块'); return m[0] }
  const sugBlkDev = grabSuggestBlk(hostSrc, 'host-impl.js')
  const sugBlkPkg = grabSuggestBlk(indexSrc, 'index.mjs')
  const sugNS = {}
  new Function('ns', sugBlkDev + '\nns.suggestCandidates = suggestCandidates; ns.suggestLinkTargetsOf = suggestLinkTargetsOf; ns.SUGGEST_ORPHAN_LIMIT = SUGGEST_ORPHAN_LIMIT; ns.suggestLogHygiene = suggestLogHygiene; ns.suggestISOWeek = suggestISOWeek; ns.suggestLogDateOf = suggestLogDateOf; ns.suggestTelemetryCandidates = suggestTelemetryCandidates; ns.suggestTelemWindowCounts = suggestTelemWindowCounts; ns.SUGGEST_TELEM_WINDOW_DAYS = SUGGEST_TELEM_WINDOW_DAYS; ns.SUGGEST_TELEM_HOT_MIN = SUGGEST_TELEM_HOT_MIN;')(sugNS)
  await t('suggest-helpers 标记块双包逐字节一致 + 可 eval（suggestCandidates/suggestLinkTargetsOf 导出）', () => {
    assert.strictEqual(sugBlkPkg, sugBlkDev, 'host-impl.js 与 index.mjs 的 suggest-helpers 块必须逐字节一致')
    assert.strictEqual(typeof sugNS.suggestCandidates, 'function', 'suggestCandidates 可 eval 导出')
    assert.strictEqual(typeof sugNS.suggestLinkTargetsOf, 'function', 'suggestLinkTargetsOf 可 eval 导出')
    assert.strictEqual(sugNS.SUGGEST_ORPHAN_LIMIT, 20, '孤儿候选上限 20')
  })
  await t('suggest-helpers 日志卫生函数可 eval 导出（suggestLogHygiene/suggestISOWeek/suggestLogDateOf，工作记忆 v0）', () => {
    assert.strictEqual(typeof sugNS.suggestLogHygiene, 'function', 'suggestLogHygiene 可 eval 导出')
    assert.strictEqual(typeof sugNS.suggestISOWeek, 'function', 'suggestISOWeek 可 eval 导出')
    assert.strictEqual(typeof sugNS.suggestLogDateOf, 'function', 'suggestLogDateOf 可 eval 导出')
  })
  await t('suggest-helpers 遥测函数可 eval 导出（suggestTelemetryCandidates/suggestTelemWindowCounts + 窗口/阈值常量，0.4.5-C）', () => {
    assert.strictEqual(typeof sugNS.suggestTelemetryCandidates, 'function', 'suggestTelemetryCandidates 可 eval 导出')
    assert.strictEqual(typeof sugNS.suggestTelemWindowCounts, 'function', 'suggestTelemWindowCounts 可 eval 导出')
    assert.strictEqual(sugNS.SUGGEST_TELEM_WINDOW_DAYS, 14, '遥测窗口缺省 14 天（v0 常量）')
    assert.strictEqual(sugNS.SUGGEST_TELEM_HOT_MIN, 3, '高频阈值缺省 3 次（2 不提名/3 提名边界锁定）')
  })
  await t('suggestTelemetryCandidates 单元（0.4.5-C）：零引用挂载（窗口内事件/新建/死行豁免）+ 高频未挂载（阈值边界 + orphan 豁免面）+ 遥测缺失静默为空', () => {
    const dayMs = 86400000
    const now = Date.now()
    const iso = (d) => new Date(now - d * dayMs).toISOString()
    const dkey = (d) => { const x = new Date(now - d * dayMs); const p = (n) => String(n).padStart(2, '0'); return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) }
    const mk = (over) => Object.assign({ id: 'n-x', title: 'x', kind: 'note', status: 'active', inject: false, useCount: 0, tags: [], mergedFrom: [], createdAt: iso(100), updatedAt: iso(10), body: '' }, over)
    const all = [
      mk({ id: 'm-zero' }),                              // 挂载 + 窗口内零事件（窗口外旧事件不计）→ 提名
      mk({ id: 'm-evt' }),                               // 挂载 + 窗口内 inject 回执 → 豁免
      mk({ id: 'm-new', createdAt: iso(2) }),            // 新建未满窗口期（createdAt 兜底口径）→ 豁免
      mk({ id: 'h-hot', useCount: 3 }),                  // 3 次（search1+get2）→ 提名
      mk({ id: 'h-warm', useCount: 2 }),                 // 窗口内 2 次（窗口外 9 次不计）→ 不提名
      mk({ id: 'h-conv', inject: true, useCount: 5 }),   // 注入中（约定桶）→ 豁免
      mk({ id: 'h-log', kind: 'log', useCount: 5 }),     // 日志 → 豁免
      mk({ id: 'h-sys', kind: 'sys', useCount: 5 }),     // 机器笔记 → 豁免
      mk({ id: 'h-todo', kind: 'todo', useCount: 5 }),   // 非 note/link → 豁免
      mk({ id: 'h-quick', tags: ['quick'], useCount: 5 }),          // 速记 → 豁免（orphan 面同口径）
      mk({ id: 'h-merged', mergedFrom: ['a', 'b'], useCount: 5 }),  // 归档产物 → 豁免
      mk({ id: 'h-pinned', status: 'pinned', useCount: 5 }),        // 显式用户状态 → 豁免
      mk({ id: 'h-link', kind: 'link', useCount: 3 }),   // link ≥3 → 提名
      mk({ id: 'h-mounted', useCount: 9 }),              // 已挂载（即便高频）→ 不提名
    ]
    const mounts = [{ id: 'm-zero', when: '零事件挂载文案' }, { id: 'm-evt', when: 'x' }, { id: 'm-new', when: 'x' }, { id: 'h-mounted', when: 'x' }, { id: 'm-dead', when: 'x' }]   // m-dead 不在 all → 死挂载行不提名
    const telem = {
      receipts: { inject: [{ ts: iso(1), ids: ['m-evt'] }, { ts: iso(30), ids: ['m-zero'] }], mount: [], catalog: [] },
      byDay: {
        search: { [dkey(2)]: { 'h-hot': 1, 'h-link': 3 } },
        get: { [dkey(1)]: { 'h-hot': 2, 'h-warm': 2, 'h-conv': 5, 'h-log': 5, 'h-sys': 5, 'h-todo': 5, 'h-quick': 5, 'h-merged': 5, 'h-pinned': 5, 'h-mounted': 9 }, [dkey(20)]: { 'h-warm': 9 } }
      }
    }
    const r = sugNS.suggestTelemetryCandidates(all, mounts, telem, { nowMs: now, fromDay: dkey(13) })
    assert.deepStrictEqual(r.zeroRefMountCandidates.map(x => x.id), ['m-zero'], '①零引用挂载：仅 挂载+窗口内五通道零事件 提名（窗口外回执/新建/死行均豁免；实得 ' + r.zeroRefMountCandidates.map(x => x.id).join(',') + '）')
    assert.strictEqual(r.zeroRefMountCandidates[0].when, '零事件挂载文案', '零引用条目携带 when（改文案动作预填数据源）')
    const hotIds = r.hotUnmountedCandidates.map(x => x.id)
    assert.deepStrictEqual(hotIds, ['h-hot', 'h-link'], '②高频未挂载：note/link ≥3 提名，2 不提名（边界），约定/log/sys/todo/quick/mergedFrom/pinned/已挂载全豁免（实得 ' + hotIds.join(',') + '）')
    assert.strictEqual(r.hotUnmountedCandidates[0].hits, 3, 'hits 窗口计数（search1+get2=3）')
    // ⑤遥测缺失/损坏静默为空（纯函数层：t=null/非法 → 两键空数组，零异常）
    const r0 = sugNS.suggestTelemetryCandidates(all, mounts, null, { nowMs: now, fromDay: dkey(13) })
    assert(r0.zeroRefMountCandidates.length === 0 && r0.hotUnmountedCandidates.length === 0, 't=null 静默为空')
    const rBad = sugNS.suggestTelemetryCandidates(all, mounts, { receipts: 'broken', byDay: 42 }, { nowMs: now, fromDay: dkey(13) })
    assert.deepStrictEqual(rBad.zeroRefMountCandidates.map(x => x.id).sort(), ['h-mounted', 'm-evt', 'm-zero'], '坏桶自愈：通道桶非法按零事件计——旧挂载全提名（m-new 新建豁免仍成立；实得 ' + rBad.zeroRefMountCandidates.map(x => x.id).join(',') + '）')
    assert(rBad.hotUnmountedCandidates.length === 0, '坏桶自愈：高频零计数不提名')
  })
  await t('host 双侧：notes-suggest RPC 注册 + _suggest 内聚复用 _archivePreview + 生成时间戳（双包同步）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("handle('notes-suggest'") >= 0, label + ' notes-suggest RPC 注册')
      assert(s.indexOf('async function _suggest()') >= 0, label + ' _suggest 存在')
      assert(s.indexOf('const pv = await _archivePreview()') >= 0, label + ' 速记组内聚复用 _archivePreview（结构与 notes-archive-preview 同源）')
      assert(s.indexOf('generatedAt: new Date().toISOString()') >= 0, label + ' generatedAt 时间戳')
      assert(s.indexOf('只提名不执行') >= 0, label + ' 红线注释：只提名不执行')
      assert(s.indexOf('防误伤') >= 0, label + ' orphanCandidates 判定条件注释（防误伤）')
    }
  })
  await t('suggestCandidates 单元：stale 过滤（useCount=0 才入选 + kind=note/link + 超期才入选 + 降序）', () => {
    const dayMs = 86400000
    const iso = (d) => new Date(Date.now() - d * dayMs).toISOString()
    const mk = (over) => Object.assign({ id: 'n-x', title: 'x', kind: 'note', status: 'active', inject: false, useCount: 0, tags: [], mergedFrom: [], updatedAt: iso(10), body: '' }, over)
    const r = sugNS.suggestCandidates([
      mk({ id: 'n-s1', updatedAt: iso(200) }),               // 过期+未引用+note → 入选
      mk({ id: 'n-s2', updatedAt: iso(200), useCount: 3 }),  // 仍被引用 → 不入选（遥测保护）
      mk({ id: 'n-s3', kind: 'todo', updatedAt: iso(200) }), // kind≠note/link → 不入选
      mk({ id: 'n-s4', updatedAt: iso(5) }),                 // 未超期 → 不入选
      mk({ id: 'n-s5', kind: 'link', updatedAt: iso(100) }), // link 过期未引用 → 入选
    ], 90)
    assert.deepStrictEqual(r.staleCandidates.map(x => x.id).sort(), ['n-s1', 'n-s5'], 'stale 仅过期+未引用+note/link 入选（实得 ' + r.staleCandidates.map(x => x.id).join(',') + '）')
    assert(r.staleCandidates[0].id === 'n-s1' && r.staleCandidates[0].staleDays >= 199, 'staleDays 降序（200 天在前）')
    assert(r.staleCandidates[0].topic !== undefined && r.staleCandidates[0].updatedAt, 'stale 条目含 id/title/topic/updatedAt/staleDays')
    assert.strictEqual(sugNS.suggestCandidates([mk({ id: 'n-s1', updatedAt: iso(200) })], 0).staleCandidates.length, 0, 'staleLimit=0（时效关闭）→ stale 段为空')
  })
  await t('suggestCandidates 单元：orphan 判定（防误伤逐项排除：inject/useCount/quick/归档产物/出链/反向链接/status/kind）+ 上限 20 最旧在前', () => {
    const mk = (over) => Object.assign({ id: 'n-x', title: 'x', kind: 'note', status: 'active', inject: false, useCount: 0, tags: [], mergedFrom: [], updatedAt: '2026-01-01T00:00:00.000Z', body: '' }, over)
    const pool = [
      mk({ id: 'n-o1', title: '纯孤儿' }),                                     // 入选
      mk({ id: 'n-o2', inject: true }),                                        // 注入中 → 排除
      mk({ id: 'n-o3', useCount: 2 }),                                         // 被引用过 → 排除
      mk({ id: 'n-o4', tags: ['quick'] }),                                     // 速记 → 排除（archive 通道）
      mk({ id: 'n-o5', mergedFrom: ['n-a', 'n-b'] }),                          // 归档产物 → 排除
      mk({ id: 'n-o6', body: '见 [[不存在目标]] 吗' }),                         // 有出链 → 排除
      mk({ id: 'n-o7', title: '被链目标' }),                                   // 被 n-o8 [[标题]] 反链 → 排除
      mk({ id: 'n-o8', body: '引用 [[被链目标]]' }),                           // 有出链 → 排除
      mk({ id: 'n-o9', status: 'pinned' }),                                    // 置顶 → 排除
      mk({ id: 'n-o10', status: 'resolved' }),                                 // 已解决 → 排除
      mk({ id: 'n-o11', kind: 'todo' }),                                       // 非普通笔记 → 排除
      mk({ id: 'n-o12', body: '链 [[n-o13]]' }),                               // 有出链 → 排除
      mk({ id: 'n-o13', title: '被id链' }),                                    // 被 n-o12 [[id]] 反链 → 排除
    ]
    const r = sugNS.suggestCandidates(pool, 0)
    assert.deepStrictEqual(r.orphanCandidates.map(x => x.id), ['n-o1'], '仅纯孤儿入选（实得 ' + r.orphanCandidates.map(x => x.id).join(',') + '）')
    const many = []
    for (let i = 1; i <= 25; i++) many.push(mk({ id: 'n-m' + String(i).padStart(2, '0'), updatedAt: '2026-01-' + String(i).padStart(2, '0') + 'T00:00:00.000Z' }))
    const r2 = sugNS.suggestCandidates(many, 0)
    assert.strictEqual(r2.orphanCandidates.length, 20, '孤儿上限 20（实得 ' + r2.orphanCandidates.length + '）')
    assert.strictEqual(r2.orphanCandidates[0].id, 'n-m01', '最旧在前')
  })

  // ---- 33.2 host 行为级（开发版独立实例 storeSG/handlersSG，与 32 节同款隔离模式）----
  const storeSG = new Map()
  const fsMockSG = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeSG.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeSG.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeSG.has(p)) throw new Error('ENOENT: ' + p); return storeSG.get(p) },
    writeText: async (p, c) => { storeSG.set(p, c) },
  }
  const handlersSG = {}
  const harnessMockSG = { handle: (name, fn) => { handlersSG[name] = fn; return () => { delete handlersSG[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockSG, DIR).apply({
    fs: fsMockSG, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('notes-suggest 三段返回 + 遥测/时效闭环 + 零写入（开发版独立实例）', async () => {
    const dayMs = 86400000
    const iso = (d) => new Date(Date.now() - d * dayMs).toISOString()
    // 直写 store 造库（front-matter 确定性 updatedAt/useCount）：
    // 速记组 ×2（sess-sg-1）+ 过期未引用 note(200d)/link(150d) + 过期但被引用(useCount=4) + 孤儿 + 出链/反链对 + 注入中 + 单条速记（不成组）
    const seed = (id, fm, body) => storeSG.set(NOTES_DIR + '\\' + id + '.md', '---\nid: ' + id + '\n' + fm.join('\n') + '\n---\n\n' + body)
    seed('n-sg-q1', ['title: 速记甲', 'topic: 调试', 'tags: quick', 'sessionId: sess-sg-1', 'createdAt: "' + iso(3) + '"', 'updatedAt: "' + iso(3) + '"'], '速记内容一')
    seed('n-sg-q2', ['title: 速记乙', 'topic: 调试', 'tags: quick', 'sessionId: sess-sg-1', 'createdAt: "' + iso(2) + '"', 'updatedAt: "' + iso(2) + '"'], '速记内容二')
    seed('n-sg-stale1', ['title: 陈旧笔记', 'topic: 运维', 'createdAt: "' + iso(200) + '"', 'updatedAt: "' + iso(200) + '"'], '陈旧正文')
    seed('n-sg-stale-link', ['title: 陈旧链接', 'topic: ' + '资料', 'kind: link', 'createdAt: "' + iso(150) + '"', 'updatedAt: "' + iso(150) + '"'], 'https://example.com/old')
    seed('n-sg-stale-used', ['title: 陈旧但被引用', 'topic: 运维', 'useCount: 4', 'createdAt: "' + iso(200) + '"', 'updatedAt: "' + iso(200) + '"'], '仍被 agent 引用')
    seed('n-sg-orphan', ['title: ' + '孤立笔记', 'topic: 其他', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '无链正文')
    seed('n-sg-linker', ['title: 出链笔记', 'topic: 其他', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '见 [[n-sg-linked]] 的说明')
    seed('n-sg-linked', ['title: 被反链笔记', 'topic: 其他', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '被引用正文')
    seed('n-sg-inject', ['title: 注入中笔记', 'topic: 约定', 'inject: true', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '注入正文')
    seed('n-sg-quick-single', ['title: 单条速记', 'topic: 调试', 'tags: quick', 'sessionId: sess-sg-2', 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '单条速记不成组')
    // ---- 0.4.5-C 遥测候选 fixture：telemetry.json 直写（meta.lastFlush/migratedAt 齐备——可用性闸门通过 + 迁移跳过，读前 flush 非脏零写入）----
    //   窗口 = 14 天：iso(30)/dkeySG(20) 为窗口外事件（不计）；豁免面 fixture 与 33.1 单测同构（约定/log/sys/todo/quick 高频全豁免）
    const dkeySG = (d) => { const x = new Date(Date.now() - d * dayMs); const p = (n) => String(n).padStart(2, '0'); return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) }
    seed('n-sg-mtz', ['title: 零事件旧挂载', 'topic: 资料', 'useCount: 0', 'createdAt: "' + iso(200) + '"', 'updatedAt: "' + iso(10) + '"'], '挂载但窗口内零事件')
    seed('n-sg-mtevt', ['title: 有事件挂载', 'topic: 资料', 'useCount: 1', 'createdAt: "' + iso(200) + '"', 'updatedAt: "' + iso(10) + '"'], '窗口内 inject 事件')
    seed('n-sg-mtnew', ['title: 新建挂载', 'topic: 资料', 'createdAt: "' + iso(2) + '"', 'updatedAt: "' + iso(2) + '"'], '新建未满窗口期')
    seed('n-sg-hot', ['title: 高频笔记', 'topic: 调试', 'useCount: 3', 'createdAt: "' + iso(60) + '"', 'updatedAt: "' + iso(10) + '"'], 'search1+get2=3 次')
    seed('n-sg-hotlink', ['title: 高频链接', 'topic: 资料', 'kind: link', 'useCount: 3', 'createdAt: "' + iso(60) + '"', 'updatedAt: "' + iso(10) + '"'], 'https://example.com/hot')
    seed('n-sg-warm', ['title: 低频笔记', 'topic: 调试', 'useCount: 2', 'createdAt: "' + iso(60) + '"', 'updatedAt: "' + iso(10) + '"'], '窗口内仅 2 次（阈值边界；窗口外 9 次不计）')
    seed('n-sg-conv', ['title: 约定高频', 'topic: 约定', 'inject: true', 'useCount: 5', 'createdAt: "' + iso(60) + '"', 'updatedAt: "' + iso(10) + '"'], '注入中豁免')
    seed('n-sg-loghot', ['title: 日志高频', 'kind: log', 'useCount: 5', 'logDate: ' + dkeySG(1), 'createdAt: "' + iso(1) + '"', 'updatedAt: "' + iso(1) + '"'], '日志豁免')
    seed('n-sg-syshot', ['title: 高频 sys', 'kind: sys', 'useCount: 5', 'createdAt: "' + iso(60) + '"', 'updatedAt: "' + iso(10) + '"'], 'sys 豁免')
    seed('n-sg-todohot', ['title: 高频待办', 'kind: todo', 'useCount: 5', 'createdAt: "' + iso(60) + '"', 'updatedAt: "' + iso(10) + '"'], 'todo 豁免')
    seed('n-sg-quickhot', ['title: 高频速记', 'tags: quick', 'sessionId: sess-sg-9', 'useCount: 5', 'createdAt: "' + iso(60) + '"', 'updatedAt: "' + iso(10) + '"'], 'quick 豁免')
    const telemByDayGet = {}; telemByDayGet[dkeySG(1)] = { 'n-sg-hot': 2, 'n-sg-warm': 2, 'n-sg-conv': 5, 'n-sg-loghot': 5, 'n-sg-syshot': 5, 'n-sg-todohot': 5, 'n-sg-quickhot': 5 }; telemByDayGet[dkeySG(20)] = { 'n-sg-warm': 9 }
    const telemByDaySearch = {}; telemByDaySearch[dkeySG(2)] = { 'n-sg-hot': 1, 'n-sg-hotlink': 3 }
    storeSG.set(NOTES_DIR + '\\telemetry.json', JSON.stringify({
      version: 1,
      receipts: { inject: [{ ts: iso(1), ids: ['n-sg-mtevt'] }, { ts: iso(30), ids: ['n-sg-mtz'] }], mount: [], catalog: [] },
      byDay: { search: telemByDaySearch, get: telemByDayGet },
      facets: { use: { 'n-sg-hot': 3, 'n-sg-hotlink': 3, 'n-sg-warm': 11, 'n-sg-mtevt': 1 } },
      meta: { migratedAt: iso(40), lastFlush: iso(0) }
    }))
    // 三笔记挂载（notes-mount 翻 reference 档 + 落 §1 行；挂载本身不落遥测事件——mount 通道 = 派发语义）
    for (const mid of ['n-sg-mtz', 'n-sg-mtevt', 'n-sg-mtnew']) {
      const mt = await handlersSG['notes-mount']({ id: mid, whenToUse: mid === 'n-sg-mtz' ? '零事件挂载文案045C' : 'fixture 挂载行 ' + mid })
      assert(mt && mt.ok === true, '挂载 fixture 成功：' + mid + '（实得 ' + JSON.stringify(mt).slice(0, 120) + '）')
    }
    // 启动异步写沉降（notes-043-index 升级首启 idxEnsure 的索引笔记 + settings.json 为 fire-and-forget 写）：
    // 先跑一个 awaited RPC + 宏任务等待让启动写落定，再取零写入基线快照
    await handlersSG['notes-list']({})
    await new Promise(r2 => setTimeout(r2, 60))
    const keysBefore = Array.from(storeSG.keys()).filter(k => k.indexOf(NOTES_DIR + '\\') === 0).sort()
    const r = await handlersSG['notes-suggest']({})
    const keysAfter = Array.from(storeSG.keys()).filter(k => k.indexOf(NOTES_DIR + '\\') === 0).sort()
    assert.deepStrictEqual(keysAfter, keysBefore, 'notes-suggest 零写入（NOTES_DIR 键集合不变）')
    assert(!r.error, '无报错（实得 ' + JSON.stringify(r).slice(0, 160) + '）')
    assert(typeof r.generatedAt === 'string' && r.generatedAt.length > 10, 'generatedAt 时间戳存在')
    // a. 速记组：与 notes-archive-preview 逐字段一致（内聚复用）
    const pv = await handlersSG['notes-archive-preview']({})
    assert.deepStrictEqual(r.archiveCandidates, pv.quickGroups, 'archiveCandidates 与 notes-archive-preview.quickGroups 逐字段一致')
    assert(r.archiveCandidates.length === 1 && r.archiveCandidates[0].sessionId === 'sess-sg-1' && r.archiveCandidates[0].members.length === 2, '速记组 1 组 2 条（实得 ' + JSON.stringify(r.archiveCandidates).slice(0, 160) + '）')
    assert(typeof r.archiveCandidates[0].totalUseCount === 'number' && r.archiveCandidates[0].dateSpan && typeof r.archiveCandidates[0].totalBytes === 'number', '组附 totalUseCount/dateSpan/totalBytes')
    // b. 过期未引用：useCount=0 才入选（遥测保护：n-sg-stale-used 不入选）
    const staleIds = r.staleCandidates.map(x => x.id).sort()
    assert.deepStrictEqual(staleIds, ['n-sg-stale-link', 'n-sg-stale1'], 'stale 仅过期+未引用+note/link（实得 ' + staleIds.join(',') + '）')
    assert(r.staleCandidates[0].id === 'n-sg-stale1' && r.staleCandidates[0].staleDays >= 199, 'staleDays 降序 + 天数正确')
    // c. 孤儿：纯孤儿入选；出链/反链/注入/速记/被引用均排除（防误伤）
    const orphIds = r.orphanCandidates.map(x => x.id).sort()
    assert(orphIds.indexOf('n-sg-orphan') >= 0, '纯孤儿入选')
    for (const excluded of ['n-sg-linker', 'n-sg-linked', 'n-sg-inject', 'n-sg-quick-single', 'n-sg-stale-used', 'n-sg-q1', 'n-sg-q2', 'n-sg-stale-link']) {
      assert(orphIds.indexOf(excluded) < 0, '防误伤排除：' + excluded)
    }
    assert(orphIds.length <= 20, '孤儿上限 20')
  })
  await t('notes-suggest 时效阈值跟随 settings.staleDays（override 生效 + 0 关闭 + null 恢复缺省）', async () => {
    await handlersSG['notes-settings-set']({ staleDays: 300 })
    const r1 = await handlersSG['notes-suggest']({})
    assert.strictEqual(r1.staleCandidates.length, 0, 'staleDays=300：200/150 天均未超期 → stale 空')
    await handlersSG['notes-settings-set']({ staleDays: 160 })
    const r2 = await handlersSG['notes-suggest']({})
    assert.deepStrictEqual(r2.staleCandidates.map(x => x.id), ['n-sg-stale1'], 'staleDays=160：仅 200 天入选（150 天出局）')
    await handlersSG['notes-settings-set']({ staleDays: 0 })
    const r3 = await handlersSG['notes-suggest']({})
    assert.strictEqual(r3.staleCandidates.length, 0, 'staleDays=0 关闭时效 → stale 段为空')
    await handlersSG['notes-settings-set']({ staleDays: null })
    const r4 = await handlersSG['notes-suggest']({})
    assert.strictEqual(r4.staleCandidates.length, 2, 'null 恢复缺省 90 → 两条回到候选')
  })
  await t('notes-suggest 遥测两类候选（0.4.5-C 行为级）：零引用挂载提名/窗口内事件豁免/新建豁免 + 高频未挂载阈值边界 + 豁免面全覆盖', async () => {
    const r = await handlersSG['notes-suggest']({})
    assert(!r.error, '无报错（实得 ' + JSON.stringify(r).slice(0, 120) + '）')
    assert(Array.isArray(r.zeroRefMountCandidates) && Array.isArray(r.hotUnmountedCandidates) && r.telemetryWindowDays === 14, '两新键 + telemetryWindowDays 齐备')
    const zr = r.zeroRefMountCandidates.map(x => x.id)
    assert(zr.indexOf('n-sg-mtz') >= 0, '①零引用挂载提名：挂载 + 窗口内五通道零事件（窗口外 inject 回执不计；实得 ' + zr.join(',') + '）')
    assert(zr.indexOf('n-sg-mtevt') < 0, '②窗口内有事件的挂载不提名（inject 回执在窗内）')
    assert(zr.indexOf('n-sg-mtnew') < 0, '新建未满窗口期的挂载豁免（createdAt 兜底口径）')
    const zrItem = r.zeroRefMountCandidates.find(x => x.id === 'n-sg-mtz')
    assert(zrItem && zrItem.when === '零事件挂载文案045C', '零引用条目携带 when 文案（改文案动作预填数据源）')
    const hotIds = r.hotUnmountedCandidates.map(x => x.id)
    assert(hotIds.indexOf('n-sg-hot') >= 0 && hotIds.indexOf('n-sg-hotlink') >= 0, '③高频未挂载提名：note/link ≥3 次（实得 ' + hotIds.join(',') + '）')
    assert(hotIds.indexOf('n-sg-warm') < 0, '③阈值边界：窗口内 2 次不提名（窗口外 9 次不计）')
    for (const ex of ['n-sg-conv', 'n-sg-loghot', 'n-sg-syshot', 'n-sg-todohot', 'n-sg-quickhot', 'n-sg-mtz', 'n-sg-mtevt', 'n-sg-mtnew']) {
      assert(hotIds.indexOf(ex) < 0, '④豁免面/已挂载不提名：' + ex)
    }
    const hotItem = r.hotUnmountedCandidates.find(x => x.id === 'n-sg-hot')
    assert(hotItem && hotItem.hits === 3, 'hits 窗口计数（search1+get2=3；实得 ' + (hotItem && hotItem.hits) + '）')
  })
  await t('notes-suggest 遥测动作行为级（0.4.5-C）：摘除挂载复用 notes-update inject:false——§1 行消失 + 笔记保留 + 候选收敛（不删笔记红线）', async () => {
    const u = await handlersSG['notes-update']({ id: 'n-sg-mtz', inject: false })
    assert(!u.error, '摘除挂载（关注入通道）成功（实得 ' + JSON.stringify(u).slice(0, 120) + '）')
    const ml = await handlersSG['notes-mount-list']({})
    assert(ml.lines.every(l => l.id !== 'n-sg-mtz'), '⑥摘除后 §1 挂载行消失（_idxSyncMount 联动摘行）')
    assert(ml.lines.some(l => l.id === 'n-sg-mtevt'), '其余挂载行不受影响')
    const g = await handlersSG['notes-get']({ id: 'n-sg-mtz' })
    assert(g.note && g.note.deleted !== true && g.note.inject === false, '摘除不删笔记（本体保留，inject=false）')
    const r = await handlersSG['notes-suggest']({})
    assert(r.zeroRefMountCandidates.every(x => x.id !== 'n-sg-mtz'), '摘除后候选收敛（不再提名）')
    // 挂载动作 = 既有 notes-mount 通道（MountModal 确认落点）：重挂 n-sg-mtz 即恢复 §1 行（往返语义）
    const mt = await handlersSG['notes-mount']({ id: 'n-sg-mtz', whenToUse: '零事件挂载文案045C' })
    assert(mt && mt.ok === true, '重挂成功（MountModal 确认通道 = notes-mount 既有链路）')
    const ml2 = await handlersSG['notes-mount-list']({})
    assert(ml2.lines.some(l => l.id === 'n-sg-mtz'), '重挂后 §1 行恢复')
  })

  // ---- 33.3 静态包行为（index.mjs 独立 ESM 实例，harness 主通道）----
  await t('静态包：notes-suggest 注册 + 三段结构 + 孤儿入选（index.mjs 独立实例）', async () => {
    const storeSug = new Map()
    const fsMockSug = mkFsMockImp(storeSug, [NOTES_ROOT_STATIC])
    const handlersSug = {}
    const harnessMockSug = { handle: (name, fn) => { handlersSug[name] = fn; return () => { delete handlersSug[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    global.harness = harnessMockSug   // 静态包 handle() 主通道读全局 harness（apply 时解析）；指回本实例的注册表
    const modSug = await import(pathToFileURL(INDEX_PATH).href + '?suggest=1')
    modSug.apply({
      fs: fsMockSug, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: () => () => {} }, tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    assert.strictEqual(typeof handlersSug['notes-suggest'], 'function', '静态包注册 notes-suggest')
    const c = await handlersSug['notes-create']({ title: '静态建议笔记', body: 'x' })
    const r = await handlersSug['notes-suggest']({})
    assert(!r.error && Array.isArray(r.archiveCandidates) && Array.isArray(r.staleCandidates) && Array.isArray(r.orphanCandidates) && typeof r.generatedAt === 'string', '三段 + generatedAt 结构齐备（实得 ' + JSON.stringify(r).slice(0, 160) + '）')
    assert(r.orphanCandidates.some(x => x.id === c.id), '新建普通笔记（无链/未引用/进行中）入选孤儿')
    // 0.4.5-C：遥测两键结构 + ⑤遥测缺失静默降级（无 telemetry.json → meta.lastFlush 闸门闭合 → 两键空数组，stale/orphan 既有输出零影响）
    assert(Array.isArray(r.zeroRefMountCandidates) && Array.isArray(r.hotUnmountedCandidates) && r.telemetryWindowDays === 14, '静态包遥测两键 + 窗口天数齐备')
    assert(r.zeroRefMountCandidates.length === 0 && r.hotUnmountedCandidates.length === 0, '⑤遥测缺失静默为空（新装库零遥测 → 两类候选不提名）')
  })

  // ---- 33.4 client 结构断言（开发版 client-impl + 发布包 lib/client.js + 样式双端）----
  await t('client 整理建议：设置卡片「整理建议」行入口 + 三段式 modal + Esc + 错误条互斥（开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("key: 'suggest', label: tt('settings.suggest')") >= 0, label + ' 设置卡片「整理建议」行（底部收敛后的入口；覆盖卡 C 起 label 走 tt() 字典）')
      assert(s.indexOf("onClick: openSuggest }, tt('settings.openBtn')") >= 0, label + ' 整理建议行控件 → openSuggest')
      assert(s.indexOf('整理建议：速记组归档') >= 0, label + ' 整理建议入口 tooltip 文案保留')
      assert(s.indexOf('function openSuggest()') >= 0 && s.indexOf('function loadSuggest()') >= 0, label + ' openSuggest/loadSuggest 存在')
      assert(s.indexOf("' ' + tt('settings.suggest')") >= 0 && s.indexOf('只提名不自动执行') >= 0, label + ' modal 标题 + 红线副标（i18n 覆盖卡E 起标题走 tt()，副标 zh 原串字典内嵌）')
      assert(s.indexOf('可整理的速记组') >= 0 && s.indexOf('过期未引用') >= 0 && s.indexOf('可能无用') >= 0, label + ' 三段标题')
      assert(s.indexOf('库很干净，无需整理') >= 0, label + ' 空态文案「库很干净，无需整理」')
      assert(s.indexOf('dsh-notes-suggest-sec') >= 0, label + ' 分节样式类')
      assert(s.indexOf('if (suggestOpenRef.current) { setSuggestOpen(false); return }') >= 0, label + ' Esc 链路关建议框')
      assert(s.indexOf('!injectPreviewOpen && !suggestOpen') >= 0, label + ' 全局错误条排除建议 modal（modal 内自显错误）')
    }
    assert(clientSrc.indexOf("host.call('notes-suggest', {})") >= 0, 'openSuggest 走 notes-suggest（dry-run 零写入）')
    assert(clientPkgSrc.indexOf("rpc('notes-suggest', {})") >= 0, '发布包同链路（rpc 形态，需先跑 scripts/build-dist.cjs）')
  })
  await t('client 建议动作：去归档直达归档预览 / 批量软删无 confirm（撤销 toast 兜底）+ 逐条 notes-delete payload / 孤儿仅展示逐条跳转', () => {
    // ① 速记组「去归档」：关建议框 → openArchive（归档预览对话框，数据同源）
    assert(clientSrc.indexOf('function suggestGoArchive() { setSuggestOpen(false); openArchive() }') >= 0, '「去归档」直达归档预览对话框')
    assert(clientPkgSrc.indexOf('function suggestGoArchive()') >= 0, '发布包同步 suggestGoArchive')
    // ② 过期未引用「一键批量软删除」：无 confirm（确认强度 = 不可恢复性：软删可恢复 → 轻，撤销 toast 兜底；notes-034-c-confirm）+ 逐条 notes-delete + 删后收尾刷新
    assert(clientSrc.indexOf("window.confirm('一键批量软删除：'") < 0, '批量软删不再 window.confirm（软删可恢复 → 轻确认）')
    assert(clientSrc.indexOf("fn: () => undoSuggestBatchDelete(okIds)") >= 0 && clientSrc.indexOf('async function undoSuggestBatchDelete(ids)') >= 0, '批量软删 toast 带「撤销」动作')
    assert(clientSrc.indexOf("await host.call('notes-restore', { id: id })") >= 0, '撤销链路逐条 notes-restore')
    assert(clientSrc.indexOf("await host.call('notes-delete', { id: n.id })") >= 0, '逐条 notes-delete payload（软删，回收站可恢复）')
    assert(clientPkgSrc.indexOf("await rpc('notes-delete', { id: n.id })") >= 0, '发布包同批量软删 payload（rpc 形态）')
    assert(clientPkgSrc.indexOf("await rpc('notes-restore', { id: id })") >= 0, '发布包同批量软删撤销链路（rpc 形态，需先跑 scripts/build-dist.cjs）')
    assert(clientSrc.indexOf('afterArchiveCleanup(list.map(n => n.id))') >= 0, '删后收尾：正打开笔记退出选中态（归档同款）')
    assert(clientSrc.indexOf('loadSuggest()') >= 0, '删后刷新建议数据（三段联动）')
    // ③ 孤儿仅展示：「查看」逐条跳转（jumpToWikiTarget 同款过滤退回）；无批量操作（启发式判定防误伤）
    assert(clientSrc.indexOf('function suggestViewNote(id) { setSuggestOpen(false); jumpToWikiTarget(id) }') >= 0, '孤儿「查看」逐条跳转')
    // ④ 0.4.5-C 遥测两段动作：摘除挂载 = notes-update inject:false 既有通道（零新 RPC）；挂载/改文案 = panelBridge.openMountModal 复用 MountModal
    assert(clientSrc.indexOf('async function suggestUnmount(n)') >= 0 && clientSrc.indexOf("host.call('notes-update', { id: n.id, inject: false })") >= 0, '摘除挂载走 notes-update inject:false（host 联动摘行，不删笔记）')
    assert(clientSrc.indexOf('function suggestMountNote(n)') >= 0 && clientSrc.indexOf('function suggestEditWhen(n)') >= 0, '挂载/改文案函数存在')
    assert(clientSrc.indexOf("panelBridge.openMountModal({ id: n.id, title: n.title || n.id }, { onConfirmed: () => openSuggest() })") >= 0, '挂载 → MountModal LLM 草稿模式（确认后回开建议框）')
    assert(clientSrc.indexOf("panelBridge.openMountModal({ id: n.id, title: n.title || n.id, existing: n.when || '' }, { onConfirmed: () => openSuggest() })") >= 0, '改文案 → MountModal 编辑模式（existing 预填现文案）')
    assert(clientSrc.indexOf("tt('sugg.secZeroRef')") >= 0 && clientSrc.indexOf("tt('sugg.secHot')") >= 0 && clientSrc.indexOf("tt('sugg.hotMeta'") >= 0, '遥测两段标题/计数行走 tt() 字典')
    assert(clientSrc.indexOf("window.confirm(t('sugg.unmountConfirm'") >= 0, '摘除挂载 confirm 闸门（重挂载需手工 → 给一次确认）')
    assert(clientPkgSrc.indexOf('function suggestMountNote(n)') >= 0 && clientPkgSrc.indexOf("rpc('notes-update', { id: n.id, inject: false })") >= 0, '发布包同步遥测两段动作（rpc 形态，需先跑 scripts/build-dist.cjs）')
    const sec3 = clientSrc.match(/tt\('sugg\.secOrphan'\)[\s\S]*?tt\('sugg\.criteriaClient'\)/)   // 锚定③段标题行（tt() 字典形态，i18n 覆盖卡E），避开段头注释与②段批量按钮
    assert(sec3 && sec3[0].indexOf("tt('sugg.view')") >= 0 && sec3[0].indexOf('doSuggestBatchDelete') < 0 && sec3[0].indexOf('danger') < 0, '孤儿段仅展示（查看按钮走 tt()，无批量/danger 操作）')
  })
  await t('整理建议样式双端：styles.css ⇄ 发布包 lib/styles.css', () => {
    const cssDevS = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgS = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDevS], ['发布包 lib/styles.css', cssPkgS]]) {
      for (const cls of ['.dsh-notes-suggest-modal{', '.dsh-notes-suggest-sec{', '.dsh-notes-suggest-sec-t{', '.dsh-notes-suggest-sec-n{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺整理建议样式：' + cls + '（需跑 scripts/build-dist.cjs）')
      }
    }
  })

  // ---- 33.5 app.html / 原型 notes-ui-v2.html 同款（UI 唯一规格来源约束）----
  await t('app.html + 原型整理建议同款：设置卡片「整理建议」行入口 + 三段式 modal + 批量软删无 confirm（撤销 toast 兜底）+ 孤儿仅展示（双端 UI 标记一致 + mock 演示）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="btnSuggest"') < 0, label + ' 底部「整理」按钮已移除（收敛进设置卡片）')
      assert(s.indexOf('id="setSuggest"') >= 0, label + ' 设置卡片「整理建议」行入口')
      assert(s.indexOf("$('setSuggest').onclick = function () { openSuggest() }") >= 0, label + ' 入口接线（设置卡片）')
      assert(s.indexOf('function openSuggest()') >= 0 && s.indexOf('function renderSuggestList()') >= 0 && s.indexOf('function doSuggestBatchDelete()') >= 0, label + ' 建议三函数')
      assert(s.indexOf("rpc('notes-suggest', {})") >= 0, label + ' RPC 调用 notes-suggest')
      assert(s.indexOf('整理建议') >= 0 && s.indexOf('可整理的速记组') >= 0 && s.indexOf('过期未引用') >= 0 && s.indexOf('可能无用') >= 0, label + ' modal 三段标题')
      assert(s.indexOf('库很干净，无需整理') >= 0, label + ' 空态文案')
      assert(s.indexOf('.sg-sec{') >= 0 && s.indexOf('.sg-sec-t{') >= 0, label + ' 分节样式')
      assert(s.indexOf("confirm('一键批量软删除：'") < 0, label + ' 批量软删不再 confirm（软删可恢复 → 轻确认，notes-034-c-confirm）')
      assert(s.indexOf('function undoSuggestBatchDelete(ids)') >= 0, label + ' 批量软删撤销函数存在（逐条 notes-restore）')
      assert(s.indexOf("rpc('notes-delete', { id: n.id })") >= 0, label + ' 逐条 notes-delete payload')
      assert(s.indexOf('sgGoArch') >= 0 && s.indexOf('openArchive()') >= 0, label + ' 「去归档」直达归档预览')
      /* 0.4.5-C 遥测两段（仅 app.html 断言；原型 notes-ui-v2.html 本卡不扩——只提名段UI规格未入原型，留痕 selfTest） */
      if (label === 'app.html') {
        assert(s.indexOf("t('sugg.secZeroRef')") >= 0 && s.indexOf("t('sugg.secHot')") >= 0, label + ' 遥测两段标题走 t()')
        assert(s.indexOf('sg-unmount') >= 0 && s.indexOf('sg-editwhen') >= 0 && s.indexOf('sg-mount') >= 0, label + ' 遥测两段动作按钮类')
        assert(s.indexOf("rpc('notes-update', { id: id, inject: false })") >= 0, label + ' 摘除挂载走 notes-update inject:false 既有通道')
        assert(s.indexOf("openMountModal({ id: n.id, title: n.title || n.id, existing: n.when || '' }, function () { openSuggest() })") >= 0, label + ' 改文案 → MountModal 编辑模式（确认回开建议框）')
        assert(s.indexOf("openMountModal({ id: n.id, title: n.title || n.id }, function () { openSuggest() })") >= 0, label + ' 挂载 → MountModal LLM 草稿模式')
      }
      /* i18n 覆盖卡E：app 端三段标题/孤儿段文案走 t() 字典（zh 原串随字典内嵌），原型不双语保留中文原文（分侧断言） */
      const sec3 = label === 'app.html' ? s.match(/t\('sugg\.secOrphan'\)[\s\S]*?t\('sugg\.criteria'\)/) : s.match(/>可能无用<span[\s\S]*?判定口径/)   // 锚定③段标题行，避开段头注释与②段批量按钮
      assert(sec3, label + ' 孤儿段锚点可提取')
      if (label === 'app.html') assert(sec3[0].indexOf("t('sugg.view')") >= 0 && sec3[0].indexOf('sgBatchDel') < 0 && sec3[0].indexOf('danger') < 0, label + ' 孤儿段仅展示（查看按钮走 t()，无批量操作）')
      else assert(sec3[0].indexOf('查看') >= 0 && sec3[0].indexOf('一键批量') < 0 && sec3[0].indexOf('danger') < 0, label + ' 孤儿段仅展示（无批量操作）')
      assert(s.indexOf('suggestState = null; histState = null; memEnableState = null; dState = null; return }') >= 0, label + ' Esc 统一关建议框（连带历史面板 histState / 工作记忆启用框 memEnableState / 派发框 dState 复位——notes-034-sched-ui 起追加 dState）')
    }
    // 双端 UI 标记一致（共享 DOM id / 函数名 / 样式类）
    for (const k of ['setSuggest', 'openSuggest', 'loadSuggest', 'renderSuggestList', 'doSuggestBatchDelete', 'suggestState', 'sgGoArch', 'sgBatchDel', 'sg-view', 'sg-sec']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '整理建议 UI 标记双端一致：' + k)
    }
    assert(protoV2Src.indexOf("method === 'notes-suggest'") >= 0, '原型 mock 含 notes-suggest')
    assert(protoV2Src.indexOf('过期演示') >= 0 && protoV2Src.indexOf('孤儿演示') >= 0, '原型 mock 演示数据（过期 + 孤儿）')
  })
  Object.assign(S, { sugNS })
  }
}
