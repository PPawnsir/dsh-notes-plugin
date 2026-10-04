// R-4 键盘流真实键盘事件模拟（puppeteer-core + 本机 Chrome，无头）
// 对象：design/notes-ui-v2.html（单文件原型，自带 mock RPC——与 app.html 同一套 UI/交互口径）
// 覆盖：j/k/↑↓ 移动 + .focused 可见态 / Enter 打开 / Ctrl+K 聚焦 / 搜索↓桥接（保留过滤）/
//       Esc 分层（清搜索+还焦列表，j/k 不误入输入框）/ Alt+N 新建 / Ctrl+N 不再响应
const puppeteer = require('puppeteer-core')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = 'file:///D:/deepseek-work/dsh-notes-plugin/design/notes-ui-v2.html'

let failed = 0
function assert(name, ok, extra) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  （' + extra + '）' : ''))
  if (!ok) failed++
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
  const page = await browser.newPage()
  page.on('pageerror', e => { console.log('  ✗ 页面脚本错误: ' + e.message); failed++ })
  await page.goto(URL, { waitUntil: 'load' })
  await page.waitForSelector('.note-row', { timeout: 8000 })
  await sleep(200)

  const visibleIds = () => page.evaluate(() => Array.from(document.querySelectorAll('#tree [data-note]')).map(el => el.dataset.note))
  const focusedId = () => page.evaluate(() => { const el = document.querySelector('#tree .note-row.focused'); return el ? el.dataset.note : null })
  const selIdDom = () => page.evaluate(() => { const el = document.querySelector('#tree .note-row.sel'); return el ? el.dataset.note : null })
  const activeTag = () => page.evaluate(() => document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'NONE')
  const qVal = () => page.evaluate(() => document.getElementById('q').value)

  console.log('== 1. j/k/↑↓ 列表导航 + 可见选中态 ==')
  const ids0 = await visibleIds()
  assert('列表初始可见行 ≥ 3', ids0.length >= 3, 'rows=' + ids0.length)
  await page.keyboard.press('j'); await sleep(50)
  assert('j → 焦点落到首行（.focused 出现）', (await focusedId()) === ids0[0], 'focused=' + (await focusedId()))
  await page.keyboard.press('j'); await sleep(50)
  assert('j → 焦点下移第二行', (await focusedId()) === ids0[1])
  await page.keyboard.press('ArrowDown'); await sleep(50)
  assert('↓ → 焦点下移第三行', (await focusedId()) === ids0[2])
  await page.keyboard.press('k'); await sleep(50)
  assert('k → 焦点回第二行', (await focusedId()) === ids0[1])
  await page.keyboard.press('ArrowUp'); await sleep(50)
  assert('↑ → 焦点回首行', (await focusedId()) === ids0[0])
  const focusedBg = await page.evaluate(() => {
    const el = document.querySelector('#tree .note-row.focused')
    return el ? getComputedStyle(el).backgroundColor : null
  })
  assert('焦点行背景色生效（非透明）', !!focusedBg && focusedBg !== 'rgba(0, 0, 0, 0)' && focusedBg !== 'transparent', focusedBg)

  console.log('== 2. Enter 打开焦点行 ==')
  await page.keyboard.press('Enter'); await sleep(150)
  assert('Enter → 焦点行被打开（sel=focused）', (await selIdDom()) === ids0[0], 'sel=' + (await selIdDom()))

  console.log('== 3. Ctrl+K 聚焦搜索 → 输入过滤 → ↓ 桥接列表（保留过滤）→ Enter 打开 ==')
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await sleep(50)
  assert('Ctrl+K → 焦点进搜索框', (await activeTag()) === 'q')
  // 取第二行标题前两个字作为查询词（保证有命中且过滤后变少）
  const probe = await page.evaluate(() => { const el = document.querySelectorAll('#tree .note-row .ti')[1]; return el ? el.textContent.trim().slice(0, 2) : '' })
  await page.keyboard.type(probe, { delay: 10 }); await sleep(400)   // 等 250ms 防抖 + mock rpc 30ms
  const idsFiltered = await visibleIds()
  assert('输入「' + probe + '」→ 列表过滤收窄', idsFiltered.length > 0 && idsFiltered.length < ids0.length, ids0.length + ' → ' + idsFiltered.length)
  assert('输入字母时 j/k 未被抢（查询词原样保留）', (await qVal()) === probe, 'q=' + (await qVal()))
  await page.keyboard.press('ArrowDown'); await sleep(80)
  assert('搜索框 ↓ → 焦点离开输入框、落到列表容器', (await activeTag()) === 'tree', 'active=' + (await activeTag()))
  assert('↓ 桥接后首条命中被聚焦（过滤上下文保留）', (await focusedId()) === idsFiltered[0], 'focused=' + (await focusedId()))
  assert('桥接后过滤未丢（行数不变）', (await visibleIds()).length === idsFiltered.length)
  await page.keyboard.press('Enter'); await sleep(150)
  assert('Enter → 打开首条命中', (await selIdDom()) === idsFiltered[0], 'sel=' + (await selIdDom()))

  console.log('== 4. Esc 焦点分层：清搜索 + 还焦列表（不得滞留输入框） ==')
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await sleep(50)
  await page.keyboard.type('zz', { delay: 10 }); await sleep(350)
  const cntBeforeEsc = (await visibleIds()).length
  await page.keyboard.press('Escape'); await sleep(120)
  assert('Esc → 搜索词清空', (await qVal()) === '', 'q=' + (await qVal()))
  assert('Esc → 列表恢复全量', (await visibleIds()).length === ids0.length, 'before=' + cntBeforeEsc + ' after=' + (await visibleIds()).length)
  assert('Esc → 焦点离开搜索框、落在列表容器', (await activeTag()) === 'tree', 'active=' + (await activeTag()))
  await page.keyboard.press('j'); await sleep(80)
  assert('Esc 后 j → 立即生效（焦点行移动）且字母不误入搜索框', !!(await focusedId()) && (await qVal()) === '', 'focused=' + (await focusedId()) + ' q=' + (await qVal()))

  console.log('== 5. Alt+N 新建 / Ctrl+N 不再响应 ==')
  const cnt0 = (await visibleIds()).length
  await page.keyboard.down('Alt'); await page.keyboard.press('n'); await page.keyboard.up('Alt'); await sleep(400)
  const cnt1 = (await visibleIds()).length
  assert('Alt+N → 新建笔记落库并入选（行数 +1）', cnt1 === cnt0 + 1, cnt0 + ' → ' + cnt1)
  const selAfterNew = await selIdDom()
  assert('Alt+N → 新笔记被选中且不在原清单', !!selAfterNew && ids0.indexOf(selAfterNew) < 0, 'sel=' + selAfterNew)
  await page.keyboard.down('Control'); await page.keyboard.press('n'); await page.keyboard.up('Control'); await sleep(300)
  assert('Ctrl+N → 页面不再响应（行数不变）', (await visibleIds()).length === cnt1, 'rows=' + (await visibleIds()).length)

  console.log('== 6. Esc 栈回归：多选态 Esc 退出不受影响 ==')
  // 直接点「选择」进多选态，Esc 应退出多选而不是清搜索
  await page.evaluate(() => { document.getElementById('btnSelMode').click() })
  await sleep(80)
  await page.keyboard.press('Escape'); await sleep(80)
  const selModeOff = await page.evaluate(() => document.getElementById('selbar').style.display === 'none')
  assert('多选态 Esc → 退出多选（selbar 隐藏）', selModeOff)

  await browser.close()
  console.log(failed === 0 ? '\n全部通过' : '\n失败 ' + failed + ' 项')
  process.exit(failed === 0 ? 0 : 1)
})().catch(e => { console.error('SIM ERROR:', e); process.exit(1) })
