'use strict'
/* 0.4.8 用例㊺（notes-048-settings-groups）app 端设置弹窗分组导航真机矩阵：
 * ① 七组渲染齐：非空 5 组 rail（图标+组名，冻结序）+ 5 组壳 + 17 节 data-sec 全覆盖（空组 editor/dispatch 隐身）；
 * ② 点击定位：rail「关于」→ 滚动容器（#modal）定位到组壳（吸顶标题 48px 补偿）+ aria-current；
 * ③ 滚动反高亮：滚顶=常规 on / 滚底=关于 on；
 * ④ 窄宽退化：500px 视口 → rail 隐 chips 显，chip 点击同款定位 + on；
 * ⑤ 0.4.7-B 零回归：滚到底 sticky「保存」恒见 + 长说明 .s.cl 收折仍在。
 * 隔离纪律：纯 UI 演习零写盘（仅开关设置卡 + 滚动），finally 关 context。 */
module.exports = {
  name: '㊺ 0.4.8 设置分组导航：七组 rail/点击定位/滚动反高亮/窄宽 chips（app）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '45-settings-groups', async () => {
        await page.click('#btnSettings')
        await page.waitForSelector('#setBody .set-row', { timeout: 8000 })
        await H.waitFor(page, '设置卡落定（LLM 区渲染）', async p => p.evaluate(() => !!document.querySelector('#setOrgMax')))

        /* ===== ① 七组渲染齐（非空 5 组；空组登记槽隐身）===== */
        const nav = await page.evaluate(() => {
          var rail = Array.prototype.slice.call(document.querySelectorAll('#setBody .set-rail-item'))
          return {
            railTexts: rail.map(function (b) { return b.textContent.trim() }),
            railGs: rail.map(function (b) { return b.getAttribute('data-g') }),
            railIcons: rail.map(function (b) { return !!b.querySelector('svg') }),
            groupGs: Array.prototype.slice.call(document.querySelectorAll('#setBody .set-group')).map(function (g) { return g.getAttribute('data-g') }),
            groupTs: Array.prototype.slice.call(document.querySelectorAll('#setBody .set-group-t')).map(function (g) { return g.textContent.trim() }),
            secs: document.querySelectorAll('#setBody .set-row[data-sec]').length,
            chips: document.querySelectorAll('#setBody .set-chip').length,
            chipsShown: getComputedStyle(document.querySelector('#setBody .set-chips')).display,
            railShown: getComputedStyle(document.querySelector('#setBody .set-rail')).display,
            navRole: document.querySelector('#setBody .set-rail').getAttribute('role'),
            navAria: document.querySelector('#setBody .set-rail').getAttribute('aria-label'),
          }
        })
        H.t('① 七组渲染齐：rail 5 项（图标+组名，冻结序 常规/检索与注入/AI/数据与存储/关于）',
          nav.railTexts.join('|') === '常规|检索与注入|AI|数据与存储|关于' && nav.railIcons.every(Boolean), () => JSON.stringify(nav.railTexts))
        H.t('① rail/组壳 data-g 同序 [general,inject,ai,data,about]（空组 editor/dispatch 隐身）',
          nav.railGs.join() === 'general,inject,ai,data,about' && nav.groupGs.join() === 'general,inject,ai,data,about', () => nav.railGs.join() + ' / ' + nav.groupGs.join())
        H.t('① 组头 5 个与 rail 同文 + 17 节 data-sec 全覆盖', nav.groupTs.join('|') === '常规|检索与注入|AI|数据与存储|关于' && nav.secs === 17, () => nav.groupTs.join('|') + ' · 节数 ' + nav.secs)
        H.t('① rail 导航语义（role=navigation + aria-label 设置分组）+ 宽屏 chips 隐身/rail 显',
          nav.navRole === 'navigation' && nav.navAria === '设置分组' && nav.chips === 5 && nav.chipsShown === 'none' && nav.railShown !== 'none', () => nav.navRole + '/' + nav.navAria + '/chips:' + nav.chipsShown)

        /* ===== ② 点击定位：rail「关于」（末组）→ 触底滚足 + 组壳入视口 + on + aria-current（触底锁末组：末组高度不足上顶 48px 时滚到最大滚动位） ===== */
        await page.click('#setBody .set-rail-item[data-g="about"]')
        await H.waitFor(page, '关于组定位落定 + on 高亮', async p => p.evaluate(() => {
          var modal = document.querySelector('#modal')
          var g = modal.querySelector('.set-group[data-g="about"]')
          var d = g.getBoundingClientRect().top - modal.getBoundingClientRect().top
          var item = modal.querySelector('.set-rail-item[data-g="about"]')
          return modal.scrollTop > 0 && d >= 40 && d < modal.clientHeight - 20
            && modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 2
            && item.classList.contains('on') && item.getAttribute('aria-current') === 'true'
        }))
        H.t('② rail 点击定位末组（触底滚足 + 组壳入视口）+ 当前组 on + aria-current', true)
        H.t('② 定位落点 = 组壳内首节即「键盘快捷键」行（组尾单节组）', await page.evaluate(() =>
          document.querySelector('.set-group[data-g="about"] .set-row[data-sec="cheatsheet"]') !== null))
        /* ②b 非末组精确上顶：rail「检索与注入」→ 组壳顶缘贴吸顶标题下（48px 补偿区间） */
        await page.click('#setBody .set-rail-item[data-g="inject"]')
        await H.waitFor(page, '注入组精确上顶（48px 补偿）', async p => p.evaluate(() => {
          var modal = document.querySelector('#modal')
          var g = modal.querySelector('.set-group[data-g="inject"]')
          var d = g.getBoundingClientRect().top - modal.getBoundingClientRect().top
          return d >= 40 && d <= 70 && modal.querySelector('.set-rail-item[data-g="inject"]').classList.contains('on')
        }))
        H.t('②b rail 点击定位非末组：组壳顶缘 = 吸顶标题下 48px 补偿区间', true)

        /* ===== ③ 滚动反高亮 ===== */
        await page.evaluate(() => { document.querySelector('#modal').scrollTop = 0 })
        await H.waitFor(page, '滚顶 → 常规 on', async p => p.evaluate(() => {
          var it = document.querySelector('.set-rail-item[data-g="general"]')
          return it.classList.contains('on') && !document.querySelector('.set-rail-item[data-g="about"]').classList.contains('on')
        }))
        H.t('③ 滚动反高亮：滚顶 → 当前组=常规', true)
        await page.evaluate(() => { document.querySelector('#modal').scrollTop = document.querySelector('#modal').scrollHeight })
        await H.waitFor(page, '滚底 → 关于 on', async p => p.evaluate(() =>
          document.querySelector('.set-rail-item[data-g="about"]').classList.contains('on')))
        H.t('③ 滚动反高亮：滚底 → 当前组=关于', true)
        /* 中段命中：滚到「检索与注入」组壳 → inject on（反高亮非首末偏置） */
        await page.evaluate(() => {
          var modal = document.querySelector('#modal')
          var g = modal.querySelector('.set-group[data-g="inject"]')
          modal.scrollTop = modal.scrollTop + (g.getBoundingClientRect().top - modal.getBoundingClientRect().top) - 48
        })
        await H.waitFor(page, '滚到注入组 → inject on', async p => p.evaluate(() =>
          document.querySelector('.set-rail-item[data-g="inject"]').classList.contains('on')))
        H.t('③ 滚动反高亮：中段组命中（检索与注入）', true)

        /* ===== ⑤ 0.4.7-B 零回归：滚到底 sticky 保存恒见 + 长说明收折在案 ===== */
        const regOk = await page.evaluate(() => {
          var modal = document.querySelector('#modal')
          modal.scrollTop = modal.scrollHeight
          var mr = modal.getBoundingClientRect(), br = document.querySelector('#setSave').getBoundingClientRect()
          return br.top >= mr.top - 1 && br.bottom <= mr.bottom + 1 && !!document.querySelector('#setBody .set-label .s.cl')
        })
        H.t('⑤ 0.4.7-B 零回归：滚到底 sticky「保存」恒见 + 长说明 .s.cl 收折在案', regOk)
        await H.screenshot(page, '45-settings-groups')   /* 宽屏 rail 态留档（滚底：sticky 保存 + 关于 on） */

        /* ===== ④ 窄宽退化：500px 视口 → rail 隐 chips 显，chip 点击定位 + on ===== */
        await page.setViewportSize({ width: 500, height: 800 })
        await H.waitFor(page, '窄宽退化：rail 隐 + chips 显', async p => p.evaluate(() => {
          var rail = document.querySelector('#setBody .set-rail'), chips = document.querySelector('#setBody .set-chips')
          return getComputedStyle(rail).display === 'none' && getComputedStyle(chips).display === 'flex'
        }))
        H.t('④ <560px 窄宽退化：rail 隐 + 顶部 chips 横条显', true)
        await page.click('#setBody .set-chip[data-g="inject"]')
        await H.waitFor(page, 'chip 点击定位 检索与注入 + on', async p => p.evaluate(() => {
          var modal = document.querySelector('#modal')
          var g = modal.querySelector('.set-group[data-g="inject"]')
          var d = g.getBoundingClientRect().top - modal.getBoundingClientRect().top
          return d >= 40 && d <= 70 && modal.querySelector('.set-chip[data-g="inject"]').classList.contains('on')
        }))
        H.t('④ chips 点击定位中段组（48px 补偿）+ 当前 chip on（窄宽同款行为）', true)
        /* ④b 尾部组余量不足语义锁：chip「数据与存储」→ 触底滚足（组壳入视口）→ 触底锁末组 = 关于 on（scroll-spy 标准语义，宽窄同款） */
        await page.click('#setBody .set-chip[data-g="data"]')
        await H.waitFor(page, 'chip 点尾部组 → 触底滚足 + 关于 on', async p => p.evaluate(() => {
          var modal = document.querySelector('#modal')
          var g = modal.querySelector('.set-group[data-g="data"]')
          var d = g.getBoundingClientRect().top - modal.getBoundingClientRect().top
          return modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 2 && d >= 40 && d < modal.clientHeight - 20
            && modal.querySelector('.set-chip[data-g="about"]').classList.contains('on')
        }))
        H.t('④b chips 点尾部组：触底滚足 + 组壳入视口 + 触底锁末组（关于 on）', true)
        await H.screenshot(page, '45-settings-groups-narrow')   /* 窄宽 chips 态留档 */
        await page.setViewportSize({ width: 1440, height: 900 })   /* 复位宽屏（截图口径统一） */
        await page.keyboard.press('Escape')
        await H.waitFor(page, '设置卡关闭', async p => p.evaluate(() => document.querySelector('#modalHost').textContent === ''))
      })
    } finally {
      await page.context().close()
    }
  },
}
