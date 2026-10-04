// dsh-notes — app 页组装器（design/architecture-modular.md §4.1 app 出口）
//
// 用法：
//   node scripts/concat-app.cjs                     拼装并写盘 packages/dsh-notes-plugin/app.html（构建时提交产物）
//   const { concatApp } = require('./concat-app.cjs')  只拼装返回文本（check.js 可复现断言用）
//
// 契约（红线，不可谈判）：
//   · manifest 驱动逐字节拼接：零插入、零改写、零 banner、不动缩进、不加行。
//   · 模块文件各自是「单文件时代的连续片段」，按 manifest 顺序串接后 = 迁移前 app.html 全文（LF 归一后）。
//   · 以 @shared/ 开头的条目解析到 src/shared/（两态物理共源块，§4.3：编辑器内核 v3 物理单份）；
//     app 态原样纳入（列 0 形态即页面所需形态，client 态的 4 空格基座缩进由 client 拼接侧自负）。
//   · 产物 app.html 写盘提交，check.js 照读产物（另有可复现断言兜底防忘跑）。
//
// manifest 解析契约：与 client 侧同一规则——单引号路径、一行一条的纯清单，文本正则提取；
//   注释中禁止出现单引号字符。app 侧条目允许 .js / .html 两种扩展名。
'use strict'

const fs = require('fs')
const path = require('path')

// __dirname = <plugin>/scripts → 插件根目录
const ROOT = path.resolve(__dirname, '..')
const APP_DIR = path.join(ROOT, 'src', 'app')
const SHARED_DIR = path.join(ROOT, 'src', 'shared')
const MANIFEST_PATH = path.join(APP_DIR, 'manifest.js')
const OUT_PATH = path.join(ROOT, 'packages', 'dsh-notes-plugin', 'app.html')

// 与 client 侧（concat-client.cjs / host-impl.js / index.mjs）保持同一提取规则：逐行提取单引号字符串
function parseManifest(text) {
  const list = (String(text).match(/'[^'\n]+'/g) || []).map((s) => s.slice(1, -1))
  for (const rel of list) {
    if (!/^(@shared\/)?[\w.\-/]+\.(js|html)$/.test(rel) || rel.indexOf('..') >= 0) {
      throw new Error('[concat-app] manifest 非法条目：' + JSON.stringify(rel))
    }
  }
  return list
}

function readManifest() {
  return parseManifest(fs.readFileSync(MANIFEST_PATH, 'utf8'))
}

function readPart(rel) {
  if (rel.indexOf('@shared/') === 0) return fs.readFileSync(path.join(SHARED_DIR, rel.slice('@shared/'.length)), 'utf8')
  return fs.readFileSync(path.join(APP_DIR, rel), 'utf8')
}

// 逐字节串接 + LF 归一（Windows 上模块文件可能是 CRLF，不归一会产出混合换行）
function concatApp() {
  const list = readManifest()
  if (!list.length) throw new Error('[concat-app] manifest 为空或解析失败：' + MANIFEST_PATH)
  let out = ''
  for (const rel of list) out += readPart(rel)
  return out.replace(/\r\n/g, '\n')
}

function main() {
  const out = concatApp()
  fs.writeFileSync(OUT_PATH, out, 'utf8')
  console.log('[concat-app] src/app/**（manifest 拼接） → ' + path.relative(ROOT, OUT_PATH)
    + '（' + out.split('\n').length + ' 行 / ' + Buffer.byteLength(out, 'utf8') + ' 字节）')
}

if (require.main === module) main()

module.exports = { concatApp, readManifest, parseManifest, APP_DIR, SHARED_DIR, MANIFEST_PATH, OUT_PATH }
