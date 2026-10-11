// 节 134. 文档安全 S6（notes-052-manual-mark-entries，反馈 n-mv3emwhuy2k6）：手动标记入口可达性
// 背景：用户真机验收——编辑器找不到手动「标为机密」入口。根因：app 🛡 钮在 #rtb（richScroll 内），源码模式容器隐藏 → 唯一可见
//   按钮消失；面板（client）编辑器完全没有手动标记入口（仅 S4 横幅一键标记）。
// 覆盖面：
//   ① app 源码模式可见入口：#srcSecretBtn（srcWrap 顶部右侧浮动 🛡）静态锚——srcWrap 内落位（富文本态随容器整体不出现）+
//     点击走 markSelectionSecret（三入口共用执行体，零新逻辑）+ 点亮态（select/keyup/mouseup 驱动 + renderModeUI 重估 +
//     renderEdLang title 翻转）+ rtb 面零改动红线（🛡 仍在 #rtb——「源码态补一个」不是「挪」）。
//   ② 面板三件套执行体：snapshotPanelSecretSel/applyPanelSecretSel/markPanelSelectionSecret——源码面 = 选区触及行经内核
//     wrapSecretLines 包 fence（既有面板标记路径，行粒度恒落顶格 fence）+ 尾换行行不计 + 既有机密 span 内行剔除（防双标）；
//     富文本面 = 选区包 ```secret 渲染岛 insertHTML（app applySecretSel 富文本分支同构）+ 新岛即挂 bindPanelSecret。
//   ③ 面板三入口接线：meta 🛡 钮（.dsh-notes-secret-mark，双模式恒可见 + mousedown 保选区）/ 编辑器右键菜单
//     （openPanelSecretCtx 有选区才拦 + edSecretCtxEl 挂面板根层同 ctxMenu 坐标基准 + Esc 栈 setEdSecretCtx 别名收编）/
//     Ctrl+Shift+S（markSecretRef 经 ref 调最新执行体 + edSecretFocusRef 焦点闸——面板外（宿主会话区）不拦不抢红线）。
//   ④ 面板遮蔽块点击修复锁（主窗口高优 steer 报障：点击纹丝不动）：e2e 用例 65 行为级在案锚 + React onClick 形态 +
//     旧 []-effect 空绑定形态出清（indexOf < 0 回归守卫）。
//   ⑤ 速查表收录断言（S1 遗留项收口）：Ctrl+Shift+S 行三端在案（app/client 字典 key 形态 + 原型静态中文 = zh 字典值逐字一致
//     ——51 节行数翻 10，本节复核三端同键）。
//   ⑥ i18n 双语键：cheat.kSecret + editor.secretAlreadyMarked 双字典齐备（68 节全域 parity 常驻看守）+ zh 原串内嵌抽查。
//   ⑦ e2e 在案锚：用例 65/66/67（面板遮蔽点击修复全链 + app 浮钮行为级 + 面板三入口行为级）。
// 红线：不改遮蔽/揭示/写回语义（遮蔽纯渲染层零写回——133 节看守）；rtb 富文本工具栏结构不动；面板热键不抢宿主区。
module.exports = {
  id: "134",
  title: "134. 文档安全 S6：手动标记入口可达性（app 源码浮钮 + 面板三件套 + 速查表收录）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('134. 文档安全 S6：手动标记入口可达性（app 源码浮钮 + 面板三件套 + 速查表收录）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const appEd = read('src/app/panels/editor.js')
  const appHead = read('src/app/shell/head.html')
  const cliEd = read('src/client/panels/panel/editor.js')
  const cliKb = read('src/client/panels/panel/keyboard.js')
  const cliIdx = read('src/client/panels/panel/index.js')
  const cliState = read('src/client/kernel/state.js')
  const zhDict = new Function(read('src/i18n/zh.js') + '\nreturn I18N_ZH')()
  const enDict = new Function(read('src/i18n/en.js') + '\nreturn I18N_EN')()

  // ===== 134.1 app 源码模式浮动 🛡 静态锚（srcWrap 内落位 + 零新逻辑 + 点亮态 + rtb 红线）=====
  await t('S6 app 源码浮钮静态锚：#srcSecretBtn 在 srcWrap 内（富文本态随容器不出现）+ 点击走 markSelectionSecret（零新逻辑）+ 点亮态三监听 + 样式 + rtb 红线', () => {
    // 落位：srcWrap 开栏 < srcSecretBtn < rtb 开栏（在 srcWrap 块内——renderModeUI srcWrap 显隐天然覆盖富文本态不出现）
    const iWrap = appEd.indexOf('<div class="src-wrap" id="srcWrap"')
    const iBtn = appEd.indexOf('id="srcSecretBtn"')
    const iRtb = appEd.indexOf('<div class="rtb" id="rtb">')
    assert(iWrap >= 0 && iBtn > iWrap && iRtb > iBtn, 'srcSecretBtn 落位 srcWrap 内（srcWrap < btn < rtb）——富文本态随容器整体隐藏，不挪 rtb 既有钮')
    assert(appEd.indexOf('<button class="rtb-btn src-secret-btn" id="srcSecretBtn" type="button" title="\' + t(\'editor.tbSecret\') + \'">\\uD83D\\uDEE1</button>') >= 0, '浮钮 markup（复用 .rtb-btn 基座 + 专属 .src-secret-btn + title 走 i18n 键）')
    // 点击走三入口共用执行体（零新逻辑红线）
    assert(appEd.indexOf("sb6.addEventListener('click', function () { markSelectionSecret(); updateSrcSecretBtn(); })") >= 0, '点击走 markSelectionSecret（applySecretSel/snapshotSecretSel 共用执行体——零新逻辑）+ 点击后重估点亮态')
    assert(appEd.indexOf("sb6.addEventListener('mousedown', function (ev) { ev.preventDefault() })") >= 0, 'mousedown 阻止默认保住 textarea 选区（rtb 钮同款纪律）')
    // 点亮态：select/keyup/mouseup 三监听 + updateSrcSecretBtn（有选区才亮——与 rtb 🛡 同口径）
    assert(appEd.indexOf('function updateSrcSecretBtn()') >= 0 && appEd.indexOf("b.classList.toggle('on', !!(edMode === 'source' && ta && ta.selectionStart !== ta.selectionEnd))") >= 0, '点亮执行体（源码态 + textarea 非折叠选区）')
    for (const ev of ["ta.addEventListener('select', updateSrcSecretBtn)", "ta.addEventListener('keyup', updateSrcSecretBtn)", "ta.addEventListener('mouseup', updateSrcSecretBtn)"]) {
      assert(appEd.indexOf(ev) >= 0, '点亮监听在案：' + ev)
    }
    assert(appEd.indexOf('updateSrcSecretBtn();   /* 文档安全 S6：模式切换重估源码 🛡 点亮态') >= 0, 'renderModeUI 模式切换重估（切源码无选区即灭）')
    assert(appEd.indexOf("var ssb6 = $('srcSecretBtn'); if (ssb6) ssb6.title = t('editor.tbSecret');") >= 0, 'renderEdLang title 随语言翻转（rtb 循环外独立钮）')
    // 样式：srcWrap 顶部右侧浮动（z3 = 镜像层 z2 之上）
    assert(appHead.indexOf('.src-secret-btn{position:absolute;top:6px;right:10px;z-index:3;') >= 0, 'head.html 浮钮样式（顶部右侧 + 实底 + z3 盖镜像层）')
    // rtb 红线：既有 🛡 钮原样在 #rtb（129 节锚联动——「源码态补一个」不是「挪」）
    assert(appEd.indexOf('<button class="rtb-btn" data-a="secret" title="\' + t(\'editor.tbSecret\') + \'">\\uD83D\\uDEE1</button>') >= 0, 'rtb 既有 🛡 钮 markup 零改动（红线：富文本态覆盖不缺钮）')
  })

  // ===== 134.2 面板执行体（源码行粒度经 wrapSecretLines + 富文本 insertHTML 岛 + 防双标）=====
  await t('S6 面板执行体：snapshot/apply/mark 三件（快照口径 app 同构）+ 源码面行粒度 wrapSecretLines（尾换行不计 + span 内行剔除防双标）+ 富文本面 insertHTML 岛同构', () => {
    assert(cliEd.indexOf('function snapshotPanelSecretSel()') >= 0 && cliEd.indexOf('function applyPanelSecretSel(snap)') >= 0 && cliEd.indexOf('function markPanelSelectionSecret() { applyPanelSecretSel(snapshotPanelSecretSel()) }') >= 0, '三件套（快照 + 执行体 + 直通入口——三入口共用执行体纪律）')
    // 快照口径：源码 selectionStart/End + 富文本 range 克隆 + 选区须落面板富文本内（app snapshotSecretSel 同构）
    assert(cliEd.indexOf('return s < e ? { mode: \'source\', s: s, e: e } : null') >= 0 && cliEd.indexOf('range: sel.getRangeAt(0).cloneRange(), text: txt') >= 0, '快照双模式形态（app 同构：源码偏移 / 富文本 range+text）')
    // 源码面：行粒度（选区 → 触及行 → wrapSecretLines——既有面板标记路径；顶格 fence 恒落遮蔽块）
    assert(cliEd.indexOf('const eAdj = body.charCodeAt(snap.e - 1) === 10 ? snap.e - 1 : snap.e') >= 0, '选区末字符恰为换行 → 尾行不计（空行不标）')
    assert(cliEd.indexOf('for (let li = a; li <= b; li++) inSpan[li] = true') >= 0 && cliEd.indexOf('if (!inSpan[li]) lines.push(li)') >= 0, '既有机密 span 内行剔除（防 fence 嵌套双标）')
    assert(cliEd.indexOf('wrapSecretLines(body, lines)') >= 0, '行号经内核 wrapSecretLines 包 fence（一键标记同一单源——零第二份分组算法）')
    assert(cliEd.indexOf("showToast(tt('editor.secretAlreadyMarked'))") >= 0, '全落机密区 → editor.secretAlreadyMarked toast（防双标可达兜底）')
    assert(cliEd.indexOf('srcRevealStartRef.current = null   // 文档安全 S5：标记后 span 序全变，揭示偏移收编（保守回蔽）') >= 0, '标记后揭示偏移收编（S5 纪律随行）')
    // 富文本面：insertHTML 渲染岛（app applySecretSel 富文本分支同构）+ 新岛即挂交互
    assert(cliEd.indexOf("const html = renderMarkdown('\\x60\\x60\\x60secret\\n' + snap.text + '\\n\\x60\\x60\\x60', wikiResolve)") >= 0 && cliEd.indexOf("document.execCommand('insertHTML', false, html)") >= 0, '富文本面 = 选区包 fence 渲染岛 insertHTML（app 同构；serializeRich 顶格回吐往返恒等）')
    assert(cliEd.indexOf('try { bindPanelSecret(rich) } catch (err) {}   // 插入岛即时可揭示') >= 0, '新机密岛即挂 bindPanelSecret（揭示/回糊交互即时可达）')
    assert(cliEd.indexOf('richDirtyRef.current = true; setRichSyncing(true); scheduleRichSync(); keepSel()') >= 0, '富文本面 dirty/防抖序列化/选区缓存随行（toolbarAction 同管线）')
  })

  // ===== 134.3 面板三入口接线（meta 钮 + 右键菜单 + hotkey 焦点闸 + Esc 栈）=====
  await t('S6 面板三入口接线：meta 🛡 钮（双模式恒可见 + mousedown 保选区）+ 右键菜单（有选区才拦 + 根层挂载 + Esc 栈收编）+ Ctrl+Shift+S（ref 中转 + 焦点闸不抢宿主区）', () => {
    // 入口①：meta 行动区 🛡 钮
    assert(cliEd.indexOf("e('span', { className: 'dsh-notes-meta-act dsh-notes-secret-mark dsh-nt', role: 'button', tabIndex: 0, 'data-tooltip': tt('editor.tbSecret')") >= 0, 'meta 🛡 钮（专属 .dsh-notes-secret-mark——面板唯一恒可见手动标记入口；键盘可达 role/tabIndex）')
    assert(cliEd.indexOf('onMouseDown: (ev) => { ev.preventDefault() },') >= 0 && cliEd.indexOf("onClick: (ev) => { ev.stopPropagation(); markPanelSelectionSecret() }") >= 0, 'mousedown 保选区 + 点击走共用执行体（rtb 钮同款纪律）')
    // 入口②：编辑器右键菜单（源码 textarea onContextMenu + 富文本 contextmenu 监听 + 菜单 JSX 根层挂载）
    assert(cliEd.indexOf('if (!ta2 || ta2.selectionStart === ta2.selectionEnd) return') >= 0, '源码面右键拦截闸（有选区才拦原生菜单——app 同口径）')
    assert(cliEd.indexOf('onContextMenu: (ev) => {') >= 0 && cliEd.indexOf("el.addEventListener('contextmenu', onCtxMenu)") >= 0, '源码/富文本双面 contextmenu 挂点（app 双面同构）')
    assert(cliEd.indexOf('function openPanelSecretCtx(ev, snap)') >= 0 && cliEd.indexOf('setCtxMenu(null)   // 互斥：笔记行右键菜单') >= 0, '菜单开函数（笔记行菜单互斥 + 面板内坐标夹紧）')
    assert(cliEd.indexOf("const edSecretCtxEl = edSecretCtx ? e('div', { className: 'dsh-notes-ctxmenu', style: { left: edSecretCtx.x + 'px', top: edSecretCtx.y + 'px' } }") >= 0 && cliEd.indexOf("tt('editor.ctxSecret')") >= 0, '菜单 JSX（复用 .dsh-notes-ctxmenu 样式族 + 标签走 editor.ctxSecret 既有键）')
    assert(cliIdx.indexOf('edSecretCtxEl,') >= 0 && cliIdx.indexOf('panelBridge.setEdSecretCtx = setEdSecretCtx') >= 0 && cliIdx.indexOf('setEdSecretCtx } = usePanelEditor(') >= 0, '装配层三接线（根层挂载 + panelBridge 回填 + 解构导出）')
    assert(cliKb.indexOf('if (edSecretCtxRef.current) { setEdSecretCtx(null); return }') >= 0, 'Esc 栈收编（edSecretCtxRef 镜像 + kernel setEdSecretCtx 别名中转）')
    // 入口③：Ctrl+Shift+S（ref 中转 + 焦点闸）
    assert(cliState.indexOf('const markSecretRef = { current: null }') >= 0 && cliState.indexOf('const edSecretCtxRef = { current: null }') >= 0 && cliState.indexOf('const edSecretFocusRef = { current: null }') >= 0 && cliState.indexOf('function setEdSecretCtx(v) { return panelBridge.setEdSecretCtx(v) }') >= 0, 'kernel/state.js S6 跨域 ref 群 + 转发别名')
    assert(cliEd.indexOf('markSecretRef.current = markPanelSelectionSecret') >= 0 && cliEd.indexOf('edSecretFocusRef.current = { src: edBodyDomRef.current, rich: richRef.current }') >= 0, '渲染期镜像写入（keydown 闭包读最新值——switchModeRef 同款纪律）')
    assert(cliKb.indexOf("if (mod && ev.shiftKey && !ev.altKey && (ev.key === 'S' || ev.key === 's')) {") >= 0 && cliKb.indexOf('if (!inEd) return   // 焦点不在面板编辑器：放行不 preventDefault（宿主快捷键不抢）') >= 0 && cliKb.indexOf('markSecretRef.current()') >= 0, 'hotkey 分支（inField 早退之前 + 焦点闸放行不 preventDefault——面板外不拦不抢红线）')
  })

  // ===== 134.4 面板遮蔽块点击修复锁（steer 报障：点击纹丝不动）=====
  await t('S6 遮蔽块点击修复锁：委托 = 层节点 React onClick（onVeilLayerClick）+ 旧 []-effect 空绑定形态出清（回归守卫）', () => {
    assert(cliEd.indexOf('function onVeilLayerClick(ev)') >= 0, 'onVeilLayerClick 委托执行体在案')
    assert(cliEd.indexOf("layer.addEventListener('click', onClick)") < 0, '旧形态出清：[]-deps effect + layer.addEventListener（首挂必关面板 layer=null 空跑后永不绑定 = 用户真机报障根因）')
    // 行为级由 e2e 用例 65 全链锁定（遮蔽 → 命中诊断 → 揭示 → 自动回蔽），133.4 节锚定挂载/onClick 形态
  })

  // ===== 134.5 速查表收录（S1 遗留项收口）+ i18n 双语键 =====
  await t('S6 速查表收录断言：Ctrl+Shift+S 行三端在案（app/client 字典 key + 原型静态中文 = zh 字典值逐字一致）+ cheat.kSecret/editor.secretAlreadyMarked 双字典齐备', () => {
    const appSrc = read('packages/dsh-notes-plugin/app.html')
    const proto = read('design/notes-ui-v2.html')
    const clientPkg = read('packages/dsh-notes-plugin/lib/client.js')
    const ROW_APP = "['Ctrl+Shift+S', 'cheat.kSecret']"
    const ZH_VAL = '编辑器：把选中文本标记为机密（有选区才生效；工具栏 🛡 / 右键菜单同入口）'
    for (const [tag, s] of [['app.html', appSrc], ['client（开发版拼接产物）', clientSrc], ['发布包 lib/client.js', clientPkg]]) {
      assert(s.indexOf(ROW_APP) >= 0, tag + ' 速查表含 Ctrl+Shift+S 行（字典 key 形态——需先跑 scripts/build-dist.cjs）')
    }
    assert(proto.indexOf("['Ctrl+Shift+S', '" + ZH_VAL + "']") >= 0, '原型速查表含 Ctrl+Shift+S 行（静态中文红线）')
    assert(zhDict['cheat.kSecret'] === ZH_VAL, 'zh 字典 cheat.kSecret 原串在案（与原型静态中文逐字一致——51.3⑦ 双端渲染等价前置）')
    for (const k of ['cheat.kSecret', 'editor.secretAlreadyMarked']) {
      assert(typeof zhDict[k] === 'string' && zhDict[k] && typeof enDict[k] === 'string' && enDict[k], k + ' 双字典齐备且非空（68 节全域 parity 常驻看守）')
    }
    assert(enDict['cheat.kSecret'].indexOf('mark the selected text as secret') >= 0, 'en cheat.kSecret 口径（Editor: mark the selected text as secret…）')
    assert(enDict['editor.secretAlreadyMarked'].indexOf('already inside a secret area') >= 0, 'en editor.secretAlreadyMarked 口径')
  })

  // ===== 134.6 e2e 在案锚（行为级三例：65 遮蔽点击修复 / 66 app 浮钮 / 67 面板三入口）=====
  await t('S6 e2e 在案锚：用例 65（遮蔽块点击修复全链）+ 用例 66（app 浮钮可见性/引导/包 fence/rtb 红线）+ 用例 67（面板三入口 + 防双标 + Esc 栈）', () => {
    const e2e65 = read('scripts/e2e/cases/65-panel-secret-veil-click.cjs')
    assert(e2e65.indexOf('65-panel-secret-veil-click') >= 0 && e2e65.indexOf("page.click('.dsh-notes-src-veil .src-secret-veil')") >= 0 && e2e65.indexOf("classList.contains('revealed')") >= 0, '用例 65 覆盖：遮蔽块点击 → 揭示态（steer 复现转正回归锁）')
    assert(e2e65.indexOf('elementFromPoint') >= 0 && e2e65.indexOf('自动回蔽') >= 0, '用例 65 覆盖：命中测试诊断 + ~10s 自动回蔽')
    const e2e66 = read('scripts/e2e/cases/66-app-src-secret-btn.cjs')
    assert(e2e66.indexOf('66-app-src-secret-btn') >= 0 && e2e66.indexOf('#srcSecretBtn') >= 0 && e2e66.indexOf('先选中要标记为机密的文字') >= 0 && e2e66.indexOf('src-secret-veil') >= 0, '用例 66 覆盖：app 浮钮可见 + 无选区引导 + 选区包 fence 遮蔽复活')
    assert(e2e66.indexOf('#rtb .rtb-btn[data-a="secret"]') >= 0, '用例 66 覆盖：rtb 既有 🛡 钮行为级（红线：富文本态覆盖不缺钮）')
    const e2e67 = read('scripts/e2e/cases/67-panel-manual-mark.cjs')
    assert(e2e67.indexOf('67-panel-manual-mark') >= 0 && e2e67.indexOf('dsh-notes-secret-mark') >= 0 && e2e67.indexOf('Control+Shift+s') >= 0 && e2e67.indexOf('标记为机密') >= 0, '用例 67 覆盖：面板三入口（钮/hotkey/右键菜单）')
    assert(e2e67.indexOf('PANELSEL-6742') >= 0 && e2e67.indexOf('所选内容已在机密区内') >= 0, '用例 67 覆盖：行粒度包 fence 锚词 + 防双标 toast + 零改写')
  })
  }
}
