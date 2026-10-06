/* ================= 筛选中心交互（popover 开关 / 勾选即时生效 / chip × 单条移除 / 排序菜单） ================= */
$('btnFilter').addEventListener('click', function (ev) { ev.stopPropagation(); filterOpen = !filterOpen; if (filterOpen) sortOpen = false; renderFilterBar() });
$('btnSort').addEventListener('click', function (ev) { ev.stopPropagation(); sortOpen = !sortOpen; if (sortOpen) filterOpen = false; renderFilterBar() });
/* popover：勾选即时生效（组内 OR / 跨组 AND；条件变化持久化 + 有搜索词时重搜） */
$('fpop').addEventListener('change', function (ev) {
  var cb = ev.target; if (!cb.matches || !cb.matches('input[type=checkbox]')) return;
  var sigBefore = listFetchSig();   /* ⑩ 取数口径签名（恰选 1 个 kind）：勾选变化影响 host 取数时静默重拉 */
  if (cb.dataset.ft) filters[cb.dataset.ft] = cb.checked;
  else if (cb.dataset.fk) { var i = filters.kinds.indexOf(cb.dataset.fk); if (cb.checked && i < 0) filters.kinds.push(cb.dataset.fk); if (!cb.checked && i >= 0) filters.kinds.splice(i, 1) }
  else if (cb.dataset.fh) { showHidden = cb.checked; saveShowHidden(); render(); return }   /* 0.4.4-D：显隐开关（hidden 遮罩）——独立持久键，非筛选条件（不动 filters/取数口径/搜索） */
  saveFilters(); render(); reSearch();   /* 0.4.3⑦：日志同权——勾选「日志」不再触发 includeLogs 重拉（maybeReloadForLogs 已拆） */
  if (listFetchSig() !== sigBefore) loadNotes(true);   /* ⑩「机器」档等单 kind 口径切换 → host kind 通道重取（sys 全库 ↔ 缺省降噪） */
});
$('fpop').addEventListener('click', function (ev) {
  if (ev.target.closest('#popClear')) { var sigBefore = listFetchSig(); clearFilters(); render(); renderFilterBar(); reSearch(); if (listFetchSig() !== sigBefore) loadNotes(true); toast(t('filter.clearedToast')) }
  else if (ev.target.closest('#popDone')) { filterOpen = false; renderFilterBar() }
});
/* 激活条件 chip：× 单条移除（与 popover 勾选双向同步） */
$('fchips').addEventListener('click', function (ev) {
  var x = ev.target.closest('.x'); if (!x) return;
  var c = x.parentElement;
  var sigBefore = listFetchSig();   /* ⑩ 同上：chip 移除单 kind 口径变化 → 静默重拉 */
  if (c.dataset.ft) filters[c.dataset.ft] = false;
  else if (c.dataset.fk) { var i = filters.kinds.indexOf(c.dataset.fk); if (i >= 0) filters.kinds.splice(i, 1) }
  saveFilters(); render(); reSearch();
  if (listFetchSig() !== sigBefore) loadNotes(true);
});
/* 排序菜单：单选，选择即关闭（与筛选条件正交，互不重置） */
$('fsortMenu').addEventListener('click', function (ev) {
  var it = ev.target.closest('.fsort-item'); if (!it) return;
  sortBy = it.dataset.fs; sortOpen = false; saveFilters(); render();
});
$('selCancel').addEventListener('click', function () { selMode = false; selIds = {}; renderTree() });
$('selMerge').addEventListener('click', openMerge);
$('selDelete').addEventListener('click', doSelBatchDelete);
