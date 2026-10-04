// P2·3 host kernel 抽出切片器（一次性迁移工装；绞杀者逐模块切出，design/architecture-modular.md §8.3/§8.5）
// 用法：node scratch/p2-kernel-extract.cjs snap|step1..step6|verify
//   snap   ：快照 whole.js / dist-whole.js 当前内容（LF 归一）为逐字节基线（首步前执行一次）
//   stepN  ：按原位坐标切出第 N 个模块（双包同步），重写两份 manifest，并机械复验拼接产物 === 基线
//   verify ：仅复验当前盘态拼接产物 === 基线（不改任何文件）
// 坐标锚点来自 scratch/p2-host-concat/ranges.cjs（PoC 已机械复验），本脚本切片前再逐片核对首行锚点，漂移即 throw。
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const HOST_DIR = path.join(ROOT, 'src', 'host')
const BASE_WHOLE = path.join(__dirname, 'p2-kernel-baseline-whole.js')
const BASE_DIST = path.join(__dirname, 'p2-kernel-baseline-dist-whole.js')

function readNorm(p) { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }

// 原位坐标切片（1 基，end 含本行；end=0 表示到 EOF）。首行锚点非空时强制核对。
function sliceFrom(lines, start, end, anchor, tag) {
  if (anchor != null) {
    const first = lines[start - 1] || ''
    if (first.indexOf(anchor) !== 0) {
      throw new Error('[extract] 锚点漂移 ' + tag + '：期望行首 ' + JSON.stringify(anchor) + '，实得 ' + JSON.stringify(first.slice(0, 80)))
    }
  }
  if (end === 0) return lines.slice(start - 1).join('\n')
  return lines.slice(start - 1, end).join('\n') + '\n'
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
  '// inject/sensitive-helpers.js、llm/usage-classify.js、history-trash/engine.js 为邻域原位驻留片（P2·4 续切），whole.js 为未切余量。',
]
const DIST_HEAD = [
  '// host 模块清单（发布版）—— scripts/build-dist.cjs 构建期拼接写盘 packages/dsh-notes-plugin/index.mjs 的组装依据',
  '// 解析规则同 scripts/concat-client.cjs：逐行提取单引号字符串；注释中禁止出现单引号字符。',
  '// P2·3 kernel 抽出：与开发版共用 kernel/ 同名片（逐字节一致片物理单份）；.dist.js 后缀 = 发布版变体片（§8.4.3 红线 9 登记）。',
  '// head.js/apply-head.js 为发布版头部驻留片（P2·4 续切），dist-whole.js 为未切余量。',
]

function writeManifest(rel, head, entries) {
  const body = head.concat(entries.map((e) => "'" + e + "'")).join('\n') + '\n'
  fs.writeFileSync(path.join(HOST_DIR, rel), body)
}

