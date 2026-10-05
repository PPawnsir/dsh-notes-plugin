'use strict'
/* 0.4.3② 用例⑧：根目录笔记拖拽进文件夹（notes-041d 修复回归：Playwright dragTo，真实 HTML5 DnD 链路）。 */
module.exports = {
  name: '⑧ 根目录笔记拖拽进文件夹',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '08-drag-to-folder', async () => {
        await H.createFolderViaUI(page, 'e2e拖拽夹')
        /* 建夹后自动切到该夹视图（仅见夹内笔记）——清视图回「全部」再做根级拖拽 */
        await page.click('#viewClear')
        await H.waitFor(page, '回到全部视图（根级笔记行可见）', async p =>
          p.evaluate(() => document.querySelector('#tree').textContent.indexOf('e2e 种子笔记 A') >= 0))
        const src = page.locator('#tree .note-row', { hasText: 'e2e 种子笔记 A' }).first()
        const dst = page.locator('#tree .row.head[data-fold]', { hasText: 'e2e拖拽夹' }).first()
        H.t('拖拽源：根级「e2e 种子笔记 A」行存在', (await src.count()) === 1)
        H.t('拖拽落点：「e2e拖拽夹」文件夹行存在', (await dst.count()) === 1)
        await src.dragTo(dst)
        /* 落库（notes-update folder）+ 列表刷新后：该笔记渲染在夹的 .nested 内，根级未入夹区不再有它 */
        await H.waitFor(page, '「e2e 种子笔记 A」进入 e2e拖拽夹 的 .nested 子容器', async p => p.evaluate(() => {
          var rows = document.querySelectorAll('#tree .nested .note-row')
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf('e2e 种子笔记 A') >= 0) {
              var head = rows[i].closest('.nested').previousElementSibling
              return !!(head && head.classList.contains('head') && head.textContent.indexOf('e2e拖拽夹') >= 0)
            }
          }
          return false
        }))
        H.t('拖拽后笔记进入目标文件夹子容器', true)
        const stillUnfiled = await page.evaluate(() => {
          var rows = document.querySelectorAll('#tree .unfiled-drop .note-row')
          for (var i = 0; i < rows.length; i++) if (rows[i].textContent.indexOf('e2e 种子笔记 A') >= 0) return true
          return false
        })
        H.t('根级未入夹区不再显示该笔记', stillUnfiled === false)
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '08-drag-to-folder')
      })
    } finally { await page.context().close() }
  },
}
