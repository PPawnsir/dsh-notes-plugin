// 节 75. 0.4.3⑦：守卫扩展 + README 哲学节（收官，notes-043-guard）
// 行为规格（总纲 n-muufiroz67it 卡7/7）：①索引 lint——§1 行格式合规（正则 `- [[id]] when`，异形行管线静默忽略 → lint 兜底检出）；
//   ②死链行标记——查图（notes-graph：to 不存在）检出手造死挂载行 + 清理后归零（行为级 fixture）；③「待补」占位行清单——
//   全库正文扫描挂 S.guardPending 报告尾部打印（复用 §68 未覆盖清单模式：只提示不阻塞，--core/--only 照常统计）；
//   ④README 哲学节——「笔记网络」定名与两问句 / 四类边表 / 根索引模式（数据集中在链接的伴生笔记、原正文零触碰，四实例）/
//   记忆治理三层（inject=强 / 任务挂载=中 / 索引目录=弱）+ 总纲红线条款在 README 有对应句；中英双版 + sync-pkg-readme 四文件同步断言。
module.exports = {
  id: "75",
  title: "75. 守卫扩展（索引行格式 lint / 死链行标记 / 待补清单）+ README 哲学节（笔记网络）（notes-043-guard）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  const { handlers } = S
  section('75. 守卫扩展（索引行格式 lint / 死链行标记 / 待补清单）+ README 哲学节（笔记网络）（notes-043-guard）')

  // ---- 共用：§1 行区提取 + 行格式 lint（守卫①②同一口径）----
  // 索引托管行格式（与 injectindex.js INJECT_INDEX_TPL.lineRe 消费口径一致）：`- [[id]] when`——
  // 识别不出该形态的行 rootNoteSplit 归入备注区（others）、idxLinesSync 静默忽略，故管线不会报错——lint 是唯一兜底。
  const IDX_LINE_RE = /^-\s\[\[[^\[\]\r\n]+\]\]\s\S/
  // 0.4.3 验收修复④：v2 预设不再含「## §2 召回指标」锚（指标迁出走卡⑤）——§1 行区 = HEAD1 之后到下一「## 」节标题
  //   （存量带 §2 索引同口径命中旧锚）或 EOF，两种形态通用
  const HEAD1 = '## §1 挂载清单'
  async function idxBody() {
    const ml = await handlers['notes-mount-list']({})
    assert(ml && ml.indexNoteId, '索引笔记 id 可得（前置：节 73 已建/自愈）')
    const g = await handlers['notes-get']({ id: ml.indexNoteId })
    assert(g && g.note && !g.error, '索引笔记正文可达')
    return { indexNoteId: ml.indexNoteId, body: g.note.body }
  }
  // §1 行区行清单（HEAD1 至下一「## 」节标题或 EOF 之间非空行——备注区行也计入 lint：格式违规行落备注区同样要被看见）
  function idxSectionLines(body) {
    const lines = body.split('\n')
    const i1 = lines.indexOf(HEAD1)
    if (i1 < 0) return []
    let i2 = lines.length
    for (let i = i1 + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i].trim())) { i2 = i; break } }
    return lines.slice(i1 + 1, i2).filter(l => l.trim() !== '')
  }
  function idxLint(body) {
    return idxSectionLines(body).filter(l => !IDX_LINE_RE.test(l))
  }

  // ===== 守卫① 索引 §1 行格式 lint（行为级：现行索引全合规 + 异形行检出 + 还原归零）=====
  await t('守卫① 索引行格式：现行索引 §1 全部合规（正则 `- [[id]] when`）+ notes-mount-list 解析行与正文行数一致', async () => {
    const { body } = await idxBody()
    assert.deepStrictEqual(idxLint(body), [], '现行索引 §1 无格式违规行（实得：' + JSON.stringify(idxLint(body)) + '）')
    const ml = await handlers['notes-mount-list']({})
    assert(ml.lines.length === idxSectionLines(body).length, 'mount-list 解析行数 = §1 正文行数（' + ml.lines.length + ' = ' + idxSectionLines(body).length + '；漂移即管线与 lint 口径失同步）')
  })

  await t('守卫① 行为级：注入异形行 → 管线静默忽略（mount-list 不变）而 lint 检出 → 还原后归零', async () => {
    const { indexNoteId, body } = await idxBody()
    const before = (await handlers['notes-mount-list']({})).lines.length
    const BAD = '这一行没有双链，是手写备注误入 §1 的格式违规样例'
    const lines = body.split('\n')
    const i1 = lines.indexOf(HEAD1)
    const mutated = lines.slice(0, i1 + 1).concat([BAD]).concat(lines.slice(i1 + 1)).join('\n')
    const u = await handlers['notes-update']({ id: indexNoteId, body: mutated })
    assert(!u.error, '索引正文可直改（异形行注入前置）')
    // 管线侧：lineRe 不识别 → mount-list 静默忽略（行数不变）——这正是 lint 存在的理由
    const after = (await handlers['notes-mount-list']({})).lines
    assert.strictEqual(after.length, before, '异形行被管线静默忽略（mount-list 行数不变 = ' + before + '）')
    // lint 侧：兜底检出
    const g = await handlers['notes-get']({ id: indexNoteId })
    const bad = idxLint(g.note.body)
    assert.strictEqual(bad.length, 1, 'lint 检出恰 1 条异形行（实得：' + JSON.stringify(bad) + '）')
    assert(bad[0].indexOf(BAD) >= 0, '检出行即注入行（逐字节）')
    // 还原 → 归零（§2 与其余正文逐字节复原）
    await handlers['notes-update']({ id: indexNoteId, body: body })
    const g2 = await handlers['notes-get']({ id: indexNoteId })
    assert(g2.note.body === body, '索引正文逐字节还原')
    assert.deepStrictEqual(idxLint(g2.note.body), [], '还原后 lint 归零')
  })

  // ===== 守卫② 死链行标记（查图：to 不存在；行为级 fixture：手造死挂载行 → 检出 → 清理归零）=====
  await t('守卫② 死链行：挂载后删笔记不产生死挂载行（联动摘行）→ 手造死链行 notes-graph 检出（type=mount + from=索引）→ 清理后归零', async () => {
    const { indexNoteId, body } = await idxBody()
    // 前置联动复验：挂载 → 软删（行被联动摘除）→ 图无死挂载边
    const x = await handlers['notes-create']({ title: '守卫②死链fixtureX', body: 'X', inject: true, injectRole: 'reference', topic: '资料' })
    await handlers['notes-delete']({ id: x.id })
    let g = await handlers['notes-graph']({ rebuild: true })
    assert(!(g.dead || []).some(d => d.type === 'mount' && d.from === indexNoteId), '删笔记联动摘行 → 无死挂载边（死链预防已在管线内闭环）')
    // 手造死链行：绕过管线直改索引正文（模拟手编辑器/外部写入产生的死链）→ 查图检出
    const DEADLINE = '- [[' + x.id + ']] 已删笔记的死链行 fixture'
    await handlers['notes-update']({ id: indexNoteId, body: body + '\n' + DEADLINE })
    g = await handlers['notes-graph']({ rebuild: true })
    const deadIdx = (g.dead || []).filter(d => d.type === 'mount' && d.from === indexNoteId)
    assert.strictEqual(deadIdx.length, 1, '查图检出恰 1 条索引死挂载边（实得：' + JSON.stringify(deadIdx) + '）')
    assert(deadIdx[0].target === x.id && deadIdx[0].from === indexNoteId, '死边形态：{ from: 索引, target: 已删id, type: mount }')
    // lint 与图口径互证：§1 行格式合规（死链行形态合法）但目标不存在——死链不是格式问题，必须查图
    const gIdx = await handlers['notes-get']({ id: indexNoteId })
    assert.deepStrictEqual(idxLint(gIdx.note.body), [], '死链行格式合规（lint 不报）——死链检测必须查图，两守卫互补')
    // 清理 → 归零
    await handlers['notes-update']({ id: indexNoteId, body: body })
    g = await handlers['notes-graph']({ rebuild: true })
    assert((g.dead || []).every(d => !(d.type === 'mount' && d.from === indexNoteId)), '清理后索引零死挂载边（收口态）')
  })

  // ===== 守卫③ 「待补」占位行清单（复用 §68 未覆盖清单模式：只提示不阻塞，挂 S.guardPending 报告尾部打印）=====
  // 扫描口径：全库存活笔记（含 kind=log 日志，不含已删/墓碑）正文逐行，命中 /待补[:：]|TODO[:：]/ 即占位行；
  // 计算在 t() 断言体之外照常执行（--core/--only 同效）；清单只打印不计数失败——补齐由人裁决，不是回归红绿灯。
  const PENDING_RE = /(待补|TODO)[:：]/
  async function pendingScan() {
    const lst = (await handlers['notes-list']({ includeLogs: true })).notes || []
    const ids = lst.map(n => n.id)
    const bat = await handlers['notes-get-batch']({ ids })
    const rows = []
    for (const n of (bat.notes || [])) {
      const hits = String(n.body || '').split('\n').filter(l => PENDING_RE.test(l))
      if (hits.length) rows.push({ id: n.id, title: (lst.find(x => x.id === n.id) || {}).title || '', lines: hits.length })
    }
    return { scanned: ids.length, files: rows, total: rows.reduce((s, r) => s + r.lines, 0) }
  }
  let pendFix
  await t('守卫③ 待补清单行为级：占位行 fixture → 扫描命中 → 删除后排除 + 清单挂 S.guardPending（只提示不阻塞）', async () => {
    pendFix = await handlers['notes-create']({ title: '守卫③待补fixture', body: '正文\n- 待补：补齐截图\n- 普通行', topic: '未分类' })
    const hit = await pendingScan()
    const row = hit.files.find(r => r.id === pendFix.id)
    assert(row && row.lines === 1, '占位行被扫描命中恰 1 行（实得：' + JSON.stringify(row) + '）')
    assert(hit.total >= 1 && hit.scanned >= 1, '扫描面非空（scanned=' + hit.scanned + ' total=' + hit.total + '）')
    await handlers['notes-delete']({ id: pendFix.id })
    const after = await pendingScan()
    assert(!after.files.some(r => r.id === pendFix.id), '删除后占位行排除（软删不进扫描面）')
    S.guardPending = after
    assert(S.guardPending && typeof S.guardPending.total === 'number', '待补清单已挂 S.guardPending（报告尾部打印）')
  })

  // ===== ④ README 哲学节（中英双版）+ sync-pkg-readme 四文件同步断言 + 总纲红线条款对应句 =====
  const ROOT_ZH = fsNative.readFileSync(path.join(DIR, 'README.md'), 'utf8')
  const ROOT_EN = fsNative.readFileSync(path.join(DIR, 'README.en.md'), 'utf8')
  const PKG_ZH = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'README.md'), 'utf8')
  const PKG_EN = fsNative.readFileSync(path.join(DIR, 'packages', 'dsh-notes-plugin', 'README.en.md'), 'utf8')
  await t('README 四文件同步：双语言发布包 README = 根 README 仅图片路径改写（sync-pkg-readme 同口径，逐字节）', () => {
    assert(PKG_ZH === ROOT_ZH.split('packages/dsh-notes-plugin/docs/').join('./docs/'), '发布包 README.md ≠ 根 README.md 路径改写产物（须跑 scripts/sync-pkg-readme.cjs）')
    assert(PKG_EN === ROOT_EN.split('packages/dsh-notes-plugin/docs/').join('./docs/'), '发布包 README.en.md ≠ 根 README.en.md 路径改写产物（sync-pkg-readme 四文件同步）')
    const s = fsNative.readFileSync(path.join(DIR, 'scripts', 'sync-pkg-readme.cjs'), 'utf8')
    assert(s.indexOf("'README.en.md'") >= 0, 'sync-pkg-readme.cjs 已扩为四文件同步（zh + en 双双入包）')
  })
  await t('README 哲学节（中文版）：「笔记网络」定名 + 裁决两问句 + 四类边表 + 根索引模式（伴生笔记/零触碰/四实例）+ 记忆治理三层', () => {
    for (const a of ['## 设计哲学：笔记网络', '不断生长的笔记引用网络', '它的节点是什么', '它的边是什么']) assert(ROOT_ZH.indexOf(a) >= 0, 'zh 缺哲学节锚点：' + a)
    // 四类边表（双链/软链/索引挂载/派发挂载，各成表行）
    for (const e of ['| 双链 |', '| 软链 |', '| 索引挂载 |', '| 派发挂载 |']) assert(ROOT_ZH.indexOf(e) >= 0, 'zh 四类边表缺行：' + e)
    // 根索引模式：数据集中在链接的伴生笔记 + 原正文零触碰 + 四实例点名
    for (const a of ['根索引模式', '伴生笔记', '原正文零触碰', '执行记录', '记忆档案', '召回指标', '注入索引']) assert(ROOT_ZH.indexOf(a) >= 0, 'zh 根索引模式缺锚点：' + a)
    // 记忆治理三层（召回保证性分级，口径 [[n-mutuleeetvxd]] 逐字）
    for (const a of ['记忆治理三层', 'inject', '任务挂载', '索引目录', '强保证', '中保证', '弱保证']) assert(ROOT_ZH.indexOf(a) >= 0, 'zh 记忆治理三层缺锚点：' + a)
  })
  await t('总纲红线条款在 README 有对应句（四条红线逐条落字）+ README.en 哲学节镜像（英文版同锚）', () => {
    // 0.4.3⑦：第四条红线由「日志默认隐身」改为「日志同权 + 注入硬关」（R-6 UI 隐身推翻，锚点同步演进）
    for (const a of ['约定桶全文注入不动', '资料默认不注入', '档案', '指标', '永不注入', '注入硬关']) assert(ROOT_ZH.indexOf(a) >= 0, 'zh 红线对应句缺锚点：' + a)
    for (const a of ['## Design Philosophy: The Note Network', 'What are its nodes', 'What are its edges', 'Wiki link', 'Soft link', 'Index mount', 'Dispatch mount', 'Root-index pattern', 'Memory governance tiers', 'strong guarantee', 'medium guarantee', 'weak guarantee']) assert(ROOT_EN.indexOf(a) >= 0, 'en 哲学节缺锚点：' + a)
    for (const e of ['| Wiki link |', '| Soft link |', '| Index mount |', '| Dispatch mount |']) assert(ROOT_EN.indexOf(e) >= 0, 'en 四类边表缺行：' + e)
    for (const a of ['execution log', 'memory archive', 'recall metrics', 'injection index']) assert(ROOT_EN.indexOf(a) >= 0, 'en 根索引四实例缺锚点：' + a)
  })
  }
}
