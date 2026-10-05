'use strict'
/* 0.4.3② 用例⑬：回收站软删 + 恢复。
 * 详情删除（软删，列表消失）→ 回收站出现该行 → 行内恢复 → 列表回归。 */
module.exports = {
  name: '⑬ 回收站软删 + 恢复',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '13-trash-restore', async () => {
        /* 用种子 A（case 08 拖入 e2e拖拽夹）做软删+恢复：共享态下 A 无其他派生行（B 已被 case 12 的「定时 」计划块引用） */
        const gone = () => page.evaluate(() => document.querySelector('#tree').textContent.indexOf('e2e 种子笔记 A') < 0)
        await page.click('#tree .note-row:has-text("e2e 种子笔记 A")')
        await page.waitForSelector('#mDel', { timeout: 8000 })
        await page.click('#mDel')
        await H.waitFor(page, '软删后列表不再显示 A', async () => (await gone()) === true)
        H.t('软删后树中 A 消失（软删入回收站）', true)
        /* 打开回收站 */
        await page.click('#btnTrash')
        await page.waitForSelector('#trashList .arch-row', { timeout: 8000 })
        const row = page.locator('#trashList .arch-row', { hasText: 'e2e 种子笔记 A' })
        H.t('回收站出现「e2e 种子笔记 A」行', (await row.count()) === 1)
        await row.locator('button[data-act="restore"]').click()
        await H.waitFor(page, '恢复后回收站行消失', async () => (await page.locator('#trashList .arch-row').count()) === 0)
        H.t('恢复后回收站清空', true)
        await page.click('#trashClose')
        await H.waitFor(page, '列表重新出现「e2e 种子笔记 A」', async p => p.evaluate(() => document.querySelector('#tree').textContent.indexOf('e2e 种子笔记 A') >= 0))
        H.t('恢复后树中 A 回归', true)
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '13-trash-restore')
      })
    } finally { await page.context().close() }
  },
}
