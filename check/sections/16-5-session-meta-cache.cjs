// 节 16.5 0.1.7 会话元数据缓存（派发会话列表提速）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "16.5",
  title: "16.5 0.1.7 会话元数据缓存（派发会话列表提速）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { admMock, agentsMock, fsMock, llmMock, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, systemPromptMock, workspaceRegistryMock } = S
  // ===== 16.5 0.1.7 会话元数据缓存（notes-dispatch-slow-fix：128s 超时空白修复） =====
  section('16.5 0.1.7 会话元数据缓存（派发会话列表提速）')
  await t('host-impl 含会话元数据缓存结构（模块级 Map + TTL 10min + 后台补齐）', () => {
    assert(/const SESS_META_TTL = 10 \* 60 \* 1000/.test(hostSrc), 'SESS_META_TTL = 10min 常量（模块级）')
    assert(/const sessMetaCache = new Map\(\)/.test(hostSrc), 'sessMetaCache 模块级 Map')
    assert(hostSrc.indexOf('async function _fillSessMeta(missIds)') >= 0, '_fillSessMeta 后台批量读（串行化）')
    assert(hostSrc.indexOf('sessMetaFillRunning') >= 0, '批量读串行化守卫')
    assert(hostSrc.indexOf('titlesPending: true') >= 0 && hostSrc.indexOf('pendingIds: bgIds') >= 0, 'RPC 返回 titlesPending + pendingIds')
    assert(hostSrc.indexOf('pendingSessions') >= 0, 'RPC 返回 pendingSessions 占位条目')
  })
  await t('index.mjs 双边同步同款缓存结构', () => {
    assert(/const SESS_META_TTL = 10 \* 60 \* 1000/.test(indexSrc), 'SESS_META_TTL = 10min 常量（模块级）')
    assert(/const sessMetaCache = new Map\(\)/.test(indexSrc), 'sessMetaCache 模块级 Map')
    assert(indexSrc.indexOf('async function _fillSessMeta(missIds)') >= 0, '_fillSessMeta 后台批量读')
    assert(indexSrc.indexOf('titlesPending: true') >= 0 && indexSrc.indexOf('pendingIds: bgIds') >= 0, 'RPC 返回 titlesPending + pendingIds')
    assert(indexSrc.indexOf('(await _activeSessions()).sessions.map') >= 0, 'note_manage dispatch 取 .sessions（新返回形态）')
    assert(hostSrc.indexOf('(await _activeSessions()).sessions.map') >= 0, 'host-impl note_manage dispatch 同步取 .sessions')
  })

  // --- 行为断言：全新实例（独立 harness/fs/计数 mock），冷热缓存计数确定 ---
  // mock 工作区：abc12345=live（实时，不走 readTitleSnapshots）、sub9900000=非 live 子 agent（读盘路径）、arch00000=已归档（entries 阶段排除）
  const mkCacheCtx = (sq, wr) => ({
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: systemPromptMock, sessionPersistence: sessionPersistenceMock, workspaceRegistry: wr || workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sq })[name],
    effect: () => {},
  })
  const mkHarness = (h) => ({ handle: (name, fn) => { h[name] = fn; return () => { delete h[name] } }, defineTool: (d) => d, registerTool: () => () => {} })

  let cacheReadsA = 0
  const sqA = { readTitleSnapshots: async (sids) => { cacheReadsA++; return sessionQueryMock.readTitleSnapshots(sids) } }
  const handlersA = {}
  new Function('harness', 'pluginDir', hostSrc)(mkHarness(handlersA), DIR).apply(mkCacheCtx(sqA))
  // 注意：sqA 包装 sessionQueryMock 会同时计 io.sharedTitleReads；本区只用 cacheReadsA/B/C 做断言
  await t('冷缓存首次调用：立即返回 live 会话 + titlesPending/pendingIds（不阻塞首屏）', async () => {
    const r = await handlersA['notes-active-sessions']({})
    assert(Array.isArray(r.sessions) && r.sessions.length === 1 && r.sessions[0].short === 'abc12345', 'live 会话同步实时返回（实得 ' + JSON.stringify(r.sessions) + '）')
    assert.strictEqual(r.titlesPending, true, '冷缓存响应带 titlesPending')
    assert(Array.isArray(r.pendingIds) && r.pendingIds.length === 1 && r.pendingIds[0].indexOf('sub9900000') >= 0, 'pendingIds = 未命中非 live 会话（实得 ' + JSON.stringify(r.pendingIds) + '）')
    assert(Array.isArray(r.pendingSessions) && r.pendingSessions.length === 1 && r.pendingSessions[0].workspace === 'deepseek-work' && r.pendingSessions[0].id.indexOf('sub9900000') >= 0, 'pendingSessions 占位条目带 workspace/id（实得 ' + JSON.stringify(r.pendingSessions) + '）')
    assert.strictEqual(cacheReadsA, 1, '未命中会话后台触发一次批量读（实得 ' + cacheReadsA + '）')
  })
  await t('缓存命中：第二次调用零 readTitleSnapshots 增量 + 无 titlesPending', async () => {
    const before = cacheReadsA
    const r = await handlersA['notes-active-sessions']({})
    assert.strictEqual(cacheReadsA, before, '第二次调用不再触发 readTitleSnapshots（增量须为 0，实得 ' + (cacheReadsA - before) + '）')
    assert(!r.titlesPending, '缓存全命中不带 titlesPending')
    assert(r.sessions.length === 1 && r.sessions[0].short === 'abc12345', 'subagent 按缓存 origin 过滤，列表稳定（实得 ' + JSON.stringify(r.sessions) + '）')
  })
  await t('TTL 过期重读（补丁实例 10min→80ms）：旧标题兜底展示 + 后台刷新 + titlesPending 复现', async () => {
    const ttlSrc = hostSrc.replace('const SESS_META_TTL = 10 * 60 * 1000', 'const SESS_META_TTL = 80')
    assert(ttlSrc.indexOf('const SESS_META_TTL = 80') >= 0 && ttlSrc !== hostSrc, 'TTL 补丁生效')
    let cacheReadsB = 0
    const sqB = { readTitleSnapshots: async (sids) => { cacheReadsB++; return sessionQueryMock.readTitleSnapshots(sids) } }
    // 专属工作区：1 live（abc12345）+ 1 非 live 普通会话（ddd11111，非 subagent，标题走缓存）
    const wrB = { archivedSessionIds: [], list: () => [{ id: 'wsB', title: 'deepseek-work', path: 'D:\\deepseek-work', sessionIds: ['session-abc12345-0000-0000-0000-000000000000', 'session-ddd11111-0000-0000-0000-000000000000'] }] }
    const handlersB = {}
    new Function('harness', 'pluginDir', ttlSrc)(mkHarness(handlersB), DIR).apply(mkCacheCtx(sqB, wrB))
    const c1 = await handlersB['notes-active-sessions']({})
    assert.strictEqual(cacheReadsB, 1, '冷缓存首次触发批量读（实得 ' + cacheReadsB + '）')
    assert.strictEqual(c1.titlesPending, true, '冷缓存响应带 titlesPending')
    assert(c1.sessions.length === 1 && c1.sessions[0].short === 'abc12345', '冷首屏仅 live 会话同步返回')
    assert(c1.pendingIds.some(id => id.indexOf('ddd11111') >= 0), 'pendingIds 含持久会话')
    const c2 = await handlersB['notes-active-sessions']({})
    assert.strictEqual(cacheReadsB, 1, 'TTL 内命中不重读（实得 ' + cacheReadsB + '）')
    assert(!c2.titlesPending, '命中无 titlesPending')
    assert(c2.sessions.length === 2 && c2.sessions.some(s => s.short === 'ddd11111' && s.name === '开发会话' && s.live === false), '持久会话按缓存标题展示（实得 ' + JSON.stringify(c2.sessions) + '）')
    await new Promise(r => setTimeout(r, 100))  // 越过 80ms TTL
    const c3 = await handlersB['notes-active-sessions']({})
    assert.strictEqual(cacheReadsB, 2, 'TTL 过期后台重读（实得 ' + cacheReadsB + '）')
    assert.strictEqual(c3.titlesPending, true, '过期刷新响应带 titlesPending')
    assert(c3.pendingIds.some(id => id.indexOf('ddd11111') >= 0), 'pendingIds 含过期会话')
    assert(c3.sessions.length === 2 && c3.sessions.some(s => s.short === 'ddd11111' && s.name === '开发会话'), '过期期间旧标题兜底展示（列表不空不闪）')
  })
  await t('notes-sessions 同源同形：冷缓存也带 titlesPending（注入范围浮层不空等）', async () => {
    let cacheReadsC = 0
    const sqC = { readTitleSnapshots: async (sids) => { cacheReadsC++; return sessionQueryMock.readTitleSnapshots(sids) } }
    const handlersC = {}
    new Function('harness', 'pluginDir', hostSrc)(mkHarness(handlersC), DIR).apply(mkCacheCtx(sqC))
    const r = await handlersC['notes-sessions']({})
    assert.strictEqual(r.titlesPending, true, 'notes-sessions 冷缓存同样 titlesPending')
    assert(r.sessions.some(s => s.short === 'abc12345'), 'live 会话同步返回')
    const r2 = await handlersC['notes-sessions']({})
    assert.strictEqual(cacheReadsC, 1, '第二次 notes-sessions 零重读（实得 ' + cacheReadsC + '）')
    assert(!r2.titlesPending && r2.sessions.length === 1, '命中后稳定：仅 live 主会话（subagent 过滤、archived 排除）')
  })
  await t('client 占位渲染 + titlesPending 轮询重拉（结构）', () => {
    assert(clientSrc.indexOf('标题加载中…') >= 0, '占位文案「短id · 标题加载中…」')
    assert(clientSrc.indexOf('titlesPending') >= 0 && clientSrc.indexOf('pendingSessions') >= 0, 'client 消费 titlesPending + pendingSessions')
    assert(clientSrc.indexOf('setDispatchPending') >= 0 && clientSrc.indexOf('setSessPending') >= 0, '派发对话框 + 注入范围浮层双占位状态')
    assert(clientSrc.indexOf('later(loadActiveSessions, 1500)') >= 0, '派发对话框 1.5s 轮询重拉（dispatchOpenRef 终止）')
    assert(clientSrc.indexOf('dispatchOpenRef') >= 0, '对话框开关镜像 ref（轮询终止条件）')
    assert(clientSrc.indexOf('pullSessList') >= 0 && clientSrc.indexOf('timer.timeout(pullSessList, 1500)') >= 0, '注入范围浮层 1.5s 轮询重拉（面板关闭终止）')
    assert(clientSrc.indexOf('disabled: !!s.pending') >= 0, '占位条目禁用态（不可勾选/不可选）')
  })
  Object.assign(S, { mkHarness })
  }
}
