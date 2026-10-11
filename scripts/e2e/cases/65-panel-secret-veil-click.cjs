'use strict'
/* 文档安全 S6（notes-052-manual-mark-entries 首步·主窗口高优 steer）：面板源码模式遮蔽块点击揭示——行为级复现→回归锁。
 * 背景：用户真机报障——面板（client）源码模式遮蔽块点击纹丝不动（不揭示），app 端正常；S4/S5 面板面只有静态锚，
 * 点击路径从未有行为级测试。本用例补上：真实 bundle（panel-harness 装载发布版 lib/client.js）全链——
 * ① 种子笔记含 ```secret fence → 源码模式遮蔽块在案（不透明遮挡 + 渲染文本层零机密 + textarea 值存真原文）；
 * ② 命中测试诊断：elementFromPoint 落在遮蔽块本体（CSS pointer-events/层序正常——失败时区分「点没接到」vs「接线断」）；
 * ③ 点击 → 揭示（.revealed + visibility:hidden 占位保留——点击穿透编辑；值恒存真红线）；
 * ④ ~10s 自动回蔽（armPanelSecretReveal 计时器单飞——与富文本岛共用同节拍）。
 * 隔离纪律：seed 承载（mountPanel 独立 context + 独立 mock state，finally close）。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '面板源码模式遮蔽块点击揭示（S5 行为级补测：复现→回归锁）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {
      seed(state) {
        state.notes.push({
          id: 'e2e-sec-veil-65', title: '65 面板遮蔽揭示', kind: 'note', topic: '',
          body: '公开开头 65\n\n```secret\nPANELMASK-9931\n机密第二行 65\n```\n\n公开结尾 65',
          tags: [], status: 'active', inject: false, injectEver: false, injectRole: 'convention', injectTo: [],
          recall: true, sensitive: false, hidden: false, workspace: 'e2e-workspace', folder: '', sessionId: '',
          cwd: '', logDate: '', entities: [], summarizedAt: '', contractType: '', origin: '', schedule: null,
          mergedFrom: [], dispatches: [], refNote: '', runLog: '', useCount: 0, archivedAt: '',
          createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', deleted: false,
        })
      },
    })
    try {
      await H.step(h.page, '65-panel-secret-veil-click', async () => {
        await h.openPanel()
        /* ===== ① 选中含机密笔记 → 源码模式遮蔽块在案 ===== */
        await h.page.click('.dsh-notes-tree .dsh-notes-note-row[data-note="e2e-sec-veil-65"]')
        await H.waitFor(h.page, '源码模式落定（textarea 含真围栏原文 + 遮蔽块在案 + 渲染文本层零机密）', async p => p.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var layer = document.querySelector('.dsh-notes-src-veil')
          return !!(ta && ta.value.indexOf('PANELMASK-9931') >= 0 && ta.value.indexOf('\x60\x60\x60secret') >= 0
            && layer && layer.querySelectorAll('.src-secret-veil').length === 1
            && layer.textContent.indexOf('PANELMASK-9931') < 0
            && layer.textContent.indexOf('机密第二行 65') < 0
            && layer.textContent.indexOf('点击揭示') >= 0)
        }))
        H.t('① 源码模式：textarea 值存真围栏原文 + 遮蔽块渲染在案（渲染文本层零机密）', true)
        await H.screenshot(h.page, '65-panel-secret-veil-click-masked')

        /* ===== ② 命中测试诊断：遮蔽块本体可命中（失败时区分 CSS 层序 vs JS 接线断）===== */
        const hitTest = await h.page.evaluate(() => {
          var veil = document.querySelector('.dsh-notes-src-veil .src-secret-veil')
          if (!veil) return null
          var r = veil.getBoundingClientRect()
          var el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20))
          return { hit: !!el && (el === veil || veil.contains(el)), cls: String(veil.className) }
        })
        H.t('② 命中测试：elementFromPoint 落遮蔽块本体（pointer-events/层序正常）', !!(hitTest && hitTest.hit), () => JSON.stringify(hitTest))

        /* ===== ③ 点击 → 揭示（.revealed + visibility:hidden 占位保留；值恒存真）===== */
        await h.page.click('.dsh-notes-src-veil .src-secret-veil')
        await H.waitFor(h.page, '揭示态（.revealed + visibility:hidden 占位保留 + 值恒存真原文）', async p => p.evaluate(() => {
          var veil = document.querySelector('.dsh-notes-src-veil .src-secret-veil')
          var ta = document.querySelector('.dsh-notes-ed-body')
          return !!(veil && veil.classList.contains('revealed')
            && getComputedStyle(veil).visibility === 'hidden'
            && ta && ta.value.indexOf('PANELMASK-9931') >= 0)
        }))
        H.t('③ 点击揭示：.revealed 在案 + visibility:hidden（占位保留·点击穿透编辑）+ 值存真原文（遮蔽纯渲染层红线）', true)
        await H.screenshot(h.page, '65-panel-secret-veil-click-revealed')

        /* ===== ④ ~10s 自动回蔽（计时器单飞——与富文本岛共用）===== */
        await H.waitFor(h.page, '自动回蔽（~10s 计时到点 .revealed 摘除 + 遮蔽块复原）', async p => p.evaluate(() => {
          var veil = document.querySelector('.dsh-notes-src-veil .src-secret-veil')
          return !!(veil && !veil.classList.contains('revealed'))
        }), 13000)
        H.t('④ 自动回蔽：~10s 后揭示态摘除（遮蔽复原——揭示是临时动作）', true)

        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
      })
    } finally { await h.close() }
  },
}
