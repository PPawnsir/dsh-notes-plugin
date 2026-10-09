// smoke-embed-consumer.mjs —— 0.5.0 R1（notes-051-host-embedder）**消费者布局夹具**（手动跑，不进 CI）
//
// 背景（Verifier 驳回面）：仓库根布局「仓库根 = 安装根」，npm overrides 桩化生效——恰好是唯一成立的布局。
//   真实部署布局 = DSH profile 经 link: 安装发布包，profile 自身无 overrides；npm 忽略依赖自带的 overrides
//   → 真 onnxruntime-node@1.21.0 + sharp@0.34.5（含 @img/* 原生二进制）进安装树。rev1 裸 import transformers
//   走 exports node 条件 → dist/transformers.node.mjs 顶层静态加载二者 → 嵌入完成后进程退出阶段 0xC0000005
//   （exit=-1073740940，4 跑 2 崩实证）。rev2 修复 = transformers 恒走 web 构建显式文件 URL 导入（webpack ignored
//   空壳，构造性零原生，与安装布局无关）。本夹具是该硬性验收面的可复跑回归闸。
//
// 夹具步骤：
//   ① 建消费者目录（%TEMP%/dsh-notes-embed-consumer）：package.json 只声明 dependencies
//     （@huggingface/transformers@^3.8.1 + onnxruntime-web@1.22.0-dev.20250409-89f8206ba4），**故意不带 overrides**；
//   ② npm install（真 onnxruntime-node + sharp + @img/* 原生二进制全部进树）——夹具有效性断言：安装树 ≥1 个 .node
//     文件且 sharp/onnxruntime-node 实体版本 ≠ 0.0.0-stub（否则夹具根本没摆出崩溃前置条件，判失败）；
//   ③ 拷 smoke-embed.mjs 进消费者目录，以其为依赖解析根跑冒烟 ×5（DSH_SMOKE_HOST_PKG_DIR=消费者目录——
//     createRequire 从消费者树解 transformers/onnxruntime-web，与部署布局同构）；
//   ④ 硬性面：5 跑全部 exit 0 + 输出含 SMOKE OK + 「原生模块加载清单: （零）」——任何一跑非零即失败（0xC0000005 回归）。
//
// 运行：node scripts/smoke-embed-consumer.mjs    （首跑 npm install 真原生包 ~80MB + 复用模型缓存；手动跑，不进 CI）
// 环境变量：DSH_SMOKE_CONSUMER_DIR 覆盖消费者目录（缺省 %TEMP%/dsh-notes-embed-consumer，复跑复用安装树）；
//   DSH_SMOKE_RUNS 覆盖冒烟跑数（缺省 5）；DSH_SMOKE_CACHE_DIR 覆盖模型缓存目录。
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, execSync } from 'node:child_process'

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONSUMER = process.env.DSH_SMOKE_CONSUMER_DIR || join(tmpdir(), 'dsh-notes-embed-consumer')
const RUNS = Math.max(1, parseInt(process.env.DSH_SMOKE_RUNS || '5', 10) || 5)
const CACHE_DIR = process.env.DSH_SMOKE_CACHE_DIR || join(homedir(), '.dsh', 'notes', 'models')

console.log('[consumer] 消费者布局夹具开始  目录=' + CONSUMER + '  跑数=' + RUNS)

// ---- ① 消费者 package.json（无 overrides——复现部署布局的关键）----
mkdirSync(CONSUMER, { recursive: true })
const pkgPath = join(CONSUMER, 'package.json')
const pkg = {
  name: 'dsh-notes-embed-consumer-fixture',
  private: true,
  version: '0.0.0',
  description: 'notes-051 消费者布局夹具：无 overrides 安装（npm 忽略依赖自带 overrides——部署布局同构）',
  dependencies: {
    '@huggingface/transformers': '^3.8.1',
    'onnxruntime-web': '1.22.0-dev.20250409-89f8206ba4',
  },
  // 注意：故意不声明 overrides——npm 只在安装根读 overrides，部署布局（profile 经 link: 安装）即此形态
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

// ---- ② npm install（幂等：锁文件在且依赖树齐则跳过）----
const nmDir = join(CONSUMER, 'node_modules')
if (!existsSync(join(nmDir, '@huggingface', 'transformers', 'package.json')) || !existsSync(join(nmDir, 'sharp', 'package.json'))) {
  console.log('[consumer] npm install（真原生包进树，首跑较慢）...')
  execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: CONSUMER, stdio: 'inherit' })   // shell 形态：Windows 的 npm 是 .cmd，execFile 直拒（EINVAL）
} else {
  console.log('[consumer] 依赖树已在（复跑跳过 install）')
}

