/* ================= 选中与编辑器 ================= */
/* 0.4.8（notes-048-topic-tag-merge）：编辑器选中折叠——topic 非空且≠未分类/≠分类中（瞬态占位不落标签）时折入 tags（去重），
   标签控件 chips 即「读侧合并后」的全量标签；topic 字段本体保留不清（buildSavePayload 据此判定落盘清空——写侧惰性落盘）。
   每个 edNote 赋值点都要过本函数（selectNote/open-by-id/loadEdBody/refreshSelected），防刷新换代丢折叠 */
function edFoldTopic(n) {
  if (!n) return n;
  var tp = (n.topic || '').trim();
  if (tp && tp !== '未分类' && tp !== '分类中') {
    n.tags = (n.tags || []).slice();
    if (n.tags.indexOf(tp) < 0) n.tags.push(tp);
  }
  return n;
}
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
  edNote = n ? edFoldTopic(Object.assign({}, n, { body: '' })) : null;   /* 0.4.8：topic 折入 tags（标签控件 chips 数据源） */
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
        edNote = edFoldTopic(res.note); edBodyLoaded = true; edBodyErr = '';   /* 0.4.8：open-by-id 同折叠 */
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
      edNote = edFoldTopic(res.note);   /* 0.4.8：正文落定回填同折叠（topic → tags） */
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
    bindSecretBlocks($('edRich'));   /* 文档安全 S1：机密岛交互挂接（揭示/取消机密；重建后重挂） */
  }
  refreshSecretMirror();   /* 文档安全 S1：源码模式行染色镜像随回填重建（机密 span 存在时才有实质内容） */
}
function triggerSave() { clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 900) }
/* 0.4.7-C（notes-047-stability ①）：自动保存载荷构建单点化——doSave 与卸载兜底 flushPendingSave 共用同一构造（防双份漂移）；
   null = 守卫拦截（无笔记/无选中/R-1 安全态暂停），调用方零动作 */
