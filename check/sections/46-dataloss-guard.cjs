// 节 46. 数据丢失防护（R-1 P0：get 失败安全态 + 空正文覆盖兜底 + 行为断言）
// 背景（分诊 n-mut77uold038 / 实证 n-mus81wo5l1kr）：notes-get 失败时空 catch → 编辑器空 body 假象 → 自动保存 body:"" 覆盖服务端正文。
// 三防线：①client 安全态（edBodyLoaded 正向提交闸 + edBodyErr 锁定横幅/重试，app.html 与 React 面板双端）；
// ②host 兜底（_update empty-body-overwrite-guard：空串覆盖非空拒绝，confirmClearBody 显式放行——错得安全选型=拒绝不墓碑，理由见块内注释）；
// ③本节行为断言（含 app 编辑器真实代码路径仿真：src/app/panels/editor.js 纯函数声明经 with(Proxy) 沙箱 eval，mock rpc 驱动）。
module.exports = {
  id: "46",
  title: "46. 数据丢失防护（R-1：get 失败安全态 + 空正文覆盖兜底）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { handlers, findTool, NOTES_ROOT_STATIC, admMock, agentsMock, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('46. 数据丢失防护（R-1：get 失败安全态 + 空正文覆盖兜底）')

  // ===== 46.1 host 兜底行为（开发版内存实例）=====
  const c46 = await handlers['notes-create']({ title: 'R1防护样本', body: '原始正文非空', tags: [], topic: '开发' })
  const rej46 = await handlers['notes-update']({ id: c46.id, body: '' })
  await t('R-1 host 兜底：空 body 覆盖非空正文被拒绝（错误指引 confirmClearBody）', () => {
    assert(rej46 && rej46.error, '应返回 error（实得 ' + JSON.stringify(rej46) + '）')
    assert(rej46.error.indexOf('confirmClearBody') >= 0, '错误信息应指引显式确认参数：' + rej46.error)
  })
  const g46 = await handlers['notes-get']({ id: c46.id })
  await t('R-1 host 兜底：拒绝后原正文字节不动', () => assert.strictEqual(g46.note.body, '原始正文非空'))
  const ok46 = await handlers['notes-update']({ id: c46.id, body: '', confirmClearBody: true })
  const g46b = await handlers['notes-get']({ id: c46.id })
  const ok46b = await handlers['notes-update']({ id: c46.id, body: '' })   // 空→空（已空）不得误拦
  const ok46c = await handlers['notes-update']({ id: c46.id, title: 'R1防护样本改' })   // body 缺省（undefined）不受影响
  await t('R-1 host 兜底：confirmClearBody:true 放行清空 + 空→空不误拦 + 元数据更新不受影响', () => {
    assert(!ok46.error, '显式确认应放行（实得 ' + JSON.stringify(ok46) + '）')
    assert.strictEqual(g46b.note.body, '', '确认后正文已清空')
    assert(!ok46b.error, '空→空不得误拦（实得 ' + JSON.stringify(ok46b) + '）')
    assert(!ok46c.error, 'body 缺省（undefined）不动正文（实得 ' + JSON.stringify(ok46c) + '）')
  })
  await t('R-1 note_manage 工具同闸：空 body 覆盖被拒 + confirmClearBody 放行 + schema 登记', async () => {
    const nm = findTool('note_manage')
    await nm.execute({ action: 'update', id: c46.id, body: '恢复非空正文' })
    const rejM = await nm.execute({ action: 'update', id: c46.id, body: '' })
    assert(rejM && rejM.error && rejM.error.indexOf('confirmClearBody') >= 0, '工具路径同被拦截（实得 ' + JSON.stringify(rejM) + '）')
    const okM = await nm.execute({ action: 'update', id: c46.id, body: '', confirmClearBody: true })
    assert(okM && !okM.error && okM.action === 'update', '显式确认应放行（实得 ' + JSON.stringify(okM) + '）')
    assert(nm.parameters.properties.confirmClearBody, '工具 schema 应登记 confirmClearBody')
  })

  // ===== 46.2 双包同步静态断言（host 开发版拼接 ⇄ 静态包 index.mjs）=====
  await t('R-1 空覆盖闸双包逐字节同步（empty-body-overwrite-guard 标记块）+ 透传链路齐全', () => {
    const mRe = /\/\/ ==== empty-body-overwrite-guard BEGIN ====[\s\S]*?\/\/ ==== empty-body-overwrite-guard END ====/
    const bDev = hostSrc.match(mRe), bDist = indexSrc.match(mRe)
    assert(bDev && bDist, '开发版拼接与静态包均须含 empty-body-overwrite-guard 标记块')
    assert.strictEqual(bDev[0], bDist[0], '标记块双包逐字节一致（notes.js ⇄ notes.dist.js 改一边忘另一边）')
    for (const pair of [['host 开发版', hostSrc], ['静态包 index.mjs', indexSrc]]) {
      assert(pair[1].indexOf('confirmClearBody: args.confirmClearBody === true') >= 0, pair[0] + ' notes-update RPC / note_manage 透传 confirmClearBody')
      assert(pair[1].indexOf("confirmClearBody: { type: 'boolean'") >= 0, pair[0] + ' note_manage schema 登记 confirmClearBody')
    }
  })

  // ===== 46.3 app 编辑器安全态行为断言（真实代码路径仿真）=====
  const EDITOR_SRC = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'panels', 'editor.js'), 'utf8')
  function bootAppEditor(rpcImpl) {
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
      draftNote: null, draftCreating: false,   /* notes-034-batch3 新建草稿态：非草稿路径（null）不打蔫 R-1 既有断言 */
      rpc: (m, a) => { calls.push({ method: m, args: JSON.parse(JSON.stringify(a || {})) }); return rpcImpl(m, a) },
      $: (id) => (els[id] = els[id] || mkEl()),
      toast: () => {}, analyzeMarkdown: () => ({ ok: true, reasons: [] }),
      renderTree() {}, renderCrumb() {}, renderMeta() {}, renderDispatches() {}, renderEdFoot() {}, renderBacklinks() {},
      loadNotes() { return Promise.resolve() }, probeHistCount() {}, saveFoldOpen() {},
      icon: () => '', esc: (s) => String(s), wikiResolve: (s) => s,
    }
    // with(Proxy) 沙箱：未声明标识符 → noop 函数兜底（editor.js 纯函数声明，跨文件依赖全部经代理打桩）
    const proxy = new Proxy(target, {
      has(t, k) { if (typeof k === 'symbol') return false; return (k in t) || !(k in globalThis) },
      get(t, k) { if (typeof k === 'symbol') return undefined; if (k in t) return t[k]; const f = function () {}; t[k] = f; return f },
      set(t, k, v) { t[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + EDITOR_SRC + '\n; __api = { selectNote: selectNote, loadEdBody: loadEdBody, doSave: doSave, refreshLoadErrUI: refreshLoadErrUI } }')(proxy)   /* 裸赋值经 proxy set 落 target（写 scope.xxx 会被 has 陷阱截胡成 noop） */
    return { target: target, calls: calls, els: els, api: target.__api }
  }
  const tick46 = () => new Promise(r => setTimeout(r, 0))
  await t('R-1 app 编辑器安全态（行为）：notes-get 返回 {error} → 改标题触发 doSave 不产生任何 notes-update', async () => {
    const env = bootAppEditor((m) => m === 'notes-get' ? Promise.resolve({ error: 'E2E模拟错误' }) : Promise.resolve({}))
    env.api.selectNote('n1')
    await tick46(); await tick46()
    assert(env.target.edBodyLoaded === false, 'get 失败后正文提交闸保持关闭')
    assert(String(env.target.edBodyErr).indexOf('正文加载失败') === 0, '安全态错误已置（实得 ' + env.target.edBodyErr + '）')
    assert(env.els.edLoadErr && env.els.edLoadErr.style.display === 'flex', '失败横幅已显示')
    assert(env.els.edSrc.readOnly === true, '正文已锁定只读')
    env.target.edNote.title = '改名尝试'   // 模拟用户在安全态下改标题 → 触发保存路径
    await env.api.doSave()
    await tick46()
    const upds = env.calls.filter(c => c.method === 'notes-update')
    assert.strictEqual(upds.length, 0, '安全态下不得产生任何 notes-update（实得 ' + upds.length + ' 次）——原 bug 路径（body:"" 覆盖）已堵')
  })
  await t('R-1 app 编辑器安全态（行为）：notes-get 网络异常（reject）→ 零 notes-update + 重试恢复解锁', async () => {
    let fail = true
    const env = bootAppEditor((m) => (m === 'notes-get' && fail) ? Promise.reject(new Error('boom')) : Promise.resolve(m === 'notes-get' ? { note: { id: 'n1', title: '旧标题', body: '真实正文', tags: [], kind: 'note', status: 'active' } } : {}))
    env.api.selectNote('n1')
    await tick46(); await tick46()
    assert(String(env.target.edBodyErr).indexOf('boom') >= 0 && env.target.edBodyLoaded === false, 'reject 路径进入安全态')
    await env.api.doSave()
    await tick46()
    assert.strictEqual(env.calls.filter(c => c.method === 'notes-update').length, 0, '安全态零 notes-update')
    fail = false
    env.api.loadEdBody('n1')   // 等价横幅「重试」按钮 handler
    await tick46(); await tick46()
    assert(env.target.edBodyErr === '' && env.target.edBodyLoaded === true, '重试成功后解锁放行')
    assert(env.els.edSrc.readOnly === false, '正文锁定解除')
  })
  await t('R-1 app 编辑器（行为）：get 成功后清空正文 → notes-update 携带 body:"" + confirmClearBody:true（合法清空链路）', async () => {
    const env = bootAppEditor((m) => m === 'notes-get' ? Promise.resolve({ note: { id: 'n1', title: '旧标题', body: '真实正文', tags: [], kind: 'note', status: 'active' } }) : Promise.resolve({}))
    env.api.selectNote('n1')
    await tick46(); await tick46()
    assert(env.target.edBodyLoaded === true, '加载成功放行 body 提交')
    env.target.edNote.body = ''   // 用户在已加载基底上清空正文（有意为之）
    await env.api.doSave()
    await tick46()
    const upds = env.calls.filter(c => c.method === 'notes-update')
    assert.strictEqual(upds.length, 1, '产生一次保存（实得 ' + upds.length + '）')
    assert(upds[0].args.body === '', '携带空 body（合法清空）')
    assert(upds[0].args.confirmClearBody === true, '附显式确认过 host 兜底闸')
  })

  // ===== 46.4 客户端双端同步静态断言（app.html 产物 + React 面板拼接源）=====
  await t('R-1 客户端安全态双端同步：app.html + React 面板（提交闸/锁定横幅/显式确认）', () => {
    const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    for (const k of ['function loadEdBody', 'edBodyLoaded', 'edBodyErr', 'edLoadErr', 'edLoadRetry', 'refreshLoadErrUI', 'confirmClearBody']) {
      assert(appSrc.indexOf(k) >= 0, 'app.html 缺安全态标记：' + k + '（改 src/app/** 后需跑 node scripts/concat-app.cjs 或 build-dist.cjs）')
    }
    for (const k of ['function loadEdBody', 'edBodyLoadedRef', 'edLoadErr', 'dsh-notes-load-err', 'confirmClearBody']) {
      assert(clientSrc.indexOf(k) >= 0, 'React 面板缺安全态标记：' + k)
    }
  })

  // ===== 46.5 静态包行为（独立 ESM 实例 + 独立内存库，模式同节 22.5）=====
  const store46 = new Map()
  const fsMock46 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_ROOT_STATIC ? { dir: true } : (store46.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store46.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store46.has(p)) throw new Error('ENOENT: ' + p); return store46.get(p) },
    writeText: async (p, c) => { store46.set(p, c) },
  }
  const routes46 = []
  const ctx46 = {
    fs: fsMock46, sandboxPolicy: { resolve: () => ({}) },
    webServer: { register: (r) => { routes46.push(r); return () => {} } },
    tools: { register: () => () => {} },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: () => () => {},
  }
  const mod46 = await import(pathToFileURL(INDEX_PATH).href + '?dataloss46=1')
  mod46.apply(ctx46)
  function rpc46(method, args) {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify({ method: method, args: args }))
      const req = { method: 'POST', on: (ev, cb) => { if (ev === 'data') cb(body); else if (ev === 'end') cb(); return req }, destroy: () => {} }
      const res = { statusCode: 0, setHeader: () => {}, writeHead: (c) => { res.statusCode = c }, end: (s) => { let b; try { b = JSON.parse(s) } catch (e) { b = s } resolve({ status: res.statusCode, body: b }) } }
      Promise.resolve(routes46[0].handler(req, res)).catch(reject)
    })
  }
  await t('R-1 静态包 index.mjs 行为：空覆盖拒 / 确认放行 / 拒绝后原文不动（webServer RPC 通道）', async () => {
    const c = await rpc46('notes-create', { title: 'R1静态包样本', body: '静态包原始正文', tags: [], topic: '开发' })
    assert(c.body && c.body.id, '静态包建笔记（实得 ' + JSON.stringify(c.body) + '）')
    const rej = await rpc46('notes-update', { id: c.body.id, body: '' })
    assert(rej.body && rej.body.error && rej.body.error.indexOf('confirmClearBody') >= 0, '静态包拦截（实得 ' + JSON.stringify(rej.body) + '）')
    const g = await rpc46('notes-get', { id: c.body.id })
    assert(g.body && g.body.note && g.body.note.body === '静态包原始正文', '拒绝后原文不动')
    const ok = await rpc46('notes-update', { id: c.body.id, body: '', confirmClearBody: true })
    assert(ok.body && !ok.body.error, '显式确认放行（实得 ' + JSON.stringify(ok.body) + '）')
  })
  }
}
