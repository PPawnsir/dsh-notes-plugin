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
  // 红线：只提名不自动执行——「去归档」直达归档预览对话框；「一键批量软删除」confirm 后才逐条 notes-delete；孤儿仅展示逐条跳转。
  section('33. 整理建议器（notes-suggest + 三段式 modal + 四端同步）')

  // ---- 33.1 host 双侧：suggest-helpers 标记块逐字节一致 + eval 单测（与 sensitive-helpers/export-single 同款姿势）----
  const grabSuggestBlk = (s, tag) => { const m = s.match(/\/\/ ==== suggest-helpers BEGIN ====[\s\S]*?\/\/ ==== suggest-helpers END ====/); assert(m, tag + ' 缺 suggest-helpers 标记块'); return m[0] }
  const sugBlkDev = grabSuggestBlk(hostSrc, 'host-impl.js')
  const sugBlkPkg = grabSuggestBlk(indexSrc, 'index.mjs')
  const sugNS = {}
  new Function('ns', sugBlkDev + '\nns.suggestCandidates = suggestCandidates; ns.suggestLinkTargetsOf = suggestLinkTargetsOf; ns.SUGGEST_ORPHAN_LIMIT = SUGGEST_ORPHAN_LIMIT; ns.suggestLogHygiene = suggestLogHygiene; ns.suggestISOWeek = suggestISOWeek; ns.suggestLogDateOf = suggestLogDateOf;')(sugNS)
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
  })

  // ---- 33.4 client 结构断言（开发版 client-impl + 发布包 lib/client.js + 样式双端）----
  await t('client 整理建议：设置卡片「整理建议」行入口 + 三段式 modal + Esc + 错误条互斥（开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("key: 'suggest', label: '整理建议'") >= 0, label + ' 设置卡片「整理建议」行（底部收敛后的入口）')
      assert(s.indexOf("onClick: openSuggest }, '打开'") >= 0, label + ' 整理建议行控件 → openSuggest')
      assert(s.indexOf('整理建议：速记组归档') >= 0, label + ' 整理建议入口 tooltip 文案保留')
      assert(s.indexOf('function openSuggest()') >= 0 && s.indexOf('function loadSuggest()') >= 0, label + ' openSuggest/loadSuggest 存在')
      assert(s.indexOf("' 整理建议'") >= 0 && s.indexOf('只提名不自动执行') >= 0, label + ' modal 标题 + 红线副标')
      assert(s.indexOf('可整理的速记组') >= 0 && s.indexOf('过期未引用') >= 0 && s.indexOf('可能无用') >= 0, label + ' 三段标题')
      assert(s.indexOf('库很干净，无需整理') >= 0, label + ' 空态文案「库很干净，无需整理」')
      assert(s.indexOf('dsh-notes-suggest-sec') >= 0, label + ' 分节样式类')
      assert(s.indexOf('if (suggestOpenRef.current) { setSuggestOpen(false); return }') >= 0, label + ' Esc 链路关建议框')
      assert(s.indexOf('!injectPreviewOpen && !suggestOpen') >= 0, label + ' 全局错误条排除建议 modal（modal 内自显错误）')
    }
    assert(clientSrc.indexOf("host.call('notes-suggest', {})") >= 0, 'openSuggest 走 notes-suggest（dry-run 零写入）')
    assert(clientPkgSrc.indexOf("rpc('notes-suggest', {})") >= 0, '发布包同链路（rpc 形态，需先跑 scripts/build-dist.cjs）')
  })
  await t('client 建议动作：去归档直达归档预览 / 批量软删 confirm + 逐条 notes-delete payload / 孤儿仅展示逐条跳转', () => {
    // ① 速记组「去归档」：关建议框 → openArchive（归档预览对话框，数据同源）
    assert(clientSrc.indexOf('function suggestGoArchive() { setSuggestOpen(false); openArchive() }') >= 0, '「去归档」直达归档预览对话框')
    assert(clientPkgSrc.indexOf('function suggestGoArchive()') >= 0, '发布包同步 suggestGoArchive')
    // ② 过期未引用「一键批量软删除」：confirm 守卫 + 逐条 notes-delete + 删后收尾刷新
    assert(clientSrc.indexOf("window.confirm('一键批量软删除：' + list.length + ' 条") >= 0, '批量软删前 window.confirm 确认')
    assert(clientSrc.indexOf("await host.call('notes-delete', { id: n.id })") >= 0, '逐条 notes-delete payload（软删，回收站可恢复）')
    assert(clientPkgSrc.indexOf("await rpc('notes-delete', { id: n.id })") >= 0, '发布包同批量软删 payload（rpc 形态）')
    assert(clientSrc.indexOf('afterArchiveCleanup(list.map(n => n.id))') >= 0, '删后收尾：正打开笔记退出选中态（归档同款）')
    assert(clientSrc.indexOf('loadSuggest()') >= 0, '删后刷新建议数据（三段联动）')
    // ③ 孤儿仅展示：「查看」逐条跳转（jumpToWikiTarget 同款过滤退回）；无批量操作（启发式判定防误伤）
    assert(clientSrc.indexOf('function suggestViewNote(id) { setSuggestOpen(false); jumpToWikiTarget(id) }') >= 0, '孤儿「查看」逐条跳转')
    const sec3 = clientSrc.match(/'可能无用',[\s\S]*?判定口径/)   // 锚定③段标题行（JSX 形态），避开段头注释与②段批量按钮
    assert(sec3 && sec3[0].indexOf('查看') >= 0 && sec3[0].indexOf('一键批量') < 0 && sec3[0].indexOf('danger') < 0, '孤儿段仅展示（查看按钮，无批量/danger 操作）')
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
  await t('app.html + 原型整理建议同款：设置卡片「整理建议」行入口 + 三段式 modal + 批量软删 confirm + 孤儿仅展示（双端 UI 标记一致 + mock 演示）', () => {
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
      assert(s.indexOf("confirm('一键批量软删除：'") >= 0, label + ' 批量软删 confirm 确认')
      assert(s.indexOf("rpc('notes-delete', { id: n.id })") >= 0, label + ' 逐条 notes-delete payload')
      assert(s.indexOf('sgGoArch') >= 0 && s.indexOf('openArchive()') >= 0, label + ' 「去归档」直达归档预览')
      const sec3 = s.match(/>可能无用<span[\s\S]*?判定口径/)   // 锚定③段标题行（HTML 字符串形态），避开段头注释与②段批量按钮
      assert(sec3 && sec3[0].indexOf('查看') >= 0 && sec3[0].indexOf('一键批量') < 0 && sec3[0].indexOf('danger') < 0, label + ' 孤儿段仅展示（无批量操作）')
      assert(s.indexOf('suggestState = null; histState = null; memEnableState = null; return }') >= 0, label + ' Esc 统一关建议框（连带历史面板 histState / 工作记忆启用框 memEnableState 复位）')
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
