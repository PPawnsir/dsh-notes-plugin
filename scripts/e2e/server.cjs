'use strict'
/* e2e mock host：静态伺服 packages/dsh-notes-plugin/app.html + 最小 /dsh-notes RPC 内存实现。
 * 目的：让 app.html 脱离真实 DSH host 也能完整启动与交互（e2e 专用，不触真实笔记目录）。
 * RPC 口径与 host-impl.js 对齐的必要子集：notes-list/get/get-batch/create/update/delete/restore/purge/
 * search/folders/settings-get/set/usage-get/active-sessions/sessions/memory-guide/dispatch/export/history；
 * 其余返回 {ok:true}。数据存内存（种子 2 条笔记 + 1 个「工作日志」夹 + 1 条日志 + 1 个活跃会话），
 * 进程退出即弃——e2e 天然隔离、可重复。
 * 0.4.3② e2e 卡（notes-043-e2e-cases）扩展：folders 状态化 CRUD、软删/恢复/彻底删除、
 * dispatch-schedule 建块链路、notes-export 冒烟、kind=log 同权口径（0.4.3⑦：默认列表/搜索即含日志）。 */
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
    hidden: !!n.hidden,   /* 0.4.4-D：hidden 隐藏属性随 slim/get 下发（纯 UI 遮罩数据源，host 面零过滤） */
    contractType: n.contractType || '', schedule: n.schedule || undefined,
    deleted: !!n.deleted, dispatchStatus: n.dispatchStatus || '',
    sessionId: n.sessionId || '',
    /* 0.4.4-A：派发历史/执行记录跳转数据源（dispatches + 统一 runLog 软链 + refNote 回链） */
    dispatches: n.dispatches || [], runLog: n.runLog || '', refNote: n.refNote || '',
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
    /* kind=log 种子（挂在「工作日志」夹）：0.4.3⑦ 同权——默认列表/搜索即含（原隐身/includeLogs 定向召回口径已废） */
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
      /* kind=log 同权（0.4.3⑦）：默认列表即含日志（includeLogs 参数兼容 no-op） */
      /* 0.4.3⑨/⑩ sys 口径与 host _list 对齐：默认平铺排除 kind=sys；显式 kind/tag/具体文件夹入口放行（kind 真值短路 = 面板「机器」档通道） */
      const explicitEntry = !!(args && (args.kind || args.tag || (args.folder !== undefined && args.folder !== '')))
      if (!explicitEntry) list = list.filter(n => (n.kind || 'note') !== 'sys')
      if (args && args.kind) list = list.filter(n => (n.kind || 'note') === args.kind)
      if (args && args.tag) list = list.filter(n => (n.tags || []).indexOf(args.tag) >= 0)
      if (args && args.folder !== undefined) list = args.folder === '' ? list.filter(n => !(n.folder || '')) : list.filter(n => (n.folder || '') === args.folder)
      list.sort((a, b) => (b.pinned - a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      return { notes: list.map(slimNote) }
    }
    case 'notes-get': {
      const n = notes.find(x => x.id === (args && args.id) && ((args && args.includeDeleted) || !x.deleted))
      /* 0.4.4-A：补 dispatches/schedule/runLog/refNote（派发历史行 + 计划块 + open-by-id 直开执行记录的数据源）；contractType 一并带（计划块 isSched 判据） */
      return n ? { note: { id: n.id, title: n.title, body: n.body || '', topic: n.topic, tags: n.tags, status: n.status, kind: n.kind, folder: n.folder || '', hidden: !!n.hidden, dispatches: n.dispatches || [], contractType: n.contractType || '', schedule: n.schedule || undefined, runLog: n.runLog || '', refNote: n.refNote || '', inject: !!n.inject, createdAt: n.createdAt, updatedAt: n.updatedAt } } : { error: 'not found' }
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
        folder: a.folder || '', useCount: 0, sensitive: !!a.sensitive, hidden: !!a.hidden,
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
      for (const k of ['title', 'body', 'topic', 'tags', 'status', 'pinned', 'kind', 'folder', 'inject', 'injectRole', 'injectTo', 'recall', 'sensitive', 'hidden', 'contractType', 'schedule']) {
        if (k in a) n[k] = a[k]
      }
      n.updatedAt = nowIso()
      return { ok: true, note: slimNote(n) }
    }
    case 'notes-search': {
      const q = String((args && args.query != null ? args.query : (args && args.q) || '')).toLowerCase()
      return {
        notes: notes.filter(n => !n.deleted && (n.title + (n.body || '')).toLowerCase().indexOf(q) >= 0)
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
      /* 0.4.4-D：set-flags 显隐标记写入通道（{id, hidden}——true 落 / false 摘字段回缺省，与 host folders.js 同口径）；
         0.4.4-G：同通道扩 sys 键（两键独立——仅显式传入的键才触碰；sys:false 落显式 false 墓碑，与 host 懒迁移墓碑语义同口径） */
      if (a.op === 'set-flags') {
        const f = state.folders.find(x => x.id === a.id)
        if (!f) return { error: 'not found' }
        if (a.hidden !== undefined) { if (a.hidden === true) f.hidden = true; else delete f.hidden }
        if (a.sys !== undefined) { if (a.sys === true) f.sys = true; else f.sys = false }
        return { ok: true, id: f.id, hidden: f.hidden === true, sys: f.sys === true }
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
      /* 0.4.3⑩ 计数口径与 host 对齐（真实计数替代静态 0）：文件夹 count = 递归子树内全部非删除笔记（含 sys，与定向视图一致）；
         unfiled 与⑨「未分类」平铺同族——sys 不计入 */
      const direct = {}
      let unfiled = 0
      for (const n of notes) {
        if (n.deleted) continue
        const f = n.folder || ''
        if (f && state.folders.some(x => x.id === f)) direct[f] = (direct[f] || 0) + 1
        else if ((n.kind || 'note') !== 'sys') unfiled++
      }
      return {
        folders: state.folders.slice().sort((x, y) => x.order - y.order).map(f => {
          const sub = folderSubtreeIds(state, f.id)
          let count = 0
          for (const sid in sub) count += direct[sid] || 0
          return Object.assign({}, f, { count })
        }),
        unfiled,
      }
    }
    case 'notes-settings-get': return { settings: state.settings, modelsDir: '' }
    case 'notes-settings-set': { Object.assign(state.settings, (args && args.settings) || {}); return { ok: true } }
    case 'notes-usage-get': return { usage: {} }
    case 'notes-active-sessions': return { sessions: state.sessions.slice() }
    case 'notes-sessions': return { sessions: state.sessions.slice() }
    case 'notes-dispatch': {
      /* 0.4.4-A（notes-044-dispatch-receipts）最小对齐 host _dispatch 执行记录链路：登记 dispatches +
         懒创建执行记录伴生笔记（kind=log + 「执行记录」夹懒建 + refNote 回链 + 📤 派发行 + runLog 软链回写——
         调度笔记写 schedule.runLog / 普通笔记写顶层 runLog，与 host writeLink 同口径） */
      const n = notes.find(x => x.id === (args && args.id) && !x.deleted)
      if (!n) return { error: 'not found' }
      const rec = { sessionId: String((args && args.sessionId) || ''), sessionName: String((args && args.sessionName) || ''), workspace: String((args && args.workspace) || ''), mode: (args && args.mode) || 'existing', instruction: String((args && args.instruction) || ''), at: nowIso(), msgId: 'note-dispatch-e2e-' + (++idSeq), done: false, dispatchStatus: 'sent' }
      n.dispatches = (n.dispatches || []).concat([rec])
      let rl = notes.find(x => x.id === ((n.schedule && n.schedule.runLog) || n.runLog) && !x.deleted)
      if (!rl) {
        let fld = state.folders.find(f => f.name === '执行记录')
        if (!fld) { fld = { id: newId(), name: '执行记录', parent: '', order: state.folders.length, count: 0 }; state.folders.push(fld) }
        rl = {
          id: newId(), title: '执行记录 · ' + (n.title || n.id), body: '机器托管笔记（请勿手动清理，由派发管线维护）：e2e mock 说明块。\n\n## 执行记录（自动）\n', topic: n.topic || '',
          kind: 'log', tags: [], status: 'active', pinned: false, inject: false, injectRole: '', injectTo: [], recall: false, folder: fld.id, useCount: 0,
          contractType: '', refNote: n.id, dispatches: [], createdAt: nowIso(), updatedAt: nowIso(), deleted: false,
        }
        notes.push(rl)
        if (n.schedule) n.schedule.runLog = rl.id
        else n.runLog = rl.id
      }
      const line = '- 📤 ' + rec.at.slice(0, 19).replace('T', ' ') + ' · → ' + (rec.sessionName || rec.sessionId) + (rec.instruction ? ' · 指令：' + rec.instruction : '') + ' · 单号 ' + rec.msgId.replace('note-dispatch-', '')
      const rest = String(rl.body || '').split('\n').filter(l => /^- /.test(l))
      rl.body = '机器托管笔记（请勿手动清理，由派发管线维护）：e2e mock 说明块。\n\n## 执行记录（自动）\n\n' + [line].concat(rest).join('\n') + '\n'
      n.updatedAt = nowIso(); rl.updatedAt = nowIso()
      return { ok: true, id: n.id, sessionId: rec.sessionId, sessionName: rec.sessionName, dispatch: rec }
    }
    case 'notes-export': {
      const dir = String((args && args.dir) || '').trim()
      if (!dir) return { error: 'notes-export.dir 目录不能为空' }
      return { ok: true, exported: notes.filter(n => !n.deleted).length, target: dir }
    }
    case 'notes-history': return { versions: [] }
    case 'notes-ai-organize': {
      /* 0.4.4-F（notes-044-organize-instruct）：整理 mock——回显 instruction 供弹卡链路断言（留空 = '(无)'）；
         不做真实重写，仅在正文前加标记行（ok+body 契约与 host 对齐：不落盘，client 替换+自动保存） */
      const oiInstr = String((args && args.instruction) || '').trim()
      const oiBody = String((args && args.body) || '')
      if (!oiBody.trim()) return { error: '正文为空，无可整理内容' }
      return { ok: true, body: '## 已整理\n\n[指令:' + (oiInstr || '(无)') + ']\n\n' + oiBody + '\n', kind: (args && args.kind) || 'note' }
    }
    case 'notes-memory-guide': return { guide: '' }
    case 'notes-conflict-check': {
      /* 0.4.5-G（notes-045-conflict-check）约定体检 mock（契约同 host：{} → { ok, pairs:[{aId,bId,aTitle,bTitle,relation,reason}], total }）：
         数据集谓词同 host（inject=true && injectRole=convention && !deleted），<2 条空态零提名；
         演示收敛口径：已 superseded 的约定不再参与提名（裁决后重跑见空态闭环）；固定提名前两条活跃约定为「疑似冲突」对 */
      const conv = notes.filter(n => !n.deleted && n.inject === true && (n.injectRole || 'convention') === 'convention')
      if (conv.length < 2) return { ok: true, pairs: [], total: conv.length }
      const live = conv.filter(n => (n.status || 'active') !== 'superseded')
      if (live.length < 2) return { ok: true, pairs: [], total: conv.length }
      return { ok: true, total: conv.length, pairs: [{ aId: live[0].id, bId: live[1].id, aTitle: live[0].title, bTitle: live[1].title, relation: 'conflict', reason: 'e2e mock：两条约定对同一事项的指令互相矛盾（演示数据）。' }] }
    }
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
