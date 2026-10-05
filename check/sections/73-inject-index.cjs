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
      // 开关联动：_create/_update/_delete/_purge 单点收口包装（RPC 域包装保留；graph 增量 0.4.3+ 已迁 onNoteChanged 事件总线）
      assert(src.indexOf('_idxSyncMount(') >= 0 && src.indexOf('const _idxUpdateOrig = _update') >= 0, tag + ' _update 包装联动')
      assert(src.indexOf('const _idxCreateOrig = _create') >= 0 && src.indexOf('const _idxDeleteOrig = _delete') >= 0 && src.indexOf('const _idxPurgeOrig = _purge') >= 0, tag + ' create/delete/purge 包装联动（删笔记→清行）')
      // 管线切换（inject.js 双变体）：reference 桶 = 索引 §1 逐行
      assert(src.indexOf('const refBlocks = idxLinesSync()') >= 0, tag + ' 管线切换：reference 桶 = 索引 §1 逐行（idxLinesSync）')
      assert(src.indexOf('（以上为挂载索引行：正文用 note_get <id> 获取）') >= 0, tag + ' 资料桶 note_get 轻推提示行')
      // 启动装配：升级首启 idxEnsure
      assert(src.indexOf('idxEnsure()') >= 0, tag + ' 启动装配 idxEnsure（升级首启自动建索引）')
    }
  })

  await t('挂载弹层双端落地（client + app）+ i18n 全 key 化（en/zh 同 key 集）+ 样式双端', () => {
    // client（React e() 形态）
    assert(clientSrc.indexOf('function MountModal(') >= 0 && clientSrc.indexOf('function openMountModal(') >= 0, 'client 挂载弹层组件在位（MountModal/openMountModal）')
    assert(clientSrc.indexOf("host.call('notes-mount', { id: m.id, whenToUse: m.when })") >= 0, 'client 确认落行走 notes-mount RPC')
    assert(clientSrc.indexOf("if (role === 'reference') { setInjMgrOpen(false); injMgrBackRef.current = null; openMountModal(") >= 0, 'client 注入管理行：设为资料 → 弹层（modal 不叠 modal）')
    assert(clientSrc.indexOf('e(MountModal)') >= 0, 'client 面板挂载 MountModal 渲染')
    // app（模板串形态）
    const appSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'inject-manager.js'), 'utf8')
    assert(appSrc.indexOf('function openMountModal(') >= 0 && appSrc.indexOf("rpc('notes-mount', { id: mountState.id, whenToUse: mountState.when })") >= 0, 'app 挂载弹层在位 + notes-mount 通道')
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
    assert(g.note.body.indexOf('## §2 召回指标') >= 0, '§2 召回指标占位节在位（卡 6 填充）')
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
    assert(ledSrc.indexOf("{ kind: 'sys', inject: false, recall: false }") >= 0, 'ledger 档案懒创建 kind=sys')
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
    const c = await handlers['notes-create']({ title: '索引联动资料A', body: '联动正文A（不应全文注入）', inject: true, injectRole: 'reference', topic: '资料' })
    assert(c && c.id && !c.error, '创建资料成功')
    let ml = await handlers['notes-mount-list']({})
    let hit = ml.lines.filter(l => l.id === c.id)
    assert.strictEqual(hit.length, 1, '开注入自动落行恰一行（实得 ' + hit.length + '）')
    assert(hit[0].when.indexOf('索引联动资料A') >= 0, '缺省 whenToUse = 标题')
    // 换文案（幂等：同键摘旧行落新行）
    const m = await handlers['notes-mount']({ id: c.id, whenToUse: '调 e2e 断言口径时查我' })
    assert(m && m.ok === true && m.indexNoteId === ml.indexNoteId, 'notes-mount 换文案成功')
    ml = await handlers['notes-mount-list']({})
    hit = ml.lines.filter(l => l.id === c.id)
    assert.strictEqual(hit.length, 1, '同笔记唯一行（重挂载 = 换文案非加行）')
    assert(hit[0].when === '调 e2e 断言口径时查我', 'whenToUse 已更新')
    // 改约定桶 → 摘行
    await handlers['notes-update']({ id: c.id, injectRole: 'convention' })
    ml = await handlers['notes-mount-list']({})
    assert(ml.lines.every(l => l.id !== c.id), '改约定桶后摘行')
    // 改回资料 → 缺省行回归
    await handlers['notes-update']({ id: c.id, injectRole: 'reference' })
    ml = await handlers['notes-mount-list']({})
    hit = ml.lines.filter(l => l.id === c.id)
    assert(hit.length === 1 && hit[0].when.indexOf('索引联动资料A') >= 0, '改回资料后缺省行回归（whenToUse=标题）')
    // §2 指标节逐字节保留（机器只行级操作红线）
    const gIdx = await handlers['notes-get']({ id: ml.indexNoteId })
    assert(gIdx.note.body.indexOf('## §2 召回指标') >= 0, '多次行级操作后 §2 节原样保留')
    await handlers['notes-delete']({ id: c.id })
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

  await t('管线行为：约定桶全文不动（红线锁）+ 资料桶 = 索引 §1 逐行（whenToUse 行 + note_get 轻推）+ 资料正文不再全文注入', async () => {
    const cv = await handlers['notes-create']({ title: '红线约定C', body: 'REDLINE-CONV-BODY-逐字节锁定', inject: true, topic: '约定' })
    const rf = await handlers['notes-create']({ title: '管线资料D', body: 'REF-FULL-BODY-不应出现', inject: true, injectRole: 'reference', topic: '资料' })
    await handlers['notes-mount']({ id: rf.id, whenToUse: '查管线装配形态时' })
    const r = await handlers['notes-conventions']({})
    const iConv = r.text.indexOf('用户约定（须遵守）：')
    const iRef = r.text.indexOf('参考资料（与当前任务相关时按需取用）：')
    assert(iConv >= 0 && iRef >= 0, '双桶引导词并列（实得：' + r.text.slice(0, 120) + '）')
    assert(iConv < iRef, '约定桶在资料桶之前')
    // 红线锁：约定桶全文逐字节在位（约定桶内容断言不变）
    assert(r.text.indexOf('REDLINE-CONV-BODY-逐字节锁定') >= 0, '约定桶全文注入不动（红线）')
    assert(r.text.indexOf('红线约定C') > iConv && r.text.indexOf('红线约定C') < iRef, 'convention 笔记列在约定桶下')
    // 资料桶 = 索引行（whenToUse + [[链接]]），非全文
    assert(r.text.indexOf('- [[' + rf.id + ']] 查管线装配形态时') >= 0, '资料桶含挂载行（whenToUse + 链接）')
    assert(r.text.indexOf('REF-FULL-BODY-不应出现') < 0, '资料正文不再全文注入（管线切换）')
    assert(r.text.indexOf('（以上为挂载索引行：正文用 note_get <id> 获取）') >= 0, 'note_get 轻推提示行在位')
    await handlers['notes-delete']({ id: cv.id })
    await handlers['notes-delete']({ id: rf.id })
  })

  // ---- 73.2 无索引回退空 reference 桶 + 升级首启自愈（独立 ESM 实例 + 独立 store）----
  await t('独立实例：升级首启自动建索引 + 无索引（空 §1）→ 回退空 reference 桶 + 约定桶不受影响', async () => {
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
    // 无挂载行 → 回退空 reference 桶（不出资料桶引导词）
    const f0 = convCtx73.text()
    assert(f0.indexOf('参考资料（与当前任务相关时按需取用）：') < 0, '空 §1 → 回退空 reference 桶（实得：' + f0.slice(0, 120) + '）')
    // 建约定 → 约定桶照常，仍无资料桶（约定桶不受管线切换影响）
    const cv = await handlers73['notes-create']({ title: '独立约定E', body: 'E-CONV-BODY', inject: true, topic: '约定' })
    const f1 = convCtx73.text()
    assert(f1.indexOf('用户约定（须遵守）：') >= 0 && f1.indexOf('E-CONV-BODY') >= 0, '约定桶全文注入不受管线切换影响')
    assert(f1.indexOf('参考资料（与当前任务相关时按需取用）：') < 0, '约定单桶命中仍只出该桶标题')
    // 挂载一行 → 资料桶出现 whenToUse 行（en/zh 装配内容含 whenToUse 行 = 管线行为级验证）
    const rf = await handlers73['notes-create']({ title: '独立资料F', body: 'F-FULL-BODY', inject: true, injectRole: 'reference', topic: '资料' })
    await handlers73['notes-mount']({ id: rf.id, whenToUse: '何时查我-装配验证' })
    const f2 = convCtx73.text()
    assert(f2.indexOf('- [[' + rf.id + ']] 何时查我-装配验证') >= 0, '装配内容含 whenToUse 行')
    assert(f2.indexOf('F-FULL-BODY') < 0, '资料正文不全文注入（独立实例复验）')
  })
  }
}
