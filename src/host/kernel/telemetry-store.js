    // ==== telemetry-store BEGIN ====（0.4.3 验收修复⑤：机器存储层——召回遥测迁 telemetry.json，notes-043-metrics-storage。
    // 背景（用户定案三层分离）：①载荷层 = 注入索引正文（纯人/LLM 策展，零元数据）；②机器存储层 = 本模块（notes/telemetry.json）；
    //   ③注入呈现层（卡⑥装配增强）。遥测从「召回遥测（自动）」笔记正文迁出——search/get 热路径每次 body 全量重写 + 文本行解析
    //   是代码读写障碍；笔记只当视图（存量遥测笔记降级人读镜像，见 recall.js _recallMirrorRefresh），不当存储（排版/热路径/编辑权/污染面四冲突）。
    // 文件：NOTES_DIR/telemetry.json（.json 不进笔记列表天然隐身——_list 只认 .md；与 settings.json 分离防写放大，同 usage.json 先例）。
    //   结构：{ version:1, receipts:{ inject:[{ts,ids[],session?}≤200], mount:[...], catalog:[...] },
    //           byDay:{ search:{日期:{id:count}}, get:{...} }, facets:{ use:{id:总计数} }, ledger:{账本快照}?, meta:{ lastFlush, migratedAt?, migratedFrom? } }
    //   facets.use（0.4.3 验收修复⑧ notes-043-stats-unify）：笔记使用计数 facet——useCount 唯一事实源（按 id 累计总数，
    //     与 byDay 分离：90 天剪枝/体积护栏摘桶不动总计）；front-matter useCount 字段退役（不再写入，存量旧值仅作 seed 并入）。
    // 四纪律：①内存增量 + 2s 防抖原子落盘（fs.writeText 底层 writeFileAtomic 自带原子——崩溃只留完整旧版/完整新版；
    //     崩溃丢 ≤2s 内存增量可容忍，计数是下界语义）；
    //   ②汇总纯函数现算不落盘（recall.js _recallComputeStats 读内存权威现算；ledger 快照是刷新语义产物而非聚合，不占遥测流水面）；
    //   ③容量三闸：receipts 每通道 ≤TELEMETRY_RECEIPT_MAX 裁尾（保最新）、byDay >TELEMETRY_BYDAY_KEEP_DAYS 天剪枝、
    //     单文件体积护栏 TELEMETRY_MAX_BYTES（先裁 receipts 再逐日摘最旧 byDay 桶；facets.use 总计数语义不可裁，不在摘桶面内）；
    //   ④读失败 = 空桶重建、写失败 = 内存续用（dirty 保持，下次防抖/flush 重试；全程静默降级，遥测永不阻塞主流程）。
    // 一致性三定案（注释与节 78 断言双锁）：单写者——唯一写入方 = host 进程本模块（client/app 只经 RPC 读，构造性无双写）；
    //   先渲染后记账——inject/catalog 埋点在 renderInjected 渲染完成后调用（自排除，计数不虚高）；
    //   单调性——计数只增（保留窗口内）为下界语义（崩溃窗口与导入合并取大都守住「不少计」）。
    // 序位：紧随 kernel/settings-store.js（同 JSON sidecar 先例）；消费方 recall.js/ledger.js/transfer.js 全部运行时引用（函数声明提升，无 TDZ）。
    // 变体说明：TELEMETRY_PATH 常量在开发版由 telemetry-store.js 定义（NOTES_DIR 拼接），发布版由 head.js 定义（path.join(NOTES_ROOT,...)）——
    //   双包差异仅此一处，telemetry-store.dist.js 与本文档其余部分逐字节一致（节 78 看守）。
    const TELEMETRY_PATH = NOTES_DIR + '\\telemetry.json'
    const TELEMETRY_VERSION = 1
    const TELEMETRY_FLUSH_MS = 2000                  // 纪律①：内存增量 + 2s 防抖原子落盘（崩溃丢 ≤2s 计数可容忍）
    const TELEMETRY_RECEIPT_MAX = 200                // 纪律③闸一：receipts 每通道裁尾上限（保最新裁最旧）
    const TELEMETRY_BYDAY_KEEP_DAYS = 90             // 纪律③闸二：日聚合保留窗口（天）
    const TELEMETRY_MAX_BYTES = 256 * 1024           // 纪律③闸三：单文件体积护栏
    const TELEMETRY_RECEIPT_CHANNELS = ['inject', 'mount', 'catalog']
    const TELEMETRY_BYDAY_CHANNELS = ['search', 'get']
    // 内存权威（读路径 stats 现算的唯一数据源；跨 apply 由磁盘恢复）
    let _telemetryCache = null
    let _telemetryLoadPromise = null
    let _telemetryDirty = false
    let _telemetryFlushTimer = null
    let _telemetryFlushChain = Promise.resolve()     // 写盘单链串行化（flush/import 合并不交错；单写者进程内串行）
    // 本地日键（YYYY-MM-DD，byDay 粒度；本地墙钟语义与 ledger 日志归键同口径）
    function _telemetryDay(ms) {
      const d = ms === undefined ? new Date() : new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    }
    function _telemetryEmpty() {
      return { version: TELEMETRY_VERSION, receipts: { inject: [], mount: [], catalog: [] }, byDay: { search: {}, get: {} }, facets: { use: {} }, meta: {} }
    }
    // 读入归一：缺键补齐/坏桶自愈（receipts 非数组→空、byDay 计数非法→剔除）；未知顶层键保留（前向兼容，导入合并/未来版本字段不丢）
    function _telemetryNormalize(obj) {
      const t = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {}
      if (typeof t.version !== 'number' || !isFinite(t.version) || t.version < 1) t.version = TELEMETRY_VERSION
      if (!t.receipts || typeof t.receipts !== 'object') t.receipts = {}
      for (const ch of TELEMETRY_RECEIPT_CHANNELS) {
        const arr = Array.isArray(t.receipts[ch]) ? t.receipts[ch] : []
        t.receipts[ch] = arr.filter(function (r) { return r && typeof r === 'object' && r.ts && Array.isArray(r.ids) && r.ids.length })
      }
      if (!t.byDay || typeof t.byDay !== 'object') t.byDay = {}
      for (const ch of TELEMETRY_BYDAY_CHANNELS) {
        const days = (t.byDay[ch] && typeof t.byDay[ch] === 'object') ? t.byDay[ch] : {}
        const out = {}
        for (const d of Object.keys(days)) {
          const bucket = days[d]
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !bucket || typeof bucket !== 'object') continue
          const b2 = {}
          for (const id of Object.keys(bucket)) {
            const v = Math.max(0, Math.floor(Number(bucket[id]) || 0))
            if (v > 0) b2[String(id)] = v
          }
          if (Object.keys(b2).length) out[d] = b2
        }
        t.byDay[ch] = out
      }
      // facets.use 归一（note-stats facet，0.4.3 验收修复⑧）：非对象 → 空桶、计数非法（≤0/非数）剔除；
      //   facets 未知子键保留（前向兼容，未来 facet 种类不丢）；总计数不参与 byDay 剪枝/裁尾（单调性红线）
      if (!t.facets || typeof t.facets !== 'object' || Array.isArray(t.facets)) t.facets = {}
      const useRaw = (t.facets.use && typeof t.facets.use === 'object' && !Array.isArray(t.facets.use)) ? t.facets.use : {}
      const useOut = {}
      for (const uid of Object.keys(useRaw)) {
        const uv = Math.max(0, Math.floor(Number(useRaw[uid]) || 0))
        if (uv > 0) useOut[String(uid)] = uv
      }
      t.facets.use = useOut
      if (!t.meta || typeof t.meta !== 'object') t.meta = {}
      return t
    }
    // 启动加载（memoized 单飞）：文件坏/不存在 → 空桶重建（纪律④）；全程静默，不抛错
    function _telemetryLoad() {
      if (!_telemetryLoadPromise) {
        _telemetryLoadPromise = (async () => {
          try {
            const p = await fs.resolve(TELEMETRY_PATH)
            _telemetryCache = _telemetryNormalize(JSON.parse(await fs.readText(p)))
          } catch (e) { _telemetryCache = _telemetryEmpty() }
          return _telemetryCache
        })()
      }
      return _telemetryLoadPromise
    }
    // 防抖调度（纪律①）：脏标记 + 2s 定时器（已挂不重复；unref 不阻塞进程退出）
    function _telemetryScheduleFlush() {
      _telemetryDirty = true
      if (_telemetryFlushTimer) return
      _telemetryFlushTimer = setTimeout(function () { _telemetryFlushTimer = null; _telemetryFlushNow() }, TELEMETRY_FLUSH_MS)
      if (_telemetryFlushTimer && typeof _telemetryFlushTimer.unref === 'function') _telemetryFlushTimer.unref()
    }
    // 容量三闸（纪律③）：receipts 裁尾 → byDay 窗口剪枝 → 体积护栏（先 receipts 收紧到 100，再逐日摘最旧 byDay 桶直至达标）
    function _telemetryPrune(t, nowMs) {
      for (const ch of TELEMETRY_RECEIPT_CHANNELS) {
        if (t.receipts[ch].length > TELEMETRY_RECEIPT_MAX) t.receipts[ch] = t.receipts[ch].slice(-TELEMETRY_RECEIPT_MAX)
      }
      const cutoff = _telemetryDay(nowMs - TELEMETRY_BYDAY_KEEP_DAYS * 86400000)
      for (const ch of TELEMETRY_BYDAY_CHANNELS) {
        const days = t.byDay[ch]
        for (const d of Object.keys(days)) { if (d < cutoff) delete days[d] }
      }
      if (JSON.stringify(t).length <= TELEMETRY_MAX_BYTES) return
      for (const ch of TELEMETRY_RECEIPT_CHANNELS) {
        if (t.receipts[ch].length > 100) t.receipts[ch] = t.receipts[ch].slice(-100)
      }
      let text = JSON.stringify(t)
      while (text.length > TELEMETRY_MAX_BYTES) {
        let oldest = null, oldestCh = null
        for (const ch of TELEMETRY_BYDAY_CHANNELS) {
          for (const d of Object.keys(t.byDay[ch])) { if (oldest === null || d < oldest) { oldest = d; oldestCh = ch } }
        }
        if (oldest === null) break
        delete t.byDay[oldestCh][oldest]
        text = JSON.stringify(t)
      }
    }
    // 落盘单点（纪律①④）：清防抖定时器（手动/卸载 flush 不二次触发）→ 链内串行（不交错）→ 剪枝/护栏 → 原子写。
    //   落盘格式 = compact JSON（机器存储，人读视图是镜像笔记）——体积护栏与落盘字节同口径（pretty 打印会放大失真）；
    //   非脏零写（空转幂等）；写失败 = 内存续用（dirty 保持，静默降级不扩散主流程）
    function _telemetryFlushNow() {
      try { if (_telemetryFlushTimer) { clearTimeout(_telemetryFlushTimer); _telemetryFlushTimer = null } } catch (e) {}
      const run = _telemetryFlushChain.then(async function () {
        const t = _telemetryCache
        if (!t || !_telemetryDirty) return
        _telemetryPrune(t, Date.now())
        t.meta.lastFlush = new Date().toISOString()
        try {
          const p = await fs.resolve(TELEMETRY_PATH)
          await fs.writeText(p, JSON.stringify(t), undefined, undefined, getPolicy())
          _telemetryDirty = false
        } catch (e) { /* 纪律④：写失败内存续用（dirty 保持待重试），静默不扩散 */ }
      })
      _telemetryFlushChain = run.then(function () {}, function () {})   // 失败不断链
      return run
    }
    // 低频通道原始回执追加（inject/mount/catalog）：内存 push（旧→新序）+ 裁尾保最新 + 防抖调度；未加载/坏通道静默丢弃
    function _telemetryAddReceipt(channel, row) {
      try {
        const t = _telemetryCache
        if (!t || TELEMETRY_RECEIPT_CHANNELS.indexOf(channel) < 0 || !row || !Array.isArray(row.ids) || !row.ids.length) return
        const r = { ts: String(row.ts || new Date().toISOString()), ids: row.ids.map(String) }
        if (row.session) r.session = String(row.session)
        t.receipts[channel].push(r)
        if (t.receipts[channel].length > TELEMETRY_RECEIPT_MAX) t.receipts[channel] = t.receipts[channel].slice(-TELEMETRY_RECEIPT_MAX)
        _telemetryScheduleFlush()
      } catch (e) {}
    }
    // 高频通道日聚合增量（search/get）：内存累加（同日同通道同 id 单调只增——下界语义）+ 防抖调度
    function _telemetryBumpDay(channel, day, id, n) {
      try {
        const t = _telemetryCache
        const v = Math.max(0, Math.floor(Number(n) || 0))
        if (!t || TELEMETRY_BYDAY_CHANNELS.indexOf(channel) < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !id || !v) return
        const days = t.byDay[channel]
        const bucket = days[day] || (days[day] = {})
        const k = String(id)
        bucket[k] = (bucket[k] || 0) + v
        _telemetryScheduleFlush()
      } catch (e) {}
    }
    // ---- note-stats facet（0.4.3 验收修复⑧ notes-043-stats-unify）：facets.use = { id: totalCount } = useCount 唯一事实源 ----
    // 与 byDay.get 分工：byDay = 90 天窗口日明细视图（剪枝不动总计）；facets.use = 按 id 累计总数（不剪枝/不裁尾）。
    //   内存视图 n.useCount 由本 facet 供电（载入/创建/导入经 store-cache _useFacetSync 双向 max 合并；bump 双写视图+facet）——消费方读视图零改动。
    //   单调下界语义同三定案：只增/取大（崩溃窗口与导入合并取大都守住「不少计」）；落盘复用纪律① 2s 防抖通道（无独立定时器/无独立 flush）。
    // use facet 总计数 +1（自含加载——bumpUseCount 热路径 fire-and-forget 直调；静默降级不扩散主流程）
    async function _telemetryBumpUse(id) {
      try {
        await _telemetryLoad()
        const t = _telemetryCache
        if (!t || !id) return
        const k = String(id)
        t.facets.use[k] = Math.max(0, Math.floor(Number(t.facets.use[k]) || 0)) + 1
        _telemetryScheduleFlush()
      } catch (e) {}
    }
    // use facet 读取（调用方须已完成 _telemetryLoad；未加载/缺失/非法 → 0）
    function _telemetryUseOf(id) {
      try {
        const t = _telemetryCache
        if (!t || !id) return 0
        return Math.max(0, Math.floor(Number(t.facets.use[String(id)]) || 0))
      } catch (e) { return 0 }
    }
    // use facet 种子合并（max 合并幂等——旧 front-matter 字段/归档继承/导入并入；重放不双计）：
    //   仅在真正抬升时置脏并调度落盘（零变化零写，存量重读零放大）；返回合并后总计数（调用方须已完成 _telemetryLoad）
    function _telemetrySeedUse(id, count) {
      try {
        const t = _telemetryCache
        if (!t || !id) return 0
        const k = String(id)
        const cur = Math.max(0, Math.floor(Number(t.facets.use[k]) || 0))
        const v = Math.max(0, Math.floor(Number(count) || 0))
        if (v > cur) { t.facets.use[k] = v; _telemetryScheduleFlush(); return v }
        return cur
      } catch (e) { return 0 }
    }
    // 账本快照落存储层（0.4.3 验收修复⑤ ledger §2 数据源切换）：整体覆盖写（幂等——同快照重写零语义变化）+ 防抖调度；
    //   自含加载（账本刷新通道可能先于任何遥测事件触发）；静默降级
    async function _telemetrySetLedger(snap) {
      try {
        await _telemetryLoad()
        if (!_telemetryCache || !snap || typeof snap !== 'object') return
        _telemetryCache.ledger = snap
        _telemetryScheduleFlush()
      } catch (e) {}
    }
    // 导入合并（0.4.3 验收修复⑤ transfer.js 消费）：导入数据计数并入、冲突取大（单调下界语义不破坏）——
    //   receipts 按 ts+ids 签名去重并集（时间序归一后 ≤200 保最新）；byDay 同键取大、缺键并入；facets.use 同键取大（卡⑧）；meta.lastFlush 取晚；
    //   migratedAt/migratedFrom 只补不缺（不覆盖既有迁移史）；ledger 快照 at 晚者胜；version 取大（前向兼容入口）。
    //   幂等：同一快照重复导入零变化（并集/取大均幂等）→ 返回 false；有变化 → 防抖 flush 落盘 → 返回 true。
    function _telemetryReceiptKey(r) { return String(r.ts) + '|' + (Array.isArray(r.ids) ? r.ids.join(',') : '') }
    async function _telemetryImportMerge(obj) {
      try {
        await _telemetryLoad()
        const t = _telemetryCache
        if (!t || !obj || typeof obj !== 'object' || Array.isArray(obj)) return false
        let changed = false
        if (typeof obj.version === 'number' && isFinite(obj.version) && obj.version > (t.version || 1)) { t.version = Math.floor(obj.version); changed = true }
        for (const ch of TELEMETRY_RECEIPT_CHANNELS) {
          const inc = obj.receipts && Array.isArray(obj.receipts[ch]) ? obj.receipts[ch] : []
          if (!inc.length) continue
          const seen = {}
          for (const r of t.receipts[ch]) seen[_telemetryReceiptKey(r)] = true
          for (const r of inc) {
            if (!r || typeof r !== 'object' || !r.ts || !Array.isArray(r.ids) || !r.ids.length) continue
            const k = _telemetryReceiptKey(r)
            if (seen[k]) continue
            seen[k] = true
            const row = { ts: String(r.ts), ids: r.ids.map(String) }
            if (r.session) row.session = String(r.session)
            t.receipts[ch].push(row)
            changed = true
          }
          t.receipts[ch].sort(function (a, b) { return a.ts < b.ts ? -1 : (a.ts > b.ts ? 1 : 0) })
          if (t.receipts[ch].length > TELEMETRY_RECEIPT_MAX) t.receipts[ch] = t.receipts[ch].slice(-TELEMETRY_RECEIPT_MAX)
        }
        for (const ch of TELEMETRY_BYDAY_CHANNELS) {
          const incDays = obj.byDay && obj.byDay[ch] && typeof obj.byDay[ch] === 'object' ? obj.byDay[ch] : null
          if (!incDays) continue
          for (const d of Object.keys(incDays)) {
            const bucket = incDays[d]
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !bucket || typeof bucket !== 'object') continue
            const out = t.byDay[ch][d] || (t.byDay[ch][d] = {})
            for (const id of Object.keys(bucket)) {
              const v = Math.max(0, Math.floor(Number(bucket[id]) || 0))
              if (!v) continue
              const k = String(id)
              if (!out[k] || out[k] < v) { out[k] = v; changed = true }
            }
          }
        }
        // facets.use 并入（0.4.3 验收修复⑧）：同键取大、缺键并入（单调下界语义不破坏；幂等——重复导入零变化）
        const incUse = obj.facets && obj.facets.use && typeof obj.facets.use === 'object' && !Array.isArray(obj.facets.use) ? obj.facets.use : null
        if (incUse) {
          for (const uid of Object.keys(incUse)) {
            const uv = Math.max(0, Math.floor(Number(incUse[uid]) || 0))
            if (!uv) continue
            const k = String(uid)
            if (!t.facets.use[k] || t.facets.use[k] < uv) { t.facets.use[k] = uv; changed = true }
          }
        }
        const incMeta = obj.meta && typeof obj.meta === 'object' ? obj.meta : {}
        if (incMeta.lastFlush && (!t.meta.lastFlush || String(incMeta.lastFlush) > String(t.meta.lastFlush))) { t.meta.lastFlush = String(incMeta.lastFlush); changed = true }
        if (incMeta.migratedAt && !t.meta.migratedAt) { t.meta.migratedAt = String(incMeta.migratedAt); if (incMeta.migratedFrom) t.meta.migratedFrom = String(incMeta.migratedFrom); changed = true }
        if (obj.ledger && typeof obj.ledger === 'object' && obj.ledger.at && (!t.ledger || !t.ledger.at || String(obj.ledger.at) > String(t.ledger.at))) { t.ledger = obj.ledger; changed = true }
        if (changed) { _telemetryDirty = true; await _telemetryFlushNow() }
        return changed
      } catch (e) { return false }
    }
    // ==== telemetry-store END ====
