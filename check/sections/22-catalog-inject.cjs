// 节 22. 笔记目录段（0.4.4-E：唯挂载行源——「目录段补充未挂载条目」整体移除，host 双侧同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
// 0.4.3 验收修复③（notes-043-dir-merge）：目录与资料桶合并为单一目录段并入 order 130 context，原 notes:catalog order 131 撤销。
// 0.4.4-E（notes-044-catalog-remove）：全库平铺普通行与「资料=显式挂载」模型冲突，整体拆除——catalogEnabled 设置分支/UI 控件/
//   预览徽标/catalog 遥测埋点/catalog 兼容别名/CATALOG_LIMIT 封顶一并退役；recall 字段随之失去最后消费方，保留 dormant（读写兼容，0.4.5 清理卡统一裁决）。
module.exports = {
  id: "22",
  title: "22. 笔记目录段（0.4.4-E：唯挂载行源，catalog 补充行已移除；host 双侧同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, admMock, agentsMock, ctx, g, handlers, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // ===== 22. 笔记目录段（合并入 notes:workspace-conventions order 130 + recall 字段 dormant + catalog 已移除） =====
  section('22. 笔记目录段（0.4.4-E：唯挂载行源，catalog 补充行已移除；host 双侧同步）')
  // 目录段子串提取（合并后目录段跟在约定桶之后）：无段 → ''
  const dirPart = (txt) => { const i = String(txt || '').indexOf('本地笔记库目录（'); return i < 0 ? '' : String(txt).slice(i) }

  // --- 源码结构断言（开发版 host-impl + 静态包 index.mjs 同步） ---
  await t('双侧合并目录段：单一 context order 130（order 131 撤销）+ renderInjected + catalog 拆除负向锚 + 文案', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("name: 'notes:catalog'") < 0 && src.indexOf('order: 131') < 0, label + ' notes:catalog order 131 已撤销（单一目录段并入 order 130）')
      assert((src.match(/systemPrompt\.context\(/g) || []).length === 1, label + ' 仅注册 1 个 systemPrompt context')
      assert(src.indexOf('function renderInjected(sidOverride)') >= 0, label + ' renderInjected 合并渲染函数存在（sidOverride 为注入预览形参，缺省行为不变）')
      assert(src.indexOf('function conventionText(sidOverride)') >= 0, label + ' conventionText 薄壳保留（= renderInjected().full）')
      // 0.4.4-E 负向锚：「目录段补充未挂载条目」整体移除——普通行装配/总开关/封顶/别名/徽标字段/遥测埋点全部不存在
      assert(src.indexOf('CATALOG_LIMIT') < 0 && src.indexOf('CATALOG_KIND_LABELS') < 0, label + ' CATALOG_LIMIT/KIND_LABELS 已拆（普通行封顶随功能退役）')
      assert(src.indexOf('catLines') < 0 && src.indexOf('catShown') < 0 && src.indexOf('catAlias') < 0 && src.indexOf('droppedCat') < 0, label + ' 目录普通行装配变量零残留（catLines/catShown/catAlias/droppedCat）')
      assert(src.indexOf('settingsCache.catalogEnabled') < 0 && src.indexOf("'catalogEnabled' in patch") < 0, label + ' catalogEnabled 读取门 + settings-set 分支已拆（存量键成惰性死键）')
      assert(src.indexOf("_recallRaw('catalog'") < 0, label + ' catalog 遥测埋点已拆（recall.js 通道结构 dormant 保留）')
      assert(src.indexOf('catalog: r.catalog') < 0 && src.indexOf('catalogChars: r.catalog.length') < 0, label + ' 注入预览 catalog 兼容别名 + catalogChars 已退役')
      assert(src.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') >= 0, label + ' 目录段标题行文案')
      assert(src.indexOf('（以上为挂载索引行：正文用 note_get <id> 获取）') >= 0, label + ' 挂载 note_get 引导行')
      assert(src.indexOf('另有 ') >= 0 && src.indexOf('条工作日志（kind=log，注入不含），note_search 可检索') >= 0, label + ' 日志计数尾行保留（段尾提示；0.4.4-E 口径=注入恒不含）')
      assert(src.indexOf('规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') >= 0, label + ' 段尾轻推行文案')
      assert(src.indexOf('function conventionHit(n, ws, curSid)') >= 0, label + ' conventionHit 共用命中判定（约定注入）')
    }
  })
  await t('双侧 recall 字段链路（buildFM / noteFromParsed / persistNote / slim / _update / 工具 schema；0.4.4-E 起 dormant 保留）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(/'recall: ' \+ escYaml\(m\.recall === false \? 'false' : 'true'\)/.test(src), label + ' buildFM 写 recall 行')
      assert(src.indexOf("recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : ((p.meta.kind === 'log' || p.meta.kind === 'sys') ? false : true)),") >= 0, label + ' noteFromParsed 读 recall（缺省 true；工作记忆 v0：kind=log 缺省 false，显式 true 豁免；0.4.3⑥ +sys 同口径）')
      assert((src.match(/recall: n\.recall !== false/g) || []).length >= 2, label + ' persistNote 与 slim 均带 recall')
      assert(/if \(recall !== undefined\) note\.recall = recall !== false/.test(src), label + ' _update 显式传 recall 才改（undefined 不动）')
      assert(/recall: \{ type: 'boolean'/.test(src), label + ' note_manage schema 含 recall 参数')
      assert(src.indexOf("handle('notes-settings-set'") >= 0, label + ' notes-settings-set 在位（0.4.4-E：catalogEnabled 分支已拆，该键为未知键静默忽略）')
    }
  })

  // --- 行为断言（开发版 host-impl，全新实例：独立 store/handlers/contexts，计数确定） ---
  const store3 = new Map()
  const fsMock3 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store3.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store3.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store3.has(p)) throw new Error('ENOENT: ' + p); return store3.get(p) },
    writeText: async (p, c) => { store3.set(p, c) },
  }
  const handlers3 = {}
  const tools3 = []
  const harnessMock3 = {
    handle: (name, fn) => { handlers3[name] = fn; return () => { delete handlers3[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { tools3.push(def); return () => {} },
  }
  const contexts3 = []
  const ctx3 = {
    fs: fsMock3, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts3.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock3, DIR).apply(ctx3)
  const convCtx3 = contexts3.find(x => x.name === 'notes:workspace-conventions')
  const tMgr3 = tools3.find(x => x.name === 'note_manage')

  await t('单一 context 注册（order 130；目录段并入，order 131 撤销，开发版）', () => {
    assert.strictEqual(contexts3.length, 1, '注册 1 个 systemPrompt context（目录段合并后 order 131 撤销）')
    assert.strictEqual(contexts3[0].name, 'notes:workspace-conventions')
    assert.strictEqual(contexts3[0].order, 130, '约定注入 order=130')
    assert(typeof convCtx3.text === 'function', 'text 是函数')
  })
  await t('空库注入文本为空串（不注入，绝不返回 undefined）', () => {
    assert.strictEqual(convCtx3.text(), '', '空库返回空串')
  })

  // 造数据：本区笔记 / 跨区笔记 / pinned 待办 / resolved / superseded / 约定 inject=true / recall=false
  const cn1 = await handlers3['notes-create']({ title: '目录笔记甲', body: '甲正文', topic: '开发' })
  await new Promise(r => setTimeout(r, 2))
  await tMgr3.execute({ action: 'create', title: '目录笔记乙', body: '乙正文', topic: '设计', workspace: 'other-ws' })
  await tMgr3.execute({ action: 'create', title: '目录待办置顶', body: 'x', kind: 'todo', status: 'pinned', topic: '运维' })
  await tMgr3.execute({ action: 'create', title: '已解决笔记', body: 'x', status: 'resolved' })
  await tMgr3.execute({ action: 'create', title: '已被取代笔记', body: 'x', status: 'superseded' })
  await handlers3['notes-create']({ title: '本区约定不入目录', body: '约定全文已注入', inject: true, topic: '约定' })
  const cn6 = await tMgr3.execute({ action: 'create', title: 'recall关闭笔记', body: 'x', recall: false })

  // --- 0.4.4-E 负向锚：catalog 功能不存在（存量残留键不迁移 + settings-set 静默忽略 + 注入全文唯挂载行源 + catalog 遥测零事件）---
  // 残留键语义须用「首载前预置 settings.json」的独立实例（主实例 settingsCache 已被前文 fixture 链路加载，补种无效）
  const store3c = new Map()
  store3c.set(NOTES_DIR + '\\settings.json', JSON.stringify({ catalogEnabled: true }))   // 模拟 0.4.3 时代用户开过开关的存量档
  const fsMock3c = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store3c.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of store3c.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!store3c.has(p)) throw new Error('ENOENT: ' + p); return store3c.get(p) },
    writeText: async (p, c) => { store3c.set(p, c) },
  }
  const handlers3c = {}
  const contexts3c = []
  new Function('harness', 'pluginDir', hostSrc)({ handle: (n, fn) => { handlers3c[n] = fn; return () => {} }, defineTool: (d) => d, registerTool: () => () => {} }, DIR).apply({
    fs: fsMock3c, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts3c.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const convCtx3c = contexts3c.find(x => x.name === 'notes:workspace-conventions')
  await t('存量 settings.json 残留 catalogEnabled 保留不迁移（惰性死键：加载透传、写其他键原样保留、注入行为零影响）', async () => {
    const sg = await handlers3c['notes-settings-get']({})
    assert.strictEqual(sg.settings.catalogEnabled, true, '残留键加载透传（不迁移不删除）')
    await handlers3c['notes-create']({ title: '残留档普通笔记', body: 'x' })
    assert.strictEqual(dirPart(convCtx3c.text()), '', '残留键零消费方：目录段仍整段空（库内普通笔记不出现）')
    // 写其他键后残留键原样保留（惰性死键，不做清理迁移）
    const w = await handlers3c['notes-settings-set']({ injectBudgetChars: 5000 })
    assert(w.ok === true && w.settings.catalogEnabled === true, '写其他键后残留键原样保留')
    assert(JSON.parse(store3c.get(NOTES_DIR + '\\settings.json')).catalogEnabled === true, 'settings.json 落盘后残留键仍在（不迁移红线）')
  })
  await t('settings-set 传 catalogEnabled 静默忽略（未知键不报错不改值），注入全文无论设置如何只含挂载行源', async () => {
    // 残留档实例：分支已拆 → 传任何值都不再触碰该键（用户存量归用户）
    const beforeC = convCtx3c.text()
    const ig1 = await handlers3c['notes-settings-set']({ catalogEnabled: false })
    assert(ig1.ok === true && !ig1.error, 'catalogEnabled:false 静默忽略（ok，不报错）')
    assert.strictEqual(ig1.settings.catalogEnabled, true, '分支已拆：传 false 不再改值（残留键原样不动 = 惰性死键）')
    const ig2 = await handlers3c['notes-settings-set']({ catalogEnabled: 'yes' })
    assert(ig2.ok === true && !ig2.error, '非布尔值同样静默忽略（旧校验文案随分支拆除）')
    const ig3 = await handlers3c['notes-settings-set']({ catalogEnabled: null })
    assert(ig3.ok === true && !ig3.error, 'catalogEnabled:null 静默忽略（不再删除 override——键归用户存量所有）')
    assert.strictEqual(convCtx3c.text(), beforeC, '注入全文不因 catalogEnabled 设置改变（唯挂载行源）')
    // 干净实例语义（主实例 store3 从无残留键）：传 catalogEnabled 永不落键
    const igb = await handlers3['notes-settings-set']({ catalogEnabled: true })
    assert(igb.ok === true && !igb.error, '干净实例传 catalogEnabled:true 静默忽略')
    assert(!('catalogEnabled' in igb.settings), '干净实例响应不落键')
    const sgb = await handlers3['notes-settings-get']({})
    assert(!('catalogEnabled' in sgb.settings), '干净实例 settings-get 无 catalogEnabled')
    assert(!('catalogEnabled' in JSON.parse(store3.get(NOTES_DIR + '\\settings.json'))), '干净实例 settings.json 不落 catalogEnabled')
    // catalog 遥测通道零事件：埋点已拆，renderInjected 不再产 catalog 回执
    await handlers3['notes-recall-stats']({})   // 读前落账（flush 在途行；无事件时幂等空转）
    const tj3raw = store3.get(NOTES_DIR + '\\telemetry.json')
    const catLen = tj3raw ? ((JSON.parse(tj3raw).receipts || {}).catalog || []).length : 0
    assert(catLen === 0, 'catalog 遥测通道零事件（埋点已拆；实得 ' + catLen + '）')
  })
  await t('注入预览同口径：directory 空 + 无 catalog 别名 + stats 无 catalogEnabled/catalogChars（0.4.4-E）', async () => {
    const pv = await handlers3['notes-inject-preview']({})
    assert(pv && !pv.error && pv.stats, '预览 RPC 正常（实得 ' + JSON.stringify(pv).slice(0, 120) + '）')
    assert.strictEqual(pv.directory, '', '预览目录段为空（无挂载行）')
    assert(!('catalog' in pv), '预览无 catalog 兼容别名（已退役）')
    assert(!('catalogEnabled' in pv.stats) && !('catalogChars' in pv.stats), 'stats 无 catalogEnabled/catalogChars 字段')
    assert.strictEqual(pv.stats.directoryChars, 0, '预览 directoryChars=0')
    assert.strictEqual(pv.stats.totalChars, pv.conventions.length + pv.directory.length, 'totalChars = 约定段+目录段之和')
  })

  await t('目录段唯挂载行源：挂载行进段（§1 原样 + note_get 引导 + 轻推行）+ 预算压缩从旧整条省略 + 约定桶永不截断', async () => {
    // 挂载一条普通笔记（inject=false 也可挂载——挂载是显式动作）
    const m1 = await tMgr3.execute({ action: 'create', title: '挂载笔记X', body: '挂载正文', topic: '资料' })
    const mt = await handlers3['notes-mount']({ id: m1.id, whenToUse: '调合并段断言时查我' })
    assert(mt && mt.ok === true, 'notes-mount 成功（实得 ' + JSON.stringify(mt).slice(0, 100) + '）')
    const txt = convCtx3.text()
    assert(txt.indexOf('以下是注入的上下文笔记（与当前任务无关时忽略）：') === 0, '注入引导词开头')
    const dir = dirPart(txt)
    assert(dir.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') === 0, '目录段标题行开头（实得：' + dir.slice(0, 80) + '）')
    const iMount = dir.indexOf('- [[' + m1.id + ']] 何时查我：调合并段断言时查我')
    assert(iMount >= 0, '挂载行（§1 原样）进目录段（实得：' + dir.split('\n').slice(0, 6).join(' | ') + '）')
    // 驳回②回归锁（行首锚定，子串断言会被 `- - [[` 双横线骗过）：挂载行 = `- [[id]]` 单横线行首，前端 ^- \[\[? 正则可解析出 id（=预览可点契约）
    const mrow22 = dir.split('\n').filter(l => l.indexOf('[[' + m1.id + ']]') >= 0)[0] || ''
    const mm22 = mrow22.match(/^- \[\[?(n-[A-Za-z0-9]+)\]\]?/)
    assert(mm22 && mm22[1] === m1.id, '挂载行行首单横线正则可解析（实得行：' + mrow22 + '）')
    assert(dir.indexOf('- - [[') < 0, '目录段无双横线挂载行')
    assert(dir.indexOf('（以上为挂载索引行：正文用 note_get <id> 获取）') >= 0, '挂载 note_get 引导行归属本段')
    assert(dir.indexOf('\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') > 0, '段尾轻推行')
    // 预算压缩：挂载行单源从旧整条省略 + 提示行 + 约定桶永不截断
    const fAll = convCtx3.text()
    await handlers3['notes-settings-set']({ injectBudgetChars: fAll.length - 20 })
    const f1 = convCtx3.text()
    assert(f1.indexOf('- [[' + m1.id + ']]') < 0, '预算压缩：唯一挂载行被整条省略')
    assert(f1.indexOf('…另有 1 条目录行超出预算未注入（note_search 可检索）') >= 0, '预算省略提示行（目录行 = 挂载行口径）')
    assert(f1.indexOf('本区约定不入目录') >= 0 && f1.indexOf('约定全文已注入') >= 0, '约定桶永不截断')
    await handlers3['notes-settings-set']({ injectBudgetChars: null })
    assert(convCtx3.text().indexOf('条目录行超出预算未注入') < 0, '恢复不限后省略提示行消失')
    await handlers3['notes-delete']({ id: m1.id })   // 收尾：删笔记 → 清行（73 节联动口径）
  })
  await t('负向锚：未挂载条目一律不进目录段（普通/pinned 待办/resolved/superseded/recall=false/约定命中——catalog 已移除）', () => {
    const dir = dirPart(convCtx3.text())
    for (const title of ['目录笔记甲', '目录笔记乙', '目录待办置顶', '已解决笔记', '已被取代笔记', 'recall关闭笔记', '本区约定不入目录']) {
      assert(dir.indexOf(title) < 0, '未挂载条目不进目录段：' + title)
    }
    const conv = convCtx3.text()
    assert(conv.indexOf('本区约定不入目录') >= 0 && conv.indexOf('约定全文已注入') >= 0, '约定全文确实注入（约定桶红线零触碰）')
    assert(dir.indexOf('- [n-') < 0, '目录段零普通行形态（- [id] 行已消亡，唯 - [[id]] 挂载行）')
  })
  await t('recall 字段 front-matter 往返 + 缺省 true（dormant 读写兼容）', async () => {
    const onDisk1 = store3.get(NOTES_DIR + '\\' + cn1.id + '.md')
    assert(onDisk1.indexOf('\nrecall: true\n') >= 0, '缺省写 recall: true')
    const onDisk6 = store3.get(NOTES_DIR + '\\' + cn6.id + '.md')
    assert(onDisk6.indexOf('\nrecall: false\n') >= 0, 'create recall=false 写 recall: false')
    const g = await handlers3['notes-get']({ id: cn1.id })
    assert.strictEqual(g.note.recall, true, 'notes-get 返回 recall=true（缺省）')
    assert.strictEqual(g.note.inject, false, 'recall 与 inject 正交（缺省 recall=true 不影响 inject）')
  })
  await t('note_manage update 可改 recall（dormant 字段读写兼容；目录段行为与 recall 无关——消费方已随 catalog 拆除）', async () => {
    const u1 = await tMgr3.execute({ action: 'update', id: cn1.id, recall: false })
    assert(!u1.error, 'update recall=false 成功')
    const onDisk = store3.get(NOTES_DIR + '\\' + cn1.id + '.md')
    assert(onDisk.indexOf('\nrecall: false\n') >= 0, '磁盘 front-matter 同步为 recall: false')
    await tMgr3.execute({ action: 'update', id: cn1.id, recall: true })
    assert((await handlers3['notes-get']({ id: cn1.id })).note.recall === true, 'recall 改回 true（字段读写兼容保留）')
    assert(dirPart(convCtx3.text()).indexOf('目录笔记甲') < 0, 'recall=true 也不进目录段（0.4.4-E：recall 失去最后消费方，dormant 待 0.4.5 清理卡裁决）')
  })
  await t('旧文件无 recall 字段缺省 true（向后兼容解析保留；不进目录段）', async () => {
    const legacyId = 'n-legacy-recall'
    await fsMock3.writeText(NOTES_DIR + '\\' + legacyId + '.md', '---\nid: ' + legacyId + '\ntitle: 旧版无recall笔记\ntopic: 运维\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文\n')
    const g = await handlers3['notes-get']({ id: legacyId })   // 触发解析进 cache
    assert.strictEqual(g.note.recall, true, '旧文件解析缺省 recall=true')
    assert(dirPart(convCtx3.text()).indexOf('旧版无recall笔记') < 0, '无 recall 字段的旧笔记同样不进目录段（catalog 已移除）')
  })
  await t('note_manage schema 含 recall 参数', () => {
    assert(tMgr3.parameters.properties.recall && tMgr3.parameters.properties.recall.type === 'boolean', 'recall boolean 参数存在')
  })
  }
}
