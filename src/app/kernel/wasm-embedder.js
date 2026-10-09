/* ==================================================================================
 * wasm embedder（0.5.0② notes-050-wasm-embedder）：transformers.js 浏览器端 bge 后端
 * 冻结架构 [[n-muz9b97x35et]] + spike [[n-muz91f19rrqj]]。
 *
 * 只跑在 app 页（全窗口 app.html）——wasm-in-panel 可行性裁决（本卡冻结风险项③）：
 *   面板（client bundle）不加载 transformers.js / ONNX wasm / 模型，面板读现成向量
 *   （经 notes-vectors-search RPC）。证据见本文件尾「wasm-in-panel 裁决」说明块。
 *
 * 数据流：浏览器算向量 → RPC 回写 host 边车（notes-vectors-put，①的队列消费位）；
 *   查询嵌入同理（notes-vectors-search 的 queryVector 形态，③消费）。
 *
 * 红线：
 *   · 正文不出机器（本地 wasm 路线本质保证，模型/向量全在浏览器本地）。
 *   · npm 包体积零增长（模型 23.32MB + wasm 运行时 10.6~20.6MB 一律运行时拉取，不进包）。
 *   · 离线 = 优雅降级（下载失败静默，不报错刷屏；嵌入回退纯文本，见 ③ 降级链）。
 *
 * 镜像链（下载纪律）：hf-mirror.com 主力（spike 实测 8.7MB/s）→ huggingface.co 兜底；
 *   jsDelivr 已砍（spike 实测三处 404，模型不在 jsDelivr 射程，不准复活）。
 *   模型文件进浏览器 Cache API（不进 npm 包）；进度回调 / 断点续传（Range）/ ETag 校验。
 *
 * 静默预取（用户拍板 B+）：浏览器闲置（requestIdleCallback / 空闲探测）时后台拉取，
 *   不打断任何交互；首次「构建索引」若模型未下 → 显式下载带进度（B 方案兜底）。
 * ================================================================================== */

/* ==== wasm-embedder-core BEGIN ====（0.5.0② notes-050-wasm-embedder：镜像链 + 下载纪律 + 闲置预取纯函数核——check 节 118 提取 eval 行为级测试）
 * 纯函数块：零 DOM 依赖，fetchImpl / now / mirrors 全经入参注入，Node mock 可 eval 测试。
 * 契约：fetchImpl(url, init) → Response-like { ok, status, headers:{get(k)}, body?:{getReader()}, arrayBuffer() }。
 */
// 镜像链：主力 hf-mirror → 兜底 huggingface.co（jsDelivr 已砍，不复）
var WASM_MIRRORS = [
  { id: 'hf-mirror', base: 'https://hf-mirror.com' },
  { id: 'hf-official', base: 'https://huggingface.co' },
]
// 模型标识（transformers.js 布局：config + tokenizer + tokenizer_config + onnx/model_quantized.onnx）
var WASM_MODEL_ID = 'Xenova/bge-small-zh-v1.5'
var WASM_MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
// 模型总字节（spike 实测 23.32MB：onnx 23.4MB + tokenizer 429KB + config 1KB；仅文档锚，实际以下载后 Cache API 统计为准）
var WASM_MODEL_BYTES = 24452000
// 闲置预取阈值：距最后交互 >60s 才允许静默预取（不打断任何交互）
var WASM_PREFETCH_IDLE_MS = 60000
// 断点续传最大尝试次数（Range 续传 + ETag 校验；超限抛错，由上层 failover/降级承接）
var WASM_RESUME_MAX_TRIES = 3

