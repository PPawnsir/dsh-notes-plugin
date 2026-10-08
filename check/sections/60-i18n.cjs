// 节 60. i18n 机制（notes-042-i18n-mech：字典 + t() 双端 + 语言设置 + 回退 + 构建并入——机制卡，纯机制不改现有文案）
// 规格源：反馈条目 n-mut488gske5v 种子卡①——字典 src/i18n/zh.js+en.js（@i18n/ 前缀双端共源）；app t() 挂 kernel/helpers.js；
//   语言态 localStorage 'dsh-notes-lang'（zh 缺省），setLang 持久化 + 全量 render；client langStore + I18nContext + useT()；
//   语言切换入口 0.4.8 起上顶栏（notes-048-lang-topbar：app #btnLang / client 标题栏 globe 钮两态直切；设置卡语言项下线）；
//   回退链 = 当前语言 → zh 全量基准 → key 本身（红线：永不裸 key）。
// 测试策略：行为级 eval（字典 + app i18n 块 + client i18n 模块，stub localStorage/render/createStore/React）
//   + 产物静态锚点（三端产物含字典 / 双 manifest 登记 / 顶栏语言钮双端 + 设置项下线锚）。
module.exports = {
  id: "60",
  title: "60. i18n 机制（字典 + t() 双端 + 语言设置 + 回退 + 构建并入）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc, indexSrc } = H
  section('60. i18n 机制（字典 + t() 双端 + 语言设置 + 回退 + 构建并入）')
  const zhSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8')
  const enSrc = fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'en.js'), 'utf8')
  const helpersSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'kernel', 'helpers.js'), 'utf8')
  const clientI18nSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'kernel', 'i18n.js'), 'utf8')
  const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const i18nBlock = helpersSrc.match(/\/\* ==== i18n-mech BEGIN ====[\s\S]*?\/\* ==== i18n-mech END ==== \*\//)
  // app 侧机制行为沙箱：字典 + i18n 块（stub localStorage/render；返回 t/setLang/语言态/写盘记录/渲染计数）
  const mkApp = (stored) => {
    const writes = []; let renders = 0
    const localStorage = { getItem: () => stored, setItem: (k, v) => writes.push([k, v]) }
    const fn = new Function('localStorage', 'render', zhSrc + '\n' + enSrc + '\n' + (i18nBlock ? i18nBlock[0] : '') + '\nreturn { t: t, setLang: setLang, getLang: function () { return NOTES_LANG } }')
    return Object.assign(fn(localStorage, () => renders++), { writes, renders: () => renders })
  }
  // client 侧机制行为沙箱：字典 + kernel/i18n.js（stub createStore/React——只验非 hook 通道 t/tLookup/setLang）
  const mkClient = (stored) => {
    const writes = []
    const createStore = (slice) => ({ get: () => slice, set: (p) => { Object.assign(slice, p) }, subscribe: () => () => {}, useSel: (sel) => sel(slice) })
    const React = { createContext: () => ({}), useContext: () => null }
    const localStorage = { getItem: () => stored, setItem: (k, v) => writes.push([k, v]) }
    const fn = new Function('React', 'createStore', 'localStorage', zhSrc + '\n' + enSrc + '\n' + clientI18nSrc + '\nreturn { t: t, setLang: setLang, tLookup: tLookup, langStore: langStore }')
    return Object.assign(fn(React, createStore, localStorage), { writes })
  }

  // ===== ① 字典骨架：zh/en 双字典 + key 集合一致 + ≥20 条高频示例（topbar.*/common.*）=====
  await t('i18n 字典骨架：zh/en 双字典 key 集合一致且 ≥20 条（topbar.*/common.* 高频示例）', () => {
    const grab = (s, v) => new Function(s + '\nreturn ' + v)()
    const zh = grab(zhSrc, 'I18N_ZH'), en = grab(enSrc, 'I18N_EN')
    const kz = Object.keys(zh).sort(), ke = Object.keys(en).sort()
    assert(kz.length >= 20, 'zh 字典 ≥20 条示例（实得 ' + kz.length + '）')
    assert.deepStrictEqual(ke, kz, 'en/zh key 集合一致（守卫卡另有双向 ⊆ 代码引用断言）')
    assert(kz.some(k => k.indexOf('topbar.') === 0) && kz.some(k => k.indexOf('common.') === 0), '含 topbar.*/common.* 示例域')
    assert(kz.indexOf('topbar.langTip') >= 0, '含顶栏语言钮 tooltip key（0.4.8 notes-048-lang-topbar；原 settings.language/languageTip 随设置卡语言项下线摘除）')
    assert(kz.indexOf('settings.language') < 0 && kz.indexOf('settings.languageTip') < 0, '设置卡语言项 key 已摘除（0.4.8 切换入口上顶栏）')
    assert(zh['common.saveFailed'].indexOf('{msg}') >= 0 && en['common.saveFailed'].indexOf('{msg}') >= 0, '插值示例双端同占位符 {msg}')
    for (const k of kz) { assert(typeof zh[k] === 'string' && zh[k] && typeof en[k] === 'string' && en[k], k + ' 双端值非空字符串') }
  })

  // ===== ② t(key,vars) 行为级（双端同口径）：取值 / {name} 插值 / 回退链 en→zh→key / 非法语言拒绝 =====
  await t('t() 行为级（app + client 同口径）：取值 / {name} 插值 / 回退 zh→key / 非法语言拒绝', () => {
    for (const [mk, tag] of [[mkApp, 'app'], [mkClient, 'client']]) {
      const a = mk(null)
      assert.strictEqual(a.t('topbar.refresh'), '刷新', tag + ' zh 缺省取值')
      assert.strictEqual(a.t('common.saveFailed', { msg: '网络断' }), tag === 'app' ? '保存失败：网络断' : '保存失败：网络断', tag + ' {msg} 插值')
      a.setLang('en')
      assert.strictEqual(a.t('topbar.refresh'), 'Refresh', tag + ' 切 en 取值')
      assert.strictEqual(a.t('common.saveFailed', { msg: 'boom' }), 'Save failed: boom', tag + ' en 插值')
      a.setLang('fr')
      assert.strictEqual(a.t('topbar.refresh'), 'Refresh', tag + ' 非法语言值拒绝（保持 en）')
    }
    // 回退链：en 字典缺 key → zh 原文（模拟 en 摘键）；双缺 → key 本身（红线：永不裸 key 的兜底尽头）
    const enCut = enSrc.replace(/\n  'topbar\.refresh': '[^']*',/, '')
    assert(enCut !== enSrc, 'en 摘键模拟生效')
    const fn = new Function('localStorage', 'render', zhSrc + '\n' + enCut + '\n' + i18nBlock[0] + '\nreturn { t: t }')
    const c = fn({ getItem: () => 'en', setItem: () => {} }, () => {})
    assert.strictEqual(c.t('topbar.refresh'), '刷新', 'en 缺 key 回退 zh 原文')
    assert.strictEqual(c.t('no.such.key'), 'no.such.key', '双缺兜底返回 key 本身')
  })

  // ===== ③ 语言态持久化 + 切换 + 全量 render（localStorage 'dsh-notes-lang'，zh 缺省）=====
  await t('语言态：localStorage dsh-notes-lang 持久化（zh 缺省）+ setLang 全量 render + 启动读回', () => {
    const a = mkApp(null)
    assert.strictEqual(a.getLang(), 'zh', '无持久化缺省 zh')
    a.setLang('en')
    assert.deepStrictEqual(a.writes, [['dsh-notes-lang', 'en']], 'setLang 写 localStorage dsh-notes-lang')
    assert.strictEqual(a.renders(), 1, 'setLang 触发全量 render 一次')
    const b = mkApp('en')
    assert.strictEqual(b.getLang(), 'en', '启动读回持久化 en')
    const d = mkApp('fr')
    assert.strictEqual(d.getLang(), 'zh', '脏持久化值归一 zh（防御）')
    const cl = mkClient('en')
    assert.strictEqual(cl.langStore.get().lang, 'en', 'client 启动读回持久化 en')
    cl.setLang('zh')
    assert.strictEqual(cl.langStore.get().lang, 'zh', 'client setLang 更新 langStore（订阅者自渲染）')
    assert.deepStrictEqual(cl.writes, [['dsh-notes-lang', 'zh']], 'client setLang 持久化同 key')
  })

  // ===== ④ 构建并入：双 manifest 登记 @i18n + 三端产物含字典 + client 机制锚点 =====
  await t('构建并入：双 manifest 登记 @i18n + app.html/lib-client 产物含字典 + index.mjs 运行时解析 @i18n', () => {
    const appManifest = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'manifest.js'), 'utf8')
    const clientManifest = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'manifest.js'), 'utf8')
    assert(appManifest.indexOf("'@i18n/zh.js'") >= 0 && appManifest.indexOf("'@i18n/en.js'") >= 0, 'app manifest 登记 @i18n 双字典')
    assert(clientManifest.indexOf("'@i18n/zh.js'") >= 0 && clientManifest.indexOf("'@i18n/en.js'") >= 0, 'client manifest 登记 @i18n 双字典')
    // 序位：字典先于消费方（app：helpers.js 之前；client：kernel/i18n.js 之前且晚于 state.js——createStore 依赖）
    assert(appManifest.indexOf("'@i18n/zh.js'") < appManifest.indexOf("'kernel/helpers.js'"), 'app 字典序位 ≺ helpers.js')
    assert(clientManifest.indexOf("'kernel/state.js'") < clientManifest.indexOf("'@i18n/zh.js'"), 'client 字典序位 ≻ state.js（createStore）')
    assert(clientManifest.indexOf("'@i18n/en.js'") < clientManifest.indexOf("'kernel/i18n.js'"), 'client 字典序位 ≺ kernel/i18n.js')
    // 产物含字典（app.html 列 0 / lib-client 基座缩进）
    assert(appSrc.indexOf('var I18N_ZH = {') >= 0 && appSrc.indexOf('var I18N_EN = {') >= 0, 'app.html 含双字典（列 0 原样）')
    assert(clientSrc.indexOf('    var I18N_ZH = {') >= 0 && clientSrc.indexOf('    var I18N_EN = {') >= 0, 'client 开发版含双字典（4 空格基座缩进）')
    assert(clientPkgSrc.indexOf('    var I18N_ZH = {') >= 0 && clientPkgSrc.indexOf('    var I18N_EN = {') >= 0, '发布包 lib/client.js 含双字典')
    // en 关键串抽查（产物英文态素材在包内）
    assert(appSrc.indexOf("'topbar.refresh': '刷新'") >= 0 && appSrc.indexOf("'topbar.refresh': 'Refresh'") >= 0, 'app.html 双语言关键串')
    assert(clientPkgSrc.indexOf("'common.save': 'Save'") >= 0, 'lib/client.js en 关键串')
    // client 机制锚点（开发版 + 发布包）：langStore / tLookup 回退链 / I18nContext / useT / setLang
    for (const [s, tag] of [[clientSrc, 'client 开发版'], [clientPkgSrc, '发布包 lib/client.js']]) {
      assert(s.indexOf("const I18N_LANG_KEY = 'dsh-notes-lang'") >= 0, tag + ' 语言态 key 常量')
      assert(s.indexOf('const langStore = createStore({ lang: loadLang() })') >= 0, tag + ' langStore 语言态切片')
      assert(s.indexOf('function tLookup(lang, key, vars)') >= 0 && s.indexOf('if (s == null) s = I18N_ZH[key]') >= 0 && s.indexOf('if (s == null) return key') >= 0, tag + ' tLookup 回退链 zh→key')
      assert(s.indexOf('const I18nContext = React.createContext(null)') >= 0 && s.indexOf('function useT()') >= 0, tag + ' I18nContext + useT()')
      assert(s.indexOf('function setLang(l)') >= 0 && s.indexOf("localStorage.setItem(I18N_LANG_KEY, l)") >= 0 && s.indexOf('langStore.set({ lang: l })') >= 0, tag + ' setLang 持久化 + store 广播')
    }
    // 运行时源下发（开发版 host + 发布包 host）@i18n 解析分支
    const srvDev = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'server.js'), 'utf8')
    assert(srvDev.indexOf("@i18n/") >= 0 && srvDev.indexOf("'\\\\src\\\\i18n\\\\'") >= 0, 'server.js notes-src 含 @i18n 解析')
    assert(indexSrc.indexOf("@i18n/") >= 0, 'index.mjs（server.dist.js 拼接产物）notes-src 含 @i18n 解析')
  })

  // ===== ⑤ 顶栏语言切换钮双端 + 设置卡语言项下线（0.4.8 notes-048-lang-topbar）=====
  await t('顶栏语言钮双端 + 设置卡语言项下线：app #btnLang 两态直切接线 + client 标题栏 globe 钮 + 设置项三端摘除（不入 dirty）', () => {
    // app（产物 app.html 口径，防忘跑 concat-app/build-dist）：按钮在「建议」后（序锁）+ ico-only + i-globe + 接线走 setLang 既有链路
    const bS = appSrc.indexOf('id="btnSuggest"'), bL = appSrc.indexOf('id="btnLang"'), bT = appSrc.indexOf('id="btnTheme"')
    assert(bS >= 0 && bL > bS && bT > bL, 'app 顶栏按钮序：建议 → 语言 → 切换主题（只插入不动他钮）')
    assert(/<button class="tbtn ico-only" id="btnLang" title="切换语言"><svg class="ic"><use href="#i-globe"\/><\/svg><span class="tb-t">中文<\/span><\/button>/.test(appSrc), 'app #btnLang 静态锚（ico-only + i-globe + title + tb-t 中文缺省）')
    assert(appSrc.indexOf("$('btnLang').addEventListener('click', function () { setLang(NOTES_LANG === 'en' ? 'zh' : 'en') })") >= 0, 'app #btnLang 点击接线 = setLang 两态直切（复用既有链路，零新机制）')
    assert(appSrc.indexOf("$('btnLang').title = t('topbar.langTip')") >= 0 && appSrc.indexOf("$('btnLang').querySelector('.tb-t').textContent = NOTES_LANG === 'en' ? 'English' : '中文'") >= 0, 'app renderChrome 重写语言钮 title/文字（setLang→render 全量刷新路径收敛）')
    // client（开发版 + 发布包）：标题栏建议钮后 globe 钮（setLang 两态直切 + tt('topbar.langTip') + 语言名原生写法）
    for (const [s, tag] of [[clientSrc, 'client 开发版'], [clientPkgSrc, '发布包 lib/client.js']]) {
      assert(s.indexOf("onClick: () => setLang(lang === 'en' ? 'zh' : 'en')") >= 0, tag + ' 标题栏语言钮接线 = setLang 两态直切')
      assert(s.indexOf("I('globe', 13)") >= 0 && s.indexOf("tt('topbar.langTip')") >= 0, tag + ' 语言钮 globe 图标 + tooltip 走字典')
      assert(s.indexOf("lang === 'en' ? 'English' : '中文'") >= 0, tag + ' 语言钮文字 = 当前语言名原生写法（硬编码不翻译）')
      assert(s.indexOf("const lang = langStore.useSel(s => s.lang)") >= 0, tag + ' 标题栏订阅语言态（切换自渲染）')
    }
    // 设置卡语言项下线（双端 + 原型）：app 无 #setLang/data-sec="language"；client 无 language 行；原型同步摘除
    assert(appSrc.indexOf('id="setLang"') < 0 && appSrc.indexOf('data-sec="language"') < 0, 'app 设置卡语言项已下线（产物口径）')
    assert(clientSrc.indexOf("{ key: 'language'") < 0 && clientPkgSrc.indexOf("{ key: 'language'") < 0, 'client settingsRows 语言行已摘除（开发版 + 发布包）')
    const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    assert(protoSrc.indexOf('data-sec="language"') < 0 && protoSrc.indexOf('id="btnLang"') >= 0, '原型：语言行摘除 + 顶栏钮静态同步')
    // 纯机制红线：语言态不进 settings.json 通道（app 端 SET_NUM_FIELDS/setSnap 零 lang 键）
    assert(appSrc.indexOf("'setLang', 'lang'") < 0, 'app dirty 数值字段表不含语言项（本地偏好非设置 RPC）')
  })
  }
}
