// 节 127. 0.5.0 P1 rebuild 后台化（notes-051-rebuild-async：首建 >30s 同步 RPC 超前端 30s 护栏 → UI 误报「构建失败：响应超时」修复）
// 真机实证（2026-10-10 晨，用户重启后首点）：host rebuild 真跑（含首跑 24MB 模型下载+全库嵌入）总时长 >30s → 前端超时误报失败，
//   后台实际建完（status: indexed=171/171 pending=0）。
// 修法：①notes-vectors-rebuild 改异步——立即返回 {ok,started:true}，重建本体 _vectorsRebuildRun 独立 async 后台跑
//   （不挂 _vectorJobChain——status 轮询须快回）；并发重复点击去重（在跑 {ok,alreadyRunning:true}）；
//   ②双端 semDoBuild/doSemBuild 轮询承接：点了 → 立即「构建中」态 → 1.5s 节拍轮 status → building 消旗且 pending=0 成功态；
//   pendingError 非空 → sticky 报错（真失败才报）；③失败落 status.pendingError + lastBuiltAt 不盖章（新命名空间整弃、旧集保留）。
// 断言面：①host 源码锚点（dev/dist 双侧：在跑标记/去重/started/后台本体不挂链/status building 键/失败落 pendingError）；
//   ②行为级（bge 假推理缝闸门：闸门关闭期 RPC 仍立即返回 started = 后台化铁证 + 在跑去重 + building=true 可见 → 开闸爬满）；
//   ③失败路径（缝抛错 → started → 轮询 pendingError 带原因 + lastBuiltAt 不盖章 + 旧集保留）；④双端轮询承接锚（app/client/i18n）；
//   ⑤e2e mock 异步形态同步锚；⑥双变体逐字节一致回归。
// 红线：rebuild 内部分段嵌入/清挂起/put 语义不动；保存即嵌入 drain 不动；失败仍不自动重试。
module.exports = {
  id: "127",
  title: "127. 0.5.0 P1 rebuild 后台化（RPC 立即返回 + 后台重建 + 去重 + 失败落 pendingError + 双端轮询承接，notes-051-rebuild-async）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  section('127. 0.5.0 P1 rebuild 后台化（notes-051-rebuild-async）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const vsDev = read('src/host/kernel/vector-store.js')
  const vsDist = read('src/host/kernel/vector-store.dist.js')
  const srvDev = read('src/host/server.js')
  const srvDist = read('src/host/server.dist.js')
  const appSettings = read('src/app/modals/settings.js')
  const cliSettings = read('src/client/modals/settings.js')
  const mockSrc = read('scripts/e2e/server.cjs')

  // ===== 127.1 host 源码锚点（dev/dist 双侧 + server 双注册契约注释）=====
  await t('host 后台化源码锚点（dev/dist 双侧）：在跑标记 + 去重 + started 立即返回 + 后台本体不挂链 + status building 键 + 失败落 pendingError', () => {
    for (const [src, tag] of [[vsDev, 'dev'], [vsDist, 'dist']]) {
      assert(src.indexOf('let _vectorRebuilding = null') >= 0, tag + ' 后台重建在跑标记在案（status.building 数据源 + 并发去重闸）')
      assert(src.indexOf('if (_vectorRebuilding) return { ok: true, alreadyRunning: true, backend: _vectorRebuilding.backend }') >= 0, tag + ' 并发重复点击去重（alreadyRunning）')
      assert(src.indexOf('return { ok: true, started: true, backend: backend.id }') >= 0, tag + ' RPC 立即返回 {ok,started:true}（同步窗不等全量重建）')
      assert(src.indexOf('async function _vectorsRebuildRun(backend)') >= 0, tag + ' 重建本体 _vectorsRebuildRun 独立 async 在案')
      // 本体不挂 _vectorJobChain（status 轮询须快回——入链会被 status 的 await _vectorJobChain 整链堵死）；起跑等 in-flight 语义不动
      const runBody = src.slice(src.indexOf('async function _vectorsRebuildRun'), src.indexOf('// 状态（notes-vectors-status 入口）'))
      assert(runBody.indexOf('_vectorEnqueue') < 0, tag + ' 重建本体不挂 _vectorJobChain（后台独立 async）')
      assert(runBody.indexOf('await _vectorJobChain') >= 0, tag + ' 起跑等 in-flight 增量（R2 顺序一致语义不动）')
      assert(runBody.indexOf('_vectorPending = new Map()') >= 0 && runBody.indexOf('clearTimeout(_vectorDrainTimer)') >= 0, tag + ' 权威全量清挂起语义不动（R2 红线）')
      assert(src.indexOf('_vectorPendingErr = String((e && e.message) || e)   // 失败显性：status.pendingError 轮询拾起；不自动重试（红线不变）') >= 0, tag + ' 后台重建失败落 _vectorPendingErr（不自动重试红线不变）')
      assert(src.indexOf('building: !!_vectorRebuilding') >= 0, tag + ' status building 键在案（双端轮询承接信号源）')
      // 失败不盖章：lastBuiltAt 戳记只在本体成功路径（swap 前）——runBody 外不得另设
      assert(runBody.indexOf('ns.lastBuiltAt = new Date().toISOString()') >= 0, tag + ' lastBuiltAt 仅成功盖章（本体末段 swap 前）')
    }
    for (const [src, tag] of [[srvDev, 'server.js'], [srvDist, 'server.dist.js']]) {
      assert(src.indexOf('0.5.0 P1（notes-051-rebuild-async）：后台化') >= 0, tag + ' rebuild 注册契约注释同步（后台化口径）')
    }
    assert(hostSrc.indexOf('_vectorsRebuildRun') >= 0 && indexSrc.indexOf('_vectorsRebuildRun') >= 0, '双包拼接产物含 _vectorsRebuildRun（dev hostSrc / dist index.mjs 源）')
  })

  // ===== 127.2/127.3 行为断言（fresh host 实例 + bge 假推理缝闸门——真模型不进 CI）=====
  const NOTES_DIR_G = DIR + '\\notes'
  const store = new Map()
  const fsMock = {
    resolve: async (p) => p,
    stat: async (p) => { if (p === NOTES_DIR_G) return { dir: true }; if (store.has(p)) return { file: true }; const prefix = p + '\\'; for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }; return null },
    listDir: async (p) => { const prefix = p + '\\'; const out = []; for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) }); return out },
    readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
    writeText: async (p, c) => { store.set(p, c) },
  }
  const handlers = {}
  const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: S.llmMock, agentDefaultModel: S.admMock, agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply(ctx)
  const pollStatus = async () => {   // 与双端 UI 同口径的轮询承接：building 消旗返回终态
    for (let i = 0; i < 500; i++) {
      const st = await handlers['notes-vectors-status']({})
      if (st && st.building !== true) return st
      await new Promise(r => setTimeout(r, 10))
    }
    throw new Error('轮询超时：building 不消旗')
  }
  // 假推理缝闸门：关闭期嵌入悬挂（RPC 若同步等嵌入则永返不出——started 返回即后台化铁证）；可换失败态
  let gateOpen = true, inferFail = false, inferCalls = 0
  globalThis.__DSH_NOTES_BGE_INFER__ = async (batch) => {
    inferCalls++
    while (!gateOpen) await new Promise(r => setTimeout(r, 10))
    if (inferFail) throw new Error('假推理缝失败（模型未下载模拟）')
    return (batch || []).map(() => { const v = new Array(512).fill(0); v[0] = 1; return v })
  }
  try {
    await t('后台化铁证（闸门行为级）：嵌入悬挂期 rebuild RPC 仍立即返回 started + 在跑去重 alreadyRunning + status.building=true → 开闸轮询爬满', async () => {
      // 语义未启用先造数（不入队零成本口径）——排除 drain 防抖干扰，rebuild 唯一嵌入源
      await handlers['notes-create']({ title: 'P1甲', body: '后台化闸门正文甲' })
      await handlers['notes-create']({ title: 'P1乙', body: '后台化闸门正文乙' })
      await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'bge-small-zh-q8' } })
      gateOpen = false
      const callsAtStart = inferCalls
      const r1 = await handlers['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' })
      assert(r1 && r1.ok === true && r1.started === true && r1.backend === 'bge-small-zh-q8', '嵌入悬挂期 RPC 仍立即返回 started（同步窗不等工作——后台化铁证）')
      assert(typeof r1.indexed === 'undefined' && !r1.error, '同步窗不带构建结果/不报错（终态移交轮询）')
      const r2 = await handlers['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' })
      assert(r2 && r2.ok === true && r2.alreadyRunning === true && typeof r2.started === 'undefined', '在跑重复发起 → alreadyRunning 去重（并发双击不重复嵌入）')
      assert(inferCalls <= callsAtStart + 1, '去重后嵌入调用不翻倍（实得增量 ' + (inferCalls - callsAtStart) + '）')
      const stB = await handlers['notes-vectors-status']({})
      assert(stB && stB.building === true, '后台重建期 status.building=true（轮询信号源可见）')
      gateOpen = true   // 开闸 → 后台重建落定
      const st = await pollStatus()
      assert(st && st.building === false, '开闸后轮询完结：building 消旗')
      assert(st.indexed === 2 && st.indexable === 2 && st.pending === 0, 'indexed 爬满 indexed=indexable=2/pending=0（实得 ' + st.indexed + '/' + st.indexable + '）')
      assert(st.lastBuiltAt && Date.parse(st.lastBuiltAt) > 0, '成功盖章 lastBuiltAt')
      assert(st.pendingError === '', '成功路径 pendingError 清零')
    })

    await t('失败路径显性：缝抛错 → started 返回（RPC 不报错）→ 轮询 pendingError 带原因 + building 消旗 + lastBuiltAt 不盖章 + 旧集保留', async () => {
      const st0 = await handlers['notes-vectors-status']({})
      const stamp0 = st0.lastBuiltAt
      inferFail = true
      const rf = await handlers['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' })
      assert(rf && rf.ok === true && rf.started === true, '失败也立即返回 started（RPC 同步窗不携带失败——真失败经轮询拾起）')
      const st = await pollStatus()
      assert(st.building === false, '失败后 building 消旗（不卡构建中）')
      assert(typeof st.pendingError === 'string' && st.pendingError.indexOf('假推理缝失败') >= 0, 'status.pendingError 显性带出原因（实得 ' + st.pendingError + '）')
      assert(st.lastBuiltAt === stamp0, '失败不盖章（lastBuiltAt 保持上次成功戳）')
      assert(st.indexed === 2, '失败新命名空间整弃——旧集保留（indexed 仍 2，实得 ' + st.indexed + '）')
      assert(st.pending === 0, '失败不残留挂起（权威全量清挂起语义不动）')
      inferFail = false
      // 再次构建成功 → pendingError 清零（kickoff 清驻留）+ 重新盖章
      const r3 = await handlers['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' })
      assert(r3 && r3.ok === true && r3.started === true, '恢复后再建 started')
      const st2 = await pollStatus()
      assert(st2.pendingError === '' && st2.indexed === 2 && Date.parse(st2.lastBuiltAt) >= Date.parse(stamp0), '恢复后重排成功：pendingError 清零 + 重新盖章')
    })
  } finally { delete globalThis.__DSH_NOTES_BGE_INFER__ }

  // ===== 127.4 双端轮询承接锚（app + client + i18n 双字典）=====
  await t('双端轮询承接锚：app poll/client semPollBuild——pendingError→sticky 报错（真失败才报）+ building 消旗且 pending=0→成功 + 节拍上限兜底', () => {
    // app 端
    assert(appSettings.indexOf('var poll = function (n)') >= 0, 'app semDoBuild 内 poll 轮询体在案')
    assert(appSettings.indexOf("rpc('notes-vectors-status', {}).then(function (st) {\n      if (!semState || !semState.building) return;\n      if (st && st.error) { fail(new Error(String(st.error))); return; }\n      if (st && st.pendingError) { fail(new Error(String(st.pendingError))); return; }") >= 0, 'app 轮询：status 报错/pendingError → sticky 报错（真失败才报）')
    assert(appSettings.indexOf("st.building !== true && (st.pending || 0) === 0) { finish(); return; }") >= 0, 'app 成功条件 = building 消旗且 pending=0')
    assert(appSettings.indexOf('setTimeout(function () { poll(n + 1) }, 1500)') >= 0, 'app 1.5s 节拍')
    assert(appSettings.indexOf('poll(0);   /* 0.5.0 P1：started/alreadyRunning 后立即进轮询承接') >= 0, 'app rebuild started 后立即进轮询')
    assert(appSettings.indexOf('function semRenderStatus(pre)') >= 0 && appSettings.indexOf('semRenderStatus(st);') >= 0, 'app 状态行随拍刷新（预取直渲免重复 RPC——计数爬升承接）')
    // client 端
    assert(cliSettings.indexOf('const semPollBuild = (n) => {') >= 0, 'client semPollBuild 轮询体在案')
    assert(cliSettings.indexOf("if (st && st.pendingError) { setSemBuilding(false); setError(tt('settings.semanticBuildFailed', { msg: String(st.pendingError) }))") >= 0, 'client 轮询：pendingError → setError sticky（含原因）')
    assert(cliSettings.indexOf("st.building !== true && (st.pending || 0) === 0) { setSemBuilding(false); return }") >= 0, 'client 成功条件 = building 消旗且 pending=0')
    assert(cliSettings.indexOf('semPollTimer.current = setTimeout(() => semPollBuild(n + 1), 1500)') >= 0, 'client 1.5s 节拍（计时器登记引用）')
    assert(cliSettings.indexOf("host.call('notes-vectors-rebuild', { backend: semBackend || 'bge-small-zh-q8' }).then((res) => {\n          if (res && res.error) setError(tt('settings.semanticBuildFailed'") >= 0, 'client rebuild 结构化 error 仍走 sticky（RPC 层错误面不动）')
    assert(cliSettings.indexOf('semPollBuild(0)') >= 0, 'client rebuild started 后立即进轮询')
    assert(cliSettings.indexOf('clearTimeout(semPollTimer.current)') >= 0, 'client 卸载清轮询计时器（防泄漏）')
    // i18n 双字典：轮询节拍上限兜底键
    const zhSrc = read('src/i18n/zh.js'), enSrc = read('src/i18n/en.js')
    assert(zhSrc.indexOf("'settings.semanticBuildTimeout'") >= 0 && enSrc.indexOf("'settings.semanticBuildTimeout'") >= 0, 'zh/en 双字典 semanticBuildTimeout 键（节拍上限兜底文案）')
    assert(appSettings.indexOf("t('settings.semanticBuildTimeout')") >= 0 && cliSettings.indexOf("tt('settings.semanticBuildTimeout')") >= 0, '双端引用兜底键（零引用红线）')
  })

  // ===== 127.5 e2e mock 异步形态同步锚 =====
  await t('e2e mock 同步 rebuild 异步形态：立即返回 started + setTimeout 后台跑 + 去重桩 + 失败落 pendingError + status building 键', () => {
    assert(mockSrc.indexOf('if (state._vectorBuilding) return { ok: true, alreadyRunning: true, backend: state._vectorBuilding }') >= 0, 'mock rebuild 在跑去重（alreadyRunning）')
    assert(mockSrc.indexOf('state._vectorBuilding = bid') >= 0, 'mock 在跑标记登记')
    assert(mockSrc.indexOf('return { ok: true, started: true, backend: bid }') >= 0, 'mock rebuild 立即返回 started')
    assert(mockSrc.indexOf('state._vectorPendingError = String(state._vectorRebuildError)') >= 0, 'mock 失败桩落 _vectorPendingError（status.pendingError 轮询拾起——不再同步返回 error）')
    assert(mockSrc.indexOf('building: !!state._vectorBuilding') >= 0 && mockSrc.indexOf("pendingError: state._vectorPendingError || ''") >= 0, 'mock status building/pendingError 键（与 host 同契约）')
    assert(mockSrc.indexOf('state._vectorRebuildDelay || 20') >= 0, 'mock 重建节拍桩 _vectorRebuildDelay（用例 60 构建中态观测窗）')
  })

  // ===== 127.6 双变体逐字节一致回归 =====
  await t('双变体逐字节一致回归（P1 后台化改动双侧同步——VECTOR_FLUSH_MS 起切片口径）', () => {
    assert.strictEqual(vsDev.slice(vsDev.indexOf('const VECTOR_FLUSH_MS')), vsDist.slice(vsDist.indexOf('const VECTOR_FLUSH_MS')), 'vector-store dev/dist 逐字节一致（差异仅 VECTORS_PATH 行）')
  })
  }
}
