// check/discover.cjs —— check.js 节注册自动发现（0.4.6-I，notes-046-check-autodiscovery：消除新卡必触 check.js 的批次共享锁）
// 排序契约：文件名开头数字前缀按 '-' 分段转数值元组逐段数值比较（1-2-static-pkg.cjs → [1,2]；1-10 ＞ 1-2 是数值序而非字典序）；
//   元组互为他方前缀时短者在前（[35] ＜ [35,5]——35-splitter 先于 35-5-img-path-hint 的历史次序即靠此规则保持）；
//   元组全等或无数字前缀（异常形态）按文件名全串字典序兜底。
// 红线：节执行顺序零容忍漂移——落地时已用一次性对照脚本断言自动发现序列 ≡ 原硬编码 114 节清单（逐位一致）；
//   节 100（100-check-autodiscovery.cjs）常驻看守本契约 + 注册契约 + 临时节零改动注册行为。
const fs = require('fs')
const path = require('path')

// 文件名开头数字前缀 → 数值元组（'35-5-img-path-hint.cjs' → [35,5]；无数字前缀 → null）
function numTuple(name) {
  const m = /^(\d+(?:-\d+)*)/.exec(name)
  return m ? m[1].split('-').map(Number) : null
}

function compareSectionNames(a, b) {
  const ta = numTuple(a), tb = numTuple(b)
  if (ta && tb) {
    const n = Math.min(ta.length, tb.length)
    for (let i = 0; i < n; i++) if (ta[i] !== tb[i]) return ta[i] - tb[i]
    if (ta.length !== tb.length) return ta.length - tb.length   // 互为他方前缀：短者在前
  }
  return a < b ? -1 : a > b ? 1 : 0   // 等值元组 / 无数字前缀：字典序兜底
}

// 节文件名清单：dir 下 *.cjs 按排序契约排列。纯函数、每次调用重新扫盘——「新增节文件零改动 check.js 即被注册」的契约载体
function listSectionFiles(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.cjs')).sort(compareSectionNames)
}

// 发现 + 加载：返回节模块数组（顺序即执行顺序）
function discoverSections(dir) {
  return listSectionFiles(dir).map(f => require(path.join(dir, f)))
}

module.exports = { numTuple, compareSectionNames, listSectionFiles, discoverSections }
