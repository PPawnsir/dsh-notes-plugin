'use strict'
/* e2e mock host：静态伺服 packages/dsh-notes-plugin/app.html + 最小 /dsh-notes RPC 内存实现。
 * 目的：让 app.html 脱离真实 DSH host 也能完整启动与交互（e2e 专用，不触真实笔记目录）。
 * RPC 口径与 host-impl.js 对齐的必要子集：notes-list/get/get-batch/create/update/delete/restore/purge/
 * search/folders/settings-get/set/usage-get/active-sessions/sessions/memory-guide/dispatch/export/history；
 * 其余返回 {ok:true}。数据存内存（种子 2 条笔记 + 1 个「工作日志」夹 + 1 条日志 + 1 个活跃会话），
 * 进程退出即弃——e2e 天然隔离、可重复。
 * 0.4.3② e2e 卡（notes-043-e2e-cases）扩展：folders 状态化 CRUD、软删/恢复/彻底删除、
 * dispatch-schedule 建块链路、notes-export 冒烟、kind=log 默认隐身口径（includeLogs 才可见）。 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const APP_HTML = path.join(__dirname, '..', '..', 'packages', 'dsh-notes-plugin', 'app.html')

function nowIso() { return new Date().toISOString() }
let idSeq = 0
function newId() { return 'e2e-' + Date.now().toString(36) + '-' + (++idSeq) }

function slimNote(n) {
  return {
    id: n.id, title: n.title, kind: n.kind || 'note', topic: n.topic || '',
    tags: n.tags || [], status: n.status || 'active', pinned: !!n.pinned,
    inject: !!n.inject, injectRole: n.injectRole || '', injectEver: !!n.injectEver,
    injectTo: n.injectTo || [], recall: n.recall !== false,
    sensitive: !!n.sensitive, folder: n.folder || '', useCount: n.useCount || 0,
    contractType: n.contractType || '', schedule: n.schedule || undefined,
    deleted: !!n.deleted, dispatchStatus: n.dispatchStatus || '',
    sessionId: n.sessionId || '',
    createdAt: n.createdAt, updatedAt: n.updatedAt,
    preview: String(n.body || '').slice(0, 200),
  }
}

function createMockState() {
  const seed = (title, body, topic, extra) => Object.assign({
    id: newId(), title, body, topic, kind: 'note', tags: [], status: 'active',
    pinned: false, inject: false, injectRole: '', injectTo: [], recall: true, folder: '', useCount: 0,
    contractType: '', createdAt: nowIso(), updatedAt: nowIso(), deleted: false,
  }, extra || {})
  const notes = [
    seed('e2e 种子笔记 A', '种子正文 A（e2e mock 数据，仅内存）', 'e2e'),
    seed('e2e 种子笔记 B', '种子正文 B（e2e mock 数据，仅内存）', 'e2e'),
    /* kind=log 种子（挂在「工作日志」夹）：默认列表/搜索隐身，展开日志夹时 includeLogs 定向召回（notes-041c 口径） */
    seed('e2e 日志条目 · 沉淀样板', '## 做了什么\n\n种子日志正文', '', { kind: 'log', folder: 'f-log-e2e' }),
  ]
  const folders = [
    { id: 'f-log-e2e', name: '工作日志', parent: '', order: 0, count: 0 },
  ]
  const sessions = [
    { id: 'sess-e2e-0001', short: 'sess-e2e', name: 'e2e 模拟会话', workspace: 'e2e-workspace', live: true },
  ]
  const settings = {}
  return { notes, folders, sessions, settings }
}

function folderKids(state, parent) { return state.folders.filter(f => (f.parent || '') === (parent || '')) }
function folderSubtreeIds(state, fid) {
  const out = {}; out[fid] = true
  let grow = true
  while (grow) {
    grow = false
    for (const f of state.folders) if (!out[f.id] && out[f.parent || '']) { out[f.id] = true; grow = true }
  }
  return out
}

