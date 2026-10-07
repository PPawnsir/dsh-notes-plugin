/* ================= 注入管理面板（设置卡片「注入管理」入口；notes-inject-manager）=================
   数据源：notes-list {includeLogs:true} slim（inject/injectRole/injectEver/sensitive/kind/injectTo 齐备，零新 RPC；含日志——日志行静态标注「不参与注入」）；
   三态语义与详情区三态分段控件完全一致：off→notes-update {inject:false}；约定/资料→{inject:true, injectRole}（payload 禁 undefined）；
   护栏：kind=log 注入硬关 UI 化（0.4.3⑦ 用户裁决——行内不渲染注入开关/勾选（UI 层不提供），host injectForcedOff 硬闸双保险保留）；
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
  injMgrState = { list: null, filter: 'all', search: '', q: '', sel: {}, pending: false, rstats: null, rstatsOpen: false, conflict: null };
  openModal(
    '<div class="modal-t">' + icon('i-bolt', 13) + ' ' + t('settings.injManager') + '<span class="sub">' + t('inj.titleSub') + '</span></div>'
    + '<div class="injmgr-bar"><div class="injmgr-chips" id="injMgrChips"></div>'
    + '<input class="injmgr-search" id="injMgrSearch" placeholder="' + t('inj.searchPlaceholder') + '"></div>'
    + '<div id="injSchedHost"></div>'
    + '<div id="injMntStats"></div>'
    + '<div id="injConflictHost"></div>'
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
  /* 挂载区统计行数据源（0.4.3 验收修复⑥ notes-043-metrics-present）：notes-recall-stats 只读 RPC（账本快照 ledger 键 + 五通道分列），
     零新通道；静默降级——RPC 失败/无快照（新装库 cron 未跑）→ rstats 保持 null，统计行整区省略不占位 */
  rpc('notes-recall-stats', {}).then(function (res) {
    if (!injMgrState) return;
    if (res && !res.error && res.ok) { injMgrState.rstats = res; renderInjMntStats() }
  }).catch(function () { if (injMgrState) { injMgrState.rstats = null; renderInjMntStats() } });   /* 失败清陈旧统计行（刷新场景），遥测静默降级不打扰 */
}
/* 分通道召回率行（挂载区统计点开全量，卡⑥）：交付通道 `ch used/delivered·pct%`（无交付 → `ch —`）+ get 取用计数——
   机器通道名原文输出（遥测通道是机器标识符，不进 i18n；口径同 host _recallFmtChannels） */
function injMgrChanLine(channels) {
  var parts = [];
  ['inject', 'mount', 'search', 'catalog'].forEach(function (c) {
    var st = channels && channels[c];
    if (!st || !st.delivered) { parts.push(c + ' —'); return }
    parts.push(c + ' ' + st.used + '/' + st.delivered + '·' + Math.round((st.rate || 0) * 100) + '%');
  });
  var g = channels && channels.get;
  parts.push('get ×' + (g ? g.uses : 0));
  return parts.join(' ｜ ');
}
/* 挂载区统计行渲染（卡⑥）：账本快照紧凑行（挂载 N｜本周引用 Top3｜零引用 M）+ 点开才见全量（分通道召回率 + 快照明细）；
   无快照 → 整区省略（静默降级；用途分级红线：本行仅呈现，清理裁决走 notes-recall-stats 全量/人工）。
   0.4.6-E（n-mux8cq80ai5h）：挂载计数改用 mountNow 实时现算值（每次打开面板即新鲜；快照 mountTotal 仅作回退）+
   行尾补「截至 HH:MM」（lastFlush 时刻，与目录段信号行同口径——无 lastFlush 则回退快照 at） */
