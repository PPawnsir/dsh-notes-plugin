/* ================= 派发（notes-active-sessions + notes-dispatch；页面无 workspaces 服务，仅已有会话） ================= */
/* 定时派发·设置交互（notes-034-sched-ui）：派发弹窗扩展「调度」区——默认收起 = 立即派发（手动派发路径零改动）；
   「定时执行」展开频率设置（每天/每周/每 N 天/仅一次+时间），确认排定 = 创建 contractType=dispatch-schedule 约定笔记
   （标题自动「定时 」前缀，front-matter 写 schedule 声明，正文 = 原待办正文 + 补充指令——即被派发的工作内容本身）+ toast「已排定，下次：X」；
   编辑模式（注入管理「调度任务」区 [编辑] 进入）= 同弹窗回填既有声明，保存走 notes-update（机器状态字段由 host 写入闸门延续）。
   锚定时刻（notes-034-sched-time）：周期三模式各补时刻选择（time input，默认 09:00）——声明携 anchor:'HH:MM'
   （触发序列钉死本地时刻，不随创建时间漂移）；「每周」另加星期几选择（dow 0-6）；仅一次保持 datetime-local 不变。
   校验内联报错（at 未来 / N≥1 / 目标必选；host 红线回显同口径）——禁原生 prompt（R1 反面教材 n-mut46q00c3yw）
   专属会话模型档位（0.4.6-G，notes-046-sched-model）：专属会话复选框勾选时出模型下拉（数据源 = notes-settings-get 的
   models 清单通道，与设置卡同通道零新 RPC；清单缺席 → 下拉隐藏静默降级），选中值以 provider/model 拆分随声明提交
   （缺省空 = 跟随宿主默认选择）；编辑模式回填 s.provider/s.model（清单外存量值补合成条目防丢档）
   专属会话权限预设（0.4.7，notes-047-sched-preset，主窗口裁决「显示层显式化」）：专属会话勾选时出权限下拉——
   恒两档具体值 完全权限（danger-full-access）/ 受限（workspace-write），无「继承默认」概念；打开弹窗预填 = 当前 defaultPreset
   对应档（数据源 = notes-settings-get 响应的 permissionPresets 键，与模型清单同一次调用零新 RPC；读不到 → 预填完全权限兜底）；
   勾选专属会话创建时 preset 键总是显式落盘；编辑模式回填存量 preset（存量无键 = 按 defaultPreset 预填显示，保存才显式化——
   显示层显式化、存储层零迁移）；编辑模式存量 preset 防丢档透传（同 model 先例） */
var dState = null;
var schedModelsCache = null;   /* 模型清单会话级缓存（0.4.6-G）：开弹窗即取缓存渲染，后台刷新对齐 host */
var schedPresetCache = null;   /* 默认权限预设会话级缓存（0.4.7）：settings-get 响应 permissionPresets.defaultPreset；读不到 → null（预填兜底完全权限） */
/* 权限下拉预填值（0.4.7 显示层显式化）：存量声明 preset 优先（编辑态回填）；缺省 = 宿主默认档映射；读不到 → 完全权限兜底 */
function schedPresetPrefill(editSched) {
  var p = editSched && editSched.preset;
  if (p === 'workspace-write' || p === 'danger-full-access') return p;
  return schedPresetCache || 'danger-full-access';
}
function openDispatch() {
  if (draftNote) { toast(t('disp.draftNotSaved')); return }   /* 草稿无真实 id（notes-034-batch3） */
  if (!edNote || !selId) { toast(t('editor.selectNoteFirst')); return }
  dState = { sessId: '', instr: '', pending: false, sessions: [], pendingSess: [], sched: false, schedMode: 'daily', schedN: 3, schedAt: '', editId: '', editNote: null, schedAnchor: '09:00', schedDow: 1, schedNew: false, schedModel: '', schedModels: schedModelsCache || [], schedPreset: schedPresetPrefill(null) };
  pullActiveSessions();
  pullSchedModels();
  renderDispatchModal();
}
/* 编辑模式入口（注入管理「调度任务」区 [编辑]）：同弹窗回填既有声明；note = 调度约定笔记 slim（列表已含 schedule，零新 RPC）；
   0.4.4-B：target='new'（专属会话）回填 schedNew 复选框（级联选择无对应真实条目，sessId 留空） */
