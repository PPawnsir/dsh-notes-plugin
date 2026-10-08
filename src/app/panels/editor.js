/* ================= 选中与编辑器 ================= */
function selectNote(id) {
  /* 草稿切走兜底（notes-034-batch3）：有内容的草稿先 flush 落库（fire-and-forget，不阻塞切换）；空草稿直接弃——零 Untitled 残留；
     落库在途（draftCreating）时跳过 flush——在途 create 沉降后自行 toast + 刷新列表（防并发双建） */
  if (draftNote) { var _d = draftNote; draftNote = null; if (edNote === _d) { if (edMode === 'rich' && richDirty) syncFromRich('切换笔记'); edNote = null } if (!draftCreating) flushDraftCreate(_d); }
  /* 双模式：切换笔记前把富文本在途编辑序列化落回 edNote.body 并立即保存（防 900ms debounce 打到新笔记上） */
  else if (edMode === 'rich' && richDirty && edNote) { syncFromRich('切换笔记'); doSave(); }
  selId = id; scopeOpen = false;
  focusId = id;   /* 选中同步键盘焦点行（j/k 从当前选中行继续） */
  var n = notes.find(function (x) { return x.id === id });
  if (n && n.folder) { foldOpen[n.folder] = true; saveFoldOpen() }
  edNote = n ? Object.assign({}, n, { body: '' }) : null;
  edBodyLoaded = false; edBodyErr = '';   /* R-1 安全态复位：新笔记正文未加载前提交闸关闭、错误横幅清空（renderEd 在其后执行，DOM 初态一致） */
  organizeErr = '';                        /* 0.4.7-B⑥a：换笔记清整理失败驻留条（驻留粒度 = 当前笔记） */
  degraded = { ok: true, reasons: [] };   /* 正文未加载前降级态复位（横幅不残留上一条笔记的分析结果） */
  renderTree(); renderEd();
  if (n) {
    histCount = null; probeHistCount(id);   /* 换笔记重置「历史」入口可见性，随即探测版本计数 */
    loadEdBody(id);
  } else if (id) {
    /* 0.4.4-A open-by-id 通道（notes-044-dispatch-receipts 执行记录跳转）：缓存未命中 = 列表未含该笔记
       （存量 kind=sys 执行记录缺省降噪 / 缓存尚未刷新的在途新建）——notes-get 直开编辑器；
       不进 notes 缓存（不刷列表/树红线）；失败 toast 不硬跳（防空白编辑器） */
    rpc('notes-get', { id: id }).then(function (res) {
      if (selId !== id) return;   /* 迟到响应守卫（同 loadEdBody 口径）：用户已切走零副作用 */
      if (res && res.note) {
        histCount = null; probeHistCount(id);
        edNote = res.note; edBodyLoaded = true; edBodyErr = '';
        wikiBodies[id] = { body: edNote.body || '', updatedAt: res.note.updatedAt || '' };   /* 双链索引即时新鲜 */
        degraded = analyzeMarkdown(edNote.body || '');
        if (edMode === 'rich' && !degraded.ok) edMode = 'source';
        renderEd();
      } else toast(t('meta.runLogNotFound', { id: id }));
    }).catch(function () { if (selId === id) toast(t('meta.runLogNotFound', { id: id })) });
  }
}
/* R-1 安全态·正文加载（notes-get 独立成函数，「选中」与横幅「重试」共用）：
   成功 → edBodyLoaded=true（doSave 唯一放行点）；失败（res.error / 空响应 / 网络异常）→ 安全态：
   edBodyLoaded 保持 false + edBodyErr 驱动锁定横幅（显式错误 + 重试入口），绝不以空 body 为基底提交。
   全部状态写入以 selId===id 守卫：迟到响应（用户已切走）零副作用。 */