function renderInjMntStats() {
  var host = $('injMntStats'); if (!host || !injMgrState) return;
  var st = injMgrState.rstats;
  if (!st || !st.ledger) { host.innerHTML = ''; return }
  var lg = st.ledger;
  var mNow = st.mountNow != null ? st.mountNow : (lg.mountTotal || 0);
  var asOf = fmtDT(st.lastFlush || lg.at || '').slice(-5);
  var top3 = (lg.top || []).slice(0, 3).map(function (it) { return it.id + '×' + it.count }).join('、') || '—';
  var h = '<div class="injmgr-mntstats-row" id="injMntStatsRow" title="' + esc(t('inj.mntStatsTip')) + '">'
    + icon('i-eye', 11) + ' ' + esc(t('inj.mntStats', { m: mNow, top: top3, z: lg.zeroRefCount || 0 })) + (asOf ? esc(' ｜ ' + t('inj.mntStatsAsOf', { at: asOf })) : '') + '</div>';
  if (injMgrState.rstatsOpen) {
    h += '<div class="injmgr-mntstats-full">'
      + '<div>' + esc(injMgrChanLine(st.channels)) + '</div>'
      + '<div>Top5: ' + esc((lg.top || []).map(function (it) { return it.id + '×' + it.count }).join('、') || '—')
      + ' · zero: ' + esc((lg.zeroRef || []).join('、') || '—')
      + ' · @ ' + esc(fmtDT(lg.at)) + (st.noteId ? ' · mirror: ' + esc(st.noteId) : '') + '</div></div>';
  }
  host.innerHTML = h;
  $('injMntStatsRow').onclick = function () { if (injMgrState) { injMgrState.rstatsOpen = !injMgrState.rstatsOpen; renderInjMntStats() } };
}
/* ===== 约定体检（0.4.5-G notes-045-conflict-check）：LLM 两两检测注入中约定的冲突/被取代对——只提名不执行，人工裁决 =====
   injMgrState.conflict 形态：null=未跑 / {running:true} / {error:msg} / {pairs:[{aId,bId,aTitle,bTitle,relation,reason}], total, acting?}；
   红线：modal 不叠 modal——结果区为面板内联展开区（injConflictHost 插槽，不开第二层弹层）；
   「标 A/B 已取代」= notes-update status='superseded'（注入不动——用户自行决定是否关注入）+ 行移除；「保留两者」= 本次会话内 dismiss（纯本地行移除，零 RPC）；
   面板重开即复位（openInjectManager conflict:null——dismiss 不跨面板会话持久）。 */
