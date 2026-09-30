// ---- 会话元数据缓存（0.1.7 修复：notes-active-sessions ~128s 超时、派发对话框空白）----
// 根因：0.1.7 的 sessionQuery.readTitleSnapshots 对非 live 会话走 corpus.inspectPersisted
// 全量日志加载解析（每会话 ~10s，SessionCorpus 缓存容量仅 5，12 会话中 9 个非 live ≈ 128s），
// GUI fetch 等不到即渲染空列表。
// 策略：sid 粒度缓存（模块级 Map，随引导壳生命周期存活）——cwd/origin/createdAt 是不变字段长期有效；
// title 受 TTL（10min）约束：过期不删旧值（先用旧标题兜底展示、不闪烁），后台重读刷新。
// live 会话不读缓存：agents.get + sessionTitle.get 走内存，始终实时。
const SESS_META_TTL = 10 * 60 * 1000
const sessMetaCache = new Map()  // sid → { title, cwd, origin, createdAt, ts }
let sessMetaFillRunning = false  // 后台批量读串行化：避免对话框反复打开时叠加读盘

return {
  inject: ['fs', 'sandboxPolicy'],
  apply(ctx) {
    const fs = ctx.fs
    const sp = ctx.sandboxPolicy
    const agents = ctx.get('agents')
    const llm = ctx.get('llm')
    const adm = ctx.get('agentDefaultModel')
    const systemPrompt = ctx.get('systemPrompt')
    const sessionPersistence = ctx.get('sessionPersistence')
    const workspaceRegistry = ctx.get('workspaceRegistry')
    const sessionTitle = ctx.get('sessionTitle')
    const sessionQuery = ctx.get('sessionQuery')
    // 插件目录由 host 引导壳通过 new Function('harness','pluginDir',...) 注入；缺失时回退（单测/直跑场景）
    const PLUGIN_DIR = typeof pluginDir !== 'undefined' && pluginDir ? pluginDir : 'D:\\deepseek-work\\dsh-notes-plugin'
    const NOTES_DIR = PLUGIN_DIR + '\\notes'
    const CSS_PATH = PLUGIN_DIR + '\\styles.css'
    const disposers = []

    function genId() {
      return 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    function basename(p) {
      if (!p) return ''
      const s = String(p).replace(/[\\/]+$/, '')
      const parts = s.split(/[\\/]/)
      return parts[parts.length - 1] || s
    }

    function shortSid(sid) { return sid ? String(sid).replace(/^session-/, '').slice(0, 8) : '' }

    // dispatches 派发历史：对象数组，front-matter 里以 JSON 字符串存储
    function parseDispatches(s) {
      if (!s) return []
      try { const d = JSON.parse(s); return Array.isArray(d) ? d : [] } catch (e) { return [] }
    }

    function escYaml(s) {
      s = String(s == null ? '' : s)
      if (/[":#\[\]{}&,*?|<>=!%@\n]/.test(s)) {
        return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'
      }
      return s
    }

    function buildFM(m) {
      return '---\n' +
        'id: ' + escYaml(m.id) + '\n' +
        'title: ' + escYaml(m.title) + '\n' +
        'topic: ' + escYaml(m.topic || '') + '\n' +
        'workspace: ' + escYaml(m.workspace || '') + '\n' +
        'folder: ' + escYaml(m.folder || '') + '\n' +
        'tags: ' + (m.tags || []).map(escYaml).join(', ') + '\n' +
        'kind: ' + escYaml(m.kind || 'note') + '\n' +
        'status: ' + escYaml(m.status || 'active') + '\n' +
        'inject: ' + escYaml(m.inject ? 'true' : 'false') + '\n' +
        // injectRole 仅 inject=true 时落盘（非注入笔记不带角色字段，避免脏数据）
        (m.inject ? 'injectRole: ' + escYaml(m.injectRole === 'reference' ? 'reference' : 'convention') + '\n' : '') +
        'injectTo: ' + (m.injectTo || []).map(escYaml).join(', ') + '\n' +
        'recall: ' + escYaml(m.recall === false ? 'false' : 'true') + '\n' +
        'createdAt: ' + escYaml(m.createdAt) + '\n' +
        'updatedAt: ' + escYaml(m.updatedAt) + '\n' +
        'sessionId: ' + escYaml(m.sessionId) + '\n' +
        'cwd: ' + escYaml(m.cwd) + '\n' +
        'mergedFrom: ' + (m.mergedFrom || []).map(escYaml).join(', ') + '\n' +
        'dispatches: ' + escYaml(JSON.stringify(m.dispatches || [])) + '\n' +
        'archivedAt: ' + escYaml(m.archivedAt || '') + '\n' +
        'deleted: ' + escYaml(m.deleted || 'false') + '\n' +
        '---\n\n'
    }

    function parseFM(content) {
      const meta = {}
      let body = content
      const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
      if (m) {
        body = m[2] || ''
        for (const line of m[1].split(/\r?\n/)) {
          const idx = line.indexOf(':')
          if (idx < 0) continue
          const key = line.slice(0, idx).trim()
          let val = line.slice(idx + 1).trim()
          if (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') {
            val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
          }
          meta[key] = (key === 'tags' || key === 'mergedFrom' || key === 'injectTo')
            ? (val ? val.split(',').map(s => s.trim()).filter(Boolean) : [])
            : val
        }
      }
      return { meta, body }
    }

    function sessCtx() {
      const sc = { sessionId: '', cwd: '' }
      try {
        if (agents) {
          const a = agents.currentInitiator()
          if (a) {
            sc.sessionId = a.sessionId || (a.session && a.session.id) || ''
            sc.cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          }
        }
      } catch (e) {}
      return sc
    }

    function getPolicy() {
      try {
        if (sp && sp.resolve) {
          return sp.resolve({ mode: 'danger-full-access' })
        }
      } catch (e) {}
      return undefined
    }

    // 三段式标题：工作区 · 会话 · 主题
    function buildQuickTitle(sc, topic) {
      const ws = basename(sc.cwd)
      const sess = sc.sessionId ? sc.sessionId.replace(/^session-/, '').slice(0, 8) : ''
      return [ws, sess, topic].filter(Boolean).join(' · ') || topic || '未分类'
    }

    // ---- 设置持久化（SETTINGS_PATH）：内存缓存 + 启动加载；文件坏/不存在 → {}（容错）----
    // 通用结构：设置项是 settingsCache 的顶层键（llm 选配 + catalogEnabled 目录索引总开关），client 经 notes-settings-get/set 读写。
    // .json 后缀不进笔记列表（_list 只认 .md），settings.json 落在同目录天然不污染列表。
    const SETTINGS_PATH = NOTES_DIR + '\\settings.json'
    let settingsCache = {}
    let settingsLoadPromise = null
    function loadSettings() {
      if (!settingsLoadPromise) {
        settingsLoadPromise = (async () => {
          try {
            const p = await fs.resolve(SETTINGS_PATH)
            const c = await fs.readText(p)
            const obj = JSON.parse(c)
            settingsCache = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {}
          } catch (e) { /* 文件不存在/损坏 → 空设置：默认行为（跟随会话 + 目录开）不变 */ }
          return settingsCache
        })()
      }
      return settingsLoadPromise
    }
    async function saveSettings() {
      const p = await fs.resolve(SETTINGS_PATH)
      await fs.writeText(p, JSON.stringify(settingsCache, null, 2), undefined, undefined, getPolicy())
    }
    // LLM 选择：settings.llm（provider+model 齐备）优先；否则回退跟随会话（adm.currentSelection）
    function resolveLlmSelection() {
      const s = settingsCache && settingsCache.llm
      if (s && typeof s.provider === 'string' && s.provider && typeof s.model === 'string' && s.model) {
        return { provider: s.provider, model: s.model }
      }
      if (!adm) return null
      try { return adm.currentSelection() } catch (e) { return null }
    }
    // 可用模型列表（设置卡片下拉数据源）：探 llm 服务目录；探不到返回 []（client 退化手输 provider/model）
    async function listAvailableModels() {
      const models = []
      if (!llm) return models
      const seen = {}
      function push(provider, model, label) {
        if (!provider || !model) return
        const key = provider + '/' + model
        if (seen[key]) return
        seen[key] = true
        models.push({ provider: provider, model: model, label: label || key })
      }
      // 首选标准目录：llm.listProviders() → llm.listModels(provider)
      let providers = []
      try { if (typeof llm.listProviders === 'function') providers = (await llm.listProviders()) || [] } catch (e) {}
      if (!providers.length && Array.isArray(llm.providers)) providers = llm.providers
      for (const p of providers) {
        const pid = p && (typeof p === 'string' ? p : (p.id || p.provider))
        if (!pid) continue
        try {
          if (typeof llm.listModels === 'function') {
            const ms = (await llm.listModels(pid)) || []
            for (const m of ms) {
              const mid = m && (typeof m === 'string' ? m : (m.id || m.model))
              if (mid) push(pid, mid, (p && p.name ? p.name : pid) + ' / ' + (m && m.name ? m.name : mid))
            }
          }
        } catch (e) {}
      }
      // 退化探针：llm.list() / llm.listModels() 无参全量目录（部署差异兜底）
      if (!models.length) {
        for (const fnName of ['list', 'listModels']) {
          try {
            if (typeof llm[fnName] !== 'function') continue
            const all = (await llm[fnName]()) || []
            for (const m of all) { if (m && m.provider && (m.model || m.id)) push(m.provider, m.model || m.id) }
            if (models.length) break
          } catch (e) {}
        }
      }
      return models
    }

    async function classifyTopic(text) {
      if (!llm) return '未分类'
      try {
        await loadSettings()
        const sel = resolveLlmSelection()   // 设置里的 LLM 优先；未设置 → 跟随会话（adm.currentSelection）
        if (!sel || !sel.provider || !sel.model) return '未分类'
        const preset = ['需求', '设计', '开发', '调试', '运维', '调研', '其他']
        const prompt = '你是一个笔记主题分类器。预设主题：' + preset.join('、') + '。请优先从预设主题中选择最匹配的一个；如果内容明显不属于任何预设主题，可输出一个新的简短主题（2-6个汉字）。只输出主题名本身，不要解释、标点或换行：\n\n' + text
        let out = ''
        for await (const chunk of llm.stream({
          provider: sel.provider,
          model: sel.model,
          messages: [{
            id: 'topic-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            role: 'user',
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'user' }
          }],
          system: '你是一个笔记主题分类器，把用户内容归纳成极简主题。',
          temperature: 0
        })) {
          if (chunk && chunk.type === 'text-delta') out += chunk.text
          if (chunk && chunk.type === 'finish') break
        }
        const topic = out.trim().replace(/^["'「」『』]+|["'「」『』]+$/g, '')
        return topic || '未分类'
      } catch (e) {
        console.error('notes: classifyTopic failed', e)
        return '未分类'
      }
    }

    // ---- 缓存层：解析结果按 id 常驻内存；本插件所有写入同步缓存，外部新增文件在 list 时懒加载 ----
    const KINDS = ['note', 'decision', 'todo', 'link', 'quote']
    const STATUSES = ['active', 'pinned', 'resolved', 'superseded']
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
        // recall：目录索引准入字段，缺省 true（旧文件无 recall 字段 → 进目录）；显式 false 逐条关闭（与 inject 正交）
        recall: p.meta.recall !== 'false',
        createdAt: p.meta.createdAt || '',
        updatedAt: p.meta.updatedAt || '',
        sessionId: p.meta.sessionId || '',
        cwd: p.meta.cwd || '',
        mergedFrom: p.meta.mergedFrom || [],
        dispatches: parseDispatches(p.meta.dispatches),
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
      cache.set(note.id, note)
      return note
    }

    async function loadNote(id) {
      const hit = cache.get(id)
      if (hit) { perfStats.cacheReads++; return hit }
      return readNoteFile(id)
    }

    async function persistNote(n) {
      perfStats.diskWrites++
      const meta = {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags || [], kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, mergedFrom: n.mergedFrom || [],
        dispatches: n.dispatches || [],
        archivedAt: n.archivedAt || '', deleted: n.deleted ? 'true' : 'false'
      }
      const content = buildFM(meta) + (n.body || '')
      const ft = await fs.resolve(NOTES_DIR + '\\' + n.id + '.md')
      await fs.writeText(ft, content, undefined, undefined, getPolicy())
      cache.set(n.id, Object.assign({}, n))
    }

    // 列表/RPC 瘦身：不带 body，正文编辑走 notes-get 按需加载
    function slim(n) {
      return {
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace, folder: n.folder || '',
        tags: n.tags, kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention', recall: n.recall !== false,
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, mergedFrom: n.mergedFrom,
        dispatches: n.dispatches || [],
        archivedAt: n.archivedAt, preview: String(n.body || '').slice(0, 200)
      }
    }

    // ---- 虚拟文件夹：notes/folders.json 登记清单 [{id,name,order}]；笔记 front-matter 的 folder 字段存文件夹 id（缺省 ''=未分类，向后兼容） ----
    const FOLDERS_PATH = NOTES_DIR + '\\folders.json'

    function genFolderId() {
      return 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    // 读文件夹清单：文件缺失/JSON 损坏/结构非法一律兜底为空数组（不抛错，笔记主流程不受 folders.json 影响）
    async function loadFolders() {
      try {
        const ft = await fs.resolve(FOLDERS_PATH)
        const arr = JSON.parse(await fs.readText(ft))
        if (!Array.isArray(arr)) return []
        return arr.filter(f => f && f.id).map(f => ({ id: String(f.id), name: String(f.name || ''), order: typeof f.order === 'number' ? f.order : 0 }))
      } catch (e) { return [] }
    }

    async function saveFolders(list) {
      const ft = await fs.resolve(FOLDERS_PATH)
      await fs.writeText(ft, JSON.stringify(list, null, 2), undefined, undefined, getPolicy())
    }

    // 有效文件夹：folder 引用必须命中清单（清单损坏/外部改乱的笔记按未分类对待，保证计数与过滤口径一致）
    function effectiveFolder(note, folders) {
      const f = (note && note.folder) || ''
      if (!f) return ''
      return folders.some(x => x.id === f) ? f : ''
    }

    // 解析文件夹入参（工具层友好）：id 精确命中优先，其次按名称精确命中；'' = 未分类；找不到返回 null
    async function resolveFolderRef(ref) {
      const r = String(ref == null ? '' : ref).trim()
      if (!r) return { id: '', name: '' }
      const folders = await loadFolders()
      const byId = folders.find(x => x.id === r)
      if (byId) return { id: byId.id, name: byId.name }
      const byName = folders.find(x => x.name === r)
      if (byName) return { id: byName.id, name: byName.name }
      return null
    }

    // notes-folders RPC 核心：无参/op 缺省 = list（按 order 排序，含各文件夹计数 + unfiled 未分类计数）；op = create/rename/delete/reorder
    // 计数口径：deleted 笔记由 _list 排除不计；folder 指向清单外 id 的笔记计入 unfiled
    async function _folders(args) {
      const a = args || {}
      const op = a.op || 'list'
      if (op === 'list') {
        const folders = await loadFolders()
        const all = await _list()
        const counts = {}
        let unfiled = 0
        for (const n of all) {
          const f = effectiveFolder(n, folders)
          if (!f) unfiled++
          else counts[f] = (counts[f] || 0) + 1
        }
        const list = folders.slice().sort((x, y) => x.order - y.order)
          .map(f => ({ id: f.id, name: f.name, order: f.order, count: counts[f.id] || 0 }))
        return { folders: list, unfiled: unfiled }
      }
      if (op === 'create') {
        const name = String(a.name || '').trim()
        if (!name) return { error: 'notes-folders.create 需要 name' }
        const folders = await loadFolders()
        const maxOrder = folders.reduce((m, f) => Math.max(m, f.order), -1)
        const folder = { id: genFolderId(), name: name, order: maxOrder + 1 }
        folders.push(folder)
        await saveFolders(folders)
        return { ok: true, folder: folder }
      }
      if (op === 'rename') {
        if (!a.id) return { error: 'notes-folders.rename 需要 id' }
        const name = String(a.name || '').trim()
        if (!name) return { error: 'notes-folders.rename 需要 name' }
        const folders = await loadFolders()
        const f = folders.find(x => x.id === a.id)
        if (!f) return { error: '文件夹不存在: ' + a.id }
        f.name = name
        await saveFolders(folders)
        return { ok: true, id: a.id, name: name }
      }
      if (op === 'delete') {
        if (!a.id) return { error: 'notes-folders.delete 需要 id' }
        const folders = await loadFolders()
        const idx = folders.findIndex(x => x.id === a.id)
        if (idx < 0) return { error: '文件夹不存在: ' + a.id }
        folders.splice(idx, 1)
        await saveFolders(folders)
        // 其下笔记回退未分类：主动清空 folder 字段（保持数据一致，计数/过滤无需额外兜底）
        const all = await _list()
        let reset = 0
        for (const n of all) {
          if ((n.folder || '') === a.id) {
            await _update(n.id, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, '')
            reset++
          }
        }
        return { ok: true, id: a.id, reset: reset }
      }
      if (op === 'reorder') {
        if (!Array.isArray(a.ids)) return { error: 'notes-folders.reorder 需要 ids 数组' }
        const ids = a.ids.map(String)
        const rank = {}
        ids.forEach((id, i) => { rank[id] = i })
        const folders = await loadFolders()
        // 入列的按 ids 顺序重排；未入列的保持原相对顺序追加尾部；最终 order 归一化为 0..n-1
        const inList = folders.filter(f => rank[f.id] !== undefined).sort((x, y) => rank[x.id] - rank[y.id])
        const outList = folders.filter(f => rank[f.id] === undefined).sort((x, y) => x.order - y.order)
        const merged = inList.concat(outList)
        merged.forEach((f, i) => { f.order = i })
        await saveFolders(merged)
        return { ok: true, folders: merged.map(f => ({ id: f.id, name: f.name, order: f.order })) }
      }
      return { error: 'notes-folders: 未知 op：' + String(op) + '（期望 list/create/rename/delete/reorder）' }
    }

    async function _create(title, body, tags, topic, extra) {
      const id = genId()
      const now = new Date().toISOString()
      const sc = sessCtx()
      const ex = extra || {}
      const note = {
        id, title: title || 'Untitled', topic: topic || '未分类',
        workspace: ex.workspace || basename(sc.cwd),
        folder: ex.folder || '',
        tags: tags || [],
        kind: ex.kind || 'note',
        status: ex.status || 'active',
        inject: ex.inject === true,
        injectTo: ex.injectTo || [],
        injectRole: ex.injectRole === 'reference' ? 'reference' : 'convention',
        recall: ex.recall !== false,
        createdAt: ex.createdAt || now, updatedAt: ex.updatedAt || now,
        sessionId: ex.sessionId !== undefined ? ex.sessionId : sc.sessionId,
        cwd: ex.cwd || sc.cwd,
        mergedFrom: ex.mergedFrom || [],
        dispatches: ex.dispatches || [],
        archivedAt: ex.archivedAt || '',
        deleted: false,
        body: body || ''
      }
      await persistNote(note)
      return { id, topic: note.topic, title: note.title, kind: note.kind, status: note.status }
    }

    async function _list(tag, kind, folder) {
      try {
        const dirTarget = await fs.resolve(NOTES_DIR)
        const info = await fs.stat(dirTarget)
        if (!info) return []
        // 仅在按文件夹过滤时读清单（无过滤调用保持零额外磁盘读）
        const folders = folder !== undefined ? await loadFolders() : null
        const entries = await fs.listDir(dirTarget)
        const notes = []
        for (const entry of entries) {
          if (!entry.name || !entry.name.endsWith('.md')) continue
          const id = entry.name.replace(/\.md$/, '')
          try {
            const note = await loadNote(id)
            if (note.deleted) continue
            if (tag && (note.tags || []).indexOf(tag) < 0) continue
            if (kind && note.kind !== kind) continue
            if (folder !== undefined && effectiveFolder(note, folders) !== folder) continue
            notes.push(note)
          } catch (e) { console.error('notes: read failed', entry.name, e) }
        }
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
      if (note.deleted) throw new Error('Note has been deleted')
      return Object.assign({}, note)
    }

    async function _update(id, title, body, tags, topic, kind, status, inject, injectTo, folder, recall, injectRole) {
      const note = Object.assign({}, await loadNote(id))
      if (note.deleted) throw new Error('Note has been deleted')
      if (title !== undefined) note.title = title
      if (topic !== undefined) note.topic = topic
      if (tags !== undefined) note.tags = tags
      if (kind !== undefined) note.kind = kind
      if (status !== undefined) note.status = status
      if (inject !== undefined) note.inject = inject === true
      if (injectTo !== undefined) note.injectTo = injectTo
      if (folder !== undefined) note.folder = folder
      if (recall !== undefined) note.recall = recall !== false
      if (injectRole !== undefined) note.injectRole = injectRole === 'reference' ? 'reference' : 'convention'
      if (body !== undefined) note.body = body
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { id, kind: note.kind, status: note.status }
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
      if (sid) {
        const all = await _list()
        const existing = all.find(n => (n.tags || []).indexOf('quick') >= 0 && n.sessionId === sid)
        const fresh = existing && existing.updatedAt && (Date.now() - new Date(existing.updatedAt).getTime()) < MERGE_WINDOW_MS
        if (existing && fresh) {
          const stamp = '## ' + now.slice(0, 10) + ' ' + now.slice(11, 16) + '\n\n'
          const newBody = String(existing.body || '').trim() + '\n\n' + stamp + text + '\n'
          await _update(existing.id, undefined, newBody, undefined, undefined)
          return { id: existing.id, topic: existing.topic, title: existing.title, kind: existing.kind, merged: true, sid: sid, cwd: cw }
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
        createdAt: now, updatedAt: now,
        sessionId: sid, cwd: cw,
        mergedFrom: [], archivedAt: '',
        deleted: false,
        body: text + '\n'
      }
      await persistNote(note)
      return { id, topic: '分类中', title: title, kind: note.kind, merged: false, sid: sid, cwd: cw }
    }

    // T3 指令式快速记录：从用户备注提取元数据（tags/titleHint/kind/inject）
    // 复用 classifyTopic 的 llm.stream + adm.currentSelection 模式，temperature 0
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
        let out = ''
        for await (const chunk of llm.stream({
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
        })) {
          if (chunk && chunk.type === 'text-delta') out += chunk.text
          if (chunk && chunk.type === 'finish') break
        }
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
        return { ok: true, id: r.id, applied: { tags: [], kind: r.kind || 'note', inject: false, injectRole: 'convention' }, merged: r.merged }
      }
      // 备注非空 → LLM 提取元数据
      const meta = await extractInstruction(text, noteTrim)
      if (!meta) {
        // LLM 不可用 / 解析失败 → 等价 notes-quick（合并逻辑，原文不变）
        const r = await _quickCapture(text, sessionId, cwd, 'quote')
        return { ok: true, id: r.id, applied: { tags: [], kind: r.kind || 'note', inject: false, injectRole: 'convention' }, merged: r.merged, fallback: true }
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
      const noteObj = {
        id: id, title: title, topic: topic, workspace: basename(cw),
        tags: tags, kind: meta.kind, status: 'active', inject: meta.inject, injectTo: [],
        // 注入角色：LLM 显式输出优先，缺省 convention（与 noteFromParsed 回退口径一致）
        injectRole: meta.injectRole || 'convention',
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
      return { ok: true, id: id, applied: { tags: meta.tags, kind: meta.kind, inject: meta.inject, injectRole: meta.injectRole || 'convention', titleHint: meta.titleHint } }
    }

    async function _delete(id) {
      const note = Object.assign({}, await loadNote(id))
      note.deleted = true
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { id }
    }

    // 恢复软删除的笔记（撤销删除/撤销归档）
    async function _restore(id) {
      const note = Object.assign({}, await loadNote(id))
      note.deleted = false
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { id }
    }

    // 归档：快速记录按 session 合并；手动笔记按标签合并
    async function _archive() {
      const all = await _list()
      const groups = new Map()
      for (const n of all) {
        const isQuick = (n.tags || []).indexOf('quick') >= 0
        const key = isQuick
          ? 'quick:' + (n.sessionId || 'none')
          : 'manual:' + (n.tags || []).slice().sort().join(',')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(n)
      }
      let merged = 0
      const mergedIds = []
      for (const members of groups.values()) {
        if (members.length < 2) continue
        members.sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))
        const now = new Date().toISOString()
        const bodyParts = members.map(n => {
          const d = (n.updatedAt || n.createdAt || '').slice(0, 10)
          return '## ' + d + '\n\n' + String(n.body || '').trim() + '\n'
        })
        const body = bodyParts.join('\n')
        const topic = members[members.length - 1].topic || members[0].topic || '未分类'
        const last = members[members.length - 1]
        const title = last.topic || members[0].title || '归档'
        const r = await _create(title, body, members[0].tags || [], topic, {
          workspace: last.workspace || '',
          createdAt: members[0].createdAt || now,
          updatedAt: now,
          sessionId: last.sessionId || '',
          cwd: last.cwd || '',
          mergedFrom: members.map(n => n.id),
          archivedAt: now,
          folder: last.folder || ''
        })
        // 归档前先备份原笔记（.bak 后缀，_list 不会读到）
        for (const n of members) {
          try {
            const src = await fs.resolve(NOTES_DIR + '\\' + n.id + '.md')
            const dst = await fs.resolve(NOTES_DIR + '\\' + n.id + '.md.bak')
            const c = await fs.readText(src)
            await fs.writeText(dst, c, undefined, undefined, getPolicy())
          } catch (e) {}
        }
        for (const n of members) { await _delete(n.id) }
        merged++
        mergedIds.push(r.id)
      }
      return { merged, mergedIds }
    }

    // 派发目标会话列表（共享）：**未归档的主会话**（可继续对话，符合 DSH 交互逻辑），不只是当前 live。
    // sessionPersistence.list() 返回 SessionPersistenceSnapshot[]（{header, revision, ...}），id/origin/cwd/createdAt 都在 header 里；兼容旧版直接返回 SessionHeader
    function snapHeader(h) { return (h && h.header) ? h.header : h }
    // 后台批量读 title + header（origin/cwd/createdAt）：sessionQuery.readTitleSnapshots（live/persisted 都行，取代已删除的 inspect）。
    // 0.1.7 下该 API 对非 live 会话走全量日志解析（~10s/会话），故只在后台补缓存，绝不阻塞 RPC 返回。
    // 串行化：已有批量读在跑时本轮跳过（未命中会话保持 pending，client 轮询重拉时自然再触发）。
    async function _fillSessMeta(missIds) {
      if (!missIds || !missIds.length) return
      if (!sessionQuery || !sessionQuery.readTitleSnapshots) return
      if (sessMetaFillRunning) return
      sessMetaFillRunning = true
      try {
        const results = await sessionQuery.readTitleSnapshots(missIds)
        const ts = Date.now()
        for (const r of (results || [])) {
          if (r && r.status === 'fulfilled' && r.value) {
            const hd = r.value.session || {}
            sessMetaCache.set(r.sessionId, { title: (r.value.title && r.value.title.title) || '', cwd: hd.cwd || '', origin: hd.origin || '', createdAt: hd.createdAt, ts: ts })
          }
        }
      } catch (e) {} finally { sessMetaFillRunning = false }
    }
    // 与左侧会话列表一致：workspaceRegistry 各工作区 sessionIds 过滤子 agent + 已归档；名字 live 实时（sessionTitle.get 最新 fold），非 live 走元数据缓存。
    // 返回 { sessions, titlesPending?, pendingIds?, pendingSessions? }：
    //   sessions        —— 已 resolve 的条目（live 实时 + 缓存命中/兜底的非 live），立即可用
    //   titlesPending   —— 存在缓存未命中 / title 过期会话，已后台触发 _fillSessMeta（全命中时不带此字段）
    //   pendingIds      —— 后台读盘中的 sid 列表（未命中 + 过期刷新）
    //   pendingSessions —— 未命中会话的占位条目 [{id, short, workspace}]，client 渲染「短id · 标题加载中…」
    async function _activeSessions() {
      const empty = { sessions: [] }
      if (!workspaceRegistry || !workspaceRegistry.list) return empty
      // 已归档集合（workspaceRegistry.archivedSessionIds 是 registry 级归档集合）
      const archivedSet = {}
      try { const arch = workspaceRegistry.archivedSessionIds; if (Array.isArray(arch)) { for (const id of arch) archivedSet[id] = true } } catch (e) {}
      // 数据源：各工作区的 sessionIds（= 左侧会话列表显示的有效会话；已关闭/废弃的不在任何工作区里，自然排除）
      const entries = []
      const seen = {}
      const wl = workspaceRegistry.list() || []
      for (const w of wl) {
        const wsTitle = (w && w.title) || basename((w && w.path) || '')
        let sids = []
        try { sids = w.sessionIds || [] } catch (e) {}
        for (const sid of (sids || [])) {
          if (!sid || seen[sid]) continue
          seen[sid] = true
          if (archivedSet[sid]) continue  // 已归档跳过
          entries.push({ sid, wsTitle })
        }
      }
      if (entries.length === 0) return empty
      const nowTs = Date.now()
      const out = []
      const missIds = []        // 缓存未命中：必须读盘才知道 title/origin，先占位、后台补齐
      const refreshIds = []     // 缓存有但 title 过期：旧标题兜底展示，后台重读刷新
      const pendingSessions = []
      for (const e of entries) {
        const liveAgent = agents && agents.get ? agents.get(e.sid) : undefined
        const live = !!liveAgent
        if (live) {
          // live 会话始终实时：sessionTitle.get 走内存（最新 fold，含 fork 改名后的新名），近零成本
          let title = ''
          if (sessionTitle && sessionTitle.get && liveAgent.session) {
            try { const snap = sessionTitle.get(liveAgent.session); if (snap && snap.title) title = snap.title } catch (e2) {}
          }
          const hd = (liveAgent.session && liveAgent.session.header) || {}
          // 反哺缓存：live 转非 live 后标题即刻可用（origin 读不到就保留旧值，避免污染子 agent 过滤）
          const prev = sessMetaCache.get(e.sid) || {}
          sessMetaCache.set(e.sid, { title: title || prev.title || '', cwd: hd.cwd || prev.cwd || '', origin: hd.origin !== undefined ? hd.origin : prev.origin, createdAt: hd.createdAt || prev.createdAt, ts: nowTs })
          out.push({ id: e.sid, short: shortSid(e.sid), name: title || (e.wsTitle + ' · ' + shortSid(e.sid)), cwd: hd.cwd || prev.cwd || '', workspace: e.wsTitle, live: true, createdAt: hd.createdAt || prev.createdAt })
          continue
        }
        const c = sessMetaCache.get(e.sid)
        if (!c) {
          // 未命中：占位条目进 pendingSessions（client 显示「短id · 标题加载中…」），后台批量读盘补齐
          missIds.push(e.sid)
          pendingSessions.push({ id: e.sid, short: shortSid(e.sid), workspace: e.wsTitle })
          continue
        }
        if (c.origin === 'subagent') continue  // 排除一次性子 agent
        const fresh = (nowTs - (c.ts || 0)) < SESS_META_TTL
        if (!fresh) refreshIds.push(e.sid)     // title 过期：后台重读（空标题会话也可能后来补上了标题），本轮先用旧值兜底
        // 无标题且非 live 的会话视为已关闭/废弃（从没生成标题，也不在运行），不在派发/注入列表显示
        if (!c.title) continue
        out.push({ id: e.sid, short: shortSid(e.sid), name: c.title, cwd: c.cwd || '', workspace: e.wsTitle, live: false, createdAt: c.createdAt })
      }
      // 后台补齐/刷新：不阻塞首屏返回（0.1.7 下非 live 会话读盘 ~10s/个，同步等即复现 128s 空白）
      const bgIds = missIds.concat(refreshIds)
      if (bgIds.length) _fillSessMeta(bgIds)
      // 排序：live 在前，再按创建时间倒序
      out.sort((a, b) => { if (a.live !== b.live) return a.live ? -1 : 1; return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) })
      if (bgIds.length === 0) return { sessions: out }
      return { sessions: out, titlesPending: true, pendingIds: bgIds, pendingSessions: pendingSessions }
    }

    // 任务派发（共享）：主动注入上下文 + 触发对话——agent.send 一条消息到目标会话，
    // source 标记为 { kind:'plugin', form:'recall' }（todo 作为"召回的上下文"，区别于用户指令/系统提示拼接），
    // wakeup=true 保证触发该会话 agent 去获取并处理这条上下文（可见反应，不污染系统提示）。
    // opts: { sessionId, sessionName, workspace, mode('existing'|'new'), instruction }
    async function _dispatch(id, opts) {
      const o = opts || {}
      const note = await _get(id)
      if (note.deleted) return { error: '笔记已删除' }
      if (!o.sessionId) return { error: '缺少目标会话' }
      const target = agents && agents.get ? agents.get(o.sessionId) : undefined
      if (!target || typeof target.send !== 'function') return { error: '目标会话当前未打开，无法触发工作。请先打开它，或改用「新建会话」。', needOpen: true }
      const instruction = String(o.instruction || '').trim()
      const text = '【笔记插件 · 派发的待办上下文】\n\n【待办】' + (note.title || 'Untitled') + '\n' + String(note.body || note.title || '').trim() + (instruction ? '\n\n【派发方补充的要求】\n' + instruction : '') + '\n\n—— 以上是笔记插件派发给你的待办上下文（recall）。请获取此上下文并开始处理。'
      const msg = {
        id: 'note-dispatch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        role: 'user',
        content: [{ type: 'text', text: text }],
        // form:'recall'：标记为"召回的上下文"而非用户指令；agent loop 照常处理（wakeup 触发），模型据 form 理解为参考资料
        // v0.1.7 起会话日志为 format v4：kind:'plugin' 是已退役的 v3 包装写法，落盘会抛
        // SessionFormatError 并炸掉目标会话当前轮次；v3→v4 迁移映射为 plugin:dsh-notes，直接写迁移后形态
        source: { kind: 'plugin:dsh-notes', form: 'recall' }
      }
      target.send(msg, 'next-turn', true)
      // 派发历史：作为笔记属性记录（不改正文）
      const rec = {
        sessionId: o.sessionId,
        sessionName: o.sessionName || shortSid(o.sessionId),
        workspace: o.workspace || '',
        mode: o.mode || 'existing',
        instruction: instruction,
        at: new Date().toISOString(),
        done: false
      }
      note.dispatches = (note.dispatches || []).concat([rec])
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { ok: true, id: note.id, sessionId: o.sessionId, sessionName: rec.sessionName, dispatch: rec }
    }

    // 标记一条派发待办为完成（停止注入目标会话的系统提示）
    async function _dispatchDone(id, dispatchIndex) {
      const note = await _get(id)
      if (note.deleted) return { error: '笔记已删除' }
      const ds = note.dispatches || []
      const i = typeof dispatchIndex === 'number' ? dispatchIndex : -1
      if (i < 0 || i >= ds.length) return { error: '无效的派发记录索引' }
      ds[i] = Object.assign({}, ds[i], { done: true, doneAt: new Date().toISOString() })
      note.dispatches = ds
      note.updatedAt = new Date().toISOString()
      await persistNote(note)
      return { ok: true, id: note.id }
    }

    async function _search(query, tag, topic, kind, folder) {
      const all = await _list(undefined, undefined, folder)
      const q = query ? String(query).toLowerCase() : ''
      return all.filter(n => {
        if (tag && (n.tags || []).indexOf(tag) < 0) return false
        if (topic && n.topic !== topic) return false
        if (kind && n.kind !== kind) return false
        if (q) {
          const hay = ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ')).toLowerCase()
          if (hay.indexOf(q) < 0) return false
        }
        return true
      })
    }

    // ---- 导入/导出：全库目录快照（目录即格式，零新依赖；settings.json 与 *.md.bak 不进出）----
    // 时间戳目录后缀：yyyyMMdd-HHmmss（本地时间），导出/备份目录共用
    function tsStamp(d) {
      const p = (n) => String(n).padStart(2, '0')
      return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
    }

    // 列出目录直子级笔记文件（n-*.md；目录缺失/不可读 → []，不抛错）
    async function listNoteMd(dir) {
      try {
        const t = await fs.resolve(dir)
        const info = await fs.stat(t)
        if (!info) return []
        const entries = await fs.listDir(t)
        return (entries || []).map(e => e && e.name).filter(n => n && n.indexOf('n-') === 0 && /\.md$/i.test(n))
      } catch (e) { return [] }
    }

    // 读指定目录的 folders.json（导入预览/合并共用）：缺失/损坏/结构非法 → []（与 loadFolders 同一容错口径）
    async function readFoldersFile(dir) {
      try {
        const ft = await fs.resolve(dir + '\\folders.json')
        const arr = JSON.parse(await fs.readText(ft))
        if (!Array.isArray(arr)) return []
        return arr.filter(f => f && f.id).map(f => ({ id: String(f.id), name: String(f.name || ''), order: typeof f.order === 'number' ? f.order : 0 }))
      } catch (e) { return [] }
    }

    // 复制 NOTES_DIR 全部 n-*.md + folders.json 到目标目录（导出与导入前全量备份共用）；
    // writeText 原子写会递归创建父目录，目标目录不存在时随首个文件写入自动建好
    async function copyNotesDir(targetDir) {
      let copied = 0
      for (const name of await listNoteMd(NOTES_DIR)) {
        try {
          const c = await fs.readText(await fs.resolve(NOTES_DIR + '\\' + name))
          await fs.writeText(await fs.resolve(targetDir + '\\' + name), c, undefined, undefined, getPolicy())
          copied++
        } catch (e) { console.error('notes: copy failed', name, e) }
      }
      let foldersFile = false
      try {
        const c = await fs.readText(await fs.resolve(FOLDERS_PATH))
        await fs.writeText(await fs.resolve(targetDir + '\\folders.json'), c, undefined, undefined, getPolicy())
        foldersFile = true
      } catch (e) { /* folders.json 缺失/不可读 → 跳过（foldersFile=false） */ }
      return { copied, foldersFile }
    }

    // 扫描导入目录（只读不写）：n-*.md 逐条解析 front-matter 取 id（缺 id 按文件名兜底）+ folders.json；
    // 同 id 多文件取先扫描到的一份（目录快照正常一 id 一文件）；读失败的文件计入 unreadable
    async function scanImportDir(dir) {
      const notes = []
      const seen = {}
      let unreadable = 0
      for (const name of await listNoteMd(dir)) {
        let content = null
        try { content = await fs.readText(await fs.resolve(dir + '\\' + name)) } catch (e) { unreadable++; continue }
        const p = parseFM(content)
        const id = p.meta.id || name.replace(/\.md$/i, '')
        if (seen[id]) continue
        seen[id] = true
        notes.push({ id: id, title: p.meta.title || 'Untitled', deleted: p.meta.deleted === 'true', content: content })
      }
      return { notes: notes, folders: await readFoldersFile(dir), unreadable: unreadable }
    }

    // 读库内笔记原始文件内容（same/diff 比对用，raw 文本与导出快照逐字节同口径）；不存在/不可读 → null
    async function readLibraryRaw(id) {
      try { return await fs.readText(await fs.resolve(NOTES_DIR + '\\' + id + '.md')) } catch (e) { return null }
    }

    // 校验导入目录（预览/执行共用）：dir 归一化去尾部斜杠；不存在/不是目录 → error
    async function checkImportDir(dir) {
      const d = String(dir || '').trim().replace(/[\\/]+$/, '')
      if (!d) return { error: '需要 dir（导入目录）' }
      const info = await fs.stat(await fs.resolve(d))
      if (!info) return { error: '目录不存在：' + d }
      if (!(info.dir || info.type === 'directory')) return { error: '不是目录：' + d }
      return { dir: d }
    }

    // notes-export：NOTES_DIR 全库快照 → <dir>\dsh-notes-export-<ts>\（不打包不压缩，目录即格式；dir 不存在则随写入自建）
    async function _export(dir) {
      const d = String(dir || '').trim().replace(/[\\/]+$/, '')
      if (!d) return { error: 'notes-export 需要 dir（目标目录）' }
      const info = await fs.stat(await fs.resolve(d))
      if (info && !(info.dir || info.type === 'directory')) return { error: '目标路径不是目录：' + d }
      const target = d + '\\dsh-notes-export-' + tsStamp(new Date())
      const r = await copyNotesDir(target)
      return { exported: r.copied, foldersFile: r.foldersFile, target: target }
    }

    // notes-import-preview：与现有库比对分类 same（内容相同）/diff（同 id 内容不同）/added（库中不存在）；不写任何东西
    // detail 逐条标注 deleted（软删除笔记按原文件导入后仍隐藏）；folders 统计导入清单总数与新增数
    async function _importPreview(dir) {
      const chk = await checkImportDir(dir)
      if (chk.error) return { error: 'notes-import-preview ' + chk.error }
      const scan = await scanImportDir(chk.dir)
      const detail = []
      let same = 0, diff = 0, added = 0
      for (const n of scan.notes) {
        const cur = await readLibraryRaw(n.id)
        const status = cur === null ? 'added' : (cur === n.content ? 'same' : 'diff')
        if (status === 'same') same++; else if (status === 'diff') diff++; else added++
        detail.push({ id: n.id, title: n.title, status: status, deleted: n.deleted })
      }
      const known = {}
      for (const f of await loadFolders()) known[f.id] = true
      return {
        total: scan.notes.length, same: same, diff: diff, added: added, detail: detail,
        folders: { total: scan.folders.length, new: scan.folders.filter(f => !known[f.id]).length },
        unreadable: scan.unreadable
      }
    }

    // notes-import：执行导入（只增改不删）
    // 1) 任何改动前先把 NOTES_DIR 全量备份到 notes\notes-backup-<ts>\（含软删除笔记的全部 n-*.md + folders.json）
    // 2) added 原文件原样入库（deleted 导入后仍隐藏）；same 跳过；diff 默认跳过，overwrite=true 才覆盖
    // 3) folders.json 合并只增不删：清单外的文件夹 id 追加尾部（order 续排），已存在的不动
    async function _import(dir, overwrite) {
      const chk = await checkImportDir(dir)
      if (chk.error) return { error: 'notes-import ' + chk.error }
      const backupDir = NOTES_DIR + '\\notes-backup-' + tsStamp(new Date())
      await copyNotesDir(backupDir)
      const scan = await scanImportDir(chk.dir)
      let imported = 0, skippedSame = 0, skippedDiff = 0, overwritten = 0
      for (const n of scan.notes) {
        const cur = await readLibraryRaw(n.id)
        if (cur === n.content) { skippedSame++; continue }
        if (cur !== null && !overwrite) { skippedDiff++; continue }
        try {
          await fs.writeText(await fs.resolve(NOTES_DIR + '\\' + n.id + '.md'), n.content, undefined, undefined, getPolicy())
          // 同步内存缓存（约定/目录注入直接读 cache）：按导入内容重建解析结果
          const note = noteFromParsed(n.id, parseFM(n.content))
          cache.set(note.id, note)
          if (cur === null) imported++; else overwritten++
        } catch (e) { console.error('notes: import failed', n.id, e) }
      }
      // folders.json 合并：清单外的文件夹 id 追加到尾部（order 续排），已存在的不动
      let foldersMerged = 0
      if (scan.folders.length) {
        const curFolders = await loadFolders()
        const known = {}
        for (const f of curFolders) known[f.id] = true
        let maxOrder = curFolders.reduce((m, f) => Math.max(m, f.order), -1)
        for (const f of scan.folders.slice().sort((x, y) => x.order - y.order)) {
          if (known[f.id]) continue
          maxOrder++
          curFolders.push({ id: f.id, name: f.name, order: maxOrder })
          foldersMerged++
        }
        if (foldersMerged) await saveFolders(curFolders)
      }
      return { imported: imported, skippedSame: skippedSame, skippedDiff: skippedDiff, overwritten: overwritten, foldersMerged: foldersMerged, backupDir: backupDir, unreadable: scan.unreadable }
    }

    // 约定命中判定（约定注入 conventionText 与目录去重 catalogText 共用）：
    // 注入范围 injectTo 是多选数组：
    //   []（空）        → 默认当前工作区（向后兼容旧数据 injectTo=''）
    //   含 'global'     → 全局注入（不限工作区）
    //   含 'workspace'  → 当前工作区
    //   含会话短 id     → 注入该会话（可多选多个会话）
    function conventionHit(n, ws, curSid) {
      const targets = n.injectTo || []
      if (targets.length === 0) {
        // 默认：当前工作区（workspace 为空视为全局约定）
        return !n.workspace || !ws || n.workspace === ws
      }
      for (const t of targets) {
        if (t === 'global') return true
        if (t === 'workspace') { if (!n.workspace || !ws || n.workspace === ws) return true }
        else if (t === curSid) return true
      }
      return false
    }

    // 上下文注入（双角色）：从常驻内存 cache 同步读取 inject=true 笔记，按 injectRole 分桶注入 agent 系统提示。
    // text 是同步函数（systemPrompt 契约），故不能 await _list()，必须读 cache。
    // 是否注入：inject 布尔字段（noteFromParsed 已对旧数据回退到 convention 标签）；
    // 注入范围由笔记的 injectTo 字段决定（命中语义见 conventionHit）。
    // 分桶：injectRole='convention' → 用户约定（须遵守）；'reference' → 参考资料（按需取用）；
    // 缺省/非法值已在 noteFromParsed 回退 convention（存量零迁移）；只命中单桶时只输出该桶标题。
    // 文案不再标注工作区归属与来源会话：大量笔记由 agent 快速记录产生，归属标注对注入方无意义。
    function conventionText() {
      const shortSid = (x) => x ? String(x).replace(/^session-/, '').slice(0, 8) : ''
      try {
        let cwd = ''
        let sid = ''
        const a = agents && agents.currentInitiator ? agents.currentInitiator() : undefined
        if (a) {
          cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          sid = a.sessionId || (a.session && a.session.id) || ''
        }
        const ws = basename(cwd)
        const curSid = shortSid(sid)
        const matches = []
        for (const n of cache.values()) {
          if (n.deleted) continue
          if (n.inject !== true) continue
          if (conventionHit(n, ws, curSid)) matches.push(n)
        }
        if (matches.length === 0) return ''
        matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        // 双角色分桶：约定与资料各自成段，标题换行收拢，正文行统一缩进两格保持在列表项内
        const conventions = []
        const references = []
        for (const n of matches) (n.injectRole === 'reference' ? references : conventions).push(n)
        const block = (n) => '- [' + n.id + '] ' + String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ') + '\n  ' + String(n.body || '').trim().replace(/\n/g, '\n  ')
        let full = '以下是注入的上下文笔记（与当前任务无关时忽略）：'
        if (conventions.length) full += '\n\n用户约定（须遵守）：\n\n' + conventions.map(block).join('\n\n')
        if (references.length) full += '\n\n参考资料（与当前任务相关时按需取用）：\n\n' + references.map(block).join('\n\n')
        return full.length > 4000 ? full.slice(0, 4000) + '\n\n（内容过长已截断）' : full
      } catch (e) { return '' }
    }

    // ---- 笔记目录索引注入（recall 通道，order 131）----
    // 全库一行一条目录 + 轻推提示：让 agent 规划时知道库里有什么，相关条目自主 note_get 拉全文、note_search 检索更多。
    // 准入：排除 deleted、status=resolved/superseded（已了结不进目录）、recall=false（front-matter 逐条关闭，缺省 true）；
    // 与约定注入去重：inject=true 且本会话命中（order 130 已注入全文）的笔记不再出现。
    // 排序：pinned 优先 → 当前工作区（workspace 字段 == 当前 cwd basename）→ updatedAt 降序；CATALOG_LIMIT 条封顶。
    // text 是同步函数（systemPrompt 契约）：读常驻 cache + settingsCache；总开关关闭/无条目/异常 → 返回 ''（不能返回 undefined）。
    const CATALOG_LIMIT = 40
    const CATALOG_KIND_LABELS = { note: '笔记', decision: '决策', todo: '待办', link: '链接', quote: '引用' }
    function catalogText() {
      try {
        if (settingsCache && settingsCache.catalogEnabled === false) return ''   // 面板总开关（settings.json，缺省开）
        let cwd = ''
        let sid = ''
        const a = agents && agents.currentInitiator ? agents.currentInitiator() : undefined
        if (a) {
          cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          sid = a.sessionId || (a.session && a.session.id) || ''
        }
        const ws = basename(cwd)
        const curSid = shortSid(sid)
        const pool = []
        for (const n of cache.values()) {
          if (n.deleted) continue
          if (n.status === 'resolved' || n.status === 'superseded') continue   // 已了结的笔记不进目录
          if (n.recall === false) continue                                     // recall=false 逐条关闭
          if (n.inject === true && conventionHit(n, ws, curSid)) continue      // 约定注入去重（全文已在 order 130）
          pool.push(n)
        }
        if (pool.length === 0) return ''
        pool.sort((x, y) => {
          const px = x.status === 'pinned' ? 1 : 0
          const py = y.status === 'pinned' ? 1 : 0
          if (px !== py) return py - px                                        // pinned 优先
          const wx = ws && x.workspace === ws ? 1 : 0
          const wy = ws && y.workspace === ws ? 1 : 0
          if (wx !== wy) return wy - wx                                        // 当前工作区优先
          return (y.updatedAt || '').localeCompare(x.updatedAt || '')          // 更新时间降序
        })
        const shown = pool.slice(0, CATALOG_LIMIT)
        const lines = shown.map(n => {
          const kl = CATALOG_KIND_LABELS[n.kind] || CATALOG_KIND_LABELS.note
          const title = String(n.title || 'Untitled').replace(/[\r\n]+/g, ' ')   // 一行一条：标题换行收拢
          const wsTag = (ws && n.workspace && n.workspace !== ws) ? ', ←' + n.workspace : ''   // 非当前工作区标注来源
          return '- [' + n.id + '] ' + title + ' (' + kl + ', ' + (n.topic || '未分类') + wsTag + ')'
        })
        if (pool.length > CATALOG_LIMIT) lines.push('…另有 ' + (pool.length - CATALOG_LIMIT) + ' 条较早笔记，用 note_search 检索')
        return '本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：\n' +
          lines.join('\n') +
          '\n规划任务前，若目录中有相关笔记（尤其待办/决策），建议先 note_get 读取再动手'
      } catch (e) { return '' }
    }

    // ---- 性能遥测：RPC 计数/耗时 + 缓存命中 + client 推送快照，节流写盘供诊断 ----
    const perfStats = { started: new Date().toISOString(), rpc: {}, rpcMs: {}, classify: 0, classifyMs: 0, cacheReads: 0, diskReads: 0, diskWrites: 0, client: null }
    let lastPerfWrite = 0
    function writePerfReport() {
      const t = Date.now()
      if (t - lastPerfWrite < 10000) return
      lastPerfWrite = t
      ;(async () => {
        try {
          const ft = await fs.resolve(PLUGIN_DIR + '\\perf-report.json')
          await fs.writeText(ft, JSON.stringify({ writtenAt: new Date().toISOString(), host: perfStats }, null, 2), undefined, undefined, getPolicy())
        } catch (e) {}
      })()
    }
    function handle(name, fn) {
      return harness.handle(name, async (args) => {
        const t0 = Date.now()
        try { return await fn(args) }
        finally { perfStats.rpc[name] = (perfStats.rpc[name] || 0) + 1; perfStats.rpcMs[name] = (perfStats.rpcMs[name] || 0) + (Date.now() - t0); writePerfReport() }
      })
    }
    disposers.push(handle('notes-perf', async (args) => { if (args && args.perf) perfStats.client = args.perf; return { ok: true } }))
    disposers.push(handle('notes-list', async (args) => ({ notes: (await _list(args && args.tag, args && args.kind, args && args.folder)).map(slim) })))
    // 虚拟文件夹清单/管理：无参=列表（含计数），args={op:'create'|'rename'|'delete'|'reorder', ...}
    disposers.push(handle('notes-folders', async (args) => {
      try { return await _folders(args) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 样式文件按需下发：避免 client 内嵌超长 CSS 字符串在 define 传输中被截断
    disposers.push(handle('notes-css', async () => {
      try { const ft = await fs.resolve(CSS_PATH); return { css: await fs.readText(ft) } } catch (e) { return { error: String(e.message || e) } }
    }))
    // client 实现源码下发：bootstrap 壳通过它加载真正的 client-impl.js（同理避免 define 传大字符串）
    disposers.push(handle('notes-src', async (args) => {
      try {
        const which = args && args.which === 'client' ? 'client-impl.js' : 'host-impl.js'
        const ft = await fs.resolve(PLUGIN_DIR + '\\' + which)
        return { src: await fs.readText(ft) }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-get', async (args) => {
      try { const n = await _get(args.id); const s = slim(n); s.body = n.body; return { note: s } } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-create', async (args) => {
      try { return await _create(args.title, args.body, args.tags, args.topic, { kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo, folder: args.folder, recall: args.recall }) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-update', async (args) => {
      try { return await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, args.folder, args.recall, args.injectRole) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-quick', async (args) => {
      try { return await _quickCapture(args.text, args.sessionId, args.cwd, args.kind) } catch (e) { return { error: String(e.message || e) } }
    }))
    // T3 指令式快速记录：备注非空时 LLM 提取 tags/titleHint/kind/inject，选区原文原样为 body，备注不进笔记
    disposers.push(handle('notes-quick-instruct', async (args) => {
      try { return await _quickInstruct(args.text, args.note, args.sessionId, args.cwd) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-delete', async (args) => {
      try { return await _delete(args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-restore', async (args) => {
      try { return await _restore(args.id) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-archive', async () => {
      try { return await _archive() } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-search', async (args) => {
      try { return { notes: (await _search(args && args.query, args && args.tag, args && args.topic, args && args.kind, args && args.folder)).map(slim) } } catch (e) { return { error: String(e.message || e) } }
    }))
    // 上下文注入（双角色分桶）：注册动态 prompt context（order 130，位于 policy/delegation 之后）
    // 笔记目录索引注入（recall 通道）：order 131 紧邻上下文注入之后；text 同步返回 string，无内容/总开关关闭返回 ''
    if (systemPrompt && typeof systemPrompt.context === 'function') {
      disposers.push(systemPrompt.context({ name: 'notes:workspace-conventions', order: 130, text: () => conventionText() }))
      disposers.push(systemPrompt.context({ name: 'notes:catalog', order: 131, text: () => catalogText() }))
    }
    // 调试 RPC：预览当前会话将注入的上下文笔记文本（双角色分桶新文案，E2E 验证用）
    disposers.push(handle('notes-conventions', async () => ({ text: conventionText() || '' })))
    // 会话列表（注入范围多选用）：与派发同源——工作区有效会话（排除已归档 + 子 agent），复用 _activeSessions
    // 返回 { sessions, titlesPending?, pendingIds?, pendingSessions? }：缓存未命中的会话后台补标题（0.1.7 首屏不阻塞）
    disposers.push(handle('notes-sessions', async () => {
      try { return await _activeSessions() } catch (e) { return { sessions: [] } }
    }))
    // 活跃主会话列表（任务派发目标用）：同 notes-sessions——live 实时 + 非 live 走元数据缓存（TTL 10min）
    disposers.push(handle('notes-active-sessions', async () => {
      try { return await _activeSessions() } catch (e) { return { sessions: [] } }
    }))
    // 工作区列表（派发对话框的"新建会话"下拉用）
    disposers.push(handle('notes-workspaces', async () => {
      try {
        if (!workspaceRegistry || !workspaceRegistry.list) return { workspaces: [] }
        const list = workspaceRegistry.list() || []
        return { workspaces: list.map(w => ({ id: w.id, title: w.title || basename(w.path || ''), cwd: w.path || '' })) }
      } catch (e) { return { workspaces: [] } }
    }))
    // 任务派发（client 面板用）：复用共享 _dispatch（系统提示注入形式，登记到 dispatches）
    disposers.push(handle('notes-dispatch', async (args) => {
      try { return await _dispatch(args.id, { sessionId: args.sessionId, sessionName: args.sessionName, workspace: args.workspace, mode: args.mode, instruction: args.instruction }) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 标记派发待办完成（停止注入目标会话系统提示）
    disposers.push(handle('notes-dispatch-done', async (args) => {
      try { return await _dispatchDone(args.id, args.dispatchIndex) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 设置读取（设置卡片数据源）：settings 内存缓存（确保已加载）+ 可用模型列表（探不到为空数组，client 退化手输）
    disposers.push(handle('notes-settings-get', async () => {
      try { await loadSettings(); return { settings: settingsCache, models: await listAvailableModels() } }
      catch (e) { return { settings: settingsCache || {}, models: [], error: String(e.message || e) } }
    }))
    // 设置保存（client 选择即保存）：浅合并顶层键；llm 为 null 恢复跟随会话；catalogEnabled 为 null 恢复默认开
    disposers.push(handle('notes-settings-set', async (args) => {
      try {
        await loadSettings()
        const patch = (args && typeof args === 'object') ? args : {}
        if ('llm' in patch) {
          if (patch.llm === null || patch.llm === undefined) delete settingsCache.llm
          else {
            const l = patch.llm
            const provider = l && typeof l.provider === 'string' ? l.provider.trim() : ''
            const model = l && typeof l.model === 'string' ? l.model.trim() : ''
            if (!provider || !model) return { error: 'notes-settings-set: llm 需要 provider + model（或 null 恢复跟随会话）' }
            settingsCache.llm = { provider: provider, model: model }
          }
        }
        // 目录索引注入总开关：布尔直存；null/undefined 删除 override（缺省 = 开）
        if ('catalogEnabled' in patch) {
          if (patch.catalogEnabled === null || patch.catalogEnabled === undefined) delete settingsCache.catalogEnabled
          else if (typeof patch.catalogEnabled === 'boolean') settingsCache.catalogEnabled = patch.catalogEnabled
          else return { error: 'notes-settings-set: catalogEnabled 需要布尔值（或 null 恢复默认开）' }
        }
        await saveSettings()
        return { ok: true, settings: settingsCache }
      } catch (e) { return { error: String(e.message || e) } }
    }))
    // 全库导出（目录快照）：args={dir} → <dir>\dsh-notes-export-<ts>\，返回 { exported, foldersFile, target }
    disposers.push(handle('notes-export', async (args) => {
      try { return await _export(args && args.dir) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 导入预览（只读）：args={dir} → same/diff/added 分类 + folders 新旧统计，不写任何东西
    disposers.push(handle('notes-import-preview', async (args) => {
      try { return await _importPreview(args && args.dir) } catch (e) { return { error: String(e.message || e) } }
    }))
    // 导入执行：先全量备份（notes-backup-<ts>），added 入库 / diff 默认跳过（overwrite=true 覆盖）/ folders.json 合并只增不删
    disposers.push(handle('notes-import', async (args) => {
      try { return await _import(args && args.dir, !!(args && args.overwrite)) } catch (e) { return { error: String(e.message || e) } }
    }))

    function regTool(def) {
      const tool = harness.defineTool(def)
      if (tool) disposers.push(harness.registerTool(ctx, tool))
    }

    const outSchema = { type: 'object', additionalProperties: true }
    function mkRender() {
      return (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    }

    // ---- 工具层：合并 9 个细粒度工具为 3 个（note_search / note_get / note_manage）
    // RPC 层保持 12 个 handler 不变（client panel 仍在用）；工具只面向 Agent，瘦身 schema。
    regTool({
      name: 'note_search',
      description: 'Search local notes by free-text query (matches title/body/topic/tags), with optional tag, topic, kind, and folder filters. Returns slim notes (no body) for fast triage — call note_get for the full body of a specific id. Tip: when planning a task, picking an approach, or making decisions, consider searching this notes library first for related decisions, todos, and context recorded in earlier sessions — it may already contain the conclusions you need.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text query against title, body, topic, and tags. Omit to list all (optionally filtered by tag/topic/kind/folder).' },
          tag: { type: 'string', description: 'Optional tag filter (exact match)' },
          topic: { type: 'string', description: 'Optional topic filter (exact match)' },
          kind: { type: 'string', enum: KINDS, description: 'Optional kind filter: note/decision/todo/link/quote' },
          folder: { type: 'string', description: 'Optional folder filter: folder id or exact folder name; empty string = unfiled notes (未分类)' },
          limit: { type: 'number', description: 'Optional max results (default 50)' }
        }
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        // folder 入参兼容 id 或名称（名称精确命中）；找不到直接报错，不写悬空引用
        let folder = args && args.folder
        if (folder !== undefined) {
          const rf = await resolveFolderRef(folder)
          if (!rf) return { error: '文件夹不存在：' + String(folder) }
          folder = rf.id
        }
        const all = await _search(args && args.query, args && args.tag, args && args.topic, args && args.kind, folder)
        const limit = (args && args.limit) || 50
        return { count: all.length, notes: all.slice(0, limit).map(slim) }
      }
    })

    regTool({
      name: 'note_get',
      description: 'Read the full body and metadata of a local note by id. Use after note_search to retrieve the body of an interesting result.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Note id' } },
        required: ['id']
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        try { const n = await _get(args.id); return { note: n } }
        catch (e) { return { error: String(e.message || e) } }
      }
    })

    regTool({
      name: 'note_manage',
      description: 'Single tool for create/list/update/delete/restore/archive. Pick an action and supply its required fields. The Agent should prefer this for any non-search CRUD: one tool means one decision point and one schema to learn.\n\n' +
        'Fields kind (what it is) and status (its lifecycle) are orthogonal: kind ∈ note/decision/todo/link/quote (default note); status ∈ active/pinned/resolved/superseded (default active).\n' +
        'inject (boolean) controls whether the note is injected into the system prompt as context — an explicit field, NOT a tag. injectRole ("convention"|"reference", default "convention") picks the injection bucket: convention = user rules to follow; reference = background facts to consult only when relevant to the current task. Rule of thumb — infer from kind: decision/todo → convention, note/link/quote → reference. injectTo (string[]) is the injection scope, a multi-select list: [] or ["workspace"]=current workspace (default), ["global"]=all sessions, or session short-ids like ["99f2b674","7f8b49e6"]=those sessions.\n\n' +
        'recall (boolean) controls whether the note appears in the notes catalog — a one-line-per-note index injected into the system prompt (right after conventions) so you know what the library holds without searching; default true. Set false to hide a note from the catalog (it stays searchable via note_search). Orthogonal to inject; notes with status resolved/superseded never appear in the catalog.\n\n' +
        'folder (string) assigns a note to a virtual folder: pass a folder id or an exact folder name; "" or omitted = unfiled (未分类). Folders (name/order) are managed via the notes-folders RPC (list/create/rename/delete/reorder).\n\n' +
        'Actions:\n' +
        '- create: { title, body, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall?, folder?, sessionId?, cwd?, workspace? }\n' +
        '- list: { tag?, topic?, kind?, folder? } (no id/title/body needed)\n' +
        '- update: { id, title?, body?, topic?, tags?, kind?, status?, inject?, injectRole?, injectTo?, recall? }\n' +
        '- move: { id, folder } (move note into a virtual folder; folder = folder id or exact folder name, "" = move out to unfiled)\n' +
        '- delete: { id } (soft delete; restorable via restore)\n' +
        '- restore: { id } (undo delete/archive)\n' +
        '- archive: {} (no fields; merges quick-captures by session and manual notes by tag)\n' +
        '- dispatch: { id, targetSessionId?, targetSessionName?, instruction? } (assemble the todo context plus your instruction into one user message and send it to a live session as a real task; the handoff is recorded in the note\'s dispatches property. Omit targetSessionId to list live sessions.)',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'update', 'move', 'delete', 'restore', 'archive', 'dispatch', 'debugws'], description: 'Action to perform' },
          // create / update 字段
          id: { type: 'string', description: 'Note id (required for update/delete/restore/dispatch)' },
          title: { type: 'string', description: 'Title (create/update)' },
          body: { type: 'string', description: 'Markdown body (create/update)' },
          topic: { type: 'string', description: 'Topic (create/update; defaults to 未分类)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags (create/update)' },
          kind: { type: 'string', enum: KINDS, description: 'Kind (create/update): note/decision/todo/link/quote; default note' },
          status: { type: 'string', enum: STATUSES, description: 'Status (create/update): active/pinned/resolved/superseded; default active' },
          inject: { type: 'boolean', description: 'Inject into system prompt as context (create/update); default false' },
          injectRole: { type: 'string', enum: ['convention', 'reference'], description: 'Injection role: convention=rules to follow | reference=background facts to consult as needed; default convention' },
          injectTo: { type: 'array', items: { type: 'string' }, description: 'Injection scope multi-select (create/update): []/["workspace"]=current workspace (default), ["global"]=all, or session short-ids' },
          recall: { type: 'boolean', description: 'Recall in the notes catalog index (create/update); default true. Set false to hide from the catalog (still searchable via note_search).' },
          folder: { type: 'string', description: 'Virtual folder (create/move/list filter): folder id or exact folder name; "" = unfiled (未分类)' },
          // dispatch 字段
          targetSessionId: { type: 'string', description: 'Dispatch target: a live session id (dispatch). Omit to list live sessions.' },
          targetSessionName: { type: 'string', description: 'Dispatch target display name (dispatch, optional)' },
          instruction: { type: 'string', description: 'Dispatch: your concrete instruction appended to the todo context (dispatch, optional)' },
          // list 字段
          tag: { type: 'string', description: 'Tag filter (list only)' },
          // 高级（通常自动填充）
          sessionId: { type: 'string', description: 'Session id (advanced; usually auto-filled)' },
          cwd: { type: 'string', description: 'Working dir (advanced; usually auto-filled)' },
          workspace: { type: 'string', description: 'Workspace name (advanced; usually auto-filled)' }
        },
        required: ['action']
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        const action = args && args.action
        try {
          if (action === 'create') {
            if (!args.title || !args.body) return { error: 'note_manage.create 需要 title 和 body' }
            // folder 兼容 id 或名称（名称精确命中解析为 id）；找不到直接报错，不写悬空引用
            let folder = args.folder
            if (folder !== undefined) {
              const rf = await resolveFolderRef(folder)
              if (!rf) return { error: '文件夹不存在：' + String(folder) }
              folder = rf.id
            }
            const r = await _create(args.title, args.body, args.tags, args.topic, {
              sessionId: args.sessionId, cwd: args.cwd, workspace: args.workspace,
              kind: args.kind, status: args.status, inject: args.inject, injectRole: args.injectRole, injectTo: args.injectTo,
              folder: folder, recall: args.recall
            })
            return { action: 'create', id: r.id, topic: r.topic, kind: r.kind, status: r.status, message: 'Note created' }
          }
          if (action === 'list') {
            // folder 过滤：兼容 id 或名称；'' = 未分类
            let folder = args.folder
            if (folder !== undefined) {
              const rf = await resolveFolderRef(folder)
              if (!rf) return { error: '文件夹不存在：' + String(folder) }
              folder = rf.id
            }
            const notes = await _list(args.tag, args.kind, folder)
            return { action: 'list', count: notes.length, notes: notes.map(slim) }
          }
          if (action === 'move') {
            if (!args.id) return { error: 'note_manage.move 需要 id' }
            if (args.folder === undefined) return { error: 'note_manage.move 需要 folder（文件夹 id 或名称，空字符串 = 移出到未分类）' }
            const rf = await resolveFolderRef(args.folder)
            if (!rf) return { error: '文件夹不存在：' + String(args.folder) }
            await _update(args.id, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, rf.id)
            return { action: 'move', id: args.id, folder: rf.id, folderName: rf.name, message: rf.id ? '已移动到文件夹「' + rf.name + '」' : '已移出文件夹（未分类）' }
          }
          if (action === 'update') {
            if (!args.id) return { error: 'note_manage.update 需要 id' }
            const r = await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo, undefined, args.recall, args.injectRole)
            return { action: 'update', id: args.id, kind: r.kind, status: r.status, message: 'Note updated' }
          }
          if (action === 'delete') {
            if (!args.id) return { error: 'note_manage.delete 需要 id' }
            await _delete(args.id)
            return { action: 'delete', id: args.id, message: 'Note deleted (soft)' }
          }
          if (action === 'restore') {
            if (!args.id) return { error: 'note_manage.restore 需要 id' }
            await _restore(args.id)
            return { action: 'restore', id: args.id, message: 'Note restored' }
          }
          if (action === 'archive') {
            const r = await _archive()
            return { action: 'archive', merged: r.merged, mergedIds: r.mergedIds, message: 'Archived ' + r.merged + ' groups' }
          }
          if (action === 'debugws') {
            // dump 指定会话（args.sessionId=short id）的 title 事件历史 + fold 结果
            if (args.sessionId) {
              const hs = await sessionPersistence.list()
              const h = hs.map(snapHeader).find(x => x && shortSid(x.id) === args.sessionId)
              if (!h) return { error: '会话不存在: ' + args.sessionId }
              const insp = await sessionPersistence.inspect(h.id)
              const evs = (insp && insp.events) || []
              const titleEvs = []
              for (const ev of evs) { if (ev && ev.type === 'session/title') titleEvs.push({ seq: ev.seq, title: ev.data && ev.data.title, source: ev.data && ev.data.source && ev.data.source.kind }) }
              const live = agents && agents.get ? agents.get(h.id) : undefined
              let stTitle = '(not live)'
              if (live) { try { const s = sessionTitle.get(live.session); stTitle = s && s.title } catch (e) { stTitle = 'ERR' } }
              return { action: 'debugws', sessionShort: args.sessionId, live: !!live, parent: h.parentSession ? shortSid(h.parentSession) : '', sessionTitleGet: stTitle, titleEvents: titleEvs }
            }
            // 默认：对比 工作区 sessionIds（左侧列表数据源）vs sessionPersistence.list()（所有持久化），确认"已关闭"会话的差异
            const wl = (workspaceRegistry && workspaceRegistry.list) ? workspaceRegistry.list() : []
            const archivedSet = {}
            try { const arch = workspaceRegistry && workspaceRegistry.archivedSessionIds; if (Array.isArray(arch)) { for (const id of arch) archivedSet[id] = true } } catch (e) {}
            const wsInfo = []
            let totalInWs = 0, archivedInWs = 0
            for (const w of wl) {
              let sids = []
              try { sids = w.sessionIds || [] } catch (e) {}
              const cnt = Array.isArray(sids) ? sids.length : 0
              totalInWs += cnt
              const archCnt = Array.isArray(sids) ? sids.filter(s => archivedSet[s]).length : 0
              archivedInWs += archCnt
              wsInfo.push({ title: w.title, sessionCount: cnt, archivedInIt: archCnt })
            }
            let totalPersist = 0
            try { const hs = await sessionPersistence.list(); totalPersist = hs.length } catch (e) {}
            return {
              action: 'debugws',
              hasInspect: typeof sessionPersistence.inspect,
              hasStat: typeof sessionPersistence.stat,
              totalPersist: totalPersist,
              totalInWorkspaces: totalInWs,
              archivedInWorkspaces: archivedInWs,
              archivedSetSize: Object.keys(archivedSet).length,
              workspaces: wsInfo
            }
          }
          if (action === 'dispatch') {
            if (!args.id) return { error: 'note_manage.dispatch 需要 id' }
            if (!args.targetSessionId) {
              // 未指定目标：返回当前活跃主会话列表（含名字）供 agent 选择（_activeSessions 新形态：取 .sessions）
              const list = (await _activeSessions()).sessions.map(s => ({ sessionId: s.id, short: s.short, name: s.name, workspace: s.workspace }))
              return { action: 'dispatch', needTarget: true, activeSessions: list, message: '请用 targetSessionId 指定目标活跃会话' }
            }
            const r = await _dispatch(args.id, { sessionId: args.targetSessionId, sessionName: args.targetSessionName, instruction: args.instruction, mode: 'existing' })
            if (r.error) return { error: r.error }
            return { action: 'dispatch', id: args.id, sessionId: r.sessionId, message: '已派发到「' + r.sessionName + '」' + (args.instruction ? '（含具体要求）' : '') }
          }
          return { error: 'note_manage: 未知 action：' + String(action) + '（期望 create/list/update/move/delete/restore/archive/dispatch）' }
        } catch (e) { return { error: String(e.message || e) } }
      }
    })

    // 设置启动加载（不阻塞 apply 返回）：classifyTopic/extractInstruction/catalogText/notes-settings-get 读同一内存缓存
    loadSettings()

    ctx.effect(() => () => {
      for (const d of disposers) { try { d() } catch (e) {} }
    })
    console.log('notes plugin: host ready, dir =', NOTES_DIR, ', llm =', !!llm, ', adm =', !!adm)
    // 心跳文件：自检验证 impl 真正加载成功（bootstrap 架构下 apply 异步完成）
    ;(async () => { try { const ft = await fs.resolve(PLUGIN_DIR + '\\.last-host-load'); await fs.writeText(ft, new Date().toISOString(), undefined, undefined, getPolicy()) } catch (e) {} })()
  }
}
