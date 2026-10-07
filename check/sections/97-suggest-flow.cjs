// 节 97. 0.4.6-E 建议器/注入流断点批（notes-046-suggest-flow；UX 巡检 R2 角色② 深测 6 条）
// 反馈源：n-mux8b046fq2e 挂载顶掉建议器批处理重开 / n-mux8beuj84i2 零引用段空态缺席+双段并列矛盾 / n-mux8ak66jttd LLM 预填静默缺席 /
//   n-mux8ccd3i4ub 约定注入无确认误触+导出静默 / n-mux8cq80ai5h 快照行不一致无截至时间 / n-mux79kj4lwx9 新建即刻提名无宽限期
// 六项改动（红线：只提名不执行哲学不动；遥测写路径不动；MountModal 契约不破坏既有调用方）：
//   ① 建议器挂载/改文案确认后回开 + 滚动位置保持（app suggestScrollHold / client suggestScrollRef 双端同构）；
//   ② 零引用挂载段空态口径统一（零候选渲染段头 + sugg.zeroRefEmpty「当前无」行）+ 两段互斥（suggestMutexFilter：hot > orphan）；
//   ③ MountModal LLM 预填三态可见化：加载态状态行（spinner）/ 失败态（inj.mountGenFail + tooltip 原始 error）/ 成功；
//     跳过按钮改名「不用建议，自己写」（inj.mountSkip 字典值）；回退预填标题路径保留（MountModal 契约不动）；
//   ④ 详情三态段「约定」档点击二次确认（meta.convInjectConfirm「将对{scope}生效」）——双端 + 原型镜像；
//     导出 toast 既有（0.4.5-F 节 92 行为锁 + e2e ㉕），本批零改动复核；
//   ⑤ 注入管理统计行：挂载计数改 mountNow 实时现算（每次打开新鲜）+ 行尾「截至 HH:MM」（inj.mntStatsAsOf，lastFlush 优先回退快照 at）；
//   ⑥ 「可能无用」新建宽限期：createdAt <24h 不提名（SUGGEST_ORPHAN_GRACE_MS 常量 + 注释）——eval/行为锁在节 33。
module.exports = {
  id: "97",
  title: "97. 0.4.6-E 建议器/注入流断点批（回开滚动保持 + 空态统一互斥 + 预填三态 + 约定确认闸 + 统计行截至 + 宽限期）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc, clientSrc, pathToFileURL } = H
  const { NOTES_DIR, admMock, agentsMock, appSrc, clientPkgSrc, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  section('97. 0.4.6-E 建议器/注入流断点批（notes-046-suggest-flow）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')   // LF 归一（Windows CRLF 源文件多行锚可比）
  const appSugg = read(path.join('src', 'app', 'modals', 'suggest.js'))
  const appMgr = read(path.join('src', 'app', 'modals', 'inject-manager.js'))
  const appEmeta = read(path.join('src', 'app', 'panels', 'editor-meta.js'))
  const cliSugg = read(path.join('src', 'client', 'modals', 'suggest.js'))
  const cliMgr = read(path.join('src', 'client', 'modals', 'inject-manager.js'))
  const cliEd = read(path.join('src', 'client', 'panels', 'panel', 'editor.js'))
  const recallSrc = read(path.join('src', 'host', 'recall.js'))
  const stylesSrc = read(path.join('src', 'styles.css'))
  const appHead = read(path.join('src', 'app', 'shell', 'head.html'))
  const proto = read(path.join('design', 'notes-ui-v2.html'))
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const ZH97 = grab(read(path.join('src', 'i18n', 'zh.js')), 'I18N_ZH')
  const EN97 = grab(read(path.join('src', 'i18n', 'en.js')), 'I18N_EN')

  // ===== ① 挂载就地回开 + 滚动保持（双端同构锚）=====
  await t('① 建议器挂载回开滚动保持（双端）：点击存档 scrollTop → onConfirmed 写 hold → 渲染消费一次性还原', () => {
    // app：模块级 suggestScrollHold + 点击存档 + 确认回调写 hold + renderSuggestList 消费
    assert(appSugg.indexOf('var suggestScrollHold = 0;') >= 0, 'app suggestScrollHold 模块级存档变量')
    assert(appSugg.indexOf("var sc = $('modal') ? $('modal').scrollTop : 0;") >= 0, 'app 点击时存档 .modal scrollTop')
    assert((appSugg.match(/function \(\) \{ suggestScrollHold = sc; openSuggest\(\) \}/g) || []).length === 2, 'app 挂载+改文案两处确认回调写 hold')
    assert(appSugg.indexOf("if (suggestScrollHold > 0 && d) { var sm = $('modal'); if (sm) sm.scrollTop = suggestScrollHold; suggestScrollHold = 0 }") >= 0, 'app renderSuggestList 消费点（一次性清零）')
    // client：suggestModalRef/suggestScrollRef 双 ref + 确认回调写 + effect 消费
    assert(cliSugg.indexOf('const suggestModalRef = { current: null }') >= 0 && cliSugg.indexOf('const suggestScrollRef = { current: 0 }') >= 0, 'client 双 ref 镜像')
    assert((cliSugg.match(/onConfirmed: \(\) => \{ suggestScrollRef\.current = sc; openSuggest\(\) \}/g) || []).length === 2, 'client 两处 onConfirmed 写滚动位')
    assert(cliSugg.indexOf("const sc = suggestModalRef.current ? suggestModalRef.current.scrollTop : 0") >= 0, 'client 点击时从 modal ref 存档')
    assert(cliSugg.indexOf('suggestModalRef.current.scrollTop = suggestScrollRef.current') >= 0 && cliSugg.indexOf('[suggestOpen, suggestData]') >= 0, 'client effect 消费还原（数据到位提交后）')
    assert(cliSugg.indexOf("ref: (el) => { suggestModalRef.current = el }") >= 0, 'client modal 容器 ref 回调回填')
  })

  // ===== ② 两段互斥 + 空态口径（host 纯函数锚 + 双端空态渲染锚；行为级在节 33）=====
  await t('② 两段互斥（suggestMutexFilter 双包 + _suggest 接线）+ 零引用段空态统一（双端渲染锚）', () => {
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('function suggestMutexFilter(orphans, hot)') >= 0, tag + ' 互斥纯函数在位')
      assert(src.indexOf('const orphansFinal = suggestMutexFilter(c.orphanCandidates, telem.hotUnmountedCandidates)') >= 0, tag + ' _suggest 互斥接线')
      assert(src.indexOf('高频 > 可能无用') >= 0, tag + ' 互斥优先级注释写明')
    }
    // 空态：⑤ 段无条件渲染（段头 + 计数 + 空态行），⑥ 段保持空态不渲染（本批范围外）
    assert(appSugg.indexOf("t('sugg.zeroRefEmpty')") >= 0 && appSugg.indexOf('if (zr.length)') < 0, 'app ⑤ 段不再条件跳过（if (zr.length) 守卫已拆）')
    assert(cliSugg.indexOf("tt('sugg.zeroRefEmpty')") >= 0, 'client ⑤ 段空态行接线')
    assert(/hot\.length \? e\('div', \{ className: 'dsh-notes-suggest-sec' \}/.test(cliSugg), '⑥ 高频段空态不渲染保持（hot.length 条件渲染形态在位，范围不扩）')
    assert.strictEqual(ZH97['sugg.zeroRefEmpty'], '当前无零引用挂载候选。', 'zh zeroRefEmpty 文案锚')
    assert(typeof EN97['sugg.zeroRefEmpty'] === 'string' && EN97['sugg.zeroRefEmpty'].length > 0, 'en zeroRefEmpty 非空')
  })

  // ===== ③ MountModal LLM 预填三态 + 跳过改名 =====
  await t('③ MountModal 预填三态（双端）：加载态状态行 + 失败态 tooltip 原始原因 + 成功消隐 + 跳过改名 + 契约锚不动', () => {
    // client：genErr 状态字段 + 状态行渲染 + 迟到丢弃守卫保留 + touched 防覆盖锚保留（73 节同锚）
    assert(cliMgr.indexOf("genErr: ''") >= 0, 'client mount store 切片含 genErr（打开即重置）')
    assert(cliMgr.indexOf("nx.genErr = draft ? '' : String((res && res.error) || 'empty suggestion')") >= 0, 'client 失败/空响应置 genErr（原始原因）')
    assert(cliMgr.indexOf('m.touched ? { generating: false }') >= 0, 'client touched 防覆盖锚保持（契约不动）')
    assert(cliMgr.indexOf("'dsh-notes-inj-mount-gen'") >= 0 && cliMgr.indexOf("'dsh-notes-inj-mount-generr dsh-nt'") >= 0, 'client 加载/失败状态行类')
    assert(cliMgr.indexOf("'data-tooltip': m.genErr") >= 0, 'client 失败行 tooltip 携带原始 error')
    // app：#injMountStat 状态行插槽 + setMountStat 三态 helper + 两回调接线
    assert(appMgr.indexOf('id="injMountStat"') >= 0 && appMgr.indexOf('function setMountStat(mode, tip)') >= 0, 'app 状态行插槽 + helper')
    assert(appMgr.indexOf("setMountStat('gen');") >= 0, 'app 打开即加载态可见')
    assert(appMgr.indexOf("setMountStat(mountState.genErr ? 'err' : '', mountState.genErr)") >= 0 && appMgr.indexOf("setMountStat('err', mountState.genErr)") >= 0, 'app 成功消隐/失败可见（then/catch 双路）')
    // 跳过按钮文案改名（字典值锚；id/接线不变——e2e ⑰ 兼容）
    assert.strictEqual(ZH97['inj.mountSkip'], '不用建议，自己写', 'zh 跳过按钮改名消歧义')
    assert.strictEqual(EN97['inj.mountSkip'], 'Skip suggestion, write it myself', 'en 跳过按钮改名')
    assert.strictEqual(ZH97['inj.mountGenFail'], '预填不可用，请手写', 'zh 失败态文案锚')
    assert(EN97['inj.mountGenFail'].indexOf('Prefill unavailable') >= 0, 'en 失败态文案锚')
    // 样式双端（spinner 动画名同名共源 + 失败色 token）
    for (const [s, tag] of [[stylesSrc, 'styles.css'], [appHead, 'app head.html']]) {
      assert(s.indexOf('@keyframes dshNotesMountSpin') >= 0, tag + ' spinner 动画')
    }
    assert(stylesSrc.indexOf('.dsh-notes-inj-mount-gen{') >= 0 && stylesSrc.indexOf('.dsh-notes-inj-mount-generr{') >= 0, 'client 三态样式类')
    assert(appHead.indexOf('.inj-mount-stat{') >= 0 && appHead.indexOf('.inj-mount-stat.gen::before') >= 0 && appHead.indexOf('.inj-mount-stat.err{') >= 0, 'app 三态样式类')
    // 产物同步（需先跑 build-dist/concat-app）
    assert(clientPkgSrc.indexOf('dsh-notes-inj-mount-generr') >= 0, 'lib/client.js 三态同步（需先跑 build-dist）')
    assert(appSrc.indexOf('injMountStat') >= 0 && appSrc.indexOf('inj-mount-stat{') >= 0, 'app.html 三态同步（需先跑 concat-app）')
  })

  // ===== ④ 约定注入确认闸（双端 + 原型镜像；导出 toast 既有复核）=====
  await t('④ 「约定」档二次确认闸（client/app/原型三端）+ 导出 toast 既有复核（0.4.5-F 不回归）', () => {
    assert(cliEd.indexOf("window.confirm(tt('meta.convInjectConfirm', { title: edTitleRef.current || selectedRef.current, scope: injectScopeLabel(edScopeRef.current) }))") >= 0, 'client 详情三态约定档 confirm 闸')
    assert(appEmeta.indexOf("confirm(t('meta.convInjectConfirm', { title: n.title || n.id, scope: injectScopeLabel(n.injectTo) }))") >= 0, 'app 详情三态约定档 confirm 闸')
    assert(proto.indexOf("confirm('设为约定：《'") >= 0 && proto.indexOf('将对\' + injectScopeLabel(edNote.injectTo) + \'生效') >= 0, '原型镜像确认闸（不双语中文原文）')
    // confirm 文案 = 「将对{scope}生效」+ 双端占位符同形（{title}/{scope}）
    assert(ZH97['meta.convInjectConfirm'].indexOf('将对{scope}生效') >= 0, 'zh 确认条「将对…生效」口径')
    const pz = (ZH97['meta.convInjectConfirm'].match(/\{\w+\}/g) || []).sort().join(','), pe = (EN97['meta.convInjectConfirm'].match(/\{\w+\}/g) || []).sort().join(',')
    assert(pz === '{scope},{title}' && pe === pz, 'confirm 键占位符双端同形 {title}/{scope}')
    // 闸位序：confirm 在 off 分支之前（点约定先问再翻）；off/资料路径不受影响（既有锚复核）
    assert(appEmeta.indexOf('meta.convInjectConfirm') < appEmeta.indexOf("if (r === 'off') { edNote.inject = false; scopeOpen = false }"), 'app 闸位序：确认先于状态翻转')
    assert(cliEd.indexOf('meta.convInjectConfirm') < cliEd.indexOf("const wasOff = edRole === 'off'"), 'client 闸位序：确认先于 wasOff 翻转路径')
    // 导出 toast 既有（0.4.5-F）：双端 doExportOne toast 锚不动（本批零改动复核——R2「导出静默」与实现不符，toast 在案且节 92/e2e㉕ 行为锁）
    assert(appEmeta.indexOf("toast(t('meta.exportedToast', { name: fname }))") >= 0 && cliEd.indexOf("showToast(tt('meta.exportedToast', { name: fname }))") >= 0, '导出完成 toast 双端在案（0.4.5-F 既有）')
  })

  // ===== ⑤ 注入管理统计行：截至时间 + 打开刷新（实时 mountNow）=====
  await t('⑤ 统计行鲜度：host lastFlush+mountNow 增量（写路径不动）+ 双端行渲染（实时计数 + 截至 HH:MM）', () => {
    // host：_recallComputeStats 增量两键（纯读：idxLinesSync 现算 + meta.lastFlush 透传；遥测写路径零改动）
    assert(recallSrc.indexOf('let mountNow = null') >= 0 && recallSrc.indexOf('try { mountNow = idxLinesSync().length }') >= 0, 'recall.js mountNow 实时现算（静默降级 null）')
    assert(recallSrc.indexOf("lastFlush: (t && t.meta && t.meta.lastFlush) || null") >= 0, 'recall.js lastFlush 透传')
    assert(hostSrc.indexOf('mountNow: mountNow') >= 0 && indexSrc.indexOf('mountNow: mountNow') >= 0, '双包产物 mountNow 键（index.mjs 需先跑 build-dist）')
    // client 行：实时计数回退链 + 截至后缀
    assert(cliMgr.indexOf('mntLive != null ? mntLive : (injMgrRstats.ledger.mountTotal || 0)') >= 0, 'client 挂载计数实时优先快照回退')
    assert(cliMgr.indexOf("tt('inj.mntStatsAsOf', { at: mntAsOf.slice(-5) })") >= 0, 'client 截至 HH:MM 后缀（lastFlush 优先）')
    // app 行：同口径
    assert(appMgr.indexOf('st.mountNow != null ? st.mountNow : (lg.mountTotal || 0)') >= 0, 'app 挂载计数实时优先快照回退')
    assert(appMgr.indexOf("t('inj.mntStatsAsOf', { at: asOf })") >= 0 && appMgr.indexOf("fmtDT(st.lastFlush || lg.at || '').slice(-5)") >= 0, 'app 截至 HH:MM 后缀')
    // i18n 键 + zh 值锚
    assert.strictEqual(ZH97['inj.mntStatsAsOf'], '截至 {at}', 'zh mntStatsAsOf 值锚')
    assert.strictEqual(EN97['inj.mntStatsAsOf'], 'as of {at}', 'en mntStatsAsOf 值锚')
    // 既有行格式锚不动（78 节看守面兼容：挂载 {m}｜本周引用 Top：{top}｜零引用 {z} 保留）
    assert(ZH97['inj.mntStats'].indexOf('挂载 {m}｜本周引用 Top：{top}｜零引用 {z}') >= 0, '统计行主格式不动')
    // 产物同步
    assert(clientPkgSrc.indexOf('mntStatsAsOf') >= 0 && appSrc.indexOf('mntStatsAsOf') >= 0, '双产物 mntStatsAsOf 同步（需先跑 build-dist/concat-app）')
  })

  // ===== ⑤b 行为级（隔离实例）：挂载动作后 mountNow 即时 +1（快照 mountTotal 不动）+ lastFlush 在案 =====
  await t('⑤b 行为级：notes-recall-stats mountNow 实时（挂载后立即可见，快照口径不动）+ lastFlush 透出', async () => {
    const store97 = new Map()
    const fsMock97 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store97.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store97.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store97.has(p)) throw new Error('ENOENT: ' + p); return store97.get(p) },
      writeText: async (p, c) => { store97.set(p, c) },
    }
    const handlers97 = {}
    const harnessMock97 = { handle: (n, fn) => { handlers97[n] = fn; return () => { delete handlers97[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock97, DIR).apply({
      fs: fsMock97, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const nA = await handlers97['notes-create']({ title: '97统计探针A', body: 'A 正文' })
    const nB = await handlers97['notes-create']({ title: '97统计探针B', body: 'B 正文' })
    await handlers97['notes-mount']({ id: nA.id, whenToUse: 'A 挂载行97' })
    const lr = await handlers97['notes-ledger-refresh']({})   // 账本快照：mountTotal=1（cron 快照口径定格）
    assert(lr && lr.ok === true && lr.mountTotal === 1, '前置：账本快照 mountTotal=1（实得 ' + JSON.stringify(lr).slice(0, 120) + '）')
    await handlers97['notes-mount']({ id: nB.id, whenToUse: 'B 挂载行97' })   // 快照后再挂一笔——快照节拍不随挂载动作
    const st = await handlers97['notes-recall-stats']({})
    assert(st && st.ok === true, 'recall-stats ok（实得 ' + JSON.stringify(st).slice(0, 140) + '）')
    assert.strictEqual(st.mountNow, 2, 'mountNow 实时 = 2（挂载动作后每次打开即新鲜；快照仍是 1）')
    assert(st.ledger && st.ledger.mountTotal === 1, 'ledger.mountTotal 快照口径不动（=1，遥测写路径不动红线）')
    assert(typeof st.lastFlush === 'string' && st.lastFlush.length > 10, 'lastFlush 透出（面板「截至 HH:MM」数据源）')
  })
  }
}
