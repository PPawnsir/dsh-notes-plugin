/* ================= 筛选中心（design/notes-filter-center.html）：筛选按钮(N) + 激活 chips + 独立排序控件 + popover 分组面板 ================= */
/* 控制行渲染：按钮计数丸 + 激活条件 chips（× 单条移除）+ 排序按钮/菜单 + popover 开关 */
function renderFilterBar() {
  var n = filtersActiveCount(), fb = $('btnFilter');
  fb.classList.toggle('on', n > 0 || filterOpen);
  fb.setAttribute('aria-expanded', filterOpen ? 'true' : 'false');
  $('filterBd').style.display = n > 0 ? '' : 'none';
  $('filterBd').textContent = n;
  var h = '';
  FILTER_STATUS.forEach(function (s) {
    if (!filters[s.id]) return;
    h += '<span class="fchip" data-ft="' + s.id + '" title="筛选条件：状态 / ' + s.label + '（点 × 移除）">' + icon(s.icon, 10) + s.label + '<span class="x" role="button" aria-label="移除条件 ' + s.label + '">' + icon('i-x', 9) + '</span></span>';
  });
  filters.kinds.forEach(function (k) {
    h += '<span class="fchip" data-fk="' + k + '" title="筛选条件：类型 / ' + KIND[k] + '（点 × 移除）"><span class="dot" style="background:' + (KCOLOR[k] || KCOLOR.note) + '"></span>' + KIND[k] + '<span class="x" role="button" aria-label="移除条件 ' + KIND[k] + '">' + icon('i-x', 9) + '</span></span>';
  });
  $('fchips').innerHTML = h;
  var sb = $('btnSort');
  sb.classList.toggle('on', sortBy !== 'time' || sortOpen);
  sb.innerHTML = icon('i-sort', 11) + '<span>' + sortLabel() + '</span>';
  $('fsortMenu').classList.toggle('open', sortOpen);
  if (sortOpen) renderSortMenu();
  var fp = $('fpop');
  fp.classList.toggle('open', filterOpen);
  if (filterOpen) renderFilterPop();
}
/* popover 分组面板：状态组（多选，曾注入 feature-detect）+ 类型组（多选）；组内 OR / 跨组 AND；勾选即时生效；底部 命中 N 条 + 清空/完成 */
function renderFilterPop() {
  var p = $('fpop'); if (!p) return;
  var showEver = hasInjectEver();
  var h = '<div class="fg-h"><span>状态</span><span class="fg-rule">组内多选 = OR</span></div>';
  FILTER_STATUS.forEach(function (s) {
    if (s.id === 'injectEver' && !showEver) return;   /* feature-detect：slim 无 injectEver 字段时不显示 */
    h += '<label class="fg-item"><input type="checkbox" data-ft="' + s.id + '"' + (filters[s.id] === true ? ' checked' : '') + '>'
      + icon(s.icon, 11) + '<span class="fl">' + s.label + '</span><span class="cnt2">' + notes.filter(s.pred).length + '</span></label>';
  });
  h += '<div class="fg-h"><span>类型</span><span class="fg-rule">组内 OR · 与状态组 = AND</span></div>';
  FILTER_KINDS.forEach(function (k) {
    h += '<label class="fg-item"><input type="checkbox" data-fk="' + k + '"' + (filters.kinds.indexOf(k) >= 0 ? ' checked' : '') + '>'
      + '<span class="dot" style="background:' + (KCOLOR[k] || KCOLOR.note) + '"></span><span class="fl">' + KIND[k] + '</span><span class="cnt2">' + notes.filter(function (n) { return (n.kind || 'note') === k }).length + '</span></label>';
  });
  h += '<div class="fpop-foot"><span class="pcnt">命中 ' + notes.filter(matches).length + ' 条</span><button class="pbtn" id="popClear">清空</button><button class="pbtn primary" id="popDone">完成</button></div>';
  p.innerHTML = h;
}
/* 独立排序菜单（单选；排序与筛选正交，互不重置） */
function renderSortMenu() {
  $('fsortMenu').innerHTML = FILTER_SORTS.map(function (s) {
    return '<div class="fsort-item' + (sortBy === s.id ? ' on' : '') + '" data-fs="' + s.id + '"><span class="tick">' + icon('i-check', 11) + '</span><span>' + s.label + '</span><span class="sd">' + s.desc + '</span></div>';
  }).join('');
}
/* 过滤条件变化且搜索词非空：重跑防抖搜索（host notes-search 组合过滤口径同步） */
function reSearch() { if (searchText.trim()) { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 250) } }

