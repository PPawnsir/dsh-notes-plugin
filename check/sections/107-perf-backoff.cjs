// 节 107. 遥测退避 + /dsh-notes 慢请求诊断钩（0.4.8-A，notes-048-perf-backoff；巡检钓出反馈 n-muyg8rxawuds）
// 事故链：client perf.js 每 30s 点火即发 host.call('notes-perf') 未接 rejection——宿主忙时路由前串行段排队，
//   30s 超时护栏准时 reject → unhandled rejection 每 30s 刷一条 console error（现场 02:11-02:40 共 40+ 条），服务端本体无过载。
// 修复三件套：
//   ① client perf.js：上报 promise 接 rejection 分支吞掉 + 连败指数退避（30s→60s→120s→240s→封顶 300s，窗口内 tick 跳过，
//     成功复位）+ 失败降级 console.warn 一次性（连败首条）+ 恢复带计数；静态包 lib/client.js 经 build-dist STATIC_PERF_TIMER 同构；
//   ② app 端同构面核查：src/app/** 零遥测周期上报（本节扫描断言锁死——日后新增须带同款三件套），结论注释落 app/kernel/rpc.js；
//   ③ host /dsh-notes 慢请求诊断钩：handle() 包装 finally 内 slowRpcLog(name, ms)——>5s console.warn 一行（方法名+耗时），
//     纯进程日志（不写笔记库 / 不进遥测 perf-report.json / 不动路由并发结构）；server.js ⇄ server.dist.js 标记块逐字节一致。
module.exports = {
  id: "107",
  title: "107. 遥测退避 + /dsh-notes 慢请求诊断钩（0.4.8-A，notes-048-perf-backoff）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('107. 遥测退避 + /dsh-notes 慢请求诊断钩（0.4.8-A，notes-048-perf-backoff）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const cliPerf = read(path.join('src', 'client', 'kernel', 'perf.js'))
  const appRpc = read(path.join('src', 'app', 'kernel', 'rpc.js'))
  const srvDev = read(path.join('src', 'host', 'server.js'))
  const srvDist = read(path.join('src', 'host', 'server.dist.js'))
  const buildSrc = read(path.join('scripts', 'build-dist.cjs'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const clientPkgSrc = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))

  // ===== ① client perf.js 静态锚：退避三件套 + 红线（payload 形态零变化）=====
  await t('0.4.8-A client perf.js：rejection 吞掉 + 指数退避常量 + warn 降级锚（payload 形态零变化红线）', () => {
    assert(cliPerf.indexOf('const PERF_BACKOFF_BASE_MS = 30000') >= 0, '退避基数 30s（= 上报节拍）')
    assert(cliPerf.indexOf('const PERF_BACKOFF_CAP_MS = 300000') >= 0, '退避封顶 300s')
    assert(cliPerf.indexOf('var perfFailStreak = 0') >= 0 && cliPerf.indexOf('var perfBackoffUntil = 0') >= 0, '连败计数 + 退避闸门状态')
    assert(cliPerf.indexOf('if (Date.now() < perfBackoffUntil) return') >= 0, '退避窗口内 tick 跳过闸')
    assert(cliPerf.indexOf('p.then(') >= 0, '上报 promise 接 then 双分支（rejection 不再穿透 unhandled）')
    assert(cliPerf.indexOf('Math.min(PERF_BACKOFF_BASE_MS * Math.pow(2, perfFailStreak), PERF_BACKOFF_CAP_MS)') >= 0, '指数退避式锚（2^N×30s 封顶）')
    assert(cliPerf.indexOf("if (perfFailStreak === 1) { try { console.warn('[notes-perf] telemetry report failed, backing off silently: '") >= 0, '失败降级 warn 一次性（连败首条）锚')
    assert(cliPerf.indexOf("'[notes-perf] telemetry report recovered after ' + perfFailStreak + ' consecutive failures'") >= 0, '恢复带连败计数锚')
    assert(cliPerf.indexOf("host.call('notes-perf', { perf: JSON.parse(JSON.stringify(perf)) })") >= 0, '红线：上报 payload 形态零变化（perf-report.json client 快照兼容）')
    assert(cliPerf.indexOf('timer.interval(() => {') >= 0 && cliPerf.indexOf('}, 30000)') >= 0, '红线：30s 上报节拍不变')
  })

  // ===== ① client 行为级 eval（with(Proxy) 沙箱 + 假时钟 + 打桩 host 桥，节 94 同款形态）=====
  function bootPerf107() {
    const st = { now: 100000, intervalFns: [], timers: [], warns: [], hostCalls: [] }
    const hostStub = { impl: () => Promise.resolve({ ok: true }) }
    const target = {
      performance: { now: () => st.now },
      window: {},
      host: { call: (m, a) => { st.hostCalls.push(m); return hostStub.impl(m, a) } },
      timer: { interval: (fn, ms) => { st.intervalFns.push({ fn: fn, ms: ms }); return () => {} } },
      disposers: [],
      Date: { now: () => st.now },
      console: { warn: (m) => st.warns.push(String(m)) },
      setTimeout: (fn, ms) => { const h = { fn: fn, ms: ms, cleared: false }; st.timers.push(h); return h },
      clearTimeout: (h) => { if (h) h.cleared = true },
      t: (k) => k,
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; return t2[k] },
      set(t2, k, v) { t2[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + cliPerf + '\n}')(proxy)
    return { st: st, hostStub: hostStub, target: target }
  }
  const flush107 = () => new Promise(r => setTimeout(r, 0))

  await t('0.4.8-A 遥测退避行为级：连败 60s→120s→240s→封顶 300s + 窗口跳票 + 成功复位（eval 打桩）', async () => {
    const env = bootPerf107()
    assert(env.st.intervalFns.length === 1 && env.st.intervalFns[0].ms === 30000, '30s 节拍不变（红线：上报周期不动）')
    const tick = env.st.intervalFns[0].fn
    env.hostStub.impl = () => Promise.reject(new Error('笔记服务响应超时（30 秒）'))
    tick(); await flush107()   // 连败 1：t=100000 点火 → reject → 退避 60s（闸 160000）
    assert(env.st.hostCalls.length === 1, '首 tick 点火上报')
    assert(env.target.perfFailStreak === 1, '连败计数 1（实得 ' + env.target.perfFailStreak + '）')
    assert(env.target.perfBackoffUntil === 160000, '连败 1 → 退避 60s（实得闸 ' + env.target.perfBackoffUntil + '）')
    env.st.now = 130000; tick(); await flush107()   // 窗口内：跳过
    assert(env.st.hostCalls.length === 1, '退避窗口内 tick 跳过（不上报）')
    env.st.now = 160000; tick(); await flush107()   // 连败 2 → 退避 120s（闸 280000）
    assert(env.st.hostCalls.length === 2 && env.target.perfBackoffUntil === 280000, '连败 2 → 退避 120s（实得闸 ' + env.target.perfBackoffUntil + '）')
    env.st.now = 280000; tick(); await flush107()   // 连败 3 → 退避 240s（闸 520000）
    assert(env.target.perfBackoffUntil === 520000, '连败 3 → 退避 240s（实得闸 ' + env.target.perfBackoffUntil + '）')
    env.st.now = 520000; tick(); await flush107()   // 连败 4：2^4×30s=480s 超帽 → 封顶 300s（闸 820000）
    assert(env.target.perfBackoffUntil === 820000, '连败 4 → 封顶 300s（实得闸 ' + env.target.perfBackoffUntil + '）')
    env.hostStub.impl = () => Promise.resolve({ ok: true })   // 成功复位
    env.st.now = 820000; tick(); await flush107()
    assert(env.target.perfFailStreak === 0 && env.target.perfBackoffUntil === 0, '成功落定即复位（连败清零 + 闸归零）')
    env.st.now = 850000; tick(); await flush107()
    assert(env.st.hostCalls.length === 6, '复位后恢复 30s 节拍（下一 tick 正常点火，实得 ' + env.st.hostCalls.length + ' 次）')
  })

  await t('0.4.8-A 遥测 warn 降级：连败首条一条 + 恢复带计数 + 零 unhandled rejection（eval 打桩）', async () => {
    const unhandled = []
    const onUnhandled = (e) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      const env = bootPerf107()
      const tick = env.st.intervalFns[0].fn
      env.hostStub.impl = () => Promise.reject(new Error('笔记服务响应超时（30 秒）'))
      tick(); await flush107()   // 连败 1（t=100000）
      assert(env.st.warns.length === 1, '连败首条 warn 恰一条（实得 ' + env.st.warns.length + '）')
      assert(env.st.warns[0].indexOf('[notes-perf] telemetry report failed, backing off silently:') >= 0, '失败降级 warn 文案锚（实得 ' + env.st.warns[0] + '）')
      env.st.now = 160000; tick(); await flush107()   // 连败 2
      env.st.now = 280000; tick(); await flush107()   // 连败 3
      assert(env.st.warns.length === 1, '连败续发不再刷 warn（仍 1 条，实得 ' + env.st.warns.length + '）')
      env.hostStub.impl = () => Promise.resolve({ ok: true })
      env.st.now = 520000; tick(); await flush107()   // 恢复
      assert(env.st.warns.length === 2 && env.st.warns[1].indexOf('telemetry report recovered after 3 consecutive failures') >= 0, '恢复 warn 带连败计数（实得 ' + JSON.stringify(env.st.warns) + '）')
      await flush107()
      assert(unhandled.length === 0, '全程零 unhandled rejection（rejection 已吞，实得 ' + unhandled.length + '）')
    } finally { process.removeListener('unhandledRejection', onUnhandled) }
  })

  // ===== ② app 端同构面核查：零遥测周期上报（锁死）+ 结论注释双端 =====
  await t('0.4.8-A app 端同构面核查：src/app/** 零遥测周期上报（遥测仅 client 有）+ 结论注释锚', () => {
    const appFiles = []
    const walk = (d) => { for (const e of fsNative.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else appFiles.push(p) } }
    walk(path.join(DIR, 'src', 'app'))
    assert(appFiles.length > 0, 'src/app 扫描面非空（实得 ' + appFiles.length + ' 文件）')
    for (const f of appFiles) {
      const txt = fsNative.readFileSync(f, 'utf8')
      assert(txt.indexOf('notes-perf') < 0 && txt.indexOf('__dshNotesPerf') < 0, 'src/app 出现遥测上报面：' + path.relative(DIR, f) + '（须带同款退避三件套并更新节 107）')
    }
    assert(appRpc.indexOf('0.4.8-A 同构面核查结论（notes-048-perf-backoff ②）') >= 0, 'app/kernel/rpc.js 落核查结论注释')
    assert(appHtml.indexOf('0.4.8-A 同构面核查结论（notes-048-perf-backoff ②）') >= 0, 'app.html 产物同步（改 src/app 后须跑 node scripts/build-dist.cjs）')
  })

  // ===== ① 静态包产物同步：build-dist 同构退避段 + lib/client.js 退避锚 =====
  await t('0.4.8-A 产物同步：build-dist 同构退避段 + 发布包 lib/client.js 退避锚（零 host.call 残留红线不变）', () => {
    assert(buildSrc.indexOf('0\\.4\\.8-A 遥测退避') >= 0, 'build-dist perf-timer 正则锚定 0.4.8-A 退避块')
    assert(buildSrc.indexOf('var perfBackoffUntil = 0') >= 0 && buildSrc.indexOf('PERF_BACKOFF_CAP_MS = 300000') >= 0, 'STATIC_PERF_TIMER 同构退避段')
    for (const k of ['var perfFailStreak = 0', 'var perfBackoffUntil = 0', 'PERF_BACKOFF_CAP_MS = 300000', 'telemetry report failed, backing off silently', 'telemetry report recovered after', "rpc('notes-perf', { perf: JSON.parse(JSON.stringify(perf)) })"]) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺锚：' + k + '（改 src/client/** 或 build-dist 后需跑 node scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf('host.call') < 0, '发布包零 host.call 残留红线不变')
  })

  // ===== ③ host 慢请求诊断钩：标记块双包逐字节一致 + 行为级 eval =====
  const extractMarked = (src, tag) => {
    const re = new RegExp('// ==== ' + tag + ' BEGIN ====[\\s\\S]*?// ==== ' + tag + ' END ====')
    const m = src.match(re)
    assert(m, tag + ' 标记块存在')
    return m[0]
  }
  await t('slow-rpc-log 标记块双包逐字节一致 + 行为级 eval（>5s 触发 / ≤5s 静默 / 纯进程日志红线）', () => {
    const blkDev = extractMarked(srvDev, 'slow-rpc-log')
    const blkDist = extractMarked(srvDist, 'slow-rpc-log')
    assert(blkDev === blkDist, 'server.js ⇄ server.dist.js slow-rpc-log 块逐字节一致')
    assert(blkDev.indexOf('perfStats') < 0 && blkDev.indexOf('writePerfReport') < 0 && blkDev.indexOf('perfStats.rpc') < 0, '红线：诊断钩不进遥测（代码面零 perf 计数接触）')
    const warns = []
    const api = new Function('console', blkDev + '\nreturn { slowRpcLog: slowRpcLog, SLOW_RPC_LOG_MS: SLOW_RPC_LOG_MS }')({ warn: (m) => warns.push(String(m)) })
    assert(api.SLOW_RPC_LOG_MS === 5000, '慢请求阈值 5s 集中常量')
    api.slowRpcLog('notes-list', 4999)
    api.slowRpcLog('notes-list', 5000)
    assert(warns.length === 0, '≤5s 静默（边界 5000 不触发——>5s 严格，实得 ' + warns.length + ' 条）')
    api.slowRpcLog('notes-perf', 6001)   // mock 一个 6s 处理器
    assert(warns.length === 1, '6s 触发恰一行 warn（实得 ' + warns.length + '）')
    assert(warns[0].indexOf('notes-perf') >= 0 && warns[0].indexOf('6001') >= 0, 'warn 含方法名+耗时（实得 ' + warns[0] + '）')
    api.slowRpcLog('notes-get', 120000)
    assert(warns.length === 2, '慢请求逐条一行（不聚合不节流——纯诊断面）')
  })

  await t('0.4.8-A 慢请求诊断钩接线：handle() 包装 finally 双包锚（路由并发结构不动红线）', () => {
    const anchor = 'finally { const ms = Date.now() - t0; perfStats.rpc[name] = (perfStats.rpc[name] || 0) + 1; perfStats.rpcMs[name] = (perfStats.rpcMs[name] || 0) + ms; writePerfReport(); slowRpcLog(name, ms) }'
    assert(srvDev.indexOf(anchor) >= 0, 'server.js handle finally 接线锚')
    assert(srvDist.indexOf(anchor) >= 0, 'server.dist.js handle finally 接线锚')
    assert(srvDist.indexOf('handlers[payload.method]') >= 0, '/dsh-notes 路由分发结构不动（handlers 表直发）')
    assert(srvDev.indexOf('harness.handle(name, async (args) => {') >= 0 && srvDist.indexOf('harnessRef.handle(name, wrapped)') >= 0, '注册通道结构不动（harness 主通道 + webServer 兜底）')
  })

  // ===== ③ 真实包装行为级：6s 位移 mock（Date.now 第 2 次取时位移，等价处理器挂 6s，零真实等待）=====
  await t('0.4.8-A 慢请求诊断钩（行为）：6s 位移 mock → console.warn 一行（方法名+耗时），快请求静默（开发版+静态包）', async () => {
    // wrapper 取时序：t0（第 1 次）→ fn 体（notes-perf 零 Date 调用）→ finally ms（第 2 次，位移 +6001）→ writePerfReport 节流（第 3 次，真实时钟）
    const realNow = Date.now
    const realWarn = console.warn
    const drive = async (invoke) => {
      const warns = []
      console.warn = (m) => warns.push(String(m))
      let n = 0
      Date.now = () => { n++; return realNow() + (n === 2 ? 6001 : 0) }
      try { await invoke() } finally { Date.now = realNow; console.warn = realWarn }
      return warns
    }
    const devWarns = await drive(() => S.handlers['notes-perf']({ perf: { hostCall: 1 } }))
    assert(devWarns.length === 1 && devWarns[0].indexOf('[dsh-notes] 慢请求 notes-perf：') >= 0, '开发版 6s 位移触发 warn（实得 ' + JSON.stringify(devWarns) + '）')
    const devMs = parseInt((devWarns[0].match(/：(\d+)ms/) || [])[1] || '0', 10)
    assert(devMs > 5000, '开发版 warn 携带耗时 >5s（实得 ' + devMs + 'ms）')
    // 快请求静默（真实时钟零位移）
    const fastWarns = []
    console.warn = (m) => fastWarns.push(String(m))
    try { await S.handlers['notes-perf']({ perf: { hostCall: 2 } }) } finally { console.warn = realWarn }
    assert(fastWarns.length === 0, '快请求零 warn（实得 ' + fastWarns.length + '）')
    // 静态包：走真实 /dsh-notes HTTP 路由形态（S.rpc2 → routes2[0].handler → handlers 表 → wrapped handle）
    const distWarns = await drive(async () => {
      const r = await S.rpc2('notes-perf', { perf: { hostCall: 3 } })
      assert(r.status === 200 && r.body && r.body.ok === true, '静态包 notes-perf 正常返回（实得 ' + r.status + '）')
    })
    assert(distWarns.length === 1 && distWarns[0].indexOf('[dsh-notes] 慢请求 notes-perf：') >= 0, '静态包 6s 位移触发 warn（实得 ' + JSON.stringify(distWarns) + '）')
  })
  }
}
