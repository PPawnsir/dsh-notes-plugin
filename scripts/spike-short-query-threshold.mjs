// spike-short-query-threshold.mjs —— 0.6.x（notes-061-search-refine 池#1）短查询语义压制阈值实证回放（手动夹具，不进 CI，同 smoke-embed 先例）
//
// 问题：RRF 融合对短关键词（≤6 字符 / 纯英文单词）把语义通道 minScore 临时上浮 +RRF_SHORT_MINSCORE_BUMP（0.05）——
//   bge base 0.50 → effMin 0.55。0.5.0 R3 verifier E3 实证过「词面不重叠的 4 字短查询原始语义分 0.5049 被挡」，
//   池笔记 [[n-mv1dohzb2q2x]] #1 要求真模型+真笔记库回放评估：0.50–0.55 带里到底挡了多少**真命中**。
//
// 方法（生产口径保真）：
//   ① 语料 = 真实笔记库 ~/.dsh/notes（env DSH_SPIKE_NOTES_DIR 覆盖）——parseFM/noteFromParsed 同口径解析 + 可索引面过滤；
//   ② 向量 = 直接加载生产边车 vectors.jsonl（bge-small-zh-q8 命名空间），并按 _vectorBodyHash 新鲜度锚校验——
//      只用新鲜行打分（陈旧/孤儿行单列报告），这就是生产检索此刻看到的同一索引；
//   ③ 查询向量 = host-embedder 标记块提取的真 bge 嵌入器（与 smoke-embed.mjs 同一提取路径，零代码复制）；
//   ④ 打分 = _vectorCosine per-note max-pooling（_vectorsSearch 同口径，但不走 minScore 闸——要的就是原始分布）；
//   ⑤ 每条查询输出：分数直方图 + [0.50,0.55) 压制带明细（标题/分数/文本通道是否已命中/胜出块片段），
//      「文本命中」= 生产 _search hay 同口径（title+打码体+topic+tags 小写子串）——带内若文本已命中则压制无害。
//
// 运行：node scripts/spike-short-query-threshold.mjs   （模型缓存命中后零网络；全程 <1min）
// 产物：控制台报表 + scripts/.spike-short-query-out.json（明细数据，工作日志摘其分布）
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SRC_ROOT = process.env.DSH_SMOKE_SRC_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_PKG_DIR = process.env.DSH_SMOKE_HOST_PKG_DIR || SRC_ROOT
const CACHE_DIR = process.env.DSH_SMOKE_CACHE_DIR || join(homedir(), '.dsh', 'notes', 'models')
const NOTES_DIR = process.env.DSH_SPIKE_NOTES_DIR || join(homedir(), '.dsh', 'notes')
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), '.spike-short-query-out.json')

const watchdog = setTimeout(() => { console.error('[spike] FATAL: 看门狗超时（600s）'); process.exit(2) }, 600000)
const t0 = Date.now()
console.log('[spike] 短查询压制阈值实证回放  笔记库=' + NOTES_DIR)

