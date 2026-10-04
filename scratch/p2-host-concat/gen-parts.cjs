// P2·1 技术验证 · 切片生成器
// 按 ranges.cjs 的锚点清单把现行单文件（host-impl.js / index.mjs）切成「连续片段」模块文件，
// 落盘 out/src-host/** 与 out/pkg-host/**（各带一份 manifest.js），并立即验证：
//   manifest 顺序串接（LF 归一） === 源文件全文（LF 归一）——逐字节恒等是拼接红线的起点。
// 用法：node scratch/p2-host-concat/gen-parts.cjs
'use strict'
const fs = require('fs')
const path = require('path')
const { host, dist } = require('./ranges.cjs')

const ROOT = path.resolve(__dirname, '..', '..')   // 插件根目录

function cut(target) {
  const srcAbs = path.join(ROOT, target.source)
  const raw = fs.readFileSync(srcAbs, 'utf8')
  const text = raw.replace(/\r\n/g, '\n')          // 磁盘 CRLF → 归一 LF（拼接契约口径）
  const lines = text.split('\n')
  // 每行起始字节偏移（字符偏移；全文 ASCII 注解与中文共存，用字符串切片不用字节）
  const offs = []
  let o = 0
  for (const ln of lines) { offs.push(o); o += ln.length + 1 }

  // 顺序解析锚点 → 切点行号（1-based）
  const cuts = []
  let searchFrom = 0
  for (const [name, anchor] of target.parts) {
    if (anchor === null) { cuts.push({ name, line: 1 }); continue }
    let found = -1
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].indexOf(anchor) === 0) { found = i; break }
    }
    if (found < 0) throw new Error('[gen-parts] 锚点未命中（' + target.name + ' / ' + name + '）：' + JSON.stringify(anchor))
    cuts.push({ name, line: found + 1 })
    searchFrom = found + 1
  }

  // 边界 lint：切点上一行应为空行或 }（域间自然缝隙），否则告警人工复核
  const ranges = []
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i].line
    const end = (i + 1 < cuts.length) ? cuts[i + 1].line - 1 : lines.length
    if (i > 0) {
      const prev = lines[start - 2]
      if (prev !== '' && prev.trim() !== '}') {
        console.log('  [lint-warn] ' + target.name + ' ' + cuts[i].name + ' 切点上一行非空行/}：' + JSON.stringify(prev.slice(0, 72)))
      }
    }
    ranges.push({ name: cuts[i].name, start, end, lines: end - start + 1 })
  }

  // 写盘：每片 = 源文件的连续片段（含片尾换行；最后一片含文件末尾）
  const outDir = path.join(__dirname, target.outDir)
  fs.rmSync(outDir, { recursive: true, force: true })
  for (const r of ranges) {
    const slice = text.slice(offs[r.start - 1], r.end >= lines.length ? undefined : offs[r.end])
    if (slice.indexOf('\r') >= 0) throw new Error('[gen-parts] 片段含 CR：' + r.name)
    const p = path.join(outDir, r.name)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, slice, 'utf8')
  }

  // manifest：与 src/client/manifest.js 同一契约——单引号路径一行一条，注释禁单引号字符
  const man = '// host 模块清单（PoC 由 gen-parts.cjs 生成：' + target.name + '）\n'
    + '// 解析规则同 concat-client.cjs：逐行提取单引号字符串；注释中禁止出现单引号\n'
    + ranges.map((r) => "'" + r.name + "'").join('\n') + '\n'
  fs.writeFileSync(path.join(outDir, 'manifest.js'), man, 'utf8')
  fs.writeFileSync(path.join(__dirname, target.rangesOut), JSON.stringify(ranges, null, 2) + '\n', 'utf8')

  // 即时恒等验证：从磁盘读回切片串接 === 源文本
  const joined = ranges.map((r) => fs.readFileSync(path.join(outDir, r.name), 'utf8')).join('').replace(/\r\n/g, '\n')
  if (joined !== text) throw new Error('[gen-parts] 逐字节恒等失败：' + target.name)

  console.log('[gen-parts] ' + target.name + '：' + ranges.length + ' 片 / ' + lines.length + ' 行 → ' + target.outDir + '（拼接恒等 ✓）')
  for (const r of ranges) console.log('    ' + r.name + '  L' + r.start + '–L' + r.end + '（' + r.lines + ' 行）')
}

cut(host)
cut(dist)
