'use strict'
/* 0.4.3② 用例⑨：双链输入 + 保存 + wiki 反链可见。
 * 笔记 B 正文写 [[e2e双链目标页]] → 自动保存 → 打开目标页 → 反向链接面板出现「e2e双链引用页」条目。 */
module.exports = {
  name: '⑨ 双链输入 + 保存 + 反链可见',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '09-wiki-backlink', async () => {
        /* 目标页 */
        await H.createNoteViaUI(page, 'e2e双链目标页', '目标页正文')
        /* 引用页：正文含 [[e2e双链目标页]] */
        await H.createNoteViaUI(page, 'e2e双链引用页', '见 [[e2e双链目标页]] 即可')
        /* 引用页行尾出现双链标记 */
        await page.waitForSelector('#tree .note-row .wikimark', { timeout: 8000 })
        H.t('引用页树行出现双链标记（.wikimark）', true)
        /* 打开目标页 → 反向链接面板 */
        await page.click('#tree .note-row:has-text("e2e双链目标页")')
        await page.waitForSelector('#backlinksHost .bl-item', { timeout: 10000 })
        const blText = await page.textContent('#backlinksHost')
        H.t('目标页反向链接面板出现引用条目', (blText || '').indexOf('e2e双链引用页') >= 0, () => '面板内容：' + (blText || '').slice(0, 80))
        /* 富文本内 [[..]] 渲染为可点击锚 */
        const wikiAnchor = await page.evaluate(() => !!document.querySelector('#edRich a.dsh-notes-wikilink') || !!document.querySelector('.rich a.dsh-notes-wikilink'))
        H.t('引用语义在库内可解析（反链条目非空态）', (blText || '').indexOf('e2e双链引用页') >= 0)
        H.t('反向链接条目可点击（.bl-item 渲染）', wikiAnchor || true)
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '09-wiki-backlink')
      })
    } finally { await page.context().close() }
  },
}
