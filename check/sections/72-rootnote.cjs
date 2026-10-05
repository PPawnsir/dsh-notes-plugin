// 节 72. 0.4.3 内核②：RootNote 托管节框架 + runLog 迁移等价回归（notes-043-rootnote）
// 框架：src/host/rootnote.js 声明式模板（锚点节标题/行格式/排序/容量裁尾/幂等键/软链键）
//   → ensureRootNote（懒创建+软链回写）/appendLine（幂等+裁尾）/removeLine（节外零触碰）。
// 测试策略：框架块从 host 产物提取 vm 沙箱行为级 eval（stub _create/loadNote/persistNote）
//   + runLog 首消费者等价回归（真 handlers：回执链路 → 框架路径产出既有格式，节 59 全量绿 = 逐字节等价证明）。
module.exports = {
  id: "72",
  title: "72. 内核②：RootNote 托管节框架 + runLog 迁移等价回归（notes-043-rootnote）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { handlers, evtListeners, liveAgent } = S
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'
  const fireIdle = () => { for (const fn of evtListeners['agent/status']) fn({ agent: liveAgent, status: 'idle' }) }
  const flush = () => new Promise(r => setTimeout(r, 80))
  section('72. 内核②：RootNote 托管节框架 + runLog 迁移等价回归（notes-043-rootnote）')

  // ---- 72.0 落地结构：rootnote.js 双清单共源登记 + runLog 迁移静态锚 ----
  await t('内核② 落地结构：src/host/rootnote.js 存在 + 双清单同名共源 + schedule.js runLog 迁移为框架消费者', () => {
    assert(fsNative.existsSync(path.join(DIR, 'src', 'host', 'rootnote.js')), 'src/host/rootnote.js 存在')
    const devM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dev.js'), 'utf8')
    const distM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dist.js'), 'utf8')
    assert(devM.indexOf("'rootnote.js'") >= 0 && distM.indexOf("'rootnote.js'") >= 0, '双清单同名登记 rootnote.js（共源单份，无 .dist 变体）')
    assert(!fsNative.existsSync(path.join(DIR, 'src', 'host', 'rootnote.dist.js')), 'rootnote.js 不得出现 .dist 变体（第三份拷贝红线）')
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('==== rootnote BEGIN ====') >= 0 && src.indexOf('==== rootnote END ====') >= 0, tag + ' 含 rootnote 标记块')
      assert(src.indexOf('function rootNoteRender(') >= 0 && src.indexOf('async function rootNoteAppendEnsured(') >= 0, tag + ' 框架 API 在位（render + appendEnsured）')
      assert(src.indexOf('async function rootNoteRemoveLine(') >= 0 && src.indexOf('async function rootNoteEnsure(') >= 0, tag + ' ensure/removeLine API 在位')
    }
    // runLog 迁移等价（静态）：schedule-runlog 块改为框架消费者——本地 render 循环上收，模板声明齐备
    const blk = hostSrc.match(/\/\/ ==== schedule-runlog BEGIN ====[\s\S]*?\/\/ ==== schedule-runlog END ====/)
    assert(blk, 'schedule-runlog 标记块在位')
    assert(blk[0].indexOf('rootNoteAppendEnsured(note, SCHED_RUNLOG_TPL, items)') >= 0, 'runLog 追加走 RootNote 框架组合口')
    assert(blk[0].indexOf('function schedRunLogRender(') < 0, '本地 render 循环已上收框架（零重复实现）')
    assert(blk[0].indexOf('const SCHED_RUNLOG_TPL = {') >= 0 && blk[0].indexOf('keyOfEntry: function (d) { return d.msgId }') >= 0, 'runLog 消费者模板：msgId 幂等键声明')
    assert(blk[0].indexOf('max: SCHED_RUNLOG_MAX') >= 0 && blk[0].indexOf('linkOf: function (note) { return note.schedule && note.schedule.runLog }') >= 0, 'runLog 消费者模板：容量 + schedule.runLog 软链键')
  })

  // ---- 72.1 框架行为级（vm 沙箱：stub 存储） ----
  const blkM = hostSrc.match(/\/\/ ==== rootnote BEGIN ====[\s\S]*?\/\/ ==== rootnote END ====/)
  assert(blkM, 'rootnote 标记块可提取')
  const sandbox = {}
  const store = {}
  let seq = 0
  const creates = []
  let persistCalls = []
  sandbox._create = async function (title, body, tags, topic, opts) {
    const n = { id: 'n-rn' + (++seq), title: title, body: body, tags: tags || [], topic: topic || '未分类', kind: (opts && opts.kind) || 'note', folder: opts && opts.folder }
    store[n.id] = n; creates.push(n)
    return { id: n.id }
  }
  sandbox.loadNote = async function (id) { return store[id] || null }
  sandbox.persistNote = async function (n, opts) { store[n.id] = n; persistCalls.push({ id: n.id, history: !!(opts && opts.history) }) }
  const RN = new Function('_create', 'loadNote', 'persistNote',
    blkM[0] + '\n;return { rootNoteTpl: rootNoteTpl, rootNoteSplit: rootNoteSplit, rootNoteRender: rootNoteRender, rootNoteEnsure: rootNoteEnsure, rootNoteAppend: rootNoteAppend, rootNoteAppendEnsured: rootNoteAppendEnsured, rootNoteRemoveLine: rootNoteRemoveLine }'
  )(sandbox._create, sandbox.loadNote, sandbox.persistNote)
  const tplOf = (over) => RN.rootNoteTpl(Object.assign({
    head: '## §测试节（自动）', max: 3, newestFirst: true,
    keyOfLine: (l) => { const m = l.match(/（([^）]+)）/); return m ? '（' + m[1] + '）' : l },
    lineOf: (d) => '- 条目（' + d + '）'
  }, over || {}))
  const entryLines = (body) => String(body || '').split('\n').filter(l => /^- /.test(l))

  await t('框架·节锚点不存在则创建：无锚正文首写补锚点行，头部前言与备注区保留（节外零触碰）', async () => {
    const tpl = tplOf()
    const out = RN.rootNoteRender('用户手写前言\n正文备注行', tpl, ['- 条目（m2）', '- 条目（m1）'])
    const lines = out.split('\n')
    assert.strictEqual(lines[0], '## §测试节（自动）', '首行补锚点节标题')
    const es = entryLines(out)
    assert.deepStrictEqual(es, ['- 条目（m2）', '- 条目（m1）'], '新条目在前（新→旧缺省排序）')
    assert(out.indexOf('用户手写前言') >= 0 && out.indexOf('正文备注行') >= 0, '用户手写正文逐字保留（节外零触碰红线）')
    assert(out.endsWith('\n'), '尾部换行收口（与 runLog 现状格式一致）')
    // 已有锚点：锚点行与其前头部逐字节保留
    const out2 = RN.rootNoteRender('标题行\n## §测试节（自动）\n\n- 旧（m0）\n\n备注尾巴', tpl, ['- 条目（m1）'])
    assert(out2.indexOf('标题行\n## §测试节（自动）\n') === 0, '锚点行及其前头部逐字节保留')
    assert(out2.trimEnd().endsWith('备注尾巴'), '备注区缀尾保留')
  })

  await t('框架·幂等重放：同幂等键条目已存在跳过（append 双通道 + render 级去重）', async () => {
    const host = { id: 'h-idem', title: '宿主', schedule: { runLog: 'rl-idem' } }
    store['rl-idem'] = { id: 'rl-idem', body: '## §测试节（自动）\n\n- 条目（m1）\n' }
    const tpl = tplOf({ keyOfEntry: (d) => d })
    let rl = await sandbox.loadNote('rl-idem')
    const r1 = await RN.rootNoteAppend(rl, tpl, ['m1'])
    assert.strictEqual(r1, false, '同幂等键重放零追加（append 返回 false 不落盘）')
    assert.strictEqual(store['rl-idem'].body, '## §测试节（自动）\n\n- 条目（m1）\n', '正文逐字节不动')
    const r2 = await RN.rootNoteAppend(rl, tpl, ['m2', 'm1', 'm2'])
    assert.strictEqual(r2, true, '新键落盘')
    assert.deepStrictEqual(entryLines(store['rl-idem'].body), ['- 条目（m2）', '- 条目（m1）'], '重放条目去重 + 新条目前置')
  })

  await t('框架·容量裁尾：max 上限裁尾（最旧裁掉）+ 旧→新排序模式', async () => {
    const tpl = tplOf({ keyOfEntry: (d) => d })
    let body = ''
    for (let i = 1; i <= 5; i++) body = RN.rootNoteRender(body, tpl, [tpl.lineOf('m' + i)])
    const es = entryLines(body)
    assert.strictEqual(es.length, 3, 'max=3 裁尾（实得 ' + es.length + '）')
    assert(es[0].indexOf('（m5）') >= 0 && body.indexOf('（m1）') < 0 && body.indexOf('（m2）') < 0, '保最新裁最旧')
    const tplOld = tplOf({ keyOfEntry: (d) => d, newestFirst: false })
    const bodyOld = RN.rootNoteRender('', tplOld, ['- 条目（n1）', '- 条目（n2）'])
    assert.deepStrictEqual(entryLines(bodyOld), ['- 条目（n1）', '- 条目（n2）'], 'newestFirst=false 旧→新排序')
  })

  await t('框架·懒创建 + 软链回写 + 机器产物零历史快照（appendEnsured 双调用单创建）', async () => {
    const before = creates.length
    const host = { id: 'h-ensure', title: '宿主 · 测试', topic: '运维', folder: 'f1', schedule: {} }
    const writeCalls = []
    const tpl = tplOf({
      keyOfEntry: (d) => d,
      linkOf: (n) => n.schedule.runLog,
      writeLink: async (n, rlId) => { n.schedule.runLog = rlId; writeCalls.push(rlId) },
      titleOf: (n) => n.title + ' · 托管',
      topicOf: (n) => n.topic
    })
    const rl1 = await RN.rootNoteAppendEnsured(host, tpl, ['e1'])
    assert(rl1 && rl1.id, '首写懒创建托管笔记')
    assert.strictEqual(rl1.title, '宿主 · 测试 · 托管', '标题随 titleOf')
    assert.strictEqual(rl1.topic, '运维', 'topic 随 hostNote')
    assert.strictEqual(rl1.kind, 'note', 'kind 缺省 note（可见可检索）')
    assert.strictEqual(writeCalls.length, 1, 'writeLink 软链回写恰一次')
    const rl2 = await RN.rootNoteAppendEnsured(host, tpl, ['e1'])
    assert.strictEqual(rl2.id, rl1.id, '二次调用复用软链目标')
    assert.strictEqual(creates.length, before + 1, '零重复创建（懒创建语义）')
    assert.strictEqual(writeCalls.length, 1, '软链回写仍恰一次')
    assert.deepStrictEqual(persistCalls.filter(c => c.id === rl1.id), [{ id: rl1.id, history: false }], '机器产物 persistNote {history:false} 零历史快照')
    assert.strictEqual(store[rl1.id].body, '## §测试节（自动）\n\n- 条目（e1）\n', '首写正文 = 锚点 + 条目')
  })

  await t('框架·removeLine：按幂等键摘行 + 节外零触碰 + 键未命中零改动', async () => {
    store['rl-rm'] = { id: 'rl-rm', body: '## §测试节（自动）\n\n- 条目（k1）\n- 条目（k2）\n\n备注尾巴\n' }
    const tpl = tplOf()
    const rl = await sandbox.loadNote('rl-rm')
    const r1 = await RN.rootNoteRemoveLine(rl, tpl, '（k1）')
    assert.strictEqual(r1, true, '命中键摘除落盘')
    assert.strictEqual(store['rl-rm'].body, '## §测试节（自动）\n\n- 条目（k2）\n\n备注尾巴\n', '目标行摘除，锚点行/备注区逐字节保留')
    const r2 = await RN.rootNoteRemoveLine(rl, tpl, '（幽灵）')
    assert.strictEqual(r2, false, '键未命中零改动不落盘')
    assert.strictEqual(store['rl-rm'].body, '## §测试节（自动）\n\n- 条目（k2）\n\n备注尾巴\n', '正文仍逐字节不动')
  })

  // ---- 72.2 runLog 等价回归（真 handlers：回执链路 → 框架路径 → 既有格式产出） ----
  // 先等启动补评估闸沉降（同节 59 口径），再驱动注入时钟
  for (let i = 0; i < 40; i++) {
    const probe = await handlers['notes-schedule-eval']({ now: '2020-01-01T00:00:00.000Z' })
    if (probe && !probe.skipped) break
    await new Promise(r => setTimeout(r, 50))
  }
  await t('runLog 等价回归：回执链路经 RootNote 框架产出既有格式（软链回写 + 锚点节 + 倒序条目 + 约定正文零改动）', async () => {
    const c = await handlers['notes-create']({ title: '定时 巡检rn-equiv', body: '等价回归正文（必须逐字节不动）', kind: 'todo', topic: '运维', contractType: 'dispatch-schedule', schedule: { every: '3d', target: LIVE_SID } })
    assert(c && c.id && !c.error, '创建调度约定成功')
    await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 4 * 86400000).toISOString() })
    let g = await handlers['notes-get']({ id: c.id })
    const m1 = g.note.schedule.lastRun.receiptId
    fireIdle(); await flush()
    g = await handlers['notes-get']({ id: c.id })
    const rlId = g.note.schedule.runLog
    assert(rlId, '首条回执后 runLog 软链已回写（框架 writeLink 通道）')
    await handlers['notes-schedule-eval']({ now: new Date(Date.now() + 8 * 86400000).toISOString() })
    g = await handlers['notes-get']({ id: c.id })
    const m2 = g.note.schedule.lastRun.receiptId
    assert(m2 && m2 !== m1, '第二次触发不同 msgId')
    fireIdle(); await flush()
    const rl = await handlers['notes-get']({ id: rlId })
    assert.strictEqual(rl.note.title, '定时 巡检rn-equiv · 执行记录', '标题 = 约定标题 + 「 · 执行记录」（框架 titleOf）')
    assert.strictEqual(rl.note.kind, 'sys', 'kind=sys（0.4.3⑥ runLog 系统根笔记归位）')
    assert(rl.note.body.indexOf('## 执行记录（自动）') === 0, '锚点节标题在首行（框架 head）')
    const lines = rl.note.body.split('\n').filter(l => /^- /.test(l))
    assert.strictEqual(lines.length, 2, '两条目（实得 ' + lines.length + '）')
    assert(lines[0].indexOf(m2) >= 0 && lines[1].indexOf(m1) >= 0, '倒序（最新在前）——框架 newestFirst 消费')
    const g2 = await handlers['notes-get']({ id: c.id })
    assert.strictEqual(g2.note.body, '等价回归正文（必须逐字节不动）', '约定正文逐字节不动（节外零触碰红线经 runLog 复验）')
    // 幂等重放：重复 idle 零追加
    fireIdle(); await flush()
    const rl2 = await handlers['notes-get']({ id: rlId })
    assert.strictEqual(rl2.note.body, rl.note.body, '重复回执幂等零追加（框架 keyOfEntry=msgId 消费）')
    await handlers['notes-delete']({ id: c.id })
  })
  }
}
