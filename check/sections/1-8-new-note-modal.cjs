// 节 1.8 新建笔记 modal（＋ / Alt+N 输标题创建）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "1.8",
  title: "1.8 新建笔记 modal（＋ / Alt+N 输标题创建）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { plugin } = S
  // ===== 1.8 新建笔记 modal（＋ / Alt+N 输标题创建，替代顶栏速记）=====
  section('1.8 新建笔记 modal（＋ / Alt+N 输标题创建）')
  // 发布包 client 源码独立读取（本节在 section 18 之前，clientPkgSrc 尚未定义）
  const clientPkgSrcNewNote = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
  await t('＋ 按钮点击弹新建 modal（tooltip=新建笔记（Alt+N））', () => {
    assert(/onClick: openNewNote, 'data-tooltip': t\('side\.newTip'\)/.test(clientSrc), '＋ 按钮 onClick=openNewNote + tooltip「新建笔记（Alt+N）」（i18n 覆盖卡A 起走 t() 字典）')
    assert(/function openNewNote\(\) \{ setNewNoteTitle\(''\); setNewNoteKind\('note'\); setNewNotePending\(false\); setError\(''\); setNewNoteOpen\(true\) \}/.test(clientSrc), 'openNewNote 清空上次标题 + 类型复位 note 并打开 modal（二期：类型选择入 modal）')
    assert(/newNoteOpen \? e\('div', \{ className: 'dsh-notes-newnote-mask'/.test(clientSrc), 'mask 仅在 newNoteOpen 时渲染（＋ 点击后弹出）')
    assert(clientPkgSrcNewNote.indexOf('onClick: openNewNote') >= 0 && clientPkgSrcNewNote.indexOf('dsh-notes-newnote-mask') >= 0, '发布包 client.js 同步含 ＋→modal（需先跑 scripts/build-dist.cjs）')
  })
  await t('新建 modal 结构：居中卡片 + 标题输入 + 取消/创建', () => {
    assert(clientSrc.indexOf("'dsh-notes-newnote-modal'") >= 0 && clientSrc.indexOf("'dsh-notes-newnote-t'") >= 0, 'modal 容器 + 标题 class')
    assert(clientSrc.indexOf("tt('newnote.title')") >= 0 && clientSrc.indexOf("'newnote.title': '新建笔记'") >= 0, 'modal 标题「新建笔记」走 tt()（i18n 覆盖卡E，zh 原串字典内嵌）')
    assert(/ref: newNoteInputRef, className: 'dsh-notes-newnote-input', placeholder: tt\('newnote\.titlePlaceholder'\), value: newNoteTitle/.test(clientSrc), '标题输入框（placeholder 走 tt() newnote.titlePlaceholder，覆盖卡E）受控于 newNoteTitle')
    assert(/newNoteOpen && newNoteInputRef\.current\) newNoteInputRef\.current\.focus\(\)/.test(clientSrc), '打开 modal 自动聚焦标题输入框')
    assert(/onClick: \(\) => setNewNoteOpen\(false\) \}, tt\('common\.cancel'\)\)/.test(clientSrc), '取消按钮关闭 modal（i18n 覆盖卡E 起走 tt() common.cancel）')
    assert(/onClick: doCreateNote, disabled: newNotePending \|\| !newNoteTitle\.trim\(\)/.test(clientSrc), '创建按钮：标题为空/创建中 disabled')
  })
  await t('标题输入交互：Enter 提交 / Esc 关 modal / 点遮罩关闭', () => {
    assert(/onChange: \(ev\) => setNewNoteTitle\(ev\.target\.value\)/.test(clientSrc), '输入即更新 newNoteTitle')
    assert(/if \(ev\.key === 'Enter'\) \{ ev\.preventDefault\(\); doCreateNote\(\) \}/.test(clientSrc), '输入框 Enter 提交创建')
    assert(/if \(newNoteOpenRef\.current\) \{ setNewNoteOpen\(false\); return \}/.test(clientSrc), 'Esc 优先关新建 modal（在全局 keydown 中）')
    assert(/dsh-notes-newnote-mask', onMouseDown: \(ev\) => \{ if \(ev\.target === ev\.currentTarget\) setNewNoteOpen\(false\) \}/.test(clientSrc), '点遮罩关闭 modal')
    assert(/ev\.altKey && !mod && \(ev\.key === 'n' \|\| ev\.key === 'N'\)\) \{ ev\.preventDefault\(\); openNewNoteRef\.current\(\); return \}/.test(clientSrc), 'Alt+N 打开新建 modal')
  })
  await t('创建流程：notes-create 输标题建笔记 → 刷新 → 选中新笔记 → 聚焦正文', () => {
    assert(clientSrc.indexOf("const payload = { title: title, body: KIND_TEMPLATES[newNoteKind] || '', kind: newNoteKind }") >= 0, 'notes-create payload 传 title/kind=newNoteKind/body=类型模板骨架（二期 kind 骨架；note=空）')
    assert(/host\.call\('notes-create', payload\)/.test(clientSrc), 'notes-create 走 payload（v2 视图落位）')
    assert(clientSrc.indexOf("const createFolder = (selNote && selNote.folder) || ''") >= 0 && clientSrc.indexOf("payload.folder = createFolder") >= 0, '落选中笔记所在文件夹/未分类（0.4.3⑦：文件夹视图落位分支随「文件视图」拆除移除）')
    assert(clientSrc.indexOf("if (view.type === 'topic' && view.id && view.id !== '分类中') payload.tags = [view.id]") >= 0, '标签视图带当前标签（0.4.8 主题并入标签：新建种子落 tags；分类中占位不预填）')
    assert(/showToast\(t\('newnote\.created'\)\)/.test(clientSrc), '创建成功 toast 走 t() newnote.created（i18n 覆盖卡E）')
    const m = clientSrc.match(/async function doCreateNote\(\) \{[\s\S]*?\n        \}/)
    assert(m, 'doCreateNote 函数体可提取')
    const fnBody = m[0]
    assert(/loadNotes\(true\)/.test(fnBody), '创建后静默刷新列表（后台，不阻塞选中链路）')
    assert(/selectNote\(\{ id: res\.id/.test(fnBody), '创建后按返回 id 立即选中新笔记（不等列表刷新）')
    assert(/setEditorModeState\('source'\)/.test(fnBody), '富文本态先切回源码态（保证正文 textarea 存在）')
    assert(/edBodyDomRef\.current\.focus\(\)/.test(fnBody), '创建后聚焦正文 textarea（edBodyDomRef）')
    assert(/ref: edBodyDomRef, className: 'dsh-notes-ed-body'/.test(clientSrc), '正文 textarea 挂 edBodyDomRef（v2 ed-body）')
    assert(clientPkgSrcNewNote.indexOf("rpc('notes-create', payload)") >= 0, '发布包创建走 notes-create（rpc 形态）')
  })
  await t('顶栏速记已移除（capOpen/doCapture/capture 样式清零）', () => {
    for (const dead of ['capOpen', 'capText', 'capSaved', 'capPending', 'doCapture', 'dsh-notes-capture']) {
      assert(clientSrc.indexOf(dead) < 0, 'client-impl 不含 ' + dead)
      assert(clientPkgSrcNewNote.indexOf(dead) < 0, '发布包 client.js 不含 ' + dead)
    }
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    assert(css.indexOf('.dsh-notes-capture') < 0, 'styles.css 不含 capture 系列样式')
  })
  await t('新建 modal 样式走 token（dsh-notes-newnote-* 系列）', () => {
    const css = fsNative.readFileSync(SRC_STYLES, 'utf8')
    for (const cls of ['.dsh-notes-newnote-mask{', '.dsh-notes-newnote-modal{', '.dsh-notes-newnote-t{', '.dsh-notes-newnote-input', '.dsh-notes-newnote-actions{']) {
      assert(css.indexOf(cls) >= 0, 'styles.css 缺 ' + cls)
    }
    assert(css.indexOf('background:var(--nbg)') >= 0, 'modal 背景走 token var(--nbg)')
  })
  await t('使用说明与空态文案已改为新建标题（无速记输入框残留文案）', () => {
    assert(clientSrc.indexOf('展开输入框') < 0, '使用说明不再提「展开输入框」速记')
    assert(clientSrc.indexOf('在上方输入框直接记录') < 0, '编辑器空态不再提「上方输入框」')
    assert(clientSrc.indexOf('弹出新建窗口：输入标题、选类型') >= 0, '使用说明第一条改为弹窗输标题新建（0.4.6-D 双端对齐：面板=模态即建，括注全窗口草稿先行差异）')
  })
  }
}
