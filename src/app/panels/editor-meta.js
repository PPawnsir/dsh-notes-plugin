function renderCrumb() {
  var n = edNote; if (!n) return;
  /* 面包屑文件夹段（notes-nested-folder-ui）：「父/子/孙」路径；0.4.3⑦ 文件视图拆除后点击 = 树内展开该文件夹（含祖先链），不切视图 */
  var fhtml = '';
  if (n.folder) folderPath(n.folder).forEach(function (pf) { fhtml += '<span class="lnk crumb-f" data-fid="' + pf.id + '" title="' + t('meta.crumbFolderExpandTip', { name: esc(pf.name) }) + '">' + esc(pf.name) + '</span><span class="sep">/</span>' });
  $('edCrumb').innerHTML = fhtml
    + '<span class="lnk" id="crumbTopic" title="' + t('meta.crumbTopicTip') + '">' + esc(n.topic || t('meta.uncategorized')) + '</span><span class="sep">/</span><span>' + esc(n.id || t('meta.unsavedDraft')) + '</span>';
  $('crumbTopic').onclick = function () { view = { type: 'topic', id: n.topic || '未分类' }; render(); toast(t('meta.filteredByTopic', { name: n.topic || t('meta.uncategorized') })) };
  $('edCrumb').querySelectorAll('.crumb-f').forEach(function (el) {
    el.onclick = function () { var fid = el.getAttribute('data-fid'); folderPath(fid).forEach(function (af) { foldOpen[af.id] = true }); saveFoldOpen(); render() };
  });
}
function renderMeta() {
  var n = edNote; if (!n) return;
  var tagsStr = n._tagsStr != null ? n._tagsStr : (n.tags || []).filter(function (t) { return t !== 'quick' }).join(', ');
  /* 派发计划块 + 关联调度清单（notes-034-sched-detail）：meta 尾部全宽行；无调度零渲染（空串零 DOM 痕迹）；
     涉及调度时按需一次 includeLogs 兜底（log 型调度约定旁路，见 ensureSchedPeers） */
  var spHtml = schedPlanHtml(n, schedPeerSource());
  if (spHtml) ensureSchedPeers();
  /* 注入三态：off=不注入 / convention=约定（须遵守）/ reference=资料（按需取用）；存量 inject=true 无 role 缺省 convention */
  var role = n.inject ? (n.injectRole === 'reference' ? 'reference' : 'convention') : 'off';
  $('edMeta').innerHTML =
    '<span class="meta-chip" title="' + t('meta.kindTip') + '"><span class="dot" style="background:' + (KCOLOR[n.kind] || KCOLOR.note) + '"></span><select id="kindSel">'
    + Object.keys(KIND).filter(function (k) { return k !== 'sys' || k === (n.kind || 'note') }).map(function (k) { return '<option value="' + k + '"' + (k === (n.kind || 'note') ? ' selected' : '') + '>' + kindLabel(k) + '</option>' }).join('') + '</select></span>'   /* i18n 覆盖卡F（B 卡交接②）：kind 下拉选项经 kindLabel() 条件映射走 t()（KIND 字面量仅作锚）；0.4.3⑩：sys 为机器托管 kind——仅当前笔记已是 sys 时渲染该选项（显示保真），人工不可转入 */
    + '<span class="meta-chip" title="' + t('meta.statusTip') + '"><select id="statusSel">'
    + ['active', 'resolved', 'superseded'].map(function (s) { return '<option value="' + s + '"' + (s === (isPinned(n) ? 'active' : n.status || 'active') ? ' selected' : '') + '>' + statusLabel(s) + '</option>' }).join('') + '</select></span>'   /* i18n 覆盖卡F（B 卡交接②）：status 下拉选项经 statusLabel() 条件映射走 t()（meta.status* 本卡建） */
    + '<span class="meta-chip" title="' + t('meta.topicTip') + '">' + icon('i-topic') + '<input id="mTopicInput" size="8" placeholder="' + t('meta.topicPlaceholder') + '" value="' + esc(n.topic === '分类中' ? '' : (n.topic || '')) + '"></span>'
    + '<span class="meta-chip" title="' + t('meta.tagsTip') + '">' + icon('i-filter') + '<input id="mTagsInput" size="10" placeholder="' + t('meta.tagsPlaceholder') + '" value="' + esc(tagsStr) + '"></span>'
    + (fname(n.folder) ? '<span class="meta-chip">' + icon('i-folder') + esc(fname(n.folder)) + '</span>' : '')
    /* 使用遥测（P2）：详情 meta chip「被引用 N 次」（0 次不显示） */
    + ((n.useCount || 0) > 0 ? '<span class="meta-chip" title="' + t('meta.useCountTip') + '">' + icon('i-quote') + t('meta.useCount', { n: n.useCount }) + '</span>' : '')
    /* P3 派发闭环徽章：有派发记录时聚合显示（pending=有待回执 / done=全部已回执），点击展开派发历史 */
    + (function () { var ds = n.dispatches || []; if (!ds.length) return ''; var openN = ds.filter(function (d) { return !isDispDone(d) }).length; return '<span class="meta-chip disp-badge ' + (openN ? 'pending' : 'done') + '" id="mDispBadge" title="' + (openN ? t('meta.dispPendingTip', { open: openN, total: ds.length }) : t('meta.dispDoneTip', { total: ds.length })) + '">' + icon(openN ? 'i-play' : 'i-check') + esc(openN ? t('meta.dispPending', { open: openN, total: ds.length }) : t('meta.dispDone')) + '</span>' })()
    /* 注入三态（0.4.3⑦ 注入硬关 UI 化）：kind=log 不渲染开关——UI 层不提供日志注入选项（host injectForcedOff 硬闸双保险保留） */
    + ((n.kind || 'note') === 'log'
      ? '<span class="meta-chip" title="' + t('meta.logNoInjectTip') + '">' + icon('i-bolt') + t('meta.logNoInject') + '</span>'
      : '<span class="meta-chip role-seg" id="mRole">' + icon('i-bolt')
      + '<span class="seg' + (role === 'off' ? ' on' : '') + '" data-role="off" title="' + t('meta.roleOffTip') + '">' + t('meta.roleOff') + '</span>'
      + '<span class="seg' + (role === 'convention' ? ' on' : '') + '" data-role="convention" title="' + t('meta.roleConventionTip') + '">' + t('tree.roleConvention') + '</span>'
      + '<span class="seg' + (role === 'reference' ? ' on' : '') + '" data-role="reference" title="' + t('meta.roleReferenceTip') + '">' + t('tree.roleReference') + '</span></span>')
    + (role !== 'off' ? '<span class="scope-wrap" id="scopeWrap"><span class="meta-chip" id="scopeTrig" title="' + t('meta.scopeTip') + '">' + esc(injectScopeLabel(n.injectTo)) + ' ▾</span><div id="scopePanelHost"></div></span>' : '')
    + '<span class="meta-chip tgl' + (n.sensitive === true ? ' on' : '') + '" id="mSens" title="' + t('meta.sensTip') + '">' + icon('i-lock') + t('meta.sens') + '</span>'
    /* 0.4.4-D hidden chip（eye 图标）：隐藏中=列表/树不显示（跳转与搜索打开不受影响）；点击切回 */
    + '<span class="meta-chip tgl' + (n.hidden === true ? ' on' : '') + '" id="mHidden" title="' + t('meta.hiddenTip') + '">' + icon('i-eye') + t('meta.hidden') + '</span>'
    /* 曾注入徽章（injectEver 粘性标记：单向只升不降，不随关闭回退；当前已注入时由上方注入角色段表达，不重复显示） */
    + (n.injectEver === true && !n.inject ? '<span class="meta-chip" title="' + t('meta.injectEverTip') + '">' + icon('i-clock') + t('meta.injectEver') + '</span>' : '')
    + '<span class="meta-sp"></span>'
    /* 双模式两段开关（原型 .modeseg + tipwrap 降级 tooltip）：源码 ⇄ 富文本；降级态富文本段置灰 */
    + '<span class="tipwrap' + (degraded.ok ? '' : ' deg') + '">'
    + '<span class="modeseg" id="modeSeg">'
    + '<button class="seg' + (edMode === 'source' ? ' on' : '') + '" data-m="source" title="' + t('meta.srcModeTip') + '">' + icon('i-code-block', 12) + t('meta.src') + '</button>'
    + '<button class="seg' + (edMode === 'rich' ? ' on' : '') + (degraded.ok ? '' : ' dis') + '" data-m="rich" id="segRich" title="' + t('meta.richModeTip') + '">' + icon('i-eye', 12) + t('meta.rich') + '</button>'
    + '</span>'
    + '<span class="tip" id="richTip">' + t('meta.richDegradedShort') + '</span>'
    + '</span>'
    + '<span class="kbd">Ctrl+/</span>'
    /* 二期 ✨整理：AI 按当前 kind 模板重写正文（notes-ai-organize；替换后 toast 可撤销一次） */
    + '<span class="meta-act organize-btn' + (organizing ? ' busy' : '') + '" id="mOrganize" title="' + (organizing ? t('meta.organizingTip') : t('meta.organizeTip', { kind: kindLabel(edNote.kind) || t('meta.kindNote') })) + '">' + icon('i-sparkle') + (organizing ? t('meta.organizing') : t('meta.organize')) + '</span>'
    + '<span class="meta-act" id="mDispatch" title="' + t('meta.dispatchTip') + '">' + icon('i-play') + t('meta.dispatch') + '</span>'
    + (n.sessionId ? '<span class="meta-act" id="mSrc" title="' + t('meta.sourceTip') + '">' + icon('i-ext') + t('meta.source') + '</span>' : '')
    /* 历史版本面板入口（notes-history-ui）：有版本时才显示（选中笔记后 notes-history 探测计数） */
    + ((histCount || 0) > 0 ? '<span class="meta-act" id="mHist" title="' + t('meta.histTip', { n: histCount }) + '">' + icon('i-clock') + t('meta.history') + '</span>' : '')
    + '<span class="meta-act' + (isPinned(n) ? ' on' : '') + '" id="mPin" title="' + (isPinned(n) ? t('meta.unpin') : t('meta.pin')) + '">' + icon('i-pin') + '</span>'
    + '<span class="meta-act danger" id="mDel" title="' + t('meta.delTip') + '">' + icon('i-trash') + '</span>'
    + spHtml;
  $('kindSel').onchange = function () { edNote.kind = this.value; triggerSave(); renderMeta(); renderTree() };
  $('statusSel').onchange = function () { edNote.status = this.value; triggerSave(); renderMeta(); renderTree() };
  $('mTopicInput').oninput = function () { edNote.topic = this.value; triggerSave() };
  $('mTagsInput').oninput = function () { edNote._tagsStr = this.value; triggerSave() };
  var mRoleEl = $('mRole');   /* kind=log 时注入开关不渲染（0.4.3⑦ 硬关 UI 化）——守卫防空指针 */
  if (mRoleEl) mRoleEl.querySelectorAll('.seg').forEach(function (seg) {
    seg.onclick = function () {
      var r = seg.getAttribute('data-role');
      if (r === role) return;
      /* 设为资料 = 先弹 whenToUse 挂载框（0.4.3 验收修复⑪：LLM 草稿预填，取消零副作用——不翻注入不落行；
         确认 = 弹层内 notes-mount 单点收口（落索引行 + host 同步翻 reference 档）→ onConfirm 回填编辑器三态并保存 */
      if (r === 'reference') {
        /* ⑫ 收尾对齐：开弹层前查 notes-mount-list 取 existing（client editor 同款）——已挂载进编辑模式预填现文案，非草稿观感；查询失败静默回退草稿 */
        rpc('notes-mount-list', {}).then(function (ml) {
          var line = ((ml && ml.lines) || []).filter(function (l) { return l.id === n.id })[0]
          openMountModal({ id: n.id, title: n.title, existing: line ? line.when : undefined }, function () {
            edNote.inject = true; edNote.injectRole = 'reference';
            if (!sessList.length) pullSessions();
            scopeOpen = true;
            triggerSave(); renderMeta();
            toast(t('meta.injectOn', { role: t('tree.roleReference') }));
          })
        }).catch(function () {
          openMountModal({ id: n.id, title: n.title }, function () {
            edNote.inject = true; edNote.injectRole = 'reference';
            if (!sessList.length) pullSessions();
            scopeOpen = true;
            triggerSave(); renderMeta();
            toast(t('meta.injectOn', { role: t('tree.roleReference') }));
          })
        });
        return;
      }
      if (r === 'off') { edNote.inject = false; scopeOpen = false }
      else { edNote.inject = true; edNote.injectRole = r; if (!sessList.length) pullSessions(); scopeOpen = true }
      triggerSave(); renderMeta();
      toast(r === 'off' ? t('meta.injectOff') : t('meta.injectOn', { role: r === 'reference' ? t('tree.roleReference') : t('tree.roleConvention') }));
    };
  });
  var trig = $('scopeTrig');
  if (trig) trig.onclick = function (ev) { ev.stopPropagation(); scopeOpen = !scopeOpen; if (scopeOpen && !sessList.length) pullSessions(); renderScopePanel() };
  /* 「目录可见」chip 已拆除（0.4.3 验收修复⑪：目录注入缺省关后开关无感知作用）；host recall 字段与目录过滤逻辑保留（chip 拆除≠字段退役，doSave 仍随 edNote 带上原值） */
  $('mSens').onclick = function () { edNote.sensitive = edNote.sensitive !== true; triggerSave(); renderMeta(); toast(edNote.sensitive === true ? t('meta.sensOn') : t('meta.sensOff')) };
  $('mHidden').onclick = function () { edNote.hidden = edNote.hidden !== true; triggerSave(); renderMeta(); toast(edNote.hidden === true ? t('meta.hiddenOn') : t('meta.hiddenOff')) };   /* 0.4.4-D：hidden chip 切换（纯 UI 遮罩字段，自动保存透传 notes-update） */
  $('mDispatch').onclick = function () { openDispatch() };
  /* P3 派发闭环徽章：点击展开派发历史并滚动到位 */
  var dBadge = $('mDispBadge');
  if (dBadge) dBadge.onclick = function () { var host = $('dispHost'); if (!host) return; host.dataset.open = '1'; renderDispatches(); try { host.scrollIntoView({ block: 'nearest' }) } catch (e) {} };
  $('mOrganize').onclick = function () { if (!organizing) doAiOrganize() };
  var src = $('mSrc');
  if (src) src.onclick = function () { toast(t('meta.sourceToast', { short: shortSid(edNote.sessionId), full: edNote.sessionId })) };
  /* 历史版本面板入口（无版本时入口不渲染，需守卫） */
  var mH = $('mHist');
  if (mH) mH.onclick = function () { openHistory() };
  $('mPin').onclick = function () { edNote.status = isPinned(edNote) ? 'active' : 'pinned'; triggerSave(); renderMeta(); renderTree(); toast(isPinned(edNote) ? t('meta.pinnedToast') : t('meta.unpinnedToast')) };
  $('mDel').onclick = function () { doDeleteNote(edNote.id) };
  /* 关联调度跳转（notes-034-sched-detail）：点击行进既有 selectNote 选中链路（目标必在 notes 缓存——关联清单数据源即缓存） */
  $('edMeta').querySelectorAll('.sched-peer').forEach(function (el) {
    el.onclick = function () { selectNote(el.getAttribute('data-sid')) };
  });
  /* 计划块原地操作（notes-041-sched-plan-edit）：编辑/暂停恢复/删除复用注入管理 doInjSched* handler（零复制逻辑）；
     操作后就地刷新——toggle：handler 内本地回写 enabled + renderMeta；del：清编辑器；edit：保存后 refreshSelected */
  $('edMeta').querySelectorAll('.sched-plan-act').forEach(function (el) {
    el.onclick = function () {
      var act = el.getAttribute('data-act');
      if (act === 'edit') doInjSchedEdit(n);
      else if (act === 'toggle') doInjSchedToggle(n);
      else if (act === 'del') doInjSchedDel(n);
    };
  });
  /* 执行记录跳转（notes-041-sched-runlog / 0.4.4-A 三表归一）：计划块「执行记录 ↗」→ openExecLog 打开执行记录笔记
     （软链统一 runLog：调度约定 schedule.runLog / 非调度顶层 runLog；缓存未命中由 selectNote open-by-id 兜底直开） */
  $('edMeta').querySelectorAll('.sched-runlog-act').forEach(function (el) {
    el.onclick = function () { openExecLog(el.getAttribute('data-rid')) };
  });
  /* 双模式两段开关点击（降级态点富文本段 → toast 原因，不切换） */
  var ms = $('modeSeg');
  if (ms) ms.querySelectorAll('.seg').forEach(function (seg) {
    seg.onclick = function () {
      var m = seg.getAttribute('data-m');
      if (m === 'rich' && seg.classList.contains('dis')) { toast(($('richTip') && $('richTip').textContent) || t('meta.richDegradedShort')); return; }
      switchMode(m);
    };
  });
  renderScopePanel();
}
/* ===== 定时派发·详情计划块（notes-034-sched-detail）：本笔记是 dispatch-schedule 约定 → meta 尾部「派发计划」块
   （频率人话/目标会话/下次触发/上次结果徽章/暂停态，与注入管理调度区同数据源 = notes-list slim 的 contractType/schedule 字段，零新 RPC）；
   关联调度清单 = 指向同一待办的其他调度（标题去「定时」前缀匹配，多调度同一待办可观察），点击跳转该约定笔记 ===== */
