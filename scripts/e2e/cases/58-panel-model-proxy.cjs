'use strict'
/* 0.5.0 R2 用例㊾（notes-051-save-embed）client 面板构建按钮复活（panel-harness 装载发布版 lib/client.js）：
 * ① 打开语义总开关（bge）→ 构建按钮不再 disabled（P0-2 禁用态退役——bge 已迁回 host）+ tooltip 回通用说明（「请到 app 页构建」提示退役）；
 * ② 开关自动回填 = 发起 notes-vectors-rebuild（RPC 录制 backend=bge——0.5.0 R2 起面板/app 双端同调 host rebuild）→
 *   无 sticky 报错 + 状态行「N/M 篇」（mock rebuild 真跑回填）。
 * 隔离纪律：seed 语义关 + bge；finally 关 panel harness。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊾ 面板 0.5.0 R2 构建按钮复活：bge 态可点 + 自动回填调 host rebuild（client 发布版 lib/client.js）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, { seed: (state) => { state.settings.semantic = { enabled: false, backend: 'bge-small-zh-q8' } } })
    try {
      await H.step(h.page, '58-panel-model-proxy', async () => {
        await h.openPanel()
        await h.page.click('.dsh-notes-fbtn:has-text("设置")')
        await h.page.waitForSelector('.dsh-notes-settings-rail-item', { timeout: 8000 })
        await H.waitFor(h.page, '语义节渲染（构建按钮在案）', async () => h.page.evaluate(() => !!document.querySelector('.dsh-notes-settings-sem .dsh-notes-settings-clear')))

        /* ===== ① 打开语义总开关（bge）→ 构建按钮复活（不再 disabled）+ tooltip 退役 ===== */
        await h.page.click('.dsh-notes-settings-sem .dsh-notes-settings-check')
        await H.waitFor(h.page, '开关打开 + 构建按钮 bge 态可点（复活）', async () => h.page.evaluate(() => {
          const b = document.querySelector('.dsh-notes-settings-sem .dsh-notes-settings-clear')
          const chk = document.querySelector('.dsh-notes-settings-sem .dsh-notes-settings-check')
          return !!(chk && chk.checked === true && b && b.disabled === false)
        }), 15000)
        const btn = await h.page.evaluate(() => {
          const b = document.querySelector('.dsh-notes-settings-sem .dsh-notes-settings-clear')
          return { disabled: b ? b.disabled : null, tip: b ? (b.getAttribute('data-tooltip') || '') : '' }
        })
        H.t('① 面板 bge 构建按钮复活（开关打开后可点）+ tooltip 退役（无「到 app 页构建」提示）',
          btn.disabled === false && btn.tip.indexOf('app 页') < 0 && btn.tip.length > 0, () => JSON.stringify(btn))

        /* ===== ② 开关自动回填 = 发起 notes-vectors-rebuild（RPC 录制 backend=bge）+ 无 sticky 报错 + 状态行 N/M 篇 ===== */
        await H.waitFor(h.page, '自动回填完成：状态行「N/M 篇」', async () => h.page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('.dsh-notes-settings-sem .dsh-notes-settings-label-s'))
          return rows.some(r => /\d+\/\d+ 篇/.test(r.textContent || ''))
        }), 15000)
        const rebuildCalls = h.rpcCalls.filter(c => c.method === 'notes-vectors-rebuild')
        const errState = await h.page.evaluate(() => {
          const e = document.querySelector('.dsh-notes-dispatch-err')
          return { text: e ? e.textContent : '' }
        })
        H.t('② 开关自动回填调 host notes-vectors-rebuild（RPC 录制 backend=bge——双端同路由）',
          rebuildCalls.length >= 1 && rebuildCalls.every(c => !c.args || c.args.backend === 'bge-small-zh-q8'), () => JSON.stringify(rebuildCalls))
        H.t('② host rebuild 真跑成功：无 sticky 报错 + 状态行「N/M 篇」（存量回填）',
          errState.text.indexOf('构建索引失败') < 0, () => JSON.stringify({ err: errState.text }))
        await H.screenshot(h.page, '58-panel-model-proxy')
      })
    } finally {
      await h.close()
    }
  },
}
