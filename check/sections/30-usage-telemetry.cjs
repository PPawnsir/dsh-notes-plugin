// 节 30. P2 使用遥测（note_get 引用计数 + 防抖批量落盘 + 排序 + UI）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "30",
  title: "30. P2 使用遥测（note_get 引用计数 + 防抖批量落盘 + 排序 + UI）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, ctx, g, llmMock, plugin, protoV2Src, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  // ===== 30. P2 使用遥测（note_get 引用计数 + 防抖批量落盘 + 列表/详情显示 + 按引用排序） =====
  section('30. P2 使用遥测（note_get 引用计数 + 防抖批量落盘 + 排序 + UI）')

  // ---- 30.1 host 双侧结构契约（host-impl / index.mjs 双包同步）----
  await t('use-telemetry 标记块双包逐字节一致（host-impl / index.mjs）', () => {
    const grabBlk = (s) => { const m = s.match(/\/\/ ==== use-telemetry BEGIN ====[\s\S]*?\/\/ ==== use-telemetry END ====/); return m ? m[0] : '' }
    const blkDev = grabBlk(hostSrc), blkPkg = grabBlk(indexSrc)
    assert(blkDev.length > 100, 'host-impl 缺 use-telemetry 标记块')
    assert.strictEqual(blkPkg, blkDev, 'host-impl.js 与 index.mjs 的 use-telemetry 块必须逐字节一致')
  })
  await t('host 双侧：useCount 字段链路 + 60s 防抖 + 卸载 flush + note_get 命中 + 归档合计/继承', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const USE_COUNT_FLUSH_MS = 60 * 1000') >= 0, label + ' 60s 防抖常量')
      assert(s.indexOf('function bumpUseCount(id)') >= 0 && s.indexOf('async function flushUseCounts()') >= 0, label + ' bump/flush 函数存在')
      assert(s.indexOf('typeof useCountTimer.unref') >= 0, label + ' timer unref（防抖挂起不阻塞进程退出）')
      assert(s.indexOf("'useCount: ' + escYaml(m.useCount || 0)") >= 0, label + ' buildFM 恒写 useCount（缺省 0）')
      assert(s.indexOf('useCount: Math.max(0, parseInt(p.meta.useCount, 10) || 0)') >= 0, label + ' noteFromParsed 解析缺省 0（存量零迁移）')
      assert(s.indexOf('useCount: n.useCount || 0,') >= 0, label + ' slim 携带 useCount')
      assert(s.indexOf('const uc = bumpUseCount(n.id)') >= 0, label + ' note_get 工具命中计数')
      assert(s.indexOf('flushUseCounts()   // 卸载 flush') >= 0, label + ' 插件卸载 flush（ctx.effect dispose）')
      assert(s.indexOf('totalUseCount: members.reduce((s, m) => s + m.useCount, 0)') >= 0, label + ' 归档预览组合计引用数')
      assert(s.indexOf('useCount: members.reduce((s, n) => s + Math.max(0, n.useCount || 0), 0)') >= 0, label + ' 归档合并继承成员引用合计')
    }
  })

  // ---- 30.2 host 行为级（开发版独立实例 storeU + 假定时器捕获防抖，不真实等待 60s）----
  const storeU = new Map()
  let writesU = 0
  const fsMockU = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeU.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeU.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeU.has(p)) throw new Error('ENOENT: ' + p); return storeU.get(p) },
    writeText: async (p, c) => { writesU++; storeU.set(p, c) },
  }
  const handlersU = {}
  const toolsU = []
  const effectsU = []
  const harnessMockU = { handle: (name, fn) => { handlersU[name] = fn; return () => { delete handlersU[name] } }, defineTool: (d) => d, registerTool: (c, d) => { toolsU.push(d); return () => {} } }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockU, DIR).apply({
    fs: fsMockU, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: (fn) => { effectsU.push(fn) },
  })
  // 预热沉降（真实定时器窗口）：心跳 .last-host-load + 首个 RPC 的 perf-report（10s 节流）落定后再装假定时器
  await handlersU['notes-list']({})
  await new Promise(r => setTimeout(r, 20))
  const noteGetU = toolsU.find(x => x.name === 'note_get')
  const flushMicro30 = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  let teleNoteId = ''
  // 假定时器：捕获防抖调度（60s 不真实等待）；仅本区块生效，finally 恢复
  const realSetTimeout30 = global.setTimeout, realClearTimeout30 = global.clearTimeout
  const scheduledU = []
  global.setTimeout = (fn, ms) => { const h = { fn: fn, ms: ms, cleared: false }; scheduledU.push(h); return h }
  global.clearTimeout = (h) => { if (h) h.cleared = true }
  try {
    await t('note_get 命中计数：内存即时 +1（响应即见），60s 防抖期内零写盘；notes-get RPC 不计数', async () => {
      const cU = await handlersU['notes-create']({ title: '遥测笔记甲', body: '正文甲', tags: [], topic: '运维' })
      teleNoteId = cU.id
      const w0 = writesU
      const g1 = await noteGetU.execute({ id: cU.id })
      const g2 = await noteGetU.execute({ id: cU.id })
      const g3 = await noteGetU.execute({ id: cU.id })
      assert.strictEqual(g1.note.useCount, 1, '第 1 次命中返回 useCount=1')
      assert.strictEqual(g2.note.useCount, 2, '第 2 次命中返回 useCount=2')
      assert.strictEqual(g3.note.useCount, 3, '第 3 次命中返回 useCount=3')
      assert.strictEqual(writesU, w0, '3 次命中防抖期内零写盘（写入增量 ' + (writesU - w0) + '）')
      assert.strictEqual(scheduledU.length, 1, '重复命中只挂一个防抖定时器（实得 ' + scheduledU.length + '）')
      assert.strictEqual(scheduledU[0].ms, 60000, '防抖窗口 60s')
      const lst = await handlersU['notes-list']({})
      assert.strictEqual(lst.notes.find(n => n.id === cU.id).useCount, 3, 'slim 列表即时携带 useCount=3（内存可见，未落盘）')
      assert.strictEqual(writesU, w0, 'notes-list 不触发写盘')
      // notes-get RPC（client 面板打开笔记）不计数：人类浏览非 agent 引用
      const gRpc = await handlersU['notes-get']({ id: cU.id })
      assert.strictEqual(gRpc.note.useCount, 3, 'notes-get RPC 不计数（仍为 3）')
      // 已删笔记 note_get 报错且不计数
      const cDel = await handlersU['notes-create']({ title: '遥测删除笔记', body: 'x' })
      await handlersU['notes-delete']({ id: cDel.id })
      const gDel = await noteGetU.execute({ id: cDel.id })
      assert(gDel.error, '已删笔记 note_get 报错')
      assert.strictEqual(scheduledU.length, 1, '报错不挂防抖定时器（不计数）')
    })
    await t('防抖批量落盘：3 次命中 flush 仅 1 次写盘；front-matter 恒写 useCount；updatedAt 不动', async () => {
      const w0 = writesU
      scheduledU[0].fn()   // 模拟 60s 防抖到期
      await flushMicro30()
      assert.strictEqual(writesU, w0 + 1, '3 次命中批量落盘仅 1 次写盘（增量 ' + (writesU - w0) + '）')
      const onDisk = storeU.get(NOTES_DIR + '\\' + teleNoteId + '.md')
      assert(onDisk.indexOf('\nuseCount: 3\n') >= 0, '磁盘 front-matter useCount: 3')
      const mC = onDisk.match(/\ncreatedAt: ([^\n]+)\n/), mU = onDisk.match(/\nupdatedAt: ([^\n]+)\n/)
      assert(mC && mU && mC[1] === mU[1], '计数落盘不动 updatedAt（计数不算编辑）')
      // 再命中 → 重挂防抖（供 30.2d 卸载 flush 用）
      await noteGetU.execute({ id: teleNoteId })
      assert.strictEqual(scheduledU.length, 2, '命中重挂防抖定时器')
    })
    await t('归档预览组行合计引用数（totalUseCount）+ 合并归档继承成员引用合计', async () => {
      const qA = await handlersU['notes-create']({ title: '速记甲', body: 'quick a', tags: ['quick'] })
      const qB = await handlersU['notes-create']({ title: '速记乙', body: 'quick b', tags: ['quick'] })
      // 同会话（sessCtx 兜底同一 sessionId）2 条 quick → 1 个速记组；甲被引用 2 次
      await noteGetU.execute({ id: qA.id })
      await noteGetU.execute({ id: qA.id })
      const pv = await handlersU['notes-archive-preview']({})
      const grp = pv.quickGroups.find(g => g.members.some(m => m.id === qA.id))
      assert(grp, 'preview 含该速记组')
      assert.strictEqual(grp.totalUseCount, 2, '组行合计引用数 = 成员合计（实得 ' + JSON.stringify(grp.totalUseCount) + '）')
      assert.strictEqual(grp.members.find(m => m.id === qA.id).useCount, 2, '成员条目携带 useCount')
      const ar = await handlersU['notes-archive']({ groups: [{ memberIds: [qA.id, qB.id], title: '遥测归档' }] })
      assert.strictEqual(ar.merged, 1, '合并成功')
      const gArc = await handlersU['notes-get']({ id: ar.groups[0].noteId })
      assert.strictEqual(gArc.note.useCount, 2, '归档笔记继承成员引用合计（合并不丢计数）')
    })
    await t('插件卸载 flush：防抖窗口内未落盘计数立即写盘；防抖定时器清除不二次触发；已删成员跳过', async () => {
      const w1 = writesU
      const disposeU = effectsU[0]()   // ctx.effect 注册的 effect 体 → 返回 dispose
      disposeU()                        // 模拟插件卸载
      await flushMicro30()
      assert.strictEqual(writesU, w1 + 1, '卸载 flush 仅落盘活跃脏笔记（增量 ' + (writesU - w1) + '；已删速记甲跳过）')
      assert.strictEqual(scheduledU[1].cleared, true, '卸载 flush 清掉防抖定时器（不二次触发）')
      assert(storeU.get(NOTES_DIR + '\\' + teleNoteId + '.md').indexOf('\nuseCount: 4\n') >= 0, '卸载后磁盘 useCount: 4')
    })
  } finally {
    global.setTimeout = realSetTimeout30; global.clearTimeout = realClearTimeout30
  }

  // ---- 30.3 静态包行为（独立 ESM 实例 + 假定时器 + webServer 路由链路）----
  await t('静态包：note_get 命中计数 + 60s 防抖批量落盘 + 卸载 flush（webServer 路由链路）', async () => {
    const storeU2 = new Map()
    let writesU2 = 0
    const fsMockU2 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (storeU2.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeU2.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeU2.has(p)) throw new Error('ENOENT: ' + p); return storeU2.get(p) },
      writeText: async (p, c) => { writesU2++; storeU2.set(p, c) },
    }
    const routesU2 = []
    const toolsU2 = []
    const effectsU2 = []
    const ctxU2 = {
      fs: fsMockU2,
      sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routesU2.push(r); return () => {} } },
      tools: { register: (d) => { toolsU2.push(d); return () => {} } },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: (fn) => { effectsU2.push(fn) },
    }
    // 真实静态包环境没有 harness Builtin —— 摘掉还原真实条件
    const harnessBackup30 = global.harness
    delete global.harness
    try {
      const modU = await import(pathToFileURL(INDEX_PATH).href + '?use-telemetry=1')
      modU.apply(ctxU2)
      const rpcU2 = (method, args) => new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routesU2[0].handler(req, res)).catch(reject)
      })
      // 预热沉降（真定时器）：首个 RPC 的 perf-report（10s 节流）落定
      await rpcU2('notes-list', {})
      await new Promise(r => setTimeout(r, 20))
      const tGetU2 = toolsU2.find(x => x.name === 'note_get')
      const scheduledU2 = []
      global.setTimeout = (fn, ms) => { const h = { fn: fn, ms: ms, cleared: false }; scheduledU2.push(h); return h }
      global.clearTimeout = (h) => { if (h) h.cleared = true }
      try {
        const cU2 = await rpcU2('notes-create', { title: '静态遥测笔记', body: '静态正文', tags: [], topic: '运维' })
        const idU2 = cU2.body.id
        const w0 = writesU2
        const g1 = await tGetU2.execute({ id: idU2 })
        const g2 = await tGetU2.execute({ id: idU2 })
        assert.strictEqual(g1.note.useCount, 1, '静态包第 1 次命中 useCount=1')
        assert.strictEqual(g2.note.useCount, 2, '静态包第 2 次命中 useCount=2')
        assert.strictEqual(writesU2, w0, '静态包防抖期内零写盘（增量 ' + (writesU2 - w0) + '）')
        assert.strictEqual(scheduledU2.length, 1, '静态包重复命中只挂一个防抖定时器')
        assert.strictEqual(scheduledU2[0].ms, 60000, '静态包防抖窗口 60s')
        scheduledU2[0].fn()   // 模拟防抖到期
        await flushMicro30()
        assert.strictEqual(writesU2, w0 + 1, '静态包批量落盘仅 1 次写盘（增量 ' + (writesU2 - w0) + '）')
        assert(storeU2.get(path.join(NOTES_ROOT_STATIC, idU2 + '.md')).indexOf('\nuseCount: 2\n') >= 0, '静态包磁盘 useCount: 2')
        // 卸载 flush
        await tGetU2.execute({ id: idU2 })
        const w1 = writesU2
        effectsU2[0]()()   // effect 体 → dispose（插件卸载）
        await flushMicro30()
        assert.strictEqual(writesU2, w1 + 1, '静态包卸载 flush 落盘（增量 ' + (writesU2 - w1) + '）')
        assert.strictEqual(scheduledU2[1].cleared, true, '静态包卸载清掉防抖定时器')
        assert(storeU2.get(path.join(NOTES_ROOT_STATIC, idU2 + '.md')).indexOf('\nuseCount: 3\n') >= 0, '静态包卸载后 useCount: 3')
      } finally {
        global.setTimeout = realSetTimeout30; global.clearTimeout = realClearTimeout30
      }
    } finally {
      if (harnessBackup30 !== undefined) global.harness = harnessBackup30
    }
  })

  // ---- 30.4 列表排序「按引用」（chip 开关 + 真实比较器行为 + 四端同步）----
  await t('按引用排序比较器行为：useCount 降序，同数按 updatedAt 兜底（从 client-impl 源码提取真实比较器执行）', () => {
    const m = clientSrc.match(/if \(sortBy === 'use'\) filtered = filtered\.slice\(\)\.sort\(\(a, b\) => ([^\r\n]+)\)\r?\n/)
    assert(m, 'client-impl 缺按引用排序行')
    const cmp = new Function('a', 'b', 'return ' + m[1])
    const arr = [
      { id: 'x', useCount: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'y', useCount: 5, updatedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'z', useCount: 5, updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'w', useCount: 0, updatedAt: '2026-01-04T00:00:00.000Z' },
      { id: 'v', updatedAt: '2026-01-05T00:00:00.000Z' },
    ]
    assert.strictEqual(arr.slice().sort(cmp).map(n => n.id).join(','), 'z,y,x,v,w', 'useCount 降序 → 同数 updatedAt 降序（缺省字段按 0 计）')
  })
  await t('排序三档接入筛选中心独立控件：时间/引用/相关度（client-impl / 发布包 lib/client.js / app.html / 原型）', () => {
    assert(clientSrc.indexOf("const [sortBy, setSortBy] = React.useState(() => loadFiltersState().sortBy)") >= 0, 'client-impl sortBy 状态（持久化恢复，缺省 time）')
    assert(clientSrc.indexOf("const FILTER_SORTS = [") >= 0 && clientSrc.indexOf("{ id: 'time', label: '时间'") >= 0 && clientSrc.indexOf("{ id: 'use', label: '引用'") >= 0 && clientSrc.indexOf("{ id: 'rel', label: '相关度'") >= 0, 'client-impl 排序三档（FILTER_SORTS 独立控件）')
    assert(clientSrc.indexOf('setSortBy(s.id); setSortOpen(false)') >= 0, 'client-impl 排序档位点击切换（选择即关菜单）')
    assert(clientPkgSrc.indexOf('FILTER_SORTS') >= 0 && clientPkgSrc.indexOf("label: '相关度'") >= 0, '发布包 lib/client.js 同步排序三档（需先跑 scripts/build-dist.cjs）')
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("var sortBy = _fs.sortBy;") >= 0, label + ' sortBy 状态（持久化恢复，缺省 time）')
      assert(s.indexOf("if (sortBy === 'use') vis.sort(") >= 0, label + ' 按引用排序逻辑保留')
      assert(s.indexOf("var FILTER_SORTS = [") >= 0 && s.indexOf("{ id: 'time', label: '时间'") >= 0 && s.indexOf("{ id: 'rel', label: '相关度'") >= 0, label + ' 排序三档（FILTER_SORTS 独立控件）')
      assert(s.indexOf("sortBy === 'rel' && qRel") >= 0, label + ' 相关度排序分支')
    }
  })

  // ---- 30.5 列表行尾/详情 meta「被引用 N 次」（0 次不显示）+ 归档预览合计 + 样式（四端同步）----
  await t('被引用显示链路：行尾徽章 + 详情 meta chip + 归档预览合计（0 次不显示；client/app/原型/样式 四端）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("(n.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-note-use dsh-nt'") >= 0, label + ' 行尾被引用徽章（0 次不显示）')
      assert(s.indexOf("(curNote.useCount || 0) > 0 ? e('span', { className: 'dsh-notes-meta-chip'") >= 0, label + ' 详情 meta chip（0 次不显示）')
      assert(s.indexOf("tt('meta.useCount', { n: curNote.useCount })") >= 0, label + ' 详情 meta chip「被引用 N 次」（i18n 覆盖卡B 起走 tt() 字典）')
      assert(s.indexOf("((g.totalUseCount || 0) > 0 ? tt('arch.groupUseCount', { n: g.totalUseCount }) : '')") >= 0, label + ' 归档预览组行合计引用数（0 次不显示；i18n 覆盖卡E 起走 tt() 字典）')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("(n.useCount || 0) > 0 ? '<span class=\"use\" title=\"") >= 0, label + ' 行尾被引用徽章（0 次不显示）')
      /* i18n 覆盖卡B：app 详情 chip 走 t() 字典；原型不双语保留中文原文（分侧断言） */
      if (label === 'app.html') assert(s.indexOf("t('meta.useCount', { n: n.useCount })") >= 0, label + ' 详情 meta chip「被引用 N 次」走 t()（覆盖卡B）')
      else assert(s.indexOf("'被引用 ' + n.useCount + ' 次</span>'") >= 0, label + ' 详情 meta chip「被引用 N 次」')
      /* i18n 覆盖卡E：app 归档预览合计走 t() 字典（esc 包裹）；原型不双语保留中文原文（分侧断言，同上行 chip 先例） */
      if (label === 'app.html') assert(s.indexOf("((g.totalUseCount || 0) > 0 ? esc(t('arch.groupUseCount', { n: g.totalUseCount })) : '')") >= 0, label + ' 归档预览组行合计引用数走 t()（覆盖卡E）')
      else assert(s.indexOf("((g.totalUseCount || 0) > 0 ? ' · 被引用 ' + g.totalUseCount + ' 次' : '')") >= 0, label + ' 归档预览组行合计引用数（0 次不显示）')
      assert(s.indexOf('.note-row .use{') >= 0 && s.indexOf('.note-row .use svg.ic{') >= 0, label + ' 行尾徽章样式')
    }
    // 徽章 tooltip 文案：app 走 t() 字典（i18n 覆盖卡A），原型不双语保留中文原文
    assert(appSrc.indexOf("(n.useCount || 0) > 0 ? '<span class=\"use\" title=\"' + esc(t('tree.useCountTip', { n: n.useCount }))") >= 0, 'app.html 行尾被引用徽章 tooltip 走 t() 字典（i18n 覆盖卡A）')
    assert(protoV2Src.indexOf('(n.useCount || 0) > 0 ? \'<span class="use" title="被 Agent 引用（note_get 命中）\'') >= 0, '原型 行尾被引用徽章 tooltip 中文原文（原型不双语红线）')
    // 原型 mock 演示数据（徽章/合计在原型可见）
    assert(protoV2Src.indexOf('useCount: 12') >= 0 && protoV2Src.indexOf('useCount: 7') >= 0 && protoV2Src.indexOf('useCount: 3') >= 0, '原型 mock 演示数据含 useCount')
    assert(protoV2Src.indexOf('totalUseCount: ms.reduce(') >= 0, '原型 mock 归档 preview 合计')
    const cssDev30 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg30 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev30], ['发布包 lib/styles.css', cssPkg30]]) {
      assert(pair[1].indexOf('.dsh-notes-note-use{') >= 0 && pair[1].indexOf('.dsh-notes-note-use .dsh-ic{') >= 0, pair[0] + ' 缺被引用徽章样式')
    }
  })
  Object.assign(S, { fsMockU, handlersU, harnessMockU, storeU })
  }
}
