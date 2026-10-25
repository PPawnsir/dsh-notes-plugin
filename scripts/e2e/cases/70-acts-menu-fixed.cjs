'use strict';
/* notes-068-acts-menu-fixed（反馈 n-mvn7wk4q5i47）⋯ 溢出菜单 fixed 定位真机锁：
 * ①常态（编辑器列宽绰）：开菜单 → getBoundingClientRect 右缘对齐触发钮右缘（观感回归）；
 * ②折行最左端：.ed-meta 强制窄宽（mock 折行）令 ⋯ 落编辑器列最左 → 开菜单 → 菜单左缘 ≥ 编辑器列左缘（不被树栏遮蔽/裁切）；
 * ③外点收拢 + 点菜收拢回归（开合语义零改动）。
 * 隔离纪律：自带新建 sessionId 笔记（6 动作触发封板）+ 窄宽覆写 finally 复位（state 全 runner 共享）。 */
module.exports = {
  name: '70. ⋯ 溢出菜单 fixed 定位（notes-068-acts-menu-fixed：折行最左端不被树栏遮蔽）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    const rpc = (method, args) => page.evaluate(({ method, args }) =>
      fetch('/dsh-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) }).then(r => r.json()),
      { method, args })
    try {
      await H.step(page, '70-acts-menu-fixed', async () => {
        const sidNote = await rpc('notes-create', { title: 'e2e 70溢出fixed', body: '溢出菜单 fixed 定位演习正文', sessionId: 'sess-e2e-70fix' })
        await page.evaluate(() => loadNotes(true))
        await H.waitFor(page, '树中出现演习笔记', async p =>
          p.evaluate(() => document.querySelector('#tree').textContent.indexOf('e2e 70溢出fixed') >= 0))
        await page.evaluate(() => { var rows = document.querySelectorAll('#tree .note-row'); for (var i = 0; i < rows.length; i++) if (rows[i].textContent.indexOf('e2e 70溢出fixed') >= 0) { rows[i].click(); return } })
        await H.waitFor(page, '6 动作态：溢出触发钮出现', async p => p.evaluate(() => !!document.querySelector('#mActsMore')))

        /* ===== ①常态（视口拉宽令行动区不折行）：右缘对齐钮右缘（fixed 后观感回归） ===== */
        await page.setViewportSize({ width: 1700, height: 950 })   /* 默认视口下行动区本就折行（⋯ 落左）——常态右对齐需宽视口 */
        await H.waitFor(page, '宽视口布局稳定（⋯ 钮右位）', async p =>
          p.evaluate(() => { var b = document.querySelector('#mActsMore'), ed = document.querySelector('.ed'); return b.getBoundingClientRect().left - ed.getBoundingClientRect().left > 200 }))
        await page.click('#mActsMore')
        await H.waitFor(page, '溢出菜单展开', async p =>
          p.evaluate(() => { var m = document.querySelector('#mActsMenu'); return m && m.style.display !== 'none' }))
        const normalDiag = await page.evaluate(() => {
          var m = document.querySelector('#mActsMenu'), b = document.querySelector('#mActsMore')
          var mr = m.getBoundingClientRect(), br = b.getBoundingClientRect()
          return JSON.stringify({ pos: getComputedStyle(m).position, disp: m.style.display, mr: { l: mr.left, r: mr.right, t: mr.top, w: mr.width }, br: { l: br.left, r: br.right, b: br.bottom }, inline: { l: m.style.left, t: m.style.top } })
        })
        const normalOk = await page.evaluate(() => {
          var m = document.querySelector('#mActsMenu'), b = document.querySelector('#mActsMore')
          var mr = m.getBoundingClientRect(), br = b.getBoundingClientRect()
          return getComputedStyle(m).position === 'fixed' && Math.abs(mr.right - br.right) <= 1.5 && mr.top >= br.bottom - 1
        })
        if (!normalOk) console.log('  [diag ①]', normalDiag)
        H.t('①常态菜单 fixed 定位 + 右缘对齐钮右缘（观感回归）', normalOk)

        /* ===== ②折行最左端：强制窄宽令 ⋯ 折行落编辑器列最左 → 翻转后菜单左缘 ≥ 编辑器列左缘 ===== */
        await page.evaluate(() => { document.body.click() })   /* 先收拢（外点） */
        await page.evaluate(() => {
          var ed = document.querySelector('.ed'); ed.style.maxWidth = '300px'   /* mock 折行：⋯ 换行落编辑器列最左 */
        })
        await page.evaluate(() => { document.querySelector('#mActsMore').click() })
        await H.waitFor(page, '窄宽态菜单展开', async p =>
          p.evaluate(() => { var m = document.querySelector('#mActsMenu'); return m && m.style.display !== 'none' }))
        const wrapOk = await page.evaluate(() => {
          var m = document.querySelector('#mActsMenu'), ed = document.querySelector('.ed'), b = document.querySelector('#mActsMore')
          var mr = m.getBoundingClientRect(), er = ed.getBoundingClientRect(), br = b.getBoundingClientRect()
          var wouldLeft = br.right - mr.width   /* 若不翻转（右对齐）会落到的左缘 */
          var flipApplied = wouldLeft < Math.max(er.left, 8) ? (mr.left >= br.left - 1 && mr.left >= 8) : true   /* 越界场景必须已翻转 */
          return mr.left >= er.left - 1 && mr.left >= 8 && mr.width > 0 && flipApplied   /* 菜单左缘不探出编辑器列（不被树栏遮蔽） */
        })
        H.t('②折行最左端：菜单左缘 ≥ 编辑器列左缘（fixed 脱离 .ed 裁切，不再被树栏遮蔽）', wrapOk)
        await page.evaluate(() => { var ed = document.querySelector('.ed'); ed.style.maxWidth = '' })

        /* ===== ③开合语义回归：外点收拢 + 点菜收拢（② 末菜单仍开——先外点收拢） ===== */
        await page.evaluate(() => document.body.click())   /* 外点（body 直点不经 stopPropagation 的钮） */
        await H.waitFor(page, '外点收拢', async p => p.evaluate(() => { var m = document.querySelector('#mActsMenu'); return m && m.style.display === 'none' }))
        H.t('③外点收拢回归', await page.evaluate(() => document.querySelector('#mActsMenu').style.display === 'none'))
        await page.evaluate(() => { document.querySelector('#mActsMore').click() })
        await H.waitFor(page, '菜单又开', async p => p.evaluate(() => { var m = document.querySelector('#mActsMenu'); return m && m.style.display !== 'none' }))
        await page.evaluate(() => { document.querySelector('#mActsMenu #mExport').click() })
        H.t('③点菜收拢回归（动作仍可用）', await page.evaluate(() => {
          var m = document.querySelector('#mActsMenu'); return m && m.style.display === 'none' && document.querySelector('#toast').textContent.indexOf('已导出') >= 0
        }))
        await H.screenshot(page, '70-acts-menu-fixed')
      })
    } finally {
      try { await page.evaluate(() => { var ed = document.querySelector('.ed'); if (ed) ed.style.maxWidth = '' }) } catch (e) {}
      await page.context().close()
    }
  },
}
