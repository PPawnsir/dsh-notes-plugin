'use strict'
/* 0.4.6-A 用例㉖：富文本重开含图+表笔记（notes-046-rich-freeze；UX 巡检 R2 反馈 n-mux892tew6bf 复现素材逐字钉死）。
 * ① 重开链路不冻：含图+表笔记富文本重开三轮——每轮 evaluate 心跳可答（冻页即超时红）+ 表格/图片渲染在场 + 落定绿点；
 * ② 在途窗不冒绿（state._delays 注入 notes-get 2.5s 演习 RPC 尖刺期）：窗内富文本锁编辑 + 空态 + 同步点「正文加载中…」橙点；
 *    落定后回填解锁回绿——现象①「正文空白+假同步绿点」的常驻回归断言；
 * ③ 页内内核性能：归档素材×200 renderMarkdown < 1500ms（无头浏览器余量口径；node 侧 500ms 闸在 check 节 93⑤）。 */
module.exports = {
  name: '㉖ 富文本重开含图+表笔记：重开不冻 + 在途窗锁编辑不冒绿 + 页内内核性能（0.4.6-A）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    const TITLE = 'UXR2 冻结复现 e2e'
    const BODY = '# UXR2 自动保存测试\n\n第一段：验证自动保存延迟与反馈。\n\n第二段：追加输入，观察防抖与连续保存。\n\n![测试图](assets/uxr2-fake.png)\n\na\n\n| 列A | 列B |\n| --- | --- |\n| 1 | 2 |'
    const clickRowByPrefix = (t) => page.evaluate(function (t) {
      var rows = document.querySelectorAll('#tree .note-row')
      for (var i = 0; i < rows.length; i++) if ((rows[i].textContent || '').indexOf(t) === 0) { rows[i].click(); return true }
      return false
    }, t)
    const winState = () => page.evaluate(() => ({
      richLen: (document.querySelector('#edRich') || {}).innerHTML.length,
      editable: (document.querySelector('#edRich') || {}).contentEditable,
      green: !!document.querySelector('#syncPill.ok'),
      pillTxt: (document.querySelector('#syncTxt') || {}).textContent || '',
      hasTable: !!document.querySelector('#edRich table'),
      hasImg: !!document.querySelector('#edRich img'),
    }))
    try {
      await H.step(page, '26-rich-reopen', async () => {
        /* ===== 前置：UI 建含图+表笔记（素材逐字），首开切富文本 ===== */
        await H.createNoteViaUI(page, TITLE, BODY)
        await clickRowByPrefix(TITLE)
        await H.waitFor(page, '首开正文加载（源码态）', async p => p.evaluate(() => ((document.querySelector('#edSrc') || {}).value || '').indexOf('UXR2') >= 0))
        await page.click('#segRich')
        await page.waitForSelector('#edRich table', { timeout: 8000 })
        const first = await winState()
        H.t('首开富文本：表格 + 图片渲染在场，落定绿点「已同步源码」', first.hasTable && first.hasImg && first.green && first.editable === 'true', () => JSON.stringify(first))

        /* ===== ① 富文本重开三轮：全程心跳可答（evaluate 即心跳，冻页 → waitFor 超时红） ===== */
        for (let rd = 1; rd <= 3; rd++) {
          await clickRowByPrefix('e2e 种子笔记 A')
          await H.waitFor(page, '第' + rd + '轮切走落定', async p => p.evaluate(() => ((document.querySelector('#edSrc') || {}).value || '').indexOf('种子正文 A') >= 0))
          await clickRowByPrefix(TITLE)
          await H.waitFor(page, '第' + rd + '轮重开富文本回填（表格在场）', async p => p.evaluate(() => !!document.querySelector('#edRich table') && (document.querySelector('#edRich') || {}).innerHTML.length > 300))
          const st = await winState()
          H.t('第' + rd + '轮重开：不冻且富文本完整（表格+图片+绿点+可编辑）', st.hasTable && st.hasImg && st.green && st.editable === 'true', () => JSON.stringify(st))
        }

        /* ===== ② 在途窗（notes-get 2.5s 尖刺演习）：锁编辑 + 空态 + 橙点加载中；落定回填回绿 ===== */
        state._delays = { 'notes-get': 2500 }
        try {
          await clickRowByPrefix('e2e 种子笔记 A')
          await H.waitFor(page, '尖刺期切走落定', async p => p.evaluate(() => ((document.querySelector('#edSrc') || {}).value || '').indexOf('种子正文 A') >= 0), 15000)
          await clickRowByPrefix(TITLE)
          await H.sleep(300)   /* 在途窗内采样（2.5s 延迟中段） */
          const win = await winState()
          H.t('在途窗：富文本空态锁编辑（不重演「空白可编辑」）', win.richLen === 0 && win.editable === 'false', () => JSON.stringify(win))
          H.t('在途窗：同步点橙点「正文加载中…」不冒绿（假同步根修）', !win.green && win.pillTxt.indexOf('加载中') >= 0, () => JSON.stringify(win))
          await H.waitFor(page, '尖刺落定回填（表格在场 + 解锁 + 回绿）', async p => p.evaluate(() => {
            var r = document.querySelector('#edRich')
            return !!r && !!r.querySelector('table') && r.contentEditable === 'true' && !!document.querySelector('#syncPill.ok')
          }), 15000)
          H.t('在途窗落定：回填 + 解锁 + 同步点回绿', true)
        } finally { delete state._delays['notes-get'] }

        /* ===== ③ 页内内核性能闸（渲染管线页内计时） ===== */
        const perf = await page.evaluate((md) => {
          var big = []; for (var i = 0; i < 200; i++) big.push(md)
          var t0 = performance.now()
          var html = renderMarkdown(big.join('\n\n'), function () { return null })
          return { ms: Math.round(performance.now() - t0), len: html.length }
        }, BODY)
        H.t('页内内核性能：归档素材×200 renderMarkdown < 1500ms（实测 ' + perf.ms + 'ms）', perf.ms < 1500 && perf.len > 1000, () => JSON.stringify(perf))

        H.t('全程零 console 错误（mock 资产路由 200 下发，无 404 噪音）', (page.__consoleErrors || []).length === 0, () => (page.__consoleErrors || []).join(' | ').slice(0, 300))
        await H.screenshot(page, '26-rich-reopen')
      })
    } finally { await page.context().close() }
  },
}
