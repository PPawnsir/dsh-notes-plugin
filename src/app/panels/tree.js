/* ================= 侧栏树 ================= */
/* 树展开「含日志的文件夹」懒加载日志子条目（notes-041c-tree-log-children）：
   R-6 豁免面 = 「用户主动展开日志夹」这一动作——定向 includeLogs 重拉，日志条目以 overlay 形式并入树子节点
   （不并入 notes 主缓存：默认列表/搜索/目录的隐身口径不变）；foldLogLoaded 会话级按夹去重——折叠再展开不重复拉取 */
var logOverlay = [];      /* 定向 includeLogs 拉取的 kind=log overlay（仅树渲染消费） */
var foldLogLoaded = {};   /* fid → true：该夹展开动作已触发过定向拉取（会话级，不持久化） */
function ensureFoldLogs(fid) {
  if (foldLogLoaded[fid]) return;
  foldLogLoaded[fid] = true;
  /* 列表已是 includeLogs 口径（筛选「日志」勾选 / 文件夹视图）：日志在 notes 里随 vis 正常渲染，零请求 */
  if (notes.some(function (n) { return (n.kind || 'note') === 'log' })) return;
  rpc('notes-list', { includeLogs: true }).then(function (res) {
    if (!res || res.error || !res.notes) return;
    logOverlay = res.notes.filter(function (n) { return (n.kind || 'note') === 'log' });
    renderTree();
  }).catch(function (e) {});
}
function noteRow(n, inFolderCtx) {
  var tail = '';
  if (view.type === 'topic' && n.folder) tail += '<span class="fbadge">' + icon('i-folder', 9) + esc(fname(n.folder)) + '</span>';
  else if (inFolderCtx && n.topic) tail += '<span class="tp" title="' + esc(t('tree.topicTip', { topic: n.topic })) + '">' + esc(n.topic) + '</span>';
  else tail += '<span class="tp">' + fmtD(n.updatedAt) + '</span>';
  /* 多选态：行首复选框 + pick 高亮（行点击=勾选，由树事件委托统一处理） */
  return '<div class="note-row' + (selId === n.id ? ' sel' : '') + (focusId === n.id ? ' focused' : '') + (n.status === 'resolved' || n.status === 'superseded' ? ' dim' : '') + (selMode && selIds[n.id] ? ' pick' : '') + '" data-note="' + n.id + '" draggable="true">'
    + (selMode ? '<input type="checkbox" class="pick-check"' + (selIds[n.id] ? ' checked' : '') + '>' : '')
    /* 行首槽位对齐：caret 槽同宽占位 + 图标槽（kind 色点居中），与文件夹行标题起点一致 */
    + '<span class="caret-spacer"></span><span class="kind-slot"><span class="kind" style="background:' + (KCOLOR[n.kind] || KCOLOR.note) + '"></span></span>'
    + '<span class="ti">' + (isPinned(n) ? '<svg class="ic pin"><use href="#i-pin"/></svg> ' : '') + hl(n.title || t('tree.untitled'), searchText) + '</span>'
    /* 日志隐身标记（notes-041c-tree-log-children）：树内定向召回的 kind=log 行尾 log 文本徽章（懒加载 overlay 专属视觉；面板 emoji 红线——不用表情字符） */
    + (n.kind === 'log' ? '<span class="logmark" style="font-size:9px;margin-left:2px;opacity:.6" title="' + esc(t('tree.logTip')) + '">log</span>' : '')
    + (n.inject ? '<span style="color:var(--nacc);display:flex" title="' + esc(t('tree.injectTip', { role: t(n.injectRole === 'reference' ? 'tree.roleReference' : 'tree.roleConvention') })) + '">' + icon('i-bolt', 10) + '</span>' : '')
    /* 曾注入徽章（injectEver 粘性标记：历史上开启过注入、现已关闭；已注入由 bolt 表达不重复显示；不满足不渲染） */
    + (!n.inject && n.injectEver === true ? '<span class="injevr" title="' + t('tree.injectEverTip') + '">' + icon('i-clock', 9) + '</span>' : '')
    /* 使用遥测（P2）：被引用徽章（0 次不显示） */
    + ((n.useCount || 0) > 0 ? '<span class="use" title="' + esc(t('tree.useCountTip', { n: n.useCount })) + '">' + icon('i-quote', 9) + n.useCount + '</span>' : '')
    /* 双链标记（P2）：正文含 [[..]] 时行尾显示链接图标（缓存正文优先，preview 兜底） */
    + (hasWikiLinks(n) ? '<span class="wikimark" title="' + t('tree.wikiTip') + '">' + icon('i-link', 9) + '</span>' : '')
    + tail + '</div>';
}
/* 嵌套文件夹递归渲染（notes-nested-folder-ui）：depth-first——文件夹行 → 展开时 [子文件夹递归 → 直挂笔记] 包一层 .nested 缩进容器；
   同级同字体/行首槽位对齐沿用排版体系；过滤命中与展开语义按子树（子树含命中 → 自动展开 + 计数=子树命中数，与 host f.count 子树口径一致；
   纯渲染态不写回 foldOpen——清除过滤即恢复手动折叠态）；文件夹行 draggable = 拖拽换父（事件委托见 dragstart/drop） */
