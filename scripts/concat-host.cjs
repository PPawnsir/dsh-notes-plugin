// dsh-notes — host 模块组装器（design/architecture-modular.md §8.4.1）
//
// 用法：const { concatHost, concatHostDist } = require('./concat-host.cjs')
//
// 契约（红线，不可谈判）：
//   · manifest 驱动逐字节拼接：零插入、零改写、零 banner、不动缩进、不加行。
//   · 模块文件各自是「单文件时代的连续片段」，按 manifest 顺序串接后 = 昔日单文件全文（LF 归一后）：
//       concatHost()     ⇐ 昔日 src/host-impl.js（开发版，host.js 引导壳运行时拼接）
//       concatHostDist() ⇐ 昔日 packages/dsh-notes-plugin/index.mjs（发布版，build-dist.cjs 构建期拼接写盘提交）
//   · 双包出口同源：开发版与发布版共用本组装规则与 src/host/** 模块树——
//     「调试的是 A、发布的也是 A 的发布形态」，差异片在两棵清单中显式登记为变体（§8.4.3 红线 9）。
//
// manifest 解析契约：src/host/manifest.*.js 是「单引号路径、一行一条」的纯清单。
//   host.js（沙箱 new Function，无 require）只能文本解析，故多方统一用同一正则提取单引号字符串；
//   manifest 注释中禁止出现单引号字符（同一规则的另一份实现：scripts/concat-client.cjs）。
// 以 @shared-host/ 开头的条目解析到 src/shared-host/（双包物理共源块，§8.4.3 增强预留）：
//   host 两态同为 apply 体 4 空格基座，共源文件原样纳入、无缩进提升（§8.4.1）。
'use strict'

const fs = require('fs')
const path = require('path')

// __dirname = <plugin>/scripts → 插件根目录
const ROOT = path.resolve(__dirname, '..')
const HOST_DIR = path.join(ROOT, 'src', 'host')
const SHARED_HOST_DIR = path.join(ROOT, 'src', 'shared-host')
const MANIFEST_DEV_PATH = path.join(HOST_DIR, 'manifest.dev.js')
const MANIFEST_DIST_PATH = path.join(HOST_DIR, 'manifest.dist.js')

// 与 host.js 引导壳 / concat-client.cjs 内联解析保持同一规则：逐行提取单引号字符串
function parseManifest(text) {
  const list = (String(text).match(/'[^'\n]+'/g) || []).map((s) => s.slice(1, -1))
  for (const rel of list) {
    if (!/^(@shared-host\/)?[\w.\-/]+\.js$/.test(rel) || rel.indexOf('..') >= 0) {
      throw new Error('[concat-host] manifest 非法条目：' + JSON.stringify(rel))
    }
  }
  return list
}

function readManifest(manifestPath) {
  return parseManifest(fs.readFileSync(manifestPath, 'utf8'))
}

// @shared-host/ 条目：从 src/shared-host/ 原样读入（host 两态基座一致，无缩进提升——§8.4.1）
function readPart(rel) {
  if (rel.indexOf('@shared-host/') === 0) {
    return fs.readFileSync(path.join(SHARED_HOST_DIR, rel.slice('@shared-host/'.length)), 'utf8')
  }
  return fs.readFileSync(path.join(HOST_DIR, rel), 'utf8')
}

// 逐字节串接 + LF 归一（Windows 上模块文件可能是 CRLF，不归一会产出混合换行）
function concatManifest(manifestPath) {
  const list = readManifest(manifestPath)
  if (!list.length) throw new Error('[concat-host] manifest 为空或解析失败：' + manifestPath)
  let out = ''
  for (const rel of list) out += readPart(rel)
  return out.replace(/\r\n/g, '\n')
}

// 开发版产物：src/host/**（manifest.dev.js）逐字节拼接 = 昔日 src/host-impl.js 全文
function concatHost() { return concatManifest(MANIFEST_DEV_PATH) }

// 发布版产物：src/host/**（manifest.dist.js）逐字节拼接 = packages/dsh-notes-plugin/index.mjs 应然内容
function concatHostDist() { return concatManifest(MANIFEST_DIST_PATH) }

module.exports = { concatHost, concatHostDist, parseManifest, readManifest, HOST_DIR, SHARED_HOST_DIR, MANIFEST_DEV_PATH, MANIFEST_DIST_PATH }
