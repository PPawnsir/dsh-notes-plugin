// 节 1.6 T1.4 键盘快捷键
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "1.6",
  title: "1.6 T1.4 键盘快捷键",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  // ===== 1.6 T1.4 键盘快捷键（client 源码结构断言）=====
  section('1.6 T1.4 键盘快捷键')
  await t('client-impl 含 keydown 监听', () => assert(/addEventListener\('keydown'/.test(clientSrc), 'keydown 监听存在'))
  await t('Ctrl+K 聚焦搜索', () => assert(/ev\.key === 'k' \|\| ev\.key === 'K'/.test(clientSrc), 'Ctrl+K 分支'))
  await t('Alt+N 打开新建笔记 modal（Ctrl+N 为浏览器保留键，弃用）', () => {
    assert(/ev\.key === 'n' \|\| ev\.key === 'N'/.test(clientSrc), 'N 键分支')
    assert(/ev\.altKey && !mod && \(ev\.key === 'n' \|\| ev\.key === 'N'\)\) \{ ev\.preventDefault\(\); openNewNoteRef\.current\(\); return \}/.test(clientSrc), 'Alt+N 调 openNewNoteRef（打开新建 modal；AltGr 带 ctrlKey 天然排除）')
    assert(clientSrc.indexOf("if (mod && (ev.key === 'n'") < 0, 'Ctrl+N 分支已移除（浏览器保留键「新建窗口」，页面拿不到）')
  })
  await t('Escape 关闭', () => assert(/ev\.key === 'Escape'/.test(clientSrc), 'Esc 分支'))
  await t('j/k 或 方向键导航', () => assert(/ev\.key === 'j' \|\| ev\.key === 'ArrowDown'/.test(clientSrc) && /ev\.key === 'k' \|\| ev\.key === 'ArrowUp'/.test(clientSrc), 'j/k 与 ↑↓ 分支'))
  await t('Enter 打开聚焦项', () => assert(/ev\.key === 'Enter'/.test(clientSrc), 'Enter 分支'))
  await t('输入框内不响应导航键', () => assert(/tagName === 'INPUT' \|\| t\.tagName === 'TEXTAREA' \|\| t\.isContentEditable/.test(clientSrc), 'inField 判定'))
  await t('聚焦样式 .focused 存在', () => {
    const cssPath = SRC_STYLES
    assert(fsNative.readFileSync(cssPath, 'utf8').indexOf('.dsh-notes-note-row.focused') >= 0, 'styles.css 含 note-row focused')
  })
  await t('Ctrl+K 直接聚焦侧栏搜索框（v2 常显搜索，无展开态）', () => {
    assert(/mod && \(ev\.key === 'k' \|\| ev\.key === 'K'\)\) \{ ev\.preventDefault\(\); if \(searchInputRef\.current\) searchInputRef\.current\.focus\(\); return \}/.test(clientSrc), 'Ctrl+K → searchInputRef.focus()')
    assert(clientSrc.indexOf('searchOpen') < 0, 'v2 移除 searchOpen 展开态（搜索框侧栏常显）')
  })
  // ===== R-4 键盘流兑现：Esc 焦点分层 + 搜索↓桥接 + 全窗口页/原型同款导航 =====
  await t('Esc 焦点分层：清搜索后还焦列表（焦点不留滞输入框）', () => {
    assert(/function blurSearchToList\(\)/.test(clientSrc), 'blurSearchToList 助手存在')
    assert(/if \(searchRef\.current\) \{ searchRef\.current = ''; setSearchText\(''\); setSearchIds\(null\); setSearchMatches\(\{\}\); if \(searchInputRef\.current && document\.activeElement === searchInputRef\.current\) blurSearchToList\(\); return \}/.test(clientSrc), '清搜索分支附带还焦（搜索框聚焦时）')
    assert(/if \(searchInputRef\.current && document\.activeElement === searchInputRef.current\) \{ blurSearchToList\(\); return \}/.test(clientSrc), '空搜索框聚焦时 Esc 还焦列表（而不是直接关面板）')
    assert(/className: 'dsh-notes-tree', ref: treeElRef, tabIndex: -1/.test(clientSrc), '树容器挂 treeElRef + tabIndex=-1（可程序化聚焦）')
    assert(fsNative.readFileSync(SRC_STYLES, 'utf8').indexOf('.dsh-notes-tree:focus{outline:none}') >= 0, 'styles.css 含树容器焦点去描边')
  })
  await t('搜索框 ↓ 桥接列表（保留过滤上下文）', () => {
    assert(/function focusListFromSearch\(\)/.test(clientSrc), 'focusListFromSearch 助手存在')
    assert(/t === searchInputRef\.current && ev\.key === 'ArrowDown'\) \{ ev\.preventDefault\(\); focusListFromSearch\(\); return \}/.test(clientSrc), '搜索框 ArrowDown → 还焦列表 + 首行聚焦')
  })
  await t('全窗口页 app.html + 原型 notes-ui-v2.html 键盘流同款（j/k/Enter + Alt+N + Esc 还焦 + ↓桥接 + 可见焦点行）', () => {
    const appKb = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    const protoKb = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    for (const pair of [['app.html', appKb], ['原型 notes-ui-v2.html', protoKb]]) {
      const label = pair[0], s = pair[1]
      assert(s.indexOf('function listVisibleIds()') >= 0 && s.indexOf('function moveFocus(ids, delta)') >= 0, label + ' listVisibleIds/moveFocus 助手')
      assert(s.indexOf("ev.key === 'j' || ev.key === 'ArrowDown'") >= 0 && s.indexOf("ev.key === 'k' || ev.key === 'ArrowUp'") >= 0, label + ' j/k/↑↓ 分支')
      assert(s.indexOf("if (focusId && ids.indexOf(focusId) >= 0) selectNote(focusId)") >= 0, label + ' Enter 打开焦点行')
      assert(s.indexOf("ev.altKey && !ev.ctrlKey && !ev.metaKey && (ev.key === 'n' || ev.key === 'N')") >= 0 && s.indexOf('doNewNote()') >= 0, label + ' Alt+N 新建（无冲突组合）')
      assert(s.indexOf("document.activeElement === $('q')") >= 0 && s.indexOf('function blurSearchToList()') >= 0, label + ' Esc 末段：搜索框清词并还焦列表')
      assert(s.indexOf("kt === $('q') && ev.key === 'ArrowDown'") >= 0, label + ' 搜索框 ↓ 桥接列表')
      assert(s.indexOf("(focusId === n.id ? ' focused' : '')") >= 0 && s.indexOf('.note-row.focused{background:var(--nbg-hover)}') >= 0, label + ' 可见焦点行 .focused（行 class + 样式）')
      assert(s.indexOf('class="tree" id="tree" tabindex="-1"') >= 0 && s.indexOf('.tree:focus{outline:none}') >= 0, label + ' 树容器可聚焦 + 去描边')
      assert(s.indexOf('focusId = id;') >= 0, label + ' selectNote 同步焦点行')
      assert(s.indexOf('title="新建笔记（Alt+N）"') >= 0, label + ' 新建按钮 tooltip 改 Alt+N')
      assert(s.indexOf('Alt N 新建 · j/k 移动 · Enter 打开') >= 0, label + ' 底部提示栏键盘流文案')
    }
  })
  }
}
