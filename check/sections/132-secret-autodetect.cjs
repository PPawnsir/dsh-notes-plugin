// 节 132. 文档安全 S4（notes-052-autodetect-i18n）：保存时自动检测建议 + 双端收口
// 覆盖面（模式库行为级 + 保存建议行为级 + 开关锁断言 + 持久化 + 一键标记契约 + 双端 blur 同构静态 + 原型/README/e2e 同步）：
//   ① 模式库行为级（切片 + sensitive-helpers 块 eval）：suggestSecretSpans 两族判异——secret 面复用 suggestSensitive
//      的 R1 键值/R2 裸令牌/R3 PEM（打码/检测同一套规则单点不漂移）+ credential 面新增（AKIA/sk-/ghp_ 系裸凭据，
//      R1/R2 天然不覆盖）；粒度 = 行；相邻命中合并为区间；已 ```secret 标记区内的行不再建议（一键标记闭环）；
//      散文防御（「密码 必须足够长」/「token expires soon」类误报走零成本忽略路径——不命中）。
//   ② 保存建议行为级：create/update 响应附 secretSuggested {count,lines}（count=合并区间数，lines=1-based 行号平铺）；
//      干净笔记零建议字段；update 仅携带正文的保存才建议（元数据-only 不重提）；fence 内的行不再建议（闭环）。
//   ③ 开关锁断言（主窗口裁决）：secretDetect.enabled===false → 检测整体跳过，保存响应零建议字段——
//      但已标记机密区的 note_get 打码/注入占位照常（保护管线不设任何开关；开关只管建议不管保护）。
//   ④ 设置持久化：settings-set 白名单（{enabled} 整键增量合并 + null 恢复缺省开）+ 非法形态拒绝 + 双包同步。
//   ⑤ 一键标记契约（wrapSecretLines 行为级）：建议行包 fence 后 parseSecretSpans 恰好覆盖命中行、
//      maskSecretSpans 打码生效（S1/S2 保护链路接通）；非法/空行号零改写原样返回。
//   ⑥ 双端同构静态锚：app（showSecretSuggest/markSecretSuggested/#secretSug）+ client（edSecretSug/doSecretMarkAll/
//      doSecretIgnore/banner JSX）+ 忽略静默（本篇本次内存态）+ 面板机密岛交互同构（bindPanelSecret 揭示/回糊/取消机密）。
//   ⑦ 原型同步（design/notes-ui-v2.html：横幅 + 设置行 + mock 检测）+ README 双语键落位 + e2e mock/用例同步。
module.exports = {
  id: "132",
  title: "132. 文档安全 S4：保存时自动检测建议 + 双端 blur 同构 + 开关只管建议（notes-052-autodetect-i18n）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { llmMock, admMock, agentsMock, sessionPersistenceMock, workspaceRegistryMock, sessionTitleMock, sessionQueryMock, NOTES_DIR } = S
  section('132. 文档安全 S4：保存时自动检测建议 + 双端 blur 同构 + 开关只管建议（notes-052-autodetect-i18n）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const FENCE = '```secret'
  // 独立实例工厂（27.5/130/131 节同款隔离模式：fresh store/handlers/tools，零污染共享 S）
  function mk132() {
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
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: (c) => { contexts.push(c); return () => {} } }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return { store, handlers, tools, contexts }
  }

  // ===== 132.1 模式库行为级（spanSlice + sensitive-helpers 块合并 eval——host 作用域内形态）=====
  const ekSrc = read('src/shared/editor-kernel.js')
  const s0 = ekSrc.indexOf('// ===== secret-span BEGIN'), s1 = ekSrc.indexOf('// ===== secret-span END') + '// ===== secret-span END'.length
  const spanSlice = ekSrc.slice(s0, s1)
  const sensBlk = hostSrc.match(/\/\/ ==== sensitive-helpers BEGIN ====[\s\S]*?\/\/ ==== sensitive-helpers END ====/)
  assert(sensBlk, 'host-impl.js 缺 sensitive-helpers 标记块')
  const NS132 = {}
  new Function('ns', spanSlice + '\n' + sensBlk[0] + '\nns.suggestSecretSpans=suggestSecretSpans; ns.maskSecretSpans=maskSecretSpans; ns.maskSensitiveBody=maskSensitiveBody;')(NS132)
  await t('S4 模式库行为级：两族判异（R1/R2/R3 复用 + AKIA/sk-/ghp_ credential 面）+ 行粒度合并 + 散文防御 + 空体零命中', () => {
    // ① secret 面（复用 suggestSensitive 判异——打码/检测同一套规则）
    const kv = NS132.suggestSecretSpans('第一行\npassword=Sup3rSecret!42\n第三行')
    assert(kv.length === 1 && kv[0].sLine === 2 && kv[0].eLine === 2, 'R1 键值行命中（password=，行号 1-based）')
    const zh = NS132.suggestSecretSpans('密码：中文值88')
    assert(zh.length === 1, '中文键名（密码：）命中')
    const tok = NS132.suggestSecretSpans('token a1b2c3d4E5')
    assert(tok.length === 1, 'R2 空白裸令牌命中（token + 非纯小写令牌）')
    // ② credential 面（新增：裸凭据前缀，R1/R2 天然不覆盖）
    const aws = NS132.suggestSecretSpans('部署配置\nAWS_KEY = AKIAIOSFODNN7EXAMPLE\n备注')
    assert(aws.length === 1 && aws[0].sLine === 2, 'AKIA 访问键命中（无键名先导）')
    const sk = NS132.suggestSecretSpans('sk-proj-abcdefghij1234567890 结尾')
    assert(sk.length === 1 && sk[0].sLine === 1, 'sk- 前缀命中')
    const gh = NS132.suggestSecretSpans('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12 在场')
    assert(gh.length === 1, 'ghp_ GitHub PAT 命中')
    assert(NS132.suggestSecretSpans('risk-analysis 与 task-submit 不命中').length === 0, '词中 sk- 前缀不误报（lookbehind）')
    // ③ R3 PEM 私钥块：跨行整块单区间
    const pem = '开头\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890\nMIIEogIBAAKCAQEA0987654321\n-----END RSA PRIVATE KEY-----\n结尾'
    const pemR = NS132.suggestSecretSpans(pem)
    assert(pemR.length === 1 && pemR[0].sLine === 2 && pemR[0].eLine === 5, 'PEM 块整块单区间（BEGIN..END 全部行）')
    // ④ 相邻命中行合并为连续区间
    const adj = NS132.suggestSecretSpans('一\npassword=a1\npwd=b2\n三\nAKIAIOSFODNN7EXAMPLE')
    assert(adj.length === 2 && adj[0].sLine === 2 && adj[0].eLine === 3 && adj[1].sLine === 5, '相邻命中合并（2-3 行一区间 + 第 5 行独立区间）')
    // ⑤ 散文防御（误报走「忽略」零成本路径——不命中即零打扰）
    assert(NS132.suggestSecretSpans('密码 必须足够长\ntoken expires soon\n密钥请妥善保管').length === 0, '散文形态零命中（中文值/纯小写令牌不误报）')
    assert(NS132.suggestSecretSpans('').length === 0 && NS132.suggestSecretSpans(null).length === 0, '空体/缺省零命中')
  })
  await t('S4 一键标记闭环锚：已 ```secret 标记区内的命中行不再建议（标记后保存不重复冒泡）', () => {
    const marked = '良行\n' + FENCE + '\npassword=AlreadyMarked99\n```\nAKIAIOSFODNN7EXAMPLE 良行'
    const r = NS132.suggestSecretSpans(marked)
    assert(r.length === 1 && r[0].sLine === 5, 'fence 内的 password 行不重复建议；fence 外 AKIA 行照常建议（第 5 行）')
    const halfFence = FENCE + '\npwd=HalfMarked1\n```\n普通'
    assert(NS132.suggestSecretSpans(halfFence).length === 0, '整块标记后零建议（一键标记闭环）')
  })

  // ===== 132.2 保存建议行为级（fresh host 实例：create/update 响应面）=====
  await t('S4 保存建议行为级：含密码笔记保存→响应带 secretSuggested；干净笔记零建议；元数据-only 不重提；fence 内不再建议', async () => {
    const inst = mk132()
    const c1 = await inst.handlers['notes-create']({ title: 'S4 密码笔记', body: '开头\npassword=e2eSugPw99\n结尾' })
    assert(c1.secretSuggested && c1.secretSuggested.count === 1 && c1.secretSuggested.lines.length === 1 && c1.secretSuggested.lines[0] === 2, 'create 响应带 secretSuggested {count:1, lines:[2]}（行号 1-based）')
    const c2 = await inst.handlers['notes-create']({ title: 'S4 干净笔记', body: '普通正文\n无凭据' })
    assert(!('secretSuggested' in c2), '干净笔记零建议字段（干净出体）')
    // update：携带正文才建议；元数据-only 不重提（忽略后改标题不再打扰）
    const u1 = await inst.handlers['notes-update']({ id: c2.id, body: '新正文\nAWS_KEY = AKIAIOSFODNN7EXAMPLE' })
    assert(u1.secretSuggested && u1.secretSuggested.count === 1 && u1.secretSuggested.lines[0] === 2, 'update 带正文 → 建议（AKIA 行）')
    const u2 = await inst.handlers['notes-update']({ id: c2.id, title: 'S4 干净笔记（改题）' })
    assert(!('secretSuggested' in u2), 'update 元数据-only → 零建议字段（不重提）')
    // fence 内的行不再建议（一键标记闭环——响应面）
    const u3 = await inst.handlers['notes-update']({ id: c1.id, body: '开头\n' + FENCE + '\npassword=e2eSugPw99\n```\n结尾' })
    assert(!('secretSuggested' in u3), '标记后保存零建议（fence 区内行不再建议——闭环）')
    assert(!('secretSuggested' in c1) === false, '（自检）c1 原本带建议（防误造恒真）')
  })

  // ===== 132.3 开关锁断言（主窗口裁决）：开关只管建议不管保护 =====
  await t('S4 开关锁断言：开关关→含密码笔记也零建议字段，但已标记机密的 note_get 打码/注入占位照常（保护管线不设开关）', async () => {
    const inst = mk132()
    // 先标记一篇机密（开关开时段）——用于保护面验证
    const cf = await inst.handlers['notes-create']({ title: 'S4 开关与保护', body: '良行\n' + FENCE + '\nGATESECRET99\n```', inject: true, topic: '开发' })
    assert(!('secretSuggested' in cf), 'fence 笔记零建议（闭环语义先行）')
    // 关开关 → 含密码笔记零建议
    const off = await inst.handlers['notes-settings-set']({ secretDetect: { enabled: false } })
    assert(!off.error && off.settings.secretDetect && off.settings.secretDetect.enabled === false, 'settings-set secretDetect {enabled:false} 落盘')
    const c3 = await inst.handlers['notes-create']({ title: 'S4 开关关密码笔记', body: 'password=OffStillSuggest99' })
    assert(!('secretSuggested' in c3), '开关关 → 含密码笔记零建议字段（检测整体跳过）')
    // 保护照常：note_get 缺省占位 + 注入占位（开关不影响标记即保护）
    const noteGet = inst.tools.find(x => x.name === 'note_get')
    const g = await noteGet.execute({ id: cf.id })
    assert(g.note.body.indexOf('GATESECRET99') < 0 && g.note.body.indexOf('🔒 机密区（3 行，note_get reveal 获取）') >= 0, '开关关后已标记机密 note_get 照常打码（保护不受开关影响）')
    const conv = await inst.handlers['notes-conventions']({})
    assert(conv.text.indexOf('GATESECRET99') < 0 && conv.text.indexOf('🔒 机密区（3 行，note_get reveal 获取）') >= 0, '开关关后注入照常占位（标记即保护恒在——红线）')
    // null 恢复缺省开 → 建议回归
    await inst.handlers['notes-settings-set']({ secretDetect: null })
    const c4 = await inst.handlers['notes-create']({ title: 'S4 恢复开', body: 'password=BackOnSuggest99' })
    assert(c4.secretSuggested && c4.secretSuggested.count === 1, 'null 删除 override → 缺省开恢复（建议回归）')
  })

  // ===== 132.4 设置持久化白名单（双包 + 产物）=====
  await t('S4 设置持久化：secretDetect {enabled} 整键增量合并白名单（semantic 组同款）+ 非法形态拒绝 + 双包/产物同步', async () => {
    const inst = mk132()
    const bad = await inst.handlers['notes-settings-set']({ secretDetect: 'nope' })
    assert(bad.error && bad.error.indexOf('secretDetect') >= 0, '非对象形态整体拒绝（错得安全）')
    const bad2 = await inst.handlers['notes-settings-set']({ secretDetect: { enabled: 'maybe' } })
    assert(!bad2.error && bad2.settings.secretDetect.enabled !== 'maybe', 'enabled 非 true/false 忽略不落盘（白名单子键纪律）')
    // 静态锚：白名单条目在案（settings-set 闸在 inject 双包 + 产物；缺省开读法在 settings-store 双包 + 产物）
    for (const [label, src] of [['src/host/inject.js', read('src/host/inject.js')], ['src/host/inject.dist.js', read('src/host/inject.dist.js')], ['index.mjs（需先跑 build-dist）', indexSrc]]) {
      assert(src.indexOf("'secretDetect' in patch") >= 0, label + ' settings-set 白名单含 secretDetect 键')
    }
    for (const [label, src] of [['src/host/kernel/settings-store.js', read('src/host/kernel/settings-store.js')], ['src/host/kernel/settings-store.dist.js', read('src/host/kernel/settings-store.dist.js')], ['index.mjs', indexSrc]]) {
      assert(src.indexOf('function secretDetectEnabled') >= 0, label + ' 缺省开读法在案（仅显式 false 才关）')
    }
    // host notes.js 双包 + 产物：保存管线三处接线（helper + create + update body 闸门）
    for (const [label, src] of [['src/host/notes.js', read('src/host/notes.js')], ['src/host/notes.dist.js', read('src/host/notes.dist.js')], ['index.mjs', indexSrc]]) {
      assert(src.indexOf('function secretSuggestPayload') >= 0, label + ' secretSuggestPayload 助手在案')
      assert((src.match(/secretSuggestPayload\(note\.body\)/g) || []).length === 2, label + ' create/update 双挂点')
      assert(src.indexOf('body !== undefined && secretDetectEnabled()') >= 0, label + ' update 仅携带正文才建议 + 开关闸')
    }
  })

  // ===== 132.5 一键标记契约（wrapSecretLines 行为级：建议行 → fence → S1/S2 保护链路接通）=====
  const NSW = {}
  new Function('ns', ekSrc + '\n' + sensBlk[0] + '\nns.wrapSecretLines=wrapSecretLines; ns.parseSecretSpans=parseSecretSpans; ns.maskSecretSpans=maskSecretSpans;')(NSW)
  await t('S4 一键标记契约：wrapSecretLines 包 fence → parseSecretSpans 恰好覆盖命中行 + maskSecretSpans 打码生效（S2 接通）+ 非法行号零改写', () => {
    const body = '公开开头\npassword=MarkMe99\n公开中段\nAWS_KEY = AKIAIOSFODNN7EXAMPLE\n公开结尾'
    const sug = NS132.suggestSecretSpans(body)
    const lines = []
    sug.forEach((rg) => { for (let li = rg.sLine; li <= rg.eLine; li++) lines.push(li) })
    const w = NSW.wrapSecretLines(body, lines)
    assert(w.count === 2, '两独立区间各一段 fence')
    const spans = NSW.parseSecretSpans(w.body)
    assert(spans.length === 2, '标记后 parseSecretSpans 恰好识别 2 段（建议→fence→span 一致性）')
    const masked = NSW.maskSecretSpans(w.body)
    assert(masked.indexOf('MarkMe99') < 0 && masked.indexOf('AKIAIOSFODNN7EXAMPLE') < 0, '一键标记后 S2 打码生效（凭据永不外泄）')
    assert(masked.indexOf('公开开头') >= 0 && masked.indexOf('公开结尾') >= 0, '良性内容照常保留')
    // 非法/空行号：零改写原样返回（防御：响应行号与本地正文竞态漂移；parseFloat 形态 2.5 会 parseInt 截断为 2——按整行号语义接受）
    assert(NSW.wrapSecretLines(body, []).count === 0 && NSW.wrapSecretLines(body, []).body === body, '空行号零改写')
    assert(NSW.wrapSecretLines(body, [99, 0, -3, NaN, 6]).count === 0 && NSW.wrapSecretLines(body, [99, 0, -3, NaN, 6]).body === body, '越界/非法行号零改写（防御）')
    assert(NSW.wrapSecretLines(body, [2, 2, 2]).count === 1, '重复行号去重后单区间')
  })

  // ===== 132.6 双端同构静态锚：建议横幅（app + client）+ 忽略静默 + 面板机密岛交互同构 =====
  await t('S4 双端同构静态锚：建议横幅 app/client 双端 + 一键标记/忽略 + 忽略静默（本篇本次内存态）+ 面板 blur 块交互同构', () => {
    const appEd = read('src/app/panels/editor.js')
    assert(appEd.indexOf('id="secretSug"') >= 0 && appEd.indexOf('markSecretSuggested') >= 0 && appEd.indexOf('ignoreSecretSuggested') >= 0, 'app 编辑器：横幅 markup + 一键标记/忽略执行体')
    assert(appEd.indexOf('secretSuggestIgnored[secretSuggestKey(') >= 0, 'app 忽略记账（本篇本次静默——非持久忽略表）')
    assert(appEd.indexOf('showSecretSuggest(res)') >= 0 && appEd.indexOf('res.secretSuggested') >= 0, 'app doSave 响应消费建议')
    assert(read('src/app/modals/newnote.js').indexOf('showSecretSuggest(res)') >= 0, 'app 草稿落库响应接横幅')
    const cliEd = read('src/client/panels/panel/editor.js')
    assert(cliEd.indexOf('dsh-notes-secret-sug') >= 0 && cliEd.indexOf('doSecretMarkAll') >= 0 && cliEd.indexOf('doSecretIgnore') >= 0, 'client 编辑器：横幅 JSX + 一键标记/忽略')
    assert(cliEd.indexOf('secretSugIgnoredRef.current[') >= 0, 'client 忽略记账（React ref 内存态）')
    assert(cliEd.indexOf('res.secretSuggested') >= 0, 'client doSave 响应消费建议')
    // 一键标记双端单源：wrapSecretLines 经内核（零第二份分组算法）
    assert(appEd.indexOf('wrapSecretLines(edNote.body') >= 0 && cliEd.indexOf('wrapSecretLines(edBodyRef.current') >= 0, '双端一键标记都调内核 wrapSecretLines（单一事实源）')
    // 面板机密岛交互同构（S1 范围边界收口）：揭示/回糊/取消机密 + 计时器单飞
    assert(cliEd.indexOf('function bindPanelSecret') >= 0 && cliEd.indexOf('armPanelSecretReveal') >= 0 && cliEd.indexOf('function unmarkPanelSecret') >= 0, 'client 机密岛交互三件套（bind/reveal 计时器/unmark）')
    assert(cliEd.indexOf('SECRET_REVEAL_MS = 10000') >= 0, 'client 揭示驻留节拍与 app 相同（~10s 自动回糊）')
    assert(cliEd.indexOf("pre.classList.contains('dsh-secret-static')") >= 0, 'client 静态占位岛不挂交互（S1 保守面口径延续）')
    const css = read('src/styles.css')
    assert(css.indexOf('.dsh-notes-rich pre.dsh-notes-secret.revealed > code{filter:none}') >= 0 && css.indexOf('.dsh-notes-rich pre.dsh-notes-secret .secret-unmark') >= 0, 'client 样式：面板揭示态 + 取消机密钮（app head.html 镜像）')
    const appHead = read('src/app/shell/head.html')
    assert(appHead.indexOf('.deg .sug-act') >= 0 && appHead.indexOf('.deg .sug-ignore') >= 0, 'app 横幅动作钮样式')
    assert(css.indexOf('.dsh-notes-deg .dsh-notes-sug-act') >= 0, 'client 横幅动作钮样式')
  })

  // ===== 132.7 原型同步 + README 双语键落位 + e2e mock/用例同步 =====
  await t('S4 收口同步：原型横幅/设置行/mock 检测在案 + README 双语自动检测键落位 + e2e mock 契约与用例 63 在册', () => {
    const proto = read('design/notes-ui-v2.html')
    assert(proto.indexOf('id="secretSug"') >= 0 && proto.indexOf('markSecretSuggested') >= 0, '原型：建议横幅 + 一键标记规格在案')
    assert(proto.indexOf('secretdetect') >= 0 && proto.indexOf('setSecretDetect') >= 0, '原型：设置行登记（SET_GROUPS/data-sec）+ 开关接线（#setSecretDetect）')
    assert(proto.indexOf('_mockSecretSuggest') >= 0, '原型：mock 检测器在案（开关门控 + fence 排除契约同 host）')
    for (const [label, p, zh] of [['README.md', 'README.md', true], ['README.en.md', 'README.en.md', false], ['packages README.md', 'packages/dsh-notes-plugin/README.md', true], ['packages README.en.md', 'packages/dsh-notes-plugin/README.en.md', false]]) {
      const r = read(p)
      if (zh) assert(r.indexOf('保存时自动检测') >= 0 && r.indexOf('一键标记') >= 0, label + ' 机密条目含「保存时自动检测…一键标记」（自动检测建议）')
      else assert(r.indexOf('on-save auto-detection') >= 0 && r.indexOf('one-click mark') >= 0, label + ' secret entry covers on-save auto-detection + one-click mark')
      if (zh) assert(r.indexOf('「数据与存储」组开关') >= 0, label + ' 含开关面表述（设置组锚）')
      else assert(r.indexOf('Data & Storage') >= 0, label + ' 含开关面表述（settings group anchor）')
    }
    const mock = fsNative.readFileSync(path.join(DIR, 'scripts', 'e2e', 'server.cjs'), 'utf8')
    assert(mock.indexOf('function mockSecretSuggest') >= 0 && mock.indexOf('r.secretSuggested = sugC') >= 0 && mock.indexOf('r.secretSuggested = sugU') >= 0, 'e2e mock：create/update 双挂点建议（契约同 host）')
    assert(mock.indexOf('sd && sd.enabled === false') >= 0, 'e2e mock：设置开关门控（关 = 零建议字段）')
    assert(fsNative.existsSync(path.join(DIR, 'scripts', 'e2e', 'cases', '63-secret-autodetect.cjs')), 'e2e 用例 63 在册')
  })
  },
}
