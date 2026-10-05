'use strict'
/* 0.4.3② 用例⑤：重命名文件夹（右键菜单 → 同款弹层回填 → 改名落库）。 */
module.exports = {
  name: '⑤ 重命名文件夹：右键菜单 + 弹层回填',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '05-rename-folder', async () => {
        await H.createFolderViaUI(page, 'e2e改名前')
        /* 右键文件夹行 → 上下文菜单 */
        const row = page.locator('#tree .row.head[data-fold]', { hasText: 'e2e改名前' }).first()
        await row.click({ button: 'right' })
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        H.t('右键弹出文件夹菜单（#ctxMenu 可见）', await page.isVisible('#ctxMenu'))
        await page.click('#ctxMenu .mi[data-a="rename"]')
        await page.waitForSelector('#fldName', { timeout: 8000 })
        const back = await page.inputValue('#fldName')
        H.t('重命名弹层回填原名', back === 'e2e改名前', () => '回填值：' + back)
        await page.fill('#fldName', 'e2e改名后')
        await page.keyboard.press('Enter')
        await H.waitFor(page, '树中旧名消失、新名出现', async p => p.evaluate(() => {
          var names = []
          document.querySelectorAll('#tree .row.head[data-fold] .nm').forEach(function (el) { names.push(el.textContent) })
          return names.indexOf('e2e改名后') >= 0 && names.indexOf('e2e改名前') < 0
        }))
        H.t('重命名后树仅出现新名「e2e改名后」', true)
        await H.screenshot(page, '05-rename-folder')
      })
    } finally { await page.context().close() }
  },
}
