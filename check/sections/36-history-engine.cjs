// 节 36. 快照式历史引擎（host 数据层 + 导入导出适配）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "36",
  title: "36. 快照式历史引擎（host 数据层 + 导入导出适配）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, g, handlers, llmMock, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // ===== 36. 快照式历史引擎（.history 快照 + 稳定内容去重 + 分层保留 + 20版/50MB 上限 + purge 连带 + 导入导出适配）=====
  section('36. 快照式历史引擎（host 数据层 + 导入导出适配）')

  // ---- 36.1 双包结构同步（host-impl.js / index.mjs）----
  await t('历史引擎双包结构同步（函数/常量/persistNote 挂点/purge 连带/导入导出适配/删除通道）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('==== history-engine BEGIN ====') >= 0 && s.indexOf('==== history-engine END ====') >= 0, label + ' history-engine 标记块')
      for (const fn of ['noteFileContent', 'histContentHash', 'histNameTs', 'histNameHash', 'histFileSize', 'histRemoveFile', 'histEnsureScanned', 'histRetainNote', 'histEnforceBudget', 'histSnapshot', 'histPurgeNote', 'copyHistoryDir']) {
        assert(s.indexOf('function ' + fn) >= 0, label + ' 缺函数 ' + fn)
      }
      assert(s.indexOf('HIST_NOTE_CAP = 20') >= 0, label + ' 单笔记 20 版上限常量')
      assert(s.indexOf('HIST_GLOBAL_BUDGET = 50 * 1024 * 1024') >= 0, label + ' 全库 50MB 预算常量')
      assert(s.indexOf('HIST_KEEP_ALL_MS') >= 0 && s.indexOf('HIST_KEEP_DAILY_MS') >= 0, label + ' 分层保留窗口常量')
      assert(s.indexOf('async function persistNote(n, opts)') >= 0 && s.indexOf('opts.history !== false') >= 0, label + ' persistNote 第二参 opts.history 开关')
      assert(s.split('persistNote(n, { history: false })').length - 1 >= 2, label + ' useCount 防抖 + idle 回执两处自动回写免快照（实得 ' + (s.split('persistNote(n, { history: false })').length - 1) + ' 处）')
      assert(s.indexOf('await histSnapshot(n.id, prev)') >= 0, label + ' persistNote 写盘前快照上一版（缓存重建，零新增读盘）')
      assert(s.indexOf('const historyPurged = await histPurgeNote(id)') >= 0, label + ' _purge 连带清 .history')
      assert(s.indexOf('historyMerged += await copyHistoryDir(chk.dir, NOTES_DIR, true, n.id)') >= 0, label + ' _import added 连带历史合并')
      assert(s.indexOf('copyNotesDir(backupDir, { includeHistory: true })') >= 0, label + ' 导入前备份含 .history')
      assert(s.indexOf('async function _export(dir, includeHistory)') >= 0, label + ' _export includeHistory 参数')
      assert(s.indexOf("_export(args && args.dir, !!(args && args.includeHistory))") >= 0, label + ' notes-export RPC 透传 includeHistory')
      assert(s.indexOf('histSizes = null') >= 0, label + ' 导入合并历史后存活清单失效重扫')
    }
    assert(hostSrc.indexOf("const HISTORY_DIR = NOTES_DIR + '\\\\.history'") >= 0, '开发版 HISTORY_DIR 反斜杠拼接')
    assert(indexSrc.indexOf("const HISTORY_DIR = path.join(NOTES_DIR, '.history')") >= 0, '静态包 HISTORY_DIR 走 path.join')
    assert(indexSrc.indexOf('async function histRemoveFile(noteId, name)') >= 0 && indexSrc.indexOf('fsNode.promises.unlink(pp)') >= 0, '静态包 histRemoveFile 有 node:fs 真删通道')
  })

  // ---- 36.2 行为断言（开发版独立实例）----
  // mock 增强：listDir 贴近真实 fs——直子级目录也以 { name, type:'dir' } 出现（.history 是目录，引擎扫描/列表过滤都依赖该形态）
  function mkFsMockHist(store, dirs, io) {
    return {
      resolve: async (p) => p,
      stat: async (p) => {
        if (dirs.indexOf(p) >= 0) return { dir: true }
        if (store.has(p)) return { file: true }
        const prefix = p + '\\'
        for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }
        return null
      },
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        const seenDir = {}
        for (const k of store.keys()) {
          if (!k.startsWith(prefix)) continue
          const rest = k.slice(prefix.length)
          const i = rest.indexOf('\\')
          if (i < 0) out.push({ name: rest })
          else { const d = rest.slice(0, i); if (!seenDir[d]) { seenDir[d] = 1; out.push({ name: d, type: 'dir' }) } }
        }
        return out
      },
      readText: async (p) => { if (io) io.reads++; if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
      writeText: async (p, c) => { store.set(p, c) },
    }
  }
  function mkHistHandlers(store, dirs, io) {
    const handlers = {}
    const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply({
      fs: mkFsMockHist(store, dirs, io), sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return handlers
  }
  // 枚举 .history\<id>\ 直子级快照：live=存活（非空串），tomb=墓碑（空串）；rootDir 默认开发版 NOTES_DIR
  function histFilesOf(store, id, rootDir) {
    const prefix = (rootDir || NOTES_DIR) + '\\.history\\' + id + '\\'
    const live = [], tomb = []
    for (const [k, v] of store) {
      if (k.indexOf(prefix) !== 0) continue
      const name = k.slice(prefix.length)
      if (name.indexOf('\\') >= 0) continue
      if (v === '') tomb.push(name); else live.push(name)
    }
    return { live: live.sort(), tomb: tomb.sort() }
  }
  // 快照文件名形态（与引擎同构）：<ISO 时间戳 ':'→'-'>.<len36>.<hash36>.md；伪造历史用 '.0.0.md' 后缀即合法
  const SNAP_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.[0-9a-z]+\.[0-9a-z]+\.md$/
  function fakeSnapName(ts) { return new Date(ts).toISOString().replace(/:/g, '-') + '.0.0.md' }

  const ioH = { reads: 0 }
  const storeH = new Map()
  const handlersH = mkHistHandlers(storeH, [NOTES_DIR], ioH)
  const hc = await handlersH['notes-create']({ title: '历史甲', body: 'v0 正文', topic: '开发' })
  const hPath = NOTES_DIR + '\\' + hc.id + '.md'
  await t('快照触发：创建无快照，更新把上一版入 .history（时间戳+hash 文件名，内容逐字节 = 被替换版）', async () => {
    assert(!Array.from(storeH.keys()).some(k => k.indexOf('\\.history\\') >= 0), '创建不产生历史快照（无旧版）')
    const v0 = storeH.get(hPath)
    await handlersH['notes-update']({ id: hc.id, body: 'v1 正文' })
    const f1 = histFilesOf(storeH, hc.id)
    assert.strictEqual(f1.live.length, 1, '首次更新产生 1 份快照（实得 ' + f1.live.length + '）')
    assert(SNAP_NAME_RE.test(f1.live[0]), '快照文件名 = <ISO时间戳>.<hash>.md（实得 ' + f1.live[0] + '）')
    assert.strictEqual(storeH.get(NOTES_DIR + '\\.history\\' + hc.id + '\\' + f1.live[0]), v0, '快照内容 = 被替换的上一版逐字节')
  })
  await t('快照去重 + 红线：无变化重复保存不增快照，update 零新增读盘', async () => {
    // 独立笔记自洽（core/全量两种模式断言口径一致）：创建无快照；两次有效落盘 → 2 份；之后无变化重复保存去重跳过
    const cD = await handlersH['notes-create']({ title: '历史去重', body: 'd0 正文', topic: '开发' })
    await handlersH['notes-update']({ id: cD.id, body: 'd1 正文' })   // 快照 d0 版
    await handlersH['notes-update']({ id: cD.id, body: 'd1 正文' })   // 快照 d1 版（prev 稳定内容与最新快照不同 → 产生）
    assert.strictEqual(histFilesOf(storeH, cD.id).live.length, 2, '两次有效落盘 → 2 份快照（实得 ' + histFilesOf(storeH, cD.id).live.length + '）')
    const r0 = ioH.reads
    await handlersH['notes-update']({ id: cD.id, body: 'd1 正文' })   // 稳定内容同最新快照 → 去重跳过
    await handlersH['notes-update']({ id: cD.id, body: 'd1 正文' })   // 同上
    assert.strictEqual(histFilesOf(storeH, cD.id).live.length, 2, '无变化重复保存被去重（快照数不增）')
    assert.strictEqual(ioH.reads, r0, 'update 保存路径零新增 readText（红线；快照内容来自缓存重建，去重靠文件名内嵌 hash）')
    assert(storeH.get(NOTES_DIR + '\\' + cD.id + '.md').indexOf('d1 正文') >= 0, '当前版正常落盘')
  })
  await t('单笔记 20 版硬上限：100 次有效保存后存活快照恒为 20（最旧淘汰为墓碑）', async () => {
    for (let i = 0; i < 100; i++) await handlersH['notes-update']({ id: hc.id, body: 'rev-' + i })
    const f = histFilesOf(storeH, hc.id)
    assert.strictEqual(f.live.length, 20, '存活快照 = 20 版硬上限（实得 ' + f.live.length + '）')
    assert(f.tomb.length >= 80, '超限最旧版本墓碑化（实得墓碑 ' + f.tomb.length + '）')
    assert(f.live[0] > f.tomb[f.tomb.length - 1], '淘汰的是最旧版本（live 全晚于 tomb；文件名时序）')
  })
  await t('主路径零 IO：.history 填充后 list/get/search 零新增读盘，.history 子目录绝不进笔记列表', async () => {
    const r0 = ioH.reads
    const l = await handlersH['notes-list']({})
    const g = await handlersH['notes-get']({ id: hc.id })
    const s = await handlersH['notes-search']({ query: 'rev-99' })
    assert.strictEqual(ioH.reads, r0, 'list/get/search 全缓存命中，零新增 readText（.history 已填充）')
    assert(l.notes.find(n => n.id === hc.id), '真笔记在列表中')
    assert(l.notes.every(n => n.id.indexOf('history') < 0 && !SNAP_NAME_RE.test(n.id)), '.history 目录/快照绝不进笔记列表（实得列表 ' + l.notes.length + ' 条）')
    assert(g.note.body === 'rev-99' && s.notes.length === 1, 'get/search 内容正常')
  })
  await t('purge 连带：彻底删除清空整棵 .history/<id>（存活+残留墓碑全墓碑化）；无编辑历史笔记的删除前快照一并清除', async () => {
    await handlersH['notes-delete']({ id: hc.id })
    const totalBefore = histFilesOf(storeH, hc.id)   // 删除动作本身也快照了删除前一版
    const totalCount = totalBefore.live.length + totalBefore.tomb.length
    const r = await handlersH['notes-purge']({ id: hc.id })
    assert(!r.error && r.purged === true, 'purge 成功（实得 ' + JSON.stringify(r) + '）')
    assert(r.historyPurged === totalCount, 'historyPurged 覆盖存活+残留墓碑（实得 ' + r.historyPurged + '，预期 ' + totalCount + '）')
    const f = histFilesOf(storeH, hc.id)
    assert.strictEqual(f.live.length, 0, 'purge 后无存活快照')
    assert.strictEqual(f.tomb.length, totalCount, '全部快照墓碑化（实得 ' + f.tomb.length + '）')
    // 无编辑历史的笔记：删除动作本身产生「删除前快照」（历史引擎保护语义），purge 一并连带清除
    const c2 = await handlersH['notes-create']({ title: '历史乙', body: '无编辑历史', topic: '开发' })
    await handlersH['notes-delete']({ id: c2.id })
    assert.strictEqual(histFilesOf(storeH, c2.id).live.length, 1, '删除前版本被快照保护（无编辑历史也有 1 份）')
    const r2 = await handlersH['notes-purge']({ id: c2.id })
    assert.strictEqual(r2.historyPurged, 1, 'purge 连带清除删除前快照（实得 ' + JSON.stringify(r2) + '）')
    assert.strictEqual(histFilesOf(storeH, c2.id).live.length, 0, 'purge 后无存活快照')
  })

  // ---- 36.3 分层保留收敛（预注伪造历史文件 → 一次保存触发惰性扫描 + 分层 + 上限收敛）----
  const storeH2 = new Map()
  const handlersH2 = mkHistHandlers(storeH2, [NOTES_DIR], null)
  await t('分层保留收敛：1h 内每版全留 / 当天每小时 1 版 / 7 天内每天 1 版 / 超 7 天淘汰', async () => {
    const c = await handlersH2['notes-create']({ title: '分层笔记', body: 'base', topic: '开发' })
    const hDir = NOTES_DIR + '\\.history\\' + c.id + '\\'
    const now = Date.now()
    const nd = new Date(now)
    const today0 = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate()).getTime()
    const put = (ts) => { storeH2.set(hDir + fakeSnapName(ts), '伪造历史 ' + ts) }
    put(now - 10 * 60000); put(now - 20 * 60000)                                    // 1h 内两版 → 全留
    put(today0 - 24 * 3600000 + 8 * 3600000); put(today0 - 24 * 3600000 + 9 * 3600000)  // 昨天两版 → 留最新 1
    put(today0 - 2 * 24 * 3600000 + 8 * 3600000)                                     // 前天一版 → 留
    put(today0 - 9 * 24 * 3600000 + 8 * 3600000)                                     // 9 天前 → 超 7 天淘汰
    const hNow = nd.getHours()
    if (hNow >= 4) { put(today0 + (hNow - 3) * 3600000); put(today0 + (hNow - 3) * 3600000 + 30 * 60000) }   // 当天 >1h 同小时两版 → 留 1（凌晨 <4 点不存在「当天 3 小时前」，条件跳过）
    await handlersH2['notes-update']({ id: c.id, body: '触发收敛' })
    const f = histFilesOf(storeH2, c.id)
    const expectLive = 3 + 1 + 1 + (hNow >= 4 ? 1 : 0)   // 1h内2版+新快照 / 昨天1 / 前天1 / 当天小时桶1
    const expectTomb = 1 + 1 + (hNow >= 4 ? 1 : 0)       // 昨天重复 1 + 超期 1 + 当天同小时重复 1
    assert.strictEqual(f.live.length, expectLive, '存活数 = ' + expectLive + '（实得 ' + f.live.length + '：' + f.live.join(', ') + '）')
    assert.strictEqual(f.tomb.length, expectTomb, '淘汰数 = ' + expectTomb + '（实得 ' + f.tomb.length + '）')
    assert(f.tomb.indexOf(fakeSnapName(today0 - 9 * 24 * 3600000 + 8 * 3600000)) >= 0, '超 7 天版本被淘汰')
    assert(f.live.indexOf(fakeSnapName(today0 - 24 * 3600000 + 9 * 3600000)) >= 0, '昨天两版留最新一版')
    assert(f.live.indexOf(fakeSnapName(now - 10 * 60000)) >= 0 && f.live.indexOf(fakeSnapName(now - 20 * 60000)) >= 0, '1h 内每版全留')
  })

  // ---- 36.4 全库 50MB 预算 LRU（3 笔记 × 18 版 × ~1MB ≈ 56MB → 触发跨笔记淘汰最旧）----
  const storeH3 = new Map()
  const handlersH3 = mkHistHandlers(storeH3, [NOTES_DIR], null)
  await t('全库 50MB 预算：LRU 跨笔记淘汰最旧快照直到总量回落（单笔记仍 ≤20 版）', async () => {
    const big = 'x'.repeat(1024 * 1024)   // ~1MB/版（ASCII 1 字节/字符）
    const ids = []
    for (let i = 0; i < 3; i++) ids.push((await handlersH3['notes-create']({ title: 'big' + i, body: big + i, topic: '开发' })).id)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 18; j++) await handlersH3['notes-update']({ id: ids[i], body: big + i + '-' + j })
    }
    let liveBytes = 0, tombCount = 0
    const perNote = {}
    for (const [k, v] of storeH3) {
      const m = k.match(/\\\.history\\(n-[^\\]+)\\[^\\]+$/)
      if (!m) continue
      if (v === '') { tombCount++; continue }
      liveBytes += Buffer.byteLength(v, 'utf8')
      perNote[m[1]] = (perNote[m[1]] || 0) + 1
    }
    assert(liveBytes <= 50 * 1024 * 1024, '存活快照总量回落到 50MB 预算内（实得 ' + (liveBytes / 1048576).toFixed(1) + 'MB）')
    assert(tombCount >= 4, 'LRU 淘汰了最旧快照（墓碑 ≥4，实得 ' + tombCount + '）')
    assert.strictEqual(perNote[ids[2]], 18, '最新笔记 18 版全存活（LRU 不动新版本）')
    assert((perNote[ids[0]] || 0) < 18, '最旧笔记的早期版本被优先淘汰（实得存活 ' + (perNote[ids[0]] || 0) + '）')
    for (const id of ids) assert((perNote[id] || 0) <= 20, '单笔记存活 ≤20 版')
  })

  // ---- 36.5 导入导出适配（默认不含 / includeHistory 连带 / 备份含 / added 合并 + id 冲突跳过）----
  const storeH4 = new Map()
  const handlersH4 = mkHistHandlers(storeH4, [NOTES_DIR], null)
  await t('导入导出适配：默认不含 .history / includeHistory 连带 / 备份含 / added 合并 / id 冲突跳过', async () => {
    const A = await handlersH4['notes-create']({ title: '历史导出A', body: 'A0', topic: '开发' })
    await handlersH4['notes-update']({ id: A.id, body: 'A1' })                              // A 有 1 份快照
    await handlersH4['notes-create']({ title: '历史导出B', body: 'B0', topic: '开发' })       // B 无快照
    const snapA = histFilesOf(storeH4, A.id).live
    assert.strictEqual(snapA.length, 1, '前置：A 有 1 份快照')
    const libSnap = NOTES_DIR + '\\.history\\' + A.id + '\\' + snapA[0]
    // 导出默认不含 .history
    const ex1 = await handlersH4['notes-export']({ dir: 'D:\\hist-exp' })
    assert(!ex1.error && ex1.history === undefined, '默认导出返回无 history 字段（实得 ' + JSON.stringify(ex1) + '）')
    assert(!Array.from(storeH4.keys()).some(k => k.indexOf(ex1.target + '\\.history\\') === 0), '默认导出目录不含 .history')
    // includeHistory 连带（逐字节一致）
    const ex2 = await handlersH4['notes-export']({ dir: 'D:\\hist-exp', includeHistory: true })
    assert.strictEqual(ex2.history, 1, 'includeHistory 导出 1 份历史文件（实得 ' + ex2.history + '）')
    assert.strictEqual(storeH4.get(ex2.target + '\\.history\\' + A.id + '\\' + snapA[0]), storeH4.get(libSnap), '导出历史逐字节一致')
    // 导入目录：新笔记 n-hnew01（带 2 份历史）+ A 的同内容文件（same）+ A 的伪造外部历史（id 冲突 → 跳过）
    const imp = 'D:\\hist-imp'
    storeH4.set(imp + '\\n-hnew01.md', '---\nid: n-hnew01\ntitle: 外部新笔记\ntopic: 调研\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"\n---\n\n新正文\n')
    storeH4.set(imp + '\\' + A.id + '.md', storeH4.get(NOTES_DIR + '\\' + A.id + '.md'))
    storeH4.set(imp + '\\.history\\n-hnew01\\' + fakeSnapName(Date.now() - 60000), '外部历史1')
    storeH4.set(imp + '\\.history\\n-hnew01\\' + fakeSnapName(Date.now() - 120000), '外部历史2')
    storeH4.set(imp + '\\.history\\' + A.id + '\\' + fakeSnapName(Date.now() - 30000), 'A的伪造外部历史')
    const im = await handlersH4['notes-import']({ dir: imp })
    assert(!im.error, '导入成功（实得 ' + JSON.stringify(im) + '）')
    assert.strictEqual(im.imported, 1, 'added 1 条入库')
    assert.strictEqual(im.skippedSame, 1, 'A 同内容跳过')
    assert.strictEqual(im.historyMerged, 2, '仅新笔记历史连带合并 2 份（实得 ' + im.historyMerged + '）')
    assert.strictEqual(histFilesOf(storeH4, 'n-hnew01').live.length, 2, '新笔记 2 份历史入库')
    assert.strictEqual(histFilesOf(storeH4, A.id).live.length, 1, 'id 冲突跳过历史合并（A 仍只有自身 1 份）')
    // 导入前备份含 .history（备份的是导入前库内历史：A 的 1 份）
    assert.strictEqual(storeH4.get(im.backupDir + '\\.history\\' + A.id + '\\' + snapA[0]), storeH4.get(libSnap), '导入前备份含库内 .history')
    // 无历史导出（默认导出物）导入：historyMerged=0 零回归
    const im2 = await handlersH4['notes-import']({ dir: ex1.target })
    assert.strictEqual(im2.historyMerged, 0, '默认导出（无 .history）导入 historyMerged=0（实得 ' + im2.historyMerged + '）')
  })

  // ---- 36.6 静态包行为（index.mjs 独立 ESM 实例；mock fs 无 processPath → 墓碑式清空）----
  await t('静态包历史引擎行为：保存触发 + 去重 + purge 连带墓碑 + 导出默认不含/includeHistory 连带', async () => {
    const storeH5 = new Map()
    const handlersH5 = {}
    const harnessMockH5 = { handle: (name, fn) => { handlersH5[name] = fn; return () => { delete handlersH5[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    global.harness = harnessMockH5
    try {
      const modH = await import(pathToFileURL(INDEX_PATH).href + '?hist=1')
      modH.apply({
        fs: mkFsMockHist(storeH5, [NOTES_ROOT_STATIC], null), sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
        effect: () => {},
      })
      const A = await handlersH5['notes-create']({ title: '静态历史A', body: 'SA0' })
      await handlersH5['notes-update']({ id: A.id, body: 'SA1' })
      const f1 = histFilesOf(storeH5, A.id, NOTES_ROOT_STATIC)
      assert.strictEqual(f1.live.length, 1, '静态包更新触发 1 份快照（实得 ' + f1.live.length + '）')
      assert(SNAP_NAME_RE.test(f1.live[0]), '静态包快照文件名同构（实得 ' + f1.live[0] + '）')
      await handlersH5['notes-update']({ id: A.id, body: 'SA1' })   // prev 稳定内容与最新快照相同？→ 不同（prev 是 SA1 版，快照是 SA0 版）→ 产生；再来一次才去重
      await handlersH5['notes-update']({ id: A.id, body: 'SA1' })   // 去重跳过
      assert.strictEqual(histFilesOf(storeH5, A.id, NOTES_ROOT_STATIC).live.length, 2, '静态包无变化重复保存去重（实得 ' + histFilesOf(storeH5, A.id, NOTES_ROOT_STATIC).live.length + '）')
      const ex1 = await handlersH5['notes-export']({ dir: 'D:\\hist-exp-st' })
      assert(!Array.from(storeH5.keys()).some(k => k.indexOf(ex1.target + '\\.history\\') === 0), '静态包默认导出不含 .history')
      const ex2 = await handlersH5['notes-export']({ dir: 'D:\\hist-exp-st', includeHistory: true })
      assert.strictEqual(ex2.history, 2, '静态包 includeHistory 连带 2 份（实得 ' + ex2.history + '）')
      await handlersH5['notes-delete']({ id: A.id })   // 删除前版本与最新快照稳定内容相同 → 去重不增
      const p = await handlersH5['notes-purge']({ id: A.id })
      assert(p.purged === true && p.historyPurged >= 2, '静态包 purge 连带清历史（实得 ' + JSON.stringify(p) + '）')
      assert.strictEqual(histFilesOf(storeH5, A.id, NOTES_ROOT_STATIC).live.length, 0, '静态包 purge 后无存活快照（mock 无 processPath → 墓碑式清空）')
    } finally {
      delete global.harness
    }
  })
  Object.assign(S, { histFilesOf, mkFsMockHist, mkHistHandlers })
  }
}
