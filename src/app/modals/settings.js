/* ================= 设置 / 导出 / 导入 ================= */
/* 设置卡交互反馈（notes-settings-feedback）：✕ 常驻关闭 + dirty 跟踪「保存」（显式确认 + 兜底 flush）+「还原」回滚。
   dirty 判定口径 = 在途待写（setInflight>0）或 任一控件值 ≠ 打开时快照（setSnap）；
   自动保存（失焦/Enter/选择即存）零改动——「保存」按钮是显式确认 + 未落盘改动的兜底 flush，两者并存 */
var setSnap = null;      /* 打开时快照 {llmP,llmM,stale,maxDepth,budget,usageBudget,logWeek,logMonth}（字符串口径同控件值；0.4.4-E：catalog 目录补充行开关随功能整体拆除） */
var setPersist = null;   /* 已落盘镜像（兜底 flush/还原只写真不同的键） */
var setInflight = 0;     /* 在途设置写数（>0 = 存在尚未落盘的待写） */
var setSaving = false;   /* 保存/还原执行中（按钮防重入） */
function openSettings() {
  openModal('<div class="modal-t">' + icon('i-gear', 13) + ' ' + t('common.settings') + '<span class="set-t-acts"><button class="mbtn" id="setRestore" disabled>' + t('common.restore') + '</button><button class="mbtn primary" id="setSave" disabled>' + t('common.save') + '</button><button class="mbtn set-x" id="setClose" title="' + t('settings.closeTip') + '">' + icon('i-x', 11) + '</button></span></div><div id="setBody"><div class="modal-hint">' + t('common.loading') + '</div></div><div class="modal-err" id="mErr" style="display:none"></div>');
  modalCloseHook = flushSettingsPending;   /* ✕/Esc/点遮罩关闭前兜底 flush */
  setSnap = null; setPersist = null; setSaving = false;   /* dirty 基准复位（settings-get 返回后再捕获快照） */
  $('setClose').onclick = closeModalFlushed;
  $('setSave').onclick = doSettingsSaveAll;
  $('setRestore').onclick = doSettingsRestoreAll;
  rpc('notes-settings-get', {}).then(function (res) {
    if (!res || !$('setBody')) return;
    var settings = res.settings || {};
    var models = res.models || [];
    var l = settings.llm || null;
    /* 0.4.4-E：catalog 目录补充行总开关随功能整体拆除——设置卡无此控件（host 侧对旧设置键静默忽略，存量不迁移） */
    /* P1 注入增强：时效衰减提醒阈值（天，缺省 90，0=关闭）+ 注入体积预算（约/字符数，缺省 0=不限）+ 仪表（lastInjectChars） */
    var staleDays = typeof settings.staleDays === 'number' ? settings.staleDays : 90;
    /* 文件夹嵌套深度上限（maxFolderDepth，层；根级=第 1 层，缺省 3，0=不限） */
    var maxDepth = typeof settings.maxFolderDepth === 'number' ? settings.maxFolderDepth : 3;
    var budgetNum = typeof settings.injectBudgetChars === 'number' ? settings.injectBudgetChars : 0;
    /* LLM 月度用量预算提醒阈值（tokens/月，缺省 0=关闭；超预算仅 toast 不阻断） */
    var usageBudget = typeof settings.usageBudgetMonthly === 'number' ? settings.usageBudgetMonthly : 0;
    /* 工作记忆 v0 日志卫生窗口（天）：logWeekAfterDays 周聚合（缺省 7）/ logRetentionDays 月聚合（缺省 90，0=关闭本级） */
    var logWeekDays = typeof settings.logWeekAfterDays === 'number' ? settings.logWeekAfterDays : 7;
    var logRetentionDays = typeof settings.logRetentionDays === 'number' ? settings.logRetentionDays : 90;
    var lastChars = typeof res.lastInjectChars === 'number' ? res.lastInjectChars : 0;
    var gaugePct = budgetNum > 0 ? Math.min(100, Math.round(lastChars / budgetNum * 100)) : 0;
    /* dirty/还原基准（notes-settings-feedback）：打开时快照 + 已落盘镜像初始化（字符串口径同控件值） */
    setSnap = { llmP: l ? l.provider : '', llmM: l ? l.model : '', stale: String(staleDays), maxDepth: String(maxDepth), budget: String(budgetNum), usageBudget: String(usageBudget), logWeek: String(logWeekDays), logMonth: String(logRetentionDays) };
    setPersist = setSnap;
    var llmCtrl;
    if (models.length) {
      llmCtrl = '<select class="minput" id="setLlmSel">'
        + '<option value="">' + t('settings.followSession') + '</option>'
        + models.map(function (m) {
            var v = m.provider + '/' + m.model;
            return '<option value="' + esc(v) + '"' + (l && l.provider === m.provider && l.model === m.model ? ' selected' : '') + '>' + esc(m.label || v) + '</option>'
          }).join('') + '</select>';
    } else {
      llmCtrl = '<input class="minput" id="setLlmP" size="10" placeholder="provider" value="' + esc(l ? l.provider : '') + '">'
        + '<input class="minput" id="setLlmM" size="12" placeholder="model" value="' + esc(l ? l.model : '') + '">'
        + '<button class="mbtn" id="setLlmSave">' + t('common.save') + '</button>'
        + (l ? '<button class="mbtn" id="setLlmClear">' + t('settings.followBtn') + '</button>' : '');
    }
    $('setBody').innerHTML =
      /* onboarding 轻量（notes-034-batch3）：四概念一行一条前置解释（注入/约定·资料/目录注入/派发）——新用户先懂「为什么要配这些」再看字段 */
      '<div class="modal-hint"><b>' + t('settings.onboardTitle') + '</b><br>'
      + t('settings.onboardInject') + '<br>'
      + t('settings.onboardRoles') + '<br>'
      + t('settings.onboardCatalog') + '<br>'
      + t('settings.onboardDispatch') + '</div>'
      /* i18n 语言项（notes-042-i18n-mech）：localStorage 本地记忆、切换即生效（setLang 全量 render）；不走 settings.json，不参与 dirty 跟踪 */
      + '<div class="set-row"><div class="set-label">' + t('settings.language') + '<span class="s">' + t('settings.languageTip') + '</span></div><div class="set-ctrl"><select class="minput" id="setLang"><option value="zh">中文</option><option value="en">English</option></select></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.llm') + '<span class="s">' + t('settings.llmTip') + '</span></div><div class="set-ctrl">' + llmCtrl + '</div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.usage') + '<span class="s">' + t('settings.usageTip') + '</span></div><div class="set-ctrl usage" id="setUsageBody"><span class="s">' + t('common.loading') + '</span></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.usageBudget') + '<span class="s">' + t('settings.usageBudgetTip') + '</span></div><div class="set-ctrl"><input class="minput" id="setUsageBudget" type="number" min="0" step="1000" style="width:110px" value="' + usageBudget + '"></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.stale') + '<span class="s">' + t('settings.staleTip') + '</span></div><div class="set-ctrl"><input class="minput" id="setStale" type="number" min="0" step="1" style="width:90px" value="' + staleDays + '"></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.maxDepth') + '<span class="s">' + t('settings.maxDepthTip') + '</span></div><div class="set-ctrl"><input class="minput" id="setMaxDepth" type="number" min="0" step="1" style="width:90px" value="' + maxDepth + '"></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.budget') + '<span class="s">' + t('settings.budgetTip') + '</span>'
      + '<span class="s" id="setGaugeT">' + t('settings.gaugeCurrent', { last: lastChars }) + (budgetNum > 0 ? ' / ' + t('settings.gaugeBudget', { budget: budgetNum }) : t('settings.gaugeUnlimited')) + '</span>'
      + '<div style="height:6px;background:var(--nbg-raise);border:1px solid var(--nbd-soft);border-radius:4px;overflow:hidden;margin-top:4px"><div id="setGaugeBar" style="height:100%;width:' + gaugePct + '%;background:var(' + (budgetNum > 0 && lastChars > budgetNum ? '--ndanger' : '--nacc') + ');transition:width .3s"></div></div></div>'
      + '<div class="set-ctrl"><input class="minput" id="setBudget" type="number" min="0" step="100" style="width:110px" value="' + budgetNum + '"></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.injPreview') + '<span class="s">' + t('settings.injPreviewTip') + '</span></div><div class="set-ctrl"><button class="mbtn" id="setInjectPreview">' + t('settings.previewBtn') + '</button></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.injManager') + '<span class="s">' + t('settings.injManagerTip') + '</span></div><div class="set-ctrl"><button class="mbtn" id="setInjectManager">' + t('settings.manageBtn') + '</button></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.data') + '<span class="s">' + t('settings.dataTip') + '</span></div><div class="set-ctrl"><button class="mbtn" id="setExport">' + t('settings.exportAll') + '</button><button class="mbtn" id="setImport">' + t('settings.importBtn') + '</button><button class="mbtn" id="setTrash">' + t('topbar.trash') + '</button></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.assets') + '<span class="s">' + t('settings.assetsTip') + '</span></div><div class="set-ctrl"><button class="mbtn" id="setPrune">' + t('settings.pruneBtn') + '</button></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.suggest') + '<span class="s">' + t('settings.suggestTip') + '</span></div><div class="set-ctrl"><button class="mbtn" id="setSuggest">' + t('settings.openBtn') + '</button></div></div>'
      /* 工作记忆 v0「工作记忆」区：启用沉淀引导（约定笔记方案）+ 日志卫生两级窗口 */
      + '<div class="set-row"><div class="set-label">' + t('settings.memory') + '<span class="s">' + t('settings.memoryTip') + '</span></div><div class="set-ctrl" id="setMemoryCtrl"><span class="s">' + t('settings.memProbing') + '</span></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.logWeek') + '<span class="s">' + t('settings.logWeekTip') + '</span></div><div class="set-ctrl"><input class="minput" id="setLogWeek" type="number" min="0" step="1" style="width:90px" value="' + logWeekDays + '"></div></div>'
      + '<div class="set-row"><div class="set-label">' + t('settings.logMonth') + '<span class="s">' + t('settings.logMonthTip') + '</span></div><div class="set-ctrl"><input class="minput" id="setLogMonth" type="number" min="0" step="1" style="width:90px" value="' + logRetentionDays + '"></div></div>'
      /* 键盘流速查表入口（notes-034-f-cheatsheet）：内容与 panels/keyboard.js 逐键核对；? 键为直达通道 */
      + '<div class="set-row"><div class="set-label">' + t('settings.cheatsheet') + '<span class="s">' + t('settings.cheatsheetTip') + '</span></div><div class="set-ctrl"><button class="mbtn" id="setCheatsheet">' + t('settings.viewBtn') + '</button></div></div>';
    /* i18n 语言项（notes-042-i18n-mech + cov-c）：回显当前语言态；切换 = setLang 持久化 + 全量 render +
       本卡就地重渲染（render() 不重渲已开 modal：先兜底 flush 未落盘改动，重跑 openSettings 按新语言重建，
       滚动位置经 modalBackScroll 一次性还原——与二级面板返回同口径） */
    $('setLang').value = NOTES_LANG;
    $('setLang').onchange = function () { setLang(this.value); flushSettingsPending(); modalBackScroll = $('modal') ? $('modal').scrollTop : 0; openSettings() };
    var sel = $('setLlmSel');
    if (sel) sel.onchange = function () {
      var v = this.value;
      var p = v ? { provider: v.split('/')[0], model: v.split('/').slice(1).join('/') } : null;
      saveSettings({ llm: p }, p ? t('settings.savedLlm', { name: v }) : t('settings.restoredFollow'));
    };
    var sp = $('setLlmSave');
    if (sp) sp.onclick = function () {
      var pv = $('setLlmP').value.trim(), mv = $('setLlmM').value.trim();
      if (!pv || !mv) { modalErr(t('settings.llmRequired')); return }
      saveSettings({ llm: { provider: pv, model: mv } }, t('settings.savedLlm', { name: pv + ' / ' + mv }));
    };
    var sc = $('setLlmClear');
    if (sc) sc.onclick = function () { saveSettings({ llm: null }, t('settings.restoredFollow')); openSettings() };
    /* P1 时效衰减提醒阈值：失焦/Enter 即保存（非负整数；0 = 关闭；非法输入报错不落盘） */
    $('setStale').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.staleInvalid')); return }
      saveSettings({ staleDays: parseInt(v, 10) }, +v === 0 ? t('settings.staleOff') : t('settings.savedStale', { v: v }));
    };
    /* 文件夹嵌套深度上限：失焦/Enter 即保存（非负整数；0 = 不限层数；非法输入报错不落盘） */
    $('setMaxDepth').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.maxDepthInvalid')); return }
      saveSettings({ maxFolderDepth: parseInt(v, 10) }, +v === 0 ? t('settings.maxDepthUnlimited') : t('settings.savedMaxDepth', { v: v }));
    };
    /* P1 注入体积预算（约，字符数）：失焦/Enter 即保存（非负整数；0 = 不限） */
    $('setBudget').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.budgetInvalid')); return }
      saveSettings({ injectBudgetChars: parseInt(v, 10) }, +v === 0 ? t('settings.budgetOff') : t('settings.savedBudget', { v: v }));
    };
    $('setExport').onclick = function () { openExport() };
    $('setImport').onclick = function () { openImport() };
    $('setTrash').onclick = function () { openTrash() };
    $('setPrune').onclick = function () { openPrune() };
    $('setInjectPreview').onclick = function () { openInjectPreview() };
    $('setInjectManager').onclick = function () { openInjectManager('settings') };   /* from=settings：单层返回栈（notes-041-settings-back），关闭二级面板自动回本卡 */
    $('setSuggest').onclick = function () { openSuggest() };
    $('setCheatsheet').onclick = function () { openCheatsheet() };
    /* 工作记忆 v0：日志卫生窗口失焦即保存（非负整数；月聚合 0=关闭本级；非法输入报错不落盘） */
    $('setLogWeek').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.logWeekInvalid')); return }
      saveSettings({ logWeekAfterDays: parseInt(v, 10) }, t('settings.savedLogWeek', { v: v }));
    };
    $('setLogMonth').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.logMonthInvalid')); return }
      saveSettings({ logRetentionDays: parseInt(v, 10) }, +v === 0 ? t('settings.logMonthOff') : t('settings.savedLogMonth', { v: v }));
    };
    /* 工作记忆 v0 r3：沉淀引导状态行（单一事实源 = contractType: memory-guide（tag 兼容发现键）且 inject=true 的笔记；停用=关 inject，查看=跳转约定笔记） */
    rpc('notes-memory-guide', { op: 'status' }).then(function (st) { renderMemoryStatus(st && !st.error ? st : { enabled: false, noteId: '' }) }).catch(function () { renderMemoryStatus({ enabled: false, noteId: '' }) });
    /* LLM 月度用量预算提醒：失焦/Enter 即保存（非负整数；0 = 关闭） */
    $('setUsageBudget').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr(t('settings.usageBudgetInvalid')); return }
      usageBudget = parseInt(v, 10);
      saveSettings({ usageBudgetMonthly: usageBudget }, +v === 0 ? t('settings.usageBudgetOff') : t('settings.savedUsageBudget', { v: fmtTok(+v) }));
    };
    /* dirty 跟踪（notes-settings-feedback）：输入即刷新 保存/还原 按钮态（oninput 只刷新不落盘；失焦/Enter 即存的 onchange 链路不变） */
    ['setStale', 'setMaxDepth', 'setBudget', 'setUsageBudget', 'setLogWeek', 'setLogMonth', 'setLlmP', 'setLlmM'].forEach(function (id) { var el = $(id); if (el) el.oninput = setDirtyRefresh });
    setDirtyRefresh();
    /* 单层返回栈（notes-041-settings-back）：二级面板返回重开时还原离开时的滚动位置（一次性消费，随后清零防串档） */
    if (modalBackScroll > 0 && $('modal')) $('modal').scrollTop = modalBackScroll;
    modalBackScroll = 0;
    /* LLM 用量统计（notes-token-stats）：独立 RPC 填充用量区；超月度预算 toast 提醒（不阻断） */
    rpc('notes-usage-get', {}).then(function (u) {
      var ub = $('setUsageBody');
      if (!ub) return;
      if (!u || u.error) { ub.innerHTML = '<span class="s">' + t('settings.usageLoadFailed') + '</span>'; return }
      ub.innerHTML = '<span class="usage-line">' + t('settings.usageLine', { today: fmtTok(u.today.total), week: fmtTok(u.week.total), month: fmtTok(u.month.total), all: fmtTok(u.allTime.total) }) + (u.calls > 0 ? t('settings.usageCalls', { n: u.calls }) : '') + '</span>'
        + '<span class="s">' + t('settings.usageByFeature', { classify: fmtTok(u.byFeature.classify.allTime), organize: fmtTok(u.byFeature.organize.allTime), summarize: fmtTok(u.byFeature.summarize.allTime) }) + (u.estimatedTokens > 0 ? t('settings.usageEstimated') : '') + '</span>';
      if (usageBudget > 0 && u.month && u.month.total > usageBudget) toast(t('settings.usageOverBudget', { used: fmtTok(u.month.total), budget: fmtTok(usageBudget) }));
    }).catch(function () { var ub = $('setUsageBody'); if (ub) ub.innerHTML = '<span class="s">' + t('settings.usageLoadFailed') + '</span>' });
  }).catch(function (e) { modalErr(t('settings.loadFailed', { msg: e && e.message || e })) });
}
function saveSettings(patch, okMsg) {
  setInflight++; setDirtyRefresh();
  rpc('notes-settings-set', patch).then(function (res) {
    if (res && res.error) { modalErr(res.error); return }
    setPersistMerge(patch);
    if (okMsg) toast(okMsg);
  }).catch(function (e) { modalErr(t('common.saveFailed', { msg: e && e.message || e })) }).then(function () { setInflight--; setDirtyRefresh() });
}
/* ===== 设置卡交互反馈（notes-settings-feedback）：dirty 状态机 + 显式保存 / 还原 / 关闭兜底 flush ===== */
/* dirty 判定：在途待写 > 0 或 任一控件值 ≠ 打开时快照 */
function setDirtyCompute() {
  if (!setSnap) return false;
  if (setInflight > 0) return true;
  if ($('setLlmSel') && $('setLlmSel').value !== (setSnap.llmP && setSnap.llmM ? setSnap.llmP + '/' + setSnap.llmM : '')) return true;
  if ($('setLlmP') && ($('setLlmP').value.trim() !== setSnap.llmP || $('setLlmM').value.trim() !== setSnap.llmM)) return true;
  var nums = [['setStale', 'stale'], ['setMaxDepth', 'maxDepth'], ['setBudget', 'budget'], ['setUsageBudget', 'usageBudget'], ['setLogWeek', 'logWeek'], ['setLogMonth', 'logMonth']];
  for (var i = 0; i < nums.length; i++) { var el = $(nums[i][0]); if (el && String(el.value).trim() !== setSnap[nums[i][1]]) return true }
  return false;
}
/* dirty 状态机出口：保存（accent 实心主按钮）/还原（次按钮）enabled ⇄ disabled 灰显 */
function setDirtyRefresh() {
  var d = setDirtyCompute();
  var sv = $('setSave'), rs = $('setRestore');
  if (sv) sv.disabled = !d || setSaving;
  if (rs) rs.disabled = !d || setSaving;
}
/* 已落盘镜像逐键跟进（settings-set 成功后才调） */
function setPersistMerge(patch) {
  if (!setPersist) return;
  var n = {}, k;
  for (k in setPersist) n[k] = setPersist[k];
  if ('llm' in patch) { n.llmP = patch.llm ? patch.llm.provider : ''; n.llmM = patch.llm ? patch.llm.model : '' }
  if ('staleDays' in patch) n.stale = String(patch.staleDays);
  if ('maxFolderDepth' in patch) n.maxDepth = String(patch.maxFolderDepth);
  if ('injectBudgetChars' in patch) n.budget = String(patch.injectBudgetChars);
  if ('usageBudgetMonthly' in patch) n.usageBudget = String(patch.usageBudgetMonthly);
  if ('logWeekAfterDays' in patch) n.logWeek = String(patch.logWeekAfterDays);
  if ('logRetentionDays' in patch) n.logMonth = String(patch.logRetentionDays);
  setPersist = n;
}
/* 低层写通道（保存/还原/关闭兜底 flush 共用）：不逐键 toast，错误 reject 透传；在途计数 + 已落盘镜像跟进 */
function settingsSetQuiet(patch) {
  setInflight++; setDirtyRefresh();
  return rpc('notes-settings-set', patch).then(function (res) {
    if (res && res.error) throw new Error(res.error);
    setPersistMerge(patch);
    return res;
  }).then(function (r) { setInflight--; setDirtyRefresh(); return r }, function (e) { setInflight--; setDirtyRefresh(); throw e });
}
/* 数值字段登记表（DOM id ↔ 快照键 ↔ 设置 RPC 键 ↔ 校验文案 i18n key）：保存校验/兜底 flush/还原回滚共用同一份口径；
   第 4 列为字典 key（用时 t() 取当下语言——模块级登记表在加载期求值，不能直接存译文） */