function loadEdBody(id) {
  edLoading = true; edBodyLoaded = false; edBodyErr = ''; refreshLoadErrUI();
  rpc('notes-get', { id: id }).then(function (res) {
    if (selId !== id) return;   /* 迟到响应：新笔记有自己的加载流程，勿动其状态 */
    edLoading = false;
    if (res && res.note) {
      edNote = res.note;
      edBodyLoaded = true;   /* R-1 正文提交闸：全局唯一放行点 */
      wikiBodies[id] = { body: edNote.body || '', updatedAt: res.note.updatedAt || '' };   /* 双链索引即时新鲜（不等后台补缺） */
      /* 正文到达后跑降级分析；富文本模式下新正文含白名单外语法 → 回落源码模式 */
      degraded = analyzeMarkdown(edNote.body || '');
      if (edMode === 'rich' && !degraded.ok) { edMode = 'source'; toast(t('editor.richDegradedReasons', { reasons: degraded.reasons.map(function (r) { return r.label }).join(t('common.listSep')) })); renderEd(); }
      else { fillEdBody(); renderEdFoot(); refreshDegradeUI(); renderBacklinks(); }
    } else {
      edBodyErr = t('editor.loadFailed', { msg: res && res.error ? res.error : t('editor.loadFailedData') });
      toast(t('editor.loadFailedLocked', { msg: edBodyErr }));
    }
    refreshLoadErrUI();
  }).catch(function (e) {
    if (selId !== id) return;
    edLoading = false;
    edBodyErr = t('editor.loadFailed', { msg: e && e.message || e });
    toast(t('editor.loadFailedLocked', { msg: edBodyErr }));
    refreshLoadErrUI();
  })
}
/* R-1 安全态 UI：失败横幅（复用 .deg 警告样式，含重试入口）+ 编辑锁定（标题/正文只读——防用户在注定被重试覆盖的缓冲里打字）；
   renderEd 重建 DOM 后必须重挂（元素级 _bound 随重建自然复位） */
function refreshLoadErrUI() {
  var bn = $('edLoadErr');
  if (bn) {
    bn.style.display = edBodyErr ? 'flex' : 'none';
    var msg = $('edLoadErrMsg'); if (msg) msg.textContent = edBodyErr || '';
    var rt = $('edLoadRetry');
    if (rt && !rt._bound) { rt._bound = true; rt.addEventListener('click', function () { if (selId) loadEdBody(selId) }) }
  }
  var locked = !!edBodyErr;
  /* 0.4.7-C ②b（notes-047-stability）：源码模式在途窗补同款锁（0.4.6-A 只锁富文本——在途窗源码可打字 = 落定回填盖掉输入的假同步洞）；
     在途/失败两态都锁，落定（成功回填/失败重试后）解锁；placeholder 在途文案口径不动（0.4.6-B 锚） */
  var ta = $('edSrc'); if (ta) { ta.readOnly = locked || edBodyPending(); ta.placeholder = edBodyPending() ? t('editor.bodySyncing') : t('editor.bodyPlaceholder') }   /* 0.4.6-B：源码正文在途窗 placeholder 转「正文加载中…」（不再空白；落定/出错即还原） */
  var ti = $('edTitle'); if (ti) ti.contentEditable = locked ? 'false' : 'true';
  /* 0.4.6-A：富文本在正文在途窗同步锁编辑（假同步根修连带闸） */
  var rich = $('edRich'); if (rich) rich.contentEditable = (locked || edBodyPending()) ? 'false' : 'true';
  /* 0.4.7-C ②a：失败态同步点接管——错误进出/在途起止均经本函数收敛到同一呈现（旧口径失败后同步点滞留「加载中」橙点不落幕） */
  setSyncStatus(false);
}
/* 0.4.6-A（notes-046-rich-freeze，UXR2 反馈 n-mux892tew6bf 现象①根修）：正文在途窗判定——
   笔记已选（edNote 在）而 notes-get 未落定（edBodyLoaded=false）且无错误横幅时，
   旧口径富文本渲染空 div + 绿点「已同步源码」= 假同步（RPC 尖刺期窗口实测可达秒级，用户直视即「正文空白」）；
   窗口期口径：富文本锁编辑（contentEditable=false，堵「空态打字→失焦把空态当编辑序列化」错觉链）+ 同步点转「加载中」橙点（不冒绿）。
   草稿态天然豁免：doNewNote 本地全量持有正文（edBodyLoaded=true），无 get 链路。 */
