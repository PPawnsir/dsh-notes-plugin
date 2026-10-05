/* ================= 注入管理面板（设置卡片「注入管理」入口；notes-inject-manager）=================
   数据源：notes-list {includeLogs:true} slim（inject/injectRole/injectEver/sensitive/kind/injectTo 齐备，零新 RPC；含日志——日志行禁用态展示）；
   三态语义与详情区三态分段控件完全一致：off→notes-update {inject:false}；约定/资料→{inject:true, injectRole}（payload 禁 undefined）；
   护栏：kind=log 注入硬禁（勾选/档位禁用 + title 提示；host 侧同口径强制 inject=false 并回 injectForcedOff）；
         sensitive 允许注入但行内提示「注入时自动脱敏」；排序：注入中在前（约定 > 资料），组内 updatedAt 降序；
   顶部统计 chips（约定 N / 资料 M / 未注入 K，点击=过滤）；搜索 250ms 防抖（与列表搜索同口径，本地过滤）。 */
var injMgrState = null;   /* { list:null=加载中, filter:'all', search:'', q:'', sel:{}, pending:false } */
var injMgrSearchTimer = null;
/* 笔记三态（与详情区同口径）：inject=true → injectRole（缺省 convention）；否则 off */
function injMgrRole(n) { return n.inject === true ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off' }
/* 作用域摘要（injectTo 数；缺省/存量 global·workspace 值 = 全局）；i18n 覆盖卡D：文案走 t()（filter 回调形参 t 遮蔽仅域内，return 在城外读全局 t） */
function injMgrScopeLabel(injectTo) { var arr = (injectTo || []).filter(function (t) { return t !== 'global' && t !== 'workspace' }); return arr.length === 0 ? t('inj.scopeGlobal') : t('inj.scopeSessions', { n: arr.length }) }
function openInjectManager(from) {
  /* 单层返回栈（notes-041-settings-back）：from='settings'（设置卡「管理…」入口）时存档来源 + 当前 .modal 滚动位置，关闭后自动回设置卡 */
  var backScroll = from === 'settings' && $('modal') ? $('modal').scrollTop : 0;
  injMgrState = { list: null, filter: 'all', search: '', q: '', sel: {}, pending: false };
  openModal(
    '<div class="modal-t">' + icon('i-bolt', 13) + ' ' + t('settings.injManager') + '<span class="sub">' + t('inj.titleSub') + '</span></div>'
    + '<div class="injmgr-bar"><div class="injmgr-chips" id="injMgrChips"></div>'
    + '<input class="injmgr-search" id="injMgrSearch" placeholder="' + t('inj.searchPlaceholder') + '"></div>'
    + '<div id="injSchedHost"></div>'
    + '<div id="injMgrBody"><div class="modal-hint">' + t('common.loading') + '</div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="injMgrClose">' + t('common.close') + '</button></div>'
  );
  if (from === 'settings') { modalBackTo = 'settings'; modalBackScroll = backScroll }   /* 挂载单层返回栈（openModal 已清零，此处按来源回填） */
  $('modal').classList.add('injmgr');
  $('injMgrClose').onclick = function () { if (!injMgrState || !injMgrState.pending) { closeModal(); injMgrState = null } };
  /* 搜索 250ms 防抖（与列表搜索同口径）：输入即更新受控值，防抖后才落过滤词 q */
  $('injMgrSearch').oninput = function () {
    if (!injMgrState) return;
    injMgrState.search = this.value;
    clearTimeout(injMgrSearchTimer);
    injMgrSearchTimer = setTimeout(function () { if (injMgrState) { injMgrState.q = injMgrState.search.trim().toLowerCase(); renderInjectManager() } }, 250);
  };
  loadInjectManager();
}
function loadInjectManager() {
  rpc('notes-list', { includeLogs: true }).then(function (res) {
    if (!injMgrState) return;
    if (res && res.error) { injMgrState.list = []; renderInjectManager(); modalErr(res.error); return }
    injMgrState.list = (res && res.notes) || [];
    renderInjectManager();
  }).catch(function (e) { if (injMgrState) { injMgrState.list = []; renderInjectManager(); modalErr(t('inj.loadFailed', { msg: e && e.message || e })) } });
}
/* 当前过滤视图（排序：注入中在前（约定 > 资料 > 未注入），组内 updatedAt 降序；三态过滤 + 搜索词本地过滤） */
function injMgrShownList() {
  var st = injMgrState; if (!st || !st.list) return [];
  var w = { convention: 0, reference: 1, off: 2 };
  var shown = st.list.slice().sort(function (a, b) { return (w[injMgrRole(a)] - w[injMgrRole(b)]) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) });
  if (st.filter !== 'all') shown = shown.filter(function (n) { return injMgrRole(n) === st.filter });
  if (st.q) shown = shown.filter(function (n) { return (n.title || '').toLowerCase().indexOf(st.q) >= 0 || (n.topic || '').toLowerCase().indexOf(st.q) >= 0 || (n.tags || []).join(' ').toLowerCase().indexOf(st.q) >= 0 });
  return shown;
}
function renderInjectManager() {
  var st = injMgrState, body = $('injMgrBody'), chips = $('injMgrChips');
  if (!st || !body || !chips) return;
  var list = st.list || [];
  /* 顶部统计 chips（点击=过滤）：全部 / 约定 N / 资料 M / 未注入 K */
  var cntConv = 0, cntRef = 0, cntOff = 0;
  list.forEach(function (n) { var r = injMgrRole(n); if (r === 'convention') cntConv++; else if (r === 'reference') cntRef++; else cntOff++ });
  chips.innerHTML = [['all', t('inj.chipAll', { n: list.length })], ['convention', t('inj.chipConvention', { n: cntConv })], ['reference', t('inj.chipReference', { n: cntRef })], ['off', t('inj.chipOff', { n: cntOff })]].map(function (c) {
    return '<button class="injmgr-chip' + (st.filter === c[0] ? ' on' : '') + '" data-f="' + c[0] + '">' + c[1] + '</button>'
  }).join('');
  chips.querySelectorAll('.injmgr-chip').forEach(function (el) { el.onclick = function () { st.filter = el.getAttribute('data-f'); renderInjectManager() } });
  renderInjSched();   /* 调度任务区（notes-034-sched-ui）：与注入总览同面板同数据源 */
  if (!st.list) return;
  var shown = injMgrShownList();
  if (!shown.length) { body.innerHTML = '<div class="modal-hint">' + (list.length ? t('inj.noMatch') : t('inj.emptyLib')) + '</div>'; return }
  var selectable = shown.filter(function (n) { return (n.kind || 'note') !== 'log' });   /* log 行不可选（隐身硬禁） */
  var selCnt = Object.keys(st.sel).length;
  var allChecked = selectable.length > 0 && selectable.every(function (n) { return st.sel[n.id] });
  body.innerHTML = '<div class="injmgr-batch">'
      + '<label class="trash-all"><input type="checkbox" id="injMgrAll"' + (allChecked ? ' checked' : '') + (st.pending || !selectable.length ? ' disabled' : '') + '>' + t('inj.selectAll') + '</label>'
      + '<span class="selcnt">' + t('sel.selCount', { n: selCnt }) + '</span>'
      + '<button class="mbtn trash-act" id="injMgrBatchConv"' + (st.pending || selCnt < 1 ? ' disabled' : '') + '>' + t('inj.batchConvention') + '</button>'
      + '<button class="mbtn trash-act" id="injMgrBatchRef"' + (st.pending || selCnt < 1 ? ' disabled' : '') + '>' + t('inj.batchReference') + '</button>'
      + '<button class="mbtn trash-act" id="injMgrBatchOff"' + (st.pending || selCnt < 1 ? ' disabled' : '') + '>' + (st.pending ? t('inj.executing') : t('inj.batchOff')) + '</button></div>'
    + '<div class="injmgr-list">'
    + shown.map(function (n) {
        var role = injMgrRole(n), isLog = (n.kind || 'note') === 'log';
        /* 行内三态 segmented（语义与详情区三态分段控件完全一致）；log 行约定/资料档禁用（隐身硬禁 + title 提示） */
        var seg = function (r, label, tip) {
          var dis = isLog && r !== 'off';
          return '<span class="injmgr-opt' + (role === r ? ' on' : '') + (dis ? ' dis' : '') + '" data-role="' + r + '" data-id="' + esc(n.id) + '" title="' + (dis ? t('inj.logSegTip') : tip) + '">' + label + '</span>'
        };
        return '<div class="injmgr-row">'
          + '<span' + (isLog ? ' title="' + t('inj.logRowTip') + '"' : '') + '><input type="checkbox" class="trash-check injmgr-check" data-id="' + esc(n.id) + '"' + (st.sel[n.id] ? ' checked' : '') + (isLog || st.pending ? ' disabled' : '') + '></span>'
          + '<span class="dot" style="background:' + (KCOLOR[n.kind] || KCOLOR.note) + '"></span>'
          + '<span class="injmgr-ti" title="' + esc(n.title || t('tree.untitled')) + '">' + esc(n.title || t('tree.untitled')) + '</span>'
          + (n.sensitive === true ? '<span class="injmgr-sens" title="' + t('inj.sensTip') + '">' + icon('i-lock', 9) + t('inj.sensBadge') + '</span>' : '')
          + (n.injectEver === true && !n.inject ? '<span class="injmgr-ever" title="' + t('meta.injectEverTip') + '">' + icon('i-clock', 9) + t('meta.injectEver') + '</span>' : '')
          + '<span class="injmgr-scope">' + esc(injMgrScopeLabel(n.injectTo)) + '</span>'
          + '<span class="injmgr-seg">' + icon('i-bolt', 10) + seg('off', t('meta.roleOff'), t('meta.roleOffTip')) + seg('convention', t('tree.roleConvention'), t('meta.roleConventionTip')) + seg('reference', t('tree.roleReference'), t('meta.roleReferenceTip')) + '</span>'
          + '</div>'
      }).join('') + '</div>';
  $('injMgrAll').onchange = toggleInjMgrAll;
  $('injMgrBatchConv').onclick = function () { doInjMgrBatch('convention') };
  $('injMgrBatchRef').onclick = function () { doInjMgrBatch('reference') };
  $('injMgrBatchOff').onclick = function () { doInjMgrBatch('off') };
  body.querySelectorAll('.injmgr-check').forEach(function (el) { el.onchange = function () { toggleInjMgrSel(el.getAttribute('data-id')) } });
  body.querySelectorAll('.injmgr-opt').forEach(function (el) {
    el.onclick = function () {
      if (el.classList.contains('dis')) return;   /* log 禁用档不响应（双保险） */
      var id = el.getAttribute('data-id'), n = (injMgrState && injMgrState.list || []).find(function (x) { return x.id === id });
      if (n) doInjMgrSet(n, el.getAttribute('data-role'));
    };
  });
}
/* ===== 调度任务区（notes-034-sched-ui）：contractType=dispatch-schedule 约定笔记总览/暂停/删除/编辑回填——
   数据源 = notes-list slim 既有 contractType/schedule 字段（零新 RPC；表单与 front-matter 同一数据源两个视图） ===== */
