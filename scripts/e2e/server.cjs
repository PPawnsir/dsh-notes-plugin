'use strict'
/* e2e mock host：静态伺服 packages/dsh-notes-plugin/app.html + 最小 /dsh-notes RPC 内存实现。
 * 目的：让 app.html 脱离真实 DSH host 也能完整启动与交互（e2e 专用，不触真实笔记目录）。
 * RPC 口径与 host-impl.js 对齐的必要子集：notes-list/get/get-batch/create/update/delete/restore/purge/
 * search/folders/settings-get/set/usage-get/active-sessions/sessions/workspaces/memory-guide/dispatch/dispatch-done/
 * export/history/suggest/mount/mount-list/recall-stats/conflict-check/ai-organize/ping；其余返回 {ok:true}。
 * 数据存内存（种子 2 条笔记 + 1 个「工作日志」夹 + 1 条日志 + 1 个活跃会话），进程退出即弃——e2e 天然隔离、可重复。
 * 0.4.3② e2e 卡（notes-043-e2e-cases）扩展：folders 状态化 CRUD、软删/恢复/彻底删除、
 * dispatch-schedule 建块链路、notes-export 冒烟、kind=log 同权口径（0.4.3⑦：默认列表/搜索即含日志）。
 *
 * == 契约边界（0.4.8 notes-048-mock-contract-audit；常驻闸 = check/sections/113-mock-contract.cjs）==
 * 必须一致（闸守）：envelope/嵌套条目键集、过滤语义（deleted/sys 缺省降噪/kind/tag/folder 递归子树口径）、
 *   错误形态（{error:string} 键 + needCascade 等结构化错误键）、写入校验闸的存在性（空名/缺参/未知 op 拒绝）。
 * 允许简化（节 113 豁免清单显式登记）：数据内容（计数/时间戳/正文/id 取值）/排序细节/错误文案措辞/LLM 产出/
 *   宿主服务透传键（permissionPresets、会话标题后台补齐三键）/性能与缓存机制/schedule 声明写闸。
 * 红线：mock 不是宿主复制品——只守契约点；漂移修复只改 mock/e2e 侧，真宿主零改动；
 *   host 新增 RPC 时本文件三选一：实现 / 缺省 {ok:true} 直通并在节 113 豁免清单登记 / 面板 harness 特判。 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const APP_HTML = path.join(__dirname, '..', '..', 'packages', 'dsh-notes-plugin', 'app.html')

function nowIso() { return new Date().toISOString() }
let idSeq = 0
function newId() { return 'e2e-' + Date.now().toString(36) + '-' + (++idSeq) }

/* 0.4.8 契约对账（节 113）：slim 键集逐键对齐 host kernel/persist.js slim()——
 * 去 pinned 布尔（host 无此键：置顶 = status:'pinned'）与顶层 dispatchStatus（host 只发 dispatches 数组，状态机在条目内）；
 * 补 workspace/cwd/logDate/entities/summarizedAt/origin/mergedFrom/archivedAt；schedule 缺省 null（host 口径，wire 恒带键）；
 * injectRole 缺省归一 'convention'（host slim 同口径）；injectEver 粘性公式同 host（旧值 || inject）。 */
function slimNote(n) {
  return {
    id: n.id, title: n.title, topic: n.topic, workspace: n.workspace || '', folder: n.folder || '',
    tags: n.tags || [], kind: n.kind || 'note', status: n.status || 'active',
    inject: n.inject === true, injectEver: n.injectEver === true || n.inject === true,
    injectTo: n.injectTo || [], injectRole: n.injectRole === 'reference' ? 'reference' : 'convention',
    recall: n.recall !== false, sensitive: n.sensitive === true,
    hidden: n.hidden === true,   /* 0.4.4-D：hidden 隐藏属性随 slim/get 下发（纯 UI 遮罩数据源，host 面零过滤） */
    createdAt: n.createdAt, updatedAt: n.updatedAt,
    sessionId: n.sessionId || '', cwd: n.cwd || '', logDate: n.logDate || '', entities: n.entities || [],
    summarizedAt: n.summarizedAt || '', contractType: n.contractType || '', origin: n.origin || '',
    schedule: n.schedule || null, mergedFrom: n.mergedFrom || [],
    /* 0.4.4-A：派发历史/执行记录跳转数据源（dispatches + 统一 runLog 软链 + refNote 回链） */
    dispatches: n.dispatches || [], runLog: n.runLog || '', refNote: n.refNote || '',
    useCount: n.useCount || 0, archivedAt: n.archivedAt || '',
    deleted: n.deleted === true, preview: String(n.body || '').slice(0, 200),
  }
}

function createMockState() {
  /* 0.4.8 契约对账（节 113）：种子字段集对齐 host _create 落库字段（slim 全键集有源）；
     移除 pinned 布尔（host 无此字段，置顶 = status:'pinned'）；log 种子 recall:false（host kind=log 缺省口径） */
  const seed = (title, body, topic, extra) => Object.assign({
    id: newId(), title, body, topic, kind: 'note', tags: [], status: 'active',
    inject: false, injectEver: false, injectRole: 'convention', injectTo: [], recall: true, sensitive: false, hidden: false,
    workspace: 'e2e-workspace', folder: '', sessionId: '', cwd: '', logDate: '', entities: [], summarizedAt: '',
    contractType: '', origin: '', schedule: undefined, mergedFrom: [], dispatches: [], refNote: '', runLog: '',
    useCount: 0, archivedAt: '', createdAt: nowIso(), updatedAt: nowIso(), deleted: false,
  }, extra || {})
  const notes = [
    seed('e2e 种子笔记 A', '种子正文 A（e2e mock 数据，仅内存）', 'e2e'),
    seed('e2e 种子笔记 B', '种子正文 B（e2e mock 数据，仅内存）', 'e2e'),
    /* kind=log 种子（挂在「工作日志」夹）：0.4.3⑦ 同权——默认列表/搜索即含（原隐身/includeLogs 定向召回口径已废） */
    seed('e2e 日志条目 · 沉淀样板', '## 做了什么\n\n种子日志正文', '', { kind: 'log', folder: 'f-log-e2e', recall: false, logDate: nowIso().slice(0, 10) }),
  ]
  const folders = [
    { id: 'f-log-e2e', name: '工作日志', parent: '', order: 0, count: 0 },
  ]
  /* 会话条目键集对齐 host _activeSessions 输出（{id,short,name,cwd,workspace,live[,createdAt]}） */
  const sessions = [
    { id: 'sess-e2e-0001', short: 'sess-e2e', name: 'e2e 模拟会话', cwd: '', workspace: 'e2e-workspace', live: true },
  ]
  /* 工作区清单（notes-workspaces 数据源，host {id,title,cwd} 口径） */
  const workspaces = [
    { id: 'ws-e2e', title: 'e2e-workspace', cwd: '' },
  ]
  /* 0.4.8 契约对账：host 启动 ensure 注入索引根笔记即落 settings.indexNoteId（check 节 79 创建级锁口径）——
     mock 预置同键占位值（与 notes-mount/mount-list 的占位索引 id 一致），settings-get/set 回显键集与 host 持平 */
  const settings = { indexNoteId: 'e2e-inject-index' }
  return { notes, folders, sessions, workspaces, settings }
}

