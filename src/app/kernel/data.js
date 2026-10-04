/* ================= 数据加载（list 常驻缓存 + 写后回填） ================= */
/* 工作记忆 v0：筛选中心类型组勾选「日志」时列表数据源带 kind=log（host 默认排除日志——默认隐身；勾选即专入口，includeLogs 召回） */
var wantLogs = false;
function maybeReloadForLogs() {
  var w = filters.kinds.indexOf('log') >= 0;
  if (w !== wantLogs) { wantLogs = w; loadNotes(true) }
}
function loadNotes(silent) {
  return rpc('notes-list', wantLogs ? { includeLogs: true } : undefined).then(function (res) {
    if (res && res.notes) notes = res.notes;
    return loadFolders();
  }).then(function () { ensureWikiIndex(); renderTree(); })
    .catch(function (e) { if (!silent) toast('列表加载失败：' + (e && e.message || e)) });
}
