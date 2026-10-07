// 节 96. 0.4.6-D 文案与状态一致性批（notes-046-copy-consistency；UX 巡检 R2 文案族，七项）
// 反馈源：n-mux79kgmbpza+n-mux8bv3x6lll 草稿标签残留+「更新」时间戳不刷新 / n-mux79kfts75o 双端新建文案互矛盾 /
//   n-mux7arxj4ocf 机器托管夹 tooltip 与行为矛盾 / n-mut4lscwg6tf 归档预览幽灵「右键合并」 /
//   n-mux7as4ppskn 速记概念零解释 / n-mux7as3gnrru 搜索空态无引导 / n-mux79ki7zcgj 使用说明抽屉 1424px 溢出裁切
// 改动七点（红线：文案层为主，行为改动仅 ①草稿收口 与 ⑦抽屉溢出 两项；显示名不动；tooltip 说后果口径延续 0.4.5-D）：
//   ① 草稿语义收口（行为）：createDraftNote 落库即回填 createdAt/updatedAt + renderEdFoot（底栏「草稿」标签随落库消失）；
//     doSave 成功即刷新 edNote.updatedAt + renderEdFoot（「更新」时间戳随每次自动保存刷新；edNote 为选中拷贝不随 loadNotes 换代）。
//   ② 双端新建文案对齐：面板 help.newPost 写明模态即建 + 括注全窗口草稿先行；app editor.emptySub 括注面板弹窗即建；
//     行为差异注释留档两端 newnote.js 头注（行为统一属大改另议）。
//   ③ 机器托管夹 tooltip 按真实行为写：「默认从树隐藏降噪；当前可见 = 机器档/显示隐藏已开」。
//   ④ 归档预览「多选后右键合并」幽灵文案 → 指向真实交互（底部操作条「合并」按钮）。
//   ⑤ 速记概念解释：topbar.archiveTip + arch.empty + help.archive 补「速记 = 划选快速记录暂存」一句。
//   ⑥ 搜索空态引导行（过滤激活零命中）：「试试更短的关键词，或 [新建一篇]」（双端 + 原型）。
//   ⑦ 使用说明气泡溢出修复（行为）：.dsh-notes-help-bubble absolute→fixed 锚视口右缘 + max-width/max-height/overflow 兜底。
module.exports = {
  id: "96",
  title: "96. 0.4.6-D 文案与状态一致性批（草稿标签收口+时间戳刷新 / 双端新建对齐 / 机器夹 tooltip / 幽灵右键 / 速记解释 / 搜索空态 / 说明抽屉溢出）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('96. 0.4.6-D 文案与状态一致性批（notes-046-copy-consistency）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')   // LF 归一：Windows CRLF 源文件的多行锚可比
  const appNewnote = read(path.join('src', 'app', 'modals', 'newnote.js'))
  const cliNewnote = read(path.join('src', 'client', 'modals', 'newnote.js'))
  const appEditor = read(path.join('src', 'app', 'panels', 'editor.js'))
  const appTree = read(path.join('src', 'app', 'panels', 'tree.js'))
  const cliTree = read(path.join('src', 'client', 'panels', 'panel', 'tree.js'))
  const stylesSrc = read(path.join('src', 'styles.css'))
  const appBody = read(path.join('src', 'app', 'shell', 'body.html'))
  const proto = read(path.join('design', 'notes-ui-v2.html'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const cliPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))
  const cssPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'styles.css'))
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const ZH96 = grab(read(path.join('src', 'i18n', 'zh.js')), 'I18N_ZH')
  const EN96 = grab(read(path.join('src', 'i18n', 'en.js')), 'I18N_EN')

  // ===== ① 草稿语义收口 + 时间戳刷新（行为级 eval，Proxy 沙箱同 49 节口径）=====
  const tick96 = () => new Promise(r => setTimeout(r, 0))
  function bootDraft96(rpcImpl) {
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
      richSyncTimer: null, degTimer: null, footCalls: 0,
      view: { type: 'all', id: '' }, filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] },
      rpc: (m, a) => { calls.push({ method: m, args: JSON.parse(JSON.stringify(a || {})) }); return rpcImpl(m, a) },
      $: (id) => (els[id] = els[id] || mkEl()),
      toast: () => {}, analyzeMarkdown: () => ({ ok: true, reasons: [] }),
      renderTree() {}, renderCrumb() {}, renderMeta() {}, renderDispatches() {}, renderBacklinks() {},
      renderEdFoot() { target.footCalls++ },   /* 0.4.6-D：底栏重渲计数（草稿标签消失/时间戳刷新的行为级探针） */
      renderEd() {}, loadNotes() { return Promise.resolve(true) }, probeHistCount() {}, saveFoldOpen() {},
      icon: () => '', esc: (s) => String(s), wikiResolve: (s) => s, syncFromRich() {},
      t: (k) => k,
      KIND: { note: '笔记', todo: '待办' },
      KIND_TEMPLATES: { note: '', todo: '- [ ] （待办事项）\n' },
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    /* 与 49 节同口径：newnote.js + editor.js 同域 eval（var draftNote/draftCreating 沙箱函数级共享） */
    new Function('scope', 'with (scope) {\nvar draftNote = null, draftCreating = false;\n' + appNewnote + '\n' + appEditor + '\n; __api = { doNewNote: doNewNote, doSave: doSave, selectNote: selectNote } }')(proxy)
    return { target: target, calls: calls, els: els, api: target.__api }
  }
  await t('0.4.6-D ① 行为级：草稿落库即回填时间戳 + 重渲底栏（「草稿」标签数据源消失）；后续保存刷新「更新」时间戳', async () => {
    const env = bootDraft96((m) => Promise.resolve(m === 'notes-create' ? { id: 'n-96-1', title: 'T', kind: 'note', status: 'active' } : m === 'notes-update' ? { ok: true } : {}))
    env.api.doNewNote()
    assert.strictEqual(env.target.edNote.createdAt, '', '草稿期 createdAt 为空（底栏「草稿（首次输入即落库）」提示的前提口径不变）')
    env.target.edNote.title = '九十六号笔记'
    await env.api.doSave()
    await tick96(); await tick96()
    assert.strictEqual(env.target.selId, 'n-96-1', '落库后真实 id 接管选中（49 节口径不破）')
    assert(env.target.edNote.createdAt !== '', '落库后 createdAt 回填 → renderEdFoot 不再走草稿提示分支（「草稿」标签消失的数据源）')
    assert(env.target.edNote.updatedAt !== '', '落库后 updatedAt 回填（底栏「更新」出现）')
    assert(env.target.footCalls >= 1, '落库后 renderEdFoot 重渲底栏（实得 ' + env.target.footCalls + ' 次）')
    /* 后续自动保存刷新「更新」时间戳：先把 updatedAt 拨回陈旧值（确定性构造，不靠墙钟跨分钟）再保存 */
    env.target.edNote.updatedAt = '2000-01-01T00:00:00.000Z'
    const footBefore = env.target.footCalls
    env.target.edNote.body = '追加正文触发二次保存'
    await env.api.doSave()
    await tick96(); await tick96()
    assert(env.calls.filter(c => c.method === 'notes-update').length === 1, '二次保存走 notes-update（实得 ' + env.calls.filter(c => c.method === 'notes-update').length + '）')
    assert(env.target.edNote.updatedAt !== '2000-01-01T00:00:00.000Z', '二次保存后 edNote.updatedAt 刷新（陈旧值被覆盖）')
    assert(env.target.footCalls > footBefore, '二次保存后 renderEdFoot 再调（底栏「更新」重渲）')
  })
  await t('0.4.6-D ① 静态锚：app 双函数回填/刷新接线 + 原型同步 + 产物同步', () => {
    assert(appNewnote.indexOf('var _now = new Date().toISOString(); if (!edNote.createdAt) edNote.createdAt = _now; edNote.updatedAt = _now;') >= 0, 'app createDraftNote 落库回填时间戳')
    assert(appNewnote.indexOf('renderCrumb(); renderMeta(); renderEdFoot();') >= 0, 'app createDraftNote 落库重渲底栏')
    assert(appEditor.indexOf('if (edNote && edNote.id === upd.id) { edNote.updatedAt = new Date().toISOString(); renderEdFoot(); }') >= 0, 'app doSave 保存成功刷新「更新」时间戳（迟到守卫）')
    assert(proto.indexOf('var _now = new Date().toISOString(); if (!edNote.createdAt) edNote.createdAt = _now; edNote.updatedAt = _now;') >= 0, '原型 createDraftNote 同步')
    assert(proto.indexOf('if (edNote && edNote.id === upd.id) { edNote.updatedAt = new Date().toISOString(); renderEdFoot(); }') >= 0, '原型 doSave 同步')
    assert(appHtml.indexOf('if (!edNote.createdAt) edNote.createdAt = _now;') >= 0 && appHtml.indexOf('edNote.updatedAt = new Date().toISOString(); renderEdFoot();') >= 0, 'app.html 产物同步（需先跑 build-dist）')
  })

  // ===== ② 双端新建文案对齐（文案 + 差异注释留档；行为统一另议）=====
  await t('0.4.6-D ② 双端新建文案对齐：面板=模态即建 / 全窗口=草稿先行互注差异 + 两端 newnote 头注留档', () => {
    assert(ZH96['help.newPost'].indexOf('弹出新建窗口') >= 0 && ZH96['help.newPost'].indexOf('草稿先行') >= 0, 'zh help.newPost 写明面板模态即建 + 括注全窗口草稿先行')
    assert(EN96['help.newPost'].indexOf('new-note dialog') >= 0 && EN96['help.newPost'].indexOf('draft first') >= 0, 'en help.newPost 同款互注')
    assert(ZH96['editor.emptySub'].indexOf('面板端「新建」为弹窗即建') >= 0, 'zh editor.emptySub 括注面板端差异')
    assert(EN96['editor.emptySub'].indexOf('side panel') >= 0, 'en editor.emptySub 同款互注')
    assert(appBody.indexOf('面板端「新建」为弹窗即建') >= 0, 'app 静态壳空态行同步（静态中文缺省与字典一致）')
    assert((proto.match(/面板端「新建」为弹窗即建/g) || []).length === 2, '原型空态行双处（静态壳 + renderEd）同步')
    assert(appNewnote.indexOf('0.4.6-D 双端差异留档') >= 0 && appNewnote.indexOf('统一属大改') >= 0, 'app newnote.js 头注差异留档')
    assert(cliNewnote.indexOf('0.4.6-D 双端差异留档') >= 0 && cliNewnote.indexOf('统一属大改') >= 0, 'client newnote.js 头注差异留档')
    assert(appHtml.indexOf('面板端「新建」为弹窗即建') >= 0 && cliPkg.indexOf('草稿先行') >= 0, '双端产物文案同步（需先跑 build-dist）')
  })

  // ===== ③ 机器托管夹 tooltip 按真实行为写 =====
  await t('0.4.6-D ③ 机器托管夹 tooltip：「默认隐藏降噪 + 当前可见 = 显式通道已开」（双字典；旧「说隐身却可见」矛盾文案清零）', () => {
    assert(ZH96['tree.sysFolderTip'].indexOf('默认从树隐藏降噪') >= 0 && ZH96['tree.sysFolderTip'].indexOf('当前可见') >= 0, 'zh sysFolderTip 缺省态 + 当前可见原因写明')
    assert(EN96['tree.sysFolderTip'].indexOf('hidden from the tree by default') >= 0 && EN96['tree.sysFolderTip'].indexOf('visible now') >= 0, 'en sysFolderTip 同款')
    assert(ZH96['tree.sysFolderTip'].indexOf('默认从树隐身') < 0, 'zh 旧矛盾措辞「默认从树隐身」清零（fld.sysToast 为标记后预告文案，不在本项）')
    assert(read(path.join('src', 'client', 'panels', 'panel', 'tree.js')).indexOf("tt('tree.sysFolderTip')") >= 0 && appTree.indexOf("t('tree.sysFolderTip')") >= 0, '双端 tooltip 引用键不变（节 85 接线锚不破）')
  })

  // ===== ④ 归档预览幽灵「右键合并」→ 底部操作条真实路径 =====
  await t('0.4.6-D ④ arch.manualHint 指向底部操作条「合并」（幽灵右键清零；双字典 + 原型 + 产物）', () => {
    assert(ZH96['arch.manualHint'].indexOf('底部操作条的「合并」') >= 0 && ZH96['arch.manualHint'].indexOf('右键合并') < 0, 'zh manualHint 指向真实底部按钮')
    assert(EN96['arch.manualHint'].indexOf('bottom action bar') >= 0 && EN96['arch.manualHint'].indexOf('right-click') < 0, 'en manualHint 同款')
    assert(proto.indexOf('底部操作条的「合并」') >= 0 && proto.indexOf('右键合并') < 0, '原型归档预览提示同步')
    assert(appHtml.indexOf('底部操作条的「合并」') >= 0 && cliPkg.indexOf('底部操作条的「合并」') >= 0, '双端产物提示同步（需先跑 build-dist）')
  })

  // ===== ⑤ 速记概念解释（tooltip + 归档空态 + 使用说明）=====
  await t('0.4.6-D ⑤ 速记概念解释：archiveTip / arch.empty / help.archive 三处补「速记 = 划选快速记录暂存」（双字典）', () => {
    assert(ZH96['topbar.archiveTip'].indexOf('速记 = 划选文字松手弹出的快速记录') >= 0, 'zh 顶栏按钮 tooltip 概念前置')
    assert(EN96['topbar.archiveTip'].indexOf('Quick notes = temporary captures') >= 0, 'en 顶栏按钮 tooltip 概念前置')
    assert(ZH96['arch.empty'].indexOf('速记 = 划选文字松手弹出的快速记录卡片产生的暂存笔记') >= 0, 'zh 归档空态补概念')
    assert(EN96['arch.empty'].indexOf('temporary captures produced by the select-and-release card') >= 0, 'en 归档空态补概念')
    assert(ZH96['help.archive'].indexOf('速记暂存') >= 0 && ZH96['help.archive'].indexOf('底部操作条') >= 0, 'zh 使用说明归档行概念 + 真实路径')
    assert(EN96['help.archive'].indexOf('temporary captures') >= 0 && EN96['help.archive'].indexOf('bottom action bar') >= 0, 'en 使用说明归档行同款')
    assert(appBody.indexOf('id="btnArchive" title="速记 = 划选文字松手弹出的快速记录（暂存）') >= 0, 'app 静态壳按钮 title 同步')
    assert(proto.indexOf('id="btnArchive" title="速记 = 划选文字松手弹出的快速记录（暂存）') >= 0, '原型按钮 title 同步')
  })

  // ===== ⑥ 搜索空态引导行（双端 + 原型）=====
  await t('0.4.6-D ⑥ 搜索空态引导行：「试试更短的关键词，或 [新建一篇]」（app + client + 原型三端接线 + 双字典新键）', () => {
    assert(ZH96['tree.noMatchGuide'] === '试试更短的关键词，或' && ZH96['tree.noMatchNew'] === '新建一篇', 'zh 新键文案')
    assert(EN96['tree.noMatchGuide'] === 'Try a shorter keyword, or' && EN96['tree.noMatchNew'] === 'create a new note', 'en 新键文案')
    assert(appTree.indexOf("if (!vis.length && filtering) h += '<div class=\"sec-h\" style=\"text-transform:none;letter-spacing:0\">' + t('tree.noMatchGuide')") >= 0, 'app 树空态引导行（仅过滤激活零命中时渲染——全库真空态不掺搜索措辞）')
    assert(appTree.indexOf("var en2 = $('emptyNew'); if (en2) en2.onclick = function () { doNewNote() };") >= 0, 'app「新建一篇」→ doNewNote 草稿链路')
    assert(cliTree.indexOf("key: 'no-match-guide'") >= 0 && cliTree.indexOf("tt('tree.noMatchNew')") >= 0, 'client 树空态引导行')
    assert(cliTree.indexOf("onClick: (ev) => { ev.stopPropagation(); openNewNote() }") >= 0, 'client「新建一篇」→ openNewNote 新建弹窗')
    assert(proto.indexOf('id="emptyNew"') >= 0 && proto.indexOf('试试更短的关键词，或') >= 0, '原型引导行同步')
    assert(appHtml.indexOf('id="emptyNew"') >= 0 && cliPkg.indexOf('no-match-guide') >= 0, '双端产物引导行同步（需先跑 build-dist）')
  })

  // ===== ⑦ 使用说明气泡溢出修复（行为 bug：absolute 随面板几何越出视口 → fixed 锚视口）=====
  await t('0.4.6-D ⑦ 使用说明气泡 1424px 溢出修复：fixed 锚视口右缘 + max-width/max-height/overflow 兜底（styles.css + 发布包）', () => {
    assert(stylesSrc.indexOf('.dsh-notes-help-bubble{position:fixed;top:50px;right:14px;width:290px;max-width:calc(100vw - 28px);max-height:calc(100vh - 70px);overflow-y:auto;') >= 0, 'help-bubble fixed + 视口 clamp 锚')
    assert(cssPkg.indexOf('.dsh-notes-help-bubble{position:fixed') >= 0 && cssPkg.indexOf('max-width:calc(100vw - 28px)') >= 0, '发布包 lib/styles.css 同步（需先跑 build-dist）')
  })

  // ===== i18n 全套：本卡触碰 9 键双字典齐备 + 占位符同形 + 产物字典同步 =====
  await t('0.4.6-D i18n：9 触碰键（改 7 + 新 2）双字典齐备非空 + 占位符同形 + 产物字典同步', () => {
    const KEYS96 = ['topbar.archiveTip', 'tree.sysFolderTip', 'arch.manualHint', 'arch.empty', 'help.newPost', 'help.archive', 'editor.emptySub', 'tree.noMatchGuide', 'tree.noMatchNew']
    assert.strictEqual(KEYS96.length, 9, '触碰键清单 9 条')
    for (const k of KEYS96) {
      assert(typeof ZH96[k] === 'string' && ZH96[k], 'zh 缺 ' + k)
      assert(typeof EN96[k] === 'string' && EN96[k], 'en 缺 ' + k)
      const pz = (ZH96[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (EN96[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
    for (const k of ["'tree.noMatchGuide'", "'tree.noMatchNew'"]) {
      assert(cliPkg.indexOf(k) >= 0, 'lib/client.js 字典缺 ' + k + '（需先跑 build-dist）')
      assert(appHtml.indexOf(k) >= 0, 'app.html 字典缺 ' + k + '（需先跑 build-dist）')
    }
  })
  }
}
