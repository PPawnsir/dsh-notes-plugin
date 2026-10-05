'use strict'
/* 样板路径②：新建笔记 → 输入标题 → 保存 → 列表出现。
 * 浏览器级对应 check「创建返回 id / 列表瘦身」链路：点 + 新建（草稿态）→ 首次输入落库（notes-create）
 * → 自动保存 flush → 列表刷新出现该标题。 */
const TITLE = 'e2e 样板笔记 ' + Date.now()
module.exports = {
  name: '② 新建笔记→输入标题→保存→列表出现',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await page.click('#btnNew')
      await page.waitForSelector('#edTitle', { timeout: 8000 })
      H.t('点 + 后进入草稿态（标题编辑器可见）', await page.isVisible('#edTitle'))
      await page.click('#edTitle')
      await page.keyboard.type(TITLE)
      // 首次输入触发 notes-create 落库；自动保存 flush + 列表刷新后树中应出现该标题行
      await H.waitFor(page, '列表出现新笔记标题「' + TITLE + '」', async p =>
        p.evaluate(t => document.querySelector('#tree').textContent.indexOf(t) >= 0, TITLE))
      H.t('新建笔记后列表出现该标题', true)
      // 编辑器内标题回显一致
      H.t('编辑器标题回显一致', (await page.evaluate(() => document.getElementById('edTitle').textContent.trim())) === TITLE)
      await H.screenshot(page, '02-create-note.png')
    } finally { await page.context().close() }
  },
}
