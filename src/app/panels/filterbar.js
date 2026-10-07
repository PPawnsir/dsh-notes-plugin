/* ================= 筛选中心（design/notes-filter-center.html）：筛选按钮(N) + 激活 chips + 独立排序控件 + popover 分组面板 ================= */
/* 控制行渲染：按钮计数丸 + 激活条件 chips（× 单条移除）+ 排序按钮/菜单 + popover 开关 */
function renderFilterBar() {
  var n = filtersActiveCount(), fb = $('btnFilter');
  fb.classList.toggle('on', n > 0 || filterOpen);
  fb.setAttribute('aria-expanded', filterOpen ? 'true' : 'false');
  $('filterBd').style.display = n > 0 ? '' : 'none';
  $('filterBd').textContent = n;
  var h = '';
  /* i18n 覆盖卡F：chip 文案/标题走 t()（FILTER_STATUS.label/KIND 字面量仅作四端同构锚，渲染经 filterStatusLabel/kindLabel 条件映射） */
  FILTER_STATUS.forEach(function (s) {
    if (!filters[s.id]) return;
    var sl = filterStatusLabel(s.id);
    h += '<span class="fchip" data-ft="' + s.id + '" title="' + t('side.fchipStatusTip', { label: sl }) + '">' + icon(s.icon, 10) + sl + '<span class="x" role="button" aria-label="' + t('filter.removeAria', { label: sl }) + '">' + icon('i-x', 9) + '</span></span>';
  });
  filters.kinds.forEach(function (k) {
    var kl = kindLabel(k);
    h += '<span class="fchip" data-fk="' + k + '" title="' + t('side.fchipKindTip', { label: kl }) + '"><span class="dot" style="background:' + (KCOLOR[k] || KCOLOR.note) + '"></span>' + kl + '<span class="x" role="button" aria-label="' + t('filter.removeAria', { label: kl }) + '">' + icon('i-x', 9) + '</span></span>';
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
  var h = '<div class="fg-h"><span>' + t('filter.statusGroup') + '</span><span class="fg-rule">' + t('filter.ruleOr') + '</span></div>';
  FILTER_STATUS.forEach(function (s) {
    if (s.id === 'injectEver' && !showEver) return;   /* feature-detect：slim 无 injectEver 字段时不显示 */
    /* 0.4.6-H（notes-046-smallfix）：选项计数过 visMask 遮罩（query.js，与 matches() 遮罩段同口径）——
       修复「置顶选项计数 1 vs 命中 0」矛盾（置顶笔记在 sys 夹链内被遮罩时，裸谓词仍计 1） */
    h += '<label class="fg-item"><input type="checkbox" data-ft="' + s.id + '"' + (filters[s.id] === true ? ' checked' : '') + '>'
      + icon(s.icon, 11) + '<span class="fl">' + filterStatusLabel(s.id) + '</span><span class="cnt2">' + notes.filter(function (n) { return visMask(n) && s.pred(n) }).length + '</span></label>';
  });
  h += '<div class="fg-h"><span>' + t('filter.kindGroup') + '</span><span class="fg-rule">' + t('filter.ruleOrAnd') + '</span></div>';
  FILTER_KINDS.forEach(function (k) {
    /* 0.4.6-H（R2 n-mux9rpgowpz6）：「机器」选项计数口径——sys 笔记不入缺省缓存（host ⑨ 降噪），裸谓词恒 0 属误导；
       恰选 sys 单档时 host kind 通道已取回全库 sys（data.js listFetchSig）→ 显示真实命中数；其余形态显示「点选加载」占位（不显示 0） */
    var sysLazy = (k === 'sys' && !(filters.kinds.length === 1 && filters.kinds[0] === 'sys'));
    h += '<label class="fg-item"><input type="checkbox" data-fk="' + k + '"' + (filters.kinds.indexOf(k) >= 0 ? ' checked' : '') + '>'
      + '<span class="dot" style="background:' + (KCOLOR[k] || KCOLOR.note) + '"></span><span class="fl">' + kindLabel(k) + '</span><span class="cnt2">' + (sysLazy ? t('filter.sysCountLazy') : notes.filter(function (n) { return visMask(n) && (n.kind || 'note') === k }).length) + '</span></label>';
  });
  /* 0.4.4-D hidden：显示组——「显示隐藏」显隐开关（OS 文件管理对齐；独立持久键 dsh-notes-app-show-hidden，非筛选条件——不计数/清空不重置） */
  h += '<div class="fg-h"><span>' + t('filter.displayGroup') + '</span></div>';
  h += '<label class="fg-item" title="' + esc(t('filter.showHiddenTip')) + '"><input type="checkbox" data-fh="1"' + (showHidden ? ' checked' : '') + '>' + icon('i-eye', 11) + '<span class="fl">' + t('filter.showHidden') + '</span></label>';
  h += '<div class="fpop-foot"><span class="pcnt">' + t('filter.hitCount', { n: notes.filter(matches).length }) + '</span><button class="pbtn" id="popClear">' + t('filter.clear') + '</button><button class="pbtn primary" id="popDone">' + t('filter.done') + '</button></div>';
  p.innerHTML = h;
}
/* 独立排序菜单（单选；排序与筛选正交，互不重置） */
function renderSortMenu() {
  $('fsortMenu').innerHTML = FILTER_SORTS.map(function (s) {
    return '<div class="fsort-item' + (sortBy === s.id ? ' on' : '') + '" data-fs="' + s.id + '"><span class="tick">' + icon('i-check', 11) + '</span><span>' + sortLabelOf(s.id) + '</span><span class="sd">' + sortDescOf(s.id) + '</span></div>';
  }).join('');
}
/* 过滤条件变化且搜索词非空：重跑防抖搜索（host notes-search 组合过滤口径同步） */
function reSearch() { if (searchText.trim()) { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 250) } }

