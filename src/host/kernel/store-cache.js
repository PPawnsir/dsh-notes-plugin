    // ---- 缓存层：解析结果按 id 常驻内存；本插件所有写入同步缓存，外部新增文件在 list 时懒加载 ----
    // 存储加固声明（notes-043-atomic-store）：写入原子性委托 DSH fs 服务 writeText（底层 writeFileAtomic：
    // staging+temp+sync+rename+targetKey 锁，见 kernel/persist.js 声明）；cache 为常驻权威，跨 apply 由磁盘恢复。
    //   sys 常驻语义：kind=sys 系统根笔记与普通笔记同走本通道（无特例写路径、无旁路缓存）——机器托管正文与全库同口径，
    //   盘上字节即 cache 权威源，重启后由磁盘 front-matter 逐字段重建（墓碑/软链字段一并恢复）。
    const KINDS = ['note', 'decision', 'todo', 'link', 'quote', 'log', 'sys']   // 工作记忆 v0：+ kind=log（工作日志；治理语义不同——默认隐身 + 永不被过期/孤儿清理提名，见 design/agent-memory-v0.md §4.1）
    // 0.4.3⑥（notes-043-sys-kind）：+ kind=sys（系统根笔记——机器托管的公司笔记：注入允许且是核心用途、recall 缺省 false
    //   （不进目录/默认召回）、编辑器可见可改；整理建议器/批量删除豁免面收口——见 memory.js suggestCandidates + selbar/archive 红字警示）
    const STATUSES = ['active', 'pinned', 'resolved', 'superseded']
    // ---- 二期：kind 模板骨架（新建笔记预填）+ ✨整理 LLM prompt 的模板示例，同源于此 ----
    // （client-impl.js / app.html / 原型 design/notes-editor-v3.html 同步维护同一份模板；check.js 断言一致）
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
    const AI_ORGANIZE_MAX_CHARS = 12000   // ✨整理草稿上限回落值（防 token 爆量）；0.4.7-B⑦ 起为「未知模型/未配置」回落档，超限报错引导分段
    const AI_ORGANIZE_INSTR_MAX_CHARS = 500   // 0.4.4-F：整理追加用户指令上限（trim 后计，超限报 error 不落 prompt）
    // ---- 0.4.7-B⑦（notes-047-ux）模型 → 整理正文上限小表（字符）----
    // 估算依据：整理 = 按模板重写全文，输入字符数 ≈ 输出字符数，瓶颈在模型单次「输出 token 上限」；
    //   折算口径 ≈ 输出 token 上限 × 2 字符/token（中英混合保守）× 0.75 安全边际；超大输出窗模型实务封顶 32000（防 token 爆量本意）。
    // 匹配 = model 名小写子串、命中第一行（先细后粗排列）；新增模型在此加行。未知模型回落 AI_ORGANIZE_MAX_CHARS。
    const AI_ORGANIZE_MODEL_MAX = [
      ['deepseek', 12000],    // deepseek-chat/reasoner 输出上限 8K tokens
      ['kimi', 24000],      // kimi-k2/k3 输出上限 16K tokens 级
      ['gpt-4o', 24000],    // 16K output
      ['gpt-5', 32000],     // 大输出窗，实务封顶 32K
      ['claude', 16000],    // 8K–64K 保守取档
      ['qwen', 12000],      // 8K output
      ['glm', 12000],       // 8K output 档
      ['gemini', 24000],    // 16K output 档
    ]
    // 整理长度上限生效值（0.4.7-B⑦）：用户 settings.organizeMaxChars（>0 覆盖）优先 || 模型表（按解析出的当前模型）|| 12000 回落。
    // 调用前须 loadSettings 就绪（organize/settings-get 两调用点均已 await）；模型解析失败/未配置 → 回落档（绝不抛错阻断）
    function organizeMaxChars() {
      const o = settingsCache && settingsCache.organizeMaxChars
      if (typeof o === 'number' && isFinite(o) && o > 0) return Math.floor(o)
      const sel = resolveLlmSelection()
      const mid = sel && typeof sel.model === 'string' ? sel.model.toLowerCase() : ''
      if (mid) { for (const row of AI_ORGANIZE_MODEL_MAX) { if (mid.indexOf(row[0]) >= 0) return row[1] } }
      return AI_ORGANIZE_MAX_CHARS
    }
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
        // recall：原目录索引准入字段——0.4.4-E 起目录段唯挂载行源，字段失去最后消费方；0.4.5-A（notes-045-debt-host）写侧退役落地
        //   （buildFM 不再写 recall 行，存量文件该行保留不迁移、本处解析保留 = 读写兼容红线；无注入效果）；
        // 缺省 true（旧文件无 recall 字段 → true，向后兼容解析保留）；显式 false 逐条置否（与 inject 正交）；
        // 工作记忆 v0（裁决 B①）/0.4.3⑥：kind=log/sys 缺省 recall=false（dormant 缺省口径保留）
        recall: p.meta.recall === 'true' ? true : (p.meta.recall === 'false' ? false : ((p.meta.kind === 'log' || p.meta.kind === 'sys') ? false : true)),
        // sensitive：敏感内容标记（注入时正文按行打码，键保留值遮蔽），缺省 false（存量零迁移）
        sensitive: p.meta.sensitive === 'true',
        // hidden：隐藏属性（0.4.4-D，纯 UI 遮罩——面板显隐开关关时滤除/开时半透明渲染；agent 面与读写面天然完整），缺省 false（存量零迁移）
        hidden: p.meta.hidden === 'true',
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
        // 效用账本（0.4.3⑥）：记忆档案 → 被引用记忆 id 的结构化软链，缺省 ''（存量零迁移；仅 notes-ledger 懒创建回写）
        refNote: p.meta.refNote || '',
        // 0.4.4-A 派发回执笔记化：执行记录伴生笔记软链（非调度派发源笔记顶层字段；调度约定走 schedule.runLog），缺省 '' 存量零迁移
        runLog: p.meta.runLog || '',
        // 定时派发·执行层：调度声明 + 机器状态（dispatch-schedule 约定笔记），缺省 null（存量零迁移；非法 JSON 回退 null 不触发）
        schedule: parseSchedule(p.meta.schedule),
        mergedFrom: p.meta.mergedFrom || [],
        dispatches: parseDispatches(p.meta.dispatches),
        // useCount：使用遥测（note_get 工具命中计数）——0.4.3 验收修复⑧起 front-matter 字段退役（buildFM 不再写入），
        //   此处仅读存量旧值作 facet seed 依据（_useFacetSync max 合并）；缺省/非法值回退 0（存量零迁移）
        useCount: Math.max(0, parseInt(p.meta.useCount, 10) || 0),
        archivedAt: p.meta.archivedAt || '',
        deleted: p.meta.deleted === 'true',
        body: p.body || ''
      }
    }

    async function readNoteFile(id) {
      perfStats.diskReads++
      const ft = await fs.resolve(NOTES_DIR + '\\' + id + '.md')
      const c = await fs.readText(ft)
      const note = noteFromParsed(id, parseFM(c))
      // purge 墓碑（0 字节占位）：ctx.fs 无删除契约，彻底删除只能清空——_list/_get/_update/_restore 视作不存在
      note.tombstoned = !c
      // useCount facet 供电（0.4.3 验收修复⑧）：旧 front-matter 值 seed 并入 facet + facet 更大抬头视图（双向 max 合并幂等）
      await _useFacetSync(note)
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
    // 0.4.3 验收修复⑧（notes-043-stats-unify）：useCount 收编 note-stats facet——telemetry.json facets.use {id:总计数} 为唯一事实源，
    //   front-matter useCount 字段退役（buildFM 不再写入；存量旧值由 _useFacetSync 作 seed max 合并并入，字段随下次真实保存自然脱落）。
    //   内存视图 n.useCount 保留且由 facet 供电——全部消费方（按引用排序/行尾角标/详情 chip/ledger useRank Top5/整理建议零引用保护/归档合计）读视图零改动。
    // 落盘：命中只改内存视图 + facet 内存增量（_telemetryBumpUse），复用遥测 2s 防抖通道落 telemetry.json（无独立定时器），卸载经 _recallFlushAgg 同盘 flush；
    //   note_get 热路径不再重写笔记 .md（写放大消除——旧遥测回写每次 flush 逐笔记 persistNote 全文重写，已随 flushUseCounts 一并拆除）。
    // 代价兜底：进程退出时防抖窗口内未落盘的计数丢失（可接受，下界语义；遥测 timer unref 不阻塞宿主退出——语义同卡⑤）。
    // 命中 +1：内存视图即时 +1（_list/slim/排序/角标立即可见）+ facet 总计数 +1（fire-and-forget 自含加载，静默降级不扩散）；
    //   作用于缓存原件（_get 已保证入缓存）；返回新计数，缓存未命中/墓碑返回 null（调用方忽略）
    function bumpUseCount(id) {
      const n = cache.get(id)
      if (!n || n.tombstoned) return null
      n.useCount = Math.max(0, n.useCount || 0) + 1
      _telemetryBumpUse(id)
      return n.useCount
    }
    // facet ⇄ 视图双向同步（载入 readNoteFile / 创建 _create 显式继承 / 导入 cache 直建三入口共用）：
    //   视图值（含旧 front-matter seed）max 合并入 facet；facet 更大 → 视图抬头（facet 是唯一事实源）。
    //   自含加载（遥测故障空桶不抛——静默降级不阻塞主流程）；种子未抬升时零置脏零写（存量重读零放大）；返回合并后总计数
    async function _useFacetSync(n) {
      try {
        if (!n || !n.id) return 0
        await _telemetryLoad()
        const fused = _telemetrySeedUse(n.id, Math.max(0, n.useCount || 0))
        if (fused > (n.useCount || 0)) n.useCount = fused
        return fused
      } catch (e) { return Math.max(0, (n && n.useCount) || 0) }
    }
    // ==== use-telemetry END ====

    // 笔记对象 → 磁盘文件字节（front-matter + 正文）：persistNote 写盘与历史快照重建「上一版」共用同一构造函数，保证字节同口径
    function noteFileContent(n) {
      const meta = {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags || [], kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectEver: n.injectEver === true || n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', sensitive: n.sensitive === true, hidden: n.hidden === true,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, logDate: n.logDate || '', entities: n.entities || [], summarizedAt: n.summarizedAt || '', contractType: n.contractType || '', origin: n.origin || '', refNote: n.refNote || '', runLog: n.runLog || '', schedule: n.schedule || null, mergedFrom: n.mergedFrom || [],
        dispatches: n.dispatches || [],
        // useCount 不落盘（0.4.3 验收修复⑧字段退役）：统计归 telemetry.json facets.use 单一事实源，buildFM 无此行
        // recall 不落盘（0.4.5-A notes-045-debt-host 写侧退役）：buildFM 无此行；内存视图保留（slim 读侧下发不变），存量行解析保留
        archivedAt: n.archivedAt || '', deleted: n.deleted ? 'true' : 'false'
      }
      return buildFM(meta) + (n.body || '')
    }

