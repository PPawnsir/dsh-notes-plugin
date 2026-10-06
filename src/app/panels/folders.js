/* ================= 文件夹管理（notes-folders op 契约；嵌套 parent 语义 = notes-nested-folder-ui） ================= */
/* 弃原生 prompt（n-mut46q00c3yw：自动化环境静默失效）——新建/重命名走 openFolderInputModal 自定义弹层（空名/同级重名内联拦截） */
/* i18n 覆盖卡F（E 卡交接项）：传给 openFolderInputModal 的 opts.title/okText 调用方传参处 t() 化（弹窗本体 fld.* 已由 E 卡建；
   注释不得插在 function 首行与 openFolderInputModal 调用之间——55 节正则锚定「首行即开弹层」） */
function doCreateFolder(parentId) {
  openFolderInputModal({
    title: parentId ? t('fld.titleNewSub') : t('fld.titleNew'),
    parentId: parentId || '',
    okText: t('fld.okNew'),
    onOk: function (name) {
      /* 嵌套：parent 缺省=''根级；深度上限/父不存在由 host checkFolderAttach 拒绝 → 错误串去 RPC 前缀后 toast（友好提示） */
      rpc('notes-folders', { op: 'create', name: name.trim(), parent: parentId || '' }).then(function (res) {
        if (res && res.error) { toast(String(res.error).replace(/^notes-folders\.\w+\s*/, '')); return }
        toast(t('fld.created', { name: name.trim() }));
        if (res && res.folder && res.folder.id) { if (parentId) { foldOpen[parentId] = true } foldOpen[res.folder.id] = true; saveFoldOpen() }   /* 0.4.3⑦：文件视图拆除——建成即展开（不再进文件夹视图） */
        loadNotes(true);
      }).catch(function (e) { toast(t('fld.createFailed', { msg: e && e.message || e })) });
    }
  });
}
function doRenameFolder(f) {
  openFolderInputModal({
    title: t('fld.titleRename'),
    value: f.name,
    parentId: f.parent || '',
    excludeId: f.id,
    okText: t('fld.okRename'),
    onOk: function (name) {
      if (name === f.name) return;   /* 名字未变不发 RPC（弹层已 trim + 同级重名拦截） */
      rpc('notes-folders', { op: 'rename', id: f.id, name: name.trim() }).then(function (res) {
        if (res && res.error) { toast(res.error); return }
        toast(t('fld.renamed', { name: name.trim() }));
        loadNotes(true);
      }).catch(function (e) { toast(t('fld.renameFailed', { msg: e && e.message || e })) });
    }
  });
}
function doDeleteFolder(f) {
  /* 级联删除 confirm（notes-nested-folder-ui）：本地从 folders/notes 清单按子树预估（host 无 dry-run 参数；
     子树语义与 host cascade 统计同源 folderSubtreeIds）——明示「连子删除：N 子文件夹 + M 笔记移入回收站；文件夹结构不可恢复」 */
  var sub = folderSubtree(f.id);
  var childN = folders.filter(function (x) { return x.id !== f.id && sub[x.id] }).length;
  var noteN = notes.filter(function (n) { return !n.deleted && sub[n.folder || ''] }).length;
  var msg = (childN || noteN)
    ? t('fld.delConfirmCascade', { name: f.name, childN: childN, noteN: noteN })
    : t('fld.delConfirmEmpty', { name: f.name });
  if (!confirm(msg)) return;
  rpc('notes-folders', { op: 'delete', id: f.id, cascade: true }).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    toast(t('fld.deleted', { name: f.name }) + ((childN || noteN) ? t('fld.deletedDetail', { childN: childN, noteN: noteN }) : ''));
    loadNotes(true);
  }).catch(function (e) { toast(t('fld.deleteFailed', { msg: e && e.message || e })) });
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
  }).catch(function (e) { toast(t('fld.sortFailed', { msg: e && e.message || e })) });
}
/* 拖拽换父（notes-nested-folder-ui）：reorder parents 改挂；cycle/自挂本地先拦（省一次 RPC 的友好 toast）；
   深度上限由 host checkFolderAttach 拒绝 → 错误串去 RPC 前缀后 toast；'' = 移回根级 */
