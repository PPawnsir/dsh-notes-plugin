// 节 76. 0.4.3 存储加固：笔记写入原子化 + per-note 串行化链 + sys 常驻语义（notes-043-atomic-store）
// 裁决口径（主窗口 2026-10-05）：DSH fs.writeText 底层已是 writeFileAtomic（staging 目录 + temp 文件 + fsync + rename 发布，
//   按 targetKey 加锁），插件层「tmp+rename」字面方案不可实现且多余——不扩展 fs 契约、不直连 node fs（沙箱边界红线）。
//   落地为 ①persistNote per-note 串行化链 ②storage 层原子性委托 + sys 常驻语义声明注释 ③本节崩溃恢复断言。
// 崩溃语义建模（断言口径）：写入中途进程死亡 ⇔ writeFileAtomic 的 temp 已落、rename 未发布 —— 目标 .md 保持完整旧版字节
//   （绝无半写中间字节），内存 cache 不被坏值污染；「重启」= 同一磁盘 store 上新建 host 实例（cache 从零，全部读盘）。
module.exports = {
  id: "76",
  title: "76. 存储加固：persistNote per-note 串行化链 + 原子性委托声明 + 崩溃恢复断言（notes-043-atomic-store）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { handlers, fsMock, store, NOTES_DIR, llmMock, admMock, agentsMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('76. 存储加固：persistNote per-note 串行化链 + 原子性委托声明 + 崩溃恢复断言（notes-043-atomic-store）')

  const notePath = (id) => NOTES_DIR + '\\' + id + '.md'
  const diskOf = (id) => store.get(notePath(id))
  // 「重启」模拟：同一 fsMock/store（盘上字节跨重启不变）上新建 host 实例 —— cache 从零，一切读盘重建
  function newInstance() {
    const hs = {}
    new Function('harness', 'pluginDir', hostSrc)(
      { handle: (n, f) => { hs[n] = f; return () => {} }, defineTool: (d) => d, registerTool: () => () => {} },
      DIR
    ).apply({
      fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return hs
  }

  // ---- 76.0 落地结构：per-note 串行化链双包标记 + 原子性/常驻声明注释锚（构建产物同步）----
  await t('per-note 串行化链标记块双包逐字节一致（kernel/persist.js ⇄ persist.dist.js）+ 构建产物锚点', () => {
    const dev = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'persist.js'), 'utf8')
    const dist = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'persist.dist.js'), 'utf8')
    // 双包唯一差异 = 路径口径一行（dev 用 NOTES_DIR 字面拼接 / dist 用 noteFile() 归一），归一后须逐字节一致
    const norm = (s) => String(s).replace(/\r\n/g, '\n').replace(/await fs\.resolve\([^\n]+\)/, 'await fs.resolve(<PATH>)')
    assert.strictEqual(norm(dev), norm(dist), 'persist.js ⇄ persist.dist.js 归一后逐字节一致（串行化链双包同源）')
    for (const [src, tag] of [[dev, 'persist.js'], [dist, 'persist.dist.js'], [hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('const _persistChains = Object.create(null)') >= 0, tag + ' per-note 链注册表在位')
      assert(src.indexOf('async function _persistNoteInner(n, opts)') >= 0, tag + ' 写入内联函数在位（串行链体）')
      assert(src.indexOf('_persistChains[n.id] = run.then(') >= 0, tag + ' 失败不断链接线在位')
      assert(src.indexOf('writeFileAtomic') >= 0 && src.indexOf('targetKey') >= 0, tag + ' 原子性委托声明注释（fs.writeText 底层 writeFileAtomic + targetKey 锁）')
      assert(src.indexOf('tmp+rename') >= 0, tag + ' 红线声明：插件层不叠加 tmp+rename')
      assert(src.indexOf('常驻') >= 0, tag + ' cache 常驻语义声明')
    }
    // storage 层（store-cache 双包）声明注释同步：原子性委托 + 常驻权威 + sys 常驻语义（系统根笔记无特例写路径）
    for (const f of ['store-cache.js', 'store-cache.dist.js']) {
      const sc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', f), 'utf8')
      assert(sc.indexOf('写入原子性委托 DSH fs 服务 writeText') >= 0, 'kernel/' + f + ' 原子性委托声明注释在位')
      assert(sc.indexOf('cache 为常驻权威') >= 0, 'kernel/' + f + ' cache 常驻权威声明在位')
      assert(sc.indexOf('sys 常驻语义') >= 0, 'kernel/' + f + ' sys 常驻语义声明在位（系统根笔记无特例写路径）')
    }
    // 磁盘字节 → cache 字段口径同源：双包 noteFromParsed 读取的 front-matter 键集必须逐键一致
    // （变体片允许路径/删除通道等设计内差异，但不允许「同一份盘上字节在一个出口被读回、在另一个出口被静默丢弃」——
    //   丢字段 = 重启后常驻语义与盘上不一致，属存储层保真红线）
    const metaKeys = (src) => Array.from(new Set(String(src).match(/p\.meta\.[A-Za-z]+/g) || [])).sort().join(',')
    const kDev = metaKeys(fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'store-cache.js'), 'utf8'))
    const kDist = metaKeys(fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'store-cache.dist.js'), 'utf8'))
    const onlyDev = kDev.split(',').filter(k => kDist.indexOf(k) < 0)
    const onlyDist = kDist.split(',').filter(k => kDev.indexOf(k) < 0)
    assert.strictEqual(kDev, kDist, 'store-cache 双包 noteFromParsed 读取的 front-matter 键集一致（dev 独有：' + (onlyDev.join('/') || '无') + '；dist 独有：' + (onlyDist.join('/') || '无') + '）')
    // slim（列表/RPC 瘦身）双包字段口径同源：列表瘦身丢字段 = 前端/工具看不到盘上真实存在的字段
    for (const [pf, tag] of [['persist.js', 'persist.js'], ['persist.dist.js', 'persist.dist.js']]) {
      const ps = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', pf), 'utf8')
      assert(ps.indexOf('refNote: n.refNote') >= 0, tag + ' slim 透出 refNote（列表瘦身不丢结构化软链字段）')
    }
  })

  // ---- 76.1 半写恢复：目标笔记写失败（等价 writeFileAtomic rename 未发布）→ 盘上完整旧版 + 重启读回旧版 + 重试落全量新版 ----
  const origWrite = fsMock.writeText
  await t('崩溃恢复·半写：目标笔记写失败（RPC 报错）→ 盘上保持完整旧版 + 重启读回完整旧版；重试落全量新版', async () => {
    const U1 = await handlers['notes-create']({ title: '加固·半写样本', body: 'V1 正文', topic: '加固' })
    assert(U1 && U1.id, '样本创建成功')
    const oldDisk = diskOf(U1.id)
    assert(oldDisk && oldDisk.indexOf('V1 正文') >= 0, '旧版全文已在盘上（前置）')
    // 崩溃注入：只让「目标笔记文件」的写入失败（历史快照等其它写放行）——半写语义 = temp 已落、rename 未发布
    let crashed = 0
    fsMock.writeText = async function (p, c) {
      if (String(p).indexOf('.history') < 0 && String(p) === notePath(U1.id)) { crashed++; throw new Error('ECRASH: 半写注入') }
      return origWrite(p, c)
    }
    try {
      const r = await handlers['notes-update']({ id: U1.id, body: 'V2 新正文' })
      assert(r && String(r.error || '').indexOf('ECRASH') >= 0, '写入失败经 RPC 契约原样上报（实得：' + JSON.stringify(r) + '）')
      assert(crashed >= 1, '崩溃注入命中目标笔记写路径（在飞次数 ' + crashed + '）')
      assert(store.get(notePath(U1.id)) === oldDisk, '盘上保持完整旧版（原子性：无半写中间字节）')
      const cached = await handlers['notes-get']({ id: U1.id })
      assert(cached.note && cached.note.body === 'V1 正文', '缓存未被坏值污染（实得：' + String(cached.note && cached.note.body).slice(0, 40) + '）')
      // 重启恢复：新实例 cache 从零 → 盘上仍是完整 V1（半写不可见，无残页）
      // 读盘正文口径：节 77（notes-043-fm-newline）起 front-matter 往返幂等——读盘正文逐字节等于落盘前正文，
      //   不再带前导换行；旧「去前导换行归一」绕行已消除，此处严格比对。
      const H2 = newInstance()
      const after = await H2['notes-get']({ id: U1.id })
      assert(after.note && after.note.body === 'V1 正文', '崩溃重启后读回完整旧版（半写不可见，严格逐字节，实得：' + JSON.stringify(after.note && after.note.body) + '）')
      // 恢复写入：解除注入 → 完整新版一次性替换旧版
      fsMock.writeText = origWrite
      const ok = await handlers['notes-update']({ id: U1.id, body: 'V2 新正文' })
      assert(ok && !ok.error, '解除注入后重试成功（实得：' + JSON.stringify(ok) + '）')
      assert(store.get(notePath(U1.id)).indexOf('V2 新正文') >= 0, '重试后盘上为完整新版')
      assert(store.get(notePath(U1.id)).indexOf('V1 正文') < 0, '新版完整替换旧版（无残页拼接）')
    } finally { fsMock.writeText = origWrite }
  })

  // ---- 76.2 墓碑恢复：软删墓碑落盘后跨重启不复活 + 删除写失败时盘上仍存活态 + 恢复翻转 ----
  await t('崩溃恢复·墓碑：软删墓碑落盘后重启不复活 + 删除写失败时盘上仍存活态 + 恢复翻转 deleted:false', async () => {
    const T1 = await handlers['notes-create']({ title: '加固·墓碑样本', body: '墓碑正文', topic: '加固' })
    assert(T1 && T1.id, '墓碑样本创建成功')
    // 删除写失败 → 原子性保证：盘上完整存活态（不落半截墓碑），重启后仍存活
    fsMock.writeText = async function (p, c) {
      if (String(p).indexOf('.history') < 0 && String(p) === notePath(T1.id)) throw new Error('ECRASH: 删除写中断')
      return origWrite(p, c)
    }
    try {
      const dr = await handlers['notes-delete']({ id: T1.id })
      assert(dr && String(dr.error || '').indexOf('ECRASH') >= 0, '删除写失败经 RPC 契约原样上报（实得：' + JSON.stringify(dr) + '）')
      assert(diskOf(T1.id).indexOf('deleted: true') < 0, '失败删除不落半截墓碑（盘上仍存活态）')
      const H3 = newInstance()
      assert(((await H3['notes-list']({})).notes || []).some(n => n.id === T1.id), '失败删除后重启仍存活（误删不发生）')
    } finally { fsMock.writeText = origWrite }
    // 成功删除 → 墓碑落盘 → 缺省列表隐藏 + 跨重启不复活（回收站通道可达）
    const del = await handlers['notes-delete']({ id: T1.id })
    assert(del && !del.error, '删除成功（实得：' + JSON.stringify(del) + '）')
    assert(diskOf(T1.id).indexOf('deleted: true') >= 0, '墓碑 deleted:true 落盘')
    const H4 = newInstance()
    assert(!((await H4['notes-list']({})).notes || []).some(n => n.id === T1.id), '墓碑跨重启在缺省列表隐藏（不复活）')
    const got = await H4['notes-get']({ id: T1.id, includeDeleted: true })
    assert(got.note && got.note.deleted === true, '墓碑跨重启可达（includeDeleted 回收站通道）')
    // 恢复：墓碑翻转回 false 并落盘，重启后列表可见
    await handlers['notes-restore']({ id: T1.id })
    assert(diskOf(T1.id).indexOf('deleted: true') < 0 && diskOf(T1.id).indexOf('deleted: false') >= 0, '恢复后墓碑翻转 deleted:false 落盘')
    const H5 = newInstance()
    assert(((await H5['notes-list']({})).notes || []).some(n => n.id === T1.id), '恢复结果跨重启可见')
  })

  // ---- 76.3 per-note 写链串行化（无重叠在飞写）+ 并发双 append 两行都在（跨重启仍在）----
  await t('per-note 写链串行化：同笔记并发写零重叠在飞 + 并发双 append 两行都在（重启后仍在）', async () => {
    // 前置：先建索引笔记（单线），避免并发首建本身引入重复创建（本节只测「同笔记读-改-写」串行化）
    // 【历史边界记录 → 已修复收口】并发首建竞态（索引不存在时两个并发 notes-mount 各建一篇「注入索引（自动）」，
    //   两调用都 ok:true 但 indexNoteId 只剩其一，盘上孤儿索引文件）——已由节 79（notes-043-ensure-lock）修复：
    //   rootnote.js rootNoteCreateLock 创建级锁把 idxEnsure「存在性检查 → 创建 → 回写」窗口串行化（锁内双检复用前者产物）。
    //   本节前置单线建索引的规避写法保留——两节断言面正交（本节 = 同 id 读-改-写串行化；节 79 = 创建窗口串行化）。
    const C = await handlers['notes-create']({ title: '加固·并发锚点', body: 'C', topic: '记忆' })
    const cMount = await handlers['notes-mount']({ id: C.id, whenToUse: '并发前置行' })
    assert(cMount && cMount.ok && cMount.indexNoteId, '索引笔记前置创建成功（实得：' + JSON.stringify(cMount) + '）')
    const idxId = cMount.indexNoteId
    const A = await handlers['notes-create']({ title: '加固·并发A', body: 'A', topic: '记忆' })
    const B = await handlers['notes-create']({ title: '加固·并发B', body: 'B', topic: '记忆' })
    assert(A && A.id && B && B.id, '并发样本创建成功（实得：' + JSON.stringify([A, B]) + '）')
    // 在飞写探针：按目标路径统计并发在飞写次数（无 per-note 链时同笔记并发写必然重叠 → maxInflight ≥ 2）
    const inflight = new Map()
    const maxInflight = new Map()
    fsMock.writeText = async function (p, c) {
      const k = String(p)
      const cur = (inflight.get(k) || 0) + 1
      inflight.set(k, cur)
      if (cur > (maxInflight.get(k) || 0)) maxInflight.set(k, cur)
      try {
        await new Promise(r => setTimeout(r, 0))   // 放大在飞窗口：写入真实耗时
        return await origWrite(p, c)
      } finally { inflight.set(k, cur - 1) }
    }
    try {
      // (a) 同一笔记并发两次「读-改-写」更新（各持独立副本，不同正文）→ 写链串行化：目标文件零重叠在飞
      await Promise.all([
        handlers['notes-update']({ id: A.id, body: 'A 并发①' }),
        handlers['notes-update']({ id: A.id, body: 'A 并发②' }),
      ])
      const overlapA = maxInflight.get(notePath(A.id)) || 0
      assert.strictEqual(overlapA, 1, '同笔记并发写目标文件最大在飞数 = 1（per-note 链串行化，实得 ' + overlapA + '）')
      const ga = await handlers['notes-get']({ id: A.id })
      assert(['A 并发①', 'A 并发②'].indexOf(ga.note.body) >= 0, '并发写结果 = 完整单版（无撕裂/无拼接，实得：' + ga.note.body + '）')
      assert.strictEqual(ga.note.body, 'A 并发②', '串行链按调用序落盘（后写者胜，确定性：实得 ' + ga.note.body + '）')
      // (b) 同一索引笔记并发双 append（A/B 两行读-改-写）→ 写链保证两行都在且各恰一行
      const [ma, mb] = await Promise.all([
        handlers['notes-mount']({ id: A.id, whenToUse: '并发竞态回归A' }),
        handlers['notes-mount']({ id: B.id, whenToUse: '并发竞态回归B' }),
      ])
      assert(ma.ok && mb.ok, '并发双挂载均成功（实得：' + JSON.stringify([ma, mb]) + '）')
      assert.strictEqual(ma.indexNoteId, idxId, '两次挂载落同一索引笔记（同一目标笔记竞态前提）')
      assert.strictEqual(mb.indexNoteId, idxId, '两次挂载落同一索引笔记（同一目标笔记竞态前提）')
      const idxOverlap = maxInflight.get(notePath(idxId)) || 0
      assert.strictEqual(idxOverlap, 1, '索引笔记并发写最大在飞数 = 1（同一目标笔记读-改-写串行化，实得 ' + idxOverlap + '）')
      const body1 = (await handlers['notes-get']({ id: idxId })).note.body
      const cnt = (id) => body1.split('\n').filter(l => l.indexOf('[[' + id + ']]') >= 0).length
      assert.strictEqual(cnt(A.id), 1, 'A 行恰 1 行（实得 ' + cnt(A.id) + '）')
      assert.strictEqual(cnt(B.id), 1, 'B 行恰 1 行（实得 ' + cnt(B.id) + '）')
      assert.strictEqual(cnt(C.id), 1, '前置行未被并发写冲掉（实得 ' + cnt(C.id) + '）')
      // (d) 跨重启：并发 append 的合并结果已落盘（新实例 cache 从零读回同一合并序）
      // 注意口径：挂载行联动是「更新即摘行」（_idxSyncMount），故重启核对必须在后续 notes-update 之前做。
      const H6 = newInstance()
      const body2 = String((await H6['notes-get']({ id: idxId })).note.body)
      assert.strictEqual(body2, body1, '并发 append 结果跨重启逐字节不变（合并序已原子落盘；节 77 起往返幂等，严格比对无归一绕行）')
      const cnt2 = (id) => body2.split('\n').filter(l => l.indexOf('[[' + id + ']]') >= 0).length
      assert.strictEqual(cnt2(A.id), 1, '重启后 A 行仍恰 1 行（实得 ' + cnt2(A.id) + '）')
      assert.strictEqual(cnt2(B.id), 1, '重启后 B 行仍恰 1 行（实得 ' + cnt2(B.id) + '）')
      // (c) 跨笔记并发写仍并行（串行化按 note id 分道，不误伤跨笔记吞吐）
      await Promise.all([
        handlers['notes-update']({ id: A.id, body: 'A 更新后' }),
        handlers['notes-update']({ id: B.id, body: 'B 更新后' }),
      ])
      assert((await handlers['notes-get']({ id: A.id })).note.body === 'A 更新后', 'A 跨笔记并发写完整落位')
      assert((await handlers['notes-get']({ id: B.id })).note.body === 'B 更新后', 'B 跨笔记并发写完整落位')
      assert.strictEqual(maxInflight.get(notePath(A.id)), 1, '跨笔记并发不改变 A 的单道串行（实得 ' + maxInflight.get(notePath(A.id)) + '）')
      assert.strictEqual(maxInflight.get(notePath(idxId)), 1, '索引笔记全程零重叠在飞（实得 ' + maxInflight.get(notePath(idxId)) + '）')
    } finally { fsMock.writeText = origWrite }
  })
  }
}
