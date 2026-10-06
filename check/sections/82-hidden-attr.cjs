// 节 82. hidden 隐藏属性（0.4.4-D，notes-044-hidden-attr，用户裁决 2026-10-06：OS 文件管理完整对齐——显隐开关+纯遮罩+跳转常显）
// 定稿架构：hidden 是纯 UI 遮罩（零 host 语义改动）——
//   ①存储：note front-matter hidden 条件行（仅 true 落盘，存量零迁移）+ folders.json 条目 hidden 字段（op:'set-flags' 写入）；
//   ②遮罩=纯客户端过滤：显隐开关关时 hidden 项从树/置顶组/未入夹/主题区滤除（folder 级 hidden 子树链同滤，OS 语义），
//     开时带 hid 遮罩样式（半透明+虚线）渲染；host _list/_search/notes-get/note_manage 零改动（agent 面与读写面天然完整）；
//   ③显隐开关：筛选中心「显示隐藏」开关（client+app），localStorage 独立键持久（dsh-notes-show-hidden / dsh-notes-app-show-hidden），
//     与筛选条件正交（不计 filterCount/清空筛选不重置）；
//   ④跳转常显：open-by-id（反向链接/派发执行记录/搜索命中打开）不经列表过滤管线，天然满足；
//   ⑤编辑入口：meta 区 hidden chip（👁，点击切换）；文件夹 hidden 进右键菜单（隐藏此文件夹/取消隐藏）；
//   ⑥与 C 卡（节 80 sysKids）正交：滤除时机在 sysKids 合并同层叠加谓词，零互扰。
module.exports = {
  id: "82",
  title: "82. hidden 隐藏属性（0.4.4-D：字段+显隐开关+纯 UI 遮罩+跳转常显，OS 文件管理对齐，双端）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc, indexSrc } = H
  const { NOTES_DIR, admMock, agentsMock, appSrc, clientPkgSrc, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('82. hidden 隐藏属性（0.4.4-D：字段 + 显隐开关 + 纯 UI 遮罩 + 跳转常显，双端）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const zh = read(path.join('src', 'i18n', 'zh.js')), en = read(path.join('src', 'i18n', 'en.js'))
  const styles = read(path.join('src', 'styles.css'))
  const pkgStyles = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'styles.css'))
  const appHead = read(path.join('src', 'app', 'shell', 'head.html'))

  // ===== ① host 存储层结构锚：front-matter 条件行 + 解析缺省 false + 落盘 + slim 透出（双包 + 产物）=====
  await t('host 存储层：buildFM hidden 条件行（仅 true 落盘）+ noteFromParsed 缺省 false + noteFileContent/slim 透出（双包+产物同源）', () => {
    for (const [src, label] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf("(m.hidden === true ? 'hidden: true\\n' : '')") >= 0, label + ' buildFM hidden 条件行（仅 true 落盘，存量零迁移）')
      assert(src.indexOf("hidden: p.meta.hidden === 'true'") >= 0, label + ' noteFromParsed 读 hidden（缺省 false）')
      assert(src.indexOf('sensitive: n.sensitive === true, hidden: n.hidden === true,') >= 0, label + ' noteFileContent 带 hidden')
      assert(src.indexOf('hidden: n.hidden === true,   // 0.4.4-D') >= 0, label + ' slim 透出 hidden（列表瘦身不丢字段）')
      assert(src.indexOf('hidden: ex.hidden === true,') >= 0, label + ' _create 透传 hidden')
      assert(src.indexOf('if (ex.hidden !== undefined) note.hidden = ex.hidden === true') >= 0, label + ' _update extra 透传 hidden（undefined 不动存量值）')
      assert(src.indexOf('sensitive: args.sensitive, hidden: args.hidden, logDate') >= 0, label + ' notes-create RPC 透传 hidden')
      assert(src.indexOf('schedule: args.schedule, hidden: args.hidden, confirmClearBody') >= 0, label + ' notes-update RPC 透传 hidden')
    }
    // note_manage 工具面：schema + 描述 + create/update 透传
    for (const [src, label] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf("hidden: { type: 'boolean', description: 'Hidden flag (create/update)") >= 0, label + ' note_manage schema 含 hidden 布尔参数')
      assert(src.indexOf('hidden (boolean, default false) is the OS-style hidden attribute (0.4.4-D)') >= 0, label + ' note_manage 描述含 hidden 语义段（纯 UI 遮罩/agent 面不受影响）')
      assert(src.indexOf('recall: args.recall, sensitive: args.sensitive, hidden: args.hidden, logDate') >= 0, label + ' note_manage.create 透传 hidden')
      assert(src.indexOf('schedule: args.schedule, hidden: args.hidden })') >= 0, label + ' note_manage.update 透传 hidden')
    }
    // folders：hidden 字段读/list 返回/set-flags 写入通道（双变体同源）
    for (const f of ['folders.js', 'folders.dist.js']) {
      const fs2 = read(path.join('src', 'host', f))
      assert(fs2.indexOf('if (f.hidden === true) o.hidden = true;') >= 0, f + ' loadFolders 读 hidden 字段')
      assert(fs2.indexOf("count: count, hidden: f.hidden === true") >= 0, f + ' _folders list 返回带 hidden（0.4.4-G 起同行扩 sys 键，hidden 前缀口径不变）')
      assert(fs2.indexOf("if (op === 'set-flags')") >= 0 && fs2.indexOf("notes-folders.set-flags 需要 id") >= 0, f + ' set-flags op 在位')
      assert(fs2.indexOf('list/create/rename/set-flags/delete/reorder') >= 0, f + ' 未知 op 提示含 set-flags')
    }
  })

  // ===== ② 行为级（独立实例）：note hidden 全链路往返 + folders set-flags + host 面零过滤红线 =====
  const storeS = new Map()
  const fsMockS = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeS.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeS.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeS.has(p)) throw new Error('ENOENT: ' + p); return storeS.get(p) },
    writeText: async (p, c) => { storeS.set(p, c) },
  }
  const handlersS = {}
  const toolsS = []
  const harnessMockS = {
    handle: (name, fn) => { handlersS[name] = fn; return () => { delete handlersS[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { toolsS.push(def); return () => {} },
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockS, DIR).apply({
    fs: fsMockS, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const nmS = toolsS.find(x => x.name === 'note_manage')

  await t('note hidden 往返：create hidden:true → get/list slim/磁盘 front-matter 一致；缺省 false 零迁移（不落行）', async () => {
    const c = await nmS.execute({ action: 'create', title: 'hidden 笔记甲', body: 'secret 正文', topic: '遮罩', hidden: true })
    assert(!c.error, 'manage.create hidden 成功（实得：' + JSON.stringify(c) + '）')
    const g = await handlersS['notes-get']({ id: c.id })
    assert.strictEqual(g.note.hidden, true, 'notes-get 返回 hidden=true（读写面完整：正文照常返回）')
    assert.strictEqual(g.note.body, 'secret 正文', 'hidden 笔记正文完整可读（遮罩仅限 UI）')
    const lst = await handlersS['notes-list']({})
    assert.strictEqual(lst.notes.find(n => n.id === c.id).hidden, true, 'notes-list（slim）携带 hidden（host 列表零滤除——遮罩在客户端）')
    const onDisk = storeS.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\nhidden: true\n') >= 0, 'front-matter 落 hidden: true')
    // 缺省 false：不传 hidden → 解析 false + 磁盘不落行（存量零迁移）
    const c2 = await nmS.execute({ action: 'create', title: '普通笔记乙', body: 'x', topic: '杂' })
    assert.strictEqual((await handlersS['notes-get']({ id: c2.id })).note.hidden, false, '缺省 hidden=false')
    assert(storeS.get(NOTES_DIR + '\\' + c2.id + '.md').indexOf('\nhidden:') < 0, '缺省不落 hidden 行（存量零迁移/往返幂等）')
  })
  await t('note hidden 切换：manage.update 显式翻 true/false + 不传不动存量值；磁盘行随写随摘', async () => {
    const c = await nmS.execute({ action: 'create', title: 'hidden 切换丙', body: 'x', topic: '遮罩' })
    await nmS.execute({ action: 'update', id: c.id, hidden: true })
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.hidden, true, 'update hidden=true 生效')
    assert(storeS.get(NOTES_DIR + '\\' + c.id + '.md').indexOf('\nhidden: true\n') >= 0, '翻 true 后磁盘落行')
    await nmS.execute({ action: 'update', id: c.id, topic: '遮罩-改' })
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.hidden, true, 'update 不传 hidden 保持原值（undefined 不动）')
    await nmS.execute({ action: 'update', id: c.id, hidden: false })
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.hidden, false, 'update hidden=false 回落')
    assert(storeS.get(NOTES_DIR + '\\' + c.id + '.md').indexOf('\nhidden:') < 0, '翻 false 后磁盘摘行（回缺省）')
  })
  await t('存量兼容：front-matter 带 hidden: true 的旧文件解析生效；host 搜索对 hidden 零滤除（agent 面完整）', async () => {
    await fsMockS.writeText(NOTES_DIR + '\\n-legacy-hidden.md', '---\nid: n-legacy-hidden\ntitle: 存量隐藏笔记\ntopic: 遮罩\nhidden: true\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\n隐藏正文 legacy-hidden-key\n')
    const g = await handlersS['notes-get']({ id: 'n-legacy-hidden' })
    assert.strictEqual(g.note.hidden, true, '存量文件 hidden: true 解析生效')
    // host 搜索面零滤除红线：hidden 笔记照常命中（遮罩纯客户端）
    const sr = await handlersS['notes-search']({ query: 'legacy-hidden-key' })
    assert(sr.notes && sr.notes.some(n => n.id === 'n-legacy-hidden'), 'notes-search 命中 hidden 笔记（host 零过滤红线）')
    const ls = await handlersS['notes-list']({})
    assert(ls.notes.some(n => n.id === 'n-legacy-hidden'), 'notes-list 含 hidden 笔记（host 零过滤红线）')
  })
  await t('folders set-flags：hidden 翻 true/false 落 folders.json + list 返回带 hidden；非法 id 报错', async () => {
    const cf = await handlersS['notes-folders']({ op: 'create', name: 'hidden 夹丁' })
    const fid = cf.folder && cf.folder.id
    assert(fid, '建夹成功')
    const l0 = await handlersS['notes-folders']({})
    assert.strictEqual(l0.folders.find(f => f.id === fid).hidden, false, '缺省 hidden=false（存量零迁移）')
    const s1 = await handlersS['notes-folders']({ op: 'set-flags', id: fid, hidden: true })
    assert(s1 && s1.ok === true && s1.hidden === true, 'set-flags hidden=true 回执')
    const l1 = await handlersS['notes-folders']({})
    assert.strictEqual(l1.folders.find(f => f.id === fid).hidden, true, 'list 返回 hidden=true')
    assert(storeS.get(NOTES_DIR + '\\folders.json').indexOf('"hidden": true') >= 0, 'folders.json 落 hidden:true')
    const s2 = await handlersS['notes-folders']({ op: 'set-flags', id: fid, hidden: false })
    assert(s2 && s2.ok === true && s2.hidden === false, 'set-flags hidden=false 回执')
    assert(storeS.get(NOTES_DIR + '\\folders.json').indexOf('"hidden"') < 0, '翻 false 摘字段回缺省')
    const sBad = await handlersS['notes-folders']({ op: 'set-flags', id: 'f-ghost', hidden: true })
    assert(sBad && sBad.error, '幽灵 id 显式报错（不落库）')
  })
  await t('host 语义零改动红线：_list/_search 无 hidden 谓词 + sys 降噪谓词原样 + showHidden 为纯前端词', () => {
    const hostNotes = read(path.join('src', 'host', 'notes.js'))
    const mList = hostNotes.match(/async function _list\(tag, kind, folder, includeDeleted, includeLogs, includeSys\) \{([\s\S]*?)\n    \}/)
    assert(mList && mList[0].indexOf('hidden') < 0, 'host _list 零 hidden 谓词（纯 UI 遮罩红线）')
    const mSearch = read(path.join('src', 'host', 'search.js'))
    assert(mSearch.indexOf('hidden') < 0, 'host search.js 零 hidden 谓词')
    assert(hostNotes.indexOf("if (includeSys !== true && !kind && !tag && (folder === undefined || folder === '') && note.kind === 'sys') continue") >= 0, 'sys 缺省降噪谓词零触碰（与 hidden 正交）')
    assert(hostSrc.indexOf('showHidden') < 0 && indexSrc.indexOf('showHidden') < 0, 'host 双产物不含 showHidden（显隐开关纯客户端概念）')
  })

  // ===== ③ client 端接线锚：显隐开关 + 过滤管线 + 树遮罩 + meta chip + 文件夹菜单 + 发布包同步 =====
  await t('client 接线：showHidden 态 + 独立 localStorage 键 + 过滤管线滤除（含 hidden 夹子树）+ 筛选中心开关', () => {
    assert(clientSrc.indexOf('const [showHidden, setShowHidden] = React.useState(loadShowHidden)') >= 0, 'showHidden state（loadShowHidden 初值）')
    assert(clientSrc.indexOf("localStorage.getItem('dsh-notes-show-hidden')") >= 0 && clientSrc.indexOf("localStorage.setItem('dsh-notes-show-hidden'") >= 0, '显隐开关独立 localStorage 键（dsh-notes-show-hidden）')
    assert(clientSrc.indexOf('if (!showHidden) {') >= 0 && clientSrc.indexOf("filtered = filtered.filter(n => n.hidden !== true && !hiddenSubtree[(n.folder || '')])") >= 0, '求值管线 hidden 滤除（note 级 + folder 子树链，OS 语义）')
    assert(clientSrc.indexOf('usePanelFilterPop({ filters: filters, sortBy: sortBy, showHidden: showHidden })') >= 0, 'showHidden 注入筛选中心 popover')
    assert(clientSrc.indexOf("t('filter.showHidden')") >= 0 && clientSrc.indexOf('setShowHidden(ev.target.checked); saveShowHidden(ev.target.checked)') >= 0, '筛选中心「显示隐藏」开关（勾选即写 + 持久）')
    assert(clientSrc.indexOf('function setShowHidden(v) { return panelBridge.setShowHidden(v) }') >= 0 && clientSrc.indexOf('panelBridge.setShowHidden = setShowHidden') >= 0, 'setShowHidden 跨域转发别名 + 桥回填')
    assert(clientSrc.indexOf('sysKids: sysKids, showHidden: showHidden') >= 0, 'showHidden 注入 usePanelTree')
  })
  await t('client 树遮罩：hidden 文件夹整节点滤除 + sysKids 合并同层谓词 + hid 遮罩 class（笔记行/文件夹行）', () => {
    assert(clientSrc.indexOf('if (!showHidden && f.hidden === true) return') >= 0, 'renderFolderNode hidden 文件夹早退（行+nested 容器消失，OS 语义）')
    assert(clientSrc.indexOf(".filter(n => !kidsBase.some(x => x.id === n.id) && (showHidden || n.hidden !== true))") >= 0, 'sysKids 合并叠加 hidden 谓词（与 C 卡同层零互扰：开关关时 hidden 档案行不显）')
    assert(clientSrc.indexOf("(n.hidden === true ? ' hid' : '')") >= 0 && clientSrc.indexOf("(f.hidden === true ? ' hid' : '')") >= 0, 'hid 遮罩 class（笔记行 + 文件夹行）')
    assert(styles.indexOf('.dsh-notes-note-row.hid{') >= 0 && styles.indexOf('.dsh-notes-folder-row.hid{') >= 0, 'styles.css hid 遮罩样式')
    assert(pkgStyles.indexOf('.dsh-notes-note-row.hid{') >= 0 && pkgStyles.indexOf('.dsh-notes-folder-row.hid{') >= 0, '发布包 lib/styles.css 同步（需先跑 build-dist）')
    assert(clientPkgSrc.indexOf('dsh-notes-show-hidden') >= 0 && clientPkgSrc.indexOf("filtered = filtered.filter(n => n.hidden !== true && !hiddenSubtree[(n.folder || '')])") >= 0, '发布包 lib/client.js 同步（需先跑 build-dist）')
  })
  await t('client meta chip 链路：edHidden state/ref + selectNote 回填 + toggleHidden + doSave 携带 + eye chip', () => {
    assert(clientSrc.indexOf('const [edHidden, setEdHidden] = React.useState(false)') >= 0, 'edHidden 状态')
    assert(clientSrc.indexOf('const edHiddenRef = React.useRef(false)') >= 0 && clientSrc.indexOf('edHiddenRef.current = edHidden') >= 0, 'edHiddenRef 镜像（自动保存读最新值）')
    assert(clientSrc.indexOf('setEdHidden(n.hidden === true)') >= 0, 'selectNote 回填 hidden（open-by-id 跳转打开 hidden 笔记 chip 常显可切回）')
    assert(clientSrc.indexOf('function toggleHidden() { setEdHidden(!edHidden); triggerAutoSave() }') >= 0, 'toggleHidden')
    assert(clientSrc.indexOf('hidden: edHiddenRef.current === true') >= 0, 'doSave 携带 hidden')
    assert(clientSrc.indexOf("onClick: toggleHidden, 'data-tooltip': tt('meta.hiddenTip')") >= 0 && clientSrc.indexOf("tt('meta.hidden')") >= 0, 'meta 区 hidden chip（👁）')
  })
  await t('client 文件夹右键菜单：隐藏此文件夹/取消隐藏 → notes-folders set-flags', () => {
    assert(clientSrc.indexOf('function doSetFolderHidden(f, hidden)') >= 0 && clientSrc.indexOf("host.call('notes-folders', { op: 'set-flags', id: f.id, hidden: hidden === true })") >= 0, 'doSetFolderHidden 动作（set-flags 通道）')
    assert(clientSrc.indexOf("t('fld.menuUnhide')") >= 0 && clientSrc.indexOf("t('fld.menuHide')") >= 0, '菜单项「隐藏此文件夹」/「取消隐藏」')
    assert(clientSrc.indexOf("t('fld.hiddenToast'") >= 0 && clientSrc.indexOf("t('fld.unhiddenToast'") >= 0, '显隐 toast 文案')
  })

  // ===== ④ app 端同构锚（rpc 通道 + foldOpen 结构差异）=====
  await t('app 同构：showHidden 态 + 独立键 + matches 遮罩谓词 + folderHidden 链判定 + 筛选中心显示组', () => {
    assert(appSrc.indexOf('var showHidden = loadShowHidden();') >= 0, 'app showHidden 态')
    assert(appSrc.indexOf("localStorage.getItem('dsh-notes-app-show-hidden')") >= 0 && appSrc.indexOf("localStorage.setItem('dsh-notes-app-show-hidden'") >= 0, 'app 独立 localStorage 键（dsh-notes-app-show-hidden）')
    assert(appSrc.indexOf('if (!showHidden && (n.hidden === true || (n.folder && folderHidden(n.folder)))) return false;') >= 0, 'matches() hidden 遮罩谓词（note 级 + folder 链，OS 语义）')
    assert(appSrc.indexOf('function folderHidden(fid)') >= 0, 'folderHidden parent 链上溯判定（cycle 防御）')
    assert(appSrc.indexOf('data-fh="1"') >= 0 && appSrc.indexOf("t('filter.showHidden')") >= 0, '筛选中心显示组「显示隐藏」开关')
    assert(appSrc.indexOf('else if (cb.dataset.fh) { showHidden = cb.checked; saveShowHidden(); render(); return }') >= 0, '开关 change 接线（独立持久 + 纯重渲染，不动取数口径/搜索）')
    assert(appSrc.indexOf('filtersActiveCount()') >= 0, 'filtersActiveCount 在位（hidden 开关不计入筛选条件数——正交）')
  })
  await t('app 树遮罩 + meta chip + doSave + 文件夹菜单（foldOpen/结构差异同构）', () => {
    assert(appSrc.indexOf("if (!showHidden && f.hidden === true) return '';") >= 0, 'app folderNodeHtml hidden 文件夹早退')
    assert(appSrc.indexOf('&& (showHidden || n.hidden !== true) }));') >= 0, 'app sysKids 合并叠加 hidden 谓词')
    assert(appSrc.indexOf('(n.hidden === true ? \' hid\' : \'\')') >= 0 && appSrc.indexOf('\'<div class="row head\' + (f.hidden === true ? \' hid\' : \'\')') >= 0, 'app hid 遮罩 class（笔记行 + 文件夹行）')
    assert(appHead.indexOf('.note-row.hid{') >= 0 && appHead.indexOf('.row.head.hid{') >= 0, 'app head.html hid 遮罩样式')
    assert(appSrc.indexOf('id="mHidden"') >= 0 && appSrc.indexOf("$('mHidden').onclick") >= 0 && appSrc.indexOf('edNote.hidden = edNote.hidden !== true') >= 0, 'app meta 区 hidden chip + 切换 handler')
    assert(appSrc.indexOf('sensitive: edNote.sensitive === true, hidden: edNote.hidden === true') >= 0, 'app doSave 携带 hidden')
    assert(appSrc.indexOf('function doSetFolderHidden(f, hidden)') >= 0 && appSrc.indexOf("rpc('notes-folders', { op: 'set-flags', id: f.id, hidden: hidden === true })") >= 0, 'app doSetFolderHidden（rpc 通道）')
    assert(appSrc.indexOf('data-a="hide"') >= 0 && appSrc.indexOf("else if (a === 'hide') doSetFolderHidden(f, !(f.hidden === true));") >= 0, 'app 文件夹右键「隐藏此文件夹」菜单项接线')
  })

  // ===== ⑤ 行为级 eval：app folderNodeHtml hidden 滤除/渲染语义 + sysKids hidden 叠加 =====
  await t('行为级 eval：folderNodeHtml——开关关 hidden 夹整节点消失 + 开时 hid class 渲染 + sysKids hidden 行同层滤除', () => {
    const appTree = read(path.join('src', 'app', 'panels', 'tree.js'))
    const m = appTree.match(/function folderNodeHtml\(f, vis, filtering\) \{([\s\S]*?)\n\}/)
    assert(m, '提取 app folderNodeHtml 失败（结构变更需同步本断言）')
    function mkWorld(over) {
      const target = Object.assign({
        foldOpen: {},
        showHidden: false,
        sysKids: { fHid: { stamp: null, rows: [{ id: 's1', kind: 'sys', folder: 'fHid', hidden: true, title: '隐藏档案' }, { id: 's2', kind: 'sys', folder: 'fHid', title: '普通档案' }] } },
        folders: [{ id: 'fHid', name: '隐藏夹', parent: '', count: 2, hidden: true }, { id: 'fNorm', name: '普通夹', parent: '', count: 1 }],
        t: function (k) { return k },
        icon: function () { return '' },
        esc: function (s) { return String(s) },
        noteRow: function (n) { return '<div class="note-row' + (n.hidden === true ? ' hid' : '') + '" data-note="' + n.id + '"></div>' },
        folderKids: function (pid) { return target.folders.filter(function (x) { return (x.parent || '') === pid }) },
        folderSubtree: function (id) { var o = {}; o[id] = true; return o },
      }, over || {})
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      new Function('scope', 'with (scope) {\n__fn = function (f, vis, filtering) {' + m[1] + '\n}\n}')(proxy)
      return target.__fn
    }
    const fHid = { id: 'fHid', name: '隐藏夹', parent: '', count: 2, hidden: true }
    const fNorm = { id: 'fNorm', name: '普通夹', parent: '', count: 1 }
    const vis = [{ id: 'n1', kind: 'note', folder: 'fNorm' }]
    // 开关关：hidden 文件夹整节点消失（行+nested 容器）；普通夹不受影响
    assert(mkWorld()(fHid, vis, false) === '', '开关关：hidden 文件夹行+nested 容器整体滤除（OS 语义）')
    const hNorm = mkWorld()(fNorm, vis, false)
    assert(hNorm.indexOf('data-fold="fNorm"') >= 0 && hNorm.indexOf('data-note="n1"') >= 0, '普通夹渲染不受影响')
    // 开关开：hidden 夹渲染且行带 hid 遮罩 class
    const hShow = mkWorld({ showHidden: true })(fHid, vis, false)
    assert(hShow.indexOf('data-fold="fHid"') >= 0 && hShow.indexOf('class="row head hid"') >= 0, '开关开：hidden 夹渲染 + hid 遮罩 class')
    // sysKids 同层谓词：hidden 档案行开关关时不混入，普通 sys 行照常；开时全混入
    const hKidsOff = mkWorld()(fHid, vis, false)
    assert(hKidsOff.indexOf('data-note=') < 0, '开关关：hidden 夹内 sysKids 行随节点滤除')
    const hKidsOn = mkWorld({ showHidden: true })(fHid, vis, false)
    assert(hKidsOn.indexOf('data-note="s1"') >= 0 && hKidsOn.indexOf('data-note="s2"') >= 0, '开关开：sysKids 行（含 hidden 档案）照常合并渲染')
    const worldNorm = mkWorld({ sysKids: { fNorm: { stamp: null, rows: [{ id: 's3', kind: 'sys', folder: 'fNorm', hidden: true, title: 'hidden 档案' }] } } })
    const hNormOff = worldNorm(fNorm, vis, false)
    assert(hNormOff.indexOf('data-note="s3"') < 0, '普通夹 sysKids 中 hidden 档案行开关关时同层滤除（C 卡合并零互扰）')
  })

  // ===== ⑥ i18n 双语在案 =====
  await t('i18n：hidden 相关键双语在案（filter.displayGroup/showHidden(+Tip) + meta.hidden(Tip/On/Off) + fld.menuHide/menuUnhide/hiddenToast/unhiddenToast/hideFailed）', () => {
    for (const k of ["'filter.displayGroup'", "'filter.showHidden'", "'filter.showHiddenTip'", "'meta.hiddenTip'", "'meta.hidden'", "'meta.hiddenOn'", "'meta.hiddenOff'", "'fld.menuHide'", "'fld.menuUnhide'", "'fld.hiddenToast'", "'fld.unhiddenToast'", "'fld.hideFailed'"]) {
      assert(zh.indexOf(k + ':') >= 0, 'zh 缺 ' + k)
      assert(en.indexOf(k + ':') >= 0, 'en 缺 ' + k)
    }
  })
  }
}
