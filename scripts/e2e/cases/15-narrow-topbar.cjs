'use strict'
/* 0.4.3② 用例⑮：401px 窄宽度顶栏不换行（≤480px 断点 .ico-only 收文字只留图标）。
 * viewport 断言：顶栏单行（所有 .tbtn 同一 top）、无横向溢出。 */
module.exports = {
  name: '⑮ 401px 窄宽度顶栏不换行',
  async run({ base, browser, H }) {
    const ctx = await browser.newContext({ viewport: { width: 401, height: 800 } })
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + (e && e.message || e)))
    try {
      await H.step(page, '15-narrow-topbar', async () => {
        await page.goto(base + '/', { waitUntil: 'load' })
        await page.waitForSelector('#tree', { timeout: 15000 })
        const m = await page.evaluate(() => {
          var bar = document.querySelector('.topbar')
          var btns = Array.prototype.slice.call(document.querySelectorAll('.topbar .tbtn'))
          var tops = btns.map(function (b) { return Math.round(b.getBoundingClientRect().top) })
          return {
            barH: Math.round(bar.getBoundingClientRect().height),
            wrap: bar.getBoundingClientRect().height > 60,
            topSet: Array.from(new Set(tops)),
            overflowX: document.documentElement.scrollWidth > 402,
            btnN: btns.length,
          }
        })
        H.t('顶栏 4 个按钮全渲染（窄断点只收文字不删按钮）', m.btnN === 4, () => '实际 ' + m.btnN + ' 个')
        H.t('顶栏高度 ≤60px（未换行堆叠）', !m.wrap, () => '顶栏高度 ' + m.barH + 'px')
        H.t('所有按钮同一行（top 最大差 ≤2px，基线渲染容差）', Math.max(...m.topSet) - Math.min(...m.topSet) <= 2, () => 'top 集合：' + JSON.stringify(m.topSet))
        H.t('无横向溢出（scrollWidth ≤ 视口宽）', m.overflowX === false)
        H.t('无 console error / pageerror', consoleErrors.length === 0, () => consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '15-narrow-topbar')
      })
    } finally { await ctx.close() }
  },
}
