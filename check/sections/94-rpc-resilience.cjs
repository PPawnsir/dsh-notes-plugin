// 节 94. RPC 韧性层（0.4.6-B，notes-046-rpc-resilience；巡检三角色同族证据 n-mux88x3knpsv / n-mux89mdj6tty / n-mux8a1l4k2nv）
// 事故链：app 端 rpc.js 裸 fetch 包装（无超时/无错误处理/无挂起 UI 态）——慢 LLM 调用叠加正常请求占满同源 6 连接池，
//   全窗口页 fetch 挂起 → 正文空白零提示「假死」；client 侧 in-process 宿主桥同族（落地页无活跃会话开面板「加载中…」≥60s 卡死）。
// 修复（红线：不改 host 协议形态 / 超时值集中常量可改 / 不引入第三方库 / UI 提示不阻断操作）：
//   ① app rpc.js：AbortController 超时（缺省 20s，LLM 类经 RPC_LLM_METHODS 放宽 120s）+ 超时/网络错误结构化 {error} 返回
//     （与 host error 形态一致，调用点零改动兼容）+ toast 显式告知（不静默）+ 挂起 >3s 非阻塞「连接慢」提示条（#rpcSlowBar）；
//   ② app 挂起态：loadNotes 在途树显「加载中…」行 + 源码正文在途窗 placeholder 转「正文加载中…」（0.4.6-A 富文本窗的源码侧同族）；
//   ③ client：宿主桥同款超时护栏（30s/120s，超时 reject 调用点 catch 零改动兼容）+ 落地页空态引导（landingStall →「打开一个会话后使用」+ 重试）；
//   ④ 静态包 lib/client.js rpc helper 同构护栏（build-dist 转换注入）。
module.exports = {
  id: "94",
  title: "94. RPC 韧性层（0.4.6-B：超时 + 挂起提示条 + 落地页空态，notes-046-rpc-resilience）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('94. RPC 韧性层（0.4.6-B：超时 + 挂起提示条 + 落地页空态）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appRpc = read(path.join('src', 'app', 'kernel', 'rpc.js'))
  const appData = read(path.join('src', 'app', 'kernel', 'data.js'))
  const appTree = read(path.join('src', 'app', 'panels', 'tree.js'))
  const appEd = read(path.join('src', 'app', 'panels', 'editor.js'))
  const appHead = read(path.join('src', 'app', 'shell', 'head.html'))
  const appBody = read(path.join('src', 'app', 'shell', 'body.html'))
  const cliPerf = read(path.join('src', 'client', 'kernel', 'perf.js'))
  const cliConst = read(path.join('src', 'client', 'kernel', 'constants.js'))
  const cliIdx = read(path.join('src', 'client', 'panels', 'panel', 'index.js'))
  const cliTree = read(path.join('src', 'client', 'panels', 'panel', 'tree.js'))
  const cliEd = read(path.join('src', 'client', 'panels', 'panel', 'editor.js'))
  const buildSrc = read(path.join('scripts', 'build-dist.cjs'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const clientPkgSrc = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))
  const ZH94 = new Function(read(path.join('src', 'i18n', 'zh.js')) + '\nreturn I18N_ZH')()
  const EN94 = new Function(read(path.join('src', 'i18n', 'en.js')) + '\nreturn I18N_EN')()

  // ===== ① app rpc.js 静态锚：超时/结构化错误/慢提示条三件套 + 既有签名兼容（节 24 锚 function rpc(method, args)）=====
  await t('0.4.6-B app rpc.js：超时集中常量 + AbortController + LLM 放宽表（签名保持 rpc(method, args) 兼容）', () => {
    assert(appRpc.indexOf('function rpc(method, args) {') >= 0, 'rpc 签名保持 (method, args)——节 24 原型/app 同构锚与全部调用点零改动')
    assert(appRpc.indexOf('var RPC_TIMEOUT_MS = 20000;') >= 0, '缺省超时常量 20s')
    assert(appRpc.indexOf('var RPC_TIMEOUT_LLM_MS = 120000;') >= 0, 'LLM 长调用超时常量 120s')
    assert(appRpc.indexOf('var RPC_SLOW_MS = 3000;') >= 0, '挂起提示条阈值 3s')
    assert(appRpc.indexOf('new AbortController()') >= 0, 'AbortController 超时中断')
    for (const m of ['notes-ai-organize', 'notes-quick-instruct', 'notes-when-suggest', 'notes-conflict-check']) {
      assert(appRpc.indexOf("'" + m + "': 1") >= 0, 'RPC_LLM_METHODS 含 ' + m)
    }
  })
  await t('0.4.6-B app rpc.js：超时/网络错误 → 结构化 {error} + toast 不静默 + 慢提示条归并计数', () => {
    assert(appRpc.indexOf("t('rpc.timeout', { s: Math.round(timeoutMs / 1000) })") >= 0, '超时文案走字典')
    assert(appRpc.indexOf("t('rpc.network', { msg: e && e.message || String(e) })") >= 0, '网络错误文案走字典')
    assert(appRpc.indexOf('return { error: msg };') >= 0, '结构化 {error} 返回（与 host error 形态一致）')
    assert(appRpc.indexOf('toast(msg);') >= 0, '韧性层 toast 显式告知（不静默）')
    assert(appRpc.indexOf('rpcSlowShown++') >= 0 && appRpc.indexOf('rpcSlowBar(false)') >= 0, '慢请求归并计数 + 全落定收条')
  })
  await t('0.4.6-B app 壳：#rpcSlowBar 元素 + .rpc-slow 样式（pointer-events:none 不遮罩不阻断）', () => {
    assert(appBody.indexOf('<div class="rpc-slow" id="rpcSlowBar" style="display:none"></div>') >= 0, 'body.html 含提示条元素')
    assert(appHead.indexOf('.rpc-slow{') >= 0 && appHead.indexOf('pointer-events:none') >= 0, 'head.html 提示条样式含不阻断锚')
  })

  // ===== ② app 挂起态 UI：列表加载行 + 源码正文在途 placeholder =====
  await t('0.4.6-B app 挂起态：loadNotes 在途树显「加载中…」行（首载不再空白零提示）', () => {
    assert(appData.indexOf('if (!silent) { listLoading = true; renderTree(); }') >= 0, 'loadNotes 非静默置在途标记')
    assert(appData.indexOf('.then(function () { listLoading = false; ensureWikiIndex(); renderTree(); refreshSysKids(); return true })') >= 0, '成功出路复位（节 31/80 链尾锚兼容）')
    assert(appData.indexOf(".catch(function (e) { listLoading = false;") >= 0, '失败出路同复位')
    assert(appTree.indexOf("if (listLoading && !notes.length) h += '<div class=\"sec-h\" style=\"text-transform:none;letter-spacing:0\">' + t('common.loading') + '</div>';") >= 0, '树加载行锚')
  })
  await t('0.4.6-B app 正文在途窗：源码 textarea placeholder 转「正文加载中…」（落定/出错还原）', () => {
    assert(appEd.indexOf("ta.placeholder = edBodyPending() ? t('editor.bodySyncing') : t('editor.bodyPlaceholder')") >= 0, 'refreshLoadErrUI 在途窗 placeholder 锚')
  })

  // ===== ③ client 宿主桥超时护栏 + 落地页空态 =====
  await t('0.4.6-B client：宿主桥超时护栏（30s/120s LLM 放宽 + 超时 reject 结构化文案）', () => {
    assert(cliPerf.indexOf('const HOSTCALL_TIMEOUT_MS = 30000') >= 0, '缺省护栏 30s')
    assert(cliPerf.indexOf('const HOSTCALL_TIMEOUT_LLM_MS = 120000') >= 0, 'LLM 护栏 120s')
    assert(cliPerf.indexOf("const HOSTCALL_LLM_METHODS = { 'notes-ai-organize': 1, 'notes-quick-instruct': 1, 'notes-when-suggest': 1, 'notes-conflict-check': 1 }") >= 0, 'LLM 放宽表')
    assert(cliPerf.indexOf("reject(new Error(t('rpc.hostTimeout', { s: Math.round(guardMs / 1000) })))") >= 0, '超时 reject 走字典文案（调用点 catch 零改动兼容）')
  })
  await t('0.4.6-B client：落地页无活跃会话空态引导（landingStall 计时 + 树引导行 + 成功复位）', () => {
    assert(cliConst.indexOf('const LANDING_STALL_MS = 6000') >= 0, '落地页挂起阈值常量')
    assert(cliIdx.indexOf('const [landingStall, setLandingStall] = React.useState(false)') >= 0, 'landingStall 态')
    assert(cliIdx.indexOf('later(() => { if (loadingRef.current) setLandingStall(true) }, LANDING_STALL_MS)') >= 0, '开面板计时挂起判定')
    assert(cliIdx.indexOf('setNotes(list); setLandingStall(false)') >= 0, 'loadNotes 成功复位（慢但可用不误导）')
    assert(cliIdx.indexOf('landingStall: landingStall') >= 0, 'R 注入树渲染')
    assert(cliTree.indexOf("tt('tree.landingTitle')") >= 0 && cliTree.indexOf("tt('tree.landingSub')") >= 0 && cliTree.indexOf("tt('tree.landingRetry')") >= 0, '引导行三键（标题/说明/重试）')
    assert(cliTree.indexOf("onClick: () => loadNotes()") >= 0, '重试经 kernel loadNotes 别名')
  })
  await t('0.4.6-B client 正文在途窗平价：源码 textarea placeholder 同转「正文加载中…」', () => {
    assert(cliEd.indexOf("placeholder: edBodyPending ? tt('editor.bodySyncing') : tt('editor.bodyPlaceholder')") >= 0, 'client textarea 在途 placeholder 锚')
  })

  // ===== ④ 产物同步（改 src 后须跑 concat-app + build-dist） =====
  await t('0.4.6-B 产物同步：app.html + 发布包 lib/client.js 双端含韧性锚（静态包 helper 同构护栏）', () => {
    for (const k of ['var RPC_TIMEOUT_MS = 20000;', 'rpcSlowBar', "'rpc.slowBar': '连接较慢，仍在加载…'", 'listLoading']) {
      assert(appHtml.indexOf(k) >= 0, 'app.html 缺锚：' + k + '（改 src/app/** 后需跑 node scripts/concat-app.cjs）')
    }
    for (const k of ['const HOSTCALL_TIMEOUT_MS = 30000', 'HOSTCALL_LLM_METHODS', "'rpc.hostTimeout'", 'landingStall', "'tree.landingTitle'"]) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺锚：' + k + '（改 src/client/** 后需跑 node scripts/build-dist.cjs）')
    }
    assert(clientPkgSrc.indexOf('host.call') < 0, '发布包零 host.call 残留（含注释——build-dist 禁令同口径）')
    assert(buildSrc.indexOf('HOSTCALL_LLM_METHODS[method] ? HOSTCALL_TIMEOUT_LLM_MS : HOSTCALL_TIMEOUT_MS') >= 0, 'build-dist 静态 helper 同构护栏')
    assert(clientSrc.indexOf('HOSTCALL_TIMEOUT_MS') >= 0, 'client 拼接产物含护栏常量（src/client/** 拼接直出）')
  })

  // ===== ⑤ i18n 双字典 parity（7 新键同键同占位符） =====
  await t('0.4.6-B i18n：rpc.* / tree.landing* 双字典同键同占位符', () => {
    for (const k of ['rpc.slowBar', 'rpc.timeout', 'rpc.network', 'rpc.hostTimeout', 'tree.landingTitle', 'tree.landingSub', 'tree.landingRetry']) {
      assert(typeof ZH94[k] === 'string' && ZH94[k], 'zh 缺 ' + k)
      assert(typeof EN94[k] === 'string' && EN94[k], 'en 缺 ' + k)
      const pz = (ZH94[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (EN94[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
  })

  // ===== ⑥ app rpc 行为级 eval（with(Proxy) 沙箱 + AbortController 假件 + 真实计时器收窄阈值，93 节同款形态） =====
  function bootRpc94(fetchImpl) {
    const els = { rpcSlowBar: { textContent: '', style: { display: 'none' } } }
    const toasts = []
    const FakeAC = function () {
      const c = { aborted: false, signal: { get aborted() { return c.aborted } } }
      c.abort = () => { c.aborted = true }
      return c
    }
    const target = {
      fetch: fetchImpl,
      AbortController: FakeAC,
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      $: (id) => els[id],
      t: (k, vars) => { let s = ZH94[k]; if (s == null) return k; if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m)); return s },
      toast: (m) => toasts.push(m),
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; return t2[k] },
      set(t2, k, v) { t2[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + appRpc + '\n; __api = { rpc: rpc } }')(proxy)
    return { api: target.__api, els: els, toasts: toasts, target: target }
  }

  await t('0.4.6-B rpc 超时 → 结构化 {error} + toast 不静默（AbortController 行为级）', async () => {
    let aborted = false
    const env = bootRpc94((u, init) => new Promise((resolve, reject) => {
      /* 挂起 fetch：仅当 signal 中止才 reject（模拟浏览器 AbortError） */
      const sig = init && init.signal
      const chk = setInterval(() => { if (sig && sig.aborted) { clearInterval(chk); aborted = true; const e = new Error('aborted'); e.name = 'AbortError'; reject(e) } }, 5)
    }))
    env.target.RPC_TIMEOUT_MS = 60   /* 收窄超时（var 经 proxy 写回，rpc 调用期读取） */
    env.target.RPC_SLOW_MS = 60000   /* 本条隔离慢条噪音 */
    const p = env.api.rpc('notes-list', {})
    await new Promise(r => setTimeout(r, 200))   /* 真实计时器：60ms 超时已触发 */
    const res = await p
    assert(aborted === true, '超时触发 AbortController.abort（fetch 收到中止）')
    assert(res && typeof res.error === 'string' && res.error.indexOf('超时') >= 0, '结构化 {error} 含超时文案（实得 ' + JSON.stringify(res) + '）')
    assert(res.error === ZH94['rpc.timeout'].replace('{s}', '0'), '超时文案 = 字典 rpc.timeout 插值（{s}=' + Math.round(60 / 1000) + '）')
    assert(env.toasts.length === 1 && env.toasts[0] === res.error, 'toast 显式告知不静默（实得 ' + env.toasts.length + ' 条）')
    assert(env.els.rpcSlowBar.style.display === 'none', '超时路径慢条不残留')
  })
  await t('0.4.6-B rpc 挂起提示条：>RPC_SLOW_MS 出现 / 落定消失（并发归并同一条）', async () => {
    let resolveA = null, resolveB = null
    const env = bootRpc94((u, init) => new Promise((resolve) => {
      const body = JSON.parse(init.body)
      if (body.method === 'notes-list') resolveA = resolve; else resolveB = resolve
    }))
    const wrap = (payload) => ({ json: () => Promise.resolve(payload) })   /* fetch Response 形态：rpc 链 r.json() */
    env.target.RPC_SLOW_MS = 30
    env.target.RPC_TIMEOUT_MS = 60000
    const p1 = env.api.rpc('notes-list', {})
    const p2 = env.api.rpc('notes-folders', {})
    await new Promise(r => setTimeout(r, 120))   /* 30ms 阈值已过：两条均在途 */
    assert(env.els.rpcSlowBar.style.display === 'block', '挂起超阈提示条出现（实得 ' + env.els.rpcSlowBar.style.display + '）')
    assert(env.els.rpcSlowBar.textContent === ZH94['rpc.slowBar'], '提示条文案 = 字典 rpc.slowBar')
    assert(env.target.rpcSlowShown === 2, '并发归并计数 = 2（实得 ' + env.target.rpcSlowShown + '）')
    resolveA(wrap({ notes: [] }))
    await p1
    assert(env.els.rpcSlowBar.style.display === 'block', '一条落定另一条在途：条不收')
    resolveB(wrap({ folders: [] }))
    await p2
    assert(env.els.rpcSlowBar.style.display === 'none', '全部落定提示条消失')
    assert(env.target.rpcSlowShown === 0, '计数归零')
    assert(env.toasts.length === 0, '正常慢路径零 toast（不打扰）')
  })
  await t('0.4.6-B rpc 既有路径零回归：正常 JSON 透传 + 网络错误结构化（慢条/超时不误触）', async () => {
    const env = bootRpc94(() => Promise.resolve({ json: () => Promise.resolve({ notes: [{ id: 'n1' }] }) }))
    const res = await env.api.rpc('notes-list', {})
    assert(res && res.notes && res.notes.length === 1 && res.notes[0].id === 'n1', '正常响应原样透传（调用点零改动兼容）')
    assert(env.toasts.length === 0 && env.els.rpcSlowBar.style.display === 'none', '快路径零 toast 零慢条')
    /* 网络错误（fetch reject，非超时）→ 结构化 {error} + toast */
    const env2 = bootRpc94(() => Promise.reject(new TypeError('Failed to fetch')))
    env2.target.RPC_SLOW_MS = 60000
    const res2 = await env2.api.rpc('notes-list', {})
    assert(res2 && res2.error === ZH94['rpc.network'].replace('{msg}', 'Failed to fetch'), '网络错误结构化（实得 ' + JSON.stringify(res2) + '）')
    assert(env2.toasts.length === 1, '网络错误 toast 不静默')
  })

  // ===== ⑦ client 宿主桥护栏行为级 eval（假计时器手动点火：30s 不真等） =====
  await t('0.4.6-B client 护栏（行为）：超时 reject 字典文案 + LLM 放宽 120s + 正常落定清计时器', async () => {
    const timers = []
    const hostStub = { calls: [], call(m, a) { hostStub.calls.push(m); return hostStub.impl(m, a) } }
    const target = {
      performance: { now: () => Date.now() },
      window: {},
      host: hostStub,
      timer: { interval: () => () => {} },
      disposers: [],
      setTimeout: (fn, ms) => { const h = { fn: fn, ms: ms, cleared: false }; timers.push(h); return h },
      clearTimeout: (h) => { if (h) h.cleared = true },
      t: (k, vars) => { let s = ZH94[k]; if (s == null) return k; if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m)); return s },
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; return t2[k] },
      set(t2, k, v) { t2[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + cliPerf + '\n}')(proxy)
    /* 包装已生效：普通方法挂起 → 点 30s 超时火 → reject 字典文案 */
    hostStub.impl = () => new Promise(() => {})
    const p1 = target.host.call('notes-list', {})
    const to1 = timers.find(x => x.ms === 30000 && !x.cleared)
    assert(!!to1, '普通方法挂 30s 超时器（实得计时器 ' + timers.map(x => x.ms).join(',') + '）')
    to1.fn()
    let err1 = null
    try { await p1 } catch (e) { err1 = e }
    assert(err1 && err1.message === ZH94['rpc.hostTimeout'].replace('{s}', '30'), '超时 reject = 字典 rpc.hostTimeout（实得 ' + (err1 && err1.message) + '）')
    /* LLM 方法放宽 120s */
    hostStub.impl = () => new Promise(() => {})
    target.host.call('notes-ai-organize', {})
    assert(timers.some(x => x.ms === 120000 && !x.cleared), 'LLM 方法挂 120s 放宽器')
    /* 正常落定：清计时器 + 原值透传 */
    hostStub.impl = () => Promise.resolve({ notes: [] })
    const okRes = await target.host.call('notes-list', {})
    assert(okRes && okRes.notes && okRes.notes.length === 0, '正常落定原值透传')
    const lastTo = timers[timers.length - 1]
    assert(lastTo.cleared === true, '落定清超时器（不积尸）')
  })
  }
}
