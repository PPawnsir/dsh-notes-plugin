/* ===== 二期 ✨整理：当前草稿经 notes-ai-organize（notes-quick-instruct 同款 LLM 通道）按 kind 模板结构化重写 =====
   契约：host 只返回重写正文不落盘；页面替换正文后走既有 triggerSave 自动保存；原正文进一次撤销栈（toast「撤销」恢复）。
   容错：正文为空/加载中/整理中不重入；error 或空返回一律不动原文。
   i18n 覆盖卡F：文案复用 B 卡 editor.bodyLoading/bodyEmpty/organizeFailed/organizeEmpty/organized/noOrganizeUndo/organizeUndone
   + meta.undo 字典（禁重复建别名）；kind 名经 kindLabel() 条件映射（KIND 字面量仅作锚）
   0.4.4-F（notes-044-organize-instruct）：点「整理」先弹引导卡（可选追加指令 textarea + 确认/取消）——
   留空确认 = instruction:''（host 空指令路径 prompt 与二期现行逐字节等价）；填写 = 追加进 prompt 再整理；取消/点遮罩 = 零副作用。
   doAiOrganize(instruction) 复用全部守卫/撤销栈/容错，仅 RPC payload 多带一个 instruction 字段
   0.4.7-B⑥（notes-047-ux，实测反馈 n-muy9gdybdd40「输入指令后没反应」）：整理中态强化——
   meta 钮 spinner/禁用（既有 busy）+ 正文区遮罩 #orgVeil（「AI 整理中，约需半分钟…」）双通道反馈；
   ⑥a：失败提示驻留化——organizeFailed 从一闪而过的 toast 改为编辑区驻留条 #orgErr（手动 ✕ / 换笔记 / 下次发起才消失）；
   容错与撤销栈语义零改动 */
function doAiOrganize(instruction) {
  if (!edNote || organizing) return;
  if (edLoading) { toast(t('editor.bodyLoading')); return }
  if (edMode === 'rich' && richDirty) syncFromRich('整理前同步');   /* 富文本在途编辑先落回源码 */
  var body = edNote.body || '';
  if (!body.trim()) { toast(t('editor.bodyEmpty')); return }
  var instr = typeof instruction === 'string' ? instruction.trim() : '';   /* 0.4.4-F：追加指令 trim（空 = 系统默认规则） */
  organizing = true; organizeErr = ''; renderMeta(); refreshOrganizeUI();
  rpc('notes-ai-organize', { body: body, kind: edNote.kind || 'note', title: edNote.title === 'Untitled' ? '' : (edNote.title || ''), instruction: instr }).then(function (res) {
    organizing = false; renderMeta(); refreshOrganizeUI();
    if (res && res.error) { organizeErr = t('editor.organizeFailed', { msg: res.error }); refreshOrganizeUI(); return }   /* ⑥a：驻留条（不再一闪而过） */
    if (!res || !res.body || !res.body.trim()) { toast(t('editor.organizeEmpty')); return }
    organizeUndo = body;   /* 一次撤销栈：只保留最近一次整理前的正文 */
    applyOrganizedBody(res.body);
    toast(t('editor.organized', { kind: kindLabel(edNote.kind) || t('meta.kindNote') }), { label: t('meta.undo'), fn: undoAiOrganize });
  }).catch(function (e) { organizing = false; organizeErr = t('editor.organizeFailed', { msg: e && e.message || e }); renderMeta(); refreshOrganizeUI() });
}
/* 0.4.7-B⑥：整理中遮罩 + 失败驻留条显隐收敛点（renderEd 重建 DOM 后须重挂——同 refreshLoadErrUI 先例；✕ 手动关闭驻留条） */
function refreshOrganizeUI() {
  var veil = $('orgVeil'); if (veil) veil.style.display = organizing ? 'flex' : 'none';
  var bn = $('orgErr');
  if (bn) {
    bn.style.display = organizeErr ? 'flex' : 'none';
    var msg = $('orgErrMsg'); if (msg) msg.textContent = organizeErr || '';
    var x = $('orgErrX');
    if (x && !x._bound) { x._bound = true; x.addEventListener('click', function () { organizeErr = ''; refreshOrganizeUI() }) }
  }
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
/* 0.4.4-F 整理引导弹卡（notes-044-organize-instruct）：点「整理」先弹可选追加指令输入——
   确认 = 带 instruction 调 doAiOrganize（守卫/撤销栈/容错全复用，留空 = 系统默认整理规则）；
   取消/点遮罩/Esc（键盘面统一 closeModalFlushed）= 关弹卡零副作用。organizing 态守卫保留（整理中按钮 busy 不重入，弹卡亦不另开）
   0.4.7-B⑥b/⑦（notes-047-ux）：超限前置校验——开卡即按生效上限判定正文长度（本地长度零等待）；
   生效值 = settings-get 响应 organizeMaxChars（⑦.4 增带，用户覆盖 || 模型表 || 12000；会话级缓存，首开后台对齐 host）；
   超限 → textarea 上方提示「本篇 N 字超上限 X，建议分段整理」+ 确认钮禁用（不再把超限请求发到 host 才报错） */
var orgMaxCache = 0;   /* 整理长度上限生效值会话级缓存（0 = 未拉取，暂用 12000 回落） */
function orgMaxCacheReset() { orgMaxCache = 0 }   /* 设置卡保存整理长度上限后失效（settings.js saveSettings 成功路径调用； concat 全局互通） */
function orgLimitRefresh(bodyLen) {
  var max = orgMaxCache || 12000;
  var over = bodyLen > max;
  var hint = $('oiLimit');
  if (hint) { hint.style.display = over ? '' : 'none'; if (over) hint.textContent = t('editor.organizeTooLong', { n: bodyLen, max: max }) + '。' + t('editor.organizeTooLongTip') }
  var ok = $('oiOk'); if (ok) ok.disabled = over;
}
function openOrganizeInstruct() {
  if (!edNote || organizing) return;
  var bodyLen = (edNote.body || '').length;
  openModal(
    '<div class="modal-t">' + icon('i-sparkle') + ' ' + t('editor.organizeInstructTitle') + '</div>'
    + '<div class="modal-hint" id="oiLimit" style="display:none"></div>'
    + '<textarea class="minput" id="oiInstr" rows="3" placeholder="' + t('editor.organizeInstructPlaceholder') + '"></textarea>'
    + '<div class="modal-acts"><button class="mbtn" id="oiCancel">' + t('editor.organizeInstructCancel') + '</button><button class="mbtn primary" id="oiOk">' + t('editor.organizeInstructConfirm') + '</button></div>'
  );
  $('oiCancel').onclick = closeModal;
  $('oiOk').onclick = function () { if ($('oiOk').disabled) return; var v = $('oiInstr').value; closeModal(); doAiOrganize(v) };
  orgLimitRefresh(bodyLen);
  if (!orgMaxCache) rpc('notes-settings-get', {}).then(function (res) {
    orgMaxCache = (res && typeof res.organizeMaxChars === 'number' && res.organizeMaxChars > 0) ? res.organizeMaxChars : 12000;
    if ($('oiLimit')) orgLimitRefresh(bodyLen);   /* 弹卡还开着才复判（关窗静默） */
  }).catch(function () { orgMaxCache = 12000 });   /* 通道异常回落 12000 现状值（不阻塞开卡） */
  $('oiInstr').focus();
}
