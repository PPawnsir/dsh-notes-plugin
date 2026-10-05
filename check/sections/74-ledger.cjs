// 节 74. 0.4.3⑥：效用账本——日志双链扫描 → §2 指标行级更新 + 记忆档案懒创建回填（notes-043-ledger）
// 行为规格（总纲 n-muufiroz67it 卡6/7）：①近 7 天日志 link 存活边聚合（只读，复用 notes-graph 全量重建）；
//   ②注入索引 §2 召回指标整节快照重写（§1 与备注区逐字节不动）；③记忆档案懒创建（refNote 软链 + 永不 inject 红线）
//   + 引用记录倒序幂等追加（日志 id 幂等键）；④schedule cron tick 顺带（evaluated>0 + 10min 节流）+ notes-ledger-refresh 手动 RPC。
module.exports = {
  id: "74",
  title: "74. 内核⑥：效用账本 §2 指标 + 记忆档案懒创建回填（notes-043-ledger）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { handlers } = S
  section('74. 内核⑥：效用账本 §2 指标 + 记忆档案懒创建回填（notes-043-ledger）')

  // ---- 74.0 落地结构：ledger.js 双清单共源 + 核心 API/RPC + cron 顺带锚点 + refNote front-matter 三处 ----
  await t('内核⑥ 落地结构：src/host/ledger.js 存在 + 双清单同名共源（无 .dist 变体）+ 序位 + 核心 API/标记块', () => {
    assert(fsNative.existsSync(path.join(DIR, 'src', 'host', 'ledger.js')), 'src/host/ledger.js 存在')
    const devM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dev.js'), 'utf8')
    const distM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dist.js'), 'utf8')
    assert(devM.indexOf("'ledger.js'") >= 0 && distM.indexOf("'ledger.js'") >= 0, '双清单同名登记 ledger.js（共源单份）')
    assert(devM.indexOf("'injectindex.js'") < devM.indexOf("'ledger.js'") && distM.indexOf("'injectindex.js'") < distM.indexOf("'ledger.js'"), '序位：injectindex.js 之后（消费索引 API）')
    assert(devM.indexOf("'ledger.js'") < devM.indexOf("'schedule.js'") && distM.indexOf("'ledger.js'") < distM.indexOf("'schedule.js'"), '序位：schedule.js 之前（cron 顺带消费）')
    assert(!fsNative.existsSync(path.join(DIR, 'src', 'host', 'ledger.dist.js')), 'ledger.js 不得出现 .dist 变体（第三份拷贝红线）')
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('==== notes-ledger BEGIN ====') >= 0 && src.indexOf('==== notes-ledger END ===='), tag + ' 含 notes-ledger 标记块')
      assert(src.indexOf('async function _ledgerScan(') >= 0 && src.indexOf('async function _ledgerRefresh(') >= 0, tag + ' 扫描/刷新 API 在位')
      assert(src.indexOf('async function _ledgerArchiveEnsure(') >= 0 && src.indexOf('function _ledgerArchiveFind(') >= 0, tag + ' 档案懒创建/查找 API 在位')
      assert(src.indexOf('LEDGER_S2_TPL = rootNoteTpl(') >= 0 && src.indexOf('LEDGER_ARCHIVE_TPL = rootNoteTpl(') >= 0, tag + ' RootNote 模板消费（§2 快照 + 引用记录幂等追加）')
      assert(src.indexOf("handle('notes-ledger-refresh'") >= 0, tag + ' notes-ledger-refresh RPC 注册')
      // 红线锚：档案永不 inject（ensure 内强制纠正）+ recall=false 懒创建
      assert(src.indexOf('if (a.inject === true)') >= 0 && src.indexOf('inject: false, recall: false') >= 0, tag + ' 永不 inject 红线锁 + recall=false')
      // 扫描只读：只消费 _graphRebuild/_list（标记块内零 LLM 通道）
      const blk = src.slice(src.indexOf('==== notes-ledger BEGIN ===='), src.indexOf('==== notes-ledger END ===='))
      assert(blk.indexOf('await _graphRebuild()') >= 0 && blk.indexOf('llm') < 0 && blk.indexOf('stream(') < 0, tag + ' 扫描复用图内核全量重建（只读、零 LLM）')
    }
    // cron 顺带接线（schedule.js 双包共源物理单份）
    const schSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'schedule.js'), 'utf8')
    assert(schSrc.indexOf("_ledgerRefresh({ trigger: 'cron' })") >= 0 && schSrc.indexOf('out.fired > 0') >= 0, 'schedule.js cron tick 顺带账本刷新（fired>0 门 + 吞异常）')
    // refNote front-matter 三处（kernel 双包共源物理单份）
    const fm = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'front-matter.js'), 'utf8')
    const sc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'store-cache.js'), 'utf8')
    assert(fm.indexOf("(m.refNote ? 'refNote: ' + escYaml(m.refNote) + '\\n' : '')") >= 0, 'buildFM 条件行 refNote')
    assert(sc.indexOf('refNote: p.meta.refNote') >= 0 && sc.indexOf('refNote: n.refNote') >= 0, 'noteFromParsed/noteFileContent refNote 往返')
  })

  // ---- 74.1 fixture 全链路：§2 指标数值 + 档案懒创建 + 近 7 天窗口过滤 ----
  const today = (function () { const d = new Date(); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
  const oldDate = (function () { const d = new Date(Date.now() - 10 * 86400000); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
  let M1, M2, L1, L2, ARCH
  await t('fixture 全链路：挂载 2 条 + 近 7 天/超窗日志各 1 → refresh → §2 数值正确 + 档案懒创建恰 1 个（refNote 软链 + 红线）', async () => {
    M1 = await handlers['notes-create']({ title: '账本记忆A', body: '记忆正文A', topic: '记忆' })
    M2 = await handlers['notes-create']({ title: '账本记忆B', body: '记忆正文B', topic: '记忆' })
    assert(M1.id && M2.id, '两条记忆创建成功')
    await handlers['notes-mount']({ id: M1.id, whenToUse: '账本 fixture 记忆A' })
    await handlers['notes-mount']({ id: M2.id, whenToUse: '账本 fixture 记忆B' })
    L1 = await handlers['notes-create']({ title: '工作日志 74 · 近窗', body: '## 相关笔记\n\n[[' + M1.id + ']] 双链引用', kind: 'log', logDate: today })
    L2 = await handlers['notes-create']({ title: '工作日志 74 · 超窗', body: '## 相关笔记\n\n[[' + M1.id + ']] 十天前旧日志', kind: 'log', logDate: oldDate })
    assert(L1.id && L2.id, '两条日志创建成功')
    const r = await handlers['notes-ledger-refresh']({})
    assert(r && r.ok === true, 'notes-ledger-refresh 成功（实得：' + JSON.stringify(r).slice(0, 160) + '）')
    assert(r.mountTotal >= 2, '挂载总数 ≥2（实得 ' + r.mountTotal + '）')
    assert(r.weekLogs === 1, '近 7 天日志恰 1 篇（超窗 L2 不计；实得 ' + r.weekLogs + '）')
    assert(r.weekRefs === 1, '本周引用恰 1 次（仅近窗 L1 引 M1；超窗 L2 不计；实得 ' + r.weekRefs + '）')
    assert(r.archivesCreated === 1, '档案懒创建恰 1 个（M1；实得 ' + r.archivesCreated + '）')
    // §2 快照：数值行 + 零引用候选含 M2 + Top5 含 M1
    const idx = await handlers['notes-get']({ id: r.indexNoteId })
    const body = idx.note.body
    assert(body.indexOf('- 挂载总数：' + r.mountTotal) >= 0, '§2 挂载总数行')
    assert(body.indexOf('[[' + M1.id + ']]×1') > body.indexOf('本周引用 Top5'), 'Top5 行含 [[M1]]×1（仅近窗引用）')
    const zeroLine = body.split('\n').filter(l => l.indexOf('零引用候选') >= 0).join('\n')
    assert(zeroLine.indexOf('[[' + M2.id + ']]') >= 0, '零引用候选行含 M2（全库 0 引用；zeroRefCount=' + r.zeroRefCount + '；zeroLine=' + zeroLine + '）')
    assert(zeroLine.indexOf('[[' + M1.id + ']]') < 0, '零引用候选不含 M1（已被引用）')
    assert(body.indexOf('[[' + M2.id + ']]×') < 0, 'M2 无引用计数（口径：全库 0 引用）')
    assert(body.indexOf('## §1 挂载清单') >= 0 && body.indexOf('- [[' + M1.id + ']] 账本 fixture 记忆A') >= 0, '§1 挂载行逐字节保留（节外零触碰）')
    // 档案：refNote 软链 + 永不 inject + recall=false + 首行 [[M1]] + 引用记录只含近窗 L1（超窗 L2 不入档案）
    const lst = (await handlers['notes-list']({})).notes || []
    const archRows = lst.filter(n => n.topic === '记忆档案')
    assert(archRows.length === 1, '档案恰 1 条（实得 ' + archRows.length + '）')
    ARCH = archRows[0]
    const ga = await handlers['notes-get']({ id: ARCH.id })
    const ab = ga.note.body
    assert(ga.note.refNote === M1.id, 'front-matter refNote 软链 = M1（实得：' + ga.note.refNote + '）')
    assert(ga.note.inject !== true, '档案永不 inject（红线）')
    assert(ga.note.recall === false, '档案 recall=false（不进目录注入）')
    assert(ab.indexOf('[[' + M1.id + ']]') === 0, '档案首行 [[记忆id]]')
    assert(ab.indexOf('## 引用记录（自动）') >= 0, '引用记录节在位')
    assert(ab.indexOf('[[' + L1.id + ']]') >= 0, '引用记录含近窗日志 L1 回链')
    assert(ab.indexOf('[[' + L2.id + ']]') < 0, '超窗日志 L2 不入档案（近 7 天窗口过滤）')
    const noArchB = ((await handlers['notes-list']({})).notes || []).every(n => String(n.refNote || '') !== M2.id)
    assert(noArchB, '零引用记忆 M2 不建空档案')
  })

  // ---- 74.2 幂等重放：档案不重复建/引用记录不重复行/§2 快照不重复 ----
  await t('幂等重放：二次 refresh → archivesCreated=0 + 引用记录仍 1 行 + §2 快照行唯一', async () => {
    const r2 = await handlers['notes-ledger-refresh']({})
    assert(r2 && r2.ok === true && r2.archivesCreated === 0, '二次刷新零新建档案（实得：' + JSON.stringify(r2).slice(0, 120) + '）')
    const ga = await handlers['notes-get']({ id: ARCH.id })
    const ab = ga.note.body
    assert(ga.note.refNote === M1.id, 'refNote 软链稳定')
    const refLines = ab.split('\n').filter(l => l.indexOf('[[' + L1.id + ']]') >= 0)
    assert.strictEqual(refLines.length, 1, '引用记录同日志 id 恰 1 行（重放不重复；实得 ' + refLines.length + '）')
    const idx2 = await handlers['notes-get']({ id: r2.indexNoteId })
    assert((idx2.note.body.match(/- 挂载总数：/g) || []).length === 1, '§2 快照整节重写不叠行（挂载总数行唯一）')
  })

  // ---- 74.3 永不 inject 红线锁（人为开注入 → 刷新强制纠正）----
  await t('红线锁：档案被人为开注入 → 再刷新强制纠正回 inject=false', async () => {
    await handlers['notes-update']({ id: ARCH.id, inject: true })
    const before = await handlers['notes-get']({ id: ARCH.id })
    assert(before.note.inject === true, '人为开注入生效（前置）')
    await handlers['notes-ledger-refresh']({})
    const after = await handlers['notes-get']({ id: ARCH.id })
    assert(after.note.inject !== true, '刷新后档案 inject 强制纠正回 false（防套娃注入红线）')
    assert(after.note.refNote === M1.id, '纠正不破坏 refNote 软链')
  })
  }
}
