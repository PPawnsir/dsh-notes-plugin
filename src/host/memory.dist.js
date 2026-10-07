    // ---- 显式归档（重构）----
    // 语义总览：
    //   1. 自动分组只处理速记（tags 含 quick，按 sessionId 分组，≥2 条才合并）。
    //      **行为变更**：手动笔记不再按标签自动分组（旧的 手动:<tags排序串> 分组逻辑已删除——漏合/过合两类失败的根因），
    //      手动笔记合并只能由调用方显式传 groups 白名单。
    //   2. notes-archive-preview：dry-run 零写入，返回将要自动合并的速记组；手动笔记不返回（由 client 多选构造组）。
    //   3. notes-archive 参数化 { groups: [{ memberIds, title? }] }：只合并白名单组；无 groups 时向后兼容旧调用但只合速记组。
    //   4. 撤销：每次实际合并成功后落盘 undo 事务文件（只保留最近一次），notes-archive-undo 撤销整次归档。
    //      .bak 备份机制保留不动（合并成员仍先备份再软删除）。

    // 归档撤销事务文件：{ at, groups: [{ noteId, memberIds }] }。
    // .json 后缀不进笔记列表（_list 只认 .md）；只保留最近一次（每次成功归档整体覆盖）；撤销成功后清空（groups: []）。
    const ARCHIVE_UNDO_PATH = path.join(NOTES_ROOT, '.archive-undo.json')

    // UTF-8 字节数（preview 的 bodyBytes/totalBytes 用；不依赖 Buffer，兼容 vm 沙箱全局受限环境）
    function utf8Bytes(s) {
      let n = 0
      for (const ch of String(s || '')) {
        const c = ch.codePointAt(0)
        n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
      }
      return n
    }

    // 速记自动分组：tags 含 quick 的未删笔记按 sessionId 分组；仅 ≥2 成员的组可合并。
    // 组内按 updatedAt 升序（与合并正文顺序一致），返回 [{ sessionId, members }]
    function _quickGroups(all) {
      const bySid = new Map()
      for (const n of all) {
        if ((n.tags || []).indexOf('quick') < 0) continue
        const sid = n.sessionId || 'none'
        if (!bySid.has(sid)) bySid.set(sid, [])
        bySid.get(sid).push(n)
      }
      const out = []
      for (const [sid, members] of bySid) {
        if (members.length < 2) continue
        members.sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))
        out.push({ sessionId: sid, members: members })
      }
      return out
    }

    // 归档预览（dry-run，零写入）：只返回将要自动合并的速记组（quick tag 按 sessionId，≥2 条）。
    // 手动笔记不返回——手动合并由调用方（client 多选 / agent）显式构造 groups 传给 notes-archive。
    // 无速记组时 quickGroups 为空数组。title 与 _mergeGroup 默认标题同规则（last.topic || first.title）。
    async function _archivePreview() {
      const all = await _list()
      const quickGroups = _quickGroups(all).map(g => {
        const last = g.members[g.members.length - 1]
        const members = g.members.map(n => ({
          id: n.id, title: n.title, updatedAt: n.updatedAt || '',
          bodyBytes: utf8Bytes(n.body), useCount: n.useCount || 0
        }))
        return {
          sessionId: g.sessionId,
          title: last.topic || g.members[0].title || '归档',
          members: members,
          dateSpan: {
            from: (g.members[0].updatedAt || g.members[0].createdAt || '').slice(0, 10),
            to: (last.updatedAt || last.createdAt || '').slice(0, 10)
          },
          totalBytes: members.reduce((s, m) => s + m.bodyBytes, 0),
          // 合计引用数（使用遥测）：组行展示用，对接显式归档决策
          totalUseCount: members.reduce((s, m) => s + m.useCount, 0)
        }
      })
      return { quickGroups: quickGroups }
    }

    // ==== suggest-helpers BEGIN ====（本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 提取比对 + eval 单测；改动必须双边同步）
    // 整理建议判定内核（notes-suggest 的纯函数部分，零外部函数依赖可 eval 单测）：
    // 让已合入的 useCount（遥测）+ staleDays（时效）数据产生闭环价值——主动提名整理动作。
    // 红线：只提名不执行（归档走 notes-archive-preview/notes-archive；删除由 client confirm 后逐条 notes-delete 软删）。
    // 双链判定与 client 编辑器同一正则口径：[[target]]（target 不含方括号/换行）；[[id]] 或 [[标题]] 精确命中即视为被引用。
    const SUGGEST_LINK_RE = /\[\[([^\[\]\n]+)\]\]/g
    // 孤儿候选上限：提名而非穷尽（防长列表淹没前两段；最旧的优先展示）
    const SUGGEST_ORPHAN_LIMIT = 20
    // 提取正文 [[target]] 出链（与 client 侧提取同口径；上限 500 防病态正文卡正则）
    function suggestLinkTargetsOf(body) {
      const out = []
      SUGGEST_LINK_RE.lastIndex = 0
      let m
      while ((m = SUGGEST_LINK_RE.exec(String(body == null ? '' : body)))) { out.push(m[1]); if (out.length >= 500) break }
      return out
    }
    // 时效判定：updatedAt 距今超过 limit 天 → 整天数；limit<=0（关闭）/无法解析/未超期 → 0
    // （与外层 staleDaysOf 同口径；本块自包含不引用外部函数，nowMs 可注入供单测取确定值）
    function suggestStaleDays(updatedAt, limit, nowMs) {
      if (limit <= 0) return 0
      const t = Date.parse(updatedAt || '')
      if (!isFinite(t)) return 0
      const d = Math.floor(((nowMs || Date.now()) - t) / 86400000)
      return d > limit ? d : 0
    }
    // 候选计算（纯函数；all = 未删除全量笔记，staleLimit = staleDaysLimit() 由调用方注入；nowMs 可选注入供单测取确定值）：
    //   staleCandidates：kind=note/link 且 updatedAt 距今 > staleLimit 且 useCount===0
    //     （从未被引用且过期的参考资料——最高优先清理信号；useCount>0 的过期笔记仍被 agent 引用，不提名）。按 staleDays 降序。
    //     工作记忆 v0：kind=log 永不进入 stale/orphan 候选——日志是记录类资产，只聚合不淘汰（§6.3），删除权完全留给用户。
    //   orphanCandidates：可能无用的孤儿笔记（上限 20，最旧在前）。判定条件（防误伤，缺一不可）：
    //     · kind='note'：普通笔记（todo/decision/link/quote 各有生命周期语义，不在此列）
    //     · status='active'：pinned/resolved/superseded 是显式用户状态，不动
    //     · inject=false：注入中的笔记正在影响会话系统提示，绝不提名
    //     · useCount=0：被 note_get 命中过即视为有价值
    //     · 正文无 [[..]] 出链，且全库无指向它的 [[id]]/[[标题]] 反向链接
    //       （all 不含已删笔记——已删笔记的链接不算活引用，与 client 反向链接面板口径一致）
    //     · 排除速记（tags 含 quick：已由 archiveCandidates 通道提名，避免双重提名误导）
    //     · 排除归档产物（mergedFrom 非空：合并归档笔记是「已整理」成果，提名删除会误伤归档结果）
    //     · 新建宽限期（0.4.6-E）：createdAt 距今 < SUGGEST_ORPHAN_GRACE_MS 不提名——刚建的笔记「未被引用」是常态而非信号，
    //       即刻提名「可能无用」对新用户是受打击的误伤（n-mux79kj4lwx9）；createdAt 不可解析 = 老旧存量，不豁免。
    //       stale 段天然免疫（须超 staleLimit 天）；遥测两段各有窗口期豁免口径，不叠加本宽限。
    const SUGGEST_ORPHAN_GRACE_MS = 86400000   // 新建宽限期 24h（0.4.6-E 常量先行+注释口径；后续可 settings 化）
    function suggestCandidates(all, staleLimit, nowMs) {
      const now0 = nowMs || Date.now()
      const staleCandidates = []
      if (staleLimit > 0) {
        for (const n of all) {
          if (n.kind === 'log') continue   // 日志永不被过期清理提名（工作记忆 v0 §6.3：记录类资产只聚合不淘汰；kind 白名单之外的显式双保险）
          if (n.kind === 'sys') continue   // 0.4.3⑥：kind=sys 系统根笔记（注入索引/记忆档案等机器产物）永不被过期清理提名（豁免面收口）
          if (n.kind !== 'note' && n.kind !== 'link') continue
          const sd = suggestStaleDays(n.updatedAt, staleLimit, now0)
          if (sd <= 0) continue
          if ((n.useCount || 0) > 0) continue   // 遥测保护：仍被引用的过期笔记不提名
          staleCandidates.push({ id: n.id, title: n.title, topic: n.topic || '', updatedAt: n.updatedAt || '', staleDays: sd })
        }
        staleCandidates.sort((x, y) => y.staleDays - x.staleDays)
      }
      // 反向链接索引：全库正文 [[target]] 集合（一次扫描；命中 id 或标题即视为被引用）
      const linkTargets = new Set()
      for (const n of all) for (const t of suggestLinkTargetsOf(n.body)) linkTargets.add(t)
      const orphans = []
      for (const n of all) {
        if ((n.kind || 'note') === 'log') continue   // 日志永不被孤儿清理提名（同上：只聚合不淘汰）
        if ((n.kind || 'note') === 'sys') continue   // 0.4.3⑥：kind=sys 系统根笔记永不被孤儿清理提名（机器产物豁免面收口，双重保险——下方 kind==='note' 白名单已天然排除）
        // 注入索引根笔记（0.4.3⑤ notes-043-index）：机器托管的管线载荷笔记，整理建议器永不提名（误删即断资料召回管线）
        if (typeof settingsCache !== 'undefined' && settingsCache && settingsCache.indexNoteId && n.id === settingsCache.indexNoteId) continue
        if (n.title === '注入索引（自动）') continue
        if ((n.kind || 'note') !== 'note') continue
        if ((n.status || 'active') !== 'active') continue
        if (n.inject === true) continue
        if ((n.useCount || 0) > 0) continue
        if ((n.tags || []).indexOf('quick') >= 0) continue
        if ((n.mergedFrom || []).length > 0) continue
        const cg = Date.parse(n.createdAt || '')
        if (isFinite(cg) && now0 - cg < SUGGEST_ORPHAN_GRACE_MS) continue   // 新建宽限期（0.4.6-E）：<24h 不提名
        if (suggestLinkTargetsOf(n.body).length > 0) continue
        if (linkTargets.has(n.id) || (n.title && linkTargets.has(n.title))) continue
        orphans.push({ id: n.id, title: n.title, topic: n.topic || '', updatedAt: n.updatedAt || '', createdAt: n.createdAt || '' })
      }
      orphans.sort((x, y) => String(x.updatedAt || '').localeCompare(String(y.updatedAt || '')))   // 最旧在前
      return { staleCandidates: staleCandidates, orphanCandidates: orphans.slice(0, SUGGEST_ORPHAN_LIMIT) }
    }
    // ---- 工作记忆 v0 日志卫生（logHygieneCandidates，§6.3 裁决 B②：只提名不执行，机械拼接口径）----
    // 两级聚合提名（dry-run 零写入，与 stale/orphan 同哲学——执行复用归档白名单通道，成员软删除可恢复、可撤销）：
    //   周聚合：logDate 距今 > weekDays（缺省 7 天）→ 按 工作区 × ISO 周 归组，同组 ≥2 条成候选（产物 工作周志 · <工作区> · <YYYY-Www>）
    //   月聚合：logDate 距今 > retentionDays（缺省 90 天；0=关闭本级）→ 按 工作区 × 月 归组（原始日志与周志混合归组），同组 ≥2 条成候选
    // 合并方式 = 机械拼接（不引入 LLM）：压条数不压信息量，dry-run 预览与实际产物逐字一致；v0 面板仅展示明细（聚合执行留待 Phase 2）。
    // logDate 缺失时回退 createdAt 前 10 位（YYYY-MM-DD 本地时区串）；无法解析的条目不提名（不依赖 title 反推，防标题被改后失键）。
    function suggestLogDateOf(n) {
      const s = String(n.logDate || '').slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
      const c = String(n.createdAt || '').slice(0, 10)
      return /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : ''
    }
    function suggestLogAgeDays(dateStr, nowMs) {
      const t = Date.parse(dateStr + 'T00:00:00')
      if (!isFinite(t)) return -1
      return Math.floor(((nowMs || Date.now()) - t) / 86400000)
    }
    // ISO-8601 周键（YYYY-Www）：周四归属口径（一周属于该周周四所在年份；getUTCDay()||7 把周日 0 归为 7）
    function suggestISOWeek(dateStr) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
      if (!m) return ''
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
      const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
      return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0')
    }
    function suggestLogHygiene(all, weekDays, retentionDays, nowMs) {
      const logs = []
      for (const n of all) {
        if ((n.kind || 'note') !== 'log') continue
        if (n.deleted) continue
        const ld = suggestLogDateOf(n)
        if (!ld) continue
        const age = suggestLogAgeDays(ld, nowMs)
        if (age < 0) continue
        logs.push({ n: n, logDate: ld, age: age })
      }
      const memberOf = (x) => ({ id: x.n.id, title: x.n.title, logDate: x.logDate, sessionId: x.n.sessionId || '', updatedAt: x.n.updatedAt || '' })
      // 归组：keyFn 产 null/'' 的条目不成组；同组 ≥2 条才成候选（单条无需聚合）
      const mkGroups = (arr, keyFn) => {
        const by = new Map()
        for (const x of arr) { const k = keyFn(x); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(x) }
        const out = []
        for (const kv of by.entries()) { if (kv[1].length >= 2) out.push({ key: kv[0], members: kv[1].map(memberOf) }) }
        return out
      }
      const weekly = [], monthly = []
      if (weekDays > 0) {
        for (const g of mkGroups(logs.filter(x => x.age > weekDays), x => String(x.n.workspace || '') + '|' + suggestISOWeek(x.logDate))) {
          const cut = g.key.lastIndexOf('|')
          const ws = g.key.slice(0, cut), wk = g.key.slice(cut + 1)
          weekly.push({ key: g.key, title: '工作周志 · ' + (ws || '未分类') + ' · ' + wk, workspace: ws, week: wk, members: g.members })
        }
      }
      if (retentionDays > 0) {
        for (const g of mkGroups(logs.filter(x => x.age > retentionDays), x => String(x.n.workspace || '') + '|' + x.logDate.slice(0, 7))) {
          const cut = g.key.lastIndexOf('|')
          const ws = g.key.slice(0, cut), mo = g.key.slice(cut + 1)
          monthly.push({ key: g.key, title: '工作月志 · ' + (ws || '未分类') + ' · ' + mo, workspace: ws, month: mo, members: g.members })
        }
      }
      const byKey = (a, b) => String(a.key).localeCompare(String(b.key))
      weekly.sort(byKey); monthly.sort(byKey)
      return { weekly: weekly, monthly: monthly }
    }
    // ---- 遥测驱动候选（0.4.5-C 治理建议器 v0：遥测消费端首卡——纯函数，遥测快照/挂载行/窗口下沿全部由调用方注入，可 eval 单测）----
    // 两个新候选类（只提名不执行红线同 stale/orphan；信号=启发式，清理裁决=全量+人工）：
    //   zeroRefMountCandidates（零引用挂载）：注入索引 §1 挂载行 id 集 ∩ 窗口内五通道（inject/mount/catalog 原始回执 + search/get 日聚合）
    //     零事件 → 建议「摘除挂载」（不删笔记）或「改文案」。豁免：①窗口内任一通道有事件即跳过（约定桶高频笔记 inject 通道有事件，
    //     天然豁免成立）；②新建未满窗口期——挂载时间戳无独立数据源，以笔记 createdAt 兜底口径：createdAt ≥ 窗口下沿（或无法解析）
    //     不提名（遥测未覆盖其完整生命周期，宁缺勿滥）；③死挂载行（目标已删/不在全量集）不提名（死链清理由图内核/守卫面负责）。
    //   hotUnmountedCandidates（高频取用未挂载）：窗口内 get+search 合计 ≥ hotMin（v0 缺省 3 次/14 天——常量先行+注释口径，
    //     后续可 settings 化）∩ 未在 §1 ∩ inject=false（已注入不提名——约定桶高频笔记豁免位）∩ kind=note/link；
    //     status≠active / quick 速记 / mergedFrom 归档产物豁免面同 orphanCandidates（防误伤同一哲学）。
    //     数据源 = byDay 高频双通道窗口聚合（facets.use 是全期总计数、无窗口维度，不作本判定数据源——口径注释锁定）。
    // 静默降级红线：t（遥测快照）缺失/损坏/非法 → 两类候选皆空数组（零异常上抛；stale/orphan 等既有输出零影响）。
    const SUGGEST_TELEM_WINDOW_DAYS = 14   // 遥测窗口缺省 14 天（v0 常量；调用方可经 opts.windowDays 覆写）
    const SUGGEST_TELEM_HOT_MIN = 3        // 高频阈值：窗口内 get+search 合计 ≥3 才提名（2 不提名/3 提名——边界语义锁定）
    const SUGGEST_TELEM_HOT_LIMIT = 20     // 高频候选上限（提名而非穷尽，与孤儿同哲学；取用降序保最热的在前）
    // 窗口内事件计数聚合（纯函数）：events = 五通道合计（零引用判据）；useHits = get+search 合计（高频判据）。
    //   fromMs = 原始回执 ts 窗口下沿（含）；fromDay = 日聚合本地日键下沿（含，YYYY-MM-DD 字符串比较，空串 = byDay 全量兜底）
    function suggestTelemWindowCounts(t, fromMs, fromDay) {
      const events = {}, useHits = {}
      if (!t || typeof t !== 'object') return { events: events, useHits: useHits }
      const receipts = t.receipts && typeof t.receipts === 'object' ? t.receipts : {}
      for (const ch of ['inject', 'mount', 'catalog']) {
        const arr = Array.isArray(receipts[ch]) ? receipts[ch] : []
        for (const r of arr) {
          const ms = Date.parse(r && r.ts)
          if (!isFinite(ms) || ms < fromMs) continue
          const ids = Array.isArray(r.ids) ? r.ids : []
          for (const id0 of ids) { const id = String(id0); events[id] = (events[id] || 0) + 1 }
        }
      }
      const byDay = t.byDay && typeof t.byDay === 'object' ? t.byDay : {}
      for (const ch of ['search', 'get']) {
        const days = byDay[ch] && typeof byDay[ch] === 'object' ? byDay[ch] : {}
        for (const d of Object.keys(days)) {
          if (d < fromDay) continue
          const bucket = days[d]
          if (!bucket || typeof bucket !== 'object') continue
          for (const id of Object.keys(bucket)) {
            const cnt = Math.max(0, Math.floor(Number(bucket[id]) || 0))
            if (!cnt) continue
            events[id] = (events[id] || 0) + cnt
            useHits[id] = (useHits[id] || 0) + cnt
          }
        }
      }
      return { events: events, useHits: useHits }
    }
    // 两候选类判定（纯函数）：all = 未删除全量笔记；mountLines = idxLinesSync() 形态 [{ id, when }]；opts = { windowDays, hotMin, nowMs, fromDay }
    function suggestTelemetryCandidates(all, mountLines, t, opts) {
      if (!t || typeof t !== 'object') return { zeroRefMountCandidates: [], hotUnmountedCandidates: [] }   // 静默降级红线：遥测缺失/损坏 → 两类皆空
      const o = opts || {}
      const windowDays = Math.max(1, Math.floor(o.windowDays || SUGGEST_TELEM_WINDOW_DAYS))
      const hotMin = Math.max(1, Math.floor(o.hotMin || SUGGEST_TELEM_HOT_MIN))
      const nowMs = o.nowMs || Date.now()
      const fromMs = nowMs - windowDays * 86400000
      const fromDay = typeof o.fromDay === 'string' ? o.fromDay : ''
      const counts = suggestTelemWindowCounts(t, fromMs, fromDay)
      const byId = {}
      for (const n of all || []) byId[String(n.id)] = n
      // ① 零引用挂载：§1 挂载行 ∩ 窗口内五通道零事件（豁免面见块头口径）
      const zeroRef = []
      const mountSet = {}
      for (const l of mountLines || []) {
        const id = String(l && l.id || '')
        if (!id || mountSet[id]) continue
        mountSet[id] = true
        const n = byId[id]
        if (!n || n.deleted) continue                          // 死挂载行不提名
        if ((counts.events[id] || 0) > 0) continue             // 窗口内任一通道事件即豁免
        const cms = Date.parse(n.createdAt || '')
        if (!isFinite(cms) || cms >= fromMs) continue          // 新建未满窗口期豁免（createdAt 兜底口径；不可解析同样豁免）
        zeroRef.push({ id: id, title: n.title, topic: n.topic || '', when: String(l.when || ''), updatedAt: n.updatedAt || '' })
      }
      zeroRef.sort((x, y) => String(x.updatedAt || '').localeCompare(String(y.updatedAt || '')))   // 最旧在前（与孤儿同序）
      // ② 高频取用未挂载：窗口内 get+search ≥ hotMin ∩ 未挂载 ∩ inject=false ∩ kind=note/link ∩ orphan 豁免面
      const hot = []
      for (const n of all || []) {
        const id = String(n.id)
        if (mountSet[id]) continue
        const k = n.kind || 'note'
        if (k !== 'note' && k !== 'link') continue             // log/sys/todo/decision/quote 豁免（orphan 面同哲学；log/sys 双保险）
        if ((n.status || 'active') !== 'active') continue
        if (n.inject === true) continue                        // 已注入笔记不提名（约定桶高频笔记天然豁免位）
        if ((n.tags || []).indexOf('quick') >= 0) continue
        if ((n.mergedFrom || []).length > 0) continue
        const hits = counts.useHits[id] || 0
        if (hits < hotMin) continue
        hot.push({ id: id, title: n.title, topic: n.topic || '', hits: hits, updatedAt: n.updatedAt || '' })
      }
      hot.sort((x, y) => (y.hits - x.hits) || String(x.id).localeCompare(String(y.id)))   // 取用降序（并列按 id 稳定序）
      return { zeroRefMountCandidates: zeroRef, hotUnmountedCandidates: hot.slice(0, SUGGEST_TELEM_HOT_LIMIT) }
    }
    // 两段互斥（0.4.6-E 建议器断点批，n-mux8beuj84i2）：hotUnmountedCandidates 命中的笔记不再进 orphanCandidates——
    //   同屏并列「可能无用」与「高频未挂载」观感直接矛盾（这条到底无用还是高频？）。互斥优先级：高频 > 可能无用
    //   （高频有窗口遥测实证信号，孤儿是启发式判定——实证优先，孤儿让位）。纯函数：返回剔除后的孤儿数组（原数组不改）。
    function suggestMutexFilter(orphans, hot) {
      if (!hot || !hot.length) return orphans || []
      const hotIds = {}
      for (const h of hot) hotIds[String(h && h.id)] = true
      return (orphans || []).filter(n => !hotIds[String(n && n.id)])
    }
    // ==== suggest-helpers END ====

    // 整理建议（notes-suggest，dry-run 零写入）：返回 { archiveCandidates, staleCandidates, orphanCandidates, logHygieneCandidates,
    //   zeroRefMountCandidates, hotUnmountedCandidates, telemetryWindowDays, generatedAt }
    // archiveCandidates 内聚复用 _archivePreview——速记组结构与 notes-archive-preview 完全同源，
    // client「去归档」直达归档预览对话框对接的正是同一批组（dry-run 非热路径，二次 _list 走缓存）。
    // logHygieneCandidates（工作记忆 v0 §6.3）：日志卫生两级聚合提名（周 >7 天 / 月 >90 天，设置键 logWeekAfterDays/logRetentionDays 可调），
    // 只提名不执行——v0 面板仅展示明细，合并执行（机械拼接 + 概览索引）走归档白名单通道留待 Phase 2。
    // zeroRefMountCandidates / hotUnmountedCandidates（0.4.5-C 治理建议器 v0 遥测消费端）：判定内核 = suggestTelemetryCandidates 纯函数
    // （口径/豁免面见 suggest-helpers 块头注释）；只提名不执行——摘除挂载复用 notes-update inject:false 既有通道（_idxSyncMount 联动摘行），
    // 挂载/改文案复用 MountModal（LLM 预填 notes-when-suggest），均人工确认才动作。
    async function _suggest() {
      await loadSettings()   // 幂等（缓存 promise）：确保 staleDays 用户 override 已加载生效
      const all = await _list(undefined, undefined, undefined, undefined, true)   // 治理路径显式包含日志（隐身只作用于日常浏览/默认搜索；stale/orphan 内核已排除 kind=log）
      const pv = await _archivePreview()
      const c = suggestCandidates(all, staleDaysLimit())
      // 遥测驱动两类候选（只读消费）：读前落账（_recallFlushAgg——防抖 pending 与在途回执先 flush 再统计，notes-recall-stats 同款自洽读）。
      //   可用性闸门：meta.lastFlush 缺失 = 遥测从未落账（新装库零事件 / telemetry.json 缺失 / 损坏自愈空桶）→ 两类候选静默为空
      //   （防「空遥测库上全量旧挂载被误提名零引用」）；计算异常同样静默降级——stale/orphan 等既有候选零影响（静默降级红线）。
      let telem = { zeroRefMountCandidates: [], hotUnmountedCandidates: [] }
      try {
        await _recallFlushAgg()
        const t0 = _telemetryCache
        if (t0 && t0.meta && t0.meta.lastFlush) {
          const nowMs = Date.now()
          telem = suggestTelemetryCandidates(all, idxLinesSync(), t0, {
            windowDays: SUGGEST_TELEM_WINDOW_DAYS, hotMin: SUGGEST_TELEM_HOT_MIN, nowMs: nowMs,
            fromDay: _recallDay(nowMs - (SUGGEST_TELEM_WINDOW_DAYS - 1) * 86400000)   // 日聚合窗口下沿（含当日共 14 天，notes-recall-stats 同口径）
          })
        }
      } catch (e) { /* 静默降级：遥测故障不扩散整理建议主输出 */ }
      // 两段互斥（0.4.6-E）：高频未挂载命中的笔记从「可能无用」剔除（互斥优先级注释见 suggestMutexFilter 块头）
      const orphansFinal = suggestMutexFilter(c.orphanCandidates, telem.hotUnmountedCandidates)
      return { archiveCandidates: pv.quickGroups, staleCandidates: c.staleCandidates, orphanCandidates: orphansFinal, logHygieneCandidates: suggestLogHygiene(all, logWeekAfterDaysLimit(), logRetentionDaysLimit()), zeroRefMountCandidates: telem.zeroRefMountCandidates, hotUnmountedCandidates: telem.hotUnmountedCandidates, telemetryWindowDays: SUGGEST_TELEM_WINDOW_DAYS, generatedAt: new Date().toISOString() }
    }

    // 合并一组笔记为一条归档笔记：正文按 updatedAt 升序拼接（## 日期 分节），原笔记先 .bak 备份再软删除。
    // 返回 { noteId, memberIds }（undo 事务记录用）
    async function _mergeGroup(members, titleOverride) {
      members = members.slice().sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))
      const now = new Date().toISOString()
      const bodyParts = members.map(n => {
        const d = (n.updatedAt || n.createdAt || '').slice(0, 10)
        return '## ' + d + '\n\n' + String(n.body || '').trim() + '\n'
      })
      const body = bodyParts.join('\n')
      const last = members[members.length - 1]
      const topic = last.topic || members[0].topic || '未分类'
      const title = titleOverride || last.topic || members[0].title || '归档'
      const r = await _create(title, body, members[0].tags || [], topic, {
        workspace: last.workspace || '',
        createdAt: members[0].createdAt || now,
        updatedAt: now,
        sessionId: last.sessionId || '',
        cwd: last.cwd || '',
        mergedFrom: members.map(n => n.id),
        // 使用遥测继承：归档笔记 useCount = 成员合计（合并不丢引用计数；撤销恢复成员原值）
        useCount: members.reduce((s, n) => s + Math.max(0, n.useCount || 0), 0),
        archivedAt: now,
        folder: last.folder || '',
        // 敏感继承：任一成员敏感则归档笔记敏感（合并正文含成员原文，泄露面不降级）
        sensitive: members.some(n => n.sensitive === true),
        // 曾注入继承（与 sensitive 同款 members.some）：任一成员曾注入/正注入 → 归档笔记 injectEver=true
        injectEver: members.some(n => n.injectEver === true || n.inject === true)
      })
      // 归档前先备份原笔记（.bak 后缀，_list 不会读到）
      for (const n of members) {
        try {
          const src = await fs.resolve(noteFile(n.id))
          const dst = await fs.resolve(noteFile(n.id) + '.bak')
          const c = await fs.readText(src)
          await fs.writeText(dst, c, undefined, undefined, getPolicy())
        } catch (e) {}
      }
      for (const n of members) { await _delete(n.id) }
      return { noteId: r.id, memberIds: members.map(n => n.id) }
    }

    // 归档（显式语义）：
    //   args.groups = [{ memberIds: [...], title? }] → 只合并白名单组；memberIds 必须全部存在且未删除、
    //     跨组/组内不重复（违反则整体报错不动手，避免半归档状态）；title 覆盖默认标题。
    //   无 groups 参数 → 向后兼容旧调用，但只自动合并速记组（行为变更：手动笔记不再自动分组）。
    // 返回兼容旧结构 { merged, mergedIds }，新增 groups: [{ noteId, memberIds }]（与 undo 事务同源）。
    // 有实际合并才覆盖 undo 文件（空归档保留上一次撤销能力）。
    async function _archive(args) {
      const a = args || {}
      const plan = []
      if (Array.isArray(a.groups)) {
        // 显式白名单组：先全量校验（存在/未删除/不重复），全部通过才动手
        const seen = {}
        for (const g of a.groups) {
          const ids = (g && Array.isArray(g.memberIds)) ? g.memberIds.map(String) : []
          if (ids.length < 2) throw new Error('notes-archive: 每组 memberIds 至少 2 条（实得 ' + ids.length + '）')
          const members = []
          for (const id of ids) {
            if (seen[id]) throw new Error('notes-archive: 笔记跨组/组内重复：' + id)
            seen[id] = true
            let n = null
            try { n = await loadNote(id) } catch (e) { n = null }
            if (!n || n.deleted) throw new Error('notes-archive: 成员不存在或已删除：' + id)
            members.push(n)
          }
          plan.push({ members: members, title: g.title ? String(g.title) : undefined })
        }
      } else {
        const all = await _list()
        for (const g of _quickGroups(all)) plan.push({ members: g.members })
      }
      let merged = 0
      const mergedIds = []
      const undoGroups = []
      for (const p of plan) {
        const r = await _mergeGroup(p.members, p.title)
        merged++
        mergedIds.push(r.noteId)
        undoGroups.push(r)
      }
      if (undoGroups.length) {
        try {
          const p = await fs.resolve(ARCHIVE_UNDO_PATH)
          await fs.writeText(p, JSON.stringify({ at: new Date().toISOString(), groups: undoGroups }, null, 2), undefined, undefined, getPolicy())
        } catch (e) { console.error('notes: archive undo file write failed', e) }
      }
      return { merged: merged, mergedIds: mergedIds, groups: undoGroups }
    }

    // 撤销最近一次归档：归档笔记软删除（deleted:true，可再经 restore 捞回）+ 成员批量 restore（deleted=false），
    // 成功后清空 undo 文件（写空组占位；不依赖 fs.delete）。无可撤销（无文件/损坏/已清空）→ { undone: 0 }。
    // 单条成员/归档笔记缺失时跳过该条，尽力撤销。
    async function _archiveUndo() {
      let tx = null
      try {
        const p = await fs.resolve(ARCHIVE_UNDO_PATH)
        tx = JSON.parse(await fs.readText(p))
      } catch (e) { return { undone: 0 } }
      const groups = (tx && Array.isArray(tx.groups)) ? tx.groups : []
      if (!groups.length) return { undone: 0 }
      let undone = 0, restored = 0
      for (const g of groups) {
        const memberIds = Array.isArray(g.memberIds) ? g.memberIds : []
        let ok = 0
        for (const id of memberIds) {
          try { await _restore(id); ok++ } catch (e) {}
        }
        if (g.noteId) { try { await _delete(g.noteId) } catch (e) {} }
        undone++
        restored += ok
      }
      try {
        const p = await fs.resolve(ARCHIVE_UNDO_PATH)
        await fs.writeText(p, JSON.stringify({ at: new Date().toISOString(), groups: [] }, null, 2), undefined, undefined, getPolicy())
      } catch (e) {}
      return { undone: undone, restored: restored }
    }


    // 归档（显式语义）：args.groups = 白名单组 [{memberIds, title?}]；无参 = 只合速记组（行为变更：手动笔记不再自动分组）
    disposers.push(handle('notes-archive', async (args) => {
      try { return await _archive(args) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 归档预览（dry-run 零写入）：只列速记自动分组；手动笔记须由调用方显式构造 groups 走 notes-archive
    disposers.push(handle('notes-archive-preview', async () => {
      try { return await _archivePreview() } catch (e) { return { error: String(e.message || e) } }
    }))
    // 撤销最近一次归档（undo 事务文件 .archive-undo.json）：归档笔记软删 + 成员批量恢复，成功后清空；无可撤销 → { undone: 0 }
    disposers.push(handle('notes-archive-undo', async () => {
      try { return await _archiveUndo() } catch (e) { return { error: String(e.message || e) } }
    }))
    // 整理建议（dry-run 零写入）：六类候选（速记组/过期未引用/孤儿/日志卫生/零引用挂载/高频取用未挂载——后两类 0.4.5-C 遥测驱动）——
    // 只提名不执行；过期未引用的批量软删由 client confirm 后逐条 notes-delete；遥测两类动作复用既有通道（notes-update 关注入 / MountModal）
    disposers.push(handle('notes-suggest', async () => {
      try { return await _suggest() } catch (e) { return { error: String(e.message || e) } }
    }))

    // ==== 工作记忆 v0：沉淀引导启用流程（裁决 A——复用约定体系，无独立注入管线；design/agent-memory-v0.md §5.1，r3 车道模型）====
    // 启用 = 创建一条预填约定笔记（inject=true + 用户选的作用域 injectTo），用户可在面板查看/编辑/停用/删除——单一注入源。
    // r3 车道模型（契约分型）：约定车道与记忆车道是并行车道——「记一下」两条路都走（约定→反馈笔记给人看；记忆→kind=log 自用召回），
    //   产物重复是设计意图非噪音；跨车道永不仲裁、永不检测冲突（r2 的跨车道关键词重叠检测已删除——产品裁决，非功能弱化）。
    //   check 退化为同类唯一性检查（已启用 → 返回已启用信息；未启用 → 直接可启用）；enable 无冲突确认闸门，幂等直建。
    // 契约身份分型：front-matter contractType=memory-guide 为结构化主识别键（op=status/disable 以其定位）；
    //   tag memory-guide 保留为兼容发现键（r2 及以前创建的存量引导笔记无 contractType，仍可识别/停用）。
    // 启用状态不落 settings.json：状态 = 存在 contractType=memory-guide（或兼容 tag）且 inject=true 的未删除笔记（单一事实源，杜绝双源漂移）。
    // 停用 = 关闭该约定笔记 inject（既有操作，op:'disable' 是便捷封装）；修改/删除走面板既有通道。
    // 再启用幂等复活（R-3，n-mut4mxe2m727）：存在已停用引导笔记 → 复用复活（inject=true + injectTo 按本次作用域更新），不新建第二条；
    //   已删除（回收站）引导不复活——删除即彻底退出，此时再次启用才新建。
    const MEMORY_GUIDE_TAG = 'memory-guide'   // 兼容发现键（存量引导笔记识别兜底；r3 起新建引导仍带此 tag，便于人读与检索）
    const MEMORY_GUIDE_CONTRACT_TYPE = 'memory-guide'   // 契约身份标记（front-matter contractType，r3 主识别键；同时复用为 origin 溯源值）
    const MEMORY_GUIDE_FOLDER = '工作日志'
    const MEMORY_GUIDE_TITLE = '约定：工作日志沉淀（工作记忆 v0）'
    // 引导笔记身份判定（契约分型）：contractType 结构化标记优先，tag 兼容兜底（存量 r2 引导笔记无 contractType）
    function isMemoryGuideNote(n) {
      return n.contractType === MEMORY_GUIDE_CONTRACT_TYPE || (n.tags || []).indexOf(MEMORY_GUIDE_TAG) >= 0
    }
    // 产物溯源判定（r3）：引导对本会话处于激活态？（inject=true 且 injectTo 命中本会话）
    // 数据源 = 常驻 cache 同步视图——与 conventionText 注入渲染同一事实源（注入里有的引导才视为「引导了本会话」），零新增磁盘 IO；
    // 无会话上下文（sid=''，面板手工建日志等 RPC 直调）不打标——origin 语义是「agent 会话在引导下的产物」。
    // _create 对 kind=log 且未显式传 origin 的产物自动落 origin=memory-guide（显式 origin 优先，可传 '' 关闭打标）。
    function memoryGuideActiveFor(sessionId) {
      const sid = shortSid(sessionId)
      if (!sid) return false
      for (const n of cache.values()) {
        if (!n || n.deleted || n.tombstoned) continue
        if (!isMemoryGuideNote(n)) continue
        if (n.inject === true && conventionHit(n, '', sid)) return true
      }
      return false
    }
    // 引导模板全文（§5.2）：时机/写法/同权口径（0.4.3⑦ 日志同权）/检索入口 + 【分工边界】必需段落（车道内容分工：日志只收工作结论，反馈仍走反馈约定——
    // 车道并行语义下两边可对同一事件各自产出，分工段约定的是「各车道收什么内容」，非冲突检测）
    const MEMORY_GUIDE_BODY = '【工作约定】会话工作沉淀（工作记忆 v0）\n\n在以下时机把本会话的工作结论沉淀为工作日志（note_manage，kind=log）：\n- 一个任务或阶段完成时（尤其看板任务验收/上线后）；\n- 用户显式说「记一下 / 沉淀一下 / 写工作日志」时；\n- 会话明显收尾（用户道别、长时间无新指令前的最后回合）。\n\n写法：\n1. 先 note_manage list（kind=log）查本会话今天是否已有日志：\n   有 → update 追加一节「## HH:mm 续」；无 → create（模板骨架见 KIND_TEMPLATES.log）。\n2. folder 传「工作日志」。日志与普通笔记同权：可见/可搜索/可编辑；\n   注入硬禁（无需也不能开 inject）；目录索引缺省不含（0.4.4-E 起目录段唯挂载行源；recall 字段 dormant——读写兼容但无注入效果，保持默认即可）。\n3. 返回 sensitiveSuggested=true 时必须补 sensitive: true。\n4. 「相关笔记」一节用 [[n-xxxxxxxx]] 双链引用本库笔记。\n5. 查历史工作日志：note_search 直接检索（日志已在默认搜索内；传 kind=log 只看日志）。\n\n【分工边界】本约定只管「会话工作结论沉淀」（做了什么/改了什么/遗留什么）。\n产品使用问题与体验反馈**不写入工作日志**——若同时注入了「看板反馈」\n「笔记反馈」类约定，那些内容按那些约定记到对应文件夹。两者正交、\n互不替代、互不合并。\n'
    async function _memoryGuide(args) {
      const a = args || {}
      const op = a.op || 'status'
      const all = await _list(undefined, undefined, undefined, undefined, true)   // 引导笔记是 kind=note 不受隐身影响；显式含日志保持口径统一
      const guides = all.filter(isMemoryGuideNote)   // 契约分型识别：contractType 主键 + tag 兼容
      const active = guides.find(n => n.inject === true) || null
      if (op === 'status') return { enabled: !!active, noteId: active ? active.id : (guides[0] ? guides[0].id : ''), guideIds: guides.map(n => n.id) }
      if (op === 'check') {
        // 同类唯一性检查（r3 车道模型）：dry-run 零写入，只回答「记忆车道是否已在跑」——
        // 已启用 → 返回已启用信息（client 提示现状）；未启用 → 可直接启用。跨车道重叠检测已删除（并行语义，重复合法）。
        return { enabled: !!active, already: !!active, noteId: active ? active.id : '' }
      }
      if (op === 'enable') {
        const scope = Array.isArray(a.scope) ? a.scope.map(String) : []
        if (active) return { ok: true, id: active.id, already: true }   // 幂等：已启用直接返回现状（重复启用不建第二条）
        // r3 车道模型：无冲突确认闸门（不再返回待确认响应，confirmed 参数不再需要）——约定车道共存是设计意图，无需用户裁决
        // 同时确保虚拟文件夹「工作日志」存在（同名复用不重复建；日志默认落入；0.4.4-G：创建带 sys:true 机器属性——自动沉淀夹默认隐身，
        //   命中复用路径不触碰 sys（用户右键摘除的显式 false 墓碑不回弹）；存量缺席字段由 loadFolders 懒迁移置位）
        const folders = await loadFolders()
        let logFolder = null
        for (const f of folders) { if (f.name === MEMORY_GUIDE_FOLDER) { logFolder = f; break } }
        if (!logFolder) {
          const maxOrder = folders.reduce((m, f) => Math.max(m, f.order), -1)
          logFolder = { id: genFolderId(), name: MEMORY_GUIDE_FOLDER, order: maxOrder + 1, sys: true }
          folders.push(logFolder)
          await saveFolders(folders)
        }
        // R-3 幂等复活（n-mut4mxe2m727）：存在已停用（inject≠true）的未删除引导笔记 → 复用复活（inject=true +
        //   按本次对话框作用域更新 injectTo），不再新建第二条——停用/启用往返零重复（目录/搜索不再出现双份同名约定）。
        //   多条残留时取 _list 序首条（pinned 优先 + 最近更新），其余留存为用户数据不代清理；已删引导不在 guides 内（_list 缺省排除 deleted）；
        //   排除 kind=log（日志 inject 硬闸会强制 false，复活必然失败）——引导笔记恒为 kind=note，此守卫仅挡用户手工打 tag 的病理场景。
        const dormant = guides.find(n => n.inject !== true && (n.kind || 'note') !== 'log')
        if (dormant) {
          await _update(dormant.id, undefined, undefined, undefined, undefined, undefined, undefined, true, scope)
          return { ok: true, id: dormant.id, revived: true, folderId: logFolder.id }
        }
        const r = await _create(MEMORY_GUIDE_TITLE, MEMORY_GUIDE_BODY, [MEMORY_GUIDE_TAG], '约定', { kind: 'note', inject: true, injectRole: 'convention', injectTo: scope, contractType: MEMORY_GUIDE_CONTRACT_TYPE })
        return { ok: true, id: r.id, folderId: logFolder.id }
      }
      if (op === 'disable') {
        if (!active) return { ok: true, disabled: false }   // 本就未启用（无 inject=true 的引导笔记）
        await _update(active.id, undefined, undefined, undefined, undefined, undefined, undefined, false)
        return { ok: true, disabled: true, id: active.id }
      }
      return { error: 'notes-memory-guide: 未知 op：' + String(op) + '（期望 check/enable/status/disable）' }
    }
    disposers.push(handle('notes-memory-guide', async (args) => {
      try { return await _memoryGuide(args) } catch (e) { return { error: String(e.message || e) } }
    }))
