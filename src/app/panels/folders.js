/* ================= 文件夹管理（notes-folders op 契约；嵌套 parent 语义 = notes-nested-folder-ui） ================= */
function doCreateFolder(parentId) {
  var name = prompt(parentId ? '在「' + fname(parentId) + '」下新建子文件夹：' : '新文件夹名称：');
  if (!name || !name.trim()) return;
  /* 嵌套：parent 缺省=''根级；深度上限/父不存在由 host checkFolderAttach 拒绝 → 错误串去 RPC 前缀后 toast（友好提示） */
  rpc('notes-folders', { op: 'create', name: name.trim(), parent: parentId || '' }).then(function (res) {
    if (res && res.error) { toast(String(res.error).replace(/^notes-folders\.\w+\s*/, '')); return }
    toast('已建文件夹「' + name.trim() + '」');
    if (res && res.folder && res.folder.id) { if (parentId) { foldOpen[parentId] = true } foldOpen[res.folder.id] = true; saveFoldOpen(); view = { type: 'folder', id: res.folder.id } }
    loadNotes(true);
  }).catch(function (e) { toast('建文件夹失败：' + (e && e.message || e)) });
}
function doRenameFolder(f) {
  var name = prompt('重命名文件夹：', f.name);
  if (!name || !name.trim() || name.trim() === f.name) return;
  rpc('notes-folders', { op: 'rename', id: f.id, name: name.trim() }).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    toast('已重命名为「' + name.trim() + '」');
    loadNotes(true);
  }).catch(function (e) { toast('重命名失败：' + (e && e.message || e)) });
}
function doDeleteFolder(f) {
  /* 级联删除 confirm（notes-nested-folder-ui）：本地从 folders/notes 清单按子树预估（host 无 dry-run 参数；
     子树语义与 host cascade 统计同源 folderSubtreeIds）——明示「连子删除：N 子文件夹 + M 笔记移入回收站；文件夹结构不可恢复」 */
  var sub = folderSubtree(f.id);
  var childN = folders.filter(function (x) { return x.id !== f.id && sub[x.id] }).length;
  var noteN = notes.filter(function (n) { return !n.deleted && sub[n.folder || ''] }).length;
  var msg = (childN || noteN)
    ? '删除文件夹「' + f.name + '」？连子删除：' + childN + ' 个子文件夹 + ' + noteN + ' 条笔记移入回收站（可恢复）；文件夹结构不可恢复。'
    : '删除空文件夹「' + f.name + '」？';
  if (!confirm(msg)) return;
  rpc('notes-folders', { op: 'delete', id: f.id, cascade: true }).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    /* 当前文件夹视图落在被删子树内 → 回全部视图（视图 id 悬空会显示空名单） */
    if (view.type === 'folder' && sub[view.id]) view = { type: 'all', id: '' };
    toast('已删除文件夹「' + f.name + '」' + ((childN || noteN) ? '（含 ' + childN + ' 个子文件夹，' + noteN + ' 条笔记已入回收站）' : ''));
    loadNotes(true);
  }).catch(function (e) { toast('删除失败：' + (e && e.message || e)) });
}
function doReorderFolder(f, delta) {
  /* 嵌套语义：上移/下移在同级兄弟内换位（全局 ids 提交，host 归一化 order；两 id 原位互换，非兄弟相对位次不动） */
  var sibs = folderKids(f.parent || '');
  var si = sibs.findIndex(function (x) { return x.id === f.id });
  var sj = si + delta;
  if (si < 0 || sj < 0 || sj >= sibs.length) return;
  var other = sibs[sj];
  var ids = folders.map(function (x) { return x.id });
  var i = ids.indexOf(f.id), j = ids.indexOf(other.id);
  ids[i] = other.id; ids[j] = f.id;
  rpc('notes-folders', { op: 'reorder', ids: ids }).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    loadNotes(true);
  }).catch(function (e) { toast('排序失败：' + (e && e.message || e)) });
}
/* 拖拽换父（notes-nested-folder-ui）：reorder parents 改挂；cycle/自挂本地先拦（省一次 RPC 的友好 toast）；
   深度上限由 host checkFolderAttach 拒绝 → 错误串去 RPC 前缀后 toast；'' = 移回根级 */
