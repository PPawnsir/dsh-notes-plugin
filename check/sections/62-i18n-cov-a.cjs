// 节 62. i18n 覆盖卡 A（notes-042-i18n-cov-a：顶栏 + 侧栏树 + hintbar 双语化）
// 规格源：反馈条目 n-mut488gske5v 覆盖卡统一方法（免调研模板）——grep 表面 [\u4e00-\u9fff] → 抽串进 zh.js（key=表面.语义）
//   → 内联改 t()（变量 {name} 插值禁拼接）→ en.js 直译 → 断言（t( 命中≥抽串、字典双向覆盖、产物英文态抽查）。
// 表面：app shell/body.html（静态壳：中文缺省保留，renderChrome() 运行时按语言态重写——57/51/54 等静态锚点断言兼容）
//   + app panels/topbar.js（renderChrome + 刷新 toast）+ app panels/tree.js；
//   client panels/panel/{sidebar,tree,chrome}.js（tree/chrome 为 hook 挂 tt=useT() 订阅 langStore 自渲染；sidebar 非 hook 走 t() 直读）。
// 红线：原型 design/notes-ui-v2.html 不双语（零 t(' 引用）；host error 文案不动；回退永不裸 key（60 节机制断言）。
module.exports = {
  id: "62",
  title: "62. i18n 覆盖A（顶栏 + 侧栏树 + hintbar 双语化）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('62. i18n 覆盖A（顶栏 + 侧栏树 + hintbar 双语化）')
  const zhSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
  const enSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
  const topSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'topbar.js'), 'utf8')
  const treeAppSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'tree.js'), 'utf8')
  const bodySrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'shell', 'body.html'), 'utf8')
  const sideSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'panels', 'panel', 'sidebar.js'), 'utf8')
  const treeCliSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'panels', 'panel', 'tree.js'), 'utf8')
  const chromeSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'panels', 'panel', 'chrome.js'), 'utf8')
  const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  // 覆盖卡 A 抽串清单（62 条；key=表面.语义；0.4.3⑦：tree.folderViewTip/tree.viewFolder 随「文件视图」拆除移出清单；tree.logTip 随 logmark 徽章移除）
  const KEYS = [
    'topbar.subtitle', 'topbar.refreshTip', 'topbar.archiveTip', 'topbar.themeTip', 'topbar.homeTip',
    'topbar.filterTip', 'topbar.sortTip', 'topbar.filterAria', 'topbar.trashTip', 'topbar.selectTip',
    'side.brand', 'side.newTip', 'side.splitterTip', 'side.fchipStatusTip', 'side.fchipKindTip',
    'tree.topicTip', 'tree.untitled', 'tree.injectTip', 'tree.roleReference', 'tree.roleConvention', 'tree.injectScope',
    'tree.injectEverTip', 'tree.useCountTip', 'tree.wikiTip', 'tree.toggleTip', 'tree.countN',
    'tree.viewTopic', 'tree.viewAll', 'tree.crossFolderCount', 'tree.clearViewTip', 'tree.pinned',
    'tree.folders', 'tree.addFolderTip', 'tree.dropOutHint', 'tree.dropRootHint', 'tree.topicsHeader', 'tree.crossFolder',
    'tree.topicViewTip', 'tree.noMatch', 'tree.clearFilters', 'tree.clearFiltersShort', 'tree.clearAllFiltersTip', 'tree.moreRows',
    'tree.movedTo', 'tree.movedOut', 'tree.moveFailed', 'tree.subFolderPlaceholder', 'tree.folderPlaceholder',
    'tree.classifying', 'tree.emptyTitle', 'tree.emptySub', 'tree.emptyBtn',
    'sel.selCount', 'sel.merge',
    'hint.select', 'hint.drag', 'hint.folder', 'hint.keys',
    'chrome.dragMove', 'chrome.entryModeTip', 'chrome.help', 'chrome.resizeTip',
  ]
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')

  // ===== ① 字典双向覆盖：62 条抽串 zh/en 双双存在且值非空；两字典全域 key 集合一致 =====
  await t('覆盖A 字典双向覆盖：62 条 topbar/side/tree/sel/hint/chrome key 双端齐备且非空', () => {
    assert.strictEqual(KEYS.length, 62, '抽串清单条数（实得 ' + KEYS.length + '）')
    for (const k of KEYS) {
      assert(typeof zh[k] === 'string' && zh[k], 'zh 缺 key/空值：' + k)
      assert(typeof en[k] === 'string' && en[k], 'en 缺 key/空值：' + k)
    }
    assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'en/zh 全域 key 集合一致（守卫卡另有 ⊆ 代码引用断言）')
  })

  // ===== ② t() 改写命中：六表面文件 t(/tt( 命中数 ≥ 抽串数 + 关键锚点 =====
  await t('t() 改写命中：六表面文件 t(/tt( 合计 ≥62（≥抽串数）+ 逐文件关键锚点', () => {
    const cnt = (s) => (s.match(/[^\w]t{1,2}\('(?:topbar|side|tree|sel|hint|chrome|common)\./g) || []).length
    const per = [['topbar.js', topSrc, 20], ['tree.js(app)', treeAppSrc, 20], ['sidebar.js', sideSrc, 14], ['tree.js(client)', treeCliSrc, 20], ['chrome.js', chromeSrc, 8]]
    let total = 0
    for (const [label, s, min] of per) { const c = cnt(s); total += c; assert(c >= min, label + ' 域内 t(/tt( 命中 ≥' + min + '（实得 ' + c + '）') }
    assert(total >= 62, '六文件域内 t(/tt( 命中合计 ≥62 抽串数（实得 ' + total + '）')
    // 关键锚点：刷新 toast 走字典；renderChrome 接线全壳；renderTree 首行收敛调用
    assert(topSrc.indexOf("toast(t('common.refreshed'))") >= 0, 'topbar.js 刷新 toast 走 t() 字典')
    assert(topSrc.indexOf('function renderChrome()') >= 0 && topSrc.indexOf('renderChrome();') >= 0, 'renderChrome 定义 + 装载即调用一次（启动本地化）')
    assert(topSrc.indexOf("$('btnRefresh').title = t('topbar.refreshTip')") >= 0 && topSrc.indexOf("$('hintSelect').innerHTML = t('hint.select')") >= 0, 'renderChrome 顶栏/hintbar 接线锚点')
    assert(treeAppSrc.indexOf('renderChrome();') >= 0, 'renderTree 首行收敛调用 renderChrome（setLang→render 路径）')
    assert(treeAppSrc.indexOf("t('tree.movedTo', { name: fname(folderId) })") >= 0 && treeAppSrc.indexOf("t('sel.selCount', { n: n })") >= 0, 'tree.js(app) 移动 toast / selbar 计数走 t()')
    assert(treeAppSrc.indexOf('var topicViewTip = t(') >= 0, 'tree.js(app) 主题 tooltip 前置提升（forEach 形参 t 遮蔽全局 t()）')
    assert(sideSrc.indexOf("placeholder: t('topbar.searchPlaceholder')") >= 0 && sideSrc.indexOf('side.more') < 0, 'sidebar.js 搜索占位走 t()；side.more 全局提示行随 0.4.6-J 分组分页退役')
    assert(treeCliSrc.indexOf("tt('tree.moreRows', { n:") >= 0, 'tree.js(client) 组尾加载行走 tt()（0.4.6-J 分组分页）')
    assert((treeCliSrc.match(/const tt = useT\(\)/g) || []).length === 1 && (chromeSrc.match(/const tt = useT\(\)/g) || []).length === 1, 'client tree/chrome 双 hook 各挂 useT()（订阅 langStore 自渲染）')
    assert(chromeSrc.indexOf("'data-tooltip': tt('topbar.archiveTip')") >= 0 && treeCliSrc.indexOf("tt('tree.topicsHeader', { n:") >= 0, 'chrome/tree(client) 标题栏/主题区走 tt()')
    // 变量插值纪律：{name} 占位符双端同形（抽查 4 条含参 key）
    for (const k of ['tree.movedTo', 'tree.useCountTip', 'sel.selCount', 'tree.moreRows']) {
      const ph = (zh[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(ph && ph === ((en[k].match(/\{\w+\}/g) || []).sort().join(',')), k + ' 双端占位符同形（' + ph + '）')
    }
  })

  // ===== ③ 行为级：eval 字典 + app i18n 块——取值/插值/en 态逐条非裸 key/回退 =====
  await t('行为级：覆盖A key 双语取值 + {name} 插值 + en 态 62 条逐条非裸 key', () => {
    const helpersSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'helpers.js'), 'utf8')
    const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
    const mk = (stored) => new Function('localStorage', 'render', zhSrc + '\n' + enSrc + '\n' + i18nBlock + '\nreturn { t: t }')({ getItem: () => stored, setItem: () => {} }, () => {})
    const a = mk(null)
    assert.strictEqual(a.t('tree.viewAll'), '全部笔记', 'zh 缺省取值')
    assert.strictEqual(a.t('tree.movedTo', { name: '运维' }), '已移动到「运维」', 'zh {name} 插值')
    assert.strictEqual(a.t('topbar.subtitle').indexOf('注入 Agent 会话') >= 0, true, 'zh 顶栏副标')
    const b = mk('en')
    assert.strictEqual(b.t('tree.viewAll'), 'All notes', 'en 取值')
    assert.strictEqual(b.t('tree.movedTo', { name: 'Ops' }), 'Moved to "Ops"', 'en {name} 插值')
    assert.strictEqual(b.t('sel.selCount', { n: 3 }), '3 selected', 'en 计数插值')
    assert.strictEqual(b.t('tree.countN', { n: 5 }), '5', 'en 计数单位省「条」')
    assert(b.t('hint.keys').indexOf('Ctrl K search') === 0, 'en hintbar 键盘流指引')
    for (const k of KEYS) assert(b.t(k) !== k, 'en 态不得裸 key：' + k)
  })

  // ===== ④ 产物英文态抽查 + 壳静态缺省保留 + 原型不双语红线 =====
  await t('产物英文态抽查：app.html/lib-client 含 en 关键串 + body.html 中文缺省保留 + 原型零 t() 引用', () => {
    for (const [s, tag] of [[appSrc, 'app.html'], [clientPkgSrc, '发布包 lib/client.js']]) {
      assert(s.indexOf("'tree.viewAll': 'All notes'") >= 0, tag + ' en 关键串 tree.viewAll')
      assert(s.indexOf("'topbar.refresh': 'Refresh'") >= 0, tag + ' en 关键串 topbar.refresh')
      assert(s.indexOf("'hint.keys': 'Ctrl K search") >= 0, tag + ' en 关键串 hint.keys')
      assert(s.indexOf("'chrome.entryModeTip': 'Switch entry mode") >= 0, tag + ' en 关键串 chrome.entryModeTip')
    }
    assert(appSrc.indexOf("function renderChrome()") >= 0 && appSrc.indexOf("$('btnHome').title = t('topbar.homeTip')") >= 0, 'app.html 产物含 renderChrome 接线（需先跑 build-dist/concat-app）')
    assert(clientSrc.indexOf("const tt = useT()") >= 0 && clientPkgSrc.indexOf("const tt = useT()") >= 0, 'client 开发版/发布包含 useT 订阅（需先跑 build-dist）')
    // body.html 静态中文缺省保留（静态锚点断言兼容：57 顶栏/51 hintbar/26 速记按钮）
    for (const k of ['id="topSub"', 'id="btnHome"', 'id="brandName"', 'id="btnTrashT"', 'id="btnSelModeT"', 'id="btnSettingsT"', 'id="hintSelect"', 'id="hintDrag"', 'id="hintFolder"', 'id="hintKeys"'])
      assert(bodySrc.indexOf(k) >= 0, 'body.html 缺静态锚：' + k)
    assert(bodySrc.indexOf('划选文字松手') >= 0 && bodySrc.indexOf('回收站：查看已删除的笔记') >= 0, 'body.html 中文缺省保留（zh 缺省渲染态）')
    assert(protoSrc.indexOf("t('tree.") < 0 && protoSrc.indexOf("t('topbar.") < 0 && protoSrc.indexOf('renderChrome') < 0, '原型不双语红线：零 t() 字典引用')
  })
  }
}