function injSchedList() { return ((injMgrState && injMgrState.list) || []).filter(function (n) { return (n.contractType || '') === 'dispatch-schedule' && n.schedule && !n.deleted }) }
/* 上次结果徽章：lastError 红 / lastRun sent 绿 / 未触发灰（暂停另出黄徽章 + 行置灰） */
function schedBadgeHtml(n) {
  var s = n.schedule;
  if (s.lastError) return '<span class="sched-badge err" title="' + esc(s.lastError.message || '') + '">' + icon('i-x', 9) + esc(t('meta.schedFailed', { time: fmtDT(s.lastError.at) })) + '</span>';
  if (s.lastRun) return s.lastRun.status === 'sent'
    ? '<span class="sched-badge ok" title="' + esc(t('meta.schedReceiptTip', { id: s.lastRun.receiptId || '' })) + '">' + icon('i-check', 9) + esc(t('meta.schedSent', { time: fmtDT(s.lastRun.at) })) + '</span>'
    : '<span class="sched-badge err">' + icon('i-x', 9) + esc(t('meta.schedFailed', { time: fmtDT(s.lastRun.at) })) + '</span>';
  return '<span class="sched-badge">' + t('meta.schedNever') + '</span>';
}
/* 下次触发展示：暂停 → 已暂停；单次已触发 → 已触发；否则「下次 <本地时间>」（锚点同 host schedDueAt 口径）；i18n 覆盖卡D：文案走 t()（复用 B 卡 meta.sched* key） */
function schedNextLabel(n) {
  var s = n.schedule;
  if (s.enabled === false) return t('meta.schedPaused');
  if (s.at && s.lastFiredAt && Date.parse(s.lastFiredAt) >= Date.parse(s.at)) return t('meta.schedFired');
  var ms = schedNextMs(n);
  return ms === null ? '—' : t('meta.schedNext', { time: fmtDT(new Date(ms).toISOString()) });
}
function renderInjSched() {
  var host = $('injSchedHost'); if (!host || !injMgrState || !injMgrState.list) return;
  var items = injSchedList();
  var h = '<div class="sched-sec"><div class="sched-sec-t">' + icon('i-clock', 12) + ' ' + t('inj.schedTitle', { n: items.length }) + '<span class="sub">' + t('inj.schedTitleSub') + '</span></div>';
  if (!items.length) h += '<div class="modal-hint">' + t('inj.schedEmpty') + '</div>';
  else {
    h += items.map(function (n) {
      var s = n.schedule, paused = s.enabled === false;
      return '<div class="sched-row' + (paused ? ' paused' : '') + '" data-id="' + esc(n.id) + '">'
        + '<span class="sched-row-t" title="' + esc(n.title || t('tree.untitled')) + '">' + esc(n.title || t('tree.untitled')) + '</span>'
        + '<span class="sched-freq">' + esc(schedFreqLabel(s)) + '</span>'
        + '<span class="sched-target" title="' + esc(s.target || '') + '">→ ' + esc(shortSid(s.target)) + '</span>'
        + '<span class="sched-nf">' + esc(schedNextLabel(n)) + '</span>'
        + schedBadgeHtml(n)
        + (paused ? '<span class="sched-badge off">' + t('meta.schedPaused') + '</span>' : '')
        + '<span class="sched-acts">'
        + '<button class="mbtn sched-act" data-act="edit" title="' + t('meta.schedEditTip') + '">' + t('meta.edit') + '</button>'
        + '<button class="mbtn sched-act" data-act="toggle" title="' + (paused ? t('meta.schedResumeTip') : t('meta.schedPauseTip')) + '">' + (paused ? t('meta.resume') : t('meta.pause')) + '</button>'
        + '<button class="mbtn sched-act" data-act="del" title="' + t('meta.schedDelTip') + '">' + t('common.delete') + '</button>'
        + '</span></div>';
    }).join('');
  }
  host.innerHTML = h + '</div>';
  host.querySelectorAll('.sched-act').forEach(function (el) {
    el.onclick = function () {
      var row = el.parentNode.parentNode, n = injSchedList().find(function (x) { return x.id === row.getAttribute('data-id') });
      if (!n) return;
      var act = el.getAttribute('data-act');
      if (act === 'edit') doInjSchedEdit(n);
      else if (act === 'toggle') doInjSchedToggle(n);
      else if (act === 'del') doInjSchedDel(n);
    };
  });
}
/* 编辑 = 回填派发弹窗（modal 不叠 modal：先关注入管理再开编辑态派发弹窗；清返回栈——调度编辑回填是新链路，关闭不回设置卡） */
function doInjSchedEdit(n) { modalBackTo = null; closeModal(); injMgrState = null; openDispatchEdit(n) }
/* 暂停/恢复：表单与 front-matter 同源——只提交声明字段（机器状态由 host 闸门延续；锚定时刻 anchor/dow 属声明字段随 every 一并回传，防暂停/恢复丢锚定，notes-034-sched-time）；恢复走 host 存活校验，失败内联回显。
   双上下文（notes-041-sched-plan-edit）：注入管理调度区 + 详情计划块共用本 handler——schedOpPending 模块级闸（injMgrState 在场时同步其 pending 驱动 modal 重渲，错误内联回显；不在场 toast）；
   成功后计划块就地刷新：edNote 命中即本地回写 enabled + renderMeta（loadNotes 后台对齐 host） */
