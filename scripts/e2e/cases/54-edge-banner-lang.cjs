'use strict'
/* 0.5.0 用例（notes-050-edge-i18n）app 真机锁：边缘态横幅/工具栏 i18n 补漏。
 * 降级态（任务列表语法触发 degBanner）+ 失败态（notes-get 失败触发 edLoadErr 安全态）切语言 →
 * 横幅静态文案（degBanner1/degBanner2/edLoadErrNote/edLoadRetry）随语言即时翻转，不重建正文 DOM（正文 textarea value 原样）。
 * 浏览器级对应 check 116.7（renderEdLang 扩覆降级/失败横幅/整理遮罩/rtb title 原地重写 + 零正文重建红线）。 */
module.exports = {
  name: '54 0.5.0 边缘态横幅/工具栏 i18n：降级/失败态切语言横幅翻转（app）',
  async run({ base, browser, H }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '54-edge-banner-lang', async () => {
        /* ===== ① 降级态：任务列表语法 → degBanner 可见（zh）===== */
        await H.createNoteViaUI(page, 'e2e边缘降级页', '- [ ] 任务列表项')
        await page.click('#tree .note-row:has-text("e2e边缘降级页")')
        await H.waitFor(page, '降级横幅出现（zh）', async p =>
          p.evaluate(() => { const b = document.getElementById('degBanner'); return b && b.style.display !== 'none' && b.textContent.indexOf('暂不支持富文本编辑的语法') >= 0 }))
        H.t('① zh 基线：降级横幅静态行 + 原因项中文', await page.evaluate(() => {
          const b = document.getElementById('degBanner')
          const rs = (document.getElementById('degReasons') || {}).textContent || ''
          return b.textContent.indexOf('删净对应语法') >= 0 && rs.indexOf('任务列表') >= 0
        }))

        /* ===== ② 切 EN：降级横幅静态两行 + 原因项包裹翻转 + 正文原样 ===== */
        await page.click('#btnLang')
        await H.waitFor(page, '降级横幅切英（degBanner 英文）', async p =>
          p.evaluate(() => { const b = document.getElementById('degBanner'); return b && b.textContent.indexOf('rich text editing does not support yet') >= 0 }))
        H.t('② 切 EN：degBanner 静态两行 + degReasons 包裹翻转 + 正文原样', await page.evaluate(() => {
          const b = document.getElementById('degBanner')
          const rs = (document.getElementById('degReasons') || {}).textContent || ''
          const body = (document.getElementById('edSrc') || {}).value || ''
          return b.textContent.indexOf('rich text editing does not support yet') >= 0
            && b.textContent.indexOf('"Rich text" entry') >= 0
            && b.textContent.indexOf('暂不支持富文本编辑的语法') < 0
            && rs.indexOf('(line 1:') >= 0
            && body.indexOf('- [ ] 任务列表项') >= 0
        }))

        /* ===== ③ 失败态：notes-get 失败 → edLoadErr 安全态横幅（先切回 zh 取基线）===== */
        await page.click('#btnLang')   /* 切回 zh */
        await H.waitFor(page, '切回 zh（degBanner 中文还原）', async p =>
          p.evaluate(() => { const b = document.getElementById('degBanner'); return b && b.textContent.indexOf('暂不支持富文本编辑的语法') >= 0 }))
        await H.createNoteViaUI(page, 'e2e边缘失败页', '失败态演习正文')
        await page.click('#tree .note-row:has-text("e2e边缘失败页")')
        await H.waitFor(page, '失败页正文落定', async p =>
          p.evaluate(() => { const ta = document.getElementById('edSrc'); return ta && ta.value.indexOf('失败态演习正文') >= 0 }))
        const failId = await page.evaluate(() => selId)   /* 当前选中 = 失败页 id */
        await page.evaluate((id) => fetch('/dsh-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'notes-delete', args: { id } }) }).then(r => r.json()), failId)
        await page.evaluate(() => loadEdBody(selId))   /* 服务端已软删 → 当前笔记 get 失败 → 安全态横幅 */
        await H.waitFor(page, '失败横幅出现（zh）', async p =>
          p.evaluate(() => { const b = document.getElementById('edLoadErr'); return b && b.style.display !== 'none' && b.textContent.indexOf('已锁定编辑') >= 0 }))
        H.t('③ zh 基线：loadErr 锁定文案 + 重试中文', await page.evaluate(() =>
          (document.getElementById('edLoadErrNote') || {}).textContent.indexOf('已锁定编辑') >= 0 && (document.getElementById('edLoadRetry') || {}).textContent === '重试'))

        /* ===== ④ 切 EN：失败横幅静态文案 + 重试翻转 ===== */
        await page.click('#btnLang')
        await H.waitFor(page, '失败横幅切英（锁定文案英文）', async p =>
          p.evaluate(() => { const n = document.getElementById('edLoadErrNote'); return n && n.textContent.indexOf('editing locked') >= 0 }))
        H.t('④ 切 EN：loadErr 锁定文案 + 重试翻转', await page.evaluate(() =>
          (document.getElementById('edLoadErrNote') || {}).textContent.indexOf('editing locked') >= 0 && (document.getElementById('edLoadRetry') || {}).textContent === 'Retry'))
        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '54-edge-banner-lang')
      })
    } finally { await page.context().close() }
  },
}
