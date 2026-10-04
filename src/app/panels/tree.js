/* ================= 侧栏树 ================= */
function noteRow(n, inFolderCtx) {
  var tail = '';
  if (view.type === 'topic' && n.folder) tail += '<span class="fbadge">' + icon('i-folder', 9) + esc(fname(n.folder)) + '</span>';
  else if (inFolderCtx && n.topic) tail += '<span class="tp" title="主题：' + esc(n.topic) + '">' + esc(n.topic) + '</span>';
  else tail += '<span class="tp">' + fmtD(n.updatedAt) + '</span>';
  /* 多选态：行首复选框 + pick 高亮（行点击=勾选，由树事件委托统一处理） */
  return '<div class="note-row' + (selId === n.id ? ' sel' : '') + (n.status === 'resolved' || n.status === 'superseded' ? ' dim' : '') + (selMode && selIds[n.id] ? ' pick' : '') + '" data-note="' + n.id + '" draggable="true">'
    + (selMode ? '<input type="checkbox" class="pick-check"' + (selIds[n.id] ? ' checked' : '') + '>' : '')
    /* 行首槽位对齐：caret 槽同宽占位 + 图标槽（kind 色点居中），与文件夹行标题起点一致 */
    + '<span class="caret-spacer"></span><span class="kind-slot"><span class="kind" style="background:' + (KCOLOR[n.kind] || KCOLOR.note) + '"></span></span>'
    + '<span class="ti">' + (isPinned(n) ? '<svg class="ic pin"><use href="#i-pin"/></svg> ' : '') + hl(n.title || '无标题', searchText) + '</span>'
    + (n.inject ? '<span style="color:var(--nacc);display:flex" title="注入为上下文 · ' + (n.injectRole === 'reference' ? '资料' : '约定') + '">' + icon('i-bolt', 10) + '</span>' : '')
    /* 曾注入徽章（injectEver 粘性标记：历史上开启过注入、现已关闭；已注入由 bolt 表达不重复显示；不满足不渲染） */
    + (!n.inject && n.injectEver === true ? '<span class="injevr" title="曾注入：历史上开启过上下文注入（现已关闭）">' + icon('i-clock', 9) + '</span>' : '')
    /* 使用遥测（P2）：被引用徽章（0 次不显示） */
    + ((n.useCount || 0) > 0 ? '<span class="use" title="被 Agent 引用（note_get 命中）' + n.useCount + ' 次">' + icon('i-quote', 9) + n.useCount + '</span>' : '')
    /* 双链标记（P2）：正文含 [[..]] 时行尾显示链接图标（缓存正文优先，preview 兜底） */
    + (hasWikiLinks(n) ? '<span class="wikimark" title="含双链 [[…]]（详情富文本中可点击跳转）">' + icon('i-link', 9) + '</span>' : '')
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
  /* 行主体单击=原地展开/折叠（事件委托处理）；行尾 vfilter 图标=进入/退出文件夹视图（不抢占单击） */
  h += '<div class="row head' + (view.type === 'folder' && view.id === f.id ? ' on' : '') + '" data-fold="' + f.id + '" data-drop="1" draggable="true">'
    + '<span class="caret' + (open ? ' open' : '') + '">' + icon('i-chev') + '</span>'
    + '<span class="ic-slot">' + icon('i-folder', 13) + '</span>'
    + '<span class="nm">' + esc(f.name) + '</span><span class="n">' + (filtering ? subHits : (f.count != null ? f.count : kids.length)) + '</span>'
    + '<span class="vfilter' + (view.type === 'folder' && view.id === f.id ? ' on' : '') + '" title="文件夹视图（含子孙文件夹）">' + icon('i-filter', 11) + '</span></div>';
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
  var vis = notes.filter(matches);
  /* 排序：缺省保持 host 序（pinned → updatedAt）；「按引用」= useCount 降序（同数按 updatedAt 兜底）；「相关度」= 标题命中>标签>正文（同级 updatedAt 降序），分组内顺序随过滤数组 */
  if (sortBy === 'use') vis.sort(function (a, b) { return ((b.useCount || 0) - (a.useCount || 0)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) });
  var qRel = searchText.trim().toLowerCase();
  if (sortBy === 'rel' && qRel) vis.sort(function (a, b) { return (relRank(b, qRel) - relRank(a, qRel)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) });
  $('brandCnt').textContent = (view.type === 'all' && filtersActiveCount() === 0 && !searchText ? notes.length : vis.length) + ' 条';
  /* 过滤激活（视图/筛选中心/搜索任一）：含命中的文件夹/主题强制展开（纯渲染态，不写回 foldOpen/topicOpen——清除过滤即恢复手动折叠态），分组计数切换为命中数 */
  var filtering = view.type !== 'all' || !!searchText || filtersActiveCount() > 0;
  var h = '';
  var vt = view.type === 'topic' ? ('主题 · ' + view.id) : view.type === 'folder' ? ('文件夹 · ' + fname(view.id)) : '全部笔记';
  h += '<div class="sec-h">' + icon('i-filter', 11) + esc(vt) + (view.type === 'topic' ? ' <span style="letter-spacing:0;text-transform:none;font-weight:500">（跨文件夹 ' + vis.length + ' 条）</span>' : '') + (view.type !== 'all' ? '<span class="add" id="viewClear" title="清除视图过滤">✕</span>' : '') + '</div>';
  /* 置顶聚合组（筛选中心「置顶」条件激活时不再重复展示） */
  if (!filters.pinned) {
    var pins = vis.filter(isPinned);
    if (pins.length) { h += '<div class="sec-h">' + icon('i-pin', 11) + ' 置顶<span class="cnt2">' + pins.length + '</span></div>'; pins.forEach(function (n) { h += noteRow(n, false) }) }
  }
  /* 文件夹组（嵌套递归：根级清单 → folderNodeHtml depth-first；悬空 parent 按根级防御） */
  h += '<div class="sec-h">文件夹<span class="add" id="addFolder" title="新建文件夹">' + icon('i-plus', 12) + '</span></div>';
  rootFolders().forEach(function (f) { h += folderNodeHtml(f, vis, filtering) });
  /* 未入夹笔记：根级同级直显（与文件夹行同一缩进层级，紧随文件夹列表之后、主题过滤区之前；无「未分类」分组头/分区计数——数量并入 brand 总计数；
     主题聚合由底部「主题过滤」区承担，不重复聚合）；.unfiled-drop 包裹容器 = 「移出文件夹」drop 落点（data-drop-out，拖到本区任意位置 = 移出）；
     空态非拖拽不渲染任何占位；拖拽中由 dragstart 委托点亮/补插落点容器（.drag-on 显示「拖到此处移出文件夹」提示行），dragend 清理 */
  var unfiled = vis.filter(function (n) { return !n.folder });
  if (unfiled.length) {
    h += '<div class="unfiled-drop" data-drop-out="1"><div class="unfiled-hint">拖到此处移出文件夹</div>';
    unfiled.forEach(function (n) { h += noteRow(n, false) });
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
  h += '<div class="sec-h" data-tsec="1" style="cursor:pointer"><span class="caret' + (tSecOpen ? ' open' : '') + '">' + icon('i-chev') + '</span>' + icon('i-topic', 11) + ' 主题 (' + (filtering ? topicHitCount : topicNames.length) + ')<span class="add" style="cursor:default">跨文件夹</span></div>';
  if (tSecOpen) topicNames.forEach(function (t) {
    var on = view.type === 'topic' && view.id === t;
    var tkids = vis.filter(function (n) { return (n.topic || '') === t });
    /* 过滤激活自动展开：含命中的主题行强制展开（不写回 topicOpen，清除过滤即恢复）；计数同步切换为命中数 */
    var tOpen = !!topicOpen[t] || (filtering && tkids.length > 0);
    /* 行主体单击=原地展开/收起该主题子列表（topicOpen，不持久化）；行尾 vfilter 图标=主题视图（跨文件夹过滤） */
    h += '<div class="row topic-row' + (on ? ' on' : '') + '" data-topic="' + esc(t) + '">'
      + '<span class="caret' + (tOpen ? ' open' : '') + '">' + icon('i-chev') + '</span>'
      + '<span class="ic-slot">' + icon('i-topic', 12) + '</span><span class="nm">' + esc(t) + '</span><span class="n">' + (filtering ? tkids.length : allTopics[t]) + '</span>'
      + '<span class="vfilter' + (on ? ' on' : '') + '" title="主题视图（跨文件夹过滤）">' + icon('i-filter', 11) + '</span></div>';
    if (tOpen && tkids.length) { h += '<div class="nested">'; tkids.forEach(function (n) { h += noteRow(n, false) }); h += '</div>' }
  });
  /* 空结果态：提示 + 「清空筛选条件」快捷链接（筛选中心口径⑦） */
  if (!vis.length) h += '<div class="sec-h" style="text-transform:none;letter-spacing:0">无匹配笔记' + (filtersActiveCount() ? ' · <span class="add" id="emptyClear" style="letter-spacing:0">清空筛选条件</span>' : '') + '</div>';
  $('tree').innerHTML = h;
  var vc = $('viewClear'); if (vc) vc.onclick = function () { view = { type: 'all', id: '' }; render() };
  var ec = $('emptyClear'); if (ec) ec.onclick = function () { clearFilters(); render(); renderFilterBar(); if (searchText.trim()) reSearch() };
  var af = $('addFolder'); if (af) af.onclick = function (ev) { ev.stopPropagation(); doCreateFolder() };
  $('btnSelMode').classList.toggle('on', selMode);
  /* 筛选中心控制行：按钮计数丸 / 激活 chips / 排序按钮 / popover 随每次树渲染同步（列表到达后 feature-detect 与命中数才准） */
  renderFilterBar();
  renderSelBar();
}
/* 多选操作条：已选 N 条 | 合并 | 删除 | 取消（多选态常显于左下角） */
function renderSelBar() {
  var n = Object.keys(selIds).length;
  $('selbar').style.display = selMode ? 'flex' : 'none';
  $('selbarN').textContent = '已选 ' + n + ' 条';
  $('selMerge').disabled = n < 2;
  $('selDelete').disabled = n < 1;
}
/* 树事件委托（挂一次；drag 事件均冒泡） */
$('tree').addEventListener('click', function (ev) {
  var vf = ev.target.closest('.vfilter');
  var frow = ev.target.closest('[data-fold]');
  /* 文件夹行：行尾过滤图标=进入/退出文件夹视图；行主体（含 caret）=原地展开/折叠（「点哪个展开哪个」） */
  if (vf && frow) { var fid = frow.dataset.fold; view = view.type === 'folder' && view.id === fid ? { type: 'all', id: '' } : { type: 'folder', id: fid }; foldOpen[fid] = true; saveFoldOpen(); render(); return }
  if (frow) { var f = frow.dataset.fold; foldOpen[f] = foldOpen[f] === false ? true : false; saveFoldOpen(); renderTree(); return }
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
    if (udrop0) { udrop0.classList.add('drag-on'); var uh0 = udrop0.querySelector('.unfiled-hint'); if (uh0) uh0.textContent = '拖到此处移回根级'; return }
    udrop0 = document.createElement('div');
    udrop0.className = 'unfiled-drop drag-on';
    udrop0.setAttribute('data-drop-out', '1');
    udrop0.innerHTML = '<div class="unfiled-hint">拖到此处移回根级</div>';
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
  udrop.innerHTML = '<div class="unfiled-hint">拖到此处移出文件夹</div>';
  $('tree').insertBefore(udrop, $('tree').querySelector('[data-tsec]'));
});
$('tree').addEventListener('dragend', function () {
  dragId = null; dragFolderId = null;
  document.querySelectorAll('.drop').forEach(function (e) { e.classList.remove('drop') });
  document.querySelectorAll('.unfiled-hint').forEach(function (el) { el.textContent = '拖到此处移出文件夹' });
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
    toast(folderId ? '已移动到「' + fname(folderId) + '」' : '已移出文件夹');
    loadNotes(true);
  }).catch(function (e) { toast('移动失败：' + (e && e.message || e)) });
}