function edBodyPending() { return !!(edNote && !edBodyLoaded && !edBodyErr) }
/* 正文填充双模式：源码 → textarea.value；富文本 → 内核渲染进 contenteditable（填充前清 dirty，防回填被当编辑） */
function fillEdBody() {
  if (!edNote) return;
  var body = edNote.body || '';
  if ($('edSrc')) $('edSrc').value = body;
  if (edMode === 'rich' && $('edRich')) {
    /* 0.4.6-A：在途窗富文本不填内核产物（空态 + 锁编辑 + 加载中同步点）；落定由 loadEdBody 链重调本函数回填 */
    var pend = edBodyPending();
    richDirty = false;
    $('edRich').innerHTML = pend ? '' : renderMarkdown(body, wikiResolve);
    $('edRich').contentEditable = pend ? 'false' : 'true';
    setSyncStatus(false);
  }
}
function triggerSave() { clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 900) }
/* 0.4.7-C（notes-047-stability ①）：自动保存载荷构建单点化——doSave 与卸载兜底 flushPendingSave 共用同一构造（防双份漂移）；
   null = 守卫拦截（无笔记/无选中/R-1 安全态暂停），调用方零动作 */
function buildSavePayload() {
  if (!edNote) return null;
  if (!selId) return null;
  if (edBodyErr) return null;   /* R-1 安全态：正文加载失败未恢复前自动保存整体暂停（含元数据）——横幅「重试」是唯一出口 */
  var keepQuick = (notes.find(function (x) { return x.id === selId }) || {}).tags || [];
  var tags = (edNote._tagsStr != null ? edNote._tagsStr : (edNote.tags || []).filter(function (t) { return t !== 'quick' }).join(', '))
    .split(/[,，;；]/).map(function (s) { return s.trim() }).filter(Boolean);
  if (keepQuick.indexOf('quick') >= 0 && tags.indexOf('quick') < 0) tags.push('quick');
  var upd = {
    id: selId, title: edNote.title, tags: tags,
    kind: edNote.kind, status: edNote.status, inject: edNote.inject === true,
    injectTo: edNote.injectTo || [], recall: edNote.recall !== false, sensitive: edNote.sensitive === true, hidden: edNote.hidden === true
  };
  /* R-1 正文提交闸：仅 notes-get 成功加载过正文（edBodyLoaded）才允许携带 body（host 对 undefined 保留原内容，防竞态清空正文）；
     已加载基础上清空为空串 = 用户有意为之，附 confirmClearBody:true 显式过 host 空覆盖兜底闸（empty-body-overwrite-guard） */
  if (edBodyLoaded) { upd.body = edNote.body; if (upd.body === '') upd.confirmClearBody = true }
  if (upd.inject) upd.injectRole = edNote.injectRole === 'reference' ? 'reference' : 'convention';   /* 非 off 才带 injectRole（payload 禁 undefined） */
  if ((edNote.topic || '').trim()) upd.topic = edNote.topic.trim();
  return upd;
}
function doSave() {
  if (!edNote) return;
  /* 草稿态（notes-034-batch3）：首次有效编辑走 notes-create 落库（空内容闸在 doDraftCreate 内）；落库后 draftNote 清空、后续走正常 update */
  if (draftNote) { doDraftCreate(); return }
  var upd = buildSavePayload(); if (!upd) return;   /* 0.4.7-C：载荷构建单点化（卸载 flush 同口径） */
  rpc('notes-update', upd).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    $('edSaved').textContent = t('editor.autoSaved', { time: new Date().toTimeString().slice(0, 5) });
    /* 0.4.6-D（notes-046-copy-consistency，R2 n-mux8bv3x6lll）：「更新」时间戳随每次自动保存刷新——edNote 是选中时的拷贝，
       不随 loadNotes 换代（底栏 renderEdFoot 读 edNote.updatedAt，不刷即滞留旧值）；迟到响应守卫：已切走（id 不符）不重渲底栏 */
    if (edNote && edNote.id === upd.id) { edNote.updatedAt = new Date().toISOString(); renderEdFoot(); }
    edNote._tagsStr = null;
    wikiBodies[selId] = { body: edNote.body || '', updatedAt: '' };   /* 双链索引：自有正文即时新鲜（updatedAt 置空 → loadNotes 后索引复核） */
    renderBacklinks();
    loadNotes(true);
    if (histCount === 0) probeHistCount(selId);   /* 首次真实保存产生首份快照（0→1 转折点）→ 补探「历史」入口 */
  }).catch(function (e) { toast(t('common.saveFailed', { msg: e && e.message || e })) });
}
/* 0.4.7-C（notes-047-stability ①）：页面卸载兜底 flush——<900ms debounce 窗口内的在途编辑立即落盘（不等到期）。
   富文本在途先序列化回 edNote.body（beforeunload 期 DOM 仍在）；debounce 计时器取消后走 keepalive 直发（页面拆毁后仍送达）。
   R-1 提交闸/edBodyErr 暂停语义经 buildSavePayload 与 doSave 同口径继承；无在途（saveTimer 空）零动作；
   草稿在途：create 落库同走 keepalive（draftCreating 在飞时跳过——在途 create 自带沉降，防并发双建同口径） */
