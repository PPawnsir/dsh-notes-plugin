'use strict'
/* 0.5.0 P0-2 用例㊾（notes-050-wasm-shape）client 面板 bge 构建按钮禁用 + 提示（panel-harness 装载发布版 lib/client.js）：
 * ① 打开语义总开关（bge）→ 构建按钮 bge 态 disabled + tooltip 提示「嵌入只在笔记 app 页运行（wasm）」；
 * ② 开关自动回填路径（doSemBuild 兜底）不发起 notes-vectors-rebuild（零 rebuild RPC 录制）+ 无 sticky 报错（灭「只在浏览器端运行」快速失败死胡同）。
 * 隔离纪律：seed 语义关 + bge；finally 关 panel harness。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊾ 面板 0.5.0 P0-2 bge 构建按钮禁用 + 提示（client 发布版 lib/client.js）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, { seed: (state) => { state.settings.semantic = { enabled: false, backend: 'bge-small-zh-q8' } } })
    try {
      await H.step(h.page, '58-panel-model-proxy', async () => {
        await h.openPanel()
        await h.page.click('.dsh-notes-fbtn:has-text("设置")')
        await h.page.waitForSelector('.dsh-notes-settings-rail-item', { timeout: 8000 })
        await H.waitFor(h.page, '语义节渲染（构建按钮在案）', async () => h.page.evaluate(() => !!document.querySelector('.dsh-notes-settings-sem .dsh-notes-settings-clear')))

        /* ===== ① 打开语义总开关（bge）→ 构建按钮 bge 态 disabled + tooltip 提示 ===== */
        await h.page.click('.dsh-notes-settings-sem .dsh-notes-settings-check')
        await H.waitFor(h.page, '开关打开 + 构建按钮 bge 态 disabled', async () => h.page.evaluate(() => {
          const b = document.querySelector('.dsh-notes-settings-sem .dsh-notes-settings-clear')
          const chk = document.querySelector('.dsh-notes-settings-sem .dsh-notes-settings-check')
          return !!(chk && chk.checked === true && b && b.disabled === true)
        }), 15000)
        const btn = await h.page.evaluate(() => {
          const b = document.querySelector('.dsh-notes-settings-sem .dsh-notes-settings-clear')
          return { disabled: b ? b.disabled : null, tip: b ? (b.getAttribute('data-tooltip') || '') : '' }
        })
        H.t('① 面板 bge 构建按钮 disabled（开关已开仍禁用）+ tooltip 提示「嵌入只在笔记 app 页运行（wasm）」',
          btn.disabled === true && btn.tip.indexOf('app 页') >= 0, () => JSON.stringify(btn))

        /* ===== ② 开关自动回填路径：零 notes-vectors-rebuild RPC + 无 sticky 报错 ===== */
        const rebuildCalls = h.rpcCalls.filter(c => c.method === 'notes-vectors-rebuild').length
        const errState = await h.page.evaluate(() => {
          const e = document.querySelector('.dsh-notes-dispatch-err')
          return { text: e ? e.textContent : '' }
        })
        H.t('② bge 开关自动回填不发 RPC（零 notes-vectors-rebuild）+ 无 sticky 报错（灭快速失败死胡同）',
          rebuildCalls === 0 && errState.text.indexOf('构建索引失败') < 0, () => JSON.stringify({ rebuildCalls, err: errState.text }))
        await H.screenshot(h.page, '58-panel-model-proxy')
      })
    } finally {
      await h.close()
    }
  },
}
