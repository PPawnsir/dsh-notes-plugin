    // 由 sessionId 推导工作区名：live 走 agents 的 header.cwd，非 live 走 persistence/sessionQuery 快照。
    // 旧笔记（agents 未就绪期创建）workspace 为空时用于兜底补全——否则“本工作区”注入范围因严格匹配永不命中。
    async function _wsOfSession(sid) {
      if (!sid) return ''
      try {
        const a = agents && agents.get ? agents.get(sid) : undefined
        let cwd = (a && a.session && a.session.header && a.session.header.cwd) || ''
        if (!cwd && sessionPersistence && typeof sessionPersistence.list === 'function') {
          let snaps = []
          try { snaps = sessionPersistence.list() || [] } catch (e) { snaps = [] }
          if (snaps && typeof snaps.then === 'function') { try { snaps = await snaps } catch (e2) { snaps = [] } }
          for (const s of (snaps || [])) {
            const h = s && s.header ? s.header : s
            if (h && h.id === sid) { cwd = h.cwd || ''; break }
          }
        }
        // 兜底二：sessionQuery.readTitleSnapshots（_activeSessions 同款，已验证在当前 DSH 可用）
        if (!cwd && sessionQuery && typeof sessionQuery.readTitleSnapshots === 'function') {
          try {
            const rs = await sessionQuery.readTitleSnapshots([sid])
            for (const r of (rs || [])) {
              const v = r && r.status === 'fulfilled' ? r.value : (r && r.value)
              const hd = v && v.session ? v.session : null
              if (hd && hd.cwd) { cwd = hd.cwd; break }
            }
          } catch (e) {}
        }
        return cwd ? basename(cwd) : ''
      } catch (e) { return '' }
    }

    // ==== injectto-norm-guard BEGIN ====（injectTo 写入路径归一 + 非法显式拒绝：notes.js 与 notes.dist.js 双变体逐字节同步，check 节 53 看守）
    // 归一规则（错得安全：收窄失败必须显式失败，禁止静默放宽/静默吞）：
    //   ① 存量 'global'/'workspace' 原样透传（读路径兼容口径，不迁移）；② 等于活跃会话短 id → 原样保留；
    //   ③ 等于活跃会话完整 id（含经 shortSid 可约到的长形态）→ 归一为短 id 落盘（详情下拉勾选态按短 id 比对，长 id 落盘恒不命中——本 bug 核心）；
    //   ④ 短 id 形态但不在活跃集（历史会话已删）→ 保留原值不报错（治理连续性，读路径按短 id 比对仍可命中复活后的同名会话）；
    //   ⑤ 其余无法解析值 → 整体拒绝（报错含具体值，不部分保存）。
    // 红线：归一只在写入路径（_create/_update 显式传 injectTo 时），读路径（conventionHit 命中）不动；
    //       活跃会话集与 notes-sessions 同源（_activeSessions，含 pendingSessions 占位会话——标题未补齐不影响命中）。
    async function _normInjectTo(arr) {
      if (!Array.isArray(arr)) return { error: 'injectTo 须为字符串数组（实得 ' + typeof arr + '）' }
      let act = []
      try { const r = await _activeSessions(); act = ((r && r.sessions) || []).concat((r && r.pendingSessions) || []) } catch (e) { act = [] }
      const byShort = {}, byFull = {}
      for (const s of act) {
        if (!s) continue
        const sh = s.short || shortSid(s.id)
        if (sh) byShort[sh] = sh
        if (s.id) byFull[String(s.id)] = sh
      }
      const out = [], seen = {}
      const pushOnce = (v) => { if (!seen[v]) { seen[v] = true; out.push(v) } }
      for (const raw of arr) {
        const v = String(raw == null ? '' : raw).trim()
        if (!v) continue
        if (v === 'global' || v === 'workspace') { pushOnce(v); continue }   // ① 存量值透传
        if (byShort[v]) { pushOnce(v); continue }                            // ② 活跃会话短 id
        if (byFull[v]) { pushOnce(byFull[v]); continue }                     // ③ 完整 id → 归一短 id
        const sv = shortSid(v)
        if (byShort[sv]) { pushOnce(sv); continue }                          // ③ 长形态（带不带 session- 前缀）经归一命中活跃会话
        if (sv === v) { pushOnce(v); continue }                              // ④ 短 id 形态但会话已不在活跃集（历史已删）：保留原值不报错
        return { error: 'injectTo 含无法解析的会话标识符「' + v + '」（须为活跃会话短 id 或完整 id）' }   // ⑤ 整体拒绝
      }
      return { value: out }
    }
    // ==== injectto-norm-guard END ====

    async function _create(title, body, tags, topic, extra) {
      const id = genId()
      const now = new Date().toISOString()
      const sc = sessCtx()
      const ex = extra || {}
      // injectTo 写入归一 + 非法显式拒绝（injectto-norm-guard）：显式传才归一（undefined 不缺省归一）；非法值整体拒绝不落库
      let injectToNorm = ex.injectTo
      if (injectToNorm !== undefined) {
        const ng = await _normInjectTo(injectToNorm)
        if (ng.error) throw new Error(ng.error)
        injectToNorm = ng.value
      }
      // 工作记忆 v0 隐身硬闸（裁决 B①）：kind=log 强制 inject=false（显式传 true 也纠正，返回值 injectForcedOff 告知），
      // recall 缺省 false（显式 true 豁免——用户/agent 显式选择进目录不算混入）；日志永不进系统提示与目录索引
      const isLog = (ex.kind || 'note') === 'log'
      const injectForcedOff = isLog && ex.inject === true
      // 定时派发·执行层：schedule 声明写入闸门（校验红线：at 必须未来 / 轮询≥5min / 目标存活 / 契约配对——非法声明拒绝落库，错得安全）
      const createCT = ex.contractType || ''
      let scheduleDecl = null
      if (ex.schedule !== undefined && ex.schedule !== null) {
        const gate = await _schedValidateWrite(ex.schedule, createCT, null)
        if (gate.error) throw new Error(gate.error)
        scheduleDecl = gate.value
      } else if (createCT === SCHEDULE_CONTRACT_TYPE) {
        throw new Error('contractType=dispatch-schedule 需要 schedule 声明（schedule: { at|every, target }）')
      }
      const note = {
        id, title: title || 'Untitled', topic: topic || '未分类',
        workspace: ex.workspace || basename(sc.cwd),
        folder: ex.folder || '',
        tags: tags || [],
        kind: ex.kind || 'note',
        status: ex.status || 'active',
        inject: isLog ? false : ex.inject === true,
        // injectEver 粘性：创建即注入（inject=true）或显式继承（归档合并 members.some 传入）→ true；否则缺省 false
        // （kind=log 的 inject 已被硬闸纠正为 false，不随被纠正值拉起 injectEver）
        injectEver: isLog ? (ex.injectEver === true) : (ex.injectEver === true || ex.inject === true),
        injectTo: injectToNorm || [],
        injectRole: ex.injectRole === 'reference' ? 'reference' : 'convention',
        recall: isLog ? (ex.recall === true) : (ex.recall !== false),
        sensitive: ex.sensitive === true,
        createdAt: ex.createdAt || now, updatedAt: ex.updatedAt || now,
        sessionId: ex.sessionId !== undefined ? ex.sessionId : sc.sessionId,
        cwd: ex.cwd || sc.cwd,
        // 工作记忆 v0 §7.2：logDate 归键（YYYY-MM-DD 本地时区），kind=log 缺省取今天；entities 结构预留缺省 []；summarizedAt 仅自动总结产物写入
        logDate: ex.logDate || (isLog ? localDateStr() : ''),
        entities: Array.isArray(ex.entities) ? ex.entities : [],
        summarizedAt: ex.summarizedAt || '',
        // 工作记忆 v0 r3 车道模型·契约分型：contractType 仅显式透传（enable 流程落 memory-guide；普通创建为空）
        contractType: ex.contractType || '',
        // 工作记忆 v0 r3 车道模型·产物溯源：显式 origin 优先（含显式 '' 关闭打标）；kind=log 未显式指定时，
        // 若 memory-guide 引导对本会话激活（注入同源 cache 视图 + conventionHit 作用域口径）自动落 'memory-guide'——引导未激活/不在作用域则不打标
        origin: ex.origin !== undefined ? ex.origin : (isLog && memoryGuideActiveFor(sc.sessionId) ? MEMORY_GUIDE_CONTRACT_TYPE : ''),
        schedule: scheduleDecl,
        mergedFrom: ex.mergedFrom || [],
        dispatches: ex.dispatches || [],
        useCount: ex.useCount || 0,
        archivedAt: ex.archivedAt || '',
        deleted: false,
        body: body || ''
      }
      await persistNote(note)
      const r = { id, topic: note.topic, title: note.title, kind: note.kind, status: note.status }
      if (injectForcedOff) r.injectForcedOff = true   // 日志隐身硬闸命中告知（调用方可提示用户/agent）
      // 敏感模式自动识别建议：命中不强制落 sensitive（create 是显式动作，由调用方/用户决策），仅回传建议标记
      if (note.sensitive !== true && suggestSensitive(note.body)) r.sensitiveSuggested = true
      return r
    }

    // includeDeleted（P1 回收站）：缺省排除软删除；传 true 时 deleted 笔记一并返回（回收站列表数据源，slim 携带 deleted 标记）
    // includeLogs（工作记忆 v0 默认隐身）：缺省排除 kind=log；显式 kind=log 过滤 / includeLogs:true / 回收站（includeDeleted）路径才返回日志
    // （治理与数据完整性路径——整理建议/归档/导入导出/备份——由调用方显式传 includeLogs:true 包含日志）
    // R-6（裁决方向 A）：folder 显式给出（含 '' 未分类）= 显式文件夹导航，隐式召回 kind=log（等价 includeLogs:true）；
    // 隐身语义收窄为四个隐式表面——默认列表/默认检索/目录索引/注入（均不传 folder）——原样保持
    async function _list(tag, kind, folder, includeDeleted, includeLogs) {
      try {
        // 首次启动的一次性迁移（开发版 notes → ~/.dsh/notes）可能与首个 RPC 竞态，这里等一下
        try { await migrationDone } catch (e) {}
        const effLogs = includeLogs || folder !== undefined   // R-6：显式 folder 过滤隐式含 log（隐身只作用于不传 folder 的隐式表面）
        const dirTarget = await fs.resolve(NOTES_DIR)
        const info = await fs.stat(dirTarget)
        if (!info) return []
        // 仅在按文件夹过滤时读清单（无过滤调用保持零额外磁盘读）
        const folders = folder !== undefined ? await loadFolders() : null
        // 递归子树口径（folder-tree-helpers）：folder 非空 = 该文件夹及全部子孙文件夹内的笔记；'' = 未分类（口径不变）
        const folderSubtree = (folder !== undefined && folder !== '') ? folderSubtreeIds(folder, folders) : null
        const entries = await fs.listDir(dirTarget)
        const notes = []
        for (const entry of entries) {
          if (!entry.name || !entry.name.endsWith('.md')) continue
          const id = entry.name.replace(/\.md$/, '')
          try {
            const note = await loadNote(id)
            if (note.tombstoned) continue   // purge 墓碑（0 字节占位）：任何列表口径都不算存在
            if (note.deleted && !includeDeleted) continue
            if (note.kind === 'log' && !effLogs && !includeDeleted && !kind) continue   // 日志默认隐身（显式 kind=log / R-6 显式 folder 过滤已放行）
            if (tag && (note.tags || []).indexOf(tag) < 0) continue
            if (kind && note.kind !== kind) continue
            if (folder !== undefined) {
              const ef = effectiveFolder(note, folders)
              if (folder === '') { if (ef !== '') continue }
              else if (!folderSubtree[ef]) continue
            }
            notes.push(note)
          } catch (e) { console.error('notes: read failed', entry.name, e) }
        }
        // ==== list-union-defense BEGIN ====（DSH fs watcher 停滞窗口防御：dsh-fs-local 冷启动期 listDir 快照对新建文件长期不可见（实测 30min+ 不自愈；
        // writeText 落盘成功、按路径 readText 正常、唯独 listDir 停滞）——cache 是 create/update/delete 的第一写入点天然最新，
        // 这里把 cache 中不在本次目录列表里的非墓碑条目并集补入，不依赖上游修复。
        // 红线索：①幂等——正常时目录条目经 loadNote 命中同一 cache 对象，按 id 去重零重复行；
        // ②补入条目与目录条目走**完全相同**的过滤管线（deleted/log 隐身/tag/kind/folder 全照原口径逐条复评），不开特例后门；
        // ③墓碑排除——purge 后条目被逐出 cache（或读入时标 tombstoned）不补入，回收站（includeDeleted）口径同样不出现。
        // 本块 host-impl.js 与 packages/dsh-notes-plugin/index.mjs 双包逐字节一致，check.js 比对；改动必须双边同步）
        const listedIds = new Set()
        for (const ln of notes) listedIds.add(ln.id)
        for (const cn of cache.values()) {
          if (listedIds.has(cn.id)) continue   // 幂等去重：listDir 已见（loadNote 命中同一 cache 对象）
          if (cn.tombstoned) continue          // purge 墓碑（0 字节占位）：任何列表口径都不算存在
          if (cn.deleted && !includeDeleted) continue
          if (cn.kind === 'log' && !effLogs && !includeDeleted && !kind) continue   // 日志默认隐身（显式 kind=log / R-6 显式 folder 过滤已放行）
          if (tag && (cn.tags || []).indexOf(tag) < 0) continue
          if (kind && cn.kind !== kind) continue
          if (folder !== undefined) {
            const ef = effectiveFolder(cn, folders)
            if (folder === '') { if (ef !== '') continue }
            else if (!folderSubtree[ef]) continue
          }
          notes.push(cn)
        }
        // ==== list-union-defense END ====
        // 置顶（pinned）优先，其次按更新时间降序
        notes.sort((a, b) => {
          const pa = a.status === 'pinned' ? 1 : 0
          const pb = b.status === 'pinned' ? 1 : 0
          if (pa !== pb) return pb - pa
          return (b.updatedAt || '').localeCompare(a.updatedAt || '')
        })
        return notes
      } catch (e) {
        console.error('notes: list error', e)
        return []
      }
    }

    async function _get(id) {
      const note = await loadNote(id)
      if (note.deleted || note.tombstoned) throw new Error('Note has been deleted')
      return Object.assign({}, note)
    }

    // 回收站行预览专用（notes-trash-batch-preview）：已软删笔记正文只读可达；墓碑（已彻底删除）仍拒绝——正文已清空无可预览
    async function _getDeleted(id) {
      const note = await loadNote(id)
      if (note.tombstoned) throw new Error('Note has been deleted')
      return Object.assign({}, note)
    }

    // extra（工作记忆 v0 §7.2 检索字段透传 + r3 车道模型 contractType/origin 标记）：{ logDate?, entities?, summarizedAt?, contractType?, origin?, confirmClearBody? }——显式传才改（undefined 不动存量值）；confirmClearBody 为 R-1 空正文覆盖确认闸（不落盘，见 empty-body-overwrite-guard 块）
    async function _update(id, title, body, tags, topic, kind, status, inject, injectTo, folder, recall, injectRole, sensitive, extra) {
      const note = Object.assign({}, await loadNote(id))
      if (note.deleted || note.tombstoned) throw new Error('Note has been deleted')
      if (title !== undefined) note.title = title
      if (topic !== undefined) note.topic = topic
      if (tags !== undefined) note.tags = tags
      if (kind !== undefined) note.kind = kind
      if (status !== undefined) note.status = status
      // injectEver 单向粘性（never unset）：inject 显式置 true 时同步拉起；置 false/不传均不回退（injectEver = 旧值 || 新 inject）
      // 工作记忆 v0 隐身硬闸：生效 kind=log 时 inject 强制 false（显式传 true 也纠正，返回值 injectForcedOff 告知，且不拉起 injectEver）
      let injectForcedOff = false
      const effKind = (kind !== undefined ? kind : note.kind) || 'note'
      if (inject !== undefined) {
        if (effKind === 'log' && inject === true) { note.inject = false; injectForcedOff = true }
        else { note.inject = inject === true; if (inject === true) note.injectEver = true }
      }
      if (injectTo !== undefined) {
        // injectTo 写入归一 + 非法显式拒绝（injectto-norm-guard）：非法值整体拒绝，本条更新不落盘（错得安全）
        const ng = await _normInjectTo(injectTo)
        if (ng.error) throw new Error(ng.error)
        note.injectTo = ng.value
      }
      if (folder !== undefined) note.folder = folder
      if (recall !== undefined) note.recall = recall !== false
      if (injectRole !== undefined) note.injectRole = injectRole === 'reference' ? 'reference' : 'convention'
      // sensitive 第 13 位参数：显式传才改（undefined 不动存量值）
      if (sensitive !== undefined) note.sensitive = sensitive === true
      // extra 第 14 位参数（工作记忆 v0）：logDate/entities/summarizedAt 检索字段透传 + contractType/origin 车道模型标记（r3）
      const ex = extra || {}
      if (ex.logDate !== undefined) note.logDate = ex.logDate
      if (ex.entities !== undefined) note.entities = Array.isArray(ex.entities) ? ex.entities : []
      if (ex.summarizedAt !== undefined) note.summarizedAt = ex.summarizedAt
      // 定时派发·执行层：schedule 声明写入闸门（校验红线同上；机器状态字段 lastFiredAt/lastRun/lastError 由闸门延续存量）
      if (ex.schedule !== undefined) {
        const effCT = (ex.contractType !== undefined ? ex.contractType : note.contractType) || ''
        const gate = await _schedValidateWrite(ex.schedule, effCT, note.schedule)
        if (gate.error) throw new Error(gate.error)
        note.schedule = gate.value
      }
      if (ex.contractType !== undefined) {
        if ((ex.contractType || '') === SCHEDULE_CONTRACT_TYPE && !note.schedule) throw new Error('contractType=dispatch-schedule 需要 schedule 声明（schedule: { at|every, target }）')
        note.contractType = ex.contractType
      }
      if (ex.origin !== undefined) note.origin = ex.origin
      // ==== empty-body-overwrite-guard BEGIN ====（R-1 P0 数据丢失兜底；notes.js 与 notes.dist.js 双变体逐字节同步，check 节 46 看守）
      // 判据：body 显式传空串且现存正文非空 → 拒绝静默覆盖，抛错要求调用方显式传 extra.confirmClearBody===true 重试。
      // 选型理由（错得安全 = 失败时停在原状，而不是失败后留备份）：宁拒绝不墓碑——.bak 墓碑方案失败时已破坏现场
      // （活动正文被清空，用户面对空白笔记，要靠发现并手工找回 .bak）；拒绝方案下任何调用路径
      // （client get 失败空 body 提交 / 脚本 / 工具直调）都无法造成既成数据丢失，合法清空由显式确认放行。
      // 红线：只拦「空串覆盖非空」——undefined（不动正文）/ 空→空 / 非空覆盖照常；判据读缓存现值（loadNote 命中 cache），零新增磁盘读。
      if (body === '' && note.body && ex.confirmClearBody !== true) {
        throw new Error('notes-update 拒绝执行：body 为空串将覆盖现有非空正文（疑似 get 失败空正文覆盖路径，R-1 数据丢失防护）。如确认为有意清空，请显式传 confirmClearBody: true 重试')
      }
      // ==== empty-body-overwrite-guard END ====
      if (body !== undefined) note.body = body
      // P3 派发闭环·保底联动：显式置 resolved 时自动回执全部未闭环派发（dispatchStatus→done + doneAt + receipt='resolved'）。
      // 这是语义闭环的必然可行通道（agent 完成派发任务后 note_manage update resolved）；事件回执见 dispatch-loop 标记块
      let dispatchClosed = 0
      if (status === 'resolved') dispatchClosed = _closeOpenDispatches(note, 'resolved')
      note.updatedAt = new Date().toISOString()
      // 兜底补全：约定笔记 workspace 为空（agents 未就绪期创建的存量）时按来源会话推导填入，
      // 否则“本工作区”注入范围在严格匹配下永不命中
      if (!note.workspace && note.sessionId) {
        try { note.workspace = await _wsOfSession(note.sessionId) } catch (e) {}
      }
      await persistNote(note)
      const r = { id, kind: note.kind, status: note.status, dispatchClosed: dispatchClosed }
      if (injectForcedOff) r.injectForcedOff = true   // 日志隐身硬闸命中告知（kind=log 强制 inject=false）
      return r
    }

    // 快速记录队列：串行化避免读-改-写竞态导致内容丢失
    // 合并策略：同 session 且上一条速记在 10 分钟内更新过才合并，否则新建（避免过度合并）
    // 主题分类异步执行：先落盘返回，分类完成后回填主题与标题，不阻塞交互
    const MERGE_WINDOW_MS = 10 * 60 * 1000
    let quickChain = Promise.resolve()
    function _quickCapture(text, sessionId, cwd, kind) {
      const run = quickChain.then(() => _quickCaptureInner(text, sessionId, cwd, kind))
      quickChain = run.then((r) => {
        if (!r || !r.id) return
        perfStats.classify++
        const ct0 = Date.now()
        return classifyTopic(text).then(async (topic) => {
          perfStats.classifyMs += Date.now() - ct0
          try {
            const newTitle = r.merged ? undefined : buildQuickTitle({ sessionId: r.sid, cwd: r.cwd }, topic)
            await _update(r.id, newTitle, undefined, undefined, topic)
          } catch (e) {}
        }).catch(() => {})
      }, () => {})
      return run
    }
    async function _quickCaptureInner(text, sessionId, cwd, kind) {
      const now = new Date().toISOString()
      const sc = sessCtx()
      const sid = sessionId || sc.sessionId
      const cw = cwd || sc.cwd
      // 敏感模式自动识别：速记是即发即忘场景（用户不会回头补标），命中直接落 sensitive=true（注入时自动脱敏）
      const sens = suggestSensitive(text)
      if (sid) {
        const all = await _list()
        const existing = all.find(n => (n.tags || []).indexOf('quick') >= 0 && n.sessionId === sid)
        const fresh = existing && existing.updatedAt && (Date.now() - new Date(existing.updatedAt).getTime()) < MERGE_WINDOW_MS
        if (existing && fresh) {
          const stamp = '## ' + now.slice(0, 10) + ' ' + now.slice(11, 16) + '\n\n'
          const newBody = String(existing.body || '').trim() + '\n\n' + stamp + text + '\n'
          // 正文合并 + 敏感继承（sensitive 是 _update 第 13 位参数；命中敏感模式时把原速记升级为敏感笔记）
          await _update(existing.id, undefined, newBody, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sens ? true : undefined)
          return { id: existing.id, topic: existing.topic, title: existing.title, kind: existing.kind, merged: true, sid: sid, cwd: cw, sensitiveSuggested: sens }
        }
      }
      const id = genId()
      const title = buildQuickTitle({ sessionId: sid, cwd: cw }, '速记')
      const note = {
        id, title: title, topic: '分类中',
        workspace: basename(cw),
        tags: ['quick'],
        kind: kind || 'note',
        status: 'active',
        sensitive: sens,
        createdAt: now, updatedAt: now,
        sessionId: sid, cwd: cw,
        mergedFrom: [], archivedAt: '',
        deleted: false,
        body: text + '\n'
      }
      await persistNote(note)
      return { id, topic: '分类中', title: title, kind: note.kind, merged: false, sid: sid, cwd: cw, sensitiveSuggested: sens }
    }

    // T3 指令式快速记录：从用户备注提取元数据（tags/titleHint/kind/inject）
    // 复用 classifyTopic 的 llm.stream + resolveLlmSelection 模式（设置模型优先，否则跟随会话），temperature 0
    // 解析容错：失败/不规范 → 返回 null（调用方按无备注处理，等价 notes-quick）
    // 关键约束：绝不改写原文——LLM 只输出结构化 JSON，原文由调用方落盘
    async function extractInstruction(text, note) {
      if (!llm) return null
      try {
        await loadSettings()
        const sel = resolveLlmSelection()   // 设置里的 LLM 优先；未设置 → 跟随会话（adm.currentSelection）
        if (!sel || !sel.provider || !sel.model) return null
        const prompt = '给定选区原文和用户备注，从备注中提取笔记元数据。只输出严格 JSON，没提到的字段留空/默认，绝不改写原文。\n' +
          '字段说明：\n' +
          '- tags: 字符串数组，打标签（如备注"标记为重要 bug" → ["重要","bug"]）\n' +
          '- titleHint: 字符串，标题/主题引导（如"这是关于登录的" → "登录"）\n' +
          '- kind: 字符串，类型枚举 note/decision/todo/link/quote（如"这是待办" → todo）\n' +
          '- inject: 布尔，是否注入到系统提示上下文（如"记住这个" → true）\n' +
          '- injectRole: 字符串，注入角色枚举 convention/reference（仅 inject=true 时有意义）：convention=须遵守的约定，reference=与当前任务相关时按需取用的资料；按 kind 推断建议 decision/todo → convention、note/link/quote → reference；缺省 convention\n\n' +
          '选区原文：\n' + text + '\n\n用户备注：\n' + note + '\n\n只输出 JSON：{"tags":[],"titleHint":"","kind":"note","inject":false,"injectRole":"convention"}'
        // 计量包装（llm-usage 块）：指令提取属分类家族，feature='classify'
        const metered = await streamMetered('classify', {
          provider: sel.provider,
          model: sel.model,
          messages: [{
            id: 'instruct-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' }
          }],
          system: '你是一个笔记元数据提取器。从用户备注中提取结构化字段，输出严格 JSON，绝不改写原文。',
          temperature: 0
        })
        const out = metered.text
        // 容错解析：提取第一个 {...} 块；失败返回 null
        const m = out.match(/\{[\s\S]*\}/)
        if (!m) return null
        const obj = JSON.parse(m[0])
        const tags = Array.isArray(obj.tags) ? obj.tags.map(function (s) { return String(s).trim() }).filter(Boolean) : []
        const titleHint = obj.titleHint ? String(obj.titleHint).trim() : ''
        const kindRaw = String(obj.kind || '').trim().toLowerCase()
        const kind = KINDS.indexOf(kindRaw) >= 0 ? kindRaw : 'note'
        const inject = obj.inject === true
        const roleRaw = String(obj.injectRole || '').trim().toLowerCase()
        const injectRole = roleRaw === 'reference' ? 'reference' : (roleRaw === 'convention' ? 'convention' : '')
        return { tags: tags, titleHint: titleHint, kind: kind, inject: inject, injectRole: injectRole }
      } catch (e) {
        console.error('notes: extractInstruction failed', e)
        return null
      }
    }

    // T3 指令式快速记录：选区原文 + LLM 提取元数据 → 新建独立笔记
    // 备注为空 / LLM 不可用 / 解析失败 → 等价 notes-quick（走合并逻辑，原文不变）
    // 备注非空且 LLM 成功 → 新建独立笔记（不走合并窗口），body=选区原文（不变），应用提取的元数据
    async function _quickInstruct(text, note, sessionId, cwd) {
      const noteTrim = String(note || '').trim()
      // 备注为空 → 走现有逻辑（合并窗口，行为不变）
      if (!noteTrim) {
        const r = await _quickCapture(text, sessionId, cwd, 'quote')
        return { ok: true, id: r.id, applied: { tags: [], kind: r.kind || 'note', inject: false, injectRole: 'convention' }, merged: r.merged, sensitiveSuggested: r.sensitiveSuggested === true }
      }
      // 备注非空 → LLM 提取元数据
      const meta = await extractInstruction(text, noteTrim)
      if (!meta) {
        // LLM 不可用 / 解析失败 → 等价 notes-quick（合并逻辑，原文不变）
        const r = await _quickCapture(text, sessionId, cwd, 'quote')
        return { ok: true, id: r.id, applied: { tags: [], kind: r.kind || 'note', inject: false, injectRole: 'convention' }, merged: r.merged, fallback: true, sensitiveSuggested: r.sensitiveSuggested === true }
      }
      // 新建独立笔记（不走合并窗口），body=选区原文（不变）
      const now = new Date().toISOString()
      const sc = sessCtx()
      const sid = sessionId || sc.sessionId
      const cw = cwd || sc.cwd
      const extraTags = meta.tags.filter(function (t) { return t !== 'quick' })
      const tags = ['quick'].concat(extraTags)
      const topic = meta.titleHint || '速记'
      const title = buildQuickTitle({ sessionId: sid, cwd: cw }, topic)
      const id = genId()
      // 敏感模式自动识别（与 notes-quick 同口径：命中直接落 sensitive=true）
      const sens = suggestSensitive(text)
      const noteObj = {
        id: id, title: title, topic: topic, workspace: basename(cw),
        tags: tags, kind: meta.kind, status: 'active', inject: meta.inject, injectTo: [],
        // injectEver 粘性：指令式速记 LLM 判定 inject=true 时同步拉起（与 _create 同口径）
        injectEver: meta.inject === true,
        // 注入角色：LLM 显式输出优先，缺省 convention（与 noteFromParsed 回退口径一致）
        injectRole: meta.injectRole || 'convention',
        sensitive: sens,
        createdAt: now, updatedAt: now, sessionId: sid, cwd: cw,
        mergedFrom: [], archivedAt: '', deleted: false,
        body: text + '\n'
      }
      await persistNote(noteObj)
      // 无 titleHint 时异步分类回填主题/标题（不阻塞交互，复用 classifyTopic 模式）
      if (!meta.titleHint) {
        classifyTopic(text).then(async function (topic2) {
          try {
            const newTitle = buildQuickTitle({ sessionId: sid, cwd: cw }, topic2)
            await _update(id, newTitle, undefined, undefined, topic2)
          } catch (e) {}
        }).catch(function () {})
      }
      return { ok: true, id: id, applied: { tags: meta.tags, kind: meta.kind, inject: meta.inject, injectRole: meta.injectRole || 'convention', titleHint: meta.titleHint }, sensitiveSuggested: sens }
    }

