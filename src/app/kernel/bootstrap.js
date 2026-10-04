/* ================= 启动 ================= */
/* v3：document 级 selectionchange 挂一次（renderEd 重建编辑器 DOM 时元素级监听随元素重建，document 级不累积） */
document.addEventListener('selectionchange', function () {
  var rich = $('edRich');
  if (!rich || edMode !== 'rich') return;
  var sel = window.getSelection();
  if (sel && sel.rangeCount && rich.contains(sel.anchorNode)) { keepSel(); updateToolbarState(); }
});
function render() { renderTree(); if (edNote) renderMeta() }
loadNotes();
