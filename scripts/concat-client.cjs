// dsh-notes — client 模块组装器（design/architecture-modular.md §4.1）
//
// 用法：const { concatClient } = require('./concat-client.cjs')
//
// 契约（红线，不可谈判）：
//   · manifest 驱动逐字节拼接：零插入、零改写、零 banner、不动缩进、不加行。
//   · 模块文件各自是「单文件时代的连续片段」，按 manifest 顺序串接后 = 昔日 src/client-impl.js 全文（LF 归一后）。
//   · 双出口同源：开发版 notes-src（host 侧运行时拼接）与 scripts/build-dist.cjs（发布版 lib/client.js）
//     共用本组装规则，保证「调试的是 A、发布的也是 A」。
//
// manifest 解析契约：src/client/manifest.js 是「单引号路径、一行一条」的纯清单。
//   host-impl.js（沙箱 new Function，无 require）与 index.mjs（发布包内无 scripts/ 目录）只能文本解析，
//   故三方统一用同一正则提取单引号字符串；manifest 注释中禁止出现单引号字符。
// 以 @shared/ 开头的条目解析到 src/shared/（两态物理共源块，architecture-modular.md §4.3 例外）：
//   共源文件按列 0 维护，client 态纳入时逐非空行加 4 空格基座缩进（单文件时代 apply 函数体层级）。
//   同一规则在三处各有一份实现：本文件 / src/host-impl.js notes-src / packages/dsh-notes-plugin/index.mjs notes-src。
'use strict'

const fs = require('fs')
const path = require('path')

// __dirname = <plugin>/scripts → 插件根目录
const ROOT = path.resolve(__dirname, '..')
const CLIENT_DIR = path.join(ROOT, 'src', 'client')
const SHARED_DIR = path.join(ROOT, 'src', 'shared')
const I18N_DIR = path.join(ROOT, 'src', 'i18n')   // @i18n/ 前缀 = src/i18n/ 双语字典（notes-042-i18n-mech；共源 + 基座缩进同 @shared/）
const MANIFEST_PATH = path.join(CLIENT_DIR, 'manifest.js')

// client 基座缩进：apply(ctx) 函数体层级 = 4 空格（与 build-dist.cjs 的 INDENT 同语义）
const CLIENT_BASE_INDENT = '    '

// 与 host-impl.js / index.mjs 内联解析保持同一规则：逐行提取单引号字符串
function parseManifest(text) {
  const list = (String(text).match(/'[^'\n]+'/g) || []).map((s) => s.slice(1, -1))
  for (const rel of list) {
    if (!/^(@shared\/|@i18n\/)?[\w.\-/]+\.js$/.test(rel) || rel.indexOf('..') >= 0) {
      throw new Error('[concat-client] manifest 非法条目：' + JSON.stringify(rel))
    }
  }
  return list
}

function readManifest() {
  return parseManifest(fs.readFileSync(MANIFEST_PATH, 'utf8'))
}

// @shared/ 与 @i18n/ 条目：从 src/shared/ 与 src/i18n/ 读列 0 形态，逐非空行加 client 基座缩进（先 LF 归一再缩进，避免 CR 被误判为行内容）
function readPart(rel) {
  const atShared = rel.indexOf('@shared/') === 0, atI18n = rel.indexOf('@i18n/') === 0
  if (atShared || atI18n) {
    const base = atShared ? SHARED_DIR : I18N_DIR
    const t = fs.readFileSync(path.join(base, rel.slice(rel.indexOf('/') + 1)), 'utf8').replace(/\r\n/g, '\n')
    return t.split('\n').map((l) => (l.length ? CLIENT_BASE_INDENT + l : l)).join('\n')
  }
  return fs.readFileSync(path.join(CLIENT_DIR, rel), 'utf8')
}

// 逐字节串接 + LF 归一（Windows 上模块文件可能是 CRLF，不归一会产出混合换行）
function concatClient() {
  const list = readManifest()
  if (!list.length) throw new Error('[concat-client] manifest 为空或解析失败：' + MANIFEST_PATH)
  let out = ''
  for (const rel of list) out += readPart(rel)
  return out.replace(/\r\n/g, '\n')
}

module.exports = { concatClient, readManifest, parseManifest, CLIENT_DIR, SHARED_DIR, I18N_DIR, MANIFEST_PATH }
