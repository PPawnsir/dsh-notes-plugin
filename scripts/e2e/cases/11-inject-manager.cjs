'use strict'
/* 0.4.3② 用例⑪：注入开关开 → 注入管理列表变化。
 * 详情 meta 三态段切「约定」→ 自动保存（树行 bolt 徽章）→ 设置卡开注入管理 → 约定 chip 计数 ≥1 且该行三态在约定档。
 * 0.4.7-A④ 追加：行内「设为约定」confirm 闸演练（dismiss 零副作用 / accept 才生效）。 */
module.exports = {
  name: '⑪ 注入开关开 → 注入管理列表变化 + 行内约定确认闸（0.4.7-A④）',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    /* 0.4.6-E：「约定」档新增二次确认闸（meta.convInjectConfirm）——本用例走确认通过路径（Playwright 缺省自动 dismiss 对话框，须显式 accept） */
    /* 0.4.7-A④：dlgAccept 开关 + 文案录制（行内闸两态演练） */
    let dlgAccept = true
    const dlgMsgs = []
    page.on('dialog', d => { dlgMsgs.push(d.message()); if (dlgAccept) d.accept().catch(() => {}); else d.dismiss().catch(() => {}) })
    try {
      await H.step(page, '11-inject-manager', async () => {
        await page.click('#tree .note-row:has-text("e2e 种子笔记 A")')
        await page.waitForSelector('#mRole', { timeout: 8000 })
        await page.click('#mRole .seg[data-role="convention"]')
        /* 自动保存 + 列表刷新：树行出现注入 bolt 徽章 */
        await page.waitForSelector('#tree .note-row use[href="#i-bolt"]', { timeout: 10000 })
        H.t('注入开约定档后树行出现 bolt 注入徽章', true)
        /* 打开设置卡 → 注入管理 */
        await page.click('#btnSettings')
        await page.waitForSelector('#setInjectManager', { timeout: 8000 })
        await page.click('#setInjectManager')
        await page.waitForSelector('#injMgrChips .injmgr-chip', { timeout: 8000 })
        const chipConv = page.locator('#injMgrChips .injmgr-chip[data-f="convention"]')
        H.t('注入管理出现「约定」统计 chip', (await chipConv.count()) === 1)
        const convTxt = await chipConv.textContent()
        H.t('约定 chip 计数为 1（刚开的 A）', /1/.test(convTxt || ''), () => 'chip 文案：' + convTxt)
        const row = page.locator('#injMgrBody .injmgr-row', { hasText: 'e2e 种子笔记 A' })
        H.t('注入管理列表出现「e2e 种子笔记 A」行', (await row.count()) === 1)
        const onRole = await page.evaluate(() => {
          var rows = document.querySelectorAll('#injMgrBody .injmgr-row')
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf('e2e 种子笔记 A') >= 0) {
              var on = rows[i].querySelector('.injmgr-opt.on')
              return on ? on.getAttribute('data-role') : ''
            }
          }
          return ''
        })
        H.t('该行三态当前在「convention」档', onRole === 'convention', () => '实际档位：' + onRole)

        /* ===== 0.4.7-A④：行内「设为约定」confirm 闸（单击直切太秃 → 二次确认；dismiss 零副作用 / accept 生效） ===== */
        const roleOfA = () => page.evaluate(() => {
          var rows = document.querySelectorAll('#injMgrBody .injmgr-row')
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf('e2e 种子笔记 A') >= 0) {
              var on = rows[i].querySelector('.injmgr-opt.on')
              return on ? on.getAttribute('data-role') : ''
            }
          }
          return ''
        })
        const optA = (role) => '#injMgrBody .injmgr-row:has-text("e2e 种子笔记 A") .injmgr-opt[data-role="' + role + '"]'
        await page.click(optA('off'))
        await H.waitFor(page, '行内切 off 落定', async () => (await roleOfA()) === 'off')
        const roleAfterOff = await roleOfA()
        H.t('行内切「off」档无确认闸直接生效', roleAfterOff === 'off', () => '实得档位：' + roleAfterOff)
        dlgAccept = false
        const dlgBefore = dlgMsgs.length
        await page.click(optA('convention'))
        await H.waitFor(page, '行内「设为约定」弹二次确认（文案含「设为约定」）', async () => Promise.resolve(dlgMsgs.length === dlgBefore + 1 && dlgMsgs[dlgMsgs.length - 1].indexOf('设为约定') >= 0))
        H.t('行内「设为约定」触发 confirm 闸（文案带笔记标题）', dlgMsgs[dlgMsgs.length - 1].indexOf('e2e 种子笔记 A') >= 0, () => '实得文案：' + dlgMsgs[dlgMsgs.length - 1])
        await H.sleep(700)   /* 越过任何误保存窗口 */
        const roleAfterDismiss = await roleOfA()
        H.t('dismiss 确认条 = 零副作用（行仍 off 档）', roleAfterDismiss === 'off', () => '实得档位：' + roleAfterDismiss)
        dlgAccept = true
        await page.click(optA('convention'))
        await H.waitFor(page, 'accept 后行落 convention 档', async () => (await roleOfA()) === 'convention')
        const roleAfterAccept = await roleOfA()
        H.t('accept 确认条 = 约定档生效（行落 convention）', roleAfterAccept === 'convention', () => '实得档位：' + roleAfterAccept)
        await H.screenshot(page, '11-inject-manager')
      })
    } finally { await page.context().close() }
  },
}
