// 节 42. 列表韧性：_list 并集防御（list-union-defense）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "42",
  title: "42. 列表韧性：_list 并集防御（list-union-defense）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, fsMockU, handlers, handlersU, harnessMockU, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, storeU, workspaceRegistryMock } = S
  // ===== 42. 列表韧性：_list 并集防御（notes-list-union-defense） =====
  // 背景：DSH dsh-fs-local 冷启动期 listDir 快照对新建文件长期不可见（实测 30min+），面板/回收站/搜索全部走 _list 受波及。
  // 防御：_list 并集补入 cache 中不在本次目录列表里的非墓碑条目；红线索 = 补入条目与目录条目同一过滤管线 + 按 id 去重幂等 + 墓碑排除。
  section('42. 列表韧性：_list 并集防御（list-union-defense）')

  // --- 42.1 标记块双包逐字节一致 ---
  const grabUnionBlk = (s, tag) => { const m = s.match(/\/\/ ==== list-union-defense BEGIN ====[\s\S]*?\/\/ ==== list-union-defense END ====/); assert(m, tag + ' 缺 list-union-defense 标记块'); return m[0] }
  await t('list-union-defense 标记块双包逐字节一致（host-impl / index.mjs）', () => {
    assert.strictEqual(grabUnionBlk(indexSrc, 'index.mjs'), grabUnionBlk(hostSrc, 'host-impl.js'), 'host-impl.js 与 index.mjs 的 list-union-defense 块必须逐字节一致')
  })

  // --- 42.2 行为断言：停滞 listDir mock——store 真实落盘/读取正常，唯独 listDir 只报 visible 旧快照（复现上游症状）---
  function mkUnionHost() {
    const storeU = new Map()
    const visibleU = new Set()   // watcher 快照文件名集：新建文件不入集 = 停滞不可见；入集 = watcher 恢复
    const fsMockU = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeU.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeU.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0 && visibleU.has(k.slice(prefix.length))) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeU.has(p)) throw new Error('ENOENT: ' + p); return storeU.get(p) },
      writeText: async (p, c) => { storeU.set(p, c) },
    }
    const handlersU = {}
    const harnessMockU = { handle: (name, fn) => { handlersU[name] = fn; return () => {} }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockU, DIR).apply({
      fs: fsMockU, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ agents: agentsMock, systemPrompt: { context: () => () => {} } })[name],
      effect: () => {},
    })
    return { store: storeU, visible: visibleU, handlers: handlersU }
  }

  await t('并集补入：listDir 停滞窗口内新建笔记立即可见；watcher 恢复后幂等零重复', async () => {
    const U = mkUnionHost()
    // 旧笔记：停滞前已存在，watcher 快照可见（走 listDir 主循环）
    U.store.set(NOTES_DIR + '\\n-old-visible.md', '---\nid: n-old-visible\ntitle: 旧笔记\ntopic: 运维\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文\n')
    U.visible.add('n-old-visible.md')
    const c1 = await U.handlers['notes-create']({ title: '停滞窗口新笔记', body: 'x', topic: '开发' })
    assert(c1.id && !c1.error, '新建成功')
    assert(U.store.has(NOTES_DIR + '\\' + c1.id + '.md') && !U.visible.has(c1.id + '.md'), '新笔记已落盘但 listDir 快照不可见（停滞症状复现）')
    let ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf(c1.id) >= 0, '停滞窗口内新建笔记经并集补入可见')
    assert(ids.indexOf('n-old-visible') >= 0, '旧笔记照常可见')
    assert.strictEqual(ids.filter(x => x === c1.id).length, 1, '补入条目无重复行')
    // watcher 恢复（文件入快照）：listDir 主循环命中同一 cache 对象，并集按 id 去重 = 幂等空操作
    U.visible.add(c1.id + '.md')
    ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert.strictEqual(ids.filter(x => x === c1.id).length, 1, 'watcher 恢复后仍仅一行（主循环+并集不重复）')
    assert.strictEqual(ids.length, 2, '总数不变（实得 ' + ids.length + '：' + ids.join(',') + '）')
  })

  await t('并集条目同一过滤管线：deleted/log 隐身/tag/kind/folder 与目录条目零差异', async () => {
    const U = mkUnionHost()
    // 三条笔记全部停滞不可见（纯并集路径）：普通带标签 / 日志 / 待删
    const cA = await U.handlers['notes-create']({ title: '并集普通', body: 'x', tags: ['u1'] })
    const cB = await U.handlers['notes-create']({ title: '并集日志', body: 'x', kind: 'log' })
    const cC = await U.handlers['notes-create']({ title: '并集待删', body: 'x' })
    let ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf(cA.id) >= 0 && ids.indexOf(cC.id) >= 0, '普通并集条目缺省可见')
    assert(ids.indexOf(cB.id) < 0, 'kind=log 并集条目默认隐身（不开特例后门）')
    ids = (await U.handlers['notes-list']({ kind: 'log' })).notes.map(n => n.id)
    assert(ids.indexOf(cB.id) >= 0 && ids.indexOf(cA.id) < 0, '显式 kind=log 过滤放行日志并集条目（且只放行日志）')
    ids = (await U.handlers['notes-list']({ includeLogs: true })).notes.map(n => n.id)
    assert(ids.indexOf(cA.id) >= 0 && ids.indexOf(cB.id) >= 0, 'includeLogs 口径并集日志召回')
    ids = (await U.handlers['notes-list']({ tag: 'u1' })).notes.map(n => n.id)
    assert(ids.indexOf(cA.id) >= 0 && ids.indexOf(cC.id) < 0, 'tag 过滤对并集条目生效')
    // folder 过滤（含递归子树口径）：入夹并集条目仅在该夹视图可见，未分类/他夹视图排除
    const f1 = (await U.handlers['notes-folders']({ op: 'create', name: '并集夹' })).folder
    const f2 = (await U.handlers['notes-folders']({ op: 'create', name: '并集子夹', parent: f1.id })).folder
    const cF = await U.handlers['notes-create']({ title: '并集入夹', body: 'x', folder: f2.id })
    assert(!U.visible.has(cF.id + '.md'), '入夹笔记同样停滞不可见（纯并集路径）')
    ids = (await U.handlers['notes-list']({ folder: f1.id })).notes.map(n => n.id)
    assert(ids.indexOf(cF.id) >= 0, 'folder=父夹：递归子树口径并集条目可见')
    ids = (await U.handlers['notes-list']({ folder: f2.id })).notes.map(n => n.id)
    assert(ids.indexOf(cF.id) >= 0, 'folder=本夹：并集条目可见')
    ids = (await U.handlers['notes-list']({ folder: '' })).notes.map(n => n.id)
    assert(ids.indexOf(cF.id) < 0 && ids.indexOf(cA.id) >= 0, 'folder=未分类：入夹并集条目排除、未入夹可见')
    // R-6：folder 过滤隐式含 log（并集条目同一过滤管线）——未分类日志在 folder:'' 视图召回；夹内日志在夹视图（递归子树）召回
    assert(ids.indexOf(cB.id) >= 0, 'R-6：folder=未分类视图含并集日志条目（显式导航放行）')
    const cL = await U.handlers['notes-create']({ title: '并集夹内日志', body: 'x', kind: 'log', folder: f2.id })
    ids = (await U.handlers['notes-list']({ folder: f1.id })).notes.map(n => n.id)
    assert(ids.indexOf(cL.id) >= 0 && ids.indexOf(cF.id) >= 0, 'R-6：folder=父夹递归子树含并集日志 + 普通条目')
    ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf(cL.id) < 0 && ids.indexOf(cB.id) < 0, 'R-6：默认列表（隐式表面）仍排除全部并集日志')
    // 软删：缺省列表排除；回收站（includeDeleted）口径可见
    await U.handlers['notes-delete']({ id: cC.id })
    ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf(cC.id) < 0, '软删后并集条目缺省排除')
    ids = (await U.handlers['notes-list']({ includeDeleted: true })).notes.map(n => n.id)
    assert(ids.indexOf(cC.id) >= 0, '回收站口径并集软删条目可见')
  })

  await t('并集墓碑排除：purge 后缺省/回收站口径均不出现（含缓存墓碑条目）', async () => {
    const U = mkUnionHost()
    // 路径一：插件内 purge —— cache.delete 逐出 + 0 字节墓碑文件停滞不可见
    const c1 = await U.handlers['notes-create']({ title: '待彻底删除', body: 'x' })
    await U.handlers['notes-delete']({ id: c1.id })
    const pg = await U.handlers['notes-purge']({ id: c1.id })
    assert(pg.purged === true, 'purge 成功（实得 ' + JSON.stringify(pg) + '）')
    let ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf(c1.id) < 0, 'purge 后缺省列表不出现')
    ids = (await U.handlers['notes-list']({ includeDeleted: true })).notes.map(n => n.id)
    assert(ids.indexOf(c1.id) < 0, 'purge 后回收站口径也不出现')
    // 路径二：缓存墓碑条目——0 字节墓碑文件停滞不可见，经 notes-get 读入 cache 标 tombstoned → 并集必须排除
    U.store.set(NOTES_DIR + '\\n-tomb-cached.md', '')
    const gT = await U.handlers['notes-get']({ id: 'n-tomb-cached' })   // 读入 cache 并标 tombstoned（返回 error 属预期）
    assert(gT.error, '墓碑 get 拒绝（实得 ' + JSON.stringify(gT) + '）')
    ids = (await U.handlers['notes-list']({})).notes.map(n => n.id)
    assert(ids.indexOf('n-tomb-cached') < 0, 'cache 中 tombstoned 条目缺省列表排除')
    ids = (await U.handlers['notes-list']({ includeDeleted: true })).notes.map(n => n.id)
    assert(ids.indexOf('n-tomb-cached') < 0, 'cache 中 tombstoned 条目回收站口径同样排除')
  })

  await t('静态包并集防御：停滞窗口新建笔记可见 + watcher 恢复幂等（index.mjs 行为）', async () => {
    const storeU2 = new Map()
    const visibleU2 = new Set()
    const fsMockU2 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (storeU2.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeU2.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0 && visibleU2.has(k.slice(prefix.length))) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeU2.has(p)) throw new Error('ENOENT: ' + p); return storeU2.get(p) },
      writeText: async (p, c) => { storeU2.set(p, c) },
    }
    const routesU2 = []
    const modU2 = await import(pathToFileURL(INDEX_PATH).href + '?uniondef=1')
    modU2.apply({
      fs: fsMockU2, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routesU2.push(r); return () => {} } },
      tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    function rpcU2(method, args) {
      return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routesU2[0].handler(req, res)).catch(reject)
      })
    }
    const c = await rpcU2('notes-create', { title: '静态停滞新笔记', body: 'x' })
    assert(c.body && c.body.id, '静态包新建成功（实得 ' + JSON.stringify(c.body) + '）')
    assert(storeU2.has(path.join(NOTES_ROOT_STATIC, c.body.id + '.md')) && !visibleU2.has(c.body.id + '.md'), '已落盘但快照不可见')
    let ids = (await rpcU2('notes-list', {})).body.notes.map(n => n.id)
    assert(ids.indexOf(c.body.id) >= 0, '静态包：停滞窗口新建笔记经并集补入可见')
    visibleU2.add(c.body.id + '.md')
    ids = (await rpcU2('notes-list', {})).body.notes.map(n => n.id)
    assert.strictEqual(ids.filter(x => x === c.body.id).length, 1, '静态包：watcher 恢复后幂等零重复')
    assert.strictEqual(ids.length, 1, '静态包：总数不变（实得 ' + ids.length + '）')
  })
  }
}
