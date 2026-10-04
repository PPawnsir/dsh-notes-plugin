// P2·1 技术验证 · 双包同名切片比对（dev src-host ⇄ dist pkg-host）
// 目的：给出「物理共源面」实据——哪些模块片双包逐字节一致（可作 @shared/ 候选）、哪些本质是变体片。
// 用法：node scratch/p2-host-concat/compare-flavors.cjs（需先跑 gen-parts.cjs）
'use strict'
const fs = require('fs')
const path = require('path')

const A = path.join(__dirname, 'out', 'src-host')
const B = path.join(__dirname, 'out', 'pkg-host')
const names = fs.readdirSync(A, { recursive: true })
  .map((x) => String(x).replace(/\\/g, '/'))
  .filter((x) => x.endsWith('.js') && x !== 'manifest.js')
  .sort()

let same = 0, diff = 0
for (const n of names) {
  const bp = path.join(B, n)
  if (!fs.existsSync(bp)) { console.log('dev-only  ' + n); continue }
  const a = fs.readFileSync(path.join(A, n), 'utf8')
  const b = fs.readFileSync(bp, 'utf8')
  if (a === b) { same++; console.log('IDENTICAL  ' + n) } else { diff++; console.log('diff       ' + n + '（' + (a.split('\n').length - 1) + ' vs ' + (b.split('\n').length - 1) + ' 行）') }
}
console.log('\n[compare-flavors] 同名切片 ' + names.length + ' 片：逐字节一致 ' + same + ' / 有差异 ' + diff)
