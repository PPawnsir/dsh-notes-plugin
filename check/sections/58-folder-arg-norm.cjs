// 节 58. folder 写入归一（folder-arg-norm：_create/_update folder 名称→id 归一 + 非法显式拒绝，notes-041-create-folder-name；实证 n-mut9tg7bik40）
// 缺陷修复：_create/_update 把 folder 入参原样当文件夹 id 落盘——传名称「看板反馈」→ 存名称字符串 → 不匹配任何 id → 显示未分类（create 不落夹 bug）。
// 修复：写入路径经 _resolveFolderArg 归一（''/id 透传、名称→id、无法解析整体拒绝报错不落库）；读路径/查询过滤口径不动（R-6，_list/_search 仍 id 口径，由工具层 resolveFolderRef 先行解析）。
// 红线：存量误存名称的笔记不自动改写（下次 move/保存经闸门治愈）；解析不到必须报错而非静默落未分类。
module.exports = {
  id: "58",
  title: "58. folder 写入归一（create/update 名称→id + 非法显式拒绝 + 双包逐字节）",
  async run(H, S) {
  const { t, section, assert, hostSrc, indexSrc } = H
  const { ctx, findTool, handlers, noteManage, NOTES_DIR, plugin, store } = S
  section('58. folder 写入归一（create/update 名称→id + 非法显式拒绝 + 双包逐字节）')
  // 同节 21：断言开发版行为，重 apply 把 handlers 钉在开发版实例（同一 mock store，数据互通）
  plugin.apply(ctx)
  // 自包含造数（--only/--core 模式下节 21 的造数断言可能跳过，本节独立成立）
  const fNorm = (await handlers['notes-folders']({ op: 'create', name: '归一验证夹' })).folder
  // 磁盘 folder 行是缓存无关的真相源（工具与重 apply 的 handlers 分属两个插件实例，各有缓存）
  const diskFolder = (id) => { const m = (store.get(NOTES_DIR + '\\' + id + '.md') || '').match(/\nfolder: ([^\n]*)\n/); return m ? m[1] : null }

  // ===== 58.1 host 行为级：create/update 传名称落盘归一为 id（RPC 通道——工具层之外的直达路径）=====
  await t('folder-arg-norm 行为级：create/update 传文件夹名落盘归一为 id（RPC + 工具双通道）', async () => {
    // ① notes-create RPC 传名称 → 落盘为 id（本 bug 核心路径：server.js notes-create 无工具层预解析）
    const c1 = await handlers['notes-create']({ title: '归一样本-名', body: 'x', folder: '归一验证夹' })
    assert(c1 && c1.id && !c1.error, 'create 传名称应成功（实得 ' + JSON.stringify(c1) + '）')
    assert.strictEqual(diskFolder(c1.id), fNorm.id, '磁盘 front-matter 落的是文件夹 id（实得 ' + diskFolder(c1.id) + '）')
    assert.strictEqual((await handlers['notes-get']({ id: c1.id })).note.folder, fNorm.id, 'get 回读 folder = id')
    // ② 传 id 原样（回归兼容）
    const c2 = await handlers['notes-create']({ title: '归一样本-id', body: 'x', folder: fNorm.id })
    assert(c2 && c2.id && !c2.error, 'create 传 id 应成功')
    assert.strictEqual(diskFolder(c2.id), fNorm.id, 'id 原样透传落盘')
    // ③ notes-update RPC 传名称 → 归一为 id（update 同病同治）
    const u1 = await handlers['notes-update']({ id: c2.id, folder: '归一验证夹' })
    assert(u1 && !u1.error, 'update 传名称应成功（实得 ' + JSON.stringify(u1) + '）')
    assert.strictEqual(diskFolder(c2.id), fNorm.id, 'update 落盘归一为 id')
    // ④ 工具通道双闸一致：note_manage create 传名称（工具层 resolveFolderRef 先解析 + host 核心闸兜底幂等）
    const mc = await noteManage.execute({ action: 'create', title: '归一样本-工具', body: 'x', folder: '归一验证夹' })
    assert(mc && mc.id && !mc.error, '工具 create 传名称应成功（实得 ' + JSON.stringify(mc) + '）')
    assert.strictEqual(diskFolder(mc.id), fNorm.id, '工具通道落盘同为 id')
  })

  // ===== 58.2 错得安全：非法值整体拒绝不落库 / 原值不动 / '' 未分类语义透传 =====
  await t('folder-arg-norm 非法显式拒绝：未知 id/名称整体报错不落库 + 原值不动 + 空串未分类透传', async () => {
    // ① create 传未知名称/未知 id → 整体拒绝（报错含具体值），不落库
    const bad1 = await handlers['notes-create']({ title: '归一非法-名', body: 'x', folder: '不存在的文件夹名' })
    assert(bad1 && bad1.error && bad1.error.indexOf('未知文件夹 id 或名称') >= 0 && bad1.error.indexOf('不存在的文件夹名') >= 0, 'create 未知名称显式报错含具体值：' + JSON.stringify(bad1))
    assert(!bad1.id, '整体拒绝不落库（不得部分保存）')
    const bad2 = await handlers['notes-create']({ title: '归一非法-id', body: 'x', folder: 'f-nosuch000' })
    assert(bad2 && bad2.error && bad2.error.indexOf('f-nosuch000') >= 0, 'create 未知 id 显式报错（错得安全，不静默落未分类）')
    assert(!bad2.id, '未知 id 整体拒绝不落库')
    // ② update 非法 → 整体拒绝且原 folder 不动（失败停在原状）
    const c = await handlers['notes-create']({ title: '归一拒绝保护', body: 'x', folder: fNorm.id })
    const uBad = await handlers['notes-update']({ id: c.id, folder: '也不存在的夹' })
    assert(uBad && uBad.error && uBad.error.indexOf('也不存在的夹') >= 0, 'update 非法值显式拒绝：' + JSON.stringify(uBad))
    assert.strictEqual(diskFolder(c.id), fNorm.id, '拒绝后原 folder 不动（错得安全）')
    // ③ '' 空串 = 未分类语义透传（create/update 同口径）
    const cEmpty = await handlers['notes-create']({ title: '归一空串', body: 'x', folder: '' })
    assert(cEmpty && cEmpty.id && !cEmpty.error, 'create 传空串应成功（未分类）')
    assert.strictEqual(diskFolder(cEmpty.id), '', '空串透传落盘为未分类')
    const uEmpty = await handlers['notes-update']({ id: c.id, folder: '' })
    assert(uEmpty && !uEmpty.error, 'update 传空串应成功（移出到未分类）')
    assert.strictEqual(diskFolder(c.id), '', 'update 空串落盘为未分类')
    // ④ 工具通道同闸：note_manage create 传未知名称报错（工具层「文件夹不存在」先拦；host 核心闸兜底）
    const mBad = await noteManage.execute({ action: 'create', title: '归一非法-工具', body: 'x', folder: '不存在的文件夹名' })
    assert(mBad && mBad.error && !mBad.id, '工具 create 未知名称拒绝不落库（实得 ' + JSON.stringify(mBad) + '）')
  })

  // ===== 58.3 双包逐字节同步（folder-arg-norm 标记块 + create/update 接线，模式同节 53.2）=====
  await t('folder-arg-norm 标记块双包逐字节一致（notes.js ⇄ notes.dist.js）+ create/update 接线锚点', () => {
    const mRe = /\/\/ ==== folder-arg-norm BEGIN ====[\s\S]*?\/\/ ==== folder-arg-norm END ====/
    const bDev = hostSrc.match(mRe), bDist = indexSrc.match(mRe)
    assert(bDev && bDist, '开发版拼接与静态包均须含 folder-arg-norm 标记块')
    assert.strictEqual(bDev[0], bDist[0], '标记块双包逐字节一致（notes.js ⇄ notes.dist.js 改一边忘另一边）')
    for (const pair of [['host 开发版', hostSrc], ['静态包 index.mjs', indexSrc]]) {
      assert(pair[1].indexOf('if (folderNorm !== undefined) folderNorm = await _resolveFolderArg(folderNorm)') >= 0, pair[0] + ' _create 归一接线（需先跑 scripts/build-dist.cjs）')
      assert(pair[1].indexOf('folder: folderNorm ||') >= 0, pair[0] + ' _create 落盘接归一值（需先跑 scripts/build-dist.cjs）')
      assert(pair[1].indexOf('note.folder = await _resolveFolderArg(folder)') >= 0, pair[0] + ' _update 归一接线（需先跑 scripts/build-dist.cjs）')
    }
  })

  // ===== 58.4 工具描述同步：folder 参数说明含「名称归一 + 非法拒绝」口径（开发版 + 静态包 schema）=====
  await t('note_manage folder 描述同步：名称写入归一为 id + 未知值拒绝（开发版 + 静态包）', () => {
    const nm = findTool('note_manage')
    const d = nm.parameters.properties.folder.description
    assert(d.indexOf('normalized to its id on write') >= 0 && d.indexOf('rejected') >= 0, '开发版工具 schema folder 描述应含归一/拒绝口径（实得 ' + d + '）')
    assert(nm.description.indexOf('a name is normalized to its folder id on write') >= 0, '开发版工具 description 段落同口径')
    assert(indexSrc.indexOf('a name is normalized to its folder id on write') >= 0, '静态包 index.mjs 工具 description 同步（需先跑 scripts/build-dist.cjs）')
  })
  }
}
