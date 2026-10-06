'use strict'
/* 0.4.4-G 用例㉒（notes-044-sys-folders，用户裁决 2026-10-06：自动沉淀文件夹 sys 机器属性——默认隐身 + 显式入口不阻拦）：
 * 全链路锁：① 缺省档（机器档/显示隐藏双通道均关）sys 夹行 + 夹内普通笔记（OS 父子树语义）全部不渲染；
 *   ② 筛选中心「机器」档选中 → sys 夹渲染（行名带机器托管 tooltip）+ 夹内 sys 档案行经 kind 通道可见；
 *   ③「显示隐藏」开关开 → sys 夹同渲染（双通道并集，任一开即见）；④ 右键「取消机器属性」→ 摘除后缺省档即常显（墓碑不回弹）；
 *   ⑤ 再右键「标记为机器文件夹」→ 缺省档再消失（可逆往返）；⑥ 普通夹/种子笔记零影响。
 * fixture 经 RPC 面预置（sys 夹 1 + 夹内普通笔记 1 + 夹内 sys 档案 1），UI 断言全走真实 DOM。 */
module.exports = {
  name: '㉒ sys 机器属性文件夹：缺省隐身 + 机器档/显示隐藏双通道放行 + 右键摘除/标记往返',
  async run({ base, browser, H }) {
    /* fixture 预置（RPC 面，先于页面加载） */
    const rpc = (method, args) => fetch(base + '/dsh-notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args: args || {} }),
    }).then(r => r.json())
    const fs0 = await rpc('notes-folders', { op: 'create', name: 'e2e 机器沉淀夹' })
    const fId = fs0 && fs0.folder && fs0.folder.id
    if (!fId) throw new Error('fixture 失败：机器夹创建')
    const sf = await rpc('notes-folders', { op: 'set-flags', id: fId, sys: true })
    if (!sf || sf.sys !== true) throw new Error('fixture 失败：set-flags sys 回执 ' + JSON.stringify(sf))
    const nk = await rpc('notes-create', { title: 'e2e 机器夹内普通笔记', body: '夹内正文', topic: 'e2e', folder: fId })
    const ns = await rpc('notes-create', { title: 'e2e 机器夹内档案', body: '[[n-x]]\n', kind: 'sys', topic: '记忆档案', folder: fId })
    if (!nk.id || !ns.id) throw new Error('fixture 失败：夹内笔记创建')

    const page = await H.newPage(browser, base)
    try {
      await H.step(page, '22-sys-folder-attr', async () => {
        /* 行查询 helper：cnt=标题命中行数 */
        const rowCnt = kw => page.evaluate(k => {
          var n = 0
          document.querySelectorAll('#tree .note-row .ti').forEach(function (el) { if (el.textContent.indexOf(k) >= 0) n++ })
          return n
        }, kw)
        /* 夹行查询：{cnt, tip}=名称命中行数与行名 title */
        const foldStat = nm => page.evaluate(name => {
          var cnt = 0, tip = ''
          document.querySelectorAll('#tree .row.head[data-fold]').forEach(function (el) {
            var nmEl = el.querySelector('.nm')
            if (nmEl && nmEl.textContent.indexOf(name) >= 0) { cnt++; tip = nmEl.getAttribute('title') || '' }
          })
          return { cnt: cnt, tip: tip }
        }, nm)
        /* 「机器」档切换：开筛选中心 → 点 sys checkbox（data-fk）→ 关浮层 */
        const setMachineKind = async (on) => {
          await page.click('#btnFilter')
          await page.waitForSelector('#fpop input[data-fk="sys"]', { timeout: 8000 })
          const cur = await page.evaluate(() => document.querySelector('#fpop input[data-fk="sys"]').checked)
          if (cur !== on) await page.click('#fpop input[data-fk="sys"]')
          await page.click('#btnFilter')
        }
        /* 显隐开关动作：开筛选中心 → 点「显示隐藏」checkbox（data-fh）→ 关浮层 */
        const setShowHidden = async (on) => {
          await page.click('#btnFilter')
          await page.waitForSelector('#fpop input[data-fh]', { timeout: 8000 })
          const cur = await page.evaluate(() => document.querySelector('#fpop input[data-fh]').checked)
          if (cur !== on) await page.click('#fpop input[data-fh]')
          await page.click('#btnFilter')
        }
        /* 右键机器夹并点 sys 菜单项（调用前须保证夹行可见：机器档或显示隐藏任一通道开） */
        const clickSysMenu = async () => {
          const frow = page.locator('#tree .row.head[data-fold]', { hasText: 'e2e 机器沉淀夹' }).first()
          await frow.click({ button: 'right' })
          await page.waitForSelector('#ctxMenu .mi[data-a="sys"]', { timeout: 8000 })
          const label = await page.evaluate(() => { var mi = document.querySelector('#ctxMenu .mi[data-a="sys"]'); return mi ? mi.textContent.trim() : '' })
          await page.click('#ctxMenu .mi[data-a="sys"]')
          return label
        }

        /* ① 缺省档（双通道均关）：sys 夹行 + 夹内普通笔记（随夹隐身，OS 父子树语义）+ 夹内 sys 档案 全部不渲染；种子照常 */
        await H.waitFor(page, '页面载入且种子笔记可见', async () => (await rowCnt('e2e 种子笔记 A')) === 1)
        H.t('缺省档 sys 夹行不渲染（默认隐身）', (await foldStat('e2e 机器沉淀夹')).cnt === 0)
        H.t('缺省档 sys 夹内普通笔记随夹消失（OS 父子树语义）', (await rowCnt('e2e 机器夹内普通笔记')) === 0)
        H.t('缺省档 sys 夹内档案不渲染（⑨ 降噪 + 夹遮罩双口径）', (await rowCnt('e2e 机器夹内档案')) === 0)

        /* ② 通道①：机器档选中 → sys 夹渲染（行名带机器托管 tooltip）+ 夹内 sys 档案经 kind 通道可见；普通笔记不入 corpus（kind 档语义） */
        await setMachineKind(true)
        await H.waitFor(page, '机器档下 sys 夹行出现', async () => (await foldStat('e2e 机器沉淀夹')).cnt === 1)
        /* 取数口径切换触发静默重拉——tooltip/档案行随第二波渲染落地，断言一律 waitFor 等异步 */
        await H.waitFor(page, '机器档下 sys 夹行名带机器托管 tooltip', async () => (await foldStat('e2e 机器沉淀夹')).tip.indexOf('机器托管文件夹') >= 0)
        /* 机器档=过滤激活态：带主题的档案行在「夹子容器 + 主题全局过滤区」双区渲染（同⑯ 既有口径），故 ≥1 */
        await H.waitFor(page, '机器档下夹内 sys 档案可见（kind 通道直达）', async () => (await rowCnt('e2e 机器夹内档案')) >= 1)
        H.t('机器档下夹内普通笔记不入 corpus（恰选单 kind 语义）', (await rowCnt('e2e 机器夹内普通笔记')) === 0)
        await setMachineKind(false)
        await H.waitFor(page, '取消机器档后 sys 夹行再消失', async () => (await foldStat('e2e 机器沉淀夹')).cnt === 0)

        /* ③ 通道②：显示隐藏开 → sys 夹渲染（双通道并集）；夹内普通笔记随夹可见 */
        await setShowHidden(true)
        await H.waitFor(page, '显示隐藏开 sys 夹行出现', async () => (await foldStat('e2e 机器沉淀夹')).cnt === 1)
        H.t('显示隐藏开：夹内普通笔记随夹可见', (await rowCnt('e2e 机器夹内普通笔记')) === 1)

        /* ④ 右键「取消机器属性」→ 摘除后缺省档即常显（显式 false 墓碑挡懒迁移回标；folders 重拉为异步——tooltip 摘除断言走 waitFor） */
        const unLabel = await clickSysMenu()
        H.t('右键菜单项为「取消机器属性」（sys 夹态）', unLabel.indexOf('取消机器属性') >= 0, () => '实得菜单项 ' + unLabel)
        await H.waitFor(page, '摘除后夹行仍在', async () => (await foldStat('e2e 机器沉淀夹')).cnt === 1)
        await H.waitFor(page, '摘除后行名 tooltip 摘除（非机器夹无 sysFolderTip）', async () => (await foldStat('e2e 机器沉淀夹')).tip === '')
        await setShowHidden(false)
        await H.waitFor(page, '关回显示隐藏后夹行仍常显（摘除生效不回弹）', async () => (await foldStat('e2e 机器沉淀夹')).cnt === 1)
        H.t('缺省档夹内普通笔记同恢复可见', (await rowCnt('e2e 机器夹内普通笔记')) === 1)

        /* ⑤ 可逆：右键「标记为机器文件夹」→ 缺省档再消失（往返语义完整） */
        const mkLabel = await clickSysMenu()
        H.t('右键菜单项为「标记为机器文件夹」（普通夹态）', mkLabel.indexOf('标记为机器文件夹') >= 0, () => '实得菜单项 ' + mkLabel)
        await H.waitFor(page, '再标记后缺省档夹行再消失', async () => (await foldStat('e2e 机器沉淀夹')).cnt === 0)

        /* ⑥ 普通夹/种子笔记零影响 + 清理 fixture（摘 sys 回普通夹，共享 mock 态不污染后续用例） */
        H.t('普通种子笔记全程照常可见（遮罩不误伤）', (await rowCnt('e2e 种子笔记 A')) === 1)
        await rpc('notes-folders', { op: 'set-flags', id: fId, sys: false })

        H.t('无 console error / pageerror', page.__consoleErrors.length === 0, () => page.__consoleErrors.slice(0, 3).join(' | '))
        await H.screenshot(page, '22-sys-folder-attr')
      })
    } finally { await page.context().close() }
  },
}
