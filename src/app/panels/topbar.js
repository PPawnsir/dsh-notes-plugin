/* ================= 顶栏：刷新 / 归档 / 主题 ================= */
/* 刷新假阳性修复（R-2）：等 loadNotes 真实结果——失败（res.error/网络异常）时 loadNotes 已弹「列表加载失败」，这里不再无条件报喜 */
$('btnRefresh').addEventListener('click', function () { searchIds = null; var p = loadNotes(); if (sessList.length) pullSessions(); p.then(function (ok) { if (ok) toast(t('common.refreshed')) }) });
$('btnArchive').addEventListener('click', openArchive);
/* 0.4.6-C（notes-046-ux-discovery）：顶栏「建议」入口（计数徽标 #suggestBd 由 modals/suggest.js renderSuggestBadge 驱动）；
   启动即拉一次计数（notes-suggest dry-run 零写入），后续随 loadNotes 链尾节流刷新（kernel/data.js） */
$('btnSuggest').addEventListener('click', function () { openSuggest() });
refreshSuggestBadge();
$('btnSelMode').addEventListener('click', function () { selMode = !selMode; selIds = {}; renderTree() });
/* ===== 壳静态文案 i18n（notes-042-i18n-cov-a 覆盖卡A：顶栏 + 侧栏架 + hintbar + selbar）=====
   body.html 静态串保留中文缺省（原型不双语红线不动；静态锚点断言兼容），本函数按当前语言态以 t() 重写：
   文本走 textContent，title/placeholder/aria-label 走属性，含 <b> 的 hint.select 走 innerHTML（字典固定串、零插值、零 XSS 面）。
   调用点：本模块装载即一次（启动本地化）+ renderTree() 首行（setLang → render() 全量刷新路径随树渲染收敛）。 */
function renderChrome() {
  $('topSub').textContent = t('topbar.subtitle');
  $('btnRefresh').title = t('topbar.refreshTip'); $('btnRefresh').querySelector('.tb-t').textContent = t('topbar.refresh');
  $('btnArchive').title = t('topbar.archiveTip'); $('btnArchive').querySelector('.tb-t').textContent = t('topbar.archive');
  $('btnSuggest').querySelector('.tb-t').textContent = t('topbar.suggest');   /* 0.4.6-C：title 由 renderSuggestBadge 按计数态写（suggestTip/suggestTipN） */
  renderSuggestBadge();
  $('btnTheme').title = t('topbar.themeTip'); $('btnTheme').querySelector('.tb-t').textContent = t('topbar.theme');
  $('btnHome').title = t('topbar.homeTip'); $('btnHome').querySelector('.tb-t').textContent = t('topbar.home');
  $('brandName').textContent = t('side.brand');
  $('btnNew').title = t('side.newTip');
  $('q').placeholder = t('topbar.searchPlaceholder');
  $('btnFilter').title = t('topbar.filterTip'); $('btnFilter').querySelector('span').textContent = t('topbar.filter');
  $('btnSort').title = t('topbar.sortTip');
  $('fpop').setAttribute('aria-label', t('topbar.filterAria'));
  $('btnTrash').title = t('topbar.trashTip'); $('btnTrashT').textContent = t('topbar.trash');
  $('btnSelMode').title = t('topbar.selectTip'); $('btnSelModeT').textContent = t('topbar.select');
  $('btnSettingsT').textContent = t('common.settings');
  $('splitter').title = t('side.splitterTip');
  $('hintSelect').innerHTML = t('hint.select');
  $('hintDrag').textContent = t('hint.drag');
  $('hintFolder').textContent = t('hint.folder');
  $('hintKeys').textContent = t('hint.keys');
  $('selMerge').textContent = t('sel.merge');
  $('selDelete').textContent = t('common.delete');
  $('selCancel').textContent = t('common.cancel');
  /* 编辑器 CSS content 占位串（notes-042-i18n-cov-b）：head.html 静态 zh 缺省保留（var() 回退值），
     本函数按语言态写 CSS 变量完成运行时重写（同本函数壳文案模式）；key 复用 A 卡 tree.untitled，不重复建 */
  var docStyle = document.documentElement.style;
  docStyle.setProperty('--i18n-ed-title-ph', '"' + t('tree.untitled') + '"');
  docStyle.setProperty('--i18n-ed-rich-ph', '"' + t('editor.richPlaceholder') + '"');
}
renderChrome();
