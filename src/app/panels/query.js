/* ================= 视图求值：标签 ∩ 筛选中心（状态组/类型组，组内 OR 跨组 AND）∩ 搜索 ================= */
/* 0.4.3⑦：「文件视图」（文件夹视图）模式整体拆除——view 取值收窄为 all | topic（树展开即文件夹浏览）；
   0.4.8（notes-048-topic-tag-merge）：view.type='topic' 语义切换为「标签视图」（view.id = 标签名，键名不动防地震），求值吃 effTags（tags ∪ topic 读侧虚拟合并） */
/* 遮罩谓词（0.4.6-H notes-046-smallfix，R2 n-mux9rpgowpz6/n-mux9r8hfh7xy）：hidden/sys 夹链遮罩段独立成函数——
   筛选面板选项计数经本谓词取「当前可见集」（与下方 matches() 的遮罩段逐字同口径，改动必须双边同步），
   消除「选项计数（缓存裸谓词）vs 命中数（matches 全管线）」两套口径；谓词不含筛选条件本身（选项计数 ≠ 命中数语义保留：
   状态组选项 = 可见集中满足该状态数，底部命中 = 可见集 ∩ 全部已选条件）。 */
function visMask(n) {
  if (!showHidden && (n.hidden === true || (n.folder && folderHidden(n.folder)))) return false
  if (!showHidden && !machineKindOn() && n.folder && folderSys(n.folder)) return false
  return true
}
function matches(n) {
  if (view.type === 'topic') { if (effTags(n).indexOf(view.id) < 0) return false }   /* 0.4.8：标签视图过滤吃 effTags（tags ∪ topic 虚拟合并；多值——含该标签即命中） */
  /* 0.4.4-D hidden 纯 UI 遮罩：显隐开关关 → hidden 笔记 + hidden 夹链内笔记滤除（OS 语义：父夹隐藏即子项不可见；
     note 级/folder 级独立判定；与筛选条件正交——不计 filtersActiveCount）；host 零改动；跳转/open-by-id 不经本函数天然常显 */
  if (!showHidden && (n.hidden === true || (n.folder && folderHidden(n.folder)))) return false;
  /* 0.4.4-G sys 机器属性：双通道（机器档/显示隐藏）均关时，sys 夹链内笔记随夹滤除（OS 父子树语义同 hidden；与⑨ 内容级 kind 谓词正交——⑨ 遮条目自身，本卡遮「夹归属」） */
  if (!showHidden && !machineKindOn() && n.folder && folderSys(n.folder)) return false;
  /* 日志同权（0.4.3⑦）：无隐身渲染守卫——日志与普通笔记同一过滤管线（类型组勾选「日志」= 只看日志，matchFilters 同语义） */
  if (!matchFilters(n, filters)) return false;
  if (searchText) {
    var q = searchText.toLowerCase();
    var local = ((n.title || '') + ' ' + (n.preview || '') + ' ' + effTags(n).join(' ') + ' ' + fname(n.folder)).toLowerCase().indexOf(q) >= 0;   /* 0.4.8：搜索 hay 改吃 effTags（tags ∪ topic 一句覆盖，存量 topic 可搜） */
    var remote = searchIds ? searchIds.indexOf(n.id) >= 0 : false;
    if (!local && !remote) return false;
  }
  return true;
}

/* ================= 相关度档位（搜索体验升级）：标题命中(3) > 标签命中(2) > 正文命中(1) > 其他(0)；同级 updatedAt 降序（比较在 renderTree）。
   0.4.8（notes-048-topic-tag-merge）：标签档本地估算吃 effTags（tags ∪ topic——存量 topic 命中现归标签档，不再是「其他」兜底） ================= */
function relRank(n, q) {
  var m = searchMeta[n.id];   /* host notes-search 返回的 matches 命中字段（全文口径）优先；无则按本地字段估算（preview 仅前 200 字，正文命中可能低估） */
  if (m && m.length) { if (m.indexOf('title') >= 0) return 3; if (m.indexOf('tags') >= 0) return 2; if (m.indexOf('body') >= 0) return 1; return 0 }
  if ((n.title || '').toLowerCase().indexOf(q) >= 0) return 3;
  if (effTags(n).join(' ').toLowerCase().indexOf(q) >= 0) return 2;
  if ((n.preview || '').toLowerCase().indexOf(q) >= 0) return 1;
  return 0;
}

