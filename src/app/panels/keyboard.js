/* ================= 键盘 ================= */
document.addEventListener('keydown', function (ev) {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); $('q').focus(); return }
  /* v3：Ctrl+/ 双模式切换（源码⇄富文本）；降级时 switchMode 内部拦截并 toast（弹窗打开时不切） */
  if ((ev.ctrlKey || ev.metaKey) && ev.key === '/') { ev.preventDefault(); if (edNote && !$('modalHost').firstChild) switchMode(edMode === 'source' ? 'rich' : 'source'); return }
  if (ev.key === 'Escape') {
    if ($('modalHost').firstChild) { closeModalFlushed(); archState = null; trashState = null; injMgrState = null; suggestState = null; histState = null; memEnableState = null; return }   /* 归档预览/合并/回收站/注入管理/整理建议/历史版本/工作记忆启用对话框走 modalHost，Esc 统一关（设置卡先兜底 flush 再关，同 ✕） */
    if (sortOpen) { sortOpen = false; renderFilterBar(); return }   /* 排序菜单 Esc（优先于筛选 popover） */
    if (filterOpen) { filterOpen = false; renderFilterBar(); return }   /* 筛选 popover Esc 关闭 */
    if (scopeOpen) { scopeOpen = false; renderScopePanel(); return }
    if (capEl) { closeCap(); return }
    if ($('ctxHost').firstChild) { closeCtx(); return }
    if (selMode) { selMode = false; selIds = {}; renderTree(); return }   /* Esc 退出多选态 */
    if (!document.activeElement || !document.activeElement.isContentEditable) { searchText = ''; searchIds = null; searchMeta = {}; $('q').value = ''; render() }
  }
});

