// P2·5 host 收口切片器：whole.js / dist-whole.js → server/img-path-hint/dispatch/inject/memory/search/transfer/index
// 契约：锚点定位（唯一命中，漂移即 throw）；段内字节原样；模块内段间补一个空行；有意改动点逐一计数断言。
// 产物：src/host/{server.js, inject/img-path-hint.js, dispatch.js, inject.js, memory.js, search.js, transfer.js, index.js}
//   及对应 .dist.js 变体（img-path-hint 与 search 双包逐字节一致 → 物理单份，两清单同名引用）。
// 运行：node scratch/p25-slice.cjs  （幂等：从 whole.js/dist-whole.js 重建全部目标文件）
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const HOST_DIR = path.join(ROOT, 'src', 'host')

const rd = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const devSrc = rd(path.join(HOST_DIR, 'whole.js'))
const distSrc = rd(path.join(HOST_DIR, 'dist-whole.js'))

// 锚点定位：在 lines 中找「包含 anchor 的唯一行」的 0 基下标；漂移/多命中即 throw
function at(lines, anchor, tag) {
  const hits = []
  for (let i = 0; i < lines.length; i++) if (lines[i].indexOf(anchor) >= 0) hits.push(i)
  if (hits.length !== 1) throw new Error('锚点非唯一[' + tag + ']：' + JSON.stringify(anchor.slice(0, 60)) + ' 命中 ' + hits.length + ' 次' + (hits.length ? ' @L' + (hits[0] + 1) : ''))
  return hits[0]
}

// ---- 有意改动点（exact-match 替换 + 命中计数断言）----
// T1 开发版 notes-src host 分支：host-impl.js 死引用 → manifest.dev.js 拼接（与 host.js 引导壳同一规则）
const DEV_SRC_OLD = [
  "        const ft = await fs.resolve(PLUGIN_DIR + '\\\\src\\\\host-impl.js')",
  "        return { src: await fs.readText(ft) }",
].join('\n')
const DEV_SRC_NEW = [
  "        // host 源下发：src/host/** 按 manifest.dev.js 逐字节拼接（与 host.js 引导壳同一拼接规则；P2·2 起 host-impl.js 已拆为模块树）",
  "        const hmtext = await fs.readText(await fs.resolve(PLUGIN_DIR + '\\\\src\\\\host\\\\manifest.dev.js'))",
  "        const hlist = (String(hmtext).match(/'[^'\\n]+'/g) || []).map(s => s.slice(1, -1))",
  "        let hsrc = ''",
  "        for (const rel of hlist) hsrc += await fs.readText(await fs.resolve(PLUGIN_DIR + '\\\\src\\\\host\\\\' + rel.replace(/\\//g, '\\\\')))",
  "        return { src: hsrc.replace(/\\r\\n/g, '\\n') }",
].join('\n')
// T2 发布版 notes-src host 分支：host-impl.js 候选 → manifest.dev.js 拼接优先 + 包内 index.mjs 回退
const DIST_SRC_OLD = [
  "    // host 源候选不变：开发版目录的 host-impl.js，包内的 index.mjs。",
].join('\n')
const DIST_SRC_OLD2 = [
  "        const candidates = [path.join(LEGACY_PLUGIN_DIR, 'src', 'host-impl.js'), path.join(PKG_DIR, 'index.mjs')]",
  "        for (const p of candidates) {",
  "          try { if (fsNode.existsSync(p)) return { src: fsNode.readFileSync(p, 'utf8') } } catch (e) {}",
  "        }",
  "        throw new Error(which + ' source not found in: ' + candidates.join(' | '))",
].join('\n')
const DIST_SRC_NEW = [
  "    // host 源候选：开发目录存在 manifest.dev.js 时按 src/host/** 逐字节拼接（与 client 分支同一解析规则）；纯安装环境回退包内 index.mjs。",
].join('\n')
const DIST_SRC_NEW2 = [
  "        const hostManifest = path.join(LEGACY_PLUGIN_DIR, 'src', 'host', 'manifest.dev.js')",
  "        if (fsNode.existsSync(hostManifest)) {",
  "          const hlist = (String(fsNode.readFileSync(hostManifest, 'utf8')).match(/'[^'\\n]+'/g) || []).map(s => s.slice(1, -1))",
  "          let hsrc = ''",
  "          for (const rel of hlist) hsrc += fsNode.readFileSync(path.join(LEGACY_PLUGIN_DIR, 'src', 'host', rel), 'utf8')",
  "          return { src: hsrc.replace(/\\r\\n/g, '\\n') }",
  "        }",
  "        return { src: fsNode.readFileSync(path.join(PKG_DIR, 'index.mjs'), 'utf8') }",
].join('\n')
// T3 ASSET_EXT_MIME 随路由迁入 server.dist.js（其唯一消费方是 GET /dsh-notes/asset 路由；消除跨模块前位引用）
const ASSET_EXT_MIME_BLOCK = [
  "    // 扩展名 → mime（GET 路由 Content-Type 白名单；.jpg/.jpeg 双形态）",
  "    const ASSET_EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }",
].join('\n')
const ASSET_ROUTE_ANCHOR = "    // ---- 图片资产路由：GET /dsh-notes/asset?file=assets/<name> ----"

