    // ==== history-engine BEGIN ====（host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包同步：路径拼接与删除通道差异同 purgeNoteFile 先例——开发版 '\\' 拼接 + 墓碑式清空；静态包 path.join + processPath 真删。改动必须双边同步）
    // 快照式历史引擎：persistNote 每次真实落盘前，把「被替换的上一版」快照进 NOTES_DIR\.history\<noteId>\<ISO时间戳>.<hash>.md
    // （纯文本不压缩不加密，目录即格式；文件名 = UTC ISO 时间戳（':' 在 Windows 文件名非法 → '-'）+ 稳定内容 hash 后缀，字典序即时序，免读 mtime）。
    // 触发对齐 doSave 防抖：client 防抖后每次真实保存 = 一次 persistNote = 一次快照；创建首版无旧版可快照（缓存未命中自然跳过）。
    // 上一版来源 = persistNote 写盘前的 cache 原件经 noteFileContent 重建字节（插件写入全经 persistNote 同步缓存，缓存即盘上字节）——
    //   零新增磁盘读（update 主路径红线）；例外：useCount 内存累积未落盘时重建字节比盘上多一行计数差、外部手写文件经 FM 规范化重建（均内容等价）。
    //   浅拷贝别名注意：派发等原地变异路径的元数据字段可能已是新值，正文始终正确（字符串不可变）。
    // 内容去重：hash 只覆盖「稳定内容」（剔除 updatedAt/useCount 易变字段——保存时间戳/遥测计数不算内容变化）；
    //   与该笔记最新快照文件名内嵌 hash 比对，相同则跳过（无变化重复保存场景）；hash 内嵌文件名使插件重载后去重仍零读盘有效。
    // 保留策略（写入路径摊销执行，无定时器）：分层——1h 内每版全留 / 当天每小时 1 版 / 7 天内每天 1 版 / 超 7 天淘汰；
    //   单笔记硬上限 20 版（超限淘汰最旧）；全库 .history 总预算 50MB（LRU 跨笔记淘汰最旧快照）。
    // 删除语义同 purge：ctx.fs 无删除契约 → 开发版墓碑式清空（0 字节，histEnsureScanned 视作不存在）；静态包 processPath 可用时 node:fs 真删。
    // 性能红线：_list/_get/_search 主读取路径零新增 IO（.history 是子目录，列表只认 n-*.md 直子级，天然不枚举）；
    //   快照/去重/保留/预算全部挂写入路径（persistNote/_purge/导入导出）；惰性全量扫描每 apply 生命周期至多一次。
    // 自动元数据回写（useCount 防抖落盘 / agent status idle 派发回执）不算编辑：persistNote 第二参 { history:false } 不产生历史版本。
    const HISTORY_DIR = NOTES_DIR + '\\.history'
    const HIST_NOTE_CAP = 20                             // 单笔记硬上限（超限淘汰最旧）
    const HIST_GLOBAL_BUDGET = 50 * 1024 * 1024          // 全库 .history 总预算（LRU 淘汰最旧快照）
    const HIST_KEEP_ALL_MS = 60 * 60 * 1000              // 分层：1h 内每版全留
    const HIST_KEEP_DAILY_MS = 7 * 24 * 60 * 60 * 1000   // 分层：7 天内每天 1 版（更早淘汰）
    let histSizes = null   // Map(noteId → Map(文件名 → 字节数))：存活快照清单（0 字节墓碑/非法名不入）；null=未扫描（首个历史操作惰性建）
    let histBytes = 0      // 存活总字节（与 histSizes 同步维护；导入合并历史后整体置 null 触发下次重扫）

    // 稳定内容 hash：FNV-1a 32bit + 长度（纯 JS——vm 沙箱无 node:crypto 依赖）；剔除 updatedAt/useCount 易变字段（保存时间戳/遥测不算内容变化）。
    // 只用于同笔记相邻快照去重，碰撞代价 = 少留一份内容相同的快照（可接受）
    function histContentHash(n) {
      const s = noteFileContent(n).replace(/^updatedAt:.*$/m, 'updatedAt:').replace(/^useCount:.*$/m, 'useCount:')
      let h = 0x811c9dc5
      for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0 }
      return s.length.toString(36) + '.' + h.toString(36)
    }
    // 快照文件名形态：'2026-09-17T06-02-34.123Z.<len36>.<hash36>.md'；反解析出 UTC ms（保留分桶用），非法名 → NaN（扫描跳过）
    function histNameTs(name) {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.(\d{3})Z\.[0-9a-z]+\.[0-9a-z]+\.md$/.exec(name || '')
      if (!m) return NaN
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7])
    }
    function histNameHash(name) {
      const m = /Z\.([0-9a-z]+\.[0-9a-z]+)\.md$/.exec(name || '')
      return m ? m[1] : ''
    }
    // 文件字节数：stat.size 可用优先；否则读回按 UTF-8 计（旧契约无 size 字段）；失败/墓碑空串 → 0
    async function histFileSize(ft) {
      try {
        const info = await fs.stat(ft)
        if (info && typeof info.size === 'number') return info.size
        return utf8Bytes(await fs.readText(ft))
      } catch (e) { return 0 }
    }
    // 删除一个快照文件（保留收敛/预算 LRU/purge 连带共用）：ctx.fs 无删除契约 → 墓碑式清空（0 字节，histEnsureScanned 视作不存在）；
    // 静态包 index.mjs 同名函数有 node:fs 真删除通道（fs.processPath 可用时优先真删）。
    async function histRemoveFile(noteId, name) {
      await fs.writeText(await fs.resolve(HISTORY_DIR + '\\' + noteId + '\\' + name), '', undefined, undefined, getPolicy())
    }
    // 惰性全量扫描（apply 生命周期首个历史操作至多一次）：建立存活清单 histSizes + 总字节 histBytes（0 字节墓碑视作不存在）
    async function histEnsureScanned() {
      if (histSizes) return
      histSizes = new Map()
      histBytes = 0
      let top = []
      try { top = await fs.listDir(await fs.resolve(HISTORY_DIR)) } catch (e) { return }
      for (const d of top) {
        const noteId = d && d.name
        if (!noteId || noteId.indexOf('n-') !== 0) continue
        let ents = []
        try { ents = await fs.listDir(await fs.resolve(HISTORY_DIR + '\\' + noteId)) } catch (e) { continue }
        const files = new Map()
        for (const en of ents) {
          const name = en && en.name
          if (!name || !isFinite(histNameTs(name))) continue
          const bytes = await histFileSize(await fs.resolve(HISTORY_DIR + '\\' + noteId + '\\' + name))
          if (bytes <= 0) continue
          files.set(name, bytes)
          histBytes += bytes
        }
        if (files.size) histSizes.set(noteId, files)
      }
    }
    // 单笔记保留收敛：分层（1h 每版 / 当天每小时 1 版 / 7 天每天 1 版 / 更早淘汰）+ 硬上限 20（淘汰最旧）
    async function histRetainNote(id) {
      const files = histSizes.get(id)
      if (!files || !files.size) return
      const now = Date.now()
      const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() }
      const todayKey = dayKey(now)
      const entries = Array.from(files.keys()).map(name => ({ name: name, ts: histNameTs(name) })).sort((a, b) => b.ts - a.ts)   // 新→旧
      const hourSeen = {}, daySeen = {}
      const keep = [], drop = []
      for (const e of entries) {
        const age = now - e.ts
        if (age <= HIST_KEEP_ALL_MS) { keep.push(e); continue }
        if (dayKey(e.ts) === todayKey) {
          const hk = new Date(e.ts).getHours()
          if (!hourSeen[hk]) { hourSeen[hk] = 1; keep.push(e); continue }
        } else if (age <= HIST_KEEP_DAILY_MS) {
          const dk = dayKey(e.ts)
          if (!daySeen[dk]) { daySeen[dk] = 1; keep.push(e); continue }
        }
        drop.push(e)
      }
      while (keep.length > HIST_NOTE_CAP) drop.push(keep.pop())   // keep 新→旧：pop = 淘汰最旧
      for (const e of drop) {
        try {
          await histRemoveFile(id, e.name)
          histBytes -= files.get(e.name) || 0
          files.delete(e.name)
        } catch (err) { console.error('notes: history retention failed', id, e.name, err) }
      }
    }
    // 全库预算：LRU 跨笔记淘汰最旧快照直到 ≤ 50MB（搭写入路径摊销；清单已在 histEnsureScanned 摊销建立）
    async function histEnforceBudget() {
      if (histBytes <= HIST_GLOBAL_BUDGET) return
      const all = []
      for (const [id, files] of histSizes) for (const [name, bytes] of files) all.push({ id: id, name: name, ts: histNameTs(name), bytes: bytes })
      all.sort((a, b) => a.ts - b.ts)   // 最旧优先淘汰
      for (const f of all) {
        if (histBytes <= HIST_GLOBAL_BUDGET) break
        try {
          await histRemoveFile(f.id, f.name)
          const m = histSizes.get(f.id)
          if (m) m.delete(f.name)
          histBytes -= f.bytes
        } catch (e) { console.error('notes: history budget sweep failed', f.id, f.name, e) }
      }
    }
    // 快照主入口：persistNote 写盘前调用（prev = 写盘前缓存原件）。失败绝不阻塞保存——历史是增强不是门槛
    async function histSnapshot(id, prev) {
      try {
        const h = histContentHash(prev)
        await histEnsureScanned()
        let files = histSizes.get(id)
        if (!files) { files = new Map(); histSizes.set(id, files) }
        // 内容去重：与该笔记最新快照（文件名内嵌 hash）相同则跳过。
        // 文件名 ts 按笔记单调递增（同毫秒连写/时钟回拨兜底：ts = max(现存 ts)+1）→ 字典序最大即最新，去重永不错位
        let newest = ''
        let ts = Date.now()
        for (const name of files.keys()) {
          if (name > newest) newest = name
          const ets = histNameTs(name)
          if (isFinite(ets) && ets >= ts) ts = ets + 1
        }
        if (newest && histNameHash(newest) === h) return
        const content = noteFileContent(prev)
        if (!content) return
        const name = new Date(ts).toISOString().replace(/:/g, '-') + '.' + h + '.md'
        await fs.writeText(await fs.resolve(HISTORY_DIR + '\\' + id + '\\' + name), content, undefined, undefined, getPolicy())
        const bytes = utf8Bytes(content)
        files.set(name, bytes)
        histBytes += bytes
        await histRetainNote(id)
        await histEnforceBudget()
      } catch (e) { console.error('notes: history snapshot failed', id, e) }
    }
    // purge 连带：删整棵 .history\<id>（含历史墓碑残留；开发版逐文件墓碑式清空，静态包逐个真删）；返回清除文件数
    async function histPurgeNote(id) {
      try {
        let names = []
        try { names = (await fs.listDir(await fs.resolve(HISTORY_DIR + '\\' + id)) || []).map(e => e && e.name).filter(Boolean) } catch (e) {}
        const files = histSizes ? histSizes.get(id) : null
        if (files) for (const n of files.keys()) { if (names.indexOf(n) < 0) names.push(n) }
        let purged = 0
        for (const name of names) {
          if (!/\.md$/i.test(name)) continue
          try { await histRemoveFile(id, name); purged++ } catch (e) { console.error('notes: history purge failed', id, name, e) }
        }
        if (files) { for (const b of files.values()) histBytes -= b; histSizes.delete(id) }
        return purged
      } catch (e) { console.error('notes: history purge failed', id, e); return 0 }
    }
    // 复制 <srcDir>\.history 全树（或仅 onlyId 一本笔记）到 <dstDir>\.history：导出 includeHistory / 导入前备份 / 导入合并共用。
    // 快照是纯文本（writeText 随写递归建目录）；0 字节墓碑不进出；skipExisting=同名快照跳过（导入合并只增不改）；返回复制文件数
    async function copyHistoryDir(srcDir, dstDir, skipExisting, onlyId) {
      let copied = 0
      let noteIds = []
      if (onlyId) {
        noteIds = [onlyId]
      } else {
        let top = []
        try { top = await fs.listDir(await fs.resolve(srcDir + '\\.history')) } catch (e) { return 0 }
        noteIds = top.map(e => e && e.name).filter(n => n && n.indexOf('n-') === 0)
      }
      for (const noteId of noteIds) {
        let ents = []
        try { ents = await fs.listDir(await fs.resolve(srcDir + '\\.history\\' + noteId)) } catch (e) { continue }
        for (const en of ents) {
          const name = en && en.name
          if (!name || !isFinite(histNameTs(name))) continue
          try {
            const c = await fs.readText(await fs.resolve(srcDir + '\\.history\\' + noteId + '\\' + name))
            if (!c) continue   // 0 字节墓碑不进出
            const dstFt = await fs.resolve(dstDir + '\\.history\\' + noteId + '\\' + name)
            if (skipExisting && await fs.stat(dstFt)) continue
            await fs.writeText(dstFt, c, undefined, undefined, getPolicy())
            copied++
          } catch (e) { console.error('notes: history copy failed', noteId, name, e) }
        }
      }
      return copied
    }
    // ---- 历史版本面板 RPC 支撑（notes-history-ui）：列表（轻量零正文）/ 预览正文 / 恢复（恢复前置自动快照——恢复本身可撤销）----
    // 按 ts（UTC 毫秒）定位存活快照文件名：单笔记文件名 ts 单调递增唯一（histSnapshot 兜底 max(现存)+1），histSizes 即存活清单（0 字节墓碑/非法名不入）
    async function histFindName(id, ts) {
      await histEnsureScanned()
      const files = histSizes.get(id)
      if (!files) return ''
      const target = Number(ts)
      if (!isFinite(target)) return ''
      for (const name of files.keys()) { if (histNameTs(name) === target) return name }
      return ''
    }
    // notes-history {id} → { versions: [{ts, bytes}] }：按时间倒序（新→旧），零正文明文——列表轻量，正文走 notes-history-get 按需加载
    async function _historyList(id) {
      if (!id) return { error: 'notes-history 需要 id' }
      await histEnsureScanned()
      const files = histSizes.get(id)
      const versions = []
      if (files) for (const [name, bytes] of files) {
        const ts = histNameTs(name)
        if (isFinite(ts)) versions.push({ ts: ts, bytes: bytes })
      }
      versions.sort((a, b) => b.ts - a.ts)
      return { versions: versions }
    }
    // notes-history-get {id, ts} → { ts, body }：快照字节 = 完整笔记文件（front-matter + 正文），返回 parseFM 解析出的正文（预览只读）
    async function _historyGet(id, ts) {
      if (!id) return { error: 'notes-history-get 需要 id' }
      const name = await histFindName(id, ts)
      if (!name) return { error: '历史版本不存在（可能已被保留策略淘汰）' }
      const content = await fs.readText(await fs.resolve(HISTORY_DIR + '\\' + id + '\\' + name))
      // 快照字节 = noteFileContent 产物（front-matter + 正文原形）：parseFM 节 77 起已吃掉闭合分隔符后全部前导换行，逐字节还原落盘前正文（cache 口径，旧「剥一个前导换行」绕行已消除）
      return { ts: Number(ts), body: parseFM(content).body || '' }
    }
    // notes-restore-history {id, ts} → 把历史版正文写回当前笔记（其余元数据不动，updatedAt 刷新）。
    // 安全核心 = 恢复前置快照：persistNote 缺省（opts.history 不传 ≠ false）在写盘前把「当前版」自动快照进 .history——恢复动作本身可撤销（再恢复一次即回滚）。
    async function _historyRestore(id, ts) {
      if (!id) return { error: 'notes-restore-history 需要 id' }
      const name = await histFindName(id, ts)
      if (!name) return { error: '历史版本不存在（可能已被保留策略淘汰）' }
      const note = Object.assign({}, await loadNote(id))
      if (note.deleted || note.tombstoned) throw new Error('Note has been deleted')
      const content = await fs.readText(await fs.resolve(HISTORY_DIR + '\\' + id + '\\' + name))
      note.body = parseFM(content).body || ''   // 还原落盘前正文原形（同 _historyGet 口径：parseFM 节 77 起已归一前导换行，无需再剥）
      note.updatedAt = new Date().toISOString()
      await persistNote(note)   // 恢复前置快照：当前版先自动入 .history（缺省快照语义），随后才写恢复版——恢复可再撤销
      return { id: id, restored: true, ts: Number(ts) }
    }
    // ==== history-engine END ====

    // opts.history===false：自动元数据回写（useCount 防抖/idle 派发回执）不算编辑，不产生历史快照；其余每次真实落盘前快照上一版
