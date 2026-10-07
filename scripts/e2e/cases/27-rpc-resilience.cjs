'use strict'
/* 0.4.6-B 用例㉗：RPC 韧性层（notes-046-rpc-resilience；巡检三角色同族「挂起=空白假死」证据的常驻回归断言）。
 * ① 慢请求提示条：notes-list 注入 4s 延迟 → >3s（RPC_SLOW_MS）#rpcSlowBar 出现（非阻塞，不遮罩），落定后消失 + 列表照常抵达；
 * ② 挂起态不空白：延迟窗内树显「加载中…」行（首载不再零提示）；
 * ③ 超时结构化错误：页内收窄 RPC_TIMEOUT_MS=300 + notes-get 3s 延迟 → 选中笔记 → edLoadErr 横幅含「超时」+ toast 可见（不静默）；
 *    撤销延迟后点横幅「重试」→ 正文正常回填（恢复路径零残留）；
 * ④ 既有路径零回归：全程零 console 错误。 */
module.exports = {
  name: '㉗ RPC 韧性层：慢提示条出现/消失 + 挂起加载行 + 超时结构化 error/toast + 重试恢复（0.4.6-B）',
  async run({ base, browser, H, state }) {
    /* ①② 慢列表窗（4s）在导航前注入：首载 loadNotes 挂起期覆盖「加载中行 → 慢提示条 → 落定收条」全链 */
    state._delays = { 'notes-list': 4000 }
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '27-rpc-resilience', async () => {
        /* ===== ② 挂起态：树显「加载中…」（>0s 即有，不等 3s 慢阈） ===== */
        await H.waitFor(page, '首载挂起期树显「加载中…」行', async p => p.evaluate(() =>
          (document.querySelector('#tree') || {}).textContent.indexOf('加载中') >= 0), 6000)
        H.t('挂起态：首载在途窗树显「加载中…」（不再空白零提示）', true)

        /* ===== ① 慢请求提示条：>3s 出现 → 落定消失 ===== */
        await H.waitFor(page, 'RPC_SLOW_MS(3s) 超阈 #rpcSlowBar 出现', async p => p.evaluate(() => {
          const bar = document.querySelector('#rpcSlowBar')
          return !!bar && bar.style.display === 'block' && bar.textContent.indexOf('加载') >= 0
        }), 8000)
        H.t('慢提示条：挂起 >3s 非阻塞提示条出现（连接较慢，仍在加载…）', true)
        /* 非阻塞佐证：提示条在场期间页面交互元件仍可点（pointer-events:none 不遮罩）——直接断言 CSS 口径 */
        const pe = await page.evaluate(() => getComputedStyle(document.querySelector('#rpcSlowBar')).pointerEvents)
        H.t('慢提示条：pointer-events=' + pe + '（不遮罩不阻断操作）', pe === 'none', () => pe)
        await H.waitFor(page, 'notes-list 4s 延迟落定（列表抵达）', async p => p.evaluate(() =>
          (document.querySelector('#tree') || {}).textContent.indexOf('e2e 种子笔记 A') >= 0), 15000)
        await H.waitFor(page, '落定后 #rpcSlowBar 消失', async p => p.evaluate(() => {
          const bar = document.querySelector('#rpcSlowBar')
          return !!bar && bar.style.display === 'none'
        }))
        H.t('慢提示条：全部落定后自动消失', true)
        delete state._delays['notes-list']

        /* ===== ③ 超时结构化错误：收窄超时 + notes-get 3s 尖刺 → 横幅 + toast ===== */
        await page.evaluate(() => { RPC_TIMEOUT_MS = 300 })   /* 页内收窄超时常量（var 顶层 = window 可写；本页隔离不影响他例） */
        state._delays = { 'notes-get': 3000 }
        try {
          await page.evaluate(() => {
            const rows = document.querySelectorAll('#tree .note-row')
            for (let i = 0; i < rows.length; i++) if ((rows[i].textContent || '').indexOf('e2e 种子笔记 A') === 0) { rows[i].click(); return true }
            return false
          })
          await H.waitFor(page, '超时触发：edLoadErr 横幅显式含「超时」（结构化 error 进 R-1 安全态）', async p => p.evaluate(() => {
            const bn = document.querySelector('#edLoadErr')
            return !!bn && bn.style.display !== 'none' && bn.textContent.indexOf('超时') >= 0
          }), 8000)
          H.t('超时：AbortController 中断 → 结构化 error → 正文锁定横幅（含「超时」）', true)
          await H.waitFor(page, '错误 toast 可见（不静默）', async p => p.evaluate(() => {
            const to = document.querySelector('#toast')
            return !!to && to.classList.contains('show') && to.textContent.indexOf('超时') >= 0
          }), 4000)
          H.t('超时：toast 显式告知（不静默）', true)
        } finally {
          delete state._delays['notes-get']
          await page.evaluate(() => { RPC_TIMEOUT_MS = 20000 })   /* 还原缺省口径 */
        }
        /* 恢复路径：横幅「重试」→ 正文正常回填（韧性层零残留） */
        await page.click('#edLoadRetry')
        await H.waitFor(page, '重试后正文回填（种子正文 A）', async p => p.evaluate(() =>
          ((document.querySelector('#edSrc') || {}).value || '').indexOf('种子正文 A') >= 0), 10000)
        const recovered = await page.evaluate(() => ({
          banner: (document.querySelector('#edLoadErr') || {}).style.display,
          srcPh: (document.querySelector('#edSrc') || {}).placeholder || '',
        }))
        H.t('恢复：重试回填正文 + 横幅收起', recovered.banner === 'none', () => JSON.stringify(recovered))

        /* ===== ④ 零回归：零 console 错误 ===== */
        H.t('全程零 console 错误（既有路径零回归）', (page.__consoleErrors || []).length === 0, () => (page.__consoleErrors || []).join(' | ').slice(0, 300))
        await H.screenshot(page, '27-rpc-resilience')
      })
    } finally {
      delete state._delays['notes-list']
      delete state._delays['notes-get']
      await page.context().close()
    }
  },
}
