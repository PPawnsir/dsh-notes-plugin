'use strict'
/* 0.4.3② 用例⑫：派发计划块创建（仅一次模式）。
 * 详情 → 派发弹窗 → 定时执行 → 仅一次 + 未来时刻 + 选目标会话 → 确认 →
 * 生成「定时 」前缀计划笔记 + 注入管理「调度任务」区出现该行。 */
module.exports = {
  name: '⑫ 派发计划块创建（仅一次模式）',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '12-dispatch-once', async () => {
        await page.click('#tree .note-row:has-text("e2e 种子笔记 B")')
        await page.waitForSelector('#mDispatch', { timeout: 8000 })
        await page.click('#mDispatch')
        await page.waitForSelector('#dOk', { timeout: 8000 })
        H.t('派发弹窗打开（#dOk 可见）', await page.isVisible('#dOk'))
        /* 切定时执行 → 表单出现 */
        await page.check('#dTrigSched')
        await page.waitForSelector('#dSchedForm', { state: 'visible', timeout: 8000 })
        await page.selectOption('#dSchedMode', 'once')
        H.t('仅一次模式：datetime-local 输入框可见', await page.isVisible('#dSchedOnce'))
        /* 未来时刻（本地无后缀，供 schedFormDecl 校验） */
        await page.fill('#dSchedOnce', '2027-01-01T09:00')
        /* 选目标会话（mock 注入 1 个 live 会话） */
        await page.waitForSelector('#dispSessHost .disp-sess[data-sid]', { timeout: 8000 })
        await page.click('#dispSessHost .disp-sess[data-sid]')
        H.t('目标会话选中（行高亮 .on）', await page.evaluate(() => !!document.querySelector('#dispSessHost .disp-sess.on')))
        /* 确认排定 */
        await page.click('#dOk')
        await H.waitFor(page, '树中出现「定时 」前缀计划笔记', async p => p.evaluate(() => document.querySelector('#tree').textContent.indexOf('定时 e2e 种子笔记 B') >= 0))
        H.t('确认后生成「定时 」前缀计划笔记', true)
        /* 注入管理 → 调度任务区出现该行 */
        await page.click('#btnSettings')
        await page.waitForSelector('#setInjectManager', { timeout: 8000 })
        await page.click('#setInjectManager')
        await page.waitForSelector('#injSchedHost .sched-row', { timeout: 8000 })
        const schedTxt = await page.textContent('#injSchedHost')
        H.t('注入管理「调度任务」区出现计划块行', (schedTxt || '').indexOf('定时 e2e 种子笔记 B') >= 0)
        const nextTxt = await page.textContent('#injSchedHost .sched-row .sched-nf')
        H.t('计划块显示「下次」触发时间', /下次|已/.test(nextTxt || ''), () => '实际：' + nextTxt)
        await H.screenshot(page, '12-dispatch-once')
      })
    } finally { await page.context().close() }
  },
}
