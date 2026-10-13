// 节 136. 0.6.x 文档安全二期小项（notes-061-docsec-hygiene：0.5.x 池 [[n-mv1dohzb2q2x]] #17/#18 合并）
//   池#17 审计查看入口：S3 的 reveal 审计行原只有进程日志一面（用户不可见）——本卡加第二读面：
//   ① host 侧内存环形缓冲（session-ctx.js secret-audit 块：最近 100 条 {at,note,title,session,spans}，unshift 入账、
//     超容量挤掉最旧；title 随条目快照入账——笔记改名/删除不影响历史行）；
//   ② 进程日志照旧写（双通道：日志 + 缓冲，index.js/index.dist.js note_get reveal 面同一处入账）；
//   ③ 只读 RPC notes-secret-audit（server.js/server.dist.js 双包同块逐字节一致）→ { entries } 倒序（最新在前）；
//   ④ 双端设置卡「数据与存储」组「机密读取记录」行（紧随 secretdetect）：点击展开只读列表（时间·标题·会话·机密区数），
//     空态「暂无读取记录」；app（setSecs.secretaudit + #setSecretAudit 接线）/ client（settingsRows key + doSecretAuditToggle）/ 原型三端。
//   红线：缓冲只读不写库不进遥测；重启清空（内存态——持久化属二期加密批配套，注释写明）；设置组既有行不动（111 节组内序锁）。
//   池#18 残余面（面板建议横幅）：check 侧只锁静态锚（edSecretSug/doSecretMarkAll/doSecretIgnore/忽略记账）——
//     行为级全链在 e2e 用例 68（面板：保存冒泡→一键标记→fence+横幅自清+机密岛；忽略同篇静默）；app 审计行渲染在 e2e 用例 69。
// 节号自查：本卡落地时最新节 = 135（vector-hygiene），本节 = 136；最新 e2e 用例 = 67，新增 68/69。
module.exports = {
  id: "136",
  title: "136. 0.6.x 文档安全二期小项：reveal 审计环形缓冲 + 设置区查看入口 + 面板横幅锚（notes-061-docsec-hygiene）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { llmMock, admMock, agentsMock, sessionPersistenceMock, workspaceRegistryMock, sessionTitleMock, sessionQueryMock, NOTES_DIR } = S
  section('136. 0.6.x 文档安全二期小项（notes-061-docsec-hygiene：池 #17/#18）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const sessCtxSrc = read('src/host/kernel/session-ctx.js')
  const srvDev = read('src/host/server.js')
  const srvDist = read('src/host/server.dist.js')
  const idxDev = read('src/host/index.js')
  const idxDist = read('src/host/index.dist.js')
  const appSettings = read('src/app/modals/settings.js')
  const cliSettings = read('src/client/modals/settings.js')
  const protoV2 = read('design/notes-ui-v2.html')
  const appHead = read('src/app/shell/head.html')
  const stylesSrc = read('src/styles.css')
  const mockSrc = read('scripts/e2e/server.cjs')
  const grab = (f, v) => new Function(read('src/i18n/' + f) + '\nreturn ' + v)()
  const ZH = grab('zh.js', 'I18N_ZH'), EN = grab('en.js', 'I18N_EN')

  // ===== 136.1 静态锚：环形缓冲助手 + 双通道入账点（index 双包）+ 只读 RPC 注册（server 双包逐字节一致）=====
  await t('二期池#17 静态锚：secret-audit 环形缓冲（session-ctx）+ reveal 双通道入账（index 双包）+ notes-secret-audit 双包注册逐字节一致', () => {
    // 缓冲助手（session-ctx.js = 双包同一物理文件，零同步面）：容量常量 + unshift 入账 + 环形截断 + 拷贝出体
    assert(sessCtxSrc.indexOf('const SECRET_AUDIT_MAX = 100') >= 0, '环形缓冲容量常量 SECRET_AUDIT_MAX=100 在案')
    assert(sessCtxSrc.indexOf('function pushSecretAudit(entry)') >= 0 && sessCtxSrc.indexOf('_secretAuditBuf.unshift({') >= 0, 'pushSecretAudit unshift 入账（首部即最新）')
    assert(sessCtxSrc.indexOf('if (_secretAuditBuf.length > SECRET_AUDIT_MAX) _secretAuditBuf.length = SECRET_AUDIT_MAX') >= 0, '环形截断：超容量挤掉最旧')
    assert(sessCtxSrc.indexOf('function listSecretAudit() { return _secretAuditBuf.slice() }') >= 0, 'listSecretAudit 拷贝出体（调用方改不动缓冲）')
    assert(sessCtxSrc.indexOf('重启清空') >= 0 && sessCtxSrc.indexOf('持久化属二期加密批配套') >= 0, '重启清空 + 持久化归二期注释在案')
    assert(sessCtxSrc.indexOf('只读不写库不进遥测') >= 0, '红线注释在案（只读不写库不进遥测）')
    // reveal 入账点双包同步（与进程日志同一处——双通道）；title 快照随条目入账
    for (const [src, tag] of [[idxDev, 'index.js'], [idxDist, 'index.dist.js']]) {
      assert(src.indexOf("pushSecretAudit({ at: auditAt, note: n.id, title: n.title || '', session: auditSid, spans: s2Spans.count })") >= 0, tag + ' reveal 面 pushSecretAudit 入账（五字段含标题快照）')
      assert(src.indexOf("console.warn('[dsh-notes] note_get reveal 审计：' + auditAt") >= 0, tag + ' 进程日志行照旧（双通道：日志 + 缓冲——日志行与缓冲条目同源数据）')
    }
    // 只读 RPC 注册：server 双包标记块逐字节一致（slow-rpc-log/notes-get-batch 同款纪律）
    const grabBlk = (s) => { const i = s.indexOf('// ==== secret-audit BEGIN ===='); const j = s.indexOf('// ==== secret-audit END ===='); return (i >= 0 && j > i) ? s.slice(i, j) : '' }
    const bDev = grabBlk(srvDev), bDist = grabBlk(srvDist)
    assert(bDev && bDist, 'server.js/server.dist.js secret-audit 标记块双双在案')
    assert.strictEqual(bDev, bDist, 'secret-audit 块双包逐字节一致')
    assert(bDev.indexOf("handle('notes-secret-audit', async () => ({ entries: listSecretAudit() }))") >= 0, 'notes-secret-audit 只读端点注册（entries 倒序出体）')
    assert(bDev.indexOf('只读红线') >= 0 && bDev.indexOf('重启清空') >= 0, 'RPC 注册块红线注释在案（只读零写入 + 重启清空）')
    // 拼接产物在案（双包源 → hostSrc/indexSrc）
    assert(hostSrc.indexOf('SECRET_AUDIT_MAX') >= 0 && indexSrc.indexOf('SECRET_AUDIT_MAX') >= 0, '双包拼接产物含环形缓冲（需先跑 build-dist）')
    assert(hostSrc.indexOf("handle('notes-secret-audit'") >= 0 && indexSrc.indexOf("handle('notes-secret-audit'") >= 0, '双包拼接产物含 notes-secret-audit 注册')
  })

  // ===== 行为断言设施（fresh host 实例——独立 store/handlers/tools，零污染共享 S；形态同节 131 mk131）=====
  function mk136() {
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
    const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: (c, d) => { tools.push(d); return () => {} } }
    new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply({
      fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return { store, handlers, tools }
  }

  // ===== 136.2 行为级：reveal 调用 → 缓冲含行（五字段）+ 进程日志照旧（双通道）+ reveal=false 零入账 =====
  await t('二期池#17 行为级：note_get reveal:true → 环形缓冲含行（时间/笔记/标题快照/会话/spans）+ 进程日志照旧 + reveal=false 零入账', async () => {
    const inst = mk136()
    const FENCE = '```secret'
    const c1 = await inst.handlers['notes-create']({ title: '二期审计甲', body: '良行136\n\n' + FENCE + '\nAUDITSEC136\n```' })
    const c2 = await inst.handlers['notes-create']({ title: '二期审计乙', body: '普通正文136（无 span）' })
    const noteGet = inst.tools.find(x => x.name === 'note_get')
    const auditRpc = inst.handlers['notes-secret-audit']
    assert(typeof auditRpc === 'function', 'notes-secret-audit handler 在册（fresh 实例）')
    // 空缓冲基线：{ entries: [] }
    const a0 = await auditRpc({})
    assert(a0 && Array.isArray(a0.entries) && a0.entries.length === 0, '空缓冲 → { entries: [] }（设置行空态数据源）')
    // reveal=false（缺省）零入账
    await noteGet.execute({ id: c1.id })
    assert((await auditRpc({})).entries.length === 0, 'reveal=false（缺省打码取回）零入账——只有显式 reveal:true 才记')
    // reveal:true → 缓冲含行 + 进程日志照旧（双通道同断言）
    const warnLines = []
    const origWarn = console.warn
    console.warn = function () { try { warnLines.push(Array.prototype.map.call(arguments, String).join(' ')) } catch (e) {} }
    try { await noteGet.execute({ id: c1.id, reveal: true }) } finally { console.warn = origWarn }
    assert(warnLines.some(l => l.indexOf('[dsh-notes] note_get reveal 审计：') === 0 && l.indexOf('note=' + c1.id) >= 0), '进程日志行照旧写（双通道红线：缓冲是新增读面，不是替代）')
    const a1 = await auditRpc({})
    assert(a1.entries.length === 1, 'reveal:true 后缓冲恰一条（实得 ' + a1.entries.length + '）')
    const en1 = a1.entries[0]
    assert(en1.note === c1.id && en1.title === '二期审计甲' && en1.spans === 1, '条目五字段：note id + 标题快照 + spans 计数（实得 ' + JSON.stringify(en1) + '）')
    assert(en1.session === 'session-abc12345-0000-0000-0000-000000000000', '条目含会话 sid（谁在何时读了哪篇）')
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(en1.at), '条目含 ISO 时间戳')
    // 无 span 笔记 reveal:true 也入账（spans=0 可分辨——与 131 节进程日志口径一致）
    await noteGet.execute({ id: c2.id, reveal: true })
    const a2 = await auditRpc({})
    assert(a2.entries.length === 2 && a2.entries[0].note === c2.id && a2.entries[0].spans === 0, '无 span 笔记 reveal:true 同样入账（spans=0）且倒序（最新在前）')
    assert(a2.entries[1].note === c1.id, '倒序保持：较早条目退居次位')
  })

  // ===== 136.3 行为级：RPC 倒序 + 环形容量 100 截断（101 次 reveal 挤掉最旧）+ 标题快照不随后续改名漂移 =====
  await t('二期池#17 行为级：notes-secret-audit 倒序（最新在前）+ 环形 100 截断 + 标题快照（笔记改名不影响历史行）', async () => {
    const inst = mk136()
    const c = await inst.handlers['notes-create']({ title: '二期环形原题', body: '环行136\n\n```secret\nRINGSEC136\n```' })
    const noteGet = inst.tools.find(x => x.name === 'note_get')
    const auditRpc = inst.handlers['notes-secret-audit']
    // 标题快照：入账后改名，历史行仍显旧题
    await noteGet.execute({ id: c.id, reveal: true })
    await inst.handlers['notes-update']({ id: c.id, title: '二期环形新题' })
    const snap = await auditRpc({})
    assert(snap.entries.length === 1 && snap.entries[0].title === '二期环形原题', '标题快照随条目入账（笔记改名后历史行不漂移）')
    // 环形容量：再入 100 条（累计 101）→ 缓冲恒 100，最旧（标题快照那条）被挤出
    for (let i = 0; i < 100; i++) await noteGet.execute({ id: c.id, reveal: true })
    const full = await auditRpc({})
    assert(full.entries.length === 100, '环形截断：101 次 reveal → 缓冲恒 100 条（实得 ' + full.entries.length + '）')
    assert(full.entries.every(en => en.note === c.id), '全部条目归属同一笔记（容量内）')
    assert(full.entries[99].title === '二期环形新题' && full.entries[0].title === '二期环形新题', '最旧一条（原题快照）被挤出——首尾皆是新题')
    // 倒序严格性：at 单调不升（同毫秒退化为相等——Date 粒度内允许并列，次序由 unshift 保证）
    for (let i = 1; i < full.entries.length; i++) assert(full.entries[i - 1].at >= full.entries[i].at, '倒序保持（entries[' + (i - 1) + '].at ≥ entries[' + i + '].at）')
  })

  // ===== 136.4 只读红线行为级：RPC 零写盘 + 笔记原文不动 + 不入遥测 =====
  await t('二期池#17 只读红线：notes-secret-audit 零写盘（store 零新增）+ 笔记 .md 原文不动 + 缓冲不进遥测面', async () => {
    const inst = mk136()
    const c = await inst.handlers['notes-create']({ title: '二期只读闸', body: '只读136\n\n```secret\nROSEC136\n```' })
    const noteGet = inst.tools.find(x => x.name === 'note_get')
    await noteGet.execute({ id: c.id, reveal: true })
    const keysBefore = Array.from(inst.store.keys()).sort()
    const r = await inst.handlers['notes-secret-audit']({})
    assert(r.entries.length === 1, 'RPC 返回缓冲内容（1 条）')
    const keysAfter = Array.from(inst.store.keys()).sort()
    assert.deepStrictEqual(keysAfter, keysBefore, 'RPC 只读：store 键集零新增（不写库——红线）')
    const raw = String(inst.store.get(NOTES_DIR + '\\' + c.id + '.md') || '')
    assert(raw.indexOf('ROSEC136') >= 0 && raw.indexOf('secret-audit') < 0 && raw.indexOf('二期只读闸') >= 0, '笔记 .md 原文不动（审计面零残留）')
    // 遥测红线口径：审计 RPC 前后 telemetry.json 逐字节不变（缓冲内容不入遥测）；perf-report 只携方法名计数
    //   （notes-secret-audit 计数键 = 每个 RPC 都有的既有 perf 面——审计条目内容（笔记 id/标题/会话）零泄漏才算红线守住了）
    const telKey = Array.from(inst.store.keys()).find(k => k.indexOf('telemetry') >= 0)
    const telBefore = telKey ? String(inst.store.get(telKey)) : null
    await inst.handlers['notes-secret-audit']({})
    const telAfter = telKey ? String(inst.store.get(telKey)) : null
    assert.strictEqual(telAfter, telBefore, '审计 RPC 前后 telemetry.json 零变化（缓冲不进遥测红线）')
    const perfKey = Array.from(inst.store.keys()).find(k => k.indexOf('perf-report') >= 0)
    if (perfKey) {
      const pr = String(inst.store.get(perfKey))
      assert(pr.indexOf(c.id) < 0 && pr.indexOf('二期只读闸') < 0 && pr.indexOf('session-abc12345') < 0, 'perf-report 只携方法名计数——审计条目内容（笔记/标题/会话）零泄漏')
    }
    // 返回体拷贝闸：调用方改 entries 不污染缓冲（listSecretAudit slice 出体）
    r.entries.push({ at: 'x', note: 'fake', title: 'fake', session: 'fake', spans: 9 })
    const r2 = await inst.handlers['notes-secret-audit']({})
    assert(r2.entries.length === 1 && r2.entries[0].note === c.id, '返回体拷贝闸：调用方篡改不回流缓冲')
  })

  // ===== 136.5 设置行静态锚三端 + i18n 双语 + CSS 三端 =====
  await t('二期池#17 设置行静态锚：三端 secretaudit 行（data 组紧随 secretdetect）+ 展开接线 + i18n 八键双语 + CSS 三端', () => {
    // app：行壳 data-sec + 控件 id + 接线（rpc 拉取 + 空态/收起翻转 + 迟到守卫）
    assert(appSettings.indexOf("'<div class=\"set-row\" data-sec=\"secretaudit\">'") >= 0, 'app setSecs.secretaudit 行壳在案')
    assert(appSettings.indexOf('id="setSecretAudit"') >= 0 && appSettings.indexOf('id="setSecretAuditBody"') >= 0, 'app 控件 #setSecretAudit + 列表壳 #setSecretAuditBody 在案')
    assert(appSettings.indexOf("$('setSecretAudit').onclick = function ()") >= 0 && appSettings.indexOf("rpc('notes-secret-audit', {})") >= 0, 'app 展开接线：点击 → notes-secret-audit 拉取')
    assert(appSettings.indexOf("t('settings.secretAuditEmpty')") >= 0 && appSettings.indexOf("t('settings.secretAuditHide')") >= 0, 'app 空态文案 + 收起翻转在案')
    // client：settingsRows 行 + 本地态 + host.call 拉取 + 空态
    assert(cliSettings.indexOf("{ key: 'secretaudit', label: tt('settings.secretAudit')") >= 0, 'client settingsRows secretaudit 行在案')
    assert(cliSettings.indexOf('doSecretAuditToggle') >= 0 && cliSettings.indexOf("host.call('notes-secret-audit', {})") >= 0, 'client 展开接线：doSecretAuditToggle → notes-secret-audit')
    assert(cliSettings.indexOf("tt('settings.secretAuditEmpty')") >= 0 && cliSettings.indexOf('dsh-notes-audit-line') >= 0, 'client 空态文案 + 列表行样式类在案')
    // 原型：行 + 接线 + _mockRpc 演示桩（静态中文——原型不双语红线）
    assert(protoV2.indexOf('data-sec="secretaudit"') >= 0 && protoV2.indexOf("method === 'notes-secret-audit'") >= 0, '原型 secretaudit 行 + mock 桩在案')
    assert(protoV2.indexOf("$('setSecretAudit').onclick = function ()") >= 0 && protoV2.indexOf('暂无读取记录') >= 0, '原型展开接线 + 空态静态中文在案')
    // 组登记：三端 SET_GROUPS data 组含 secretaudit 紧随 secretdetect（19 行计数锚在节 111，此处锁相对位）
    for (const [src, tag] of [[appSettings, 'app'], [cliSettings, 'client'], [protoV2, '原型']]) {
      assert(src.indexOf("'secretdetect', 'secretaudit',") >= 0, tag + ' SET_GROUPS data 组：secretaudit 紧随 secretdetect')
    }
    // i18n 八键双语（zh 精确值 + en 非空 + {n} 占位同形由节 68 全域闸兜底，此处点名锁）
    const AUDIT_KEYS = ['settings.secretAudit', 'settings.secretAuditTip', 'settings.secretAuditTipT', 'settings.secretAuditView', 'settings.secretAuditHide', 'settings.secretAuditEmpty', 'settings.secretAuditSpans', 'settings.secretAuditLoadFailed']
    for (const k of AUDIT_KEYS) {
      assert(typeof ZH[k] === 'string' && ZH[k].length > 0 && typeof EN[k] === 'string' && EN[k].length > 0, k + ' 双语非空')
    }
    assert(ZH['settings.secretAudit'] === '机密读取记录', 'zh 行名 = 机密读取记录')
    assert(ZH['settings.secretAuditEmpty'] === '暂无读取记录', 'zh 空态 = 暂无读取记录（需求文案锁定）')
    assert(ZH['settings.secretAudit'].indexOf('读取') >= 0 && EN['settings.secretAudit'].indexOf('read') >= 0, '行名双语语义（读取记录/read records）')
    // CSS 三端（app head.html / client styles.css / 原型内联 style）
    assert(appHead.indexOf('.set-audit-line{') >= 0 && protoV2.indexOf('.set-audit-line{') >= 0, 'app/原型 .set-audit-line 样式在案')
    assert(stylesSrc.indexOf('.dsh-notes-audit-line{') >= 0 && stylesSrc.indexOf('.dsh-notes-audit-list{') >= 0, 'client .dsh-notes-audit-list/line 样式在案')
  })

  // ===== 136.6 池#18 残余面静态锚 + e2e 同步（用例 68 面板横幅 + 用例 69 app 审计行 + mock 端点在册）=====
  await t('二期池#18 静态锚 + e2e 同步：面板横幅执行体在案 + mock notes-secret-audit 端点 + 用例 68/69 在册', () => {
    // 面板横幅执行体锚（行为级全链 = e2e 用例 68；check 侧只锁源码锚防静默拆除）
    const edSrc = read('src/client/panels/panel/editor.js')
    assert(edSrc.indexOf('setEdSecretSug({ count: res.secretSuggested.count') >= 0, '面板保存响应建议面在案（secretSuggested → 冒泡）')
    assert(edSrc.indexOf('function doSecretMarkAll()') >= 0 && edSrc.indexOf("wrapSecretLines(edBodyRef.current || '', edSecretSug.lines)") >= 0, '面板一键标记执行体在案（wrapSecretLines 内核同源）')
    assert(edSrc.indexOf('function doSecretIgnore()') >= 0 && edSrc.indexOf("secretSugIgnoredRef.current[selectedRef.current + ':' + edSecretSug.lines.join(',')] = true") >= 0, '面板忽略记账在案（noteId:lines 会话级内存态）')
    assert(edSrc.indexOf("className: 'dsh-notes-deg dsh-notes-secret-sug'") >= 0 && edSrc.indexOf("tt('editor.secretSuggest'") >= 0, '面板横幅渲染锚在案（.dsh-notes-secret-sug + 行号文案）')
    // e2e mock：notes-secret-audit 端点在册（节 113 注册对等闸——host 新增 RPC 必须实现或登记豁免）
    assert(mockSrc.indexOf("case 'notes-secret-audit':") >= 0 && mockSrc.indexOf('state.secretAudit') >= 0, 'e2e mock notes-secret-audit 用例桩在册（state.secretAudit 数据源）')
    // e2e 用例 68/69 在册锚
    const e2e68 = read('scripts/e2e/cases/68-panel-secret-suggest-banner.cjs')
    const e2e69 = read('scripts/e2e/cases/69-app-secret-audit-row.cjs')
    assert(e2e68.indexOf('dsh-notes-secret-sug') >= 0 && e2e68.indexOf('dsh-notes-sug-act') >= 0 && e2e68.indexOf('dsh-notes-sug-ignore') >= 0, '用例 68：面板横幅三锚（横幅/一键标记/忽略）')
    assert(e2e69.indexOf("'secretaudit'") >= 0 && e2e69.indexOf('#setSecretAudit') >= 0 && e2e69.indexOf('暂无读取记录') >= 0, '用例 69：app 审计行锚（行壳 + 查看钮 + 空态文案）')
  })
  },
}
