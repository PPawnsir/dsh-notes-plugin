/* ================= 快捷键速查表（cheat sheet，notes-034-f-cheatsheet） ================= */
/* ? 键（非输入焦点）/ 设置卡「键盘快捷键」行入口唤起；Esc / 再按 ? / ✕ / 点遮罩关闭（复用 modal 框架，Esc 由 modalHost 首段兜底）。
   键位清单与 panels/keyboard.js 实现逐键核对（R-4 口径）：增改快捷键时必须同步本表 + client 面板/原型同款表 */
/* 说明列 = 字典 key（cheat.*），渲染期 t() 取值（i18n 覆盖卡E；原型 notes-ui-v2.html 不双语红线保持静态中文） */
var CHEATSHEET_ROWS = [
  ['Ctrl+K', 'cheat.kSearch'],
  ['Alt+N', 'cheat.kNew'],
  ['Ctrl+/', 'cheat.kMode'],
  ['j / ↓', 'cheat.kDown'],
  ['k / ↑', 'cheat.kUp'],
  ['Enter', 'cheat.kOpen'],
  ['↓', 'cheat.kSearchDown'],
  ['?', 'cheat.kSelf'],
  ['Esc', 'cheat.kEsc'],
];
function openCheatsheet() {
  openModal(
    '<div id="cheatsheetRoot">'
    + '<div class="modal-t">' + icon('i-kbd', 13) + ' ' + t('settings.cheatsheet') + '<span class="set-t-acts"><button class="mbtn set-x" id="csClose" title="' + t('cheat.closeTip') + '">' + icon('i-x', 11) + '</button></span></div>'
    + '<div class="modal-hint">' + t('cheat.hint') + '</div>'
    + '<div class="cs-list">'
    + CHEATSHEET_ROWS.map(function (r) { return '<div class="cs-row"><span class="cs-keys"><kbd>' + esc(r[0]) + '</kbd></span><span class="cs-desc">' + esc(t(r[1])) + '</span></div>' }).join('')
    + '</div></div>'
  );
  $('csClose').onclick = closeModalFlushed;
}