function wasmMirrorChain() { return WASM_MIRRORS.slice() }
function wasmModelUrl(mirror, file) { return mirror.base + '/' + WASM_MODEL_ID + '/resolve/main/' + file }
// 闲置判定：距 lastActivity 超过 idleMs → 允许预取（返回 true 才触发后台拉取）
function wasmShouldPrefetch(now, lastActivity, idleMs) {
  return now >= lastActivity + (typeof idleMs === 'number' && isFinite(idleMs) && idleMs >= 0 ? idleMs : WASM_PREFETCH_IDLE_MS)
}
// 单文件下载（进度回调 + Range 断点续传 + ETag/If-Range 校验）：
//   opts = { rangeStart?, expectedEtag?, onProgress?(loaded, total) }；返回 { bytes:Uint8Array, etag:string|null }。
//   进度：流式 body 分块回调累计字节（mock 侧 arrayBuffer 一次到顶）；Range/If-Range 头按需附加（下载纪律②）。
async function wasmDownloadFile(fetchImpl, url, opts) {
  opts = opts || {}
  const init = { method: 'GET' }
  const headers = {}
  if (opts.rangeStart > 0) headers['Range'] = 'bytes=' + opts.rangeStart + '-'
  if (opts.expectedEtag) headers['If-Range'] = opts.expectedEtag
  if (Object.keys(headers).length) init.headers = headers
  const res = await fetchImpl(url, init)
  if (!res || res.ok === false) throw new Error('wasm download failed: ' + url + ' (status ' + (res && res.status) + ')')
  const getHeader = function (k) { return (res.headers && typeof res.headers.get === 'function') ? res.headers.get(k) : (res.headers && res.headers[k]) }
  const etag = getHeader('etag') || null
  const total = parseInt(getHeader('content-length') || '0', 10) || 0
  let buf
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const chunks = []
    let loaded = 0
    for (;;) {
      const r = await reader.read()
      if (r.done) break
      chunks.push(r.value)
      loaded += r.value.length
      if (opts.onProgress) opts.onProgress(loaded, total)
    }
    buf = new Uint8Array(loaded)
    let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.length }
  } else {
    const ab = await res.arrayBuffer()
    buf = new Uint8Array(ab)
    if (opts.onProgress) opts.onProgress(buf.length, total || buf.length)
  }
  return { bytes: buf, etag: etag }
}
// 断点续传：从 resumeBytes 起，Range 续传 + If-Range 校验（ETag 完整性核对，下载纪律③）；失败重试 WASM_RESUME_MAX_TRIES 次。
async function wasmDownloadResumable(fetchImpl, url, opts) {
  opts = opts || {}
  const resumeBytes = Math.max(0, Math.floor(Number(opts.resumeBytes) || 0))
  const expectedEtag = opts.expectedEtag || null
  let lastErr = null
  for (let attempt = 0; attempt < WASM_RESUME_MAX_TRIES; attempt++) {
    try {
      return await wasmDownloadFile(fetchImpl, url, { rangeStart: resumeBytes, expectedEtag: expectedEtag, onProgress: opts.onProgress })
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('wasm download resumable failed: ' + url)
}
// 镜像链 failover：按序尝试 mirrors，成功返回 { bytes, etag, mirror }；全败抛错（上层降级承接，不刷屏）。
async function wasmDownloadWithFailover(fetchImpl, mirrors, file, opts) {
  const chain = (Array.isArray(mirrors) && mirrors.length) ? mirrors : wasmMirrorChain()
  let lastErr = null
  for (const m of chain) {
    try {
      const r = await wasmDownloadResumable(fetchImpl, wasmModelUrl(m, file), opts)
      return { bytes: r.bytes, etag: r.etag, mirror: m.id }
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('wasm model download failed on all mirrors: ' + file)
}
/* ==== wasm-embedder-core END ==== */

/* ==================================================================================
 * 浏览器 glue（app 页运行时；check 不执行——节 118 只 eval 上方 core 块行为级）。
 * ================================================================================== */
// 运行时库（transformers.js 浏览器 ESM，运行时动态 import，不进 npm 包）：
//   镜像链两环加载——模型走 hf-mirror（上文镜像链），库与模型两条链独立；
//   0.5.0④（notes-050-sem-settings）主窗口裁决：npmmirror 路线实证不可达（registry files/=403、cdn=404），
//   运行时改 jsdelivr 主 → unpkg 兜底（与模型链镜像哲学同款；模型链 hf-mirror→HF 官方不动）。
var WASM_RUNTIME_URLS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/dist/transformers.min.js',
  'https://unpkg.com/@huggingface/transformers@3.7.2/dist/transformers.min.js',
]
// 运行时库 failover import：按序尝试镜像链，成功返回模块；全败抛错（上层降级承接，不刷屏）。
async function wasmImportRuntime() {
  let lastErr = null
  for (const url of WASM_RUNTIME_URLS) {
    try { return await import(url) } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('wasm runtime import failed on all mirrors')
}

// 模型缓存（Cache API 优先；不可用回退内存 Map——OPFS 兜底不阻塞嵌入主流程）
var WASM_CACHE_NAME = 'dsh-notes-wasm-model'
var _wasmCachePromise = null
function _wasmCache() {
  if (!_wasmCachePromise) {
    _wasmCachePromise = (function () {
      try {
        if (typeof caches !== 'undefined' && typeof caches.open === 'function') return caches.open(WASM_CACHE_NAME)
      } catch (e) { /* 不可用 → 内存兜底 */ }
      return Promise.resolve(null)
    })()
  }
  return _wasmCachePromise
}

// 已下载大小（字节，从 Cache API 统计；无缓存 = 0）
function wasmModelDownloadedBytes() {
  return _wasmCache().then(function (cache) {
    if (!cache || typeof cache.keys !== 'function') return 0
    return cache.keys().then(function (keys) {
      if (!keys || !keys.length) return 0
      return Promise.all(keys.map(function (k) {
        return cache.match(k).then(function (r) { return r && r.arrayBuffer ? r.arrayBuffer() : new ArrayBuffer(0) })
      })).then(function (arrs) {
        let total = 0
        for (const a of arrs) total += (a && a.byteLength) || 0
        return total
      })
    })
  }).catch(function () { return 0 })
}

// 删除模型（Cache API 全清；设置「可删」入口，④卡 UI 消费）
function wasmModelDelete() {
  return _wasmCache().then(function (cache) {
    if (!cache || typeof cache.keys !== 'function') return 0
    return cache.keys().then(function (keys) {
      if (!keys || !keys.length) return 0
      return Promise.all(keys.map(function (k) { return cache.delete(k) })).then(function () { return keys.length })
    })
  }).catch(function () { return 0 })
}

// 显式下载（B 方案兜底：首次「构建索引」模型未下时带进度下载到 Cache API，再回写 host 设置「已下载大小」）
function wasmModelEnsureDownloaded(onProgress) {
  return _wasmCache().then(function (cache) {
    if (!cache) return Promise.reject(new Error('Cache API 不可用（离线/降级：嵌入回退纯文本）'))
    const files = WASM_MODEL_FILES.slice()
    const put = function (i) {
      if (i >= files.length) {
        return wasmModelDownloadedBytes().then(function (bytes) {
          return { ok: true, bytes: bytes, files: files.length }
        })
      }
      const file = files[i]
      return wasmDownloadWithFailover(fetch, null, file, { onProgress: function (loaded, total) {
        if (onProgress) onProgress(i, files.length, loaded, total)
      } }).then(function (r) {
        return cache.put('https://dsh-notes.wasm/' + file, new Response(r.bytes, { headers: { 'Content-Type': 'application/octet-stream', ETag: r.etag || '' } })).then(function () { return put(i + 1) })
      })
    }
    return put(0)
  })
}

// 静默预取（B+ 方案）：requestIdleCallback / 空闲探测——只在闲置时后台拉取，不打断任何交互；已有缓存零成本短路。
function wasmModelPrefetch() {
  const schedule = function (cb) {
    try {
      if (typeof requestIdleCallback === 'function') { requestIdleCallback(function () { cb() }, { timeout: 5000 }); return }
    } catch (e) {}
    setTimeout(cb, 0)
  }
  const go = function () {
    wasmModelDownloadedBytes().then(function (bytes) {
      if (bytes > 0) return   // 已下载零成本短路
      wasmModelEnsureDownloaded(function () {}).catch(function () { /* 预取失败静默降级，不打断交互不刷屏 */ })
    }).catch(function () { /* 外层静默：离线降级不刷屏 */ })
  }
  schedule(go)
}

// 状态查询（app 页/设置 UI 数据源）：{ backend, downloadedBytes, deletable }
function wasmModelStatus() {
  return wasmModelDownloadedBytes().then(function (bytes) {
    return { backend: 'bge-small-zh-q8', downloadedBytes: bytes, deletable: bytes > 0 }
  })
}

// 下载状态回写 host 设置（semantic.model「已下载大小/可删」数据源——面板设置区④卡读现成状态，不依赖 app 页在线）。
//   经 rpc('notes-settings-set') 增量合并（inject.js 白名单 model 键），失败静默（状态回写不是嵌入主流程前提）。
function wasmModelRecordState() {
  return wasmModelStatus().then(function (st) {
    try {
      if (typeof rpc === 'function') {
        return rpc('notes-settings-set', { semantic: { model: { backend: st.backend, bytes: st.downloadedBytes, downloadedAt: new Date().toISOString(), source: 'cache-api' } } })
      }
    } catch (e) { /* 静默降级 */ }
    return st
  })
}

// 分段嵌入（与 host _vectorChunks 同口径：≤1800 字符块、段落边界切、单段超长硬切；浏览器侧重建索引用）
function wasmChunkText(body) {
  const s = String(body == null ? '' : body)
  const MAX = 1800
  const out = []
  if (!s) return out
  if (s.length <= MAX) return [s]
  const lines = s.split(/\r?\n/)
  let cur = ''
  const flush = function () { if (cur) out.push(cur); cur = '' }
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (line.length > MAX) { flush(); while (line.length > MAX) { out.push(line.slice(0, MAX)); line = line.slice(MAX) }; if (line) cur = line; continue }
    if (cur.length === 0) { cur = line; continue }
    if (cur.length + 1 + line.length > MAX) { flush(); cur = line; continue }
    cur = cur + '\n' + line
  }
  flush()
  return out
}
// 正文稳定 hash（与 host _vectorBodyHash 同口径：FNV-1a 32bit + 长度；新鲜度锚，碰撞代价可接受）
function wasmBodyHash(body) {
  const s = String(body == null ? '' : body)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return s.length.toString(36) + '.' + h.toString(36)
}
// app 页「构建索引」编排（0.5.0④ notes-050-sem-settings，承接②遗留「真机首跑冒烟」）：
//   模型下载（带进度）→ transformers.js 运行时加载（镜像链 jsdelivr→unpkg）→ 全库可索引笔记分段嵌入（bge 512 维）→
//   notes-vectors-put 全量回写（replace:true 清空目标命名空间）。只跑在 app 页（wasm 运行时不进 host）；
//   任何一步失败抛错，由调用方（设置区构建按钮）承接回落 host rebuild / 静默降级。
async function wasmBuildIndex(onProgress) {
  await wasmModelEnsureDownloaded(onProgress)
  const mod = await wasmImportRuntime()
  if (mod && mod.env) { try { mod.env.allowLocalModels = false } catch (e) {}; try { mod.env.remoteHost = 'https://hf-mirror.com' } catch (e) {} }
  const extractor = await mod.pipeline('feature-extraction', WASM_MODEL_ID)
  const list = await rpc('notes-list', {})
  const notes = (list && list.notes) || []
  const rows = []
  for (const n of notes) {
    if (!n || !n.id || n.deleted === true || n.sensitive === true || (n.kind || 'note') === 'sys') continue
    const g = await rpc('notes-get', { id: n.id })
    const body = (g && g.note && g.note.body) || ''
    const chunks = wasmChunkText(body)
    if (!chunks.length) continue
    const out = await extractor(chunks, { pooling: 'mean', normalize: true })
    const tensors = Array.isArray(out) ? out : [out]
    const vecs = tensors.map(function (t) { return (t && typeof t.tolist === 'function') ? t.tolist() : Array.prototype.slice.call(t || []) })
    rows.push({ noteId: n.id, bodyHash: wasmBodyHash(body), vectors: vecs })
  }
  const put = await rpc('notes-vectors-put', { backend: 'bge-small-zh-q8', replace: true, rows: rows })
  await wasmModelRecordState()
  return put
}

/* ==================================================================================
 * wasm-in-panel 裁决（冻结风险项③，实证）：
 *   client 面板 bundle 现状 815KB（src/client/** 拼接，本卡实测）——面板是浮动轻量形态（可拖拽/半透明）。
 *   若在面板加载 wasm 后端需追加：transformers.js 浏览器 min ESM 867KB + ONNX wasm 10.6MB（simd-threaded）
 *   /20.6MB（jsep）+ 模型 23.32MB ≈ 34.8MB 运行时，面板体积放大 ~43×，且 wasm 初始化冷加载 3.3s 会卡面板首屏。
 *   裁决：嵌入只在 app 页（全窗口 app.html）跑；面板读现成向量（notes-vectors-search RPC）。落地锚点见 check 节 118。
 * ================================================================================== */
