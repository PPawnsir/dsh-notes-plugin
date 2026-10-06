// 节 80. 文件夹显式展开放行 sys（0.4.4-C，notes-044-folder-explicit-view，用户裁决 2026-10-06）
// 背景：「记忆档案」夹徽标计数有值（0.4.3⑩ folders-count-sys 含 sys）但展开为空——client tree kids 来自裸 notes-list
// （host _list ⑨ 谓词默认排除 sys），sys 档案永远进不了 kids；host 显式 folder 入口本就放行 sys（⑨ 设计保留通道）。
// 定稿：文件夹展开 = sys 显式入口（OS 文件管理逻辑：默认降噪不阻拦查看）——按需 notes-list {folder:id} 定向补拉
// 该夹直挂 sys 行存 sysKids[fid]（{ stamp, rows }，stamp=notes 缓存身份），树渲染 kids 置尾合并；双端同构。
// 红线锁定：⑨ 默认列表/搜索降噪零放松（host _list 谓词零改动 + 过滤/搜索激活时 sys 行不混入）；
// 惰性锁定：普通夹/折叠夹恒零请求（子树徽标计数 − 缓存可见数 > 0 才发请求；新鲜缓存再展开零请求）；
// 防陈旧锁定：列表刷新后陈旧条目剔除（折叠）/重拉覆盖（展开）。
module.exports = {
  id: "80",
  title: "80. 文件夹显式展开放行 sys（0.4.4-C：按需补拉 sysKids + 树合并 + 机器 chip + 惰性/防陈旧/降噪红线，双端）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  const { clientPkgSrc } = S
  section('80. 文件夹显式展开放行 sys（0.4.4-C：sysKids 按需补拉 + 合并 + chip，双端同构）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const cliMenu = read(path.join('src', 'client', 'popovers', 'folder-menu.js'))
  const cliTree = read(path.join('src', 'client', 'panels', 'panel', 'tree.js'))
  const cliIndex = read(path.join('src', 'client', 'panels', 'panel', 'index.js'))
  const appTree = read(path.join('src', 'app', 'panels', 'tree.js'))
  const appData = read(path.join('src', 'app', 'kernel', 'data.js'))
  const appState = read(path.join('src', 'app', 'kernel', 'state.js'))
  const hostNotes = read(path.join('src', 'host', 'notes.js'))
  const zh = read(path.join('src', 'i18n', 'zh.js')), en = read(path.join('src', 'i18n', 'en.js'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))

  // ===== ① client 端接线：sysKids 态 + 按需补拉效应 + 装配注入 + 树合并 + 机器 chip =====
  await t('client 接线：sysKids 态 + 按需 {folder} 补拉效应（惰性闸/防陈旧/kind 口径门）+ 装配注入 + 树合并 + 机器 chip', () => {
    assert(cliMenu.indexOf('const [sysKids, setSysKids] = React.useState({})') >= 0, 'folder-menu.js sysKids state 声明')
    assert(cliMenu.indexOf('sysKidsInflightRef') >= 0, 'folder-menu.js 补拉在途去重闸')
    assert(cliMenu.indexOf("host.call('notes-list', { folder: fid })") >= 0, 'folder-menu.js 按需定向补拉（host 显式 folder 入口 = ⑨ 保留通道）')
    assert(cliMenu.indexOf("const kf = (args.filters && args.filters.kinds) || []") >= 0 && cliMenu.indexOf("if (kf.length === 1 && kf[0] !== 'sys') return") >= 0, 'folder-menu.js kind 单档口径门（⑩ 恰选非 sys kind 缓存不可比跳过）')
    assert(cliMenu.indexOf('foldersExpanded === null ? folders.map(f => f.id) : foldersExpanded') >= 0, 'folder-menu.js 缺省全展开物化（首载覆盖「记忆档案」场景）')
    assert(cliMenu.indexOf('if ((f.count || 0) - visible <= 0) continue') >= 0, 'folder-menu.js 惰性闸：子树计数 − 缓存可见数 > 0 才发请求（普通夹零请求）')
    assert(cliMenu.indexOf("if (ent && ent.stamp === notes) continue") >= 0, 'folder-menu.js 新鲜缓存短路（折叠不清缓存：同批数据再展开零请求）')
    assert(cliMenu.indexOf('sysKids: sysKids') >= 0, 'folder-menu.js return 暴露 sysKids')
    assert(cliIndex.indexOf('usePanelFolderMenu({ notes: notes, view: view, filters: filters })') >= 0, 'panel/index.js filters 入参注入（口径门数据源）')
    assert(cliIndex.indexOf('searchIds: searchIds, folders: folders, sysKids: sysKids') >= 0, 'panel/index.js sysKids 注入 usePanelTree')
    assert(cliTree.indexOf('const sysKids = args.sysKids || {}') >= 0, 'panel/tree.js sysKids 入参接入')
    assert(cliTree.indexOf('filtersActive ? kidsBase : kidsBase.concat(((sysKids[f.id] && sysKids[f.id].rows) || [])') >= 0, 'panel/tree.js kids 置尾合并 sys 子行（过滤激活不混入 = ⑨ 零放松）')
    assert(cliTree.indexOf("tt('tree.sysChipTip')") >= 0 && cliTree.indexOf("tt('meta.kindSys')") >= 0, 'panel/tree.js sys 行「机器」chip（tooltip + 文案字典键）')
    assert(clientPkgSrc.indexOf('const [sysKids, setSysKids] = React.useState({})') >= 0 && clientPkgSrc.indexOf("notes-list', { folder: fid }") >= 0, '发布包 lib/client.js 同步（build-dist 将 host.call 转写 rpc——取公共子串；需先跑 build-dist）')
  })

  // ===== ② app 端同构：三函数 + 展开挂钩 + 合并 + chip + 刷新链复核 + 状态 =====
  await t('app 同构：folderSysHidden/ensureSysKids/refreshSysKids + 展开挂钩 + 合并 + chip + loadNotes 复核', () => {
    assert(appState.indexOf('var sysKids = {};') >= 0 && appState.indexOf('var sysKidsInflight = {};') >= 0, 'app state.js sysKids/在途闸状态')
    assert(appTree.indexOf('function folderSysHidden(fid)') >= 0 && appTree.indexOf('function ensureSysKids(fid)') >= 0 && appTree.indexOf('function refreshSysKids()') >= 0, 'app tree.js 三函数落地')
    assert(appTree.indexOf("rpc('notes-list', { folder: fid })") >= 0, 'app tree.js 按需定向补拉（rpc 通道非 host.call——⑫ 双端通道差异）')
    assert(appTree.indexOf("if (filters.kinds.length === 1 && filters.kinds[0] !== 'sys') return") >= 0, 'app tree.js kind 单档口径门')
    assert(appTree.indexOf('if (foldOpen[fid2] === false) ensureSysKids(fid2);') >= 0, 'app 树点击委托：折叠→展开挂钩按需补拉')
    assert(appTree.indexOf('foldOpen[fid2] = foldOpen[fid2] === false ? true : false; saveFoldOpen(); renderTree(); return') >= 0, 'app 展开 toggle 锚点行原样保留（54/69 节既有断言兼容）')
    assert(appTree.indexOf('if (!filtering && sysKids[f.id]) kids = kids.concat(') >= 0, 'app folderNodeHtml kids 置尾合并（过滤激活不混入）')
    assert(appTree.indexOf("t('tree.sysChipTip')") >= 0 && appTree.indexOf("t('meta.kindSys')") >= 0, 'app noteRow sys「机器」chip')
    assert(appData.indexOf('renderTree(); refreshSysKids(); return true') >= 0, 'app loadNotes 链尾挂 refreshSysKids（刷新防陈旧复核）')
    assert(appHtml.indexOf('function ensureSysKids(fid)') >= 0 && appHtml.indexOf('refreshSysKids()') >= 0, '发布包 app.html 同步（需先跑 build-dist）')
  })

  // ===== ③ 行为级 eval：app folderNodeHtml 合并语义（展开见 sys 行 / 过滤态不混入 / 折叠不渲染）=====
  await t('行为级 eval：folderNodeHtml 合并 sysKids——展开见 sys 行 + 过滤态零混入（⑨）+ 折叠不渲染 + 无 sys 夹 kids 等价', () => {
    const m = appTree.match(/function folderNodeHtml\(f, vis, filtering\) \{([\s\S]*?)\n\}/)
    assert(m, '提取 app folderNodeHtml 失败（结构变更需同步本断言）')
    function mkWorld(over) {
      const target = Object.assign({
        foldOpen: {},
        sysKids: { fSys: { stamp: null, rows: [{ id: 's1', kind: 'sys', folder: 'fSys', title: '记忆档案' }] } },
        folders: [{ id: 'fSys', name: '记忆档案', parent: '', count: 1 }, { id: 'fNorm', name: '普通夹', parent: '', count: 1 }],
        t: function (k) { return k },
        icon: function () { return '' },
        esc: function (s) { return String(s) },
        noteRow: function (n) { return '<div class="note-row" data-note="' + n.id + '"></div>' },
        folderKids: function (pid) { return target.folders.filter(function (x) { return (x.parent || '') === pid }) },
        folderSubtree: function (id) { var o = {}; o[id] = true; return o },
      }, over || {})
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      new Function('scope', 'with (scope) {\n__fn = function (f, vis, filtering) {' + m[1] + '\n}\n}')(proxy)
      return target.__fn
    }
    const vis = [{ id: 'n1', kind: 'note', folder: 'fNorm' }]
    const fSys = { id: 'fSys', name: '记忆档案', parent: '', count: 1 }
    const fNorm = { id: 'fNorm', name: '普通夹', parent: '', count: 1 }
    // 展开（缺省全展开）：sys 行渲染且包在 .nested 子容器内
    const h1 = mkWorld()(fSys, vis, false)
    assert(h1.indexOf('data-note="s1"') >= 0 && h1.indexOf('<div class="nested">') >= 0, '展开「记忆档案」→ sys 档案行出现在 .nested 内')
    // 过滤/搜索激活：sys 行不混入（⑨ 降噪零放松）
    const h2 = mkWorld()(fSys, vis, true)
    assert(h2.indexOf('data-note="s1"') < 0, '过滤激活时 sys 行不混入（搜索/筛选降噪零放松）')
    // 折叠：不渲染子行
    const h3 = mkWorld({ foldOpen: { fSys: false } })(fSys, vis, false)
    assert(h3.indexOf('data-note="s1"') < 0 && h3.indexOf('<div class="nested">') < 0, '折叠态不渲染 sys 行')
    // 普通夹（无 sysKids 条目）：kids 与 0.4.3 口径逐字等价
    const h4 = mkWorld()(fNorm, vis, false)
    assert(h4.indexOf('data-note="n1"') >= 0 && h4.indexOf('data-note="s1"') < 0, '普通夹 kids 口径不变（无多余行）')
  })

  // ===== ④ 行为级 eval：app ensureSysKids/refreshSysKids 惰性 + 缓存 + 口径门 + 防陈旧 =====
  await t('行为级 eval：ensureSysKids 惰性闸（普通夹零 RPC/在途去重/新鲜缓存零请求/kind 口径门）+ refreshSysKids 防陈旧', async () => {
    const mH = appTree.match(/function folderSysHidden\(fid\) \{([\s\S]*?)\n\}/)
    const mE = appTree.match(/function ensureSysKids\(fid\) \{([\s\S]*?)\n\}/)
    const mR = appTree.match(/function refreshSysKids\(\) \{([\s\S]*?)\n\}/)
    assert(mH && mE && mR, '提取 app folderSysHidden/ensureSysKids/refreshSysKids 失败（结构变更需同步本断言）')
    function mkWorld() {
      const calls = { rpc: 0, renderTree: 0, rpcArgs: [] }
      const target = {
        filters: { kinds: [] },
        foldOpen: {},
        folders: [{ id: 'fSys', name: '记忆档案', parent: '', count: 2 }, { id: 'fNorm', name: '普通夹', parent: '', count: 1 }, { id: 'fSys2', name: '机器二夹', parent: '', count: 1 }],
        notes: [{ id: 'n1', kind: 'note', folder: 'fSys' }, { id: 'n2', kind: 'note', folder: 'fNorm' }],
        sysKids: {}, sysKidsInflight: {},
        folderSubtree: function (id) { var o = {}; o[id] = true; return o },
        renderTree: function () { calls.renderTree++ },
        rpc: function (m2, a) { calls.rpc++; calls.rpcArgs.push(a); return Promise.resolve({ notes: [{ id: 's1', kind: 'sys', folder: 'fSys', title: '档案' }, { id: 'nx', kind: 'note', folder: 'fSys' }, { id: 's2', kind: 'sys', folder: 'fChild' }] }) },
      }
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      new Function('scope', 'with (scope) {\n' + ('function folderSysHidden(fid) {' + mH[1] + '\n}\n') + ('function ensureSysKids(fid) {' + mE[1] + '\n}\n') + ('function refreshSysKids() {' + mR[1] + '\n}\n') + '\n}')(proxy)
      return { target, calls }
    }
    async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
    const w2 = mkWorld()
    // with 内 function 声明挂载到 eval 函数作用域而非 target——经 return 导出取回
    const fns = new Function('scope', 'with (scope) {\n' + ('function folderSysHidden(fid) {' + mH[1] + '\n}\n') + ('function ensureSysKids(fid) {' + mE[1] + '\n}\n') + ('function refreshSysKids() {' + mR[1] + '\n}\n') + '\nreturn { ensureSysKids: ensureSysKids, refreshSysKids: refreshSysKids }\n}')(new Proxy(w2.target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    }))
    fns.ensureSysKids('fNorm')
    assert(w2.calls.rpc === 0, '普通夹展开 = 零请求（无隐藏 sys）')
    // sys 夹：hidden>0 → 恰 1 次 {folder} 请求；在途重入不重复
    fns.ensureSysKids('fSys'); fns.ensureSysKids('fSys')
    assert(w2.calls.rpc === 1 && w2.calls.rpcArgs[0] && w2.calls.rpcArgs[0].folder === 'fSys', 'sys 夹补拉恰 1 次且定向 {folder:fSys}（在途去重）')
    await flush()
    assert(w2.target.sysKids.fSys && w2.target.sysKids.fSys.rows.length === 1 && w2.target.sysKids.fSys.rows[0].id === 's1', '取回行只收直挂本夹的 sys（非 sys/子孙夹 sys 滤除）')
    assert(w2.calls.renderTree === 1, '补拉落地后单次 renderTree')
    // 新鲜缓存：同批 notes 再展开零请求
    fns.ensureSysKids('fSys')
    assert(w2.calls.rpc === 1, '新鲜缓存再展开零请求（折叠不清缓存口径）')
    // kind 单档口径门：恰选非 sys kind → 跳过
    w2.target.filters = { kinds: ['log'] }
    fns.ensureSysKids('fSys2')
    assert(w2.calls.rpc === 1, '恰选单非 sys kind 档跳过补拉（缓存口径不可比）')
    // 防陈旧：notes 换代（列表刷新）→ refreshSysKids 重拉展开夹 + 剔除折叠陈旧条目
    w2.target.filters = { kinds: [] }
    w2.target.notes = [{ id: 'n1', kind: 'note', folder: 'fSys' }, { id: 'n2', kind: 'note', folder: 'fNorm' }]
    w2.target.foldOpen = { fSys2: false }
    w2.target.sysKids.fSys2 = { stamp: null, rows: [{ id: 's9', kind: 'sys', folder: 'fSys2' }] }   // 折叠中的陈旧条目
    fns.refreshSysKids()
    assert(!w2.target.sysKids.fSys2, 'refreshSysKids 剔除折叠且陈旧的条目')
    assert(w2.calls.rpc === 2, 'refreshSysKids 对展开中的陈旧夹重拉覆盖（fSys）')
    await flush()
    assert(w2.target.sysKids.fSys && w2.target.sysKids.fSys.stamp === w2.target.notes, '重拉后 stamp 换代为新 notes 身份')
  })

  // ===== ⑤ ⑨ 零放松回归锚：host _list sys 谓词零改动 + i18n 键在案 =====
  await t('⑨ 零放松回归锚：host _list sys 谓词原样（默认平铺排除/显式 folder 放行）+ tree.sysChipTip 双语在案', () => {
    assert(hostNotes.indexOf("if (includeSys !== true && !kind && !tag && (folder === undefined || folder === '') && note.kind === 'sys') continue") >= 0, 'host _list 主循环 sys 降噪谓词零改动（显式 folder 入口放行 = 本卡通道）')
    assert(hostNotes.indexOf("if (includeSys !== true && !kind && !tag && (folder === undefined || folder === '') && cn.kind === 'sys') continue") >= 0, 'host _list 并集补入 sys 谓词同口径零改动')
    assert(zh.indexOf("'tree.sysChipTip'") >= 0 && en.indexOf("'tree.sysChipTip'") >= 0, 'tree.sysChipTip 双语字典键在案')
    assert(zh.indexOf("'meta.kindSys'") >= 0 && en.indexOf("'meta.kindSys'") >= 0, 'meta.kindSys 双语字典键在案（chip 文案复用）')
  })
  }
}
