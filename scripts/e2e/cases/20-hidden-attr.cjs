'use strict'
/* 0.4.4-D 用例⑳（notes-044-hidden-attr，用户裁决：OS 文件管理完整对齐——显隐开关 + 纯 UI 遮罩 + 跳转常显）：
 * 全链路锁：① 缺省（开关关）hidden 笔记/hidden 夹/夹内普通笔记（父夹子树语义）全部不渲染；
 *   ② 筛选中心「显示隐藏」开 → hidden 行带 hid 遮罩 class 渲染（夹行+笔记行+夹内子行）；
 *   ③ localStorage 独立键持久（dsh-notes-app-show-hidden）+ 刷新后开关态保持；
 *   ④ 开关关回 → 三行再消失；⑤ meta 区 hidden chip 常显（跳转/打开路径不受影响）且点击切回（取消隐藏后 hid 摘除）；
 *   ⑥ 文件夹右键「取消隐藏」→ 夹行 hid 摘除；⑦ host 面零过滤（fixture 即 RPC 面直达）。
 * fixture 经 RPC 面预置（hidden 笔记 1 + hidden 夹 1 + 夹内普通笔记 1），UI 断言全走真实 DOM。 */
module.exports = {
  name: '⑳ hidden 隐藏属性：缺省遮罩滤除 + 显隐开关 + hid 样式 + 持久化 + meta chip 切回 + 文件夹右键取消隐藏',
  async run({ base, browser, H }) {
    /* fixture 预置（RPC 面，先于页面加载） */
    const rpc = (method, args) => fetch(base + '/dsh-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || {} }),
    }).then(r => r.json())
    const nh = await rpc('notes-create', { title: 'e2e 隐藏笔记甲乙', body: 'hidden 正文', topic: 'e2e', hidden: true })
    if (!nh.id) throw new Error('fixture 失败：hidden 笔记创建')
    const fh = await rpc('notes-folders', { op: 'create', name: 'e2e 隐藏文件夹' })
    const fhId = fh && fh.folder && fh.folder.id
    if (!fhId) throw new Error('fixture 失败：hidden 夹创建')
    const sf = await rpc('notes-folders', { op: 'set-flags', id: fhId, hidden: true })
    if (!sf || sf.hidden !== true) throw new Error('fixture 失败：set-flags 回执 ' + JSON.stringify(sf))
    const nk = await rpc('notes-create', { title: 'e2e 夹内普通笔记', body: '夹内正文', topic: 'e2e', folder: fhId })
    if (!nk.id) throw new Error('fixture 失败：夹内普通笔记创建')

    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '20-hidden-attr', async () => {
        /* 行查询 helper：cnt=标题命中行数；hidCnt=其中带 hid 遮罩 class 的行数 */
        const rowStat = kw => page.evaluate(k => {
          var cnt = 0, hidCnt = 0
          document.querySelectorAll('#tree .note-row').forEach(function (el) {
            var ti = el.querySelector('.ti')
            if (ti && ti.textContent.indexOf(k) >= 0) { cnt++; if (el.classList.contains('hid')) hidCnt++ }
          })
          return { cnt: cnt, hidCnt: hidCnt }
        }, kw)
        const foldStat = nm => page.evaluate(name => {
          var cnt = 0, hidCnt = 0
          document.querySelectorAll('#tree .row.head[data-fold]').forEach(function (el) {
            var nmEl = el.querySelector('.nm')
            if (nmEl && nmEl.textContent === name) { cnt++; if (el.classList.contains('hid')) hidCnt++ }
          })
          return { cnt: cnt, hidCnt: hidCnt }
        }, nm)
        /* 显隐开关动作：开筛选中心 → 点「显示隐藏」checkbox（data-fh）→ 关浮层 */
        const setShowHidden = async (on) => {
          await page.click('#btnFilter')
          await page.waitForSelector('#fpop input[data-fh]', { timeout: 8000 })
          const cur = await page.evaluate(() => document.querySelector('#fpop input[data-fh]').checked)
          if (cur !== on) await page.click('#fpop input[data-fh]')
          await page.click('#btnFilter')   /* 关浮层（避免遮挡后续点击） */
        }

        /* ① 缺省（开关关）：hidden 笔记 / hidden 夹 / 夹内普通笔记（OS 父夹子树语义）全部不渲染 */
        H.t('缺省档 hidden 笔记行不渲染', (await rowStat('e2e 隐藏笔记甲乙')).cnt === 0)
        H.t('缺省档 hidden 文件夹行不渲染', (await foldStat('e2e 隐藏文件夹')).cnt === 0)
        H.t('缺省档 hidden 夹内普通笔记随容器消失（OS 子树语义）', (await rowStat('e2e 夹内普通笔记')).cnt === 0)
        H.t('缺省档普通种子笔记照常（遮罩不误伤）', (await rowStat('e2e 种子笔记 A')).cnt >= 1)

        /* ② 开关开：三行渲染且 hidden 行带 hid 遮罩 class（夹内普通笔记自身未 hidden → 无 hid） */
        await setShowHidden(true)
        await H.waitFor(page, '开关开后 hidden 笔记行出现', async () => (await rowStat('e2e 隐藏笔记甲乙')).cnt === 1)
        let st = await rowStat('e2e 隐藏笔记甲乙')
        H.t('hidden 笔记行带 hid 遮罩 class', st.cnt === 1 && st.hidCnt === 1)
        st = await foldStat('e2e 隐藏文件夹')
        H.t('hidden 文件夹行渲染且带 hid 遮罩 class', st.cnt === 1 && st.hidCnt === 1)
        st = await rowStat('e2e 夹内普通笔记')
        H.t('夹内普通笔记随夹显示（自身未 hidden → 无 hid）', st.cnt === 1 && st.hidCnt === 0)

        /* ③ localStorage 独立键持久 + 刷新后开关态保持 */
        H.t('localStorage 独立键持久（dsh-notes-app-show-hidden=1）', await page.evaluate(() => localStorage.getItem('dsh-notes-app-show-hidden') === '1'))
        await page.reload({ waitUntil: 'load' })
        await page.waitForSelector('#tree', { timeout: 15000 })
        await H.waitFor(page, '刷新后 hidden 行仍渲染（开关态持久）', async () => (await rowStat('e2e 隐藏笔记甲乙')).cnt === 1)

        /* ④ 开关关回：三行再消失 */
        await setShowHidden(false)
        await H.waitFor(page, '开关关回后 hidden 行消失', async () => (await rowStat('e2e 隐藏笔记甲乙')).cnt === 0)
        H.t('开关关回：hidden 夹行消失', (await foldStat('e2e 隐藏文件夹')).cnt === 0)
        H.t('开关关回：夹内普通笔记消失', (await rowStat('e2e 夹内普通笔记')).cnt === 0)

        /* ⑤ meta chip：开关开 → 点 hidden 笔记行打开编辑器 → chip 常显 on → 点击切回（取消隐藏，行留列表且摘 hid） */
        await setShowHidden(true)
        await H.waitFor(page, '重开开关后 hidden 笔记行复现', async () => (await rowStat('e2e 隐藏笔记甲乙')).cnt === 1)
        await page.evaluate(() => {
          document.querySelectorAll('#tree .note-row').forEach(function (el) {
            var ti = el.querySelector('.ti')
            if (ti && ti.textContent.indexOf('e2e 隐藏笔记甲乙') >= 0) el.click()
          })
        })
        await page.waitForSelector('#mHidden', { timeout: 8000 })
        H.t('meta 区 hidden chip 常显且为 on（hidden 笔记编辑器正常打开——跳转/打开路径零拦截）',
          await page.evaluate(() => { var el = document.querySelector('#mHidden'); return !!el && el.classList.contains('on') && !!document.querySelector('#edTitle') }))
        await page.click('#mHidden')
        await H.waitFor(page, 'chip 切回后行摘除 hid（取消隐藏，行留列表）', async () => {
          const s = await rowStat('e2e 隐藏笔记甲乙'); return s.cnt === 1 && s.hidCnt === 0
        }, 12000)

        /* ⑥ 文件夹右键「取消隐藏」→ 夹行 hid 摘除 */
        const frow = page.locator('#tree .row.head[data-fold]', { hasText: 'e2e 隐藏文件夹' }).first()
        await frow.click({ button: 'right' })
        await page.waitForSelector('#ctxMenu .mi[data-a="hide"]', { timeout: 8000 })
        H.t('右键菜单项为「取消隐藏」（hidden 夹态）', await page.evaluate(() => {
          var mi = document.querySelector('#ctxMenu .mi[data-a="hide"]'); return !!mi && mi.textContent.indexOf('取消隐藏') >= 0
        }))
        await page.click('#ctxMenu .mi[data-a="hide"]')
        await H.waitFor(page, '取消隐藏后夹行摘除 hid', async () => {
          const s = await foldStat('e2e 隐藏文件夹'); return s.cnt === 1 && s.hidCnt === 0
        }, 12000)

        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '20-hidden-attr')
      })
    } finally { await page.context().close() }
  },
}