function openDispatchEdit(note) {
  if (!note || !note.schedule) { toast(t('disp.noSchedule')); return }
  var s = note.schedule;
  var isNew = s.target === 'new';
  /* 0.4.6-G：模型档位回填（provider/model 成对落库 → 合成 provider/model 选中值；缺省空 = 跟随宿主默认）；
     0.4.7：权限档位回填——存量 preset 优先；存量无键按宿主默认档预填显示（显示层显式化、存储层零迁移：保存才落键） */
  dState = { sessId: isNew ? '' : (s.target || ''), instr: '', pending: false, sessions: [], pendingSess: [], sched: true, schedMode: 'daily', schedN: 3, schedAt: '', editId: note.id, editNote: note, schedAnchor: '09:00', schedDow: 1, schedNew: isNew, schedModel: (s.provider && s.model) ? s.provider + '/' + s.model : '', schedModels: schedModelsCache || [], schedPreset: schedPresetPrefill(s) };
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
  pullSchedModels();
  renderDispatchModal();
}
/* 模型清单拉取（0.4.6-G）：notes-settings-get 的 models 通道（设置卡同款，零新 RPC）；
   通道缺席/失败 → schedModels 空 → 下拉隐藏（静默降级红线） */
function pullSchedModels() {
  rpc('notes-settings-get', {}).then(function (res) {
    if (!res || !dState) return;
    if (res.models && res.models.length) { schedModelsCache = res.models; dState.schedModels = res.models; renderSchedModelSel() }
    /* 0.4.7：同一响应的 permissionPresets.defaultPreset 通道（零新 RPC）——权限下拉预填刷新：
       仅当当前值仍是上次预填基准（用户未改离）且非「编辑态存量 preset」时跟随宿主默认（存量声明显式值优先，防丢档优先级最高） */
    var dp = res.permissionPresets && res.permissionPresets.defaultPreset;
    var v = (dp === 'workspace-write' || dp === 'danger-full-access') ? dp : 'danger-full-access';
    var prev = schedPresetCache; schedPresetCache = v;
    if (dState && !(dState.editNote && dState.editNote.schedule && dState.editNote.schedule.preset) && dState.schedPreset === (prev || 'danger-full-access')) { dState.schedPreset = v; renderSchedPresetSel() }
  }).catch(function () { /* 静默降级红线（0.4.6-G）：清单通道缺席/传输失败 → 下拉保持隐藏，不打扰派发主链路（R1③ 设计内静默点） */ });
}
/* 权限下拉渲染（0.4.7，notes-047-sched-preset）：专属会话勾选 + 周期模式即显示（数据源 = 静态两档 + defaultPreset 预填，
   无清单依赖不随 models 缺席降级——可见性缺口补全的常驻入口）；恒两档具体值，无「继承默认」选项 */
function renderSchedPresetSel() {
  var box = $('dSchedPresetBox'); if (!box || !dState) return;
  var show = dState.schedNew && dState.schedMode !== 'once';
  box.style.display = show ? '' : 'none';
  if (!show) { box.innerHTML = ''; return }
  box.innerHTML = '<select class="minput sched-sel" id="dSchedPreset" title="' + esc(t('disp.schedPresetTip')) + '">'
    + '<option value="danger-full-access"' + (dState.schedPreset === 'danger-full-access' ? ' selected' : '') + '>' + esc(t('disp.schedPresetFull')) + '</option>'
    + '<option value="workspace-write"' + (dState.schedPreset === 'workspace-write' ? ' selected' : '') + '>' + esc(t('disp.schedPresetRestricted')) + '</option>'
    + '</select>';
  $('dSchedPreset').onchange = function () { dState.schedPreset = this.value };
}
/* 模型下拉渲染（0.4.6-G）：专属会话勾选 + 周期模式 + 清单非空三条件齐备才显示（缺一隐藏，静默降级）；
   存量声明值不在清单内（模型已下架等）→ 补合成条目回显防丢档 */
