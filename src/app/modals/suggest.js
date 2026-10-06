/* ================= 整理建议（设置卡片「整理建议」行入口）：notes-suggest（dry-run 零写入）六段式 modal =================
   契约：{ archiveCandidates:速记组（结构与 notes-archive-preview 同源）, staleCandidates:过期未引用, orphanCandidates:孤儿（仅展示）, logHygieneCandidates:{weekly,monthly}:日志卫生（工作记忆 v0，仅展示明细）,
          zeroRefMountCandidates:零引用挂载（0.4.5-C 遥测驱动：近 14 天五通道零事件的 §1 挂载笔记，动作=摘除挂载/改文案）,
          hotUnmountedCandidates:高频取用未挂载（窗口内检索+取用 ≥3 次且未挂载，动作=挂载）, telemetryWindowDays, generatedAt }
   红线：只提名不自动执行——速记组「去归档」直达归档预览对话框；过期未引用「一键批量软删除」无 confirm 直接逐条 notes-delete（软删可恢复，撤销 toast 兜底——确认强度 = 不可恢复性，notes-034-c-confirm）；
   孤儿候选是启发式判定（可能误伤），不提供批量操作，逐条跳转人工过目；日志卫生 v0 仅展开明细（聚合执行留待 Phase 2，日志只聚合不淘汰）；
   遥测两段空态不渲染（遥测缺失静默为空），摘除挂载 confirm 后走 notes-update inject:false 既有通道（host _idxSyncMount 联动摘 §1 行，零新 RPC 面，不删笔记），挂载/改文案复用 MountModal。 */
