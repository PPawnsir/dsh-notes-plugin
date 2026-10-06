// 节 57. 顶栏窄宽防竖排（notes-041-topbar-400：nowrap + flex-shrink:0 + ≤480px 次要按钮收图标，三端同步）
// 反馈 n-mut6uhcukyjm：400px 宽度顶栏「切换主题」「DSH 主界面」按钮定宽被压、文字逐字换行成竖排。
// 修复口径：①tbtn/titlebar-btn 文字 white-space:nowrap + flex-shrink:0（任何宽度不被压竖排）；
//           ②@media (max-width:480px) 断点下 .ico-only 按钮（切换主题/DSH 主界面）收起 .tb-t 文字只留图标（title 提示保留），
//             刷新/速记保文字，副标题 .sub 隐去（中间宽度带 ellipsis 截断兜底）；
//           ③app.html（src/app/shell）⇄ 原型 notes-ui-v2.html ⇄ 面板 styles.css 三端同步。
module.exports = {
  id: "57",
  title: "57. 顶栏窄宽防竖排（notes-041-topbar-400：nowrap + shrink:0 + ≤480px 次要按钮收图标，三端同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, SRC_STYLES } = H
  section('57. 顶栏窄宽防竖排（notes-041-topbar-400：nowrap + shrink:0 + ≤480px 次要按钮收图标，三端同步）')
  const appSrc = S.appSrc || fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
  const protoSrc = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
  const panelCssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
  const panelCssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')

  await t('顶栏按钮防竖排样式锚点（app.html + 原型）：tbtn nowrap + shrink:0 + ≤480px 断点收图标', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoSrc]]) {
      const s = pair[1], lab = pair[0]
      // ① 按钮本体：nowrap + flex-shrink:0（任何宽度不逐字竖排）
      assert(/\.tbtn\{[^}]*white-space:nowrap/.test(s), lab + ' .tbtn 缺 white-space:nowrap')
      assert(/\.tbtn\{[^}]*flex-shrink:0/.test(s), lab + ' .tbtn 缺 flex-shrink:0')
      // 副标题：中间宽度带 ellipsis 截断兜底（不挤按钮、自身也不竖排）
      assert(/\.topbar \.sub\{[^}]*white-space:nowrap[^}]*text-overflow:ellipsis/.test(s), lab + ' .topbar .sub 缺 nowrap+ellipsis 截断')
      // ② ≤480px 断点：次要按钮收图标 + 副标题隐去
      assert(s.indexOf('@media (max-width:480px)') >= 0, lab + ' 缺 @media (max-width:480px) 断点')
      const mb = s.slice(s.indexOf('@media (max-width:480px)'))
      assert(mb.indexOf('.tbtn.ico-only .tb-t{display:none}') >= 0, lab + ' 断点内缺 .tbtn.ico-only .tb-t{display:none}（收文字只留图标）')
      assert(/\.tbtn\.ico-only\{padding:4px 8px\}/.test(mb), lab + ' 断点内 ico-only 收窄 padding（图标态方形）')
      assert(mb.indexOf('.topbar .sub{display:none}') >= 0, lab + ' 断点内缺 .topbar .sub{display:none}（副标题隐去）')
    }
    // 原型独有：mock 标签（proto-tag）窄宽整颗隐去；app.html 无此元素不得残留
    assert(protoSrc.indexOf('<span class="tbtn proto-tag"') >= 0, '原型缺 proto-tag mock 标签')
    assert(protoSrc.indexOf('@media (max-width:480px){.topbar .proto-tag{display:none}}') >= 0, '原型缺 proto-tag 窄宽隐藏规则')
    assert(appSrc.indexOf('proto-tag') < 0, 'app.html 不得残留原型 proto-tag')
  })

  await t('顶栏按钮标记（app.html + 原型）：切换主题/DSH 主界面 ico-only（图标+title），刷新/速记保文字', () => {
    // app.html：四个按钮全量锚定（ico-only 两枚带图标+title+tb-t；常显两枚保文字无 ico-only）
    assert(/<button class="tbtn ico-only" id="btnTheme" title="切换主题[^"]*"><svg class="ic"><use href="#i-theme"\/><\/svg><span class="tb-t">切换主题<\/span><\/button>/.test(appSrc), 'app.html btnTheme 应为 ico-only + i-theme 图标 + title 提示 + tb-t 文字')
    assert(/<a class="tbtn ico-only" href="\/" id="btnHome" title="返回 DSH 主界面"><svg class="ic"><use href="#i-home"\/><\/svg><span class="tb-t">DSH 主界面<\/span><\/a>/.test(appSrc), 'app.html DSH 主界面链接应为 ico-only + tb-t 文字（id=btnHome 供 i18n 覆盖卡A renderChrome 接线）')
    assert(/<button class="tbtn" id="btnRefresh"[^>]*><svg class="ic"><use href="#i-refresh"\/><\/svg><span class="tb-t">刷新<\/span><\/button>/.test(appSrc), 'app.html btnRefresh 保文字（无 ico-only，文字包 tb-t）')
    assert(/<button class="tbtn" id="btnArchive"[^>]*><svg class="ic"><use href="#i-check"\/><\/svg><span class="tb-t">速记合并<\/span><\/button>/.test(appSrc), 'app.html btnArchive 保文字（无 ico-only，文字包 tb-t；0.4.5-D 改名速记合并）')
    assert(appSrc.indexOf('id="i-theme"') >= 0, 'app.html 缺 i-theme 图标 symbol')
    // 原型：按钮同构（第 4 枚为 proto-tag mock 标签，无 ico-only）
    assert(/<button class="tbtn ico-only" id="btnTheme" title="切换主题[^"]*"><svg class="ic"><use href="#i-theme"\/><\/svg><span class="tb-t">切换主题<\/span><\/button>/.test(protoSrc), '原型 btnTheme 应为 ico-only + i-theme 图标 + tb-t 文字')
    assert(/<button class="tbtn" id="btnRefresh"[^>]*><svg class="ic"><use href="#i-refresh"\/><\/svg><span class="tb-t">刷新<\/span>/.test(protoSrc) && /<button class="tbtn" id="btnArchive"[^>]*><svg class="ic"><use href="#i-check"\/><\/svg><span class="tb-t">速记合并<\/span>/.test(protoSrc), '原型 刷新/速记合并 保文字（tb-t；0.4.5-D 改名）')
    assert(protoSrc.indexOf('id="i-theme"') >= 0, '原型缺 i-theme 图标 symbol')
    // 计数闸：ico-only 恰好 = app 2（切换主题+DSH 主界面）/ 原型 1（切换主题），防误标扩散
    assert((appSrc.match(/class="tbtn ico-only"/g) || []).length === 2, 'app.html ico-only 按钮应恰好 2 枚')
    assert((protoSrc.match(/class="tbtn ico-only"/g) || []).length === 1, '原型 ico-only 按钮应恰好 1 枚')
    assert((appSrc.match(/class="tb-t"/g) || []).length === 4 && (protoSrc.match(/class="tb-t"/g) || []).length === 3, 'tb-t 文字包裹数：app 4 / 原型 3')
  })

  await t('行为级 eval：断点判定函数（自 CSS 源提取阈值 eval）+ ico-only 配对完整性（图标/title/文字三齐备，收图标不留空按钮）', () => {
    // 断点阈值自 CSS 源提取并 eval：400/480 → 图标态；481/920 → 完整态（模拟 400px 容器走图标分支）
    const m = appSrc.match(/@media \(max-width:(\d+)px\)\{\s*\.topbar \.sub\{display:none\}/)
    assert(m, 'app.html 断点块形态不符（@media (max-width:Npx){ .topbar .sub{display:none} …）')
    const iconMode = new Function('w', 'return w <= ' + m[1])
    assert(iconMode(400) === true && iconMode(480) === true, '≤断点（400/480px）走图标态分支')
    assert(iconMode(481) === false && iconMode(920) === false, '>断点（481/920px）保持完整文字')
    // 配对完整性：逐个解析顶栏按钮元素——ico-only 必须同时带 svg 图标 + title 提示 + tb-t 文字（收图标后不留空按钮/不丢可达名）
    const grabTopbar = (s) => s.slice(s.indexOf('<div class="topbar">'), s.indexOf('<div class="app">'))
    for (const pair of [['app.html', grabTopbar(appSrc)], ['原型', grabTopbar(protoSrc)]]) {
      const tb = pair[1], lab = pair[0]
      const btns = tb.match(/<(button|a|span) class="tbtn[^"]*"[^>]*>[\s\S]*?<\/\1>/g) || []
      assert(btns.length >= 4, lab + ' 顶栏按钮数 ≥4（实得 ' + btns.length + '）')
      for (const b of btns) {
        if (b.indexOf('ico-only') >= 0) {
          assert(b.indexOf('<svg class="ic">') >= 0 && b.indexOf('title="') >= 0 && b.indexOf('class="tb-t"') >= 0, lab + ' ico-only 按钮须图标+title+tb-t 三齐备：' + b.slice(0, 60))
        } else if (b.indexOf('proto-tag') < 0) {
          assert(b.indexOf('class="tb-t"') >= 0, lab + ' 常显按钮文字须包 tb-t：' + b.slice(0, 60))
        }
      }
    }
  })

  await t('面板顶栏按钮防竖排（styles.css 双端）：titlebar-btn nowrap + shrink:0', () => {
    for (const pair of [['styles.css', panelCssDev], ['发布包 lib/styles.css', panelCssPkg]]) {
      const c = pair[1], lab = pair[0]
      assert(/\.dsh-notes-titlebar-btn\{[^}]*white-space:nowrap/.test(c), lab + ' .dsh-notes-titlebar-btn 缺 white-space:nowrap（需跑 scripts/build-dist.cjs）')
      assert(/\.dsh-notes-titlebar-btn\{[^}]*flex-shrink:0/.test(c), lab + ' .dsh-notes-titlebar-btn 缺 flex-shrink:0（需跑 scripts/build-dist.cjs）')
      assert(/\.dsh-notes-titlebar-actions\{[^}]*flex-shrink:0/.test(c), lab + ' .dsh-notes-titlebar-actions 缺 flex-shrink:0（需跑 scripts/build-dist.cjs）')
    }
  })

  await t('app.html ⇄ 原型：窄宽断点 CSS 块逐字节一致（UI 同步硬性约定）', () => {
    const grab = (s) => (s.match(/ {2}@media \(max-width:480px\)\{\n[\s\S]*?\n {2}\}\n/) || [''])[0]
    const a = grab(appSrc), p = grab(protoSrc)
    assert(a.length > 10, 'app.html 断点 CSS 块抓取失败（缩进须为 2 空格）')
    assert(a === p, 'app.html ⇄ 原型：≤480px 断点 CSS 块逐字节不一致（改一端须同步另一端）')
  })
  }
}
