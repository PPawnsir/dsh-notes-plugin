    // 样式从 host 拉取（styles.css 独立文件）：避免内嵌超长 CSS 字符串在 define 传输中被截断
    let cssLoaded = false
    let cssTries = 0
    function loadCss() {
      host.call('notes-css').then(res => {
        if (res && res.css) { cssLoaded = true; const d = styles.insert(res.css); if (typeof d === 'function') disposers.push(d) }
        else scheduleCssRetry()
      }).catch(scheduleCssRetry)
    }
    function scheduleCssRetry() { if (!cssLoaded && ++cssTries <= 10) { const d = timer.timeout(loadCss, 1200); disposers.push(d) } }
    loadCss()
