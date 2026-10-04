/* ================= P1 回收站（侧栏底部「回收站」入口）：notes-list {includeDeleted:true} 过滤 deleted → 恢复（notes-restore）/ 彻底删除（notes-purge） =================
   回收站增强（notes-trash-batch-preview）：批量选择/全选 + 批量恢复/批量彻底删除 + 行内容只读预览——
   批量条 = 全选 + 选中计数 + 恢复所选/彻底删除所选；行 = 勾选框 + 标题（点击预览）+ 删除时间 + 预览/恢复/彻底删除；
   彻底删除双确认：点「彻底删除」→ confirm「彻底删除不可恢复」确认才执行（批量同款口径 + 条数 + 含历史版本）；host 侧安全闸只接受已软删除的笔记；
   行预览 = notes-get {id, includeDeleted:true} 取已删正文 → renderMarkdown 只读渲染（esc 先行，零注入面）。 */
function openTrash() {
  trashState = { list: null, pending: '', sel: {}, preview: null };
  openModal(
    '<div class="modal-t">' + icon('i-trash', 13) + ' 回收站<span class="sub">软删除的笔记 · 恢复可找回 · 彻底删除不可恢复</span></div>'
    + '<div id="trashList"><div class="modal-hint">加载中…</div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="trashClose">关闭</button></div>'
  );
  $('modal').classList.add('trash');
  $('trashClose').onclick = function () { if (!trashState || !trashState.pending) { closeModal(); trashState = null } };
  loadTrash();
}
function loadTrash() {
  rpc('notes-list', { includeDeleted: true }).then(function (res) {
    if (!trashState) return;
    if (res && res.error) { trashState.list = []; renderTrashList(); modalErr(res.error); return }
    trashState.list = ((res && res.notes) || []).filter(function (n) { return n.deleted === true });
    trashState.list.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) });   /* 删除时间（updatedAt 近似）降序 */
    /* 列表刷新后清洗勾选/预览态：已不在回收站的 id 剔除（单条恢复/彻底删除后残留勾选会误伤后续批量操作） */
    var alive = {}; trashState.list.forEach(function (n) { alive[n.id] = true });
    Object.keys(trashState.sel).forEach(function (id) { if (!alive[id]) delete trashState.sel[id] });
    if (trashState.preview && !alive[trashState.preview.id]) trashState.preview = null;
    renderTrashList();
  }).catch(function (e) { if (trashState) { trashState.list = []; renderTrashList(); modalErr('加载失败：' + (e && e.message || e)) } });
}
/* 回收站列表（复用归档预览的列表样式 arch-list/arch-row）：批量条（全选 + 计数 + 批量恢复/彻底删除）+ 行 = 勾选 + 标题（点击预览）+ 删除时间 + 预览/恢复/彻底删除按钮 */
function renderTrashList() {
  var host = $('trashList'); if (!host || !trashState) return;
  var list = trashState.list || [];
  if (!list.length) { host.innerHTML = '<div class="modal-hint">回收站为空（删除的笔记会出现在这里）。</div>'; return }
  var selCnt = Object.keys(trashState.sel).length;
  var allChecked = list.every(function (n) { return trashState.sel[n.id] });
  host.innerHTML = '<div class="trash-batch">'
      + '<label class="trash-all"><input type="checkbox" id="trashAll"' + (allChecked ? ' checked' : '') + (trashState.pending ? ' disabled' : '') + '>全选</label>'
      + '<span class="selcnt">' + ('已选 ' + selCnt + ' 条') + '</span>'
      + '<button class="mbtn trash-act" id="trashRestoreBatch"' + (trashState.pending || selCnt < 1 ? ' disabled' : '') + '>恢复所选</button>'
      + '<button class="mbtn danger trash-act" id="trashPurgeBatch"' + (trashState.pending || selCnt < 1 ? ' disabled' : '') + '>彻底删除所选</button></div>'
    + '<div class="arch-list">'
    + list.map(function (n) {
        var pv = trashState.preview && trashState.preview.id === n.id ? trashState.preview : null;
        var html = '<div class="arch-row"><input type="checkbox" class="trash-check" data-id="' + esc(n.id) + '"' + (trashState.sel[n.id] ? ' checked' : '') + (trashState.pending ? ' disabled' : '') + '>'
          + '<span class="ti trash-ti" data-id="' + esc(n.id) + '" title="' + esc(n.title || 'Untitled') + '（点击预览正文，只读）">' + esc(n.title || 'Untitled') + '</span>'
          + '<span class="meta">删于 ' + esc(n.updatedAt ? String(n.updatedAt).slice(0, 10) : '—') + '</span>'
          + '<button class="mbtn trash-act" data-id="' + esc(n.id) + '" data-act="preview"' + (trashState.pending ? ' disabled' : '') + '>' + (pv ? '收起' : '预览') + '</button>'
          + '<button class="mbtn trash-act" data-id="' + esc(n.id) + '" data-act="restore"' + (trashState.pending ? ' disabled' : '') + '>恢复</button>'
          + '<button class="mbtn danger trash-act" data-id="' + esc(n.id) + '" data-act="purge"' + (trashState.pending ? ' disabled' : '') + '>彻底删除</button></div>';
        /* 行内只读预览：正文只经 renderMarkdown 内核渲染（全量转义，esc 先行零注入面）；加载/错误态经 esc() 文本插入 */
        if (pv) html += '<div class="trash-preview rich">' + (typeof pv.body === 'string' ? renderMarkdown(pv.body, wikiResolve) : '<span class="modal-hint">' + esc(pv.error || '预览加载中…') + '</span>') + '</div>';
        return html
      }).join('') + '</div>';
  $('trashAll').onchange = toggleTrashAll;
  $('trashRestoreBatch').onclick = doTrashRestoreBatch;
  $('trashPurgeBatch').onclick = doTrashPurgeBatch;
  host.querySelectorAll('.trash-check').forEach(function (el) { el.onchange = function () { toggleTrashSel(el.dataset.id) } });
  host.querySelectorAll('.trash-ti').forEach(function (el) { el.onclick = function () { toggleTrashPreview(el.dataset.id) } });
  host.querySelectorAll('.trash-act[data-act]').forEach(function (el) {
    el.onclick = function () {
      var id = el.dataset.id, n = list.find(function (x) { return x.id === id });
      if (el.dataset.act === 'restore') doTrashRestore(id);
      else if (el.dataset.act === 'purge') doTrashPurge(id, n && n.title);
      else toggleTrashPreview(id);
    };
  });
}
/* 行勾选/全选（trashState.sel: id→true；全选 = 当前列表全部勾选时再点则清空） */
function toggleTrashSel(id) { if (!trashState || trashState.pending) return; if (trashState.sel[id]) delete trashState.sel[id]; else trashState.sel[id] = true; renderTrashList() }
function toggleTrashAll() {
  if (!trashState || !trashState.list || trashState.pending) return;
  var all = trashState.list.length > 0 && trashState.list.every(function (n) { return trashState.sel[n.id] });
  trashState.sel = {};
  if (!all) trashState.list.forEach(function (n) { trashState.sel[n.id] = true });
  renderTrashList();
}
/* 行预览：notes-get {id, includeDeleted:true}（host includeDeleted 路径，已删正文只读可达；墓碑仍拒绝）→ renderMarkdown 只读渲染；再点收起 */
function toggleTrashPreview(id) {
  if (!trashState) return;
  if (trashState.preview && trashState.preview.id === id) { trashState.preview = null; renderTrashList(); return }
  trashState.preview = { id: id, body: null, error: '' };
  renderTrashList();
  rpc('notes-get', { id: id, includeDeleted: true }).then(function (res) {
    if (!trashState || !trashState.preview || trashState.preview.id !== id) return;
    if (res && res.note && typeof res.note.body === 'string') trashState.preview.body = res.note.body;
    else trashState.preview.error = '预览失败：' + ((res && res.error) || '无正文');
    renderTrashList();
  }).catch(function (e) {
    if (!trashState || !trashState.preview || trashState.preview.id !== id) return;
    trashState.preview.error = '预览失败：' + (e && e.message || e);
    renderTrashList();
  });
}
function doTrashRestore(id) {
  if (!trashState || trashState.pending) return;
  trashState.pending = id; renderTrashList();
  rpc('notes-restore', { id: id }).then(function (res) {
    if (!trashState) return;
    trashState.pending = '';
    if (res && res.error) { modalErr(res.error); renderTrashList(); return }
    toast('已恢复');
    loadTrash(); loadNotes(true);
  }).catch(function (e) { if (trashState) { trashState.pending = ''; modalErr('恢复失败：' + (e && e.message || e)); renderTrashList() } });
}
function doTrashPurge(id, title) {
  if (!trashState || trashState.pending) return;
  if (!confirm('彻底删除不可恢复：「' + (title || id) + '」\n删除后正文与归档备份将一并移除，确认彻底删除？')) return;
  trashState.pending = id; renderTrashList();
  rpc('notes-purge', { id: id }).then(function (res) {
    if (!trashState) return;
    trashState.pending = '';
    if (res && res.error) { modalErr(res.error); renderTrashList(); return }
    toast('已彻底删除');
    loadTrash(); loadNotes(true);
  }).catch(function (e) { if (trashState) { trashState.pending = ''; modalErr('删除失败：' + (e && e.message || e)); renderTrashList() } });
}
/* 批量恢复：confirm 后逐条 notes-restore（单条失败计数不中断）；完成后清空勾选/预览 + 刷新 */
function doTrashRestoreBatch() {
  if (!trashState || trashState.pending) return;
  var ids = Object.keys(trashState.sel);
  if (!ids.length) return;
  if (!confirm('批量恢复：所选的 ' + ids.length + ' 条笔记将移出回收站（恢复后回到正常列表）。\n确认恢复？')) return;
  trashState.pending = 'batch'; renderTrashList();
  var ok = 0, fail = 0, seq = Promise.resolve();
  ids.forEach(function (id) {
    seq = seq.then(function () {
      return rpc('notes-restore', { id: id }).then(function (res) { if (res && res.error) fail++; else ok++ }, function () { fail++ });
    });
  });
  seq.then(function () {
    if (!trashState) return;
    trashState.pending = ''; trashState.sel = {}; trashState.preview = null;
    toast('已恢复 ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''));
    loadTrash(); loadNotes(true);
  });
}
/* 批量彻底删除：confirm 双确认（「不可恢复 + 含历史版本」+ 条数，与单条同口径）→ 逐条 notes-purge（host 安全闸仅限已软删除） */
function doTrashPurgeBatch() {
  if (!trashState || trashState.pending) return;
  var ids = Object.keys(trashState.sel);
  if (!ids.length) return;
  if (!confirm('批量彻底删除：所选的 ' + ids.length + ' 条笔记将彻底删除，不可恢复（含历史版本）。\n删除后正文、历史版本快照与归档备份将一并移除，确认彻底删除？')) return;
  trashState.pending = 'batch'; renderTrashList();
  var ok = 0, fail = 0, seq = Promise.resolve();
  ids.forEach(function (id) {
    seq = seq.then(function () {
      return rpc('notes-purge', { id: id }).then(function (res) { if (res && res.error) fail++; else ok++ }, function () { fail++ });
    });
  });
  seq.then(function () {
    if (!trashState) return;
    trashState.pending = ''; trashState.sel = {}; trashState.preview = null;
    toast('已彻底删除 ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''));
    loadTrash(); loadNotes(true);
  });
}

