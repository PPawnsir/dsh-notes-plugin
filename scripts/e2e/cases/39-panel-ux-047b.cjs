'use strict'
/* 0.4.7-B 用例㊲（notes-047-ux）client 面板真机锁（panel-harness 装载发布版 lib/client.js）：
 * ③ 组尾加载行键盘可达——role=button/tabIndex=0 + Enter/Space 真机触发翻页（0.4.6-J verifier 残留收口）；
 * ②b meta 行动区溢出菜单面板同款（带 sessionId 笔记 → 6 动作 → 「…」菜单出「导出」，行为级点击）；
 * ④a 三态旁 ⓘ（role/tabIndex/data-tooltip 合成同文）。
 * 桩数据：120 条未入夹笔记（同用例㉞口径）+ 1 条带来源会话笔记。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊲ 面板 0.4.7-B：组尾加载行键盘触发 + meta 溢出菜单 + 三态 ⓘ',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {
      seed(state) {
        state.notes.length = 0
        for (let i = 1; i <= 120; i++) {
          const ts = new Date(Date.now() - (120 - i) * 1000).toISOString()
          state.notes.push({
            id: 'pg-' + String(i).padStart(3, '0'), title: '分页笔记 ' + String(i).padStart(3, '0'), body: 'x',
            topic: '', kind: 'note', tags: [], status: 'active', pinned: false, inject: false, injectRole: '',
            injectTo: [], recall: true, folder: '', useCount: 0, contractType: '', createdAt: ts, updatedAt: ts, deleted: false,
          })
        }
        /* ②b 演习面：带来源会话 → meta 行动区 6 动作（整理/派发/来源/导出/置顶/删除）超封板阈值 */
        state.notes.unshift({
          id: 'pg-src-0', title: '带来源笔记', body: '溢出菜单演习正文',
          topic: '', kind: 'note', tags: [], status: 'active', pinned: false, inject: false, injectRole: '',
          injectTo: [], recall: true, folder: '', useCount: 0, contractType: '', sessionId: 'sess-e2e-0001',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false,
        })
      },
    })
    try {
      await H.step(h.page, '37-panel-ux-047b', async () => {
        await h.openPanel()
        /* ===== ③ 组尾加载行键盘可达 ===== */
        await H.waitFor(h.page, '首页 50 行 + 加载行在案', async () =>
          h.page.evaluate(() => document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row').length === 50 && !!document.querySelector('.dsh-notes-more-row')))
        H.t('③ 加载行 role=button + tabIndex=0 + aria-label', await h.page.evaluate(() => {
          const el = document.querySelector('.dsh-notes-more-row')
          return el.getAttribute('role') === 'button' && el.tabIndex === 0 && (el.getAttribute('aria-label') || '').indexOf('加载更多') >= 0
        }))
        /* Enter 触发翻页一 */
        await h.page.evaluate(() => document.querySelector('.dsh-notes-more-row').focus())
        await h.page.keyboard.press('Enter')
        await H.waitFor(h.page, 'Enter 翻页一 → 100 行', async () =>
          h.page.evaluate(() => document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row').length === 100))
        H.t('③ Enter 键触发翻页（50 → 100，行为级）', true)
        /* Space 触发翻页二（翻页后 React 换代 more-row 节点 → 重新聚焦再按键；翻页二后全量 121 = 120 分页笔记 + 1 带来源笔记同组） */
        await h.page.evaluate(() => document.querySelector('.dsh-notes-more-row').focus())
        H.t('③ Space 前加载行持焦（换代后重新聚焦成功）', await h.page.evaluate(() =>
          !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('dsh-notes-more-row'))))
        await h.page.keyboard.press(' ')
        await H.waitFor(h.page, 'Space 翻页二 → 121 全量、加载行消失', async () =>
          h.page.evaluate(() => document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row').length === 121 && !document.querySelector('.dsh-notes-more-row')))
        H.t('③ Space 键触发翻页（100 → 121 全量）', true)

        /* ===== ②b 面板 meta 溢出菜单 ===== */
        await h.page.evaluate(() => {
          const rows = document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row')
          for (const r of rows) if (r.textContent.indexOf('带来源笔记') >= 0) { r.click(); return }
        })
        await H.waitFor(h.page, '编辑器打开带来源笔记（6 动作 → 溢出钮出现）', async () =>
          h.page.evaluate(() => !!document.querySelector('.dsh-notes-meta-more')))
        H.t('②b 面板 6 动作触发封板：「…」溢出钮出现', true)
        H.t('②b 面板 pin/del 仍直出不入菜单', await h.page.evaluate(() => {
          const menu = document.querySelector('.dsh-notes-meta-more-menu')
          const meta = document.querySelector('.dsh-notes-ed-meta')
          const acts = meta ? meta.querySelectorAll(':scope > .dsh-notes-meta-act') : []
          const tips = Array.from(acts).map(a => (a.getAttribute('data-tooltip') || '')).join('|')
          return tips.indexOf('置顶') >= 0 && tips.indexOf('删除') >= 0 && !(menu && (menu.textContent || '').indexOf('置顶') >= 0)
        }))
        await h.page.click('.dsh-notes-meta-more')
        await H.waitFor(h.page, '溢出菜单展开含「导出」', async () =>
          h.page.evaluate(() => { const m = document.querySelector('.dsh-notes-meta-more-menu'); return !!m && m.textContent.indexOf('导出') >= 0 }))
        /* 菜单「导出」点击 → toast + 点菜收拢（包装 span onClickCapture 收拢：act 的 stopPropagation 只挡冒泡相） */
        await h.page.click('.dsh-notes-meta-more-menu .dsh-notes-meta-act:has-text("导出")')
        await H.waitFor(h.page, '菜单「导出」点击 → toast 已导出（行为级可用 + 点菜收拢）', async () =>
          h.page.evaluate(() => {
            const t = document.querySelector('.dsh-notes-toast')
            return t && t.textContent.indexOf('已导出') >= 0 && !document.querySelector('.dsh-notes-meta-more-menu')
          }))
        H.t('②b 面板溢出菜单动作可用 + 点菜收拢', true)

        /* ===== ④a 面板三态 ⓘ ===== */
        H.t('④a 面板三态旁 ⓘ 可见且可聚焦（role/tabIndex + 合成 tooltip 三档同文）', await h.page.evaluate(() => {
          const el = document.querySelector('.dsh-notes-role-info')
          return !!el && el.getAttribute('role') === 'button' && el.tabIndex === 0
            && (el.getAttribute('data-tooltip') || '').indexOf('关闭 = 不注入系统提示') >= 0
            && (el.getAttribute('data-tooltip') || '').indexOf('资料 = ') >= 0
        }))

        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '37-panel-ux-047b')
      })
    } finally { await h.close() }
  },
}
