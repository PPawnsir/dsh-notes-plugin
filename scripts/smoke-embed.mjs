// smoke-embed.mjs —— 0.5.0 R1（notes-051-host-embedder）host embedder 真机冒烟（手动跑，不进 CI）
//
// 用途：真下载/真加载 bge-small-zh-v1.5（q8）+ 真嵌入一条，验证 host embedder 内核全链路：
//   ① onnxruntime-web 纯 wasm 在宿主进程跑（ORT 全局槽位注入 + device:'auto' + wasmPaths file:///——spike② 实证配置）；
//   ② 模型 host 缓存（~/.dsh/notes/models/，env.customCache 钩子 node:fs 自建磁盘缓存 + 镜像链 hf-mirror→HF failover）；
//   ③ 维度/范数断言（dim=512，L2≈1.0）；
//   ④ 零原生模块加载——rev2 起保证形态升级：transformers 恒走 web 构建显式文件 URL 导入（node 构建顶层静态加载
//     onnxruntime-node/sharp 是部署布局 0xC0000005 驳回面；web 构建二者为 webpack ignored 空壳，任何安装布局构造性零原生），
//     npm overrides 桩化保留为仓库安装树卫生 + 纵深防御；
//   ⑤ **进程自然退出 exit 0**——0xC0000005 访问冲突崩溃回归闸（spike 验收单 13(d)：桩化不完整 = 宿主退出崩溃）。
//
// 运行：node scripts/smoke-embed.mjs        （首跑下载 ~23MB 模型；缓存命中后零网络）
// 环境变量：DSH_SMOKE_CACHE_DIR 覆盖模型缓存目录（缺省 ~/.dsh/notes/models）；
//   DSH_SMOKE_SRC_ROOT 覆盖 vector-store.js 提取根（缺省脚本上一级——消费布局夹具 scripts/smoke-embed-consumer.mjs 会指回仓库）；
//   DSH_SMOKE_HOST_PKG_DIR 覆盖 createRequire 基准目录（缺省同 SRC_ROOT——消费布局夹具指向消费者目录，依赖从消费者树解析）。
//
// 实现口径：嵌核心代码零复制——从 src/host/kernel/vector-store.js 提取 ==== host-embedder BEGIN/END ==== 标记块
//   eval 执行（与 check/sections/118·122 提取 app wasm-embedder 块同先例），配置漂移即冒烟失败。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SRC_ROOT = process.env.DSH_SMOKE_SRC_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_PKG_DIR = process.env.DSH_SMOKE_HOST_PKG_DIR || SRC_ROOT
const CACHE_DIR = process.env.DSH_SMOKE_CACHE_DIR || join(homedir(), '.dsh', 'notes', 'models')

// 全程看门狗：10 分钟不完成强制非零退出（挂死 ≠ 通过）；成功路径清除看门狗后**自然退出**（回归闸语义）
const watchdog = setTimeout(() => { console.error('[smoke] FATAL: 看门狗超时（600s），疑似挂死'); process.exit(2) }, 600000)

const t0 = Date.now()
console.log('[smoke] host embedder 真机冒烟开始  node=' + process.version + ' ' + process.platform + '/' + process.arch)
console.log('[smoke] 模型缓存目录: ' + CACHE_DIR)

// ---- 提取 host-embedder 标记块（单一事实源：与生产同一份代码）----
const vsSrc = readFileSync(join(SRC_ROOT, 'src', 'host', 'kernel', 'vector-store.js'), 'utf8').replace(/\r\n/g, '\n')
const bStart = vsSrc.indexOf('==== host-embedder BEGIN ====')
const bEnd = vsSrc.indexOf('==== host-embedder END ====')
if (bStart < 0 || bEnd <= bStart) { console.error('[smoke] FATAL: vector-store.js 缺 host-embedder 标记块'); process.exit(1) }
let block = vsSrc.slice(vsSrc.indexOf('\n', bStart) + 1, bEnd)
block = block.split('\n').map(l => (l.startsWith('    ') ? l.slice(4) : l)).join('\n')   // 去 apply 体 4 空格基座缩进
const factory = new Function('HOST_PKG_DIR', 'BGE_MODEL_CACHE_DIR',
  block + '\n;return { _vectorBgeEmbed, BGE_MODEL_ID, VECTOR_EMBED_BATCH_MAX, BGE_MODEL_MIRRORS }')
const emb = factory(HOST_PKG_DIR, CACHE_DIR)
console.log('[smoke] 嵌核心提取完成  模型=' + emb.BGE_MODEL_ID + ' 批上限=' + emb.VECTOR_EMBED_BATCH_MAX + ' 镜像链=' + emb.BGE_MODEL_MIRRORS.map(m => m.id).join('→'))
console.log('[smoke] 源码根=' + SRC_ROOT + '  依赖解析根(HOST_PKG_DIR)=' + HOST_PKG_DIR)

// ---- 真嵌入（首次触发懒加载：import 运行时 + 下载/加载模型）----
const t1 = Date.now()
const vecs = await emb._vectorBgeEmbed(['部署相关的约定'])
const loadMs = Date.now() - t1
if (!Array.isArray(vecs) || vecs.length !== 1) { console.error('[smoke] FATAL: 嵌入返回形状非法（期望 1 向量，实得 ' + (vecs && vecs.length) + '）'); process.exit(1) }
const v = vecs[0]
const dim = v.length
const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
console.log('[smoke] 嵌入完成（含模型加载） ' + loadMs + 'ms  dim=' + dim + '  L2范数=' + norm.toFixed(6))
if (dim !== 512) { console.error('[smoke] FATAL: dim=' + dim + '（期望 512）'); process.exit(1) }
if (Math.abs(norm - 1) > 0.01) { console.error('[smoke] FATAL: L2 范数=' + norm.toFixed(6) + '（期望 ≈1.0）'); process.exit(1) }

// ---- 热路径第二发（懒加载单例复用，不再加载）----
const t2 = Date.now()
const vecs2 = await emb._vectorBgeEmbed(['语义检索在宿主进程内跑'])
console.log('[smoke] 热嵌入 ' + (Date.now() - t2) + 'ms  dim=' + vecs2[0].length)

// ---- 零原生终审（桩化彻底性）----
let native = []
try {
  const so = process.report.getReport().sharedObjects || []
  native = so.filter(p => /\.node$/i.test(p) || /onnxruntime|sharp/i.test(p))
} catch (e) { native = ['<process.report 不可用>'] }
console.log('[smoke] 原生模块加载清单: ' + (native.length ? native.join(', ') : '（零）'))
if (native.length && native[0] !== '<process.report 不可用>') { console.error('[smoke] FATAL: 原生模块加载非零（桩化不完整）'); process.exit(1) }

console.log('[smoke] SMOKE OK  全程 ' + (Date.now() - t0) + 'ms——等待自然退出（0xC0000005 回归闸：本进程必须 exit 0）')
clearTimeout(watchdog)
// 无显式成功退出调用：让事件循环自然排空——原生 DLL 若被加载，进程退出阶段会 0xC0000005 崩溃（exit≠0），本脚本即回归闸
