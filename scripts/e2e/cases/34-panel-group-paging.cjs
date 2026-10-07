'use strict'
/* 0.4.7-D1 用例㉞：分组分页组尾翻页真机锁（0.4.6-J notes-046-group-paging 的 e2e 真机版，J 卡 eval 探针的上位锁）。
 * 机制面：PAGE_SIZE=50，组尾「加载更多（还有 N 条）」按钮行点击 → 该组显示数 += 50（组间独立）。
 * 真机锁点：按钮行真实点击走 React onClick → setGroupShown → 重渲染管线，eval 探针够不到的 DOM 序位全链。
 * 桩数据：120 条未入夹笔记（kind=note，无主题——主题区不渲染干扰行；updatedAt 严格递增保证排序确定：
 * 「分页笔记 120」最新……「分页笔记 001」最旧，首页 = 120..071）。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㉞ 面板分组分页：组尾「加载更多」真机点击翻页（50 → 100 → 120 全量）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {
      seed(state) {
        state.notes.length = 0
        for (let i = 1; i <= 120; i++) {
          const ts = new Date(Date.now() - (120 - i) * 1000).toISOString()   /* i 越大越新 */
          state.notes.push({
            id: 'pg-' + String(i).padStart(3, '0'), title: '分页笔记 ' + String(i).padStart(3, '0'), body: 'x',
            topic: '', kind: 'note', tags: [], status: 'active', pinned: false, inject: false, injectRole: '',
            injectTo: [], recall: true, folder: '', useCount: 0, contractType: '', createdAt: ts, updatedAt: ts, deleted: false,
          })
        }
      },
    })
    const rowCnt = () => h.page.evaluate(() => document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row').length)
    const moreTxt = () => h.page.evaluate(() => {
      const el = document.querySelector('.dsh-notes-tree .dsh-notes-more-row')
      return el ? el.textContent.trim() : ''
    })
    const hasTitle = (t) => h.page.evaluate(kw => {
      const el = document.querySelector('.dsh-notes-tree')
      return el ? el.textContent.indexOf(kw) >= 0 : false
    }, t)
    try {
      await H.step(h.page, '34-panel-group-paging', async () => {
        await h.openPanel()
        /* 首页：50 行 + 组尾加载行「还有 70 条」；071 可见、070 尚不可见（分页边界实证） */
        await H.waitFor(h.page, '首页 50 行 + 加载行『还有 70 条』', async () =>
          (await rowCnt()) === 50 && (await moreTxt()) === '加载更多（还有 70 条）')
        H.t('首页 = 50 行（PAGE_SIZE 组内 cap），组尾加载行 70 条余量', true)
        H.t('分页边界实证：071 在窗内、070 在窗外', (await hasTitle('分页笔记 071')) && !(await hasTitle('分页笔记 070')))

        /* 翻页一：点击组尾加载行 → 100 行 */
        await h.page.click('.dsh-notes-tree .dsh-notes-more-row')
        await H.waitFor(h.page, '翻页一后 100 行 + 『还有 20 条』', async () =>
          (await rowCnt()) === 100 && (await moreTxt()) === '加载更多（还有 20 条）')
        H.t('翻页一：100 行，余量收敛为 20 条', true)
        H.t('翻页一边界：021（第 100 位）进窗、001 仍在窗外', (await hasTitle('分页笔记 021')) && !(await hasTitle('分页笔记 001')))

        /* 翻页二：再点 → 120 全量，加载行消失 */
        await h.page.click('.dsh-notes-tree .dsh-notes-more-row')
        await H.waitFor(h.page, '翻页二后 120 全量、加载行消失', async () =>
          (await rowCnt()) === 120 && (await moreTxt()) === '')
        H.t('翻页二：120 全量，组尾加载行消失', true)
        H.t('翻页二边界：001（最旧）进窗', await hasTitle('分页笔记 001'))

        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '34-panel-group-paging')
      })
    } finally { await h.close() }
  },
}
