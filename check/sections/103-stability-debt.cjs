// 节 103. 稳定性债（0.4.7-C，notes-047-stability）：两项数据安全向
// ① 关闭瞬间 <900ms 在途编辑丢失（0.4.4-H 遗留 d）根修——双端关闭/卸载兜底 flush：
//    client：面板 close()（×/Esc 收口）+ 头部按钮 toggle-off + beforeunload 三钩同调 flushPendingEdits
//    （debounce 在途脏标记消费后立即 doSave，到期回调空转不双保存；富文本在途先序列化——DOM 拆毁前最后窗口）；
//    app：beforeunload → flushPendingSave → rpcKeepalive（sendBeacon/fetch keepalive 卸载可靠通道，64KB 预算守卫）。
//    红线：900ms 防抖口径不动（只补关闭 flush）；R-1 提交闸/edBodyErr 暂停语义经 doSave/buildSavePayload 全继承。
// ② 在途窗残留两条（0.4.6-A verifier 遗留）：
//    a. 失败态同步点统一——edBodyErr/edLoadErr 在窗时同步点红点「加载失败」（双端同口径；
//       旧口径 client 冒绿「已同步」/ app 滞留橙「加载中」，与失败横幅矛盾）；
//    b. 源码模式在途窗补同款锁（0.4.6-A 只锁富文本）——readOnly 在途窗 true + placeholder「正文加载中…」（双端）。
module.exports = {
  id: "103",
  title: "103. 稳定性债（0.4.7-C：关闭 flush + 在途窗失败态统一/源码补锁，notes-047-stability）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, clientSrc } = H
  section('103. 稳定性债（0.4.7-C：关闭 flush + 在途窗失败态统一/源码补锁）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appEd = read(path.join('src', 'app', 'panels', 'editor.js'))
  const appRpc = read(path.join('src', 'app', 'kernel', 'rpc.js'))
  const appBoot = read(path.join('src', 'app', 'kernel', 'bootstrap.js'))
  const appHead = read(path.join('src', 'app', 'shell', 'head.html'))
  const cliEd = read(path.join('src', 'client', 'panels', 'panel', 'editor.js'))
  const cliIdx = read(path.join('src', 'client', 'panels', 'panel', 'index.js'))
  const cliHdrBtn = read(path.join('src', 'client', 'panels', 'entries', 'header-button.js'))
  const cssDev = read(path.join('src', 'styles.css'))
  const appHtml = read(path.join('packages', 'dsh-notes-plugin', 'app.html'))
  const clientPkgSrc = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'client.js'))
  const ZH103 = new Function(read(path.join('src', 'i18n', 'zh.js')) + '\nreturn I18N_ZH')()
  const EN103 = new Function(read(path.join('src', 'i18n', 'en.js')) + '\nreturn I18N_EN')()

  // ===== ①a client flush 静态锚：脏标记 debounce + flushPendingEdits + 三钩（close/头部按钮/beforeunload） =====
  await t('0.4.7-C client flush：debounce 在途脏标记 + flushPendingEdits 消费直发（900ms 口径不动）', () => {
    assert(cliEd.indexOf('const autoSavePendingRef = React.useRef(false)') >= 0, 'client 缺 debounce 在途脏标记 ref')
    assert(cliEd.indexOf('if (!autoSavePendingRef.current) return; autoSavePendingRef.current = false; if (selectedRef.current) doSave()') >= 0, 'debounce 回调缺脏标记消费（防 flush 后到期双保存）')
    assert(cliEd.indexOf('function triggerAutoSave() { autoSavePendingRef.current = true; if (autoSaveRef.current) autoSaveRef.current() }') >= 0, 'triggerAutoSave 缺脏标记置位')
    assert(cliEd.indexOf('function flushPendingEdits(why)') >= 0, '缺 flushPendingEdits（关闭/卸载兜底 flush）')
    assert(cliEd.indexOf("if (editorModeRef.current === 'rich' && richDirtyRef.current) syncFromRich(why || '关闭冲刷')") >= 0, 'flush 前富文本在途序列化缺失（DOM 拆毁前最后窗口）')
    assert(cliEd.indexOf('if (selectedRef.current) doSave()') >= 0, 'flush 立即 doSave 缺失')
    assert(cliEd.indexOf('}, 900)') >= 0, '900ms 防抖口径不得改动')
  })
  await t('0.4.7-C client flush 三钩：close() 收口 + 头部按钮 toggle-off + beforeunload 页面卸载', () => {
    assert(cliIdx.indexOf("function close() { flushPendingEdits('关闭面板'); panelOpen = false; notify() }") >= 0, 'close()（×/Esc 收口）缺 flush 前置')
    assert(cliIdx.indexOf('flushPendingEdits } = usePanelEditor(') >= 0, '装配层未解构 flushPendingEdits')
    assert(cliIdx.indexOf('panelBridge.flushPendingEdits = flushPendingEdits') >= 0, 'panelBridge 未回填 flushPendingEdits（头部按钮经桥中转）')
    assert(cliHdrBtn.indexOf("if (panelOpen && panelBridge.flushPendingEdits) panelBridge.flushPendingEdits('关闭面板')") >= 0, '头部按钮 toggle-off 缺 flush（不经 close() 的第二关闭点）')
    assert(cliEd.indexOf("window.addEventListener('beforeunload', onPageUnload)") >= 0, 'beforeunload 页面卸载钩缺失')
    assert(cliEd.indexOf('flushPendingEdits: flushPendingEdits') >= 0, 'hook 返回面未导出 flushPendingEdits')
  })

  // ===== ①b app flush 静态锚：flushPendingSave + rpcKeepalive + beforeunload + 载荷单点化 =====
  await t('0.4.7-C app flush：flushPendingSave + buildSavePayload 载荷单点化（doSave 同口径，防双份漂移）', () => {
    assert(appEd.indexOf('function flushPendingSave()') >= 0, 'app 缺 flushPendingSave（卸载兜底 flush）')
    assert(appEd.indexOf("if (edMode === 'rich' && richDirty && edNote) syncFromRich('卸载冲刷');") >= 0, 'app flush 前富文本在途序列化缺失')
    assert(appEd.indexOf('clearTimeout(saveTimer); saveTimer = null;') >= 0, 'flush 取消在途 debounce 缺失（防到期双保存）')
    assert(appEd.indexOf('function buildSavePayload()') >= 0, '缺 buildSavePayload 载荷单点构造')
    assert(appEd.indexOf('var upd = buildSavePayload(); if (!upd) return;') >= 0, 'doSave 未走单点构造（实得双份漂移风险）')
    assert(appEd.indexOf("rpcKeepalive('notes-update', upd);") >= 0, 'flush 更新通道未走 keepalive 直发')
    assert(appEd.indexOf("rpcKeepalive('notes-create', dp)") >= 0, 'flush 草稿落库通道缺失（draftCreating 在飞跳过闸须在注释同文）')
    assert(appEd.indexOf('saveTimer = setTimeout(doSave, 900)') >= 0, '900ms 防抖口径不得改动')
  })
  await t('0.4.7-C app flush 通道：rpcKeepalive（sendBeacon 优先 + fetch keepalive + 64KB 预算守卫）+ beforeunload 钩', () => {
    assert(appRpc.indexOf('function rpcKeepalive(method, args)') >= 0, 'app rpc.js 缺 rpcKeepalive 卸载直发')
    assert(appRpc.indexOf('navigator.sendBeacon') >= 0, 'rpcKeepalive 缺 sendBeacon 优先通道')
    assert(appRpc.indexOf('keepalive: body.length < 60000') >= 0, 'rpcKeepalive 缺 64KB keepalive 预算守卫')
    assert(appRpc.indexOf('function rpc(method, args) {') >= 0, 'rpc() 既有签名不得改动（节 94 韧性层锚同守）')
    assert(appBoot.indexOf("window.addEventListener('beforeunload', function () { try { flushPendingSave() } catch (e) {} })") >= 0, 'app bootstrap 缺 beforeunload 钩')
  })

  // ===== ①c app flush 行为级 eval（46/93 同款 with(Proxy) 沙箱：造 dirty 态 → flush → host 收到 update；到期不双保存） =====
  function bootAppEditor103(rpcImpl) {
    const calls = []
    const els = {}
    const mkEl = () => ({ style: {}, classList: { toggle() {}, add() {}, remove() {}, contains() { return false } }, value: '', textContent: '', innerHTML: '', className: '', readOnly: false, contentEditable: 'true', addEventListener() {}, removeEventListener() {}, querySelectorAll() { return [] }, closest() { return null }, focus() {}, _bound: false })
    const target = {
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      notes: [{ id: 'n1', title: '旧标题', tags: [], folder: '', kind: 'note', status: 'active', topic: '开发' }],
      selId: null, edNote: null, edLoading: false, edBodyLoaded: false, edBodyErr: '',
      edMode: 'source', richDirty: false, composing: false, degraded: { ok: true, reasons: [] },
      wikiBodies: {}, foldOpen: {}, histCount: null, saveTimer: null, scopeOpen: false, savedRange: null,
      richSyncTimer: null, degTimer: null,
      draftNote: null, draftCreating: false,
      rpc: (m, a) => { calls.push({ method: m, args: JSON.parse(JSON.stringify(a || {})), via: 'rpc' }); return rpcImpl(m, a) },
      rpcKeepalive: (m, a) => { calls.push({ method: m, args: JSON.parse(JSON.stringify(a || {})), via: 'keepalive' }); return Promise.resolve({ ok: true }) },
      serializeRich: () => target.__richMd || '',   /* 内核桩：富文本序列化产物由用例注入 */
      draftPayloadOf: (d) => d && ((d.title || '').trim() || (d.body || '').trim()) ? { title: d.title, body: d.body, tags: [], kind: d.kind || 'note', status: 'active', inject: false, injectTo: [], recall: true, sensitive: false } : null,   /* newnote.js 桩：本节只断言 flush 路由，草稿载荷构造归节 49 */
      $: (id) => (els[id] = els[id] || mkEl()),
      t: (k, vars) => { let s = ZH103[k]; if (s == null) return k; if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m)); return s },
      toast: () => {}, analyzeMarkdown: () => ({ ok: true, reasons: [] }),
      renderMarkdown: (s) => 'HTML:' + s,
      renderTree() {}, renderCrumb() {}, renderMeta() {}, renderDispatches() {}, renderEdFoot() {}, renderBacklinks() {},
      loadNotes() { return Promise.resolve() }, probeHistCount() {}, saveFoldOpen() {},
      icon: () => '', esc: (s) => String(s), wikiResolve: (s) => s,
    }
    const proxy = new Proxy(target, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; if (k in t2) return t2[k]; const f = function () {}; t2[k] = f; return f },
      set(t2, k, v) { t2[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + appEd + '\n; __api = { selectNote: selectNote, loadEdBody: loadEdBody, doSave: doSave, triggerSave: triggerSave, flushPendingSave: flushPendingSave, buildSavePayload: buildSavePayload } }')(proxy)
    return { target: target, calls: calls, els: els, api: target.__api }
  }
  const tick103 = () => new Promise(r => setTimeout(r, 0))
  await t('0.4.7-C app flush（行为）：dirty 态触发关闭钩 → host 立即收到 notes-update（不等到期）+ 到期回调不双保存', async () => {
    const env = bootAppEditor103((m) => m === 'notes-get' ? Promise.resolve({ note: { id: 'n1', title: '旧标题', body: '真实正文', tags: [], kind: 'note', status: 'active' } }) : Promise.resolve({}))
    env.api.selectNote('n1')
    await tick103(); await tick103()
    assert(env.target.edBodyLoaded === true, '前提：正文已加载（提交闸开）')
    /* 造 dirty 态：源码打字 → triggerSave 排在途 900ms debounce */
    env.target.edNote.body = '真实正文 + 关闭前最后一击'
    env.api.triggerSave()
    assert(env.target.saveTimer !== null, '前提：debounce 在途（<900ms 窗口）')
    assert(env.calls.filter(c => c.method === 'notes-update').length === 0, '前提：窗口内尚未保存')
    /* 触发关闭钩（beforeunload 等价物）→ 立即落盘 */
    env.api.flushPendingSave()
    assert(env.target.saveTimer === null, 'flush 后在途 debounce 已取消')
    const upds = env.calls.filter(c => c.method === 'notes-update')
    assert(upds.length === 1 && upds[0].via === 'keepalive', 'flush 立即直发一次 notes-update（keepalive 通道；实得 ' + upds.length + ' 次）')
    assert(upds[0].args.body === '真实正文 + 关闭前最后一击', 'flush 载荷携带最后一击正文（实得 ' + JSON.stringify(upds[0].args.body) + '）')
    /* 等过 900ms 窗口：到期回调空转，不双保存 */
    await new Promise(r => setTimeout(r, 1000))
    assert(env.calls.filter(c => c.method === 'notes-update').length === 1, 'debounce 到期后仍恰 1 次保存（不双保存；实得 ' + env.calls.filter(c => c.method === 'notes-update').length + '）')
  })
  await t('0.4.7-C app flush（行为）：富文本在途先序列化再落盘 + 无在途零动作 + R-1 失败态暂停继承', async () => {
    /* 富文本在途：richDirty + serializeRich 桩产物 → flush 载荷带序列化正文 */
    const env = bootAppEditor103((m) => m === 'notes-get' ? Promise.resolve({ note: { id: 'n1', title: '旧标题', body: '真实正文', tags: [], kind: 'note', status: 'active' } }) : Promise.resolve({}))
    env.api.selectNote('n1')
    await tick103(); await tick103()
    env.target.edMode = 'rich'; env.target.richDirty = true; env.target.__richMd = '富文本在途编辑'
    env.api.flushPendingSave()   /* saveTimer 虽空，富文本在途仍须先序列化落盘 */
    const upds = env.calls.filter(c => c.method === 'notes-update')
    assert(upds.length === 1 && upds[0].args.body === '富文本在途编辑', '富文本在途序列化后进 flush 载荷（实得 ' + JSON.stringify(upds[0] && upds[0].args.body) + '）')
    assert(env.target.richDirty === false, '序列化后 dirty 复位')
    /* 无在途零动作 */
    const env2 = bootAppEditor103(() => Promise.resolve({}))
    env2.api.flushPendingSave()
    assert(env2.calls.filter(c => c.method === 'notes-update' || c.method === 'notes-create').length === 0, '无在途（saveTimer 空且无富文本脏）flush 零动作')
    /* R-1 失败态暂停继承：edBodyErr 在窗 flush 零提交（与 doSave 同口径） */
    const env3 = bootAppEditor103((m) => m === 'notes-get' ? Promise.resolve({ error: 'E2E模拟错误' }) : Promise.resolve({}))
    env3.api.selectNote('n1')
    await tick103(); await tick103()
    assert(env3.target.edBodyErr !== '', '前提：失败安全态在窗')
    env3.target.edNote.title = '改名尝试'; env3.api.triggerSave(); env3.api.flushPendingSave()
    assert(env3.calls.filter(c => c.method === 'notes-update').length === 0, '失败安全态 flush 零提交（R-1 暂停语义继承）')
    /* 草稿在途：create 通道走 keepalive */
    const env4 = bootAppEditor103(() => Promise.resolve({}))
    env4.target.draftNote = { id: '', title: '草稿标题', body: '草稿正文', kind: 'note', status: 'active', tags: [], topic: '', folder: '', inject: false, injectTo: [], recall: true, sensitive: false, injectRole: 'convention', _tagsStr: null }
    env4.target.edNote = env4.target.draftNote; env4.target.edBodyLoaded = true; env4.target.selId = null
    env4.target.saveTimer = setTimeout(function () {}, 60000)   /* 模拟在途 debounce（用例内不点火） */
    env4.api.flushPendingSave()
    const crs = env4.calls.filter(c => c.method === 'notes-create')
    assert(crs.length === 1 && crs[0].via === 'keepalive' && crs[0].args.title === '草稿标题', '草稿在途 flush 走 notes-create keepalive（实得 ' + crs.length + '）')
  })

  // ===== ②a 失败态同步点统一：静态锚 + i18n parity + 行为级 =====
  await t('0.4.7-C ②a 失败态同步点统一（双端同口径）：err 红点 + editor.syncFailed 文案', () => {
    assert(cliEd.indexOf("className: 'dsh-notes-rtb-sync' + (edLoadErr ? ' err' :") >= 0, 'client 同步点缺失败态 err 分支')
    assert(cliEd.indexOf("edLoadErr ? tt('editor.syncFailed')") >= 0, 'client 同步点缺失败文案分支')
    assert(appEd.indexOf("pill.className = 'sync' + (edBodyErr ? ' err' :") >= 0, 'app setSyncStatus 缺失败态 err 分支')
    assert(appEd.indexOf("$('syncTxt').textContent = edBodyErr ? t('editor.syncFailed')") >= 0, 'app setSyncStatus 缺失败文案分支')
    assert(appEd.indexOf('setSyncStatus(false);\n}') >= 0 || appEd.indexOf('setSyncStatus(false);') >= 0, 'refreshLoadErrUI 未接管同步点（失败进出须收敛同一呈现）')
    assert(cssDev.indexOf('.dsh-notes-rtb-sync.err .dsh-notes-rtb-sync-sd{background:var(--ndanger)}') >= 0, 'styles.css 缺失败红点样式')
    assert(appHead.indexOf('.rtb .sync.err .sd{background:var(--ndanger)}') >= 0, 'app head.html 缺失败红点样式')
  })
  await t('0.4.7-C ②a i18n：editor.syncFailed 双字典同键（zh 加载失败 / en Load failed）', () => {
    assert(ZH103['editor.syncFailed'] === '加载失败', 'zh 字典 editor.syncFailed 缺/误（实得 ' + ZH103['editor.syncFailed'] + '）')
    assert(EN103['editor.syncFailed'] === 'Load failed', 'en 字典 editor.syncFailed 缺/误（实得 ' + EN103['editor.syncFailed'] + '）')
  })
  await t('0.4.7-C ②a 失败态同步点（行为）：notes-get 失败 → 红点「加载失败」（不滞留橙/冒绿）→ 重试成功回绿', async () => {
    let fail = true
    const env = bootAppEditor103((m) => (m === 'notes-get' && fail) ? Promise.resolve({ error: 'E2E模拟错误' }) : Promise.resolve(m === 'notes-get' ? { note: { id: 'n1', title: '旧标题', body: '真实正文', tags: [], kind: 'note', status: 'active' } } : {}))
    env.target.edMode = 'rich'
    env.api.selectNote('n1')
    await tick103(); await tick103()
    assert(env.target.edBodyErr !== '', '前提：失败安全态在窗')
    assert(env.els.syncPill.className === 'sync err', '失败态同步点须红点 err（实得 ' + env.els.syncPill.className + '；旧口径滞留 sync 橙/sync ok 绿）')
    assert(env.els.syncTxt.textContent === ZH103['editor.syncFailed'], '失败态同步点文案 = 字典 editor.syncFailed（实得 ' + env.els.syncTxt.textContent + '）')
    fail = false
    env.api.loadEdBody('n1')   /* 横幅「重试」等价链路 */
    await tick103(); await tick103()
    assert(env.els.syncPill.className === 'sync ok' && env.els.syncTxt.textContent === ZH103['editor.synced'], '重试成功同步点回绿「已同步源码」（实得 ' + env.els.syncPill.className + '）')
  })

  // ===== ②b 源码模式在途窗补锁：静态锚 + 行为级 =====
  await t('0.4.7-C ②b 源码模式在途窗补锁（双端同款 readOnly + placeholder「正文加载中」口径不动）', () => {
    assert(cliEd.indexOf('readOnly: !!(edLoadErr || edBodyPending)') >= 0, 'client 源码 textarea 在途窗锁缺失（旧口径只锁失败态）')
    assert(appEd.indexOf('ta.readOnly = locked || edBodyPending()') >= 0, 'app 源码 textarea 在途窗锁缺失（旧口径只锁失败态）')
    assert(appEd.indexOf("ta.placeholder = edBodyPending() ? t('editor.bodySyncing') : t('editor.bodyPlaceholder')") >= 0, '在途 placeholder 口径锚（节 94 同守）')
    assert(cliEd.indexOf("placeholder: edBodyPending ? tt('editor.bodySyncing') : tt('editor.bodyPlaceholder')") >= 0, 'client 在途 placeholder 口径锚（节 94 同守）')
  })
  await t('0.4.7-C ②b 源码在途窗（行为）：notes-get 挂起期 edSrc.readOnly=true（打字窗封死）→ 落定解锁', async () => {
    let resolveGet = null
    const env = bootAppEditor103((m) => m === 'notes-get' ? new Promise(r => { resolveGet = r }) : Promise.resolve({}))
    env.api.selectNote('n1')
    assert(env.target.edBodyLoaded === false && env.target.edBodyErr === '', '前提：在途窗内（未加载无错误）')
    assert(env.els.edSrc.readOnly === true, '在途窗源码 textarea 须锁只读（实得 ' + env.els.edSrc.readOnly + '；旧口径 false 可打字 = 假同步洞）')
    assert(env.els.edSrc.placeholder === ZH103['editor.bodySyncing'], '在途窗 placeholder「正文加载中…」（实得 ' + env.els.edSrc.placeholder + '）')
    resolveGet({ note: { id: 'n1', title: '旧标题', body: '真实正文', tags: [], kind: 'note', status: 'active' } })
    await tick103(); await tick103()
    assert(env.els.edSrc.readOnly === false, '落定后源码解锁可编辑')
    assert(env.els.edSrc.value === '真实正文', '落定后正文回填（实得 ' + env.els.edSrc.value + '）')
  })

  // ===== ③ 产物同步锚（改 src 后须跑 build-dist/concat-app） =====
  await t('0.4.7-C 产物同步：app.html + 发布包 lib/client.js 双端含本卡锚（i18n 键随产物下发）', () => {
    for (const k of ['function flushPendingSave()', 'function rpcKeepalive(method, args)', 'beforeunload', 'editor.syncFailed', '.sync.err']) {
      assert(appHtml.indexOf(k) >= 0, 'app.html 缺锚：' + k + '（改 src/app/** 后需跑 node scripts/build-dist.cjs）')
    }
    for (const k of ['flushPendingEdits', 'autoSavePendingRef', 'beforeunload', 'editor.syncFailed', "edLoadErr ? ' err'"]) {
      assert(clientPkgSrc.indexOf(k) >= 0, '发布包 lib/client.js 缺锚：' + k + '（改 src/client/** 后需跑 node scripts/build-dist.cjs）')
    }
    const cssPkg = read(path.join('packages', 'dsh-notes-plugin', 'lib', 'styles.css'))
    assert(cssPkg.indexOf('.dsh-notes-rtb-sync.err .dsh-notes-rtb-sync-sd{background:var(--ndanger)}') >= 0, '发布包 lib/styles.css 缺失败红点样式（改 src/styles.css 后需跑 node scripts/build-dist.cjs）')
    assert(clientSrc.indexOf('flushPendingEdits') >= 0, 'client 拼接产物含 flushPendingEdits（src/client/** 拼接直出）')
  })
  }
}
