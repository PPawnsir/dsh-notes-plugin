'use strict'
/* 0.4.3 验收修复⑪ 用例⑰：详情三态切「资料」→ 弹 whenToUse 挂载框（LLM 缺位回退预填标题）→ Esc 取消零副作用 / 确认落行+翻档。
 * 链路锁：modal-first（不先静默翻转）→ 取消（Esc/遮罩）= 不挂载不翻 inject；injMountSave = notes-mount（host 单点收口翻 reference）→ 树行 bolt 徽章 + 注入管理行资料档。
 * 0.4.7-B④b（notes-047-ux）：本入口（角色切换在途）跳过钮语义改为「仅切换角色，暂不挂载」——零副作用口径改由 Esc/遮罩承接
 *   （跳过档第三岔行为级锁见用例㊳ 38-ux-047b：跳过=切资料档 + notes-mount 零调用）。
 * 隔离纪律：用例自带新建笔记（e2e 各用例共享 mock host 状态，种子笔记 A 已被用例⑪置为约定档——不复用）。 */
module.exports = {
  name: '⑰ 设为资料弹 whenToUse 挂载框：取消零副作用 / 确认落行翻档',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '17-mount-modal', async () => {
        /* 隔离：新建专属笔记（off 态起点确定） */
        await H.createNoteViaUI(page, 'e2e 挂载笔记⑪', '挂载正文')
        await page.click('#tree .note-row:has-text("e2e 挂载笔记⑪")')
        await page.waitForSelector('#mRole', { timeout: 8000 })
        const boltCount = () => page.evaluate(() => {
          var rows = document.querySelectorAll('#tree .note-row')
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf('e2e 挂载笔记⑪') >= 0) return rows[i].querySelectorAll('use[href="#i-bolt"]').length
          }
          return -1
        })
        /* 切「资料」档 → 挂载框打开（modal-first：此时不静默翻转） */
        await page.click('#mRole .seg[data-role="reference"]')
        await page.waitForSelector('#injMountWhen', { timeout: 8000 })
        H.t('切「资料」档弹出 whenToUse 挂载框（#injMountWhen 可见）', true)
        /* 预填到位（e2e mock 无 LLM → notes-when-suggest error → 回退预填标题） */
        await H.waitFor(page, '挂载框预填非空（回退标题）', async p =>
          p.evaluate(() => { var ta = document.querySelector('#injMountWhen'); return ta && ta.value.trim().length > 0 }))
        H.t('挂载框预填文案非空（LLM 缺位回退标题路径）', true)
        /* 取消（Esc）= 零副作用：不挂载不翻 inject（树行无 bolt 徽章）。
           0.4.7-B④b：跳过钮语义已改「仅切换角色，暂不挂载」（onSkip 第三岔）——取消零副作用口径 = Esc/遮罩 */
        await page.keyboard.press('Escape')
        await H.waitFor(page, 'Esc 后挂载框关闭', async p => p.evaluate(() => !document.querySelector('#injMountWhen')))
        await H.sleep(1200)   // 越过 900ms 自动保存窗口（若有误翻转会在此落盘并刷新出徽章）
        const boltAfterCancel = await boltCount()
        H.t('取消零副作用：树行无注入 bolt 徽章（未翻 inject）', boltAfterCancel === 0, () => '实得徽章数 ' + boltAfterCancel)
        /* 再次切「资料」→ 编辑文案 → 确认 → 落行 + 翻 reference 档 */
        await page.click('#mRole .seg[data-role="reference"]')
        await page.waitForSelector('#injMountWhen', { timeout: 8000 })
        await H.waitFor(page, '挂载框再次预填非空', async p =>
          p.evaluate(() => { var ta = document.querySelector('#injMountWhen'); return ta && ta.value.trim().length > 0 }))
        await page.fill('#injMountWhen', 'e2e 挂载文案⑪')
        await page.click('#injMountSave')
        await H.waitFor(page, '确认后挂载框关闭', async p => p.evaluate(() => !document.querySelector('#injMountWhen')))
        await H.waitFor(page, '确认后树行出现 bolt 徽章（翻 reference 档）', async p => (await boltCount()) === 1)
        H.t('确认后树行出现 bolt 徽章（host 单点收口翻 reference 档）', true)
        /* 注入管理面板：该行三态在资料档 */
        await page.click('#btnSettings')
        await page.waitForSelector('#setInjectManager', { timeout: 8000 })
        await page.click('#setInjectManager')
        await page.waitForSelector('#injMgrChips .injmgr-chip', { timeout: 8000 })
        const onRole = await page.evaluate(() => {
          var rows = document.querySelectorAll('#injMgrBody .injmgr-row')
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf('e2e 挂载笔记⑪') >= 0) {
              var on = rows[i].querySelector('.injmgr-opt.on')
              return on ? on.getAttribute('data-role') : ''
            }
          }
          return ''
        })
        H.t('注入管理该行三态在「reference」档（挂载⇔资料不变量 UI 一致）', onRole === 'reference', () => '实际档位：' + onRole)
        await H.screenshot(page, '17-mount-modal')
      })
    } finally { await page.context().close() }
  },
}