function folderNodeHtml(f, vis, filtering) {
  var h = '';
  var sub = folderSubtree(f.id);
  var kids = vis.filter(function (n) { return (n.folder || '') === f.id });
  var subHits = filtering ? vis.filter(function (n) { return sub[n.folder || ''] }).length : 0;
  var open = (foldOpen[f.id] !== false) || (filtering && subHits > 0);
  /* 日志 overlay 并入（notes-041c-tree-log-children）：夹已展开且定向拉过 → 本夹直挂 log 子条目追加到 kids 尾部（id 去重防文件夹视图双显） */
  if (open && foldLogLoaded[f.id] && logOverlay.length) {
    var _have = {};
    kids.forEach(function (n) { _have[n.id] = 1 });
    logOverlay.forEach(function (n) { if ((n.folder || '') === f.id && !_have[n.id]) kids.push(n) });
  }
  /* 行点击（含名称/图标/caret）= 纯展开/折叠（经典树语义，唯一职责——notes-041b 用户裁决去重）；
     行尾 vfilter 图标=进入/退出文件夹视图（唯一进视图入口，不抢占单击） */
  h += '<div class="row head' + (view.type === 'folder' && view.id === f.id ? ' on' : '') + '" data-fold="' + f.id + '" data-drop="1" draggable="true">'
    + '<span class="caret' + (open ? ' open' : '') + '" title="' + t('tree.toggleTip') + '">' + icon('i-chev') + '</span>'
    + '<span class="ic-slot">' + icon('i-folder', 13) + '</span>'
    + '<span class="nm">' + esc(f.name) + '</span><span class="n">' + (filtering ? subHits : (f.count != null ? f.count : kids.length)) + '</span>'
    + '<span class="vfilter' + (view.type === 'folder' && view.id === f.id ? ' on' : '') + '" title="' + t('tree.folderViewTip') + '">' + icon('i-filter', 11) + '</span></div>';
  if (!open) return h;
  var subFolders = folderKids(f.id);
  if (!subFolders.length && !kids.length) return h;
  h += '<div class="nested">';
  subFolders.forEach(function (cf) { h += folderNodeHtml(cf, vis, filtering) });
  kids.forEach(function (n) { h += noteRow(n, true) });
  h += '</div>';
  return h;
}
function renderTree() {
  renderChrome();   /* 覆盖卡A（notes-042-i18n-cov-a）：壳静态串随树渲染收敛刷新（setLang → render() 路径）；函数在 panels/topbar.js */
  var vis = notes.filter(matches);
  /* 排序：缺省保持 host 序（pinned → updatedAt）；「按引用」= useCount 降序（同数按 updatedAt 兜底）；「相关度」= 标题命中>标签>正文（同级 updatedAt 降序），分组内顺序随过滤数组 */
  if (sortBy === 'use') vis.sort(function (a, b) { return ((b.useCount || 0) - (a.useCount || 0)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) });
  var qRel = searchText.trim().toLowerCase();
  if (sortBy === 'rel' && qRel) vis.sort(function (a, b) { return (relRank(b, qRel) - relRank(a, qRel)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) });
  $('brandCnt').textContent = t('tree.countN', { n: view.type === 'all' && filtersActiveCount() === 0 && !searchText ? notes.length : vis.length });
  /* 过滤激活（视图/筛选中心/搜索任一）：含命中的文件夹/主题强制展开（纯渲染态，不写回 foldOpen/topicOpen——清除过滤即恢复手动折叠态），分组计数切换为命中数 */
  var filtering = view.type !== 'all' || !!searchText || filtersActiveCount() > 0;
  var h = '';
  var vt = view.type === 'topic' ? t('tree.viewTopic', { id: view.id }) : view.type === 'folder' ? t('tree.viewFolder', { name: fname(view.id) }) : t('tree.viewAll');
  h += '<div class="sec-h">' + icon('i-filter', 11) + esc(vt) + (view.type === 'topic' ? ' <span style="letter-spacing:0;text-transform:none;font-weight:500">' + esc(t('tree.crossFolderCount', { n: vis.length })) + '</span>' : '') + (view.type !== 'all' ? '<span class="add" id="viewClear" title="' + t('tree.clearViewTip') + '">✕</span>' : '') + '</div>';
  /* 置顶聚合组（筛选中心「置顶」条件激活时不再重复展示） */
  if (!filters.pinned) {
    var pins = vis.filter(isPinned);
    if (pins.length) { h += '<div class="sec-h">' + icon('i-pin', 11) + ' ' + t('tree.pinned') + '<span class="cnt2">' + pins.length + '</span></div>'; pins.forEach(function (n) { h += noteRow(n, false) }) }
  }
  /* 文件夹组（嵌套递归：根级清单 → folderNodeHtml depth-first；悬空 parent 按根级防御） */
  h += '<div class="sec-h">' + t('tree.folders') + '<span class="add" id="addFolder" title="' + t('tree.addFolderTip') + '">' + icon('i-plus', 12) + '</span></div>';
  rootFolders().forEach(function (f) { h += folderNodeHtml(f, vis, filtering) });
  /* 未入夹笔记：根级同级直显（与文件夹行同一缩进层级，紧随文件夹列表之后、主题过滤区之前；无「未分类」分组头/分区计数——数量并入 brand 总计数；
     主题聚合由底部「主题过滤」区承担，不重复聚合）；.unfiled-drop 包裹容器 = 「移出文件夹」drop 落点（data-drop-out，拖到本区任意位置 = 移出）；
     空态非拖拽不渲染任何占位；拖拽中由 dragstart 委托点亮/补插落点容器（.drag-on 显示「拖到此处移出文件夹」提示行），dragend 清理 */
  var unfiled = vis.filter(function (n) { return !n.folder });
  if (unfiled.length) {
    /* 提示行必须排在笔记行**之后**（notes-041d-drag-root-note）：.unfiled-hint 默认 display:none、dragstart 时 .drag-on 点亮为 block——
       若提示行在行首，点亮瞬间把本夹笔记行（=拖拽源行）整体下移，Chromium 判定拖拽源位移直接取消拖拽（dragstart→立即 dragend，无 dragover/drop），
       根目录笔记因此永远拖不进文件夹（真实浏览器 A/B 复现实锤：hint 置尾后 dragover/drop 链路恢复）；已归类笔记不在容器内不受影响 */
    h += '<div class="unfiled-drop" data-drop-out="1">';
    unfiled.forEach(function (n) { h += noteRow(n, false) });
    h += '<div class="unfiled-hint">' + t('tree.dropOutHint') + '</div>';
    h += '</div>';
  }
  /* 主题全局过滤器（整区默认折叠：常态只显示「主题 (N)」一行，点分组头展开/收起（topicSecOpen，session 记忆不持久化）；
     展开行为与置顶折叠组同款：过滤激活且有主题命中时纯计算 OR 自动展开（不写回 topicSecOpen——清除过滤即恢复），计数切换为命中主题数） */
  var allTopics = {};
  notes.forEach(function (n) { if (n.topic) allTopics[n.topic] = (allTopics[n.topic] || 0) + 1 });
  var topicNames = Object.keys(allTopics).sort();
  var topicHitSet = {};
  vis.forEach(function (n) { if (n.topic) topicHitSet[n.topic] = true });
  var topicHitCount = Object.keys(topicHitSet).length;
  var tSecOpen = topicSecOpen || (filtering && topicHitCount > 0);
  h += '<div class="sec-h" data-tsec="1" style="cursor:pointer"><span class="caret' + (tSecOpen ? ' open' : '') + '">' + icon('i-chev') + '</span>' + icon('i-topic', 11) + ' ' + t('tree.topicsHeader', { n: filtering ? topicHitCount : topicNames.length }) + '<span class="add" style="cursor:default">' + t('tree.crossFolder') + '</span></div>';
  var topicViewTip = t('tree.topicViewTip');   /* 覆盖卡A：forEach 回调形参 t（主题名）遮蔽全局 t()——tooltip 串前置提升 */
  if (tSecOpen) topicNames.forEach(function (t) {
    var on = view.type === 'topic' && view.id === t;
    var tkids = vis.filter(function (n) { return (n.topic || '') === t });
    /* 过滤激活自动展开：含命中的主题行强制展开（不写回 topicOpen，清除过滤即恢复）；计数同步切换为命中数 */
    var tOpen = !!topicOpen[t] || (filtering && tkids.length > 0);
    /* 行主体单击=原地展开/收起该主题子列表（topicOpen，不持久化）；行尾 vfilter 图标=主题视图（跨文件夹过滤） */
    h += '<div class="row topic-row' + (on ? ' on' : '') + '" data-topic="' + esc(t) + '">'
      + '<span class="caret' + (tOpen ? ' open' : '') + '">' + icon('i-chev') + '</span>'
      + '<span class="ic-slot">' + icon('i-topic', 12) + '</span><span class="nm">' + esc(t) + '</span><span class="n">' + (filtering ? tkids.length : allTopics[t]) + '</span>'
      + '<span class="vfilter' + (on ? ' on' : '') + '" title="' + topicViewTip + '">' + icon('i-filter', 11) + '</span></div>';
    if (tOpen && tkids.length) { h += '<div class="nested">'; tkids.forEach(function (n) { h += noteRow(n, false) }); h += '</div>' }
  });
  /* 空结果态：提示 + 「清空筛选条件」快捷链接（筛选中心口径⑦） */
  if (!vis.length) h += '<div class="sec-h" style="text-transform:none;letter-spacing:0">' + t('tree.noMatch') + (filtersActiveCount() ? ' · <span class="add" id="emptyClear" style="letter-spacing:0">' + t('tree.clearFilters') + '</span>' : '') + '</div>';
  $('tree').innerHTML = h;
  var vc = $('viewClear'); if (vc) vc.onclick = function () { view = { type: 'all', id: '' }; render() };
  var ec = $('emptyClear'); if (ec) ec.onclick = function () { clearFilters(); render(); renderFilterBar(); if (searchText.trim()) reSearch() };
  var af = $('addFolder'); if (af) af.onclick = function (ev) { ev.stopPropagation(); doCreateFolder() };
  $('btnSelMode').classList.toggle('on', selMode);
  /* 筛选中心控制行：按钮计数丸 / 激活 chips / 排序按钮 / popover 随每次树渲染同步（列表到达后 feature-detect 与命中数才准） */
  renderFilterBar();
  renderSelBar();
}
/* 多选操作条：已选 N 条 | [红字 sys 警示] | 合并 | 删除 | 取消（多选态常显于左下角）
   0.4.3⑥（notes-043-sys-kind）：所选含 kind=sys 系统根笔记时红字警示（豁免面收口；confirm 门槛在 doSelBatchDelete，与 client selbar 同口径） */
