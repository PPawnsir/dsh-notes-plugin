'use strict'
/* 0.4.6-D 用例㉙（notes-046-copy-consistency，UX 巡检 R2 文案族）：
 * 链路锁：① 草稿落库后底栏「草稿」标签消失（创建/更新时间戳回填，行为级 DOM）；
 *   ② 后续自动保存刷新「更新」时间戳（先埋陈旧哨兵值再保存，确定性构造，不靠墙钟跨分钟）；
 *   ③ 空态新建文案括注面板端差异（双端对齐）；④ 归档预览幽灵「右键合并」清零 + 指向底部操作条 + 空态速记概念；
 *   ⑤ 搜索空态引导行「试试更短的关键词，或 [新建一篇]」+ 点击开草稿。
 * mock 数据源：server.cjs 共享内存态（归档 preview 走 default {ok:true} → 空组态）。 */
module.exports = {
  name: '㉙ 0.4.6-D：草稿标签收口 + 时间戳刷新 + 空态引导 + 归档/速记文案',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '29-copy-consistency', async () => {
        /* ③ 空态新建文案括注面板端差异（启动未选中笔记 → .ed.empty 静态壳） */
        H.t('空态新建文案括注面板端差异（双端对齐）', await page.evaluate(() =>
          document.querySelector('#ed').textContent.indexOf('面板端「新建」为弹窗即建') >= 0))

        /* ① 草稿期底栏显示「草稿」提示（前态口径不变） */
        await page.click('#btnNew')
        await page.waitForSelector('#edTitle', { timeout: 8000 })
        H.t('草稿期底栏显示「草稿（首次输入即落库）」（前态不变）', await page.evaluate(() =>
          document.querySelector('#edCreated').textContent.indexOf('草稿') >= 0))

        /* 输入标题 → 首次落库 → 「草稿」标签消失 + 创建/更新时间戳出现（行为级） */
        const TITLE = 'e2e 0.4.6-D 草稿收口 ' + Date.now()
        await page.click('#edTitle')
        await page.keyboard.type(TITLE)
        await H.waitFor(page, '落库后底栏「草稿」消失转「创建」', async p =>
          p.evaluate(() => {
            var c = document.querySelector('#edCreated').textContent
            return c.indexOf('草稿') < 0 && /创建 \d{4}-\d{2}-\d{2}/.test(c)
          }))
        H.t('落库后底栏「草稿」标签消失（转「创建」时间戳）', true)
        H.t('落库后「更新」时间戳出现', await page.evaluate(() =>
          /更新 \d{4}-\d{2}-\d{2}/.test(document.querySelector('#edUpdated').textContent)))
        await H.waitFor(page, '列表出现新笔记标题', async p =>
          p.evaluate(t => document.querySelector('#tree').textContent.indexOf(t) >= 0, TITLE))

        /* ② 后续自动保存刷新「更新」时间戳：先埋陈旧哨兵值，再编辑触发保存，哨兵被覆盖即刷新实锤 */
        await page.evaluate(() => { document.querySelector('#edUpdated').textContent = '更新 2000-01-01 00:00' })
        await page.click('#edSrc')
        await page.keyboard.type('追加正文触发二次保存')
        await H.waitFor(page, '二次自动保存覆盖陈旧「更新」时间戳', async p =>
          p.evaluate(() => {
            var t = document.querySelector('#edUpdated').textContent
            return t.indexOf('2000-01-01') < 0 && /更新 \d{4}-\d{2}-\d{2}/.test(t)
          }))
        H.t('自动保存刷新「更新」时间戳（陈旧哨兵被覆盖）', true)

        /* ④ 归档预览：幽灵「右键合并」清零 + 指向底部操作条 + 空态速记概念解释
           0.4.7-B②a：顶栏「速记合并」按钮已撤——预览弹窗入品 = 建议器速记组段「去归档」（0 组时隐藏）；
           本例断言弹窗内文案（入口链路归用例㊚），经页面内全局函数直开（openArchive 为 app.html 顶层函数） */
        await page.evaluate(() => openArchive())
        await page.waitForSelector('#modalHost .modal-t', { timeout: 8000 })
        await H.waitFor(page, '归档预览空态落定', async p =>
          p.evaluate(() => document.querySelector('#modalHost').textContent.indexOf('没有可归档的速记组') >= 0))
        const archTxt = await page.evaluate(() => document.querySelector('#modalHost').textContent)
        H.t('归档预览手动合并提示指向底部操作条「合并」（幽灵右键清零）',
          archTxt.indexOf('底部操作条的「合并」') >= 0 && archTxt.indexOf('右键合并') < 0, () => archTxt.slice(-120))
        H.t('归档空态补速记概念解释（速记 = 划选快速记录暂存）', archTxt.indexOf('速记 = 划选文字松手弹出的快速记录卡片产生的暂存笔记') >= 0)
        H.t('顶栏「速记合并」按钮已撤（0.4.7-B②a）', await page.evaluate(() => !document.querySelector('#btnArchive')))
        await page.click('#archCancel')
        await H.waitFor(page, '归档预览关闭', async p =>
          p.evaluate(() => document.querySelector('#modalHost').textContent === ''))

        /* ⑤ 搜索空态引导行 + 「新建一篇」动作出口 */
        await page.fill('#q', 'zzzz不存在关键词' + Date.now())
        await H.waitFor(page, '搜索空态引导行渲染', async p =>
          p.evaluate(() => document.querySelector('#tree').textContent.indexOf('无匹配笔记') >= 0
            && document.querySelector('#tree').textContent.indexOf('试试更短的关键词') >= 0
            && !!document.querySelector('#emptyNew')))
        H.t('搜索空态：无匹配提示 + 引导行 + 「新建一篇」入口', true)
        await page.click('#emptyNew')
        await page.waitForSelector('#edTitle', { timeout: 8000 })
        H.t('空态「新建一篇」点击开草稿（编辑器标题可见）', await page.isVisible('#edTitle'))
        await H.screenshot(page, '29-copy-consistency')
      })
    } finally { await page.context().close() }
  },
}
