    // ==== recall-telemetry BEGIN ====（0.4.3+ 卡⑫：统一召回遥测——五通道 × 交付/使用事件流水 + 分通道召回率查询面，notes-043-inject-receipt）
    // 覆盖矩阵（五通道，主窗口裁决 n-muufiroz67it 卡⑫ 修订版）：
    //   inject  装配（强）：conventionText 真实注入路径（预览 sidOverride 不计）实际渲染的约定 id 集 + 资料桶存活索引行 id 集；
    //   mount   任务挂载（中）：_dispatch 派发成功 = 笔记作为待办上下文挂载进目标任务会话
    //     （看板 contextFiles/contextNotes 属宿主域 task_create 通道，不在本插件观察面——本通道即笔记侧唯一可观测的挂载点，口径注明）；
    //   search  自由检索（弱）：notes-search RPC 与 note_search 工具各自实际返回的 id 集（两处埋点同源口径）；
    //   get     按需取（使用信号）：note_get 工具 + notes-get RPC 成功返回（取用 = 五通道统一的「使用」事件源）；
    //   catalog 目录（弱）：catalogText 真实渲染路径实际出清单的 id 集（可枚举，预览不计）。
    // 分仓策略（低频明细 + 高频日聚合）：
    //   · 低频通道（inject/mount/catalog）记原始回执行：- {"ts","channel","ids":[],"session"?}——
    //     签名去重（同通道同会话同 id 集连续重复装配只记一行，防每轮系统提示拼装写盘风暴；id 集按集合序判等——排序 join，换序不重复记；id 集/会话变化即新签名立即记）；
    //   · 高频通道（search/get）记日聚合行：- {"day","channel","id","count"}，行级 upsert 幂等（同日同通道同 id = count 累加，不爆行）——
    //     keyOfLine 取 day|channel|id 复合键，RootNote render 合并序新行在前、同键新行胜出 = 天然 upsert；
    //     内存 pending 累积 + 3s 防抖批量落盘（整批一次读-改-写）+ 卸载 flush（index.js effect 挂载点）。
    // 托管根笔记：「召回遥测（自动）」kind=sys + recall=false + inject=false（永不进目录注入），
    //   永不建议器提名（kind=sys 豁免面既有收口，memory.js 双重保险）；inject 红线锁（人为开注入 → 落盘时强制纠正，防套娃注入）；
    //   settings.recallNoteId 软链指针（与 indexNoteId 同模式）；机器产物零历史快照（{ history:false }）；容量红线 max 400 裁尾（保最新裁最旧）；
    //   首事件懒建：建帐与首批行一次 _create 落盘（不空建）；落盘不动 updatedAt（遥测计数不算编辑——useCount 落盘同哲学，防列表排序抖动）。
    // 红线：埋点零阻塞——全部 fire-and-forget + 静默降级（落盘失败吞异常，不扩散主流程）；写路径经 _recallChain 单链串行（读-改-写不交错）；
    //   查询语义零变化——只加遥测，不改任何既有返回结构（notes-recall-stats 为新增只读 RPC；读前落账 flush 保证自洽读）。
    // 依赖序位：rootnote.js（框架）+ injectindex.js/ledger.js（sys 根笔记先例）之后、inject/img-path-hint.js 之前；
    //   消费方 server/dispatch/inject/search/index 全部运行时引用（函数声明提升，RPC 调用期引用——节 45 方向断言看守）。
    const RECALL_TITLE = '召回遥测（自动）'
    const RECALL_HEAD = '## 事件流水（自动）'
    const RECALL_MAX = 400                  // 容量裁尾红线（合并序保最新裁最旧）
    const RECALL_AGG_DEBOUNCE_MS = 3000     // 高频通道日聚合防抖（整批一次落盘；卸载 flush 兜底）
    const RECALL_CHANNELS = ['inject', 'mount', 'search', 'get', 'catalog']
    // 行解析：`- {json}`；非法行 → null（手写备注行落 RootNote 备注区，节外零触碰保护，lint 不管）
    function _recallParseLine(l) {
      const m = String(l).match(/^\s*-\s(\{.*\})\s*$/)
      if (!m) return null
      try { const o = JSON.parse(m[1]); return o && typeof o === 'object' ? o : null } catch (e) { return null }
    }
    // 行幂等键：日聚合行（day+channel+id 齐备）→ 复合键（upsert 语义：同键新行替换旧行）；原始回执行 → 整行（ts 唯一，重放/双触发去重）
    function _recallKeyOfLine(l) {
      const o = _recallParseLine(l)
      if (o && o.day && o.channel && o.id) return o.day + '|' + o.channel + '|' + o.id
      return l
    }
    const RECALL_TPL = rootNoteTpl({
      head: RECALL_HEAD,
      lineRe: /^\s*-\s\{/,
      max: RECALL_MAX,
      newestFirst: true,
      keyOfLine: _recallKeyOfLine,
      lineOf: function (d) { return '- ' + JSON.stringify(d) }
    })
    // 本地日键（YYYY-MM-DD，日聚合行粒度；本地墙钟语义与 ledger 日志归键同口径）
    function _recallDay(ms) {
      const d = ms === undefined ? new Date() : new Date(ms)
      const p = function (n) { return (n < 10 ? '0' : '') + n }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    }
    // 遥测根笔记解析（同步，stats 读路径用）：settings.recallNoteId 指针优先，丢了按 kind=sys + 标题在 cache 自愈找回，再退按标题（存量旧笔记）
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
    // 解析（异步，落盘路径用）：同步口径之上补指针读盘兜底——重启/重载后冷缓存 cache.get 未命中时经 loadNote 读盘自愈，
    //   不重复建帐（同一 settings.json 指针跨 apply 生命周期稳定；loadNote 命中即回缓存）
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
    // 写路径单链串行化：全部落盘（原始行 + 聚合批量 upsert）经同一 promise 链排队，读-改-写不交错；失败吞（遥测永不阻塞主流程）
    let _recallChain = Promise.resolve()
    function _recallEnqueue(work) {
      _recallChain = _recallChain.then(work).catch(function () {})
      return _recallChain
    }
    // 落盘单点（仅链内调用）：RootNote render 合并（聚合行同键新行胜出 = upsert；原始行整行去重 = 重放防御）+ persistNote { history:false }。
    //   落盘不动 updatedAt（遥测计数不算编辑，useCount 同哲学——防列表排序抖动）；根笔记缺失时带首批行内联懒建（建帐 + 首写一次落盘，不空建）；
    //   存量根笔记：sys kind 迁移 + inject 红线锁（一次性元数据纠正，允许 bump updatedAt）+ 指针回写。
    async function _recallPersistRows(newLines) {
      if (!newLines || !newLines.length) return
      await loadSettings()
      let rl = await _recallResolve()
      if (!rl) {
        const cr = await _create(RECALL_TITLE, RECALL_HEAD + '\n\n' + newLines.join('\n') + '\n', ['自动'], '召回遥测', { kind: 'sys', inject: false, recall: false })
        if (!cr || !cr.id) return
        settingsCache.recallNoteId = cr.id
        await saveSettings()
        return
      }
      await rootNoteEnsureSysKind(rl)
      if (rl.inject === true) {   // 永不 inject 红线锁（与记忆档案同 pattern，防套娃注入）
        rl.inject = false
        rl.updatedAt = new Date().toISOString()
        await persistNote(rl, { history: false })
      }
      if (settingsCache.recallNoteId !== rl.id) { settingsCache.recallNoteId = rl.id; await saveSettings() }
      // 聚合行 upsert：pending 增量累加进既有同键行计数（读-改-写在 _recallChain 内串行，不交错）
      const body = String(rl.body || '')
      const sec = rootNoteSplit(body, RECALL_TPL)
      const existing = {}
      for (const l of sec.entries) {
        const o = _recallParseLine(l)
        if (o && o.day && o.channel && o.id) existing[o.day + '|' + o.channel + '|' + o.id] = o.count || 0
      }
      const merged = newLines.map(function (l) {
        const o = _recallParseLine(l)
        if (o && o.day && o.channel && o.id) {
          const k = o.day + '|' + o.channel + '|' + o.id
          const cnt = (existing[k] || 0) + (o.count || 0)
          existing[k] = 0   // 同批同键不重复累加（pending 键唯一，防御性兜底）
          return RECALL_TPL.lineOf({ day: o.day, channel: o.channel, id: o.id, count: cnt })
        }
        return l
      })
      rl.body = rootNoteRender(body, RECALL_TPL, merged)
      await persistNote(rl, { history: false })   // 不动 rl.updatedAt：机器遥测落盘不算编辑
    }
    // 低频通道原始回执行（inject/mount/catalog）：签名去重——同通道同会话同 id 集连续装配只记一行；
    //   签名按集合序（排序后 join）：同 id 集仅渲染顺序抖动（cache 迭代序/updatedAt 并列）不视为新交付——
    //   Verifier 驳回②修复：有序 join 会把同集合换序记成第二条交付行（遥测交付量虚增 + --only=78 断言脆）；
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
        const row = { ts: new Date().toISOString(), channel: channel, ids: list }
        if (session) row.session = String(session)
        const line = RECALL_TPL.lineOf(row)
        _recallEnqueue(function () { return _recallPersistRows([line]) })
      } catch (e) {}
    }
    // 高频通道日聚合（search/get）：内存 pending 累积 + 防抖批量落盘（整批一次读-改-写）；防抖定时器在 flush 时清除（卸载 flush 不二次触发）
    const _recallPending = {}
    let _recallAggTimer = null
    function _recallHit(channel, ids) {
      try {
        const day = _recallDay()
        let n = 0
        for (const id0 of ids || []) {
          const id = String(id0 || '')
          if (!id) continue
          const k = day + '|' + channel + '|' + id
          const cur = _recallPending[k] || { day: day, channel: channel, id: id, count: 0 }
          cur.count++
          _recallPending[k] = cur
          n++
        }
        if (!n || _recallAggTimer) return
        _recallAggTimer = setTimeout(function () { _recallAggTimer = null; _recallFlushAgg() }, RECALL_AGG_DEBOUNCE_MS)
        if (_recallAggTimer && typeof _recallAggTimer.unref === 'function') _recallAggTimer.unref()
      } catch (e) {}
    }
    // 聚合批量落盘（幂等 upsert）：清防抖定时器（手动/卸载 flush 不二次触发）→ pending 快照即清 → 链内累加合并单次 persist；
    //   落盘失败丢本批（遥测静默降级语义，不 retry 不阻塞）
    async function _recallFlushAgg() {
      try { if (_recallAggTimer) { clearTimeout(_recallAggTimer); _recallAggTimer = null } } catch (e) {}
      let batch
      try {
        const keys = Object.keys(_recallPending)
        if (!keys.length) return
        batch = keys.map(function (k) { return RECALL_TPL.lineOf(_recallPending[k]) })
        for (const k of keys) delete _recallPending[k]
      } catch (e) { return }
      await _recallEnqueue(function () { return _recallPersistRows(batch) })
    }
    // 查询面统计：窗口内五通道分列
    //   交付通道（inject/mount/search/catalog）：delivered=交付的去重笔记数，deliveries=交付事件计数（原始行 ids 计数累加/聚合行 count 累加），
    //     used=交付且窗口内被 get 实际取用的去重数，uses=那些笔记的取用总次数，rate=used/delivered（无交付 → null）；
    //   get 通道（纯使用信号，无交付侧）：delivered=0/rate=null，used=取用去重笔记数，uses=取用总次数。
    // 读前落账：防抖 pending 与在途原始行先 flush 再统计（自洽读）；根笔记不存在 → 全零结构（静默降级）。
    async function _recallStats(opts) {
      const sinceDays = Math.max(1, Math.floor((opts && opts.sinceDays) || 7))
      await _recallFlushAgg()
      await _recallChain.catch(function () {})
      const fromDay = _recallDay(Date.now() - (sinceDays - 1) * 86400000)   // 日聚合行窗口下沿（含当日共 sinceDays 天，日粒度字符串比较）
      const fromMs = Date.now() - sinceDays * 86400000                      // 原始回执行 ts 窗口下沿
      const channels = {}
      for (const c of RECALL_CHANNELS) channels[c] = { deliveredIds: {}, deliveries: 0 }
      const getIds = {}
      const getCount = {}
      let events = 0
      const rl = _recallNoteSync()
      if (rl) {
        const sec = rootNoteSplit(String(rl.body || ''), RECALL_TPL)
        for (const l of sec.entries) {
          const o = _recallParseLine(l)
          if (!o || RECALL_CHANNELS.indexOf(o.channel) < 0) continue
          if (o.day && o.id) {   // 日聚合行（search/get）
            if (String(o.day) < fromDay) continue
            const cnt = o.count || 0
            events += cnt
            if (o.channel === 'get') { getIds[o.id] = true; getCount[o.id] = (getCount[o.id] || 0) + cnt }
            else { channels[o.channel].deliveredIds[o.id] = true; channels[o.channel].deliveries += cnt }
          } else if (o.ts && o.ids) {   // 原始回执行（inject/mount/catalog）
            const ms = Date.parse(o.ts)
            if (!isFinite(ms) || ms < fromMs) continue
            events += o.ids.length
            for (const id0 of o.ids) { const id = String(id0); channels[o.channel].deliveredIds[id] = true; channels[o.channel].deliveries++ }
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
      return { ok: true, noteId: rl ? rl.id : null, sinceDays: sinceDays, fromDay: fromDay, events: events, channels: out }
    }
    // §2 旁挂行格式化（账本 _ledgerRefresh 消费）：交付通道 `ch used/delivered·pct%`（无交付 → `ch 无交付`）+ get 取用计数
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
    // 手动查询 RPC：notes-recall-stats {sinceDays?}（缺省 7 天；只读——除读前落账 flush 防抖 pending 外零副作用）
    disposers.push(handle('notes-recall-stats', async (args) => {
      try { return await _recallStats({ sinceDays: args && args.sinceDays }) }
      catch (e) { return { error: String(e.message || e) } }
    }))
    // ==== recall-telemetry END ====
