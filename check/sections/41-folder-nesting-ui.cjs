// 节 41. 文件夹嵌套 UI（递归树 + 拖拽换父 + 级联删除 confirm + 面包屑 + maxFolderDepth 设置行，四端同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "41",
  title: "41. 文件夹嵌套 UI（递归树 + 拖拽换父 + 级联删除 confirm + 面包屑 + maxFolderDepth 设置行，四端同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { clientPkgSrc, g, plugin } = S
  // ===== 41. 文件夹嵌套 UI（notes-nested-folder-ui：递归树渲染 + 新建子文件夹/拖拽换父 + 级联删除 confirm + 面包屑路径 + maxFolderDepth 设置行）=====
  // 依赖 notes-nested-folder-host（§40 host 契约：parent/depth/递归子树过滤/cascade）。本节点 UI 侧四端：
  // client-impl.js + styles.css（→ scripts/build-dist.cjs 发布包 lib/client.js + lib/styles.css）+ app.html + 原型 notes-ui-v2.html。
  // 语义要点：递归树 depth-first（子文件夹先于直挂笔记）；文件夹视图/过滤命中/计数均按子树口径（与 host f.count 一致）；
  // 拖拽换父 cycle/自挂本地拦截 + 深度上限 host 拒绝 → toast；级联删除 confirm 统计本地按子树预估（host 无 dry-run 参数）。
  section('41. 文件夹嵌套 UI（递归树 + 拖拽换父 + 级联删除 confirm + 面包屑 + maxFolderDepth 设置行，四端同步）')
  const appSrcN = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const protoSrcN = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  const cssDevN = fsNative.readFileSync(SRC_STYLES, 'utf8')
  const cssPkgN = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')

  await t('嵌套 UI 递归树渲染：depth-first 递归 + 子树过滤/自动展开/计数 + 键盘导航顺序（四端同步）', () => {
    // ① client-impl：嵌套 helper 集（与 host folder-tree-helpers 同口径纯函数）+ 递归渲染器
    for (const fn of ['function folderSubtreeIdsOf(id)', 'function childFoldersOf(pid)', 'function rootFolders()', 'function folderPathOf(fid)']) {
      assert(clientSrc.indexOf(fn) >= 0, 'client-impl 缺嵌套 helper ' + fn)
    }
    assert(/function renderFolderNode\(f, sink\)/.test(clientSrc), 'client-impl 递归渲染器 renderFolderNode 存在')
    assert(clientSrc.indexOf('for (const cf of childFoldersOf(f.id)) renderFolderNode(cf, childEls)') >= 0, 'client-impl 子文件夹递归（depth-first）')
    assert(clientSrc.indexOf("if (childEls.length) sink.push(e('div', { key: 'kids-' + f.id, className: 'dsh-notes-nested' }, childEls))") >= 0, 'client-impl 子内容包 .dsh-notes-nested 缩进容器（复用排版体系）')
    assert(clientSrc.indexOf('for (const f of rootFolders()) renderFolderNode(f, treeEls)') >= 0, 'client-impl 根级清单驱动递归（悬空 parent 按根级防御）')
    assert(clientSrc.indexOf("kids.forEach(n => { treeIds.push(n.id); childEls.push(renderNoteRow(n, true)) })") >= 0, '键盘导航 treeIds 按递归渲染顺序推入（= depth-first）')
    // ② 子树口径：视图过滤 / 自动展开 / 计数（host f.count 已递归，过滤激活时切子树命中数）
    assert(clientSrc.indexOf('const subHits = filtersActive ? filtered.filter(n => sub[(n.folder || \'\')]).length : 0') >= 0, 'client-impl 子树命中统计（过滤激活时）')
    assert(clientSrc.indexOf("const sub = folderSubtreeIdsOf(f.id)") >= 0 && clientSrc.indexOf('const vsub = folderSubtreeIdsOf(view.id)') >= 0, 'client-impl 渲染与视图过滤共用子树 helper')
    // ③ 发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['function renderFolderNode(f, sink)', 'folderSubtreeIdsOf', 'childFoldersOf', 'rootFolders()', 'folderPathOf', "for (const f of rootFolders()) renderFolderNode(f, treeEls)"]) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k + '」（需先跑 scripts/build-dist.cjs）')
    }
    // ④ 样式（开发版 + 发布包）：嵌套子文件夹行 12.5px 小字（与嵌套笔记行同级口径）+ 文件夹行拖拽源半透明
    for (const pair of [['styles.css', cssDevN], ['发布包 lib/styles.css', cssPkgN]]) {
      assert(/\.dsh-notes-nested \.dsh-notes-folder-row\{[^}]*font-size:12\.5px/.test(pair[1]), pair[0] + ' 嵌套子文件夹行 12.5px 小字（.dsh-notes-nested .dsh-notes-folder-row）')
      assert(/\.dsh-notes-folder-row\.dragging\{[^}]*opacity:\.35/.test(pair[1]), pair[0] + ' 文件夹行拖拽源 .dragging 半透明')
    }
    // ⑤ app.html / 原型 notes-ui-v2.html 同步：helper + 递归渲染 + 子树视图过滤 + 行 draggable + 嵌套小字样式
    for (const pair of [['app.html', appSrcN], ['原型 notes-ui-v2.html', protoSrcN]]) {
      const s = pair[1], label = pair[0]
      for (const fn of ['function folderKids(pid)', 'function folderSubtree(id)', 'function folderPath(id)', 'function rootFolders()']) {
        assert(s.indexOf(fn) >= 0, label + ' 缺嵌套 helper ' + fn)
      }
      assert(/function folderNodeHtml\(f, vis, filtering\)/.test(s), label + ' 递归渲染器 folderNodeHtml 存在')
      assert(s.indexOf('rootFolders().forEach(function (f) { h += folderNodeHtml(f, vis, filtering) })') >= 0, label + ' 根级清单驱动递归渲染')
      assert(s.indexOf('subFolders.forEach(function (cf) { h += folderNodeHtml(cf, vis, filtering) })') >= 0, label + ' 子文件夹递归（depth-first：子文件夹先于直挂笔记）')
      assert(s.indexOf("else if (view.type === 'folder') { if (!folderSubtree(view.id)[n.folder || '']) return false }") >= 0, label + ' 文件夹视图过滤 = 递归子树口径')
      assert(s.indexOf('var subHits = filtering ? vis.filter(function (n) { return sub[n.folder || \'\'] }).length : 0;') >= 0, label + ' 子树命中统计（过滤激活时）')
      assert(s.indexOf('data-drop="1" draggable="true"') >= 0, label + ' 文件夹行 draggable（拖拽换父）')
      assert(/\.nested \.row\.head\{[^}]*font-size:12\.5px/.test(s), label + ' 嵌套子文件夹行 12.5px 小字（.nested .row.head）')
      assert(/\.row\.head\.drag\{[^}]*opacity:\.35/.test(s), label + ' 文件夹行拖拽源 .drag 半透明')
    }
    // ⑥ 原型 mock 升级：嵌套示例数据（f1a/f1b/f1a1 父链子树）+ list 返回 parent/depth + 子树递归计数
    assert(protoSrcN.indexOf("{ id: 'f1a', name: '前端', order: 3, parent: 'f1' }") >= 0 && protoSrcN.indexOf("{ id: 'f1a1', name: '构建部署', order: 5, parent: 'f1a' }") >= 0, '原型 mock 含嵌套示例文件夹（f1a 子级 / f1a1 第 3 层）')
    assert(protoSrcN.indexOf("parent: f.parent || '', depth: mDepth(f.id), count: cnt") >= 0, '原型 mock list 返回 parent/depth + 子树递归计数')
  })

  await t('嵌套 UI：新建子文件夹 + 拖拽换父（cycle 本地拦截 + 深度拒绝 toast）+ 同级排序（四端同步）', () => {
    // ① client-impl 新建子文件夹：右键菜单项 + subFolderFor 内联输入行（父夹子内容容器首位）+ create 带 parent
    assert(/const \[subFolderFor, setSubFolderFor\] = React\.useState\(null\)/.test(clientSrc), 'subFolderFor state（新建子文件夹内联输入的父夹 id）')
    assert(clientSrc.indexOf("'新建子文件夹'") >= 0 && clientSrc.indexOf('expandFolder(mf.id); setSubFolderFor(mf.id)') >= 0, '文件夹右键菜单「新建子文件夹」（展开父夹 + 打开内联输入）')
    assert(clientSrc.indexOf("placeholder: tt('tree.subFolderPlaceholder')") >= 0 && clientSrc.indexOf("if (subFolderFor === f.id)") >= 0, '子文件夹内联输入行渲染在父夹子内容容器首位（i18n 覆盖卡A 起 placeholder 走 t() 字典）')
    assert(clientSrc.indexOf('const parent = subFolderFor || \'\'') >= 0, 'doCreateFolder 取 subFolderFor 为 parent（\'\'=根级）')
    // ② client-impl 拖拽换父：文件夹行可拖 + dragFolderIdRef 通道 + doReparentFolder（cycle 本地拦 + 深度 host 拒绝 toast）
    assert(/const dragFolderIdRef = React\.useRef\(null\)/.test(clientSrc), 'dragFolderIdRef（文件夹拖拽源，与笔记拖拽互斥）')
    assert(/function onFolderDragStart\(ev, f\)/.test(clientSrc) && /function onFolderDragEnd\(ev\)/.test(clientSrc), '文件夹行 dragstart/dragend 处理器')
    assert(clientSrc.indexOf("ev.dataTransfer.setData('text/dsh-folder-id', f.id)") >= 0, '文件夹 dragstart 写 dataTransfer text/dsh-folder-id')
    assert(clientSrc.indexOf('draggable: true, onDragStart: (ev) => onFolderDragStart(ev, f)') >= 0, '文件夹行 draggable + 挂载拖拽源处理器')
    assert(/async function doReparentFolder\(fid, parentId\)/.test(clientSrc), 'doReparentFolder 存在（reorder parents 改挂）')
    assert(clientSrc.indexOf("parents: { [fid]: parentId || '' }") >= 0, 'reorder 携带 parents 映射（\'\'=移回根级）')
    /* i18n 覆盖卡F：cycle/自挂本地拦截 toast 走 t() 字典（fld.errSelf/errCycle，zh 原串在 src/i18n/zh.js） */
    assert(clientSrc.indexOf("showToast(t('fld.errSelf'))") >= 0 && clientSrc.indexOf("showToast(t('fld.errCycle'))") >= 0, 'cycle/自挂本地拦截 toast（省一次 RPC；覆盖卡F 起走 t()）')
    assert((clientSrc.match(/String\(res\.error\)\.replace\(\/\^notes-folders\\\.\\\w\+\\s\*\/, ''\)/g) || []).length >= 2, 'host 拒绝（深度上限/父不存在）错误串去 RPC 前缀后 toast（create + reparent 两处）')
    assert(clientSrc.indexOf("if (fid === f.id || folderSubtreeIdsOf(fid)[f.id]) return") >= 0, 'dragover 非法落点抑制（自挂/子孙不高亮不接管）')
    assert(clientSrc.indexOf("if (fid) { if (fid !== f.id) doReparentFolder(fid, f.id); return }") >= 0, 'drop 文件夹行 = 换父')
    assert(clientSrc.indexOf("if (fObj && (fObj.parent || '')) doReparentFolder(fid, '')") >= 0, 'drop 未入夹区 = 移回根级')
    assert(clientSrc.indexOf('拖到此处移回根级') >= 0, '文件夹拖拽中落点提示行文案切换（移回根级）')
    // ③ client-impl 同级排序：上移/下移在同级兄弟内换位（原位互换，非兄弟不动）；菜单含「移回根级」（有父级时）
    assert(clientSrc.indexOf("const sibs = childFoldersOf(f.parent || '')") >= 0 && clientSrc.indexOf('ids[i] = other.id; ids[j] = f.id') >= 0, '上移/下移同级兄弟内换位')
    assert(clientSrc.indexOf('folderMenuSibs.length - 1') >= 0, '右键菜单下移边界按同级兄弟')
    assert(clientSrc.indexOf("'移回根级'") >= 0 && clientSrc.indexOf("doReparentFolder(mf.id, '')") >= 0, '右键菜单「移回根级」（有父级时显示）')
    // ④ 发布包 lib/client.js 同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['doReparentFolder', 'dragFolderIdRef', 'subFolderFor', '新建子文件夹', 'parents: { [fid]: parentId || \'\' }', '拖到此处移回根级', 'text/dsh-folder-id']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k + '」（需先跑 scripts/build-dist.cjs）')
    }
    // ⑤ app.html / 原型同步：新建子文件夹菜单项 + reparentFolder + 拖拽事件委托 + cycle 本地拦 + 同级换位
    for (const pair of [['app.html', appSrcN], ['原型 notes-ui-v2.html', protoSrcN]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('data-a="sub"') >= 0 && s.indexOf('新建子文件夹') >= 0, label + ' 右键菜单「新建子文件夹」')
      assert(s.indexOf("else if (a === 'sub') doCreateFolder(f.id);") >= 0 && s.indexOf('function doCreateFolder(parentId)') >= 0, label + ' doCreateFolder(parentId) 嵌套新建')
      assert(s.indexOf("{ op: 'create', name: name.trim(), parent: parentId || '' }") >= 0, label + ' create 携带 parent')
      assert(/var dragId = null, dragFolderId = null/.test(s), label + ' dragFolderId 拖拽源状态')
      assert(/function reparentFolder\(fid, parentId\)/.test(s) && s.indexOf('var parents = {}; parents[fid] = parentId || \'\';') >= 0, label + ' reparentFolder（reorder parents 改挂）')
      /* i18n 覆盖卡F：app 端 cycle/自挂拦截 toast 走 t() 字典（fld.errSelf/errCycle）；原型不双语红线保留中文原文（分侧断言） */
      if (label === 'app.html') {
        assert(s.indexOf("toast(t('fld.errSelf'))") >= 0 && s.indexOf("toast(t('fld.errCycle'))") >= 0, label + ' cycle/自挂本地拦截 toast（覆盖卡F 起走 t()）')
      } else {
        assert(s.indexOf("toast('文件夹不能挂到自己下面')") >= 0 && s.indexOf("toast('文件夹不能挂到自己的子孙文件夹下面（cycle）')") >= 0, label + ' cycle/自挂本地拦截 toast')
      }
      assert(s.indexOf('if (tid === dragFolderId || folderSubtree(dragFolderId)[tid]) return') >= 0, label + ' dragover 非法落点抑制（cycle/自挂）')
      assert(s.indexOf('reparentFolder(fid, target); return') >= 0, label + ' drop 委托：文件夹拖拽 = 换父')
      assert(s.indexOf('拖到此处移回根级') >= 0, label + ' 文件夹拖拽中落点提示行文案（移回根级）')
      assert(s.indexOf("var sibs = folderKids(f.parent || '');") >= 0 && s.indexOf('ids[i] = other.id; ids[j] = f.id;') >= 0, label + ' 上移/下移同级兄弟内换位')
      assert(s.indexOf('data-a="root"') >= 0 && s.indexOf('移回根级') >= 0, label + ' 右键菜单「移回根级」（有父级时）')
      assert(s.indexOf("else if (a === 'root') reparentFolder(f.id, '');") >= 0, label + ' 移回根级菜单动作')
    }
    // ⑥ 原型 mock：create/reorder 深度上限校验（maxFolderDepth mock 设置驱动）+ cycle 拒绝
    assert(protoSrcN.indexOf('var mMaxDepth = function ()') >= 0 && protoSrcN.indexOf('超过文件夹嵌套深度上限 maxFolderDepth=') >= 0, '原型 mock 深度上限拒绝（与 host 同口径）')
    assert(protoSrcN.indexOf('文件夹不能挂到自己的子孙文件夹下面（cycle）') >= 0, '原型 mock reorder cycle 拒绝')
  })

  await t('嵌套 UI：级联删除 confirm 子树统计 + 面包屑路径可点击 + maxFolderDepth 设置行（四端同步）', () => {
    // ① client-impl 级联删除：confirm 明示「连子删除：N 子文件夹 + M 笔记移入回收站；文件夹结构不可恢复」（本地子树预估）+ cascade:true
    //    i18n 覆盖卡F：confirm 文案走 t() 字典（fld.delConfirmCascade/delConfirmEmpty，zh 原串在 src/i18n/zh.js）
    assert(clientSrc.indexOf("t('fld.delConfirmCascade', { name: f.name, childN: childN, noteN: noteN })") >= 0 && clientSrc.indexOf("t('fld.delConfirmEmpty', { name: f.name })") >= 0, 'client-impl 级联删除 confirm 文案（子树统计 + 不可恢复明示；覆盖卡F 起走 t()）')
    assert(clientSrc.indexOf('const childN = folders.filter(x => x.id !== f.id && sub[x.id]).length') >= 0 && clientSrc.indexOf("const noteN = notes.filter(n => sub[(n.folder || '')]).length") >= 0, 'client-impl 子树统计本地预估（folders/notes 清单）')
    assert(clientSrc.indexOf("{ op: 'delete', id: f.id, cascade: true }") >= 0, 'client-impl 删除带 cascade:true（confirm 后整棵删除）')
    assert(clientSrc.indexOf("if (view.type === 'folder' && sub[view.id]) setView({ type: 'all', id: '' })") >= 0, 'client-impl 视图落在被删子树内 → 回全部视图')
    assert(clientSrc.indexOf('移回未分类') < 0, 'client-impl 旧「移回未分类」删除文案已移除（cascade 语义 = 笔记进回收站）')
    // ② client-impl 面包屑：单文件夹名升级为「父/子/孙」路径，每段可点击 = 切到该文件夹视图
    assert(clientSrc.indexOf('folderPathOf(curNote.folder).map(pf =>') >= 0, 'client-impl 面包屑文件夹路径段（folderPathOf）')
    assert(clientSrc.indexOf("tt('meta.crumbFolderTip', { name: pf.name })") >= 0 && clientSrc.indexOf("setView({ type: 'folder', id: pf.id })") >= 0, 'client-impl 面包屑每段可点击切文件夹视图（tooltip i18n 覆盖卡B 起走 tt() 字典）')
    // ③ client-impl 设置卡片 maxFolderDepth 数值行（同 staleDays 输入交互：失焦/Enter 即保存）
    assert(/const \[setMaxDepth, setSetMaxDepth\] = React\.useState\('3'\)/.test(clientSrc), 'setMaxDepth state（缺省 3）')
    assert(/function saveSettingsMaxDepth\(\)/.test(clientSrc) && clientSrc.indexOf('settingsSetQuiet({ maxFolderDepth: v })') >= 0, 'saveSettingsMaxDepth 保存链路（settingsSetQuiet 低层通道）')
    assert(clientSrc.indexOf("{ key: 'maxdepth', label: tt('settings.maxDepth')") >= 0, '设置卡片「文件夹嵌套深度」行（覆盖卡 C 起 label 走 tt() 字典）')
    assert(clientSrc.indexOf('已保存：文件夹最多嵌套 ') >= 0, '保存 toast 文案')
    // ④ 发布包同步（需先跑 scripts/build-dist.cjs）
    for (const k of ['连子删除：', '文件夹结构不可恢复', 'folderPathOf(curNote.folder)', 'saveSettingsMaxDepth', "label: tt('settings.maxDepth')", "cascade: true"]) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k + '」（需先跑 scripts/build-dist.cjs）')
    }
    // ⑤ app.html / 原型同步：级联 confirm + 面包屑路径 + 设置行
    for (const pair of [['app.html', appSrcN], ['原型 notes-ui-v2.html', protoSrcN]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('连子删除：') >= 0 && s.indexOf('文件夹结构不可恢复') >= 0, label + ' 级联删除 confirm 文案')
      assert(s.indexOf("rpc('notes-folders', { op: 'delete', id: f.id, cascade: true })") >= 0, label + ' 删除带 cascade:true')
      assert(s.indexOf('移回未分类') < 0, label + ' 旧「移回未分类」删除文案已移除')
      assert(s.indexOf('folderPath(n.folder).forEach') >= 0 && s.indexOf('class="lnk crumb-f"') >= 0, label + ' 面包屑文件夹路径段（可点击）')
      assert(s.indexOf("view = { type: 'folder', id: fid }; foldOpen[fid] = true; saveFoldOpen(); render()") >= 0, label + ' 面包屑段点击切文件夹视图')
      assert(s.indexOf('id="setMaxDepth"') >= 0 && s.indexOf('文件夹嵌套深度') >= 0, label + ' 设置卡片「文件夹嵌套深度」行')
      assert(s.indexOf('saveSettings({ maxFolderDepth: parseInt(v, 10) }') >= 0, label + ' maxFolderDepth 保存链路')
      assert(s.indexOf('已保存：文件夹最多嵌套 ') >= 0, label + ' 保存 toast 文案')
    }
    // ⑥ 原型 mock：delete 缺省拒绝含子内容（needCascade + 统计）+ cascade 整棵软删进回收站
    assert(protoSrcN.indexOf('needCascade: true, childFolders: dChild, notes: dNotes.length') >= 0, '原型 mock delete 缺省拒绝 + 子内容统计（needCascade）')
    assert(protoSrcN.indexOf('dNotes.forEach(function (x) { x.deleted = true;') >= 0, '原型 mock cascade 子树笔记软删（回收站可恢复）')
  })
  }
}
