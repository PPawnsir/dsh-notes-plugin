// 节 53. injectTo 会话 id 归一 + 非法显式拒绝 + 详情下拉勾选态同步（notes-034-injectto-norm；实证 n-mutpc7m6fkfk）
// 三缺陷修复：①injectTo 存完整长 id 时详情下拉勾选态恒空（勾选渲染按短 id 直接比对）②host 写入路径无归一/校验，
// 无法解析的 id 静默落库 ③双端（app.html / React 面板）+ 原型同口径归一比对。
// 红线（错得安全）：收窄失败必须显式失败（整体拒绝，报错含具体值，不部分保存）；归一只在写入路径，读路径（conventionHit）不动；
// 活跃会话集与 notes-sessions 同源（_activeSessions 含 pendingSessions）；不在集内的历史短 id（会话已删）保留原值不报错（治理连续性）。
module.exports = {
  id: "53",
  title: "53. injectTo 归一化与非法拒绝（写入归一 + 非法整体拒绝 + 勾选态归一比对）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { handlers, findTool, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, llmMock, protoV2Src, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('53. injectTo 归一化与非法拒绝（写入归一 + 非法整体拒绝 + 勾选态归一比对）')
  const FULL_ID = 'session-abc12345-0000-0000-0000-000000000000'   // workspaceRegistryMock 活跃会话（live，短 id abc12345）

  // ===== 53.1 host 行为级（开发版内存实例，节 2 mock：活跃会话短 id = abc12345）=====
  const c53a = await handlers['notes-create']({ title: '归一样本A', body: 'x', inject: true, injectTo: [FULL_ID] })
  const g53a = c53a && c53a.id ? await handlers['notes-get']({ id: c53a.id }) : null
  await t('host 写入归一：完整长 id 落盘归一为短 id', () => {
    assert(c53a && c53a.id && !c53a.error, '长 id 创建应成功（实得 ' + JSON.stringify(c53a) + '）')
    assert.deepStrictEqual(g53a.note.injectTo, ['abc12345'], 'injectTo 落盘应为短 id（实得 ' + JSON.stringify(g53a.note.injectTo) + '）')
  })
  const c53b = await handlers['notes-create']({ title: '非法样本B', body: 'x', inject: true, injectTo: ['session-deadbeef-0000-0000-0000-000000000000'] })
  await t('host 非法显式拒绝：无法解析的完整 id 整体拒绝（报错含具体值，不落库）', () => {
    assert(c53b && c53b.error, '应返回 error（实得 ' + JSON.stringify(c53b) + '）')
    assert(c53b.error.indexOf('无法解析') >= 0 && c53b.error.indexOf('session-deadbeef') >= 0, '报错应含具体无法解析值：' + c53b.error)
    assert(!c53b.id, '整体拒绝不落库（不得部分保存）')
  })
  const c53c = await handlers['notes-create']({ title: '短id样本C', body: 'x', inject: true, injectTo: ['abc12345'] })
  const g53c = c53c && c53c.id ? await handlers['notes-get']({ id: c53c.id }) : null
  const c53d = await handlers['notes-create']({ title: '存量兼容样本D', body: 'x', inject: true, injectTo: ['global', 'workspace'] })
  const g53d = c53d && c53d.id ? await handlers['notes-get']({ id: c53d.id }) : null
  const c53e = await handlers['notes-create']({ title: '历史会话样本E', body: 'x', inject: true, injectTo: ['deadbeef'] })
  const g53e = c53e && c53e.id ? await handlers['notes-get']({ id: c53e.id }) : null
  await t('host 写入归一：短 id 原样 / 存量 global·workspace 透传 / 历史短 id（会话已删）保留不报错', () => {
    assert.deepStrictEqual(g53c && g53c.note.injectTo, ['abc12345'], '活跃短 id 原样保留')
    assert.deepStrictEqual(g53d && g53d.note.injectTo, ['global', 'workspace'], '存量 global/workspace 透传（不迁移）')
    assert.deepStrictEqual(g53e && g53e.note.injectTo, ['deadbeef'], '不在活跃集的历史短 id 保留原值不报错（治理连续性）')
  })
  const u53a = await handlers['notes-update']({ id: c53c.id, injectTo: [FULL_ID] })
  const g53u = await handlers['notes-get']({ id: c53c.id })
  const u53b = await handlers['notes-update']({ id: c53c.id, injectTo: ['session-nosuch00-0000-0000-0000-000000000000'] })
  const g53u2 = await handlers['notes-get']({ id: c53c.id })
  await t('host update 同闸：长 id 归一落盘 / 非法值整体拒绝且原 injectTo 不动', () => {
    assert(u53a && !u53a.error, 'update 长 id 应成功（实得 ' + JSON.stringify(u53a) + '）')
    assert.deepStrictEqual(g53u.note.injectTo, ['abc12345'], 'update 落盘归一为短 id')
    assert(u53b && u53b.error && u53b.error.indexOf('session-nosuch00') >= 0, '非法 update 显式拒绝：' + JSON.stringify(u53b))
    assert.deepStrictEqual(g53u2.note.injectTo, ['abc12345'], '拒绝后原 injectTo 不动（错得安全：失败停在原状）')
  })
  await t('note_manage 工具同闸：create 长 id 归一 / update 非法拒绝', async () => {
    const nm = findTool('note_manage')
    const mc = await nm.execute({ action: 'create', title: '工具归一样本', body: 'x', inject: true, injectTo: [FULL_ID] })
    assert(mc && mc.id && !mc.error, '工具 create 长 id 应成功（实得 ' + JSON.stringify(mc) + '）')
    const mg = await handlers['notes-get']({ id: mc.id })
    assert.deepStrictEqual(mg.note.injectTo, ['abc12345'], '工具路径落盘归一为短 id')
    const mu = await nm.execute({ action: 'update', id: mc.id, injectTo: ['bogus-long-id-not-8char'] })
    assert(mu && mu.error && mu.error.indexOf('无法解析') >= 0 && mu.error.indexOf('bogus-long-id-not-8char') >= 0, '工具 update 非法拒绝（实得 ' + JSON.stringify(mu) + '）')
  })

  // ===== 53.2 双包逐字节同步（injectto-norm-guard 标记块 + create/update 接线，模式同节 46.2）=====
  await t('injectto-norm-guard 双包逐字节同步（notes.js ⇄ notes.dist.js）+ 接线齐全', () => {
    const mRe = /\/\/ ==== injectto-norm-guard BEGIN ====[\s\S]*?\/\/ ==== injectto-norm-guard END ====/
    const bDev = hostSrc.match(mRe), bDist = indexSrc.match(mRe)
    assert(bDev && bDist, '开发版拼接与静态包均须含 injectto-norm-guard 标记块')
    assert.strictEqual(bDev[0], bDist[0], '标记块双包逐字节一致（notes.js ⇄ notes.dist.js 改一边忘另一边）')
    for (const pair of [['host 开发版', hostSrc], ['静态包 index.mjs', indexSrc]]) {
      assert(pair[1].indexOf('injectTo: injectToNorm || []') >= 0, pair[0] + ' _create 归一接线（需先跑 scripts/build-dist.cjs）')
      assert(pair[1].indexOf('const ng = await _normInjectTo(injectTo)') >= 0, pair[0] + ' _update 归一接线（需先跑 scripts/build-dist.cjs）')
    }
  })

  // ===== 53.3 勾选态归一比对行为级（app renderScopePanel 真实代码路径仿真：长 id 存量 → 对应会话勾选）=====
  const ED_META_SRC = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'editor-meta.js'), 'utf8')
  const HELPERS_SRC53 = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'helpers.js'), 'utf8')
  await t('app 勾选渲染行为级：injectTo 存长 id 时对应会话 checkbox 勾选（归一比对）', () => {
    const host53 = { innerHTML: '', querySelectorAll() { return [] } }
    const target = {
      scopeOpen: true,
      edNote: { id: 'n53', inject: true, injectTo: [FULL_ID] },
      sessList: [{ id: FULL_ID, short: 'abc12345', name: '开发会话', workspace: 'w1' }],
      sessPending: [],
      $: (id) => id === 'scopePanelHost' ? host53 : null,
      esc: (s) => String(s), icon: () => '',
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    // 拼入 helpers.js 真实 scopeHas/shortSid（editor-meta.js 消费方），with(Proxy) 打桩其余跨文件依赖
    new Function('scope', 'with (scope) {\n' + HELPERS_SRC53 + '\n' + ED_META_SRC + '\n; renderScopePanel() }')(proxy)
    const m = host53.innerHTML.match(/<input type="checkbox" data-scope="abc12345"([^>]*)>/)
    assert(m, '浮层渲染出该会话 checkbox（实得 ' + host53.innerHTML.slice(0, 200) + '…）')
    assert(m[1].indexOf('checked') >= 0, '存量长 id 应显示为已勾选（实得属性串 ' + m[1] + '）')
  })
  await t('app 归一比对函数行为级：scopeHas 长短 id 等价 / 取消勾选连同长 id 存量移除', () => {
    const HELPERS_SRC = HELPERS_SRC53
    const target = {}
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + HELPERS_SRC + '\n; __api = { scopeHas: scopeHas, shortSid: shortSid } }')(proxy)
    const api = target.__api
    assert(api.scopeHas([FULL_ID], 'abc12345') === true, '长 id 存量归一命中')
    assert(api.scopeHas(['abc12345'], 'abc12345') === true, '短 id 命中')
    assert(api.scopeHas(['deadbeef'], 'abc12345') === false, '不匹配不误勾')
    assert(api.scopeHas([], 'abc12345') === false && api.scopeHas(undefined, 'abc12345') === false, '空/缺省不误勾')
  })

  // ===== 53.4 三端静态锚点（app.html 产物 / React 面板拼接源 + 发布包 / 原型 notes-ui-v2.html）=====
  await t('勾选态归一比对三端同步：app.html + React 面板（开发版 + 发布包）+ 原型', () => {
    for (const pair of [['app.html', appSrc], ['React 面板开发版', clientSrc], ['发布包 lib/client.js', clientPkgSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      assert(pair[1].indexOf('scopeHas') >= 0, pair[0] + ' 缺 scopeHas 归一比对函数（app/原型需跑 concat-app，client 需跑 build-dist）')
    }
    // 勾选渲染与取消勾选两处同口径（逐端锚点）
    assert(appSrc.indexOf('scopeHas(scope, s.short)') >= 0, 'app.html 勾选渲染走 scopeHas 归一比对')
    assert(appSrc.indexOf("scopeHas(cur, key) ? cur.filter(function (t) { return shortSid(t) !== key })") >= 0, 'app.html 取消勾选连同长 id 存量移除')
    assert(clientSrc.indexOf('scopeHas(edScope, s.short)') >= 0, 'React 面板勾选渲染走 scopeHas 归一比对')
    assert(clientSrc.indexOf('scopeHas(cur, key) ? cur.filter(t => shortSid(t) !== key)') >= 0, 'React 面板取消勾选连同长 id 存量移除')
    assert(protoV2Src.indexOf('scopeHas(scope, s.short)') >= 0, '原型勾选渲染走 scopeHas 归一比对')
    // 范围文字 injectScopeLabel 同口径归一（存量长 id 也能解析出会话名）
    assert(appSrc.indexOf('var st = shortSid(t)') >= 0 && clientSrc.indexOf('const st = shortSid(t)') >= 0 && protoV2Src.indexOf('var st = shortSid(t)') >= 0, '三端 injectScopeLabel 归一比对')
  })
  }
}
