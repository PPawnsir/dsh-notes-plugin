'use strict'
/* 0.4.8 用例㊻（notes-048-settings-groups）client 面板设置弹窗分组导航真机锁（panel-harness 装载发布版 lib/client.js）：
 * ① 非空 5 组 rail（图标+组名，冻结序）+ 5 组壳 + 17 节全覆盖（空组隐身）；
 * ② rail 点击定位（滚动容器 = .dsh-notes-settings-modal，48px 吸顶补偿）+ on + aria-current；
 * ③ 滚动反高亮（滚顶=常规 / 滚底=关于）；
 * ④ 窄宽 500px 退化 chips 横条 + chip 点击定位同款。
 * 隔离纪律：纯 UI 演习零写盘，finally 关 context。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊻ 面板 0.4.8 设置分组导航：rail/点击定位/滚动反高亮/窄宽 chips（client）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {})
    try {
      await H.step(h.page, '46-panel-settings-groups', async () => {
        await h.openPanel()
        await h.page.click('.dsh-notes-fbtn:has-text("设置")')
        await h.page.waitForSelector('.dsh-notes-settings-rail-item', { timeout: 8000 })

        /* ===== ① 七组渲染齐 ===== */
        const nav = await h.page.evaluate(() => {
          var rail = Array.prototype.slice.call(document.querySelectorAll('.dsh-notes-settings-rail-item'))
          return {
            railTexts: rail.map(function (b) { return b.textContent.trim() }),
            railGs: rail.map(function (b) { return b.getAttribute('data-g') }),
            railIcons: rail.map(function (b) { return !!b.querySelector('svg') }),
            groupGs: Array.prototype.slice.call(document.querySelectorAll('.dsh-notes-settings-group')).map(function (g) { return g.getAttribute('data-g') }),
            rows: document.querySelectorAll('.dsh-notes-settings-list .dsh-notes-settings-row').length,
            chipsShown: getComputedStyle(document.querySelector('.dsh-notes-settings-chips')).display,
            navRole: document.querySelector('.dsh-notes-settings-rail').getAttribute('role'),
            navAria: document.querySelector('.dsh-notes-settings-rail').getAttribute('aria-label'),
          }
        })
        H.t('① 面板 rail 5 项（图标+组名，冻结序）+ 导航语义（role/aria-label）',
          nav.railTexts.join('|') === '常规|检索与注入|AI|数据与存储|关于' && nav.railIcons.every(Boolean) && nav.navRole === 'navigation' && nav.navAria === '设置分组',
          () => JSON.stringify(nav.railTexts) + ' · ' + nav.navRole + '/' + nav.navAria)
        H.t('① 组壳同序 + 空组隐身 + 17 节全覆盖',
          nav.railGs.join() === 'general,inject,ai,data,about' && nav.groupGs.join() === 'general,inject,ai,data,about' && nav.rows === 17,
          () => nav.groupGs.join() + ' · 行数 ' + nav.rows)
        H.t('① 宽屏 chips 隐身', nav.chipsShown === 'none')

        /* ===== ② rail 点击定位（末组「关于」：触底滚足 + 组壳入视口 + on + aria-current；48px 吸顶补偿见 app ㊺②b 非末组精确上顶） ===== */
        await h.page.click('.dsh-notes-settings-rail-item[data-g="about"]')
        await H.waitFor(h.page, '关于组定位 + on + aria-current', async () => h.page.evaluate(() => {
          var modal = document.querySelector('.dsh-notes-settings-modal')
          var g = modal.querySelector('.dsh-notes-settings-group[data-g="about"]')
          var d = g.getBoundingClientRect().top - modal.getBoundingClientRect().top
          var item = modal.querySelector('.dsh-notes-settings-rail-item[data-g="about"]')
          return modal.scrollTop > 0 && d >= 40 && d < modal.clientHeight - 20
            && modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 2
            && item.classList.contains('on') && item.getAttribute('aria-current') === 'true'
        }))
        H.t('② rail 点击定位末组（触底滚足 + 组壳入视口）+ 当前组 on + aria-current', true)

        /* ===== ③ 滚动反高亮 ===== */
        await h.page.evaluate(() => { document.querySelector('.dsh-notes-settings-modal').scrollTop = 0 })
        await H.waitFor(h.page, '滚顶 → 常规 on', async () => h.page.evaluate(() =>
          document.querySelector('.dsh-notes-settings-rail-item[data-g="general"]').classList.contains('on')))
        H.t('③ 滚动反高亮：滚顶 → 当前组=常规', true)
        await h.page.evaluate(() => { var m = document.querySelector('.dsh-notes-settings-modal'); m.scrollTop = m.scrollHeight })
        await H.waitFor(h.page, '滚底 → 关于 on', async () => h.page.evaluate(() =>
          document.querySelector('.dsh-notes-settings-rail-item[data-g="about"]').classList.contains('on')))
        H.t('③ 滚动反高亮：滚底 → 当前组=关于', true)

        /* ===== ④ 窄宽退化 chips ===== */
        await h.page.setViewportSize({ width: 500, height: 800 })
        await H.waitFor(h.page, '窄宽退化：rail 隐 + chips 显', async () => h.page.evaluate(() =>
          getComputedStyle(document.querySelector('.dsh-notes-settings-rail')).display === 'none'
          && getComputedStyle(document.querySelector('.dsh-notes-settings-chips')).display === 'flex'))
        H.t('④ <560px 窄宽退化：rail 隐 + chips 显', true)
        await h.page.click('.dsh-notes-settings-chip[data-g="inject"]')
        await H.waitFor(h.page, 'chip 点击定位 检索与注入 + on', async () => h.page.evaluate(() => {
          var modal = document.querySelector('.dsh-notes-settings-modal')
          var g = modal.querySelector('.dsh-notes-settings-group[data-g="inject"]')
          var d = g.getBoundingClientRect().top - modal.getBoundingClientRect().top
          return d >= 40 && d <= 70 && modal.querySelector('.dsh-notes-settings-chip[data-g="inject"]').classList.contains('on')
        }))
        H.t('④ chips 点击定位 + 当前 chip on（窄宽同款行为）', true)
        await H.screenshot(h.page, '46-panel-settings-groups')
      })
    } finally {
      await h.close()
    }
  },
}
