// 节 35. 注入/派发图片路径消歧提示（img-path-hint，host 双包）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "35",
  title: "35. 注入/派发图片路径消歧提示（img-path-hint，host 双包）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, contexts2, g, handlers, llmMock, r1, r2, rpc2, sentMessages, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // ===== 35. 注入/派发图片路径消歧提示（img-path-hint：正文含 assets/ 图片引用时尾部追加绝对路径提示行） =====
  section('35. 注入/派发图片路径消歧提示（img-path-hint，host 双包）')

  // --- 35.1 标记块：双包逐字节一致 + eval 单测（与 sensitive-helpers/export-single 同款姿势）---
  const grabImgBlk = (s, tag) => { const m = s.match(/\/\/ ==== img-path-hint BEGIN ====[\s\S]*?\/\/ ==== img-path-hint END ====/); assert(m, tag + ' 缺 img-path-hint 标记块'); return m[0] }
  const imgBlkDev = grabImgBlk(hostSrc, 'host-impl.js')
  const imgBlkPkg = grabImgBlk(indexSrc, 'index.mjs')
  const imgNS = {}
  new Function('ns', imgBlkDev + '\nns.bodyHasImageRef = bodyHasImageRef; ns.assetsHintLine = assetsHintLine;')(imgNS)
  await t('img-path-hint 标记块双包逐字节一致 + 可 eval（bodyHasImageRef/assetsHintLine 导出）', () => {
    assert.strictEqual(imgBlkPkg, imgBlkDev, 'host-impl.js 与 index.mjs 的 img-path-hint 块必须逐字节一致')
    assert.strictEqual(typeof imgNS.bodyHasImageRef, 'function', 'bodyHasImageRef 导出')
    assert.strictEqual(typeof imgNS.assetsHintLine, 'function', 'assetsHintLine 导出')
  })
  await t('bodyHasImageRef：与渲染/内联同口径（![alt](assets/name) 命中；普通链接/外链/空正文不命中）', () => {
    assert.strictEqual(imgNS.bodyHasImageRef('见截图 ![架构](assets/20260101-000000-a.png) 如上'), true, '标准图片引用命中')
    assert.strictEqual(imgNS.bodyHasImageRef('![](assets/x.webp)'), true, '空 alt 命中')
    assert.strictEqual(imgNS.bodyHasImageRef('普通链接 [x](assets/a.png) 不算'), false, '无 ! 前缀的普通链接不命中')
    assert.strictEqual(imgNS.bodyHasImageRef('外链 ![x](https://a/b.png) 不算'), false, '非 assets/ 前缀不命中')
    assert.strictEqual(imgNS.bodyHasImageRef('') === false && imgNS.bodyHasImageRef(null) === false && imgNS.bodyHasImageRef(undefined) === false, true, '空/null/undefined 安全不命中')
  })
  await t('assetsHintLine：绝对 root + /assets/ 后缀 + 尾部斜杠归一', () => {
    assert.strictEqual(imgNS.assetsHintLine('D:\\x\\notes'), '（图片位于笔记库目录 D:\\x\\notes/assets/，可用文件工具直接读取）', 'Windows 绝对路径原形')
    assert.strictEqual(imgNS.assetsHintLine('/home/u/.dsh/notes/'), '（图片位于笔记库目录 /home/u/.dsh/notes/assets/，可用文件工具直接读取）', '尾部斜杠归一不双写')
  })

  // --- 35.2 行为断言（开发版 host-impl，全新实例：独立 store/handlers/contexts，含图/不含图对照确定） ---
  const store35 = new Map()
  const fsMock35 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store35.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store35.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store35.has(p)) throw new Error('ENOENT: ' + p); return store35.get(p) },
    writeText: async (p, c) => { store35.set(p, c) },
  }
  const handlers35 = {}
  const harnessMock35 = {
    handle: (name, fn) => { handlers35[name] = fn; return () => { delete handlers35[name] } },
    defineTool: (def) => def,
    registerTool: () => () => {},
  }
  const contexts35 = []
  const ctx35 = {
    fs: fsMock35, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts35.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
    on: () => () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock35, DIR).apply(ctx35)
  const convCtx35 = contexts35.find(x => x.name === 'notes:workspace-conventions')
  const catCtx35 = convCtx35   // 0.4.3③：目录段并入单一 context（catalogEnabled 开时普通行同段渲染）
  const hintCount = (s) => (s.match(/图片位于笔记库目录 /g) || []).length

  await t('对照：注入笔记正文无图 → 注入文本无提示行', async () => {
    await handlers35['notes-create']({ title: '无图约定', body: '纯文本约定内容', inject: true, topic: '约定' })
    const conv = convCtx35.text()
    assert(conv.indexOf('无图约定') >= 0, '约定注入正常')
    assert.strictEqual(hintCount(conv), 0, '无图时注入不追加提示行（0.4.3③ 合并段后单一文本）')
  })
  await t('注入含图笔记 → 约定注入尾部追加提示行（恰好一次 + 绝对真实 NOTES_DIR 路径）', async () => {
    await handlers35['notes-create']({ title: '含图约定', body: '部署截图 ![部署](assets/20260101-000000-deploy.png) 如上', inject: true, topic: '约定' })
    const conv = convCtx35.text()
    assert.strictEqual(hintCount(conv), 1, '整条注入只追加一次提示行（不逐笔记重复），实得 ' + hintCount(conv))
    assert(conv.indexOf(imgNS.assetsHintLine(NOTES_DIR)) >= 0, '提示行含绝对真实 NOTES_DIR 路径：' + NOTES_DIR + '/assets/')
    assert(conv.indexOf('部署截图') >= 0, '原注入内容不受影响')
  })
  await t('目录段普通行条目正文含图 → 注入尾部追加提示行（合并段全量恰一次）', async () => {
    await handlers35['notes-settings-set']({ catalogEnabled: true })   // 0.4.3：目录缺省关，含图目录断言前显式开启
    await handlers35['notes-create']({ title: '含图目录笔记', body: '看图 ![x](assets/dir-img.png)' })
    const cat = catCtx35.text()
    assert(cat.indexOf('含图目录笔记') >= 0, '目录段含该条目')
    // 合并段口径：约定桶（含图约定）与目录段（含图目录笔记）均有图 → 全量只追加一次提示行
    assert.strictEqual(hintCount(cat), 1, '合并段注入追加一次提示行（约定+目录双来源去重）')
    assert(cat.indexOf(imgNS.assetsHintLine(NOTES_DIR)) >= 0, '提示行含绝对 NOTES_DIR 路径')
  })
  await t('派发消息：待办正文含图 → 尾部追加提示行（绝对 NOTES_DIR）；无图对照不追加', async () => {
    const c1 = await handlers35['notes-create']({ title: '含图待办', body: '改这个弹窗 ![弹窗](assets/pop.png)', kind: 'todo' })
    const b1 = sentMessages.length
    const r1 = await handlers35['notes-dispatch']({ id: c1.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    assert(r1.ok === true && sentMessages.length === b1 + 1, '含图待办派发成功')
    const t1x = sentMessages[sentMessages.length - 1].msg.content[0].text
    assert.strictEqual(hintCount(t1x), 1, '派发消息追加一次提示行')
    assert(t1x.indexOf(imgNS.assetsHintLine(NOTES_DIR)) >= 0, '派发提示行含绝对 NOTES_DIR 路径')
    const c2 = await handlers35['notes-create']({ title: '无图待办', body: '纯文本待办', kind: 'todo' })
    const b2 = sentMessages.length
    const r2 = await handlers35['notes-dispatch']({ id: c2.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    assert(r2.ok === true && sentMessages.length === b2 + 1, '无图待办派发成功')
    assert.strictEqual(hintCount(sentMessages[sentMessages.length - 1].msg.content[0].text), 0, '无图待办派发消息不追加提示行')
  })

  // --- 35.3 静态包行为（index.mjs）：提示行路径为绝对真实 NOTES_ROOT（~/.dsh/notes） ---
  await t('静态包：注入含图笔记 → 约定注入提示行含绝对 NOTES_ROOT 路径', async () => {
    const c = await rpc2('notes-create', { title: '静态含图约定', body: '静态截图 ![s](assets/st-img.png)', inject: true, topic: '约定' })
    assert(c.body && c.body.id, '静态包建含图约定成功')
    const conv = contexts2[0].text()
    assert.strictEqual(hintCount(conv), 1, '静态包约定注入追加一次提示行')
    assert(conv.indexOf(imgNS.assetsHintLine(NOTES_ROOT_STATIC)) >= 0, '提示行含绝对真实 NOTES_ROOT：' + NOTES_ROOT_STATIC + '/assets/')
  })
  await t('静态包：派发含图待办 → 消息尾部提示行含绝对 NOTES_ROOT 路径', async () => {
    const c = await rpc2('notes-create', { title: '静态含图待办', body: '看这个 ![k](assets/st-todo.png)', kind: 'todo' })
    const before = sentMessages.length
    const d = await rpc2('notes-dispatch', { id: c.body.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    assert(d.body.ok === true && sentMessages.length === before + 1, '静态包派发成功')
    const txt = sentMessages[sentMessages.length - 1].msg.content[0].text
    assert.strictEqual(hintCount(txt), 1, '静态包派发消息追加一次提示行')
    assert(txt.indexOf(imgNS.assetsHintLine(NOTES_ROOT_STATIC)) >= 0, '静态包派发提示行含绝对 NOTES_ROOT 路径')
  })
  }
}
