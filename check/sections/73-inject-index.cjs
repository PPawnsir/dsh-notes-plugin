// 节 73. 0.4.3⑤：注入索引根笔记 + 管线 reference 桶切换 + 挂载联动/弹层（notes-043-index）
// 行为规格（总纲卡5/7）：①升级首启自动建「注入索引（自动）」（RootNote 框架；settings 记 indexNoteId；不 inject 自身）；
//   ②§1 挂载清单行格式 `- [[n-xxx]] 何时查我：…`；③管线切换：reference 桶 = §1 逐行（无索引回退空桶），约定桶全文不动（红线）；
//   ④联动：资料开注入→落缺省行（弹层换文案 notes-mount）；关注入/删笔记→摘行；⑤挂载弹层双端（client/app，i18n 全 key 化）。
module.exports = {
  id: "73",
  title: "73. 内核③⑤：注入索引根笔记 + 管线 reference 桶切换 + 挂载联动/弹层（notes-043-index）",
  async run(H, S) {
  const { t, section, assert, fsNative, osNative, path, DIR, hostSrc, indexSrc, clientSrc } = H
  const { handlers, store, NOTES_DIR } = S
  section('73. 内核③⑤：注入索引根笔记 + 管线 reference 桶切换 + 挂载联动/弹层（notes-043-index）')

  // ---- 73.0 落地结构：injectindex.js 双清单共源 + 管线切换 + 启动装配 + 弹层双端 + i18n/样式 ----
  await t('内核⑤ 落地结构：src/host/injectindex.js 存在 + 双清单同名共源（无 .dist 变体）+ 核心 API/标记块', () => {
    assert(fsNative.existsSync(path.join(DIR, 'src', 'host', 'injectindex.js')), 'src/host/injectindex.js 存在')
    const devM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dev.js'), 'utf8')
    const distM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dist.js'), 'utf8')
    assert(devM.indexOf("'injectindex.js'") >= 0 && distM.indexOf("'injectindex.js'") >= 0, '双清单同名登记 injectindex.js（共源单份）')
    assert(devM.indexOf("'rootnote.js'") < devM.indexOf("'injectindex.js'") && distM.indexOf("'rootnote.js'") < distM.indexOf("'injectindex.js'"), '序位：rootnote.js 之后（框架消费）')
    assert(!fsNative.existsSync(path.join(DIR, 'src', 'host', 'injectindex.dist.js')), 'injectindex.js 不得出现 .dist 变体（第三份拷贝红线）')
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('==== inject-index BEGIN ====') >= 0 && src.indexOf('==== inject-index END ===='), tag + ' 含 inject-index 标记块')
      assert(src.indexOf('function idxNoteSync(') >= 0 && src.indexOf('function idxLinesSync(') >= 0, tag + ' 同步解析 API 在位（idxNoteSync/idxLinesSync）')
      assert(src.indexOf('async function idxEnsure(') >= 0 && src.indexOf('async function idxMount(') >= 0 && src.indexOf('async function idxUnmount(') >= 0, tag + ' ensure/mount/unmount API 在位')
      assert(src.indexOf("handle('notes-mount'") >= 0 && src.indexOf("handle('notes-mount-list'") >= 0, tag + ' notes-mount / notes-mount-list RPC 注册')
      assert(src.indexOf('INJECT_INDEX_TITLE') >= 0 && src.indexOf('INJECT_INDEX_TPL = rootNoteTpl(') >= 0, tag + ' RootNote 模板消费（keyOfLine=双链 target 幂等键）')
      // 0.4.3 验收修复④（notes-043-index-preset-v2）：v2 预设 = 说明块 + §1 单节（§2 出预设）+ 行格式「何时查我：」前缀归一
      assert(src.indexOf("const INJECT_INDEX_GUIDE = '机器托管笔记（请勿删除）：") >= 0, tag + ' v2 预设说明块常量在位')
      assert(src.indexOf("INJECT_INDEX_BODY = INJECT_INDEX_GUIDE + INJECT_INDEX_HEAD + '\\n'") >= 0, tag + ' v2 预设 = 说明块 + §1 单节（§2 不再入预设）')
      assert(src.indexOf("const INJECT_INDEX_S2 = '## §2 召回指标'") >= 0, tag + ' INJECT_INDEX_S2 常量保留（ledger §2 通道存量兼容消费，暂不动）')
      assert(src.indexOf("const INJECT_INDEX_WHEN_PREFIX = '何时查我：'") >= 0 && src.indexOf("']] ' + INJECT_INDEX_WHEN_PREFIX") >= 0, tag + ' 行格式归一：lineOf 机器加「何时查我：」前缀')
      assert(src.indexOf('when.slice(INJECT_INDEX_WHEN_PREFIX.length)') >= 0, tag + ' idxLinesSync 剥离可选前缀（存量无前缀行零迁移）')
      // 开关联动：_create/_update/_delete/_purge 单点收口包装（RPC 域包装保留；graph 增量 0.4.3+ 已迁 onNoteChanged 事件总线）
      assert(src.indexOf('_idxSyncMount(') >= 0 && src.indexOf('const _idxUpdateOrig = _update') >= 0, tag + ' _update 包装联动')
      assert(src.indexOf('const _idxCreateOrig = _create') >= 0 && src.indexOf('const _idxDeleteOrig = _delete') >= 0 && src.indexOf('const _idxPurgeOrig = _purge') >= 0, tag + ' create/delete/purge 包装联动（删笔记→清行）')
      // 管线切换（inject.js 双变体）：reference 桶 = 索引 §1 逐行
      assert(src.indexOf('const refBlocks = idxLinesSync()') >= 0, tag + ' 管线切换：reference 桶 = 索引 §1 逐行（idxLinesSync）')
      // 驳回②源码锚：挂载行 = §1 行原样进段（raw 自带 `- ` 前缀），禁止再叠 '- ' 产出 `- - [[id]]` 双横线
      assert(src.indexOf('const refLines = refBlocks.map(function (it) { return it.raw })') >= 0, tag + ' 挂载行 = §1 行原样（单横线契约源码锚）')
      assert(src.indexOf("return '- ' + it.raw") < 0, tag + ' 无双横线前缀残留（驳回②负向锚）')
      assert(src.indexOf('（以上为挂载索引行：正文用 note_get <id> 获取）') >= 0, tag + ' 资料桶 note_get 轻推提示行')
      // 启动装配：升级首启 idxEnsure
      assert(src.indexOf('idxEnsure()') >= 0, tag + ' 启动装配 idxEnsure（升级首启自动建索引）')
    }
  })

  await t('挂载弹层双端落地（client + app）+ i18n 全 key 化（en/zh 同 key 集）+ 样式双端', () => {
    // client（React e() 形态）
    assert(clientSrc.indexOf('function MountModal(') >= 0 && clientSrc.indexOf('function openMountModal(') >= 0, 'client 挂载弹层组件在位（MountModal/openMountModal）')
    assert(clientSrc.indexOf("host.call('notes-mount', { id: m.id, whenToUse: m.when || m.title })") >= 0, 'client 确认落行走 notes-mount RPC（0.4.3⑦ 顺带微修：生成中点确认 when 空串 → 回退标题，落行文案非空）')
    assert(clientSrc.indexOf('whenToUse: m.when || m.title') >= 0, 'client doMountSave 空值兜底（m.when || m.title）')
    assert(clientSrc.indexOf("if (role === 'reference') { setInjMgrOpen(false); injMgrBackRef.current = null; openMountModal(") >= 0, 'client 注入管理行：设为资料 → 弹层（modal 不叠 modal）')
    assert(clientSrc.indexOf('e(MountModal)') >= 0, 'client 面板挂载 MountModal 渲染')
    // app（模板串形态）
    const appSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'inject-manager.js'), 'utf8')
    assert(appSrc.indexOf('function openMountModal(') >= 0 && appSrc.indexOf("rpc('notes-mount', { id: mountState.id, whenToUse: mountState.when || mountState.title })") >= 0, 'app 挂载弹层在位 + notes-mount 通道（0.4.3⑦ 顺带微修：when 空串回退标题）')
    assert(appSrc.indexOf("if (role === 'reference')") >= 0 && appSrc.indexOf('openMountModal({ id: n.id, title: n.title })') >= 0, 'app 注入管理行：设为资料 → 弹层')
    // i18n：en/zh 同 key 集全 key 化（inj.mount*）
    const en = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    const zh = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    for (const k of ['inj.mountTitle', 'inj.mountSub', 'inj.mountLabel', 'inj.mountPlaceholder', 'inj.mountSave', 'inj.mountSkip', 'inj.mountSaved', 'inj.mountFailed']) {
      assert(en.indexOf("'" + k + "':") >= 0, 'en 缺 ' + k)
      assert(zh.indexOf("'" + k + "':") >= 0, 'zh 缺 ' + k)
    }
    // 样式双端（styles.css / app shell head.html）
    const css = fsNative.readFileSync(path.join(DIR, 'src', 'styles.css'), 'utf8')
    assert(css.indexOf('.dsh-notes-inj-mount-when{') >= 0 && css.indexOf('.dsh-notes-inj-mount-label{') >= 0, 'styles.css 挂载弹层样式')
    const headHtml = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'shell', 'head.html'), 'utf8')
    assert(headHtml.indexOf('.inj-mount-when{') >= 0 && headHtml.indexOf('.inj-mount-label{') >= 0, 'app head.html 挂载弹层样式')
  })

  // ---- 73.1 行为级（共享真 handlers）：首启建索引 + 挂载行级增删 + 开关联动 + 删笔记清行 + 图死链消除 ----
  await t('升级首启：注入索引根笔记已建（标题/双节/不 inject 自身/recall 关闭）+ settings 记 indexNoteId + notes-mount-list 形态', async () => {
    const lst = await handlers['notes-mount-list']({})
    assert(!lst.error, 'notes-mount-list 可用（实得：' + JSON.stringify(lst).slice(0, 120) + '）')
    assert(lst.indexNoteId, '索引笔记 id 回传（升级首启已建/自愈）')
    const g = await handlers['notes-get']({ id: lst.indexNoteId })
    assert(!g.error && g.note, '索引笔记存活')
    assert.strictEqual(g.note.title, '注入索引（自动）', '标题 =「注入索引（自动）」')
    assert(g.note.body.indexOf('## §1 挂载清单') >= 0, '§1 挂载清单节在位')
    // 0.4.3 验收修复④：v2 预设说明块锚在位（RootNote pre 区逐字节保留，行级操作/cron 账本刷新均存活）；
    //   §2 不再入预设——「新建 body 无 §2」逐字节锁见 73.2 独立实例（共享实例可能被前节 cron 顺带账本刷新重建 §2，此处不反向断言）
    assert(g.note.body.indexOf('机器托管笔记（请勿删除）') >= 0, 'v2 预设说明块锚在位（0.4.3 验收修复④）')
    assert(g.note.inject !== true, '索引自身不注入（不 inject 自身红线）')
    assert(g.note.recall === false, '索引 recall=false（不进目录注入；编辑器列表仍可见）')
    const sg = await handlers['notes-settings-get']({})
    assert.strictEqual(sg.settings.indexNoteId, lst.indexNoteId, 'settings.indexNoteId 指针与索引一致')
    assert(Array.isArray(lst.lines), 'lines 数组形态（{ id, when, raw }）')
  })

  // ---- 73.1.5 0.4.3⑥ kind=sys 系统根笔记（notes-043-sys-kind）：枚举 + 索引/档案/runLog 归位 + 豁免面收口 ----
  await t('kind=sys 落地结构：KINDS 枚举（双变体）+ rootNoteEnsureSysKind + 三消费点 sys 归位（索引/档案/runLog）+ 建议器豁免判据 + 批量删除红字警示三端', () => {
    const scDev = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'store-cache.js'), 'utf8')
    const scDist = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'store-cache.dist.js'), 'utf8')
    for (const [tag, sc] of [['dev', scDev], ['dist', scDist]]) {
      assert(sc.indexOf("const KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log', 'sys']") >= 0, tag + ' KINDS 枚举 +sys')
      assert(sc.indexOf("(p.meta.kind === 'log' || p.meta.kind === 'sys') ? false : true") >= 0, tag + ' noteFromParsed：sys 缺省 recall=false')
    }
    const rnSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'rootnote.js'), 'utf8')
    assert(rnSrc.indexOf('async function rootNoteEnsureSysKind(') >= 0 && rnSrc.indexOf("n.kind = 'sys'") >= 0, 'rootnote.js rootNoteEnsureSysKind 迁移 helper（只写 kind 元数据）')
    assert(rnSrc.indexOf('if (rl) { if (tpl.kind === \'sys\') await rootNoteEnsureSysKind(rl); return rl }') >= 0, 'rootNoteEnsure 存量托管笔记 sys 归位（仅 sys 模板惰性迁移）')
    const schedSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'schedule.js'), 'utf8')
    assert(schedSrc.indexOf("      kind: 'sys',") >= 0, 'schedule.js runLog 懒创建 kind=sys')
    const idxSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'injectindex.js'), 'utf8')
    assert(idxSrc.indexOf("(n.kind || 'note') === 'sys' && n.title === INJECT_INDEX_TITLE") >= 0, 'idxNoteSync 判定按 kind=sys（标题回退保留）')
    assert(idxSrc.indexOf("{ kind: 'sys', inject: false, recall: false }") >= 0, 'idxEnsure 懒创建 kind=sys')
    assert(idxSrc.indexOf('await rootNoteEnsureSysKind(rl)') >= 0, 'idxEnsure 存量索引迁移（只写 kind 元数据）')
    const ledSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'ledger.js'), 'utf8')
    assert(ledSrc.indexOf("{ kind: 'sys', inject: false, recall: false, folder: LEDGER_ARCHIVE_FOLDER }") >= 0, 'ledger 档案懒创建 kind=sys（0.4.3⑩ 归夹：extra.folder=「记忆档案」参数位随锚收紧）')
    assert(ledSrc.indexOf('if (a) await rootNoteEnsureSysKind(a)') >= 0, 'ledger 存量档案迁移')
    for (const [tag, msrc] of [['dev', fsNative.readFileSync(path.join(DIR, 'src', 'host', 'memory.js'), 'utf8')], ['dist', fsNative.readFileSync(path.join(DIR, 'src', 'host', 'memory.dist.js'), 'utf8')]]) {
      assert(msrc.indexOf("if (n.kind === 'sys') continue") >= 0, tag + ' 建议器：sys 永不被过期清理提名')
      assert(msrc.indexOf("if ((n.kind || 'note') === 'sys') continue") >= 0, tag + ' 建议器：sys 永不被孤儿清理提名')
    }
    // 删除警示三端锚点（i18n + client selbar + app selbar/archive）
    const en = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    const zh = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    for (const k of ['sys.selWarn', 'sys.batchDelWarn']) {
      assert(en.indexOf("'" + k + "':") >= 0, 'en 缺 ' + k)
      assert(zh.indexOf("'" + k + "':") >= 0, 'zh 缺 ' + k)
    }
    const cliSel = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'popovers', 'selbar.js'), 'utf8')
    assert(cliSel.indexOf("t('sys.batchDelWarn'") >= 0 && cliSel.indexOf('dsh-notes-syswarn') >= 0, 'client selbar：sys confirm 门槛 + 红字警示')
    const appArch = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'archive.js'), 'utf8')
    assert(appArch.indexOf("confirm(t('sys.batchDelWarn'") >= 0, 'app doSelBatchDelete：sys confirm 门槛')
    const bodyHtml = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'shell', 'body.html'), 'utf8')
    const headHtml = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'shell', 'head.html'), 'utf8')
    assert(bodyHtml.indexOf('id="selSysWarn"') >= 0 && headHtml.indexOf('.selbar .syswarn{') >= 0, 'app selbar：红字警示 span + 样式')
    const css = fsNative.readFileSync(path.join(DIR, 'src', 'styles.css'), 'utf8')
    assert(css.indexOf('.dsh-notes-syswarn{') >= 0, 'client styles.css：syswarn 样式')
  })

  await t('kind=sys 行为：索引 kind=sys + recall=false；sys 创建 recall 缺省 false、inject 允许（核心用途）；建议器永不提名 sys', async () => {
    const ml0 = await handlers['notes-mount-list']({})
    const g0 = await handlers['notes-get']({ id: ml0.indexNoteId })
    assert.strictEqual(g0.note.kind, 'sys', '注入索引根笔记 kind=sys（0.4.3⑥ 归位）')
    assert(g0.note.recall === false, '索引 recall=false（不进目录注入，语义不变）')
    // sys 创建：recall 缺省 false（不进目录/默认召回）
    const s1 = await handlers['notes-create']({ title: 'sys-companion-043', body: '系统笔记正文（无双链）', kind: 'sys', topic: '系统' })
    assert(s1 && s1.id && !s1.error, 'kind=sys 创建成功')
    const g1 = await handlers['notes-get']({ id: s1.id })
    assert.strictEqual(g1.note.kind, 'sys', 'kind 落盘 sys')
    assert(g1.note.recall === false, 'sys recall 缺省 false（契约②隐身）')
    // inject 允许且是核心用途（与 log 硬禁相反：update inject=true 不被纠正）
    await handlers['notes-update']({ id: s1.id, inject: true })
    const g2 = await handlers['notes-get']({ id: s1.id })
    assert(g2.note.inject === true, 'sys inject 允许（契约①注入是核心用途）')
    // 建议器豁免：判据有效性用 suggestCandidates eval 单测（与节 33 同姿势——不依赖共享实例孤儿上限切片）；
    //   RPC 行为面断言 sys 永不提名
    const m73 = hostSrc.match(/\/\/ ==== suggest-helpers BEGIN ====[\s\S]*?\/\/ ==== suggest-helpers END ====/)
    assert(m73, 'host-impl.js 含 suggest-helpers 标记块')
    const ns73 = {}
    new Function('ns', m73[0] + '\nns.suggestCandidates = suggestCandidates;')(ns73)
    const isoOld = new Date(Date.now() - 200 * 86400000).toISOString()
    const mkN = (over) => Object.assign({ id: 'n-x', title: 'x', kind: 'note', status: 'active', inject: false, useCount: 0, tags: [], mergedFrom: [], updatedAt: isoOld, body: '' }, over)
    const rr = ns73.suggestCandidates([mkN({ id: 'n-ctl', title: '孤儿对照' }), mkN({ id: 'n-sys', kind: 'sys', title: 'sys系统笔记' })], 90)
    assert(rr.orphanCandidates.some(o => o.id === 'n-ctl'), '孤儿对照（kind=note）被提名（判据有效性）')
    assert(!rr.orphanCandidates.some(o => o.id === 'n-sys'), 'kind=sys 永不被孤儿清理提名（豁免面收口）')
    assert(!rr.staleCandidates.some(o => o.id === 'n-sys'), 'kind=sys 永不被过期清理提名')
    const sg = await handlers['notes-suggest']({})
    assert(!sg.error, 'notes-suggest 可用')
    assert(!(sg.orphanCandidates || []).some(o => o.id === s1.id), 'RPC 面：kind=sys 不进孤儿候选')
    assert(!(sg.staleCandidates || []).some(o => o.id === s1.id), 'RPC 面：kind=sys 不进过期候选')
    await handlers['notes-delete']({ id: s1.id })
  })

  await t('开关联动：资料开注入 → 自动落缺省行（whenToUse=标题）；notes-mount 换文案（同笔记唯一行）；改约定桶 → 摘行', async () => {
    // 0.4.3 验收修复④：行级操作前正文快照（收尾逐字节比对 = 换文案幂等不重复行 + 说明块/pre 区零触碰锁）
    const mlPre = await handlers['notes-mount-list']({})
    const bodySnap = (await handlers['notes-get']({ id: mlPre.indexNoteId })).note.body
    const c = await handlers['notes-create']({ title: '索引联动资料A', body: '联动正文A（不应全文注入）', inject: true, injectRole: 'reference', topic: '资料' })
    assert(c && c.id && !c.error, '创建资料成功')
    let ml = await handlers['notes-mount-list']({})
    let hit = ml.lines.filter(l => l.id === c.id)
    assert.strictEqual(hit.length, 1, '开注入自动落行恰一行（实得 ' + hit.length + '）')
    // 行格式归一锁（0.4.3 验收修复④）：raw 带「何时查我：」机器前缀，when = 纯文案（前缀已剥离）
    assert(hit[0].raw.indexOf('- [[' + c.id + ']] 何时查我：') === 0, '挂载行带「何时查我：」前缀（实得行：' + hit[0].raw + '）')
    assert.strictEqual(hit[0].when, '索引联动资料A', '缺省 whenToUse = 标题（纯文案，无前缀残留）')
    // 换文案（幂等：同键摘旧行落新行）
    const m = await handlers['notes-mount']({ id: c.id, whenToUse: '调 e2e 断言口径时查我' })
    assert(m && m.ok === true && m.indexNoteId === ml.indexNoteId, 'notes-mount 换文案成功')
    ml = await handlers['notes-mount-list']({})
    hit = ml.lines.filter(l => l.id === c.id)
    assert.strictEqual(hit.length, 1, '同笔记唯一行（重挂载 = 换文案非加行）')
    assert(hit[0].when === '调 e2e 断言口径时查我', 'whenToUse 已更新')
    assert(hit[0].raw === '- [[' + c.id + ']] 何时查我：调 e2e 断言口径时查我', '换文案后行形态 = - [[id]] 何时查我：文案（逐字节）')
    // 改约定桶 → 摘行
    await handlers['notes-update']({ id: c.id, injectRole: 'convention' })
    ml = await handlers['notes-mount-list']({})
    assert(ml.lines.every(l => l.id !== c.id), '改约定桶后摘行')
    // 改回资料 → 缺省行回归
    await handlers['notes-update']({ id: c.id, injectRole: 'reference' })
    ml = await handlers['notes-mount-list']({})
    hit = ml.lines.filter(l => l.id === c.id)
    assert(hit.length === 1 && hit[0].when === '索引联动资料A', '改回资料后缺省行回归（whenToUse=标题纯文案）')
    await handlers['notes-delete']({ id: c.id })
    // 说明块逐字节保留 + 幂等零残留：挂载/换文案/摘行全循环后索引正文回到快照逐字节相等
    const gIdx = await handlers['notes-get']({ id: ml.indexNoteId })
    assert.strictEqual(gIdx.note.body, bodySnap, '行级操作全循环后索引正文逐字节还原（说明块逐字节保留 + 不重复行）')
  })

  // ---- 73.1.6 0.4.3 验收修复④：存量无前缀行解析兼容（零迁移）----
  await t('存量兼容：v1 无前缀旧行解析照常（when=纯文案零迁移）+ 还原逐字节', async () => {
    const ml0 = await handlers['notes-mount-list']({})
    const g0 = await handlers['notes-get']({ id: ml0.indexNoteId })
    const body0 = g0.note.body
    // 直写 v1 旧格式行（无「何时查我：」前缀，模拟升级前存量索引）——追加到 §1 节尾（body0 以 §1 锚收尾）
    const LEGACY = '- [[n-legacy-compat73]] 存量无前缀文案'
    const u = await handlers['notes-update']({ id: ml0.indexNoteId, body: body0 + LEGACY + '\n' })
    assert(!u.error, '索引正文可直改（存量行注入前置）')
    const ml = await handlers['notes-mount-list']({})
    const hit = ml.lines.filter(l => l.id === 'n-legacy-compat73')
    assert.strictEqual(hit.length, 1, '存量无前缀行照常解析（零迁移；实得 ' + hit.length + '）')
    assert.strictEqual(hit[0].when, '存量无前缀文案', '无前缀行 when = 行尾纯文案')
    assert.strictEqual(hit[0].raw, LEGACY, 'raw 行原样保留')
    // 还原 → 逐字节归零（不留死链行——节 75 守卫②依赖索引零死挂载边收口态）
    await handlers['notes-update']({ id: ml0.indexNoteId, body: body0 })
    assert.strictEqual((await handlers['notes-get']({ id: ml0.indexNoteId })).note.body, body0, '索引正文逐字节还原')
  })

  await t('删笔记 → 清行 + 图内核死链消除（软删/彻底删双通道）', async () => {
    const c = await handlers['notes-create']({ title: '索引删除联动B', body: 'B', inject: true, injectRole: 'reference', topic: '资料' })
    let ml = await handlers['notes-mount-list']({})
    assert(ml.lines.some(l => l.id === c.id), '挂载行在位（前置）')
    // 软删 → 清行
    await handlers['notes-delete']({ id: c.id })
    ml = await handlers['notes-mount-list']({})
    assert(ml.lines.every(l => l.id !== c.id), '软删后清行')
    // 图查询：无指向该笔记的死挂载边（行摘了死链自然不出现）
    const g1 = await handlers['notes-graph']({ type: 'mount' })
    assert(!(g1.dead || []).some(d => d.target === c.id || d.from === c.id), '软删后无死挂载边（实得：' + JSON.stringify((g1.dead || []).slice(0, 5)) + '）')
    // 恢复 → 不自动回挂（挂载是显式动作）→ 彻底删 → 仍无行
    await handlers['notes-restore']({ id: c.id })
    ml = await handlers['notes-mount-list']({})
    assert(ml.lines.every(l => l.id !== c.id), '恢复不自动回挂（显式动作语义）')
    await handlers['notes-update']({ id: c.id, injectRole: 'reference' })   // 重挂（缺省行）
    await handlers['notes-delete']({ id: c.id })
    await handlers['notes-purge']({ id: c.id })
    ml = await handlers['notes-mount-list']({})
    assert(ml.lines.every(l => l.id !== c.id), '彻底删后仍无行（purge 双通道）')
  })

  await t('管线行为：约定桶全文不动（红线锁）+ 目录段挂载行 = 索引 §1 逐行（whenToUse 行 + note_get 轻推）+ 资料正文不再全文注入', async () => {
    const cv = await handlers['notes-create']({ title: '红线约定C', body: 'REDLINE-CONV-BODY-逐字节锁定', inject: true, topic: '约定' })
    const rf = await handlers['notes-create']({ title: '管线资料D', body: 'REF-FULL-BODY-不应出现', inject: true, injectRole: 'reference', topic: '资料' })
    await handlers['notes-mount']({ id: rf.id, whenToUse: '查管线装配形态时' })
    const r = await handlers['notes-conventions']({})
    const iConv = r.text.indexOf('用户约定（须遵守）：')
    const iRef = r.text.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：')
    assert(iConv >= 0 && iRef >= 0, '约定桶 + 目录段引导词并列（0.4.3③ 合并段；实得：' + r.text.slice(0, 120) + '）')
    assert(iConv < iRef, '约定桶在目录段之前')
    // 红线锁：约定桶全文逐字节在位（约定桶内容断言不变）
    assert(r.text.indexOf('REDLINE-CONV-BODY-逐字节锁定') >= 0, '约定桶全文注入不动（红线）')
    assert(r.text.indexOf('红线约定C') > iConv && r.text.indexOf('红线约定C') < iRef, 'convention 笔记列在约定桶下')
    // 目录段挂载行 = 索引行（whenToUse + [[链接]]），非全文
    assert(r.text.indexOf('- [[' + rf.id + ']] 何时查我：查管线装配形态时') >= 0, '目录段含挂载行（「何时查我：」前缀 + whenToUse + 链接，排前增强态；0.4.3 验收修复④行格式归一）')
    // Verifier 驳回②回归锁：真实挂载行必须行首单横线 `- [[id]]`（前端行解析正则 ^- \[\[? 可点契约）——子串断言会被 `- - [[` 双横线骗过，必须行首锚定
    const mountRow73 = r.text.split('\n').filter(l => l.indexOf('[[' + rf.id + ']]') >= 0)[0] || ''
    const mm73 = mountRow73.match(/^- \[\[?(n-[A-Za-z0-9]+)\]\]?/)
    assert(mm73 && mm73[1] === rf.id, '真实挂载行行首单横线可被前端同口径正则解析出 id（实得行：' + mountRow73 + '）')
    assert(r.text.indexOf('- - [[') < 0, '注入全文无 `- - [[` 双横线挂载行（驳回②回归锁）')
    assert(r.text.indexOf('REF-FULL-BODY-不应出现') < 0, '资料正文不再全文注入（管线切换）')
    assert(r.text.indexOf('（以上为挂载索引行：正文用 note_get <id> 获取）') >= 0, 'note_get 轻推提示行在位')
    await handlers['notes-delete']({ id: cv.id })
    await handlers['notes-delete']({ id: rf.id })
  })

  // ---- 73.2 无索引回退空目录段 + 升级首启自愈（独立 ESM 实例 + 独立 store）----
  await t('独立实例：升级首启自动建索引 + 无索引（空 §1）→ 回退空目录段 + 约定桶不受影响', async () => {
    const store73 = new Map()
    const NOTES_ROOT73 = path.join(osNative.homedir(), '.dsh', 'notes')   // 静态包 NOTES_ROOT 同口径（fs 全 mock，零真实磁盘触碰）
    const fsMock73 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT73 ? { dir: true } : (store73.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store73.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store73.has(p)) throw new Error('ENOENT: ' + p); return store73.get(p) },
      writeText: async (p, c) => { store73.set(p, c) },
    }
    const contexts73 = []
    const handlers73 = {}
    const agents73 = { currentInitiator: () => ({ sessionId: 'session-abc12345-0000-0000-0000-000000000000', session: { id: 'session-abc12345-0000-0000-0000-000000000000', header: { cwd: 'D:\\deepseek-work' } } }), roots: () => [], get: () => undefined }
    const ctx73 = {
      fs: fsMock73, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: S.llmMock, agentDefaultModel: S.admMock, agents: agents73, systemPrompt: { context: (c) => { contexts73.push(c); return () => {} } }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
      effect: () => {}, on: () => () => {},
    }
    const globalHarness = global.harness
    global.harness = { handle: (n, f) => { handlers73[n] = f; return () => { delete handlers73[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    try {
      const { pathToFileURL } = require('url')
      const mod73 = await import(pathToFileURL(path.join(DIR, 'packages', 'dsh-notes-plugin', 'index.mjs')).href + '?inject-index=1')
      mod73.apply(ctx73)
    } finally { global.harness = globalHarness }
    const convCtx73 = contexts73.find(x => x.name === 'notes:workspace-conventions')
    // 升级首启：异步 idxEnsure 沉降后索引在位
    let ml = null
    for (let i = 0; i < 40 && !(ml && ml.indexNoteId); i++) { await new Promise(r => setTimeout(r, 25)); ml = await handlers73['notes-mount-list']({}) }
    assert(ml && ml.indexNoteId, '升级首启自动建「注入索引（自动）」（实得：' + JSON.stringify(ml).slice(0, 120) + '）')
    assert(ml.lines.length === 0, '新实例索引空 §1')
    // 0.4.3 验收修复④ 断言①：新建索引 body 逐字节 = v2 预设（说明块 + §1 单节，无 §2）
    const gIdx73 = await handlers73['notes-get']({ id: ml.indexNoteId })
    const PRESET_V2 = '机器托管笔记（请勿删除）：§1 每行 = 一条注入载荷（agent 系统提示会看到此行），格式：- [[笔记id]] 何时查我：<一句话说明何时该读这篇>；可直接编辑冒号后的文案，请保持行首 `- [[id]]` 结构。\n\n## §1 挂载清单\n'
    assert.strictEqual(gIdx73.note.body, PRESET_V2, '新建索引 body 逐字节 = v2 预设（说明块 + §1 单节；实得：' + JSON.stringify(gIdx73.note.body) + '）')
    assert(gIdx73.note.body.indexOf('§2') < 0, '新建索引不含「§2」字样（§2 出预设，指标迁出走卡⑤）')
    // 无挂载行（且 catalog 缺省关）→ 目录段整段空（不出目录段标题）
    const f0 = convCtx73.text()
    assert(f0.indexOf('本地笔记库目录（') < 0, '空 §1 + catalog 关 → 目录段整段空（0.4.3③ 断言①；实得：' + f0.slice(0, 120) + '）')
    // 建约定 → 约定桶照常，仍无目录段（约定桶不受管线切换影响）
    const cv = await handlers73['notes-create']({ title: '独立约定E', body: 'E-CONV-BODY', inject: true, topic: '约定' })
    const f1 = convCtx73.text()
    assert(f1.indexOf('用户约定（须遵守）：') >= 0 && f1.indexOf('E-CONV-BODY') >= 0, '约定桶全文注入不受管线切换影响')
    assert(f1.indexOf('本地笔记库目录（') < 0, '约定单桶命中仍无目录段标题')
    // 挂载一行 → 目录段出现 whenToUse 行（en/zh 装配内容含 whenToUse 行 = 管线行为级验证）
    const rf = await handlers73['notes-create']({ title: '独立资料F', body: 'F-FULL-BODY', inject: true, injectRole: 'reference', topic: '资料' })
    await handlers73['notes-mount']({ id: rf.id, whenToUse: '何时查我-装配验证' })
    const f2 = convCtx73.text()
    assert(f2.indexOf('本地笔记库目录（') >= 0 && f2.indexOf('- [[' + rf.id + ']] 何时查我：何时查我-装配验证') >= 0, '目录段含挂载行（catalog 关 + 有挂载行 → 段内仅挂载行，断言②；0.4.3④ 前缀归一）')
    // 驳回②回归锁（独立实例同口径）：真实挂载行行首单横线可解析 + 无双横线
    const mountRow73b = f2.split('\n').filter(l => l.indexOf('[[' + rf.id + ']]') >= 0)[0] || ''
    const mm73b = mountRow73b.match(/^- \[\[?(n-[A-Za-z0-9]+)\]\]?/)
    assert(mm73b && mm73b[1] === rf.id, '独立实例真实挂载行行首单横线可解析（实得行：' + mountRow73b + '）')
    assert(f2.indexOf('- - [[') < 0, '独立实例注入文本无双横线挂载行')
    assert(f2.indexOf('F-FULL-BODY') < 0, '资料正文不全文注入（独立实例复验）')
  })

  // ---- 73.3 0.4.3 验收修复（notes-043-preview-when-edit）：LLM 预填 whenToUse + 预览目录行点击补充/编辑 ----
  await t('0.4.3 验收修复落地结构：when-suggest 标记块 server 双变体逐字节一致 + 双包注册 + 超时/摘要/单行锚', () => {
    const read73 = (rel) => fsNative.readFileSync(path.join(DIR, 'src', 'host', rel), 'utf8')
    const grabW = (s, tag) => { const m = s.match(/\/\/ ==== when-suggest BEGIN ====[\s\S]*?\/\/ ==== when-suggest END ====/); assert(m, tag + ' 缺 when-suggest 标记块'); return m[0] }
    assert.strictEqual(grabW(read73('server.js'), 'server.js'), grabW(read73('server.dist.js'), 'server.dist.js'), 'when-suggest 标记块双变体逐字节一致（server.js ⇄ server.dist.js 改一边忘另一边）')
    for (const pair of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      const s = pair[0], tag = pair[1]
      assert(s.indexOf("handle('notes-when-suggest'") >= 0, tag + ' notes-when-suggest RPC 注册')
      assert(s.indexOf('const WHEN_SUGGEST_TIMEOUT_MS = 8000') >= 0, tag + ' 8s 超时锚')
      assert(s.indexOf('.slice(0, 1200)') >= 0, tag + ' 正文前 1200 字摘要锚')
      assert(s.indexOf('.slice(0, 40)') >= 0, tag + ' 单行 ≤40 字截断锚')
      assert(s.indexOf('resolveLlmSelection()') >= 0, tag + ' LLM 选择复用（settingsCache.llm 优先/跟随会话）')
    }
  })

  await t('notes-when-suggest fixture：mock llm 单行草稿（≤40字无换行）；笔记缺失/缺 id/无 llm → {error}（client 回退标题路径恒在）', async () => {
    const c = await handlers['notes-create']({ title: '草稿源笔记73', body: '断言口径正文摘要', topic: '开发' })
    assert(c && c.id && !c.error, 'fixture 笔记创建成功')
    const r = await handlers['notes-when-suggest']({ id: c.id })
    assert(r && r.ok === true && typeof r.suggestion === 'string', '返回单行草稿（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.suggestion, '排查断言口径时查我', 'mock 草稿原文（helpers llmMock 挂载助手分支）')
    assert(r.suggestion.indexOf('\n') < 0 && Array.from(r.suggestion).length <= 40, '单行 ≤40 字')
    assert.strictEqual(r.id, c.id, '回传 id')
    const miss = await handlers['notes-when-suggest']({ id: 'n-not-exist-73' })
    assert(miss && !!miss.error, '笔记不存在 → {error}（实得 ' + JSON.stringify(miss) + '）')
    const noId = await handlers['notes-when-suggest']({})
    assert(noId && !!noId.error, '缺 id → {error}')
    await handlers['notes-delete']({ id: c.id })
    // 无 llm 隔离实例（32.2/73.2 同款隔离模式）：get 映射故意不含 llm —— llm 不可用 → {error}，绝不抛错阻断挂载
    const storeW = new Map()
    const fsMockW = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeW.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeW.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeW.has(p)) throw new Error('ENOENT: ' + p); return storeW.get(p) },
      writeText: async (p, c2) => { storeW.set(p, c2) },
    }
    const handlersW = {}
    const harnessMockW = { handle: (n2, fn) => { handlersW[n2] = fn; return () => { delete handlersW[n2] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockW, DIR).apply({
      fs: fsMockW, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ agentDefaultModel: S.admMock, agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],   // llm 故意缺席
      effect: () => {},
    })
    const cw = await handlersW['notes-create']({ title: '无LLM笔记73', body: 'x', topic: '开发' })
    const rw = await handlersW['notes-when-suggest']({ id: cw.id })
    assert(rw && !!rw.error, '无 llm → {error}（实得 ' + JSON.stringify(rw) + '）')
  })

  await t('草稿→确认链路：notes-mount 落 §1 行含草稿文案 + 幂等重挂不重复行 + 编辑换文案生效（弹层确认路径行为级）', async () => {
    const c = await handlers['notes-create']({ title: '挂载链路73', body: 'x', inject: true, injectRole: 'reference', topic: '资料' })
    assert(c && c.id && !c.error, '创建资料成功（开注入自动落缺省行）')
    const sug = await handlers['notes-when-suggest']({ id: c.id })
    assert(sug && sug.ok === true, 'LLM 草稿生成（前置）')
    const m1 = await handlers['notes-mount']({ id: c.id, whenToUse: sug.suggestion })
    assert(m1 && m1.ok === true, '确认挂载成功')
    let ml = await handlers['notes-mount-list']({})
    let hit = ml.lines.filter(l => l.id === c.id)
    assert.strictEqual(hit.length, 1, 'mount-list 含草稿行恰一行（覆盖缺省行）')
    assert.strictEqual(hit[0].when, sug.suggestion, '行文案 = LLM 草稿')
    await handlers['notes-mount']({ id: c.id, whenToUse: sug.suggestion })
    ml = await handlers['notes-mount-list']({})
    assert.strictEqual(ml.lines.filter(l => l.id === c.id).length, 1, '幂等重挂不重复行')
    await handlers['notes-mount']({ id: c.id, whenToUse: '编辑后新文案73' })
    ml = await handlers['notes-mount-list']({})
    hit = ml.lines.filter(l => l.id === c.id)
    assert.strictEqual(hit.length, 1, '编辑换文案仍唯一行')
    assert.strictEqual(hit[0].when, '编辑后新文案73', '编辑模式换文案生效')
    await handlers['notes-delete']({ id: c.id })
  })

  await t('预览目录行点击：双端同构锚（解析正则/点击链路/桥中转）+ i18n 三键 + 样式双端 + 真实目录段 🔒 行解析 id 正确', async () => {
    const ROW_RE_73 = /^- \[\[?(n-[A-Za-z0-9]+)\]\]?/   // 0.4.3③ 合并段：挂载行 - [[id]] 与普通行 - [id] 同段同正则
    const en = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    const zh = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    for (const k of ['inj.mountEdit', 'inj.mountAdd', 'inj.mountGen']) {
      assert(en.indexOf("'" + k + "':") >= 0, 'en 缺 ' + k)
      assert(zh.indexOf("'" + k + "':") >= 0, 'zh 缺 ' + k)
    }
    // client 端锚：行解析/点击函数 + 正则同口径 + panelBridge 中转（modals 禁横向引用）+ MountModal 双模式 + touched 防覆盖
    assert(clientSrc.indexOf('function openMountFromPreview(') >= 0 && clientSrc.indexOf('function injPrevDirectoryRows(') >= 0, 'client 目录段行解析/点击函数在位（0.4.3③ 单段）')
    assert(clientSrc.indexOf("ln.match(/^- \\[\\[?(n-[A-Za-z0-9]+)\\]\\]?/)") >= 0, 'client 行解析正则锚（🔒 行/挂载行同口径）')
    assert(clientSrc.indexOf('if (panelBridge.openMountModal) panelBridge.openMountModal({ id: id') >= 0, 'client 点击经 panelBridge.openMountModal 中转')
    assert(clientSrc.indexOf('panelBridge.openMountModal = openMountModal') >= 0, 'client 面板装配层回填 panelBridge.openMountModal')
    assert(clientSrc.indexOf("host.call('notes-when-suggest', { id: n.id })") >= 0, 'client MountModal 开弹层调 notes-when-suggest')
    assert(clientSrc.indexOf("tt('inj.mountEdit')") >= 0 && clientSrc.indexOf("tt('inj.mountGen')") >= 0 && clientSrc.indexOf("tt('inj.mountAdd')") >= 0, 'client 三键接线（编辑标题/生成中占位/行 tooltip）')
    assert(clientSrc.indexOf('generating: !edit') >= 0 && clientSrc.indexOf('touched: true') >= 0 && clientSrc.indexOf('m.touched ? { generating: false }') >= 0, 'client 双模式 + touched 防覆盖锚')
    // app 端锚（模板串形态，同构）
    const appMgr = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'inject-manager.js'), 'utf8')
    const appPv = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'inject-preview.js'), 'utf8')
    assert(appPv.indexOf('function renderInjPrevDirectory(') >= 0 && appPv.indexOf('function openMountFromPreview(') >= 0, 'app 目录段行渲染/点击函数在位（0.4.3③ 单段）')
    assert(appPv.indexOf("ln.match(/^- \\[\\[?(n-[A-Za-z0-9]+)\\]\\]?/)") >= 0, 'app 行解析正则锚（与 client 同口径）')
    assert(appPv.indexOf('openMountModal({ id: id, title: g.note.title || id, existing: line ? line.when : undefined })') >= 0, 'app 点击开挂载弹层（已挂载=编辑模式预填现有文案/未挂载=LLM 草稿）')
    assert(appMgr.indexOf("rpc('notes-when-suggest', { id: n.id })") >= 0, 'app MountModal 开弹层调 notes-when-suggest')
    assert(appMgr.indexOf("t('inj.mountEdit')") >= 0 && appMgr.indexOf("t('inj.mountGen')") >= 0 && appPv.indexOf("t('inj.mountAdd')") >= 0, 'app 三键接线')
    assert(appMgr.indexOf('generating: !edit') >= 0 && appMgr.indexOf('mountState.touched') >= 0, 'app 双模式 + touched 防覆盖锚')
    // 样式双端
    const css73 = fsNative.readFileSync(path.join(DIR, 'src', 'styles.css'), 'utf8')
    const head73 = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'shell', 'head.html'), 'utf8')
    assert(css73.indexOf('.dsh-notes-injprev-hit{') >= 0 && css73.indexOf('.dsh-notes-injprev-hit:hover{') >= 0, 'client styles.css 可点行样式')
    assert(head73.indexOf('.injprev-ln.hit{') >= 0 && head73.indexOf('.injprev-ln.hit:hover{') >= 0, 'app head.html 可点行样式')
    // 真实管线：共享实例造敏感笔记 → 目录预览含 🔒 行 → 同正则解析 id 正确（catalogEnabled 显式开，测后恢复缺省关）
    const sg0 = await handlers['notes-settings-get']({})
    const hadCatalog = !!(sg0.settings && sg0.settings.catalogEnabled === true)
    await handlers['notes-settings-set']({ catalogEnabled: true })
    const sn = await handlers['notes-create']({ title: '敏感目录行73 token: ghp_x73', body: 'x', sensitive: true, topic: '敏感' })
    const pv = await handlers['notes-inject-preview']({})
    const row73 = (pv.catalog || '').split('\n').filter(l => l.indexOf(sn.id) >= 0)[0] || ''
    assert(row73.indexOf('🔒') >= 0, '敏感行进目录且打码带 🔒（实得：' + row73 + '）')
    assert(row73.indexOf('ghp_x73') < 0, '打码行不含明文 token')
    const m73 = row73.match(ROW_RE_73)
    assert(m73 && m73[1] === sn.id, '🔒 行解析 id 正确（实得 ' + (m73 && m73[1]) + '）')
    await handlers['notes-delete']({ id: sn.id })
    // 驳回②核心交付回归锁：真实挂载行进预览 directory → 同正则行首解析出 id（=挂载行在预览同段可点）+ 无双横线
    // （此前套件只拿普通行验正则，真实挂载行 `- - [[id]]` 双横线从未被测到——本节起行为级锁死）
    const mnt73 = await handlers['notes-create']({ title: '预览挂载行73', body: 'x', inject: true, injectRole: 'reference', topic: '资料' })
    await handlers['notes-mount']({ id: mnt73.id, whenToUse: '预览点击回归锁' })
    const pv2 = await handlers['notes-inject-preview']({})
    const mrow73 = (pv2.directory || '').split('\n').filter(l => l.indexOf('[[' + mnt73.id + ']]') >= 0)[0] || ''
    const mm732 = mrow73.match(ROW_RE_73)
    assert(mm732 && mm732[1] === mnt73.id, '预览 directory 真实挂载行可被同正则解析（=可点契约；实得行：' + mrow73 + '）')
    assert(mrow73.indexOf('预览点击回归锁') >= 0, '预览挂载行含 whenToUse 文案（§1 行原样进段）')
    assert((pv2.directory || '').indexOf('- - [[') < 0, '预览 directory 无双横线挂载行')
    await handlers['notes-delete']({ id: mnt73.id })
    if (!hadCatalog) await handlers['notes-settings-set']({ catalogEnabled: null })
  })
  }
}
