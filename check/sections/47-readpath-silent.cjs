// 节 47. 读路径静默群 toast 补齐 + 刷新假阳性修正（R-2：notes-034-r2-silent）
// 背景（R1③ 静默清单 n-mut6u33vqt05 + 假阳性实证 n-mus81wo5l1kr 附录）：读路径 8 处空 catch / res.error 未检 → 失败零反馈；
// btnRefresh 无条件 toast('已刷新')（后端挂了也报喜）。
// 修复口径：rpc() 不 reject 业务错误（{error} 走 then），各点 then 首行显式 throw new Error(res.error) 统一进 catch；
//   读路径失败允许非阻断降级文案（「显示本地缓存」「仅显示本地过滤结果」）；弹窗场景用 modalErr（自带 mErr 缺位守卫）；
//   doSearch 防抖逐键触发 → searchErrNotified 去重闸（同一轮故障只提示一次，成功复位）；
//   ensureWikiIndex 单条失败计数不中断、整批结束一次性提示（防 4 路并发逐条刷屏）；
//   loadNotes 返回 Promise<boolean>，btnRefresh 据结果门控「已刷新」（假阳性修复）。
// 清单外白名单：probeHistCount 空 catch 保留（历史计数后台探针，失败=徽章不出现，设计内静默）。
module.exports = {
  id: "47",
  title: "47. 读路径静默群反馈 + 刷新假阳性（R-2）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('47. 读路径静默群反馈 + 刷新假阳性（R-2）')
  const APP_SRC = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const rd = (rel) => fsNative.readFileSync(path.join(DIR, 'src', 'app', rel), 'utf8')
  const F_DATA = rd('kernel/data.js'), F_STATE = rd('kernel/state.js'), F_WIKI = rd('panels/wiki.js'),
    F_SEARCH = rd('panels/search.js'), F_EMETA = rd('panels/editor-meta.js'), F_DISP = rd('modals/dispatch.js'),
    F_MEM = rd('modals/memory-guide.js'), F_INJPREV = rd('modals/inject-preview.js'), F_TOP = rd('panels/topbar.js')

  // ===== 47.1 静态断言：源文件修复标记齐全 =====
  await t('R-2 源文件修复标记齐全（throw res.error 进 catch + 各点反馈文案 + 去重闸声明 + 刷新门控）', () => {
    assert(F_DATA.indexOf('if (res && res.error) throw new Error(res.error);') >= 0
      && F_DATA.indexOf('return true') >= 0 && F_DATA.indexOf('return false') >= 0,
      'data.js loadNotes 须抛 res.error 并返回 Promise<boolean>')
    assert(F_STATE.indexOf('var searchErrNotified = false;') >= 0, 'state.js 须声明 searchErrNotified 去重闸')
    for (const pair of [
      ['wiki.js/loadFolders', F_WIKI, "t('fld.loadFailed', { msg:"],   /* i18n 覆盖卡F：文案走 t() 字典（fld.loadFailed，zh 原串在 src/i18n/zh.js） */
      ['wiki.js/pullSessions', F_WIKI, "t('mem.sessLoadFailed', { msg:"],   /* i18n 覆盖卡F：复用卡 D mem.sessLoadFailed（同下行先例） */
      ['wiki.js/ensureWikiIndex', F_WIKI, "t('wiki.idxFailed"],   /* i18n 覆盖卡F：wiki.idxFailedPartial/idxFailed 走 t() 字典 */
      ['search.js/doSearch', F_SEARCH, "t('search.offline', { msg:"],   /* i18n 覆盖卡F：文案走 t() 字典（search.offline） */
      ['editor-meta.js/refreshSelected', F_EMETA, "t('meta.refreshFailed', { msg:"],   /* i18n 覆盖卡B：文案走 t() 字典（zh 原串在 src/i18n/zh.js） */
      ['dispatch.js/pullActiveSessions', F_DISP, "t('mem.sessLoadFailed', { msg:"],   /* i18n 覆盖卡E：文案走 t() 字典（复用卡 D mem.sessLoadFailed，zh 原串在 src/i18n/zh.js） */
      ['memory-guide.js/启用弹窗会话清单', F_MEM, "t('mem.sessLoadFailed', { msg:"],   /* i18n 覆盖卡D：文案走 t() 字典（zh 原串在 src/i18n/zh.js，同上行 editor-meta 先例） */
      ['inject-preview.js/视角下拉', F_INJPREV, '会话清单加载失败'],
    ]) assert(pair[1].indexOf(pair[2]) >= 0, pair[0] + ' 缺反馈文案标记：' + pair[2])
    for (const pair of [[F_WIKI, 'wiki.js'], [F_SEARCH, 'search.js'], [F_EMETA, 'editor-meta.js'], [F_DISP, 'dispatch.js'], [F_MEM, 'memory-guide.js'], [F_INJPREV, 'inject-preview.js']])
      assert(pair[0].indexOf('throw new Error(res.error)') >= 0, pair[1] + ' 缺 res.error 显式抛错（rpc 不 reject 业务错误，不抛则 catch 永不触发）')
    assert(F_TOP.indexOf("p.then(function (ok) { if (ok) toast(t('common.refreshed')) })") >= 0, 'topbar.js btnRefresh 须等 loadNotes 结果门控「已刷新」（i18n 覆盖卡A 起走 t() 字典）')
    assert(F_TOP.indexOf("loadNotes(); if (sessList.length) pullSessions(); toast('已刷新')") < 0, 'topbar.js 不得残留无条件「已刷新」')
  })

  // ===== 47.2 静态断言：产物 app.html 同步 + 清单内空 catch 清零 =====
  await t('R-2 app.html 产物同步（concat 落盘）+ R1③ 清单空 catch 清零（仅余 probeHistCount 白名单）', () => {
    for (const mark of ['文件夹加载失败，显示本地缓存', '在线检索不可用，仅显示本地过滤结果', '笔记刷新失败，显示本地缓存', '双链索引失败', "if (ok) toast(t('common.refreshed'))"])
      assert(APP_SRC.indexOf(mark) >= 0, 'app.html 缺标记：' + mark + '（改 src/app/** 后须跑 node scripts/concat-app.cjs）')
    /* i18n 覆盖卡D/E/F：工作记忆/派发/读路径三处的「会话清单加载失败」已收进字典 mem.sessLoadFailed（zh 原串随包内嵌计 1 处）——
       产物内嵌字面量 = 注入预览 + zh.js 字典值 = 2 处；下方行为级断言（47.3 沙箱 t() 桩接真字典）兜底渲染口径 */
    assert.strictEqual((APP_SRC.match(/会话清单加载失败/g) || []).length, 2, 'app.html「会话清单加载失败」应 2 处（注入预览字面量 + zh 字典 mem.sessLoadFailed；派发/工作记忆/pullSessions 走 t() 字典——覆盖卡D/E/F）')
    const empties = APP_SRC.match(/\.catch\(function \(\) \{\}\);?/g) || []
    assert.strictEqual(empties.length, 1, 'R1③ 清单空 catch 应清零，仅余 probeHistCount 白名单 1 处（实得 ' + empties.length + '）')
    const probe = APP_SRC.match(/function probeHistCount[\s\S]*?\n}/)
    assert(probe && probe[0].indexOf('.catch(function () {});') >= 0, '白名单空 catch 须位于 probeHistCount（历史计数后台探针，失败=徽章不出现，设计内静默）')
  })

  // ===== 47.3 行为断言：mock error 逐点驱动（with(Proxy) 沙箱 eval 真实源码，模式同节 46.3）=====
  const SRC_ALL = [F_DATA, F_WIKI, F_SEARCH, F_EMETA, F_DISP, F_MEM, F_INJPREV, F_TOP].join('\n')
  function bootReadApp(rpcImpl) {
    const calls = [], toasts = [], modalErrs = []
    const els = {}
    const mkEl = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {}, contains() { return false } }, value: '', textContent: '', innerHTML: '', className: '', disabled: false, dataset: {}, _handlers: {}, addEventListener(t2, fn) { (this._handlers[t2] = this._handlers[t2] || []).push(fn) }, removeEventListener() {}, querySelector() { return mkEl() }, setAttribute() {}, querySelectorAll() { return [] }, closest() { return null }, focus() {} })
    const memRadios = [{ value: 'global', checked: true }, { value: 'workspace' }, { value: 'session' }]
    const target = {
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      notes: [], folders: [], foldOpen: {}, sessList: [], sessPending: [], scopeOpen: false,
      searchText: '', searchIds: null, searchMeta: {}, searchTimer: null, searchErrNotified: false,
      selId: null, edNote: null, edMode: 'source', richDirty: false, degraded: { ok: true, reasons: [] }, histCount: null,
      draftNote: null,   /* notes-034-batch3 新建草稿态：非草稿路径（null）不影响读路径断言（dispatch.js 草稿守卫等） */
      wikiBodies: {}, wikiIdxGen: 0,
      filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] },
      FILTER_STATUS: [{ id: 'pinned' }, { id: 'injected' }, { id: 'injectEver' }, { id: 'sensitive' }],
      view: { type: 'all', id: '' },
      document: { activeElement: null, getElementsByName: (n) => (n === 'memScope' ? memRadios : []), documentElement: { style: { setProperty: () => {} } } },   /* i18n 覆盖卡B：renderChrome 写编辑器 CSS 变量（--i18n-ed-*-ph），沙箱补 documentElement.style 桩 */
      rpc: (m, a) => { calls.push({ method: m, args: a }); return rpcImpl(m, a) },
      $: (id) => (els[id] = els[id] || mkEl()),
      toast: (m) => { toasts.push(String(m)) }, modalErr: (m) => { modalErrs.push(String(m)) },
      esc: (s) => String(s), icon: () => '',
      /* i18n 覆盖卡A/B：topbar.js/editor-meta.js 文案走 t() 字典 + 模块装载即 renderChrome()——沙箱打桩 t()（zh 字典真值 + {name} 插值）与元素 querySelector/setAttribute（mkEl 已补） */
      t: (() => { const ZH = new Function(fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8') + '\nreturn I18N_ZH')(); return (k, vars) => { let s = ZH[k]; if (s == null) return k; if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m)); return s } })(),
    }
    // with(Proxy) 沙箱：未声明标识符 → noop 函数兜底（纯函数声明模块，跨文件依赖全部经代理打桩）
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + SRC_ALL + '\n; __api = { loadNotes: loadNotes, loadFolders: loadFolders, pullSessions: pullSessions, doSearch: doSearch, refreshSelected: refreshSelected, ensureWikiIndex: ensureWikiIndex, openDispatch: openDispatch, pullActiveSessions: pullActiveSessions, openMemEnable: openMemEnable, openInjectPreview: openInjectPreview } }')(proxy)   /* 裸赋值经 proxy set 落 target */
    return { target: target, calls: calls, toasts: toasts, modalErrs: modalErrs, els: els, memRadios: memRadios, api: target.__api }
  }
  const tick47 = () => new Promise(r => setTimeout(r, 0))
  const errAll = () => Promise.resolve({ error: 'E2E模拟错误' })

  await t('R-2 行为：loadFolders mock {error} → toast「文件夹加载失败」（原空 catch 点）', async () => {
    const env = bootReadApp(errAll)
    await env.api.loadFolders()
    assert(env.toasts.some(m => m.indexOf('文件夹加载失败') === 0 && m.indexOf('E2E模拟错误') >= 0), '实得 ' + JSON.stringify(env.toasts))
  })
  await t('R-2 行为：pullSessions mock {error} → toast「会话清单加载失败」（原空 catch 点）', async () => {
    const env = bootReadApp(errAll)
    env.api.pullSessions()
    await tick47()
    assert(env.toasts.some(m => m.indexOf('会话清单加载失败') === 0), '实得 ' + JSON.stringify(env.toasts))
  })
  await t('R-2 行为：doSearch mock {error} → toast「在线检索不可用」+ 去重闸（连发仅一次，成功复位后可再提示）', async () => {
    let fail = true
    const env = bootReadApp(() => fail ? Promise.resolve({ error: 'E2E模拟错误' }) : Promise.resolve({ notes: [] }))
    env.target.searchText = '关键词'
    els_q(env).value = '关键词'   // 成功守卫 $('q').value.trim() === q
    env.api.doSearch(); await tick47()
    env.api.doSearch(); await tick47()
    assert.strictEqual(env.toasts.filter(m => m.indexOf('在线检索不可用') === 0).length, 1, '同一轮故障只提示一次（实得 ' + JSON.stringify(env.toasts) + '）')
    assert(env.target.searchErrNotified === true, '去重闸已置位')
    fail = false
    env.api.doSearch(); await tick47()
    assert(env.target.searchErrNotified === false, '成功后去重闸复位')
    fail = true
    env.api.doSearch(); await tick47()
    assert.strictEqual(env.toasts.filter(m => m.indexOf('在线检索不可用') === 0).length, 2, '复位后新一轮故障允许再提示（实得 ' + JSON.stringify(env.toasts) + '）')
  })
  await t('R-2 行为：refreshSelected mock {error} → toast「笔记刷新失败」（原空 catch 点）', async () => {
    const env = bootReadApp(errAll)
    env.target.selId = 'n1'; env.target.edNote = { id: 'n1', body: '旧正文' }
    env.api.refreshSelected()
    await tick47()
    assert(env.toasts.some(m => m.indexOf('笔记刷新失败') === 0), '实得 ' + JSON.stringify(env.toasts))
  })
  await t('R-2 行为：ensureWikiIndex 单条补缺 mock {error} → 整批一次性 toast（计数正确，不逐条刷屏）', async () => {
    const env = bootReadApp(errAll)
    env.target.notes = [{ id: 'n1', updatedAt: 'u1' }, { id: 'n2', updatedAt: 'u2' }, { id: 'n3', updatedAt: 'u3' }]
    env.api.ensureWikiIndex()
    await tick47(); await tick47(); await tick47()
    const idxToasts = env.toasts.filter(m => m.indexOf('双链索引失败') === 0)
    assert.strictEqual(idxToasts.length, 1, '整批一次性提示（实得 ' + JSON.stringify(env.toasts) + '）')
    assert(idxToasts[0].indexOf('3 条') >= 0, '失败计数正确（实得 ' + idxToasts[0] + '）')
  })
  await t('R-2 行为：派发弹窗 pullActiveSessions mock {error} → modalErr「会话清单加载失败」（原空 catch 点）', async () => {
    const env = bootReadApp(errAll)
    env.target.selId = 'n1'; env.target.edNote = { id: 'n1', title: 'T', preview: '', body: '' }
    env.api.openDispatch()
    await tick47()
    assert(env.modalErrs.some(m => m.indexOf('会话清单加载失败') === 0), '实得 ' + JSON.stringify(env.modalErrs))
  })
  await t('R-2 行为：工作记忆启用弹窗会话清单 mock {error} → modalErr（原空 catch 点）', async () => {
    const env = bootReadApp(errAll)
    env.api.openMemEnable()
    env.memRadios[1].onchange()   // 切「指定工作区」档 → 触发 notes-sessions 拉取
    await tick47()
    assert(env.modalErrs.some(m => m.indexOf('会话清单加载失败') === 0), '实得 ' + JSON.stringify(env.modalErrs))
  })
  await t('R-2 行为：注入预览视角下拉 mock {error} → modalErr（原空 catch 点）', async () => {
    const env = bootReadApp((m) => m === 'notes-sessions' ? Promise.resolve({ error: 'E2E模拟错误' }) : Promise.resolve({}))
    env.api.openInjectPreview()
    await tick47(); await tick47()
    assert(env.modalErrs.some(m => m.indexOf('会话清单加载失败') === 0), '实得 ' + JSON.stringify(env.modalErrs))
  })
  await t('R-2 行为：刷新假阳性——notes-list mock {error} 时点刷新不弹「已刷新」，弹「列表加载失败」', async () => {
    const env = bootReadApp(errAll)
    env.els.btnRefresh._handlers.click[0]()
    await tick47(); await tick47()
    assert(!env.toasts.some(m => m === '已刷新'), '失败时不得弹「已刷新」（实得 ' + JSON.stringify(env.toasts) + '）')
    assert(env.toasts.some(m => m.indexOf('列表加载失败') === 0 && m.indexOf('E2E模拟错误') >= 0), '失败须明说（实得 ' + JSON.stringify(env.toasts) + '）')
  })
  await t('R-2 行为：刷新成功路径回归——notes-list/folders 正常时点刷新仍弹「已刷新」', async () => {
    const env = bootReadApp((m) => Promise.resolve(m === 'notes-list' ? { notes: [] } : m === 'notes-folders' ? { folders: [] } : {}))
    env.els.btnRefresh._handlers.click[0]()
    await tick47(); await tick47(); await tick47()
    assert(env.toasts.some(m => m === '已刷新'), '成功时保留「已刷新」（实得 ' + JSON.stringify(env.toasts) + '）')
  })

  function els_q(env) { return env.els.q }   /* search.js 顶部 $('q') 监听注册时已自动建元素 */
  }
}
