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
/* 作用域摘要（injectTo 数；缺省/存量 global·workspace 值 = 全局） */
function injMgrScopeLabel(injectTo) { var arr = (injectTo || []).filter(function (t) { return t !== 'global' && t !== 'workspace' }); return arr.length === 0 ? '全局' : arr.length + ' 个会话' }
function openInjectManager() {
  injMgrState = { list: null, filter: 'all', search: '', q: '', sel: {}, pending: false };
  openModal(
    '<div class="modal-t">' + icon('i-bolt', 13) + ' 注入管理<span class="sub">全库注入总览 · 单行直改 / 多选批量 · 日志隐身硬禁</span></div>'
    + '<div class="injmgr-bar"><div class="injmgr-chips" id="injMgrChips"></div>'
    + '<input class="injmgr-search" id="injMgrSearch" placeholder="搜索标题 / 主题 / 标签…"></div>'
    + '<div id="injMgrBody"><div class="modal-hint">加载中…</div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="injMgrClose">关闭</button></div>'
  );
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
  }).catch(function (e) { if (injMgrState) { injMgrState.list = []; renderInjectManager(); modalErr('加载失败：' + (e && e.message || e)) } });
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
  chips.innerHTML = [['all', '全部 ' + list.length], ['convention', '约定 ' + cntConv], ['reference', '资料 ' + cntRef], ['off', '未注入 ' + cntOff]].map(function (c) {
    return '<button class="injmgr-chip' + (st.filter === c[0] ? ' on' : '') + '" data-f="' + c[0] + '">' + c[1] + '</button>'
  }).join('');
  chips.querySelectorAll('.injmgr-chip').forEach(function (el) { el.onclick = function () { st.filter = el.getAttribute('data-f'); renderInjectManager() } });
  if (!st.list) return;
  var shown = injMgrShownList();
  if (!shown.length) { body.innerHTML = '<div class="modal-hint">' + (list.length ? '无匹配笔记（调整过滤或搜索词）。' : '笔记库为空。') + '</div>'; return }
  var selectable = shown.filter(function (n) { return (n.kind || 'note') !== 'log' });   /* log 行不可选（隐身硬禁） */
  var selCnt = Object.keys(st.sel).length;
  var allChecked = selectable.length > 0 && selectable.every(function (n) { return st.sel[n.id] });
  body.innerHTML = '<div class="injmgr-batch">'
      + '<label class="trash-all"><input type="checkbox" id="injMgrAll"' + (allChecked ? ' checked' : '') + (st.pending || !selectable.length ? ' disabled' : '') + '>全选</label>'
      + '<span class="selcnt">已选 ' + selCnt + ' 条</span>'
      + '<button class="mbtn trash-act" id="injMgrBatchConv"' + (st.pending || selCnt < 1 ? ' disabled' : '') + '>设为约定</button>'
      + '<button class="mbtn trash-act" id="injMgrBatchRef"' + (st.pending || selCnt < 1 ? ' disabled' : '') + '>设为资料</button>'
      + '<button class="mbtn trash-act" id="injMgrBatchOff"' + (st.pending || selCnt < 1 ? ' disabled' : '') + '>' + (st.pending ? '执行中…' : '关闭注入') + '</button></div>'
    + '<div class="injmgr-list">'
    + shown.map(function (n) {
        var role = injMgrRole(n), isLog = (n.kind || 'note') === 'log';
        /* 行内三态 segmented（语义与详情区三态分段控件完全一致）；log 行约定/资料档禁用（隐身硬禁 + title 提示） */
        var seg = function (r, label, tip) {
          var dis = isLog && r !== 'off';
          return '<span class="injmgr-opt' + (role === r ? ' on' : '') + (dis ? ' dis' : '') + '" data-role="' + r + '" data-id="' + esc(n.id) + '" title="' + (dis ? '日志默认隐身：inject 强制关闭（kind=log 硬禁）' : tip) + '">' + label + '</span>'
        };
        return '<div class="injmgr-row">'
          + '<span' + (isLog ? ' title="日志默认隐身：inject 强制关闭，不参与注入批量操作"' : '') + '><input type="checkbox" class="trash-check injmgr-check" data-id="' + esc(n.id) + '"' + (st.sel[n.id] ? ' checked' : '') + (isLog || st.pending ? ' disabled' : '') + '></span>'
          + '<span class="dot" style="background:' + (KCOLOR[n.kind] || KCOLOR.note) + '"></span>'
          + '<span class="injmgr-ti" title="' + esc(n.title || '无标题') + '">' + esc(n.title || '无标题') + '</span>'
          + (n.sensitive === true ? '<span class="injmgr-sens" title="敏感笔记：注入时自动脱敏（正文按行打码，键保留值遮蔽）">' + icon('i-lock', 9) + '注入时自动脱敏</span>' : '')
          + (n.injectEver === true && !n.inject ? '<span class="injmgr-ever" title="曾注入：历史上开启过上下文注入（现已关闭；injectEver 为粘性标记，不随关闭回退）">' + icon('i-clock', 9) + '曾注入</span>' : '')
          + '<span class="injmgr-scope">' + esc(injMgrScopeLabel(n.injectTo)) + '</span>'
          + '<span class="injmgr-seg">' + icon('i-bolt', 10) + seg('off', '关闭', '不注入系统提示') + seg('convention', '约定', '须遵守的行为规则') + seg('reference', '资料', '事实性补充信息，Agent 按需取用') + '</span>'
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
    if (res && res.injectForcedOff) toast('「' + (n.title || n.id) + '」日志默认隐身：inject 已强制关闭');
    else toast(role === 'off' ? '已关闭注入：' + (n.title || n.id) : '已设为' + (role === 'reference' ? '资料' : '约定') + '：' + (n.title || n.id));
    /* 本地即时回写（injectEver 粘性：开启即曾注入），后台刷新对齐 host */
    n.inject = role !== 'off';
    if (role !== 'off') { n.injectRole = role; n.injectEver = true }
    renderInjectManager();
    loadNotes(true);
  }).catch(function (e) { modalErr('设置失败：' + (e && e.message || e)) });
}
/* 批量设为约定/资料/关闭：confirm 条数 → 逐条 notes-update（单条失败计数不中断）；完成后清选 + 刷新 */
function doInjMgrBatch(role) {
  if (!injMgrState || injMgrState.pending) return;
  var ids = Object.keys(injMgrState.sel);
  if (!ids.length) return;
  var label = role === 'off' ? '关闭注入' : ('设为' + (role === 'reference' ? '资料' : '约定'));
  if (!confirm('批量' + label + '：所选的 ' + ids.length + ' 条笔记将' + (role === 'off' ? '关闭上下文注入。' : '注入为' + (role === 'reference' ? '资料（按需取用）。' : '约定（须遵守）。')) + '\n确认执行？')) return;
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
    toast('已' + label + ' ' + ok + ' 条' + (fail ? '，失败 ' + fail + ' 条' : ''));
    loadInjectManager(); loadNotes(true);
  });
}
