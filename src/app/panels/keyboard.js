/* ================= 键盘 ================= */
/* 列表键盘导航（R-4 兑现）：j/k 或 ↑↓ 移动焦点行（可见选中态 .focused），Enter 打开；
   可见行序 = DOM 序（置顶/文件夹/未入夹/主题分组与展开态即所见顺序） */
function listVisibleIds() {
  return Array.prototype.map.call($('tree').querySelectorAll('[data-note]'), function (el) { return el.dataset.note })
}
function moveFocus(ids, delta) {
  var idx = focusId ? ids.indexOf(focusId) : -1;
  var next = idx < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, idx + delta));
  if (ids[next] == null) return;
  focusId = ids[next];
  renderTree();
  var fel = $('tree').querySelector('[data-note="' + focusId + '"]');
  if (fel) fel.scrollIntoView({ block: 'nearest' });
}
/* Esc 焦点分层末段/搜索↓桥接共用：还焦列表容器（焦点不得滞留输入框，j/k 立即可用） */
function blurSearchToList() { $('q').blur(); $('tree').focus() }
document.addEventListener('keydown', function (ev) {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); $('q').focus(); return }
  /* Alt+N 新建（Ctrl+N 是浏览器保留键「新建窗口」，页面 keydown 拿不到——改用无冲突组合；AltGr 带 ctrlKey 天然排除） */
  if (ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'n' || ev.key === 'N')) { ev.preventDefault(); if (!$('modalHost').firstChild) doNewNote(); return }
  /* v3：Ctrl+/ 双模式切换（源码⇄富文本）；降级时 switchMode 内部拦截并 toast（弹窗打开时不切） */
  if ((ev.ctrlKey || ev.metaKey) && ev.key === '/') { ev.preventDefault(); if (edNote && !$('modalHost').firstChild) switchMode(edMode === 'source' ? 'rich' : 'source'); return }
  if (ev.key === 'Escape') {
    if ($('modalHost').firstChild) { closeModalFlushed(); archState = null; trashState = null; injMgrState = null; suggestState = null; histState = null; memEnableState = null; dState = null; return }   /* 归档预览/合并/回收站/注入管理/整理建议/历史版本/工作记忆启用/派发（含定时排定）对话框走 modalHost，Esc 统一关（设置卡先兜底 flush 再关，同 ✕） */
    if (sortOpen) { sortOpen = false; renderFilterBar(); return }   /* 排序菜单 Esc（优先于筛选 popover） */
    if (filterOpen) { filterOpen = false; renderFilterBar(); return }   /* 筛选 popover Esc 关闭 */
    if (scopeOpen) { scopeOpen = false; renderScopePanel(); return }
    if (capEl) { closeCap(); return }
    if ($('ctxHost').firstChild) { closeCtx(); return }
    if (selMode) { selMode = false; selIds = {}; renderTree(); return }   /* Esc 退出多选态 */
    /* Esc 焦点分层末段：搜索框聚焦时——清空搜索并还焦列表（焦点不得滞留输入框，否则 j/k 字母误入搜索） */
    if (document.activeElement === $('q')) {
      if ($('q').value) { searchText = ''; searchIds = null; searchMeta = {}; $('q').value = ''; render() }
      blurSearchToList(); return
    }
    if (!document.activeElement || !document.activeElement.isContentEditable) { searchText = ''; searchIds = null; searchMeta = {}; $('q').value = ''; render() }
    return
  }
  /* 搜索框 ↓ 桥接列表（保留过滤上下文：搜索→↓→j/k→Enter 纯键盘路径） */
  var kt = ev.target;
  if (kt === $('q') && ev.key === 'ArrowDown') { ev.preventDefault(); blurSearchToList(); var ids0 = listVisibleIds(); if (ids0.length) moveFocus(ids0, 1); return }
  /* 列表导航：输入框/富文本内不抢键；弹窗/右键菜单打开时暂停 */
  var inField = kt && (kt.tagName === 'INPUT' || kt.tagName === 'TEXTAREA' || kt.isContentEditable);
  if (inField) return;
  /* ? 键唤起/关闭快捷键速查表（notes-034-f-cheatsheet：非输入焦点；其他弹层/右键菜单打开时不抢——Esc 分层口径同列表导航） */
  if (ev.key === '?') {
    ev.preventDefault();
    if ($('cheatsheetRoot')) { closeModalFlushed(); return }   /* 速查表打开时再按 ? = 关闭（toggle） */
    if ($('modalHost').firstChild || $('ctxHost').firstChild) return;   /* 其他弹层/右键菜单打开时不抢键 */
    openCheatsheet(); return
  }
  if ($('modalHost').firstChild || $('ctxHost').firstChild) return;
  var ids = listVisibleIds();
  if (!ids.length) return;
  if (ev.key === 'j' || ev.key === 'ArrowDown') { ev.preventDefault(); moveFocus(ids, 1) }
  else if (ev.key === 'k' || ev.key === 'ArrowUp') { ev.preventDefault(); moveFocus(ids, -1) }
  else if (ev.key === 'Enter') { if (focusId && ids.indexOf(focusId) >= 0) selectNote(focusId) }
});
