'use strict'
/* 0.4.8 用例㊶（notes-048-wiki-autocomplete）client 面板真机锁（panel-harness 装载发布版 lib/client.js）：
 * 源码模式 [[ 双链输入补全——触发/↓ 导航不误触列表/Enter 插入 [[id]] 闭合 + 光标落括号后/Esc 零副作用/零命中空态/点外关闭。
 * 桩数据：默认种子 + 1 条「面板补全目标页」（标题子串过滤目标）。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊶ 面板双链 [[ 输入补全（源码模式）：触发/导航/插入闭合/Esc/空态/点外',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {
      seed(state) {
        state.notes.unshift({
          id: 'pn-target-1', title: '面板补全目标页', body: '目标页正文',
          topic: '', kind: 'note', tags: [], status: 'active', pinned: false, inject: false, injectRole: '',
          injectTo: [], recall: true, folder: '', useCount: 0, contractType: '',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false,
        })
      },
    })
    try {
      await H.step(h.page, '41-panel-wiki-autocomplete', async () => {
        await h.openPanel()
        /* 打开种子笔记 B（源码模式缺省），等正文加载落定 */
        await h.page.evaluate(() => {
          const rows = document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row')
          for (const r of rows) if (r.textContent.indexOf('e2e 种子笔记 B') >= 0) { r.click(); return }
        })
        await H.waitFor(h.page, '编辑器打开种子笔记 B（textarea 落定回填）', async () =>
          h.page.evaluate(() => { const t = document.querySelector('.dsh-notes-ed-body'); return !!t && !t.readOnly && t.value.indexOf('种子正文 B') >= 0 }))
        await h.page.evaluate(() => { const t = document.querySelector('.dsh-notes-ed-body'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) })

        /* ===== ① 触发 + 导航（不误触列表导航） ===== */
        await h.page.keyboard.type('[[')
        await H.waitFor(h.page, '输入 [[ 弹出补全下拉', async () =>
          h.page.evaluate(() => !!document.querySelector('.dsh-notes-wiki-ac .dsh-notes-wiki-ac-item')))
        H.t('① [[ 触发补全下拉（候选行渲染）', true)
        const navProbe = async () => h.page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('.dsh-notes-wiki-ac-item'))
          const focused = document.querySelector('.dsh-notes-note-row.focused')
          return { n: items.length, onIdx: items.findIndex(r => r.classList.contains('on')), focusTxt: focused ? focused.textContent : null }
        })
        const s0 = await navProbe()
        H.t('① 空 query 全量候选（≤8）+ 首行默认选中', s0.n >= 2 && s0.n <= 8 && s0.onIdx === 0)
        await h.page.keyboard.press('ArrowDown')
        const s1 = await navProbe()
        H.t('① ↓ 导航选中行下移', s1.onIdx === 1)
        H.t('① 下拉开时 ↓ 不误触列表导航（树焦点行不动）', s1.focusTxt === s0.focusTxt)

        /* ===== ② 过滤 + Enter 插入 [[id]] 闭合 ===== */
        await h.page.keyboard.type('补全目标')
        await H.waitFor(h.page, 'query「补全目标」过滤至 1 条', async () =>
          h.page.evaluate(() => document.querySelectorAll('.dsh-notes-wiki-ac-item').length === 1))
        H.t('② 标题子串过滤命中目标页', await h.page.evaluate(() => {
          const r = document.querySelector('.dsh-notes-wiki-ac-item')
          return !!r && r.textContent.indexOf('面板补全目标页') >= 0 && r.textContent.indexOf('pn-target-1') >= 0
        }))
        await h.page.keyboard.press('Enter')
        await H.waitFor(h.page, 'Enter 选中后下拉关闭', async () => h.page.evaluate(() => !document.querySelector('.dsh-notes-wiki-ac')))
        const ins = await h.page.evaluate(() => { const t = document.querySelector('.dsh-notes-ed-body'); return { value: t.value } })
        H.t('② Enter 插入 [[id]] 并闭合（正文尾部 [[pn-target-1]]）', ins.value.indexOf('[[pn-target-1]]') >= 0, () => ins.value.slice(-40))
        await H.waitFor(h.page, '光标复位落闭合括号后（60ms later 回填）', async () =>
          h.page.evaluate(() => { const t = document.querySelector('.dsh-notes-ed-body'); return t.selectionStart === t.value.indexOf('[[pn-target-1]]') + '[[pn-target-1]]'.length }))
        H.t('② 插入后光标落闭合括号后（红线）', true)

        /* ===== ③ Esc 零副作用关闭 ===== */
        await h.page.keyboard.type('[[')
        await H.waitFor(h.page, '再次 [[ 重开下拉', async () => h.page.evaluate(() => !!document.querySelector('.dsh-notes-wiki-ac')))
        const beforeEsc = await h.page.evaluate(() => ({ v: document.querySelector('.dsh-notes-ed-body').value, q: (document.querySelector('.dsh-notes-quick-input') || {}).value || null }))
        await h.page.keyboard.press('Escape')
        await H.waitFor(h.page, 'Esc 关闭下拉', async () => h.page.evaluate(() => !document.querySelector('.dsh-notes-wiki-ac')))
        const afterEsc = await h.page.evaluate(() => ({
          v: document.querySelector('.dsh-notes-ed-body').value,
          q: (document.querySelector('.dsh-notes-quick-input') || {}).value || null,
          panelOpen: !!document.querySelector('.dsh-notes-floating'),
        }))
        H.t('③ Esc 零副作用：正文/搜索词不动 + 面板不被误关', afterEsc.v === beforeEsc.v && afterEsc.q === beforeEsc.q && afterEsc.panelOpen)

        /* ===== ④ 零命中空态行（不可选，Enter 穿透仅关下拉） ===== */
        await h.page.keyboard.type('zzzz无匹配')
        await H.waitFor(h.page, '零命中空态行出现', async () => h.page.evaluate(() => !!document.querySelector('.dsh-notes-wiki-ac-empty')))
        H.t('④ 零命中渲染空态行且无候选行', await h.page.evaluate(() =>
          !!document.querySelector('.dsh-notes-wiki-ac-empty') && document.querySelectorAll('.dsh-notes-wiki-ac-item').length === 0))
        await h.page.keyboard.press('Enter')
        await H.waitFor(h.page, '空态 Enter 后下拉关闭 + 换行落定', async () => h.page.evaluate(() =>
          !document.querySelector('.dsh-notes-wiki-ac') && document.querySelector('.dsh-notes-ed-body').value.indexOf('[[zzzz无匹配\n') >= 0))
        H.t('④ 空态 Enter 穿透默认行为（插入换行、窗口失配关闭）', true)

        /* ===== ⑤ 点外（blur）关闭 ===== */
        await h.page.evaluate(() => { const t = document.querySelector('.dsh-notes-ed-body'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) })
        await h.page.keyboard.type('[[')
        await H.waitFor(h.page, '三次 [[ 重开下拉', async () => h.page.evaluate(() => !!document.querySelector('.dsh-notes-wiki-ac')))
        await h.page.click('.dsh-notes-ed-title')   /* 焦点移出 textarea → blur 关下拉（不换笔记） */
        await H.waitFor(h.page, '点外（标题框）后下拉关闭', async () => h.page.evaluate(() => !document.querySelector('.dsh-notes-wiki-ac')))
        H.t('⑤ 点外关闭（blur 纪律）', true)

        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '41-panel-wiki-autocomplete')
      })
    } finally { await h.close() }
  },
}
