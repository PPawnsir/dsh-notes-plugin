'use strict'
/* 0.4.7-C 用例㉟：稳定性债（notes-047-stability）常驻回归断言。
 * ②b 源码模式在途窗补锁：notes-get 2.5s 尖刺 → 窗内 #edSrc readOnly + placeholder「正文加载中…」+ 打字不进 → 落定解锁回填；
 * ②a 失败态同步点统一：收窄超时 + notes-get 尖刺 → 失败横幅 + 同步点红点「加载失败」（不滞留橙/冒绿）→ 重试回绿；
 * ① 关闭 flush：源码打字 <900ms 窗口内 page.reload() → beforeunload 兜底 flush（rpcKeepalive）→ 重开正文含最后一击。 */
module.exports = {
  name: '㉟ 稳定性债：源码在途窗锁 + 失败态同步点红点统一 + 关闭 flush（reload 不丢最后一击）（0.4.7-C）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    const T32 = 'e2e ㉟稳定性样本'
    const clickRowByPrefix = (t) => page.evaluate(function (t) {
      var rows = document.querySelectorAll('#tree .note-row')
      for (var i = 0; i < rows.length; i++) if ((rows[i].textContent || '').indexOf(t) === 0) { rows[i].click(); return true }
      return false
    }, t)
    const srcState = () => page.evaluate(() => ({
      ro: (document.querySelector('#edSrc') || {}).readOnly,
      ph: (document.querySelector('#edSrc') || {}).placeholder || '',
      val: (document.querySelector('#edSrc') || {}).value || '',
    }))
    const pillState = () => page.evaluate(() => ({
      cls: (document.querySelector('#syncPill') || {}).className || '',
      txt: (document.querySelector('#syncTxt') || {}).textContent || '',
      richEditable: (document.querySelector('#edRich') || {}).contentEditable,
      banner: (document.querySelector('#edLoadErr') || {}).style.display,
    }))
    try {
      await H.step(page, '35-stability-flush', async () => {
        /* ===== 前置：建专用样本笔记（零耦合种子笔记） ===== */
        await H.createNoteViaUI(page, T32, '35 基底正文')

        /* ===== ②b 源码模式在途窗补锁 ===== */
        state._delays = { 'notes-get': 2500 }
        try {
          await clickRowByPrefix('e2e 种子笔记 A')
          await H.waitFor(page, '尖刺期切走落定（种子 A）', async p => p.evaluate(() => ((document.querySelector('#edSrc') || {}).value || '').indexOf('种子正文 A') >= 0), 15000)
          await clickRowByPrefix(T32)
          await H.sleep(300)   /* 在途窗内采样（2.5s 延迟中段） */
          const win = await srcState()
          H.t('②b 在途窗：源码 textarea 锁只读（旧口径可打字 = 假同步洞）', win.ro === true, () => JSON.stringify(win))
          H.t('②b 在途窗：placeholder「正文加载中…」+ 正文空窗', win.ph.indexOf('加载中') >= 0 && win.val === '', () => JSON.stringify(win))
          await page.click('#edSrc')
          await page.keyboard.type('X')
          const win2 = await srcState()
          H.t('②b 在途窗：打字不进（锁生效）', win2.val === '', () => JSON.stringify(win2))
          await H.waitFor(page, '尖刺落定回填解锁', async p => p.evaluate(() => {
            var ta = document.querySelector('#edSrc')
            return !!ta && ta.readOnly === false && (ta.value || '').indexOf('35 基底正文') >= 0
          }), 15000)
          H.t('②b 落定：解锁 + 正文回填', true)
        } finally { delete state._delays['notes-get'] }

        /* ===== ②a 失败态同步点统一（红点「加载失败」→ 重试回绿） ===== */
        await page.click('#segRich')
        await H.waitFor(page, '富文本切换落定（可编辑 + 绿点）', async p => p.evaluate(() =>
          (document.querySelector('#edRich') || {}).contentEditable === 'true' && !!document.querySelector('#syncPill.ok')))
        await page.evaluate(() => { RPC_TIMEOUT_MS = 300 })   /* 页内收窄超时（同 ㉗ 手法；本页隔离不影响他例） */
        state._delays = { 'notes-get': 3000 }
        try {
          await clickRowByPrefix('e2e 种子笔记 B')
          await H.waitFor(page, '超时 → 失败横幅在窗', async p => p.evaluate(() => {
            var bn = document.querySelector('#edLoadErr')
            return !!bn && bn.style.display !== 'none'
          }), 8000)
          const fail = await pillState()
          H.t('②a 失败态：同步点红点 err（不滞留橙「加载中」/冒绿「已同步」）', fail.cls === 'sync err', () => JSON.stringify(fail))
          H.t('②a 失败态：同步点文案「加载失败」（与横幅同口径）', fail.txt === '加载失败', () => JSON.stringify(fail))
          H.t('②a 失败态：富文本锁编辑（R-1 安全态不动）', fail.richEditable === 'false', () => JSON.stringify(fail))
        } finally {
          delete state._delays['notes-get']
          await page.evaluate(() => { RPC_TIMEOUT_MS = 20000 })
        }
        await page.click('#edLoadRetry')
        await H.waitFor(page, '重试落定（种子 B 回填 + 同步点回绿）', async p => p.evaluate(() =>
          ((document.querySelector('#edSrc') || {}).value || '').indexOf('种子正文 B') >= 0 && !!document.querySelector('#syncPill.ok')), 10000)
        H.t('②a 重试：正文回填 + 同步点回绿「已同步源码」', true)

        /* ===== ① 关闭 flush：reload 窗口 <900ms 不丢最后一击 ===== */
        await clickRowByPrefix(T32)
        await H.waitFor(page, '回样本笔记落定', async p => p.evaluate(() => ((document.querySelector('#edSrc') || {}).value || '').indexOf('35 基底正文') >= 0))
        await page.evaluate(() => { var seg = document.querySelector('.seg[data-m="source"]'); if (seg) seg.click() })   /* 回源码模式（富文本态 #edSrc 隐藏不可 type） */
        await H.waitFor(page, '源码模式就绪', async p => p.evaluate(() => {
          var ta = document.querySelector('#edSrc')
          return !!ta && ta.style.display !== 'none' && ta.readOnly === false
        }))
        await page.click('#edSrc')
        await page.keyboard.press('End')
        const MARK = '·最后一击35'
        await page.keyboard.type(MARK)
        await H.sleep(200)   /* 明确停在 900ms debounce 窗口内 */
        await page.reload({ waitUntil: 'load' })   /* 触发 beforeunload → flushPendingSave → rpcKeepalive */
        await page.waitForSelector('#tree', { timeout: 15000 })
        await clickRowByPrefix(T32)
        await H.waitFor(page, 'reload 后重开正文含最后一击（关闭 flush 已落盘）', async p => p.evaluate(() =>
          ((document.querySelector('#edSrc') || {}).value || '').indexOf('最后一击35') >= 0), 10000)
        H.t('① 关闭 flush：<900ms 在途编辑随 reload 落盘（重开含最后一击）', true)

        H.t('全程零 console 错误（既有路径零回归）', (page.__consoleErrors || []).length === 0, () => (page.__consoleErrors || []).join(' | ').slice(0, 300))
        await H.screenshot(page, '35-stability-flush')
      })
    } finally {
      delete state._delays['notes-get']
      await page.context().close()
    }
  },
}
