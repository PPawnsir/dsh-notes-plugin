// 节 39. 工作记忆 v0 Phase 1（kind=log + 默认隐身 + 启用流程 + 日志卫生）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "39",
  title: "39. 工作记忆 v0 Phase 1（kind=log + 默认隐身 + 启用流程 + 日志卫生）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, NOTES_ROOT_STATIC, admMock, agentsMock, appSrc, clientPkgSrc, findTool, g, llmMock, mkFsMockImp, plugin, protoV2Src, r1, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, sugNS, workspaceRegistryMock } = S
  // ===== 39. 工作记忆 v0 Phase 1（kind=log 沉淀链路 + 默认隐身 + 启用流程 + 日志卫生提名 + 四端同步）=====
  // 规格 = design/agent-memory-v0.md：① kind=log 模板/枚举/永不被清理提名 ② 默认隐身（inject 硬 false / recall 缺省 false / 列表与默认搜索排除）
  // ③ 启用流程（notes-memory-guide，r3 车道模型：check 同类唯一性（零写入）/ enable 无确认闸门直建预填约定 contractType=memory-guide + 作用域 / disable 关 inject / status 单一事实源 / kind=log origin 自动溯源）
  // ④ 日志卫生提名（suggest 第四类 logHygieneCandidates：周聚合 >7 天 / 月聚合 >90 天，只提名不执行，v0 仅展示明细）
  section('39. 工作记忆 v0 Phase 1（kind=log + 默认隐身 + 启用流程 + 日志卫生）')

  // ---- 39.1 host 双侧静态契约（host-impl.js ⇄ index.mjs 双包同步）----
  await t('host 双侧：kind=log 枚举三处 + KIND_TEMPLATES.log 四节模板（§4.2）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("const KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log']") >= 0, label + ' KINDS 含 log')
      assert(s.indexOf("quote: '引用', log: '日志'") >= 0, label + ' 中文标签映射含 log:日志')
      assert(s.indexOf("const CATALOG_KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志' }") >= 0, label + ' CATALOG_KIND_LABELS 含 log')
      assert(s.indexOf("'## 做了什么\\n\\n（本会话完成的任务/阶段，一句话一条）") >= 0, label + ' log 模板「做了什么」节')
      assert(s.indexOf('## 改动\\n\\n（改动的文件/配置/数据，路径 + 一句话）') >= 0, label + ' log 模板「改动」节')
      assert(s.indexOf('## 遗留与后续') >= 0 && s.indexOf('## 相关笔记\\n\\n（[[n-xxxxxxxx]] 双链引用本库相关笔记；无则空）') >= 0, label + ' log 模板「遗留与后续/相关笔记」节（双链占位）')
    }
  })
  await t('host 双侧：front-matter 检索字段往返预留（§7.2：logDate 恒写 / entities+summarizedAt 条件行 + r3 contractType/origin 条件行 / parseFM 拆分 / noteFromParsed 缺省）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("'logDate: ' + escYaml(m.logDate || '')") >= 0, label + ' buildFM logDate 恒写（log 恒写/其他空）')
      assert(s.indexOf("(m.entities && m.entities.length ? 'entities: ' + m.entities.map(escYaml).join(', ') + '\\n' : '')") >= 0, label + ' buildFM entities 条件行（仅非空落盘）')
      assert(s.indexOf("(m.summarizedAt ? 'summarizedAt: ' + escYaml(m.summarizedAt) + '\\n' : '')") >= 0, label + ' buildFM summarizedAt 条件行')
      assert(s.indexOf("(m.contractType ? 'contractType: ' + escYaml(m.contractType) + '\\n' : '')") >= 0, label + ' buildFM contractType 条件行（r3 契约分型身份标记）')
      assert(s.indexOf("(m.origin ? 'origin: ' + escYaml(m.origin) + '\\n' : '')") >= 0, label + ' buildFM origin 条件行（r3 产物溯源）')
      assert(s.indexOf("|| key === 'entities'") >= 0, label + ' parseFM entities 进拆分列表（与 tags 同路径）')
      assert(s.indexOf("entities: Array.isArray(p.meta.entities) ? p.meta.entities : [],") >= 0, label + ' noteFromParsed entities 缺省 []')
      assert(s.indexOf("logDate: p.meta.logDate || '',") >= 0 && s.indexOf("summarizedAt: p.meta.summarizedAt || '',") >= 0, label + ' noteFromParsed logDate/summarizedAt 缺省')
      assert(s.indexOf("contractType: p.meta.contractType || '',") >= 0 && s.indexOf("origin: p.meta.origin || '',") >= 0, label + ' noteFromParsed contractType/origin 缺省（存量零迁移）')
      assert(s.indexOf("contractType: n.contractType || '', origin: n.origin || ''") >= 0, label + ' noteFileContent/slim 携带 contractType/origin（往返无损）')
      assert(s.indexOf('function localDateStr(d)') >= 0, label + ' localDateStr 本地时区日期 helper（logDate 缺省今天）')
      assert(s.indexOf('logDate: n.logDate || \'\'') >= 0, label + ' slim 携带 logDate（client 卫生展示用）')
    }
  })
  await t('host 双侧：默认隐身硬闸（_create/_update 强制 inject=false + recall 缺省 false + injectForcedOff 告知 + 解析侧缺省）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("const isLog = (ex.kind || 'note') === 'log'") >= 0, label + ' _create isLog 判定')
      assert(s.indexOf('inject: isLog ? false : ex.inject === true,') >= 0, label + ' _create inject 硬 false（显式 true 也纠正）')
      assert(s.indexOf('recall: isLog ? (ex.recall === true) : (ex.recall !== false),') >= 0, label + ' _create recall 缺省 false（显式 true 豁免保留）')
      assert(s.indexOf("if (effKind === 'log' && inject === true) { note.inject = false; injectForcedOff = true }") >= 0, label + ' _update inject 硬闸纠正')
      assert(s.indexOf('if (injectForcedOff) r.injectForcedOff = true') >= 0, label + ' 响应 injectForcedOff 告知（create/update 同款）')
      assert(s.indexOf("p.meta.kind === 'log' ? false : true") >= 0, label + ' noteFromParsed：存量/外部直写 log 缺省 recall=false')
    }
  })
  await t('host 双侧：_list/_search 默认排除 kind=log（显式 kind=log / includeLogs / 回收站路径召回）+ 目录尾部日志计数提示行', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('async function _list(tag, kind, folder, includeDeleted, includeLogs)') >= 0, label + ' _list 五参（+includeLogs）')
      assert(s.indexOf("if (note.kind === 'log' && !includeLogs && !includeDeleted && !kind) continue") >= 0, label + ' _list 默认排除 log（显式 kind/回收站/includeLogs 召回）')
      assert(s.indexOf("!!(kind === 'log' || (filters && filters.includeLogs))") >= 0, label + ' _search 同款默认排除')
      assert(s.indexOf(' 条工作日志（kind=log，默认隐身不进目录），用 note_search 传 kind=log 检索') >= 0, label + ' 目录尾部日志计数提示行（有日志恒出现，只出计数不出标题）')
      assert(s.indexOf('if (pool.length === 0 && logCount === 0) return') >= 0, label + ' 目录空态判定连带日志计数')
    }
  })
  await t('host 双侧：notes-memory-guide RPC + 引导模板 §5.2 要点 + r3 车道模型（契约分型 + 无重叠检测 + origin 打标）+ 日志永不被清理提名', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("handle('notes-memory-guide'") >= 0, label + ' notes-memory-guide RPC 注册')
      assert(s.indexOf("const MEMORY_GUIDE_TAG = 'memory-guide'") >= 0, label + ' 兼容发现键 tag memory-guide（r3 保留：存量引导兜底 + 人读检索）')
      assert(s.indexOf("const MEMORY_GUIDE_CONTRACT_TYPE = 'memory-guide'") >= 0, label + ' 契约身份分型 contractType 主识别键（r3）')
      assert(s.indexOf('function isMemoryGuideNote(n)') >= 0 && s.indexOf('n.contractType === MEMORY_GUIDE_CONTRACT_TYPE || (n.tags || []).indexOf(MEMORY_GUIDE_TAG) >= 0') >= 0, label + ' 身份判定：contractType 优先 + tag 兼容兜底')
      assert(s.indexOf('MEMORY_GUIDE_OVERLAP_RE') < 0 && s.indexOf('记录|日志|总结|沉淀|复盘|feedback|反馈') < 0, label + ' 跨车道关键词重叠检测已删除（r3 车道模型：并行不仲裁——产品裁决，非功能弱化）')
      assert(s.indexOf('needConfirm') < 0, label + ' enable 无冲突确认闸门（needConfirm 分支删除）')
      assert(s.indexOf('function memoryGuideActiveFor(sessionId)') >= 0 && s.indexOf("isLog && memoryGuideActiveFor(sc.sessionId) ? MEMORY_GUIDE_CONTRACT_TYPE : ''") >= 0, label + ' origin 自动溯源打标（kind=log + 引导激活 + conventionHit 作用域命中）')
      assert(s.indexOf('约定：工作日志沉淀（工作记忆 v0）') >= 0, label + ' 引导约定标题')
      assert(s.indexOf('【工作约定】会话工作沉淀（工作记忆 v0）') >= 0, label + ' 引导模板首行')
      assert(s.indexOf('用户显式说「记一下 / 沉淀一下 / 写工作日志」时') >= 0, label + ' 内置「记一下」响应指令（沉淀快捷⑤，无新按钮）')
      assert(s.indexOf('【分工边界】') >= 0 && s.indexOf('互不替代、互不合并') >= 0, label + ' 【分工边界】必需段落（车道内容分工：各车道收什么内容，非冲突检测）')
      assert(s.indexOf('note_manage list（kind=log）') >= 0 && s.indexOf('## HH:mm 续') >= 0, label + ' 模板含当日归键写法（list 查当天 → update 追加续节）')
      assert(s.indexOf("const MEMORY_GUIDE_FOLDER = '工作日志'") >= 0, label + ' 启用时确保「工作日志」文件夹')
      assert(s.indexOf('启用状态不落 settings.json') >= 0, label + ' 状态单一事实源注释（contractType/tag + inject=true）')
      assert(s.indexOf("if (n.kind === 'log') continue   // 日志永不被过期清理提名") >= 0, label + ' stale 候选显式排除 log（只聚合不淘汰）')
      assert(s.indexOf("if ((n.kind || 'note') === 'log') continue   // 日志永不被孤儿清理提名") >= 0, label + ' orphan 候选显式排除 log')
    }
  })
  await t('host 双侧：settings 键 logWeekAfterDays/logRetentionDays 校验 + _suggest 第四类候选 logHygieneCandidates（只提名不执行）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const LOG_WEEK_AFTER_DAYS_DEFAULT = 7') >= 0 && s.indexOf('const LOG_RETENTION_DAYS_DEFAULT = 90') >= 0, label + ' 窗口缺省 7/90（§6.3）')
      assert(s.indexOf('function logWeekAfterDaysLimit()') >= 0 && s.indexOf('function logRetentionDaysLimit()') >= 0, label + ' 窗口 helper（null 恢复缺省）')
      assert(s.indexOf("'logWeekAfterDays' in patch") >= 0 && s.indexOf("'logRetentionDays' in patch") >= 0, label + ' settings-set 两键校验')
      assert(s.indexOf('notes-settings-set: logWeekAfterDays 需要非负数值') >= 0 && s.indexOf('notes-settings-set: logRetentionDays 需要非负数值') >= 0, label + ' 非法值报错文案')
      assert(s.indexOf('logHygieneCandidates: suggestLogHygiene(all, logWeekAfterDaysLimit(), logRetentionDaysLimit())') >= 0, label + ' _suggest 第四类候选接线')
      assert(s.indexOf('工作周志 · ') >= 0 && s.indexOf('工作月志 · ') >= 0, label + ' 周志/月志标题三段式（§6.3）')
      assert(s.indexOf('_list(undefined, undefined, undefined, undefined, true)') >= 0, label + ' 治理路径显式包含日志（suggest/memory-guide）')
    }
  })

  // ---- 39.2 host 行为级（开发版独立实例 storeM/handlersM，与 33 节同款隔离模式）----
  const storeM = new Map()
  let writesM = 0
  const fsMockM = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeM.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeM.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeM.has(p)) throw new Error('ENOENT: ' + p); return storeM.get(p) },
    writeText: async (p, c) => { writesM++; storeM.set(p, c) },
  }
  const handlersM = {}
  const harnessMockM = { handle: (name, fn) => { handlersM[name] = fn; return () => { delete handlersM[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const contextsM = []
  new Function('harness', 'pluginDir', hostSrc)(harnessMockM, DIR).apply({
    fs: fsMockM, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contextsM.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const dayMsM = 86400000
  const dstrM = (d) => { const x = new Date(Date.now() - d * dayMsM); const p = (n) => String(n).padStart(2, '0'); return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) }
  const seedM = (id, fm, body) => storeM.set(NOTES_DIR + '\\' + id + '.md', '---\nid: ' + id + '\n' + fm.join('\n') + '\n---\n\n' + body)
  // 预热沉降：apply 心跳与首个 RPC 的 perf-report 是 fire-and-forget 写——先落定再断言零写入（33 节同款姿势）
  await handlersM['notes-list']({})
  await new Promise(r => setTimeout(r, 20))

  await t('kind=log 创建：inject 硬 false（显式 true 被纠正 + injectForcedOff 告知）+ recall 缺省 false + logDate 缺省今天 + front-matter 落盘', async () => {
    const lg = await handlersM['notes-create']({ title: '工作日志 · 测试', body: '## 做了什么\n\n验收工作记忆 v0', kind: 'log', inject: true })
    assert(lg.id && lg.injectForcedOff === true, '显式 inject:true 被纠正且响应告知（实得 ' + JSON.stringify(lg) + '）')
    const g = await handlersM['notes-get']({ id: lg.id })
    assert(g.note.kind === 'log' && g.note.inject === false, 'inject 硬 false 落库')
    assert(g.note.recall === false, 'recall 缺省 false（日志不进目录）')
    assert(/^\d{4}-\d{2}-\d{2}$/.test(g.note.logDate || ''), 'logDate 缺省取今天（本地时区 YYYY-MM-DD，实得 ' + g.note.logDate + '）')
    const raw = storeM.get(NOTES_DIR + '\\' + lg.id + '.md')
    assert(raw.indexOf('kind: log') >= 0 && raw.indexOf('inject: false') >= 0 && raw.indexOf('recall: false') >= 0, 'front-matter kind/inject/recall 落盘')
    assert(new RegExp('logDate: ' + g.note.logDate).test(raw), 'front-matter logDate 落盘')
    assert(raw.indexOf('entities:') < 0 && raw.indexOf('summarizedAt:') < 0, 'entities/summarizedAt 空值不落盘（条件行）')
  })
  await t('kind=log recall 显式 true 豁免 + 普通 note 不受隐身影响（recall 缺省 true / inject 照常）', async () => {
    const lg = await handlersM['notes-create']({ title: '日志-目录豁免', body: 'x', kind: 'log', recall: true })
    const g = await handlersM['notes-get']({ id: lg.id })
    assert(g.note.recall === true && g.note.inject === false, '显式 recall=true 允许进目录（豁免保留），inject 仍硬 false')
    const nm = await handlersM['notes-create']({ title: '普通笔记M', body: 'x', inject: true })
    const gn = await handlersM['notes-get']({ id: nm.id })
    assert(gn.note.recall === true && gn.note.inject === true, '普通笔记 recall/inject 口径不变（向后兼容）')
  })
  await t('检索字段往返：entities 经 notes-create 落盘并解析回数组；summarizedAt 经 notes-update 条件落盘', async () => {
    const c = await handlersM['notes-create']({ title: '实体往返', body: 'x', entities: ['alpha', 'beta'] })
    const raw = storeM.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(raw.indexOf('entities: alpha, beta') >= 0, 'entities 非空落盘（逗号分隔同 tags 路径）')
    const g = await handlersM['notes-get']({ id: c.id })
    assert.deepStrictEqual(g.note.entities, ['alpha', 'beta'], 'entities 解析回数组（往返无损）')
    assert((g.note.logDate || '') === '', '非 log 笔记 logDate 为空串（§7.2 其他空）')
    await handlersM['notes-update']({ id: c.id, summarizedAt: '2026-10-02T13:00:00.000Z' })
    const raw2 = storeM.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(raw2.indexOf('summarizedAt: "2026-10-02T13:00:00.000Z"') >= 0, 'summarizedAt 条件落盘（ISO 串含冒号，escYaml 引号包裹——与 createdAt 同款）')
    const g2 = await handlersM['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.summarizedAt, '2026-10-02T13:00:00.000Z', 'summarizedAt 解析往返')
  })
  await t('隐身口径：默认列表/默认搜索排除 kind=log；显式 kind=log 或 includeLogs:true 召回；回收站路径含日志', async () => {
    const def = await handlersM['notes-list']({})
    assert(def.notes.every(n => n.kind !== 'log'), '默认列表零日志（实得含 log：' + def.notes.filter(n => n.kind === 'log').length + '）')
    assert(def.notes.some(n => n.title === '普通笔记M'), '默认列表含普通笔记')
    const only = await handlersM['notes-list']({ kind: 'log' })
    assert(only.notes.length >= 2 && only.notes.every(n => n.kind === 'log'), '显式 kind=log 过滤召回（实得 ' + only.notes.length + '）')
    const inc = await handlersM['notes-list']({ includeLogs: true })
    assert(inc.notes.some(n => n.kind === 'log') && inc.notes.some(n => n.kind === 'note'), 'includeLogs:true 混合召回')
    const s0 = await handlersM['notes-search']({ query: '工作日志' })
    assert(s0.notes.every(n => n.kind !== 'log'), '默认搜索排除日志')
    const s1 = await handlersM['notes-search']({ query: '工作日志', kind: 'log' })
    assert(s1.notes.length >= 1 && s1.notes.every(n => n.kind === 'log'), 'kind=log 搜索召回')
    const s2 = await handlersM['notes-search']({ query: '工作日志', includeLogs: true })
    assert(s2.notes.some(n => n.kind === 'log'), 'includeLogs:true 搜索召回')
    const tr = await handlersM['notes-list']({ includeDeleted: true })
    assert(tr.notes.some(n => n.kind === 'log'), '回收站（includeDeleted）路径显式包含日志（隐身不适用治理面）')
  })
  await t('update 硬闸：kind=log 显式 inject:true 被纠正（injectForcedOff + injectEver 不拉起）；改 kind=note 后恢复普通语义', async () => {
    const lg = await handlersM['notes-create']({ title: '改注入演示', body: 'x', kind: 'log' })   // r3 车道模型已删跨车道重叠检测，标题关键词不再敏感
    const u1 = await handlersM['notes-update']({ id: lg.id, inject: true })
    assert(u1.injectForcedOff === true, 'update 显式 inject:true 被纠正并告知')
    const g1 = await handlersM['notes-get']({ id: lg.id })
    assert(g1.note.inject === false && g1.note.injectEver === false, 'inject=false 且 injectEver 未被粘性拉起')
    const u2 = await handlersM['notes-update']({ id: lg.id, kind: 'note' })
    assert(!u2.error, 'kind 改为 note 成功')
    const u3 = await handlersM['notes-update']({ id: lg.id, inject: true })
    assert(u3.injectForcedOff !== true, 'kind=note 后 inject:true 不再纠正')
    const g3 = await handlersM['notes-get']({ id: lg.id })
    assert(g3.note.inject === true && g3.note.injectEver === true, '普通语义恢复（injectEver 粘性照常）')
  })
  await t('目录注入尾部日志计数提示行（order 131，有日志恒出现；只出计数不出标题）', async () => {
    const cat = contextsM.find(c => c.order === 131)
    assert(cat && typeof cat.text === 'function', 'notes:catalog order 131 已注册')
    const txt = cat.text()
    const m = txt.match(/另有 (\d+) 条工作日志（kind=log，默认隐身不进目录），用 note_search 传 kind=log 检索/)
    // 此刻实例内恰 2 条 log：「工作日志 · 测试」（recall=false）+「日志-目录豁免」（recall=true 豁免，同时以条目进目录）；「改注入演示」已转 kind=note
    assert(m && +m[1] === 2, '目录尾部日志计数提示行（实得计数 ' + (m && m[1]) + '）')
    assert(txt.indexOf('工作日志 · 测试') < 0, '提示行不含日志标题（天然无泄露面）')
  })

  // ---- 39.3 启用流程（notes-memory-guide check/enable/status/disable 全链路，r3 车道模型）----
  await t('notes-memory-guide：status 缺省关 → check 同类唯一性（零写入）→ enable 无确认闸门直建 + contractType 落盘 + origin 溯源', async () => {
    // 造一条含「记录」关键词的已注入反馈约定——r3 车道模型下它与记忆车道并行共存：不再被列为重叠候选、不阻断启用（产品裁决：重复合法）
    const ov = await handlersM['notes-create']({ title: '约定：看板反馈记录', body: '使用问题随手记录到「看板反馈」文件夹', inject: true, topic: '约定' })
    const st0 = await handlersM['notes-memory-guide']({ op: 'status' })
    assert(st0.enabled === false, '缺省关（无 contractType/tag memory-guide 笔记）')
    const keysBefore = Array.from(storeM.keys()).sort()
    const chk = await handlersM['notes-memory-guide']({ op: 'check' })
    assert.deepStrictEqual(Array.from(storeM.keys()).sort(), keysBefore, 'check 为 dry-run 零写入')
    assert(chk.enabled === false && chk.already === false && chk.overlaps === undefined, 'check 同类唯一性语义：未启用 → 可直接启用；不再返回跨车道 overlaps（实得 ' + JSON.stringify(chk) + '）')
    // r3：无 confirmed 闸门——库内存在反馈约定（r2 语义的重叠候选）也直接创建
    const e2 = await handlersM['notes-memory-guide']({ op: 'enable', scope: ['abc12345'] })
    assert(e2.ok === true && e2.id && !e2.already && e2.needConfirm === undefined, 'enable 无确认闸门直建（实得 ' + JSON.stringify(e2) + '）')
    const g = await handlersM['notes-get']({ id: e2.id })
    assert(g.note.title === '约定：工作日志沉淀（工作记忆 v0）' && g.note.kind === 'note', '预填约定标题/kind=note（引导是行为约定，不是日志本身）')
    assert(g.note.inject === true && g.note.injectRole === 'convention', 'inject=true + convention 桶（单一注入源 order 130）')
    assert(g.note.tags.indexOf('memory-guide') >= 0, 'tag memory-guide 兼容发现键保留')
    assert(g.note.contractType === 'memory-guide', '契约分型：contractType=memory-guide 结构化身份标记（主识别键）')
    assert(storeM.get(NOTES_DIR + '\\' + e2.id + '.md').indexOf('contractType: memory-guide') >= 0, 'contractType 条件行落盘')
    assert.deepStrictEqual(g.note.injectTo, ['abc12345'], '作用域写入 injectTo（用户选择）')
    assert(g.note.body.indexOf('【分工边界】') >= 0 && g.note.body.indexOf('kind=log') >= 0, '引导模板全文（含分工边界段）')
    const folders = await handlersM['notes-folders']({})
    assert(folders.folders.some(f => f.name === '工作日志'), '启用同时确保「工作日志」虚拟文件夹存在')
    const st1 = await handlersM['notes-memory-guide']({ op: 'status' })
    assert(st1.enabled === true && st1.noteId === e2.id, 'status 单一事实源：启用态 = contractType+inject=true')
    const chk2 = await handlersM['notes-memory-guide']({ op: 'check' })
    assert(chk2.enabled === true && chk2.already === true && chk2.noteId === e2.id, 'check 同类唯一性：已启用 → 返回已启用信息（实得 ' + JSON.stringify(chk2) + '）')
    // 产物溯源（r3）：引导激活且作用域命中本会话（agentsMock 短 id abc12345 ∈ injectTo）→ 新建 kind=log 自动落 origin=memory-guide
    const lg = await handlersM['notes-create']({ title: '引导期沉淀日志', body: '## 做了什么\n\nx', kind: 'log' })
    const gl = await handlersM['notes-get']({ id: lg.id })
    assert(gl.note.origin === 'memory-guide', 'origin 自动溯源：激活+作用域命中 → 打标（实得 ' + JSON.stringify(gl.note.origin) + '）')
    assert(storeM.get(NOTES_DIR + '\\' + lg.id + '.md').indexOf('origin: memory-guide') >= 0, 'origin 条件行落盘')
    const nm0 = await handlersM['notes-create']({ title: '引导期普通笔记', body: 'x' })
    const rawNm = storeM.get(NOTES_DIR + '\\' + nm0.id + '.md')
    assert(rawNm.indexOf('origin:') < 0 && rawNm.indexOf('contractType:') < 0, '普通笔记不携带 origin/contractType 条件行（存量形态零变化）')
    const lgX = await handlersM['notes-create']({ title: '显式溯源日志', body: 'x', kind: 'log', origin: 'manual' })
    const gX = await handlersM['notes-get']({ id: lgX.id })
    assert(gX.note.origin === 'manual', '显式 origin 优先于自动打标（调用方可自带溯源值）')
  })
  await t('notes-memory-guide：enable 幂等（已启用不建第二条）+ disable 关 inject 停用 + origin 随激活态闸口 + 未知 op 报错', async () => {
    const st = await handlersM['notes-memory-guide']({ op: 'status' })
    assert(st.enabled === true && st.noteId, '前置：上一断言已启用')
    const e3 = await handlersM['notes-memory-guide']({ op: 'enable', scope: [] })
    assert(e3.ok === true && e3.already === true && e3.id === st.noteId, '幂等：重复启用返回现状（不建第二条）')
    const d1 = await handlersM['notes-memory-guide']({ op: 'disable' })
    assert(d1.ok === true && d1.disabled === true && d1.id === st.noteId, 'disable = 关闭该约定 inject')
    const g = await handlersM['notes-get']({ id: st.noteId })
    assert(g.note.inject === false && g.note.injectEver === true, '笔记保留（inject 已关；injectEver 粘性照常）')
    const st2 = await handlersM['notes-memory-guide']({ op: 'status' })
    assert(st2.enabled === false && st2.noteId === st.noteId, '停用后 status=关（笔记仍在可再启用）')
    // 产物溯源随激活态：停用后新建日志不再打 origin（自动打标闸口闭合）
    const lgOff = await handlersM['notes-create']({ title: '停用期日志', body: 'x', kind: 'log' })
    const gOff = await handlersM['notes-get']({ id: lgOff.id })
    assert((gOff.note.origin || '') === '', '停用后新日志不再打 origin（实得 ' + JSON.stringify(gOff.note.origin) + '）')
    const d2 = await handlersM['notes-memory-guide']({ op: 'disable' })
    assert(d2.ok === true && d2.disabled === false, '重复停用幂等（本就未启用）')
    const bad = await handlersM['notes-memory-guide']({ op: 'bogus' })
    assert(bad.error && bad.error.indexOf('未知 op') >= 0, '未知 op 报错')
    // 复启用（停用后的笔记仍存在 → active=null 时新建一条；此处验证「删除即彻底退出」前的再启用路径）
    const e4 = await handlersM['notes-memory-guide']({ op: 'enable', scope: [] })
    assert(e4.ok === true && e4.id && e4.id !== st.noteId, '停用后再启用创建新约定（旧约定 inject=false 不视为启用）')
    const g4 = await handlersM['notes-get']({ id: e4.id })
    assert(g4.note.contractType === 'memory-guide', '再启用的新约定同样带契约身份标记')
  })
  await t('notes-memory-guide：tag memory-guide 兼容发现键（存量无 contractType 引导仍识别/可停用/兼容态 origin 打标）', async () => {
    // 前置：上一断言末已再启用（contractType 引导 inject=true scope=[]）——先停用，腾出「无激活契约引导」状态
    const d0 = await handlersM['notes-memory-guide']({ op: 'disable' })
    assert(d0.disabled === true, '前置停用当前契约引导')
    // 造 r2 形态存量引导：仅 tag memory-guide + inject=true，无 contractType（兼容发现键路径）
    const legacy = await handlersM['notes-create']({ title: '约定：旧版沉淀引导', body: 'x', tags: ['memory-guide'], inject: true, topic: '约定' })
    const gL = await handlersM['notes-get']({ id: legacy.id })
    assert((gL.note.contractType || '') === '', '前置确认：存量引导无 contractType 标记')
    const st = await handlersM['notes-memory-guide']({ op: 'status' })
    assert(st.enabled === true && st.noteId === legacy.id, 'tag 兼容发现：无 contractType 的存量引导仍被识别为已启用（实得 ' + JSON.stringify(st) + '）')
    const lg = await handlersM['notes-create']({ title: '兼容态日志', body: 'x', kind: 'log' })
    const gLog = await handlersM['notes-get']({ id: lg.id })
    assert(gLog.note.origin === 'memory-guide', '兼容引导激活态下 origin 打标同样生效（tag 兜底身份判定）')
    const d1 = await handlersM['notes-memory-guide']({ op: 'disable' })
    assert(d1.disabled === true && d1.id === legacy.id, 'disable 按 tag 兼容定位并停用存量引导')
  })

  // ---- 39.4 日志卫生提名（suggest 第四类候选；只提名不执行）----
  await t('notes-suggest logHygieneCandidates：周聚合（>7 天 工作区×ISO 周）+ 月聚合（>90 天 工作区×月）+ 同组 ≥2 才提名', async () => {
    // 造确定性日志：dstr(10) ×2（wsA 同周）、dstr(100) ×2（wsA 同月）、dstr(2)（新日志不成组）、dstr(10) wsB 单条（≥2 规则出局）
    const iso = (d) => new Date(Date.now() - d * dayMsM).toISOString()
    seedM('n-m-lgw1', ['title: 日志W1', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(10), 'sessionId: sess-w1', 'createdAt: "' + iso(10) + '"', 'updatedAt: "' + iso(10) + '"'], '周志成员一')
    seedM('n-m-lgw2', ['title: 日志W2', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(10), 'sessionId: sess-w2', 'createdAt: "' + iso(10) + '"', 'updatedAt: "' + iso(10) + '"'], '周志成员二')
    seedM('n-m-lgm1', ['title: 日志M1', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(100), 'createdAt: "' + iso(100) + '"', 'updatedAt: "' + iso(100) + '"'], '月志成员一')
    seedM('n-m-lgm2', ['title: 日志M2', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(100), 'createdAt: "' + iso(100) + '"', 'updatedAt: "' + iso(100) + '"'], '月志成员二')
    seedM('n-m-lgfresh', ['title: ' + '新日志', 'kind: log', 'workspace: wsA', 'logDate: ' + dstrM(2), 'createdAt: "' + iso(2) + '"', 'updatedAt: "' + iso(2) + '"'], '未超窗')
    seedM('n-m-lgsolo', ['title: 单条旧日志', 'kind: log', 'workspace: wsB', 'logDate: ' + dstrM(10), 'createdAt: "' + iso(10) + '"', 'updatedAt: "' + iso(10) + '"'], 'wsB 单条不成组')
    const r = await handlersM['notes-suggest']({})
    assert(!r.error && r.logHygieneCandidates, '第四类候选存在（实得键 ' + Object.keys(r).join(',') + '）')
    const hg = r.logHygieneCandidates
    const wk10 = sugNS.suggestISOWeek(dstrM(10)), wk100 = sugNS.suggestISOWeek(dstrM(100)), mo100 = dstrM(100).slice(0, 7)
    const wKeys = hg.weekly.map(g => g.key)
    assert(wKeys.indexOf('wsA|' + wk10) >= 0 && wKeys.indexOf('wsA|' + wk100) >= 0, '周聚合两组（10 天组 + 100 天组同区不同周；实得 ' + wKeys.join(',') + '）')
    assert(wKeys.every(k => k.indexOf('wsB|') < 0), 'wsB 单条旧日志不成组（同组 ≥2 条才提名）')
    const wA = hg.weekly.find(g => g.key === 'wsA|' + wk10)
    assert(wA.title === '工作周志 · wsA · ' + wk10 && wA.members.length === 2, '周志标题三段式 + 2 成员')
    assert(wA.members[0].logDate === dstrM(10) && typeof wA.members[0].sessionId === 'string', '成员含 id/title/logDate/sessionId（明细展示数据源）')
    assert(hg.monthly.length === 1 && hg.monthly[0].key === 'wsA|' + mo100 && hg.monthly[0].title === '工作月志 · wsA · ' + mo100, '月聚合一组（>90 天；实得 ' + hg.monthly.map(g => g.key).join(',') + '）')
    assert(hg.monthly[0].members.length === 2, '月志 2 成员（原始日志混合归组）')
    // 日志永不进过期/孤儿候选（只聚合不淘汰，§6.3 红线）
    const staleIds = r.staleCandidates.map(x => x.id), orphIds = r.orphanCandidates.map(x => x.id)
    for (const lid of ['n-m-lgw1', 'n-m-lgw2', 'n-m-lgm1', 'n-m-lgm2', 'n-m-lgfresh', 'n-m-lgsolo']) {
      assert(staleIds.indexOf(lid) < 0 && orphIds.indexOf(lid) < 0, '日志不进 stale/orphan：' + lid)
    }
    // 前三段口径不变（速记组结构仍与 archive-preview 同源）
    assert(Array.isArray(r.archiveCandidates) && Array.isArray(r.staleCandidates) && Array.isArray(r.orphanCandidates) && typeof r.generatedAt === 'string', '四段 + generatedAt 结构齐备')
  })
  await t('日志卫生窗口跟随 settings（logRetentionDays=0 关闭月聚合；logWeekAfterDays override 生效 + null 恢复缺省）', async () => {
    await handlersM['notes-settings-set']({ logRetentionDays: 0 })
    const r1 = await handlersM['notes-suggest']({})
    assert(r1.logHygieneCandidates.monthly.length === 0 && r1.logHygieneCandidates.weekly.length >= 1, 'logRetentionDays=0 关闭月聚合本级（周聚合不受影响）')
    await handlersM['notes-settings-set']({ logWeekAfterDays: 120 })
    const r2 = await handlersM['notes-suggest']({})
    assert(r2.logHygieneCandidates.weekly.length === 0, 'logWeekAfterDays=120：10/100 天均未超窗 → 周聚合空')
    await handlersM['notes-settings-set']({ logWeekAfterDays: null, logRetentionDays: null })
    const r3 = await handlersM['notes-suggest']({})
    assert(r3.logHygieneCandidates.weekly.length >= 1 && r3.logHygieneCandidates.monthly.length === 1, 'null 恢复缺省 7/90 → 两组回到候选')
    const bad1 = await handlersM['notes-settings-set']({ logWeekAfterDays: -3 })
    const bad2 = await handlersM['notes-settings-set']({ logRetentionDays: 'x' })
    assert(bad1.error && bad2.error, '负数/非数值报错不落盘')
  })

  // ---- 39.4b 检索字段落盘保留链（notes-fm-serializer-ext 验收：三键 round-trip 全链 + 存量零迁移显式锁定）----
  // 放在 39.4 之后：本断言新增 1 条 log + 1 条旧格式 note 进 storeM，前置断言（目录日志计数 ===2 / check 同类唯一性 / 卫生聚合精确组数）均已执行完毕，零污染；
  // 39.5 起为静态包独立实例（storeM2），40 节以后均不使用 storeM/handlersM。
  await t('检索字段保留：update 其他字段后 logDate/entities 磁盘保留 + summarizedAt 注入落盘 + 存量零迁移缺省解析', async () => {
    // 验收链①：create log（logDate 缺省今天 + entities）→ update 仅改 title/summarizedAt → logDate/entities 磁盘保留、三键解析无损
    const lg = await handlersM['notes-create']({ title: '字段保留演示', body: 'x', kind: 'log', entities: ['gamma', 'delta'] })
    const raw0 = storeM.get(NOTES_DIR + '\\' + lg.id + '.md')
    const ld0 = (raw0.match(/logDate: (\d{4}-\d{2}-\d{2})/) || [])[1]
    assert(ld0 && raw0.indexOf('entities: gamma, delta') >= 0, 'create 落盘基线（logDate=' + ld0 + ' + entities 条件行）')
    assert(raw0.indexOf('origin:') < 0 && raw0.indexOf('contractType:') < 0, '引导未激活（兼容断言链末已停用）：新建日志不打 origin——自动打标闸口闭合')
    await handlersM['notes-update']({ id: lg.id, title: '字段保留演示 v2', summarizedAt: '2026-10-03T01:00:00.000Z' })
    const raw1 = storeM.get(NOTES_DIR + '\\' + lg.id + '.md')
    assert(raw1.indexOf('logDate: ' + ld0) >= 0, 'update 其他字段后 logDate 磁盘保留（不被清空/重算）')
    assert(raw1.indexOf('entities: gamma, delta') >= 0, 'update 后 entities 磁盘保留（条件行未被丢）')
    assert(raw1.indexOf('summarizedAt: "2026-10-03T01:00:00.000Z"') >= 0, 'summarizedAt 手工注入条件落盘')
    const g1 = await handlersM['notes-get']({ id: lg.id })
    assert(g1.note.logDate === ld0 && g1.note.entities.join() === 'gamma,delta' && g1.note.summarizedAt === '2026-10-03T01:00:00.000Z', '三键解析往返无损')
    // 验收链②存量零迁移：旧格式笔记（front-matter 无三键）→ parse 出缺省值；update 后 entities/summarizedAt 条件行仍不出现
    seedM('n-m-legacy', ['title: 旧格式笔记', 'createdAt: "2026-01-01T00:00:00.000Z"', 'updatedAt: "2026-01-01T00:00:00.000Z"'], '旧正文')
    const gl = await handlersM['notes-get']({ id: 'n-m-legacy' })
    assert((gl.note.logDate || '') === '' && gl.note.entities.length === 0 && (gl.note.summarizedAt || '') === '' && (gl.note.contractType || '') === '' && (gl.note.origin || '') === '', "旧格式五键缺省解析（logDate='' / entities=[] / summarizedAt='' / contractType='' / origin=''）")
    await handlersM['notes-update']({ id: 'n-m-legacy', title: '旧格式笔记 v2' })
    const rawL = storeM.get(NOTES_DIR + '\\n-m-legacy.md')
    assert(rawL.indexOf('entities:') < 0 && rawL.indexOf('summarizedAt:') < 0 && rawL.indexOf('contractType:') < 0 && rawL.indexOf('origin:') < 0, '旧笔记 update 后 entities/summarizedAt/contractType/origin 条件行仍不落盘（条件行零迁移红线）')
    // 口径说明：logDate 为 v0.3.1 已提交的「恒写空串行」语义（buildFM 注释 + L7703 双侧断言锁定），与任务指引「三键缺省逐字节一致」存在偏差——
    // 此处按已提交口径断言（logDate: 空行出现），偏差留 Verifier/主窗口裁决（改条件行需同步翻本断言 + L7703 + L7803）
    assert(rawL.indexOf('logDate: \n') >= 0, 'logDate 恒写空串行（v0.3.1 已提交口径：恒写，非条件行）')
  })

  // ---- 39.5 静态包行为（index.mjs 独立 ESM 实例，harness 主通道）----
  await t('静态包：notes-memory-guide 注册 + kind=log 隐身硬闸 + suggest 第四段（index.mjs 独立实例）', async () => {
    const storeM2 = new Map()
    const fsMockM2 = mkFsMockImp(storeM2, [NOTES_ROOT_STATIC])
    const handlersM2 = {}
    const harnessMockM2 = { handle: (name, fn) => { handlersM2[name] = fn; return () => { delete handlersM2[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
    const harnessBackup39 = global.harness
    global.harness = harnessMockM2
    try {
      const modM2 = await import(pathToFileURL(INDEX_PATH).href + '?memory=1')
      modM2.apply({
        fs: fsMockM2, sandboxPolicy: { resolve: () => ({}) },
        webServer: { register: () => () => {} }, tools: { register: () => () => {} },
        get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
        effect: () => {},
      })
      assert.strictEqual(typeof handlersM2['notes-memory-guide'], 'function', '静态包注册 notes-memory-guide')
      const lg = await handlersM2['notes-create']({ title: '静态日志', body: 'x', kind: 'log', inject: true })
      assert(lg.id && lg.injectForcedOff === true, '静态包 inject 硬闸（显式 true 纠正 + 告知）')
      const g = await handlersM2['notes-get']({ id: lg.id })
      assert(g.note.inject === false && g.note.recall === false && /^\d{4}-\d{2}-\d{2}$/.test(g.note.logDate || ''), '静态包 recall 缺省 false + logDate 缺省今天')
      assert((g.note.origin || '') === '', '启用前创建的日志无 origin（打标闸口随激活态）')
      const def = await handlersM2['notes-list']({})
      assert(def.notes.every(n => n.kind !== 'log'), '静态包默认列表排除日志')
      const en = await handlersM2['notes-memory-guide']({ op: 'enable', scope: [] })
      assert(en.ok === true && en.id && !en.already && en.needConfirm === undefined, '静态包启用流程（r3 车道模型：无确认闸门幂等直建）')
      const gg = await handlersM2['notes-get']({ id: en.id })
      assert(gg.note.contractType === 'memory-guide', '静态包契约身份标记落库（contractType 条件行）')
      const st = await handlersM2['notes-memory-guide']({ op: 'status' })
      assert(st.enabled === true && st.noteId === en.id, '静态包 status 单一事实源')
      const lg2 = await handlersM2['notes-create']({ title: '静态溯源日志', body: 'x', kind: 'log' })
      const gl2 = await handlersM2['notes-get']({ id: lg2.id })
      assert(gl2.note.origin === 'memory-guide', '静态包 origin 自动打标（引导激活 + 全局作用域命中）')
      const sg = await handlersM2['notes-suggest']({})
      assert(sg.logHygieneCandidates && Array.isArray(sg.logHygieneCandidates.weekly) && Array.isArray(sg.logHygieneCandidates.monthly), '静态包 suggest 第四段结构')
    } finally {
      if (harnessBackup39 === undefined) delete global.harness; else global.harness = harnessBackup39
    }
  })

  // ---- 39.6 四端同步（client-impl / 发布包 lib/client.js / app.html / 原型 notes-ui-v2.html + styles.css）----
  await t('四端 kind=log：KIND 标签/模板/筛选类型组/色板变量/专入口接线同步（client + 发布包 + app.html + 原型 + styles）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("log: '日志'") >= 0, label + ' KIND_LABELS 含日志')
      assert(s.indexOf("'## 做了什么\\n\\n（本会话完成的任务/阶段，一句话一条）") >= 0, label + ' KIND_TEMPLATES.log 与 host 同份')
      assert(s.indexOf("const FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log']") >= 0, label + ' 筛选中心类型组含 log（kind=日志 即专入口）')
      assert(s.indexOf("e('option', { value: 'log' }, '日志')") >= 0, label + ' 编辑器 kind 下拉含日志')
      assert(s.indexOf("['note', 'decision', 'todo', 'link', 'quote', 'log'].map(k => e('option'") >= 0, label + ' 新建 modal 类型含日志（预填 log 模板骨架）')
      assert(s.indexOf("notes-list', wantLogsRef.current ? { includeLogs: true } : undefined") >= 0, label + ' loadNotes 日志专入口 includeLogs 接线（host 默认排除）')
      assert(s.indexOf("(n.kind || 'note') !== 'log' || filters.kinds.indexOf('log') >= 0") >= 0, label + ' 隐身渲染守卫（未勾日志不进日常视图）')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("log: '日志'") >= 0, label + ' KIND 含日志')
      assert(s.indexOf("'## 做了什么\\n\\n（本会话完成的任务/阶段，一句话一条）") >= 0, label + ' KIND_TEMPLATES.log 与 host 同份')
      assert(s.indexOf("var FILTER_KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log'];") >= 0, label + ' 筛选类型组含 log')
      assert(s.indexOf("log: 'var(--kind-log)'") >= 0, label + ' KCOLOR 含 log')
      assert(s.indexOf('--kind-log:') >= 0, label + ' 色板 --kind-log 变量（双主题）')
      assert(s.indexOf("rpc('notes-list', wantLogs ? { includeLogs: true } : undefined)") >= 0, label + ' loadNotes includeLogs 接线')
      assert(s.indexOf("(n.kind || 'note') === 'log' && filters.kinds.indexOf('log') < 0") >= 0, label + ' 隐身渲染守卫')
      assert(s.indexOf('function maybeReloadForLogs()') >= 0, label + ' 勾选「日志」自动重拉列表')
    }
    const cssDev2 = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg2 = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    assert(cssDev2.indexOf('--nkind-log:') >= 0 && cssPkg2.indexOf('--nkind-log:') >= 0, 'styles.css 双端 --nkind-log 日志色点（需跑 scripts/build-dist.cjs）')
  })
  await t('设置卡片「工作记忆」区 + 启用对话框（状态行/作用域/车道说明/停用，r3 无重叠确认）四端同步', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("{ key: 'memory', label: '工作记忆'") >= 0, label + ' 设置卡片「工作记忆」行')
      assert(s.indexOf("{ key: 'logweek', label: '日志周聚合窗口'") >= 0 && s.indexOf("{ key: 'logmonth', label: '日志月聚合窗口'") >= 0, label + ' 日志卫生两级窗口行')
      assert(s.indexOf("'notes-memory-guide', { op: 'status' }") >= 0, label + ' 状态探测调用点')
      assert(s.indexOf("'notes-memory-guide', { op: 'check' }") < 0, label + ' 不再调用 check 重叠扫描（r3 车道模型：enable 幂等直建）')
      assert(s.indexOf("'notes-memory-guide', { op: 'enable', scope: memScopeResolve() }") >= 0, label + ' 启用调用点（作用域；无 confirmed 闸门）')
      assert(s.indexOf('confirmed') < 0 && s.indexOf('memCheck') < 0 && s.indexOf('语义重叠') < 0, label + ' 冲突确认/重叠检查 UI 与状态已移除')
      assert(s.indexOf('工作记忆是独立于笔记约定的并行通道') >= 0, label + ' 车道说明文案（并行通道：约定给人看 / 记忆自用召回，可对同一事件同时生效）')
      assert(s.indexOf('contractType: memory-guide') >= 0, label + ' 对话框文案标注契约身份 contractType')
      assert(s.indexOf("'notes-memory-guide', { op: 'disable' }") >= 0, label + ' 停用调用点（关 inject）')
      assert(s.indexOf('启用沉淀引导…') >= 0 && s.indexOf('约定：工作日志沉淀（工作记忆 v0）') >= 0, label + ' 入口按钮 + 对话框文案')
      // notes-scope-global-pick：「当前X」单选 → 「指定X」多选清单（全局视角；injectTo 落值语义不变——工作区档展开为所选工作区全部会话短 id 并集）
      assert(s.indexOf('function memScopeResolve()') >= 0 && s.indexOf("memScope === 'global'") >= 0 && s.indexOf("memScope === 'session'") >= 0, label + ' 作用域三档解析（全局/指定工作区/指定会话）')
      assert(s.indexOf("scopeOpt('workspace', '指定工作区（多选）'") >= 0 && s.indexOf("scopeOpt('session', '指定会话（多选）'") >= 0, label + ' 指定工作区/会话多选档文案')
      assert(s.indexOf('memWsPick') >= 0 && s.indexOf('memSidPick') >= 0 && s.indexOf('sessList.concat(sessPending)') >= 0, label + ' 多选清单状态 + 数据源（sessList + pending 占位）')
      assert(s.indexOf('当前工作区的会话') < 0 && s.indexOf('仅当前会话') < 0, label + ' 去「当前X」单选档（全局视角改造）')
      assert(s.indexOf('logWeekAfterDays: v') >= 0 && s.indexOf('logRetentionDays: v') >= 0, label + ' 窗口保存 payload')
      assert(s.indexOf('memOpenRef.current) { setMemOpen(false)') >= 0, label + ' Esc 优先关启用对话框')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('id="setMemoryCtrl"') >= 0, label + ' 设置卡片「工作记忆」行')
      assert(s.indexOf('id="setLogWeek"') >= 0 && s.indexOf('id="setLogMonth"') >= 0, label + ' 日志卫生窗口输入行')
      assert(s.indexOf("rpc('notes-memory-guide', { op: 'status' })") >= 0, label + ' 状态探测调用点')
      assert(s.indexOf("rpc('notes-memory-guide', { op: 'check' })") < 0, label + ' 不再调用 check 重叠扫描（r3 车道模型）')
      assert(s.indexOf("{ op: 'enable', scope: scope }") >= 0, label + ' 启用调用点（无 confirmed 闸门）')
      assert(s.indexOf('confirmed') < 0 && s.indexOf('renderMemOverlap') < 0 && s.indexOf('memOverlap') < 0, label + ' 冲突确认/重叠列表 UI 已移除')
      assert(s.indexOf('工作记忆是独立于笔记约定的并行通道') >= 0, label + ' 车道说明文案（并行通道语义）')
      assert(s.indexOf('contractType: memory-guide') >= 0, label + ' 对话框文案标注契约身份 contractType')
      assert(s.indexOf("{ op: 'disable' }") >= 0, label + ' 停用调用点')
      assert(s.indexOf('function renderMemoryStatus') >= 0 && s.indexOf('启用沉淀引导…') >= 0, label + ' 状态行渲染 + 入口')
      assert(s.indexOf('memEnableState = null') >= 0, label + ' Esc 关闭启用对话框（状态复位）')
      // notes-scope-global-pick：作用域档 = 所有会话 / 指定工作区（多选）/ 指定会话（多选）——双多选清单容器 + 工作区勾选接线 + 并集展开
      assert(s.indexOf('id="memWsList"') >= 0 && s.indexOf('id="memSessList"') >= 0, label + ' 指定工作区/会话多选清单容器')
      assert(s.indexOf('指定工作区（多选，下方勾选）') >= 0 && s.indexOf('指定会话（多选，下方勾选）') >= 0, label + ' 全局视角多选档文案')
      assert(s.indexOf('data-memws') >= 0 && s.indexOf('data-memsid') >= 0, label + ' 工作区/会话勾选接线')
      assert(s.indexOf('wss[s.workspace]') >= 0, label + ' 指定工作区 → 会话短 id 并集展开（injectTo 落值语义不变）')
      assert(s.indexOf('value="custom"') < 0, label + ' 去旧 custom 单档（全局视角改造）')
    }
    assert(protoV2Src.indexOf("if (method === 'notes-memory-guide')") >= 0, '原型 mock 含 notes-memory-guide 分支（status/check/enable/disable）')
    assert(protoV2Src.indexOf("indexOf('memory-guide')") >= 0, '原型 mock 兼容发现键 tag memory-guide')
    assert(protoV2Src.indexOf("contractType: 'memory-guide'") >= 0 && protoV2Src.indexOf('x.contractType === \'memory-guide\'') >= 0, '原型 mock 契约身份分型（contractType 主识别键 + 落值）')
    assert(protoV2Src.indexOf('needConfirm') < 0 && protoV2Src.indexOf('overlaps') < 0, '原型 mock 无确认闸门/重叠候选（车道模型）')
  })
  await t('整理建议 modal 第四段「日志卫生」四端同步（周/月聚合提名 + 明细展开 + 只提名不执行文案）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('logHygieneCandidates') >= 0, label + ' suggestData 第四类候选消费')
      assert(s.indexOf("'日志卫生'") >= 0 && s.indexOf('周聚合') >= 0 && s.indexOf('月聚合') >= 0, label + ' 第四段标题 + 两级分组')
      assert(s.indexOf('logHgExpand') >= 0, label + ' 组明细展开态')
      assert(s.indexOf('v0 仅展示明细，一键合并将在后续版本提供') >= 0, label + ' 只提名不执行文案（从简口径）')
    }
    for (const pair of [['app.html', appSrc], ['原型 notes-ui-v2.html', protoV2Src]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('logHygieneCandidates') >= 0 && s.indexOf('日志卫生') >= 0, label + ' 第四段渲染')
      assert(s.indexOf('sg-loghg') >= 0 && s.indexOf('logHgExpand') >= 0, label + ' 明细展开接线')
      assert(s.indexOf("'周聚合'") >= 0 && s.indexOf("'月聚合'") >= 0, label + ' 周/月两级分组标签')
    }
    assert(protoV2Src.indexOf('工作周志 · ') >= 0 && protoV2Src.indexOf('工作月志 · ') >= 0, '原型 mock 周志/月志标题三段式生成')
    assert(protoV2Src.indexOf("kind: 'log'") >= 0 && protoV2Src.indexOf('logDate') >= 0, '原型 mock 日志演示数据（kind=log + logDate）')
    assert(protoV2Src.indexOf('sgIsoWeek') >= 0, '原型 mock 日志卫生 ISO 周归组')
  })
  await t('工具 schema：note_search/note_manage kind 枚举含 log + 隐身口径描述 + includeLogs 参数', () => {
    const ns = findTool('note_search'), nm = findTool('note_manage')
    assert(ns.parameters.properties.kind.enum.indexOf('log') >= 0, 'note_search kind enum 含 log')
    assert(nm.parameters.properties.kind.enum.indexOf('log') >= 0, 'note_manage kind enum 含 log')
    assert(ns.parameters.properties.includeLogs && nm.parameters.properties.includeLogs, '两工具 includeLogs 参数（显式召回日志）')
    assert(ns.description.indexOf('kind=log') >= 0 && ns.description.indexOf('EXCLUDE') >= 0, 'note_search 描述同步默认排除日志')
    assert(nm.description.indexOf('kind=log') >= 0 && nm.description.indexOf('工作日志') >= 0 && nm.description.indexOf('stealth') >= 0, 'note_manage 描述同步 log 隐身口径（inject 硬关/recall 缺省 false）')
    assert(nm.parameters.properties.logDate, 'note_manage create 支持 logDate（高级回填；缺省今天）')
  })
  }
}
