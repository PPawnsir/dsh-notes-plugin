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
  }).catch(function (e) { if (archState) { archState.groups = []; renderArchList(); modalErr('预览加载失败：' + (e && e.message || e)) } });
}
function archCheckedCount() { return archState && archState.groups ? archState.groups.filter(function (g) { return archState.checked[g.sessionId] !== false }).length : 0 }
function renderArchModal() {
  openModal(
    '<div class="modal-t">' + icon('i-check', 13) + ' 归档预览<span class="sub">勾选后才执行 · 合并可撤销</span></div>'
    + '<div class="modal-hint">速记按会话分组，勾选的组合并成一篇归档笔记（原笔记备份后软删除）。</div>'
    + '<div id="archList"><div class="modal-hint">加载中…</div></div>'
    + '<div class="modal-hint">手动笔记不受影响；如需合并手动笔记，请在列表多选后右键合并。</div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="archCancel">取消</button><button class="mbtn primary" id="archOk" disabled>归档所选</button></div>'
  );
  $('archCancel').onclick = function () { closeModal(); archState = null };
  $('archOk').onclick = doArchiveConfirm;
}
/* 组列表：复选框（缺省全勾）+ caret 展开成员明细（标题+日期）+ 组标题 + dateSpan · N 条 · totalBytes */
function renderArchList() {
  var host = $('archList'); if (!host || !archState) return;
  var gs = archState.groups || [];
  var ok = $('archOk');
  if (!gs.length) { host.innerHTML = '<div class="modal-hint">没有可归档的速记组（同一会话 ≥2 条速记才会成组）。</div>'; if (ok) { ok.disabled = true; ok.textContent = '归档所选（0 组）' } return }
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
      + '<span class="meta">' + esc(span) + ' · ' + g.members.length + ' 条 · ' + fmtBytes(g.totalBytes) + ((g.totalUseCount || 0) > 0 ? ' · 被引用 ' + g.totalUseCount + ' 次' : '') + '</span></div>'
      + (open ? '<div class="arch-members">' + g.members.map(function (m) { return '<div class="arch-member"><span class="ti">' + esc(m.title || '无标题') + '</span><span class="dt">' + esc(String(m.updatedAt || '').slice(0, 10)) + '</span></div>' }).join('') + '</div>' : '')
      + '</div>';
  });
  host.innerHTML = h + '</div>';
  if (ok) { ok.disabled = archCheckedCount() === 0; ok.textContent = '归档所选（' + archCheckedCount() + ' 组）' }
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
  archState.pending = true; var ok = $('archOk'); if (ok) { ok.disabled = true; ok.textContent = '归档中…' }
  /* payload 禁 undefined：白名单组不带 title（用 host 默认标题规则） */
  rpc('notes-archive', { groups: gs.map(function (g) { return { memberIds: g.members.map(function (m) { return m.id }) } }) }).then(function (res) {
    if (res && res.error) { archState.pending = false; modalErr(res.error); if (ok) { ok.disabled = false; ok.textContent = '归档所选（' + archCheckedCount() + ' 组）' } return }
    closeModal(); archState = null;
    toast('已合并 ' + (res && res.merged || 0) + ' 组', { label: '撤销', fn: doArchiveUndo });
    afterArchiveRefresh();
  }).catch(function (e) { if (archState) { archState.pending = false; modalErr('归档失败：' + (e && e.message || e)); if (ok) { ok.disabled = false; ok.textContent = '归档所选（' + archCheckedCount() + ' 组）' } } });
}
/* 撤销最近一次归档（undo 事务文件）：归档笔记软删 + 成员批量恢复 */
function doArchiveUndo() {
  rpc('notes-archive-undo', {}).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    toast(res && res.undone ? '已撤销归档' : '没有可撤销的归档');
    afterArchiveRefresh();
  }).catch(function (e) { toast('撤销失败：' + (e && e.message || e)) });
}
/* 多选合并：操作条「合并」→ 标题输入（默认 = 所选最早更新笔记的 topic）→ notes-archive 单组 */
function openMerge() {
  var ids = Object.keys(selIds);
  if (ids.length < 2) { toast('至少选择 2 条笔记'); return }
  var sel = notes.filter(function (n) { return selIds[n.id] }).sort(function (a, b) { return String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')) });
  openModal(
    '<div class="modal-t">' + icon('i-note', 13) + ' 合并所选笔记</div>'
    + '<div class="modal-hint">把所选的 ' + ids.length + ' 条笔记合并为一篇（正文按更新时间分节拼接，原笔记软删除，可撤销）。</div>'
    + '<input class="minput" id="mergeTitle" value="' + esc((sel[0] && sel[0].topic) || '合并笔记') + '" placeholder="合并后标题…">'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="mgCancel">取消</button><button class="mbtn primary" id="mgOk">合并</button></div>'
  );
  $('mgCancel').onclick = closeModal;
  $('mgOk').onclick = doMergeConfirm;
  var ti = $('mergeTitle'); ti.focus();
  ti.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); doMergeConfirm() } };
}
function doMergeConfirm() {
  var ids = Object.keys(selIds);
  var t = $('mergeTitle').value.trim();
  if (ids.length < 2 || !t) return;
  var g = { memberIds: ids }; if (t) g.title = t;   /* payload 禁 undefined：空标题不传 title 字段 */
  $('mgOk').disabled = true; $('mgOk').textContent = '合并中…';
  rpc('notes-archive', { groups: [g] }).then(function (res) {
    if (res && res.error) { modalErr(res.error); $('mgOk').disabled = false; $('mgOk').textContent = '合并'; return }
    closeModal();
    selMode = false; selIds = {}; renderTree();
    toast('已合并所选 ' + ids.length + ' 条', { label: '撤销', fn: doArchiveUndo });
    afterArchiveRefresh();
  }).catch(function (e) { modalErr('合并失败：' + (e && e.message || e)); $('mgOk').disabled = false; $('mgOk').textContent = '合并' });
}
/* 多选批量删除（软删进回收站，与整理建议器批量软删同通道）：confirm 注明可恢复 → 逐条 notes-delete → 退出多选态 + 刷新 */
function doSelBatchDelete() {
  var ids = Object.keys(selIds);
  if (!ids.length) return;
  if (!confirm('批量删除：所选的 ' + ids.length + ' 条笔记将移入回收站（可在回收站恢复）。\n确认删除？')) return;
  var ok = 0, fail = 0, chain = Promise.resolve();
  ids.forEach(function (id) {
    chain = chain.then(function () {
      return rpc('notes-delete', { id: id }).then(function (res) { if (res && res.error) fail++; else ok++ }, function () { fail++ });
    });
  });
  chain.then(function () {
    selMode = false; selIds = {};
    toast('已删除 ' + ok + ' 条（可在回收站恢复）' + (fail ? '，失败 ' + fail + ' 条' : ''));
    afterArchiveRefresh();   /* 正打开的笔记在被删集合中则回空态（归档/合并同款收尾） */
  });
}

