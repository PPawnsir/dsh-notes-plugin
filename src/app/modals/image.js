/* ===== 图片插入流（三入口共用：粘贴/拖拽/工具栏按钮 → 弹窗预览+alt → notes-asset-upload → 光标处插入） ===== */
/* ---- 二期 图片压缩：>1MB 的 PNG/JPEG 上传前前端 canvas 降质转 JPEG（GIF/WebP 不动，保动画/透明语义）----
   策略：长边封顶 2560px → 质量阶梯 0.85→0.45 逐档试；仍超 1MB 则长边 0.8 递减（下限 800px）；
   PNG 透明底刷白（JPEG 无 alpha）；任何一步失败 → cb(null) 回退原图上传。压缩产物 <1MB 即收。 */
var IMG_COMPRESS_THRESHOLD = 1024 * 1024;
function compressImageData(dataURL, cb) {
  try {
    var img = new Image();
    img.onload = function () {
      try {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (!w || !h) { cb(null); return }
        var MAX_DIM = 2560;
        if (Math.max(w, h) > MAX_DIM) { var r = MAX_DIM / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r) }
        var canvas = document.createElement('canvas');
        var c2d = canvas.getContext('2d');
        if (!c2d) { cb(null); return }
        var qs = [0.85, 0.75, 0.65, 0.55, 0.45];
        var out = '', bytes = 0, round = 0;
        while (round < 8) {
          canvas.width = w; canvas.height = h;
          c2d.fillStyle = '#ffffff'; c2d.fillRect(0, 0, w, h);
          c2d.drawImage(img, 0, 0, w, h);
          out = canvas.toDataURL('image/jpeg', qs[Math.min(round, qs.length - 1)]);
          bytes = Math.max(0, Math.round((out.length - 23) * 3 / 4));   /* 去掉 data:image/jpeg;base64, 头估算字节 */
          if (bytes <= IMG_COMPRESS_THRESHOLD) { cb({ dataURL: out, bytes: bytes }); return }
          round++;
          if (round >= qs.length && (w > 800 || h > 800)) { w = Math.max(800, Math.round(w * 0.8)); h = Math.max(800, Math.round(h * 0.8)); round = qs.length - 1; }
        }
        cb(out ? { dataURL: out, bytes: bytes } : null);   /* 兜底：尽力压缩产物（可能仍 >1MB，5MB 上限内可用） */
      } catch (err) { cb(null) }
    };
    img.onerror = function () { cb(null) };
    img.src = dataURL;
  } catch (err) { cb(null) }
}
/* 图片文件校验 + 读 dataURL → 打开弹窗（mime 白名单 png/jpeg/gif/webp、≤5MB，与 host 口径一致）；
   二期：>1MB 的 PNG/JPEG 先走 compressImageData 压缩转 JPEG 再进弹窗（弹窗大小行显示「已压缩 原 → 现」） */
