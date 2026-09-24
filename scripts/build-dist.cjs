// dsh-notes — P3 构建脚本：开发版 bootstrap 壳 → 发布版静态包（client 端）
//
// 用法：node scripts/build-dist.cjs      （在 dsh-notes-plugin 目录下，或任意目录）
//
// 背景（见 task-board-plugin/docs/PACKAGING.md 第 4 节）：
//   开发版 client-impl.js 是「动态插件」形态——整个文件是 `return { inject, apply(ctx) }`，
//   被 client.js 引导壳用 new Function('React','styles','host', src) 执行，因此可以吃到加载器
//   注入的全局 React / styles / host 桥。发布版静态包不行，四类 API 必须机械换掉：
//     · React       → factory 里 require('react')
//     · host 调用桥  → fetch('/dsh-notes', { method:'POST', body:JSON.stringify({method,args}) })
//     · styles 服务  → fetch CSS + document.createElement('style') 注入 doc
//     · timer 快捷方式 → ctx.get('timer') + ctx.effect（动态插件的 ctx.interval 不存在）
//   本脚本把这套机械转换固定下来：以后改开发版 client-impl.js，跑一次本脚本即可刷新发布包，
//   避免手工迁移漏改（脚本带计数断言，漏改会直接报错而不是静默产出坏包）。
//
// 产物：packages/dsh-notes/lib/client.js（本文件即最终源码，不再二次生成）
'use strict'

const fs = require('fs')
const path = require('path')

// __dirname = <plugin>/scripts → 插件根目录
const ROOT = path.resolve(__dirname, '..')
const IMPL_PATH = path.join(ROOT, 'client-impl.js')
const OUT_PATH = path.join(ROOT, 'packages', 'dsh-notes-plugin', 'lib', 'client.js')
const RPC_PATH = '/dsh-notes'   // 必须与 index.mjs 的 RPC_PATH 一致（webServer exact 路由）

// 归一化换行为 LF：Windows 上开发版可能是 CRLF，不归一化会产出混合换行（且每次 checkout 后产物字节不同）
const impl = fs.readFileSync(IMPL_PATH, 'utf8').replace(/\r\n/g, '\n')
// ---- 1. 语法预检：开发版必须是合法的 `return { inject, apply }` 形态 ----
try { new Function(impl) } catch (e) {
  console.error('[build-dist] client-impl.js 语法错误，转换中止：' + (e && e.message))
  process.exit(1)
}

// ---- 2. 抽取 apply 函数体（大括号配平，跳过字符串/模板串/注释）----
function extractApplyBody(src) {
  const start = src.indexOf('return {')
  if (start < 0) throw new Error('未找到 `return {`：client-impl.js 不是 bootstrap 形态？')
  const anchor = src.indexOf('apply(ctx)', start)
  if (anchor < 0) throw new Error('未找到 `apply(ctx)`')
  const braceStart = src.indexOf('{', anchor + 'apply(ctx)'.length)
  if (braceStart < 0) throw new Error('未找到 apply 的 `{`')

  let depth = 0
  let i = braceStart
  let mode = null          // null | "'" | '"' | '`' | '//' | '/*'
  for (; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (mode === null) {
      if (c === "'" || c === '"' || c === '`') { mode = c; continue }
      if (c === '/' && n === '/') { mode = '//'; i++; continue }
      if (c === '/' && n === '*') { mode = '/*'; i++; continue }
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) break }
      continue
    }
    if (mode === '//') { if (c === '\n') mode = null; continue }
    if (mode === '/*') { if (c === '*' && n === '/') { mode = null; i++ } continue }
    // 字符串/模板串
    if (c === '\\') { i++; continue }
    if (c === mode) { mode = null; continue }
  }
  if (depth !== 0) throw new Error('apply 函数体大括号不配平（depth=' + depth + '）')
  return { body: src.slice(braceStart + 1, i), bodyStart: braceStart + 1 }
}

const { body: rawBody, bodyStart } = extractApplyBody(impl)

