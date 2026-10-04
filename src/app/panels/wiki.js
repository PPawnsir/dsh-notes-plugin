/* ===== P2 笔记双链：解析 / 索引 / 跳转 / 反向链接（内核 extractWikiTargets/wikiLinksTo 同一口径；库已在内存，host 不改）===== */
/* 渲染时解析：[[n-xxx]] 精确 id 优先，其次 [[标题]] 全库标题精确匹配；均不中 → null（渲染为纯文本） */
function resolveWikiTarget(target) {
  var t = String(target || '');
  if (!t) return null;
  return notes.find(function (n) { return n.id === t; }) || notes.find(function (n) { return (n.title || '') === t; }) || null;
}
/* 渲染器行内扩展入参（renderMarkdown 第二参）：命中 → {id,title}（锚显示标题）；不中 → null（纯文本） */
function wikiResolve(w) { var n = resolveWikiTarget(w); return n ? { id: n.id, title: n.title || '' } : null; }
/* 全库正文索引：补缺/过期（updatedAt 漂移）条目一次 notes-get-batch 批量拉全（N+1 整治 notes-034-batch3：昔日 4 路并发逐条 notes-get，
   76 条库首屏 159 次请求 → 1 次）；整批完成一次性重渲染（防逐条刷新闪烁/滚动跳动） */
function ensureWikiIndex() {
  var gen = ++wikiIdxGen;
  var stale = notes.filter(function (n) { var c = wikiBodies[n.id]; return !c || c.updatedAt !== (n.updatedAt || ''); });
  if (!stale.length) return;
  /* 失败口径（读路径降级）：整批一次性非阻断提示（不逐条刷屏），缺口条目留在 wikiBodies 外、下次刷新自动重试；界面有 preview/「索引中…」兜底 */
  rpc('notes-get-batch', { ids: stale.map(function (n) { return n.id }) }).then(function (res) {
    if (gen !== wikiIdxGen) return;
    if (res && res.error) throw new Error(res.error);   /* rpc 不 reject 业务错误，显式抛错进 catch（读路径静默群修复） */
    var got = 0;
    if (res && res.notes) res.notes.forEach(function (r) { wikiBodies[r.id] = { body: r.body || '', updatedAt: r.updatedAt || '' }; got++ });
    renderTree(); renderBacklinks();
    var failed = stale.length - got;   /* host missing 口径：已删/墓碑/不存在条目不计入 got */
    if (failed) toast(t('wiki.idxFailedPartial', { n: failed }))
  }).catch(function (e) {
    if (gen !== wikiIdxGen) return;
    toast(t('wiki.idxFailed', { n: stale.length, msg: e && e.message || e }))
  });
}
/* 行尾双链标记：缓存正文优先，索引未到时 preview（host slim 前 200 字符）兜底 */
function hasWikiLinks(n) { var c = wikiBodies[n.id]; return extractWikiTargets(c ? c.body : (n.preview || '')).length > 0; }
/* 双链跳转：解析 → 选中；目标被当前视图/筛选中心条件藏掉时退回「全部」（搜索词不动，保留用户上下文） */
function jumpToWikiTarget(target) {
  var n = resolveWikiTarget(target);
  if (!n) { toast(t('wiki.targetNotFound', { target: target })); return; }
  var vis = (view.type === 'all' || (view.type === 'folder' && (n.folder || '') === view.id) || (view.type === 'topic' && (n.topic || '') === view.id))
    && matchFilters(n, filters);
  if (!vis) { view = { type: 'all', id: '' }; clearFilters(); maybeReloadForLogs(); }
  selectNote(n.id);
}
/* 反向链接面板：全库正文含 [[当前id]]/[[当前标题]] 的其他笔记（点击跳转；索引未热提示「索引中…」） */
function renderBacklinks() {
  var host = $('backlinksHost');
  if (!host) return;
  if (!edNote) { host.innerHTML = ''; return; }
  var warm = notes.every(function (n) { return !!wikiBodies[n.id]; });
  var bl = [];
  notes.forEach(function (n) {
    if (n.id === edNote.id) return;   // 自链不算反向链接
    var c = wikiBodies[n.id];
    if (!c) return;                   // 索引未到的条目暂不计（标题行已提示索引中）
    if (wikiLinksTo(c.body, edNote.id, edNote.title || '')) bl.push(n);
  });
  /* i18n 覆盖卡F：反向链接标题/条目 tooltip/空态复用 B 卡 editor.backlinks* 字典 + A 卡 tree.untitled（禁重复建别名） */
  var h = '<div class="bl-t">' + icon('i-link', 11) + ' ' + t('editor.backlinks') + (warm ? t('editor.backlinksCount', { n: bl.length }) : t('editor.backlinksWarming')) + '</div>';
  if (bl.length) {
    h += '<div class="bl-list">' + bl.map(function (n) {
      return '<span class="bl-item" data-bl="' + n.id + '" title="' + t('editor.backlinkJumpTip', { name: esc(n.title || t('tree.untitled')) }) + '"><span class="kind" style="background:' + (KCOLOR[n.kind] || KCOLOR.note) + '"></span>' + esc(n.title || t('tree.untitled')) + '</span>';
    }).join('') + '</div>';
  } else if (warm) { h += '<div class="bl-empty">' + t('editor.backlinksEmpty') + '</div>'; }
  host.innerHTML = h;
  host.querySelectorAll('.bl-item').forEach(function (el) { el.addEventListener('click', function () { jumpToWikiTarget(el.getAttribute('data-bl')); }); });
}
function loadFolders() {
  return rpc('notes-folders').then(function (res) {
    if (res && res.error) throw new Error(res.error);   /* rpc 不 reject 业务错误，显式抛错进 catch（读路径静默群修复） */
    if (res && res.folders) {
      folders = res.folders;
      /* 清洗陈旧折叠态：剔除已删除文件夹的 id 残留（folders 异步到达后执行；foldOpen 语义=仅记折叠 id，残留虽不影响渲染但会持续累积） */
      var changed = false;
      Object.keys(foldOpen).forEach(function (k) { if (!folders.some(function (f) { return f.id === k })) { delete foldOpen[k]; changed = true } });
      if (changed) saveFoldOpen();
    }
  }).catch(function (e) { toast(t('fld.loadFailed', { msg: e && e.message || e })) })   /* 失败非阻断：树保持旧值但用户可见 */
}
// 注入范围浮层会话源：titlesPending 时 1.5s 重拉直到补齐（0.1.7 首屏提速契约）
var sessPullTimer = null;
function pullSessions() {
  rpc('notes-sessions', {}).then(function (res) {
    if (res && res.error) throw new Error(res.error);   /* 显式抛错进 catch（读路径静默群修复） */
    if (!res) return;
    if (res.sessions) sessList = res.sessions;
    sessPending = res.titlesPending && Array.isArray(res.pendingSessions) ? res.pendingSessions : [];
    if (scopeOpen) renderScopePanel();
    if (res.titlesPending) sessPullTimer = setTimeout(pullSessions, 1500);
  }).catch(function (e) { toast(t('mem.sessLoadFailed', { msg: e && e.message || e })) })   /* 失败非阻断：浮层保持旧值但用户可见；重试定时器仅在成功链路上挂，catch 不构成轮询刷 toast（i18n 覆盖卡F：复用 D 卡 mem.sessLoadFailed） */
}

