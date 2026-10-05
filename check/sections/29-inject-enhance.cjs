// 节 29. P1 注入增强（staleDays 时效标注 + injectBudgetChars 预算截断）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "29",
  title: "29. P1 注入增强（staleDays 时效标注 + injectBudgetChars 预算截断）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, llmMock, plugin, protoV2Src, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  // ===== 29. P1 注入增强：时效衰减提醒（staleDays）+ 注入体积预算（injectBudgetChars）=====
  // 契约：settings.json 新增 staleDays（缺省 90，0=关闭）与 injectBudgetChars（缺省 0=不限；约，按字符数近似，不引 token 计算库）；
  // catalogText 对 kind=note/link（参考资料类）且 updatedAt 超期条目行尾追加「 ⚠ N 天未更新」；
  // conventionText 约定桶永不截断、资料桶超预算从最旧整条省略 + 尾部提示行；lastInjectChars 每次渲染更新并随 settings-get 回传（设置卡片仪表）。
  section('29. P1 注入增强（staleDays 时效标注 + injectBudgetChars 预算截断）')

  // ---- 29.1 host 双侧结构契约（host-impl / index.mjs 双包同步）----
  await t('host 双侧：staleDays/injectBudgetChars helper + 默认值 + settings-set 校验 + 文案', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const STALE_DAYS_DEFAULT = 90') >= 0, label + ' staleDays 缺省 90')
      assert(s.indexOf('function staleDaysLimit()') >= 0 && s.indexOf('function injectBudgetChars()') >= 0, label + ' staleDaysLimit/injectBudgetChars helper 存在')
      assert(s.indexOf('function staleDaysOf(updatedAt, limit)') >= 0, label + ' staleDaysOf 时效判定存在')
      assert(s.indexOf('let lastInjectChars = 0') >= 0, label + ' lastInjectChars 缓存变量')
      assert(s.indexOf('lastInjectChars: lastInjectChars') >= 0, label + ' settings-get 回传 lastInjectChars')
      assert(s.indexOf('lastInjectChars = full.length') >= 0, label + ' conventionText 每次渲染更新缓存值')
      assert(s.indexOf("if ('staleDays' in patch)") >= 0 && s.indexOf("if ('injectBudgetChars' in patch)") >= 0, label + ' settings-set 处理两个新键')
      assert(s.indexOf('staleDays 需要非负数值') >= 0 && s.indexOf('injectBudgetChars 需要非负数值') >= 0, label + ' 新键校验文案')
      assert(s.indexOf("(n.kind === 'note' || n.kind === 'link')") >= 0, label + ' ⚠ 标注限 kind=note/link（参考资料类）')
      assert(s.indexOf("line += ' ⚠ ' + sd + ' 天未更新'") >= 0, label + ' 目录行尾「 ⚠ N 天未更新」标注')
      assert(s.indexOf('约定桶永不截断') >= 0, label + ' 约定桶永不截断（注释约定）')
      assert(s.indexOf('条资料超出预算未注入（note_search 可检索）') >= 0, label + ' 预算省略提示行文案')
      assert(s.indexOf('按字符数近似统计，不引 token 计算库') >= 0, label + ' 「约/字符数近似」口径注释')
    }
  })

  // ---- 29.2 host 行为级（开发版独立实例 store9i/handlers9i/contexts9i，与 22/28 节同款隔离模式）----
  const store9i = new Map()
  const fsMock9i = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store9i.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store9i.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store9i.has(p)) throw new Error('ENOENT: ' + p); return store9i.get(p) },
    writeText: async (p, c) => { store9i.set(p, c) },
  }
  const handlers9i = {}
  const contexts9i = []
  const harnessMock9i = { handle: (name, fn) => { handlers9i[name] = fn; return () => { delete handlers9i[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock9i, DIR).apply({
    fs: fsMock9i, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts9i.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const convCtx9i = contexts9i.find(x => x.name === 'notes:workspace-conventions')
  const catCtx9i = contexts9i.find(x => x.name === 'notes:catalog')

  await t('staleDays 时效标注：kind=note/link 超期行尾「 ⚠ N 天未更新」；todo/新鲜条目不标', async () => {
    const old = new Date(Date.now() - 100 * 86400000).toISOString()
    const fresh = new Date().toISOString()
    const fm = (id, kind, updatedAt) => '---\nid: ' + id + '\ntitle: ' + id + '标题\ntopic: 运维\n' + (kind ? 'kind: ' + kind + '\n' : '') + 'createdAt: "' + updatedAt + '"\nupdatedAt: "' + updatedAt + '"\n---\n\n正文\n'
    await fsMock9i.writeText(NOTES_DIR + '\\n-stale-note.md', fm('n-stale-note', '', old))      // 缺省 kind=note（向后兼容）
    await fsMock9i.writeText(NOTES_DIR + '\\n-stale-link.md', fm('n-stale-link', 'link', old))
    await fsMock9i.writeText(NOTES_DIR + '\\n-stale-todo.md', fm('n-stale-todo', 'todo', old))
    await fsMock9i.writeText(NOTES_DIR + '\\n-fresh-note.md', fm('n-fresh-note', '', fresh))
    for (const id of ['n-stale-note', 'n-stale-link', 'n-stale-todo', 'n-fresh-note']) await handlers9i['notes-get']({ id: id })   // 触发解析进 cache（catalogText 只读 cache）
    const txt = catCtx9i.text()
    assert(txt.indexOf('- [n-stale-note] n-stale-note标题 (笔记, 运维) ⚠ 100 天未更新') >= 0, 'note 超期标注（实得：' + txt.split('\n').filter(l => l.indexOf('stale') >= 0 || l.indexOf('fresh') >= 0).join(' | ') + '）')
    assert(txt.indexOf('- [n-stale-link] n-stale-link标题 (链接, 运维) ⚠ 100 天未更新') >= 0, 'link 超期标注')
    assert(txt.indexOf('n-stale-todo标题 (待办, 运维) ⚠') < 0, 'todo 不标注（非参考资料类）')
    assert(txt.indexOf('n-fresh-note标题 (笔记, 运维) ⚠') < 0, '新鲜条目不标注')
    assert(txt.indexOf('n-stale-todo标题 (待办, 运维)') >= 0 && txt.indexOf('n-fresh-note标题 (笔记, 运维)') >= 0, '未标注条目仍在目录')
  })
  await t('staleDays 设置往返：落盘回读 → 阈值放宽不标 → 0 关闭 → null 恢复缺省 90 → 非法值报错', async () => {
    let bad = await handlers9i['notes-settings-set']({ staleDays: -1 })
    assert(bad.error && bad.error.indexOf('staleDays') >= 0, '负数报错')
    bad = await handlers9i['notes-settings-set']({ staleDays: '30' })
    assert(bad.error && bad.error.indexOf('staleDays') >= 0, '字符串报错')
    const ok = await handlers9i['notes-settings-set']({ staleDays: 30 })
    assert(ok.ok === true, '保存成功（实得 ' + JSON.stringify(ok) + '）')
    const onDisk = JSON.parse(store9i.get(NOTES_DIR + '\\settings.json'))
    assert.strictEqual(onDisk.staleDays, 30, 'settings.json 落盘 staleDays:30')
    const sg = await handlers9i['notes-settings-get']({})
    assert.strictEqual(sg.settings.staleDays, 30, 'notes-settings-get 回读一致')
    assert.strictEqual(typeof sg.lastInjectChars, 'number', 'settings-get 回传 lastInjectChars 数值（仪表数据源）')
    await handlers9i['notes-settings-set']({ staleDays: 200 })
    assert(catCtx9i.text().indexOf('⚠') < 0, '阈值 200：100 天未超期不标注')
    await handlers9i['notes-settings-set']({ staleDays: 0 })
    assert(catCtx9i.text().indexOf('⚠') < 0, '0 = 关闭标注')
    await handlers9i['notes-settings-set']({ staleDays: null })
    const sg2 = await handlers9i['notes-settings-get']({})
    assert(!('staleDays' in sg2.settings), 'null 删除 override（恢复缺省 90）')
    assert(catCtx9i.text().indexOf('⚠ 100 天未更新') >= 0, '缺省 90 恢复标注')
  })
  await t('injectBudgetChars 预算截断：资料桶从最旧整条省略 + 提示行；约定桶永不截断；lastInjectChars 随渲染更新', async () => {
    // 约定 1 条（100 字符正文）+ 资料 3 条（各 200 字符正文；R1 最旧，R3 最新——updatedAt 降序的尾部 = 最旧）
    await handlers9i['notes-create']({ title: '预算约定条目', body: 'x'.repeat(100), inject: true, topic: '约定' })
    await handlers9i['notes-create']({ title: '资料一', body: 'a'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    await new Promise(r => setTimeout(r, 2))
    await handlers9i['notes-create']({ title: '资料二', body: 'b'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    await new Promise(r => setTimeout(r, 2))
    await handlers9i['notes-create']({ title: '资料三', body: 'c'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    // 0.4.3⑤ 管线切换后资料桶载荷 = 索引挂载行：换文案为「标题 + 200 字符长尾」保持行级预算语义可测（行内仍含标题供断言）
    await handlers9i['notes-mount']({ id: (await handlers9i['notes-list']({})).notes.find(n => n.title === '资料一').id, whenToUse: '资料一' + 'a'.repeat(200) })
    await handlers9i['notes-mount']({ id: (await handlers9i['notes-list']({})).notes.find(n => n.title === '资料二').id, whenToUse: '资料二' + 'b'.repeat(200) })
    await handlers9i['notes-mount']({ id: (await handlers9i['notes-list']({})).notes.find(n => n.title === '资料三').id, whenToUse: '资料三' + 'c'.repeat(200) })
    // 基线（缺省 0=不限）：全部注入，无省略提示行
    const f0 = convCtx9i.text()
    assert(f0.indexOf('预算约定条目') >= 0 && f0.indexOf('资料一') >= 0 && f0.indexOf('资料二') >= 0 && f0.indexOf('资料三') >= 0, '缺省不限：约定 + 3 条资料全部注入')
    assert(f0.indexOf('超出预算未注入') < 0, '基线无省略提示行')
    const sg0 = await handlers9i['notes-settings-get']({})
    assert.strictEqual(sg0.lastInjectChars, f0.length, 'lastInjectChars = 最近一次渲染长度')
    // 预算 = 基线 - 150：每个资料块 >200 字符 → 恰好省略最旧 1 条（资料一），其余保留
    const ok1 = await handlers9i['notes-settings-set']({ injectBudgetChars: f0.length - 150 })
    assert(ok1.ok === true, '预算保存成功')
    const f1 = convCtx9i.text()
    assert(f1.indexOf('资料一') < 0 && f1.indexOf('资料二') >= 0 && f1.indexOf('资料三') >= 0, '最旧资料整条省略，较新资料保留')
    assert(f1.indexOf('预算约定条目') >= 0 && f1.indexOf('x'.repeat(100)) >= 0, '约定桶完整保留')
    assert(f1.indexOf('…另有 1 条资料超出预算未注入（note_search 可检索）') >= 0, '省略提示行 N=1（实得尾部：' + f1.split('\n').slice(-2).join(' | ') + '）')
    assert(f1.split('\n\n…另有')[0].length <= f0.length - 150, '截断后主体回到预算内')
    // 约定不截断：预算小于约定自身长度 → 资料全部省略，约定仍完整
    await handlers9i['notes-settings-set']({ injectBudgetChars: 30 })
    const f2 = convCtx9i.text()
    assert(f2.indexOf('用户约定（须遵守）：') >= 0 && f2.indexOf('预算约定条目') >= 0 && f2.indexOf('x'.repeat(100)) >= 0, '约定桶永不截断（即使自身已超预算）')
    assert(f2.indexOf('资料一') < 0 && f2.indexOf('资料二') < 0 && f2.indexOf('资料三') < 0, '资料桶全部省略')
    assert(f2.indexOf('…另有 3 条资料超出预算未注入（note_search 可检索）') >= 0, '省略提示行 N=3')
    // 恢复不限 + 非法值
    await handlers9i['notes-settings-set']({ injectBudgetChars: null })
    const sg2 = await handlers9i['notes-settings-get']({})
    assert(!('injectBudgetChars' in sg2.settings), 'null 删除 override（恢复缺省不限）')
    const f3 = convCtx9i.text()
    assert(f3.indexOf('资料一') >= 0 && f3.indexOf('资料三') >= 0 && f3.indexOf('超出预算未注入') < 0, '恢复不限后资料全回、提示行消失')
    const bad = await handlers9i['notes-settings-set']({ injectBudgetChars: -5 })
    assert(bad.error && bad.error.indexOf('injectBudgetChars') >= 0, '负数报错')
    const bad2 = await handlers9i['notes-settings-set']({ injectBudgetChars: 'abc' })
    assert(bad2.error && bad2.error.indexOf('injectBudgetChars') >= 0, '字符串报错')
  })

  // ---- 29.3 静态包行为（独立 ESM 实例 + 独立 store10i；harness 缺席 → webServer 路由链路）----
  await t('静态包：staleDays/injectBudgetChars 往返 + ⚠ 标注 + 预算截断 + 约定不截断（rpc 路由链路）', async () => {
    const store10i = new Map()
    const fsMock10i = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (store10i.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store10i.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store10i.has(p)) throw new Error('ENOENT: ' + p); return store10i.get(p) },
      writeText: async (p, c) => { store10i.set(p, c) },
    }
    const routes10i = []
    const contexts10i = []
    const ctx10i = {
      fs: fsMock10i,
      sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routes10i.push(r); return () => {} } },
      tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts10i.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    }
    const modEnh = await import(pathToFileURL(INDEX_PATH).href + '?inject-enhance=1')
    modEnh.apply(ctx10i)
    function rpc10i(method, args) {
      return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routes10i[0].handler(req, res)).catch(reject)
      })
    }
    const convCtx10i = contexts10i.find(x => x.name === 'notes:workspace-conventions')
    const catCtx10i = contexts10i.find(x => x.name === 'notes:catalog')
    // 设置往返（webServer JSON 通道）
    const bad = await rpc10i('notes-settings-set', { staleDays: 'x' })
    assert(bad.body.error && bad.body.error.indexOf('staleDays') >= 0, '静态包 staleDays 非法值报错')
    const bad2 = await rpc10i('notes-settings-set', { injectBudgetChars: -1 })
    assert(bad2.body.error && bad2.body.error.indexOf('injectBudgetChars') >= 0, '静态包 injectBudgetChars 非法值报错')
    await rpc10i('notes-settings-set', { staleDays: 15, injectBudgetChars: 3000 })
    const onDisk = JSON.parse(store10i.get(path.join(NOTES_ROOT_STATIC, 'settings.json')))
    assert.strictEqual(onDisk.staleDays, 15, '静态包 settings.json 落盘 staleDays:15')
    assert.strictEqual(onDisk.injectBudgetChars, 3000, '静态包 settings.json 落盘 injectBudgetChars:3000')
    const sg = await rpc10i('notes-settings-get', {})
    assert.strictEqual(sg.body.settings.staleDays, 15, '静态包回读 staleDays')
    assert.strictEqual(sg.body.settings.injectBudgetChars, 3000, '静态包回读 injectBudgetChars')
    assert.strictEqual(typeof sg.body.lastInjectChars, 'number', '静态包 settings-get 回传 lastInjectChars')
    // ⚠ 标注（阈值 15，100 天旧笔记超期）
    const old10 = new Date(Date.now() - 100 * 86400000).toISOString()
    await fsMock10i.writeText(path.join(NOTES_ROOT_STATIC, 'n-stale-pkg.md'), '---\nid: n-stale-pkg\ntitle: 静态旧笔记\ntopic: 运维\ncreatedAt: "' + old10 + '"\nupdatedAt: "' + old10 + '"\n---\n\n旧正文\n')
    await rpc10i('notes-get', { id: 'n-stale-pkg' })   // 入 cache
    assert(catCtx10i.text().indexOf('静态旧笔记 (笔记, 运维) ⚠ 100 天未更新') >= 0, '静态包目录 ⚠ 标注（实得：' + catCtx10i.text().split('\n').slice(0, 4).join(' | ') + '）')
    // 预算截断（约定不截断 + 最旧省略 + 提示行）
    await rpc10i('notes-create', { title: '静态约定', body: 'x'.repeat(100), inject: true, topic: '约定' })
    await rpc10i('notes-create', { title: '静态资料一', body: 'a'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    await new Promise(r => setTimeout(r, 2))
    await rpc10i('notes-create', { title: '静态资料二', body: 'b'.repeat(200), inject: true, injectRole: 'reference', topic: '资料' })
    await rpc10i('notes-settings-set', { injectBudgetChars: 30 })
    const ft = convCtx10i.text()
    assert(ft.indexOf('静态约定') >= 0 && ft.indexOf('x'.repeat(100)) >= 0, '静态包约定桶永不截断')
    assert(ft.indexOf('静态资料一') < 0 && ft.indexOf('静态资料二') < 0, '静态包资料桶全部省略')
    assert(ft.indexOf('…另有 2 条资料超出预算未注入（note_search 可检索）') >= 0, '静态包省略提示行 N=2')
    await rpc10i('notes-settings-set', { injectBudgetChars: null, staleDays: null })
    const sg2 = await rpc10i('notes-settings-get', {})
    assert(!('injectBudgetChars' in sg2.body.settings) && !('staleDays' in sg2.body.settings), '静态包 null 恢复缺省')
    assert(convCtx10i.text().indexOf('静态资料一') >= 0, '静态包恢复不限后资料回来')
  })

  // ---- 29.4 client 设置卡片（client-impl + 发布包 lib/client.js 同步 + 仪表样式）----
  await t('设置卡片：「时效衰减提醒」+「注入体积预算」两行（失焦/Enter 即保存 + 仪表 + 「约」文案）', () => {
    assert(/key: 'stale', label: tt\('settings\.stale'\)/.test(clientSrc), 'settingsRows 含「时效衰减提醒」行（覆盖卡 C 起 label 走 tt() 字典）')
    assert(/key: 'budget', label: tt\('settings\.budget'\)/.test(clientSrc), 'settingsRows 含「注入体积预算」行（覆盖卡 C 起 label 走 tt() 字典）')
    assert(clientSrc.indexOf('提醒参考资料可能过期') >= 0, '时效行 sub 说明文案')
    assert(clientSrc.indexOf('约定条目永不截断，资料条目从最旧开始省略') >= 0, '预算行 sub 说明文案（约定不截断）')
    assert(/function saveSettingsStale\(\)[\s\S]*?settingsSetQuiet\(\{ staleDays: v \}\)/.test(clientSrc), '时效阈值走 settings-set 通道传 staleDays（settingsSetQuiet 低层通道）')
    assert(/function saveSettingsBudget\(\)[\s\S]*?settingsSetQuiet\(\{ injectBudgetChars: v \}\)/.test(clientSrc), '预算走 settings-set 通道传 injectBudgetChars（settingsSetQuiet 低层通道）')
    assert(clientSrc.indexOf("setSetStale(String(res.settings && typeof res.settings.staleDays === 'number' ? res.settings.staleDays : 90))") >= 0, 'openSettings 回读 staleDays（缺省 90）')
    assert(clientSrc.indexOf("setSetBudget(String(res.settings && typeof res.settings.injectBudgetChars === 'number' ? res.settings.injectBudgetChars : 0))") >= 0, 'openSettings 回读 injectBudgetChars（缺省 0）')
    assert(clientSrc.indexOf('settingsData.lastInjectChars') >= 0 && clientSrc.indexOf('当前注入约 ') >= 0, '仪表读 lastInjectChars + 「约」文案')
    assert(clientSrc.indexOf('dsh-notes-inject-gauge') >= 0 && clientSrc.indexOf('dsh-notes-inject-gauge-bar') >= 0, '仪表条结构类')
    for (const k of ['时效衰减提醒', '注入体积预算', 'saveSettingsStale', 'saveSettingsBudget', 'dsh-notes-inject-gauge', '当前注入约 ', 'staleDays', 'injectBudgetChars']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺 ' + k + '（需先跑 scripts/build-dist.cjs）')
    }
    const cssDev9 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg9 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev9], ['发布包 lib/styles.css', cssPkg9]]) {
      assert(pair[1].indexOf('.dsh-notes-inject-gauge{') >= 0 && pair[1].indexOf('.dsh-notes-inject-gauge-bar') >= 0 && pair[1].indexOf('.dsh-notes-inject-gauge-t{') >= 0, pair[0] + ' 缺注入预算仪表样式')
    }
  })

  // ---- 29.5 app.html / 原型 notes-ui-v2.html 设置卡同步 ----
  await t('app.html + 原型设置卡同款两行 + 仪表（双端 UI 标记一致 + mock 演示值）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="setStale"') >= 0 && s.indexOf('id="setBudget"') >= 0, label + ' 两个数值输入')
      assert(s.indexOf('saveSettings({ staleDays: parseInt(v, 10) }') >= 0 && s.indexOf('saveSettings({ injectBudgetChars: parseInt(v, 10) }') >= 0, label + ' 失焦即保存链路')
      assert(s.indexOf('时效衰减提醒') >= 0 && s.indexOf('注入体积预算') >= 0, label + ' 两行标签')
      assert(s.indexOf('当前注入约 ') >= 0 && s.indexOf('setGaugeBar') >= 0, label + ' 仪表文案 + 仪表条')
      assert(s.indexOf('提醒参考资料可能过期') >= 0 && s.indexOf('约定条目永不截断') >= 0, label + ' 说明文案（过期提醒 / 约定不截断）')
      assert(s.indexOf('lastInjectChars') >= 0, label + ' 读 settings-get 的 lastInjectChars')
    }
    assert(protoV2Src.indexOf('lastInjectChars: 2480') >= 0, '原型 mock settings-get 含仪表演示值')
  })
  }
}
