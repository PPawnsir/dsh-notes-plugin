'use strict'
/* 0.5.0 P0 用例㊾（notes-050-model-proxy）client 面板构建失败 sticky 报错（panel-harness 装载发布版 lib/client.js）：
 * ① 打开语义总开关（bge）→ 自动 rebuild 在 mock 侧 hostEmbed:false 快速失败 → sticky 报错条（.dsh-notes-dispatch-err）含「构建索引失败」原因；
 * ② 显式再点「构建索引」→ 开始前清驻留、失败再重写 sticky（按钮不静默跳回按钮态）。
 * 隔离纪律：seed 语义关 + bge；finally 关 panel harness。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊾ 面板 0.5.0 P0 构建失败 sticky 报错（client 发布版 lib/client.js）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, { seed: (state) => { state.settings.semantic = { enabled: false, backend: 'bge-small-zh-q8' } } })
    try {
      await H.step(h.page, '58-panel-model-proxy', async () => {
        await h.openPanel()
        await h.page.click('.dsh-notes-fbtn:has-text("设置")')
        await h.page.waitForSelector('.dsh-notes-settings-rail-item', { timeout: 8000 })
        await H.waitFor(h.page, '语义节渲染（构建按钮在案）', async () => h.page.evaluate(() => !!document.querySelector('.dsh-notes-settings-sem .dsh-notes-settings-clear')))

        /* ===== ① 打开语义总开关（bge）→ 自动 rebuild 快速失败 → sticky 报错条 ===== */
        await h.page.click('.dsh-notes-settings-sem .dsh-notes-settings-check')
        await H.waitFor(h.page, '构建失败 sticky 报错条（.dsh-notes-dispatch-err 含「构建索引失败」）', async () => h.page.evaluate(() => {
          const e = document.querySelector('.dsh-notes-dispatch-err')
          return !!(e && e.textContent.indexOf('构建索引失败') >= 0)
        }), 15000)
        const err1 = await h.page.evaluate(() => {
          const e = document.querySelector('.dsh-notes-dispatch-err')
          return { text: e ? e.textContent : '' }
        })
        H.t('① 面板构建失败 sticky 报错条出现且含原因（「构建索引失败：」+ bge 快速失败原因）',
          err1.text.indexOf('构建索引失败') >= 0 && err1.text.indexOf('只在浏览器端运行') >= 0, () => JSON.stringify(err1))

        /* ===== ② 显式再点「构建索引」→ 开始前清驻留、失败再重写 sticky（不静默跳回按钮态） ===== */
        await h.page.click('.dsh-notes-settings-sem .dsh-notes-settings-clear')
        await H.waitFor(h.page, '再次构建失败：sticky 报错条驻留（重写）', async () => h.page.evaluate(() => {
          const e = document.querySelector('.dsh-notes-dispatch-err')
          return !!(e && e.textContent.indexOf('构建索引失败') >= 0)
        }), 15000)
        H.t('② 再次显式构建仍失败：sticky 报错条驻留（按钮不静默跳回按钮态）', true)
        await H.screenshot(h.page, '58-panel-model-proxy')
      })
    } finally {
      await h.close()
    }
  },
}
