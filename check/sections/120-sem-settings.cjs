// 节 120. 0.5.0④ 语义检索设置区（notes-050-sem-settings：总开关+后端下拉+索引状态行+构建按钮+模型管理，入驻「检索与注入」组）
// 冻结架构 [[n-muz9b97x35et]] + spike [[n-muz91f19rrqj]]。本卡接①的 notes-vectors-status/rebuild 通道 + ②的 wasm-embedder（模型下载/删除/状态）。
// 断言面：①三端语义节渲染 + SET_GROUPS 登记（inject 组尾）；②enabled+backend 双键整写（settings-set 整对象替换口径，单写丢 enabled）；
//   ③激活流程自动回填（打开总开关 → notes-vectors-rebuild，否则存量不入队 indexed<indexable 静默漏历史）；
//   ④构建按钮触发 rebuild（fake 走 host / bge 走浏览器 wasm 编排 wasmModelEnsureDownloaded + notes-vectors-put 全量回写）；
//   ⑤模型删除 → 状态回落（wasmModelDelete + 清 semantic.model）；⑥wasm 运行时镜像链=[jsdelivr 主→unpkg 兜底] 且不含 npmmirror（0.5.0④ 主窗口裁决）。
//   ⑦host 行为级：启用开关后存量不入队（indexed=0）→ rebuild 回填（indexed=indexable）。
module.exports = {
  id: "120",
  title: "120. 0.5.0④ 语义检索设置区（总开关+后端下拉+状态行+构建按钮+模型管理，notes-050-sem-settings）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc } = H
  section('120. 0.5.0④ 语义检索设置区（notes-050-sem-settings）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8')
  const appSettings = read('src/app/modals/settings.js')
  const cliSettings = read('src/client/modals/settings.js')
  const proto = read('design/notes-ui-v2.html')
  const embSrc = read('src/app/kernel/wasm-embedder.js')

  // ===== 120.1 三端语义节渲染 + SET_GROUPS 登记 =====
  await t('三端语义节渲染：SET_GROUPS inject 组登记 semantic + data-sec/key 锚 + 五控件（开关/后端/状态/构建/模型）', () => {
    for (const [label, src] of [['app', appSettings], ['原型', proto]]) {
      const m = src.match(/SET_GROUPS = \[([\s\S]*?)\n\s*\];?/)
      const rows = new Function('return [' + m[1] + ']')().find(g => g.id === 'inject').rows
      assert(rows[rows.length - 1] === 'semantic', label + ' inject 组尾登记 semantic（实得 ' + JSON.stringify(rows) + '）')
      assert(src.indexOf('data-sec="semantic"') >= 0, label + ' semantic 行壳 data-sec 锚在案')
      for (const id of ['setSemEnabled', 'setSemBackend', 'setSemStatus', 'setSemBuild', 'setSemModel']) {
        assert(src.indexOf('id="' + id + '"') >= 0, label + ' 控件 #' + id + ' 在案')
      }
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

  // ===== 120.4 构建按钮触发 rebuild（0.5.0 R2：双端恒走 host rebuild；浏览器 wasm 编排退役不再被调用——R3 才删码，本卡只改路由）=====
  await t('构建按钮触发 rebuild：0.5.0 R2（notes-051-save-embed）起 app 恒走 host notes-vectors-rebuild（bge 已迁回 host；wasmBuildIndex 编排不再被调用）', () => {
    assert(appSettings.indexOf('function semDoBuild(') >= 0, 'app semDoBuild 定义')
    assert(appSettings.indexOf("rpc('notes-vectors-rebuild', { backend: backend })") >= 0, 'app semDoBuild 恒调 host rebuild（单一路由）')
    assert(appSettings.indexOf('wasmBuildIndex(') < 0 && appSettings.indexOf('typeof wasmBuildIndex') < 0, 'app 不再调用 wasmBuildIndex 编排（R2 路由切换；代码 R3 才删）')
    assert(embSrc.indexOf('function wasmBuildIndex(') >= 0, 'wasm-embedder 仍定义 wasmBuildIndex 编排（R3 才删码——本卡只改路由，代码保留）')
    assert(embSrc.indexOf('wasmModelEnsureDownloaded(onProgress)') >= 0 && embSrc.indexOf("rpc('notes-vectors-put'") >= 0, 'wasmBuildIndex = 模型下载 + notes-vectors-put 全量回写（编排体未动）')
    assert(embSrc.indexOf('function wasmChunkText(') >= 0 && embSrc.indexOf('function wasmBodyHash(') >= 0, '浏览器分段嵌入 + bodyHash 同口径 helper 在案')
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

  // ===== 120.5 模型管理（删除/重下 + 状态回落）=====
  await t('模型管理：删除走 wasmModelDelete + 清 semantic.model（状态回落未下载）；重下走 wasmModelEnsureDownloaded', () => {
    assert(appSettings.indexOf('function semDoModelDelete(') >= 0 && appSettings.indexOf('wasmModelDelete') >= 0, 'app 模型删除消费 wasmModelDelete')
    assert(appSettings.indexOf('semWrite(semState.enabled, semState.backend, null)') >= 0, 'app 删除后清 semantic.model（semWrite model=null）')
    assert(appSettings.indexOf('function semDoModelRedownload(') >= 0 && appSettings.indexOf('wasmModelEnsureDownloaded') >= 0, 'app 模型重下消费 wasmModelEnsureDownloaded')
    assert(embSrc.indexOf('function wasmModelDelete(') >= 0 && embSrc.indexOf('function wasmModelEnsureDownloaded(') >= 0, 'wasm-embedder 提供删除/确保下载通道')
  })

  // ===== 120.6 wasm 运行时镜像链=[jsdelivr 主→unpkg 兜底] 且不含 npmmirror =====
  await t('wasm 运行时镜像链=[jsdelivr 主→unpkg 兜底] 且不含 npmmirror（npmmirror 实证 403/404 不可达）', () => {
    const m = embSrc.match(/var WASM_RUNTIME_URLS = \[([\s\S]*?)\]/)
    assert(m, 'WASM_RUNTIME_URLS 链可提取')
    assert(m[1].indexOf('jsdelivr') >= 0, '运行时链含 jsdelivr（主）')
    assert(m[1].indexOf('unpkg') >= 0, '运行时链含 unpkg（兜底）')
    assert(m[1].indexOf('npmmirror') < 0, '运行时链不含 npmmirror（红线，实证不可达）')
    assert(embSrc.indexOf('async function wasmImportRuntime()') >= 0 && embSrc.indexOf('return await import(url)') >= 0, '运行时 failover import（按序尝试镜像链）')
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
    assert(rb && rb.ok === true && rb.indexed === 2, 'rebuild 回填存量（indexed=2）')
    const st2 = await handlers['notes-vectors-status']({})
    assert(st2 && st2.indexed === 2 && st2.indexable === 2, '回填后 indexed=indexable=2')
  })
  }
}
