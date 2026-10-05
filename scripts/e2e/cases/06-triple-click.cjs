'use strict'
/* 0.4.3② 用例⑥：树行点击展开/折叠三连击稳定（经典树语义：行单击 = 纯展开/折叠）。
 * 快速三连击后：caret 态三连翻（开→合→开→合 缺省开），行不丢、无 console error。 */
module.exports = {
  name: '⑥ 文件夹行三连击展开/折叠稳定',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '06-triple-click', async () => {
        await H.createFolderViaUI(page, 'e2e连击夹')
        const caretState = () => page.evaluate(() => {
          var rows = document.querySelectorAll('#tree .row.head[data-fold]')
          for (var i = 0; i < rows.length; i++) {
            var nm = rows[i].querySelector('.nm')
            if (nm && nm.textContent === 'e2e连击夹') {
              var c = rows[i].querySelector('.caret')
              return c && c.classList.contains('open') ? 'open' : 'closed'
            }
          }
          return 'missing'
        })
        /* 缺省展开（foldOpen[fid] !== false） */
        const st0 = await caretState()
        H.t('文件夹创建后缺省展开（caret open）', st0 === 'open', () => '实际：' + st0)
        /* 三连击：间隔 60ms 模拟快点（行点击 = 纯 toggle；点 caret 与行主体同一路径） */
        const row = page.locator('#tree .row.head[data-fold]', { hasText: 'e2e连击夹' }).first()
        for (let i = 0; i < 3; i++) {
          await row.locator('.caret').click()
          await page.waitForTimeout(60)
        }
        H.t('三连击后行仍存在（不丢行）', (await caretState()) !== 'missing')
        const st3 = await caretState()
        H.t('三连击后 caret 为折叠态（开→合→开→合，奇数次点击）', st3 === 'closed', () => '实际：' + st3)
        await row.locator('.caret').click()
        const st4 = await caretState()
        H.t('再点一次回到展开态（折叠可逆）', st4 === 'open', () => '实际：' + st4)
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '06-triple-click')
      })
    } finally { await page.context().close() }
  },
}