/* 关联匹配键：标题去「定时」前缀（排定创建时自动加的前缀，见派发弹窗 '定时 ' + title）+ trim */
function schedPeerKey(title) {
  return String(title || '').replace(/^定时\s*/, '').trim();
}
/* 关联调度清单：库内其他 dispatch-schedule 约定中匹配键相等者（双向视角：调度约定互见 sibling / 待办笔记见其全部调度） */
function relatedScheds(cur, list) {
  if (!cur) return [];
  var key = schedPeerKey(cur.title);
  if (!key) return [];
  return (list || []).filter(function (n) {
    return n.id !== cur.id && (n.contractType || '') === 'dispatch-schedule' && n.schedule && !n.deleted && schedPeerKey(n.title) === key;
  });
}
/* 计划块 + 关联清单 HTML（纯函数渲染器：无调度笔记返回空串 = 零 DOM 痕迹红线；徽章/下次触发复用注入管理 schedBadgeHtml/schedNextLabel 同口径） */
function schedPlanHtml(n, list) {
  if (!n) return '';
  var isSched = (n.contractType || '') === 'dispatch-schedule' && n.schedule;
  var peers = relatedScheds(n, list).slice(0, 5);   /* 关联清单 ≤5 条（防极端刷屏，注入管理总览看全量） */
  if (!isSched && !peers.length) return '';
  var h = '';
  if (isSched) {
    var s = n.schedule, paused = s.enabled === false;
    h += '<div class="sched-plan-row' + (paused ? ' paused' : '') + '">'
      + '<span class="sched-plan-t">' + icon('i-clock', 11) + t('meta.schedPlan') + '</span>'
      + '<span class="sched-freq">' + esc(schedFreqLabel(s)) + '</span>'
      + '<span class="sched-target" title="' + esc(s.target || '') + '">→ ' + esc(shortSid(s.target)) + '</span>'
      + '<span class="sched-nf">' + esc(schedNextLabel(n)) + '</span>'
      + schedBadgeHtml(n)
      + (paused ? '<span class="sched-badge off">' + t('meta.schedPaused') + '</span>' : '')
      /* 原地操作行（notes-041-sched-plan-edit）：编辑/暂停恢复/删除复用注入管理 doInjSched* handler（接线在 renderMeta .sched-plan-act，零新逻辑）；
         执行记录 ↗（notes-041-sched-runlog / 0.4.4-A）：runLog 软链存在时出跳转链接（接线在 renderMeta .sched-runlog-act；
         软链统一口径 = schedule.runLog || 顶层 runLog——手动派发先行建篇时指针在顶层），约定正文保持纯净 */
      + '<span class="sched-acts">'
      + (function () { var rlId = s.runLog || n.runLog || ''; return rlId ? '<button class="mbtn sched-act sched-runlog-act" data-rid="' + esc(rlId) + '" title="' + t('meta.runLogTip', { id: esc(rlId) }) + '">' + t('meta.runLog') + '</button>' : '' })()
      + '<button class="mbtn sched-act sched-plan-act" data-act="edit" title="' + t('meta.schedEditTip') + '">' + t('meta.edit') + '</button>'
      + '<button class="mbtn sched-act sched-plan-act" data-act="toggle" title="' + (paused ? t('meta.schedResumeTip') : t('meta.schedPauseTip')) + '">' + (paused ? t('meta.resume') : t('meta.pause')) + '</button>'
      + '<button class="mbtn sched-act sched-plan-act" data-act="del" title="' + t('meta.schedDelTip') + '">' + t('common.delete') + '</button>'
      + '</span>'
      + '</div>';
  }
  if (peers.length) {
    h += peers.map(function (p) {
      var ps = p.schedule, pp = ps.enabled === false;
      return '<div class="sched-plan-row sched-peer' + (pp ? ' paused' : '') + '" data-sid="' + esc(p.id) + '" title="' + t('meta.schedPeerTip', { name: esc(p.title || t('tree.untitled')) }) + '">'
        + '<span class="sched-plan-t">' + icon('i-clock', 11) + t('meta.schedPeer') + '</span>'
        + '<span class="sched-peer-t">' + esc(p.title || t('tree.untitled')) + '</span>'
        + '<span class="sched-freq">' + esc(schedFreqLabel(ps)) + '</span>'
        + '<span class="sched-nf">' + esc(schedNextLabel(p)) + '</span>'
        + (pp ? '<span class="sched-badge off">' + t('meta.schedPaused') + '</span>' : '')
        + '</div>';
    }).join('');
  }
  return h ? '<div class="sched-plan">' + h + '</div>' : '';
}
/* 关联调度兜底缓存（notes-034-sched-detail③）：notes slim 缓存常态即全量（调度约定是普通笔记，默认列表可见）；
   仅 log 型调度约定（front-matter 裸编辑旁路）被默认列表口径排除——会话级按需一次 includeLogs 补齐为 overlay，
   合并时 notes 优先（overlay 只补缓存外条目；会话级缓存不重取，log 型约定增删重开页面即新） */
