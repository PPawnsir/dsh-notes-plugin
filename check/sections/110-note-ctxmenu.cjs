// 节 110. 0.4.8 笔记行右键菜单（notes-048-note-ctxmenu；反馈 n-mut4lscwg6tf R1+R2：归类仅拖拽一条路）
// 规格：笔记行右键菜单冻结四项（顺序即序）——移动到…（子层文件夹树，嵌套夹缩进，当前归属打勾禁用，尾部恒有
//   「未分类（移出文件夹）」，零文件夹禁用显示「暂无文件夹」）/ 置顶切换（meta pin 同款 notes-update status 通道）/
//   派发（直开派发弹窗，复用既有入口 openDispatch）/ 删除（既有软删流 + sys 警示 confirm 门槛）；
//   交互纪律全抄文件夹菜单（点外/Esc 关、视口夹紧、右键另一行直接换目标）；多选态右键 v1 = 作用本行单行（裁决留注）。
// 双端同构（app panels/tree.js openNoteMenu + client popovers/ctx-menu.js）+ 原型 notes-ui-v2.html 同步 + i18n note.menu* 新键域。
// 红线看守：文件夹菜单零改动 / 拖拽路径不动 / 删除置顶走既有 RPC 通道。
// 行为级主战场：noteMenuFolderRows/ctxFolderRows 纯函数双端 eval 全矩阵；交互级归 e2e ㊸（app）/ ㊹（面板 harness）。
module.exports = {
  id: "110",
  title: "110. 0.4.8 笔记行右键菜单（notes-048-note-ctxmenu）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('110. 0.4.8 笔记行右键菜单（notes-048-note-ctxmenu）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appTree = read('src/app/panels/tree.js')
  const appFolders = read('src/app/panels/folders.js')
  const appKeyboard = read('src/app/panels/keyboard.js')
  const appHead = read('src/app/shell/head.html')
  const cliCtxMenu = read('src/client/popovers/ctx-menu.js')
  const cliTree = read('src/client/panels/panel/tree.js')
  const cliKeyboard = read('src/client/panels/panel/keyboard.js')
  const protoSrc = read('design/notes-ui-v2.html')
  const appHtml = read('packages/dsh-notes-plugin/app.html')
  const clientPkgSrc = read('packages/dsh-notes-plugin/lib/client.js')
  const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
  const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')

  // ===== 110.1 子层行纯函数行为级 eval（双端同口径：嵌套缩进/当前归属/悬空防御/cycle 守卫/零文件夹）=====
  await t('0.4.8 笔记菜单「移动到…」子层行行为级：noteMenuFolderRows(app)/ctxFolderRows(client) eval 全矩阵', () => {
    // app 侧提取：函数自含（只读 folders 全局），stub folders 即可 eval；noteMenuFolderRows(n) 读 n.folder
    const a0 = appTree.indexOf('function noteMenuFolderRows(n)'), a1 = appTree.indexOf('function openNoteMenu(x, y, nid, moveOpen)')
    assert(a0 >= 0 && a1 > a0, 'app tree.js 含 noteMenuFolderRows → openNoteMenu 区间')
    const appFactory = new Function('folders', appTree.slice(a0, a1) + '\nreturn noteMenuFolderRows')
    const appRows = (folders, noteFolder) => appFactory(folders)({ folder: noteFolder })
    // client 侧提取：BEGIN/END 标记区间（基座缩进不影响 eval）
    const c0 = cliCtxMenu.indexOf('// ===== 0.4.8 note-ctxmenu BEGIN ====='), c1 = cliCtxMenu.indexOf('// ===== 0.4.8 note-ctxmenu END =====')
    assert(c0 >= 0 && c1 > c0, 'client ctx-menu.js 含 note-ctxmenu BEGIN/END 标记区间')
    const cliRows = new Function(cliCtxMenu.slice(c0, c1) + '\nreturn ctxFolderRows')()
    const FX = [
      { id: 'fA', name: '甲夹', parent: '' },
      { id: 'fB', name: '乙子夹', parent: 'fA' },
      { id: 'fC', name: '丙夹', parent: '' },
    ]
    for (const [label, rowsOf] of [['app', appRows], ['client', cliRows]]) {
      // 嵌套树 depth-first 打平 + depth 缩进层级
      const rows = rowsOf(FX, '')
      assert(rows.length === 3 && rows[0].id === 'fA' && rows[1].id === 'fB' && rows[2].id === 'fC', label + ' depth-first 打平顺序（实得 ' + rows.map(r => r.id).join(',') + '）')
      assert(rows[0].depth === 0 && rows[1].depth === 1 && rows[2].depth === 0, label + ' 嵌套夹 depth 递增（实得 ' + rows.map(r => r.depth).join(',') + '）')
      // 当前归属打勾禁用标记
      const cur = rowsOf(FX, 'fB')
      assert(cur[1].cur === true && cur[0].cur === false && cur[2].cur === false, label + ' 当前归属项 cur=true 其余 false')
      assert(rowsOf(FX, '').every(r => r.cur === false) && rowsOf(FX, undefined).every(r => r.cur === false), label + ' 笔记无归属（\'\'/undefined）无 cur 项')
      // 零文件夹 → 空数组（菜单项禁用显示「暂无文件夹」分支）
      assert(rowsOf([], '').length === 0, label + ' 零文件夹返回空数组')
      // 悬空 parent 按根级防御补挂（rootFolders 同口径）
      const dang = rowsOf(FX.concat([{ id: 'fD', name: '悬空夹', parent: 'ghost' }]), '')
      assert(dang.length === 4 && dang[3].id === 'fD' && dang[3].depth === 0, label + ' 悬空 parent 补挂根级 depth 0')
      // cycle 守卫：纯环（E↔F 父指针互指且都存在）不 hang、根级行不受影响
      const cyc = rowsOf(FX.concat([{ id: 'fE', name: '环E', parent: 'fF' }, { id: 'fF', name: '环F', parent: 'fE' }]), '')
      assert(cyc.length >= 3 && cyc[0].id === 'fA' && cyc[2].id === 'fC', label + ' cycle 守卫终止且可达行完整')
      const cyc2 = rowsOf(FX.concat([{ id: 'fG', name: '自环', parent: 'fG' }]), '')
      assert(cyc2.filter(r => r.id === 'fG').length <= 1, label + ' 自环防御至多一次（guard 去重）')
    }
  })

  // ===== 110.2 app 端结构锚：分流 + 冻结四项顺序 + 子层规格 + 视口夹紧 =====
  await t('0.4.8 app 笔记右键菜单结构锚：contextmenu 分流（笔记行先于文件夹行）+ 冻结四项顺序 + 子层三规格 + 实测视口夹紧', () => {
    // contextmenu 委托：笔记行分流先于文件夹行（模块源 CRLF 行尾——多行锚一律走 [\s\S] 正则，不写字面 \n）
    assert(/addEventListener\('contextmenu', function \(ev\) \{[\s\S]{0,400}closest\('\[data-note\]'\)[\s\S]{0,200}openNoteMenu\(ev\.clientX, ev\.clientY, nrow\.dataset\.note, false\); return \}[\s\S]{0,120}openFolderMenu\(ev\.clientX, ev\.clientY, frow\.dataset\.fold\)/.test(appTree), 'tree contextmenu 委托笔记行分流（先于文件夹行，右键另一行直接换目标=重建 innerHTML）')
    assert(appTree.indexOf('function openNoteMenu(x, y, nid, moveOpen)') >= 0, 'openNoteMenu 存在（moveOpen 子层开合态）')
    assert(appTree.indexOf('/* 右键即选中（client openCtxMenu 同口径）') >= 0 && /openNoteMenu[\s\S]{0,400}selectNote\(nid\);/.test(appTree), '右键即选中（派发/删除以选中笔记为对象，client 同口径）')
    // 冻结四项顺序即序：move → pin → dispatch → del（源码内 indexOf 递增）
    const iMove = appTree.indexOf('data-a="move"'), iPin = appTree.indexOf('data-a="pin"'), iDisp = appTree.indexOf('data-a="dispatch"'), iDel = appTree.indexOf('data-a="del"', appTree.indexOf('openNoteMenu'))
    assert(iMove >= 0 && iPin > iMove && iDisp > iPin && iDel > iDisp, '冻结四项顺序：移动到…→置顶→派发→删除')
    // 子层三规格：嵌套缩进 / 未分类恒在 / 零文件夹禁用
    assert(appTree.indexOf('(22 + r.depth * 14) + \'px">\'') >= 0, '子层嵌套夹 depth 缩进')
    assert(appTree.indexOf("(r.cur ? '✓ ' : '')") >= 0 && appTree.indexOf("r.cur ? ' dis' : ''") >= 0, '当前归属项打勾禁用（cur → ✓ + dis）')
    assert(appTree.indexOf("t('note.menuMoveOut')") >= 0 && appTree.indexOf('data-mv=""') >= 0, '「未分类（移出文件夹）」恒在子层尾部（data-mv 空串=移出）')
    assert(appTree.indexOf("t('note.menuNoFolders')") >= 0 && appTree.indexOf('<div class="mi dis">') >= 0, '零文件夹该项禁用显示「暂无文件夹」')
    // 视口夹紧：渲染后实测尺寸双向 clamp（非估值）
    assert(appTree.indexOf('Math.max(4, Math.min(x, innerWidth - m.offsetWidth - 4))') >= 0 && appTree.indexOf('Math.max(4, Math.min(y, innerHeight - m.offsetHeight - 4))') >= 0, '视口夹紧（实测 offsetWidth/Height 双向 clamp）')
    // CSS 增量限定域（.ctxmenu-note / mi.sub / mi.dis）
    assert(appHead.indexOf('.ctxmenu-note{') >= 0 && appHead.indexOf('.ctxmenu .mi.sub{') >= 0 && appHead.indexOf('.ctxmenu .mi.dis{') >= 0, 'app head.html 菜单增量样式（限定域，文件夹菜单零影响）')
  })

  // ===== 110.3 app 动作通道锚：四项各一条 + 关闭纪律 =====
  await t('0.4.8 app 动作通道锚：移动 RPC 参数锁 + 置顶 status 通道翻转 + 派发直开弹窗 + 删除既有流（sys confirm）+ 点外/Esc 通用关', () => {
    // 移动到夹 RPC 参数锁：moveNoteToFolder 既有通道原文（notes-update 只改 folder 字段；'' = 移出）
    assert(appTree.indexOf("rpc('notes-update', { id: id, folder: folderId })") >= 0, '移动走既有 moveNoteToFolder（notes-update {id, folder} 参数锁）')
    assert(appTree.indexOf("if (mi.hasAttribute('data-mv')) { closeCtx(); moveNoteToFolder(n.id, mi.getAttribute('data-mv') || ''); return }") >= 0, '子层点击接线 moveNoteToFolder（cur 项无 data-mv 天然不触发）')
    // 置顶翻转：meta pin 同款 RPC 通道（status 字段）+ 编辑中笔记同步 meta +  toast 复用既有键
    assert(appTree.indexOf('function doNoteMenuPin(n)') >= 0 && appTree.indexOf("rpc('notes-update', { id: n.id, status: to })") >= 0, '置顶走 notes-update status 通道（meta pin 同款）')
    assert(appTree.indexOf("var to = isPinned(n) ? 'active' : 'pinned'") >= 0 && appTree.indexOf("t('meta.pinnedToast') : t('meta.unpinnedToast')") >= 0, '置顶翻转双向 + toast 复用 meta.pinnedToast/unpinnedToast')
    // 派发：直开既有弹窗入口（selectNote 先行就位 selId/edNote）
    assert(appTree.indexOf("else if (a === 'dispatch') openDispatch();") >= 0, '派发直开既有 openDispatch 入口（不新造弹窗）')
    // 删除：既有软删流 + sys 警示 confirm 门槛（sys.batchDelWarn 既有键单篇口径）
    assert(appTree.indexOf('function doNoteMenuDelete(n)') >= 0 && appTree.indexOf("confirm(t('sys.batchDelWarn', { n: 1 }))") >= 0 && appTree.indexOf('doDeleteNote(n.id)') >= 0, '删除复用 doDeleteNote + sys confirm 红线门槛')
    // 菜单项标签复用既有键（禁重复建别名）：meta.pin/unpin + meta.dispatch + common.delete
    assert(appTree.indexOf("(isPinned(n) ? t('meta.unpin') : t('meta.pin'))") >= 0 && appTree.indexOf("t('meta.dispatch')") >= 0 && appTree.indexOf("t('common.delete')") >= 0, '置顶/派发/删除标签复用 meta.*/common.* 既有键')
    // 关闭纪律：点外关（folders.js document mousedown 通用闸）+ Esc 关（keyboard.js ctxHost 通用闸）零改动在案
    assert(appFolders.indexOf("if (!ev.target.closest('.ctxmenu')) closeCtx();") >= 0, '点外关通用闸在案（folders.js，.ctxmenu 同族覆盖笔记菜单）')
    assert(appKeyboard.indexOf("if ($('ctxHost').firstChild) { closeCtx(); return }") >= 0, 'Esc 关通用闸在案（keyboard.js，#ctxHost 宿主通用）')
  })

  // ===== 110.4 client 端同构锚 =====
  await t('0.4.8 client 笔记右键菜单同构：冻结四项顺序 + 派发直开 + 树形子层（缩进/打勾禁用/未分类恒在/零文件夹禁用）+ 遗留项保留 + sys confirm + 重夹紧', () => {
    // 冻结四项顺序（菜单 JSX 域内 indexOf 递增）
    const j0 = cliCtxMenu.indexOf('const ctxMenuEl = ctxMenu ?')
    assert(j0 >= 0, 'ctxMenuEl 菜单 JSX 存在')
    const jm = cliCtxMenu.indexOf("t('note.menuMoveTo')", j0), jp = cliCtxMenu.indexOf("t('meta.unpin') : t('meta.pin')", j0),
      jd = cliCtxMenu.indexOf("t('meta.dispatch')", j0), jx = cliCtxMenu.indexOf("t('common.delete')", j0)
    assert(jm > 0 && jp > jm && jd > jp && jx > jd, '冻结四项顺序：移动到…→置顶→派发→删除')
    // 派发直开既有入口（modals/dispatch.js 序位在前直调，selbar→openMerge 同先例）
    assert(cliCtxMenu.indexOf("setCtxMenu(null); openDispatch()") >= 0, '派发项 setCtxMenu(null) + openDispatch() 直开')
    // 树形子层规格
    assert(cliCtxMenu.indexOf('function ctxFolderRows(folders, noteFolder)') >= 0, 'ctxFolderRows 纯函数存在（BEGIN/END 标记区间供 eval）')
    assert(cliCtxMenu.indexOf("(22 + r.depth * 14) + 'px'") >= 0 && cliCtxMenu.indexOf('disabled: r.cur') >= 0, '嵌套夹 depth 缩进 + 当前归属打勾禁用')
    assert(cliCtxMenu.indexOf("disabled: !(ctxMenu.note.folder || '')") >= 0 && cliCtxMenu.indexOf("t('note.menuMoveOut')") >= 0, '「未分类（移出文件夹）」恒在（无归属时打勾禁用）')
    assert(cliCtxMenu.indexOf("ctxMoveRows.length === 0") >= 0 && cliCtxMenu.indexOf("t('note.menuNoFolders')") >= 0, '零文件夹禁用显示「暂无文件夹」')
    // 子层开合重夹紧（展开增高 y 重 clamp；CSS max-height:320 滚动兜底）
    assert(cliCtxMenu.indexOf('function toggleCtxMove()') >= 0 && cliCtxMenu.indexOf('rect.height - 320 - 4') >= 0, 'toggleCtxMove 子层开合不关菜单 + 视口重夹紧')
    // sys 警示 confirm 门槛（复用既有键单篇口径）+ 删除走既有 doDelete
    assert(cliCtxMenu.indexOf("window.confirm(t('sys.batchDelWarn', { n: 1 }))") >= 0 && cliCtxMenu.indexOf('doDelete(n0.id)') >= 0, '删除复用 doDelete + sys confirm 红线门槛')
    // 遗留项保留在分隔线后（worker 裁决留注：已解决=面板唯一 resolve 入口；合并=多选态快捷入口）
    const jsep = cliCtxMenu.indexOf("dsh-notes-ctxmenu-sep", j0)
    assert(jsep > jx && cliCtxMenu.indexOf("t('ctx.reopen')", jsep) > jsep && cliCtxMenu.indexOf("t('ctx.merge')", jsep) > jsep, '分隔线后遗留项保留（标记已解决/合并为一篇）')
    // 右键即选中 + 打开互斥（关文件夹菜单）+ 外点关/Esc 栈镜像在案
    assert(cliCtxMenu.indexOf('selectNote(n)   // 右键即选中') >= 0 && cliCtxMenu.indexOf('setFolderMenu(null)') >= 0, '右键即选中 + 两菜单互斥')
    assert(cliCtxMenu.indexOf("ev.target.closest('.dsh-notes-ctxmenu')") >= 0 && cliKeyboard.indexOf('ctxMenuRef.current') >= 0, '外点关 + Esc 栈镜像在案')
    // 行 data-note 属性（与 app noteRow 同构——右键菜单/e2e 精确锚定）
    assert(cliTree.indexOf("'data-note': n.id,") >= 0, 'client 笔记行补 data-note 属性（与 app 同构）')
    // 移动通道不变：ctxMoveToFolder 走 notes-update folder 字段（参数锁）
    assert(/ctxMoveToFolder[\s\S]{0,400}host\.call\('notes-update', \{ id: n\.id, folder: folderId \}\)/.test(cliCtxMenu), '移动走 ctxMoveToFolder（notes-update {id, folder} 参数锁）')
  })

  // ===== 110.5 i18n：note.menu* 新键域 =====
  await t('0.4.8 i18n：note.menu* 四键双语齐备 + 占位符同形 + ctx.moveTo/moveOut 退役 + 双端代码引用', () => {
    for (const k of ['note.menuMoveTo', 'note.menuMoveOut', 'note.menuNoFolders', 'note.menuPinFailed']) {
      assert(typeof ZH[k] === 'string' && ZH[k] && typeof EN[k] === 'string' && EN[k], '双语缺 key/空值：' + k)
      const pz = (ZH[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (EN[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
    assert.strictEqual(ZH['note.menuMoveTo'], '移动到…', 'zh 移动到…文案')
    assert.strictEqual(EN['note.menuMoveOut'], 'Unfiled (remove from folder)', 'en 未分类文案')
    assert(!('ctx.moveTo' in ZH) && !('ctx.moveTo' in EN) && !('ctx.moveOut' in ZH) && !('ctx.moveOut' in EN), 'ctx.moveTo/ctx.moveOut 已退役（收编更名进 note.menu*，节 68 双向覆盖兜底零悬挂）')
    assert(appTree.indexOf("t('note.menuMoveTo')") >= 0 && cliCtxMenu.indexOf("t('note.menuMoveTo')") >= 0, 'note.menuMoveTo 双端代码引用')
    assert(appTree.indexOf("t('note.menuPinFailed', { msg:") >= 0, 'note.menuPinFailed app 侧引用（pin catch toast）')
  })

  // ===== 110.6 四端产物同步（锁「改源须重跑 concat-app/build-dist」+ 原型回写）=====
  await t('0.4.8 产物与原型同步：app.html / 发布包 lib/client.js 含菜单真码 + 原型 openNoteMenu 同款（中文直写红线）', () => {
    assert(appHtml.indexOf('function openNoteMenu(x, y, nid, moveOpen)') >= 0 && appHtml.indexOf("'note.menuMoveTo': '移动到…'") >= 0, 'app.html 产物含 openNoteMenu + note.menu* 字典（改后须 concat-app/build-dist）')
    assert(clientPkgSrc.indexOf('function ctxFolderRows(folders, noteFolder)') >= 0 && clientPkgSrc.indexOf("'note.menuMoveTo': '移动到…'") >= 0 && clientPkgSrc.indexOf('setCtxMenu(null); openDispatch()') >= 0, '发布包 lib/client.js 含 ctxFolderRows + 字典 + 派发直开（改后须 build-dist）')
    assert(protoSrc.indexOf('function openNoteMenu(x, y, nid, moveOpen)') >= 0 && protoSrc.indexOf('function noteMenuFolderRows(n)') >= 0, '原型含 openNoteMenu/noteMenuFolderRows')
    assert(protoSrc.indexOf("openNoteMenu(ev.clientX, ev.clientY, nrow.dataset.note, false)") >= 0, '原型 contextmenu 笔记行分流')
    assert(protoSrc.indexOf('移动到…<span class="hint">暂无文件夹</span>') >= 0 && protoSrc.indexOf('未分类（移出文件夹）') >= 0, '原型中文直写（不双语红线）+ 零文件夹/未分类子层同款')
    assert(protoSrc.indexOf('function doNoteMenuPin(n)') >= 0 && protoSrc.indexOf('function doNoteMenuDelete(n)') >= 0, '原型置顶/删除动作函数同款')
    assert(protoSrc.indexOf('.ctxmenu-note{') >= 0, '原型 CSS 增量限定域同款')
  })

  // ===== 110.7 红线：文件夹菜单零改动 + 拖拽路径不动 + 多选态 v1 留注 =====
  await t('0.4.8 红线：文件夹菜单关键结构原文不动 + 拖拽委托/落点链路原文不动 + 多选态单行裁决留注双端在案', () => {
    // 文件夹菜单零改动（只复用模式不改它）：openFolderMenu 关键行原文锚
    for (const k of ['function openFolderMenu(x, y, fid)', '\'<div class="mi" data-a="sub">\'', "if (a === 'sub') doCreateFolder(f.id);", "else if (a === 'del') doDeleteFolder(f);"]) {
      assert(appFolders.indexOf(k) >= 0, 'app 文件夹菜单关键行原文不动：' + k.slice(0, 30))
    }
    // 拖拽路径不动：dragstart/drop 委托关键行原文锚（菜单是增量不是替代）
    assert(appTree.indexOf("$('tree').addEventListener('dragstart', function (ev)") >= 0 && appTree.indexOf("$('tree').addEventListener('drop', function (ev)") >= 0, 'app 拖拽委托原文在案')
    assert(/var id = dragId; dragId = null;\r?\n {2}moveNoteToFolder\(id, target\);/.test(appTree), 'app 拖拽落点 moveNoteToFolder 链路原文不动')
    // 多选态右键 v1 = 作用本行单行（裁决留注双端注释在案）
    assert(appTree.indexOf('多选态右键 v1 裁决留注') >= 0 && cliCtxMenu.indexOf('多选态右键 v1 裁决留注') >= 0, '多选态单行裁决留注双端注释在案')
  })
  }
}