var SET_NUM_FIELDS = [
  ['setStale', 'stale', 'staleDays', 'settings.staleInvalid'],
  ['setMaxDepth', 'maxDepth', 'maxFolderDepth', 'settings.maxDepthInvalid'],
  ['setBudget', 'budget', 'injectBudgetChars', 'settings.budgetInvalid'],
  ['setUsageBudget', 'usageBudget', 'usageBudgetMonthly', 'settings.usageBudgetInvalid'],
  ['setLogWeek', 'logWeek', 'logWeekAfterDays', 'settings.logWeekInvalid'],
  ['setLogMonth', 'logMonth', 'logRetentionDays', 'settings.logMonthInvalid'],
];
/* 当前控件值 → 快照对象（保存成功后快照跟进用） */
function setSnapFromControls() {
  var s = { llmP: '', llmM: '', stale: '', maxDepth: '', budget: '', usageBudget: '', logWeek: '', logMonth: '' };
  if ($('setLlmSel')) { var v = $('setLlmSel').value; s.llmP = v ? v.split('/')[0] : ''; s.llmM = v ? v.split('/').slice(1).join('/') : '' }
  if ($('setLlmP')) { s.llmP = $('setLlmP').value.trim(); s.llmM = $('setLlmM').value.trim() }
  for (var i = 0; i < SET_NUM_FIELDS.length; i++) { var el = $(SET_NUM_FIELDS[i][0]); if (el) s[SET_NUM_FIELDS[i][1]] = String(el.value).trim() }
  return s;
}
/* 「保存」：显式确认 + 兜底 flush——先校验全部数值字段（任一非法即中止并报错，改动保留继续编辑），
   再串行落盘全部「控件值 ≠ 已落盘」的键（串行防写竞态），全部成功后快照跟进 + toast「设置已保存」+ dirty 复位 */
