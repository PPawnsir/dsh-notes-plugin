/* ================= 视图求值：文件夹 ∩ 主题 ∩ 筛选中心（状态组/类型组，组内 OR 跨组 AND）∩ 搜索 ================= */
function matches(n) {
  if (view.type === 'topic') { if ((n.topic || '') !== view.id) return false }
  /* 文件夹视图 = 递归子树口径（notes-nested-folder-ui：点父文件夹视图含全部子孙文件夹内容，与 host notes-list folder 过滤同语义） */
  else if (view.type === 'folder') { if (!folderSubtree(view.id)[n.folder || '']) return false }
  /* 工作记忆 v0 隐身渲染守卫：类型组未勾「日志」时日志永不进日常视图（含清除筛选后的在途数据；专入口 = 勾选 kind=log） */
  if ((n.kind || 'note') === 'log' && filters.kinds.indexOf('log') < 0) return false;
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

