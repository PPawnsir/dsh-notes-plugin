/* ================= 常量与状态 ================= */
var KIND = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志' };
var KCOLOR = { note: 'var(--kind-note)', decision: 'var(--kind-decision)', todo: 'var(--kind-todo)', link: 'var(--kind-link)', quote: 'var(--kind-quote)', log: 'var(--kind-log)' };
/* 二期：kind 模板骨架（新建预填）——与 host-impl.js / index.mjs / client-impl.js / 原型同一份（check.js 断言一致）；
   note 为自由格式（空骨架）；机器/运维信息类由 ✨整理按内容套用机器模板（建时无法预判内容，不进 KIND_TEMPLATES） */
var KIND_TEMPLATES = {
  note: '',
  decision: '## 背景\n\n（问题与上下文）\n\n## 结论\n\n（最终选择）\n\n## 理由\n\n（权衡与依据）\n',
  todo: '- [ ] （待办事项）\n',
  link: '## 链接\n\n（URL）\n\n## 说明\n\n（用途与要点）\n',
  quote: '> （引用原文）\n\n—— （出处）\n',
  /* 工作记忆 v0 工作日志模板（design/agent-memory-v0.md §4.2 四节结构；同日追加尾部加「## HH:mm 续」小节） */
  log: '## 做了什么\n\n（本会话完成的任务/阶段，一句话一条）\n\n## 改动\n\n（改动的文件/配置/数据，路径 + 一句话）\n\n## 遗留与后续\n\n（未完成事项、已知风险、下次接续的入口）\n\n## 相关笔记\n\n（[[n-xxxxxxxx]] 双链引用本库相关笔记；无则空）\n'
};
var STATUS_LABEL = { active: '进行中', pinned: '置顶', resolved: '已解决', superseded: '已取代' };
var notes = [];              // slim 列表缓存（常驻内存；写操作后静默回填）
var folders = [];            // 虚拟文件夹清单 [{id,name,order,count}]
var view = { type: 'all', id: '' };   // all | folder | topic
/* ===== 筛选中心状态（design/notes-filter-center.html 落地）：组内 OR / 跨组 AND；与文件夹/主题视图/搜索 AND 叠加；localStorage 持久化 ===== */
var _fs = loadFilters();               // 持久化恢复（dsh-notes-app-filters）
var filters = _fs.filters;             // {pinned, injected, injectEver, sensitive, kinds[]}（injectEver 由 notes-inject-filter 提供，feature-detect）
var sortBy = _fs.sortBy;               // time=按更新（缺省，与 host _list 一致）| use=按被引用次数降序 | rel=相关度（搜索时：标题>标签>正文，同级 updatedAt 降序）
var filterOpen = false;      // 筛选 popover 浮层开关
var sortOpen = false;        // 排序菜单浮层开关
/* 筛选中心条件模型（四端同构：client-impl.js / 本页 / 原型 / check.js 断言一致） */
var FILTER_STATUS = [
  { id: 'pinned', label: '置顶', icon: 'i-pin', pred: function (n) { return n.status === 'pinned' } },
  { id: 'injected', label: '已注入', icon: 'i-bolt', pred: function (n) { return n.inject === true } },
  { id: 'injectEver', label: '曾注入', icon: 'i-clock', pred: function (n) { return n.injectEver === true } },   /* 含已注入；字段由 notes-inject-filter 提供 */
  { id: 'sensitive', label: '敏感', icon: 'i-lock', pred: function (n) { return n.sensitive === true } }
];
var FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log'];   /* 工作记忆 v0：类型组 + log（日志默认隐身——勾选「日志」即专入口，host 端 includeLogs 召回） */
var FILTER_SORTS = [
  { id: 'time', label: '时间', desc: '置顶优先 · 更新降序（默认）' },
  { id: 'use', label: '引用', desc: '被引用次数降序' },
  { id: 'rel', label: '相关度', desc: '搜索打分（搜索时生效）' }
];
function loadFilters() {
  var F = { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] };
  try {
    var v = localStorage.getItem('dsh-notes-app-filters');
    if (!v) return { filters: F, sortBy: 'time' };
    var s = JSON.parse(v) || {};
    if (s.filters) {
      ['pinned', 'injected', 'injectEver', 'sensitive'].forEach(function (k) { F[k] = s.filters[k] === true });
      if (Array.isArray(s.filters.kinds)) F.kinds = s.filters.kinds.filter(function (k) { return !!KIND[k] });
    }
    return { filters: F, sortBy: (s.sortBy === 'use' || s.sortBy === 'rel') ? s.sortBy : 'time' };
  } catch (e) { return { filters: F, sortBy: 'time' } }
}
function saveFilters() { try { localStorage.setItem('dsh-notes-app-filters', JSON.stringify({ filters: filters, sortBy: sortBy })) } catch (e) {} }
function filtersActiveCount() { var n = filters.kinds.length; FILTER_STATUS.forEach(function (s) { if (filters[s.id]) n++ }); return n }
/* 曾注入条件 feature-detect：列表 slim 含 injectEver 字段才显示该选项（host 未提供时隐藏；存量激活条件仍渲染 chip 可 × 移除） */
function hasInjectEver() { return notes.some(function (n) { return n.injectEver !== undefined }) }
/* 筛选谓词（纯函数，check.js 提取做语义回归）：状态组组内 OR、类型组组内 OR、跨组 AND */
function matchFilters(n, F) {
  var st = [];
  if (F.pinned) st.push(n.status === 'pinned');
  if (F.injected) st.push(n.inject === true);
  if (F.injectEver) st.push(n.injectEver === true);
  if (F.sensitive) st.push(n.sensitive === true);
  if (st.length && st.indexOf(true) < 0) return false;
  if (F.kinds.length && F.kinds.indexOf(n.kind || 'note') < 0) return false;
  return true;
}
function clearFilters() { filters = { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] }; saveFilters() }
function sortLabel() { for (var i = 0; i < FILTER_SORTS.length; i++) if (FILTER_SORTS[i].id === sortBy) return FILTER_SORTS[i].label; return '时间' }
var searchText = '', searchIds = null; // searchIds=null=仅本地过滤；数组=host 全文命中 ∪ 本地命中
var searchMeta = {};         // host notes-search 返回的命中字段（noteId → ['title'|'tags'|'body']），相关度排序数据源
var selId = null, edNote = null;       // edNote = 当前选中笔记完整体（含 body）
var edLoading = false;                 /* 正文异步加载中：doSave 省略 body 字段（防竞态清空正文） */
var dragId = null, dragFolderId = null, saveTimer = null, searchTimer = null;   /* dragFolderId = 文件夹换父拖拽源（与笔记拖拽互斥） */
/* ===== 双模式编辑器 v3 状态（原型 design/notes-editor-v3.html）===== */
var edMode = 'source';                 // 'source' 源码 | 'rich' 富文本（受限 WYSIWYG）；Ctrl+/ 或 meta 行两段开关切换
var richDirty = false;                 // 富文本编辑中（未序列化回源码）
var composing = false;                 // IME 组合输入中（期间不序列化）
var savedRange = null;                 // 富文本选区缓存（工具栏/弹窗操作后恢复）
var degraded = { ok: true, reasons: [] };  // 白名单降级分析（analyzeMarkdown 内核）
var richSyncTimer = null, degTimer = null;
var imgDraft = null, imgUploading = false; // 图片插入弹窗草稿 + 上传中标记（三入口共用：粘贴/拖拽/工具栏按钮）
var sessList = [], sessPending = [];   // 注入范围浮层会话源（notes-sessions）
var foldOpen = loadFoldOpen();         // 文件夹折叠态（localStorage；缺省全展开）
var topicOpen = {};                    // 主题过滤行原地展开态（点行主体=展开/收起子列表；session 内有效，不持久化）
var topicSecOpen = false;              // 主题过滤区整体折叠态（缺省折叠：常态只显示「主题 (N)」一行，点分组头展开；session 内记忆，不持久化）
var scopeOpen = false;
/* ===== 显式归档 UI + 手动笔记多选合并（契约：notes-archive-preview / notes-archive {groups:[{memberIds,title?}]} / notes-archive-undo） ===== */
var selMode = false, selIds = {};      // 列表多选态 + 勾选集合（noteId → true；与搜索/过滤共存，按 id 记账）
var archState = null;                  // 归档预览对话框状态：{ groups:null=加载中, checked:{sid:false=取消勾选}, expand:{sid:true}, pending }
/* ===== 二期 ✨整理（notes-ai-organize 按 kind 模板重写正文，可撤销）+ 孤儿资产清理（notes-assets-prune） ===== */
var organizing = false, organizeUndo = null;   // organizeUndo = 一次撤销栈（整理前正文字符串 | null）
var pruneState = null;                 // 资产清理对话框状态：{ data:null=扫描中, checked:{name:false=取消勾选}, pending }
/* ===== P1 回收站（notes-list {includeDeleted:true} + notes-restore/notes-purge）===== */
var trashState = null;                 // 回收站对话框状态：{ list:null=加载中, pending:执行中的笔记 id }
/* ===== 历史版本面板（notes-history-ui：notes-history / notes-history-get / notes-restore-history）===== */
/* 入口可见性：选中笔记后 notes-history 探测版本计数（轻量列表 RPC，零正文明文），有版本才显示「历史」入口 */
var histState = null;                  // 历史面板对话框状态：{ list:null=加载中, sel:0=未选, preview:null, pending }
var histCount = null;                  // 当前笔记历史版本数（null=未探测；0=无版本不显示入口）
/* ===== 整理建议（notes-suggest 三类候选：速记组/过期未引用/孤儿——只提名不自动执行）===== */
var suggestState = null;               // 整理建议对话框状态：{ data:null=分析中, pending:批量软删执行中 }
/* ===== P2 笔记双链：全库正文惰性索引（列表瘦身不含 body；后台 notes-get 小批量补齐，驱动行尾双链标记与反向链接面板；host 不改）===== */
var wikiBodies = {};                   // noteId → { body, updatedAt }
var wikiIdxGen = 0;                    // 索引构建代际：列表刷新作废旧任务