function pickImageFile(f) {
  if (!f) return;
  var MIME_OK = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 };
  if (!MIME_OK[f.type]) { toast('仅支持 PNG/JPEG/GIF/WebP 图片'); return; }
  if (f.size > 5 * 1024 * 1024) { toast('图片超过 5MB 上限'); return; }
  var rd = new FileReader();
  rd.onload = function () {
    var base = { name: f.name || ('pasted-' + Date.now() + '.png'), dataURL: String(rd.result), mime: f.type, size: f.size, alt: (f.name || '').replace(/\.[^.]+$/, '') };
    if (f.size > IMG_COMPRESS_THRESHOLD && (f.type === 'image/png' || f.type === 'image/jpeg')) {
      compressImageData(base.dataURL, function (res) {
        if (res && res.dataURL) openImgModal({ name: base.name.replace(/\.[^.]+$/, '') + '.jpg', dataURL: res.dataURL, mime: 'image/jpeg', size: res.bytes, origSize: f.size, alt: base.alt });
        else openImgModal(base);   /* 压缩失败回退原图（不阻塞上传） */
      });
    } else openImgModal(base);
  };
  rd.onerror = function () { toast('图片读取失败'); };
  rd.readAsDataURL(f);
}
function openImgModal(draft) { imgDraft = draft || { name: '', dataURL: '', mime: '', size: 0, alt: '' }; renderImgModal(); }
function renderImgModal() {
  openModal(
    '<div class="modal-t">' + icon('i-image', 13) + ' 插入图片<span class="sub">上传到笔记库 assets/（PNG/JPEG/GIF/WebP，≤5MB；>1MB 的 PNG/JPG 自动压缩转 JPEG）</span></div>'
    + (imgDraft.dataURL
      ? '<div class="uppv"><img src="' + imgDraft.dataURL + '" alt=""><div><div class="nm">' + esc(imgDraft.name) + '</div><div class="sz">' + (imgDraft.origSize ? '已压缩 ' + fmtBytes(imgDraft.origSize) + ' → ' : '') + (imgDraft.size ? fmtBytes(imgDraft.size) + ' · ' : '') + esc(imgDraft.mime) + '</div></div></div>'
        + '<input class="minput" id="upAlt" placeholder="替代文本 alt（可留空）" value="' + esc(imgDraft.alt) + '">'
      : '<div class="upzone" id="upZone">点击选择 <b>本地图片文件</b>（也可直接把图片文件拖进编辑区，或 Ctrl+V 粘贴）<input type="file" id="upFile" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none"></div>')
    + '<div class="prog" id="upProg"><i></i></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="upCancel">取消</button><button class="mbtn primary" id="upOk"' + (imgDraft.dataURL ? '' : ' disabled') + '>上传并插入</button></div>'
  );
  $('upCancel').onclick = function () { if (!imgUploading) closeModal(); };
  if (!imgDraft.dataURL) {
    $('upZone').onclick = function () { $('upFile').click(); };
    $('upFile').onchange = function () { var f = this.files && this.files[0]; if (f) pickImageFile(f); };
    return;
  }
  $('upOk').onclick = doUploadImage;
}
/* 上传并插入：notes-asset-upload RPC → assets/<ts>-<安全名>；成功 → 光标处插入 ![](assets/…)；失败留在弹窗内报错可重试 + toast */
function doUploadImage() {
  if (!imgDraft || !imgDraft.dataURL || imgUploading) return;
  imgUploading = true;
  $('upOk').disabled = true; $('upOk').textContent = '上传中…';
  $('upProg').classList.add('on');
  var alt = $('upAlt') ? $('upAlt').value.trim() : '';
  rpc('notes-asset-upload', { name: imgDraft.name, data: imgDraft.dataURL, mime: imgDraft.mime }).then(function (res) {
    imgUploading = false;
    if (res && res.error) { toast('图片上传失败：' + res.error); modalErr(res.error); $('upOk').disabled = false; $('upOk').textContent = '上传并插入'; $('upProg').classList.remove('on'); return; }
    var file = res && res.file;
    if (!file) { modalErr('上传返回异常（缺 file 字段）'); $('upOk').disabled = false; $('upOk').textContent = '上传并插入'; $('upProg').classList.remove('on'); return; }
    closeModal();
    insertImageMd(file, alt);
    toast('已插入图片：' + file);
  }).catch(function (e) {
    imgUploading = false;
    toast('图片上传失败：' + (e && e.message || e)); modalErr('上传失败：' + (e && e.message || e));
    if ($('upOk')) { $('upOk').disabled = false; $('upOk').textContent = '上传并插入'; }
    if ($('upProg')) $('upProg').classList.remove('on');
  });
}
/* 光标处插入图片（原型 applyInsertImage）：源码模式插 Markdown 文本，富文本模式插 img 节点（随后序列化同步回源码） */
function insertImageMd(mdSrc, alt) {
  if (edMode === 'rich') {
    restoreSel();
    var rich = $('edRich'); if (!rich) return;
    rich.focus();
    var img = document.createElement('img');
    img.src = assetDisplaySrc(mdSrc); img.setAttribute('data-md-src', mdSrc); img.alt = alt;
    var sel = window.getSelection(), range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    var blk = range ? range.startContainer : null;
    if (blk && blk.nodeType === 3) blk = blk.parentNode;
    var p = blk && blk.closest ? blk.closest('p') : null;
    if (p && !p.textContent.trim() && !p.querySelector('img')) p.appendChild(img);   /* 空段落 → 直接放入 */
    else if (range) { range.deleteContents(); range.insertNode(img); }               /* 光标处内联插入 */
    else rich.appendChild(img);
    richDirty = true; syncFromRich('插入图片');
  } else {
    var ta = $('edSrc');
    var cur = edNote ? edNote.body || '' : '';
    var pos = ta && ta.selectionStart != null ? ta.selectionStart : cur.length;
    var ins = '![' + alt + '](' + mdSrc + ')';
    var next = cur.slice(0, pos) + ins + cur.slice(pos);
    if (edNote) edNote.body = next;
    if (ta) ta.value = next;
    triggerSave(); scheduleDegAnalyze();
    setTimeout(function () { try { var t2 = $('edSrc'); if (t2) { t2.focus(); t2.setSelectionRange(pos + ins.length, pos + ins.length); } } catch (e) {} }, 60);
  }
}
