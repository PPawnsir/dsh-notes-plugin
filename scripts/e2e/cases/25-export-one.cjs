'use strict'
/* 0.4.5-F 用例㉕（notes-045-export-one）：详情 meta「导出」按钮真实浏览器下载链路——
 * ① 文件名清洗：标题含 / : 非法字符 → 下载文件名落「-」清洗版（Playwright download 事件 suggestedFilename 实证）；
 * ② 正文原样：落盘文件字节 === 笔记正文（不加 front-matter/不擅自加 H1）；
 * ③ 图片引用提示两态：含 ![](assets/…) → 已导出 toast 后紧跟未内联警告 toast；纯文本 → 仅已导出 toast（零警告）；
 * ④ meta 动作区按钮结构锚（down 图标 + 导出文案）。
 * fixture 经 RPC 面预置（先于页面加载）；下载走 Blob + a[download] 纯前端链路（零新 RPC 红线旁证：全程无新增 POST）。 */
const fs = require('fs')
module.exports = {
  name: '㉕ 0.4.5-F：详情页一键导出单篇 MD（真实下载 + 文件名清洗 + 正文原样 + 图片提示两态）',
  async run({ base, browser, H }) {
    /* fixture 预置（RPC 面）：① 含本地图片引用 + 非法字符标题 ② 纯文本笔记 */
    const rpc = (method, args) => fetch(base + '/dsh-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || {} }),
    }).then(r => r.json())
    const imgBody = '导出演示正文\n\n![示意图](assets/demo-pic.png)\n\n末尾行。'
    const nImg = await rpc('notes-create', { title: 'e2e 导出/a:b', body: imgBody })
    const nPlain = await rpc('notes-create', { title: 'e2e 导出纯文本', body: '没有图片引用的正文。' })
    if (!nImg.id || !nPlain.id) throw new Error('fixture 失败：笔记创建 ' + JSON.stringify(nImg))

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + (e && e.message || e)))
    page.__consoleErrors = consoleErrors
    const rpcLog = []   /* 零新 RPC 红线旁证：导出动作不应产生任何 /dsh-notes POST */
    page.on('request', req => {
      try {
        if (req.method() !== 'POST' || req.url().indexOf('/dsh-notes') < 0) return
        rpcLog.push(JSON.parse(req.postData() || '{}').method)
      } catch (e) {}
    })

    try {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForSelector('#tree', { timeout: 15000 })
      await H.step(page, '25-export-one', async () => {
        /* ① 打开含图笔记 → meta 动作区「导出」按钮在位（结构锚） */
        await page.click('#tree .note-row:has-text("e2e 导出/a:b")')
        await H.waitFor(page, '编辑器打开含图笔记', async () => page.evaluate(() => {
          var el = document.querySelector('#edTitle')   /* contenteditable div：读 textContent（非 input.value） */
          return el && el.textContent === 'e2e 导出/a:b'
        }))
        const btnMeta = await page.evaluate(() => {
          var el = document.querySelector('#edMeta #mExport')
          return el ? { text: el.textContent, tip: el.getAttribute('title') || '', hasSvg: !!el.querySelector('svg') } : null
        })
        H.t('meta 动作区「导出」按钮在位（down 图标 + tooltip）', !!btnMeta && btnMeta.text === '导出' && btnMeta.hasSvg && btnMeta.tip.indexOf('Markdown') >= 0, () => JSON.stringify(btnMeta))

        /* ② 点击导出 → 真实下载事件：文件名清洗（/ : → -）+ 正文原样落盘 */
        rpcLog.length = 0
        const dl1 = await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }),
          page.click('#edMeta #mExport'),
        ]).then(a => a[0])
        H.t('含图笔记下载文件名清洗（e2e 导出/a:b → e2e 导出-a-b.md）', dl1.suggestedFilename() === 'e2e 导出-a-b.md', () => '实得「' + dl1.suggestedFilename() + '」')
        const p1 = await dl1.path()
        const c1 = p1 ? fs.readFileSync(p1, 'utf8') : ''
        H.t('落盘正文原样（零 front-matter/零擅加 H1/字节相等）', c1 === imgBody, () => '实得长度 ' + c1.length + '（期望 ' + imgBody.length + '）')
        H.t('导出全程零 /dsh-notes POST（纯前端 Blob，零新 RPC 红线）', rpcLog.length === 0, () => '实得 ' + rpcLog.join(','))

        /* ③ 含图 toast 两态之「有」：已导出 → 未内联警告（后者覆盖前者，可见态为警告） */
        await H.waitFor(page, '图片未内联警告 toast 可见', async () => page.evaluate(() => {
          var el = document.querySelector('#toast.show')
          return el && el.textContent.indexOf('正文含本地图片引用未内联') >= 0
        }))
        H.t('含图导出后提示「未内联，内联分享走设置→导出单文件」', true)

        /* ④ 纯文本笔记：仅「已导出」toast，零警告 */
        await page.click('#tree .note-row:has-text("e2e 导出纯文本")')
        await H.waitFor(page, '编辑器切到纯文本笔记', async () => page.evaluate(() => {
          var el = document.querySelector('#edTitle')
          return el && el.textContent === 'e2e 导出纯文本'
        }))
        const dl2 = await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }),
          page.click('#edMeta #mExport'),
        ]).then(a => a[0])
        H.t('纯文本笔记下载文件名（e2e 导出纯文本.md）', dl2.suggestedFilename() === 'e2e 导出纯文本.md', () => '实得「' + dl2.suggestedFilename() + '」')
        const p2 = await dl2.path()
        H.t('纯文本落盘正文原样', p2 ? fs.readFileSync(p2, 'utf8') === '没有图片引用的正文。' : false)
        await H.waitFor(page, '已导出 toast 可见', async () => page.evaluate(() => {
          var el = document.querySelector('#toast.show')
          return el && el.textContent.indexOf('已导出 e2e 导出纯文本.md') >= 0
        }))
        const toastTxt = await page.evaluate(() => { var el = document.querySelector('#toast.show'); return el ? el.textContent : '' })
        H.t('纯文本导出零图片警告（toast 仅已导出）', toastTxt.indexOf('未内联') < 0, () => '实得「' + toastTxt + '」')

        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '25-export-one')
      })
    } finally { await page.context().close() }
  },
}