function folderSubtreeIds(state, fid) {
  const out = {}; out[fid] = true
  let grow = true
  while (grow) {
    grow = false
    for (const f of state.folders) if (!out[f.id] && out[f.parent || '']) { out[f.id] = true; grow = true }
  }
  return out
}
/* 0.4.8 契约对账（节 113）：以下三函数为 host folders.js folder-tree-helpers 的 mock 侧同口径实现
   （纯函数、数据全经入参——mock 只守契约点：过滤/计数/校验语义，零持久化零迁移管线） */
function folderDepth(state, id) {
  const byId = {}; for (const f of state.folders) byId[f.id] = f
  let d = 0, cur = id
  const seen = {}
  while (cur && byId[cur] && !seen[cur]) { seen[cur] = true; d++; cur = byId[cur].parent }
  return d
}
function folderSubtreeHeight(state, id, seen) {
  seen = seen || {}
  if (seen[id]) return 0
  seen[id] = true
  let h = 1
  for (const f of state.folders) if (f.parent === id) { const kh = folderSubtreeHeight(state, f.id, seen) + 1; if (kh > h) h = kh }
  return h
}
/* 挂载校验（create/reorder 拖父级共用）：parent 存在性 → cycle → 深度上限（maxDepth=0 不限）；null = 通过，否则中文错误串（与 host 同文案——错误文案本可豁免，本处顺手对齐） */
function checkFolderAttach(state, selfId, parentId, maxDepth) {
  if (!state.folders.some(x => x.id === parentId)) return '父文件夹不存在: ' + parentId
  if (selfId) {
    if (parentId === selfId) return '文件夹不能挂到自己下面'
    if (folderSubtreeIds(state, selfId)[parentId]) return '文件夹不能挂到自己的子孙文件夹下面（cycle）'
  }
  if (maxDepth > 0) {
    const d = folderDepth(state, parentId) + (selfId ? folderSubtreeHeight(state, selfId) : 1)
    if (d > maxDepth) return '超过文件夹嵌套深度上限 maxFolderDepth=' + maxDepth + '（挂载后深度 ' + d + '；可在设置中调大或置 0 不限）'
  }
  return null
}
/* 有效文件夹（host effectiveFolder 同口径）：folder 指向清单外 id 的笔记按未分类对待（计数/过滤/级联一致） */
function effectiveFolder(state, n) {
  const f = (n && n.folder) || ''
  if (!f) return ''
  return state.folders.some(x => x.id === f) ? f : ''
}
/* folder 写入归一（host _resolveFolderArg 同口径）：id 精确命中 → 名称命中 → 否则 null（调用方整体拒绝不落库）；'' = 未分类 */
function resolveFolderArg(state, v) {
  const r = String(v == null ? '' : v).trim()
  if (!r) return { id: '' }
  const byId = state.folders.find(x => x.id === r)
  if (byId) return { id: byId.id }
  const byName = state.folders.find(x => x.name === r)
  if (byName) return { id: byName.id }
  return null
}
function maxFolderDepthLimit(state) {
  const v = state.settings && state.settings.maxFolderDepth
  return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.floor(v) : 3
}

/* 0.5.0①（notes-050-vector-layer）：向量层 mock——与 host vector-store 同契约（响应形状 + 过滤语义 + deterministic 假 embedder 桩）。
 * 只守契约点：status/rebuild/search 三面形状与 host 一致；bodyHash 不落盘（数据内容豁免）；向量状态存 state._vectors。 */
const VECTOR_BACKENDS = { 'fake-256': { id: 'fake-256', dim: 256, minScore: 0 }, 'fake-64': { id: 'fake-64', dim: 64, minScore: 0.9 }, 'bge-small-zh-q8': { id: 'bge-small-zh-q8', dim: 512, minScore: 0.5 } }
function vectorFnv1a(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0; return h }
function vectorMulberry32(seed) { let s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function vectorEmbedOne(text, dim) { const rnd = vectorMulberry32(vectorFnv1a(String(text == null ? '' : text))); const v = new Array(dim); let sq = 0; for (let i = 0; i < dim; i++) { const x = rnd() * 2 - 1; v[i] = x; sq += x * x } const n = Math.sqrt(sq) || 1; for (let i = 0; i < dim; i++) v[i] = v[i] / n; return v }
function vectorChunks(body) { const s = String(body == null ? '' : body); const MAX = 1800; const out = []; if (!s) return out; if (s.length <= MAX) return [s]; const lines = s.split(/\r?\n/); let cur = ''; const flush = function () { if (cur) out.push(cur); cur = '' }; for (let i = 0; i < lines.length; i++) { let line = lines[i]; if (line.length > MAX) { flush(); while (line.length > MAX) { out.push(line.slice(0, MAX)); line = line.slice(MAX) }; if (line) cur = line; continue } if (cur.length === 0) { cur = line; continue } if (cur.length + 1 + line.length > MAX) { flush(); cur = line; continue } cur = cur + '\n' + line } flush(); return out }
function vectorIndexable(n) { return !!(n && n.id && n.deleted !== true && n.sensitive !== true && n.kind !== 'sys') }
function vectorCosine(a, b) { if (!a || !b || !a.length || !b.length) return 0; const n = Math.min(a.length, b.length); let dot = 0, na = 0, nb = 0; for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] } const den = Math.sqrt(na) * Math.sqrt(nb); return den > 0 ? dot / den : 0 }
function vectorNs(state) { if (!state._vectors) state._vectors = { ns: {} }; return state._vectors }
function vectorNsCount(ns) { let n = 0; for (const id of Object.keys(ns.rows || {})) { if (ns.rows[id] && ns.rows[id].length) n++ } return n }
function vectorActiveBackendId(state) { return (state.settings && state.settings.semantic && state.settings.semantic.enabled === true) ? (state.settings.semantic.backend || 'fake-256') : null }
/* 0.5.0③（notes-050-rrf-fusion）：全命名空间出队通道（与 host _vectorDropNote 同契约）——sensitive 翻转/软删/彻底删除时，
   从所有后端命名空间移除该笔记向量，残留集不泄漏敏感向量（敏感永不进语义通道在残留面也守）。 */