// ---- 3. 机械转换（顺序敏感：perf-wrap / styles-block 必须早于 host-call 全量替换）----
// 统一做法：先把 apply 体整体去掉 4 空格缩进（DEDENT），所有锚点/片段都以列 0 书写，
// 产出时再统一缩进 4 空格（INDENT）。这样插入片段和原文缩进一致，脚本自身也不易踩缩进坑。
const DEDENT = (s) => s.split('\n').map((l) => (l.startsWith('    ') ? l.slice(4) : l)).join('\n')
const INDENT = (s) => s.split('\n').map((l) => (l.length ? '    ' + l : l)).join('\n')

// 3.1 样式获取段：动态插件 styles.insert → 静态包 fetch CSS + <style>
// 注意：`/[\s\S]*?loadCss\(\)/` 会先命中函数体内的 `function loadCss(`，
// 锚点必须用「函数声明之后的调用行」——`loadCss()` 独占一行。
const RE_STYLES_BLOCK = /\/\/ 样式从 host 拉取[\s\S]*?\nloadCss\(\)\n/
const STATIC_STYLES_BLOCK = [
  '// 样式从 host 拉取（doc 级 <style> 注入，替代动态插件的 styles 服务）',
  '// PACKAGING.md 坑5：args 里不能出现值为 undefined 的字段，故 notes-css 不传参',
  'let cssLoaded = false',
  'let cssTries = 0',
  'function loadCss() {',
  '  rpc(\'notes-css\').then(function (res) {',
  '    if (res && res.css) {',
  '      cssLoaded = true',
  '      // 进程单例：样式注入 document.head 一次，卸载时移除',
  '      var tag = document.createElement(\'style\')',
  '      tag.dataset.dshNotes = \'1\'',
  '      tag.textContent = res.css',
  '      document.head.append(tag)',
  '      disposers.push(function () { try { tag.remove() } catch (e2) {} })',
  '    } else scheduleCssRetry()',
  '  }).catch(scheduleCssRetry)',
  '}',
  'function scheduleCssRetry() { if (!cssLoaded && ++cssTries <= 10) { var d = timer.timeout(loadCss, 1200); disposers.push(d) } }',
  'loadCss()',
  '',
].join('\n')

// 3.2 timer 快捷方式：动态插件的 ctx.interval / ctx.timeout / ctx.debounce 不存在 → ctx.get('timer')
const STATIC_PERF_TIMER = [
  '// 每 30s 把计数器推给 host，汇总写入 perf-report.json（timer 经 ctx.get + ctx.effect）',
  'try {',
  '  var pd = typeof timer.interval === \'function\' ? timer.interval(function () { try { rpc(\'notes-perf\', { perf: JSON.parse(JSON.stringify(perf)) }) } catch (e2) {} }, 30000) : null',
  '  if (typeof pd === \'function\') ctx.effect(function () { return pd })',
  '} catch (e2) {}',
].join('\n')

// 3.3 性能计数器：不再劫持全局 host 桥（静态包是进程单例，篡改全局桥会污染整个页面），
//     改为在 rpc helper 内部计数——语义等价（hostCall / hostCallMs）。
const STATIC_PERF_WRAP = '// 性能计数器在 rpc() helper 内部累加（hostCall/hostCallMs），不再改写全局 host 桥'

// 3.4 fetch 转发封装：取代动态插件的 host 调用桥
const STATIC_RPC_HELPER = [
  '// client → host RPC：静态包走 webServer exact 路由（PACKAGING.md 第 4 节），',
  '// 与 index.mjs 的 RPC_PATH = \'' + RPC_PATH + '\' 对应。',
  'function rpc(method, args) {',
  '  perf.hostCall++',
  '  var t0 = now()',
  '  return fetch(\'' + RPC_PATH + '\', {',
  '    method: \'POST\',',
  '    headers: { \'Content-Type\': \'application/json\' },',
  '    body: JSON.stringify({ method: method, args: args || {} })',
  '  }).then(',
  '    function (r) { perf.hostCallMs += now() - t0; return r.json() },',
  '    function (err) { perf.hostCallMs += now() - t0; throw err }',
  '  )',
  '}',
].join('\n')

// 3.5 服务获取：保守用 ctx.get + 存在性守卫（PACKAGING.md 第 4 节末条），inject 只留硬依赖 slots
const STATIC_SERVICE_HEAD = [
  'const slots = ctx.get(\'slots\')',
  'if (!slots) { console.error(\'[dsh-notes] slots service unavailable\'); return }',
  'const timer = ctx.get(\'timer\')',
  'if (!timer) { console.error(\'[dsh-notes] timer service unavailable\'); return }',
  'const sessions = ctx.get(\'sessions\')',
  'const workspaces = ctx.get(\'workspaces\')',
].join('\n')

