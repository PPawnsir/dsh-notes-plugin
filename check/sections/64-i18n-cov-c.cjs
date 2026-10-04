// 节 64. i18n 覆盖卡 C（notes-042-i18n-cov-c：设置卡双语化）
// 规格源：反馈条目 n-mut488gske5v 覆盖卡统一方法（免调研模板）——grep 表面 [一-鿿] → 抽串进 zh.js（key=settings.*）
//   → 内联改 t()/tt()（变量 {name} 插值禁拼接）→ en.js 直译 → 断言（t( 命中≥抽串、字典双向覆盖、产物英文态抽查）。
// 表面：app modals/settings.js（t() 直读 NOTES_LANG）+ client modals/settings.js（模块函数 t() / SettingsModal 内 tt=useT() 订阅自渲染）。
// 主窗口增补（机制卡验收备注）：app 端设置卡打开态切语言卡内旧文案不即时换（render() 不重渲已开 modal）——
//   语言项 onchange 除 setLang() 外就地重渲染：先 flushSettingsPending() 兜底未落盘改动，重跑 openSettings() 按新语言重建，
//   滚动位置经 modalBackScroll 一次性还原（与二级面板返回同口径）；client 端 langStore 订阅已即时生效，仅对齐 app。
// key 复用纪律：common.settings/save/restore/loading/saveFailed、topbar.trash/topbar.trashTip、settings.language/languageTip 不重复建；
//   SET_NUM_FIELDS 第列存字典 key（加载期求值不冻语言），用时 t(key)；语言名下拉「中文/English」保持母语写法不翻译。
// 红线：原型 design/notes-ui-v2.html 不双语（零 t('settings.') 引用）；host error 文案不动；回退永不裸 key（60 节机制断言）。
module.exports = {
  id: "64",
  title: "64. i18n 覆盖C（设置卡双语化 + app 打开态切语言就地重渲染）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('64. i18n 覆盖C（设置卡双语化 + app 打开态切语言就地重渲染）')
  const zhSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
  const enSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
  const appSetSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'modals', 'settings.js'), 'utf8')
  const cliSetSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'modals', 'settings.js'), 'utf8')
  const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  // 覆盖卡 C 抽串清单（115 条 settings.* 新增；语言项 settings.language/languageTip 为机制卡既有，复用不入单）
  const KEYS = [
    'settings.closeTip', 'settings.onboardTitle', 'settings.onboardInject', 'settings.onboardRoles', 'settings.onboardCatalog', 'settings.onboardDispatch',
    'settings.followSession', 'settings.followBtn', 'settings.savedSuffix',
    'settings.llm', 'settings.llmTip',
    'settings.usage', 'settings.usageTip', 'settings.usageLine', 'settings.usageCalls', 'settings.usageByFeature', 'settings.usageEstimated', 'settings.usageLoadFailed', 'settings.usageOverBudget',
    'settings.usageBudget', 'settings.usageBudgetTip', 'settings.usageBudgetTipT',
    'settings.catalog', 'settings.catalogTip', 'settings.enabled', 'settings.disabled',
    'settings.stale', 'settings.staleTip', 'settings.staleTipT',
    'settings.maxDepth', 'settings.maxDepthTip', 'settings.maxDepthTipT',
    'settings.budget', 'settings.budgetTip', 'settings.gaugeTip', 'settings.gaugeCurrent', 'settings.gaugeBudget', 'settings.gaugeUnlimited',
    'settings.injPreview', 'settings.injPreviewTip', 'settings.injPreviewTipT', 'settings.previewBtn',
    'settings.injManager', 'settings.injManagerTip', 'settings.injManagerTipT', 'settings.manageBtn',
    'settings.data', 'settings.dataTip', 'settings.dataTipClient', 'settings.exportAll', 'settings.exportAllTip', 'settings.exportSingle', 'settings.exportSingleTip', 'settings.importBtn', 'settings.importTip',
    'settings.assets', 'settings.assetsTip', 'settings.assetsTipT', 'settings.pruneBtn',
    'settings.suggest', 'settings.suggestTip', 'settings.suggestTipClient', 'settings.suggestTipT', 'settings.openBtn',
    'settings.memory', 'settings.memoryTip', 'settings.memProbing', 'settings.memEnabled', 'settings.memView', 'settings.memViewTip', 'settings.memDisable', 'settings.memDisableTip', 'settings.memPending', 'settings.memEnable', 'settings.memEnableTip',
    'settings.logWeek', 'settings.logWeekTip', 'settings.logWeekTipT', 'settings.logMonth', 'settings.logMonthTip', 'settings.logMonthTipT',
    'settings.cheatsheet', 'settings.cheatsheetTip', 'settings.cheatsheetTipT', 'settings.viewBtn',
    'settings.saving', 'settings.restoreTip', 'settings.saveTip',
    'settings.savedLlm', 'settings.restoredFollow', 'settings.llmRequired', 'settings.catalogOn', 'settings.catalogOff',
    'settings.staleInvalid', 'settings.staleOff', 'settings.savedStale', 'settings.maxDepthInvalid', 'settings.maxDepthUnlimited', 'settings.savedMaxDepth', 'settings.budgetInvalid', 'settings.budgetOff', 'settings.savedBudget',
    'settings.logWeekInvalid', 'settings.savedLogWeek', 'settings.logMonthInvalid', 'settings.logMonthOff', 'settings.savedLogMonth',
    'settings.usageBudgetInvalid', 'settings.usageBudgetOff', 'settings.savedUsageBudget',
    'settings.savedAll', 'settings.restoredAll', 'settings.restoreFailed', 'settings.flushSaveFailed', 'settings.loadFailed',
  ]
  const grab = (s, v) => new Function(s + '\nreturn ' + v)()
  const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')

  // ===== ① 字典双向覆盖：115 条 settings.* key 双端齐备且非空；两字典全域 key 集合一致；占位符双端同形 =====
  await t('覆盖C 字典双向覆盖：115 条 settings.* key 双端齐备且非空 + 全域 key 集合一致 + 占位符同形', () => {
    assert.strictEqual(KEYS.length, 115, '抽串清单条数（实得 ' + KEYS.length + '）')
    for (const k of KEYS) {
      assert(typeof zh[k] === 'string' && zh[k], 'zh 缺 key/空值：' + k)
      assert(typeof en[k] === 'string' && en[k], 'en 缺 key/空值：' + k)
      const pz = (zh[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (en[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
    assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'en/zh 全域 key 集合一致')
    // key 复用纪律：不重建机制卡/A 卡既有 key 的 settings.* 别名
    for (const dup of ['settings.title', 'settings.save', 'settings.restore', 'settings.loading', 'settings.saveFailed', 'settings.trash'])
      assert(!(dup in zh) && !(dup in en), '复用 common.*/topbar.trash 既有 key，禁重复建别名：' + dup)
  })

  // ===== ② t()/tt() 改写命中：双表面文件域内命中数阈值 + 逐端关键锚点 =====
  await t('t()/tt() 改写命中：app/client 设置卡域内 t(/tt( 合计 ≥115（≥抽串数）+ 逐端关键锚点', () => {
    const cnt = (s) => (s.match(/[^\w]t{1,2}\('(?:settings|common|topbar)\./g) || []).length
    const ca = cnt(appSetSrc), cc = cnt(cliSetSrc)
    assert(ca >= 60, 'app settings.js 域内 t( 命中 ≥60（实得 ' + ca + '）')
    assert(cc >= 80, 'client settings.js 域内 t(/tt( 命中 ≥80（实得 ' + cc + '）')
    assert(ca + cc >= 115, '双端域内命中合计 ≥115 抽串数（实得 ' + (ca + cc) + '）')
    // app 关键锚点：标题/四概念/行标签走 t()；SET_NUM_FIELDS 登记表第 4 列为字典 key、用时 t(key)
    assert(appSetSrc.indexOf("icon('i-gear', 13) + ' ' + t('common.settings')") >= 0, 'app 设置卡标题走 t()')
    assert(appSetSrc.indexOf("t('settings.onboardTitle')") >= 0 && appSetSrc.indexOf("t('settings.onboardDispatch')") >= 0, 'app 概念速览块走 t()')
    assert(appSetSrc.indexOf("t('settings.savedAll')") >= 0 && appSetSrc.indexOf("t('common.saveFailed', { msg:") >= 0, 'app 保存/失败 toast 走 t()')
    assert(appSetSrc.indexOf("'setStale', 'stale', 'staleDays', 'settings.staleInvalid'") >= 0 && appSetSrc.indexOf('modalErr(t(SET_NUM_FIELDS[i][3]))') >= 0, 'app SET_NUM_FIELDS 登记表存字典 key + 用时 t()')
    assert(appSetSrc.indexOf("t('settings.usageLine', { today:") >= 0 && appSetSrc.indexOf("t('settings.usageOverBudget', { used:") >= 0, 'app 用量区/超预算 toast 走 t() 插值')
    // client 关键锚点：模块函数 t() + 组件 tt()；语言行保持机制卡形态
    assert(cliSetSrc.indexOf("const tt = useT()") >= 0 && cliSetSrc.indexOf('const lang = langStore.useSel') >= 0, 'client SettingsModal 订阅语言态（切换即重渲染——client 端本就即时生效）')
    assert(cliSetSrc.indexOf("{ key: 'language', label: tt('settings.language')") >= 0, 'client 语言行为 settingsRows 首行')
    assert(cliSetSrc.indexOf("label: tt('settings.llm'), sub: tt('settings.llmTip')") >= 0 && cliSetSrc.indexOf("label: tt('settings.cheatsheet'), sub: tt('settings.cheatsheetTip')") >= 0, 'client settingsRows 行 label/sub 走 tt()')
    assert(cliSetSrc.indexOf("showToast(t('settings.savedAll'))") >= 0 && cliSetSrc.indexOf("setError(t(f[2]))") >= 0, 'client 模块函数 toast/校验走 t()')
    assert(cliSetSrc.indexOf("tt('settings.usageLine', { today:") >= 0 && cliSetSrc.indexOf("tt('settings.memEnableTip')") >= 0, 'client 用量区/工作记忆控件走 tt()')
    // 复用锚点：回收站按钮/标题栏走 common.*/topbar.* 既有 key
    assert(appSetSrc.indexOf("t('topbar.trash')") >= 0 && cliSetSrc.indexOf("tt('topbar.trash')") >= 0, '回收站按钮复用 topbar.trash（双端）')
  })

  // ===== ③ 行为级：eval 字典 + app i18n 块——取值/插值/en 态逐条非裸 key/回退 =====
  await t('行为级：覆盖C key 双语取值 + {name} 插值 + en 态 115 条逐条非裸 key', () => {
    const helpersSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'helpers.js'), 'utf8')
    const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
    const mk = (stored) => new Function('localStorage', 'render', zhSrc + '\n' + enSrc + '\n' + i18nBlock + '\nreturn { t: t }')({ getItem: () => stored, setItem: () => {} }, () => {})
    const a = mk(null)
    assert.strictEqual(a.t('settings.savedAll'), '设置已保存', 'zh 缺省取值')
    assert.strictEqual(a.t('settings.savedMaxDepth', { v: 5 }), '已保存：文件夹最多嵌套 5 层', 'zh {v} 插值')
    assert.strictEqual(a.t('settings.usageCalls', { n: 3 }), '（3 次调用）', 'zh {n} 插值')
    assert.strictEqual(a.t('common.saveFailed', { msg: '网络断' }), '保存失败：网络断', '复用 common.saveFailed {msg} 插值')
    const b = mk('en')
    assert.strictEqual(b.t('settings.savedAll'), 'Settings saved', 'en 取值')
    assert.strictEqual(b.t('settings.savedMaxDepth', { v: 5 }), 'Saved: folders may nest up to 5 levels', 'en {v} 插值')
    assert.strictEqual(b.t('settings.usageCalls', { n: 3 }), ' (3 calls)', 'en {n} 插值')
    assert.strictEqual(b.t('settings.language'), 'Language', 'en 语言项 label（机制卡 key）')
    assert(b.t('settings.onboardTitle') === 'Concepts at a glance', 'en 概念速览标题')
    for (const k of KEYS) assert(b.t(k) !== k, 'en 态不得裸 key：' + k)
  })

  // ===== ④ 行为级（主窗口增补断言）：app 设置卡打开态切语言 → 卡内语言项 label 及相邻文案换新语言 =====
  // 沙箱 eval：字典 + app i18n 块 + modals/settings.js 真码（stub openModal/$/rpc/render 等；$ 按 openModal/innerHTML 注册 id 模拟 DOM 存在性）
  await t('行为级：app 设置卡打开态 onchange 切 en → 就地重渲染（openSettings 重跑）卡内 label/相邻文案换英文', async () => {
    const helpersSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'helpers.js'), 'utf8')
    const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
    const els = {}
    const mkEl = () => { let html = ''; const o = {}; Object.defineProperty(o, 'innerHTML', { get: () => html, set: (v) => { html = String(v); regIds(html) } }); o._html = () => html; return o }
    const regIds = (h) => { String(h).replace(/id="([^"]+)"/g, (m, id) => { if (!els[id]) els[id] = mkEl(); return m }) }
    const $ = (id) => els[id]
    const modalHtmls = []
    const openModal = (h) => { modalHtmls.push(String(h)); regIds(h) }
    const rpc = (method) => Promise.resolve(
      method === 'notes-settings-get' ? { settings: {}, models: [{ provider: 'p', model: 'm', label: 'p/m' }], lastInjectChars: 0 }
        : method === 'notes-usage-get' ? { error: 'sandbox' }
        : { enabled: false, noteId: '' })
    let renders = 0
    const writes = []
    const sandbox = new Function(
      'localStorage', 'render', 'openModal', '$', 'icon', 'esc', 'rpc', 'toast', 'modalErr', 'fmtTok', 'renderMemoryStatus',
      zhSrc + '\n' + enSrc + '\n' + i18nBlock
        + '\nvar modalCloseHook = null;\nvar modalBackScroll = 0;\nfunction closeModalFlushed() {}\n'
        + appSetSrc
        + '\nreturn { openSettings: openSettings, getLang: function () { return NOTES_LANG } }')
    const api = sandbox(
      { getItem: () => null, setItem: (k, v) => writes.push([k, v]) },
      () => renders++, openModal, $, () => '', (s) => String(s), rpc, () => {}, () => {}, (n) => String(n), () => {})
    api.openSettings()
    await new Promise(r => setTimeout(r, 20))
    assert(els.setBody && els.setBody._html().indexOf('>语言<span class="s">') >= 0, 'zh 态首渲：语言项 label=「语言」（实得片段 ' + (els.setBody ? els.setBody._html().slice(0, 80) : 'null') + '）')
    assert(els.setBody._html().indexOf('LLM 模型') >= 0, 'zh 态首渲：相邻「LLM 模型」行 label')
    assert.strictEqual(modalHtmls.length, 1, '首渲 openModal 一次')
    // 打开态切语言（模拟用户操作下拉）：onchange 链路 = setLang + 兜底 flush + 重跑 openSettings
    els.setLang.value = 'en'
    els.setLang.onchange.call(els.setLang)
    await new Promise(r => setTimeout(r, 20))
    assert.strictEqual(api.getLang(), 'en', '语言态切到 en（localStorage 持久化）')
    assert.deepStrictEqual(writes, [['dsh-notes-lang', 'en']], '切语言写 localStorage dsh-notes-lang')
    assert.strictEqual(modalHtmls.length, 2, '设置卡就地重渲染：openModal 重跑一次（render() 不重渲已开 modal，须重跑 openSettings）')
    assert(renders >= 1, 'setLang 触发全量 render（树/顶栏即时换语言）')
    const html2 = els.setBody._html()
    assert(html2.indexOf('>Language<span class="s">') >= 0 && html2.indexOf('>语言<span class="s">') < 0, '切 en 后语言项 label 换新语言（Language）')
    assert(html2.indexOf('LLM model') >= 0 && html2.indexOf('LLM 模型') < 0, '切 en 后相邻行文案换新语言（LLM model）')
    assert.strictEqual(els.setLang.value, 'en', '重渲染后语言下拉回显新语言态')
  })

  // ===== ⑤ 产物英文态抽查 + 原型不双语红线 =====
  await t('产物英文态抽查：app.html/lib-client 含 en 关键串 + 就地重渲染接线入产物 + 原型零 t(\'settings.\') 引用', () => {
    for (const [s, tag] of [[appSrc, 'app.html'], [clientPkgSrc, '发布包 lib/client.js']]) {
      assert(s.indexOf("'settings.savedAll': 'Settings saved'") >= 0, tag + ' en 关键串 settings.savedAll')
      assert(s.indexOf("'settings.onboardTitle': 'Concepts at a glance'") >= 0, tag + ' en 关键串 settings.onboardTitle')
      assert(s.indexOf("'settings.savedMaxDepth': 'Saved: folders may nest up to {v} levels'") >= 0, tag + ' en 关键串 settings.savedMaxDepth')
      assert(s.indexOf("'settings.memEnable': 'Enable settling guide…'") >= 0, tag + ' en 关键串 settings.memEnable')
    }
    assert(appSrc.indexOf("$('setLang').onchange = function () { setLang(this.value); flushSettingsPending();") >= 0, 'app.html 产物含切语言就地重渲染接线（需先跑 build-dist/concat-app）')
    assert(clientSrc.indexOf("t('settings.savedAll')") >= 0 && clientPkgSrc.indexOf("t('settings.savedAll')") >= 0, 'client 开发版/发布包含 settings t()（需先跑 build-dist）')
    assert(clientSrc.indexOf("tt('settings.onboardTitle')") >= 0 && clientPkgSrc.indexOf("tt('settings.onboardTitle')") >= 0, 'client 开发版/发布包 SettingsModal 含 tt()（需先跑 build-dist）')
    // 原型不双语红线：零 settings 域 t() 字典引用
    assert(protoSrc.indexOf("t('settings.") < 0 && protoSrc.indexOf("tt('settings.") < 0, '原型不双语红线：零 settings 域 t() 引用')
  })
  }
}
