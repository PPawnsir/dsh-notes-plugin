'use strict';
/* 文档安全 S6 用例（notes-052-manual-mark-entries，反馈 n-mv3emwhuy2k6）app 源码模式手动标记入口行为级：
 * ① 源码模式：#srcSecretBtn（srcWrap 顶部右侧浮动 🛡）真可见 + title 走 i18n——rtb 随 richScroll 隐藏时唯一可见标记入口；
 * ② 无选区点击 → toast 引导「先选中要标记为机密的文字」（有选区才亮口径的可达兜底）；
 * ③ 有选区 → 按钮点亮（.on——select 事件驱动 updateSrcSecretBtn）→ 点击 → 选区行包 ```secret fence + 遮蔽块复活
 *   （复用 applySecretSel/snapshotSecretSel 零新逻辑：字节级选区包 fence）+ toast「已标记为机密」；
 * ④ 富文本态：#srcSecretBtn 随 srcWrap 整体隐藏（不出现——rtb 既有 🛡 钮覆盖）+ rtb 🛡 既有钮仍可用（红线：是「源码态补一个」不是「挪」）；
 * ⑤ 切回源码：#srcSecretBtn 复见。
 * 隔离纪律：新建草稿承载（finally 关 context，mock 数据随进程弃）。 */
module.exports = {
  name: '文档安全 S6：app 源码模式 🛡 浮钮（可见性 + 无选区引导 + 选区包 fence + 富文本态不出现 + rtb 钮红线不破）',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '66-app-src-secret-btn', async () => {
        /* ===== ① 源码模式：浮动 🛡 真可见 ===== */
        await page.click('#btnNew')
        await page.waitForSelector('#edTitle', { timeout: 8000 })
        await page.click('#edTitle')
        await page.keyboard.type('66 源码标记入口')
        await page.click('#edSrc')
        await page.keyboard.type('SRCTOKEN-6688 行中段\n公开结尾')
        await page.waitForSelector('#srcSecretBtn', { state: 'visible', timeout: 8000 })
        const btnState = await page.evaluate(() => {
          var b = document.querySelector('#srcSecretBtn')
          return { title: b ? b.title : '', on: b ? b.classList.contains('on') : null, inWrap: !!(b && b.closest('#srcWrap')) }
        })
        H.t('① 源码模式：#srcSecretBtn 真可见（Playwright-visible）+ 挂在 #srcWrap 内（随源码模式在场）+ title 走 i18n + 缺省不点亮',
          btnState.title.indexOf('标为机密') >= 0 && btnState.on === false && btnState.inWrap === true, () => JSON.stringify(btnState))

        /* ===== ② 无选区点击 → toast 引导 ===== */
        await page.click('#srcSecretBtn')
        const toast1 = await page.evaluate(() => {
          var t = document.querySelector('#toast')
          return !!(t && t.classList.contains('show') && t.textContent.indexOf('先选中要标记为机密的文字') >= 0)
        })
        H.t('② 无选区点击 🛡：toast 引导「先选中要标记为机密的文字」（有选区才亮口径的可达兜底，applySecretSel(null) 分支）', toast1, () => 'toast missing')

        /* ===== ③ 有选区 → 点亮 → 点击 → 选区包 fence + 遮蔽块复活 ===== */
        await page.evaluate(() => {
          var ta = document.querySelector('#edSrc')
          var s = ta.value.indexOf('\n')   /* 首行整行选区（闭合栏后随原文换行——fence 顶格可识别为 span） */
          ta.focus(); ta.setSelectionRange(0, s)
          ta.dispatchEvent(new Event('select'))   /* select 事件驱动 updateSrcSecretBtn 点亮 */
        })
        await H.waitFor(page, '🛡 点亮（.on——有选区才亮）', async p => p.evaluate(() => {
          var b = document.querySelector('#srcSecretBtn')
          return !!(b && b.classList.contains('on'))
        }))
        await page.click('#srcSecretBtn')
        await H.waitFor(page, '选区包 fence + 遮蔽块复活 + toast 已标记', async p => p.evaluate(() => {
          var ta = document.querySelector('#edSrc')
          var mi = document.querySelector('#srcMirror')
          var t = document.querySelector('#toast')
          return !!(ta && ta.value.indexOf('\x60\x60\x60secret\n') === 0 && ta.value.indexOf('\x60\x60\x60\n') > 0
            && ta.value.indexOf('SRCTOKEN-6688') >= 0
            && mi && mi.querySelectorAll('.src-secret-veil').length === 1
            && mi.textContent.indexOf('SRCTOKEN-6688') < 0
            && t && t.textContent.indexOf('已标记为机密') >= 0)
        }))
        H.t('③ 有选区点击 🛡：首行整行选区包 ```secret fence 即糊 + 遮蔽块在案 + 渲染文本层零机密 + toast「已标记为机密」（复用 applySecretSel/snapshotSecretSel 零新逻辑——字节级选区包 fence）', true)
        await H.screenshot(page, '66-app-src-secret-btn-marked')

        /* ===== ④ 富文本态：浮钮随 srcWrap 隐藏 + rtb 既有 🛡 钮仍可用（红线：不挪只补）===== */
        await page.click('#segRich')
        await page.waitForSelector('#edRich', { timeout: 8000 })
        const hidden = await page.evaluate(() => {
          var b = document.querySelector('#srcSecretBtn')
          var rtb = document.querySelector('#rtb .rtb-btn[data-a="secret"]')
          return { srcBtnHidden: !!(b && b.offsetParent === null), rtbSecret: !!rtb }
        })
        H.t('④ 富文本态：#srcSecretBtn 随 srcWrap 整体隐藏（不出现）+ rtb 既有 🛡 钮仍在 #rtb 工具栏在位（红线：源码态补一个不是挪）',
          hidden.srcBtnHidden === true && hidden.rtbSecret === true, () => JSON.stringify(hidden))
        /* rtb 既有钮行为级：富文本内 Ctrl+A 全选 → 点 rtb 🛡 → 机密岛在场 */
        await page.evaluate(() => { var r = document.querySelector('#edRich'); if (r) r.focus() })
        await page.keyboard.press('Control+a')
        await page.click('#rtb .rtb-btn[data-a="secret"]')
        await page.waitForSelector('#edRich pre.dsh-notes-secret', { timeout: 8000 })
        H.t('④ rtb 既有 🛡 钮可用：富文本全选 → 包机密岛（pre.dsh-notes-secret + 未揭示）', await page.evaluate(() => {
          var pre = document.querySelector('#edRich pre.dsh-notes-secret')
          return !!(pre && !pre.classList.contains('revealed') && (pre.getAttribute('data-md-src') || '').indexOf('SRCTOKEN-6688') >= 0)
        }), () => 'island missing')

        /* ===== ⑤ 切回源码：浮钮复见 ===== */
        await page.evaluate(() => { var seg = document.querySelector('.seg[data-m="source"]'); if (seg) seg.click() })
        await page.waitForSelector('#srcSecretBtn', { state: 'visible', timeout: 8000 })
        H.t('⑤ 切回源码：#srcSecretBtn 复见（srcWrap 显隐开关随行）', true)
        await H.screenshot(page, '66-app-src-secret-btn-src-back')
      })
    } finally {
      await page.context().close()
    }
  },
}
