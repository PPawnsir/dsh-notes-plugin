/* ================= 视图求值：主题 ∩ 筛选中心（状态组/类型组，组内 OR 跨组 AND）∩ 搜索 ================= */
/* 0.4.3⑦：「文件视图」（文件夹视图）模式整体拆除——view 取值收窄为 all | topic（树展开即文件夹浏览） */
function matches(n) {
  if (view.type === 'topic') { if ((n.topic || '') !== view.id) return false }
  /* 日志同权（0.4.3⑦）：无隐身渲染守卫——日志与普通笔记同一过滤管线（类型组勾选「日志」= 只看日志，matchFilters 同语义） */
  if (!matchFilters(n, filters)) return false;
  if (searchText) {
    var q = searchText.toLowerCase();
    var local = ((n.title || '') + ' ' + (n.preview || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ') + ' ' + fname(n.folder)).toLowerCase().indexOf(q) >= 0;
    var remote = searchIds ? searchIds.indexOf(n.id) >= 0 : false;
    if (!local && !remote) return false;
  }
  return true;
}

/* ================= 相关度档位（搜索体验升级）：标题命中(3) > 标签命中(2) > 正文命中(1) > 其他(0，如仅 topic 命中)；同级 updatedAt 降序（比较在 renderTree） ================= */
function relRank(n, q) {
  var m = searchMeta[n.id];   /* host notes-search 返回的 matches 命中字段（全文口径）优先；无则按本地字段估算（preview 仅前 200 字，正文命中可能低估） */
  if (m && m.length) { if (m.indexOf('title') >= 0) return 3; if (m.indexOf('tags') >= 0) return 2; if (m.indexOf('body') >= 0) return 1; return 0 }
  if ((n.title || '').toLowerCase().indexOf(q) >= 0) return 3;
  if ((n.tags || []).join(' ').toLowerCase().indexOf(q) >= 0) return 2;
  if ((n.preview || '').toLowerCase().indexOf(q) >= 0) return 1;
  return 0;
}

