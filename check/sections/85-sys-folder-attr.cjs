// 节 85. 自动沉淀文件夹 sys 机器属性（0.4.4-G，notes-044-sys-folders，用户裁决 2026-10-06：默认隐身保观感 + 显式入口不阻拦）
// 定稿架构（同构 D 卡 hidden 扩展 sys，OS 逻辑延续：默认可隐，想看不拦）——
//   ①存储：folders.json 条目 sys 三态字段（true 机器托管 / 显式 false 墓碑 / 缺席待迁移）；
//     loadFolders 一次性懒迁移（名称严格匹配 {工作日志,记忆档案,执行记录} + sys 缺席 → 置 true 落盘，幂等；改名夹不匹配不动）；
//     写入走 op:'set-flags' {id,sys}（与 hidden 同通道，两键独立——仅显式传入的键才触碰；sys:false 落显式墓碑挡迁移回标）；
//   ②自动标记三管线：ledger「记忆档案」ensure / schedule「执行记录」ensure / memory「工作日志」ensure 创建直入 sys:true
//     （命中复用路径不触碰 sys——用户摘除墓碑不回弹）+ ③存量懒迁移兜底；
//   ③树遮罩=纯客户端：sys 夹默认不渲染文件夹行（含 nested 子树容器，同 D 卡 hidden 早退同层；夹内普通笔记随夹隐身，OS 父子树语义）；
//     显式入口双通道并集：筛选中心「机器」档选中（与⑨⑩ 机器内容总览语义一致）或「显示隐藏」开关开（复用 D 卡开关）——任一开即见，徽标计数照常；
//   ④与既有机制正交：⑨ 内容级 kind=sys 谓词零改动；D hidden 语义零改动；host 计数/过滤/导出/读写面零改动（遮罩全在渲染层）。
module.exports = {
  id: "85",
  title: "85. 自动沉淀文件夹 sys 机器属性（0.4.4-G：folder 级 sys + 懒迁移墓碑 + 双通道树显隐 + 右键标记/摘除，双端）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc, indexSrc } = H
  const { NOTES_DIR, admMock, agentsMock, appSrc, clientPkgSrc, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('85. 自动沉淀文件夹 sys 机器属性（0.4.4-G：folder 级 sys + 懒迁移 + 双通道显隐，双端）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const zh = read(path.join('src', 'i18n', 'zh.js')), en = read(path.join('src', 'i18n', 'en.js'))
  const cliTree = read(path.join('src', 'client', 'panels', 'panel', 'tree.js'))
  const cliIndex = read(path.join('src', 'client', 'panels', 'panel', 'index.js'))
  const cliMenu = read(path.join('src', 'client', 'popovers', 'folder-menu.js'))
  const appTree = read(path.join('src', 'app', 'panels', 'tree.js'))
  const appQuery = read(path.join('src', 'app', 'panels', 'query.js'))
  const appHelpers = read(path.join('src', 'app', 'kernel', 'helpers.js'))
  const appState = read(path.join('src', 'app', 'kernel', 'state.js'))
  const appFolders = read(path.join('src', 'app', 'panels', 'folders.js'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))

  // ===== ① host 结构锚：folders 双变体 sys 三态/懒迁移/set-flags 扩展/create 直入 + 三 ensure 点 + ⑨⑩ 正交红线 =====
  await t('host 结构锚：folders 双变体 sys 三态解析 + list/reorder 返回 + create 直入 + set-flags 扩展（hidden 独立守卫）+ 懒迁移块', () => {
    for (const f of ['folders.js', 'folders.dist.js']) {
      const fs2 = read(path.join('src', 'host', f))
      assert(fs2.indexOf("const SYS_FOLDER_NAMES = { '工作日志': true, '记忆档案': true, '执行记录': true }") >= 0, f + ' SYS_FOLDER_NAMES 三夹名称严格匹配表')
      assert(fs2.indexOf('if (f.sys === true) o.sys = true; else if (f.sys === false) o.sys = false;') >= 0, f + ' loadFolders 读 sys 三态（显式 false 墓碑保留回写）')
      assert(fs2.indexOf('if (f.sys === undefined && SYS_FOLDER_NAMES[f.name] === true) { f.sys = true; migrated = true }') >= 0, f + ' 懒迁移判据（名称严格匹配 + sys 字段缺席）')
      assert(fs2.indexOf('if (migrated) await saveFolders(out)') >= 0, f + ' 迁移命中才落盘（无迁移零写盘）')
      assert(fs2.indexOf('count: count, hidden: f.hidden === true, sys: f.sys === true }') >= 0, f + ' _folders list 返回带 sys')
      assert(fs2.indexOf('hidden: f.hidden === true, sys: f.sys === true })) }') >= 0, f + ' reorder 返回带 sys')
      assert(fs2.indexOf('if (a.sys === true) folder.sys = true') >= 0, f + ' create 支持 sys 直入（自动沉淀管线下水点）')
      assert(fs2.indexOf('if (a.sys !== undefined) { if (a.sys === true) f.sys = true; else f.sys = false }') >= 0, f + ' set-flags sys 键扩展（false 落显式墓碑）')
      assert(fs2.indexOf('if (a.hidden !== undefined) { if (a.hidden === true) f.hidden = true; else delete f.hidden }') >= 0, f + ' hidden 键独立守卫（单写 sys 不误摘 hidden；D 卡语义零改动）')
      assert(fs2.indexOf('create(name,parent?,sys?)/rename/set-flags(id,hidden?,sys?)') >= 0, f + ' op 文档注释同步 sys 键')
    }
  })
  await t('host 三管线 ensure 点 sys:true 直入（ledger 记忆档案 / schedule 执行记录 / memory 工作日志 双变体）+ ⑨⑩ 正交红线', () => {
    const ledger = read(path.join('src', 'host', 'ledger.js'))
    assert(ledger.indexOf("_folders({ op: 'create', name: LEDGER_ARCHIVE_FOLDER, sys: true })") >= 0, 'ledger「记忆档案」ensure 创建 sys:true 直入')
    const sched = read(path.join('src', 'host', 'schedule.js'))
    assert(sched.indexOf("_folders({ op: 'create', name: EXEC_LOG_FOLDER_NAME, sys: true })") >= 0, 'schedule「执行记录」ensure 创建 sys:true 直入')
    for (const m of ['memory.js', 'memory.dist.js']) {
      const mm = read(path.join('src', 'host', m))
      assert(mm.indexOf("name: MEMORY_GUIDE_FOLDER, order: maxOrder + 1, sys: true }") >= 0, m + '「工作日志」夹 ensure 创建 sys:true 直入')
    }
    // 红线：⑨ 内容级 kind=sys 谓词零改动；hidden 摘字段语义零改动（仅在守卫内 delete）
    const hostNotes = read(path.join('src', 'host', 'notes.js'))
    assert(hostNotes.indexOf("if (includeSys !== true && !kind && !tag && (folder === undefined || folder === '') && note.kind === 'sys') continue") >= 0, '⑨ 内容级 sys 降噪谓词零触碰（folder 级 sys 与内容级 kind=sys 正交）')
    assert(hostSrc.indexOf('sysSubtree') < 0 && indexSrc.indexOf('sysSubtree') < 0, 'host 双产物不含 sysSubtree（夹级遮罩纯客户端概念，host 语义零改动红线）')
  })

  // ===== ② 行为级（独立 mock 实例，基建同节 82）：懒迁移幂等 / 墓碑 / set-flags 往返 / create / ensure 幂等 =====
  function mkInst() {
    const store = new Map()
    let folderWriteN = 0
    const fsMock = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
      writeText: async (p, c) => { if (/folders\.json$/.test(p)) folderWriteN++; store.set(p, c) },
    }
    const handlers = {}
    const tools = []
    const harnessMock = {
      handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } },
      defineTool: (def) => def,
      registerTool: (ctx, def) => { tools.push(def); return () => {} },
    }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply({
      fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return { store, handlers, tools, folderWrites: () => folderWriteN }
  }
  const instA = mkInst()
  const FJSON = NOTES_DIR + '\\folders.json'
  await t('懒迁移：三夹名称匹配 + sys 缺席 → 置 true 落盘恰一次（幂等再 load 零重写）；改名夹/显式 false 墓碑/普通夹不动', async () => {
    instA.store.set(FJSON, JSON.stringify([
      { id: 'f-log', name: '工作日志', order: 0 },
      { id: 'f-arch', name: '记忆档案', order: 1 },
      { id: 'f-exec', name: '执行记录', order: 2 },
      { id: 'f-ren', name: '我的工作日志', order: 3 },              // 用户改名过的夹：名称严格不匹配 → 不动
      { id: 'f-tomb', name: '工作日志', order: 4, sys: false },     // 用户摘除墓碑：显式 false → 不回标
      { id: 'f-norm', name: '普通夹', order: 5 },
    ]))
    const l0 = await instA.handlers['notes-folders']({})
    const byId = {}; l0.folders.forEach(f => { byId[f.id] = f })
    assert(byId['f-log'].sys === true && byId['f-arch'].sys === true && byId['f-exec'].sys === true, '三夹懒迁移置 sys:true（list 返回携带）')
    assert(byId['f-ren'].sys === false && byId['f-tomb'].sys === false && byId['f-norm'].sys === false, '改名夹/墓碑/普通夹不中标（严格匹配红线）')
    assert.strictEqual(instA.folderWrites(), 1, '迁移落盘恰一次（实得 ' + instA.folderWrites() + '）')
    await instA.handlers['notes-folders']({})
    assert.strictEqual(instA.folderWrites(), 1, '二次 load 零重写（幂等——置位后不再命中判据）')
    const disk = JSON.parse(instA.store.get(FJSON))
    const dById = {}; disk.forEach(f => { dById[f.id] = f })
    assert(dById['f-log'].sys === true && dById['f-arch'].sys === true && dById['f-exec'].sys === true, '磁盘三夹 sys:true 落盘')
    assert(dById['f-tomb'].sys === false, '墓碑显式 false 落盘保留（回写不丢）')
    assert(!('sys' in dById['f-ren']) && !('sys' in dById['f-norm']), '改名夹/普通夹磁盘零 sys 键（存量零迁移）')
  })
  await t('set-flags sys：true/false 往返 + false 墓碑挡迁移回标 + 两键独立（单写 sys 不动 hidden）+ 幽灵 id 报错', async () => {
    const s1 = await instA.handlers['notes-folders']({ op: 'set-flags', id: 'f-norm', sys: true })
    assert(s1 && s1.ok === true && s1.sys === true, 'set-flags sys:true 回执（普通夹可人工标记）')
    await instA.handlers['notes-folders']({ op: 'set-flags', id: 'f-norm', hidden: true })
    await instA.handlers['notes-folders']({ op: 'set-flags', id: 'f-norm', sys: false })
    const l = await instA.handlers['notes-folders']({})
    const fn = l.folders.find(x => x.id === 'f-norm')
    assert(fn.sys === false && fn.hidden === true, '两键独立：单写 sys 不动 hidden（D 卡语义零改动）')
    // 墓碑挡迁移：f-log 摘除 sys:false → 再 list 不回弹、零重写
    const s2 = await instA.handlers['notes-folders']({ op: 'set-flags', id: 'f-log', sys: false })
    assert(s2.ok === true && s2.sys === false, 'sys:false 摘除回执')
    const w0 = instA.folderWrites()
    const l2 = await instA.handlers['notes-folders']({})
    assert(l2.folders.find(x => x.id === 'f-log').sys === false, '摘除后 list 仍 sys:false（墓碑生效不回弹）')
    assert.strictEqual(instA.folderWrites(), w0, '墓碑在场 list 零迁移重写')
    const s3 = await instA.handlers['notes-folders']({ op: 'set-flags', id: 'f-log', sys: true })
    assert(s3.sys === true, '再传 true 恢复（墓碑可逆）')
    const sBad = await instA.handlers['notes-folders']({ op: 'set-flags', id: 'f-ghost', sys: true })
    assert(sBad && sBad.error, '幽灵 id 显式报错（不落库）')
  })
  await t('create sys 直入 + 工作日志夹 ensure（memory-guide enable）：创建带 sys:true + 命中复用不重复建（幂等）', async () => {
    const c = await instA.handlers['notes-folders']({ op: 'create', name: '机器直建夹', sys: true })
    assert(c.ok && c.folder && c.folder.sys === true, 'create sys:true 直入（回执携带）')
    const c2 = await instA.handlers['notes-folders']({ op: 'create', name: '普通直建夹' })
    assert(c2.ok && !('sys' in c2.folder), 'UI 新建不传 sys = 缺省普通夹（存量零迁移）')
    // 工作日志夹 ensure 创建路径（干净实例）：enable → 「工作日志」夹懒建带 sys:true；二次 enable 幂等（already 短路不重复建）
    const instB = mkInst()
    const e1 = await instB.handlers['notes-memory-guide']({ op: 'enable', scope: [] })
    assert(e1 && e1.ok === true, 'memory-guide enable 成功（实得 ' + JSON.stringify(e1) + '）')
    const lb = await instB.handlers['notes-folders']({})
    const wf = lb.folders.filter(f => f.name === '工作日志')
    assert(wf.length === 1 && wf[0].sys === true, '「工作日志」夹 ensure 创建带 sys:true（实得 ' + JSON.stringify(wf.map(f => f.sys)) + '）')
    const e2 = await instB.handlers['notes-memory-guide']({ op: 'enable', scope: [] })
    assert(e2 && e2.ok === true && e2.already === true, '二次 enable 幂等（already 短路）')
    const lb2 = await instB.handlers['notes-folders']({})
    assert(lb2.folders.filter(f => f.name === '工作日志').length === 1, '二次 enable 不重复建夹（ensure 幂等）')
  })

  // ===== ③ client 端接线锚：machineOn 通道判定 + sys 夹早退 + sysSubtree 管线滤除 + 右键菜单 + sysKids 遮罩门 + 发布包同步 =====
  await t('client 接线：machineOn 判定 + renderFolderNode sys 早退 + sysSubtree 管线（夹内容随夹隐身）+ tooltip', () => {
    assert(cliTree.indexOf("const machineOn = ((filters && filters.kinds) || []).indexOf('sys') >= 0") >= 0, 'panel/tree.js machineOn 机器档通道判定（filters.kinds 含 sys）')
    assert(cliTree.indexOf('if (f.sys === true && !showHidden && !machineOn) return') >= 0, 'panel/tree.js sys 夹默认早退（行+nested 容器消失；双通道均关时）')
    assert(cliTree.indexOf("tt('tree.sysFolderTip')") >= 0, 'panel/tree.js sys 夹行名机器托管 tooltip')
    assert(cliIndex.indexOf("if (!showHidden && filters.kinds.indexOf('sys') < 0) {") >= 0
      && cliIndex.indexOf('for (const f of folders) if (f.sys === true) Object.assign(sysSubtree, folderSubtreeIdsOf(f.id))') >= 0
      && cliIndex.indexOf("filtered = filtered.filter(n => !sysSubtree[(n.folder || '')])") >= 0, 'panel/index.js sysSubtree 管线滤除（sys 夹子树链内笔记随夹隐身，OS 父子树语义同 hidden）')
  })
  await t('client 文件夹右键菜单：标记为机器文件夹/取消机器属性 → set-flags sys 键 + sysKids 遮罩门 + 发布包同步', () => {
    assert(cliMenu.indexOf('function doSetFolderSys(f, sys)') >= 0 && cliMenu.indexOf("host.call('notes-folders', { op: 'set-flags', id: f.id, sys: sys === true })") >= 0, 'doSetFolderSys 动作（set-flags sys 键同通道）')
    assert(cliMenu.indexOf("t('fld.menuUnsys')") >= 0 && cliMenu.indexOf("t('fld.menuSys')") >= 0, '菜单项「标记为机器文件夹」/「取消机器属性」')
    assert(cliMenu.indexOf("t('fld.sysToast'") >= 0 && cliMenu.indexOf("t('fld.unsysToast'") >= 0, 'sys 标记/摘除 toast 文案')
    assert(cliMenu.indexOf("if (f.sys === true && !showHidden && kf.indexOf('sys') < 0) continue") >= 0, 'sysKids 补拉遮罩门（树中隐身的 sys 夹零请求）')
    assert(cliMenu.indexOf('[foldersExpanded, notes, folders, showHidden]') >= 0, 'sysKids 补拉效应 deps 含 showHidden（开关切换即重审）')
    assert(clientPkgSrc.indexOf("op: 'set-flags', id: f.id, sys: sys === true") >= 0 && clientPkgSrc.indexOf('!machineOn') >= 0, '发布包 lib/client.js 同步（需先跑 build-dist）')
  })

  // ===== ④ app 端同构锚：folderSys/machineKindOn helper + matches 谓词 + folderNodeHtml 早退 + 菜单 + ensureSysKids 遮罩门 =====
  await t('app 同构：folderSys/machineKindOn + matches sys 谓词 + folderNodeHtml 早退 + tooltip + 菜单接线 + ensureSysKids 遮罩门', () => {
    assert(appHelpers.indexOf('function folderSys(fid)') >= 0, 'app helpers folderSys parent 链上溯判定（cycle 防御）')
    assert(appState.indexOf('function machineKindOn()') >= 0 && appState.indexOf("return filters.kinds.indexOf('sys') >= 0") >= 0, 'app state machineKindOn 机器档判定')
    assert(appQuery.indexOf('if (!showHidden && !machineKindOn() && n.folder && folderSys(n.folder)) return false;') >= 0, 'app matches() sys 夹链遮罩谓词（夹内普通笔记随夹隐身）')
    assert(appTree.indexOf("if (f.sys === true && !showHidden && !machineKindOn()) return '';") >= 0, 'app folderNodeHtml sys 夹默认早退')
    assert(appTree.indexOf("t('tree.sysFolderTip')") >= 0, 'app sys 夹行名 tooltip')
    assert(appTree.indexOf('if (fSelf && fSelf.sys === true && !showHidden && !machineKindOn()) return') >= 0, 'app ensureSysKids 遮罩门（遮罩期零请求）')
    assert(appFolders.indexOf('function doSetFolderSys(f, sys)') >= 0 && appFolders.indexOf("rpc('notes-folders', { op: 'set-flags', id: f.id, sys: sys === true })") >= 0, 'app doSetFolderSys（rpc 通道）')
    assert(appFolders.indexOf('data-a="sys"') >= 0 && appFolders.indexOf("else if (a === 'sys') doSetFolderSys(f, !(f.sys === true));") >= 0, 'app 文件夹右键「标记/取消机器属性」菜单接线')
    assert(appHtml.indexOf('function folderSys(fid)') >= 0 && appHtml.indexOf('data-a="sys"') >= 0 && appHtml.indexOf('function machineKindOn()') >= 0, '发布包 app.html 同步（需先跑 build-dist）')
  })

  // ===== ⑤ 行为级 eval：app folderNodeHtml sys 遮罩语义（默认消失 / 机器档放行 / 显示隐藏放行 / 嵌套子夹同裁 / 普通夹零影响）=====
  await t('行为级 eval：folderNodeHtml——sys 夹双通道均关整节点消失 + 机器档/显示隐藏任一开放行 + 普通夹零影响 + 嵌套 sys 子夹同裁', () => {
    const m = appTree.match(/function folderNodeHtml\(f, vis, filtering\) \{([\s\S]*?)\n\}/)
    assert(m, '提取 app folderNodeHtml 失败（结构变更需同步本断言）')
    function mkWorld(over) {
      const target = Object.assign({
        foldOpen: {},
        showHidden: false,
        filters: { kinds: [] },
        sysKids: {},
        folders: [
          { id: 'fSys', name: '记忆档案', parent: '', count: 2, sys: true },
          { id: 'fNorm', name: '普通夹', parent: '', count: 1 },
          { id: 'fSubSys', name: '机器子夹', parent: 'fNorm', count: 0, sys: true },
        ],
        t: function (k) { return k },
        icon: function () { return '' },
        esc: function (s) { return String(s) },
        machineKindOn: function () { return target.filters.kinds.indexOf('sys') >= 0 },
        noteRow: function (n) { return '<div class="note-row" data-note="' + n.id + '"></div>' },
        folderKids: function (pid) { return target.folders.filter(function (x) { return (x.parent || '') === pid }) },
        folderSubtree: function (id) { var o = {}; o[id] = true; return o },
      }, over || {})
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      new Function('scope', 'with (scope) {\nfolderNodeHtml = function (f, vis, filtering) {' + m[1] + '\n}\n__fn = folderNodeHtml\n}')(proxy)   // 实名挂载：递归自调用（嵌套子夹）经 proxy 解析到真身
      return target.__fn
    }
    const fSys = { id: 'fSys', name: '记忆档案', parent: '', count: 2, sys: true }
    const fNorm = { id: 'fNorm', name: '普通夹', parent: '', count: 1 }
    const vis = [{ id: 'n1', kind: 'note', folder: 'fNorm' }, { id: 'n2', kind: 'note', folder: 'fSys' }]
    // 双通道均关（缺省）：sys 夹整节点消失（行 + nested 容器 + 夹内普通笔记随夹隐身）
    assert(mkWorld()(fSys, vis, false) === '', '缺省档：sys 夹行+nested 容器整体滤除（夹内普通笔记随夹消失，OS 语义）')
    // 通道①：机器档选中 → sys 夹渲染（含夹内行 + 行名 tooltip）
    const hMach = mkWorld({ filters: { kinds: ['sys'] } })(fSys, vis, false)
    assert(hMach.indexOf('data-fold="fSys"') >= 0 && hMach.indexOf('data-note="n2"') >= 0, '机器档选中：sys 夹渲染（含夹内普通笔记行）')
    assert(hMach.indexOf('title="tree.sysFolderTip"') >= 0, '机器档可见时行名带机器托管 tooltip')
    // 通道②：显示隐藏开 → sys 夹渲染
    const hShow = mkWorld({ showHidden: true })(fSys, vis, false)
    assert(hShow.indexOf('data-fold="fSys"') >= 0, '显示隐藏开：sys 夹渲染（双通道并集，任一开即见）')
    // 普通夹零影响：渲染且无 tooltip
    const hNorm = mkWorld()(fNorm, vis, false)
    assert(hNorm.indexOf('data-fold="fNorm"') >= 0 && hNorm.indexOf('data-note="n1"') >= 0 && hNorm.indexOf('sysFolderTip') < 0, '普通夹渲染零影响（无机器 tooltip）')
    // 嵌套 sys 子夹：普通父夹照常渲染，sys 子夹行同裁（不混入父夹 nested 容器）
    assert(hNorm.indexOf('data-fold="fSubSys"') < 0, '嵌套 sys 子夹随递归同裁（父夹 nested 容器不含其子行）')
    const hNormMach = mkWorld({ filters: { kinds: ['sys'] } })(fNorm, vis, false)
    assert(hNormMach.indexOf('data-fold="fSubSys"') >= 0, '机器档选中：嵌套 sys 子夹同通道放行渲染')
  })

  // ===== ⑥ 行为级 eval：app matches() sys 夹链谓词（随夹隐身 / 双通道放行 / hidden 谓词零改动）=====
  await t('行为级 eval：matches()——sys 夹链内笔记默认滤除 + 机器档/显示隐藏放行 + 普通夹零影响 + hidden 红线不动', () => {
    const mM = appQuery.match(/function matches\(n\) \{([\s\S]*?)\n\}/)
    const mF = appHelpers.match(/function folderSys\(fid\) \{([\s\S]*?)\n\}/)
    const mK = appState.match(/function matchFilters\(n, F\) \{([\s\S]*?)\n\}/)
    assert(mM && mF && mK, '提取 matches/folderSys/matchFilters 失败（结构变更需同步本断言）')
    function mkWorld(over) {
      const target = Object.assign({
        view: { type: 'all', id: '' },
        showHidden: false,
        filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: [] },
        folders: [
          { id: 'fSys', name: '工作日志', parent: '', sys: true },
          { id: 'fChild', name: '子夹', parent: 'fSys' },   // 普通子夹挂在 sys 夹下（链上溯应判 sys）
          { id: 'fNorm', name: '普通夹', parent: '' },
        ],
        searchText: '', searchIds: null,
        machineKindOn: function () { return target.filters.kinds.indexOf('sys') >= 0 },
        fname: function () { return '' },
      }, over || {})
      const proxy = new Proxy(target, {
        has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
        get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
        set(t2, k, v) { t2[k] = v; return true }
      })
      new Function('scope', 'with (scope) {\nfolderSys = function (fid) {' + mF[1] + '\n}\nmatchFilters = function (n, F) {' + mK[1] + '\n}\n__matches = function (n) {' + mM[1] + '\n}\n}')(proxy)   // 实名挂载：matches 内 folderSys/matchFilters 调用经 proxy 解析到真身
      return { matches: target.__matches }
    }
    // 缺省（双通道均关）：sys 夹直挂笔记滤除；sys 夹子孙夹链内笔记同滤除（folderSys 链上溯）
    assert(mkWorld().matches({ id: 'a', kind: 'note', folder: 'fSys' }) === false, '缺省档：sys 夹内普通笔记随夹滤除')
    assert(mkWorld().matches({ id: 'b', kind: 'log', folder: 'fChild' }) === false, '缺省档：sys 夹子孙夹链内笔记同滤除（OS 父子树语义）')
    assert(mkWorld().matches({ id: 'c', kind: 'note', folder: 'fNorm' }) === true, '普通夹笔记零影响')
    assert(mkWorld().matches({ id: 'd', kind: 'note', folder: '' }) === true, '未入夹笔记零影响')
    // 通道②：显示隐藏开 → sys 夹链内笔记放行
    assert(mkWorld({ showHidden: true }).matches({ id: 'a', kind: 'note', folder: 'fSys' }) === true, '显示隐藏开：sys 夹内笔记放行')
    // 通道①：机器档选中（kinds=['sys']）→ sys 夹内 sys 档案放行（kind 谓词同闸：只放行 sys）
    assert(mkWorld({ filters: { pinned: false, injected: false, injectEver: false, sensitive: false, kinds: ['sys'] } }).matches({ id: 'e', kind: 'sys', folder: 'fSys' }) === true, '机器档选中：sys 夹内 sys 档案放行（双通道并集）')
    // hidden 红线零改动：hidden 笔记在开关关时仍滤除（与 sys 谓词叠加不互扰）
    assert(mkWorld().matches({ id: 'f', kind: 'note', folder: '', hidden: true }) === false, 'hidden 谓词零改动（D 卡语义保持）')
  })

  // ===== ⑦ i18n 双语在案 =====
  await t('i18n：sys 机器属性相关键双语在案（fld.menuSys/menuUnsys/sysToast/unsysToast/sysFailed + tree.sysFolderTip）', () => {
    for (const k of ["'fld.menuSys'", "'fld.menuUnsys'", "'fld.sysToast'", "'fld.unsysToast'", "'fld.sysFailed'", "'tree.sysFolderTip'"]) {
      assert(zh.indexOf(k + ':') >= 0, 'zh 缺 ' + k)
      assert(en.indexOf(k + ':') >= 0, 'en 缺 ' + k)
    }
  })
  }
}
