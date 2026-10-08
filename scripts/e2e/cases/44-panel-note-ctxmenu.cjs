'use strict'
/* 0.4.8 用例㊹（notes-048-note-ctxmenu）：client 面板笔记行右键菜单真机锁（panel-harness 装载发布版 lib/client.js）。
 * 覆盖：右键出菜单 + 冻结四项顺序（+ 分隔线后遗留项保留）+ 移动到…子层（文件夹树/未分类/新建入口）+
 *   移动 RPC 参数锁（rpcCalls 录制 notes-update {id, folder}）+ 置顶翻转 RPC + 派发直开弹窗。
 * 行锚定按 data-note=id（0.4.8 起 client 行补 data-note 属性，与 app noteRow 同构）——不用 has-text 防派生标题子串截胡。 */
const { mountPanel } = require('../panel-harness.cjs')

module.exports = {
  name: '㊹ 面板笔记行右键菜单（冻结四项 + 移动 RPC 参数锁）',
  async run({ browser, H }) {
    const h = await mountPanel(browser, {})
    try {
      await H.step(h.page, '44-panel-note-ctxmenu', async () => {
        await h.openPanel()
        await H.waitFor(h.page, '面板树出现种子笔记行', async () =>
          h.page.evaluate(() => document.querySelectorAll('.dsh-notes-tree .dsh-notes-note-row').length >= 3))
        const noteA = h.state.notes.find(n => n.title === 'e2e 种子笔记 A')
        const noteB = h.state.notes.find(n => n.title === 'e2e 种子笔记 B')
        const rowSel = (id) => '.dsh-notes-tree .dsh-notes-note-row[data-note="' + id + '"]'

        /* ===== 右键出菜单 + 冻结四项顺序 + 遗留项保留 ===== */
        await h.page.click(rowSel(noteA.id), { button: 'right' })
        await h.page.waitForSelector('.dsh-notes-ctxmenu', { timeout: 8000 })
        H.t('右键笔记行出菜单（.dsh-notes-ctxmenu 出现）', true)
        const items = await h.page.evaluate(() => {
          const kids = document.querySelector('.dsh-notes-ctxmenu').children
          const out = []
          for (let i = 0; i < kids.length; i++) out.push(kids[i].classList.contains('dsh-notes-ctxmenu-sep') ? '|' : kids[i].textContent.trim())
          return out
        })
        H.t('冻结四项顺序：移动到…→置顶→派发→删除', items.length >= 5
          && items[0].indexOf('移动到…') >= 0 && items[1].indexOf('置顶') >= 0
          && items[2].indexOf('派发') >= 0 && items[3].indexOf('删除') >= 0, () => '实得：' + JSON.stringify(items))
        H.t('分隔线后遗留项保留（标记已解决/合并为一篇——裁决留注：面板唯一 resolve 入口不删）',
          items.indexOf('|') === 4 && items.slice(5).join('|').indexOf('标记已解决') >= 0 && items.slice(5).join('|').indexOf('合并为一篇') >= 0,
          () => '实得：' + JSON.stringify(items))

        /* ===== 移动到…：子层树 + 移动 RPC 参数锁 ===== */
        await h.page.click('.dsh-notes-ctxmenu .dsh-notes-ctxmenu-item:has-text("移动到…")')
        await H.waitFor(h.page, '子层展开（文件夹行出现）', async () =>
          h.page.evaluate(() => {
            const m = document.querySelector('.dsh-notes-ctxmenu')
            return m && m.textContent.indexOf('工作日志') >= 0 && m.textContent.indexOf('未分类（移出文件夹）') >= 0
          }))
        H.t('子层=文件夹树 + 未分类项 + 新建入口', await h.page.evaluate(() => {
          const m = document.querySelector('.dsh-notes-ctxmenu')
          return m.textContent.indexOf('新建文件夹…') >= 0 && m.querySelectorAll('.dsh-notes-ctxmenu-sub').length >= 3
        }))
        await h.page.click('.dsh-notes-ctxmenu .dsh-notes-ctxmenu-sub:has-text("工作日志")')
        await H.waitFor(h.page, 'toast 已移动到「工作日志」+ 菜单已关', async () =>
          h.page.evaluate(() => {
            const tp = document.querySelector('.dsh-notes-toast')
            return tp && tp.textContent.indexOf('已移动到「工作日志」') >= 0 && !document.querySelector('.dsh-notes-ctxmenu')
          }))
        /* RPC 参数锁：移动到夹 = notes-update 只改 folder 字段（harness rpcCalls 录制证据面） */
        const moveCall = h.rpcCalls.find(c => c.method === 'notes-update' && c.args && c.args.id === noteA.id && c.args.folder !== undefined)
        H.t('移动到夹 RPC 参数锁：notes-update {id, folder: "f-log-e2e"}',
          !!moveCall && moveCall.args.folder === 'f-log-e2e' && Object.keys(moveCall.args).sort().join(',') === 'folder,id',
          () => '实得：' + JSON.stringify(moveCall && moveCall.args))
        H.t('移动后 mock state 落库（A.folder=f-log-e2e）', noteA.folder === 'f-log-e2e')

        /* ===== 置顶翻转（status 通道） ===== */
        await h.page.click(rowSel(noteB.id), { button: 'right' })
        await h.page.waitForSelector('.dsh-notes-ctxmenu', { timeout: 8000 })
        await h.page.click('.dsh-notes-ctxmenu .dsh-notes-ctxmenu-item:has-text("置顶")')
        await H.waitFor(h.page, 'notes-update status=pinned 录制', async () =>
          h.rpcCalls.some(c => c.method === 'notes-update' && c.args && c.args.id === noteB.id && c.args.status === 'pinned'))
        const pinCall = h.rpcCalls.find(c => c.method === 'notes-update' && c.args && c.args.id === noteB.id && c.args.status === 'pinned')
        H.t('置顶翻转 RPC：notes-update {id, status: "pinned"}（meta pin 同款通道）', !!pinCall && Object.keys(pinCall.args).sort().join(',') === 'id,status')

        /* ===== 派发直开弹窗 ===== */
        await h.page.click(rowSel(noteB.id), { button: 'right' })
        await h.page.waitForSelector('.dsh-notes-ctxmenu', { timeout: 8000 })
        await h.page.click('.dsh-notes-ctxmenu .dsh-notes-ctxmenu-item:has-text("派发")')
        await h.page.waitForSelector('.dsh-notes-dispatch-mask', { timeout: 8000 })
        H.t('派发项直开派发弹窗（复用既有 openDispatch 入口）', await h.page.isVisible('.dsh-notes-dispatch-mask'))
        await h.page.click('.dsh-notes-dispatch-cancel')
        await H.waitFor(h.page, '取消关弹窗', async () => h.page.evaluate(() => !document.querySelector('.dsh-notes-dispatch-mask')))

        /* ===== Esc 关菜单 ===== */
        await h.page.click(rowSel(noteA.id), { button: 'right' })
        await h.page.waitForSelector('.dsh-notes-ctxmenu', { timeout: 8000 })
        await h.page.keyboard.press('Escape')
        H.t('Esc 关菜单', await h.page.evaluate(() => !document.querySelector('.dsh-notes-ctxmenu')))

        H.t('无 console error / pageerror', h.consoleErrors.length === 0, () => h.consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(h.page, '44-panel-note-ctxmenu')
      })
    } finally { await h.close() }
  },
}
