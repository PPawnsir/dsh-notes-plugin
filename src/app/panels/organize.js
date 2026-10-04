/* ===== 二期 ✨整理：当前草稿经 notes-ai-organize（notes-quick-instruct 同款 LLM 通道）按 kind 模板结构化重写 =====
   契约：host 只返回重写正文不落盘；页面替换正文后走既有 triggerSave 自动保存；原正文进一次撤销栈（toast「撤销」恢复）。
   容错：正文为空/加载中/整理中不重入；error 或空返回一律不动原文。
   i18n 覆盖卡F：文案复用 B 卡 editor.bodyLoading/bodyEmpty/organizeFailed/organizeEmpty/organized/noOrganizeUndo/organizeUndone
   + meta.undo 字典（禁重复建别名）；kind 名经 kindLabel() 条件映射（KIND 字面量仅作锚） */
function doAiOrganize() {
  if (!edNote || organizing) return;
  if (edLoading) { toast(t('editor.bodyLoading')); return }
  if (edMode === 'rich' && richDirty) syncFromRich('整理前同步');   /* 富文本在途编辑先落回源码 */
  var body = edNote.body || '';
  if (!body.trim()) { toast(t('editor.bodyEmpty')); return }
  organizing = true; renderMeta();
  rpc('notes-ai-organize', { body: body, kind: edNote.kind || 'note', title: edNote.title === 'Untitled' ? '' : (edNote.title || '') }).then(function (res) {
    organizing = false; renderMeta();
    if (res && res.error) { toast(t('editor.organizeFailed', { msg: res.error })); return }
    if (!res || !res.body || !res.body.trim()) { toast(t('editor.organizeEmpty')); return }
    organizeUndo = body;   /* 一次撤销栈：只保留最近一次整理前的正文 */
    applyOrganizedBody(res.body);
    toast(t('editor.organized', { kind: kindLabel(edNote.kind) || t('meta.kindNote') }), { label: t('meta.undo'), fn: undoAiOrganize });
  }).catch(function (e) { organizing = false; renderMeta(); toast(t('editor.organizeFailed', { msg: e && e.message || e })) });
}
/* 重写正文落进编辑器双模式：源码 textarea.value；富文本重渲染内核产物（白名单外语法则回落源码模式） */
function applyOrganizedBody(text) {
  if (!edNote) return;
  edNote.body = text;
  degraded = analyzeMarkdown(text);
  if (edMode === 'rich' && !degraded.ok) { edMode = 'source'; renderEd(); }   /* 如 todo 模板含任务列表语法 → 自动落源码模式 */
  else { fillEdBody(); refreshDegradeUI(); }
  triggerSave();   /* 走既有 900ms 防抖自动保存（notes-update） */
}
/* 撤销最近一次整理（一次撤销栈，用后即清） */
function undoAiOrganize() {
  if (organizeUndo == null) { toast(t('editor.noOrganizeUndo')); return }
  var b = organizeUndo; organizeUndo = null;
  applyOrganizedBody(b);
  toast(t('editor.organizeUndone'));
}
