// 节 99. 0.4.6-H 小修批五项（notes-046-smallfix；UX 巡检 R2 角色③ 反馈源：n-mux9s42zajxk / n-mux9svn0vhkz / n-mux9rpgowpz6 / n-mux9r8hfh7xy / n-mux9tc6z76mj）
// ① dispatch 缺参校验：notes-dispatch/note_manage.dispatch 缺 id 或笔记不存在 → 结构化 {error:'笔记不存在或参数缺失'}
//   （修复「cannot read "…/undefined.md"」把 undefined 拼进路径、泄漏内部存储形态；与 notes-export-single 缺 dir 同口径）；
// ② 设置校验错误可见位：app mErr 自弹窗底部移到标题栏下（保存按钮视野内）+ modalErr scrollIntoView 兜底；
//   client 设置卡错误区同位移到标题栏正下方 + 出现即滚回顶部（双端）；
// ③ 筛选面板选项计数口径：状态组/类型组计数过 visMask 遮罩（与 matches() 遮罩段同口径），
//   消「置顶选项计数 1 vs 命中 0」矛盾；「机器」选项在缓存无 sys 时显示「点选加载」占位（不显示误导性 0），恰选 sys 单档显真实命中数；
// ④ 嵌套隐身提示行：夹展开为空（子夹全是 sys/hidden 被整节点滤除且无直挂笔记）→ 一行提示「内含机器托管内容…」（双端 + 原型同步；遮罩不松绑）；
// ⑤ 卫生小件：head.html 内联 data-URI favicon（消 /favicon.ico 404 噪音）+ 启动时清扫 notes/.tmpdir 超 24h 原子写孤儿
//   （fire-and-forget、在途写豁免、能力缺失静默跳过；行为级：真临时目录造孤儿 → 冷实例 apply → 老孤儿消失/新孤儿保留）。
module.exports = {
  id: "99",
  title: "99. 0.4.6-H 小修批（dispatch 缺参校验 / 设置错误可见位 / 选项计数口径 / 嵌套隐身提示 / favicon+tmpdir 卫生，notes-046-smallfix）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, hostSrc, indexSrc, clientSrc, pathToFileURL } = H
  const { handlers, registeredTools } = S
  section('99. 0.4.6-H 小修批（dispatch 缺参/设置错误位/选项计数/嵌套隐身提示/favicon+tmpdir）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appQuery = read(path.join('src', 'app', 'panels', 'query.js'))
  const appFilterbar = read(path.join('src', 'app', 'panels', 'filterbar.js'))
  const appTree = read(path.join('src', 'app', 'panels', 'tree.js'))
  const appSettings = read(path.join('src', 'app', 'modals', 'settings.js'))
  const appFramework = read(path.join('src', 'app', 'modals', 'framework.js'))
  const appHelpers = read(path.join('src', 'app', 'kernel', 'helpers.js'))
  const appState = read(path.join('src', 'app', 'kernel', 'state.js'))
  const appHead = read(path.join('src', 'app', 'shell', 'head.html'))
  const cliSettings = read(path.join('src', 'client', 'modals', 'settings.js'))
  const cliFilterPop = read(path.join('src', 'client', 'popovers', 'filter-pop.js'))
  const cliIndex = read(path.join('src', 'client', 'panels', 'panel', 'index.js'))
  const cliTree = read(path.join('src', 'client', 'panels', 'panel', 'tree.js'))
  const stylesDev = read(path.join('src', 'styles.css'))
  const trashDev = read(path.join('src', 'host', 'history-trash', 'trash.js'))
  const trashDist = read(path.join('src', 'host', 'history-trash', 'trash.dist.js'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const clientPkgSrc = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))
  const ZH99 = new Function(read(path.join('src', 'i18n', 'zh.js')) + '\nreturn I18N_ZH')()
  const EN99 = new Function(read(path.join('src', 'i18n', 'en.js')) + '\nreturn I18N_EN')()
  const LIVE_SID99 = 'session-abc12345-0000-0000-0000-000000000000'

  // ===== ① dispatch 缺参校验（行为级 + 双变体/发布包源锚） =====
  await t('0.4.6-H① notes-dispatch 缺参/不存在 → 结构化 {error:\'笔记不存在或参数缺失\'}（不再泄漏 undefined.md 路径）', async () => {
    const r1 = await handlers['notes-dispatch']({})
    assert(r1 && r1.error === '笔记不存在或参数缺失', '空 args（实得 ' + JSON.stringify(r1) + '）')
    const r2 = await handlers['notes-dispatch']({ id: 'n-nosuch046h', sessionId: LIVE_SID99 })
    assert(r2 && r2.error === '笔记不存在或参数缺失', '不存在 id（实得 ' + JSON.stringify(r2) + '）')
    assert(JSON.stringify(r1).indexOf('undefined.md') < 0 && JSON.stringify(r2).indexOf('undefined.md') < 0, '错误消息不再拼 undefined.md（内部存储形态零泄漏）')
    // 正控：合法派发不受影响（缺 sessionId 走既有「缺少目标会话」分支；全参派发 ok）
    const c = await handlers['notes-create']({ title: '046H正控', body: 'x', kind: 'todo' })
    const rNoSid = await handlers['notes-dispatch']({ id: c.id })
    assert(rNoSid && rNoSid.error === '缺少目标会话', '缺 sessionId 仍走既有分支（实得 ' + JSON.stringify(rNoSid) + '）')
    const ok = await handlers['notes-dispatch']({ id: c.id, sessionId: LIVE_SID99, sessionName: '开发会话' })
    assert(ok && ok.ok === true, '合法派发不受影响（实得 ' + JSON.stringify(ok).slice(0, 120) + '）')
  })
  await t('0.4.6-H① note_manage.dispatch 不存在 id → 同一结构化 error（工具面同口径）', async () => {
    const mgr = registeredTools.find(x => x.name === 'note_manage')
    const r = await mgr.execute({ action: 'dispatch', id: 'n-nosuch046h', targetSessionId: LIVE_SID99 })
    assert(r && r.error === '笔记不存在或参数缺失', '实得 ' + JSON.stringify(r))
  })
  await t('0.4.6-H① 入口校验双变体 + 发布包同步（_dispatch 单点闸门）', () => {
    for (const pair of [['开发版 host 拼接产物', hostSrc], ['发布包 index.mjs', indexSrc]]) {
      assert(pair[1].indexOf("if (!id) return { error: '笔记不存在或参数缺失' }") >= 0, pair[0] + ' 缺 id 闸门')
      assert(pair[1].indexOf("try { note = await _get(id) } catch (e) { return { error: '笔记不存在或参数缺失' } }") >= 0, pair[0] + ' _get 不存在结构化闸门')
    }
  })

  // ===== ② 设置校验错误可见位（双端源锚 + 发布包同步） =====
  await t('0.4.6-H② app 设置卡：mErr 错误区移到标题栏下（setBody 之前）+ modalErr scrollIntoView 兜底', () => {
    const openHtml = appSettings.slice(appSettings.indexOf('openModal('), appSettings.indexOf('openModal(') + 1200)
    const iErr = openHtml.indexOf('id="mErr"'), iBody = openHtml.indexOf('id="setBody"')
    assert(iErr >= 0 && iBody >= 0 && iErr < iBody, 'mErr 在 setBody 之前（标题栏动作区视野内；实得 ' + iErr + ' vs ' + iBody + '）')
    assert(appFramework.indexOf("e.scrollIntoView({ block: 'nearest' })") >= 0, 'modalErr 报错后滚动定位（nearest 最小滚动）')
  })
  await t('0.4.6-H② client 设置卡：错误区移到标题栏正下方 + 出现即滚回顶部（与 app 同位）', () => {
    const iT = cliSettings.indexOf("dsh-notes-settings-modal-t"), iErr = cliSettings.indexOf("dsh-notes-dispatch-err"), iHint = cliSettings.indexOf("dsh-notes-data-hint")
    assert(iT >= 0 && iErr > iT && iHint > iErr, '错误区渲染位 = 标题栏之后、onboarding 之前（实得 ' + iT + '/' + iErr + '/' + iHint + '）')
    assert(cliSettings.indexOf("m.scrollTop = 0") >= 0 && cliSettings.indexOf('[error]') >= 0, '错误出现即滚回顶部 effect')
  })
  await t('0.4.6-H② 发布包同步：app.html mErr 前置 + lib/client.js 错误区移位/滚顶', () => {
    assert(appHtml.indexOf('<div class="modal-err" id="mErr" style="display:none"></div><div id="setBody">') >= 0, 'app.html mErr 在 setBody 前（需先跑 build-dist）')
    const iErr = clientPkgSrc.indexOf("dsh-notes-dispatch-err"), iHint = clientPkgSrc.indexOf("dsh-notes-data-hint")
    assert(iErr >= 0 && iHint >= 0 && iErr < iHint, 'lib/client.js 错误区在 data-hint 前（需先跑 build-dist）')
    assert(clientPkgSrc.indexOf('scrollTop = 0') >= 0, 'lib/client.js 滚顶 effect 同步')
  })

  // ===== ③ 筛选面板选项计数口径（源锚 + eval 三档 + 状态组遮罩对齐） =====
  await t('0.4.6-H③ 源锚：app visMask 谓词 + 计数过遮罩 + 机器档「点选加载」占位；client 同构', () => {
    assert(appQuery.indexOf('function visMask(n)') >= 0, 'app query.js visMask 遮罩谓词（与 matches() 遮罩段同口径）')
    assert(appFilterbar.indexOf('visMask(n) && s.pred(n)') >= 0, 'app 状态组计数过 visMask')
    assert(appFilterbar.indexOf("t('filter.sysCountLazy')") >= 0 && appFilterbar.indexOf("filters.kinds.length === 1 && filters.kinds[0] === 'sys'") >= 0, 'app 机器档计数：恰选 sys 单档显真值，其余「点选加载」占位')
    assert(cliIndex.indexOf('visMask: visMask') >= 0 && cliIndex.indexOf('const visMask = (() =>') >= 0, 'client 装配层 visMask 计算 + 注入 filter-pop')
    assert(cliFilterPop.indexOf('args.visMask') >= 0 && cliFilterPop.indexOf('visMask(n) && f.pred(n)') >= 0 && cliFilterPop.indexOf("t('filter.sysCountLazy')") >= 0, 'client filter-pop 计数同口径 + 机器档占位')
    assert(ZH99['filter.sysCountLazy'] && EN99['filter.sysCountLazy'], 'filter.sysCountLazy 双语在案')
  })
  await t('0.4.6-H③ eval 三档：机器选项 缺省档占位/恰选 sys 单档显真值/多选含 sys 回占位 + 置顶计数随遮罩归零', () => {
    const mP = appFilterbar.match(/function renderFilterPop\(\) \{([\s\S]*?)\n\}/)
    const mV = appQuery.match(/function visMask\(n\) \{([\s\S]*?)\n\}/)
    const mFH = appHelpers.match(/function folderHidden\(fid\) \{([\s\S]*?)\n\}/)
    const mFS = appHelpers.match(/function folderSys\(fid\) \{([\s\S]*?)\n\}/)
    assert(mP && mV && mFH && mFS, '提取 renderFilterPop/visMask/folderHidden/folderSys 失败（结构变更需同步本断言）')
    function mkWorld(over) {
      const target = Object.assign({
        filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] },
        showHidden: false,
        folders: [{ id: 'fSys', name: '机器夹', parent: '', sys: true }, { id: 'fNorm', name: '普通夹', parent: '' }],
        FILTER_STATUS: [{ id: 'pinned', label: '置顶', icon: 'i-pin', pred: function (n) { return n.status === 'pinned' } }],
        FILTER_KINDS: ['note', 'sys'],
        KCOLOR: {},
        t: function (k) { return k },
        icon: function () { return '' },
        esc: function (x) { return String(x) },
        filterStatusLabel: function (id) { return id },
        kindLabel: function (k) { return k },
        hasInjectEver: function () { return false },
        matches: function () { return true },
        machineKindOn: function () { return target.filters.kinds.indexOf('sys') >= 0 },
      }, over || {})
      const els = {}
      target.$ = function (id) { if (!els[id]) els[id] = { innerHTML: '', classList: { toggle: function () {} } }; return els[id] }
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      new Function('scope', 'with (scope) {\nfolderHidden = function (fid) {' + mFH[1] + '\n}\nfolderSys = function (fid) {' + mFS[1] + '\n}\nvisMask = function (n) {' + mV[1] + '\n}\n__fn = function () {' + mP[1] + '\n}\n}')(proxy)
      return { run: target.__fn, els: els, target: target }
    }
    function rowCnt(html, attr, val) {
      const m = html.match(new RegExp('data-' + attr + '="' + val + '"[\\s\\S]*?<span class="cnt2">([^<]*)</span>'))
      return m ? m[1] : null
    }
    const N = [
      { id: 'n1', kind: 'note', folder: 'fNorm', status: 'active' },
      { id: 'n2', kind: 'note', folder: 'fSys', status: 'active' },
      { id: 'n3', kind: 'note', folder: 'fSys', status: 'pinned' },   // 置顶但在 sys 夹链内 → 缺省档遮罩
    ]
    // 档①缺省档（缓存无 sys）：机器选项 =「点选加载」占位（不再显示误导性 0）；置顶选项计数 0（遮罩对齐命中口径）
    const w1 = mkWorld({ notes: N })
    w1.run()
    const h1 = w1.els.fpop.innerHTML
    assert.strictEqual(rowCnt(h1, 'fk', 'sys'), 'filter.sysCountLazy', '档①缺省：机器选项显示「点选加载」占位（实得 ' + rowCnt(h1, 'fk', 'sys') + '）')
    assert.strictEqual(rowCnt(h1, 'ft', 'pinned'), '0', '档①缺省：置顶选项计数 0（置顶笔记在 sys 夹链内被遮罩——消「选项 1 vs 命中 0」矛盾）')
    assert.strictEqual(rowCnt(h1, 'fk', 'note'), '1', '档①缺省：note 选项计数 1（fSys 内普通笔记同遮罩）')
    // 档②恰选 sys 单档：host kind 通道取回全库 sys（缓存即 sys 集）→ 真实命中数
    const S2 = [{ id: 's1', kind: 'sys', folder: 'fSys', status: 'active' }, { id: 's2', kind: 'sys', folder: '', status: 'active' }]
    const w2 = mkWorld({ notes: S2, filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: ['sys'] } })
    w2.run()
    assert.strictEqual(rowCnt(w2.els.fpop.innerHTML, 'fk', 'sys'), '2', '档②恰选 sys：真实命中数 2（实得 ' + rowCnt(w2.els.fpop.innerHTML, 'fk', 'sys') + '）')
    // 档③多选含 sys：无参取数缓存仍无 sys → 回占位
    const w3 = mkWorld({ notes: N, filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: ['sys', 'note'] } })
    w3.run()
    assert.strictEqual(rowCnt(w3.els.fpop.innerHTML, 'fk', 'sys'), 'filter.sysCountLazy', '档③多选含 sys：回「点选加载」占位（缓存仍无 sys）')
    // 显示隐藏开：遮罩全放 → 置顶计数回真值 1
    const w4 = mkWorld({ notes: N, showHidden: true })
    w4.run()
    assert.strictEqual(rowCnt(w4.els.fpop.innerHTML, 'ft', 'pinned'), '1', '显示隐藏开：置顶计数回真值 1（遮罩全放）')
  })

  // ===== ④ 嵌套隐身提示行（eval 行为级 + 双端/原型/样式源锚 + i18n） =====
  await t('0.4.6-H④ 源锚：app tree.js 提示行 + client panel/tree.js 同构 + 双端样式 + 原型同步 + i18n 双语', () => {
    assert(appTree.indexOf("'<div class=\"sys-mask-hint\">' + t('tree.sysMaskHint') + '</div>'") >= 0, 'app folderNodeHtml 遮罩提示行')
    assert(appTree.indexOf('if (!subHtml && !kids.length && maskedSub > 0)') >= 0, 'app 提示行条件：整空（子夹全遮罩且无直挂）才出现')
    assert(cliTree.indexOf("className: 'dsh-notes-sysmask-hint'") >= 0 && cliTree.indexOf("tt('tree.sysMaskHint')") >= 0, 'client renderFolderNode 同构提示行')
    assert(appHead.indexOf('.sys-mask-hint{') >= 0 && stylesDev.indexOf('.dsh-notes-sysmask-hint{') >= 0, '双端提示行样式')
    assert(read(path.join('design', 'notes-ui-v2.html')).indexOf('sys-mask-hint') >= 0, '原型 notes-ui-v2.html 同步（节 41 四端口径）')
    assert(ZH99['tree.sysMaskHint'] && EN99['tree.sysMaskHint'], 'tree.sysMaskHint 双语在案')
    assert(appHtml.indexOf('sys-mask-hint') >= 0 && clientPkgSrc.indexOf('dsh-notes-sysmask-hint') >= 0, '发布包 app.html/lib client.js 同步（需先跑 build-dist）')
  })
  await t('0.4.6-H④ eval：folderNodeHtml——子夹全遮罩且直挂空 → 提示行；机器档放行/普通子夹/真空夹/有直挂 → 零提示', () => {
    const m = appTree.match(/function folderNodeHtml\(f, vis, filtering\) \{([\s\S]*?)\n\}/)
    assert(m, '提取 app folderNodeHtml 失败（结构变更需同步本断言）')
    function mkWorld(over) {
      const target = Object.assign({
        foldOpen: {},
        showHidden: false,
        filters: { kinds: [] },
        sysKids: {},
        folders: [
          { id: 'fNorm', name: '普通夹', parent: '', count: 0 },
          { id: 'fSubSys', name: '机器子夹', parent: 'fNorm', count: 0, sys: true },
        ],
        t: function (k) { return k },
        icon: function () { return '' },
        esc: function (s) { return String(s) },
        machineKindOn: function () { return target.filters.kinds.indexOf('sys') >= 0 },
        noteRow: function (n) { return '<div class="note-row" data-note="' + n.id + '"></div>' },
        folderKids: function (pid) { return target.folders.filter(function (x) { return (x.parent || '') === pid }) },
        folderSubtree: function (id) { var o = {}; o[id] = true; return o },
      }, over || {})
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      new Function('scope', 'with (scope) {\nfolderNodeHtml = function (f, vis, filtering) {' + m[1] + '\n}\n__fn = folderNodeHtml\n}')(proxy)
      return target.__fn
    }
    const fN = { id: 'fNorm', name: '普通夹', parent: '', count: 0 }
    // 子夹全 sys 遮罩 + 直挂空：提示行出现，被遮罩子夹行不渲染（遮罩不松绑）
    const h1 = mkWorld()(fN, [], false)
    assert(h1.indexOf('sys-mask-hint') >= 0 && h1.indexOf('tree.sysMaskHint') >= 0, '整空：提示行出现')
    assert(h1.indexOf('data-fold="fSubSys"') < 0, '被遮罩 sys 子夹行仍不渲染（提示≠松绑）')
    // 机器档放行：子夹渲染、提示消失
    const h2 = mkWorld({ filters: { kinds: ['sys'] } })(fN, [], false)
    assert(h2.indexOf('data-fold="fSubSys"') >= 0 && h2.indexOf('sys-mask-hint') < 0, '机器档：子夹放行渲染、零提示')
    // 显示隐藏开：同放行零提示
    const h3 = mkWorld({ showHidden: true })(fN, [], false)
    assert(h3.indexOf('data-fold="fSubSys"') >= 0 && h3.indexOf('sys-mask-hint') < 0, '显示隐藏开：子夹放行、零提示')
    // 普通子夹（未遮罩）：渲染子夹行、零提示
    const w4 = mkWorld({ folders: [{ id: 'fNorm', name: '普通夹', parent: '', count: 0 }, { id: 'fSub', name: '普通子夹', parent: 'fNorm', count: 0 }] })
    const h4 = w4(fN, [], false)
    assert(h4.indexOf('data-fold="fSub"') >= 0 && h4.indexOf('sys-mask-hint') < 0, '普通子夹：渲染、零提示')
    // 真空夹（无子夹无直挂）：无 nested 容器、零提示（提示行不打扰真空态）
    const w5 = mkWorld({ folders: [{ id: 'fNorm', name: '普通夹', parent: '', count: 0 }] })
    const h5 = w5(fN, [], false)
    assert(h5.indexOf('nested') < 0 && h5.indexOf('sys-mask-hint') < 0, '真空夹：无 nested 容器、零提示')
    // 有直挂笔记 + 遮罩子夹：内容可见不打扰
    const h6 = mkWorld()(fN, [{ id: 'n1', kind: 'note', folder: 'fNorm' }], false)
    assert(h6.indexOf('data-note="n1"') >= 0 && h6.indexOf('sys-mask-hint') < 0, '有直挂笔记：零提示')
  })

  // ===== ⑤ favicon + .tmpdir 孤儿清扫（源锚 + 行为级） =====
  await t('0.4.6-H⑤ favicon：head.html 内联 data-URI icon（消 /favicon.ico 404）+ 发布包同步', () => {
    assert(appHead.indexOf('<link rel="icon" href="data:image/svg+xml,') >= 0, 'head.html 内联 favicon（浏览器不再请求 /favicon.ico）')
    assert(appHtml.indexOf('<link rel="icon" href="data:image/svg+xml,') >= 0, '发布包 app.html 同步（需先跑 build-dist）')
  })
  await t('0.4.6-H⑤ tmpdir 清扫源锚：trash 双变体（开发版空操作/发布版真删）+ 启动接线 + 24h 阈值/在途豁免/能力守卫', () => {
    assert(trashDev.indexOf('async function sweepTmpdirOrphans() {}') >= 0 && trashDev.indexOf('fsNode') < 0, '开发版 trash.js = 空操作（节 27/28 红线：host 零 node:fs 引用）')
    assert(trashDist.indexOf('async function sweepTmpdirOrphans()') >= 0, '发布变体 trash.dist.js 真实清扫实现')
    assert(trashDist.indexOf("nm.slice(-7) !== '.tmpdir'") >= 0, '.tmpdir 后缀签名')
    assert(trashDist.indexOf('st.mtimeMs < cutoff') >= 0, '只删 >24h（在途写豁免）')
    assert(trashDist.indexOf("typeof fs.processPath !== 'function'") >= 0 && trashDist.indexOf('fsNode.promises.rm') >= 0, '能力守卫 + node:fs 真删通道（purgeNoteFile 先例）')
    assert(hostSrc.indexOf('sweepTmpdirOrphans()') >= 0 && indexSrc.indexOf('sweepTmpdirOrphans()') >= 0, '双端 apply 启动接线（fire-and-forget）')
    assert(indexSrc.indexOf('TMPDIR_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000') >= 0, '24h 孤儿阈值常量（发布包）')
  })
  await t('0.4.6-H⑤ tmpdir 清扫行为级：真临时目录造孤儿 → 静态包冷实例 apply → 老孤儿消失 / 在途新孤儿保留', async () => {
    const tmpBase = fsNative.mkdtempSync(path.join(osNative.tmpdir(), 'n046h-sweep-'))
    const oldName = '.n-check046h-old.md.99999.11111111-2222-3333-4444-555555555555.tmpdir'
    const freshName = '.n-check046h-fresh.md.99999.66666666-7777-8888-9999-000000000000.tmpdir'
    const oldDir = path.join(tmpBase, oldName), freshDir = path.join(tmpBase, freshName)
    const harnessBackup = global.harness
    try {
      fsNative.mkdirSync(oldDir, { recursive: true }); fsNative.writeFileSync(path.join(oldDir, 'n-check046h-old.md'), 'orphan')
      fsNative.mkdirSync(freshDir, { recursive: true }); fsNative.writeFileSync(path.join(freshDir, 'n-check046h-fresh.md'), 'inflight')
      const oldT = new Date(Date.now() - 2 * 86400000)
      fsNative.utimesSync(oldDir, oldT, oldT)   // 老孤儿：mtime 拨回 2 天前（>24h）；freshDir 不动 = 在途写
      const NR = path.join(osNative.homedir(), '.dsh', 'notes')
      const storeS = new Map()
      // 非 .tmpdir 对照条目：给一份合法 front-matter（_list/backfill 会读它——肃清 ENOENT 噪音，同时演练「普通文件被跳过」）
      storeS.set(path.join(NR, 'n-check046h.md'), '---\nid: n-check046h\ntitle: 046H对照\ntopic: 测试\nstatus: active\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n对照正文\n')
      const fsMockS = {
        resolve: async (p) => p,
        processPath: (tg) => { const s = String(tg); if (s.indexOf(oldName) >= 0) return oldDir; if (s.indexOf(freshName) >= 0) return freshDir; return s },
        stat: async (p) => (p === NR ? { dir: true } : (storeS.has(p) ? { file: true } : null)),
        listDir: async (p) => (p === NR ? [{ name: oldName, type: 'directory' }, { name: freshName, type: 'directory' }, { name: 'n-check046h.md', type: 'file' }] : []),
        readText: async (p) => { if (!storeS.has(p)) throw new Error('ENOENT: ' + p); return storeS.get(p) },
        writeText: async (p, c) => { storeS.set(p, c) },
      }
      delete global.harness   // 静态包冷实例：webServer/tools 兜底通道，不占用共享 harness handlers
      const modS = await import(pathToFileURL(H.INDEX_PATH).href + '?sweep046h=1')
      modS.apply({
        fs: fsMockS, sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
        effect: () => {}, on: () => () => {},
      })
      // 清扫是 fire-and-forget：轮询落定（≤5s）
      let gone = false
      for (let i = 0; i < 50 && !gone; i++) { await new Promise(r => setTimeout(r, 100)); gone = !fsNative.existsSync(oldDir) }
      assert(gone, '>24h 孤儿目录启动后被清扫（实得仍存在：' + oldDir + '）')
      assert(fsNative.existsSync(freshDir), '在途写豁免： fresh 孤儿（<24h）保留不动')
    } finally {
      global.harness = harnessBackup
      try { fsNative.rmSync(tmpBase, { recursive: true, force: true }) } catch (e) {}
    }
  })
  }
}
