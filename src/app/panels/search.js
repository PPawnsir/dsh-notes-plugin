/* ================= 搜索：本地即时过滤 + 250ms 防抖 notes-search 并集（kind/sensitive/inject 组合过滤随 sArgs 同步 host；matches 命中字段供相关度排序） ================= */
function doSearch() {
  var q = searchText.trim();
  if (!q) { searchIds = null; searchMeta = {}; searchSem = {}; searchEx = {}; return }
  var sArgs = { query: q };
  /* 筛选中心组合过滤同步 host：类型组恰选 1 个时可传 kind；状态组仅单条件独活时可传 sensitive/inject
     （多选 OR / 曾注入 语义 host 无法表达，由本地 matchFilters 兜底全量语义） */
  if (filters.kinds.length === 1) sArgs.kind = filters.kinds[0];
  var stOn = FILTER_STATUS.filter(function (s) { return filters[s.id] }).map(function (s) { return s.id });
  if (stOn.length === 1 && stOn[0] === 'sensitive') sArgs.sensitive = true;
  if (stOn.length === 1 && stOn[0] === 'injected') sArgs.inject = true;
  rpc('notes-search', sArgs).then(function (res) {
    if (res && res.error) throw new Error(res.error);   /* 显式抛错进 catch（读路径静默群修复） */
    if (res && res.notes && $('q').value.trim() === q) {
      searchErrNotified = false;   /* 成功即复位，下一轮故障允许再提示一次 */
      searchIds = res.notes.map(function (n) { return n.id });
      searchMeta = {};
      searchSem = {};
      searchEx = {};   /* 0.5.0 交互层：摘要行随检索结果换代（旧摘录不残留） */
      res.notes.forEach(function (n) { if (n.matches) searchMeta[n.id] = n.matches; if (n.semantic) searchSem[n.id] = true; if (n.excerpt) searchEx[n.id] = n.excerpt });
      render();
    }
  }).catch(function (e) {
    /* 在线检索失败降级为本地过滤（matches 本地分支兜底）：防抖逐键触发，同一轮故障只 toast 一次防刷屏 */
    if (!searchErrNotified) { searchErrNotified = true; toast(t('search.offline', { msg: e && e.message || e })) }
  })
}
$('q').addEventListener('input', function () {
  searchText = this.value;
  searchEx = {};    /* 0.5.0 交互层：输入变化即清摘要行——必须先清再 render（旧摘录区间对应旧查询词，残留=错词高亮） */
  render();
  clearTimeout(searchTimer);
  searchSem = {};   /* 0.5.0③：输入变化即清语义徽标（防抖窗口内旧徽标残留） */
  if (!searchText.trim()) { searchIds = null; searchMeta = {}; return }
  searchTimer = setTimeout(doSearch, 250);
});

