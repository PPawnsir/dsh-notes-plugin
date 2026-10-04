/* ================= 设置 / 导出 / 导入 ================= */
/* 设置卡交互反馈（notes-settings-feedback）：✕ 常驻关闭 + dirty 跟踪「保存」（显式确认 + 兜底 flush）+「还原」回滚。
   dirty 判定口径 = 在途待写（setInflight>0）或 任一控件值 ≠ 打开时快照（setSnap）；
   自动保存（失焦/Enter/选择即存）零改动——「保存」按钮是显式确认 + 未落盘改动的兜底 flush，两者并存 */
var setSnap = null;      /* 打开时快照 {llmP,llmM,catalog,stale,maxDepth,budget,usageBudget,logWeek,logMonth}（字符串口径同控件值） */
var setPersist = null;   /* 已落盘镜像（兜底 flush/还原只写真不同的键） */
var setInflight = 0;     /* 在途设置写数（>0 = 存在尚未落盘的待写） */
var setSaving = false;   /* 保存/还原执行中（按钮防重入） */
function openSettings() {
  openModal('<div class="modal-t">' + icon('i-gear', 13) + ' 设置<span class="set-t-acts"><button class="mbtn" id="setRestore" disabled>还原</button><button class="mbtn primary" id="setSave" disabled>保存</button><button class="mbtn set-x" id="setClose" title="关闭（Esc；有未落盘改动先自动 flush）">' + icon('i-x', 11) + '</button></span></div><div id="setBody"><div class="modal-hint">加载中…</div></div><div class="modal-err" id="mErr" style="display:none"></div>');
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
    var catalogOn = settings.catalogEnabled !== false;
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
    setSnap = { llmP: l ? l.provider : '', llmM: l ? l.model : '', catalog: catalogOn, stale: String(staleDays), maxDepth: String(maxDepth), budget: String(budgetNum), usageBudget: String(usageBudget), logWeek: String(logWeekDays), logMonth: String(logRetentionDays) };
    setPersist = setSnap;
    var llmCtrl;
    if (models.length) {
      llmCtrl = '<select class="minput" id="setLlmSel">'
        + '<option value="">跟随当前会话（默认）</option>'
        + models.map(function (m) {
            var v = m.provider + '/' + m.model;
            return '<option value="' + esc(v) + '"' + (l && l.provider === m.provider && l.model === m.model ? ' selected' : '') + '>' + esc(m.label || v) + '</option>'
          }).join('') + '</select>';
    } else {
      llmCtrl = '<input class="minput" id="setLlmP" size="10" placeholder="provider" value="' + esc(l ? l.provider : '') + '">'
        + '<input class="minput" id="setLlmM" size="12" placeholder="model" value="' + esc(l ? l.model : '') + '">'
        + '<button class="mbtn" id="setLlmSave">保存</button>'
        + (l ? '<button class="mbtn" id="setLlmClear">跟随会话</button>' : '');
    }
    $('setBody').innerHTML =
      /* onboarding 轻量（notes-034-batch3）：四概念一行一条前置解释（注入/约定·资料/目录注入/派发）——新用户先懂「为什么要配这些」再看字段 */
      '<div class="modal-hint"><b>概念速览</b><br>'
      + '· 注入：笔记正文进入 Agent 的系统提示，每次对话都可见（编辑器注入三态开关控制）；<br>'
      + '· 约定 / 资料：注入的两种角色——约定 = 须遵守的规则；资料 = Agent 按需取用的参考；<br>'
      + '· 目录注入：只向 Agent 提供全库笔记清单（一行一条），需要全文时它再调取；<br>'
      + '· 派发：把待办笔记派给指定会话执行，完成后自动回执闭环。</div>'
      + '<div class="set-row"><div class="set-label">LLM 模型<span class="s">笔记自动分类 / 指令提取使用的模型</span></div><div class="set-ctrl">' + llmCtrl + '</div></div>'
      + '<div class="set-row"><div class="set-label">LLM 用量<span class="s">笔记功能的 token 消耗统计（真实 usage 优先，未回传时按字符估算）；按日累计，usage.json 落盘</span></div><div class="set-ctrl usage" id="setUsageBody"><span class="s">加载中…</span></div></div>'
      + '<div class="set-row"><div class="set-label">用量预算提醒<span class="s">本月 token 消耗超过该值时提醒（仅 toast 提示，不阻断调用）；0 = 关闭</span></div><div class="set-ctrl"><input class="minput" id="setUsageBudget" type="number" min="0" step="1000" style="width:110px" value="' + usageBudget + '"></div></div>'
      + '<div class="set-row"><div class="set-label">笔记目录注入<span class="s">向 Agent 系统提示注入笔记目录（一行一条），供其规划时参考并按需 note_get 取全文</span></div><div class="set-ctrl"><label class="set-check"><input type="checkbox" id="setCatalog"' + (catalogOn ? ' checked' : '') + '> ' + (catalogOn ? '已开启' : '已关闭') + '</label></div></div>'
      + '<div class="set-row"><div class="set-label">时效衰减提醒<span class="s">目录行对超过 N 天未更新的笔记/链接追加「 ⚠ N 天未更新」标注（提醒参考资料可能过期）；0 = 关闭</span></div><div class="set-ctrl"><input class="minput" id="setStale" type="number" min="0" step="1" style="width:90px" value="' + staleDays + '"></div></div>'
      + '<div class="set-row"><div class="set-label">文件夹嵌套深度<span class="s">虚拟文件夹最大嵌套层级（根级 = 第 1 层，缺省 3）；新建子文件夹/拖拽换父超限将拒绝并提示；0 = 不限</span></div><div class="set-ctrl"><input class="minput" id="setMaxDepth" type="number" min="0" step="1" style="width:90px" value="' + maxDepth + '"></div></div>'
      + '<div class="set-row"><div class="set-label">注入体积预算<span class="s">单次注入笔记全文的上限（约，按字符数近似）；约定条目永不截断，资料条目从最旧开始省略；0 = 不限</span>'
      + '<span class="s" id="setGaugeT">当前注入约 ' + lastChars + ' 字符' + (budgetNum > 0 ? ' / 预算约 ' + budgetNum + ' 字符' : '（不限）') + '</span>'
      + '<div style="height:6px;background:var(--nbg-raise);border:1px solid var(--nbd-soft);border-radius:4px;overflow:hidden;margin-top:4px"><div id="setGaugeBar" style="height:100%;width:' + gaugePct + '%;background:var(' + (budgetNum > 0 && lastChars > budgetNum ? '--ndanger' : '--nacc') + ');transition:width .3s"></div></div></div>'
      + '<div class="set-ctrl"><input class="minput" id="setBudget" type="number" min="0" step="100" style="width:110px" value="' + budgetNum + '"></div></div>'
      + '<div class="set-row"><div class="set-label">注入预览<span class="s">查看 Agent 实际收到的注入文本（约定 + 目录）：敏感打码 / 时效标注 / 预算截断效果即所见；可按会话过滤</span></div><div class="set-ctrl"><button class="mbtn" id="setInjectPreview">预览…</button></div></div>'
      + '<div class="set-row"><div class="set-label">注入管理<span class="s">全库注入总览：逐篇三态直改（关闭/约定/资料）+ 多选批量 + 三态过滤/搜索；日志隐身硬禁，敏感笔记注入自动脱敏；含调度任务区（定时派发约定总览 / 编辑回填 / 暂停 / 删除）</span></div><div class="set-ctrl"><button class="mbtn" id="setInjectManager">管理…</button></div></div>'
      + '<div class="set-row"><div class="set-label">数据<span class="s">全库目录快照导出 / 从快照目录导入（只增改不删，导入前自动全量备份）/ 回收站兜底（恢复或彻底删除）</span></div><div class="set-ctrl"><button class="mbtn" id="setExport">导出全部</button><button class="mbtn" id="setImport">导入…</button><button class="mbtn" id="setTrash">回收站</button></div></div>'
      + '<div class="set-row"><div class="set-label">资产清理<span class="s">扫描 assets/ 中未被任何笔记引用的孤儿文件（已删除笔记的引用仍计入保护，宁留勿删）</span></div><div class="set-ctrl"><button class="mbtn" id="setPrune">清理…</button></div></div>'
      + '<div class="set-row"><div class="set-label">整理建议<span class="s">速记组归档 / 过期未引用清理 / 孤儿笔记候选 / 日志卫生提名（只提名不自动执行）</span></div><div class="set-ctrl"><button class="mbtn" id="setSuggest">打开</button></div></div>'
      /* 工作记忆 v0「工作记忆」区：启用沉淀引导（约定笔记方案）+ 日志卫生两级窗口 */
      + '<div class="set-row"><div class="set-label">工作记忆<span class="s">会话工作结论沉淀为工作日志（kind=log，默认隐身：不进系统提示/目录/默认列表与搜索，筛选中心类型「日志」为专入口）；启用 = 创建一条预填约定笔记（可见/可改/可停用）</span></div><div class="set-ctrl" id="setMemoryCtrl"><span class="s">探测中…</span></div></div>'
      + '<div class="set-row"><div class="set-label">日志周聚合窗口<span class="s">超过 N 天的工作日志在整理建议中按 工作区×周 提名聚合（只提名不执行；缺省 7 天）</span></div><div class="set-ctrl"><input class="minput" id="setLogWeek" type="number" min="0" step="1" style="width:90px" value="' + logWeekDays + '"></div></div>'
      + '<div class="set-row"><div class="set-label">日志月聚合窗口<span class="s">超过 N 天提名月聚合（原始日志与周志混合归组；缺省 90 天）；0 = 关闭月聚合</span></div><div class="set-ctrl"><input class="minput" id="setLogMonth" type="number" min="0" step="1" style="width:90px" value="' + logRetentionDays + '"></div></div>'
      /* 键盘流速查表入口（notes-034-f-cheatsheet）：内容与 panels/keyboard.js 逐键核对；? 键为直达通道 */
      + '<div class="set-row"><div class="set-label">键盘快捷键<span class="s">键盘流全部生效快捷键速查表（与实现逐键核对）；非输入焦点时按 ? 直达，Esc 关闭</span></div><div class="set-ctrl"><button class="mbtn" id="setCheatsheet">查看…</button></div></div>';
    var sel = $('setLlmSel');
    if (sel) sel.onchange = function () {
      var v = this.value;
      var p = v ? { provider: v.split('/')[0], model: v.split('/').slice(1).join('/') } : null;
      saveSettings({ llm: p }, p ? ('已保存：笔记 LLM = ' + v) : '已恢复跟随当前会话（默认）');
    };
    var sp = $('setLlmSave');
    if (sp) sp.onclick = function () {
      var pv = $('setLlmP').value.trim(), mv = $('setLlmM').value.trim();
      if (!pv || !mv) { modalErr('provider 与 model 均需填写'); return }
      saveSettings({ llm: { provider: pv, model: mv } }, '已保存：笔记 LLM = ' + pv + ' / ' + mv);
    };
    var sc = $('setLlmClear');
    if (sc) sc.onclick = function () { saveSettings({ llm: null }, '已恢复跟随当前会话（默认）'); openSettings() };
    $('setCatalog').onchange = function () {
      saveSettings({ catalogEnabled: !!this.checked }, this.checked ? '已开启笔记目录注入' : '已关闭笔记目录注入');
      this.parentNode.lastChild.textContent = this.checked ? ' 已开启' : ' 已关闭';
    };
    /* P1 时效衰减提醒阈值：失焦/Enter 即保存（非负整数；0 = 关闭；非法输入报错不落盘） */
    $('setStale').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr('时效提醒阈值需为非负整数（0 = 关闭）'); return }
      saveSettings({ staleDays: parseInt(v, 10) }, +v === 0 ? '已关闭时效衰减提醒' : '已保存：超过 ' + v + ' 天未更新的资料将在目录标注 ⚠');
    };
    /* 文件夹嵌套深度上限：失焦/Enter 即保存（非负整数；0 = 不限层数；非法输入报错不落盘） */
    $('setMaxDepth').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr('文件夹嵌套深度上限需为非负整数（0 = 不限层数）'); return }
      saveSettings({ maxFolderDepth: parseInt(v, 10) }, +v === 0 ? '已保存：文件夹嵌套不限层数' : '已保存：文件夹最多嵌套 ' + v + ' 层');
    };
    /* P1 注入体积预算（约，字符数）：失焦/Enter 即保存（非负整数；0 = 不限） */
    $('setBudget').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr('注入体积预算需为非负整数（0 = 不限）'); return }
      saveSettings({ injectBudgetChars: parseInt(v, 10) }, +v === 0 ? '已关闭注入体积预算（不限）' : '已保存：注入预算约 ' + v + ' 字符');
    };
    $('setExport').onclick = function () { openExport() };
    $('setImport').onclick = function () { openImport() };
    $('setTrash').onclick = function () { openTrash() };
    $('setPrune').onclick = function () { openPrune() };
    $('setInjectPreview').onclick = function () { openInjectPreview() };
    $('setInjectManager').onclick = function () { openInjectManager() };
    $('setSuggest').onclick = function () { openSuggest() };
    $('setCheatsheet').onclick = function () { openCheatsheet() };
    /* 工作记忆 v0：日志卫生窗口失焦即保存（非负整数；月聚合 0=关闭本级；非法输入报错不落盘） */
    $('setLogWeek').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr('日志周聚合窗口需为非负整数（天）'); return }
      saveSettings({ logWeekAfterDays: parseInt(v, 10) }, '已保存：超过 ' + v + ' 天的日志将提名周聚合');
    };
    $('setLogMonth').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr('日志月聚合窗口需为非负整数（0 = 关闭月聚合）'); return }
      saveSettings({ logRetentionDays: parseInt(v, 10) }, +v === 0 ? '已关闭日志月聚合提名' : '已保存：超过 ' + v + ' 天的日志将提名月聚合');
    };
    /* 工作记忆 v0 r3：沉淀引导状态行（单一事实源 = contractType: memory-guide（tag 兼容发现键）且 inject=true 的笔记；停用=关 inject，查看=跳转约定笔记） */
    rpc('notes-memory-guide', { op: 'status' }).then(function (st) { renderMemoryStatus(st && !st.error ? st : { enabled: false, noteId: '' }) }).catch(function () { renderMemoryStatus({ enabled: false, noteId: '' }) });
    /* LLM 月度用量预算提醒：失焦/Enter 即保存（非负整数；0 = 关闭） */
    $('setUsageBudget').onchange = function () {
      var v = String(this.value).trim();
      if (!/^\d+$/.test(v)) { modalErr('月度用量预算需为非负整数（0 = 关闭提醒）'); return }
      usageBudget = parseInt(v, 10);
      saveSettings({ usageBudgetMonthly: usageBudget }, +v === 0 ? '已关闭月度用量预算提醒' : '已保存：月度用量预算 ' + fmtTok(+v) + ' tokens');
    };
    /* dirty 跟踪（notes-settings-feedback）：输入即刷新 保存/还原 按钮态（oninput 只刷新不落盘；失焦/Enter 即存的 onchange 链路不变） */
    ['setStale', 'setMaxDepth', 'setBudget', 'setUsageBudget', 'setLogWeek', 'setLogMonth', 'setLlmP', 'setLlmM'].forEach(function (id) { var el = $(id); if (el) el.oninput = setDirtyRefresh });
    setDirtyRefresh();
    /* LLM 用量统计（notes-token-stats）：独立 RPC 填充用量区；超月度预算 toast 提醒（不阻断） */
    rpc('notes-usage-get', {}).then(function (u) {
      var ub = $('setUsageBody');
      if (!ub) return;
      if (!u || u.error) { ub.innerHTML = '<span class="s">用量数据读取失败</span>'; return }
      ub.innerHTML = '<span class="usage-line">今日 ' + fmtTok(u.today.total) + ' · 本周 ' + fmtTok(u.week.total) + ' · 本月 ' + fmtTok(u.month.total) + ' · 累计 ' + fmtTok(u.allTime.total) + ' tokens' + (u.calls > 0 ? '（' + u.calls + ' 次调用）' : '') + '</span>'
        + '<span class="s">分类 ' + fmtTok(u.byFeature.classify.allTime) + ' · 整理 ' + fmtTok(u.byFeature.organize.allTime) + ' · 总结 ' + fmtTok(u.byFeature.summarize.allTime) + (u.estimatedTokens > 0 ? '（含字符估算，约）' : '') + '</span>';
      if (usageBudget > 0 && u.month && u.month.total > usageBudget) toast('⚠ 本月笔记 LLM 用量 ' + fmtTok(u.month.total) + ' tokens 已超预算 ' + fmtTok(usageBudget) + '（仅提醒，不阻断）');
    }).catch(function () { var ub = $('setUsageBody'); if (ub) ub.innerHTML = '<span class="s">用量数据读取失败</span>' });
  }).catch(function (e) { modalErr('设置加载失败：' + (e && e.message || e)) });
}
function saveSettings(patch, okMsg) {
  setInflight++; setDirtyRefresh();
  rpc('notes-settings-set', patch).then(function (res) {
    if (res && res.error) { modalErr(res.error); return }
    setPersistMerge(patch);
    if (okMsg) toast(okMsg);
  }).catch(function (e) { modalErr('保存失败：' + (e && e.message || e)) }).then(function () { setInflight--; setDirtyRefresh() });
}
/* ===== 设置卡交互反馈（notes-settings-feedback）：dirty 状态机 + 显式保存 / 还原 / 关闭兜底 flush ===== */
/* dirty 判定：在途待写 > 0 或 任一控件值 ≠ 打开时快照 */
function setDirtyCompute() {
  if (!setSnap) return false;
  if (setInflight > 0) return true;
  if ($('setLlmSel') && $('setLlmSel').value !== (setSnap.llmP && setSnap.llmM ? setSnap.llmP + '/' + setSnap.llmM : '')) return true;
  if ($('setLlmP') && ($('setLlmP').value.trim() !== setSnap.llmP || $('setLlmM').value.trim() !== setSnap.llmM)) return true;
  if ($('setCatalog') && $('setCatalog').checked !== setSnap.catalog) return true;
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
  if ('catalogEnabled' in patch) n.catalog = !!patch.catalogEnabled;
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
/* 数值字段登记表（DOM id ↔ 快照键 ↔ 设置 RPC 键 ↔ 校验文案）：保存校验/兜底 flush/还原回滚共用同一份口径 */
var SET_NUM_FIELDS = [
  ['setStale', 'stale', 'staleDays', '时效提醒阈值需为非负整数（0 = 关闭）'],
  ['setMaxDepth', 'maxDepth', 'maxFolderDepth', '文件夹嵌套深度上限需为非负整数（0 = 不限层数）'],
  ['setBudget', 'budget', 'injectBudgetChars', '注入体积预算需为非负整数（0 = 不限）'],
  ['setUsageBudget', 'usageBudget', 'usageBudgetMonthly', '月度用量预算需为非负整数（0 = 关闭提醒）'],
  ['setLogWeek', 'logWeek', 'logWeekAfterDays', '日志周聚合窗口需为非负整数（天）'],
  ['setLogMonth', 'logMonth', 'logRetentionDays', '日志月聚合窗口需为非负整数（0 = 关闭月聚合）'],
];
/* 当前控件值 → 快照对象（保存成功后快照跟进用） */
function setSnapFromControls() {
  var s = { llmP: '', llmM: '', catalog: true, stale: '', maxDepth: '', budget: '', usageBudget: '', logWeek: '', logMonth: '' };
  if ($('setLlmSel')) { var v = $('setLlmSel').value; s.llmP = v ? v.split('/')[0] : ''; s.llmM = v ? v.split('/').slice(1).join('/') : '' }
  if ($('setLlmP')) { s.llmP = $('setLlmP').value.trim(); s.llmM = $('setLlmM').value.trim() }
  if ($('setCatalog')) s.catalog = $('setCatalog').checked;
  for (var i = 0; i < SET_NUM_FIELDS.length; i++) { var el = $(SET_NUM_FIELDS[i][0]); if (el) s[SET_NUM_FIELDS[i][1]] = String(el.value).trim() }
  return s;
}
/* 「保存」：显式确认 + 兜底 flush——先校验全部数值字段（任一非法即中止并报错，改动保留继续编辑），
   再串行落盘全部「控件值 ≠ 已落盘」的键（串行防写竞态），全部成功后快照跟进 + toast「设置已保存」+ dirty 复位 */
function doSettingsSaveAll() {
  if (setSaving || !setSnap || !setPersist) return;
  var i, el, v;
  for (i = 0; i < SET_NUM_FIELDS.length; i++) { el = $(SET_NUM_FIELDS[i][0]); if (el && !/^\d+$/.test(String(el.value).trim())) { modalErr(SET_NUM_FIELDS[i][3]); return } }
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
    toast('设置已保存');
    setDirtyRefresh();
  }, function (e) { setSaving = false; modalErr('保存失败：' + (e && e.message || e)); setDirtyRefresh() });
}
/* 「还原」：回滚到打开时快照——已落盘 ≠ 快照的键逐键串行写回（逐键恢复），全部控件复位到快照值 */
function doSettingsRestoreAll() {
  if (setSaving || !setSnap || !setPersist) return;
  var s = setSnap, p = setPersist;
  var patches = [];
  if (p.llmP !== s.llmP || p.llmM !== s.llmM) patches.push({ llm: (s.llmP && s.llmM) ? { provider: s.llmP, model: s.llmM } : null });
  if (p.catalog !== s.catalog) patches.push({ catalogEnabled: s.catalog });
  for (var i = 0; i < SET_NUM_FIELDS.length; i++) { if (p[SET_NUM_FIELDS[i][1]] !== s[SET_NUM_FIELDS[i][1]]) { var o = {}; o[SET_NUM_FIELDS[i][2]] = parseInt(s[SET_NUM_FIELDS[i][1]], 10); patches.push(o) } }
  setSaving = true; setDirtyRefresh();
  var seq = Promise.resolve();
  patches.forEach(function (pt) { seq = seq.then(function () { return settingsSetQuiet(pt) }) });
  seq.then(function () {
    setSaving = false;
    /* UI 复位到打开时快照 */
    if ($('setLlmSel')) $('setLlmSel').value = (s.llmP && s.llmM) ? s.llmP + '/' + s.llmM : '';
    if ($('setLlmP')) { $('setLlmP').value = s.llmP; $('setLlmM').value = s.llmM }
    if ($('setCatalog')) { $('setCatalog').checked = s.catalog; $('setCatalog').parentNode.lastChild.textContent = s.catalog ? ' 已开启' : ' 已关闭' }
    for (var i = 0; i < SET_NUM_FIELDS.length; i++) { var el = $(SET_NUM_FIELDS[i][0]); if (el) el.value = s[SET_NUM_FIELDS[i][1]] }
    toast('已还原：设置回滚到打开时的状态');
    setDirtyRefresh();
  }, function (e) { setSaving = false; modalErr('还原失败：' + (e && e.message || e)); setDirtyRefresh() });
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
  seq.then(function () { toast('设置已保存') }, function (e) { toast('设置保存失败：' + (e && e.message || e)) });
}
