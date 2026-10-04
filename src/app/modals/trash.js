/* ================= P1 回收站（侧栏底部「回收站」入口）：notes-list {includeDeleted:true} 过滤 deleted → 恢复（notes-restore）/ 彻底删除（notes-purge） =================
   回收站增强（notes-trash-batch-preview）：批量选择/全选 + 批量恢复/批量彻底删除 + 行内容只读预览——
   批量条 = 全选 + 选中计数 + 恢复所选/彻底删除所选；行 = 勾选框 + 标题（点击预览）+ 删除时间 + 预览/恢复/彻底删除；
   彻底删除双确认：点「彻底删除」→ confirm「彻底删除不可恢复」确认才执行（批量同款口径 + 条数 + 含历史版本）；host 侧安全闸只接受已软删除的笔记；
   确认强度 = 不可恢复性（notes-034-c-confirm）：purge 不可恢复 → 重（双确认保留）；软删可恢复 → 轻（列表侧删除已无 confirm，撤销 toast 兜底）；
   行预览 = notes-get {id, includeDeleted:true} 取已删正文 → renderMarkdown 只读渲染（esc 先行，零注入面）。 */
function openTrash() {
  trashState = { list: null, pending: '', sel: {}, preview: null };
  openModal(
    '<div class="modal-t">' + icon('i-trash', 13) + ' ' + t('topbar.trash') + '<span class="sub">' + t('trash.sub') + '</span></div>'
    + '<div id="trashList"><div class="modal-hint">' + t('common.loading') + '</div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="trashClose">' + t('common.close') + '</button></div>'
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
  }).catch(function (e) { if (trashState) { trashState.list = []; renderTrashList(); modalErr(t('inj.loadFailed', { msg: e && e.message || e })) } });
}
/* 回收站列表（复用归档预览的列表样式 arch-list/arch-row）：批量条（全选 + 计数 + 批量恢复/彻底删除）+ 行 = 勾选 + 标题（点击预览）+ 删除时间 + 预览/恢复/彻底删除按钮 */
function renderTrashList() {
  var host = $('trashList'); if (!host || !trashState) return;
  var list = trashState.list || [];
  if (!list.length) { host.innerHTML = '<div class="modal-hint">' + t('trash.empty') + '</div>'; return }
  var selCnt = Object.keys(trashState.sel).length;
  var allChecked = list.every(function (n) { return trashState.sel[n.id] });
  host.innerHTML = '<div class="trash-batch">'
      + '<label class="trash-all"><input type="checkbox" id="trashAll"' + (allChecked ? ' checked' : '') + (trashState.pending ? ' disabled' : '') + '>' + t('inj.selectAll') + '</label>'
      + '<span class="selcnt">' + t('sel.selCount', { n: selCnt }) + '</span>'
      + '<button class="mbtn trash-act" id="trashRestoreBatch"' + (trashState.pending || selCnt < 1 ? ' disabled' : '') + '>' + t('trash.restoreSel') + '</button>'
      + '<button class="mbtn danger trash-act" id="trashPurgeBatch"' + (trashState.pending || selCnt < 1 ? ' disabled' : '') + '>' + t('trash.purgeSel') + '</button></div>'
    + '<div class="arch-list">'
    + list.map(function (n) {
        var pv = trashState.preview && trashState.preview.id === n.id ? trashState.preview : null;
        var html = '<div class="arch-row"><input type="checkbox" class="trash-check" data-id="' + esc(n.id) + '"' + (trashState.sel[n.id] ? ' checked' : '') + (trashState.pending ? ' disabled' : '') + '>'
          + '<span class="ti trash-ti" data-id="' + esc(n.id) + '" title="' + esc(t('trash.titleTip', { title: n.title || 'Untitled' })) + '">' + esc(n.title || 'Untitled') + '</span>'
          + '<span class="meta">' + esc(t('trash.deletedAt', { time: n.updatedAt ? fmtDT(n.updatedAt).slice(0, 10) : '—' })) + '</span>'
          + '<button class="mbtn trash-act" data-id="' + esc(n.id) + '" data-act="preview"' + (trashState.pending ? ' disabled' : '') + '>' + (pv ? t('trash.collapse') : t('trash.preview')) + '</button>'
          + '<button class="mbtn trash-act" data-id="' + esc(n.id) + '" data-act="restore"' + (trashState.pending ? ' disabled' : '') + '>' + t('trash.restore') + '</button>'
          + '<button class="mbtn danger trash-act" data-id="' + esc(n.id) + '" data-act="purge"' + (trashState.pending ? ' disabled' : '') + '>' + t('trash.purge') + '</button></div>';
        /* 行内只读预览：正文只经 renderMarkdown 内核渲染（全量转义，esc 先行零注入面）；加载/错误态经 esc() 文本插入 */
        if (pv) html += '<div class="trash-preview rich">' + (typeof pv.body === 'string' ? renderMarkdown(pv.body, wikiResolve) : '<span class="modal-hint">' + esc(pv.error || t('trash.previewLoading')) + '</span>') + '</div>';
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
    else trashState.preview.error = t('trash.previewFailed', { msg: (res && res.error) || t('trash.noBody') });
    renderTrashList();
  }).catch(function (e) {
    if (!trashState || !trashState.preview || trashState.preview.id !== id) return;
    trashState.preview.error = t('trash.previewFailed', { msg: e && e.message || e });
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
    toast(t('meta.restored'));
    loadTrash(); loadNotes(true);
  }).catch(function (e) { if (trashState) { trashState.pending = ''; modalErr(t('meta.restoreFailed', { msg: e && e.message || e })); renderTrashList() } });
}
function doTrashPurge(id, title) {
  if (!trashState || trashState.pending) return;
  if (!confirm(t('trash.purgeConfirm', { title: title || id }))) return;
  trashState.pending = id; renderTrashList();
  rpc('notes-purge', { id: id }).then(function (res) {
    if (!trashState) return;
    trashState.pending = '';
    if (res && res.error) { modalErr(res.error); renderTrashList(); return }
    toast(t('trash.purged'));
    loadTrash(); loadNotes(true);
  }).catch(function (e) { if (trashState) { trashState.pending = ''; modalErr(t('meta.deleteFailed', { msg: e && e.message || e })); renderTrashList() } });
}
/* 批量恢复：confirm 后逐条 notes-restore（单条失败计数不中断）；完成后清空勾选/预览 + 刷新 */
function doTrashRestoreBatch() {
  if (!trashState || trashState.pending) return;
  var ids = Object.keys(trashState.sel);
  if (!ids.length) return;
  if (!confirm(t('trash.restoreBatchConfirm', { n: ids.length }))) return;
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
    toast(t('common.restoredBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''));
    loadTrash(); loadNotes(true);
  });
}
/* 批量彻底删除：confirm 双确认（「不可恢复 + 含历史版本」+ 条数，与单条同口径）→ 逐条 notes-purge（host 安全闸仅限已软删除） */
function doTrashPurgeBatch() {
  if (!trashState || trashState.pending) return;
  var ids = Object.keys(trashState.sel);
  if (!ids.length) return;
  if (!confirm(t('trash.purgeBatchConfirm', { n: ids.length }))) return;
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
    toast(t('trash.purgedBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''));
    loadTrash(); loadNotes(true);
  });
}