const conversions = [
  ['services-header', /const timer = ctx\.timer\nconst sessions = ctx\.sessions\nconst workspaces = ctx\.workspaces\nconst slots = ctx\.get\('slots'\)\nif \(!slots\) \{ console\.error\('notes plugin: slots unavailable'\); return \}/, STATIC_SERVICE_HEAD],
  ['styles-block', RE_STYLES_BLOCK, STATIC_STYLES_BLOCK],
  ['perf-timer', /\/\/ 每 30s 把计数器推给 host[\s\S]*?disposers\.push\(pd\) \} catch \(e2\) \{\}/, STATIC_PERF_TIMER],
  // 整段（try{...}catch）一次性替换，避免留下孤立的大括号
  ['perf-wrap', /try \{\n  const origCall[\s\S]*?host\.call = \(m, a\) =>[\s\S]*?\n\} catch \(e2\) \{\}/, STATIC_PERF_WRAP],
  ['host-call', /host\.call\(/g, 'rpc('],
  // 最后注入 rpc helper：必须在 perf 计数器之后、首个使用点（loadCss / 各 React effect）之前，
  // 且要等 perf-wrap 整段移除后再插入（否则锚点行会有两份）
  ['rpc-helper', /(try \{ window\.__dshNotesPerf = perf \} catch \(e2\) \{\}\n)/, '$1' + STATIC_RPC_HELPER + '\n'],
]

let body = DEDENT(rawBody)
const counts = {}
// 注意：String.match(非全局正则) 返回的是「捕获组数组」而不是命中次数——
// 带捕获组的模式（如 rpc-helper 的 $1）会得到 length=2 的假命中，这里统一转成全局标志精确计数。
function countHits(pattern) {
  const g = pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + 'g')
  return (body.match(g) || []).length
}
for (const [name, pattern, replacement] of conversions) {
  counts[name] = countHits(pattern)
  body = body.replace(pattern, replacement)
}

// 3.6 缩进：apply 体在 impl 中缩进 4 空格，在静态包里 apply 处于同一层级（factory 内 function apply），保持不变