function injConflictPairKey(p) { return p.aId + '|' + p.bId + '|' + p.relation }
function renderInjConflict() {
  var host = $('injConflictHost'); if (!host || !injMgrState || !injMgrState.list) return;
  var cf = injMgrState.conflict;
  var running = !!(cf && cf.running), actingKey = (cf && cf.acting) || '';
  var h = '<div class="conflict-sec"><div class="conflict-sec-t">' + icon('i-warn', 12) + ' ' + t('inj.conflictTitle') + '<span class="sub">' + t('inj.conflictTitleSub') + '</span>'
    + '<button class="mbtn conflict-run" id="injConflictRun" title="' + esc(t('inj.conflictRunTip')) + '"' + ((running || actingKey || injMgrState.pending) ? ' disabled' : '') + '>'
    + (running ? t('inj.conflictRunning') : (cf ? t('inj.conflictRerun') : t('inj.conflictRun'))) + '</button></div>';
  if (cf) {
    if (cf.running) h += '<div class="modal-hint">' + t('inj.conflictRunningHint') + '</div>';
    else if (cf.error) h += '<div class="modal-err" style="display:block">' + esc(t('inj.conflictError', { msg: cf.error })) + '</div>';
    else if (!(cf.pairs || []).length) h += '<div class="modal-hint">' + esc(t('inj.conflictEmpty', { n: cf.total || 0 })) + '</div>';
    else {
      h += cf.pairs.map(function (p) {
        return '<div class="conflict-row" data-pk="' + esc(injConflictPairKey(p)) + '">'
          + '<span class="conflict-badge ' + (p.relation === 'supersede' ? 'sup' : 'con') + '">' + (p.relation === 'supersede' ? t('inj.conflictRelSupersede') : t('inj.conflictRelConflict')) + '</span>'
          + '<span class="conflict-pair"><span class="conflict-ti" title="' + esc(p.aTitle) + '">' + esc(p.aTitle) + '</span> ⇄ <span class="conflict-ti" title="' + esc(p.bTitle) + '">' + esc(p.bTitle) + '</span></span>'
          + (p.reason ? '<span class="conflict-reason" title="' + esc(p.reason) + '">' + esc(p.reason) + '</span>' : '')
          + '<span class="conflict-acts">'
          + '<button class="mbtn conflict-act" data-act="supA" title="' + esc(t('inj.conflictSupATip', { title: p.aTitle })) + '"' + (actingKey ? ' disabled' : '') + '>' + t('inj.conflictSupA') + '</button>'
          + '<button class="mbtn conflict-act" data-act="supB" title="' + esc(t('inj.conflictSupBTip', { title: p.bTitle })) + '"' + (actingKey ? ' disabled' : '') + '>' + t('inj.conflictSupB') + '</button>'
          + '<button class="mbtn conflict-act" data-act="keep" title="' + esc(t('inj.conflictKeepTip')) + '"' + (actingKey ? ' disabled' : '') + '>' + t('inj.conflictKeep') + '</button>'
          + '</span></div>';
      }).join('');
    }
  }
  host.innerHTML = h + '</div>';
  $('injConflictRun').onclick = function () { doInjConflictCheck() };
  host.querySelectorAll('.conflict-act').forEach(function (el) {
    el.onclick = function () {
      var pk = el.parentNode.parentNode.getAttribute('data-pk');
      var cf2 = injMgrState && injMgrState.conflict;
      var p = cf2 && (cf2.pairs || []).find(function (x) { return injConflictPairKey(x) === pk });
      if (!p) return;
      var act = el.getAttribute('data-act');
      if (act === 'supA') doInjConflictSupersede(p, 'a');
      else if (act === 'supB') doInjConflictSupersede(p, 'b');
      else doInjConflictDismiss(p);
    };
  });
}
function doInjConflictCheck() {
  var cf = injMgrState && injMgrState.conflict;
  if (!injMgrState || (cf && (cf.running || cf.acting))) return;
  injMgrState.conflict = { running: true }; renderInjConflict();
  rpc('notes-conflict-check', {}).then(function (res) {
    if (!injMgrState) return;   /* 面板已关：丢弃迟到响应（同挂载弹层迟到草稿口径） */
    if (res && res.error) { injMgrState.conflict = { error: res.error }; renderInjConflict(); return }
    injMgrState.conflict = { pairs: (res && res.pairs) || [], total: (res && res.total) || 0 };
    renderInjConflict();
  }).catch(function (e) {
    if (!injMgrState) return;
    injMgrState.conflict = { error: String(e && e.message || e) }; renderInjConflict();
  });
}
/* 标 A/B 已取代：notes-update status='superseded'（既有通道，零新写入口）→ 成功后行移除 + toast + 后台刷新对齐；失败保留行可重试 */
function doInjConflictSupersede(p, which) {
  var cf = injMgrState && injMgrState.conflict;
  if (!cf || cf.running || cf.acting) return;
  var id = which === 'b' ? p.bId : p.aId, title = which === 'b' ? p.bTitle : p.aTitle;
  var pk = injConflictPairKey(p);
  injMgrState.conflict = Object.assign({}, cf, { acting: pk }); renderInjConflict();
  rpc('notes-update', { id: id, status: 'superseded' }).then(function (res) {
    if (!injMgrState) return;
    var cur = injMgrState.conflict;
    if (res && res.error) {
      injMgrState.conflict = cur ? Object.assign({}, cur, { acting: '' }) : cur;
      renderInjConflict(); modalErr(res.error); return;
    }
    toast(t('inj.conflictSupDone', { title: title }));
    if (cur && cur.pairs) injMgrState.conflict = Object.assign({}, cur, { acting: '', pairs: cur.pairs.filter(function (x) { return injConflictPairKey(x) !== pk }) });
    renderInjConflict();
    loadNotes(true);
  }).catch(function (e) {
    if (!injMgrState) return;
    var cur = injMgrState.conflict;
    if (cur) { injMgrState.conflict = Object.assign({}, cur, { acting: '' }); renderInjConflict(); }
    modalErr(t('inj.conflictOpFailed', { msg: e && e.message || e }));
  });
}
/* 保留两者 = 本次会话内 dismiss：纯本地行移除（零 RPC 零副作用） */
function doInjConflictDismiss(p) {
  var cf = injMgrState && injMgrState.conflict;
  if (!cf || !cf.pairs || cf.acting) return;
  var pk = injConflictPairKey(p);
  injMgrState.conflict = Object.assign({}, cf, { pairs: cf.pairs.filter(function (x) { return injConflictPairKey(x) !== pk }) });
  renderInjConflict();
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
  renderInjMntStats();   /* 挂载区统计行（0.4.3 验收修复⑥）：notes-recall-stats 账本快照，无快照整区省略 */
  renderInjConflict();   /* 约定体检区（0.4.5-G notes-045-conflict-check）：内联结果区，不叠 modal */
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
      + '<button class="mbtn trash-act" id="injMgrBatchRef" title="' + t('inj.batchRefTip') + '"' + (st.pending || selCnt < 1 ? ' disabled' : '') + '>' + t('inj.batchReference') + '</button>'
      + '<button class="mbtn trash-act" id="injMgrBatchOff"' + (st.pending || selCnt < 1 ? ' disabled' : '') + '>' + (st.pending ? t('inj.executing') : t('inj.batchOff')) + '</button></div>'
    + '<div class="injmgr-list">'
    + shown.map(function (n) {
        var role = injMgrRole(n), isLog = (n.kind || 'note') === 'log';
        /* 行内三态 segmented（语义与详情区三态分段控件完全一致）；
           注入硬关 UI 化（0.4.3⑦）：log 行不渲染勾选框与注入开关——静态标注「日志不参与注入」（UI 层不提供，非后台纠正；host 硬闸双保险保留） */
        var seg = function (r, label, tip) {
          return '<span class="injmgr-opt' + (role === r ? ' on' : '') + '" data-role="' + r + '" data-id="' + esc(n.id) + '" title="' + tip + '">' + label + '</span>'
        };
        return '<div class="injmgr-row">'
          + (isLog
            ? '<span class="injmgr-checkslot" title="' + t('inj.logNoInjectTip') + '"></span>'
            : '<span><input type="checkbox" class="trash-check injmgr-check" data-id="' + esc(n.id) + '"' + (st.sel[n.id] ? ' checked' : '') + (st.pending ? ' disabled' : '') + '></span>')
          + '<span class="dot" style="background:' + (KCOLOR[n.kind] || KCOLOR.note) + '"></span>'
          + '<span class="injmgr-ti" title="' + esc(n.title || t('tree.untitled')) + '">' + esc(n.title || t('tree.untitled')) + '</span>'
          + (n.sensitive === true ? '<span class="injmgr-sens" title="' + t('inj.sensTip') + '">' + icon('i-lock', 9) + t('inj.sensBadge') + '</span>' : '')
          + (n.injectEver === true && !n.inject ? '<span class="injmgr-ever" title="' + t('meta.injectEverTip') + '">' + icon('i-clock', 9) + t('meta.injectEver') + '</span>' : '')
          + '<span class="injmgr-scope">' + esc(injMgrScopeLabel(n.injectTo)) + '</span>'
          + (isLog
            ? '<span class="injmgr-lognote" title="' + t('inj.logNoInjectTip') + '">' + icon('i-bolt', 10) + t('inj.logNoInject') + '</span>'
            : '<span class="injmgr-seg">' + icon('i-bolt', 10) + seg('off', t('meta.roleOff'), t('meta.roleOffTip')) + seg('convention', t('tree.roleConvention'), t('meta.roleConventionTip')) + seg('reference', t('tree.roleReference'), t('meta.roleReferenceTip')) + '</span>')
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
        /* 0.4.5-B（notes-045-ux-polish）：target='new' 专属会话目标位显示人话文案（首轮回写真实 sid 后自动恢复「→ 截短」，零迁移；纯展示层） */
        + '<span class="sched-target" title="' + esc(s.target || '') + '">' + (s.target === 'new' ? esc(t('disp.schedNewTarget')) : '→ ' + esc(shortSid(s.target))) + '</span>'
        /* 0.4.6-G（notes-046-sched-model）：声明模型档位标注（有声明才显示，无声明零 DOM 痕迹） */
        + (s.provider && s.model ? '<span class="sched-model" title="' + esc(t('disp.schedModelTip', { model: s.provider + '/' + s.model })) + '">' + esc(s.provider + '/' + s.model) + '</span>' : '')
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
  if (s.provider && s.model) { decl.provider = s.provider; decl.model = s.model }   /* 0.4.6-G：暂停/恢复保留模型档位（声明字段随 every 一并回传，防丢档——同 anchor/dow 先例） */
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
/* ===== 挂载弹层（0.4.3⑤ notes-043-index；0.4.3 验收修复 notes-043-preview-when-edit：LLM 草稿预填 + 编辑模式）=====
   两种模式：未挂载 = LLM 草稿模式（打开即「生成中…」状态行 → notes-when-suggest 成功填草稿，失败/8s 超时回退预填标题 + 可见失败态）；
     用户始终可编辑——touched 后到达的草稿不覆盖）；已挂载（预览目录行点击带 existing）= 编辑模式（预填现有文案，不调 LLM）。
   确认统一 notes-mount（幂等换文案；0.4.3 验收修复⑪起 host 单点收口：落行同时把目标翻 reference 档，挂载 ⇔ 资料不变量成立，
     挂载行不再被目标笔记的下一次 update 摘掉）；跳过 = 保留现状行；modal 不叠 modal（调用方先关来源 modal，清返回栈）。
   0.4.3 验收修复⑪（notes-043-mount-ux-final）：openMountModal(n, onConfirm)——确认成功后回调（详情三态入口回填编辑器态）；
     跳过/取消不落回调（零副作用语义）；确认后统一 loadNotes 刷新收敛
   0.4.6-E（n-mux8ak66jttd）：LLM 预填三态可见化——加载态（#injMountStat 状态行「正在生成 whenToUse…」）/ 失败态（「预填不可用，请手写」，
     tooltip 携带原始 error 原因——静默回退排查：resolveLlmSelection 选用链路的失败原因此前被吞，现在用户可见）；
     跳过按钮文案改名「不用建议，自己写」（inj.mountSkip——「跳过」语义歧义：是不写 whenToUse 直接挂载还是跳过此条候选） */
var mountState = null;
/* 挂载弹层状态行（0.4.6-E 三态）：mode 'gen' = 加载中 / 'err' = 失败（title 带原始原因）/ '' = 收起（成功/编辑态） */
function setMountStat(mode, tip) {
  var el = $('injMountStat'); if (!el) return;
  if (!mode) { el.style.display = 'none'; return }
  el.style.display = '';
  el.className = 'inj-mount-stat ' + mode;
  el.textContent = t(mode === 'gen' ? 'inj.mountGen' : 'inj.mountGenFail');
  if (tip) el.title = tip; else el.removeAttribute('title');
}
function openMountModal(n, onConfirm) {
  if (!n) return;
  injMgrState = null; modalBackTo = null;
  var edit = typeof n.existing === 'string';   /* 已挂载 = 编辑模式（预填现有 whenToUse，不调 LLM） */
  mountState = { id: n.id, title: n.title || n.id, when: edit ? n.existing : '', pending: false, generating: !edit, edit: edit, touched: false, genErr: '', onConfirm: typeof onConfirm === 'function' ? onConfirm : null };
  openModal(
    '<div class="modal-t">' + icon('i-bolt', 13) + ' ' + (edit ? t('inj.mountEdit') : t('inj.mountTitle')) + '<span class="sub">' + t('inj.mountSub') + '</span></div>'
    + '<div class="inj-mount-body"><label class="inj-mount-label">' + t('inj.mountLabel') + '</label>'
    + '<textarea class="inj-mount-when" id="injMountWhen" rows="3" placeholder="' + esc(edit ? t('inj.mountPlaceholder') : t('inj.mountGen')) + '">' + esc(mountState.when) + '</textarea>'
    + '<div class="inj-mount-stat" id="injMountStat" style="display:none"></div></div>'
    + '<div class="modal-acts"><button class="mbtn" id="injMountSkip">' + t('inj.mountSkip') + '</button>'
    + '<button class="mbtn primary" id="injMountSave">' + t('inj.mountSave') + '</button></div>'
  );
  $('injMountWhen').oninput = function () { if (mountState) mountState.touched = true };
  if (!edit) {
    setMountStat('gen');   /* 0.4.6-E：加载态立即可见（不再只靠 textarea 占位符——预填文案到达后占位符即消失，加载态无见证） */
    /* LLM 草稿预填：成功填草稿；失败/超时回退预填标题 + 失败态可见（tooltip 原始原因）；弹层已关/换目标则丢弃迟到响应；用户已动手不覆盖 */
    rpc('notes-when-suggest', { id: n.id }).then(function (res) {
      if (!mountState || mountState.id !== n.id) return;
      mountState.generating = false;
      var okDraft = res && !res.error && typeof res.suggestion === 'string' && res.suggestion ? res.suggestion : '';
      mountState.genErr = okDraft ? '' : String((res && res.error) || 'empty suggestion');
      var ta = $('injMountWhen');
      if (!mountState.touched) { mountState.when = okDraft || mountState.title; if (ta) ta.value = mountState.when }
      if (ta) ta.placeholder = t('inj.mountPlaceholder');
      setMountStat(mountState.genErr ? 'err' : '', mountState.genErr);
    }, function (e) {
      if (!mountState || mountState.id !== n.id) return;
      mountState.generating = false;
      mountState.genErr = String(e && e.message || e);
      var ta = $('injMountWhen');
      if (!mountState.touched) { mountState.when = mountState.title; if (ta) ta.value = mountState.title }
      if (ta) ta.placeholder = t('inj.mountPlaceholder');
      setMountStat('err', mountState.genErr);
    });
  }
  $('injMountSkip').onclick = function () { mountState = null; closeModal() };
  $('injMountSave').onclick = function () {
    if (!mountState || mountState.pending) return;
    mountState.pending = true; mountState.when = $('injMountWhen').value;
    /* 空值兜底（0.4.3⑦ 顺带微修）：「正在生成…」窗口内点确认时 when 可能仍为空串——落空回退标题，whenToUse 行不落空 */
    rpc('notes-mount', { id: mountState.id, whenToUse: mountState.when || mountState.title }).then(function (res) {
      var done = mountState; mountState = null;
      if (res && res.error) { toast(t('inj.mountFailed', { msg: res.error })) }
      else {
        toast(t('inj.mountSaved', { title: done.title })); closeModal();
        if (done.onConfirm) { try { done.onConfirm() } catch (e2) {} }   /* 确认回调（0.4.3⑪：详情三态入口回填编辑器态） */
        loadNotes(true);   /* 挂载收敛刷新：host 已把目标翻 reference 档——列表/编辑器数据源即刻对齐（陈旧 inject=false 态保存会摘行） */
      }
    }).catch(function (e) { mountState = null; toast(t('inj.mountFailed', { msg: e && e.message || e })) });
  };
}
/* 单行直改：点 segmented 档位即切换（同详情区通道 notes-update {inject, injectRole}），toast 反馈 */
function doInjMgrSet(n, role) {
  if (!n || !injMgrState || injMgrState.pending) return;
  if ((n.kind || 'note') === 'log' && role !== 'off') return;   /* 日志注入硬关（UI 已不渲染开关，函数拦截为双保险） */
  if (injMgrRole(n) === role) return;
  /* 0.4.3 验收修复⑪：单行「设为资料」先开挂载弹层（LLM 预填 whenToUse；确认 = notes-mount 单点收口落行 + 翻 reference 档，
     取消零副作用——不先静默翻转）；modal 不叠 modal——openMountModal 接管 modal 宿主（ injMgrState 清零由弹层入口承担），
     确认后的收敛刷新由弹层保存路径统一承担（loadNotes） */
  if (role === 'reference') { openMountModal({ id: n.id, title: n.title }); return }
  var upd = { id: n.id, inject: role !== 'off' };
  if (upd.inject) upd.injectRole = role;   /* 非 off 才带 injectRole（off 态不带，payload 禁 undefined；host 仅 inject=true 落盘） */
  rpc('notes-update', upd).then(function (res) {
    if (!injMgrState) return;
    if (res && res.error) { modalErr(res.error); return }
    if (res && res.injectForcedOff) toast(t('inj.forcedOff', { title: n.title || n.id }));
    else toast(role === 'off' ? t('inj.injectOffToast', { title: n.title || n.id }) : t('inj.injectSetToast', { role: t(role === 'reference' ? 'tree.roleReference' : 'tree.roleConvention'), title: n.title || n.id }));
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
