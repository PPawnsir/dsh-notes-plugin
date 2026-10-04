// 节 37. LLM token 用量统计（计量包装 + usage.json + notes-usage-get + 预算提醒）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "37",
  title: "37. LLM token 用量统计（计量包装 + usage.json + notes-usage-get + 预算提醒）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, ctx, fsMockS, g, protoV2Src, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, storeS, workspaceRegistryMock } = S
  // ===== 37. LLM token 用量统计（llm-usage 计量包装 + usage.json 落盘 + notes-usage-get + 预算提醒） =====
  section('37. LLM token 用量统计（计量包装 + usage.json + notes-usage-get + 预算提醒）')

  // ---- 37.1 结构契约（双包同步 + 零侵入红线）----
  await t('llm-usage 标记块双包逐字节一致 + 三调用点计量包装挂载（classify×2 + organize）', () => {
    const grabBlk = (s) => { const m = s.match(/\/\/ ==== llm-usage BEGIN ====[\s\S]*?\/\/ ==== llm-usage END ====/); return m ? m[0] : '' }
    const blkDev = grabBlk(hostSrc), blkPkg = grabBlk(indexSrc)
    assert(blkDev.length > 100, 'host-impl 缺 llm-usage 标记块')
    assert.strictEqual(blkPkg, blkDev, 'host-impl.js 与 index.mjs 的 llm-usage 块必须逐字节一致')
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert.strictEqual((s.match(/await streamMetered\('/g) || []).length, 3, label + ' 计量包装挂 3 个调用点（实得 ' + (s.match(/await streamMetered\('/g) || []).length + '）')
      assert.strictEqual((s.match(/await streamMetered\('classify', \{/g) || []).length, 2, label + ' classify 两处（classifyTopic + extractInstruction）')
      assert.strictEqual((s.match(/await streamMetered\('organize', \{/g) || []).length, 1, label + ' organize 一处（_aiOrganize）')
      assert(s.indexOf("else if (chunk && chunk.type === 'usage')") >= 0, label + ' streamMetered 捕获 usage chunk（dsh-llm 契约：finish 前 emit）')
      // 零侵入红线：只包装调用点，不改写 llm 通道本身
      assert(!/llm\.stream\s*=/.test(s), label + ' 不改写 llm.stream 通道本身（计量零侵入）')
    }
  })
  await t('host 双侧：usage.json 独立落盘 + 5s 防抖 + 卸载 flush + 估算系数 + RPC + 预算键', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const USAGE_FLUSH_MS = 5000') >= 0, label + ' 5s 防抖常量')
      assert(s.indexOf('const USAGE_EST_CHARS_PER_TOKEN = 1.6') >= 0, label + ' 1.6 字符估算系数（中文≈1.6 字符/token）')
      assert(s.indexOf('async function recordUsage(feature, usage, inChars, outChars)') >= 0, label + ' recordUsage 记账函数')
      assert(s.indexOf('async function streamMetered(feature, options)') >= 0, label + ' streamMetered 计量包装')
      assert(s.indexOf('function usageReport()') >= 0, label + ' usageReport 报表函数')
      assert(s.indexOf("handle('notes-usage-get'") >= 0, label + ' notes-usage-get RPC 注册')
      assert(s.indexOf("'usageBudgetMonthly' in patch") >= 0, label + ' settings-set 预算键 usageBudgetMonthly')
      assert(s.indexOf('flushUsage()       // 卸载 flush') >= 0, label + ' 插件卸载 flush（ctx.effect dispose）')
      assert(s.indexOf('typeof usageTimer.unref') >= 0, label + ' timer unref（防抖不阻塞进程退出）')
    }
    assert(hostSrc.indexOf("NOTES_DIR + '\\\\usage.json'") >= 0, '开发版 usage.json 落在 notes 目录（独立于 settings.json）')
    assert(indexSrc.indexOf("path.join(NOTES_ROOT, 'usage.json')") >= 0, '静态包 usage.json 落在 ~/.dsh/notes')
  })

  // ---- 37.2 行为级（开发版独立实例 storeV + usage chunk mock llm；dispose 触发防抖 flush，不真实等 5s）----
  const storeV = new Map()
  let writesV = 0
  const fsMockV = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeV.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeV.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeV.has(p)) throw new Error('ENOENT: ' + p); return storeV.get(p) },
    writeText: async (p, c) => { writesV++; storeV.set(p, c) },
  }
  // usage mock llm：按 system 提示分流三功能，均在 finish 前 emit usage chunk（dsh-llm 契约）
  const llmMockV = {
    stream: async function* (req) {
      const sys = (req && req.system) || ''
      if (sys.indexOf('元数据') >= 0) {
        yield { type: 'text-delta', text: '{"tags":[],"titleHint":"指令标题","kind":"note","inject":false}' }
        yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }
        yield { type: 'finish' }
      } else if (sys.indexOf('笔记整理助手') >= 0) {
        yield { type: 'text-delta', text: '## 背景\n\n整理后正文\n' }
        yield { type: 'usage', usage: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 } }
        yield { type: 'finish' }
      } else {
        yield { type: 'text-delta', text: '运维' }
        yield { type: 'usage', usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } }
        yield { type: 'finish' }
      }
    }
  }
  const handlersV = {}
  const effectsV = []
  const harnessMockV = { handle: (name, fn) => { handlersV[name] = fn; return () => { delete handlersV[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockV, DIR).apply({
    fs: fsMockV, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMockV, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: (fn) => { effectsV.push(fn) },
  })
  const flushMicro37 = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  await t('notes-usage-get：三功能分别计数 + today/week/month/allTime/byFeature 结构 + usage.json 防抖落盘', async () => {
    // ① quick → 异步分类（classify=60，真实 usage）
    await handlersV['notes-quick']({ text: '用量统计速记', sessionId: 'sess-usage-1' })
    await new Promise(r => setTimeout(r, 150))
    let u = await handlersV['notes-usage-get']({})
    assert(!u.error, 'RPC 无错误（实得 ' + JSON.stringify(u).slice(0, 120) + '）')
    for (const k of ['today', 'week', 'month', 'allTime', 'byFeature', 'estimatedTokens', 'exactTokens', 'calls']) assert(k in u, '返回缺字段 ' + k)
    assert.strictEqual(u.today.classify, 60, '分类真实 usage 计数 60（实得 ' + u.today.classify + '）')
    assert.strictEqual(u.today.total, 60); assert.strictEqual(u.calls, 1, 'calls=1')
    assert.strictEqual(u.byFeature.classify.today, 60, 'byFeature.classify.today=60')
    assert.strictEqual(u.byFeature.organize.allTime, 0, '整理未计数')
    assert.strictEqual(u.byFeature.summarize.allTime, 0, '总结未计数')
    assert.strictEqual(u.week.total, 60, 'week=今日（单日数据）')
    assert.strictEqual(u.month.total, 60, 'month=当月累计（预算提醒口径）')
    assert.strictEqual(u.allTime.total, 60)
    assert.strictEqual(u.estimatedTokens, 0, '真实值不进估算')
    assert.strictEqual(u.exactTokens, 60, 'exactTokens=60')
    // ② quick-instruct（指令提取计入 classify；mock 带 titleHint 不再触发异步分类）
    await handlersV['notes-quick-instruct']({ text: '选区原文内容', note: '这是待办', sessionId: 'sess-usage-2' })
    u = await handlersV['notes-usage-get']({})
    assert.strictEqual(u.today.classify, 180, '指令提取计入 classify（60+120，实得 ' + u.today.classify + '）')
    assert.strictEqual(u.calls, 2, 'calls=2')
    // ③ ai-organize（organize=1000）
    const ao = await handlersV['notes-ai-organize']({ body: '草稿正文内容', kind: 'note' })
    assert(!ao.error, '整理成功（实得 ' + JSON.stringify(ao).slice(0, 120) + '）')
    u = await handlersV['notes-usage-get']({})
    assert.strictEqual(u.today.organize, 1000, 'organize 计数 1000（实得 ' + u.today.organize + '）')
    assert.strictEqual(u.byFeature.organize.allTime, 1000, 'byFeature.organize.allTime=1000')
    assert.strictEqual(u.today.total, 1180, 'total=1180（实得 ' + u.today.total + '）')
    assert.strictEqual(u.week.total, 1180); assert.strictEqual(u.month.total, 1180); assert.strictEqual(u.allTime.total, 1180)
    assert.strictEqual(u.calls, 3, 'calls=3')
    assert.strictEqual(u.exactTokens, 1180, 'exactTokens=1180')
    // ④ usage.json 防抖落盘：dispose 前零落盘，卸载 flush 立即写盘（结构 {daily, allTime, estimatedTokens, exactTokens, calls}）
    assert(!storeV.has(NOTES_DIR + '\\usage.json'), '防抖窗口内 usage.json 未落盘（5s 防抖未到期）')
    const disposeV = effectsV[0]()
    disposeV()
    await flushMicro37()
    const raw = storeV.get(NOTES_DIR + '\\usage.json')
    assert(raw, '卸载 flush 落盘 usage.json')
    const disk = JSON.parse(raw)
    const nowD = new Date()
    const todayKey = nowD.getFullYear() + '-' + ('0' + (nowD.getMonth() + 1)).slice(-2) + '-' + ('0' + nowD.getDate()).slice(-2)
    assert(disk.daily && disk.daily[todayKey], '落盘含今日 daily 键 ' + todayKey)
    assert.strictEqual(disk.daily[todayKey].classify, 180, '落盘 daily.classify=180')
    assert.strictEqual(disk.daily[todayKey].organize, 1000, '落盘 daily.organize=1000')
    assert.strictEqual(disk.daily[todayKey].total, 1180, '落盘 daily.total=1180')
    assert.strictEqual(disk.allTime.total, 1180, '落盘 allTime.total=1180')
    assert.strictEqual(disk.calls, 3, '落盘 calls=3')
    assert.strictEqual(disk.exactTokens, 1180, '落盘 exactTokens=1180')
    // 落盘后再读：新实例视角由 37.2c 静态包用例覆盖（加载合并路径）
  })
  await t('估算兜底：adapter 未回 usage chunk 时按字符估算（1.6 系数）+ estimatedTokens 累计', async () => {
    const storeE = new Map()
    const fsMockE = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeE.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeE.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeE.has(p)) throw new Error('ENOENT: ' + p); return storeE.get(p) },
      writeText: async (p, c) => { storeE.set(p, c) },
    }
    const llmMockNoUsage = { stream: async function* () { yield { type: 'text-delta', text: '开发' }; yield { type: 'finish' } } }
    const handlersE = {}
    const harnessMockE = { handle: (name, fn) => { handlersE[name] = fn; return () => { delete handlersE[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockE, DIR).apply({
      fs: fsMockE, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMockNoUsage, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    await handlersE['notes-quick']({ text: '估算速记', sessionId: 'sess-est-1' })
    await new Promise(r => setTimeout(r, 150))
    const u = await handlersE['notes-usage-get']({})
    assert(u.today.classify > 0, '估算计数 >0（实得 ' + u.today.classify + '）')
    assert.strictEqual(u.estimatedTokens, u.today.total, '全部计入估算（estimatedTokens=total）')
    assert.strictEqual(u.exactTokens, 0, '无真实值')
    assert.strictEqual(u.calls, 1, 'calls=1')
    // 预算键校验（复用本实例，无 llm 介入）：非负整数直存 / 非法报错 / null 删除恢复关闭
    const bad = await handlersE['notes-settings-set']({ usageBudgetMonthly: 'x' })
    assert(bad.error && bad.error.indexOf('usageBudgetMonthly') >= 0, '字符串报错（实得 ' + JSON.stringify(bad) + '）')
    const bad2 = await handlersE['notes-settings-set']({ usageBudgetMonthly: -5 })
    assert(bad2.error && bad2.error.indexOf('usageBudgetMonthly') >= 0, '负数报错')
    const ok = await handlersE['notes-settings-set']({ usageBudgetMonthly: 50000 })
    assert(ok.ok === true, '保存成功')
    assert.strictEqual(JSON.parse(storeE.get(NOTES_DIR + '\\settings.json')).usageBudgetMonthly, 50000, 'settings.json 落盘 usageBudgetMonthly')
    const ok2 = await handlersE['notes-settings-set']({ usageBudgetMonthly: null })
    assert(ok2.ok === true && !('usageBudgetMonthly' in ok2.settings), 'null 删除 override 恢复关闭提醒')
  })

  // ---- 37.2c 静态包行为（index.mjs 独立 ESM 实例 + webServer 路由链路；含 usage.json 读回合并）----
  await t('静态包：计量包装三功能计数 + notes-usage-get + 预算键校验 + usage.json 存量读回（rpc 路由链路）', async () => {
    const storeS = new Map()
    const fsMockS = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (storeS.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeS.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeS.has(p)) throw new Error('ENOENT: ' + p); return storeS.get(p) },
      writeText: async (p, c) => { storeS.set(p, c) },
    }
    // 存量 usage.json：上月历史 5000 tokens（allTime 累计口径验证：month 不含上月，allTime 含）
    const histDay = '2020-01-15'
    storeS.set(path.join(NOTES_ROOT_STATIC, 'usage.json'), JSON.stringify({
      daily: { [histDay]: { classify: 2000, organize: 3000, summarize: 0, total: 5000 } },
      allTime: { classify: 2000, organize: 3000, summarize: 0, total: 5000 },
      estimatedTokens: 0, exactTokens: 5000, calls: 9
    }, null, 2))
    const routesS = []
    const effectsS = []
    const ctxS = {
      fs: fsMockS, sandboxPolicy: { resolve: () => ({}) },
      webServer: { register: (r) => { routesS.push(r); return () => {} } },
      tools: { register: () => () => {} },
      get: (name) => ({ llm: llmMockV, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: (fn) => { effectsS.push(fn) },
    }
    // 真实静态包环境没有 harness Builtin —— 摘掉还原真实条件
    const harnessBackup37 = global.harness
    delete global.harness
    try {
      const modS = await import(pathToFileURL(INDEX_PATH).href + '?llm-usage=1')
      modS.apply(ctxS)
      const rpcS = (method, args) => new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify({ method: method, args: args }))
        const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
        const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
        Promise.resolve(routesS[0].handler(req, res)).catch(reject)
      })
      // 存量读回：allTime 含历史 5000，month/today 不含
      let u = (await rpcS('notes-usage-get', {})).body
      assert.strictEqual(u.allTime.total, 5000, '存量 usage.json 读回 allTime=5000（实得 ' + u.allTime.total + '）')
      assert.strictEqual(u.calls, 9, '存量 calls=9')
      assert.strictEqual(u.today.total, 0, 'today 不含历史')
      assert.strictEqual(u.month.total, 0, 'month 不含上月历史（预算口径=当月）')
      // 计量包装：quick 异步分类 + ai-organize
      await rpcS('notes-quick', { text: '静态包用量速记', sessionId: 'sess-usage-s' })
      await new Promise(r => setTimeout(r, 150))
      const ao = (await rpcS('notes-ai-organize', { body: '静态包草稿', kind: 'note' })).body
      assert(!ao.error, '静态包整理成功（实得 ' + JSON.stringify(ao).slice(0, 120) + '）')
      u = (await rpcS('notes-usage-get', {})).body
      assert.strictEqual(u.today.classify, 60, '静态包分类计数 60（实得 ' + u.today.classify + '）')
      assert.strictEqual(u.today.organize, 1000, '静态包整理计数 1000（实得 ' + u.today.organize + '）')
      assert.strictEqual(u.allTime.total, 6060, 'allTime=历史5000+新增1060（实得 ' + u.allTime.total + '）')
      assert.strictEqual(u.calls, 11, 'calls=9+2（实得 ' + u.calls + '）')
      // 预算键校验 + 落盘 settings.json
      const bad = (await rpcS('notes-settings-set', { usageBudgetMonthly: 'x' })).body
      assert(bad.error && bad.error.indexOf('usageBudgetMonthly') >= 0, '静态包预算键非法值报错')
      const ok = (await rpcS('notes-settings-set', { usageBudgetMonthly: 80000 })).body
      assert(ok.ok === true, '静态包预算保存成功')
      assert.strictEqual(JSON.parse(storeS.get(path.join(NOTES_ROOT_STATIC, 'settings.json'))).usageBudgetMonthly, 80000, '静态包 settings.json 落盘预算键')
      // 卸载 flush：防抖窗口内的新增计数写回 usage.json（与存量合并）
      const disposeS = effectsS[0]()
      disposeS()
      await flushMicro37()
      const disk = JSON.parse(storeS.get(path.join(NOTES_ROOT_STATIC, 'usage.json')))
      assert.strictEqual(disk.allTime.total, 6060, '静态包卸载 flush 落盘 allTime=6060（实得 ' + disk.allTime.total + '）')
      assert.strictEqual(disk.calls, 11, '静态包落盘 calls=11')
    } finally {
      global.harness = harnessBackup37
    }
  })

  // ---- 37.3 client 设置卡片（client-impl + 发布包 lib/client.js 同步 + toast 提醒链路）----
  await t('设置卡片「LLM 用量」+「用量预算提醒」两行（client-impl + 发布包 lib/client.js 同步 + 超预算 toast 不阻断）', () => {
    assert(/key: 'usage', label: tt\('settings\.usage'\)/.test(clientSrc), 'settingsRows 含「LLM 用量」行（覆盖卡 C 起 label 走 tt() 字典）')
    assert(/key: 'usagebudget', label: tt\('settings\.usageBudget'\)/.test(clientSrc), 'settingsRows 含「用量预算提醒」行（覆盖卡 C 起 label 走 tt() 字典）')
    assert(clientSrc.indexOf("host.call('notes-usage-get', {})") >= 0, 'openSettings 拉取 notes-usage-get（独立 RPC 不拖慢主链路）')
    assert(clientSrc.indexOf("settingsSetQuiet({ usageBudgetMonthly: v })") >= 0, '预算保存链路 settings-set 通道 usageBudgetMonthly（settingsSetQuiet 低层通道）')
    assert(clientSrc.indexOf('已超预算 ') >= 0 && clientSrc.indexOf('（仅提醒，不阻断）') >= 0, '超预算 toast 文案（仅提醒，不阻断）')
    assert(clientSrc.indexOf('（含字符估算，约）') >= 0, '估算标注「约」文案')
    assert(clientSrc.indexOf('const fmtTok = ') >= 0, 'fmtTok token 人性化函数')
    assert(clientSrc.indexOf('usageData.byFeature.classify.allTime') >= 0, '按功能分列读 byFeature')
    assert(clientSrc.indexOf('usageBudgetRef') >= 0, '预算 ref 镜像（settings/usage 并发放射防闭包过期）')
    for (const k of ['LLM 用量', '用量预算提醒', 'notes-usage-get', 'usageBudgetMonthly', '（仅提醒，不阻断）', 'fmtTok', '（含字符估算，约）', 'usageBudgetRef']) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺 ' + k + '（需先跑 scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf("rpc('notes-usage-get', {})") >= 0, '发布包用量拉取走 rpc 形态（host.call 已构建转换）')
  })

  // ---- 37.4 app.html / 原型 notes-ui-v2.html 设置卡同步 + 原型 mock ----
  await t('app.html + 原型设置卡同款两行 + 用量区 + mock notes-usage-get 演示（双端 UI 标记一致）', () => {
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="setUsageBody"') >= 0 && s.indexOf('id="setUsageBudget"') >= 0, label + ' 用量区容器 + 预算输入')
      assert(s.indexOf("rpc('notes-usage-get', {})") >= 0, label + ' 拉取 notes-usage-get')
      assert(s.indexOf('saveSettings({ usageBudgetMonthly:') >= 0, label + ' 预算保存链路')
      assert(s.indexOf('LLM 用量') >= 0 && s.indexOf('用量预算提醒') >= 0, label + ' 两行标签')
      assert(s.indexOf('（仅提醒，不阻断）') >= 0 && s.indexOf('（含字符估算，约）') >= 0, label + ' toast/估算文案')
      assert(s.indexOf('function fmtTok(') >= 0, label + ' fmtTok 人性化函数')
      assert(s.indexOf('.set-ctrl.usage{') >= 0 && s.indexOf('.usage-line{') >= 0, label + ' 用量区样式')
    }
    assert(protoV2Src.indexOf("if (method === 'notes-usage-get')") >= 0, '原型 mock 含 notes-usage-get 分支')
    assert(protoV2Src.indexOf('estimatedTokens: 420') >= 0, '原型 mock 含估算演示值（「约」标注演示）')
  })
  }
}