var schedPeerCache = null, schedPeerTried = false;
function schedPeerSource() {
  if (!schedPeerCache) return notes;
  var inList = {}; notes.forEach(function (n) { inList[n.id] = true });
  return notes.concat(schedPeerCache.filter(function (n) { return !inList[n.id] }));
}
function ensureSchedPeers() {
  if (schedPeerTried) return;
  schedPeerTried = true;
  if (notes.some(function (n) { return (n.kind || 'note') === 'log' })) return;   /* 缓存已是 includeLogs 口径（含 log 行），主缓存即全量 */
  rpc('notes-list', { includeLogs: true }).then(function (res) {
    if (res && res.notes) { schedPeerCache = res.notes; if (edNote) renderMeta(); }
  }).catch(function () { });
}
/* 注入范围浮层（指定会话多选；缺省=所有会话，契约同面板 toggleScope） */
function renderScopePanel() {
  var hostEl = $('scopePanelHost');
  if (!hostEl) return;
  if (!scopeOpen || !edNote || !edNote.inject) { hostEl.innerHTML = ''; return }
  var scope = edNote.injectTo || [];
  var byWs = {};
  sessList.forEach(function (s) { var w = s.workspace || t('meta.wsOther'); (byWs[w] = byWs[w] || []).push(s) });
  sessPending.forEach(function (p) { var w = p.workspace || t('meta.wsOther'); (byWs[w] = byWs[w] || []).push({ id: p.id, short: p.short, name: '', pending: true }) });
  var wsKeys = Object.keys(byWs).sort();
  var h = '<div class="scope-panel">'
    + '<div class="scope-hint">' + t('meta.scopeHint') + '</div>';
  wsKeys.forEach(function (ws) {
    h += '<div class="scope-ws">' + esc(ws) + '</div>';
    byWs[ws].forEach(function (s) {
      h += '<label class="scope-item' + (s.pending ? ' dis' : '') + '"><input type="checkbox" data-scope="' + esc(s.short) + '"' + (!s.pending && scopeHas(scope, s.short) ? ' checked' : '') + (s.pending ? ' disabled' : '') + '> ' + (s.pending ? t('meta.scopePending', { short: esc(s.short) }) : esc(s.name || s.short)) + '</label>';
    });
  });
  hostEl.innerHTML = h + '</div>';
  hostEl.querySelectorAll('input[data-scope]').forEach(function (cb) {
    cb.onchange = function () { toggleScope(cb.dataset.scope) };
  });
}
function toggleScope(key) {
  var cur = (edNote.injectTo || []).filter(function (t) { return t !== 'global' && t !== 'workspace' });
  /* 归一比对（notes-034-injectto-norm）：勾选态以 scopeHas 为准（存量长 id 也算已勾选）；取消勾选连同长 id 存量一并移除，保存落短 id（host 侧另有写入归一兜底） */
  var next = scopeHas(cur, key) ? cur.filter(function (t) { return shortSid(t) !== key }) : cur.concat([key]);
  edNote.injectTo = next;
  triggerSave(); renderMeta(); scopeOpen = true; renderScopePanel();
}
function renderDispatches() {
  var host = $('dispHost'); if (!host || !edNote) return;
  var ds = edNote.dispatches || [];
  if (!ds.length) { host.innerHTML = ''; return }
  var open = host.dataset.open === '1';
  /* 0.4.4-A（notes-044-dispatch-receipts）三表归一：执行记录伴生笔记软链（调度约定 schedule.runLog / 非调度顶层 runLog）——
     派发历史行行尾「执行记录 ↗」按钮跳该笔记（openExecLog；缓存未命中由 selectNote open-by-id 兜底直开） */
  var execLogId = edNote.runLog || (edNote.schedule && edNote.schedule.runLog) || '';
  var h = '<div class="disp-t" id="dispT">' + (open ? '▼' : '▶') + ' ' + t('meta.dispHistory', { n: ds.length }) + '</div>';
  if (open) {
    ds.map(function (d, i) { return { d: d, i: i } }).reverse().forEach(function (r) {
      var d = r.d;
      h += '<div class="disp-rec' + (isDispDone(d) ? ' done' : '') + '"><div class="disp-rec-top">'
        + (isDispDone(d) ? '✓ ' : '<span class="dot"></span>') + esc(d.sessionName || d.sessionId)
        + '<span class="disp-rec-m">' + (isDispDone(d) ? t('meta.dispStDone') : t('meta.dispStPending')) + ' · ' + (d.mode === 'new' ? t('meta.dispNew') : (d.workspace || t('meta.dispExisting'))) + (d.at ? ' · ' + fmtDT(d.at) : '') + '</span></div>'
        + (d.instruction ? '<div class="disp-rec-i">' + t('meta.dispInstruction', { text: esc(d.instruction) }) + '</div>' : '')
        + (!isDispDone(d) ? '<button class="disp-done-btn" data-di="' + r.i + '">' + t('meta.dispMarkDone') + '</button>' : '')
        + (execLogId ? '<button class="disp-log-act" data-rid="' + esc(execLogId) + '" title="' + t('meta.runLogTip', { id: esc(execLogId) }) + '">' + t('meta.runLog') + '</button>' : '') + '</div>';
    });
  }
  host.innerHTML = h;
  $('dispT').onclick = function () { host.dataset.open = open ? '0' : '1'; renderDispatches() };
  host.querySelectorAll('.disp-done-btn').forEach(function (b) {
    b.onclick = function () {
      rpc('notes-dispatch-done', { id: edNote.id, dispatchIndex: Number(b.dataset.di) }).then(function (res) {
        if (res && res.error) { toast(res.error); return }
        toast(t('meta.dispMarkedDone')); refreshSelected(); loadNotes(true);
      }).catch(function (e) { toast(t('meta.opFailed', { msg: e && e.message || e })) });
    };
  });
  /* 0.4.4-A：派发历史行尾「执行记录 ↗」接线（→ 执行记录伴生笔记） */
  host.querySelectorAll('.disp-log-act').forEach(function (b) {
    b.onclick = function () { openExecLog(b.getAttribute('data-rid')) };
  });
}
/* 0.4.4-A（notes-044-dispatch-receipts）执行记录跳转共用入口：派发历史行尾按钮 + 计划块「执行记录 ↗」——
   走 selectNote 选中链路（0.4.4-A 起 selectNote 内置 open-by-id 兜底：缓存未命中 = 存量 sys 执行记录/在途新建，notes-get 直开不硬跳） */
