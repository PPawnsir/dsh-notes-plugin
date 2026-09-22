// notes 插件 client 引导壳：真正的实现在 client-impl.js，由 host 通过 notes-src RPC 下发
// React/styles/host 由加载器注入为全局，显式捕获后以参数形式传给 new Function（两种注入方式都兼容）
// host 实现异步加载需要时间，失败会按 800ms 间隔重试（最多 15 次）
return {
  inject: ['timer', 'sessions', 'workspaces'],
  apply(ctx) {
    const timer = ctx.timer
    const ReactRef = typeof React !== 'undefined' ? React : undefined
    const stylesRef = typeof styles !== 'undefined' ? styles : undefined
    const hostRef = typeof host !== 'undefined' ? host : undefined
    if (!hostRef) { console.error('notes bootstrap: host bridge unavailable'); return }
    const disposers = []
    let cancelled = false
    let tries = 0
    ctx.effect(() => () => { cancelled = true; for (const d of disposers) { try { d() } catch (e) {} } })
    function retry() {
      if (cancelled) return
      if (++tries > 15) { console.error('notes bootstrap: give up loading client impl'); return }
      const d = timer.timeout(attempt, 800)
      disposers.push(d)
    }
    function attempt() {
      if (cancelled) return
      hostRef.call('notes-src', { which: 'client' }).then(res => {
        if (cancelled) return
        if (res && res.src) {
          try {
            const plugin = new Function('React', 'styles', 'host', res.src)(ReactRef, stylesRef, hostRef)
            plugin.apply(ctx)
            console.log('notes plugin: client impl loaded')
          } catch (e) { console.error('notes client impl failed', e) }
        } else { retry() }
      }).catch(() => retry())
    }
    attempt()
  }
}