function renderSelBar() {
  var n = Object.keys(selIds).length;
  var sysN = 0, byId = {};
  notes.forEach(function (x) { byId[x.id] = x });
  Object.keys(selIds).forEach(function (id) { if (byId[id] && (byId[id].kind || 'note') === 'sys') sysN++ });
  $('selbar').style.display = selMode ? 'flex' : 'none';
  $('selbarN').textContent = t('sel.selCount', { n: n });
  $('selSysWarn').style.display = sysN > 0 ? '' : 'none';
  $('selSysWarn').textContent = sysN > 0 ? t('sys.selWarn', { n: sysN }) : '';
  $('selSysWarn').title = sysN > 0 ? t('sys.batchDelWarn', { n: sysN }) : '';
  $('selMerge').disabled = n < 2;
  $('selDelete').disabled = n < 1;
}
/* 树事件委托（挂一次；drag 事件均冒泡） */
$('tree').addEventListener('click', function (ev) {
  var vf = ev.target.closest('.vfilter');
  var frow = ev.target.closest('[data-fold]');
  /* 文件夹行：行尾过滤图标=进入/退出文件夹视图（唯一进视图入口，切换保留）；
     行主体单击（含名称/图标/caret）= 纯展开/折叠（经典树语义唯一职责——notes-041b 用户裁决去重；
     caret 与行主体同一 toggle 路径，消除旧「两步进视图」竞态导致的 caret 展开失灵） */
  if (vf && frow) { var fid = frow.dataset.fold; view = view.type === 'folder' && view.id === fid ? { type: 'all', id: '' } : { type: 'folder', id: fid }; foldOpen[fid] = true; saveFoldOpen(); render(); return }
  if (frow) {
    var fid2 = frow.dataset.fold;
    var opening = foldOpen[fid2] === false;   /* 展开动作（notes-041c）：仅此动作触发日志懒加载（R-6 定向豁免），折叠不动作 */
    foldOpen[fid2] = foldOpen[fid2] === false ? true : false; saveFoldOpen(); if (opening) ensureFoldLogs(fid2); renderTree(); return
  }
  /* 主题过滤区分组头：点击=整区展开/收起（topicSecOpen；列表内主题行原地展开行为不变） */
  var tsec = ev.target.closest('[data-tsec]');
  if (tsec) { topicSecOpen = !topicSecOpen; renderTree(); return }
  var trow = ev.target.closest('[data-topic]');
  if (trow) {
    var t = trow.dataset.topic;
    /* 主题行：行尾过滤图标=主题视图（跨文件夹过滤）；行主体=原地展开/收起该主题子列表 */
    if (vf) { view = view.type === 'topic' && view.id === t ? { type: 'all', id: '' } : { type: 'topic', id: t }; render(); return }
    topicOpen[t] = !topicOpen[t]; renderTree(); return
  }
  var nrow = ev.target.closest('[data-note]');
  if (nrow) {
    /* 多选态：行点击=勾选/取消（不打开笔记），并重渲染刷新复选框与操作条计数 */
    if (selMode) { var nid = nrow.dataset.note; if (selIds[nid]) delete selIds[nid]; else selIds[nid] = true; renderTree(); return }
    selectNote(nrow.dataset.note);
  }
});
$('tree').addEventListener('contextmenu', function (ev) {
  var frow = ev.target.closest('[data-fold]');
  if (!frow) return;
  ev.preventDefault();
  openFolderMenu(ev.clientX, ev.clientY, frow.dataset.fold);
});
$('tree').addEventListener('dragstart', function (ev) {
  /* 文件夹行拖拽换父（notes-nested-folder-ui）：data-fold 行可拖（draggable）；与笔记拖拽互斥（行内无 data-note 后代，closest 区分） */
  var frow0 = ev.target.closest('[data-fold]');
  if (frow0 && !ev.target.closest('[data-note]')) {
    if (selMode) { ev.preventDefault(); return }   /* 多选态禁用拖拽（点击=勾选，不挪文件夹） */
    dragFolderId = frow0.dataset.fold; frow0.classList.add('drag');
    try { ev.dataTransfer.setData('text/dsh-folder-id', dragFolderId); ev.dataTransfer.effectAllowed = 'move' } catch (e) {}
    /* 拖拽中亮出「移回根级」落点：复用未入夹容器（提示行文案切换）；空态补插临时容器，dragend 统一清理 */
    var udrop0 = $('tree').querySelector('.unfiled-drop');
    if (udrop0) { udrop0.classList.add('drag-on'); var uh0 = udrop0.querySelector('.unfiled-hint'); if (uh0) uh0.textContent = t('tree.dropRootHint'); return }
    udrop0 = document.createElement('div');
    udrop0.className = 'unfiled-drop drag-on';
    udrop0.setAttribute('data-drop-out', '1');
    udrop0.innerHTML = '<div class="unfiled-hint">' + t('tree.dropRootHint') + '</div>';
    $('tree').insertBefore(udrop0, $('tree').querySelector('[data-tsec]'));
    return;
  }
  var nrow = ev.target.closest('[data-note]'); if (!nrow) return;
  if (selMode) { ev.preventDefault(); return }   /* 多选态禁用拖拽（点击=勾选，不挪文件夹） */
  dragId = nrow.dataset.note; nrow.classList.add('drag');
  try { ev.dataTransfer.setData('text/plain', dragId); ev.dataTransfer.effectAllowed = 'move' } catch (e) {}
  /* 拖拽中亮出「移出文件夹」落点：已有未入夹容器 → 加 .drag-on 显示提示行；无未入夹笔记（容器未渲染）→ 补插临时落点容器（主题过滤区之前），dragend 统一清理 */
  var udrop = $('tree').querySelector('.unfiled-drop');
  if (udrop) { udrop.classList.add('drag-on'); return }
  udrop = document.createElement('div');
  udrop.className = 'unfiled-drop drag-on';
  udrop.setAttribute('data-drop-out', '1');
  udrop.innerHTML = '<div class="unfiled-hint">' + t('tree.dropOutHint') + '</div>';
  $('tree').insertBefore(udrop, $('tree').querySelector('[data-tsec]'));
});
$('tree').addEventListener('dragend', function () {
  dragId = null; dragFolderId = null;
  document.querySelectorAll('.drop').forEach(function (e) { e.classList.remove('drop') });
  document.querySelectorAll('.unfiled-hint').forEach(function (el) { el.textContent = t('tree.dropOutHint') });
  /* 清理「移出」落点拖拽态：含笔记行的容器摘 .drag-on（提示行隐藏）；空态临时容器直接移除 */
  document.querySelectorAll('.unfiled-drop.drag-on').forEach(function (el) { if (el.querySelector('[data-note]')) el.classList.remove('drag-on'); else el.remove() });
});
$('tree').addEventListener('dragover', function (ev) {
  if (!dragId && !dragFolderId) return;
  var drop = ev.target.closest('[data-drop],[data-drop-out]');
  if (!drop) return;
  /* 文件夹换父：自挂/挂到子孙为非法落点（不高亮不 preventDefault，浏览器禁示光标）；深度上限留给 host 拒绝后 toast */
  if (dragFolderId && drop.hasAttribute('data-drop')) { var tid = drop.dataset.fold; if (tid === dragFolderId || folderSubtree(dragFolderId)[tid]) return }
  ev.preventDefault();
  drop.classList.add('drop');
});
$('tree').addEventListener('dragleave', function (ev) {
  var drop = ev.target.closest('[data-drop],[data-drop-out]');
  if (drop) drop.classList.remove('drop');
});
$('tree').addEventListener('drop', function (ev) {
  var drop = ev.target.closest('[data-drop],[data-drop-out]');
  if (!drop || (!dragId && !dragFolderId)) return;
  ev.preventDefault();
  drop.classList.remove('drop');
  var target = drop.hasAttribute('data-drop-out') ? '' : drop.dataset.fold;
  /* 文件夹拖拽 = 换父（reparentFolder 校验+toast）；笔记拖拽 = 移入/移出文件夹（moveNoteToFolder 不变） */
  if (dragFolderId) { var fid = dragFolderId; dragFolderId = null; reparentFolder(fid, target); return }
  var id = dragId; dragId = null;
  moveNoteToFolder(id, target);
});
function moveNoteToFolder(id, folderId) {
  var n = notes.find(function (x) { return x.id === id });
  if (!n || (n.folder || '') === (folderId || '')) return;
  rpc('notes-update', { id: id, folder: folderId }).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    if (folderId) { foldOpen[folderId] = true; saveFoldOpen() }
    toast(folderId ? t('tree.movedTo', { name: fname(folderId) }) : t('tree.movedOut'));
    loadNotes(true);
  }).catch(function (e) { toast(t('tree.moveFailed', { msg: e && e.message || e })) });
}

