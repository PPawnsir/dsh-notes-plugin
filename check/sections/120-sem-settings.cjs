// 节 120. 0.5.0④ 语义检索设置区（notes-050-sem-settings：总开关+后端下拉+索引状态行+构建按钮，入驻「检索与注入」组）
// 冻结架构 [[n-muz9b97x35et]] + spike [[n-muz91f19rrqj]]。本卡接①的 notes-vectors-status/rebuild 通道。
// 0.5.0 R3（notes-051-query-embed）：浏览器嵌入路径整体退役——模型管理行/浏览器运行时拉取链/浏览器专有 i18n 键一并拆除（120.4~120.6 改写）。
// 断言面：①三端语义节渲染 + SET_GROUPS 登记（inject 组尾；四控件 + 模型行退役锚）；②enabled+backend 双键整写（settings-set 整对象替换口径，单写丢 enabled）；
//   ③激活流程自动回填（打开总开关 → notes-vectors-rebuild，否则存量不入队 indexed<indexable 静默漏历史）；
//   ④构建按钮恒走 host rebuild（浏览器嵌入编排删码）；⑤模型管理行退役 + i18n 键清理；⑥运行时拉取链退役（app bundle 零引用）；
//   ⑦host 行为级：启用开关后存量不入队（indexed=0）→ rebuild 回填（indexed=indexable）。
module.exports = {
  id: "120",
  title: "120. 0.5.0④ 语义检索设置区（总开关+后端下拉+状态行+构建按钮；R3 模型行/拉取链退役，notes-050-sem-settings → notes-051-query-embed）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc } = H
  section('120. 0.5.0④ 语义检索设置区（notes-050-sem-settings）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appSettings = read('src/app/modals/settings.js')
  const cliSettings = read('src/client/modals/settings.js')
  const proto = read('design/notes-ui-v2.html')

  // ===== 120.1 三端语义节渲染 + SET_GROUPS 登记 =====
  await t('三端语义节渲染：SET_GROUPS inject 组登记 semantic + data-sec/key 锚 + 四控件（开关/后端/状态/构建；R3 模型行退役）', () => {
    for (const [label, src] of [['app', appSettings], ['原型', proto]]) {
      const m = src.match(/SET_GROUPS = \[([\s\S]*?)\n\s*\];?/)
      const rows = new Function('return [' + m[1] + ']')().find(g => g.id === 'inject').rows
      assert(rows[rows.length - 1] === 'semantic', label + ' inject 组尾登记 semantic（实得 ' + JSON.stringify(rows) + '）')
      assert(src.indexOf('data-sec="semantic"') >= 0, label + ' semantic 行壳 data-sec 锚在案')
      for (const id of ['setSemEnabled', 'setSemBackend', 'setSemStatus', 'setSemBuild']) {
        assert(src.indexOf('id="' + id + '"') >= 0, label + ' 控件 #' + id + ' 在案')
      }
      assert(src.indexOf('id="setSemModel"') < 0, label + ' 模型行 #setSemModel 已拆除（0.5.0 R3：Cache API 模型层退役）')
    }
    const mc = cliSettings.match(/SET_GROUPS = \[([\s\S]*?)\n\s*\];?/)
    const crows = new Function('return [' + mc[1] + ']')().find(g => g.id === 'inject').rows
    assert(crows[crows.length - 1] === 'semantic', 'client inject 组尾登记 semantic')
    assert(cliSettings.indexOf("key: 'semantic', label: tt('settings.semantic')") >= 0, 'client settingsRows semantic 行在案')
    assert(cliSettings.indexOf('dsh-notes-settings-sem') >= 0, 'client 语义控件竖排壳 .dsh-notes-settings-sem 在案')
  })

  // ===== 120.2 enabled+backend 双键整写 =====
  await t('红线①：UI 写 settings.semantic 必须 enabled+backend 双键整写（整对象替换口径，单写 backend 丢 enabled）', () => {
    assert(appSettings.indexOf('function semWrite(') >= 0 && appSettings.indexOf('{ enabled: !!enabled, backend: backend || \'bge-small-zh-q8\' }') >= 0, 'app semWrite 双键整写（enabled+backend）')
    assert(cliSettings.indexOf('{ semantic: { enabled: !!enabled, backend: backend || \'bge-small-zh-q8\' } }') >= 0, 'client semWriteBoth 双键整写（enabled+backend）')
  })

  // ===== 120.3 激活流程自动回填（红线②：开开关 → rebuild）=====
  await t('红线②：打开总开关自动触发 notes-vectors-rebuild 回填存量（否则存量不入队 indexed<indexable 静默漏历史）', () => {
    assert(appSettings.indexOf('function semDoToggle(') >= 0 && appSettings.indexOf('semDoBuild()') >= 0, 'app 开关打开路径调用 semDoBuild（自动回填）')
    assert(appSettings.indexOf("rpc('notes-vectors-rebuild'") >= 0, 'app 构建编排走 notes-vectors-rebuild')
    assert(cliSettings.indexOf('if (on) doSemBuild()') >= 0, 'client 开关打开路径调用 doSemBuild（自动回填）')
    assert(cliSettings.indexOf("host.call('notes-vectors-rebuild'") >= 0, 'client 构建编排走 notes-vectors-rebuild')
  })

  // ===== 120.4 构建按钮触发 rebuild（0.5.0 R3：浏览器嵌入编排删码——双端唯一路由 = host notes-vectors-rebuild）=====
  await t('构建按钮触发 rebuild：app 恒走 host notes-vectors-rebuild（0.5.0 R3 浏览器嵌入编排删码退役，单一路由）', () => {
    assert(appSettings.indexOf('function semDoBuild(') >= 0, 'app semDoBuild 定义')
    assert(appSettings.indexOf("rpc('notes-vectors-rebuild', { backend: backend })") >= 0, 'app semDoBuild 恒调 host rebuild（单一路由）')
    assert(appSettings.indexOf('wasmBuildIndex') < 0 && appSettings.indexOf('wasmModel') < 0 && appSettings.indexOf('wasmImportRuntime') < 0, 'app 设置区零浏览器嵌入编排引用（R3 删码）')
  })

  // ===== 120.4b 失败驻留报错（0.5.0 P0 notes-050-model-proxy：显式构建失败 sticky 报错条含原因）=====
  await t('构建失败 sticky 报错条：semDoBuild 失败走 semShowBuildError（modalErr 含原因）+ bge 失败不回落 host rebuild', () => {
    assert(appSettings.indexOf('function semShowBuildError(') >= 0 && appSettings.indexOf("modalErr(t('settings.semanticBuildFailed'") >= 0, 'semShowBuildError → modalErr（settings.semanticBuildFailed 含原因）')
    assert(appSettings.indexOf('function semClearBuildError(') >= 0, 'semClearBuildError 清除驻留错误（再次构建/成功清零）')
    assert(appSettings.indexOf('var fail = function (err)') >= 0 && appSettings.indexOf('semShowBuildError(msg)') >= 0, 'semDoBuild 失败路径调 semShowBuildError')
    assert(appSettings.indexOf('fail(new Error(r.error))') >= 0, 'host rebuild 结构化 error 也走 sticky 报错')
    assert(appSettings.indexOf(".catch(function () { return rpc('notes-vectors-rebuild'") < 0, 'bge 失败不再回落 host rebuild（误导性「只在浏览器端运行」已拆）')
  })

  // ===== 120.4c 面板（client bundle）失败驻留报错（0.5.0 P0 rev2：client 显式「构建索引」失败 sticky 报错，不静默跳回按钮态）=====
  await t('面板构建失败 sticky 报错条：client doSemBuild 捕获 {error} 走 setError（settings.semanticBuildFailed 含原因），不静默复位', () => {
    assert(cliSettings.indexOf("if (res && res.error) setError(tt('settings.semanticBuildFailed'") >= 0, 'client doSemBuild 结构化 error → setError sticky（含原因）')
    assert(cliSettings.indexOf("setError(tt('settings.semanticBuildFailed', { msg: String(err && err.message || err) }))") >= 0, 'client doSemBuild 网络 reject → setError sticky（含原因）')
    assert(cliSettings.indexOf("setError('')") >= 0 && cliSettings.indexOf('再次构建先清上次驻留错误') >= 0, 'client 构建开始前清上次驻留错误（再次构建/成功才清）')
  })

  // ===== 120.5 模型管理行退役（0.5.0 R3：Cache API 模型层 UI 拆除 + 浏览器专有 i18n 键清理）=====
  await t('模型管理行退役（0.5.0 R3）：双端设置区零模型行/删除/重下控件 + 浏览器专有 i18n 键清理', () => {
    for (const [label, src] of [['app', appSettings], ['client', cliSettings]]) {
      assert(src.indexOf('setSemModel') < 0, label + ' 零 setSemModel 模型行')
      assert(src.indexOf('semDoModelDelete') < 0 && src.indexOf('semDoModelRedownload') < 0 && src.indexOf('semRenderModel') < 0, label + ' 模型管理函数拆除')
      assert(src.indexOf('wasmModelDelete') < 0 && src.indexOf('wasmModelEnsureDownloaded') < 0 && src.indexOf('wasmModelStatus') < 0 && src.indexOf('wasmModelRecordState') < 0, label + ' 零 Cache API 模型层函数消费')
      assert(src.indexOf('semantic.model') < 0, label + ' 零 semantic.model 消费（UI 不持模型态——模型由 host embedder 按需下载）')
    }
    const zhSrc = read('src/i18n/zh.js'), enSrc = read('src/i18n/en.js')
    for (const k of ['semanticModel', 'semanticModelSize', 'semanticModelNone', 'semanticModelDelete', 'semanticModelRedownload', 'semanticDownloading', 'semanticStatusNoModel']) {
      assert(zhSrc.indexOf(k) < 0 && enSrc.indexOf(k) < 0, 'zh/en 双字典清理浏览器专有键：' + k)
    }
  })

  // ===== 120.6 浏览器运行时拉取链退役（0.5.0 R3：镜像链 jsdelivr/unpkg + Cache API 模型层整体拆除，app bundle 零引用）=====
  await t('浏览器运行时拉取链退役（0.5.0 R3）：app bundle 零 WASM_RUNTIME_URLS/wasmImportRuntime/jsdelivr/unpkg/transformers/代理路径引用', () => {
    const { concatApp } = require(path.join(DIR, 'scripts', 'concat-app.cjs'))
    const appBundle = concatApp()
    for (const tok of ['WASM_RUNTIME_URLS', 'wasmImportRuntime', 'wasmBuildIndex', 'wasmModel', 'wasmExtractVecs', 'wasmChunkText', 'wasmBodyHash', 'cdn.jsdelivr', 'unpkg.com', 'transformers.min.js', '/dsh-notes-model', 'dsh-notes-wasm-model']) {
      assert(appBundle.indexOf(tok) < 0, 'app bundle 零引用：' + tok + '（0.5.0 R3 浏览器嵌入路径退役）')
    }
    assert(appSettings.indexOf('typeof wasmModel') < 0, 'app 设置区零 typeof 守卫残留（嵌入模块全局函数消费面清零）')
  })

  // ===== 120.7 后端下拉三态（关/bge/自定义端点禁用）=====
  await t('后端下拉三态：关（value=""）/ 本地 bge-small-zh-q8 / 自定义端点 disabled（占位禁用态，v1 单后端激活）', () => {
    for (const [label, src] of [['app', appSettings], ['原型', proto], ['client', cliSettings]]) {
      assert(src.indexOf('value="bge-small-zh-q8"') >= 0 || src.indexOf("value: 'bge-small-zh-q8'") >= 0, label + ' 后端下拉含本地 bge-small-zh-q8 选项')
      assert(/value=["']custom-endpoint["'][^>]*disabled/.test(src) || /value: 'custom-endpoint', disabled: true/.test(src), label + ' 自定义端点占位 disabled 禁用态')
    }
    assert(appSettings.indexOf("value=\"\">' + t('settings.semanticBackendOff')") >= 0, 'app 后端下拉「关」选项（value=""）')
  })

  // ===== 120.8 host 行为级：启用后存量不入队 → rebuild 回填 =====
  await t('host 行为级：启用开关后存量笔记不入队（indexed=0）→ notes-vectors-rebuild 回填（indexed=indexable）', async () => {
    const NOTES_DIR_W = DIR + '\\notes'
    const VECTORS_PATH = NOTES_DIR_W + '\\vectors.jsonl'
    const store = new Map()
    const fsMock = {
      resolve: async (p) => p,
      stat: async (p) => { if (p === NOTES_DIR_W) return { dir: true }; if (store.has(p)) return { file: true }; const prefix = p + '\\'; for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }; return null },
      listDir: async (p) => { const prefix = p + '\\'; const out = []; for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) }); return out },
      readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
      writeText: async (p, c) => { store.set(p, c) },
    }
    const handlers = {}
    const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    const ctx = {
      fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: S.llmMock, agentDefaultModel: S.admMock, agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
      effect: () => {},
    }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply(ctx)
    await handlers['notes-create']({ title: '存量 A', body: '启用开关之前已存在的笔记正文 A' })
    await handlers['notes-create']({ title: '存量 B', body: '启用开关之前已存在的笔记正文 B' })
    const st0 = await handlers['notes-vectors-status']({})
    assert(st0 && st0.enabled === false && st0.indexed === 0, '初始未启用：enabled=false/indexed=0')
    await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'fake-256' } })
    const st1 = await handlers['notes-vectors-status']({})
    assert(st1 && st1.enabled === true && st1.backend === 'fake-256', '启用 fake-256（status 回显）')
    assert(st1.indexed === 0 && st1.indexable === 2, '启用后存量不入队（indexed=0/indexable=2——回填缺口的实证）')
    const rb = await handlers['notes-vectors-rebuild']({ backend: 'fake-256' })
    assert(rb && rb.ok === true && rb.started === true, 'rebuild 立即返回 started（0.5.0 P1 后台化——RPC 不再同步等全量重建）')
    let st2 = null
    for (let i = 0; i < 500; i++) {   // 0.5.0 P1 轮询承接：building 消旗即完结（fake embedder 数拍内落定）
      st2 = await handlers['notes-vectors-status']({})
      if (st2 && st2.building !== true) break
      await new Promise(r => setTimeout(r, 10))
    }
    assert(st2 && st2.building === false, '后台重建完结（building 消旗）')
    assert(st2 && st2.indexed === 2 && st2.indexable === 2, '回填后 indexed=indexable=2')
  })
  }
}
