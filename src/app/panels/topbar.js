/* ================= 顶栏：刷新 / 建议 / 主题 ================= */
/* 刷新假阳性修复（R-2）：等 loadNotes 真实结果——失败（res.error/网络异常）时 loadNotes 已弹「列表加载失败」，这里不再无条件报喜 */
/* 0.4.7-B②a（notes-047-ux）：顶栏「速记合并」按钮撤除（与建议器首段「速记组 → 去归档」入口重复）——归档预览入口保留在建议器内 */
$('btnRefresh').addEventListener('click', function () { searchIds = null; var p = loadNotes(); if (sessList.length) pullSessions(); p.then(function (ok) { if (ok) toast(t('common.refreshed')) }) });
/* 0.4.6-C（notes-046-ux-discovery）：顶栏「建议」入口（计数徽标 #suggestBd 由 modals/suggest.js renderSuggestBadge 驱动）；
   启动即拉一次计数（notes-suggest dry-run 零写入），后续随 loadNotes 链尾节流刷新（kernel/data.js） */
$('btnSuggest').addEventListener('click', function () { openSuggest() });
refreshSuggestBadge();
/* 0.4.8（notes-048-lang-topbar）：语言切换上顶栏（建议钮后）——两态直切无下拉，复用 setLang 既有生效链路
   （localStorage 'dsh-notes-lang' 持久化 + 全量 render；renderTree 首行 renderChrome 收敛重写本钮 title/文字） */
$('btnLang').addEventListener('click', function () { setLang(NOTES_LANG === 'en' ? 'zh' : 'en') });
$('btnSelMode').addEventListener('click', function () { selMode = !selMode; selIds = {}; renderTree() });
/* ===== 壳静态文案 i18n（notes-042-i18n-cov-a 覆盖卡A：顶栏 + 侧栏架 + hintbar + selbar）=====
   body.html 静态串保留中文缺省（原型不双语红线不动；静态锚点断言兼容），本函数按当前语言态以 t() 重写：
   文本走 textContent，title/placeholder/aria-label 走属性，含 <b> 的 hint.select 走 innerHTML（字典固定串、零插值、零 XSS 面）。
   调用点：本模块装载即一次（启动本地化）+ renderTree() 首行（setLang → render() 全量刷新路径随树渲染收敛）。 */
function renderChrome() {
  $('topSub').textContent = t('topbar.subtitle');
  $('btnRefresh').title = t('topbar.refreshTip'); $('btnRefresh').querySelector('.tb-t').textContent = t('topbar.refresh');
  $('btnSuggest').querySelector('.tb-t').textContent = t('topbar.suggest');   /* 0.4.6-C：title 由 renderSuggestBadge 按计数态写（suggestTip/suggestTipN） */
  renderSuggestBadge();
  /* 0.4.8（notes-048-lang-topbar）：语言钮 title 走字典（随当前语言）；文字 = 当前语言名原生写法（中文/English 硬编码不翻译，同原设置下拉先例） */
  $('btnLang').title = t('topbar.langTip'); $('btnLang').querySelector('.tb-t').textContent = NOTES_LANG === 'en' ? 'English' : '中文';
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