function doSettingsSaveAll() {
  if (setSaving || !setSnap || !setPersist) return;
  var i, el, v;
  for (i = 0; i < SET_NUM_FIELDS.length; i++) { el = $(SET_NUM_FIELDS[i][0]); if (el && !/^\d+$/.test(String(el.value).trim())) { modalErr(t(SET_NUM_FIELDS[i][3])); return } }
  var patches = [];
  /* 手输 LLM 两框齐备且 ≠ 已落盘才补写（下拉选择/开关变更即存无待写；单框不齐 = 存量失焦口径静默跳过） */
  if ($('setLlmP')) {
    var pv = $('setLlmP').value.trim(), mv = $('setLlmM').value.trim();
    if (pv && mv && (pv !== setPersist.llmP || mv !== setPersist.llmM)) patches.push({ llm: { provider: pv, model: mv } });
  }
  for (i = 0; i < SET_NUM_FIELDS.length; i++) {
    el = $(SET_NUM_FIELDS[i][0]); if (!el) continue;
    v = String(el.value).trim();
    if (v !== setPersist[SET_NUM_FIELDS[i][1]]) { var o = {}; o[SET_NUM_FIELDS[i][2]] = parseInt(v, 10); patches.push(o) }
  }
  setSaving = true; setDirtyRefresh();
  var seq = Promise.resolve();
  patches.forEach(function (p) { seq = seq.then(function () { return settingsSetQuiet(p) }) });
  seq.then(function () {
    setSaving = false;
    setSnap = setSnapFromControls();   /* 快照跟进到当前控件值（显式确认完成 → dirty 复位，保存按钮回禁用态） */
    toast(t('settings.savedAll'));
    setDirtyRefresh();
  }, function (e) { setSaving = false; modalErr(t('common.saveFailed', { msg: e && e.message || e })); setDirtyRefresh() });
}
/* 「还原」：回滚到打开时快照——已落盘 ≠ 快照的键逐键串行写回（逐键恢复），全部控件复位到快照值 */
function doSettingsRestoreAll() {
  if (setSaving || !setSnap || !setPersist) return;
  var s = setSnap, p = setPersist;
  var patches = [];
  if (p.llmP !== s.llmP || p.llmM !== s.llmM) patches.push({ llm: (s.llmP && s.llmM) ? { provider: s.llmP, model: s.llmM } : null });
  for (var i = 0; i < SET_NUM_FIELDS.length; i++) { if (p[SET_NUM_FIELDS[i][1]] !== s[SET_NUM_FIELDS[i][1]]) { var o = {}; o[SET_NUM_FIELDS[i][2]] = parseInt(s[SET_NUM_FIELDS[i][1]], 10); patches.push(o) } }
  setSaving = true; setDirtyRefresh();
  var seq = Promise.resolve();
  patches.forEach(function (pt) { seq = seq.then(function () { return settingsSetQuiet(pt) }) });
  seq.then(function () {
    setSaving = false;
    /* UI 复位到打开时快照 */
    if ($('setLlmSel')) $('setLlmSel').value = (s.llmP && s.llmM) ? s.llmP + '/' + s.llmM : '';
    if ($('setLlmP')) { $('setLlmP').value = s.llmP; $('setLlmM').value = s.llmM }
    for (var i = 0; i < SET_NUM_FIELDS.length; i++) { var el = $(SET_NUM_FIELDS[i][0]); if (el) el.value = s[SET_NUM_FIELDS[i][1]] }
    toast(t('settings.restoredAll'));
    setDirtyRefresh();
  }, function (e) { setSaving = false; modalErr(t('settings.restoreFailed', { msg: e && e.message || e })); setDirtyRefresh() });
}
/* 关闭兜底 flush（✕/Esc/点遮罩同口径，modalCloseHook 挂接）：「控件值 ≠ 已落盘」的有效改动串行静默落盘；
   非法输入按存量口径丢弃（同关闭即弃）；≥1 项落盘则 toast 一次确认 */
function flushSettingsPending() {
  if (!setPersist || !$('setBody')) return;
  var patches = [];
  if ($('setLlmP')) {
    var pv = $('setLlmP').value.trim(), mv = $('setLlmM').value.trim();
    if (pv && mv && (pv !== setPersist.llmP || mv !== setPersist.llmM)) patches.push({ llm: { provider: pv, model: mv } });
  }
  for (var i = 0; i < SET_NUM_FIELDS.length; i++) {
    var el = $(SET_NUM_FIELDS[i][0]); if (!el) continue;
    var v = String(el.value).trim();
    if (/^\d+$/.test(v) && v !== setPersist[SET_NUM_FIELDS[i][1]]) { var o = {}; o[SET_NUM_FIELDS[i][2]] = parseInt(v, 10); patches.push(o) }
  }
  if (!patches.length) return;
  var seq = Promise.resolve();
  patches.forEach(function (p) { seq = seq.then(function () { return settingsSetQuiet(p) }) });
  seq.then(function () { toast(t('settings.savedAll')) }, function (e) { toast(t('settings.flushSaveFailed', { msg: e && e.message || e })) });
}
