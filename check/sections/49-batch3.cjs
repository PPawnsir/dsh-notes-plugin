// 节 49. N+1 批量端点 + onboarding 轻量 + 新建草稿态（notes-034-batch3）
// 背景：UX 巡检 R1 同批三项——①首屏 N+1 请求风暴（n-mut6u356mloa：76 条库 159 次 notes-get）→ host 新增 notes-get-batch + 双端索引改批量；
//   ②首屏副标题 RPC 术语 / 空态提示引用不存在的「新建」按钮 / 设置卡概念无前置解释（n-mut4n5yqyoys + n-mut4n60q6pdt）→ 轻量文案落地；
//   ③新建点击即落库产生空 Untitled（n-mut4n5zuuxaw）→ 本地草稿态（首次有效编辑才 create）；顶栏「归档」改名「速记」（n-mut4lsex2cx8，
//   与 modal/执行层真归档语义区分；「收纳入库」方向感相反弃用——操作是把速记收走合并出活跃列表，非把东西放进库）。
module.exports = {
  id: "49",
  title: "49. N+1 批量端点 + onboarding 轻量 + 新建草稿态（notes-034-batch3）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc, indexSrc, io } = H
  const { handlers } = S
  section('49. N+1 批量端点 + onboarding 轻量 + 新建草稿态（notes-034-batch3）')
  const APP_SRC49 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const PROTO49 = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  const CLIENT_PKG49 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')

  // ===== 49.1 host 行为：notes-get-batch 批量端点（节 2 共享内存实例）=====
  const b49a = await handlers['notes-create']({ title: '批量样本甲', body: '正文甲', tags: [], topic: '批量' })
  const b49b = await handlers['notes-create']({ title: '批量样本乙', body: '正文乙', tags: [], topic: '批量' })
  const b49c = await handlers['notes-create']({ title: '批量样本丙', body: '正文丙', tags: [], topic: '批量' })
  await handlers['notes-delete']({ id: b49c.id })   // 软删 → batch 计入 missing（wiki 索引只索引活跃笔记，与 notes-get 缺省口径一致）
  await t('notes-get-batch：一次拉全多条正文（{id,body,updatedAt} 三字段最小面）', async () => {
    const r = await handlers['notes-get-batch']({ ids: [b49a.id, b49b.id] })
    assert(!r.error, '批量成功（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.notes.length, 2, '两条正文返回')
    const ma = r.notes.find(n => n.id === b49a.id), mb = r.notes.find(n => n.id === b49b.id)
    assert(ma && ma.body === '正文甲' && mb && mb.body === '正文乙', '正文内容正确')
    assert(ma.updatedAt && typeof ma.updatedAt === 'string', 'updatedAt 携带（索引 reconcile 判据）')
    assert(!('title' in ma) && !('tags' in ma), '最小传输面：不带 slim 元字段')
    assert.deepStrictEqual(r.missing, [], '无 missing')
  })
  await t('notes-get-batch：不存在/已删条目计入 missing 不报错（调用方按缺口径下轮重试）', async () => {
    const r = await handlers['notes-get-batch']({ ids: [b49a.id, 'n-不存在的id', b49c.id] })
    assert(!r.error, '部分缺失不报错（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.notes.length, 1, '仅存活条目返回正文')
    assert.strictEqual(r.notes[0].id, b49a.id, '存活条目正确')
    assert(r.missing.indexOf('n-不存在的id') >= 0 && r.missing.indexOf(b49c.id) >= 0, 'missing 含不存在 + 已软删')
  })
  await t('notes-get-batch：空 ids → 空结果；缓存命中零新增磁盘读', async () => {
    const r0 = await handlers['notes-get-batch']({ ids: [] })
    assert.deepStrictEqual(r0, { notes: [], missing: [] }, '空 ids 形态')
    const before = io.reads
    await handlers['notes-get-batch']({ ids: [b49a.id, b49b.id] })
    assert.strictEqual(io.reads, before, 'loadNote 缓存命中零磁盘读（批量端点不放大 I/O）')
  })

  // ===== 49.2 双包同源 + 双端接线（静态）=====
  await t('notes-get-batch 双包逐字节一致（标记块）+ 注册面齐全', () => {
    const mRe = /\/\/ ==== notes-get-batch BEGIN ====[\s\S]*?\/\/ ==== notes-get-batch END ====/
    const bDev = hostSrc.match(mRe), bDist = indexSrc.match(mRe)
    assert(bDev && bDist, '开发版拼接（server.js）与静态包 index.mjs（server.dist.js）均须含 notes-get-batch 标记块')
    assert.strictEqual(bDev[0], bDist[0], '标记块双包逐字节一致（server.js ⇄ server.dist.js 改一边忘另一边）')
    assert(hostSrc.indexOf("handle('notes-get-batch'") >= 0 && indexSrc.indexOf("handle('notes-get-batch'") >= 0, '双包注册 notes-get-batch handler')
  })
  await t('双端首屏索引改批量拉取（O(n)→O(1)）：app/client/发布包接线 + 逐条 notes-get 循环清零', () => {
    assert(APP_SRC49.indexOf("rpc('notes-get-batch', { ids: stale.map(") >= 0, 'app.html ensureWikiIndex 走 notes-get-batch')
    assert(clientSrc.indexOf("host.call('notes-get-batch', { ids: stale.map(") >= 0, 'client ensureWikiIndex 走 notes-get-batch')
    assert(CLIENT_PKG49.indexOf("rpc('notes-get-batch', { ids: stale.map(") >= 0, '发布包 lib/client.js 同链路（build-dist rpc 形态）')
    assert(APP_SRC49.indexOf('for (var k = 0; k < 4 && k < stale.length; k++) worker()') < 0, 'app.html 旧 4 路并发逐条循环已清零')
    assert(clientSrc.indexOf('Promise.all([worker(), worker(), worker(), worker()])') < 0, 'client 旧 4 路并发逐条循环已清零')
  })

  // ===== 49.3 app 首屏请求数行为断言（Proxy 沙箱 eval 真实 wiki.js，模式同节 46.3/47.3）=====
  const WIKI_SRC49 = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'wiki.js'), 'utf8')
  function bootWiki(rpcImpl) {
    const calls = []
    const target = {
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      notes: [], folders: [], foldOpen: {}, sessList: [], sessPending: [], scopeOpen: false,
      selId: null, edNote: null, wikiBodies: {}, wikiIdxGen: 0,
      filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] },
      view: { type: 'all', id: '' },
      rpc: (m, a) => { calls.push({ method: m, args: a }); return rpcImpl(m, a) },
      $: () => null, toast: () => {}, esc: (s) => String(s), icon: () => '',
      extractWikiTargets: () => [], wikiLinksTo: () => false,
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + WIKI_SRC49 + '\n; __api = { ensureWikiIndex: ensureWikiIndex } }')(proxy)
    return { target: target, calls: calls, api: target.__api }
  }
  const tick49 = () => new Promise(r => setTimeout(r, 0))
  await t('N+1 行为：N 条待补正文 → 恰 1 次 notes-get-batch + 0 次 notes-get（首屏请求数 O(1)）', async () => {
    const env = bootWiki((m, a) => Promise.resolve(m === 'notes-get-batch'
      ? { notes: (a.ids || []).map(id => ({ id: id, body: '正文-' + id, updatedAt: 'u-' + id })), missing: [] }
      : {}))
    env.target.notes = [{ id: 'n1', updatedAt: 'u-n1' }, { id: 'n2', updatedAt: 'u-n2' }, { id: 'n3', updatedAt: 'u-n3' }, { id: 'n4', updatedAt: 'u-n4' }, { id: 'n5', updatedAt: 'u-n5' }]
    env.api.ensureWikiIndex()
    await tick49(); await tick49()
    assert.strictEqual(env.calls.filter(c => c.method === 'notes-get-batch').length, 1, '恰一次批量调用（实得 ' + JSON.stringify(env.calls) + '）')
    assert.strictEqual(env.calls.filter(c => c.method === 'notes-get').length, 0, '零逐条 notes-get（N+1 风暴已消）')
    assert.strictEqual(Object.keys(env.target.wikiBodies).length, 5, '5 条正文全部入索引缓存')
  })
  await t('N+1 行为：updatedAt 新鲜条目不重拉（增量 reconcile 只传 stale ids）', async () => {
    const env = bootWiki((m, a) => Promise.resolve(m === 'notes-get-batch'
      ? { notes: (a.ids || []).map(id => ({ id: id, body: '新正文-' + id, updatedAt: 'u2-' + id })), missing: [] }
      : {}))
    env.target.wikiBodies = { n1: { body: '旧', updatedAt: 'u-n1' } }   // n1 新鲜（updatedAt 一致）
    env.target.notes = [{ id: 'n1', updatedAt: 'u-n1' }, { id: 'n2', updatedAt: 'u-n2' }]
    env.api.ensureWikiIndex()
    await tick49(); await tick49()
    const batch = env.calls.filter(c => c.method === 'notes-get-batch')
    assert.strictEqual(batch.length, 1, '有缺口才批量调用')
    assert.deepStrictEqual(batch[0].args.ids, ['n2'], '仅传过期/缺失 id（实得 ' + JSON.stringify(batch[0].args.ids) + '）')
    assert.strictEqual(env.target.wikiBodies.n1.body, '旧', '新鲜条目不重拉（缓存不动）')
  })

  // ===== 49.4 新建草稿态行为断言（Proxy 沙箱 eval 真实 newnote.js + editor.js）=====
  const NEWNOTE_SRC49 = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'newnote.js'), 'utf8')
  const EDITOR_SRC49 = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'editor.js'), 'utf8')
  function bootDraft(rpcImpl) {
    const calls = []
    const els = {}
    const mkEl = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {}, contains() { return false } }, value: '', textContent: '', innerHTML: '', className: '', readOnly: false, contentEditable: 'true', addEventListener() {}, removeEventListener() {}, querySelectorAll() { return [] }, closest() { return null }, focus() {}, _bound: false })
    const target = {
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      notes: [{ id: 'n1', title: '既有笔记', tags: [], folder: '', kind: 'note', status: 'active', topic: '开发', updatedAt: 'u-n1' }],
      folders: [], foldOpen: {}, sessList: [], sessPending: [], scopeOpen: false,
      selId: null, edNote: null, edLoading: false, edBodyLoaded: false, edBodyErr: '',
      edMode: 'source', richDirty: false, composing: false, degraded: { ok: true, reasons: [] },
      wikiBodies: {}, histCount: null, saveTimer: null, savedRange: null, focusId: null,
      richSyncTimer: null, degTimer: null,
      view: { type: 'all', id: '' }, filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] },
      rpc: (m, a) => { calls.push({ method: m, args: JSON.parse(JSON.stringify(a || {})) }); return rpcImpl(m, a) },
      $: (id) => (els[id] = els[id] || mkEl()),
      toast: () => {}, analyzeMarkdown: () => ({ ok: true, reasons: [] }),
      renderTree() {}, renderCrumb() {}, renderMeta() {}, renderDispatches() {}, renderEdFoot() {}, renderBacklinks() {},
      renderEd() {}, loadNotes() { return Promise.resolve(true) }, probeHistCount() {}, saveFoldOpen() {},
      icon: () => '', esc: (s) => String(s), wikiResolve: (s) => s, syncFromRich() {},
      KIND: { note: '笔记', todo: '待办' },
      KIND_TEMPLATES: { note: '', todo: '- [ ] （待办事项）\n' },
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    /* 草稿态跨模块装配：newnote.js（doNewNote/doDraftCreate/flushDraftCreate）+ editor.js（selectNote/doSave）同域 eval，
       var draftNote/draftCreating 为沙箱函数级共享本地量（与 app.html 拼接后同一脚本作用域等价） */
    new Function('scope', 'with (scope) {\nvar draftNote = null, draftCreating = false;\n' + NEWNOTE_SRC49 + '\n' + EDITOR_SRC49 + '\n; __api = { doNewNote: doNewNote, doSave: doSave, selectNote: selectNote, doDraftCreate: doDraftCreate, flushDraftCreate: flushDraftCreate } }')(proxy)
    return { target: target, calls: calls, els: els, api: target.__api }
  }
  const draftRpcOk = (m) => Promise.resolve(m === 'notes-create' ? { id: 'n-new-1', title: '新笔记', topic: '未分类', kind: 'note', status: 'active' } : m === 'notes-get' ? { note: { id: 'n1', title: '既有笔记', body: '旧正文', tags: [], kind: 'note', status: 'active', updatedAt: 'u-n1' } } : {})
  await t('草稿态：点 + 不落库（零 notes-create），编辑器进草稿', async () => {
    const env = bootDraft(draftRpcOk)
    env.api.doNewNote()
    await tick49()
    assert.strictEqual(env.calls.filter(c => c.method === 'notes-create').length, 0, '点 + 零落库（实得 ' + JSON.stringify(env.calls) + '）')
    assert(env.target.edNote && env.target.edNote.title === '', '草稿进编辑器（空标题）')
    assert(env.target.selId === null, 'selId 保持 null（草稿无真实 id）')
    assert(env.target.edBodyLoaded === true, '草稿天然满足正文提交闸（无 get 链路）')
  })
  await t('草稿态：首次有效编辑才 notes-create → 落库后接管为正常编辑态（后续走 update）', async () => {
    const env = bootDraft(draftRpcOk)
    env.api.doNewNote()
    env.target.edNote.title = '我的新笔记'
    await env.api.doSave()
    await tick49(); await tick49()
    const creates = env.calls.filter(c => c.method === 'notes-create')
    assert.strictEqual(creates.length, 1, '首次编辑落库一次（实得 ' + creates.length + '）')
    assert.strictEqual(creates[0].args.title, '我的新笔记', 'create 携带标题')
    assert.strictEqual(env.target.selId, 'n-new-1', '落库后真实 id 接管选中')
    env.target.edNote.body = '继续写正文'
    await env.api.doSave()
    await tick49()
    const upds = env.calls.filter(c => c.method === 'notes-update')
    assert.strictEqual(upds.length, 1, '后续保存走 notes-update（实得 ' + upds.length + '）')
    assert.strictEqual(upds[0].args.id, 'n-new-1', 'update 指向落库 id')
    assert.strictEqual(env.calls.filter(c => c.method === 'notes-create').length, 1, '不再重复 create')
  })
  await t('草稿态：空草稿放弃零残留（doSave 不落库 + 切走不落库 + Untitled 占位视为空）', async () => {
    const env = bootDraft(draftRpcOk)
    env.api.doNewNote()
    await env.api.doSave()   // 全空直接保存 → 内容闸拦截
    env.api.doNewNote()      // 草稿期重复点击：仅聚焦，不重建（仍零调用）
    env.target.edNote.title = 'Untitled'   // 占位值视为空标题
    await env.api.doSave()
    env.api.selectNote('n1')   // 空草稿切走 → 丢弃
    await tick49(); await tick49()
    assert.strictEqual(env.calls.filter(c => c.method === 'notes-create').length, 0, '空草稿全程零落库（实得 ' + JSON.stringify(env.calls.filter(c => c.method === 'notes-create')) + '）')
    assert.strictEqual(env.target.selId, 'n1', '已切到目标笔记')
  })
  await t('草稿态：有内容草稿切走兜底落库（flushDraftCreate，不阻塞切换）', async () => {
    const env = bootDraft(draftRpcOk)
    env.api.doNewNote()
    env.target.edNote.body = '写到一半的正文'
    env.api.selectNote('n1')
    await tick49(); await tick49()
    const creates = env.calls.filter(c => c.method === 'notes-create')
    assert.strictEqual(creates.length, 1, '切走兜底落库一次（实得 ' + creates.length + '）')
    assert.strictEqual(creates[0].args.body, '写到一半的正文', '兜底携带草稿正文')
    assert.strictEqual(env.target.selId, 'n1', '切换不被阻塞（选中目标笔记）')
  })
  await t('草稿态：落库在途闸——并发 doSave 不双建（draftCreating 重排防抖）', async () => {
    let release
    const env = bootDraft((m) => m === 'notes-create' ? new Promise(r => { release = () => r({ id: 'n-new-9', title: 'T', kind: 'note', status: 'active' }) }) : Promise.resolve({}))
    env.api.doNewNote()
    env.target.edNote.title = '并发标题'
    env.api.doSave(); env.api.doSave(); env.api.doSave()   // 在途期间连续触发
    await tick49()
    assert.strictEqual(env.calls.filter(c => c.method === 'notes-create').length, 1, '在途期间恰一次 create（实得 ' + env.calls.filter(c => c.method === 'notes-create').length + '）')
    release()
    await tick49(); await tick49()
    assert.strictEqual(env.target.selId, 'n-new-9', '沉降后接管选中')
  })
  await t('草稿态：kind 模板预填非空——仅模板内容也可落库（编辑意图明确）', async () => {
    const env = bootDraft(draftRpcOk)
    env.target.filters.kinds = ['todo']   // 筛选中心类型组恰选 1 个 → 预填模板骨架
    env.api.doNewNote()
    env.target.edNote.title = '带模板的待办'
    await env.api.doSave()
    await tick49(); await tick49()
    const creates = env.calls.filter(c => c.method === 'notes-create')
    assert.strictEqual(creates.length, 1, '预填模板 + 标题 → 落库')
    assert.strictEqual(creates[0].args.kind, 'todo', 'kind 随筛选预填')
    assert(creates[0].args.body.indexOf('- [ ]') >= 0, '模板骨架随 create 落库')
  })

  // ===== 49.5 草稿态 UI 接线 + onboarding 文案（静态，三端/四端同步）=====
  await t('草稿态静态标记：app.html + 原型含草稿流函数族与状态（concat 已跑）', () => {
    for (const pair of [['app.html', APP_SRC49], ['原型', PROTO49]]) {
      for (const k of ['draftNote', 'draftCreating', 'draftPayloadOf', 'doDraftCreate', 'flushDraftCreate', 'createDraftNote']) {
        assert(pair[1].indexOf(k) >= 0, pair[0] + ' 缺草稿标记：' + k)
      }
      assert(pair[1].indexOf('未保存草稿') >= 0, pair[0] + ' 面包屑草稿态标称')
      assert(pair[1].indexOf('草稿（首次输入即落库）') >= 0, pair[0] + ' 底栏草稿提示')
      assert(pair[1].indexOf('已开草稿：输入标题或正文即自动落库') >= 0, pair[0] + ' 草稿引导 toast')
    }
  })
  await t('onboarding 轻量：副标题去 RPC 术语 + 空态提示对齐 + 控件（app.html + 原型同步）', () => {
    for (const pair of [['app.html', APP_SRC49], ['原型', PROTO49]]) {
      assert(pair[1].indexOf('你的笔记库 · 写下的约定与资料可注入 Agent 会话') >= 0, pair[0] + ' 副标题人话化')
      assert(pair[1].indexOf('全窗口笔记页 · 与 DSH 浮动面板同源数据') < 0, pair[0] + ' 旧 RPC 术语副标题清零')
      const hintCnt = (pair[1].match(/点侧栏顶部 \+ 新建笔记（先开草稿，输入内容才落库）/g) || []).length
      assert.strictEqual(hintCnt, 2, pair[0] + ' 空态提示双处（静态壳 + renderEd）对齐 + 图标指称（实得 ' + hintCnt + '）')
      assert(pair[1].indexOf('点左侧「新建」创建笔记') < 0, pair[0] + ' 旧「新建」按钮名提示清零')
    }
  })
  await t('onboarding 轻量：设置卡四概念速览（app + 原型 + client 三端）', () => {
    for (const pair of [['app.html', APP_SRC49], ['原型', PROTO49], ['client', clientSrc], ['发布包 client', CLIENT_PKG49]]) {
      assert(pair[1].indexOf('概念速览') >= 0, pair[0] + ' 设置卡概念速览块')
      assert(pair[1].indexOf('约定 = 须遵守的规则；资料 = Agent 按需取用的参考') >= 0, pair[0] + ' 约定/资料 一行说明')
      assert(pair[1].indexOf('目录注入：只向 Agent 提供全库笔记清单') >= 0, pair[0] + ' 目录注入 一行说明')
      assert(pair[1].indexOf('派发：把待办笔记派给指定会话执行，完成后自动回执闭环') >= 0, pair[0] + ' 派发 一行说明')
    }
  })
  await t('顶栏「归档」改名「速记」（app + 原型 + client 三端；modal 归档语义不变）', () => {
    const TIP = '速记合并：把同一会话的速记合并成一篇；点按弹出预览，勾选后才执行（可撤销）'
    for (const pair of [['app.html', APP_SRC49], ['原型', PROTO49]]) {
      assert(pair[1].indexOf('id="btnArchive" title="' + TIP + '"') >= 0, pair[0] + ' 按钮 tooltip 改名引导')
      assert(pair[1].indexOf('</svg>速记</button>') >= 0, pair[0] + ' 按钮可见 label=速记')
      assert(pair[1].indexOf('归档：把同一会话的速记合并成一篇') < 0, pair[0] + ' 旧 tooltip 清零')
    }
    assert(clientSrc.indexOf("onClick: openArchive, 'data-tooltip': '" + TIP + "'") >= 0 && clientSrc.indexOf(" }, '速记')") >= 0, 'client 标题栏按钮改名速记 + tooltip')
    assert(CLIENT_PKG49.indexOf("onClick: openArchive, 'data-tooltip': '" + TIP + "'") >= 0, '发布包 client 同步（build-dist 已跑）')
    assert(clientSrc.indexOf('「速记」：弹出预览，勾选速记组后才合并') >= 0, '使用说明气泡同步改名')
  })
  }
}
