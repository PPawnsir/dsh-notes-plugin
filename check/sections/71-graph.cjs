// 节 71. 笔记网络内核①：四类边统一建图 + 增量维护 + notes-graph 查询（notes-043-graph）
// 边类型：link（正文 [[双链]]）/ mount（行首列表项挂载行）/ softref（schedule.runLog 软链）/ dispatch（派发记录 → session: 命名空间）。
// 行为级断言：建图正确性（双链 id/标题双通道 + 死链 + 软链 + 派发）+ 增量一致性（删/复/改名/复活后与 rebuild 全量重建等价）+ RPC 三查询。
module.exports = {
  id: "71",
  title: "71. 笔记网络内核①：四类边建图 + 增量维护 + notes-graph 查询（notes-043-graph）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, osNative, DIR, SRC_HOST, SRC_CLIENT, SRC_STYLES, INDEX_PATH, bootHostSrc, bootClientSrc, hostSrc, clientSrc, indexSrc, pathToFileURL, io } = H
  const { handlers } = S
  // ===== 71. 笔记网络内核①（notes-043-graph）=====
  section('71. 笔记网络内核①：四类边建图 + 增量维护 + notes-graph 查询（notes-043-graph）')
  const LIVE_SID = 'session-abc12345-0000-0000-0000-000000000000'
  const sortEdges = (es) => es.slice().map(e => JSON.stringify([e.from, e.to, e.raw, e.type, e.via, e.dead === true, e.meta || {}])).sort()
  await t('内核① 落地结构：src/host/graph.js 双清单登记 + notes-graph RPC 注册（开发版 + 发布包 + 共源单份）', () => {
    assert(fsNative.existsSync(path.join(DIR, 'src', 'host', 'graph.js')), 'src/host/graph.js 存在')
    assert(hostSrc.indexOf("handle('notes-graph'") >= 0, '开发版 host 产物含 notes-graph 注册')
    assert(indexSrc.indexOf("handle('notes-graph'") >= 0, '发布包 index.mjs 含 notes-graph 注册')
    const devM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dev.js'), 'utf8')
    const distM = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'manifest.dist.js'), 'utf8')
    assert(devM.indexOf("'graph.js'") >= 0 && distM.indexOf("'graph.js'") >= 0, '双清单同名登记 graph.js（共源单份，无 .dist 变体）')
    assert(!fsNative.existsSync(path.join(DIR, 'src', 'host', 'graph.dist.js')), 'graph.js 不得出现 .dist 变体（第三份拷贝红线）')
    assert(hostSrc.indexOf('EDGE_REGISTRY') >= 0 && hostSrc.indexOf("type: 'softref'") >= 0 && hostSrc.indexOf('deadLinkable: false') >= 0, '边类型声明式注册表 EDGE_REGISTRY 在位（四描述符 + dispatch deadLinkable:false，notes-043-graph-registry）')
    // 0.4.3+ 事件总线（notes-043-event-bus）：graph 增量从 persistNote/_purge 洋葱包裹迁为 onNoteChanged 注册监听
    assert(hostSrc.indexOf('_graphPersistOrig') < 0 && hostSrc.indexOf('_graphPurgeOrig') < 0, 'host 产物洋葱包裹已拆除（无 _graphPersistOrig/_graphPurgeOrig）')
    assert(indexSrc.indexOf('_graphPersistOrig') < 0 && indexSrc.indexOf('_graphPurgeOrig') < 0, '发布包洋葱包裹已拆除')
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('==== notes-events BEGIN ====') >= 0 && src.indexOf('==== notes-events END ====') >= 0, tag + ' 含 notes-events 事件总线标记块')
      assert(src.indexOf('function onNoteChanged(fn)') >= 0 && src.indexOf('function _emitNoteChanged(ev)') >= 0, tag + ' 注册器/分发器在位')
      assert(src.indexOf("_emitNoteChanged({ event: 'purge', id: id })") >= 0, tag + ' _purge 落盘成功后分发 purge 事件')
    }
    const gblk = hostSrc.slice(hostSrc.indexOf('==== notes-graph BEGIN ===='), hostSrc.indexOf('==== notes-graph END ===='))
    assert(gblk.indexOf('onNoteChanged(function (ev)') >= 0, 'graph 改为 onNoteChanged 注册监听（增量逻辑搬入 listener）')
  })

  // ---- 71.1 建图正确性（fixture：双链 id/标题双通道 + 挂载行 + 死链 + 软链 + 派发）----
  const rB = await handlers['notes-create']({ title: '目标标题', body: '目标正文（被指向）' })
  const tBid = rB.id
  const rA = await handlers['notes-create']({ title: '链接源A', body: '见 [[' + tBid + ']] 与 [[目标标题]] 与 [[幽灵目标]]\n\n- [[' + tBid + ']] 挂载行示范' })
  const tAid = rA.id
  await t('建图：双链 id/标题双通道 + 挂载行单列 + 死链（to 不存在）', async () => {
    const g = await handlers['notes-graph']({ id: tAid })
    assert(g.exists && g.counts.out === 4, 'A 出边 4 条：id 链 + 标题链 + 挂载行 + 死链（实得 ' + JSON.stringify(g.counts) + '）')
    const toB = g.out.filter(e => e.to === tBid && !e.dead)
    assert.strictEqual(toB.length, 3, '指向 B 三条（link×2 via id/title + mount×1），实得 ' + toB.length)
    assert.deepStrictEqual(toB.map(e => e.type).sort(), ['link', 'link', 'mount'], '类型构成 link/link/mount')
    assert.deepStrictEqual(toB.map(e => e.via).sort(), ['id', 'title', 'id'].sort(), '解析路径 via id/title/id')
    const dead = g.out.filter(e => e.dead)
    assert.strictEqual(dead.length, 1, '死链恰 1 条（实得 ' + dead.length + '）')
    assert(dead[0].raw === '幽灵目标' && dead[0].type === 'link' && dead[0].to === '幽灵目标', '死链保留 raw=幽灵目标（死链 = to 不存在）')
  })
  await t('查询②反向：back 只收存活入边（A→B 两条 link + 一条 mount，自链除外）', async () => {
    const g = await handlers['notes-graph']({ id: tBid })
    assert(g.exists, 'B 在图中')
    assert(g.counts.back === 3, 'B 入边 3 条（实得 ' + g.counts.back + '）')
    assert(g.back.every(e => e.from === tAid && !e.dead), '入边全部来自 A 且存活')
  })
  await t('查询③过滤：type 单选（非法值报错）+ direction（out 不含 back / in 不含 out）', async () => {
    const gm = await handlers['notes-graph']({ id: tAid, type: 'mount' })
    assert(gm.counts.out === 1 && gm.out[0].type === 'mount', 'type=mount 只出挂载边')
    const err = await handlers['notes-graph']({ type: 'ghost' })
    assert(err.error && err.error.indexOf('link/softref/mount/dispatch') >= 0, '非法 type 显式报错（不错得静默）')
    const go = await handlers['notes-graph']({ id: tBid, direction: 'out' })
    assert(go.back.length === 0, 'direction=out 不含 back')
    const gi = await handlers['notes-graph']({ id: tBid, direction: 'in' })
    assert(gi.out.length === 0 && gi.back.length === 3, 'direction=in 只含 back')
  })

  // ---- 71.2 softref + dispatch 边 ----
  const rS = await handlers['notes-create']({ title: '调度约定S', body: '定时派发约定（测试）', contractType: 'dispatch-schedule', schedule: { at: '2027-06-01T09:00', target: LIVE_SID } })
  await handlers['notes-update']({ id: rS.id, schedule: { at: '2027-06-01T09:00', target: LIVE_SID, runLog: tBid } })
  const rD = await handlers['notes-dispatch']({ id: tAid, sessionId: LIVE_SID })
  await t('建图：softref（schedule.runLog 软链）+ dispatch（派发记录 → session: 命名空间，永不死链）', async () => {
    const gs = await handlers['notes-graph']({ id: rS.id, type: 'softref' })
    assert(gs.counts.out === 1 && gs.out[0].to === tBid && gs.out[0].meta.key === 'schedule.runLog', 'S→B softref 边（meta.key=schedule.runLog）')
    const gd = await handlers['notes-graph']({ id: tAid, type: 'dispatch' })
    assert(gd.counts.out === 1 && gd.out[0].to === 'session:' + LIVE_SID, 'A→session:<id> dispatch 边（实得 ' + JSON.stringify(gd.out) + '）')
    assert(gd.out[0].dead === false && gd.out[0].meta.status === 'sent', 'dispatch 边不死链 + status=sent 快照')
    const gb = await handlers['notes-graph']({ id: tBid })
    assert(gb.back.some(e => e.type === 'softref' && e.from === rS.id), 'B 反向含 softref 入边')
  })

  // ---- 71.3 增量维护：删节点级联 + 死链 + 恢复复活 ----
  await handlers['notes-delete']({ id: tBid })
  await t('增量：删节点级联——出边清零 + 指向它的边全部置死（含 softref），RPC exists=false', async () => {
    const g = await handlers['notes-graph']({ id: tBid })
    assert(g.exists === false, 'B 删除后 exists=false')
    const gA = await handlers['notes-graph']({ id: tAid })
    const deadToB = gA.out.filter(e => e.dead && (e.raw === tBid || e.raw === '目标标题'))
    assert.strictEqual(deadToB.length, 3, 'A 的 3 条指向 B 的边全部置死且保留 raw（实得 ' + deadToB.length + '）')
    const gs = await handlers['notes-graph']({ id: rS.id, type: 'softref' })
    assert(gs.out[0].dead === true, 'softref 边随目标删除置死')
    const ov = await handlers['notes-graph']({})
    assert(ov.dead.some(d => d.from === tAid && d.target === '幽灵目标'), '全图死链清单含幽灵目标')
  })
  await handlers['notes-restore']({ id: tBid })
  await t('增量：恢复复活——死链按 raw（id/标题）复活，与删除前等价', async () => {
    const gA = await handlers['notes-graph']({ id: tAid })
    assert(gA.out.filter(e => !e.dead && e.to === tBid).length === 3, '3 条边全部复活（实得 ' + gA.out.filter(e => !e.dead).length + ' 存活）')
    assert(gA.out.filter(e => e.dead).length === 1, '幽灵目标仍死链')
  })
  await t('增量：改名复估——旧标题边置死、新标题边复活/重建', async () => {
    const rC = await handlers['notes-create']({ title: '旧名C', body: 'C 正文' })
    const rE = await handlers['notes-create']({ title: '引用者E', body: '指向 [[旧名C]]' })
    let g = await handlers['notes-graph']({ id: rC.id })
    assert(g.counts.back === 1 && g.back[0].from === rE.id && g.back[0].via === 'title', '标题链初始命中')
    await handlers['notes-update']({ id: rC.id, title: '新名C' })
    g = await handlers['notes-graph']({ id: rC.id })
    assert(g.counts.back === 0, '改名后旧标题边置死（入边清零）')
    const gE = await handlers['notes-graph']({ id: rE.id })
    assert(gE.out[0].dead === true && gE.out[0].raw === '旧名C', 'E 的出边置死且 raw 保留旧名')
    await handlers['notes-update']({ id: rE.id, body: '指向 [[新名C]]' })
    g = await handlers['notes-graph']({ id: rC.id })
    assert(g.counts.back === 1 && g.back[0].via === 'title', '改指新标题后重新命中')
    await handlers['notes-delete']({ id: rE.id })
    await handlers['notes-delete']({ id: rC.id })
  })

  // ---- 71.4 增量一致性（行为级）：增量图 ≡ 全量重建（notes-graph {rebuild:true} 对照口）----
  await t('增量一致性：历经 create/update/delete/restore/dispatch/softref 后，增量图与 rebuild 全量重建逐边等价', async () => {
    const sortEdges = (es) => es.slice().map(e => JSON.stringify([e.from, e.to, e.raw, e.type, e.via, e.dead === true, e.meta || {}])).sort()
    const parity = async () => {
      const a = await handlers['notes-graph']({})
      const b = await handlers['notes-graph']({ rebuild: true })
      return { a, b, edgesEq: JSON.stringify(sortEdges(a.edgeList)) === JSON.stringify(sortEdges(b.edgeList)), nodesEq: a.nodes === b.nodes }
    }
    let r = await parity()
    if (!(r.edgesEq && r.nodesEq)) {
      // 并发容错：30s 常驻 cron tick 的效用账本顺带刷新（notes-043-ledger，fired>0 门）可能在两次读取之间
      // 全量重建 + 懒创建索引/档案笔记——属设计内后台写入，静默沉降后重试一次（终态一致即可，非放宽断言）
      await new Promise(r2 => setTimeout(r2, 120))
      r = await parity()
    }
    assert(r.edgesEq, '增量边集 ≡ 全量重建边集（canonical 序逐条一致）')
    assert.deepStrictEqual(r.a.byType, r.b.byType, 'byType 计数一致')
    assert.strictEqual(r.a.nodes, r.b.nodes, '节点数一致（实得 ' + r.a.nodes + ' !== ' + r.b.nodes + '）')
  })
  await t('增量：purge 级联清边（彻底删除节点出边全清 + RPC 不再出现）', async () => {
    await handlers['notes-delete']({ id: tAid })
    const pg = await handlers['notes-purge']({ id: tAid })
    assert(pg.purged === true, 'purge 成功')
    const ov = await handlers['notes-graph']({})
    assert(ov.edgeList.every(e => e.from !== tAid), '被 purge 节点的全部出边已级联清除')
    const g = await handlers['notes-graph']({ id: tAid })
    assert(g.exists === false && g.counts.out === 0, 'purge 后节点不存在且零出边')
  })

  // ---- 71.5 注册表扩展性（notes-043-graph-registry）：新边类型 = 追加一个 EDGE_REGISTRY 描述符，建图/类型清单/死链自动生效 ----
  await t('注册表扩展性：测试内注册临时第五类边描述符（fixture extract）→ 建图/类型清单/死链自动生效，无需改内核', async () => {
    const bMark = '==== notes-graph BEGIN ====', eMark = '==== notes-graph END ===='
    const b = hostSrc.indexOf(bMark), e = hostSrc.indexOf(eMark)
    assert(b >= 0 && e > b, 'host 产物含 notes-graph 标记块（注册表单测提取口）')
    const block = hostSrc.slice(hostSrc.lastIndexOf('\n', b) + 1, e + eMark.length)
    // 沙箱装配：stub handle/disposers/onNoteChanged/_list（fixture 笔记集），与 scratch 等价对照同模式；
    // （0.4.3+ notes-043-event-bus：graph 不再包装 persistNote/_purge，改持 onNoteChanged 注册器——沙箱同步换 stub）
    // 第五描述符走真实扩展路径——装配期注入 EDGE_REGISTRY 字面量（GRAPH_EDGE_TYPES 是装配期派生快照，扩展=注册表登记在先）
    const patched = block.replace('const EDGE_REGISTRY = [', 'const EDGE_REGISTRY = [\n      { type: \'tagref\', deadLinkable: true, resolve: \'full\', deadVia: \'raw\', extract: function (n) { return n.tagrefs || [] } },')
    assert(patched !== block, '装配期注入第五描述符成功（扩展 = 注册表追加一项，内核零改动）')
    const stubHandles = []
    const listeners = []
    const sandbox = new Function('handle', 'disposers', 'onNoteChanged', '_list',
      patched + '\n;return { EDGE_REGISTRY, GRAPH_EDGE_TYPES, graphState, _graphRebuild }')
    const tgt = { id: 'reg-tgt-000001', title: '注册目标X', body: '正文' }
    const src = { id: 'reg-src-000001', title: '注册源Y', body: 'tagref [[注册目标X]] 与 tagref [[幽灵注册]]' }
    const api = sandbox((name, fn) => { stubHandles.push([name, fn]); return fn }, [], (fn) => { listeners.push(fn) }, async () => [tgt, src])
    assert(api.graphState.built === false && api.EDGE_REGISTRY.length === 5, '沙箱图内核注册表含第五描述符且未建图')
    assert(listeners.length === 1 && typeof listeners[0] === 'function', '沙箱内 graph 已向 onNoteChanged 注册恰一个增量监听（事件总线接线）')
    tgt.tagrefs = [{ target: '注册目标X', meta: { fixture: 1 } }]
    src.tagrefs = [{ target: '注册目标X', meta: { fixture: 2 } }, { target: '幽灵注册', meta: { fixture: 3 } }]
    await api._graphRebuild()
    const es = api.graphState.edges.filter(x => x.type === 'tagref')
    assert.strictEqual(es.length, 3, '第五类边建图自动生效（3 条 tagref，实得 ' + es.length + '）')
    const live = es.find(x => x.from === 'reg-src-000001' && x.raw === '注册目标X')
    assert(live && !live.dead && live.to === 'reg-tgt-000001' && live.via === 'title', 'tagref 存活边走 id/标题双通道解析（与 link 同口径）')
    const dead = es.find(x => x.raw === '幽灵注册')
    assert(dead && dead.dead === true && dead.to === '幽灵注册' && dead.via === 'raw', 'tagref 死链语义自动生效（raw 保留原始形态）')
    assert(api.GRAPH_EDGE_TYPES.length === 5 && api.GRAPH_EDGE_TYPES.indexOf('tagref') >= 0, '类型清单由注册表派生自动扩展（RPC type 白名单/byType 键/错误消息同源跟随，实得 ' + JSON.stringify(api.GRAPH_EDGE_TYPES) + '）')
    assert(stubHandles.length === 1 && stubHandles[0][0] === 'notes-graph', '沙箱内 notes-graph RPC 正常注册')
  })

  // ---- 71.6 内核事件总线（notes-043-event-bus）：注册序 = 执行序 + 监听者异常隔离 + 事件类型推导 ----
  await t('事件总线：双监听者按注册序收事件 + 监听者抛错不影响其他监听者与分发主流程（异常隔离）+ 事件类型推导', () => {
    const bMark = '==== notes-events BEGIN ====', eMark = '==== notes-events END ===='
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      const b = src.indexOf(bMark), e = src.indexOf(eMark)
      assert(b >= 0 && e > b, tag + ' 含 notes-events 标记块（事件总线单测提取口）')
      const block = src.slice(src.lastIndexOf('\n', b) + 1, e + eMark.length)
      // 标记块零外部依赖（纯注册表实现）→ 可独立 eval
      const mk = () => new Function(block + '\n;return { onNoteChanged, _emitNoteChanged, _noteEventOf }')()
      // ①注册序 = 执行序：先注册先执行；persist/purge 双通道载荷形态（note / 仅 id）
      const api1 = mk()
      const seq = []
      api1.onNoteChanged((ev) => seq.push('L1:' + ev.event + ':' + (ev.note ? ev.note.id : ev.id)))
      api1.onNoteChanged((ev) => seq.push('L2:' + ev.event))
      api1._emitNoteChanged({ event: 'create', note: { id: 'n-ev1' } })
      api1._emitNoteChanged({ event: 'purge', id: 'n-ev2' })
      assert.strictEqual(seq.join('|'), 'L1:create:n-ev1|L2:create|L1:purge:n-ev2|L2:purge', tag + ' 注册序执行（实得：' + seq.join('|') + '）')
      // ②异常隔离：中间监听者抛错 → 前后监听者照常 + emit 不抛出（落盘主流程零阻塞红线）；错误只经 console.error 记录
      const api2 = mk()
      const seq2 = []
      const origErr = console.error
      let errLogged = 0
      console.error = () => { errLogged++ }
      try {
        api2.onNoteChanged(() => { seq2.push('A') })
        api2.onNoteChanged(() => { seq2.push('B'); throw new Error('监听者爆炸') })
        api2.onNoteChanged(() => { seq2.push('C') })
        api2._emitNoteChanged({ event: 'update', note: { id: 'n-ev3' } })   // 不抛出即主流程零阻塞
      } finally { console.error = origErr }
      assert.strictEqual(seq2.join(','), 'A,B,C', tag + ' 抛错监听者不影响其余监听者（实得：' + seq2.join(',') + '）')
      assert.strictEqual(errLogged, 1, tag + ' 异常经 console.error 记录恰一次（实得：' + errLogged + '）')
      // ③事件类型推导：create（无旧版）/ update / delete（deleted:true）/ restore（删除态重存）
      const api3 = mk()
      assert.strictEqual(api3._noteEventOf(null, { id: 'a' }), 'create', tag + ' 首写 → create')
      assert.strictEqual(api3._noteEventOf({ id: 'a' }, { id: 'a' }), 'update', tag + ' 已存改写 → update')
      assert.strictEqual(api3._noteEventOf({ id: 'a' }, { id: 'a', deleted: true }), 'delete', tag + ' 软删落盘 → delete')
      assert.strictEqual(api3._noteEventOf({ id: 'a', deleted: true }, { id: 'a' }), 'restore', tag + ' 删除态重存 → restore')
      assert.strictEqual(api3._noteEventOf({ id: 'a', tombstoned: true }, { id: 'a' }), 'create', tag + ' 墓碑重写 → create')
    }
  })
  }
}
