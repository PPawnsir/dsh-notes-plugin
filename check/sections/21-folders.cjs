// 节 21. 虚拟文件夹（folder 字段 + folders.json + notes-folders + move）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "21",
  title: "21. 虚拟文件夹（folder 字段 + folders.json + notes-folders + move）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, clientPkgSrc, ctx, findTool, fsMock, g, handlers, m1, m2, noteManage, plugin, r1, r2, store, t1, t3 } = S
  // ===== 21. 虚拟文件夹（folders.json 清单 + folder 字段 + notes-folders RPC + move + 过滤）=====
  section('21. 虚拟文件夹（folder 字段 + folders.json + notes-folders + move）')
  // 注意：section 17 用同一个 mock harness 应用过静态包 index.mjs，其 handlers 覆盖了开发版；
  // 本节断言的是开发版 folder 行为（静态包 folder 行为断言在 section 17），故重新 apply 开发版插件，
  // 把 handlers 还原为 host-impl 版本（同一 store，数据互通）。
  plugin.apply(ctx)
  const FOLDERS_PATH_MOCK = NOTES_DIR + '\\folders.json'

  // --- 源码结构断言（host 数据链路 / 工具 schema / client UI / 样式，开发版 + 发布包同步）---
  await t('host-impl folder 字段全链路（FM 写入 / 解析 / 瘦身 / 更新）', () => {
    assert(/'folder: ' \+ escYaml\(m\.folder \|\| ''\)/.test(hostSrc), 'buildFM 写 folder 行')
    assert(/folder: p\.meta\.folder \|\| ''/.test(hostSrc), 'noteFromParsed 读 folder（缺省 \'\'）')
    assert((hostSrc.match(/folder: n\.folder \|\| ''/g) || []).length >= 2, 'persistNote 与 slim 均带 folder')
    assert(/if \(folder !== undefined\) \{\s*\n\s*\/\/ folder 写入归一[\s\S]*?note\.folder = await _resolveFolderArg\(folder\)/.test(hostSrc), '_update 仅在显式传 folder 时改（undefined 不动；经 folder-arg-norm 名称→id 归一闸，节 58）')
  })
  await t('index.mjs folder 字段全链路 + notes-folders 注册（静态包与开发版同源）', () => {
    assert(/'folder: ' \+ escYaml\(m\.folder \|\| ''\)/.test(indexSrc), 'index.mjs buildFM 写 folder 行')
    assert(/folder: p\.meta\.folder \|\| ''/.test(indexSrc), 'index.mjs noteFromParsed 读 folder')
    assert((indexSrc.match(/folder: n\.folder \|\| ''/g) || []).length >= 2, 'index.mjs persistNote 与 slim 均带 folder')
    assert(/if \(folder !== undefined\) \{\s*\n\s*\/\/ folder 写入归一[\s\S]*?note\.folder = await _resolveFolderArg\(folder\)/.test(indexSrc), 'index.mjs _update 显式传 folder 才改（经 folder-arg-norm 归一闸）')
    assert(indexSrc.indexOf("FOLDERS_PATH = path.join(NOTES_ROOT, 'folders.json')") >= 0, 'index.mjs FOLDERS_PATH 落在 ~/.dsh/notes/folders.json')
    for (const fn of ['loadFolders', 'saveFolders', 'effectiveFolder', 'resolveFolderRef', 'genFolderId', '_folders', 'folderDepth', 'folderSubtreeIds', 'folderSubtreeHeight', 'checkFolderAttach', 'maxFolderDepthLimit']) {
      assert(indexSrc.indexOf('function ' + fn) >= 0, 'index.mjs 缺函数 ' + fn)
    }
    assert(/handle\('notes-folders'/.test(indexSrc), 'index.mjs 注册 notes-folders RPC（webServer 兜底路由经 handlers 表自动可达）')
    assert(/async function _list\(tag, kind, folder, includeDeleted, includeLogs, includeSys\)/.test(indexSrc) && /folderSubtree = \(folder !== undefined && folder !== ''\) \? folderSubtreeIds\(folder, folders\) : null/.test(indexSrc) && indexSrc.indexOf("if (folder === '') { if (ef !== '') continue }") >= 0, 'index.mjs _list 接 folder 递归子树过滤（folder-tree-helpers；第 4 参数 includeDeleted 回收站 / 第 5 参数 includeLogs 工作记忆日志召回 / 第 6 参数 includeSys 机器全量视图 0.4.3⑨）')
    assert(/async function _search\(query, tag, topic, kind, folder, filters\)/.test(indexSrc), 'index.mjs _search 接 folder（+ filters 组合过滤尾参，搜索体验升级）')
    assert(/enum: \['create', 'list', 'update', 'move', 'delete'/.test(indexSrc), 'index.mjs note_manage action enum 含 move')
  })
  await t('host-impl folders.json 清单模块 + notes-folders RPC 注册', () => {
    assert(hostSrc.indexOf("FOLDERS_PATH = NOTES_DIR + '\\\\folders.json'") >= 0, 'FOLDERS_PATH 落在 notes/folders.json')
    for (const fn of ['loadFolders', 'saveFolders', 'effectiveFolder', 'resolveFolderRef', 'genFolderId', '_folders', 'folderDepth', 'folderSubtreeIds', 'folderSubtreeHeight', 'checkFolderAttach', 'maxFolderDepthLimit']) {
      assert(hostSrc.indexOf('function ' + fn) >= 0, '缺函数 ' + fn)
    }
    assert(/JSON\.stringify\(list, null, 2\)/.test(hostSrc), 'saveFolders 持久化 JSON 清单')
    assert(/catch \(e\) \{ return \[\] \}/.test(hostSrc), 'loadFolders 损坏兜底空数组')
    assert.strictEqual(typeof handlers['notes-folders'], 'function', 'notes-folders handler 已注册')
  })
  await t('工具 schema：note_manage 含 move action + folder 参数；note_search 含 folder 参数', () => {
    const enumList = t3.parameters.properties.action.enum
    assert(enumList.indexOf('move') >= 0, 'note_manage action enum 应含 move（实得：' + JSON.stringify(enumList) + '）')
    assert(t3.parameters.properties.folder, 'note_manage 缺 folder 参数')
    assert(t1.parameters.properties.folder, 'note_search 缺 folder 参数')
    assert(t1.parameters.properties.folder.description.indexOf('unfiled') >= 0, 'note_search folder 说明应含未分类口径')
  })
  await t('client 树状文件夹结构（folder-row 节点 + 折叠态持久化 + notes-folders 加载，发布包同步）', () => {
    assert(/const \[folders, setFolders\] = React\.useState\(\[\]\)/.test(clientSrc), 'folders state 存在')
    assert(/const \[foldersExpanded, setFoldersExpanded\] = React\.useState\(loadFoldersExpanded\)/.test(clientSrc), 'foldersExpanded state 读 localStorage 初值')
    assert(clientSrc.indexOf("localStorage.getItem('dsh-notes-folders-expanded')") >= 0 && clientSrc.indexOf("localStorage.setItem('dsh-notes-folders-expanded', JSON.stringify(") >= 0, '折叠态持久化 localStorage(dsh-notes-folders-expanded)')
    assert(clientSrc.indexOf("localStorage.getItem('dsh-notes-folder')") < 0, '旧 folderSel 持久化键（dsh-notes-folder）已移除')
    assert(/host\.call\('notes-folders'\)/.test(clientSrc), 'loadFolders 走 notes-folders RPC')
    assert(/setFoldersExpanded\(prev => pruneFoldersExpanded\(prev, res\.folders\)\)/.test(clientSrc), '已删除文件夹的展开态残留自动清理（pruneFoldersExpanded）')
    for (const cls of ['dsh-notes-folder-row', 'dsh-notes-caret', 'dsh-notes-row-nm', 'dsh-notes-row-n', 'dsh-notes-ic-slot', 'dsh-notes-folder-rename', 'dsh-notes-sec-h-add']) {
      assert(clientSrc.indexOf(cls) >= 0, 'client-impl 缺 ' + cls)
      assert(clientPkgSrc.indexOf(cls) >= 0, '发布包 client.js 缺 ' + cls + '（需先跑 scripts/build-dist.cjs）')
    }
    // v2：文件夹行图标全部 SVG（caret chev + folder symbol），无 emoji
    assert(clientSrc.indexOf("I('folder', 13)") >= 0 && clientSrc.indexOf("I('chev', 10)") >= 0, '文件夹行 SVG 图标（folder + caret chev）')
    assert(clientSrc.indexOf('dsh-notes-folder-ic') < 0, 'client-impl 不含旧 folder-ic')
    assert(clientPkgSrc.indexOf('dsh-notes-folder-ic') < 0, '发布包 client.js 不含旧 folder-ic')
    assert(clientSrc.indexOf('📂') < 0, '文件夹行 📂 emoji 已移除')
    for (const gone of ['dsh-notes-folderbar', 'dsh-notes-folder-chip', 'loadFolderSel', 'saveFolderSel', 'selectFolder(']) {
      assert(clientSrc.indexOf(gone) < 0, 'client-impl 应已移除 ' + gone)
      assert(clientPkgSrc.indexOf(gone) < 0, '发布包 client.js 应已移除 ' + gone + '（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientSrc.indexOf('PINNED_KEY') >= 0 && clientSrc.indexOf('sec-pinned') >= 0, '树顶部保留「置顶」折叠组（PINNED_KEY）')
    assert(clientSrc.indexOf('新建文件夹') >= 0, '含「新建文件夹」入口（分组头 ＋ tooltip）')
    assert(clientPkgSrc.indexOf('notes-folders') >= 0, '发布包 client.js 含 notes-folders RPC 调用')
  })
  await t('client 树渲染逻辑（v2：视图头 / 置顶折叠组 / 文件夹嵌套 / 未入夹根级直显 / 主题全局过滤区 + 新建落位）', () => {
    assert(clientSrc.indexOf('const treeMode') < 0, 'v2 恒为树渲染（旧 treeMode 平铺退化已移除）')
    assert(/if \(n\.folder\) expandFolder\(n\.folder\)/.test(clientSrc), '选中笔记所在文件夹自动展开')
    assert(/function toggleFolder\(id\)/.test(clientSrc) && /function isFolderExpanded\(id\)/.test(clientSrc) && /function expandFolder\(id\)/.test(clientSrc), '折叠切换/判定/自动展开 helper 存在')
    assert(clientSrc.indexOf("className: 'dsh-notes-nested'") >= 0, '文件夹/主题分组子笔记 nested 渲染')
    assert(clientSrc.indexOf("folderSel === 'pinned'") < 0 && clientSrc.indexOf("folderSel !== 'all'") < 0, 'folderSel 过滤分支已移除')
    assert(clientSrc.indexOf('groupByTopic') < 0, '未分类主题二级分组已移除（未入夹笔记根级直显平铺，主题聚合由「主题过滤」区承担不重复）')
    assert(clientSrc.indexOf("const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })") >= 0, '未入夹笔记根级平铺直渲（无主题分组头/nested 包裹）')
    assert(clientSrc.indexOf('notes.forEach(n => { effTags(n).forEach(tg => { (allTags[tg] = allTags[tg] || {})[n.id] = true }) })') >= 0, '标签过滤区统计全库 effTags（0.4.8 多值分组：tags ∪ topic，不按当前过滤）')
    assert(/setView\(view\.type === 'topic' && view\.id === tn \? \{ type: 'all', id: '' \} : \{ type: 'topic', id: tn \}\)/.test(clientSrc), '主题行尾过滤图标切换主题视图/全部（行主体单击已让位原地展开）')
    assert(!/setView\(view\.type === 'folder'/.test(clientSrc), '0.4.3⑦：文件夹行尾过滤图标（进文件夹视图）已拆除——树展开即文件夹浏览')
    assert(clientSrc.indexOf("const createFolder = (selNote && selNote.folder) || ''") >= 0, '新建落位：选中笔记所在文件夹/未分类（文件夹视图落位分支随拆除移除）')
    assert(/payload\.folder = createFolder/.test(clientSrc), 'notes-create 携带 folder')
  })
  await t('目录树点击语义（行点击=纯展开/折叠）+ 文件视图拆除（文件夹行尾漏斗入口移除）+ 陈旧 id 清洗（四端同步）', () => {
    const appSrcT = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcT = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // ① 文件夹行主体单击 = 纯展开/折叠（经典树语义唯一职责，notes-041b 用户裁决去重）；caret 同一 toggle 语义（stopPropagation 防双触发）
    assert(clientSrc.indexOf("onClick: () => { toggleFolder(f.id) }") >= 0, '文件夹行主体 onClick = 纯展开/折叠（toggleFolder）')
    assert(clientSrc.indexOf("'data-tooltip': tt('tree.toggleTip'), onClick: (ev) => { ev.stopPropagation(); toggleFolder(f.id) }") >= 0, 'caret 同一展开/折叠语义（stopPropagation + tooltip；i18n 覆盖卡A 起走 t() 字典）')
    // ② 0.4.3⑦：文件夹行尾过滤图标（进文件夹视图）与「进入文件夹视图」菜单项已拆除；主题行尾过滤图标保留（主题视图不受影响）
    assert(clientSrc.indexOf("'dsh-notes-row-vfilter dsh-nt'") >= 0, '主题行尾过滤图标保留（dsh-notes-row-vfilter）')
    assert(clientSrc.indexOf("tt('tree.folderViewTip')") < 0, '文件夹行尾漏斗图标已移除（tree.folderViewTip 引用清零）')
    assert(!/ev\.stopPropagation\(\); setView\(view\.type === 'folder'/.test(clientSrc), '文件夹行尾图标进/出文件夹视图分支已移除')
    assert(clientSrc.indexOf('进入文件夹视图') < 0 && clientSrc.indexOf('fld.menuView') < 0, '文件夹右键菜单「进入文件夹视图」已移除')
    // ③ 主题行主体单击 = 原地展开/收起该主题子列表（topicExpanded object，session 内不持久化）
    assert(/const \[topicExpanded, setTopicExpanded\] = React\.useState\(\{\}\)/.test(clientSrc), 'topicExpanded state（object，不持久化）')
    assert(/function toggleTopicExpanded\(tn\)/.test(clientSrc) && clientSrc.indexOf('onClick: () => toggleTopicExpanded(tn)') >= 0, '主题行主体 onClick = toggleTopicExpanded（原地展开）')
    assert(/ev\.stopPropagation\(\); setView\(view\.type === 'topic' && view\.id === tn/.test(clientSrc), '主题行尾图标点击 = 主题视图（跨文件夹过滤）')
    assert(clientSrc.indexOf("key: 'tpk-' + tn") >= 0, '主题原地展开子列表 nested 渲染（tpk- 前缀）')
    // ④ 陈旧展开态清洗：按当前文件夹 id + PINNED_KEY 过滤；空集回 null（缺省全展开）并回写持久化
    assert(/function pruneFoldersExpanded\(prev, folderList\)/.test(clientSrc), 'pruneFoldersExpanded 清洗 helper 存在')
    assert(clientSrc.indexOf('id === PINNED_KEY || folderList.some(f => f.id === id)') >= 0, '按当前文件夹 id + PINNED_KEY 过滤失效 id')
    assert(clientSrc.indexOf('const fixed = next.length ? next : null') >= 0 && clientSrc.indexOf('saveFoldersExpanded(fixed)') >= 0, '清洗后为空 → null 回缺省全展开并回写持久化')
    // 发布包 + styles.css 同步
    assert(clientPkgSrc.indexOf('dsh-notes-row-vfilter') >= 0 && clientPkgSrc.indexOf('toggleTopicExpanded') >= 0 && clientPkgSrc.indexOf('pruneFoldersExpanded') >= 0, '发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）')
    const cssDevT = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(cssDevT.indexOf('.dsh-notes-row-vfilter{') >= 0 && cssDevT.indexOf('.dsh-notes-row-vfilter.on{') >= 0, 'styles.css 含行尾过滤图标样式（主题行沿用；常态/hover 浮现/激活常显）')
    // app.html / 原型 notes-ui-v2.html 同步：caret 折叠分支（日志同权：零副作用）+ 主题 vfilter 保留 + 主题原地展开 + 陈旧清洗
    for (const pair of [['app.html', appSrcT], ['原型 notes-ui-v2.html', protoSrcT]]) {
      assert(pair[1].indexOf("ev.target.closest('.vfilter')") >= 0, pair[0] + ' 树事件委托识别 .vfilter 行尾图标（主题行）')
      assert(pair[1].indexOf("foldOpen[fid2] = foldOpen[fid2] === false ? true : false; saveFoldOpen(); renderTree(); return") >= 0, pair[0] + ' 行点击（含 caret）= 统一展开/折叠 toggle（0.4.3⑦ 日志同权：纯折叠态翻转零副作用，ensureFoldLogs 已拆）')
      assert(pair[1].indexOf("view = { type: 'folder', id: fid2 }") < 0, pair[0] + ' 行主体单击进视图分支已移除（notes-041b 语义收敛）')
      assert(pair[1].indexOf("if (vf && frow)") < 0, pair[0] + ' 0.4.3⑦：文件夹行 vfilter 进视图委托分支已移除')
      assert(pair[1].indexOf('class="vfilter') >= 0, pair[0] + ' 主题行渲染行尾过滤图标（主题视图保留）')
      assert(pair[1].indexOf('var topicOpen = {}') >= 0 && pair[1].indexOf('topicOpen[t] = !topicOpen[t]') >= 0, pair[0] + ' 主题行原地展开（topicOpen）')
      assert(pair[1].indexOf('.vfilter{') >= 0 && pair[1].indexOf('.vfilter.on{') >= 0, pair[0] + ' vfilter 样式（主题行沿用）')
      assert(pair[1].indexOf('进入文件夹视图') < 0, pair[0] + ' 文件夹右键菜单「进入文件夹视图」已移除')
      assert(/delete foldOpen\[k\]/.test(pair[1]), pair[0] + ' foldOpen 陈旧 id 清洗（loadFolders）')
    }
  })
  await t('树修正（notes-tree-root-expand）：未入夹根级直显 + 过滤命中自动展开 + 命中计数（四端同步）', () => {
    const appSrcX = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcX = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // ① 根级直显：无 folder 笔记平铺在树根部（文件夹列表之后）；未分类主题二次分组兜底已移除（主题聚合由「主题过滤」区承担，不重复聚合）
    assert(clientSrc.indexOf('groupByTopic') < 0, 'client-impl 未分类主题二次分组（groupByTopic）已移除')
    assert(clientSrc.indexOf("const unfiledHits = filtered.filter(n => !(n.folder || ''))") >= 0 && clientSrc.indexOf("const unfiled = groupPage(unfiledHits, groupShown, 'unfiled')") >= 0, 'client-impl 未入夹笔记 = 无 folder 过滤集（0.4.6-J 起分组分页切片）')
    assert(clientSrc.indexOf("const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })") >= 0, 'client-impl 未入夹笔记根级平铺直渲（无主题分组头/nested 包裹）')
    assert(clientSrc.indexOf("'tg-' + topic") < 0 && clientSrc.indexOf('dsh-notes-topic-g') < 0, 'client-impl 未分类主题分组头渲染已移除')
    // ② drop 移出落点保持：.dsh-notes-unfiled-drop 容器 + 三处理器不变（「未分类」分组头已在 notes-tree-unfiled-sibling 移除——落点 = 包裹容器 + 拖拽中提示行）
    assert(clientSrc.indexOf("className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop") >= 0, 'client-impl 未入夹区 drop 移出落点保持')
    assert(clientSrc.indexOf("'dsh-notes-sec-h-t' }, '未分类')") < 0, 'client-impl 未入夹「未分类」分组头/分区计数已移除（同级直显）')
    // ③ 过滤命中自动展开（纯计算 OR，不写回折叠态——清除过滤即恢复手动折叠）+ 命中计数：置顶组/文件夹/主题行
    assert(clientSrc.indexOf("const pinOpen = isFolderExpanded(PINNED_KEY) || (filtersActive && pinnedAll.length > 0)") >= 0, '置顶组过滤命中自动展开')
    assert(clientSrc.indexOf("const fOpen = isFolderExpanded(f.id) || (filtersActive && subHits > 0)") >= 0, '文件夹过滤命中自动展开（子树命中口径，无命中保持折叠）')
    assert(clientSrc.indexOf("const cnt = filtersActive ? subHits : (f.count || 0)") >= 0, '文件夹计数：过滤激活 = 子树命中数（无命中 0）/ 否则 = 子树总数（host count 已递归）')
    assert(clientSrc.indexOf("const tOpen = !!topicExpanded[tn] || (filtersActive && tkidsAll.length > 0)") >= 0, '标签行过滤命中自动展开（0.4.8 语义切换，变量名沿用）')
    assert(clientSrc.indexOf("filtersActive ? tkidsAll.length : Object.keys(allTags[tn]).length") >= 0, '标签行计数：过滤激活 = 命中数 / 否则 = 全库去重篇数（0.4.8 多值分组）')
    // 恢复断言：自动展开为纯计算（isFolderExpanded OR），折叠态写入口仍只有 toggleFolder/expandFolder——过滤清除即恢复手动折叠
    assert(/function toggleFolder\(id\)/.test(clientSrc) && /function expandFolder\(id\)/.test(clientSrc), '折叠态写入口保持（toggleFolder/expandFolder）')
    // ④ 发布包 client.js 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ["const fOpen = isFolderExpanded(f.id) || (filtersActive && subHits > 0)", "const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })", "const tOpen = !!topicExpanded[tn] || (filtersActive && tkidsAll.length > 0)", "const cnt = filtersActive ? subHits : (f.count || 0)"]) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k.slice(0, 34) + '…」（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf('groupByTopic') < 0, '发布包 lib/client.js groupByTopic 已移除（需先跑 scripts/build-dist.cjs）')
    // ⑤ app.html / 原型 notes-ui-v2.html 同步（同一套 DOM/CSS/交互口径）
    for (const pair of [['app.html', appSrcX], ['原型 notes-ui-v2.html', protoSrcX]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("var filtering = view.type !== 'all' || !!searchText || filtersActiveCount() > 0;") >= 0, label + ' 过滤激活标记（视图/筛选中心/搜索任一）')
      assert(s.indexOf("var open = (foldOpen[f.id] !== false) || (filtering && subHits > 0);") >= 0, label + ' 文件夹过滤命中自动展开（子树命中口径，不写回 foldOpen）')
      assert(s.indexOf("(filtering ? subHits : (f.count != null ? f.count : kids.length))") >= 0, label + ' 文件夹计数：过滤激活 = 子树命中数')
      assert(s.indexOf("var tOpen = !!topicOpen[t] || (filtering && tkids.length > 0);") >= 0, label + ' 标签行过滤命中自动展开（不写回 topicOpen；0.4.8 语义切换）')
      assert(s.indexOf("(filtering ? tkids.length : Object.keys(allTags[t]).length)") >= 0, label + ' 标签行计数：过滤激活 = 命中数 / 否则 = 全库去重篇数（0.4.8 多值分组）')
      if (label === 'app.html') assert(s.indexOf("' ' + t('tree.pinned') + '<span class=\"cnt2\">' + pins.length + '</span></div>'") >= 0, label + ' 置顶组计数（i18n 覆盖卡A 起走 t() 字典）')
      else assert(s.indexOf("' 置顶<span class=\"cnt2\">' + pins.length + '</span></div>'") >= 0, label + ' 置顶组计数')
      assert(s.indexOf(">未分类<span class=\"cnt2\">") < 0, label + ' 未入夹「未分类」分组头/分区计数已移除（同级直显，落点 = 包裹容器）')
      assert(s.indexOf("unfiled.forEach(function (n) { h += noteRow(n, false) });") >= 0, label + ' 未入夹笔记根级平铺直渲')
      assert(s.indexOf('未分类</div><div class="nested">') < 0 && s.indexOf('var topics = {};') < 0, label + ' 未分类主题二次分组兜底已移除')
      assert(s.indexOf('.sec-h .cnt2{margin-left:auto;font-size:10px;font-weight:400;letter-spacing:0;text-transform:none}') >= 0, label + ' 分组头计数丸样式（.sec-h .cnt2）')
      assert(s.indexOf('data-drop-out="1"') >= 0, label + ' drop 移出落点保留（data-drop-out）')
    }
  })
  await t('树修正（notes-tree-unfiled-sibling）：未入夹笔记与文件夹同级直显（去「未分类」分组头）+ drop 落点保留 + 空态不占位（四端同步）', () => {
    const appSrcU = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcU = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // ① 去分组头：未入夹区不再渲染「未分类」sec-h 标题行/分区计数（数量并入 brand 行总计数）；笔记行保持根级平铺直渲（treeIds 键盘导航顺序不变）
    assert(clientSrc.indexOf("'dsh-notes-sec-h-t' }, '未分类')") < 0, 'client-impl 未入夹「未分类」分组头已移除')
    assert(clientSrc.indexOf('unfiledAll') < 0, 'client-impl 未入夹分区计数变量（unfiledAll）已移除——并入 brand 总计数')
    assert(clientSrc.indexOf("const unfiledKids = unfiled.map(n => { treeIds.push(n.id); return renderNoteRow(n, false) })") >= 0, 'client-impl 未入夹笔记根级平铺直渲（与文件夹行同缩进层级；treeIds 顺序不变）')
    // ② drop 移出落点保留：.dsh-notes-unfiled-drop 包裹容器 + 三处理器不变；拖拽中（dragActive state）本区头部显示淡提示行「拖到此处移出文件夹」
    assert(clientSrc.indexOf("className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop") >= 0, 'client-impl 未入夹区 drop 移出落点保持（容器三处理器不变）')
    assert(/const \[dragActive, setDragActive\] = React\.useState\(false\)/.test(clientSrc), 'client-impl dragActive state（dragstart 置位 / dragend 复位）')
    assert(clientSrc.indexOf("dragNoteIdRef.current = n.id\n          setDragActive(true)") >= 0 && clientSrc.indexOf("dragNoteIdRef.current = null\n          setDragActive(false)") >= 0, 'client-impl dragstart/dragend 置位/复位 dragActive')
    assert(clientSrc.indexOf("className: 'dsh-notes-unfiled-hint'") >= 0 && clientSrc.indexOf('拖到此处移出文件夹') >= 0, 'client-impl 拖拽中显示「拖到此处移出文件夹」提示行')
    // ③ 空态：无未入夹笔记且非拖拽中不渲染任何占位（（空）行/空容器均不渲染）；有笔记或拖拽中才渲染落点容器
    assert(clientSrc.indexOf('if (unfiledKids.length || dragActive)') >= 0, 'client-impl 落点容器条件渲染（有未入夹笔记 或 拖拽中）')
    assert(clientSrc.indexOf('empty-u') < 0 && clientSrc.indexOf('dsh-notes-tree-empty') < 0, 'client-impl（空）占位行已移除')
    // ④ 发布包 lib/client.js + lib/styles.css 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['if (unfiledKids.length || dragActive)', 'dsh-notes-unfiled-hint', '拖到此处移出文件夹', 'setDragActive(true)']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k.slice(0, 30) + '…」（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf("'dsh-notes-sec-h-t' }, '未分类')") < 0 && clientPkgSrc.indexOf('empty-u') < 0, '发布包 未入夹分组头/（空）占位已移除')
    const cssDevU = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgU = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDevU], ['发布包 lib/styles.css', cssPkgU]]) {
      assert(pair[1].indexOf('.dsh-notes-unfiled-hint') >= 0, pair[0] + ' 含 .dsh-notes-unfiled-hint 提示行样式（需先跑 scripts/build-dist.cjs）')
    }
    // ⑤ app.html / 原型 notes-ui-v2.html 同步：包裹容器 data-drop-out + 提示行（.drag-on 显示）+ dragstart 点亮/补插 + dragend 清理 + 无（空）占位
    for (const pair of [['app.html', appSrcU], ['原型 notes-ui-v2.html', protoSrcU]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf(">未分类<span class=\"cnt2\">") < 0, label + ' 未入夹「未分类」分组头/分区计数已移除')
      assert(s.indexOf('<div class="unfiled-drop" data-drop-out="1"') >= 0, label + ' 未入夹包裹容器保留 drop 移出落点（data-drop-out，根级同级直显）')
      assert(s.indexOf('unfiled.forEach(function (n) { h += noteRow(n, false) });') >= 0, label + ' 未入夹笔记根级平铺直渲（容器内无 nested 缩进包裹）')
      assert(s.indexOf('（空）') < 0, label + ' 空态（空）占位行已移除（非拖拽不渲染任何占位）')
      assert(s.indexOf('class="unfiled-hint"') >= 0 && s.indexOf('拖到此处移出文件夹') >= 0, label + ' 容器内含「拖到此处移出文件夹」提示行')
      assert(s.indexOf('.unfiled-drop.drag-on .unfiled-hint{display:block}') >= 0 && s.indexOf('.unfiled-drop.drop{') >= 0, label + ' 提示行/落点高亮样式（.drag-on 显示 + .drop 虚线描边）')
      assert(s.indexOf("var udrop = $('tree').querySelector('.unfiled-drop')") >= 0, label + ' dragstart 委托点亮/补插落点容器')
      assert(s.indexOf("udrop.className = 'unfiled-drop drag-on'") >= 0 && s.indexOf("insertBefore(udrop, $('tree').querySelector('[data-tsec]'))") >= 0, label + ' 空态临时落点容器补插（主题过滤区之前）')
      assert(s.indexOf("el.querySelector('[data-note]')) el.classList.remove('drag-on'); else el.remove()") >= 0, label + ' dragend 清理拖拽态（摘 drag-on / 移除临时容器）')
    }
  })
  await t('标签过滤区默认折叠（notes-topic-collapse）：常态「标签 (N)」一行 + 点击展开 + 过滤命中自动展开+计数（四端同步；0.4.8 主题并入标签，topic* 键名/状态名沿用）', () => {
    const appSrcC = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcC = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    // ① client：整区折叠态（缺省折叠，session 记忆不持久化）+ 分组头 sec-toggle 点击展开/收起（置顶折叠组 PINNED_KEY 同款机制）
    assert(/const \[topicSecOpen, setTopicSecOpen\] = React\.useState\(false\)/.test(clientSrc), 'topicSecOpen state（缺省折叠，session 记忆不持久化）')
    assert(clientSrc.indexOf("key: 'sec-topics', className: 'dsh-notes-sec-h dsh-notes-sec-toggle', onClick: () => setTopicSecOpen(!topicSecOpen)") >= 0, '主题区分组头 = sec-toggle 点击展开/收起')
    assert(clientSrc.indexOf("'dsh-notes-caret' + (topicSecOpenEff ? ' open' : '')") >= 0, '分组头 caret 随展开态旋转')
    // ② 常态只显示「标签 (N)」一行（N=标签数）；过滤激活计数切换为命中标签数（folders「过滤激活=命中数」同口径）
    assert(clientSrc.indexOf("tt('tree.topicsHeader', { n: filtersActive ? topicHitCount : topicNames.length })") >= 0, '常态「标签 (N)」一行；过滤激活计数=命中标签数（i18n 覆盖卡A 起走 t() 字典；0.4.8 键名沿用）')
    assert(clientSrc.indexOf('const topicHitCount = Object.keys(topicHitSet).length') >= 0, '命中标签数统计（filtered 口径）')
    // ③ 过滤命中自动展开：纯计算 OR，不写回 topicSecOpen（清除过滤即恢复手动折叠态）；列表仅展开时渲染
    assert(clientSrc.indexOf('const topicSecOpenEff = topicSecOpen || (filtersActive && topicHitCount > 0)') >= 0, '过滤命中自动展开（纯计算 OR，不写回）')
    assert(clientSrc.indexOf('if (topicSecOpenEff) topicNames.forEach(tn => {') >= 0, '标签列表折叠门控（仅展开时渲染）')
    // 列表内行为不变：标签行原地展开/收起子列表（topicExpanded）+ 行尾标签视图过滤图标
    assert(clientSrc.indexOf('onClick: () => toggleTopicExpanded(tn)') >= 0 && clientSrc.indexOf("key: 'tpk-' + tn") >= 0, '列表内标签行原地展开行为不变')
    // ④ 发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['const topicSecOpenEff = topicSecOpen || (filtersActive && topicHitCount > 0)', "tt('tree.topicsHeader', { n: filtersActive ? topicHitCount : topicNames.length })", 'if (topicSecOpenEff) topicNames.forEach(tn => {']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k.slice(0, 30) + '…」（需先跑 scripts/build-dist.cjs）')
    }
    // ⑤ app.html / 原型 notes-ui-v2.html 同步（同一套 DOM/交互口径）
    for (const pair of [['app.html', appSrcC], ['原型 notes-ui-v2.html', protoSrcC]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('var topicSecOpen = false;') >= 0, label + ' topicSecOpen 缺省折叠（session 记忆不持久化）')
      assert(s.indexOf('data-tsec="1"') >= 0 && s.indexOf('var tSecOpen = topicSecOpen || (filtering && topicHitCount > 0);') >= 0, label + ' 分组头单行 + 过滤命中自动展开（纯计算不写回）')
      assert(s.indexOf(label === 'app.html' ? "' ' + t('tree.topicsHeader', { n: filtering ? topicHitCount : topicNames.length })" : "' 标签 (' + (filtering ? topicHitCount : topicNames.length)") >= 0, label + ' 常态「标签 (N)」计数；过滤激活=命中标签数（app 走 t() 字典，i18n 覆盖卡A；0.4.8 主题并入标签）')
      assert(s.indexOf('if (tSecOpen) topicNames.forEach(function (t) {') >= 0, label + ' 标签列表折叠门控（仅展开时渲染）')
      assert(/topicSecOpen = !topicSecOpen; renderTree\(\); return/.test(s), label + ' 树事件委托：点分组头切换 topicSecOpen')
      assert(s.indexOf('topicOpen[t] = !topicOpen[t]') >= 0, label + ' 列表内标签行原地展开行为不变（topicOpen）')
    }
  })
  await t('client 移动到文件夹 + 文件夹右键管理（v2 纯文字标签，开发版 + 发布包同步）', () => {
    /* 0.4.8（notes-048-note-ctxmenu）：右键菜单文案收编进 note.menu* 新键域（'移动到…'/'未分类（移出文件夹）'），原 ctx.moveTo/ctx.moveOut 键值退役 */
    assert(clientSrc.indexOf("'note.menuMoveTo': '移动到…'") >= 0, '笔记行右键含「移动到…」（0.4.8 note.menu* 新键域字典值）')
    assert(/function ctxMoveToFolder\(n, folderId\)/.test(clientSrc), 'ctxMoveToFolder 存在')
    assert(/host\.call\('notes-update', \{ id: n\.id, folder: folderId \}\)/.test(clientSrc), '移动走 notes-update 只改 folder 字段')
    assert(clientSrc.indexOf('未分类（移出文件夹）') >= 0 && clientSrc.indexOf('新建文件夹…') >= 0, '子菜单含移出/新建')
    assert(/function openFolderMenu\(ev, f\)/.test(clientSrc), 'openFolderMenu 存在')
    for (const label of ["'重命名'", "'上移'", "'下移'", "'删除文件夹'"]) {
      assert(clientSrc.indexOf(label) >= 0, '文件夹右键菜单缺「' + label + '」')
    }
    for (const op of ["{ op: 'create', name: name, parent: parent }", "{ op: 'rename', id: id, name: name }", "{ op: 'delete', id: f.id, cascade: true }", "{ op: 'reorder', ids: ids }"]) {
      assert(clientSrc.indexOf(op) >= 0, 'client-impl 缺 notes-folders 调用 ' + op)
    }
    assert(clientPkgSrc.indexOf('移动到…') >= 0 && clientPkgSrc.indexOf('删除文件夹') >= 0, '发布包含移动/删除文件夹交互')
  })
  await t('styles.css 树状文件夹样式（v2 token 化，开发版 + 发布包同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const cls of ['.dsh-notes-folder-row{', '.dsh-notes-caret{', '.dsh-notes-row-nm{', '.dsh-notes-row-n{', '.dsh-notes-folder-rename{', '.dsh-notes-nested{', '.dsh-notes-sec-h{', '.dsh-notes-fbadge{', '.dsh-notes-note-row{']) {
      assert(cssDev.indexOf(cls) >= 0, 'styles.css 缺 ' + cls)
      assert(cssPkg.indexOf(cls) >= 0, '发布包 lib/styles.css 缺 ' + cls)
    }
    assert(cssDev.indexOf('.dsh-notes-folder-ic') < 0 && cssPkg.indexOf('.dsh-notes-folder-ic') < 0, 'folder-ic 样式已移除（开发版 + 发布包）')
    // 文件夹行视觉（notes-tree-typography，VS Code 式同级统一）：cursor:default + 13px/常规/主色（--ntx，与同级笔记行同字体；旧 11.5px/600/--nt2 配角层级已移除）
    assert(/\.dsh-notes-folder-row\{[^}]*cursor:default/.test(cssDev) && /\.dsh-notes-folder-row\{[^}]*cursor:default/.test(cssPkg), '文件夹行 cursor:default')
    assert(/\.dsh-notes-folder-row\{[^}]*color:var\(--ntx\)/.test(cssDev) && /\.dsh-notes-folder-row\{[^}]*font-size:13px/.test(cssDev), '文件夹行 13px 主色（--ntx，与笔记行同级统一）')
    assert(!/\.dsh-notes-folder-row\{[^}]*font-size:11\.5px/.test(cssDev) && !/\.dsh-notes-folder-row\{[^}]*font-weight:600/.test(cssDev) && !/\.dsh-notes-folder-row\{[^}]*color:var\(--nt2\)/.test(cssDev), '文件夹行旧层级（11.5px/600/--nt2）已移除')
    // 嵌套笔记：margin-left 13px + padding-left 9px + 1px 引导线（--nbd-soft，原型口径）
    assert(/\.dsh-notes-nested\{[^}]*margin-left:13px/.test(cssDev) && /\.dsh-notes-nested\{[^}]*padding-left:9px/.test(cssDev) && /\.dsh-notes-nested\{[^}]*border-left:1px solid var\(--nbd-soft\)/.test(cssDev), '嵌套笔记 1px 缩进引导线（原型 13px/9px）')
    // 新建文件夹入口：分组头 ＋ 图标按钮（sec-h-add，hover 强调色）
    assert(/\.dsh-notes-sec-h-add\{[^}]*var\(--nt3\)/.test(cssDev) && /\.dsh-notes-sec-h-add:hover\{[^}]*var\(--nacc\)/.test(cssDev), '新建文件夹入口（nt3 → hover nacc）')
    assert(cssDev.indexOf('.dsh-notes-folderbar') < 0 && cssPkg.indexOf('.dsh-notes-folderbar') < 0, 'folderbar 样式已移除（开发版 + 发布包）')
    assert(cssDev.indexOf('.dsh-notes-folder-chip') < 0 && cssPkg.indexOf('.dsh-notes-folder-chip') < 0, 'folder-chip 样式已移除（开发版 + 发布包）')
    assert(cssDev.indexOf('.dsh-note-item') < 0 && cssPkg.indexOf('.dsh-note-item') < 0, '旧 dsh-note-item 列表项样式已移除（开发版 + 发布包）')
  })
  await t('树排版（notes-tree-typography）：同级字体统一 13px/常规/主色 + 行首槽位对齐（caret 槽 11px 占位 + 图标槽 16px，四端同步）', () => {
    const appSrcT = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoSrcT = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    const cssDevT = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgT = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    // ① 面板（client-impl + styles.css）：笔记行行首 = caret 槽透明占位 + 图标槽（kind 色点槽内居中），与文件夹行标题文字起点 x 一致
    assert(clientSrc.indexOf("className: 'dsh-notes-caret-spacer'") >= 0, 'client-impl 笔记行渲染 caret 槽占位（与文件夹行 caret 同位同宽 11px）')
    assert(/className: 'dsh-notes-kind-slot'/.test(clientSrc) && /dsh-notes-kind-slot[^\n]*dsh-notes-kind-dot/.test(clientSrc), 'client-impl 笔记行 kind 色点包 16px 图标槽（kind-slot）')
    assert(clientPkgSrc.indexOf('dsh-notes-caret-spacer') >= 0 && clientPkgSrc.indexOf('dsh-notes-kind-slot') >= 0, '发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）')
    // ② 槽位宽度固定：caret 槽 11px / 图标槽 16px（开发版 + 发布包 styles.css 同步）
    for (const pair of [['styles.css', cssDevT], ['发布包 lib/styles.css', cssPkgT]]) {
      const c = pair[1], label = pair[0]
      assert(/\.dsh-notes-caret-spacer\{[^}]*width:11px/.test(c), label + ' caret 槽占位 11px 定宽（.dsh-notes-caret-spacer）')
      assert(/\.dsh-notes-kind-slot\{[^}]*width:16px/.test(c), label + ' 笔记图标槽 16px 定宽（.dsh-notes-kind-slot）')
      assert(/\.dsh-notes-ic-slot\{[^}]*width:16px/.test(c), label + ' 文件夹图标槽 16px 定宽（.dsh-notes-ic-slot，旧 15px 已移除）')
      assert(/\.dsh-notes-folder-row\{[^}]*font-size:13px/.test(c) && /\.dsh-notes-folder-row\{[^}]*color:var\(--ntx\)/.test(c), label + ' 文件夹行 13px/主色（与笔记行同级统一）')
    }
    // ③ 嵌套层级保留：.dsh-notes-nested 子笔记 12.5px 小字 + 缩进引导线不动（同级统一后嵌套对比更清晰）
    assert(/\.dsh-notes-nested \.dsh-notes-note-row\{[^}]*font-size:12\.5px/.test(cssDevT), '嵌套子笔记 12.5px 小字保留')
    // ④ app.html / 原型 notes-ui-v2.html 同步（同一套 DOM/CSS 口径）：noteRow 行首占位 + kind-slot + .row.head 13px 主色
    for (const pair of [['app.html', appSrcT], ['原型 notes-ui-v2.html', protoSrcT]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('class="caret-spacer"') >= 0, label + ' 笔记行渲染 caret 槽占位')
      assert(/class="kind-slot"><span class="kind"/.test(s), label + ' 笔记行 kind 色点包图标槽（kind-slot）')
      assert(/\.caret-spacer\{[^}]*width:11px/.test(s), label + ' caret 槽占位样式 11px 定宽')
      assert(/\.kind-slot\{[^}]*width:16px/.test(s), label + ' kind 图标槽样式 16px 定宽')
      assert(/\.ic-slot\{[^}]*width:16px/.test(s), label + ' 文件夹图标槽 16px 定宽（旧 15px 已移除）')
      assert(s.indexOf('.row.head{font-size:13px;color:var(--ntx)}') >= 0, label + ' 文件夹行 13px/主色（.row.head；旧 11.5px/600 已移除）')
      assert(s.indexOf('.row.head{font-size:11.5px') < 0, label + ' 文件夹行旧 11.5px 字号已移除')
    }
  })

  // --- 行为断言（内存 mock：handlers + note_manage + fsMock store）---
  await t('notes-folders list 初始兜底：folders.json 缺失 → 空清单 + unfiled 计数（不抛错）', async () => {
    // 0.4.4-A 适配（notes-044-dispatch-receipts）：前置节派发测试已懒创建「执行记录」夹（folders.json 存在）——
    // 「缺失兜底」改相对守恒口径：list 不抛错返回既有清单 + unfiled = 全部 - 夹内（守恒语义不变）
    const r = await handlers['notes-folders']({})
    assert(Array.isArray(r.folders), 'folders 为数组（不抛错；实得 ' + r.folders.length + ' 夹）')
    const all = await handlers['notes-list']({})
    const foldered = all.notes.filter(n => n.folder && r.folders.some(f => f.id === n.folder)).length
    assert.strictEqual(r.unfiled, all.notes.length - foldered, 'unfiled 计数守恒（全部 - 夹内；实得 ' + r.unfiled + ' / 期望 ' + (all.notes.length - foldered) + '）')
  })
  await t('notes-folders create：落盘 folders.json + order 递增；缺 name 报错', async () => {
    // 0.4.4-A 适配（notes-044-dispatch-receipts）：前置节派发测试会懒创建「执行记录」夹——order/磁盘清单改相对口径（既有条目不动 + 新条目字段一致 + 递增 +1）
    const preF = ((await handlers['notes-folders']({})).folders) || []
    const c1 = await handlers['notes-folders']({ op: 'create', name: '工作' })
    assert(c1.ok === true && c1.folder && c1.folder.id.indexOf('f-') === 0, 'create 返回 f- 前缀 id（实得：' + JSON.stringify(c1) + '）')
    assert.strictEqual(c1.folder.name, '工作')
    assert.strictEqual(c1.folder.order, preF.length, '首个文件夹 order=既有清单长度（实得 ' + c1.folder.order + ' / 既有 ' + preF.length + '）')
    assert(store.has(FOLDERS_PATH_MOCK), 'folders.json 已写入 mock store')
    const onDisk = JSON.parse(store.get(FOLDERS_PATH_MOCK))
    assert.deepStrictEqual(onDisk.filter(f => f.id === c1.folder.id), [{ id: c1.folder.id, name: '工作', order: c1.folder.order }], '磁盘清单含新条目且字段一致（既有条目不动）')
    const c2 = await handlers['notes-folders']({ op: 'create', name: '学习' })
    assert.strictEqual(c2.folder.order, c1.folder.order + 1, '第二个文件夹 order 递增 +1')
    const bad = await handlers['notes-folders']({ op: 'create', name: '  ' })
    assert(bad.error && bad.error.indexOf('需要 name') >= 0, '空白 name 应报错')
    const bad2 = await handlers['notes-folders']({ op: 'create' })
    assert(bad2.error, '缺 name 应报错')
  })
  await t('folder 字段数据往返：create 带 folder → get/list/磁盘 front-matter 一致', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const r = await handlers['notes-create']({ title: 'fld-往返', body: 'RT', topic: '开发', folder: fWork.id })
    const g = await handlers['notes-get']({ id: r.id })
    assert.strictEqual(g.note.folder, fWork.id, 'get 返回 folder id')
    const content = store.get(NOTES_DIR + '\\' + r.id + '.md')
    assert(content.indexOf('\nfolder: ' + fWork.id + '\n') >= 0, 'front-matter 含 folder 行（实得：' + content.split('\n').slice(0, 8).join('|') + '）')
    const l = await handlers['notes-list']({})
    assert.strictEqual(l.notes.find(n => n.id === r.id).folder, fWork.id, 'list slim 带 folder 字段')
  })
  await t('旧文件无 folder 字段兜底为未分类（向后兼容）', async () => {
    const legacyId = 'n-legacy-folder'
    const legacyContent = '---\nid: ' + legacyId + '\ntitle: 老笔记无folder\ntopic: 需求\ntags: quick\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n正文\n'
    await fsMock.writeText(NOTES_DIR + '\\' + legacyId + '.md', legacyContent)
    const g = await handlers['notes-get']({ id: legacyId })
    assert.strictEqual(g.note.folder, '', '无 folder 字段 → 缺省 \'\'（未分类）')
    const r = await handlers['notes-folders']({})
    assert(r.unfiled >= 1, '旧文件计入 unfiled')
  })
  await t('notes-list folder 过滤：按 id 命中 / 空串 = 未分类', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const inWork = await handlers['notes-list']({ folder: fWork.id })
    assert(inWork.notes.length >= 1 && inWork.notes.every(n => n.folder === fWork.id), 'folder=id 只返回该文件夹笔记')
    const unfiled = await handlers['notes-list']({ folder: '' })
    assert(unfiled.notes.length >= 1 && unfiled.notes.every(n => !(n.folder && folders.some(f => f.id === n.folder))), 'folder=\'\' 只返回未分类（不含清单内引用）')
    assert(unfiled.notes.find(n => n.id === 'n-legacy-folder'), '未分类列表含旧文件')
    const all = await handlers['notes-list']({})
    // 0.4.4-A 适配：「执行记录」夹可能已含伴生笔记（前置节派发懒创建）——守恒口径扩为「全部 = 清单内各夹（递归子树）+ 未分类」
    let inAnyFolder = 0
    for (const f of folders) inAnyFolder += (await handlers['notes-list']({ folder: f.id })).notes.length
    assert.strictEqual(all.notes.length, inAnyFolder + unfiled.notes.length, '不过滤 = 各文件夹 + 未分类 之和（实得 ' + all.notes.length + ' / ' + (inAnyFolder + unfiled.notes.length) + '）')
  })
  await t('notes-folders list 计数口径：移入后 count/unfiled 联动', async () => {
    const before = await handlers['notes-folders']({})
    const fWork = before.folders.find(f => f.name === '工作')
    const note = await handlers['notes-create']({ title: 'fld-计数', body: 'x', topic: '开发' })
    const afterCreate = await handlers['notes-folders']({})
    assert.strictEqual(afterCreate.unfiled, before.unfiled + 1, '新建未指定文件夹 → unfiled+1')
    await handlers['notes-update']({ id: note.id, folder: fWork.id })
    const afterMove = await handlers['notes-folders']({})
    assert.strictEqual(afterMove.unfiled, before.unfiled, '移入文件夹 → unfiled 回落')
    assert.strictEqual(afterMove.folders.find(f => f.id === fWork.id).count, fWork.count + 1, '目标文件夹 count+1')
  })
  await t('notes-folders rename：改名生效 + 不存在 id/缺 name 报错', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fStudy = folders.find(f => f.name === '学习')
    const r = await handlers['notes-folders']({ op: 'rename', id: fStudy.id, name: '学习资料' })
    assert(r.ok === true && r.name === '学习资料', 'rename 返回 ok + 新名')
    const after = await handlers['notes-folders']({})
    assert(after.folders.find(f => f.id === fStudy.id).name === '学习资料', 'list 反映新名')
    const onDisk = JSON.parse(store.get(FOLDERS_PATH_MOCK))
    assert(onDisk.find(f => f.id === fStudy.id).name === '学习资料', '磁盘清单已更新')
    const bad = await handlers['notes-folders']({ op: 'rename', id: 'f-nope', name: 'x' })
    assert(bad.error && bad.error.indexOf('文件夹不存在') >= 0, '不存在 id 报错')
    const bad2 = await handlers['notes-folders']({ op: 'rename', id: fStudy.id, name: ' ' })
    assert(bad2.error && bad2.error.indexOf('需要 name') >= 0, '空白 name 报错')
  })
  await t('notes-folders reorder：入列按序重排 + 未入列追加尾部 + order 归一化', async () => {
    const c3 = await handlers['notes-folders']({ op: 'create', name: '临时' })
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const fStudy = folders.find(f => f.name === '学习资料')
    const r = await handlers['notes-folders']({ op: 'reorder', ids: [c3.folder.id, fWork.id] })
    assert(r.ok === true && Array.isArray(r.folders), 'reorder 返回 ok + folders')
    // 0.4.4-A 适配：既有「执行记录」夹参与未入列尾序——入列居首 + 未入列保持原序 + 总数守恒 + order 归一化（语义不变，清单构成相对口径）
    const idsOut = r.folders.map(f => f.id)
    assert(idsOut[0] === c3.folder.id && idsOut[1] === fWork.id, '入列按 ids 序居首')
    assert(idsOut.length === folders.length && idsOut.indexOf(fStudy.id) > 1, '未入列保持原序追加尾部 + 总数守恒')
    assert.deepStrictEqual(r.folders.map(f => f.order), r.folders.map((f, i) => i), 'order 归一化为 0..n-1')
    const listed = (await handlers['notes-folders']({})).folders
    assert.deepStrictEqual(listed.map(f => f.id), idsOut, 'list 按 order 排序输出')
    const bad = await handlers['notes-folders']({ op: 'reorder' })
    assert(bad.error && bad.error.indexOf('ids') >= 0, '缺 ids 报错')
  })
  await t('notes-folders delete：缺省拒绝含子内容（needCascade）+ cascade:true 笔记软删进回收站可恢复落未分类', async () => {
    // 自包含造数（不依赖前置 reorder 的「临时」夹——core 模式该断言跳过，本节仍可独立成立）
    const fTemp = (await handlers['notes-folders']({ op: 'create', name: '临时删' })).folder
    const n1 = await handlers['notes-create']({ title: 'fld-删1', body: 'x', folder: fTemp.id })
    const n2 = await handlers['notes-create']({ title: 'fld-删2', body: 'x', folder: fTemp.id })
    const before = await handlers['notes-folders']({})
    assert.strictEqual(before.folders.find(f => f.id === fTemp.id).count, 2, '前置：两条笔记在「临时删」')
    // 缺省（无 cascade）拒绝：报错 + needCascade 标记 + 子内容统计（供 confirm 明示），文件夹与笔记均不动
    const refuse = await handlers['notes-folders']({ op: 'delete', id: fTemp.id })
    assert(refuse.error && refuse.error.indexOf('cascade') >= 0 && refuse.needCascade === true && refuse.childFolders === 0 && refuse.notes === 2, '含笔记未传 cascade → 拒绝 + 统计（实得：' + JSON.stringify(refuse) + '）')
    assert((await handlers['notes-folders']({})).folders.find(f => f.id === fTemp.id), '拒绝后文件夹仍在')
    assert((await handlers['notes-get']({ id: n1.id })).note.folder === fTemp.id, '拒绝后笔记未动')
    // cascade:true → 文件夹删除 + 笔记逐条软删（回收站可恢复，folder 字段保留原引用不改写）
    const r = await handlers['notes-folders']({ op: 'delete', id: fTemp.id, cascade: true })
    assert(r.ok === true && r.folders === 1 && r.notes === 2, 'cascade 返回统计 {folders:1, notes:2}（实得：' + JSON.stringify(r) + '）')
    const after = await handlers['notes-folders']({})
    assert(!after.folders.find(f => f.id === fTemp.id), '清单不再含已删文件夹')
    assert.strictEqual(after.unfiled, before.unfiled, '软删笔记不进 unfiled（deleted 不计数）')
    assert((await handlers['notes-get']({ id: n1.id })).error, '软删后 notes-get 拒绝（已进回收站）')
    const trash = await handlers['notes-list']({ includeDeleted: true })
    const t1 = trash.notes.find(n => n.id === n1.id)
    assert(t1 && t1.deleted === true && t1.folder === fTemp.id, '回收站可见 + folder 字段保留原引用（不改写磁盘数据）')
    // 恢复：原文件夹已不存在 → effectiveFolder 兜底未分类（现有机制天然支持，断言锁定）
    await handlers['notes-restore']({ id: n1.id })
    assert((await handlers['notes-get']({ id: n1.id })).note.folder === fTemp.id, '恢复不改写 folder 原引用')
    assert((await handlers['notes-list']({ folder: '' })).notes.find(n => n.id === n1.id), '恢复后落未分类（原文件夹已删，effectiveFolder 兜底）')
    const bad = await handlers['notes-folders']({ op: 'delete', id: fTemp.id, cascade: true })
    assert(bad.error && bad.error.indexOf('文件夹不存在') >= 0, '重复删除报错')
  })
  await t('notes-folders 未知 op 报错', async () => {
    const r = await handlers['notes-folders']({ op: 'purge' })
    assert(r.error && r.error.indexOf('未知 op') >= 0, '未知 op 返回错误（实得：' + JSON.stringify(r) + '）')
  })
  await t('note_manage move：按 id/名称移动 + 移出未分类 + 参数校验', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const fStudy = folders.find(f => f.name === '学习资料')
    // 磁盘 folder 行是缓存无关的真相源（工具与重 apply 的 handlers 分属两个插件实例，各有缓存）
    const diskFolder = (id) => { const m = store.get(NOTES_DIR + '\\' + id + '.md').match(/\nfolder: ([^\n]*)\n/); return m ? m[1] : null }
    const n = await noteManage.execute({ action: 'create', title: 'fld-move', body: 'x' })
    const m1 = await noteManage.execute({ action: 'move', id: n.id, folder: fWork.id })
    assert.strictEqual(m1.action, 'move')
    assert.strictEqual(m1.folder, fWork.id)
    assert.strictEqual(m1.folderName, '工作')
    assert.strictEqual(diskFolder(n.id), fWork.id, '按 id 移动生效（磁盘 front-matter）')
    const m2 = await noteManage.execute({ action: 'move', id: n.id, folder: '学习资料' })
    assert.strictEqual(m2.folder, fStudy.id, '按名称精确命中解析为 id')
    assert.strictEqual(diskFolder(n.id), fStudy.id, '按名称移动生效（磁盘 front-matter）')
    const m3 = await noteManage.execute({ action: 'move', id: n.id, folder: '' })
    assert.strictEqual(m3.folder, '', '空串 = 移出到未分类')
    assert(m3.message.indexOf('未分类') >= 0, '移出消息含未分类')
    assert.strictEqual(diskFolder(n.id), '', '移出后磁盘 folder 行为空')
    const e1 = await noteManage.execute({ action: 'move', id: n.id })
    assert(e1.error && e1.error.indexOf('需要 folder') >= 0, '缺 folder 报错')
    const e2 = await noteManage.execute({ action: 'move', folder: fWork.id })
    assert(e2.error && e2.error.indexOf('需要 id') >= 0, '缺 id 报错')
    const e3 = await noteManage.execute({ action: 'move', id: n.id, folder: '不存在的文件夹' })
    assert(e3.error && e3.error.indexOf('文件夹不存在') >= 0, '找不到文件夹报错（不写悬空引用）')
  })
  await t('note_manage create/list 带 folder（create 按 id 落位；list 名称/id 兼容，\'\' = 未分类）', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fStudy = folders.find(f => f.name === '学习资料')
    const c = await noteManage.execute({ action: 'create', title: 'fld-manage-create', body: 'x', folder: fStudy.id })
    assert(c.id, 'create 接受 folder id')
    assert.strictEqual((await handlers['notes-get']({ id: c.id })).note.folder, fStudy.id, 'create 落位到指定文件夹')
    const l1 = await noteManage.execute({ action: 'list', folder: '学习资料' })
    assert(l1.notes.length >= 1 && l1.notes.every(n => n.folder === fStudy.id), 'list 按名称过滤')
    const l2 = await noteManage.execute({ action: 'list', folder: fStudy.id })
    assert(l2.notes.length >= 1 && l2.notes.every(n => n.folder === fStudy.id), 'list 按 id 过滤')
    const l3 = await noteManage.execute({ action: 'list', folder: '' })
    assert(l3.notes.every(n => !(n.folder && folders.some(f => f.id === n.folder))), 'list folder=\'\' 只看未分类')
    const e1 = await noteManage.execute({ action: 'list', folder: 'f-nope' })
    assert(e1.error && e1.error.indexOf('文件夹不存在') >= 0, 'list 不存在文件夹报错')
  })
  await t('note_search folder 过滤（名称命中 / \'\' 未分类 / 不存在报错）', async () => {
    const tSearch = findTool('note_search')
    const folders = (await handlers['notes-folders']({})).folders
    const fStudy = folders.find(f => f.name === '学习资料')
    const s1 = await tSearch.execute({ query: 'fld-manage-create', folder: '学习资料' })
    assert(s1.count >= 1 && s1.notes.every(n => n.folder === fStudy.id), '按名称过滤命中')
    const s2 = await tSearch.execute({ query: 'fld-manage-create', folder: '' })
    assert.strictEqual(s2.count, 0, '该笔记不在未分类，folder=\'\' 应查不到')
    const s3 = await tSearch.execute({ folder: fStudy.id })
    assert(s3.notes.length >= 1 && s3.notes.every(n => n.folder === fStudy.id), '按 id 过滤（无 query 列全部）')
    const e1 = await tSearch.execute({ folder: '不存在的文件夹' })
    assert(e1.error && e1.error.indexOf('文件夹不存在') >= 0, '不存在文件夹报错')
  })
  await t('update 不动 folder：note_manage.update 保持原值，notes-update 显式改', async () => {
    const folders = (await handlers['notes-folders']({})).folders
    const fWork = folders.find(f => f.name === '工作')
    const n = await noteManage.execute({ action: 'create', title: 'fld-upd-iso', body: 'x', folder: fWork.id })
    await noteManage.execute({ action: 'update', id: n.id, title: 'fld-upd-iso-改' })
    const g = await handlers['notes-get']({ id: n.id })
    assert.strictEqual(g.note.title, 'fld-upd-iso-改', '标题已改')
    assert.strictEqual(g.note.folder, fWork.id, 'update 未传 folder 时保持原文件夹')
    await handlers['notes-update']({ id: n.id, folder: '' })
    assert.strictEqual((await handlers['notes-get']({ id: n.id })).note.folder, '', 'notes-update 显式 folder=\'\' 移出（client 移动通道）')
  })
  await t('悬空引用兜底：folder 指向清单外 id 按未分类对待（计数/过滤口径一致）', async () => {
    const ghostId = 'n-ghost-folder'
    await fsMock.writeText(NOTES_DIR + '\\' + ghostId + '.md', '---\nid: ' + ghostId + '\ntitle: 悬空引用笔记\ntopic: 调试\nfolder: f-ghost000\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n正文\n')
    const g = await handlers['notes-get']({ id: ghostId })
    assert.strictEqual(g.note.folder, 'f-ghost000', '原始字段保留（不篡改数据）')
    const u0 = (await handlers['notes-folders']({})).unfiled
    const ghostList = await handlers['notes-list']({ folder: 'f-ghost000' })
    assert.strictEqual(ghostList.notes.length, 0, '按清单外 id 过滤为空（effectiveFolder 判未分类）')
    const unfiled = await handlers['notes-list']({ folder: '' })
    assert(unfiled.notes.find(n => n.id === ghostId), '悬空引用笔记出现在未分类列表')
    assert(u0 >= 1, '悬空引用计入 unfiled')
  })
  await t('folders.json 损坏/结构非法兜底：清单空 + 笔记主流程不受影响', async () => {
    store.set(FOLDERS_PATH_MOCK, '这不是 JSON {')
    const r1 = await handlers['notes-folders']({})
    assert(Array.isArray(r1.folders) && r1.folders.length === 0 && !r1.error, '坏 JSON → 空清单不抛错')
    const l = await handlers['notes-list']({})
    assert(l.notes.length >= 1, 'notes-list 主流程不受 folders.json 损坏影响')
    store.set(FOLDERS_PATH_MOCK, '{"x":1}')
    const r2 = await handlers['notes-folders']({})
    assert(r2.folders.length === 0, '非数组 JSON → 空清单')
    store.set(FOLDERS_PATH_MOCK, JSON.stringify([{ id: 'f-ok1', name: 'OK', order: 0 }, { name: '无id' }, null, 'junk', { id: 123, name: '数字id', order: '0' }]))
    const r3 = await handlers['notes-folders']({})
    assert.strictEqual(r3.folders.length, 2, '非法元素被过滤（缺 id/null/字符串）')
    assert(r3.folders.find(f => f.id === 'f-ok1') && r3.folders.find(f => f.id === '123'), '合法元素保留且 id 归一化为字符串')
    store.delete(FOLDERS_PATH_MOCK)
    const r4 = await handlers['notes-folders']({})
    assert(r4.folders.length === 0, '删除清单文件后回退空清单（状态清理）')
  })

  // --- 树状列表拖拽：笔记挪入/挪出文件夹（HTML5 DnD；开发版 + 发布包同步）---
  await t('拖拽：笔记行 draggable + dragstart 记录 noteId（ref 防闭包过期 + dataTransfer）', () => {
    assert(/const dragNoteIdRef = React\.useRef\(null\)/.test(clientSrc), 'dragNoteIdRef 拖拽状态 ref 存在')
    assert(/draggable: true, onDragStart: \(ev\) => onNoteDragStart\(ev, n\)/.test(clientSrc), '笔记行 draggable + onDragStart → onNoteDragStart')
    assert(/onDragEnd: \(ev\) => onNoteDragEnd\(ev\)/.test(clientSrc), '笔记行 onDragEnd → onNoteDragEnd')
    assert(/function onNoteDragStart\(ev, n\)/.test(clientSrc) && /function onNoteDragEnd\(ev\)/.test(clientSrc), 'onNoteDragStart/onNoteDragEnd 函数存在')
    assert(/dragNoteIdRef\.current = n\.id/.test(clientSrc), 'dragstart 记录 noteId 到 ref')
    assert(clientSrc.indexOf("ev.dataTransfer.setData('text/dsh-note-id', n.id)") >= 0, 'dragstart 写入 dataTransfer text/dsh-note-id（Firefox 起拖必需）')
    assert(clientSrc.indexOf("classList.add('dragging')") >= 0, 'dragstart 源行加 .dragging 半透明')
  })
  await t('拖拽：文件夹行 drop 目标（dragover preventDefault + drop-hint 高亮 + drop 移入）', () => {
    assert(/function onFolderDragOver\(ev, f\)/.test(clientSrc) && /function onFolderDragLeave\(ev\)/.test(clientSrc) && /function onFolderDrop\(ev, f\)/.test(clientSrc), '文件夹行 dragover/dragleave/drop 处理器存在')
    assert(/onDragOver: \(ev\) => onFolderDragOver\(ev, f\), onDragLeave: onFolderDragLeave, onDrop: \(ev\) => onFolderDrop\(ev, f\)/.test(clientSrc), '文件夹行挂载三个 DnD 处理器')
    assert(clientSrc.indexOf("classList.add('drop-hint')") >= 0 && clientSrc.indexOf("classList.remove('drop-hint')") >= 0, 'drop-hint 高亮加/摘')
    assert(clientSrc.indexOf('ctxMoveToFolder({ id: id }, f.id)') >= 0, 'drop 移入复用 ctxMoveToFolder（notes-update 只改 folder 字段）')
    assert(clientSrc.indexOf("(noteObj.folder || '') !== f.id") >= 0, '已在目标夹内静默无动作（不重复弹 toast）')
  })
  await t('拖拽：未分类区 drop 目标 = 移出文件夹；非法目标无动作；dragend 兜底清理', () => {
    assert(/function onUnfiledDragOver\(ev\)/.test(clientSrc) && /function onUnfiledDrop\(ev\)/.test(clientSrc), '未分类区 dragover/drop 处理器存在')
    assert(clientSrc.indexOf("className: 'dsh-notes-unfiled-drop', onDragOver: onUnfiledDragOver, onDragLeave: onUnfiledDragLeave, onDrop: onUnfiledDrop") >= 0, '未分类平铺区包一层 drop 容器')
    assert(clientSrc.indexOf("ctxMoveToFolder({ id: id }, '')") >= 0, 'drop 到未分类区 = 移出（folder: \'\'）')
    assert((clientSrc.match(/if \(!dragNoteIdRef\.current\) return/g) || []).length >= 3, '笔记拖拽 drop 处理器均先判 ref：非本插件拖拽不接管（非法目标无动作；文件夹拖拽走 dragFolderIdRef 通道）')
    assert(clientSrc.indexOf("classList.remove('dragging')") >= 0, 'dragend 清理 .dragging')
    assert(clientSrc.indexOf("querySelectorAll('.dsh-notes-floating .drop-hint')") >= 0, 'dragend 清理面板内所有残留 .drop-hint')
    // 右键「移动到…」保留（拖拽与右键菜单共存；0.4.8 文案收编 note.menu* 新键域）
    assert(clientSrc.indexOf('移动到…') >= 0, '右键「移动到…」保留')
  })
  await t('拖拽样式：.dragging 半透明 + .drop-hint 虚线描边（原型 .row.drop）+ 未分类区容器（开发版 + 发布包同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    assert(/\.dsh-notes-note-row\.dragging\{[^}]*opacity:\.35/.test(cssDev), 'styles.css 含 .dsh-notes-note-row.dragging opacity:.35（原型口径）')
    assert(/\.dsh-notes-folder-row\.drop-hint\{[^}]*outline:1\.5px dashed var\(--nacc\)/.test(cssDev), 'styles.css 含 .drop-hint 1.5px 虚线 --nacc 描边（原型 .row.drop）')
    assert(cssDev.indexOf('.dsh-notes-unfiled-drop') >= 0, 'styles.css 含未分类区 drop 容器样式')
    for (const cls of ['.dsh-notes-note-row.dragging', '.dsh-notes-folder-row.drop-hint', '.dsh-notes-unfiled-drop']) {
      assert(cssPkg.indexOf(cls) >= 0, '发布包 lib/styles.css 缺 ' + cls + '（需先跑 scripts/build-dist.cjs）')
    }
  })
  await t('发布包 client.js 同步拖拽链路（需先跑 scripts/build-dist.cjs）', () => {
    for (const k of ['text/dsh-note-id', 'onNoteDragStart', 'onNoteDragEnd', 'onFolderDragOver', 'onFolderDrop', 'onUnfiledDrop', 'dragNoteIdRef', 'drop-hint', 'dsh-notes-unfiled-drop', 'draggable: true']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 client.js 缺 ' + k)
    }
    assert(clientPkgSrc.indexOf('ctxMoveToFolder({ id: id }, f.id)') >= 0 && clientPkgSrc.indexOf("ctxMoveToFolder({ id: id }, '')") >= 0, '发布包 drop 移入/移出复用 ctxMoveToFolder')
  })

  // ===== 21.6 ⑩ 计数口径（0.4.3 验收修复⑩ 第二轮裁决③）：folders-count-sys 标记块双包逐字节一致 + 行为锚 =====
  // （folders.js ⇄ folders.dist.js 的 _folders list 计数段此前无守卫——本轮修复曾单边漂移，立此块防再犯，模式同节 58.3）
  await t('folders-count-sys 标记块双包逐字节一致（folders.js ⇄ folders.dist.js）+ 计数含 sys / unfiled 排 sys 行为锚', async () => {
    const mRe = /\/\/ ==== folders-count-sys BEGIN ====[\s\S]*?\/\/ ==== folders-count-sys END ====/
    const bDev = hostSrc.match(mRe), bDist = indexSrc.match(mRe)
    assert(bDev && bDist, '开发版拼接与静态包均须含 folders-count-sys 标记块（需先跑 scripts/build-dist.cjs）')
    assert.strictEqual(bDev[0], bDist[0], '标记块双包逐字节一致（folders.js ⇄ folders.dist.js 改一边忘另一边）')
    // 行为锚①：sys 入夹笔记计入文件夹徽标（与 folder 定向视图含 sys 一致；0.4.3⑩ 前面板「记忆档案」count=0 死节点根因）
    const fC = (await handlers['notes-folders']({ op: 'create', name: '计数锚⑩' })).folder
    assert(fC && fC.id, '计数锚文件夹创建成功')
    const cSysF = await handlers['notes-create']({ title: '计数锚-夹内sys', body: 'x', kind: 'sys', folder: fC.id })
    assert(cSysF && cSysF.id, '夹内 sys fixture 创建成功')
    const fl1 = await handlers['notes-folders']({})
    const rowC = (fl1.folders || []).find(f => f.id === fC.id)
    assert(rowC && rowC.count === 1, '文件夹徽标计入 sys（与定向视图一致；实得 ' + (rowC && rowC.count) + '）')
    // 行为锚②：未入夹 sys 不计入 unfiled（⑨「未分类」平铺同族守恒）；普通笔记照常计入
    const u0 = (await handlers['notes-folders']({})).unfiled
    await handlers['notes-create']({ title: '计数锚-未入夹sys', body: 'x', kind: 'sys' })
    const u1 = (await handlers['notes-folders']({})).unfiled
    assert.strictEqual(u1, u0, '未入夹 sys 不计入 unfiled（⑨ 同族口径）')
    await handlers['notes-create']({ title: '计数锚-未入夹普通', body: 'x' })
    const u2 = (await handlers['notes-folders']({})).unfiled
    assert.strictEqual(u2, u0 + 1, '未入夹普通笔记计入 unfiled（守恒口径不变）')
  })
  }
}
