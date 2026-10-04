// 搜索关键词 <mark> 高亮（搜索体验升级；与原型 notes-ui-v2.html 同源，check.js 断言一致）。
// 安全红线：先 esc 再包 <mark>——标题/查询词都先经 esc 转义，正则只对转义后文本起作用，插入的仅 <mark> 标签本身；
// 禁止直接 innerHTML 拼原文（本函数输出可安全进 innerHTML：原文中的脚本标签/img onerror 等已被转义为纯文本）。
// （置于内核块外：内核三端逐字节一致断言不覆盖本函数）
function hl(text, q) {
  var s = esc(text == null ? '' : text);
  var qs = esc(String(q == null ? '' : q).trim());
  if (!s || !qs) return s;
  var re = new RegExp('(' + qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return s.replace(re, '<mark>$1</mark>');
}
function icon(id, sz) { return '<svg class="ic"' + (sz ? ' style="width:' + sz + 'px;height:' + sz + 'px"' : '') + '><use href="#' + id + '"/></svg>' }
function fname(id) { var f = folders.find(function (x) { return x.id === id }); return f ? f.name : '' }
/* ===== 文件夹嵌套 helper（notes-nested-folder-ui；与 host folder-tree-helpers 同口径的本页版）=====
   folderKids(pid)=直接子级（folders 已由 host 按 order 排序，filter 保序）；folderSubtree(id)=子树 id 集合（含自身，BFS cycle 防御）；
   folderPath(id)=面包屑路径（根→…→当前，悬空/cycle 截断）；rootFolders()=根级清单（无 parent 或 parent 悬空按根级，与 host folderDepth 同口径） */
function folderKids(pid) { return folders.filter(function (x) { return (x.parent || '') === pid }) }
function folderSubtree(id) { var out = {}; out[id] = true; var q = [id]; while (q.length) { var c = q.shift(); folders.forEach(function (f) { if ((f.parent || '') === c && !out[f.id]) { out[f.id] = true; q.push(f.id) } }) } return out }
function folderPath(id) { var byId = {}; folders.forEach(function (f) { byId[f.id] = f }); var path = [], cur = id, seen = {}; while (cur && byId[cur] && !seen[cur]) { seen[cur] = true; path.unshift(byId[cur]); cur = byId[cur].parent || '' } return path }
function rootFolders() { var byId = {}; folders.forEach(function (f) { byId[f.id] = f }); return folders.filter(function (f) { return !(f.parent || '') || !byId[f.parent || ''] }) }
function shortSid(sid) { return sid ? String(sid).replace(/^session-/, '').slice(0, 8) : '' }
/* P3 派发闭环：单条派发完成判定（dispatchStatus==='done' 或存量 done===true 向后兼容） */
function isDispDone(d) { return !!(d && (d.dispatchStatus === 'done' || d.done === true)) }
function fmtDT(iso) { return iso ? String(iso).slice(0, 16).replace('T', ' ') : '' }
function fmtD(iso) { return iso ? String(iso).slice(5, 10) : '' }
function isPinned(n) { return n && n.status === 'pinned' }
function toast(m, act) {
  var t = $('toast');
  t.innerHTML = esc(m) + (act && act.label ? ' <a id="toastAct">' + esc(act.label) + '</a>' : '');
  t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show') }, act && act.label ? 4200 : 2200);
  if (act && act.label) $('toastAct').onclick = function () { t.classList.remove('show'); act.fn() };
}
function loadFoldOpen() { try { var v = localStorage.getItem('dsh-notes-app-foldopen'); return v ? JSON.parse(v) : {} } catch (e) { return {} } }
function saveFoldOpen() { try { localStorage.setItem('dsh-notes-app-foldopen', JSON.stringify(foldOpen)) } catch (e) {} }

