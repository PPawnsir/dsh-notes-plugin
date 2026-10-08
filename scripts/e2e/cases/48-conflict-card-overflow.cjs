'use strict'
/* 0.4.8 用例㊽（notes-048-conflict-card-overflow）：注入管理「约定体检」卡 + 「调度任务」区说明行窄宽不溢出边界锁（app 真机）。
 * 背景：用户截图实证体检卡说明行（inj.conflictTitleSub）不换行溢出卡片；根因 = flex 项缺省 min-width:auto，
 *   遇长不可断 token 不收缩即越界（本用例修复前复现：80 字符纯字母 token 越界 174px）。
 * 修复口径：说明行 .sub 换行纪律（flex:1 1 auto + min-width:0 + overflow-wrap/word-break break-word），
 *   调度区说明行（.sched-sec-t .sub，同款隐患）一并同修；纯样式壳，文案零改动。
 * 顺带同修（全量 e2e 共享态实锤）：调度行 .sched-row 补 flex-wrap:wrap——有行态下 EN/窄宽动作区+失败徽章溢出越界
 *   （conflict-row 已有 flex-wrap 先例；双卡无横向滚动断言在全量共享态下有行才生效）。
 * 断言：getBoundingClientRect 边界（说明行/「开始体检」钮右缘 ≤ 卡右缘）+ 双卡无横向滚动（scrollWidth ≤ clientWidth+1）
 *   + 计算式纪律锁（flex-grow:1 / min-width:0px / break-word 双写）+ 宽屏体检卡单行不回归（h≤20）+ 窄宽折行实证（h≥20）；
 *   zh/en × 1440/400 四宫格矩阵（en 文案更长 = 窄宽压力面；切语言走顶栏 #btnLang 真机路径）。
 * 隔离纪律：纯 UI 演习零写盘（开关设置卡/切语言/改视口），finally 关 context。 */
module.exports = {
  name: '㊽ 0.4.8 约定体检卡说明行窄宽不溢出（app：zh/en × 1440/400 边界断言）',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '48-conflict-card-overflow', async () => {
        const openMgr = async () => {
          await page.click('#btnSettings')
          await page.waitForSelector('#setInjectManager', { timeout: 8000 })
          await page.click('#setInjectManager')
          await page.waitForSelector('#modal #injConflictHost .conflict-sec', { timeout: 8000 })
          await page.waitForSelector('#modal #injSchedHost .sched-sec', { timeout: 8000 })
        }
        /* 边界量测：说明行/体检钮 rect vs 各自卡 rect + 双卡横向滚动 + 说明行计算式纪律 */
        const measure = () => page.evaluate(() => {
          var R = {}
          var grab = function (key, el, sec) {
            if (!el || !sec) { R[key] = null; return }
            var r = el.getBoundingClientRect(), s = sec.getBoundingClientRect()
            R[key] = { inR: r.right <= s.right + 0.6, inL: r.left >= s.left - 0.6, h: Math.round(r.height * 10) / 10, overR: Math.round((r.right - s.right) * 10) / 10 }
          }
          var cSec = document.querySelector('#injConflictHost .conflict-sec')
          var sSec = document.querySelector('#injSchedHost .sched-sec')
          grab('sub', cSec && cSec.querySelector('.conflict-sec-t .sub'), cSec)
          grab('run', cSec && cSec.querySelector('.conflict-sec-t .conflict-run'), cSec)
          grab('schedSub', sSec && sSec.querySelector('.sched-sec-t .sub'), sSec)
          var subEl = cSec && cSec.querySelector('.conflict-sec-t .sub')
          var cs = subEl ? getComputedStyle(subEl) : null
          R.disc = cs ? { grow: cs.flexGrow, minW: cs.minWidth, ow: cs.overflowWrap, wb: cs.wordBreak } : null
          R.cNoX = cSec ? cSec.scrollWidth <= cSec.clientWidth + 1 : null
          R.sNoX = sSec ? sSec.scrollWidth <= sSec.clientWidth + 1 : null
          return R
        })
        const assertBounds = (m, tag) => {
          H.t(tag + '：体检卡说明行 +「开始体检」钮收进卡界（getBoundingClientRect 右缘 ≤ 卡右缘）',
            !!(m.sub && m.run && m.sub.inR && m.sub.inL && m.run.inR), () => JSON.stringify({ sub: m.sub, run: m.run }))
          H.t(tag + '：调度区说明行收进卡界 + 双卡无横向滚动（scrollWidth ≤ clientWidth+1）',
            !!(m.schedSub && m.schedSub.inR && m.schedSub.inL && m.cNoX === true && m.sNoX === true), () => JSON.stringify({ schedSub: m.schedSub, cNoX: m.cNoX, sNoX: m.sNoX }))
        }

        /* ===== zh 矩阵 ===== */
        await openMgr()
        const zhW = await measure()
        H.t('计算式纪律锁：体检卡说明行 flex-grow:1 + min-width:0px + overflow-wrap/word-break 双 break-word',
          !!zhW.disc && zhW.disc.grow === '1' && zhW.disc.minW === '0px' && zhW.disc.ow === 'break-word' && zhW.disc.wb === 'break-word', () => JSON.stringify(zhW.disc))
        H.t('zh@1440 宽屏单行不回归：体检卡说明行 h≤20', !!(zhW.sub && zhW.sub.h > 0 && zhW.sub.h <= 20), () => JSON.stringify(zhW.sub))
        assertBounds(zhW, 'zh@1440')
        await page.setViewportSize({ width: 400, height: 800 })
        await page.waitForTimeout(250)
        const zhN = await measure()
        assertBounds(zhN, 'zh@400')
        H.t('zh@400 窄宽折行不截字：体检卡 + 调度区说明行均多行折行（h≥20）',
          !!(zhN.sub && zhN.sub.h >= 20 && zhN.schedSub && zhN.schedSub.h >= 20), () => JSON.stringify({ sub: zhN.sub, schedSub: zhN.schedSub }))
        await H.screenshot(page, '48-conflict-card-overflow')

        /* ===== en 矩阵（#btnLang 在遮罩下不可点——reload 复位后先切语言再开面板；localStorage 同 context 持久）===== */
        await page.reload({ waitUntil: 'load' })
        await page.waitForSelector('#tree', { timeout: 15000 })
        await page.click('#btnLang')
        await H.waitFor(page, '语言切到 en（顶栏钮文字=English）', async p => p.evaluate(() => {
          var b = document.querySelector('#btnLang .tb-t'); return !!(b && b.textContent === 'English')
        }))
        await openMgr()
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.waitForTimeout(250)
        const enW = await measure()
        H.t('en@1440 宽屏单行不回归：体检卡说明行 h≤20', !!(enW.sub && enW.sub.h > 0 && enW.sub.h <= 20), () => JSON.stringify(enW.sub))
        assertBounds(enW, 'en@1440')
        await page.setViewportSize({ width: 400, height: 800 })
        await page.waitForTimeout(250)
        const enN = await measure()
        assertBounds(enN, 'en@400')
        H.t('en@400 窄宽折行不截字：体检卡 + 调度区说明行均多行折行（h≥20）',
          !!(enN.sub && enN.sub.h >= 20 && enN.schedSub && enN.schedSub.h >= 20), () => JSON.stringify({ sub: enN.sub, schedSub: enN.schedSub }))
        await H.screenshot(page, '48-conflict-card-overflow-en')
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
      })
    } finally {
      await page.context().close()
    }
  },
}
