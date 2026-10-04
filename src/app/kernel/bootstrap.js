/* ================= 启动 ================= */
/* v3：document 级 selectionchange 挂一次（renderEd 重建编辑器 DOM 时元素级监听随元素重建，document 级不累积） */
document.addEventListener('selectionchange', function () {
  var rich = $('edRich');
  if (!rich || edMode !== 'rich') return;
  var sel = window.getSelection();
  if (sel && sel.rangeCount && rich.contains(sel.anchorNode)) { keepSel(); updateToolbarState(); }
});
/* R-6 UI 接线：render 汇聚全部 view 变更点（树行尾过滤钮/文件夹右键菜单/面包屑/主题行/视图清除），统一先做日志口径翻转检测——
   进文件夹视图静默重拉（数据源含 log），切回默认视图再翻回（恢复隐身）；幂等比较，非翻转零请求零副作用 */
function render() { maybeReloadForLogs(); renderTree(); if (edNote) renderMeta() }
loadNotes();