var schedOpPending = false;
function doInjSchedToggle(n) {
  var s = n.schedule; if (!s || schedOpPending) return;
  var decl = { target: s.target, action: 'dispatch', enabled: s.enabled === false };
  if (s.at) decl.at = s.at; else { decl.every = s.every; if (s.anchor) decl.anchor = s.anchor; if (typeof s.dow === 'number') decl.dow = s.dow }
  schedOpPending = true;
  if (injMgrState) { injMgrState.pending = true; renderInjectManager(); }
  rpc('notes-update', { id: n.id, schedule: decl }).then(function (res) {
    schedOpPending = false;
    if (injMgrState) injMgrState.pending = false;
    if (res && res.error) { if (injMgrState) { renderInjectManager(); modalErr(res.error) } else toast(res.error); return }
    toast(decl.enabled ? t('inj.schedResumed', { title: n.title || n.id }) : t('inj.schedPausedToast', { title: n.title || n.id }));
    if (edNote && edNote.id === n.id && edNote.schedule) { edNote.schedule.enabled = decl.enabled; renderMeta(); }
    if (injMgrState) loadInjectManager();
    loadNotes(true);
  }).catch(function (e) {
    schedOpPending = false;
    if (injMgrState) { injMgrState.pending = false; renderInjectManager(); modalErr(t('meta.opFailed', { msg: e && e.message || e })) }
    else toast(t('meta.opFailed', { msg: e && e.message || e }));
  });
}
/* 删除 = 软删约定笔记（回收站可恢复；tick 跳过已删笔记，调度即刻停止）——暂停与删除是两个独立操作。
   双上下文（notes-041-sched-plan-edit）：计划块删除的是当前打开笔记时，编辑器一并清空（同 doDeleteNote 口径） */
