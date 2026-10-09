'use strict'
/* 样板路径③（0.4.8 notes-048-lang-topbar 改写）：顶栏语言钮两态直切 ——
 * 点击 #btnLang（建议钮后）→ setLang 既有链路（localStorage 持久化 + 全量 render）→ 壳文案即时切英；
 * 刷新后语言保持；设置卡语言项已下线（无 #setLang / data-sec="language"，常规组空槽隐身）；再点切回中文。
 * 浏览器级对应 check 60⑤/112（顶栏钮锚 + topbar.js 行为级 eval）。 */
module.exports = {
  name: '③ 顶栏语言钮切 English 即时生效 + 刷新持久化 + 设置卡语言项下线',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '03-lang-topbar', async () => {
        /* ===== ① 缺省中文态：语言钮在「建议」后，文字=中文，tooltip=切换语言 ===== */
        const ord = await page.evaluate(() => {
          const ids = ['btnRefresh', 'btnSuggest', 'btnLang', 'btnTheme', 'btnHome']
          return ids.map(id => { const el = document.getElementById(id); return el ? el.getBoundingClientRect().left : -1 })
        })
        H.t('顶栏按钮序：刷新 → 建议 → 语言 → 切换主题 → 主界面（只插入不动他钮）',
          ord.every((x, i) => x >= 0 && (i === 0 || x > ord[i - 1])), () => JSON.stringify(ord))
        H.t('缺省中文：语言钮文字「中文」+ tooltip「切换语言」',
          (await page.textContent('#btnLang .tb-t')).trim() === '中文' && await page.getAttribute('#btnLang', 'title') === '切换语言')
        H.t('缺省中文：设置按钮为「设置」', (await page.textContent('#btnSettingsT')).trim() === '设置')

        /* ===== ② 点击 → 界面文案即时切英 ===== */
        await page.click('#btnLang')
        await H.waitFor(page, '壳层切英（设置按钮 Settings）', async p =>
          p.evaluate(() => document.getElementById('btnSettingsT').textContent.trim() === 'Settings'))
        H.t('切英后：语言钮文字 English + tooltip Switch language',
          (await page.textContent('#btnLang .tb-t')).trim() === 'English' && await page.getAttribute('#btnLang', 'title') === 'Switch language')
        H.t('切英后：壳层设置按钮 Settings + 侧栏品牌 Notes', await page.evaluate(() =>
          document.getElementById('btnSettingsT').textContent.trim() === 'Settings' && document.getElementById('brandName').textContent.trim() === 'Notes'))
        H.t('localStorage 持久化 dsh-notes-lang=en', await page.evaluate(() => localStorage.getItem('dsh-notes-lang') === 'en'))

        /* ===== ③ 设置卡语言项下线 ===== */
        await page.click('#btnSettings')
        await page.waitForSelector('#setBody .set-row', { timeout: 8000 })
        await H.waitFor(page, '设置卡落定（LLM 区渲染）', async p => p.evaluate(() => !!document.querySelector('#setOrgMax')))
        H.t('设置卡语言项下线：无 #setLang / data-sec="language"', await page.evaluate(() =>
          !document.getElementById('setLang') && !document.querySelector('#setBody [data-sec="language"]')))
        H.t('设置卡 17 节 + 常规组空槽隐身（首可见组=检索与注入）', await page.evaluate(() =>
          document.querySelectorAll('#setBody .set-row[data-sec]').length === 17 && !document.querySelector('#setBody [data-g="general"]')))
        H.t('en 态设置卡文案：LLM model 行在案', await page.evaluate(() => document.getElementById('setBody').textContent.indexOf('LLM model') >= 0))
        await page.keyboard.press('Escape')
        await H.waitFor(page, '设置卡关闭', async p => p.evaluate(() => document.querySelector('#modalHost').textContent === ''))

        /* ===== ④ 刷新持久化 + 再点切回中文 ===== */
        await page.reload({ waitUntil: 'load' })
        await page.waitForSelector('#tree', { timeout: 15000 })
        H.t('刷新后语言保持 English（设置按钮 Settings）', await page.evaluate(() =>
          localStorage.getItem('dsh-notes-lang') === 'en' && document.getElementById('btnSettingsT').textContent.trim() === 'Settings'))
        await page.click('#btnLang')
        await H.waitFor(page, '壳层切回中文', async p =>
          p.evaluate(() => document.getElementById('btnSettingsT').textContent.trim() === '设置'))
        H.t('再点切回中文：设置按钮「设置」+ 语言钮文字「中文」', await page.evaluate(() =>
          localStorage.getItem('dsh-notes-lang') === 'zh' && document.querySelector('#btnLang .tb-t').textContent.trim() === '中文'))
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '03-lang-topbar-en.png')
      })
    } finally { await page.context().close() }
  },
}
