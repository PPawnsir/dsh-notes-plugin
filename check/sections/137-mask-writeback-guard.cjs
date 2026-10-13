// 节 137. 掩码态正文回写守卫（notes-062-mask-writeback-guard：写路径机密占位符检出即拒绝 + 自救指引；
//   notes-063-mask-guard-sensitive 扩面：行级敏感值占位（sensitive 打码行形态）同构回写洞纳入同一守卫——062 遗留裁决，主窗口裁=扩·同洞同药，不设开关/白名单）
// 背景（P1 数据安全，反馈 n-mv73xcobo118；巡检会话 2026-10-13 自伤事故实证，工作日志 n-mv5kda4fdoqn 09:40 续实录）：
//   遮蔽体系护住全部读面（S2 十面 + S3 门禁），写路径零防御——agent 对含机密区笔记 note_get（缺省掩码）→ 掩码态正文
//   原样 update 回写 → 机密区围栏被占位单行物理替换、机密内容盘上消失（零报错，靠 .history 快照救回）。
//   「读掩码→写回」是 agent 最自然的往返（拿到什么存什么），本节锁死这条写路径。
//   063 同构洞：注入文本里 sensitive=true 笔记的行级打码值（机器占位形态）被 agent 原样回写 → 真值被星号占位物理替换（静默丢密）——同一守卫覆盖。
// 覆盖面：
//   ① 行为级（update 往返）：建含 span 笔记 → note_get 掩码读 → 掩码正文 notes-update 回写 = 拒绝 + 盘上文件逐字节不动
//      （前后字节比对）+ 读回正文原样；note_manage 工具面同闸（事故原始路径）。
//   ② 行为级（create）：掩码正文 notes-create / note_manage.create = 拒绝 + 零落盘（列表查无）。
//   ③ 零误拦：正常 update（无占位符）/ meta-only 更新（body 缺省）/ 散文提及（非数字行数形态）照常放行；
//      行级敏感占位 062 期放行（范围锚）→ 063 翻转为拦截（同洞同药，翻转注明）。
//   ④ 错误文案自救指引锚：note_get / reveal:true / 不传 body + 行级形态说明（063：敏感篇原文 note_get 直取）。
//   ⑤ 同源锚：判定复用 sensitive-helpers.js 导出（占位形态常量单一事实源——两种形态字面量各仅 1 处=常量定义）；
//      notes.js/notes.dist.js 零占位字面量 + 守卫接线各 3 处（定义+create+update）；
//      守卫标记块双包逐字节一致（hostSrc ⇄ indexSrc，需先跑 build-dist）。
//   ⑥ 行为级（063 sensitive 往返）：sensitive 笔记注入打码形态（真实注入预览面取证）回写 = 拒绝 + 自救锚 + 盘上原文逐字节不动 + 工具面同闸。
//   ⑦ 零误拦（063）：含 ****** 字样但非占位形态（密码强度示意/裸星号值/半身形态散文）照常放行——判定锚完整机器形态（含「敏感」+获取指引后缀+n- 形态 id 段）而非裸星号。
// 红线：只加守卫不改遮蔽/揭示/门禁既有语义；占位形态本身不动（发生器输出逐字节不变）；错误=throw 错得安全，不做静默剥离；
//      不设白名单/开关（数据安全闸不设旁路）。
module.exports = {
  id: "137",
  title: "137. 掩码态正文回写守卫（notes-062-mask-writeback-guard + notes-063-mask-guard-sensitive 扩面）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { handlers, findTool, store, NOTES_DIR } = S
  section('137. 掩码态正文回写守卫（notes-062 + notes-063 扩面）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const FENCE = '```secret'

  // ===== 137.1 判定函数行为级（sensitive-helpers 标记块 + @shared span 切片合并 eval——host 作用域内形态，同 130.1 模式）=====
  const ekSrc = read('src/shared/editor-kernel.js')
  const s0 = ekSrc.indexOf('// ===== secret-span BEGIN'), s1 = ekSrc.indexOf('// ===== secret-span END') + '// ===== secret-span END'.length
  assert(s0 >= 0 && s1 > s0, 'editor-kernel.js 含 secret-span 标记区间')
  const spanSlice = ekSrc.slice(s0, s1)
  const sensBlk = hostSrc.match(/\/\/ ==== sensitive-helpers BEGIN ====[\s\S]*?\/\/ ==== sensitive-helpers END ====/)
  assert(sensBlk, 'host 拼接缺 sensitive-helpers 标记块')
  const NS137 = {}
  new Function('ns', spanSlice + '\n' + sensBlk[0] + '\nns.hasMaskedSecretPlaceholder=hasMaskedSecretPlaceholder; ns.hasMaskedSensitivePlaceholder=hasMaskedSensitivePlaceholder; ns.hasMaskedPlaceholder=hasMaskedPlaceholder; ns.secretSpanPlaceholder=secretSpanPlaceholder; ns.maskSecretSpans=maskSecretSpans; ns.sensitivePlaceholder=sensitivePlaceholder; ns.maskSensitiveBody=maskSensitiveBody;')(NS137)
  await t('137 判定函数行为级：发生器输出恒命中（同源闭环）+ 占位形态不变红线 + 良性/空/undefined/散文零误判 + maskSecretSpans 产物恒命中', () => {
    // 占位形态不变红线（改形态会破 S2 注入面——发生器输出逐字节锁定）
    assert.strictEqual(NS137.secretSpanPlaceholder(4), '🔒 机密区（4 行，note_get reveal 获取）', '占位形态逐字节不变（红线）')
    // 发生器/判定同源闭环：发生器产物恒被判定命中
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder(NS137.secretSpanPlaceholder(4)), true, '发生器输出恒命中（共用形态常量）')
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder(NS137.secretSpanPlaceholder(12)), true, '多位行数命中')
    // 读面掩码产物 = 守卫识别形态（往返闭环：note_get 掩码态正文必被写路径拦下）
    const masked = NS137.maskSecretSpans('良行\n' + FENCE + '\nWB137KEY\n```\n尾行')
    assert(masked.indexOf('WB137KEY') < 0 && NS137.hasMaskedSecretPlaceholder(masked) === true, 'maskSecretSpans 产物恒命中（note_get 掩码正文必被拦）')
    // 多行正文中间命中 / 多占位命中
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder('甲\n🔒 机密区（3 行，note_get reveal 获取）\n乙'), true, '多行正文中间命中')
    // 零误判面：良性 / 空 / undefined / null / 散文提及（非数字行数）/ 半身形态
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder('普通正文'), false, '良性正文零误判')
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder(''), false, '空串零误判')
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder(undefined), false, 'undefined 零误判（meta-only 更新放行语义）')
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder(null), false, 'null 零误判')
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder('散文提及 🔒 机密区（若干 行，note_get reveal 获取）的写法'), false, '非数字行数散文提及零误判（误伤防御）')
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder('🔒 机密区（'), false, '仅前缀不命中')
    assert.strictEqual(NS137.hasMaskedSecretPlaceholder('🔒 机密区（4a 行，note_get reveal 获取）'), false, '行数段含非数字不命中')
  })

  // ===== 137.1b 判定函数行为级·063 扩面：行级敏感占位双形态识别（发生器同源闭环 + 误伤防御锚完整机器形态而非裸星号）=====
  await t('137 判定函数双形态（063 扩面）：行级发生器输出恒命中 + maskSensitiveBody 产物恒命中 + 双形态并 + 裸星号/散文/半身形态零误判', () => {
    // 行级占位形态不变红线（发生器输出逐字节锁定——注入面 27-5/32/90 等多节同形态断言）
    assert.strictEqual(NS137.sensitivePlaceholder('n-x'), '******（敏感，note_get n-x 获取）', '行级占位形态逐字节不变（红线）')
    // 发生器/判定同源闭环：发生器产物恒被判定命中
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder(NS137.sensitivePlaceholder('n-x')), true, '行级发生器输出恒命中（共用形态常量）')
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder(NS137.sensitivePlaceholder('n-mut4eqwtxkhk')), true, '真实 genId 形态 id 命中')
    // 注入打码产物 = 守卫识别形态（往返闭环：sensitive 笔记注入掩码行回写必被拦）
    const maskedLine = NS137.maskSensitiveBody('password: WB137REALK3Y', 'n-q9z')
    assert(maskedLine.indexOf('WB137REALK3Y') < 0 && NS137.hasMaskedSensitivePlaceholder(maskedLine) === true, 'maskSensitiveBody 产物恒命中（注入掩码行必被拦）')
    // 多行正文中间命中
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder('甲\n密码: ******（敏感，note_get n-x 获取）\n乙'), true, '多行正文中间命中')
    // 双形态并：任一形态命中即 true；良性不命中
    assert.strictEqual(NS137.hasMaskedPlaceholder(NS137.secretSpanPlaceholder(4)), true, 'span 形态命中双形态并（062 面不回退）')
    assert.strictEqual(NS137.hasMaskedPlaceholder('密码: ******（敏感，note_get n-x 获取）'), true, '行级形态命中双形态并（063 面）')
    assert.strictEqual(NS137.hasMaskedPlaceholder('普通正文'), false, '良性正文双形态并零误判')
    assert.strictEqual(NS137.hasMaskedPlaceholder(undefined), false, 'undefined 双形态并零误判（meta-only 放行语义）')
    // 零误判面（误伤防御=锚完整机器形态而非裸星号）：裸星号强度示意 / 裸星号值 / 仅前缀 / 空 id / 非 id 形态中段 / 非 n- 前缀 / null
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder('密码强度: ******（6 位以上，含大小写）'), false, '裸星号强度示意零误判')
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder('密码: ******'), false, '裸星号值零误判')
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder('******（敏感，note_get '), false, '仅前缀不命中')
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder('******（敏感，note_get 获取）'), false, '空 id 不命中')
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder('******（敏感，note_get 我的密码 获取）'), false, '非 id 形态中段（中文）不命中')
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder('******（敏感，note_get abc 获取）'), false, '非 n- 前缀 id 段不命中（锚发生器产物形态）')
    assert.strictEqual(NS137.hasMaskedSensitivePlaceholder(null), false, 'null 零误判')
  })

  // ===== 137.2 ① 行为级：note_get 掩码读 → update 回写往返 = 拒绝 + 盘上逐字节不动（RPC 面 + 工具面双闸）=====
  const ORIG137 = '良行甲\n\n' + FENCE + '\nWB137SECRET\n```\n\n良行乙'
  const c137 = await handlers['notes-create']({ title: 'WB137 掩码回写源', body: ORIG137 })
  assert(c137 && c137.id && !c137.error, '137 夹具建笔记（实得 ' + JSON.stringify(c137).slice(0, 120) + '）')
  const rawPath137 = path.join(NOTES_DIR, c137.id + '.md')
  const rawBefore = store.get(rawPath137)
  assert(rawBefore && rawBefore.indexOf(FENCE) >= 0 && rawBefore.indexOf('WB137SECRET') >= 0, '夹具盘上含机密围栏原文')
  await t('137 ① 掩码回写往返拒绝：note_get 掩码正文 notes-update 回写 = 拒绝 + 自救指引锚 + 盘上文件逐字节不动 + 读回原样', async () => {
    const noteGet = findTool('note_get')
    const g = await noteGet.execute({ id: c137.id })
    assert(g.note.body.indexOf('WB137SECRET') < 0 && g.note.spanCount === 1, 'note_get 缺省掩码（往返起点成立）')
    assert(NS137.hasMaskedSecretPlaceholder(g.note.body) === true, '掩码态正文含占位符（守卫识别形态确认）')
    // 事故原始动作：掩码正文原样回写
    const rej = await handlers['notes-update']({ id: c137.id, body: g.note.body })
    assert(rej && rej.error, '掩码正文回写被拒绝（实得 ' + JSON.stringify(rej) + '）')
    // ④ 自救指引锚
    assert(rej.error.indexOf('掩码占位符') >= 0 && rej.error.indexOf('note_get') >= 0, '错误文案含 掩码占位符/note_get 锚：' + rej.error)
    assert(rej.error.indexOf('reveal:true') >= 0, '错误文案含 reveal:true 自救锚：' + rej.error)
    assert(rej.error.indexOf('不传 body') >= 0, '错误文案含 meta-only 出路锚：' + rej.error)
    // 盘上逐字节不动（拒绝先于 persist，含 .history 零新增快照语义——raw 全文比对）
    assert.strictEqual(store.get(rawPath137), rawBefore, '拒绝后盘上文件逐字节不动')
    const back = await handlers['notes-get']({ id: c137.id })
    assert.strictEqual(back.note.body, ORIG137, '读回正文逐字节原样（机密围栏健在）')
    // 工具面同闸（事故原始路径 = note_manage update）
    const rejM = await findTool('note_manage').execute({ action: 'update', id: c137.id, body: g.note.body })
    assert(rejM && rejM.error && rejM.error.indexOf('掩码占位符') >= 0, 'note_manage update 同闸拒绝（实得 ' + JSON.stringify(rejM).slice(0, 160) + '）')
    assert.strictEqual(store.get(rawPath137), rawBefore, '工具面拒绝后盘上仍逐字节不动')
  })

  // ===== 137.3 ② 行为级：掩码正文 create = 拒绝 + 零落盘（RPC 面 + 工具面）=====
  await t('137 ② 掩码正文建笔记拒绝：notes-create / note_manage.create 双闸 + 零落盘', async () => {
    const MASKED = '粘来的掩码正文\n🔒 机密区（4 行，note_get reveal 获取）\n尾巴'
    const rejC = await handlers['notes-create']({ title: 'WB137 掩码新建RPC', body: MASKED })
    assert(rejC && rejC.error && rejC.error.indexOf('掩码占位符') >= 0 && rejC.error.indexOf('reveal:true') >= 0, 'notes-create 拒绝 + 指引锚（实得 ' + JSON.stringify(rejC).slice(0, 160) + '）')
    const rejMC = await findTool('note_manage').execute({ action: 'create', title: 'WB137 掩码新建工具', body: MASKED })
    assert(rejMC && rejMC.error && rejMC.error.indexOf('掩码占位符') >= 0, 'note_manage.create 同闸拒绝（实得 ' + JSON.stringify(rejMC).slice(0, 160) + '）')
    const lst = await handlers['notes-list']({})
    assert(!lst.notes.find(n => n.title === 'WB137 掩码新建RPC') && !lst.notes.find(n => n.title === 'WB137 掩码新建工具'), '拒绝后零落盘（列表查无两篇）')
  })

  // ===== 137.4 ③ 零误拦：正常 update / meta-only / 散文提及 放行 + 行级 ****** 敏感占位 063 翻转=拦截 =====
  await t('137 ③ 零误拦：正常正文 update 放行 + meta-only 更新放行（围栏不动）+ 散文提及放行 + 行级敏感占位翻转拦截（063）', async () => {
    // 正常 update（无占位符）不受阻——对 137.2 的 span 夹具做合法正文改写
    const okU = await handlers['notes-update']({ id: c137.id, body: 'WB137 合法改写后正文（无机密）' })
    assert(okU && !okU.error, '正常 update 放行（实得 ' + JSON.stringify(okU).slice(0, 120) + '）')
    const gOk = await handlers['notes-get']({ id: c137.id })
    assert.strictEqual(gOk.note.body, 'WB137 合法改写后正文（无机密）', '合法改写落盘')
    // meta-only 更新（body 缺省）不受阻——另建 span 笔记验证正文不动
    const c2 = await handlers['notes-create']({ title: 'WB137 meta-only 源', body: FENCE + '\nWB137META\n```' })
    const okM = await handlers['notes-update']({ id: c2.id, title: 'WB137 meta-only 改题' })
    assert(okM && !okM.error, 'meta-only 更新放行（body 缺省不触守卫）')
    const gM = await handlers['notes-get']({ id: c2.id })
    assert(gM.note.body.indexOf('WB137META') >= 0 && gM.note.title === 'WB137 meta-only 改题', 'meta-only 正文逐字节不动 + 标题已改')
    // 散文提及（非数字行数形态）不拦——用户手记该措辞的极端场景出路（报错文案亦指明换措辞）
    const c3 = await handlers['notes-create']({ title: 'WB137 散文提及', body: '笔记：掩码形态写作 🔒 机密区（若干 行，note_get reveal 获取）样式' })
    assert(c3 && c3.id && !c3.error, '散文提及（非数字行数）放行不误拦')
    // 【063 翻转·notes-063-mask-guard-sensitive】062 期本条为「行级 ****** 敏感占位不拦（范围锚：守卫只认机密区 span 占位形态）」——
    //   主窗口裁决扩面（同洞同药）：行级敏感占位回写同构往返洞纳入守卫，本条翻转为「拦」。
    const rej4 = await handlers['notes-create']({ title: 'WB137 行级占位', body: '密码: ******（敏感，note_get n-x 获取）' })
    assert(rej4 && rej4.error && rej4.error.indexOf('掩码占位符') >= 0, '行级 ****** 敏感占位回写拦截（063 翻转：原 062 范围锚「不拦」作废，实得 ' + JSON.stringify(rej4).slice(0, 160) + '）')
    const lst4 = await handlers['notes-list']({})
    assert(!lst4.notes.find(n => n.title === 'WB137 行级占位'), '行级占位拦截后零落盘（063）')
  })

  // ===== 137.5 ⑤ 同源锚 + 双包同步静态断言 =====
  await t('137 ⑤ 同源锚：判定函数 sensitive-helpers 单源导出（两形态占位字面量各仅 1 处=常量定义）+ notes 双变体零占位字面量 + 守卫接线各 3 处 + 标记块双包逐字节一致（063 扩面）', () => {
    const sens = read('src/host/inject/sensitive-helpers.js')
    assert(sens.indexOf('function hasMaskedSecretPlaceholder') >= 0, 'sensitive-helpers 导出判定函数 hasMaskedSecretPlaceholder')
    assert(sens.indexOf('const SECRET_PLACEHOLDER_PREFIX =') >= 0 && sens.indexOf('const SECRET_PLACEHOLDER_SUFFIX =') >= 0, '占位形态前后缀常量在案')
    assert.strictEqual((sens.match(/🔒 机密区（/g) || []).length, 1, '占位字面量全文件仅 1 处（常量定义=单一事实源；发生器/判定共用，零第二份形态）')
    assert(sens.indexOf("function secretSpanPlaceholder(lineCount) { return SECRET_PLACEHOLDER_PREFIX + lineCount + SECRET_PLACEHOLDER_SUFFIX }") >= 0, '发生器走常量（无内联字面量拼接）')
    // 063 扩面同源锚：行级占位形态常量单源（字面量全文件仅 1 处=常量定义）+ 行级发生器走常量 + 行级判定/双形态并导出在案
    assert(sens.indexOf('const SENSITIVE_PLACEHOLDER_PREFIX =') >= 0 && sens.indexOf('const SENSITIVE_PLACEHOLDER_SUFFIX =') >= 0, '行级占位形态前后缀常量在案（063 单源）')
    assert.strictEqual((sens.match(/\*\*\*\*\*\*（敏感，note_get /g) || []).length, 1, '行级占位字面量全文件仅 1 处（常量定义=单一事实源；发生器/判定共用，063）')
    assert(sens.indexOf('function sensitivePlaceholder(id) { return SENSITIVE_PLACEHOLDER_PREFIX + id + SENSITIVE_PLACEHOLDER_SUFFIX }') >= 0, '行级发生器走常量（无内联字面量拼接，063）')
    assert(sens.indexOf('function hasMaskedSensitivePlaceholder') >= 0 && sens.indexOf('function hasMaskedPlaceholder') >= 0, '行级判定 + 双形态并判定导出在案（063）')
    // notes 双变体：零占位字面量（识别全经导出函数，check 130 零私有正则纪律延伸）+ 接线 3 处（定义 + create + update）
    for (const [label, src] of [['src/host/notes.js', read('src/host/notes.js')], ['src/host/notes.dist.js', read('src/host/notes.dist.js')]]) {
      assert(src.indexOf('🔒 机密区（') < 0, label + ' 零占位形态字面量（守卫识别全走 sensitive-helpers 导出）')
      assert(src.indexOf('******（敏感') < 0, label + ' 零行级占位字面量（063：同 062 零字面量纪律）')
      assert(src.indexOf('if (!hasMaskedPlaceholder(body)) return') >= 0, label + ' 守卫判定走双形态并 hasMaskedPlaceholder（063）')
      assert(src.indexOf('行级敏感值占位') >= 0, label + ' 错误文案含行级形态说明（063 自救锚）')
      assert.strictEqual((src.match(/_assertNoMaskedSecretBody\(body\)/g) || []).length, 3, label + ' 守卫定义 1 + create/update 接线 2（实得 ' + ((src.match(/_assertNoMaskedSecretBody\(body\)/g) || []).length) + '）')
    }
    // 守卫标记块双包逐字节一致（hostSrc=开发版拼接 ⇄ indexSrc=静态包产物，同节 46.2 模式——改一边忘另一边当场被抓）
    const mRe = /\/\/ ==== masked-body-writeback-guard BEGIN ====[\s\S]*?\/\/ ==== masked-body-writeback-guard END ====/
    const bDev = hostSrc.match(mRe), bDist = indexSrc.match(mRe)
    assert(bDev && bDist, '开发版拼接与静态包均须含 masked-body-writeback-guard 标记块（静态包需先跑 build-dist）')
    assert.strictEqual(bDev[0], bDist[0], '标记块双包逐字节一致（notes.js ⇄ notes.dist.js）')
    // 静态包接线锚点（index.mjs 含守卫函数 + 双侧调用）
    assert.strictEqual((indexSrc.match(/_assertNoMaskedSecretBody\(body\)/g) || []).length, 3, 'index.mjs 守卫定义+双接线在案（需先跑 build-dist）')
  })

  // ===== 137.6 ⑥ 行为级（063 扩面）：sensitive 笔记注入打码形态回写 = 拒绝 + 盘上原文逐字节不动（RPC 面 + 工具面双闸）=====
  await t('137 ⑥ sensitive 注入掩码行回写拒绝（063）：真实注入预览面取证 + 回写拒绝 + 行级自救锚 + 盘上逐字节不动 + 读回原样 + 工具面同闸', async () => {
    const ORIG_SENS = '部署说明\npassword: WB137REAL63\n备注尾行'
    const cS = await handlers['notes-create']({ title: 'WB137 sensitive 源', body: ORIG_SENS, inject: true, sensitive: true })
    assert(cS && cS.id && !cS.error, '063 夹具建 sensitive+inject 笔记（实得 ' + JSON.stringify(cS).slice(0, 120) + '）')
    const rawPathS = path.join(NOTES_DIR, cS.id + '.md')
    const rawBeforeS = store.get(rawPathS)
    assert(rawBeforeS && rawBeforeS.indexOf('WB137REAL63') >= 0, '夹具盘上含真值原文')
    // 真实注入渲染面取证：agent 在系统提示注入文本里看到的打码行（约定桶永不截断，137 为末节零外溢）
    const prev = await handlers['notes-inject-preview']({})
    const maskedLineS = 'password: ******（敏感，note_get ' + cS.id + ' 获取）'
    assert(prev && !prev.error && prev.conventions.indexOf(maskedLineS) >= 0, '注入预览含打码行（往返起点=真实注入面）')
    assert(prev.conventions.indexOf('WB137REAL63') < 0, '注入预览不含明文真值')
    // 事故原始动作：把注入文本里看到的打码正文原样回写（掩码正文与注入面同一发生器产物，逐字节同形态）
    const maskedBodyS = NS137.maskSensitiveBody(ORIG_SENS, cS.id)
    assert(maskedBodyS.indexOf(maskedLineS) >= 0 && NS137.hasMaskedPlaceholder(maskedBodyS) === true, '掩码正文=守卫识别形态（双形态并确认）')
    const rejS = await handlers['notes-update']({ id: cS.id, body: maskedBodyS })
    assert(rejS && rejS.error && rejS.error.indexOf('掩码占位符') >= 0 && rejS.error.indexOf('note_get') >= 0, '注入打码形态回写拒绝 + 指引锚（实得 ' + JSON.stringify(rejS).slice(0, 200) + '）')
    assert(rejS.error.indexOf('行级敏感值占位') >= 0 && rejS.error.indexOf('reveal:true') >= 0 && rejS.error.indexOf('不传 body') >= 0, '错误文案含行级形态说明 + 双自救锚（063）')
    // 盘上逐字节不动（拒绝先于 persist）+ 读回原文原样
    assert.strictEqual(store.get(rawPathS), rawBeforeS, '拒绝后盘上文件逐字节不动')
    const backS = await handlers['notes-get']({ id: cS.id })
    assert.strictEqual(backS.note.body, ORIG_SENS, '读回正文逐字节原样（敏感真值健在）')
    // 工具面同闸（note_manage update = 事故原始路径之一）
    const rejSM = await findTool('note_manage').execute({ action: 'update', id: cS.id, body: maskedBodyS })
    assert(rejSM && rejSM.error && rejSM.error.indexOf('掩码占位符') >= 0, 'note_manage update 同闸拒绝（063，实得 ' + JSON.stringify(rejSM).slice(0, 160) + '）')
    assert.strictEqual(store.get(rawPathS), rawBeforeS, '工具面拒绝后盘上仍逐字节不动')
  })

  // ===== 137.7 ⑦ 零误拦（063）：含 ****** 字样但非占位形态（密码强度示意等）照常放行——判定锚完整机器形态而非裸星号 =====
  await t('137 ⑦ 零误拦（063）：裸星号强度示意 / 裸星号值 / 半身形态散文 照常放行', async () => {
    const ok1 = await handlers['notes-create']({ title: 'WB137 星号示意', body: '密码强度: ******（6 位以上，含大小写）\n进度条 ****** 60%' })
    assert(ok1 && ok1.id && !ok1.error, '裸星号强度示意放行不误拦（实得 ' + JSON.stringify(ok1).slice(0, 120) + '）')
    const ok2 = await handlers['notes-create']({ title: 'WB137 星号值', body: '密码: ******' })
    assert(ok2 && ok2.id && !ok2.error, '裸星号值（无「敏感」+获取指引后缀形态）放行')
    const ok3 = await handlers['notes-create']({ title: 'WB137 半身形态', body: '说明：旧文案曾写作 ******（敏感，note_get 获取）字样' })
    assert(ok3 && ok3.id && !ok3.error, '空 id 半身形态散文放行')
    // 合法正文 update 含裸星号同样放行（对 ok2 夹具改写）
    const ok4 = await handlers['notes-update']({ id: ok2.id, body: '密码: ******\n强度：****** 六星' })
    assert(ok4 && !ok4.error, '含裸星号正文 update 放行不误拦')
  })
  },
}