function repOnce(text, oldStr, newStr, tag) {
  const n = text.split(oldStr).length - 1
  if (n !== 1) throw new Error('替换命中 ' + n + ' 次（期望 1）[' + tag + ']')
  return text.replace(oldStr, newStr)
}

const A = {
  perf: '// ---- 性能遥测：RPC 计数/耗时',
  archHandler: '// 归档（显式语义）：args.groups = 白名单组',
  aiOrgHandler: '// 二期 ✨整理：{id?, body, kind, title?}',
  pruneHandler: '// 二期 孤儿资产清理：{dryRun?, files?}',
  sessList: '// 派发目标会话列表（共享）',
  imgBegin: '// ==== img-path-hint BEGIN',
  dispatch: '// 任务派发（共享）：主动注入上下文',
  searchBegin: '// ==== search-helpers BEGIN',
  transfer: '// ---- 导入/导出：全库目录快照',
  convHit: '// 约定命中判定（约定注入 conventionText 与目录去重 catalogText 共用）：',
  ctxReg: '// 上下文注入（双角色分桶）：注册动态 prompt context',
  sessHandler: '// 会话列表（注入范围多选用）',
  settingsGet: '// 设置读取（设置卡片数据源）',
  exportHandler: '// 全库导出（目录快照）',
  memoryGuide: '// ==== 工作记忆 v0：沉淀引导启用流程',
  searchHandler: '// notes-search 扩展（向后兼容）',
  regTool: 'function regTool(def) {',
  ping: '// POC 存活探测（P1 骨架遗留',
  toolCh: '// 工具注册：主通道',
}

