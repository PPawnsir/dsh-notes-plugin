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
/* 0.4.7-C（notes-047-stability ①）：页面卸载兜底——<900ms debounce 窗口内的在途编辑 flush 落盘（keepalive 通道）；
   面板关闭路径在 app 端不存在（全窗口页无浮层关），卸载是唯一关闭点；无在途时 flushPendingSave 零动作 */
window.addEventListener('beforeunload', function () { try { flushPendingSave() } catch (e) {} });
loadNotes();
