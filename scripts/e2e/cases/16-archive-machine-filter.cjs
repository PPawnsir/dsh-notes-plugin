'use strict'
/* 0.4.3⑩ 用例⑯（notes-043-archive-folder 第二轮裁决：面板翻账本入口真实链路探针）：
 * 筛选中心「机器」档（FILTER_KINDS +sys）——勾选后列表取数传 {kind:'sys'} 走 host 显式 kind 通道（⑨ 保留），
 * 全库 sys 笔记（含「记忆档案」夹内档案）直达面板，树内文件夹正常展开子行；取消勾选即回 ⑨ 缺省降噪。
 * 附带验③：folders 计数 includeSys——缺省档「记忆档案」徽标即显示真实计数（不再是 count=0 死节点）。
 * fixture 经 RPC 面预置（kind=sys 档案入夹 + 未入夹 sys 各 1），UI 断言全走真实 DOM。 */
module.exports = {
  name: '⑯ 机器档翻账本：缺省档降噪不含 sys + 勾选「机器」后「记忆档案」夹展开可见档案行 + 徽标计数真实',
  async run({ base, browser, H }) {
    /* fixture 预置（RPC 面，先于页面加载）：「记忆档案」夹 + 夹内 sys 档案 + 未入夹 sys 索引根 */
    const rpc = (method, args) => fetch(base + '/dsh-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || {} }),
    }).then(r => r.json())
    const fRes = await rpc('notes-folders', { op: 'create', name: '记忆档案' })
    const archFolderId = fRes && fRes.folder && fRes.folder.id
    if (!archFolderId) throw new Error('fixture 失败：记忆档案夹创建返回 ' + JSON.stringify(fRes))
    const arch = await rpc('notes-create', { title: '记忆 @e2e 账本记忆 · 档案', body: '[[n-e2e]]\n\n## 引用记录（自动）\n', kind: 'sys', topic: '记忆档案', tags: ['自动'], folder: archFolderId })
    const idxRoot = await rpc('notes-create', { title: 'e2e 机器索引根（未入夹 sys）', body: 'x', kind: 'sys' })
    if (!arch.id || !idxRoot.id) throw new Error('fixture 失败：sys 笔记创建')

    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '16-archive-machine-filter', async () => {
        const rowCnt = kw => page.evaluate(k => {
          var n = 0
          document.querySelectorAll('#tree .note-row .ti').forEach(function (el) { if (el.textContent.indexOf(k) >= 0) n++ })
          return n
        }, kw)
        const folderBadge = nm => page.evaluate(name => {
          var rows = document.querySelectorAll('#tree .row.head[data-fold]')
          for (var i = 0; i < rows.length; i++) {
            var nmEl = rows[i].querySelector('.nm')
            if (nmEl && nmEl.textContent === name) { var nEl = rows[i].querySelector('.n'); return nEl ? nEl.textContent.trim() : '(无 .n)' }
          }
          return null
        }, nm)

        /* ① 缺省档（⑨ 降噪）：sys 档案/索引根均不可见；「记忆档案」夹节点在且徽标 = 真实计数 1（③ includeSys 计数） */
        H.t('缺省档树不含 sys 档案行（⑨ 降噪零放松）', (await rowCnt('e2e 账本记忆')) === 0)
        H.t('缺省档树不含未入夹 sys 索引根', (await rowCnt('e2e 机器索引根')) === 0)
        H.t('缺省档「记忆档案」夹徽标 = 1（③ 计数含 sys，非 count=0 死节点）', (await folderBadge('记忆档案')) === '1', () => '实得徽标 ' + folderBadge('记忆档案'))
        H.t('缺省档普通种子笔记照常可见', (await rowCnt('e2e 种子笔记 A')) === 1)

        /* ② 勾选「机器」档：filter popover 内 sys 选项存在且标签为「机器」 */
        await page.click('#btnFilter')
        await page.waitForSelector('#fpop input[data-fk="sys"]', { timeout: 8000 })
        const sysLabel = await page.evaluate(() => {
          var cb = document.querySelector('#fpop input[data-fk="sys"]')
          return cb && cb.closest('label') ? cb.closest('label').textContent.trim() : ''
        })
        H.t('筛选中心类型组含「机器」档（data-fk=sys + 标签文案）', sysLabel.indexOf('机器') >= 0, () => '实得标签 ' + sysLabel)

        await page.click('#fpop input[data-fk="sys"]')
        /* ③ 机器档生效：取数口径切换（{kind:'sys'}）→ 档案行出现且渲染在「记忆档案」夹 .nested 子容器内（过滤态自动展开） */
        await H.waitFor(page, '机器档下档案行出现', async () => (await rowCnt('e2e 账本记忆')) >= 1)
        const inNested = await page.evaluate(() => {
          var rows = document.querySelectorAll('#tree .nested .note-row')
          for (var i = 0; i < rows.length; i++) if (rows[i].textContent.indexOf('e2e 账本记忆') >= 0) return true
          return false
        })
        H.t('档案行渲染在「记忆档案」夹 .nested 子容器内（树展开可见 = 翻账本入口恢复）', inNested)
        H.t('机器档下未入夹 sys 索引根同见（全库 sys 口径）', (await rowCnt('e2e 机器索引根')) === 1)
        H.t('机器档下普通笔记不入 corpus（恰选单 kind 传 host）', (await rowCnt('e2e 种子笔记 A')) === 0)
        H.t('机器档下「记忆档案」徽标 = 1（过滤态子树命中计数）', (await folderBadge('记忆档案')) === '1', () => '实得徽标 ' + folderBadge('记忆档案'))

        /* ④ 取消勾选 → 回 ⑨ 缺省降噪（档案行消失、种子回来） */
        await page.click('#fpop input[data-fk="sys"]')
        await H.waitFor(page, '取消机器档后档案行消失', async () => (await rowCnt('e2e 账本记忆')) === 0)
        H.t('取消后缺省降噪恢复（sys 行消失）', true)
        H.t('取消后普通种子笔记恢复可见', (await rowCnt('e2e 种子笔记 A')) === 1)

        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '16-archive-machine-filter')
      })
    } finally { await page.context().close() }
  },
}
