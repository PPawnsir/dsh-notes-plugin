function openExport() {
  var last = '';
  try { last = localStorage.getItem('dsh-notes-last-export-dir') || '' } catch (e) {}
  openModal(
    '<div class="modal-t">' + icon('i-up', 13) + ' 导出全部笔记</div>'
    + '<div class="modal-hint">把整个笔记库（含 folders.json）完整快照到目标目录下的 dsh-notes-export-&lt;时间戳&gt; 子目录，不打包不压缩，目录即格式。</div>'
    + '<label class="set-check" title="缺省导出时正文里的机密区（secret span）替换为占位行；勾选后才导出明文"><input type="checkbox" id="expSecret"> 包含机密明文（缺省打码机密区）</label>'
    + '<input class="minput" id="expDir" placeholder="目标目录，如 D:\\backup 或桌面路径…" value="' + esc(last) + '">'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="eCancel">取消</button><button class="mbtn primary" id="eOk">导出</button></div>'
  );
  $('expDir').focus();
  $('eCancel').onclick = closeModal;
  $('expDir').onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); $('eOk').click() } };
  $('eOk').onclick = function () {
    var dir = $('expDir').value.trim();
    if (!dir) { modalErr('请填写目标目录'); return }
    $('eOk').disabled = true; $('eOk').textContent = '导出中…';
    rpc('notes-export', { dir: dir, includeSecret: !!$('expSecret').checked }).then(function (res) {
      if (res && res.error) { modalErr(res.error); $('eOk').disabled = false; $('eOk').textContent = '导出'; return }
      try { localStorage.setItem('dsh-notes-last-export-dir', dir) } catch (e) {}
      closeModal();
      toast('已导出 ' + (res.exported || 0) + ' 条笔记到 ' + (res.target || dir) + (res.maskedSpans ? '（机密区已打码 ' + res.maskedSpans + ' 处，明文导出需勾选「包含机密明文」）' : ''));
    }).catch(function (e) { modalErr('导出失败：' + (e && e.message || e)); $('eOk').disabled = false; $('eOk').textContent = '导出' });
  };
}
