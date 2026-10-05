// 节 77. front-matter 分隔符往返幂等（notes-043-fm-newline，数据保真）：正文前导换行零增长 + 存量首轮归一 + 键值解析零回归 + 双端同源
// 背景（notes-043-atomic-store verifier 遗留发现 A）：buildFM 尾部 '---\n\n' + parseFM 正则只吃一个 \n
//   → 冷 cache 读盘正文每「读→原样回写→读」往返 +1 个前导换行，实测 1→2→3 无上界递增。
// 修复口径：buildFM 固定 '---\n' 收尾（分隔符与正文间不留空行）；parseFM 吃掉闭合 --- 后全部连续前导换行
//   （空行属分隔符填充，不属正文语义；正文内部空行不受影响）。存量污染文件首轮读入即归一、回写后稳定——
//   不做全库迁移：既有文件字节不动，仅读入语义归一。canonical 口径：正文不再以前导空行开头。
// 配套：节 76 的「去前导换行归一」绕行已改严格比对；8-5 节 bodyBytes 烤入的前导 \n 已摘除；history 引擎旧「剥一个前导换行」死代码已移除。
module.exports = {
  id: "77",
  title: "77. front-matter 往返幂等：正文前导换行零增长 + 存量首轮归一（notes-043-fm-newline）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { handlers, fsMock, store, NOTES_DIR, llmMock, admMock, agentsMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('77. front-matter 往返幂等：正文前导换行零增长 + 存量首轮归一（notes-043-fm-newline）')

  const notePath = (id) => NOTES_DIR + '\\' + id + '.md'
  // 「重启」模拟：同一 fsMock/store（盘上字节跨重启不变）上新建 host 实例 —— cache 从零，一切读盘重建（同节 76 口径）
  function newInstance() {
    const hs = {}
    new Function('harness', 'pluginDir', hostSrc)(
      { handle: (n, f) => { hs[n] = f; return () => {} }, defineTool: (d) => d, registerTool: () => () => {} },
      DIR
    ).apply({
      fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
    })
    return hs
  }
  const diskTail = (id) => { const d = store.get(notePath(id)); return String(d).slice(String(d).lastIndexOf('\n---\n')) }

  // ---- 77.1 往返幂等：读→原样回写→读 三轮正文逐字节相同 + 磁盘尾部字节稳定 ----
  await t('往返幂等：读→原样回写→读三轮正文逐字节相同（含内部空行/尾部换行）', async () => {
    const body0 = '首行\n\n中段空行保留\n\n\n尾段\n'
    const c = await handlers['notes-create']({ title: 'FM往返样本', body: body0, topic: '加固' })
    assert(c && c.id, '样本创建成功')
    const H1 = newInstance()
    const b1 = (await H1['notes-get']({ id: c.id })).note.body
    assert.strictEqual(b1, body0, '首轮冷 cache 读回逐字节等于写入正文（零前导换行）')
    await H1['notes-update']({ id: c.id, body: b1 })   // 原样回写
    const H2 = newInstance()
    const b2 = (await H2['notes-get']({ id: c.id })).note.body
    assert.strictEqual(b2, body0, '第二轮读回不增不减（旧缺陷此处为 \\n' + '首行…）')
    await H2['notes-update']({ id: c.id, body: b2 })
    const H3 = newInstance()
    const b3 = (await H3['notes-get']({ id: c.id })).note.body
    assert.strictEqual(b3, body0, '第三轮读回逐字节稳定（幂等收口，无上界递增）')
    assert.strictEqual(diskTail(c.id), '\n---\n' + body0, '磁盘 canonical 形态：闭合分隔符单换行直抵正文（不多写空行）')
    // 再回写一轮，磁盘尾部字节与前轮完全一致（updatedAt 在行内变化不影响尾部比对）
    await H3['notes-update']({ id: c.id, body: b3 })
    assert.strictEqual(diskTail(c.id), '\n---\n' + body0, '回写后磁盘尾部字节稳定（幂等）')
  })

  // ---- 77.2 存量首轮归一：污染文件读入即归一 + 纯读不写盘 + 回写后稳定零增长 ----
  await t('存量污染首轮归一：多前导换行读入即归一 + 纯读不改盘 + 回写后稳定零增长', async () => {
    // 模拟旧缺陷累积的存量文件：闭合分隔符后 3 个多余前导换行（等价旧口径往返 3 轮：\n\n\n存量正文）
    const polluted = '---\nid: n-fmlegacy77\ntitle: 存量污染\ntopic: 加固\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\n\n\n\n存量正文\n'
    await fsMock.writeText(notePath('n-fmlegacy77'), polluted)
    const H1 = newInstance()
    const g1 = await H1['notes-get']({ id: 'n-fmlegacy77' })
    assert.strictEqual(g1.note.body, '存量正文\n', '首轮读入即归一：前导空行不计入正文语义（旧口径此处为 \\n\\n\\n存量正文）')
    assert.strictEqual(store.get(notePath('n-fmlegacy77')), polluted, '红线：纯读（get/list）不改写存量文件字节（无全库迁移）')
    const H1l = newInstance()
    await H1l['notes-list']({})
    assert.strictEqual(store.get(notePath('n-fmlegacy77')), polluted, '红线：列表懒加载同样纯读不改盘')
    // 原样回写 → 磁盘归一为 canonical 单换行分隔；之后稳定
    await H1['notes-update']({ id: 'n-fmlegacy77', body: g1.note.body })
    assert.strictEqual(diskTail('n-fmlegacy77'), '\n---\n存量正文\n', '回写后磁盘归一为 canonical 形态')
    const H2 = newInstance()
    const g2 = await H2['notes-get']({ id: 'n-fmlegacy77' })
    assert.strictEqual(g2.note.body, '存量正文\n', '归一回写后读回稳定')
    const H3 = newInstance()
    await H3['notes-update']({ id: 'n-fmlegacy77', body: g2.note.body })
    const H4 = newInstance()
    const g3 = await H4['notes-get']({ id: 'n-fmlegacy77' })
    assert.strictEqual(g3.note.body, '存量正文\n', '第三轮读回零增长（稳定收口）')
  })

  // ---- 77.3 front-matter 键值解析零回归：全字段往返逐键一致 + CRLF 文件鲁棒 ----
  await t('front-matter 键值解析零回归：全字段磁盘往返逐键一致 + CRLF 存量文件鲁棒', async () => {
    const c = await handlers['notes-create']({
      title: '键值:含"引号"样本', body: '键值正文\n第二行', topic: '加固',
      tags: ['甲', '乙'], inject: true, injectRole: 'reference', injectTo: ['abc12345'],
    })
    assert(c && c.id, '样本创建成功')
    const H1 = newInstance()
    const g = await H1['notes-get']({ id: c.id })
    assert.strictEqual(g.note.title, '键值:含"引号"样本', 'title 含冒号+引号往返逐字节（escYaml 引号/反转义链）')
    assert.deepStrictEqual(g.note.tags, ['甲', '乙'], 'tags 数组往返一致')
    assert.strictEqual(g.note.inject, true, 'inject=true 往返')
    assert.strictEqual(g.note.injectRole, 'reference', 'injectRole=reference 往返（inject=true 才落盘的条件行）')
    assert.deepStrictEqual(g.note.injectTo, ['abc12345'], 'injectTo 短 id 透传往返')
    assert.strictEqual(g.note.body, '键值正文\n第二行', '正文往返逐字节')
    // CRLF 存量文件（Windows 编辑回流场景）：分隔符 \r\n 同样被吃掉，正文逐字节
    await fsMock.writeText(notePath('n-fmcrlf77'), '---\r\nid: n-fmcrlf77\r\ntitle: CRLF样本\r\ntopic: 加固\r\n---\r\n\r\nCRLF正文\r\n')
    const H2 = newInstance()
    const gc = await H2['notes-get']({ id: 'n-fmcrlf77' })
    assert.strictEqual(gc.note.body, 'CRLF正文\r\n', 'CRLF 存量文件：分隔符空行归一 + 正文 CRLF 逐字节保留')
    assert.strictEqual(gc.note.title, 'CRLF样本', 'CRLF front-matter 键值解析正常')
  })

  // ---- 77.4 双端同源：buildFM/parseFM 区块 dev 拼接 ⇄ index.mjs ⇄ 模块源三方逐字节一致 + 口径锚点 ----
  await t('front-matter 双端同源：buildFM/parseFM 区块三处逐字节一致 + 分隔符口径锚点', () => {
    const fmSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'kernel', 'front-matter.js'), 'utf8').replace(/\r\n/g, '\n')
    // front-matter.js = 双包逐字节一致片（manifest.dev/dist 同名引用同一物理文件，无 .dist 变体）：
    //   开发版拼接产物与静态包 index.mjs 内的 buildFM→parseFM 区块必须与模块源逐字节一致
    const carve = (s, tag) => {
      const i = s.indexOf('function buildFM')
      const j = s.indexOf('return { meta, body }', i)
      assert(i >= 0 && j > i, tag + ' buildFM/parseFM 锚点在位')
      return s.slice(i, j)
    }
    const expect = carve(fmSrc, '模块源')
    assert.strictEqual(carve(hostSrc, 'host 开发版拼接'), expect, 'host 开发版拼接 ⇄ 模块源逐字节一致')
    assert.strictEqual(carve(indexSrc, '静态包 index.mjs'), expect, '静态包 index.mjs ⇄ 模块源逐字节一致（改源后需跑 node scripts/build-dist.cjs）')
    // 口径锚点：buildFM 单换行收尾（不再多写空行）+ parseFM 吃掉闭合后全部前导换行
    assert(fmSrc.indexOf("'deleted: ' + escYaml(m.deleted || 'false') + '\\n' +") >= 0, 'buildFM 末键行锚点在位')
    assert(fmSrc.indexOf("\n        '---\\n'\n") >= 0, 'buildFM 闭合分隔符单换行收尾（代码行 \'---\\n\' 在位）')
    assert(fmSrc.indexOf("\n        '---\\n\\n'") < 0, 'buildFM 无旧口径代码行残留（独立行 \'---\\n\\n\' 已消除）')
    assert(fmSrc.indexOf('---(?:\\r?\\n)*([\\s\\S]*)$') >= 0, 'parseFM 吃掉闭合 --- 后全部连续前导换行（正则锚点）')
    assert(indexSrc.indexOf("---(?:\\r?\\n)*") >= 0, '静态包同口径（build-dist 已刷新）')
  })
  }
}
