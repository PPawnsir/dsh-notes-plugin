'use strict'
/* 0.4.8 用例㊿（notes-048-injmgr-narrow-overflow）：注入管理过滤栏 chips + 批量条窄宽不溢出边界锁（app 真机）。
 * 背景：⑥卡 worker 全量共享态实测 EN + 400px 下过滤栏 chips（「Not injected 3」）与批量条（「Disable injection」钮）
 *   溢出 modal（scrollW 394 vs 338，越界 56px）；根因 = chips flex-shrink:0 + 栏/批量条无 flex-wrap，长文案整排越界。
 * 修复口径：控件栏窄宽纪律三件套——.injmgr-bar 补 flex-wrap（chips 超宽时搜索框折下一行）、
 *   .injmgr-chips 改 flex-shrink:1 + min-width:0 + flex-wrap（允许收缩+内部折行）、.injmgr-batch 补 flex-wrap（三动作钮折行）；
 *   纯样式壳，文案零改动。
 * 断言：getBoundingClientRect 边界（chips 末枚/搜索框/批量条末钮右缘 ≤ modal 内容右缘）+ modal/bar/batch 无横向滚动
 *   + 计算式纪律锁（三规则 flex-wrap:wrap）+ 宽屏单行不回归（chips h≤26 / batch h≤28）+ EN 窄宽折行实证（h≥30）；
 *   zh/en × 1440/400 四象限矩阵（en 文案更长 = 窄宽压力面；切语言走顶栏 #btnLang 真机路径）。
 * 隔离纪律：纯 UI 演习零写盘（开设置卡/开注入管理/切语言/改视口），finally 关 context。 */
module.exports = {
  name: '㊿ 0.4.8 注入管理 chips+批量条窄宽不溢出（app：zh/en × 1440/400 边界断言）',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '50-injmgr-overflow', async () => {
        const openMgr = async () => {
          await page.click('#btnSettings')
          await page.waitForSelector('#setInjectManager', { timeout: 8000 })
          await page.click('#setInjectManager')
          await page.waitForSelector('#modal.injmgr .injmgr-chips .injmgr-chip', { timeout: 8000 })
          await page.waitForSelector('#modal.injmgr #injMgrBody .injmgr-batch .trash-act', { timeout: 8000 })
        }
        /* 边界量测：chips 末枚/搜索框/批量条末钮 rect vs modal 内容右缘 + 三区横向滚动 + 三规则计算式纪律 */
        const measure = () => page.evaluate(() => {
          var R = {}
          var modal = document.querySelector('#modal.injmgr')
          if (!modal) return R
          var mr = modal.getBoundingClientRect()
          var padR = parseFloat(getComputedStyle(modal).paddingRight) || 0
          R.contentR = mr.right - padR
          R.modalNoX = modal.scrollWidth <= modal.clientWidth + 1
          var bar = modal.querySelector('.injmgr-bar')
          var chips = modal.querySelector('.injmgr-chips')
          var chipList = chips ? chips.querySelectorAll('.injmgr-chip') : []
          var chipLast = chipList.length ? chipList[chipList.length - 1] : null
          var search = modal.querySelector('.injmgr-search')
          var batch = modal.querySelector('#injMgrBody .injmgr-batch')
          var btns = batch ? batch.querySelectorAll('.trash-act') : []
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
        await openMgr()
        const zhW = await measure()
        H.t('计算式纪律锁：过滤栏/chips/批量条三规则 flex-wrap:wrap + chips flex-shrink:1 + min-width:0px',
          !!zhW.wrap && zhW.wrap.bar === 'wrap' && zhW.wrap.chips === 'wrap' && zhW.wrap.batch === 'wrap' && zhW.wrap.chipsShrink === '1' && zhW.wrap.chipsMinW === '0px', () => JSON.stringify(zhW.wrap))
        H.t('zh@1440 宽屏单行不回归：chips 单行（h≤26）+ 批量条单行（h≤28）',
          !!(zhW.chipsH && zhW.chipsH > 0 && zhW.chipsH <= 26 && zhW.batchH && zhW.batchH > 0 && zhW.batchH <= 28), () => JSON.stringify({ chipsH: zhW.chipsH, batchH: zhW.batchH }))
        assertBounds(zhW, 'zh@1440')
        await page.setViewportSize({ width: 400, height: 800 })
        await page.waitForTimeout(250)
        const zhN = await measure()
        assertBounds(zhN, 'zh@400')
        await H.screenshot(page, '50-injmgr-overflow')

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
        H.t('en@1440 宽屏单行不回归：chips 单行（h≤26）+ 批量条单行（h≤28）',
          !!(enW.chipsH && enW.chipsH > 0 && enW.chipsH <= 26 && enW.batchH && enW.batchH > 0 && enW.batchH <= 28), () => JSON.stringify({ chipsH: enW.chipsH, batchH: enW.batchH }))
        assertBounds(enW, 'en@1440')
        await page.setViewportSize({ width: 400, height: 800 })
        await page.waitForTimeout(250)
        const enN = await measure()
        assertBounds(enN, 'en@400')
        H.t('en@400 窄宽折行实证：chips 多行折行（h≥30）+ 批量条多行折行（h≥30）',
          !!(enN.chipsH && enN.chipsH >= 30 && enN.batchH && enN.batchH >= 30), () => JSON.stringify({ chipsH: enN.chipsH, batchH: enN.batchH }))
        await H.screenshot(page, '50-injmgr-overflow-en')
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
      })
    } finally {
      await page.context().close()
    }
  },
}
