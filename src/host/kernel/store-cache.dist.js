    // ---- 缓存层：解析结果按 id 常驻内存；本插件所有写入同步缓存，外部新增文件在 list 时懒加载 ----
    const KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log']   // 工作记忆 v0：+ kind=log（工作日志；治理语义不同——默认隐身 + 永不被过期/孤儿清理提名，见 design/agent-memory-v0.md §4.1）
    const STATUSES = ['active', 'pinned', 'resolved', 'superseded']
    // ---- 二期：kind 模板骨架（新建笔记预填）+ ✨整理 LLM prompt 的模板示例，同源于此 ----
    // （与开发版 host-impl.js 双边同步；client-impl.js / app.html / 原型 design/notes-editor-v3.html 同款，check.js 断言一致）
    // note 为自由格式（空骨架）；机器/运维信息类笔记由 ✨整理按内容套用 MACHINE_TEMPLATE（建时无法预判内容，不进 KIND_TEMPLATES）
    const KIND_TEMPLATES = {
      note: '',
      decision: '## 背景\n\n（问题与上下文）\n\n## 结论\n\n（最终选择）\n\n## 理由\n\n（权衡与依据）\n',
      todo: '- [ ] （待办事项）\n',
      link: '## 链接\n\n（URL）\n\n## 说明\n\n（用途与要点）\n',
      quote: '> （引用原文）\n\n—— （出处）\n',
      // 工作记忆 v0 工作日志模板（design/agent-memory-v0.md §4.2 四节结构）；同日多次追加在正文尾部加「## HH:mm 续」小节（复用速记合并的时间戳小节模式）
      log: '## 做了什么\n\n（本会话完成的任务/阶段，一句话一条）\n\n## 改动\n\n（改动的文件/配置/数据，路径 + 一句话）\n\n## 遗留与后续\n\n（未完成事项、已知风险、下次接续的入口）\n\n## 相关笔记\n\n（[[n-xxxxxxxx]] 双链引用本库相关笔记；无则空）\n'
    }
    // 机器信息模板（✨整理 prompt 的 note kind 内容适配分支：环境/机器清单/账号/门户）
    const MACHINE_TEMPLATE = '## 环境\n\n（环境名称与说明）\n\n## 机器清单\n\n（主机名 / IP / 用途）\n\n## 账号\n\n（登录方式与账号）\n\n## 门户\n\n（门户与入口地址）\n'
    const KIND_LABELS_ZH = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用', log: '日志' }
    const AI_ORGANIZE_MAX_CHARS = 12000   // ✨整理草稿上限（防 token 爆量）；超限报错引导分段
    const cache = new Map()

    function noteFromParsed(id, p) {
      const tags = p.meta.tags || []
      // inject：显式 true/false 优先；旧数据（无 inject 字段）回退到 tags 含 convention（向后兼容）
      const inject = p.meta.inject === 'true' ? true : (p.meta.inject === 'false' ? false : tags.indexOf('convention') >= 0)
      // injectTo：数组（parseFM 已按 , 拆分）；旧数据若是字符串也兜底成数组
      let injectTo = []
      if (Array.isArray(p.meta.injectTo)) injectTo = p.meta.injectTo
      else if (p.meta.injectTo) injectTo = String(p.meta.injectTo).split(',').map(s => s.trim()).filter(Boolean)
      // injectRole：注入角色（convention=须遵守的约定 / reference=按需取用的资料）；缺省/非法值回退 'convention'（存量零迁移）
      const injectRole = p.meta.injectRole === 'reference' ? 'reference' : 'convention'
      return {
        id: p.meta.id || id,
        title: p.meta.title || 'Untitled',
        topic: p.meta.topic || '未分类',
        workspace: p.meta.workspace || '',
        folder: p.meta.folder || '',
        tags: tags,
        kind: p.meta.kind || 'note',
        status: p.meta.status || 'active',
        inject: inject,
        injectTo: injectTo,
        injectRole: injectRole,
        // recall：目录索引准入字段，缺省 true（旧文件无 recall 字段 → 进目录）；显式 false 逐条关闭（与 inject 正交）；
        // 工作记忆 v0 默认隐身（裁决 B①）：kind=log 缺省 recall=false（日志不进目录；显式 recall=true 允许进目录的豁免保留）
        recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : (p.meta.kind === 'log' ? false : true)),
        // sensitive：敏感内容标记（注入时正文按行打码，键保留值遮蔽），缺省 false（存量零迁移）
        sensitive: p.meta.sensitive === 'true',
        // injectEver：曾注入粘性标记（单向只升不降——inject 曾置 true 即永久 true，关闭不回退），缺省 false（存量零迁移）；
        // 当前 inject=true 蕴含曾注入（旧数据无字段时由现状兜底，保证 injectEver ⊇ inject 不变量）
        injectEver: p.meta.injectEver === 'true' || inject === true,
        createdAt: p.meta.createdAt || '',
        updatedAt: p.meta.updatedAt || '',
        sessionId: p.meta.sessionId || '',
        cwd: p.meta.cwd || '',
        // 工作记忆 v0 §7.2 检索字段：logDate（日志归键/聚合依据，缺省 ''）；entities（结构预留，缺省 []）；summarizedAt（自动总结节流阀，缺省 ''）
        logDate: p.meta.logDate || '',
        entities: Array.isArray(p.meta.entities) ? p.meta.entities : [],
        summarizedAt: p.meta.summarizedAt || '',
        // 工作记忆 v0 r3 车道模型：contractType（契约身份标记，memory-guide 引导笔记）；origin（产物溯源，引导激活期日志）；缺省 '' 存量零迁移
        contractType: p.meta.contractType || '',
        origin: p.meta.origin || '',
        mergedFrom: p.meta.mergedFrom || [],
        dispatches: parseDispatches(p.meta.dispatches),
        // useCount：使用遥测（note_get 工具命中计数），缺省/非法值回退 0（存量零迁移）
        useCount: Math.max(0, parseInt(p.meta.useCount, 10) || 0),
        archivedAt: p.meta.archivedAt || '',
        deleted: p.meta.deleted === 'true',
        body: p.body || ''
      }
    }

    function noteFile(id) { return path.join(NOTES_ROOT, id + '.md') }

    async function readNoteFile(id) {
      perfStats.diskReads++
      const ft = await fs.resolve(noteFile(id))
      const c = await fs.readText(ft)
      const note = noteFromParsed(id, parseFM(c))
      // purge 墓碑（0 字节占位）：ctx.fs 无删除契约时的彻底删除兜底形态——_list/_get/_update/_restore 视作不存在
      note.tombstoned = !c
      cache.set(note.id, note)
      return note
    }

    async function loadNote(id) {
      const hit = cache.get(id)
      if (hit) { perfStats.cacheReads++; return hit }
      return readNoteFile(id)
    }

    // ==== use-telemetry BEGIN ====（本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 比对；改动必须双边同步）
    // 使用遥测（P2）：note_get 工具命中计数——度量哪些笔记真的被 agent 读过。
    // 口径：只计 note_get 工具命中（agent 引用语义）；client 面板打开笔记的 notes-get RPC 不计（人类浏览非引用）。
    // 落盘频率控制：命中只改内存缓存对象（_list/slim 立即可见），60s 防抖批量落盘（避免高频写盘），插件卸载 flush。
    // 代价兜底：进程退出时防抖窗口内未落盘的计数丢失（可接受；timer unref 不阻塞宿主退出）。
    const USE_COUNT_FLUSH_MS = 60 * 1000
    const useCountDirty = new Set()   // 待落盘笔记 id（重复命中幂等）
    let useCountTimer = null
    // 命中 +1：作用于缓存原件（_get 已保证入缓存）；返回新计数，缓存未命中/墓碑返回 null（调用方忽略）
    function bumpUseCount(id) {
      const n = cache.get(id)
      if (!n || n.tombstoned) return null
      n.useCount = Math.max(0, n.useCount || 0) + 1
      useCountDirty.add(id)
      if (!useCountTimer) {
        useCountTimer = setTimeout(() => { useCountTimer = null; flushUseCounts() }, USE_COUNT_FLUSH_MS)
        if (useCountTimer && typeof useCountTimer.unref === 'function') useCountTimer.unref()
      }
      return n.useCount
    }
    // 防抖批量落盘：逐条 persistNote（buildFM 恒写 useCount，updatedAt 不动——计数不算编辑）；
    // { history:false }：遥测回写不算编辑，不产生历史快照（见 history-engine 块）；
    // 墓碑/已删/缓存失效跳过（删除时已带最新计数落盘，跳过无数据损失；0 字节墓碑不可复活；已删笔记不会再被 note_get 命中）
    async function flushUseCounts() {
      if (useCountTimer) { clearTimeout(useCountTimer); useCountTimer = null }
      const ids = Array.from(useCountDirty)
      for (const id of ids) {
        useCountDirty.delete(id)
        const n = cache.get(id)
        if (!n || n.tombstoned || n.deleted) continue
        try { await persistNote(n, { history: false }) } catch (e) { console.error('notes: useCount flush failed', id, e) }
      }
    }
    // ==== use-telemetry END ====

    // 笔记对象 → 磁盘文件字节（front-matter + 正文）：persistNote 写盘与历史快照重建「上一版」共用同一构造函数，保证字节同口径
    function noteFileContent(n) {
      const meta = {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags || [], kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectEver: n.injectEver === true || n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false, sensitive: n.sensitive === true,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, logDate: n.logDate || '', entities: n.entities || [], summarizedAt: n.summarizedAt || '', contractType: n.contractType || '', origin: n.origin || '', mergedFrom: n.mergedFrom || [],
        dispatches: n.dispatches || [],
        useCount: Math.max(0, n.useCount || 0),
        archivedAt: n.archivedAt || '', deleted: n.deleted ? 'true' : 'false'
      }
      return buildFM(meta) + (n.body || '')
    }