function openExecLog(rid) {
  if (!rid) return;
  selectNote(rid);
}
function renderEdFoot() {
  var n = edNote; if (!n || !$('edCreated')) return;
  /* 草稿态（notes-034-batch3）：未落库时底栏显示草稿提示而非空时间戳 */
  $('edCreated').textContent = n.createdAt ? t('meta.createdAt', { time: fmtDT(n.createdAt) }) : t('meta.draftHint');
  $('edUpdated').textContent = n.updatedAt ? t('meta.updatedAt', { time: fmtDT(n.updatedAt) }) : '';
  $('edSource').textContent = n.sessionId ? t('meta.sourceSession', { short: shortSid(n.sessionId) }) : t('meta.sourcePage');
}
function refreshSelected() {
  if (!selId) return;
  /* 双模式：重建前先落盘富文本在途编辑（renderEd 会重建编辑器 DOM，不序列化则丢未回写内容） */
  if (edMode === 'rich' && richDirty) syncFromRich('刷新回填');
  var id = selId;
  rpc('notes-get', { id: id }).then(function (res) {
    if (res && res.error) throw new Error(res.error);   /* 显式抛错进 catch（读路径静默群修复；正文首载安全态由 loadEdBody 负责，此处为后台刷新） */
    if (res && res.note && selId === id) {
      var editing = document.activeElement && (document.activeElement === $('edSrc') || document.activeElement === $('edRich') || document.activeElement === $('edTitle'));
      var body = edNote ? edNote.body : '';
      edNote = res.note;
      if (editing) edNote.body = body;   /* 编辑中不覆盖正文（防焦点内回填顶掉击键） */
      degraded = analyzeMarkdown(edNote.body || '');
      renderEd();
    }
  }).catch(function (e) { toast(t('meta.refreshFailed', { msg: e && e.message || e })) })   /* 后台刷新失败非阻断：编辑器保持旧值但用户可见 */
}
function doDeleteNote(id) {
  /* 草稿态（notes-034-batch3）：删除按钮 = 丢弃草稿（从未落库，零残留、零 RPC） */
  if (draftNote) { draftNote = null; selId = null; edNote = null; renderTree(); renderEd(); toast(t('meta.draftDiscarded')); return }
  if (!id) return;
  rpc('notes-delete', { id: id }).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    if (selId === id) { selId = null; edNote = null; renderEd() }
    loadNotes(true);
    toast(t('meta.deleted'), {
      label: t('meta.undo'), fn: function () {
        rpc('notes-restore', { id: id }).then(function (r) {
          if (r && r.error) { toast(r.error); return }
          toast(t('meta.restored')); loadNotes(true);
        }).catch(function (e) { toast(t('meta.restoreFailed', { msg: e && e.message || e })) });
      }
    });
  }).catch(function (e) { toast(t('meta.deleteFailed', { msg: e && e.message || e })) });
}