function doInjSchedDel(n) {
  if (schedOpPending) return;
  if (!confirm(t('inj.schedDelConfirm', { title: n.title || n.id }))) return;
  schedOpPending = true;
  if (injMgrState) { injMgrState.pending = true; renderInjectManager(); }
  rpc('notes-delete', { id: n.id }).then(function (res) {
    schedOpPending = false;
    if (injMgrState) injMgrState.pending = false;
    if (res && res.error) { if (injMgrState) { renderInjectManager(); modalErr(res.error) } else toast(res.error); return }
    toast(t('inj.schedDeleted', { title: n.title || n.id }));
    if (edNote && edNote.id === n.id) { selId = null; edNote = null; renderEd(); }
    if (injMgrState) loadInjectManager();
    loadNotes(true);
  }).catch(function (e) {
    schedOpPending = false;
    if (injMgrState) { injMgrState.pending = false; renderInjectManager(); modalErr(t('meta.deleteFailed', { msg: e && e.message || e })) }
    else toast(t('meta.deleteFailed', { msg: e && e.message || e }));
  });
}
function toggleInjMgrSel(id) { if (!injMgrState || injMgrState.pending) return; if (injMgrState.sel[id]) delete injMgrState.sel[id]; else injMgrState.sel[id] = true; renderInjectManager() }
/* 全选 = 当前过滤视图内可选（非 log）行；已全勾时再点清空 */
function toggleInjMgrAll() {
  if (!injMgrState || !injMgrState.list || injMgrState.pending) return;
  var selectable = injMgrShownList().filter(function (n) { return (n.kind || 'note') !== 'log' });
  var all = selectable.length > 0 && selectable.every(function (n) { return injMgrState.sel[n.id] });
  injMgrState.sel = {};
  if (!all) selectable.forEach(function (n) { injMgrState.sel[n.id] = true });
  renderInjectManager();
}
/* ===== 挂载弹层（0.4.3⑤ notes-043-index）：给资料开注入 → 手写 whenToUse（textarea 预填标题）→ 确认落注入索引 §1 行 =====
   host 侧开注入已自动落缺省行（whenToUse=标题），本弹层 = 换文案通道：跳过 = 保留缺省行；modal 不叠 modal（先关注入管理面板，清返回栈） */
