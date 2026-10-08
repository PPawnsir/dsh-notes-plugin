// 节 116. 0.4.9 语言切换覆盖编辑器区重渲染（notes-049-lang-rerender-editor；反馈 n-muzo6h7unwty，0.4.8 活机自检实证）
// 现象：顶栏 🌐 切 EN 后顶栏/侧栏/设置全英文化，但编辑器 footer 状态行（源码模式/创建/更新/来源/已自动保存）
//   与反向链接面板（反向链接/暂无其他笔记用）滞留中文——render() 只刷树+壳（renderChrome），renderEd 只在选笔记时跑、
//   反链面板只在 wikiVer 推进时跑，两者都不在语言切换链路上。
// 修法（主窗口调研定案 b 变体）：renderEdLang() 挂进 render() 汇聚（setLang → render() 链路），
//   纯 chrome 文案原地重写（footMode/创建/更新/来源/已自动保存/同步点/源码占位/反链面板），永不重建正文 DOM——
//   在途编辑保护（0.4.7-C 假同步洞锁不回退）：dirty 态正文/IME 组合/光标零打扰；空态（无打开笔记）走 renderEd() 空态分支。
//   「已自动保存」时刻记账 edSavedAt（state.js）——doSave 落盘时记账、renderEd 重建清零（与 edSaved 空 span 初态同口径）。
// 驳回补修（首轮验收）：EN 持久化用户 reload 后静态壳 #ed 中文空态滞留（renderChrome 启动本地化不覆盖 #ed 区）——
//   bootstrap.js 启动即 renderEd()（boot 恒空态无正文可损），空态分支按 NOTES_LANG 持久态经 t() 重写（116.3b + e2e ⑳㏠⑤ 双锁）。
// client 侧零改动：editor.js tt = useT() 已订阅 langStore（useSyncExternalStore），setLang 广播即全组件自渲染（e2e ㊽ 真机锁）。
// 真机锁：e2e ⑳㏠（app：切 EN footer/反链翻转 + 在途编辑原样 + 切回 ZH + ⑤ EN 持久化 reload 空态英文）+ ㊽（panel 同款）。
module.exports = {
  id: "116",
  title: "116. 0.4.9 语言切换覆盖编辑器区重渲染（footer + 反链面板随语言翻转，在途编辑保护）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('116. 0.4.9 语言切换覆盖编辑器区重渲染（footer + 反链面板，notes-049-lang-rerender-editor）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const zhSrc = read('src/i18n/zh.js'), enSrc = read('src/i18n/en.js')
  const helpersSrc = read('src/app/kernel/helpers.js')
  const stateSrc = read('src/app/kernel/state.js')
  const appBoot = read('src/app/kernel/bootstrap.js')
  const appEd = read('src/app/panels/editor.js')
  const appMeta = read('src/app/panels/editor-meta.js')
  const appWiki = read('src/app/panels/wiki.js')
  const kernelSrc = read('src/shared/editor-kernel.js')
  const cliEd = read('src/client/panels/panel/editor.js')
  const appHtml = read('packages/dsh-notes-plugin/app.html')
  const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
  const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
  const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')

  // ===== 116.1 静态锚：render() 汇聚挂 renderEdLang + 函数体 chrome 行齐备 + edSavedAt 记账链 =====
  await t('0.4.9 静态锚：render() 汇聚挂 renderEdLang（bootstrap）+ renderEdLang chrome 行齐备（editor.js）', () => {
    assert(appBoot.indexOf('function render() { renderTree(); renderEdLang(); if (edNote) renderMeta() }') >= 0, 'bootstrap.js render() 未挂 renderEdLang（语言切换链路断）')
    assert(appEd.indexOf('function renderEdLang() {') >= 0, 'editor.js 缺 renderEdLang')
    assert(appEd.indexOf('if (!edNote) { renderEd(); return }') >= 0, '空态（无打开笔记）未走 renderEd 空态分支')
    assert(appEd.indexOf("$('footMode').textContent = edMode === 'source' ? t('editor.modeSource') : t('editor.modeRich')") >= 0, 'footMode 原地重写缺失')
    assert(appEd.indexOf("sv.textContent = t('editor.autoSaved', { time: edSavedAt })") >= 0, '「已自动保存」按记账时刻原地重写缺失')
    assert(appEd.indexOf('setSyncStatus(!!(richDirty || saveTimer));') >= 0, '同步点文案原地重写缺失')
    assert(appEd.indexOf("ta.placeholder = edBodyPending() ? t('editor.bodySyncing') : t('editor.bodyPlaceholder')") >= 0, '源码占位原地重写缺失')
    /* 函数体内含 renderEdFoot/renderBacklinks 调用（截取函数体范围防跨函数误配） */
    const fnBody = appEd.slice(appEd.indexOf('function renderEdLang() {'), appEd.indexOf('/* 编辑区事件绑定'))
    assert(fnBody.indexOf('renderEdFoot()') >= 0 && fnBody.indexOf('renderBacklinks()') >= 0, 'renderEdLang 缺 renderEdFoot/renderBacklinks 调用')
  })
  await t('0.4.9 edSavedAt 记账链：state 声明 + doSave 落盘记账 + renderEd 重建清零', () => {
    assert(stateSrc.indexOf("var edSavedAt = '';") >= 0, 'state.js 缺 edSavedAt 声明')
    assert(appEd.indexOf("(edSavedAt = new Date().toTimeString().slice(0, 5))") >= 0, 'doSave 未记账 edSavedAt（语言切换重写无数据源）')
    assert(appEd.indexOf("edSavedAt = '';   /* 0.4.9") >= 0, 'renderEd 重建未清零 edSavedAt（换笔记/换代不留旧时刻）')
  })

  // ===== 116.2 i18n 键齐备（红线：字典零改动——本卡只接重渲染，键全用存量） =====
  await t('0.4.9 i18n 键齐备：footer/反链/同步点全键双字典在案（字典零改动红线）', () => {
    for (const k of ['editor.modeSource', 'editor.modeRich', 'editor.autoSaved', 'editor.backlinks', 'editor.backlinksCount', 'editor.backlinksWarming', 'editor.backlinksEmpty', 'editor.synced', 'editor.syncing', 'editor.syncFailed', 'editor.bodySyncing', 'editor.bodyPlaceholder', 'meta.createdAt', 'meta.updatedAt', 'meta.sourceSession', 'meta.sourcePage', 'meta.draftHint']) {
      assert(typeof ZH[k] === 'string' && ZH[k] && typeof EN[k] === 'string' && EN[k], k + ' 双字典缺一')
    }
  })

  // ===== 116.3 行为级 eval：真 i18n 块 + 真 renderEdLang/renderEdFoot/renderBacklinks/setSyncStatus（46/93/103 同款 with(Proxy) 沙箱）=====
  const grabFn = (src, head, label) => {   /* 多行函数：截到列 0 '\n}' */
    const i = src.indexOf(head)
    assert(i >= 0, label + ' 缺 ' + head)
    const j = src.indexOf('\n}', i)
    assert(j > i, label + ' ' + head + ' 闭花括号定位失败')
    return src.slice(i, j + 2)
  }
  const grabLine = (src, head, label) => { /* 单行函数：截到行尾 */
    const i = src.indexOf(head)
    assert(i >= 0, label + ' 缺 ' + head)
    return src.slice(i, src.indexOf('\n', i))
  }
  function bootLang(persisted) {   /* persisted：localStorage 预置语言态（'en'/'zh'/缺省 null）——启动本地化用例模拟 EN 持久化用户 reload */
    const els = {}
    const mkEl = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {}, contains() { return false } }, value: '', textContent: '', innerHTML: '', placeholder: '', className: '', readOnly: false, contentEditable: 'true', addEventListener() {}, removeEventListener() {}, querySelectorAll() { return [] }, querySelector() { return null }, closest() { return null }, focus() {} })
    const writes = []
    const holder = { render: null }   /* render 链：setLang → render()（真实 render = renderTree+renderEdLang+renderMeta，此处收敛到 renderEdLang 探针） */
    const target = {
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      notes: [
        { id: 'n1', title: '目标页', body: '目标正文', tags: [], folder: '', kind: 'note', status: 'active', createdAt: '2026-10-01T02:03:04.000Z', updatedAt: '2026-10-02T03:04:05.000Z', sessionId: 'session-abcd1234-5678' },
        { id: 'n2', title: '引用页', body: '见 [[n1]] 即可', tags: [], folder: '', kind: 'note', status: 'active', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', sessionId: '' },
      ],
      selId: 'n1',
      edNote: null,   /* 用例内装配 */
      edBodyLoaded: true, edBodyErr: '',
      edMode: 'source', richDirty: false, saveTimer: null, composing: false,
      edSavedAt: '',
      wikiBodies: { n1: { body: '目标正文', updatedAt: '2026-10-02T03:04:05.000Z' }, n2: { body: '见 [[n1]] 即可', updatedAt: '2026-10-01T00:00:00.000Z' } },
      KCOLOR: { note: 'var(--kind-note)' },
      localStorage: { getItem: () => persisted || null, setItem: (k, v) => writes.push([k, v]) },
      render: function () { if (holder.render) holder.render() },
      renderTree() {}, renderMeta() {}, renderChrome() {},
      renderEd: function () { target.__renderEdCalls = (target.__renderEdCalls || 0) + 1 },   /* 探针：语言切换路径不得触发正文重建 */
      $: (id) => (els[id] = els[id] || mkEl()),
      toast() {}, jumpToWikiTarget() {},
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    const body = zhSrc + '\n' + enSrc + '\n' + i18nBlock + '\n'
      + grabLine(helpersSrc, 'function icon(id, sz) {', 'helpers.js') + '\n'
      + grabLine(helpersSrc, 'function fmtDT(iso) {', 'helpers.js') + '\n'
      + grabLine(helpersSrc, 'function shortSid(sid) {', 'helpers.js') + '\n'
      + grabFn(kernelSrc, 'function esc(s) {', 'editor-kernel.js') + '\n'
      + grabLine(kernelSrc, 'var WIKI_RE =', 'editor-kernel.js') + '\n'
      + grabLine(kernelSrc, 'function extractWikiTargets(text) {', 'editor-kernel.js') + '\n'
      + grabLine(kernelSrc, 'function wikiLinksTo(body, id, title) {', 'editor-kernel.js') + '\n'
      + grabLine(appEd, 'function edBodyPending() {', 'editor.js') + '\n'
      + grabFn(appEd, 'function setSyncStatus(editing) {', 'editor.js') + '\n'
      /* 真 renderEd 以异名 eval（renderEdRealBoot）——保留 target.renderEd 探针桩（语言切换零正文重建计数断言不被顶掉）；
         空态分支仅触 $/t/wikiAcClose（代理自动桩），不触正文区依赖 */
      + grabFn(appEd, 'function renderEd() {', 'editor.js').replace('function renderEd()', 'function renderEdRealBoot()') + '\n'
      + grabFn(appEd, 'function renderEdLang() {', 'editor.js') + '\n'
      + grabFn(appMeta, 'function renderEdFoot() {', 'editor-meta.js') + '\n'
      + grabFn(appWiki, 'function renderBacklinks() {', 'wiki.js') + '\n'
    new Function('scope', 'with (scope) {\n' + body + '\n; __api = { setLang: setLang, t: t, renderEdLang: renderEdLang, renderEdFoot: renderEdFoot, renderBacklinks: renderBacklinks, renderEdRealBoot: renderEdRealBoot } }')(proxy)
    holder.render = function () { target.renderTree(); target.__api.renderEdLang(); if (target.edNote) target.renderMeta() }   /* 镜像 bootstrap.js render() 汇聚口径 */
    return { target: target, els: els, writes: writes, api: target.__api }
  }
  await t('0.4.9 行为级：切 en → footer（模式/创建/更新/来源）+ 反链面板即时翻转 → 切回 zh 还原', () => {
    const env = bootLang()
    env.target.edNote = env.target.notes[0]
    env.target.edSavedAt = '21:35'
    /* zh 基线：模拟 renderEd 落定后的 chrome 初态（经 renderEdLang 补齐——同 setLang 链路同一代码路径） */
    env.api.renderEdLang()
    assert(env.els.footMode.textContent === '源码模式', 'zh 基线 footMode（实得 ' + env.els.footMode.textContent + '）')
    assert(env.els.edCreated.textContent.indexOf('创建') === 0 && env.els.edUpdated.textContent.indexOf('更新') === 0, 'zh 基线 创建/更新')
    assert(env.els.edSource.textContent === '来源 会话 abcd1234', 'zh 基线 来源（实得 ' + env.els.edSource.textContent + '）')
    assert(env.els.edSaved.textContent === '✓ 已自动保存 21:35', 'zh 基线 已自动保存（实得 ' + env.els.edSaved.textContent + '）')
    assert(env.els.syncTxt.textContent === '已同步源码', 'zh 基线 同步点（实得 ' + env.els.syncTxt.textContent + '）')
    assert(env.els.backlinksHost.innerHTML.indexOf('反向链接') >= 0 && env.els.backlinksHost.innerHTML.indexOf('引用页') >= 0, 'zh 基线 反链面板（标题 + 命中条目）')
    /* 切 en：setLang 既有链路（localStorage 持久化 + render → renderEdLang） */
    env.api.setLang('en')
    assert.deepStrictEqual(env.writes, [['dsh-notes-lang', 'en']], 'setLang 持久化口径不动')
    assert(env.els.footMode.textContent === 'Source mode', 'en footer 模式行（实得 ' + env.els.footMode.textContent + '）')
    assert(env.els.edCreated.textContent.indexOf('Created') === 0 && env.els.edUpdated.textContent.indexOf('Updated') === 0, 'en footer 创建/更新')
    assert(env.els.edSource.textContent === 'Source session abcd1234', 'en footer 来源（实得 ' + env.els.edSource.textContent + '）')
    assert(env.els.edSaved.textContent === '✓ Autosaved 21:35', 'en 已自动保存（时刻不变文案翻转；实得 ' + env.els.edSaved.textContent + '）')
    assert(env.els.syncTxt.textContent === 'Synced to source', 'en 同步点（实得 ' + env.els.syncTxt.textContent + '）')
    assert(env.els.backlinksHost.innerHTML.indexOf('Backlinks') >= 0 && env.els.backlinksHost.innerHTML.indexOf('反向链接') < 0, 'en 反链面板标题翻转（实得片段 ' + env.els.backlinksHost.innerHTML.slice(0, 90) + '）')
    assert((env.target.__renderEdCalls || 0) === 0, '语言切换全程零 renderEd 重建（正文 DOM 不动）')
    /* 切回 zh */
    env.api.setLang('zh')
    assert(env.els.footMode.textContent === '源码模式' && env.els.edSaved.textContent === '✓ 已自动保存 21:35', '切回 zh footer 还原')
    assert(env.els.backlinksHost.innerHTML.indexOf('反向链接') >= 0, '切回 zh 反链面板还原')
    assert((env.target.__renderEdCalls || 0) === 0, '切回 zh 仍零 renderEd 重建')
  })
  await t('0.4.9 在途编辑保护（行为级）：dirty 态切语言正文 DOM/正文值原样 + dirty 同步点文案翻转 + 空态走 renderEd 空态分支', () => {
    const env = bootLang()
    env.target.edNote = env.target.notes[0]
    env.target.$('edSrc')   /* 预建元素桩（renderEdLang 之前直写 value） */
    /* 造 dirty 在途：源码打字（value 与 edNote.body 同在途口径）+ debounce 在途 */
    env.els.edSrc.value = '目标正文 + 在途打字ABC'
    env.target.edNote.body = '目标正文 + 在途打字ABC'
    env.target.saveTimer = setTimeout(function () {}, 60000)   /* 模拟 900ms 窗口在途（用例内不点火） */
    env.api.renderEdLang()   /* zh 基线落 chrome */
    assert(env.els.syncTxt.textContent === '编辑中…', 'dirty 基线同步点「编辑中…」（实得 ' + env.els.syncTxt.textContent + '）')
    env.api.setLang('en')
    assert(env.els.edSrc.value === '目标正文 + 在途打字ABC' && env.target.edNote.body === '目标正文 + 在途打字ABC', '在途正文原样（textarea value + edNote.body 零改动）')
    assert((env.target.__renderEdCalls || 0) === 0, 'dirty 态切语言零正文重建（0.4.7-C 保护口径不回退）')
    assert(env.els.syncTxt.textContent === 'Editing…', 'dirty 态同步点文案随语言翻转（实得 ' + env.els.syncTxt.textContent + '）')
    assert(env.els.edSrc.placeholder === 'Body… (Markdown)', '源码 placeholder 翻转（实得 ' + env.els.edSrc.placeholder + '）')
    clearTimeout(env.target.saveTimer)
    /* 空态（无打开笔记）：走 renderEd() 空态分支（无正文可损） */
    const env2 = bootLang()
    env2.api.setLang('en')
    assert((env2.target.__renderEdCalls || 0) === 1, '空态语言切换委托 renderEd 空态分支一次（实得 ' + (env2.target.__renderEdCalls || 0) + '）')
  })

  // ===== 116.3b 驳回补修：启动本地化空态编辑器（EN 持久化用户 reload 空态滞留中文——Verifier 探针证伪面补锁） =====
  // 根因：renderChrome 启动本地化不覆盖 #ed 区，renderEd 首跑在选笔记/切语言时 → 静态壳中文空态滞留。
  // 修复：bootstrap.js 启动即 renderEd()（boot 恒空态，无正文可损）。真机锁：e2e ⑳㏠⑤（EN 持久化 reload → 空态英文）。
  await t('0.4.9 启动本地化：bootstrap 启动即 renderEd（静态锚）+ EN 持久化 boot 空态直出英文（行为级）', () => {
    /* 静态锚：loadNotes(); 之后存在启动 renderEd(); 调用行（本卡修复点） */
    const bootTail = appBoot.slice(appBoot.indexOf('loadNotes();'))
    assert(/^renderEd\(\);/m.test(bootTail), 'bootstrap.js loadNotes 后缺启动 renderEd()（EN 持久化 boot 空态滞留中文回归口）')
    /* 行为级：localStorage 预置 en → i18n 块初始化 NOTES_LANG='en' → 真 renderEd 空态分支出英文（boot 恒空态：selId/edNote 初值 null） */
    const envEn = bootLang('en')
    envEn.target.selId = null; envEn.target.edNote = null
    envEn.api.renderEdRealBoot()
    const eh = envEn.els.ed.innerHTML
    assert(envEn.els.ed.className === 'ed empty', 'EN boot 空态 class（实得 ' + envEn.els.ed.className + '）')
    assert(eh.indexOf(EN['editor.emptyTitle']) >= 0 && eh.indexOf(EN['editor.emptySub']) >= 0 && eh.indexOf(EN['editor.emptyConcept']) >= 0,
      'EN boot 空态三行英文（实得片段 ' + eh.slice(0, 90) + '）')
    assert(eh.indexOf(ZH['editor.emptyTitle']) < 0 && eh.indexOf(ZH['editor.emptySub']) < 0 && eh.indexOf(ZH['editor.emptyConcept']) < 0,
      'EN boot 空态零中文滞留（证伪面：reload 后不得再等手动切语言）')
    /* zh 缺省对照：无持久化 → 空态中文（回归防呆，缺省路径不被启动 renderEd 改写） */
    const envZh = bootLang()
    envZh.target.selId = null; envZh.target.edNote = null
    envZh.api.renderEdRealBoot()
    assert(envZh.els.ed.innerHTML.indexOf(ZH['editor.emptyTitle']) >= 0, 'zh 缺省 boot 空态中文对照')
  })

  // ===== 116.4 client 侧自查：tt = useT() 订阅 langStore → 编辑器 footer/反链随 setLang 广播自渲染（零改动锚） =====
  await t('0.4.9 client 侧零改动自查：editor.js useT 订阅在案 + footer/反链全走 tt()（langStore 广播即重渲染）', () => {
    assert(cliEd.indexOf('const tt = useT()') >= 0, 'client editor.js 缺 tt = useT()（langStore 订阅）')
    assert(cliEd.indexOf("editorMode === 'source' ? tt('editor.modeSource') : tt('editor.modeRich')") >= 0, 'client footer 模式行走 tt()')
    assert(cliEd.indexOf("tt('meta.createdAt'") >= 0 && cliEd.indexOf("tt('meta.updatedAt'") >= 0, 'client footer 创建/更新走 tt()')
    assert(cliEd.indexOf("tt('editor.autoSavedFlat'") >= 0, 'client footer 已自动保存走 tt()')
    assert(cliEd.indexOf("tt('editor.backlinks')") >= 0 && cliEd.indexOf("tt('editor.backlinksEmpty')") >= 0 && cliEd.indexOf("tt('editor.backlinksWarming')") >= 0, 'client 反链面板全量走 tt()')
  })

  // ===== 116.5 产物同步锚（改 src/app/** 后须跑 concat-app/build-dist） =====
  await t('0.4.9 产物同步：app.html 含 renderEdLang + render() 汇聚锚（需先跑 concat-app/build-dist）', () => {
    assert(appHtml.indexOf('function renderEdLang() {') >= 0, 'app.html 缺 renderEdLang（需先跑 node scripts/build-dist.cjs）')
    assert(appHtml.indexOf('function render() { renderTree(); renderEdLang(); if (edNote) renderMeta() }') >= 0, 'app.html render() 汇聚锚缺失')
    assert(appHtml.indexOf("var edSavedAt = '';") >= 0, 'app.html 缺 edSavedAt 声明')
    assert(appHtml.indexOf('启动本地化空态编辑器') >= 0, 'app.html 缺 bootstrap 启动 renderEd() 锚（驳回补修未进产物——需先跑 node scripts/build-dist.cjs）')
  })

  // ===== 116.6 红线：900ms 防抖口径/flush 链不动 + i18n 机制块 setLang 契约不动 =====
  await t('0.4.9 红线：900ms 防抖不动 + setLang 仍 = 校验+持久化+全量 render（零新切换机制）', () => {
    assert(appEd.indexOf('saveTimer = setTimeout(doSave, 900)') >= 0, 'app 自动保存 900ms 口径不得改动')
    assert(appEd.indexOf('function flushPendingSave()') >= 0, '0.4.7-C 卸载兜底 flush 在案（不回退）')
    const m = i18nBlock.match(/function setLang\(l\) \{[\s\S]*?\n\}/)
    assert(m && m[0].indexOf('render()') >= 0 && m[0].indexOf('renderEdLang') < 0, 'setLang 机制契约不动（render 入口汇聚，不在机制块内新挂点）')
  })
  }
}
