// 节 130. 文档安全 S2（notes-052-pipeline-mask）：六面消费管线 secret span 避让（打码/绕行/剥除）
// 覆盖面（六面各一条行为级 + 同源锚）：
//   ① 注入打码：inject 约定正文 span 恒打码（不要求篇级 sensitive——span 独立生效）；span 占位优先于行级（span 内不再出 ******）；
//      尾部计数行「其中 X 条含机密区已脱敏」；红线：sensitive=true 且无 span 的行级打码行为原样（27.5 节既有断言不破）。
//   ② note_get 工具面缺省打码：占位同注入形态 + 响应附 spanCount；明文通道 reveal 已随 S3（notes-052-reveal-gate，节 131）落地——
//      本节锁缺省打码面 + reveal:false 行为不变，reveal 门禁/审计/引导行断言在节 131。
//      红线：notes-get RPC 面不动（面板编辑链路仍明文）。
//   ③ 检索双面：searchMatchFields 正文命中跳过 span 区间 + searchExcerpt 取窗绕行（span 内词永不命中、机密永不进摘要）
//      + 语义胜出 chunk 若非剥除派生（旧索引残留）→ 摘要退回正文开头良性段。
//   ④ 向量切块：切块前剥 span——良性部分照常入索引（fake embedder 计数断言：剥除派生一致性）；
//      新鲜度锚 = 剥除后文本（span-only 笔记与同良性对照笔记同 hash）；span-only 正文零块不进索引。
//      红线：_vectorIndexable 的 sensitive 篇级排除规则不动。
//   ⑤ AI 整理/分类送 LLM 前剥除：stripSecretSpansForLlm 三处消费（classify×2 调用面 + organize 入口）
//      + 剥除后加一行「[已省略 N 处机密区]」；零 span 时 prompt 逐字节原样（节 84 契约不破）。
//   ⑥ 导出打码：导出快照缺省 span 同形态占位 + maskedSpans 计数；includeSecret=true 显式开关才明文（缺省关不反向）；
//      .history 快照同形态打码；导入前备份恒明文（本地安全网语义）。
// 同源断言：六面全部走 src/shared/editor-kernel.js 的 parseSecretSpans（host 经 manifest @shared 切片纳入——物理单源），
//   host-impl / index.mjs 双包含逐字节一致切片；六消费方零私有 span 正则（无 ```secret 字面量）。
module.exports = {
  id: "130",
  title: "130. 文档安全 S2：六面消费管线 secret span 避让（notes-052-pipeline-mask）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { llmMock, admMock, agentsMock, sessionPersistenceMock, workspaceRegistryMock, sessionTitleMock, sessionQueryMock, NOTES_DIR } = S
  section('130. 文档安全 S2：六面消费管线 secret span 避让（notes-052-pipeline-mask）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const FENCE = '```secret'
  // 独立实例工厂（27.5 节同款隔离模式：fresh store/handlers/tools，零污染共享 S；llmCapture 可注入捕获 prompt 的 llm mock）
  function mk130(llmOverride) {
    const store = new Map()
    const fsMock = {
      resolve: async (p) => p,
      stat: async (p) => {
        if (p === NOTES_DIR) return { dir: true }
        if (store.has(p)) return { file: true }
        const prefix = p + '\\'
        for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }
        return null
      },
      listDir: async (p) => {
        // 目录项合成（36 节历史夹具同款能力）：.history\<id>\ 两层键 → 直子级合成目录项（type:'dir'），文件键直出
        const prefix = p + '\\'
        const out = []
        const seen = {}
        for (const k of store.keys()) {
          if (!k.startsWith(prefix)) continue
          const rest = k.slice(prefix.length)
          const cut = rest.indexOf('\\')
          if (cut < 0) { if (!seen[rest]) { seen[rest] = true; out.push({ name: rest }) } }
          else { const d = rest.slice(0, cut); if (d && !seen[d]) { seen[d] = true; out.push({ name: d, type: 'dir' }) } }
        }
        return out
      },
      readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
      writeText: async (p, c) => { store.set(p, c) },
    }
    const handlers = {}
    const tools = []
    const contexts = []
    const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: (c, d) => { tools.push(d); return () => {} } }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply({
      fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmOverride || llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return { store, handlers, tools, contexts }
  }

  // ===== 130.0 同源锚：@shared 切片物理单源 + 六消费方零私有正则 + 三处 LLM 剥除消费登记 =====
  const ekSrc = read('src/shared/editor-kernel.js')
  const s0 = ekSrc.indexOf('// ===== secret-span BEGIN'), s1 = ekSrc.indexOf('// ===== secret-span END') + '// ===== secret-span END'.length
  assert(s0 >= 0 && s1 > s0, 'editor-kernel.js 含 secret-span 标记区间')
  const spanSlice = ekSrc.slice(s0, s1)
  await t('S2 同源锚：@shared 切片双包逐字节一致（host-impl ⇄ index.mjs ⇄ editor-kernel.js 三方同文）+ 双 manifest 登记', () => {
    assert.strictEqual(hostSrc.indexOf(spanSlice) >= 0, true, 'host-impl.js 含 editor-kernel.js secret-span 切片逐字节')
    assert.strictEqual(indexSrc.indexOf(spanSlice) >= 0, true, 'index.mjs 含同一切片逐字节（需先跑 build-dist）')
    assert(hostSrc.indexOf(spanSlice) < hostSrc.indexOf('sensitive-helpers BEGIN'), '切片序位先于 sensitive-helpers（span 助手消费 parseSecretSpans）')
    for (const mf of ['src/host/manifest.dev.js', 'src/host/manifest.dist.js']) {
      const m = read(mf)
      assert(m.indexOf("'@shared/editor-kernel.js#secret-span'") >= 0, mf + ' 登记 @shared 切片条目')
      assert(m.indexOf("'@shared/editor-kernel.js#secret-span'\n'inject/sensitive-helpers.js'") >= 0, mf + ' 切片紧前于 sensitive-helpers（可见序）')
    }
  })
  await t('S2 零私有正则锚：九消费方全部经 span 助手族（无 ```secret 字面量、无私有围栏扫描）+ stripSecretSpansForLlm 五处消费（S3 补 conflict/extract）', () => {
    const consumers = [
      ['inject.js（注入打码）', 'src/host/inject.js', ['maskSecretSpans']],
      ['index.js（note_get 打码 + reveal 门禁）', 'src/host/index.js', ['stripSecretSpans', 'maskSecretSpans']],
      ['search.js（检索双面）', 'src/host/search.js', ['maskSecretSpans', 'secretSpanList']],
      ['kernel/vector-store.js（向量切块）', 'src/host/kernel/vector-store.js', ['stripSecretSpans']],
      ['llm/organize.js（整理剥除）', 'src/host/llm/organize.js', ['stripSecretSpansForLlm']],
      ['notes.js（分类剥除×2 + 选区提取剥除）', 'src/host/notes.js', ['stripSecretSpansForLlm']],
      ['transfer.js（导出打码：全量 + 单文件）', 'src/host/transfer.js', ['maskSecretSpans', 'secretSpanList']],
      ['dispatch.js（派发载荷打码——S3）', 'src/host/dispatch.js', ['maskSecretSpans', 'stripSecretSpans']],
      ['llm/conflict.js（体检 prompt 剥除——S3）', 'src/host/llm/conflict.js', ['stripSecretSpansForLlm']],
    ]
    for (const [label, p, helpers] of consumers) {
      const src = read(p)
      for (const h of helpers) assert(src.indexOf(h) >= 0, label + ' 消费 ' + h)
      assert(src.indexOf('```secret') < 0 && src.indexOf('\\x60\\x60\\x60secret') < 0, label + ' 零私有 span 围栏字面量（单一事实源红线）')
    }
    // 五处 LLM 剥除消费（classify×2 调用面 + organize 入口 + S3：extractInstruction 选区 + conflict 体检）双包计数锁定
    for (const [label, src] of [['host-impl.js', hostSrc], ['index.mjs', indexSrc]]) {
      assert((src.match(/stripSecretSpansForLlm\(text\)/g) || []).length === 3, label + ' classifyTopic 两处 + extractInstruction 选区剥除（notes.js 三调用面）')
      assert((src.match(/= stripSecretSpansForLlm\(body\)/g) || []).length === 1, label + ' organize 入口剥除（_aiOrganize；另 1 处命中为 sensitive-helpers 函数定义本体，不计消费）')
      assert((src.match(/stripSecretSpansForLlm\(String\(n\.body \|\| ''\)\)/g) || []).length === 1, label + ' conflict 体检数据集剥除（llm/conflict.js——S3 四面补漏之三）')
    }
  })

  // ===== 130.1 span 助手族行为级（切片 + sensitive-helpers 块合并 eval——host 作用域内形态）=====
  const sensBlk = hostSrc.match(/\/\/ ==== sensitive-helpers BEGIN ====[\s\S]*?\/\/ ==== sensitive-helpers END ====/)
  assert(sensBlk, 'host-impl.js 缺 sensitive-helpers 标记块')
  const NS130 = {}
  new Function('ns', spanSlice + '\n' + sensBlk[0] + '\nns.maskSecretSpans=maskSecretSpans; ns.stripSecretSpans=stripSecretSpans; ns.stripForLlm=stripSecretSpansForLlm; ns.maskSensitiveBody=maskSensitiveBody; ns.secretSpanList=secretSpanList;')(NS130)
  const spanBody = '开头良行\n\n' + FENCE + '\nSPANKEY99\n第二行\n```\n\n结尾良行'
  await t('S2 助手族行为级：maskSecretSpans 整块占位（N 行计数）+ stripSecretSpans {text,count} + stripForLlm 省略行 + 零 span 恒等', () => {
    const m = NS130.maskSecretSpans(spanBody)
    assert(m.indexOf('SPANKEY99') < 0 && m.indexOf('开头良行') >= 0 && m.indexOf('结尾良行') >= 0, 'span 明文消失、良性行保留')
    assert(m.indexOf('🔒 机密区（4 行，note_get reveal 获取）') >= 0, '占位单行形态（4 行 = 开闭栏 + 2 内容行）')
    const st = NS130.stripSecretSpans(spanBody)
    assert.strictEqual(st.count, 1, '剥除计数 1')
    assert(st.text.indexOf('SPANKEY99') < 0 && st.text.indexOf('开头良行') >= 0 && st.text.indexOf('结尾良行') >= 0, '剥除后良性保留')
    const lm = NS130.stripForLlm(spanBody)
    assert(lm.indexOf('SPANKEY99') < 0 && lm.indexOf('[已省略 1 处机密区]') >= 0, 'LLM 剥除 + 省略告知行')
    assert.strictEqual(NS130.maskSecretSpans('普通正文'), '普通正文', '零 span 打码恒等')
    assert.strictEqual(NS130.stripForLlm('普通正文'), '普通正文', '零 span LLM 剥除恒等（既有整理/分类行为原样）')
    // span 打码优先级高于行级：占位后再行级打码，占位行不再出 ******（键值规则不命中占位）
    const both = NS130.maskSensitiveBody(m, 'n-x')
    assert(both.indexOf('🔒 机密区（4 行，note_get reveal 获取）') >= 0, '占位行经行级打码原样保留（span 内不再跑 ******）')
  })

  // ===== 130.2 面一：注入打码（约定桶 span 恒打码 + 尾部计数行 + 篇级 sensitive 红线不动）=====
  await t('S2 面一：注入打码——span 恒打码（sensitive=false 也生效）+ 占位在正文 + 尾部机密计数行 + 篇级行级打码原样', async () => {
    const inst = mk130()
    await inst.handlers['notes-create']({ title: 'S2 注入机密约定', body: spanBody, inject: true, topic: '开发' })
    const r = await inst.handlers['notes-conventions']({})
    assert(r.text.indexOf('SPANKEY99') < 0, '注入文本零 span 明文')
    assert(r.text.indexOf('🔒 机密区（4 行，note_get reveal 获取）') >= 0, '注入文本含占位行（span 独立于篇级 sensitive 生效）')
    assert(r.text.indexOf('开头良行') >= 0 && r.text.indexOf('结尾良行') >= 0, '良性正文原样注入')
    assert(r.text.indexOf('其中 1 条含机密区已脱敏，明文经 note_get reveal 获取') >= 0, '尾部机密计数行')
    assert(r.text.indexOf('条含敏感信息已脱敏') < 0, '篇级 sensitive 计数行不出现（sensitive=false）')
    // 红线：sensitive=true 且无 span → 行级 ****** 行为原样 + 敏感计数行加一；机密计数行不增（span 计数独立于篇级 sensitive）
    await inst.handlers['notes-create']({ title: 'S2 敏感无机密约定', body: '部署密码：Top$ecret99\n普通第二行', inject: true, sensitive: true, topic: '运维' })
    const r2 = await inst.handlers['notes-conventions']({})
    assert(r2.text.indexOf('Top$ecret99') < 0 && r2.text.indexOf('部署密码：******（敏感，note_get ') >= 0, '行级打码原样（sensitive=true 无 span）')
    assert(r2.text.indexOf('其中 1 条含敏感信息已脱敏，原文用 note_get 按 id 获取') >= 0, '敏感计数行 = 1（仅本条敏感约定）')
    assert(r2.text.indexOf('其中 1 条含机密区已脱敏') >= 0, '机密计数行仍 = 1（无机密笔记不增——span 计数独立于 sensitive）')
    // 双标记笔记：span 占位 + 良性行行级 ****** 并存，双计数行并出
    await inst.handlers['notes-create']({ title: 'S2 双标记约定', body: '密码: abc123\n\n' + FENCE + '\nROOTPW999\n```', inject: true, sensitive: true, topic: '设计' })
    const r3 = await inst.handlers['notes-conventions']({})
    assert(r3.text.indexOf('ROOTPW999') < 0 && r3.text.indexOf('abc123') < 0, '双标记笔记 span 与敏感值均无明文')
    assert(r3.text.indexOf('密码: ******（敏感，note_get ') >= 0 && r3.text.indexOf('🔒 机密区（3 行，note_get reveal 获取）') >= 0, '行级 ****** 与 span 占位并存（span 区间不出 ******）')
    assert(r3.text.indexOf('其中 2 条含敏感信息已脱敏') >= 0 && r3.text.indexOf('其中 2 条含机密区已脱敏') >= 0, '双计数行口径（敏感 2 篇 + 机密 2 篇）')
  })

  // ===== 130.3 面二：note_get 工具面缺省打码 + spanCount + notes-get RPC 明文红线 =====
  await t('S2 面二：note_get 工具面缺省打码（占位 + spanCount）+ 无 span 原样 + notes-get RPC 明文红线', async () => {
    const inst = mk130()
    const c1 = await inst.handlers['notes-create']({ title: 'S2 取文机密', body: spanBody })
    const c2 = await inst.handlers['notes-create']({ title: 'S2 取文普通', body: '普通正文全量' })
    const noteGet = inst.tools.find(x => x.name === 'note_get')
    assert(noteGet && typeof noteGet.execute === 'function', 'note_get 工具在册')
    const g1 = await noteGet.execute({ id: c1.id })
    assert(g1.note.body.indexOf('SPANKEY99') < 0, 'note_get 工具面零 span 明文')
    assert(g1.note.body.indexOf('🔒 机密区（4 行，note_get reveal 获取）') >= 0, 'note_get 占位同注入形态')
    assert.strictEqual(g1.note.spanCount, 1, '响应附 spanCount=1')
    const g2 = await noteGet.execute({ id: c2.id })
    assert.strictEqual(g2.note.body, '普通正文全量', '无 span 笔记原样返回（零回归）')
    assert(!('spanCount' in g2.note), '无 span 不带 spanCount 键（向后兼容）')
    // 红线：notes-get RPC（面板编辑链路）仍明文 + 不带 spanCount
    const rp = await inst.handlers['notes-get']({ id: c1.id })
    assert(rp.note.body.indexOf('SPANKEY99') >= 0, 'notes-get RPC 明文原样（面板编辑链路，打码只落 agent 工具面）')
    assert(!('spanCount' in rp.note), 'notes-get RPC 不带 spanCount')
  })

  // ===== 130.4 面三：检索双面（命中跳 span + 摘要零机密 + 语义 chunk 回落）=====
  const searchBlk130 = hostSrc.match(/\/\/ ==== search-helpers BEGIN ====[\s\S]*?\/\/ ==== search-helpers END ====/)
  assert(searchBlk130, 'host-impl.js 缺 search-helpers 标记块')
  const NS130S = {}
  new Function('ns', spanSlice + '\n' + sensBlk[0] + '\n' + searchBlk130[0] + '\n' + '\nns.searchExcerpt=searchExcerpt; ns.searchMatchFields=searchMatchFields;')(NS130S)
  await t('S2 面三·eval：searchMatchFields 正文命中跳 span + searchExcerpt 取窗零机密 + 语义 chunk 整块在 span 内回落良性段', () => {
    const n = { body: '良性锚词正文开头\n\n' + FENCE + '\nSPANKEY99\n```\n\n良性收尾' }
    assert.deepStrictEqual(NS130S.searchMatchFields(n, '良性锚词'), ['body'], '良性正文照常命中 body 档')
    assert.deepStrictEqual(NS130S.searchMatchFields(n, 'spankey99'), [], 'span 内词永不命中（大小写归一后仍跳过）')
    assert.deepStrictEqual(NS130S.searchMatchFields({ title: '标题命中甲', body: FENCE + '\nSPANKEY99\n```' }, '标题命中'), ['title'], '标题命中照常')
    const ex = NS130S.searchExcerpt(n, '良性锚词')
    assert(ex.text.indexOf('SPANKEY99') < 0 && ex.text.indexOf('良性锚词') >= 0, '正文命中摘要窗口零机密')
    // 正文以 span 开头 + 仅标题命中 → 摘要 = 打码体开头（占位行，非机密）
    const n2 = { body: FENCE + '\nSPANKEY99\n```\n\n打码体后良性段' }
    const ex2 = NS130S.searchExcerpt(n2, '幽灵查询词')
    assert(ex2.marks.length === 0 && ex2.text.indexOf('SPANKEY99') < 0 && ex2.text.indexOf('🔒 机密区（3 行，note_get reveal 获取）') >= 0, '标题命中补足摘要走打码体开头（绕行不泄漏）')
    // 语义胜出 chunk：剥除派生内的良性块照常；span 内 chunk（旧索引残留）→ 退回正文开头良性段
    const ex3 = NS130S.searchExcerpt(n, '幽灵词', 'SPANKEY99')
    assert(ex3.text.indexOf('SPANKEY99') < 0 && ex3.text.indexOf('良性锚词') >= 0, 'span 内 chunk 退回正文开头良性段（零机密兜底）')
    const ex4 = NS130S.searchExcerpt(n, '幽灵词', '良性收尾')
    assert(ex4.text.indexOf('良性收尾') >= 0, '剥除派生内良性 chunk 照常作语义摘要')
  })
  await t('S2 面三·host：notes-search 良性词命中（matches 含 body + 摘要零机密）+ span 内词零召回', async () => {
    const inst = mk130()
    await inst.handlers['notes-create']({ title: 'S2 检索良行', body: '检索锚词在良性段\n\n' + FENCE + '\nSPANKEY99\n```' })
    const rHit = await inst.handlers['notes-search']({ query: '检索锚词' })
    assert.strictEqual(rHit.notes.length, 1, '良性词照常召回')
    const hit = rHit.notes[0]
    assert(hit.matches && hit.matches.indexOf('body') >= 0, 'matches 含 body 档（良性正文照常）')
    assert(hit.excerpt && hit.excerpt.text.indexOf('SPANKEY99') < 0 && hit.excerpt.text.indexOf('检索锚词') >= 0, '摘要行零机密')
    assert(!('body' in hit), 'slim 不含 body（既有契约）')
    const rMiss = await inst.handlers['notes-search']({ query: 'SPANKEY99' })
    assert.strictEqual(rMiss.notes.length, 0, 'span 内词零召回（hay 走打码体）')
    const rMiss2 = await inst.handlers['notes-search']({ query: 'spankey99' })
    assert.strictEqual(rMiss2.notes.length, 0, '大小写归一后 span 内词仍零召回')
  })

  // ===== 130.5 面四：向量切块剥 span（fake embedder 计数断言 + 新鲜度锚对齐剥除派生 + span-only 零块）=====
  await t('S2 面四：含 span 笔记良性部分向量照常——块数与剥除派生一致 + 同良性对照同 hash + span-only 零块不进索引', async () => {
    const inst = mk130()
    await inst.handlers['notes-settings-set']({ semantic: { enabled: true } })   // 缺省后端 fake-256（host 确定性假 embedder）
    // 对照正文 = 含机密笔记剥除后的精确形态（B + 双换行）：剥除派生一致性 → 两笔记 hash 必须相等
    const benignCtl = '向量良性行甲乙丙丁'.repeat(20) + '\n\n'
    await inst.handlers['notes-create']({ title: 'S2 向量良性对照', body: benignCtl })
    await inst.handlers['notes-create']({ title: 'S2 向量含机密', body: benignCtl + FENCE + '\nVECSECRET99\n```' })
    await inst.handlers['notes-create']({ title: 'S2 向量纯机密', body: FENCE + '\nVECONLY99\n```' })
    await inst.handlers['notes-vectors-rebuild']({})
    let st = null
    for (let i = 0; i < 200; i++) { st = await inst.handlers['notes-vectors-status']({}); if (st && st.building !== true) break; await new Promise(r => setTimeout(r, 10)) }
    assert(st && st.building === false && st.indexed >= 2, '后台重建完成（indexed=' + (st && st.indexed) + '，含机密笔记的良性部分照常入索引）')
    const lines = String(inst.store.get(NOTES_DIR + '\\vectors.jsonl') || '').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const byTitle = async (title) => { const all = await inst.handlers['notes-list']({}); return all.notes.find(n => n.title === title) }
    const nCtl = await byTitle('S2 向量良性对照'), nSpan = await byTitle('S2 向量含机密'), nOnly = await byTitle('S2 向量纯机密')
    const rowsCtl = lines.filter(r => r.noteId === nCtl.id), rowsSpan = lines.filter(r => r.noteId === nSpan.id), rowsOnly = lines.filter(r => r.noteId === nOnly.id)
    assert(rowsCtl.length >= 1 && rowsSpan.length === rowsCtl.length, '含 span 笔记块数 = 剥除派生块数（良性部分照常，span 不进 embed 队列）')
    assert(rowsOnly.length === 0, 'span-only 正文剥除后零块不进索引（zero chunks）')
    assert.strictEqual(rowsSpan[0] && rowsSpan[0].bodyHash, rowsCtl[0] && rowsCtl[0].bodyHash, '新鲜度锚 = 剥除后文本（span-only 差异不入锚——两笔记同良性即同 hash）')
    assert(lines.every(r => String(r.bodyHash || '').length > 0), '边车行带 bodyHash（剥除派生口径）')
    // 红线：_vectorIndexable 篇级 sensitive 排除规则不动（sensitive 笔记零行）
    await inst.handlers['notes-create']({ title: 'S2 向量敏感篇', body: '敏感篇良性正文', sensitive: true })
    await new Promise(r => setTimeout(r, 2600))
    const lines2 = String(inst.store.get(NOTES_DIR + '\\vectors.jsonl') || '').split('\n').filter(Boolean).map(l => JSON.parse(l))
    const nSens = await byTitle('S2 向量敏感篇')
    assert(lines2.filter(r => r.noteId === nSens.id).length === 0, 'sensitive 篇级排除红线不动（sensitive=true 永不进索引）')
  })

  // ===== 130.6 面五：AI 整理/分类送 LLM 前剥除（三处消费 + 省略行 + 零 span 逐字节原样）=====
  await t('S2 面五：organize 入口剥除（prompt 零 span 明文 + 省略行）+ 零 span prompt 逐字节原样 + classify 两调用面剥除', async () => {
    const prompts130 = []
    const llmCapture = {
      stream: async function* (req) {
        const msg = req && req.messages && req.messages[0]
        prompts130.push({ system: (req && req.system) || '', text: msg && msg.content && msg.content[0] && msg.content[0].text || '' })
        if ((req && req.system || '').indexOf('元数据') >= 0) {
          // T3 指令提取：titleHint 留空 → 走 classifyTopic 回填分支（L449 指令式速记分类调用面）
          yield { type: 'text-delta', text: '{"tags":["记录"],"titleHint":"","kind":"note","inject":false,"injectRole":"convention"}' }
        } else {
          yield { type: 'text-delta', text: '开发' }
        }
        yield { type: 'finish' }
      },
      listProviders: () => [{ id: 'p', name: 'MockProvider' }],
      listModels: async () => [{ provider: 'p', id: 'm', name: 'MockModel' }],
    }
    const inst = mk130(llmCapture)
    // ① organize：span 正文剥除 + 省略行；零 span 正文 prompt 逐字节原样（节 84 契约）
    prompts130.length = 0
    const rOrg = await inst.handlers['notes-ai-organize']({ body: '整理良段开始\n\n' + FENCE + '\nORGSECRET99\n```\n\n整理良段收尾', kind: 'note' })
    assert(rOrg.ok === true, 'organize ok 路径（实得 ' + JSON.stringify(rOrg).slice(0, 120) + '）')
    const pOrg = prompts130[prompts130.length - 1].text
    assert(pOrg.indexOf('ORGSECRET99') < 0, 'organize prompt 零 span 明文')
    assert(pOrg.indexOf('[已省略 1 处机密区]') >= 0 && pOrg.indexOf('整理良段开始') >= 0, 'organize prompt 含省略告知行 + 良性段原样')
    prompts130.length = 0
    await inst.handlers['notes-ai-organize']({ body: '方案对比草稿：A 便宜 B 快', kind: 'note', title: '选型' })
    const pPlain = prompts130[prompts130.length - 1].text
    assert(pPlain.indexOf('【当前草稿】\n方案对比草稿：A 便宜 B 快\n\n只输出重写后的 Markdown 正文：') >= 0, '零 span prompt 逐字节原样（节 84 锚不破）')
    // ② classify 调用面之一（notes-quick 速记）：异步分类 prompt 剥除
    prompts130.length = 0
    await inst.handlers['notes-quick']({ text: '速记良行\n\n' + FENCE + '\nQUICKSECRET99\n```', sessionId: 'sess-130-quick-1' })
    let pQuick = null
    for (let i = 0; i < 100; i++) { pQuick = prompts130.find(p => p.system.indexOf('主题分类器') >= 0); if (pQuick) break; await new Promise(r => setTimeout(r, 10)) }
    assert(pQuick, '速记分类 prompt 已捕获（异步管线）')
    assert(pQuick.text.indexOf('QUICKSECRET99') < 0, 'classify prompt 零 span 明文')
    assert(pQuick.text.indexOf('[已省略 1 处机密区]') >= 0 && pQuick.text.indexOf('速记良行') >= 0, 'classify prompt 含省略行 + 良性原样')
    // ③ classify 调用面之二（notes-quick-instruct 指令式速记，无 titleHint 分支）
    prompts130.length = 0
    await inst.handlers['notes-quick-instruct']({ text: '指令速记良行\n\n' + FENCE + '\nINSTRSECRET99\n```', note: '记一下', sessionId: 'sess-130-quick-2' })
    let pInstr = null
    for (let i = 0; i < 100; i++) { pInstr = prompts130.filter(p => p.system.indexOf('主题分类器') >= 0).pop(); if (pInstr) break; await new Promise(r => setTimeout(r, 10)) }
    assert(pInstr, '指令式速记分类 prompt 已捕获')
    assert(pInstr.text.indexOf('INSTRSECRET99') < 0 && pInstr.text.indexOf('[已省略 1 处机密区]') >= 0, '指令式速记 classify 剥除 + 省略行')
  })

  // ===== 130.7 面六：导出打码（缺省占位 + maskedSpans + includeSecret 明文开关 + .history 同打码 + 备份恒明文）=====
  await t('S2 面六：导出快照缺省 span 同形态占位 + 开关开才明文 + span-free 逐字节 + .history 同打码 + 导入备份恒明文', async () => {
    const inst = mk130()
    const c1 = await inst.handlers['notes-create']({ title: 'S2 导出机密', body: '导出良行\n\n' + FENCE + '\nEXPSECRET99\n```' })
    const c2 = await inst.handlers['notes-create']({ title: 'S2 导出普通', body: '普通导出正文' })
    // 造含 span 的历史快照：v1 含 span → update 到 v2（恢复前置快照把 v1 入 .history）
    const c3 = await inst.handlers['notes-create']({ title: 'S2 导出带历史', body: FENCE + '\nHISTSECRET99\n```' })
    await inst.handlers['notes-update']({ id: c3.id, body: '第二版正文' })
    // ① 缺省导出：占位 + maskedSpans 计数 + span-free 逐字节
    const r1 = await inst.handlers['notes-export']({ dir: 'D:\\exp-s2' })
    assert(!r1.error && r1.exported >= 3, '导出成功（实得 ' + JSON.stringify(r1).slice(0, 160) + '）')
    assert.strictEqual(r1.maskedSpans, 1, 'maskedSpans = 1（正文文件计 1 处 span——机密笔记；带历史笔记当前版无 span，其 span 只在历史快照）')
    const f1 = inst.store.get(r1.target + '\\' + c1.id + '.md')
    assert(f1.indexOf('EXPSECRET99') < 0 && f1.indexOf('🔒 机密区（3 行，note_get reveal 获取）') >= 0, '缺省导出 .md 同形态占位（front-matter 前缀保留）')
    assert(f1.indexOf('---\nid: ' + c1.id) === 0, 'front-matter 原样（打码只落正文 span）')
    assert.strictEqual(inst.store.get(r1.target + '\\' + c2.id + '.md'), inst.store.get(NOTES_DIR + '\\' + c2.id + '.md'), 'span-free 笔记逐字节一致')
    // ② includeSecret=true 明文导出（显式开关，缺省关不反向）
    const r2 = await inst.handlers['notes-export']({ dir: 'D:\\exp-s2', includeSecret: true })
    assert.strictEqual(r2.maskedSpans, 0, '明文导出 maskedSpans=0')
    const f2 = inst.store.get(r2.target + '\\' + c1.id + '.md')
    assert(f2.indexOf('EXPSECRET99') >= 0, '开关开 → 明文导出')
    assert.strictEqual(f2, inst.store.get(NOTES_DIR + '\\' + c1.id + '.md'), '明文导出逐字节一致（既有导出行为原样）')
    // ③ includeHistory 缺省导出：.history 快照同形态占位
    const r3 = await inst.handlers['notes-export']({ dir: 'D:\\exp-s2', includeHistory: true })
    let histMasked = 0
    for (const k of inst.store.keys()) { if (k.indexOf(r3.target + '\\.history\\' + c3.id + '\\') === 0) { const c = inst.store.get(k); if (c.indexOf('HISTSECRET99') >= 0) { histMasked = -1; break } if (c.indexOf('🔒 机密区（3 行，note_get reveal 获取）') >= 0) histMasked++ } }
    assert(histMasked >= 1, '历史快照（含 span 的 v1）缺省导出同形态占位、零明文')
    // ④ 导入前备份恒明文（本地安全网语义）
    const r4 = await inst.handlers['notes-import']({ dir: r1.target })
    assert(!r4.error, '导入执行成功（实得 ' + JSON.stringify(r4).slice(0, 120) + '）')
    let bkPlain = false
    for (const k of inst.store.keys()) { if (k.indexOf('\\notes-backup-') >= 0 && k.endsWith('\\' + c1.id + '.md') && String(inst.store.get(k)).indexOf('EXPSECRET99') >= 0) bkPlain = true }
    assert(bkPlain, '导入前全量备份含明文（本地安全网，mask 只落导出快照）')
  })
  },
}
