'use strict'
/* 0.4.4-A 用例⑲：派发回执笔记化·双端跳转（notes-044-dispatch-receipts）。
 * 上半（meta 派发历史行）：种子笔记立即派发 → 派发徽章 → 历史行尾「执行记录 ↗」→ 编辑器打开执行记录伴生笔记
 *  （kind=log + 「执行记录」夹 + 注入硬关 + 📤 派发行含指令摘要）。
 * 下半（调度区执行记录行）：「定时 」计划笔记 → 立即派发 → 计划块「执行记录 ↗」→ 同款跳转。 */
module.exports = {
  name: '⑲ 派发回执笔记化：派发历史行/计划块「执行记录 ↗」跳转（openExecLog + open-by-id）',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    /* 行首前缀精确点击（「执行记录 · X」/「定时 X」与源笔记 X 标题含子串关系，子串选择器会误中） */
    const clickRowByPrefix = (title) => page.evaluate(function (t) {
      var rows = document.querySelectorAll('#tree .note-row')
      for (var i = 0; i < rows.length; i++) {
        var txt = rows[i].textContent || ''
        if (txt.indexOf(t) === 0) { rows[i].click(); return true }
      }
      return false
    }, title)
    const edTitle = () => page.evaluate(() => (document.querySelector('#edTitle') || {}).textContent || '')
    const edBody = () => page.evaluate(() => (document.querySelector('#edSrc') || {}).value || '')
    try {
      await H.step(page, '19-exec-log-jump', async () => {
        /* ===== 上半：手动派发 → 派发历史行尾跳转 ===== */
        /* 行首前缀精确点击（套件连跑时case ⑫ 已建「定时 e2e 种子笔记 B」——子串选择器会误中，prefix 鉴别） */
        await clickRowByPrefix('e2e 种子笔记 B')
        await page.waitForSelector('#mDispatch', { timeout: 8000 })
        await page.click('#mDispatch')
        await page.waitForSelector('#dOk', { timeout: 8000 })
        await page.fill('#dInstr', 'e2e 指令摘要')
        await page.waitForSelector('#dispSessHost .disp-sess[data-sid]', { timeout: 8000 })
        await page.click('#dispSessHost .disp-sess[data-sid]')
        await page.click('#dOk')
        await H.waitFor(page, '派发徽章出现（dispatches 元数据回填）', async p => p.evaluate(() => !!document.querySelector('#mDispBadge')))
        H.t('派发后徽章出现（派发历史登记）', true)
        /* 「执行记录」夹懒创建 + 伴生笔记归夹（log 同权口径：默认树可见，位于夹内） */
        await H.waitFor(page, '树中出现「执行记录」夹与伴生笔记行', async p => p.evaluate(() => {
          var txt = (document.querySelector('#tree') || {}).textContent || ''
          var hasFolder = false
          var heads = document.querySelectorAll('#tree .row.head[data-fold]')
          for (var i = 0; i < heads.length; i++) if ((heads[i].textContent || '').indexOf('执行记录') >= 0) hasFolder = true
          var hasNote = false
          var rows = document.querySelectorAll('#tree .note-row')
          for (var j = 0; j < rows.length; j++) if ((rows[j].textContent || '').indexOf('执行记录 · e2e 种子笔记 B') === 0) hasNote = true
          return hasFolder && hasNote
        }))
        H.t('「执行记录」专用夹懒创建 + 伴生笔记归夹可见（非「工作日志」夹）', true)
        /* 展开派发历史 → 行尾「执行记录 ↗」 */
        await page.click('#mDispBadge')
        await page.waitForSelector('#dispHost .disp-log-act', { timeout: 8000 })
        H.t('派发历史行尾渲染「执行记录 ↗」按钮（disp-log-act）', true)
        await page.click('#dispHost .disp-log-act')
        await H.waitFor(page, '编辑器打开执行记录笔记', async () => (await edTitle()).indexOf('执行记录 · e2e 种子笔记 B') === 0)
        H.t('点击跳转：编辑器打开执行记录伴生笔记', true)
        await H.waitFor(page, '执行记录正文加载（loadEdBody 异步回填）', async () => (await edBody()).indexOf('- 📤 ') >= 0)
        const body = await edBody()
        H.t('执行记录正文含 📤 派发行 + 指令摘要', body.indexOf('- 📤 ') >= 0 && body.indexOf('e2e 指令摘要') >= 0, () => '正文：' + body.slice(0, 120))
        H.t('执行记录 kind=log（注入硬关：注入开关不渲染，kind 下拉值 log）', await page.evaluate(() => {
          var sel = document.querySelector('#kindSel')
          return sel && sel.value === 'log'
        }))
        /* ===== 下半：调度区执行记录行（计划块「执行记录 ↗」）===== */
        await clickRowByPrefix('e2e 种子笔记 B')
        await page.waitForSelector('#mDispatch', { timeout: 8000 })
        await page.click('#mDispatch')
        await page.waitForSelector('#dOk', { timeout: 8000 })
        await page.check('#dTrigSched')
        await page.waitForSelector('#dSchedForm', { state: 'visible', timeout: 8000 })
        await page.selectOption('#dSchedMode', 'once')
        await page.fill('#dSchedOnce', '2027-01-01T09:00')
        await page.waitForSelector('#dispSessHost .disp-sess[data-sid]', { timeout: 8000 })
        await page.click('#dispSessHost .disp-sess[data-sid]')
        await page.click('#dOk')
        await H.waitFor(page, '树中出现「定时 」前缀计划笔记', async p => p.evaluate(() => document.querySelector('#tree').textContent.indexOf('定时 e2e 种子笔记 B') >= 0))
        H.t('排定创建计划笔记（定时 前缀）', true)
        await clickRowByPrefix('定时 e2e 种子笔记 B')
        await page.waitForSelector('#edMeta .sched-plan', { timeout: 8000 })
        H.t('计划块渲染（调度区）', true)
        /* 对计划笔记立即派发 → 计划块出现「执行记录 ↗」（schedule.runLog 软链回写） */
        await page.click('#mDispatch')
        await page.waitForSelector('#dOk', { timeout: 8000 })
        await page.waitForSelector('#dispSessHost .disp-sess[data-sid]', { timeout: 8000 })
        await page.click('#dispSessHost .disp-sess[data-sid]')
        await page.click('#dOk')
        await H.waitFor(page, '计划块出现「执行记录 ↗」链接', async p => p.evaluate(() => !!document.querySelector('#edMeta .sched-runlog-act')))
        H.t('派发后计划块渲染「执行记录 ↗」（schedule.runLog 软链口径）', true)
        await page.click('#edMeta .sched-runlog-act')
        await H.waitFor(page, '编辑器打开计划笔记的执行记录', async () => (await edTitle()).indexOf('执行记录 · 定时 e2e 种子笔记 B') === 0)
        H.t('计划块点击跳转：编辑器打开执行记录笔记（同一篇三表归一）', true)
        H.t('全程零 console 错误', (page.__consoleErrors || []).length === 0, () => (page.__consoleErrors || []).join(' | ').slice(0, 300))
        await H.screenshot(page, '19-exec-log-jump')
      })
    } finally { await page.context().close() }
  },
}
