'use strict'
/* e2e runner：启动 mock host 静态服务（app.html 直开，无需真实 DSH host）
 * → 加载 cases/ 目录逐条执行 → check.js 风格汇总 → 有 failed 则 exit 1。
 * 用法：npm run e2e（= node scripts/e2e/e2e.js）；单条过滤：node scripts/e2e/e2e.js 02 */
const path = require('path')
const fs = require('fs')
const { startServer } = require('./server.cjs')
const H = require('./helpers.cjs')

const CASES_DIR = path.join(__dirname, 'cases')
const filter = process.argv[2] || ''

async function main() {
  const { server, port, state } = await startServer(Number(process.env.E2E_PORT) || 0)
  const base = 'http://127.0.0.1:' + port
  console.log('[e2e] mock host: ' + base)

  const files = fs.readdirSync(CASES_DIR).filter(f => f.endsWith('.cjs') && (!filter || f.indexOf(filter) >= 0)).sort()
  if (!files.length) { console.error('[e2e] 无用例'); process.exit(1) }

  const browser = await H.launchBrowser()
  let hardFail = false
  try {
    for (const f of files) {
      const mod = require(path.join(CASES_DIR, f))
      console.log('\n[e2e] 用例 ' + f + ' — ' + (mod.name || ''))
      const before = H.results.length
      try { await mod.run({ base, browser, H, state }) }
      catch (e) { H.record('用例执行未抛异常（' + f + '）', false, String(e && e.message || e)) }
      if (H.results.length === before) H.record('用例至少一条断言（' + f + '）', false, '未产生任何断言')
    }
  } catch (e) {
    hardFail = true
    console.error('[e2e] 致命错误：' + (e && e.stack || e))
  } finally {
    await browser.close().catch(() => {})
    server.close()
  }
  const ok = H.summary() && !hardFail
  process.exit(ok ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
