'use strict'
/* 样板路径③：打开设置卡 → 切 English → 卡内 Language 生效。
 * 浏览器级对应 check「i18n 语言项 / setLang 全量 render」：#btnSettings 开设置卡 → #setLang 选 en
 * → setLang 持久化 + 全量 render → 卡内标签与壳（设置按钮）文案即时切英。 */
module.exports = {
  name: '③ 设置卡切 English 后 Language 即时生效',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      H.t('缺省中文：设置按钮为「设置」', (await page.textContent('#btnSettingsT')).trim() === '设置')
      await page.click('#btnSettings')
      await page.waitForSelector('#setLang', { timeout: 8000 })
      H.t('设置卡打开且含语言下拉 #setLang', true)
      await page.selectOption('#setLang', 'en')   // onchange → setLang('en') 持久化 + 全量 render + 重开设置卡
      await H.waitFor(page, '设置卡标签切为 Language', async p =>
        p.evaluate(() => {
          const sel = document.getElementById('setLang')
          return sel && sel.value === 'en' && document.body.textContent.indexOf('Language') >= 0
        }))
      H.t('语言下拉值为 en', (await page.inputValue('#setLang')) === 'en')
      H.t('卡内标签显示 Language', await page.evaluate(() => document.body.textContent.indexOf('Language') >= 0))
      await page.press('#setLang', 'Escape')   // 关设置卡，验壳层文案
      H.t('壳层设置按钮切为 Settings', (await page.textContent('#btnSettingsT')).trim() === 'Settings')
      H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
      await H.screenshot(page, '03-language-en.png')
    } finally { await page.context().close() }
  },
}
