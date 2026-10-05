/* ================= 启动 ================= */
/* v3：document 级 selectionchange 挂一次（renderEd 重建编辑器 DOM 时元素级监听随元素重建，document 级不累积） */
document.addEventListener('selectionchange', function () {
  var rich = $('edRich');
  if (!rich || edMode !== 'rich') return;
  var sel = window.getSelection();
  if (sel && sel.rangeCount && rich.contains(sel.anchorNode)) { keepSel(); updateToolbarState(); }
});
/* 0.4.3⑦：日志同权 + 文件视图拆除——render 不再做日志口径翻转检测（maybeReloadForLogs 已随 data.js 一并拆除），纯渲染汇聚 */
function render() { renderTree(); if (edNote) renderMeta() }
loadNotes();
