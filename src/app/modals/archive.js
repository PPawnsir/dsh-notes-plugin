/* ================= 显式归档：预览对话框（勾选才执行）+ toast 撤销 + 多选合并 ================= */
function fmtBytes(n) { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB' }
/* token 数人性化（设置卡片「LLM 用量」区）：≥1M → 1.23M，≥10k → 12.3k，其余原样 */
function fmtTok(n) { n = Math.round(+n || 0); return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n) }
function openArchive() {
  archState = { groups: null, checked: {}, expand: {}, pending: false };
  renderArchModal();
  rpc('notes-archive-preview', {}).then(function (res) {
    if (!archState) return;
    if (res && res.error) { archState.groups = []; renderArchList(); modalErr(res.error); return }
    archState.groups = (res && res.quickGroups) || [];
    renderArchList();
  }).catch(function (e) { if (archState) { archState.groups = []; renderArchList(); modalErr(t('arch.previewFailed', { msg: e && e.message || e })) } });
}
function archCheckedCount() { return archState && archState.groups ? archState.groups.filter(function (g) { return archState.checked[g.sessionId] !== false }).length : 0 }
function renderArchModal() {
  openModal(
    '<div class="modal-t">' + icon('i-check', 13) + ' ' + t('arch.title') + '<span class="sub">' + t('arch.sub') + '</span></div>'
    + '<div class="modal-hint">' + t('arch.hint') + '</div>'
    + '<div id="archList"><div class="modal-hint">' + t('common.loading') + '</div></div>'
    + '<div class="modal-hint">' + t('arch.manualHint') + '</div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="archCancel">' + t('common.cancel') + '</button><button class="mbtn primary" id="archOk" disabled>' + t('arch.ok') + '</button></div>'
  );
  $('archCancel').onclick = function () { closeModal(); archState = null };
  $('archOk').onclick = doArchiveConfirm;
}
/* 组列表：复选框（缺省全勾）+ caret 展开成员明细（标题+日期）+ 组标题 + dateSpan · N 条 · totalBytes */
function renderArchList() {
  var host = $('archList'); if (!host || !archState) return;
  var gs = archState.groups || [];
  var ok = $('archOk');
  if (!gs.length) { host.innerHTML = '<div class="modal-hint">' + t('arch.empty') + '</div>'; if (ok) { ok.disabled = true; ok.textContent = t('arch.okCount', { n: 0 }) } return }
  var h = '<div class="arch-list">';
  gs.forEach(function (g) {
    var ck = archState.checked[g.sessionId] !== false;
    var open = archState.expand[g.sessionId] === true;
    var span = g.dateSpan && g.dateSpan.from ? (g.dateSpan.from === g.dateSpan.to ? g.dateSpan.from : g.dateSpan.from + ' ~ ' + g.dateSpan.to) : '';
    h += '<div class="arch-group' + (ck ? '' : ' off') + '">'
      + '<div class="arch-row">'
      + '<input type="checkbox" class="arch-check" data-sid="' + esc(g.sessionId) + '"' + (ck ? ' checked' : '') + '>'
      + '<span class="caret' + (open ? ' open' : '') + '" data-exp="' + esc(g.sessionId) + '">' + icon('i-chev', 10) + '</span>'
      + '<span class="ti" title="' + esc(g.title) + '">' + esc(g.title) + '</span>'
      + '<span class="meta">' + esc(t('arch.groupMeta', { span: span, n: g.members.length, size: fmtBytes(g.totalBytes) })) + ((g.totalUseCount || 0) > 0 ? esc(t('arch.groupUseCount', { n: g.totalUseCount })) : '') + '</span></div>'
      + (open ? '<div class="arch-members">' + g.members.map(function (m) { return '<div class="arch-member"><span class="ti">' + esc(m.title || t('tree.untitled')) + '</span><span class="dt">' + esc(fmtDT(m.updatedAt).slice(0, 10)) + '</span></div>' }).join('') + '</div>' : '')
      + '</div>';
  });
  host.innerHTML = h + '</div>';
  if (ok) { ok.disabled = archCheckedCount() === 0; ok.textContent = t('arch.okCount', { n: archCheckedCount() }) }
  host.querySelectorAll('.arch-check').forEach(function (el) { el.onchange = function () { archState.checked[el.dataset.sid] = el.checked; renderArchList() } });
  host.querySelectorAll('[data-exp]').forEach(function (el) { el.onclick = function () { var sid = el.dataset.exp; archState.expand[sid] = !archState.expand[sid]; renderArchList() } });
}
/* 归档/合并后公共收尾：被合并笔记从列表消失——若正打开的笔记被合并则回空态；静默刷新列表 */
function afterArchiveRefresh() {
  loadNotes(true).then(function () {
    if (selId && !notes.some(function (n) { return n.id === selId })) { selId = null; edNote = null; renderEd() }
    render();
  });
}
/* 确认归档：勾选组 → notes-archive 白名单组（host 先全量校验再动手）→ toast「已合并 N 组」+ 撤销按钮 */
function doArchiveConfirm() {
  if (!archState || archState.pending) return;
  var gs = (archState.groups || []).filter(function (g) { return archState.checked[g.sessionId] !== false });
  if (!gs.length) return;
  archState.pending = true; var ok = $('archOk'); if (ok) { ok.disabled = true; ok.textContent = t('arch.archiving') }
  /* payload 禁 undefined：白名单组不带 title（用 host 默认标题规则） */
  rpc('notes-archive', { groups: gs.map(function (g) { return { memberIds: g.members.map(function (m) { return m.id }) } }) }).then(function (res) {
    if (res && res.error) { archState.pending = false; modalErr(res.error); if (ok) { ok.disabled = false; ok.textContent = t('arch.okCount', { n: archCheckedCount() }) } return }
    closeModal(); archState = null;
    toast(t('arch.merged', { n: res && res.merged || 0 }), { label: t('meta.undo'), fn: doArchiveUndo });
    afterArchiveRefresh();
  }).catch(function (e) { if (archState) { archState.pending = false; modalErr(t('arch.failed', { msg: e && e.message || e })); if (ok) { ok.disabled = false; ok.textContent = t('arch.okCount', { n: archCheckedCount() }) } } });
}
/* 撤销最近一次归档（undo 事务文件）：归档笔记软删 + 成员批量恢复 */
function doArchiveUndo() {
  rpc('notes-archive-undo', {}).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    toast(res && res.undone ? t('arch.undone') : t('arch.noUndo'));
    afterArchiveRefresh();
  }).catch(function (e) { toast(t('arch.undoFailed', { msg: e && e.message || e })) });
}
/* 多选合并：操作条「合并」→ 标题输入（默认 = 所选最早更新笔记的 topic）→ notes-archive 单组 */
function openMerge() {
  var ids = Object.keys(selIds);
  if (ids.length < 2) { toast(t('arch.needTwo')); return }
  var sel = notes.filter(function (n) { return selIds[n.id] }).sort(function (a, b) { return String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')) });
  openModal(
    '<div class="modal-t">' + icon('i-note', 13) + ' ' + t('arch.mergeTitle') + '</div>'
    + '<div class="modal-hint">' + t('arch.mergeHint', { n: ids.length }) + '</div>'
    + '<input class="minput" id="mergeTitle" value="' + esc((sel[0] && sel[0].topic) || t('arch.mergeDefault')) + '" placeholder="' + t('arch.mergePlaceholder') + '">'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="mgCancel">' + t('common.cancel') + '</button><button class="mbtn primary" id="mgOk">' + t('sel.merge') + '</button></div>'
  );
  $('mgCancel').onclick = closeModal;
  $('mgOk').onclick = doMergeConfirm;
  var ti = $('mergeTitle'); ti.focus();
  ti.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doMergeConfirm() } };
}
function doMergeConfirm() {
  var ids = Object.keys(selIds);
  var mt = $('mergeTitle').value.trim();   /* 局部改名 mt：i18n 覆盖卡E 起全局 t() 为字典取值函数，原局部 t 会遮蔽 */
  if (ids.length < 2 || !mt) return;
  var g = { memberIds: ids }; if (mt) g.title = mt;   /* payload 禁 undefined：空标题不传 title 字段 */
  $('mgOk').disabled = true; $('mgOk').textContent = t('arch.merging');
  rpc('notes-archive', { groups: [g] }).then(function (res) {
    if (res && res.error) { modalErr(res.error); $('mgOk').disabled = false; $('mgOk').textContent = t('sel.merge'); return }
    closeModal();
    selMode = false; selIds = {}; renderTree();
    toast(t('arch.mergedSel', { n: ids.length }), { label: t('meta.undo'), fn: doArchiveUndo });
    afterArchiveRefresh();
  }).catch(function (e) { modalErr(t('arch.mergeFailed', { msg: e && e.message || e })); $('mgOk').disabled = false; $('mgOk').textContent = t('sel.merge') });
}
/* 多选批量删除（软删进回收站，与整理建议器批量软删同通道）：确认强度 = 不可恢复性（notes-034-c-confirm）——
   软删可恢复 → 轻：无 confirm 直接删，撤销 toast 兜底（逐条 notes-restore；回收站亦可恢复）；不可恢复的 purge 才保留双确认 */