function flushPendingSave() {
  if (edMode === 'rich' && richDirty && edNote) syncFromRich('卸载冲刷');
  if (!saveTimer) return;
  clearTimeout(saveTimer); saveTimer = null;
  if (draftNote) { if (!draftCreating) { var dp = draftPayloadOf(draftNote); if (dp) rpcKeepalive('notes-create', dp) } return; }
  var upd = buildSavePayload(); if (!upd) return;
  rpcKeepalive('notes-update', upd);
}
function injectScopeLabel(injectTo) {
  var arr = (injectTo || []).filter(function (t) { return t !== 'global' && t !== 'workspace' });
  if (arr.length === 0) return t('meta.scopeAll');
  /* 形参改名 tg（原 t 遮蔽全局 t()，i18n 抽串需要回调内可调 t()——同 cov-a tree.js 前置提升同源的遮蔽处理） */
  var names = arr.map(function (tg) {
    var st = shortSid(tg);   /* 归一比对（notes-034-injectto-norm）：存量长 id 先约到短 id 再匹配会话名 */
    var s = sessList.find(function (x) { return x.short === st });
    return s ? s.name : t('meta.scopeSession', { name: st });
  });
  return names.join(t('common.listSep'));
}
function renderEd() {
  var ed = $('ed');
  wikiAcClose();   /* 0.4.8：重建编辑器 DOM 前收编 [[ 补全下拉（弹层挂 document.body，不随 textarea 重建自动销毁） */
  if (!edNote) {
    ed.className = 'ed empty';
    ed.innerHTML = '<svg class="ic"><use href="#i-note"/></svg><div>' + t('editor.emptyTitle') + '</div><div style="font-size:11px">' + t('editor.emptySub') + '</div>'
      + '<div style="font-size:11px" class="ed-empty-concept">' + t('editor.emptyConcept') + '</div>';   /* 0.4.6-C：空态首笔记引导补概念指向（静态壳同款一行，双处对齐） */
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
    + '<div class="deg" id="degBanner" style="display:none"><svg class="ic"><use href="#i-warn"/></svg><div>' + t('editor.degBanner') + '<span class="rs" id="degReasons"></span><br>' + t('editor.degBanner2') + '</div></div>'
    /* R-1 安全态横幅（正文加载失败）：复用 .deg 警告样式；edLoadErrMsg=错误详情，edLoadRetry=重试入口（refreshLoadErrUI 驱动显隐与锁定） */
    + '<div class="deg" id="edLoadErr" style="display:none"><svg class="ic"><use href="#i-warn"/></svg><div><span id="edLoadErrMsg"></span>' + t('editor.loadLockNote') + '<span id="edLoadRetry" style="cursor:pointer;color:var(--nacc);font-weight:600">' + t('editor.retry') + '</span></div></div>'
    /* 0.4.7-B⑥a（notes-047-ux）：整理失败驻留条（复用 .deg 警告样式，手动 ✕ 才消失——替代一闪而过的 toast；refreshOrganizeUI 驱动） */
    + '<div class="deg" id="orgErr" style="display:none"><svg class="ic"><use href="#i-warn"/></svg><div><span id="orgErrMsg"></span></div><span class="org-x" id="orgErrX" role="button" tabindex="0" title="' + t('common.close') + '">' + icon('i-x', 11) + '</span></div>'
    /* 0.4.7-B⑥：整理中正文区遮罩（spinner + 「约需半分钟」文案——LLM 窗口期强反馈，消除「没反应」体感） */
    + '<div class="org-veil" id="orgVeil" style="display:none"><span class="org-spin"></span><span>' + t('editor.organizingVeil') + '</span></div>'
    + '<textarea class="src" id="edSrc" spellcheck="false" placeholder="' + t('editor.bodyPlaceholder') + '"' + (edMode === 'source' ? '' : ' style="display:none"') + '></textarea>'
    + '<div class="rich-scroll rich-wrap" id="richScroll"' + (edMode === 'rich' ? '' : ' style="display:none"') + '>'
    + '<div class="rtb" id="rtb">'
    + '<button class="rtb-btn" data-a="bold" title="' + t('editor.tbBold') + '">' + icon('i-bold', 14) + '</button>'
    + '<button class="rtb-btn" data-a="italic" title="' + t('editor.tbItalic') + '">' + icon('i-italic', 14) + '</button>'
    + '<button class="rtb-btn" data-a="code" title="' + t('editor.tbCode') + '">' + icon('i-code-block', 14) + '</button>'
    + '<button class="rtb-btn" data-a="link" title="' + t('editor.tbLink') + '">' + icon('i-link', 14) + '</button>'
    + '<span class="rtb-sep"></span>'
    + '<button class="rtb-btn" data-a="ul" title="' + t('editor.tbUl') + '">' + icon('i-ul', 14) + '</button>'
    + '<button class="rtb-btn" data-a="ol" title="' + t('editor.tbOl') + '">' + icon('i-ol', 14) + '</button>'
    + '<button class="rtb-btn" data-a="quote" title="' + t('editor.tbQuote') + '">' + icon('i-quote', 14) + '</button>'
    + '<span class="rtb-sep"></span>'
    + '<button class="rtb-btn" data-a="image" title="' + t('editor.tbImage') + '">' + icon('i-image', 14) + '</button>'
    + '<span class="sync' + (edBodyErr ? ' err' : ((edBodyPending() || richDirty) ? '' : ' ok')) + '" id="syncPill"><span class="sd"></span><span id="syncTxt">' + (edBodyErr ? t('editor.syncFailed') : edBodyPending() ? t('editor.bodySyncing') : (richDirty ? t('editor.syncing') : t('editor.synced'))) + '</span></span>'   /* 0.4.7-C ②a：初态同走失败态分支（与 setSyncStatus 同一口径） */
    + '</div>'
    + '<div class="rich" id="edRich" contenteditable="true" spellcheck="false"></div>'
    + '</div>'
    + '</div>'
    + '<div class="backlinks" id="backlinksHost"></div>'
    + '<div class="ed-foot"><span id="footMode">' + (edMode === 'source' ? t('editor.modeSource') : t('editor.modeRich')) + '</span><span id="edCreated"></span><span id="edUpdated"></span><span id="edSource"></span><span class="saved" id="edSaved"></span></div>';
  renderCrumb(); renderMeta(); renderDispatches(); fillEdBody(); renderEdFoot(); refreshDegradeUI(); renderBacklinks();
  $('edTitle').textContent = n.title === 'Untitled' ? '' : (n.title || '');
  $('edTitle').addEventListener('input', function () { if (!edNote) return; edNote.title = this.textContent.trim() || 'Untitled'; triggerSave() });
  bindEditorArea();
  refreshLoadErrUI();   /* R-1：DOM 重建后重挂安全态（横幅显隐 + 编辑锁定 + 重试绑定） */
  refreshOrganizeUI();   /* 0.4.7-B⑥：DOM 重建后复态整理中遮罩/失败驻留条（同 refreshLoadErrUI 先例） */
}
/* 编辑区事件绑定（renderEd 重建 DOM 后重挂；元素级监听随重建不累积，document 级 selectionchange 在启动区挂一次） */
function bindEditorArea() {
  var ta = $('edSrc');
  if (ta) {
    ta.addEventListener('input', function () { if (!edNote) return; edNote.body = this.value; triggerSave(); scheduleDegAnalyze(); });
    /* 图片入口①/②（源码模式）：粘贴/拖拽图片文件 → 同一上传弹窗 → 光标处插 Markdown 文本 */
    ta.addEventListener('paste', function (ev) { var cd = ev.clipboardData; if (cd && cd.files && cd.files.length && /^image\//.test(cd.files[0].type)) { ev.preventDefault(); pickImageFile(cd.files[0]); } });
    ta.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    ta.addEventListener('drop', function (ev) { var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (!f) return; ev.preventDefault(); if (!/^image\//.test(f.type)) { toast(t('editor.imageOnly')); return } pickImageFile(f); });
    bindWikiAc(ta);   /* 0.4.8：源码模式 [[ 双链输入补全（panels/wiki-ac.js；input/keydown/blur/scroll 四挂点） */
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
      if (tb) toast(t('editor.tableReadonly'));
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
    if (!/^image\//.test(f.type)) { toast(t('editor.imageOnly')); return; }
    keepSel(); pickImageFile(f);
  });
  /* 工具栏：mousedown 阻止默认（保住选区/焦点） */
  wrap.querySelectorAll('.rtb-btn').forEach(function (b) {
    b.addEventListener('mousedown', function (ev) { ev.preventDefault(); toolbarAction(b.getAttribute('data-a')); });
  });
}
/* 同步态徽标（原型 syncPill）：编辑中…（橙点）/ 已同步源码（绿点）；0.4.6-A：正文在途窗 = 加载中…（橙点，不冒绿假同步）；
   0.4.7-C ②a：失败态统一——edBodyErr 在窗 = 红点「加载失败」（与横幅同口径；替代旧口径滞留橙/冒绿的双端不一） */
function setSyncStatus(editing) {
  var pill = $('syncPill'); if (!pill) return;
  var pend = edBodyPending();
  pill.className = 'sync' + (edBodyErr ? ' err' : (pend || editing ? '' : ' ok'));
  if ($('syncTxt')) $('syncTxt').textContent = edBodyErr ? t('editor.syncFailed') : pend ? t('editor.bodySyncing') : editing ? t('editor.syncing') : t('editor.synced');
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
    if (was !== a.ok) toast(a.ok ? t('editor.richRestored') : t('editor.richDisabled'));
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
    if ($('degReasons')) $('degReasons').textContent = d.reasons.map(function (r) { return t('editor.degReasonItem', { label: r.label, line: r.line, sample: r.sample }) }).join(t('common.listSep'));
    if ($('richTip')) $('richTip').textContent = t('editor.richDegradedReasons', { reasons: d.reasons.map(function (r) { return r.label }).join(t('common.listSep')) });
  }
}
/* 模式切换（原型 setMode）：进富文本前跑降级分析；离开富文本先把在途编辑序列化落回源码 */
function switchMode(m) {
  if (m === edMode) return;
  wikiAcClose();   /* 0.4.8：离开源码模式收编 [[ 补全下拉（textarea 隐藏后光标量测无意义） */
  if (m === 'rich') {
    degraded = analyzeMarkdown(edNote ? edNote.body || '' : '');
    refreshDegradeUI();
    if (!degraded.ok) { toast(t('editor.richDegradedReasons', { reasons: degraded.reasons.map(function (r) { return r.label }).join(t('common.listSep')) })); return; }
    richDirty = false;
    edMode = 'rich';
    renderModeUI();
    var rich = $('edRich');
    /* 0.4.6-A：在途窗切富文本不填内核产物（防空白+假绿点重演），落定由 loadEdBody → fillEdBody 回填解锁 */
    var pend = edBodyPending();
    rich.innerHTML = pend ? '' : renderMarkdown(edNote ? edNote.body || '' : '', wikiResolve);
    rich.contentEditable = pend ? 'false' : 'true';
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
  if ($('footMode')) $('footMode').textContent = edMode === 'source' ? t('editor.modeSource') : t('editor.modeRich');
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
    if (!txt) { toast(t('editor.selectCodeFirst')); return; }
    document.execCommand('insertHTML', false, '<code>' + esc(txt) + '</code>');
  }
  else if (a === 'link') {
    var sel2 = window.getSelection();
    if (!sel2 || sel2.isCollapsed) { toast(t('editor.selectLinkFirst')); return; }
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
