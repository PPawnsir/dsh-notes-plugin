// 节 115. 0.4.8 注入管理过滤栏 chips + 批量条窄宽溢出修复（notes-048-injmgr-narrow-overflow：⑥卡 worker 全量共享态超范围发现，主窗口采纳另立）
// 现象：注入管理弹窗 EN + 400px 窄宽下——过滤栏 chips（「Not injected 3」）与批量条（「Disable injection」钮）溢出 modal
//   （实测 scrollW 394 vs 338，越界 56px）；根因 = chips flex-shrink:0 整排不收缩 + 栏/批量条无 flex-wrap，长文案整排越界。
//   控件栏布局问题，非说明行（⑥卡只修了说明行/调度行）。
// 修复（纯样式壳，文案零改动红线）：控件栏窄宽纪律三件套——
//   ① 过滤栏 .injmgr-bar/.dsh-notes-injmgr-bar 补 flex-wrap:wrap（chips 超宽时搜索框折下一行）；
//   ② chips 容器 .injmgr-chips/.dsh-notes-injmgr-chips 改 flex-shrink:1 + min-width:0 + flex-wrap:wrap（允许收缩+内部折行）；
//   ③ 批量条 .injmgr-batch/.dsh-notes-injmgr-batch 补 flex-wrap:wrap（三动作钮 shrink:0 整枚折行不截字）；
//   ④ 搜索框 min-width 0→120px 可用地板（面板 en@400 实测搜索框被压至 ≈3px 隐形——chips 占满时折下一行全宽，而非压扁）；
//   三端同构：app head.html + client styles.css + 原型 notes-ui-v2.html；产物经 build-dist 同步（lib/styles.css + app.html）。
// 断言：e2e ㊿（app）+ ㊿+1（panel harness）——getBoundingClientRect 边界（chips 末枚/搜索框/批量末钮右缘 ≤ modal 内容右缘）
//   + 三区无横向滚动 + 计算式纪律锁 + 宽屏单行不回归 + EN 窄宽折行实证；zh/en × 1440/400 四象限。
// 红线：文案零改动；e2e 用例号 50/51（48/49 已被 ⑥体检卡占用）、check 节号 115（114 已占）。
module.exports = {
  id: "115",
  title: "115. 0.4.8 注入管理 chips+批量条窄宽溢出修复（控件栏折行纪律 + 四象限边界断言，双端 + 原型）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('115. 0.4.8 注入管理 chips+批量条窄宽溢出修复（控件栏折行纪律，双端 + 原型）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const headSrc = read('src/app/shell/head.html')
  const stylesSrc = read('src/styles.css')
  const protoSrc = read('design/notes-ui-v2.html')
  const appInjMgr = read('src/app/modals/inject-manager.js')
  const appSrc = read('packages/dsh-notes-plugin/app.html')
  const panelCssPkg = read('packages/dsh-notes-plugin/lib/styles.css')

  /* 三件套精确锚（app 短类名 / client 前缀类名）+ 搜索框可用地板锚 */
  const BAR_A = '.injmgr-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}'
  const CHIPS_A = '.injmgr-chips{display:flex;gap:4px;flex-shrink:1;min-width:0;flex-wrap:wrap}'
  const BATCH_A = '.injmgr-batch{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11.5px;color:var(--nt2);flex-wrap:wrap}'
  const SEARCH_A = '.injmgr-search{flex:1;min-width:120px;'
  const BAR_C = '.dsh-notes-injmgr-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}'
  const CHIPS_C = '.dsh-notes-injmgr-chips{display:flex;gap:4px;flex-shrink:1;min-width:0;flex-wrap:wrap}'
  const BATCH_C = '.dsh-notes-injmgr-batch{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11.5px;color:var(--nt2);flex-wrap:wrap}'
  const SEARCH_C = '.dsh-notes-injmgr-search{flex:1;min-width:120px;'

  // ===== 115.1 app head.html：控件栏三件套 =====
  await t('0.4.8 app 控件栏窄宽纪律：.injmgr-bar/.injmgr-chips/.injmgr-batch 三规则补折行纪律', () => {
    assert(headSrc.indexOf(BAR_A) >= 0, 'head.html 过滤栏 flex-wrap 锚')
    assert(headSrc.indexOf(CHIPS_A) >= 0, 'head.html chips shrink:1+min-width:0+flex-wrap 锚')
    assert(headSrc.indexOf(BATCH_A) >= 0, 'head.html 批量条 flex-wrap 锚')
    assert(headSrc.indexOf('.injmgr-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px}') < 0, '旧无纪律过滤栏规则已替换')
    assert(headSrc.indexOf('.injmgr-chips{display:flex;gap:4px;flex-shrink:0}') < 0, '旧 chips shrink:0 规则已替换（越界根因）')
    assert(headSrc.indexOf('.injmgr-batch{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11.5px;color:var(--nt2)}') < 0, '旧无纪律批量条规则已替换')
    /* 搜索框可用地板：min-width 0→120px（chips 占满时折下一行全宽，而非压扁隐形——面板 en@400 实测搜索框被压至 ≈3px） */
    assert(headSrc.indexOf(SEARCH_A) >= 0, 'head.html 搜索框 min-width:120px 地板锚')
    assert(headSrc.indexOf('.injmgr-search{flex:1;min-width:0;') < 0, '旧搜索框 min-width:0 规则已替换')
  })

  // ===== 115.2 client styles.css：前缀类同款三件套 =====
  await t('0.4.8 client 控件栏窄宽纪律：.dsh-notes-injmgr-bar/-chips/-batch 三规则同款', () => {
    assert(stylesSrc.indexOf(BAR_C) >= 0, 'styles.css 过滤栏 flex-wrap 锚')
    assert(stylesSrc.indexOf(CHIPS_C) >= 0, 'styles.css chips shrink:1+min-width:0+flex-wrap 锚')
    assert(stylesSrc.indexOf(BATCH_C) >= 0, 'styles.css 批量条 flex-wrap 锚')
    assert(stylesSrc.indexOf('.dsh-notes-injmgr-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px}') < 0, '旧无纪律过滤栏规则已替换')
    assert(stylesSrc.indexOf('.dsh-notes-injmgr-chips{display:flex;gap:4px;flex-shrink:0}') < 0, '旧 chips shrink:0 规则已替换')
    assert(stylesSrc.indexOf('.dsh-notes-injmgr-batch{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11.5px;color:var(--nt2)}') < 0, '旧无纪律批量条规则已替换')
    assert(stylesSrc.indexOf(SEARCH_C) >= 0, 'styles.css 搜索框 min-width:120px 地板锚')
    assert(stylesSrc.indexOf('.dsh-notes-injmgr-search{flex:1;min-width:0;') < 0, '旧搜索框 min-width:0 规则已替换')
    /* markup 形态不动：client 三类引用在案（仅样式壳修复） */
    assert(clientSrc.indexOf("className: 'dsh-notes-injmgr-chips'") >= 0, 'client chips 类引用锚在案')
    assert(clientSrc.indexOf("className: 'dsh-notes-injmgr-batch'") >= 0, 'client 批量条类引用锚在案')
  })

  // ===== 115.3 原型同款 + 产物同步 =====
  await t('0.4.8 原型同款三件套 + 产物同步（app.html 双锚 / lib-styles.css 锚）', () => {
    assert(protoSrc.indexOf(BAR_A) >= 0 && protoSrc.indexOf(CHIPS_A) >= 0 && protoSrc.indexOf(BATCH_A) >= 0 && protoSrc.indexOf(SEARCH_A) >= 0, '原型控件栏三件套 + 搜索地板锚')
    assert(appSrc.indexOf(BAR_A) >= 0 && appSrc.indexOf(CHIPS_A) >= 0 && appSrc.indexOf(BATCH_A) >= 0 && appSrc.indexOf(SEARCH_A) >= 0, 'app.html 产物含三件套 + 搜索地板（需先跑 concat-app/build-dist）')
    assert(panelCssPkg.indexOf(BAR_C) >= 0 && panelCssPkg.indexOf(CHIPS_C) >= 0 && panelCssPkg.indexOf(BATCH_C) >= 0 && panelCssPkg.indexOf(SEARCH_C) >= 0, '发布包 lib/styles.css 同步三件套 + 搜索地板（需先跑 build-dist）')
    /* app markup 形态不动：bar/chips/batch 结构原样（仅样式壳修复） */
    assert(appInjMgr.indexOf('\'<div class="injmgr-bar"><div class="injmgr-chips" id="injMgrChips"></div>\'') >= 0, 'app 过滤栏 markup 形态不动')
    assert(appInjMgr.indexOf('\'<div class="injmgr-batch">\'') >= 0, 'app 批量条 markup 形态不动')
  })

  // ===== 115.4 文案零改动红线锁（双语 chips/批量条精确值原样） =====
  await t('0.4.8 红线：i18n 文案零改动（chips + 批量条双语精确值原样）', () => {
    const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
    const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')
    assert(ZH['inj.chipAll'] === '全部 {n}' && ZH['inj.chipConvention'] === '约定 {n}' && ZH['inj.chipReference'] === '资料 {n}' && ZH['inj.chipOff'] === '未注入 {n}', 'zh chips 文案原样')
    assert(EN['inj.chipAll'] === 'All {n}' && EN['inj.chipConvention'] === 'Convention {n}' && EN['inj.chipReference'] === 'Reference {n}' && EN['inj.chipOff'] === 'Not injected {n}', 'en chips 文案原样')
    assert(ZH['inj.selectAll'] === '全选' && ZH['inj.batchConvention'] === '设为约定' && ZH['inj.batchReference'] === '设为资料' && ZH['inj.batchOff'] === '关闭注入' && ZH['sel.selCount'] === '已选 {n} 条', 'zh 批量条文案原样')
    assert(EN['inj.selectAll'] === 'Select all' && EN['inj.batchConvention'] === 'Set as convention' && EN['inj.batchReference'] === 'Set as reference' && EN['inj.batchOff'] === 'Disable injection' && EN['sel.selCount'] === '{n} selected', 'en 批量条文案原样')
    /* 纪律是折行而非截字：chips/批量条规则无 nowrap/ellipsis 混入（chip 自身 nowrap 是既有单枚形态，不在锁内） */
    const barRule = headSrc.match(/\.injmgr-bar\{[^}]*\}/), batchRule = headSrc.match(/\.injmgr-batch\{[^}]*\}/)
    assert(barRule && barRule[0].indexOf('nowrap') < 0 && batchRule && batchRule[0].indexOf('nowrap') < 0, '过滤栏/批量条纪律 = 折行而非截字')
  })

  // ===== 115.5 e2e 边界断言锚（㊿ app + ㊿+1 panel） =====
  await t('0.4.8 e2e 锚：㊿ app + ㊿+1 panel 双端 400px getBoundingClientRect 边界断言用例在案', () => {
    const c50 = read('scripts/e2e/cases/50-injmgr-overflow.cjs')
    assert(c50.indexOf('#modal.injmgr') >= 0 && c50.indexOf('.injmgr-batch') >= 0, '㊿ modal + 批量条选择器锚')
    assert(c50.indexOf('getBoundingClientRect') >= 0 && c50.indexOf('width: 400') >= 0, '㊿ 矩形边界 + 400px 窄宽锚')
    assert(c50.indexOf('#btnLang') >= 0 && c50.indexOf('scrollWidth') >= 0, '㊿ en 真机切换 + 无横向滚动锚')
    const c51 = read('scripts/e2e/cases/51-panel-injmgr-overflow.cjs')
    assert(c51.indexOf("require('../panel-harness.cjs')") >= 0 && c51.indexOf('.dsh-notes-injmgr-batch') >= 0, '㊿+1 harness + 面板批量条锚')
    assert(c51.indexOf('getBoundingClientRect') >= 0 && c51.indexOf('width: 400') >= 0 && c51.indexOf('.dsh-notes-injmgr-chips') >= 0, '㊿+1 矩形边界 + 400px + chips 锚')
  })
  },
}