function renderSchedModelSel() {
  var box = $('dSchedModelBox'); if (!box || !dState) return;
  var show = dState.schedNew && dState.schedMode !== 'once' && dState.schedModels.length > 0;
  box.style.display = show ? '' : 'none';
  if (!show) { box.innerHTML = ''; return }
  var opts = '<option value="">' + esc(t('disp.schedModelDefault')) + '</option>';
  var seen = {};
  dState.schedModels.forEach(function (m) {
    var v = m.provider + '/' + m.model; seen[v] = true;
    opts += '<option value="' + esc(v) + '"' + (dState.schedModel === v ? ' selected' : '') + '>' + esc(m.label || v) + '</option>';
  });
  if (dState.schedModel && !seen[dState.schedModel]) opts += '<option value="' + esc(dState.schedModel) + '" selected>' + esc(dState.schedModel) + '</option>';
  box.innerHTML = '<select class="minput sched-sel" id="dSchedModel" title="' + esc(t('disp.schedModelTip', { model: dState.schedModel || t('disp.schedModelDefault') })) + '">' + opts + '</select>';
  $('dSchedModel').onchange = function () { dState.schedModel = this.value };
}
/* 0.4.7-B⑤：无界面提示行显隐收敛点（勾选专属会话 + 非「仅一次」才显示——与模型/权限下拉同口径联动） */
function renderSchedNewHint() {
  var h = $('dSchedNewHint'); if (!h || !dState) return;
  h.style.display = (dState.schedNew && dState.schedMode !== 'once') ? '' : 'none';
}
function pullActiveSessions() {
  rpc('notes-active-sessions', {}).then(function (res) {
    if (!res || !dState) return;
    if (res.error) throw new Error(res.error);   /* 显式抛错进 catch（读路径静默群修复） */
    if (res.sessions) dState.sessions = res.sessions;
    /* 编辑模式：目标会话不在活跃清单时补一条合成条目（原目标保持可选；host 落库仍校验存活红线，非 live 只影响执行时刻）；
       0.4.4-B：专属会话编辑态 sessId 为空（schedNew 复选框承载），天然跳过合成条目 */
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
    /* 专属会话（0.4.4-B）：周期模式可勾 target='new'——首轮触发 host 自动创建「定时 · 任务名」会话并回写复用；仅一次（at）无复用场景不提供 */
    + '<label class="sched-opt" id="dSchedNewBox"' + (dState.schedMode === 'once' ? ' style="display:none"' : '') + '><input type="checkbox" id="dSchedNew"' + (dState.schedNew ? ' checked' : '') + '> ' + t('disp.schedNew') + '</label>'
    /* 0.4.7-B⑤（notes-047-ux）：专属会话无界面提示行（实测教训：专属会话无 browser_* 等 GUI 附着工具）——勾选即见 */
    + '<div class="sched-new-hint" id="dSchedNewHint"' + (dState.schedNew && dState.schedMode !== 'once' ? '' : ' style="display:none"') + '>' + t('disp.schedNewHint') + '</div>'
    /* 专属会话模型下拉宿主（0.4.6-G）：勾选专属会话且清单非空才显示（renderSchedModelSel 驱动，静默降级） */
    + '<span id="dSchedModelBox" style="display:none"></span>'
    /* 专属会话权限下拉宿主（0.4.7）：勾选专属会话即显示（renderSchedPresetSel 驱动，无清单依赖常显） */
    + '<span id="dSchedPresetBox" style="display:none"></span>'
    + '</div></div>'
    /* 专属会话勾选后隐藏级联选择（目标由 host 首轮创建，无既有会话可选） */
    + '<div id="dispSessHostWrap"' + (dState.schedNew && (dState.sched || dState.editId) ? ' style="display:none"' : '') + '><div id="dispSessHost"></div></div>'
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
    /* 专属会话复选框仅周期模式提供（host 闸门同口径拒绝 at+'new'）；切到仅一次时自动摘勾并还原生态位 */
    $('dSchedNewBox').style.display = this.value === 'once' ? 'none' : '';
    if (this.value === 'once' && dState.schedNew) { dState.schedNew = false; $('dSchedNew').checked = false; $('dispSessHostWrap').style.display = ''; }
    renderSchedModelSel();   /* 0.4.6-G：模式切换联动模型下拉显隐（仅一次无专属会话 → 同隐） */
    renderSchedPresetSel();   /* 0.4.7：模式切换联动权限下拉显隐（同模型下拉口径） */
    renderSchedNewHint();   /* 0.4.7-B⑤：提示行同口径联动 */
    renderSchedNext();
  };
  $('dSchedNew').onchange = function () { dState.schedNew = this.checked; $('dispSessHostWrap').style.display = this.checked ? 'none' : ''; renderSchedModelSel(); renderSchedPresetSel(); renderSchedNewHint(); };   /* 0.4.6-G：勾选专属会话才出模型下拉；0.4.7：同出权限下拉；0.4.7-B⑤：同出无界面提示行 */
  $('dSchedN').oninput = function () { dState.schedN = this.value; renderSchedNext() };
  $('dSchedDow').onchange = function () { dState.schedDow = parseInt(this.value, 10); renderSchedNext() };
  $('dSchedAnchor').oninput = function () { dState.schedAnchor = this.value; renderSchedNext() };
  $('dSchedOnce').oninput = function () { dState.schedAt = this.value; renderSchedNext() };
  renderSchedNext();
  renderSchedModelSel();   /* 0.4.6-G：编辑模式回填/缓存清单就位时首轮渲染 */
  renderSchedPresetSel();   /* 0.4.7：权限下拉首轮渲染（预填态就位） */
  renderSchedNewHint();   /* 0.4.7-B⑤：提示行首轮渲染（编辑态回填 schedNew 情形；markup 内联初态同款口径双保险） */
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
/* 声明 → 下次触发毫秒（轮询锚点 = lastFiredAt || declaredAt || createdAt || now（0.4.6-F 声明重锚）；锚定时刻声明 = 锚定序列下一时刻，与 host schedDueAt 同口径；编辑模式传入 editNote 取存量锚点） */
function schedDeclNextMs(decl, note) {
  if (decl.at) return Date.parse(decl.at);
  var firedMs = 0;
  if (note && note.schedule && note.schedule.lastFiredAt) { var f = Date.parse(note.schedule.lastFiredAt); if (isFinite(f)) firedMs = f }
  var declaredMs = 0;
  if (!firedMs && note && note.schedule && note.schedule.declaredAt) { var dd = Date.parse(note.schedule.declaredAt); if (isFinite(dd)) declaredMs = dd }
  var base = firedMs || declaredMs;
  if (!base && note && note.createdAt) { var c = Date.parse(note.createdAt); if (isFinite(c)) base = c }
  if (!base) base = Date.now();
  var iv = schedEveryMs(decl.every);
  if (decl.anchor) { var nx = schedAnchorNextMs(decl.anchor, typeof decl.dow === 'number' ? decl.dow : undefined, iv, base, !!firedMs, Date.now()); if (nx !== null) return nx }
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
  /* 0.4.4-B：专属会话勾选（schedNew，仅定时形态）免选既有会话（target='new'，首轮触发 host 自动创建） */
  if (!dState.sessId && !(dState.schedNew && (dState.sched || dState.editId))) { modalErr(t('disp.needSession')); return }
  var sess = dState.sessions.find(function (s) { return s.id === dState.sessId });
  /* 定时执行 / 编辑排定分支（notes-034-sched-ui）：创建/更新 dispatch-schedule 约定笔记（表单与 front-matter 同源，无第二份存储） */
  if (dState.sched || dState.editId) {
    var f = schedFormDecl();
    if (f.err) { modalErr(f.err); return }
    var editId = dState.editId;
    /* 编辑保留原 enabled 态（暂停的任务改排定不被意外拉起）；创建默认 enabled=true；周期模式携锚定时刻 anchor/dow（notes-034-sched-time） */
    var decl = { target: dState.schedNew ? 'new' : dState.sessId, action: 'dispatch', enabled: editId ? (dState.editNote.schedule.enabled !== false) : true };
    if (f.decl.at) decl.at = f.decl.at; else { decl.every = f.decl.every; decl.anchor = f.decl.anchor; if (typeof f.decl.dow === 'number') decl.dow = f.decl.dow }
    /* 0.4.6-G：专属会话 + 已选模型档位 → 声明携 provider/model（成对；缺省空 = 跟随宿主默认，声明零字段）；
       编辑模式保留存量档位（首轮回写后 target=真实 sid、复选框摘勾下拉隐藏，schedModel 仍持回填值——表单与 front-matter 同源，防丢档同 anchor/dow 先例） */
    if (dState.schedModel && (dState.schedNew || editId)) { var mp = dState.schedModel.split('/'); decl.provider = mp[0]; decl.model = mp.slice(1).join('/') }
    /* 0.4.7（notes-047-sched-preset）：专属会话勾选 → preset 键总是显式落盘（恒具体两档，无 inherit——显示层显式化裁决）；
       编辑模式存量 preset 防丢档透传（下拉已隐时原值回传，同 model 先例）；存量无键且未勾专属 → 不落键（存储层零迁移） */
    if (dState.schedNew) decl.preset = dState.schedPreset;
    else if (editId && dState.editNote.schedule.preset) decl.preset = dState.editNote.schedule.preset;
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
    /* 0.4.4-B 休眠送达：queued 时提示排队语义（页面本无打开会话能力，休眠目标由 host 持久化排队、下次活动送达） */
    toast(t(res && res.queued ? 'disp.dispatchedQueued' : 'disp.dispatched', { name: sess ? sess.name : '' }));
    refreshSelected(); loadNotes(true);
  }).catch(function (e) {
    dState.pending = false; modalErr(t('disp.failed', { msg: e && e.message || e }));
    $('dOk').disabled = false; $('dOk').textContent = t('disp.ok');
  });
}
