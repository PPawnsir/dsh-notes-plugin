// 节 112. 0.4.8 语言切换上顶栏（notes-048-lang-topbar：用户指令 2026-10-08「语言切换放到笔记表头，不要放到设置里，建议后加一个 lang：中文/English」）
// 规格：① app 顶栏「建议」钮后 #btnLang（i-globe 图标 + 当前语言名原生写法 中文/English，点击两态直切无下拉，
//   tooltip topbar.langTip 随当前语言；复用 setLang 既有链路 = localStorage 'dsh-notes-lang' 持久化 + 全量 render，
//   renderTree 首行 renderChrome 收敛重写本钮文案）；② client 面板标题栏同构位置一枚（窄宽 <560px 视口文字收图标态，
//   tooltip 保留——.dsh-notes-tb-lang 媒体查询）；③ 设置卡语言项三端下线（SET_GROUPS general 转空组登记槽，111 节同步）；
//   ④ 原型静态同步（btnLang 仅形态演示不接线）+ 窄宽不竖排（ico-only 入 57 节既有断点）。
// 红线：零新 i18n 切换机制（复用 setLang）；顶栏其他按钮序不动（只插入）；语言态不进 settings.json/dirty 状态机。
// 真机锁：e2e ③（app 点击切换 + 刷新持久化 + 设置项消失）+ ㊼（panel 同款）+ ⑮（401px 窄宽不竖排，5 钮计数）。
module.exports = {
  id: "112",
  title: "112. 0.4.8 语言切换上顶栏（#btnLang 两态直切 + 设置卡语言项下线，双端 + 原型）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('112. 0.4.8 语言切换上顶栏（#btnLang 两态直切 + 设置卡语言项下线，双端 + 原型）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appBody = read('src/app/shell/body.html')
  const appTopbar = read('src/app/panels/topbar.js')
  const appSettings = read('src/app/modals/settings.js')
  const cliChrome = read('src/client/panels/panel/chrome.js')
  const cliSettings = read('src/client/modals/settings.js')
  const cliIcons = read('src/client/kernel/icons.js')
  const stylesSrc = read('src/styles.css')
  const protoSrc = read('design/notes-ui-v2.html')
  const appSrc = read('packages/dsh-notes-plugin/app.html')
  const clientPkgSrc = read('packages/dsh-notes-plugin/lib/client.js')
  const panelCssPkg = read('packages/dsh-notes-plugin/lib/styles.css')
  const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
  const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')

  // ===== 112.1 顶栏钮静态锚 + 序锁（建议 → 语言 → 切换主题，只插入不动他钮）=====
  await t('0.4.8 顶栏语言钮静态锚三端：建议钮后插入（序锁）+ ico-only + i-globe + title + tb-t 三齐备', () => {
    for (const [label, s] of [['app body.html', appBody], ['原型', protoSrc], ['app.html 产物', appSrc]]) {
      const bR = s.indexOf('id="btnRefresh"'), bS = s.indexOf('id="btnSuggest"'), bL = s.indexOf('id="btnLang"'), bT = s.indexOf('id="btnTheme"')
      assert(bR >= 0 && bS > bR && bL > bS && bT > bL, label + ' 顶栏按钮序：刷新 → 建议 → 语言 → 切换主题（其他钮序不动）')
      assert(/<button class="tbtn ico-only" id="btnLang" title="切换语言"><svg class="ic"><use href="#i-globe"\/><\/svg><span class="tb-t">中文<\/span><\/button>/.test(s), label + ' #btnLang = ico-only + i-globe 图标 + title 提示 + tb-t 文字（静态缺省中文态；窄宽收图标态入 57 节断点）')
    }
    /* client 标题栏：建议钮后同构位置（JSX 序锁）+ globe 图标 + tooltip/aria-label 走字典 */
    const cSug = cliChrome.indexOf('onClick: () => openSuggest()'), cLang = cliChrome.indexOf("setLang(lang === 'en' ? 'zh' : 'en')"), cHelp = cliChrome.indexOf("tt('chrome.help')")
    assert(cSug >= 0 && cLang > cSug && cHelp > cLang, 'client 标题栏按钮序：建议 → 语言 → 帮助（只插入）')
    assert(cliChrome.indexOf("I('globe', 13)") >= 0 && cliChrome.indexOf("'data-tooltip': tt('topbar.langTip')") >= 0, 'client 语言钮 globe 图标 + tooltip 走字典')
    assert(cliChrome.indexOf("lang === 'en' ? 'English' : '中文'") >= 0, 'client 语言钮文字 = 当前语言名原生写法（硬编码不翻译，同原下拉先例）')
    assert(cliChrome.indexOf("className: 'dsh-notes-tb-lang'") >= 0, 'client 语言名文字包 .dsh-notes-tb-lang（窄宽收图标态锚）')
  })

  // ===== 112.2 i-globe/globe 图标三端同形 =====
  await t('0.4.8 语言钮图标三端同形：app i-globe ⇄ 原型 i-globe ⇄ client globe（path 逐字一致）', () => {
    const PATHS = ['M3.5 12h17', 'M12 3.5c2.6 2.3 4 5.2 4 8.5s-1.4 6.2-4 8.5c-2.6-2.3-4-5.2-4-8.5S9.4 5.8 12 3.5Z']
    assert(appBody.indexOf('id="i-globe"') >= 0 && protoSrc.indexOf('id="i-globe"') >= 0, 'app/原型 i-globe symbol 在案')
    assert(cliIcons.indexOf('globe: [') >= 0, 'client icons.js globe 条目在案')
    for (const d of PATHS) {
      assert(appBody.indexOf(d) >= 0 && protoSrc.indexOf(d) >= 0 && cliIcons.indexOf(d) >= 0, '图标 path 三端同形：' + d.slice(0, 24) + '…')
    }
  })

  // ===== 112.3 i18n 键：topbar.langTip 双语 + 设置语言项 key 摘除 =====
  await t('0.4.8 i18n 键：topbar.langTip zh=切换语言/en=Switch language + settings.language/languageTip 双字典摘除', () => {
    assert(ZH['topbar.langTip'] === '切换语言' && EN['topbar.langTip'] === 'Switch language', 'topbar.langTip 双语精确值')
    assert(!('settings.language' in ZH) && !('settings.language' in EN), 'settings.language 双端摘除（设置项下线同步）')
    assert(!('settings.languageTip' in ZH) && !('settings.languageTip' in EN), 'settings.languageTip 双端摘除')
    assert.deepStrictEqual(Object.keys(EN).sort(), Object.keys(ZH).sort(), 'en/zh 全域 key 集合一致（增删同键）')
  })

  // ===== 112.4 app 行为级 eval：topbar.js 真码——装载中文态 → 点击切 en（持久化 + render + 钮文案重写）→ 再点回 zh =====
  await t('0.4.8 app 顶栏语言钮行为级（topbar.js eval）：点击两态直切 + 持久化 + renderChrome 重写 title/文字 + 他钮接线不动', () => {
    const zhSrc = read('src/i18n/zh.js'), enSrc = read('src/i18n/en.js')
    const i18nBlock = read('src/app/kernel/helpers.js').match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)[0]
    /* 元素桩：title/textContent/placeholder/innerHTML 可写；querySelector 按选择器 memo 子桩；addEventListener 捕获处理器 */
    const els = {}
    const mkEl = (id) => {
      const kids = {}
      const el = {
        id: id, title: '', textContent: '', placeholder: '', innerHTML: '', listeners: {},
        addEventListener(ev, fn) { el.listeners[ev] = fn },
        setAttribute() {}, removeAttribute() {},
        querySelector(sel) { return kids[sel] || (kids[sel] = { textContent: '', title: '' }) },
        classList: { toggle() {}, add() {}, remove() {} },
      }
      return el
    }
    const $ = (id) => els[id] || (els[id] = mkEl(id))
    const docStub = { documentElement: { style: { setProperty: function () {} } } }
    const writes = []; let renders = 0
    const holder = { chrome: null }   /* render 链：setLang → render() → renderChrome（与 renderTree 首行收敛同口径，62 节锁） */
    const sandbox = new Function(
      'localStorage', 'render', 'document', '$',
      zhSrc + '\n' + enSrc + '\n' + i18nBlock
        + '\nvar sessList = [];\nvar searchIds = null;\nvar selMode = false;\nvar selIds = {};\n'
        + 'function loadNotes() { return Promise.resolve(true) }\nfunction pullSessions() {}\nfunction toast() {}\n'
        + 'function openSuggest() {}\nfunction renderTree() {}\nfunction refreshSuggestBadge() {}\nfunction renderSuggestBadge() {}\n'
        + appTopbar
        + '\nreturn { renderChrome: renderChrome, getLang: function () { return NOTES_LANG } }')
    const api = sandbox(
      { getItem: () => null, setItem: (k, v) => writes.push([k, v]) },
      () => { renders++; if (holder.chrome) holder.chrome() },
      docStub, $)
    holder.chrome = api.renderChrome
    /* 装载即中文态（模块级 renderChrome 已跑一次）：tooltip 走 zh 字典 + 文字 = 中文 */
    assert(els.btnLang && els.btnLang.title === '切换语言', '装载 zh 态：语言钮 title=切换语言（topbar.langTip）')
    assert(els.btnLang.querySelector('.tb-t').textContent === '中文', '装载 zh 态：语言钮文字=中文（当前语言名原生写法）')
    assert(typeof els.btnLang.listeners.click === 'function', '语言钮 click 接线在案')
    /* 他钮接线零回归（序不动之外的行为面）：刷新/建议/多选处理器仍在 */
    assert(typeof els.btnRefresh.listeners.click === 'function' && typeof els.btnSuggest.listeners.click === 'function' && typeof els.btnSelMode.listeners.click === 'function', '顶栏他钮接线零回归（btnRefresh/btnSuggest/btnSelMode）')
    /* 点击 → 切 en：持久化 + 全量 render + renderChrome 重写本钮 */
    els.btnLang.listeners.click()
    assert.strictEqual(api.getLang(), 'en', '点击后语言态 = en')
    assert.deepStrictEqual(writes, [['dsh-notes-lang', 'en']], '点击写 localStorage dsh-notes-lang（持久化）')
    assert.strictEqual(renders, 1, '点击触发全量 render 一次（renderChrome 随链重写）')
    assert(els.btnLang.title === 'Switch language', 'en 态：tooltip 换 Switch language')
    assert(els.btnLang.querySelector('.tb-t').textContent === 'English', 'en 态：钮文字换 English')
    /* 再点 → 回 zh（两态循环） */
    els.btnLang.listeners.click()
    assert.strictEqual(api.getLang(), 'zh', '再点回 zh（两态直切循环）')
    assert.deepStrictEqual(writes, [['dsh-notes-lang', 'en'], ['dsh-notes-lang', 'zh']], '两次点击两次持久化')
    assert(els.btnLang.title === '切换语言' && els.btnLang.querySelector('.tb-t').textContent === '中文', '回 zh 态：title/文字还原')
  })

  // ===== 112.5 设置卡语言项下线三端（源面锚；产物锚见 60⑤/64⑤）=====
  await t('0.4.8 设置卡语言项下线三端：app 无 setSecs.language/#setLang 接线 + client 无 language 行 + 原型摘除 + general 转空组登记槽', () => {
    assert(appSettings.indexOf('setSecs.language') < 0 && appSettings.indexOf("$('setLang')") < 0, 'app settings.js：语言节 HTML + 接线全摘除')
    assert(cliSettings.indexOf("{ key: 'language'") < 0 && cliSettings.indexOf('langControl') < 0, 'client settings.js：language 行 + langControl 控件全摘除')
    assert(protoSrc.indexOf('data-sec="language"') < 0, '原型：语言行静态镜像摘除')
    /* SET_GROUPS 三端 general 转空组登记槽（组定义保留；111 节锁全覆盖一致） */
    const grabGroups = (src, label) => {
      const m = src.match(/SET_GROUPS = \[([\s\S]*?)\n\s*\];?/)
      assert(m, label + ' SET_GROUPS 常量表可提取')
      return new Function('return [' + m[1] + ']')()
    }
    for (const [label, s] of [['app', appSettings], ['client', cliSettings], ['原型', protoSrc]]) {
      assert.deepStrictEqual(grabGroups(s, label).find(g => g.id === 'general').rows, [], label + ' SET_GROUPS general.rows 空（语言节出列）')
    }
    /* client 设置卡不再直读 lang 值（useT 订阅已够重渲染）；语言态机制红线不动：仍 localStorage 本地偏好，不入 settings.json */
    assert(cliSettings.indexOf('const tt = useT()') >= 0, 'client SettingsModal useT 订阅在案')
    assert(appSettings.indexOf("'setLang', 'lang'") < 0, 'app SET_NUM_FIELDS 不含语言项（红线不变）')
  })

  // ===== 112.6 窄宽纪律 + 产物同步 =====
  await t('0.4.8 窄宽 + 产物同步：app ico-only 断点覆盖（57 节锁）+ client <560px 收图标态规则双端 + 产物含接线', () => {
    assert(stylesSrc.indexOf('@media (max-width:559px){.dsh-notes-tb-lang{display:none}}') >= 0, 'client styles.css 窄宽收语言名文字（tooltip 保留）')
    assert(panelCssPkg.indexOf('.dsh-notes-tb-lang{display:none}') >= 0, '发布包 lib/styles.css 同步窄宽规则（需先跑 build-dist）')
    assert(appSrc.indexOf("$('btnLang').addEventListener('click', function () { setLang(NOTES_LANG === 'en' ? 'zh' : 'en') })") >= 0, 'app.html 产物含语言钮接线（需先跑 concat-app/build-dist）')
    assert(clientPkgSrc.indexOf("onClick: () => setLang(lang === 'en' ? 'zh' : 'en')") >= 0 && clientPkgSrc.indexOf("I('globe', 13)") >= 0, '发布包 lib/client.js 含语言钮接线 + globe 图标')
    assert(clientPkgSrc.indexOf("const lang = langStore.useSel(s => s.lang)") >= 0, '发布包标题栏订阅语言态（切换自渲染）')
  })
  },
}