function vectorDropNote(state, noteId) {
  const vs = vectorNs(state)
  let changed = false
  for (const bid of Object.keys(vs.ns || {})) {
    const ns = vs.ns[bid]
    if (ns && ns.rows && (ns.rows[noteId] || ns.hash && ns.hash[noteId])) { delete ns.rows[noteId]; delete ns.hash[noteId]; changed = true }
  }
  return changed
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
      /* 0.4.8 契约对账：folder 过滤对齐 host 递归子树口径（非空 id = 该夹及全部子孙夹内笔记；'' = 未分类；
         悬空 folder 引用经 effectiveFolder 归未分类——与计数/级联同一谓词） */
      if (args && args.folder !== undefined) {
        if (args.folder === '') list = list.filter(n => effectiveFolder(state, n) === '')
        else { const sub = folderSubtreeIds(state, args.folder); list = list.filter(n => !!sub[effectiveFolder(state, n)]) }
      }
      /* 置顶（status:'pinned'）优先 + 更新时间降序（host _list 同口径；排序细节本属豁免面，顺手对齐） */
      list.sort((a, b) => ((b.status === 'pinned') - (a.status === 'pinned')) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      return { notes: list.map(slimNote) }
    }
    case 'notes-get': {
      const n = notes.find(x => x.id === (args && args.id) && ((args && args.includeDeleted) || !x.deleted))
      /* 0.4.8 契约对账：note = slim 全键集 + body（host 口径 slim(n)+body；含 dispatches/schedule/runLog/refNote/contractType——
         派发历史行 + 计划块 + open-by-id 直开执行记录的数据源）。错误形态 {error:string} 同 host（文案豁免）。 */
      return n ? { note: Object.assign(slimNote(n), { body: n.body || '' }) } : { error: 'not found' }
    }
    case 'notes-get-batch': {
      /* 0.4.8 契约对账：补 missing 键（host 口径——已删/墓碑/不存在计入 missing 不报错，调用方按缺口径重试） */
      const ids = (args && Array.isArray(args.ids)) ? args.ids : []
      const found = [], missing = []
      for (const id of ids) {
        const n = notes.find(x => x.id === id && !x.deleted)
        if (n) found.push({ id: n.id, body: n.body || '', updatedAt: n.updatedAt })
        else missing.push(id)
      }
      return { notes: found, missing: missing }
    }
    case 'notes-create': {
      const a = args || {}
      const kind = a.kind || 'note'
      /* folder 写入归一 + 非法显式拒绝（host folder-arg-norm 同口径：名称→id；未知值整体报错不落库） */
      let folder = ''
      if (a.folder !== undefined && a.folder !== '') {
        const rf = resolveFolderArg(state, a.folder)
        if (!rf) return { error: 'folder 未知文件夹 id 或名称：' + String(a.folder) }
        folder = rf.id
      }
      /* kind=log 隐身硬闸（host 同口径）：inject 强制 false + injectForcedOff 回执告知；log/sys recall 缺省 false */
      const injectForcedOff = kind === 'log' && a.inject === true
      const n = {
        id: newId(), title: a.title || 'Untitled', body: a.body || '', topic: a.topic || '未分类',
        workspace: 'e2e-workspace', folder: folder, tags: a.tags || [],
        kind: kind, status: a.status || 'active',
        inject: kind === 'log' ? false : a.inject === true,
        injectEver: kind === 'log' ? false : a.inject === true,
        injectRole: a.injectRole === 'reference' ? 'reference' : 'convention', injectTo: a.injectTo || [],
        recall: (kind === 'log' || kind === 'sys') ? a.recall === true : a.recall !== false,
        useCount: 0, sensitive: !!a.sensitive, hidden: !!a.hidden,
        contractType: a.contractType || '', origin: '', schedule: a.schedule || undefined,
        mergedFrom: [], dispatches: [], refNote: '', runLog: '', archivedAt: '',
        /* schedule/contractType 声明校验闸豁免（节 113 登记）：mock 直通存储，host 红线校验由 check 节 48/59 看守 */
        /* 0.4.7-B（用例㊱/㊲）：sessionId 透传（host 真实场景 quick/速记落库即带会话来源）——驱动 meta「来源」动作进溢出菜单演习面 */
        sessionId: typeof a.sessionId === 'string' ? a.sessionId : '',
        cwd: '', logDate: a.logDate || (kind === 'log' ? nowIso().slice(0, 10) : ''), entities: [], summarizedAt: '',
        createdAt: nowIso(), updatedAt: nowIso(), deleted: false,
      }
      notes.push(n)
      /* 0.4.8 契约对账：响应键集对齐 host _create（{id,topic,title,kind,status} + 条件键 injectForcedOff）；
         旧形 {id, note} 是漂移（host 从未回传 note 回显）——消费方（app/client newnote 链路）只读 res.id，真实宿主口径 */
      const r = { id: n.id, topic: n.topic, title: n.title, kind: n.kind, status: n.status }
      if (injectForcedOff) r.injectForcedOff = true
      /* sensitiveSuggested 豁免：mock 不做敏感模式识别（host 命中才带键；fixture 语料不触发） */
      return r
    }
    case 'notes-update': {
      const n = notes.find(x => x.id === (args && args.id) && !x.deleted)
      if (!n) return { error: 'not found' }
      const a = args || {}
      /* R-1 空正文覆盖闸（host 同口径）：body:'' 覆盖非空正文需显式 confirmClearBody:true，否则结构化拒绝 */
      if (a.body === '' && n.body && a.confirmClearBody !== true) {
        return { error: 'notes-update 拒绝执行：body 为空串将覆盖现有非空正文（R-1 数据丢失防护）。如确认为有意清空，请显式传 confirmClearBody: true 重试' }
      }
      /* folder 写入归一 + 非法显式拒绝（同 create 闸） */
      if (a.folder !== undefined && a.folder !== '') {
        const rf = resolveFolderArg(state, a.folder)
        if (!rf) return { error: 'folder 未知文件夹 id 或名称：' + String(a.folder) }
        n.folder = rf.id
      } else if (a.folder === '') n.folder = ''
      const effKind = (a.kind !== undefined ? a.kind : n.kind) || 'note'
      /* 隐身硬闸（host 三轮补闸同口径）：生效 kind=log 时 inject 无条件强制 false + injectForcedOff 回执；
         inject 显式置 true 拉起 injectEver（单向粘性，置 false/不传不回退） */
      let injectForcedOff = false
      if (a.inject !== undefined) {
        if (effKind === 'log' && a.inject === true) { n.inject = false; injectForcedOff = true }
        else { n.inject = a.inject === true; if (a.inject === true) n.injectEver = true }
      }
      if (effKind === 'log' && n.inject !== false) { n.inject = false; injectForcedOff = true }
      for (const k of ['title', 'body', 'topic', 'tags', 'status', 'kind', 'injectTo', 'sensitive', 'hidden', 'contractType', 'schedule']) {
        if (k in a) n[k] = a[k]
      }
      /* 0.5.0③（notes-050-rrf-fusion）：sensitive 翻转 → 全命名空间出队（残留集不泄漏敏感向量） */
      if (n.sensitive === true) vectorDropNote(state, n.id)
      if (a.recall !== undefined) n.recall = a.recall !== false
      if (a.injectRole !== undefined) n.injectRole = a.injectRole === 'reference' ? 'reference' : 'convention'
      /* 保底联动（host _update 同口径）：显式置 resolved → 全部未闭环派发翻 done（dispatchStatus/doneAt/receipt），回执计数随响应 */
      let dispatchClosed = 0
      if (a.status === 'resolved') {
        for (const rec of (n.dispatches || [])) {
          if (rec.dispatchStatus === 'done') continue
          rec.done = true; rec.dispatchStatus = 'done'; rec.doneAt = nowIso(); rec.receipt = 'resolved'
          dispatchClosed++
        }
      }
      n.updatedAt = nowIso()
      /* 0.4.8 契约对账：响应键集对齐 host _update（{id,kind,status,dispatchClosed} + 条件键 injectForcedOff）；
         旧形 {ok, note} 是漂移（host 无 ok 键、不回传 note）——消费方只读 res.error，真实宿主口径 */
      const r = { id: n.id, kind: n.kind, status: n.status, dispatchClosed: dispatchClosed }
      if (injectForcedOff) r.injectForcedOff = true
      return r
    }
    case 'notes-search': {
      /* 0.4.8 契约对账：过滤管线对齐 host _search——sys 缺省降噪（显式 kind/tag/具体文件夹入口放行）+
         kind/tag/topic/folder（递归子树）过滤 + sensitive/inject 三态组合过滤；haystack 含 topic/tags（host 同口径）；
         matches 命中字段三档（title/tags/body；topic-only 命中 = 空数组，host searchMatchFields 同口径） */
      const a = args || {}
      const q = String(a.query != null ? a.query : (a.q || '')).toLowerCase()
      const explicitEntry = !!(a.kind || a.tag || (a.folder !== undefined && a.folder !== ''))
      let list = notes.filter(n => !n.deleted)
      if (!explicitEntry) list = list.filter(n => (n.kind || 'note') !== 'sys')
      if (a.tag) list = list.filter(n => (n.tags || []).indexOf(a.tag) >= 0)
      if (a.topic) list = list.filter(n => n.topic === a.topic)
      if (a.kind) list = list.filter(n => (n.kind || 'note') === a.kind)
      if (a.folder !== undefined) {
        if (a.folder === '') list = list.filter(n => effectiveFolder(state, n) === '')
        else { const sub = folderSubtreeIds(state, a.folder); list = list.filter(n => !!sub[effectiveFolder(state, n)]) }
      }
      if (a.sensitive === true) list = list.filter(n => n.sensitive === true)
      if (a.sensitive === false) list = list.filter(n => n.sensitive !== true)
      if (a.inject === true) list = list.filter(n => n.inject === true)
      if (a.inject === false) list = list.filter(n => n.inject !== true)
      if (q) {
        list = list.filter(n => ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0)
      }
      list.sort((x, y) => ((y.status === 'pinned') - (x.status === 'pinned')) || String(y.updatedAt).localeCompare(String(x.updatedAt)))
      return {
        notes: list.map(n => {
          const s = slimNote(n)
          if (q) {
            const matches = []
            if ((n.title || '').toLowerCase().indexOf(q) >= 0) matches.push('title')
            if ((n.tags || []).join(' ').toLowerCase().indexOf(q) >= 0) matches.push('tags')
            if ((n.body || '').toLowerCase().indexOf(q) >= 0) matches.push('body')
            s.matches = matches
          }
          return s
        }),
      }
    }
    case 'notes-delete': {
      /* 0.4.8 契约对账：响应键集对齐 host _delete（{id}——host 无 ok 键）；消费方只读 res.error */
      const n = notes.find(x => x.id === (args && args.id) && !x.deleted)
      if (!n) return { error: 'not found' }
      n.deleted = true
      n.updatedAt = nowIso()
      vectorDropNote(state, n.id)   /* 0.5.0③：软删全命名空间出队 */
      return { id: n.id }
    }
    case 'notes-restore': {
      const n = notes.find(x => x.id === (args && args.id) && x.deleted)
      if (!n) return { error: 'not found' }
      n.deleted = false
      n.updatedAt = nowIso()
      return { id: n.id }
    }
    case 'notes-purge': {
      /* 0.4.8 契约对账：响应键集对齐 host _purge（{id,purged,mode,historyPurged}）；安全闸同 host（仅限已软删） */
      const i = notes.findIndex(x => x.id === (args && args.id))
      if (i < 0) return { error: 'not found' }
      if (!notes[i].deleted) return { error: '笔记未删除：彻底删除请先移入回收站（软删除）' }
      notes.splice(i, 1)
      vectorDropNote(state, (args && args.id))   /* 0.5.0③：彻底删除全命名空间出队 */
      return { id: (args && args.id), purged: true, mode: 'mem', historyPurged: 0 }
    }
    case 'notes-folders': {
      /* 0.4.8 契约对账（节 113）：逐 op 对齐 host folders.js _folders——响应键集/校验闸/错误形态全对齐：
         list {folders[{id,name,order,parent,depth,count,hidden,sys}], unfiled} / create {ok,folder}（缺 name/父夹非法拒绝）/
         rename {ok,id,name} / set-flags {ok,id,hidden,sys} / delete 缺省 needCascade 拒绝 + cascade 软删子树笔记 /
         reorder {ok,folders}（parents 为 {fid:parent} 映射——旧 mock 误读为数组是漂移）/ 未知 op 结构化错误 */
      const a = args || {}
      const op = a.op || 'list'
      if (op === 'create') {
        const name = String(a.name || '').trim()
        if (!name) return { error: 'notes-folders.create 需要 name' }
        let parent = ''
        if (a.parent) {
          parent = String(a.parent)
          const attachErr = checkFolderAttach(state, null, parent, maxFolderDepthLimit(state))
          if (attachErr) return { error: 'notes-folders.create ' + attachErr }
        }
        const maxOrder = state.folders.reduce((m, f) => Math.max(m, f.order || 0), -1)
        const f = { id: newId(), name: name, order: maxOrder + 1 }
        if (parent) f.parent = parent
        if (a.sys === true) f.sys = true   /* 0.4.4-G：机器属性创建直入（与 host 同口径） */
        state.folders.push(f)
        /* 响应 folder = 落库对象浅拷（条件键同 host：parent 仅非根级带、sys 仅 true 带——wire 键集逐键一致） */
        return { ok: true, folder: Object.assign({}, f) }
      }
      if (a.op === 'rename') {
        if (!a.id) return { error: 'notes-folders.rename 需要 id' }
        const name = String(a.name || '').trim()
        if (!name) return { error: 'notes-folders.rename 需要 name' }
        const f = state.folders.find(x => x.id === a.id)
        if (!f) return { error: '文件夹不存在: ' + a.id }
        f.name = name
        return { ok: true, id: f.id, name: f.name }
      }
      /* 0.4.4-D：set-flags 显隐标记写入通道（{id, hidden}——true 落 / false 摘字段回缺省，与 host folders.js 同口径）；
         0.4.4-G：同通道扩 sys 键（两键独立——仅显式传入的键才触碰；sys:false 落显式 false 墓碑，与 host 懒迁移墓碑语义同口径） */
      if (a.op === 'set-flags') {
        if (!a.id) return { error: 'notes-folders.set-flags 需要 id' }
        const f = state.folders.find(x => x.id === a.id)
        if (!f) return { error: '文件夹不存在: ' + a.id }
        if (a.hidden !== undefined) { if (a.hidden === true) f.hidden = true; else delete f.hidden }
        if (a.sys !== undefined) { if (a.sys === true) f.sys = true; else f.sys = false }
        return { ok: true, id: f.id, hidden: f.hidden === true, sys: f.sys === true }
      }
      if (a.op === 'delete') {
        /* 级联语义对齐 host：缺省拒绝含子内容（子孙夹/子树笔记）的删除（needCascade 结构化错误）；
           cascade:true = 整棵子树夹出清单 + 其下笔记逐条软删进回收站（旧 mock「移出文件夹」是漂移——host 实为软删可恢复）；
           计数口径同 host：子树笔记经平铺 _list 同族口径统计（kind=sys 不计入不删除） */
        if (!a.id) return { error: 'notes-folders.delete 需要 id' }
        const target = state.folders.find(x => x.id === a.id)
        if (!target) return { error: '文件夹不存在: ' + a.id }
        const sub = folderSubtreeIds(state, a.id)
        const childFolders = state.folders.filter(f => f.id !== a.id && sub[f.id]).length
        const notesInSubtree = notes.filter(n => !n.deleted && (n.kind || 'note') !== 'sys' && sub[effectiveFolder(state, n)])
        if ((childFolders > 0 || notesInSubtree.length > 0) && a.cascade !== true) {
          return { error: 'notes-folders.delete 拒绝：文件夹「' + target.name + '」含子内容（子文件夹 ' + childFolders + ' 个 / 笔记 ' + notesInSubtree.length + ' 条），删除需显式传 cascade: true——文件夹结构整棵删除不可恢复，其下笔记软删除进回收站可恢复', needCascade: true, childFolders: childFolders, notes: notesInSubtree.length }
        }
        for (const n of notesInSubtree) { n.deleted = true; n.updatedAt = nowIso() }
        state.folders = state.folders.filter(x => !sub[x.id])
        return { ok: true, id: a.id, folders: childFolders + 1, notes: notesInSubtree.length }
      }
      if (a.op === 'reorder') {
        /* parents 映射 {folderId: parentId|''}（host 口径；旧 mock 按数组下标应用是漂移）——逐个校验存在性/cycle/深度后应用；
           '' = 回根级（摘 parent 字段）；入列按 ids 序 + 未入列保持原相对顺序追加，order 归一 0..n-1 */
        if (!Array.isArray(a.ids)) return { error: 'notes-folders.reorder 需要 ids 数组' }
        const ids = a.ids.map(String)
        const rank = {}
        ids.forEach((id, i) => { rank[id] = i })
        if (a.parents && typeof a.parents === 'object') {
          const maxDepth = maxFolderDepthLimit(state)
          const byId = {}
          for (const f of state.folders) byId[f.id] = f
          for (const fid of Object.keys(a.parents)) {
            if (!byId[fid]) return { error: 'notes-folders.reorder 文件夹不存在: ' + fid }
            const np = a.parents[fid] ? String(a.parents[fid]) : ''
            if (np) {
              const attachErr = checkFolderAttach(state, fid, np, maxDepth)
              if (attachErr) return { error: 'notes-folders.reorder ' + attachErr }
              byId[fid].parent = np
            } else delete byId[fid].parent
          }
        }
        const inList = state.folders.filter(f => rank[f.id] !== undefined).sort((x, y) => rank[x.id] - rank[y.id])
        const outList = state.folders.filter(f => rank[f.id] === undefined).sort((x, y) => (x.order || 0) - (y.order || 0))
        const merged = inList.concat(outList)
        merged.forEach((f, i) => { f.order = i })
        state.folders = merged
        return { ok: true, folders: merged.map(f => ({ id: f.id, name: f.name, order: f.order, parent: f.parent || '', hidden: f.hidden === true, sys: f.sys === true })) }
      }
      if (op !== 'list') return { error: 'notes-folders: 未知 op：' + String(op) + '（期望 list/create/rename/set-flags/delete/reorder）' }
      /* 0.4.3⑩ 计数口径与 host 对齐（真实计数替代静态 0）：文件夹 count = 递归子树内全部非删除笔记（含 sys，与定向视图一致）；
         unfiled 与⑨「未分类」平铺同族——sys 不计入；悬空 folder 引用归 unfiled（effectiveFolder 同 host） */
      const direct = {}
      let unfiled = 0
      for (const n of notes) {
        if (n.deleted) continue
        const f = effectiveFolder(state, n)
        if (f) direct[f] = (direct[f] || 0) + 1
        else if ((n.kind || 'note') !== 'sys') unfiled++
      }
      return {
        folders: state.folders.slice().sort((x, y) => (x.order || 0) - (y.order || 0)).map(f => {
          const sub = folderSubtreeIds(state, f.id)
          let count = 0
          for (const sid in sub) count += direct[sid] || 0
          /* 0.4.8 契约对账：条目键集对齐 host（恒带 parent/depth/hidden/sys——旧 mock 缺 depth 且 hidden/sys 缺席是漂移） */
          return { id: f.id, name: f.name, order: f.order || 0, parent: f.parent || '', depth: folderDepth(state, f.id), count: count, hidden: f.hidden === true, sys: f.sys === true }
        }),
        unfiled,
      }
    }
    /* 0.4.7-B⑦（用例㊱/㊲）：mock 镜像 host settings-get 增带 organizeMaxChars 生效值——用户覆盖优先，缺省回落 12000
       （mock 不模拟模型表：host 侧模型映射由 check 节 106 行为级断言锁定）
       0.4.8 契约对账：键集对齐 host（{settings, models, lastInjectChars, organizeMaxChars}）——旧键 modelsDir 是漂移
       （host 从未发送该键）；permissionPresets 为宿主服务透传键，mock 不模拟（节 113 豁免登记，client 缺键有降级预填） */
    case 'notes-settings-get': return { settings: state.settings, models: [], lastInjectChars: 0, organizeMaxChars: (state.settings.organizeMaxChars > 0 ? state.settings.organizeMaxChars : 12000) }
    /* 0.4.7-B⑦：settings-set 兼容平铺 patch（host 真实形态 {organizeMaxChars: n}）与旧 {settings:{}} 包壳两形态；0 = 删 override（自动档）
       0.4.8 契约对账：响应补 settings 回显（host {ok,settings} 口径）；白名单/类型校验闸豁免（节 113 登记——e2e 只发合法键，host 校验由 check 节 17-5/56 看守） */
    case 'notes-settings-set': {
      const patch = (args && args.settings) || args || {}
      Object.keys(patch).forEach(k => {
        if (patch[k] === null || patch[k] === undefined || (k === 'organizeMaxChars' && patch[k] === 0)) delete state.settings[k]
        else state.settings[k] = patch[k]
      })
      return { ok: true, settings: state.settings }
    }
    /* 0.4.8 契约对账：键集对齐 host usageReport——四窗桶全键 {classify,organize,summarize,total} +
       byFeature 每功能 {today,week,month,allTime} + estimatedTokens/exactTokens/calls（旧 mock 桶缺三功能键、缺 exactTokens 是漂移） */
    case 'notes-usage-get': {
      const zb = () => ({ classify: 0, organize: 0, summarize: 0, total: 0 })
      const fb = () => ({ today: 0, week: 0, month: 0, allTime: 0 })
      return { today: zb(), week: zb(), month: zb(), allTime: zb(), byFeature: { classify: fb(), organize: fb(), summarize: fb() }, estimatedTokens: 0, exactTokens: 0, calls: 0 }
    }
    case 'notes-active-sessions': return { sessions: state.sessions.slice() }
    case 'notes-sessions': return { sessions: state.sessions.slice() }
    /* 0.4.8 契约对账：notes-workspaces 由缺省 {ok:true} 升格为真实形状（host {workspaces:[{id,title,cwd}]}——派发弹窗「新建会话」下拉数据源） */
    case 'notes-workspaces': return { workspaces: state.workspaces.slice() }
    /* 0.4.8 契约对账：notes-dispatch-done 由缺省 {ok:true} 升格为真实形状（host {ok,id}）+ 状态机翻转（done/dispatchStatus/doneAt/receipt='manual'） */
    case 'notes-dispatch-done': {
      const dn = notes.find(x => x.id === (args && args.id) && !x.deleted)
      if (!dn) return { error: 'not found' }
      const di = args && args.dispatchIndex
      const drec = (dn.dispatches || [])[di]
      if (drec && drec.dispatchStatus !== 'done') { drec.done = true; drec.dispatchStatus = 'done'; drec.doneAt = nowIso(); drec.receipt = 'manual'; dn.updatedAt = nowIso() }
      return { ok: true, id: dn.id }
    }
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
      /* 0.4.8 契约对账：补 queued 键（host _dispatch 恒带 queued 布尔——live=false 休眠送达为 true；mock 恒 live 语义 = false） */
      return { ok: true, id: n.id, sessionId: rec.sessionId, sessionName: rec.sessionName, queued: false, dispatch: rec }
    }
    case 'notes-export': {
      /* 0.4.8 契约对账：键集对齐 host _export（{exported, foldersFile, telemetry, assets, target}——无 ok 键；
         旧 mock 多 ok 缺 foldersFile/telemetry/assets 是漂移）；空 dir 错误形态同 host（文案顺手对齐） */
      const dir = String((args && args.dir) || '').trim()
      if (!dir) return { error: 'notes-export 需要 dir（目标目录）' }
      return { exported: notes.filter(n => !n.deleted).length, foldersFile: true, telemetry: false, assets: 0, target: dir }
    }
    case 'notes-history': return { versions: [] }
    case 'notes-ai-organize': {
      /* 0.4.4-F（notes-044-organize-instruct）：整理 mock——回显 instruction 供弹卡链路断言（留空 = '(无)'）；
         不做真实重写，仅在正文前加标记行（ok+body 契约与 host 对齐：不落盘，client 替换+自动保存） */
      const oiInstr = String((args && args.instruction) || '').trim()
      const oiBody = String((args && args.body) || '')
      if (!oiBody.trim()) return { error: '正文为空，无可整理内容' }
      /* 0.4.7-B⑥a（用例㊱）：失败路径演习面——正文含 [org-err] 标记返回 {error}（驱动 client 驻留错误条断言） */
      if (oiBody.indexOf('[org-err]') >= 0) return { error: 'mock 整理失败演示（[org-err] 标记）' }
      return { ok: true, body: '## 已整理\n\n[指令:' + (oiInstr || '(无)') + ']\n\n' + oiBody + '\n', kind: (args && args.kind) || 'note' }
    }
    /* 0.4.8 契约对账：notes-memory-guide 由残形 {guide:''}（host 无任何 op 返回该形状——纯漂移）升格为 host _memoryGuide
       op 分型同口径：status {enabled,noteId,guideIds} / check {enabled,already,noteId} / enable {ok,id[,already][,revived],folderId}
       （懒建「工作日志」夹 + 引导约定笔记，contractType 主键 + tag 兼容识别）/ disable {ok,disabled[,id]} / 未知 op {error}。
       简化（节 113 登记）：不做注入预览渲染与 origin 联动打标——身份/状态语义守契约，数据内容简化。 */
    case 'notes-memory-guide': {
      const a = args || {}
      const op = a.op || 'status'
      const isGuide = (n) => n.contractType === 'memory-guide' || (n.tags || []).indexOf('memory-guide') >= 0
      const guides = notes.filter(n => !n.deleted && isGuide(n))
      const active = guides.find(n => n.inject === true) || null
      if (op === 'status') return { enabled: !!active, noteId: active ? active.id : (guides[0] ? guides[0].id : ''), guideIds: guides.map(n => n.id) }
      if (op === 'check') return { enabled: !!active, already: !!active, noteId: active ? active.id : '' }
      if (op === 'enable') {
        if (active) return { ok: true, id: active.id, already: true }
        const scope = Array.isArray(a.scope) ? a.scope.map(String) : []
        const dormant = guides.find(n => n.inject !== true && (n.kind || 'note') !== 'log')
        let fld = state.folders.find(f => f.name === '工作日志')
        if (!fld) { fld = { id: newId(), name: '工作日志', parent: '', order: state.folders.reduce((m, f) => Math.max(m, f.order || 0), -1) + 1, sys: true }; state.folders.push(fld) }
        if (dormant) { dormant.inject = true; dormant.injectEver = true; dormant.injectTo = scope; dormant.updatedAt = nowIso(); return { ok: true, id: dormant.id, revived: true, folderId: fld.id } }
        const g = {
          id: newId(), title: '约定：工作日志沉淀（工作记忆 v0）', body: '（e2e mock 引导占位正文）', topic: '约定',
          workspace: 'e2e-workspace', folder: fld.id, tags: ['memory-guide'], kind: 'note', status: 'active',
          inject: true, injectEver: true, injectRole: 'convention', injectTo: scope, recall: true, sensitive: false, hidden: false,
          sessionId: '', cwd: '', logDate: '', entities: [], summarizedAt: '', contractType: 'memory-guide', origin: 'memory-guide',
          schedule: undefined, mergedFrom: [], dispatches: [], refNote: '', runLog: '', useCount: 0, archivedAt: '',
          createdAt: nowIso(), updatedAt: nowIso(), deleted: false,
        }
        notes.push(g)
        return { ok: true, id: g.id, folderId: fld.id }
      }
      if (op === 'disable') {
        if (!active) return { ok: true, disabled: false }
        active.inject = false; active.updatedAt = nowIso()
        return { ok: true, disabled: true, id: active.id }
      }
      return { error: 'notes-memory-guide: 未知 op：' + String(op) + '（期望 check/enable/status/disable）' }
    }
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
    case 'notes-suggest': {
      /* 0.4.6-C（用例㉘ notes-046-ux-discovery）：固定候选集——过期未引用 2 条 + 孤儿 1 条 → 顶栏「建议」徽标计数 = 3（六段合计口径，与其余用例共享状态零耦合） */
      /* 0.4.6-E（用例㉚ notes-046-suggest-flow）：state._suggestHot 可注入高频未挂载候选（默认空 = 零耦合；用例㉚ 自行设置/清理） */
      /* 0.4.7-D2（用例㊲）：state._suggestFixture 全量候选集覆写（六段齐备 → 徽标六段合计真机锁，等价 check 节 95 退役的 suggestPendingCount eval 合计断言） */
      if (state._suggestFixture) return Object.assign({ telemetryWindowDays: 14, generatedAt: nowIso() }, state._suggestFixture)
      return {
        archiveCandidates: [],
        staleCandidates: [
          { id: 'sg-stale-1', title: 'e2e 过期示例甲', topic: '', staleDays: 120 },
          { id: 'sg-stale-2', title: 'e2e 过期示例乙', topic: '', staleDays: 100 },
        ],
        orphanCandidates: [{ id: 'sg-orph-1', title: 'e2e 孤儿示例', topic: '' }],
        logHygieneCandidates: { weekly: [], monthly: [] },
        zeroRefMountCandidates: [],
        hotUnmountedCandidates: Array.isArray(state._suggestHot) ? state._suggestHot.slice() : [],
        telemetryWindowDays: 14, generatedAt: nowIso(),
      }
    }
    /* 0.4.6-E（用例㉚）：状态化挂载登记——_mounts[id]=whenToUse（幂等换文案同 key 覆盖）；
       挂载成功后从 _suggestHot 摘除该候选（模拟 host 真实收敛：已挂载不再提名高频未挂载） */
    case 'notes-mount': {
      /* 0.4.8 契约对账：键集对齐 host（{ok,id,indexNoteId,whenToUse}）+ 校验闸同口径（缺 id/笔记不存在/kind=log 拒绝）+
         挂载 ⇔ 资料档不变量（host ⑪ 单点收口：落行同时翻 inject=true + injectRole=reference）；
         indexNoteId 为占位常量（节 113 登记：mock 不建真实注入索引笔记——数据内容简化，键在即可） */
      const mid = String((args && args.id) || '')
      if (!mid) return { error: 'notes-mount 需要 id' }
      const mn = notes.find(x => x.id === mid && !x.deleted)
      if (!mn) return { error: 'notes-mount: 笔记不存在' }
      if ((mn.kind || 'note') === 'log') return { error: 'notes-mount: kind=log 工作日志不参与注入，不可挂载' }
      const when = (args && args.whenToUse === undefined) || (args && args.whenToUse === null) ? String(mn.title || '') : String((args && args.whenToUse) || '')
      mn.inject = true; mn.injectEver = true; mn.injectRole = 'reference'; mn.updatedAt = nowIso()
      state._mounts = state._mounts || {}
      state._mounts[mid] = when
      if (Array.isArray(state._suggestHot)) state._suggestHot = state._suggestHot.filter(h => h.id !== mid)
      return { ok: true, id: mid, indexNoteId: 'e2e-inject-index', whenToUse: when }
    }
    /* 0.4.8 契约对账：键集对齐 host（{indexNoteId, lines:[{id,when,raw}]}——旧 mock 缺 indexNoteId 与行 raw 是漂移） */
    case 'notes-mount-list': return {
      indexNoteId: Object.keys(state._mounts || {}).length ? 'e2e-inject-index' : null,
      lines: Object.keys(state._mounts || {}).map(id => ({ id: id, when: state._mounts[id], raw: '- [[' + id + ']] ' + state._mounts[id] })),
    }
    /* 0.4.6-E（用例㉚）：账本快照 fixture——ledger.mountTotal 定格 0（快照陈旧语义， cron 节拍不随挂载动作）+
       lastFlush（截至时刻数据源）+ mountNow = 实时挂载计数（每次打开注入管理即新鲜） */
    case 'notes-recall-stats': {
      /* 0.4.8 契约对账：channels 五通道桶键集对齐 host _recallComputeStats（inject/mount/search/get/catalog，
         每桶 {delivered,deliveries,used,uses,rate}——旧 mock 空对象是漂移） */
      const ch = () => ({ delivered: 0, deliveries: 0, used: 0, uses: 0, rate: null })
      return {
        ok: true, noteId: null, sinceDays: 7, fromDay: '', events: 0,
        channels: { inject: ch(), mount: ch(), search: ch(), get: ch(), catalog: ch() },
        ledger: { at: state._ledgerAt || nowIso(), trigger: 'cron', mountTotal: 0, weekLogs: 0, weekRefs: 0, top: [], zeroRefCount: 0, zeroRef: [], useRank: [] },
        lastFlush: nowIso(), mountNow: Object.keys(state._mounts || {}).length,
      }
    }
    /* 0.4.8 契约对账：notes-ping 对齐静态包 server.dist.js 形状 {ok,pong,echo}（dev host 未注册本方法——dist 独有，
       键集由节 113 静态断言锁定，活体对账基准为 dev host 故不入活体矩阵） */
    case 'notes-ping': return { ok: true, pong: Date.now(), echo: (args && typeof args === 'object') ? args : null }
    /* 0.5.0①（notes-050-vector-layer）：向量层三 RPC 契约（与 host 同形状）——status（N/M 篇·后端·各命名空间）/rebuild（只重建目标后端命名空间）/search（余弦 + minScore + max-pooling） */
    case 'notes-vectors-status': {
      const vBackend = vectorActiveBackendId(state)
      const vs = vectorNs(state)
      /* 0.5.0③（notes-050-rrf-fusion）：激活后端命名空间即使零向量也报自报 dim/minScore（与 host _vectorsStatus 同契约） */
      const nsIds = Object.keys(vs.ns)
      if (vBackend && nsIds.indexOf(vBackend) < 0) nsIds.push(vBackend)
      const namespaces = nsIds.sort().map(function (bid) {
        const b = VECTOR_BACKENDS[bid] || { id: bid, dim: 0, minScore: 0 }
        const ns = vs.ns[bid] || {}
        return { backend: bid, dim: b.dim, minScore: b.minScore, count: vectorNsCount(ns), lastBuiltAt: ns.lastBuiltAt || '' }
      })
      return {
        ok: true,
        enabled: vBackend !== null,
        backend: vBackend,
        indexed: (vBackend && vs.ns[vBackend]) ? vectorNsCount(vs.ns[vBackend]) : 0,
        indexable: notes.filter(vectorIndexable).length,
        lastBuiltAt: (vBackend && vs.ns[vBackend]) ? (vs.ns[vBackend].lastBuiltAt || '') : '',
        namespaces: namespaces,
      }
    }
    case 'notes-vectors-rebuild': {
      const bid = (args && args.backend) || vectorActiveBackendId(state) || 'fake-256'
      const b = VECTOR_BACKENDS[bid]
      if (!b) return { error: 'notes-vectors-rebuild: 未知后端 ' + String(bid) + '（且无激活后端）' }
      const vs = vectorNs(state)
      const ns = { hash: {}, rows: {}, lastBuiltAt: nowIso() }
      let indexed = 0
      for (const n of notes) {
        if (!vectorIndexable(n)) continue
        const chunks = vectorChunks(n.body)
        if (!chunks.length) continue
        const rows = []
        for (let i = 0; i < chunks.length; i++) rows.push({ chunk: i, vector: vectorEmbedOne(chunks[i], b.dim) })
        ns.rows[n.id] = rows
        indexed++
      }
      vs.ns[bid] = ns
      return { ok: true, backend: bid, dim: b.dim, minScore: b.minScore, indexed: indexed, indexable: notes.filter(vectorIndexable).length, lastBuiltAt: ns.lastBuiltAt }
    }
    case 'notes-vectors-search': {
      const bid = (args && args.backend) || vectorActiveBackendId(state) || 'fake-256'
      const b = VECTOR_BACKENDS[bid]
      if (!b) return { error: 'notes-vectors-search: 未知后端 ' + String(bid) + '（且无激活后端）' }
      let q = null
      if (args && Array.isArray(args.queryVector) && args.queryVector.length) q = args.queryVector.map(Number)
      else if (args && typeof args.query === 'string' && args.query) q = vectorEmbedOne(args.query, b.dim)
      if (!q || !q.length) return { error: 'notes-vectors-search: 需要 queryVector（数组）或 query（文本）' }
      const ns = vectorNs(state).ns[bid]
      if (!ns) return { ok: true, backend: bid, dim: b.dim, minScore: b.minScore, results: [], count: 0 }
      const results = []
      for (const nid of Object.keys(ns.rows || {})) {
        const rows = ns.rows[nid] || []
        let best = -2, bestChunk = -1
        for (const r of rows) { const cos = vectorCosine(q, r.vector); if (cos > best) { best = cos; bestChunk = r.chunk } }
        if (best >= b.minScore) results.push({ noteId: nid, score: best, chunk: bestChunk })
      }
      results.sort(function (x, y) { return y.score - x.score })
      const lim = Math.max(0, Math.floor(Number((args && args.limit) || 0))) || results.length
      const page = results.slice(0, lim)
      return { ok: true, backend: bid, dim: b.dim, minScore: b.minScore, results: page, count: page.length }
    }
    /* 0.5.0②（notes-050-wasm-embedder）：notes-vectors-put 浏览器回写契约（与 host _vectorsPut 同形状）——
       rows:[{noteId, bodyHash, vectors:[...]}] 增量 upsert；replace:true 清空目标命名空间再写；dim 写前校验（坏行 skipped）。 */
    case 'notes-vectors-put': {
      const bid = (args && args.backend)
      const b = VECTOR_BACKENDS[bid]
      if (!b) return { error: 'notes-vectors-put: 未知后端 ' + String(bid || '') }
      const rowsIn = (args && Array.isArray(args.rows)) ? args.rows : []
      const vs = vectorNs(state)
      let ns = vs.ns[bid]
      if ((args && args.replace === true) || !ns) { ns = { hash: {}, rows: {}, lastBuiltAt: nowIso() }; vs.ns[bid] = ns }
      let written = 0, skipped = 0
      for (const r of rowsIn) {
        if (!r || typeof r.noteId !== 'string' || !r.noteId || !Array.isArray(r.vectors) || !r.vectors.length) { skipped++; continue }
        const rows = []
        let bad = false
        for (let i = 0; i < r.vectors.length; i++) { const v = r.vectors[i]; if (!Array.isArray(v) || v.length !== b.dim) { bad = true; break } rows.push({ chunk: i, vector: v.map(Number) }) }
        if (bad) { skipped++; continue }
        ns.rows[r.noteId] = rows
        ns.hash[r.noteId] = (typeof r.bodyHash === 'string' && r.bodyHash) ? r.bodyHash : ''
        written++
      }
      return { ok: true, backend: bid, dim: b.dim, written: written, skipped: skipped, count: vectorNsCount(ns) }
    }
    /* 0.5.0（notes-050-mount-scope）：notes-inject-preview 由缺省 {ok:true} 升格为真实形状（host renderInjected 同形
       {conventions, directory, stats:{conventionsChars,directoryChars,totalChars,maskedNotes,staleMarked,budgetTruncated}}）——
       本卡 e2e「scoped 挂载 → 注入预览两会话视角差异」需 mock 侧同款 scope 过滤（挂载行随目标笔记 injectTo 过滤，同 host conventionHit）。
       简化（节 113 登记）：不模拟预算省略/脱敏/价值信号行/日志计数尾行/note_get 引导——只守 scope 过滤语义与响应键集，数据内容简化。 */
    case 'notes-inject-preview': {
      const a = args || {}
      let scope = a.sessionId ? String(a.sessionId).replace(/^session-/, '').slice(0, 8) : ''
      if (!scope && a.workspace) scope = state.sessions.filter(s => s.workspace === a.workspace).map(s => s.short)
      const hit = (injectTo) => {
        const targets = injectTo || []
        if (targets.length === 0) return true
        const sidSet = Array.isArray(scope) ? scope : null
        for (const t of targets) {
          if (t === 'global' || t === 'workspace') return true
          if (sidSet ? sidSet.indexOf(t) >= 0 : t === scope) return true
        }
        return false
      }
      const convs = notes.filter(n => !n.deleted && n.inject === true && (n.injectRole || 'convention') !== 'reference' && (n.kind || 'note') !== 'sys' && hit(n.injectTo))
      const mounts = Object.keys(state._mounts || {}).map(function (id) {
        const n = notes.find(x => x.id === id)
        return { id: id, when: state._mounts[id], n: n }
      }).filter(function (m) { return !m.n || hit(m.n.injectTo) })
      const conventions = convs.length ? '\n\n用户约定（须遵守）：\n\n' + convs.map(function (n) { return '- [' + n.id + '] ' + n.title + '\n  ' + String(n.body || '') }).join('\n\n') : ''
      let directory = ''
      if (mounts.length) directory = '\n\n本地笔记库目录（与本任务相关时用 note_get 拉全文，更多用 note_search）：\n\n' + mounts.map(function (m) { return '- [[' + m.id + ']] ' + m.when }).join('\n') + '\n\n（以上为挂载索引行：正文用 note_get <id> 获取）'
      const full = '以下是注入的上下文笔记（与当前任务无关时忽略）：' + conventions + directory
      return {
        conventions: conventions,
        directory: directory,
        stats: { conventionsChars: conventions.length, directoryChars: directory.length, totalChars: full.length, maskedNotes: 0, staleMarked: 0, budgetTruncated: false },
      }
    }
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
          let out, m2 = ''
          try {
            const req2 = JSON.parse(buf || '{}')
            m2 = req2.method
            out = handleRpc(state, req2.method, req2.args)
          } catch (e) { out = { error: String(e && e.message || e) } }
          /* 0.4.6-A（节 26 用例）：state._delays[method] = ms 可注入人工延迟，演习 RPC 尖刺期「正文在途窗」 */
          const send = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)) }
          const delay = (state._delays && state._delays[m2]) || 0
          if (delay) setTimeout(send, delay); else send()
        })
        return
      }
      /* e2e mock 资产路由（0.4.6-A）：GET /dsh-notes/asset?file=assets/<name> → 1px PNG 统一下发（对齐真机路由形态，内容无关） */
      if (req.method === 'GET' && (req.url || '').indexOf('/dsh-notes/asset') === 0) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
        res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
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