// 段抽取 + 全覆盖校验：源文件的每一行必须恰好被一个段消费
function buildFlavor(srcText, flavor) {
  const L = srcText.split('\n')
  const used = new Array(L.length).fill(false)
  function seg(startAnchor, endAnchor, tag) {
    const s = startAnchor === null ? 0 : at(L, startAnchor, tag + '.start')
    const e = endAnchor === null ? L.length : at(L, endAnchor, tag + '.end')
    if (e <= s) throw new Error('段为空/逆序：' + flavor + '.' + tag + ' [' + (s + 1) + ',' + e + ')')
    for (let i = s; i < e; i++) { if (used[i]) throw new Error('行重叠[' + flavor + '.' + tag + '] @L' + (i + 1)); used[i] = true }
    return L.slice(s, e).join('\n') + '\n'
  }
  let mod
  if (flavor === 'dev') {
    mod = {
      'server.js': [seg(A.perf, A.archHandler, 'server.1'), seg(A.aiOrgHandler, A.pruneHandler, 'server.2')],
      'inject/img-path-hint.js': [seg(A.imgBegin, A.dispatch, 'img')],
      'dispatch.js': [seg(A.sessList, A.imgBegin, 'dispatch.1'), seg(A.dispatch, A.searchBegin, 'dispatch.2'), seg(A.sessHandler, A.settingsGet, 'dispatch.3')],
      'inject.js': [seg(A.convHit, A.perf, 'inject.1'), seg(A.ctxReg, A.sessHandler, 'inject.2'), seg(A.settingsGet, A.exportHandler, 'inject.3')],
      'memory.js': [seg(null, A.sessList, 'memory.1'), seg(A.archHandler, A.memoryGuide, 'memory.2'), seg(A.memoryGuide, A.searchHandler, 'memory.3')],
      'search.js': [seg(A.searchBegin, A.transfer, 'search.1'), seg(A.searchHandler, A.ctxReg, 'search.2')],
      'transfer.js': [seg(A.transfer, A.convHit, 'transfer.1'), seg(A.exportHandler, A.aiOrgHandler, 'transfer.2'), seg(A.pruneHandler, A.regTool, 'transfer.3')],
      'index.js': [seg(A.regTool, null, 'index')],
    }
  } else {
    mod = {
      'server.dist.js': [seg(A.perf, A.archHandler, 'server.1'), seg(A.aiOrgHandler, A.pruneHandler, 'server.2'), seg(A.ping, A.toolCh, 'server.3')],
      'inject/img-path-hint.js': [seg(A.imgBegin, A.dispatch, 'img')],
      'dispatch.dist.js': [seg(A.sessList, A.imgBegin, 'dispatch.1'), seg(A.dispatch, A.searchBegin, 'dispatch.2'), seg(A.sessHandler, A.settingsGet, 'dispatch.3')],
      'inject.dist.js': [seg(A.convHit, A.perf, 'inject.1'), seg(A.ctxReg, A.sessHandler, 'inject.2'), seg(A.settingsGet, A.exportHandler, 'inject.3')],
      'memory.dist.js': [seg(null, A.sessList, 'memory.1'), seg(A.archHandler, A.memoryGuide, 'memory.2'), seg(A.memoryGuide, A.searchHandler, 'memory.3')],
      'search.js': [seg(A.searchBegin, A.transfer, 'search.1'), seg(A.searchHandler, A.ctxReg, 'search.2')],
      'transfer.dist.js': [seg(A.transfer, A.convHit, 'transfer.1'), seg(A.exportHandler, A.aiOrgHandler, 'transfer.2'), seg(A.pruneHandler, A.ping, 'transfer.3')],
      'index.dist.js': [seg(A.toolCh, null, 'index')],
    }
  }
  const uncovered = []
  for (let i = 0; i < L.length; i++) if (!used[i]) uncovered.push(i + 1)
  if (uncovered.length) throw new Error(flavor + ' 覆盖缺口 ' + uncovered.length + ' 行：L' + uncovered.slice(0, 10).join(',L') + (uncovered.length > 10 ? '…' : '') + '\n  首行内容：' + JSON.stringify(L[uncovered[0] - 1]))
  // 段间补一个空行拼接
  const out = {}
  for (const k of Object.keys(mod)) out[k] = mod[k].join('\n')
  return out
}

const dev = buildFlavor(devSrc, 'dev')
const dist = buildFlavor(distSrc, 'dist')

// 双包共源片断言：逐字节一致才允许物理单份
if (dev['inject/img-path-hint.js'] !== dist['inject/img-path-hint.js']) throw new Error('img-path-hint 双包不一致，不得共源')
if (dev['search.js'] !== dist['search.js']) throw new Error('search 双包不一致，不得共源')

// ---- 有意改动点落刀 ----
// T1 dev notes-src host 分支
dev['server.js'] = repOnce(dev['server.js'], DEV_SRC_OLD, DEV_SRC_NEW, 'dev notes-src host 分支')
// T2 dist notes-src host 分支
dist['server.dist.js'] = repOnce(dist['server.dist.js'], DIST_SRC_OLD, DIST_SRC_NEW, 'dist notes-src 注释')
dist['server.dist.js'] = repOnce(dist['server.dist.js'], DIST_SRC_OLD2, DIST_SRC_NEW2, 'dist notes-src host 分支')
// T3 ASSET_EXT_MIME：transfer.dist.js → server.dist.js（资产路由同模块）
dist['transfer.dist.js'] = repOnce(dist['transfer.dist.js'], ASSET_EXT_MIME_BLOCK + '\n', '', 'transfer.dist ASSET_EXT_MIME 切出')
dist['server.dist.js'] = repOnce(dist['server.dist.js'], ASSET_ROUTE_ANCHOR, ASSET_EXT_MIME_BLOCK + '\n\n' + ASSET_ROUTE_ANCHOR, 'server.dist ASSET_EXT_MIME 移入')

