'use strict'
/* 0.4.4-C 用例⑱（notes-044-folder-explicit-view，用户裁决：文件夹展开 = sys 显式入口——默认降噪不阻拦查看）：
 * 缺省档（不勾选「机器」）下「记忆档案」夹展开即可见 sys 档案行（app 端全链路：loadNotes → refreshSysKids 按需
 * notes-list {folder:id} 补拉 → sysKids 合并渲染），惰性/缓存/防陈旧/降噪红线逐项锁：
 *   ① 缺省全展开首载即补拉（「记忆档案」场景：徽标有值 → 展开有行）；② 普通夹零 folder 请求（惰性闸）；
 *   ③ 折叠→展开缓存复用零新请求；④ 刷新后重拉覆盖（防陈旧）；⑤ 搜索激活时 sys 行不混入（⑨ 零放松）；
 *   ⑥ 未入夹 sys 索引根仍不可见（⑨ 未分类平铺排除）；⑦ sys 行带「机器」chip。
 * fixture 经 RPC 面预置（kind=sys 档案入夹 + 未入夹 sys 各 1），UI 断言全走真实 DOM；
 * RPC 侦测走 page.on('request') 旁记（folder 定向请求计数 = 惰性/缓存/防陈旧的判据）。 */
module.exports = {
  name: '⑱ 文件夹显式展开放行 sys：缺省档展开即见档案行 + 惰性零请求 + 缓存复用 + 刷新重拉 + 搜索不混入 + 机器 chip',
  async run({ base, browser, H }) {
    /* fixture 预置（RPC 面，先于页面加载）：「记忆档案」夹 + 夹内 sys 档案 + 未入夹 sys 索引根 */
    const rpc = (method, args) => fetch(base + '/dsh-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || {} }),
    }).then(r => r.json())
    const fRes = await rpc('notes-folders', { op: 'create', name: '机器档案C' })
    const archFolderId = fRes && fRes.folder && fRes.folder.id
    if (!archFolderId) throw new Error('fixture 失败：机器档案C夹创建返回 ' + JSON.stringify(fRes))
    const arch = await rpc('notes-create', { title: '记忆 @e2e 展开记忆 · 档案', body: '[[n-e2e]]\n\n## 引用记录（自动）\n', kind: 'sys', topic: '机器档案C', tags: ['自动'], folder: archFolderId })
    const idxRoot = await rpc('notes-create', { title: 'e2e 机器索引根（未入夹 sys）', body: 'x', kind: 'sys' })
    if (!arch.id || !idxRoot.id) throw new Error('fixture 失败：sys 笔记创建')

    /* 手工建页（H.newPage 等价 + 先挂 request 侦测再 goto——folder 定向请求计数从首载起算） */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const consoleErrors = []
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + (e && e.message || e)))
    page.__consoleErrors = consoleErrors
    const rpcLog = []   /* { method, folder } —— 只记 /dsh-notes POST */
    page.on('request', req => {
      try {
        if (req.method() !== 'POST' || req.url().indexOf('/dsh-notes') < 0) return
        const b = JSON.parse(req.postData() || '{}')
        rpcLog.push({ method: b.method, folder: b.args && b.args.folder })
      } catch (e) {}
    })
    const folderFetchN = fid => rpcLog.filter(r => r.method === 'notes-list' && r.folder === fid).length

    try {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForSelector('#tree', { timeout: 15000 })
      await H.step(page, '18-folder-sys-expand', async () => {
        const rowCnt = kw => page.evaluate(k => {
          var n = 0
          document.querySelectorAll('#tree .note-row .ti').forEach(function (el) { if (el.textContent.indexOf(k) >= 0) n++ })
          return n
        }, kw)
        const clickFolder = nm => page.evaluate(name => {
          var rows = document.querySelectorAll('#tree .row.head[data-fold]')
          for (var i = 0; i < rows.length; i++) {
            var nmEl = rows[i].querySelector('.nm')
            if (nmEl && nmEl.textContent === name) { rows[i].click(); return true }
          }
          return false
        }, nm)

        /* ① 缺省档首载（缺省全展开 = 展开态显式入口）：sys 档案行补拉出现在「机器档案C」.nested 内，带「机器」chip */
        await H.waitFor(page, '缺省档「记忆档案」展开即见 sys 档案行', async () => (await rowCnt('e2e 展开记忆')) === 1)
        const inNestedWithChip = await page.evaluate(() => {
          var rows = document.querySelectorAll('#tree .nested .note-row')
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].textContent.indexOf('e2e 展开记忆') >= 0) return rows[i].textContent.indexOf('机器') >= 0
          }
          return false
        })
        H.t('sys 档案行渲染在「记忆档案」.nested 子容器内且带「机器」chip', inNestedWithChip)
        H.t('徽标计数与展开行数一致（count=1 → 恰 1 行，不再死节点）', (await rowCnt('e2e 展开记忆')) === 1)
        /* ⑥ 未入夹 sys 索引根仍不可见（⑨ 未分类平铺排除零放松） */
        H.t('缺省档树不含未入夹 sys 索引根（⑨ 零放松）', (await rowCnt('e2e 机器索引根')) === 0)
        /* ② 惰性：普通夹（工作日志夹，count==缓存可见数）零 folder 定向请求；日志行照常（kids 等价口径） */
        H.t('普通夹零 folder 定向请求（惰性闸：无隐藏 sys 不发请求）', folderFetchN('f-log-e2e') === 0, () => '实得 ' + folderFetchN('f-log-e2e') + ' 次')
        H.t('普通夹日志子行照常渲染（kids 口径与 0.4.3 等价）', (await rowCnt('日志条目 · 沉淀样板')) === 1)

        /* ③ 折叠→展开：缓存复用零新请求（折叠不清缓存） */
        const n0 = folderFetchN(archFolderId)
        H.t('首载补拉恰 1 次定向 {folder} 请求', n0 === 1, () => '实得 ' + n0 + ' 次')
        H.t('点击折叠「机器档案C」', await clickFolder('机器档案C'))
        await H.waitFor(page, '折叠后 sys 档案行消失', async () => (await rowCnt('e2e 展开记忆')) === 0)
        H.t('点击再展开「机器档案C」', await clickFolder('机器档案C'))
        await H.waitFor(page, '再展开 sys 档案行复现', async () => (await rowCnt('e2e 展开记忆')) === 1)
        H.t('折叠→再展开零新请求（新鲜缓存复用）', folderFetchN(archFolderId) === n0, () => '实得 ' + folderFetchN(archFolderId) + ' 次（基准 ' + n0 + '）')

        /* ④ 刷新按钮 → 列表换代 → refreshSysKids 重拉展开夹覆盖（防陈旧），行不丢 */
        await page.click('#btnRefresh')
        await H.waitFor(page, '刷新后重拉该夹（防陈旧）', async () => folderFetchN(archFolderId) === n0 + 1)
        H.t('刷新后 sys 档案行仍在（重拉覆盖，不闪断）', (await rowCnt('e2e 展开记忆')) === 1)

        /* ⑤ 搜索激活：sys 行不混入（⑨ 搜索降噪零放松）；清空搜索即恢复 */
        await page.click('#q')
        await page.fill('#q', 'e2e')
        await H.waitFor(page, '搜索激活时 sys 档案行不混入', async () => (await rowCnt('e2e 展开记忆')) === 0)
        H.t('搜索激活时普通种子笔记照常命中（主题聚合区可重复渲染，≥1 即命中——用例⑩ 同口径）', (await rowCnt('e2e 种子笔记 A')) >= 1)
        await page.fill('#q', '')
        await H.waitFor(page, '清空搜索后 sys 档案行恢复', async () => (await rowCnt('e2e 展开记忆')) === 1)

        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '18-folder-sys-expand')
      })
    } finally { await page.context().close() }
  },
}
