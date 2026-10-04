/* ================= 搜索：本地即时过滤 + 250ms 防抖 notes-search 并集（kind/sensitive/inject 组合过滤随 sArgs 同步 host；matches 命中字段供相关度排序） ================= */
function doSearch() {
  var q = searchText.trim();
  if (!q) { searchIds = null; searchMeta = {}; return }
  var sArgs = { query: q };
  /* 筛选中心组合过滤同步 host：类型组恰选 1 个时可传 kind；状态组仅单条件独活时可传 sensitive/inject
     （多选 OR / 曾注入 语义 host 无法表达，由本地 matchFilters 兜底全量语义） */
  if (filters.kinds.length === 1) sArgs.kind = filters.kinds[0];
  var stOn = FILTER_STATUS.filter(function (s) { return filters[s.id] }).map(function (s) { return s.id });
  if (stOn.length === 1 && stOn[0] === 'sensitive') sArgs.sensitive = true;
  if (stOn.length === 1 && stOn[0] === 'injected') sArgs.inject = true;
  rpc('notes-search', sArgs).then(function (res) {
    if (res && res.notes && $('q').value.trim() === q) {
      searchIds = res.notes.map(function (n) { return n.id });
      searchMeta = {};
      res.notes.forEach(function (n) { if (n.matches) searchMeta[n.id] = n.matches });
      render();
    }
  }).catch(function () {})
}
$('q').addEventListener('input', function () {
  searchText = this.value;
  render();
  clearTimeout(searchTimer);
  if (!searchText.trim()) { searchIds = null; searchMeta = {}; return }
  searchTimer = setTimeout(doSearch, 250);
});

