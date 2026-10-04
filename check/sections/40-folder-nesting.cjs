// 节 40. 文件夹嵌套（parent + maxFolderDepth + 递归子树过滤 + cascade 删除，host 双包）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "40",
  title: "40. 文件夹嵌套（parent + maxFolderDepth + 递归子树过滤 + cascade 删除，host 双包）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, admMock, agentsMock, llmMock, m1, m2, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  // ===== 40. 文件夹嵌套（parent 字段 + maxFolderDepth 设置 + 递归子树过滤 + cascade 删除 + 导出子树；host 双包）=====
  // 语义（用户拍板）：folders.json 加 parent（缺省=根级，存量数据无 parent 字段零迁移）；maxFolderDepth 缺省 3（settings.json，
  // 非法回缺省 / null 恢复缺省 / 0=不限）；create/reorder 拖父级沿 parent 链校验深度 + cycle（不能挂到自己/子孙下）；
  // _list/计数/导出走**递归子树口径**（传文件夹 id = 含全部子孙文件夹内笔记）；delete 缺省拒绝有子内容（needCascade），
  // cascade:true 整棵子树删除（文件夹结构不可恢复）+ 其下笔记逐条软删进回收站（可恢复；恢复后原文件夹不在 → effectiveFolder 兜底未分类）。
  section('40. 文件夹嵌套（parent + maxFolderDepth + 递归子树过滤 + cascade 删除，host 双包）')

  // --- 40.1 标记块：双包逐字节一致 + eval 纯函数单测（与 sensitive-helpers/img-path-hint 同款姿势）---
  const grabTreeBlk = (s, tag) => { const m = s.match(/\/\/ ==== folder-tree-helpers BEGIN ====[\s\S]*?\/\/ ==== folder-tree-helpers END ====/); assert(m, tag + ' 缺 folder-tree-helpers 标记块'); return m[0] }
  const treeBlkDev = grabTreeBlk(hostSrc, 'host-impl.js')
  const treeBlkPkg = grabTreeBlk(indexSrc, 'index.mjs')
  const treeNS = {}
  new Function('ns', treeBlkDev + '\nns.folderDepth = folderDepth; ns.folderSubtreeIds = folderSubtreeIds; ns.folderSubtreeHeight = folderSubtreeHeight; ns.checkFolderAttach = checkFolderAttach;')(treeNS)
  await t('folder-tree-helpers 标记块双包逐字节一致 + 可 eval（folderDepth/folderSubtreeIds/folderSubtreeHeight/checkFolderAttach）', () => {
    assert.strictEqual(treeBlkPkg, treeBlkDev, 'host-impl.js 与 index.mjs 的 folder-tree-helpers 块必须逐字节一致')
    for (const fn of ['folderDepth', 'folderSubtreeIds', 'folderSubtreeHeight', 'checkFolderAttach']) assert.strictEqual(typeof treeNS[fn], 'function', fn + ' 导出')
  })
  await t('folder-tree-helpers 纯函数：深度/子树/高度/挂载校验 + 悬空 parent 与存量 cycle 数据防御', () => {
    const F = [{ id: 'A', order: 0 }, { id: 'B', order: 1, parent: 'A' }, { id: 'C', order: 2, parent: 'B' }]
    assert.deepStrictEqual([treeNS.folderDepth('A', F), treeNS.folderDepth('B', F), treeNS.folderDepth('C', F), treeNS.folderDepth('ghost', F)], [1, 2, 3, 0], 'depth：根1/子2/孙3/清单外0')
    assert.deepStrictEqual(Object.keys(treeNS.folderSubtreeIds('A', F)).sort(), ['A', 'B', 'C'], '子树含自身 + 全部子孙')
    assert.deepStrictEqual(Object.keys(treeNS.folderSubtreeIds('B', F)).sort(), ['B', 'C'], 'B 子树不含 A')
    assert.strictEqual(treeNS.folderSubtreeHeight('A', F), 3, 'A 子树高度 3')
    assert.strictEqual(treeNS.folderSubtreeHeight('C', F), 1, '叶子高度 1')
    assert.strictEqual(treeNS.checkFolderAttach(F, null, 'B', 3), null, '新建挂 B（深度 3 边界）通过')
    assert(treeNS.checkFolderAttach(F, null, 'C', 3).indexOf('maxFolderDepth') >= 0, '新建挂 C（深度 4）超限拒绝')
    assert.strictEqual(treeNS.checkFolderAttach(F, null, 'C', 0), null, 'maxDepth=0 不限')
    assert(treeNS.checkFolderAttach(F, 'A', 'C', 0).indexOf('cycle') >= 0, '挂到自己子孙 cycle 拒绝')
    assert(treeNS.checkFolderAttach(F, 'A', 'A', 0).indexOf('自己') >= 0, '挂到自己拒绝')
    assert(treeNS.checkFolderAttach(F, null, 'ghost', 3).indexOf('不存在') >= 0, 'parent 不存在拒绝')
    // 存量损坏防御：cycle 数据（X↔Y）与悬空 parent 不抛错（visited 截断，按已遍历部分返回）
    const bad = [{ id: 'X', order: 0, parent: 'Y' }, { id: 'Y', order: 1, parent: 'X' }, { id: 'Z', order: 2, parent: 'ghost' }]
    assert.strictEqual(treeNS.folderDepth('X', bad), 2, 'cycle 数据截断不死循环')
    assert.strictEqual(treeNS.folderDepth('Z', bad), 1, '悬空 parent 按根级计')
    assert(treeNS.folderSubtreeHeight('X', bad) >= 1, 'cycle 高度有限返回')
    assert(treeNS.folderSubtreeIds('X', bad).X && treeNS.folderSubtreeIds('X', bad).Y, 'cycle 子树含环成员即截断')
  })

  // --- 40.2 行为级（开发版独立实例 store40/handlers40/tools40，与 29/35 节同款隔离模式）---
  const store40 = new Map()
  const fsMock40 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store40.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store40.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store40.has(p)) throw new Error('ENOENT: ' + p); return store40.get(p) },
    writeText: async (p, c) => { store40.set(p, c) },
  }
  const handlers40 = {}
  const tools40 = []
  const harnessMock40 = {
    handle: (name, fn) => { handlers40[name] = fn; return () => { delete handlers40[name] } },
    defineTool: (d) => d,
    registerTool: (c, d) => { tools40.push(d); return () => {} },
  }
  const contexts40 = []
  new Function('harness', 'pluginDir', hostSrc)(harnessMock40, DIR).apply({
    fs: fsMock40, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts40.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: () => () => {},
  })
  const F40 = NOTES_DIR + '\\folders.json'
  const f40 = {}   // 节内样本句柄（递归子树过滤 → cascade 删除 两测试接力）

  await t('maxFolderDepth 设置往返：缺省 3（无键）→ set 落盘回读 → 非法值报错 → null 恢复缺省', async () => {
    const sg0 = await handlers40['notes-settings-get']({})
    assert(!('maxFolderDepth' in sg0.settings), '初始无 maxFolderDepth override（缺省 3）')
    let bad = await handlers40['notes-settings-set']({ maxFolderDepth: -1 })
    assert(bad.error && bad.error.indexOf('maxFolderDepth') >= 0, '负数报错')
    bad = await handlers40['notes-settings-set']({ maxFolderDepth: '3' })
    assert(bad.error && bad.error.indexOf('maxFolderDepth') >= 0, '字符串报错')
    const ok = await handlers40['notes-settings-set']({ maxFolderDepth: 5 })
    assert(ok.ok === true, '保存成功（实得 ' + JSON.stringify(ok) + '）')
    const onDisk = JSON.parse(store40.get(NOTES_DIR + '\\settings.json'))
    assert.strictEqual(onDisk.maxFolderDepth, 5, 'settings.json 落盘 maxFolderDepth:5')
    assert.strictEqual((await handlers40['notes-settings-get']({})).settings.maxFolderDepth, 5, 'notes-settings-get 回读一致')
    await handlers40['notes-settings-set']({ maxFolderDepth: null })
    assert(!('maxFolderDepth' in (await handlers40['notes-settings-get']({})).settings), 'null 删除 override 恢复缺省 3')
  })
  await t('嵌套 parent 往返：create 带 parent 落盘 + list 返回 parent/depth + 存量零迁移（无 parent=根级 depth 1）', async () => {
    const root = (await handlers40['notes-folders']({ op: 'create', name: '根夹' })).folder
    assert(!('parent' in root), '根级 create 返回无 parent 字段')
    const child = (await handlers40['notes-folders']({ op: 'create', name: '子夹', parent: root.id })).folder
    assert.strictEqual(child.parent, root.id, 'create parent 落位返回')
    const onDisk = JSON.parse(store40.get(F40))
    assert.strictEqual(onDisk.find(f => f.id === child.id).parent, root.id, 'folders.json 磁盘含 parent 字段')
    assert(!('parent' in onDisk.find(f => f.id === root.id)), '根级磁盘条目无 parent 键（存量零迁移格式不变）')
    const lst = await handlers40['notes-folders']({})
    const lr = lst.folders.find(f => f.id === root.id), lc = lst.folders.find(f => f.id === child.id)
    assert(lr.parent === '' && lr.depth === 1, 'list 根级 parent=\'\' depth=1（实得：' + JSON.stringify(lr) + '）')
    assert(lc.parent === root.id && lc.depth === 2, 'list 子级 parent/depth 正确（实得：' + JSON.stringify(lc) + '）')
    // 存量零迁移：手写旧格式清单（无 parent 字段）+ 混合嵌套条目 → 正常解析
    store40.set(F40, JSON.stringify([{ id: 'f-legacy', name: '旧夹', order: 0 }, { id: 'f-sub', name: '旧子夹', order: 1, parent: 'f-legacy' }]))
    const lst2 = await handlers40['notes-folders']({})
    assert(lst2.folders.find(f => f.id === 'f-legacy').depth === 1 && lst2.folders.find(f => f.id === 'f-sub').depth === 2, '旧格式（无/有 parent 混合）正常解析为根级/子级')
    store40.delete(F40)   // 清理：还原空清单，后续测试各自建树
  })
  await t('嵌套深度校验：缺省 3 层超限拒绝 / 边界第 3 层 OK / 调大与 0 不限放行', async () => {
    const l1 = (await handlers40['notes-folders']({ op: 'create', name: 'L1' })).folder
    const l2 = (await handlers40['notes-folders']({ op: 'create', name: 'L2', parent: l1.id })).folder
    const l3r = await handlers40['notes-folders']({ op: 'create', name: 'L3', parent: l2.id })
    assert(l3r.ok === true && l3r.folder.parent === l2.id, '边界第 3 层创建 OK')
    const l4r = await handlers40['notes-folders']({ op: 'create', name: 'L4', parent: l3r.folder.id })
    assert(l4r.error && l4r.error.indexOf('maxFolderDepth=3') >= 0, '缺省 3 层：第 4 层拒绝（实得：' + JSON.stringify(l4r) + '）')
    const badP = await handlers40['notes-folders']({ op: 'create', name: 'Lx', parent: 'f-ghost' })
    assert(badP.error && badP.error.indexOf('父文件夹不存在') >= 0, 'parent 不存在拒绝')
    // 调大到 4 → 第 4 层放行；0=不限 → 第 6 层放行；null 恢复缺省 3
    await handlers40['notes-settings-set']({ maxFolderDepth: 4 })
    const l4b = (await handlers40['notes-folders']({ op: 'create', name: 'L4', parent: l3r.folder.id })).folder
    assert(l4b && l4b.parent === l3r.folder.id, '调大 maxFolderDepth=4 后第 4 层放行')
    await handlers40['notes-settings-set']({ maxFolderDepth: 0 })
    let cur = l4b.id
    for (const nm of ['L5', 'L6']) cur = (await handlers40['notes-folders']({ op: 'create', name: nm, parent: cur })).folder.id
    assert.strictEqual((await handlers40['notes-folders']({})).folders.find(f => f.name === 'L6').depth, 6, '0=不限：第 6 层放行（depth=6）')
    await handlers40['notes-settings-set']({ maxFolderDepth: null })
    // 清理：空子树 cascade 删除（无笔记 notes=0）
    const del = await handlers40['notes-folders']({ op: 'delete', id: l1.id, cascade: true })
    assert(del.ok === true && del.folders === 6 && del.notes === 0, '清理：空子树 cascade 删除 folders=6 notes=0（实得：' + JSON.stringify(del) + '）')
  })
  await t('reorder 拖父级：cycle 拒绝（自身/子孙）+ 深度超限拒绝 + 合法改挂落盘', async () => {
    const A = (await handlers40['notes-folders']({ op: 'create', name: 'R-A' })).folder
    const B = (await handlers40['notes-folders']({ op: 'create', name: 'R-B', parent: A.id })).folder
    const C = (await handlers40['notes-folders']({ op: 'create', name: 'R-C', parent: B.id })).folder
    const self = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { [A.id]: A.id } })
    assert(self.error && self.error.indexOf('自己') >= 0, '挂自己拒绝（实得：' + JSON.stringify(self) + '）')
    const cyc = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { [A.id]: C.id } })
    assert(cyc.error && cyc.error.indexOf('cycle') >= 0, '挂到自己子孙 cycle 拒绝（实得：' + JSON.stringify(cyc) + '）')
    // 深度：A 子树高 3，挂到另一个根级夹 D 下 → 1+3=4 层超限
    const D = (await handlers40['notes-folders']({ op: 'create', name: 'R-D' })).folder
    const deep = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { [A.id]: D.id } })
    assert(deep.error && deep.error.indexOf('maxFolderDepth') >= 0, '拖父级子树整体超限拒绝（实得：' + JSON.stringify(deep) + '）')
    // 合法改挂：C 回根级（parents '' 删除 parent 键）→ A 子树降为高 2 → 挂 D 下 = 3 层边界 OK
    const ok1 = await handlers40['notes-folders']({ op: 'reorder', ids: [C.id], parents: { [C.id]: '' } })
    assert(ok1.ok === true, 'C 回根级 OK')
    const ok2 = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { [A.id]: D.id } })
    assert(ok2.ok === true, 'A（子树高 2）挂 D 下 = 3 层边界 OK（实得：' + JSON.stringify(ok2) + '）')
    const lst = await handlers40['notes-folders']({})
    assert(lst.folders.find(f => f.id === C.id).parent === '' && lst.folders.find(f => f.id === C.id).depth === 1, 'C 已回根级 depth=1')
    assert(lst.folders.find(f => f.id === A.id).parent === D.id && lst.folders.find(f => f.id === B.id).depth === 3, 'A 挂 D 下、B depth=3')
    const onDisk = JSON.parse(store40.get(F40))
    assert(onDisk.find(f => f.id === A.id).parent === D.id && !('parent' in onDisk.find(f => f.id === C.id)), '改挂落盘（回根级删除 parent 键）')
    const badId = await handlers40['notes-folders']({ op: 'reorder', ids: [A.id], parents: { 'f-ghost': D.id } })
    assert(badId.error && badId.error.indexOf('不存在') >= 0, 'parents 含清单外 id 报错')
    // 清理：D→A→B 整棵 cascade；C 空叶子免 cascade 直删
    const delD = await handlers40['notes-folders']({ op: 'delete', id: D.id, cascade: true })
    assert(delD.ok === true && delD.folders === 3 && delD.notes === 0, '清理 D 子树（实得：' + JSON.stringify(delD) + '）')
    const delC = await handlers40['notes-folders']({ op: 'delete', id: C.id })
    assert(delC.ok === true && delC.folders === 1 && delC.notes === 0, '空叶子文件夹免 cascade 直删（folders:1 notes:0）')
  })
  await t('递归子树过滤：三层父子样本 notes-list / note_search / note_manage 同口径 + count 子树口径', async () => {
    const A = (await handlers40['notes-folders']({ op: 'create', name: 'F-A' })).folder
    const B = (await handlers40['notes-folders']({ op: 'create', name: 'F-B', parent: A.id })).folder
    const C = (await handlers40['notes-folders']({ op: 'create', name: 'F-C', parent: B.id })).folder
    const nA = await handlers40['notes-create']({ title: 'nest-A', body: 'x', folder: A.id })
    const nB = await handlers40['notes-create']({ title: 'nest-B', body: 'x', folder: B.id })
    const nC = await handlers40['notes-create']({ title: 'nest-C', body: 'x', folder: C.id })
    const nU = await handlers40['notes-create']({ title: 'nest-未分类', body: 'x' })
    Object.assign(f40, { A: A.id, B: B.id, C: C.id, nA: nA.id, nB: nB.id, nC: nC.id })
    const idsOf = (l) => l.notes.map(n => n.id).sort()
    // notes-list：A=整棵子树 3 条；B=B+C 2 条；C=1 条；''=未分类（含 nU，不含子树笔记）
    assert.deepStrictEqual(idsOf(await handlers40['notes-list']({ folder: A.id })), [nA.id, nB.id, nC.id].sort(), 'folder=A 递归含 B/C 笔记')
    assert.deepStrictEqual(idsOf(await handlers40['notes-list']({ folder: B.id })), [nB.id, nC.id].sort(), 'folder=B 含 C 不含 A')
    assert.deepStrictEqual(idsOf(await handlers40['notes-list']({ folder: C.id })), [nC.id], 'folder=C 只自身')
    const unf = await handlers40['notes-list']({ folder: '' })
    assert(unf.notes.some(n => n.id === nU.id) && !unf.notes.some(n => n.id === nB.id), 'folder=\'\' 只未分类（口径不变）')
    // note_search 同口径（无 query 列全部）
    const s = await tools40.find(x => x.name === 'note_search').execute({ folder: B.id })
    assert.deepStrictEqual(s.notes.map(n => n.id).sort(), [nB.id, nC.id].sort(), 'note_search folder=B 递归子树')
    // note_manage list 同口径（名称/id 双兼容）
    const mgr = tools40.find(x => x.name === 'note_manage')
    const m1 = await mgr.execute({ action: 'list', folder: 'F-A' })
    assert(m1.notes.length === 3 && m1.notes.every(n => [nA.id, nB.id, nC.id].indexOf(n.id) >= 0), 'note_manage list 按名称递归子树')
    const m2 = await mgr.execute({ action: 'list', folder: C.id })
    assert(m2.notes.length === 1 && m2.notes[0].id === nC.id, 'note_manage list folder=C 只自身')
    // count 子树口径：A.count=3（含子孙），B.count=2，C.count=1
    const lst = await handlers40['notes-folders']({})
    assert.strictEqual(lst.folders.find(f => f.id === A.id).count, 3, 'A count 子树口径=3')
    assert.strictEqual(lst.folders.find(f => f.id === B.id).count, 2, 'B count 子树口径=2')
    assert.strictEqual(lst.folders.find(f => f.id === C.id).count, 1, 'C count=1')
  })
  await t('cascade 删除：缺省拒绝含子内容 + cascade:true 整棵删除笔记进回收站可恢复落未分类', async () => {
    // 缺省拒绝：统计子文件夹 2 + 笔记 3，结构不动
    const refuse = await handlers40['notes-folders']({ op: 'delete', id: f40.A })
    assert(refuse.error && refuse.needCascade === true && refuse.childFolders === 2 && refuse.notes === 3, '缺省拒绝 + 子内容统计（实得：' + JSON.stringify(refuse) + '）')
    assert((await handlers40['notes-folders']({})).folders.length === 3, '拒绝后结构未动')
    // cascade:true：整棵 3 文件夹 + 3 笔记逐条软删（_delete 同通道）
    const del = await handlers40['notes-folders']({ op: 'delete', id: f40.A, cascade: true })
    assert(del.ok === true && del.folders === 3 && del.notes === 3, 'cascade 统计 {folders:3, notes:3}（实得：' + JSON.stringify(del) + '）')
    const lst = await handlers40['notes-folders']({})
    assert(!lst.folders.some(f => f.id === f40.A || f.id === f40.B || f.id === f40.C), 'A/B/C 整棵出清单')
    const trash = await handlers40['notes-list']({ includeDeleted: true })
    assert([f40.nA, f40.nB, f40.nC].every(id => { const n = trash.notes.find(x => x.id === id); return n && n.deleted === true }), '三条笔记全部软删进回收站')
    assert((await handlers40['notes-list']({})).notes.every(n => [f40.nA, f40.nB, f40.nC].indexOf(n.id) < 0), '默认列表不再含已删笔记')
    // 恢复 nC：原文件夹 C 已不存在 → effectiveFolder 兜底未分类（断言锁定该机制）
    await handlers40['notes-restore']({ id: f40.nC })
    const unf = await handlers40['notes-list']({ folder: '' })
    assert(unf.notes.some(n => n.id === f40.nC), '恢复后落未分类（folder 悬空 → effectiveFolder 兜底）')
    assert.strictEqual((await handlers40['notes-folders']({})).unfiled, unf.notes.length, 'unfiled 计数与未分类列表一致')
    // 清理回收站残留（导出测试基线干净）：purge 软删笔记（墓碑化）
    await handlers40['notes-purge']({ id: f40.nA })
    await handlers40['notes-purge']({ id: f40.nB })
  })
  await t('导出子树：notes-export-single scope.folder 递归含子孙文件夹笔记', async () => {
    const A = (await handlers40['notes-folders']({ op: 'create', name: 'E-A' })).folder
    const B = (await handlers40['notes-folders']({ op: 'create', name: 'E-B', parent: A.id })).folder
    await handlers40['notes-create']({ title: '导-根层', body: 'x', folder: A.id })
    await handlers40['notes-create']({ title: '导-子层', body: 'x', folder: B.id })
    await handlers40['notes-create']({ title: '导-无关', body: 'x' })
    const r = await handlers40['notes-export-single']({ dir: NOTES_DIR + '\\exp40', scope: { folder: A.id } })
    assert(!r.error && r.exported === 2, '导出 2 条（子树口径；实得：' + JSON.stringify(r) + '）')
    const doc = store40.get(r.target)
    assert(doc.indexOf('导-根层') >= 0 && doc.indexOf('导-子层') >= 0, '导出文档含根层 + 子孙层笔记')
    assert(doc.indexOf('导-无关') < 0, '未分类笔记不进子树导出')
    // 按名称解析同口径
    const r2 = await handlers40['notes-export-single']({ dir: NOTES_DIR + '\\exp40', scope: { folder: 'E-B' } })
    assert(!r2.error && r2.exported === 1, 'scope.folder=E-B 只 1 条（实得：' + JSON.stringify(r2) + '）')
  })
  await t('工具描述/schema 同步嵌套语义（note_manage/note_search folder 说明 + cascade 提示，双包一致）', () => {
    const ns = tools40.find(x => x.name === 'note_search'), nm = tools40.find(x => x.name === 'note_manage')
    assert(ns.parameters.properties.folder.description.indexOf('recursive subtree') >= 0 && ns.parameters.properties.folder.description.indexOf('unfiled') >= 0, 'note_search folder 描述含递归子树口径 + 未分类')
    assert(nm.parameters.properties.folder.description.indexOf('nest') >= 0 && nm.parameters.properties.folder.description.indexOf('subtree') >= 0, 'note_manage folder schema 描述含嵌套/子树')
    assert(nm.description.indexOf('NEST') >= 0 && nm.description.indexOf('cascade:true') >= 0 && nm.description.indexOf('maxFolderDepth') >= 0, 'note_manage 描述含嵌套 + cascade:true + maxFolderDepth')
    // 双包描述同步（源码级）
    assert(indexSrc.indexOf('recursive subtree match — it returns notes in that folder AND all its descendant folders') >= 0, 'index.mjs note_search folder 描述同步')
    assert(indexSrc.indexOf('requires explicit cascade:true') >= 0 && indexSrc.indexOf('maxFolderDepth setting caps the depth, default 3') >= 0, 'index.mjs note_manage 描述同步 cascade/嵌套')
  })
  }
}
