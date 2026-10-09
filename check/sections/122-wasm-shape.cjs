// 节 122. 0.5.0 P0-2（notes-050-wasm-shape：wasm 嵌入产出零向量修复——Tensor 双层嵌套 + put 静默丢弃显性化 + 嵌入进度文案）
//   → 0.5.0 R3（notes-051-query-embed）：浏览器嵌入路径整体退役（wasm-embedder.js 删码），本节保留 host 侧显性化断言面。
// 根因（主窗口真机证据，历史留档）：extractor(chunks) 返回单 Tensor [n,512]，旧码 tensors=Array.isArray(out)?out:[out] → map tolist
//   造出 [[[v1],[v2],…]] 双层嵌套（tolist 本身已是 [n][512]），host put 按块展开时 dim≠512 → 静默全丢。
//   形状知识由 host _bgeInferBatch 的 tolist 形状归一继承（R1 host embedder，节 124 看守）。
// 断言面：①host put 双层嵌套非法形状 → dropped 计数 + 全丢 error 面；②面板构建按钮复活（R2，恒调 host rebuild）；
//   ③嵌入进度文案/编排体退役锚（R3：wasm-embedder.js 不存在 + app 零 onEmbedProgress/semanticEmbedding）；
//   ④e2e mock put 镜像 host 显性化 + host 双变体同步。（原 122.1 wasmExtractVecs 形状提取 eval 随模块删码退役。）
module.exports = {
  id: "122",
  title: "122. 0.5.0 P0-2 wasm 嵌入形状修复 → R3 退役（put 显性化 + 面板构建复活 + 编排体删码，notes-050-wasm-shape → notes-051-query-embed）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc } = H
  section('122. 0.5.0 P0-2 wasm 嵌入形状修复 → R3 退役（notes-050-wasm-shape → notes-051-query-embed）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const vsDev = read('src/host/kernel/vector-store.js')
  const vsDist = read('src/host/kernel/vector-store.dist.js')
  const appSettings = read('src/app/modals/settings.js')
  const cliSettings = read('src/client/modals/settings.js')
  const mockSrc = read('scripts/e2e/server.cjs')

  // ===== 122.2 host put 双层嵌套非法形状 → dropped 计数 + 全丢 error 面（fresh 实例）=====
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

  await t('host put 双层嵌套非法形状 → dropped 计数 + 全丢 error 面（静默吞显性化）', async () => {
    const vec512 = new Array(512).fill(0); vec512[0] = 1
    // 旧 bug 形态：vectors = [ [[v1],[v2]] ]（双层嵌套——单元素是嵌套数组，非 [512] 向量）
    const nested = [[vec512, vec512]]
    const bad = await handlers['notes-vectors-put']({ backend: 'bge-small-zh-q8', rows: [{ noteId: 'nested-dim', bodyHash: 'x', vectors: nested }] })
    assert(bad && bad.ok === false && bad.error && bad.written === 0 && bad.dropped === 1, '双层嵌套行全丢 → dropped=1 + error 面（实得 written ' + (bad && bad.written) + '/dropped ' + (bad && bad.dropped) + '）')
    assert(Array.isArray(bad.reasons) && bad.reasons.length === 1 && bad.reasons[0].noteId === 'nested-dim', 'reasons 带出 noteId + 原因')
    // 合法 512 维行仍正常写入（written=1/dropped=0，不被显性化误伤）
    const ok = await handlers['notes-vectors-put']({ backend: 'bge-small-zh-q8', rows: [{ noteId: 'ok-dim', bodyHash: 'y', vectors: [vec512] }] })
    assert(ok && ok.ok === true && ok.written === 1 && ok.dropped === 0, '合法 512 维行写入 written=1/dropped=0（显性化不误伤合法行）')
  })

  // ===== 122.3 面板构建按钮复活（0.5.0 R2 notes-051-save-embed：P0-2 禁用态退役——bge 已迁回 host，恒调 host rebuild）=====
  await t('面板构建按钮复活（0.5.0 R2）：bge 态不再 disabled + 「请到 app 页构建」tooltip 退役（i18n 键清理）+ doSemBuild 恒调 host rebuild', () => {
    assert(cliSettings.indexOf("host.call('notes-vectors-rebuild', { backend: semBackend || 'bge-small-zh-q8' })") >= 0, 'client doSemBuild 恒调 host notes-vectors-rebuild（无 bge 守卫——按钮复活为 host rebuild）')
    assert(cliSettings.indexOf("showToast(tt('settings.semanticBuildBgeOnly'))") < 0, 'bge 兜底只提示不发起 RPC 的守卫已拆')
    assert(cliSettings.indexOf("if (semBackend === 'bge-small-zh-q8')") < 0, 'client doSemBuild bge 兜底守卫已拆（不再拦截 bge 构建）')
    assert(cliSettings.indexOf("disabled: !semEnabled || semBuilding || semBackend === 'bge-small-zh-q8'") < 0, 'client 构建按钮 bge 态 disabled 已拆（复活为可点）')
    assert(cliSettings.indexOf("'data-tooltip': tt('settings.semanticTip')") >= 0, 'client 构建按钮 tooltip 回落通用说明（「请到 app 页构建」提示退役）')
    assert(cliSettings.indexOf('semanticBuildBgeOnly') < 0, 'client 源码零 semanticBuildBgeOnly 残留')
    const zhSrc = read('src/i18n/zh.js'), enSrc = read('src/i18n/en.js')
    assert(zhSrc.indexOf('semanticBuildBgeOnly') < 0 && enSrc.indexOf('semanticBuildBgeOnly') < 0, 'zh/en 双字典 semanticBuildBgeOnly 键清理（tooltip 退役 i18n 键同步拆除）')
  })

  // ===== 122.4 嵌入进度文案与编排体退役（0.5.0 R3：wasm-embedder.js 删码；app semDoBuild 不传 onEmbedProgress，进度由 status 轮询计数承接）=====
  await t('嵌入进度文案与编排体退役（0.5.0 R3）：app 零 onEmbedProgress/semanticEmbedding + 嵌入编排体删码（wasm-embedder.js 不存在）', () => {
    assert(appSettings.indexOf("t('settings.semanticEmbedding'") < 0, 'app 设置区零 semanticEmbedding 引用（嵌入进度回调随路由切换撤下；i18n 键 R2 已清）')
    assert(appSettings.indexOf('function (done, total)') < 0, 'app 零 onEmbedProgress(done,total) 回调形态')
    const zhSrc2 = read('src/i18n/zh.js'), enSrc2 = read('src/i18n/en.js')
    assert(zhSrc2.indexOf('semanticEmbedding') < 0 && enSrc2.indexOf('semanticEmbedding') < 0, 'zh/en 双字典 semanticEmbedding 键清理（零引用红线——节 68 守卫②）')
    assert(!fsNative.existsSync(path.join(DIR, 'src', 'app', 'kernel', 'wasm-embedder.js')), 'wasm-embedder.js 编排体已删码（0.5.0 R3 退役）')
    assert(appSettings.indexOf('wasmModelStatus') < 0, 'app 零 wasmModelStatus 刷模型行残留（模型行随 R3 退役）')
  })

  // ===== 122.5 e2e mock put 镜像 host 显性化 + host 双变体同步 =====
  await t('e2e mock notes-vectors-put 镜像 host 显性化：dropped/reasons + 全丢 error（与 host _vectorsPut 同口径）', () => {
    assert(mockSrc.indexOf('let written = 0, dropped = 0') >= 0, 'e2e mock put 落 dropped 计数')
    assert(mockSrc.indexOf('const reasons = []') >= 0 && mockSrc.indexOf('reasons.push({ noteId: r.noteId, reason: \'dim mismatch') >= 0, 'e2e mock put 落 reasons 原因上报')
    assert(mockSrc.indexOf("const allDropped = rowsIn.length > 0 && dropped === rowsIn.length") >= 0 && mockSrc.indexOf("res.error = 'notes-vectors-put: 全部 '") >= 0, 'e2e mock put 全丢返回 error（与 host 同口径）')
  })

  await t('vector-store 双变体显性化同步：dev 与 dist 的 _vectorsPut dropped/reasons 逐字节一致', () => {
    const devPut = vsDev.slice(vsDev.indexOf('let written = 0, dropped = 0'))
    const distPut = vsDist.slice(vsDist.indexOf('let written = 0, dropped = 0'))
    assert(devPut.length > 0 && distPut.length > 0, '双变体均含 dropped 显性化块')
    assert.strictEqual(devPut.slice(0, devPut.indexOf('const allDropped')), distPut.slice(0, distPut.indexOf('const allDropped')), 'dev/dist _vectorsPut dropped/reasons 逐字节一致（差异仅 VECTORS_PATH 行）')
  })
  }
}
