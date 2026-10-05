    // ==== notes-ledger BEGIN ====（0.4.3⑥：效用账本——日志双链扫描 → 指标快照 + 记忆档案懒创建回填（无 LLM），notes-043-ledger；
    //   0.4.3 验收修复⑤ notes-043-metrics-storage：§2 数据源切换——指标落机器存储层 telemetry.json，索引笔记 §2 通道退役摘除；
    //   0.4.3 验收修复⑩ notes-043-archive-folder：档案归位真实文件夹「记忆档案」——_create 第 5 参 extra.folder（参数位纠错：原误植第 4 参 topic 位，
    //     folder='' 导致面板树无入口）+ 存量 folder='' 档案一次性幂等迁移；第二轮裁决（Verifier 驳回成立返修）：面板翻账本入口的真实形态 =
    //     筛选中心「机器」档（FILTER_KINDS +sys + 面板取数恰选单 kind 时传 {kind} 走 ⑨ 保留的显式 kind 通道）+ folders 计数 includeSys——
    //     folder 定向视图含 sys 是 host 侧保留通道，但面板取数从不带 folder 参数（驳回探针实证 data.js 仅无参调用），不再充当面板入口等价物）
    // 行为（总纲 n-muufiroz67it 卡6/7 + 卡⑤修订）：
    //   ①扫描：复用 notes-graph 内核（_graphRebuild 全量只读重建，图是派生物），取近 7 天 kind=log 日志的 link 存活边
    //     聚合引用（本周口径 = logDate 距今 ≤7 天，缺省回退 createdAt 前 10 位；无法解析的日志不提名）。扫描只读，零 LLM。
    //   ②指标快照（卡⑤）：挂载总数 / 本周引用 Top5 / 零引用候选 / 任务挂载排行（口径受限：看板 contextFiles RPC 本期未接入，
    //     可得项 = useCount 引用计数 Top5）——经 _telemetrySetLedger 落 telemetry.json 派生字段 ledger（2s 防抖随遥测同盘），
    //     「召回指标」汇总输出 = notes-recall-stats RPC 的 ledger 键（面板数据源）；索引笔记 §2 召回指标节不再写入。
    //   ②b 存量摘除（卡⑤，一次性幂等）：_ledgerStripS2 摘除旧索引笔记的「## §2 召回指标」整段（机器托管节语义——节内全行随节
    //     整段退役，残行不留防污染 §1 行区 lint；§1 与说明块节外零触碰）；启动（index.js）与每次 refresh 双触发，无 §2 零改动。
    //   ③记忆档案懒创建：近 7 天日志引用且无档案 → 建「记忆 @标题 · 档案」（首行 [[记忆id]]；front-matter refNote
    //     结构化软链指向记忆 id；永不 inject 红线 + recall=false；⑩ folder=「记忆档案」真实文件夹归夹，topic 口径保留）→
    //     引用记录倒序追加（RootNote 框架，幂等键 = 日志 id，重放不重复行）。
    //   ③b 存量档案归夹（⑩，一次性幂等，refresh 顺带）：title「记忆 @」开头 + kind=sys + folder='' 的存量档案批量改 folder=「记忆档案」id
    //     ——只写 folder 元数据（正文/标题/其余 front-matter 零触碰红线）；{ history:false } 机器产物零历史快照；迁移后 folder 非空不再命中判据 = 重放零改写。
    //     口径说明（第二轮裁决）：迁移顺带更新 updatedAt 属 rootnote.js rootNoteEnsureSysKind 同族先例（机器元数据迁移随写 updatedAt）；
    //     ⑥ 前 kind='note' 陈旧档案不命中本判据（kind=sys 限定）——先经 _ledgerArchiveEnsure 的 rootNoteEnsureSysKind 升级（本周引用命中时），下一轮 refresh 归夹。
    //   ④遥测镜像顺带（卡⑤）：_recallMirrorRefresh 刷新存量「召回遥测（自动）」人读镜像笔记（不存在则跳过——新装库零笔记足迹）。
    //   ⑤触发：schedule.js cron tick 顺带（10min 节流在 _ledgerRefresh 内部）+ notes-ledger-refresh 手动 RPC（绕过节流）。
    // 红线：档案/镜像永不 inject（ensure/镜像重写内强制纠正锁）；无 LLM；扫描只读（写入仅限 telemetry.json ledger 键 + 档案笔记 + 镜像笔记，
    //   均 { history:false } 机器产物零历史快照 / 存储层防抖落盘）。
    // 依赖序位：rootnote.js（框架）→ injectindex.js（索引 INJECT_INDEX_S2/idxEnsure/idxLinesSync）之后、schedule.js（cron 顺带）之前；
    //   kernel/telemetry-store.js（_telemetrySetLedger）与 recall.js（_recallMirrorRefresh）运行时引用（函数声明提升，无 TDZ）；
    //   双清单同名共源（无 .dist 变体，check 节 45/74 看守）。
    const LEDGER_WINDOW_MS = 7 * 86400000        // 本周口径：近 7 天日志
    const LEDGER_CRON_MIN_MS = 10 * 60 * 1000    // cron 顺带刷新节流（手动 RPC 不受限）
    const LEDGER_TOP_N = 5                       // Top5 行容量
    const LEDGER_ZERO_MAX = 10                   // 零引用候选提名上限（提名而非穷尽）
    const LEDGER_ARCHIVE_MAX = 50                // 档案引用记录容量红线（倒序保留最新 50 条裁尾）
    const LEDGER_ARCHIVE_HEAD = '## 引用记录（自动）'
    const LEDGER_ARCHIVE_FOLDER = '记忆档案'     // ⑩ 档案归夹目标文件夹名（folder-arg-norm 名称→id 归一；_ledgerArchiveFolderEnsure 懒建）
    const LEDGER_ARCHIVE_TITLE_PREFIX = '记忆 @' // ⑩ 存量迁移判据：档案标题前缀（与懒创建标题同模）
    // 档案引用记录模板：新→旧倒序 + 日志 id 幂等键（重放/双触发不重复行）+ ≤50 裁尾
    const LEDGER_ARCHIVE_TPL = rootNoteTpl({
      head: LEDGER_ARCHIVE_HEAD,
      max: LEDGER_ARCHIVE_MAX,
      newestFirst: true,
      keyOfLine: function (l) { const m = String(l).match(/\[\[([^\[\]\r\n]+)\]\]/); return m ? m[1] : l },
      keyOfEntry: function (d) { return d.logId },
      lineOf: function (d) { return '- [[' + d.logId + ']] ' + d.at + ' · ' + String(d.label || '').replace(/[\r\n]+/g, ' ').slice(0, 60) }
    })
    // ISO → 本地 YYYY-MM-DD HH:MM（人读优先；与 runLog 条目同口径的本地墙钟语义，符号独立不复用 schedule 域）
    function ledgerTs(iso) {
      const ms = Date.parse(iso || '')
      if (!isFinite(ms)) return String(iso || '')
      const d = new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }
    // 日志归键（与日志卫生 suggestLogDateOf 同口径）：logDate 前 10 位优先，回退 createdAt 前 10 位
    function _ledgerLogDateStr(n) {
      const s = String(n.logDate || '').slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
      const c = String(n.createdAt || '').slice(0, 10)
      return /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : ''
    }
    // 扫描（只读）：全量重建图 → 近 7 天日志的 link 存活出边聚合
    //   refs: 记忆 id → { count 出现次数, logs: [{ logId, at, label }] }；inRefs: 全库 link 存活入度（零引用候选判据，不只看本周）
    async function _ledgerScan(nowMs) {
      await _graphRebuild()
      const all = await _list(undefined, undefined, undefined, false, true)
      const logs = {}
      for (const n of all) {
        if ((n.kind || 'note') !== 'log' || n.deleted || n.tombstoned) continue
        const ds = _ledgerLogDateStr(n)
        const ms = ds ? Date.parse(ds + 'T00:00:00') : NaN
        if (!isFinite(ms) || nowMs - ms > LEDGER_WINDOW_MS || ms - nowMs > LEDGER_WINDOW_MS) continue
        logs[n.id] = n
      }
      const refs = {}
      let weekRefs = 0
      for (const e of graphState.edges) {
        if (e.type !== 'link' || e.dead) continue
        const lg = logs[e.from]
        if (!lg) continue
        const cnt = e.meta && e.meta.count ? e.meta.count : 1
        const t = String(e.to)
        if (!refs[t]) refs[t] = { count: 0, logs: [] }
        refs[t].count += cnt
        refs[t].logs.push({ logId: e.from, at: ledgerTs(lg.updatedAt || lg.createdAt || ''), label: lg.title || '' })
        weekRefs += cnt
      }
      const inRefs = {}
      for (const e of graphState.edges) {
        if (e.type !== 'link' || e.dead) continue
        inRefs[e.to] = (inRefs[e.to] || 0) + (e.meta && e.meta.count ? e.meta.count : 1)
      }
      return { all: all, logs: logs, refs: refs, weekRefs: weekRefs, inRefs: inRefs }
    }
    // §2 存量摘除（卡⑤，一次性幂等）：指标迁 telemetry.json + notes-recall-stats 查询面，索引笔记回归纯挂载清单（§1）。
    //   整段摘除「## §2 召回指标」至下一「## 」节标题（或 EOF）——§2 是机器托管节（指标快照语义），节内全部行（机器指标行/误入的
    //   手写备注）随节整段退役：不保留节内残行（残行失去节锚会落入 §1 行区，污染索引行格式 lint 的兜底检出面——节 75 守卫①）；
    //   节外（说明块 + §1 + 后续节）逐字节不动。无 §2 锚 → null（幂等零改动，调用方不落盘）。
    function _ledgerStripS2FromBody(body) {
      const lines = String(body || '').split('\n')
      let headIdx = -1
      for (let i = 0; i < lines.length; i++) { if (lines[i].trim() === INJECT_INDEX_S2) { headIdx = i; break } }
      if (headIdx < 0) return null
      let end = lines.length
      for (let i = headIdx + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i].trim())) { end = i; break } }
      const before = lines.slice(0, headIdx)
      while (before.length && before[before.length - 1].trim() === '') before.pop()
      const after = lines.slice(end)
      let out = before
      if (after.length) out = out.concat(['']).concat(after)
      return out.join('\n') + '\n'
    }
    // 摘除落盘（幂等）：无 §2 → false 零改动；有 → { history:false } 机器产物零历史快照。启动（index.js 双包）与 refresh 双触发
    async function _ledgerStripS2() {
      try {
        const rl = await idxEnsure()
        if (!rl) return false
        const nb = _ledgerStripS2FromBody(rl.body)
        if (nb === null) return false
        rl.body = nb
        rl.updatedAt = new Date().toISOString()
        await persistNote(rl, { history: false })
        return true
      } catch (e) { return false }
    }
    // 档案查找：refNote 软链精确命中（front-matter 结构化主识别键；标题仅人读）
    function _ledgerArchiveFind(memId) {
      for (const n of cache.values()) {
        if (!n || n.deleted || n.tombstoned) continue
        if (String(n.refNote || '') === memId) return n
      }
      return null
    }
    // 档案文件夹确保（0.4.3 验收修复⑩ notes-043-archive-folder）：「记忆档案」真实文件夹懒创建——
    //   resolveFolderRef 命中（id/名称双通道）直接复用；未命中经 rootNoteCreateLock 串行化创建 + 锁内双检
    //   （并发 refresh 双建同名文件夹竞态消除；锁内仅消费 loadFolders/saveFolders/loadSettings，无本链重入 = 无自死锁）。
    //   红线：必须在档案创建锁（_ledgerArchiveEnsure 内 rootNoteCreateLock）之外调用——嵌套同链重入 = 自死锁（rootnote 红线③）。
    async function _ledgerArchiveFolderEnsure() {
      const hit = await resolveFolderRef(LEDGER_ARCHIVE_FOLDER)
      if (hit && hit.id) return hit.id
      return rootNoteCreateLock(async function () {
        const again = await resolveFolderRef(LEDGER_ARCHIVE_FOLDER)   // 锁内双检：并发 ensure 前者产物已落 folders.json，命中即复用
        if (again && again.id) return again.id
        const c = await _folders({ op: 'create', name: LEDGER_ARCHIVE_FOLDER })
        return (c && c.ok && c.folder) ? c.folder.id : ''
      })
    }
    // 存量档案归夹（⑩，一次性幂等）：title「记忆 @」开头 + kind=sys + folder='' 的存量档案批量改 folder=「记忆档案」id——
    //   只写 folder 元数据（正文/标题/其余 front-matter 零触碰红线）；persistNote { history:false } 机器产物零历史快照（事件总线正常分发）；
    //   幂等：迁移后 folder 非空不再命中判据，重放零改写。返回迁移篇数。
    async function _ledgerArchiveFolderMigrate(folderId) {
      if (!folderId) return 0
      let moved = 0
      for (const n of cache.values()) {
        if (!n || n.deleted || n.tombstoned) continue
        if ((n.kind || 'note') !== 'sys' || n.folder) continue
        if (String(n.title || '').indexOf(LEDGER_ARCHIVE_TITLE_PREFIX) !== 0) continue
        n.folder = folderId
        n.updatedAt = new Date().toISOString()
        await persistNote(n, { history: false })
        moved++
      }
      return moved
    }
    // 档案懒创建（幂等）：无档案 → _create（inject=false + recall=false + ⑩ folder=「记忆档案」归夹）→ refNote 软链回写（{ history:false }）；
    //   永不 inject 红线锁：被人为开注入的档案强制纠正回 false（防套娃注入）
    // 创建级锁（0.4.3+ notes-043-ensure-lock）：「查找 → 创建 → refNote 回写」窗口经 rootNoteCreateLock 串行化 + 锁内双检
    //   （_ledgerArchiveFind 扫共享 cache 权威）——并发 refresh 同记忆各建档案的竞态消除；命中既有档案走快路径不进锁
    async function _ledgerArchiveEnsure(mem) {
      const memId = String(mem.id)
      let a = _ledgerArchiveFind(memId)
      if (a) await rootNoteEnsureSysKind(a)   // 存量迁移（0.4.3⑥）：旧档案 kind=note → sys（只写 kind 元数据，正文零变化）
      if (!a) {
        await _ledgerArchiveFolderEnsure()   // ⑩ 归夹前置：创建锁外确保「记忆档案」文件夹存在（嵌套同链 = 自死锁；folder-arg-norm 对未知名称整体拒绝，缺夹会炸_create）
        a = await rootNoteCreateLock(async function () {
          const hit = _ledgerArchiveFind(memId)   // 锁内双检：并发创建者产物已带 refNote 落缓存，命中即复用
          if (hit) { await rootNoteEnsureSysKind(hit); return hit }
          const cr = await _create('记忆 @' + String(mem.title || memId) + ' · 档案', '[[' + memId + ']]\n\n' + LEDGER_ARCHIVE_HEAD + '\n', ['自动'], '记忆档案', { kind: 'sys', inject: false, recall: false, folder: LEDGER_ARCHIVE_FOLDER })   // ⑩ 参数位纠错：folder 走 extra.folder（名称→id 归一）；topic「记忆档案」口径保留
          if (!cr || !cr.id) return null
          const na = await rootNoteResolve(cr.id)
          if (!na) return null
          na.refNote = memId
          na.updatedAt = new Date().toISOString()
          await persistNote(na, { history: false })
          return na
        })
        if (!a) return null
      }
      if (a.inject === true) {
        a.inject = false
        a.updatedAt = new Date().toISOString()
        await persistNote(a, { history: false })
      }
      return a
    }
    // 刷新主口（卡⑤修订 + ⑩）：存量 §2 摘除 → 扫描 → ⑩ 档案文件夹确保 + 存量档案归夹（一次性幂等）→ 指标快照落 telemetry.json
    //   （_telemetrySetLedger，存储层防抖落盘）→ 遥测镜像顺带刷新 → 记忆档案懒创建回填。trigger='cron' 时 10min 节流；手动 RPC 绕过节流。
    // 全量吞异常由调用方兜底（cron 顺带）或转 error 字段（手动 RPC）——账本是观察面产物，任何故障不扩散主链路。
    async function _ledgerRefresh(opts) {
      const trig = (opts && opts.trigger) || 'manual'
      const nowMs = Date.now()
      if (trig === 'cron' && nowMs - ledgerLastCronMs < LEDGER_CRON_MIN_MS) return { ok: true, skipped: 'throttled' }
      if (trig === 'cron') ledgerLastCronMs = nowMs
      const rl = await idxEnsure()
      if (!rl) return { ok: false, error: '注入索引笔记不可用' }
      await _ledgerStripS2()   // 存量 §2 摘除（一次性幂等；卡⑤——指标迁机器存储层，索引回归纯挂载清单）
      const scan = await _ledgerScan(nowMs)
      // ⑩ 存量档案归夹（一次性幂等，refresh 顺带）：scan 内 _list 已暖缓存（外部文件懒加载入 cache），此处全量扫描判据零遗漏；
      //   文件夹 ensure 返回 ''（folders.json 写失败等）时迁移降级 0 篇不扩散主链路；档案懒创建遇缺夹由 folder-arg-norm 显式拒绝兜底（错得安全）
      const archFolderId = await _ledgerArchiveFolderEnsure()
      const archivesMoved = await _ledgerArchiveFolderMigrate(archFolderId)
      const mounted = idxLinesSync()
      const tops = Object.keys(scan.refs).map(function (id) { return { id: id, count: scan.refs[id].count } }).sort(function (x, y) { return y.count - x.count }).slice(0, LEDGER_TOP_N)
      const zeroIds = mounted.filter(function (l) { return !(scan.inRefs[l.id] > 0) }).slice(0, LEDGER_ZERO_MAX).map(function (l) { return l.id })
      const useRank = mounted.map(function (l) {
        const n = cache.get(l.id)
        return { id: l.id, count: Math.max(0, (n && !n.deleted && !n.tombstoned && n.useCount) || 0) }
      }).filter(function (it) { return it.count > 0 }).sort(function (x, y) { return y.count - x.count }).slice(0, LEDGER_TOP_N)
      // 指标快照落机器存储层（卡⑤）：telemetry.json 派生字段 ledger——「召回指标」汇总输出 = notes-recall-stats RPC ledger 键（面板数据源）；
      //   整体覆盖写幂等（同快照重写零语义变化）；存储层 2s 防抖落盘；静默降级（遥测故障不扩散账本主链路）
      await _telemetrySetLedger({
        at: new Date(nowMs).toISOString(), trigger: trig,
        mountTotal: mounted.length, weekLogs: Object.keys(scan.logs).length, weekRefs: scan.weekRefs,
        top: tops, zeroRefCount: zeroIds.length, zeroRef: zeroIds, useRank: useRank
      })
      // 遥测镜像顺带刷新（卡⑤：存量「召回遥测（自动）」降级人读镜像；不存在则跳过；内部全吞异常）
      await _recallMirrorRefresh('ledger-' + trig)
      // 记忆档案懒创建回填：仅近 7 天被日志引用的记忆（零引用挂载不建空档案）
      let archivesCreated = 0
      for (const memId of Object.keys(scan.refs)) {
        const mem = await rootNoteResolve(memId)
        if (!mem) continue
        const existed = !!_ledgerArchiveFind(memId)
        const a = await _ledgerArchiveEnsure(mem)
        if (!a) continue
        if (!existed) archivesCreated++
        await rootNoteAppend(a, LEDGER_ARCHIVE_TPL, scan.refs[memId].logs)
      }
      return { ok: true, trigger: trig, indexNoteId: rl.id, mountTotal: mounted.length, weekLogs: Object.keys(scan.logs).length, weekRefs: scan.weekRefs, top: tops, zeroRefCount: zeroIds.length, archivesCreated: archivesCreated, archivesMoved: archivesMoved }
    }
    let ledgerLastCronMs = 0
    // 手动触发 RPC：notes-ledger-refresh { trigger? }（缺省 manual，绕过 cron 节流）
    disposers.push(handle('notes-ledger-refresh', async (args) => {
      try { return await _ledgerRefresh({ trigger: (args && args.trigger) || 'manual' }) }
      catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== notes-ledger END ====