// ---- ②b 夹具有效性断言：真原生包在树（崩溃前置条件成立）----
const sharpVer = JSON.parse(readFileSync(join(nmDir, 'sharp', 'package.json'), 'utf8')).version
const ortNodeVer = JSON.parse(readFileSync(join(nmDir, 'onnxruntime-node', 'package.json'), 'utf8')).version
if (sharpVer === '0.0.0-stub' || ortNodeVer === '0.0.0-stub') {
  console.error('[consumer] FATAL: sharp/onnxruntime-node 是桩版（' + sharpVer + '/' + ortNodeVer + '）——夹具未摆出真原生前置条件')
  process.exit(1)
}
const nodeBins = []
const walk = (dir) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) walk(p)
    else if (/\.node$/i.test(ent.name)) nodeBins.push(p)
  }
}
walk(nmDir)
if (nodeBins.length === 0) {
  console.error('[consumer] FATAL: 安装树零 .node 文件——真原生二进制不在树，夹具无效')
  process.exit(1)
}
console.log('[consumer] 夹具有效：sharp=' + sharpVer + ' onnxruntime-node=' + ortNodeVer + '（真版） 安装树 .node 文件 ' + nodeBins.length + ' 个')

// ---- ③ 拷冒烟脚本进消费者目录（以其为依赖解析根，与部署布局同构）----
copyFileSync(join(SRC_ROOT, 'scripts', 'smoke-embed.mjs'), join(CONSUMER, 'smoke-embed.mjs'))

// ---- ④ 冒烟 ×N：全 exit 0 + SMOKE OK + 零原生 ----
let failed = 0
for (let i = 1; i <= RUNS; i++) {
  const t0 = Date.now()
  let code = null, out = ''
  try {
    out = execFileSync(process.execPath, ['smoke-embed.mjs'], {
      cwd: CONSUMER,
      env: { ...process.env, DSH_SMOKE_SRC_ROOT: SRC_ROOT, DSH_SMOKE_HOST_PKG_DIR: CONSUMER, DSH_SMOKE_CACHE_DIR: CACHE_DIR },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600000,
    })
    code = 0
  } catch (e) { code = (e.status == null ? 'signal:' + e.signal : e.status); out = String(e.stdout || '') + String(e.stderr || '') }
  const okMark = out.indexOf('SMOKE OK') >= 0
  const zeroNative = out.indexOf('原生模块加载清单: （零）') >= 0
  const pass = code === 0 && okMark && zeroNative
  if (!pass) failed++
  console.log('[consumer] 跑 ' + i + '/' + RUNS + ': exit=' + code + ' SMOKE_OK=' + okMark + ' 零原生=' + zeroNative + '  ' + (Date.now() - t0) + 'ms  → ' + (pass ? 'PASS' : 'FAIL'))
  if (!pass) console.log('----- 输出尾部 -----\n' + out.split('\n').slice(-25).join('\n') + '\n--------------------')
}
if (failed > 0) {
  console.error('[consumer] FATAL: ' + failed + '/' + RUNS + ' 跑失败（0xC0000005 回归面失守）')
  process.exit(1)
}
console.log('[consumer] CONSUMER OK  ' + RUNS + '/' + RUNS + ' 跑全绿（exit 0 + 零原生 + 自然退出）——部署布局硬性验收面成立')
