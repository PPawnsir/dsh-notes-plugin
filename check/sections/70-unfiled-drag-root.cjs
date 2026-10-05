// 节 70. 根目录笔记拖拽落夹修复（notes-041d-drag-root-note：未入夹区提示行置尾 + 三端同步）
// 根因（真实浏览器 A/B 复现实锤，CDP Input.dispatchDragEvent 管线）：.unfiled-hint 提示行默认 display:none、
// dragstart 时 .drag-on 点亮为 block——旧结构里它是容器的**第一个子元素**（排在根目录笔记行之前），点亮瞬间把
// 本夹笔记行（=拖拽源行）整体下移，Chromium 判定拖拽源位移直接取消拖拽（dragstart → 立即 dragend，无 dragover/drop）。
// 已归类笔记不在容器内、源行零位移，拖拽正常——故表现为「根目录笔记拖不进文件夹」。定性：老 bug（0.3.x 根级直显
// unfiled-drop 结构引入即带），非今晚 i18n/树改造回归（git diff 0.4.0..HEAD 拖拽链路零改动）。
// 修复：提示行渲染排笔记行**之后**（app 树 + React 面板 + 原型三端同步），点亮时源行零位移。
module.exports = {
  id: "70",
  title: "70. 根目录笔记拖拽落夹（未入夹提示行置尾防源行位移取消拖拽，三端同步，notes-041d）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  const { clientPkgSrc } = S
  section('70. 根目录笔记拖拽落夹（未入夹提示行置尾，notes-041d）')

  // ===== 70.1 结构断言：提示行必须排在本夹笔记行之后（拖拽源行零位移——Chromium 源位移取消拖拽）=====
  await t('app 树渲染：unfiled-drop 容器内提示行排笔记行之后（行首提示行结构禁止回潮）', () => {
    const appTreeSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'tree.js'), 'utf8')
    // 开容器与首行笔记行渲染之间不得插入提示行（旧行首结构回归检测）
    const mOpen = appTreeSrc.indexOf('\'<div class="unfiled-drop" data-drop-out="1">\';')
    const mRow = appTreeSrc.indexOf('unfiled.forEach(function (n) { h += noteRow(n, false) });')
    const mHint = appTreeSrc.indexOf('\'<div class="unfiled-hint">\'')
    assert(mOpen >= 0 && mRow >= 0 && mHint >= 0, 'app 树 unfiled 块三锚点齐全（开容器/笔记行/提示行）')
    assert(mOpen < mRow && mRow < mHint, 'app 树顺序必须为 开容器 → 笔记行 → 提示行（实得 ' + mOpen + ',' + mRow + ',' + mHint + '）')
    assert(appTreeSrc.indexOf('\'<div class="unfiled-drop" data-drop-out="1"><div class="unfiled-hint">') < 0, 'app 树 行首提示行旧结构已移除（回归即本断言红）')
    assert(appTreeSrc.indexOf('notes-041d-drag-root-note') >= 0, 'app 树 根因注释在位（后续维护可考古）')
  })

  await t('React 面板：unfiled 容器 children 顺序 = unfiledKids 在前、提示行在后（开发版 + 发布包）', () => {
    for (const pair of [['client 开发版', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const anchor = pair[1].indexOf('onDrop: onUnfiledDrop },')
      assert(anchor >= 0, pair[0] + ' unfiled 容器 children 段可提取')
      const seg = pair[1].slice(anchor, anchor + 200)
      const kidsPos = seg.indexOf('unfiledKids')
      const hintPos = seg.indexOf('dsh-notes-unfiled-hint')
      assert(kidsPos >= 0 && hintPos >= 0 && kidsPos < hintPos, pair[0] + ' children 顺序 = unfiledKids → 提示行（实得：' + JSON.stringify(seg.slice(0, 120)) + '）')
      assert(pair[1].indexOf('notes-041d-drag-root-note') >= 0, pair[0] + ' 根因注释在位（发布包需先跑 scripts/build-dist.cjs）')
    }
  })

  await t('原型同步：notes-ui-v2.html unfiled 容器内提示行同样置尾', () => {
    const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    const mOpen = protoSrc.indexOf('\'<div class="unfiled-drop" data-drop-out="1">\';')
    const mRow = protoSrc.indexOf('unfiled.forEach(function (n) { h += noteRow(n, false) });')
    const mHint = protoSrc.indexOf('\'<div class="unfiled-hint">拖到此处移出文件夹</div>\'')
    assert(mOpen >= 0 && mRow >= 0 && mHint >= 0 && mOpen < mRow && mRow < mHint, '原型顺序 = 开容器 → 笔记行 → 提示行（实得 ' + mOpen + ',' + mRow + ',' + mHint + '）')
    assert(protoSrc.indexOf('\'<div class="unfiled-drop" data-drop-out="1"><div class="unfiled-hint">') < 0, '原型 行首提示行旧结构已移除')
  })

  // ===== 70.2 产物同步：app.html（concat 产物）与发布包 client.js 内同样置尾 =====
  await t('构建产物：app.html + lib/client.js 同步置尾（防忘跑 build-dist）', () => {
    const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const mOpen = appSrc.indexOf('\'<div class="unfiled-drop" data-drop-out="1">\';')
    const mRow = appSrc.indexOf('unfiled.forEach(function (n) { h += noteRow(n, false) });')
    const mHint = appSrc.indexOf('\'<div class="unfiled-hint">\'')
    assert(mOpen >= 0 && mRow >= 0 && mHint >= 0 && mOpen < mRow && mRow < mHint, 'app.html 顺序 = 开容器 → 笔记行 → 提示行（需先跑 node scripts/build-dist.cjs）')
    assert(appSrc.indexOf('\'<div class="unfiled-drop" data-drop-out="1"><div class="unfiled-hint">') < 0, 'app.html 行首提示行旧结构已移除')
  })

  // ===== 70.3 行为级：app 树 dragstart→dragover→drop 链（根目录笔记 → 文件夹 = 归一 folder；根因修复锁）=====
  // 说明：Chromium「源位移取消拖拽」无法用合成 DragEvent 复现（合成事件不经过浏览器拖拽管线），
  // 本断言锁 handler 链路正确性（dragstart 记 dragId / dragover 落点判定含根目录源 / drop 归一 folder=''→目标夹），
  // 真实管线级回归由 scratch/probe-root-drag5.cjs（CDP dispatchDragEvent + mock RPC）人工复核。
  await t('app 树拖拽链行为级：根目录笔记 dragstart→dragover(夹行)→drop → moveNoteToFolder 归一目标夹', () => {
    const appTreeSrc = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'tree.js'), 'utf8')
    // dragstart 委托：笔记分支（closest [data-note]）记录 dragId——对根目录/已归类笔记同一路径（结构一致性锁）
    assert(/var nrow = ev\.target\.closest\('\[data-note\]'\); if \(!nrow\) return;/.test(appTreeSrc), 'dragstart 笔记分支入口（根目录笔记同路径可达）')
    assert(/dragId = nrow\.dataset\.note; nrow\.classList\.add\('drag'\);/.test(appTreeSrc), 'dragstart 记录 dragId + 源行标记')
    // dragover 委托：落点判定 [data-drop],[data-drop-out] + preventDefault（drop 前置条件）
    assert(/var drop = ev\.target\.closest\('\[data-drop\],\[data-drop-out\]'\);/.test(appTreeSrc), 'dragover/drop 落点判定选择器')
    assert(/ev\.preventDefault\(\);\s*\n\s*drop\.classList\.add\('drop'\);/.test(appTreeSrc), 'dragover preventDefault + 落点高亮（drop 触发前置）')
    // drop 委托：target 归一（data-drop-out→''，data-drop→夹 id）→ moveNoteToFolder
    assert(/var target = drop\.hasAttribute\('data-drop-out'\) \? '' : drop\.dataset\.fold;/.test(appTreeSrc), 'drop 目标归一（移出=空串 / 落夹=夹 id）')
    assert(/var id = dragId; dragId = null;\s*\n\s*moveNoteToFolder\(id, target\);/.test(appTreeSrc), "drop → moveNoteToFolder(id, folderId)（folder 为空串的根目录笔记同链路归一）")
  })
  }
}
