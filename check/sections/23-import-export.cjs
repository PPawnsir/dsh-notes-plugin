// 节 23. 笔记导入/导出（目录快照 + 预览分类 + 全量备份 + 覆盖策略 + folders 合并）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "23",
  title: "23. 笔记导入/导出（目录快照 + 预览分类 + 全量备份 + 覆盖策略 + folders 合并）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, admMock, agentsMock, g, handlers, llmMock, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // ===== 23. 笔记导入/导出（notes-export / notes-import-preview / notes-import，双侧同步） =====
  section('23. 笔记导入/导出（目录快照 + 预览分类 + 全量备份 + 覆盖策略 + folders 合并）')

  // --- 源码结构断言（开发版 host-impl + 静态包 index.mjs 同步）---
  await t('双侧注册 3 个 RPC + 核心函数 + 目录命名约定（host-impl / index.mjs）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("handle('notes-export'") >= 0, label + ' 注册 notes-export')
      assert(src.indexOf("handle('notes-import-preview'") >= 0, label + ' 注册 notes-import-preview')
      assert(src.indexOf("handle('notes-import'") >= 0, label + ' 注册 notes-import')
      for (const fn of ['_export', '_importPreview', '_import', 'scanImportDir', 'copyNotesDir', 'listNoteMd', 'readFoldersFile', 'readLibraryRaw', 'tsStamp']) {
        assert(src.indexOf('function ' + fn) >= 0, label + ' 缺函数 ' + fn)
      }
      assert(src.indexOf('dsh-notes-export-') >= 0, label + ' 导出目录命名 dsh-notes-export-<ts>')
      assert(src.indexOf('notes-backup-') >= 0, label + ' 备份目录命名 notes-backup-<ts>')
      assert(src.indexOf("indexOf('n-') === 0") >= 0, label + ' n-*.md 过滤（settings.json / *.bak / assets 子目录不进出）')
      assert(src.indexOf("p.meta.id || name.replace(/\\.md$/i, '')") >= 0, label + ' 导入 id 取 front-matter，缺失按文件名兜底')
    }
  })
  await t('双侧图片资产段同步：上传 RPC + mime 白名单 + 5MB 上限 + 重名序号 + 导出/导入/备份连带', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("handle('notes-asset-upload'") >= 0, label + ' 注册 notes-asset-upload')
      for (const fn of ['_assetUpload', 'listAssets', 'copyAssetsDir', 'safeAssetFileName', 'allocAssetName', 'assetDecodedSize']) {
        assert(src.indexOf('function ' + fn) >= 0, label + ' 缺资产函数 ' + fn)
      }
      assert(src.indexOf("ASSET_MIME_EXT") >= 0 && src.indexOf("'image/png': '.png'") >= 0 && src.indexOf("'image/webp': '.webp'") >= 0, label + ' mime 白名单 png/jpeg/gif/webp')
      assert(src.indexOf('ASSET_MAX_BYTES = 5 * 1024 * 1024') >= 0, label + ' 解码后 5MB 上限常量')
      assert(src.indexOf('base64 文本形态落盘') >= 0 || src.indexOf('base64 文本形态') >= 0, label + ' 磁盘格式注释：base64 文本形态（沙箱 fs 仅文本写）')
      assert(src.indexOf('copyAssetsDir(NOTES_DIR, targetDir, false)') >= 0, label + ' copyNotesDir 连带 assets（导出/备份共用）')
      assert(src.indexOf('copyAssetsDir(chk.dir, NOTES_DIR, true)') >= 0, label + ' _import 合并 assets（同名跳过）')
      assert(src.indexOf('assetsMerged') >= 0, label + ' _import 返回 assetsMerged')
      assert(src.indexOf('r.assets') >= 0, label + ' _export 返回 assets 计数')
    }
  })

  // --- 行为断言（开发版 host-impl，全新实例：独立 store/handlers，计数确定）---
  // mock 增强：stat 对「有子项的隐含目录」返回 dir（贴近真实 fs，import/export 的目录存在性校验依赖它）
  function mkFsMockImp(store, dirs) {
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
        for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
      writeText: async (p, c) => { store.set(p, c) },
    }
  }
  const store6 = new Map()
  const fsMock6 = mkFsMockImp(store6, [NOTES_DIR])
  const handlers6 = {}
  const harnessMock6 = { handle: (name, fn) => { handlers6[name] = fn; return () => { delete handlers6[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const ctx6 = {
    fs: fsMock6, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock6, DIR).apply(ctx6)
  await t('开发版注册 52 个 RPC（含 notes-export / notes-export-single / notes-import-preview / notes-import / notes-asset-upload；另含归档 preview/undo + ai-organize/assets-prune 并行重构 + P1 notes-purge + P3 单文件导出 + notes-inject-preview 注入预览 + notes-suggest 整理建议 + notes-usage-get 用量统计 + 历史版本三 RPC + 工作记忆 notes-memory-guide + 定时派发 notes-schedule-eval + N+1 批量 notes-get-batch + 图查询 notes-graph + 注入索引 notes-mount/notes-mount-list + 效用账本 notes-ledger-refresh + 召回遥测 notes-recall-stats + whenToUse 草稿 notes-when-suggest + 约定体检 notes-conflict-check + 语义检索向量层 notes-vectors-status/notes-vectors-rebuild/notes-vectors-search/notes-vectors-put）', () => {
    assert.strictEqual(Object.keys(handlers6).length, 52, '实得 ' + Object.keys(handlers6).length)
    assert(typeof handlers6['notes-conflict-check'] === 'function', 'notes-conflict-check handler 存在（0.4.5-G 约定体检，notes-045-conflict-check）')
    assert(typeof handlers6['notes-when-suggest'] === 'function', 'notes-when-suggest handler 存在（0.4.3 验收修复 notes-043-preview-when-edit）')
    assert(typeof handlers6['notes-recall-stats'] === 'function', 'notes-recall-stats handler 存在（0.4.3+ 卡⑫ 统一召回遥测，notes-043-inject-receipt）')
    assert(typeof handlers6['notes-ledger-refresh'] === 'function', 'notes-ledger-refresh handler 存在（0.4.3⑥ 效用账本，notes-043-ledger）')
    assert(typeof handlers6['notes-graph'] === 'function', 'notes-graph handler 存在（0.4.3 内核① 图查询，notes-043-graph）')
    assert(typeof handlers6['notes-get-batch'] === 'function', 'notes-get-batch handler 存在（N+1 批量端点，notes-034-batch3）')
    assert(typeof handlers6['notes-schedule-eval'] === 'function', 'notes-schedule-eval handler 存在（定时派发·执行层）')
    assert(typeof handlers6['notes-memory-guide'] === 'function', 'notes-memory-guide handler 存在（工作记忆 v0 沉淀引导）')
    assert(typeof handlers6['notes-export'] === 'function' && typeof handlers6['notes-import-preview'] === 'function' && typeof handlers6['notes-import'] === 'function', '3 个新 handler 存在')
    assert(typeof handlers6['notes-export-single'] === 'function', 'notes-export-single handler 存在（P3 单文件导出）')
    assert(typeof handlers6['notes-asset-upload'] === 'function', 'notes-asset-upload handler 存在')
    assert(typeof handlers6['notes-purge'] === 'function', 'notes-purge handler 存在（P1 回收站彻底删除）')
    assert(typeof handlers6['notes-usage-get'] === 'function', 'notes-usage-get handler 存在（LLM 用量统计）')
    assert(typeof handlers6['notes-history'] === 'function' && typeof handlers6['notes-history-get'] === 'function' && typeof handlers6['notes-restore-history'] === 'function', '历史版本三 handler 存在（notes-history-ui）')
  })

  // 造库：3 条笔记 + 1 个文件夹
  const exA = await handlers6['notes-create']({ title: '导出A', body: '正文A', topic: '开发' })
  const exB = await handlers6['notes-create']({ title: '导出B', body: '正文B', topic: '设计' })
  const exC = await handlers6['notes-create']({ title: '导出C', body: '正文C', topic: '运维' })
  await handlers6['notes-folders']({ op: 'create', name: '导出文件夹' })

  await t('notes-export：全库快照（n-*.md + folders.json）到 <dir>\\dsh-notes-export-<ts>', async () => {
    const r = await handlers6['notes-export']({ dir: 'D:\\exp-out' })
    assert(!r.error, '导出成功（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.exported, 4, '导出 4 条笔记（A/B/C + 注入索引根笔记，notes-043-index 升级首启在库）')
    assert.strictEqual(r.foldersFile, true, 'folders.json 一并导出')
    assert(/\\dsh-notes-export-\d{8}-\d{6}$/.test(r.target), 'target = <dir>\\dsh-notes-export-<yyyyMMdd-HHmmss>（实得：' + r.target + '）')
    for (const id of [exA.id, exB.id, exC.id]) {
      assert.strictEqual(store6.get(r.target + '\\' + id + '.md'), store6.get(NOTES_DIR + '\\' + id + '.md'), id + ' 快照内容与原文件逐字节一致')
    }
    assert.strictEqual(store6.get(r.target + '\\folders.json'), store6.get(NOTES_DIR + '\\folders.json'), 'folders.json 快照一致')
    assert(!store6.has(r.target + '\\settings.json'), 'settings.json 不导出')
  })
  await t('notes-export 参数校验：缺 dir 报错 / dir 是文件报错', async () => {
    const e1 = await handlers6['notes-export']({})
    assert(e1.error && e1.error.indexOf('需要 dir') >= 0, '缺 dir 报错')
    const e2 = await handlers6['notes-export']({ dir: NOTES_DIR + '\\' + exA.id + '.md' })
    assert(e2.error && e2.error.indexOf('不是目录') >= 0, 'dir 指向文件应报错（实得：' + JSON.stringify(e2) + '）')
  })

  // 预览基线：全新导出目录与库一致 → 全 same；预览本身不写任何文件
  let expDir = null
  await t('notes-import-preview：全 same 基线 + folders.new=0 + 不写任何东西', async () => {
    const ex = await handlers6['notes-export']({ dir: 'D:\\exp-out' })
    expDir = ex.target
    const sizeBefore = store6.size
    const p = await handlers6['notes-import-preview']({ dir: expDir })
    assert(!p.error, '预览成功（实得 ' + JSON.stringify(p).slice(0, 200) + '）')
    assert.strictEqual(p.total, 4)
    assert.strictEqual(p.same, 4); assert.strictEqual(p.diff, 0); assert.strictEqual(p.added, 0)
    assert(p.detail.every(d => d.status === 'same' && d.deleted === false), 'detail 全 same 且未标注 deleted')
    assert(p.folders && p.folders.total === 1 && p.folders.new === 0, 'folders：清单 1 个且全部已存在')
    assert.strictEqual(store6.size, sizeBefore, '预览不写任何文件（纯只读）')
  })

  // 构造混合场景：B 外部改动（diff）+ 新增 n-newimp01（added）+ 新增 deleted 笔记（added+标注）+ folders.json 加新文件夹
  await t('notes-import-preview：same/diff/added 分类 + deleted 标注 + folders 新增统计', async () => {
    store6.set(expDir + '\\' + exB.id + '.md', store6.get(expDir + '\\' + exB.id + '.md') + '\n外部改动\n')
    store6.set(expDir + '\\n-newimp01.md', '---\nid: n-newimp01\ntitle: 外部新笔记\ntopic: 调研\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"\n---\n\n新正文\n')
    store6.set(expDir + '\\n-delimp01.md', '---\nid: n-delimp01\ntitle: 外部已删笔记\ndeleted: true\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"\n---\n\n已删正文\n')
    const curFolders = JSON.parse(store6.get(expDir + '\\folders.json'))
    curFolders.push({ id: 'f-imp01', name: '导入新文件夹', order: 5 })
    store6.set(expDir + '\\folders.json', JSON.stringify(curFolders, null, 2))
    const p = await handlers6['notes-import-preview']({ dir: expDir })
    assert.strictEqual(p.total, 6, 'A/B/C + 索引 + 2 新增')
    assert.strictEqual(p.same, 3); assert.strictEqual(p.diff, 1); assert.strictEqual(p.added, 2)
    const byId = {}
    for (const d of p.detail) byId[d.id] = d
    assert.strictEqual(byId[exB.id].status, 'diff', 'B 分类为 diff')
    assert.strictEqual(byId['n-newimp01'].status, 'added', '新笔记分类为 added')
    assert.strictEqual(byId['n-delimp01'].status, 'added', 'deleted 笔记也是 added')
    assert.strictEqual(byId['n-delimp01'].deleted, true, 'deleted 笔记在预览 detail 里标注（导入后仍隐藏）')
    assert.strictEqual(p.folders.total, 2)
    assert.strictEqual(p.folders.new, 1, 'f-imp01 是新文件夹')
  })
  await t('notes-import-preview 参数与目录校验', async () => {
    const e1 = await handlers6['notes-import-preview']({})
    assert(e1.error && e1.error.indexOf('需要 dir') >= 0, '缺 dir 报错')
    const e2 = await handlers6['notes-import-preview']({ dir: 'D:\\no-such-dir-anywhere' })
    assert(e2.error && e2.error.indexOf('目录不存在') >= 0, '目录不存在报错（实得：' + JSON.stringify(e2) + '）')
  })

  await t('notes-import：先全量备份 → added 入库 / same 跳过 / diff 默认跳过 / folders 合并只增不删', async () => {
    const r = await handlers6['notes-import']({ dir: expDir })
    assert(!r.error, '导入成功（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.imported, 2, 'n-newimp01 + n-delimp01 入库')
    assert.strictEqual(r.skippedSame, 3, 'A/C + 索引相同跳过')
    assert.strictEqual(r.skippedDiff, 1, 'B 不同且未 overwrite → 跳过')
    assert.strictEqual(r.overwritten, 0)
    assert.strictEqual(r.foldersMerged, 1, 'f-imp01 追加合并')
    assert(/\\notes-backup-\d{8}-\d{6}$/.test(r.backupDir), 'backupDir = notes\\notes-backup-<ts>（实得：' + r.backupDir + '）')
    // 备份是导入前的库快照：B 为原文（不含外部改动），含 folders.json，不含 settings.json
    const bakB = store6.get(r.backupDir + '\\' + exB.id + '.md')
    assert(bakB && bakB.indexOf('正文B') >= 0 && bakB.indexOf('外部改动') < 0, '备份保留导入前 B 原文')
    assert(store6.has(r.backupDir + '\\' + exA.id + '.md') && store6.has(r.backupDir + '\\' + exC.id + '.md'), '备份含全部 n-*.md')
    assert(store6.has(r.backupDir + '\\folders.json'), '备份含 folders.json')
    assert(!store6.has(r.backupDir + '\\settings.json'), '备份不含 settings.json')
    // 默认策略不动 diff 笔记
    assert(store6.get(NOTES_DIR + '\\' + exB.id + '.md').indexOf('外部改动') < 0, '库内 B 保持原文（diff 未覆盖）')
    // added 入库：文件落盘 + 缓存同步可 get
    assert(store6.has(NOTES_DIR + '\\n-newimp01.md'), '新笔记文件已入库')
    const g = await handlers6['notes-get']({ id: 'n-newimp01' })
    assert(g.note && g.note.title === '外部新笔记' && g.note.body.indexOf('新正文') >= 0, '导入笔记可立即 get（缓存已同步）')
    // deleted 按原文件导入，导入后仍隐藏
    assert(store6.has(NOTES_DIR + '\\n-delimp01.md'), 'deleted 笔记文件按原样入库')
    const l = await handlers6['notes-list']({})
    assert(l.notes.find(n => n.id === 'n-newimp01'), '列表含新导入笔记')
    assert(!l.notes.find(n => n.id === 'n-delimp01'), 'deleted 导入后仍隐藏')
    // folders.json 合并：只增不删，新 id 追加尾部且 order 续排（不沿用导入清单的 order=5）
    const onDisk = JSON.parse(store6.get(NOTES_DIR + '\\folders.json'))
    assert.strictEqual(onDisk.length, 2, 'folders 只增（1→2）')
    const nf = onDisk.find(f => f.id === 'f-imp01')
    assert(nf && nf.name === '导入新文件夹' && nf.order === 1, '新文件夹 order 续在尾部（实得 ' + JSON.stringify(nf) + '）')
    assert(onDisk.find(f => f.name === '导出文件夹').order === 0, '既有文件夹不动')
  })
  await t('notes-import 幂等：二次导入全 same / folders 无新增；overwrite=true 才覆盖 diff', async () => {
    const r2 = await handlers6['notes-import']({ dir: expDir })
    assert.strictEqual(r2.imported, 0, '二次导入无新增')
    assert.strictEqual(r2.skippedSame, 5, 'A/C + 索引 + 2 条新导入全部相同')
    assert.strictEqual(r2.skippedDiff, 1, 'diff 仍跳过')
    assert.strictEqual(r2.foldersMerged, 0, 'folders 无新增')
    const r3 = await handlers6['notes-import']({ dir: expDir, overwrite: true })
    assert.strictEqual(r3.overwritten, 1, 'overwrite=true 覆盖 B')
    assert.strictEqual(r3.imported, 0)
    assert(store6.get(NOTES_DIR + '\\' + exB.id + '.md').indexOf('外部改动') >= 0, '库内 B 已是外部改动版')
    const g = await handlers6['notes-get']({ id: exB.id })
    assert(g.note.body.indexOf('外部改动') >= 0, '缓存同步为覆盖后内容')
  })
  await t('notes-import 参数与目录校验（不建备份）', async () => {
    const before = Array.from(store6.keys()).filter(k => k.indexOf('notes-backup-') >= 0).length
    const e1 = await handlers6['notes-import']({})
    assert(e1.error && e1.error.indexOf('需要 dir') >= 0, '缺 dir 报错')
    const e2 = await handlers6['notes-import']({ dir: 'D:\\no-such-dir-anywhere' })
    assert(e2.error && e2.error.indexOf('目录不存在') >= 0, '目录不存在报错')
    const after = Array.from(store6.keys()).filter(k => k.indexOf('notes-backup-') >= 0).length
    assert.strictEqual(after, before, '校验失败不产生新备份')
  })

  // --- 图片资产（开发版 host-impl 行为，复用 store6/handlers6；库内此时 5 条笔记 + folders） ---
  const pngBytes6 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const pngB64_6 = pngBytes6.toString('base64')
  await t('notes-asset-upload：mime 白名单 / 超 5MB / 非法 base64 / 空 data 拒绝', async () => {
    const e1 = await handlers6['notes-asset-upload']({ name: 'x.svg', data: pngB64_6, mime: 'image/svg+xml' })
    assert(e1.error && e1.error.indexOf('mime') >= 0, 'svg 拒绝（实得：' + JSON.stringify(e1) + '）')
    const e2 = await handlers6['notes-asset-upload']({ name: 'big.png', data: 'A'.repeat(7 * 1024 * 1024 + 4), mime: 'image/png' })
    assert(e2.error && e2.error.indexOf('5MB') >= 0, '超 5MB 拒绝（实得：' + JSON.stringify(e2) + '）')
    const e3 = await handlers6['notes-asset-upload']({ name: 'bad.png', data: '!!!not-base64!!!', mime: 'image/png' })
    assert(e3.error && e3.error.indexOf('base64') >= 0, '非法 base64 拒绝')
    const e4 = await handlers6['notes-asset-upload']({ name: 'empty.png', data: '', mime: 'image/png' })
    assert(e4.error, '空 data 拒绝')
    const e5 = await handlers6['notes-asset-upload']({ name: 'x.png', data: 'QUJD', mime: '' })
    assert(e5.error && e5.error.indexOf('mime') >= 0, '空 mime 拒绝')
    assert(!Array.from(store6.keys()).some(k => k.indexOf(NOTES_DIR + '\\assets\\') === 0), '全部拒绝后无资产落盘')
  })
  let upA = null, upB = null
  await t('notes-asset-upload：落盘 assets/<yyyyMMdd-HHmmss>-<安全名> + 重名追加序号 + dataURL 前缀容忍', async () => {
    upA = await handlers6['notes-asset-upload']({ name: '界面截图.png', data: pngB64_6, mime: 'image/png' })
    assert(!upA.error, '上传成功（实得 ' + JSON.stringify(upA) + '）')
    assert(/^assets\/\d{8}-\d{6}-.+\.png$/.test(upA.file), '返回 assets/<ts>-<名>.png（实得 ' + upA.file + '）')
    assert(upA.name.indexOf('界面截图') >= 0, '中文名保留（实得 ' + upA.name + '）')
    assert.strictEqual(upA.bytes, pngBytes6.length, 'bytes = 解码后字节数')
    assert.strictEqual(store6.get(NOTES_DIR + '\\assets\\' + upA.name), pngB64_6, '磁盘内容 = base64 文本形态')
    // 同秒同名第二张 → -2 序号（tsStamp 秒级前缀确定性碰撞）
    upB = await handlers6['notes-asset-upload']({ name: '界面截图.png', data: 'data:image/png;base64,' + pngB64_6, mime: 'image/png' })
    assert(!upB.error && upB.name !== upA.name, '同秒同名应改名（实得 ' + (upB && upB.name) + '）')
    assert(/-2\.png$/.test(upB.name), '重名追加 -2 序号（实得 ' + upB.name + '）')
    assert.strictEqual(store6.get(NOTES_DIR + '\\assets\\' + upB.name), pngB64_6, 'dataURL 前缀剥离后内容一致')
    // noteId 可空（通用资产）；传入也不影响落盘；jpeg → .jpg 扩展名以 mime 为准
    const upC = await handlers6['notes-asset-upload']({ noteId: 'n-not-exist', name: 'photo.jpeg', data: pngB64_6, mime: 'image/jpeg' })
    assert(!upC.error && /\.jpg$/.test(upC.name), 'jpeg → .jpg 扩展名（mime 为准，实得 ' + upC.name + '）')
  })
  await t('assets/ 不被当笔记枚举（列表/搜索不受污染）', async () => {
    const l = await handlers6['notes-list']({})
    assert(l.notes.every(n => n.id && String(n.id).indexOf('assets') < 0), '列表无 assets 伪笔记')
    const s = await handlers6['notes-search']({})
    assert.strictEqual(s.notes.length, l.notes.length, '搜索与列表同口径（实得 ' + s.notes.length + '）')
  })
  await t('notes-export 连带 assets/ 快照（逐字节一致）', async () => {
    const r = await handlers6['notes-export']({ dir: 'D:\\exp-assets' })
    assert(!r.error && r.assets === 3, '导出含 3 个资产（实得 ' + JSON.stringify(r) + '）')
    for (const nm of [upA.name, upB.name]) {
      assert.strictEqual(store6.get(r.target + '\\assets\\' + nm), pngB64_6, '快照资产逐字节一致：' + nm)
    }
  })
  await t('notes-import 合并 assets（同名跳过）+ 备份连带 assets', async () => {
    const ex = await handlers6['notes-export']({ dir: 'D:\\exp-assets' })
    // 快照里塞一个库内不存在的新资产（模拟外部带入）
    store6.set(ex.target + '\\assets\\20260101-000000-extra.png', 'QUJD')
    const r = await handlers6['notes-import']({ dir: ex.target })
    assert(!r.error, '导入成功（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.assetsMerged, 1, '仅新资产入库，同名 3 个跳过')
    assert.strictEqual(store6.get(NOTES_DIR + '\\assets\\20260101-000000-extra.png'), 'QUJD', '新资产内容落盘')
    assert.strictEqual(store6.get(NOTES_DIR + '\\assets\\' + upA.name), pngB64_6, '同名资产未被覆盖')
    // 备份连带：导入前的库内 assets（3 个）进入 notes-backup-<ts>\assets\
    const bakAssets = Array.from(store6.keys()).filter(k => k.indexOf(r.backupDir + '\\assets\\') === 0)
    assert.strictEqual(bakAssets.length, 3, '备份含库内 3 个资产（实得 ' + bakAssets.length + '）')
  })

  // --- 0.4.3 验收修复⑤（notes-043-metrics-storage）：遥测 sidecar telemetry.json 导出/备份/导入合并 ---
  await t('遥测 sidecar：导出/备份连带 telemetry.json + 导入计数并入冲突取大 + 二次导入幂等零变化', async () => {
    await handlers6['notes-recall-stats']({})   // 读前落账：防抖窗口内内存增量 flush 到盘（本节前 notes-get 已有 get 事件）
    const localRaw = store6.get(NOTES_DIR + '\\telemetry.json')
    assert(localRaw, '前置：本地 telemetry.json 已存在（get 事件落账）')
    const local = JSON.parse(localRaw)
    assert(local.version === 1 && local.receipts && local.byDay, '本地遥测结构 {version,receipts,byDay} 齐备')
    // ⑧导出连带：快照含 telemetry.json 且逐字节一致 + 返回 telemetry=true
    const ex = await handlers6['notes-export']({ dir: 'D:\\exp-telem' })
    assert(!ex.error && ex.telemetry === true, '导出返回 telemetry=true（实得 ' + JSON.stringify(ex).slice(0, 160) + '）')
    assert.strictEqual(store6.get(ex.target + '\\telemetry.json'), store6.get(NOTES_DIR + '\\telemetry.json'), '快照 telemetry.json 与库内逐字节一致')
    // 冲突取大：快照内某 get 日桶计数调到本地 +5（导入数据并入，同键取大）
    const snap = JSON.parse(store6.get(ex.target + '\\telemetry.json'))
    const dayKey = Object.keys(snap.byDay.get || {})[0]
    assert(dayKey, '前置：快照含 get 日聚合桶')
    const idKey = Object.keys(snap.byDay.get[dayKey])[0]
    const baseCnt = local.byDay.get[dayKey][idKey]
    snap.byDay.get[dayKey][idKey] = baseCnt + 5
    snap.receipts.mount.push({ ts: '2026-10-01T00:00:00.000Z', ids: ['n-ext-telemetry'], session: 'ext' })   // 外部新回执（并集并入）
    // 卡⑧（notes-043-stats-unify）：facets.use 导入并入 fixture——外部库带入更高总计数（同键取大）
    if (!snap.facets || typeof snap.facets !== 'object') snap.facets = {}
    if (!snap.facets.use || typeof snap.facets.use !== 'object') snap.facets.use = {}
    snap.facets.use[idKey] = baseCnt + 9
    store6.set(ex.target + '\\telemetry.json', JSON.stringify(snap))
    const im = await handlers6['notes-import']({ dir: ex.target })
    assert(!im.error && im.telemetryMerged === true, '导入合并遥测（telemetryMerged=true；实得 ' + JSON.stringify(im).slice(0, 160) + '）')
    assert(store6.has(im.backupDir + '\\telemetry.json'), '⑧导入前全量备份连带 telemetry.json')
    const merged = JSON.parse(store6.get(NOTES_DIR + '\\telemetry.json'))
    assert.strictEqual(merged.byDay.get[dayKey][idKey], baseCnt + 5, '计数并入冲突取大（本地 ' + baseCnt + ' vs 导入 ' + (baseCnt + 5) + ' → 取大）')
    assert(merged.receipts.mount.some(r => (r.ids || []).indexOf('n-ext-telemetry') >= 0), '外部回执并集并入（receipts 签名去重）')
    assert(merged.facets && merged.facets.use && merged.facets.use[idKey] === baseCnt + 9, '⑧facets.use 并入同键取大（useCount facet 换机器不丢；实得 ' + JSON.stringify((merged.facets || {}).use) + '）')
    // 幂等：同一快照二次导入零变化（并集/取大均幂等）
    const im2 = await handlers6['notes-import']({ dir: ex.target })
    assert(!im2.error && im2.telemetryMerged === false, '⑧二次导入幂等零变化（telemetryMerged=false）')
    const again = JSON.parse(store6.get(NOTES_DIR + '\\telemetry.json'))
    assert.strictEqual(again.byDay.get[dayKey][idKey], baseCnt + 5, '二次导入计数不变（不双计）')
    assert.strictEqual(again.receipts.mount.filter(r => (r.ids || []).indexOf('n-ext-telemetry') >= 0).length, 1, '外部回执不重复并入')
    assert.strictEqual(again.facets.use[idKey], baseCnt + 9, '⑧二次导入 facets.use 不变（取大幂等不双计）')
  })

  // --- 旧结构零回归（无 assets/ 的旧库 + 无 assets 的旧导出，全新实例） ---
  const store8 = new Map()
  const fsMock8 = mkFsMockImp(store8, [NOTES_DIR])
  const handlers8 = {}
  const harnessMock8 = { handle: (name, fn) => { handlers8[name] = fn; return () => { delete handlers8[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock8, DIR).apply({
    fs: fsMock8, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('旧结构零回归：无 assets/ 旧库导出 assets=0；无 assets 旧导出导入 assetsMerged=0', async () => {
    await handlers8['notes-create']({ title: '旧库笔记', body: '无图', topic: '旧' })
    const ex = await handlers8['notes-export']({ dir: 'D:\\exp-old' })
    assert(!ex.error && ex.exported === 2 && ex.assets === 0, '旧库导出正常且 assets=0（1 种子 + 索引）（实得 ' + JSON.stringify(ex) + '）')
    assert(!Array.from(store8.keys()).some(k => k.indexOf(ex.target + '\\assets') === 0), '快照不产生 assets 目录')
    // 手工构造无 assets/ 的旧导出目录（仅 n-*.md + folders.json，模拟旧版本导出物）
    const oldExp = 'D:\\exp-old-snap'
    store8.set(oldExp + '\\n-old0001.md', '---\nid: n-old0001\ntitle: 旧导出笔记甲\ntopic: 旧\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文甲\n')
    store8.set(oldExp + '\\n-old0002.md', '---\nid: n-old0002\ntitle: 旧导出笔记乙\ntopic: 旧\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文乙\n')
    store8.set(oldExp + '\\folders.json', JSON.stringify([{ id: 'f-old01', name: '旧导出夹', order: 0 }]))
    const im = await handlers8['notes-import']({ dir: oldExp })
    assert(!im.error && im.assetsMerged === 0, '旧导出导入 assetsMerged=0（实得 ' + JSON.stringify(im) + '）')
    assert.strictEqual(im.imported, 2, '旧导出 2 条笔记全部 added 入库')
    assert.strictEqual(im.foldersMerged, 1, '旧导出 folders 正常合并')
    const l = await handlers8['notes-list']({})
    assert(l.notes.some(n => n.id === 'n-old0001'), '旧导出笔记正常入库可列表')
    // 上传是纯增量：资产存在后列表计数不变
    const before = l.notes.length
    const up = await handlers8['notes-asset-upload']({ name: 'x.png', data: pngB64_6, mime: 'image/png' })
    assert(!up.error, '旧库上传成功')
    const l2 = await handlers8['notes-list']({})
    assert.strictEqual(l2.notes.length, before, '上传资产不影响笔记列表')
  })
  Object.assign(S, { mkFsMockImp })
  }
}
