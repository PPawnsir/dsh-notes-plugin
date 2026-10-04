/* ================= 派发（notes-active-sessions + notes-dispatch；页面无 workspaces 服务，仅已有会话） ================= */
var dState = null;
function openDispatch() {
  if (!edNote || !selId) { toast('先选择一条笔记'); return }
  dState = { sessId: '', instr: '', pending: false, sessions: [], pendingSess: [] };
  pullActiveSessions();
  renderDispatchModal();
}
function pullActiveSessions() {
  rpc('notes-active-sessions', {}).then(function (res) {
    if (!res || !dState) return;
    if (res.sessions) dState.sessions = res.sessions;
    dState.pendingSess = res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [];
    if ($('dispSessHost')) renderDispatchSessList();
    if (res.titlesPending && dState) setTimeout(function () { if (dState && $('dispSessHost')) pullActiveSessions() }, 1500);
  }).catch(function () {})
}
function renderDispatchModal() {
  var n = edNote;
  openModal(
    '<div class="modal-t">' + icon('i-play', 13) + ' 派发待办<span class="sub">注入上下文并触发目标会话处理 · 新建会话派发请回 DSH 面板</span></div>'
    + '<div class="disp-todo"><div class="disp-todo-t">' + esc(n.title || 'Untitled') + '</div><div class="disp-todo-b">' + esc(String(n.preview || n.body || '').trim().slice(0, 200) || '（无正文）') + '</div></div>'
    + '<textarea class="minput" id="dInstr" rows="3" placeholder="补充具体要求 / 指令（可选）…"></textarea>'
    + '<div id="dispSessHost"></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="dCancel">取消</button><button class="mbtn primary" id="dOk">派发</button></div>'
  );
  $('dInstr').oninput = function () { dState.instr = this.value };
  $('dCancel').onclick = closeModal;
  $('dOk').onclick = doDispatchConfirm;
  renderDispatchSessList();
}
function renderDispatchSessList() {
  var host = $('dispSessHost'); if (!host || !dState) return;
  var byWs = {};
  dState.sessions.forEach(function (s) { var w = s.workspace || '其他'; (byWs[w] = byWs[w] || []).push(s) });
  dState.pendingSess.forEach(function (p) { var w = p.workspace || '其他'; (byWs[w] = byWs[w] || []).push({ id: p.id, short: p.short, name: '', pending: true }) });
  var wsKeys = Object.keys(byWs).sort();
  var h = '<div class="disp-ws">活跃会话 ' + dState.sessions.length + (dState.pendingSess.length ? '（+' + dState.pendingSess.length + ' 标题加载中…）' : '') + ' · 按工作区分组</div>';
  if (!wsKeys.length) h += '<div class="modal-hint">没有可派发的活跃会话。目标会话需处于打开状态；请先在 DSH 主界面打开，或回 DSH 浮动面板使用「新建会话」派发。</div>';
  wsKeys.forEach(function (ws) {
    h += '<div class="disp-ws">' + esc(ws) + '</div>';
    byWs[ws].forEach(function (s) {
      h += '<div class="disp-sess' + (s.pending ? ' dis' : '') + (dState.sessId === s.id ? ' on' : '') + '" data-sid="' + (s.pending ? '' : esc(s.id)) + '">'
        + (s.live ? '<span class="live" title="live"></span>' : '<span class="live" style="background:var(--nt3)" title="非 live"></span>')
        + '<span class="nm">' + (s.pending ? esc(s.short) + ' · 标题加载中…' : esc(s.name || s.short)) + '</span>'
        + '<span style="font-size:10px;color:var(--nt3)">' + esc(s.short || '') + '</span></div>';
    });
  });
  host.innerHTML = h;
  host.querySelectorAll('.disp-sess[data-sid]').forEach(function (el) {
    if (!el.dataset.sid) return;
    el.onclick = function () { dState.sessId = el.dataset.sid; renderDispatchSessList() };
  });
}
function doDispatchConfirm() {
  if (!dState || dState.pending) return;
  if (!dState.sessId) { modalErr('请选择目标会话'); return }
  var sess = dState.sessions.find(function (s) { return s.id === dState.sessId });
  dState.pending = true; $('dOk').disabled = true; $('dOk').textContent = '派发中…';
  rpc('notes-dispatch', { id: selId, sessionId: dState.sessId, sessionName: sess ? sess.name : '', workspace: sess ? sess.workspace : '', mode: 'existing', instruction: dState.instr }).then(function (res) {
    dState.pending = false;
    if (res && res.error) {
      modalErr(res.error + (res.needOpen ? '\n（页面无打开会话能力，请回 DSH 主界面打开该会话后重试）' : ''));
      $('dOk').disabled = false; $('dOk').textContent = '派发';
      return;
    }
    closeModal(); dState = null;
    toast('已派发待办到「' + (sess ? sess.name : '') + '」（开始处理）');
    refreshSelected(); loadNotes(true);
  }).catch(function (e) {
    dState.pending = false; modalErr('派发失败：' + (e && e.message || e));
    $('dOk').disabled = false; $('dOk').textContent = '派发';
  });
}