function reparentFolder(fid, parentId) {
  var f = folders.find(function (x) { return x.id === fid });
  if (!f || (f.parent || '') === (parentId || '')) return;
  if (parentId) {
    if (parentId === fid) { toast(t('fld.errSelf')); return }
    if (folderSubtree(fid)[parentId]) { toast(t('fld.errCycle')); return }
  }
  var parents = {}; parents[fid] = parentId || '';
  rpc('notes-folders', { op: 'reorder', ids: folders.map(function (x) { return x.id }), parents: parents }).then(function (res) {
    if (res && res.error) { toast(String(res.error).replace(/^notes-folders\.\w+\s*/, '')); return }
    if (parentId) { foldOpen[parentId] = true; saveFoldOpen() }
    toast(parentId ? t('fld.movedInto', { name: fname(parentId) }) : t('fld.movedRoot'));
    loadNotes(true);
  }).catch(function (e) { toast(t('fld.moveFailed', { msg: e && e.message || e })) });
}
/* 0.4.4-D hidden 隐藏属性：文件夹显隐开关（notes-folders op:'set-flags'）——隐藏后该夹行+nested 子树滤除（OS 语义；
   显隐开关开时半透明渲染可再操作）；host 语义零改动，纯 UI 遮罩 */
function doSetFolderHidden(f, hidden) {
  rpc('notes-folders', { op: 'set-flags', id: f.id, hidden: hidden === true }).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    toast(hidden === true ? t('fld.hiddenToast', { name: f.name }) : t('fld.unhiddenToast', { name: f.name }));
    loadNotes(true);
  }).catch(function (e) { toast(t('fld.hideFailed', { msg: e && e.message || e })) });
}
/* 文件夹右键菜单（嵌套：新建子文件夹 / 移回根级（有父级时）/ 隐藏此文件夹·取消隐藏（0.4.4-D））；
   0.4.3⑦：文件夹右键「进视图」菜单项随文件视图模式拆除移除（树展开即文件夹浏览） */
function openFolderMenu(x, y, fid) {
  var f = folders.find(function (z) { return z.id === fid });
  if (!f) return;
  var host = $('ctxHost');
  host.innerHTML = '<div class="ctxmenu" id="ctxMenu">'
    + '<div class="mi" data-a="sub">' + icon('i-plus') + t('fld.titleNewSub') + '</div>'
    + '<div class="mi" data-a="rename">' + icon('i-note') + t('fld.okRename') + '</div>'
    + '<div class="mi" data-a="up">' + icon('i-up') + t('fld.menuUp') + '</div>'
    + '<div class="mi" data-a="down">' + icon('i-down') + t('fld.menuDown') + '</div>'
    + ((f.parent || '') ? '<div class="mi" data-a="root">' + icon('i-up') + t('fld.menuRoot') + '</div>' : '')
    + '<div class="mi" data-a="hide">' + icon('i-eye') + (f.hidden === true ? t('fld.menuUnhide') : t('fld.menuHide')) + '</div>'
    + '<div class="mi danger" data-a="del">' + icon('i-trash') + t('common.delete') + '</div></div>';
  var m = $('ctxMenu');
  m.style.left = Math.min(x, innerWidth - 170) + 'px';
  m.style.top = Math.min(y, innerHeight - 250) + 'px';
  m.addEventListener('click', function (ev) {
    var mi = ev.target.closest('.mi'); if (!mi) return;
    closeCtx();
    var a = mi.dataset.a;
    if (a === 'sub') doCreateFolder(f.id);
    else if (a === 'rename') doRenameFolder(f);
    else if (a === 'up') doReorderFolder(f, -1);
    else if (a === 'down') doReorderFolder(f, 1);
    else if (a === 'root') reparentFolder(f.id, '');
    else if (a === 'hide') doSetFolderHidden(f, !(f.hidden === true));
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