var mountState = null;
function openMountModal(n) {
  if (!n) return;
  injMgrState = null; modalBackTo = null;
  mountState = { id: n.id, title: n.title || n.id, when: n.title || '', pending: false };
  openModal(
    '<div class="modal-t">' + icon('i-bolt', 13) + ' ' + t('inj.mountTitle') + '<span class="sub">' + t('inj.mountSub') + '</span></div>'
    + '<div class="inj-mount-body"><label class="inj-mount-label">' + t('inj.mountLabel') + '</label>'
    + '<textarea class="inj-mount-when" id="injMountWhen" rows="3" placeholder="' + esc(t('inj.mountPlaceholder')) + '">' + esc(mountState.when) + '</textarea></div>'
    + '<div class="modal-acts"><button class="mbtn" id="injMountSkip">' + t('inj.mountSkip') + '</button>'
    + '<button class="mbtn primary" id="injMountSave">' + t('inj.mountSave') + '</button></div>'
  );
  $('injMountSkip').onclick = function () { mountState = null; closeModal() };
  $('injMountSave').onclick = function () {
    if (!mountState || mountState.pending) return;
    mountState.pending = true; mountState.when = $('injMountWhen').value;
    rpc('notes-mount', { id: mountState.id, whenToUse: mountState.when }).then(function (res) {
      var done = mountState; mountState = null;
      if (res && res.error) { toast(t('inj.mountFailed', { msg: res.error })) }
      else { toast(t('inj.mountSaved', { title: done.title })); closeModal() }
    }).catch(function (e) { mountState = null; toast(t('inj.mountFailed', { msg: e && e.message || e })) });
  };
}
/* 单行直改：点 segmented 档位即切换（同详情区通道 notes-update {inject, injectRole}），toast 反馈 */
function doInjMgrSet(n, role) {
  if (!n || !injMgrState || injMgrState.pending) return;
  if ((n.kind || 'note') === 'log' && role !== 'off') return;   /* 日志隐身硬禁（按钮已禁用，双保险） */
  if (injMgrRole(n) === role) return;
  var upd = { id: n.id, inject: role !== 'off' };
  if (upd.inject) upd.injectRole = role;   /* 非 off 才带 injectRole（off 态不带，payload 禁 undefined；host 仅 inject=true 落盘） */
  rpc('notes-update', upd).then(function (res) {
    if (!injMgrState) return;
    if (res && res.error) { modalErr(res.error); return }
    if (res && res.injectForcedOff) toast(t('inj.forcedOff', { title: n.title || n.id }));
    else toast(role === 'off' ? t('inj.injectOffToast', { title: n.title || n.id }) : t('inj.injectSetToast', { role: t(role === 'reference' ? 'tree.roleReference' : 'tree.roleConvention'), title: n.title || n.id }));
    /* 0.4.3⑤ 挂载弹层：设为资料（reference）→ 手写 whenToUse（host 已自动落缺省行，弹层换文案；modal 不叠 modal——先关注入管理面板） */
    if (role === 'reference') { loadNotes(true); setTimeout(function () { openMountModal({ id: n.id, title: n.title }) }, 0); return }
    /* 本地即时回写（injectEver 粘性：开启即曾注入），后台刷新对齐 host */
    n.inject = role !== 'off';
    if (role !== 'off') { n.injectRole = role; n.injectEver = true }
    renderInjectManager();
    loadNotes(true);
  }).catch(function (e) { modalErr(t('inj.setFailed', { msg: e && e.message || e })) });
}
/* 批量设为约定/资料/关闭：confirm 条数 → 逐条 notes-update（单条失败计数不中断）；完成后清选 + 刷新 */
function doInjMgrBatch(role) {
  if (!injMgrState || injMgrState.pending) return;
  var ids = Object.keys(injMgrState.sel);
  if (!ids.length) return;
  var label = role === 'off' ? t('inj.batchOff') : t('inj.batchLabelSet', { role: t(role === 'reference' ? 'tree.roleReference' : 'tree.roleConvention') });
  if (!confirm(t('inj.batchConfirm', { label: label, n: ids.length, effect: role === 'off' ? t('inj.batchEffOff') : t(role === 'reference' ? 'inj.batchEffRef' : 'inj.batchEffConv') }))) return;
  injMgrState.pending = true; renderInjectManager();
  var ok = 0, fail = 0, seq = Promise.resolve();
  ids.forEach(function (id) {
    var upd = { id: id, inject: role !== 'off' };
    if (upd.inject) upd.injectRole = role;
    seq = seq.then(function () {
      return rpc('notes-update', upd).then(function (res) { if (res && res.error) fail++; else ok++ }, function () { fail++ });
    });
  });
  seq.then(function () {
    if (!injMgrState) return;
    injMgrState.pending = false; injMgrState.sel = {};
    toast(t('inj.batchDone', { label: label, ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''));
    loadInjectManager(); loadNotes(true);
  });
}
