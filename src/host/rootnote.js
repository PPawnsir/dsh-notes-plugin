    // ==== rootnote BEGIN ====（0.4.3 内核②：RootNote 托管节框架，notes-043-rootnote。
    // 目标：把「机器托管的根笔记自动节」从 runLog 专属实现提炼为一套通用框架——
    //   RootNoteTpl 模板声明式描述：锚点节标题（'## §名'）/ 行格式（lineOf 消费者注入）/
    //   排序（newestFirst 新→旧缺省）/ 容量上限（max 裁尾）/ 幂等键（keyOfLine/keyOfEntry 去重）/ 软链键（linkOf/writeLink）/
    //   preText（0.4.4-A：可选说明块——创建正文 = preText + head 锚点行；pre 区节外零触碰逐字节保留，同 injectindex 说明块先例）。
    // 红线（迁就现状格式，不是反过来）：
    //   ①节外零触碰——锚点节标题行与用户手写备注区逐字节保留；托管笔记其余正文原样；
    //   ②节锚点不存在则创建（首写时 pre 缺省补锚点行）；
    //   ③幂等——同幂等键条目已存在跳过（崩溃重放/双通道回执防御）；
    //   ④容量裁尾——合并序保留前 max 条（缺省新→旧 = 保最新裁最旧）；
    //   ⑤机器产物零历史快照——托管笔记创建/追加/摘行一律 persistNote { history:false }。
    // 创建级锁（0.4.3+ notes-043-ensure-lock）：rootNoteCreateLock 模块级单链串行化懒创建读-改-写窗口（见下方标记），
    //   索引（injectindex.js idxEnsure）/档案（ledger.js）/runLog（本框架 ensure）三消费点共用，并发首建不再产孤儿文件。
    // 依赖序位：本文件消费前位模块的 _create / loadNote / persistNote（notes.js / kernel/persist.js），被后位 schedule.js 消费。
    const ROOTNOTE_MAX_DEFAULT = 50
    // 模板归一：缺省补齐（head 必填；max 缺省 50；newestFirst 缺省 true；行格式缺省按 /^-\s/ 识别条目行、整行为幂等键）
    function rootNoteTpl(tpl) {
      return Object.assign({ max: ROOTNOTE_MAX_DEFAULT, newestFirst: true, lineRe: /^-\s/ }, tpl || {})
    }
    // 行幂等键：keyOfLine 注入优先，缺省整行
    function rootNoteKeyOfLine(tpl, line) { return tpl.keyOfLine ? tpl.keyOfLine(line) : line }
    // 节切分（纯函数）：body → { pre（至锚点行含；无锚点 = [锚点行]）, entries（条目行）, others（非条目非空行=用户手写备注） }
    //   无锚点时 rest = 全部行（迁就现状：与 runLog 原实现同口径，既有正文不丢，锚点行补在最前）
    function rootNoteSplit(body, tpl) {
      tpl = rootNoteTpl(tpl)
      const lines = String(body || '').split('\n')
      let headIdx = -1
      for (let i = 0; i < lines.length; i++) { if (lines[i].trim() === tpl.head) { headIdx = i; break } }
      const pre = headIdx >= 0 ? lines.slice(0, headIdx + 1) : [tpl.head]
      const rest = headIdx >= 0 ? lines.slice(headIdx + 1) : lines
      const entries = rest.filter(function (l) { return tpl.lineRe.test(l) })
      const others = rest.filter(function (l) { return !tpl.lineRe.test(l) && l.trim() !== '' })
      return { pre: pre, entries: entries, others: others }
    }
    // 节重写（纯函数）：pre + 空行 + 合并条目（新条目按排序入队 + 旧条目，按行幂等键去重，≤max 裁尾）+（备注区）
    function rootNoteRender(body, tpl, newLines) {
      tpl = rootNoteTpl(tpl)
      const sec = rootNoteSplit(body, tpl)
      const all = tpl.newestFirst === false ? sec.entries.concat(newLines) : newLines.concat(sec.entries)
      const seen = {}
      const merged = []
      for (const l of all) {
        const key = rootNoteKeyOfLine(tpl, l)
        if (seen[key]) continue
        seen[key] = true
        merged.push(l)
        if (merged.length >= (tpl.max || ROOTNOTE_MAX_DEFAULT)) break
      }
      let out = sec.pre.concat(['']).concat(merged)
      if (sec.others.length) out = out.concat(['']).concat(sec.others)
      return out.join('\n') + '\n'
    }
    // sys 归位（0.4.3⑥ notes-043-sys-kind）：存量托管笔记 kind 元数据迁移到 sys——只写 kind（正文/其余字段零变化红线），
    //   { history:false } 机器产物零历史快照；异常吞（迁移失败不阻塞主链路，下次 ensure 重试）
    async function rootNoteEnsureSysKind(n) {
      try {
        if (n && n.kind !== 'sys') {
          n.kind = 'sys'
          n.updatedAt = new Date().toISOString()
          await persistNote(n, { history: false })
        }
      } catch (e) {}
      return n
    }
    // 托管笔记解析：id 存活（非软删/非墓碑）→ 笔记，否则 null
    async function rootNoteResolve(id) {
      if (!id) return null
      try { const t = await loadNote(String(id)); if (t && !t.deleted && !t.tombstoned) return t } catch (e) {}
      return null
    }
    // 创建级锁（0.4.3+ notes-043-ensure-lock）：模块级单链 Promise（同 notes.js quickChain 模式）串行化全部
    //   「托管根笔记懒创建」的「存在性检查 → 创建 → 软链回写」读-改-写窗口——索引/档案/runLog 并发首建竞态
    //   （两个并发 ensure 各建一篇 → 盘上孤儿文件，软链指针只留其一）由此消除；单 host 进程内串行即可，不引跨进程锁。
    // 红线：①快路径零开销——命中既有根笔记的 ensure 不进锁（锁只覆盖创建窗口，并发 mount 正常路径不变慢）；
    //       ②失败不断链——创建抛错链不挂（.then 双参吞尾），后续调用仍可重试创建（死锁防护）；
    //       ③锁内不得再入队本链（同链重入 = 自死锁）——现消费者锁内仅 _create/persistNote/saveSettings/loadNote，无递归 ensure。
    let _rootNoteCreateChain = Promise.resolve()
    function rootNoteCreateLock(work) {
      const run = _rootNoteCreateChain.then(work)
      _rootNoteCreateChain = run.then(function () {}, function () {})
      return run
    }
    // ensure：软链（linkOf）失效/缺省 → 懒创建托管笔记（标题/类别/文件夹/主题随 tpl.hostNote 派生）+ writeLink 软链回写；
    //   创建窗口经 rootNoteCreateLock 串行化（notes-043-ensure-lock），锁内双检——并发 ensure 同 hostNote 时后者命中前者产物复用
    async function rootNoteEnsure(hostNote, tpl) {
      tpl = rootNoteTpl(tpl)
      const rl = await rootNoteResolve(tpl.linkOf ? tpl.linkOf(hostNote) : null)
      if (rl) { if (tpl.kind === 'sys') await rootNoteEnsureSysKind(rl); return rl }   // sys 模板才做存量 kind 迁移（非 sys 模板零触碰）
      return rootNoteCreateLock(async function () {
        // 锁内双检：重读宿主最新软链（调用方可能持陈旧快照——writeLink 经 persistNote 落缓存副本，此处读缓存权威）；
        //   宿主并发删除时回退入参快照（与原行为一致：仍按入参派生创建）
        const freshHost = await rootNoteResolve(hostNote.id)
        const rl2 = await rootNoteResolve(tpl.linkOf ? tpl.linkOf(freshHost || hostNote) : null)
        if (rl2) { if (tpl.kind === 'sys') await rootNoteEnsureSysKind(rl2); return rl2 }
        const cr = await _create(
          tpl.titleOf ? tpl.titleOf(hostNote) : String(hostNote.title || hostNote.id),
          (tpl.preText || '') + tpl.head + '\n', [],
          tpl.topicOf ? tpl.topicOf(hostNote) : '未分类',
          { kind: tpl.kind || 'note', folder: tpl.folderOf ? tpl.folderOf(hostNote) : undefined }
        )
        if (!cr || !cr.id) return null
        if (tpl.writeLink) await tpl.writeLink(hostNote, cr.id)
        return rootNoteResolve(cr.id)
      })
    }
    // 追加（幂等 + 裁尾 + 落盘）：entries 按时序旧→新传入；框架按排序自行倒序（新→旧时新条目在合并序前列）；
    //   entry 幂等键经 keyOfEntry（缺省行落键）；命中正文已存在跳过；返回是否落盘
    async function rootNoteAppend(rl, tpl, entries) {
      tpl = rootNoteTpl(tpl)
      const curBody = String(rl.body || '')
      const newLines = []
      const ordered = tpl.newestFirst === false ? entries : entries.slice().reverse()
      for (const d of ordered) {
        const line = tpl.lineOf(d)
        const key = tpl.keyOfEntry ? tpl.keyOfEntry(d) : rootNoteKeyOfLine(tpl, line)
        if (curBody.indexOf(key) >= 0) continue
        newLines.push(line)
      }
      if (!newLines.length) return false
      rl.body = rootNoteRender(curBody, tpl, newLines)
      rl.updatedAt = new Date().toISOString()
      await persistNote(rl, { history: false })
      return true
    }
    // 组合口（runLog 首消费者）：ensure + append，返回托管笔记或 null（异常由消费者吞）
    async function rootNoteAppendEnsured(hostNote, tpl, entries) {
      const items = (entries || []).filter(Boolean)
      if (!items.length) return null
      const rl = await rootNoteEnsure(hostNote, tpl)
      if (!rl) return null
      await rootNoteAppend(rl, tpl, items)
      return rl
    }
    // 按幂等键摘除条目行（removeLine）：节外零触碰——锚点行/备注区逐字节保留；无锚点或键未命中零改动；返回是否落盘
    async function rootNoteRemoveLine(rl, tpl, key) {
      tpl = rootNoteTpl(tpl)
      const body = String(rl.body || '')
      const sec = rootNoteSplit(body, tpl)
      if (body.split('\n').indexOf(tpl.head) < 0) return false
      const kept = sec.entries.filter(function (l) { return rootNoteKeyOfLine(tpl, l) !== key })
      if (kept.length === sec.entries.length) return false
      let out = sec.pre
      if (kept.length) out = out.concat(['']).concat(kept)
      if (sec.others.length) out = out.concat(['']).concat(sec.others)
      rl.body = out.join('\n') + '\n'
      rl.updatedAt = new Date().toISOString()
      await persistNote(rl, { history: false })
      return true
    }
    // ==== rootnote END ====
