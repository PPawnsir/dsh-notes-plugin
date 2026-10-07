    // 性能自检计数器：浏览器控制台执行 JSON.stringify(window.__dshNotesPerf) 可取数诊断
    const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now()
    const perf = { selChange: 0, selCollapsedSkip: 0, selChangeMs: 0, selShowEval: 0, selShowMs: 0, mousemoveTracked: 0, hostCall: 0, hostCallMs: 0, panelRender: 0, selRender: 0, hdrRender: 0, longTasks: 0, longTaskMs: 0, worstTaskMs: 0 }
    try { window.__dshNotesPerf = perf } catch (e2) {}
    // ===== 0.4.6-B 韧性护栏（notes-046-rpc-resilience）：in-process 宿主调用桥同款超时（实测挂起场景：落地页无活跃会话/巡检并发打满宿主）=====
    // 超时 reject Error(t('rpc.hostTimeout'))——调用点既有 catch 零改动兼容（loadNotes → 错误条 / loadEdBody → R-1 横幅）；
    // LLM 类长调用（host 侧 8s 级起）经 HOSTCALL_LLM_METHODS 显式放宽；超时值集中本块常量可改。
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
    // 每 30s 把计数器推给 host，汇总写入 perf-report.json
    try { const pd = timer.interval(() => { try { host.call('notes-perf', { perf: JSON.parse(JSON.stringify(perf)) }) } catch (e2) {} }, 30000); disposers.push(pd) } catch (e2) {}