function handleRpc(state, method, args) {
  const notes = state.notes
  switch (method) {
    case 'notes-list': {
      let list = notes.slice()
      if (args && args.includeDeleted !== true) list = list.filter(n => !n.deleted)
      /* kind=log 隐身口径：默认列表不含日志，includeLogs 才返回（树懒加载 overlay 数据源） */
      if (!(args && args.includeLogs)) list = list.filter(n => (n.kind || 'note') !== 'log')
      list.sort((a, b) => (b.pinned - a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      return { notes: list.map(slimNote) }
    }
    case 'notes-get': {
      const n = notes.find(x => x.id === (args && args.id) && ((args && args.includeDeleted) || !x.deleted))
      return n ? { note: { id: n.id, title: n.title, body: n.body || '', topic: n.topic, tags: n.tags, status: n.status, kind: n.kind, folder: n.folder || '', createdAt: n.createdAt, updatedAt: n.updatedAt } } : { error: 'not found' }
    }
    case 'notes-get-batch': {
      const ids = (args && args.ids) || []
      return { notes: notes.filter(n => ids.indexOf(n.id) >= 0).map(n => ({ id: n.id, body: n.body || '', updatedAt: n.updatedAt })) }
    }
    case 'notes-create': {
      const a = args || {}
      const n = {
        id: newId(), title: a.title || 'Untitled', body: a.body || '', topic: a.topic || '',
        kind: a.kind || 'note', tags: a.tags || [], status: a.status || 'active', pinned: false,
        inject: !!a.inject, injectRole: a.injectRole || '', injectTo: a.injectTo || [], recall: a.recall !== false,
        folder: a.folder || '', useCount: 0, sensitive: !!a.sensitive,
        contractType: a.contractType || '', schedule: a.schedule || undefined,
        createdAt: nowIso(), updatedAt: nowIso(), deleted: false,
      }
      notes.push(n)
      return { id: n.id, note: slimNote(n) }
    }
    case 'notes-update': {
      const n = notes.find(x => x.id === (args && args.id) && !x.deleted)
      if (!n) return { error: 'not found' }
      const a = args || {}
      for (const k of ['title', 'body', 'topic', 'tags', 'status', 'pinned', 'kind', 'folder', 'inject', 'injectRole', 'injectTo', 'recall', 'sensitive', 'contractType', 'schedule']) {
        if (k in a) n[k] = a[k]
      }
      n.updatedAt = nowIso()
      return { ok: true, note: slimNote(n) }
    }
    case 'notes-search': {
      const q = String((args && args.query != null ? args.query : (args && args.q) || '')).toLowerCase()
      return {
        notes: notes.filter(n => !n.deleted && (n.kind || 'note') !== 'log' && (n.title + (n.body || '')).toLowerCase().indexOf(q) >= 0)
          .map(n => Object.assign(slimNote(n), { matches: [n.title.toLowerCase().indexOf(q) >= 0 ? 'title' : 'body'] })),
      }
    }
    case 'notes-delete': {
      const n = notes.find(x => x.id === (args && args.id) && !x.deleted)
      if (!n) return { error: 'not found' }
      n.deleted = true
      n.updatedAt = nowIso()
      return { ok: true }
    }
    case 'notes-restore': {
      const n = notes.find(x => x.id === (args && args.id) && x.deleted)
      if (!n) return { error: 'not found' }
      n.deleted = false
      n.updatedAt = nowIso()
      return { ok: true }
    }
    case 'notes-purge': {
      const i = notes.findIndex(x => x.id === (args && args.id) && x.deleted)
      if (i < 0) return { error: 'not found' }
      notes.splice(i, 1)
      return { ok: true }
    }
    case 'notes-folders': {
      const a = args || {}
      if (a.op === 'create') {
        const f = { id: newId(), name: String(a.name || '').trim(), parent: a.parent || '', order: state.folders.length, count: 0 }
        state.folders.push(f)
        return { folder: f }
      }
      if (a.op === 'rename') {
        const f = state.folders.find(x => x.id === a.id)
        if (!f) return { error: 'not found' }
        f.name = String(a.name || '').trim()
        return { ok: true }
      }
      if (a.op === 'delete') {
        const sub = folderSubtreeIds(state, a.id)
        state.folders = state.folders.filter(x => !sub[x.id])
        notes.forEach(n => { if (sub[n.folder || '']) n.folder = '' })
        return { ok: true }
      }
      if (a.op === 'reorder') {
        const ids = a.ids || []
        state.folders.sort((x, y) => {
          const ix = ids.indexOf(x.id), iy = ids.indexOf(y.id)
          return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy)
        })
        ;(a.parents || []).forEach((p, i) => { const f = state.folders[i]; if (f) f.parent = p || '' })
        return { ok: true }
      }
      return { folders: state.folders.slice() }
    }
    case 'notes-settings-get': return { settings: state.settings, modelsDir: '' }
    case 'notes-settings-set': { Object.assign(state.settings, (args && args.settings) || {}); return { ok: true } }
    case 'notes-usage-get': return { usage: {} }
    case 'notes-active-sessions': return { sessions: state.sessions.slice() }
    case 'notes-sessions': return { sessions: state.sessions.slice() }
    case 'notes-dispatch': return { ok: true }
    case 'notes-export': {
      const dir = String((args && args.dir) || '').trim()
      if (!dir) return { error: 'notes-export.dir 目录不能为空' }
      return { ok: true, exported: notes.filter(n => !n.deleted).length, target: dir }
    }
    case 'notes-history': return { versions: [] }
    case 'notes-memory-guide': return { guide: '' }
    case 'notes-ping': return { ok: true }
    default: return { ok: true }
  }
}

function startServer(port) {
  const state = createMockState()
  const appHtml = fs.readFileSync(APP_HTML)
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/dsh-notes') {
        let buf = ''
        req.on('data', c => { buf += c })
        req.on('end', () => {
          let out
          try {
            const req2 = JSON.parse(buf || '{}')
            out = handleRpc(state, req2.method, req2.args)
          } catch (e) { out = { error: String(e && e.message || e) } }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(out))
        })
        return
      }
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html' || req.url === '/app.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(appHtml)
        return
      }
      if (req.method === 'GET' && req.url === '/favicon.ico') {
        res.writeHead(204); res.end(); return
      }
      console.error('[e2e-server] 404: ' + req.method + ' ' + req.url)
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => resolve({ server, state, port: server.address().port }))
  })
}

module.exports = { startServer, handleRpc, createMockState }

if (require.main === module) {
  startServer(Number(process.env.E2E_PORT) || 0).then(({ port }) => {
    console.log('[e2e-server] http://127.0.0.1:' + port + '/  (Ctrl+C 停止)')
  }).catch(e => { console.error(e); process.exit(1) })
}
