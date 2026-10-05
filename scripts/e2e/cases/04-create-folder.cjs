'use strict'
/* 0.4.3② 用例④：建文件夹（自定义弹层 + 空名/同级重名拦截）。
 * 路径：#addFolder → 弹层 #fldName → 空名提交内联红字 → 正常名 Enter 落库 → 树出现行；
 * 再次同名 → 重名内联拦截（零新夹）。 */
module.exports = {
  name: '④ 建文件夹：弹层 + 空名/重名拦截',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '04-create-folder', async () => {
        await page.click('#addFolder')
        await page.waitForSelector('#fldName', { timeout: 8000 })
        H.t('点 #addFolder 弹出文件夹命名弹层（#fldName 可见）', await page.isVisible('#fldName'))
        /* 空名拦截：直接提交 */
        await page.click('#fldOk')
        await page.waitForSelector('#mErr', { state: 'visible', timeout: 4000 })
        H.t('空名提交被内联拦截（#mErr 可见）', await page.isVisible('#mErr'))
        const err0 = await page.textContent('#mErr')
        H.t('空名报错文案为「不能为空」语义', /空/.test(err0 || ''), () => '实际文案：' + err0)
        /* 正常创建 */
        await page.fill('#fldName', 'e2e夹甲')
        await page.keyboard.press('Enter')
        await H.waitFor(page, '树中出现文件夹行「e2e夹甲」', async p => p.evaluate(() => {
          var rows = document.querySelectorAll('#tree .row.head[data-fold]')
          for (var i = 0; i < rows.length; i++) {
            var nm = rows[i].querySelector('.nm')
            if (nm && nm.textContent === 'e2e夹甲') return true
          }
          return false
        }))
        H.t('创建后树出现「e2e夹甲」行', true)
        /* 同级重名拦截 */
        await page.click('#addFolder')
        await page.waitForSelector('#fldName', { timeout: 8000 })
        await page.fill('#fldName', 'e2e夹甲')
        await page.click('#fldOk')
        await page.waitForSelector('#mErr', { state: 'visible', timeout: 4000 })
        const err1 = await page.textContent('#mErr')
        H.t('同级重名提交被内联拦截（#mErr 可见）', await page.isVisible('#mErr'))
        H.t('重名报错文案含重名夹名', (err1 || '').indexOf('e2e夹甲') >= 0, () => '实际文案：' + err1)
        /* 拦截后不产生第二条同名夹 */
        const dupCnt = await page.evaluate(() => {
          var n = 0
          document.querySelectorAll('#tree .row.head[data-fold] .nm').forEach(function (el) { if (el.textContent === 'e2e夹甲') n++ })
          return n
        })
        H.t('重名拦截后同名夹仍只有 1 条', dupCnt === 1, () => '实际 ' + dupCnt + ' 条')
        await page.click('#fldCancel')
        await H.screenshot(page, '04-create-folder')
      })
    } finally { await page.context().close() }
  },
}
