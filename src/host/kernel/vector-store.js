    // ==== vector-store BEGIN ====（0.5.0① host 向量层 notes-050-vector-layer：语义检索地基——vectors.jsonl 边车 + backend 窄接口注册表 + 索引队列 + 分段嵌入 + 三条 RPC 通道）
    // 背景（冻结架构 [[n-muz9b97x35et]] + spike [[n-muz91f19rrqj]]）：语义检索 = 窄接口 + 可换后端 + 向量边车，缺省关闭零成本；
    //   本卡纯 host 地基（不动 UI）：真 wasm 后端是②卡、检索融合是③卡、设置区是④卡。
    // 文件：NOTES_DIR/vectors.jsonl（.jsonl 不进笔记列表天然隐身——_list 只认 .md；与 telemetry.json/settings.json 同目录纪律）。
    //   行格式（每行一条 JSON，墓碑删除 = 内存权威重写时整行缺席）：{ noteId, chunk, bodyHash, backend, vector }
    //   chunk = 块序（分段嵌入的块序号，0 起）；bodyHash = 全文稳定 hash（任何块变 → 全量重算该笔记，简化一致性）；
    //   vector = L2 归一化向量数组（实现方保证，查询侧只做点积）；backend = 后端 id（命名空间键）。
    // 命名空间：按 backend.id 分命名空间（换后端不重建、旧集保留秒切）——rebuild 只清空重建目标后端命名空间，其余保留。
    // 四纪律（抄 telemetry-store）：①内存增量 + 2s 防抖原子落盘（fs.writeText 底层 writeFileAtomic 自带原子——崩溃只留完整旧版/完整新版）；
    //   ②读失败 = 空库重建、写失败 = 内存续用（dirty 保持，下次防抖/flush 重试；全程静默降级，向量层永不阻塞保存主流程）；
    //   ③单写者——唯一写入方 = host 进程本模块（client/app 只经 RPC 读，构造性无双写）；
    //   ④sensitive===true 笔记索引层排除（正文永不进 embed 队列——红线；远程后端也天然安全）。
    // 索引队列：保存路径挂钩 = persist.js 的 onNoteChanged 事件总线（create/update/delete/restore/purge 统一分发），
    //   bodyHash 变才重算（增量）；软删出队（内存行删除，下次重写缺席）；sensitive/sys 排除；无激活后端 → 零成本不排队。
    // 分段嵌入裁决（spike 遗留 512 token 截断尾部不进向量）：正文按段落边界切成 ≤1800 字符块（≈512 token 中文安全线），
    //   每块一向量（chunk=块序）；短笔记单块零开销；单块全文 >1800 的硬切；bodyHash=全文 hash。
    // 窄接口契约：backend = { id, dim, minScore, embed(texts)→vectors }；minScore 由后端自报（bge-q8≥0.50 / emb-3≥0.40 校准值；
    //   本卡落注册表 + deterministic 假 embedder 桩（hash→单位向量，测试用），真 wasm 后端是②卡）。
    // 变体说明：VECTORS_PATH 常量在开发版由 vector-store.js 定义（NOTES_DIR 拼接），发布版由 head.js 定义（path.join(NOTES_ROOT,...)）——
    //   双包差异仅此一处，vector-store.dist.js 与本文档其余部分逐字节一致（节 117 看守）。
    const VECTORS_PATH = NOTES_DIR + '\\vectors.jsonl'
    const VECTOR_FLUSH_MS = 2000                    // 纪律①：内存增量 + 2s 防抖原子落盘（崩溃丢 ≤2s 增量可容忍）
    const VECTOR_CHUNK_MAX = 1800                   // 分段嵌入块上限（≈512 token 中文安全线）
    const VECTOR_DEFAULT_BACKEND = 'fake-256'       // 缺省后端（deterministic 假 embedder 桩）
    // 内存权威（读路径 status/search 现算的唯一数据源；跨 apply 由磁盘恢复）
    let _vectorCache = null
    let _vectorLoadPromise = null
    let _vectorDirty = false
    let _vectorFlushTimer = null
    let _vectorFlushChain = Promise.resolve()       // 写盘单链串行化（flush/rebuild 合并不交错；单写者进程内串行）
    let _vectorJobChain = Promise.resolve()         // 索引任务单链串行化（增量重算/重建顺序执行，不交错）
    // backend 注册表：id → { id, dim, minScore, embed }（窄接口；换后端 = 注册新条目 + 换命名空间，旧集保留）
    const _vectorBackends = new Map()
    function _vectorRegisterBackend(b) {
      if (!b || typeof b.id !== 'string' || !b.id || typeof b.dim !== 'number' || !isFinite(b.dim) || b.dim <= 0 || typeof b.embed !== 'function') return false
      const minScore = (typeof b.minScore === 'number' && isFinite(b.minScore)) ? b.minScore : 0
      _vectorBackends.set(b.id, { id: b.id, dim: Math.floor(b.dim), minScore: minScore, embed: b.embed })
      return true
    }
    function _vectorBackendById(id) {
      return (typeof id === 'string' && id) ? (_vectorBackends.get(id) || null) : null
    }
    // deterministic 假 embedder 桩（测试用，hash→单位向量）：FNV-1a 32bit 种子 + mulberry32 PRNG → dim 维 L2 归一化向量。
    //   同一文本 + 同 dim → 恒同向量（cosine=1）；不同文本 → 近似正交（cosine≈0）——查询命中等价于块文本精确命中。
    function _vectorFnv1a(str) {
      let h = 0x811c9dc5
      for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0
      return h
    }
    function _vectorMulberry32(seed) {
      let s = seed >>> 0
      return function () {
        s = (s + 0x6D2B79F5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    function _vectorFakeEmbedOne(text, dim) {
      const rnd = _vectorMulberry32(_vectorFnv1a(String(text == null ? '' : text)))
      const v = new Array(dim)
      let sq = 0
      for (let i = 0; i < dim; i++) { const x = rnd() * 2 - 1; v[i] = x; sq += x * x }
      const n = Math.sqrt(sq) || 1
      for (let i = 0; i < dim; i++) v[i] = v[i] / n
      return v
    }
    function _vectorFakeBackend(id, dim, minScore) {
      return { id: id, dim: dim, minScore: minScore, embed: async function (texts) { return (texts || []).map(function (t) { return _vectorFakeEmbedOne(t, dim) }) } }
    }
    _vectorRegisterBackend(_vectorFakeBackend('fake-256', 256, 0))
    _vectorRegisterBackend(_vectorFakeBackend('fake-64', 64, 0.9))
    // 0.5.0②（notes-050-wasm-embedder）：真 wasm 后端 bge-small-zh-q8（transformers.js 浏览器端 bge，dim=512/minScore=0.50 校准值）。
    //   embed 只在浏览器端可运行（wasm 运行时不进 host——红线：正文不出机器，本地 wasm 路线本质保证）；
    //   host 侧本注册仅承载 status/search 的 dim/minScore 自报 + 命名空间键 + 边车落行校验口径；
    //   索引/查询嵌入由浏览器驱动：浏览器算向量 → notes-vectors-put 回写边车（_vectorsPut）；查询嵌入经 notes-vectors-search queryVector（③消费）。
    _vectorRegisterBackend({ id: 'bge-small-zh-q8', dim: 512, minScore: 0.50, embed: async function () { throw new Error('bge-small-zh-q8 嵌入只在浏览器端运行（wasm）；请经 notes-vectors-put 回写向量 / notes-vectors-search queryVector 查询') } })
    // bodyHash：全文稳定 hash（FNV-1a 32bit + 长度，纯 JS 无 crypto 依赖——vm 沙箱无 node:crypto，同 history engine 先例）。
    //   任何块变 → 全量重算该笔记（简化一致性）；只用于新鲜度锚，碰撞代价 = 漏一次重算或多一次重算（可接受）。
    function _vectorBodyHash(body) {
      const s = String(body == null ? '' : body)
      let h = 0x811c9dc5
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
      return s.length.toString(36) + '.' + h.toString(36)
    }
    // 分段嵌入：正文按段落边界切成 ≤VECTOR_CHUNK_MAX 字符块；短笔记单块零开销；单段超长硬切；空正文零块。
    function _vectorChunks(body) {
      const s = String(body == null ? '' : body)
      const MAX = VECTOR_CHUNK_MAX
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
    // 索引面判定：可索引 = 非删除、非墓碑、非 sensitive（红线：正文永不进 embed 队列）、非 sys（跟随搜索面缺省降噪，spike 冻结）。
    function _vectorIndexable(n) {
      return !!(n && n.id && n.deleted !== true && n.tombstoned !== true && n.sensitive !== true && n.kind !== 'sys')
    }
    // 激活后端（同步读 settingsCache；缺省关闭零成本）：semantic.enabled===true 且 semantic.backend 在册 → 该后端；backend 缺省回落 VECTOR_DEFAULT_BACKEND。
    function _activeBackend() {
      const s = settingsCache && settingsCache.semantic
      if (!s || s.enabled !== true) return null
      const id = (typeof s.backend === 'string' && s.backend && _vectorBackends.has(s.backend)) ? s.backend : VECTOR_DEFAULT_BACKEND
      return _vectorBackends.get(id) || null
    }
    function _vectorNewNs() { return { hash: {}, rows: {}, lastBuiltAt: '' } }
    function _vectorNewEmpty() { return { ns: {} } }
    function _vectorCountNs(ns) {
      if (!ns) return 0
      let n = 0
      for (const id of Object.keys(ns.rows)) { if (ns.rows[id] && ns.rows[id].length) n++ }
      return n
    }
    // 启动加载（memoized 单飞）：文件坏/不存在 → 空库重建（纪律②）；全程静默，不抛错。
    function _vectorLoad() {
      if (!_vectorLoadPromise) {
        _vectorLoadPromise = (async () => {
          try {
            const p = await fs.resolve(VECTORS_PATH)
            _vectorCache = _vectorParse(await fs.readText(p))
          } catch (e) { _vectorCache = _vectorNewEmpty() }
          return _vectorCache
        })()
      }
      return _vectorLoadPromise
    }
    // JSONL 反序列化：逐行解析，坏行/缺键静默跳过（前向兼容）；rows 按 chunk 序排序。
    function _vectorParse(text) {
      const c = _vectorNewEmpty()
      const lines = String(text == null ? '' : text).split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        let row
        try { row = JSON.parse(line) } catch (e) { continue }
        if (!row || typeof row !== 'object' || !row.noteId || typeof row.backend !== 'string' || !Array.isArray(row.vector) || !row.vector.length) continue
        const ns = c.ns[row.backend] || (c.ns[row.backend] = _vectorNewNs())
        const rows = ns.rows[row.noteId] || (ns.rows[row.noteId] = [])
        rows.push({ chunk: Math.max(0, Math.floor(Number(row.chunk) || 0)), vector: row.vector.map(Number) })
        if (row.bodyHash) ns.hash[row.noteId] = String(row.bodyHash)
      }
      for (const bid of Object.keys(c.ns)) {
        for (const nid of Object.keys(c.ns[bid].rows)) {
          c.ns[bid].rows[nid].sort(function (a, b) { return a.chunk - b.chunk })
        }
      }
      return c
    }
    // JSONL 序列化：每向量一行 { noteId, chunk, bodyHash, backend, vector }（compact，与落盘字节同口径）。
    function _vectorSerialize(c) {
      const lines = []
      for (const bid of Object.keys(c.ns)) {
        const ns = c.ns[bid]
        for (const nid of Object.keys(ns.rows)) {
          const hash = ns.hash[nid] || ''
          const rows = ns.rows[nid] || []
          for (let i = 0; i < rows.length; i++) lines.push(JSON.stringify({ noteId: nid, chunk: rows[i].chunk, bodyHash: hash, backend: bid, vector: rows[i].vector }))
        }
      }
      return lines.join('\n') + (lines.length ? '\n' : '')
    }
    // 防抖调度（纪律①）：脏标记 + 2s 定时器（已挂不重复；unref 不阻塞进程退出）
    function _vectorScheduleFlush() {
      _vectorDirty = true
      if (_vectorFlushTimer) return
      _vectorFlushTimer = setTimeout(function () { _vectorFlushTimer = null; _vectorFlush() }, VECTOR_FLUSH_MS)
      if (_vectorFlushTimer && typeof _vectorFlushTimer.unref === 'function') _vectorFlushTimer.unref()
    }
    // 落盘单点（纪律①②）：链内串行（不交错）→ 原子写；非脏零写（空转幂等）；写失败 = 内存续用（dirty 保持，静默降级）
    function _vectorFlush() {
      const run = _vectorFlushChain.then(async function () {
        const c = _vectorCache
        if (!c || !_vectorDirty) return
        try {
          const p = await fs.resolve(VECTORS_PATH)
          await fs.writeText(p, _vectorSerialize(c), undefined, undefined, getPolicy())
          _vectorDirty = false
        } catch (e) { /* 纪律②：写失败内存续用（dirty 保持待重试），静默不扩散 */ }
      })
      _vectorFlushChain = run.then(function () {}, function () {})   // 失败不断链
      return run
    }
    // 索引任务单链入队（增量重算/重建顺序执行，不交错；失败不断链）
    function _vectorEnqueue(fn) {
      const run = _vectorJobChain.then(fn, fn)
      _vectorJobChain = run.then(function () {}, function () {})
      return run
    }
    // 从命名空间移除单笔记（墓碑/软删/sensitive/sys/purge 共用）；返回是否有真实移除（置脏依据）
    function _vectorDropFromNs(ns, id) {
      if (!ns) return false
      const hadRows = !!(ns.rows[id] && ns.rows[id].length)
      const hadHash = !!ns.hash[id]
      delete ns.rows[id]
      delete ns.hash[id]
      return hadRows || hadHash
    }
    // 单笔记增量索引（保存路径挂钩 job）：可索引 → bodyHash 变才重算（分段嵌入）；不可索引（sensitive/sys/deleted）→ 移除。
    async function _vectorIndexNote(n) {
      try {
        if (!n || !n.id) return
        await _vectorLoad()
        const backend = _activeBackend()
        if (!backend) return
        const c = _vectorCache
        const ns = c.ns[backend.id] || (c.ns[backend.id] = _vectorNewNs())
        if (!_vectorIndexable(n)) {
          // 0.5.0③（notes-050-rrf-fusion）：非可索引 → 全命名空间出队（残留集不泄漏敏感向量；与 _vectorDropNote 同口径；防御直调路径）
          let changed = false
          for (const bid of Object.keys(c.ns)) { if (_vectorDropFromNs(c.ns[bid], n.id)) changed = true }
          if (changed) _vectorScheduleFlush()
          return
        }
        const hash = _vectorBodyHash(n.body)
        if (ns.hash[n.id] === hash && ns.rows[n.id]) return   // bodyHash 未变 → 不重算（增量）
        const chunks = _vectorChunks(n.body)
        const vecs = await backend.embed(chunks)
        const rows = []
        for (let i = 0; i < vecs.length; i++) rows.push({ chunk: i, vector: vecs[i] })
        ns.rows[n.id] = rows
        ns.hash[n.id] = hash
        _vectorScheduleFlush()
      } catch (e) { /* 静默降级：向量层故障绝不阻塞保存主流程 */ }
    }
    // 事件总线监听（保存路径挂钩）：purge 只带 id → 全命名空间出队；非可索引（sensitive/sys/deleted/tombstoned）→ 全命名空间出队（0.5.0③ sensitive 翻转红线）；
    //   可索引 → 读激活后端增量索引（无激活 → 零成本不排队）。
    function _vectorOnNoteChanged(ev) {
      if (!ev) return
      const id = (ev && ev.id) || (ev.note && ev.note.id)
      if (!id) return
      if (ev.event === 'purge') { _vectorEnqueue(function () { return _vectorDropNote(id) }); return }
      const n = ev.note
      if (!n) return
      // 0.5.0③（notes-050-rrf-fusion）：sensitive 翻转红线——非可索引 → 全命名空间出队（与 purge 同通道；残留集不泄漏敏感向量；
      //   即使当时语义已关，只要向量缓存曾加载（曾有过索引）就出队，杜绝「关语义 → 翻转 sensitive → 再开语义」残留面泄漏）
      if (!_vectorIndexable(n)) {
        if (_vectorCache || _vectorLoadPromise) _vectorEnqueue(function () { return _vectorDropNote(id) })
        return
      }
      if (!_activeBackend()) return
      _vectorEnqueue(function () { return _vectorIndexNote(n) })
    }
    // purge：全命名空间出队（墓碑——彻底删除后向量不复存在）
    async function _vectorDropNote(id) {
      try {
        await _vectorLoad()
        const c = _vectorCache
        let changed = false
        for (const bid of Object.keys(c.ns)) { if (_vectorDropFromNs(c.ns[bid], id)) changed = true }
        if (changed) _vectorScheduleFlush()
      } catch (e) {}
    }
    // 余弦相似度（两向量点积 / 范数积；零范数 → 0）
    function _vectorCosine(a, b) {
      if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0
      const n = Math.min(a.length, b.length)
      let dot = 0, na = 0, nb = 0
      for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
      const den = Math.sqrt(na) * Math.sqrt(nb)
      return den > 0 ? dot / den : 0
    }
    // 全量重建（notes-vectors-rebuild 入口）：只清空重建目标后端命名空间（换后端不重建、旧集保留）；全库扫描 + 分段嵌入。
    async function _vectorsRebuild(backendId) {
      try {
        await loadSettings()
        const backend = _vectorBackendById(backendId) || _activeBackend()
        if (!backend) return { error: 'notes-vectors-rebuild: 未知后端 ' + String(backendId || '') + '（且无激活后端）' }
        await _vectorLoad()
        await _vectorJobChain   // 等待在飞增量（顺序一致）
        const c = _vectorCache
        const ns = _vectorNewNs()
        const all = await _list(undefined, undefined, undefined, false, false, true)   // 含 sys（重建期统一 _vectorIndexable 过滤）
        let indexed = 0
        for (const n of all) {
          if (!_vectorIndexable(n)) continue
          const chunks = _vectorChunks(n.body)
          if (!chunks.length) continue
          const vecs = await backend.embed(chunks)
          const rows = []
          for (let i = 0; i < vecs.length; i++) rows.push({ chunk: i, vector: vecs[i] })
          ns.rows[n.id] = rows
          ns.hash[n.id] = _vectorBodyHash(n.body)
          indexed++
        }
        ns.lastBuiltAt = new Date().toISOString()
        c.ns[backend.id] = ns   // 覆盖该命名空间（其余命名空间保留）
        _vectorDirty = true
        await _vectorFlush()
        return { ok: true, backend: backend.id, dim: backend.dim, minScore: backend.minScore, indexed: indexed, indexable: all.filter(_vectorIndexable).length, lastBuiltAt: ns.lastBuiltAt }
      } catch (e) { return { error: String(e.message || e) } }
    }
    // 状态（notes-vectors-status 入口）：N/M 篇·后端·上次构建·各命名空间统计
    async function _vectorsStatus() {
      try {
        await loadSettings()
        await _vectorLoad()
        await _vectorJobChain
        await _vectorFlush()
        const c = _vectorCache
        const backend = _activeBackend()
        let indexable = 0
        try { indexable = (await _list(undefined, undefined, undefined, false, false, true)).filter(_vectorIndexable).length } catch (e) { indexable = 0 }
        const namespaces = []
        // 0.5.0③（notes-050-rrf-fusion）：激活后端命名空间即使零向量也报自报 dim/minScore（status 契约：激活后端恒可见——bge 未建索引也报 512/0.50）
        const nsIds = new Set(Object.keys(c.ns))
        if (backend) nsIds.add(backend.id)
        for (const bid of Array.from(nsIds).sort()) {
          const ns = c.ns[bid]
          const b = _vectorBackends.get(bid)
          namespaces.push({ backend: bid, dim: b ? b.dim : 0, minScore: b ? b.minScore : 0, count: _vectorCountNs(ns), lastBuiltAt: (ns && ns.lastBuiltAt) || '' })
        }
        return {
          ok: true,
          enabled: !!(settingsCache && settingsCache.semantic && settingsCache.semantic.enabled === true),
          backend: backend ? backend.id : null,
          indexed: backend ? _vectorCountNs(c.ns[backend.id]) : 0,
          indexable: indexable,
          lastBuiltAt: (backend && c.ns[backend.id]) ? c.ns[backend.id].lastBuiltAt : '',
          namespaces: namespaces
        }
      } catch (e) { return { error: String(e.message || e) } }
    }
    // 检索（notes-vectors-search 入口，③卡消费）：queryVector 或 query（内部 embed）→ 余弦 + minScore 过滤 + per-note max-pooling。
    async function _vectorsSearch(args) {
      try {
        await loadSettings()
        const a = args || {}
        const backend = _vectorBackendById(a.backend) || _activeBackend()
        if (!backend) return { error: 'notes-vectors-search: 未知后端 ' + String(a.backend || '') + '（且无激活后端）' }
        let q = null
        if (Array.isArray(a.queryVector) && a.queryVector.length) q = a.queryVector.map(Number)
        else if (typeof a.query === 'string' && a.query) { const vv = await backend.embed([a.query]); q = vv && vv[0] }
        if (!q || !q.length) return { error: 'notes-vectors-search: 需要 queryVector（数组）或 query（文本）' }
        await _vectorLoad()
        await _vectorJobChain
        const c = _vectorCache
        const ns = c.ns[backend.id]
        if (!ns) return { ok: true, backend: backend.id, dim: backend.dim, minScore: backend.minScore, results: [], count: 0 }
        const results = []
        for (const nid of Object.keys(ns.rows)) {
          const rows = ns.rows[nid] || []
          let best = -2, bestChunk = -1
          for (const r of rows) {
            const cos = _vectorCosine(q, r.vector)
            if (cos > best) { best = cos; bestChunk = r.chunk }
          }
          if (best >= backend.minScore) results.push({ noteId: nid, score: best, chunk: bestChunk })
        }
        results.sort(function (x, y) { return y.score - x.score })
        const lim = Math.max(0, Math.floor(Number(a.limit) || 0)) || results.length
        const page = results.slice(0, lim)
        return { ok: true, backend: backend.id, dim: backend.dim, minScore: backend.minScore, results: page, count: page.length }
      } catch (e) { return { error: String(e.message || e) } }
    }
    // 浏览器回写（notes-vectors-put 入口，②卡落通道）：浏览器 wasm 算好的向量 → 经索引队列写边车（①的队列消费位）。
    // args = { backend, rows:[{ noteId, bodyHash, vectors:[vec0,vec1,...] }], replace? }
    //   vectors = 该笔记分段块的 L2 归一化向量数组（实现方保证，dim 由本函数写前校验）；chunk = 数组下标（与 _vectorIndexNote 同口径）。
    //   replace:true = 先清空目标命名空间再写（浏览器全量重建路径）；缺省 = 增量 upsert（单笔记重算，bodyHash 新鲜度锚照存）。
    // 纪律：写入并入 _vectorJobChain 单链（与增量/重建顺序一致不交错）；写失败 = 内存续用（静默降级，同 _vectorIndexNote）。
    async function _vectorsPut(args) {
      try {
        await loadSettings()
        const a = args || {}
        const backend = _vectorBackendById(a.backend)
        if (!backend) return { error: 'notes-vectors-put: 未知后端 ' + String(a.backend || '') }
        if (!Array.isArray(a.rows)) return { error: 'notes-vectors-put: 需要 rows 数组（[{ noteId, bodyHash, vectors }]）' }
        await _vectorLoad()
        const dim = backend.dim
        return await _vectorEnqueue(async function () {
          const c = _vectorCache
          let ns = c.ns[backend.id]
          if (a.replace === true || !ns) { ns = _vectorNewNs(); c.ns[backend.id] = ns }
          let written = 0, skipped = 0
          for (const r of a.rows) {
            if (!r || typeof r.noteId !== 'string' || !r.noteId) { skipped++; continue }
            if (!Array.isArray(r.vectors) || !r.vectors.length) { skipped++; continue }
            const rows = []
            let bad = false
            for (let i = 0; i < r.vectors.length; i++) {
              const v = r.vectors[i]
              if (!Array.isArray(v) || v.length !== dim) { bad = true; break }
              rows.push({ chunk: i, vector: v.map(Number) })
            }
            if (bad) { skipped++; continue }
            ns.rows[r.noteId] = rows
            ns.hash[r.noteId] = (typeof r.bodyHash === 'string' && r.bodyHash) ? r.bodyHash : ''
            written++
          }
          if (a.replace === true) ns.lastBuiltAt = new Date().toISOString()
          if (written > 0 || a.replace === true) _vectorScheduleFlush()
          return { ok: true, backend: backend.id, dim: dim, written: written, skipped: skipped, count: _vectorCountNs(ns) }
        })
      } catch (e) { return { error: String(e.message || e) } }
    }
    // 事件总线注册（保存路径挂钩）：persist.js 的 onNoteChanged 在 manifest 序中先于本模块（kernel/persist.js 序位）。
    onNoteChanged(_vectorOnNoteChanged)
    // ==== vector-store END ====
