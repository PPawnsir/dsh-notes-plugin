// 节 140. ⋯ 溢出菜单 fixed 定位 + 边界翻转钳制（notes-068-acts-menu-fixed；反馈 n-mvn7wk4q5i47：行动区折行后 ⋯ 落编辑器列最左端，菜单被树栏遮蔽）
// 根因：.meta-more-menu 旧 absolute+right:0 相对触发钮锚定 → 菜单右缘对齐按钮向左伸展 → ⋯ 折行落 .ed 最左端时菜单探出 .ed 左边界
//   → .ed{overflow:hidden} 裁切 → 视觉=被树遮蔽。修：双端改 position:fixed + z-index:160（对齐 .wiki-ac 档），开菜单时按触发钮
//   getBoundingClientRect() 算坐标：默认右缘对齐钮右缘（观感不变）；左缘 < 编辑器列左缘（或视口 8px 安全边）→ 翻转左缘对齐钮左缘。
// 红线：菜单项内容/顺序/开合语义零改动；不 portal（fixed 脱离裁切上下文即够）；不改 .ed 的 overflow；面板端零新依赖。
module.exports = {
  id: "140",
  title: "140. ⋯ 溢出菜单 fixed 定位 + 边界翻转钳制（双端同构，折行最左端不被树栏遮蔽）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('140. ⋯ 溢出菜单 fixed 定位 + 边界翻转钳制（notes-068-acts-menu-fixed，双端同构）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const headHtml = read('src/app/shell/head.html')
  const appMeta = read('src/app/panels/editor-meta.js')
  const cliEd = read('src/client/panels/panel/editor.js')
  const cssDev = read('src/styles.css')
  const appHtml = read('packages/dsh-notes-plugin/app.html')
  const clientPkgSrc = read('packages/dsh-notes-plugin/lib/client.js')
  const cssPkg = read('packages/dsh-notes-plugin/lib/styles.css')
  const grabFn = (src, head, label) => {
    const i = src.indexOf(head)
    assert(i >= 0, label + ' 缺 ' + head)
    const j = src.indexOf('\n}', i)
    assert(j > i, label + ' ' + head + ' 闭花括号定位失败')
    return src.slice(i, j + 2)
  }
  const ruleOf = (src, sel) => { const i = src.indexOf(sel); assert(i >= 0, '缺选择器 ' + sel); return src.slice(i, src.indexOf('}', i)) }

  // ===== 140.1 ①双端 fixed 定位 + z-index 静态锚（产物同步） =====
  await t('140 ①双端 fixed 定位静态锚：position:fixed + z-index:160 + 旧 absolute/right:0 锚清零（app head.html / styles.css + 产物同步）', () => {
    for (const [label, src, sel] of [['app head.html', headHtml, '.meta-more-menu{'], ['client styles.css', cssDev, '.dsh-notes-meta-more-menu{']]) {
      const r = ruleOf(src, sel)
      assert(r.indexOf('position:fixed') >= 0, label + ' fixed 定位（脱离 .ed overflow:hidden 裁切上下文）')
      assert(r.indexOf('z-index:160') >= 0, label + ' z-index:160（对齐 .wiki-ac 档）')
      assert(r.indexOf('absolute') < 0 && r.indexOf('right:0') < 0 && r.indexOf('top:calc(100%') < 0, label + ' 旧 absolute+right:0 锚清零（坐标改 JS 计算）')
    }
    /* 产物同步锚（改 src/** 后须跑 build-dist） */
    assert(ruleOf(appHtml, '.meta-more-menu{').indexOf('position:fixed') >= 0, 'app.html 产物缺 fixed 锚（需先跑 node scripts/build-dist.cjs）')
    assert(ruleOf(cssPkg, '.dsh-notes-meta-more-menu{').indexOf('position:fixed') >= 0, '产物 lib/styles.css 缺 fixed 锚（需先跑 node scripts/build-dist.cjs）')
    /* 红线：.ed overflow 护栏不动 */
    assert(ruleOf(headHtml, '.ed{').indexOf('overflow:hidden') >= 0, '.ed overflow:hidden 布局护栏不动（红线）')
  })

  // ===== 140.2 ②app 行为级：metaMorePlace 真函数 eval——常态右对齐 / 折行最左翻转 / 视口 8px 钳制 =====
  await t('140 ②app 行为级：metaMorePlace 坐标矩阵（常态右缘对齐 / 折行左缘越界翻转左对齐 / 视口 8px 钳制）', () => {
    const fnSrc = grabFn(appMeta, 'function metaMorePlace(btn, m) {', 'app editor-meta.js')
    const metaMorePlace = new Function('window', fnSrc + '\nreturn metaMorePlace;')(globalThis)
    const mkBtn = (r, edEl) => ({ getBoundingClientRect: () => r, closest: () => edEl })
    const mkMenu = (w) => { const m = { offsetWidth: w, style: {} }; return m }
    const mkEd = (left) => ({ getBoundingClientRect: () => ({ left: left }) })
    /* 常态：编辑器列宽绰（左 0），按钮右 500 → 右缘对齐（left = 500-120 = 380） */
    let m = mkMenu(120); metaMorePlace(mkBtn({ left: 480, right: 500, bottom: 100 }, mkEd(0)), m)
    assert(m.style.left === '380px' && m.style.top === '106px', '常态右缘对齐钮右缘（380/106，实得 ' + m.style.left + '/' + m.style.top + '）')
    assert(m.style.display === 'flex', '开菜单即 display:flex')
    /* 折行最左端：编辑器列左 300，⋯ 钮 left 310/right 330 → 右对齐会得 210 < 300 → 翻转左缘对齐钮左缘 310 */
    m = mkMenu(120); metaMorePlace(mkBtn({ left: 310, right: 330, bottom: 100 }, mkEd(300)), m)
    assert(m.style.left === '310px', '折行最左端翻转左缘对齐钮左缘（310，实得 ' + m.style.left + '）')
    /* 视口安全边：钮贴视口极左（left 2）→ 翻转后仍 < 8 → 钳到 8 */
    m = mkMenu(120); metaMorePlace(mkBtn({ left: 2, right: 22, bottom: 100 }, mkEd(0)), m)
    assert(m.style.left === '8px', '视口 8px 安全边钳制（8，实得 ' + m.style.left + '）')
  })

  // ===== 140.3 ③app 接线锚：开菜单走 metaMorePlace（点击 + 键盘经 click 同路径） =====
  await t('140 ③app 接线锚：onclick 开合走 metaMorePlace（键盘 Enter/Space 经 actsMoreEl.click() 同路径）+ 常态观感回归（不贴左时右缘对齐）', () => {
    assert(appMeta.indexOf("if (m.style.display === 'none') metaMorePlace(actsMoreEl, m)") >= 0, 'app 开菜单点走坐标计算')
    assert(appMeta.indexOf('actsMoreEl.click()') >= 0, 'app 键盘开合经 click 同路径（坐标计算零分叉）')
  })

  // ===== 140.4 ④外点收拢/点菜收拢回归锚（开合语义零改动） =====
  await t('140 ④开合语义零改动回归锚：外点收拢（metaActsBindOnce 委托）+ 点菜收拢监听 + client 外点 effect 原样', () => {
    assert(appMeta.indexOf('function metaActsBindOnce()') >= 0 && appMeta.indexOf("m.style.display = 'none'") >= 0, 'app 外点收拢委托原样')
    assert(appMeta.indexOf("$('mActsMenu').addEventListener('click'") >= 0, 'app 点菜收拢监听原样')
    assert(cliEd.indexOf("ev.target.closest('.dsh-notes-meta-more-wrap')") >= 0, 'client 外点收拢 effect 原样')
    assert(appMeta.indexOf('metaActsSplit') >= 0 && appMeta.indexOf('META_ACT_MAX = 5') >= 0, '菜单项内容/顺序口径零改动（metaActsSplit/META_ACT_MAX 原样）')
  })

  // ===== 140.5 ⑤面板端静态锚：actsMenuPosStyle 同构 + ref 取触发钮 rect（产物同步） =====
  await t('140 ⑤面板端静态锚：actsMoreRef + actsMenuPosStyle（同构翻转钳制）+ 菜单挂 style（产物 lib/client.js 同步）', () => {
    assert(cliEd.indexOf('const actsMoreRef = React.useRef(null)') >= 0, 'panel 触发钮 ref 在位')
    const i = cliEd.indexOf('const actsMenuPosStyle = () => {')
    assert(i >= 0, 'panel 缺 actsMenuPosStyle')
    const fnSrc = cliEd.slice(i, cliEd.indexOf('actRowEls.push', i))
    assert(fnSrc.indexOf('getBoundingClientRect') >= 0 && fnSrc.indexOf("closest('.dsh-notes-ed')") >= 0, 'panel 按钮 rect + 编辑器列左缘判定')
    assert(fnSrc.indexOf('br.right - mw') >= 0 && fnSrc.indexOf('left = br.left') >= 0 && fnSrc.indexOf('Math.max(left, 8)') >= 0, 'panel 右缘对齐 + 翻转 + 8px 钳制三件同构')
    assert(cliEd.indexOf("className: 'dsh-notes-meta-more-menu', style: actsMenuPosStyle()") >= 0, 'panel 菜单挂 style（fixed 坐标）')
    assert(clientPkgSrc.indexOf('actsMenuPosStyle') >= 0 && clientPkgSrc.indexOf('const actsMoreRef = React.useRef(null)') >= 0, '产物 lib/client.js 缺同构锚（需先跑 node scripts/build-dist.cjs）')
  })
  },
}
