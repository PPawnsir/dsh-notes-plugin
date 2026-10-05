    // ==== inject-index BEGIN ====（0.4.3⑤：注入索引根笔记 + 管线 reference 桶切换 + 挂载行级联动，notes-043-index）
    // 行为（总纲 n-muufiroz67it 卡5/7）：
    //   ①升级首启自动建「注入索引（自动）」根笔记（RootNote 框架创建；settings 记 indexNoteId 软链；自身不注入 inject=false；
    //     创建窗口经 rootNoteCreateLock 创建级锁串行化，并发首建竞态消除——0.4.3+ notes-043-ensure-lock）；
    //   ②§1 挂载清单：行格式 `- [[n-xxx]] 何时查我：…`（幂等键 = 笔记 id，同笔记唯一行，重挂载 = 换文案）；
    //     §2 召回指标节占位（卡 6 填充，本卡只保逐字节保留——rootNoteSplit others 区天然不碰）；
    //   ③管线切换（inject.js 消费）：reference 桶 = §1 逐行（每行 whenToUse + [[链接]]，agent 按需 note_get 拉正文）；
    //     旧「资料全文注入」通道下线；无索引/索引无行 → 回退空 reference 桶；约定桶全文注入不动（用户裁决红线）；
    //   ④联动：资料（reference）开注入 → 自动落缺省行（whenToUse=标题，弹层确认后 notes-mount 换文案）；
    //     关注入/改约定桶 → 摘行；删笔记（软删/彻底删）→ 清行（图内核死链联动上游——行摘了死链自然不出现）。
    //   ⑤索引笔记编辑器可见可手工整理（recall=false 不进目录注入，但列表/编辑器可见）；机器只行级操作（RootNote 节外零触碰）。
    // 依赖序位：rootnote.js（框架）之后、inject.js（管线消费）之前；_update/_delete/_purge/_create 包装序位在 graph.js 之后（RPC 域包装保留；
    //   graph 增量维护 0.4.3+ 已迁 onNoteChanged 事件总线，notes-043-event-bus——本模块包装与之不再叠加）。
    const INJECT_INDEX_TITLE = '注入索引（自动）'
    const INJECT_INDEX_HEAD = '## §1 挂载清单'
    const INJECT_INDEX_S2 = '## §2 召回指标'
    const INJECT_INDEX_BODY = INJECT_INDEX_HEAD + '\n\n' + INJECT_INDEX_S2 + '\n'
    const INJECT_INDEX_MAX = 200
    // RootNote 模板：newestFirst=false 挂载序稳定（追加节尾）；§2 指标节（非条目行）进 others 区逐字节保留
    const INJECT_INDEX_TPL = rootNoteTpl({
      head: INJECT_INDEX_HEAD,
      lineRe: /^\s*-\s\[\[[^\[\]\r\n]+\]\]/,
      keyOfLine: function (l) { const m = String(l).match(/\[\[([^\[\]\r\n]+)\]\]/); return m ? m[1] : l },
      keyOfEntry: function (d) { return d.id },
      lineOf: function (d) { return '- [[' + d.id + ']] ' + String(d.when == null ? '' : d.when).replace(/[\r\n]+/g, ' ').trim() },
      max: INJECT_INDEX_MAX,
      newestFirst: false
    })
    // 索引笔记解析（同步，conventionText 管线用）：indexNoteId 指针优先，丢了按 kind=sys 判定（0.4.3⑥）在 cache 自愈找回，
    //   再退按标题（存量旧笔记——升级前创建的索引）；都没有 → null
    function idxNoteSync() {
      try {
        if (settingsCache && settingsCache.indexNoteId) {
          const n = cache.get(String(settingsCache.indexNoteId))
          if (n && !n.deleted && !n.tombstoned) return n
        }
        for (const n of cache.values()) { if (!n.deleted && !n.tombstoned && (n.kind || 'note') === 'sys' && n.title === INJECT_INDEX_TITLE) return n }
        for (const n of cache.values()) { if (!n.deleted && !n.tombstoned && n.title === INJECT_INDEX_TITLE) return n }
      } catch (e) {}
      return null
    }
    // §1 挂载行解析（同步）：[{ id, when, raw }]——行首 `- [[target]] 文案`；无索引 → []（管线回退空 reference 桶）
    function idxLinesSync() {
      const rl = idxNoteSync()
      if (!rl) return []
      const out = []
      for (const l of String(rl.body || '').split('\n')) {
        const m = l.match(/^\s*-\s\[\[([^\[\]\r\n]+)\]\]\s*(.*)$/)
        if (m) out.push({ id: m[1], when: m[2] || '', raw: l.trim() })
      }
      return out
    }
    // 升级首启/指针丢失自愈：懒创建索引根笔记（kind=sys 系统根笔记——recall=false 不进目录注入；自身不 inject）；
    //   存量迁移（0.4.3⑥）：按标题找回的旧索引 kind≠sys → rootNoteEnsureSysKind 只写 kind 元数据（正文零变化红线）；返回托管笔记或 null
    // 创建级锁（0.4.3+ notes-043-ensure-lock）：「存在性检查 → 创建 → indexNoteId 回写」读-改-写窗口经 rootNoteCreateLock 串行化——
    //   并发首建竞态（索引不存在时两个并发 notes-mount 各建一篇，盘上孤儿索引文件）消除；命中既有索引走快路径不进锁零开销
    async function idxEnsure() {
      try {
        await loadSettings()
        let rl = idxNoteSync()
        if (rl) {
          await rootNoteEnsureSysKind(rl)
          if (settingsCache.indexNoteId !== rl.id) { settingsCache.indexNoteId = rl.id; await saveSettings() }
          return rl
        }
        return await rootNoteCreateLock(async function () {
          // 锁内双检：并发首建时后者命中前者产物（settings 指针/标题扫描同口径），不再重复创建
          rl = idxNoteSync()
          if (rl) {
            await rootNoteEnsureSysKind(rl)
            if (settingsCache.indexNoteId !== rl.id) { settingsCache.indexNoteId = rl.id; await saveSettings() }
            return rl
          }
          const cr = await _create(INJECT_INDEX_TITLE, INJECT_INDEX_BODY, ['自动'], '注入索引', { kind: 'sys', inject: false, recall: false })
          if (!cr || !cr.id) return null
          settingsCache.indexNoteId = cr.id
          await saveSettings()
          return rootNoteResolve(cr.id)
        })
      } catch (e) { return null }
    }
    // 挂载/换文案（幂等）：先摘同键旧行再落新行（同笔记唯一行）；机器只行级操作；返回索引笔记 id 或 null
    async function idxMount(noteId, whenToUse) {
      const rl = await idxEnsure()
      if (!rl) return null
      const key = String(noteId)
      await rootNoteRemoveLine(rl, INJECT_INDEX_TPL, key)
      await rootNoteAppend(rl, INJECT_INDEX_TPL, [{ id: key, when: whenToUse }])
      return rl.id
    }
    // 摘行（幂等零改动）：索引不存在/键未命中均 no-op 返回 false
    async function idxUnmount(noteId) {
      const rl = idxNoteSync()
      if (!rl) return false
      return rootNoteRemoveLine(rl, INJECT_INDEX_TPL, String(noteId))
    }
    // ---- 挂载 RPC：notes-mount { id, whenToUse? }（弹层确认落行；缺省 whenToUse = 标题）----
    disposers.push(handle('notes-mount', async (args) => {
      try {
        if (!args || !args.id) return { error: 'notes-mount 需要 id' }
        const n = await loadNote(String(args.id))
        if (!n || n.deleted || n.tombstoned) return { error: 'notes-mount: 笔记不存在' }
        const when = args.whenToUse === undefined || args.whenToUse === null ? String(n.title || '') : String(args.whenToUse)
        const rlId = await idxMount(String(args.id), when)
        if (!rlId) return { error: 'notes-mount: 索引笔记创建失败' }
        return { ok: true, id: String(args.id), indexNoteId: rlId, whenToUse: when }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // 索引总览（client 弹层回填 / 卡 6 指标数据源）：{ indexNoteId, lines:[{ id, when, raw }] }
    disposers.push(handle('notes-mount-list', async () => {
      try { const rl = idxNoteSync(); return { indexNoteId: rl ? rl.id : null, lines: idxLinesSync() } }
      catch (e) { return { error: String(e.message || e) } }
    }))
    // ---- 开关联动（单点收口包装）：_create / _update 后按注入态同步挂载行 ----
    // 同步判据：存活 + inject=true + injectRole=reference → 无行补缺省行（whenToUse=标题）；
    //          其余（关注入 / 约定桶 / 索引自身）→ 摘行（幂等零改动）。异常全吞（联动失败不阻塞主写路径）。
    async function _idxSyncMount(id) {
      try {
        const n = await loadNote(id)
        if (n && !n.deleted && !n.tombstoned && n.inject === true && n.injectRole === 'reference') {
          const has = idxLinesSync().some(function (l) { return l.id === String(n.id) })
          if (!has) await idxMount(n.id, n.title || n.id)
        } else if (n) { await idxUnmount(id) }
      } catch (e) {}
    }
    const _idxCreateOrig = _create
    _create = async function (title, body, tags, topic, opts) {
      const r = await _idxCreateOrig(title, body, tags, topic, opts)
      try { if (r && r.id) await _idxSyncMount(r.id) } catch (e) {}
      return r
    }
    const _idxUpdateOrig = _update
    _update = async function (id, title, body, tags, topic, kind, status, inject, injectTo, folder, recall, injectRole, sensitive, extra) {
      const r = await _idxUpdateOrig(id, title, body, tags, topic, kind, status, inject, injectTo, folder, recall, injectRole, sensitive, extra)
      try { await _idxSyncMount(id) } catch (e) {}
      return r
    }
    // 删笔记 → 清行（软删/彻底删双通道；恢复不自动回挂——挂载是显式动作，回收站恢复后可重开注入）
    const _idxDeleteOrig = _delete
    _delete = async function (id) {
      const r = await _idxDeleteOrig(id)
      try { await idxUnmount(id) } catch (e) {}
      return r
    }
    const _idxPurgeOrig = _purge
    _purge = async function (id) {
      const r = await _idxPurgeOrig(id)
      try { await idxUnmount(id) } catch (e) {}
      return r
    }
    // ==== inject-index END ====
