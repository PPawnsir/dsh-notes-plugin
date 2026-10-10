// 节 124. 0.5.0 R1 host embedder 内核（notes-051-host-embedder：spike② 实证配置迁入——onnxruntime-web 纯 wasm 在宿主进程跑 bge）
// 背景：spike②（D:\tmp\sem-spike2\run.mjs）实证「抢在 transformers 导入前注入全局 ORT 槽位（Symbol.for('onnxruntime')）→
//   Node 下也走 onnxruntime-web wasm EP」，本卡把它落成 vector-store 的 bge 后端真 embed（hostEmbed:false→true）。
//   rev2（Verifier 驳回修复 + 深查）：零原生保证从「npm overrides 桩化」（仅安装根生效——部署布局 npm 忽略依赖自带 overrides，
//   真 onnxruntime-node/sharp 进树 → node 构建顶层静态加载 → 退出阶段 0xC0000005）升级为「transformers 恒走 web 构建
//   显式文件 URL 导入」（web 构建里二者是 webpack ignored 空壳，构造性零原生，与安装布局无关）；模型缓存改走
//   env.customCache 官方钩子（web 构建 node:fs 被忽略，FileCache 死代码）；overrides 桩化保留（仓库树卫生+纵深防御）。
//   另灭第二崩溃源：多线程 wasm pthread Worker 池退出拆卸间歇 0xC0000005 → ort.env.wasm.numThreads = 1。
// 断言面：embedder 配置锚点（Symbol 注入/device:'auto'/wasmPaths file:/// 形态/恒等断言/web 构建导入+裸引禁令/customCache/镜像链/懒加载单飞）/
//   并发闸行为（假推理缝断言串行）+ 批上限（≤8 块/批）/ 模型 host 缓存锚点 + 镜像链单一事实源（BGE_MODEL_MIRRORS；server.dist.js 代理复用随 0.5.0 R3 退役撤除）/
//   依赖入包 + overrides 桩声明 + 安装树零 @img 零 .node 证据（spike 验收单 13(c)(d) 落地）/ web 构建零原生构造性静态实证 /
//   懒加载零成本（不进 embed 零 import——globalThis ORT 槽位不动）/ smoke-embed.mjs + smoke-embed-consumer.mjs（消费布局夹具）锚点（手动跑，真模型不进 CI）。
// 红线：现有 fake 后端测试面全保持绿（117/118/119/122 的 fake 路径零改动消费）；嵌入只在 host 进程内跑；正文不出机器。
module.exports = {
  id: "124",
  title: "124. 0.5.0 R1 host embedder 内核（bge 迁回 host：懒加载 + 并发闸 + 批上限 + web 构建构造性零原生，notes-051-host-embedder）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR, hostSrc, indexSrc } = H
  section('124. 0.5.0 R1 host embedder 内核（notes-051-host-embedder）')
  const read = (p) => fsNative.readFileSync(path.join(DIR, p), 'utf8').replace(/\r\n/g, '\n')
  const vsDev = read('src/host/kernel/vector-store.js')
  const vsDist = read('src/host/kernel/vector-store.dist.js')
  const headDist = read('src/host/head.js')
  const headDev = read('src/host/kernel/head.js')
  const srvDist = read('src/host/server.dist.js')
  const rootPkg = JSON.parse(read('package.json'))
  const pubPkg = JSON.parse(read('packages/dsh-notes-plugin/package.json'))
  const buildDist = read('scripts/build-dist.cjs')

  // ===== 124.1 embedder 配置锚点（dev/dist 双侧 + 双变体逐字节一致 + 双 head 常量锚）=====
  await t('embedder 配置锚点：Symbol 注入 / device:auto / wasmPaths file:/// / 恒等断言 / 懒加载单飞 / 并发闸 / 批上限 8 / hostEmbed:true（dev+dist 双侧）', () => {
    for (const [src, tag] of [[vsDev, 'dev'], [vsDist, 'dist']]) {
      assert(src.indexOf("globalThis[Symbol.for('onnxruntime')] = ort") >= 0, tag + ' 全局 ORT 槽位注入（Symbol.for）')
      assert(src.indexOf("const ort = ortNs.default ?? ortNs") >= 0, tag + ' CJS/ESM interop（spike② 同）')
      assert(src.indexOf("ort.env.wasm.wasmPaths = urlM.pathToFileURL(pathM.dirname(req.resolve('onnxruntime-web'))).href + '/'") >= 0, tag + ' wasmPaths = file:/// URL 形态（本地 dist，裸 Windows 路径会被 ESM loader 拒）')
      assert(src.indexOf('ort.env.wasm.numThreads = 1') >= 0, tag + ' wasm 单线程闸（pthread Worker 池退出拆卸间歇 0xC0000005 第二崩溃源修复，先于建会话）')
      assert(src.indexOf("env.backends.onnx !== ort.env") >= 0, tag + ' 恒等断言（transformers 内部 ONNX env ≡ 注入的 web 版 env）')
      assert(src.indexOf("device: 'auto'") >= 0, tag + " pipeline device:'auto'（Node 缺省 cpu 被拒——spike 反证实证）")
      assert(src.indexOf("dtype: 'q8'") >= 0, tag + ' dtype q8（23MB 量化模型）')
      // rev2 驳回修复锚：transformers 恒走 web 构建显式文件 URL（构造性零原生，与安装布局无关）+ 裸标识符禁令
      assert(src.indexOf('async function _bgeImportTransformers()') >= 0, tag + ' web 构建专用导入函数在案')
      assert(src.indexOf("req.resolve('@huggingface/transformers')") >= 0 && src.indexOf("pathM.join(pathM.dirname(entry), 'transformers.web.js')") >= 0, tag + ' web 构建定位 = createRequire 解包入口仅取路径 → 同目录 transformers.web.js')
      assert(src.indexOf("_bgeImport('@huggingface/transformers')") < 0, tag + ' 裸标识符导入 transformers 禁令（exports node 条件 → node.mjs 顶层静态加载原生包 = 0xC0000005 驳回面）')
      // rev2 模型缓存锚：env.customCache 官方钩子（web 构建 node:fs 被忽略，FileCache 死代码）+ 键归一 + 原子写
      assert(src.indexOf('env.useFSCache = false') >= 0 && src.indexOf('env.useCustomCache = true') >= 0 && src.indexOf('env.customCache = {') >= 0, tag + ' 模型缓存走 env.customCache 官方钩子（match/put 形态）')
      assert(src.indexOf('function _bgeCacheKeyRel(key)') >= 0 && src.indexOf('/\\/resolve\\/[^/]+\\//') >= 0, tag + ' 缓存键归一（剥宿主前缀 + /resolve/<rev>/ 段 + 穿越闸）')
      assert(src.indexOf('new Response(await fsM.promises.readFile') >= 0, tag + ' match 命中 → Response(字节)（buffer 读路径，return_path=false）')
      assert(src.indexOf("'.tmp-' + process.pid") >= 0 && src.indexOf('fsM.promises.rename(tmp, p)') >= 0, tag + ' put 落盘 .tmp+rename 原子写（崩溃不留半截模型）')
      assert(src.indexOf('env.cacheDir = BGE_MODEL_CACHE_DIR') < 0 && src.indexOf('BGE_MODEL_CACHE_DIR') >= 0, tag + ' 落盘根 = BGE_MODEL_CACHE_DIR（customCache 口径；env.cacheDir 死配置已撤）')
      assert(src.indexOf('env.allowLocalModels = false') >= 0, tag + ' allowLocalModels=false（spike② 同）')
      assert(src.indexOf('let _bgeLoadPromise = null') >= 0, tag + ' 懒加载单例单飞锚')
      assert(src.indexOf('_bgeLoadPromise.catch(function () { _bgeLoadPromise = null })') >= 0, tag + ' 加载失败复位（下次重试）')
      assert(src.indexOf('let _bgeGateChain = Promise.resolve()') >= 0, tag + ' 并发闸串行化队列锚')
      assert(src.indexOf('const VECTOR_EMBED_BATCH_MAX = 8') >= 0, tag + ' 批上限 8（防 spike 实测 +4.3GB 大批次内存峰）')
      assert(src.indexOf("hostEmbed: true, embed: _vectorBgeEmbed") >= 0, tag + ' bge 注册 hostEmbed:true + 真 embed（0.5.0 R1 迁回 host）')
      assert(src.indexOf("id: 'bge-small-zh-q8', dim: 512, minScore: 0.50, hostEmbed: false") < 0, tag + ' 旧 hostEmbed:false 抛错桩注册已拆')
    }
    // 双变体 embedder 块逐字节一致（变体差异仅 VECTORS_PATH 行——节 117 看守面不破）
    const bDev = vsDev.slice(vsDev.indexOf('==== host-embedder BEGIN ===='), vsDev.indexOf('==== host-embedder END ===='))
    const bDist = vsDist.slice(vsDist.indexOf('==== host-embedder BEGIN ===='), vsDist.indexOf('==== host-embedder END ===='))
    assert(bDev.length > 100 && bDist.length > 100, '双变体均含 host-embedder 标记块')
    assert.strictEqual(bDev, bDist, 'host-embedder 块 dev/dist 逐字节一致')
    // 双 head 常量锚（HOST_PKG_DIR = createRequire 基准；BGE_MODEL_CACHE_DIR = transformers env.cacheDir）
    assert(headDist.indexOf("const HOST_PKG_DIR = PKG_DIR") >= 0 && headDist.indexOf("const BGE_MODEL_CACHE_DIR = path.join(NOTES_ROOT, 'models')") >= 0, 'dist head.js 定义 HOST_PKG_DIR + BGE_MODEL_CACHE_DIR（~/.dsh/notes/models）')
    assert(headDev.indexOf('const HOST_PKG_DIR = PLUGIN_DIR') >= 0 && headDev.indexOf("const BGE_MODEL_CACHE_DIR = NOTES_DIR + '\\\\models'") >= 0, 'dev kernel/head.js 定义同义常量')
  })

  await t('镜像链单一事实源：BGE_MODEL_MIRRORS（hf-mirror→huggingface.co，host 侧保留红线）+ server.dist.js 代理退役零复用', () => {
    for (const [src, tag] of [[vsDev, 'dev'], [vsDist, 'dist']]) {
      assert(src.indexOf("const BGE_MODEL_MIRRORS = [") >= 0, tag + ' 定义 BGE_MODEL_MIRRORS')
      const mi = src.indexOf('const BGE_MODEL_MIRRORS')
      assert(src.indexOf("base: 'https://hf-mirror.com'", mi) > mi && src.indexOf("base: 'https://huggingface.co'", mi) > src.indexOf("base: 'https://hf-mirror.com'", mi), tag + ' 镜像链序 = hf-mirror → huggingface.co')
      assert(src.indexOf('env.remoteHost = m.base') >= 0, tag + ' 加载走镜像链逐环 failover（env.remoteHost 切换）')
    }
    assert(srvDist.indexOf('MODEL_PROXY_MIRRORS') < 0 && srvDist.indexOf('BGE_MODEL_MIRRORS') < 0, 'server.dist.js 零 BGE_MODEL_MIRRORS 复用（0.5.0 R3 notes-051-query-embed：/dsh-notes-model 代理路由退役，镜像链仅剩 host embedder 消费方）')
  })

  // ===== 124.2 依赖入包 + overrides 桩声明 + 安装树零原生证据 =====
  await t('依赖入包 + overrides 桩声明：root/发布包双侧 dependencies + overrides + stubs 四文件', () => {
    for (const [pkg, tag] of [[rootPkg, 'root'], [pubPkg, '发布包']]) {
      assert(pkg.dependencies && pkg.dependencies['@huggingface/transformers'] === '^3.8.1', tag + ' dependencies.@huggingface/transformers = ^3.8.1（spike② 实证版本）')
      assert(pkg.dependencies && pkg.dependencies['onnxruntime-web'] === '1.22.0-dev.20250409-89f8206ba4', tag + ' dependencies.onnxruntime-web 钉传递同版（dedupe 单份）')
      assert(pkg.overrides && typeof pkg.overrides['onnxruntime-node'] === 'string' && pkg.overrides['onnxruntime-node'].indexOf('stub') >= 0, tag + ' overrides.onnxruntime-node → 桩包')
      assert(pkg.overrides && typeof pkg.overrides['sharp'] === 'string' && pkg.overrides['sharp'].indexOf('stub') >= 0, tag + ' overrides.sharp → 桩包（@img 整树排除闸）')
    }
    assert(pubPkg.files && pubPkg.files.indexOf('stubs') >= 0, '发布包 files 含 stubs（overrides file: 目标随包发布）')
    for (const base of ['stubs', 'packages/dsh-notes-plugin/stubs']) {
      for (const name of ['sharp', 'onnxruntime-node']) {
        for (const f of ['package.json', 'index.js']) {
          assert(fsNative.existsSync(path.join(DIR, base, name, f)), base + '/' + name + '/' + f + ' 存在')
        }
      }
    }
    // 根与包内桩逐字节一致（build-dist 同步产物零漂移）
    for (const name of ['sharp', 'onnxruntime-node']) {
      for (const f of ['package.json', 'index.js']) {
        assert.strictEqual(read(path.join('packages/dsh-notes-plugin/stubs', name, f)), read(path.join('stubs', name, f)), '包内桩与根桩逐字节一致：' + name + '/' + f)
      }
    }
  })

  await t('安装树零原生证据：node_modules 零 @img 目录 + 零 .node 文件（spike 验收单 13(c) 硬性面）', () => {
    const nm = path.join(DIR, 'node_modules')
    if (!fsNative.existsSync(nm)) { assert(false, 'node_modules 不存在——须先 npm install（overrides 桩化证据无从谈起）'); return }
    assert(!fsNative.existsSync(path.join(nm, '@img')), 'node_modules/@img 不存在（sharp 原生二进制整树排除）')
    const offenders = []
    const walk = (dir) => {
      let entries
      try { entries = fsNative.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
      for (const ent of entries) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) { if (ent.name === '@img') offenders.push(p); else walk(p) }
        else if (ent.isFile() && /\.node$/i.test(ent.name)) offenders.push(p)
      }
    }
    walk(nm)
    assert.strictEqual(offenders.length, 0, '安装树零 @img 零 .node（实得 ' + offenders.slice(0, 5).join('; ') + (offenders.length > 5 ? ' …共 ' + offenders.length : '') + '）')
    // npm ls/lock 口径双证：lock 里 sharp/onnxruntime-node 是链到桩包的 link 条目；物理实体 = 0.0.0-stub
    const lock = JSON.parse(read('package-lock.json'))
    const lockSharp = lock.packages && lock.packages['node_modules/sharp']
    const lockOrt = lock.packages && lock.packages['node_modules/onnxruntime-node']
    assert(lockSharp && lockSharp.link === true && String(lockSharp.resolved || '').indexOf('stubs/sharp') >= 0, 'package-lock: sharp 链到 stubs 桩包（实得 ' + JSON.stringify(lockSharp) + '）')
    assert(lockOrt && lockOrt.link === true && String(lockOrt.resolved || '').indexOf('stubs/onnxruntime-node') >= 0, 'package-lock: onnxruntime-node 链到 stubs 桩包（实得 ' + JSON.stringify(lockOrt) + '）')
    const spPkg = JSON.parse(fsNative.readFileSync(path.join(nm, 'sharp', 'package.json'), 'utf8'))
    const soPkg = JSON.parse(fsNative.readFileSync(path.join(nm, 'onnxruntime-node', 'package.json'), 'utf8'))
    assert(spPkg.version === '0.0.0-stub' && soPkg.version === '0.0.0-stub', 'node_modules 实体 = 0.0.0-stub 桩（npm ls 口径：sharp=' + spPkg.version + ' onnxruntime-node=' + soPkg.version + '）')
  })

  await t('web 构建零原生构造性静态实证：web.js 里 onnxruntime-node/sharp/node:fs = webpack ignored 空壳；node 构建顶层静态加载（驳回面）在案', () => {
    // rev2 核心证据：零原生保证的构造性来源 = web 构建从不引用原生包（任何安装布局成立，不依赖 overrides 是否被尊重）
    const tfDist = path.join(DIR, 'node_modules', '@huggingface', 'transformers', 'dist')
    const webJs = path.join(tfDist, 'transformers.web.js')
    const nodeMjs = path.join(tfDist, 'transformers.node.mjs')
    if (!fsNative.existsSync(webJs) || !fsNative.existsSync(nodeMjs)) { assert(false, 'transformers dist 构建缺失——须先 npm install'); return }
    const webSrc = fsNative.readFileSync(webJs, 'utf8')
    assert(webSrc.indexOf('onnxruntime-node (ignored)') >= 0, 'web 构建 onnxruntime-node = webpack ignored 空壳（构造性零引用）')
    assert(webSrc.indexOf('sharp (ignored)') >= 0, 'web 构建 sharp = webpack ignored 空壳（构造性零引用）')
    assert(webSrc.indexOf('node:fs (ignored)') >= 0, 'web 构建 node:fs = ignored（FileCache 死代码实证 → customCache 钩子的必然性）')
    assert(webSrc.indexOf("Symbol.for('onnxruntime')") >= 0, 'web 构建 ORT 槽位注入点同源在案（spike② 注入路径对 web 构建成立）')
    // 驳回面实证（为什么严禁裸标识符）：node 构建顶层静态 import onnxruntime-node + sharp——无条件加载，槽位注入管不到模块加载
    const nodeHead = fsNative.readFileSync(nodeMjs, 'utf8').slice(0, 2000)
    assert(nodeHead.indexOf('from "onnxruntime-node"') >= 0 && nodeHead.indexOf('from "sharp"') >= 0, 'node 构建顶层静态 import onnxruntime-node + sharp（部署布局 0xC0000005 驳回面实证）')
  })

  await t('build-dist external 断言在案：dependencies/overrides 构建期闸 + 桩包同步步骤 + index.mjs 零 wasm 工件内联', () => {
    assert(buildDist.indexOf('host embedder external') >= 0, 'build-dist.cjs 含 external 断言块')
    assert(buildDist.indexOf("pkg.dependencies[d]") >= 0 && buildDist.indexOf("pkg.overrides[d]") >= 0, 'build-dist 断言发布包 dependencies/overrides')
    assert(buildDist.indexOf('STUB_OUT') >= 0 && buildDist.indexOf('stubs') >= 0, 'build-dist 桩包同步步骤在案')
    assert(buildDist.indexOf('ort-wasm-simd-threaded.wasm') >= 0, 'build-dist 反向闸：index.mjs 零 wasm 工件内联检查')
    // 产物面：index.mjs 引用两依赖（动态 import 形态），且不含 wasm 二进制内联
    assert(indexSrc.indexOf('@huggingface/transformers') >= 0 && indexSrc.indexOf('onnxruntime-web') >= 0, 'index.mjs 含 host embedder 依赖引用')
    assert(indexSrc.indexOf('ort-wasm-simd-threaded.wasm') < 0, 'index.mjs 零 wasm 工件名（external 口径）')
  })

  await t('smoke-embed.mjs 真机冒烟脚本锚点：标记块提取 + 维度/范数断言 + 零原生终审 + 自然退出（0xC0000005 回归闸）', () => {
    const smoke = read('scripts/smoke-embed.mjs')
    assert(smoke.indexOf('==== host-embedder BEGIN ====') >= 0, 'smoke 提取 vector-store 标记块（配置单一事实源，零复制）')
    assert(smoke.indexOf('_vectorBgeEmbed') >= 0, 'smoke 调 _vectorBgeEmbed 真嵌入')
    assert(smoke.indexOf('dim !== 512') >= 0 && smoke.indexOf('Math.abs(norm - 1)') >= 0, 'smoke 断维度 512 + L2 范数 ≈1')
    assert(smoke.indexOf('sharedObjects') >= 0, 'smoke 零原生终审（process.report sharedObjects）')
    assert(smoke.indexOf('process.exit(0)') < 0, 'smoke 无显式 exit(0)——自然退出（退出崩溃回归闸语义）')
    assert(smoke.indexOf('watchdog') >= 0 || smoke.indexOf('看门狗') >= 0, 'smoke 看门狗超时护栏在案')
    // 模型 host 缓存布局校验（条件性：跑过 smoke 的机器校验缓存布局证据；fresh CI 未跑 smoke 不阻塞——真模型不进 CI 红线）
    const cacheDir = process.env.DSH_SMOKE_CACHE_DIR || path.join(H.osNative.homedir(), '.dsh', 'notes', 'models')
    const cfg = path.join(cacheDir, 'Xenova', 'bge-small-zh-v1.5', 'config.json')
    if (fsNative.existsSync(cfg)) {
      assert(fsNative.existsSync(path.join(cacheDir, 'Xenova', 'bge-small-zh-v1.5', 'onnx', 'model_quantized.onnx')), '模型缓存布局完整（config + onnx/model_quantized.onnx）——smoke 实证痕迹')
    }
    // smoke 消费布局复用锚（rev2：夹具以环境变量改指依赖解析根/源码根）
    assert(smoke.indexOf('DSH_SMOKE_SRC_ROOT') >= 0 && smoke.indexOf('DSH_SMOKE_HOST_PKG_DIR') >= 0, 'smoke-embed.mjs 支持 SRC_ROOT/HOST_PKG_DIR 覆盖（消费布局夹具复用同一份冒烟）')
  })

  await t('消费者布局夹具锚点：smoke-embed-consumer.mjs（无 overrides 安装 + 真原生在树有效性断言 + 冒烟 ×N 全 exit 0 闸——驳回硬性面回归闸）', () => {
    // rev2 驳回面验收：部署布局（无 overrides，真 onnxruntime-node/sharp 在树）下冒烟 ×N 全 exit 0 + 零原生——手动跑不进 CI
    const fx = read('scripts/smoke-embed-consumer.mjs')
    assert(fx.indexOf('dsh-notes-embed-consumer') >= 0, '夹具消费者目录锚')
    assert(fx.indexOf('故意不带 overrides') >= 0 && fx.indexOf('dependencies') >= 0, '夹具无 overrides 声明（npm 忽略依赖自带 overrides——部署布局同构）')
    assert(fx.indexOf('DSH_SMOKE_HOST_PKG_DIR') >= 0, '夹具以消费者目录为依赖解析根（createRequire 基准）')
    assert(fx.indexOf('0.0.0-stub') >= 0 && fx.indexOf('.node') >= 0, '夹具有效性断言（真版实体 + .node 在树——崩溃前置条件成立才开跑）')
    assert(fx.indexOf('SMOKE OK') >= 0 && fx.indexOf('原生模块加载清单: （零）') >= 0, '夹具断 SMOKE OK + 零原生输出标记')
    assert(fx.indexOf('process.exit(1)') >= 0 && fx.indexOf('CONSUMER OK') >= 0, '夹具失败非零退出 + 全绿标记')
  })

  // ===== 124.3 行为断言：并发闸串行 + 批上限 + 懒加载零成本（fresh host 实例 + 假推理缝，真模型不进 CI）=====
  const NOTES_DIR_G = DIR + '\\notes'
  const VECTORS_PATH_G = NOTES_DIR_G + '\\vectors.jsonl'
  const store = new Map()
  const fsMock = {
    resolve: async (p) => p,
    stat: async (p) => { if (p === NOTES_DIR_G) return { dir: true }; if (store.has(p)) return { file: true }; const prefix = p + '\\'; for (const k of store.keys()) if (k.startsWith(prefix)) return { dir: true }; return null },
    listDir: async (p) => { const prefix = p + '\\'; const out = []; for (const k of store.keys()) if (k.startsWith(prefix) && k.indexOf('\\', prefix.length) < 0) out.push({ name: k.slice(prefix.length) }); return out },
    readText: async (p) => { if (!store.has(p)) throw new Error('ENOENT: ' + p); return store.get(p) },
    writeText: async (p, c) => { store.set(p, c) },
  }
  const handlers = {}
  const harnessMock = { handle: (name, fn) => { handlers[name] = fn; return () => { delete handlers[name] } }, defineTool: (d) => d, registerTool: () => () => {} }
  const ctx = {
    fs: fsMock, sandboxPolicy: { resolve: () => ({}) },
    get: (name) => ({ llm: S.llmMock, agentDefaultModel: S.admMock, agents: S.agentsMock, systemPrompt: { context: () => () => {} }, sessionPersistence: S.sessionPersistenceMock, workspaceRegistry: S.workspaceRegistryMock, sessionTitle: S.sessionTitleMock, sessionQuery: S.sessionQueryMock })[name],
    effect: () => {},
  }
  new Function('harness', 'pluginDir', hostSrc)(harnessMock, DIR).apply(ctx)
  const settle = async () => { await handlers['notes-vectors-status']({}) }
  const readVectors = () => {
    const raw = store.get(VECTORS_PATH_G)
    if (!raw) return []
    return String(raw).split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l))
  }

  await t('懒加载零成本：语义缺省关闭 → bge 全程零触发（ORT 全局槽位不动，运行时零 import——真模型不进 CI 锚）', async () => {
    assert(typeof globalThis[Symbol.for('onnxruntime')] === 'undefined', 'check 进程 ORT 槽位初始未注入（假推理缝短路加载器，真运行时零 import）')
    const n = await handlers['notes-create']({ title: 'Z0', body: 'zero cost' })
    await settle()
    assert(n && n.id, '缺省关闭下建笔记正常')
    assert(readVectors().length === 0, '缺省关闭零边车行（零成本红线）')
    assert(typeof globalThis[Symbol.for('onnxruntime')] === 'undefined', '缺省关闭全程 ORT 槽位仍未注入（懒加载锚）')
  })

  await t('并发闸行为（假推理缝断言串行）：并发 create/search/rebuild 全压 → 推理水位恒 1（嵌入单飞）', async () => {
    let inflight = 0, maxInflight = 0, calls = 0
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    globalThis.__DSH_NOTES_BGE_INFER__ = async (batch) => {
      inflight++; if (inflight > maxInflight) maxInflight = inflight
      calls++
      await sleep(5)   // 让出事件循环——若闸失效并发必然叠加
      inflight--
      return (batch || []).map(() => { const v = new Array(512).fill(0); v[0] = 1; return v })
    }
    try {
      await handlers['notes-settings-set']({ semantic: { enabled: true, backend: 'bge-small-zh-q8' } })
      const n1 = await handlers['notes-create']({ title: 'G1', body: '并发闸压力一' })
      const n2 = await handlers['notes-create']({ title: 'G2', body: '并发闸压力二' })
      // 并发压闸：rebuild（0.5.0 P1 后台化——RPC 立即返回 started，本体后台逐笔记 embed）+ 两条文本 query（embed 直查）同发
      const rs = await Promise.all([
        handlers['notes-vectors-rebuild']({ backend: 'bge-small-zh-q8' }),
        handlers['notes-vectors-search']({ query: '并发闸', backend: 'bge-small-zh-q8' }),
        handlers['notes-vectors-search']({ query: '压力', backend: 'bge-small-zh-q8' }),
      ])
      assert(rs[0] && rs[0].ok === true && rs[0].started === true, 'rebuild 立即返回 started（0.5.0 P1 后台化——并发压闸下也不占同步窗）')
      // 0.5.0 P1：轮询承接后台重建完结（building 消旗）再断言计数
      let stV = null
      for (let i = 0; i < 500; i++) { stV = await handlers['notes-vectors-status']({}); if (stV && stV.building !== true) break; await sleep(10) }
      assert(stV && stV.building === false && stV.indexed >= 2, '后台重建走假推理缝成功（indexed=' + (stV && stV.indexed) + '）')
      assert(rs[1] && rs[1].ok === true && rs[2] && rs[2].ok === true, '文本 query 走 host embed 成功（0.5.0 R1 不再抛「只在浏览器端」）')
      assert(calls >= 4, '推理调用次数 ≥4（2 笔记 + 2 查询，实得 ' + calls + '）')
      assert.strictEqual(maxInflight, 1, '并发闸串行化：推理水位恒 1（实得 maxInflight=' + maxInflight + '）')
      void n1; void n2
    } finally { delete globalThis.__DSH_NOTES_BGE_INFER__ }
  })

  await t('批上限：单笔记 20 块 → 恰 8/8/4 三批（单批 ≤8 防大批次内存峰）+ 边车 20 行落盘', async () => {
    const batchSizes = []
    globalThis.__DSH_NOTES_BGE_INFER__ = async (batch) => {
      batchSizes.push(batch.length)
      return (batch || []).map(() => { const v = new Array(512).fill(0); v[1] = 1; return v })
    }
    try {
      // 20 行 × 1800 字符 → _vectorChunks 恰出 20 块（段落边界切块，VECTOR_CHUNK_MAX=1800）
      const longBody = new Array(20).fill('x'.repeat(1800)).join('\n')
      const ln = await handlers['notes-create']({ title: 'LONG', body: longBody })
      await settle()
      assert(batchSizes.length === 3 && batchSizes[0] === 8 && batchSizes[1] === 8 && batchSizes[2] === 4, '20 块恰切 8/8/4 三批（实得 [' + batchSizes.join(',') + ']）')
      assert(batchSizes.every(b => b <= 8), '单批 ≤8（批上限红线）')
      const rows = readVectors().filter(r => r.noteId === ln.id && r.backend === 'bge-small-zh-q8')
      assert(rows.length === 20, '边车落 20 行（每块一向量，实得 ' + rows.length + '）')
      assert(rows.every(r => r.vector && r.vector.length === 512), '每行 512 维')
    } finally { delete globalThis.__DSH_NOTES_BGE_INFER__ }
  })

  await t('假推理缝不触真加载器：全程 ORT 全局槽位未注入（真模型不进 CI 的行为级铁证）', () => {
    assert(typeof globalThis[Symbol.for('onnxruntime')] === 'undefined', '假推理缝路径全程零 ORT 注入（onnxruntime-web/transformers 零 import）')
  })
  }
}
