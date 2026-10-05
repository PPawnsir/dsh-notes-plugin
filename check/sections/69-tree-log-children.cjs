// 节 69. 日志同权 + 展开卡顿修复（0.4.3 验收修复⑦ notes-043-log-firstclass）
// 前身 = 树展开「含日志的文件夹」懒加载 overlay（notes-041c-tree-log-children，R-6 豁免面）。
// 2026-10-05 用户裁决推翻 R-6 UI 隐身：日志四可一不可（可见/可搜索/可编辑/可进目录显式；注入硬关）。
// 本节锁定：① overlay 特化路径（logOverlay/foldLogLoaded/ensureFoldLogs + 定向 includeLogs RPC + 合并逻辑）四端拆除——
//   展开日志夹与普通夹同一代码路径（零额外 RPC + 单次渲染 = 卡顿根因消除，修复前基线：旧路径多 1 次全库 RPC + 二次渲染，mock 环境 ≈64×）；
// ② 展开行为级 eval：日志夹 vs 普通夹同一 handler、RPC spy 恒零、计时 ≤2×（同路径恒成立，防回归引入新特化）；
// ③ 日志行普通渲染（无 logmark 隐身徽章，kind 色点照常）；④ 树日志 i18n 键 tree.logTip 随徽章移除。
module.exports = {
  id: "69",
  title: "69. 日志同权 + 展开卡顿修复（overlay 特化路径四端拆除 + 展开零 RPC 行为级 + logmark 徽章移除，0.4.3⑦）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  const { clientPkgSrc } = S
  section('69. 日志同权 + 展开卡顿修复（overlay 拆除 + 展开零 RPC + logmark 移除，0.4.3⑦）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appTree = read(path.join('src', 'app', 'panels', 'tree.js'))
  const appData = read(path.join('src', 'app', 'kernel', 'data.js'))
  const appQuery = read(path.join('src', 'app', 'panels', 'query.js'))
  const cliMenu = read(path.join('src', 'client', 'popovers', 'folder-menu.js'))
  const cliTree = read(path.join('src', 'client', 'panels', 'panel', 'tree.js'))
  const cliIndex = read(path.join('src', 'client', 'panels', 'panel', 'index.js'))
  const proto = read(path.join('design', 'notes-ui-v2.html'))

  // ===== ① 四端 overlay 特化路径拆除（标识符清零）+ loadNotes 恒全量口径 =====
  await t('日志同权：overlay 特化路径四端拆除（logOverlay/foldLogLoaded/ensureFoldLogs/wantLogs 清零）+ loadNotes 恒全量', () => {
    for (const pair of [['app tree.js', appTree], ['app data.js', appData], ['原型 notes-ui-v2.html', proto]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('logOverlay') < 0 && s.indexOf('foldLogLoaded') < 0 && s.indexOf('function ensureFoldLogs') < 0, label + ' overlay 三件套（logOverlay/foldLogLoaded/ensureFoldLogs）已拆除')
      assert(s.indexOf('wantLogs') < 0 && s.indexOf('maybeReloadForLogs') < 0, label + ' wantLogs/翻转检测机制已拆除')
    }
    assert(appData.indexOf("return rpc('notes-list', listArgs).then(") >= 0, 'app loadNotes 恒全量口径（不再按勾选/视图带 includeLogs；0.4.3⑩ 恰选单 kind 传 {kind} 与日志同权正交——无 kind 档时 host 默认含 log 不变）')
    assert(appQuery.indexOf("view.type !== 'folder'") < 0 && appQuery.indexOf("filters.kinds.indexOf('log') < 0") < 0, 'app 隐身渲染守卫已移除（日志同权，同一过滤管线）')
    for (const pair of [['client folder-menu.js', cliMenu], ['client tree.js', cliTree], ['client panel/index.js', cliIndex]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('foldLogs') < 0 && s.indexOf('foldLogLoaded') < 0 && s.indexOf('ensureFoldLogs') < 0, label + ' overlay 三件套已拆除')
    }
    assert(cliIndex.indexOf('wantLogsRef') < 0, 'client wantLogsRef/翻转 effect 已拆除')
    assert(cliIndex.indexOf("host.call('notes-list', kf.length === 1 ? { kind: kf[0] } : undefined)") >= 0, 'client loadNotes 恒全量口径（⑩ 恰选单 kind 传 {kind}，无 kind 档时无参 = 默认含 log）')
    assert(cliIndex.indexOf("(n.kind || 'note') !== 'log'") < 0, 'client 隐身渲染守卫已移除')
    assert(clientPkgSrc.indexOf('foldLogLoaded') < 0 && clientPkgSrc.indexOf('ensureFoldLogs') < 0, '发布包 lib/client.js 同步拆除（需先跑 build-dist）')
    // 原型 mock 与 host 契约同步：notes-list 默认含 log（隐身过滤行已删）
    assert(proto.indexOf("x.kind === 'log' && !a.includeLogs") < 0, '原型 mock notes-list 默认含 log（同权）')
  })

  // ===== ② 行为级 eval：展开日志夹 vs 普通夹——同一 handler + RPC spy 恒零 + 计时 ≤2×（卡顿修复断言①）=====
  await t('展开卡顿修复 行为级：日志夹/普通夹展开同一代码路径（零 RPC）+ 计时 ≤2×（eval 基线对比）', () => {
    // 提取 app 树点击委托真实代码路径（Proxy 打桩模式同节 54）
    const m = appTree.match(/\$\('tree'\)\.addEventListener\('click', function \(ev\) \{([\s\S]*?)\n\}\);/)
    assert(m, '提取 app 树点击委托 handler 失败（结构变更需同步本断言）')
    assert(m[1].indexOf('ensureFoldLogs') < 0 && m[1].indexOf('rpc(') < 0 && m[1].indexOf('notes-list') < 0, '展开 handler 无任何 RPC 调用（卡顿根因：旧路径每次首展开带 1 次全库 includeLogs RPC）')
    function mkWorld() {
      const calls = { render: 0, renderTree: 0, rpc: 0 }
      const target = {
        view: { type: 'all', id: '' }, foldOpen: {},
        folders: [{ id: 'fNorm', name: '普通夹', parent: '' }, { id: 'fLog', name: '工作日志', parent: '' }],
        notes: [], searchText: '',
        render: function () { calls.render++ },
        renderTree: function () { calls.renderTree++ },
        saveFoldOpen: function () {},
        rpc: function () { calls.rpc++; return Promise.resolve({}) },
        folderKids: function (pid) { return target.folders.filter(function (x) { return (x.parent || '') === pid }) },
        matches: function () { return true },
        filtersActiveCount: function () { return 0 },
        selMode: false, selIds: {},
      }
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      new Function('scope', 'with (scope) {\n__fire = function (ev) {' + m[1] + '\n}\n}')(proxy)
      return { target, calls, fire: target.__fire }
    }
    function mkEv(chain) { return { target: { closest: function (sel) { return chain[sel] || null } } } }
    const w = mkWorld()
    // 折叠态起：普通夹/日志夹各展开一次
    w.target.foldOpen['fNorm'] = false; w.target.foldOpen['fLog'] = false
    w.fire(mkEv({ '[data-fold]': { dataset: { fold: 'fNorm' } } }))
    assert(w.target.foldOpen['fNorm'] === true && w.calls.rpc === 0 && w.calls.renderTree === 1, '普通夹展开 = 纯 toggle（零 RPC + 单次 renderTree）')
    w.fire(mkEv({ '[data-fold]': { dataset: { fold: 'fLog' } } }))
    assert(w.target.foldOpen['fLog'] === true && w.calls.rpc === 0, '日志夹展开 = 同一纯 toggle 路径（零 RPC——旧 overlay 路径每夹首展开 1 次全库 RPC 已消除）')
    assert(w.calls.renderTree === 2 && w.calls.render === 0, '两夹展开各 1 次局部渲染（无 render 全量）')
    // 计时对比（同一路径恒 ≈1×；阈值 2× 防回归引入新特化分支；修复前基线：旧路径多 1 次全库 RPC + 二次渲染，mock 环境 ≈64×）
    const N = 20000
    function bench(fid) {
      const ev = mkEv({ '[data-fold]': { dataset: { fold: fid } } })
      const s = process.hrtime.bigint()
      for (let i = 0; i < N; i++) w.fire(ev)
      return Number(process.hrtime.bigint() - s) / 1e6
    }
    bench('fNorm'); bench('fLog')   // 预热（消 JIT 偏差）
    const tNorm = bench('fNorm'), tLog = bench('fLog')
    assert(tLog <= Math.max(tNorm * 2, 1), '日志夹展开计时 ≤ 普通夹 ×2（实得 普通 ' + tNorm.toFixed(2) + 'ms / 日志 ' + tLog.toFixed(2) + 'ms，' + N + ' 次迭代）')
  })

  // ===== ③ 日志行普通渲染（logmark 隐身徽章移除，三端同步）=====
  await t('日志行普通渲染：logmark 隐身徽章三端移除（kind 色点照常区分类型）+ tree.logTip 字典键移除', () => {
    assert(appTree.indexOf('logmark') < 0, 'app noteRow logmark 徽章已移除')
    assert(cliTree.indexOf('logmark') < 0, 'client noteRow logmark 徽章已移除')
    assert(proto.indexOf('logmark') < 0, '原型 logmark 徽章已移除')
    assert(cliTree.indexOf("tt('tree.logTip')") < 0 && appTree.indexOf("t('tree.logTip')") < 0, 'tree.logTip 引用清零')
    const zh = read(path.join('src', 'i18n', 'zh.js')), en = read(path.join('src', 'i18n', 'en.js'))
    assert(zh.indexOf("'tree.logTip'") < 0 && en.indexOf("'tree.logTip'") < 0, 'tree.logTip 双语字典键已移除（68 节双向覆盖守卫配套）')
    // 日志行仍带 kind 色点（类型可区分，同权不等于无标识）
    assert(appTree.indexOf('KCOLOR[n.kind]') >= 0 && cliTree.indexOf("var(--nkind-' + (n.kind || 'note') + ')'") >= 0, 'kind 色点照常（log 有自己的色点 var(--nkind-log)）')
  })
  }
}
