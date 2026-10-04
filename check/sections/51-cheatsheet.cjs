// 节 51. 键盘流速查表（cheat sheet，notes-034-f-cheatsheet：? 键唤起 + 设置卡入口，三端同步 + 键位逐键核对）
// 设计定稿（UX 候选 F，证据 n-mus81wvkwk67）：R-4 键盘流落地后的可发现性收口——? 键（非输入焦点）/设置卡「键盘快捷键」行
//   → 速查表弹层（复用既有 modal 样式，Esc/再按 ?/✕/点遮罩关闭）；内容优先级高于美观，键位与 keyboard.js 实现逐键核对，
//   含「Ctrl+N 是浏览器保留键，已改 Alt+N」标注。三端：client 面板（modals/cheatsheet.js）/ app.html（src/app/modals/cheatsheet.js）/
//   原型 design/notes-ui-v2.html（与 app 同款 DOM 实现）。
// 测试策略：四端锚点（clientSrc/clientPkgSrc/appSrc/protoV2Src）+ openCheatsheet 双端逐字节一致 + 键位表⇄实现双向核对。
module.exports = {
  id: "51",
  title: "51. 键盘流速查表（cheat sheet：? 键唤起 + 设置卡入口，键位与 R-4 实现逐键核对）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, SRC_STYLES, clientSrc } = H
  const { appSrc, clientPkgSrc, protoV2Src } = S
  section('51. 键盘流速查表（cheat sheet：? 键唤起 + 设置卡入口，键位与 R-4 实现逐键核对）')

  const grabFn = (s, name, tag) => { const m = s.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}')); assert(m, tag + ' 缺 ' + name + '()'); return m && m[0] }

  // ===== 51.1 client 面板速查表（开发版 + 发布包）=====
  await t('键盘流速查表（client）：modal 模块 + ? 键唤起/toggle + Esc 栈首段 + 设置卡入口 + 样式（开发版 + 发布包）', () => {
    // ① modal 模块（modals/cheatsheet.js）：store 切片 + ref 镜像 + open 互斥（modal 不叠 modal，同注入管理先例）
    assert(clientSrc.indexOf('store.modal.cheatsheet = createStore({ open: false })') >= 0, 'store.modal.cheatsheet 切片')
    assert(clientSrc.indexOf('const cheatsheetOpenRef = { current: false }') >= 0, 'cheatsheetOpenRef 镜像（Esc 栈 / ? 键守卫）')
    assert(clientSrc.indexOf('function setCheatsheetOpen(v)') >= 0 && clientSrc.indexOf('function openCheatsheet()') >= 0, 'setCheatsheetOpen / openCheatsheet')
    assert(clientSrc.indexOf("panelBridge.setSettingsOpen(false); setShowHelp(false); setCheatsheetOpen(true)") >= 0, 'openCheatsheet 与设置卡互斥 + 收帮助气泡')
    assert(clientSrc.indexOf('function CheatsheetModal()') >= 0 && clientSrc.indexOf("className: 'dsh-notes-settings-modal dsh-notes-cheatsheet-modal'") >= 0, 'CheatsheetModal 复用设置卡 mask/modal 样式')
    // ② ? 键：非输入焦点唤起；已开再按 = 关闭（toggle）；任一弹层打开时不抢键
    assert(clientSrc.indexOf("if (ev.key === '?') {") >= 0, '? 键分支存在')
    assert(clientSrc.indexOf('if (cheatsheetOpenRef.current) { setCheatsheetOpen(false); return }   // 速查表打开时再按 ? = 关闭（toggle）') >= 0, '? toggle 关闭')
    assert(clientSrc.indexOf('|| settingsOpenRef.current) return   // 任一弹层打开时不抢键') >= 0, '? 守卫：弹层打开不抢键')
    assert(clientSrc.indexOf('openCheatsheet(); return') >= 0, '? 调 openCheatsheet')
    // ③ Esc 栈首段关速查表（在图片/链接弹窗之前——速查表为独立顶层弹层，不叠其他 modal）
    assert(clientSrc.indexOf("const cm = ctxMenuRef.current; if (cheatsheetOpenRef.current) { setCheatsheetOpen(false); return } if (imgModalRef.current)") >= 0, 'Esc 栈首段关速查表')
    // ④ 共存守卫：速查表打开时 Ctrl+/ 不切模式、列表 j/k/Enter 导航暂停
    assert(clientSrc.indexOf('!linkModalRef.current && !cheatsheetOpenRef.current && switchModeRef.current') >= 0, 'Ctrl+/ 速查表守卫')
    assert(clientSrc.indexOf('if (ctxMenuRef.current || cheatsheetOpenRef.current) return   // 右键菜单/速查表打开时暂停列表导航/打开') >= 0, '列表导航暂停守卫')
    // ⑤ 装配与入口：index.js 挂载 + 设置卡行 + 帮助气泡指引
    assert(clientSrc.indexOf('e(CheatsheetModal)') >= 0, 'panel/index.js 挂载 CheatsheetModal')
    assert(clientSrc.indexOf("{ key: 'cheatsheet', label: '键盘快捷键'") >= 0 && clientSrc.indexOf('onClick: openCheatsheet') >= 0, '设置卡「键盘快捷键」行入口')
    assert(clientSrc.indexOf('唤起快捷键速查表') >= 0, '帮助气泡 ? 指引')
    // ⑥ 样式（styles.css + 发布包）
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const pkgCss = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', css], ['发布包 lib/styles.css', pkgCss]]) {
      for (const cls of ['.dsh-notes-cheatsheet-modal{', '.dsh-notes-cheatsheet-list{', '.dsh-notes-cs-row{', '.dsh-notes-cs-keys{', '.dsh-notes-cs-desc{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺速查表样式 ' + cls + '（需先跑 scripts/build-dist.cjs）')
      }
    }
    // ⑦ 发布包 client 同步
    for (const k of ['store.modal.cheatsheet', 'openCheatsheet', 'CheatsheetModal', "if (ev.key === '?') {", '键盘快捷键']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺「' + k + '」（需先跑 scripts/build-dist.cjs）')
    }
  })

  // ===== 51.2 键位逐键核对（速查表内容 ⇄ keyboard.js 实现双向口径）=====
  await t('速查表键位与 R-4 实现逐键核对（client）：9 行全生效键位 + Ctrl+N→Alt+N 标注 + 无虚构键位', () => {
    // ① 表内九行（与 keyboard.js 分支一一对应）
    const rows = [['Ctrl+K', '聚焦搜索框'], ['Alt+N', '新建笔记'], ['Ctrl+/', '编辑器 源码 ⇄ 富文本'], ['j / ↓', '列表焦点下移一行'], ['k / ↑', '列表焦点上移一行'], ['Enter', '打开焦点笔记'], ['↓', '搜索框内：直达列表首行'], ['?', '唤起 / 关闭本速查表'], ['Esc', '分层关闭']]
    for (const r of rows) {
      assert(clientSrc.indexOf("['" + r[0] + "', '" + r[1]) >= 0, '速查表缺行：' + r[0] + '（' + r[1] + '…）')
    }
    // ② 每行键位在实现里真实存在（逐键核对锚点，防文档与实现漂移）
    assert(/mod && \(ev\.key === 'k' \|\| ev\.key === 'K'\)\) \{ ev\.preventDefault\(\); if \(searchInputRef\.current\) searchInputRef\.current\.focus\(\); return \}/.test(clientSrc), '实现锚点：Ctrl+K 聚焦搜索')
    assert(/ev\.altKey && !mod && \(ev\.key === 'n' \|\| ev\.key === 'N'\)\) \{ ev\.preventDefault\(\); openNewNoteRef\.current\(\); return \}/.test(clientSrc), '实现锚点：Alt+N 新建')
    assert(/mod && ev\.key === '\/'/.test(clientSrc) && clientSrc.indexOf("switchModeRef.current(editorModeRef.current === 'source' ? 'rich' : 'source')") >= 0, '实现锚点：Ctrl+/ 双模式切换')
    assert(/ev\.key === 'j' \|\| ev\.key === 'ArrowDown'/.test(clientSrc) && /ev\.key === 'k' \|\| ev\.key === 'ArrowUp'/.test(clientSrc), '实现锚点：j/k/↑↓ 移动')
    assert(/ev\.key === 'Enter'/.test(clientSrc) && clientSrc.indexOf('selectNoteRef.current(n)') >= 0, '实现锚点：Enter 打开焦点行')
    assert(clientSrc.indexOf("t === searchInputRef.current && ev.key === 'ArrowDown'") >= 0, '实现锚点：搜索框 ↓ 桥接列表')
    assert(/ev\.key === 'Escape'/.test(clientSrc), '实现锚点：Esc 分层栈')
    // ③ Ctrl+N 已改 Alt+N 的标注收口（且实现里无 Ctrl+N 活绑定——1.6 节已锁移除，此处锁表内标注）
    assert(clientSrc.indexOf('Ctrl+N 是浏览器保留键「新建窗口」，页面拿不到，故改用 Alt+N') >= 0, '速查表含 Ctrl+N→Alt+N 改键标注')
    const csTable = clientSrc.match(/const CHEATSHEET_ROWS = \[([\s\S]*?)\n    \]/)
    assert(csTable, 'CHEATSHEET_ROWS 表存在')
    assert.strictEqual((csTable[1].match(/\n\s+\['/g) || []).length, 9, '速查表恰 9 行（实得 ' + ((csTable[1].match(/\n\s+\['/g) || []).length) + '）——增改键位须与实现同步')
    assert(csTable[1].indexOf("['Ctrl+N'") < 0, '速查表不得把 Ctrl+N 列为生效键位（浏览器保留键）')
  })

  // ===== 51.3 app.html + 原型同款（DOM 实现双端一致）=====
  await t('键盘流速查表（app.html + 原型）：openCheatsheet + ? 分支 + 设置行入口 + hintbar 指引（双端 UI 标记一致）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      // ① modal 实现：复用 openModal 框架 + cheatsheetRoot 标记（? toggle 判定）+ ✕ 接 closeModalFlushed
      assert(s.indexOf('function openCheatsheet()') >= 0 && s.indexOf('var CHEATSHEET_ROWS = [') >= 0, label + ' openCheatsheet/CHEATSHEET_ROWS')
      assert(s.indexOf('id="cheatsheetRoot"') >= 0 && s.indexOf("$('csClose').onclick = closeModalFlushed;") >= 0, label + ' cheatsheetRoot 标记 + ✕ 接线')
      assert(s.indexOf('键盘快捷键') >= 0 && s.indexOf('非输入焦点时生效') >= 0, label + ' 速查表标题/提示文案')
      // ② ? 键分支：toggle + 其他弹层不抢键
      assert(s.indexOf("if (ev.key === '?') {") >= 0 && s.indexOf("if ($('cheatsheetRoot')) { closeModalFlushed(); return }") >= 0, label + ' ? 唤起/toggle 分支')
      assert(s.indexOf('openCheatsheet(); return') >= 0, label + ' ? 调 openCheatsheet')
      // ③ 设置卡「键盘快捷键」行入口 + 接线
      assert(s.indexOf('id="setCheatsheet"') >= 0 && s.indexOf("$('setCheatsheet').onclick = function () { openCheatsheet() };") >= 0, label + ' 设置行入口 + 接线')
      // ④ i-kbd 图标 + 底部提示栏 ? 指引
      assert(s.indexOf('id="i-kbd"') >= 0, label + ' i-kbd 键盘图标 symbol')
      assert(s.indexOf('Esc 关闭浮层 · ? 快捷键') >= 0, label + ' hintbar ? 快捷键指引')
      // ⑤ 样式
      for (const cls of ['.cs-list{', '.cs-row{', '.cs-keys{', '.cs-desc{']) assert(s.indexOf(cls) >= 0, label + ' 缺速查表样式 ' + cls)
      // ⑥ 键位行（与 client 同一核对口径：九行 + Ctrl+N 标注；Esc 末段为页面口径——无关面板层）
      for (const k of ["['Ctrl+K', '聚焦搜索框']", "['Alt+N', '新建笔记（Ctrl+N 是浏览器保留键「新建窗口」，页面拿不到，故改用 Alt+N）']", "['Enter', '打开焦点笔记']", "['?', '唤起 / 关闭本速查表']", "['Esc', '分层关闭：弹层 → 排序/筛选/范围浮层 → 选区卡/右键菜单 → 退出多选 → 清搜索并还焦列表']"]) {
        assert(s.indexOf(k) >= 0, label + ' 速查表缺行：' + k)
      }
    }
    // ⑦ openCheatsheet 双端逐字节一致（同款 DOM 实现，同节 50 helper 口径）
    assert.strictEqual(grabFn(appSrc, 'openCheatsheet', 'app.html'), grabFn(protoV2Src, 'openCheatsheet', '原型'), 'app.html ⇄ 原型 openCheatsheet 逐字节一致')
  })

  // ===== 51.4 行为级：原型 openCheatsheet 可 eval（渲染冒烟）=====
  await t('速查表行为冒烟：openCheatsheet 渲染九行键帽行（原型函数体提取 eval + DOM mock）', () => {
    // openCheatsheet 体提取 eval：mock openModal/icon/esc/$ 捕获渲染产物与 ✕ 接线
    const fnSrc = grabFn(protoV2Src, 'openCheatsheet', '原型')
    const rowsDecl = protoV2Src.match(/var CHEATSHEET_ROWS = \[[\s\S]*?\n\];/)
    assert(rowsDecl, '原型 CHEATSHEET_ROWS 声明存在')
    const cap = { html: '', closeWired: false }
    const mockOpenModal = (h) => { cap.html = h }
    const mockIcon = () => '<svg/>'
    const mockEsc = (x) => String(x)
    const mock$ = (id) => { if (id === 'csClose') return { set onclick(f) { cap.closeWired = true } }; return null }
    const rows = new Function('return (' + rowsDecl[0].replace(/^var CHEATSHEET_ROWS = /, '').replace(/;\s*$/, '') + ')')()
    new Function('openModal', 'icon', 'esc', '$', 'CHEATSHEET_ROWS', 'closeModalFlushed', fnSrc + '\nopenCheatsheet()')(mockOpenModal, mockIcon, mockEsc, mock$, rows, () => {})
    assert(cap.html.indexOf('id="cheatsheetRoot"') >= 0 && cap.html.indexOf('键盘快捷键') >= 0, 'openCheatsheet 经 openModal 渲染速查表')
    assert.strictEqual((cap.html.match(/class="cs-row"/g) || []).length, 9, '渲染恰 9 行键帽行（实得 ' + ((cap.html.match(/class="cs-row"/g) || []).length) + '）')
    assert(cap.html.indexOf('Ctrl+K') >= 0 && cap.html.indexOf('Alt+N') >= 0 && cap.html.indexOf('Esc') >= 0, '键帽文案齐全')
    assert(cap.closeWired === true, '✕ 关闭接线存在')
  })
  }
}