// ---- 写盘 ----
const files = {}
for (const k of Object.keys(dev)) files[k] = dev[k]
for (const k of Object.keys(dist)) { if (!(k in files)) files[k] = dist[k] }   // 共源片只写一份
for (const rel of Object.keys(files).sort()) {
  const p = path.join(HOST_DIR, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, files[rel], 'utf8')
  console.log('write', path.relative(ROOT, p), files[rel].split('\n').length - 1, 'lines,', Buffer.byteLength(files[rel], 'utf8'), 'bytes')
}

// ---- 写后回读校验 ----
const devManifest = ['kernel/head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'kernel/settings-store.js', 'llm/usage-classify.js', 'kernel/store-cache.js', 'history-trash/engine.js', 'kernel/persist.js', 'folders.js', 'notes.js', 'llm/organize.js', 'history-trash/trash.js', 'server.js', 'inject/img-path-hint.js', 'dispatch.js', 'inject.js', 'memory.js', 'search.js', 'transfer.js', 'index.js']
const distManifest = ['head.js', 'apply-head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'kernel/settings-store.dist.js', 'llm/usage-classify.dist.js', 'kernel/store-cache.dist.js', 'history-trash/engine.dist.js', 'kernel/persist.dist.js', 'folders.dist.js', 'notes.dist.js', 'llm/organize.dist.js', 'history-trash/trash.dist.js', 'server.dist.js', 'inject/img-path-hint.js', 'dispatch.dist.js', 'inject.dist.js', 'memory.dist.js', 'search.js', 'transfer.dist.js', 'index.dist.js']
const joinM = (list) => list.map(r => rd(path.join(HOST_DIR, r))).join('')
const newDev = joinM(devManifest), newDist = joinM(distManifest)
// 语法闸：拼接产物可解析
new Function(newDev)
fs.writeFileSync(path.join(ROOT, 'scratch', '_post-p25-dist.mjs'), newDist)
// 行多重集 diff（新产物 vs 旧产物）：只应出现有意改动
function multisetDiff(oldText, newText, tag) {
  const count = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return m }
  const a = count(oldText.split('\n')), b = count(newText.split('\n'))
  const removed = [], added = []
  for (const [l, n] of a) { const m = b.get(l) || 0; if (n > m) removed.push([l, n - m]) }
  for (const [l, n] of b) { const o = a.get(l) || 0; if (n > o) added.push([l, n - o]) }
  console.log('\n[' + tag + '] removed ' + removed.length + ' 种 / added ' + added.length + ' 种')
  for (const [l, n] of removed) console.log('  -' + (n > 1 ? '×' + n : ''), JSON.stringify(l.slice(0, 130)))
  for (const [l, n] of added) console.log('  +' + (n > 1 ? '×' + n : ''), JSON.stringify(l.slice(0, 130)))
}
multisetDiff(devSrc, newDev, 'dev')
multisetDiff(distSrc, newDist, 'dist')
// 标记块完整性：五个块 BEGIN/END 在新产物中各出现一次
for (const blk of ['suggest-helpers', 'img-path-hint', 'dispatch-loop', 'search-helpers', 'export-single']) {
  for (const [txt, tag] of [[newDev, 'dev'], [newDist, 'dist']]) {
    const b = txt.split('==== ' + blk + ' BEGIN').length - 1, e = txt.split('==== ' + blk + ' END').length - 1
    if (b !== 1 || e !== 1) throw new Error('标记块 ' + blk + ' 在 ' + tag + ' 产物中 BEGIN=' + b + ' END=' + e)
  }
}
console.log('\nOK: 切片完成，覆盖/共源/标记块/语法校验通过')
