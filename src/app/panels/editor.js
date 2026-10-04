/* ================= 选中与编辑器 ================= */
function selectNote(id) {
  /* 双模式：切换笔记前把富文本在途编辑序列化落回 edNote.body 并立即保存（防 900ms debounce 打到新笔记上） */
  if (edMode === 'rich' && richDirty && edNote) { syncFromRich('切换笔记'); doSave(); }
  selId = id; scopeOpen = false;
  var n = notes.find(function (x) { return x.id === id });
  if (n && n.folder) { foldOpen[n.folder] = true; saveFoldOpen() }
  edNote = n ? Object.assign({}, n, { body: '' }) : null;
  degraded = { ok: true, reasons: [] };   /* 正文未加载前降级态复位（横幅不残留上一条笔记的分析结果） */
  edLoading = true;   /* 正文异步加载中：doSave 省略 body，防改名触发保存把空正文写盘 */
  renderTree(); renderEd();
  if (n) {
    histCount = null; probeHistCount(id);   /* 换笔记重置「历史」入口可见性，随即探测版本计数 */
    rpc('notes-get', { id: id }).then(function (res) {
      if (res && res.note && selId === id) {
        edNote = res.note;
        wikiBodies[id] = { body: edNote.body || '', updatedAt: res.note.updatedAt || '' };   /* 双链索引即时新鲜（不等后台补缺） */
        /* 正文到达后跑降级分析；富文本模式下新正文含白名单外语法 → 回落源码模式 */
        degraded = analyzeMarkdown(edNote.body || '');
        if (edMode === 'rich' && !degraded.ok) { edMode = 'source'; toast('含高级语法（' + degraded.reasons.map(function (r) { return r.label }).join('、') + '），请在源码模式编辑'); renderEd(); }
        else { fillEdBody(); renderEdFoot(); refreshDegradeUI(); renderBacklinks(); }
      }
      edLoading = false;
    }).catch(function () { edLoading = false })
  }
}
/* 正文填充双模式：源码 → textarea.value；富文本 → 内核渲染进 contenteditable（填充前清 dirty，防回填被当编辑） */
function fillEdBody() {
  if (!edNote) return;
  var body = edNote.body || '';
  if ($('edSrc')) $('edSrc').value = body;
  if (edMode === 'rich' && $('edRich')) { richDirty = false; $('edRich').innerHTML = renderMarkdown(body, wikiResolve); setSyncStatus(false); }
}
function triggerSave() { clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 900) }
function doSave() {
  if (!edNote || !selId) return;
  var keepQuick = (notes.find(function (x) { return x.id === selId }) || {}).tags || [];
  var tags = (edNote._tagsStr != null ? edNote._tagsStr : (edNote.tags || []).filter(function (t) { return t !== 'quick' }).join(', '))
    .split(/[,，;；]/).map(function (s) { return s.trim() }).filter(Boolean);
  if (keepQuick.indexOf('quick') >= 0 && tags.indexOf('quick') < 0) tags.push('quick');
  var upd = {
    id: selId, title: edNote.title, tags: tags,
    kind: edNote.kind, status: edNote.status, inject: edNote.inject === true,
    injectTo: edNote.injectTo || [], recall: edNote.recall !== false, sensitive: edNote.sensitive === true
  };
  if (!edLoading) upd.body = edNote.body;   /* 正文加载中省略 body（host 对 undefined 保留原内容，防竞态清空正文） */
  if (upd.inject) upd.injectRole = edNote.injectRole === 'reference' ? 'reference' : 'convention';   /* 非 off 才带 injectRole（payload 禁 undefined） */
  if ((edNote.topic || '').trim()) upd.topic = edNote.topic.trim();
  rpc('notes-update', upd).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    $('edSaved').textContent = '✓ 已自动保存 ' + new Date().toTimeString().slice(0, 5);
    edNote._tagsStr = null;
    wikiBodies[selId] = { body: edNote.body || '', updatedAt: '' };   /* 双链索引：自有正文即时新鲜（updatedAt 置空 → loadNotes 后索引复核） */
    renderBacklinks();
    loadNotes(true);
    if (histCount === 0) probeHistCount(selId);   /* 首次真实保存产生首份快照（0→1 转折点）→ 补探「历史」入口 */
  }).catch(function (e) { toast('保存失败：' + (e && e.message || e)) });
}
function injectScopeLabel(injectTo) {
  var arr = (injectTo || []).filter(function (t) { return t !== 'global' && t !== 'workspace' });
  if (arr.length === 0) return '所有会话';
  var names = arr.map(function (t) {
    var s = sessList.find(function (x) { return x.short === t });
    return s ? s.name : ('会话 ' + t);
  });
  return names.join('、');
}
function renderEd() {
  var ed = $('ed');
  if (!edNote) {
    ed.className = 'ed empty';
    ed.innerHTML = '<svg class="ic"><use href="#i-note"/></svg><div>选择左侧一条笔记查看和编辑</div><div style="font-size:11px">点左侧「新建」创建笔记；正文划选文字可弹出快速记录卡片</div>';
    return;
  }
  var n = edNote;
  ed.className = 'ed';
  /* 双模式编辑器 v3（原型 design/notes-editor-v3.html）：ed-h + disp + ed-main（降级横幅 + 源码 textarea / 富文本 rich-scroll）+ ed-foot */
  ed.innerHTML =
    '<div class="ed-h">'
    + '<div class="ed-crumb" id="edCrumb"></div>'
    + '<div class="ed-title" id="edTitle" contenteditable="true" spellcheck="false"></div>'
    + '<div class="ed-meta" id="edMeta"></div>'
    + '</div>'
    + '<div class="disp" id="dispHost"></div>'
    + '<div class="ed-main">'
    + '<div class="deg" id="degBanner" style="display:none"><svg class="ic"><use href="#i-warn"/></svg><div>检测到<b>白名单外语法</b>，富文本编辑不可用（仍可源码编辑）：<span class="rs" id="degReasons"></span><br>删净对应语法后，「富文本」入口会实时恢复可用。</div></div>'
    + '<textarea class="src" id="edSrc" spellcheck="false" placeholder="正文…（Markdown）"' + (edMode === 'source' ? '' : ' style="display:none"') + '></textarea>'
    + '<div class="rich-scroll rich-wrap" id="richScroll"' + (edMode === 'rich' ? '' : ' style="display:none"') + '>'
    + '<div class="rtb" id="rtb">'
    + '<button class="rtb-btn" data-a="bold" title="加粗 **text**">' + icon('i-bold', 14) + '</button>'
    + '<button class="rtb-btn" data-a="italic" title="斜体 *text*">' + icon('i-italic', 14) + '</button>'
    + '<button class="rtb-btn" data-a="code" title="行内码 `text`">' + icon('i-code-block', 14) + '</button>'
    + '<button class="rtb-btn" data-a="link" title="链接 [text](url)">' + icon('i-link', 14) + '</button>'
    + '<span class="rtb-sep"></span>'
    + '<button class="rtb-btn" data-a="ul" title="无序列表">' + icon('i-ul', 14) + '</button>'
    + '<button class="rtb-btn" data-a="ol" title="有序列表">' + icon('i-ol', 14) + '</button>'
    + '<button class="rtb-btn" data-a="quote" title="引用块">' + icon('i-quote', 14) + '</button>'
    + '<span class="rtb-sep"></span>'
    + '<button class="rtb-btn" data-a="image" title="插入图片 ![](assets/..)（也可 Ctrl+V 粘贴 / 拖拽文件）">' + icon('i-image', 14) + '</button>'
    + '<span class="sync' + (richDirty ? '' : ' ok') + '" id="syncPill"><span class="sd"></span><span id="syncTxt">' + (richDirty ? '编辑中…' : '已同步源码') + '</span></span>'
    + '</div>'
    + '<div class="rich" id="edRich" contenteditable="true" spellcheck="false"></div>'
    + '</div>'
    + '</div>'
    + '<div class="backlinks" id="backlinksHost"></div>'
    + '<div class="ed-foot"><span id="footMode">' + (edMode === 'source' ? '源码模式' : '富文本模式') + '</span><span id="edCreated"></span><span id="edUpdated"></span><span id="edSource"></span><span class="saved" id="edSaved"></span></div>';
  renderCrumb(); renderMeta(); renderDispatches(); fillEdBody(); renderEdFoot(); refreshDegradeUI(); renderBacklinks();
  $('edTitle').textContent = n.title === 'Untitled' ? '' : (n.title || '');
  $('edTitle').addEventListener('input', function () { if (!edNote) return; edNote.title = this.textContent.trim() || 'Untitled'; triggerSave() });
  bindEditorArea();
}
/* 编辑区事件绑定（renderEd 重建 DOM 后重挂；元素级监听随重建不累积，document 级 selectionchange 在启动区挂一次） */
function bindEditorArea() {
  var ta = $('edSrc');
  if (ta) {
    ta.addEventListener('input', function () { if (!edNote) return; edNote.body = this.value; triggerSave(); scheduleDegAnalyze(); });
    /* 图片入口①/②（源码模式）：粘贴/拖拽图片文件 → 同一上传弹窗 → 光标处插 Markdown 文本 */
    ta.addEventListener('paste', function (ev) { var cd = ev.clipboardData; if (cd && cd.files && cd.files.length && /^image\//.test(cd.files[0].type)) { ev.preventDefault(); pickImageFile(cd.files[0]); } });
    ta.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    ta.addEventListener('drop', function (ev) { var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (!f) return; ev.preventDefault(); if (!/^image\//.test(f.type)) { toast('仅支持图片文件'); return } pickImageFile(f); });
  }
  var rich = $('edRich'), wrap = $('richScroll');
  if (rich && wrap && edMode === 'rich') bindRich(rich, wrap);
}
/* 富文本事件（原型 bindRich）：编辑期间不重渲染（防 IME 打断/光标丢失），失焦/900ms 防抖序列化回源码 */
function bindRich(rich, wrap) {
  try { document.execCommand('styleWithCSS', false, false); } catch (e) {} /* 强制语义标签 <b>/<i>，序列化器可识别 */
  rich.addEventListener('input', function () { richDirty = true; setSyncStatus(true); scheduleRichSync(); keepSel(); });
  rich.addEventListener('compositionstart', function () { composing = true; clearTimeout(richSyncTimer); });
  rich.addEventListener('compositionend', function () { composing = false; richDirty = true; setSyncStatus(true); scheduleRichSync(); });
  rich.addEventListener('blur', function () { if (richDirty) syncFromRich('失焦'); });
  rich.addEventListener('keyup', updateToolbarState);
  rich.addEventListener('mouseup', function () { keepSel(); updateToolbarState(); });
  /* P2 双链：富文本内点击 [[..]] 锚 → 跳转选中目标笔记（阻止默认 #wiki 哈希跳转；_wikiBound 守卫防模式切换重复绑定） */
  /* L2 只读表格：点击表格区块 → toast 提示（contenteditable=false 原子岛屿，富文本内不做表格编辑） */
  if (!rich._wikiBound) {
    rich._wikiBound = true;
    rich.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('a[data-wiki]') : null;
      if (a) { ev.preventDefault(); ev.stopPropagation(); jumpToWikiTarget(a.getAttribute('data-wiki') || ''); return; }
      var tb = ev.target && ev.target.closest ? ev.target.closest('table.dsh-notes-table') : null;
      if (tb) toast('表格为只读，请切换源码模式编辑该区域');
    });
  }
  /* 图片入口①：Ctrl+V 粘贴（clipboardData.files）；其余粘贴：HTML → 白名单清洗，纯文本 → 纯文本插入 */
  rich.addEventListener('paste', function (ev) {
    var cd = ev.clipboardData;
    if (cd && cd.files && cd.files.length && /^image\//.test(cd.files[0].type)) { ev.preventDefault(); keepSel(); pickImageFile(cd.files[0]); return; }
    var html = cd ? cd.getData('text/html') : '';
    if (html) { ev.preventDefault(); insertSanitizedHtml(html); return; }
    var txt = cd ? cd.getData('text/plain') : '';
    if (txt) { ev.preventDefault(); document.execCommand('insertText', false, txt); }
  });
  /* 图片入口②：拖拽文件进富文本 */
  wrap.addEventListener('dragover', function (ev) { ev.preventDefault(); wrap.classList.add('drop'); });
  wrap.addEventListener('dragleave', function () { wrap.classList.remove('drop'); });
  wrap.addEventListener('drop', function (ev) {
    ev.preventDefault(); wrap.classList.remove('drop');
    var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('仅支持图片文件'); return; }
    keepSel(); pickImageFile(f);
  });
  /* 工具栏：mousedown 阻止默认（保住选区/焦点） */
  wrap.querySelectorAll('.rtb-btn').forEach(function (b) {
    b.addEventListener('mousedown', function (ev) { ev.preventDefault(); toolbarAction(b.getAttribute('data-a')); });
  });
}
/* 同步态徽标（原型 syncPill）：编辑中…（橙点）/ 已同步源码（绿点） */
function setSyncStatus(editing) {
  var pill = $('syncPill'); if (!pill) return;
  pill.className = 'sync' + (editing ? '' : ' ok');
  if ($('syncTxt')) $('syncTxt').textContent = editing ? '编辑中…' : '已同步源码';
}
/* 富文本 → 源码序列化（原型 syncFromRich）：内容无损最高优先——有变化才回写 body 并走既有 doSave 自动保存 */
function syncFromRich(why) {
  if (edMode !== 'rich' || !edNote) return;
  var rich = $('edRich'); if (!rich) return;
  var md2 = serializeRich(rich);
  richDirty = false; setSyncStatus(false);
  if (md2 !== (edNote.body || '')) { edNote.body = md2; if ($('edSrc')) $('edSrc').value = md2; triggerSave(); }
}
function scheduleRichSync() {
  if (composing) return;
  clearTimeout(richSyncTimer);
  richSyncTimer = setTimeout(function () { if (richDirty) syncFromRich('防抖'); }, 900);
}
/* 源码模式编辑后 450ms 防抖降级分析（原型 onSourceInput）：降级态翻转时 toast 告知 */
function scheduleDegAnalyze() {
  clearTimeout(degTimer);
  degTimer = setTimeout(function () {
    var a = analyzeMarkdown(edNote ? edNote.body || '' : '');
    var was = degraded.ok;
    degraded = a; refreshDegradeUI();
    if (was !== a.ok) toast(a.ok ? '富文本模式已恢复可用' : '检测到白名单外语法 → 富文本入口置灰');
  }, 450);
}
/* 降级 UI（原型 refreshDegradeUI）：横幅 + 富文本段置灰 + hover tooltip（.tipwrap.deg 控制） */
function refreshDegradeUI() {
  var d = degraded, seg = $('segRich');
  if (seg) seg.classList.toggle('dis', !d.ok);
  var ms = $('modeSeg'), tw = ms ? ms.closest('.tipwrap') : null;
  if (tw) tw.classList.toggle('deg', !d.ok);
  var bn = $('degBanner'); if (bn) bn.style.display = d.ok ? 'none' : 'flex';
  if (!d.ok) {
    if ($('degReasons')) $('degReasons').textContent = d.reasons.map(function (r) { return r.label + '（第 ' + r.line + ' 行：' + r.sample + '）' }).join('、');
    if ($('richTip')) $('richTip').textContent = '含高级语法（' + d.reasons.map(function (r) { return r.label }).join('、') + '），请在源码模式编辑';
  }
}
/* 模式切换（原型 setMode）：进富文本前跑降级分析；离开富文本先把在途编辑序列化落回源码 */
function switchMode(m) {
  if (m === edMode) return;
  if (m === 'rich') {
    degraded = analyzeMarkdown(edNote ? edNote.body || '' : '');
    refreshDegradeUI();
    if (!degraded.ok) { toast('含高级语法（' + degraded.reasons.map(function (r) { return r.label }).join('、') + '），请在源码模式编辑'); return; }
    richDirty = false;
    edMode = 'rich';
    renderModeUI();
    var rich = $('edRich');
    rich.innerHTML = renderMarkdown(edNote ? edNote.body || '' : '', wikiResolve);
    bindRich(rich, $('richScroll'));
    setSyncStatus(false);
  } else {
    if (richDirty) syncFromRich('切换模式');
    edMode = 'source';
    renderModeUI();
  }
}
function renderModeUI() {
  var ms = $('modeSeg');
  if (ms) ms.querySelectorAll('.seg').forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-m') === edMode); });
  if ($('edSrc')) $('edSrc').style.display = edMode === 'source' ? 'block' : 'none';
  if ($('richScroll')) $('richScroll').style.display = edMode === 'rich' ? 'flex' : 'none';
  if ($('footMode')) $('footMode').textContent = edMode === 'source' ? '源码模式' : '富文本模式';
}
/* 富文本选区缓存/恢复（工具栏 mousedown 阻止默认保住选区；弹窗关闭后恢复） */
function keepSel() { var sel = window.getSelection(); if (sel && sel.rangeCount > 0) { try { savedRange = sel.getRangeAt(0).cloneRange(); } catch (e) {} } }
function restoreSel() {
  var sel = window.getSelection(); if (!sel) return;
  sel.removeAllRanges();
  if (savedRange) { try { sel.addRange(savedRange); return; } catch (e) {} }
  var rich = $('edRich'); if (!rich) return;
  var r = document.createRange(); r.selectNodeContents(rich); r.collapse(false); sel.addRange(r);
}
/* 富文本工具栏（原型 toolbarAction）：execCommand 语义标签（styleWithCSS:false → <b>/<i>，序列化器可识别） */
function toolbarAction(a) {
  restoreSel();
  var rich = $('edRich'); if (rich) rich.focus();
  if (a === 'bold') document.execCommand('bold');
  else if (a === 'italic') document.execCommand('italic');
  else if (a === 'ul') document.execCommand('insertUnorderedList');
  else if (a === 'ol') document.execCommand('insertOrderedList');
  else if (a === 'quote') document.execCommand('formatBlock', false, 'blockquote');
  else if (a === 'code') {
    var sel = window.getSelection(), txt = sel && !sel.isCollapsed ? String(sel) : '';
    if (!txt) { toast('先选中要设为行内码的文字'); return; }
    document.execCommand('insertHTML', false, '<code>' + esc(txt) + '</code>');
  }
  else if (a === 'link') {
    var sel2 = window.getSelection();
    if (!sel2 || sel2.isCollapsed) { toast('先选中要加链接的文字'); return; }
    keepSel(); openLinkModal(String(sel2)); return;
  }
  else if (a === 'image') { keepSel(); openImgModal(null); return; }
  keepSel(); richDirty = true; setSyncStatus(true); scheduleRichSync(); updateToolbarState();
}
function updateToolbarState() {
  if (edMode !== 'rich' || !$('rtb')) return;
  var map = { bold: 'bold', italic: 'italic', ul: 'insertUnorderedList', ol: 'insertOrderedList' };
  document.querySelectorAll('#rtb .rtb-btn').forEach(function (b) {
    var a = b.getAttribute('data-a'), on = false;
    try { if (map[a]) on = document.queryCommandState(map[a]); } catch (e) {}
    if (a === 'quote' || a === 'code') {
      var sel = window.getSelection(), n = sel && sel.rangeCount ? sel.anchorNode : null;
      if (n && n.nodeType === 3) n = n.parentNode;
      on = !!(n && n.closest && n.closest(a === 'quote' ? 'blockquote' : 'code'));
    }
    b.classList.toggle('on', !!on);
  });
}
/* 富文本粘贴 HTML 白名单清洗插入（原型 insertSanitizedHtml；清洗规则见内核 sanitizeFragment） */
function insertSanitizedHtml(html) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  var clean = sanitizeFragment(doc.body);
  var sel = window.getSelection();
  if (sel && sel.rangeCount) {
    var r = sel.getRangeAt(0); r.deleteContents();
    var frag = document.createDocumentFragment(), n, nodes = [];
    while ((n = clean.firstChild)) nodes.push(n);
    nodes.forEach(function (x) { frag.appendChild(x); });
    r.insertNode(frag);
  }
  richDirty = true; setSyncStatus(true); scheduleRichSync();
}
