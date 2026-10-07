// 节 74. 0.4.3⑥：效用账本——日志双链扫描 → 指标快照 + 记忆档案懒创建回填（notes-043-ledger）；
//   0.4.3 验收修复⑤（notes-043-metrics-storage）修订：§2 数据源切换——指标落机器存储层 telemetry.json 派生字段 ledger
//   （notes-recall-stats RPC ledger 键汇总输出到面板），索引笔记 §2 通道退役 + 存量 §2 节一次性幂等摘除；
//   0.4.3 验收修复⑩（notes-043-archive-folder）：档案归位真实文件夹「记忆档案」（_create extra.folder 参数位纠错）+
//   存量 folder='' 档案一次性幂等迁移；第二轮裁决（Verifier 驳回成立返修）：面板翻账本入口的真实形态 =
//   筛选中心「机器」档（FILTER_KINDS +sys + 面板取数恰选单 kind 时传 {kind} 走 ⑨ 保留的显式 kind 通道）+
//   folders 计数 includeSys（徽标=夹内全部笔记，与定向视图一致）——folder 定向视图含 sys 是 host 侧保留通道，
//   但面板取数从不带 folder 参数（驳回探针实证 data.js 仅无参调用），不再是面板入口等价物。
// 行为规格：①近 7 天日志 link 存活边聚合（只读，复用 notes-graph 全量重建）；②指标快照落 telemetry.json（_telemetrySetLedger，
//   存储层 2s 防抖落盘）+ notes-recall-stats.ledger 汇总读出；②b 存量索引 §2 摘除（幂等，节外零触碰）；③记忆档案懒创建
//   （refNote 软链 + 永不 inject 红线 + ⑩ folder=「记忆档案」归夹）+ 引用记录倒序幂等追加（日志 id 幂等键）；
//   ③b 存量档案归夹（⑩，一次性幂等）；④schedule cron tick 顺带（10min 节流）+ 手动 RPC。
module.exports = {
  id: "74",
  title: "74. 内核⑥：效用账本 指标快照落 telemetry.json + 存量 §2 摘除 + 记忆档案懒创建回填 + 档案归夹「记忆档案」（notes-043-ledger + 卡⑤ + ⑩）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { NOTES_DIR, handlers, store } = S
  section('74. 内核⑥：效用账本 指标快照落 telemetry.json + 存量 §2 摘除 + 记忆档案懒创建回填 + 档案归夹「记忆档案」（notes-043-ledger + 卡⑤ + ⑩）')
  const TELEMETRY_FILE = NOTES_DIR + '\\telemetry.json'

  // ---- 74.0 落地结构：ledger.js 双清单共源 + 核心 API/RPC + cron 顺带锚点 + 卡⑤数据源切换锚（§2 退役/摘除/落存储层）----
  await t('内核⑥+卡⑤ 落地结构：src/host/ledger.js 存在 + 双清单同名共源（无 .dist 变体）+ 序位 + 核心 API/标记块 + §2 数据源切换锚', () => {
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
      assert(src.indexOf('LEDGER_ARCHIVE_TPL = rootNoteTpl(') >= 0, tag + ' RootNote 模板消费（引用记录幂等追加）')
      assert(src.indexOf("handle('notes-ledger-refresh'") >= 0, tag + ' notes-ledger-refresh RPC 注册')
      // 红线锚：档案永不 inject（ensure 内强制纠正）+ recall=false 懒创建
      assert(src.indexOf('if (a.inject === true)') >= 0 && src.indexOf('inject: false, recall: false') >= 0, tag + ' 永不 inject 红线锁 + recall=false')
      // ⑩ 归夹锚：文件夹确保/存量迁移 API + _create extra.folder 参数位（原 topic 位误植纠错）+ refresh 迁移计数返回面
      assert(src.indexOf('async function _ledgerArchiveFolderEnsure(') >= 0 && src.indexOf('async function _ledgerArchiveFolderMigrate(') >= 0, tag + ' ⑩ 档案文件夹确保/存量归夹 API 在位')
      assert(src.indexOf("LEDGER_ARCHIVE_FOLDER = '记忆档案'") >= 0 && src.indexOf('folder: LEDGER_ARCHIVE_FOLDER') >= 0, tag + ' ⑩ 档案懒创建 folder=「记忆档案」（extra.folder 参数位，非 topic 位）')
      assert(src.indexOf('archivesMoved: archivesMoved') >= 0, tag + ' ⑩ refresh 返回 archivesMoved 迁移计数（幂等断言面）')
      // 卡⑤数据源切换锚：§2 写通道退役 + 存量摘除 API + 指标快照落存储层 + 镜像顺带刷新
      assert(src.indexOf('LEDGER_S2_TPL') < 0 && src.indexOf('_ledgerWriteS2') < 0, tag + ' §2 写通道已退役（模板/写函数摘除——卡⑤）')
      assert(src.indexOf('function _ledgerStripS2FromBody(') >= 0 && src.indexOf('async function _ledgerStripS2(') >= 0, tag + ' 存量 §2 摘除 API 在位（一次性幂等）')
      assert(src.indexOf('await _telemetrySetLedger({') >= 0, tag + ' 指标快照落 telemetry.json 派生字段 ledger（_telemetrySetLedger）')
      assert(src.indexOf("await _recallMirrorRefresh('ledger-' + trig)") >= 0, tag + ' 遥测镜像顺带刷新（日评估 cron 通道）')
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
    // ⑩ 第二轮裁决①/② 面板链路静态锚（真实翻账本入口）：筛选中心「机器」档（FILTER_KINDS +sys + i18n 标签）+
    //   列表取数恰选单 kind 传 {kind}（app/client 双端；host 谓词 kind 真值短路放行 sys = ⑨ 保留通道）
    const appStateSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'state.js'), 'utf8')
    const appDataSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'data.js'), 'utf8')
    const cliConstSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'kernel', 'constants.js'), 'utf8')
    const cliIndexSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'panels', 'panel', 'index.js'), 'utf8')
    const zhSrc74 = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const enSrc74 = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    assert(appStateSrc.indexOf("var FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log', 'sys'];") >= 0, '⑩ app FILTER_KINDS 含 sys（「机器」档入口）')
    assert(cliConstSrc.indexOf("const FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log', 'sys']") >= 0, '⑩ client FILTER_KINDS 含 sys（「机器」档入口）')
    assert(zhSrc74.indexOf("'meta.kindSys': '机器'") >= 0 && enSrc74.indexOf("'meta.kindSys': 'Machine'") >= 0, '⑩ i18n meta.kindSys 双语键（「机器」/Machine）')
    assert(appDataSrc.indexOf('function listFetchSig()') >= 0 && appDataSrc.indexOf("rpc('notes-list', listArgs)") >= 0 && appDataSrc.indexOf('{ kind: sig }') >= 0, '⑩ app 列表取数恰选单 kind 传 {kind}（listFetchSig 口径）')
    assert(cliIndexSrc.indexOf("host.call('notes-list', kf.length === 1 ? { kind: kf[0] } : undefined)") >= 0 && cliIndexSrc.indexOf('React.useEffect(() => { if (open) loadNotes(true, filters.kinds) }, [filters.kinds])') >= 0, '⑩ client 列表取数恰选单 kind 传 {kind} + kind 档切换重拉 effect（0.4.6-K 起显式传 filters.kinds，甩掉 filtersRef 序位依赖）')
  })

  // ---- 74.1 fixture 全链路：指标快照数值 + 存量 §2 摘除 + 档案懒创建 + 近 7 天窗口过滤 ----
  const today = (function () { const d = new Date(); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
  const oldDate = (function () { const d = new Date(Date.now() - 10 * 86400000); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
  let M1, M2, L1, L2, ARCH, STRIPPED_BODY
  await t('fixture 全链路：挂载 2 条 + 近 7 天/超窗日志各 1 → refresh → 指标落 telemetry.json + 存量 §2 摘除 + 档案懒创建恰 1 个（refNote 软链 + 红线）', async () => {
    M1 = await handlers['notes-create']({ title: '账本记忆A', body: '记忆正文A', topic: '记忆' })
    M2 = await handlers['notes-create']({ title: '账本记忆B', body: '记忆正文B', topic: '记忆' })
    assert(M1.id && M2.id, '两条记忆创建成功')
    await handlers['notes-mount']({ id: M1.id, whenToUse: '账本 fixture 记忆A' })
    await handlers['notes-mount']({ id: M2.id, whenToUse: '账本 fixture 记忆B' })
    // 卡⑤适配：索引笔记 §2 写通道已退役——fixture 把索引正文重建为「存量形态」（说明块 + §1 挂载行 + §2 锚 + 节内手写备注），
    //   再验「一次性摘除：§2 整段摘除、机器指标行随节删除、手写备注保留、§1 与说明块节外零触碰」语义
    const ml74 = await handlers['notes-mount-list']({})
    const gI74 = await handlers['notes-get']({ id: ml74.indexNoteId })
    const guideLine74 = gI74.note.body.split('\n').filter(l => l.indexOf('机器托管笔记（请勿删除）') === 0)[0]
    assert(guideLine74, '说明块首行可得（v2 预设前置）')
    const mountLines74 = ml74.lines.map(l => l.raw)
    await handlers['notes-update']({ id: ml74.indexNoteId, body: guideLine74 + '\n\n## §1 挂载清单\n\n' + mountLines74.join('\n') + '\n\n## §2 召回指标\n\n- 挂载总数：2（存量机器指标行）\n\n§2 里手写的一句备注\n' })
    L1 = await handlers['notes-create']({ title: '工作日志 74 · 近窗', body: '## 相关笔记\n\n[[' + M1.id + ']] 双链引用', kind: 'log', logDate: today })
    L2 = await handlers['notes-create']({ title: '工作日志 74 · 超窗', body: '## 相关笔记\n\n[[' + M1.id + ']] 十天前旧日志', kind: 'log', logDate: oldDate })
    assert(L1.id && L2.id, '两条日志创建成功')
    const r = await handlers['notes-ledger-refresh']({})
    assert(r && r.ok === true, 'notes-ledger-refresh 成功（实得：' + JSON.stringify(r).slice(0, 160) + '）')
    assert(r.mountTotal >= 2, '挂载总数 ≥2（实得 ' + r.mountTotal + '）')
    assert(r.weekLogs === 1, '近 7 天日志恰 1 篇（超窗 L2 不计；实得 ' + r.weekLogs + '）')
    assert(r.weekRefs === 1, '本周引用恰 1 次（仅近窗 L1 引 M1；超窗 L2 不计；实得 ' + r.weekRefs + '）')
    assert(r.archivesCreated === 1, '档案懒创建恰 1 个（M1；实得 ' + r.archivesCreated + '）')
    // ⑥存量 §2 摘除：整段摘除（机器托管节语义——节内机器指标行/误入备注行全行随节退役，残行不留防污染 §1 lint）+ §1/说明块节外零触碰（逐字节）
    const idx = await handlers['notes-get']({ id: r.indexNoteId })
    const body = idx.note.body
    assert(body.indexOf('## §2 召回指标') < 0, '⑥存量 §2 锚整段摘除（指标迁 telemetry.json + notes-recall-stats）')
    assert(body.indexOf('存量机器指标行') < 0, '⑥§2 节内机器指标行随节删除')
    assert(body.indexOf('§2 里手写的一句备注') < 0, '⑥§2 节内误入备注行随节整段退役（残行不留——防落入 §1 行区污染节 75 lint 兜底检出面）')
    STRIPPED_BODY = guideLine74 + '\n\n## §1 挂载清单\n\n' + mountLines74.join('\n') + '\n'
    assert(body === STRIPPED_BODY, '⑥节外零触碰：§1 挂载行 + 说明块逐字节保留（摘除产物逐字节比对）')
    // ②指标快照：telemetry.json ledger 派生字段 + notes-recall-stats ledger 键汇总输出（读前落账后盘上口径一致）
    const st = await handlers['notes-recall-stats']({})
    assert(st.ok === true && st.ledger, 'notes-recall-stats 携带 ledger 键（卡⑤新增，既有键零改动）')
    assert(st.ledger.mountTotal === r.mountTotal && st.ledger.weekRefs === 1 && st.ledger.weekLogs === 1 && st.ledger.trigger === 'manual' && !!st.ledger.at, 'ledger 快照数值正确（挂载总数/本周引用/日志篇数/触发源/时间戳；实得 ' + JSON.stringify(st.ledger).slice(0, 200) + '）')
    assert(st.ledger.top.length >= 1 && st.ledger.top[0].id === M1.id && st.ledger.top[0].count === 1, '本周引用 Top5 榜首 [[M1]]×1（仅近窗引用）')
    assert(st.ledger.zeroRef.indexOf(M2.id) >= 0 && st.ledger.zeroRef.indexOf(M1.id) < 0, '零引用候选含 M2 不含 M1（全库 0 引用口径）')
    const tj = JSON.parse(store.get(TELEMETRY_FILE))
    assert(tj.ledger && tj.ledger.mountTotal === r.mountTotal && tj.ledger.weekRefs === 1, '指标快照落盘 telemetry.json ledger 键（stats 读前落账口径一致）')
    // 档案：refNote 软链 + 永不 inject + recall=false + 首行 [[M1]] + 引用记录只含近窗 L1（超窗 L2 不入档案）
    // （0.4.3⑨ sys 缺省降噪：档案 kind=sys 不入默认列表——显式 kind:'sys' 入口取数，语义等价）
    const lst = (await handlers['notes-list']({ kind: 'sys' })).notes || []
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
    const noArchB = ((await handlers['notes-list']({ kind: 'sys' })).notes || []).every(n => String(n.refNote || '') !== M2.id)
    assert(noArchB, '零引用记忆 M2 不建空档案')
    // ⑩ 档案归位真实文件夹「记忆档案」（notes-043-archive-folder）：folder=id 参数位纠错 + folders RPC 树节点 + 计数含 sys（第二轮裁决③）
    const fl74 = await handlers['notes-folders']({})
    const fa74 = (fl74.folders || []).filter(f => f.name === '记忆档案')
    assert(fa74.length === 1, '⑩「记忆档案」文件夹恰 1 个（ensure 懒建去重；实得 ' + fa74.length + '）')
    assert(ga.note.folder === fa74[0].id, '⑩ 新建档案 folder=「记忆档案」id（_create extra.folder 参数位纠错；实得 ' + ga.note.folder + '）')
    assert(ga.note.topic === '记忆档案', '⑩ topic=「记忆档案」口径保留（工具描述/存量断言同口径，未随归夹摘除）')
    assert(fa74[0].count >= 1, '⑩ 第二轮③：folders 计数 includeSys——「记忆档案」徽标含 sys 档案（与定向视图一致，消除 count=0 死节点；实得 ' + fa74[0].count + '）')
    const lstF74 = (await handlers['notes-list']({ folder: fa74[0].id })).notes || []
    assert(lstF74.some(n => n.id === ARCH.id), '⑩ folder 定向视图含 sys 档案（⑨ 保留的 host 侧通道；非面板入口——面板取数从不带 folder 参数，见 74.0 面板链路锚）')
    const lstK74 = (await handlers['notes-list']({ kind: 'sys' })).notes || []
    assert(lstK74.some(n => n.id === ARCH.id), '⑩ 第二轮①/②：显式 kind=sys 通道含档案（= 面板「机器」档取数口径——FILTER_KINDS 勾选后面板传 {kind:\'sys\'} 即得全库 sys）')
    const lstD74 = (await handlers['notes-list']({})).notes || []
    assert(!lstD74.some(n => n.id === ARCH.id), '⑨ 回归：缺省档面板列表仍不含 sys（默认平铺降噪零放松——「机器」档之外的 panel 行为与 ⑨ 完全一致）')
  })

  // ---- 74.2 幂等重放：档案不重复建/引用记录不重复行/§2 摘除幂等零改动/快照重写不叠 ----
  await t('幂等重放：二次 refresh → archivesCreated=0 + 引用记录仍 1 行 + §2 摘除幂等零改动', async () => {
    const wBefore = JSON.parse(store.get(TELEMETRY_FILE)).ledger
    const r2 = await handlers['notes-ledger-refresh']({})
    assert(r2 && r2.ok === true && r2.archivesCreated === 0, '二次刷新零新建档案（实得：' + JSON.stringify(r2).slice(0, 120) + '）')
    const ga = await handlers['notes-get']({ id: ARCH.id })
    const ab = ga.note.body
    assert(ga.note.refNote === M1.id, 'refNote 软链稳定')
    const refLines = ab.split('\n').filter(l => l.indexOf('[[' + L1.id + ']]') >= 0)
    assert.strictEqual(refLines.length, 1, '引用记录同日志 id 恰 1 行（重放不重复；实得 ' + refLines.length + '）')
    const idx2 = await handlers['notes-get']({ id: r2.indexNoteId })
    assert(idx2.note.body === STRIPPED_BODY, '⑥§2 摘除幂等：二次 refresh 索引正文零改动（无 §2 不叠写、手写备注仍在）')
    const st2 = await handlers['notes-recall-stats']({})
    assert(st2.ledger && st2.ledger.mountTotal === wBefore.mountTotal && st2.ledger.weekRefs === wBefore.weekRefs, '快照整体覆盖写幂等（同口径重写数值稳定）')
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

  // ---- 74.4 ⑩ 存量迁移：folder='' 存量档案一次 refresh 归夹 + 二次 refresh 零改写（幂等）+ ⑨/⑦ 回归 ----
  await t('⑩ 存量迁移：folder=\'\' 存量档案一次 refresh 归夹「记忆档案」，二次 refresh 零改写（幂等），⑨ 降噪/⑦ 日志同权回归', async () => {
    // 存量形态 fixture：⑩ 前的旧档案形态——title「记忆 @」开头 + kind=sys + topic 记忆档案 + folder=''（未归夹）
    const legacy = await handlers['notes-create']({ title: '记忆 @存量记忆X · 档案', body: '[[n-legacy]]\n\n## 引用记录（自动）\n', kind: 'sys', topic: '记忆档案', tags: ['自动'] })
    assert(legacy.id, '存量形态档案 fixture 创建成功')
    const g0 = await handlers['notes-get']({ id: legacy.id })
    assert(g0.note.folder === '', '前置：存量档案 folder=\'\'（⑩ 前未归夹形态）')
    const r3 = await handlers['notes-ledger-refresh']({})
    assert(r3 && r3.ok === true && r3.archivesMoved >= 1, '一次 refresh 迁移 ≥1 篇存量档案（实得 ' + JSON.stringify(r3).slice(0, 160) + '）')
    const g1 = await handlers['notes-get']({ id: legacy.id })
    const flB = await handlers['notes-folders']({})
    const faB = (flB.folders || []).filter(f => f.name === '记忆档案')
    assert(faB.length === 1 && g1.note.folder === faB[0].id, '存量档案归夹「记忆档案」（folder=id；文件夹恰 1 个不重复建）')
    assert(faB[0].count >= 2, '⑩ 第二轮③：迁移后「记忆档案」徽标计数含全部 sys 档案（74.1 新建 + 存量迁移；实得 ' + faB[0].count + '）')
    assert(g1.note.kind === 'sys' && g1.note.topic === '记忆档案' && g1.note.recall === false, '迁移只写 folder：kind/topic/recall 零触碰')
    assert(g1.note.body === g0.note.body && g1.note.title === g0.note.title, '迁移正文/标题零触碰（逐字节）')
    // 幂等：二次 refresh 零迁移 + 零改写（folder 非空不再命中判据）
    // 口径说明（第二轮裁决，不阻塞项）：①迁移改写 updatedAt 属 rootnote.js rootNoteEnsureSysKind 同族先例（机器元数据迁移随写 updatedAt，
    //   非用户编辑语义）；②⑥ 前 kind='note' 陈旧档案不命中迁移判据（kind=sys 限定）——先经 _ledgerArchiveEnsure 的
    //   rootNoteEnsureSysKind 升级（本周引用命中时），下一轮 refresh 归夹（两拍时序为设计口径，非缺陷）
    const r4 = await handlers['notes-ledger-refresh']({})
    assert(r4 && r4.ok === true && r4.archivesMoved === 0, '二次 refresh 零迁移（幂等重放；实得 ' + r4.archivesMoved + '）')
    const g2 = await handlers['notes-get']({ id: legacy.id })
    assert(g2.note.updatedAt === g1.note.updatedAt && g2.note.folder === g1.note.folder, '二次 refresh 存量档案零改写（updatedAt/folder 稳定）')
    // ⑨ 回归：默认平铺视图仍降噪排除 sys 档案（迁移后条目 + 74.1 新建条目）；folder 定向视图双双可见（面板翻账本入口）
    const lstD2 = (await handlers['notes-list']({})).notes || []
    assert(!lstD2.some(n => n.id === legacy.id) && !lstD2.some(n => n.id === ARCH.id), '⑨ 回归：默认列表仍不含 sys 档案（存量+新建）')
    const lstF2 = (await handlers['notes-list']({ folder: faB[0].id })).notes || []
    assert(lstF2.some(n => n.id === legacy.id) && lstF2.some(n => n.id === ARCH.id), '⑩ folder 定向视图含全部档案（存量迁移 + 新建归夹）')
    // ⑦ 回归：日志同权不变——默认列表仍含近窗工作日志（归夹对 kind=log 零影响）
    assert(lstD2.some(n => n.id === L1.id), '⑦ 回归：默认列表日志同权不变（kind=log 不受归夹影响）')
  })
  }
}
