'use strict'
/* 0.4.3⑦ 用例⑦（notes-043-log-firstclass 改造；原 0.4.3② 懒加载语义随 R-6 UI 隐身推翻作废）：日志同权——
 * 默认列表/搜索即含 kind=log（无隐身）；展开「工作日志」夹 = 纯折叠态翻转（零额外 RPC/懒加载）；
 * 日志行普通渲染（无 logmark 隐身徽章，kind 色点照常区分）；折叠再展开条目不重复（同一份主缓存）。 */
module.exports = {
  name: '⑦ 日志同权：默认直达 + 展开纯 toggle（零懒加载）+ 无 logmark 徽章',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '07-log-children', async () => {
        const logVisible = () => page.evaluate(() => document.querySelector('#tree').textContent.indexOf('e2e 日志条目') >= 0)
        /* 同权：初始态日志条目随默认列表直达（「工作日志」夹缺省展开，日志行直接在子容器内） */
        H.t('初始态日志可见（同权：默认列表含 log，无隐身）', (await logVisible()) === true)
        const inNested = await page.evaluate(() => {
          var rows = document.querySelectorAll('#tree .nested .note-row')
          for (var i = 0; i < rows.length; i++) if (rows[i].textContent.indexOf('e2e 日志条目') >= 0) return true
          return false
        })
        H.t('日志条目渲染在该夹 .nested 子容器内', inNested)
        H.t('日志行无 logmark 隐身徽章（普通渲染，kind 色点照常）', (await page.evaluate(() => document.querySelectorAll('#tree .logmark').length)) === 0)
        const row = page.locator('#tree .row.head[data-fold]', { hasText: '工作日志' }).first()
        /* 折叠 → 再展开：纯 toggle（零懒加载/零额外 RPC），同名条目仍 1 条 */
        await row.click()
        H.t('折叠后日志条目隐藏（纯折叠态翻转）', (await logVisible()) === false)
        await row.click()
        await page.waitForSelector('#tree .nested .note-row', { timeout: 8000 })
        const cnt = await page.evaluate(() => {
          var n = 0
          document.querySelectorAll('#tree .note-row').forEach(function (r) { if (r.textContent.indexOf('e2e 日志条目') >= 0) n++ })
          return n
        })
        H.t('折叠再展开后日志条目仍 1 条（同一份主缓存，无懒加载重复）', cnt === 1, () => '实际 ' + cnt + ' 条')
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '07-log-children')
      })
    } finally { await page.context().close() }
  },
}
