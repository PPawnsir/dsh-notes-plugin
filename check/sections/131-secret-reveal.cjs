// 节 131. 文档安全 S3（notes-052-reveal-gate）：note_get reveal 门禁 + 审计留痕 + S2 遗留四面补漏
// 覆盖面（门禁主链 + 四面各一条行为级 + e2e mock 同步）：
//   ① 工具描述契约：reveal 参数写进描述（agent 才知道怎么走门禁）——描述明示「reveal 前必须 ask 用户」+
//      诚实标注「纪律门禁非密码学边界」（discipline gate, not a cryptographic boundary）；双包 + index.mjs 产物三面锚。
//   ② reveal 门禁（note_get 工具面）：reveal=false（缺省）→ S2 占位行为原样 + 返回体附 revealHint 引导行
//      （先用 ask_user_question 向用户说明用途征得同意，再带 reveal:true 重取）；reveal=true → span 明文返回；
//      审计留痕 = reveal:true 记一行进程日志（时间+笔记 id+会话 sid——谁在何时读了哪篇的机密；纯进程日志，
//      不进遥测不进笔记库，perf 慢请求钩同款形态）；reveal:false 零审计。无 span 笔记两态均原样（零回归）。
//   ③ 双层正交：sensitive=true 整篇原文仍走现状（note_get 直出——S2 红线），reveal 只管 span 面；
//      双标记笔记 reveal=true 时 span 明文 + 敏感行照现行直出（两层独立正交，既有 sensitive 断言不破）。
//   ④ 面七 dispatch 派发载荷：待办正文随派发消息直达目标会话（agent 侧最重明文出口）——与注入同款占位+计数打码，
//      机密永不裸奔；零 span 逐字节原样（15/48/91 节既有断言不破）。桩录制 = liveAgent.send 正文断言。
//   ⑤ 面八 notes-export-single：与导出全量同款纪律——缺省 span 占位 + maskedSpans 计数 + includeSecret 显式开关
//      （复用 S2 导出开关语义，不新造第二套）。
//   ⑥ 面九 conflict-check 体检 prompt：送 LLM 前剥 span（S2 只打了篇级行级码，span 面漏）——剥除+省略行；
//      篇级行级打码面照现行并存（span 剥除先于行级——S2 优先级纪律）。桩录制 = llm.stream prompt 断言。
//   ⑦ 面十 extractInstruction 选区原文：选区送 LLM 前剥 span（选区跨机密块截取的部分本来就可能截一半——剥除语义更干净）；
//      落盘正文仍是选区原文（机密块原样入库，绝不改写原文红线不动）。
//   ⑧ e2e mock 同步：server.cjs notes-export-single 契约对账用例在册（maskedSpans 键集 + includeSecret 透传）。
// 同源红线：四面补漏全部消费 parseSecretSpans/stripSecretSpans 派生助手族（sensitive-helpers），零私有正则（节 130.0 锚看守）。
module.exports = {
  id: "131",
  title: "131. 文档安全 S3：note_get reveal 门禁 + 审计留痕 + 四面补漏（notes-052-reveal-gate）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { llmMock, admMock, agentsMock, sessionPersistenceMock, workspaceRegistryMock, sessionTitleMock, sessionQueryMock, NOTES_DIR, sentMessages } = S
  section('131. 文档安全 S3：note_get reveal 门禁 + 审计留痕 + 四面补漏（notes-052-reveal-gate）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const FENCE = '```secret'
  // 独立实例工厂（27.5/130 节同款隔离模式：fresh store/handlers/tools，零污染共享 S；llmOverride 可注入捕获 prompt 的 llm mock）
  function mk131(llmOverride) {
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
  const REVEAL_HINT = '本篇含 N 处机密区。若任务确需原文（如改密码），请先用 ask_user_question 工具向用户说明用途并征得同意，然后带 reveal:true 重新调用 note_get'

  // ===== 131.1 工具描述契约：reveal 参数 + 「先 ask」指令 + 诚实边界（双包 + 产物三面静态锚）=====
  await t('S3 工具描述：note_get reveal 参数契约 + 「先 ask」指令 + 纪律门禁非密码学边界诚实标注（双包 + 产物）', () => {
    for (const [label, src] of [['src/host/index.js', read('src/host/index.js')], ['src/host/index.dist.js', read('src/host/index.dist.js')], ['index.mjs（需先跑 build-dist）', indexSrc]]) {
      assert(src.indexOf('reveal: true') >= 0, label + ' 描述含 reveal: true 契约')
      assert(src.indexOf('ask_user_question') >= 0, label + ' 描述含「先 ask 用户」指令（ask_user_question）')
      assert(src.indexOf('discipline gate, not a cryptographic boundary') >= 0, label + ' 诚实标注：纪律门禁非密码学边界')
      assert(src.indexOf("reveal: { type: 'boolean'") >= 0, label + ' reveal 参数入 schema（boolean）')
      assert(src.indexOf('revealHint') >= 0, label + ' 描述提及 revealHint 引导行')
      assert(src.indexOf('本篇含 ') >= 0, label + ' revealHint 引导文案在源（缺省响应附）')
    }
    // 描述与参数分工（agent-experience 纪律）：描述 = 行为 + 解锁路径 + 审计；参数 = 何时可置 true + 先 ask 硬规则
    const dev = read('src/host/index.js')
    const desc = dev.match(/name: 'note_get',[\s\S]*?parameters:/)[0]
    assert(desc.indexOf('Secret spans (机密区) are masked by default') >= 0, '描述先讲缺省打码行为（行为描述优先）')
    const revealParam = dev.match(/reveal: \{ type: 'boolean', description: '[\s\S]*?' \}/)[0]
    assert(revealParam.indexOf('MUST obtain') >= 0 && revealParam.indexOf('ask_user_question') >= 0, 'reveal 参数描述承载「先 ask」硬规则')
  })

  // ===== 131.2 reveal 门禁行为级：缺省占位+引导行 / reveal:true 明文+审计 / reveal:false 零审计 / 无 span 原样 =====
  await t('S3 reveal 门禁：note_get 缺省占位 + 引导行（ask_user_question 先征同意）+ reveal:true 明文 + 审计进程日志 + 无 span 原样', async () => {
    const inst = mk131()
    const spanBody = '开头良行131\n\n' + FENCE + '\nREVEALSEC99\n机密第二行\n```\n\n结尾良行131'
    const c1 = await inst.handlers['notes-create']({ title: 'S3 取回机密', body: spanBody })
    const c2 = await inst.handlers['notes-create']({ title: 'S3 取回普通', body: '普通正文131全量' })
    const noteGet = inst.tools.find(x => x.name === 'note_get')
    assert(noteGet && typeof noteGet.execute === 'function', 'note_get 工具在册')
    // ① 缺省（reveal=false）：S2 占位行为原样 + 引导行
    const g1 = await noteGet.execute({ id: c1.id })
    assert(g1.note.body.indexOf('REVEALSEC99') < 0, '缺省零 span 明文（S2 占位行为原样）')
    assert(g1.note.body.indexOf('🔒 机密区（4 行，note_get reveal 获取）') >= 0, '占位同注入形态（4 行）')
    assert.strictEqual(g1.note.spanCount, 1, 'spanCount=1 照带（S2 契约不破）')
    assert.strictEqual(g1.note.revealHint, REVEAL_HINT.replace('N', '1'), 'revealHint 引导行原文（先 ask 征同意再 reveal:true）')
    assert(g1.note.revealHint.indexOf('ask_user_question') >= 0 && g1.note.revealHint.indexOf('reveal:true') >= 0, '引导行含 ask 工具名 + reveal:true 取回路径')
    // ② reveal=true：span 明文返回 + 审计一行（时间+笔记 id+会话 sid）；reveal=false 零审计
    const warnLines = []
    const origWarn = console.warn
    console.warn = function () { try { warnLines.push(Array.prototype.map.call(arguments, String).join(' ')) } catch (e) {} }
    let g2 = null
    try {
      await noteGet.execute({ id: c1.id })
      assert(!warnLines.some(l => l.indexOf('note_get reveal') >= 0), 'reveal=false（缺省）零审计行')
      g2 = await noteGet.execute({ id: c1.id, reveal: true })
    } finally { console.warn = origWarn }
    assert.strictEqual(g2.note.body, spanBody, 'reveal=true 正文逐字节明文（span 区间原样）')
    assert(!('spanCount' in g2.note) && !('revealHint' in g2.note), '明文态不带 spanCount/revealHint（干净出体）')
    const audit = warnLines.filter(l => l.indexOf('note_get reveal') >= 0)
    assert(audit.length === 1, 'reveal:true 恰一行审计（实得 ' + audit.length + '）')
    assert(audit[0].indexOf('[dsh-notes] note_get reveal 审计：') === 0, '审计行前缀（perf 慢请求钩同款形态）')
    assert(audit[0].indexOf('note=' + c1.id) >= 0, '审计行含笔记 id')
    assert(audit[0].indexOf('session=session-abc12345-0000-0000-0000-000000000000') >= 0, '审计行含会话 sid（谁在何时读了哪篇）')
    assert(audit[0].indexOf('spans=1') >= 0, '审计行含 span 计数')
    assert(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(audit[0]), '审计行含时间戳')
    // ③ 无 span 笔记：缺省原样 + reveal:true 同样原样（零回归）；reveal 缺省 false 不带新键
    const g3 = await noteGet.execute({ id: c2.id })
    assert.strictEqual(g3.note.body, '普通正文131全量', '无 span 缺省原样')
    assert(!('spanCount' in g3.note) && !('revealHint' in g3.note), '无 span 不带 spanCount/revealHint 键（向后兼容）')
    const warn2 = []
    console.warn = function () { try { warn2.push(Array.prototype.map.call(arguments, String).join(' ')) } catch (e) {} }
    let g4 = null
    try { g4 = await noteGet.execute({ id: c2.id, reveal: true }) } finally { console.warn = origWarn }
    assert.strictEqual(g4.note.body, '普通正文131全量', '无 span reveal:true 同样原样')
    const audit2 = warn2.filter(l => l.indexOf('note_get reveal') >= 0)
    assert(audit2.length === 1 && audit2[0].indexOf('spans=0') >= 0, 'reveal:true 对无 span 笔记也记审计（spans=0 可分辨）')
    // ④ 审计红线：纯进程日志——不进遥测不进笔记库（笔记文件原样、无审计面残留）
    const raw = String(inst.store.get(NOTES_DIR + '\\' + c1.id + '.md') || '')
    assert(raw.indexOf('开头良行131') >= 0 && raw.indexOf('REVEALSEC99') >= 0, '笔记 .md 原文不动（reveal 不改盘面）')
    assert(raw.indexOf('note_get reveal 审计') < 0, '审计行不落笔记文件（纯进程日志红线）')
  })

  // ===== 131.3 双层正交：sensitive=true 整篇直出现状不变，reveal 只管 span 面 =====
  await t('S3 双层正交：sensitive+span 双标记笔记 reveal=true 全明文 / 缺省 span 占位行照直出（篇级 sensitive 的 note_get 行为不变）', async () => {
    const inst = mk131()
    const dualBody = '密码: dualpw99\n\n' + FENCE + '\nDUALSEC99\n```'
    const c = await inst.handlers['notes-create']({ title: 'S3 双标记', body: dualBody, sensitive: true })
    const noteGet = inst.tools.find(x => x.name === 'note_get')
    // 缺省：span 占位 + 敏感行仍明文（note_get 是敏感篇明文取回通道——S2 现状语义不变，reveal 只管 span 面）
    const g1 = await noteGet.execute({ id: c.id })
    assert(g1.note.body.indexOf('DUALSEC99') < 0, '缺省 span 面占位')
    assert(g1.note.body.indexOf('密码: dualpw99') >= 0, '敏感行照现行直出（篇级 sensitive 的 note_get 行为不变——两层正交）')
    assert(g1.note.body.indexOf('🔒 机密区（3 行，note_get reveal 获取）') >= 0, 'span 占位形态在')
    // reveal=true：整篇明文（span 明文 + 敏感行明文，S2 红线：note_get 仍是敏感篇的明文取回通道）
    const warnD = []
    const origWarnD = console.warn
    console.warn = function () { try { warnD.push(Array.prototype.map.call(arguments, String).join(' ')) } catch (e) {} }
    let g2 = null
    try { g2 = await noteGet.execute({ id: c.id, reveal: true }) } finally { console.warn = origWarnD }
    assert.strictEqual(g2.note.body, dualBody, 'reveal=true 双标记笔记全明文（span + 敏感行两层独立正交）')
    assert(warnD.some(l => l.indexOf('note_get reveal 审计：') >= 0 && l.indexOf('note=' + c.id) >= 0 && l.indexOf('spans=1') >= 0), '双标记笔记 reveal 审计行照记（spans=1）')
  })

  // ===== 131.4 面七：dispatch 派发载荷零机密（占位 + 计数行；桩录制 liveAgent.send 正文）=====
  await t('S3 面七：dispatch 派发载荷零机密——占位 + 计数行（桩录制 send 正文）+ 零 span 逐字节原样', async () => {
    const inst = mk131()
    const spanBody = '派发良性行131\n\n' + FENCE + '\nDISPSEC99\n```'
    const c1 = await inst.handlers['notes-create']({ title: 'S3 派发机密待办', body: spanBody, kind: 'todo' })
    const c2 = await inst.handlers['notes-create']({ title: 'S3 派发普通待办', body: '普通待办正文131', kind: 'todo' })
    const before = sentMessages.length
    const r1 = await inst.handlers['notes-dispatch']({ id: c1.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话', instruction: '按待办处理' })
    assert(r1.ok === true && sentMessages.length === before + 1, '含机密待办派发成功（live 直发）')
    const p1 = sentMessages[sentMessages.length - 1].msg.content[0].text
    assert(p1.indexOf('DISPSEC99') < 0, '派发载荷零 span 明文（机密永不裸奔——四面里最重的出口）')
    assert(p1.indexOf('🔒 机密区（3 行，note_get reveal 获取）') >= 0, '派发载荷含占位行（与注入同款形态）')
    assert(p1.indexOf('其中 1 处机密区已脱敏，明文经 note_get reveal 获取') >= 0, '派发载荷含计数行（占位+计数纪律）')
    assert(p1.indexOf('派发良性行131') >= 0 && p1.indexOf('按待办处理') >= 0, '良性正文与指令照常随行')
    // 零 span：payload 逐字节原样（无计数行——既有派发断言不破）
    const r2 = await inst.handlers['notes-dispatch']({ id: c2.id, sessionId: 'session-abc12345-0000-0000-0000-000000000000', sessionName: '开发会话' })
    assert(r2.ok === true, '普通待办派发成功')
    const p2 = sentMessages[sentMessages.length - 1].msg.content[0].text
    assert(p2.indexOf('普通待办正文131') >= 0, '零 span 待办正文原样随行')
    assert(p2.indexOf('处机密区已脱敏') < 0, '零 span 派发零计数行（逐字节原样）')
    assert(p2.indexOf('**不要**修改笔记状态') >= 0, '派发尾行契约原样（15-5 节锚不破）')
  })

  // ===== 131.5 面八：单文件导出缺省占位 + maskedSpans + includeSecret 开关（S2 同款语义）=====
  await t('S3 面八：单文件导出缺省 span 占位 + maskedSpans 计数 + includeSecret 开关明文（S2 全量导出同款语义）', async () => {
    const inst = mk131()
    const c1 = await inst.handlers['notes-create']({ title: 'S3 单导机密', body: '单导良行131\n\n' + FENCE + '\nEXP1SEC99\n```' })
    await inst.handlers['notes-create']({ title: 'S3 单导普通', body: '单导普通正文131' })
    // ① 缺省：占位 + maskedSpans 计数（响应恒带）
    const r1 = await inst.handlers['notes-export-single']({ dir: 'D:\\exp-s3', scope: {} })
    assert(!r1.error && r1.exported >= 2, '单文件导出成功（实得 ' + JSON.stringify(r1).slice(0, 140) + '）')
    assert.strictEqual(r1.maskedSpans, 1, 'maskedSpans=1（缺省打码的机密区计数）')
    const doc1 = String(inst.store.get(r1.target) || '')
    assert(doc1.indexOf('EXP1SEC99') < 0, '缺省导出文档零 span 明文')
    assert(doc1.indexOf('🔒 机密区（3 行，note_get reveal 获取）') >= 0, '导出文档含占位行（与全量导出同形态）')
    assert(doc1.indexOf('单导良行131') >= 0 && doc1.indexOf('单导普通正文131') >= 0, '良性正文照常拼接')
    // ② includeSecret=true：明文导出（显式开关，缺省关不反向）
    const r2 = await inst.handlers['notes-export-single']({ dir: 'D:\\exp-s3', scope: {}, includeSecret: true })
    assert.strictEqual(r2.maskedSpans, 0, '明文导出 maskedSpans=0')
    assert(String(inst.store.get(r2.target) || '').indexOf('EXP1SEC99') >= 0, '开关开 → 明文导出')
    // ③ scope 过滤照常（零 span 正文逐字节原样由节 23.6 既有断言看守）
    const r3 = await inst.handlers['notes-export-single']({ dir: 'D:\\exp-s3', scope: { tag: '无匹配标签-s3' } })
    assert.strictEqual(r3.exported, 0, 'scope 过滤照常（空范围零笔记）')
  })

  // ===== 131.6 面九：conflict-check 体检 prompt 零 span（剥除 + 省略行 + 篇级行级打码并存）=====
  await t('S3 面九：conflict-check 体检 prompt 零 span 明文（剥除 + 省略行 + 篇级行级打码原样并存）', async () => {
    const prompts131 = []
    const llmCapture = {
      stream: async function* (req) {
        const msg = req && req.messages && req.messages[0]
        prompts131.push({ system: (req && req.system) || '', text: msg && msg.content && msg.content[0] && msg.content[0].text || '' })
        yield { type: 'text-delta', text: '[]' }
        yield { type: 'finish' }
      },
      listProviders: () => [{ id: 'p', name: 'MockProvider' }],
      listModels: async () => [{ provider: 'p', id: 'm', name: 'MockModel' }],
    }
    const inst = mk131(llmCapture)
    await inst.handlers['notes-create']({ title: 'S3 体检机密约定', body: '体检良性行131\n\n' + FENCE + '\nCFSPAN99\n```', inject: true, topic: '约定' })
    await inst.handlers['notes-create']({ title: 'S3 体检双标记约定', body: '密码: cfpw99\n\n' + FENCE + '\nCFSPAN2\n```', inject: true, sensitive: true, topic: '约定' })
    const r = await inst.handlers['notes-conflict-check']({})
    assert(r && r.ok === true && r.total === 2, '体检 ok（total=2，实得 ' + JSON.stringify(r).slice(0, 100) + '）')
    const prompt = prompts131[prompts131.length - 1].text
    assert(prompt.indexOf('CFSPAN99') < 0 && prompt.indexOf('CFSPAN2') < 0, '体检 prompt 零 span 明文（四面补漏之三）')
    assert(prompt.indexOf('[已省略 1 处机密区]') >= 0, '剥除后带省略告知行（stripSecretSpansForLlm 同源消费）')
    assert(prompt.indexOf('体检良性行131') >= 0, '良性正文照常参与')
    assert(prompt.indexOf('cfpw99') < 0 && prompt.indexOf('******（敏感，note_get ') >= 0, '篇级行级打码面照现行并存（span 剥除先于行级打码）')
  })

  // ===== 131.7 面十：extractInstruction 选区送 LLM 剥 span + 落盘原文不改写 =====
  await t('S3 面十：extractInstruction 选区原文送 LLM 剥 span + 省略行 + 落盘原文不改写（机密块原样入库）', async () => {
    const prompts131 = []
    const llmCapture = {
      stream: async function* (req) {
        const msg = req && req.messages && req.messages[0]
        prompts131.push({ system: (req && req.system) || '', text: msg && msg.content && msg.content[0] && msg.content[0].text || '' })
        if (((req && req.system) || '').indexOf('元数据') >= 0) {
          yield { type: 'text-delta', text: '{"tags":["记录"],"titleHint":"机密选区速记","kind":"note","inject":false,"injectRole":"convention"}' }
        } else {
          yield { type: 'text-delta', text: '开发' }
        }
        yield { type: 'finish' }
      },
      listProviders: () => [{ id: 'p', name: 'MockProvider' }],
      listModels: async () => [{ provider: 'p', id: 'm', name: 'MockModel' }],
    }
    const inst = mk131(llmCapture)
    const selBody = '选区良性行131\n\n' + FENCE + '\nEXSEC99\n```'
    const r = await inst.handlers['notes-quick-instruct']({ text: selBody, note: '记一下', sessionId: 'sess-131-extract-1' })
    assert(r && r.ok === true && r.id, '指令式速记成功（实得 ' + JSON.stringify(r).slice(0, 100) + '）')
    const p = prompts131.find(pp => pp.system.indexOf('元数据') >= 0)
    assert(p, '选区提取 prompt 已捕获')
    assert(p.text.indexOf('EXSEC99') < 0, '提取 prompt 零 span 明文（四面补漏之四）')
    assert(p.text.indexOf('[已省略 1 处机密区]') >= 0, '剥除后带省略告知行')
    assert(p.text.indexOf('选区良性行131') >= 0 && p.text.indexOf('记一下') >= 0, '良性选区与备注照常参与')
    // 落盘原文不改写：机密块原样入库（T3 关键约束不动——剥除只发生在送 LLM 的 prompt 视图）
    const stored = await inst.handlers['notes-get']({ id: r.id })
    assert(stored.note.body.indexOf('EXSEC99') >= 0 && stored.note.body.indexOf('选区良性行131') >= 0, '落盘正文含机密块原文（绝不改写原文红线）')
  })

  // ===== 131.8 e2e mock 同步：notes-export-single 契约用例在册 + 113 豁免摘除 =====
  await t('S3 e2e mock 同步：notes-export-single 契约对账用例在册（maskedSpans 键 + includeSecret 透传）+ 113 豁免摘除', () => {
    const mockSrc = fsNative.readFileSync(path.join(DIR, 'scripts', 'e2e', 'server.cjs'), 'utf8')
    assert(mockSrc.indexOf("case 'notes-export-single':") >= 0, 'e2e mock 含 notes-export-single 用例桩')
    const blk = mockSrc.match(/case 'notes-export-single': \{[\s\S]*?\n    \}/)
    assert(blk && blk[0].indexOf('maskedSpans') >= 0, 'mock 响应含 maskedSpans 键（键集契约面）')
    assert(blk && blk[0].indexOf('notes-export-single 需要 dir') >= 0, 'mock 空 dir 错误形态同 host')
    const sec113 = fsNative.readFileSync(path.join(DIR, 'check', 'sections', '113-mock-contract.cjs'), 'utf8')
    assert(sec113.indexOf("['notes-export-single'") < 0, '节 113 注册豁免已摘除（mock 已实现即转入对账面）')
    // client 单导弹窗开关（与全量导出同款纪律：缺省关不反向）
    const cs = read('src/client/modals/export-single.js')
    assert(cs.indexOf('includeSecret: true') >= 0 && cs.indexOf('包含机密明文（缺省打码机密区）') >= 0, 'client 单导弹窗「包含机密明文」开关在册')
    assert(cs.indexOf('res.maskedSpans') >= 0, 'client toast 读 maskedSpans 计数')
  })
  },
}
