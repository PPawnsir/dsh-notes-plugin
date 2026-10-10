/* ================= 历史版本面板（notes-history-ui）：notes-history 列表（倒序零正文）→ notes-history-get 预览（只读）→ notes-restore-history 一键恢复 ================= */
/* 恢复的安全核心在 host：恢复前当前版本自动快照进 .history——恢复动作本身可撤销（再恢复一次即回滚） */
function fmtHistTs(ts) { var d = new Date(+ts || 0); if (isNaN(d.getTime())) return String(ts); function p(x) { return ('0' + x).slice(-2) } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) }
function probeHistCount(id) {
  if (!id) return;
  rpc('notes-history', { id: id }).then(function (res) {
    if (res && !res.error && selId === id) { var c = (res.versions || []).length; if (histCount !== c) { histCount = c; if (edNote) renderMeta() } }
  }).catch(function () {});
}
function openHistory() {
  if (!edNote || !selId) { toast('先选择一条笔记'); return }
  histState = { list: null, sel: 0, preview: null, pending: false };
  openModal('<div class="modal-t">' + icon('i-clock', 13) + ' 历史版本<span class="sub">每次保存自动留快照 · 恢复前当前版本会先自动快照，可再撤销</span></div>'
    + '<div class="hist-body"><div class="hist-list" id="histList"></div><div class="hist-view" id="histView"></div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="histClose">关闭</button><button class="mbtn primary" id="histRestore" disabled>恢复此版本</button></div>');
  $('modal').classList.add('hist');
  $('histClose').onclick = closeModal;
  $('histRestore').onclick = doRestoreHistory;
  rpc('notes-history', { id: selId }).then(function (res) {
    if (!histState || !$('histList')) return;
    if (res && res.error) { modalErr(res.error); histState.list = []; }
    else { histState.list = (res && res.versions) || []; histCount = histState.list.length; }
    renderHistList(); renderHistView();
    if (histState.list.length) selectHistVersion(histState.list[0].ts);   /* 默认选中最新版预览 */
  }).catch(function (e) { modalErr('历史版本加载失败：' + (e && e.message || e)) });
}
function renderHistList() {
  var el = $('histList'); if (!el || !histState) return;
  if (histState.list === null) { el.innerHTML = '<div class="modal-hint">加载中…</div>'; return }
  if (!histState.list.length) { el.innerHTML = '<div class="modal-hint">暂无历史版本（每次保存自动留快照）</div>'; return }
  el.innerHTML = histState.list.map(function (v) {
    return '<div class="hist-item' + (histState.sel === v.ts ? ' on' : '') + '" data-ts="' + v.ts + '"><div class="hist-item-t">' + esc(fmtHistTs(v.ts)) + '</div><div class="hist-item-b">' + esc(fmtBytes(v.bytes)) + '</div></div>';
  }).join('');
  el.querySelectorAll('.hist-item').forEach(function (it) { it.onclick = function () { selectHistVersion(+it.dataset.ts) } });
}
function renderHistView() {
  var el = $('histView'); if (!el || !histState) return;
  var rb = $('histRestore'); if (rb) rb.disabled = !histState.sel || histState.pending;
  if (!histState.sel) { el.innerHTML = '<div class="modal-hint">选择左侧版本查看预览（只读）</div>'; return }
  if (!histState.preview) { el.innerHTML = '<div class="modal-hint">预览加载中…</div>'; return }
  el.innerHTML = '<div class="hist-preview rich">' + renderMarkdown(histState.preview.body || '', wikiResolve, { secretStatic: true, secretLabel: t('editor.secretPlaceholder') }) + '</div>';   /* 文档安全 S1：只读预览机密块走静态占位（无揭示交互，保守面） */
}
function selectHistVersion(ts) {
  if (!histState) return;
  histState.sel = ts; histState.preview = null;
  renderHistList(); renderHistView();
  rpc('notes-history-get', { id: selId, ts: ts }).then(function (res) {
    if (!histState || histState.sel !== ts) return;
    if (res && res.error) { modalErr(res.error); return }
    histState.preview = { ts: ts, body: (res && res.body) || '' };
    renderHistView();
  }).catch(function (e) { modalErr('预览加载失败：' + (e && e.message || e)) });
}
function doRestoreHistory() {
  if (!histState || histState.pending || !histState.sel) return;
  var ts = histState.sel;
  if (!confirm('恢复到 ' + fmtHistTs(ts) + ' 的版本？\n当前版本会先自动快照进历史版本，可再撤销（重新打开历史恢复回滚）。')) return;
  histState.pending = true; var rb = $('histRestore'); rb.disabled = true; rb.textContent = '恢复中…';
  rpc('notes-restore-history', { id: selId, ts: ts }).then(function (res) {
    if (res && res.error) {
      modalErr(res.error);
      if (histState) { histState.pending = false; var rb2 = $('histRestore'); if (rb2) { rb2.disabled = false; rb2.textContent = '恢复此版本' } }
      return;
    }
    closeModal(); histState = null;
    toast('已恢复到 ' + fmtHistTs(ts) + ' 的版本（原当前版已自动快照，可再恢复回滚）');
    refreshSelected(); loadNotes(true); probeHistCount(selId);   /* 刷新正文与列表；恢复前置快照使版本数 +1，重探入口计数 */
  }).catch(function (e) {
    if (histState) { histState.pending = false; modalErr('恢复失败：' + (e && e.message || e)); var rb3 = $('histRestore'); if (rb3) { rb3.disabled = false; rb3.textContent = '恢复此版本' } }
  });
}

