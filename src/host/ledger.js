    // ==== notes-ledger BEGIN ====（0.4.3⑥：效用账本——日志双链扫描 → §2 指标行级更新 + 记忆档案懒创建回填（无 LLM），notes-043-ledger）
    // 行为（总纲 n-muufiroz67it 卡6/7）：
    //   ①扫描：复用 notes-graph 内核（_graphRebuild 全量只读重建，图是派生物），取近 7 天 kind=log 日志的 link 存活边
    //     聚合引用（本周口径 = logDate 距今 ≤7 天，缺省回退 createdAt 前 10 位；无法解析的日志不提名）。扫描只读，零 LLM。
    //   ②§2 指标行级更新（注入索引根笔记「## §2 召回指标」节整节重写，§1 与备注区逐字节不动）：
    //     挂载总数 / 本周引用 Top5 / 零引用候选（挂载且笔记库内 0 引用）/ 任务挂载排行
    //     （口径受限：看板 contextFiles RPC 本期未接入，可得项 = useCount 引用计数 Top5，行内注明口径）。
    //   ③记忆档案懒创建：近 7 天日志引用且无档案 → 建「记忆 @标题 · 档案」（首行 [[记忆id]]；front-matter refNote
    //     结构化软链指向记忆 id；永不 inject 红线 + recall=false）→ 引用记录倒序追加（RootNote 框架，幂等键 = 日志 id，重放不重复行）。
    //   ④触发：schedule.js cron tick 顺带（10min 节流在 _ledgerRefresh 内部）+ notes-ledger-refresh 手动 RPC（绕过节流）。
    // 红线：档案/指标永不 inject（ensure 内强制纠正锁）；无 LLM；扫描只读（写入仅限索引笔记 §2 节行级 + 档案笔记，均 { history:false } 机器产物零历史快照）。
    // 依赖序位：rootnote.js（框架）→ injectindex.js（索引 INJECT_INDEX_S2/idxEnsure/idxLinesSync）之后、schedule.js（cron 顺带）之前；
    //   双清单同名共源（无 .dist 变体，check 节 45/74 看守）。
    const LEDGER_WINDOW_MS = 7 * 86400000        // 本周口径：近 7 天日志
    const LEDGER_CRON_MIN_MS = 10 * 60 * 1000    // cron 顺带刷新节流（手动 RPC 不受限）
    const LEDGER_TOP_N = 5                       // Top5 行容量
    const LEDGER_ZERO_MAX = 10                   // 零引用候选提名上限（提名而非穷尽）
    const LEDGER_ARCHIVE_MAX = 50                // 档案引用记录容量红线（倒序保留最新 50 条裁尾）
    // §2 指标节模板：非条目行（备注区）逐字节保留；行级更新 = 整节条目行重写（指标是快照非流水，不做追加式）
    const LEDGER_S2_TPL = rootNoteTpl({ head: INJECT_INDEX_S2, lineRe: /^\s*-\s/, newestFirst: false, max: 100 })
    const LEDGER_ARCHIVE_HEAD = '## 引用记录（自动）'
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
    // §2 整节重写（节外零触碰：§1 挂载清单与 §2 后备注区逐字节保留；RootNote split/render 同源语义）
    async function _ledgerWriteS2(rl, lines) {
      const body = String(rl.body || '')
      const sec = rootNoteSplit(body, LEDGER_S2_TPL)
      let out = sec.pre.concat(['']).concat(lines)
      if (sec.others.length) out = out.concat(['']).concat(sec.others)
      rl.body = out.join('\n') + '\n'
      rl.updatedAt = new Date().toISOString()
      await persistNote(rl, { history: false })
    }
    // 档案查找：refNote 软链精确命中（front-matter 结构化主识别键；标题仅人读）
    function _ledgerArchiveFind(memId) {
      for (const n of cache.values()) {
        if (!n || n.deleted || n.tombstoned) continue
        if (String(n.refNote || '') === memId) return n
      }
      return null
    }
    // 档案懒创建（幂等）：无档案 → _create（inject=false + recall=false）→ refNote 软链回写（{ history:false }）；
    //   永不 inject 红线锁：被人为开注入的档案强制纠正回 false（防套娃注入）
    // 创建级锁（0.4.3+ notes-043-ensure-lock）：「查找 → 创建 → refNote 回写」窗口经 rootNoteCreateLock 串行化 + 锁内双检
    //   （_ledgerArchiveFind 扫共享 cache 权威）——并发 refresh 同记忆各建档案的竞态消除；命中既有档案走快路径不进锁
    async function _ledgerArchiveEnsure(mem) {
      const memId = String(mem.id)
      let a = _ledgerArchiveFind(memId)
      if (a) await rootNoteEnsureSysKind(a)   // 存量迁移（0.4.3⑥）：旧档案 kind=note → sys（只写 kind 元数据，正文零变化）
      if (!a) {
        a = await rootNoteCreateLock(async function () {
          const hit = _ledgerArchiveFind(memId)   // 锁内双检：并发创建者产物已带 refNote 落缓存，命中即复用
          if (hit) { await rootNoteEnsureSysKind(hit); return hit }
          const cr = await _create('记忆 @' + String(mem.title || memId) + ' · 档案', '[[' + memId + ']]\n\n' + LEDGER_ARCHIVE_HEAD + '\n', ['自动'], '记忆档案', { kind: 'sys', inject: false, recall: false })
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
    function _ledgerFmtTop(items) { return items.length ? items.map(function (it) { return '[[' + it.id + ']]×' + it.count }).join('、') : '无' }
    // 刷新主口：§2 快照重写 + 记忆档案懒创建回填。trigger='cron' 时 10min 节流；手动 RPC 绕过节流。
    // 全量吞异常由调用方兜底（cron 顺带）或转 error 字段（手动 RPC）——账本是观察面产物，任何故障不扩散主链路。
    async function _ledgerRefresh(opts) {
      const trig = (opts && opts.trigger) || 'manual'
      const nowMs = Date.now()
      if (trig === 'cron' && nowMs - ledgerLastCronMs < LEDGER_CRON_MIN_MS) return { ok: true, skipped: 'throttled' }
      if (trig === 'cron') ledgerLastCronMs = nowMs
      const rl = await idxEnsure()
      if (!rl) return { ok: false, error: '注入索引笔记不可用' }
      const scan = await _ledgerScan(nowMs)
      const mounted = idxLinesSync()
      const tops = Object.keys(scan.refs).map(function (id) { return { id: id, count: scan.refs[id].count } }).sort(function (x, y) { return y.count - x.count }).slice(0, LEDGER_TOP_N)
      const zero = mounted.filter(function (l) { return !(scan.inRefs[l.id] > 0) }).slice(0, LEDGER_ZERO_MAX).map(function (l) { return '[[' + l.id + ']]' })
      const useRank = mounted.map(function (l) {
        const n = cache.get(l.id)
        return { id: l.id, count: Math.max(0, (n && !n.deleted && !n.tombstoned && n.useCount) || 0) }
      }).filter(function (it) { return it.count > 0 }).sort(function (x, y) { return y.count - x.count }).slice(0, LEDGER_TOP_N)
      const lines = [
        '- 挂载总数：' + mounted.length,
        '- 本周引用 Top5（近 7 天日志双链）：' + _ledgerFmtTop(tops),
        '- 零引用候选（挂载且笔记库内 0 引用；看板 contextFiles 口径本期未接入）：' + (zero.length ? zero.join('、') : '无'),
        '- 任务挂载排行（口径受限，可得项=useCount 引用计数 Top5）：' + _ledgerFmtTop(useRank),
        '- 统计：本周引用日志 ' + Object.keys(scan.logs).length + ' 篇 · 引用 ' + scan.weekRefs + ' 次 · 更新于 ' + ledgerTs(new Date(nowMs).toISOString()) + '（' + trig + '）'
      ]
      // 分通道召回率旁挂（0.4.3+ 卡⑫ 统一召回遥测 notes-043-inject-receipt）：近 7 天流水口径（五通道交付→note_get 取用），
      //   与上方双链引用口径不混算（行内标注）；无数据/异常静默略过（遥测故障不扩散账本主链路）
      try {
        const rc = await _recallStats({ sinceDays: 7 })
        if (rc && rc.ok && rc.events > 0) lines.push('- 分通道召回率（近 7 天遥测流水：交付→取用口径，与上方双链引用口径不混算）：' + _recallFmtChannels(rc.channels))
      } catch (e) {}
      await _ledgerWriteS2(rl, lines)
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
      return { ok: true, trigger: trig, indexNoteId: rl.id, mountTotal: mounted.length, weekLogs: Object.keys(scan.logs).length, weekRefs: scan.weekRefs, top: tops, zeroRefCount: zero.length, archivesCreated: archivesCreated }
    }
    let ledgerLastCronMs = 0
    // 手动触发 RPC：notes-ledger-refresh { trigger? }（缺省 manual，绕过 cron 节流）
    disposers.push(handle('notes-ledger-refresh', async (args) => {
      try { return await _ledgerRefresh({ trigger: (args && args.trigger) || 'manual' }) }
      catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== notes-ledger END ====
