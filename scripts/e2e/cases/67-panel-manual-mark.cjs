'use strict'
/* 文档安全 S6 用例（notes-052-manual-mark-entries，反馈 n-mv3emwhuy2k6）面板（client）选区手动标记三入口行为级（panel-harness 发布版 bundle）：
 * ① meta 行动区 🛡 钮（.dsh-notes-secret-mark）双模式恒可见——面板唯一恒可见手动标记入口；
 * ② 无选区点击 → toast 引导「先选中要标记为机密的文字」（有选区才亮口径的可达兜底）；
 * ③ 入口①（🛡 钮）：源码 textarea 中线选区（字符级）→ 行粒度包 ```secret fence（内核 wrapSecretLines——既有面板标记路径，
 *   顶格 fence 恒落遮蔽块）+ 遮蔽块在案 + 渲染文本层零机密 + toast「已标记为机密」+ notes-update RPC 参数锁；
 * ④ 入口③（Ctrl+Shift+S，面板 hotkey）：选区 → Control+Shift+s → 行包 fence（edSecretFocusRef 焦点闸——textarea 焦点内生效）；
 * ⑤ 入口②（编辑器右键菜单）：有选区才拦原生菜单 → 「标记为机密」单项 → 执行快照闭包里的选区；Esc 关菜单（Esc 栈收编）；
 * ⑥ 防双标：选区全落既有机密 span 内 → toast「所选内容已在机密区内」+ 正文零改写。
 * 隔离纪律：seed 承载（mountPanel 独立 context + 独立 mock state，finally close）。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '面板手动标记三入口（meta 🛡 钮 / Ctrl+Shift+S / 右键菜单——选区标为机密 + 防双标 + Esc 栈）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {
      seed(state) {
        state.notes.push({
          id: 'e2e-manual-67', title: '67 面板手动标记', kind: 'note', topic: '',
          body: '公开行67\nTOKEN = PANELSEL-6742\n公开尾行67',
          tags: [], status: 'active', inject: false, injectEver: false, injectRole: 'convention', injectTo: [],
          recall: true, sensitive: false, hidden: false, workspace: 'e2e-workspace', folder: '', sessionId: '',
          cwd: '', logDate: '', entities: [], summarizedAt: '', contractType: '', origin: '', schedule: null,
          mergedFrom: [], dispatches: [], refNote: '', runLog: '', useCount: 0, archivedAt: '',
          createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', deleted: false,
        })
      },
    })
    try {
      await H.step(h.page, '67-panel-manual-mark', async () => {
        await h.openPanel()
        await h.page.click('.dsh-notes-tree .dsh-notes-note-row[data-note="e2e-manual-67"]')
        await H.waitFor(h.page, '编辑器源码模式落定（textarea 含真原文 + meta 🛡 钮在场）', async p => p.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var btn = document.querySelector('.dsh-notes-ed-meta .dsh-notes-secret-mark')
          return !!(ta && ta.value.indexOf('PANELSEL-6742') >= 0 && btn && btn.textContent.indexOf('\uD83D\uDEE1') >= 0)
        }))
        H.t('① meta 行动区 🛡 钮在场（.dsh-notes-secret-mark，双模式恒可见——面板唯一恒可见手动标记入口）', true)

        /* ===== ② 无选区点击 → toast 引导 ===== */
        await h.page.click('.dsh-notes-ed-meta .dsh-notes-secret-mark')
        H.t('② 无选区点击 🛡：toast 引导「先选中要标记为机密的文字」（applyPanelSecretSel(null) 分支）', await h.page.evaluate(() => {
          var tp = document.querySelector('.dsh-notes-toast')
          return !!(tp && tp.classList.contains('show') && tp.textContent.indexOf('先选中要标记为机密的文字') >= 0)
        }), () => 'toast missing')

        /* ===== ③ 入口①（🛡 钮）：中线字符级选区 → 行粒度包 fence ===== */
        await h.page.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var s = ta.value.indexOf('PANELSEL-6742')
          ta.focus(); ta.setSelectionRange(s, s + 8)   // 中线选区（字符级）——行粒度落整行 fence
        })
        await h.page.click('.dsh-notes-ed-meta .dsh-notes-secret-mark')
        await H.waitFor(h.page, '行 2 包 fence（TOKEN 行整行入栏）+ 遮蔽块在案 + 渲染文本层零机密', async p => p.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var layer = document.querySelector('.dsh-notes-src-veil')
          return !!(ta && ta.value.indexOf('\x60\x60\x60secret\nTOKEN = PANELSEL-6742\n\x60\x60\x60') >= 0
            && ta.value.indexOf('公开行67') >= 0 && ta.value.indexOf('公开尾行67') >= 0
            && layer && layer.querySelectorAll('.src-secret-veil').length === 1
            && layer.textContent.indexOf('PANELSEL-6742') < 0
            && layer.textContent.indexOf('点击揭示') >= 0)
        }))
        H.t('③ 🛡 钮：中线字符级选区 → 整行包 ```secret fence（wrapSecretLines 行粒度——顶格恒落遮蔽块）+ 内容字节保留 + 渲染文本层零机密', true)
        await h.page.waitForTimeout(2400)   /* 900ms 防抖 + RPC 回程：给自动保存一个完整窗口 */
        const updCall = h.rpcCalls.find(c => c.method === 'notes-update' && c.args && c.args.id === 'e2e-manual-67' && typeof c.args.body === 'string' && c.args.body.indexOf('\x60\x60\x60secret') >= 0)
        H.t('③ 自动保存 RPC 参数锁：notes-update {id, body} body 含 ```secret fence（既有自动保存链路承载）', !!updCall, () => 'rpc body missing')
        await H.screenshot(h.page, '67-panel-manual-mark-button')

        /* ===== ④ 入口③（Ctrl+Shift+S）：textarea 焦点内选区 → 行包 fence ===== */
        await h.page.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var s = ta.value.indexOf('公开尾行67')
          ta.focus(); ta.setSelectionRange(s, s + 5)   // 末行中线选区
        })
        await h.page.keyboard.press('Control+Shift+s')
        await H.waitFor(h.page, '行 3 包 fence（遮蔽块 ×2）', async p => p.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var layer = document.querySelector('.dsh-notes-src-veil')
          return !!(ta && ta.value.indexOf('\x60\x60\x60secret\n公开尾行67\n\x60\x60\x60') >= 0
            && layer && layer.querySelectorAll('.src-secret-veil').length === 2)
        }))
        H.t('④ Ctrl+Shift+S：面板编辑器焦点内选区 → 行包 fence（hotkey 焦点闸——事件目标在 textarea 内）', true)

        /* ===== ⑤ 入口②（右键菜单）：有选区才拦 + 执行快照闭包 + Esc 栈收编 ===== */
        // 右键落点纪律：选顶部 padding 带（y=8——遮蔽块只覆内容行 ≥14px 且 pointer-events:auto 会截胡命中测试，
        // 落 textarea 中心 = elementFromPoint 返回遮蔽块 → Playwright actionability 永等不到 textarea 收事件）
        const VEIL_SAFE_POS = { x: 30, y: 8 }
        await h.page.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var s = ta.value.indexOf('公开行67')
          ta.focus(); ta.setSelectionRange(s, s + 4)
        })
        await h.page.click('.dsh-notes-ed-body', { button: 'right', position: VEIL_SAFE_POS })
        await h.page.waitForSelector('.dsh-notes-ctxmenu', { timeout: 8000 })
        H.t('⑤ 右键出菜单（有选区才拦原生菜单）：单项「标记为机密」在案', await h.page.evaluate(() => {
          var m = document.querySelector('.dsh-notes-ctxmenu')
          return !!(m && m.textContent.indexOf('标记为机密') >= 0 && m.querySelectorAll('.dsh-notes-ctxmenu-item').length === 1)
        }))
        await h.page.keyboard.press('Escape')   /* 先验证 Esc 栈收编 */
        await H.waitFor(h.page, 'Esc 关菜单（edSecretCtxRef Esc 栈分支）', async p => p.evaluate(() => !document.querySelector('.dsh-notes-ctxmenu')))
        H.t('⑤ Esc 关菜单（keydown Esc 栈经 kernel setEdSecretCtx 别名收编）', true)
        await h.page.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var s = ta.value.indexOf('公开行67')
          ta.focus(); ta.setSelectionRange(s, s + 4)
        })
        await h.page.click('.dsh-notes-ed-body', { button: 'right', position: VEIL_SAFE_POS })
        await h.page.waitForSelector('.dsh-notes-ctxmenu', { timeout: 8000 })
        await h.page.click('.dsh-notes-ctxmenu .dsh-notes-ctxmenu-item')
        await H.waitFor(h.page, '菜单点击执行快照闭包里的选区（行 1 包 fence，遮蔽块 ×3）', async p => p.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var layer = document.querySelector('.dsh-notes-src-veil')
          return !!(ta && ta.value.indexOf('\x60\x60\x60secret\n公开行67\n\x60\x60\x60') >= 0
            && layer && layer.querySelectorAll('.src-secret-veil').length === 3
            && !document.querySelector('.dsh-notes-ctxmenu'))
        }))
        H.t('⑤ 右键菜单「标记为机密」：contextmenu 时刻选区快照入闭包（菜单点击吞选区后仍执行）+ 点选后菜单自关', true)
        await H.screenshot(h.page, '67-panel-manual-mark-all-three')

        /* ===== ⑥ 防双标：选区全落既有机密 span 内 → toast「所选内容已在机密区内」+ 零改写 ===== */
        const beforeVal = await h.page.evaluate(() => document.querySelector('.dsh-notes-ed-body').value)
        await h.page.evaluate(() => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var s = ta.value.indexOf('PANELSEL-6742')
          ta.focus(); ta.setSelectionRange(s, s + 6)   // 选区全在既有 fence 内
        })
        await h.page.click('.dsh-notes-ed-meta .dsh-notes-secret-mark')
        const guard = await h.page.evaluate((bv) => {
          var ta = document.querySelector('.dsh-notes-ed-body')
          var tp = document.querySelector('.dsh-notes-toast')
          return { toast: !!(tp && tp.classList.contains('show') && tp.textContent.indexOf('所选内容已在机密区内') >= 0), unchanged: ta.value === bv }
        }, beforeVal)
        H.t('⑥ 防双标：选区全落既有机密 span → toast「所选内容已在机密区内」+ 正文逐字节零改写（fence 嵌套防御）',
          guard.toast === true && guard.unchanged === true, () => JSON.stringify(guard))

        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
      })
    } finally { await h.close() }
  },
}
