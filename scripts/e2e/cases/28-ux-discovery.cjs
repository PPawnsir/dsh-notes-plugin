'use strict'
/* 0.4.6-C 用例㉘（notes-046-ux-discovery）：概念引导与治理入口信号——
 * 链路锁：① 空态首笔记引导补概念指向（.ed-empty-concept 静态壳行，启动未选中即见）
 *   ② 顶栏「建议」按钮 + 计数徽标 = notes-suggest mock 六段合计（stale 2 + orphan 1 = 3）→ 点击开建议框（计数同口径）
 *   ③ 建议框底栏「约定体检…」→ 关建议框开注入管理（modal 不叠 modal）→ 体检区在案
 *   ④ 编辑器 meta「整理」「派发」在位（选中种子笔记即见——与使用说明承诺对齐，R2 反馈防回流）
 * mock 数据源：server.cjs notes-suggest 固定候选集（与其余用例共享状态零耦合）。 */
module.exports = {
  name: '㉘ 0.4.6-C：空态概念行 + 顶栏建议徽标计数 + 建议框体检入口 + meta 整理/派发在位',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '28-ux-discovery', async () => {
        /* ① 空态概念指向行（启动未选中笔记 → .ed.empty 静态壳） */
        await H.waitFor(page, '空态概念指向行渲染', async p =>
          p.evaluate(() => {
            var el = document.querySelector('#ed .ed-empty-concept')
            return !!el && el.textContent.indexOf('概念速览') >= 0
          }))
        H.t('空态首笔记引导补概念指向（.ed-empty-concept 含「概念速览」）', true)
        /* ② 顶栏建议徽标：启动即拉 notes-suggest（dry-run）→ 计数 = 3 */
        await H.waitFor(page, '顶栏「建议」徽标计数点亮', async p =>
          p.evaluate(() => {
            var bd = document.querySelector('#suggestBd')
            return bd && bd.style.display !== 'none' && bd.textContent === '3'
          }))
        H.t('顶栏「建议」徽标计数 = 3（stale 2 + orphan 1，六段合计口径）', true)
        const tip = await page.evaluate(() => document.querySelector('#btnSuggest').title)
        H.t('计数态 tooltip 走 suggestTipN（含条数 + 只提名口径 + 体检入口注记）',
          tip.indexOf('3') >= 0 && tip.indexOf('只提名不执行') >= 0 && tip.indexOf('约定体检') >= 0, () => tip)
        /* 点击 → 建议框打开，modal 六段计数与徽标同一响应同口径 */
        await page.click('#btnSuggest')
        await page.waitForSelector('#suggestList .sg-sec', { timeout: 8000 })
        const modalTxt = await page.evaluate(() => document.querySelector('#suggestList').textContent)
        H.t('建议框打开：过期未引用 2 条 + 可能无用 1 条（与徽标计数同响应同口径）',
          modalTxt.indexOf('2 条') >= 0 && modalTxt.indexOf('1 条') >= 0, () => modalTxt.slice(0, 120))
        /* ③ 底栏「约定体检…」→ 关建议框 + 开注入管理（单一 #modalHost 结构锁）→ 体检区在案 */
        await page.click('#sgGoConflict')
        await page.waitForSelector('#modal #injConflictHost .conflict-sec', { timeout: 8000 })
        H.t('「约定体检…」直达注入管理体检区（三层深 → 建议框底栏一层直达）', true)
        const maskCount = await page.evaluate(() => document.querySelectorAll('#modalHost .mask').length)
        H.t('modal 不叠 modal：#modalHost 内恰一层 mask', maskCount === 1, () => '实得 mask 层数 ' + maskCount)
        /* 关闭注入管理 → 选中种子笔记 → meta「整理」「派发」在位 */
        await page.click('#injMgrClose')
        await page.click('#tree .note-row:has-text("e2e 种子笔记 A")')
        await page.waitForSelector('#mOrganize', { timeout: 8000 })
        await page.waitForSelector('#mDispatch', { timeout: 8000 })
        H.t('编辑器 meta 动作区「整理」（#mOrganize）+「派发」（#mDispatch）在位', true)
        await H.screenshot(page, '28-ux-discovery')
      })
    } finally { await page.context().close() }
  },
}
