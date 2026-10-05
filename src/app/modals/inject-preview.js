/* ================= 注入预览（设置卡片「注入预览」入口）：notes-inject-preview 纯复用 host 注入渲染 =================
   单段视图（约定段 pre + 目录段可点行）+ 三档视角下拉（全局 / 工作区并集 / 单会话；notes-sessions 数据源）+ 底部统计条（总字符/打码/时效标注/预算截断）；
   文本区只读（textContent 赋值，无注入面）。
   视角值编码：'' = 全局；'ws:<工作区标题>' = 工作区并集视角（RPC workspace 参数）；其余 = 会话短 id（sessionId 参数）。
   0.4.3 验收修复③（notes-043-dir-merge）：目录与资料桶合并为单一目录段——挂载行（- [[id]]，增强态）与普通行（- [id]）同段渲染、
   点击均可开挂载弹层（modal 不叠 modal——先关预览再开）：已挂载 = 编辑模式（notes-mount-list 预填现有文案）；未挂载 = LLM 草稿模式。 */
var injectPreviewState = { sid: '', data: null };
function openInjectPreview() {
  injectPreviewState = { sid: '', data: null };
  openModal(
    '<div class="modal-t">' + icon('i-eye', 13) + ' 注入预览<span class="sub">Agent 实际收到的注入文本 · 只读</span></div>'
    + '<div class="injprev-bar">'
    + '<select class="minput injprev-sess" id="injprevSess" title="预览视角三档：全局 = 所有会话共享（injectTo=[]）；工作区 = 该工作区全部会话的注入并集；会话 = 单会话 injectTo 命中口径"><option value="">全局</option></select></div>'
    + '<div class="injprev-text" id="injprevText">加载中…</div>'
    + '<div class="injprev-stats" id="injprevStats"></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="injprevClose">关闭</button></div>'
  );
  $('modal').classList.add('injprev');
  $('injprevClose').onclick = closeModal;
  $('injprevSess').onchange = function () { injectPreviewState.sid = this.value; injectPreviewState.data = null; renderInjectPreview(); loadInjectPreview() };
  /* 视角下拉数据源：notes-sessions（与注入范围浮层同源）；三档 = 全局 / 工作区 optgroup（值 ws:<标题>）/ 会话 optgroup（短 id） */
  rpc('notes-sessions', {}).then(function (res) {
    if (res && res.error) throw new Error(res.error);   /* 显式抛错进 catch（读路径静默群修复） */
    var sel = $('injprevSess'); if (!sel) return;
    var ss = ((res && res.sessions) || []).concat((res && res.pendingSessions) || []);
    var ws = [];
    ss.forEach(function (s) { if (s && s.workspace && ws.indexOf(s.workspace) < 0) ws.push(s.workspace) });
    sel.innerHTML = '<option value="">全局</option>'
      + (ws.length ? '<optgroup label="工作区">' + ws.map(function (w) { return '<option value="ws:' + esc(w) + '">' + esc(w) + '</option>' }).join('') + '</optgroup>' : '')
      + '<optgroup label="会话">' + ss.map(function (s) { return '<option value="' + esc(s.short || '') + '">' + esc((s.short || '') + (s.name ? ' · ' + s.name : '')) + '</option>' }).join('') + '</optgroup>';
    sel.value = injectPreviewState.sid;
  }).catch(function (e) { modalErr('会话清单加载失败：' + (e && e.message || e)) });   /* 弹窗内反馈（modalErr 自带 mErr 缺位守卫）；下拉保持「全局」档可用 */
  loadInjectPreview();
}
function loadInjectPreview() {
  var v = injectPreviewState.sid;
  rpc('notes-inject-preview', v ? (v.indexOf('ws:') === 0 ? { workspace: v.slice(3) } : { sessionId: v }) : {}).then(function (res) {
    if (res && res.error) { modalErr(res.error); return }
    injectPreviewState.data = res || null;
    renderInjectPreview();
  }).catch(function (e) { modalErr('预览加载失败：' + (e && e.message || e)) });
}
function renderInjectPreview() {
  var st = injectPreviewState, d = st.data;
  var tx = $('injprevText');
  if (tx) {
    tx.textContent = '';
    if (!d) { tx.textContent = '加载中…' }
    else {
      if (d.conventions) { var pre = document.createElement('pre'); pre.className = 'injprev-conv'; pre.textContent = d.conventions; tx.appendChild(pre) }
      renderInjPrevDirectory(tx, d.directory || '');   /* 目录段：挂载行与普通行同段可点（补充/编辑 whenToUse） */
    }
  }
  var s = d && d.stats, se = $('injprevStats');
  if (se) se.textContent = s ? '总字符 ' + s.totalChars + '（约定 ' + s.conventionsChars + ' / 目录 ' + s.directoryChars + '）· 打码 ' + s.maskedNotes + ' 条 · 时效标注 ' + s.staleMarked + ' 条 · 预算截断 ' + (s.budgetTruncated ? '是' : '否') + ' · 目录补充行：' + (s.catalogEnabled === true ? '开' : '关') : '';   /* 0.4.3⑫ 目录补充行开关徽标（stats.catalogEnabled，notes-043-final-polish） */
}
/* 目录段文本逐行渲染：挂载行 `- [[n-xxx]]` 与普通行 `- [n-xxx]` 均可点（🔒 行 id 在方括号内不受打码影响），
   其余行（标题/轻推/计数提示/挂载引导）纯文本；行内容一律 textContent 赋值（无注入面） */
function renderInjPrevDirectory(tx, text) {
  if (!String(text || '').replace(/\s+/g, '')) {
    var em = document.createElement('div');
    em.className = 'injprev-ln'; em.textContent = '（无目录内容）'; tx.appendChild(em); return;
  }
  String(text).split('\n').forEach(function (ln) {
    var div = document.createElement('div');
    var m = ln.match(/^- \[\[?(n-[A-Za-z0-9]+)\]\]?/);
    div.className = 'injprev-ln' + (m ? ' hit' : '');
    if (m) { div.title = t('inj.mountAdd'); div.onclick = function () { openMountFromPreview(m[1]) } }
    div.textContent = ln || ' ';
    tx.appendChild(div);
  });
}
/* 目录行点击 → 挂载弹层：已挂载 = 编辑模式（notes-mount-list 预填现有文案）；未挂载 = LLM 草稿模式（预填由弹层自理） */
function openMountFromPreview(id) {
  if (!id) return;
  injectPreviewState = { sid: '', data: null };
  closeModal();   /* modal 不叠 modal：先关预览再开挂载弹层（注入管理→挂载弹层同款） */
  Promise.all([rpc('notes-get', { id: id }), rpc('notes-mount-list', {})]).then(function (rs) {
    var g = rs[0], ml = rs[1];
    if (!g || g.error || !g.note) { toast(t('inj.mountFailed', { msg: (g && g.error) || 'not found' })); return }
    var line = ((ml && ml.lines) || []).filter(function (l) { return l.id === id })[0];
    openMountModal({ id: id, title: g.note.title || id, existing: line ? line.when : undefined });
  }).catch(function (e) { toast(t('inj.mountFailed', { msg: e && e.message || e })) });
}
