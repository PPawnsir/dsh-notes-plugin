// 节 79. 0.4.3+ 创建级锁：根笔记并发首建竞态修复（notes-043-ensure-lock）
// 缺陷背景（节 76.3 边界留痕 → 本节修复收口）：索引根笔记不存在时两个并发 notes-mount 各建一篇「注入索引（自动）」——
//   两调用都 ok:true 但 settings.indexNoteId 只剩其一，盘上出现 2 个索引文件（孤儿）。
//   根因：per-note 写链（节 76）只串行「同 id 写」，不覆盖 ensure 的「存在性检查 → 创建 → 软链回写」读-改-写窗口。
// 修复：rootnote.js rootNoteCreateLock 模块级单链 Promise（同 notes.js quickChain 模式）把创建窗口原子化，锁内双检复用前者产物；
//   三消费点共用同锁——索引（injectindex.js idxEnsure）/ runLog（rootNoteEnsure 框架，schedule.js 经 appendEnsured）/
//   记忆档案（ledger.js _ledgerArchiveEnsure）；recall.js 根笔记创建本就在自有 _recallChain 内串行（非同构，零改动）。
// 红线守护：①并发首建（启动 idxEnsure + 双 mount 三方竞态）→ 恰 1 篇索引 + indexNoteId 唯一 + 双调用 ok + 挂载行双在；
//   ②既有索引并发 mount 走快路径零重复创建（源码序位锚 + 行为锚）；③runLog/档案同锁（框架 vm 沙箱并发 + 真 handlers 档案并发）；
//   ④创建抛错锁释放——后续调用照常创建（死锁防护）+ 失败零残页。
// 测试策略：独立实例（内存 store，8-5 先例）——索引并发首建必须从未建索引的干净库起跑；
//   写延迟注入（76.3 先例）放大「检查 → 创建」窗口使竞态确定性复现（无锁时必然双建）。
module.exports = {
  id: "79",
  title: "79. 创建级锁：根笔记并发首建竞态修复（notes-043-ensure-lock）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  const { NOTES_DIR, llmMock, admMock, agentsMock, sessionPersistenceMock, sessionQueryMock, sessionTitleMock, workspaceRegistryMock } = S
  section('79. 创建级锁：根笔记并发首建竞态修复（notes-043-ensure-lock）')

  const IDX_TITLE = '注入索引（自动）'
  const SETTINGS_PATH = NOTES_DIR + '\\settings.json'
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  // 盘上索引文件计数（排除 .history 快照通道；索引 FM title 含「注入索引（自动）」）
  const idxFiles = (store) => Array.from(store.keys()).filter(k => k.indexOf('.history') < 0 && k.endsWith('.md') && String(store.get(k)).indexOf(IDX_TITLE) >= 0)
  // 独立实例工厂（8-5 先例）：fresh store + 可注入 writeText 钩子（delayMsOf 返回 >0 则该写延迟，shouldFail 返回 true 则该写抛错）
  function newIsolated(hooks) {
    const store = new Map()
    const hk = hooks || {}
    const fsMockX = {
      resolve: async (p) => p,
      stat: async (p) => (p === NOTES_DIR ? { dir: true } : (store.has(p) ? { file: true } : null)),
      listDir: async (p) => {
        const prefix = p + '\\'
        const out = []
        for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) })
        return out
      },
      readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
      writeText: async (p, c) => {
        if (hk.shouldFail && hk.shouldFail(p, c)) throw new Error('ECRASH: 注入创建失败')
        const d = hk.delayMsOf ? hk.delayMsOf(p, c) : 0
        if (d > 0) await sleep(d)
        store.set(p, c)
      },
    }
    const handlersX = {}
    const harnessX = { handle: (n, f) => { handlersX[n] = f; return () => { delete handlersX[n] } }, defineTool: (d) => d, registerTool: () => () => {} }
    const evtX = {}
    new Function('harness', 'pluginDir', hostSrc)(harnessX, DIR).apply({
      fs: fsMockX, sandboxPolicy: { resolve: () => ({}) },
      get: (name) => ({ llm: llmMock, agentDefaultModel: admMock, agents: agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: sessionPersistenceMock, workspaceRegistry: workspaceRegistryMock, sessionTitle: sessionTitleMock, sessionQuery: sessionQueryMock })[name],
      effect: () => {},
      on: (n, fn) => { (evtX[n] = evtX[n] || []).push(fn); return () => {} },
    })
    return { store: store, fsMock: fsMockX, handlers: handlersX, evt: evtX }
  }
  // 等启动 idxEnsure 沉降（fire-and-forget）：轮询 mount-list 直到索引指针出现
  async function waitStartupIdx(handlersX) {
    for (let i = 0; i < 60; i++) {
      const lst = await handlersX['notes-mount-list']({})
      if (lst && lst.indexNoteId) return lst.indexNoteId
      await sleep(50)
    }
    return null
  }

  // ---- 79.0 落地结构：创建级锁骨架 + 三消费点共用 + 快路径序位 + 构建产物同步 ----
  await t('创建级锁落地结构：rootNoteCreateLock 模块级单链（quickChain 同模式）+ 三消费点共用 + 快路径在锁前 + 双产物同步', () => {
    const rnSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'rootnote.js'), 'utf8')
    assert(rnSrc.indexOf('let _rootNoteCreateChain = Promise.resolve()') >= 0, 'rootnote.js 模块级创建链注册表在位')
    assert(rnSrc.indexOf('function rootNoteCreateLock(work)') >= 0, 'rootnote.js rootNoteCreateLock API 在位')
    assert(rnSrc.indexOf('_rootNoteCreateChain = run.then(function () {}, function () {})') >= 0, '失败不断链（.then 双参吞尾）——创建抛错后后续调用仍可创建')
    assert(rnSrc.indexOf('快路径零开销') >= 0 && rnSrc.indexOf('不引跨进程锁') >= 0, '红线声明注释在位（快路径零开销 / 单进程内串行）')
    // 消费点① runLog 框架 ensure：创建窗口入锁 + 锁内双检重读宿主缓存权威（调用方可能持陈旧快照）
    assert(rnSrc.indexOf('return rootNoteCreateLock(async function ()') >= 0, 'rootNoteEnsure 创建窗口入锁')
    assert(rnSrc.indexOf('const freshHost = await rootNoteResolve(hostNote.id)') >= 0, 'rootNoteEnsure 锁内双检重读宿主最新软链')
    // 消费点② 索引 idxEnsure：创建窗口入锁 + 锁内双检；快路径（命中既有索引直接返回）在锁之前
    const iiSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'injectindex.js'), 'utf8')
    assert(iiSrc.indexOf('return await rootNoteCreateLock(async function ()') >= 0, 'idxEnsure 创建窗口入锁')
    const fnStart = iiSrc.indexOf('async function idxEnsure()')
    const fastIdx = iiSrc.indexOf('if (rl) {', fnStart)
    const lockIdx = iiSrc.indexOf('rootNoteCreateLock', fnStart)
    assert(fnStart >= 0 && fastIdx > fnStart && lockIdx > fastIdx, 'idxEnsure 快路径（命中既有索引）在创建锁之前——并发 mount 正常路径零锁开销')
    // 消费点③ 记忆档案：创建窗口入锁 + 锁内双检（refNote 扫共享 cache 权威）
    const ledSrc = fsNative.readFileSync(path.join(DIR, 'src', 'host', 'ledger.js'), 'utf8')
    assert(ledSrc.indexOf('a = await rootNoteCreateLock(async function ()') >= 0, '_ledgerArchiveEnsure 创建窗口入锁')
    assert(ledSrc.indexOf('const hit = _ledgerArchiveFind(memId)') >= 0, '_ledgerArchiveEnsure 锁内双检')
    // 双产物同步（rootnote/injectindex/ledger 双清单共源单份——拼接产物须含锁骨架）
    for (const [src, tag] of [[hostSrc, 'host 产物'], [indexSrc, 'index.mjs']]) {
      assert(src.indexOf('function rootNoteCreateLock(work)') >= 0, tag + ' 含 rootNoteCreateLock（构建产物已刷新）')
      assert(src.indexOf('return await rootNoteCreateLock(async function ()') >= 0, tag + ' idxEnsure 锁化已入产物')
    }
  })

  // ---- 79.1 ① 索引并发首建：启动 idxEnsure + 双 mount 三方竞态 → 恰 1 篇索引 + 指针唯一 + 双 ok ----
  await t('并发首建：索引不存在时启动 ensure + 两个并发 notes-mount 三方竞态 → 恰 1 篇索引 + indexNoteId 唯一 + 挂载行双在', async () => {
    // 写延迟注入（60ms）只压索引文件写：把「存在性检查 → 创建落盘」窗口拉大——无锁时三方各建一篇，有锁时后者双检复用
    const L = newIsolated({ delayMsOf: (p, c) => (String(p).indexOf('.history') < 0 && String(c).indexOf(IDX_TITLE) >= 0 ? 60 : 0) })
    // 两个待挂载目标（inject=false 不触发自动挂载联动，并发首建只由显式 mount 驱动）
    const A = await L.handlers['notes-create']({ title: '并发锁·目标A', body: 'A', topic: '记忆' })
    const B = await L.handlers['notes-create']({ title: '并发锁·目标B', body: 'B', topic: '记忆' })
    assert(A && A.id && B && B.id, '目标笔记创建成功')
    const [ma, mb] = await Promise.all([
      L.handlers['notes-mount']({ id: A.id, whenToUse: '并发首建A' }),
      L.handlers['notes-mount']({ id: B.id, whenToUse: '并发首建B' }),
    ])
    assert(ma && ma.ok && mb && mb.ok, '并发双挂载均 ok（实得：' + JSON.stringify([ma, mb]).slice(0, 200) + '）')
    assert(ma.indexNoteId && ma.indexNoteId === mb.indexNoteId, '两次调用 indexNoteId 唯一一致（实得：' + ma.indexNoteId + ' / ' + mb.indexNoteId + '）')
    await waitStartupIdx(L.handlers)   // 启动 ensure（三方竞态之一）沉降
    await sleep(200)
    const files = idxFiles(L.store)
    assert.strictEqual(files.length, 1, '盘上恰 1 篇「注入索引（自动）」（无孤儿索引文件；实得 ' + files.length + '）')
    assert(files[0].indexOf('\\' + ma.indexNoteId + '.md') >= 0, '盘上索引文件 = 指针所指（无孤儿）')
    const sg = JSON.parse(L.store.get(SETTINGS_PATH) || '{}')
    assert.strictEqual(sg.indexNoteId, ma.indexNoteId, 'settings.json indexNoteId 落盘且与两调用一致')
    const body = String(L.store.get(files[0]))
    assert(body.split('\n').filter(l => l.indexOf('[[' + A.id + ']]') >= 0).length === 1, 'A 挂载行恰 1 行')
    assert(body.split('\n').filter(l => l.indexOf('[[' + B.id + ']]') >= 0).length === 1, 'B 挂载行恰 1 行（并发 append 不丢行）')
    const lst = await L.handlers['notes-mount-list']({})
    assert.strictEqual(lst.indexNoteId, ma.indexNoteId, 'mount-list 解析口径与指针一致')
  })

  // ---- 79.2 ② 快路径：既有索引并发 mount 零重复创建 ----
  await t('快路径：既有索引时并发 mount 零重复创建（不新建索引文件）+ 双调用 ok 落行', async () => {
    const L = newIsolated()
    const idxId = await waitStartupIdx(L.handlers)   // 启动 ensure 建索引（单线沉降）
    assert(idxId, '前置：启动 ensure 已建索引（实得：' + idxId + '）')
    assert.strictEqual(idxFiles(L.store).length, 1, '前置：盘上恰 1 篇索引')
    // 创建告警：索引标题内容的「新文件」写 = 重复创建（既有文件的 append 改写不算——路径已在 store）
    let recreated = 0
    const origWrite = L.fsMock.writeText
    L.fsMock.writeText = async function (p, c) {
      if (String(p).indexOf('.history') < 0 && !L.store.has(p) && String(c).indexOf(IDX_TITLE) >= 0) recreated++
      return origWrite(p, c)
    }
    try {
      const C = await L.handlers['notes-create']({ title: '并发锁·目标C', body: 'C', topic: '记忆' })
      const D = await L.handlers['notes-create']({ title: '并发锁·目标D', body: 'D', topic: '记忆' })
      const [mc, md] = await Promise.all([
        L.handlers['notes-mount']({ id: C.id, whenToUse: '快路径C' }),
        L.handlers['notes-mount']({ id: D.id, whenToUse: '快路径D' }),
      ])
      assert(mc.ok && md.ok, '快路径并发双挂载均 ok')
      assert(mc.indexNoteId === idxId && md.indexNoteId === idxId, '双调用复用既有索引（无新指针）')
      assert.strictEqual(recreated, 0, '既有索引并发 mount 零重复创建（实得新建 ' + recreated + ' 次）')
      assert.strictEqual(idxFiles(L.store).length, 1, '盘上仍恰 1 篇索引')
      const g = await L.handlers['notes-get']({ id: idxId })
      assert(g.note.body.indexOf('[[' + C.id + ']]') >= 0 && g.note.body.indexOf('[[' + D.id + ']]') >= 0, '快路径双挂载行均落位')
    } finally { L.fsMock.writeText = origWrite }
  })

  // ---- 79.3 ④ 死锁防护：创建抛错 → 锁释放 → 后续调用照常创建 + 失败零残页 ----
  await t('死锁防护：首建写失败（RPC 报错）→ 锁不挂，解除注入后重试创建成功 + 失败零残页', async () => {
    let failIdx = true
    const L = newIsolated({ shouldFail: (p, c) => failIdx && String(p).indexOf('.history') < 0 && String(p).endsWith('.md') && String(c).indexOf(IDX_TITLE) >= 0 })
    await sleep(200)   // 启动 idxEnsure 首建已被注入打挂（fire-and-forget 静默）
    assert.strictEqual(idxFiles(L.store).length, 0, '前置：注入期启动首建失败，盘上零索引文件（零残页）')
    const X = await L.handlers['notes-create']({ title: '并发锁·目标X', body: 'X', topic: '记忆' })
    const m1 = await L.handlers['notes-mount']({ id: X.id, whenToUse: '死锁防护X' })
    assert(m1 && String(m1.error || '').indexOf('索引笔记创建失败') >= 0, '创建失败经 RPC 契约原样上报（实得：' + JSON.stringify(m1) + '）')
    assert.strictEqual(idxFiles(L.store).length, 0, '失败仍零残页')
    failIdx = false   // 解除注入：若创建锁被前次失败挂死，本次将永远等锁（超时即死锁实证）
    const m2 = await L.handlers['notes-mount']({ id: X.id, whenToUse: '死锁防护X' })
    assert(m2 && m2.ok && m2.indexNoteId, '失败释放锁：后续调用照常创建成功（实得：' + JSON.stringify(m2) + '）')
    await sleep(100)
    assert.strictEqual(idxFiles(L.store).length, 1, '恢复后盘上恰 1 篇索引')
    const sg = JSON.parse(L.store.get(SETTINGS_PATH) || '{}')
    assert.strictEqual(sg.indexNoteId, m2.indexNoteId, 'settings 指针回写一致')
  })

  // ---- 79.4 ③ runLog/档案同类 ensure 复用同锁 ----
  await t('runLog 同锁复用（框架 vm 沙箱）：并发 appendEnsured ×2 → 懒创建恰 1 次 + 双调用同 rl + 两条目齐 + 失败后链不挂', async () => {
    // 与节 72.1 同法：rootnote 标记块提取 eval（stub 存储），创建 stub 带 30ms 延迟放大竞态窗口——无锁时并发双建必然发生
    const blkM = hostSrc.match(/\/\/ ==== rootnote BEGIN ====[\s\S]*?\/\/ ==== rootnote END ====/)
    assert(blkM, 'rootnote 标记块可提取')
    const mkSandbox = (idGen) => {
      const store = {}
      const creates = []
      const _create = async function (title, body, tags, topic, opts) {
        await sleep(30)   // 放大「检查 → 创建」窗口
        const id = await idGen()
        if (!id) return null
        const n = { id: id, title: title, body: body, kind: (opts && opts.kind) || 'note' }
        store[n.id] = n; creates.push(n)
        return { id: id }
      }
      const loadNote = async function (id) { return store[id] || null }
      const persistNote = async function (n) { store[n.id] = n }
      const RN = new Function('_create', 'loadNote', 'persistNote',
        blkM[0] + '\n;return { rootNoteTpl: rootNoteTpl, rootNoteEnsure: rootNoteEnsure, rootNoteAppendEnsured: rootNoteAppendEnsured }'
      )(_create, loadNote, persistNote)
      return { store: store, creates: creates, RN: RN }
    }
    const tplOf = (RN) => RN.rootNoteTpl({
      head: '## 执行记录（自动）', max: 50, newestFirst: true,
      keyOfEntry: (d) => d, lineOf: (d) => '- 条目（' + d + '）',
      linkOf: (n) => n.schedule && n.schedule.runLog,
      // 与 SCHED_RUNLOG_TPL.writeLink 同构：回写宿主对象 schedule.runLog（缓存权威口径）
      writeLink: async (n, rlId) => { if (n.schedule) n.schedule = Object.assign({}, n.schedule, { runLog: rlId }) },
      titleOf: (n) => n.title + ' · 执行记录', topicOf: (n) => n.topic, kind: 'sys'
    })
    // (a) 并发首建竞态：两并发 appendEnsured 同 host → 恰 1 次创建 + 同 rl + 两条目齐
    let seqC = 0
    const s2 = mkSandbox(async () => 'n-rl-c' + (++seqC))
    const host = { id: 'h-conc', title: '并发宿主', topic: '运维', schedule: {} }
    s2.store['h-conc'] = host
    const [r1, r2] = await Promise.all([
      s2.RN.rootNoteAppendEnsured(host, tplOf(s2.RN), ['e1']),
      s2.RN.rootNoteAppendEnsured(host, tplOf(s2.RN), ['e2']),
    ])
    assert(r1 && r2 && r1.id === r2.id, '并发双调用落同一托管笔记（实得：' + (r1 && r1.id) + ' / ' + (r2 && r2.id) + '）')
    assert.strictEqual(s2.creates.length, 1, '并发首建恰 1 次（无锁必 2 次产孤儿；实得 ' + s2.creates.length + '）')
    assert.strictEqual(host.schedule.runLog, r1.id, '软链回写指向唯一产物')
    const bodyC = s2.store[r1.id].body
    assert(bodyC.indexOf('条目（e1）') >= 0 && bodyC.indexOf('条目（e2）') >= 0, '锁内双检复用后两条目各自追加齐（不丢条目）')
    // (b) 死锁防护：首建抛错 → 调用方拿到 rejection，链不挂；后续调用照常创建
    let failOnce = true
    const s3 = mkSandbox(async () => { if (failOnce) { failOnce = false; throw new Error('ECRASH: 首建注入失败') } return 'n-rl-ok' })
    const host3 = { id: 'h-fail', title: '失败宿主', schedule: {} }
    s3.store['h-fail'] = host3
    let err = null
    try { await s3.RN.rootNoteAppendEnsured(host3, tplOf(s3.RN), ['x']) } catch (e) { err = e }
    assert(err && String(err.message || err).indexOf('ECRASH') >= 0, '创建抛错原样抛给调用方（实得：' + String(err && (err.message || err)) + '）')
    const ok = await s3.RN.rootNoteAppendEnsured(host3, tplOf(s3.RN), ['x'])
    assert(ok && ok.id === 'n-rl-ok', '失败后链不挂：后续调用照常创建（死锁防护；实得：' + (ok && ok.id) + '）')
    assert.strictEqual(s3.creates.length, 1, '失败尝试零产物 + 重试恰 1 次创建')
  })

  await t('档案同锁复用（真 handlers）：并发 notes-ledger-refresh ×2 同记忆 → 档案恰 1 个（refNote 唯一）+ 引用记录不重复', async () => {
    const L = newIsolated({ delayMsOf: (p, c) => (String(p).indexOf('.history') < 0 && String(c).indexOf('· 档案') >= 0 ? 40 : 0) })
    const idxId = await waitStartupIdx(L.handlers)
    assert(idxId, '前置：启动 ensure 已建索引')
    const today = (function () { const d = new Date(); const p = (n) => (n < 10 ? '0' + n : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })()
    const M = await L.handlers['notes-create']({ title: '并发锁·记忆M', body: '记忆正文M', topic: '记忆' })
    const LG = await L.handlers['notes-create']({ title: '工作日志 79 · 并发', body: '## 相关笔记\n\n[[' + M.id + ']] 并发档案竞态引用', kind: 'log', logDate: today })
    assert(M && M.id && LG && LG.id, '记忆 + 近窗日志（双链引用）造数成功')
    // 并发双刷新：两者同扫到 M 被 LG 引用且档案不存在 → 竞态入创建窗口（延迟注入放大）；同锁串行 + 双检 → 恰 1 个档案
    const [ra, rb] = await Promise.all([
      L.handlers['notes-ledger-refresh']({}),
      L.handlers['notes-ledger-refresh']({}),
    ])
    assert(ra && ra.ok === true && rb && rb.ok === true, '并发双刷新均 ok（实得：' + JSON.stringify([ra && ra.ok, rb && rb.ok]) + '）')
    const archIds = Array.from(L.store.keys()).filter(k => k.indexOf('.history') < 0 && k.endsWith('.md') && String(L.store.get(k)).indexOf('refNote: ' + M.id) >= 0)
    assert.strictEqual(archIds.length, 1, '并发 refresh 同记忆 → 档案恰 1 个（无孤儿档案；实得 ' + archIds.length + '）')
    const ga = await L.handlers['notes-get']({ id: archIds[0].slice(NOTES_DIR.length + 1, -3) })
    assert(ga.note && ga.note.refNote === M.id, '档案 refNote 软链 = M（实得：' + (ga.note && ga.note.refNote) + '）')
    assert(ga.note.inject !== true && ga.note.recall === false, '档案红线不动：永不 inject + recall=false')
    const refLines = String(ga.note.body).split('\n').filter(l => l.indexOf('[[' + LG.id + ']]') >= 0)
    assert.strictEqual(refLines.length, 1, '引用记录同日志恰 1 行（并发追加幂等不重复；实得 ' + refLines.length + '）')
  })
  }
}
