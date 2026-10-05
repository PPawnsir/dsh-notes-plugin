'use strict'
/* 0.4.3② 用例⑩：搜索过滤（本地即时过滤 + 防抖远搜并集）。 */
module.exports = {
  name: '⑩ 搜索过滤：命中保留、未命中隐藏、清空还原',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '10-search-filter', async () => {
        const rowCnt = t => page.evaluate(kw => {
          var n = 0
          document.querySelectorAll('#tree .note-row .ti').forEach(function (el) { if (el.textContent.indexOf(kw) >= 0) n++ })
          return n
        }, t)
        /* 精确行计数：.ti 文本全等（防「定时 e2e 种子笔记 B」等前缀行串扰） */
        const exactCnt = kw => page.evaluate(k => {
          var n = 0
          document.querySelectorAll('#tree .note-row .ti').forEach(function (el) { if (el.textContent.trim() === k) n++ })
          return n
        }, kw)
        const c0 = await exactCnt('e2e 种子笔记 A')
        H.t('初始态种子 A 可见（精确行）', c0 === 1, () => '实际 ' + c0 + ' 行')
        /* 用正文关键词搜索（仅 A 正文含「种子正文 A」，跨用例共享态下无串扰）。
           注意：过滤激活时命中行会在「主题」聚合区重复渲染（设计行为），断言 = A 出现、B 消失 */
        await page.fill('#q', '种子正文 A')
        await H.waitFor(page, '搜索「种子正文 A」后 A 可见、B 隐藏', async () =>
          (await exactCnt('e2e 种子笔记 A')) >= 1 && (await exactCnt('e2e 种子笔记 B')) === 0)
        H.t('命中 A 保留（主题聚合区可重复渲染）、未命中 B 隐藏', true)
        /* 搜索态下文件夹组计数切换/空态不误显：树整体仍有命中行 */
        H.t('搜索态树中仍有命中行（无空态文案）', (await page.evaluate(() => document.querySelector('#tree').textContent.indexOf('无匹配') < 0)))
        await page.fill('#q', '')
        await H.waitFor(page, '清空搜索后种子 A 恢复', async () => (await exactCnt('e2e 种子笔记 A')) >= 1)
        H.t('清空搜索还原列表', true)
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '10-search-filter')
      })
    } finally { await page.context().close() }
  },
}
