// 节 28. P1 回收站（trash 列表 + 恢复/彻底删除 + notes-purge）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "28",
  title: "28. P1 回收站（trash 列表 + 恢复/彻底删除 + notes-purge）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, ctx, g, llmMock, plugin, protoV2Src, r2, rpc2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store2, workspaceRegistryMock } = S
  // ===== 28. P1 回收站（notes-list includeDeleted + notes-purge + 恢复/彻底删除 UI）=====
  // 契约：notes-list 参数化 includeDeleted（缺省排除软删除，true 时含 deleted 且 slim 携带 deleted 标记）；
  // notes-purge {id} 仅限已软删除笔记（安全闸），删除 n-<id>.md 与归档备份 n-<id>.md.bak——
  // 静态包 node:fs 真删（fs.processPath 通道），开发版落回墓碑式清空（0 字节占位，readNoteFile 标 tombstoned，全链路视作不存在）。
  section('28. P1 回收站（trash 列表 + 恢复/彻底删除 + notes-purge）')
  // ---- 28.1 host 双侧结构契约（host-impl / index.mjs 双包同步）----
  await t('host 双侧：notes-purge RPC + notes-list includeDeleted 参数化 + 墓碑跳过 + slim deleted 标记', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf("handle('notes-purge'") >= 0, pair[0] + ' notes-purge RPC 注册')
      assert(s.indexOf('args.includeDeleted') >= 0, pair[0] + ' notes-list 透传 includeDeleted')
      assert(s.indexOf('async function _list(tag, kind, folder, includeDeleted, includeLogs)') >= 0, pair[0] + ' _list 第 4 参数 includeDeleted / 第 5 参数 includeLogs（工作记忆 v0）')
      assert(s.indexOf('if (note.deleted && !includeDeleted) continue') >= 0, pair[0] + ' includeDeleted 放行软删除')
      assert(s.indexOf('if (note.tombstoned) continue') >= 0, pair[0] + ' _list 跳过 purge 墓碑')
      assert(s.indexOf('note.tombstoned = !c') >= 0, pair[0] + ' readNoteFile 墓碑标记（0 字节占位）')
      assert(s.indexOf('async function _purge(id)') >= 0 && s.indexOf('purgeNoteFile') >= 0, pair[0] + ' _purge/purgeNoteFile 存在')
      assert(s.indexOf('彻底删除请先移入回收站') >= 0, pair[0] + ' 未软删除拒绝 purge（安全闸）')
      assert(s.indexOf("id + '.md.bak'") >= 0, pair[0] + ' .bak 归档备份一并清除')
      assert(s.indexOf('deleted: n.deleted === true') >= 0, pair[0] + ' slim 携带 deleted 标记')
      assert(s.indexOf('if (!content) continue   // purge 墓碑') >= 0, pair[0] + ' scanImportDir 跳过墓碑（防导出→导入复活）')
    }
    assert(indexSrc.indexOf('node:fs 真删除') >= 0 && indexSrc.indexOf('fsNode.promises.unlink(pp)') >= 0, 'index.mjs purge 有 node:fs 真删除通道')
    assert(hostSrc.indexOf('fsNode') < 0, '开发版不 import node:fs（ctx.fs 无删除契约，仅墓碑式清空）')
  })
  // ---- 28.2 host 行为级（开发版独立实例 storeT/handlersT，与 8.5/27.2 同款隔离模式）----
  const storeT = new Map()
  const fsMockT = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeT.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeT.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeT.has(p)) throw new Error('ENOENT: ' + p); return storeT.get(p) },
    writeText: async (p, c) => { storeT.set(p, c) },
  }
  const handlersT = {}
  const harnessMockT = { handle: (name, fn) => { handlersT[name] = fn; return () => { delete handlersT[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockT, DIR).apply({
    fs: fsMockT, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('notes-list includeDeleted：缺省排除 deleted；includeDeleted:true 含 deleted 且 slim 携带标记', async () => {
    const c1 = await handlersT['notes-create']({ title: '回收站甲', body: 'a', topic: '回收' })
    const c2 = await handlersT['notes-create']({ title: '回收站乙', body: 'b', topic: '回收' })
    await handlersT['notes-delete']({ id: c2.id })
    const l0 = await handlersT['notes-list']({})
    assert(!l0.notes.find(n => n.id === c2.id) && l0.notes.find(n => n.id === c1.id), '缺省列表排除软删除')
    const l1 = await handlersT['notes-list']({ includeDeleted: true })
    const d = l1.notes.find(n => n.id === c2.id)
    assert(d && d.deleted === true, 'includeDeleted 含软删除且 slim 携带 deleted:true')
    const a1 = l1.notes.find(n => n.id === c1.id)
    assert(a1 && a1.deleted === false, '未删笔记 deleted:false')
  })
  await t('notes-purge 安全闸：未软删除的笔记拒绝彻底删除 + 缺 id 报错', async () => {
    const c = await handlersT['notes-create']({ title: '回收站丙', body: 'c', topic: '回收' })
    const r = await handlersT['notes-purge']({ id: c.id })
    assert(r && r.error && r.error.indexOf('彻底删除请先移入回收站') >= 0, '未删笔记拒绝 purge（实得 ' + JSON.stringify(r) + '）')
    assert((await handlersT['notes-list']({})).notes.find(n => n.id === c.id), '笔记仍在列表（未被误删）')
    const e0 = await handlersT['notes-purge']({})
    assert(e0 && e0.error && e0.error.indexOf('需要 id') >= 0, '缺 id 报错')
  })
  await t('notes-purge 彻底删除：.md 与 .bak 墓碑化 + 回收站列表消失 + 缓存失效 + 不可恢复', async () => {
    const c = await handlersT['notes-create']({ title: '回收站丁', body: 'd', topic: '回收' })
    // 造 .bak（归档备份形态）
    await fsMockT.writeText(NOTES_DIR + '\\' + c.id + '.md.bak', storeT.get(NOTES_DIR + '\\' + c.id + '.md'))
    await handlersT['notes-delete']({ id: c.id })
    const r = await handlersT['notes-purge']({ id: c.id })
    assert(!r.error && r.purged === true, 'purge 成功（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.mode, 'tombstoned', '开发版删除语义 = 墓碑式清空（ctx.fs 无删除契约）')
    assert.strictEqual(storeT.get(NOTES_DIR + '\\' + c.id + '.md'), '', '.md 已清空为 0 字节墓碑')
    assert.strictEqual(storeT.get(NOTES_DIR + '\\' + c.id + '.md.bak'), '', '.bak 归档备份一并清空')
    const l1 = await handlersT['notes-list']({ includeDeleted: true })
    assert(!l1.notes.find(n => n.id === c.id), '回收站列表（includeDeleted）也不再出现（墓碑跳过）')
    const g = await handlersT['notes-get']({ id: c.id })
    assert(g && g.error, 'notes-get 墓碑报错（缓存已失效）')
    const rs = await handlersT['notes-restore']({ id: c.id })
    assert(rs && rs.error && rs.error.indexOf('不可恢复') >= 0, '墓碑不可恢复（实得 ' + JSON.stringify(rs) + '）')
    const r2 = await handlersT['notes-purge']({ id: c.id })
    assert(r2 && r2.error && r2.error.indexOf('不可恢复') >= 0, '二次 purge 报错（幂等防重）')
  })
  await t('恢复往返：回收站恢复后回到正常列表（notes-restore）', async () => {
    const c = await handlersT['notes-create']({ title: '回收站戊', body: 'e', topic: '回收' })
    await handlersT['notes-delete']({ id: c.id })
    let l = await handlersT['notes-list']({ includeDeleted: true })
    assert(l.notes.find(n => n.id === c.id && n.deleted === true), '删除后回收站可见')
    await handlersT['notes-restore']({ id: c.id })
    l = await handlersT['notes-list']({})
    assert(l.notes.find(n => n.id === c.id), '恢复后回到正常列表')
    l = await handlersT['notes-list']({ includeDeleted: true })
    assert(l.notes.find(n => n.id === c.id && n.deleted === false), '恢复后 deleted:false')
  })
  // ---- 28.3 静态包行为级（rpc2 路由链路 + store2 内存 mock；无 processPath → 落回墓碑式清空）----
  await t('静态包：notes-list includeDeleted + notes-purge + 不可恢复（RPC 路由链路）', async () => {
    const c = await rpc2('notes-create', { title: '静态包回收站', body: 'x', topic: '回收' })
    const id = c.body.id
    await rpc2('notes-delete', { id: id })
    const l1 = await rpc2('notes-list', { includeDeleted: true })
    const d = l1.body.notes.find(n => n.id === id)
    assert(d && d.deleted === true, '静态包 includeDeleted 含软删除 + slim deleted 标记')
    const p0 = await rpc2('notes-purge', {})
    assert(p0.body && p0.body.error && p0.body.error.indexOf('需要 id') >= 0, '缺 id 报错')
    const p1 = await rpc2('notes-purge', { id: id })
    assert(p1.body && p1.body.purged === true, '静态包 purge 成功（实得 ' + JSON.stringify(p1.body) + '）')
    assert.strictEqual(p1.body.mode, 'tombstoned', 'mock fs 无 processPath → 落回墓碑式清空')
    assert.strictEqual(store2.get(path.join(NOTES_ROOT_STATIC, id + '.md')), '', '静态包 .md 已清空为 0 字节墓碑')
    const l2 = await rpc2('notes-list', { includeDeleted: true })
    assert(!l2.body.notes.find(n => n.id === id), 'purge 后回收站也不再出现')
    const rs = await rpc2('notes-restore', { id: id })
    assert(rs.body && rs.body.error && rs.body.error.indexOf('不可恢复') >= 0, 'purge 后不可恢复')
  })
  // ---- 28.4 client 结构断言（开发版 client-impl + 发布包 lib/client.js 同步）----
  await t('回收站 UI（client-impl + 发布包 lib/client.js）：侧栏入口 + modal + 恢复/彻底删除 + Esc + toast', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("onClick: openTrash") >= 0 && s.indexOf("I('trash', 12), t('topbar.trash')") >= 0, label + ' 侧栏底部回收站入口（fbtn + trash 图标；i18n 覆盖卡A 起文案走 t() 字典）')
      assert(s.indexOf('function openTrash()') >= 0 && s.indexOf('function loadTrash()') >= 0, label + ' openTrash/loadTrash 存在')
      assert(s.indexOf("'notes-list', { includeDeleted: true }") >= 0, label + ' 回收站列表走 notes-list includeDeleted')
      assert(s.indexOf('.filter(n => n.deleted === true)') >= 0, label + ' 客户端过滤 deleted:true')
      assert(s.indexOf("'notes-purge', { id: id }") >= 0, label + ' 彻底删除走 notes-purge')
      assert(s.indexOf('彻底删除不可恢复') >= 0, label + ' confirm 双确认文案「彻底删除不可恢复」')
      assert(s.indexOf("showToast(t('meta.restored'))") >= 0 && s.indexOf("showToast(t('trash.purged'))") >= 0, label + ' toast 走 t() meta.restored/trash.purged（i18n 覆盖卡E）')
      assert(s.indexOf('dsh-notes-trash-act') >= 0, label + ' 行内操作按钮样式类')
    }
    assert(clientSrc.indexOf('if (trashOpenRef.current) { setTrashOpen(false); return }') >= 0, 'Esc 链路关回收站对话框')
    assert(clientSrc.indexOf('!pruneOpen && !trashOpen') >= 0, '全局错误条排除回收站 modal（modal 内自显错误）')
    assert(clientSrc.indexOf('回收站为空') >= 0, '空态文案')
  })
  // ---- 28.5 样式同步（styles.css + 发布包 lib/styles.css）----
  await t('回收站样式（styles.css + 发布包 lib/styles.css 同步）', () => {
    const cssDev2 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev2], ['发布包 lib/styles.css', cssPkg2]]) {
      assert(pair[1].indexOf('.dsh-notes-trash-act{') >= 0 && pair[1].indexOf('.dsh-notes-trash-act.danger') >= 0, pair[0] + ' 缺回收站行按钮样式（需跑 scripts/build-dist.cjs）')
    }
  })
  // ---- 28.6 app.html / 原型 notes-ui-v2.html 同步（UI 唯一规格来源约束）----
  await t('app.html 回收站同款：btnTrash 入口 + openTrash + notes-purge + confirm 双确认 + toast', () => {
    assert(appSrc.indexOf('id="btnTrash"') >= 0, 'app.html 侧栏底部回收站入口')
    assert(appSrc.indexOf("$('btnTrash').addEventListener('click', openTrash)") >= 0, 'app.html 入口接线')
    // 底部收敛：恰 3 个 fbtn（回收站 + 选择 + 设置，「选择」自旧 chips 行迁入——筛选中心口径⑥），无 导出/导入/整理；回收站在设置卡片「数据」区有兜底入口
    const footA = appSrc.match(/<div class="side-foot">([\s\S]*?)<\/div>\s*<\/aside>/)
    assert(footA && (footA[1].match(/class="fbtn"/g) || []).length === 3, 'app.html 底部按钮恰为 3 个')
    assert(footA[1].indexOf('btnTrash') >= 0 && footA[1].indexOf('btnSelMode') >= 0 && footA[1].indexOf('btnSettings') >= 0, 'app.html 底部 = 回收站 + 选择 + 设置')
    assert(appSrc.indexOf('id="setTrash"') >= 0 && appSrc.indexOf("$('setTrash').onclick = function () { openTrash() }") >= 0, 'app.html 设置卡片「数据」区回收站兜底入口（openTrash）')
    assert(appSrc.indexOf('function openTrash()') >= 0 && appSrc.indexOf("rpc('notes-list', { includeDeleted: true })") >= 0, 'app.html openTrash + includeDeleted')
    assert(appSrc.indexOf("rpc('notes-purge', { id: id })") >= 0 && appSrc.indexOf("rpc('notes-restore', { id: id })") >= 0, 'app.html purge/restore RPC')
    assert(appSrc.indexOf('彻底删除不可恢复') >= 0, 'app.html confirm 双确认文案')
    assert(appSrc.indexOf("toast(t('meta.restored'))") >= 0 && appSrc.indexOf("toast(t('trash.purged'))") >= 0, 'app.html toast 走 t() meta.restored/trash.purged（i18n 覆盖卡E）')
    assert(appSrc.indexOf('回收站为空') >= 0, 'app.html 空态文案')
  })
  await t('原型 notes-ui-v2.html 回收站硬性同步：UI 标记 + mock includeDeleted/purge + 演示数据', () => {
    assert(protoV2Src.indexOf('id="btnTrash"') >= 0 && protoV2Src.indexOf('function openTrash()') >= 0, 'v2 回收站入口 + 函数')
    // 底部收敛同款：恰 3 个 fbtn（回收站 + 选择 + 设置）+ 设置卡片「数据」区兜底
    const footP = protoV2Src.match(/<div class="side-foot">([\s\S]*?)<\/div>\s*<\/aside>/)
    assert(footP && (footP[1].match(/class="fbtn"/g) || []).length === 3, 'v2 底部按钮恰为 3 个')
    assert(footP[1].indexOf('btnTrash') >= 0 && footP[1].indexOf('btnSelMode') >= 0 && footP[1].indexOf('btnSettings') >= 0, 'v2 底部 = 回收站 + 选择 + 设置')
    assert(protoV2Src.indexOf('id="setTrash"') >= 0 && protoV2Src.indexOf("$('setTrash').onclick = function () { openTrash() }") >= 0, 'v2 设置卡片「数据」区回收站兜底入口')
    assert(protoV2Src.indexOf('includeDeleted') >= 0, 'v2 mock notes-list includeDeleted')
    assert(protoV2Src.indexOf("method === 'notes-purge'") >= 0, 'v2 mock notes-purge')
    assert(protoV2Src.indexOf('彻底删除不可恢复') >= 0, 'v2 confirm 双确认文案')
    assert(protoV2Src.indexOf('已删演示') >= 0, 'v2 mock 含软删除演示笔记（回收站非空演示）')
    // v2 与 app.html 回收站 UI 标记双端一致（共享 DOM id / 函数名 / 样式类）
    for (const k of ['btnTrash', 'setTrash', 'openTrash', 'loadTrash', 'renderTrashList', 'doTrashRestore', 'doTrashPurge', 'trashList', 'trash-act', 'trashState',
                     'toggleTrashSel', 'toggleTrashAll', 'toggleTrashPreview', 'doTrashRestoreBatch', 'doTrashPurgeBatch', 'trashAll', 'trashRestoreBatch', 'trashPurgeBatch', 'trash-batch', 'trash-check', 'trash-preview']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '回收站 UI 标记双端一致：' + k)
    }
  })

  // ---- 28.7 回收站增强（notes-trash-batch-preview）：批量选择/全选 + 批量恢复/批量彻底删除 + 行内容只读预览 ----
  await t('notes-get includeDeleted：已删笔记正文只读可达（双包同步 + 行为级，缺省/墓碑仍拒绝）', async () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf('async function _getDeleted(id)') >= 0, pair[0] + ' _getDeleted 存在（回收站预览专用：放行已删、墓碑仍拒绝）')
      assert(s.indexOf('args && args.includeDeleted ? await _getDeleted(args.id) : await _get(args.id)') >= 0, pair[0] + ' notes-get 透传 includeDeleted（缺省走 _get，编辑器链路口径不变）')
    }
    // 行为级（开发版独立实例 handlersT）：已删笔记缺省拒绝、includeDeleted 可达且带正文+deleted 标记；墓碑 includeDeleted 仍拒绝
    const pv = await handlersT['notes-create']({ title: '回收站预览甲', body: 'trash-preview-body-1', topic: '回收' })
    await handlersT['notes-delete']({ id: pv.id })
    const g0 = await handlersT['notes-get']({ id: pv.id })
    assert(g0 && g0.error && !g0.note, '缺省 notes-get 对已删笔记仍拒绝（编辑器链路口径不变）')
    const g1 = await handlersT['notes-get']({ id: pv.id, includeDeleted: true })
    assert(g1 && g1.note && g1.note.body === 'trash-preview-body-1' && g1.note.deleted === true, 'includeDeleted 已删正文可达（实得 ' + JSON.stringify(g1 && (g1.error || g1.note && g1.note.deleted)) + '）')
    await handlersT['notes-purge']({ id: pv.id })
    const g2 = await handlersT['notes-get']({ id: pv.id, includeDeleted: true })
    assert(g2 && g2.error && !g2.note, '墓碑（已彻底删除）includeDeleted 仍拒绝')
    // 静态包同款（rpc2 路由链路）
    const pv2 = await rpc2('notes-create', { title: '静态包回收站预览', body: 'trash-preview-body-2', topic: '回收' })
    await rpc2('notes-delete', { id: pv2.body.id })
    const sg0 = await rpc2('notes-get', { id: pv2.body.id })
    assert(sg0.body && sg0.body.error && !sg0.body.note, '静态包缺省 notes-get 对已删笔记仍拒绝')
    const sg1 = await rpc2('notes-get', { id: pv2.body.id, includeDeleted: true })
    assert(sg1.body && sg1.body.note && sg1.body.note.body === 'trash-preview-body-2' && sg1.body.note.deleted === true, '静态包 includeDeleted 已删正文可达')
  })
  await t('回收站批量操作四端同步：全选/行勾选/选中计数 + 批量恢复/批量彻底删除（confirm 含 不可恢复+含历史版本+条数）', () => {
    // React 两端：开发版面板 + 发布包 lib/client.js（build-dist 机械转换产物）
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function toggleTrashSel(id)') >= 0 && s.indexOf('function toggleTrashAll()') >= 0, label + ' 行勾选/全选函数存在')
      assert(s.indexOf('async function doTrashRestoreBatch()') >= 0 && s.indexOf('async function doTrashPurgeBatch()') >= 0, label + ' 批量恢复/批量彻底删除函数存在')
      /* i18n 覆盖卡E：批量 confirm/toast 文案走 t() 字典插值（trash.restoreBatchConfirm/purgeBatchConfirm + common.restoredBatch/trash.purgedBatch + inj.batchDoneFail），zh 原串随字典内嵌 */
      assert(s.indexOf("window.confirm(t('trash.restoreBatchConfirm', { n: ids.length }))") >= 0, label + ' 批量恢复 confirm 走 t()（覆盖卡E）')
      assert(s.indexOf("window.confirm(t('trash.purgeBatchConfirm', { n: ids.length }))") >= 0, label + ' 批量彻底删除 confirm 走 t()（覆盖卡E）')
      assert(s.indexOf("showToast(t('common.restoredBatch', { ok: ok })") >= 0 && s.indexOf("showToast(t('trash.purgedBatch', { ok: ok })") >= 0, label + ' 批量 toast 计数文案走 t()（覆盖卡E）')
      assert(s.indexOf("'trash.restoreBatchConfirm': '批量恢复：所选的 {n} 条笔记将移出回收站") >= 0 && s.indexOf("'trash.purgeBatchConfirm': '批量彻底删除：所选的 {n} 条笔记将彻底删除，不可恢复（含历史版本）") >= 0, label + ' 批量 confirm zh 原串字典内嵌（不可恢复 + 含历史版本 + 条数插值）')
      assert(s.indexOf("'notes-restore', { id: id }") >= 0 && s.indexOf("'notes-purge', { id: id }") >= 0, label + ' 批量逐条 notes-restore / notes-purge payload')
      assert(s.indexOf("tt('sel.selCount', { n: Object.keys(trashSel).length })") >= 0, label + ' 选中计数走 tt() sel.selCount（覆盖卡E）')
      assert(s.indexOf('dsh-notes-trash-batch') >= 0 && s.indexOf('dsh-notes-trash-check') >= 0, label + ' 批量条/行勾选样式类')
    }
    // DOM 两端：app.html + 原型 notes-ui-v2.html（同款 DOM/脚本）
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function toggleTrashSel(id)') >= 0 && s.indexOf('function toggleTrashAll()') >= 0, label + ' 行勾选/全选函数存在')
      assert(s.indexOf('function doTrashRestoreBatch()') >= 0 && s.indexOf('function doTrashPurgeBatch()') >= 0, label + ' 批量恢复/批量彻底删除函数存在')
      assert(s.indexOf('id="trashAll"') >= 0 && s.indexOf('id="trashRestoreBatch"') >= 0 && s.indexOf('id="trashPurgeBatch"') >= 0, label + ' 全选 checkbox + 批量按钮 DOM id')
      /* i18n 覆盖卡E：app 端批量条/confirm/toast 走 t() 字典；原型不双语保留中文原文（分侧断言） */
      if (label === 'app.html') {
        assert(s.indexOf("t('sel.selCount', { n: selCnt })") >= 0, label + ' 选中计数走 t() sel.selCount（覆盖卡E）')
        assert(s.indexOf("confirm(t('trash.restoreBatchConfirm', { n: ids.length }))") >= 0, label + ' 批量恢复 confirm 走 t()（覆盖卡E）')
        assert(s.indexOf("confirm(t('trash.purgeBatchConfirm', { n: ids.length }))") >= 0, label + ' 批量彻底删除 confirm 走 t()（覆盖卡E）')
        assert(s.indexOf("toast(t('common.restoredBatch', { ok: ok })") >= 0 && s.indexOf("toast(t('trash.purgedBatch', { ok: ok })") >= 0, label + ' 批量 toast 计数文案走 t()（覆盖卡E）')
      } else {
        assert(s.indexOf("'已选 ' + selCnt + ' 条'") >= 0, label + ' 选中计数')
        assert(s.indexOf("confirm('批量恢复：所选的 ' + ids.length + ' 条笔记将移出回收站（恢复后回到正常列表）。\\n确认恢复？')") >= 0, label + ' 批量恢复 confirm 文案（含条数）')
        assert(s.indexOf("confirm('批量彻底删除：所选的 ' + ids.length + ' 条笔记将彻底删除，不可恢复（含历史版本）。\\n删除后正文、历史版本快照与归档备份将一并移除，确认彻底删除？')") >= 0, label + ' 批量彻底删除 confirm 含「不可恢复 + 含历史版本 + 条数」')
        assert(s.indexOf("toast('已恢复 ' + ok + ' 条'") >= 0 && s.indexOf("toast('已彻底删除 ' + ok + ' 条'") >= 0, label + ' 批量 toast 计数文案')
      }
      assert(s.indexOf("rpc('notes-restore', { id: id })") >= 0 && s.indexOf("rpc('notes-purge', { id: id })") >= 0, label + ' 批量逐条 notes-restore / notes-purge payload')
      assert(s.indexOf('.trash-batch{') >= 0 && s.indexOf('.trash-check{') >= 0 && s.indexOf('.trash-preview{') >= 0, label + ' 批量条/勾选/预览样式（内联 CSS）')
    }
    // 面板样式双份同步（styles.css + 发布包 lib/styles.css）
    const cssDev3 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg3 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev3], ['发布包 lib/styles.css', cssPkg3]]) {
      assert(pair[1].indexOf('.dsh-notes-trash-batch{') >= 0 && pair[1].indexOf('.dsh-notes-trash-check{') >= 0 && pair[1].indexOf('.dsh-notes-trash-preview{') >= 0, pair[0] + ' 缺回收站批量/勾选/预览样式（需跑 scripts/build-dist.cjs）')
    }
  })
  await t('回收站行预览四端同步：notes-get includeDeleted 取已删正文 + 只读渲染（esc 先行零注入面）', () => {
    // React 两端：renderMarkdown 内核只读渲染（内核全量转义，esc 先行——XSS 红线断言同源）
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function toggleTrashPreview(id)') >= 0, label + ' 行预览开关函数存在')
      assert(s.indexOf("'notes-get', { id: id, includeDeleted: true }") >= 0, label + ' 预览走 notes-get includeDeleted（已删正文可达）')
      assert(s.indexOf("className: 'dsh-notes-trash-preview dsh-notes-rich', dangerouslySetInnerHTML: { __html: renderMarkdown(trashPreview.body, wikiResolve) }") >= 0, label + ' 预览只读 renderMarkdown 内核渲染（全量转义零注入面）')
      assert(s.indexOf("trashPreview && trashPreview.id === n.id ? tt('trash.collapse') : tt('trash.preview')") >= 0, label + ' 行尾「预览/收起」按钮走 tt()（i18n 覆盖卡E）')
    }
    // app.html：同款 renderMarkdown 只读渲染；标题/错误态均经 esc()
    assert(appSrc.indexOf('function toggleTrashPreview(id)') >= 0, 'app.html 行预览开关函数存在')
    assert(appSrc.indexOf("rpc('notes-get', { id: id, includeDeleted: true })") >= 0, 'app.html 预览走 notes-get includeDeleted')
    assert(appSrc.indexOf('\'<div class="trash-preview rich">\' + (typeof pv.body === \'string\' ? renderMarkdown(pv.body, wikiResolve)') >= 0, 'app.html 预览只读 renderMarkdown 内核渲染（esc 先行）')
    assert(appSrc.indexOf('data-act="preview"') >= 0 && appSrc.indexOf('class="ti trash-ti"') >= 0, 'app.html 行尾「预览/收起」按钮 + 标题点击预览')
    // 原型：无 Markdown 内核——esc() 纯文本只读预览（hist-preview 同款先例，esc 全量转义零注入面）+ mock notes-get 支持 includeDeleted
    assert(protoV2Src.indexOf('function toggleTrashPreview(id)') >= 0, '原型行预览开关函数存在')
    assert(protoV2Src.indexOf("rpc('notes-get', { id: id, includeDeleted: true })") >= 0, '原型预览走 notes-get includeDeleted')
    assert(protoV2Src.indexOf('\'<div class="trash-preview">\' + (typeof pv.body === \'string\' ? esc(pv.body)') >= 0, '原型预览 esc() 纯文本只读（esc 先行零注入面）')
    assert(protoV2Src.indexOf('data-act="preview"') >= 0 && protoV2Src.indexOf('class="ti trash-ti"') >= 0, '原型行尾「预览/收起」按钮 + 标题点击预览')
    assert(protoV2Src.indexOf("return n && (!n.deleted || a.includeDeleted) ? { note: JSON.parse(JSON.stringify(n)) } : { error: 'Note has been deleted' }") >= 0, '原型 mock notes-get 支持 includeDeleted（已删演示正文可预览）')
  })
  }
}
