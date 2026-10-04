/* ================= 顶栏：刷新 / 归档 / 主题 ================= */
$('btnRefresh').addEventListener('click', function () { searchIds = null; loadNotes(); if (sessList.length) pullSessions(); toast('已刷新') });
$('btnArchive').addEventListener('click', openArchive);
$('btnSelMode').addEventListener('click', function () { selMode = !selMode; selIds = {}; renderTree() });
