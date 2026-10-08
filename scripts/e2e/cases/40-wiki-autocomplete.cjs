'use strict'
/* 0.4.8 用例㊵（notes-048-wiki-autocomplete）app 端真机锁：源码模式 [[ 双链输入补全。
 * 触发下拉 → ↑↓ 导航（不误触列表导航）→ Enter 选中插入 [[id]] 闭合 + 光标落括号后
 * → Esc 零副作用关闭 → 零命中空态行（Enter 穿透仅关下拉）→ 点外（blur）关闭。 */
module.exports = {
  name: '㊵ 双链 [[ 输入补全（app 源码模式）：触发/导航/插入闭合/Esc/空态/点外',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '40-wiki-autocomplete', async () => {
        await H.createNoteViaUI(page, 'e2e补全目标页', '目标页正文')
        await H.createNoteViaUI(page, 'e2e补全编辑页', '编辑页正文起点')
        /* 目标页 id（树行 data-note 直读） */
        const targetId = await page.evaluate(() => {
          const rows = document.querySelectorAll('#tree .note-row[data-note]')
          for (let i = 0; i < rows.length; i++) if (rows[i].textContent.indexOf('e2e补全目标页') >= 0) return rows[i].getAttribute('data-note')
          return ''
        })
        H.t('目标页已落库取到 id', !!targetId)
        /* 打开编辑页（源码模式缺省），等正文加载落定 */
        await page.click('#tree .note-row:has-text("e2e补全编辑页")')
        await H.waitFor(page, '编辑页正文加载落定（readOnly 解除 + 正文回填）', async p =>
          p.evaluate(() => { const t = document.querySelector('#edSrc'); return !!t && !t.readOnly && t.value.indexOf('编辑页正文起点') >= 0 }))
        /* 光标归位到文末 */
        await page.evaluate(() => { const t = document.querySelector('#edSrc'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) })

        /* ===== ① 触发 + 导航（且不误触列表导航） ===== */
        await page.keyboard.type('[[')
        await H.waitFor(page, '输入 [[ 弹出补全下拉', async p => p.evaluate(() => !!document.querySelector('.wiki-ac .wiki-ac-item')))
        H.t('① [[ 触发补全下拉（候选行渲染）', true)
        const navProbe = async p => p.evaluate(() => {
          const items = Array.from(document.querySelectorAll('.wiki-ac-item'))
          const focused = document.querySelector('#tree .note-row.focused')
          return {
            n: items.length,
            onIdx: items.findIndex(r => r.classList.contains('on')),
            focusNote: focused ? focused.getAttribute('data-note') : null,
            titles: items.map(r => r.textContent || ''),
          }
        })
        const s0 = await navProbe(page)
        H.t('① 空 query 出全量候选（updatedAt 倒序上限 8）+ 首行默认选中', s0.n >= 2 && s0.n <= 8 && s0.onIdx === 0)
        await page.keyboard.press('ArrowDown')
        const s1 = await navProbe(page)
        H.t('① ↓ 导航选中行下移', s1.onIdx === 1)
        H.t('① 下拉开时 ↓ 不误触列表导航（树焦点行不动）', s1.focusNote === s0.focusNote)
        await page.keyboard.press('ArrowUp')
        const s2 = await navProbe(page)
        H.t('① ↑ 导航回卷首行', s2.onIdx === 0 && s2.focusNote === s0.focusNote)

        /* ===== ② 过滤 + Enter 插入 [[id]] 闭合 ===== */
        await page.keyboard.type('补全目标')
        await H.waitFor(page, 'query「补全目标」过滤至 1 条候选', async p =>
          p.evaluate(() => document.querySelectorAll('.wiki-ac-item').length === 1))
        H.t('② 标题子串过滤命中目标页', await page.evaluate(() => {
          const r = document.querySelector('.wiki-ac-item')
          return !!r && r.textContent.indexOf('e2e补全目标页') >= 0
        }))
        await page.keyboard.press('Enter')
        await H.waitFor(page, 'Enter 选中后下拉关闭', async p => p.evaluate(() => !document.querySelector('.wiki-ac')))
        const insProbe = await page.evaluate(() => {
          const t = document.querySelector('#edSrc')
          return { value: t.value, sel: t.selectionStart }
        })
        H.t('② Enter 插入 [[id]] 并闭合（正文含 [[目标id]]）', insProbe.value.indexOf('[[' + targetId + ']]') >= 0, () => insProbe.value)
        H.t('② 插入后光标落闭合括号后（红线）', insProbe.sel === insProbe.value.indexOf('[[' + targetId + ']]') + ('[[' + targetId + ']]').length, () => 'sel=' + insProbe.sel)
        H.t('② 插入点前文保留（窗口整体替换而非追加）', insProbe.value === '编辑页正文起点[[' + targetId + ']]')

        /* ===== ③ Esc 零副作用关闭 ===== */
        await page.keyboard.type('[[')
        await H.waitFor(page, '再次 [[ 重开下拉', async p => p.evaluate(() => !!document.querySelector('.wiki-ac')))
        const beforeEsc = await page.evaluate(() => ({
          v: document.querySelector('#edSrc').value,
          q: document.querySelector('#q') ? document.querySelector('#q').value : null,
          focus: (document.querySelector('#tree .note-row.focused') || {}).dataset ? document.querySelector('#tree .note-row.focused').getAttribute('data-note') : null,
        }))
        await page.keyboard.press('Escape')
        await H.waitFor(page, 'Esc 关闭下拉', async p => p.evaluate(() => !document.querySelector('.wiki-ac')))
        const afterEsc = await page.evaluate(() => ({
          v: document.querySelector('#edSrc').value,
          q: document.querySelector('#q') ? document.querySelector('#q').value : null,
          focus: document.querySelector('#tree .note-row.focused') ? document.querySelector('#tree .note-row.focused').getAttribute('data-note') : null,
          title: document.querySelector('#edTitle') ? document.querySelector('#edTitle').textContent : '',
        }))
        H.t('③ Esc 零副作用：正文/搜索词/树焦点/选中笔记全不动', afterEsc.v === beforeEsc.v && afterEsc.q === beforeEsc.q && afterEsc.focus === beforeEsc.focus && afterEsc.title === 'e2e补全编辑页')

        /* ===== ④ 零命中空态行（不可选，Enter 穿透仅关下拉） ===== */
        await page.keyboard.type('zzzz无匹配')
        await H.waitFor(page, '零命中空态行出现', async p => p.evaluate(() => !!document.querySelector('.wiki-ac-empty')))
        H.t('④ 零命中渲染空态行且无候选行', await page.evaluate(() =>
          !!document.querySelector('.wiki-ac-empty') && document.querySelectorAll('.wiki-ac-item').length === 0))
        await page.keyboard.press('Enter')
        await H.waitFor(page, '空态 Enter 后下拉关闭 + 换行落定', async p => p.evaluate(() =>
          !document.querySelector('.wiki-ac') && document.querySelector('#edSrc').value.indexOf('[[zzzz无匹配\n') >= 0))
        H.t('④ 空态 Enter 穿透默认行为（插入换行、窗口失配关闭）', true)

        /* ===== ⑤ 点外（blur）关闭 ===== */
        await page.evaluate(() => { const t = document.querySelector('#edSrc'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) })
        await page.keyboard.type('[[')
        await H.waitFor(page, '三次 [[ 重开下拉', async p => p.evaluate(() => !!document.querySelector('.wiki-ac')))
        await page.click('#edTitle')   /* 焦点移出 textarea → blur 关下拉（不换笔记不重建编辑器） */
        await H.waitFor(page, '点外（标题框）后下拉关闭', async p => p.evaluate(() => !document.querySelector('.wiki-ac')))
        H.t('⑤ 点外关闭（blur 纪律）', true)

        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '40-wiki-autocomplete')
      })
    } finally { await page.context().close() }
  },
}
