/* ================= 派发（notes-active-sessions + notes-dispatch；页面无 workspaces 服务，仅已有会话） ================= */
/* 定时派发·设置交互（notes-034-sched-ui）：派发弹窗扩展「调度」区——默认收起 = 立即派发（手动派发路径零改动）；
   「定时执行」展开频率设置（每天/每周/每 N 天/仅一次+时间），确认排定 = 创建 contractType=dispatch-schedule 约定笔记
   （标题自动「定时 」前缀，front-matter 写 schedule 声明，正文 = 原待办正文 + 补充指令——即被派发的工作内容本身）+ toast「已排定，下次：X」；
   编辑模式（注入管理「调度任务」区 [编辑] 进入）= 同弹窗回填既有声明，保存走 notes-update（机器状态字段由 host 写入闸门延续）。
   锚定时刻（notes-034-sched-time）：周期三模式各补时刻选择（time input，默认 09:00）——声明携 anchor:'HH:MM'
   （触发序列钉死本地时刻，不随创建时间漂移）；「每周」另加星期几选择（dow 0-6）；仅一次保持 datetime-local 不变。
   校验内联报错（at 未来 / N≥1 / 目标必选；host 红线回显同口径）——禁原生 prompt（R1 反面教材 n-mut46q00c3yw） */
