'use strict';
/* notes-070-mount-reroute（反馈 n-mw3buwdh39rd）用例 71：挂载弹层「注入范围」区——已挂载笔记在挂载语境二次追加目标会话。
 * 链路锁：注入预览目录行点击（sess-e2e 视角命中 scoped 挂载行）→ MountModal 编辑模式 →
 *   范围区两会话勾选面（sess-e2e 预勾 = 存量 injectTo 经 notes-get 兜底回填；sess-e2e2 未勾）→
 *   勾选第二会话 → 确认 = notes-mount 带 injectTo（scopeTouched 才传）→ mock note injectTo 含两短 id + toast 已挂载索引。
 * 隔离纪律：直推 state.notes 造 'n-' 前缀专属笔记（预览目录行点击解析要求 n- 前缀；不复用种子），不碰其他用例状态。 */
module.exports = {
  name: '71. 挂载弹层注入范围区（notes-070-mount-reroute：已挂载笔记二次挂载到其他会话）',
  async run({ base, browser, H, state }) {
    const { handleRpc } = require('../server.cjs')
    const page = await H.newPage(browser, base)
    const NID = 'n-e2e70reroute'
    try {
      /* 造已挂载 scoped 笔记（reference 档 + injectTo=['sess-e2e'] + 挂载行在案）——即用户反馈场景：已挂载但只进一个会话目录 */
      const ts = new Date().toISOString()
      state.notes.push({
        id: NID, title: 'e2e 71 二挂笔记', body: 'e2e 71 挂载弹层注入范围区演习正文', topic: '',
        kind: 'note', tags: [], status: 'active', pinned: false, inject: true, injectEver: true,
        injectRole: 'reference', injectTo: ['sess-e2e'], recall: true, sensitive: false, hidden: false,
        workspace: 'e2e-workspace', folder: '', sessionId: '', cwd: '', logDate: '', entities: [], summarizedAt: '',
        contractType: '', origin: '', schedule: undefined, mergedFrom: [], dispatches: [], refNote: '', runLog: '',
        useCount: 0, archivedAt: '', createdAt: ts, updatedAt: ts, deleted: false,
      })
      handleRpc(state, 'notes-mount', { id: NID, whenToUse: 'e2e 71 挂载行文案' })
      await H.step(page, '71-mount-reroute', async () => {
        /* 注入预览（sess-e2e 视角命中 scoped 挂载行）→ 目录行点击 → 挂载弹层编辑模式 */
        await page.click('#btnSettings')
        await page.waitForSelector('#setInjectPreview', { timeout: 8000 })
        await page.click('#setInjectPreview')
        await page.waitForSelector('#injprevText', { timeout: 8000 })
        await H.waitFor(page, '视角下拉补齐两会话', async p => p.evaluate(() => {
          var sel = document.querySelector('#injprevSess')
          return sel && sel.querySelectorAll('option').length >= 3   /* 全局 + 两会话 */
        }))
        await page.selectOption('#injprevSess', 'sess-e2e')
        await H.waitFor(page, 'sess-e2e 视角目录段出现 scoped 挂载行', async p =>
          p.evaluate(id => document.querySelector('#injprevText').textContent.indexOf('[[' + id + ']]') >= 0, NID))
        await page.evaluate(id => {
          var lns = document.querySelectorAll('#injprevText .injprev-ln')
          for (var i = 0; i < lns.length; i++) if (lns[i].textContent.indexOf('[[' + id + ']]') >= 0) { lns[i].click(); return }
        }, NID)
        await page.waitForSelector('#injMountWhen', { timeout: 8000 })
        H.t('目录行点击打开挂载弹层（编辑模式预填现有文案）', await page.evaluate(w =>
          document.querySelector('#injMountWhen').value.indexOf(w) >= 0, 'e2e 71 挂载行文案'))
        /* 范围区两会话勾选面：sess-e2e 预勾（存量 injectTo 经 notes-get 兜底回填）+ sess-2e2 未勾（第二会话 short 须 shortSid 回环稳定） */
        await H.waitFor(page, '注入范围区两会话补齐', async p => p.evaluate(() => {
          var host = document.querySelector('#injMountScope')
          return host && !!host.querySelector('input[data-mscope="sess-e2e"]') && !!host.querySelector('input[data-mscope="sess-2e2"]')
        }))
        H.t('范围区显示两会话 + 存量 sess-e2e 预勾 + 第二会话未勾', await page.evaluate(() => {
          var a = document.querySelector('#injMountScope input[data-mscope="sess-e2e"]')
          var b = document.querySelector('#injMountScope input[data-mscope="sess-2e2"]')
          return !!(a && b && a.checked && !b.checked)
        }))
        /* 勾选第二会话 → 确认（scopeTouched → notes-mount 带 injectTo） */
        await page.click('#injMountScope input[data-mscope="sess-2e2"]')
        H.t('勾选第二会话即入勾选态', await page.evaluate(() => document.querySelector('#injMountScope input[data-mscope="sess-2e2"]').checked))
        await page.click('#injMountSave')
        await H.waitFor(page, '确认后挂载弹层关闭', async p => p.evaluate(() => !document.querySelector('#injMountWhen')))
        await H.waitFor(page, 'toast 已挂载索引', async p =>
          p.evaluate(() => { var el = document.querySelector('#toast'); return el && el.textContent.indexOf('已挂载索引') >= 0 }))
        /* mock note injectTo 含两短 id（二次挂载追加目标会话闭环） */
        const g = handleRpc(state, 'notes-get', { id: NID })
        const inj = (g && g.note && g.note.injectTo) || []
        H.t('确认后 mock note injectTo 含两短 id（sess-e2e + sess-2e2）',
          inj.indexOf('sess-e2e') >= 0 && inj.indexOf('sess-2e2') >= 0, () => '实得 ' + JSON.stringify(inj))
        await H.screenshot(page, '71-mount-reroute')
      })
    } finally { await page.context().close() }
  },
}
