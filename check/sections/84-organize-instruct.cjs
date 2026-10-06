// 节 84. 0.4.4-F AI 整理可选追加指令（弹卡引导）（notes-044-organize-instruct）
// 契约：notes-ai-organize 增 args.instruction（string 可选，trim 后 ≤500 字，超限 error 不落 prompt）；
//   有才在【当前草稿】前插【用户追加指令】\n<instruction>\n 段；空/缺省路径 prompt 与二期现行逐字节等价（本节行为级锁定）；system 提示词不动。
//   UI 双端：点「整理」先弹引导卡（textarea + 确认/取消；取消/点遮罩零副作用，Esc 走既有 modalHost 统一口径——app 自动覆盖）；
//   确认复用 doAiOrganize 全部守卫/一次撤销栈/容错，仅 RPC payload 多带 instruction 字段。
//   原型 notes-ui-v2.html 第四端硬性同步（DEVELOPMENT.md「UI 改动同步约定」：原型 = UI 唯一规格来源，84.6 锚点锁定）。
module.exports = {
  id: "84",
  title: "84. 0.4.4-F AI 整理可选追加指令（弹卡引导，notes-044-organize-instruct）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, clientSrc, indexSrc } = H
  const { NOTES_DIR, admMock, agentsMock, appSrc, clientPkgSrc, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('84. 0.4.4-F AI 整理可选追加指令（弹卡引导）')

  // ---- 84.1 host 双侧静态契约（开发版拼接产物 + 发布包 index.mjs）----
  await t('host 双侧：_aiOrganize 增 instruction 解析（string 可选 + trim）+ 500 上限常量 + 超限 error', () => {
    for (const pair of [['host-src', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf("const instruction = args && typeof args.instruction === 'string' ? args.instruction.trim() : ''") >= 0, pair[0] + ' instruction 解析行')
      assert(s.indexOf('const AI_ORGANIZE_INSTR_MAX_CHARS = 500') >= 0, pair[0] + ' 追加指令上限常量 500')
      assert(s.indexOf("instruction.length > AI_ORGANIZE_INSTR_MAX_CHARS") >= 0 && s.indexOf('追加指令过长（') >= 0, pair[0] + ' 超限 error（不落 prompt）')
    }
  })
  await t('host 双侧：prompt 插入点位源码锁——【用户追加指令】段仅在【当前草稿】前条件插入（空 = 逐字节等价二期现行）', () => {
    for (const pair of [['host-src', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      const frag = "(instruction ? '【用户追加指令】\\n' + instruction + '\\n' : '') +\n        '【当前草稿】\\n' + body + '\\n\\n只输出重写后的 Markdown 正文：'"
      assert(s.indexOf(frag) >= 0, pair[0] + ' 插入表达式紧随【当前草稿】拼接（三元空串 = 无指令路径逐字节等价）')
      assert(s.indexOf("(title ? '【笔记标题】' + title + '\\n' : '') +\n        (instruction ?") >= 0, pair[0] + ' 插入点在【笔记标题】之后、【当前草稿】之前')
      assert((s.match(/你是笔记整理助手。把笔记草稿按指定类型的模板结构化重写为 Markdown，只输出重写后的正文本身。/g) || []).length === 1, pair[0] + ' system 提示词原文不动（仍一处）')
    }
  })

  // ---- 84.2 host 行为级：独立实例 + 捕获 prompt 的 llm mock（notes-ai-organize 全矩阵）----
  const storeOI = new Map()
  const fsMockOI = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeOI.has(p) ? { file: true } : null)),
    listDir: async () => [],
    readText: async (p) => { if (!storeOI.has(p)) throw new Error('ENOENT: ' + p); return storeOI.get(p) },
    writeText: async (p, c) => { storeOI.set(p, c) },
  }
  const promptsOI = []
  const llmMockOI = {
    stream: async function* (req) {
      const msg = req && req.messages && req.messages[0]
      const txt = msg && msg.content && msg.content[0] && msg.content[0].type === 'text' ? msg.content[0].text : ''
      promptsOI.push({ system: (req && req.system) || '', text: txt })
      yield { type: 'text-delta', text: '## 整理结果\n\n已按指令整理\n' }
      yield { type: 'finish' }
    },
    listProviders: () => [],
    listModels: async () => [],
  }
  const handlersOI = {}
  const harnessMockOI = { handle: (name, fn) => { handlersOI[name] = fn; return () => { delete handlersOI[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockOI, DIR).apply({
    fs: fsMockOI, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMockOI, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })

  await t('行为①：无 instruction 路径 prompt 逐字节等价（缺省/空串/纯空白三态同构 + 无【用户追加指令】段 + 现行锚点序位）', async () => {
    const args = { body: '方案对比草稿：A 便宜 B 快', kind: 'decision', title: '选型' }
    const r0 = await handlersOI['notes-ai-organize'](args)
    const r1 = await handlersOI['notes-ai-organize'](Object.assign({}, args, { instruction: '' }))
    const r2 = await handlersOI['notes-ai-organize'](Object.assign({}, args, { instruction: '   \n  ' }))
    assert(r0.ok && r1.ok && r2.ok, '三态均走 ok 路径')
    assert.strictEqual(promptsOI.length, 3, '三次调用均捕获 prompt')
    const p0 = promptsOI[0].text
    assert.strictEqual(promptsOI[1].text, p0, 'instruction:\'\' 与缺省逐字节一致')
    assert.strictEqual(promptsOI[2].text, p0, 'instruction 纯空白（trim 后空）与缺省逐字节一致')
    assert(p0.indexOf('【用户追加指令】') < 0, '无指令 prompt 不含【用户追加指令】段')
    // 现行（二期）结构锚点序位 + 尾部逐字节锁定：规则 → 模板示例 → 本篇类型 → 笔记标题 → 当前草稿 → 收尾
    const order = ['【重写规则】', '【模板示例】', '【本篇类型】决策（kind=decision）\n【笔记标题】选型\n【当前草稿】\n']
    let pos = -1
    for (const a of order) { const i = p0.indexOf(a); assert(i > pos, '锚点序位：' + a.slice(0, 12) + '（实得 ' + i + '）'); pos = i }
    assert(p0.endsWith('【当前草稿】\n' + args.body + '\n\n只输出重写后的 Markdown 正文：'), '草稿段与收尾逐字节（实得尾 60 字 ' + JSON.stringify(p0.slice(-60)) + '）')
    assert(promptsOI[0].system.indexOf('笔记整理助手') >= 0, 'system 提示词照旧（整理助手）')
  })
  await t('行为②：有 instruction → prompt = 无指令版在【当前草稿】前插入【用户追加指令】\\n<指令>\\n（逐字节手术关系）', async () => {
    const args = { body: '草稿正文 xyz', kind: 'note', title: '' }
    promptsOI.length = 0
    const r0 = await handlersOI['notes-ai-organize'](args)
    const r1 = await handlersOI['notes-ai-organize'](Object.assign({}, args, { instruction: '突出待办事项' }))
    const r2 = await handlersOI['notes-ai-organize'](Object.assign({}, args, { instruction: '  精简为三条结论  ' }))
    assert(r0.ok && r1.ok && r2.ok, 'ok 路径')
    const p0 = promptsOI[0].text, p1 = promptsOI[1].text, p2 = promptsOI[2].text
    const idx = p0.indexOf('【当前草稿】')
    assert(idx > 0, '无指令版含【当前草稿】锚点')
    assert.strictEqual(p1, p0.slice(0, idx) + '【用户追加指令】\n' + '突出待办事项' + '\n' + p0.slice(idx), '带指令 prompt = 锚点前精确插入（逐字节）')
    assert(p2.indexOf('【用户追加指令】\n精简为三条结论\n') >= 0 && p2.indexOf('  精简为三条结论') < 0, 'instruction 首尾空白被 trim 后入 prompt')
    assert(p1.indexOf('【用户追加指令】') < p1.indexOf('【当前草稿】'), '指令段在【当前草稿】之前')
  })
  await t('行为③：instruction 超 500 字（trim 后）→ error 不落 prompt；恰好 500 字放行；非字符串静默忽略', async () => {
    promptsOI.length = 0
    const e1 = await handlersOI['notes-ai-organize']({ body: '草稿', kind: 'note', instruction: 'x'.repeat(501) })
    assert(e1 && e1.error && e1.error.indexOf('追加指令过长') >= 0 && e1.error.indexOf('500') >= 0, '501 字报错引导精简（实得 ' + JSON.stringify(e1) + '）')
    const e2 = await handlersOI['notes-ai-organize']({ body: '草稿', kind: 'note', instruction: ' ' + 'x'.repeat(501) + ' ' })
    assert(e2 && e2.error && e2.error.indexOf('500') >= 0, 'trim 后仍超限同样报错')
    const ok = await handlersOI['notes-ai-organize']({ body: '草稿', kind: 'note', instruction: 'x'.repeat(500) })
    assert(ok && ok.ok === true, '恰好 500 字放行')
    const r = await handlersOI['notes-ai-organize']({ body: '草稿', kind: 'note', instruction: 123 })
    assert(r && r.ok === true, '非字符串 instruction 静默忽略')
    assert.strictEqual(promptsOI.length, 2, '超限两次未触达 LLM（不落 prompt）')
    assert(promptsOI[1].text.indexOf('【用户追加指令】') < 0, '非字符串 instruction 不入 prompt')
  })

  // ---- 84.3 client 双侧结构（开发版拼接产物 + 发布包 lib/client.js）----
  await t('client 双侧：organize-instruct modal 模块 + manifest 登记 + 按钮改开弹卡 + panelBridge 回跳 + 挂载点', () => {
    const manifestSrc = fsNative.readFileSync(path.join(DIR, 'src', 'client', 'manifest.js'), 'utf8')
    assert(manifestSrc.indexOf("'modals/organize-instruct.js',") >= 0, 'client manifest 登记 modals/organize-instruct.js')
    for (const pair of [['client-src', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("store.modal.organizeInstruct = createStore({ open: false, instr: '' })") >= 0, label + ' store.modal.organizeInstruct 切片')
      assert(s.indexOf('function openOrganizeInstruct()') >= 0 && s.indexOf('function closeOrganizeInstruct()') >= 0, label + ' 开/关弹卡函数')
      assert(s.indexOf('function OrganizeInstructModal()') >= 0 && s.indexOf('e(OrganizeInstructModal)') >= 0, label + ' 弹卡组件 + 面板挂载点')
      assert(s.indexOf('panelBridge.doAiOrganize = doAiOrganize') >= 0, label + ' 确认回跳经 panelBridge（modals 禁横向引用）')
      assert(s.indexOf('if (panelBridge.doAiOrganize) panelBridge.doAiOrganize(instr)') >= 0, label + ' 确认 = 带参回跳 doAiOrganize')
      assert(s.indexOf('if (!organizing) openOrganizeInstruct()') >= 0, label + ' 整理按钮改开弹卡（organizing 态守卫保留）')
      assert(s.indexOf('async function doAiOrganize(instruction)') >= 0, label + ' doAiOrganize 带可选 instruction 形参')
      assert(s.indexOf("'notes-ai-organize', { body: body, kind: edKindRef.current, title: edTitleRef.current, instruction: instr }") >= 0, label + ' RPC payload 带 instruction 字段')
      assert(s.indexOf("tt('editor.organizeInstructPlaceholder')") >= 0 && s.indexOf("tt('editor.organizeInstructTitle')") >= 0, label + ' 弹卡文案走 tt() 字典')
      assert(s.indexOf('organizeUndoRef.current = { body: body }') >= 0, label + ' 一次撤销栈语义不动')
    }
  })

  // ---- 84.4 app.html 同款结构 ----
  await t('app.html 同款：openOrganizeInstruct 弹卡（mask+textarea+确认/取消）+ 按钮改开弹卡 + 确认带参', () => {
    assert(appSrc.indexOf('function openOrganizeInstruct()') >= 0, 'app openOrganizeInstruct 存在')
    assert(appSrc.indexOf('id="oiInstr"') >= 0, 'app 弹卡 textarea #oiInstr')
    assert(appSrc.indexOf("$('mOrganize').onclick = function () { if (!organizing) openOrganizeInstruct() }") >= 0, 'app 整理按钮改开弹卡（organizing 守卫保留）')
    assert(appSrc.indexOf("$('oiCancel').onclick = closeModal") >= 0, 'app 取消 = 关卡零副作用')
    assert(appSrc.indexOf('closeModal(); doAiOrganize(v)') >= 0, 'app 确认 = 先关卡再带参整理')
    assert(appSrc.indexOf("rpc('notes-ai-organize', { body: body, kind: edNote.kind || 'note', title: edNote.title === 'Untitled' ? '' : (edNote.title || ''), instruction: instr })") >= 0, 'app RPC payload 带 instruction 字段')
    assert(appSrc.indexOf("t('editor.organizeInstructPlaceholder')") >= 0 && appSrc.indexOf("t('editor.organizeInstructConfirm')") >= 0, 'app 弹卡文案走 t() 字典')
    assert(appSrc.indexOf('function doAiOrganize(instruction)') >= 0, 'app doAiOrganize 带可选 instruction 形参')
  })

  // ---- 84.5 i18n 双语字典（四 key 双端同建；placeholder 注明留空走系统默认规则）----
  await t('i18n：editor.organizeInstruct* 四 key 双语同建（placeholder 注明留空=系统默认整理规则）', () => {
    const grab = (f, v) => new Function(fsNative.readFileSync(path.join(DIR, 'src', 'i18n', f), 'utf8') + '\nreturn ' + v)()
    const zh = grab('zh.js', 'I18N_ZH'), en = grab('en.js', 'I18N_EN')
    for (const k of ['editor.organizeInstructTitle', 'editor.organizeInstructPlaceholder', 'editor.organizeInstructConfirm', 'editor.organizeInstructCancel']) {
      assert(typeof zh[k] === 'string' && zh[k].length > 0, 'zh 缺 key：' + k)
      assert(typeof en[k] === 'string' && en[k].length > 0, 'en 缺 key：' + k)
    }
    assert(zh['editor.organizeInstructPlaceholder'].indexOf('留空') >= 0 && zh['editor.organizeInstructPlaceholder'].indexOf('系统默认整理规则') >= 0, 'zh placeholder 注明留空=系统默认整理规则')
    assert(en['editor.organizeInstructPlaceholder'].toLowerCase().indexOf('leave empty') >= 0, 'en placeholder 注明留空语义')
  })

  // ---- 84.6 原型 notes-ui-v2.html 第四端同步（DEVELOPMENT.md「UI 改动同步约定」硬性：原型 = UI 唯一规格来源）----
  await t('原型第四端：引导弹卡 + 按钮改开弹卡 + doAiOrganize(instruction) + mock instruction 契约（与 app.html 同构）', () => {
    const protoOI = fsNative.readFileSync(path.join(DIR, 'design', 'notes-ui-v2.html'), 'utf8')
    assert(protoOI.indexOf('function openOrganizeInstruct()') >= 0, '原型 openOrganizeInstruct 弹卡函数')
    assert(protoOI.indexOf('id="oiInstr"') >= 0, '原型弹卡 textarea #oiInstr')
    assert(protoOI.indexOf("$('oiCancel').onclick = closeModal") >= 0, '原型取消 = 关卡零副作用')
    assert(protoOI.indexOf('closeModal(); doAiOrganize(v)') >= 0, '原型确认 = 先关卡再带参整理')
    assert(protoOI.indexOf("$('mOrganize').onclick = function () { if (!organizing) openOrganizeInstruct() }") >= 0, '原型整理按钮改开弹卡（organizing 守卫保留）')
    assert(protoOI.indexOf('function doAiOrganize(instruction)') >= 0, '原型 doAiOrganize 带可选 instruction 形参（与 app.html 同签名）')
    assert(protoOI.indexOf("rpc('notes-ai-organize', { body: body, kind: edNote.kind || 'note', title: edNote.title === 'Untitled' ? '' : (edNote.title || ''), instruction: instr })") >= 0, '原型 RPC payload 带 instruction 字段（与 app.html 逐字节同构）')
    assert(protoOI.indexOf('oInstr.length > 500') >= 0 && protoOI.indexOf('追加指令过长（') >= 0, '原型 mock 镜像 host 500 字上限 error 契约')
    // 原型不双语红线（零 t() 引用，62~68 节把关）：弹卡文案硬编码 zh 且与 zh 字典同文——单一文案源防漂移
    const zhOI = new Function(fsNative.readFileSync(path.join(DIR, 'src', 'i18n', 'zh.js'), 'utf8') + '\nreturn I18N_ZH')()
    assert(protoOI.indexOf(zhOI['editor.organizeInstructTitle']) >= 0, '原型弹卡标题与 zh 字典同文')
    assert(protoOI.indexOf(zhOI['editor.organizeInstructPlaceholder']) >= 0, '原型 placeholder 与 zh 字典同文')
    assert(protoOI.indexOf('id="oiCancel">' + zhOI['editor.organizeInstructCancel'] + '</button><button class="mbtn primary" id="oiOk">' + zhOI['editor.organizeInstructConfirm'] + '</button>') >= 0, '原型取消/确认按钮文案与 zh 字典同文')
  })
  },
}
