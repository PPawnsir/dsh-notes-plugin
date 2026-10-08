/* ================= 启动 ================= */
/* v3：document 级 selectionchange 挂一次（renderEd 重建编辑器 DOM 时元素级监听随元素重建，document 级不累积） */
document.addEventListener('selectionchange', function () {
  var rich = $('edRich');
  if (!rich || edMode !== 'rich') return;
  var sel = window.getSelection();
  if (sel && sel.rangeCount && rich.contains(sel.anchorNode)) { keepSel(); updateToolbarState(); }
});
/* 0.4.3⑦：日志同权 + 文件视图拆除——render 不再做日志口径翻转检测（maybeReloadForLogs 已随 data.js 一并拆除），纯渲染汇聚 */
/* 0.4.9（notes-049-lang-rerender-editor）：renderEdLang 随汇聚——语言切换（setLang→render）时编辑器 footer/反链面板同翻转；
   纯 chrome 文案原地重写（正文 DOM 不动，在途编辑保护口径见 editor.js 函数头注释），幂等零副作用 */
function render() { renderTree(); renderEdLang(); if (edNote) renderMeta() }
/* 0.4.7-C（notes-047-stability ①）：页面卸载兜底——<900ms debounce 窗口内的在途编辑 flush 落盘（keepalive 通道）；
   面板关闭路径在 app 端不存在（全窗口页无浮层关），卸载是唯一关闭点；无在途时 flushPendingSave 零动作 */
window.addEventListener('beforeunload', function () { try { flushPendingSave() } catch (e) {} });
loadNotes();
/* 0.4.9 补（notes-049-lang-rerender-editor 驳回补修）：启动本地化空态编辑器——EN 持久化用户 reload 后静态壳（body.html #ed）
   中文空态滞留到手动再切语言才翻转（renderChrome 启动本地化不覆盖 #ed 区，renderEd 首跑在选笔记/切语言时）；
   启动即跑一次 renderEd()：boot 恒空态（state.js selId/edNote 初值 null，无正文 DOM 可损），空态分支按 NOTES_LANG 持久态经 t() 重写，幂等零副作用 */
renderEd();
