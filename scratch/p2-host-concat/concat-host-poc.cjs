// P2·1 技术验证 · host 组装器 PoC（与 scripts/concat-client.cjs 同一契约）
// 契约（红线，不可谈判）：
//   · manifest 驱动逐字节拼接：零插入、零改写、零 banner、不动缩进、不加行。
//   · 模块文件各自是「单文件时代的连续片段」，按 manifest 顺序串接后 = 源单文件全文（LF 归一后）。
// manifest 解析契约：单引号路径、一行一条的纯清单，文本正则提取（沙箱无 require，与
//   host-impl.js notes-src / index.mjs notes-src / concat-client.cjs 三方同一规则）；
//   manifest 注释中禁止出现单引号字符。
'use strict'
const fs = require('fs')
const path = require('path')

function parseManifest(text) {
  const list = (String(text).match(/'[^'\n]+'/g) || []).map((s) => s.slice(1, -1))
  for (const rel of list) {
    if (!/^[\w.\-/]+\.js$/.test(rel) || rel.indexOf('..') >= 0) {
      throw new Error('[concat-host-poc] manifest 非法条目：' + JSON.stringify(rel))
    }
  }
  return list
}

// 逐字节串接 + LF 归一（Windows 上模块文件可能是 CRLF，不归一会产出混合换行）
function concatHost(manifestAbs) {
  const base = path.dirname(manifestAbs)
  const list = parseManifest(fs.readFileSync(manifestAbs, 'utf8'))
  if (!list.length) throw new Error('[concat-host-poc] manifest 为空或解析失败：' + manifestAbs)
  let out = ''
  for (const rel of list) out += fs.readFileSync(path.join(base, rel), 'utf8')
  return out.replace(/\r\n/g, '\n')
}

module.exports = { parseManifest, concatHost }