// ---- 4. 断言：转换必须完整，否则中止（不产出坏包）----
const problems = []
if (counts['services-header'] !== 1) problems.push('services-header 命中 ' + counts['services-header'] + ' 次（期望 1）')
if (counts['styles-block'] !== 1) problems.push('styles-block 命中 ' + counts['styles-block'] + ' 次（期望 1）')
if (counts['perf-timer'] !== 1) problems.push('perf-timer 命中 ' + counts['perf-timer'] + ' 次（期望 1）')
if (counts['perf-wrap'] !== 1) problems.push('perf-wrap 命中 ' + counts['perf-wrap'] + ' 次（期望 1）')
if (counts['rpc-helper'] !== 1) problems.push('rpc-helper 命中 ' + counts['rpc-helper'] + ' 次（期望 1）')
if (counts['host-call'] < 15) problems.push('host.call 仅命中 ' + counts['host-call'] + ' 次（期望 ≥15，疑似漏抓调用点）')
if (body.indexOf('host.call(') >= 0) problems.push('转换后仍有 host.call( 残留')
if (body.indexOf('styles.insert(') >= 0) problems.push('转换后仍有 styles.insert( 残留')
if (body.indexOf('fetch(') < 0) problems.push('缺少 fetch( 调用（RPC helper 未注入）')
if (body.indexOf('document.createElement(\'style\')') < 0) problems.push('缺少 document.createElement(\'style\') 样式注入')
if (body.indexOf('ctx.effect') < 0) problems.push('缺少 ctx.effect 副作用注册')
// 动态插件的 ctx.interval/timeout/debounce 快捷方式在静态包不存在：只允许 ctx.get('timer') 后的 timer.*
if (/\bctx\.(interval|timeout|debounce)\s*\(/.test(body)) problems.push('仍在使用 ctx.interval/timeout/debounce 快捷方式')
if (problems.length) {
  console.error('[build-dist] 转换断言失败：\n  - ' + problems.join('\n  - '))
  process.exit(1)
}

// apply 体以列 0 维护，输出前统一缩进 4 空格（factory 内 function apply 的层级）
const applyBody = INDENT(body.replace(/^\n/, '').replace(/\s+$/, ''))

// ---- 5. 输出模板（__ModuleLoader__ CJS 工厂，参照 task-board-plugin lib/client.js）----
const header = [
  '/* global window, document, fetch, localStorage, performance, PerformanceObserver, console */',
  '// dsh-notes — Browser 侧 bundle（CJS 工厂，供 dsh web 客户端 ModuleLoader 注入）。',
  '//',
  '// 本文件是发布版静态包的 **最终源码**（P3）：由 scripts/build-dist.cjs 从开发版 client-impl.js',
  '// 机械转换而来，转换规则见 task-board-plugin/docs/PACKAGING.md 第 4 节：',
  '//   · React        ：require(\'react\')（静态包无全局 React）',
  '//   · RPC          ：fetch(\'' + RPC_PATH + '\', POST {method, args}) —— index.mjs 的 webServer exact 路由',
  '//                    （动态插件的 host 调用桥在静态包中不存在）',
  '//   · 样式         ：fetch notes-css + document.createElement(\'style\') 注入（doc 级，进程单例）',
  '//                    （动态插件的 styles 服务在静态包中不存在）',
  '//   · 定时器        ：动态插件的 ctx.interval 快捷方式不存在，用 ctx.get(\'timer\') + ctx.effect',
  '//   · inject       ：声明全部服务（slots/timer/sessions/workspaces），保证就绪后才 apply',
  '//',
  '// 要改 client 行为：改开发版 client-impl.js，然后 `node scripts/build-dist.cjs` 重新生成。',
  'window.__ModuleLoader__.load({',
  '  id: \'dsh-notes-plugin\',',
  '  factory: (require) => {',
  '    var module = { exports: {} }',
  '    var exports = module.exports',
  '    \'use strict\'',
  '    const React = require(\'react\')',
  '',
  '    function apply(ctx) {',
].join('\n')

const footer = [
  '    }',
  '',
  '    // inject 声明 apply 用到的全部服务（slots/timer/sessions/workspaces），',
  '    // 保证 Cordis 在服务就绪后才激活 apply；apply 内仍保留 ctx.get + 存在性守卫做双保险。',
  '    module.exports = { name: \'dsh-notes-plugin\', inject: [\'slots\', \'timer\', \'sessions\', \'workspaces\'], apply: apply }',
  '    return module.exports',
  '  }',
  '})',
  '',
].join('\n')

const out = header + '\n' + applyBody + '\n' + footer
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, out, 'utf8')

// ---- 6. 语法自检 + 残留判定 + 摘要 ----
try { new Function(out) } catch (e) {
  console.error('[build-dist] 产出语法错误（已写出，请检查）：' + (e && e.message))
  process.exit(1)
}
// 发布包里连注释都不许出现动态插件专属 API 名——否则纯文本 grep 验收会误判成「没迁干净」
for (const banned of ['host.call', 'styles.insert']) {
  if (out.indexOf(banned) >= 0) {
    console.error('[build-dist] 产出仍含 ' + banned + '（含注释）：请改用中性表述')
    process.exit(1)
  }
}
if (out.indexOf("fetch('" + RPC_PATH + "'") < 0) { console.error('[build-dist] 产出缺少 fetch(\'' + RPC_PATH + '\')'); process.exit(1) }
if (out.indexOf("document.createElement('style')") < 0) { console.error('[build-dist] 产出缺少 style 注入'); process.exit(1) }

console.log('[build-dist] ' + path.relative(ROOT, IMPL_PATH) + ' → ' + path.relative(ROOT, OUT_PATH))
console.log('  转换计数：host.call→rpc ' + counts['host-call'] + ' 处，styles.insert→<style> 段 ' + counts['styles-block'] + ' 处，'
  + 'services-header ' + counts['services-header'] + '，perf-timer ' + counts['perf-timer'] + '，perf-wrap ' + counts['perf-wrap'])
console.log('  产出：' + out.split('\n').length + ' 行 / ' + Buffer.byteLength(out, 'utf8') + ' 字节')
