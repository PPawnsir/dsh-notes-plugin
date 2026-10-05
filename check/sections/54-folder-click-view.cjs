// 节 54. 文件夹行点击语义收敛（notes-041b-tree-semantics：行点击=纯展开/折叠；0.4.3⑦ 文件视图拆除）
// 反馈 n-mutm8giarsn8 二次迭代（2026-10-04 深夜用户实测裁决）：notes-041 的「行主体单击=进视图 + caret 折叠 +
// vfilter 切换」三行为叠一行语义混乱，且「两步进视图」竞态导致 caret 展开失灵（点不开）。
// 语义：行点击（含名称/图标/caret）= 纯展开/折叠（经典树语义唯一职责，caret 与行主体同一 toggle 路径）；右键管理。
// 0.4.3 验收修复⑦（2026-10-05 用户裁决）：「文件视图」（文件夹视图）模式整体拆除——行尾 vfilter 漏斗进视图入口/求值分支移除，
// 树展开即文件夹浏览；主题行 vfilter（主题视图）不受影响。
module.exports = {
  id: "54",
  title: "54. 文件夹行点击=纯展开/折叠 + 文件视图拆除（vfilter 进视图入口移除，四端同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  const { clientPkgSrc } = S
  section('54. 文件夹行点击=纯展开/折叠（vfilter 唯一进视图入口 + caret 失灵修复，四端同步）')

  // ===== 54.1 app 行为级（src/app/panels/tree.js 树点击委托真实代码路径仿真，Proxy 打桩模式同节 53.3）=====
  const appTreeSrc54 = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'tree.js'), 'utf8')
  const m54 = appTreeSrc54.match(/\$\('tree'\)\.addEventListener\('click', function \(ev\) \{([\s\S]*?)\n\}\);/)
  await t('app 文件夹行点击行为级：行主体/caret=纯 toggle（三态稳定翻转·永不切视图）/ vfilter 唯一进视图入口', () => {
    assert(m54, '提取 app 树点击委托 handler 失败（结构变更需同步本断言）')
    // 隔离作用域工厂：folders（f1 无子夹 / f2 有子夹 f3）+ view/foldOpen 状态 + render/renderTree 间谍
    function mkWorld() {
      const calls = { render: 0, renderTree: 0 }
      const target = {
        view: { type: 'all', id: '' },
        foldOpen: {},
        folders: [{ id: 'f1', name: '无子夹', parent: '' }, { id: 'f2', name: '有子夹', parent: '' }, { id: 'f3', name: '子夹', parent: 'f2' }],
        notes: [], searchText: '',
        render: function () { calls.render++ },
        renderTree: function () { calls.renderTree++ },
        saveFoldOpen: function () {},
        folderKids: function (pid) { return target.folders.filter(function (x) { return (x.parent || '') === pid }) },
        folderSubtree: function (id) { const o = {}; o[id] = true; let grew = true; while (grew) { grew = false; target.folders.forEach(function (x) { if (o[x.parent || ''] && !o[x.id]) { o[x.id] = true; grew = true } }) } return o },
        matches: function () { return true },
        filtersActiveCount: function () { return 0 },
        selMode: false, selIds: {},
      }
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      new Function('scope', 'with (scope) {\n__fire = function (ev) {' + m54[1] + '\n}\n}')(proxy)
      return { target, calls, fire: target.__fire }
    }
    // 事件工厂：chain = closest(selector) → 命中元素映射（未列 selector 一律 null）
    function mkEv(chain) { return { target: { closest: function (sel) { return chain[sel] || null } } } }

    // ① 行主体单击 = 纯展开/折叠：折叠态首击展开、再击折叠、三击再展开——三态稳定翻转，永不切视图（renderTree 局部渲染）
    let w = mkWorld()
    w.target.foldOpen['f2'] = false
    w.fire(mkEv({ '[data-fold]': { dataset: { fold: 'f2' } } }))
    assert(w.target.foldOpen['f2'] === true && w.calls.renderTree === 1 && w.calls.render === 0, '折叠态首击=展开（renderTree 局部渲染）')
    assert(w.target.view.type === 'all', '行点击不切视图（实得 ' + JSON.stringify(w.target.view) + '）')
    w.fire(mkEv({ '[data-fold]': { dataset: { fold: 'f2' } } }))
    assert(w.target.foldOpen['f2'] === false && w.target.view.type === 'all', '再击=折叠（仍不切视图）')
    w.fire(mkEv({ '[data-fold]': { dataset: { fold: 'f2' } } }))
    assert(w.target.foldOpen['f2'] === true && w.target.view.type === 'all', '三击=再展开（三态稳定翻转）')

    // ② caret 单击与行主体同一 toggle 路径：连续点击 caret 展开/折叠/展开三态稳定翻转（caret 失灵修复锁）
    w = mkWorld()
    w.target.foldOpen['f1'] = false
    w.fire(mkEv({ '.caret': {}, '[data-fold]': { dataset: { fold: 'f1' } } }))
    assert(w.target.foldOpen['f1'] === true && w.target.view.type === 'all' && w.calls.renderTree === 1, 'caret 折叠态单击=展开（不切视图）')
    w.fire(mkEv({ '.caret': {}, '[data-fold]': { dataset: { fold: 'f1' } } }))
    assert(w.target.foldOpen['f1'] === false, 'caret 再击=折叠')
    w.fire(mkEv({ '.caret': {}, '[data-fold]': { dataset: { fold: 'f1' } } }))
    assert(w.target.foldOpen['f1'] === true && w.target.view.type === 'all', 'caret 三击=再展开（三态稳定翻转，无「点不开」死点击）')

    // ③ 行点击永不进视图：无子夹文件夹行主体单击同样只 toggle（0.4.3⑦：文件夹视图模式已整体拆除，无任何进视图入口）
    w = mkWorld()
    w.fire(mkEv({ '[data-fold]': { dataset: { fold: 'f1' } } }))
    assert(w.target.view.type === 'all', '无子夹行主体单击也不切视图（实得 ' + JSON.stringify(w.target.view) + '）')
    assert(w.target.foldOpen['f1'] === false && w.calls.render === 0, '行主体单击=纯 toggle（foldOpen 翻转 + renderTree，不走 render 全量）')

    // ④ 过滤中行点击同样只 toggle 不切视图（过滤自动展开纯渲染态不受影响——清除过滤即恢复手动折叠态）
    w = mkWorld()
    w.target.foldOpen['f2'] = false
    w.target.searchText = 'x'
    w.target.notes = [{ id: 'n1', folder: 'f3' }]
    w.fire(mkEv({ '[data-fold]': { dataset: { fold: 'f2' } } }))
    assert(w.target.foldOpen['f2'] === true && w.target.view.type === 'all', '过滤中行主体单击=展开（不切视图）')

    // ⑤ 0.4.3⑦ 文件视图拆除：vfilter 进视图分支已移除——（历史 DOM 残留的）vfilter+文件夹行点击落入纯 toggle 路径，
    //    永不切视图（view 取值收窄 all | topic；主题行 vfilter 主题视图在 data-topic 分支，不受影响）
    w = mkWorld()
    const vfEl = {}
    w.fire(mkEv({ '.vfilter': vfEl, '[data-fold]': { dataset: { fold: 'f1' } } }))
    assert(w.target.view.type === 'all' && w.target.foldOpen['f1'] === false, 'vfilter+文件夹行点击 = 纯 toggle 折叠（进视图分支已拆，永不进文件夹视图）')
    assert(w.calls.render === 0 && w.calls.renderTree === 1, 'vfilter 点击不再走 render() 全量（无视图切换）')
    w.fire(mkEv({ '.vfilter': vfEl, '[data-fold]': { dataset: { fold: 'f1' } } }))
    assert(w.target.foldOpen['f1'] === true && w.target.view.type === 'all', '再击 = 展开（仍不切视图）')
  })

  // ===== 54.2 四端静态锚点（app.html 产物 + 原型 handler 同构 + React 面板开发版/发布包 + hintbar 文案 + 文件视图拆除）=====
  await t('行点击=纯展开/折叠四端同步：app.html + 原型 + React 面板（开发版 + 发布包）+ 提示条文案 + 文件视图拆除', () => {
    const appSrcV = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcV = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // ① app.html 产物 + 原型：行点击统一 toggle 锚点（0.4.3⑦ 日志同权：零副作用纯翻转）+ 进视图分支/漏斗入口移除 + caret tooltip + hintbar 指引（app.html 需先跑 scripts/build-dist.cjs）
    for (const pair of [['app.html', appSrcV], ['原型 notes-ui-v2.html', protoSrcV]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("foldOpen[fid2] = foldOpen[fid2] === false ? true : false; saveFoldOpen(); renderTree(); return") >= 0, label + ' 行点击（含 caret）= 统一展开/折叠 toggle（事件委托分支；0.4.3⑦ 日志同权：纯折叠态翻转，ensureFoldLogs 已拆）')
      assert(s.indexOf("view = { type: 'folder', id: fid2 }") < 0, label + ' 行主体单击进视图分支已移除')
      assert(s.indexOf("if (vf && frow)") < 0, label + ' 0.4.3⑦：vfilter 进/出文件夹视图分支已拆除')
      assert(s.indexOf('文件夹视图（含子孙文件夹）') < 0 && s.indexOf('tree.folderViewTip') < 0, label + ' 文件夹行尾漏斗图标（含 tooltip 文案）已移除')
      assert(s.indexOf('点击展开/折叠 · 右键管理') >= 0 && s.indexOf('行尾漏斗进文件夹视图') < 0, label + ' hintbar 指引文案已更新（漏斗进视图指引移除）')
    }
    // caret tooltip：app 走 t() 字典（i18n 覆盖卡A），原型不双语保留中文 title
    assert(appSrcV.indexOf('title="\' + t(\'tree.toggleTip\') + \'"') >= 0, 'app.html caret tooltip 走 t() 字典（i18n 覆盖卡A）')
    assert(protoSrcV.indexOf('title="展开/折叠"') >= 0, '原型 caret tooltip（展开/折叠职责可发现性；原型不双语红线）')
    // ② React 面板开发版 + 发布包：行主体 onClick=纯 toggleFolder + caret stopPropagation 同语义 toggle + 进视图链路清零
    for (const pair of [['client 开发版', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      assert(pair[1].indexOf("onClick: () => { toggleFolder(f.id) }") >= 0, pair[0] + ' 文件夹行主体 onClick=纯展开/折叠（发布包需先跑 build-dist）')
      assert(pair[1].indexOf("setView({ type: 'folder'") < 0, pair[0] + ' 0.4.3⑦：文件夹视图 setView 链路清零（行主体/漏斗/菜单/面包屑全拆）')
      assert(pair[1].indexOf("'data-tooltip': tt('tree.toggleTip'), onClick: (ev) => { ev.stopPropagation(); toggleFolder(f.id) }") >= 0, pair[0] + ' caret 同一 toggle 语义（stopPropagation 防双触发 + tooltip；i18n 覆盖卡A 起走 t() 字典）')
    }
  })
  }
}
