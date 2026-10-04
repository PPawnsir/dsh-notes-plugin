/* ================= 顶栏：刷新 / 归档 / 主题 ================= */
/* 刷新假阳性修复（R-2）：等 loadNotes 真实结果——失败（res.error/网络异常）时 loadNotes 已弹「列表加载失败」，这里不再无条件报喜 */
$('btnRefresh').addEventListener('click', function () { searchIds = null; var p = loadNotes(); if (sessList.length) pullSessions(); p.then(function (ok) { if (ok) toast('已刷新') }) });
$('btnArchive').addEventListener('click', openArchive);
$('btnSelMode').addEventListener('click', function () { selMode = !selMode; selIds = {}; renderTree() });
