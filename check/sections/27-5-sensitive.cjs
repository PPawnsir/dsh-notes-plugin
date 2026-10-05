// 节 27.5 敏感信息脱敏注入（sensitive 字段 + 注入打码 + 识别建议）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "27.5",
  title: "27.5 敏感信息脱敏注入（sensitive 字段 + 注入打码 + 识别建议）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, admMock, agentsMock, appSrc, clientPkgSrc, ctx, g, handlers, llmMock, plugin, r2, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  // ===== 27.5 敏感信息脱敏注入（sensitive 字段 + 注入打码 + 识别建议 + 双端 toggle）=====
  section('27.5 敏感信息脱敏注入（sensitive 字段 + 注入打码 + 识别建议）')

  // --- 27.1 sensitive-helpers 标记块：提取 eval 单测 + 双包逐字节一致 ---
  const grabSensBlock = (src, tag) => {
    const m = src.match(/\/\/ ==== sensitive-helpers BEGIN ====[\s\S]*?\/\/ ==== sensitive-helpers END ====/)
    assert(m, tag + ' 缺 sensitive-helpers 标记块')
    return m[0]
  }
  const sensBlkDev = grabSensBlock(hostSrc, 'host-impl.js')
  const sensBlkPkg = grabSensBlock(indexSrc, 'index.mjs')
  const sensNS = {}
  new Function('ns', sensBlkDev + '\nns.suggestSensitive = suggestSensitive; ns.maskSensitiveLine = maskSensitiveLine; ns.maskSensitiveBody = maskSensitiveBody;')(sensNS)
  await t('sensitive-helpers 标记块双包逐字节一致 + 可 eval（三函数导出）', () => {
    assert.strictEqual(sensBlkPkg, sensBlkDev, 'host-impl.js 与 index.mjs 的 sensitive-helpers 块必须逐字节一致')
    assert.strictEqual(typeof sensNS.suggestSensitive, 'function', 'suggestSensitive 导出')
    assert.strictEqual(typeof sensNS.maskSensitiveLine, 'function', 'maskSensitiveLine 导出')
    assert.strictEqual(typeof sensNS.maskSensitiveBody, 'function', 'maskSensitiveBody 导出')
  })
  await t('maskSensitiveLine R1 键值行：键保留/值遮蔽/结构不变（冒号/全角/等号/列表前缀/ssh/引号键）', () => {
    const L = sensNS.maskSensitiveLine
    assert.strictEqual(L('password: hunter2', 'n-t'), 'password: ******（敏感，note_get n-t 获取）')
    assert.strictEqual(L('管理员账号：张川 !QAZ@WSX#EDC123', 'n-t'), '管理员账号：******（敏感，note_get n-t 获取）', '全角冒号 + 含空格值整段遮蔽')
    assert.strictEqual(L('api_key = abc123XYZ', 'n-t'), 'api_key = ******（敏感，note_get n-t 获取）', '等号分隔')
    assert.strictEqual(L('10.52.2.64 ssh: root 9bM%1qLGqF6$8q', 'n-t'), '10.52.2.64 ssh: ******（敏感，note_get n-t 获取）', 'ssh 行：IP 与键名保留，账号密码整值遮蔽')
    assert.strictEqual(L('- token: ghp_abc123XYZ', 'n-t'), '- token: ******（敏感，note_get n-t 获取）', '列表前缀保留')
    assert.strictEqual(L('"password": "hunter2"', 'n-t'), '"password": ******（敏感，note_get n-t 获取）', 'JSON 风格带引号键名')
  })
  await t('maskSensitiveLine R2 空白裸令牌：敏感词后形似凭据的令牌遮蔽（周围结构保留）', () => {
    const L = sensNS.maskSensitiveLine
    assert.strictEqual(L('用户 o2oa 密码 0TM_1p2@land', 'n-t'), '用户 o2oa 密码 ******（敏感，note_get n-t 获取）')
    assert.strictEqual(L('token abc123XYZ', 'n-t'), 'token ******（敏感，note_get n-t 获取）')
    assert.strictEqual(L('数据库：he3pg-x.internal:5432 用户 o2oa 密码 0TM_1p2@land', 'n-t'), '数据库：he3pg-x.internal:5432 用户 o2oa 密码 ******（敏感，note_get n-t 获取）', 'R1 不命中时 R2 补位（主机/用户保留）')
  })
  await t('误报对照：散文/配置/URL/纯小写单词不遮蔽', () => {
    const L = sensNS.maskSensitiveLine
    const unchanged = ['密码要求：至少 8 位，含大小写', 'token expires soon', '密码 必须足够长', 'max_tokens: 4096', '请注意 password 的安全性', 'https://10.102.90.77:8088', '普通的一行文字']
    for (const s of unchanged) assert.strictEqual(L(s, 'n-t'), s, '不应遮蔽：' + s)
  })
  await t('打码幂等：二次打码结果不变（占位符不再二次遮蔽）', () => {
    const L = sensNS.maskSensitiveLine
    for (const s of ['password: hunter2', '密码 abc123XYZ', 'token ghp_123abc']) {
      const once = L(s, 'n-t')
      assert.strictEqual(L(once, 'n-t'), once, '幂等：' + s)
    }
  })
  await t('maskSensitiveBody R3 私钥块：BEGIN/END 行保留、中间体遮蔽 + 多行混合正文', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\nabcdWXYZ==\n-----END RSA PRIVATE KEY-----'
    const out = sensNS.maskSensitiveBody('部署说明\n' + pem + '\n密码: abc123', 'n-t')
    assert(out.indexOf('-----BEGIN RSA PRIVATE KEY-----') >= 0 && out.indexOf('-----END RSA PRIVATE KEY-----') >= 0, 'PEM 结构行保留')
    assert(out.indexOf('MIIEowIBAAKCAQEA1234') < 0 && out.indexOf('abcdWXYZ==') < 0, 'PEM 中间体被遮蔽')
    assert(out.indexOf('部署说明') >= 0, '普通行保留')
    assert(out.indexOf('密码: ******（敏感，note_get n-t 获取）') >= 0, '同正文 R1 行也遮蔽')
    // 幂等：私钥块二次打码稳定
    assert.strictEqual(sensNS.maskSensitiveBody(out, 'n-t'), out, '整段打码幂等')
  })
  await t('suggestSensitive：命中三规则 true / 干净文本 false', () => {
    assert.strictEqual(sensNS.suggestSensitive('密码: abc123'), true, 'R1 命中')
    assert.strictEqual(sensNS.suggestSensitive('token abc123XYZ'), true, 'R2 命中')
    assert.strictEqual(sensNS.suggestSensitive('-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----'), true, 'R3 命中')
    assert.strictEqual(sensNS.suggestSensitive('今天天气不错，记录一下'), false, '干净文本不建议')
    assert.strictEqual(sensNS.suggestSensitive(''), false, '空文本不建议')
  })

  // --- 行为断言（独立实例 storeS/handlersS/contextsS/toolsS，与主共享实例隔离）---
  // 注意：section 21 会对主 plugin 二次 apply(ctx)，主 handlers/tools/contexts 分裂到两个实例（工具/find 取旧实例、
  // handlers 取新实例、contexts find 取旧实例），本节统一走专属实例，与 8.5/22 节同款模式。
  const storeS = new Map()
  const fsMockS = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeS.has(p) ? { file: true } : null)),
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeS.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeS.has(p)) throw new Error('ENOENT: ' + p); return storeS.get(p) },
    writeText: async (p, c) => { storeS.set(p, c) },
  }
  const handlersS = {}
  const toolsS = []
  const contextsS = []
  const harnessMockS = {
    handle: (name, fn) => { handlersS[name] = fn; return () => { delete handlersS[name] } },
    defineTool: (def) => def,
    registerTool: (ctx, def) => { toolsS.push(def); return () => {} },
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockS, DIR).apply({
    fs: fsMockS, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contextsS.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  const nmS = toolsS.find(x => x.name === 'note_manage')
  const catS = contextsS.find(x => x.name === 'notes:workspace-conventions')   // 0.4.3③：目录段并入 order 130 单一 context
  const dirPartS = (txt) => { const i = String(txt || '').indexOf('本地笔记库目录（'); return i < 0 ? '' : String(txt).slice(i) }

  await t('sensitive 字段往返：create 带 true → get/list/front-matter 一致', async () => {
    const c = await handlersS['notes-create']({ title: '敏感笔记A', body: 'password: abc123', topic: '敏感', sensitive: true })
    assert(!c.sensitiveSuggested, '显式 sensitive=true 不再回传建议')
    const g = await handlersS['notes-get']({ id: c.id })
    assert.strictEqual(g.note.sensitive, true, 'notes-get 返回 sensitive=true')
    const lst = await handlersS['notes-list']({})
    assert.strictEqual(lst.notes.find(n => n.id === c.id).sensitive, true, 'notes-list（slim）携带 sensitive')
    const onDisk = storeS.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\nsensitive: true\n') >= 0, 'front-matter 写 sensitive: true（实得：' + onDisk.split('\n').slice(0, 18).join('|') + '）')
  })
  await t('sensitive 缺省 false：create 不传 → get false + front-matter 恒写 false', async () => {
    const c = await handlersS['notes-create']({ title: '普通笔记B', body: '普通内容', topic: '杂' })
    assert(!c.sensitiveSuggested, '干净正文不回传建议')
    const g = await handlersS['notes-get']({ id: c.id })
    assert.strictEqual(g.note.sensitive, false, '缺省 false（noteFromParsed 回退）')
    const onDisk = storeS.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\nsensitive: false\n') >= 0, 'buildFM 恒写 sensitive: false')
  })
  await t('notes-update RPC 透传 sensitive（显式改 true/false；不传不动）', async () => {
    const c = await handlersS['notes-create']({ title: '敏感切换C', body: 'x', topic: '敏感' })
    await handlersS['notes-update']({ id: c.id, sensitive: true })
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, true, 'update sensitive=true 生效')
    await handlersS['notes-update']({ id: c.id, topic: '敏感-改' })
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, true, 'update 不传 sensitive 保持原值（undefined 不动）')
    await handlersS['notes-update']({ id: c.id, sensitive: false })
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, false, 'update sensitive=false 回落')
  })
  await t('note_manage 透传 sensitive：schema 含字段 + create/update 路由 + 敏感建议回传', async () => {
    assert(nmS.parameters.properties.sensitive && nmS.parameters.properties.sensitive.type === 'boolean', 'schema 含 sensitive 布尔参数')
    assert(nmS.description.indexOf('sensitive (boolean)') >= 0, '工具描述含 sensitive 说明')
    const c = await nmS.execute({ action: 'create', title: '工具敏感笔记', body: '普通内容', topic: '敏感', sensitive: true })
    assert(!c.error, 'manage.create sensitive 成功（实得：' + JSON.stringify(c) + '）')
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, true, 'manage.create 透传 sensitive')
    const u = await nmS.execute({ action: 'update', id: c.id, sensitive: false })
    assert(!u.error, 'manage.update sensitive 成功')
    assert.strictEqual((await handlersS['notes-get']({ id: c.id })).note.sensitive, false, 'manage.update 透传 sensitive')
    const c2 = await nmS.execute({ action: 'create', title: '工具敏感建议', body: 'password: hunter2', topic: '敏感' })
    assert.strictEqual(c2.sensitiveSuggested, true, 'manage.create 命中敏感模式回传 sensitiveSuggested')
    assert.strictEqual((await handlersS['notes-get']({ id: c2.id })).note.sensitive, false, 'create 建议不强制落 sensitive（显式动作由调用方决策）')
  })
  await t('存量/导入文件兼容：front-matter 带 sensitive: true 的原文落盘文件解析生效', async () => {
    // 导入走原文落盘（_import 直写 n.content + noteFromParsed 重建缓存），sensitive 天然保留
    await fsMockS.writeText(NOTES_DIR + '\\n-legacy-sens.md', '---\nid: n-legacy-sens\ntitle: 存量敏感笔记\ntopic: 敏感\nsensitive: true\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\npassword: legacy123\n')
    const g = await handlersS['notes-get']({ id: 'n-legacy-sens' })
    assert.strictEqual(g.note.sensitive, true, '存量文件 sensitive: true 解析生效')
    await fsMockS.writeText(NOTES_DIR + '\\n-legacy-plain.md', '---\nid: n-legacy-plain\ntitle: 旧版普通笔记\ntopic: 杂\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: \ncwd: \n---\n\n旧正文\n')
    const gDef = await handlersS['notes-get']({ id: 'n-legacy-plain' })
    assert.strictEqual(gDef.note.sensitive, false, '旧文件无 sensitive 字段缺省 false（零迁移）')
  })

  // --- 注入打码行为（renderInjected：约定桶正文打码 / 目录段普通行标题打码）---
  await t('conventionText 对 sensitive=true 笔记正文按行打码 + 尾部计数行', async () => {
    const c = await handlersS['notes-create']({ title: '注入敏感约定', body: '部署密码：Top$ecret99\n第二行普通内容', inject: true, topic: '敏感', sensitive: true })
    const r = await handlersS['notes-conventions']({})
    assert(r.text.indexOf('Top$ecret99') < 0, '注入文本不含明文密码')
    assert(r.text.indexOf('部署密码：******（敏感，note_get ' + c.id + ' 获取）') >= 0, '键保留值遮蔽 + note_get 引导（实得：' + r.text.slice(0, 240) + '）')
    assert(r.text.indexOf('第二行普通内容') >= 0, '非敏感行原文保留')
    assert(r.text.indexOf('条含敏感信息已脱敏，原文用 note_get 按 id 获取') >= 0, '尾部计数提示行')
  })
  await t('sensitive=false 的注入笔记不打码（对照）', async () => {
    await handlersS['notes-create']({ title: '注入普通约定', body: 'code style 规范', inject: true, topic: '约定' })
    const r = await handlersS['notes-conventions']({})
    assert(r.text.indexOf('code style 规范') >= 0, '普通注入笔记原文呈现')
  })
  await t('目录段普通行对 sensitive=true 条目标题打码 + 🔒 标记 + 段内计数行', async () => {
    // inject=false 才进目录段普通行（inject=true 且命中本会话的条目在约定桶已注入全文，目录去重）
    await handlersS['notes-settings-set']({ catalogEnabled: true })   // 0.4.3：目录缺省关，目录打码断言前显式开启
    const c = await handlersS['notes-create']({ title: '敏感目录条目 token: ghp_abc123', body: 'x', topic: '敏感', sensitive: true })
    assert(catS && typeof catS.text === 'function', '单一注入 context 已注册（目录段并入 order 130）')
    const txt = dirPartS(catS.text())
    assert(txt.indexOf('- [' + c.id + '] 🔒 ') >= 0, '敏感条目带 🔒 标记（实得：' + txt.split('\n').slice(0, 8).join('|') + '）')
    assert(txt.indexOf('ghp_abc123') < 0, '标题命中敏感模式同样打码')
    assert(txt.indexOf('条含敏感信息已脱敏，原文用 note_get 按 id 获取') >= 0, '目录段内计数提示行')
  })

  // --- 自动识别建议 + quick 落敏感 + 归档继承 ---
  await t('notes-quick 命中敏感模式：直接落 sensitive=true + 返回 sensitiveSuggested（磁盘原文不动）', async () => {
    const r = await handlersS['notes-quick']({ text: 'ssh 密码：9bM%1qLGqF6$8q', sessionId: 'sess-sens-quick-1' })
    assert.strictEqual(r.sensitiveSuggested, true, 'quick 返回 sensitiveSuggested（实得：' + JSON.stringify(r) + '）')
    const g = await handlersS['notes-get']({ id: r.id })
    assert.strictEqual(g.note.sensitive, true, 'quick 命中直接落 sensitive=true（即发即忘场景自动保护）')
    const onDisk = storeS.get(NOTES_DIR + '\\' + r.id + '.md')
    assert(onDisk.indexOf('\nsensitive: true\n') >= 0, 'front-matter 落 sensitive: true')
    assert(onDisk.indexOf('9bM%1qLGqF6$8q') >= 0, '磁盘原文不动（打码只作用于注入渲染，无 round-trip）')
  })
  await t('notes-quick 干净文本：不落敏感不建议', async () => {
    const r = await handlersS['notes-quick']({ text: '普通速记内容', sessionId: 'sess-sens-merge-1' })
    assert.strictEqual(r.sensitiveSuggested, false, '干净文本不建议')
    assert.strictEqual((await handlersS['notes-get']({ id: r.id })).note.sensitive, false, '干净速记 sensitive=false')
  })
  await t('notes-quick 合并窗口：后一条命中 → 原速记升级为敏感', async () => {
    const r2 = await handlersS['notes-quick']({ text: 'token abc123XYZ', sessionId: 'sess-sens-merge-1' })
    assert.strictEqual(r2.merged, true, '10 分钟内同会话合并（实得：' + JSON.stringify(r2) + '）')
    assert.strictEqual(r2.sensitiveSuggested, true, '合并条命中返回建议')
    assert.strictEqual((await handlersS['notes-get']({ id: r2.id })).note.sensitive, true, '合并后原速记升级为 sensitive=true')
  })
  await t('归档合并敏感继承：任一成员 sensitive=true → 归档笔记敏感', async () => {
    const c1 = await nmS.execute({ action: 'create', title: '归档成员-敏感', body: 'password: xxx999', topic: '归档敏感', sensitive: true })
    const c2 = await nmS.execute({ action: 'create', title: '归档成员-普通', body: '普通内容', topic: '归档敏感' })
    const r = await nmS.execute({ action: 'archive', groups: [{ memberIds: [c1.id, c2.id] }] })
    assert(!r.error && r.merged === 1, '归档成功（实得：' + JSON.stringify(r) + '）')
    assert.strictEqual((await handlersS['notes-get']({ id: r.mergedIds[0] })).note.sensitive, true, '归档笔记继承敏感标记（合并正文含成员原文，泄露面不降级）')
  })

  // --- 双侧源码同步 + 双端 UI toggle 链路 ---
  await t('双侧 sensitive 字段链路 + 注入打码源码同步（host-impl / index.mjs）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("'sensitive: ' + escYaml(m.sensitive === true ? 'true' : 'false')") >= 0, label + ' buildFM 恒写 sensitive')
      assert(src.indexOf("p.meta.sensitive === 'true'") >= 0, label + ' noteFromParsed 读 sensitive（缺省 false）')
      assert((src.match(/sensitive: n\.sensitive === true/g) || []).length >= 2, label + ' persistNote 与 slim 均携带 sensitive')
      assert(src.indexOf('sensitive: ex.sensitive === true') >= 0, label + ' _create 接受 sensitive')
      assert(/if \(sensitive !== undefined\) note\.sensitive = sensitive === true/.test(src), label + ' _update 第 13 位参数显式传才改（undefined 不动）')
      assert(src.indexOf("sensitive: { type: 'boolean'") >= 0, label + ' note_manage schema 含 sensitive')
      assert((src.match(/sensitive: args\.sensitive/g) || []).length >= 2, label + ' notes-create + note_manage.create 透传 args.sensitive')
      assert(src.indexOf('args.injectRole, args.sensitive') >= 0, label + ' notes-update / note_manage.update 第 13 位透传')
      assert(src.indexOf('members.some(n => n.sensitive === true)') >= 0, label + ' _mergeGroup 敏感继承')
      assert(src.indexOf('maskSensitiveBody(bodyTrim, n.id)') >= 0, label + ' conventionText 正文打码')
      assert(src.indexOf('maskSensitiveLine(title, n.id)') >= 0, label + ' 目录段普通行标题打码')
      assert(src.indexOf('条含敏感信息已脱敏，原文用 note_get 按 id 获取') >= 0, label + ' 尾部计数提示行')
      assert(src.indexOf('sensitiveSuggested') >= 0, label + ' 敏感建议回传（create/quick/quick-instruct）')
    }
  })
  await t('client-impl.js 敏感 toggle 链路（edSens state/ref + toggleSens + lock chip + doSave 携带 + selectNote 回填）', () => {
    assert(clientSrc.indexOf("const [edSens, setEdSens] = React.useState(false)") >= 0, 'edSens 状态')
    assert(clientSrc.indexOf('const edSensRef = React.useRef(false)') >= 0 && clientSrc.indexOf('edSensRef.current = edSens') >= 0, 'edSensRef 镜像（自动保存读最新值）')
    assert(clientSrc.indexOf('function toggleSens() { setEdSens(!edSens); triggerAutoSave() }') >= 0, 'toggleSens')
    assert(clientSrc.indexOf('onClick: toggleSens') >= 0 && clientSrc.indexOf("I('lock', 11), tt('meta.sens')") >= 0, 'meta chip（目录可见旁；i18n 覆盖卡B 起走 tt() 字典）')
    assert(clientSrc.indexOf("lock: [e('rect'") >= 0, 'IC.lock 锁形图标')
    assert(clientSrc.indexOf('sensitive: edSensRef.current === true') >= 0, 'doSave 携带 sensitive')
    assert(clientSrc.indexOf('setEdSens(n.sensitive === true)') >= 0, 'selectNote 回填')
  })
  await t('发布包 lib/client.js 同步敏感 toggle 链路（需先跑 scripts/build-dist.cjs）', () => {
    assert(clientPkgSrc.indexOf('edSens') >= 0 && clientPkgSrc.indexOf('toggleSens') >= 0, '发布包含 edSens/toggleSens')
    assert(clientPkgSrc.indexOf('sensitive: edSensRef.current === true') >= 0, '发布包 doSave 携带 sensitive')
    assert(clientPkgSrc.indexOf("I('lock', 11), tt('meta.sens')") >= 0, '发布包敏感 chip（i18n 覆盖卡B 起走 tt() 字典）')
  })
  await t('client/app.html 速记 toast 敏感标注（sensitiveSuggested 命中告知）', () => {
    /* i18n 覆盖卡F：速记敏感标注后缀走 t() 字典（cap.sensSuffix，zh 原串在 src/i18n/zh.js） */
    assert(clientSrc.indexOf("res.sensitiveSuggested ? tt('cap.sensSuffix') : ''") >= 0 && clientSrc.indexOf("if (res.sensitiveSuggested) msg += tt('cap.sensSuffix')") >= 0, 'client-impl 速记 toast 追加敏感标注（覆盖卡F 起走 tt()）')
    assert(appSrc.indexOf("res && res.sensitiveSuggested ? t('cap.sensSuffix') : ''") >= 0, 'app.html 速记 toast 追加敏感标注（覆盖卡F 起走 t()）')
  })
  await t('app.html 敏感 toggle：i-lock symbol + mSens chip + doSave 携带 sensitive', () => {
    assert(appSrc.indexOf('id="i-lock"') >= 0, 'i-lock symbol')
    assert(appSrc.indexOf('id="mSens"') >= 0 && appSrc.indexOf("icon('i-lock')") >= 0, 'mSens chip（mRecall 旁）')
    assert(appSrc.indexOf("$('mSens').onclick") >= 0 && appSrc.indexOf('edNote.sensitive = edNote.sensitive !== true') >= 0, 'mSens toggle 处理')
    assert(appSrc.indexOf('sensitive: edNote.sensitive === true') >= 0, 'app.html doSave 携带 sensitive')
  })
  Object.assign(S, { fsMockS, storeS })
  }
}
