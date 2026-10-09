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
    let _vectorJobChain = Promise.resolve()         // 索引任务单链串行化（drain/重建/put 顺序执行，不交错）
    // 0.5.0 R2（notes-051-save-embed）：保存即嵌入 drain 接通——变更入队（bodyHash 机制不变）→ 2s 防抖微批 drain
    //   （单批 ≤8 块，与 R1 并发闸批上限同口径）→ 落边车（保存→可搜延迟目标 <5s）。防抖合并：同 id 重复变更合并为一次嵌入
    //   （连改 N 次只 embed 一次）；挂起队列只存 id——drain 时经 cache 取 drain 时刻最新版（快照竞态构造性消除：
    //   入队后删除/再改/敏感翻转都以内存权威为准，旧快照永不嵌入）。
    //   失败不丢（红线）：embed 失败（如模型未下载）整批 id 重排回挂起队列 + _vectorPendingErr 显性（status.pending/pendingError
    //   可见），不自动重试（持续故障防抖 hammer——下次变更/status/search/rebuild 触发重排）；语义关闭期间入队丢弃（重开由 rebuild 回填）。
    const VECTOR_DRAIN_MS = 2000                    // 保存即嵌入防抖窗口（与 telemetry-store 同款 2s 防抖纪律）
    let _vectorPending = new Map()                  // 挂起队列：id → true（Set 语义；同 id 重复入队 = 防抖合并）
    let _vectorDrainTimer = null
    let _vectorPendingErr = ''                      // 最近一次 drain 失败原因（status 显性面；成功清零）
    // backend 注册表：id → { id, dim, minScore, embed }（窄接口；换后端 = 注册新条目 + 换命名空间，旧集保留）
    const _vectorBackends = new Map()
    function _vectorRegisterBackend(b) {
      if (!b || typeof b.id !== 'string' || !b.id || typeof b.dim !== 'number' || !isFinite(b.dim) || b.dim <= 0 || typeof b.embed !== 'function') return false
      const minScore = (typeof b.minScore === 'number' && isFinite(b.minScore)) ? b.minScore : 0
      _vectorBackends.set(b.id, { id: b.id, dim: Math.floor(b.dim), minScore: minScore, embed: b.embed, hostEmbed: b.hostEmbed !== false })
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
    // 0.5.0 R1（notes-051-host-embedder）：host embedder 内核——bge 嵌入迁回 host 进程（spike② 实证配置落地，嵌入面迁回 host 的第一步）。
    //   路线：onnxruntime-web 纯 wasm 在宿主进程跑 bge（正文不出机器红线不变——本地推理本质保证；npm overrides 桩化 onnxruntime-node/sharp，
    //   原生 binding/@img 零进安装树——进程退出 0xC0000005 崩溃回归闸）；浏览器端 app 页构建通道（notes-vectors-put 回写）保留并存，UI 迁移是后续卡。
    //   懒加载单例：首次调用才 import 运行时 + 加载模型（缺省关闭零成本——不进 embed 则零 import 零下载）；
    //   并发闸 = 嵌入串行化队列（单飞链，失败不断链）；批上限 ≤8 块/批（防 spike 实测大批次 +4.3GB 内存峰）；
    //   模型 host 缓存 BGE_MODEL_CACHE_DIR（镜像链 hf-mirror→HF failover，Node 无 CORS 直连）。
    //   rev2（Verifier 驳回修复 + 深查）：零原生保证从「npm overrides 桩化」（仅安装根生效，部署布局失效）升级为「transformers 恒走
    //   web 构建显式文件 URL 导入」——node 构建顶层静态 import onnxruntime-node/sharp（与槽位注入无关，部署布局即 0xC0000005），
    //   web 构建里二者是 webpack ignored 空壳（构造性零原生）；模型缓存改走 env.customCache 官方钩子（web 构建 FileCache 死代码），
    //   overrides 桩化保留（仓库安装树卫生 + 纵深防御，断言面不撤）。另灭第二个独立崩溃源：多线程 wasm 的 pthread Worker 池在
    //   进程退出阶段拆卸间歇 0xC0000005（与原生 DLL 无关，repo 布局 8 跑 2 崩实测）——ort.env.wasm.numThreads = 1 单线程闸。
    // ==== host-embedder BEGIN ====
    const VECTOR_EMBED_BATCH_MAX = 8                  // 批上限（spike② 实测大批次内存峰 +4.3GB）
    const BGE_MODEL_ID = 'Xenova/bge-small-zh-v1.5'   // bge-small-zh-v1.5 q8（dim=512）
    // 镜像链单一事实源（server.dist.js 模型代理复用本表——抽公共）：hf-mirror → huggingface.co（jsDelivr 已砍，红线不动）
    const BGE_MODEL_MIRRORS = [
      { id: 'hf-mirror', base: 'https://hf-mirror.com' },
      { id: 'hf-official', base: 'https://huggingface.co' },
    ]
    let _bgeLoadPromise = null                        // 懒加载单例单飞（成功常驻；失败复位，下次调用重试）
    let _bgeGateChain = Promise.resolve()             // 并发闸：嵌入串行化队列（单飞链；失败不断链，同 _vectorFlushChain 先例）
    // 依赖动态 import：裸标识符优先（ESM 静态包/常规 cwd 走包 exports 的 import/node 条件——spike② 同路径）；
    //   失败兜底插件根 createRequire 解到入口文件 URL 再 import（开发版 new Function 沙箱/非常规 cwd 下裸标识符解析不稳）。
    //   只用于 onnxruntime-web（纯 wasm 包，任意构建形态零原生引用）——transformers 严禁走这里（见 _bgeImportTransformers 注释）。
    async function _bgeImport(pkgName) {
      try { return await import(pkgName) } catch (e) {
        const modM = await import('node:module')
        const pathM = await import('node:path')
        const urlM = await import('node:url')
        const req = modM.createRequire(pathM.join(HOST_PKG_DIR, 'package.json'))
        return import(urlM.pathToFileURL(req.resolve(pkgName)).href)
      }
    }
    // transformers 恒走 web 构建显式文件 URL（notes-051 驳回修复——部署布局零原生硬性面，与安装布局无关的构造性保证）：
    //   包 exports 的 node 条件把裸 import('@huggingface/transformers') 导向 dist/transformers.node.mjs——其顶层静态 import
    //   onnxruntime-node + sharp（无条件加载，与 ORT 槽位注入无关——槽位只控推理后端选择，不控模块加载）；npm 忽略依赖自带的
    //   overrides（overrides 仅安装根生效），真实部署布局（DSH profile 经 link: 安装发布包）下真 onnxruntime-node@1.21.0 +
    //   sharp@0.34.5 进安装树 → 原生 DLL 加载 → 嵌入完成后进程退出阶段 0xC0000005 崩溃（Verifier 消费布局探针 4 跑 2 崩实证，
    //   exit=-1073740940）。web 构建（dist/transformers.web.js）里这两个依赖是 webpack ignored 空壳（构造上零引用），
    //   唯一静态外部依赖 = onnxruntime-common + onnxruntime-web（纯 JS/wasm），ORT 槽位注入点同源在案
    //   （web.js: const ORT_SYMBOL = Symbol.for('onnxruntime')）——浏览器/host 共用同一 wasm 构建，任何安装布局构造性零原生。
    //   解析口径：createRequire 解包入口（node+require 条件 → dist/transformers.node.cjs，仅 resolve 取路径、文件不加载）
    //   → 同目录 transformers.web.js → file:/// URL 动态 import。exports 未开放子路径，故不裸引子路径（ERR_PACKAGE_PATH_NOT_EXPORTED）。
    async function _bgeImportTransformers() {
      const modM = await import('node:module')
      const pathM = await import('node:path')
      const urlM = await import('node:url')
      const req = modM.createRequire(pathM.join(HOST_PKG_DIR, 'package.json'))
      const entry = req.resolve('@huggingface/transformers')   // 仅取路径定位包目录（node.cjs 不被加载）
      const webJs = pathM.join(pathM.dirname(entry), 'transformers.web.js')
      return import(urlM.pathToFileURL(webJs).href)
    }
    // 模型缓存键归一（customCache match/put 共用）：剥协议+宿主前缀、剥 /resolve/<rev>/ 段、剥前导斜杠 → 磁盘相对路径
    //   （形如 Xenova/bge-small-zh-v1.5/onnx/model_quantized.onnx——与 transformers FileCache 键口径一致，旧缓存直接命中；
    //   localPath 键（/models/Xenova/...）与 remoteURL 键（https://host/.../resolve/main/...）归一到同一磁盘路径，跨镜像命中一致）。
    //   穿越闸：空/'..'/反斜杠/盘符冒号 → null（match 按 miss 处理、put 落拒不写盘）。
    function _bgeCacheKeyRel(key) {
      let k = String(key == null ? '' : key)
      const hm = k.match(/^https?:\/\/[^/]+\/(.+)$/)
      if (hm) k = hm[1]
      k = k.replace(/^\/+/, '').replace(/\/resolve\/[^/]+\//, '/')
      if (!k || k.indexOf('..') >= 0 || k.indexOf('\\') >= 0 || k.indexOf(':') >= 0) return null
      return k
    }
    // 懒加载（spike② 实证配置照抄）：① ORT 预配置 + 全局槽位注入（必须先于 transformers 导入）→ ② web 构建动态 import
    //   + 恒等断言 override 生效 → ③ 模型 host 缓存（customCache 钩子）+ 镜像链逐环加载（device:'auto'——Node 缺省 cpu 会被
    //   deviceToExecutionProviders 拒，spike 反证实证）
    async function _bgeLoad() {
      if (!_bgeLoadPromise) {
        _bgeLoadPromise = (async () => {
          // ① onnxruntime-web 预配置 + 注入全局 ORT 槽位（transformers.js backends/onnx.js：ORT_SYMBOL in globalThis → 用注入的
          //   web 版 env，完全不碰 onnxruntime-node 推理路径——原生 binding 零加载）
          const ortNs = await _bgeImport('onnxruntime-web')
          const ort = ortNs.default ?? ortNs   // CJS/ESM interop 兼容（spike② 同）
          // wasmPaths 指向本地 dist（不设则 onnx.js 默认改 jsdelivr CDN）；必须 file:/// URL 形式
          //   （ort-web 用动态 import() 加载 wasm 的 .mjs 包装器，裸 Windows 路径会被 ESM loader 拒 protocol 'd:'）
          const modM = await import('node:module')
          const pathM = await import('node:path')
          const urlM = await import('node:url')
          const fsM = await import('node:fs')
          const req = modM.createRequire(pathM.join(HOST_PKG_DIR, 'package.json'))
          ort.env.wasm.wasmPaths = urlM.pathToFileURL(pathM.dirname(req.resolve('onnxruntime-web'))).href + '/'
          // wasm 单线程闸（rev2 深查修复——间歇 0xC0000005 根因）：多线程 wasm = emscripten pthread 借 node Worker 线程，
          //   进程退出阶段线程池拆卸间歇访问冲突（repo 布局 8 跑 2 崩实测，exit=-1073740940——与原生 DLL 无关的第二个崩溃源，
          //   spike② 小样本未暴露）；numThreads=1 → 无线程池零拆卸面。必须先于 InferenceSession.create（建会话后改无效）。
          ort.env.wasm.numThreads = 1
          globalThis[Symbol.for('onnxruntime')] = ort
          // ② web 构建显式导入（严禁裸标识符——node 构建顶层静态加载 onnxruntime-node/sharp，部署布局 0xC0000005 驳回面）
          //   + 恒等断言：内部 ONNX env 必须就是注入的 web 版 env
          const tf = await _bgeImportTransformers()
          const env = tf.env
          if (!env || !env.backends || env.backends.onnx !== ort.env) throw new Error('bge embedder: ORT override 未生效（后端仍是 onnxruntime-node）')
          // ③ 模型 host 缓存：web 构建 node:fs 被 webpack 忽略（FileCache/FileResponse 死代码，useFSCache 恒 false）→
          //   env 官方 customCache 钩子（useCustomCache + customCache.match/put，Web Cache API 形态）用 node:fs 自建磁盘缓存：
          //   match 命中 → Response(字节)（Node ≥18 全局 Response；instanceof Response 成立 → buffer 读路径；return_path=
          //   IS_NODE_ENV && useFSCache=false → InferenceSession.create(Uint8Array)，ort-web wasm 直吃字节——D:\tmp\sem-spike2
          //   \probe-web.mjs 实证 dim=512/L2=1.000000/零原生/exit 0）；miss → 镜像链下载 → put 落盘（.tmp-<pid>-<rand> + rename
          //   原子写，崩溃不留半截模型；万一损坏删 BGE_MODEL_CACHE_DIR 即自愈）。
          env.useFSCache = false
          env.useCustomCache = true
          env.customCache = {
            match: async function (key) {
              const rel = _bgeCacheKeyRel(key)
              if (!rel) return undefined
              try { return new Response(await fsM.promises.readFile(pathM.join.apply(null, [BGE_MODEL_CACHE_DIR].concat(rel.split('/'))))) } catch (e) { return undefined }
            },
            put: async function (key, response) {
              const rel = _bgeCacheKeyRel(key)
              if (!rel) return
              const p = pathM.join.apply(null, [BGE_MODEL_CACHE_DIR].concat(rel.split('/')))
              const buf = Buffer.from(await response.arrayBuffer())
              await fsM.promises.mkdir(pathM.dirname(p), { recursive: true })
              const tmp = p + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
              await fsM.promises.writeFile(tmp, buf)
              await fsM.promises.rename(tmp, p)
            },
          }
          env.allowLocalModels = false
          let lastErr = null
          for (const m of BGE_MODEL_MIRRORS) {
            try {
              env.remoteHost = m.base
              return await tf.pipeline('feature-extraction', BGE_MODEL_ID, { dtype: 'q8', device: 'auto' })
            } catch (e) { lastErr = e }
          }
          throw lastErr || new Error('bge embedder: 模型加载失败（镜像链全环失败）')
        })()
        _bgeLoadPromise.catch(function () { _bgeLoadPromise = null })   // 失败复位待重试；成功常驻单例
      }
      return _bgeLoadPromise
    }
    // 单批推理（并发闸内串行调用）。测试缝 globalThis.__DSH_NOTES_BGE_INFER__：check 注假推理器（真模型不进 CI；生产永不设置）。
    async function _bgeInferBatch(batch) {
      const fake = (typeof globalThis !== 'undefined') ? globalThis.__DSH_NOTES_BGE_INFER__ : null
      if (typeof fake === 'function') return fake(batch)
      const extractor = await _bgeLoad()
      const out = await extractor(batch, { pooling: 'cls', normalize: true })
      const dims = out.dims || []
      const dim = Math.floor(Number(dims[dims.length - 1])) || 512
      // 形状归一：tolist()=[n][512] 优先（0.5.0 P0-2 教训——Tensor 形状显式校验，不静默吞）；兜底 data 切片
      const list = typeof out.tolist === 'function' ? out.tolist() : null
      if (Array.isArray(list) && list.length === batch.length && list.every(function (r) { return Array.isArray(r) && r.length === dim })) return list
      const rows = []
      for (let i = 0; i < batch.length; i++) rows.push(Array.from(out.data.slice(i * dim, (i + 1) * dim)))
      return rows
    }
    // bge embed 入口（窄接口契约 embed(texts)→vectors）：并发闸串行化（嵌入单飞）+ 批上限 ≤8 切块顺序推理
    async function _vectorBgeEmbed(texts) {
      const list = Array.isArray(texts) ? texts.map(function (t) { return String(t == null ? '' : t) }) : []
      const run = _bgeGateChain.then(async function () {
        const out = []
        for (let i = 0; i < list.length; i += VECTOR_EMBED_BATCH_MAX) {
          const vecs = await _bgeInferBatch(list.slice(i, i + VECTOR_EMBED_BATCH_MAX))
          for (let j = 0; j < vecs.length; j++) out.push(vecs[j])
        }
        return out
      })
      _bgeGateChain = run.then(function () {}, function () {})   // 失败不断链
      return run
    }
    // ==== host-embedder END ====
    _vectorRegisterBackend({ id: 'bge-small-zh-q8', dim: 512, minScore: 0.50, hostEmbed: true, embed: _vectorBgeEmbed })
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
    // 保存即嵌入入队（0.5.0 R2）：挂起 id 集 + 2s 防抖调度（已挂不重复；unref 不阻塞进程退出——同 _vectorScheduleFlush 纪律）
    function _vectorQueueIndex(id) {
      _vectorPending.set(id, true)
      if (_vectorDrainTimer) return
      _vectorDrainTimer = setTimeout(function () { _vectorDrainTimer = null; _vectorDrain() }, VECTOR_DRAIN_MS)
      if (_vectorDrainTimer && typeof _vectorDrainTimer.unref === 'function') _vectorDrainTimer.unref()
    }
    // drain（防抖微批，索引任务单链入队）：挂起集快照清空 → 逐 id 经 cache 取 drain 时刻最新版（快照竞态消除——入队后
    //   删除/再改以内存权威为准）→ 不可索引 → 全命名空间出队（与 _vectorDropNote 同口径）；可索引 → bodyHash 新鲜度检查
    //   （变才重算，增量）→ 跨笔记压平微批（≤VECTOR_EMBED_BATCH_MAX 块/批）embed → 归位落边车（防抖 flush 纪律不变）。
    //   失败整批重排回挂起队列（入队不丢）+ _vectorPendingErr 显性，不自动重试。
    function _vectorDrain() {
      if (!_vectorPending.size) return Promise.resolve()
      const ids = Array.from(_vectorPending.keys())
      _vectorPending = new Map()
      return _vectorEnqueue(async function () {
        try {
          await _vectorLoad()
          const backend = _activeBackend()
          if (!backend) return   // 语义已关：本批丢弃（重开由 rebuild 回填，存量口径不变）
          const c = _vectorCache
          const ns = c.ns[backend.id] || (c.ns[backend.id] = _vectorNewNs())
          const jobs = []
          let dropped = false
          for (const id of ids) {
            const cur = cache.get(id)   // 内存权威最新版（store-cache 常驻 cache；取不到 = 已 purge/外部移除 → 出队）
            if (!cur || !_vectorIndexable(cur)) {
              for (const bid of Object.keys(c.ns)) { if (_vectorDropFromNs(c.ns[bid], id)) dropped = true }
              continue
            }
            const hash = _vectorBodyHash(cur.body)
            if (ns.hash[id] === hash && ns.rows[id]) continue   // bodyHash 未变 → 不重算（增量）
            jobs.push({ id: id, hash: hash, chunks: _vectorChunks(cur.body) })
          }
          if (jobs.length) {
            // 跨笔记压平微批：flat = 全 (job,chunk) 块序列 → ≤VECTOR_EMBED_BATCH_MAX 块/批顺序 embed → 按 job 归位
            const flat = []
            for (let j = 0; j < jobs.length; j++) { for (let k = 0; k < jobs[j].chunks.length; k++) flat.push({ j: j, k: k, text: jobs[j].chunks[k] }) }
            const acc = jobs.map(function (jb) { return new Array(jb.chunks.length) })
            for (let i = 0; i < flat.length; i += VECTOR_EMBED_BATCH_MAX) {
              const slice = flat.slice(i, i + VECTOR_EMBED_BATCH_MAX)
              const vecs = await backend.embed(slice.map(function (s) { return s.text }))
              for (let m = 0; m < slice.length; m++) acc[slice[m].j][slice[m].k] = vecs[m]
            }
            for (let j = 0; j < jobs.length; j++) {
              ns.rows[jobs[j].id] = acc[j].map(function (v, k) { return { chunk: k, vector: v } })
              ns.hash[jobs[j].id] = jobs[j].hash
            }
          }
          if (jobs.length || dropped) _vectorScheduleFlush()
          _vectorPendingErr = ''
        } catch (e) {
          // 入队不丢（红线）：整批 id 重排回挂起队列（与在途新变更合并；bodyHash 新鲜度保幂等，已成功笔记自然跳过）；
          //   报错显性（status.pending/pendingError），不自动重试（模型未下载等持续故障防抖 hammer）
          for (const id of ids) { if (!_vectorPending.has(id)) _vectorPending.set(id, true) }
          _vectorPendingErr = String((e && e.message) || e)
        }
      })
    }
    // 立即 drain（读路径读即新鲜 + rebuild 权威全量前置）：取消防抖计时器 → 同步入队 drain（返回 job 链上 promise）
    function _vectorDrainNow() {
      if (_vectorDrainTimer) { clearTimeout(_vectorDrainTimer); _vectorDrainTimer = null }
      return _vectorDrain()
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
      _vectorQueueIndex(n.id)   // 0.5.0 R2：保存即嵌入——入队 + 2s 防抖微批 drain（不再逐事件即刻嵌入）
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
        // 0.5.0 R2（notes-051-save-embed）：bge 快速失败闸移除——R1 后 host 能嵌入（hostEmbed:true 真 embed 在册），rebuild 真跑存量回填
        await _vectorLoad()
        await _vectorJobChain   // 等待在飞增量（顺序一致）
        // 0.5.0 R2：重建是权威全量——挂起队列快照清空 + 防抖计时器取消（本批内容已被全库扫描覆盖；重建期间新变更重新入队不受影响）
        _vectorPending = new Map()
        if (_vectorDrainTimer) { clearTimeout(_vectorDrainTimer); _vectorDrainTimer = null }
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
        _vectorDrainNow()   // 0.5.0 R2：status 读路径强制 drain（不等 2s 防抖尾——轮询即新鲜；失败残留经 pending/pendingError 显性）
        await _vectorJobChain
        await _vectorFlush()
        const c = _vectorCache
        const backend = _activeBackend()
        // 0.5.0 P0（notes-050-model-proxy）rev2：indexable 计数走 _list 精确扫描（与 _vectorsRebuild 的 indexable 同源同口径）——
        //   常驻 cache 冷启动未暖（status 先于任何 notes-list/写入）会低报 indexable（实测冷 cache=1 / 暖=154 / 参考=154），
        //   属「换 cache 计数」引入的指标回归；_list 全库扫描实测 155 篇 280ms（远非「慢 12-20s」根因），恢复精确计数。
        //   口径：_list(includeSys=true) 全量 + _vectorIndexable 过滤（排除 deleted/tombstoned/sensitive/sys，与 rebuild 一致）。
        let indexable = 0
        try {
          const all = await _list(undefined, undefined, undefined, false, false, true)   // 含 sys（统一 _vectorIndexable 过滤）
          for (const n of all) { if (_vectorIndexable(n)) indexable++ }
        } catch (e) { indexable = 0 }
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
          namespaces: namespaces,
          pending: _vectorPending.size,          // 0.5.0 R2：待嵌入计数（embedder 未就绪时入队不丢——本键即可见）
          pendingError: _vectorPendingErr        // 最近一次 drain 失败原因（无 = ''）
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
        _vectorDrainNow()   // 0.5.0 R2：检索前强制 drain（保存即嵌入读路径新鲜——保存→可搜不等防抖尾）
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
    //   vectors = 该笔记分段块的 L2 归一化向量数组（实现方保证，dim 由本函数写前校验）；chunk = 数组下标（与 _vectorDrain 同口径）。
    //   replace:true = 先清空目标命名空间再写（浏览器全量重建路径）；缺省 = 增量 upsert（单笔记重算，bodyHash 新鲜度锚照存）。
    // 纪律：写入并入 _vectorJobChain 单链（与 drain/重建顺序一致不交错）；写失败 = 内存续用（静默降级，同 drain 路径）。
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
          // 0.5.0 P0-2（notes-050-wasm-shape）：静默吞显性化——dim 不符/形状非法的行计数 + 原因上报；全丢返回 error（曾静默回 ok 是第二个 bug，可观测性）。
          let written = 0, dropped = 0
          const reasons = []
          for (const r of a.rows) {
            if (!r || typeof r.noteId !== 'string' || !r.noteId) { dropped++; reasons.push({ noteId: (r && r.noteId) || '(missing)', reason: 'missing noteId' }); continue }
            if (!Array.isArray(r.vectors) || !r.vectors.length) { dropped++; reasons.push({ noteId: r.noteId, reason: 'empty vectors' }); continue }
            const rows = []
            let bad = false
            for (let i = 0; i < r.vectors.length; i++) {
              const v = r.vectors[i]
              if (!Array.isArray(v) || v.length !== dim) { bad = true; break }
              rows.push({ chunk: i, vector: v.map(Number) })
            }
            if (bad) {
              dropped++
              const shapes = r.vectors.map(function (v) { return Array.isArray(v) ? String(v.length) : typeof v })
              reasons.push({ noteId: r.noteId, reason: 'dim mismatch: 期望 ' + dim + ' 维，实得 [' + shapes.join(',') + ']' })
              continue
            }
            ns.rows[r.noteId] = rows
            ns.hash[r.noteId] = (typeof r.bodyHash === 'string' && r.bodyHash) ? r.bodyHash : ''
            written++
          }
          if (a.replace === true) ns.lastBuiltAt = new Date().toISOString()
          if (written > 0 || a.replace === true) _vectorScheduleFlush()
          const allDropped = a.rows.length > 0 && dropped === a.rows.length
          const res = { ok: !allDropped, backend: backend.id, dim: dim, written: written, dropped: dropped, reasons: reasons, count: _vectorCountNs(ns) }
          if (allDropped) res.error = 'notes-vectors-put: 全部 ' + a.rows.length + ' 行被丢弃（形状/维度非法），零写入'
          return res
        })
      } catch (e) { return { error: String(e.message || e) } }
    }
    // 事件总线注册（保存路径挂钩）：persist.js 的 onNoteChanged 在 manifest 序中先于本模块（kernel/persist.js 序位）。
    onNoteChanged(_vectorOnNoteChanged)
    // ==== vector-store END ====
