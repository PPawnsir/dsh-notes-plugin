// 节 23.6 P3 单文件导出（scope 拼接 + 图片内联 + 体积告警 + 双包同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "23.6",
  title: "23.6 P3 单文件导出（scope 拼接 + 图片内联 + 体积告警 + 双包同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, clientPkgSrc, llmMock, mkFsMockImp, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  // ===== 23.6 P3 单文件导出（notes-export-single：scope 拼接 + 图片 base64 内联 + >20MB 告警仍导出） =====
  section('23.6 P3 单文件导出（scope 拼接 + 图片内联 + 体积告警 + 双包同步）')

  // --- 双侧结构契约（host-impl / index.mjs 同步）---
  await t('双侧注册 notes-export-single + _exportSingle + 命名/告警常量（host-impl / index.mjs）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("handle('notes-export-single'") >= 0, label + ' 注册 notes-export-single')
      assert(src.indexOf('async function _exportSingle(args)') >= 0, label + ' 缺 _exportSingle')
      assert(src.indexOf('dsh-notes-export-single-') >= 0, label + ' 文件命名 dsh-notes-export-single-<ts>.md')
      assert(src.indexOf('SINGLE_EXPORT_WARN_BYTES = 20 * 1024 * 1024') >= 0, label + ' 20MB 告警阈值常量')
      assert(src.indexOf('resolveFolderRef(scope.folder)') >= 0, label + ' scope.folder 兼容 id/名称（resolveFolderRef）')
      assert(src.indexOf('notes-export-single 需要 dir') >= 0, label + ' dir 参数校验')
      assert(src.indexOf('已照常导出') >= 0, label + ' >20MB 告警仍导出（warning 字段文案）')
    }
  })
  // --- export-single 标记块：双包逐字节一致 + eval 单测（与 sensitive-helpers 同款姿势）---
  const grabExpBlk = (s, tag) => { const m = s.match(/\/\/ ==== export-single BEGIN ====[\s\S]*?\/\/ ==== export-single END ====/); assert(m, tag + ' 缺 export-single 标记块'); return m[0] }
  const expBlkDev = grabExpBlk(hostSrc, 'host-impl.js')
  const expBlkPkg = grabExpBlk(indexSrc, 'index.mjs')
  const expNS = {}
  new Function('ns', 'ASSET_MIME_EXT', expBlkDev + '\nns.utf8Bytes = utf8Bytes; ns.assetMimeFromName = assetMimeFromName; ns.inlineAssetsInBody = inlineAssetsInBody; ns.singleExportScopeLabel = singleExportScopeLabel; ns.buildSingleExport = buildSingleExport; ns.SEP = SINGLE_EXPORT_SEP; ns.WARN = SINGLE_EXPORT_WARN_BYTES;')(expNS, { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' })
  await t('export-single 标记块双包逐字节一致 + 可 eval（五函数/两常量导出）', () => {
    assert.strictEqual(expBlkPkg, expBlkDev, 'host-impl.js 与 index.mjs 的 export-single 块必须逐字节一致')
    for (const fn of ['utf8Bytes', 'assetMimeFromName', 'inlineAssetsInBody', 'singleExportScopeLabel', 'buildSingleExport']) assert.strictEqual(typeof expNS[fn], 'function', fn + ' 导出')
    assert.strictEqual(expNS.WARN, 20 * 1024 * 1024, 'WARN = 20MB')
    assert.strictEqual(expNS.SEP, '\n\n---\n\n', 'SEP 篇间分隔线')
  })
  await t('utf8Bytes：ascii / CJK / emoji 代理对 / 空串', () => {
    assert.strictEqual(expNS.utf8Bytes('abc'), 3)
    assert.strictEqual(expNS.utf8Bytes('中文'), 6)
    assert.strictEqual(expNS.utf8Bytes('😀'), 4, '代理对计 4 字节')
    assert.strictEqual(expNS.utf8Bytes(''), 0)
  })
  await t('assetMimeFromName：白名单扩展名反查（大小写不敏感）+ 非白名单/无扩展名 → 空', () => {
    assert.strictEqual(expNS.assetMimeFromName('a.png'), 'image/png')
    assert.strictEqual(expNS.assetMimeFromName('B.JPG'), 'image/jpeg')
    assert.strictEqual(expNS.assetMimeFromName('x.webp'), 'image/webp')
    assert.strictEqual(expNS.assetMimeFromName('x.svg'), '', '非白名单不内联')
    assert.strictEqual(expNS.assetMimeFromName('noext'), '')
  })
  await t('inlineAssetsInBody：命中内联 data URL / 缺失保留原引用并计数 / 非图片形态不动 / 空正文', () => {
    const r = expNS.inlineAssetsInBody('前 ![图](assets/a.png) 中 ![缺](assets/miss.png) 后', { 'a.png': 'QUJD' })
    assert(r.body.indexOf('![图](data:image/png;base64,QUJD)') >= 0, '命中内联为 data URL')
    assert(r.body.indexOf('![缺](assets/miss.png)') >= 0, '缺失资产保留原引用')
    assert(r.inlined === 1 && r.missing === 1, '计数 inlined=1 missing=1（实得 ' + JSON.stringify({ i: r.inlined, m: r.missing }) + '）')
    const r2 = expNS.inlineAssetsInBody('普通链接 [x](assets/a.png) 不动', { 'a.png': 'QUJD' })
    assert(r2.inlined === 0 && r2.body.indexOf('[x](assets/a.png)') >= 0, '非图片形态（无 ! 前缀）不内联')
    const r3 = expNS.inlineAssetsInBody('', { 'a.png': 'QUJD' })
    assert(r3.body === '' && r3.inlined === 0 && r3.missing === 0, '空正文零计数')
  })
  await t('singleExportScopeLabel：tag > folder > 缺省全部', () => {
    assert.strictEqual(expNS.singleExportScopeLabel({}), '全部笔记')
    assert.strictEqual(expNS.singleExportScopeLabel({ all: true }), '全部笔记')
    assert.strictEqual(expNS.singleExportScopeLabel({ folder: 'f-1' }, '导出夹'), '文件夹「导出夹」')
    assert.strictEqual(expNS.singleExportScopeLabel({ tag: '分享' }), '标签「分享」')
  })
  const renderFMStub = (m) => '---\nid: ' + m.id + '\ntitle: ' + m.title + '\n---\n\n'
  await t('buildSingleExport 拼接结构：文档头 + 目录页 + 每篇「# 标题 + front-matter + 正文」+ 篇间分隔线', () => {
    const two = [{ id: 'n-a', title: '甲', body: '正文甲' }, { id: 'n-b', title: '乙\n换行', body: '正文乙' }]
    const doc = expNS.buildSingleExport(two, { toc: true, exportedAt: '2026-10-02T00:00:00.000Z', scopeLabel: '全部笔记', inlined: 1, missing: 0 }, renderFMStub)
    assert(doc.indexOf('# dsh-notes 单文件导出\n') === 0, '文档头起始')
    assert(doc.indexOf('> - 范围：全部笔记') >= 0 && doc.indexOf('> - 篇数：2') >= 0, '头含范围/篇数')
    assert(doc.indexOf('> - 图片：base64 内联 1 张') >= 0, '头含图片计数')
    assert(doc.indexOf('## 目录\n\n1. 甲（n-a）\n2. 乙 换行（n-b）') >= 0, '目录页：序号 + 标题（换行收拢）+ id')
    assert(doc.indexOf('# 甲\n\n---\nid: n-a\ntitle: 甲\n---\n\n正文甲') >= 0, '每篇 = # 标题 + front-matter + 正文')
    assert.strictEqual(doc.split('\n\n---\n\n').length - 1, 2, '2 篇 = 2 条分隔线（目录与首篇间 1 + 篇间 1）')
    const noToc = expNS.buildSingleExport(two, { toc: false, exportedAt: '', scopeLabel: '全部笔记' }, renderFMStub)
    assert(noToc.indexOf('## 目录') < 0, 'toc:false 无目录页')
    const empty = expNS.buildSingleExport([], { toc: true, exportedAt: '', scopeLabel: '全部笔记' }, renderFMStub)
    assert(empty.indexOf('> - 篇数：0') >= 0 && empty.indexOf('\n\n---\n\n') < 0, '空范围仅文档头（无分隔线）')
  })

  // --- 行为断言（开发版全新实例 storeES/handlersES，计数确定；标识符 ES 后缀避让 27.5 节 storeS 实例）---
  const storeES = new Map()
  const fsMockES = mkFsMockImp(storeES, [NOTES_DIR])
  const handlersES = {}
  const harnessMockES = { handle: (name, fn) => { handlersES[name] = fn; return () => { delete handlersES[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const ctxES = {
    fs: fsMockES, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockES, DIR).apply(ctxES)
  // 造库：1 资产 + 1 文件夹 + 3 笔记（A 在文件夹且正文含 1 命中 + 1 缺失图片引用；B 带标签「分享」；C 裸笔记）
  const pngB64ES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64')
  const upES = await handlersES['notes-asset-upload']({ name: '单文件图.png', data: pngB64ES, mime: 'image/png' })
  assert(!upES.error && upES.file, '资产上传成功（前置）')
  const esFolder = (await handlersES['notes-folders']({ op: 'create', name: '导出单夹' })).folder
  const esA = await handlersES['notes-create']({ title: '单文件A', body: 'A正文\n![图](' + upES.file + ')\n![缺](assets/20990101-000000-none.png)\n', topic: '开发', folder: esFolder.id })
  const esB = await handlersES['notes-create']({ title: '单文件B', body: 'B正文', tags: ['分享'], topic: '设计' })
  const esC = await handlersES['notes-create']({ title: '单文件C', body: 'C正文', topic: '运维' })

  await t('notes-export-single 全部 scope：单文件拼接 + 图片内联 + 缺失保留 + 结构完整 + 小体积无 warning', async () => {
    const r = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { all: true }, format: 'md' })
    assert(!r.error, '导出成功（实得 ' + JSON.stringify(r).slice(0, 300) + '）')
    assert.strictEqual(r.exported, 4, '4 篇全部导出（3 种子 + 注入索引）')
    assert(/\\dsh-notes-export-single-\d{8}-\d{6}\.md$/.test(r.target), 'target = <dir>\\dsh-notes-export-single-<ts>.md（实得：' + r.target + '）')
    assert.strictEqual(r.images, 1, '内联 1 张')
    assert.strictEqual(r.missingAssets, 1, '缺失 1 张保留原引用')
    assert.strictEqual(r.scope, '全部笔记', 'scopeLabel 全部')
    assert(!r.warning, '小体积无 warning')
    const doc = storeES.get(r.target)
    assert(doc, '文件已写入目标目录')
    assert(doc.indexOf('# dsh-notes 单文件导出') === 0, '文档头')
    assert(doc.indexOf('## 目录') >= 0, '目录页缺省生成')
    assert(doc.indexOf('# 单文件A\n\n---\nid: ' + esA.id) >= 0, '每篇 = # 标题 + front-matter 元信息块')
    assert(doc.indexOf('data:image/png;base64,' + pngB64ES) >= 0, '图片 base64 内联为 data URL')
    assert(doc.indexOf('![缺](assets/20990101-000000-none.png)') >= 0, '缺失资产保留原引用')
    assert(doc.indexOf('](' + upES.file + ')') < 0, '已内联引用不再保留相对路径')
    assert.strictEqual(doc.split('\n\n---\n\n').length - 1, 4, '4 篇 = 4 条篇间分隔线（3 种子 + 注入索引）')
    assert.strictEqual(r.bytes, expNS.utf8Bytes(doc), 'bytes = 文档 UTF-8 字节数')
  })
  await t('notes-export-single scope 过滤：文件夹（id/名称双兼容）/ 标签', async () => {
    const byId = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { folder: esFolder.id } })
    assert(!byId.error && byId.exported === 1, '按文件夹 id 导出 1 篇（实得 ' + JSON.stringify(byId).slice(0, 200) + '）')
    const docF = storeES.get(byId.target)
    assert(docF.indexOf(esA.id) >= 0 && docF.indexOf(esB.id) < 0 && docF.indexOf(esC.id) < 0, '文件夹 scope 仅含夹内笔记')
    assert(byId.scope === '文件夹「导出单夹」', 'scopeLabel 带解析后的文件夹名（实得 ' + byId.scope + '）')
    const byName = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { folder: '导出单夹' } })
    assert(!byName.error && byName.exported === 1 && byName.scope === '文件夹「导出单夹」', '按文件夹名称导出（resolveFolderRef 兼容）')
    const byTag = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { tag: '分享' } })
    assert(!byTag.error && byTag.exported === 1 && byTag.scope === '标签「分享」', '按标签导出 1 篇')
    const docT = storeES.get(byTag.target)
    assert(docT.indexOf(esB.id) >= 0 && docT.indexOf(esA.id) < 0, '标签 scope 仅含带该标签的笔记')
  })
  await t('notes-export-single toc:false 无目录页 + 软删除笔记不导出', async () => {
    const r = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: {}, toc: false })
    assert(!r.error, '导出成功')
    assert(storeES.get(r.target).indexOf('## 目录') < 0, 'toc:false 无目录页')
    await handlersES['notes-delete']({ id: esC.id })
    const r2 = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: {} })
    assert(r2.exported === 3 && storeES.get(r2.target).indexOf(esC.id) < 0, '软删除笔记不进单文件导出（与 _list 同口径；3 = 2 存活种子 + 注入索引）')
    await handlersES['notes-restore']({ id: esC.id })
  })
  await t('notes-export-single 参数校验：缺 dir / dir 是文件 / format 非 md / 文件夹不存在', async () => {
    const e1 = await handlersES['notes-export-single']({ scope: {} })
    assert(e1.error && e1.error.indexOf('需要 dir') >= 0, '缺 dir 报错')
    const e2 = await handlersES['notes-export-single']({ dir: NOTES_DIR + '\\' + esA.id + '.md', scope: {} })
    assert(e2.error && e2.error.indexOf('不是目录') >= 0, 'dir 指向文件报错')
    const e3 = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: {}, format: 'html' })
    assert(e3.error && e3.error.indexOf('md') >= 0, 'format 非 md 报错')
    const e4 = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { folder: '不存在的夹' } })
    assert(e4.error && e4.error.indexOf('文件夹不存在') >= 0, '文件夹不存在报错')
  })
  await t('notes-export-single >20MB 告警仍导出（指引：图片内联体积可能大）', async () => {
    const big = await handlersES['notes-create']({ title: '超大笔记', body: 'a'.repeat(20 * 1024 * 1024 + 100), tags: ['bigbody'] })
    const r = await handlersES['notes-export-single']({ dir: 'D:\\exp-single', scope: { tag: 'bigbody' } })
    assert(!r.error && r.exported === 1, '超限仍导出（实得 ' + JSON.stringify(r).slice(0, 200) + '）')
    assert(r.warning && r.warning.indexOf('20MB') >= 0, '带 20MB 告警（实得 ' + r.warning + '）')
    assert(r.bytes > 20 * 1024 * 1024, 'bytes 超阈值')
    assert(storeES.has(r.target), '超大文件照常写盘')
    assert(storeES.get(r.target).indexOf(big.id) >= 0, '内容完整')
  })

  // --- 静态包行为（index.mjs 独立实例；harness 主通道注册 handlersES2）---
  const storeES2 = new Map()
  const fsMockES2 = mkFsMockImp(storeES2, [NOTES_ROOT_STATIC])
  const handlersES2 = {}
  const harnessMockES2 = { handle: (name, fn) => { handlersES2[name] = fn; return () => { delete handlersES2[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  await t('静态包 notes-export-single 全链路（拼接 + 图片内联 + scope 过滤 + 文件命名）', async () => {
    global.harness = harnessMockES2
    try {
      const modES = await import(pathToFileURL(INDEX_PATH).href + '?expsingle=1')
      modES.apply({
        fs: fsMockES2, sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
        effect: () => {},
      })
      assert(typeof handlersES2['notes-export-single'] === 'function', '静态包注册 notes-export-single')
      const up = await handlersES2['notes-asset-upload']({ name: '静态单图.png', data: pngB64ES, mime: 'image/png' })
      const nA = await handlersES2['notes-create']({ title: '静态单A', body: 'SA\n![图](' + up.file + ')\n' })
      const nB = await handlersES2['notes-create']({ title: '静态单B', body: 'SB', tags: ['静态标签'] })
      const r = await handlersES2['notes-export-single']({ dir: 'D:\\exp-single-st', scope: {} })
      assert(!r.error && r.exported === 3, '静态包导出 3 篇（2 种子 + 注入索引）（实得 ' + JSON.stringify(r).slice(0, 200) + '）')
      assert(/dsh-notes-export-single-\d{8}-\d{6}\.md$/.test(r.target), '静态包文件命名一致（path.join）')
      const doc = storeES2.get(r.target)
      assert(doc && doc.indexOf('# 静态单A\n\n---\nid: ' + nA.id) >= 0, '静态包拼接结构（# 标题 + front-matter）')
      assert(doc.indexOf('data:image/png;base64,' + pngB64ES) >= 0, '静态包图片内联')
      const rt = await handlersES2['notes-export-single']({ dir: 'D:\\exp-single-st', scope: { tag: '静态标签' } })
      assert(!rt.error && rt.exported === 1, '静态包标签 scope 导出 1 篇')
      const docT = storeES2.get(rt.target)
      assert(docT.indexOf(nB.id) >= 0 && docT.indexOf(nA.id) < 0, '静态包 scope 过滤口径一致')
      const bad = await handlersES2['notes-export-single']({ scope: {} })
      assert(bad.error && bad.error.indexOf('需要 dir') >= 0, '静态包缺 dir 报错')
    } finally {
      delete global.harness
    }
  })

  // --- client 面板侧结构（client-impl.js + 发布包 lib/client.js 同步）---
  await t('client 设置卡片「数据」区「导出单文件…」入口 + modal（scope 三选一/目录/目录页开关）+ RPC 调用', () => {
    assert(clientSrc.indexOf('onClick: openSExport') >= 0 && clientSrc.indexOf('导出单文件…') >= 0, '数据区「导出单文件…」按钮')
    assert(clientSrc.indexOf('function openSExport') >= 0 && clientSrc.indexOf('function doSExport') >= 0, 'openSExport/doSExport 函数')
    assert(clientSrc.indexOf("host.call('notes-export-single'") >= 0, '调用 notes-export-single RPC')
    assert(clientSrc.indexOf('dsh-notes-last-export-single-dir') >= 0, '目标目录 localStorage 记忆键')
    assert(clientSrc.indexOf("sExportScope === 'folder'") >= 0 && clientSrc.indexOf("sExportScope === 'tag'") >= 0, 'scope 三选一联动（全部/文件夹/标签）')
    assert(clientSrc.indexOf('生成目录页') >= 0 && clientSrc.indexOf('sExportToc') >= 0, '目录页开关')
    assert(clientSrc.indexOf('sExportOpenRef') >= 0, 'Esc 镜像 ref（modal 优先关闭）')
    assert(clientSrc.indexOf('!sExportOpen') >= 0, '全局错误条互斥（modal 打开时不叠报）')
    // 发布包同步（client-impl.js 改动后需跑 scripts/build-dist.cjs）
    assert(clientPkgSrc.indexOf("rpc('notes-export-single'") >= 0 && clientPkgSrc.indexOf('导出单文件…') >= 0, '发布包 lib/client.js 同步单文件导出（需先跑 scripts/build-dist.cjs）')
  })
  }
}
