// 节 95. 0.4.6-C 概念引导与治理入口信号（notes-046-ux-discovery；UX 巡检 R2 发现性族：
//   反馈源 n-mux79khed187 概念唯一解释藏设置 / n-mux79kmsl8so 体检三层深 / n-mux7arz1ddyi @ 占位符不提笔记 /
//   n-mux7as05xnk9 📎 数字语义 / n-mux7as2cfd7s 面板整理派发入口 / n-mus81x40oqg6 建议器入口深）
// 改动五点：
//   ① 概念引导前置：client「使用说明」气泡首屏 +「核心概念 30 秒」节（约定/资料/挂载/派发/隐藏 一句话+后果，more 行指向设置卡完整版）；
//     空态首笔记引导补概念指向（client 树空态 tree.emptyConcept / app .ed empty editor.emptyConcept 静态壳+renderEd 双处 + 原型同款）；
//     设置卡「概念速览」保留为完整版（49 节锚不动）。
//   ② 建议器+体检入口提升：app 顶栏 + client 面板标题栏加「建议」按钮（有待办候选带计数徽标 = notes-suggest 六段合计，
//     纯函数 suggestPendingCount 两端同构，本节点 eval 钉死）；建议框底栏补「约定体检…」直达注入管理体检区（三层深 → 一层/两层）。
//   ③ @ 空态提示：mention 源拉取成功零命中 → 单条提示候选（mention.empty，无 value = onPick 守卫不产出，纯展示）；
//     拉取失败（缓存 null）保持空数组静默降级（节 89 口径不破）。
//   ④ 📎 徽标 tooltip 数字语义写明：「徽标数字 = 两者合计」（节 88 PAIRS 同步更新；tooltip 说后果口径延续 0.4.5-D）。
//   ⑤ 面板编辑器「整理」「派发」入口在位锁定（源码本就有——R2 观测与实现偏差，本卡以断言防回流）+
//     .dsh-notes-meta-act flex-shrink:0 窄宽根修（flex 缺省 shrink 会把按钮挤没——「窄宽被裁」根因）。
// 红线：tooltip 说后果口径延续 0.4.5-D；显示名不动；零新增 host RPC（计数复用 notes-suggest 既有响应）。
module.exports = {
  id: "95",
  title: "95. 0.4.6-C 概念引导与治理入口信号（使用说明首屏概念 + 建议/体检入口提升带徽标 + @ 空态 + 📎 语义 + 面板整理派发锁定）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('95. 0.4.6-C 概念引导与治理入口信号（notes-046-ux-discovery）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')   // LF 归一：Windows CRLF 源文件的多行锚可比
  const helpCli = read(path.join('src', 'client', 'popovers', 'help.js'))
  const treeCli = read(path.join('src', 'client', 'panels', 'panel', 'tree.js'))
  const suggCli = read(path.join('src', 'client', 'modals', 'suggest.js'))
  const chromeCli = read(path.join('src', 'client', 'panels', 'panel', 'chrome.js'))
  const edCli = read(path.join('src', 'client', 'panels', 'panel', 'editor.js'))
  const mentionSrc = read(path.join('src', 'client', 'triggers', 'mentions.js'))
  const stylesSrc = read(path.join('src', 'styles.css'))
  const appBody = read(path.join('src', 'app', 'shell', 'body.html'))
  const appHead = read(path.join('src', 'app', 'shell', 'head.html'))
  const appTopbar = read(path.join('src', 'app', 'panels', 'topbar.js'))
  const appEd = read(path.join('src', 'app', 'panels', 'editor.js'))
  const appEmeta = read(path.join('src', 'app', 'panels', 'editor-meta.js'))
  const appSugg = read(path.join('src', 'app', 'modals', 'suggest.js'))
  const appData = read(path.join('src', 'app', 'kernel', 'data.js'))
  const proto = read(path.join('design', 'notes-ui-v2.html'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const cliPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))
  const cssPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'styles.css'))
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const ZH95 = grab(read(path.join('src', 'i18n', 'zh.js')), 'I18N_ZH')
  const EN95 = grab(read(path.join('src', 'i18n', 'en.js')), 'I18N_EN')
  // 拼接产物中模块以 4 空格基座缩进存在：收尾行 = \n + 4 空格 + }
  const grabFn4 = (s, name, tag) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}')); assert(m, tag + ' 缺 ' + name + '()（结构变更需同步本断言）'); return m && m[0] }

  // ===== ① 概念引导前置：client 使用说明气泡首屏「核心概念 30 秒」节 =====
  await t('0.4.6-C 概念引导：使用说明气泡首屏五概念节（约定/资料/挂载/派发/隐藏 + more 指向设置卡完整版）+ 拼接产物锚', () => {
    assert(helpCli.indexOf("e('h5', null, t('help.conceptTitle'))") >= 0, '概念节标题锚')
    for (const k of ['help.conceptConvention', 'help.conceptReference', 'help.conceptMount', 'help.conceptDispatch', 'help.conceptHidden', 'help.conceptMore']) {
      assert(helpCli.indexOf("t('" + k + "')") >= 0, 'help.js 引用 ' + k)
    }
    // 首屏位置锚：概念块在 h4 标题之后、操作清单（help.newPre）之前
    const iH4 = helpCli.indexOf("e('h4', null, t('chrome.help'))")
    const iConcept = helpCli.indexOf("dsh-notes-help-concepts")
    const iOps = helpCli.indexOf("t('help.newPre')")
    assert(iH4 >= 0 && iConcept > iH4 && iOps > iConcept, '概念节在标题后、操作清单前（首屏）')
    assert(clientSrc.indexOf('dsh-notes-help-concepts') >= 0 && clientSrc.indexOf("t('help.conceptMount')") >= 0, '开发版拼接产物概念节锚')
    assert(cliPkg.indexOf('dsh-notes-help-concepts') >= 0, '发布包 lib/client.js 概念节锚（需先跑 build-dist）')
  })
  await t('0.4.6-C 空态首笔记引导补概念指向（client 树空态 + app 空态双处 + 原型同步；设置卡概念速览完整版保留）', () => {
    assert(treeCli.indexOf("tt('tree.emptyConcept')") >= 0 && treeCli.indexOf('dsh-notes-empty-concept') >= 0, 'client 树空态概念指向行')
    assert(treeCli.indexOf("tt('tree.emptySub')") >= 0, '原空态引导行保留（叠加不替换）')
    const CONCEPT_APP = '写下的约定/资料可注入 Agent 会话——设置卡顶部「概念速览」30 秒看懂五个核心概念'
    assert(appBody.indexOf('class="ed-empty-concept">' + CONCEPT_APP) >= 0, 'app 静态壳空态概念行')
    assert(appEd.indexOf("t('editor.emptyConcept')") >= 0 && appEd.indexOf('ed-empty-concept') >= 0, 'app renderEd 动态空态概念行走字典')
    assert(ZH95['editor.emptyConcept'] === CONCEPT_APP, 'editor.emptyConcept zh 与静态壳逐字一致（双处对齐）')
    const protoCnt = (proto.match(/ed-empty-concept/g) || []).length
    assert(protoCnt === 3, '原型空态概念行双处 + CSS 一类（实得 ' + protoCnt + '）')
    assert(proto.indexOf(CONCEPT_APP) >= 0, '原型概念行文案同口径（原型静态中文红线）')
    // 设置卡「概念速览」完整版保留（49 节锚不破，此处仅复核三端在案）
    assert(ZH95['settings.onboardTitle'] === '概念速览' && EN95['settings.onboardTitle'] === 'Concepts at a glance', '设置卡概念速览完整版保留')
  })

  // ===== ② 建议器+体检入口提升：顶栏「建议」按钮（双端+原型）+ 计数徽标 =====
  await t('0.4.6-C 建议入口：app 顶栏 btnSuggest + #suggestBd 徽标 + 点击 openSuggest + 启动/列表链尾刷新（含原型同步）', () => {
    assert(appBody.indexOf('<button class="tbtn ico-only" id="btnSuggest"') >= 0 && appBody.indexOf('<span class="cnt" id="suggestBd" style="display:none"></span>') >= 0, 'app body.html 按钮 + 徽标元素（ico-only：窄宽收图标态，节 57 配套）')
    assert(appTopbar.indexOf("$('btnSuggest').addEventListener('click', function () { openSuggest() })") >= 0, 'app topbar 点击 → openSuggest')
    assert(appTopbar.indexOf('refreshSuggestBadge();') >= 0, 'app 启动即拉一次计数')
    assert(appTopbar.indexOf("$('btnSuggest').querySelector('.tb-t').textContent = t('topbar.suggest')") >= 0, 'renderChrome 按钮文案走字典')
    assert(appData.indexOf(".then(function () { refreshSuggestBadge() })") >= 0, 'loadNotes 链尾节流刷新（0.4.6-B 锚行零改动——独立链节插入）')
    assert(appSugg.indexOf('function renderSuggestBadge()') >= 0 && appSugg.indexOf("t('topbar.suggestTipN', { n: suggestBadgeN })") >= 0, '徽标渲染 + 计数 tooltip 走字典')
    assert(appHead.indexOf('.tbtn .cnt{') >= 0, 'app 徽标样式（复用 fbtn-filter .cnt 视觉口径）')
    assert(proto.indexOf('id="btnSuggest"') >= 0 && proto.indexOf('id="suggestBd"') >= 0 && proto.indexOf('function suggestPendingCount') >= 0, '原型按钮/徽标/计数函数同步')
    assert(proto.indexOf(".then(function () { refreshSuggestBadge() })") >= 0, '原型 loadNotes 链尾同款刷新')
  })
  await t('0.4.6-C 建议入口（client）：标题栏「建议」按钮 + badge 切片订阅 + 打开/变更双触发防抖刷新 + 失败保旧值', () => {
    assert(chromeCli.indexOf("onClick: () => openSuggest()") >= 0, '标题栏按钮 → openSuggest')
    assert(chromeCli.indexOf("store.modal.suggest.useSel(s => s.badge)") >= 0, 'badge 切片订阅')
    assert(chromeCli.indexOf("e('span', { className: 'dsh-notes-tcnt' }, String(suggestBadge))") >= 0, '计数徽标元素（>0 才渲染）')
    assert(chromeCli.indexOf("tt('topbar.suggestTipN', { n: suggestBadge })") >= 0, '计数 tooltip 走字典')
    assert(chromeCli.indexOf('React.useEffect(() => { if (open) refreshSuggestBadge() }, [open])') >= 0, '面板打开触发刷新')
    assert(chromeCli.indexOf('noteRefreshListeners.add(fn)') >= 0 && chromeCli.indexOf('noteRefreshListeners.delete(fn)') >= 0, '笔记变更监听挂/卸成对')
    assert(suggCli.indexOf("badge: -1") >= 0, 'badge 初始 -1（未知不显示）')
    assert(suggCli.indexOf('timer.debounce(doRefreshSuggestBadge, 1200)') >= 0, '1.2s 防抖收口（写后频发路径）')
    assert(suggCli.indexOf('if (!res || res.error) return') >= 0, '失败/error 静默保旧值（不清零误报）')
    assert(suggCli.indexOf('setSuggestBadge(suggestPendingCount(res))') >= 0, 'loadSuggest 成功即同步徽标（同一响应同一函数）')
    assert(stylesSrc.indexOf('.dsh-notes-tcnt{') >= 0, 'client 徽标样式')
    assert(clientSrc.indexOf('dsh-notes-tcnt') >= 0 && cliPkg.indexOf('dsh-notes-tcnt') >= 0, '双端产物徽标锚（需先跑 build-dist）')
  })
  // 计数一致（断言②核心）：suggestPendingCount 行为级 eval——计数 = notes-suggest 六段候选合计
  await t('0.4.6-C 计数一致 eval：suggestPendingCount = notes-suggest 六段候选合计（边界 null/error/缺字段 → 0；双端同构）', () => {
    const fnCli = grabFn4(clientSrc, 'suggestPendingCount', 'clientSrc')
    const count = new Function(fnCli + '\nreturn suggestPendingCount')()
    const res = {
      archiveCandidates: [{}, {}],
      staleCandidates: [{}, {}, {}],
      orphanCandidates: [{}],
      logHygieneCandidates: { weekly: [{}], monthly: [{}, {}] },
      zeroRefMountCandidates: [{}],
      hotUnmountedCandidates: [{}, {}],
    }
    assert.strictEqual(count(res), 12, '六段合计 2+3+1+1+2+1+2=12（实得 ' + count(res) + '）')
    assert.strictEqual(count(null), 0, 'null → 0')
    assert.strictEqual(count({ error: 'x' }), 0, 'error 形态 → 0')
    assert.strictEqual(count({}), 0, '缺字段 → 0（容错）')
    assert.strictEqual(count({ archiveCandidates: [{}] }), 1, '单段计数')
    // app 侧同构锚：同一函数体逐字节语义（列 0 形态，app.html 产物同步由下方产物断言看守）
    assert(appSugg.indexOf('function suggestPendingCount(res) {') >= 0
      && appSugg.indexOf('+ ((res.zeroRefMountCandidates || []).length) + ((res.hotUnmountedCandidates || []).length)') >= 0, 'app 侧 suggestPendingCount 同构锚')
    // loadSuggest 双端同步徽标调用锚（徽标与 modal 内容同一响应）
    assert(appSugg.indexOf('suggestBadgeN = suggestPendingCount(res); renderSuggestBadge();') >= 0, 'app loadSuggest 同步徽标锚')
  })

  // ===== ②b 约定体检入口提升：建议框底栏直达（双端+原型） =====
  await t('0.4.6-C 体检入口提升：建议框底栏「约定体检…」→ openInjectManager（modal 不叠 modal：先关建议框；双端+原型）', () => {
    assert(suggCli.indexOf("tt('sugg.goConflict')") >= 0 && suggCli.indexOf("tt('sugg.goConflictTip')") >= 0, 'client 底栏体检按钮走字典')
    assert(suggCli.indexOf('setSuggestOpen(false); openInjectManager()') >= 0, 'client 先关建议框再开注入管理（不叠 modal）')
    assert(appSugg.indexOf('id="sgGoConflict"') >= 0 && appSugg.indexOf("closeModal(); suggestState = null; openInjectManager()") >= 0, 'app 底栏体检按钮 + 链路锚')
    assert(proto.indexOf('id="sgGoConflict"') >= 0 && proto.indexOf('openInjectManager()') >= 0, '原型体检入口同步')
    assert(cliPkg.indexOf('sgGoConflict') < 0, 'client 无残留 id 形态（React 端走字典键——本条为阴性对照）')
  })

  // ===== ③ @ 空态提示：mention.empty 行为级 eval（节 89 标记块内新行为） =====
  await t('0.4.6-C @ 空态：拉取成功零命中 → mention.empty 提示候选（无 value 不产出 chip）；拉取失败保持空数组静默', async () => {
    assert(mentionSrc.indexOf("t('mention.empty')") >= 0, 'mentions.js 引用 mention.empty')
    const grabBlock = (s, tag) => { const m = s.match(new RegExp('// ==== ' + tag + ' BEGIN ====[\\s\\S]*?// ==== ' + tag + ' END ====')); assert(m, 'clientSrc 缺标记块 ' + tag); return m && m[0] }
    const block = grabBlock(clientSrc, 'notes-mention-source')
    const mkT = (dict) => (key, vars) => { let s = dict[key]; if (s == null) s = ZH95[key]; if (s == null) return key; if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m)); return s }
    const kindLabel = (k) => mkT(ZH95)('meta.kind' + String(k || '').charAt(0).toUpperCase() + String(k || '').slice(1))
    const mkEnv = (call) => {
      const host = { call: call }
      return new Function('host', 't', 'kindLabel', 'noteRefreshListeners',
        block + '\nreturn { createNotesMentionSource: createNotesMentionSource, mentionCache: mentionCache }'
      )(host, mkT(ZH95), kindLabel, { add: () => {}, delete: () => {} })
    }
    const REQ = { query: '不存在的词', position: 'inline', drilled: false, signal: { aborted: false } }
    // 拉取成功 + 零命中 → 单条提示候选（name=字典文案 / section=笔记 / 无 value）
    const env = mkEnv(() => Promise.resolve({ notes: [{ id: 'n-1', title: '发布检查单', kind: 'note', tags: [] }] }))
    const src = env.createNotesMentionSource()
    const cands = await src.candidates({ sessionId: 'session-x' }, REQ)
    assert.strictEqual(cands.length, 1, '零命中 → 恰 1 条提示候选（实得 ' + cands.length + '）')
    assert.strictEqual(cands[0].name, ZH95['mention.empty'], '提示候选 name = mention.empty 字典文案')
    assert.strictEqual(cands[0].section, ZH95['mention.section'], '提示候选挂「笔记」分组')
    assert.strictEqual(cands[0].value, undefined, '提示候选无 value（onPick 守卫不产出 chip）')
    assert.strictEqual(src.onPick({ candidate: cands[0] }), undefined, '提示候选 onPick 不产出（纯展示行）')
    // 拉取失败（缓存 null）→ 空数组静默降级（节 89「拉取失败 → 空候选」口径不破）
    const envDown = mkEnv(() => Promise.reject(new Error('netdown')))
    assert.deepStrictEqual(await envDown.createNotesMentionSource().candidates({ sessionId: 's' }, REQ), [], '拉取失败不出提示行（静默降级）')
    // 命中正常时不掺提示行
    const cands2 = await src.candidates({ sessionId: 'session-x' }, { query: '发布', position: 'inline', drilled: false, signal: { aborted: false } })
    assert.strictEqual(cands2.length, 1, '有命中时恰候选本身（零提示行）')
    assert.strictEqual(cands2[0].value, 'n-1', '命中候选携带 value（正常 chip 链路）')
  })

  // ===== ④ 📎 徽标 tooltip 数字语义写明（节 88 PAIRS 同步更新的交叉锚） =====
  await t('0.4.6-C 📎 tooltip 语义：徽标数字 = 约定+资料合计（双字典写明 + 组件引用在位）', () => {
    assert(ZH95['injBadge.tip'] === '本会话注入：约定 {m} · 资料 {k}（徽标数字 = 两者合计；点击查看明细）', 'zh 徽标数字语义写明')
    assert(EN95['injBadge.tip'].indexOf('badge = combined total') >= 0, 'en 徽标数字语义写明')
    assert(ZH95['injBadge.tip'].indexOf('约定 {m} · 资料 {k}') >= 0, '既有「约定 M · 资料 K」结构保留（0.4.5-D 后果口径延续）')
  })

  // ===== ⑤ 面板编辑器「整理」「派发」入口在位锁定 + 窄宽根修 =====
  await t('0.4.6-C 面板 meta 动作区「整理」「派发」在位锁定（client/app/原型三端）+ meta-act 窄宽 flex-shrink:0 根修', () => {
    // 入口本就在源码中（R2 观测与实现偏差——本卡锁在位防回流；与使用说明 help.organize 承诺对齐）
    assert(edCli.indexOf("dsh-notes-meta-act dsh-notes-organize-btn") >= 0 && edCli.indexOf('openOrganizeInstruct()') >= 0, 'client 面板「整理」按钮在位')
    assert(edCli.indexOf("onClick: (ev) => { ev.stopPropagation(); openDispatch() }") >= 0, 'client 面板「派发」按钮在位')
    assert(appEmeta.indexOf('id="mOrganize"') >= 0 && appEmeta.indexOf('id="mDispatch"') >= 0, 'app meta「整理」「派发」在位（既有对齐基准）')
    assert(proto.indexOf('id="mOrganize"') >= 0 && proto.indexOf('id="mDispatch"') >= 0, '原型 meta「整理」「派发」在位')
    // 窄宽根修：flex 缺省 shrink 会把按钮文字挤没（R2「窄宽被裁」根因）——shrink:0 + nowrap 后整颗换行
    assert(stylesSrc.indexOf('.dsh-notes-meta-act{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--nt3);padding:3px 9px;border-radius:var(--nr-sm);cursor:pointer;user-select:none;font-family:var(--nfont);flex-shrink:0;white-space:nowrap}') >= 0, 'meta-act flex-shrink:0 + nowrap 锚')
    assert(cssPkg.indexOf('.dsh-notes-meta-act{') >= 0 && cssPkg.indexOf('flex-shrink:0;white-space:nowrap}') >= 0, 'lib/styles.css 产物同步（需先跑 build-dist）')
  })

  // ===== i18n 全套 + 产物同步 =====
  await t('0.4.6-C i18n：15 新键双字典齐备非空 + 占位符同形 + 产物字典同步（app.html / lib/client.js）', () => {
    const NEWKEYS = ['help.conceptTitle', 'help.conceptConvention', 'help.conceptReference', 'help.conceptMount', 'help.conceptDispatch', 'help.conceptHidden', 'help.conceptMore',
      'tree.emptyConcept', 'editor.emptyConcept', 'topbar.suggest', 'topbar.suggestTip', 'topbar.suggestTipN', 'sugg.goConflict', 'sugg.goConflictTip', 'mention.empty']
    assert.strictEqual(NEWKEYS.length, 15, '新键清单 15 条')
    for (const k of NEWKEYS) {
      assert(typeof ZH95[k] === 'string' && ZH95[k], 'zh 缺 ' + k)
      assert(typeof EN95[k] === 'string' && EN95[k], 'en 缺 ' + k)
      const pz = (ZH95[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (EN95[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
    for (const k of ["'help.conceptTitle'", "'topbar.suggest'", "'mention.empty'", "'sugg.goConflict'"]) {
      assert(cliPkg.indexOf(k) >= 0, 'lib/client.js 字典缺 ' + k + '（需先跑 build-dist）')
      assert(appHtml.indexOf(k) >= 0, 'app.html 字典缺 ' + k + '（需先跑 concat-app/build-dist）')
    }
    assert(appHtml.indexOf('id="btnSuggest"') >= 0 && appHtml.indexOf('ed-empty-concept') >= 0 && appHtml.indexOf('function suggestPendingCount') >= 0, 'app.html 产物结构锚（按钮/空态/计数函数）')
    assert(cliPkg.indexOf('dsh-notes-help-concepts') >= 0 && cliPkg.indexOf('refreshSuggestBadge') >= 0, 'lib/client.js 产物结构锚（概念节/徽标刷新）')
  })
  }
}
