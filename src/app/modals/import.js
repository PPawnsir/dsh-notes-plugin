var impPreview = null, impOverwrite = false;
function openImport() {
  impPreview = null; impOverwrite = false;
  openModal(
    '<div class="modal-t">' + icon('i-down', 13) + ' 导入笔记</div>'
    + '<div class="modal-hint">从目录快照导入（只增改不删）：库中不存在的直接入库，内容相同的跳过，内容不同的默认跳过；执行前自动全量备份当前库。</div>'
    + '<input class="minput" id="impDir" placeholder="来源目录（dsh-notes-export-… 或 notes-backup-… 目录）…">'
    + '<div id="impBody"></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="iCancel">取消</button><button class="mbtn primary" id="iOk">预览</button></div>'
  );
  $('impDir').focus();
  $('iCancel').onclick = closeModal;
  $('impDir').oninput = function () { impPreview = null; $('impBody').innerHTML = ''; $('iOk').textContent = '预览' };
  $('impDir').onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); $('iOk').click() } };
  $('iOk').onclick = function () { impPreview ? doImportExecute() : doImportPreview() };
}
function doImportPreview() {
  var dir = $('impDir').value.trim();
  if (!dir) { modalErr('请填写来源目录'); return }
  $('iOk').disabled = true; $('iOk').textContent = '检查中…';
  rpc('notes-import-preview', { dir: dir }).then(function (res) {
    $('iOk').disabled = false;
    if (res && res.error) { modalErr(res.error); $('iOk').textContent = '预览'; return }
    if (!res.total) { modalErr('该目录没有可导入的笔记：' + dir); $('iOk').textContent = '预览'; return }
    impPreview = res; impOverwrite = false;
    renderImportPreview();
  }).catch(function (e) { modalErr('预览失败：' + (e && e.message || e)); $('iOk').disabled = false; $('iOk').textContent = '预览' });
}
function renderImportPreview() {
  var p = impPreview; if (!p || !$('impBody')) return;
  var IMP_LABEL = { added: '新增', same: '相同', diff: '不同' };
  var fl = p.folders || { total: 0, new: 0 };
  var h = '<div class="imp-sum"><span class="added">新增 <b>' + p.added + '</b></span><span>相同 <b>' + p.same + '</b></span><span class="' + (p.diff ? 'diff' : '') + '">不同 <b>' + p.diff + '</b></span>'
    + (fl.total ? '<span>文件夹新增 <b>' + fl.new + '</b> / 共 ' + fl.total + '</span>' : '') + '</div>'
    + (p.unreadable ? '<div class="imp-warn">⚠ ' + p.unreadable + ' 个文件无法读取，已跳过</div>' : '')
    + '<div class="imp-list">'
    + (p.detail || []).map(function (d) {
        return '<div class="imp-row"><span class="imp-badge ' + d.status + '">' + (IMP_LABEL[d.status] || d.status) + '</span><span class="ti" title="' + esc(d.title || 'Untitled') + '">' + esc(d.title || 'Untitled') + '</span>' + (d.deleted ? '<span class="imp-deltag">已删除</span>' : '') + '</div>'
      }).join('') + '</div>'
    + '<label class="set-check" style="margin-top:8px"><input type="checkbox" id="impOw"' + (p.diff ? '' : ' disabled') + '> 覆盖内容不同的笔记（' + p.diff + ' 条，不勾则跳过）</label>';
  $('impBody').innerHTML = h;
  var ow = $('impOw');
  if (ow) ow.onchange = function () { impOverwrite = !!this.checked };
  $('iOk').textContent = '执行导入';
  $('iOk').className = 'mbtn danger';
}
function doImportExecute() {
  var dir = $('impDir').value.trim();
  if (!dir || !impPreview) return;
  $('iOk').disabled = true; $('iOk').textContent = '导入中…';
  rpc('notes-import', { dir: dir, overwrite: !!impOverwrite }).then(function (res) {
    if (res && res.error) { modalErr(res.error); $('iOk').disabled = false; $('iOk').textContent = '执行导入'; return }
    closeModal();
    var got = (res.imported || 0) + (res.overwritten || 0);
    var skipped = (res.skippedSame || 0) + (res.skippedDiff || 0);
    var bak = String(res.backupDir || '').split(/[\\/]/).filter(Boolean).pop() || '';
    toast('已导入 ' + got + ' 条（跳过 ' + skipped + ' 条）' + (res.foldersMerged ? '，合并文件夹 ' + res.foldersMerged + ' 个' : '') + (bak ? '，已自动备份到 ' + bak : ''));
    loadNotes(true);
  }).catch(function (e) { modalErr('导入失败：' + (e && e.message || e)); $('iOk').disabled = false; $('iOk').textContent = '执行导入' });
}
$('btnSettings').addEventListener('click', openSettings);
$('btnTrash').addEventListener('click', openTrash);

