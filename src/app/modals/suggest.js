/* ================= 整理建议（设置卡片「整理建议」行入口）：notes-suggest（dry-run 零写入）四段式 modal =================
   契约：{ archiveCandidates:速记组（结构与 notes-archive-preview 同源）, staleCandidates:过期未引用, orphanCandidates:孤儿（仅展示）, logHygieneCandidates:{weekly,monthly}:日志卫生（工作记忆 v0，仅展示明细）, generatedAt }
   红线：只提名不自动执行——速记组「去归档」直达归档预览对话框；过期未引用「一键批量软删除」confirm 后才逐条 notes-delete（软删可恢复）；
   孤儿候选是启发式判定（可能误伤），不提供批量操作，逐条跳转人工过目；日志卫生 v0 仅展开明细（聚合执行留待 Phase 2，日志只聚合不淘汰）。 */
function openSuggest() {
  suggestState = { data: null, pending: false, logHgExpand: {} };
  openModal(
    '<div class="modal-t">' + icon('i-sparkle', 13) + ' 整理建议<span class="sub">只提名不自动执行 · 软删除可恢复</span></div>'
    + '<div id="suggestList"><div class="modal-hint">分析中…</div></div>'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="suggestClose">关闭</button></div>'
  );
  $('suggestClose').onclick = function () { if (!suggestState || !suggestState.pending) { closeModal(); suggestState = null } };
  loadSuggest();
}
function loadSuggest() {
  var empty = { archiveCandidates: [], staleCandidates: [], orphanCandidates: [], logHygieneCandidates: { weekly: [], monthly: [] } };
  rpc('notes-suggest', {}).then(function (res) {
    if (!suggestState) return;
    if (res && res.error) { suggestState.data = empty; renderSuggestList(); modalErr(res.error); return }
    suggestState.data = res || empty;
    renderSuggestList();
  }).catch(function (e) { if (suggestState) { suggestState.data = empty; renderSuggestList(); modalErr('分析失败：' + (e && e.message || e)) } });
}
/* 四段式列表（复用 arch-list/arch-row）：① 速记组（「去归档」直达归档预览，数据同源）② 过期未引用（一键批量软删 confirm）③ 可能无用（仅展示，逐条「查看」跳转）④ 日志卫生（工作记忆 v0：超窗日志 周/月 聚合提名——只提名不执行，v0 「明细」展开逐条「查看」） */
function renderSuggestList() {
  var host = $('suggestList'); if (!host || !suggestState) return;
  var d = suggestState.data;
  if (!d) { host.innerHTML = '<div class="modal-hint">分析中…</div>'; return }
  var arch = d.archiveCandidates || [], stale = d.staleCandidates || [], orphans = d.orphanCandidates || [];
  /* 工作记忆 v0 日志卫生（第四段）：{ weekly, monthly } 两级提名（裁决 B② 只提名不执行；v0 仅展示明细，聚合执行留待 Phase 2） */
  var logHg = d.logHygieneCandidates || { weekly: [], monthly: [] };
  var logHgGroups = logHg.weekly.map(function (g) { return { g: g, tier: '周聚合' } }).concat(logHg.monthly.map(function (g) { return { g: g, tier: '月聚合' } }));
  if (!arch.length && !stale.length && !orphans.length && !logHgGroups.length) { host.innerHTML = '<div class="modal-hint">库很干净，无需整理。</div>'; return }
  var h = '';
  /* ① 可整理的速记组 */
  h += '<div class="sg-sec"><div class="sg-sec-t">可整理的速记组<span class="sg-sec-n">' + arch.length + ' 组</span>'
    + (arch.length ? '<button class="mbtn trash-act" id="sgGoArch">去归档</button>' : '') + '</div>';
  h += arch.length
    ? '<div class="arch-list">' + arch.map(function (g) {
        var span = g.dateSpan && g.dateSpan.from ? (g.dateSpan.from === g.dateSpan.to ? g.dateSpan.from : g.dateSpan.from + ' ~ ' + g.dateSpan.to) : '';
        return '<div class="arch-row"><span class="ti" title="' + esc(g.title) + '">' + esc(g.title) + '</span>'
          + '<span class="meta">' + esc(span) + ' · ' + g.members.length + ' 条 · ' + fmtBytes(g.totalBytes) + ((g.totalUseCount || 0) > 0 ? ' · 被引用 ' + g.totalUseCount + ' 次' : '') + '</span></div>'
      }).join('') + '</div>'
    : '<div class="modal-hint">没有可归档的速记组（同一会话 ≥2 条速记才会成组）。</div>';
  h += '</div>';
  /* ② 过期未引用（useCount=0 且超 staleDays；一键批量软删 confirm 后才执行） */
  h += '<div class="sg-sec"><div class="sg-sec-t">过期未引用<span class="sg-sec-n">' + stale.length + ' 条</span>'
    + (stale.length ? '<button class="mbtn danger trash-act" id="sgBatchDel"' + (suggestState.pending ? ' disabled' : '') + '>' + (suggestState.pending ? '删除中…' : '一键批量软删除') + '</button>' : '') + '</div>';
  h += stale.length
    ? '<div class="arch-list">' + stale.map(function (n) {
        return '<div class="arch-row"><span class="ti" title="' + esc(n.title || 'Untitled') + '">' + esc(n.title || 'Untitled') + '</span>'
          + '<span class="meta">' + esc(n.topic || '未分类') + ' · ' + n.staleDays + ' 天未更新</span></div>'
      }).join('') + '</div>'
    : '<div class="modal-hint">没有过期且从未被引用的笔记。</div>';
  h += '</div>';
  /* ③ 可能无用（孤儿候选：启发式判定可能误伤——仅展示逐条「查看」，不提供批量操作） */
  h += '<div class="sg-sec"><div class="sg-sec-t">可能无用<span class="sg-sec-n">' + orphans.length + ' 条</span></div>';
  h += orphans.length
    ? '<div class="arch-list">' + orphans.map(function (n) {
        return '<div class="arch-row"><span class="ti" title="' + esc(n.title || 'Untitled') + '">' + esc(n.title || 'Untitled') + '</span>'
          + '<span class="meta">' + esc(n.topic || '未分类') + ' · ' + esc(n.updatedAt ? String(n.updatedAt).slice(0, 10) : '—') + '</span>'
          + '<button class="mbtn trash-act sg-view" data-id="' + esc(n.id) + '">查看</button></div>'
      }).join('') + '</div>'
    : '<div class="modal-hint">没有孤儿笔记（无双链关联且从未被引用）。</div>';
  h += '</div>';
  /* ④ 日志卫生（工作记忆 v0 裁决 B②：超窗旧日志两级聚合提名——只提名不执行，v0 展开明细逐条过目；日志只聚合不淘汰，永不进过期/孤儿候选） */
  h += '<div class="sg-sec"><div class="sg-sec-t">日志卫生<span class="sg-sec-n">' + logHgGroups.length + ' 组</span></div>';
  h += logHgGroups.length
    ? '<div class="arch-list">' + logHgGroups.map(function (x) {
        var g = x.g, gk = x.tier + g.key;
        var rows = '<div class="arch-row"><span class="ti" title="' + esc(g.title) + '">' + esc(g.title) + '</span>'
          + '<span class="meta">' + x.tier + ' · ' + g.members.length + ' 条</span>'
          + '<button class="mbtn trash-act sg-loghg" data-gk="' + esc(gk) + '">' + (suggestState.logHgExpand && suggestState.logHgExpand[gk] ? '收起' : '明细') + '</button></div>';
        if (suggestState.logHgExpand && suggestState.logHgExpand[gk]) {
          rows += g.members.map(function (m) {
            return '<div class="arch-row"><span class="ti" title="' + esc(m.title || 'Untitled') + '" style="padding-left:14px">' + esc(m.title || 'Untitled') + '</span>'
              + '<span class="meta">' + esc(m.logDate || '—') + (m.sessionId ? ' · 会话 ' + esc(String(m.sessionId).replace(/^session-/, '').slice(0, 8)) : '') + '</span>'
              + '<button class="mbtn trash-act sg-view" data-id="' + esc(m.id) + '">查看</button></div>'
          }).join('');
        }
        return rows
      }).join('') + '</div>'
    : '<div class="modal-hint">没有待聚合的工作日志（超窗日志按 工作区×周/月 归组，同组 ≥2 条才提名）。</div>';
  h += '</div>';
  h += '<div class="modal-hint">判定口径：过期 = 超过时效阈值（设置卡片可调）且从未被引用；可能无用 = 无 [[双链]] 关联、未注入、从未被引用的进行中普通笔记（启发式，请逐条过目）。日志卫生 = 超 7 天周聚合 / 超 90 天月聚合提名（设置卡片「工作记忆」区可调窗口）；v0 仅展示明细，一键合并将在后续版本提供。</div>';
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
}
/* 过期未引用一键批量软删：confirm 确认后才执行；逐条 notes-delete（软删，回收站可恢复）；删后刷新建议 + 列表 */
function doSuggestBatchDelete() {
  if (!suggestState || suggestState.pending || !suggestState.data) return;
  var list = suggestState.data.staleCandidates || [];
  if (!list.length) return;
  if (!confirm('一键批量软删除：' + list.length + ' 条过期且从未被引用的笔记将移入回收站（可恢复）。\n确认删除？')) return;
  suggestState.pending = true; renderSuggestList();
  var ok = 0, fail = 0, chain = Promise.resolve();
  list.forEach(function (n) {
    chain = chain.then(function () {
      return rpc('notes-delete', { id: n.id }).then(function (res) { if (res && res.error) fail++; else ok++ }, function () { fail++ });
    });
  });
  chain.then(function () {
    if (!suggestState) return;
    suggestState.pending = false;
    toast('已软删除 ' + ok + ' 条（回收站可恢复）' + (fail ? '，失败 ' + fail + ' 条' : ''));
    loadSuggest(); afterArchiveRefresh();
  });
}

