// 节 109. 0.4.8 三重分类收敛 B 方案（notes-048-topic-tag-merge）：主题废弃并入标签（读侧虚拟合并 + 写侧惰性落盘）
// 冻结规格（主窗口与用户定稿 2026-10-08）：
//   ①读侧虚拟合并（零风险）：effTags(note) = tags ∪ {topic}（topic trim 非空且≠「未分类」才并入；精确去重保序；大小写敏感——
//     与 host tag 精确过滤同口径）落 src/shared/editor-kernel.js（app/client 共源），host 侧 kernel/format.js 同口径 effTagsOf/topicMergeWrite；
//     侧栏树/视图过滤/搜索 hay/双链判定/注入管理/mentions/整理建议/合并默认标题/导出标签选项 全改吃 effTags；磁盘 .md 一个字节不动。
//   ②写侧惰性落盘：app buildSavePayload / client doSave / host note_manage（显式 topic 入参）→ 合并去重落盘 + topic 清空；
//     「分类中」瞬态占位不触写（永不成标签）；存量笔记首次保存即懒迁移，绝不批量改写。
//   ③侧栏「主题 (N)」树 →「标签 (N)」树：多值分组（一篇可在多个标签下出现）；组头计数 = 去重篇数；原「未分类」主题桶消失；
//     topic* 状态/键名/data-topic 属性名沿用（防地震，语义切换注释在案）。
//   ④编辑器 meta：主题 chip 下线；标签 chip 升级为编辑控件（chips ✕ 移除 + Enter/逗号/分号提交 + 失焦提交余量）；
//     面包屑主题段 → 首枚有效标签段，无标签整段不渲染（「未分类」歧义消除）。
//   ⑤i18n 词汇清扫：topic 键名保留改文案值；死键退役（meta.topicTip/topicTipClient/topicPlaceholder/topicFilterTip/noTopic）。
//   ⑥原型 notes-ui-v2.html 同步 + host 工具描述 deprecate。
// 红线：topic 字段不删（schema/front-matter 兼容）；note_search/notes-list 响应结构零变化（host list 原样吐字段，读侧合并在消费端）；
//   回收站/多选批量/导出路径同吃 effTags 无孤儿。
// 真机锁归 e2e 用例㊷（面板 harness：标签树多值分组 + 未分类桶消失 + 标签档过滤 + 写侧合并 payload + 标签编辑控件交互）。
module.exports = {
  id: "109",
  title: "109. 0.4.8 三重分类收敛：主题并入标签（B 方案懒合并）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc, indexSrc } = H
  const { NOTES_DIR, admMock, agentsMock, llmMock, mkFsMockImp, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('109. 0.4.8 三重分类收敛：主题并入标签（B 方案懒合并）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const kernelSrc = read('src/shared/editor-kernel.js')
  const appHtml = read('packages/dsh-notes-plugin/app.html')
  const protoSrc = read('design/notes-ui-v2.html')
  const cliPkg = read('packages/dsh-notes-plugin/lib/client.js')
  const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
  const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')

  // ===== 109.1 内核行为级：effTags 全矩阵 + effTagsUi 占位剔除（从内核标记块提取真码 eval）=====
  const k0 = kernelSrc.indexOf('// ===== 0.4.8 三重分类收敛'), k1 = kernelSrc.indexOf('// ===== end 双模式编辑器内核 v3 =====')
  assert(k0 >= 0 && k1 > k0, 'editor-kernel.js 含 0.4.8 effTags 标记区间（结构变更需同步本断言）')
  const kernelFns = new Function(kernelSrc.slice(k0, k1) + '\nreturn { effTags: effTags, effTagsUi: effTagsUi }')()
  await t('0.4.8 主题并入标签内核行为级：effTags 全矩阵（空/未分类/重复/大小写/空白/null/占位）+ effTagsUi 剔占位', () => {
    const eff = kernelFns.effTags
    assert.deepStrictEqual(eff(null), [], 'null 容错 → []')
    assert.deepStrictEqual(eff({}), [], '空对象 → []')
    assert.deepStrictEqual(eff({ tags: null, topic: null }), [], 'null 字段容错 → []')
    assert.deepStrictEqual(eff({ tags: [], topic: '' }), [], '空 topic → []')
    assert.deepStrictEqual(eff({ tags: [], topic: '未分类' }), [], 'topic=未分类 不并入（「未分类」桶消失的根源）')
    assert.deepStrictEqual(eff({ tags: [], topic: ' 未分类 ' }), [], '未分类含首尾空白同样剔除（先 trim 再判）')
    assert.deepStrictEqual(eff({ tags: ['a'], topic: 'b' }), ['a', 'b'], 'tags ∪ topic 保序（tags 先 topic 后）')
    assert.deepStrictEqual(eff({ tags: ['a'], topic: 'a' }), ['a'], '重复精确去重')
    assert.deepStrictEqual(eff({ tags: [' a ', '', 'a'], topic: '' }), ['a'], 'tags 元素 trim 去空 + 内部去重')
    assert.deepStrictEqual(eff({ tags: [], topic: ' 运维 ' }), ['运维'], 'topic trim 后并入')
    assert.deepStrictEqual(eff({ tags: ['Dev'], topic: 'Dev' }), ['Dev'], '大小写相同 = 精确重复 → 去重')
    assert.deepStrictEqual(eff({ tags: ['dev'], topic: 'Dev' }), ['dev', 'Dev'], '大小写敏感（与 host tag 精确过滤同口径）：Dev ≠ dev 各自保留')
    assert.deepStrictEqual(eff({ tags: ['quick'], topic: '分类中' }), ['quick', '分类中'], '「分类中」占位并入 effTags（侧栏「识别中」分组数据源）')
    assert.deepStrictEqual(kernelFns.effTagsUi({ tags: ['a'], topic: '分类中' }), ['a'], 'effTagsUi 剔「分类中」瞬态占位（编辑器 chips/面包屑/行尾呈现面）')
    assert.deepStrictEqual(kernelFns.effTagsUi({ tags: [], topic: '未分类' }), [], 'effTagsUi 未分类 → []')
  })
  await t('0.4.8 effTags 四端同构：client 拼接 / app.html / 发布包 lib/client.js / 原型演示副本均含真码', () => {
    for (const pair of [['client 拼接', clientSrc], ['app.html', appHtml], ['发布包 lib/client.js', cliPkg], ['原型 notes-ui-v2.html', protoSrc]]) {
      const s = pair[1], label = pair[0]
      assert(/function effTags\(n\) \{/.test(s), label + ' 含 effTags()')
      assert(/function effTagsUi\(n\) \{/.test(s), label + ' 含 effTagsUi()')
      assert(s.indexOf("tp !== '未分类'") >= 0, label + ' 未分类剔除闸在同一份代码')
    }
  })
  await t('0.4.8 host 侧同口径 helper：kernel/format.js effTagsOf/topicMergeWrite（host 不拼 shared 内核，等价物单份）', () => {
    const fmtSrc = read('src/host/kernel/format.js')
    const fm = fmtSrc.match(/\/\/ ==== topic-tag-merge BEGIN ====[\s\S]*?\/\/ ==== topic-tag-merge END ====/)
    assert(fm, 'format.js 缺 topic-tag-merge 标记块')
    const ns = {}
    new Function('ns', fm[0] + '\nns.effTagsOf = effTagsOf; ns.topicMergeWrite = topicMergeWrite')(ns)
    assert.deepStrictEqual(ns.effTagsOf({ tags: ['a'], topic: ' b ' }), ['a', 'b'], 'host effTagsOf 与内核同口径（trim + 合并保序）')
    assert.deepStrictEqual(ns.effTagsOf({ tags: [], topic: '未分类' }), [], 'host effTagsOf 未分类剔除')
    assert.deepStrictEqual(ns.topicMergeWrite(['a'], 'b'), { tags: ['a', 'b'], clearTopic: true }, 'topicMergeWrite 合并 + 清空标记')
    assert.deepStrictEqual(ns.topicMergeWrite(['a'], 'a'), { tags: ['a'], clearTopic: true }, 'topicMergeWrite 去重')
    assert.strictEqual(ns.topicMergeWrite([], ''), null, '空 topic 透传（null）')
    assert.strictEqual(ns.topicMergeWrite([], '未分类'), null, '未分类透传（不并标签）')
    assert.strictEqual(ns.topicMergeWrite([], '分类中'), null, '分类中占位透传（瞬态占位永不成标签）')
    assert.strictEqual(ns.topicMergeWrite(undefined, 'x') !== null, true, 'tags 未定义也可合并（读存量路径前置探测）')
    // 双包：format.js 为两清单同名引用同一物理文件（manifest.dev/dist 共源）——产物 index.mjs 含同一份
    assert(indexSrc.indexOf('function topicMergeWrite(tags, topic)') >= 0 && indexSrc.indexOf('function effTagsOf(n)') >= 0, 'index.mjs 含同一份 helper（构建期拼接）')
    assert(hostSrc.indexOf('function topicMergeWrite(tags, topic)') >= 0, '开发版 host 拼接含 helper')
  })

  // ===== 109.2 写侧惰性落盘·host note_manage 行为级 =====
  // 【实例隔离硬要求】共享 S.handlers 会被 17/23-5/34 等静态包冷启动覆写（缓存分叉：工具写 dev 实例、notes-get 读静态实例旧缓存——
  //   实测 u1 落盘正确而读取陈旧）。本节 note_manage 行为级全部走本节自建的隔离实例（tools/handlers 同源，23-6 同款姿势）。
  const storeT = new Map()
  const handlersT = {}
  const toolsT = []
  const harnessMockT = {
    handle: (name, fn) => { handlersT[name] = fn; return () => { delete handlersT[name] } },
    defineTool: (d) => d,
    registerTool: (ctx2, d) => { toolsT.push(d); return () => {} },
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockT, DIR).apply({
    fs: mkFsMockImp(storeT, [NOTES_DIR]), sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const nmT = toolsT.find(x => x.name === 'note_manage')
  assert(nmT, '隔离实例注册 note_manage')
  await t('0.4.8 写侧惰性落盘·host note_manage：显式 topic 并入 tags + topic 落盘清空 + topicMerged 回执（create/update）', async () => {
    // create：显式 topic → 并入 tags（去重），topic 不落盘（_create 缺省 未分类）
    const c1 = await nmT.execute({ action: 'create', title: '0.4.8合并样本甲', body: 'x048', topic: '运维048' })
    assert(!c1.error && c1.topicMerged === true, 'create 回执 topicMerged（实得 ' + JSON.stringify(c1) + '）')
    const g1 = await handlersT['notes-get']({ id: c1.id })
    assert.deepStrictEqual(g1.note.tags, ['运维048'], 'create：topic 并入 tags（实得 ' + JSON.stringify(g1.note.tags) + '）')
    assert.strictEqual(g1.note.topic, '未分类', 'create：topic 清空 → _create 缺省 未分类（字段保留 schema 兼容）')
    // update：tags 未显式传 → 读存量 tags 合并；topic 落盘清空
    const u1 = await nmT.execute({ action: 'update', id: c1.id, topic: '发布048' })
    assert(u1.topicMerged === true, 'update 回执 topicMerged（实得 ' + JSON.stringify(u1) + '）')
    const g2 = await handlersT['notes-get']({ id: c1.id })
    assert.deepStrictEqual(g2.note.tags, ['运维048', '发布048'], 'update：读存量合并保序（实得 ' + JSON.stringify(g2.note.tags) + '）')
    assert.strictEqual(g2.note.topic, '', 'update：topic 落盘清空')
    // update：与显式 tags 同传 → 并入显式 tags；重复值去重
    const c3 = await nmT.execute({ action: 'create', title: '0.4.8合并样本丙', body: 'x', tags: ['已存在048'] })
    const u2 = await nmT.execute({ action: 'update', id: c3.id, tags: ['显式048'], topic: '已存在048' })
    const g3 = await handlersT['notes-get']({ id: c3.id })
    assert.deepStrictEqual(g3.note.tags, ['显式048', '已存在048'], '显式 tags + topic 合并且去重（实得 ' + JSON.stringify(g3.note.tags) + '）')
    assert.strictEqual(g3.note.topic, '', '显式 tags 同传时 topic 仍清空')
    // 磁盘证据：front-matter topic 清空行 + tags 落盘
    const onDisk = storeT.get(NOTES_DIR + '\\' + c1.id + '.md') || ''
    assert(/\ntopic:[ \t]*\r?\n/.test(onDisk), '磁盘 front-matter topic 已清空（懒迁移落盘证据）')
    assert(onDisk.indexOf('运维048') >= 0 && onDisk.indexOf('发布048') >= 0, '磁盘 front-matter tags 行含合并值')
  })
  await t('0.4.8 note_manage 透传兜底：空/未分类/分类中 topic 不合并（兼容旧调用）；不传 topic 零副作用', async () => {
    const c = await nmT.execute({ action: 'create', title: '0.4.8透传样本', body: 'x', topic: '未分类' })
    assert(!c.topicMerged, '未分类 create 不合并（实得 ' + JSON.stringify(c) + '）')
    const u1 = await nmT.execute({ action: 'update', id: c.id, topic: '分类中' })
    assert(!u1.topicMerged, '分类中占位透传不合并')
    const g1 = await handlersT['notes-get']({ id: c.id })
    assert.strictEqual(g1.note.topic, '分类中', '分类中透传落盘（占位语义保留，分类器可回填）')
    assert.deepStrictEqual(g1.note.tags, [], '透传不落标签')
    const u2 = await nmT.execute({ action: 'update', id: c.id, title: '0.4.8透传样本改' })
    const g2 = await handlersT['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.topic, '分类中', '不传 topic → topic 不动（undefined 显式传才改）')
    assert.deepStrictEqual(g2.note.tags, [], '不传 tags → tags 不动')
  })
  await t('0.4.8 工具描述 deprecate（双包同步）：note_manage 段落 + topic 参数标注 + note_search topic 过滤标注', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('topic (string) is DEPRECATED since 0.4.8 — the topic concept was merged into tags') >= 0, label + ' note_manage 描述含 topic 废弃段')
      assert(s.indexOf('merged into tags (deduped) and the stored topic is cleared') >= 0, label + ' 写侧合并语义写明（合并去重 + 清空）')
      assert(s.indexOf('NEVER batch-rewritten') >= 0, label + ' 懒合并红线写明（绝不批量改写存量 .md）')
      assert(s.indexOf('topic? (deprecated → merged into tags)') >= 0, label + ' create 行内标注')
      assert(s.indexOf('topic? (deprecated → merged into tags + cleared)') >= 0, label + ' update 行内标注')
      assert(s.indexOf("topic: { type: 'string', description: 'DEPRECATED since 0.4.8 (topic merged into tags)") >= 0, label + ' note_manage topic 参数标注')
      assert(s.indexOf('Optional topic filter (exact match) — DEPRECATED legacy field (0.4.8') >= 0, label + ' note_search topic 过滤标注')
    }
  })

  // ===== 109.3 写侧·app buildSavePayload 行为级 eval（with(Proxy) 沙箱，103 同款姿势；globals 回退全球防 Boolean 等内建被遮）=====
  function evalAppSave(env) {
    const m = appHtml.match(/function buildSavePayload\(\) \{[\s\S]*?\n\}/)
    assert(m, 'app.html 缺 buildSavePayload()（结构变更需同步本断言）')
    const proxy = new Proxy(env, {
      has(t2, k) { if (typeof k === 'symbol') return false; return (k in t2) || !(k in globalThis) },
      get(t2, k) { if (typeof k === 'symbol') return undefined; return t2[k] },
      set(t2, k, v) { t2[k] = v; return true }
    })
    new Function('scope', 'with (scope) {\n' + m[0] + '\n; __bsp = buildSavePayload }')(proxy)
    return env.__bsp
  }
  const mkSaveEnv = (over) => Object.assign({
    selId: 'n1', edBodyErr: '', edBodyLoaded: false,
    notes: [{ id: 'n1', tags: [] }],
    edNote: { id: 'n1', title: 'T', tags: ['a'], topic: '运维', kind: 'note', status: 'active', inject: false, injectTo: [], recall: true, sensitive: false, hidden: false, _tagsStr: null },
  }, over || {})
  await t('0.4.8 app 写侧合并行为级：edFoldTopic 折叠单元 + buildSavePayload——topic 清空 + 在途输入并入 + 去重 + quick 保留 + 占位不触写 + 守卫 + 移除生效（不回魂）', () => {
    /* edFoldTopic 单元（app.html 提取真码 eval）：topic≠未分类/≠分类中 折入 tags（去重），topic 字段本体保留（供 buildSavePayload 判定落盘清空） */
    const fmFold = appHtml.match(/function edFoldTopic\(n\) \{[\s\S]*?\n\}/)
    assert(fmFold, 'app.html 缺 edFoldTopic()')
    const edFoldTopic = new Function(fmFold[0] + '\nreturn edFoldTopic')()
    assert.deepStrictEqual(edFoldTopic({ tags: ['a'], topic: '运维' }).tags, ['a', '运维'], '折叠：topic 折入 tags')
    assert.strictEqual(edFoldTopic({ tags: ['a'], topic: '运维' }).topic, '运维', '折叠不动 topic 字段本体（清空决策留给保存载荷）')
    assert.deepStrictEqual(edFoldTopic({ tags: ['运维'], topic: '运维' }).tags, ['运维'], '折叠去重')
    assert.deepStrictEqual(edFoldTopic({ tags: [], topic: '未分类' }).tags, [], '未分类不折叠')
    assert.deepStrictEqual(edFoldTopic({ tags: [], topic: '分类中' }).tags, [], '分类中占位不折叠（瞬态占位永不成标签）')
    assert.strictEqual(edFoldTopic(null), null, 'null 容错')
    /* buildSavePayload：edNote.tags 已是折叠后事实源（选中/回填四处赋值点 edFoldTopic 折叠）；本函数只负责在途串并入 + topic 清空落盘 */
    const e1 = mkSaveEnv({ edNote: edFoldTopic({ id: 'n1', title: 'T', tags: ['a'], topic: '运维', kind: 'note', status: 'active', inject: false, injectTo: [], recall: true, sensitive: false, hidden: false, _tagsStr: null }) })
    const p1 = evalAppSave(e1)()
    assert(p1 && p1.topic === '', 'topic 落盘清空（实得 ' + JSON.stringify(p1.topic) + '）')
    assert.deepStrictEqual(p1.tags, ['a', '运维'], 'tags 含折叠值（实得 ' + JSON.stringify(p1.tags) + '）')
    assert.strictEqual(e1.edNote.topic, '', '本地 edNote.topic 同步清空（防重复发送）')
    /* ✕ 移除折叠 chip 必须生效：tags 已删该值、topic 仍非空 → 载荷清空 topic 且不把该值加回 tags（语义闭环：移除即消失） */
    const e1b = mkSaveEnv({ edNote: { id: 'n1', title: 'T', tags: [], topic: '运维', kind: 'note', status: 'active', inject: false, injectTo: [], recall: true, sensitive: false, hidden: false, _tagsStr: null } })
    const p1b = evalAppSave(e1b)()
    assert(p1b && p1b.topic === '' && p1b.tags.indexOf('运维') < 0, '移除折叠 chip 生效（tags 不回魂、topic 清空；实得 ' + JSON.stringify(p1b.tags) + '）')
    for (const tp of ['未分类', '', '  ', '分类中']) {
      const e2 = mkSaveEnv(); e2.edNote.topic = tp
      const p2 = evalAppSave(e2)()
      assert(p2 && !('topic' in p2), 'topic=' + JSON.stringify(tp) + ' 不触写（实得 tags ' + JSON.stringify(p2.tags) + '）')
      assert.deepStrictEqual(p2.tags, ['a'], 'tags 不受占位影响')
    }
    const e3 = mkSaveEnv({ edNote: { id: 'n1', title: 'T', tags: ['a'], topic: '', kind: 'note', status: 'active', inject: false, injectTo: [], recall: true, sensitive: false, hidden: false, _tagsStr: 'x, a，y' }, notes: [{ id: 'n1', tags: ['quick'] }] })
    const p3 = evalAppSave(e3)()
    assert.deepStrictEqual(p3.tags, ['a', 'x', 'y', 'quick'], '在途串（含中文逗号）并入 + 去重 + quick 保留（实得 ' + JSON.stringify(p3.tags) + '）')
    assert.strictEqual(evalAppSave(mkSaveEnv({ selId: null }))(), null, '无选中 → null 守卫')
    assert.strictEqual(evalAppSave(mkSaveEnv({ edNote: null }))(), null, '无笔记 → null 守卫')
    assert.strictEqual(evalAppSave(mkSaveEnv({ edBodyErr: 'x' }))(), null, 'R-1 安全态暂停守卫不动')
  })
  await t('0.4.8 app 编辑器折叠/控件结构锚：edFoldTopic 四处赋值点 + 标签编辑控件接线 + 面包屑标签段', () => {
    assert(appHtml.indexOf('function edFoldTopic(n) {') >= 0, 'app.html 含 edFoldTopic')
    assert((appHtml.match(/edFoldTopic\(/g) || []).length >= 5, 'edFoldTopic 定义 + 四个赋值点（selectNote/open-by-id/loadEdBody/refreshSelected；实得 ' + (appHtml.match(/edFoldTopic\(/g) || []).length + '）')
    assert(appHtml.indexOf('function commitTagInput(commitAll)') >= 0 && appHtml.indexOf("$('edMeta').querySelectorAll('.tchip .tx')") >= 0, '标签控件提交/移除接线')
    assert(appHtml.indexOf("var firstTag = effTagsUi(n)[0] || '';") >= 0, '面包屑标签段 = 首枚有效标签')
    assert(appHtml.indexOf("$('mTopicInput')") < 0 && appHtml.indexOf('id="mTopicInput"') < 0, '主题 chip 已下线（mTopicInput 清零）')
    assert(appHtml.indexOf('<symbol id="i-tag"') >= 0, 'app.html 含 i-tag 图标')
  })

  // ===== 109.4 写侧·client doSave 结构锚（行为真机锁归 e2e ㊷）=====
  await t('0.4.8 client 写侧合并（结构锚，双端）：chips∪在途 + topic 清空 + 保存成功清 edTopic + 选中折叠 chips', () => {
    for (const pair of [['client 拼接', clientSrc], ['发布包 lib/client.js', cliPkg]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('let tags = edTagListRef.current.map(s => String(s).trim()).filter(Boolean)') >= 0, label + ' doSave tags = chips 为基')
      assert(s.indexOf("const tp0 = (edTopicRef.current || '').trim()") >= 0 && s.indexOf("if (tp0 && tp0 !== '未分类' && tp0 !== '分类中') upd.topic = ''") >= 0, label + ' topic 写侧清空闸')
      assert(s.indexOf("if (upd.topic === '') setEdTopic('')") >= 0, label + ' 保存成功清 edTopic（不重发清空）')
      assert(/setEdTagList\(effTags\(n\)\.filter\(t => t !== 'quick' && t !== '分类中'\)\)/.test(s), label + ' 选中折叠：chips = effTags 剔占位')
      assert(s.indexOf('dsh-notes-meta-topic-input') < 0, label + ' 主题 chip 下线')
      assert(s.indexOf('dsh-notes-tchip') >= 0 && /function removeEdTag\(tg\)/.test(s) && /function commitTagInputAll\(\)/.test(s), label + ' 标签编辑控件（chips ✕ + 提交）')
    }
  })

  // ===== 109.5 侧栏标签树四端同构 + 「未分类」桶消失 =====
  await t('0.4.8 侧栏标签树四端同构：effTags 多值分组 + 组头去重篇数 + 「未分类」桶消失 + i-tag 图标 + 分类中映射', () => {
    // client（React）
    assert(clientSrc.indexOf('notes.forEach(n => { effTags(n).forEach(tg => { (allTags[tg] = allTags[tg] || {})[n.id] = true }) })') >= 0, 'client 分组数据源 = effTags（多值）')
    assert(clientSrc.indexOf('const tkidsAll = filtered.filter(n => effTags(n).indexOf(tn) >= 0)') >= 0, 'client 组内过滤 = 含该 effTag 即归入（多值分组）')
    assert(clientSrc.indexOf('Object.keys(allTags[tn]).length') >= 0, 'client 组头计数 = 去重篇数')
    assert(clientSrc.indexOf('allTopics') < 0, 'client 旧 allTopics 形态清零')
    assert(clientSrc.indexOf("I('tag', 11)") >= 0 && clientSrc.indexOf("I('topic', 11)") < 0, 'client 分组头图标 i-topic → i-tag')
    // app.html / 原型（同一套 vanilla 口径）
    for (const pair of [['app.html', appHtml], ['原型 notes-ui-v2.html', protoSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('var allTags = {};') >= 0 && s.indexOf('var et = effTags(n);') >= 0, label + ' 分组数据源 = effTags（多值）')
      assert(s.indexOf('var tkids = vis.filter(function (n) { return effTags(n).indexOf(t) >= 0 });') >= 0, label + ' 组内过滤多值')
      assert(s.indexOf('(filtering ? tkids.length : Object.keys(allTags[t]).length)') >= 0, label + ' 组头计数 = 去重篇数')
      assert(s.indexOf('allTopics') < 0, label + ' 旧 allTopics 形态清零（未分类桶一并消失：effTags 不产「未分类」键）')
      assert(s.indexOf("icon('i-tag', 11)") >= 0 && s.indexOf("icon('i-topic', 11)") < 0, label + ' 分组头图标 i-topic → i-tag')
      assert(s.indexOf("t === '分类中' ? ") >= 0, label + ' 「分类中」→「识别中」显示映射在位')
    }
    // 「未分类」桶消失的行为级推论链：effTags(未分类)=∅（109.1 矩阵已锁）→ 分组键永不产「未分类」
    assert.deepStrictEqual(kernelFns.effTags({ tags: [], topic: '未分类' }), [], '未分类笔记不进任何标签组（桶消失）')
  })

  // ===== 109.6 读侧消费面 effTags 无孤儿 + 红线（topic 字段保留 / 响应结构零变化 / 无批量迁移）=====
  await t('0.4.8 读侧消费面同吃 effTags（视图过滤/搜索 hay/双链/注入管理/mentions/整理建议/合并默认标题/导出选项）', () => {
    for (const pair of [['client 拼接', clientSrc], ['app.html', appHtml]]) {
      const s = pair[1], label = pair[0]
      assert(/effTags\(n\)\.indexOf\(view\.id\) >= 0/.test(s), label + ' 标签视图过滤（matches/wiki 双点同谓词）')
      assert(s.indexOf("effTags(n).join(' ')") >= 0, label + ' 搜索 hay / relRank 吃 effTags')
      assert(s.indexOf('effTags(n).join(\' \').toLowerCase().indexOf(st.q') >= 0 || s.indexOf("effTags(n).join(' ').toLowerCase().indexOf(injMgrQ") >= 0, label + ' 注入管理检索吃 effTags')
      assert(s.indexOf('effTagsUi(sel[0])[0]') >= 0, label + ' 多选合并默认标题吃 effTagsUi（批量路径无孤儿）')
      assert(s.indexOf("effTagsUi(n)[0] ||") >= 0, label + ' 整理建议候选 meta 吃 effTagsUi')
    }
    assert(clientSrc.indexOf('const hay = [n.title].concat(effTags(n))') >= 0, 'client @ mentions 候选检索吃 effTags')
    assert(clientSrc.indexOf('for (const tg of effTagsUi(n)) tagSet[tg] = true') >= 0, 'client 导出标签档选项吃 effTagsUi（导出路径无孤儿）')
    assert(clientSrc.indexOf("const tag0 = effTagsUi(n)[0] || ''") >= 0, 'client @ mentions 候选副行吃 effTagsUi')
  })
  await t('0.4.8 红线：topic 字段保留（front-matter/schema）+ notes-list/note_search 响应结构零变化 + 存量零批量迁移', async () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("'topic: ' + escYaml(m.topic || '')") >= 0, label + ' buildFM 恒写 topic 行（字段保留，schema 兼容）')
      assert(s.indexOf("topic: p.meta.topic || '未分类'") >= 0, label + ' 读盘 topic 缺省 未分类（降级可读）')
      assert(s.indexOf('async function _search(query, tag, topic, kind, folder, filters)') >= 0, label + ' note_search _search 签名原样（topic 过滤后向兼容）')
      assert(s.indexOf('async function _update(id, title, body, tags, topic, kind, status') >= 0, label + ' _update 签名原样（合并只在工具面，不动核心写路径）')
    }
    // notes-list slim 结构零变化：topic/tags 字段原样吐出、类型不变（读侧合并在消费端，host list 不动；走本节隔离实例——
    //   共享 handlers 已被静态包冷启动覆写）。样本甲此时 topic=''（109.2 已懒迁移清空）——恰证字段保留、值随写侧演进
    const lst = await handlersT['notes-list']({})
    const one = (lst.notes || []).find(n => n.title === '0.4.8合并样本甲')
    assert(one && typeof one.topic === 'string' && Array.isArray(one.tags), 'notes-list slim 原样吐 topic/tags 字段（类型/结构零变化；实得 ' + JSON.stringify(one && { topic: one.topic, tags: one.tags }) + '）')
    // 存量零批量迁移：无任何「启动期遍历全库改写 topic」通道（懒迁移只在保存路径；注释锚 + 工具描述红线双锁）
    assert(hostSrc.indexOf('懒迁移红线') >= 0 && indexSrc.indexOf('NEVER batch-rewritten') >= 0, '懒迁移红线注释/描述在位')
  })

  // ===== 109.7 降级场景 + 导出标签档（沿用 109.2 隔离实例；旧版 front-matter .md 直写盘——cache 未命中走 readNoteFile 读盘）=====
  await t('0.4.8 降级场景：旧版 .md（topic 行）降级可读 + effTags 合并可见 + 导出标签档 topic-only 命中不成孤儿', async () => {
    // 旧版字段形态直写盘（模拟 0.4.7 及更早存量：topic 承载分类、tags 为空）
    storeT.set(NOTES_DIR + '\\n-legacy-048.md', '---\nid: n-legacy-048\ntitle: 旧版主题笔记\ntopic: 运维048\ntags: \nkind: note\nstatus: active\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n旧正文048\n')
    storeT.set(NOTES_DIR + '\\n-modern-048.md', '---\nid: n-modern-048\ntitle: 新版标签笔记\ntopic: \ntags: 运维048, 发布048\nkind: note\nstatus: active\ncreatedAt: "2026-01-02T00:00:00.000Z"\nupdatedAt: "2026-01-02T00:00:00.000Z"\n---\n\n新正文048\n')
    const gL = await handlersT['notes-get']({ id: 'n-legacy-048' })
    assert.strictEqual(gL.note.topic, '运维048', '旧版 topic 字段降级可读（原样吐，零迁移）')
    assert.deepStrictEqual(gL.note.tags, [], '旧版空 tags 解析为空数组')
    // 消费端读侧合并：effTagsOf 把旧 topic 呈现为标签（面板/app 侧 effTags 同口径——109.1 已锁）
    const fmtSrc = read('src/host/kernel/format.js')
    const effTagsOf = new Function(fmtSrc.match(/function effTagsOf\(n\) \{[\s\S]*?\n    \}/)[0] + '\nreturn effTagsOf')()
    assert.deepStrictEqual(effTagsOf(gL.note), ['运维048'], '旧版笔记 effTags 合并可见（读侧虚拟合并零风险）')
    // 导出标签档：scope.tag=运维048 → 旧版（topic-only）+ 新版（tags）+ 109.2 懒迁移样本甲（tags）三命中，无孤儿
    const rE = await handlersT['notes-export-single']({ dir: 'D:\\exp-048', scope: { tag: '运维048' }, format: 'md', toc: false })
    assert(!rE.error, '导出成功（实得 ' + JSON.stringify(rE.error || rE.scope) + '）')
    assert.strictEqual(rE.exported, 3, '旧版 topic-only + 新版 tags + 懒迁移样本 三命中导出（effTags 口径无孤儿；实得 ' + rE.exported + '）')
    const written = Array.from(storeT.keys()).find(k => k.indexOf('dsh-notes-export-single-') >= 0)
    assert(written, '导出文件已写盘')
    const doc = storeT.get(written)
    assert(doc.indexOf('旧版主题笔记') >= 0 && doc.indexOf('新版标签笔记') >= 0 && doc.indexOf('0.4.8合并样本甲') >= 0, '导出文档三篇俱在（topic-only 旧版命中是关键行为）')
  })

  // ===== 109.8 i18n 词汇清扫（双语值改标签措辞；topic 键名保留防键名地震；死键退役）=====
  await t('0.4.8 i18n 词汇清扫：主题措辞键值改标签（双语）+ 死键退役 + tagRemoveTip 新键', () => {
    assert.strictEqual(ZH['tree.topicsHeader'], '标签 ({n})', 'zh 树分组头 = 标签')
    assert.strictEqual(EN['tree.topicsHeader'], 'Tags ({n})', 'en 树分组头 = Tags')
    assert.strictEqual(ZH['tree.viewTopic'], '标签 · {id}', 'zh 视图头标签措辞')
    assert.strictEqual(EN['tree.viewTopic'], 'Tag · {id}', 'en 视图头标签措辞')
    assert.strictEqual(ZH['tree.topicTip'], '标签：{topic}', 'zh 行尾 tooltip')
    assert.strictEqual(EN['tree.topicTip'], 'Tags: {topic}', 'en 行尾 tooltip')
    assert.strictEqual(ZH['meta.crumbTopicTip'], '按标签全局过滤（跨文件夹）', 'zh 面包屑 tooltip')
    assert.strictEqual(EN['meta.crumbTopicTip'], 'Filter globally by tag (across folders)', 'en 面包屑 tooltip')
    assert.strictEqual(ZH['meta.filteredByTopic'], '已按标签过滤：{name}', 'zh 过滤 toast')
    assert.strictEqual(EN['meta.filteredByTopic'], 'Filtered by tag: {name}', 'en 过滤 toast')
    assert.strictEqual(ZH['meta.tagsPlaceholder'], '添加标签…', 'zh 添加输入占位')
    assert.strictEqual(EN['meta.tagsPlaceholder'], 'Add tag…', 'en 添加输入占位')
    assert.strictEqual(ZH['meta.tagRemoveTip'], '移除标签', 'zh ✕ 移除 tooltip（新键）')
    assert.strictEqual(EN['meta.tagRemoveTip'], 'Remove tag', 'en ✕ 移除 tooltip（新键）')
    assert.strictEqual(ZH['inj.searchPlaceholder'], '搜索标题 / 标签…', 'zh 注入管理检索占位（主题并入标签）')
    assert.strictEqual(EN['inj.searchPlaceholder'], 'Search title / tags…', 'en 注入管理检索占位')
    assert.strictEqual(ZH['help.topic'], '点面包屑里的标签可按标签全局过滤（跨文件夹）', 'zh help.topic 键名保留值改标签措辞')
    assert.strictEqual(EN['help.topic'], 'Click a tag in the breadcrumb to filter globally by tag (cross-folder)', 'en help.topic 键名保留值改标签措辞')
    for (const dead of ['meta.topicTip', 'meta.topicTipClient', 'meta.topicPlaceholder', 'meta.topicFilterTip', 'meta.noTopic']) {
      assert(ZH[dead] === undefined && EN[dead] === undefined, '死键退役（主题 chip 下线）：' + dead)
    }
    /* 占位符双端同形抽查（68 节全域守卫之外的本地快锁） */
    for (const k of ['tree.topicTip', 'tree.topicsHeader', 'meta.filteredByTopic']) {
      const pz = (ZH[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (EN[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形')
    }
  })
  }
}
