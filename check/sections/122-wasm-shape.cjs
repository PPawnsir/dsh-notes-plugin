// 节 122. 0.5.0 P0-2（notes-050-wasm-shape：wasm 嵌入产出零向量修复——Tensor 双层嵌套 + put 静默丢弃显性化 + 嵌入进度文案）
// 根因（主窗口真机证据）：extractor(chunks) 返回单 Tensor [n,512]，旧码 tensors=Array.isArray(out)?out:[out] → map tolist
//   造出 [[[v1],[v2],…]] 双层嵌套（tolist 本身已是 [n][512]），host put 按块展开时 dim≠512 → 静默全丢。
// 断言面：①形状假 Tensor 桩（tolist 行为桩，纯数据桩测不出这层——教训）eval 向量提取段断言行形状正确 + 非法形状抛错；
//   ②host put 双层嵌套非法形状 → dropped 计数 + 全丢 error 面；③面板 bge 构建按钮禁用 + tooltip（不发起 RPC）；
//   ④嵌入进度文案「嵌入中 i/n」+ 完成后刷模型行（消灭卡下载 100% 假象）；⑤e2e mock put 镜像 host 显性化。
module.exports = {
  id: "122",
  title: "122. 0.5.0 P0-2 wasm 嵌入形状修复（Tensor 双层嵌套 + put 静默丢弃显性化 + 嵌入进度文案，notes-050-wasm-shape）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc } = H
  section('122. 0.5.0 P0-2 wasm 嵌入形状修复（notes-050-wasm-shape）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const embSrc = read('src/app/kernel/wasm-embedder.js')
  const vsDev = read('src/host/kernel/vector-store.js')
  const vsDist = read('src/host/kernel/vector-store.dist.js')
  const appSettings = read('src/app/modals/settings.js')
  const cliSettings = read('src/client/modals/settings.js')
  const mockSrc = read('scripts/e2e/server.cjs')

  // ===== 122.1 形状假 Tensor 桩（tolist 行为桩）eval 向量提取段——断言行形状正确 =====
  const vecsStart = embSrc.indexOf('==== wasm-embedder-vecs BEGIN ====')
  const vecsEnd = embSrc.indexOf('==== wasm-embedder-vecs END ====')
  assert(vecsStart >= 0 && vecsEnd > vecsStart, 'wasm-embedder-vecs 标记块存在（向量提取段可提取 eval）')
  let vecsBlock = embSrc.slice(vecsStart, vecsEnd)
  vecsBlock = vecsBlock.slice(vecsBlock.indexOf('*/') + 2)
  vecsBlock = vecsBlock.slice(0, vecsBlock.lastIndexOf('/*'))   // 去 END 标记残留开注释符（同节 118 core 块提取先例）
  const WV = new Function(vecsBlock + '\n;return { wasmExtractVecs }')()

  await t('形状假 Tensor 桩：单 Tensor tolist()=[n][512] → wasmExtractVecs 返回 [n][512]（旧双层嵌套必红）', () => {
    const row = new Array(512).fill(0)
    const vecs = WV.wasmExtractVecs({ tolist: () => [row, row] }, 2, 512)
    assert(Array.isArray(vecs) && vecs.length === 2, '返回 2 个块向量（实得 ' + (Array.isArray(vecs) ? vecs.length : typeof vecs) + '）')
    assert(Array.isArray(vecs[0]) && vecs[0].length === 512 && Array.isArray(vecs[1]) && vecs[1].length === 512, '每个向量 512 维一维数组（非嵌套）')
  })

  await t('形状非法抛错显性化：双层嵌套 tolist（[[[v]…]]）/ 维度不符 → wasmExtractVecs 抛错（不静默吞）', () => {
    let threw = false
    try { WV.wasmExtractVecs({ tolist: () => [[[1, 2]], [[3, 4]]] }, 2, 512) } catch (e) { threw = true }
    assert(threw, '双层嵌套（dim≠512）抛错')
    let threw2 = false
    try { WV.wasmExtractVecs({ tolist: () => [new Array(256).fill(0)] }, 1, 512) } catch (e) { threw2 = true }
    assert(threw2, '维度 256≠512 抛错')
  })

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

  // ===== 122.3 面板 bge 构建按钮禁用 + tooltip + doSemBuild 兜底 =====
  await t('面板 bge 构建按钮禁用 + 提示：backend=bge 时按钮 disabled + tooltip 到 app 页构建 + doSemBuild 兜底只提示不发起 RPC', () => {
    assert(cliSettings.indexOf("semBackend === 'bge-small-zh-q8'") >= 0, 'client doSemBuild bge 兜底守卫在案')
    assert(cliSettings.indexOf("showToast(tt('settings.semanticBuildBgeOnly'))") >= 0, 'bge 兜底只 showToast 提示（不发起 RPC）')
    assert(cliSettings.indexOf('disabled: !semEnabled || semBuilding || semBackend === \'bge-small-zh-q8\'') >= 0, 'client 构建按钮 bge 态 disabled')
    assert(cliSettings.indexOf("'data-tooltip': (semBackend === 'bge-small-zh-q8' ? tt('settings.semanticBuildBgeOnly') : tt('settings.semanticTip'))") >= 0, 'client 构建按钮 bge 态 tooltip 切换为到 app 页提示')
  })

  // ===== 122.4 嵌入进度文案 + 完成后刷模型行 =====
  await t('嵌入进度文案：app semDoBuild 嵌入阶段更新「嵌入中 i/n」+ 完成后刷模型行（消灭卡下载 100% 假象）', () => {
    assert(appSettings.indexOf("t('settings.semanticEmbedding', { done: done, total: total })") >= 0, 'app 嵌入阶段状态行「嵌入中 {done}/{total}」')
    assert(appSettings.indexOf('function (done, total)') >= 0, 'app 传第二回调 onEmbedProgress(done,total) 给 wasmBuildIndex')
    assert(embSrc.indexOf('async function wasmBuildIndex(onProgress, onEmbedProgress)') >= 0, 'wasmBuildIndex 增 onEmbedProgress 第二参数')
    assert(embSrc.indexOf('if (onEmbedProgress) onEmbedProgress(done, indexable.length)') >= 0, '嵌入循环逐篇上报嵌入进度 i/n')
    assert(appSettings.indexOf("backend === 'bge-small-zh-q8' && typeof wasmModelStatus === 'function'") >= 0, '完成后读 wasmModelStatus 刷模型行（模型行「未下载」滞留修复）')
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
