/* ================= 二期 孤儿资产清理（设置卡片「资产清理」入口）：dry-run 预览（零写入）→ 勾选 → 白名单执行 =================
   契约：notes-assets-prune 缺省 dryRun=true 返回 { orphans:[{name,bytes}], totalBytes, referenced, tombstoned, notes }；
   执行 dryRun:false + files 白名单（host 调用内重扫实时孤儿防漂移；软删除笔记的引用也计入保护，宁留勿删）。 */
function openPrune() {
  pruneState = { data: null, checked: {}, pending: false };
  openModal(
    '<div class="modal-t">' + icon('i-trash', 13) + ' 资产清理<span class="sub">预览勾选后才删除 · 宁留勿删</span></div>'
    + '<div class="modal-hint">assets/ 中未被任何笔记正文引用的文件（已删除笔记的引用仍计入保护）。</div>'
    + '<div id="pruneList"><div class="modal-hint">扫描中…</div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="pruneCancel">取消</button><button class="mbtn danger" id="pruneOk" disabled>删除所选</button></div>'
  );
  $('pruneCancel').onclick = function () { if (!pruneState || !pruneState.pending) { closeModal(); pruneState = null } };
  $('pruneOk').onclick = doPruneConfirm;
  rpc('notes-assets-prune', { dryRun: true }).then(function (res) {
    if (!pruneState) return;
    if (res && res.error) { pruneState.data = { orphans: [] }; renderPruneList(); modalErr(res.error); return }
    pruneState.data = res || { orphans: [] };
    renderPruneList();
  }).catch(function (e) { if (pruneState) { pruneState.data = { orphans: [] }; renderPruneList(); modalErr('扫描失败：' + (e && e.message || e)) } });
}
/* 孤儿清单（复用归档预览的列表样式 arch-list/arch-row）：行 = 复选框（缺省全勾）+ 文件名 + 字节数；底部统计 + 确认计数 */
function renderPruneList() {
  var host = $('pruneList'); if (!host || !pruneState) return;
  var d = pruneState.data, ok = $('pruneOk');
  if (!d) return;
  var orphans = d.orphans || [];
  if (!orphans.length) { host.innerHTML = '<div class="modal-hint">没有孤儿资产（assets/ 全部文件均被引用）。</div>'; if (ok) { ok.disabled = true; ok.textContent = '删除所选（0 项）' } return }
  var checked = orphans.filter(function (o) { return pruneState.checked[o.name] !== false });
  var checkedBytes = checked.reduce(function (s, o) { return s + (o.bytes || 0) }, 0);
  var h = (d.notes != null ? '<div class="modal-hint" style="margin-bottom:6px">已扫描 ' + d.notes + ' 条笔记：引用中 ' + (d.referenced || 0) + ' 个，历史清理占位 ' + (d.tombstoned || 0) + ' 个。</div>' : '')
    + '<div class="arch-list">'
    + orphans.map(function (o) {
        return '<div class="arch-row"><input type="checkbox" class="arch-check" data-name="' + esc(o.name) + '"' + (pruneState.checked[o.name] !== false ? ' checked' : '') + '>'
          + '<span class="ti" title="' + esc(o.name) + '">' + esc(o.name) + '</span><span class="meta">' + fmtBytes(o.bytes) + '</span></div>'
      }).join('') + '</div>';
  host.innerHTML = h;
  if (ok) { ok.disabled = pruneState.pending || checked.length === 0; ok.textContent = '删除所选（' + checked.length + ' 项 · ' + fmtBytes(checkedBytes) + '）' }
  host.querySelectorAll('.arch-check').forEach(function (el) { el.onchange = function () { pruneState.checked[el.dataset.name] = !el.checked; renderPruneList() } });
}
function doPruneConfirm() {
  if (!pruneState || !pruneState.data || pruneState.pending) return;
  var files = (pruneState.data.orphans || []).filter(function (o) { return pruneState.checked[o.name] !== false }).map(function (o) { return o.name });
  if (!files.length) return;
  pruneState.pending = true; var ok = $('pruneOk'); if (ok) { ok.disabled = true; ok.textContent = '删除中…' }
  rpc('notes-assets-prune', { dryRun: false, files: files }).then(function (res) {
    if (res && res.error) { pruneState.pending = false; modalErr(res.error); renderPruneList(); return }
    closeModal(); pruneState = null;
    toast('已清理 ' + ((res && res.deleted || []).length) + ' 个孤儿资产，释放 ' + fmtBytes((res && res.freedBytes) || 0));
  }).catch(function (e) { if (pruneState) { pruneState.pending = false; modalErr('删除失败：' + (e && e.message || e)); renderPruneList() } });
}

