'use strict'
/* 样板路径①：加载 app.html 无 console error / pageerror。
 * 对应 check.js「app 可复现/静态包」断言的浏览器级验证：真实渲染 + RPC 链路（mock host）零报错。 */
module.exports = {
  name: '① 加载 app.html 无 console error',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      H.t('页面加载出现 #tree（侧栏列表容器已渲染）', true)
      H.t('侧栏有「全部笔记」视图标题', await page.evaluate(() => document.body.textContent.indexOf('全部笔记') >= 0), () => '未找到视图标题')
      H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
      await H.screenshot(page, '01-load.png')
    } finally { await page.context().close() }
  },
}
