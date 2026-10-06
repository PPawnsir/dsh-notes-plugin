'use strict'
/* 0.4.4-F 用例㉑（notes-044-organize-instruct）：点「整理」→ 弹追加指令引导卡（#oiInstr）——
 * 取消零副作用（正文不动、无 RPC）；留空确认 = 系统默认规则（mock 回显 [指令:(无)]）；
 * 填写确认 = 指令透传 host（mock 回显 [指令:突出待办]）；撤销栈照常（toastAct 一次撤销回原文）。
 * 隔离纪律：自带新建笔记（不复用种子/他例笔记）。 */
module.exports = {
  name: '㉑ 整理追加指令引导卡：取消零副作用 / 留空确认等价直发 / 填写确认带参 / 撤销栈照常',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '21-organize-instruct', async () => {
        /* 隔离：新建专属笔记并重新选中（createNoteViaUI 末尾切走兜底落库） */
        await H.createNoteViaUI(page, 'e2e 整理指令㉑', '整理原文本㉑')
        await page.click('#tree .note-row:has-text("e2e 整理指令㉑")')
        await page.waitForSelector('#mOrganize', { timeout: 8000 })
        await H.waitFor(page, '正文加载落定（edSrc = 原文）', async p =>
          p.evaluate(() => { var ta = document.querySelector('#edSrc'); return ta && ta.value.indexOf('整理原文本㉑') >= 0 }))
        const bodyNow = () => page.evaluate(() => { var ta = document.querySelector('#edSrc'); return ta ? ta.value : '' })

        /* ① 取消零副作用：开卡 → 取消 → 关卡 + 正文原样（无任何整理 RPC 副作用） */
        await page.click('#mOrganize')
        await page.waitForSelector('#oiInstr', { timeout: 8000 })
        H.t('点「整理」弹出追加指令引导卡（#oiInstr 可见）', true)
        await page.fill('#oiInstr', '这条指令不应生效')
        await page.click('#oiCancel')
        await H.waitFor(page, '取消后引导卡关闭', async p => p.evaluate(() => !document.querySelector('#oiInstr')))
        await H.sleep(400)
        H.t('取消零副作用：正文原样未动', (await bodyNow()).indexOf('整理原文本㉑') >= 0 && (await bodyNow()).indexOf('## 已整理') < 0)

        /* ② 留空确认 = 等价直发：mock 回显 [指令:(无)]；正文被替换 → 撤销栈照常恢复 */
        await page.click('#mOrganize')
        await page.waitForSelector('#oiInstr', { timeout: 8000 })
        H.t('重开引导卡输入已重置（上次填写不残留）', await page.evaluate(() => document.querySelector('#oiInstr').value === ''))
        await page.click('#oiOk')
        await H.waitFor(page, '留空确认后正文被整理结果替换', async p =>
          p.evaluate(() => { var ta = document.querySelector('#edSrc'); return ta && ta.value.indexOf('## 已整理') >= 0 }))
        H.t('留空确认 = 系统默认规则（instruction 空透传，mock 回显 [指令:(无)]）', (await bodyNow()).indexOf('[指令:(无)]') >= 0)
        await page.waitForSelector('#toastAct', { timeout: 8000 })
        await page.click('#toastAct')   /* 撤销一次 */
        await H.waitFor(page, '撤销后恢复整理前正文', async p =>
          p.evaluate(() => { var ta = document.querySelector('#edSrc'); return ta && ta.value.indexOf('## 已整理') < 0 && ta.value.indexOf('整理原文本㉑') >= 0 }))
        H.t('撤销栈照常：一次撤销恢复整理前正文', true)

        /* ③ 填写确认 = 指令透传 host（mock 回显原文） */
        await page.click('#mOrganize')
        await page.waitForSelector('#oiInstr', { timeout: 8000 })
        await page.fill('#oiInstr', '突出待办')
        await page.click('#oiOk')
        await H.waitFor(page, '填写确认后正文被整理结果替换', async p =>
          p.evaluate(() => { var ta = document.querySelector('#edSrc'); return ta && ta.value.indexOf('## 已整理') >= 0 }))
        H.t('填写确认 = 指令带参透传（mock 回显 [指令:突出待办]）', (await bodyNow()).indexOf('[指令:突出待办]') >= 0)
        await H.screenshot(page, '21-organize-instruct')
      })
    } finally { await page.context().close() }
  },
}
