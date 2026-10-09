'use strict'
/* 0.5.0 交互层 用例㊴（notes-050-search-excerpt）：搜索结果摘要行 + 命中高亮（app.html 真机路径，mock host 下发 excerpt）。
 * ① 正文命中：搜索「种子正文 A」→ 行标题下出现摘要行（.ex），mark 数=1 且 mark 文本=命中词（host ±50 窗口 + 区间数组）；
 * ② 仅标题命中：搜索「种子笔记」（正文不含）→ 摘要行=正文开头补足，零 mark；
 * ③ 清空搜索 → 摘要行即撤（searchEx 输入即清口径）；
 * 隔离纪律：共享种子数据只读；finally 关 page context。 */
module.exports = {
  name: '㊴ 搜索摘要行：正文命中区间高亮 + 标题命中补足 + 清空即撤',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '59-search-excerpt', async () => {
        /* 行摘要采集：命中行（按标题锚定种子 A）→ { hasEx, text, marks, markText } 数组（主题聚合区可能重复渲染同行，逐行核） */
        const excerptInfo = kw => page.evaluate(t => {
          var rows = Array.from(document.querySelectorAll('#tree .note-row'))
          var hit = rows.filter(r => r.querySelector('.ti') && r.querySelector('.ti').textContent.indexOf(t) >= 0)
          return hit.map(r => {
            var ex = r.querySelector('.ex')
            var mk = ex ? ex.querySelector('mark') : null
            return { hasEx: !!ex, text: ex ? ex.textContent : '', marks: ex ? ex.querySelectorAll('mark').length : -1, markText: mk ? mk.textContent : '' }
          })
        }, kw)

        /* ===== ① 正文命中：摘要行 + 区间高亮 ===== */
        await page.fill('#q', '种子正文 A')
        await H.waitFor(page, '正文命中检索落定：种子 A 行出现摘要行', async () => {
          const info = await excerptInfo('e2e 种子笔记 A')
          return info.length >= 1 && info.every(x => x.hasEx)
        })
        const info1 = await excerptInfo('e2e 种子笔记 A')
        H.t('① 正文命中 → 摘要行渲染 + mark 数=1 + mark 文本=命中词',
          info1.every(x => x.marks === 1 && x.markText === '种子正文 A' && x.text.indexOf('种子正文 A') >= 0),
          () => JSON.stringify(info1))
        H.t('① 摘要行挂 .has-ex 行（flex-wrap 换行标记）', await page.evaluate(() =>
          document.querySelectorAll('#tree .note-row.has-ex .ex').length >= 1))
        await H.screenshot(page, '59-search-excerpt-hit')   /* 命中高亮视觉证据（摘要行 + mark 黄底） */

        /* ===== ② 仅标题命中：正文开头补足 + 零 mark ===== */
        await page.fill('#q', '种子笔记')
        await H.waitFor(page, '标题命中检索落定：摘要行切换为正文开头补足', async () => {
          const info = await excerptInfo('e2e 种子笔记 A')
          return info.length >= 1 && info.every(x => x.hasEx && x.text.indexOf('种子正文 A') === 0)
        })
        const info2 = await excerptInfo('e2e 种子笔记 A')
        H.t('② 仅标题命中 → 摘要=正文开头 + marks=0（无高亮区间）',
          info2.every(x => x.marks === 0 && x.text.indexOf('种子正文 A') === 0), () => JSON.stringify(info2))

        /* ===== ③ 清空搜索 → 摘要行即撤 ===== */
        await page.fill('#q', '')
        await H.waitFor(page, '清空搜索后摘要行清零', async () =>
          (await page.evaluate(() => document.querySelectorAll('#tree .note-row .ex').length)) === 0)
        H.t('③ 清空搜索 → 摘要行即撤（旧摘录不残留）', true)
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '59-search-excerpt')
      })
    } finally { await page.context().close() }
  },
}