function doSelBatchDelete() {
  var ids = Object.keys(selIds);
  if (!ids.length) return;
  var ok = 0, fail = 0, okIds = [], chain = Promise.resolve();
  ids.forEach(function (id) {
    chain = chain.then(function () {
      return rpc('notes-delete', { id: id }).then(function (res) { if (res && res.error) fail++; else { ok++; okIds.push(id) } }, function () { fail++ });
    });
  });
  chain.then(function () {
    selMode = false; selIds = {};
    toast(t('arch.deletedBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''), okIds.length ? { label: t('meta.undo'), fn: function () { undoBatchDelete(okIds) } } : undefined);
    afterArchiveRefresh();   /* 正打开的笔记在被删集合中则回空态（归档/合并同款收尾） */
  });
}
/* 批量软删撤销：逐条 notes-restore 恢复本次成功删除的笔记（单条删除撤销链路的批量复用） */
function undoBatchDelete(ids) {
  var ok = 0, fail = 0, chain = Promise.resolve();
  ids.forEach(function (id) {
    chain = chain.then(function () {
      return rpc('notes-restore', { id: id }).then(function (res) { if (res && res.error) fail++; else ok++ }, function () { fail++ });
    });
  });
  chain.then(function () { toast(t('common.restoredBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : '')); loadNotes(true); });
}

