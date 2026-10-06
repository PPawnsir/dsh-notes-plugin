// 节 27. 二期增强（AI 整理 + kind 骨架 + 资产清理 + 图片压缩）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "27",
  title: "27. 二期增强（AI 整理 + kind 骨架 + 资产清理 + 图片压缩）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, admMock, agentsMock, appSrc, clientPkgSrc, ctx, g, handlers, llmMock, plugin, protoV2Src, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  // ===== 27. 二期增强（✨整理 / kind 模板骨架 / 孤儿资产清理 / 图片压缩）=====
  // host 契约（notes-md-editor-phase2 收口）：
  //   notes-ai-organize {body,kind,title} → {ok,body} | {error}（LLM 按 kind 模板重写，不落盘，client 替换+自动保存+一次撤销栈）；
  //   notes-assets-prune {dryRun?,files?} → 预览 {orphans,totalBytes,referenced,tombstoned,notes} / 执行 {deleted,freedBytes,skipped,remaining,modes}。
  section('27. 二期增强（AI 整理 + kind 骨架 + 资产清理 + 图片压缩）')
  // ---- 27.1 host 双侧静态契约 ----
  await t('host 双侧：KIND_TEMPLATES + MACHINE_TEMPLATE + AI_ORGANIZE_MAX_CHARS 同源常量', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf('const KIND_TEMPLATES = {') >= 0, pair[0] + ' KIND_TEMPLATES 存在')
      assert(s.indexOf("'## 背景\\n\\n（问题与上下文）\\n\\n## 结论\\n\\n（最终选择）\\n\\n## 理由\\n\\n（权衡与依据）\\n'") >= 0, pair[0] + ' decision 模板（背景/结论/理由）')
      assert(s.indexOf("'- [ ] （待办事项）\\n'") >= 0, pair[0] + ' todo 模板（checkbox）')
      assert(s.indexOf("'## 链接\\n\\n（URL）\\n\\n## 说明\\n\\n（用途与要点）\\n'") >= 0, pair[0] + ' link 模板')
      assert(s.indexOf("'> （引用原文）\\n\\n—— （出处）\\n'") >= 0, pair[0] + ' quote 模板')
      assert(s.indexOf('const MACHINE_TEMPLATE = ') >= 0 && s.indexOf('## 机器清单') >= 0 && s.indexOf('## 门户') >= 0, pair[0] + ' 机器信息模板（环境/机器清单/账号/门户）')
      assert(s.indexOf('AI_ORGANIZE_MAX_CHARS = 12000') >= 0, pair[0] + ' 整理草稿上限 12000')
    }
  })
  await t('host 双侧：notes-ai-organize prompt 设计（先规则 → 模板示例全文 → 本篇类型/草稿）+ 围栏剥离 + 不落盘', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf("handle('notes-ai-organize'") >= 0, pair[0] + ' RPC 注册')
      assert(s.indexOf('【重写规则】') >= 0 && s.indexOf('【模板示例】') >= 0 && s.indexOf('【当前草稿】') >= 0, pair[0] + ' prompt 三段结构（规则→模板示例→草稿）')
      assert(s.indexOf('一条都不许丢，也不许编造草稿没有的事实') >= 0, pair[0] + ' 规则：事实零丢失/零编造')
      assert(s.indexOf('![' + '](assets/...)') >= 0 && s.indexOf('原样保留在合适位置') >= 0, pair[0] + ' 规则：图片/链接原样保留')
      assert(s.indexOf('KIND_TEMPLATES.decision') >= 0 && s.indexOf('KIND_TEMPLATES.todo') >= 0 && s.indexOf('MACHINE_TEMPLATE') >= 0, pair[0] + ' 模板示例嵌入 KIND_TEMPLATES/MACHINE_TEMPLATE 全文')
      assert(s.indexOf('只输出重写后的 Markdown 正文') >= 0, pair[0] + ' 只输出正文约束')
      assert(s.indexOf('```(?:markdown|md)?') >= 0, pair[0] + ' 输出剥离 ``` 围栏容错')
      assert(s.indexOf("notes-quick-instruct 同款") >= 0, pair[0] + ' 注释标明 quick-instruct 同款 LLM 通道')
    }
  })
  await t('host 双侧：notes-assets-prune 契约（dryRun 缺省 true 零写入 + 软删除引用计入 + files 白名单 + 调用内重扫）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const s = pair[1]
      assert(s.indexOf("handle('notes-assets-prune'") >= 0, pair[0] + ' RPC 注册')
      assert(s.indexOf('const dryRun = !args || args.dryRun !== false') >= 0, pair[0] + ' dryRun 缺省 true')
      assert(s.indexOf('含软删除笔记') >= 0, pair[0] + ' 软删除笔记引用计入保护（宁留勿删）')
      assert(s.indexOf('tombstoned') >= 0, pair[0] + ' 墓碑（0 字节占位）计数')
      assert(s.indexOf('args.files') >= 0 && s.indexOf('wanted[o.name]') >= 0, pair[0] + ' files 白名单过滤')
      assert(s.indexOf('防预览→执行间隙') >= 0 || s.indexOf('调用内重扫') >= 0, pair[0] + ' 执行时重扫防漂移注释')
    }
    assert(indexSrc.indexOf('node:fs 真删除') >= 0, 'index.mjs 静态包有 node:fs 真删除通道')
    assert(hostSrc.indexOf('墓碑式清空') >= 0 && hostSrc.indexOf('fsNode') < 0, '开发版仅墓碑式清空（ctx.fs 无删除契约；不 import node:fs）')
  })
  // ---- 27.2 host 行为级（内存 mock）----
  // ✨整理 ok 路径复用 section 2 主实例（llmMock 对「笔记整理助手」system 返回带围栏正文）
  await t('notes-ai-organize 行为：ok 路径剥离 ``` 围栏 + 尾随换行；空正文/超长/未配置模型报错', async () => {
    const ok = await handlers['notes-ai-organize']({ body: '方案对比草稿：A 便宜 B 快', kind: 'decision', title: '选型' })
    assert(ok && ok.ok === true, 'ok 路径（实得 ' + JSON.stringify(ok) + '）')
    assert(ok.body.indexOf('```') < 0, '围栏已剥离（实得开头 ' + JSON.stringify(ok.body.slice(0, 24)) + '）')
    assert(ok.body.indexOf('## 背景') >= 0 && ok.body.indexOf('## 结论') >= 0, '模板章节保留')
    assert(ok.body.charAt(ok.body.length - 1) === '\n', '正文尾随换行')
    const e1 = await handlers['notes-ai-organize']({ body: '   ', kind: 'note' })
    assert(e1 && e1.error && e1.error.indexOf('正文为空') >= 0, '空正文报错')
    const e2 = await handlers['notes-ai-organize']({ body: 'x'.repeat(12001), kind: 'note' })
    assert(e2 && e2.error && e2.error.indexOf('上限') >= 0 && e2.error.indexOf('12000') >= 0, '超限报错引导分段')
    const e3 = await handlers['notes-ai-organize']({ body: 'abc', kind: 'no-such-kind' })
    assert(e3 && e3.ok === true && e3.kind === 'note', '非法 kind 回退 note')
  })
  // 未配置模型：无 adm 且无 settings.llm → error（独立实例，llm 在但无默认可跟随）
  const storeP0 = new Map()
  const fsMockP0 = {
    resolve: async (p) => p,
    stat: async (p) => (p === NOTES_DIR ? { dir: true } : (storeP0.has(p) ? { file: true } : null)),
    listDir: async () => [],
    readText: async (p) => { if (!storeP0.has(p)) throw new Error('ENOENT: ' + p); return storeP0.get(p) },
    writeText: async (p, c) => { storeP0.set(p, c) },
  }
  const handlersP0 = {}
  const harnessMockP0 = { handle: (name, fn) => { handlersP0[name] = fn; return () => { delete handlersP0[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockP0, DIR).apply({
    fs: fsMockP0, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: undefined, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  await t('notes-ai-organize 行为：无设置且无会话模型可跟随 → error（原文不动）', async () => {
    const r = await handlersP0['notes-ai-organize']({ body: '草稿', kind: 'note' })
    assert(r && r.error && r.error.indexOf('未配置笔记 LLM') >= 0, '未配置模型报错（实得 ' + JSON.stringify(r) + '）')
  })
  // 孤儿资产清理行为矩阵（独立实例）：引用保护（含软删除笔记）/墓碑排除/dry-run 零写入/白名单执行/无参全量
  const storeP = new Map()
  let writesP = 0
  const fsMockP = {
    resolve: async (p) => p,
    stat: async (p) => {
      if (p === NOTES_DIR) return { dir: true }
      if (p === NOTES_DIR + '\\assets') return Array.from(storeP.keys()).some(k => k.indexOf(p + '\\') === 0) ? { dir: true } : null
      return storeP.has(p) ? { file: true } : null
    },
    listDir: async (p) => {
      const prefix = p + '\\'
      const out = []
      for (const k of storeP.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
      return out
    },
    readText: async (p) => { if (!storeP.has(p)) throw new Error('ENOENT: ' + p); return storeP.get(p) },
    writeText: async (p, c) => { writesP++; storeP.set(p, c) },
  }
  const handlersP = {}
  const harnessMockP = { handle: (name, fn) => { handlersP[name] = fn; return () => { delete handlersP[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  new Function('harness', 'pluginDir', hostSrc)(harnessMockP, DIR).apply({
    fs: fsMockP, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
    effect: () => {},
  })
  // 造库：笔记甲引用 a-ref.png；已删笔记乙引用 a-delref.png（软删除引用仍保护）；孤儿 a-orphan.png；墓碑 a-tomb.png（0 字节）
  storeP.set(NOTES_DIR + '\\n-pa.md', '---\nid: n-pa\ntitle: 引用笔记\ntopic: 运维\n---\n\n正文引用 ![图](assets/a-ref.png)\n')
  storeP.set(NOTES_DIR + '\\n-pb.md', '---\nid: n-pb\ntitle: 已删笔记\ntopic: 运维\ndeleted: true\n---\n\n已删仍引用 ![](assets/a-delref.png)\n')
  const b64ok = 'QUJD'  // 'ABC'（合法 base64，解码 3 字节）
  storeP.set(NOTES_DIR + '\\assets\\a-ref.png', b64ok)
  storeP.set(NOTES_DIR + '\\assets\\a-delref.png', b64ok)
  storeP.set(NOTES_DIR + '\\assets\\a-orphan.png', b64ok + b64ok)
  storeP.set(NOTES_DIR + '\\assets\\a-tomb.png', '')
  // 预热沉降：apply 时的心跳（.last-host-load）与首个 RPC 的 perf-report（10s 节流）是 fire-and-forget 写——
  // 先跑一个 awaited RPC + 宏任务等待让它们落定，否则 dryRun 零写入快照会被启动写污染
  await handlersP['notes-list']({})
  await new Promise(r => setTimeout(r, 20))
  await t('notes-assets-prune 行为：dryRun 缺省零写入；软删除引用计入保护；墓碑排除；字节数=base64 解码', async () => {
    const w0 = writesP
    const pv = await handlersP['notes-assets-prune']({})
    assert.strictEqual(writesP, w0, 'dryRun 零写入（写入增量 ' + (writesP - w0) + '）')
    assert(pv.dryRun === true, 'dryRun 标记')
    assert.deepStrictEqual(pv.orphans.map(o => o.name), ['a-orphan.png'], '孤儿 = 仅 a-orphan.png（实得 ' + JSON.stringify(pv.orphans) + '）')
    assert.strictEqual(pv.orphans[0].bytes, 6, 'bytes = base64 解码字节数（6）')
    assert.strictEqual(pv.referenced, 2, '引用中 2 个（含软删除笔记的 a-delref.png）')
    assert.strictEqual(pv.tombstoned, 1, '墓碑 1 个（0 字节占位自动排除）')
    assert.strictEqual(pv.notes, 3, '扫描笔记 3 条（2 种子含软删除 + 注入索引根笔记）')
    assert.strictEqual(pv.totalBytes, 6, 'totalBytes 求和')
  })
  await t('notes-assets-prune 行为：files 白名单执行（开发版墓碑式清空）+ 白名单外跳过 + 保护资产不动', async () => {
    const r = await handlersP['notes-assets-prune']({ dryRun: false, files: ['a-orphan.png'] })
    assert(!r.error, '执行成功（实得 ' + JSON.stringify(r) + '）')
    assert(r.dryRun === false, '执行标记')
    assert.deepStrictEqual(r.deleted, ['a-orphan.png'], '删除白名单内孤儿')
    assert.strictEqual(r.freedBytes, 6, '释放字节数')
    assert.strictEqual(r.modes && r.modes.tombstoned, 1, '开发版删除语义 = 墓碑式清空（writeText 空串）')
    assert.strictEqual(storeP.get(NOTES_DIR + '\\assets\\a-orphan.png'), '', '孤儿资产已清空为 0 字节占位')
    assert.strictEqual(storeP.get(NOTES_DIR + '\\assets\\a-ref.png'), b64ok, '被引用资产不动')
    assert.strictEqual(storeP.get(NOTES_DIR + '\\assets\\a-delref.png'), b64ok, '软删除笔记引用的资产不动（宁留勿删）')
    // 二次执行：a-orphan 已成墓碑 → 预览为空
    const pv2 = await handlersP['notes-assets-prune']({ dryRun: true })
    assert.strictEqual(pv2.orphans.length, 0 && pv2.tombstoned, 2, '清理后无孤儿，墓碑计数 2')
  })
  // ---- 27.3 client（开发版 + 发布包）结构断言 ----
  await t('二期 client 同源常量 + ✨整理按钮链路（开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const KIND_TEMPLATES = {') >= 0 && s.indexOf("'## 背景\\n\\n（问题与上下文）") >= 0 && s.indexOf("'- [ ] （待办事项）\\n'") >= 0, label + ' KIND_TEMPLATES 与 host 同份')
      assert(s.indexOf("sparkle: [e('path'") >= 0, label + ' sparkle 图标（二期 ✨整理）')
      assert(s.indexOf('dsh-notes-organize-btn') >= 0, label + ' 整理按钮 class')
      assert(s.indexOf('async function doAiOrganize(instruction)') >= 0, label + ' doAiOrganize 存在（0.4.4-F 起带可选 instruction 形参）')
      assert(s.indexOf("'notes-ai-organize', { body: body, kind: edKindRef.current, title: edTitleRef.current, instruction: instr }") >= 0, label + ' RPC payload {body,kind,title,instruction}（0.4.4-F 追加指令字段，空=系统默认规则）')
      assert(s.indexOf('organizeUndoRef.current = { body: body }') >= 0, label + ' 一次撤销栈（整理前正文）')
      assert(s.indexOf("{ label: tt('meta.undo'), fn: undoAiOrganize }") >= 0, label + ' 整理成功 toast 带「撤销」（i18n 覆盖卡B 起走 tt() 字典）')
      assert(s.indexOf("tt('editor.organizeUndone')") >= 0, label + ' 撤销恢复 toast（覆盖卡B 走 tt()）')
      assert(s.indexOf("tt('editor.bodyEmpty')") >= 0 && s.indexOf('edLoadingRef.current') >= 0, label + ' 空正文/加载中守卫（覆盖卡B 走 tt()）')
      assert(s.indexOf("syncFromRich('整理前同步')") >= 0, label + ' 富文本在途编辑先落回源码')
    }
  })
  await t('二期 kind 模板骨架（新建 modal 类型选择 + 预填 body；开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('const [newNoteKind, setNewNoteKind] = React.useState') >= 0, label + ' newNoteKind 状态')
      assert(s.indexOf('dsh-notes-newnote-select') >= 0, label + ' 新建 modal 类型 select')
      assert(s.indexOf("body: KIND_TEMPLATES[newNoteKind] || '', kind: newNoteKind") >= 0, label + ' 创建 payload 按类型预填骨架')
      assert(s.indexOf('将预填模板骨架') >= 0 && s.indexOf('自由格式（空正文）') >= 0, label + ' 骨架提示文案')
    }
  })
  await t('二期 图片压缩（>1MB PNG/JPEG → canvas 降质转 JPEG；开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf('IMG_COMPRESS_THRESHOLD = 1024 * 1024') >= 0, label + ' 1MB 压缩阈值')
      assert(s.indexOf('function compressImageData(dataURL, cb)') >= 0, label + ' compressImageData 存在')
      assert(s.indexOf("canvas.toDataURL('image/jpeg'") >= 0, label + ' canvas 转 JPEG')
      assert(s.indexOf("f.size > IMG_COMPRESS_THRESHOLD && (f.type === 'image/png' || f.type === 'image/jpeg')") >= 0, label + ' pickImageFile 压缩接线（仅 >1MB 的 PNG/JPEG）')
      assert(s.indexOf("fillStyle = '#ffffff'") >= 0, label + ' PNG 透明底刷白（JPEG 无 alpha）')
      assert(s.indexOf('已压缩 ') >= 0 && s.indexOf('origSize') >= 0, label + ' 弹窗显示压缩前后大小')
      assert(s.indexOf('自动压缩转 JPEG') >= 0, label + ' 弹窗副标说明自动压缩')
    }
    // GIF/WebP 不进压缩（保动画/透明语义）
    assert(clientSrc.indexOf("f.type === 'image/gif' || f.type === 'image/webp'") < 0, 'GIF/WebP 不参与压缩条件')
  })
  await t('二期 资产清理 UI（设置卡片入口 + dry-run 预览 + 白名单执行 + Esc + danger 按钮；开发版 + 发布包）', () => {
    for (const pair of [['client-impl', clientSrc], ['发布包 lib/client.js', clientPkgSrc]]) {
      const s = pair[1], label = pair[0]
      assert(s.indexOf("{ key: 'assets', label: tt('settings.assets')") >= 0, label + ' 设置卡片「资产清理」行（覆盖卡 C 起 label 走 tt() 字典）')
      assert(s.indexOf('function openPrune()') >= 0 && s.indexOf("'notes-assets-prune', { dryRun: true }") >= 0, label + ' openPrune 走 dryRun:true 零写入预览')
      assert(s.indexOf("'notes-assets-prune', { dryRun: false, files: files }") >= 0, label + ' 执行 payload（dryRun:false + files 白名单）')
      assert(s.indexOf('pruneChecked[o.name] !== false') >= 0, label + ' 缺省全勾（false=取消）')
      assert(s.indexOf("'删除所选（' + checked.length + ' 项 · '") >= 0, label + ' 确认按钮计数（N 项 · 字节）')
      assert(s.indexOf("className: 'dsh-notes-data-danger'") >= 0, label + ' 删除按钮 danger 样式')
      assert(s.indexOf('已清理 ') >= 0 && s.indexOf('fmtBytes(res.freedBytes || 0)') >= 0, label + ' 执行结果 toast（数量 + 释放字节）')
    }
    assert(clientSrc.indexOf('if (pruneOpenRef.current) { setPruneOpen(false); return }') >= 0, 'Esc 链路关资产清理对话框')
    assert(clientSrc.indexOf('!importOpen && !pruneOpen') >= 0, '全局错误条排除 prune modal（modal 内自显错误）')
  })
  await t('二期 样式（styles.css + 发布包 lib/styles.css 同步）', () => {
    const cssDev = fsNative.readFileSync(SRC_STYLES, 'utf8')
    const cssPkg = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'lib', 'styles.css'), 'utf8')
    for (const pair of [['styles.css', cssDev], ['发布包 lib/styles.css', cssPkg]]) {
      for (const cls of ['.dsh-notes-newnote-select{', '.dsh-notes-newnote-kind-row{', '.dsh-notes-newnote-kind-hint{', '.dsh-notes-organize-btn.busy{']) {
        assert(pair[1].indexOf(cls) >= 0, pair[0] + ' 缺二期样式：' + cls)
      }
    }
    assert.strictEqual(cssDev.replace(/\r\n/g, '\n'), cssPkg.replace(/\r\n/g, '\n'), 'styles.css 与发布包逐字节一致（需跑 scripts/build-dist.cjs）')
  })
  // ---- 27.4 app.html 同款 ----
  await t('app.html 二期同款：KIND_TEMPLATES + ✨整理 + 压缩 + 资产清理 + i-sparkle', () => {
    assert(appSrc.indexOf('var KIND_TEMPLATES = {') >= 0 && appSrc.indexOf("'## 背景\\n\\n（问题与上下文）") >= 0, 'app.html KIND_TEMPLATES 同份')
    assert(appSrc.indexOf('id="i-sparkle"') >= 0, 'app.html i-sparkle 图标')
    assert(appSrc.indexOf('id="mOrganize"') >= 0 && appSrc.indexOf('function doAiOrganize(instruction)') >= 0, 'app.html 整理按钮 + doAiOrganize（0.4.4-F 起带可选 instruction 形参）')
    assert(appSrc.indexOf("rpc('notes-ai-organize', { body: body, kind: edNote.kind || 'note'") >= 0, 'app.html 整理 RPC payload')
    /* i18n 覆盖卡F：app 整理 toast 走 t() 字典（editor.organized 复用 B 卡 + meta.undo；kind 名经 kindLabel() 条件映射） */
    assert(appSrc.indexOf("toast(t('editor.organized', { kind: kindLabel(edNote.kind) || t('meta.kindNote') }), { label: t('meta.undo'), fn: undoAiOrganize })") >= 0, 'app.html 整理 toast 撤销（覆盖卡F 起走 t()）')
    assert(appSrc.indexOf("body: KIND_TEMPLATES[kind0] || ''") >= 0, 'app.html 新建按类型预填骨架')
    assert(appSrc.indexOf('IMG_COMPRESS_THRESHOLD = 1024 * 1024') >= 0 && appSrc.indexOf('function compressImageData(dataURL, cb)') >= 0, 'app.html 压缩阈值 + helper')
    assert(appSrc.indexOf("f.size > IMG_COMPRESS_THRESHOLD && (f.type === 'image/png' || f.type === 'image/jpeg')") >= 0, 'app.html pickImageFile 压缩接线')
    assert(appSrc.indexOf('id="setPrune"') >= 0 && appSrc.indexOf('function openPrune()') >= 0, 'app.html 设置行 + openPrune')
    assert(appSrc.indexOf("rpc('notes-assets-prune', { dryRun: true })") >= 0 && appSrc.indexOf("rpc('notes-assets-prune', { dryRun: false, files: files })") >= 0, 'app.html prune 预览/执行 RPC')
    assert(appSrc.indexOf('.meta-act.organize-btn.busy{') >= 0, 'app.html 整理忙态样式')
  })
  // ---- 27.5 原型同步（UI 唯一规格来源约束）----
  await t('原型 notes-ui-v2.html 二期硬性同步：模板/整理/清理 + mock RPC + i-sparkle', () => {
    assert(protoV2Src.indexOf('var KIND_TEMPLATES = {') >= 0, 'v2 KIND_TEMPLATES 同份')
    assert(protoV2Src.indexOf('id="i-sparkle"') >= 0, 'v2 i-sparkle 图标')
    assert(protoV2Src.indexOf('id="mOrganize"') >= 0 && protoV2Src.indexOf('function doAiOrganize(instruction)') >= 0, 'v2 整理按钮 + 函数（0.4.4-F 起带可选 instruction 形参，与 27.4 app.html 锚同口径；引导卡第四端锚点见节 84.6）')
    assert(protoV2Src.indexOf("method === 'notes-ai-organize'") >= 0, 'v2 mock notes-ai-organize')
    assert(protoV2Src.indexOf("method === 'notes-assets-prune'") >= 0 && protoV2Src.indexOf('_mockAssets') >= 0, 'v2 mock notes-assets-prune + 资产清单')
    assert(protoV2Src.indexOf('id="setPrune"') >= 0 && protoV2Src.indexOf('function openPrune()') >= 0, 'v2 设置行 + openPrune')
    assert(protoV2Src.indexOf("body: KIND_TEMPLATES[kind0] || ''") >= 0, 'v2 新建按类型预填骨架')
    assert(protoV2Src.indexOf('.meta-act.organize-btn.busy{') >= 0, 'v2 整理忙态样式')
    // v2 与 app.html 二期 UI 标记双端一致（共享 DOM id 与函数名）
    for (const k of ['mOrganize', 'doAiOrganize', 'undoAiOrganize', 'setPrune', 'openPrune', 'renderPruneList', 'doPruneConfirm', 'pruneList', 'KIND_TEMPLATES']) {
      assert(protoV2Src.indexOf(k) >= 0 && appSrc.indexOf(k) >= 0, '二期 UI 标记双端一致：' + k)
    }
  })
  await t('原型 notes-editor-v3.html 二期回写：✨整理演示 + 契约注释 + i-sparkle', () => {
    const protoV3 = fsNative.readFileSync(path.join(DIR, 'design', 'notes-editor-v3.html'), 'utf8')
    assert(protoV3.indexOf('id="i-sparkle"') >= 0, 'v3 i-sparkle 图标')
    assert(protoV3.indexOf('id="mOrganize"') >= 0 && protoV3.indexOf('demoOrganize') >= 0, 'v3 整理按钮 + 演示函数')
    assert(protoV3.indexOf('notes-ai-organize') >= 0 && protoV3.indexOf('一次撤销栈') >= 0, 'v3 头注含整理契约（RPC + 撤销栈）')
    assert(protoV3.indexOf('12000') >= 0 && protoV3.indexOf('canvas 降质转 JPEG') >= 0, 'v3 头注含上限与压缩契约')
    assert(protoV3.indexOf('二期实现对照（notes-md-editor-phase2') >= 0, 'v3 二期回写段落')
  })
  // ---- 27.6 文档同步 ----
  await t('README/DEVELOPMENT 二期同步（功能清单 + RPC 计数）', () => {
    const readme = fsNative.readFileSync(path.join(DIR, 'README.md'), 'utf8')
    for (const kw of ['✨ 整理', '模板骨架', '资产清理', '压缩']) assert(readme.indexOf(kw) >= 0, 'README 功能清单缺二期关键词：' + kw)
    assert(readme.indexOf('notes-ai-organize') >= 0 && readme.indexOf('notes-assets-prune') >= 0, 'README 数据位置/RPC 提及二期 RPC')
    const dev = fsNative.readFileSync(path.join(DIR, 'DEVELOPMENT.md'), 'utf8')
    assert(dev.indexOf('48 个 RPC') >= 0, 'DEVELOPMENT RPC 计数更新为 48（含 notes-mount/notes-mount-list + notes-ledger-refresh + notes-when-suggest + notes-conflict-check；与节 23 实测 48 / 静态包 49 含 notes-ping 对齐——0.4.5-G 约定体检）')
    assert(dev.indexOf('notes-conflict-check') >= 0, 'DEVELOPMENT RPC 清单提及约定体检 notes-conflict-check（0.4.5-G）')
    assert(dev.indexOf('notes-recall-stats') >= 0, 'DEVELOPMENT RPC 清单提及统一召回遥测 notes-recall-stats（0.4.3+ 卡⑫）')
    assert(dev.indexOf('notes-get-batch') >= 0, 'DEVELOPMENT RPC 清单提及 N+1 批量端点 notes-get-batch')
    assert(dev.indexOf('notes-schedule-eval') >= 0, 'DEVELOPMENT RPC 清单提及定时派发 notes-schedule-eval')
    assert(dev.indexOf('notes-memory-guide') >= 0, 'DEVELOPMENT RPC 清单提及工作记忆 notes-memory-guide')
    assert(dev.indexOf('notes-inject-preview') >= 0, 'DEVELOPMENT RPC 清单提及注入预览 notes-inject-preview')
    assert(dev.indexOf('notes-suggest') >= 0, 'DEVELOPMENT RPC 清单提及整理建议 notes-suggest')
    assert(dev.indexOf('notes-export-single') >= 0, 'DEVELOPMENT RPC 清单提及 P3 notes-export-single')
    assert(dev.indexOf('notes-restore-history') >= 0, 'DEVELOPMENT RPC 清单提及历史版本 notes-restore-history')
    const pkgReadme = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'README.md'), 'utf8')
    for (const kw of ['✨ 整理', '资产清理']) assert(pkgReadme.indexOf(kw) >= 0, '发布包 README 同步二期（需跑 scripts/sync-pkg-readme.cjs）：' + kw)
  })
  }
}
