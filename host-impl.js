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
        'tags: ' + (m.tags || []).map(escYaml).join(', ') + '\n' +
        'kind: ' + escYaml(m.kind || 'note') + '\n' +
        'status: ' + escYaml(m.status || 'active') + '\n' +
        'inject: ' + escYaml(m.inject ? 'true' : 'false') + '\n' +
        'injectTo: ' + (m.injectTo || []).map(escYaml).join(', ') + '\n' +
        'createdAt: ' + escYaml(m.createdAt) + '\n' +
        'updatedAt: ' + escYaml(m.updatedAt) + '\n' +
        'sessionId: ' + escYaml(m.sessionId) + '\n' +
        'cwd: ' + escYaml(m.cwd) + '\n' +
        'mergedFrom: ' + (m.mergedFrom || []).map(escYaml).join(', ') + '\n' +
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

    async function classifyTopic(text) {
      if (!llm || !adm) return '未分类'
      try {
        const sel = adm.currentSelection()
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
      return {
        id: p.meta.id || id,
        title: p.meta.title || 'Untitled',
        topic: p.meta.topic || '未分类',
        workspace: p.meta.workspace || '',
        tags: tags,
        kind: p.meta.kind || 'note',
        status: p.meta.status || 'active',
        inject: inject,
        injectTo: injectTo,
        createdAt: p.meta.createdAt || '',
        updatedAt: p.meta.updatedAt || '',
        sessionId: p.meta.sessionId || '',
        cwd: p.meta.cwd || '',
        mergedFrom: p.meta.mergedFrom || [],
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
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace,
        tags: n.tags || [], kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectTo: n.injectTo || [],
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, mergedFrom: n.mergedFrom || [],
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
        id: n.id, title: n.title, topic: n.topic, workspace: n.workspace,
        tags: n.tags, kind: n.kind || 'note', status: n.status || 'active',
        inject: n.inject === true, injectTo: n.injectTo || [],
        createdAt: n.createdAt, updatedAt: n.updatedAt,
        sessionId: n.sessionId, cwd: n.cwd, mergedFrom: n.mergedFrom,
        archivedAt: n.archivedAt, preview: String(n.body || '').slice(0, 200)
      }
    }

    async function _create(title, body, tags, topic, extra) {
      const id = genId()
      const now = new Date().toISOString()
      const sc = sessCtx()
      const ex = extra || {}
      const note = {
        id, title: title || 'Untitled', topic: topic || '未分类',
        workspace: ex.workspace || basename(sc.cwd),
        tags: tags || [],
        kind: ex.kind || 'note',
        status: ex.status || 'active',
        inject: ex.inject === true,
        injectTo: ex.injectTo || [],
        createdAt: ex.createdAt || now, updatedAt: ex.updatedAt || now,
        sessionId: ex.sessionId !== undefined ? ex.sessionId : sc.sessionId,
        cwd: ex.cwd || sc.cwd,
        mergedFrom: ex.mergedFrom || [],
        archivedAt: ex.archivedAt || '',
        deleted: false,
        body: body || ''
      }
      await persistNote(note)
      return { id, topic: note.topic, title: note.title, kind: note.kind, status: note.status }
    }

    async function _list(tag, kind) {
      try {
        const dirTarget = await fs.resolve(NOTES_DIR)
        const info = await fs.stat(dirTarget)
        if (!info) return []
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

    async function _update(id, title, body, tags, topic, kind, status, inject, injectTo) {
      const note = Object.assign({}, await loadNote(id))
      if (note.deleted) throw new Error('Note has been deleted')
      if (title !== undefined) note.title = title
      if (topic !== undefined) note.topic = topic
      if (tags !== undefined) note.tags = tags
      if (kind !== undefined) note.kind = kind
      if (status !== undefined) note.status = status
      if (inject !== undefined) note.inject = inject === true
      if (injectTo !== undefined) note.injectTo = injectTo
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
          archivedAt: now
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

    // 任务派发（共享）：把笔记待办作为 user 消息注入目标活跃 agent 的 inbox（next-turn，唤醒），并在正文追加"已派发"记录
    async function _dispatch(id, sessionId, sessionName) {
      const note = await _get(id)
      if (note.deleted) return { error: '笔记已删除' }
      const target = agents && agents.get ? agents.get(sessionId) : undefined
      if (!target || typeof target.send !== 'function') return { error: '目标会话不在活跃状态（可能已关闭），请换一个' }
      const taskText = '【笔记派发任务】请处理以下待办（来自笔记「' + (note.title || 'Untitled') + '」）：\n\n' + String(note.body || note.title || '').trim()
      const msg = {
        id: 'note-dispatch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        role: 'user',
        content: [{ type: 'text', text: taskText }],
        source: { kind: 'user' }
      }
      target.send(msg, 'next-turn', true)
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const targetName = sessionName || shortSid(sessionId)
      const newBody = String(note.body || '').trim() + '\n\n> → 已派发到「' + targetName + '」 ' + stamp + '\n'
      await _update(note.id, undefined, newBody, undefined, undefined)
      return { ok: true, id: note.id, sessionId: sessionId, sessionName: targetName }
    }

    async function _search(query, tag, topic, kind) {
      const all = await _list()
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

    // T2.3 工作区约定：从常驻内存 cache 同步读取 convention 笔记，注入 agent 系统提示。
    // text 是同步函数（systemPrompt 契约），故不能 await _list()，必须读 cache。
    // 注入范围由约定笔记的 injectTo 字段决定（可选）：
    // 是否注入：inject 布尔字段（noteFromParsed 已对旧数据回退到 convention 标签）。
    // 注入范围 injectTo 是多选数组：
    //   []（空）        → 默认当前工作区（向后兼容旧数据 injectTo=''）
    //   含 'global'     → 全局注入（不限工作区）
    //   含 'workspace'  → 当前工作区
    //   含会话短 id     → 注入该会话（可多选多个会话）
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
          const targets = n.injectTo || []
          let hit = false
          if (targets.length === 0) {
            // 默认：当前工作区（workspace 为空视为全局约定）
            hit = !n.workspace || !ws || n.workspace === ws
          } else {
            for (const t of targets) {
              if (t === 'global') { hit = true; break }
              if (t === 'workspace') { if (!n.workspace || !ws || n.workspace === ws) { hit = true; break } }
              else if (t === curSid) { hit = true; break }
            }
          }
          if (hit) matches.push(n)
        }
        if (matches.length === 0) return ''
        matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        const blocks = matches.map(n => {
          const src = shortSid(n.sessionId)
          const srcLabel = src ? '（记录于会话 ' + src + '）' : '（来源会话未知）'
          return '【' + (n.title || 'Untitled') + '】' + srcLabel + '\n' + String(n.body || '').trim()
        }).join('\n\n')
        const label = ws ? '工作区「' + ws + '」' : '全局'
        const full = '以下是' + label + '已记录的约定（本地笔记，每条标注其记录会话；与当前任务无关时忽略）：\n\n' + blocks
        return full.length > 4000 ? full.slice(0, 4000) + '\n\n（内容过长已截断）' : full
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
    disposers.push(handle('notes-list', async (args) => ({ notes: (await _list(args && args.tag, args && args.kind)).map(slim) })))
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
      try { return await _create(args.title, args.body, args.tags, args.topic, { kind: args.kind, status: args.status, inject: args.inject, injectTo: args.injectTo }) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-update', async (args) => {
      try { return await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo) } catch (e) { return { error: String(e.message || e) } }
    }))
    disposers.push(handle('notes-quick', async (args) => {
      try { return await _quickCapture(args.text, args.sessionId, args.cwd, args.kind) } catch (e) { return { error: String(e.message || e) } }
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
      try { return { notes: (await _search(args && args.query, args && args.tag, args && args.topic, args && args.kind)).map(slim) } } catch (e) { return { error: String(e.message || e) } }
    }))
    // T2.3 工作区约定自动注入：注册动态 prompt context（order 130，位于 policy/delegation 之后）
    if (systemPrompt && typeof systemPrompt.context === 'function') {
      disposers.push(systemPrompt.context({ name: 'notes:workspace-conventions', order: 130, text: () => conventionText() }))
    }
    // 调试 RPC：预览当前会话将注入的约定文本（E2E 验证用）
    disposers.push(handle('notes-conventions', async () => ({ text: conventionText() || '' })))
    // 会话列表（注入范围多选用）：列出所有工作区下的主窗口会话（排除一次性子 agent + 已归档会话）
    disposers.push(handle('notes-sessions', async () => {
      try {
        if (!sessionPersistence || !sessionPersistence.list) return { sessions: [] }
        let headers = []
        try { headers = await sessionPersistence.list() } catch (e) {}
        // 已归档会话集合（workspaceRegistry.archivedSessionIds 是 registry 级归档集合）
        const archivedSet = {}
        try {
          const arch = workspaceRegistry && workspaceRegistry.archivedSessionIds
          if (Array.isArray(arch)) { for (const id of arch) archivedSet[id] = true }
        } catch (e) {}
        // 排除一次性子 agent 会话 + 已归档会话；按创建时间倒序，最近的在前；上限 50 避免过多
        const sorted = headers.slice()
          .filter(h => h && h.id && h.origin !== 'subagent' && !archivedSet[h.id])
          .sort((a, b) => String((b && b.createdAt) || '').localeCompare(String((a && a.createdAt) || '')))
        const capped = sorted.slice(0, 50)
        const out = []
        for (const h of capped) {
          if (!h || !h.id) continue
          const sid = h.id
          const short = String(sid).replace(/^session-/, '').slice(0, 8)
          const cwd = h.cwd || ''
          let title = ''
          if (sessionPersistence.inspect) {
            try {
              const insp = await sessionPersistence.inspect(sid)
              const evs = (insp && insp.events) || []
              for (const ev of evs) { if (ev && ev.type === 'session/title' && ev.data && ev.data.title) { title = ev.data.title; break } }
            } catch (e) {}
          }
          const wsName = cwd ? basename(cwd) : ''
          const fallback = (wsName || '会话') + ' · ' + (h.createdAt ? String(h.createdAt).slice(5, 16).replace('T', ' ') : short)
          out.push({ id: sid, short: short, name: title || fallback, cwd: cwd, workspace: wsName })
        }
        return { sessions: out }
      } catch (e) { return { sessions: [] } }
    }))
    // 活跃主会话列表（任务派发目标用）：agents.roots() 返回顶层 live agents（天然排除子 agent）
    disposers.push(handle('notes-active-sessions', async () => {
      try {
        if (!agents || !agents.roots) return { sessions: [] }
        const roots = agents.roots()
        const out = []
        for (const a of roots) {
          const sid = a.id || (a.session && a.session.id)
          if (!sid) continue
          const cwd = (a.session && a.session.header && a.session.header.cwd) || ''
          let title = ''
          if (sessionPersistence && sessionPersistence.inspect) {
            try {
              const insp = await sessionPersistence.inspect(sid)
              const evs = (insp && insp.events) || []
              for (const ev of evs) { if (ev && ev.type === 'session/title' && ev.data && ev.data.title) { title = ev.data.title; break } }
            } catch (e) {}
          }
          const wsName = cwd ? basename(cwd) : ''
          out.push({ id: sid, short: shortSid(sid), name: title || ((wsName || '会话') + ' · ' + shortSid(sid)), cwd: cwd, workspace: wsName })
        }
        return { sessions: out }
      } catch (e) { return { sessions: [] } }
    }))
    // 任务派发（client 面板用）：复用共享 _dispatch
    disposers.push(handle('notes-dispatch', async (args) => {
      try { return await _dispatch(args.id, args.sessionId, args.sessionName) } catch (e) { return { error: String(e.message || e) } }
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
      description: 'Search local notes by free-text query (matches title/body/topic/tags), with optional tag, topic, and kind filters. Returns slim notes (no body) for fast triage — call note_get for the full body of a specific id.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text query against title, body, topic, and tags. Omit to list all (optionally filtered by tag/topic/kind).' },
          tag: { type: 'string', description: 'Optional tag filter (exact match)' },
          topic: { type: 'string', description: 'Optional topic filter (exact match)' },
          kind: { type: 'string', enum: KINDS, description: 'Optional kind filter: note/decision/todo/link/quote' },
          limit: { type: 'number', description: 'Optional max results (default 50)' }
        }
      },
      output: { schema: outSchema, render: mkRender() },
      async execute(args) {
        const all = await _search(args && args.query, args && args.tag, args && args.topic, args && args.kind)
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
        'inject (boolean) controls whether the note is injected into the system prompt as a workspace convention — an explicit field, NOT a tag. injectTo (string[]) is the injection scope, a multi-select list: [] or ["workspace"]=current workspace (default), ["global"]=all sessions, or session short-ids like ["99f2b674","7f8b49e6"]=those sessions.\n\n' +
        'Actions:\n' +
        '- create: { title, body, topic?, tags?, kind?, status?, inject?, injectTo?, sessionId?, cwd?, workspace? }\n' +
        '- list: { tag?, topic?, kind? } (no id/title/body needed)\n' +
        '- update: { id, title?, body?, topic?, tags?, kind?, status?, inject?, injectTo? }\n' +
        '- delete: { id } (soft delete; restorable via restore)\n' +
        '- restore: { id } (undo delete/archive)\n' +
        '- archive: {} (no fields; merges quick-captures by session and manual notes by tag)\n' +
        '- dispatch: { id, targetSessionId?, targetSessionName? } (send the note as a task to a live session. Omit targetSessionId to list live sessions you can dispatch to.)',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'list', 'update', 'delete', 'restore', 'archive', 'dispatch'], description: 'Action to perform' },
          // create / update 字段
          id: { type: 'string', description: 'Note id (required for update/delete/restore/dispatch)' },
          title: { type: 'string', description: 'Title (create/update)' },
          body: { type: 'string', description: 'Markdown body (create/update)' },
          topic: { type: 'string', description: 'Topic (create/update; defaults to 未分类)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags (create/update)' },
          kind: { type: 'string', enum: KINDS, description: 'Kind (create/update): note/decision/todo/link/quote; default note' },
          status: { type: 'string', enum: STATUSES, description: 'Status (create/update): active/pinned/resolved/superseded; default active' },
          inject: { type: 'boolean', description: 'Inject as convention into system prompt (create/update); default false' },
          injectTo: { type: 'array', items: { type: 'string' }, description: 'Injection scope multi-select (create/update): []/["workspace"]=current workspace (default), ["global"]=all, or session short-ids' },
          // dispatch 字段
          targetSessionId: { type: 'string', description: 'Dispatch target: a live session id (dispatch). Omit to list live sessions.' },
          targetSessionName: { type: 'string', description: 'Dispatch target display name (dispatch, optional)' },
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
            const r = await _create(args.title, args.body, args.tags, args.topic, {
              sessionId: args.sessionId, cwd: args.cwd, workspace: args.workspace,
              kind: args.kind, status: args.status, inject: args.inject, injectTo: args.injectTo
            })
            return { action: 'create', id: r.id, topic: r.topic, kind: r.kind, status: r.status, message: 'Note created' }
          }
          if (action === 'list') {
            const notes = await _list(args.tag, args.kind)
            return { action: 'list', count: notes.length, notes: notes.map(slim) }
          }
          if (action === 'update') {
            if (!args.id) return { error: 'note_manage.update 需要 id' }
            const r = await _update(args.id, args.title, args.body, args.tags, args.topic, args.kind, args.status, args.inject, args.injectTo)
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
          if (action === 'dispatch') {
            if (!args.id) return { error: 'note_manage.dispatch 需要 id' }
            if (!args.targetSessionId) {
              // 未指定目标：返回当前活跃主会话列表供 agent 选择
              const roots = agents && agents.roots ? agents.roots() : []
              const list = roots.map(a => { const sid = a.id || (a.session && a.session.id); const cwd = (a.session && a.session.header && a.session.header.cwd) || ''; return { sessionId: sid, short: shortSid(sid), workspace: cwd ? basename(cwd) : '' } }).filter(x => x.sessionId)
              return { action: 'dispatch', needTarget: true, activeSessions: list, message: '请用 targetSessionId 指定目标活跃会话' }
            }
            const r = await _dispatch(args.id, args.targetSessionId, args.targetSessionName)
            if (r.error) return { error: r.error }
            return { action: 'dispatch', id: args.id, sessionId: r.sessionId, message: '已派发到「' + r.sessionName + '」' }
          }
          return { error: 'note_manage: 未知 action：' + String(action) + '（期望 create/list/update/delete/restore/archive/dispatch）' }
        } catch (e) { return { error: String(e.message || e) } }
      }
    })

    ctx.effect(() => () => {
      for (const d of disposers) { try { d() } catch (e) {} }
    })
    console.log('notes plugin: host ready, dir =', NOTES_DIR, ', llm =', !!llm, ', adm =', !!adm)
    // 心跳文件：自检验证 impl 真正加载成功（bootstrap 架构下 apply 异步完成）
    ;(async () => { try { const ft = await fs.resolve(PLUGIN_DIR + '\\.last-host-load'); await fs.writeText(ft, new Date().toISOString(), undefined, undefined, getPolicy()) } catch (e) {} })()
  }
}
