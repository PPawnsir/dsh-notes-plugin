'use strict'
/* 0.4.8 用例㊾（notes-048-conflict-card-overflow）client 面板侧同款边界锁（panel-harness 装载发布版 lib/client.js + lib/styles.css 真机口径）：
 * 与用例㊽同口径——说明行（.dsh-notes-sched-sec-sub，调度区/体检卡共用一类）换行纪律 + getBoundingClientRect 边界 + 双卡无横向滚动；
 * 顺带同修：.dsh-notes-sched-row 补 flex-wrap:wrap（conflict-row 同款先例，窄宽/EN 长徽章下动作区折行不越界）；
 * zh/en × 1440/400 矩阵（面板注入管理弹窗实为 440px 内容宽——.dsh-notes-data-modal 后定义覆盖 injmgr 640，窄面天生更挤，必锁）。
 * 面板语言切换走标题栏语言钮真机路径（modal 遮罩下不可点 → 先关两层弹窗再切）；注入管理行定位用组壳+序位（inject 组第 4 行，跨语言稳定）。
 * 隔离纪律：仅写 localStorage 语言偏好（业务零写盘），finally 关 context。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊾ 面板 0.4.8 约定体检卡说明行窄宽不溢出（client：zh/en × 1440/400 边界断言）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {})
    try {
      await H.step(h.page, '49-panel-conflict-card-overflow', async () => {
        /* 开注入管理（设置 → inject 组第 4 行「注入管理」→ 管理…钮；组壳+序位定位，跨语言稳定） */
        const openMgr = async (settingsBtnText) => {
          /* 面板已开则直进（hdr-btn 是开合切换钮，重复点会关板——用例㊼同款教训） */
          if (!(await h.page.$('.dsh-notes-floating'))) await h.openPanel()
          await h.page.click('.dsh-notes-fbtn:has-text("' + settingsBtnText + '")')
          await h.page.waitForSelector('.dsh-notes-settings-group[data-g="inject"] .dsh-notes-settings-row', { timeout: 8000 })
          await h.page.locator('.dsh-notes-settings-group[data-g="inject"] .dsh-notes-settings-row').nth(3).locator('.dsh-notes-settings-control button').click()
          await h.page.waitForSelector('.dsh-notes-injmgr-modal .dsh-notes-conflict-sec', { timeout: 8000 })
          await h.page.waitForSelector('.dsh-notes-injmgr-modal .dsh-notes-sched-sec', { timeout: 8000 })
        }
        const measure = () => h.page.evaluate(() => {
          var R = {}
          var grab = function (key, el, sec) {
            if (!el || !sec) { R[key] = null; return }
            var r = el.getBoundingClientRect(), s = sec.getBoundingClientRect()
            R[key] = { inR: r.right <= s.right + 0.6, inL: r.left >= s.left - 0.6, h: Math.round(r.height * 10) / 10, overR: Math.round((r.right - s.right) * 10) / 10 }
          }
          var cSec = document.querySelector('.dsh-notes-injmgr-modal .dsh-notes-conflict-sec')
          var sSec = document.querySelector('.dsh-notes-injmgr-modal .dsh-notes-sched-sec')
          grab('sub', cSec && cSec.querySelector('.dsh-notes-conflict-sec-t .dsh-notes-sched-sec-sub'), cSec)
          grab('run', cSec && cSec.querySelector('.dsh-notes-conflict-sec-t .dsh-notes-conflict-run'), cSec)
          grab('schedSub', sSec && sSec.querySelector('.dsh-notes-sched-sec-t .dsh-notes-sched-sec-sub'), sSec)
          var subEl = cSec && cSec.querySelector('.dsh-notes-conflict-sec-t .dsh-notes-sched-sec-sub')
          var cs = subEl ? getComputedStyle(subEl) : null
          R.disc = cs ? { grow: cs.flexGrow, minW: cs.minWidth, ow: cs.overflowWrap, wb: cs.wordBreak } : null
          R.cNoX = cSec ? cSec.scrollWidth <= cSec.clientWidth + 1 : null
          R.sNoX = sSec ? sSec.scrollWidth <= sSec.clientWidth + 1 : null
          return R
        })
        const assertBounds = (m, tag) => {
          H.t(tag + '：体检卡说明行 + 体检钮收进卡界（getBoundingClientRect 右缘 ≤ 卡右缘）',
            !!(m.sub && m.run && m.sub.inR && m.sub.inL && m.run.inR), () => JSON.stringify({ sub: m.sub, run: m.run }))
          H.t(tag + '：调度区说明行收进卡界 + 双卡无横向滚动（scrollWidth ≤ clientWidth+1）',
            !!(m.schedSub && m.schedSub.inR && m.schedSub.inL && m.cNoX === true && m.sNoX === true), () => JSON.stringify({ schedSub: m.schedSub, cNoX: m.cNoX, sNoX: m.sNoX }))
        }

        /* ===== zh 矩阵 ===== */
        await openMgr('设置')
        const zhW = await measure()
        H.t('面板计算式纪律锁：说明行 flex-grow:1 + min-width:0px + overflow-wrap/word-break 双 break-word',
          !!zhW.disc && zhW.disc.grow === '1' && zhW.disc.minW === '0px' && zhW.disc.ow === 'break-word' && zhW.disc.wb === 'break-word', () => JSON.stringify(zhW.disc))
        H.t('面板 zh@1440 宽屏单行不回归：体检卡说明行 h≤20', !!(zhW.sub && zhW.sub.h > 0 && zhW.sub.h <= 20), () => JSON.stringify(zhW.sub))
        assertBounds(zhW, '面板 zh@1440')
        await h.page.setViewportSize({ width: 400, height: 800 })
        await h.page.waitForTimeout(250)
        const zhN = await measure()
        assertBounds(zhN, '面板 zh@400')
        H.t('面板 zh@400 窄宽折行不截字：体检卡 + 调度区说明行均多行折行（h≥20）',
          !!(zhN.sub && zhN.sub.h >= 20 && zhN.schedSub && zhN.schedSub.h >= 20), () => JSON.stringify({ sub: zhN.sub, schedSub: zhN.schedSub }))
        await H.screenshot(h.page, '49-panel-conflict-card-overflow')

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
        /* 面板弹窗内容宽 440（data-modal 后定义覆盖 injmgr 640）：en 长说明在 1440 视口即两行是合规折行，
         * 宽屏单行回归锁只压 zh（h≤20 上行已锁）；en 宽屏锁边界即可（assertBounds） */
        assertBounds(enW, '面板 en@1440')
        await h.page.setViewportSize({ width: 400, height: 800 })
        await h.page.waitForTimeout(250)
        const enN = await measure()
        assertBounds(enN, '面板 en@400')
        H.t('面板 en@400 窄宽折行不截字：体检卡 + 调度区说明行均多行折行（h≥20）',
          !!(enN.sub && enN.schedSub && enN.sub.h >= 20 && enN.schedSub.h >= 20), () => JSON.stringify({ sub: enN.sub, schedSub: enN.schedSub }))
        await H.screenshot(h.page, '49-panel-conflict-card-overflow-en')
        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
      })
    } finally {
      await h.close()
    }
  },
}
