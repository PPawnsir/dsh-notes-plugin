/* ================= 注入预览（设置卡片「注入预览」入口）：notes-inject-preview 纯复用 host 注入渲染 =================
   双 tab（约定/目录）+ 三档视角下拉（全局 / 工作区并集 / 单会话；notes-sessions 数据源）+ 底部统计条（总字符/打码/时效标注/预算截断）；
   文本区只读等宽展示（textContent 赋值，无注入面）。
   视角值编码：'' = 全局；'ws:<工作区标题>' = 工作区并集视角（RPC workspace 参数）；其余 = 会话短 id（sessionId 参数）。 */
var injectPreviewState = { tab: 'conv', sid: '', data: null };
function openInjectPreview() {
  injectPreviewState = { tab: 'conv', sid: '', data: null };
  openModal(
    '<div class="modal-t">' + icon('i-eye', 13) + ' 注入预览<span class="sub">Agent 实际收到的注入文本 · 只读</span></div>'
    + '<div class="injprev-bar"><div class="injprev-tabs">'
    + '<button class="injprev-tab on" id="injprevTabConv">约定</button><button class="injprev-tab" id="injprevTabCat">目录</button></div>'
    + '<select class="minput injprev-sess" id="injprevSess" title="预览视角三档：全局 = 所有会话共享（injectTo=[]）；工作区 = 该工作区全部会话的注入并集；会话 = 单会话 injectTo 命中口径"><option value="">全局</option></select></div>'
    + '<pre class="injprev-text" id="injprevText">加载中…</pre>'
    + '<div class="injprev-stats" id="injprevStats"></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="injprevClose">关闭</button></div>'
  );
  $('modal').classList.add('injprev');
  $('injprevClose').onclick = closeModal;
  $('injprevTabConv').onclick = function () { injectPreviewState.tab = 'conv'; renderInjectPreview() };
  $('injprevTabCat').onclick = function () { injectPreviewState.tab = 'cat'; renderInjectPreview() };
  $('injprevSess').onchange = function () { injectPreviewState.sid = this.value; injectPreviewState.data = null; renderInjectPreview(); loadInjectPreview() };
  /* 视角下拉数据源：notes-sessions（与注入范围浮层同源）；三档 = 全局 / 工作区 optgroup（值 ws:<标题>）/ 会话 optgroup（短 id） */
  rpc('notes-sessions', {}).then(function (res) {
    var sel = $('injprevSess'); if (!sel) return;
    var ss = ((res && res.sessions) || []).concat((res && res.pendingSessions) || []);
    var ws = [];
    ss.forEach(function (s) { if (s && s.workspace && ws.indexOf(s.workspace) < 0) ws.push(s.workspace) });
    sel.innerHTML = '<option value="">全局</option>'
      + (ws.length ? '<optgroup label="工作区">' + ws.map(function (w) { return '<option value="ws:' + esc(w) + '">' + esc(w) + '</option>' }).join('') + '</optgroup>' : '')
      + '<optgroup label="会话">' + ss.map(function (s) { return '<option value="' + esc(s.short || '') + '">' + esc((s.short || '') + (s.name ? ' · ' + s.name : '')) + '</option>' }).join('') + '</optgroup>';
    sel.value = injectPreviewState.sid;
  }).catch(function () {});
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
  var tc = $('injprevTabConv'), tk = $('injprevTabCat');
  if (tc) tc.className = 'injprev-tab' + (st.tab === 'conv' ? ' on' : '');
  if (tk) tk.className = 'injprev-tab' + (st.tab === 'cat' ? ' on' : '');
  var tx = $('injprevText');
  if (tx) {
    var body = d ? (st.tab === 'cat' ? (d.catalog || '') : (d.conventions || '')) : '加载中…';
    tx.textContent = body || (st.tab === 'cat' ? '（无目录内容）' : '（无约定内容）');
  }
  var s = d && d.stats, se = $('injprevStats');
  if (se) se.textContent = s ? '总字符 ' + s.totalChars + '（约定 ' + s.conventionsChars + ' / 目录 ' + s.catalogChars + '）· 打码 ' + s.maskedNotes + ' 条 · 时效标注 ' + s.staleMarked + ' 条 · 预算截断 ' + (s.budgetTruncated ? '是' : '否') : '';
}
