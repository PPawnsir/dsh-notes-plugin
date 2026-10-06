/* ================= 数据加载（list 常驻缓存 + 写后回填） ================= */
/* 日志同权（0.4.3 验收修复⑦，用户裁决推翻 R-6 UI 隐身）：kind=log 随默认列表直达（host 已收编）——
   原日志口径开关/翻转检测/文件夹视图 includeLogs 重拉机制整体拆除；展开日志夹与普通夹同一代码路径（零额外 RPC，卡顿根因消除）。
   「文件视图」（文件夹视图）模式同卡整体拆除：view 取值收窄为 all | topic */
/* 0.4.3⑩（notes-043-archive-folder 第二轮裁决）：列表取数从「恒无参 + 客户端谓词过滤」改为「类型组恰选 1 个 kind 时传 {kind} 给 host」——
   host _list 谓词 kind 真值短路放行 sys（⑨ 保留的显式 kind 入口），「机器」档（kind=sys）= 全库 sys 笔记（含「记忆档案」夹内档案），
   树在该档下正常展开档案子行；不选/多选 kind 时无参调用，行为与 ⑨ 完全一致（缺省降噪：sys 不入默认列表）。
   口径同 search.js sArgs（类型组恰选 1 个时可传 kind；多选 OR host 单 kind 参数无法表达，由本地 matchFilters 兜底）。 */
/* 返回 Promise<boolean>：true=列表链路成功；false=失败（res.error 显式抛错进 catch——rpc 层不 reject 业务错误，刷新按钮据返回值决定是否弹「已刷新」，修假阳性） */
/* ⑩ 取数口径签名（恰选 1 个 kind = 该 kind，否则 '' = 无参缺省）：filter-pop 勾选/移除/清空据签名变化决定是否静默重拉 */
function listFetchSig() { return filters.kinds.length === 1 ? filters.kinds[0] : '' }
function loadNotes(silent) {
  var sig = listFetchSig();
  var listArgs = sig ? { kind: sig } : undefined;   /* ⑩ 恰选 1 个 kind → host kind 通道（「机器」档取 sys 全库） */
  return rpc('notes-list', listArgs).then(function (res) {
    if (res && res.error) throw new Error(res.error);
    if (res && res.notes) notes = res.notes;
    return loadFolders();
  }).then(function () { ensureWikiIndex(); renderTree(); refreshSysKids(); return true })   /* 0.4.4-C：列表刷新后复核 sysKids（剔除陈旧 + 展开中的夹重拉覆盖；refreshSysKids 定义在 panels/tree.js） */
    .catch(function (e) { if (!silent) toast(t('side.loadFailed', { msg: e && e.message || e })); return false });   /* i18n 覆盖卡F：side.loadFailed */
}