function openSuggest() {
  suggestState = { data: null, pending: false, logHgExpand: {} };
  openModal(
    '<div class="modal-t">' + icon('i-sparkle', 13) + ' ' + t('settings.suggest') + '<span class="sub">' + t('sugg.sub') + '</span></div>'
    + '<div id="suggestList"><div class="modal-hint">' + t('sugg.analyzing') + '</div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="suggestClose">' + t('common.close') + '</button></div>'
  );
  $('suggestClose').onclick = function () { if (!suggestState || !suggestState.pending) { closeModal(); suggestState = null } };
  loadSuggest();
}
function loadSuggest() {
  var empty = { archiveCandidates: [], staleCandidates: [], orphanCandidates: [], logHygieneCandidates: { weekly: [], monthly: [] }, zeroRefMountCandidates: [], hotUnmountedCandidates: [] };
  rpc('notes-suggest', {}).then(function (res) {
    if (!suggestState) return;
    if (res && res.error) { suggestState.data = empty; renderSuggestList(); modalErr(res.error); return }
    suggestState.data = res || empty;
    renderSuggestList();
  }).catch(function (e) { if (suggestState) { suggestState.data = empty; renderSuggestList(); modalErr(t('sugg.failed', { msg: e && e.message || e })) } });
}
/* 六段式列表（复用 arch-list/arch-row）：① 速记组（「去归档」直达归档预览，数据同源）② 过期未引用（一键批量软删，无 confirm + 撤销 toast）③ 可能无用（仅展示，逐条「查看」跳转）④ 日志卫生（工作记忆 v0：超窗日志 周/月 聚合提名——只提名不执行，v0 「明细」展开逐条「查看」）⑤ 零引用挂载（0.4.5-C 遥测驱动，空态不渲染）⑥ 高频取用未挂载（空态不渲染） */
function renderSuggestList() {
  var host = $('suggestList'); if (!host || !suggestState) return;
  var d = suggestState.data;
  if (!d) { host.innerHTML = '<div class="modal-hint">' + t('sugg.analyzing') + '</div>'; return }
  var arch = d.archiveCandidates || [], stale = d.staleCandidates || [], orphans = d.orphanCandidates || [];
  /* 工作记忆 v0 日志卫生（第四段）：{ weekly, monthly } 两级提名（裁决 B② 只提名不执行；v0 仅展示明细，聚合执行留待 Phase 2） */
  var logHg = d.logHygieneCandidates || { weekly: [], monthly: [] };
  var logHgGroups = logHg.weekly.map(function (g) { return { g: g, tier: t('sugg.tierWeekly') } }).concat(logHg.monthly.map(function (g) { return { g: g, tier: t('sugg.tierMonthly') } }));
  /* 0.4.5-C 遥测两段：零引用挂载 / 高频取用未挂载（遥测缺失静默为空 → 空态不渲染） */
  var zr = d.zeroRefMountCandidates || [], hot = d.hotUnmountedCandidates || [];
  var winDays = d.telemetryWindowDays || 14;
  if (!arch.length && !stale.length && !orphans.length && !logHgGroups.length && !zr.length && !hot.length) { host.innerHTML = '<div class="modal-hint">' + t('sugg.clean') + '</div>'; return }
  var h = '';
  /* ① 可整理的速记组 */
  h += '<div class="sg-sec"><div class="sg-sec-t">' + t('sugg.secArch') + '<span class="sg-sec-n">' + t('sugg.countGroups', { n: arch.length }) + '</span>'
    + (arch.length ? '<button class="mbtn trash-act" id="sgGoArch">' + t('sugg.goArch') + '</button>' : '') + '</div>';
  h += arch.length
    ? '<div class="arch-list">' + arch.map(function (g) {
        var span = g.dateSpan && g.dateSpan.from ? (g.dateSpan.from === g.dateSpan.to ? g.dateSpan.from : g.dateSpan.from + ' ~ ' + g.dateSpan.to) : '';
        return '<div class="arch-row"><span class="ti" title="' + esc(g.title) + '">' + esc(g.title) + '</span>'
          + '<span class="meta">' + esc(t('arch.groupMeta', { span: span, n: g.members.length, size: fmtBytes(g.totalBytes) })) + ((g.totalUseCount || 0) > 0 ? esc(t('arch.groupUseCount', { n: g.totalUseCount })) : '') + '</span></div>'
      }).join('') + '</div>'
    : '<div class="modal-hint">' + t('arch.empty') + '</div>';
  h += '</div>';
  /* ② 过期未引用（useCount=0 且超 staleDays；一键批量软删，无 confirm + 撤销 toast 兜底） */
  h += '<div class="sg-sec"><div class="sg-sec-t">' + t('sugg.secStale') + '<span class="sg-sec-n">' + t('sugg.countItems', { n: stale.length }) + '</span>'
    + (stale.length ? '<button class="mbtn danger trash-act" id="sgBatchDel"' + (suggestState.pending ? ' disabled' : '') + '>' + (suggestState.pending ? t('sugg.deleting') : t('sugg.batchDel')) + '</button>' : '') + '</div>';
  h += stale.length
    ? '<div class="arch-list">' + stale.map(function (n) {
        return '<div class="arch-row"><span class="ti" title="' + esc(n.title || 'Untitled') + '">' + esc(n.title || 'Untitled') + '</span>'
          + '<span class="meta">' + esc(n.topic || t('meta.uncategorized')) + ' · ' + t('sugg.staleDays', { n: n.staleDays }) + '</span></div>'
      }).join('') + '</div>'
    : '<div class="modal-hint">' + t('sugg.staleEmpty') + '</div>';
  h += '</div>';
  /* ③ 可能无用（孤儿候选：启发式判定可能误伤——仅展示逐条「查看」，不提供批量操作） */
  h += '<div class="sg-sec"><div class="sg-sec-t">' + t('sugg.secOrphan') + '<span class="sg-sec-n">' + t('sugg.countItems', { n: orphans.length }) + '</span></div>';
  h += orphans.length
    ? '<div class="arch-list">' + orphans.map(function (n) {
        return '<div class="arch-row"><span class="ti" title="' + esc(n.title || 'Untitled') + '">' + esc(n.title || 'Untitled') + '</span>'
          + '<span class="meta">' + esc(n.topic || t('meta.uncategorized')) + ' · ' + esc(n.updatedAt ? fmtDT(n.updatedAt).slice(0, 10) : '—') + '</span>'
          + '<button class="mbtn trash-act sg-view" data-id="' + esc(n.id) + '">' + t('sugg.view') + '</button></div>'
      }).join('') + '</div>'
    : '<div class="modal-hint">' + t('sugg.orphanEmpty') + '</div>';
  h += '</div>';
  /* ④ 日志卫生（工作记忆 v0 裁决 B②：超窗旧日志两级聚合提名——只提名不执行，v0 展开明细逐条过目；日志只聚合不淘汰，永不进过期/孤儿候选） */
  h += '<div class="sg-sec"><div class="sg-sec-t">' + t('sugg.secLogHg') + '<span class="sg-sec-n">' + t('sugg.countGroups', { n: logHgGroups.length }) + '</span></div>';
  h += logHgGroups.length
    ? '<div class="arch-list">' + logHgGroups.map(function (x) {
        var g = x.g, gk = x.tier + g.key;
        var rows = '<div class="arch-row"><span class="ti" title="' + esc(g.title) + '">' + esc(g.title) + '</span>'
          + '<span class="meta">' + esc(t('sugg.logHgMeta', { tier: x.tier, n: g.members.length })) + '</span>'
          + '<button class="mbtn trash-act sg-loghg" data-gk="' + esc(gk) + '">' + (suggestState.logHgExpand && suggestState.logHgExpand[gk] ? t('trash.collapse') : t('sugg.detail')) + '</button></div>';
        if (suggestState.logHgExpand && suggestState.logHgExpand[gk]) {
          rows += g.members.map(function (m) {
            return '<div class="arch-row"><span class="ti" title="' + esc(m.title || 'Untitled') + '" style="padding-left:14px">' + esc(m.title || 'Untitled') + '</span>'
              + '<span class="meta">' + esc(m.logDate || '—') + (m.sessionId ? esc(t('sugg.sessSeg', { id: String(m.sessionId).replace(/^session-/, '').slice(0, 8) })) : '') + '</span>'
              + '<button class="mbtn trash-act sg-view" data-id="' + esc(m.id) + '">' + t('sugg.view') + '</button></div>'
          }).join('');
        }
        return rows
      }).join('') + '</div>'
    : '<div class="modal-hint">' + t('sugg.logHgEmpty') + '</div>';
  h += '</div>';
  /* ⑤ 零引用挂载（0.4.5-C 遥测驱动）：近 14 天五通道零事件的 §1 挂载笔记——动作双选「改文案」（MountModal 编辑模式预填现文案）/「摘除挂载」（confirm 后 notes-update inject:false，不删笔记）；空态不渲染 */
  if (zr.length) {
    h += '<div class="sg-sec"><div class="sg-sec-t">' + t('sugg.secZeroRef') + '<span class="sg-sec-n">' + t('sugg.countItems', { n: zr.length }) + '</span></div>';
    h += '<div class="arch-list">' + zr.map(function (n) {
      return '<div class="arch-row"><span class="ti" title="' + esc(n.title || 'Untitled') + '">' + esc(n.title || 'Untitled') + '</span>'
        + '<span class="meta">' + esc(n.topic || t('meta.uncategorized')) + (n.when ? ' · ' + esc(n.when) : '') + '</span>'
        + '<button class="mbtn trash-act sg-editwhen" data-id="' + esc(n.id) + '">' + t('sugg.editWhen') + '</button>'
        + '<button class="mbtn trash-act sg-unmount" data-id="' + esc(n.id) + '">' + t('sugg.unmount') + '</button></div>'
    }).join('') + '</div>';
    h += '</div>';
  }
  /* ⑥ 高频取用未挂载：窗口内检索+取用 ≥3 次且未挂载——动作「挂载」（MountModal LLM 草稿预填）；空态不渲染 */
  if (hot.length) {
    h += '<div class="sg-sec"><div class="sg-sec-t">' + t('sugg.secHot') + '<span class="sg-sec-n">' + t('sugg.countItems', { n: hot.length }) + '</span></div>';
    h += '<div class="arch-list">' + hot.map(function (n) {
      return '<div class="arch-row"><span class="ti" title="' + esc(n.title || 'Untitled') + '">' + esc(n.title || 'Untitled') + '</span>'
        + '<span class="meta">' + esc(n.topic || t('meta.uncategorized')) + ' · ' + esc(t('sugg.hotMeta', { d: winDays, n: n.hits })) + '</span>'
        + '<button class="mbtn trash-act sg-mount" data-id="' + esc(n.id) + '">' + t('sugg.mount') + '</button></div>'
    }).join('') + '</div>';
    h += '</div>';
  }
  h += '<div class="modal-hint">' + t('sugg.criteria') + '</div>';
  host.innerHTML = h;
  var go = $('sgGoArch'); if (go) go.onclick = function () { closeModal(); suggestState = null; openArchive() };   /* 直达归档预览（数据与 notes-archive-preview 同源） */
  var bd = $('sgBatchDel'); if (bd) bd.onclick = doSuggestBatchDelete;
  host.querySelectorAll('.sg-view').forEach(function (el) {
    el.onclick = function () { var id = el.dataset.id; closeModal(); suggestState = null; selectNote(id) };
  });
  /* 日志卫生组「明细」展开/收起（v0 仅展示明细，不提供聚合执行按钮） */
  host.querySelectorAll('.sg-loghg').forEach(function (el) {
    el.onclick = function () {
      var gk = el.dataset.gk;
      suggestState.logHgExpand = suggestState.logHgExpand || {};
      if (suggestState.logHgExpand[gk]) delete suggestState.logHgExpand[gk]; else suggestState.logHgExpand[gk] = true;
      renderSuggestList();
    };
  });
  /* ⑤⑥ 遥测候选动作接线（0.4.5-C）：摘除挂载 = confirm 后 doSuggestUnmount；改文案/挂载 = MountModal
     （modal 不叠 modal——先关建议框让出 modal 宿主；确认回调重开建议框继续收割其余候选，跳过/取消零副作用不回开） */
  host.querySelectorAll('.sg-unmount').forEach(function (el) { el.onclick = function () { doSuggestUnmount(el.dataset.id) } });
  host.querySelectorAll('.sg-editwhen').forEach(function (el) {
    el.onclick = function () {
      var n = findSuggestTelem(el.dataset.id, 'zeroRefMountCandidates'); if (!n) return;
      closeModal(); suggestState = null;
      openMountModal({ id: n.id, title: n.title || n.id, existing: n.when || '' }, function () { openSuggest() });
    };
  });
  host.querySelectorAll('.sg-mount').forEach(function (el) {
    el.onclick = function () {
      var n = findSuggestTelem(el.dataset.id, 'hotUnmountedCandidates'); if (!n) return;
      closeModal(); suggestState = null;
      openMountModal({ id: n.id, title: n.title || n.id }, function () { openSuggest() });
    };
  });
}
/* 遥测候选查找（⑤⑥ 段共用）：从当前建议数据按 id 取条目（when/title 供 MountModal 预填，免 DOM 转义往返） */
function findSuggestTelem(id, key) {
  var list = (suggestState && suggestState.data && suggestState.data[key]) || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
/* 摘除挂载（0.4.5-C 零引用挂载动作）：confirm（重挂载需手工 → 给一次确认）→ notes-update inject:false 既有通道
   （host _idxSyncMount 联动摘 §1 行，挂载⇔资料不变量同口径，零新 RPC 面；不删笔记）→ toast + 刷新建议/列表 */
function doSuggestUnmount(id) {
  var n = findSuggestTelem(id, 'zeroRefMountCandidates');
  if (!n || !suggestState || suggestState.pending) return;
  if (!confirm(t('sugg.unmountConfirm', { title: n.title || n.id }))) return;
  rpc('notes-update', { id: id, inject: false }).then(function (res) {
    if (!suggestState) return;
    if (res && res.error) { modalErr(t('sugg.unmountFailed', { msg: res.error })); return }
    toast(t('sugg.unmounted', { title: n.title || n.id }));
    loadSuggest(); loadNotes(true);
  }).catch(function (e) { if (suggestState) modalErr(t('sugg.unmountFailed', { msg: e && e.message || e })) });
}
/* 过期未引用一键批量软删：确认强度 = 不可恢复性（notes-034-c-confirm）——软删可恢复 → 轻：无 confirm 直接删，
   撤销 toast 兜底（逐条 notes-restore；回收站亦可恢复）；删后刷新建议 + 列表 */
function doSuggestBatchDelete() {
  if (!suggestState || suggestState.pending || !suggestState.data) return;
  var list = suggestState.data.staleCandidates || [];
  if (!list.length) return;
  suggestState.pending = true; renderSuggestList();
  var ok = 0, fail = 0, okIds = [], chain = Promise.resolve();
  list.forEach(function (n) {
    chain = chain.then(function () {
      return rpc('notes-delete', { id: n.id }).then(function (res) { if (res && res.error) fail++; else { ok++; okIds.push(n.id) } }, function () { fail++ });
    });
  });
  chain.then(function () {
    if (!suggestState) return;
    suggestState.pending = false;
    toast(t('sugg.softDeleted', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''), okIds.length ? { label: t('meta.undo'), fn: function () { undoSuggestBatchDelete(okIds) } } : undefined);
    loadSuggest(); afterArchiveRefresh();
  });
}
/* 建议器批量软删撤销：逐条 notes-restore 恢复本次成功删除的笔记，恢复后刷新建议 + 列表 */
function undoSuggestBatchDelete(ids) {
  var ok = 0, fail = 0, chain = Promise.resolve();
  ids.forEach(function (id) {
    chain = chain.then(function () {
      return rpc('notes-restore', { id: id }).then(function (res) { if (res && res.error) fail++; else ok++ }, function () { fail++ });
    });
  });
  chain.then(function () {
    toast(t('common.restoredBatch', { ok: ok }) + (fail ? t('inj.batchDoneFail', { n: fail }) : ''));
    loadSuggest(); afterArchiveRefresh();
  });
}