function reparentFolder(fid, parentId) {
  var f = folders.find(function (x) { return x.id === fid });
  if (!f || (f.parent || '') === (parentId || '')) return;
  if (parentId) {
    if (parentId === fid) { toast('文件夹不能挂到自己下面'); return }
    if (folderSubtree(fid)[parentId]) { toast('文件夹不能挂到自己的子孙文件夹下面（cycle）'); return }
  }
  var parents = {}; parents[fid] = parentId || '';
  rpc('notes-folders', { op: 'reorder', ids: folders.map(function (x) { return x.id }), parents: parents }).then(function (res) {
    if (res && res.error) { toast(String(res.error).replace(/^notes-folders\.\w+\s*/, '')); return }
    if (parentId) { foldOpen[parentId] = true; saveFoldOpen() }
    toast(parentId ? '已移入「' + fname(parentId) + '」' : '已移回根级');
    loadNotes(true);
  }).catch(function (e) { toast('移动失败：' + (e && e.message || e)) });
}
/* 文件夹右键菜单（嵌套：新建子文件夹 / 移回根级（有父级时）） */
function openFolderMenu(x, y, fid) {
  var f = folders.find(function (z) { return z.id === fid });
  if (!f) return;
  var host = $('ctxHost');
  host.innerHTML = '<div class="ctxmenu" id="ctxMenu">'
    + '<div class="mi" data-a="view">' + icon('i-filter') + '进入文件夹视图</div>'
    + '<div class="mi" data-a="sub">' + icon('i-plus') + '新建子文件夹</div>'
    + '<div class="mi" data-a="rename">' + icon('i-note') + '重命名</div>'
    + '<div class="mi" data-a="up">' + icon('i-up') + '上移</div>'
    + '<div class="mi" data-a="down">' + icon('i-down') + '下移</div>'
    + ((f.parent || '') ? '<div class="mi" data-a="root">' + icon('i-up') + '移回根级</div>' : '')
    + '<div class="mi danger" data-a="del">' + icon('i-trash') + '删除</div></div>';
  var m = $('ctxMenu');
  m.style.left = Math.min(x, innerWidth - 170) + 'px';
  m.style.top = Math.min(y, innerHeight - 250) + 'px';
  m.addEventListener('click', function (ev) {
    var mi = ev.target.closest('.mi'); if (!mi) return;
    closeCtx();
    var a = mi.dataset.a;
    if (a === 'view') { view = { type: 'folder', id: f.id }; foldOpen[f.id] = true; saveFoldOpen(); render(); }
    else if (a === 'sub') doCreateFolder(f.id);
    else if (a === 'rename') doRenameFolder(f);
    else if (a === 'up') doReorderFolder(f, -1);
    else if (a === 'down') doReorderFolder(f, 1);
    else if (a === 'root') reparentFolder(f.id, '');
    else if (a === 'del') doDeleteFolder(f);
  });
}
function closeCtx() { $('ctxHost').innerHTML = '' }
document.addEventListener('mousedown', function (ev) {
  if (!ev.target.closest('.ctxmenu')) closeCtx();
  if (!ev.target.closest('#scopeWrap')) { if (scopeOpen) { scopeOpen = false; renderScopePanel() } }
  /* 筛选中心浮层：点击外部关闭（popover + 排序菜单均在 #filterbar 内，同一选择器覆盖） */
  if (!ev.target.closest('#filterbar')) { if (filterOpen || sortOpen) { filterOpen = false; sortOpen = false; renderFilterBar() } }
});

