'use strict';
/* 文档安全 S5 用例（notes-052-source-mask）源码模式遮蔽全链：
 * ① 源码敲机密 fence → 遮蔽块在案（.src-secret-veil 实底遮挡，镜像层在 textarea 之上）+ 渲染文本层零机密
 *   + textarea.value 逐字节恒等真原文（红线：遮蔽纯渲染层，永不写回）；
 * ② 点击遮蔽块揭示 → visibility:hidden（点击穿透，textarea 明文可编辑）；
 * ③ 揭示态在机密块内打字 → span 起偏移不变持续揭示（揭示态编辑保持）+ 值增量落真原文；
 * ④ ~10s 计时到点自动回蔽（与富文本岛共用计时器单飞）；
 * ⑤ 切走再切回（保存落盘 + 重载）：正文逐字节真原文（遮蔽零写回）+ 遮蔽块回位（默认遮蔽态）。
 * 隔离纪律：新建草稿承载（finally 关 context，mock 数据随进程弃）。 */
module.exports = {
  name: '文档安全 S5：源码遮蔽块→揭示→编辑→自动回蔽→保存往返零写回（app 编辑器全链）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    const BODY = 'S5遮蔽开头\n\n\x60\x60\x60secret\nSRCMASK-9931\n机密凭据行二\n\x60\x60\x60\n\n良性收尾'
    const BODY2 = 'S5遮蔽开头\n\n\x60\x60\x60secret\nSRCMASK-9931\n机密凭据行二尾注\n\x60\x60\x60\n\n良性收尾'
    try {
      await H.step(page, '64-secret-source-mask', async () => {
        /* ① 源码模式敲 fence（草稿承载） */
        await page.click('#btnNew')
        await page.waitForSelector('#edTitle', { timeout: 8000 })
        await page.click('#edTitle')
        await page.keyboard.type('64 源码遮蔽全链')
        await page.click('#edSrc')
        await page.keyboard.type(BODY)
        await H.waitFor(page, '遮蔽块落位（textarea 值存真围栏原文 + .src-secret-veil 在案）', async p => p.evaluate((b) => {
          var ta = document.querySelector('#edSrc')
          var mi = document.querySelector('#srcMirror')
          return !!(ta && ta.value === b && mi && mi.querySelectorAll('.src-secret-veil').length === 1)
        }, BODY))
        H.t('① 遮蔽块在案 + 渲染文本层零机密 + textarea.value 逐字节恒等真原文（红线：遮蔽纯渲染层）', await page.evaluate((b) => {
          var mi = document.querySelector('#srcMirror')
          var veil = mi ? mi.querySelector('.src-secret-veil') : null
          var zAbove = mi ? Number(getComputedStyle(mi).zIndex) >= 2 : false   /* 镜像层须在 textarea(z1) 之上才盖得住 */
          return !!(veil && zAbove
            && mi.textContent.indexOf('SRCMASK-9931') < 0 && mi.textContent.indexOf('机密凭据行二') < 0
            && mi.textContent.indexOf('点击揭示') >= 0
            && document.querySelector('#edSrc').value === b)
        }, BODY), 'veil/text-layer/value 断言失败')

        /* ② 点击遮蔽块揭示（visibility:hidden——点击穿透到 textarea，可编辑） */
        await page.click('#srcMirror .src-secret-veil')
        await H.waitFor(page, '揭示态（.revealed + visibility:hidden）', async p => p.evaluate(() => {
          var veil = document.querySelector('#srcMirror .src-secret-veil')
          return !!(veil && veil.classList.contains('revealed') && getComputedStyle(veil).visibility === 'hidden')
        }))
        H.t('② 点击揭示：遮蔽块 visibility:hidden（保留占位 + 点击穿透编辑）', true)

        /* ③ 揭示态在机密块内打字：span 起偏移不变 → 持续揭示；值增量落真原文 */
        await page.evaluate((b) => {
          const ta = document.querySelector('#edSrc')
          ta.focus()
          const idx = b.indexOf('机密凭据行二') + '机密凭据行二'.length   /* 机密块内（闭栏前）落光标 */
          ta.setSelectionRange(idx, idx)
        }, BODY)
        await page.keyboard.type('尾注')
        await H.waitFor(page, '揭示态编辑保持（值增量 + 遮蔽块仍揭示 + 镜像文本层仍零机密）', async p => p.evaluate((b2) => {
          var ta = document.querySelector('#edSrc')
          var mi = document.querySelector('#srcMirror')
          var veil = mi ? mi.querySelector('.src-secret-veil') : null
          return !!(ta && ta.value === b2 && veil && veil.classList.contains('revealed')
            && mi.textContent.indexOf('SRCMASK-9931') < 0 && mi.textContent.indexOf('尾注') < 0)
        }, BODY2))
        H.t('③ 揭示态编辑：机密块内打字持续揭示 + textarea.value 落真增量（编辑后仍零写回遮蔽文本）', true)

        /* ④ ~10s 自动回蔽（计时器与富文本岛共用单飞） */
        await H.waitFor(page, '自动回蔽（~10s 计时到点 .revealed 摘除 + 遮蔽块复原）', async p => p.evaluate(() => {
          var veil = document.querySelector('#srcMirror .src-secret-veil')
          return !!(veil && !veil.classList.contains('revealed') && getComputedStyle(veil).visibility !== 'hidden')
        }), 13000)
        H.t('④ 自动回蔽：~10s 后揭示态摘除（机密块回默认遮蔽——揭示是临时动作）', true)
        await H.screenshot(page, '64-secret-source-mask')

        /* ⑤ 切走再切回：保存落盘零写回（正文逐字节真原文）+ 遮蔽块回位 */
        await H.sleep(1500)   /* 让 900ms 防抖保存 + 草稿落库沉降 */
        const idA = state.notes.find(n => n.title === 'e2e 种子笔记 A' && !n.deleted).id
        await page.evaluate(function (id) {
          var row = document.querySelector('#tree .note-row[data-note="' + id + '"]')
          if (row) row.click()
          return !!row
        }, idA)
        await H.waitFor(page, '切走落定（种子 A 回填）', async p => p.evaluate(() =>
          (document.querySelector('#edTitle') || {}).textContent.indexOf('种子笔记 A') >= 0))
        const back = await page.evaluate(function (title) {
          var rows = document.querySelectorAll('#tree .note-row')
          for (var i = 0; i < rows.length; i++) if (rows[i].textContent.indexOf(title) >= 0) { rows[i].click(); return true }
          return false
        }, '64 源码遮蔽全链')
        if (!back) throw new Error('⑤ 本用例笔记行未找到（标题锚定失败）')
        await H.waitFor(page, '切回落定（重载正文逐字节真原文 + 遮蔽块回位）', async p => p.evaluate((b2) => {
          var ta = document.querySelector('#edSrc')
          var mi = document.querySelector('#srcMirror')
          return !!(ta && ta.value === b2 && mi && mi.querySelectorAll('.src-secret-veil').length === 1
            && mi.textContent.indexOf('SRCMASK-9931') < 0)
        }, BODY2))
        H.t('⑤ 保存往返零写回：重载正文逐字节真原文（遮蔽文本从未进存储）+ 默认遮蔽态回位', true)
      })
    } finally {
      await page.context().close()
    }
  },
}
