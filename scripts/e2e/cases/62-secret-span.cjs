'use strict';
/* 文档安全 S1 用例（notes-052-span-kernel2）app 编辑器机密块全链：
 * ① 源码模式敲 ```secret fence → 富文本模式 = 模糊岛（blur 纯 CSS + contenteditable=false + data-md-src 逐字源）；
 * ② 点击揭示（.revealed + 取消机密钮浮现）→ ~10s 自动回糊（计时器单飞）；
 * ③ 再揭示 → 取消机密（剥 fence 行回明文：机密岛消失 + 源码正文含明文无围栏）；
 * ④ Ctrl+Shift+S 标记入口：源码模式选区 → 选区包 fence 即糊（值断言 + 染色镜像色带断言）；
 * ⑦ 模式切换可见性回归锁（驳回修复面）：富文本态换笔记重渲染 → 切回源码 → #edSrc 真可见（Playwright-visible + click）。
 * 隔离纪律：新建草稿承载（finally 关 context，mock 数据随进程弃）。 */
module.exports = {
  name: '文档安全 S1：secret fence 模糊块 → 揭示 → 回糊 → 取消机密 → 明文（app 编辑器全链）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '62-secret-span', async () => {
        /* ① 源码模式敲 fence（草稿承载：#btnNew → 标题 → 正文） */
        await page.click('#btnNew')
        await page.waitForSelector('#edTitle', { timeout: 8000 })
        await page.click('#edTitle')
        await page.keyboard.type('62 机密块全链')
        await page.click('#edSrc')
        await page.keyboard.type('公开开头\n\n```secret\nTOPSECRET-4242\n机密内容第二行\n```\n\n公开结尾')
        await H.waitFor(page, '源码落定（正文含机密围栏 + 染色镜像色带在案）', async p => p.evaluate(() => {
          var ta = document.querySelector('#edSrc')
          var mi = document.querySelector('#srcMirror')
          return !!(ta && ta.value.indexOf('TOPSECRET-4242') >= 0 && ta.value.indexOf('\x60\x60\x60secret') >= 0
            && mi && mi.querySelectorAll('.src-secret').length >= 3)
        }))
        H.t('① 源码模式：fence 明文在 textarea + 行背景染色镜像（.src-secret 色带覆盖围栏行）', await page.evaluate(() => {
          var mi = document.querySelector('#srcMirror')
          return !!(mi && mi.querySelectorAll('.src-secret').length >= 3 && mi.textContent.indexOf('TOPSECRET-4242') >= 0)
        }), 'mirror bands/text 断言失败')

        /* ② 切富文本：模糊块（未揭示态） */
        await page.click('#segRich')
        await page.waitForSelector('#edRich pre.dsh-notes-secret', { timeout: 8000 })
        H.t('② 富文本：机密岛在场（contenteditable=false + data-md-src 逐字源 + 未揭示）', await page.evaluate(() => {
          var pre = document.querySelector('#edRich pre.dsh-notes-secret')
          return !!(pre && pre.getAttribute('contenteditable') === 'false'
            && (pre.getAttribute('data-md-src') || '').indexOf('TOPSECRET-4242') >= 0
            && !pre.classList.contains('revealed'))
        }), () => 'pre missing?')

        /* ③ 点击揭示 → .revealed + 取消机密钮浮现 */
        await page.click('#edRich pre.dsh-notes-secret')
        await H.waitFor(page, '揭示态（.revealed + 取消机密钮可见）', async p => p.evaluate(() => {
          var pre = document.querySelector('#edRich pre.dsh-notes-secret')
          var btn = pre ? pre.querySelector('.secret-unmark') : null
          return !!(pre && pre.classList.contains('revealed') && btn && getComputedStyle(btn).display !== 'none')
        }))
        H.t('③ 揭示：.revealed 在案 + 🔒 tooltip（i18n）+ 取消机密钮浮现', await page.evaluate(() => {
          var pre = document.querySelector('#edRich pre.dsh-notes-secret')
          var lock = pre ? pre.querySelector('.secret-lock') : null
          return !!(pre && lock && (lock.title || '').indexOf('揭示') >= 0)
        }), () => 'lock tip missing')

        /* ④ ~10s 自动回糊（计时器单飞） */
        await H.waitFor(page, '回糊（~10s 计时到点 .revealed 摘除）', async p => p.evaluate(() => {
          var pre = document.querySelector('#edRich pre.dsh-notes-secret')
          return !!(pre && !pre.classList.contains('revealed'))
        }), 13000)
        H.t('④ 回糊：~10s 后 .revealed 摘除（未揭示态复原）', true)

        /* ⑤ 再揭示 → 取消机密 → 明文 */
        await page.click('#edRich pre.dsh-notes-secret')
        await H.waitFor(page, '再揭示（取消机密钮可用）', async p => p.evaluate(() => {
          var pre = document.querySelector('#edRich pre.dsh-notes-secret')
          return !!(pre && pre.classList.contains('revealed'))
        }))
        await page.click('#edRich pre.dsh-notes-secret .secret-unmark')
        await H.waitFor(page, '取消机密：机密岛消失（明文段落接替）', async p => p.evaluate(() => {
          var rich = document.querySelector('#edRich')
          return !!(rich && !rich.querySelector('pre.dsh-notes-secret') && rich.textContent.indexOf('TOPSECRET-4242') >= 0)
        }))
        await page.evaluate(() => { var seg = document.querySelector('.seg[data-m="source"]'); if (seg) seg.click() })
        await H.waitFor(page, '回源码：正文含明文且无围栏', async p => p.evaluate(() => {
          var ta = document.querySelector('#edSrc')
          return !!(ta && ta.value.indexOf('TOPSECRET-4242') >= 0 && ta.value.indexOf('\x60\x60\x60secret') < 0)
        }))
        H.t('⑤ 取消机密：剥 fence 行回明文（富文本零机密岛 + 源码无围栏 + 内容字节保留）', true)
        await H.screenshot(page, '62-secret-span-unmarked')

        /* ⑥ Ctrl+Shift+S 标记入口：源码模式选区包 fence 即糊 */
        await page.evaluate(() => { const t = document.querySelector('#edSrc'); t.focus(); t.setSelectionRange(0, 4) })
        await page.keyboard.press('Control+Shift+s')
        await H.waitFor(page, '选区包 fence（值前缀 = ```secret + 选区 + 闭合栏 + 染色镜像色带复活）', async p => p.evaluate(() => {
          var ta = document.querySelector('#edSrc')
          var mi = document.querySelector('#srcMirror')
          return !!(ta && ta.value.indexOf('\x60\x60\x60secret\n') === 0 && ta.value.indexOf('\x60\x60\x60\n') > 0
            && mi && mi.querySelectorAll('.src-secret').length >= 3)
        }))
        H.t('⑥ Ctrl+Shift+S：选区包 ```secret fence 即糊（源码值 + 染色镜像双断言）', true)
        await H.screenshot(page, '62-secret-span-marked')

        /* ⑦ 模式切换回归锁（Verifier 驳回修复面）：富文本态换笔记（renderEd 以 edMode='rich' 重建 → srcWrap 内联 display:none）
         * → 切回源码 → #edSrc/#srcWrap 必须 Playwright 真可见（v1 漏 id 致 renderModeUI $('srcWrap') 恒 null，编辑区空白 = 用例㉟断点复现源）。
         * 选行纪律（用例㊸教训）：按 data-note=id 精确锚定——套件态里 A 被用例㊸置顶后 pin svg 前导空格破坏「标题前缀」匹配 */
        const idA = state.notes.find(n => n.title === 'e2e 种子笔记 A' && !n.deleted).id
        await page.click('#segRich')
        await H.waitFor(page, '富文本落定（可编辑 + 绿点）', async p => p.evaluate(() =>
          (document.querySelector('#edRich') || {}).contentEditable === 'true' && !!document.querySelector('#syncPill.ok')))
        const rowClicked = await page.evaluate(function (id) {
          var row = document.querySelector('#tree .note-row[data-note="' + id + '"]')
          if (row) row.click()
          return !!row
        }, idA)
        if (!rowClicked) throw new Error('⑦ 种子 A 行未找到（data-note=id 锚定失败）')
        await H.waitFor(page, '富文本态换笔记重渲染落定（种子 A 回填）', async p => p.evaluate(() =>
          (document.querySelector('#edRich') || {}).contentEditable === 'true' && (document.querySelector('#edRich') || {}).textContent.indexOf('种子正文 A') >= 0))
        await page.evaluate(() => { var seg = document.querySelector('.seg[data-m="source"]'); if (seg) seg.click() })
        await page.waitForSelector('#srcWrap', { state: 'visible', timeout: 8000 })
        await page.waitForSelector('#edSrc', { state: 'visible', timeout: 8000 })
        await page.click('#edSrc')   /* 与用例㉟同一断点：不可见即抛（actionability 实测，非 evaluate 读值） */
        H.t('⑦ 富文本态换笔记后切回源码：#srcWrap/#edSrc 真可见可点（srcWrap 显隐开关活着——v1 漏 id 回归锁）', true)
      })
    } finally {
      await page.context().close()
    }
  },
}
