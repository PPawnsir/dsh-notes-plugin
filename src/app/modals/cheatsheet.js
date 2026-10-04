/* ================= 快捷键速查表（cheat sheet，notes-034-f-cheatsheet） ================= */
/* ? 键（非输入焦点）/ 设置卡「键盘快捷键」行入口唤起；Esc / 再按 ? / ✕ / 点遮罩关闭（复用 modal 框架，Esc 由 modalHost 首段兜底）。
   键位清单与 panels/keyboard.js 实现逐键核对（R-4 口径）：增改快捷键时必须同步本表 + client 面板/原型同款表 */
var CHEATSHEET_ROWS = [
  ['Ctrl+K', '聚焦搜索框'],
  ['Alt+N', '新建笔记（Ctrl+N 是浏览器保留键「新建窗口」，页面拿不到，故改用 Alt+N）'],
  ['Ctrl+/', '编辑器 源码 ⇄ 富文本 切换（编辑中生效；弹窗打开时不切）'],
  ['j / ↓', '列表焦点下移一行'],
  ['k / ↑', '列表焦点上移一行'],
  ['Enter', '打开焦点笔记'],
  ['↓', '搜索框内：直达列表首行（保留过滤上下文，搜索 → ↓ → j/k → Enter 纯键盘路径）'],
  ['?', '唤起 / 关闭本速查表'],
  ['Esc', '分层关闭：弹层 → 排序/筛选/范围浮层 → 选区卡/右键菜单 → 退出多选 → 清搜索并还焦列表'],
];
function openCheatsheet() {
  openModal(
    '<div id="cheatsheetRoot">'
    + '<div class="modal-t">' + icon('i-kbd', 13) + ' 键盘快捷键<span class="set-t-acts"><button class="mbtn set-x" id="csClose" title="关闭（Esc / ?）">' + icon('i-x', 11) + '</button></span></div>'
    + '<div class="modal-hint">非输入焦点时生效；输入框 / 富文本内不响应 j/k、Enter、?。设置卡「键盘快捷键」行也可打开本表。</div>'
    + '<div class="cs-list">'
    + CHEATSHEET_ROWS.map(function (r) { return '<div class="cs-row"><span class="cs-keys"><kbd>' + esc(r[0]) + '</kbd></span><span class="cs-desc">' + esc(r[1]) + '</span></div>' }).join('')
    + '</div></div>'
  );
  $('csClose').onclick = closeModalFlushed;
}
