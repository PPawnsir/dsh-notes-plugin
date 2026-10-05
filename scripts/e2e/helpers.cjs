'use strict'
/* e2e 共享设施：浏览器启动（Playwright，浏览器通道自动降级 chromium → 系统 Chrome → Edge）
 * + check.js 风格断言原语（passed/failed 计数与输出）+ 等元素/截图等小工具。
 * 浏览器通道由 env E2E_CHANNEL 强制（chrome/msedge/chromium），缺省自动探测。 */
const path = require('path')
const fs = require('fs')
let pw = null
try { pw = require('playwright') } catch (e) { pw = null }

const results = []
function record(name, passed, detail) {
  results.push({ name, passed: !!passed, detail: detail || '' })
  console.log((passed ? '  [passed] ' : '  [failed] ') + name + (detail && !passed ? ' — ' + detail : ''))
}
function t(name, cond, detail) { record(name, cond, typeof detail === 'function' ? detail() : detail) }

async function launchBrowser() {
  if (!pw) throw new Error('playwright 未安装（npm i -D playwright && npx playwright install chromium）')
  const channels = []
  const forced = process.env.E2E_CHANNEL
  if (forced) channels.push({ channel: forced === 'chromium' ? undefined : forced })
  else channels.push({}, { channel: 'chrome' }, { channel: 'msedge' })
  let lastErr
  for (const opt of channels) {
    try { return await pw.chromium.launch({ headless: true, args: ['--no-sandbox'], ...opt }) } catch (e) { lastErr = e }
  }
  throw new Error('无可用的浏览器通道（尝试 chromium/chrome/msedge）— 可先 npx playwright install chromium；原错误：' + (lastErr && lastErr.message))
}

async function newPage(browser, base, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + (e && e.message || e)))
  page.__consoleErrors = consoleErrors
  await page.goto(base + '/', { waitUntil: 'load' })
  await page.waitForSelector('#tree', { timeout: 15000 })
  return page
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/* 轮询等待谓词成立（简化版 waitForFunction，带诊断输出） */
async function waitFor(page, desc, fn, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 8000)
  let lastErr = null
  while (Date.now() < deadline) {
    try { if (await fn(page)) return true } catch (e) { lastErr = e }
    await sleep(150)
  }
  throw new Error('等待超时：' + desc + (lastErr ? ' — ' + lastErr.message : ''))
}

async function screenshot(page, name) {
  const dir = path.join(__dirname, '..', '..', 'check', 'e2e-artifacts')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name.replace(/[^\w.-]+/g, '_') + '.png')
  await page.screenshot({ path: file, fullPage: false })
  return file
}

/* 用例失败自动截图留档（0.4.3②：FAIL-<case>.png），随后原样重抛——不吞错 */
async function step(page, caseName, fn) {
  try { return await fn() } catch (e) {
    try { await screenshot(page, 'FAIL-' + caseName) } catch (_) {}
    throw e
  }
}

/* UI 共用动作：新建文件夹弹层（#addFolder → #fldName → Enter）——全部走真实 UI，零 RPC 旁路 */
async function createFolderViaUI(page, name) {
  await page.click('#addFolder')
  await page.waitForSelector('#fldName', { timeout: 8000 })
  await page.fill('#fldName', name)
  await page.keyboard.press('Enter')
  await waitFor(page, '树中出现文件夹「' + name + '」', async p =>
    p.evaluate(nm => {
      var rows = document.querySelectorAll('#tree .row.head[data-fold]')
      for (var i = 0; i < rows.length; i++) if (rows[i].querySelector('.nm') && rows[i].querySelector('.nm').textContent === nm) return true
      return false
    }, name))
}

/* UI 共用动作：新建笔记（+ → 标题 → 正文 → 切走触发落库），返回后列表已含该标题 */
async function createNoteViaUI(page, title, body) {
  await page.click('#btnNew')
  await page.waitForSelector('#edTitle', { timeout: 8000 })
  await page.click('#edTitle')
  await page.keyboard.type(title)
  if (body) { await page.click('#edSrc'); await page.keyboard.type(body) }
  /* 切走兜底落库（flushDraftCreate）：点已有种子笔记触发 selectNote → 草稿快照落库 */
  await page.click('.note-row[data-note]')
  await waitFor(page, '列表出现笔记「' + title + '」', async p =>
    p.evaluate(t => document.querySelector('#tree').textContent.indexOf(t) >= 0, title))
  await waitFor(page, '草稿落库落定（编辑器切回被点笔记）', async p =>
    p.evaluate(() => !!document.querySelector('#edTitle')))
}

function summary() {
  const failed = results.filter(r => !r.passed)
  console.log('')
  console.log('===== e2e 汇总：' + (results.length - failed.length) + ' passed / ' + failed.length + ' failed（共 ' + results.length + ' 条）=====')
  if (failed.length) { for (const f of failed) console.log('  ✗ ' + f.name + (f.detail ? ' — ' + f.detail : '')) }
  return failed.length === 0
}

module.exports = { launchBrowser, newPage, t, record, waitFor, sleep, screenshot, step, createFolderViaUI, createNoteViaUI, summary, results }
