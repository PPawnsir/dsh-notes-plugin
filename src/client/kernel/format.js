    const shortSid = (sid) => sid ? String(sid).replace(/^session-/, '').slice(0, 8) : ''
    // P3 派发闭环：单条派发完成判定（dispatchStatus==='done' 或存量 done===true 向后兼容）——host 三通道回执：idle 事件 / resolved 联动 / 手动标记
    const isDispatchDone = (d) => !!(d && (d.dispatchStatus === 'done' || d.done === true))
    // 字节数人性化（归档预览组的 totalBytes 展示用）
    const fmtBytes = (n) => { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB' }
    // 历史版本时间戳（UTC ms）→ 本地可读串（历史面板版本列表/预览/confirm 共用）
    const fmtHistTs = (ts) => { const d = new Date(+ts || 0); if (isNaN(d.getTime())) return String(ts); const p = (x) => ('0' + x).slice(-2); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) }
    // token 数人性化（设置卡片「LLM 用量」区）：≥1M → 1.23M，≥10k → 12.3k，其余原样
    const fmtTok = (n) => { n = Math.round(+n || 0); return n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n) }
    const notify = () => listeners.forEach(fn => fn({ panelOpen }))
    const notifyNotesChanged = () => noteRefreshListeners.forEach(fn => fn())
