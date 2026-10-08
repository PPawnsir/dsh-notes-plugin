// 节 114. 0.4.8 约定体检卡说明文字溢出修复（notes-048-conflict-card-overflow：用户截图实证 2026-10-08）
// 现象：注入管理「约定体检」行——标题 + 说明 inj.conflictTitleSub +「开始体检」钮一行排开，说明不换行溢出卡片；
//   根因 = flex 项缺省 min-width:auto，遇长不可断 token 不收缩即越界（80 字符纯字母 token 复现越界 174px）。
// 修复（纯样式壳，文案零改动红线）：说明行换行纪律四件套 flex:1 1 auto + min-width:0 + overflow-wrap:break-word + word-break:break-word——
//   ① app head.html：.conflict-sec-t .sub + .sched-sec-t .sub（调度区说明行同款隐患一并同修）；
//   ② client styles.css：.dsh-notes-sched-sec-sub（调度区/体检卡共用一类，一改两收）；
//   ③ 原型 notes-ui-v2.html：同款两条（与 app 逐字同构）。
// 顺带同修（同弹窗同类隐患扫描实锤）：调度行 .sched-row/.dsh-notes-sched-row 补 flex-wrap:wrap——全量 e2e 共享态（有调度行）下
//   EN/400px 窄宽动作区+失败徽章越界实锤（scrollW 562 vs clientW 304）；conflict-row 已有 flex-wrap 先例。
// 断言：e2e ㊽（app）+ ㊾（panel harness）——getBoundingClientRect 边界 + 双卡无横向滚动 + 计算式纪律锁 + zh/en × 1440/400 矩阵。
// 红线：只动样式/布局壳；与在跑卡零文件冲突（本卡只碰 inject-manager 样式锚 + 样式表 + 原型）。
module.exports = {
  id: "114",
  title: "114. 0.4.8 约定体检卡说明文字溢出修复（说明行换行纪律 + 窄宽边界断言，双端 + 原型）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('114. 0.4.8 约定体检卡说明文字溢出修复（说明行换行纪律，双端 + 原型）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const headSrc = read('src/app/shell/head.html')
  const stylesSrc = read('src/styles.css')
  const protoSrc = read('design/notes-ui-v2.html')
  const appInjMgr = read('src/app/modals/inject-manager.js')
  const appSrc = read('packages/dsh-notes-plugin/app.html')
  const panelCssPkg = read('packages/dsh-notes-plugin/lib/styles.css')

  const DISC = 'flex:1 1 auto;min-width:0;overflow-wrap:break-word;word-break:break-word'   /* 换行纪律四件套（三端逐字同构锚） */

  // ===== 114.1 app head.html：体检卡 + 调度区说明行双修 =====
  await t('0.4.8 app 说明行换行纪律：.conflict-sec-t .sub + .sched-sec-t .sub 双规则补 flex:1/min-width:0/break-word', () => {
    assert(headSrc.indexOf('.conflict-sec-t .sub{font-weight:400;color:var(--nt3);font-size:10px;margin-left:4px;' + DISC + '}') >= 0, 'head.html 体检卡说明行纪律锚')
    assert(headSrc.indexOf('.sched-sec-t .sub{font-weight:400;color:var(--nt3);font-size:10px;margin-left:4px;' + DISC + '}') >= 0, 'head.html 调度区说明行纪律锚（同款隐患同修）')
    assert(headSrc.indexOf('.conflict-sec-t .sub{font-weight:400;color:var(--nt3);font-size:10px;margin-left:4px}') < 0, '旧无纪律规则已替换（体检卡）')
    assert(headSrc.indexOf('.sched-sec-t .sub{font-weight:400;color:var(--nt3);font-size:10px;margin-left:4px}') < 0, '旧无纪律规则已替换（调度区）')
  })

  // ===== 114.2 client styles.css：共用类一改两收 =====
  await t('0.4.8 client 说明行换行纪律：.dsh-notes-sched-sec-sub（调度区/体检卡共用）补同款四件套', () => {
    assert(stylesSrc.indexOf('.dsh-notes-sched-sec-sub{font-weight:400;color:var(--nt3);font-size:10px;margin-left:4px;' + DISC + '}') >= 0, 'styles.css 说明行纪律锚')
    assert(stylesSrc.indexOf('.dsh-notes-sched-sec-sub{font-weight:400;color:var(--nt3);font-size:10px;margin-left:4px}') < 0, '旧无纪律规则已替换')
    /* 共用类覆盖锁：client markup 两处引用（调度区头 + 体检卡头） */
    assert(clientSrc.indexOf("className: 'dsh-notes-sched-sec-sub'") >= 0, 'client 说明行类引用锚在案')
    const hits = clientSrc.match(/dsh-notes-sched-sec-sub/g) || []
    assert(hits.length >= 2, 'client 说明行类至少两处引用（sched-sec-t + conflict-sec-t），实得 ' + hits.length)
  })

  // ===== 114.3 原型同款 + 产物同步 =====
  await t('0.4.8 原型同款双规则 + 产物同步（app.html 双锚 / lib-styles.css 锚）', () => {
    assert(protoSrc.indexOf('.conflict-sec-t .sub{font-weight:400;color:var(--nt3);font-size:10px;margin-left:4px;' + DISC + '}') >= 0, '原型体检卡说明行纪律锚')
    assert(protoSrc.indexOf('.sched-sec-t .sub{font-weight:400;color:var(--nt3);font-size:10px;margin-left:4px;' + DISC + '}') >= 0, '原型调度区说明行纪律锚')
    assert(appSrc.indexOf('.conflict-sec-t .sub{') >= 0 && appSrc.indexOf(DISC) >= 0, 'app.html 产物含说明行纪律（需先跑 concat-app）')
    assert(appSrc.split(DISC).length - 1 >= 2, 'app.html 产物纪律串至少两处（体检卡 + 调度区）')
    assert(panelCssPkg.indexOf('.dsh-notes-sched-sec-sub{font-weight:400;color:var(--nt3);font-size:10px;margin-left:4px;' + DISC + '}') >= 0, '发布包 lib/styles.css 同步说明行纪律（需先跑 build-dist）')
  })

  // ===== 114.3b 顺带同修（同弹窗同类隐患扫描实锤）：调度行补 flex-wrap——窄宽/EN 长徽章（失败 2026-10-08 22:05 + 三动作钮 shrink:0）溢出行实锤越界 256px =====
  await t('0.4.8 调度行折行纪律：.sched-row/.dsh-notes-sched-row 补 flex-wrap:wrap（conflict-row 同款先例，三端同构）', () => {
    assert(headSrc.indexOf('.sched-row{display:flex;align-items:center;gap:8px;padding:6px 9px;font-size:11.5px;border-bottom:1px solid var(--nbd-soft);flex-wrap:wrap}') >= 0, 'head.html 调度行 flex-wrap 锚')
    assert(stylesSrc.indexOf('.dsh-notes-sched-row{display:flex;align-items:center;gap:8px;padding:6px 9px;font-size:11.5px;border-bottom:1px solid var(--nbd-soft);flex-wrap:wrap}') >= 0, 'styles.css 调度行 flex-wrap 锚')
    assert(protoSrc.indexOf('.sched-row{display:flex;align-items:center;gap:8px;padding:6px 9px;font-size:11.5px;border-bottom:1px solid var(--nbd-soft);flex-wrap:wrap}') >= 0, '原型调度行 flex-wrap 锚')
    assert(headSrc.indexOf('.conflict-row{display:flex;align-items:center;gap:8px;padding:6px 9px;font-size:11.5px;border-bottom:1px solid var(--nbd-soft);flex-wrap:wrap}') >= 0, 'conflict-row 既有 flex-wrap 先例不动')
    assert(appSrc.indexOf('.sched-row{display:flex;align-items:center;gap:8px;padding:6px 9px;font-size:11.5px;border-bottom:1px solid var(--nbd-soft);flex-wrap:wrap}') >= 0, 'app.html 产物含调度行 flex-wrap（需先跑 concat-app）')
    assert(panelCssPkg.indexOf('.dsh-notes-sched-row{display:flex;align-items:center;gap:8px;padding:6px 9px;font-size:11.5px;border-bottom:1px solid var(--nbd-soft);flex-wrap:wrap}') >= 0, '发布包 lib/styles.css 同步调度行 flex-wrap')
  })

  // ===== 114.4 文案零改动红线锁 + markup 形态不动 =====
  await t('0.4.8 红线：i18n 文案零改动（双语 sub 精确值原样）+ 说明行 markup 形态不动（仅样式壳修复）', () => {
    const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
    const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')
    assert(ZH['inj.conflictTitleSub'] === 'LLM 两两检测注入中约定的冲突/取代 · 只提名不执行', 'zh 体检卡说明文案原样')
    assert(EN['inj.conflictTitleSub'] === 'LLM pairwise conflict/supersede check on injected conventions · nominations only', 'en 体检卡说明文案原样')
    assert(ZH['inj.schedTitleSub'] === '定时派发约定 · 声明在 front-matter（contractType: dispatch-schedule），裸编辑即开发者旁路', 'zh 调度区说明文案原样')
    assert(EN['inj.schedTitleSub'] === 'Scheduled-dispatch conventions · declared in front-matter (contractType: dispatch-schedule); raw editing is the developer bypass', 'en 调度区说明文案原样')
    /* markup 形态不动：app 仍 <span class="sub"> 内联标题行（未改纵向布局），client 仍 sched-sec-sub 共用类 */
    assert(appInjMgr.indexOf('\'<span class="sub">\' + t(\'inj.conflictTitleSub\')') >= 0, 'app 体检卡说明行 markup 形态不动')
    assert(appInjMgr.indexOf('\'<span class="sub">\' + t(\'inj.schedTitleSub\')') >= 0, 'app 调度区说明行 markup 形态不动')
    /* 纪律不带 nowrap 回退（防截字式「修复」混入） */
    const rule = headSrc.match(/\.conflict-sec-t \.sub\{[^}]*\}/)
    assert(rule && rule[0].indexOf('nowrap') < 0 && rule[0].indexOf('text-overflow') < 0, '体检卡说明行纪律 = 折行而非截字（无 nowrap/ellipsis）')
  })

  // ===== 114.5 e2e 边界断言锚（㊽ app + ㊾ panel） =====
  await t('0.4.8 e2e 锚：㊽ app + ㊾ panel 双端 400px getBoundingClientRect 边界断言用例在案', () => {
    const c48 = read('scripts/e2e/cases/48-conflict-card-overflow.cjs')
    assert(c48.indexOf('#injConflictHost .conflict-sec') >= 0 && c48.indexOf('#injSchedHost .sched-sec') >= 0, '㊽ 双卡选择器锚')
    assert(c48.indexOf('getBoundingClientRect') >= 0 && c48.indexOf('width: 400') >= 0, '㊽ 矩形边界 + 400px 窄宽锚')
    assert(c48.indexOf('#btnLang') >= 0 && c48.indexOf('scrollWidth <= cSec.clientWidth') >= 0, '㊽ en 真机切换 + 无横向滚动锚')
    const c49 = read('scripts/e2e/cases/49-panel-conflict-card-overflow.cjs')
    assert(c49.indexOf("require('../panel-harness.cjs')") >= 0 && c49.indexOf('.dsh-notes-injmgr-modal .dsh-notes-conflict-sec') >= 0, '㊾ harness + 面板体检卡锚')
    assert(c49.indexOf('getBoundingClientRect') >= 0 && c49.indexOf('width: 400') >= 0 && c49.indexOf('.dsh-notes-sched-sec-sub') >= 0, '㊾ 矩形边界 + 400px + 共用类锚')
  })
  },
}
