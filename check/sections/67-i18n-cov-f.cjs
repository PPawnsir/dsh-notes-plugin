// 节 67. i18n 覆盖卡 F（notes-042-i18n-cov-f：其余面板 + popovers + 共享常量表条件映射 + host toast 面）
// 规格源：反馈条目 n-mut488gske5v 覆盖卡统一方法（免调研模板）——grep 表面 [一-鿿] → 抽串进 zh.js（key=表面.语义）
//   → 内联改 t()/tt()（变量 {name} 插值禁拼接）→ en.js 直译 → 断言（t( 命中≥抽串、字典双向覆盖、产物英文态抽查）。
// 表面：app panels/{folders,wiki,selection,search,query,filterbar,organize}.js + panels/editor-meta.js 三处下拉/tooltip 遗留（B 卡交接②）
//   + app popovers/filter-pop.js + app kernel/state.js（KIND/STATUS_LABEL/FILTER_STATUS/FILTER_SORTS 条件映射，B 卡交接②）+ app kernel/data.js
//   + client kernel/constants.js（FILTER_STATUS/KIND_LABELS/FILTER_SORTS 条件映射，B 卡交接①）+ client popovers/{ctx-menu,filter-pop,folder-menu,help,scope,selbar,sort-menu}.js
//   + client panels/selection/capture.js（app selection.js 对侧选区速记卡，挂 tt=useT() 独立订阅）
//   + client panels/panel/{wiki,sidebar,index,editor}.js（wiki 双链 toast / sidebar 筛选 chips / sortLabel / editor 整理 kind 名——常量表消费点随①②收口）
//   + client popovers/scope.js injectScopeLabel（B 卡交接③；kernel/state.js 转发别名纯管道不动）
// host toast 面：src/host/server.js 全量核查无用户可见串（唯一直字面量 'notes-purge 需要 id' 为 RPC error——
//   红线「host 端 RPC error message 本期保持中文」不动；host 无双语字典通道，UI 所见 host 串 = RPC error 原样 toast，本期豁免）。
// key 复用纪律（禁重复建别名）：tree.pinned/untitled/movedTo/movedOut、meta.sens/injectEver/kindNote~kindLog/scopeAll/scopeSession/scopeHint/
//   scopePending/wsOther/undo/pin/unpin、editor.backlinks*5/bodyLoading/bodyEmpty/organize*4、mem.sessLoadFailed、side.fchipStatusTip/fchipKindTip、
//   sel.selCount/merge、common.delete/cancel/listSep/restoredBatch、arch.deletedBatch、inj.batchDoneFail、chrome.help。
// 共享常量表中文字面量保留不抽（四端同构锚：check 30/34/39 锁定 FILTER_STATUS/FILTER_SORTS/KIND_LABELS 原文 + 原型不双语红线），
//   渲染经 kindLabel/filterStatusLabel/statusLabel/sortLabelOf/sortDescOf 条件映射走 t()（setLang/langStore 切换即生效；未知值回退 '' 永不裸 key）。
// 旧节适配（断言名不动）：20 右键菜单三动作 / 26 合并入口+操作条+批量删除 toast / 27 app 整理 toast / 31 双链未命中+app 反向链接标题 /
//   41 cycle 拦截+级联 confirm（app/原型分侧）/ 47 读路径文案标记→t() 形态 + 「会话清单加载失败」产物计数 3→2 / 1-7 范围缺省标签 / 53 client shortSid(tg)。
module.exports = {
  id: "67",
  title: "67. i18n 覆盖F（其余面板 + popovers + 共享常量表条件映射 + host toast 面核查）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('67. i18n 覆盖F（其余面板 + popovers + 共享常量表条件映射 + host toast 面核查）')
  const zhSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
  const enSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
  const rdA = (f) => fsNative.readFileSync(path.join(DIR, 'src', 'app', f), 'utf8')
  const rdC = (f) => fsNative.readFileSync(path.join(DIR, 'src', 'client', f), 'utf8')
  const foldersAppSrc = rdA('panels/folders.js'), wikiAppSrc = rdA('panels/wiki.js'), selAppSrc = rdA('panels/selection.js'),
    searchAppSrc = rdA('panels/search.js'), filterbarAppSrc = rdA('panels/filterbar.js'), orgAppSrc = rdA('panels/organize.js'),
    emetaAppSrc = rdA('panels/editor-meta.js'), fpopAppSrc = rdA('popovers/filter-pop.js'),
    stateAppSrc = rdA('kernel/state.js'), dataAppSrc = rdA('kernel/data.js')
  const constCliSrc = rdC('kernel/constants.js'), ctxCliSrc = rdC('popovers/ctx-menu.js'), fpopCliSrc = rdC('popovers/filter-pop.js'),
    fmenuCliSrc = rdC('popovers/folder-menu.js'), helpCliSrc = rdC('popovers/help.js'), scopeCliSrc = rdC('popovers/scope.js'),
    selbarCliSrc = rdC('popovers/selbar.js'), sortCliSrc = rdC('popovers/sort-menu.js'), capCliSrc = rdC('panels/selection/capture.js'),
    wikiCliSrc = rdC('panels/panel/wiki.js'), sideCliSrc = rdC('panels/panel/sidebar.js'), indexCliSrc = rdC('panels/panel/index.js'),
    edCliSrc = rdC('panels/panel/editor.js')
  const stateCliSrc = rdC('kernel/state.js')
  const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  const srvSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'server.js'), 'utf8')
  // 覆盖卡 F 抽串清单（100 条 = filter.* 10 + sort.* 6 + meta.status* 3 + fld.* 26（含 E 卡交接调用方传参）+ wiki.* 4
  //   + cap.* 21 + search.offline 1 + sel.deleting 1 + ctx.* 7 + help.* 20 + side.loadFailed 1；key=表面.语义）
  const KEYS = [
    'filter.statusGroup', 'filter.ruleOr', 'filter.kindGroup', 'filter.ruleOrAnd', 'filter.hitCount',
    'filter.clear', 'filter.done', 'filter.removeAria', 'filter.clearedToast', 'filter.stInjected',
    'sort.time', 'sort.use', 'sort.rel', 'sort.timeDesc', 'sort.useDesc', 'sort.relDesc',
    'meta.statusActive', 'meta.statusResolved', 'meta.statusSuperseded',
    'fld.titleNew', 'fld.titleNewSub', 'fld.okNew', 'fld.titleRename', 'fld.okRename',
    'fld.created', 'fld.createFailed', 'fld.renamed', 'fld.renameFailed', 'fld.delConfirmCascade',
    'fld.delConfirmEmpty', 'fld.deleted', 'fld.deletedDetail', 'fld.deleteFailed', 'fld.sortFailed',
    'fld.errSelf', 'fld.errCycle', 'fld.movedInto', 'fld.movedRoot', 'fld.moveFailed',
    'fld.menuView', 'fld.menuUp', 'fld.menuDown', 'fld.menuRoot', 'fld.menuDeleteFolder',
    'fld.loadFailed',
    'wiki.idxFailedPartial', 'wiki.idxFailed', 'wiki.idxFailedClient', 'wiki.targetNotFound',
    'cap.title', 'cap.autoQuote', 'cap.autoQuoteClient', 'cap.placeholder', 'cap.placeholderClient',
    'cap.enterHint', 'cap.copy', 'cap.save', 'cap.copied', 'cap.copyFailed',
    'cap.noSelection', 'cap.merged', 'cap.mergedClient', 'cap.savedQuote', 'cap.savedClient',
    'cap.savedPlain', 'cap.savedCtx', 'cap.savedTags', 'cap.savedKind', 'cap.sensSuffix',
    'cap.failed',
    'search.offline',
    'sel.deleting',
    'ctx.reopen', 'ctx.markResolved', 'ctx.moveTo', 'ctx.moveOut', 'ctx.newFolderPlaceholder',
    'ctx.newFolder', 'ctx.merge',
    'help.newPre', 'help.newPost', 'help.capture', 'help.mergeWin', 'help.topic',
    'help.drag', 'help.keysLead', 'help.keysSearch', 'help.keysSearchEnd', 'help.keysNew',
    'help.keysMoveOr', 'help.keysMoveEnd', 'help.keysOpen', 'help.keysEsc', 'help.cheatPre',
    'help.cheatPost', 'help.archive', 'help.organize', 'help.image', 'help.delete',
    'side.loadFailed',
  ]
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')

  // ===== ① 字典双向覆盖：100 条 key 双端齐备且非空；两字典全域 key 集合一致；占位符双端同形 =====
  await t('覆盖F 字典双向覆盖：100 条 filter/sort/meta.status/fld/wiki/cap/search/sel/ctx/help/side key 双端齐备且非空 + 全域 key 集合一致 + 占位符同形', () => {
    assert.strictEqual(KEYS.length, 100, '抽串清单条数（实得 ' + KEYS.length + '）')
    for (const k of KEYS) {
      assert(typeof zh[k] === 'string' && zh[k], 'zh 缺 key/空值：' + k)
      assert(typeof en[k] === 'string' && en[k], 'en 缺 key/空值：' + k)
      const pz = (zh[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (en[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
    assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'en/zh 全域 key 集合一致')
    // key 复用纪律（与机制卡/A/B/C/D/E 卡既有 key 对齐，禁重复建别名）
    for (const dup of ['filter.pinned', 'filter.stPinned', 'filter.stSensitive', 'filter.stInjectEver', 'filter.sessLoadFailed',
      'fld.delete', 'fld.cancel', 'fld.untitled', 'fld.sessLoadFailed', 'cap.cancel', 'cap.delete', 'cap.untitled', 'cap.roleConvention', 'cap.roleReference',
      'ctx.delete', 'ctx.pin', 'ctx.unpin', 'ctx.movedTo', 'ctx.movedOut', 'help.title', 'meta.statusPinned',
      'wiki.untitled', 'wiki.backlinks', 'sort.timeLabel', 'side.sessLoadFailed', 'sel.mergeAll']) {
      assert(!(dup in zh) && !(dup in en), '复用 tree.*/meta.*/editor.*/common.*/sel.*/arch.*/inj.*/mem.*/chrome.* 既有 key，禁重复建别名：' + dup)
    }
  })

  // ===== ② t()/tt() 改写命中 + 条件映射 helper 双端接线 + 常量表字面量锚保留 =====
  await t('t()/tt() 改写命中：24 表面文件域内 t(/tt( 合计 ≥100（≥抽串数）+ 逐文件关键锚点 + helper 接线 + 常量表锚保留', () => {
    const cnt = (s) => (s.match(/[^\w]t{1,2}\('(?:fld|wiki|cap|search|sel|ctx|help|filter|sort|side|meta|tree|common|editor|arch|inj|mem|chrome)\./g) || []).length
    const per = [
      ['folders.js(app)', foldersAppSrc, 27], ['wiki.js(app)', wikiAppSrc, 12], ['selection.js(app)', selAppSrc, 12],
      ['search.js(app)', searchAppSrc, 1], ['filterbar.js(app)', filterbarAppSrc, 11], ['organize.js(app)', orgAppSrc, 10],
      ['editor-meta.js(app)', emetaAppSrc, 100], ['filter-pop.js(app)', fpopAppSrc, 1], ['state.js(app)', stateAppSrc, 9],
      ['data.js(app)', dataAppSrc, 1],
      ['constants.js(client)', constCliSrc, 7], ['ctx-menu.js(client)', ctxCliSrc, 13], ['filter-pop.js(client)', fpopCliSrc, 7],
      ['folder-menu.js(client)', fmenuCliSrc, 17], ['help.js(client)', helpCliSrc, 21], ['scope.js(client)', scopeCliSrc, 7],
      ['selbar.js(client)', selbarCliSrc, 10], ['capture.js(client)', capCliSrc, 27], ['wiki.js(client)', wikiCliSrc, 3],
      ['sidebar.js(client)', sideCliSrc, 8], ['editor.js(client)', edCliSrc, 155],
    ]
    let total = 0
    for (const [label, s, min] of per) { const c = cnt(s); total += c; assert(c >= min, label + ' 域内 t(/tt( 命中 ≥' + min + '（实得 ' + c + '）') }
    assert(total >= 100, '表面文件域内 t(/tt( 命中合计 ≥100 抽串数（实得 ' + total + '）')
    // app 端锚点
    assert(foldersAppSrc.indexOf("title: parentId ? t('fld.titleNewSub') : t('fld.titleNew')") >= 0 && foldersAppSrc.indexOf("okText: t('fld.okNew')") >= 0, 'app folders 弹窗传参 t()（E 卡交接项：调用方 title/okText）')
    assert(foldersAppSrc.indexOf("t('fld.delConfirmCascade', { name: f.name, childN: childN, noteN: noteN })") >= 0 && foldersAppSrc.indexOf("toast(t('fld.errSelf'))") >= 0 && foldersAppSrc.indexOf("t('fld.menuView')") >= 0, 'app folders 级联 confirm/cycle 拦截/右键菜单走 t()')
    assert(wikiAppSrc.indexOf("t('wiki.idxFailedPartial', { n: failed })") >= 0 && wikiAppSrc.indexOf("t('wiki.targetNotFound', { target: target })") >= 0, 'app wiki 索引失败/未命中 toast 走 t()')
    assert(wikiAppSrc.indexOf("t('editor.backlinks') + (warm ? t('editor.backlinksCount', { n: bl.length }) : t('editor.backlinksWarming'))") >= 0, 'app wiki 反向链接标题复用 B 卡 editor.backlinks*（禁重复建别名）')
    assert(wikiAppSrc.indexOf("t('fld.loadFailed', { msg:") >= 0 && wikiAppSrc.indexOf("t('mem.sessLoadFailed', { msg:") >= 0, 'app wiki loadFolders/pullSessions 走 t()（复用 mem.sessLoadFailed）')
    assert(selAppSrc.indexOf("t('cap.title')") >= 0 && selAppSrc.indexOf("t('cap.savedQuote')") >= 0 && selAppSrc.indexOf("t('cap.sensSuffix')") >= 0, 'app selection 速记卡走 t()')
    assert(searchAppSrc.indexOf("t('search.offline', { msg:") >= 0, 'app search 在线检索降级 toast 走 t()')
    assert(filterbarAppSrc.indexOf("t('side.fchipStatusTip', { label: sl })") >= 0 && filterbarAppSrc.indexOf("t('filter.hitCount', { n: notes.filter(matches).length })") >= 0, 'app filterbar chips/popover 走 t()（复用 side.fchip*）')
    assert(filterbarAppSrc.indexOf('sortLabelOf(s.id)') >= 0 && filterbarAppSrc.indexOf('sortDescOf(s.id)') >= 0 && filterbarAppSrc.indexOf('filterStatusLabel(s.id)') >= 0 && filterbarAppSrc.indexOf('kindLabel(k)') >= 0, 'app filterbar 渲染经条件映射 helper（常量表字面量不直渲）')
    assert(orgAppSrc.indexOf("toast(t('editor.organized', { kind: kindLabel(edNote.kind) || t('meta.kindNote') }), { label: t('meta.undo'), fn: undoAiOrganize })") >= 0, 'app organize 整理 toast 走 t()（复用 B 卡 editor.organized/meta.undo）')
    assert(orgAppSrc.indexOf("t('editor.bodyLoading')") >= 0 && orgAppSrc.indexOf("t('editor.noOrganizeUndo')") >= 0 && orgAppSrc.indexOf("t('editor.organizeUndone')") >= 0, 'app organize 守卫/撤销 toast 复用 editor.* 字典')
    assert(emetaAppSrc.indexOf("Object.keys(KIND).map(function (k) { return '<option value=\"' + k + '\"'") >= 0 && emetaAppSrc.indexOf("'>' + kindLabel(k) + '</option>'") >= 0, 'app editor-meta kind 下拉经 kindLabel()（B 卡交接②）')
    assert(emetaAppSrc.indexOf("'>' + statusLabel(s) + '</option>'") >= 0, 'app editor-meta status 下拉经 statusLabel()（meta.status* 本卡建）')
    assert(emetaAppSrc.indexOf("t('meta.organizeTip', { kind: kindLabel(edNote.kind) || t('meta.kindNote') })") >= 0, 'app editor-meta 整理 tooltip kind 名走 t()')
    assert(fpopAppSrc.indexOf("t('filter.clearedToast')") >= 0, 'app filter-pop 清空筛选 toast 走 t()')
    assert(dataAppSrc.indexOf("t('side.loadFailed', { msg:") >= 0, 'app data.js 列表加载失败 toast 走 t()')
    // client 端锚点
    assert(ctxCliSrc.indexOf("ctxMenu.note.status === 'resolved' ? t('ctx.reopen') : t('ctx.markResolved')") >= 0 && ctxCliSrc.indexOf("t('ctx.merge')") >= 0 && ctxCliSrc.indexOf("t('ctx.moveTo')") >= 0, 'client ctx-menu 三动作/合并/移动走 t()')
    assert(ctxCliSrc.indexOf("t('tree.movedTo', { name: fname })") >= 0 && ctxCliSrc.indexOf("t('tree.movedOut')") >= 0, 'client ctx-menu 移动 toast 复用 tree.movedTo/movedOut')
    assert(fpopCliSrc.indexOf('filterStatusLabel(f.id)') >= 0 && fpopCliSrc.indexOf('kindLabel(k)') >= 0 && fpopCliSrc.indexOf("t('filter.hitCount', { n: filteredCount })") >= 0, 'client filter-pop 经条件映射 + 命中计数走 t()')
    assert(fmenuCliSrc.indexOf("t('fld.delConfirmCascade', { name: f.name, childN: childN, noteN: noteN })") >= 0 && fmenuCliSrc.indexOf("showToast(t('fld.errSelf'))") >= 0 && fmenuCliSrc.indexOf("t('fld.menuDeleteFolder')") >= 0, 'client folder-menu confirm/cycle/菜单走 t()（与 app folders.js 同 key 域）')
    assert(helpCliSrc.indexOf("t('chrome.help')") >= 0 && helpCliSrc.indexOf("t('help.newPre')") >= 0 && helpCliSrc.indexOf("t('help.keysEsc')") >= 0 && helpCliSrc.indexOf("t('help.delete')") >= 0, 'client help 气泡走 t()（标题复用 chrome.help）')
    assert(scopeCliSrc.indexOf("return t('meta.scopeAll')") >= 0 && scopeCliSrc.indexOf("t('meta.scopePending', { short: s.short })") >= 0 && scopeCliSrc.indexOf("names.join(t('common.listSep'))") >= 0, 'client injectScopeLabel/范围浮层走 t()（B 卡交接③；复用 meta.scope*/common.listSep）')
    assert(scopeCliSrc.indexOf('const st = shortSid(tg)') >= 0, 'client injectScopeLabel 形参 tg 消遮蔽（app 侧 B 卡先例；53 节锚同步）')
    assert(selbarCliSrc.indexOf("t('sel.selCount', { n: Object.keys(selIds).length })") >= 0 && selbarCliSrc.indexOf("selDelPending ? t('sel.deleting') : t('common.delete')") >= 0, 'client selbar 计数/删除按钮走 t()')
    assert(selbarCliSrc.indexOf("showToast(t('arch.deletedBatch', { ok: ok })") >= 0 && selbarCliSrc.indexOf("t('common.restoredBatch', { ok: ok })") >= 0, 'client selbar 批量删/撤销 toast 复用 arch/common 字典')
    assert(sortCliSrc.indexOf('sortLabelOf(s.id)') >= 0 && sortCliSrc.indexOf('sortDescOf(s.id)') >= 0, 'client sort-menu 经条件映射 helper')
    assert((capCliSrc.match(/const tt = useT\(\)/g) || []).length === 1, 'client capture.js 挂 tt=useT()（唯一；shell.overlay 独立组件边界订阅自渲染）')
    assert(capCliSrc.indexOf("tt('cap.savedCtx', { role: tt(a.injectRole === 'reference' ? 'tree.roleReference' : 'tree.roleConvention') })") >= 0, 'client capture 注入 toast 复用 tree.role*（禁重复建别名）')
    assert(capCliSrc.indexOf("tt('cap.autoQuoteClient')") >= 0 && capCliSrc.indexOf("tt('cap.placeholderClient')") >= 0 && capCliSrc.indexOf("tt('cap.savedKind', { kind: kindLabel(a.kind) || a.kind })") >= 0, 'client capture 卡片文案/kind 名走 tt()')
    assert(wikiCliSrc.indexOf("t('wiki.idxFailedPartial', { n: failed })") >= 0 && wikiCliSrc.indexOf("t('wiki.idxFailedClient', { n: stale.length })") >= 0 && wikiCliSrc.indexOf("t('wiki.targetNotFound', { target: target })") >= 0, 'client wiki 双链 toast 走 t()（catch 无 msg 变体 wiki.idxFailedClient）')
    assert(sideCliSrc.indexOf("t('side.fchipStatusTip', { label: filterStatusLabel(f.id) })") >= 0 && sideCliSrc.indexOf("t('side.fchipKindTip', { label: kindLabel(k) })") >= 0, 'client sidebar 筛选 chips 经条件映射（常量表字面量不直渲）')
    assert(indexCliSrc.indexOf('const sortLabel = sortLabelOf(sortBy)') >= 0, 'client 装配层 sortLabel 走 t() 字典')
    assert(edCliSrc.indexOf("kindLabel(edKindRef.current) || tt('meta.kindNote')") >= 0 && edCliSrc.indexOf("kindLabel(edKind) || tt('meta.kindNote')") >= 0, 'client editor 整理 toast/tooltip kind 名经 kindLabel()（B 卡交接②收口）')
    // 条件映射 helper 双端接线（B/E 卡交接①②③核心）
    for (const fn of ['function kindLabel(k)', 'function filterStatusLabel(id)', 'function sortLabelOf(id)', 'function sortDescOf(id)']) {
      assert(stateAppSrc.indexOf(fn) >= 0, 'app kernel/state.js 缺 helper：' + fn)
      assert(constCliSrc.indexOf(fn) >= 0, 'client kernel/constants.js 缺 helper：' + fn)
    }
    assert(stateAppSrc.indexOf('function statusLabel(s)') >= 0, 'app kernel/state.js 缺 statusLabel（editor status 下拉）')
    assert(stateAppSrc.indexOf('function sortLabel() { return sortLabelOf(sortBy) }') >= 0, 'app sortLabel() 走 t()（原 FILTER_SORTS[i].label 直读退锚）')
    assert(stateCliSrc.indexOf('function injectScopeLabel(injectTo) { return panelBridge.injectScopeLabel(injectTo) }') >= 0, 'client kernel/state.js injectScopeLabel 转发别名纯管道不动')
    // 常量表字面量锚保留（四端同构 + check 30/34/39 锁定 + 原型不双语红线：label 中文不抽，渲染走映射）
    assert(stateAppSrc.indexOf("var KIND = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志' };") >= 0
      && stateAppSrc.indexOf("var STATUS_LABEL = { active: '进行中', pinned: '置顶', resolved: '已解决', superseded: '已取代' };") >= 0, 'app KIND/STATUS_LABEL 字面量锚保留')
    assert(stateAppSrc.indexOf("{ id: 'pinned', label: '置顶', icon: 'i-pin'") >= 0 && stateAppSrc.indexOf("{ id: 'time', label: '时间', desc: '置顶优先 · 更新降序（默认）' },") >= 0, 'app FILTER_STATUS/FILTER_SORTS 字面量锚保留')
    assert(constCliSrc.indexOf("const KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志' }") >= 0
      && constCliSrc.indexOf("{ id: 'pinned', label: '置顶', icon: 'pin'") >= 0 && constCliSrc.indexOf("{ id: 'time', label: '时间', desc: '置顶优先 · 更新降序（默认）' },") >= 0, 'client KIND_LABELS/FILTER_STATUS/FILTER_SORTS 字面量锚保留')
  })

  // ===== ③ 行为级：eval 字典 + app i18n 块 + state.js 条件映射 helper——取值/插值/en 态逐条非裸 key =====
  await t('行为级：覆盖F key 双语取值 + {name} 插值 + 条件映射 helper zh/en 取值 + en 态 100 条逐条非裸 key', () => {
    const helpersSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'helpers.js'), 'utf8')
    const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
    const mk = (stored) => new Function('localStorage', 'render', zhSrc + '\n' + enSrc + '\n' + i18nBlock + '\nreturn { t: t }')({ getItem: () => stored, setItem: () => {} }, () => {})
    const a = mk(null)
    assert.strictEqual(a.t('fld.created', { name: '运维' }), '已建文件夹「运维」', 'zh 建文件夹 toast 插值')
    assert.strictEqual(a.t('fld.delConfirmCascade', { name: '前端', childN: 2, noteN: 5 }), '删除文件夹「前端」？连子删除：2 个子文件夹 + 5 条笔记移入回收站（可恢复）；文件夹结构不可恢复。', 'zh 级联 confirm 三参插值')
    assert.strictEqual(a.t('wiki.idxFailed', { n: 3, msg: 'boom' }), '双链索引失败 3 条：boom（下次刷新自动重试）', 'zh 索引失败双参插值')
    assert.strictEqual(a.t('cap.savedCtx', { role: '资料' }), '已记录并注入为上下文（资料）', 'zh 速记注入 toast 插值')
    assert.strictEqual(a.t('filter.hitCount', { n: 7 }), '命中 7 条', 'zh 命中计数插值')
    assert.strictEqual(a.t('meta.statusActive'), '进行中', 'zh 状态标签')
    assert.strictEqual(a.t('side.loadFailed', { msg: '断网' }), '列表加载失败：断网', 'zh 列表失败插值')
    const b = mk('en')
    assert.strictEqual(b.t('fld.created', { name: 'Ops' }), 'Folder "Ops" created', 'en 建文件夹 toast 插值')
    assert.strictEqual(b.t('fld.delConfirmEmpty', { name: 'tmp' }), 'Delete the empty folder "tmp"?', 'en 空文件夹 confirm 插值')
    assert.strictEqual(b.t('wiki.targetNotFound', { target: 'n-x' }), 'Link target not found: n-x', 'en 未命中 toast 插值')
    assert.strictEqual(b.t('cap.sensSuffix'), '; marked sensitive (auto-masked on injection)', 'en 敏感后缀')
    assert.strictEqual(b.t('filter.ruleOr'), 'Multi-select within a group = OR', 'en 分组规则')
    assert.strictEqual(b.t('sort.useDesc'), 'Most referenced first', 'en 排序档描述')
    assert.strictEqual(b.t('ctx.merge'), 'Merge into one', 'en 右键合并')
    assert.strictEqual(b.t('meta.statusSuperseded'), 'Superseded', 'en 状态标签')
    for (const k of KEYS) assert(b.t(k) !== k, 'en 态不得裸 key：' + k)
    // 条件映射 helper 行为级（eval 真 state.js 常量表 + helper 块，stub localStorage/loadFoldOpen + 真字典 t()）：
    //   zh/en 双态取值 + 未知值回退 ''（调用方 || 兜底）+ 非法 sort id 回退 time
    const mkState = (tFn) => new Function('localStorage', 't', 'loadFoldOpen', stateAppSrc + '\nreturn { kindLabel: kindLabel, statusLabel: statusLabel, filterStatusLabel: filterStatusLabel, sortLabelOf: sortLabelOf, sortDescOf: sortDescOf }')({ getItem: () => null, setItem: () => {} }, tFn, () => ({}))
    const sa = mkState(a.t), sb = mkState(b.t)
    assert.strictEqual(sa.kindLabel('todo'), '待办', 'zh kindLabel(todo)')
    assert.strictEqual(sb.kindLabel('todo'), 'Todo', 'en kindLabel(todo)')
    assert.strictEqual(sb.kindLabel('bogus'), '', 'kindLabel 未知 kind 回退 \'\'（调用方 || 兜底，永不裸 key）')
    assert.strictEqual(sa.statusLabel('active'), '进行中', 'zh statusLabel(active)')
    assert.strictEqual(sb.statusLabel('resolved'), 'Resolved', 'en statusLabel(resolved)')
    assert.strictEqual(sb.statusLabel('pinned'), 'Pinned', 'en statusLabel(pinned) 复用 tree.pinned')
    assert.strictEqual(sa.filterStatusLabel('injected'), '已注入', 'zh filterStatusLabel(injected)')
    assert.strictEqual(sb.filterStatusLabel('injectEver'), 'Injected before', 'en filterStatusLabel(injectEver) 复用 meta.injectEver')
    assert.strictEqual(sb.filterStatusLabel('sensitive'), 'Sensitive', 'en filterStatusLabel(sensitive) 复用 meta.sens')
    assert.strictEqual(sa.sortLabelOf('use'), '引用', 'zh sortLabelOf(use)')
    assert.strictEqual(sb.sortDescOf('rel'), 'Search score (active while searching)', 'en sortDescOf(rel)')
    assert.strictEqual(sb.sortLabelOf('bogus'), 'Time', 'sortLabelOf 非法 id 回退 time（loadFilters 同口径防御）')
  })

  // ===== ④ 产物英文态抽查 + 原型不双语红线 + host toast 面红线 =====
  await t('产物英文态抽查：app.html/lib-client 含 en 关键串 + t()/helper 接线入产物 + 原型零 F 域引用 + host server.js 无用户可见串红线', () => {
    for (const [s, tag] of [[appSrc, 'app.html'], [clientPkgSrc, '发布包 lib/client.js']]) {
      assert(s.indexOf("'fld.errSelf': 'A folder cannot be nested under itself'") >= 0, tag + ' en 关键串 fld.errSelf')
      assert(s.indexOf("'fld.delConfirmCascade': 'Delete the folder \"{name}\"? Cascade:") >= 0, tag + ' en 关键串 fld.delConfirmCascade 插值同形')
      assert(s.indexOf("'wiki.targetNotFound': 'Link target not found: {target}'") >= 0, tag + ' en 关键串 wiki.targetNotFound')
      assert(s.indexOf("'cap.copied': 'Selection copied'") >= 0, tag + ' en 关键串 cap.copied')
      assert(s.indexOf("'filter.clearedToast': 'All filter conditions cleared'") >= 0, tag + ' en 关键串 filter.clearedToast')
      assert(s.indexOf("'sort.rel': 'Relevance'") >= 0, tag + ' en 关键串 sort.rel')
      assert(s.indexOf("'meta.statusActive': 'Active'") >= 0, tag + ' en 关键串 meta.statusActive')
      assert(s.indexOf("'ctx.merge': 'Merge into one'") >= 0, tag + ' en 关键串 ctx.merge')
      assert(s.indexOf("'side.loadFailed': 'Failed to load the list: {msg}'") >= 0, tag + ' en 关键串 side.loadFailed')
    }
    assert(appSrc.indexOf("toast(t('fld.errSelf'))") >= 0 && appSrc.indexOf("t('filter.hitCount'") >= 0 && appSrc.indexOf("t('cap.savedQuote')") >= 0 && appSrc.indexOf("function kindLabel(k)") >= 0, 'app.html 产物含 fld/filter/cap t() + helper 接线（需先跑 concat-app/build-dist）')
    assert(clientSrc.indexOf("t('ctx.merge')") >= 0 && clientSrc.indexOf('sortLabelOf(s.id)') >= 0 && clientSrc.indexOf("tt('cap.autoQuoteClient')") >= 0, 'client 开发版含 ctx/sort/cap 接线')
    assert(clientPkgSrc.indexOf("t('ctx.merge')") >= 0 && clientPkgSrc.indexOf('sortLabelOf(s.id)') >= 0 && clientPkgSrc.indexOf("tt('cap.autoQuoteClient')") >= 0, '发布包 lib/client.js 含 ctx/sort/cap 接线（需先跑 build-dist）')
    // 原型不双语红线：零 F 域 t() 字典引用（原型常量表中文 label 照旧直渲，不动）
    for (const p of ['fld.', 'cap.', 'ctx.', 'help.', 'filter.', 'sort.', 'wiki.', 'search.']) {
      assert(protoSrc.indexOf("t('" + p) < 0 && protoSrc.indexOf("tt('" + p) < 0, '原型不双语红线：零 ' + p + ' 域 t() 引用')
    }
    // host toast 面红线：server.js 无双语字典消费（host 不双语）+ 唯一直字面量 RPC error 保持中文（本期豁免，工具/调用方面向 Agent 与 toast 原样透传）
    for (const p of ['fld.', 'cap.', 'ctx.', 'help.', 'filter.', 'sort.', 'wiki.', 'search.', 'meta.', 'tree.']) {
      assert(srvSrc.indexOf("t('" + p) < 0, 'host server.js 零 ' + p + ' 域字典消费（host 不双语）')
    }
    assert(srvSrc.indexOf("'notes-purge 需要 id'") >= 0, 'host RPC error 文案本期保持中文（红线不动）')
  })
  }
}
