// 节 23.5 笔记导入/导出（静态包 index.mjs 行为）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "23.5",
  title: "23.5 笔记导入/导出（静态包 index.mjs 行为）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_ROOT_STATIC, agentsMock, g, mkFsMockImp, store } = S
  // --- 静态包行为（index.mjs 独立 ESM 实例 + 独立 store；harness 主通道注册 handlers7） ---
  section('23.5 笔记导入/导出（静态包 index.mjs 行为）')
  const store7 = new Map()
  const fsMock7 = mkFsMockImp(store7, [NOTES_ROOT_STATIC])
  const handlers7 = {}
  const harnessMock7 = { handle: (name, fn) => { handlers7[name] = fn; return () => { delete handlers7[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const pngB64_7 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64')
  await t('静态包导入/导出全链路（导出 → 预览分类 → 备份 → 默认跳过 diff → overwrite 覆盖 → folders 合并）', async () => {
    global.harness = harnessMock7
    try {
      const modImp = await import(pathToFileURL(INDEX_PATH).href + '?impexp=1')
      modImp.apply({
        fs: fsMock7, sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
        effect: () => {},
      })
      assert.strictEqual(Object.keys(handlers7).length, 48, '静态包注册 48 个 RPC（47 + notes-ping；47 含工作记忆 notes-memory-guide + 定时派发 notes-schedule-eval + N+1 批量 notes-get-batch + 图查询 notes-graph + 注入索引 notes-mount/notes-mount-list + 效用账本 notes-ledger-refresh + 召回遥测 notes-recall-stats + whenToUse 草稿 notes-when-suggest），实得 ' + Object.keys(handlers7).length)
      assert(typeof handlers7['notes-when-suggest'] === 'function', '静态包 notes-when-suggest handler 存在（0.4.3 验收修复 notes-043-preview-when-edit）')
      assert(typeof handlers7['notes-recall-stats'] === 'function', '静态包 notes-recall-stats handler 存在（0.4.3+ 卡⑫ 统一召回遥测，notes-043-inject-receipt）')
      assert(typeof handlers7['notes-ledger-refresh'] === 'function', '静态包 notes-ledger-refresh handler 存在（0.4.3⑥ 效用账本，notes-043-ledger）')
      assert(typeof handlers7['notes-graph'] === 'function', '静态包 notes-graph handler 存在（0.4.3 内核① 图查询，notes-043-graph）')
      assert(typeof handlers7['notes-get-batch'] === 'function', '静态包 notes-get-batch handler 存在（N+1 批量端点，notes-034-batch3）')
      assert(typeof handlers7['notes-schedule-eval'] === 'function', '静态包 notes-schedule-eval handler 存在（定时派发·执行层）')
      const sA = await handlers7['notes-create']({ title: '静态导出A', body: 'SA正文' })
      const sB = await handlers7['notes-create']({ title: '静态导出B', body: 'SB正文' })
      await handlers7['notes-folders']({ op: 'create', name: '静态夹' })
      // 导出
      const ex = await handlers7['notes-export']({ dir: 'D:\\exp-st' })
      assert(!ex.error && ex.exported === 3 && ex.foldersFile === true, '导出 3 条（2 种子 + 注入索引）+ folders.json（实得 ' + JSON.stringify(ex) + '）')
      assert(/\\dsh-notes-export-\d{8}-\d{6}$/.test(ex.target), '静态包导出目录命名一致（path.join）')
      assert.strictEqual(store7.get(path.join(ex.target, sA.id + '.md')), store7.get(path.join(NOTES_ROOT_STATIC, sA.id + '.md')), '快照逐字节一致')
      // 预览基线全 same
      const p0 = await handlers7['notes-import-preview']({ dir: ex.target })
      assert(p0.same === 3 && p0.diff === 0 && p0.added === 0 && p0.folders.new === 0, '预览基线全 same（2 种子 + 注入索引）')
      // 混合场景：B 改动 + 新增 + 新文件夹
      store7.set(path.join(ex.target, sB.id + '.md'), store7.get(path.join(ex.target, sB.id + '.md')) + '静态改动')
      store7.set(path.join(ex.target, 'n-stnew01.md'), '---\nid: n-stnew01\ntitle: 静态新入\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"\n---\n\n新\n')
      const fArr = JSON.parse(store7.get(path.join(ex.target, 'folders.json')))
      fArr.push({ id: 'f-stimp01', name: '静态新夹', order: 9 })
      store7.set(path.join(ex.target, 'folders.json'), JSON.stringify(fArr))
      const p1 = await handlers7['notes-import-preview']({ dir: ex.target })
      assert(p1.same === 2 && p1.diff === 1 && p1.added === 1 && p1.folders.new === 1, '预览分类：1 same / 1 diff / 1 added / 1 新文件夹（实得 ' + JSON.stringify({ s: p1.same, d: p1.diff, a: p1.added, f: p1.folders }) + '）')
      // 默认导入：备份 + added 入库 + diff 跳过 + folders 合并
      const im = await handlers7['notes-import']({ dir: ex.target })
      assert(im.imported === 1 && im.skippedSame === 2 && im.skippedDiff === 1 && im.overwritten === 0 && im.foldersMerged === 1, '默认导入计数（实得 ' + JSON.stringify(im) + '）')
      assert(/\\notes-backup-\d{8}-\d{6}$/.test(im.backupDir), '备份目录命名一致')
      assert(store7.get(path.join(im.backupDir, sB.id + '.md')).indexOf('静态改动') < 0, '备份保留导入前 B 原文')
      assert(store7.has(path.join(NOTES_ROOT_STATIC, 'n-stnew01.md')), '新笔记入库')
      assert(store7.get(path.join(NOTES_ROOT_STATIC, sB.id + '.md')).indexOf('静态改动') < 0, 'diff 默认跳过')
      const onDisk = JSON.parse(store7.get(path.join(NOTES_ROOT_STATIC, 'folders.json')))
      const nf = onDisk.find(f => f.id === 'f-stimp01')
      assert(onDisk.length === 2 && nf && nf.order === 1, 'folders 合并只增不删 + order 续排（实得 ' + JSON.stringify(onDisk) + '）')
      // overwrite 覆盖
      const im2 = await handlers7['notes-import']({ dir: ex.target, overwrite: true })
      assert(im2.overwritten === 1 && im2.skippedSame === 3, 'overwrite 覆盖 1 条 diff（same 含注入索引）（实得 ' + JSON.stringify(im2) + '）')
      assert(store7.get(path.join(NOTES_ROOT_STATIC, sB.id + '.md')).indexOf('静态改动') >= 0, '覆盖生效')
      const g = await handlers7['notes-get']({ id: sB.id })
      assert(g.note.body.indexOf('静态改动') >= 0, '缓存同步覆盖后内容')
      // 校验
      const bad = await handlers7['notes-import']({ dir: 'D:\\no-such-static-dir' })
      assert(bad.error && bad.error.indexOf('目录不存在') >= 0, '静态包目录不存在报错')
      // 图片资产连带：上传 → 导出含 assets → 导入合并同名跳过 → 备份含 assets
      const up = await handlers7['notes-asset-upload']({ name: '静态图.png', data: pngB64_7, mime: 'image/png' })
      assert(!up.error && /^assets\/\d{8}-\d{6}-.+\.png$/.test(up.file), '静态包上传落盘（实得 ' + JSON.stringify(up) + '）')
      assert.strictEqual(store7.get(path.join(NOTES_ROOT_STATIC, 'assets', up.name)), pngB64_7, '磁盘为 base64 文本形态')
      const ex2 = await handlers7['notes-export']({ dir: 'D:\\exp-st2' })
      assert(!ex2.error && ex2.assets === 1, '静态包导出连带 1 个资产（实得 ' + JSON.stringify(ex2) + '）')
      assert.strictEqual(store7.get(path.join(ex2.target, 'assets', up.name)), pngB64_7, '快照资产逐字节一致')
      // 0.4.3 验收修复⑤：静态包导出连带遥测 sidecar（上行 notes-get 已产生 get 事件；export 内 _telemetryFlushNow 落账后复制）
      assert(ex2.telemetry === true, '静态包导出连带 telemetry.json（telemetry=true；实得 ' + JSON.stringify(ex2).slice(0, 160) + '）')
      const telemSnap = JSON.parse(store7.get(path.join(ex2.target, 'telemetry.json')))
      assert(telemSnap.version === 1 && telemSnap.byDay && telemSnap.byDay.get, '静态包遥测快照结构 version/byDay.get 齐备')
      store7.set(path.join(ex2.target, 'assets', '20260101-000000-stextra.png'), 'QUJD')
      const im3 = await handlers7['notes-import']({ dir: ex2.target })
      assert(!im3.error && im3.assetsMerged === 1, '静态包导入合并新资产、同名跳过（实得 ' + JSON.stringify(im3) + '）')
      assert.strictEqual(store7.get(path.join(NOTES_ROOT_STATIC, 'assets', '20260101-000000-stextra.png')), 'QUJD', '新资产入库')
      const bakA = Array.from(store7.keys()).filter(k => k.indexOf(path.join(im3.backupDir, 'assets') + '\\') === 0)
      assert.strictEqual(bakA.length, 1, '静态包备份连带 assets（实得 ' + bakA.length + '）')
      // 静态包上传校验同口径：mime 白名单 + 5MB 上限
      const e1 = await handlers7['notes-asset-upload']({ name: 'x.gif', data: pngB64_7, mime: 'image/tiff' })
      assert(e1.error && e1.error.indexOf('mime') >= 0, '静态包 mime 白名单拒绝')
      const e2 = await handlers7['notes-asset-upload']({ name: 'big.png', data: 'A'.repeat(7 * 1024 * 1024 + 4), mime: 'image/png' })
      assert(e2.error && e2.error.indexOf('5MB') >= 0, '静态包超 5MB 拒绝')
    } finally {
      delete global.harness
    }
  })
  }
}
