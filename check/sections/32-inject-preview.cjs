// 节 32. 注入预览器（notes-inject-preview + 设置卡片入口 modal + 双端同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "32",
  title: "32. 注入预览器（notes-inject-preview + 设置卡片入口 modal + 双端同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, g, llmMock, plugin, protoV2Src, r1, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  // ===== 32. 注入预览器（notes-inject-preview RPC + 设置卡片「注入预览」modal） =====
  // 契约：RPC {sessionId?} → { conventions, catalog, stats:{conventionsChars, catalogChars, totalChars, maskedNotes, staleMarked, budgetTruncated} }；
  // 缺省 sessionId = 「全局」视角（sidOverride=''，只命中 injectTo=[] 的笔记）；传会话 id/短 id 按 conventionHit 同一口径过滤；
  // 纯复用 conventionText/catalogText（新增 sidOverride 形参 + 渲染统计 lastConvStats/lastCatStats），不重写拼装；预览渲染不更新 lastInjectChars（仪表只反映真实注入）。
  section('32. 注入预览器（notes-inject-preview + 设置卡片入口 modal + 双端同步）')

  // ---- 32.1 host 双侧结构契约（host-impl / index.mjs 双包同步）----
  await t('host 双侧：notes-inject-preview RPC + sidOverride 形参 + 渲染统计变量（双包同步）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("handle('notes-inject-preview'") >= 0, label + ' notes-inject-preview RPC 注册')
      assert(s.indexOf('function conventionText(sidOverride)') >= 0, label + ' conventionText 支持 sidOverride（纯复用，不重写拼装）')
      assert(s.indexOf('function catalogText(sidOverride)') >= 0, label + ' catalogText 支持 sidOverride')
      assert((s.match(/sidOverride [!=]== undefined/g) || []).length >= 4, label + ' sidOverride 守卫（curSid ×2 + lastInjectChars ×2）')
      assert(s.indexOf('const lastConvStats = { masked: 0, budgetTruncated: false }') >= 0, label + ' lastConvStats 渲染统计')
      assert(s.indexOf('const lastCatStats = { masked: 0, stale: 0 }') >= 0, label + ' lastCatStats 渲染统计')
      assert(s.indexOf('lastCatStats.stale = staleCount') >= 0, label + ' catalogText 时效标注计数')
      assert(s.indexOf('conventionsChars: conventions.length') >= 0 && s.indexOf('budgetTruncated: lastConvStats.budgetTruncated') >= 0, label + ' stats 字段结构')
      assert(s.indexOf('if (sidOverride === undefined) lastInjectChars = full.length') >= 0, label + ' 预览渲染不更新 lastInjectChars（仪表只反映真实注入）')
      // notes-scope-global-pick：三档视角（全局/工作区并集/单会话）——workspace 参数 + conventionHit 集合口径（双包同步）
      assert(s.indexOf("const wsName = !sid && args && args.workspace ? String(args.workspace) : ''") >= 0, label + ' inject-preview workspace 参数（与 sessionId 互斥，sessionId 优先）')
      assert(s.indexOf('const sidSet = Array.isArray(curSid) ? curSid : null') >= 0, label + ' conventionHit 支持会话短 id 集合（工作区并集视角）')
      assert(s.indexOf('sessRes.pendingSessions') >= 0, label + ' workspace 解析含 pending 占位会话（同 notes-sessions 数据源）')
    }
  })

  // ---- 32.2 host 行为级（开发版独立实例 storeIP/handlersIP，与 28/29 节同款隔离模式）----
  const storeIP = new Map()
  const fsMockIP = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeIP.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeIP.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeIP.has(p)) throw new Error('ENOENT: ' + p); return storeIP.get(p) },
    writeText: async (p, c) => { storeIP.set(p, c) },
  }
  const handlersIP = {}
  const harnessMockIP = { handle: (name, fn) => { handlersIP[name] = fn; return () => { delete handlersIP[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockIP, DIR).apply({
    fs: fsMockIP, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('notes-inject-preview 返回结构：conventions/catalog 字符串 + stats 六字段数值正确', async () => {
    await handlersIP['notes-create']({ title: '预览全局约定', body: '全局约定正文', inject: true, topic: '约定' })
    const r = await handlersIP['notes-inject-preview']({})
    assert(!r.error, '无报错（实得 ' + JSON.stringify(r).slice(0, 160) + '）')
    assert(typeof r.conventions === 'string' && typeof r.catalog === 'string', 'conventions/catalog 为字符串')
    const st = r.stats
    assert(st && typeof st.conventionsChars === 'number' && typeof st.catalogChars === 'number' && typeof st.totalChars === 'number', 'stats 字符数三字段为数值')
    assert(typeof st.maskedNotes === 'number' && typeof st.staleMarked === 'number' && typeof st.budgetTruncated === 'boolean', 'stats maskedNotes/staleMarked/budgetTruncated 类型')
    assert.strictEqual(st.conventionsChars, r.conventions.length, 'conventionsChars = conventions.length')
    assert.strictEqual(st.catalogChars, r.catalog.length, 'catalogChars = catalog.length')
    assert.strictEqual(st.totalChars, r.conventions.length + r.catalog.length, 'totalChars = 两者之和')
    assert(r.conventions.indexOf('预览全局约定') >= 0 && r.conventions.indexOf('全局约定正文') >= 0, '全局视角含 injectTo=[] 注入笔记')
  })
  await t('sessionId 过滤：缺省全局不含定向笔记；传会话长 id 自动 shortSid 命中；其他会话不命中', async () => {
    await handlersIP['notes-create']({ title: '预览定向约定abc', body: '定向正文', inject: true, injectTo: ['abc12345'], topic: '约定' })
    const g0 = await handlersIP['notes-inject-preview']({})
    assert(g0.conventions.indexOf('预览定向约定abc') < 0, '缺省 sessionId = 全局视角，不含 injectTo 定向笔记')
    const g1 = await handlersIP['notes-inject-preview']({ sessionId: 'session-abc12345-0000-0000-0000-000000000000' })
    assert(g1.conventions.indexOf('预览定向约定abc') >= 0, '传会话长 id 命中定向笔记（shortSid 转换）')
    assert(g1.conventions.indexOf('预览全局约定') >= 0, '全局笔记在会话视角仍在（injectTo=[] 所有会话共享）')
    const g2 = await handlersIP['notes-inject-preview']({ sessionId: 'deadbeef' })
    assert(g2.conventions.indexOf('预览定向约定abc') < 0, '其他会话短 id 不命中')
  })
  await t('workspace 视角：该工作区全部会话注入并集 + 未知工作区退化全局 + sessionId 互斥优先', async () => {
    // 自造数（--core 模式跳过「sessionId 过滤」断言体，其定向笔记不存在；CORE 约定 = 核心断言共享状态与全量一致，依赖的笔记须自造）
    await handlersIP['notes-create']({ title: '预览定向约定ws', body: '定向正文ws', inject: true, injectTo: ['abc12345'], topic: '约定' })
    // workspaceRegistryMock 唯一工作区 deepseek-work：含 live 会话 abc12345（short 命中定向笔记 injectTo）
    const w0 = await handlersIP['notes-inject-preview']({ workspace: 'deepseek-work' })
    assert(w0.conventions.indexOf('预览定向约定ws') >= 0, '工作区视角命中区内会话的定向笔记（并集口径，实得长度 ' + w0.conventions.length + '）')
    assert(w0.conventions.indexOf('预览全局约定') >= 0, '工作区视角仍含 injectTo=[] 全局笔记')
    const w1 = await handlersIP['notes-inject-preview']({ workspace: 'no-such-ws' })
    assert(w1.conventions.indexOf('预览定向约定ws') < 0 && w1.conventions.indexOf('预览全局约定') >= 0, '未知工作区 = 空会话集合：并集退化为全局视角')
    const w2 = await handlersIP['notes-inject-preview']({ sessionId: 'deadbeef', workspace: 'deepseek-work' })
    assert(w2.conventions.indexOf('预览定向约定ws') < 0, 'sessionId 与 workspace 同传时 sessionId 优先（deadbeef 不命中）')
  })
  await t('脱敏文本进入预览：sensitive 正文/标题打码 + 占位符 + stats.maskedNotes 覆盖双桶', async () => {
    const c1 = await handlersIP['notes-create']({ title: '预览敏感约定', body: '部署密码：Top$ecret99', inject: true, sensitive: true, topic: '敏感' })
    await handlersIP['notes-create']({ title: '预览敏感目录 token: ghp_pv999', body: 'x', sensitive: true, topic: '敏感' })   // inject=false → 进目录桶
    const r = await handlersIP['notes-inject-preview']({})
    assert(r.conventions.indexOf('Top$ecret99') < 0, '约定预览不含明文密码')
    assert(r.conventions.indexOf('部署密码：******（敏感，note_get ' + c1.id + ' 获取）') >= 0, '约定预览含打码占位符（键保留值遮蔽）')
    assert(r.catalog.indexOf('ghp_pv999') < 0 && r.catalog.indexOf('🔒') >= 0, '目录预览标题打码 + 🔒 标记')
    assert(r.stats.maskedNotes >= 2, 'maskedNotes 覆盖约定桶 + 目录桶（实得 ' + r.stats.maskedNotes + '）')
  })
  await t('stats.staleMarked / budgetTruncated：⚠ 时效标注计数 + 预算截断标记 + 预览不污染 lastInjectChars', async () => {
    const old = new Date(Date.now() - 100 * 86400000).toISOString()
    await fsMockIP.writeText(NOTES_DIR + '\\n-pv-stale.md', '---\nid: n-pv-stale\ntitle: 预览陈旧笔记\ntopic: 运维\ncreatedAt: "' + old + '"\nupdatedAt: "' + old + '"\n---\n\n旧正文\n')
    await handlersIP['notes-get']({ id: 'n-pv-stale' })   // 触发解析进 cache（catalogText 只读 cache）
    const r0 = await handlersIP['notes-inject-preview']({})
    assert(r0.catalog.indexOf('预览陈旧笔记 (笔记, 运维) ⚠ 100 天未更新') >= 0, '目录预览含 ⚠ 时效标注')
    assert(r0.stats.staleMarked >= 1, 'staleMarked ≥ 1（实得 ' + r0.stats.staleMarked + '）')
    assert.strictEqual(r0.stats.budgetTruncated, false, '缺省不限：budgetTruncated=false')
    // 预算收紧 → 资料桶整条省略 → budgetTruncated=true + 省略提示行入预览文本
    await handlersIP['notes-create']({ title: '预览资料一', body: 'a'.repeat(300), inject: true, injectRole: 'reference', topic: '资料' })
    await handlersIP['notes-settings-set']({ injectBudgetChars: 120 })
    const r1 = await handlersIP['notes-inject-preview']({})
    assert.strictEqual(r1.stats.budgetTruncated, true, '超预算：budgetTruncated=true')
    assert(r1.conventions.indexOf('条资料超出预算未注入（note_search 可检索）') >= 0, '预览文本含预算省略提示行')
    assert(r1.conventions.indexOf('预览资料一') < 0, '资料桶被省略（约定桶永不截断）')
    await handlersIP['notes-settings-set']({ injectBudgetChars: null })
    const r2 = await handlersIP['notes-inject-preview']({})
    assert.strictEqual(r2.stats.budgetTruncated, false, '恢复不限：budgetTruncated=false')
    // 预览渲染不触碰仪表数据源：lastInjectChars 恒为 0（本实例从未真实渲染注入）
    assert(r2.conventions.length > 0, '预览有内容')
    const sg = await handlersIP['notes-settings-get']({})
    assert.strictEqual(sg.lastInjectChars, 0, 'notes-inject-preview 不更新 lastInjectChars（仪表只反映真实注入）')
  })

  // ---- 32.3 静态包行为（独立 ESM 实例；harness 缺席 → webServer 路由链路，与 29.3 同款）----
  await t('静态包：notes-inject-preview 经 webServer 路由返回完整结构 + sessionId 过滤', async () => {
    const storePv = new Map()
    const fsMockPv = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (storePv.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storePv.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storePv.has(p)) throw new Error('ENOENT: ' + p); return storePv.get(p) },
      writeText: async (p, c) => { storePv.set(p, c) },
    }
    const routesPv = []
    const modPv = await import(pathToFileURL(INDEX_PATH).href + '?injprev=1')
    modPv.apply({
      fs: fsMockPv, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routesPv.push(r); return () => {} } },
      tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    function rpcPv(method, args) {
      return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routesPv[0].handler(req, res)).catch(reject)
      })
    }
    await rpcPv('notes-create', { title: '静态预览约定', body: '静态正文', inject: true, topic: '约定' })
    await rpcPv('notes-create', { title: '静态预览定向', body: '定向', inject: true, injectTo: ['abc12345'], topic: '约定' })
    const r = await rpcPv('notes-inject-preview', {})
    assert(r.body && typeof r.body.conventions === 'string' && typeof r.body.catalog === 'string' && r.body.stats, '路由返回 {conventions, catalog, stats} 结构齐备')
    assert(r.body.conventions.indexOf('静态预览约定') >= 0 && r.body.conventions.indexOf('静态预览定向') < 0, '静态包缺省全局视角（定向笔记不命中）')
    assert.strictEqual(r.body.stats.totalChars, r.body.conventions.length + r.body.catalog.length, '静态包 totalChars = 两桶之和')
    const r2 = await rpcPv('notes-inject-preview', { sessionId: 'abc12345' })
    assert(r2.body.conventions.indexOf('静态预览定向') >= 0, '静态包 sessionId 过滤命中定向笔记')
  })

  // ---- 32.4 client 结构断言（开发版 client-impl + 发布包 lib/client.js + 样式双端）----
  await t('client 注入预览链路：设置行入口 + modal 双 tab/会话下拉/统计条 + Esc + 错误条排除（开发版 + 发布包）', () => {
    assert(clientSrc.indexOf("key: 'injprev', label: '注入预览'") >= 0, 'settingsRows 含「注入预览」行')
    assert(clientSrc.indexOf('onClick: openInjectPreview') >= 0, '预览按钮接线 openInjectPreview')
    assert(clientSrc.indexOf('function openInjectPreview()') >= 0 && clientSrc.indexOf('function loadInjectPreview(sid)') >= 0, 'openInjectPreview/loadInjectPreview 存在')
    assert(clientSrc.indexOf("sid.indexOf('ws:') === 0 ? { workspace: sid.slice(3) } : { sessionId: sid }") >= 0, 'RPC 调用（缺省全局 / ws: 前缀走 workspace 并集视角 / 传 sessionId）')
    assert(clientSrc.indexOf("e('optgroup', { label: '工作区' }") >= 0 && clientSrc.indexOf("e('optgroup', { label: '会话' }") >= 0, '预览视角下拉三档（全局 + 工作区/会话 optgroup）')
    assert(clientSrc.indexOf("const [injectPreviewTab, setInjectPreviewTab] = React.useState('conv')") >= 0, '双 tab 状态（缺省约定）')
    assert(clientSrc.indexOf('dsh-notes-injprev-text') >= 0 && clientSrc.indexOf('dsh-notes-injprev-stats') >= 0 && clientSrc.indexOf('dsh-notes-injprev-tab') >= 0, '预览 modal 结构类（文本区/统计条/tab）')
    assert(clientSrc.indexOf('预算截断 ') >= 0 && clientSrc.indexOf('时效标注 ') >= 0, '统计条文案（预算截断/时效标注）')
    assert(clientSrc.indexOf('if (injectPreviewOpenRef.current) { setInjectPreviewOpen(false); return }') >= 0, 'Esc 链路关预览对话框')
    assert(clientSrc.indexOf('!trashOpen && !injectPreviewOpen') >= 0, '全局错误条排除预览 modal（modal 内自显错误）')
    assert(clientSrc.indexOf('setSettingsOpen(false); setInjectPreviewOpen(true)') >= 0, '与设置卡片互斥（modal 不叠 modal）')
    for (const k of ['openInjectPreview', 'notes-inject-preview', 'dsh-notes-injprev-text', 'injectPreviewTab', '注入预览']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺 ' + k + '（需先跑 scripts/build-dist.cjs）')
    }
  })
  await t('注入预览样式双端：styles.css ⇄ 发布包 lib/styles.css', () => {
    const cssDevP = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkgP = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDevP], ['发布包 lib/styles.css', cssPkgP]]) {
      for (const cls of ['.dsh-notes-injprev-modal{', '.dsh-notes-injprev-tab{', '.dsh-notes-injprev-tab.on{', '.dsh-notes-injprev-text{', '.dsh-notes-injprev-stats{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺注入预览样式：' + cls + '（需跑 scripts/build-dist.cjs）')
      }
    }
  })

  // ---- 32.5 app.html / 原型 notes-ui-v2.html 同步（UI 唯一规格来源约束）----
  await t('app.html + 原型注入预览同款：设置行入口 + openInjectPreview + 双 tab/会话下拉/统计条（双端 UI 标记一致 + mock 演示）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="setInjectPreview"') >= 0, label + ' 设置卡片「注入预览」入口')
      assert(s.indexOf("$('setInjectPreview').onclick") >= 0 && s.indexOf('openInjectPreview()') >= 0, label + ' 入口接线')
      assert(s.indexOf('function openInjectPreview()') >= 0 && s.indexOf('function loadInjectPreview()') >= 0 && s.indexOf('function renderInjectPreview()') >= 0, label + ' 预览三函数')
      assert(s.indexOf("v.indexOf('ws:') === 0 ? { workspace: v.slice(3) } : { sessionId: v }") >= 0, label + ' RPC 调用（缺省全局 / ws: 前缀走 workspace 并集视角 / 传 sessionId）')
      assert(s.indexOf('<optgroup label="工作区">') >= 0 && s.indexOf('<optgroup label="会话">') >= 0, label + ' 视角下拉三档（全局 + 工作区/会话 optgroup）')
      assert(s.indexOf("rpc('notes-sessions', {})") >= 0, label + ' 会话下拉数据源 notes-sessions')
      assert(s.indexOf('injprev-text') >= 0 && s.indexOf('injprev-stats') >= 0 && s.indexOf('injprev-tab') >= 0, label + ' 预览 modal 结构类')
      assert(s.indexOf('预算截断 ') >= 0 && s.indexOf('.modal.injprev{') >= 0, label + ' 统计条文案 + 宽 modal 样式')
    }
    // 双端 UI 标记一致（共享 DOM id / 函数名 / 样式类）
    for (const k of ['setInjectPreview', 'openInjectPreview', 'loadInjectPreview', 'renderInjectPreview', 'injectPreviewState', 'injprevTabConv', 'injprevTabCat', 'injprevSess', 'injprevText', 'injprevStats']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '注入预览 UI 标记双端一致：' + k)
    }
    assert(protoV2Src.indexOf("method === 'notes-inject-preview'") >= 0, '原型 mock notes-inject-preview')
    assert(protoV2Src.indexOf('定向约定') >= 0, '原型 mock 演示 sessionId 过滤（定向约定）')
    assert(protoV2Src.indexOf('a.workspace') >= 0 && protoV2Src.indexOf('injectTo 并集演示') >= 0, '原型 mock 演示 workspace 视角（工作区定向约定）')
    assert(protoV2Src.indexOf('maskedNotes: 2') >= 0 && protoV2Src.indexOf('staleMarked: 1') >= 0 && protoV2Src.indexOf('budgetTruncated: false') >= 0, '原型 mock 统计演示值')
  })
  }
}
