'use strict'
/* 0.4.8 用例㊸（notes-048-note-ctxmenu）：app 全窗口页笔记行右键菜单真机锁。
 * 覆盖：菜单开合（右键出菜单/Esc 关/点外关）+ 冻结四项顺序 + 四项动作行为级
 * （置顶翻转 / 派发直开弹窗 / 移动到夹（含子层树/当前归属打勾禁用/未分类移出）/ 删除走既有软删流）+ 视口夹紧（合成右下角事件）。
 * 选行纪律（全套件共享 mock state 教训）：一律按 data-note=id 精确锚定行——has-text 子串会被「定时 e2e 种子笔记 B」
 * 这类前缀派生标题截胡（page.click 选择器串非 strict 命中首个，用例㊷ 之后必翻车）。 */
module.exports = {
  name: '㊸ app 笔记行右键菜单（移动到…/置顶/派发/删除 + 视口夹紧）',
  async run({ base, browser, H, state }) {
    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '43-note-ctxmenu', async () => {
        /* 共享 state 里按标题精确取 id（suite 内可能残留他案派生标题笔记） */
        const idA = state.notes.find(n => n.title === 'e2e 种子笔记 A' && !n.deleted).id
        const idB = state.notes.find(n => n.title === 'e2e 种子笔记 B' && !n.deleted).id
        const rowA = '#tree .note-row[data-note="' + idA + '"]'
        const rowB = '#tree .note-row[data-note="' + idB + '"]'
        /* ===== 菜单开合 + 冻结四项顺序 ===== */
        await page.click(rowA, { button: 'right' })
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        H.t('右键笔记行出菜单（#ctxMenu 出现）', true)
        const items = await page.evaluate(() => {
          var mis = document.querySelectorAll('#ctxMenu > .mi')
          var out = []
          for (var i = 0; i < mis.length; i++) out.push(mis[i].textContent.trim())
          return out
        })
        H.t('冻结四项顺序：移动到…→置顶→派发→删除', items.length === 4
          && items[0].indexOf('移动到…') >= 0 && items[1].indexOf('置顶') >= 0
          && items[2].indexOf('派发') >= 0 && items[3].indexOf('删除') >= 0, () => '实得：' + JSON.stringify(items))
        H.t('右键即选中（该行获得 sel 态）', await page.evaluate((id) => {
          var m = document.querySelector('#ctxMenu'); if (!m) return false
          var row = document.querySelector('#tree .note-row[data-note="' + id + '"]')
          return !!(row && row.classList.contains('sel'))
        }, idA))
        await page.keyboard.press('Escape')
        H.t('Esc 关菜单', await page.evaluate(() => !document.querySelector('#ctxMenu')))
        /* 点外关 */
        await page.click(rowA, { button: 'right' })
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        await page.mouse.click(700, 450)   /* 菜单外空白处（左键 mousedown 触发点外关） */
        H.t('点外关菜单', await page.evaluate(() => !document.querySelector('#ctxMenu')))

        /* ===== 置顶翻转 ===== */
        await page.click(rowA, { button: 'right' })
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        await page.click('#ctxMenu .mi:has-text("置顶")')
        await H.waitFor(page, 'toast 已置顶', async p => p.evaluate(() => {
          var el = document.querySelector('#toast'); return el && el.textContent.indexOf('已置顶') >= 0
        }))
        H.t('置顶动作：toast 已置顶 + 菜单已关', await page.evaluate(() => !document.querySelector('#ctxMenu')))
        const noteA = state.notes.find(n => n.id === idA)
        H.t('置顶落库（mock state status=pinned）', noteA.status === 'pinned', () => 'status=' + noteA.status)
        H.t('行首 pin 图标出现', await page.evaluate((id) => {
          var row = document.querySelector('#tree .note-row[data-note="' + id + '"]')
          return !!(row && row.querySelector('svg.pin'))
        }, idA))
        /* 再右键 = 取消置顶项（翻转文案） */
        await page.click(rowA, { button: 'right' })
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        H.t('再右键显示「取消置顶」（翻转）', await page.evaluate(() => {
          var m = document.querySelector('#ctxMenu'); return m && m.textContent.indexOf('取消置顶') >= 0
        }))
        await page.keyboard.press('Escape')

        /* ===== 派发直开弹窗 ===== */
        await page.click(rowB, { button: 'right' })
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        await page.click('#ctxMenu .mi:has-text("派发")')
        await page.waitForSelector('#dOk', { timeout: 8000 })
        H.t('派发项直开派发弹窗（#dOk 可见，复用既有入口）', await page.isVisible('#dOk'))
        await page.keyboard.press('Escape')
        H.t('Esc 关派发弹窗', await page.evaluate(() => !document.querySelector('#dOk')))

        /* ===== 移动到…（子层树 / 打勾禁用 / 未分类移出）===== */
        await H.createFolderViaUI(page, 'e2e菜单夹')
        const fMenu = state.folders.find(f => f.name === 'e2e菜单夹')
        const noteB = state.notes.find(n => n.id === idB)
        if (noteB.folder) {   /* 套件共享态防御：他案可能已把 B 移入某夹——先经菜单移出归位未分类 */
          await page.click(rowB, { button: 'right' })
          await page.waitForSelector('#ctxMenu', { timeout: 8000 })
          await page.click('#ctxMenu .mi:has-text("移动到…")')
          await H.waitFor(page, '子层展开', async p => p.evaluate(() => {
            var m = document.querySelector('#ctxMenu'); return m && m.querySelectorAll('.mi.sub').length >= 2
          }))
          await page.click('#ctxMenu .mi.sub:has-text("未分类（移出文件夹）")')
          await H.waitFor(page, 'B 归位未分类', async p => p.evaluate(() => {
            var el = document.querySelector('#toast'); return el && el.textContent.indexOf('已移出文件夹') >= 0
          }))
        }
        await page.click(rowB, { button: 'right' })
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        await page.click('#ctxMenu .mi:has-text("移动到…")')
        await H.waitFor(page, '子层展开（菜单仍在 + 子项出现）', async p => p.evaluate(() => {
          var m = document.querySelector('#ctxMenu'); return m && m.querySelectorAll('.mi.sub').length >= 2
        }))
        const subTxt = await page.evaluate(() => document.querySelector('#ctxMenu').textContent)
        H.t('子层=文件夹树 + 未分类项（工作日志/e2e菜单夹/未分类（移出文件夹））',
          subTxt.indexOf('工作日志') >= 0 && subTxt.indexOf('e2e菜单夹') >= 0 && subTxt.indexOf('未分类（移出文件夹）') >= 0, () => '实得：' + subTxt)
        await page.click('#ctxMenu .mi.sub:has-text("e2e菜单夹")')
        await H.waitFor(page, 'toast 已移动到 e2e菜单夹', async p => p.evaluate(() => {
          var el = document.querySelector('#toast'); return el && el.textContent.indexOf('已移动到「e2e菜单夹」') >= 0
        }))
        H.t('移动落库 RPC 参数锁（notes-update folder=目标夹 id）', !!(fMenu && noteB.folder === fMenu.id), () => 'folder=' + noteB.folder)
        await H.waitFor(page, 'B 行渲染在 e2e菜单夹 .nested 内', async p => p.evaluate((id) => {
          var row = document.querySelector('#tree .nested .note-row[data-note="' + id + '"]')
          if (!row) return false
          var head = row.closest('.nested').previousElementSibling
          return !!(head && head.classList.contains('head') && head.textContent.indexOf('e2e菜单夹') >= 0)
        }, idB))
        H.t('移动后树刷新（行入夹）', true)
        /* 当前归属打勾禁用：再右键 B → 移动到… → e2e菜单夹项 ✓ + dis，点击无动作 */
        await page.click(rowB, { button: 'right' })
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        await page.click('#ctxMenu .mi:has-text("移动到…")')
        await H.waitFor(page, '子层展开', async p => p.evaluate(() => {
          var m = document.querySelector('#ctxMenu'); return m && m.querySelectorAll('.mi.sub').length >= 2
        }))
        H.t('当前归属项打勾禁用（✓ + .dis + 无 data-mv）', await page.evaluate(() => {
          var subs = document.querySelectorAll('#ctxMenu .mi.sub')
          for (var i = 0; i < subs.length; i++) {
            if (subs[i].textContent.indexOf('e2e菜单夹') >= 0)
              return subs[i].textContent.indexOf('✓') >= 0 && subs[i].classList.contains('dis') && !subs[i].hasAttribute('data-mv')
          }
          return false
        }))
        await page.click('#ctxMenu .mi.sub:has-text("e2e菜单夹")')   /* 禁用项点击 = 无动作 */
        H.t('禁用项点击无动作（仍在夹内 + 菜单仍开）', await page.evaluate(() => !!document.querySelector('#ctxMenu')) && noteB.folder === fMenu.id)
        /* 未分类（移出文件夹） */
        await page.click('#ctxMenu .mi.sub:has-text("未分类（移出文件夹）")')
        await H.waitFor(page, 'toast 已移出文件夹', async p => p.evaluate(() => {
          var el = document.querySelector('#toast'); return el && el.textContent.indexOf('已移出文件夹') >= 0
        }))
        H.t('移出落库（folder 归空串）', noteB.folder === '', () => 'folder=' + noteB.folder)

        /* ===== 视口夹紧（合成右下角 contextmenu：clientX/clientY 贴近视口右下） ===== */
        await page.evaluate((id) => {
          var row = document.querySelector('#tree .note-row[data-note="' + id + '"]')
          row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: window.innerWidth - 6, clientY: window.innerHeight - 6 }))
        }, idA)
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        H.t('视口夹紧：菜单完整落入视口（right/bottom 不溢出）', await page.evaluate(() => {
          var r = document.querySelector('#ctxMenu').getBoundingClientRect()
          return r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.left >= 0 && r.top >= 0
        }))
        /* 子层展开态重夹紧 */
        await page.click('#ctxMenu .mi:has-text("移动到…")')
        await H.waitFor(page, '子层展开', async p => p.evaluate(() => {
          var m = document.querySelector('#ctxMenu'); return m && m.querySelectorAll('.mi.sub').length >= 2
        }))
        H.t('视口夹紧：子层展开后仍不溢出（重渲重夹紧 + CSS max-height 兜底）', await page.evaluate(() => {
          var r = document.querySelector('#ctxMenu').getBoundingClientRect()
          return r.right <= window.innerWidth && r.bottom <= window.innerHeight
        }))
        await page.keyboard.press('Escape')

        /* ===== 删除走既有软删流（普通笔记无 confirm，软删 + 撤销 toast） ===== */
        await page.click(rowB, { button: 'right' })
        await page.waitForSelector('#ctxMenu', { timeout: 8000 })
        await page.click('#ctxMenu .mi.danger:has-text("删除")')
        await H.waitFor(page, 'toast 已删除（含撤销）', async p => p.evaluate(() => {
          var el = document.querySelector('#toast'); return el && el.textContent.indexOf('已删除') >= 0
        }))
        H.t('删除落库（软删 deleted=true，回收站可恢复）', noteB.deleted === true)
        H.t('删除后树中该行消失', await page.evaluate((id) =>
          !document.querySelector('#tree .note-row[data-note="' + id + '"]'), idB))

        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '43-note-ctxmenu')
      })
    } finally { await page.context().close() }
  },
}