// ---- 源码提取（单一事实源，与生产同一份代码）----
const read = (rel) => readFileSync(join(SRC_ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const deindent = (s) => s.split('\n').map(l => (l.startsWith('    ') ? l.slice(4) : l)).join('\n')
const grabBlock = (src, begin, end) => {
  const b = src.indexOf(begin), e = src.indexOf(end)
  if (b < 0 || e <= b) throw new Error('缺标记块 ' + begin)
  return src.slice(src.indexOf('\n', b) + 1, e)
}
const grabFn = (src, sig) => {
  const m = src.match(new RegExp('    ' + sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?\\n    \\}'))
  if (!m) throw new Error('缺函数 ' + sig)
  return deindent(m[0])
}

const vsSrc = read('src/host/kernel/vector-store.js')
const embBlock = deindent(grabBlock(vsSrc, '==== host-embedder BEGIN ====', '==== host-embedder END ===='))
const spanBlock = grabBlock(read('src/shared/editor-kernel.js'), '===== secret-span BEGIN =====', '===== secret-span END =====')
const helpersBlock = deindent(grabBlock(read('src/host/inject/sensitive-helpers.js'), '==== sensitive-helpers BEGIN ====', '==== sensitive-helpers END ===='))
const fmBlock = deindent(read('src/host/kernel/front-matter.js'))
const chunkFns = [
  grabFn(vsSrc, 'const VECTOR_CHUNK_MAX = 1800'),
  grabFn(vsSrc, 'function _vectorBodyHash(body) {'),
  grabFn(vsSrc, 'function _vectorChunks(body) {'),
  grabFn(vsSrc, 'function _vectorCosine(a, b) {'),
].join('\n')
// rrf-fusion-core（search.js）：常量表 + 短查询判定——压制参数直接从生产代码取，漂移即报错（注释壳剥离同 check 节 119 先例）
const searchSrc = read('src/host/search.js')
let rrfCore = grabBlock(searchSrc, '==== rrf-fusion-core BEGIN ====', '==== rrf-fusion-core END ====')
rrfCore = deindent(rrfCore.slice(rrfCore.indexOf('*/') + 2))
rrfCore = rrfCore.slice(0, rrfCore.lastIndexOf('/*'))   // END 标记行残留块注释头剥离（同 check 节 119 口径）

const kernel = new Function(
  spanBlock + '\n' + helpersBlock + '\n' + fmBlock + '\n' + chunkFns + '\n' + rrfCore +
  '\n;return { parseFM, stripSecretSpans, maskSecretSpans, _vectorBodyHash, _vectorChunks, _vectorCosine, VECTOR_CHUNK_MAX, rrfIsShortQuery, rrfSemanticMinScore, RRF_SHORT_MINSCORE_BUMP, RRF_K, RRF_SEMANTIC_LIMIT }'
)()
console.log('[spike] 核函数提取完成  块上限=' + kernel.VECTOR_CHUNK_MAX + '  RRF_K=' + kernel.RRF_K + '  语义limit=' + kernel.RRF_SEMANTIC_LIMIT + '  短查询上浮=+' + kernel.RRF_SHORT_MINSCORE_BUMP)

// ---- 真实笔记库加载（_list/noteFromParsed 同口径字段）----
function miniNote(id, p) {
  const m = p.meta
  return {
    id: m.id || id, title: m.title || 'Untitled', topic: m.topic || '未分类', tags: m.tags || [],
    kind: m.kind || 'note', sensitive: m.sensitive === 'true',
    deleted: m.deleted === 'true', tombstoned: m.tombstoned === 'true', body: p.body,
  }
}
const notes = new Map()
for (const f of readdirSync(NOTES_DIR)) {
  if (!f.endsWith('.md')) continue
  const n = miniNote(f.replace(/\.md$/, ''), kernel.parseFM(readFileSync(join(NOTES_DIR, f), 'utf8')))
  notes.set(n.id, n)
}
const indexable = [...notes.values()].filter(n => !n.deleted && !n.tombstoned && !n.sensitive && n.kind !== 'sys')
console.log('[spike] 笔记加载：总 ' + notes.size + ' 条，可索引面 ' + indexable.length + ' 条（删/碑/敏感/sys 排除）')

// ---- 生产边车加载 + 新鲜度校验 ----
const rows = readFileSync(join(NOTES_DIR, 'vectors.jsonl'), 'utf8').split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))
  .filter(r => r.backend === 'bge-small-zh-q8')
const byIdHash = {}
for (const n of indexable) byIdHash[n.id] = kernel._vectorBodyHash(n.body)
let freshRows = [], staleRows = 0, orphanRows = 0
for (const r of rows) {
  if (!(r.noteId in byIdHash)) { orphanRows++; continue }
  if (byIdHash[r.noteId] === r.bodyHash) freshRows.push(r); else staleRows++
}
const indexedFresh = new Set(freshRows.map(r => r.noteId))
console.log('[spike] 边车 bge 命名空间：总行 ' + rows.length + ' = 新鲜 ' + freshRows.length + '（' + indexedFresh.size + ' 笔记）+ 陈旧 ' + staleRows + ' + 孤儿 ' + orphanRows)
console.log('[spike] 可索引但未进索引（空正文零块等）：' + (indexable.length - indexedFresh.size) + ' 条')

// ---- 真模型嵌入查询 ----
const emb = new Function('HOST_PKG_DIR', 'BGE_MODEL_CACHE_DIR', embBlock + '\n;return { _vectorBgeEmbed, BGE_MODEL_ID }')(HOST_PKG_DIR, CACHE_DIR)
// 短查询两组（全 ≤6 字 → rrfIsShortQuery 全中）：词面不重叠候选组 + 词面重叠对照组
const QUERIES = [
  { q: '部署', group: 'nonoverlap' }, { q: '发版', group: 'nonoverlap' }, { q: '巡检', group: 'nonoverlap' }, { q: '上线', group: 'nonoverlap' },
  { q: '运维', group: 'nonoverlap' }, { q: '复盘', group: 'nonoverlap' }, { q: '加密', group: 'nonoverlap' }, { q: '缓存', group: 'nonoverlap' },
  { q: '看板', group: 'overlap' }, { q: '语义', group: 'overlap' }, { q: '注入', group: 'overlap' }, { q: '归档', group: 'overlap' },
  { q: '向量', group: 'overlap' }, { q: '防抖', group: 'overlap' }, { q: '面板', group: 'overlap' }, { q: '设置', group: 'overlap' },
]
for (const it of QUERIES) { if (!kernel.rrfIsShortQuery(it.q)) throw new Error('查询非短：' + it.q) }
const t1 = Date.now()
const qVecs = await emb._vectorBgeEmbed(QUERIES.map(x => x.q))
console.log('[spike] 查询嵌入完成（含模型加载）' + (Date.now() - t1) + 'ms  模型=' + emb.BGE_MODEL_ID + '  dim=' + qVecs[0].length)

// ---- 打分：per-note max-pooling（生产 _vectorsSearch 口径，但不过 minScore 闸）----
const BASE_MIN = 0.50, BUMP = kernel.RRF_SHORT_MINSCORE_BUMP, EFF_MIN = BASE_MIN + BUMP
const chunkCache = new Map()
function chunkTextOf(noteId, ci) {
  if (!chunkCache.has(noteId)) chunkCache.set(noteId, kernel._vectorChunks(notes.get(noteId).body))
  const arr = chunkCache.get(noteId)
  return (typeof ci === 'number' && ci >= 0 && ci < arr.length) ? arr[ci] : null
}
function textHit(n, q) {
  const hay = ((n.title || '') + ' ' + kernel.maskSecretSpans(n.body) + ' ' + (n.topic || '') + ' ' + (n.tags || []).join(' ')).toLowerCase()
  return hay.indexOf(q.toLowerCase()) >= 0
}
const report = { baseMin: BASE_MIN, effMin: EFF_MIN, notesTotal: notes.size, indexable: indexable.length, freshRows: freshRows.length, staleRows, orphanRows, queries: [] }
for (let qi = 0; qi < QUERIES.length; qi++) {
  const { q, group } = QUERIES[qi]
  const qv = qVecs[qi]
  const best = {}   // noteId → {score, chunk}
  for (const r of freshRows) {
    const cos = kernel._vectorCosine(qv, r.vector)
    if (!best[r.noteId] || cos > best[r.noteId].score) best[r.noteId] = { score: cos, chunk: r.chunk }
  }
  const ranked = Object.keys(best).map(id => ({ id, score: best[id].score, chunk: best[id].chunk })).sort((a, b) => b.score - a.score)
  for (const it of ranked) { const n = notes.get(it.id); it.title = n.title; it.textHit = textHit(n, q) }
  const scores = ranked.map(x => x.score).sort((a, b) => a - b)
  const pct = (p) => scores.length ? scores[Math.min(scores.length - 1, Math.floor(p * scores.length))] : 0
  const band = (lo, hi) => ranked.filter(x => x.score >= lo && x.score < hi)
  const bandB = band(BASE_MIN, EFF_MIN)   // 压制带：base 过闸但 +bump 被挡
  const bandA = band(EFF_MIN, 2)          // 上浮后仍过闸
  const entry = {
    query: q, group, scored: ranked.length,
    dist: { p50: +pct(0.5).toFixed(4), p90: +pct(0.9).toFixed(4), p99: +pct(0.99).toFixed(4), max: scores.length ? +scores[scores.length - 1].toFixed(4) : 0 },
    overEffMin: bandA.length,
    band: bandB.map(x => ({ id: x.id, title: x.title, score: +x.score.toFixed(4), textHit: x.textHit, snippet: (chunkTextOf(x.id, x.chunk) || '').replace(/\s+/g, ' ').slice(0, 70) })),
    top: ranked.slice(0, 6).map(x => ({ title: x.title.slice(0, 40), score: +x.score.toFixed(4), textHit: x.textHit })),
  }
  report.queries.push(entry)
  console.log('\n[' + group + '] 「' + q + '」 打分笔记 ' + ranked.length + '｜≥' + EFF_MIN + ' 过闸 ' + bandA.length + '｜压制带[' + BASE_MIN + ',' + EFF_MIN + ') ' + bandB.length + '（其中文本已命中 ' + bandB.filter(x => x.textHit).length + '）｜p50=' + entry.dist.p50 + ' p90=' + entry.dist.p90 + ' max=' + entry.dist.max)
  for (const b of bandB) console.log('   带内 ' + b.score.toFixed(4) + ' ' + (b.textHit ? '[文本命中]' : '[纯语义]  ') + ' ' + b.title.slice(0, 42) + ' ｜ ' + b.snippet)
}
writeFileSync(OUT_PATH, JSON.stringify(report, null, 2))
console.log('\n[spike] 明细已写 ' + OUT_PATH + '  全程 ' + (Date.now() - t0) + 'ms')
clearTimeout(watchdog)
