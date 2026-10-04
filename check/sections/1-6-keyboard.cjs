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
  await t('Ctrl+N 打开新建笔记 modal', () => {
    assert(/ev\.key === 'n' \|\| ev\.key === 'N'/.test(clientSrc), 'Ctrl+N 分支')
    assert(/mod && \(ev\.key === 'n' \|\| ev\.key === 'N'\)\) \{ ev\.preventDefault\(\); openNewNoteRef\.current\(\); return \}/.test(clientSrc), 'Ctrl+N 调 openNewNoteRef（打开新建 modal，不再是速记框）')
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
  }
}
