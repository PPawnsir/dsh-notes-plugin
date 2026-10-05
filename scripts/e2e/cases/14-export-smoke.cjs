'use strict'
/* 0.4.3② 用例⑭：导出冒烟（设置卡 → 导出全部 → RPC 发出 + 成功 toast 带条数）。
 * 注：导出落盘在 host 侧（notes-export RPC），mock 环境无浏览器下载事件——
 * 冒烟口径 = 请求真实发出（fetch 到 /dsh-notes notes-export）+ 成功 toast「已导出 N 条」。 */
module.exports = {
  name: '⑭ 导出冒烟：RPC 发出 + 成功 toast',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '14-export-smoke', async () => {
        let exportCalled = false
        page.on('request', req => {
          if (req.method() === 'POST' && req.url().indexOf('/dsh-notes') >= 0 && (req.postData() || '').indexOf('notes-export') >= 0) exportCalled = true
        })
        await page.click('#btnSettings')
        await page.waitForSelector('#setExport', { timeout: 8000 })
        await page.click('#setExport')
        await page.waitForSelector('#expDir', { timeout: 8000 })
        H.t('导出弹层出现（#expDir 输入框可见）', await page.isVisible('#expDir'))
        await page.fill('#expDir', 'D:/deepseek-work/_scratch/e2e-export-smoke')
        await page.click('#eOk')
        await H.waitFor(page, '导出成功 toast（已导出 N 条）', async p =>
          p.evaluate(() => {
            var t = document.getElementById('toast')
            return !!(t && t.classList.contains('show') && t.textContent.indexOf('已导出') >= 0)
          }))
        const toastTxt = await page.textContent('#toast')
        H.t('toast 报出导出条数（种子 3 条口径 ≥1）', /[1-9]/.test(toastTxt || ''), () => 'toast：' + toastTxt)
        H.t('notes-export RPC 真实发出', exportCalled)
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '14-export-smoke')
      })
    } finally { await page.context().close() }
  },
}