var dState = null;
function openDispatch() {
  if (draftNote) { toast(t('disp.draftNotSaved')); return }   /* 草稿无真实 id（notes-034-batch3） */
  if (!edNote || !selId) { toast(t('editor.selectNoteFirst')); return }
  dState = { sessId: '', instr: '', pending: false, sessions: [], pendingSess: [], sched: false, schedMode: 'daily', schedN: 3, schedAt: '', editId: '', editNote: null, schedAnchor: '09:00', schedDow: 1 };
  pullActiveSessions();
  renderDispatchModal();
}
/* 编辑模式入口（注入管理「调度任务」区 [编辑]）：同弹窗回填既有声明；note = 调度约定笔记 slim（列表已含 schedule，零新 RPC） */
function openDispatchEdit(note) {
  if (!note || !note.schedule) { toast(t('disp.noSchedule')); return }
  var s = note.schedule;
  dState = { sessId: s.target || '', instr: '', pending: false, sessions: [], pendingSess: [], sched: true, schedMode: 'daily', schedN: 3, schedAt: '', editId: note.id, editNote: note, schedAnchor: '09:00', schedDow: 1 };
  /* 回填：at → 仅一次；every 整天数 → 每天/每周/每 N 天；非整天间隔（front-matter 裸编辑旁路值）归一最近整天，保存按表单覆盖；
     锚定时刻（notes-034-sched-time）：anchor/dow 回填（非法 anchor 回退默认 09:00——裸编辑旁路值防御） */
  if (s.at) { dState.schedMode = 'once'; dState.schedAt = isoToLocalInput(s.at) }
  else {
    if (schedAnchorMs(s.anchor) !== null) dState.schedAnchor = s.anchor;
    if (typeof s.dow === 'number' && s.dow >= 0 && s.dow <= 6) dState.schedDow = s.dow;
    var ms = schedEveryMs(s.every), d = ms && ms % 86400000 === 0 ? ms / 86400000 : 0;
    if (d === 1) dState.schedMode = 'daily';
    else if (d === 7) dState.schedMode = 'weekly';
    else { dState.schedMode = 'ndays'; dState.schedN = d >= 1 ? d : Math.max(1, Math.round((ms || 259200000) / 86400000)) }
  }
  pullActiveSessions();
  renderDispatchModal();
}
function pullActiveSessions() {
  rpc('notes-active-sessions', {}).then(function (res) {
    if (!res || !dState) return;
    if (res.error) throw new Error(res.error);   /* 显式抛错进 catch（读路径静默群修复） */
    if (res.sessions) dState.sessions = res.sessions;
    /* 编辑模式：目标会话不在活跃清单时补一条合成条目（原目标保持可选；host 落库仍校验存活红线，非 live 只影响执行时刻） */
    if (dState.editId && dState.sessId && !dState.sessions.some(function (s) { return s.id === dState.sessId })) {
      dState.sessions = dState.sessions.concat([{ id: dState.sessId, short: shortSid(dState.sessId), name: t('disp.orphanSessName'), workspace: t('disp.orphanSessWs'), live: false }]);
    }
    dState.pendingSess = res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [];
    if ($('dispSessHost')) renderDispatchSessList();
    if (res.titlesPending && dState) setTimeout(function () { if (dState && $('dispSessHost')) pullActiveSessions() }, 1500);
  }).catch(function (e) { modalErr(t('mem.sessLoadFailed', { msg: e && e.message || e })) })   /* 弹窗内反馈（modalErr 自带 mErr 缺位守卫，关窗后静默） */
}
function renderDispatchModal() {
  var n = dState.editNote || edNote;
  var editing = !!dState.editId;
  openModal(
    '<div class="modal-t">' + icon(editing ? 'i-clock' : 'i-play', 13) + ' ' + (editing ? t('disp.editTitle') : t('disp.title')) + '<span class="sub">' + (editing ? t('disp.editSub') : t('disp.sub')) + '</span></div>'
    + '<div class="disp-todo"><div class="disp-todo-t">' + esc(n.title || 'Untitled') + '</div><div class="disp-todo-b">' + esc(String(n.preview || n.body || '').trim().slice(0, 200) || t('disp.noBody')) + '</div></div>'
    + (editing ? '' : '<textarea class="minput" id="dInstr" rows="3" placeholder="' + t('disp.instrPlaceholder') + '"></textarea>')
    /* 调度区（默认收起 = 立即派发，手动派发零干扰；编辑模式固定定时形态，不再给「立即派发」岔路） */
    + '<div class="sched-box" id="dSchedBox">'
    + (editing ? '' : '<label class="sched-opt"><input type="radio" name="dTrig" id="dTrigNow"' + (dState.sched ? '' : ' checked') + '> ' + t('disp.now') + '</label><label class="sched-opt"><input type="radio" name="dTrig" id="dTrigSched"' + (dState.sched ? ' checked' : '') + '> ' + t('disp.scheduled') + '</label>')
    + '<div class="sched-form" id="dSchedForm"' + (dState.sched ? '' : ' style="display:none"') + '>'
    + '<select class="minput sched-sel" id="dSchedMode">'
    + '<option value="daily"' + (dState.schedMode === 'daily' ? ' selected' : '') + '>' + t('common.schedDaily') + '</option>'
    + '<option value="weekly"' + (dState.schedMode === 'weekly' ? ' selected' : '') + '>' + t('common.schedWeekly') + '</option>'
    + '<option value="ndays"' + (dState.schedMode === 'ndays' ? ' selected' : '') + '>' + t('disp.modeNDays') + '</option>'
    + '<option value="once"' + (dState.schedMode === 'once' ? ' selected' : '') + '>' + t('disp.modeOnce') + '</option>'
    + '</select>'
    + '<span id="dSchedNBox"' + (dState.schedMode === 'ndays' ? '' : ' style="display:none"') + '><input class="minput sched-n" id="dSchedN" type="number" min="1" step="1" value="' + dState.schedN + '"> ' + t('disp.ndaysUnit') + '</span>'
    /* 锚定时刻（notes-034-sched-time）：每周出星期几选择；周期三模式出时刻框（默认 09:00）；仅一次保持 datetime-local */
    + '<span id="dSchedDowBox"' + (dState.schedMode === 'weekly' ? '' : ' style="display:none"') + '><select class="minput sched-sel" id="dSchedDow">'
    + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<option value="' + d + '"' + (dState.schedDow === d ? ' selected' : '') + '>' + esc(t('disp.dowOption', { dow: t('common.dowNames').split('|')[d] || '' })) + '</option>' }).join('')
    + '</select></span>'
    + '<input class="minput sched-at" id="dSchedAnchor" type="time" value="' + esc(dState.schedAnchor) + '"' + (dState.schedMode === 'once' ? ' style="display:none"' : '') + '>'
    + '<input class="minput sched-at" id="dSchedOnce" type="datetime-local" value="' + esc(dState.schedAt) + '"' + (dState.schedMode === 'once' ? '' : ' style="display:none"') + '>'
    + '<div class="sched-next" id="dSchedNext"></div>'
    + '</div></div>'
    + '<div id="dispSessHost"></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="dCancel">' + t('common.cancel') + '</button><button class="mbtn primary" id="dOk">' + (editing ? t('disp.saveSched') : t('disp.ok')) + '</button></div>'
  );
  if (!editing) $('dInstr').oninput = function () { dState.instr = this.value };
  $('dCancel').onclick = closeModal;
  $('dOk').onclick = doDispatchConfirm;
  /* 调度区接线：单选切换 + 频率模式联动（每 N 天出数字框 / 每周出星期几 / 周期三模式出时刻框 / 仅一次出时间框）+ 下次触发即时预览 */
  if (!editing) {
    $('dTrigNow').onchange = function () { if (this.checked) { dState.sched = false; $('dSchedForm').style.display = 'none' } };
    $('dTrigSched').onchange = function () { if (this.checked) { dState.sched = true; $('dSchedForm').style.display = ''; renderSchedNext() } };
  }
  $('dSchedMode').onchange = function () {
    dState.schedMode = this.value;
    $('dSchedNBox').style.display = this.value === 'ndays' ? '' : 'none';
    $('dSchedDowBox').style.display = this.value === 'weekly' ? '' : 'none';
    $('dSchedAnchor').style.display = this.value === 'once' ? 'none' : '';
    $('dSchedOnce').style.display = this.value === 'once' ? '' : 'none';
    renderSchedNext();
  };
  $('dSchedN').oninput = function () { dState.schedN = this.value; renderSchedNext() };
  $('dSchedDow').onchange = function () { dState.schedDow = parseInt(this.value, 10); renderSchedNext() };
  $('dSchedAnchor').oninput = function () { dState.schedAnchor = this.value; renderSchedNext() };
  $('dSchedOnce').oninput = function () { dState.schedAt = this.value; renderSchedNext() };
  renderSchedNext();
  renderDispatchSessList();
}
function renderDispatchSessList() {
  var host = $('dispSessHost'); if (!host || !dState) return;
  var byWs = {};
  dState.sessions.forEach(function (s) { var w = s.workspace || t('meta.wsOther'); (byWs[w] = byWs[w] || []).push(s) });
  dState.pendingSess.forEach(function (p) { var w = p.workspace || t('meta.wsOther'); (byWs[w] = byWs[w] || []).push({ id: p.id, short: p.short, name: '', pending: true }) });
  var wsKeys = Object.keys(byWs).sort();
  var h = '<div class="disp-ws">' + esc(t('disp.sessSummary', { n: dState.sessions.length, pending: dState.pendingSess.length ? t('disp.sessPending', { n: dState.pendingSess.length }) : '' })) + '</div>';
  if (!wsKeys.length) h += '<div class="modal-hint">' + t('disp.noSessions') + '</div>';
  wsKeys.forEach(function (ws) {
    h += '<div class="disp-ws">' + esc(ws) + '</div>';
    byWs[ws].forEach(function (s) {
      h += '<div class="disp-sess' + (s.pending ? ' dis' : '') + (dState.sessId === s.id ? ' on' : '') + '" data-sid="' + (s.pending ? '' : esc(s.id)) + '">'
        + (s.live ? '<span class="live" title="live"></span>' : '<span class="live" style="background:var(--nt3)" title="' + t('disp.notLive') + '"></span>')
        + '<span class="nm">' + (s.pending ? esc(t('meta.scopePending', { short: s.short })) : esc(s.name || s.short)) + '</span>'
        + '<span style="font-size:10px;color:var(--nt3)">' + esc(s.short || '') + '</span></div>';
    });
  });
  host.innerHTML = h;
  host.querySelectorAll('.disp-sess[data-sid]').forEach(function (el) {
    if (!el.dataset.sid) return;
    el.onclick = function () { dState.sessId = el.dataset.sid; renderDispatchSessList() };
  });
}
/* 表单 → schedule 声明片段（{at|every} + 周期模式锚定 anchor:'HH:MM'（weekly 另带 dow），notes-034-sched-time；target/enabled 由确认路径补）：返回 { decl } | { err }（内联报错文案与 host 红线同口径） */
function schedFormDecl() {
  if (dState.schedMode === 'once') {
    var ms = new Date(dState.schedAt || '').getTime();
    if (!dState.schedAt || !isFinite(ms)) return { err: t('disp.schedNeedAt') };
    if (ms <= Date.now()) return { err: t('disp.schedAtFuture') };
    /* 本地时区语义（notes-034-at-local-tz）：datetime-local 值本身是本地无后缀串，经 isoToLocalInput 归一提交——禁 toISOString（Z 后缀会被 host 闸门拒绝） */
    return { decl: { at: isoToLocalInput(dState.schedAt) } };
  }
  /* 锚定时刻（notes-034-sched-time）：周期三模式必携 anchor:'HH:MM'（触发序列钉死本地时刻不漂移） */
  if (schedAnchorMs(dState.schedAnchor) === null) return { err: t('disp.schedNeedAnchor') };
  if (dState.schedMode === 'ndays') {
    var n = parseInt(dState.schedN, 10);
    if (!isFinite(n) || n < 1) return { err: t('disp.schedNInvalid') };
    return { decl: { every: n + 'd', anchor: dState.schedAnchor } };
  }
  if (dState.schedMode === 'weekly') return { decl: { every: '1w', anchor: dState.schedAnchor, dow: dState.schedDow } };
  return { decl: { every: '1d', anchor: dState.schedAnchor } };
}
/* 声明 → 下次触发毫秒（轮询锚点 = lastFiredAt || createdAt || now；锚定时刻声明 = 锚定序列下一时刻，与 host schedDueAt 同口径；编辑模式传入 editNote 取存量锚点） */
function schedDeclNextMs(decl, note) {
  if (decl.at) return Date.parse(decl.at);
  var firedMs = 0;
  if (note && note.schedule && note.schedule.lastFiredAt) { var f = Date.parse(note.schedule.lastFiredAt); if (isFinite(f)) firedMs = f }
  var base = firedMs;
  if (!base && note && note.createdAt) { var c = Date.parse(note.createdAt); if (isFinite(c)) base = c }
  if (!base) base = Date.now();
  var iv = schedEveryMs(decl.every);
  if (decl.anchor) { var nx = schedAnchorNextMs(decl.anchor, typeof decl.dow === 'number' ? decl.dow : undefined, iv, base, !!firedMs); if (nx !== null) return nx }
  return base + iv;
}
/* 下次触发即时预览（内联；非法输入红字提示，禁原生 prompt） */
function renderSchedNext() {
  var el = $('dSchedNext'); if (!el || !dState) return;
  if (!dState.sched) { el.textContent = ''; el.className = 'sched-next'; return }
  var f = schedFormDecl();
  if (f.err) { el.textContent = '⚠ ' + f.err; el.className = 'sched-next warn'; return }
  el.className = 'sched-next';
  el.textContent = t('disp.nextTrigger', { time: fmtDT(new Date(schedDeclNextMs(f.decl, dState.editNote)).toISOString()) });
}
function doDispatchConfirm() {
  if (!dState || dState.pending) return;
  if (!dState.sessId) { modalErr(t('disp.needSession')); return }
  var sess = dState.sessions.find(function (s) { return s.id === dState.sessId });
  /* 定时执行 / 编辑排定分支（notes-034-sched-ui）：创建/更新 dispatch-schedule 约定笔记（表单与 front-matter 同源，无第二份存储） */
  if (dState.sched || dState.editId) {
    var f = schedFormDecl();
    if (f.err) { modalErr(f.err); return }
    var editId = dState.editId;
    /* 编辑保留原 enabled 态（暂停的任务改排定不被意外拉起）；创建默认 enabled=true；周期模式携锚定时刻 anchor/dow（notes-034-sched-time） */
    var decl = { target: dState.sessId, action: 'dispatch', enabled: editId ? (dState.editNote.schedule.enabled !== false) : true };
    if (f.decl.at) decl.at = f.decl.at; else { decl.every = f.decl.every; decl.anchor = f.decl.anchor; if (typeof f.decl.dow === 'number') decl.dow = f.decl.dow }
    var nextTxt = fmtDT(new Date(schedDeclNextMs(f.decl, dState.editNote)).toISOString());
    dState.pending = true; $('dOk').disabled = true; $('dOk').textContent = editId ? t('settings.saving') : t('disp.savingSched');
    var req;
    if (editId) req = rpc('notes-update', { id: editId, schedule: decl });
    else {
      /* 正文人话 = 原待办正文 + 补充指令（即被派发的工作内容本身）；标题自动「定时 」前缀
         （数据层保留中文：schedPeerKey 前缀正则跨语言匹配同口径；「补充指令：」check 50 断言锚定——i18n 覆盖卡E 不抽串） */
      var body = String(edNote.body || edNote.preview || '').trim() + (String(dState.instr || '').trim() ? '\n\n补充指令：' + String(dState.instr).trim() : '') + '\n';
      req = rpc('notes-create', { title: '定时 ' + (edNote.title || 'Untitled'), body: body, kind: 'todo', contractType: 'dispatch-schedule', schedule: decl });
    }
    req.then(function (res) {
      dState.pending = false;
      if (res && res.error) { modalErr(res.error); $('dOk').disabled = false; $('dOk').textContent = editId ? t('disp.saveSched') : t('disp.ok'); return }
      closeModal(); dState = null;
      toast(t(editId ? 'disp.schedUpdated' : 'disp.schedDone', { time: nextTxt }));
      loadNotes(true);
      if (editId && selId === editId) refreshSelected();   /* 计划块编辑入口（notes-041-sched-plan-edit）：编辑的是当前打开笔记时就地刷新（计划块随 renderEd 重渲） */
    }).catch(function (e) {
      dState.pending = false; modalErr(t('disp.schedFailed', { msg: e && e.message || e }));
      $('dOk').disabled = false; $('dOk').textContent = editId ? t('disp.saveSched') : t('disp.ok');
    });
    return;
  }
  dState.pending = true; $('dOk').disabled = true; $('dOk').textContent = t('disp.dispatching');
  rpc('notes-dispatch', { id: selId, sessionId: dState.sessId, sessionName: sess ? sess.name : '', workspace: sess ? sess.workspace : '', mode: 'existing', instruction: dState.instr }).then(function (res) {
    dState.pending = false;
    if (res && res.error) {
      modalErr(res.error + (res.needOpen ? t('disp.needOpenHint') : ''));
      $('dOk').disabled = false; $('dOk').textContent = t('disp.ok');
      return;
    }
    closeModal(); dState = null;
    toast(t('disp.dispatched', { name: sess ? sess.name : '' }));
    refreshSelected(); loadNotes(true);
  }).catch(function (e) {
    dState.pending = false; modalErr(t('disp.failed', { msg: e && e.message || e }));
    $('dOk').disabled = false; $('dOk').textContent = t('disp.ok');
  });
}
