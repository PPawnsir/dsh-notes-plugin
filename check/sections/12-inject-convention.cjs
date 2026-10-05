// 节 12. T2.3 工作区约定自动注入
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "12",
  title: "12. T2.3 工作区约定自动注入",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, findTool, fsMock, g, handlers, noteManage, registeredContexts, store } = S
  // ===== 12. T2.3 工作区约定自动注入 =====
  section('12. T2.3 工作区约定自动注入')
  await t('systemPrompt.context 已注册（order 130）', () => {
    assert(registeredContexts.length >= 1, '应注册至少一个 context')
    const c = registeredContexts.find(x => x.name === 'notes:workspace-conventions')
    assert(c, 'context name 应为 notes:workspace-conventions')
    assert.strictEqual(c.order, 130, 'order 应为 130')
    assert(typeof c.text === 'function', 'text 应为函数')
  })
  await t('无 convention 笔记时约定文本为空', async () => {
    const r = await handlers['notes-conventions']({})
    assert(r.text === '', '无约定时返回空串')
  })
  await t('inject=true 笔记注入文本（双角色新文案：缺省进约定桶，单桶只出该桶标题）', async () => {
    const cConv = await handlers['notes-create']({ title: '本工作区约定', body: '代码必须带单测', inject: true, topic: '约定' })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('本工作区约定') >= 0, '约定标题应出现')
    assert(r.text.indexOf('代码必须带单测') >= 0, '约定正文应出现')
    assert(r.text.indexOf('以下是注入的上下文笔记（与当前任务无关时忽略）：') === 0, '新文案引导词开头（实得：' + r.text.slice(0, 60) + '）')
    assert(r.text.indexOf('用户约定（须遵守）：') >= 0, '缺省 injectRole=convention 进约定桶')
    assert(r.text.indexOf('- [' + cConv.id + '] 本工作区约定') >= 0, '桶内条目格式 - [id] 标题')
    assert(r.text.indexOf('本地笔记库目录（') < 0, '单桶命中时只输出该桶标题（无挂载行且 catalog 关 → 目录段整段空，0.4.3③）')
    assert(r.text.indexOf('已记录的约定') < 0, '新文案不含旧引导词「已记录的约定」')
    assert(r.text.indexOf('记录会话') < 0 && r.text.indexOf('记录于会话') < 0, '新文案不含会话归属标注')
    assert(r.text.indexOf('工作区「') < 0, '新文案不含工作区归属标签')
  })
  await t('inject 缺省 false 不注入（独立字段，不靠标签）', async () => {
    // 即使带 convention 标签，没显式 inject=true 也不注入（注入是独立字段，不是标签）
    await handlers['notes-create']({ title: '仅标签无inject', body: 'x', tags: ['convention'], topic: '约定' })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('仅标签无inject') < 0, '仅 convention 标签但 inject=false 不应注入')
  })
  await t('旧文件兼容：无 inject 字段但含 convention 标签的文件回退注入', async () => {
    // 直接写一条无 inject 字段、tags 含 convention 的旧格式文件
    const legacyId = 'n-legacy-conv'
    const legacyContent = '---\nid: ' + legacyId + '\ntitle: 旧版约定\ntopic: 约定\ntags: convention\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\nsessionId: session-abc12345-0000\ncwd: "D:\\deepseek-work"\n---\n\n旧约定正文\n'
    await fsMock.writeText(NOTES_DIR + '\\' + legacyId + '.md', legacyContent)
    // 先 notes-get 触发解析进 cache（conventionText 只读 cache）
    const g = await handlers['notes-get']({ id: legacyId })
    assert(g.note.inject === true, '旧文件 inject 应回退到 convention 标签')
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('旧版约定') >= 0, '旧文件（无 inject 字段）应回退按 convention 标签注入')
    assert(r.text.indexOf('用户约定（须遵守）：') >= 0 && r.text.indexOf('旧版约定') > r.text.indexOf('用户约定（须遵守）：'), '旧文件无 injectRole 字段 → 缺省进约定桶（零迁移）')
  })

  // ===== 12.5 injectRole 双角色：字段链路 + 分桶文案 =====
  await t('injectRole 字段往返：create 带 reference → get/list/front-matter 一致', async () => {
    const c = await handlers['notes-create']({ title: '参考资料笔记', body: '机器配置：Node 22', inject: true, topic: '资料', injectRole: 'reference' })
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.injectRole, 'reference', 'notes-get 返回 injectRole=reference')
    const lst = await handlers['notes-list']({})
    assert.strictEqual(lst.notes.find(n => n.id === c.id).injectRole, 'reference', 'notes-list（slim）携带 injectRole')
    const onDisk = store.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectRole: reference\n') >= 0, 'front-matter 写 injectRole: reference（inject=true 才落盘）')
  })
  await t('injectRole 缺省/非法值回退 convention（create 不传 / 非法值 / 旧文件无字段）', async () => {
    const c1 = await handlers['notes-create']({ title: '缺省角色约定', body: 'x', inject: true, topic: '约定' })
    const g1 = await handlers['notes-get']({ id: c1.id })
    assert.strictEqual(g1.note.injectRole, 'convention', 'create 不传 injectRole 缺省 convention')
    const onDisk1 = store.get(NOTES_DIR + '\\' + c1.id + '.md')
    assert(onDisk1.indexOf('\ninjectRole: convention\n') >= 0, '缺省也落盘 injectRole: convention（inject=true）')
    const c2 = await handlers['notes-create']({ title: '非法角色约定', body: 'x', inject: true, topic: '约定', injectRole: 'bogus' })
    const g2 = await handlers['notes-get']({ id: c2.id })
    assert.strictEqual(g2.note.injectRole, 'convention', '非法 injectRole 回退 convention')
    const gLegacy = await handlers['notes-get']({ id: 'n-legacy-conv' })
    assert.strictEqual(gLegacy.note.injectRole, 'convention', '旧文件无 injectRole 字段回退 convention（零迁移）')
  })
  await t('inject=false 时 injectRole 不落盘（避免脏数据）', async () => {
    const c = await handlers['notes-create']({ title: '非注入资料', body: 'x', injectRole: 'reference', topic: '资料' })
    const onDisk = store.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('injectRole') < 0, 'inject=false 不写 injectRole 行（实得：' + onDisk.split('\n').slice(0, 12).join('|') + '）')
  })
  await t('role 分桶文案：约定桶 + 目录段并列（0.4.3③ 资料桶并入目录段挂载行）', async () => {
    const r = await handlers['notes-conventions']({})
    const iConv = r.text.indexOf('用户约定（须遵守）：')
    const iRef = r.text.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：')
    assert(iConv >= 0 && iRef >= 0, '约定桶 + 目录段引导词齐备（实得：' + r.text.slice(0, 120) + '）')
    assert(iConv < iRef, '约定桶在目录段之前')
    assert(r.text.indexOf('参考资料笔记') > iRef, 'reference 笔记以挂载行形态列在目录段（增强态排前）')
    const iConvNote = r.text.indexOf('本工作区约定')
    assert(iConvNote > iConv && iConvNote < iRef, 'convention 笔记列在约定桶下')
  })
  await t('note_manage 工具路由透传 injectRole（create/update）+ schema 参数', async () => {
    const nm = findTool('note_manage')
    const p = nm.parameters.properties
    assert(p.injectRole && p.injectRole.type === 'string' && JSON.stringify(p.injectRole.enum) === '["convention","reference"]', 'schema 含 injectRole enum（实得：' + JSON.stringify(p.injectRole) + '）')
    assert(p.inject.description.indexOf('as context') >= 0, 'inject 描述改为上下文注入（实得：' + p.inject.description + '）')
    const c = await nm.execute({ action: 'create', title: '工具资料', body: '参考内容', inject: true, injectRole: 'reference', topic: '资料' })
    assert(!c.error, 'manage.create 成功（实得：' + JSON.stringify(c) + '）')
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.injectRole, 'reference', 'manage.create 透传 injectRole')
    const u = await nm.execute({ action: 'update', id: c.id, injectRole: 'convention' })
    assert(!u.error, 'manage.update injectRole 成功')
    const g2 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.injectRole, 'convention', 'manage.update 改 injectRole 生效')
    const onDisk = store.get(NOTES_DIR + '\\' + c.id + '.md')
    assert(onDisk.indexOf('\ninjectRole: convention\n') >= 0, 'update 后 front-matter 同步')
    await nm.execute({ action: 'update', id: c.id, topic: '资料-改' })
    const g3 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g3.note.injectRole, 'convention', 'update 不显式传 injectRole 保持原值（undefined 不动）')
  })
  await t('notes-update RPC 透传 injectRole（显式改 / 不传不动）', async () => {
    const c = await handlers['notes-create']({ title: 'RPC角色笔记', body: 'x', inject: true, topic: '约定' })
    await handlers['notes-update']({ id: c.id, injectRole: 'reference' })
    const g = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g.note.injectRole, 'reference', 'notes-update 透传 injectRole')
    await handlers['notes-update']({ id: c.id, topic: '约定2' })
    const g2 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.injectRole, 'reference', 'notes-update 不传 injectRole 保持原值')
  })
  await t('双侧 injectRole 字段链路 + 分桶文案同步（host-impl / index.mjs 源码结构）', () => {
    for (const pair of [['host-impl', hostSrc], ['index.mjs', indexSrc]]) {
      const label = pair[0], src = pair[1]
      assert(src.indexOf("(m.inject ? 'injectRole: '") >= 0 && /'injectRole: ' \+ escYaml\(m\.injectRole === 'reference' \? 'reference' : 'convention'\)/.test(src), label + ' buildFM 仅 inject=true 写 injectRole 行')
      assert(src.indexOf("p.meta.injectRole === 'reference' ? 'reference' : 'convention'") >= 0, label + ' noteFromParsed 读 injectRole（缺省/非法回退 convention）')
      assert((src.match(/injectRole: n\.injectRole === 'reference' \? 'reference' : 'convention'/g) || []).length >= 2, label + ' persistNote 与 slim 均携带 injectRole')
      assert(src.indexOf("injectRole: ex.injectRole === 'reference' ? 'reference' : 'convention'") >= 0, label + ' _create 接受 injectRole')
      assert(/if \(injectRole !== undefined\) note\.injectRole = injectRole === 'reference' \? 'reference' : 'convention'/.test(src), label + ' _update 第 12 位参数显式传才改（undefined 不动）')
      assert(/injectRole: \{ type: 'string', enum: \['convention', 'reference'\]/.test(src), label + ' note_manage schema 含 injectRole enum')
      assert(/args\.injectRole/.test(src), label + ' 工具/RPC 路由透传 args.injectRole')
      assert(src.indexOf('以下是注入的上下文笔记（与当前任务无关时忽略）：') >= 0, label + ' 新引导词')
      assert(src.indexOf('用户约定（须遵守）：') >= 0 && src.indexOf('本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：') >= 0, label + ' 约定桶 + 目录段引导词（0.4.3③ 合并段）')
      assert(src.indexOf('已记录的约定') < 0 && src.indexOf('记录于会话') < 0 && src.indexOf('工作区「') < 0, label + ' 旧文案（工作区归属/会话标注）已删除')
    }
  })
  await t('跨工作区 convention 同样注入（注入无工作区维度）', async () => {
    await noteManage.execute({ action: 'create', title: '别区约定', body: '别区内容', inject: true, topic: '约定', workspace: 'other-ws' })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('本工作区约定') >= 0, '本工作区约定仍在')
    assert(r.text.indexOf('别区约定') >= 0, 'workspace=other-ws 的笔记同样注入（注入范围只看会话，不看工作区）')
  })
  await t('deleted 的约定不注入', async () => {
    const c = await handlers['notes-create']({ title: '待删除约定', body: '不注入', inject: true, topic: '约定' })
    await handlers['notes-delete']({ id: c.id })
    const r = await handlers['notes-conventions']({})
    assert(r.text.indexOf('待删除约定') < 0, '软删除的约定不应注入')
  })
  }
}
