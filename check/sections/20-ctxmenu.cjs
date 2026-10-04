// 节 20. 列表项右键菜单（ctxmenu）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "20",
  title: "20. 列表项右键菜单（ctxmenu）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { clientPkgSrc } = S
  // ===== 20. 列表项右键菜单（替代悬浮 ×：onContextMenu + ctxmenu 结构 + 三动作 + 旧按钮移除）=====
  section('20. 列表项右键菜单（ctxmenu）')
  await t('列表项 onContextMenu 处理器存在', () => {
    assert(/onContextMenu:\s*\(ev\)\s*=>\s*openCtxMenu\(ev,\s*n\)/.test(clientSrc), 'client-impl 列表项含 onContextMenu → openCtxMenu')
    assert(/onContextMenu:\s*\(ev\)\s*=>\s*openCtxMenu\(ev,\s*n\)/.test(clientPkgSrc), '发布包列表项含 onContextMenu')
    assert(/function openCtxMenu\(ev, n\)/.test(clientSrc), 'openCtxMenu 函数存在')
    assert(/ctxMenuRef/.test(clientSrc), 'ctxMenuRef 键盘流兼容镜像存在')
  })
  await t('ctxmenu 结构与样式存在', () => {
    assert(clientSrc.indexOf('dsh-notes-ctxmenu') >= 0, 'client-impl 含 ctxmenu 容器 class')
    assert(clientPkgSrc.indexOf('dsh-notes-ctxmenu') >= 0, '发布包含 ctxmenu 容器 class')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-ctxmenu{') >= 0, 'styles.css 含 ctxmenu 容器样式')
    assert(css.indexOf('.dsh-notes-ctxmenu-item') >= 0, 'styles.css 含菜单项样式')
  })
  await t('菜单含置顶/已解决/删除三动作（v2 纯文字 + SVG 图标）', () => {
    assert(clientSrc.indexOf("ctxMenu.note.status === 'pinned' ? '取消置顶' : '置顶'") >= 0, '置顶/取消置顶动作存在')
    assert(clientSrc.indexOf("ctxMenu.note.status === 'resolved' ? '重开' : '标记已解决'") >= 0, '标记已解决/重开动作存在')
    assert(clientSrc.indexOf("I('trash', 12), '删除'") >= 0, '删除动作存在（trash 图标）')
    assert(/function ctxSetStatus\(n, status\)/.test(clientSrc), 'ctxSetStatus 函数存在')
    assert(/ctxSetStatus[\s\S]{0,300}host\.call\('notes-update'/.test(clientSrc), 'ctxSetStatus 走 notes-update RPC')
  })
  await t('旧悬浮删除按钮已移除', () => {
    assert(clientSrc.indexOf('dsh-note-delete') < 0, 'client-impl 不含 dsh-note-delete')
    assert(clientPkgSrc.indexOf('dsh-note-delete') < 0, '发布包不含 dsh-note-delete')
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(!/\.dsh-note-delete\{/.test(css), 'styles.css 不含 dsh-note-delete 样式块')
  })
  }
}
