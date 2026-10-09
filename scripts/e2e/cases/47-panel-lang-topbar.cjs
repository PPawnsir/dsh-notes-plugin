'use strict'
/* 0.4.8 用例㊼（notes-048-lang-topbar）client 面板标题栏语言钮真机锁（panel-harness 装载发布版 lib/client.js）：
 * ① 标题栏「建议」钮后语言钮在案（globe 图标 + 当前语言名「中文」+ tooltip 切换语言；序锁：建议 → 语言 → 帮助）；
 * ② 点击 → 面板文案即时切英（复用 setLang 既有链路：localStorage 'dsh-notes-lang' 持久化 + langStore 广播重渲染）；
 * ③ 设置弹窗语言行下线（17 行、无 language 行、常规组隐身）；
 * ④ 再点切回中文。
 * 隔离纪律：仅写 localStorage 语言偏好（业务零写盘），finally 关 context。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊼ 面板标题栏语言钮：点击两态直切 + 设置卡语言行下线（client）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {})
    try {
      await H.step(h.page, '47-panel-lang-topbar', async () => {
        await h.openPanel()

        /* ===== ① 语言钮在案（序锁 + 图标 + 文字 + tooltip）===== */
        const info = await h.page.evaluate(() => {
          var btns = Array.prototype.slice.call(document.querySelectorAll('.dsh-notes-titlebar-actions .dsh-notes-titlebar-btn'))
          var langBtn = btns.filter(function (b) { return b.textContent.trim() === '中文' })[0]
          return {
            texts: btns.map(function (b) { return b.textContent.trim() }),
            langTip: langBtn ? langBtn.getAttribute('data-tooltip') : null,
            langAria: langBtn ? langBtn.getAttribute('aria-label') : null,
            langIcon: langBtn ? !!langBtn.querySelector('svg') : false,
            brand: document.querySelector('.dsh-notes-titlebar-title').textContent.trim(),
          }
        })
        H.t('① 缺省中文：标题栏语言钮文字「中文」+ globe 图标 + tooltip/aria「切换语言」',
          info.langTip === '切换语言' && info.langAria === '切换语言' && info.langIcon, () => JSON.stringify(info))
        H.t('① 序锁：建议 → 语言（中文）→ 帮助（?）只插入不动他钮',
          info.texts.join('|').indexOf('建议') >= 0 && info.texts.indexOf('建议') < info.texts.indexOf('中文') && info.texts.indexOf('中文') < info.texts.indexOf('?'),
          () => info.texts.join('|'))
        H.t('① 缺省中文：面板品牌「笔记」', info.brand.indexOf('笔记') >= 0, () => info.brand)

        /* ===== ② 点击 → 面板即时切英 ===== */
        await h.page.click('.dsh-notes-titlebar-actions .dsh-notes-titlebar-btn:has-text("中文")')
        await H.waitFor(h.page, '面板切英（品牌 Notes）', async () => h.page.evaluate(() =>
          document.querySelector('.dsh-notes-titlebar-title').textContent.indexOf('Notes') >= 0))
        const enInfo = await h.page.evaluate(() => {
          var btns = Array.prototype.slice.call(document.querySelectorAll('.dsh-notes-titlebar-actions .dsh-notes-titlebar-btn'))
          var langBtn = btns.filter(function (b) { return b.textContent.trim() === 'English' })[0]
          return {
            hasEnglish: !!langBtn,
            langTip: langBtn ? langBtn.getAttribute('data-tooltip') : null,
            suggestEn: btns.some(function (b) { return b.textContent.indexOf('Suggest') >= 0 }),
            archiveEn: btns.some(function (b) { return b.textContent.indexOf('Quick-note merge') >= 0 }),
          }
        })
        H.t('② 切英后：语言钮文字 English + tooltip Switch language', enInfo.hasEnglish && enInfo.langTip === 'Switch language', () => JSON.stringify(enInfo))
        H.t('② 切英后：标题栏文案换英文（Suggest / Quick-note merge）', enInfo.suggestEn && enInfo.archiveEn)
        H.t('② localStorage 持久化 dsh-notes-lang=en', await h.page.evaluate(() => localStorage.getItem('dsh-notes-lang') === 'en'))

        /* ===== ③ 设置弹窗语言行下线 ===== */
        await h.page.click('.dsh-notes-fbtn:has-text("Settings")')
        await h.page.waitForSelector('.dsh-notes-settings-row', { timeout: 8000 })
        await H.waitFor(h.page, '设置卡落定（17 行渲染）', async () => h.page.evaluate(() =>
          document.querySelectorAll('.dsh-notes-settings-list .dsh-notes-settings-row').length === 17))
        const setInfo = await h.page.evaluate(() => {
          var labels = Array.prototype.slice.call(document.querySelectorAll('.dsh-notes-settings-label')).map(function (el) {
            return el.childNodes[0] ? String(el.childNodes[0].textContent).trim() : ''
          })
          return {
            rows: document.querySelectorAll('.dsh-notes-settings-list .dsh-notes-settings-row').length,
            hasLangRow: labels.indexOf('Language') >= 0 || labels.indexOf('语言') >= 0,
            hasGeneral: !!document.querySelector('.dsh-notes-settings-group[data-g="general"]'),
            railFirst: (document.querySelector('.dsh-notes-settings-rail-item') || {}).textContent || '',
          }
        })
        H.t('③ 设置卡 17 行 + 无语言行（Language/语言 label 均缺席）', setInfo.rows === 17 && !setInfo.hasLangRow, () => JSON.stringify(setInfo))
        H.t('③ 常规组空槽隐身（en 态 rail 首项=Search & Injection）', !setInfo.hasGeneral && setInfo.railFirst.indexOf('Search & Injection') >= 0, () => setInfo.railFirst)
        await h.page.click('.dsh-notes-settings-close')
        await H.waitFor(h.page, '设置卡关闭', async () => h.page.evaluate(() => !document.querySelector('.dsh-notes-settings-modal')))

        /* ===== ④ 再点切回中文 ===== */
        await h.page.click('.dsh-notes-titlebar-actions .dsh-notes-titlebar-btn:has-text("English")')
        await H.waitFor(h.page, '面板切回中文（品牌 笔记）', async () => h.page.evaluate(() =>
          document.querySelector('.dsh-notes-titlebar-title').textContent.indexOf('笔记') >= 0))
        H.t('④ 再点切回中文：localStorage=zh + 语言钮文字「中文」', await h.page.evaluate(() =>
          localStorage.getItem('dsh-notes-lang') === 'zh'
          && Array.prototype.slice.call(document.querySelectorAll('.dsh-notes-titlebar-actions .dsh-notes-titlebar-btn')).some(function (b) { return b.textContent.trim() === '中文' })))
        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '47-panel-lang-topbar')
      })
    } finally {
      await h.close()
    }
  },
}
