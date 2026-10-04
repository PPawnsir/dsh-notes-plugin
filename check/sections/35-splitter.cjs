// 节 35. 侧栏宽度拖拽分隔条（splitter：拖拽 + clamp + 记忆 + 双击重置，三端同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "35",
  title: "35. 侧栏宽度拖拽分隔条（splitter：拖拽 + clamp + 记忆 + 双击重置，三端同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { plugin, store } = S
  // ===== 35. 侧栏宽度拖拽分隔条（面板 + app.html + 原型三端同步：拖拽 / clamp 200px–60% / localStorage 记忆 / 双击重置） =====
  section('35. 侧栏宽度拖拽分隔条（splitter：拖拽 + clamp + 记忆 + 双击重置，三端同步）')
  const spCssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
  const spCssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
  const spClientPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  const spApp = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const spProto = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  await t('面板分隔条链路（client-impl.js）：元素 / DOM 序 / 拖拽 / clamp / 记忆 / 双击重置', () => {
    assert(clientSrc.indexOf("className: 'dsh-notes-splitter dsh-nt'") >= 0, '分隔条元素 .dsh-notes-splitter')
    assert(clientSrc.indexOf('onMouseDown: onSplitterMouseDown') >= 0 && clientSrc.indexOf('onDoubleClick: resetSideW') >= 0, 'mousedown / dblclick 接线')
    // DOM 序：分隔条位于侧栏（side-foot 之后）与编辑器（editorEl）之间
    const iFoot = clientSrc.indexOf('dsh-notes-side-foot'), iSplit = clientSrc.indexOf("className: 'dsh-notes-splitter"), iEd = clientSrc.indexOf('editorEl),')
    assert(iFoot > 0 && iSplit > iFoot && iEd > iSplit, '分隔条位于侧栏与编辑器之间')
    // 拖拽链路：复用 drag() 助手（mousemove 挂 document、mouseup 移除监听防泄漏）；拖拽期间 body 禁选 class 随 mouseup 移除
    const iFn = clientSrc.indexOf('function onSplitterMouseDown(ev)')
    assert(iFn > 0, 'onSplitterMouseDown 存在')
    const fnBody = clientSrc.slice(iFn, clientSrc.indexOf('function resetSideW', iFn))
    assert(fnBody.indexOf('drag(') >= 0, '复用 drag() 助手')
    assert(fnBody.indexOf("document.body.classList.add('dsh-notes-split-drag')") >= 0 && fnBody.indexOf("document.body.classList.remove('dsh-notes-split-drag')") >= 0, '拖拽期间禁文本选择（mouseup 移除）')
    assert(fnBody.indexOf('clampSideW(sw + ev2.clientX - sx') >= 0, 'mousemove 按面板内相对坐标增量算宽')
    assert(fnBody.indexOf('saveSideW(sideWRef.current)') >= 0, 'mouseup 持久化（ref 防闭包过期）')
    // drag() 助手自身：document mousemove / mouseup 成对装卸（mouseup 移除监听防泄漏）
    const iDrag = clientSrc.indexOf('function drag(move, done)')
    const dragBody = iDrag < 0 ? '' : clientSrc.slice(iDrag, iDrag + 420)
    assert(iDrag > 0 && dragBody.indexOf("document.addEventListener('mousemove', onMove)") >= 0 && dragBody.indexOf("document.removeEventListener('mousemove', onMove)") >= 0 && dragBody.indexOf("document.removeEventListener('mouseup', onUp)") >= 0, 'drag()：mousemove 挂 document、mouseup 移除监听')
    // clamp / 记忆 / 缺省 / aside 宽度受控
    assert(clientSrc.indexOf('function clampSideW(w, panelW)') >= 0 && clientSrc.indexOf('Math.max(200, Math.min(Math.round(panelW * 0.6), Math.round(w)))') >= 0, 'clamp 200px–60% 面板宽')
    assert(clientSrc.indexOf("const SIDE_W_KEY = 'dsh-notes-sidebar-w'") >= 0 && clientSrc.indexOf('const SIDE_W_DEFAULT = 300') >= 0, 'localStorage key（面板独立）+ 缺省 300（同 styles.css 侧栏缺省宽）')
    assert(clientSrc.indexOf('function resetSideW()') >= 0 && clientSrc.indexOf('saveSideW(null)') >= 0, '双击重置缺省宽（清除持久化）')
    assert(clientSrc.indexOf("className: 'dsh-notes-side', style: { width: clampSideW(sideW, size.width) + 'px' }") >= 0, 'aside 宽度受控（渲染按当前面板宽 clamp）')
  })
  await t('面板 clamp 边界 + 记忆恢复行为（client-impl 提取执行）', () => {
    const grabLine = (src, name) => { const st = src.indexOf('function ' + name + '('); assert(st >= 0, name + ' 存在'); return src.slice(st, src.indexOf('\n', st)) }
    const clampFn = new Function('return ' + grabLine(clientSrc, 'clampSideW'))()
    assert(clampFn(100, 920) === 200, 'clamp 下限 200px')
    assert(clampFn(300, 920) === 300, 'clamp 区间内原值')
    assert(clampFn(9999, 920) === 552, 'clamp 上限 = 60% 面板宽（920→552）')
    assert(clampFn(9999, 680) === 408, '上限随面板宽收窄（680→408）')
    const store = {}
    const mockLS = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: (k) => { delete store[k] } }
    const fns = new Function('localStorage', 'SIDE_W_KEY', grabLine(clientSrc, 'loadSideW') + '\n' + grabLine(clientSrc, 'saveSideW') + '\nreturn { loadSideW: loadSideW, saveSideW: saveSideW }')(mockLS, 'dsh-notes-sidebar-w')
    assert(fns.loadSideW() === null, '无持久化 → null（回缺省）')
    fns.saveSideW(420)
    assert(store['dsh-notes-sidebar-w'] === '420' && fns.loadSideW() === 420, '拖拽结束持久化 → 加载恢复')
    fns.saveSideW(null)
    assert(!('dsh-notes-sidebar-w' in store) && fns.loadSideW() === null, '双击重置清除持久化 → 回缺省')
    fns.saveSideW(150)
    assert(fns.loadSideW() === null, '非法值（<200）不回读')
  })
  await t('分隔条样式双端（styles.css ⇄ 发布包 lib/styles.css，build-dist 同步）', () => {
    for (const pair of [['styles.css', spCssDev], ['发布包 lib/styles.css', spCssPkg]]) {
      const c = pair[1], lab = pair[0]
      assert(c.indexOf('.dsh-notes-splitter{width:4px;margin:0 -7px;') >= 0, lab + ' 4px 分隔条叠加间隙不占位（负 margin 抵消 gap，需跑 scripts/build-dist.cjs）')
      assert(c.indexOf('.dsh-notes-splitter:hover,.dsh-notes-splitter.on{background:var(--nacc)}') >= 0, lab + ' hover/拖拽中高亮（需跑 scripts/build-dist.cjs）')
      assert(/\.dsh-notes-splitter\{[^}]*cursor:col-resize/.test(c), lab + ' col-resize 光标（需跑 scripts/build-dist.cjs）')
      assert(c.indexOf('body.dsh-notes-split-drag') >= 0 && c.indexOf('user-select:none!important') >= 0, lab + ' 拖拽期间全局禁文本选择（需跑 scripts/build-dist.cjs）')
    }
  })
  await t('发布包 client.js 同步分隔条链路（需先跑 scripts/build-dist.cjs）', () => {
    assert(spClientPkg.indexOf("className: 'dsh-notes-splitter") >= 0 && spClientPkg.indexOf('onSplitterMouseDown') >= 0 && spClientPkg.indexOf('resetSideW') >= 0 && spClientPkg.indexOf("'dsh-notes-sidebar-w'") >= 0, '发布包 lib/client.js 缺分隔条链路（需先跑 scripts/build-dist.cjs）')
  })
  await t('app.html + 原型同款：分隔条 DOM / 样式 / 脚本双端一致（key 独立 dsh-notes-app-sidebar-w）', () => {
    for (const pair of [['app.html', spApp], ['原型 notes-ui-v2.html', spProto]]) {
      const s = pair[1], lab = pair[0]
      // DOM：分隔条位于 </aside> 与 <section class="ed" 之间
      const iAside = s.indexOf('</aside>'), iSplit = s.indexOf('<div class="splitter" id="splitter"'), iEd = s.indexOf('<section class="ed')
      assert(iAside > 0 && iSplit > iAside && iEd > iSplit, lab + ' 分隔条 DOM 序：aside → splitter → ed')
      assert(s.indexOf('title="拖拽调整侧栏宽度（双击重置）"') >= 0, lab + ' 分隔条引导 tooltip')
      // 样式：4px 叠加间隙不占位 + hover/拖拽高亮 + col-resize + 拖拽期间禁选
      assert(s.indexOf('.splitter{width:4px;margin:0 -7px;') >= 0, lab + ' 4px 拖拽条叠加间隙不占位（负 margin 抵消 gap）')
      assert(s.indexOf('.splitter:hover,.splitter.on{background:var(--nacc)}') >= 0, lab + ' hover/拖拽中高亮')
      assert(/\.splitter\{[^}]*cursor:col-resize/.test(s), lab + ' col-resize 光标')
      assert(s.indexOf('body.split-drag') >= 0 && s.indexOf('user-select:none!important') >= 0, lab + ' 拖拽期间禁文本选择')
      // 脚本：mousedown 起拖 → document mousemove 算宽 → mouseup 卸监听；clamp；记忆；双击重置；窗口 resize 复核
      assert(s.indexOf("splitterEl.addEventListener('mousedown'") >= 0, lab + ' mousedown 起拖')
      assert(s.indexOf("document.addEventListener('mousemove', onMove)") >= 0 && s.indexOf("document.removeEventListener('mousemove', onMove)") >= 0 && s.indexOf("document.removeEventListener('mouseup', onUp)") >= 0, lab + ' mousemove 挂 document、mouseup 移除监听防泄漏')
      assert(s.indexOf("document.body.classList.add('split-drag')") >= 0 && s.indexOf("document.body.classList.remove('split-drag')") >= 0, lab + ' 拖拽期间禁选 class 随 mouseup 移除')
      assert(s.indexOf('function clampSideW(w)') >= 0 && s.indexOf('Math.max(200, Math.min(Math.round(') >= 0 && s.indexOf('* 0.6') >= 0, lab + ' clamp 200px–60% 面板宽')
      assert(s.indexOf("var SIDE_W_KEY = 'dsh-notes-app-sidebar-w'") >= 0 && s.indexOf('SIDE_W_DEFAULT = 342') >= 0, lab + ' localStorage 记忆（独立 key）+ 缺省 342（同 .side 缺省宽）')
      assert(s.indexOf('function loadSideW()') >= 0 && s.indexOf('\nloadSideW();') >= 0, lab + ' 加载恢复持久化宽度')
      assert(s.indexOf("splitterEl.addEventListener('dblclick'") >= 0 && s.indexOf('applySideW(SIDE_W_DEFAULT)') >= 0 && s.indexOf('saveSideW(null)') >= 0, lab + ' 双击重置缺省宽（清除持久化）')
      assert(s.indexOf("window.addEventListener('resize'") >= 0, lab + ' 窗口 resize 按新 60% 上限复核')
      assert(s.indexOf("'dsh-notes-sidebar-w'") < 0, lab + ' 不用面板 key（key 独立）')
    }
    // 双端逐字节一致：分隔条 CSS 块与 JS 块（UI 同步硬性约定；数据层之外的共享交互）
    const grabCss = (s) => (s.match(/  \/\* ===== 侧栏宽度拖拽条[\s\S]*?-webkit-user-select:none!important\}\n/) || [''])[0]
    assert(grabCss(spApp).length > 10 && grabCss(spApp) === grabCss(spProto), 'app.html ⇄ 原型：分隔条 CSS 逐字节一致')
    const grabJs = (s) => (s.match(/\/\* ================= 侧栏宽度拖拽条[\s\S]*?\nloadSideW\(\);\n/) || [''])[0]
    assert(grabJs(spApp).length > 10 && grabJs(spApp) === grabJs(spProto), 'app.html ⇄ 原型：分隔条脚本逐字节一致')
  })
  }
}
