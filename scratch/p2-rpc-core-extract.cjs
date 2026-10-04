// P2·4 host RPC 核心域抽出切片器（一次性迁移工装；绞杀者逐域切出，design/architecture-modular.md §8.3/§8.5）
// 用法：node scratch/p2-rpc-core-extract.cjs step1..step4|verify
//   step1 ：folders 域（文件夹全套：FOLDERS_PATH/genFolderId/loadFolders/saveFolders/folder-tree-helpers 块/
//           effectiveFolder/resolveFolderRef/_folders）→ folders.js + folders.dist.js
//   step2 ：notes 域（CRUD/list/get + quick/quick-instruct：_create/_list/_get/_getDeleted/_update/
//           MERGE_WINDOW_MS/quickChain/_quickCapture/_quickCaptureInner/extractInstruction/_quickInstruct；
//           发布版含 _wsOfSession 助手——_create 唯一消费者，随域同迁）→ notes.js + notes.dist.js
//   step3 ：llm/organize.js（_aiOrganize 单片——序位原位夹片，为 trash 域连续切出让路；§8.3 目标位 llm/organize.js）
//   step4 ：history-trash/trash.js（回收站：_delete/_restore/purgeNoteFile/_purge）
//   verify：仅复验当前盘态拼接产物 === P2·3 基线（不改任何文件）
// 基线：复用 P2·3 快照（p2-kernel-baseline-whole.js / p2-kernel-baseline-dist-whole.js）——
//   红线 7 口径：每步完成后 concatHost()/concatHostDist() 与基线逐字节一致（LF 归一后）。
// 坐标锚点 = 当前 whole.js / dist-whole.js 首行起算的相对行号（每步切前缀，余量文件尾部收缩，同 P2·3 姿势）。
// 域内全部跨域引用（cache/persist/engine/settings/folders 助手互调）均为同一 apply 作用域顶层标识符，
// 序位不变即可见性不变（§8.1.4：host 侧无需 bridge 抽象）；本脚本不改任何字节，只搬家。
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const HOST_DIR = path.join(ROOT, 'src', 'host')
const BASE_WHOLE = path.join(__dirname, 'p2-kernel-baseline-whole.js')
const BASE_DIST = path.join(__dirname, 'p2-kernel-baseline-dist-whole.js')

function readNorm(p) { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }

// 当前余量文件前缀切片（1 基，cutEnd 含本行）。三道机械守卫：
//   首行锚点强制核对；切片末行须为空行、其前行须为 }（不切在函数体内）；余量首行锚点核对。
function cutPrefix(lines, cutEnd, anchor, tailAnchor, tag) {
  const first = lines[0] || ''
  if (first.indexOf(anchor) !== 0) {
    throw new Error('[extract] 锚点漂移 ' + tag + '：期望首行行首 ' + JSON.stringify(anchor) + '，实得 ' + JSON.stringify(first.slice(0, 90)))
  }
  const lastOfCut = lines[cutEnd - 1] || ''
  const beforeLast = lines[cutEnd - 2] || ''
  if (lastOfCut !== '') throw new Error('[extract] 切点末行非空行 ' + tag + '：L' + cutEnd + ' 实得 ' + JSON.stringify(lastOfCut.slice(0, 90)))
  if (!/^\s*\}\s*$/.test(beforeLast)) throw new Error('[extract] 切点末二行不是 } ' + tag + '：L' + (cutEnd - 1) + ' 实得 ' + JSON.stringify(beforeLast.slice(0, 90)))
  const firstOfRest = lines[cutEnd] || ''
  if (firstOfRest.indexOf(tailAnchor) !== 0) {
    throw new Error('[extract] 余量首行锚点漂移 ' + tag + '：期望 ' + JSON.stringify(tailAnchor) + '，实得 ' + JSON.stringify(firstOfRest.slice(0, 90)))
  }
  return { cut: lines.slice(0, cutEnd).join('\n') + '\n', rest: lines.slice(cutEnd).join('\n') }
}