// ===== 步进定义（坐标 = whole.js / dist-whole.js 原位行号；每步只重写本步涉及的文件 + 余量文件）=====
// dev 余量文件恒为 whole.js（尾部收缩），dist 余量文件恒为 dist-whole.js。
const STEPS = {
  step1: { // kernel/format.js（共享工具：genId/basename/shortSid/parseDispatches/escYaml）——双包逐字节一致片
    dev: { srcStart: 58, writes: [
      { rel: 'kernel/head.js', start: 1, end: 30, anchor: null },
      { rel: 'kernel/format.js', start: 31, end: 57, anchor: '    function genId()' },
    ] },
    dist: { srcStart: 131, writes: [
      { rel: 'head.js', start: 1, end: 84, anchor: null },
      { rel: 'apply-head.js', start: 85, end: 103, anchor: 'export function apply(ctx)' },
      { rel: 'kernel/format.js', start: 104, end: 130, anchor: '    function genId()', shared: true },
    ] },
    devEntries: ['kernel/head.js', 'kernel/format.js', 'whole.js'],
    distEntries: ['head.js', 'apply-head.js', 'kernel/format.js', 'dist-whole.js'],
  },
  step2: { // kernel/front-matter.js（slim/序列化：buildFM/parseFM/noteFileContent 等）
    dev: { srcStart: 169, writes: [
      { rel: 'inject/sensitive-helpers.js', start: 58, end: 102, anchor: '    // ==== sensitive-helpers BEGIN ====' },
      { rel: 'kernel/front-matter.js', start: 103, end: 168, anchor: '    function buildFM(m)' },
    ] },
    dist: { srcStart: 242, writes: [
      { rel: 'inject/sensitive-helpers.js', start: 131, end: 175, anchor: '    // ==== sensitive-helpers BEGIN ====', shared: true },
      { rel: 'kernel/front-matter.js', start: 176, end: 241, anchor: '    function buildFM(m)', shared: true },
    ] },
    devEntries: ['kernel/head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'whole.js'],
    distEntries: ['head.js', 'apply-head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'dist-whole.js'],
  },
  step3: { // kernel/session-ctx.js（会话元数据缓存 sessCtx 族）——双包逐字节一致片
    dev: { srcStart: 199, writes: [
      { rel: 'kernel/session-ctx.js', start: 169, end: 198, anchor: '    function sessCtx()' },
    ] },
    dist: { srcStart: 272, writes: [
      { rel: 'kernel/session-ctx.js', start: 242, end: 271, anchor: '    function sessCtx()', shared: true },
    ] },
    devEntries: ['kernel/head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'whole.js'],
    distEntries: ['head.js', 'apply-head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'dist-whole.js'],
  },
  step4: { // kernel/settings-store.js（settings.json 读写）——双包变体
    dev: { srcStart: 272, writes: [
      { rel: 'kernel/settings-store.js', start: 199, end: 271, anchor: '    // ---- 设置持久化（SETTINGS_PATH）' },
    ] },
    dist: { srcStart: 341, writes: [
      { rel: 'kernel/settings-store.dist.js', start: 272, end: 340, anchor: '    // ---- 设置持久化（SETTINGS_PATH）' },
    ] },
    devEntries: ['kernel/head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'kernel/settings-store.js', 'whole.js'],
    distEntries: ['head.js', 'apply-head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'kernel/settings-store.dist.js', 'dist-whole.js'],
  },
  step5: { // kernel/store-cache.js（存储层：cache/fs 封装/模板骨架 seed/noteFromParsed/readNoteFile + use-telemetry 块）
    dev: { srcStart: 624, writes: [
      { rel: 'llm/usage-classify.js', start: 272, end: 484, anchor: '    // ==== llm-usage BEGIN ====' },
      { rel: 'kernel/store-cache.js', start: 485, end: 623, anchor: '    // ---- 缓存层：解析结果按 id 常驻内存' },
    ] },
    dist: { srcStart: 695, writes: [
      { rel: 'llm/usage-classify.dist.js', start: 341, end: 553, anchor: '    // ==== llm-usage BEGIN ====' },
      { rel: 'kernel/store-cache.dist.js', start: 554, end: 694, anchor: '    // ---- 缓存层：解析结果按 id 常驻内存' },
    ] },
    devEntries: ['kernel/head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'kernel/settings-store.js', 'llm/usage-classify.js', 'kernel/store-cache.js', 'whole.js'],
    distEntries: ['head.js', 'apply-head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'kernel/settings-store.dist.js', 'llm/usage-classify.dist.js', 'kernel/store-cache.dist.js', 'dist-whole.js'],
  },
  step6: { // kernel/persist.js（持久化：persistNote + slim）
    dev: { srcStart: 899, writes: [
      { rel: 'history-trash/engine.js', start: 624, end: 872, anchor: '    // ==== history-engine BEGIN ====' },
      { rel: 'kernel/persist.js', start: 873, end: 898, anchor: '    async function persistNote(n, opts)' },
    ] },
    dist: { srcStart: 977, writes: [
      { rel: 'history-trash/engine.dist.js', start: 695, end: 950, anchor: '    // ==== history-engine BEGIN ====' },
      { rel: 'kernel/persist.dist.js', start: 951, end: 976, anchor: '    async function persistNote(n, opts)' },
    ] },
    devEntries: ['kernel/head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'kernel/settings-store.js', 'llm/usage-classify.js', 'kernel/store-cache.js', 'history-trash/engine.js', 'kernel/persist.js', 'whole.js'],
    distEntries: ['head.js', 'apply-head.js', 'kernel/format.js', 'inject/sensitive-helpers.js', 'kernel/front-matter.js', 'kernel/session-ctx.js', 'kernel/settings-store.dist.js', 'llm/usage-classify.dist.js', 'kernel/store-cache.dist.js', 'history-trash/engine.dist.js', 'kernel/persist.dist.js', 'dist-whole.js'],
  },
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
  if (cmd === 'snap') {
    fs.writeFileSync(BASE_WHOLE, readNorm(path.join(HOST_DIR, 'whole.js')))
    fs.writeFileSync(BASE_DIST, readNorm(path.join(HOST_DIR, 'dist-whole.js')))
    console.log('[extract] 基线快照完成：whole.js=' + fs.statSync(BASE_WHOLE).size + 'B dist-whole.js=' + fs.statSync(BASE_DIST).size + 'B')
    return
  }
  if (cmd === 'verify') { verifyAgainstBaseline('verify'); return }
  const step = STEPS[cmd]
  if (!step) throw new Error('[extract] 未知命令：' + cmd)
  if (!fs.existsSync(BASE_WHOLE) || !fs.existsSync(BASE_DIST)) throw new Error('[extract] 缺基线快照，先跑 snap')

  const devLines = readNorm(BASE_WHOLE).split('\n')
  const distLines = readNorm(BASE_DIST).split('\n')
  if (devLines[devLines.length - 1] !== '' || distLines[distLines.length - 1] !== '') throw new Error('[extract] 基线文件尾行形态异常（缺尾部换行）')

  // 1) 逐片切片 + 锚点核对；shared 片强制双包字节一致后才落盘一次
  const planned = new Map() // rel → text（同一步内同名文件必须字节一致）
  for (const flavor of ['dev', 'dist']) {
    const lines = flavor === 'dev' ? devLines : distLines
    for (const w of step[flavor].writes) {
      const text = sliceFrom(lines, w.start, w.end, w.anchor, flavor + ':' + w.rel)
      if (planned.has(w.rel)) {
        if (planned.get(w.rel) !== text) throw new Error('[extract] 共享片双包字节不一致：' + w.rel + '（禁止单份落盘，须改登记为变体）')
      } else if (w.shared && flavor === 'dist') {
        // 与开发版同名片：必须已在 dev 切片中出现过且一致（上面 planned 比对）；若 dev 未先写则报错
        throw new Error('[extract] 共享片须先经 dev 侧切片登记：' + w.rel)
      } else {
        planned.set(w.rel, text)
      }
    }
  }
  // 2) 落盘模块片
  for (const [rel, text] of planned) writePart(rel, text)
  // 3) 余量文件收缩（从基线切片，恒覆盖重写）
  writePart('whole.js', sliceFrom(devLines, step.dev.srcStart, 0, null, 'dev:whole.js'))
  writePart('dist-whole.js', sliceFrom(distLines, step.dist.srcStart, 0, null, 'dist:dist-whole.js'))
  // 4) 重写两份 manifest
  writeManifest('manifest.dev.js', DEV_HEAD, step.devEntries)
  writeManifest('manifest.dist.js', DIST_HEAD, step.distEntries)
  console.log('[extract] ' + cmd + ' 切片落盘：' + [...planned.keys()].join('、') + '；余量 whole.js 自 L' + step.dev.srcStart + ' 起 / dist-whole.js 自 L' + step.dist.srcStart + ' 起')
  // 5) 逐字节复验（读盘真实拼接）
  verifyAgainstBaseline(cmd)
}

main()
