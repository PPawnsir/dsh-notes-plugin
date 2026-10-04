/* 链接弹窗（原型 openLinkModal）：仅 http/https */
function openLinkModal(selText) {
  openModal(
    '<div class="modal-t">' + icon('i-link', 13) + ' 插入链接<span class="sub">选中文字：' + esc(selText.slice(0, 24)) + (selText.length > 24 ? '…' : '') + '</span></div>'
    + '<input class="minput" id="lkUrl" placeholder="https://…" value="https://">'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="lkCancel">取消</button><button class="mbtn primary" id="lkOk">插入</button></div>'
  );
  $('lkUrl').focus(); $('lkUrl').setSelectionRange(8, 8);
  $('lkCancel').onclick = closeModal;
  $('lkOk').onclick = function () {
    var url = $('lkUrl').value.trim();
    if (!/^https?:\/\//.test(url)) { modalErr('仅支持 http/https 链接'); return; }
    closeModal(); restoreSel();
    var rich = $('edRich'); if (rich) rich.focus();
    document.execCommand('createLink', false, url);
    keepSel(); richDirty = true; setSyncStatus(true); scheduleRichSync();
  };
}
