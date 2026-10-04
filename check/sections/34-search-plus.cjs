// 节 34. 搜索体验升级（高亮 / 相关度 / 组合过滤 / 四端同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "34",
  title: "34. 搜索体验升级（高亮 / 相关度 / 组合过滤 / 四端同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, ctx, g, llmMock, mkFsMockImp, plugin, protoV2Src, r1, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, t2, workspaceRegistryMock } = S
  // ===== 34. 搜索体验升级（<mark> 高亮防 XSS + 相关度排序 + kind/sensitive/inject 组合过滤 + host 扩展 + 四端同步）=====
  section('34. 搜索体验升级（高亮 / 相关度 / 组合过滤 / 四端同步）')

  // ---- 34.1 host 双包 search-helpers 标记块：提取 eval 单测 + 双包逐字节一致 ----
  const grabSearchBlk = (s, tag) => { const m = s.match(/\/\/ ==== search-helpers BEGIN ====[\s\S]*?\/\/ ==== search-helpers END ====/); assert(m, tag + ' 缺 search-helpers 标记块'); return m[0] }
  const searchBlkDev = grabSearchBlk(hostSrc, 'host-impl.js')
  const searchBlkPkg = grabSearchBlk(indexSrc, 'index.mjs')
  await t('search-helpers 双包逐字节一致（host-impl.js ⇄ index.mjs）', () => assert.strictEqual(searchBlkDev, searchBlkPkg))
  const searchNS = {}
  new Function('ns', searchBlkDev + '\nns.searchMatchFields = searchMatchFields; ns.searchPassFilters = searchPassFilters')(searchNS)
  await t('searchMatchFields：title/tags/body 命中字段 + 多档并列 + 无 query 空数组', () => {
    const f = searchNS.searchMatchFields
    assert.deepStrictEqual(f({ title: 'Alpha', tags: [], body: '' }, 'alpha'), ['title'], '标题命中 → [title]')
    assert.deepStrictEqual(f({ title: '', tags: ['Beta'], body: '' }, 'beta'), ['tags'], '标签命中 → [tags]')
    assert.deepStrictEqual(f({ title: '', tags: [], body: 'Gamma 正文' }, 'gamma'), ['body'], '正文命中 → [body]')
    assert.deepStrictEqual(f({ title: '多档', tags: ['多档'], body: '多档' }, '多档'), ['title', 'tags', 'body'], '多字段同命中全列（相关度取最高档）')
    assert.deepStrictEqual(f({ title: 'x', tags: ['y'], body: 'z' }, ''), [], '无 query → 空数组')
  })
  await t('searchPassFilters：sensitive/inject 三态（true=仅命中 / false=仅排除 / undefined=不过滤）', () => {
    const p = searchNS.searchPassFilters
    const s = { sensitive: true, inject: false }, n0 = { sensitive: false, inject: true }
    assert(p(s, { sensitive: true }) === true && p(n0, { sensitive: true }) === false, 'sensitive=true 仅敏感')
    assert(p(s, { sensitive: false }) === false && p(n0, { sensitive: false }) === true, 'sensitive=false 排除敏感')
    assert(p(s, { inject: true }) === false && p(n0, { inject: true }) === true, 'inject=true 仅注入')
    assert(p(s, { inject: false }) === true && p(n0, { inject: false }) === false, 'inject=false 排除注入')
    assert(p(s, undefined) === true && p(s, {}) === true && p(s, { sensitive: undefined, inject: undefined }) === true, '缺省不过滤（向后兼容旧调用）')
  })
  await t('host 双包 notes-search 扩展结构（RPC 透传 + slim 附 matches + 工具参数）', () => {
    for (const pair of [['host-impl.js', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('async function _search(query, tag, topic, kind, folder, filters)') >= 0, label + ' _search 扩展 filters 参数（末尾追加，向后兼容）')
      assert(s.indexOf('if (n.matches) s.matches = n.matches') >= 0, label + ' slim 结果附 matches 命中字段')
      assert(s.indexOf('sensitive: a.sensitive, inject: a.inject') >= 0, label + ' RPC 透传 sensitive/inject 组合过滤')
      assert(s.indexOf("sensitive: { type: 'boolean'") >= 0 && s.indexOf("inject: { type: 'boolean'") >= 0, label + ' note_search 工具含 sensitive/inject 参数')
    }
  })

  // ---- 34.2 host 行为（开发版独立实例，防污染第 2 节共享库）：matches 全档 + 组合过滤 + 向后兼容 ----
  const store34 = new Map()
  const handlers34 = {}
  const harnessMock34 = { handle: (name, fn) => { handlers34[name] = fn; return () => { delete handlers34[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock34, DIR).apply({
    fs: mkFsMockImp(store34, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const sf1 = await handlers34['notes-create']({ title: '搜索升级·敏感约定', body: '含凭据正文本', tags: ['sec'], topic: '运维', kind: 'decision', sensitive: true, inject: true })
  const sf2 = await handlers34['notes-create']({ title: '搜索升级·普通笔记', body: '普通正文本', tags: ['sec'], topic: '运维' })
  await t('matches 命中字段全档：title / tags / body / 仅 topic 命中不计档', async () => {
    await handlers34['notes-create']({ title: '命中字段甲', body: '无瓜正文', tags: [], topic: '其他' })
    await handlers34['notes-create']({ title: '无瓜标题乙', body: '无瓜', tags: ['命中字段'], topic: '其他' })
    await handlers34['notes-create']({ title: '无瓜标题丙', body: '正文命中字段出现', tags: [], topic: '其他' })
    await handlers34['notes-create']({ title: '无瓜标题丁', body: '无瓜', tags: [], topic: '命中字段' })
    const r = await handlers34['notes-search']({ query: '命中字段' })
    const byTitle = {}
    for (const n of r.notes) byTitle[n.title] = n.matches
    assert.deepStrictEqual(byTitle['命中字段甲'], ['title'], '标题命中 → [title]')
    assert.deepStrictEqual(byTitle['无瓜标题乙'], ['tags'], '标签命中 → [tags]')
    assert.deepStrictEqual(byTitle['无瓜标题丙'], ['body'], '正文命中 → [body]')
    assert.deepStrictEqual(byTitle['无瓜标题丁'], [], '仅 topic 命中 → 空档（相关度排最末，但仍搜得到——向后兼容）')
  })
  await t('组合过滤：sensitive / inject / kind 三态组合', async () => {
    const r1 = await handlers34['notes-search']({ tag: 'sec', sensitive: true })
    assert(r1.notes.length === 1 && r1.notes[0].id === sf1.id, 'sensitive=true 仅敏感（实得 ' + r1.notes.length + '）')
    const r2 = await handlers34['notes-search']({ tag: 'sec', sensitive: false })
    assert(r2.notes.length === 1 && r2.notes[0].id === sf2.id, 'sensitive=false 排除敏感')
    const r3 = await handlers34['notes-search']({ tag: 'sec', inject: true })
    assert(r3.notes.length === 1 && r3.notes[0].id === sf1.id, 'inject=true 仅注入')
    const r4 = await handlers34['notes-search']({ tag: 'sec', inject: false })
    assert(r4.notes.length === 1 && r4.notes[0].id === sf2.id, 'inject=false 排除注入')
    const r5 = await handlers34['notes-search']({ tag: 'sec', kind: 'decision', sensitive: true, inject: true })
    assert(r5.notes.length === 1 && r5.notes[0].id === sf1.id, 'kind+sensitive+inject 组合 AND')
    const r6 = await handlers34['notes-search']({ tag: 'sec', kind: 'todo' })
    assert(r6.notes.length === 0, 'kind 不命中 → 空')
  })
  await t('向后兼容：旧调用（仅 query / 无新参数）行为不变', async () => {
    const r = await handlers34['notes-search']({ tag: 'sec' })
    assert(r.notes.length === 2 && !('matches' in r.notes[0]), '无 query → 不附 matches 字段（旧调用方不受影响）')
    const r2 = await handlers34['notes-search']({ query: '搜索升级' })
    assert(r2.notes.length === 2, '不带过滤参数 → 全集命中（缺省不过滤）')
  })
  await t('note_search 工具：sensitive/inject 参数 + matches 命中字段透传', async () => {
    const tools34 = []
    const harnessMock34b = { handle: () => () => {}, defineTool: (d) => d, registerTool: (c, d) => { tools34.push(d); return () => {} } }
    const store34b = new Map()
    new Function('harness', 'pluginDir', hostSrc)(harnessMock34b, DIR).apply({
      fs: mkFsMockImp(store34b, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const tool = tools34.find(x => x.name === 'note_search')
    assert(tool && tool.parameters.properties.sensitive && tool.parameters.properties.inject, '工具 schema 含 sensitive/inject')
    // 工具链路端到端：note_manage 造数 → note_search 检索（含组合过滤与 matches）
    const manage = tools34.find(x => x.name === 'note_manage')
    await manage.execute({ action: 'create', title: '工具搜索·敏感', body: 'x', tags: ['t34'], sensitive: true, inject: true })
    await manage.execute({ action: 'create', title: '工具搜索·普通', body: 'x', tags: ['t34'] })
    const rAll = await tool.execute({ tag: 't34' })
    assert(rAll.count === 2, '工具缺省不过滤（实得 ' + rAll.count + '）')
    const rSens = await tool.execute({ tag: 't34', sensitive: true })
    assert(rSens.count === 1 && rSens.notes[0].title === '工具搜索·敏感', '工具 sensitive=true 仅敏感')
    const rQ = await tool.execute({ query: '工具搜索' })
    assert(rQ.count === 2 && Array.isArray(rQ.notes[0].matches) && rQ.notes[0].matches.indexOf('title') >= 0, '工具返回 matches 命中字段（标题命中）')
  })

  // ---- 34.2 静态包 index.mjs 行为（独立 ESM 实例：matches + 组合过滤）----
  await t('静态包：notes-search matches 命中字段 + sensitive/inject 组合过滤（index.mjs 独立实例）', async () => {
    const storeS34 = new Map()
    const fsMockS34 = mkFsMockImp(storeS34, [NOTES_ROOT_STATIC])
    const handlersS34 = {}
    const harnessMockS34 = { handle: (name, fn) => { handlersS34[name] = fn; return () => { delete handlersS34[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    global.harness = harnessMockS34   // 静态包 handle() 主通道读全局 harness（apply 时解析）；指回本实例注册表
    const modS34 = await import(pathToFileURL(INDEX_PATH).href + '?search34=1')
    modS34.apply({
      fs: fsMockS34, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: () => () => {} }, tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const c1 = await handlersS34['notes-create']({ title: '静态搜索甲', body: '正文含令牌', tags: ['s34'], sensitive: true, inject: true })
    const c2 = await handlersS34['notes-create']({ title: '静态搜索乙', body: '普通正文', tags: ['s34'] })
    const r1 = await handlersS34['notes-search']({ query: '静态搜索' })
    assert(r1.notes.length === 2 && r1.notes.every(n => Array.isArray(n.matches) && n.matches[0] === 'title'), '静态包附 matches（标题命中，实得 ' + JSON.stringify(r1.notes.map(n => n.matches)) + '）')
    const r2 = await handlersS34['notes-search']({ tag: 's34', sensitive: true })
    assert(r2.notes.length === 1 && r2.notes[0].id === c1.id, '静态包 sensitive=true 仅敏感')
    const r3 = await handlersS34['notes-search']({ tag: 's34', inject: false })
    assert(r3.notes.length === 1 && r3.notes[0].id === c2.id, '静态包 inject=false 排除注入')
    const r4 = await handlersS34['notes-search']({ tag: 's34' })
    assert(r4.notes.length === 2 && !('matches' in r4.notes[0]), '静态包向后兼容：无 query 无 matches、缺省不过滤')
  })

  // ---- 34.3 高亮防 XSS（先 esc 再包 <mark>；禁止 innerHTML 拼原文）----
  const grabFn = (s, name, tag) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')); assert(m, tag + ' 缺 ' + name + '()'); return m[0] }
  const hlApp = grabFn(appSrc, 'hl', 'app.html')
  const hlProto = grabFn(protoV2Src, 'hl', '原型 notes-ui-v2.html')
  await t('hl() 高亮函数双端逐字节一致（app.html ⇄ 原型）', () => assert.strictEqual(hlApp, hlProto))
  const hlNS = {}
  new Function('ns', grabFn(appSrc, 'esc', 'app.html') + '\n' + hlApp + '\nns.hl = hl')(hlNS)
  await t('高亮防 XSS：先 esc 再包 <mark>（恶意标题/恶意查询词/正则元字符均安全）', () => {
    const hl = hlNS.hl
    const escPos = hlApp.indexOf('esc(text == null'), markPos = hlApp.indexOf("'<mark>$1</mark>'")
    assert(escPos >= 0 && markPos > escPos, '源码顺序：先 esc 再包 <mark>')
    const out1 = hl('<img src=x onerror=alert(1)> 笔记', 'img')
    assert(out1.indexOf('<img') < 0 && out1.indexOf('onerror') >= 0, '标题原文先转义（无 <img 节点，onerror 成纯文本）')
    assert(out1.indexOf('<mark>img</mark>') >= 0, '命中词包 <mark>')
    const out2 = hl('普通标题', '<img onerror=alert(1)>')
    assert(out2.indexOf('<img') < 0 && out2.indexOf('<mark>') < 0, '恶意查询词经 esc 后无命中、不注入标签')
    assert(hl('a.c (x) [y]', '.') === 'a<mark>.</mark>c (x) [y]', '正则元字符转义：. 只命中字面点（实得 ' + hl('a.c (x) [y]', '.') + '）')
    assert(hl('100% 完成 & 收尾', '&') === '100% 完成 <mark>&amp;</mark> 收尾', '查询词 & 经 esc 后命中转义文本（&amp; 形态一致）')
    assert(hl('', 'x') === '' && hl('abc', '') === 'abc' && hl('abc', '  ') === 'abc', '空文本/空查询原样返回')
  })
  await t('面板 highlight（React）：正则转义 + mark 元素（React 转义渲染，无 innerHTML 拼原文）', () => {
    assert(clientSrc.indexOf("q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')") >= 0, 'client-impl highlight 查询词正则元字符转义')
    assert(clientSrc.indexOf("e('mark', { key: i, className: 'dsh-notes-mark' }, p)") >= 0, 'client-impl 高亮走 React mark 元素（文本节点自动转义）')
    assert(clientPkgSrc.indexOf("'dsh-notes-mark'") >= 0, '发布包 lib/client.js 同步高亮（需先跑 scripts/build-dist.cjs）')
    assert(clientSrc.indexOf("highlight(n.title || tt('tree.untitled'), q)") >= 0, '面板行标题接入高亮（i18n 覆盖卡A 起缺省标题走 t() 字典）')
  })

  // ---- 34.4 相关度排序（标题 > 标签 > 正文 > 其他，同级 updatedAt 降序）----
  await t('相关度排序比较器行为（app.html/原型 relRank + 比较器提取执行）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      const relSrc = grabFn(s, 'relRank', label)
      const meta = { 'n-t': ['title'], 'n-t2': ['title'], 'n-g': ['tags'], 'n-b': ['body'] }
      const relRank = new Function('searchMeta', relSrc + '\nreturn relRank')(meta)
      assert.strictEqual(relRank({ id: 'n-l', title: 'XqX', tags: [], preview: '' }, 'q'), 3, label + ' 无 meta 时本地估算标题命中=3')
      assert.strictEqual(relRank({ id: 'n-x', title: '', tags: [], preview: '' }, 'q'), 0, label + ' 无命中=0 档')
      const cm = s.match(/if \(sortBy === 'rel' && qRel\) vis\.sort\(function \(a, b\) \{ return ([^\r\n]+) \}\);/)
      assert(cm, label + ' 缺相关度排序行')
      const cmp = new Function('relRank', 'qRel', 'return function (a, b) { return ' + cm[1] + ' }')(relRank, 'q')
      const arr = [
        { id: 'n-b', title: '', tags: [], preview: '', updatedAt: '2026-01-04T00:00:00.000Z' },
        { id: 'n-t', title: '', tags: [], preview: '', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'n-x', title: '', tags: [], preview: '', updatedAt: '2026-01-06T00:00:00.000Z' },
        { id: 'n-g', title: '', tags: [], preview: '', updatedAt: '2026-01-03T00:00:00.000Z' },
        { id: 'n-t2', title: '', tags: [], preview: '', updatedAt: '2026-01-05T00:00:00.000Z' },
      ]
      assert.strictEqual(arr.slice().sort(cmp).map(n => n.id).join(','), 'n-t2,n-t,n-g,n-b,n-x', label + ' 标题>标签>正文>无命中，同级 updatedAt 降序')
    }
  })
  await t('相关度排序比较器（面板 client-impl）：relRank 降序 + updatedAt 兜底 + 无搜索词退化', () => {
    const m = clientSrc.match(/else if \(sortBy === 'rel' && q\) filtered = filtered\.slice\(\)\.sort\(\(a, b\) => ([^\r\n]+)\)\r?\n/)
    assert(m, 'client-impl 缺相关度排序行')
    const cmp = new Function('relRank', 'return (a, b) => ' + m[1])((n) => n._r)
    const arr = [
      { id: 'a', _r: 1, updatedAt: '2026-01-02' }, { id: 'b', _r: 3, updatedAt: '2026-01-01' },
      { id: 'c', _r: 3, updatedAt: '2026-01-03' }, { id: 'd', _r: 2, updatedAt: '2026-01-04' }, { id: 'e', _r: 0, updatedAt: '2026-01-05' },
    ]
    assert.strictEqual(arr.slice().sort(cmp).map(n => n.id).join(','), 'c,b,d,a,e', '标题>标签>正文>无命中，同级 updatedAt 降序')
    assert(clientSrc.indexOf("sortBy === 'rel' && q") >= 0, '无搜索词时相关度退化为 host 序（不抢默认排序）')
  })

  // ---- 34.5 四端同步：筛选中心（design/notes-filter-center.html 落地）----
  // 面板（client-impl / 发布包 lib/client.js）+ app.html / 原型 + 样式双端 + 原型 mock
  await t('四端同步：筛选中心（筛选按钮(N) + 分组 popover + 激活 chips + 独立排序控件）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('筛选中心：分组勾选条件（组内 OR / 跨组 AND）') >= 0, label + ' 筛选中心入口 tooltip')
      assert(s.indexOf('dsh-notes-filterbar') >= 0 && s.indexOf('dsh-notes-fpop') >= 0 && s.indexOf('dsh-notes-fchip') >= 0 && s.indexOf('dsh-notes-fcnt') >= 0, label + ' 控制行结构（filterbar/popover/chip/计数丸）')
      assert(s.indexOf('dsh-notes-fsort-menu') >= 0 && s.indexOf('dsh-notes-fsort-item') >= 0, label + ' 独立排序控件菜单')
      assert(s.indexOf('组内多选 = OR') >= 0 && s.indexOf('组内 OR · 与状态组 = AND') >= 0, label + ' popover 分组规则文案')
      /* i18n 覆盖卡F：popover 底部命中数/清空/完成走 t() 字典（filter.hitCount/clear/done，zh 原串在 src/i18n/zh.js 随包内嵌） */
      assert(s.indexOf("t('filter.hitCount', { n: filteredCount })") >= 0 && s.indexOf("t('filter.clear')") >= 0 && s.indexOf("t('filter.done')") >= 0, label + ' popover 底部 命中数 + 清空/完成（覆盖卡F 起走 t()）')
      assert(s.indexOf("pred: n => n.status === 'pinned'") >= 0 && s.indexOf('pred: n => n.inject === true') >= 0 && s.indexOf('pred: n => n.injectEver === true') >= 0 && s.indexOf('pred: n => n.sensitive === true') >= 0, label + ' 状态组四条件谓词')
      assert(s.indexOf("n.injectEver !== undefined") >= 0, label + ' 曾注入 feature-detect（slim 有该字段才显示）')
      assert(s.indexOf("localStorage.setItem('dsh-notes-filters'") >= 0 && s.indexOf("localStorage.getItem('dsh-notes-filters')") >= 0, label + ' 筛选条件+排序 localStorage 持久化')
      assert(s.indexOf('searchMatches') >= 0 && s.indexOf('relRank') >= 0, label + ' 命中字段消费 + 相关度排位')
      assert(s.indexOf('sArgs.sensitive = true') >= 0 && s.indexOf('sArgs.inject = true') >= 0, label + ' 组合过滤参数同步 host（单条件独活时）')
      assert(s.indexOf("host.call('notes-search', sArgs)") >= 0 || s.indexOf("rpc('notes-search', sArgs)") >= 0, label + ' notes-search 走 sArgs（含组合过滤）')
      assert(s.indexOf('FILTERS0()') >= 0 && s.indexOf('matchFilters(n, filters)') >= 0, label + ' filters state + 谓词接入')
      assert(s.indexOf("'清空筛选'") >= 0, label + ' 空结果态「清空筛选」快捷动作')
      // Esc 顺序：排序菜单先于筛选 popover 关闭
      const escI = s.indexOf("if (ev.key === 'Escape')")
      const sI = s.indexOf('sortOpenRef.current) { setSortOpen(false); return }', escI)
      const fI = s.indexOf('filterOpenRef.current) { setFilterOpen(false); return }', escI)
      assert(sI > 0 && fI > 0 && sI < fI, label + ' Esc 顺序：排序菜单 → 筛选 popover')
      // 旧筛选面板/平铺 chips 已移除
      assert(s.indexOf('dsh-notes-filter-panel') < 0 && s.indexOf('dsh-notes-fp-opt') < 0 && s.indexOf('dsh-notes-chip-badge') < 0, label + ' 旧筛选面板结构已移除')
      assert(s.indexOf("'仅置顶'") < 0 && s.indexOf("'仅敏感'") < 0 && s.indexOf("'仅注入'") < 0, label + ' 旧单选开关文案已移除')
      assert(s.indexOf('kindFilter') < 0 && s.indexOf('pinnedOnly') < 0 && s.indexOf('sensOnly') < 0 && s.indexOf('injOnly') < 0, label + ' 旧过滤 state 已迁入 filters')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="filterbar"') >= 0 && s.indexOf('id="btnFilter"') >= 0 && s.indexOf('id="fchips"') >= 0 && s.indexOf('id="fpop"') >= 0 && s.indexOf('id="btnSort"') >= 0 && s.indexOf('id="fsortMenu"') >= 0 && s.indexOf('id="filterBd"') >= 0, label + ' 筛选中心 DOM 骨架')
      // 状态组/类型组 checkbox 由 FILTER_STATUS/FILTER_KINDS 驱动生成（data-ft/data-fk 为拼接属性，断言模型定义 + 拼接点）
      assert(s.indexOf("{ id: 'pinned', label: '置顶', icon: 'i-pin'") >= 0 && s.indexOf("{ id: 'injected', label: '已注入', icon: 'i-bolt'") >= 0 && s.indexOf("{ id: 'injectEver', label: '曾注入', icon: 'i-clock'") >= 0 && s.indexOf("{ id: 'sensitive', label: '敏感', icon: 'i-lock'") >= 0, label + ' 状态组四条件模型（多选）')
      assert(s.indexOf("data-ft=\"' + s.id + '\"") >= 0 && s.indexOf("data-fk=\"' + k + '\"") >= 0, label + ' 状态组/类型组 checkbox 接线（data-ft/data-fk）')
      assert(s.indexOf("var FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log'];") >= 0, label + ' 类型组六种 kind（多选；+log 工作记忆 v0 专入口）')
      assert(s.indexOf("if (s.id === 'injectEver' && !showEver) return") >= 0, label + ' 曾注入 feature-detect（slim 无 injectEver 字段不显示）')
      assert(s.indexOf('组内多选 = OR') >= 0 && s.indexOf('组内 OR · 与状态组 = AND') >= 0, label + ' 分组规则文案')
      assert(s.indexOf('id="popClear"') >= 0 && s.indexOf('id="popDone"') >= 0 && s.indexOf('命中 ') >= 0, label + ' popover 底部 清空/完成/命中数')
      assert(s.indexOf('id="emptyClear"') >= 0 && s.indexOf('清空筛选条件') >= 0, label + ' 空结果态清空链接')
      assert(s.indexOf('function matchFilters(n, F)') >= 0 && s.indexOf('matchFilters(n, filters)') >= 0, label + ' 筛选谓词（组内 OR / 跨组 AND）')
      assert(s.indexOf('function renderFilterBar()') >= 0 && s.indexOf('function renderFilterPop()') >= 0 && s.indexOf('function renderSortMenu()') >= 0, label + ' 筛选中心渲染函数')
      assert(s.indexOf('function doSearch()') >= 0 && s.indexOf('function reSearch()') >= 0, label + ' 搜索/重搜函数保留')
      assert(s.indexOf('sArgs.sensitive = true') >= 0 && s.indexOf('sArgs.inject = true') >= 0 && s.indexOf('sArgs.kind = filters.kinds[0]') >= 0 && s.indexOf("rpc('notes-search', sArgs)") >= 0, label + ' 组合过滤参数同步 host（单条件独活/类型单选时）')
      assert(s.indexOf("localStorage.getItem('dsh-notes-app-filters')") >= 0 && s.indexOf("localStorage.setItem('dsh-notes-app-filters'") >= 0, label + ' 筛选条件+排序 localStorage 持久化')
      assert(s.indexOf("$('btnFilter').addEventListener('click'") >= 0 && s.indexOf("$('btnSort').addEventListener('click'") >= 0, label + ' 筛选/排序按钮接线')
      assert(s.indexOf("$('fchips').addEventListener('click'") >= 0 && s.indexOf('filters[c.dataset.ft] = false') >= 0 && s.indexOf('filters.kinds.splice(i, 1)') >= 0, label + ' 激活 chip × 单条移除')
      assert(s.indexOf("$('fsortMenu').addEventListener('click'") >= 0, label + ' 排序菜单接线')
      assert(s.indexOf('function hl(text, q)') >= 0 && s.indexOf(label === 'app.html' ? "hl(n.title || t('tree.untitled'), searchText)" : "hl(n.title || '无标题', searchText)") >= 0 && s.indexOf('.note-row .ti mark{') >= 0, label + ' hl() 高亮保留（app 缺省标题走 t() 字典，i18n 覆盖卡A）')
      assert(s.indexOf("sortBy === 'rel' && qRel") >= 0, label + ' 相关度排序档保留')
      assert(s.indexOf('id="i-clock"') >= 0 && s.indexOf('id="i-sort"') >= 0 && s.indexOf('id="i-x"') >= 0, label + ' defs 含 i-clock/i-sort/i-x（曾注入/排序/×）')
      assert(s.indexOf('id="btnSelMode"') >= 0 && s.indexOf('id="btnNew"') >= 0, label + ' 选择（side-foot）/新建（brand 行）保留')
      assert(s.indexOf('class="add-new" id="btnNew"') >= 0 && s.indexOf('.brand .add-new{') >= 0, label + ' 新建入口迁入 brand 行')
      // Esc 顺序：排序菜单先于筛选 popover
      const sI2 = s.indexOf('if (sortOpen) { sortOpen = false; renderFilterBar(); return }')
      const fI2 = s.indexOf('if (filterOpen) { filterOpen = false; renderFilterBar(); return }')
      assert(sI2 > 0 && fI2 > 0 && sI2 < fI2, label + ' Esc 顺序：排序菜单 → 筛选 popover')
      // 旧筛选面板/平铺 chips 已移除
      assert(s.indexOf('id="fpanel"') < 0 && s.indexOf('.fpanel{') < 0 && s.indexOf('.fp-opt.on{') < 0 && s.indexOf('.chip .fbdg{') < 0, label + ' 旧筛选面板样式/容器已移除')
      assert(s.indexOf('id="chips"') < 0 && s.indexOf("'仅置顶'") < 0 && s.indexOf("'仅敏感'") < 0 && s.indexOf("'仅注入'") < 0, label + ' 旧 chips 行/单选开关文案已移除（带引号条件文案，避免误伤 mock 文本）')
      assert(s.indexOf('data-ft="inject"') < 0 && s.indexOf('data-k=') < 0 && s.indexOf('chipSortUse') < 0, label + ' 旧条件标记已迁移')
      // 布局层级断言（硬性约束：树区不被挤压）
      assert(/\.side\{[^}]*display:flex;flex-direction:column/.test(s), label + ' 侧栏 flex 纵列')
      assert(/\.tree\{[^}]*flex:1;overflow-y:auto/.test(s), label + ' 树区 flex:1 自适应剩余高度')
      assert(/\.filterbar\{[^}]*flex-wrap:nowrap[^}]*flex-shrink:0/.test(s), label + ' 控制行不换行 + 固定高度（不挤压树区）')
      assert(/\.fchips\{[^}]*overflow-x:auto/.test(s), label + ' 激活 chips 单行横向滚动')
      assert(/\.fpop\{[^}]*position:absolute/.test(s) && /\.fsort-menu\{[^}]*position:absolute/.test(s), label + ' popover/排序菜单均 absolute 浮层（覆盖树上）')
    }
    // 筛选谓词语义功能级回归：从四端源码提取 matchFilters 逐语义验证（组内 OR / 跨组 AND / 曾注入含已注入 / kind 缺省 note）
    const F0 = { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] }
    const F$ = (o) => Object.assign({}, F0, o)
    for (const pair of [['client-impl', clientSrc, '\n    }'], ['发布包 lib/client.js', clientPkgSrc, '\n    }'], ['app.html', appSrc, '\n}'], ['原型 notes-ui-v2.html', protoV2Src, '\n}']]) {
      const start = pair[1].indexOf('function matchFilters(n, F) {')
      const end = start < 0 ? -1 : pair[1].indexOf(pair[2], start)
      assert(start >= 0 && end > start, pair[0] + ' matchFilters 可提取')
      const m = [pair[1].slice(start, end + pair[2].length)]
      const mf = new Function('return ' + m[0])()
      assert(mf({ id: 'a' }, F0) === true, pair[0] + ' 无条件全过')
      assert(mf({ status: 'pinned' }, F$({ pinned: true })) === true && mf({ status: 'active' }, F$({ pinned: true })) === false, pair[0] + ' 置顶单条件')
      assert(mf({ status: 'pinned' }, F$({ pinned: true, sensitive: true })) === true && mf({ sensitive: true }, F$({ pinned: true, sensitive: true })) === true && mf({ status: 'active' }, F$({ pinned: true, sensitive: true })) === false, pair[0] + ' 状态组组内 OR（置顶 ∪ 敏感）')
      assert(mf({ inject: true, kind: 'decision' }, F$({ injected: true, kinds: ['decision'] })) === true && mf({ inject: true, kind: 'note' }, F$({ injected: true, kinds: ['decision'] })) === false && mf({ inject: false, kind: 'decision' }, F$({ injected: true, kinds: ['decision'] })) === false, pair[0] + ' 跨组 AND（已注入 ∩ 决策）')
      assert(mf({ kind: 'todo' }, F$({ kinds: ['note', 'todo'] })) === true && mf({ kind: 'link' }, F$({ kinds: ['note', 'todo'] })) === false, pair[0] + ' 类型组组内 OR')
      assert(mf({ injectEver: true, inject: true }, F$({ injectEver: true })) === true && mf({ injectEver: true }, F$({ injectEver: true })) === true && mf({ inject: true }, F$({ injectEver: true })) === false, pair[0] + ' 曾注入含已注入（injectEver=true 即命中）')
      assert(mf({}, F$({ kinds: ['note'] })) === true, pair[0] + ' kind 缺省回退 note')
    }
    assert(protoV2Src.indexOf('id="i-lock"') >= 0, '原型 defs 含 i-lock 图标（敏感条件）')
    assert(protoV2Src.indexOf('a.sensitive === true && x.sensitive !== true') >= 0, '原型 mock notes-search 组合过滤同 host 口径')
    assert(protoV2Src.indexOf("s.matches.push('title')") >= 0, '原型 mock 返回 matches 命中字段')
    assert(protoV2Src.indexOf('sensitive: n.sensitive === true') >= 0, '原型 mock slim 含 sensitive')
    assert(protoV2Src.indexOf("recall: true, sensitive: true, tags: [], createdAt: '2026-09-23T08:00:00.000Z'") >= 0, '原型 mock 演示数据：n4 敏感笔记（npm token）')
    assert(protoV2Src.indexOf('injectEver: true') >= 0 && protoV2Src.indexOf('if (n.injectEver !== undefined) s.injectEver = n.injectEver === true') >= 0, '原型 mock：曾注入演示数据 + slim 条件透传（feature-detect）')
    const cssDev34 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg34 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev34], ['发布包 lib/styles.css', cssPkg34]]) {
      const c = pair[1], lab = pair[0]
      assert(c.indexOf('.dsh-notes-filterbar{') >= 0 && c.indexOf('.dsh-notes-fpop{') >= 0 && c.indexOf('.dsh-notes-fchip{') >= 0 && c.indexOf('.dsh-notes-fsort-menu{') >= 0 && c.indexOf('.dsh-notes-fg-item{') >= 0 && c.indexOf('.dsh-notes-pbtn') >= 0, lab + ' 缺筛选中心样式（需跑 scripts/build-dist.cjs）')
      assert(c.indexOf('.dsh-notes-brand-add{') >= 0, lab + ' 缺 brand 行新建入口样式')
      assert(c.indexOf('.dsh-notes-mark{') >= 0, lab + ' 缺 mark 高亮样式')
      assert(/\.dsh-notes-filterbar\{[^}]*flex-wrap:nowrap[^}]*flex-shrink:0/.test(c) && /\.dsh-notes-fchips\{[^}]*overflow-x:auto/.test(c), lab + ' 控制行不换行 + chips 单行横滚（树区高度不受影响）')
      assert(/\.dsh-notes-fpop\{[^}]*position:absolute/.test(c) && /\.dsh-notes-fsort-menu\{[^}]*position:absolute/.test(c), lab + ' popover/排序菜单 absolute 浮层')
      assert(c.indexOf('.dsh-notes-filter-panel') < 0 && c.indexOf('.dsh-notes-fp-opt') < 0 && c.indexOf('.dsh-notes-chip-badge') < 0 && c.indexOf('.dsh-notes-chips{') < 0, lab + ' 旧筛选面板/chips 行样式已移除')
    }
  })
  await t('app.html / 原型 <script> 块语法自洽（提取 new Function 校验）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const m = pair[1].match(/<script>([\s\S]*?)<\/script>/)
      assert(m && m[1].length > 1000, pair[0] + ' script 块可提取')
      new Function(m[1])   // 语法错误会抛出
    }
  })

  // ---- 34.6 injectEver 曾注入粘性标记（notes-inject-filter）：host 双包字段链路 + 行为（粘性/归档继承）+ 四端徽章/chip ----
  await t('injectEver 字段链路源码断言（host-impl / index.mjs 双包同步）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const src = pair[1], label = pair[0]
      assert(src.indexOf("'injectEver: ' + escYaml(m.injectEver === true ? 'true' : 'false')") >= 0, label + ' buildFM 恒写 injectEver（缺省 false）')
      assert(src.indexOf("injectEver: p.meta.injectEver === 'true' || inject === true") >= 0, label + ' noteFromParsed 读 injectEver（缺省 false + 现状兜底 injectEver ⊇ inject）')
      assert((src.match(/injectEver: n\.injectEver === true \|\| n\.inject === true/g) || []).length >= 2, label + ' persistNote 与 slim 均携带 injectEver')
      assert(src.indexOf('injectEver: isLog ? (ex.injectEver === true) : (ex.injectEver === true || ex.inject === true),') >= 0, label + ' _create 粘性（创建即注入 / 归档继承显式传入；kind=log 隐身硬闸下不随被纠正的 inject 拉起）')
      assert(src.indexOf('if (inject === true) note.injectEver = true') >= 0, label + ' _update 单向粘性（inject 置 true 拉起，置 false/不传不回退）')
      assert(src.indexOf('injectEver: meta.inject === true') >= 0, label + ' notes-quick-instruct 落 injectEver')
      assert(src.indexOf('injectEver: members.some(n => n.injectEver === true || n.inject === true)') >= 0, label + ' _mergeGroup 归档继承（members.some，与 sensitive 同款）')
      assert(src.indexOf('never unsets it; injectEver is read-only') >= 0, label + ' note_manage 工具描述说明 injectEver 粘性语义')
    }
  })

  // --- 行为断言（独立实例 storeIE/handlersIE/toolsIE，与其他章节隔离；同 sensitive 节同款模式）---
  const storeIE = new Map()
  const fsMockIE = mkFsMockImp(storeIE, [NOTES_DIR])
  const handlersIE = {}
  const toolsIE = []
  const harnessMockIE = {
    handle: (name, fn) => { handlersIE[name] = fn; return () => { delete handlersIE[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { toolsIE.push(def); return () => {} },
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockIE, DIR).apply({
    fs: fsMockIE, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const nmIE = toolsIE.find(x => x.name === 'note_manage')

  await t('injectEver 创建即粘性：create inject=true → get / list（slim）/ front-matter 均 true', async () => {
    const c = await handlersIE['notes-create']({ title: '注入约定甲IE', body: 'x', topic: '注入IE', inject: true })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, 'notes-get injectEver=true')
    const lst = await handlersIE['notes-list']({})
    assert.strictEqual(lst.notes.find(n => n.id === c.id).injectEver, true, 'notes-list（slim）携带 injectEver=true')
    const onDisk = storeIE.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectEver: true\n') >= 0, 'front-matter 写 injectEver: true（实得：' + onDisk.split('\n').slice(0, 18).join('|') + '）')
  })
  await t('injectEver 缺省 false：create 不传 inject → get false + front-matter 恒写 false', async () => {
    const c = await handlersIE['notes-create']({ title: '普通笔记乙IE', body: 'x', topic: '杂IE' })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, false, '缺省 false（noteFromParsed 回退）')
    const onDisk = storeIE.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectEver: false\n') >= 0, 'buildFM 恒写 injectEver: false')
  })
  await t('injectEver 单向粘性（never unset）：开 → 关 → 仍 true；不传 inject 不动存量值', async () => {
    const c = await handlersIE['notes-create']({ title: '粘性笔记丙IE', body: 'x', topic: '注入IE' })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, false, '初始 false')
    await handlersIE['notes-update']({ id: c.id, inject: true })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, '开启注入 → injectEver=true')
    await handlersIE['notes-update']({ id: c.id, inject: false })
    const g2 = (await handlersIE['notes-get']({ id: c.id })).note
    assert.strictEqual(g2.inject, false, 'inject 已关闭')
    assert.strictEqual(g2.injectEver, true, '粘性核心断言：关闭注入后 injectEver 仍 true（不回退）')
    const onDisk = storeIE.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninject: false\n') >= 0 && onDisk.indexOf('\ninjectEver: true\n') >= 0, '落盘 inject=false 与 injectEver=true 并存')
    await handlersIE['notes-update']({ id: c.id, topic: '注入IE-改' })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, 'update 不传 inject → injectEver 不动')
  })
  await t('note_manage create/update 透传粘性：manage 开启 → 关闭 → 仍 true；list（slim）携带', async () => {
    const c = await nmIE.execute({ action: 'create', title: '工具粘性丁IE', body: 'x', topic: '注入IE' })
    assert(!c.error, 'manage.create 成功（实得：' + JSON.stringify(c) + '）')
    await nmIE.execute({ action: 'update', id: c.id, inject: true })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, 'manage.update inject=true 拉起 injectEver')
    await nmIE.execute({ action: 'update', id: c.id, inject: false })
    assert.strictEqual((await handlersIE['notes-get']({ id: c.id })).note.injectEver, true, 'manage.update inject=false 不回退（粘性）')
    const lst = await nmIE.execute({ action: 'list' })
    assert.strictEqual(lst.notes.find(n => n.id === c.id).injectEver, true, 'manage.list（slim）携带 injectEver=true')
  })
  await t('存量文件兼容：无字段缺省 false；旧 inject=true 现状兜底 true；injectEver: true 解析保留', async () => {
    await fsMockIE.writeText(NOTES_DIR + '\\n-legacy-plain-ie.md', '---\nid: n-legacy-plain-ie\ntitle: 旧普通\ntopic: 杂\ninject: false\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\nx\n')
    assert.strictEqual((await handlersIE['notes-get']({ id: 'n-legacy-plain-ie' })).note.injectEver, false, '旧文件无 injectEver 字段缺省 false（零迁移）')
    await fsMockIE.writeText(NOTES_DIR + '\\n-legacy-inj-ie.md', '---\nid: n-legacy-inj-ie\ntitle: 旧注入\ntopic: 杂\ninject: true\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\nx\n')
    assert.strictEqual((await handlersIE['notes-get']({ id: 'n-legacy-inj-ie' })).note.injectEver, true, '旧 inject=true 笔记现状兜底 injectEver=true（injectEver ⊇ inject 不变量）')
    await fsMockIE.writeText(NOTES_DIR + '\\n-legacy-ever-ie.md', '---\nid: n-legacy-ever-ie\ntitle: 旧曾注入\ntopic: 杂\ninject: false\ninjectEver: true\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\nx\n')
    const g3 = (await handlersIE['notes-get']({ id: 'n-legacy-ever-ie' })).note
    assert.strictEqual(g3.injectEver, true, 'injectEver: true 存量解析保留')
    assert.strictEqual(g3.inject, false, 'inject: false 保留（曾注入且已关闭形态）')
  })
  await t('归档合并 injectEver 继承：任一成员曾注入/正注入 → 归档笔记 true；全普通 → false', async () => {
    const c1 = await nmIE.execute({ action: 'create', title: '归档成员-曾注入IE', body: 'x1', topic: '归档IE' })
    await nmIE.execute({ action: 'update', id: c1.id, inject: true })
    await nmIE.execute({ action: 'update', id: c1.id, inject: false })   // 曾注入（现已关闭）
    const c2 = await nmIE.execute({ action: 'create', title: '归档成员-普通IE', body: 'x2', topic: '归档IE' })
    const r = await nmIE.execute({ action: 'archive', groups: [{ memberIds: [c1.id, c2.id] }] })
    assert(!r.error && r.merged === 1, '归档成功（实得：' + JSON.stringify(r) + '）')
    assert.strictEqual((await handlersIE['notes-get']({ id: r.mergedIds[0] })).note.injectEver, true, '归档笔记继承 injectEver（成员曾注入）')
    const c3 = await nmIE.execute({ action: 'create', title: '归档成员-普通甲IE', body: 'y1', topic: '归档IE2' })
    const c4 = await nmIE.execute({ action: 'create', title: '归档成员-普通乙IE', body: 'y2', topic: '归档IE2' })
    const r2 = await nmIE.execute({ action: 'archive', groups: [{ memberIds: [c3.id, c4.id] }] })
    assert(!r2.error && r2.merged === 1, '第二组归档成功')
    assert.strictEqual((await handlersIE['notes-get']({ id: r2.mergedIds[0] })).note.injectEver, false, '全普通成员 → 归档笔记 injectEver=false')
  })
  await t('静态包 index.mjs 行为：injectEver 粘性（开 → 关 → 仍 true）+ slim 携带', async () => {
    const storeIE2 = new Map()
    const handlersIE2 = {}
    const harnessMockIE2 = { handle: (name, fn) => { handlersIE2[name] = fn; return () => { delete handlersIE2[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    global.harness = harnessMockIE2   // 静态包 handle() 主通道读全局 harness（apply 时解析）；指回本实例注册表
    const modIE = await import(pathToFileURL(INDEX_PATH).href + '?injever=1')
    modIE.apply({
      fs: mkFsMockImp(storeIE2, [NOTES_ROOT_STATIC]), sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: () => () => {} }, tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    const c = await handlersIE2['notes-create']({ title: '静态粘性IE', body: 'x', topic: '注入IE' })
    assert.strictEqual((await handlersIE2['notes-get']({ id: c.id })).note.injectEver, false, '静态包初始 false')
    await handlersIE2['notes-update']({ id: c.id, inject: true })
    await handlersIE2['notes-update']({ id: c.id, inject: false })
    const g = (await handlersIE2['notes-get']({ id: c.id })).note
    assert.strictEqual(g.inject, false, '静态包 inject 已关闭')
    assert.strictEqual(g.injectEver, true, '静态包粘性：关闭注入后 injectEver 仍 true')
    const lst = await handlersIE2['notes-list']({})
    assert.strictEqual(lst.notes.find(n => n.id === c.id).injectEver, true, '静态包 slim 携带 injectEver')
    const onDisk = storeIE2.get(NOTES_ROOT_STATIC + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectEver: true\n') >= 0, '静态包 front-matter 落 injectEver: true')
  })

  // --- 四端同步：曾注入行徽章 + 详情 meta chip（面板双形态 / app.html / 原型）---
  await t('四端同步：曾注入行徽章（clock）+ 详情 meta chip + 样式', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("className: 'dsh-notes-note-injevr dsh-nt'") >= 0, label + ' 行尾曾注入徽章（clock，被引用徽章旁；需跑 scripts/build-dist.cjs）')
      assert(s.indexOf("n.inject !== true && n.injectEver === true ? e('span', { className: 'dsh-notes-note-injevr") >= 0, label + ' 行徽章条件：曾注入且非已注入（互斥 bolt），不满足不渲染')
      assert(s.indexOf("'data-tooltip': tt('tree.injectEverTip')") >= 0, label + ' 行徽章 tooltip（i18n 覆盖卡A 起走 t() 字典）')
      assert(s.indexOf("curNote.injectEver === true && !isInjected") >= 0, label + ' 详情 chip 条件（injectEver 且当前未注入）')
      assert(s.indexOf("I('clock', 11), tt('meta.injectEver')") >= 0, label + ' 详情 meta chip「曾注入」（clock 图标；i18n 覆盖卡B 起走 tt() 字典）')
      assert(s.indexOf('injectEver 为粘性标记，不随关闭回退') >= 0, label + ' 详情 chip tooltip 说明粘性语义')
      assert(s.indexOf("clock: [e('circle'") >= 0, label + ' IC.clock 时钟图标')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("!n.inject && n.injectEver === true ? '<span class=\"injevr\"") >= 0, label + ' 行徽章条件：曾注入且非已注入（互斥 bolt）')
      assert(s.indexOf('曾注入：历史上开启过上下文注入（现已关闭）') >= 0, label + ' 行徽章 tooltip')
      assert(s.indexOf("icon('i-clock', 9)") >= 0, label + ' 行徽章 i-clock 图标')
      assert(s.indexOf('.note-row .injevr{') >= 0, label + ' 行徽章样式（淡灰时钟）')
      assert(s.indexOf("n.injectEver === true && !n.inject ? '<span class=\"meta-chip\"") >= 0, label + ' 详情 meta chip 条件')
      /* i18n 覆盖卡B：app 详情 chip 文案走 t() 字典；原型不双语保留中文原文（分侧断言） */
      if (label === 'app.html') assert(s.indexOf("icon('i-clock') + t('meta.injectEver') + '</span>'") >= 0, label + ' 详情 meta chip「曾注入」走 t()（覆盖卡B）')
      else assert(s.indexOf("icon('i-clock') + '曾注入</span>'") >= 0, label + ' 详情 meta chip「曾注入」')
      assert(s.indexOf('injectEver 为粘性标记，不随关闭回退') >= 0, label + ' 详情 chip tooltip 说明粘性语义')
    }
    const cssIEDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssIEPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssIEDev], ['发布包 lib/styles.css', cssIEPkg]]) {
      assert(pair[1].indexOf('.dsh-notes-note-injevr{') >= 0, pair[0] + ' 含曾注入行徽章样式（需跑 scripts/build-dist.cjs）')
    }
    // 原型 mock：n3/n10 曾注入演示数据（inject: false + injectEver: true → 行渲染时钟徽章）
    assert(protoV2Src.indexOf("inject: false, injectTo: [], recall: true, tags: ['quick'], injectEver: true") >= 0, '原型 mock n3 曾注入演示数据')
  })
  }
}
