// 节 22. 笔记目录段（合并段：挂载行排前 + 普通行排后，recall 通道，host 双侧同步）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
// 0.4.3 验收修复③（notes-043-dir-merge）：目录与资料桶合并为单一目录段并入 order 130 context，原 notes:catalog order 131 撤销。
module.exports = {
  id: "22",
  title: "22. 笔记目录段（合并段：挂载行排前+普通行排后，host 双侧同步）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, admMock, agentsMock, ctx, g, handlers, llmMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, store, workspaceRegistryMock } = S
  // ===== 22. 笔记目录段（合并入 notes:workspace-conventions order 130 + recall 字段 + catalogEnabled 总开关） =====
  section('22. 笔记目录段（合并段：挂载行排前+普通行排后，host 双侧同步）')
  // 目录段子串提取（合并后目录段跟在约定桶之后）：无段 → ''
  const dirPart = (txt) => { const i = String(txt || '').indexOf('本地笔记库目录（'); return i < 0 ? '' : String(txt).slice(i) }

  // --- 源码结构断言（开发版 host-impl + 静态包 index.mjs 同步） ---
  await t('双侧合并目录段：单一 context order 130（order 131 撤销）+ renderInjected + 40 封顶 + 文案', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("name: 'notes:catalog'") < 0 && src.indexOf('order: 131') < 0, label + ' notes:catalog order 131 已撤销（单一目录段并入 order 130）')
      assert((src.match(/systemPrompt\.context\(/g) || []).length === 1, label + ' 仅注册 1 个 systemPrompt context')
      assert(src.indexOf('function renderInjected(sidOverride)') >= 0, label + ' renderInjected 合并渲染函数存在（sidOverride 为注入预览形参，缺省行为不变）')
      assert(src.indexOf('function conventionText(sidOverride)') >= 0, label + ' conventionText 薄壳保留（= renderInjected().full）')
      assert(/CATALOG_LIMIT\s*=\s*40/.test(src), label + ' CATALOG_LIMIT=40 封顶')
      assert(src.indexOf("settingsCache.catalogEnabled === true") >= 0, label + ' catalogEnabled 总开关门（缺省关，显式 true 才填充普通行；0.4.3 验收修复白名单语义）')
      assert(src.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') >= 0, label + ' 目录段标题行文案')
      assert(src.indexOf('规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') >= 0, label + ' 段尾轻推行文案')
      assert(src.indexOf('…另有 ') >= 0 && src.indexOf('条较早笔记，用 note_search 检索') >= 0, label + ' 溢出提示行文案')
      assert(src.indexOf('function conventionHit(n, ws, curSid)') >= 0, label + ' conventionHit 共用命中判定（约定注入与目录去重）')
      assert(src.indexOf("n.status === 'resolved' || n.status === 'superseded'") >= 0, label + ' 排除 resolved/superseded')
      assert(src.indexOf('n.recall === false') >= 0, label + ' 排除 recall=false')
      assert(src.indexOf('conventionHit(n, ws, curSid)') >= 0, label + ' 目录与约定注入去重')
      assert(src.indexOf('if (mountedIds[n.id]) continue') >= 0, label + ' 已挂载 id 不进普通行（挂载行=增强态排前，不重复出现）')
      assert(src.indexOf('先砍普通行') >= 0, label + ' 预算省略顺序锚：先砍普通行再砍挂载行')
    }
  })
  await t('双侧 recall 字段链路（buildFM / noteFromParsed / persistNote / slim / _update / 工具 schema）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(/'recall: ' \+ escYaml\(m\.recall === false \? 'false' : 'true'\)/.test(src), label + ' buildFM 写 recall 行')
      assert(src.indexOf("recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : ((p.meta.kind === 'log' || p.meta.kind === 'sys') ? false : true)),") >= 0, label + ' noteFromParsed 读 recall（缺省 true；工作记忆 v0：kind=log 缺省 false，显式 true 豁免；0.4.3⑥ +sys 同口径）')
      assert((src.match(/recall: n\.recall !== false/g) || []).length >= 2, label + ' persistNote 与 slim 均带 recall')
      assert(/if \(recall !== undefined\) note\.recall = recall !== false/.test(src), label + ' _update 显式传 recall 才改（undefined 不动）')
      assert(/recall: \{ type: 'boolean'/.test(src), label + ' note_manage schema 含 recall 参数')
      assert(src.indexOf("handle('notes-settings-set'") >= 0 && src.indexOf('catalogEnabled') >= 0, label + ' notes-settings-set 支持 catalogEnabled')
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

  // 造数据：本区笔记 / 跨区笔记 / pinned 待办 / resolved / 约定 inject=true / recall=false
  const cn1 = await handlers3['notes-create']({ title: '目录笔记甲', body: '甲正文', topic: '开发' })
  // updatedAt 为毫秒级 ISO 时间戳：两条创建若落在同一毫秒内，降序断言会因并列序而退化为不稳定（间歇性失败）
  await new Promise(r => setTimeout(r, 2))
  await tMgr3.execute({ action: 'create', title: '目录笔记乙', body: '乙正文', topic: '设计', workspace: 'other-ws' })
  await tMgr3.execute({ action: 'create', title: '目录待办置顶', body: 'x', kind: 'todo', status: 'pinned', topic: '运维' })
  await tMgr3.execute({ action: 'create', title: '已解决笔记', body: 'x', status: 'resolved' })
  await tMgr3.execute({ action: 'create', title: '已被取代笔记', body: 'x', status: 'superseded' })
  await handlers3['notes-create']({ title: '本区约定不入目录', body: '约定全文已注入', inject: true, topic: '约定' })
  const cn6 = await tMgr3.execute({ action: 'create', title: 'recall关闭笔记', body: 'x', recall: false })

  // --- 0.4.3 验收修复（catalogEnabled 缺省关，黑名单 → 白名单语义）---
  await t('catalogEnabled 缺省关：无 settings override → 目录段整段空 + 注入预览 directory/catalog 空 + 关态遥测零事件', async () => {
    // ① 无 settings override（缺省关）：库内有笔记目录段也不出（断言①：catalog 关 + 索引空 → 目录段整段空）
    assert.strictEqual(dirPart(convCtx3.text()), '', '缺省关：目录段整段为空（实得：' + convCtx3.text().split('\n')[0] + '…）')
    // ①b 注入预览同口径：directory='' + catalog 兼容别名为空 + 字符统计 0
    const pv = await handlers3['notes-inject-preview']({})
    assert(pv && !pv.error && pv.stats, '预览 RPC 正常（实得 ' + JSON.stringify(pv).slice(0, 120) + '）')
    assert.strictEqual(pv.directory, '', '预览目录段为空（缺省关）')
    assert.strictEqual(pv.catalog, '', '预览 catalog 兼容别名为空（缺省关）')
    assert.strictEqual(pv.stats.directoryChars, 0, '预览 directoryChars=0')
    assert.strictEqual(pv.stats.catalogChars, 0, '预览 catalogChars=0')
    // ⑤ 关态渲染 catalog 通道零遥测事件：本实例至此无任何普通行渲染（预览不计），遥测根笔记无 catalog 行（甚至未创建）
    await handlers3['notes-recall-stats']({})   // 读前落账（flush 在途行；无事件时幂等空转）
    let catRows = 0, recallFound = false
    for (const v of store3.values()) {
      const s = String(v)
      if (s.indexOf('召回遥测（自动）') >= 0) { recallFound = true; catRows += (s.match(/"channel":"catalog"/g) || []).length }
    }
    assert(catRows === 0, '关态渲染后遥测 catalog 通道零事件（实得 catalog 行 ' + catRows + '，根笔记' + (recallFound ? '已建' : '未建') + '）')
  })
  await t('catalogEnabled 显式 true 开启 → 目录段恢复（fixture 3 篇可见）', async () => {
    // ② 显式 true → 目录段普通行恢复
    const on = await handlers3['notes-settings-set']({ catalogEnabled: true })
    assert(on.ok === true, '开启成功（实得 ' + JSON.stringify(on) + '）')
    const txt = dirPart(convCtx3.text())
    assert(txt.indexOf('目录笔记甲') >= 0 && txt.indexOf('目录笔记乙') >= 0 && txt.indexOf('目录待办置顶') >= 0, '显式 true 后目录段恢复（fixture 3 篇可见；实得：' + txt.split('\n').slice(0, 5).join(' | ') + '）')
  })

  await t('目录段标题行 + 一行一条格式 + 段尾轻推行', () => {
    const txt = convCtx3.text()
    assert(txt.indexOf('以下是注入的上下文笔记（与当前任务无关时忽略）：') === 0, '注入引导词开头')
    const dir = dirPart(txt)
    assert(dir.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') === 0, '目录段标题行开头（实得：' + dir.slice(0, 80) + '）')
    assert(dir.indexOf('- [' + cn1.id + '] 目录笔记甲 (笔记, 开发)') >= 0, '行格式：- [id] 标题 (kind中文, topic)')
    assert(dir.indexOf('(待办, 运维)') >= 0, 'kind 中文映射（todo→待办）')
    assert(dir.indexOf('\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手') > 0, '段尾轻推行')
  })
  await t('排序：pinned 优先 → updatedAt 降序；目录行不再标注 ←工作区来源', () => {
    const txt = dirPart(convCtx3.text())
    assert(txt.indexOf('目录待办置顶') >= 0 && txt.indexOf('目录待办置顶') < txt.indexOf('目录笔记甲'), 'pinned 排最前')
    const i1 = txt.indexOf('目录笔记甲'), i2 = txt.indexOf('目录笔记乙')
    assert(i1 >= 0 && i2 >= 0, '本区/跨区笔记都进目录段（无工作区过滤）')
    assert(i2 < i1, 'updatedAt 降序（乙晚于甲创建，排在甲前）')
    assert(txt.indexOf('目录笔记乙 (笔记, 设计)') >= 0 && txt.indexOf('←') < 0, '行尾不再标注 ←工作区名')
    assert(txt.indexOf('目录笔记甲 (笔记, 开发)') >= 0, '行格式不变（- [id] 标题 (kind, topic)）')
  })
  await t('准入排除：resolved / superseded / recall=false / 约定去重', () => {
    const txt = dirPart(convCtx3.text())
    assert(txt.indexOf('已解决笔记') < 0, 'resolved 不进目录段')
    assert(txt.indexOf('已被取代笔记') < 0, 'superseded 不进目录段')
    assert(txt.indexOf('recall关闭笔记') < 0, 'recall=false 不进目录段')
    assert(txt.indexOf('本区约定不入目录') < 0, 'inject=true 且本会话命中的约定不进目录段（全文已在约定桶）')
    const conv = convCtx3.text()
    assert(conv.indexOf('本区约定不入目录') >= 0 && conv.indexOf('约定全文已注入') >= 0, '约定全文确实注入（去重成立的前提）')
  })
  await t('0.4.3③ 合并段行为：挂载行排前=增强态 + 普通行排后 + 已挂载 id 不重复出现（断言②③）', async () => {
    // 挂载一条普通笔记（inject=false 也可挂载——挂载是显式动作）
    const m1 = await tMgr3.execute({ action: 'create', title: '挂载笔记X', body: '挂载正文', topic: '资料' })
    const mt = await handlers3['notes-mount']({ id: m1.id, whenToUse: '调合并段断言时查我' })
    assert(mt && mt.ok === true, 'notes-mount 成功（实得 ' + JSON.stringify(mt).slice(0, 100) + '）')
    const dir = dirPart(convCtx3.text())
    const iMount = dir.indexOf('- [[' + m1.id + ']] 何时查我：调合并段断言时查我')
    assert(iMount >= 0, '挂载行（§1 原样）进目录段（实得：' + dir.split('\n').slice(0, 6).join(' | ') + '）')
    // 驳回②回归锁（行首锚定，子串断言会被 `- - [[` 双横线骗过）：挂载行 = `- [[id]]` 单横线行首，前端 ^- \[\[? 正则可解析出 id（=预览可点契约）
    const mrow22 = dir.split('\n').filter(l => l.indexOf('[[' + m1.id + ']]') >= 0)[0] || ''
    const mm22 = mrow22.match(/^- \[\[?(n-[A-Za-z0-9]+)\]\]?/)
    assert(mm22 && mm22[1] === m1.id, '挂载行行首单横线正则可解析（实得行：' + mrow22 + '）')
    assert(dir.indexOf('- - [[') < 0, '目录段无双横线挂载行')
    const iNormal = dir.indexOf('- [' + m1.id + '] 挂载笔记X')
    assert(iNormal < 0, '已挂载 id 不重复出现在普通行')
    assert(dir.indexOf('（以上为挂载索引行：正文用 note_get <id> 获取）') >= 0, '挂载 note_get 引导行归属本段')
    // 挂载行排前：挂载行在普通行（目录笔记甲/乙/待办）之前
    assert(iMount < dir.indexOf('目录待办置顶'), '挂载行排前、普通行排后')
    // 断言②：catalog 关 + 有挂载行 → 段内仅挂载行（普通行消失，挂载行存活）
    await handlers3['notes-settings-set']({ catalogEnabled: false })
    const dir2 = dirPart(convCtx3.text())
    assert(dir2.indexOf('- [[' + m1.id + ']]') >= 0, 'catalog 关：挂载行仍在段内')
    assert(dir2.indexOf('目录笔记甲') < 0 && dir2.indexOf('目录待办置顶') < 0, 'catalog 关：普通行整批消失')
    await handlers3['notes-settings-set']({ catalogEnabled: true })   // 恢复开态供后续断言
    // 断言④：预算压缩先砍普通行（挂载行存活）——预算 = 仅挂载行形态长度 + 30（确定性：普通行整批被砍后必然回到预算内）
    await handlers3['notes-settings-set']({ catalogEnabled: false })
    const fMountedOnly = convCtx3.text()   // catalog 关：目录段 = 仅挂载行
    await handlers3['notes-settings-set']({ catalogEnabled: true })
    assert(fMountedOnly.indexOf('- [[' + m1.id + ']]') >= 0, '挂载行形态基线含挂载行')
    await handlers3['notes-settings-set']({ injectBudgetChars: fMountedOnly.length + 30 })
    const f1 = convCtx3.text()
    assert(dirPart(f1).indexOf('- [[' + m1.id + ']]') >= 0, '预算压缩：挂载行存活')
    assert(f1.indexOf('条目录行超出预算未注入（note_search 可检索）') >= 0, '预算省略提示行（目录行口径）')
    assert(f1.indexOf('本区约定不入目录') >= 0 && f1.indexOf('约定全文已注入') >= 0, '约定桶永不截断')
    await handlers3['notes-settings-set']({ injectBudgetChars: null })
    assert(convCtx3.text().indexOf('条目录行超出预算未注入') < 0, '恢复不限后省略提示行消失')
    await handlers3['notes-delete']({ id: m1.id })   // 收尾：删笔记 → 清行（73 节联动口径）
  })
  await t('recall 字段 front-matter 往返 + 缺省 true', async () => {
    const onDisk1 = store3.get(NOTES_DIR + '\\' + cn1.id + '.md')
    assert(onDisk1.indexOf('\nrecall: true\n') >= 0, '缺省写 recall: true')
    const onDisk6 = store3.get(NOTES_DIR + '\\' + cn6.id + '.md')
    assert(onDisk6.indexOf('\nrecall: false\n') >= 0, 'create recall=false 写 recall: false')
    const g = await handlers3['notes-get']({ id: cn1.id })
    assert.strictEqual(g.note.recall, true, 'notes-get 返回 recall=true（缺省）')
    assert.strictEqual(g.note.inject, false, 'recall 与 inject 正交（缺省 recall=true 不影响 inject）')
  })
  await t('note_manage update 可改 recall（false 出目录 / true 回目录）', async () => {
    const u1 = await tMgr3.execute({ action: 'update', id: cn1.id, recall: false })
    assert(!u1.error, 'update recall=false 成功')
    assert(dirPart(convCtx3.text()).indexOf('目录笔记甲') < 0, 'recall=false 后目录段不含该笔记')
    const onDisk = store3.get(NOTES_DIR + '\\' + cn1.id + '.md')
    assert(onDisk.indexOf('\nrecall: false\n') >= 0, '磁盘 front-matter 同步为 recall: false')
    await tMgr3.execute({ action: 'update', id: cn1.id, recall: true })
    assert(dirPart(convCtx3.text()).indexOf('目录笔记甲') >= 0, 'recall 改回 true 后目录段恢复')
  })
  await t('旧文件无 recall 字段缺省进目录（向后兼容）', async () => {
    const legacyId = 'n-legacy-recall'
    await fsMock3.writeText(NOTES_DIR + '\\' + legacyId + '.md', '---\nid: ' + legacyId + '\ntitle: 旧版无recall笔记\ntopic: 运维\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文\n')
    const g = await handlers3['notes-get']({ id: legacyId })   // 触发解析进 cache（目录段渲染只读 cache）
    assert.strictEqual(g.note.recall, true, '旧文件解析缺省 recall=true')
    assert(dirPart(convCtx3.text()).indexOf('旧版无recall笔记') >= 0, '无 recall 字段的旧笔记缺省进目录段')
  })
  await t('note_manage schema 含 recall 参数', () => {
    assert(tMgr3.parameters.properties.recall && tMgr3.parameters.properties.recall.type === 'boolean', 'recall boolean 参数存在')
  })
  await t('catalogEnabled 总开关：显式 false 关即空 → settings.json 落盘 → 校验非布尔 → null 恢复缺省关', async () => {
    // 前置：目录段处于显式开启态（「显式 true 开启」测试）；缺省关/关态零遥测断言见「缺省关」测试
    assert(dirPart(convCtx3.text()).length > 0, '前置：目录段开启中（显式 true）')
    // ③ 显式 false → 关（目录段普通行整批消失；约定桶不受影响）
    const off = await handlers3['notes-settings-set']({ catalogEnabled: false })
    assert(off.ok === true, '关闭成功（实得 ' + JSON.stringify(off) + '）')
    assert.strictEqual(dirPart(convCtx3.text()), '', '关闭后目录段为空（无挂载行 → 整段消失）')
    const onDisk = JSON.parse(store3.get(NOTES_DIR + '\\settings.json'))
    assert.strictEqual(onDisk.catalogEnabled, false, 'settings.json 含 catalogEnabled:false')
    const sg = await handlers3['notes-settings-get']({})
    assert.strictEqual(sg.settings.catalogEnabled, false, 'notes-settings-get 回读一致')
    assert(Array.isArray(sg.models) && sg.models.some(m => m.provider === 'p' && m.model === 'm'), 'settings-get 带 models 目录（llm 探针）')
    // 校验非布尔：报错且不影响开关状态
    const bad = await handlers3['notes-settings-set']({ catalogEnabled: 'yes' })
    assert(bad.error && bad.error.indexOf('catalogEnabled') >= 0, '非布尔值报错')
    assert.strictEqual(dirPart(convCtx3.text()), '', '校验失败不影响开关状态（仍关）')
    // ④ null 删除 override → 恢复缺省关（0.4.3 起缺省 = 关）
    await handlers3['notes-settings-set']({ catalogEnabled: null })
    const sg2 = await handlers3['notes-settings-get']({})
    assert(!('catalogEnabled' in sg2.settings), 'null 删除 override（恢复缺省关）')
    assert.strictEqual(dirPart(convCtx3.text()), '', 'null 恢复缺省关后目录段保持为空')
    // 回弹语义：显式 true 仍可重开（40 条封顶用独立实例，此处仅验证开关往返）
    await handlers3['notes-settings-set']({ catalogEnabled: true })
    assert(dirPart(convCtx3.text()).length > 0, '重新打开后目录段恢复')
  })

  // --- 40 条封顶（再开全新实例，计数确定） ---
  await t('40 条封顶 + 溢出提示行（…另有 N 条较早笔记）', async () => {
    const store4 = new Map()
    const fsMock4 = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store4.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store4.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store4.has(p)) throw new Error('ENOENT: ' + p); return store4.get(p) },
      writeText: async (p, c) => { store4.set(p, c) },
    }
    const handlers4 = {}
    const contexts4 = []
    const harnessMock4 = { handle: (name, fn) => { handlers4[name] = fn; return () => {} }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock4, DIR).apply({
      fs: fsMock4, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ agents: agentsMock, systemPrompt: { context: (c) => { contexts4.push(c); return () => {} } } })[name],
      effect: () => {},
    })
    for (let i = 0; i < 45; i++) await handlers4['notes-create']({ title: '批量' + i, body: 'x' })
    await handlers4['notes-settings-set']({ catalogEnabled: true })   // 0.4.3：目录缺省关，封顶断言前显式开启
    const txt = contexts4.find(x => x.name === 'notes:workspace-conventions').text()
    const itemLines = txt.split('\n').filter(l => l.indexOf('- [n-') === 0)
    assert.strictEqual(itemLines.length, 40, '目录段普通行最多 40 条（实得 ' + itemLines.length + '）')
    assert(txt.indexOf('…另有 5 条较早笔记，用 note_search 检索') >= 0, '溢出提示行（实得尾部：' + txt.split('\n').slice(-2).join(' | ') + '）')
  })
  }
}
