    // 性能自检计数器：浏览器控制台执行 JSON.stringify(window.__dshNotesPerf) 可取数诊断
    const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now()
    const perf = { selChange: 0, selCollapsedSkip: 0, selChangeMs: 0, selShowEval: 0, selShowMs: 0, mousemoveTracked: 0, hostCall: 0, hostCallMs: 0, panelRender: 0, selRender: 0, hdrRender: 0, longTasks: 0, longTaskMs: 0, worstTaskMs: 0 }
    try { window.__dshNotesPerf = perf } catch (e2) {}
    // ===== 0.4.6-B 韧性护栏（notes-046-rpc-resilience）：in-process 宿主调用桥同款超时（实测挂起场景：落地页无活跃会话/巡检并发打满宿主）=====
    // 超时 reject Error(t('rpc.hostTimeout'))——调用点既有 catch 零改动兼容（loadNotes → 错误条 / loadEdBody → R-1 横幅）；
    // LLM 类长调用（host 侧 8s~120s 级：when-suggest 草稿 8s / 约定体检 120s——0.4.7-A⑨）经 HOSTCALL_LLM_METHODS 显式放宽；超时值集中本块常量可改。
    const HOSTCALL_TIMEOUT_MS = 30000        // 缺省护栏（普通 RPC）
    const HOSTCALL_TIMEOUT_LLM_MS = 120000   // LLM 类长调用护栏
    const HOSTCALL_LLM_METHODS = { 'notes-ai-organize': 1, 'notes-quick-instruct': 1, 'notes-when-suggest': 1, 'notes-conflict-check': 1 }
    try {
      const origCall = host.call.bind(host)
      host.call = (m, a) => {
        perf.hostCall++
        const t0 = now()
        const guardMs = HOSTCALL_LLM_METHODS[m] ? HOSTCALL_TIMEOUT_LLM_MS : HOSTCALL_TIMEOUT_MS
        // 超时只断等待侧（reject 给调用点收尾），底层 in-process 调用无法取消——迟到落定仅清计时器，零副作用
        return new Promise((resolve, reject) => {
          const to = setTimeout(() => reject(new Error(t('rpc.hostTimeout', { s: Math.round(guardMs / 1000) }))), guardMs)
          origCall(m, a).then(
            r => { clearTimeout(to); perf.hostCallMs += now() - t0; resolve(r) },
            err => { clearTimeout(to); perf.hostCallMs += now() - t0; reject(err) })
        })
      }
    } catch (e2) {}
    // 长任务观察器：主线程阻塞（>50ms）的直接证据
    try {
      if (typeof PerformanceObserver !== 'undefined') {
        const po = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          for (let i = 0; i < entries.length; i++) { const en = entries[i]; perf.longTasks++; perf.longTaskMs += en.duration; if (en.duration > perf.worstTaskMs) perf.worstTaskMs = Math.round(en.duration) }
        })
        po.observe({ type: 'longtask' })
        disposers.push(() => po.disconnect())
      }
    } catch (e2) {}
    // ===== 0.4.8-A 遥测退避（notes-048-perf-backoff；巡检钓出：宿主忙时 notes-perf 每 30s 准时超时，点火即发未接 rejection → console error 死循环刷屏 40+ 条，反馈 n-muyg8rxawuds）=====
    // ①上报 promise 接 rejection 分支吞掉——遥测失败本就不该成用户可见 unhandled error（try/catch 只接同步异常，接不到 promise 拒绝）；
    // ②连续失败指数退避：连败 N 次后顺延 min(2^N × 30s, 封顶 300s)（30s→60s→120s→240s→300s…，退避窗口内 tick 跳过本次上报），成功落定即复位回 30s 节拍；
    // ③失败降级 console.warn 一次性（连败首条一条）+ 恢复时一条带连败计数——不再每 30s 一条刷屏。
    // 红线：上报 payload 形态零变化（perf-report.json client 快照兼容）；阈值集中常量可改。
    // 每 30s 把计数器推给 host，汇总写入 perf-report.json
    const PERF_BACKOFF_BASE_MS = 30000    // 退避基数（= 上报节拍）
    const PERF_BACKOFF_CAP_MS = 300000    // 退避封顶
    var perfFailStreak = 0                // 连败计数（var 形态：check 节 107 行为级 eval 经 with(Proxy) 沙箱可见）
    var perfBackoffUntil = 0              // 退避闸门：该时刻前的 tick 跳过本次上报
    try {
      const pd = timer.interval(() => {
        try {
          if (Date.now() < perfBackoffUntil) return    // 退避窗口内跳过（连败指数退避生效中）
          const p = host.call('notes-perf', { perf: JSON.parse(JSON.stringify(perf)) })
          if (!p || typeof p.then !== 'function') return
          p.then(
            () => {
              if (perfFailStreak > 0) { try { console.warn('[notes-perf] telemetry report recovered after ' + perfFailStreak + ' consecutive failures') } catch (e2) {} }
              perfFailStreak = 0
              perfBackoffUntil = 0
            },
            (e2) => {
              perfFailStreak++
              perfBackoffUntil = Date.now() + Math.min(PERF_BACKOFF_BASE_MS * Math.pow(2, perfFailStreak), PERF_BACKOFF_CAP_MS)
              if (perfFailStreak === 1) { try { console.warn('[notes-perf] telemetry report failed, backing off silently: ' + (e2 && e2.message || e2)) } catch (e3) {} }
            }
          )
        } catch (e2) {}
      }, 30000)
      disposers.push(pd)
    } catch (e2) {}
