/* ================= 数据加载（list 常驻缓存 + 写后回填） ================= */
/* 工作记忆 v0：筛选中心类型组勾选「日志」时列表数据源带 kind=log（host 默认排除日志——默认隐身；勾选即专入口，includeLogs 召回） */
/* R-6 UI 接线：数据源口径 = 勾选「日志」 || 显式文件夹视图（view.type === 'folder'——显式文件夹导航放行，夹内 log 与普通笔记同权展示）；
   切回默认视图口径翻 false → 静默重拉恢复隐身（不传 folder/includeLogs）。
   loadNotes 首行自同步口径：建/删文件夹等「view 先变后直调 loadNotes」路径不依赖 render 翻转检测也能带对参数 */
var wantLogs = false;
function wantLogsNow() { return filters.kinds.indexOf('log') >= 0 || view.type === 'folder' }
function maybeReloadForLogs() {
  var w = wantLogsNow();
  if (w !== wantLogs) { wantLogs = w; loadNotes(true) }
}
/* 返回 Promise<boolean>：true=列表链路成功；false=失败（res.error 显式抛错进 catch——rpc 层不 reject 业务错误，刷新按钮据返回值决定是否弹「已刷新」，修假阳性） */
function loadNotes(silent) {
  wantLogs = wantLogsNow();
  return rpc('notes-list', wantLogs ? { includeLogs: true } : undefined).then(function (res) {
    if (res && res.error) throw new Error(res.error);
    if (res && res.notes) notes = res.notes;
    return loadFolders();
  }).then(function () { ensureWikiIndex(); renderTree(); return true })
    .catch(function (e) { if (!silent) toast(t('side.loadFailed', { msg: e && e.message || e })); return false });   /* i18n 覆盖卡F：side.loadFailed */
}
