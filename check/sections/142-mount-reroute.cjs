// 节 142. 0.6.x（notes-070-mount-reroute，反馈 n-mw3buwdh39rd）：挂载弹层「注入范围」区——notes-mount 扩可选 injectTo
// 方案：已挂载笔记可在挂载语境直接追加目标会话（挂载行进哪个会话目录 = 目标笔记自己的 injectTo，0.5.0 notes-050-mount-scope）。
//   host：notes-mount { id, whenToUse?, injectTo? }——undefined 零迁移（存量调用全兼容）；传入先 _normInjectTo 归一（长 id→短 id），
//   非法整体拒绝（挂载不落行、范围与注入态全不动——错得安全）；翻档与落范围拆两态合并（需翻档 = 一次 _update 同带
//   inject/injectTo/injectRole；已翻档 = 单独补 injectTo patch）。双端弹层加「注入范围」区（会话多选，结构同 scope 浮层），
//   保守语义：scopeTouched 才随确认传 injectTo（不碰 = 缺参零迁移）。
// 红线：idxMount/idxEnsure/挂载⇔资料不变量单点收口逻辑不动（只扩参）；_normInjectTo 复用勿改；RPC 计数不变（53/54 锚不更新）；
//   三岔按钮语义（0.4.7-B④b）不动（106-ux-047b 锚复验）；injectindex.js 双清单共源单份（无 .dist 变体，节 73 口径）。
module.exports = {
  id: "142",
  title: "142. 挂载弹层「注入范围」区（notes-070-mount-reroute：notes-mount 扩可选 injectTo + 双端弹层范围多选）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc, clientSrc } = H
  const { handlers } = S
  section('142. 挂载弹层「注入范围」区（notes-070-mount-reroute：notes-mount 扩可选 injectTo + 双端弹层范围多选）')
  const FULL142 = 'session-abc12345-0000-0000-0000-000000000000'   // 节 2 mock 活跃 live 会话（短 id abc12345）

  // ===== 142.1 host 行为级：扩参落范围（归一/翻档合并）+ 预览 scope 过滤 + 幂等 =====
  await t('142 host 扩参行为级：injectTo 归一落盘 + 翻档合并一次 _update + 挂载行在 + 预览 scope 两态 + 同 id 重挂幂等', async () => {
    const cA = await handlers['notes-create']({ title: '挂载reroute甲', body: 'x', topic: '资料' })
    const mA = await handlers['notes-mount']({ id: cA.id, whenToUse: '挂载reroute文案甲', injectTo: [FULL142, 'abc12345'] })
    assert(mA && mA.ok === true, 'notes-mount 带 injectTo 成功（实得 ' + JSON.stringify(mA) + '）')
    const gA = await handlers['notes-get']({ id: cA.id })
    assert.deepStrictEqual(gA.note.injectTo, ['abc12345'], '长 id 归一短 id + 去重（实得 ' + JSON.stringify(gA.note.injectTo) + '）')
    assert(gA.note.inject === true && gA.note.injectRole === 'reference', '需翻档时合并一次 _update：翻 reference 档与落范围同链路（挂载⇔资料不变量不动）')
    const mlA = await handlers['notes-mount-list']({})
    assert.strictEqual(mlA.lines.filter(l => l.id === cA.id).length, 1, '挂载行落 §1（单行）')
    // 挂载行 scope 过滤两态（口径同节 32 L139：mount 后目录行随目标 injectTo 进出）
    const pvHit = await handlers['notes-inject-preview']({ sessionId: 'abc12345' })
    assert((pvHit.directory || '').indexOf('挂载reroute文案甲') >= 0, '命中会话视角：挂载行进目录段')
    const pvMiss = await handlers['notes-inject-preview']({ sessionId: 'bbb22222' })
    assert((pvMiss.directory || '').indexOf('挂载reroute文案甲') < 0, '非命中会话视角：挂载行出目录段')
    // 幂等：同 id 重挂（已翻档 + 带 injectTo = 单独补 injectTo patch 路径）不重复行 + 范围归一落盘
    const mA2 = await handlers['notes-mount']({ id: cA.id, whenToUse: '挂载reroute文案甲', injectTo: [FULL142] })
    assert(mA2 && mA2.ok === true, '已翻档 + 带 injectTo 重挂成功（实得 ' + JSON.stringify(mA2) + '）')
    const mlA2 = await handlers['notes-mount-list']({})
    assert.strictEqual(mlA2.lines.filter(l => l.id === cA.id).length, 1, '同 id 同范围重挂不重复行（幂等换文案）')
    const gA2 = await handlers['notes-get']({ id: cA.id })
    assert.deepStrictEqual(gA2.note.injectTo, ['abc12345'], '已翻档时单独补 injectTo patch：范围归一落盘 + 其余位不动（两态拆分）')
    await handlers['notes-delete']({ id: cA.id })
  })

  await t('142 host 错得安全：injectTo 非法整体拒绝（行未落 + 范围未动 + 注入态未翻）', async () => {
    const cB = await handlers['notes-create']({ title: '挂载reroute乙', body: 'x', topic: '资料' })
    const mB = await handlers['notes-mount']({ id: cB.id, whenToUse: '挂载reroute文案乙', injectTo: ['session-nosuch00-0000-0000-0000-000000000000'] })
    assert(mB && !!mB.error, '非法 injectTo 整体拒绝（实得 ' + JSON.stringify(mB) + '）')
    assert(mB.error.indexOf('无法解析') >= 0 && mB.error.indexOf('session-nosuch00') >= 0, '报错含具体无法解析值：' + mB.error)
    const gB = await handlers['notes-get']({ id: cB.id })
    assert(gB.note.inject !== true, '拒绝后注入态未翻（翻转先于落行——非法在任何写之前拒绝）')
    assert.deepStrictEqual(gB.note.injectTo, [], '拒绝后目标范围原状（[] 未动）')
    const mlB = await handlers['notes-mount-list']({})
    assert(mlB.lines.every(l => l.id !== cB.id), '拒绝后挂载行未落（失败停在原状）')
    await handlers['notes-delete']({ id: cB.id })
  })

  await t('142 host 零迁移红线：不传 injectTo = 现行为（目标存量范围原样不动 + 翻档语义不变）', async () => {
    const cC = await handlers['notes-create']({ title: '挂载reroute丙', body: 'x', topic: '资料', injectTo: ['xyz77777'] })
    const mC = await handlers['notes-mount']({ id: cC.id, whenToUse: '挂载reroute文案丙' })
    assert(mC && mC.ok === true, '缺省 notes-mount 成功（存量调用零迁移；实得 ' + JSON.stringify(mC) + '）')
    const gC = await handlers['notes-get']({ id: cC.id })
    assert.deepStrictEqual(gC.note.injectTo, ['xyz77777'], '不传 injectTo：目标存量范围原样不动（历史短 id 保留，零迁移红线）')
    assert(gC.note.inject === true && gC.note.injectRole === 'reference', '翻 reference 档语义不变（挂载⇔资料不变量不受扩参影响）')
    await handlers['notes-delete']({ id: cC.id })
  })

  await t('142 host 双产物扩参锚 + injectindex 共源单份（无 .dist 变体）+ _normInjectTo 复用勿改红线', () => {
    for (const [tag, src] of [['host 开发版拼接', hostSrc], ['静态包 index.mjs', indexSrc]]) {
      assert(src.indexOf('// 0.6.x（notes-070-mount-reroute，反馈 n-mw3buwdh39rd）：可选 injectTo') >= 0, tag + ' 扩参注释锚（index.mjs 需先跑 scripts/build-dist.cjs）')
      assert(src.indexOf('let injScope = undefined') >= 0 && src.indexOf('const ng = await _normInjectTo(args.injectTo)') >= 0, tag + ' 归一接线（_normInjectTo 复用勿改）')
      assert(src.indexOf("if (ng.error) return { error: 'notes-mount: ' + ng.error }") >= 0, tag + ' 非法整体拒绝（挂载不落行、范围不动）')
      assert(src.indexOf('true, injScope, undefined, undefined, ') >= 0, tag + ' 需翻档合并一次 _update（inject 第 8 参 + injectTo 第 9 参同链路）')
      assert(src.indexOf('undefined, injScope, undefined, undefined, undefined, undefined, undefined)') >= 0, tag + ' 已翻档单独补 injectTo patch（两态拆分）')
    }
    assert(!fsNative.existsSync(path.join(DIR, 'src', 'host', 'injectindex.dist.js')), 'injectindex.js 双清单共源单份（无 .dist 变体——第三份拷贝红线，节 73 口径；双包一致由 index.mjs 可复现断言看守）')
  })

  // ===== 142.2 双端弹层「注入范围」区静态锚 + i18n 双语 + 既有锚回归复验 =====
  await t('142 app 弹层范围区锚：范围区渲染/切换/确认传 injectTo（scopeTouched 保守语义）+ 既有挂载通道锚不破', () => {
    const appMgr = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'inject-manager.js'), 'utf8')
    assert(appMgr.indexOf('function renderMountScope()') >= 0 && appMgr.indexOf('function toggleMountScope(key)') >= 0, 'app 范围区渲染/切换函数在位')
    assert(appMgr.indexOf('id="injMountScope"') >= 0, 'app 弹层范围区宿主插槽（textarea 下方）')
    assert(appMgr.indexOf('data-mscope="') >= 0 && appMgr.indexOf('scopeHas(st.scope || [], s.short)') >= 0, 'app 范围区勾选态 scopeHas 归一比对（结构照抄 renderScopePanel 口径）')
    assert(appMgr.indexOf('scopeTouched: false') >= 0 && appMgr.indexOf('st.scopeTouched = true') >= 0, 'app scopeTouched 初值/置位（保守语义数据源）')
    assert(appMgr.indexOf('mountState.scopeTouched') >= 0 && appMgr.indexOf('whenToUse: mountState.when || mountState.title, injectTo: (mountState.scope || []).filter(function (v) { return v !== \'global\' && v !== \'workspace\' }).map(shortSid)') >= 0, 'app 确认链路：scopeTouched 才传 injectTo（过滤 global/workspace 存量值后落短 id）')
    // 既有锚回归复验（节 73 L56 / 106-ux-047b 三岔语义不破）
    assert(appMgr.indexOf("rpc('notes-mount', { id: mountState.id, whenToUse: mountState.when || mountState.title })") >= 0, 'app 缺省挂载通道锚原样在案（不碰范围 = 原调用形态，节 73 锚兼容）')
    assert(appMgr.indexOf('function openMountModal(n, onConfirm, onSkip)') >= 0 && appMgr.indexOf("mountState.onSkip ? t('inj.mountSkipSwitch')") >= 0, 'app 三岔按钮语义锚不破（0.4.7-B④b，106-ux-047b 复验）')
    // 范围初值兜底 + 会话数据源（notes-get / notes-sessions 两路迟到响应守卫）
    assert(appMgr.indexOf("rpc('notes-get', { id: n.id })") >= 0 && appMgr.indexOf('st.scopeTouched) return') >= 0, 'app 范围初值 notes-get 兜底（候选行缺 injectTo）+ 已动手不覆盖')
    assert(appMgr.indexOf("rpc('notes-sessions', {})") >= 0, 'app 会话清单数据源 notes-sessions（拉一次缓存于 mountState）')
    // 产物同步（app.html = src/app/** 拼接产物）
    const appHtml = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    assert(appHtml.indexOf('injMountScope') >= 0 && appHtml.indexOf('.inj-mount-scope{') >= 0, 'app.html 范围区 DOM/样式同步（需先跑 scripts/build-dist.cjs）')
  })

  await t('142 client 弹层范围区锚：store 切片/切换/确认传 injectTo + 发布包同步 + 样式双端', () => {
    assert(clientSrc.indexOf('function toggleMountScope(key)') >= 0 && clientSrc.indexOf('function mountScopeSel(m)') >= 0, 'client 范围区选择集/切换函数在位')
    assert(clientSrc.indexOf('scope: Array.isArray(n.injectTo) ? n.injectTo.slice() : null, scopeTouched: false, sess: [], sessPend: [], sessLoaded: false') >= 0, 'client store.modal.mount 切片扩 scope 族字段（打开即重置）')
    assert(clientSrc.indexOf('dsh-notes-inj-mount-scope-hint') >= 0 && clientSrc.indexOf('toggleMountScope(s.short)') >= 0 && clientSrc.indexOf('scopeHas(m.scope || [], s.short)') >= 0, 'client MountModal 范围区 JSX（提示行 + 会话勾选 + scopeHas 归一比对）')
    assert(clientSrc.indexOf("m.scopeTouched") >= 0 && clientSrc.indexOf('whenToUse: m.when || m.title, injectTo: (m.scope || []).filter(v => v !== \'global\' && v !== \'workspace\').map(shortSid)') >= 0, 'client 确认链路：scopeTouched 才传 injectTo（与 app 同口径）')
    assert(clientSrc.indexOf("host.call('notes-mount', { id: m.id, whenToUse: m.when || m.title })") >= 0, 'client 缺省挂载通道锚原样在案（节 73 锚兼容）')
    const clientPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    assert(clientPkg.indexOf('toggleMountScope') >= 0 && clientPkg.indexOf('dsh-notes-inj-mount-scope-hint') >= 0, 'lib/client.js 范围区同步（需先跑 scripts/build-dist.cjs）')
    const css = fsNative.readFileSync(path.join(DIR, 'src', 'styles.css'), 'utf8')
    assert(css.indexOf('.dsh-notes-inj-mount-scope{') >= 0 && css.indexOf('.dsh-notes-inj-mount-scope-item{') >= 0, 'styles.css client 范围区样式')
    const headHtml = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'shell', 'head.html'), 'utf8')
    assert(headHtml.indexOf('.inj-mount-scope{') >= 0 && headHtml.indexOf('.inj-mount-scope-item{') >= 0, 'app head.html 范围区样式')
  })

  await t('142 i18n 新 key 双语在案：inj.mountScopeLabel / inj.mountScopeAll（zh/en 同 key 集）', () => {
    const zh142 = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
    const en142 = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
    for (const k of ['inj.mountScopeLabel', 'inj.mountScopeAll']) {
      assert(zh142.indexOf("'" + k + "':") >= 0, 'zh 缺 ' + k)
      assert(en142.indexOf("'" + k + "':") >= 0, 'en 缺 ' + k)
    }
  })
  }
}
