// 节 16. T3 选区指令记录（notes-quick-instruct）
// 拆分自 check.js 单文件（notes-check-split）：节体逐字节保留，仅首尾为机械接线（H=helpers 设施，S=跨节共享状态）。
module.exports = {
  id: "16",
  title: "16. T3 选区指令记录（notes-quick-instruct）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { NOTES_DIR, g, handlers, llmMock, store } = S
  // ===== 16. T3 选区指令记录（notes-quick-instruct） =====
  section('16. T3 选区指令记录（notes-quick-instruct）')
  await t('notes-quick-instruct handler 已注册', () => assert(typeof handlers['notes-quick-instruct'] === 'function', 'handler 存在'))
  const qi = await handlers['notes-quick-instruct']({ text: '选区原文内容abc', note: '这是待办，标记为重要 bug，记住这个', sessionId: 'sess-instruct-1', cwd: 'D:\\deepseek-work' })
  await t('notes-quick-instruct 返回 ok + applied', () => {
    assert(qi.ok === true && qi.id, '应返回 ok + id')
    assert.deepStrictEqual(qi.applied.tags, ['重要', 'bug'], 'applied.tags = LLM 提取的标签')
    assert.strictEqual(qi.applied.kind, 'todo', 'applied.kind = todo')
    assert.strictEqual(qi.applied.inject, true, 'applied.inject = true')
    assert.strictEqual(qi.applied.titleHint, '登录崩溃修复', 'applied.titleHint 透传')
  })
  const qiGet = await handlers['notes-get']({ id: qi.id })
  await t('notes-quick-instruct 选区原文原样为 body', () => {
    assert.strictEqual(qiGet.note.body, '选区原文内容abc\n', 'body = 选区原文（不变）')
  })
  await t('notes-quick-instruct 备注不进笔记 body', () => {
    assert(qiGet.note.body.indexOf('待办') < 0, '备注不应进 body')
    assert(qiGet.note.body.indexOf('记住这个') < 0, '备注不应进 body')
  })
  await t('notes-quick-instruct 元数据应用到笔记', () => {
    assert(qiGet.note.tags.indexOf('重要') >= 0 && qiGet.note.tags.indexOf('bug') >= 0, 'tags 合并到笔记')
    assert(qiGet.note.tags.indexOf('quick') >= 0, '保留 quick 默认标签')
    assert.strictEqual(qiGet.note.kind, 'todo', 'kind 应用为 todo')
    assert.strictEqual(qiGet.note.inject, true, 'inject 应用为约定')
    assert.strictEqual(qiGet.note.injectRole, 'convention', 'LLM 未输出 injectRole 时缺省 convention（提取器提示词已说明按 kind 推断建议）')
    assert.strictEqual(qi.applied.injectRole, 'convention', 'applied 透传 injectRole')
    const qiDisk = store.get(NOTES_DIR + '\\' + qi.id + '.md')
    assert(qiDisk.indexOf('\ninjectRole: convention\n') >= 0, 'inject=true 落盘 injectRole 行')
    assert.strictEqual(qiGet.note.topic, '登录崩溃修复', 'titleHint 引导 topic')
  })
  await t('notes-quick-instruct 不走合并窗口（独立笔记）', () => {
    assert(!qi.merged, '指令记录是独立意图，不合并')
  })
  await t('notes-quick-instruct 空备注走 notes-quick 逻辑', async () => {
    const r = await handlers['notes-quick-instruct']({ text: '空备注原文xyz', note: '', sessionId: 'sess-instruct-empty', cwd: 'D:\\deepseek-work' })
    assert(r.ok === true && r.id, '空备注应返回 ok + id')
    assert.deepStrictEqual(r.applied.tags, [], '空备注 applied.tags 为空')
    assert.strictEqual(r.applied.inject, false, '空备注 applied.inject 为 false')
    const g = await handlers['notes-get']({ id: r.id })
    assert(g.note.body.indexOf('空备注原文xyz') >= 0, '空备注 body = 选区原文')
  })
  await t('notes-quick-instruct LLM 解析失败回退等价 notes-quick', async () => {
    // 临时替换 llmMock.stream 返回非 JSON，验证容错回退（原文不变，等价 notes-quick）
    const origStream = llmMock.stream
    llmMock.stream = async function* () { yield { type: 'text-delta', text: '这不是JSON' }; yield { type: 'finish' } }
    try {
      const r = await handlers['notes-quick-instruct']({ text: '容错回退原文', note: '有备注但LLM返回非JSON', sessionId: 'sess-instruct-fb', cwd: 'D:\\deepseek-work' })
      assert(r.ok === true && r.id, '容错回退应返回 ok + id')
      assert(r.fallback === true, '应标记 fallback=true')
      assert.deepStrictEqual(r.applied.tags, [], '回退 applied.tags 为空')
      const g = await handlers['notes-get']({ id: r.id })
      assert(g.note.body.indexOf('容错回退原文') >= 0, '回退 body = 选区原文')
      assert(g.note.body.indexOf('有备注但LLM返回非JSON') < 0, '回退时备注不进 body')
    } finally {
      llmMock.stream = origStream
    }
  })
  Object.assign(S, { qi })
  }
}
