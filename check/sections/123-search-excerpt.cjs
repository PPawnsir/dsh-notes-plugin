// 节 123. 0.5.0 交互层首版：搜索结果摘要行 + 命中高亮（notes-050-search-excerpt）
// 设计冻结（主窗口设计稿）：搜索态（有 query）结果行标题下加一行摘要（CSS 2 行 clamp，次级色）——
//   ① 正文命中 = host 算首个命中点 ±50 字窗口 + 命中区间数组 [{start,len}]（相对摘录文本），前端 hlMarks 先 esc 后包 <mark>；
//   ② 语义命中 = 胜出 chunk（per-note max-pooling 冠军块）开头 ~80 字纯文本，marks 空（语义无词位置，诚实呈现）；
//   ③ 仅标题/标签命中 = 正文开头 ~80 字（上下文补足）。无 query 不带 excerpt 字段（向后兼容）。
// 断言面：searchExcerpt 纯函数行为级（居中/边界截断/区间数组/语义 chunk/标题补足/空 query）+ host 行为级（notes-search/note_search 透出 +
//   语义幽灵向量全管道）+ UI 静态（摘要行 markup/CSS clamp/hlMarks 先 esc 后 mark + 双端逐字节）+ 面板同构 + 原型/e2e mock 同步。
module.exports = {
  id: "123",
  title: "123. 0.5.0 交互层 搜索摘要行+命中高亮（notes-050-search-excerpt）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc, clientSrc } = H
  const { appSrc, protoV2Src, clientPkgSrc, mkFsMockImp, llmMock, admMock, agentsMock, sessionPersistenceMock, workspaceRegistryMock, sessionTitleMock, sessionQueryMock, NOTES_DIR } = S
  section('123. 0.5.0 交互层 搜索摘要行 + 命中高亮（notes-050-search-excerpt）')

  // ===== A. searchExcerpt 纯函数行为级（search-helpers 标记块 eval；双包逐字节一致由节 34 既有断言看守）=====
  const searchBlk = hostSrc.match(/\/\/ ==== search-helpers BEGIN ====[\s\S]*?\/\/ ==== search-helpers END ====/)
  assert(searchBlk, 'host-impl 缺 search-helpers 标记块')
  const NS = {}
  new Function('ns', searchBlk[0] + '\nns.searchExcerpt = searchExcerpt; ns.CTX = SEARCH_EXCERPT_CTX; ns.HEAD = SEARCH_EXCERPT_HEAD')(NS)
  const sx = NS.searchExcerpt

  await t('searchExcerpt 关键词命中点居中 + 边界截断 + 省略号（±50 字窗口）', () => {
    assert.strictEqual(NS.CTX, 50, '窗口半径常量 50 冻结')
    assert.strictEqual(NS.HEAD, 80, '头部摘录常量 80 冻结')
    // 居中：命中点距两端均 >50 → 双端省略号 + 窗口 [idx-50, idx+qlen+50)
    const body = '前'.repeat(100) + '目标词' + '后'.repeat(100)
    const r = sx({ body: body }, '目标词')
    assert(r && r.text.charAt(0) === '…' && r.text.slice(-1) === '…', '双端截断补省略号')
    assert.strictEqual(r.text.length, 1 + 50 + 3 + 50 + 1, '窗口 = 50+qlen+50 + 双省略号（实得 ' + r.text.length + '）')
    assert.deepStrictEqual(r.marks, [{ start: 51, len: 3 }], '命中区间相对摘录文本（含前省略号偏移 1）')
    assert.strictEqual(r.text.substring(51, 54), '目标词', '区间回读=命中词')
    // 边界：命中在开头 → 无前省略号；命中在结尾 → 无后省略号
    const r2 = sx({ body: '目标词' + '尾'.repeat(200) }, '目标词')
    assert(r2.text.indexOf('目标词') === 0 && r2.text.charAt(0) !== '…', '首命中贴开头 → 无前省略号')
    assert.deepStrictEqual(r2.marks, [{ start: 0, len: 3 }], '开头命中区间起点 0')
    const r3 = sx({ body: '头'.repeat(200) + '目标词' }, '目标词')
    assert(r3.text.slice(-1) === '词' && r3.text.indexOf('…') === 0, '尾命中贴结尾 → 无后省略号、有前省略号')
    assert.strictEqual(r3.text.substring(r3.marks[0].start, r3.marks[0].start + r3.marks[0].len), '目标词', '尾命中区间回读正确')
    // 短正文不截断：全文即摘录，零省略号
    const r4 = sx({ body: '短正文目标词结束' }, '目标词')
    assert.strictEqual(r4.text, '短正文目标词结束', '短正文零截断零省略号')
    assert.deepStrictEqual(r4.marks, [{ start: 3, len: 3 }], '短正文区间正确')
  })

  await t('searchExcerpt 区间数组：窗内多命中全列 + 窗沿命中 len 截断', () => {
    // 多命中：窗内 3 次出现全进 marks（相对偏移含前省略号）
    const body = '填'.repeat(60) + '锚词' + '间'.repeat(10) + '锚词' + '间'.repeat(10) + '锚词' + '尾'.repeat(60)
    const r = sx({ body: body }, '锚词')
    assert.strictEqual(r.marks.length, 3, '窗内 3 命中全列（实得 ' + r.marks.length + '）')
    for (const m of r.marks) assert.strictEqual(r.text.substring(m.start, m.start + m.len), '锚词', '每个区间回读=命中词（start=' + m.start + '）')
    // 窗沿截断：第二个命中跨窗右沿 → len 截到窗沿（区间不越界）
    const body2 = '锚词' + '填'.repeat(49) + '锚词' + '尾'.repeat(60)   // 第二命中起于 51（窗 e=52），仅 1 字在窗内
    const r2 = sx({ body: body2 }, '锚词')
    assert.strictEqual(r2.marks.length, 2, '窗沿命中仍入列（实得 ' + JSON.stringify(r2.marks) + '）')
    assert.deepStrictEqual(r2.marks[1], { start: 51, len: 1 }, '跨窗沿命中 len 截断到窗沿（3→1）')
    assert.strictEqual(r2.text.charAt(51), '锚', '截断区间回读=命中首字')
  })

  await t('searchExcerpt 语义 chunk 摘要 + 标题/标签命中补足 + 空 query/空正文', () => {
    // 语义命中（无正文命中）：胜出 chunk 开头 80 字 + marks 空 + 超长补 …
    const chunk = '块'.repeat(100)
    const r = sx({ body: '与查询无关的正文' }, '幽灵词', chunk)
    assert(r && r.text === '块'.repeat(80) + '…' && r.marks.length === 0, '语义摘要=chunk 开头 80 字 + … + marks 空')
    const r2 = sx({ body: '无关' }, '幽灵词', '短块文本')
    assert(r2 && r2.text === '短块文本' && r2.marks.length === 0, '短 chunk 不补省略号')
    // 仅标题/标签命中（无正文命中、无 chunk）：正文开头 80 字补足
    const body = '正'.repeat(100)
    const r3 = sx({ body: body }, '幽灵词')
    assert(r3 && r3.text === '正'.repeat(80) + '…' && r3.marks.length === 0, '标题命中摘要=正文开头 80 字 + marks 空')
    const r4 = sx({ body: '短正文' }, '幽灵词')
    assert(r4 && r4.text === '短正文' && r4.marks.length === 0, '短正文补足不补省略号')
    // 优先级：正文命中 > 语义 chunk（双命中走关键词区间高亮）
    const r5 = sx({ body: '含锚词的正文' }, '锚词', chunk)
    assert(r5.marks.length === 1 && r5.text === '含锚词的正文', '双命中优先关键词路径（marks 非空）')
    // 空 query → null（无 excerpt 字段口径）；无正文且无 chunk → null
    assert.strictEqual(sx({ body: 'x' }, ''), null, '空 query → null')
    assert.strictEqual(sx({ body: '' }, '幽灵词'), null, '空正文且无 chunk → null（该行无摘要）')
    assert.strictEqual(sx({}, '幽灵词'), null, '缺 body 字段 → null')
  })

  // ===== B. host 行为级（独立实例，防污染共享库；fake 后端确定性向量）=====
  function mk123() {
    const store = new Map()
    const handlers = {}
    const tools = []
    const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: (c, d) => { tools.push(d); return () => {} } }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply({
      fs: mkFsMockImp(store, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return { handlers, tools, settle: async () => { await handlers['notes-vectors-status']({}) } }
  }

  await t('excerpt 行为级：notes-search 正文命中带区间摘要 + 标题命中带正文开头 + 无 query 无 excerpt 字段', async () => {
    const { handlers } = mk123()
    const pad = '填'.repeat(80)
    const n1 = await handlers['notes-create']({ title: '摘录甲', body: pad + '锚定词甲乙' + pad })
    const n2 = await handlers['notes-create']({ title: '锚定词标题命中', body: '这条正文不含查询词但作补足摘要数据源' })
    const r = await handlers['notes-search']({ query: '锚定词' })
    const byId = {}
    for (const n of r.notes) byId[n.id] = n
    const e1 = byId[n1.id] && byId[n1.id].excerpt
    assert(e1 && typeof e1.text === 'string' && Array.isArray(e1.marks), '正文命中行带 excerpt {text,marks}')
    assert(e1.text.indexOf('锚定词甲乙') >= 0 && e1.marks.length === 1, '命中点在窗内 + 单区间')
    assert.strictEqual(e1.text.substring(e1.marks[0].start, e1.marks[0].start + e1.marks[0].len), '锚定词', '区间回读=命中词（相对摘录文本）')
    assert(!('body' in byId[n1.id]), '瘦身不含 body（摘要行不泄漏全文通道）')
    const e2 = byId[n2.id] && byId[n2.id].excerpt
    assert(e2 && e2.marks.length === 0 && e2.text.indexOf('这条正文不含查询词') === 0, '仅标题命中 → 正文开头补足 + marks 空')
    const r0 = await handlers['notes-search']({ tag: '__无此标签__' })
    assert(r0.notes.length === 0 && !(r0.notes[0] && 'excerpt' in r0.notes[0]), '空结果无 excerpt')
    const rAll = await handlers['notes-search']({})
    assert(rAll.notes.length >= 2 && rAll.notes.every(n => !('excerpt' in n)), '无 query → 全部结果不带 excerpt 字段（向后兼容）')
  })

  await t('note_search 工具透出 excerpt（同 RPC 口径：正文命中区间 + 标题命中补足）', async () => {
    const { handlers, tools } = mk123()
    await handlers['notes-create']({ title: '工具摘录', body: '正文里埋着工具锚点这个词' })
    const tool = tools.find(x => x.name === 'note_search')
    assert(tool, 'note_search 已注册')
    const tr = await tool.execute({ query: '工具锚点' })
    assert(tr.count === 1 && tr.notes[0].excerpt, '工具结果带 excerpt')
    const ex = tr.notes[0].excerpt
    assert.strictEqual(ex.text.substring(ex.marks[0].start, ex.marks[0].start + ex.marks[0].len), '工具锚点', '工具 excerpt 区间回读=命中词')
    assert(tool.description.indexOf('excerpt {text, marks:[{start,len}]}') >= 0, '工具描述含 excerpt 契约说明')
  })

  await t('语义胜出块摘要全管道：notes-vectors-put 幽灵向量 → 语义命中行 excerpt=正文块开头（marks 空）+ semantic 徽标', async () => {
    // fake 嵌入器同文本恒同向量：把「查询词文本」的向量经 put 写成笔记的 chunk 0 → 语义命中但正文零关键词重叠；
    // fake-64（minScore 0.9）保证只有精确同文本向量过闸（fake-256 minScore=0 随机向量有擦线 flaky 风险）
    const grabH = (name) => { const m = hostSrc.match(new RegExp('    function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}')); assert(m, 'host 缺 ' + name); return m[0] }
    const vecNS = {}
    new Function('ns', grabH('_vectorFnv1a') + '\n' + grabH('_vectorMulberry32') + '\n' + grabH('_vectorFakeEmbedOne') + '\nns.embed = _vectorFakeEmbedOne')(vecNS)
    const { handlers, settle } = mk123()
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-64' } })
    const ghostBody = '这段正文与查询语义相关但字面上完全不重叠，用来验证语义命中摘要取胜出块开头。'
    const ghost = await handlers['notes-create']({ title: '幽灵笔记', body: ghostBody })
    const both = await handlers['notes-create']({ title: '双通道', body: '含有语义通道幽灵查询的正文' })
    await settle()
    const qVec = vecNS.embed('语义通道幽灵查询', 64)
    const put = await handlers['notes-vectors-put']({ backend: 'fake-64', rows: [{ noteId: ghost.id, bodyHash: 'ghost', vectors: [qVec] }, { noteId: both.id, bodyHash: 'both', vectors: [qVec] }] })
    assert(put && put.ok === true && put.written === 2, '幽灵向量写入成功（实得 ' + JSON.stringify(put) + '）')
    const r = await handlers['notes-search']({ query: '语义通道幽灵查询' })
    const g = (r.notes || []).find(n => n.id === ghost.id)
    assert(g, '幽灵笔记语义召回（fake 桩同文本恒同向量）')
    assert.strictEqual(g.semantic, true, '语义命中徽标在')
    assert(g.excerpt && g.excerpt.marks.length === 0, '语义摘要 marks 空（语义无词位置，诚实呈现）')
    assert.strictEqual(g.excerpt.text, ghostBody.slice(0, 80), '语义摘要=胜出块开头（单块笔记=正文开头 80 字内）')
    // 双通道命中（文本+语义）→ 摘要仍走关键词区间路径（优先级锁）
    const b = r.notes.find(n => n.id === both.id)
    assert(b && b.semantic === true && b.excerpt && b.excerpt.marks.length === 1, '双命中行：语义徽标 + 关键词区间摘要并存')
    assert.strictEqual(b.excerpt.text.substring(b.excerpt.marks[0].start, b.excerpt.marks[0].start + b.excerpt.marks[0].len), '语义通道幽灵查询', '双命中区间回读=查询词')
  })

  // ===== C. UI 静态断言（app.html ⇄ 原型 双端 + 面板 client 同构 + 样式双端）=====
  const grabFn = (s, name, tag) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')); assert(m, tag + ' 缺 ' + name + '()'); return m[0] }

  await t('hlMarks 区间高亮双端逐字节一致（app.html ⇄ 原型）+ 源码顺序=先 esc 后 mark', () => {
    const hApp = grabFn(appSrc, 'hlMarks', 'app.html')
    const hProto = grabFn(protoV2Src, 'hlMarks', '原型 notes-ui-v2.html')
    assert.strictEqual(hApp, hProto, 'hlMarks 双端逐字节一致')
    const escPos = hApp.indexOf('esc('), markPos = hApp.indexOf("'<mark>'")
    assert(escPos >= 0 && markPos > escPos, '源码顺序：先 esc 再包 <mark>（先转义后插标签红线）')
  })

  await t('hlMarks 行为级：区间包裹正确 + 逐段 esc 零 XSS + 越界/重叠防御 + 无 marks 纯转义', () => {
    const ns = {}
    new Function('ns', grabFn(appSrc, 'esc', 'app.html') + '\n' + grabFn(appSrc, 'hlMarks', 'app.html') + '\nns.hlMarks = hlMarks')(ns)
    const hm = ns.hlMarks
    assert.strictEqual(hm('abcdef', [{ start: 1, len: 3 }]), 'a<mark>bcd</mark>ef', '区间包裹正确')
    assert.strictEqual(hm('a&b<c>', [{ start: 1, len: 1 }, { start: 3, len: 2 }]), 'a<mark>&amp;</mark>b<mark>&lt;c</mark>&gt;', '逐段 esc：命中段转义后套 mark（&→&amp; 区间仍对准），残余段也转义')
    const xss = hm('<img src=x onerror=alert(1)>锚', [{ start: 28, len: 1 }])
    assert(xss.indexOf('<img') < 0 && xss.indexOf('<mark>锚</mark>') >= 0, '恶意摘录文本零注入（<img 成纯文本，命中仍高亮）')
    assert.strictEqual(hm('纯文本无区间', []), '纯文本无区间', 'marks 空 → 纯 esc（语义/标题命中摘要形态）')
    assert.strictEqual(hm('abc', [{ start: 2, len: 99 }]), 'ab<mark>c</mark>', 'len 越界截到文本尾')
    assert.strictEqual(hm('abc', [{ start: -5, len: 2 }]), '<mark>ab</mark>c', 'start 越界截到 0')
    assert.strictEqual(hm('abcd', [{ start: 0, len: 2 }, { start: 1, len: 2 }]), '<mark>ab</mark>cd', '重叠区间跳过（防御）')
    assert.strictEqual(hm('', [{ start: 0, len: 1 }]), '', '空文本 → 空串')
  })

  await t('摘要行 markup + CSS（app.html ⇄ 原型 双端同构）：has-ex 换行 + .ex 摘要行 + 2 行 clamp + mark 样式', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('hlMarks(ex.text, ex.marks)') >= 0, label + ' 摘要行经 hlMarks 区间高亮')
      assert(s.indexOf('\'<div class="ex">\' + hlMarks') >= 0, label + ' 摘要行容器 <div class="ex">')
      assert(s.indexOf("(exHtml ? ' has-ex' : '')") >= 0, label + ' 行 has-ex 类（flex-wrap 换行开关）')
      assert(s.indexOf('searchEx[n.id]') >= 0, label + ' 摘要数据源 searchEx（host 下发）')
      assert(s.indexOf('.note-row.has-ex{flex-wrap:wrap}') >= 0, label + ' has-ex 换行样式')
      const m = s.match(/\.note-row \.ex\{[^}]*\}/)
      assert(m, label + ' 缺 .note-row .ex 摘要行样式')
      assert(m[0].indexOf('-webkit-line-clamp:2') >= 0 && m[0].indexOf('flex-basis:100%') >= 0, label + ' 2 行 clamp + 整行换行')
      assert(m[0].indexOf('color:var(--nt2)') >= 0, label + ' 次级色（--nt2）')
      assert(s.indexOf('.note-row .ex mark{') >= 0, label + ' 摘要行 mark 高亮样式（复用标题同款底色）')
    }
    // 摘要行挂点=行尾（tail 之后、行容器闭合前）——标题下一行视觉序
    assert(appSrc.indexOf('+ tail + exHtml + \'</div>\'') >= 0, 'app noteRow 摘要行挂在行尾（flex-wrap 落第二行）')
  })

  await t('面板同构（client-impl + 发布包）：excerptKids + searchExcerpts 态 + .dsh-notes-note-ex 摘要行 + 样式双端', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('function excerptKids(ex)') >= 0, label + ' excerptKids 区间高亮（React 文本节点自动转义）')
      assert(s.indexOf("e('mark', { key: 'm' + i, className: 'dsh-notes-mark' }") >= 0, label + ' 命中段走 mark 元素（零 innerHTML）')
      assert(s.indexOf('searchExcerpts') >= 0 && s.indexOf('if (n.excerpt) ee[n.id] = n.excerpt') >= 0, label + ' 搜索响应采集 excerpt（需先跑 scripts/build-dist.cjs）')
      assert(s.indexOf("className: 'dsh-notes-note-ex'") >= 0, label + ' 摘要行节点')
      assert(s.indexOf("(excKids ? ' has-ex' : '')") >= 0, label + ' 行 has-ex 类')
      assert(s.indexOf('searchExcerpts: searchExcerpts') >= 0, label + ' usePanelSearch → usePanelTree 装配接线')
    }
    const cssDev = fsNative.readFileSync(H.SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      const c = pair[1], label = pair[0]
      assert(c.indexOf('.dsh-notes-note-row.has-ex{flex-wrap:wrap}') >= 0, label + ' has-ex 换行样式')
      const m = c.match(/\.dsh-notes-note-ex\{[^}]*\}/)
      assert(m && m[0].indexOf('-webkit-line-clamp:2') >= 0 && m[0].indexOf('flex-basis:100%') >= 0, label + ' 摘要行 2 行 clamp + 整行换行')
      assert(c.indexOf('.dsh-notes-note-ex .dsh-notes-mark{') >= 0, label + ' 摘要行 mark 样式')
    }
  })

  await t('原型/e2e mock 同步：摘要计算同 host 形状（±50 窗口 + 区间数组 + 80 字补足）', () => {
    assert(protoV2Src.indexOf('function _mockExcerpt(x, q)') >= 0 && protoV2Src.indexOf('if (ex) s.excerpt = ex') >= 0, '原型 mock notes-search 摘要下发')
    const mockSrc = fsNative.readFileSync(path.join(DIR, 'scripts', 'e2e', 'server.cjs'), 'utf8')
    assert(mockSrc.indexOf('s.excerpt = { text: text, marks: marks }') >= 0, 'e2e mock 正文命中 excerpt（±50 窗口 + marks）')
    assert(mockSrc.indexOf("s.excerpt = { text: body.slice(0, 80) + (body.length > 80 ? '…' : ''), marks: [] }") >= 0, 'e2e mock 标题命中正文开头补足（marks 空）')
    // e2e 用例在册（59-search-excerpt）
    assert(fsNative.existsSync(path.join(DIR, 'scripts', 'e2e', 'cases', '59-search-excerpt.cjs')), 'e2e 用例 59-search-excerpt.cjs 在册')
  })

  await t('host 双包 excerpt 透出结构（notes-search + note_search 双通道 × dev/dist 双侧）', () => {
    for (const pair of [['host-impl（dev 拼接）', hostSrc], ['index.mjs（dist 产物）', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert((s.match(/if \(n\.excerpt\) s\.excerpt = n\.excerpt/g) || []).length === 2, label + ' excerpt 透出双通道（notes-search + note_search）')
      assert(s.indexOf('_vectorChunks(n.body)[ci]') >= 0, label + ' 语义胜出块文本锚点（_vectorChunks 按 chunk 序取块）')
      assert(s.indexOf('excerpt {text, marks:[{start,len}]}') >= 0, label + ' note_search 描述含 excerpt 契约')
    }
  })
  }
}
