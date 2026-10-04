/* ================= 文件夹名称输入弹层（notes-041-folder-prompt：弃原生 prompt） =================
   反馈 n-mut46q00c3yw：原生 prompt 无样式/无校验，自动化环境静默失效——新建/重命名文件夹改纯 DOM 自定义弹层。
   校验（内联红字，不发 RPC）：空名拒绝 + 同级重名拒绝（名单 = folderKids(parentId) 去 excludeId；
   host create/rename 本身不做重名校验，此处为本地 UX 拦截，口径与 folderKids 同级兄弟语义一致）。
   Enter 提交 / Esc·点遮罩·「取消」关闭（Esc 走 keyboard.js modalHost 统一分支；遮罩走 openModal 自带 mousedown 分支）。 */
function openFolderInputModal(opts) {
  /* opts = { title, value?, parentId?, excludeId?, okText?, onOk(name) }
     excludeId：重命名时排除自身（自名不算重名）；parentId 缺省 ''=根级（副标题显示位置路径） */
  var parentId = opts.parentId || '';
  var sibNames = folderKids(parentId).filter(function (x) { return x.id !== opts.excludeId }).map(function (x) { return x.name });
  var where = parentId ? folderPath(parentId).map(function (f) { return f.name }).join(' / ') : '';
  openModal(
    '<div class="modal-t">' + icon('i-folder', 13) + ' ' + esc(opts.title) + '<span class="sub">' + (where ? esc(t('fld.where', { path: where })) : t('fld.root')) + '</span></div>'
    + '<input class="minput" id="fldName" maxlength="60" placeholder="' + t('fld.namePlaceholder') + '" value="' + esc(opts.value || '') + '">'
    + '<div class="modal-err" id="mErr" style="display:none"></div>'
    + '<div class="modal-acts"><button class="mbtn" id="fldCancel">' + t('common.cancel') + '</button><button class="mbtn primary" id="fldOk">' + esc(opts.okText || t('fld.okDefault')) + '</button></div>'
  );
  var inp = $('fldName');
  inp.focus(); inp.select();
  function submit() {
    var name = inp.value.trim();
    if (!name) { modalErr(t('fld.errEmpty')); inp.focus(); return }
    if (sibNames.indexOf(name) >= 0) { modalErr(t('fld.errDup', { name: name })); inp.focus(); inp.select(); return }
    closeModal();
    opts.onOk(name);
  }
  $('fldCancel').onclick = closeModal;
  $('fldOk').onclick = submit;
  inp.onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); submit() } };
}
