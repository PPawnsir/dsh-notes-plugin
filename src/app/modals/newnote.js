/* ================= 新建笔记（本地草稿态，notes-034-batch3） =================
   点 + / Alt+N：先开本地草稿进编辑器（不落库、列表不出行）；首次有效编辑（标题/正文非空）才 notes-create 落库；
   放弃（点别的笔记且零内容）不产生空 Untitled（证据 n-mut4n5zuuxaw：昔日点 + 立即落库，巡检现场残留 3 条空 Untitled）。
   切走时未落库的有内容草稿由 selectNote 兜底 flushDraftCreate（fire-and-forget，不阻塞切换）。 */
function doNewNote() {
  /* 草稿期重复点击 = 聚焦标题继续写（不重建草稿、不丢在途输入） */
  if (draftNote) { var t0 = $('edTitle'); if (t0) t0.focus(); return }
  /* 从在编辑笔记切到草稿前，先把富文本在途编辑序列化落回并保存（与 selectNote 同款：防 900ms debounce 打到草稿上） */
  if (edMode === 'rich' && richDirty && edNote) { syncFromRich('新建切换'); doSave(); }
  var seedFolder = view.type === 'folder' ? view.id : '';
  var seedTopic = view.type === 'topic' ? view.id : '';
  var kind0 = filters.kinds.length === 1 ? filters.kinds[0] : 'note';
  /* 二期 kind 模板骨架：筛选中心类型组恰选 1 个时按该 kind 预填（note=空自由格式）——预填不算「有效编辑」，零输入放弃仍不落库 */
  draftNote = {
    id: '', title: '', body: KIND_TEMPLATES[kind0] || '', kind: kind0, status: 'active',
    tags: [], topic: seedTopic, folder: seedFolder, inject: false, injectTo: [], recall: true,
    sensitive: false, injectRole: 'convention', dispatches: [], useCount: 0,
    createdAt: '', updatedAt: '', sessionId: '', _tagsStr: null
  };
  draftCreating = false;
  selId = null; edNote = draftNote; scopeOpen = false; focusId = null;
  edBodyLoaded = true; edBodyErr = '';   /* 草稿正文本地全量持有、无 get 链路——天然满足 R-1 提交闸语义 */
  edLoading = false; histCount = 0;      /* 草稿无历史版本（「历史」入口隐藏；落库后再次保存由 doSave 既有钩子补探） */
  degraded = analyzeMarkdown(draftNote.body || '');
  renderTree(); renderEd();
  toast(t('newnote.draftToast'));
  var ti = $('edTitle'); if (ti) ti.focus();
}
/* 草稿落库 payload（doDraftCreate/flushDraftCreate 共用）：有效内容闸（标题/正文非空；'Untitled' 占位视为空标题）——全空返回 null 不落库；
   字段集与 doSave 的 upd 同口径（标签解析 / topic trim / injectRole 仅 inject 时携带） */
function draftPayloadOf(d) {
  var title = (d.title || '').trim(); if (title === 'Untitled') title = '';
  if (!title && !(d.body || '').trim()) return null;
  var tags = (d._tagsStr != null ? d._tagsStr : (d.tags || []).filter(function (t) { return t !== 'quick' }).join(', '))
    .split(/[,，;；]/).map(function (s) { return s.trim() }).filter(Boolean);
  var p = {
    title: title, body: d.body || '', tags: tags,
    kind: d.kind || 'note', status: d.status || 'active', inject: d.inject === true,
    injectTo: d.injectTo || [], recall: d.recall !== false, sensitive: d.sensitive === true
  };
  if (p.inject) p.injectRole = d.injectRole === 'reference' ? 'reference' : 'convention';
  if ((d.topic || '').trim()) p.topic = d.topic.trim();
  if (d.folder) p.folder = d.folder;
  return p;
}
/* 草稿 create 链路（在位落库与切走兜底共用）：成功后在位草稿接管为正常编辑态（真实 id 回填，后续保存走 notes-update）；
   已切走（edNote !== d）则仅 toast + 静默刷新列表，不干扰当前编辑 */
function createDraftNote(d, payload) {
  return rpc('notes-create', payload).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    if (res && res.id) {
      wikiBodies[res.id] = { body: payload.body, updatedAt: '' };   /* 双链索引即时新鲜（updatedAt 空 → 下轮复核 reconcile） */
      if (edNote === d) {
        selId = res.id; edNote.id = res.id;
        renderCrumb(); renderMeta();
        $('edSaved').textContent = t('editor.autoSaved', { time: new Date().toTimeString().slice(0, 5) });
        toast(t('newnote.createdToast'));
      } else {
        toast(t('newnote.flushedToast', { title: res.title || payload.title || 'Untitled' }));
      }
      loadNotes(true);
    }
  }).catch(function (e) { toast(t('newnote.failed', { msg: e && e.message || e })) });
}
/* 草稿首次落库（doSave 草稿分支）：在途闸防并发双建（在途期间只重排防抖，落库成功后后续编辑走正常 update 补差） */
function doDraftCreate() {
  if (!draftNote) return;
  if (draftCreating) { triggerSave(); return }
  var payload = draftPayloadOf(draftNote);
  if (!payload) return;   /* 空草稿不落库（放弃零残留） */
  var d = draftNote;
  draftCreating = true;
  createDraftNote(d, payload).then(function () { draftCreating = false; if (draftNote === d) draftNote = null });
}
/* 切走兜底落库（selectNote 专用）：草稿对象快照式落库，与当前编辑态解耦；空草稿直接弃（零 Untitled 残留） */
function flushDraftCreate(d) {
  var payload = d && draftPayloadOf(d);
  if (payload) createDraftNote(d, payload);
}
$('btnNew').addEventListener('click', doNewNote);