function buildSavePayload() {
  if (!edNote) return null;
  if (!selId) return null;
  if (edBodyErr) return null;   /* R-1 安全态：正文加载失败未恢复前自动保存整体暂停（含元数据）——横幅「重试」是唯一出口 */
  var keepQuick = (notes.find(function (x) { return x.id === selId }) || {}).tags || [];
  /* 0.4.8（notes-048-topic-tag-merge）：标签控件化——chips 已提交标签（edNote.tags，选中时 edFoldTopic 已把 topic 折入）
     为唯一事实源；在途输入串（_tagsStr，未按分隔符的尾部）同样并入落盘（输入即所得，与旧「整串即标签集」口径对齐） */
  var tags = (edNote.tags || []).filter(function (t) { return t !== 'quick' }).map(function (s) { return String(s).trim() }).filter(Boolean);
  if (edNote._tagsStr != null) edNote._tagsStr.split(/[,，;；]/).forEach(function (s) { s = s.trim(); if (s && tags.indexOf(s) < 0) tags.push(s) });
  tags = tags.filter(function (v, i) { return tags.indexOf(v) === i });   /* 精确去重（chips 与在途合并后） */
  if (keepQuick.indexOf('quick') >= 0 && tags.indexOf('quick') < 0) tags.push('quick');
  edNote.tags = tags.slice();   /* 回写本地：保存后 renderMeta chips 与落盘一致（不等列表刷新换代） */
  var upd = {
    id: selId, title: edNote.title, tags: tags,
    kind: edNote.kind, status: edNote.status, inject: edNote.inject === true,
    injectTo: edNote.injectTo || [], recall: edNote.recall !== false, sensitive: edNote.sensitive === true, hidden: edNote.hidden === true
  };
  /* R-1 正文提交闸：仅 notes-get 成功加载过正文（edBodyLoaded）才允许携带 body（host 对 undefined 保留原内容，防竞态清空正文）；
     已加载基础上清空为空串 = 用户有意为之，附 confirmClearBody:true 显式过 host 空覆盖兜底闸（empty-body-overwrite-guard） */
  if (edBodyLoaded) { upd.body = edNote.body; if (upd.body === '') upd.confirmClearBody = true }
  if (upd.inject) upd.injectRole = edNote.injectRole === 'reference' ? 'reference' : 'convention';   /* 非 off 才带 injectRole（payload 禁 undefined） */
  /* 0.4.8 写侧惰性落盘：topic 非空且≠未分类/≠分类中（瞬态占位不触写）→ 落盘清空（tags 已经 edFoldTopic 折入该值；
     用户 ✕ 移除该 chip 时本清空同样生效 = 显式移除被尊重）。磁盘 .md 仅此路径懒迁移，绝不批量改写存量 */
  var tp0 = (edNote.topic || '').trim();
  if (tp0 && tp0 !== '未分类' && tp0 !== '分类中') { upd.topic = ''; edNote.topic = '' }
  return upd;
}
function doSave() {
  if (!edNote) return;
  /* 草稿态（notes-034-batch3）：首次有效编辑走 notes-create 落库（空内容闸在 doDraftCreate 内）；落库后 draftNote 清空、后续走正常 update */
  if (draftNote) { doDraftCreate(); return }
  var upd = buildSavePayload(); if (!upd) return;   /* 0.4.7-C：载荷构建单点化（卸载 flush 同口径） */
  rpc('notes-update', upd).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    $('edSaved').textContent = t('editor.autoSaved', { time: (edSavedAt = new Date().toTimeString().slice(0, 5)) });   /* 0.4.9：edSavedAt 记账（语言切换 renderEdLang 按新语言重写本行） */
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
  edSavedAt = '';   /* 0.4.9：编辑器重建 = 「已自动保存」行归零（与 edSaved 空 span 初态同口径；换笔记/后台刷新换代不留旧时刻） */
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
    + '<div class="deg" id="degBanner" style="display:none"><svg class="ic"><use href="#i-warn"/></svg><div><span id="degBanner1">' + t('editor.degBanner') + '</span><span class="rs" id="degReasons"></span><br><span id="degBanner2">' + t('editor.degBanner2') + '</span></div></div>'
    /* R-1 安全态横幅（正文加载失败）：复用 .deg 警告样式；edLoadErrMsg=错误详情，edLoadRetry=重试入口（refreshLoadErrUI 驱动显隐与锁定） */
    + '<div class="deg" id="edLoadErr" style="display:none"><svg class="ic"><use href="#i-warn"/></svg><div><span id="edLoadErrMsg"></span><span id="edLoadErrNote">' + t('editor.loadLockNote') + '</span><span id="edLoadRetry" style="cursor:pointer;color:var(--nacc);font-weight:600">' + t('editor.retry') + '</span></div></div>'
    /* 0.4.7-B⑥a（notes-047-ux）：整理失败驻留条（复用 .deg 警告样式，手动 ✕ 才消失——替代一闪而过的 toast；refreshOrganizeUI 驱动） */
    + '<div class="deg" id="orgErr" style="display:none"><svg class="ic"><use href="#i-warn"/></svg><div><span id="orgErrMsg"></span></div><span class="org-x" id="orgErrX" role="button" tabindex="0" title="' + t('common.close') + '">' + icon('i-x', 11) + '</span></div>'
    /* 0.4.7-B⑥：整理中正文区遮罩（spinner + 「约需半分钟」文案——LLM 窗口期强反馈，消除「没反应」体感） */
    + '<div class="org-veil" id="orgVeil" style="display:none"><span class="org-spin"></span><span id="orgVeilTxt">' + t('editor.organizingVeil') + '</span></div>'
    + '<div class="src-wrap" id="srcWrap"' + (edMode === 'source' ? '' : ' style="display:none"') + '>'   /* 驳回修复：id 必携——renderModeUI $('srcWrap') 显隐开关依赖（v1 漏 id 致富文本态重渲染后切回源码 wrapper 恒 display:none，编辑区空白） */
    + '<textarea class="src" id="edSrc" spellcheck="false" placeholder="' + t('editor.bodyPlaceholder') + '"></textarea>'
    /* 文档安全 S1：源码模式行背景染色镜像（机密 fence 行视觉锚）——与 edSrc 同字体/行距/内边距，透明文字 + 色带；仅机密 span 存在时填充 */
    + '<div class="src-mirror" id="srcMirror" aria-hidden="true"></div>'
    + '</div>'
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
    /* 文档安全 S1：🛡 标为机密（有选区才亮——updateToolbarState 点亮；无选区点击 toast 引导） */
    + '<span class="rtb-sep"></span>'
    + '<button class="rtb-btn" data-a="secret" title="' + t('editor.tbSecret') + '">\uD83D\uDEE1</button>'
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
/* 0.4.9（notes-049-lang-rerender-editor）：语言切换编辑器区重渲染覆盖——footer 状态行/「已自动保存」/同步点/反链面板随语言翻转。
   挂点 = render() 链路（setLang → render()；筛/排/搜的 render() 同走——纯文案原地重写，幂等零副作用）。
   在途编辑保护（0.4.7-C 假同步洞锁不回退）：永不重建正文 DOM（edSrc/edRich/edTitle 原地不动——dirty 态正文/IME 组合/光标零打扰），
   只重写 chrome 文案行；空态（无打开笔记）走 renderEd() 空态分支（无正文可损，原地重建零风险）。 */
function renderEdLang() {
  if (!edNote) { renderEd(); return }
  if ($('footMode')) $('footMode').textContent = edMode === 'source' ? t('editor.modeSource') : t('editor.modeRich');
  renderEdFoot();
  var sv = $('edSaved'); if (sv && edSavedAt) sv.textContent = t('editor.autoSaved', { time: edSavedAt });
  setSyncStatus(!!(richDirty || saveTimer));
  var ta = $('edSrc'); if (ta) ta.placeholder = edBodyPending() ? t('editor.bodySyncing') : t('editor.bodyPlaceholder');
  renderBacklinks();
  /* 0.5.0（notes-050-edge-i18n）：边缘态横幅/整理遮罩/工具栏 title 随语言原地重写（不重建正文 DOM） */
  var db1 = $('degBanner1'); if (db1) db1.innerHTML = t('editor.degBanner');
  var db2 = $('degBanner2'); if (db2) db2.textContent = t('editor.degBanner2');
  var drs = $('degReasons'); if (drs && degraded && !degraded.ok) drs.textContent = degraded.reasons.map(function (r) { return t('editor.degReasonItem', { label: r.label, line: r.line, sample: r.sample }) }).join(t('common.listSep'));
  var ln = $('edLoadErrNote'); if (ln) ln.textContent = t('editor.loadLockNote');
  var lr = $('edLoadRetry'); if (lr) lr.textContent = t('editor.retry');
  var ox = $('orgErrX'); if (ox) ox.title = t('common.close');
  var vx = $('orgVeilTxt'); if (vx) vx.textContent = t('editor.organizingVeil');
  var rtb = $('rtb'); if (rtb) rtb.querySelectorAll('.rtb-btn').forEach(function (b) {
    var k = { bold: 'editor.tbBold', italic: 'editor.tbItalic', code: 'editor.tbCode', link: 'editor.tbLink', ul: 'editor.tbUl', ol: 'editor.tbOl', quote: 'editor.tbQuote', image: 'editor.tbImage', secret: 'editor.tbSecret' }[b.getAttribute('data-a')];
    if (k) b.title = t(k);
  });
  /* 文档安全 S1：机密岛 chrome 文案随语言翻转（🔒 tooltip/取消机密钮——纯文案原地重写，不重建正文 DOM，0.4.9 同款纪律） */
  var richEl = $('edRich'); if (richEl) richEl.querySelectorAll('pre.dsh-notes-secret').forEach(function (sb) { refreshSecretBlockText(sb) });
}
/* 编辑区事件绑定（renderEd 重建 DOM 后重挂；元素级监听随重建不累积，document 级 selectionchange 在启动区挂一次） */
function bindEditorArea() {
  var ta = $('edSrc');
  if (ta) {
    ta.addEventListener('input', function () { if (!edNote) return; edNote.body = this.value; triggerSave(); scheduleDegAnalyze(); refreshSecretMirror(); });
    /* 图片入口①/②（源码模式）：粘贴/拖拽图片文件 → 同一上传弹窗 → 光标处插 Markdown 文本 */
    ta.addEventListener('paste', function (ev) { var cd = ev.clipboardData; if (cd && cd.files && cd.files.length && /^image\//.test(cd.files[0].type)) { ev.preventDefault(); pickImageFile(cd.files[0]); } });
    ta.addEventListener('dragover', function (ev) { ev.preventDefault(); });
    ta.addEventListener('drop', function (ev) { var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (!f) return; ev.preventDefault(); if (!/^image\//.test(f.type)) { toast(t('editor.imageOnly')); return } pickImageFile(f); });
    /* 文档安全 S1：源码镜像滚动同步（镜像 overflow:hidden，程序化 scrollTop 跟随） */
    ta.addEventListener('scroll', function () { var mi = $('srcMirror'); if (mi) mi.scrollTop = this.scrollTop });
    /* 文档安全 S1 标记入口②：编辑器右键菜单（0.4.8 ctxmenu 基建——#ctxHost + .ctxmenu/.mi + closeCtx/Esc 通用闸）；
       有选区才拦截原生菜单（有选区才亮口径，与 Ctrl+Shift+S 一致）；选区快照入菜单闭包（菜单点击即用——textarea 选区会被点击吞掉） */
    ta.addEventListener('contextmenu', function (ev) {
      if (this.selectionStart === this.selectionEnd) return;
      ev.preventDefault();
      openSecretCtxMenu(ev.clientX, ev.clientY, snapshotSecretSel());
    });
    bindWikiAc(ta);   /* 0.4.8：源码模式 [[ 双链输入补全（panels/wiki-ac.js；input/keydown/blur/scroll 四挂点） */
  }
  var rich = $('edRich'), wrap = $('richScroll');
  if (rich && wrap && edMode === 'rich') bindRich(rich, wrap);
  /* 文档安全 S1：resize 换行点漂移跟随（窗口尺寸变化时镜像重建——有机密 span 才有实质成本）；
     renderEd 重建后重入本函数，单次闸防重复绑定（模块顶层零副作用——check 节 46/49/93/103 的
     with(Proxy) 沙箱 eval 整个 editor.js，顶层 window 访问会炸沙箱，故挂接收敛在此 + try 守卫） */
  if (!secretResizeBound) {
    secretResizeBound = true;
    try { window.addEventListener('resize', function () { refreshSecretMirror() }) } catch (e) {}
  }
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
    /* 文档安全 S1 标记入口②（富文本面）：编辑器右键菜单——同源码面口径（有选区才亮 + 选区快照闭包） */
    rich.addEventListener('contextmenu', function (ev) {
      var snap = snapshotSecretSel();
      if (!snap) return;
      ev.preventDefault();
      openSecretCtxMenu(ev.clientX, ev.clientY, snap);
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
  clearTimeout(secretRevealTimer); secretRevealTimer = null;   /* 文档安全 S1：揭示计时器随切换收编（重渲染后自然回糊，不留跨模式悬挂揭示） */
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
    bindSecretBlocks(rich);   /* 文档安全 S1：机密岛交互挂接（每次重渲染后重挂——元素级 _secretBound 随重建复位） */
    setSyncStatus(false);
  } else {
    if (richDirty) syncFromRich('切换模式');
    edMode = 'source';
    renderModeUI();
    refreshSecretMirror();   /* 文档安全 S1：源码镜像随切回重建（富文本在途经 syncFromRich 已落 body） */
  }
}
function renderModeUI() {
  var ms = $('modeSeg');
  if (ms) ms.querySelectorAll('.seg').forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-m') === edMode); });
  if ($('srcWrap')) $('srcWrap').style.display = edMode === 'source' ? 'flex' : 'none';   /* 文档安全 S1：src-wrap 包裹 textarea+镜像，整体随模式显隐 */
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
  /* 文档安全 S1 标记入口①：工具栏 🛡——选区快照包 ```secret fence（选区包 fence 即糊）；无选区 toast 引导 */
  else if (a === 'secret') { markSelectionSecret(); return; }
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
    /* 文档安全 S1：🛡 有选区才亮（选区落 #edRich 内且非折叠） */
    if (a === 'secret') {
      var ssel = window.getSelection(), sn = ssel && ssel.rangeCount ? ssel.anchorNode : null;
      if (sn && sn.nodeType === 3) sn = sn.parentNode;
      on = !!(ssel && !ssel.isCollapsed && sn && sn.closest && sn.closest('#edRich'));
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

/* ===== 文档安全 S1（notes-052-span-kernel2）：```secret 机密块 · 富文本揭示/取消机密 + 源码行染色镜像 + 标记三入口 =====
   分层纪律：内核（editor-kernel.js）只产出机密岛 markup（esc 先行 + CSS blur + data-md-src 逐字源）；本块只做交互：
   揭示（~10s 自动回糊，计时器单飞——重击重置、跨块切换即回糊）+ 揭示态「取消机密」（剥 fence 行回明文）+ 三入口
   （工具栏🛡/右键菜单/Ctrl+Shift+S——同一 applySecretSel 执行体，选区快照口径）。取消机密前先收编富文本在途编辑
   （0.4.7-C/0.4.9 dirty 保护纪律：揭示态下别处编辑不被重建吃掉）。 */
var secretRevealTimer = null;
var SECRET_REVEAL_MS = 10000;   /* 揭示驻留时长（约 10s；e2e 用例 62 按此节拍等回糊） */
var secretResizeBound = false;   /* resize 跟随绑定单次闸（renderEd 内挂接——模块顶层零副作用，check 沙箱 eval 纪律） */

/* 选区快照：标记动作与实际执行间可能隔一次菜单点击（textarea/富文本选区会被点击吞掉）——contextmenu 时刻快照，点选菜单项时用 */
function snapshotSecretSel() {
  if (!edNote) return null;
  if (edMode === 'source') {
    var ta = $('edSrc'); if (!ta) return null;
    var s = ta.selectionStart, e = ta.selectionEnd;
    return s < e ? { mode: 'source', s: s, e: e } : null;
  }
  var rich = $('edRich'); if (!rich) return null;
  var sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  var n = sel.anchorNode;
  if (n && n.nodeType === 3) n = n.parentNode;
  if (!n || !n.closest || !n.closest('#edRich')) return null;
  var txt = String(sel);
  if (!txt) return null;
  return { mode: 'rich', range: sel.getRangeAt(0).cloneRange(), text: txt };
}

/* 标记执行体（三入口共用）：选区包 ```secret fence 即糊——源码模式字节级拼接；富文本模式 insertHTML 内核机密岛 markup */
function applySecretSel(snap) {
  if (!edNote) return false;
  if (!snap) { toast(t('editor.secretNeedSelection')); return false }
  if (snap.mode === 'source') {
    var ta = $('edSrc'); if (!ta) return false;
    var body = edNote.body || '';
    if (snap.s > body.length || snap.e > body.length || snap.s >= snap.e) { toast(t('editor.secretNeedSelection')); return false }
    var wrapped = '\x60\x60\x60secret\n' + body.slice(snap.s, snap.e) + '\n\x60\x60\x60';
    var nb = body.slice(0, snap.s) + wrapped + body.slice(snap.e);
    edNote.body = nb;
    ta.value = nb;
    var caret = snap.s + wrapped.length;
    try { ta.focus(); ta.setSelectionRange(caret, caret) } catch (e2) {}
    triggerSave(); scheduleDegAnalyze(); refreshSecretMirror();
  } else {
    var rich = $('edRich'); if (!rich) return false;
    rich.focus();
    var sel = window.getSelection();
    if (sel && snap.range) { sel.removeAllRanges(); try { sel.addRange(snap.range) } catch (e3) {} }
    var html = renderMarkdown('\x60\x60\x60secret\n' + snap.text + '\n\x60\x60\x60', wikiResolve);
    document.execCommand('insertHTML', false, html);
    richDirty = true; setSyncStatus(true); scheduleRichSync(); keepSel(); updateToolbarState();
  }
  toast(t('editor.secretMarked'));
  return true;
}
function markSelectionSecret() { applySecretSel(snapshotSecretSel()) }

/* 标记入口②：编辑器右键菜单（0.4.8 笔记右键菜单基建——#ctxHost 宿主 + .ctxmenu/.mi 结构 + 点外关/Esc 关通用闸 + 视口夹紧） */
function openSecretCtxMenu(x, y, snap) {
  var host = $('ctxHost');
  host.innerHTML = '<div class="ctxmenu" id="ctxMenu"><div class="mi" data-a="secret">\uD83D\uDEE1 ' + t('editor.ctxSecret') + '</div></div>';
  var m = $('ctxMenu');
  m.style.left = Math.max(4, Math.min(x, innerWidth - m.offsetWidth - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - m.offsetHeight - 4)) + 'px';
  m.addEventListener('click', function (ev) {
    var mi = ev.target.closest('.mi'); if (!mi || mi.classList.contains('dis')) return;
    closeCtx();
    applySecretSel(snap);
  });
}

/* 机密岛交互挂接：填/重渲染后调用（fillEdBody/switchMode/unmarkSecretBlock）；静态占位岛（.dsh-secret-static，只读预览）不挂交互 */
function bindSecretBlocks(rich) {
  if (!rich) return;
  rich.querySelectorAll('pre.dsh-notes-secret').forEach(function (pre) {
    if (pre.classList.contains('dsh-secret-static')) return;
    if (!pre._secretBound) {
      pre._secretBound = true;
      pre.addEventListener('click', function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('.secret-unmark')) return;   /* 取消机密钮自己接管 */
        if (pre.classList.contains('revealed')) armSecretReveal();   /* 重击重置计时 */
        else revealSecretBlock(pre);   /* 单飞：先回糊既有揭示块，再揭示本块 */
      });
      var btn = document.createElement('button');
      btn.className = 'secret-unmark'; btn.type = 'button';
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); ev.preventDefault(); unmarkSecretBlock(pre) });
      pre.appendChild(btn);
    }
    refreshSecretBlockText(pre);
  });
}
/* 机密岛 chrome 文案（🔒 tooltip + 取消机密钮）——renderEdLang 语言切换时原地重写（零正文重建） */
function refreshSecretBlockText(pre) {
  var lock = pre.querySelector('.secret-lock'); if (lock) lock.title = t('editor.secretRevealTip');
  var btn = pre.querySelector('.secret-unmark'); if (btn) btn.textContent = t('editor.secretUnmark');
}
/* 揭示计时器单飞：模块级唯一计时器；重击重置；目标块被重建/移除时 classList 移除对离体节点无害 */
function armSecretReveal() {
  clearTimeout(secretRevealTimer);
  secretRevealTimer = setTimeout(function () {
    secretRevealTimer = null;
    var rich = $('edRich');
    if (rich) rich.querySelectorAll('pre.dsh-notes-secret.revealed').forEach(function (p2) { p2.classList.remove('revealed') });
  }, SECRET_REVEAL_MS);
}
function revealSecretBlock(pre) {
  var rich = $('edRich');
  if (rich) rich.querySelectorAll('pre.dsh-notes-secret.revealed').forEach(function (p2) { if (p2 !== pre) p2.classList.remove('revealed') });
  pre.classList.add('revealed');
  armSecretReveal();
}

/* 取消机密：剥 fence 行回明文。块定位 = 编辑器内机密岛序号 ⇄ parseSecretSpans(body) 序号（渲染器与解析器同扫描纪律，序即一致）；
   执行前先收编富文本在途编辑（dirty 保护——揭示态下别处编辑不被重建吃掉，0.4.9 同款纪律） */
function unmarkSecretBlock(pre) {
  if (!edNote) return;
  if (edMode === 'rich' && richDirty) syncFromRich('取消机密');
  var body = edNote.body || '';
  var rich = $('edRich');
  var pres = rich ? Array.prototype.slice.call(rich.querySelectorAll('pre.dsh-notes-secret')) : [];
  var idx = pres.indexOf(pre);
  var spans = parseSecretSpans(body) || [];   /* 同 refreshSecretMirror 口径：沙箱内核缺位零降级不炸 */
  if (idx < 0 || idx >= spans.length) { toast(t('editor.secretUnmarkFailed')); return }
  var sp = spans[idx];
  var inner = secretSpanInner(body, sp);
  var nb = body.slice(0, sp.start) + inner + body.slice(sp.end);
  edNote.body = nb;
  if ($('edSrc')) $('edSrc').value = nb;
  clearTimeout(secretRevealTimer); secretRevealTimer = null;
  if (rich && edMode === 'rich') { richDirty = false; rich.innerHTML = renderMarkdown(nb, wikiResolve); bindSecretBlocks(rich) }
  setSyncStatus(false);
  triggerSave(); scheduleDegAnalyze(); refreshSecretMirror();
}
/* fence 原始源 → 内容行（剥开栏行 + 有则剥闭栏行）；EOF 兜底形态无闭栏行，内容保持至文末 */
function secretSpanInner(body, sp) {
  var raw = body.slice(sp.start, sp.end);
  var nl = raw.indexOf('\n');
  var inner = nl < 0 ? '' : raw.slice(nl + 1);
  var lastNl = inner.lastIndexOf('\n');
  var lastLine = lastNl < 0 ? inner : inner.slice(lastNl + 1);
  if (/^\x60{3}/.test(lastLine)) inner = lastNl < 0 ? '' : inner.slice(0, lastNl);
  return inner;
}

/* 源码模式行背景染色镜像：与 #edSrc 同字体/行距/内边距/换行策略（.src-mirror 透明文字 + .src-secret 色带）；
   仅机密 span 存在时填充（无 span 清空——常规打字零开销）；行号口径 = body.split 换行序列；滚动/resize 跟随 */
function refreshSecretMirror() {
  var ta = $('edSrc'), mi = $('srcMirror');
  if (!ta || !mi) return;
  var body = edNote ? (edNote.body || '') : ta.value;
  var spans = parseSecretSpans(body) || [];   /* 内核函数缺位（check with(Proxy) 沙箱桩返回 undefined）时零色带降级，不炸编辑链 */
  if (!spans.length) { if (mi._secretOn) { mi._secretOn = false; mi.innerHTML = ''; mi.scrollTop = 0 } return }
  mi._secretOn = true;
  var lines = body.split('\n');
  var secretLines = {};
  spans.forEach(function (sp) {
    var sLine = 0, eLine = 0, j;
    for (j = 0; j < sp.start; j++) if (body.charCodeAt(j) === 10) sLine++;
    for (j = 0; j < sp.end; j++) if (body.charCodeAt(j) === 10) eLine++;
    for (var li = sLine; li <= eLine && li < lines.length; li++) secretLines[li] = true;
  });
  mi.innerHTML = lines.map(function (ln2, i) {
    return '<div' + (secretLines[i] ? ' class="src-secret"' : '') + '>' + (ln2 ? esc(ln2) : '') + '</div>';
  }).join('');
  /* 滚动条补偿：edSrc 出现竖向滚动条时内容宽收窄——镜像右缘同步让行（换行点）对齐 */
  var sb = ta.offsetWidth - ta.clientWidth;
  mi.style.right = sb > 0 ? sb + 'px' : '';
  mi.scrollTop = ta.scrollTop;
}
