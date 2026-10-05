'use strict'
/* 0.4.3② 用例⑦：展开「工作日志」夹 → 日志子条目定向召回（notes-041c）。
 * 缺省日志隐身（树上无 log 行）→ 展开动作触发 includeLogs 懒加载 → 子条目 + log 徽章出现；
 * 折叠再展开不重复（foldLogLoaded 去重，同名条目仍 1 条）。 */
module.exports = {
  name: '⑦ 展开工作日志夹 → 日志子条目出现（懒加载去重）',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '07-log-children', async () => {
        const logVisible = () => page.evaluate(() => document.querySelector('#tree').textContent.indexOf('e2e 日志条目') >= 0)
        H.t('初始态日志隐身（树上无日志条目）', (await logVisible()) === false)
        const row = page.locator('#tree .row.head[data-fold]', { hasText: '工作日志' }).first()
        /* 缺省展开：先折叠（无动作）再展开（展开动作 = 唯一懒加载触发点，notes-041c R-6） */
        await row.click()
        H.t('折叠后日志条目隐藏（缺省展开态下先收起）', (await logVisible()) === false)
        await row.click()
        await page.waitForSelector('#tree .nested .note-row .logmark', { timeout: 8000 })
        H.t('展开后日志子条目出现（含 log 徽章）', true)
        const inNested = await page.evaluate(() => {
          var rows = document.querySelectorAll('#tree .nested .note-row')
          for (var i = 0; i < rows.length; i++) if (rows[i].textContent.indexOf('e2e 日志条目') >= 0) return true
          return false
        })
        H.t('日志条目渲染在该夹 .nested 子容器内', inNested)
        /* 折叠再展开：不重复 */
        await row.click()
        H.t('折叠后日志条目隐藏', (await logVisible()) === false)
        await row.click()
        await page.waitForSelector('#tree .nested .note-row .logmark', { timeout: 8000 })
        const cnt = await page.evaluate(() => {
          var n = 0
          document.querySelectorAll('#tree .note-row').forEach(function (r) { if (r.textContent.indexOf('e2e 日志条目') >= 0) n++ })
          return n
        })
        H.t('折叠再展开后日志条目仍 1 条（懒加载去重）', cnt === 1, () => '实际 ' + cnt + ' 条')
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '07-log-children')
      })
    } finally { await page.context().close() }
  },
}
