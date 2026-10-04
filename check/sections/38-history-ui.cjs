// 节 38. 历史版本面板 UI（notes-history / notes-history-get / notes-restore-history + 四端 UI）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "38",
  title: "38. 历史版本面板 UI（notes-history / notes-history-get / notes-restore-history + 四端 UI）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, agentsMock, appSrc, clientPkgSrc, g, histFilesOf, mkFsMockHist, mkHistHandlers, protoV2Src, r2 } = S
  // ===== 38. 历史版本面板 UI（notes-history-ui：三 RPC + 详情区「历史」入口 + 列表/预览/恢复 modal + 四端同步）=====
  section('38. 历史版本面板 UI（notes-history / notes-history-get / notes-restore-history + 四端 UI）')

  // ---- 38.1 双包结构同步（host-impl.js ⇄ index.mjs）----
  await t('历史引擎双包三 RPC 结构同步（host-impl ⇄ index.mjs，恢复走 persistNote 缺省快照）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("handle('notes-history'") >= 0 && s.indexOf("handle('notes-history-get'") >= 0 && s.indexOf("handle('notes-restore-history'") >= 0, label + ' 三 RPC handler 注册')
      assert(s.indexOf('async function histFindName') >= 0, label + ' histFindName（ts → 存活快照文件名）')
      assert(s.indexOf('async function _historyList') >= 0 && s.indexOf('async function _historyGet') >= 0 && s.indexOf('async function _historyRestore') >= 0, label + ' 三个历史支撑函数')
      assert(s.indexOf('versions.sort((a, b) => b.ts - a.ts)') >= 0, label + ' 版本列表按时间倒序（新→旧）')
      assert(s.indexOf('恢复前置快照') >= 0, label + ' 恢复前置快照安全注释')
      // 安全核心结构断言：_historyRestore 必须经 persistNote 缺省快照语义写回（禁 { history:false }——恢复前当前版入 .history，恢复本身可撤销）
      const m = s.match(/async function _historyRestore[\s\S]*?\n    \}/)
      assert(m, label + ' _historyRestore 函数体可提取')
      assert(m[0].indexOf('await persistNote(note)') >= 0 && m[0].indexOf('history: false') < 0, label + ' 恢复经 persistNote 缺省快照（恢复前置自动快照；禁 history:false 旁路）')
      assert(m[0].indexOf("throw new Error('Note has been deleted')") >= 0, label + ' 已删除/墓碑笔记拒绝恢复')
    }
    assert(hostSrc.indexOf("HISTORY_DIR + '\\\\' + id + '\\\\' + name") >= 0, '开发版历史快照读取走反斜杠拼接')
    assert(indexSrc.indexOf('path.join(HISTORY_DIR, id, name)') >= 0, '静态包历史快照读取走 path.join')
  })

  // ---- 38.2 三 RPC 契约行为 + 恢复前置快照（开发版独立实例；复用 section 36 mkHistHandlers/histFilesOf）----
  const storeHU = new Map()
  const handlersHU = mkHistHandlers(storeHU, [NOTES_DIR], null)
  await t('历史版本三 RPC 契约：列表倒序零正文 / get 取正文 / 未知 ts 报错（开发版独立实例）', async () => {
    const c = await handlersHU['notes-create']({ title: '历史UI', body: 'U0 正文', topic: '开发' })
    await handlersHU['notes-update']({ id: c.id, body: 'U1 正文' })   // 快照 U0
    await handlersHU['notes-update']({ id: c.id, body: 'U2 正文' })   // 快照 U1
    const h = await handlersHU['notes-history']({ id: c.id })
    assert(!h.error && Array.isArray(h.versions), 'notes-history 返回 versions 数组（实得 ' + JSON.stringify(h).slice(0, 80) + '）')
    assert.strictEqual(h.versions.length, 2, '两次有效保存 → 2 个版本（实得 ' + h.versions.length + '）')
    assert(h.versions[0].ts > h.versions[1].ts, '按时间倒序（新→旧）')
    assert(typeof h.versions[0].ts === 'number' && typeof h.versions[0].bytes === 'number', '版本条目 {ts, bytes} 数值形态')
    assert(h.versions.every(v => v.body === undefined), '列表零正文明文（列表轻量，正文走 notes-history-get 按需）')
    // get 取正文：最旧版 = U0 正文 / 最新快照 = U1 正文（快照字节 = 完整笔记文件，返回 parseFM 解析的 body）
    const g0 = await handlersHU['notes-history-get']({ id: c.id, ts: h.versions[1].ts })
    assert(!g0.error && g0.body === 'U0 正文', 'notes-history-get 取最旧版正文（实得 ' + JSON.stringify(g0).slice(0, 60) + '）')
    const g1 = await handlersHU['notes-history-get']({ id: c.id, ts: h.versions[0].ts })
    assert(g1.body === 'U1 正文', 'notes-history-get 取最新快照正文')
    const bad = await handlersHU['notes-history-get']({ id: c.id, ts: 123 })
    assert(bad.error && bad.error.indexOf('历史版本不存在') >= 0, '未知 ts 报错（实得 ' + JSON.stringify(bad) + '）')
    assert((await handlersHU['notes-history']({})).error, '缺 id 报错')
  })
  await t('恢复前置快照（安全核心）：恢复前当前版自动入 .history + 恢复可再撤销回滚', async () => {
    const c = await handlersHU['notes-create']({ title: '恢复安全', body: 'R0 正文', topic: '开发' })
    await handlersHU['notes-update']({ id: c.id, body: 'R1 正文' })   // 快照 R0
    const h1 = await handlersHU['notes-history']({ id: c.id })
    assert.strictEqual(h1.versions.length, 1, '前置：1 个历史版本（实得 ' + h1.versions.length + '）')
    // 恢复到 R0：正文写回历史版 + 当前版 R1 自动快照（恢复动作本身可撤销的安全网）
    const r = await handlersHU['notes-restore-history']({ id: c.id, ts: h1.versions[0].ts })
    assert(!r.error && r.restored === true, '恢复成功（实得 ' + JSON.stringify(r) + '）')
    const cur = await handlersHU['notes-get']({ id: c.id })
    assert.strictEqual(cur.note.body, 'R0 正文', '正文写回历史版（实得 ' + JSON.stringify(cur.note.body) + '）')
    const h2 = await handlersHU['notes-history']({ id: c.id })
    assert.strictEqual(h2.versions.length, 2, '恢复前置快照使版本数 +1（实得 ' + h2.versions.length + '）')
    const gNew = await handlersHU['notes-history-get']({ id: c.id, ts: h2.versions[0].ts })
    assert.strictEqual(gNew.body, 'R1 正文', '最新快照 = 恢复前的当前版（恢复可撤销的安全网；实得 ' + JSON.stringify(gNew.body) + '）')
    // 回滚闭环：再恢复「恢复前快照」→ 正文回到 R1（恢复本身可撤销的实证）
    const r2 = await handlersHU['notes-restore-history']({ id: c.id, ts: h2.versions[0].ts })
    assert(!r2.error, '二次恢复成功')
    const cur2 = await handlersHU['notes-get']({ id: c.id })
    assert.strictEqual(cur2.note.body, 'R1 正文', '恢复可再撤销：二次恢复回滚到恢复前版本')
    // 边界：未知 ts 拒绝恢复；已软删除笔记拒绝恢复
    const bad = await handlersHU['notes-restore-history']({ id: c.id, ts: 123 })
    assert(bad.error && bad.error.indexOf('历史版本不存在') >= 0, '未知 ts 拒绝恢复')
    await handlersHU['notes-delete']({ id: c.id })
    const h3 = await handlersHU['notes-history']({ id: c.id })
    const del = await handlersHU['notes-restore-history']({ id: c.id, ts: h3.versions[0].ts })
    assert(del.error, '已删除笔记拒绝恢复（实得 ' + JSON.stringify(del) + '）')
  })

  // ---- 38.3 client 面板结构（client-impl.js）：meta 行入口（有版本才显示）+ modal + Esc/错误互斥 + 恢复不再触发自动保存 ----
  await t('历史面板 client 结构：meta 行「历史」入口 + 列表/预览/恢复 modal + Esc/互斥接入 + 恢复零自动保存', () => {
    assert(clientSrc.indexOf("host.call('notes-history', { id: id })") >= 0, 'notes-history 探测/列表调用点')
    assert(clientSrc.indexOf("host.call('notes-history-get', { id: selectedRef.current, ts: ts })") >= 0, 'notes-history-get 预览调用点')
    assert(clientSrc.indexOf("host.call('notes-restore-history', { id: id, ts: ts0 })") >= 0, 'notes-restore-history 恢复调用点')
    assert(clientSrc.indexOf('(histCount || 0) > 0') >= 0 && clientSrc.indexOf("I('clock', 12), '历史'") >= 0, 'meta 行「历史」入口（有版本才显示，clock 图标）')
    assert(clientSrc.indexOf('probeHistCount') >= 0 && clientSrc.indexOf('histCountRef.current = null; setHistCount(null)') >= 0, '选中笔记切换时重置并探测版本计数')
    assert(clientSrc.indexOf('dsh-notes-hist-modal') >= 0 && clientSrc.indexOf('dsh-notes-hist-list') >= 0 && clientSrc.indexOf('dsh-notes-hist-item') >= 0, '历史 modal 结构类（列表）')
    assert(clientSrc.indexOf("'dsh-notes-hist-preview dsh-notes-rich'") >= 0 && clientSrc.indexOf('renderMarkdown(histPreview.body, wikiResolve)') >= 0, '预览只读渲染走 renderMarkdown 内核（全量转义零注入面）')
    assert(clientSrc.indexOf('fmtHistTs') >= 0 && clientSrc.indexOf('fmtBytes(v.bytes)') >= 0, '版本列表时间+大小展示')
    assert(clientSrc.indexOf('恢复此版本') >= 0 && clientSrc.indexOf('当前版本会先自动快照进历史版本，可再撤销') >= 0, '恢复按钮 + confirm 前置快照提示文案')
    assert(clientSrc.indexOf('histOpenRef.current) { setHistOpen(false)') >= 0, 'Esc 优先关历史面板')
    assert(clientSrc.indexOf('!suggestOpen && !histOpen') >= 0, '错误条与历史 modal 互斥')
    // 恢复回填不再触发自动保存（恢复版已由 host 落盘；再保存会把恢复版又快照一遍污染历史）
    const m = clientSrc.match(/function applyRestoredBody[\s\S]*?\n        \}/)
    assert(m, 'applyRestoredBody 函数体可提取')
    assert(m[0].indexOf('triggerAutoSave') < 0, '恢复回填不调 triggerAutoSave（恢复不是新编辑，不产生新快照）')
    assert(m[0].indexOf('setEdBody(text)') >= 0, '恢复回填刷新编辑器正文')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-hist-modal{width:640px}') >= 0 && css.indexOf('.dsh-notes-hist-item.on{') >= 0 && css.indexOf('.dsh-notes-hist-preview{') >= 0, 'styles.css 历史 modal 样式')
  })

  // ---- 38.4 四端同步（client-impl / 发布包 lib/client.js / app.html / 原型 notes-ui-v2.html）----
  await t('历史版本面板四端同步：入口/modal/三 RPC 调用点（client-impl + 发布包 + app.html + 原型）', () => {
    // 发布包 lib/client.js 由 build-dist 机械转换（host 调用桥 → rpc 形态）
    for (const k of ['notes-history', 'notes-history-get', 'notes-restore-history', 'dsh-notes-hist-modal', '恢复此版本', 'probeHistCount', 'fmtHistTs', '当前版本会先自动快照']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺 ' + k + '（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf("rpc('notes-history', { id: id })") >= 0 && clientPkgSrc.indexOf("rpc('notes-restore-history', { id: id, ts: ts0 })") >= 0, '发布包历史三 RPC 调用点为 rpc 形态（build-dist 转换后）')
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("rpc('notes-history', { id: id })") >= 0, label + ' notes-history 探测调用点')
      assert(s.indexOf("rpc('notes-history-get', { id: selId, ts: ts })") >= 0, label + ' notes-history-get 预览调用点')
      assert(s.indexOf("rpc('notes-restore-history', { id: selId, ts: ts })") >= 0, label + ' notes-restore-history 恢复调用点')
      assert(s.indexOf('id="mHist"') >= 0 && s.indexOf('function openHistory()') >= 0, label + ' meta 行「历史」入口 + openHistory')
      assert(s.indexOf('(histCount || 0) > 0') >= 0, label + ' 入口有版本才显示（histCount 探测门控）')
      assert(s.indexOf('class="hist-body"') >= 0 && s.indexOf('id="histList"') >= 0 && s.indexOf('id="histView"') >= 0 && s.indexOf('id="histRestore"') >= 0, label + ' 历史 modal 结构（列表/预览/恢复按钮）')
      assert(s.indexOf('恢复此版本') >= 0 && s.indexOf('当前版本会先自动快照进历史版本，可再撤销') >= 0, label + ' 恢复按钮 + confirm 前置快照提示文案')
      assert(s.indexOf('.modal.hist{') >= 0 && s.indexOf('.hist-item.on{') >= 0 && s.indexOf('.hist-preview{') >= 0, label + ' 历史 modal 样式')
      assert(s.indexOf('histState = null') >= 0, label + ' Esc 关闭历史面板（histState 复位）')
    }
    assert(protoV2Src.indexOf("if (method === 'notes-history')") >= 0 && protoV2Src.indexOf("if (method === 'notes-history-get')") >= 0 && protoV2Src.indexOf("if (method === 'notes-restore-history')") >= 0, '原型 mock 含历史三 RPC 分支')
    assert(protoV2Src.indexOf('_mockHistory') >= 0 && protoV2Src.indexOf('function _mockSnap') >= 0, '原型 mock 历史快照存储/快照函数（恢复前置快照语义示意）')
  })

  // ---- 38.5 静态包行为（index.mjs 独立 ESM 实例）----
  await t('静态包历史三 RPC 行为：列表零正文 / get 取正文 / 恢复 + 恢复前置快照', async () => {
    const storeHU2 = new Map()
    const handlersHU2 = {}
    const harnessMockHU2 = { handle: (name, fn) => { handlersHU2[name] = fn; return () => { delete handlersHU2[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    const harnessBackup38 = global.harness
    global.harness = harnessMockHU2
    try {
      const modHU = await import(pathToFileURL(INDEX_PATH).href + '?hist-ui=1')
      modHU.apply({
        fs: mkFsMockHist(storeHU2, [NOTES_ROOT_STATIC], null), sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
        effect: () => {},
      })
      const c = await handlersHU2['notes-create']({ title: '静态历史UI', body: 'SU0' })
      await handlersHU2['notes-update']({ id: c.id, body: 'SU1' })   // 快照 SU0
      const h = await handlersHU2['notes-history']({ id: c.id })
      assert(!h.error && h.versions.length === 1 && h.versions[0].body === undefined, '静态包列表 1 版且零正文（实得 ' + JSON.stringify(h).slice(0, 80) + '）')
      const g = await handlersHU2['notes-history-get']({ id: c.id, ts: h.versions[0].ts })
      assert(!g.error && g.body === 'SU0', '静态包 get 取历史版正文（实得 ' + JSON.stringify(g).slice(0, 60) + '）')
      const r = await handlersHU2['notes-restore-history']({ id: c.id, ts: h.versions[0].ts })
      assert(!r.error && r.restored === true, '静态包恢复成功')
      const cur = await handlersHU2['notes-get']({ id: c.id })
      assert.strictEqual(cur.note.body, 'SU0', '静态包正文写回历史版')
      const h2 = await handlersHU2['notes-history']({ id: c.id })
      assert.strictEqual(h2.versions.length, 2, '静态包恢复前置快照版本数 +1（实得 ' + h2.versions.length + '）')
    } finally {
      if (harnessBackup38 === undefined) delete global.harness; else global.harness = harnessBackup38
    }
  })
  }
}