function writePart(rel, text) {
  const p = path.join(HOST_DIR, rel.replace(/\//g, path.sep))
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}

// manifest 头注释（禁单引号——拼接器按单引号字符串逐行提取条目）
const DEV_HEAD = [
  '// host 模块清单（开发版）—— host.js 引导壳运行时拼接的唯一组装依据',
  '// 解析规则同 scripts/concat-client.cjs：逐行提取单引号字符串；注释中禁止出现单引号字符。',
  '// P2·3 kernel 抽出：kernel/ 六模块（format/front-matter/session-ctx 双包逐字节一致片，两清单同名引用同一物理文件；',
  '// settings-store/store-cache/persist 为双包变体，发布版侧以 .dist.js 后缀登记）。',
  '// P2·4 RPC 核心域抽出：folders.js（文件夹全套）/ notes.js（CRUD/list/get/quick 族）/ history-trash/trash.js（回收站）',
  '// 三域原位驻留片 + llm/organize.js（AI 整理夹片，序位原位）；routes 注册表（disposers.push(handle(...)) 序位声明块）',
  '// 与 memory-guide 注册段交织，留 whole.js 待 P2·5 server 域续切；跨域引用靠拼接序位可见性（§8.1.4，无需 bridge）。',
]
const DIST_HEAD = [
  '// host 模块清单（发布版）—— scripts/build-dist.cjs 构建期拼接写盘 packages/dsh-notes-plugin/index.mjs 的组装依据',
  '// 解析规则同 scripts/concat-client.cjs：逐行提取单引号字符串；注释中禁止出现单引号字符。',
  '// P2·3 kernel 抽出：与开发版共用 kernel/ 同名片（逐字节一致片物理单份）；.dist.js 后缀 = 发布版变体片（§8.4.3 红线 9 登记）。',
  '// P2·4 RPC 核心域抽出：folders/notes/history-trash·trash/llm·organize 四域双包变体片（路径拼接与删除通道等设计内差异）。',
  '// routes 注册表留 dist-whole.js 待 P2·5 server 域续切；dist-whole.js 为未切余量。',
]

function writeManifest(rel, head, entries) {
  const body = head.concat(entries.map((e) => "'" + e + "'")).join('\n') + '\n'
  fs.writeFileSync(path.join(HOST_DIR, rel), body)
}

// ===== 步进定义（坐标 = 当前 whole.js / dist-whole.js 首行起算；每步只切前缀 + 收缩余量 + 重写两份 manifest）=====
const STEPS = {
  step1: { // folders 域
    dev: { cutEnd: 207, anchor: '    // ---- 虚拟文件夹：', tail: '    async function _create(', rel: 'folders.js' },
    dist: { cutEnd: 208, anchor: '    // ---- 虚拟文件夹：', tail: '    // 由 sessionId 推导工作区名', rel: 'folders.dist.js' },
    devEntry: 'folders.js', distEntry: 'folders.dist.js',
  },
  step2: { // notes 域
    dev: { cutEnd: 339, anchor: '    async function _create(', tail: '    // ---- 二期 ✨整理（notes-ai-organize）', rel: 'notes.js' },
    dist: { cutEnd: 377, anchor: '    // 由 sessionId 推导工作区名', tail: '    // ---- 二期 ✨整理（notes-ai-organize）', rel: 'notes.dist.js' },
    devEntry: 'notes.js', distEntry: 'notes.dist.js',
  },
  step3: { // llm/organize.js 夹片
    dev: { cutEnd: 62, anchor: '    // ---- 二期 ✨整理（notes-ai-organize）', tail: '    async function _delete(id) {', rel: 'llm/organize.js' },
    dist: { cutEnd: 61, anchor: '    // ---- 二期 ✨整理（notes-ai-organize）', tail: '    async function _delete(id) {', rel: 'llm/organize.dist.js' },
    devEntry: 'llm/organize.js', distEntry: 'llm/organize.dist.js',
  },
  step4: { // history-trash/trash.js 回收站
    dev: { cutEnd: 40, anchor: '    async function _delete(id) {', tail: '    // ---- 显式归档（重构）----', rel: 'history-trash/trash.js' },
    dist: { cutEnd: 47, anchor: '    async function _delete(id) {', tail: '    // ---- 显式归档（重构）----', rel: 'history-trash/trash.dist.js' },
    devEntry: 'history-trash/trash.js', distEntry: 'history-trash/trash.dist.js',
  },
}

// 当前盘态 manifest 条目（从拼接器真实解析，不手抄——防漂移）
function currentEntries(rel) {
  return require(path.join(ROOT, 'scripts', 'concat-host.cjs')).readManifest(path.join(HOST_DIR, rel))
}

function verifyAgainstBaseline(tag) {
  const { concatHost, concatHostDist } = require(path.join(ROOT, 'scripts', 'concat-host.cjs'))
  const baseDev = readNorm(BASE_WHOLE)
  const baseDist = readNorm(BASE_DIST)
  const dev = concatHost()
  const dist = concatHostDist()
  if (dev !== baseDev) {
    let i = 0; while (i < Math.min(dev.length, baseDev.length) && dev[i] === baseDev[i]) i++
    throw new Error('[extract] ' + tag + ' 开发版拼接产物与基线逐字节不等（首个差异偏移 ' + i + '：' + JSON.stringify(dev.slice(i, i + 60)) + ' vs ' + JSON.stringify(baseDev.slice(i, i + 60)) + '）')
  }
  if (dist !== baseDist) {
    let i = 0; while (i < Math.min(dist.length, baseDist.length) && dist[i] === baseDist[i]) i++
    throw new Error('[extract] ' + tag + ' 发布版拼接产物与基线逐字节不等（首个差异偏移 ' + i + '）')
  }
  console.log('[extract] ' + tag + ' 逐字节复验通过：concatHost()=' + dev.length + 'B === baseline；concatHostDist()=' + dist.length + 'B === baseline')
}

function main() {
  const cmd = process.argv[2]
  if (!fs.existsSync(BASE_WHOLE) || !fs.existsSync(BASE_DIST)) throw new Error('[extract] 缺 P2·3 基线快照（p2-kernel-baseline-*.js），无法复验红线 7')
  if (cmd === 'verify') { verifyAgainstBaseline('verify'); return }
  const step = STEPS[cmd]
  if (!step) throw new Error('[extract] 未知命令：' + cmd + '（期望 step1/step2/step3/step4/verify）')

  for (const flavor of ['dev', 'dist']) {
    const wholeRel = flavor === 'dev' ? 'whole.js' : 'dist-whole.js'
    const lines = readNorm(path.join(HOST_DIR, wholeRel)).split('\n')
    const cfg = step[flavor]
    const r = cutPrefix(lines, cfg.cutEnd, cfg.anchor, cfg.tail, flavor + ':' + cfg.rel)
    writePart(cfg.rel, r.cut)
    writePart(wholeRel, r.rest)
    console.log('[extract] ' + flavor + ' 切出 ' + cfg.rel + '（前缀 ' + cfg.cutEnd + ' 行，' + Buffer.byteLength(r.cut, 'utf8') + 'B）；余量 ' + wholeRel + ' 收缩至 ' + (lines.length - cfg.cutEnd) + ' 行')
  }
  // manifest：余量条目之前插入本步域条目（序位 = 原位，逐字节红线的另一半边）
  for (const flavor of ['dev', 'dist']) {
    const mRel = flavor === 'dev' ? 'manifest.dev.js' : 'manifest.dist.js'
    const wholeRel = flavor === 'dev' ? 'whole.js' : 'dist-whole.js'
    const entry = flavor === 'dev' ? step.devEntry : step.distEntry
    const entries = currentEntries(mRel)
    const idx = entries.indexOf(wholeRel)
    if (idx < 0) throw new Error('[extract] ' + mRel + ' 缺余量条目 ' + wholeRel)
    entries.splice(idx, 0, entry)
    writeManifest(mRel, flavor === 'dev' ? DEV_HEAD : DIST_HEAD, entries)
    console.log('[extract] ' + mRel + ' 登记 ' + entry + '（序位 ' + (idx + 1) + '，余量条目之前）')
  }
  verifyAgainstBaseline(cmd)
}

main()
