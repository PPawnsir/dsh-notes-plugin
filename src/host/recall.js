    // ==== recall-telemetry BEGIN ====（0.4.3+ 卡⑫ 统一召回遥测 → 0.4.3 验收修复⑤迁机器存储层，notes-043-metrics-storage）
    // 覆盖矩阵（五通道，主窗口裁决 n-muufiroz67it 卡⑫ 修订版——卡⑤不改埋点点位与口径）：
    //   inject  装配（强）：conventionText 真实注入路径（预览 sidOverride 不计）实际渲染的约定 id 集 + 资料桶存活索引行 id 集；
    //   mount   任务挂载（中）：_dispatch 派发成功 = 笔记作为待办上下文挂载进目标任务会话；
    //   search  自由检索（弱）：notes-search RPC 与 note_search 工具各自实际返回的 id 集（两处埋点同源口径）；
    //   get     按需取（使用信号）：note_get 工具 + notes-get RPC 成功返回（取用 = 五通道统一的「使用」事件源）；
    //   catalog 目录（弱）：renderInjected 真实渲染路径实际出清单的目录段普通行 id 集（预览不计）。
    // 存储（卡⑤）：全部事件落 kernel/telemetry-store.js（notes/telemetry.json）——四纪律/单写者/先渲染后记账/单调性见该模块头注：
    //   · 低频通道（inject/mount/catalog）记 receipts 原始回执 {ts,ids[],session?}——签名去重（同通道同会话同 id 集连续重复装配只记一行，
    //     防每轮系统提示拼装写盘风暴；id 集按集合序判等——排序 join，换序不重复记；id 集/会话变化即新签名立即记）；
    //   · 高频通道（search/get）记 byDay 日聚合 {channel→day→id→count}——内存增量单调只增（同日同键累加）；
    //   · 内存权威 + 2s 防抖原子落盘 + 卸载 flush（index.js effect 挂载点）；崩溃丢 ≤2s 内存增量（下界语义）。
    // 遥测笔记降级（卡⑤）：存量「召回遥测（自动）」根笔记一次性迁移——首个 flush 前解析旧流水行回填 JSON（幂等：
    //   meta.migratedAt 持久化标记 + 镜像正文零 `- {` 机器行双保险，重放/崩溃重跑不双计；解析失败空桶起步——遥测允许重来）；
    //   迁移后笔记降级人读镜像（## 遥测摘要（人读镜像）：日评估 cron 通道——_ledgerRefresh 顺带刷一次可读摘要，热路径零笔记写入；
    //   镜像仍 kind=sys + recall=false + inject 红线锁）；新装库无旧笔记 → 永不建镜像（遥测零笔记足迹）。
    // 红线：埋点零阻塞——全部 fire-and-forget + 静默降级（落盘失败吞异常，不扩散主流程）；
    //   notes-recall-stats 返回结构不变（ok/noteId/sinceDays/fromDay/events/channels 五通道字段零改动；ledger 为卡⑤新增键，消费方零改动）；
    //   注入管线不读本存储（卡⑥才接）。
    // 依赖序位：kernel/telemetry-store.js（存储层）+ rootnote.js（迁移解析旧流水节）+ injectindex.js/ledger.js（sys 根笔记先例 + ledgerTs 镜像时间戳）之后、
    //   inject/img-path-hint.js 之前；消费方 server/dispatch/inject/search/index 全部运行时引用（函数声明提升，RPC 调用期引用——节 45 方向断言看守）。
    const RECALL_TITLE = '召回遥测（自动）'
    const RECALL_HEAD = '## 事件流水（自动）'                  // 旧版流水节锚（一次性迁移解析用；写路径已退役）
    const RECALL_MIRROR_HEAD = '## 遥测摘要（人读镜像）'        // 降级后人读镜像锚（卡⑤：机器存储在 telemetry.json，本页仅人读）
    const RECALL_MIRROR_REMARKS = '## 手写备注（机器不改）'     // 镜像内手写备注保留节（迁移时旧流水节备注区迁入，刷新逐字节保留）
    const RECALL_MIRROR_MIN_MS = 30 * 60 * 1000              // 镜像刷写节流（内容未变且 30min 内 → 零写入）
    const RECALL_CHANNELS = ['inject', 'mount', 'search', 'get', 'catalog']
    // 旧流水节模板（迁移解析专用）：行识别 `- {json}`；RootNote split 拆 pre/entries/others（手写备注行落 others 区，迁镜像时保留）
    const RECALL_TPL = rootNoteTpl({ head: RECALL_HEAD, lineRe: /^\s*-\s\{/ })
    // 行解析：`- {json}`；非法行 → null
    function _recallParseLine(l) {
      const m = String(l).match(/^\s*-\s(\{.*\})\s*$/)
      if (!m) return null
      try { const o = JSON.parse(m[1]); return o && typeof o === 'object' ? o : null } catch (e) { return null }
    }
    // 本地日键（YYYY-MM-DD，日聚合粒度；本地墙钟语义与 ledger 日志归键同口径）
    function _recallDay(ms) {
      const d = ms === undefined ? new Date() : new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    }
    // 遥测笔记解析（同步）：settings.recallNoteId 指针优先，丢了按 kind=sys + 标题在 cache 自愈找回，再退按标题（存量旧笔记）
    function _recallNoteSync() {
      try {
        if (settingsCache && settingsCache.recallNoteId) {
          const n = cache.get(String(settingsCache.recallNoteId))
          if (n && !n.deleted && !n.tombstoned) return n
        }
        for (const n of cache.values()) { if (!n.deleted && !n.tombstoned && (n.kind || 'note') === 'sys' && n.title === RECALL_TITLE) return n }
        for (const n of cache.values()) { if (!n.deleted && !n.tombstoned && n.title === RECALL_TITLE) return n }
      } catch (e) {}
      return null
    }
    // 解析（异步，迁移/镜像路径用）：同步口径之上补指针读盘兜底——冷缓存 cache.get 未命中时经 loadNote 读盘自愈（命中即回缓存）
    async function _recallResolve() {
      const hit = _recallNoteSync()
      if (hit) return hit
      try {
        if (settingsCache && settingsCache.recallNoteId) {
          const t = await loadNote(String(settingsCache.recallNoteId))
          if (t && !t.deleted && !t.tombstoned) return t
        }
      } catch (e) {}
      return null
    }
    // 一次性迁移（promise 收口，并发/重入安全）：首个 flush 前解析旧「召回遥测（自动）」笔记流水行回填 telemetry.json——
    //   原始回执行倒序遍历（旧→新入队，裁尾保最新 200）+ 日聚合行计数累加；meta.migratedAt 持久化标记（跨重启幂等，重放不双计）。
    //   崩溃顺序红线：先 flushNow 落 JSON 再改写镜像（崩溃重放解析同源旧行 = 同结果重建，不双计）。
    //   找不到旧笔记：冷缓存（cache 空）重置 promise 允许下个事件重试；暖缓存确认无旧笔记 → 本 apply 生命周期封口（新装库常态零开销）。
    //   迁移失败静默（遥测允许重来，空桶起步）；settings.recallNoteId 指针只读消费（卡⑤起不再回写——镜像不再懒建，指针无新建需求）。
    let _recallMigratePromise = null
    function _recallMaybeMigrate() {
      if (_recallMigratePromise) return _recallMigratePromise
      _recallMigratePromise = (async () => {
        try {
          await _telemetryLoad()
          const t = _telemetryCache
          if (!t) return
          if (t.meta && t.meta.migratedAt) return              // 已迁移（标记持久化在 JSON，跨重启幂等）
          await loadSettings()
          const rl = await _recallResolve()
          if (!rl) {
            if (cache.size === 0) _recallMigratePromise = null   // 冷缓存：重置允许重试（暖缓存后标题扫描才可靠）
            return
          }
          const sec = rootNoteSplit(String(rl.body || ''), RECALL_TPL)
          for (const l of sec.entries.slice().reverse()) {       // 旧文件合并序新行在前 → 倒序遍历 = 旧→新入队（裁尾保最新）
            const o = _recallParseLine(l)
            if (!o || RECALL_CHANNELS.indexOf(o.channel) < 0) continue
            if (o.ts && Array.isArray(o.ids)) _telemetryAddReceipt(o.channel, o)
            else if (o.day && o.id) _telemetryBumpDay(o.channel, String(o.day), String(o.id), Math.max(0, Math.floor(o.count || 0)))
          }
          t.meta.migratedAt = new Date().toISOString()
          t.meta.migratedFrom = rl.id
          await _telemetryFlushNow()                             // JSON 先落盘（崩溃顺序红线）
          await _recallMirrorWrite(rl, 'migrate', sec.others)    // 笔记降级人读镜像（旧流水节手写备注迁入保留节）
        } catch (e) { /* 迁移失败静默：遥测允许重来（空桶起步），本 apply 生命周期封口不重试 */ }
      })()
      return _recallMigratePromise
    }
    // 低频通道原始回执（inject/mount/catalog）：签名去重——同通道同会话同 id 集连续装配只记一行；
    //   签名按集合序（排序后 join）：同 id 集仅渲染顺序抖动（cache 迭代序/updatedAt 并列）不视为新交付——
    //   Verifier 驳回②修复：有序 join 会把同集合换序记成第二条交付行（遥测交付量虚增 + 断言脆）；
    //   id 集或会话变化即新签名立即记（装配类防每轮系统提示拼装写盘风暴；mount 换会话重派仍计独立交付）
    const _recallLastSig = {}
    function _recallRaw(channel, ids, session) {
      try {
        const list = []
        for (const id0 of ids || []) { const s = String(id0 || ''); if (s && list.indexOf(s) < 0) list.push(s) }
        if (!list.length) return
        const sig = (session || '') + '|' + list.slice().sort().join(',')
        if (_recallLastSig[channel] === sig) return
        _recallLastSig[channel] = sig
        const row = { ts: new Date().toISOString(), ids: list }
        if (session) row.session = String(session)
        _recallMaybeMigrate().then(function () { _telemetryAddReceipt(channel, row) }).catch(function () {})
      } catch (e) {}
    }
    // 高频通道日聚合（search/get）：内存增量（同日同键累加不爆行）→ 存储层 2s 防抖落盘（卸载 flush 兜底）
    function _recallHit(channel, ids) {
      try {
        const day = _recallDay()
        const list = []
        for (const id0 of ids || []) { const s = String(id0 || ''); if (s && list.indexOf(s) < 0) list.push(s) }
        if (!list.length) return
        _recallMaybeMigrate().then(function () { for (const id of list) _telemetryBumpDay(channel, day, id, 1) }).catch(function () {})
      } catch (e) {}
    }
    // flush 关口（stats 读前落账 + 卸载 flush 共用签名）：加载 → 一次性迁移（首个 flush 前回填）→ 存储层落盘
    async function _recallFlushAgg() {
      await _recallMaybeMigrate()
      await _telemetryFlushNow()
    }
    // ---- 人读镜像（卡⑤降级：遥测笔记仅人读视图，机器存储在 telemetry.json）----
    // 镜像手写备注提取：现行镜像的保留节内容逐字节取；迁移前的旧格式正文回退 RootNote 备注区口径
    function _recallMirrorOthers(body) {
      const lines = String(body || '').split('\n')
      let idx = -1
      for (let i = 0; i < lines.length; i++) { if (lines[i].trim() === RECALL_MIRROR_REMARKS) { idx = i; break } }
      if (idx >= 0) return lines.slice(idx + 1).filter(function (l) { return l.trim() !== '' })
      return rootNoteSplit(body, RECALL_TPL).others
    }
    // 内容门比较口径：剥「- 更新于：」行（时间戳行不参与等同判定——内容未变且节流窗口内零写入）
    function _recallMirrorSansTs(b) {
      return String(b || '').split('\n').filter(function (l) { return l.indexOf('- 更新于：') !== 0 }).join('\n')
    }
    let _recallMirrorLastMs = 0
    // 镜像全量重写（冷路径唯一写笔记点：一次性迁移 + 账本刷新顺带；热路径永不调用——节 78「热路径零笔记写入」看守）。
    //   镜像仍机器托管：kind=sys 归位（存量迁移）+ inject 红线锁（人为开注入 → 随镜像重写强制纠正回 false，防套娃注入）；
    //   落盘不动 updatedAt（机器镜像刷新不算编辑——遥测计数同哲学，防列表排序抖动）；{ history:false } 机器产物零历史快照。
    async function _recallMirrorWrite(rl, trigger, othersLines) {
      const st = _recallComputeStats(7)
      const lines = [
        '> 机器遥测存储已迁至 notes/telemetry.json（0.4.3 验收修复⑤：单写者 = host 进程，热路径零写入；本页仅人读镜像，机器查询走 notes-recall-stats RPC）。',
        '',
        '- 更新于：' + ledgerTs(new Date().toISOString()) + '（' + (trigger || 'cron') + '）',
        '- 近 7 天遥测事件：' + st.events,
        '- 分通道召回率（交付→取用口径）：' + _recallFmtChannels(st.channels)
      ]
      if (st.ledger) lines.push('- 账本快照（近 7 天日志双链口径）：挂载总数 ' + (st.ledger.mountTotal || 0) + ' · 本周引用 ' + (st.ledger.weekRefs || 0) + ' 次 · 零引用候选 ' + (st.ledger.zeroRefCount || 0) + ' 条 · 快照于 ' + ledgerTs(st.ledger.at))
      const others = (othersLines || []).filter(function (l) { return typeof l === 'string' && l.trim() !== '' })
      let body = RECALL_MIRROR_HEAD + '\n\n' + lines.join('\n') + '\n'
      if (others.length) body += '\n' + RECALL_MIRROR_REMARKS + '\n\n' + others.join('\n') + '\n'
      const nowMs = Date.now()
      if (_recallMirrorSansTs(rl.body) === _recallMirrorSansTs(body) && nowMs - _recallMirrorLastMs < RECALL_MIRROR_MIN_MS) return false
      rl.body = body
      if (rl.inject === true) rl.inject = false   // 永不 inject 红线锁（随镜像重写强制纠正，不单独起写）
      await persistNote(rl, { history: false })   // 不动 rl.updatedAt：机器镜像刷新不算编辑
      _recallMirrorLastMs = nowMs
      return true
    }
    // 镜像刷新（_ledgerRefresh 顺带 = 日评估 cron 通道）：无镜像笔记 → 跳过（新装库零笔记足迹，永不懒建）；异常全吞不扩散账本主链路
    async function _recallMirrorRefresh(trigger) {
      try {
        await _recallMaybeMigrate()              // 未迁移先迁移（迁移自身已写镜像则此处内容门零改动跳过）
        const rl = await _recallResolve()
        if (!rl) return false
        await rootNoteEnsureSysKind(rl)
        return await _recallMirrorWrite(rl, trigger || 'cron', _recallMirrorOthers(rl.body))
      } catch (e) { return false }
    }
    // ---- 查询面（统计纯函数现算，不落盘——纪律②）----
    // 窗口内五通道分列（内存权威现算；telemetry.json 未加载/不存在 → 全零结构，静默降级）：
    //   交付通道（inject/mount/search/catalog）：delivered=交付的去重笔记数，deliveries=交付事件计数（原始回执 ids 计数累加/日聚合 count 累加），
    //     used=交付且窗口内被 get 实际取用的去重数，uses=那些笔记的取用总次数，rate=used/delivered（无交付 → null）；
    //   get 通道（纯使用信号，无交付侧）：delivered=0/rate=null，used=取用去重笔记数，uses=取用总次数。
    //   ledger 键（卡⑤新增）：账本刷新写入的指标快照（挂载总数/本周引用 Top5/零引用候选/任务挂载排行），无刷新记录 → null。
    function _recallComputeStats(sinceDays) {
      const fromDay = _recallDay(Date.now() - (sinceDays - 1) * 86400000)   // 日聚合窗口下沿（含当日共 sinceDays 天，日粒度字符串比较）
      const fromMs = Date.now() - sinceDays * 86400000                      // 原始回执 ts 窗口下沿
      const channels = {}
      for (const c of RECALL_CHANNELS) channels[c] = { deliveredIds: {}, deliveries: 0 }
      const getIds = {}
      const getCount = {}
      let events = 0
      const t = _telemetryCache
      if (t) {
        for (const ch of ['inject', 'mount', 'catalog']) {                  // 原始回执（低频通道）
          const arr = (t.receipts && t.receipts[ch]) || []
          for (const r of arr) {
            const ms = Date.parse(r.ts)
            if (!isFinite(ms) || ms < fromMs) continue
            const ids = Array.isArray(r.ids) ? r.ids : []
            events += ids.length
            for (const id0 of ids) { const id = String(id0); channels[ch].deliveredIds[id] = true; channels[ch].deliveries++ }
          }
        }
        for (const ch of ['search', 'get']) {                               // 日聚合（高频通道）
          const days = (t.byDay && t.byDay[ch]) || {}
          for (const d of Object.keys(days)) {
            if (d < fromDay) continue
            const bucket = days[d]
            for (const id of Object.keys(bucket)) {
              const cnt = bucket[id] || 0
              events += cnt
              if (ch === 'get') { getIds[id] = true; getCount[id] = (getCount[id] || 0) + cnt }
              else { channels[ch].deliveredIds[id] = true; channels[ch].deliveries += cnt }
            }
          }
        }
      }
      const out = {}
      for (const c of RECALL_CHANNELS) {
        if (c === 'get') {
          let uses = 0
          for (const id in getCount) uses += getCount[id]
          out.get = { delivered: 0, deliveries: 0, used: Object.keys(getIds).length, uses: uses, rate: null }
          continue
        }
        const st = channels[c]
        const ids = Object.keys(st.deliveredIds)
        let used = 0
        let uses = 0
        for (const id of ids) { if (getIds[id]) { used++; uses += getCount[id] || 0 } }
        out[c] = { delivered: ids.length, deliveries: st.deliveries, used: used, uses: uses, rate: ids.length ? Math.round(used / ids.length * 1000) / 1000 : null }
      }
      const rl = _recallNoteSync()
      return { noteId: rl ? rl.id : null, sinceDays: sinceDays, fromDay: fromDay, events: events, channels: out, ledger: (t && t.ledger) || null }
    }
    // 查询面入口（RPC + 镜像摘要共用）：读前落账（防抖 pending 与在途回执先 flush 再统计——自洽读）
    async function _recallStats(opts) {
      const sinceDays = Math.max(1, Math.floor((opts && opts.sinceDays) || 7))
      await _recallFlushAgg()
      return Object.assign({ ok: true }, _recallComputeStats(sinceDays))
    }
    // 分通道行格式化（镜像摘要/面板共用）：交付通道 `ch used/delivered·pct%`（无交付 → `ch 无交付`）+ get 取用计数
    function _recallFmtChannels(channels) {
      const parts = []
      for (const c of ['inject', 'mount', 'search', 'catalog']) {
        const st = channels[c]
        if (!st || !st.delivered) { parts.push(c + ' 无交付'); continue }
        parts.push(c + ' ' + st.used + '/' + st.delivered + '·' + Math.round(st.rate * 100) + '%')
      }
      const g = channels.get
      parts.push('get 取用 ' + (g ? g.used : 0) + ' 条/' + (g ? g.uses : 0) + ' 次')
      return parts.join('、')
    }
    // 手动查询 RPC：notes-recall-stats {sinceDays?}（缺省 7 天；只读——除读前落账 flush 防抖 pending 外零副作用；
    //   返回结构不变 + 卡⑤新增 ledger 键：「召回指标」汇总输出本 RPC（面板数据源），索引笔记 §2 通道已退役摘除）
    disposers.push(handle('notes-recall-stats', async (args) => {
      try { return await _recallStats({ sinceDays: args && args.sinceDays }) }
      catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== recall-telemetry END ====
