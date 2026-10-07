// 节 90. 0.4.5-G 约定体检（约定冲突/冗余检测，notes-045-conflict-check）
// 契约：host 新 RPC notes-conflict-check（llm/conflict.js + conflict.dist.js 双变体，llm.stream + resolveLlmSelection + 120s 超时通道（0.4.7-A⑨：8s→120s，手动重操作对齐客户端 LLM 护栏））：
//   数据集 = inject=true && injectRole=convention（缺省同 convention） && !deleted && status!=='superseded'（0.4.7-A③：已废止不参与）的笔记（标题+正文；敏感正文 maskSensitiveBody 按行打码后参与）；
//   <2 条 → { ok:true, pairs:[] } 零 LLM 调用；LLM 不可用/未配置/超时/输出非合法 JSON（剥围栏后 parse 失败或非数组）→ { error }；
//   输出 [{aId,bId,relation:conflict|supersede,reason}] 逐条校验（幻觉 id/自配对/非法 relation 静默过滤 + 同一无序对去重）+ 回附 aTitle/bTitle。
//   红线：只提名不执行（本通道零写入；「标已取代」由 client 走既有 notes-update status='superseded'，人工点击触发）；手动触发 v0 不进 cron；
//   计量：低频手动治理功能沿用 when-suggest 豁免先例——USAGE_FEATURES 三功能口径不动（conflict.js 注释注明暂不计量，不走 streamMetered）。
//   UI 三端：注入管理面板「约定体检」内联展开区（modal 不叠 modal）+ 动作三键（标 A/标 B 已取代 + 保留两者=会话内 dismiss）+ i18n 双语 + 原型 mock 演示。
module.exports = {
  id: "90",
  title: "90. 0.4.5-G 约定体检（LLM 冲突/取代检测 + 人工裁决内联区，notes-045-conflict-check）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc, indexSrc } = H
  const { NOTES_DIR, admMock, agentsMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('90. 0.4.5-G 约定体检（LLM 冲突/取代检测 + 人工裁决内联区）')

  // ---- 90.1 host 静态契约：双变体文件 + 双 manifest 登记序位 + server 双变体标记块逐字节一致 + 双产物注册锚 + 计量豁免锁定 ----
  await t('host 静态：llm/conflict.js + conflict.dist.js 双变体（差异=同步注释行）+ 双 manifest 紧随 organize 登记 + server 标记块双变体逐字节一致', () => {
    const read90 = (rel) => fsNative.readFileSync(path.join(DIR, 'src', 'host', rel), 'utf8')
    const dev = read90('llm' + path.sep + 'conflict.js'), dist = read90('llm' + path.sep + 'conflict.dist.js')
    assert(dev.indexOf('async function _conflictCheck(args)') >= 0, 'conflict.js 含 _conflictCheck')
    assert(dist.indexOf('async function _conflictCheck(args)') >= 0, 'conflict.dist.js 含 _conflictCheck')
    assert(dist.length > dev.length && dist.indexOf('（与开发版 host-impl.js 双边同步，逻辑逐行一致）') >= 0 && dev.indexOf('双边同步') < 0, 'dist 变体差异 = 同步注释行（organize 先例）')
    const { parseManifest, MANIFEST_DEV_PATH, MANIFEST_DIST_PATH } = require(path.join(DIR, 'scripts', 'concat-host.cjs'))
    const devList = parseManifest(fsNative.readFileSync(MANIFEST_DEV_PATH, 'utf8'))
    const distList = parseManifest(fsNative.readFileSync(MANIFEST_DIST_PATH, 'utf8'))
    assert(devList.indexOf('llm/conflict.js') === devList.indexOf('llm/organize.js') + 1, 'manifest.dev.js：llm/conflict.js 紧随 llm/organize.js（消费 _list/resolveLlmSelection/maskSensitiveBody 序位均在前）')
    assert(distList.indexOf('llm/conflict.dist.js') === distList.indexOf('llm/organize.dist.js') + 1, 'manifest.dist.js：llm/conflict.dist.js 紧随 llm/organize.dist.js')
    const grabC = (s, tag) => { const m = s.match(/\/\/ ==== conflict-check BEGIN ====[\s\S]*?\/\/ ==== conflict-check END ====/); assert(m, tag + ' 缺 conflict-check 标记块'); return m[0] }
    assert.strictEqual(grabC(read90('server.js'), 'server.js'), grabC(read90('server.dist.js'), 'server.dist.js'), 'conflict-check 注册块 server 双变体逐字节一致（when-suggest 同看守口径）')
    assert(devList.indexOf('llm/conflict.js') < devList.indexOf('server.js') && distList.indexOf('llm/conflict.dist.js') < distList.indexOf('server.dist.js'), 'conflict 序位先于 server（_conflictCheck → notes-conflict-check 注册可见序）')
  })
  await t('host 双产物：notes-conflict-check 注册 + 120s 超时/打码/谓词/容错锚 + 计量豁免锁定（USAGE_FEATURES 三功能口径不动）', () => {
    for (const pair of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      const s = pair[0], tag = pair[1]
      assert(s.indexOf("handle('notes-conflict-check'") >= 0, tag + ' notes-conflict-check RPC 注册')
      assert(s.indexOf('const CONFLICT_CHECK_TIMEOUT_MS = 120000') >= 0, tag + ' 120s 超时锚（0.4.7-A⑨：8s→120s 手动重操作，对齐客户端 LLM 护栏 HOSTCALL/RPC_LLM_METHODS 120s）')
      assert(s.indexOf("reject(new Error('体检超时（120s）'))") >= 0, tag + ' 超时错误文案锚（0.4.7-A⑨）')
      assert(s.indexOf('maskSensitiveBody(rawBody, n.id)') >= 0, tag + ' 敏感正文打码后参与锚')
      assert(s.indexOf("n.inject === true && !n.deleted && n.status !== 'superseded' && (n.injectRole || 'convention') === 'convention'") >= 0, tag + ' 数据集谓词锚（仅约定桶/排除已删/排除已废止——0.4.7-A③ superseded 不参与冲突检测）')
      assert(s.indexOf('_list(undefined, undefined, undefined, false, true, true)') >= 0, tag + ' 全量列表六参锚（谓词即唯一选择口径）')
      assert(s.indexOf('LLM 输出非合法 JSON') >= 0 && s.indexOf('LLM 输出非 JSON 数组') >= 0, tag + ' JSON 容错双 error 锚')
      assert(s.indexOf('conv.length < 2') >= 0, tag + ' <2 条空态锚')
    }
    // 计量豁免锁定：USAGE_FEATURES 仍是三功能（conflict 不进计量；conflict.js 不走 streamMetered 且注释注明）
    assert(hostSrc.indexOf("const USAGE_FEATURES = ['classify', 'organize', 'summarize']") >= 0, 'USAGE_FEATURES 三功能口径不动（开发版）')
    assert(indexSrc.indexOf("const USAGE_FEATURES = ['classify', 'organize', 'summarize']") >= 0, 'USAGE_FEATURES 三功能口径不动（发布包）')
    const devConflict = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'llm', 'conflict.js'), 'utf8')
    assert(devConflict.indexOf('暂不计量') >= 0 && devConflict.indexOf("streamMetered('conflict'") < 0, 'conflict.js 注释注明暂不计量且不走 streamMetered 计量包装')
  })

  // ---- 90.2 行为级：隔离实例（捕获 prompt 的 llm mock）——数据集谓词 + 敏感打码 + 输出校验 ----
  const mkInstance = (opts) => {
    const storeC = new Map()
    const fsMockC = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeC.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of storeC.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!storeC.has(p)) throw new Error('ENOENT: ' + p); return storeC.get(p) },
      writeText: async (p, c) => { storeC.set(p, c) },
    }
    const streamCalls = []
    const llmMockC = opts.noLlm ? null : {
      stream: async function* (req) {
        streamCalls.push(req)
        yield { type: 'text-delta', text: opts.out() }
        yield { type: 'finish' }
      },
      listProviders: () => [], listModels: async () => [],
    }
    const admC = opts.admNull ? { currentSelection: () => null } : admMock
    const handlersC = {}
    const harnessMockC = { handle: (n, fn) => { handlersC[n] = fn; return () => { delete handlersC[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    new Function('harness', 'pluginDir', hostSrc)(harnessMockC, DIR).apply({
      fs: fsMockC, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMockC, agentDefaultModel: admC, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return { handlers: handlersC, streamCalls: streamCalls }
  }

  await t('行为①数据集谓词：仅注入中约定入 prompt（排除资料/未注入/已删）+ 敏感正文打码参与 + total 口径', async () => {
    const inst = mkInstance({ out: () => '[]' })
    const H90 = inst.handlers
    const cA = await H90['notes-create']({ title: '体检约定甲90', body: '甲：日志默认隐身不参与检索', inject: true, topic: '约定' })
    const cB = await H90['notes-create']({ title: '体检约定乙90', body: '乙：日志同权可见可搜', inject: true, injectRole: 'convention', topic: '约定' })
    const cS = await H90['notes-create']({ title: '体检敏感约定90', body: 'password: sec-live-90ab\n普通指令行', inject: true, sensitive: true, topic: '约定' })
    const cR = await H90['notes-create']({ title: '体检资料90', body: '资料正文 REF90-BODY', inject: true, injectRole: 'reference', topic: '资料' })
    const cO = await H90['notes-create']({ title: '体检未注入90', body: '未注入正文 OFF90-BODY', topic: '其他' })
    const cD = await H90['notes-create']({ title: '体检已删约定90', body: '已删正文 DEL90-BODY', inject: true, topic: '约定' })
    await H90['notes-delete']({ id: cD.id })
    // 0.4.7-A③（notes-047-cleanup）：已废止约定不参与冲突检测——superseded 注入中约定同样排除（total/双边 prompt 双口径）
    const cX = await H90['notes-create']({ title: '体检已废止约定90', body: '已废止正文 SUP90-BODY', inject: true, status: 'superseded', topic: '约定' })
    const r = await H90['notes-conflict-check']({})
    assert(r && r.ok === true && Array.isArray(r.pairs), 'ok 路径返回 pairs 数组（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.total, 3, 'total=3（甲/乙/敏感约定；资料/未注入/已删/已废止不计入），实得 ' + r.total)
    assert.strictEqual(inst.streamCalls.length, 1, 'LLM 恰调用一次')
    const req = inst.streamCalls[0]
    const prompt = req.messages[0].content[0].text
    assert(prompt.indexOf('下面是 3 条正在注入') >= 0, 'prompt 数据集计数行 = 3 条约定')
    for (const n of [cA, cB, cS]) assert(prompt.indexOf('id=' + n.id) >= 0 && prompt.indexOf(n.title) >= 0, 'prompt 含约定 ' + n.title + '（id+标题）')
    for (const n of [cR, cO, cD, cX]) assert(prompt.indexOf(n.id) < 0 && prompt.indexOf(n.title) < 0, 'prompt 排除 ' + n.title)
    assert(prompt.indexOf('REF90-BODY') < 0 && prompt.indexOf('OFF90-BODY') < 0 && prompt.indexOf('DEL90-BODY') < 0, 'prompt 排除资料/未注入/已删正文')
    assert(prompt.indexOf('SUP90-BODY') < 0, 'prompt 排除已废止约定正文（0.4.7-A③：superseded 不参与冲突检测）')
    assert(prompt.indexOf('sec-live-90ab') < 0, '敏感约定正文打码后才进 prompt（口令值零泄露）')
    assert(prompt.indexOf('******（敏感，note_get ' + cS.id + ' 获取）') >= 0, '敏感行落占位符（键保留值遮蔽，引导 note_get）')
    assert(prompt.indexOf('普通指令行') >= 0, '敏感约定非敏感行照常参与')
    assert(String(req.system || '').indexOf('约定治理') >= 0, 'system 提示词 = 约定治理助手')
    assert(req.temperature === 0, 'temperature 0（同款通道）')
    await H90['notes-delete']({ id: cA.id }); await H90['notes-delete']({ id: cB.id }); await H90['notes-delete']({ id: cS.id }); await H90['notes-delete']({ id: cR.id }); await H90['notes-delete']({ id: cO.id }); await H90['notes-delete']({ id: cX.id })
  })
  await t('行为②输出校验：围栏剥离 + 幻觉 id/自配对/非法 relation/重复对逐条过滤 + 回附标题 + relation 白名单', async () => {
    let outText = ''
    const inst = mkInstance({ out: () => outText })
    const H90 = inst.handlers
    const cA = await H90['notes-create']({ title: '校验甲90', body: 'A', inject: true, topic: '约定' })
    const cB = await H90['notes-create']({ title: '校验乙90', body: 'B', inject: true, topic: '约定' })
    outText = '```json\n' + JSON.stringify([
      { aId: cA.id, bId: cB.id, relation: 'conflict', reason: '同一事项指令互相矛盾' },
      { aId: cA.id, bId: 'n-ghost90', relation: 'conflict', reason: '幻觉 id 应被过滤' },
      { aId: cA.id, bId: cA.id, relation: 'supersede', reason: '自配对应被过滤' },
      { aId: cA.id, bId: cB.id, relation: 'bogus', reason: '非法 relation 应被过滤' },
      { aId: cB.id, bId: cA.id, relation: 'conflict', reason: '同一无序对重复应去重' },
      { aId: cA.id, bId: cB.id, relation: 'supersede', reason: '第二关系允许并存（同对异关系不去重）' },
    ]) + '\n```'
    const r = await H90['notes-conflict-check']({})
    assert(r && r.ok === true, '围栏 JSON 解析 ok（实得 ' + JSON.stringify(r) + '）')
    assert.strictEqual(r.pairs.length, 2, '6 条提名 → 有效 2 条（幻觉/自配/非法 relation/重复各滤 1），实得 ' + JSON.stringify(r.pairs))
    assert.strictEqual(r.pairs[0].aId, cA.id) && assert.strictEqual(r.pairs[0].bId, cB.id)
    assert.strictEqual(r.pairs[0].relation, 'conflict') && assert.strictEqual(r.pairs[0].reason, '同一事项指令互相矛盾')
    assert.strictEqual(r.pairs[0].aTitle, '校验甲90') && assert.strictEqual(r.pairs[0].bTitle, '校验乙90')
    assert.strictEqual(r.pairs[1].relation, 'supersede', '同对异关系（conflict+supersede）不去重')
    await H90['notes-delete']({ id: cA.id }); await H90['notes-delete']({ id: cB.id })
  })

  // ---- 90.3 空态/降级矩阵：<2 条零 LLM + 无 llm/未配置 error + 坏 JSON error ----
  await t('行为③降级矩阵：<2 条约定 → {ok,pairs:[]} 零 LLM 调用；无 llm/未配置模型/坏 JSON/非数组 → {error}', async () => {
    let outText = '[]'
    const inst = mkInstance({ out: () => outText })
    const H90 = inst.handlers
    const r0 = await H90['notes-conflict-check']({})
    assert(r0 && r0.ok === true && r0.pairs.length === 0 && r0.total === 0, '0 条约定空态（实得 ' + JSON.stringify(r0) + '）')
    assert.strictEqual(inst.streamCalls.length, 0, '0 条约定零 LLM 调用')
    const c1 = await H90['notes-create']({ title: '独条约定90', body: 'x', inject: true, topic: '约定' })
    const r1 = await H90['notes-conflict-check']({})
    assert(r1 && r1.ok === true && r1.pairs.length === 0 && r1.total === 1, '1 条约定空态')
    assert.strictEqual(inst.streamCalls.length, 0, '1 条约定仍零 LLM 调用')
    const c2 = await H90['notes-create']({ title: '第二约定90', body: 'y', inject: true, topic: '约定' })
    outText = '这不是 JSON 输出'
    const e1 = await H90['notes-conflict-check']({})
    assert(e1 && e1.error && e1.error.indexOf('JSON') >= 0, '坏 JSON → {error}（实得 ' + JSON.stringify(e1) + '）')
    outText = '{"aId":"x"}'
    const e2 = await H90['notes-conflict-check']({})
    assert(e2 && e2.error && e2.error.indexOf('数组') >= 0, '合法 JSON 非数组 → {error}（实得 ' + JSON.stringify(e2) + '）')
    outText = '[]'
    const r2 = await H90['notes-conflict-check']({})
    assert(r2 && r2.ok === true && r2.pairs.length === 0 && r2.total === 2, 'LLM 空数组 → ok 空对（实得 ' + JSON.stringify(r2) + '）')
    await H90['notes-delete']({ id: c1.id }); await H90['notes-delete']({ id: c2.id })
    // 无 llm 实例（73 节同款隔离）：get 映射故意不含 llm
    const instNo = mkInstance({ noLlm: true, out: () => '[]' })
    const n1 = await instNo.handlers['notes-create']({ title: '无LLM约定甲90', body: 'x', inject: true, topic: '约定' })
    const n2 = await instNo.handlers['notes-create']({ title: '无LLM约定乙90', body: 'y', inject: true, topic: '约定' })
    const e3 = await instNo.handlers['notes-conflict-check']({})
    assert(e3 && e3.error && e3.error.indexOf('LLM 不可用') >= 0, '无 llm → {error}（实得 ' + JSON.stringify(e3) + '）')
    // 未配置模型实例（adm.currentSelection=null 且设置无 llm 选配）
    const instNull = mkInstance({ admNull: true, out: () => '[]' })
    const m1 = await instNull.handlers['notes-create']({ title: '未配置约定甲90', body: 'x', inject: true, topic: '约定' })
    const m2 = await instNull.handlers['notes-create']({ title: '未配置约定乙90', body: 'y', inject: true, topic: '约定' })
    const e4 = await instNull.handlers['notes-conflict-check']({})
    assert(e4 && e4.error && e4.error.indexOf('未配置') >= 0, '未配置模型 → {error}（实得 ' + JSON.stringify(e4) + '）')
    assert.strictEqual(instNull.streamCalls.length, 0, '未配置路径不触达 LLM')
  })

  // ---- 90.4 三端 UI + i18n + 原型 + e2e 锚 ----
  await t('client 双侧：conflict 切片 + 体检 RPC + supersede/dismiss 三动作 + 内联区渲染锚（开发拼接产物 + 发布包 lib/client.js）', () => {
    const clientPkgSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'client.js'), 'utf8')
    for (const pair of [['client-src', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], tag = pair[0]
      assert(s.indexOf('conflict: null }') >= 0 || s.indexOf('conflict: null') >= 0, tag + ' store.modal.injMgr 含 conflict 切片（缺省 null=未跑）')
      assert(s.indexOf('function doInjConflictCheck()') >= 0, tag + ' doInjConflictCheck 在位')
      assert(s.indexOf("host.call('notes-conflict-check', {})") >= 0 || s.indexOf("rpc('notes-conflict-check', {})") >= 0, tag + ' 体检 RPC 调用锚')
      assert(s.indexOf("status: 'superseded'") >= 0, tag + ' 标已取代 = notes-update status=superseded（既有通道零新写入口）')
      assert(s.indexOf('function doInjConflictDismiss(') >= 0, tag + ' 保留两者 dismiss 函数在位')
      assert(s.indexOf('dsh-notes-conflict-sec') >= 0, tag + ' 内联展开区渲染锚（modal 不叠 modal：面板内新区）')
      assert(s.indexOf('setInjMgrConflict(null)') >= 0, tag + ' 面板重开复位锚')
      assert(s.indexOf("tt('inj.conflictTitle')") >= 0 && s.indexOf("tt('inj.conflictKeep')") >= 0 && s.indexOf("tt('inj.conflictSupA')") >= 0, tag + ' 文案走 tt() 字典锚')
      // 0.4.7-A⑨：在途态反馈锚——按钮 busy（running 态禁用 + 文案切「检测中…」）+ 提示行走字典（长时操作预期管理）
      assert(s.indexOf("injMgrConflict.running ? tt('inj.conflictRunning')") >= 0 && s.indexOf("tt('inj.conflictRunningHint')") >= 0, tag + ' 在途态锚（busy 按钮 + 提示行，0.4.7-A⑨）')
    }
  })
  await t('app.html 同款：injConflictHost 插槽 + renderInjConflict + 三动作 + rpc 锚；样式双端（styles.css + head.html）', () => {
    const appSrc = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'app.html'), 'utf8')
    assert(appSrc.indexOf('id="injConflictHost"') >= 0, 'app 面板含 injConflictHost 内联插槽')
    assert(appSrc.indexOf('function renderInjConflict()') >= 0 && appSrc.indexOf('renderInjConflict();') >= 0, 'app renderInjConflict 函数 + 渲染挂接')
    assert(appSrc.indexOf("rpc('notes-conflict-check', {})") >= 0, 'app 体检 RPC 调用锚')
    assert(appSrc.indexOf("rpc('notes-update', { id: id, status: 'superseded' })") >= 0, 'app 标已取代 = notes-update status=superseded')
    assert(appSrc.indexOf('function doInjConflictDismiss(') >= 0 && appSrc.indexOf('function doInjConflictSupersede(') >= 0, 'app dismiss/supersede 双函数在位')
    assert(appSrc.indexOf("t('inj.conflictTitle')") >= 0 && appSrc.indexOf("t('inj.conflictEmpty'") >= 0, 'app 文案走 t() 字典锚')
    // 0.4.7-A⑨：app 在途态同款锚（running 分支提示行 + 按钮禁用）
    assert(appSrc.indexOf("cf.running") >= 0 && appSrc.indexOf("t('inj.conflictRunningHint')") >= 0, 'app 在途态锚（0.4.7-A⑨）')
    const css90 = fsNative.readFileSync(path.join(DIR, 'src', 'styles.css'), 'utf8')
    const head90 = fsNative.readFileSync(path.join(DIR, 'src', 'app', 'shell', 'head.html'), 'utf8')
    assert(css90.indexOf('.dsh-notes-conflict-sec{') >= 0 && css90.indexOf('.dsh-notes-conflict-badge.con{') >= 0 && css90.indexOf('.dsh-notes-conflict-badge.sup{') >= 0, 'client styles.css 体检区+双徽章样式')
    assert(head90.indexOf('.conflict-sec{') >= 0 && head90.indexOf('.conflict-badge.con{') >= 0 && head90.indexOf('.conflict-badge.sup{') >= 0, 'app head.html 体检区+双徽章样式')
  })
  await t('i18n：inj.conflict* 19 键双语同建 + 占位符同形（{msg}/{n}/{title}）', () => {
    const grab = (f, v) => new Function(fsNative.readFileSync(path.join(DIR, 'src', 'i18n', f), 'utf8') + '\nreturn ' + v)()
    const zh = grab('zh.js', 'I18N_ZH'), en = grab('en.js', 'I18N_EN')
    for (const k of ['inj.conflictTitle', 'inj.conflictTitleSub', 'inj.conflictRun', 'inj.conflictRerun', 'inj.conflictRunTip', 'inj.conflictRunning', 'inj.conflictRunningHint', 'inj.conflictError', 'inj.conflictEmpty', 'inj.conflictRelConflict', 'inj.conflictRelSupersede', 'inj.conflictSupA', 'inj.conflictSupB', 'inj.conflictKeep', 'inj.conflictSupATip', 'inj.conflictSupBTip', 'inj.conflictKeepTip', 'inj.conflictSupDone', 'inj.conflictOpFailed']) {
      assert(typeof zh[k] === 'string' && zh[k].length > 0, 'zh 缺 key：' + k)
      assert(typeof en[k] === 'string' && en[k].length > 0, 'en 缺 key：' + k)
      const pz = (zh[k].match(/\{\w+\}/g) || []).sort().join(','), pe = (en[k].match(/\{\w+\}/g) || []).sort().join(',')
      assert(pz === pe, k + ' 双端占位符同形（zh:' + pz + ' / en:' + pe + '）')
    }
    assert(zh['inj.conflictTitle'] === '约定体检' && zh['inj.conflictKeep'] === '保留两者', 'zh 核心文案锚')
    // 0.4.7-A⑨：在途提示文案 = 120s 重操作口径（约定多时约需一两分钟），双语同义锚
    assert(zh['inj.conflictRunningHint'].indexOf('一两分钟') >= 0, 'zh 在途提示 = 长时预期口径（0.4.7-A⑨，实得 ' + zh['inj.conflictRunningHint'] + '）')
    assert(en['inj.conflictRunningHint'].indexOf('minute or two') >= 0, 'en 在途提示同款（实得 ' + en['inj.conflictRunningHint'] + '）')
  })
  await t('原型第四端：mock 演示数据（n-cf1/n-cf2 真实事故镜像）+ 内联区同构 + 文案与 zh 字典同文 + e2e 用例与 mock 锚', () => {
    const proto = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    assert(proto.indexOf("if (method === 'notes-conflict-check')") >= 0, '原型 _mockRpc 含 notes-conflict-check mock')
    assert(proto.indexOf("id: 'n-cf1'") >= 0 && proto.indexOf("id: 'n-cf2'") >= 0, '原型演示种子：日志隐身旧约定 + 同权裁决新约定（真实事故镜像）')
    assert(proto.indexOf('id="injConflictHost"') >= 0 && proto.indexOf('function renderInjConflict()') >= 0 && proto.indexOf("rpc('notes-conflict-check', {})") >= 0, '原型内联区 + 函数 + RPC 锚（与 app.html 同构）')
    assert(proto.indexOf("rpc('notes-update', { id: id, status: 'superseded' })") >= 0, '原型 supersede 动作与 app.html 逐字节同构')
    // 原型不双语红线：硬编码 zh 且与 zh 字典同文（单一文案源防漂移，84.6 同款锚）
    const zh90 = new Function(fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8') + '\nreturn I18N_ZH')()
    assert(proto.indexOf(zh90['inj.conflictTitle']) >= 0 && proto.indexOf(zh90['inj.conflictRun']) >= 0 && proto.indexOf(zh90['inj.conflictRelSupersede']) >= 0, '原型文案与 zh 字典同文')
    assert(proto.indexOf('>' + zh90['inj.conflictSupA'] + '<') >= 0 && proto.indexOf('>' + zh90['inj.conflictKeep'] + '<') >= 0, '原型动作按钮文案与 zh 字典同文')
    const e2eCase = fsNative.readFileSync(path.join(DIR, 'scripts', 'e2e', 'cases', '24-conflict-check.cjs'), 'utf8')
    const e2eSrv = fsNative.readFileSync(path.join(DIR, 'scripts', 'e2e', 'server.cjs'), 'utf8')
    assert(e2eSrv.indexOf("case 'notes-conflict-check':") >= 0, 'e2e mock host 含 notes-conflict-check 用例桩')
    assert(e2eCase.indexOf('#injConflictRun') >= 0 && e2eCase.indexOf('injConflictHost') >= 0, 'e2e 用例㉔ 锚（体检按钮 + 内联区）')
    assert(e2eCase.indexOf("data-act=\"keep\"") >= 0 && e2eCase.indexOf("data-act=\"supB\"") >= 0, 'e2e 用例㉔ 覆盖 dismiss/supersede 双动作')
  })
  },
}
