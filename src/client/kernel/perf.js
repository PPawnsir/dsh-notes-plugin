    // 性能自检计数器：浏览器控制台执行 JSON.stringify(window.__dshNotesPerf) 可取数诊断
    const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now()
    const perf = { selChange: 0, selCollapsedSkip: 0, selChangeMs: 0, selShowEval: 0, selShowMs: 0, mousemoveTracked: 0, hostCall: 0, hostCallMs: 0, panelRender: 0, selRender: 0, hdrRender: 0, longTasks: 0, longTaskMs: 0, worstTaskMs: 0 }
    try { window.__dshNotesPerf = perf } catch (e2) {}
    try {
      const origCall = host.call.bind(host)
      host.call = (m, a) => { perf.hostCall++; const t0 = now(); return origCall(m, a).then(r => { perf.hostCallMs += now() - t0; return r }, err => { perf.hostCallMs += now() - t0; throw err }) }
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
