'use strict'
/* 0.4.8 用例㊿+1（notes-048-injmgr-narrow-overflow）client 面板侧同款边界锁（panel-harness 装载发布版 lib/client.js + lib/styles.css 真机口径）：
 * 与用例㊿同口径——过滤栏 chips + 批量条窄宽纪律（.dsh-notes-injmgr-bar/.dsh-notes-injmgr-chips/.dsh-notes-injmgr-batch 三规则 flex-wrap
 *   + chips shrink:1/min-width:0）+ getBoundingClientRect 边界 + 三区无横向滚动；
 * zh/en × 1440/400 矩阵（面板注入管理弹窗实为 440px 内容宽——.dsh-notes-data-modal 后定义覆盖 injmgr 640，窄面天生更挤，必锁；
 *   en@1440 下批量条 505px 自然宽 > 408px 内容宽，折行是合规行为——宽屏单行回归锁只压 chips 与 zh 批量条）。
 * 面板语言切换走标题栏语言钮真机路径（modal 遮罩下不可点 → 先关两层弹窗再切）；注入管理行定位用组壳+序位（inject 组第 4 行，跨语言稳定）。
 * 隔离纪律：仅写 localStorage 语言偏好（业务零写盘），finally 关 context。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊿+1 面板 0.4.8 注入管理 chips+批量条窄宽不溢出（client：zh/en × 1440/400 边界断言）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {})
    try {
      await H.step(h.page, '51-panel-injmgr-overflow', async () => {
        /* 开注入管理（设置 → inject 组第 4 行「注入管理」→ 管理…钮；组壳+序位定位，跨语言稳定） */
        const openMgr = async (settingsBtnText) => {
          /* 面板已开则直进（hdr-btn 是开合切换钮，重复点会关板——用例㊼同款教训） */
          if (!(await h.page.$('.dsh-notes-floating'))) await h.openPanel()
          await h.page.click('.dsh-notes-fbtn:has-text("' + settingsBtnText + '")')
          await h.page.waitForSelector('.dsh-notes-settings-group[data-g="inject"] .dsh-notes-settings-row', { timeout: 8000 })
          await h.page.locator('.dsh-notes-settings-group[data-g="inject"] .dsh-notes-settings-row').nth(3).locator('.dsh-notes-settings-control button').click()
          await h.page.waitForSelector('.dsh-notes-injmgr-modal .dsh-notes-injmgr-chips .dsh-notes-injmgr-chip', { timeout: 8000 })
          await h.page.waitForSelector('.dsh-notes-injmgr-modal .dsh-notes-injmgr-batch .dsh-notes-trash-act', { timeout: 8000 })
        }
        const measure = () => h.page.evaluate(() => {
          var R = {}
          var modal = document.querySelector('.dsh-notes-injmgr-modal')
          if (!modal) return R
          var mr = modal.getBoundingClientRect()
          var padR = parseFloat(getComputedStyle(modal).paddingRight) || 0
          R.contentR = mr.right - padR
          R.modalNoX = modal.scrollWidth <= modal.clientWidth + 1
          var bar = modal.querySelector('.dsh-notes-injmgr-bar')
          var chips = modal.querySelector('.dsh-notes-injmgr-chips')
          var chipList = chips ? chips.querySelectorAll('.dsh-notes-injmgr-chip') : []
          var chipLast = chipList.length ? chipList[chipList.length - 1] : null
          var search = modal.querySelector('.dsh-notes-injmgr-search')
          var batch = modal.querySelector('.dsh-notes-injmgr-batch')
          var btns = batch ? batch.querySelectorAll('.dsh-notes-trash-act') : []
          var btnLast = btns.length ? btns[btns.length - 1] : null
          var grab = function (key, el) {
            if (!el) { R[key] = null; return }
            var r = el.getBoundingClientRect()
            R[key] = { inR: r.right <= R.contentR + 0.6, inL: r.left >= mr.left - 0.6, h: Math.round(r.height * 10) / 10, overR: Math.round((r.right - R.contentR) * 10) / 10 }
          }
          grab('chipLast', chipLast)
          grab('search', search)
          grab('btnLast', btnLast)
          R.chipsH = chips ? Math.round(chips.getBoundingClientRect().height * 10) / 10 : null
          R.batchH = batch ? Math.round(batch.getBoundingClientRect().height * 10) / 10 : null
          R.barH = bar ? Math.round(bar.getBoundingClientRect().height * 10) / 10 : null
          R.barNoX = bar ? bar.scrollWidth <= bar.clientWidth + 1 : null
          R.batchNoX = batch ? batch.scrollWidth <= batch.clientWidth + 1 : null
          var cb = bar ? getComputedStyle(bar) : null, cc = chips ? getComputedStyle(chips) : null, ct = batch ? getComputedStyle(batch) : null
          R.wrap = { bar: cb && cb.flexWrap, chips: cc && cc.flexWrap, batch: ct && ct.flexWrap, chipsShrink: cc && cc.flexShrink, chipsMinW: cc && cc.minWidth }
          return R
        })
        const assertBounds = (m, tag) => {
          H.t(tag + '：chips 末枚 + 搜索框 + 批量条末钮收进 modal 内容界（getBoundingClientRect 右缘 ≤ 内容右缘）',
            !!(m.chipLast && m.search && m.btnLast && m.chipLast.inR && m.chipLast.inL && m.search.inR && m.btnLast.inR), () => JSON.stringify({ chipLast: m.chipLast, search: m.search, btnLast: m.btnLast }))
          H.t(tag + '：modal + 过滤栏 + 批量条均无横向滚动（scrollWidth ≤ clientWidth+1）',
            !!(m.modalNoX === true && m.barNoX === true && m.batchNoX === true), () => JSON.stringify({ modalNoX: m.modalNoX, barNoX: m.barNoX, batchNoX: m.batchNoX }))
        }

        /* ===== zh 矩阵 ===== */
        await openMgr('设置')
        const zhW = await measure()
        H.t('面板计算式纪律锁：过滤栏/chips/批量条三规则 flex-wrap:wrap + chips flex-shrink:1 + min-width:0px',
          !!zhW.wrap && zhW.wrap.bar === 'wrap' && zhW.wrap.chips === 'wrap' && zhW.wrap.batch === 'wrap' && zhW.wrap.chipsShrink === '1' && zhW.wrap.chipsMinW === '0px', () => JSON.stringify(zhW.wrap))
        H.t('面板 zh@1440 宽屏单行不回归：chips 单行（h≤26）+ 批量条单行（h≤28）',
          !!(zhW.chipsH && zhW.chipsH > 0 && zhW.chipsH <= 26 && zhW.batchH && zhW.batchH > 0 && zhW.batchH <= 28), () => JSON.stringify({ chipsH: zhW.chipsH, batchH: zhW.batchH }))
        assertBounds(zhW, '面板 zh@1440')
        await h.page.setViewportSize({ width: 400, height: 800 })
        await h.page.waitForTimeout(250)
        const zhN = await measure()
        assertBounds(zhN, '面板 zh@400')
        await H.screenshot(h.page, '51-panel-injmgr-overflow')

        /* ===== 关两层弹窗（回 1440 → 遮罩角点关注入管理 → ✕ 关设置卡）→ 标题栏语言钮切 en ===== */
        await h.page.setViewportSize({ width: 1440, height: 900 })
        await h.page.waitForTimeout(200)
        await h.page.mouse.click(5, 5)   /* 遮罩 mousedown 自闭（onMouseDown target===currentTarget） */
        await H.waitFor(h.page, '注入管理已关（回本设置卡）', async () => h.page.evaluate(() => !document.querySelector('.dsh-notes-injmgr-modal')))
        await h.page.click('.dsh-notes-settings-close')
        await H.waitFor(h.page, '设置卡已关', async () => h.page.evaluate(() => !document.querySelector('.dsh-notes-settings-modal')))
        await h.page.click('.dsh-notes-titlebar-actions .dsh-notes-titlebar-btn:has-text("中文")')
        await H.waitFor(h.page, '面板切英（语言钮文字 English）', async () => h.page.evaluate(() =>
          Array.prototype.slice.call(document.querySelectorAll('.dsh-notes-titlebar-actions .dsh-notes-titlebar-btn')).some(function (b) { return b.textContent.trim() === 'English' })))

        /* ===== en 矩阵 ===== */
        await openMgr('Settings')
        const enW = await measure()
        /* 面板弹窗内容宽 408（440-32）：en chips（≈325）单行合规、批量条（≈505）与搜索框（min-width:120 地板）
         * 1440 即折行是合规行为——宽屏单行回归锁只压 chips；批量条/搜索框锁边界即可（assertBounds） */
        H.t('面板 en@1440 宽屏单行不回归：chips 单行（h≤26）',
          !!(enW.chipsH && enW.chipsH > 0 && enW.chipsH <= 26), () => JSON.stringify({ chipsH: enW.chipsH }))
        assertBounds(enW, '面板 en@1440')
        await h.page.setViewportSize({ width: 400, height: 800 })
        await h.page.waitForTimeout(250)
        const enN = await measure()
        assertBounds(enN, '面板 en@400')
        /* 面板内容宽 336（368-32）：en chips（≈330）单行放得下——纪律落点是搜索框折下一行（栏高 23→≥44）；
         * 批量条（≈505）多行折行。app 侧内容宽 308 < chips 330，chips 内部折行（㊿ 已锁 h≥30）——两端折行落点不同，各自实证 */
        H.t('面板 en@400 窄宽折行实证：过滤栏折行（栏高 h≥44，搜索框折下一行）+ 批量条多行折行（h≥30）',
          !!(enN.barH && enN.barH >= 44 && enN.batchH && enN.batchH >= 30), () => JSON.stringify({ barH: enN.barH, chipsH: enN.chipsH, batchH: enN.batchH }))
        await H.screenshot(h.page, '51-panel-injmgr-overflow-en')
        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
      })
    } finally {
      await h.close()
    }
  },
}
